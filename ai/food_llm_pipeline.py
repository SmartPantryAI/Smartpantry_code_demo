"""
food_llm_pipeline.py — LLM Vision 기반 식재료 인식 파이프라인

변경사항:
  - category_name을 server.js guessCategory와 동일한 11개 대분류로 통일
"""

import requests, base64, json, re, cv2
import numpy as np
from datetime import date, datetime, timedelta

try:
    from PIL import Image, ExifTags
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

from pipeline_common import calculate_use_by, resolve_package_unit, OLLAMA_URL, MODEL, OLLAMA_HEADERS

VALID_STORAGE = {"냉장", "냉동", "실온"}
VALID_CATEGORIES = {
    "채소류", "과일류", "육류", "수산물",
    "유제품·계란", "두부·콩류", "가공·즉석식품",
    "음료·주류", "양념·소스", "곡류·면류", "스낵·과자"
}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def fix_exif_rotation(img_path: str) -> np.ndarray:
    if not PIL_AVAILABLE:
        return cv2.imread(img_path)
    try:
        pil_img = Image.open(img_path)
        exif = pil_img._getexif()
        if exif:
            orientation_key = next(
                (k for k, v in ExifTags.TAGS.items() if v == "Orientation"), None
            )
            orientation = exif.get(orientation_key, 1) if orientation_key else 1
            rotate_map = {3: 180, 6: 270, 8: 90}
            angle = rotate_map.get(orientation, 0)
            if angle:
                pil_img = pil_img.rotate(angle, expand=True)
        return cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception:
        return cv2.imread(img_path)


def encode_image(img: np.ndarray, max_width: int = 1500, max_b64_bytes: int = 900_000) -> str:
    # 예전 게이트웨이(code.aikopo.net)의 요청 본문 제한이 약 1MB였어서, 고해상도 사진을 base64
    # 인코딩하면 이 한도를 넘어 413으로 거부되고 "0개 인식"으로 조용히 실패하는 문제가 있었다
    # (pipeline_common.py의 encode_image와 동일한 원인/해결책 - receipt_pipeline.py에서 확인됨).
    # 현재 게이트웨이(gemma.aikopo.net)는 더 넉넉하지만, 안전 마진 삼아 그대로 유지한다 -
    # 품질을 낮춰도 부족하면 해상도까지 단계적으로 줄여서 항상 한도 아래로 맞춘다.
    h, w = img.shape[:2]
    if w > max_width:
        scale = max_width / w
        img = cv2.resize(img, (int(w * scale), int(h * scale)),
                         interpolation=cv2.INTER_AREA)

    for _ in range(6):
        for quality in (85, 70, 55, 40):
            _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
            b64 = base64.b64encode(buf).decode("utf-8")
            if len(b64) <= max_b64_bytes:
                return b64
        h, w = img.shape[:2]
        img = cv2.resize(img, (int(w * 0.8), int(h * 0.8)), interpolation=cv2.INTER_AREA)
    return b64


def is_valid_date(s: str) -> bool:
    if not DATE_RE.match(s):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _try_parse(text: str):
    try:
        parsed = json.loads(text)
        return {"items": parsed} if isinstance(parsed, list) else parsed
    except Exception:
        pass
    try:
        from json_repair import repair_json
        parsed = json.loads(repair_json(text))
        return {"items": parsed} if isinstance(parsed, list) else parsed
    except Exception:
        pass
    return None


def parse_llm_json(text: str) -> dict:
    result = _try_parse(text)
    if result:
        return result
    for ch in ['{', '[']:
        idx = text.rfind(ch)
        if idx != -1:
            result = _try_parse(text[idx:])
            if result:
                return result
    print("[경고] JSON 파싱 실패")
    print("[RAW]", text[:300])
    return {"items": []}


def stream_llm(payload: dict) -> str:
    # LLM 서빙이 Ollama에서 vLLM(OpenAI 호환 API)으로 바뀌었다 - 엔드포인트는 /v1/chat/completions이고
    # 스트리밍 응답은 Ollama의 NDJSON(줄마다 완결된 JSON, message.content/done 필드)이 아니라
    # OpenAI 스타일 SSE("data: {...}" 줄, choices[0].delta.content, 종료는 "data: [DONE]")다.
    # 요청 실패(예: 게이트웨이 413/502)를 그냥 두면 예외가 그대로 올라가 /scan 전체가 500으로
    # 죽는다(pipeline_common.py의 stream_llm은 이미 이렇게 방어돼 있었음) - 여기도 맞춰서
    # 실패 시 빈 문자열을 반환해 "0개 인식"으로 안전하게 실패하도록 한다.
    try:
        resp = requests.post(f"{OLLAMA_URL}/v1/chat/completions",
                             json=payload, headers=OLLAMA_HEADERS, stream=True, timeout=300)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[LLM 오류] {e}")
        return ""
    content_buf = ""
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if data == "[DONE]":
            break
        chunk = json.loads(data)
        delta = chunk.get("choices", [{}])[0].get("delta", {})
        content_buf += delta.get("content") or ""
    return content_buf.strip()


def build_food_prompt() -> str:
    return """너는 식재료 인식 전문가다. 이미지를 보고 식재료를 인식해서 JSON만 출력해라.

[인식 규칙]
- 이미지에 보이는 식재료/음식 재료만 인식한다
- 식재료가 아닌 것(그릇, 칼, 배경 등)은 제외한다
- 수량은 눈에 보이는 개수로 센다
- 묶음 포장 수량 계산 규칙:          
  · 포장지에 묶음 수량이 적혀있으면 그 수량을 qty로 사용
    예) 라면 5개입 → qty: 5
    예) 달걀 10구 → qty: 10
    예) 캔맥주 6캔 묶음 → qty: 6
  · 낱개로 여러 개 보이면 눈에 보이는 개수로 센다
    예) 사과 3개가 보임 → qty: 3
  · 포장 단위가 불명확하면 qty: 1로 처리

[헷갈리기 쉬운 식재료 시각적 구분 규칙]
비슷하게 생긴 식재료는 아래 시각적 특징으로 구분한다.
여러 종류가 보이면 반드시 각각 따로 인식한다.

파류 구분:
  대파   → 굵고 긴 단일 줄기, 흰 부분이 길고 두꺼움, 위쪽은 진한 초록
  쪽파   → 가늘고 짧음, 뿌리 부분이 붉은빛, 잎이 여러 갈래로 갈라짐
  샐러리 → 줄기가 납작하고 홈이 파여 있음, 여러 대가 뭉쳐있고 연두색,
            특유의 아삭한 줄기 형태 (파와 달리 속이 차 있고 납작함)
  부추   → 매우 가늘고 납작한 잎, 진한 초록색, 뭉치로 자람

감자류 구분:
  감자   → 둥글고 껍질이 황갈색/흙색
  고구마 → 길쭉하고 껍질이 붉은빛/자주색

과일 구분:
  귤    → 납작하고 작음, 껍질이 얇음
  오렌지 → 완전한 구형, 크고 껍질이 두꺼움
  자몽  → 오렌지보다 크고 껍질이 두꺼우며 노란빛

무/순무 구분:
  무    → 크고 흰색, 원통형
  순무  → 작고 둥글며 보라빛 줄무늬

[중요]
이미지에 서로 다른 식재료가 여러 개 보이면
하나로 합치지 말고 반드시 각각 별도 항목으로 출력한다.

[name 작성 규칙]
- 브랜드/상품명이 있으면 "식재료명(브랜드명)" 형식으로 출력
- 브랜드/상품명이 없으면 식재료명만 출력
  예) 오뚜기 참기름 → name:"참기름(오뚜기)"
  예) 하이네켄 맥주 → name:"맥주(하이네켄)"
  예) 신라면 → name:"신라면"
  예) 햇반 → name:"즉석밥(햇반)"
  예) 용가리 → name:"냉동치킨(용가리)"
  예) 스팸 → name:"스팸"
  예) 당근 → name:"당근"

[category_name 작성 규칙]
반드시 아래 11개 중 하나만 출력한다:
  채소류      → 당근, 양파, 배추, 가지, 파프리카, 버섯, 콩나물 등 신선 채소
  과일류      → 사과, 바나나, 딸기, 수박, 포도, 망고 등 신선 과일
  육류        → 소고기, 돼지고기, 닭고기, 삼겹살, 베이컨, 스팸, 햄, 런천미트 등
  수산물      → 고등어, 오징어, 새우, 참치, 어묵, 김, 미역 등
  유제품·계란 → 우유, 치즈, 요거트, 버터, 달걀, 계란 등
  두부·콩류   → 두부, 순두부, 두유, 콩, 콩나물 등
  가공·즉석식품 → 라면, 즉석밥, 냉동만두, 통조림, 참치캔 등
  음료·주류   → 생수, 주스, 사이다, 콜라, 맥주, 소주, 에너지드링크 등
  양념·소스   → 간장, 고추장, 된장, 케첩, 마요네즈, 참기름, 고춧가루 등
  곡류·면류   → 쌀, 밀가루, 국수, 식빵, 오트밀, 파스타 등
  스낵·과자   → 과자, 아이스크림, 초콜릿, 젤리, 견과류 등

[storage 규칙]
"냉동", "냉장", "실온" 중 하나:
  냉동: 냉동 가공식품, 냉동만두, 냉동새우 등
  냉장: 신선 육류, 생선, 우유, 달걀, 두부, 어묵, 채소류, 김치
  실온: 라면, 통조림, 즉석밥, 과자, 음료, 견과류, 과일, 양념류, 주류

[unit 판별 규칙]
식재료를 저장할 때 쓸 계량 단위를 "개", "g", "ml" 중 하나로 판단한다.
- 라벨/포장에 무게나 용량이 보이면(예: "500g", "1L") 그 값을 qty로, 단위를 정규화해 unit으로 사용한다.
  kg는 g로 환산(숫자 ×1000), L은 ml로 환산(숫자 ×1000)해서 unit은 항상 "g" 또는 "ml" 중 하나로 출력한다.
  예) "고추장 500g" 라벨 → qty:500, unit:"g"
  예) "식용유 1L" 라벨   → qty:1000, unit:"ml"
- 라벨에 무게/용량 표기가 없어도:
  · 통상 무게로 계량되는 식재료(고추장, 된장, 설탕, 쌀, 밀가루 등 가루/장류) → unit:"g", 합리적인 기본 qty 추정
  · 통상 부피로 계량되는 식재료(식용유, 우유, 간장, 음료 등 액체) → unit:"ml", 합리적인 기본 qty 추정
  · 오이, 양파, 계란, 사과처럼 개별로 세는 게 자연스러운 품목 → unit:"개", qty는 눈에 보이는 개수
- 정말 판단이 불가능한 경우에만 unit:null로 출력한다.

출력 스키마 (JSON만, 설명 없이):
{
  "items": [
    {
      "name": "식재료명 또는 식재료명(브랜드명)",
      "category_name": "11개 카테고리 중 하나",
      "qty": 1,
      "unit": "개 | g | ml | null",
      "storage": "냉장 | 냉동 | 실온"
    }
  ]
}
"""


def process_food_llm(img_path: str) -> dict:
    today = date.today().strftime("%Y-%m-%d")
    img = fix_exif_rotation(img_path)
    img_b64 = encode_image(img, max_width=1200)

    print("[LLM Vision] 식재료 인식 중...")

    payload = {
        "model": MODEL,
        # chat_template_kwargs.enable_thinking은 Qwen3 전용 - gemma4-e4b는 response_format:
        # json_object만으로 이미 깨끗한 JSON을 낸다(vision 포함, reasoning 서술 안 섞임).
        "messages": [
            {"role": "system", "content": build_food_prompt()},
            {
                "role": "user",
                # Ollama의 "content"(문자열) + "images"(리스트) 분리 필드 대신, OpenAI 호환
                # vision 포맷은 content를 배열로 만들어 텍스트/이미지 블록을 함께 넣는다.
                "content": [
                    {"type": "text", "text": "이 이미지에서 식재료를 인식해줘."},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                ],
            }
        ],
        # format:"json"(Ollama) → response_format(OpenAI 호환)
        "response_format": {"type": "json_object"},
        "stream": True,
        # options.num_predict(Ollama) → top-level temperature/max_tokens(OpenAI 호환)
        "temperature": 0,
        "max_tokens": 2048,
    }

    raw_text = stream_llm(payload)

    raw_text = raw_text.strip()
    if raw_text.startswith("```"):
        raw_text = re.sub(r'^```[a-zA-Z]*\n?', '', raw_text)
        raw_text = re.sub(r'\n?```$', '', raw_text)
        raw_text = raw_text.strip()

    print("[LLM Vision RAW]:", raw_text[:300])
    result = parse_llm_json(raw_text)

    items = []
    seen = set()
    for it in result.get("items", []):
        if not isinstance(it, dict):
            continue

        name = (it.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)

        # category_name: 11개 대분류 검증
        category_name = (it.get("category_name") or "").strip()
        if category_name not in VALID_CATEGORIES:
            category_name = None

        storage = (it.get("storage") or "").strip()
        if storage not in VALID_STORAGE:
            storage = "실온"

        use_by, use_by_evidence = calculate_use_by(name, storage, today, category_name=category_name)
        qty, unit, name = resolve_package_unit(name, it.get("qty"), (it.get("unit") or "").strip())
        print(f"  [{name}] category={category_name}, storage={storage}, unit={unit} → use_by={use_by} ({use_by_evidence.get('basis')})")

        items.append({
            "name": name,
            "category_name": category_name,
            "qty": qty,
            "unit": unit,
            "storage": storage,
            "use_by": use_by,
            "use_by_source": use_by_evidence.get("source"),
            "use_by_basis": use_by_evidence.get("basis"),
            "use_by_confidence": use_by_evidence.get("confidence"),
        })

    print(f"[LLM Vision] 인식 완료: {len(items)}개")
    return {
        "source": "food_llm",
        "purchase_date": today,
        "items": items
    }


if __name__ == "__main__":
    import sys
    img_path = sys.argv[1] if len(sys.argv) > 1 else "/workspace/input/food_test.jpg"
    result = process_food_llm(img_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
import os, requests, base64, json, re, cv2
import numpy as np
from json_repair import repair_json
from datetime import datetime, timedelta

try:
    from PIL import Image, ExifTags
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    from rag.store import lookup_shelf_life
    RAG_AVAILABLE = True
except Exception as _rag_err:  # 색인 파일이 아직 없거나 rag 모듈 자체가 없어도 서비스는 계속 동작해야 함
    print(f"[RAG-B] 비활성화 (사유: {_rag_err})")
    RAG_AVAILABLE = False

    def lookup_shelf_life(*args, **kwargs):
        return None

try:
    from rag.product_store import lookup_product
    RAG_A_AVAILABLE = True
except Exception as _rag_a_err:
    print(f"[RAG-A] 비활성화 (사유: {_rag_a_err})")
    RAG_A_AVAILABLE = False

    def lookup_product(*args, **kwargs):
        return None

OLLAMA_URL = os.getenv("OLLAMA_URL", "https://gemma.aikopo.net")
MODEL      = os.getenv("OLLAMA_MODEL", "gemma4-e4b")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "120"))
# 선택값 - 비워두면(기본 gemma.aikopo.net처럼 인증이 필요없는 엔드포인트) 헤더 없이 호출한다.
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "")
OLLAMA_HEADERS = {"Authorization": f"Bearer {OLLAMA_API_KEY}"} if OLLAMA_API_KEY else {}

VALID_STORAGE = {"냉장", "냉동", "실온"}
VALID_UNITS = {"개", "g", "ml"}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


# ══════════════════════════════════════════════════════════════
# 식약처 소비기한 참고값 (제조일 기준, 단위: 일)
#
# 출처: 식품의약품안전처 「식품 유형별 소비기한 참고값」
#       한국식품산업협회 (https://www.kfia.or.kr)
#
# ⚠️ 아래 값은 대표적인 참고값이며, 실제 식약처 공개 데이터로
#    검증/보완할 것. 매칭은 "전체 그룹 통틀어 가장 긴 키워드"가 이긴다.
#
# 테이블을 두 갈래로 나눈 이유:
#   _MFDS_FRESH        — 상하기 쉬운 신선 농·수·축산물, 유제품, 두부.
#   _MFDS_SHELF_STABLE — 상온/장기 보관되는 가공식품(통조림·장류·유지류·
#                        면류·즉석밥·과자·조미료 등).
# 가공식품 경로에서 RAG가 실패했을 때는 _MFDS_SHELF_STABLE만 폴백으로 쓴다.
# _MFDS_FRESH까지 열어주면 "새우깡"이 "새우"(2일)에, "오감자"가 "감자"(21일)에
# 다시 걸리는 원래 버그가 되살아난다.
# ══════════════════════════════════════════════════════════════
_MFDS_FRESH: list[tuple[list[str], int]] = [
    # ── 유제품 ──
    (["발효유", "요거트", "요구르트"], 18),
    (["가공유", "딸기우유", "초코우유", "바나나우유"], 16),
    (["우유", "멸균우유"], 14),
    (["치즈", "체다", "모짜렐라"], 70),
    (["버터"], 180),
    (["생크림", "휘핑크림"], 14),

    # ── 두부/콩 ──
    (["두부"], 14),
    (["순두부"], 10),
    (["콩나물"], 5),
    (["숙주"], 4),

    # ── 신선 육류 (냉장) ──
    (["다짐육", "간고기"], 2),
    (["삼겹살", "목살", "갈비", "불고기", "소고기", "돼지고기", "닭고기", "한우", "한돈"], 5),

    # ── 신선 수산 (냉장) ──
    (["회", "활어", "생물"], 1),
    (["고등어", "갈치", "삼치", "조기", "생선"], 2),
    (["연어"], 3),
    (["새우", "오징어", "조개", "게", "어패"], 2),

    # ── 달걀 ──
    (["달걀", "계란", "특란", "메추리알"], 30),

    # ── 채소 (냉장) ──
    (["상추", "시금치", "깻잎", "배추", "잎채소", "쌈채소"], 5),
    (["오이", "애호박", "호박", "가지", "파프리카", "고추"], 7),
    (["당근", "무", "양배추", "브로콜리"], 10),
    (["대파", "쪽파", "부추"], 7),
    (["버섯", "표고", "느타리", "팽이"], 7),

    # ── 과일 (실온/냉장) ──
    (["딸기", "블루베리", "산딸기"], 4),
    (["복숭아", "자두", "포도", "체리"], 7),
    (["사과", "배", "감", "귤", "오렌지", "레몬", "자몽"], 14),
    (["바나나", "망고", "키위", "참외", "수박", "멜론"], 7),

    # ── 뿌리채소 (실온) ──
    (["양파", "마늘", "감자", "고구마", "생강"], 21),
]

_MFDS_SHELF_STABLE: list[tuple[list[str], int]] = [
    # ── 어묵/가공수산 ──
    (["어묵", "맛살", "게맛살"], 29),
    (["젓갈"], 60),

    # ── 김치/절임 ──
    (["김치", "겉절이"], 30),
    (["단무지", "장아찌", "피클"], 90),

    # ── 육가공 ──
    (["햄", "소시지", "비엔나"], 38),
    (["베이컨"], 30),
    (["스팸", "런천미트"], 365),

    # ── 면/즉석 ──
    (["라면", "국수", "당면", "파스타", "스파게티"], 180),
    (["즉석밥", "햇반"], 270),
    (["냉동만두", "만두"], 270),

    # ── 통조림/장류 ──
    (["참치캔", "통조림", "캔"], 365),
    (["간장", "된장", "고추장", "쌈장", "춘장"], 540),
    (["참기름", "들기름", "식용유", "올리브유"], 365),
    (["고춧가루", "소금", "설탕", "밀가루", "전분"], 365),
    (["케첩", "케찹", "마요네즈", "소스", "드레싱"], 270),
    (["잼", "마멀레이드"], 270),

    # ── 곡물 ──
    (["쌀", "현미", "잡곡", "보리", "콩"], 180),

    # ── 과자/스낵 ──
    (["과자", "스낵", "크래커", "쿠키", "비스킷", "초콜릿"], 180),
    (["빵", "식빵", "베이글"], 5),
    (["견과류", "아몬드", "호두", "땅콩", "캐슈"], 180),

    # ── 음료/주류 ──
    (["생수", "물"], 365),
    (["탄산음료", "콜라", "사이다"], 270),
    (["주스", "음료"], 180),
    (["맥주"], 365),
    (["소주", "막걸리", "와인"], 365),
]

# 신선식품 경로는 종전대로 전체 테이블을 쓴다(동작 불변).
_MFDS_USE_BY: list[tuple[list[str], int]] = _MFDS_FRESH + _MFDS_SHELF_STABLE

# 식약처 매핑에 없을 때 storage별 기본값
_STORAGE_DEFAULT_DAYS = {"냉동": 90, "냉장": 5, "실온": 90}


# ══════════════════════════════════════════════════════════════
# 단위(unit) 추정 휴리스틱
#
# LLM이 unit을 못 판단했을 때(None/유효하지 않은 값)의 2차 안전망.
# 식재료명 키워드로 통상적인 계량 단위를 추정한다 - 여기에도 없으면
# null을 유지해 프런트에서 사용자가 직접 단위를 선택하게 둔다.
# ══════════════════════════════════════════════════════════════
_DEFAULT_UNIT_BY_NAME: dict[str, str] = {
    # ── 개수형 ──
    "오이": "개", "양파": "개", "계란": "개", "달걀": "개", "감자": "개",
    "고구마": "개", "당근": "개", "사과": "개", "배": "개", "바나나": "개",
    "토마토": "개", "마늘": "개", "레몬": "개", "양배추": "개", "두부": "개",
    "가지": "개", "호박": "개", "애호박": "개", "파프리카": "개", "피망": "개",

    # ── 부피형(ml) ──
    "우유": "ml", "두유": "ml", "식용유": "ml", "참기름": "ml", "들기름": "ml",
    "올리브유": "ml", "주스": "ml", "생수": "ml", "맥주": "ml",   
    "소주": "ml", "막걸리": "ml", "와인": "ml", "식초": "ml", "맛술": "ml",
    "미림": "ml", "탄산음료": "ml", "콜라": "ml", "사이다": "ml",
    "케찹": "ml", "마요네즈": "ml", "머스타드": "ml", "칠리소스": "ml",
    "돈까스소스": "ml", "올리고당": "ml", "물엿": "ml",

    # ── 무게형(g) ──
    "고추장": "g", "된장": "g", "쌈장": "g", "춘장": "g", "설탕": "g",
    "소금": "g", "쌀": "g", "현미": "g", "밀가루": "g", "고춧가루": "g",
    "전분": "g", "버터": "g", "치즈": "g", "후추": "g",
}

# 길이가 긴(구체적인) 키워드부터 매칭해야 잘못된 부분 일치를 피할 수 있다.
_SORTED_UNIT_KEYWORDS = sorted(_DEFAULT_UNIT_BY_NAME.items(), key=lambda kv: len(kv[0]), reverse=True)


def _find_keyword(name: str, keywords) -> str | None:
    """name(괄호 앞부분 우선, 그다음 전체)에서 가장 먼저 매칭되는 키워드를 찾는다."""
    if not name:
        return None
    base = name.split("(")[0].strip()
    for keyword in keywords:
        if keyword in base:
            return keyword
    for keyword in keywords:
        if keyword in name:
            return keyword
    return None


def guess_unit(name: str, unit) -> str | None:
    """LLM이 내려준 unit이 유효하면 그대로 쓰고, 없거나 무효하면 이름 키워드 기반으로 추정한다."""
    if unit in VALID_UNITS:
        return unit
    keyword = _find_keyword(name, (kv[0] for kv in _SORTED_UNIT_KEYWORDS))
    return _DEFAULT_UNIT_BY_NAME[keyword] if keyword else None


# ══════════════════════════════════════════════════════════════
# 포장단위(통/단/봉/마리 등) → 개/g 환산
#
# 펜트리 저장 단위는 개/g/ml 3종으로 고정이므로, 아래 포장단위들은 unit 자체가
# 아니라 인식 시점에 qty를 보정하는 환산 계수로만 쓴다.
#   - _PACKAGE_TO_COUNT: 결과 단위가 "개"가 되는 품목 (포장 안의 기준 낱개 수)
#   - _PACKAGE_TO_WEIGHT_G: 결과 단위가 "g"이 되는 품목 (포장 1단위 ≈ 몇 g)
# ══════════════════════════════════════════════════════════════
_PACKAGE_TO_COUNT: dict[str, dict[str, float]] = {
    "마늘":   {"통": 6, "쪽": 1},
    "대파":   {"단": 6, "대": 1},
    "파":     {"단": 6, "대": 1},
    "쪽파":   {"단": 10, "대": 1},
    "마늘쫑": {"단": 20, "줄기": 1},
    "계란":   {"판": 30, "개": 1},
    "달걀":   {"판": 30, "개": 1},
    "두부":   {"모": 1},
    "배추":   {"포기": 1},
    "양배추": {"통": 1},
    "양상추": {"포기": 1},
    "브로콜리": {"송이": 1},
    "바나나": {"송이": 6, "다": 6, "개": 1},
    "다시마": {"장": 1},
    "김":     {"봉": 10, "장": 1},
    "고등어": {"마리": 1},
    "갈치":   {"마리": 1},
    "오징어": {"마리": 1},
}

_PACKAGE_TO_WEIGHT_G: dict[str, dict[str, float]] = {
    "시금치":   {"단": 250},
    "부추":     {"단": 200},
    "미나리":   {"단": 200},
    "깻잎":     {"봉": 100},
    "콩나물":   {"봉": 300},
    "숙주":     {"봉": 300},
    "상추":     {"봉": 200},
    "느타리버섯": {"봉": 150},
    "팽이버섯": {"봉": 150},
    "만가닥버섯": {"봉": 150},
    "멸치":     {"봉": 150},
    "어묵":     {"봉": 200},
    "미역":     {"줌": 10},
    "김치":     {"포기": 2500},
    "한우": {"근": 600}, 
    "돼지고기": {"근": 600}, 
    "소고기": {"근": 600},
}

# "망"/"포대"/"포"는 상품마다 용량이 제각각이라 고정 평균값을 두지 않는다.
# 무게 표기가 함께 있으면 그 숫자를 그대로 쓰고, 없으면 unit:null로 보류한다.
_NO_DEFAULT_CONVERSION_PACKAGES = {"포대", "망", "포"}

# 무게(g)는 알지만 펜트리 표시 단위가 "개"인 식재료(_DEFAULT_UNIT_BY_NAME 기준)를
# 위해 개당 평균 중량으로 개수를 역산할 때 쓰는 2차 보강 테이블.
_AVG_WEIGHT_G_PER_UNIT: dict[str, float] = {
    "감자": 150, "당근": 120, "양파": 200, "고구마": 200,
    "사과": 250, "배": 400, "양배추": 1200, "호박": 300,
    "애호박": 300, "가지": 150, "파프리카": 180, "오이": 120,
    "토마토": 150, "바나나": 120, "레몬": 100, "피망": 100,
}

_SORTED_PACKAGE_COUNT_KEYS  = sorted(_PACKAGE_TO_COUNT.keys(), key=len, reverse=True)
_SORTED_PACKAGE_WEIGHT_KEYS = sorted(_PACKAGE_TO_WEIGHT_G.keys(), key=len, reverse=True)
_SORTED_AVG_WEIGHT_KEYS     = sorted(_AVG_WEIGHT_G_PER_UNIT.keys(), key=len, reverse=True)

# "숫자 + 포장단위" 패턴(예: "1통", "2단"). 뒤에 한글이 더 이어지면(예: "포기"의 "포"는
# 제외) 매칭하지 않도록 같은 길이 그룹 안에서 긴 토큰을 먼저 시도한다.
_PACKAGE_MULT_TOKENS = sorted(
    {tok for sub in _PACKAGE_TO_COUNT.values() for tok in sub if tok != "개"}
    | {tok for sub in _PACKAGE_TO_WEIGHT_G.values() for tok in sub},
    key=len, reverse=True,
)
_PACKAGE_MULT_RE = re.compile(
    r'(\d+(?:\.\d+)?)\s*(' + '|'.join(_PACKAGE_MULT_TOKENS) + r')(?![가-힣])'
)

# "망"/"포대"/"포"는 숫자 없이도(예: "3kg망") 등장할 수 있으므로 존재 여부만 본다.
# 앞뒤로 다른 한글이 붙어있으면(예: "포기") 매칭하지 않는다.
_NO_CONV_ALT = '|'.join(sorted(_NO_DEFAULT_CONVERSION_PACKAGES, key=len, reverse=True))
_AMBIGUOUS_PACKAGE_RE = re.compile(r'(?<![가-힣])(' + _NO_CONV_ALT + r')(?![가-힣])')
# name 정리용: "당근 1망"처럼 바로 앞에 붙은 숫자까지 함께 제거한다("감자 3kg망"의 "3kg"은
# 이미 [unit/qty 추출 규칙]에서 제거되므로 여기서는 단순 숫자 접두만 신경 쓰면 된다).
_STRIP_AMBIGUOUS_RE = re.compile(r'\d*(?:\.\d+)?\s*(?:' + _NO_CONV_ALT + r')(?![가-힣])')


def _strip_package_tokens(name: str) -> str:
    """qty/unit으로 이미 반영된 포장단위 표기는 식재료명에서 제거해 깔끔하게 만든다."""
    name = _PACKAGE_MULT_RE.sub('', name)
    name = _STRIP_AMBIGUOUS_RE.sub('', name)
    return re.sub(r'\s+', ' ', name).strip()


def resolve_package_unit(name: str, qty, unit) -> tuple[float, str | None, str]:
    """
    포장단위(통/단/봉/망 등)가 섞인 qty/unit을 펜트리 기준(개/g/ml)으로 보정한다.
    (보정된 qty, unit, 포장단위 표기를 뗀 name) 튜플을 반환한다.

    우선순위:
      1. "망"/"포대"/"포"가 있고 무게(g/ml)가 함께 주어지지 않았으면 즉시 unit:None
         (오차가 큰 고정 평균값을 두지 않기 위한 폴백 - 사용자가 직접 확인).
      2. 식재료별 개수형 환산표(_PACKAGE_TO_COUNT) 매칭 → qty *= 배수, unit:"개".
      3. 식재료별 무게형 환산표(_PACKAGE_TO_WEIGHT_G) 매칭 → qty = 배수, unit:"g".
      4. 위에서 못 정하면 이름 기반 휴리스틱(guess_unit) 적용.
      5. 그 결과가 "g"인데 펜트리 기본 단위가 "개"인 식재료라면 개당 평균 중량으로
         개수를 역산한다(예: "감자 3kg망" → 3000g ÷ 150g/개 ≈ 20개).
    """
    qty = float(qty or 1)
    resolved_unit = unit if unit in VALID_UNITS else None
    has_ambiguous_pkg = bool(_AMBIGUOUS_PACKAGE_RE.search(name))

    if has_ambiguous_pkg and resolved_unit not in ("g", "ml"):
        return qty, None, _strip_package_tokens(name)

    m = _PACKAGE_MULT_RE.search(name)
    if m:
        number, token = float(m.group(1)), m.group(2)
        count_key = _find_keyword(name, _SORTED_PACKAGE_COUNT_KEYS)
        if count_key and token in _PACKAGE_TO_COUNT[count_key]:
            return number * _PACKAGE_TO_COUNT[count_key][token], "개", _strip_package_tokens(name)

        weight_key = _find_keyword(name, _SORTED_PACKAGE_WEIGHT_KEYS)
        if weight_key and token in _PACKAGE_TO_WEIGHT_G[weight_key]:
            return number * _PACKAGE_TO_WEIGHT_G[weight_key][token], "g", _strip_package_tokens(name)

    if resolved_unit is None:
        resolved_unit = guess_unit(name, unit)

    if resolved_unit == "g":
        avg_key = _find_keyword(name, _SORTED_AVG_WEIGHT_KEYS)
        if avg_key and guess_unit(name, None) == "개":
            count = max(1, round(qty / _AVG_WEIGHT_G_PER_UNIT[avg_key]))
            return count, "개", _strip_package_tokens(name)

    cleaned_name = _strip_package_tokens(name) if (has_ambiguous_pkg or m) else name
    return qty, resolved_unit, cleaned_name


# ══════════════════════════════════════════════════════════════
# 낱개 용량(ml) → 총 부피 환산 여부 판단
#
# 참기름·간장 같은 "조리용 액체"는 레시피에서 ml/스푼으로 차감되므로
# 낱개 용량 × 개수를 총 부피(ml)로 환산해 저장한다.
# 반면 바나나우유·요구르트처럼 "한 번에 마시는 완제품"은 레시피 재료로
# 쓰일 일이 없고, 240ml×2=480ml 같은 값은 오히려 사용자를 헷갈리게 한다.
# → 이런 품목은 부피 환산을 건너뛰고 개수(개)로 기록한다.
# ══════════════════════════════════════════════════════════════

# 낱개 용량이 작아도(1회분이어도) 무조건 ml/g로 환산하는 조리용 액체 키워드.
_FORCE_VOLUME_LIQUIDS = (
    "참기름", "들기름", "식용유", "올리브유", "포도씨유", "카놀라유", "해바라기씨유",
    "간장", "국간장", "진간장", "맛간장", "양조간장", "조선간장",
    "식초", "사과식초", "현미식초", "발사믹",
    "맛술", "미림", "미향", "청주", "정종",
    "액젓", "까나리액젓", "멸치액젓", "피시소스",
    "소스", "시럽", "올리고당", "물엿", "조청", "매실청", "레몬즙", "생강즙",
)

# 낱개 용량과 무관하게 "완제품 1개"로 취급하는 단품 음료 키워드.
_CONSUME_AS_UNIT = (
    "바나나우유", "바나나맛우유", "초코우유", "초콜릿우유", "딸기우유", "커피우유",
    "가공유", "요구르트", "요플레", "요거트", "액티비아",
    "박카스", "비타500", "비타1000", "핫식스", "레드불", "몬스터", "포카리", "게토레이",
    "캔커피", "레쓰비", "티오피", "칸타타", "조지아",
    "식혜", "수정과", "아침햇살", "쌕쌕", "봉봉",
)

# 이 값 이하의 낱개 용량(ml)은 "1회 음용분"으로 보고 개수로 기록한다.
_SINGLE_SERVE_ML = 500


def resolve_receipt_volume(name: str, unit_weight, purchase_qty: float,
                           unit: str | None) -> tuple[float, str | None]:
    """
    영수증의 낱개 용량/구매 개수를 펜트리 저장값(qty, unit)으로 환산한다.

    - 조리용 액체(_FORCE_VOLUME_LIQUIDS): 낱개 용량 × 개수 → 총 부피(ml/g)
    - 단품 음료(_CONSUME_AS_UNIT) 또는 낱개 용량이 1회분(_SINGLE_SERVE_ML) 이하인
      ml 품목: 부피 환산을 건너뛰고 개수(개)로 기록
    - 낱개 용량/단위 정보가 없으면: 개수 그대로, unit은 None(프런트에서 사용자 선택)
    """
    if unit_weight is None or unit not in ("g", "ml"):
        return purchase_qty, None

    try:
        uw = float(unit_weight)
    except (TypeError, ValueError):
        return purchase_qty, None

    base = name.split("(")[0]
    matches = lambda kws: any(kw in base or kw in name for kw in kws)

    # 1) 조리용 액체는 용량이 작아도 무조건 부피 환산
    if matches(_FORCE_VOLUME_LIQUIDS):
        return uw * purchase_qty, unit

    # 2) 단품 음료는 용량과 무관하게 개수
    if unit == "ml" and matches(_CONSUME_AS_UNIT):
        return purchase_qty, "개"

    # 3) 낱개 용량이 1회 음용분 수준인 ml 품목도 개수로
    if unit == "ml" and uw <= _SINGLE_SERVE_ML:
        return purchase_qty, "개"

    return uw * purchase_qty, unit


def is_valid_date(s: str) -> bool:
    if not DATE_RE.match(s):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _add_days(base_date_str: str, days: int) -> str:
    base = datetime.strptime(base_date_str, "%Y-%m-%d")
    return (base + timedelta(days=days)).strftime("%Y-%m-%d")


# _MFDS_USE_BY 키워드 테이블은 "신선식품"(채소/과일/육류/수산물/유제품/두부)을 염두에 두고
# 만들어졌다. 가공식품(스낵·과자, 가공·즉석식품 등)에 그대로 적용하면 "새우깡"이 "새우"
# 키워드에 걸려 2일로 계산되는 등 심각한 오분류가 생긴다(교차 사례는 PR 논의 참고).
# RAG-B(식약처 소비기한 참고값 임베딩 검색)로 대체되기 전까지, 최소한 가공식품 카테고리는
# 이 키워드 테이블을 아예 타지 않도록 게이트를 둔다.
_FRESH_FOOD_CATEGORIES = {"채소류", "과일류", "육류", "수산물", "유제품·계란", "두부·콩류"}


def _match_keyword_table(name: str, table: list[tuple[list[str], int]]) -> tuple[str, int] | None:
    """전체 그룹을 통틀어 가장 긴 키워드가 이긴다 — "감자"가 과일류 그룹의 "감"(1글자)에
    먼저 걸려 뿌리채소 그룹의 "감자"(2글자, 정확 일치)를 놓치는 문제를 막는다.
    반환: (matched_keyword, days) 또는 None."""
    best = None  # (키워드 길이, 키워드, days)
    for keywords, days in table:
        for kw in keywords:
            if kw in name and (best is None or len(kw) > best[0]):
                best = (len(kw), kw, days)
    return (best[1], best[2]) if best else None


def _rag_lookup(name: str, storage: str, category_name: str | None,
                query_text: str | None) -> dict | None:
    if not RAG_AVAILABLE:
        return None
    rag_query = query_text or name
    if category_name:
        rag_query = f"{rag_query} {category_name}"
    return lookup_shelf_life(rag_query, storage=storage)


def calculate_use_by(name: str, storage: str, purchase_date: str,
                     category_name: str | None = None,
                     query_text: str | None = None) -> tuple[str, dict]:
    """
    소비기한 계산 — 카테고리에 따라 우선순위 자체를 다르게 둔다.

    RAG-B 코퍼스(식약처 소비기한 참고값)는 전부 "가공식품" 예시로만 구성되어
    있고 신선 농·수·축산물은 대상이 아니다. 그래서:

      [신선식품] (채소류/과일류/육류/수산물/유제품·계란/두부·콩류, category=None 포함)
        1순위: 키워드 테이블 전체(_MFDS_USE_BY)
        2순위: RAG (키워드 테이블에 없는 드문 재료 보강)
        3순위: storage 기본값
        ※ RAG를 1순위로 두면 "생새우"가 가공식품 문서와 글자만 겹쳐 훨씬 긴
          소비기한으로 잘못 매칭되는 위험한 오류가 생긴다.

      [가공식품] (스낵·과자/가공·즉석식품/음료·주류/양념·소스/곡류·면류 등)
        1순위: RAG (해당 카테고리를 위해 만들어진 코퍼스)
        2순위: _MFDS_SHELF_STABLE 키워드 테이블 (통조림·장류·유지류·면류·과자…)
        3순위: storage 기본값
        ※ _MFDS_FRESH(신선식품 키워드)는 절대 안 탄다 — "새우깡"이 "새우"(2일)에,
          "오감자"가 "감자"(21일)에 걸리는 오분류를 막기 위함.
        ※ 2순위를 둔 이유: RAG-B 평가에서 참기름·간장·케첩·참치캔·햇반처럼
          예전 키워드 테이블이 정확히 맞히던 상온 가공식품이 RAG 미스 시
          storage 기본값(90일)으로 추락해 전체 MAE가 오히려 악화됐다.

    Returns:
        (use_by_date, evidence)
    """
    is_fresh = category_name is None or category_name in _FRESH_FOOD_CATEGORIES

    def _finish(days: int, evidence: dict) -> tuple[str, dict]:
        if storage == "냉동":
            days = max(days, 90)
        return _add_days(purchase_date, days), evidence

    if is_fresh:
        kw = _match_keyword_table(name, _MFDS_USE_BY)
        if kw:
            return _finish(kw[1], {
                "basis": "hardcoded_table",
                "source": "식약처 소비기한 참고값(내장 테이블)",
                "matched_keyword": kw[0],
            })
        hit = _rag_lookup(name, storage, category_name, query_text)
        if hit:
            return _finish(hit["days"], {
                "basis": "rag", "source": hit["source"],
                "matched_item": hit["item_name"],
                "confidence": round(hit["score"], 3),
                "value_basis": hit["value_basis"],
            })
    else:
        hit = _rag_lookup(name, storage, category_name, query_text)
        if hit:
            return _finish(hit["days"], {
                "basis": "rag", "source": hit["source"],
                "matched_item": hit["item_name"],
                "confidence": round(hit["score"], 3),
                "value_basis": hit["value_basis"],
            })
        kw = _match_keyword_table(name, _MFDS_SHELF_STABLE)
        if kw:
            return _finish(kw[1], {
                "basis": "hardcoded_table",
                "source": "식약처 소비기한 참고값(내장 테이블, 상온 가공식품)",
                "matched_keyword": kw[0],
            })

    days = _STORAGE_DEFAULT_DAYS.get(storage, 7)
    return _add_days(purchase_date, days), {
        "basis": "storage_default",
        "source": f"{storage or '기본'} 보관 기본값",
    }


def fix_exif_rotation(img_path: str) -> np.ndarray:
    if not PIL_AVAILABLE:
        return cv2.imread(img_path)
    try:
        pil_img = Image.open(img_path)
        exif = pil_img.getexif()
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


def encode_image(img: np.ndarray, max_width: int = 1000, max_b64_bytes: int = 900_000) -> str:
    # 예전 게이트웨이(code.aikopo.net)의 요청 본문 제한이 약 1MB(1024KB에서 즉시 413, 1000KB는
    # 통과)였어서, 실제 폰 카메라 사진(예: 3060x4080)을 base64 인코딩하면 이 한도를 넘어 413으로
    # 거부되고 stream_llm이 빈 문자열을 반환해 "0개 인식"으로 조용히 실패하는 문제가 실사용 중
    # 확인됐다. 현재 게이트웨이(gemma.aikopo.net)는 더 넉넉하지만(1200KB에서도 413 없음 확인),
    # 안전 마진 삼아 그대로 유지한다. 품질을 낮춰도 부족하면 해상도까지 단계적으로 줄여서 항상
    # 한도 아래로 맞춘다(프롬프트 텍스트 오버헤드를 감안해 base64 900KB를 목표로 잡는다).
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


def _wrap(parsed):
    if isinstance(parsed, list):
        return {"items": parsed}
    return parsed


def _try_parse(text: str):
    try:
        return _wrap(json.loads(text))
    except json.JSONDecodeError:
        pass
    try:
        return _wrap(json.loads(repair_json(text)))
    except Exception:
        pass
    return None


def parse_llm_json(text: str) -> dict:
    result = _try_parse(text)
    if result is not None:
        return result
    for start_char in ['{', '[']:
        idx = text.rfind(start_char)
        if idx != -1:
            result = _try_parse(text[idx:])
            if result is not None:
                return result
    print("[경고] JSON 파싱 실패")
    print("[RAW]", text[:300])
    return {"items": []}


def stream_llm(payload: dict) -> str:
    # LLM 서빙이 Ollama에서 vLLM(OpenAI 호환 API)으로 바뀌었다 - 엔드포인트는 /v1/chat/completions이고
    # 스트리밍 응답은 Ollama의 NDJSON(줄마다 완결된 JSON, message.content/thinking/done 필드)이 아니라
    # OpenAI 스타일 SSE("data: {...}" 줄, choices[0].delta.content, 종료는 "data: [DONE]")다.
    # reasoning(사고 과정)이 별도로 오는 경우 delta.reasoning_content로 온다(Ollama의 thinking에 대응).
    try:
        resp = requests.post(f"{OLLAMA_URL}/v1/chat/completions",
                             json=payload, headers=OLLAMA_HEADERS, stream=True, timeout=LLM_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[LLM 오류] {e}")
        return ""
    content_buf = ""
    thinking_buf = ""
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if data == "[DONE]":
            break
        chunk = json.loads(data)
        delta = chunk.get("choices", [{}])[0].get("delta", {})
        content_buf += delta.get("content") or ""
        thinking_buf += delta.get("reasoning_content") or ""
    return content_buf.strip() if content_buf.strip() else thinking_buf


_PASS2_PROMPT = """너는 한국 식재료 정보 처리 전문가다. 생각하지 말고 바로 JSON만 출력해라.
이미지는 없다. 아래 텍스트 데이터만 처리한다.

처리할 상품 목록:
{items_json}

[중요] 입력 상품 목록에 없는 항목을 절대 추가하지 마라. 있는 것만 정규화한다.

[영어 식재료 번역 규칙]
apple→사과, potato→감자, egg→달걀, tofu→두부, carrot→당근, onion→양파,
milk→우유, banana→바나나, strawberry→딸기, watermelon→수박, orange→오렌지,
peach→복숭아, pear→배, mango→망고, kiwi→키위, cherry→체리, pineapple→파인애플,
sesame oil→참기름, kimchi→김치, seaweed→김, spam→스팸, canned tuna→참치캔,
green onion→대파, chili powder→고춧가루, doenjang→된장

[OCR 글자 교정 원칙]
한국 영수증 OCR에서 아래 글자 혼동이 흔하다. 식재료명으로 자연스러운 방향으로만 교정한다:
  목 ↔ 묵   (어목 → 어묵)
  보 ↔ 볶   (보음 → 볶음)
  어 ↔ 여   (여묵 → 어묵)
  탕 ↔ 땅   (볶음탕 → 볶음땅)
  ㅐ ↔ ㅔ   (햇잎/핫잎 → 깻잎)
  받침 ㄱ↔ㅋ, ㄹ↔ㄴ 혼동도 흔하다.
[환각 금지] 위 원칙으로도 명확히 식재료가 떠오르지 않으면, 추측으로 그럴듯한
상품명을 지어내지 말고 원문을 그대로 둬라. 입력에 없던 브랜드/상품명을 만들지 마라.

[영문 코드 → 식재료 변환 원칙]
영수증 코드 접두어(HMP, HMPIA, IA, GSI, B3 등)는 제거하고 뒤의 식재료명만 남긴다.
  예) "HMPIA우유"   → "우유"
  예) "HMP양배추"   → "양배추"
  예) "GSI그라시아멜로" → "멜론"
접두어를 떼도 식재료명이 불분명하면 원문 유지(지어내지 마라).

[name 정규화 규칙]
다음을 제거한다:
- 브랜드명: CJ, 대림, 신라, 한성, 돌, 서울, 풀무원, 오뚜기 등
- 단순 원산지: 국산, 부산 등 (단, 한우/한돈처럼 품종·등급 의미면 유지)
- 마케팅 수식어: ZERO, 클래식, 오리지널, 알뜰, 고당도, 박사, 특선 등
- 크기 등급 단독 표기: (대), (소), (특)
- 상품코드 숫자 접두어
- 상품명 뒤 단순 수량 숫자 (개수는 qty로 분리)
  예) "깻잎 20" → name:"깻잎", qty:20
  예) "사과 2입(소)" → name:"사과(소)", qty:2
  예) "요플레(딸기)×4" → name:"요플레(딸기)", qty:4
  예) "컵라면x3" → name:"컵라면", qty:3

다음은 반드시 유지한다:
- 조리/처리 상태: 냉동, 생물, 훈제, 건조, 볶음, 자숙
- 품종/등급: 한우, 한돈, 무항생제, 특란, 저지방
- 부위/종류: 국거리, 삼겹살, 가브리살, 목살 등
- 포장단위 표기: 통, 쪽, 단, 대, 판, 모, 포기, 마리, 봉, 송이, 줄기, 줌, 망, 포대, 근
  — 숫자와 함께 그대로 둔다(다음 단계에서 개수·무게로 환산).
  예) "마늘 1통" → name:"마늘 1통" (그대로)

[unit/qty 추출 규칙]
입력에 "unit"이 g/ml로 채워져 있으면 그 값과 qty를 유지(재계산 금지), name에서 무게/부피 표기 제거.
입력에 unit이 없는데 name에 무게/부피 표기(g, kg, ml, mL, L)가 남아있으면:
  숫자를 qty로, 단위를 정규화(kg→g ×1000, L→ml ×1000, mL→ml)해 unit에 채우고 name에서 제거.
  예) "느타리버섯 200g" → name:"느타리버섯", qty:200, unit:"g"
  예) "우유 1L" → name:"우유", qty:1000, unit:"ml"
무게/부피 표기가 전혀 없으면 unit은 null(qty는 구매 수량 그대로).

[qty 계산 규칙]
무게/부피가 추출된 상품은 위 규칙을 따른다.
그 외 상품은 qty = 전달받은 qty × 상품명에 표시된 묶음 수량.
- 묶음 단위(name에서 제거): 개입, 구, 봉지, 팩, 매, 미, 입
  (통/쪽/단/대/판/모/포기/마리/봉/송이/줄기/줌/망/포대/근은 제외 — name에 유지)
  예) "계란 15구 (중란)" → name:"계란(중란)", qty:15
  예) "라면 5개입" → name:"라면", qty:5
  예) "캔맥주 6캔" → name:"맥주", qty:6

[storage 규칙]
"냉동", "냉장", "실온" 중 하나:
  냉동: 냉동 표기 가공식품, 냉동만두, 냉동새우 등
  냉장: 신선 육류, 생선·어패류, 우유·유제품, 달걀, 두부, 어묵, 채소, 김치, 유부
  실온: 라면·면류, 통조림, 과자·스낵, 생수·음료, 쌀·잡곡, 견과류, 과일, 양념류

[category_name 규칙]
반드시 아래 11개 중 하나만 출력:
  채소류, 과일류, 육류, 수산물, 유제품·계란, 두부·콩류,
  가공·즉석식품, 음료·주류, 양념·소스, 곡류·면류, 스낵·과자

출력 스키마:
{{
  "items": [
    {{
      "name": "정규화된 식재료/음식명 (반드시 한국어)",
      "category_name": "11개 카테고리 중 하나",
      "qty": 1,
      "unit": "g | ml | null",
      "storage": "냉장 | 냉동 | 실온"
    }}
  ]
}}
JSON만 출력.
"""


# 같은 영수증 품목(name/qty/unit이 완전히 동일)은 재구매 시 그대로 다시 찍히는 경우가 많다.
# temperature=0이라 같은 입력이면 LLM도 이전과 같은 결과를 낼 뿐이므로, 정확도 손실 없이
# 이미 정규화한 품목은 캐시로 재사용하고 처음 보는 품목만 LLM에 보내 생성량/왕복을 줄인다.
_PASS2_CACHE_PATH = os.path.join(os.path.dirname(__file__), "pass2_item_cache.json")


def _load_pass2_cache() -> dict:
    try:
        with open(_PASS2_CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


_pass2_cache = _load_pass2_cache()


def _pass2_cache_key(raw_item: dict) -> str:
    return json.dumps(raw_item, ensure_ascii=False, sort_keys=True)


def _save_pass2_cache():
    try:
        with open(_PASS2_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(_pass2_cache, f, ensure_ascii=False)
    except OSError as e:
        print(f"[pass2 캐시 저장 실패] {e}")


def pass2_normalize(purchase_date: str, raw_items: list, fallback_date: str) -> list:
    keys   = [_pass2_cache_key(it) for it in raw_items]
    misses = [it for it, k in zip(raw_items, keys) if k not in _pass2_cache]

    llm_out_items = []
    if misses:
        items_json = json.dumps(misses, ensure_ascii=False, indent=2)

        payload = {
            "model": MODEL,
            # chat_template_kwargs.enable_thinking은 Qwen3 전용 - gemma4-e4b는 이 개념이 없고
            # response_format:json_object만으로 이미 깨끗한 JSON을 낸다(reasoning 서술 없음).
            "messages": [
                {"role": "system", "content": _PASS2_PROMPT.format(items_json=items_json)},
                {"role": "user", "content": "위 상품 목록을 정규화해줘."}
            ],
            "response_format": {"type": "json_object"},
            "stream": True,
            "temperature": 0,
            "max_tokens": 2048,
        }

        raw_text = stream_llm(payload)
        llm_out_items = parse_llm_json(raw_text).get("items", [])

        # LLM이 개수를 그대로 보존했을 때만(입력=출력 1:1 대응이 보장될 때만) 캐시에 저장한다.
        # 개수가 달라지면(병합/누락) 어떤 출력이 어떤 입력에 대응하는지 알 수 없어, 잘못된
        # 캐시 항목이 다음 영수증의 정확도를 해칠 수 있으므로 이번 실행 결과만 쓰고 버린다.
        if len(llm_out_items) == len(misses):
            for miss_item, out_item in zip(misses, llm_out_items):
                _pass2_cache[_pass2_cache_key(miss_item)] = out_item
            _save_pass2_cache()

    # 원래 영수증 순서를 유지하며 캐시 적중 항목과 이번에 새로 받은 항목을 합친다.
    # (입력=출력 개수가 어긋나 대응 관계를 신뢰할 수 없을 때만 순서 없이 이어붙인다.)
    if len(llm_out_items) == len(misses):
        miss_cursor = 0
        combined_items = []
        for k in keys:
            if k in _pass2_cache:
                combined_items.append(_pass2_cache[k])
            else:
                combined_items.append(llm_out_items[miss_cursor])
                miss_cursor += 1
    else:
        combined_items = [_pass2_cache[k] for k in keys if k in _pass2_cache] + llm_out_items

    items = []
    seen = set()
    for it in combined_items:
        if isinstance(it, str):
            it = {"name": it, "qty": 1, "storage": "실온"}
        if not isinstance(it, dict):
            continue

        name = (it.get("name") or "").strip()
        name = re.sub(r'^\d+\s+', '', name).strip()
        name = re.sub(r'^[\w가-힣]+\)\s*', '', name).strip()
        name = re.sub(r'^\([^)]*\)\s*', '', name).strip()
        if not name or name in seen:
            continue

        seen.add(name)

        storage = (it.get("storage") or "").strip()
        if storage not in VALID_STORAGE:
            storage = "실온"

        VALID_CATEGORIES = {
            "채소류", "과일류", "육류", "수산물",
            "유제품·계란", "두부·콩류", "가공·즉석식품",
            "음료·주류", "양념·소스", "곡류·면류", "스낵·과자"
        }
                # 자주 틀리는 브랜드 보정
        BRAND_FIX = {
    "너티버섯": "느타리버섯", "너타리버섯": "느타리버섯",
    "햇잎": "깻잎", "핫잎": "깻잎",
    "베이비 덩기패": "비비고 된장찌개", "베이비덩기": "비비고 된장찌개",
    "고해밥스테이크": "고메함박스테이크", "고메밥스": "고메함박스테이크",
    "양반죽순": "양반죽", "양반죽쉬": "양반죽",
    "오두기밥": "즉석밥(오뚜기)", "오뚜기밥": "즉석밥(오뚜기)",
    "불가리수": "불가리스", "자숙새구": "자숙새우",
}
        for wrong, correct in BRAND_FIX.items():
            if wrong in name:
                name = name.replace(wrong, correct)
                break
        category_name = (it.get("category_name") or "").strip()
        if category_name not in VALID_CATEGORIES:
            category_name = None  # 유효하지 않으면 None

        # RAG-A(상품 마스터) — "좁은 안전망": 가공식품이 신선 카테고리로 오분류된
        # 경우만 보정한다. 손 큐레이션 마스터에 score>=0.80으로 정확 매칭되고,
        # 저장 카테고리가 신선인데 마스터 카테고리가 가공이면 마스터를 따른다.
        # (범용 override는 평가에서 정확도를 떨어뜨려 폐기 — raga-eval 참고)
        category_source = None
        if category_name in _FRESH_FOOD_CATEGORIES:
            _prod = lookup_product(name, min_score=0.80)
            if _prod and _prod["category_name"] not in _FRESH_FOOD_CATEGORIES:
                category_name = _prod["category_name"]
                category_source = f"rag_a:{_prod['name']}({_prod['score']})"

        use_by, use_by_evidence = calculate_use_by(name, storage, purchase_date, category_name=category_name)

        qty, unit, name = resolve_package_unit(name, it.get("qty"), (it.get("unit") or "").strip())

        items.append({
            "name": name,
            "category_name": category_name,   # ← 추가
            "category_source": category_source,   # rag_a로 보정됐으면 근거, 아니면 None
            "qty": qty,
            "unit": unit,
            "storage": storage,
            "use_by": use_by,
            "use_by_source": use_by_evidence.get("source"),
            "use_by_basis": use_by_evidence.get("basis"),
            "use_by_confidence": use_by_evidence.get("confidence"),
        })

    return items
// 부피 단위 -> ml 환산 비율 (한국 표준 계량 기준)
export const VOLUME_TO_ML = {
  '작은술': 5,
  '큰술': 15,
  '컵': 200,
  '종이컵': 180, // 표준 '컵'(200ml)과 구분되는 종이컵 기준
  'T': 15, // 영문 표기 레시피: T(Tablespoon)=큰술
  't': 5,  // 영문 표기 레시피: t(teaspoon)=작은술
  'ml': 1,
  'L': 1000,
};

// 무게 단위 -> g 환산 비율
export const WEIGHT_TO_G = {
  'g': 1,
  'kg': 1000,
};

// 개수형 단위: 무게/부피로 환산할 수 없다 (단, "개"로의 포장단위 환산은 PACKAGE_TO_COUNT로 별도 처리)
const COUNT_UNITS = new Set([
  '개', '알', '쪽', '모', '단', '봉', '줌', '대', '통', '판', '포기', '마리', '송이', '줄기', '다', '장',
  '톨', '조각', '캔', '병', '뿌리',
]);

// "개"와 1:1로 같은 의미인 단일 개체 표현 (묶음 단위 단/통/봉/판 등과는 다름 - 그건
// PACKAGE_TO_COUNT 비율표를 우선 적용한다). 여기 속한 단위는 비율 없이 그대로 통과시킨다.
const COUNT_UNIT_SYNONYMS = new Set([
  '개', '알', '톨', '쪽', '모', '마리', '조각', '캔', '병', '장', '줄기', '뿌리',
]);

// 식재료별 "포장단위 → 개" 환산 비율. ai/pipeline_common.py의 _PACKAGE_TO_COUNT와 동일한 기준을 써서
// 스캔 시 펜트리에 저장되는 개수와 레시피에서 차감하는 개수가 어긋나지 않게 한다.
export const PACKAGE_TO_COUNT = {
  '마늘':   { '통': 6, '쪽': 1 },
  '대파':   { '단': 6, '대': 1 },
  '파':     { '단': 6, '대': 1 },
  '쪽파':   { '단': 10, '대': 1 },
  '마늘쫑': { '단': 20, '줄기': 1 },
  '계란':   { '판': 30, '개': 1 },
  '달걀':   { '판': 30, '개': 1 },
  '두부':   { '모': 1 },
  '배추':   { '포기': 1 },
  '양배추': { '통': 1 },
  '양상추': { '포기': 1 },
  '브로콜리': { '송이': 1 },
  '바나나': { '송이': 6, '다': 6, '개': 1 },
  '다시마': { '장': 1 },
  '김':     { '봉': 10, '장': 1 },
  '고등어': { '마리': 1 },
  '갈치':   { '마리': 1 },
  '오징어': { '마리': 1 },
};

const _SORTED_PACKAGE_KEYS = Object.keys(PACKAGE_TO_COUNT).sort((a, b) => b.length - a.length);

// "파"/"김"처럼 1글자 키는 스파게티/파슬리/파마산이나 튀김/김치처럼 무관한 재료명에도 그
// 글자가 우연히 포함될 수 있다(server.js의 RESTRICTED_SHORT_INGREDIENTS와 동일한 문제 - 예:
// "스파게티"를 "단→개" 환산할 때 무관하게 파의 6배 비율이 걸릴 뻔했다). 더 구체적인 키(예:
// "쪽파")가 먼저 매칭되면 이 목록까지 안 내려가므로, 여기 등록된 무관 단어만 걸러낸다.
const SHORT_KEY_EXCLUSIONS = {
  '파': ['스파게티', '파슬리', '파마산', '파프리카', '파스타'],
  '김': ['튀김', '김치'],
};

const isShortKeyExcluded = (key, ingredientName) => {
  const excluded = SHORT_KEY_EXCLUSIONS[key];
  return excluded ? excluded.some(w => ingredientName.includes(w)) : false;
};

const findPackageRatio = (ingredientName, unit) => {
  if (!ingredientName) return null;
  const key = _SORTED_PACKAGE_KEYS.find(k => ingredientName.includes(k) && !isShortKeyExcluded(k, ingredientName));
  if (!key) return null;
  return PACKAGE_TO_COUNT[key][unit] ?? null;
};

// 재료(이름에 포함된 키워드 기준)별 g/ml 밀도 근사치. 미등록 재료는 부피<->무게 환산 불가.
export const DENSITY_G_PER_ML = {
  '물': 1.0,
  '식용유': 0.92,
  '올리브유': 0.92,
  '참기름': 0.92,
  '설탕': 0.85,
  '소금': 1.2,
  '간장': 1.15,
  '식초': 1.01,
  '우유': 1.03,
  '꿀': 1.42,
  '고추장': 1.15,
  '된장': 1.15,
  '케찹': 1.1,
  '마요네즈': 0.91,
  '머스타드': 1.0,
  '칠리소스': 1.1,
  '돈까스소스': 1.1,
  '굴소스': 1.2,
  '올리고당': 1.4,
  '물엿': 1.4,
  '스리라차': 1.1,
};

const _SORTED_DENSITY_KEYS = Object.keys(DENSITY_G_PER_ML).sort((a, b) => b.length - a.length);

const findDensity = (ingredientName) => {
  if (!ingredientName) return null;
  const key = _SORTED_DENSITY_KEYS.find(k => ingredientName.includes(k));
  return key ? DENSITY_G_PER_ML[key] : null;
};

// 부피/무게 개념이 아니라 그 자체로 무게 추정치인 소량 계량 단위 -> g 직접 환산
// (밀도 계산 불필요: "꼬집"은 부피로 잴 수 없고, "공기"는 조리된 음식 기준 어림값).
export const DIRECT_WEIGHT_G = {
  '꼬집': 1,
  '공기': 200,
};

// { qty, unit }을 targetUnit 기준 수량으로 환산한다. 환산 불가능하면 null을 반환한다
// (호출 측은 null일 때 보유량 전체를 기본값으로 폴백해야 한다).
export const convertQuantity = ({ qty, unit, targetUnit, ingredientName }) => {
  if (qty === null || qty === undefined || !Number.isFinite(qty)) return null;
  if (!unit || !targetUnit) return null;
  if (unit === targetUnit) return qty;

  // 포장단위(통/단/봉/마리 등) → "개" 환산: 식재료별 환산표에 등록된 경우만 허용.
  // 거기 없으면 "알/쪽/마리" 같은 단일 개체 동의어인지 확인해 비율 1로 통과시킨다.
  if (targetUnit === '개') {
    const ratio = findPackageRatio(ingredientName, unit);
    if (ratio !== null) return qty * ratio;
    if (COUNT_UNIT_SYNONYMS.has(unit)) return qty;
  }

  // "꼬집"/"공기"처럼 부피가 아니라 그 자체로 무게 추정치인 단위 → g 직접 환산
  if (targetUnit === 'g' && unit in DIRECT_WEIGHT_G) {
    return qty * DIRECT_WEIGHT_G[unit];
  }

  // 개수형 단위는 다른 단위와 절대 호환되지 않는다.
  if (COUNT_UNITS.has(unit) || COUNT_UNITS.has(targetUnit)) return null;

  const isVolume = (u) => u in VOLUME_TO_ML;
  const isWeight = (u) => u in WEIGHT_TO_G;

  if (isVolume(unit) && isVolume(targetUnit)) {
    const ml = qty * VOLUME_TO_ML[unit];
    return ml / VOLUME_TO_ML[targetUnit];
  }

  if (isWeight(unit) && isWeight(targetUnit)) {
    const g = qty * WEIGHT_TO_G[unit];
    return g / WEIGHT_TO_G[targetUnit];
  }

  if (isVolume(unit) && isWeight(targetUnit)) {
    const density = findDensity(ingredientName);
    if (density === null) return null;
    const g = qty * VOLUME_TO_ML[unit] * density;
    return g / WEIGHT_TO_G[targetUnit];
  }

  if (isWeight(unit) && isVolume(targetUnit)) {
    const density = findDensity(ingredientName);
    if (density === null) return null;
    const ml = (qty * WEIGHT_TO_G[unit]) / density;
    return ml / VOLUME_TO_ML[targetUnit];
  }

  return null;
};

// server.js의 nameMatches/SUBSTRING_FALSE_POSITIVES/RESTRICTED_SHORT_INGREDIENTS를 그대로
// 옮겨온 것이다. CookModal이 recipe.used_ingredients(이미 서버에서 펜트리와 검증된 재료명)를
// 가지고 "어느 펜트리 항목을 얼마나 차감할지" 다시 매칭할 때 쓰는데, 이 재매칭이 서버와 같은
// 보호 장치 없이 단순 양방향 substring만 쓰면 같은 종류의 오매칭이 재발한다(실사용 중 발견:
// "파"만 있어도 "스파게티"가 매칭돼 엉뚱한 항목의 수량이 깎일 뻔함). 두 파일이 완전히 분리된
// 런타임(Node 백엔드 / 브라우저 프론트엔드)이라 모듈을 공유할 수 없어 데이터만 그대로 복제했다 -
// server.js 쪽 목록을 고치면 여기도 같이 고쳐야 한다.

const SUBSTRING_FALSE_POSITIVES = {
  '쌀': ['쌀국수', '쌀가루', '쌀식초', '쌀 식초', '쌀뜨물', '멥쌀가루', '찹쌀가루'],
  '감자': ['감자 전분', '감자전분', '돼지감자', '감자탕용 돼지등뼈'],
  '고구마': ['고구마잎', '고구마줄기'],
  '닭고기': ['닭고기 육수'],
  '멸치': ['멸치액젓', '멸치젓'],
  '새우': ['새우젓', '새우젓국'],
  '오징어': ['갑오징어'],
  '양': ['양파', '양배추', '양상추', '양송이', '양념', '양귀비', '양지머리', '양겨자'],
  '김': ['김치', '튀김가루', '튀김기름'],
  '마': ['마늘', '마요네즈', '마스카포네', '마조람', '마지팬', '마카로니', '마사만', '마른'],
  '마늘': ['의성마늘 비엔나'],
  '고추': ['고추냉이'],
  '게': ['바게트', '스파게티', '스파게티 면', '스파게티면', '잘게 다진 마늘', '잘게 썬 몬테레이 잭 치즈'],
  '면': ['칠면조', '칠면조 다짐육', '칠면고'],
  '깨': ['돼지고기 어깨살', '양 어깨살'],
  '버터': ['버터 빈', '버터 빈 (흰 강낭콩)', '버터 빈(흰 강낭콩)', '버터 빈(흰강낭콩)'],
  '수수': ['고운 황옥수수가루', '백옥수수가루', '옥수수', '옥수수 또띠아', '옥수수 또르띠아',
           '옥수수 전분', '옥수수가루', '옥수수통조림', '찐옥수수 알갱이'],
  '팥': ['램 콩팥'],
  '갓': ['쑥갓'],
  '대추': ['대추야자', '씨를 제거한 대추야자'],
  '밥': ['김밥용김'],
  '배추': ['배추김치'],
  '열무': ['열무김치'],
  '전어': ['전어젓갈'],
};

const isSubstringFalsePositive = (shortName, longName) => {
  const badWords = SUBSTRING_FALSE_POSITIVES[shortName];
  return badWords ? badWords.some(w => longName.includes(w)) : false;
};

const RESTRICTED_SHORT_INGREDIENTS = {
  '파': ['파', '대파', '실파', '쪽파', '다진파', '다진 파', '다진대파', '다진 대파',
         '다진쪽파', '다진 쪽파', '파뿌리', '굵은파', '가는파', '통파', '육수용 대파', '미니 파'],
  '무': ['무', '단무지', '동치미무', '무,래디쉬', '무말랭이', '무순', '무즙', '무채', '순무',
         '스웨이드(서양 순무)', '열무', '육수용 무', '절임무', '총각무'],
  '배': ['배', '배즙'],
  '이스트': ['이스트', '드라이 이스트', '드라이이스트'],
};

const isRestrictedShortMatch = (shortName, longName) => {
  const allowlist = RESTRICTED_SHORT_INGREDIENTS[shortName];
  return allowlist ? !allowlist.includes(longName) : false;
};

// 사이시옷(받침 ㅅ) 표기 차이로 실제로는 같은 재료인데 substring으로 안 잡히는 쌍들
// (예: "고추"+"가루"→"고춧가루"). server.js의 SAISIOT_EQUIVALENTS와 동일하다 - 자세한 근거는
// 그쪽 주석 참고. 같은 패턴이어도 실제로 다른 식재료인 경우(예: "깨"→"깻잎")는 넣지 않는다.
const SAISIOT_EQUIVALENTS = {
  '고추': ['고춧가루', '고춧기름'],
  '후추': ['후춧가루'],
  '흰후추': ['흰후춧가루'],
  '배추': ['배춧잎'],
  '김치': ['김칫국물'],
  '멸치': ['멸칫국물'],
  '조개': ['조갯살'],
  '계피': ['계핏가루'],
  '들깨': ['들깻가루'],
};

const isSaisiotEquivalent = (shortName, longName) => {
  const variants = SAISIOT_EQUIVALENTS[shortName];
  return variants ? variants.includes(longName) : false;
};

// pantry/CookModal에서 쓰는 양방향 부분 문자열 매칭 (server.js의 nameMatches와 동일한 규칙,
// 유사도 안전망만 제외 - 여기서는 이미 서버가 검증한 깨끗한 이름끼리 비교하므로 오타 보정이
// 따로 필요 없다).
export const pantryNameMatches = (pantryName, ingredientName) => {
  if (isSaisiotEquivalent(pantryName, ingredientName) || isSaisiotEquivalent(ingredientName, pantryName)) {
    return true;
  }
  if (isSubstringFalsePositive(pantryName, ingredientName) || isSubstringFalsePositive(ingredientName, pantryName)) {
    return false;
  }
  if (isRestrictedShortMatch(pantryName, ingredientName) || isRestrictedShortMatch(ingredientName, pantryName)) {
    return false;
  }
  return pantryName.includes(ingredientName) || ingredientName.includes(pantryName);
};

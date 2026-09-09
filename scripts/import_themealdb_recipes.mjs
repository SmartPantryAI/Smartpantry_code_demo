// TheMealDB(https://www.themealdb.com/api.php, test key '1', 무료/비상업 등급)에서 해외 레시피를 가져와
// recipes / recipe_ingredients 테이블에 채운다. mafra(source_api='mafra')와 분리해 source_api='themealdb',
// external_id=idMeal로 저장하며, (source_api, external_id) UNIQUE 제약으로 재실행 시 중복 삽입을 막는다.
// 스토어 공개 배포 계획이 생기면 TheMealDB Patreon supporter 등록 여부를 재검토할 것(현재는 비상업/개인 사용).
// 사전 조건: scripts/migrate_recipe_source_schema.mjs 로 recipes 스키마를 먼저 마이그레이션해둘 것.
// 실행: docker exec smartpantry-web node scripts/import_themealdb_recipes.mjs
import mysql from 'mysql2/promise';

const BASE_URL = 'https://www.themealdb.com/api/json/v1/1';
const OLLAMA_URL = 'https://gemma.aikopo.net/v1/chat/completions';
const TRANSLATE_TIMEOUT_MS = 30000;

// TheMealDB strCategory 중 메인요리로 보지 않는 카테고리 (server.js buildRecipeCandidates의
// is_main_dish 필터와 맞춰야 한다 - 나머지 카테고리(Beef/Chicken/Seafood/Pasta/Vegetarian 등)는 메인요리로 간주).
const NON_MAIN_CATEGORIES = ['Dessert', 'Starter', 'Side', 'Breakfast', 'Miscellaneous'];

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
};

const listAreas = async () => {
  const data = await fetchJson(`${BASE_URL}/list.php?a=list`);
  return (data?.meals || []).map((m) => m.strArea).filter(Boolean);
};

const listMealsByArea = async (area) => {
  const data = await fetchJson(`${BASE_URL}/filter.php?a=${encodeURIComponent(area)}`);
  return data?.meals || null; // null이면 해당 지역 레시피 없음
};

const lookupMeal = async (idMeal) => {
  const data = await fetchJson(`${BASE_URL}/lookup.php?i=${encodeURIComponent(idMeal)}`);
  return data?.meals?.[0] || null;
};

// classifyCanonicalIngredient/polishRecipesWithLLM과 동일한 gemma4-e4b(vLLM, OpenAI 호환) 호출 패턴.
// 레시피당 1회, 제목+조리법+재료명+분량 전체를 한 번에 번역 요청한다.
const translateMealDbRecipe = async (meal) => {
  const ingredientPairs = [];
  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] || '').trim();
    const measure = (meal[`strMeasure${i}`] || '').trim();
    if (name) ingredientPairs.push({ name, measure });
  }

  const prompt = `다음 영어 레시피를 한국어로 번역해서 JSON으로만 출력하라.
- title: 레시피 제목 한국어 번역
- instructions: 조리법 한국어 번역(자연스러운 단계별 문장)
- ingredients: 각 재료를 { "name": "한국어 표준 재료명", "amount": 숫자 또는 null, "unit": "한국어 단위(개/g/ml/큰술/작은술/컵 등)" } 형태로 변환. 영어 분량 표기("3/4 cup", "1/2 teaspoon", "2", "1 (12 oz.)" 등)를 숫자+단위로 변환하되, 애매하면 amount를 null로 남겨라.
- 재료명은 가능하면 일반적인 한국 요리 재료명으로 번역하라(예: pork → 돼지고기, chicken breast → 닭가슴살, spring onion → 대파).

레시피: ${JSON.stringify({ title: meal.strMeal, instructions: meal.strInstructions, ingredients: ingredientPairs })}

다른 텍스트 없이 JSON만 출력하라: {"title": "...", "instructions": "...", "ingredients": [{"name": "...", "amount": ..., "unit": "..."}]}`;

  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4-e4b',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
  });
  const data = await res.json();
  // response_format:json_object로도 혹시 코드펜스가 섞여 나올 경우를 대비한 방어적 처리(다른
  // 호출부와 동일 패턴).
  const raw = (data?.choices?.[0]?.message?.content || '{}').trim();
  const fenceStripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(fenceStripped);
  if (!parsed.title || !parsed.instructions || !Array.isArray(parsed.ingredients)) {
    throw new Error('번역 결과에 필수 필드 누락');
  }
  return parsed;
};

const normalizeIngredientName = (name) => (name || '').trim().replace(/\s+/g, ' ');

const main = async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234',
    database: process.env.DB_NAME || 'smartpantry',
  });

  try {
    console.log('지역 목록 조회 중...');
    const areas = await listAreas();
    console.log(`지역 ${areas.length}개 조회 완료, 지역별 레시피 존재 여부 확인 중...`);

    // idMeal -> { strMeal, area } (여러 지역에 같은 idMeal이 나오는 경우 첫 지역만 기록)
    const mealsById = new Map();
    const areaMealCounts = new Map(); // 지역 -> filter.php에서 발견된 레시피 수(참고용)
    for (const area of areas) {
      const meals = await listMealsByArea(area);
      if (!meals) continue;
      areaMealCounts.set(area, meals.length);
      for (const m of meals) {
        if (!mealsById.has(m.idMeal)) mealsById.set(m.idMeal, { strMeal: m.strMeal, area });
      }
    }
    console.log(`레시피가 있는 지역 ${areaMealCounts.size}개, 중복 제거 후 총 idMeal ${mealsById.size}건`);
    for (const [area, count] of areaMealCounts) console.log(`  - ${area}: ${count}건`);

    const ingredientIdCache = new Map();
    const getIngredientId = async (name) => {
      if (ingredientIdCache.has(name)) return ingredientIdCache.get(name);
      await conn.query('INSERT IGNORE INTO ingredients (name) VALUES (?)', [name]);
      const [[row]] = await conn.query('SELECT id FROM ingredients WHERE name = ?', [name]);
      ingredientIdCache.set(name, row.id);
      return row.id;
    };

    const importedCountByArea = new Map();
    let imported = 0;
    let alreadyExists = 0;
    let failed = 0;

    for (const [idMeal, { strMeal, area }] of mealsById) {
      try {
        const [existing] = await conn.query(
          "SELECT id FROM recipes WHERE source_api = 'themealdb' AND external_id = ?",
          [idMeal]
        );
        if (existing.length > 0) { alreadyExists++; continue; }

        const meal = await lookupMeal(idMeal);
        if (!meal) { console.warn(`⚠️ 상세 조회 실패, 스킵: idMeal=${idMeal} (${strMeal})`); failed++; continue; }

        const translated = await translateMealDbRecipe(meal);
        const isMainDish = NON_MAIN_CATEGORIES.includes(meal.strCategory) ? 0 : 1;

        const [result] = await conn.query(
          `INSERT INTO recipes (title, description, cooking_time, difficulty, image_url, dish_type, is_main_dish, source_api, external_id)
           VALUES (?, ?, NULL, NULL, ?, NULL, ?, 'themealdb', ?)`,
          [translated.title.trim(), translated.instructions.trim() || null, meal.strMealThumb || null, isMainDish, idMeal]
        );
        const recipeId = result.insertId;

        for (const ing of translated.ingredients) {
          const name = normalizeIngredientName(ing.name);
          if (!name) continue;
          const amount = (ing.amount === null || ing.amount === undefined || ing.amount === '')
            ? null : Number(ing.amount);
          const unit = (ing.unit || '').trim() || null;
          const ingredientId = await getIngredientId(name);
          await conn.query(
            'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit, is_required) VALUES (?, ?, ?, ?, 1)',
            [recipeId, ingredientId, Number.isFinite(amount) ? amount : null, unit]
          );
        }

        imported++;
        importedCountByArea.set(area, (importedCountByArea.get(area) || 0) + 1);
      } catch (err) {
        console.warn(`⚠️ import 실패, 스킵: idMeal=${idMeal} (${strMeal}) - ${err.message}`);
        failed++;
      }
    }

    console.log('\n=== 지역별 실제 import 완료 건수 ===');
    for (const [area, count] of importedCountByArea) console.log(`  - ${area}: ${count}건`);
    console.log(`\n총 신규 import: ${imported}건`);
    console.log(`이미 존재(스킵): ${alreadyExists}건`);
    console.log(`실패(스킵): ${failed}건`);
    console.log(`신규 생성된 ingredients: ${ingredientIdCache.size}종(기존 재사용분 포함)`);
  } finally {
    await conn.end();
  }
};

main().catch((err) => {
  console.error('import 실패:', err);
  process.exit(1);
});

// mafra dish_type(TY_NM) 기반 is_main_dish 백필은 "요리유형"(조림/튀김/볶음 등 조리법)만 보고
// 판정했는데, 조리법과 "한 끼 식사로 충분한가"는 다른 축이다 - 조림/튀김이어도 반찬(예: 콩자반,
// 고추부각)이면 메인요리가 아니다(TheMealDB의 Vegetarian 카테고리 오분류와 동일한 종류의 문제,
// scripts/reclassify_themealdb_main_dish.mjs 참고). 이미 is_main_dish=1인 mafra 레시피만
// LLM에게 재판정시킨다 - 0으로 내리는 것만 허용하고 1로 올리는 방향은 하지 않는다.
// 실행: docker exec smartpantry-web node scripts/reclassify_mafra_main_dish.mjs
import mysql from 'mysql2/promise';

const LLM_URL = 'https://gemma.aikopo.net/v1/chat/completions';

const PROMPT = `너는 한국 가정식 기준으로 "이 요리가 혼자서 한 끼 식사가 될 만큼 충분한 메인요리인지"를 판단하는 AI다.
메인요리로 본다: 밥/면/빵 등 탄수화물이나 충분한 양의 단백질을 중심으로 한 요리, 볶음/찜/구이/탕/찌개/카레/파스타/샌드위치 등.
메인요리로 보지 않는다: 콩자반/장아찌/조림 밑반찬처럼 소량으로 곁들여 먹는 반찬, 부각/전 같은 간식성 튀김, 나물무침, 김치류, 소스만 곁들인 요리처럼 그것만으로는 한 끼가 되기 부족한 요리.
주어진 요리명/설명/재료 목록을 보고 JSON으로만 판단해서 출력한다: {"is_main_meal": true 또는 false}. 다른 텍스트는 절대 출력하지 않는다.`;

const classify = async (recipe) => {
  const userContent = JSON.stringify({
    name: recipe.title,
    description: (recipe.description || '').slice(0, 300),
    ingredients: recipe.ingredients,
  });
  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4-e4b',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: userContent },
      ],
      stream: false,
      temperature: 0,
      max_tokens: 50,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  const parsed = JSON.parse(raw);
  if (typeof parsed.is_main_meal !== 'boolean') throw new Error('is_main_meal 필드 누락/타입 오류');
  return parsed.is_main_meal;
};

const main = async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234',
    database: process.env.DB_NAME || 'smartpantry',
  });

  try {
    const [recipeRows] = await conn.query(
      "SELECT id, title, description FROM recipes WHERE source_api='mafra' AND is_main_dish=1"
    );
    console.log(`대상 ${recipeRows.length}건`);

    const [ingredientRows] = await conn.query(`
      SELECT ri.recipe_id, ing.name FROM recipe_ingredients ri
      JOIN ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.recipe_id IN (?)
    `, [recipeRows.map(r => r.id)]);
    const ingredientsByRecipe = new Map();
    for (const row of ingredientRows) {
      if (!ingredientsByRecipe.has(row.recipe_id)) ingredientsByRecipe.set(row.recipe_id, []);
      ingredientsByRecipe.get(row.recipe_id).push(row.name);
    }

    let downgraded = 0;
    let kept = 0;
    let failed = 0;
    for (const r of recipeRows) {
      const recipe = { title: r.title, description: r.description, ingredients: ingredientsByRecipe.get(r.id) || [] };
      try {
        const isMainMeal = await classify(recipe);
        if (!isMainMeal) {
          await conn.query('UPDATE recipes SET is_main_dish = 0 WHERE id = ?', [r.id]);
          downgraded++;
          console.log(`  ↓ ${r.title}`);
        } else {
          kept++;
        }
      } catch (err) {
        console.warn(`⚠️ 실패 id=${r.id} (${r.title}): ${err.message}`);
        failed++;
      }
    }
    console.log(`완료: 유지 ${kept}건, 강등(is_main_dish=0) ${downgraded}건, 실패(그대로 유지) ${failed}건`);
  } finally {
    await conn.end();
  }
};

main().catch((err) => {
  console.error('재분류 실패:', err);
  process.exit(1);
});

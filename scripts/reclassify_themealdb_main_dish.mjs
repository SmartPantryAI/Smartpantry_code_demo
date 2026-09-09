// TheMealDB strCategory 기반 is_main_dish 판정은 코스(Starter/Side/Dessert 등)와 식이(Vegetarian/
// Vegan 등) 기준이 섞여 있어서, "재료 카테고리는 메인답지만 실제로는 가벼운 곁들임 요리"인 경우를
// 못 걸러낸다(예: "참깨 간장 소스를 곁들인 연두부"가 Vegetarian으로 분류돼 is_main_dish=1로 남음).
// 이미 is_main_dish=1인 TheMealDB 레시피만 LLM에게 "한 끼 식사로 충분한 메인요리인가"를 물어서
// 재판정한다 - 0으로 내리는 것만 허용하고(NON_MAIN_CATEGORIES가 이미 명백한 건 걸러냈으므로),
// 1로 올리는 방향은 하지 않는다.
// 실행: docker exec smartpantry-web node scripts/reclassify_themealdb_main_dish.mjs
import mysql from 'mysql2/promise';

const LLM_URL = 'https://gemma.aikopo.net/v1/chat/completions';

const PROMPT = `너는 한국 가정식 기준으로 "이 요리가 혼자서 한 끼 식사가 될 만큼 충분한 메인요리인지"를 판단하는 AI다.
메인요리로 본다: 밥/면/빵 등 탄수화물이나 충분한 양의 단백질을 중심으로 한 요리, 볶음/찜/구이/탕/찌개/카레/파스타/샌드위치 등.
메인요리로 보지 않는다: 가벼운 두부/나물 반찬, 소스만 곁들인 단순 무침, 디핑소스, 애피타이저성 요리, 곁들임 채소 요리처럼 그것만으로는 한 끼가 되기 부족한 요리.
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
      "SELECT id, title, description FROM recipes WHERE source_api='themealdb' AND is_main_dish=1"
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

// TheMealDB에서 import된 recipes(source_api='themealdb')에 원본 strCategory를 재조회해서
// source_category 컬럼을 채운다. mafra 레시피는 대상이 아니다(그대로 NULL).
// 사전 조건: recipes.source_category 컬럼이 이미 있어야 한다(db/init.sql 참고, 라이브 DB는
// ALTER TABLE로 직접 추가했음).
// 실행: docker exec smartpantry-web node scripts/backfill_themealdb_category.mjs
import mysql from 'mysql2/promise';

const main = async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234',
    database: process.env.DB_NAME || 'smartpantry',
  });

  try {
    const [rows] = await conn.query(
      "SELECT id, external_id FROM recipes WHERE source_api='themealdb' AND source_category IS NULL"
    );
    console.log(`대상 ${rows.length}건`);

    let updated = 0;
    let failed = 0;
    for (const r of rows) {
      try {
        const res = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${r.external_id}`);
        const data = await res.json();
        const category = data?.meals?.[0]?.strCategory || null;
        if (category) {
          await conn.query('UPDATE recipes SET source_category = ? WHERE id = ?', [category, r.id]);
          updated++;
        } else {
          failed++;
        }
      } catch (err) {
        console.warn(`⚠️ 실패 id=${r.id} external_id=${r.external_id}: ${err.message}`);
        failed++;
      }
    }
    console.log(`완료: ${updated}건 업데이트, ${failed}건 실패`);

    const [dist] = await conn.query(
      "SELECT source_category, COUNT(*) AS cnt FROM recipes WHERE source_api='themealdb' GROUP BY source_category ORDER BY cnt DESC"
    );
    console.log('분포:', dist);
  } finally {
    await conn.end();
  }
};

main().catch((err) => {
  console.error('백필 실패:', err);
  process.exit(1);
});

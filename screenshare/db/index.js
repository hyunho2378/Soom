// Neon(Postgres) 연결과 스키마 멱등 적용.
// DATABASE_URL이 없으면 DB 없이도 서버가 그대로 뜬다(0단계에서 앱을 멈추게 하지 않는다).

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");

let pool = null;

// DATABASE_URL이 있을 때만 풀을 만든다. 연결 문자열의 sslmode는 pg가 그대로 해석한다.
function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on("error", (e) => console.error("DB 풀 오류:", e.message));
  return pool;
}

function isEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function query(text, params) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL이 없어 DB를 쓸 수 없습니다.");
  return p.query(text, params);
}

// 부팅 때 호출한다. 연결을 확인하고 schema.sql을 그대로 다시 돌린다.
// 실패해도 예외를 던지지 않고 false를 돌려준다. 화면 공유는 DB 없이도 돌아야 한다.
async function init() {
  if (!isEnabled()) {
    console.warn("DB 연결 안 함: DATABASE_URL이 비어 있습니다. .env를 채우면 기록물 영속화가 켜집니다.");
    return false;
  }
  const p = getPool();
  try {
    const { rows } = await p.query("SELECT current_database() AS db, version() AS version");
    console.log(`DB 연결 성공: ${rows[0].db} (${rows[0].version.split(",")[0]})`);
  } catch (e) {
    console.error("DB 연결 실패:", e.message);
    return false;
  }
  try {
    await p.query(fs.readFileSync(SCHEMA_FILE, "utf-8"));
    const { rows } = await p.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('users','records','record_files')
       ORDER BY table_name`
    );
    console.log(`스키마 적용 완료: ${rows.map((r) => r.table_name).join(", ") || "없음"}`);
    return true;
  } catch (e) {
    console.error("스키마 적용 실패:", e.message);
    return false;
  }
}

module.exports = { init, query, getPool, isEnabled };

-- 실시간 실습 모니터링 앱 스키마. 서버 부팅 때마다 그대로 다시 돌려도 안전하다.
-- 세션 테이블은 connect-pg-simple이 스스로 만들므로 여기 두지 않는다.

-- 강연자(구글 로그인 유저)만 저장한다. 체험자는 계정이 없다.
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  avatar_color  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기록물 한 건.
CREATE TABLE IF NOT EXISTS records (
  id             BIGSERIAL PRIMARY KEY,
  room           TEXT NOT NULL,
  author_name    TEXT NOT NULL,                -- 표시용 이름(체험자 포함)
  author_user_id BIGINT REFERENCES users(id),  -- 강연자가 올린 경우만 채운다
  item_code      TEXT NOT NULL,
  item_label     TEXT NOT NULL,                -- 서버 정본에서 채운다(클라 값 신뢰 금지)
  track          TEXT NOT NULL,                -- 'A' 또는 'B'
  summary        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_records_room ON records(room, created_at);

-- 기록물에 딸린 파일(이미지와 문서). 한 기록물에 여러 개가 붙는다.
CREATE TABLE IF NOT EXISTS record_files (
  id          BIGSERIAL PRIMARY KEY,
  record_id   BIGINT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  blob_url    TEXT NOT NULL,                   -- Vercel Blob 공개 URL
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  kind        TEXT NOT NULL,                   -- 'image' 또는 'document'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_record_files_record ON record_files(record_id);

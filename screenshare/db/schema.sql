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

-- 방. 강연자가 만들고 4자리 코드로 체험자를 받는다.
-- 실시간 상태는 서버 메모리에 두고, 이 표는 강연자가 새로고침했을 때 자기 코드를 되찾는 용도다.
CREATE TABLE IF NOT EXISTS rooms (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL,
  speaker_user_id BIGINT REFERENCES users(id),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rooms_active_code ON rooms(active, code);

-- 활성 코드가 겹치면 아래 유니크 인덱스를 못 만든다. 겹치면 오래된 쪽을 먼저 닫는다.
UPDATE rooms SET active = false, closed_at = now()
WHERE active = true AND id NOT IN (
  SELECT DISTINCT ON (code) id FROM rooms WHERE active = true ORDER BY code, created_at DESC, id DESC
);

-- 코드는 활성인 동안에만 유일하다. 발급 레이스를 DB가 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_active_code_unique ON rooms(code) WHERE active = true;

-- 기록물 한 건. 방 인스턴스를 room_id로 가리킨다.
-- 코드는 방을 닫으면 재사용될 수 있어서, 코드만 저장하면 옛 기록물이 새 방에 섞인다.
CREATE TABLE IF NOT EXISTS records (
  id             BIGSERIAL PRIMARY KEY,
  room_id        BIGINT NOT NULL REFERENCES rooms(id),
  author_name    TEXT NOT NULL,                -- 표시용 이름(체험자 포함)
  author_user_id BIGINT REFERENCES users(id),  -- 강연자가 올린 경우만 채운다
  item_code      TEXT NOT NULL,
  item_label     TEXT NOT NULL,                -- 서버 정본에서 채운다(클라 값 신뢰 금지)
  track          TEXT NOT NULL,                -- 'A' 또는 'B'
  summary        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 이미 room(TEXT 코드)으로 돌던 DB를 room_id로 옮긴다. 새 DB에서는 아무것도 하지 않는다.
-- 인덱스보다 먼저 와야 한다. 기존 DB에서는 이 블록이 끝나야 room_id가 생긴다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'records' AND column_name = 'room'
  ) THEN
    ALTER TABLE records ADD COLUMN IF NOT EXISTS room_id BIGINT REFERENCES rooms(id);
    -- 같은 코드를 여러 방이 썼다면 가장 최근 방으로 붙인다.
    UPDATE records r SET room_id = (
      SELECT ro.id FROM rooms ro WHERE ro.code = r.room ORDER BY ro.created_at DESC, ro.id DESC LIMIT 1
    ) WHERE r.room_id IS NULL;
    -- 가리킬 방이 사라진 기록물은 살릴 방법이 없다.
    DELETE FROM records WHERE room_id IS NULL;
    ALTER TABLE records ALTER COLUMN room_id SET NOT NULL;
    ALTER TABLE records DROP COLUMN room;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_records_room_id ON records(room_id, created_at);

-- 기록물에 딸린 파일(이미지와 문서). 한 기록물에 여러 개가 붙는다.
CREATE TABLE IF NOT EXISTS record_files (
  id          BIGSERIAL PRIMARY KEY,
  record_id   BIGINT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  blob_url    TEXT NOT NULL,                   -- Vercel Blob 공개 URL
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  kind        TEXT NOT NULL,                   -- 'image', 'markdown', 'document'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_record_files_record ON record_files(record_id);

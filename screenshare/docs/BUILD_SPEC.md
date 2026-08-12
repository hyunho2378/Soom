# BUILD_SPEC.md — 실시간 실습 모니터링 앱 확장 명세 v2

이 문서는 클로드 코드가 그대로 구현에 들어가기 위한 정본 명세다.
기존에 동작하는 화면 공유 + 실습 기록물 앱을 베이스로, 아래를 얹는다.

1. 구글 로그인(로그인한 사람 = 강연자, 나머지 = 이름만 입장)
2. 방 모델(4자리 코드 기반 입장, 방 이름 자유 입력 폐지)
3. 화면 공유를 N→1 격자 수신으로 개편(체험자 최대 10명 → 강연자가 격자로 봄)
4. NeonDB(Postgres) 연결(유저, 기록물, 세션, 방 영속화)
5. Vercel Blob 파일 저장(로컬 uploads 폐기, Render 재배포에도 파일 유지)
6. 기록물 파일 타입 확장(이미지 + PDF, HTML, docx, md, txt)
7. UI 확정 사항(버튼 위계, 항목 리스트, 카드 보더, 라벨)

---

## 절대 규칙

### 코드 규율 (CLAUDE.md 계승)
- 색, 간격은 public/style.css :root 토큰 경유. 새 색 하드코딩 금지.
- 시스템/네이티브 UI 전면 금지. 네이티브 select, OS 캘린더, 네이티브 체크박스, 네이티브 radio 쓰지 마라. 역할, 항목 선택은 커스텀 마크업. 예외는 구글 로그인 시 뜨는 구글 자체 화면뿐(우리 앱 밖).
- 이모지, 가운데점, 줄표 금지. 아이콘은 인라인 SVG. 라벨은 능동태 한국어.
- 디자인, 모션은 .claude/skills/apple-design, make-interfaces-feel-better 기준.
- 변경 줄은 요청과 직접 연결. 단계마다 실제 서버 띄워 검증하고 docs/PROGRESS.md에 기록.

### 배포/런타임 규율 (실제로 터진 문제에서 나온 것들)

**WebSocket URL**: 반드시 location.protocol 기반으로 자동 판별한다.
```js
const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
```
ws:// 또는 wss:// 를 하드코딩하지 마라. 로컬(http)과 배포(https) 둘 다 돌아야 한다. 이걸 어기면 배포 환경에서 mixed content로 WebSocket이 조용히 차단돼, 에러 없이 화면 공유가 검정으로만 나온다.

**pg BIGSERIAL 문자열 비교**: pg는 BIGSERIAL을 문자열로 반환한다("41", 41이 아님). 사용자 ID 비교는 반드시 String() 변환 후 비교한다. sameUser(a, b) 같은 헬퍼를 하나 만들어 전역으로 쓰고, === 로 직접 비교하지 마라. 이걸 어기면 서버 재기동 시 강연자가 viewer로 강등돼 화면 공유가 조용히 거절된다(에러 로그 없이).

**환경변수 로딩**: Node 내장 플래그로 한다.
```
node --env-file-if-exists=.env server.js
```
dotenv 패키지는 설치하지 마라. package.json의 start 스크립트를 이 형식으로. Render에는 .env 파일이 없으므로 --env-file-if-exists(없으면 무시)를 쓴다. Render 환경변수는 대시보드에서 직접 등록하며, process.env에 자동 주입된다.

**Express trust proxy**: Render는 리버스 프록시 뒤에서 돈다. 이게 없으면 세션 쿠키 secure가 동작하지 않고, req.protocol이 항상 http로 잡힌다.
```js
app.set('trust proxy', 1);
```

---

## 전체 아키텍처

```
[브라우저]
   | https://앱.onrender.com
   v
[Render: Express + ws]  <- 유일한 배포처. 정적 + REST + WebSocket 시그널링
   |-- NeonDB(Postgres)   유저, 방, 기록물 메타, 세션
   |-- Vercel Blob        기록물 파일(이미지/PDF/docx/html/md/txt)
   +-- Google OAuth       강연자 로그인 시에만
```

- 실시간 룸 상태(참가자, WebRTC 연결)는 서버 메모리(Map)에 둔다. DB는 영속 데이터용이지 시그널링용이 아니다.
- 영상은 P2P라 서버, DB, Blob 어디도 안 거친다.
- PRACTICE_ITEMS(실습 항목 17개)는 server.js에 하드코딩으로 유지한다. 항목 변경 시 코드 수정 후 재배포. DB로 옮기지 않는다(변경 빈도가 낮고 관리 UI를 만드는 비용이 이득보다 크다).

---

## 역할 모델

| 역할 | 되는 법 | 권한 |
| --- | --- | --- |
| 강연자 | 구글 로그인 후 방 만들기 | 자기 화면 공유(시범, 체험자에게), 체험자 화면 격자 수신, 기록물 초기화, 방 종료 |
| 체험자 | 4자리 코드 + 이름으로 입장 | 자기 화면을 강연자에게 공유, 기록물 올리기 |

- 한 방의 강연자는 한 명. 이미 speaker가 있으면 뒤에 온 로그인 유저는 거절하고 사유를 UI로 알린다.
- "구글 로그인 = 강연자"가 약속이다. 화이트리스트는 이번 범위 밖(추후 확장 훅만 남긴다: ADMIN_EMAILS 환경변수가 있으면 그 메일만 speaker 허용, 비어 있으면 모든 로그인 유저 허용).

---

## 방 모델 (코드 기반 입장)

방 이름을 사람이 자유 입력하면 오타, 대소문자, 표기 차이로 다른 방에 흩어진다. 방은 강연자가 만들고, 체험자는 4자리 코드로만 들어온다. "방 이름"이라는 개념은 이 앱에 존재하지 않는다.

### 규칙
- 강연자(구글 로그인)만 방을 만든다. 만들면 서버가 4자리 숫자 코드를 발급한다(1000~9999, 선행 0 없음).
- 강연자당 활성 방은 하나. 새로 만들면 이전 방은 종료되고 코드가 폐기된다.
- 체험자는 코드 4자리 + 이름만 입력해 입장한다. 로그인 없음.
- 유효하지 않은 코드는 즉시 거절("그런 방이 없습니다"). 종료된 방 코드도 거절.
- 강연자가 나가거나 방을 닫으면 그 방 체험자 전원에게 "방이 종료되었습니다"를 WS로 통지하고, 체험자 화면에 종료 안내 오버레이를 띄운 뒤 연결을 정리한다.
- 강연자가 새로고침해도 GET /api/my-room으로 자기 활성 방 코드를 복구한다.

### 코드 발급
- 1000~9999 범위 랜덤. 발급 시 현재 활성 방들의 코드와 겹치지 않을 때까지 재추첨.
- DB에 partial unique index(active=true일 때만 code 유일)로 레이스 컨디션 방지.

### 방 상태 저장
- 인메모리 rooms Map(code -> { code, speakerUserId(String), speakerWsId, clients Map, createdAt })에 실시간 상태. speakerUserId는 반드시 String으로 저장(pg BIGSERIAL 규칙).
- DB rooms 테이블에 영속화(재기동 복구용).

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL,
  speaker_user_id BIGINT REFERENCES users(id),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rooms_active_code ON rooms(active, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_active_code_unique ON rooms(code) WHERE active = true;
```

### API / 라우트
- POST /api/rooms : 강연자 전용(세션 필요). 기존 활성 방 있으면 종료 처리 후 새 코드 발급, 반환 { code }.
- POST /api/rooms/close : 강연자 전용. 자기 방 종료. 체험자 전원 WS 통지.
- GET /api/rooms/:code : 코드 유효성 확인(체험자 입장 전 검사). active면 { ok:true }, 아니면 404.
- GET /api/my-room : 강연자 새로고침 시 자기 활성 방 코드 복구.

### 첫 화면 분기

체험자가 다수이므로 체험자 입장이 메인이다. 역할을 먼저 묻지 않고, 도착 경로와 로그인 상태로 자동 분기한다.

로그인 안 된 상태(첫 진입):
- 메인 버튼(파란 배경 + 흰 텍스트): "참여 코드로 입장하기" -> 누르면 코드 4자리 + 이름 입력 폼.
- 서브 버튼(흰 배경 + 파란 테두리 + 파란 텍스트, 아래): "구글로 로그인하기" -> /auth/google 이동.
- 안내 문구: "강연자는 구글로 로그인해 방을 만듭니다. 체험자는 강연자가 알려준 코드로 들어옵니다."

로그인된 상태:
- "OOO님으로 강연자 입장" + "방 만들기" 버튼. 방 만들면 코드 4자리를 크게 표시("이 코드를 체험자에게 알려주세요").
- "코드 새로 받기"(기존 방 종료 후 새 코드), "방 종료하기", "로그아웃".

체험자 코드 입장:
- 코드 4자리 입력 + 이름 입력 + "입장하기" 버튼.
- 코드가 유효하지 않으면 즉시 "그런 방이 없습니다" 인라인 안내.

강연자 화면의 코드 표시:
- 코드를 크게(빔프로젝터에서 보일 크기), 커스텀 UI로. QR은 이번 범위 밖(추후 확장 훅만).

---

## 1. NeonDB 스키마

Postgres. 마이그레이션은 db/schema.sql 한 파일로 만들고, 서버 부팅 시 CREATE TABLE IF NOT EXISTS로 멱등 적용한다.

```sql
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  avatar_color  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL,
  speaker_user_id BIGINT REFERENCES users(id),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rooms_active_code ON rooms(active, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_active_code_unique ON rooms(code) WHERE active = true;

CREATE TABLE IF NOT EXISTS records (
  id             BIGSERIAL PRIMARY KEY,
  room_id        BIGINT NOT NULL REFERENCES rooms(id),
  author_name    TEXT NOT NULL,
  author_user_id BIGINT REFERENCES users(id),
  item_code      TEXT NOT NULL,
  item_label     TEXT NOT NULL,
  track          TEXT NOT NULL,
  summary        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_records_room_id ON records(room_id, created_at);

CREATE TABLE IF NOT EXISTS record_files (
  id            BIGSERIAL PRIMARY KEY,
  record_id     BIGINT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  blob_url      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  kind          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

핵심 변경: records.room(TEXT, 4자리 코드) 대신 records.room_id(FK -> rooms.id)로 바꿨다. 코드가 종료 후 재사용될 수 있어, 코드만 저장하면 옛 기록물이 새 방에 섞인다. room_id FK로 방 인스턴스를 정확히 가리킨다.

- kind 값: 'image' | 'markdown' | 'document'
- 세션 테이블은 connect-pg-simple이 자동 생성한다.
- 접속: pg 패키지 Pool + DATABASE_URL(Neon 연결 문자열).
- 기존 data/records.json 영속화 코드는 제거하고 DB로 대체한다.
- roomRecords 인메모리 Map은 유지하되, 부팅 시 DB에서 로드한다. 키는 room_id(Number가 아닌 String으로 저장, pg BIGSERIAL 규칙).

---

## 2. 구글 OAuth (강연자 로그인)

바닐라 Express 표준 스택으로 간다. 새 인증 프레임워크 도입 금지.

패키지: passport, passport-google-oauth20, express-session, connect-pg-simple

세션 설정:
```js
app.set('trust proxy', 1);
session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
})
```
trust proxy, secure, sameSite가 빠지면 Render(HTTPS + 리버스 프록시)에서 세션이 안 붙는다.

라우트:
- GET /auth/google : 구글 동의 화면으로 리다이렉트(scope: profile, email)
- GET /auth/google/callback : 코드 검증 -> users에 upsert(google_id 기준) -> 세션에 user 저장 -> / 로 리다이렉트
- POST /auth/logout : 세션 파기
- GET /api/me : 현재 세션 유저 반환(없으면 { user: null }). 클라가 입장 화면에서 이걸로 로그인 상태 판단.

WebSocket join 시 역할 확정:
- 서버는 ws 업그레이드 시 세션을 읽어(같은 express-session 미들웨어 공유) 로그인 유저면 role=speaker 후보, 아니면 role=viewer.
- join 메시지에 role을 클라가 실어 보내되, 서버가 세션으로 재검증한다. 클라가 speaker를 참칭해도 세션 없으면 viewer로 강등.
- 사용자 ID 비교 시 반드시 sameUser 헬퍼 사용(String 변환 비교). === 직접 비교 금지.

확장 훅(구현만 비워둠): ADMIN_EMAILS 환경변수(콤마 구분)가 있으면, 그 메일만 speaker 허용. 비어 있으면 지금 동작(로그인=강연자). 코드에 자리만 만들고 기본은 빈 값.

---

## 3. 화면 공유 N->1 격자 개편 (가장 큰 작업, 마지막에)

현재는 broadcaster 1명 -> viewer N명(1->N). 이걸 두 방향으로 재구성한다.

- 체험자 -> 강연자 (N->1): 각 체험자가 자기 화면을 강연자에게만 publish. 강연자는 최대 10개 수신해 격자로 표시.
- 강연자 -> 체험자 (1->N): 강연자가 자기 화면을 전체 체험자에게 publish(시범). 기존 1->N 로직 재활용.
- 동시성: 강연자가 시범 공유(1->N)하면서 동시에 체험자 화면을 격자로 받을(N->1) 수 있다. 두 방향은 독립된 PeerConnection 세트로 동작한다.

### 시그널링(server.js ws) 변경
- 방 상태에 speakerId 저장(기존 broadcasterId 개념 재사용/개명).
- 체험자가 "내 화면 공유 시작"하면: 서버가 그 체험자에게 speakerId를 알려주고, 체험자가 speaker를 향해 offer를 만든다(체험자가 발신자). speaker가 answer.
- speaker는 체험자별 수신 PC를 Map으로 관리(viewerPublishers Map: viewerId -> RTCPeerConnection).
- 체험자가 나가거나 공유 중지하면 해당 PC 정리 + 격자에서 제거.
- 강연자 시범 공유는 기존 경로 유지(speaker -> 각 viewer에게 offer).

### 클라(app.js) 변경
- 역할 분기: speaker면 격자 수신 UI, viewer면 "내 화면 공유하기" 버튼 + 강연자 시범 화면 보기.
- 체험자가 자기 화면 공유하면, 보내는 중에도 자기 뷰어 자리에 로컬 미리보기 + "내 화면을 보내는 중" 배지를 보여준다.

### speaker 격자 상세
- 들어오는 트랙마다 셀 추가. 셀에 체험자 이름 라벨.
- 격자 열 수 자동: 1명이면 크게, 2~4명 2열, 5~10명 3열. 반응형.
- 셀 클릭 시 확대: 확대된 셀이 격자 전체 크기를 차지. 다른 셀은 아래에 작은 스트립으로 남김. ESC 또는 확대 셀 재클릭으로 격자 복귀.
- 전체화면 토글: 격자 영역만 전체화면(빔프로젝터). 전체화면 중에도 탭 전환은 ESC로 전체화면 해제 후 가능.
- 빈 슬롯: 아무도 공유 안 하면 "아직 화면을 보내는 체험자가 없습니다" 안내.
- 수신 상한 10. 초과 체험자가 공유 시도하면 WS로 "현재 공유 가능 인원이 꽉 찼습니다" 거절 메시지. 체험자 화면에 안내 표시. 대기열 자동 진입은 이번 범위 밖.

### 성능 가드 (필수)
- getDisplayMedia 제약: frameRate: { max: 8 }, width: { max: 1280 }. 격자에선 작게 보이므로 충분.
- contentHint: 실측으로 'detail' 또는 'motion' 택1. 문서, 코드 화면이면 'detail'이 선명.
- 라이브 영상 위에는 liquidGL 금지. 셀 라벨, 칩은 backdrop-filter로.

### 모바일 체험자 대응
getDisplayMedia는 iOS Safari에서 지원하지 않고, 안드로이드에서도 제한적이다. 체험자 화면에서 모바일 감지 시(navigator.maxTouchPoints, screen 크기):
- "내 화면 공유하기" 버튼 비활성 + "화면 공유는 PC에서만 가능합니다" 안내.
- 기록물 올리기 등 다른 기능은 정상 사용.

### 강연자 브라우저 종료/크래시 시
강연자의 WebSocket이 끊기면 모든 체험자의 수신 PC도 닫힌다(ICE disconnected). 서버는 강연자 ws close 이벤트에서:
- 해당 방의 모든 체험자에게 "강연자 연결이 끊겼습니다" WS 통지.
- 체험자 화면에 재연결 대기 안내 표시.
- 강연자가 새로고침으로 돌아오면 GET /api/my-room으로 방 복구, 체험자들은 다시 공유 시작.

### 주의
이 개편은 기존 "발표자 1명" 데모 흐름을 크게 바꾼다. 앞 단계(로그인, DB, 파일)가 안정된 뒤 마지막에 착수하고, 착수 전 현재 P2P 코드를 그대로 백업 브랜치로 남긴다.

---

## 4. Vercel Blob 파일 저장

- 패키지: @vercel/blob. 어느 서버에서나 토큰만 있으면 동작(호스팅을 Vercel로 옮길 필요 없음).
- multer를 디스크 저장에서 memoryStorage로 바꿔 버퍼를 받는다.
- 메모리 제한 필수: limits: { fileSize: 15 * 1024 * 1024, files: 10 }. Render 무료 플랜 RAM은 512MB라, 이 제한 없이 대용량 동시 업로드가 오면 서버가 죽는다.
- 업로드 흐름: 파일 버퍼 -> put(filename, buffer, { access: 'public', addRandomSuffix: true }) -> 반환 URL을 record_files.blob_url에 저장. 파일당 순차 업로드 후 버퍼 참조를 즉시 해제한다.
- 기존 로컬 uploads/ 서빙과 디스크 저장 코드는 제거. .gitignore의 uploads/ 항목도 정리.
- 기록물 초기화(reset) 시 record_files에서 blob_url 목록을 뽑아 @vercel/blob의 del(url)로 Blob에서도 삭제한다. "(가능 시)"가 아니라 반드시 한다.
- 환경변수 BLOB_READ_WRITE_TOKEN.

---

## 5. 기록물 파일 타입 확장

허용 타입과 카드 표시:

| 종류 | mime / 확장자 | kind | 카드 표시 |
| --- | --- | --- | --- |
| 이미지 | image/* (png jpg webp gif) | image | 썸네일 4:3 cover + 라이트박스(contain, 이전/다음, 장수) |
| 마크다운 | text/markdown (.md) | markdown | 카드 안에서 바로 렌더(제목, 목록, 코드블록). 긴 문서는 접힌 상태로 "전체 보기" 버튼. 원본 HTML 이스케이프 후 안전 렌더. 가벼운 파서 사용 |
| PDF | application/pdf | document | SVG 아이콘 + 파일명 + 용량 + "미리보기"(새 탭) + "내려받기" |
| 워드 | application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx) | document | SVG 아이콘 + 파일명 + 용량 + "내려받기"(브라우저 인라인 미리보기 불가) |
| HTML | text/html (.html) | document | SVG 아이콘 + 파일명 + 용량 + "새 탭에서 열기" + "내려받기". 앱 안에서 직접 렌더하지 말 것(보안) |
| 텍스트 | text/plain (.txt) | document | SVG 아이콘 + 파일명 + 용량 + "열기"(새 탭) + "내려받기" |

- mime + 확장자 이중 검증. 목록 밖 타입은 거절.
- 장당 상한: 이미지 5MB, 문서 15MB. 한 기록물 첨부 최대 10개.
- 파일 종류별 인라인 SVG 아이콘을 만든다(PDF 빨강, DOC 파랑, HTML 주황, TXT 회색, MD 보라 등). 네이티브 아이콘 폰트 금지, 우리 SVG.
- 서버 검증은 이중 방어. item_label, track은 서버 정본(PRACTICE_ITEMS)에서만.

---

## 6. UI 확정 사항 (이미 결정됨, 스펙대로 구현)

### 6-1. 첫 화면 버튼 위계 뒤집기
체험자가 다수이므로 코드 입장이 메인이다.
- 메인 버튼(파란 배경 + 흰 텍스트): "참여 코드로 입장하기". 위치 맨 위.
- 서브 버튼(흰 배경 + 파란 테두리 + 파란 텍스트): "구글로 로그인하기". 아래.

### 6-2. 실습 항목: 항상 펼쳐진 선택 리스트
- 드롭다운을 없앤다. 클릭해야 열리는 방식 제거.
- 트랙 A / 트랙 B 항목 전체를 폼 안에 항상 보이는 선택 리스트로 펼친다.
- 각 항목은 하나만 선택 가능(라디오 방식). 선택된 항목은 트랙 색으로 시각 표시.
- 네이티브 radio/select 쓰지 말고 커스텀 마크업으로.
- 17개라 세로로 길다. 리스트 영역에 max-height + 스크롤 적용. 트랙 A / 트랙 B를 시각적으로 구분(그룹 헤더).
- 선택은 필수. 안 고르면 올리기 불가(기존 검증 유지).

### 6-3. 기록물 카드 좌측 보더 삭제
- 카드 왼쪽 파란/주황 세로 4px 액센트 보더를 없앤다.
- 트랙 구분은 배지 색으로만. border-left로 트랙을 표시하지 않는다.

### 6-4. md 카드 "펼치기" 라벨 변경
- "펼치기"를 "전체 보기"로 변경. 접힌 상태로 돌리는 버튼은 "접기".

### 6-5. 파일 미리보기/다운로드 대응
- 이미지: 썸네일 + 라이트박스(기존).
- PDF: 새 탭 미리보기 + 다운로드 링크.
- HTML, txt: 새 탭 열기 + 다운로드 링크.
- docx: 다운로드 링크만(브라우저 인라인 미리보기 불가).
- md: 카드에서 바로 렌더 + 전체 보기/접기 + 원본 다운로드 링크.
- 각 파일에 종류별 SVG 아이콘 + 파일명 + 용량 표시.

---

## 7. 로깅 전략

배포 환경에서 디버깅이 가능해야 한다. 최소한의 운영 로그를 넣는다.

```
[WS] type:join from:clientId room:code role:speaker
[WS] type:offer from:A to:B room:code
[WS] type:start-publish from:clientId room:code -> accepted|rejected(사유)
[Room] created code:7280 speaker:userId
[Room] closed code:7280
[Room] join code:7280 name:이름 role:viewer
[Room] leave code:7280 clientId
[Auth] login userId:41 email:xxx
[Auth] role speaker|viewer userId room:code
[API] POST /api/records room_id:12 files:3
[API] POST /api/records/reset room_id:12 deleted:5records 8files
[API] error route:path status:code message
```

- console.log 레벨로 통일. Render Logs에서 필터 가능하게 태그 접두사.
- 요청 본문, 파일 내용, 세션 토큰은 찍지 마라(개인정보/보안).
- WebRTC offer/answer/ice 본문(SDP)은 찍지 마라(너무 큼). 타입과 from/to만.

---

## 8. WebSocket 재연결

강의 중 와이파이 깜빡이면 체험자 전원이 재접속해야 하는 걸 방지한다.

클라(app.js):
- ws.onclose 시 지수 백오프로 자동 재연결(1s, 2s, 4s, 최대 30s).
- 재연결 성공 시 join 메시지 재전송(기존 이름, 코드, 역할 유지) + records-init 재수신.
- UI에 "연결이 끊겼습니다. 재연결 중..." 상태 바 표시. 재연결 성공 시 자동 숨김.
- 10회 연속 실패 시 "연결할 수 없습니다. 새로고침하세요." 안내 + 재시도 버튼.
- 재연결 중에는 기록물 올리기 버튼 비활성(REST는 되지만 WS 브로드캐스트를 못 받으므로).

서버(server.js):
- 같은 클라이언트(같은 이름 + 같은 역할)가 재입장하면, 이전 stale 연결이 남아있으면 정리하고 새 연결을 그 자리에 넣는다.

---

## 9. 헬스 체크

```
GET /health -> { ok: true, db: 'connected'|'disconnected', rooms: 활성방수, uptime: seconds }
```

Render 대시보드의 Health Check Path에 /health를 등록한다. 이게 있으면 Render가 서비스 상태를 정확히 판단해 불필요한 재기동을 줄인다.

---

## 구현 순서 (문서는 통합, 작업은 이 게이트대로)

각 단계 끝에서 실제 서버를 띄워 검증하고 통과해야 다음으로 간다.

### 0단계: 배선
패키지 설치(pg, passport, passport-google-oauth20, express-session, connect-pg-simple, @vercel/blob). .env.example 작성. db/schema.sql 멱등 적용 코드. 부팅 시 DB 연결 확인 로그. /health 엔드포인트. start 스크립트를 node --env-file-if-exists=.env server.js 로 변경. sameUser 헬퍼 작성.

검증: 서버 부팅 시 DB 연결 성공 로그, 테이블 생성 확인, GET /health 200.

### 1단계: 로그인
OAuth 라우트 + /api/me + 세션(Neon 저장, trust proxy, secure cookie). 입장 화면에 강연자/체험자 분기(6-1 위계 반영: 코드 입장이 메인, 구글이 서브).

검증: 구글 로그인 왕복 성공, 새로고침 후 세션 유지, 재기동 후 세션 유지, 로그아웃 동작. 배포(HTTPS) 환경에서도 세션이 붙는지 반드시 확인.

### 1.5단계: 방 모델
rooms 테이블(partial unique index 포함) + 코드 발급/검증 API + 첫 화면 코드 입장 폼 + 강연자 코드 표시 + 방 종료 통지. 시그널링 room 키를 rooms.id 기반으로 통일.

검증: 강연자가 방 만들면 코드 발급, 체험자가 코드+이름으로 정확히 그 방 입장, 틀린 코드 거절, 강연자 새로고침 시 코드 유지, 방 종료 시 체험자 통지 + 종료 오버레이, Render Logs에 [Room] 로그 찍힘.

### 2단계: 파일 저장 교체
multer memory(limits 포함) + Blob put + record_files DB 저장. 기존 이미지 업로드가 Blob으로 감. 초기화 시 Blob del.

검증: 이미지 올리면 Blob URL 반환 + 카드 표시, 로컬 uploads/ 미생성, 서버 재기동 후에도 이미지 보임, 초기화 후 Blob에서도 삭제 확인.

### 3단계: 파일 타입 확장
PDF, docx, html, md, txt 허용 + 문서 카드 분기 + SVG 아이콘 + 미리보기/다운로드. md 카드 렌더 + "전체 보기"/"접기". 실습 항목 항상 펼침 리스트(6-2). 카드 좌측 보더 삭제(6-3).

검증: PDF 올려 아이콘 + 새 탭 미리보기 + 다운로드 정상. md 올려 카드 렌더 + 전체 보기 동작. docx 내려받기. 잘못된 타입(exe 등) 거절. 항목 항상 보임 + 하나만 선택 가능. 카드 좌측 보더 없음.

### 4단계: 기록물 DB 이전
records + record_files를 DB로. records-init을 DB에서 로드(room_id FK 기준), record-added는 DB 저장 후 WS 브로드캐스트. reset은 DB 삭제 + Blob 삭제.

검증: 재기동 후 기록물 유지, 실시간 브로드캐스트 그대로, 같은 코드가 재사용돼도 옛 기록물 안 섞임.

### 5단계: 화면 공유 N->1 격자
시그널링 역방향 + speaker 격자 + 성능 가드 + 모바일 감지 + 초과 인원 거절 + 강연자 시범 동시성. 착수 전 현재 코드 백업 브랜치.

검증: 체험자 3~4개 동시 공유가 강연자 격자에 뜸, 강연자 시범 공유가 체험자에게 보임, 한 명 나갈 때 셀 제거, 셀 클릭 확대/복귀, 전체화면, 초과 인원 거절 메시지, 강연자 새로고침 시 방 복구 후 체험자 재공유 가능, 실인원 리허설. ws/wss 자동 판별 확인(배포 환경).

### 6단계: 디자인 디벨롭
앞서 만든 점검 목록 + 계획대로 격자 포함 전체 UI 폴리시. apple-design, make-interfaces 적용. 로깅 전략 적용. WS 재연결 구현.

검증: 반응형(860/420) 안 깨짐, reduced-motion, 프레스 피드백(:active), 포커스 표시, 재연결 테스트(와이파이 끄고 켜기). Render Logs에 로그 찍히는지.

각 단계는 독립 커밋. 5단계는 별도 브랜치에서 하고 검증 후 병합.

---

## 환경변수

```
DATABASE_URL=            # Neon 연결 문자열 (sslmode=require)
SESSION_SECRET=          # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=     # 로컬: http://localhost:3000/auth/google/callback
                         # Render: https://앱.onrender.com/auth/google/callback
BLOB_READ_WRITE_TOKEN=
ADMIN_EMAILS=            # 비워둠(추후 화이트리스트)
NODE_ENV=                # Render만: production. 로컬은 비움.
PORT=                    # Render가 자동 주입. 로컬 .env에는 PORT=3000.
                         # Render 대시보드에는 PORT를 등록하지 마라.
```

로컬은 .env(node --env-file-if-exists로 로드), Render는 대시보드 환경변수.
.env는 절대 커밋 금지(.gitignore 확인).
GOOGLE_CALLBACK_URL만 로컬과 Render 값이 다르다.
NODE_ENV는 Render에만 등록(세션 쿠키 secure 판단용). 로컬에는 넣지 않는다.

---

## 네가 대시보드에서 직접 해야 할 것

1. Neon: 프로젝트/DB 생성 -> 연결 문자열(DATABASE_URL) 확보.
2. Google Cloud Console: 프로젝트 생성 -> OAuth 동의 화면(외부, 앱 이름, 이메일) -> 사용자 인증 정보에서 OAuth 클라이언트 ID(웹) 생성 -> 승인된 리디렉션 URI에 로컬 + Render 콜백 둘 다 등록 -> client id/secret 확보.
   - http://localhost:3000/auth/google/callback
   - https://앱주소.onrender.com/auth/google/callback
3. Vercel: Blob Store 생성 -> BLOB_READ_WRITE_TOKEN 발급.
4. Render: 저장소 연결 -> Build: npm install, Start: npm start -> 환경변수 전부 등록(NODE_ENV=production 포함, PORT 제외).
5. Render: Settings -> Health Check Path에 /health 등록.
6. 위 값들을 로컬 .env에도 넣어 로컬에서 먼저 검증.

---

## 리스크와 명시적 결정

- P2P 10개 수신은 대체로 되지만 강연자 기기와 강의실 네트워크에 좌우된다. 성능 가드(저프레임, 저해상도, 수신 상한 10)를 반드시 넣고, 실인원 리허설 필수. 한계 시 LiveKit 등 SFU로 교체할 수 있게 미디어 계층을 분리해 둔다.
- Render 무료 플랜은 유휴 시 잠들어 첫 접속이 느리다(cold start ~30초). 강의 전 미리 /health에 한 번 접속해 깨운다.
- 세션, 기록물은 Neon에, 파일은 Blob에 있어 Render 재배포에도 안전하다.
- 구글 로그인=강연자라 이론상 체험자도 로그인하면 강연자가 될 수 있다. 운영 약속으로 관리하고, 필요 시 ADMIN_EMAILS 훅을 켠다.
- records.room_id FK로 코드 재사용 시 기록물 혼선을 방지한다.
- multer memoryStorage + limits로 메모리 폭탄을 방지하되, 동시 대용량 업로드가 잦으면 busboy 스트리밍 전환을 검토한다.
- ws/wss 자동 판별은 절대 규칙이다. 하드코딩하면 로컬/배포 중 한쪽이 반드시 깨진다.
- pg BIGSERIAL 비교는 sameUser 헬퍼 경유. === 직접 비교 금지. 이걸 어기면 재기동 시 강연자 강등이 조용히 재발한다.
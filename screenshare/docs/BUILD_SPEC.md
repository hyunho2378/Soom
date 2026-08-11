# BUILD_SPEC.md — 실시간 실습 모니터링 앱 확장 명세

이 문서는 클로드 코드가 그대로 구현에 들어가기 위한 명세다. 기존에 동작하는
화면 공유 + 실습 기록물 앱을 베이스로, 아래 다섯 가지를 얹는다.

1. 구글 로그인(로그인한 사람 = 강연자, 나머지 = 이름만 입장)
2. 화면 공유를 N→1 격자 수신으로 개편(체험자 최대 10명 → 강연자가 격자로 봄)
3. NeonDB(Postgres) 연결(유저·기록물·세션 영속화)
4. Vercel Blob 파일 저장(로컬 uploads 폐기, Render 재배포에도 파일 유지)
5. 기록물 파일 타입 확장(이미지 + PDF·HTML·docx 등 문서)

## 절대 규칙 (기존 CLAUDE.md 계승)
- 색·간격은 public/style.css :root 토큰 경유. 새 색 하드코딩 금지.
- 시스템/네이티브 UI 전면 금지. 네이티브 select, OS 캘린더, 네이티브 체크박스 쓰지 마라. 역할·항목 선택은 기존 커스텀 드롭다운 패턴 재사용, on/off는 커스텀 스위치. 예외는 구글 로그인 시 뜨는 구글 자체 화면뿐(우리 앱 밖).
- 이모지·가운데점·줄표 금지. 아이콘은 인라인 SVG. 라벨은 능동태 한국어.
- 디자인·모션은 .claude/skills/apple-design, make-interfaces-feel-better 기준.
- 변경 줄은 요청과 직접 연결. 단계마다 실제 서버 띄워 검증하고 docs/PROGRESS.md에 기록.

---

## 전체 아키텍처

```
[브라우저]
   │ https://앱.onrender.com
   ▼
[Render: Express + ws]  ← 유일한 배포처. 정적 + REST + WebSocket 시그널링
   ├─ NeonDB(Postgres)   유저, 기록물 메타, 세션
   ├─ Vercel Blob        기록물 파일(이미지/PDF/docx/html)
   └─ Google OAuth       강연자 로그인 시에만
```

- 실시간 룸 상태(참가자, 발표자)는 지금처럼 서버 메모리(Map)에 둔다. DB는 영속 데이터용이지 시그널링용이 아니다.
- 영상은 P2P라 서버·DB·Blob 어디도 안 거친다.

---

## 역할 모델

| 역할 | 되는 법 | 권한 |
| --- | --- | --- |
| 강연자 | 구글 로그인 | 자기 화면 공유(체험자에게), 체험자 화면 격자 수신, 기록물 초기화 |
| 체험자 | 이름만 입력해 입장 | 자기 화면을 강연자에게 공유, 기록물 올리기 |

- 한 방의 강연자는 한 명(그 방에서 로그인한 사람). 로그인 유저가 방에 들어오면 그 방의 speaker가 된다. 이미 speaker가 있으면 뒤에 온 로그인 유저는 대기(또는 거절) 처리하고 사유를 UI로 알린다.
- "구글 로그인 = 강연자"가 약속이다. 화이트리스트는 이번 범위 밖(추후 확장 훅만 남긴다).

---

---

## 방 모델 (코드 기반 입장) — 현장 사고 방지의 핵심

방 이름을 사람이 자유 입력하면 오타·대소문자·표기 차이로 다른 방에 흩어진다. 그래서 방은 강연자가 만들고, 체험자는 4자리 코드로만 들어온다.

### 규칙
- 강연자(구글 로그인)만 방을 만든다. 만들면 서버가 4자리 숫자 코드를 발급한다.
- 강연자당 활성 방은 하나. 새로 만들면 이전 방은 종료되고 코드가 폐기된다.
- 체험자는 코드 4자리 + 이름만 입력해 입장한다. 로그인 없음.
- 유효하지 않은 코드는 즉시 거절("그런 방이 없습니다"). 종료된 방 코드도 거절.
- 강연자가 나가거나 방을 닫으면 그 방 체험자 전원에게 "방이 종료되었습니다"를 통지하고 연결을 정리한다.

### 코드 발급
- 4자리 숫자(0000~9999). 발급 시 현재 활성 방들의 코드와 겹치지 않을 때까지 재추첨.
- 코드는 방 종료 시 반환되어 재사용 가능하지만, 활성 중에는 유일.

### 방 상태 저장
- 인메모리 rooms Map(code → { code, speakerUserId, speakerWsId, clients, createdAt })에 실시간 상태.
- DB rooms 테이블에 code, speaker_user_id, active, created_at, closed_at 기록(강연자 새로고침 시 자기 방 코드 복구용).

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
```

- records.room, 시그널링의 room 키는 이 4자리 코드를 그대로 쓴다.

### API / 라우트
- POST /api/rooms — 강연자 전용(세션 필요). 기존 활성 방 있으면 종료 처리 후 새 코드 발급, 반환 { code }.
- POST /api/rooms/close — 강연자 전용. 자기 방 종료.
- GET /api/rooms/:code — 코드 유효성 확인(체험자 입장 전 검사). active면 { ok:true }, 아니면 404.
- GET /api/my-room — 강연자 새로고침 시 자기 활성 방 코드 복구.

### 첫 화면 분기 (도착 경로로 자동 결정)
- 앱 주소로 그냥 들어온 사람(강연자 후보):
  - "구글로 로그인" 버튼(누르면 강연자 흐름). 로그인 후 "방 만들기" → 코드 표시(크게, 빔프로젝터용).
  - 아래에 작게 "참여 코드가 있나요? 코드로 입장" → 코드+이름 입력(체험자 탈출구).
- 코드+이름으로 들어온 체험자: 로그인 버튼 안 보임. 코드 유효성 통과하면 그 방 입장.
- 강연자 화면에는 코드 입력칸 안 보임. 체험자 화면에는 로그인 안 보임.
- 강연자가 새로고침해도 GET /api/my-room으로 코드 유지.

### 강연자 화면의 코드 표시
- 방 만든 뒤 코드 4자리를 크게 보여주고, "이 코드를 체험자에게 알려주세요" 안내. (QR은 이번 범위 밖, 추후 확장 훅만.)
- 커스텀 UI로. 네이티브 요소 금지.

---

## 1. NeonDB 스키마

Postgres. 마이그레이션은 `db/schema.sql` 한 파일로 만들고, 서버 부팅 시 `CREATE TABLE IF NOT EXISTS`로 멱등 적용한다.

```sql
-- 강연자(구글 로그인 유저)만 저장. 체험자는 계정 없음.
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
  id            BIGSERIAL PRIMARY KEY,
  room          TEXT NOT NULL,
  author_name   TEXT NOT NULL,               -- 표시용 이름(체험자 포함)
  author_user_id BIGINT REFERENCES users(id),-- 강연자가 올린 경우만 채워짐, 아니면 NULL
  item_code     TEXT NOT NULL,
  item_label    TEXT NOT NULL,               -- 서버 정본에서 채움(클라 신뢰 금지)
  track         TEXT NOT NULL,               -- 'A' | 'B'
  summary       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_records_room ON records(room, created_at);

-- 기록물에 딸린 파일(이미지/문서). 한 기록물에 여러 개.
CREATE TABLE IF NOT EXISTS record_files (
  id            BIGSERIAL PRIMARY KEY,
  record_id     BIGINT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  blob_url      TEXT NOT NULL,               -- Vercel Blob 공개 URL
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  kind          TEXT NOT NULL,               -- 'image' | 'markdown' | 'document'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- 세션 테이블은 connect-pg-simple이 자동 생성하므로 여기 안 적는다.
- 접속: `pg` 패키지 Pool + `DATABASE_URL`(Neon 연결 문자열, sslmode=require).
- 기존 data/records.json 영속화 코드는 제거하고 DB로 대체한다. roomRecords 인메모리 Map은 유지하되, 부팅·방 최초 접근 시 DB에서 로드해 채운다.

---

## 2. 구글 OAuth (강연자 로그인)

바닐라 Express 표준 스택으로 간다. 새 인증 프레임워크 도입 금지.

- 패키지: `passport`, `passport-google-oauth20`, `express-session`, `connect-pg-simple`
- 세션은 Neon에 저장(connect-pg-simple). Render 재기동·단일 인스턴스에서 세션 유지.

라우트:
- `GET /auth/google` — 구글 동의 화면으로 리다이렉트(scope: profile, email)
- `GET /auth/google/callback` — 코드 검증 → users에 upsert(google_id 기준) → 세션에 user 저장 → `/`로 리다이렉트
- `POST /auth/logout` — 세션 파기
- `GET /api/me` — 현재 세션 유저 반환(없으면 `{ user: null }`). 클라가 입장 화면에서 이걸로 로그인 상태 판단.

클라 입장 화면:
- 로그인 안 된 상태: 이름 입력 + 방 이름 입력 + "이름으로 입장(체험자)" 버튼 + "구글로 로그인해 강연자로 입장" 버튼.
- 로그인된 상태: "OOO님으로 강연자 입장" + 방 이름 입력 + 로그아웃.
- 로그인 버튼은 링크로 `/auth/google` 이동. 콜백 후 돌아오면 `/api/me`로 상태 반영.

WebSocket join 시 역할 확정:
- 서버는 ws 업그레이드 시 세션을 읽어(같은 express-session 미들웨어 공유) 로그인 유저면 role=speaker 후보, 아니면 role=viewer.
- join 메시지에 role을 클라가 실어 보내되, 서버가 세션으로 재검증한다. 클라가 speaker를 참칭해도 세션 없으면 viewer로 강등.

확장 훅(구현만 비워둠): `ADMIN_EMAILS` 환경변수(콤마 구분)가 있으면, 그 메일만 speaker 허용. 비어 있으면 지금 동작(로그인=강연자). 코드에 자리만 만들고 기본은 빈 값.

---

## 3. 화면 공유 N→1 격자 개편 (가장 큰 작업, 마지막에)

현재는 broadcaster 1명 → viewer N명(1→N). 이걸 두 방향으로 재구성한다.

- 체험자 → 강연자 (N→1): 각 체험자가 자기 화면을 강연자에게만 publish. 강연자는 최대 10개 수신해 격자로 표시.
- 강연자 → 체험자 (1→N): 강연자가 자기 화면을 전체 체험자에게 publish(시범). 이건 기존 1→N 로직 재활용.

### 시그널링(server.js ws) 변경
- 방 상태에 speakerId 저장(기존 broadcasterId 개념 재사용/개명).
- 체험자가 "내 화면 공유 시작"하면: 서버가 그 체험자에게 speakerId를 알려주고, 체험자가 speaker를 향해 offer를 만든다(체험자가 발신자). speaker가 answer.
- speaker는 체험자별 수신 PC를 Map으로 관리(viewerPublishers Map: viewerId → RTCPeerConnection).
- 체험자가 나가거나 공유 중지하면 해당 PC 정리 + 격자에서 제거.
- 강연자 시범 공유는 기존 경로 유지(speaker → 각 viewer).

### 클라(app.js) 변경
- 역할 분기: speaker면 격자 수신 UI, viewer면 "내 화면 공유" 버튼 + 강연자 시범 화면 보기.
- speaker 격자: 들어오는 트랙마다 셀 추가. 셀에 체험자 이름 라벨. 빈 슬롯 상태 포함.
- 성능 가드(필수):
  - getDisplayMedia 제약을 낮춘다: `frameRate: { max: 8 }`, 해상도 상한(예: 1280 너비). 격자에선 작게 보이므로 충분.
  - `contentHint = 'detail'`(문서·코드 화면 선명도 우선) 또는 격자에선 'motion'으로 프레임 절약. 실측으로 택1.
  - 수신 상한 10 하드코딩. 초과 입장 체험자는 공유 대기열로.
- 강연자 화면(격자)은 빔프로젝터 출력 대상이므로, 전체화면 토글과 셀 크게 보기(클릭 시 확대) 제공.

### UI/디자인 (design skill 적용)
- 뷰어 영역이 단일 프레임 → 격자(grid)로 바뀐다. 이건 새 핵심 컴포넌트다. apple-design·make-interfaces로 셀 간격·라운드·라벨·빈 슬롯·확대 인터랙션을 설계한다.
- 격자 셀 수 가변(1~10)에 따라 열 수 자동(1명 크게, 2~4명 2열, 5~10명 3열 등). 반응형.
- 라이브 영상 위에는 liquidGL 금지. 셀 라벨·칩은 backdrop-filter로.

주의: 이 개편은 기존 "발표자 1명" 데모 흐름을 크게 바꾼다. 앞 단계(로그인·DB·파일)가 안정된 뒤 마지막에 착수하고, 착수 전 현재 P2P 코드를 그대로 백업 브랜치로 남긴다.

---

## 4. Vercel Blob 파일 저장

- 패키지: `@vercel/blob`. 어느 서버에서나 토큰만 있으면 동작(호스팅을 Vercel로 옮길 필요 없음).
- multer를 디스크 저장에서 memoryStorage로 바꿔 버퍼를 받는다.
- 업로드 흐름: 파일 버퍼 → `put(filename, buffer, { access: 'public', addRandomSuffix: true })` → 반환 URL을 record_files.blob_url에 저장.
- 기존 로컬 uploads/ 서빙(`/uploads` 정적)과 디스크 저장 코드는 제거. .gitignore의 uploads/ 항목도 정리.
- 환경변수 `BLOB_READ_WRITE_TOKEN`.

---

## 5. 기록물 파일 타입 확장

- 허용 타입과 카드 표시:
  - 이미지 image/*(png jpg webp gif) → 썸네일 4:3 cover + 라이트박스(contain, 이전/다음, 장수)
  - 마크다운 text/markdown(.md) → 카드 안에서 바로 렌더(제목·목록·코드블록), 길면 펼치기/접기. 렌더는 가벼운 마크다운 파서 사용, 원본 HTML 이스케이프 후 안전 렌더
  - PDF application/pdf → 아이콘 + 열기(새 탭)·내려받기
  - 워드 docx(application/vnd.openxmlformats-officedocument.wordprocessingml.document) → 아이콘 + 내려받기
  - HTML text/html → 아이콘 + 열기(새 탭). 앱 안에서 직접 렌더하지 말 것(보안)
  - 텍스트 text/plain(.txt) → 아이콘 + 열기
  - mime + 확장자 이중 검증. 목록 밖 타입은 거절.
- 장당 상한 상향(예: 이미지 5MB, 문서 15MB). 한 기록물 첨부 최대 10개.
- kind 판정: image/* → 'image', text/markdown → 'markdown', 그 외 → 'document'.
- 카드 렌더 분기:
  - image: 지금처럼 썸네일 격자 + 라이트박스(design 단계 결정대로 썸네일 4:3 cover, 라이트박스 contain + 이전/다음 + 장수).
  - document: 파일 종류 인라인 SVG 아이콘(PDF/DOC/HTML 구분) + 파일명 + 용량 + "열기"(새 탭)와 "내려받기" 링크. 네이티브 아이콘 폰트 금지, 우리 SVG.
- 서버 검증은 그대로 이중 방어. item_label·track은 서버 정본(PRACTICE_ITEMS)에서만.

---

## 구현 순서 (문서는 통합, 작업은 이 게이트대로)

각 단계 끝에서 실제 서버를 띄워 검증하고 통과해야 다음으로 간다. 앞 단계가 뒤 단계 위험을 줄인다.

- 0단계 배선: 패키지 설치(pg, passport, passport-google-oauth20, express-session, connect-pg-simple, @vercel/blob). .env.example 작성. db/schema.sql 멱등 적용 코드. 부팅 시 DB 연결 확인 로그.
  - 검증: 서버 부팅 시 DB 연결 성공 로그, 테이블 생성 확인.
- 1단계 로그인: OAuth 라우트 + /api/me + 세션(Neon 저장). 입장 화면에 강연자/체험자 분기.
  - 검증: 구글 로그인 왕복 성공, 새로고침·재기동 후 세션 유지, 로그아웃 동작.
- 1.5단계 방 모델: rooms 테이블 + 코드 발급/검증 API + 첫 화면 도착 경로 분기 + 강연자 코드 표시. 시그널링 room 키를 4자리 코드로 통일.
  - 검증: 강연자가 방 만들면 코드 발급, 체험자가 코드+이름으로 정확히 그 방 입장, 틀린 코드 거절, 강연자 새로고침 시 코드 유지, 방 종료 시 체험자 통지·정리.
- 2단계 파일 저장 교체: multer memory + Blob put + record_files 저장. 기존 이미지 업로드가 Blob으로 감.
  - 검증: 이미지 올리면 Blob URL 반환·표시, 로컬 uploads/ 미생성, 서버 재기동 후에도 이미지 보임.
- 3단계 파일 타입 확장: PDF·docx·html 허용 + 문서 카드 분기 + SVG 아이콘.
  - 검증: PDF·docx 올려 카드에 아이콘·열기·내려받기 정상, 잘못된 타입 거절.
- 4단계 기록물 DB 이전: roomRecords를 DB 백업으로. records-init을 DB에서 로드, record-added는 DB 저장 후 브로드캐스트. reset은 DB 삭제 + Blob 정리(가능 시).
  - 검증: 재기동 후 기록물 유지, 실시간 브로드캐스트 그대로.
- 5단계 화면 공유 N→1: 시그널링 역방향 + speaker 격자 + 성능 가드. 착수 전 현재 코드 백업.
  - 검증: 체험자 3~4개 동시 공유가 강연자 격자에 뜸, 강연자 시범 공유가 체험자에게 보임, 한 명 나갈 때 셀 정리, 실인원 리허설.
- 6단계 디자인 디벨롭: 앞서 만든 점검·계획대로 격자 포함 전체 UI 폴리시. apple-design·make-interfaces 적용.

각 단계는 독립 커밋. 5단계는 별도 브랜치에서 하고 검증 후 병합 권장.

---

## 환경변수 (.env / Render 환경변수)

```
DATABASE_URL=            # Neon 연결 문자열 (sslmode=require)
SESSION_SECRET=          # 긴 랜덤 문자열
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=     # 예: https://앱.onrender.com/auth/google/callback
BLOB_READ_WRITE_TOKEN=
ADMIN_EMAILS=            # 비워둠(추후 화이트리스트 확장용)
PORT=                    # Render가 주입, 로컬은 3000
```

로컬은 .env(dotenv), Render는 대시보드 환경변수. .env는 절대 커밋 금지(.gitignore 확인).

---

## 네가 대시보드에서 직접 해야 할 것 (에이전트가 대신 못 함)

1. Neon: 프로젝트/DB 생성 → 연결 문자열(DATABASE_URL) 확보.
2. Google Cloud Console: 프로젝트 생성 → OAuth 동의 화면(외부, 앱 이름·이메일) → 사용자 인증 정보에서 OAuth 클라이언트 ID(웹) 생성 → 승인된 리디렉션 URI에 로컬·Render 콜백 둘 다 등록 → client id/secret 확보.
   - `http://localhost:3000/auth/google/callback`
   - `https://앱.onrender.com/auth/google/callback`
3. Vercel: Blob Store 생성 → BLOB_READ_WRITE_TOKEN 발급.
4. Render: 저장소 연결 → Build `npm install`, Start `npm start` → 위 환경변수 전부 등록.
5. 위 값들을 로컬 .env에도 넣어 로컬에서 먼저 검증.

---

## 리스크와 명시적 결정

- P2P 10개 수신은 대체로 되지만 강연자 기기·강의실 네트워크에 좌우된다. 성능 가드(저프레임·저해상도·수신 상한 10)를 반드시 넣고, 실인원 리허설 필수. 한계 시 LiveKit 등 SFU로 교체할 수 있게 미디어 계층을 분리해 둔다.
- Render 무료 플랜은 유휴 시 잠들어 첫 접속이 느리다(cold start). 강의 전 미리 한 번 깨워둔다.
- 세션·기록물은 Neon에, 파일은 Blob에 있어 Render 재배포에도 안전하다.
- 구글 로그인=강연자라 이론상 체험자도 로그인하면 강연자가 될 수 있다. 운영 약속으로 관리하고, 필요 시 ADMIN_EMAILS 훅을 켠다.
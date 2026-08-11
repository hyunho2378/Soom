# PROGRESS.md — 진행 상태

## 완료
- 기반 앱: Express 정적 + ws 시그널링 + WebRTC P2P 화면 공유(발표자 교체 자동 처리, 참가자 패널). 기존 코드 유지, 손대지 않음.
- 실습 기록물 기능 추가
  - server.js: /api/items, /api/records(multer 이미지 업로드), /api/records/reset. roomRecords Map + data/records.json 영속화. 라벨·트랙은 서버 정본(PRACTICE_ITEMS)에서만 판단. 방별 WS 브로드캐스트(records-init / record-added / records-reset).
  - index.html: 회의실 탭(실시간 화면 / 실습 기록물), 올리기 폼, 커스텀 항목 드롭다운, 이미지 첨부·미리보기, 카드 목록, 라이트박스, 초기화 모달.
  - style.css: 주황 토큰 3종 + 탭·폼·드롭다운·카드(트랙 액센트)·썸네일·라이트박스·모달. 반응형 유지.
  - app.js: 탭 전환, 드롭다운, 첨부 미리보기, 업로드 POST, WS 실시간 카드, 초기화 모달, 라이트박스.
  - package.json: multer ^2.0.1(2.2.0 설치, 1.x 취약점 회피). .gitignore: uploads/ data/.

## 검증 완료(실행 기준)
- server.js / app.js node --check 통과.
- GET /api/items 17개 항목·라벨·트랙 정확.
- POST /api/records: 정상 200, 이미지 uploads/ 저장 후 /uploads/로 byte 동일 서빙(200), 잘못된 itemCode 400, 요약·이미지 둘 다 없음 400, 비이미지 파일 필터로 0장 저장.
- data/records.json 저장·재로드 정상.
- reset: 확인 문구 불일치 400, 일치 시 레코드 비우고 이미지 파일 삭제.
- WS: 기존 참가자 record-added 실시간 수신, 입장 시 records-init 수신, 뒤늦은 입장자 기존 기록 로드, reset 브로드캐스트 수신. 시그널링과 충돌 없음.

## 디자인 디벨롭 (apple-design + make-interfaces-feel-better 기준, 2026-08-11)
기능 로직은 손대지 않았다. WebRTC 시그널링(server.js ws 핸들러, app.js peerConnections/viewerPc/offer/answer/ice)과
기록물 전송 경로(REST 요청 본문, 서버 검증, 브로드캐스트)는 그대로다. server.js는 한 줄도 바뀌지 않았다.

### 배선
- design-kit.zip을 풀어 .claude/skills/(스킬 7종), refs/liquidGL/, CLAUDE.md를 넣고 docs/SESSION_HEADER.md에 디자인 스킬 항목을 추가했다.

### 토큰 (style.css :root)
- 하드코딩으로 흩어져 있던 색 20여 개를 토큰으로 올렸다. --field --bg-grad --line-strong --line-dash --blue-muted --blue-glass
  --red-dark --red-tint --red-muted --green-glow --viewer --viewer-ink --viewer-sub --viewer-chip --viewer-accent
  --scrim --scrim-strong --glass --glass-blur --on-glass --on-glass-hover --on-dark.
- app.js의 아바타 팔레트 배열을 없애고 --avatar-1 부터 --avatar-6 을 getComputedStyle로 한 번 읽어 쓴다. 색 정본이 :root 하나로 모였다.
- 깊이 토큰 --shadow-border --shadow-border-hover --shadow-pop --shadow-card --shadow-modal --img-line 추가.
  카드와 패널의 1px 보더를 3겹 그림자로 바꿨다. 구분선 성격의 보더(헤더 하단)는 그대로 뒀다.
- 반경을 --r-sm 8 / --r-md 12 / --r-lg 16 / --r-xl 20 네 단계로 수렴시켰다. 같은 카드 안에서 10, 12, 14, 18이 섞이던 것을 정리했다.
- 모션 토큰 --ease cubic-bezier(.2,0,0,1), --dur-1 120ms / --dur-2 180ms / --dur-3 260ms.
- 남은 리터럴은 색 위의 글자색 #fff 뿐이다.

### 모션 (여덟 개만 넣었다)
1. 모든 버튼 :active 에 scale(.96) 150ms. 누르는 순간 피드백이 생겼다(이전에는 hover 뿐이었다).
2. 오버레이 3종(드롭다운, 라이트박스, 모달)을 .hidden 대신 .is-open 으로 바꿔 종료 애니메이션이 가능해졌다.
   visibility는 보간하지 않고 여는 쪽 지연 0, 닫는 쪽만 지연을 준다(트랜지션에 태우면 첫 프레임이 hidden이라 포커스가 안 들어간다).
3. 드롭다운은 트리거 기준 앵커링. transform-origin top center, scale .96 to 1. 진입 180 / 종료 120.
4. 모달과 라이트박스는 스크림 페이드 + 카드 scale/translate. 종료를 140ms로 진입보다 짧게 뒀다.
5. 뷰어 플레이스홀더는 260ms 교차 페이드. 숨기는 시점을 broadcaster-changed 에서 ontrack 으로 옮겼다.
6. 새 기록물 카드만 1회성 진입(opacity, translateY 8px, blur 4px, 260ms). 입장 시 초기 목록은 모션 없음.
7. 탭 전환은 opacity 120ms.
8. 헤더 라이브 점은 실제 발표 중일 때만 펄스한다(이전에는 상태와 무관하게 항상 뛰었다).
- prefers-reduced-motion 에서 이동과 흐림, 프레스 스케일, 펄스를 끄고 색과 라벨은 남긴다.
- prefers-reduced-transparency 에서 유리 재질을 불투명으로 바꾼다.

### 고친 UI 결함
- 뷰어: 발표자 지정 즉시 플레이스홀더를 걷어 검은 상자가 노출되던 문제. 이제 트랙 도착 전까지 불러오는 중 문구를 보여준다.
- 탭 배지: 전체 건수를 계속 띄우던 것을 미확인 건수로 바꿨다. 전체 수는 패널 헤더에 N개로 따로 표시하고, 기록물 탭을 열면 배지가 0이 된다.
- 드롭다운: role=listbox 안에 button이 들어가 있던 잘못된 ARIA를 combobox + role=option 으로 고치고
  화살표, Home, End, Enter, Escape 키보드 조작과 aria-activedescendant 를 붙였다. 아래 공간이 모자라면 위로 펼친다(drop-up).
- 라이트박스: 이전/다음, 장수 표시, 포커스 트랩, 포커스 복귀, 배경 스크롤 잠금, role=dialog 를 넣었다. 이미지는 contain 이라 잘리지 않는다.
- 카드 썸네일을 1대1에서 4대3 으로 바꿨다. 스크린샷이 정사각으로 중앙 크롭되어 내용이 안 보이던 문제.
- 초기화 모달: Escape 로 닫히지 않던 것(문서와 구현 불일치)을 고치고, 포커스 복귀와 삭제 대상 건수 표시를 넣었다.
- 카드 좌측 4px 액센트를 border-left 에서 의사 요소로 바꿔 둥근 모서리에서 잘리지 않게 했다.
- 폼 라벨을 label for 로 연결하고, 탭에 tabpanel 연결과 좌우 방향키를 넣고, 룸 화면에 h1 을 뒀다.
- 첨부 삭제 버튼 히트 영역을 20px 에서 40px 로 넓혔다(의사 요소). 글리프도 인라인 SVG 로 바꿨다.
- 플레이스홀더의 화면 이라는 글자 상자를 인라인 SVG 모니터 아이콘으로 교체했다. 공유 버튼에 아이콘 교차 페이드를 넣었다.
- renderPreviews 가 objectURL 을 회수하지 않고 계속 만들던 누수를 고쳤다.
- 업로드 중 버튼 라벨이 바뀌고, 성공 문구는 4초 뒤 스스로 사라진다. 입장 버튼도 같은 처리를 했다.
- 요약 입력에 글자 수 표시(0 / 2000)를 넣었다.
- 폰트: CDN 이 static 빌드를 받는데 font-family 첫 항목은 Pretendard Variable 이라 해석되지 않던 문제. variable 빌드로 바꾸고 preconnect 를 넣었다.
- 루트에 -webkit-font-smoothing: antialiased 적용. 참가자 수, 시각, 배지, 글자 수에 tabular-nums 적용.
- 860px 이하에서 참가자 목록 전체가 영상 위를 덮던 것을 가로 스크롤 띠로 접었다.
- 뷰어 프레임 폭을 뷰포트 높이에 묶어(min(100%, (100dvh - 260px) * 16/9)) 세로 720px 노트북에서도 공유 버튼이 접힘 위에 남는다.
- 중립 ghost 버튼과 파괴적 버튼이 hover 에서 똑같이 빨갛던 것을 분리했다. 모달 입력의 빨간 포커스 링도 파랑으로 바꿨다.

### 넣지 않은 것
- liquidGL. html2canvas 스냅샷 비용 대비 얻는 것이 입장 화면 배경 하나뿐이라 이번 회차는 제외했다. 라이브 뷰어 위 사용은 CLAUDE.md 대로 금지 유지.
- 기록물 목록 stagger 진입, 버튼 스프링 바운스, 카드 hover lift, 스켈레톤 로더, 뷰어 프레임 글래스, 다크 모드, 별도 스페이싱 스케일.

### 디자인 검증 (Chrome 151 headless, CDP, 20개 항목 전부 통과)
- Pretendard Variable 실제 로드, 루트 antialiased 적용.
- 두 브라우저 동시 입장 후 참가자 수 실시간 갱신(WS 경로 무손상). 콘솔 오류 0건.
- 드롭다운 ARIA(combobox, option 17개, aria-activedescendant)와 화살표 3회 + Enter 선택.
- 첨부 미리보기, 글자 수, 업로드 후 카드 생성과 헤더 건수 1개.
- 다른 탭에 있던 참가자에게 미확인 배지 1, 탭을 열면 0.
- 라이트박스 열림 시 포커스가 닫기 버튼으로 이동, 배경 스크롤 잠금, object-fit contain, Escape 로 닫히고 스크롤 복구.
- 초기화 모달이 건수를 문구에 넣고 Escape 로 닫히며 포커스가 트리거로 복귀.
- 860 / 420 / 320px 전부 가로 스크롤 0, 860 이하에서 참가자가 가로 띠로 접힘.
- 720px 높이에서 뷰어 비율 1.78 유지하며 공유 버튼이 접힘 위에 남음.
- prefers-reduced-motion 에서 펄스 애니메이션 none.

### 남은 항목
- 실제 화면 공유(getDisplayMedia) 경로는 headless 에서 권한 모의가 불안정해 자동 검증하지 않았다. 강의 전에 사람이 두 대로 한 번 확인해야 한다.
- 참가자 목록이 participants 수신마다 innerHTML 로 통째로 다시 그려져 항목 전환에 트랜지션이 안 걸린다. 대인원에서 문제되면 키 기반 갱신으로 바꾼다.
- 라이트박스 이미지 전환 자체에는 모션이 없다(교체만 한다). 필요해지면 교차 페이드를 넣는다.

## BUILD_SPEC 0단계 배선 (2026-08-11)
docs/BUILD_SPEC.md의 0단계. 코드 동작은 아직 바꾸지 않았다. 화면 공유와 기록물은 기존 그대로 돈다.

### 완료
- 패키지 설치: pg, passport, passport-google-oauth20, express-session, connect-pg-simple, @vercel/blob. 취약점 0건.
- db/schema.sql: users, rooms, records, record_files와 인덱스 3개. 전부 IF NOT EXISTS라 반복 실행에 안전하다. 세션 테이블은 connect-pg-simple이 만들므로 넣지 않았다.
  BUILD_SPEC이 코드 기반 방 모델로 갱신되면서 rooms 테이블과 record_files.kind의 markdown 값을 반영했다.
  docs/BUILD_SPEC.md가 파일명 끝에 공백이 붙은 옛 사본과 두 벌로 남아 있어 옛 사본을 지웠다.
- db/index.js: Pool 생성, init()에서 연결 확인 후 schema.sql을 그대로 적용하고 만들어진 테이블 이름을 로그로 찍는다.
  DATABASE_URL이 없거나 연결에 실패해도 예외를 던지지 않고 false를 돌려준다. DB가 없어도 화면 공유는 돌아야 하기 때문이다.
- server.js: db 모듈 require와 부팅부만 바꿨다. db.init() 후 listen 하고 DB 연결 여부를 기동 로그에 남긴다.
  시그널링 핸들러와 기록물 REST는 한 줄도 손대지 않았다.
- .env.example: 8개 키와 각각 어디서 발급하는지, SESSION_SECRET 생성 명령까지 적었다.
- package.json: start를 node --env-file-if-exists=.env 로 바꿔 dotenv 의존성을 안 넣었다.
  이 플래그가 Node 20.12 이상이라 engines.node를 >=18에서 >=20.12.0으로 올렸다. Render가 engines를 보고 버전을 맞춘다.

### 검증(실행 기준)
- .env 없이 부팅: DATABASE_URL 없음 경고 후 정상 기동. GET / 200, GET /api/items 200, WS join 후 participants 수신 확인.
- 잘못된 DATABASE_URL로 부팅: DB 연결 실패 메시지를 남기고도 서버는 뜨고 GET / 200.
- .env가 git check-ignore로 차단되는지 확인. 추적 대상 0건.
- server.js와 db/index.js node --check 통과.

### 실제 Neon 검증 완료 (0단계 종료)
- .env가 상위 폴더에 있어 앱이 못 읽던 것을 screenshare/.env로 옮겼다. git check-ignore 통과 확인.
- 부팅 로그: DB 연결 성공 neondb (PostgreSQL 18.4), 스키마 적용 완료 record_files, records, rooms, users.
- 재기동해도 같은 로그. IF NOT EXISTS 멱등성 확인.
- 실제 구조 확인: users 6컬럼, rooms 6, records 9, record_files 8. 인덱스 3개(idx_rooms_active_code, idx_records_room, idx_record_files_record).
  외래키 3개(record_files→records ON DELETE CASCADE, records→users, rooms→users).
- 기존 기능 회귀 없음: GET / 200, /api/items 17개, POST /api/records ok=true(라벨은 서버 정본에서 생성), WS join 후 records-init 수신.
- DB records 행 수 0. 기록물은 아직 JSON 경로다. 4단계에서 옮긴다.
- pg가 sslmode=require를 verify-full로 다룬다는 경고를 부팅마다 한 줄 찍는다. Neon 인증서가 공개 신뢰 체인이라 검증에 통과하며 동작에는 영향이 없다.
- 검증 중 로컬 테스트 기록물 파일 data/records.json을 지웠다. 검증 실행으로 쌓인 테스트 데이터뿐이었다.

## 선택 개선(미적용, 제안)
- 영속화 강화: 무료 플랜 디스크 휘발 대응. SQLite(better-sqlite3) 또는 Render Persistent Disk 유료 옵션. 현재는 JSON 파일이라 재배포 시 소실 가능.
- 막힌 네트워크: 화면이 안 뜨면 app.js ICE_SERVERS에 무료 TURN 추가.
- 이미지 용량 관리: 다수 업로드 누적 시 디스크 정리 정책 필요.

## 수정 이력
- app.js renderAllRecords: reverse 누락으로 입장 시(records-init) 오래된 순, 실시간(record-added) 최신 순이라 정렬이 섞이던 버그 수정. list.slice().reverse()로 두 경로 모두 최신 위 통일.

## BUILD_SPEC 1+1.5단계: 구글 로그인과 코드 기반 방 (2026-08-11)
1단계와 1.5단계를 묶어서 했다. 입장 화면을 두 번 만들 이유가 없어서다.

### 서버
- express-session + connect-pg-simple로 세션을 Neon에 저장. passport-google-oauth20으로 로그인.
  serializeUser에 최소 유저 객체를 통째로 담아 WS 업그레이드에서 DB를 다시 안 친다.
- 라우트: GET /auth/google, GET /auth/google/callback, POST /auth/logout, GET /api/me.
  users는 google_id 기준 upsert.
- 방 모델: POST /api/rooms(강연자 전용, 이전 방 자동 종료 후 4자리 코드 발급), POST /api/rooms/close,
  GET /api/rooms/:code(체험자 입장 전 확인), GET /api/my-room(강연자 새로고침 복구).
- WS를 noServer로 바꾸고 upgrade에서 세션을 읽는다. 클라가 role=speaker를 실어 보내도 세션으로 재판정해 강등한다.
- getRoom 자동 생성을 없앴다. 없는 코드로 join하면 join-rejected를 보낸다.
- POST /api/records/reset에 requireSpeaker를 걸었다. 역할표대로 초기화는 강연자 권한이다.
- ADMIN_EMAILS 훅: 비어 있으면 로그인한 사람이 곧 강연자, 값이 있으면 그 메일만 강연자.

### 클라이언트
- 입장 화면을 도착 경로로 가른다. 코드를 달고 온 사람(?code=)은 체험자로 보고 로그인 창구를 아예 숨긴다.
  로그인한 사람은 강연자 화면(코드 입력칸 없음), 안 한 사람은 로그인 화면(작게 코드 입장 탈출구).
- 강연자 코드 표시는 52px 크기다. 빔프로젝터로 쏘는 용도라서다.
- 서버가 joined를 줄 때까지 회의실로 안 넘어간다. 코드가 틀리면 입장 화면에 남아 사유를 보여준다.
- 회의실 헤더에 역할 칩과 방 종료 버튼. 체험자에게는 방 종료와 기록물 초기화가 안 보인다.
- 방 종료 알림은 네이티브 alert 대신 기존 모달 패턴을 재사용했다.

### 판단한 것
- 강연자가 WS 연결을 끊어도 방을 지우지 않는다. 새로고침해도 코드가 살아 있어야 한다는 요구가 우선이라,
  방을 없애는 길은 POST /api/rooms/close와 강연자가 새 방을 여는 경우뿐이다.
- connect-pg-simple은 세션 표를 첫 세션 저장 때 늦게 만든다. 실패가 하필 첫 로그인 순간에 드러나므로
  부팅 때 store를 한 번 건드려 미리 만들고 결과를 기동 로그에 남긴다.

### 검증
- API 20개 항목 통과. 로그인 전 401/404 거절, /auth/google가 구글로 302(리디렉션 URI가 .env와 일치),
  방 생성과 DB 기록, 코드 확인, my-room 복구, speaker/viewer 역할 판정, role 참칭 강등,
  없는 코드 거절, 강연자 끊겨도 코드 유지, 방 종료 통지와 DB 기록, 초기화 401, 로그아웃.
- 화면 12개 항목 통과. 도착 경로 분기 세 갈래, 코드 52px 표시, 새로고침 코드 유지,
  강연자와 체험자의 버튼 노출 차이, 틀린 코드 거절, 코드 링크 입장, 방 종료 모달, 콘솔 오류 0건.

### 남은 항목
- 실제 구글 동의 화면 왕복은 사람이 한 번 눌러야 한다. 검증은 세션을 DB에 직접 심어 그 뒤 경로를 전부 확인했다.

## BUILD_SPEC 2단계: 파일 저장을 Vercel Blob으로 (2026-08-11)
- multer를 diskStorage에서 memoryStorage로 바꿔 버퍼를 그대로 Blob에 올린다. 로컬 디스크를 거치지 않는다.
- putToBlob: access public, addRandomSuffix true, contentType 보존. removeFromBlob: 실패해도 흐름을 안 멈춘다.
- /uploads 정적 서빙과 UPLOAD_DIR 제거. uploads 폴더 삭제, .gitignore 항목 정리.
- 초기화는 파일 unlink 대신 Blob del로 지운다.
- 업로드 중 일부만 올라간 채 실패하면 이미 올라간 것을 되돌린다.
- BLOB_READ_WRITE_TOKEN이 없으면 파일 첨부만 503으로 막고 텍스트 기록물은 그대로 받는다.

### 검증 중 찾아 고친 것
- multer가 파일명을 latin1로 읽어 한글 이름이 이중 인코딩으로 깨졌다(결과1.png가 %C3%AA%C2%B2...).
  decodeName으로 latin1 버퍼를 UTF-8로 되돌렸다. 3단계에서 문서 파일명을 그대로 보여줘야 해서 지금 고쳤다.

### 검증(실제 Blob 상대로 11개 항목 통과)
- 이미지 2장 업로드 성공, 반환 URL이 blob.vercel-storage.com 공개 URL.
- 한글 파일명 보존, 받은 바이트가 올린 것과 동일, Content-Type image/png 보존.
- 로컬 uploads 폴더 안 생김, /uploads 경로 404.
- 이미지 아닌 파일 400 거절, 초기화 후 Blob 파일 404로 실제 삭제 확인.

## BUILD_SPEC 3단계: 기록물 파일 타입 확장 (2026-08-11)
- 허용 타입 정본을 ALLOWED_TYPES 하나에 모았다. png jpg webp gif, md, pdf, docx, html htm, txt.
- 확장자로 후보를 찾고 mime으로 한 번 더 확인한다. 브라우저가 mime을 비우거나 octet-stream으로 보내는 일이 잦아
  제네릭 mime과 텍스트 계열의 text/plain은 확장자가 맞으면 통과시킨다. 어긋나면 거절한다.
- 용량은 이미지 5MB, 문서 15MB. multer는 큰 쪽으로 열어 두고 종류를 안 뒤에 이미지만 다시 본다.
- 업로드 필드명을 images에서 files로 바꾸고, 레코드가 files 배열을 갖는다(url, filename, mimeType, size, kind).
  Blob에 올릴 때 contentType도 클라 값이 아니라 서버 정본에서 정한다.
- 카드가 종류별로 갈린다. 이미지는 썸네일과 라이트박스, 마크다운은 카드 안 렌더, 문서는 아이콘과 열기 내려받기.
  docx는 브라우저가 못 여니 내려받기만 준다. HTML은 앱 안에서 렌더하지 않고 새 탭으로만 연다.
- 파일 종류 아이콘은 전부 인라인 SVG다(마크다운, PDF, 워드, HTML, 텍스트).
- 마크다운 렌더러를 직접 넣었다(약 60줄). 파서 의존성을 안 늘리려고 썼다.
  원본을 통째로 이스케이프한 뒤 서식을 입히므로 문서 안 HTML은 원리적으로 실행될 수 없다.
  링크는 http와 https만 받고 따옴표를 막아 속성 탈출을 차단한다. 길면 260px에서 접고 펼치기를 준다.

### 검증 중 찾아 고친 것
- 마크다운 렌더러의 코드블록 치환 표식으로 NUL 문자를 썼더니 app.js가 바이너리로 취급돼 grep이 통째로 건너뛰었다.
  표식을 아예 없애고 코드펜스 기준으로 split해 홀수 조각만 코드로 다루는 방식으로 바꿨다.

### 검증
- 서버 11개 항목 통과. 여섯 종류 동시 업로드, kind 분류, mimeType과 size 저장, Blob CORS 허용,
  octet-stream과 text/plain 허용, 목록 밖 확장자 거절, 확장자와 mime 불일치 거절, 확장자 없음 거절,
  6MB 이미지 거절, 8MB 문서 통과.
- 화면 7개 항목 통과. 카드 종류별 분기, PDF와 HTML의 열기 내려받기, 마크다운 서식 렌더,
  악성 마크다운(img onerror, script, javascript 링크)이 실행되지 않고 글자로만 남음, 첨부 미리보기 분기, 콘솔 오류 0건.

## BUILD_SPEC 4단계: 기록물을 DB로 이전 (2026-08-11)
- data/records.json 영속화를 걷어냈다. 정본은 records와 record_files 두 표다.
  roomRecords Map은 그대로 두되 방마다 처음 접근할 때 DB에서 한 번 읽어 채우는 캐시로 바꿨다.
- records-init은 loadRoomRecords로 DB에서 읽고, record-added는 DB에 넣은 뒤 브로드캐스트한다.
  reset은 Blob 파일을 먼저 지우고 records를 지운다(record_files는 CASCADE로 따라 사라진다).
- author_user_id는 세션이 있는 강연자가 올릴 때만 채우고 체험자는 비운다.
- item_label과 track은 여전히 PRACTICE_ITEMS 서버 정본에서만 채운다.
- DB가 없으면 Map만으로 동작한다(영속화 없음). 화면 공유가 DB에 묶이지 않는다.
- data 폴더와 .gitignore 항목을 정리하고 안 쓰게 된 fs require도 지웠다.

### 검증 중 찾아 고친 것 (실제 결함)
- 서버를 재기동하면 rooms Map이 비어 DB는 active라는데 코드 입장이 거절됐다.
  Render 무료 플랜은 유휴 시 잠들었다 깨므로 강의 중에 실제로 터질 문제다.
  부팅 때 활성 방을 DB에서 되살리는 restoreRooms를 넣고 기동 로그에 복구 개수를 남긴다.

### 검증 중 알아낸 것 (결함 아님)
- 초기화 후 Blob 공개 URL이 한동안 200을 더 준다. CDN 엣지 캐시다.
  Blob head API로 확인하면 원본은 지워져 있다. DB 행도 사라져 앱이 그 파일을 다시 가리키지 않는다.
  검증 기준을 공개 URL 응답이 아니라 원본 존재 여부로 바꿨다.

### 검증(16개 항목 통과)
- records-init 빈 목록, 기록물 등록, 같은 방 참가자의 record-added 실시간 수신.
- records 행 생성, item_label과 track이 서버 정본대로, 체험자 author_user_id null, 강연자일 때 채워짐.
- record_files에 kind와 size 저장(image, markdown).
- 서버 재기동 후 기록물 2건 유지, 파일 목록과 라벨과 요약 온전, created_at 정렬 유지, Blob 파일 열림.
- 로컬 data 폴더 재생성 안 됨.
- 초기화 브로드캐스트 수신, records와 record_files 동시 비움(CASCADE), Blob 원본 삭제.

### 정리
- 검증으로 만든 DB 행과 Blob 파일을 전부 지웠다. users 0, rooms 0, records 0, record_files 0, Blob 0개.

## BUILD_SPEC 5단계: 화면 공유 N대 1 격자 개편 (2026-08-11)
착수 전 backup/before-grid-p2p 브랜치를 남기고 feat/grid-n-to-1 에서 작업했다.

### 방향이 둘이 됐다
- publish: 체험자 여러 명이 강연자 한 명에게 보낸다. 보내는 쪽이 offer를 만든다.
- demo: 강연자가 체험자 전원에게 시범을 보인다. 기존 1대N 경로를 그대로 쓴다.
- 같은 상대와 두 방향 연결이 동시에 살 수 있어서 모든 시그널에 channel(publish 또는 demo)을 붙여 구분한다.
  서버 중계는 원래 메시지를 그대로 흘려보내므로 channel이 저절로 따라간다.

### 서버
- 방 상태에 speakerWsId와 publishers Set을 넣었다. MAX_PUBLISHERS는 10.
- start-publish: 강연자가 방에 있어야 수락하고 speakerId를 알려준다. 상한을 넘으면 이유와 함께 거절한다.
- stop-publish와 연결 끊김에서 removePublisher로 정리하고 강연자에게 publisher-stopped를 보낸다.
- 강연자가 나가면 보내던 체험자 전원에게 publish-ended를 보내 멈춘다.
- participants에 publishers 목록을 실어 누가 공유 중인지 모두가 안다.

### 클라이언트
- 역할로 화면이 갈린다. 강연자는 격자, 체험자는 시범 화면 프레임 하나.
- 강연자는 incoming Map으로 체험자별 수신 연결을, demoPcs Map으로 시범 송출 연결을 따로 관리한다.
- 성능 가드: 캡처를 frameRate max 8, 1280x720 상한으로 낮추고 contentHint를 detail로 준다.
  격자에서는 작게 보이므로 충분하고 문서와 코드 화면 선명도를 우선한다.
- 격자 셀은 지우고 다시 만들지 않는다. video 엘리먼트를 새로 만들면 재생이 끊긴다.
- 셀 수에 따라 열이 바뀐다. 1명 1열, 2~4명 2열, 5~10명 3열. 860 이하 2열, 420 이하 1열.
- 셀 크게 보기와 격자 전체 화면(빔프로젝터용)을 넣었다. 라이브 영상 위 칩은 backdrop-filter로만 낸다.

### 검증
- 시그널링 15개 항목 통과. 수락과 speakerId 전달, publisher-started 이름, participants publishers,
  offer answer가 channel과 from을 달고 전달, 시범 공유 기존 경로 유지,
  동시 10명 상한과 초과 거절 사유, 멈추면 자리 반환, 끊기면 정리, 강연자 이탈 시 전원 중단, 강연자 없으면 거절.
- 실제 미디어 12개 항목 통과(헤드리스 크롬 4대). 체험자 3명 화면이 격자 3셀로 실제 재생(playing 3),
  셀 3개에서 2열 배치, 셀 이름 표시, 크게 보기 contain 재생, 강연자 시범이 체험자에게 재생,
  시범 중에도 수신 유지, 한 명 나가면 셀 정리, getStats로 바이트 440KB와 디코드 프레임 124 확인, 콘솔 예외 0건.

### 남은 항목
- 격자 셀이 커서 3명부터 접힘 아래로 넘어간다. 6단계에서 뷰포트에 맞춰 묶는다.
- 실인원 리허설은 사람이 해야 한다. 헤드리스는 같은 기계 안이라 네트워크 조건이 실제와 다르다.

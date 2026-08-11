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

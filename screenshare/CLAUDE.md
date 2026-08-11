# CLAUDE.md — 이 프로젝트에서 클로드 코드가 지킬 규칙

동해 AI 교육용 실시간 화면 공유 + 실습 기록물 도구.
바닐라 JS + Express + ws + WebRTC. 빌드 없음. Render 단일 웹서비스로 배포.

## 세션 시작 시 읽는 순서
1. docs/SESSION_HEADER.md (프로젝트 문서 읽는 순서)
2. 아래 디자인 스킬 중 이번 작업에 해당하는 것
3. 코드: server.js, public/app.js, public/index.html, public/style.css

## 절대 규칙 (어기지 말 것)
- React/Vite/Vercel/Tailwind를 이 프로젝트에 강제하지 마라. 바닐라 단일 서비스다.
- WebRTC 시그널링(server.js의 ws 핸들러, app.js의 peerConnections/viewerPc)은 디자인 작업으로 건드리지 마라. UI만 바꾼다.
- 색·간격은 public/style.css의 :root 변수 경유. 새 색을 하드코딩하지 말고 토큰으로 추가한다.
- 이모지·가운데점(가운데 점)·줄표 금지. 아이콘은 인라인 SVG. 라벨은 능동태 한국어(예: 내 화면 공유하기, 기록물 올리기).
- 변경한 모든 줄은 요청과 직접 연결돼야 한다. 무관한 리팩터링 금지.
- 작업 후 docs/PROGRESS.md에 완료·남은 항목을 기록한다.

## 디자인 스킬 (.claude/skills/)
디자인·모션·폴리시 작업을 할 때 아래 스킬을 실제로 읽고 적용한다.

- apple-design — HIG 기반 유동 인터페이스 원칙. 응답 즉시성(pointer-down 피드백), 1:1 직접 조작, 인터럽트 가능한 스프링 모션, 반투명 재질과 깊이, 타이포(옵티컬 사이즈·트래킹·리딩), reduced-motion. 모션·제스처·시트·드래그·재질 작업의 기준.
- make-interfaces-feel-better — 폴리시 엔지니어링. 동심원 보더 радиус, 옵티컬 정렬, 구조는 보더·깊이는 그림자, 인터럽트 가능한 트랜지션, 아이콘 스트로크·상태, 타이포 디테일, 성능. 세부 파일: typography.md surfaces.md animations.md icons.md performance.md.
- animation-vocabulary / find-animation-opportunities / improve-animations / review-animations — 모션 언어, 어디에 모션을 넣을지 찾기, 개선, 리뷰. 과한 모션은 오히려 AI티가 난다는 원칙을 지킨다.
- emil-design-eng — 디자인 엔지니어링 관점 보강.

## liquidGL (refs/liquidGL/) — 리퀴드 글래스, 조건부로만 사용
refs/liquidGL/liquidGL.js 는 애플식 유리 굴절 효과 라이브러리다. 쓰기 전에 아래를 반드시 지킨다.

- 동작 방식: html2canvas로 페이지를 스냅샷 떠서 WebGL로 굴절시킨다. ESM이라 import가 필요하고 html2canvas 의존성이 있다.
- 금지: 라이브 화면 공유 뷰어(#remoteVideo, #viewerFrame) 위에 liquidGL을 깔지 마라. html2canvas는 재생 중인 video를 못 잡아서 유리에 영상이 안 비치고, 계속 스냅샷을 떠서 WebRTC 성능을 깎는다.
- 기본 재질 기법은 CSS backdrop-filter(blur + saturate)와 레이어드 하이라이트로 낸다. 이건 가볍고 video 위에서도 동작한다. 유리 느낌의 90%는 이걸로 충분하다.
- liquidGL은 정적 표면 한두 곳(입장 화면 배경 히어로, 참가자 패널 정도)에서 시그니처로만 검토한다. 넣기 전에 성능(프레임·CPU)을 측정하고, 애매하면 넣지 않는다.

## 디자인 디벨롭 절차
1. 계획: apple-design + make-interfaces-feel-better를 읽고, 지금 UI(입장/회의실/탭/폼/카드/모달)를 상태별(hover·focus·active·loading·empty)로 점검한다. 무엇이 어색한지 먼저 적는다.
2. 토큰·모션 안 짧게 제안하고 브리프와 대조해 AI 기본값처럼 보이는 부분을 걸러낸다.
3. 구현: style.css :root에 토큰 추가 → 컴포넌트 단위로 적용. 트랜지션은 인터럽트 가능하게(스프링 계열), 프레스 피드백은 pointer-down에. reduced-motion 존중.
4. 검증: 실제로 서버 띄워 브라우저에서 확인. 시그널링·기록물 기능이 그대로 도는지, 반응형(860/420)이 안 깨지는지 본다.

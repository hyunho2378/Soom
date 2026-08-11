# SESSION_HEADER.md — 새 세션 시작 시 읽을 순서

이 프로젝트에서 작업을 시작할 때 아래를 순서대로 읽는다. 스킬은 설명 매칭이라 항상 걸리지 않으므로 여기 명시한다.

[표준]
1. .claude/skills/fullstack-product-setup/SKILL.md (있으면)

[프로젝트 문서]
2. docs/DESIGN.md
3. docs/tokens.md (정본은 public/style.css :root)
4. docs/IA.md
5. docs/ROUTES.md (REST + WS 프로토콜)
6. docs/COMPONENTS.md
7. docs/PATTERNS.md
8. docs/PROGRESS.md

[디자인 스킬] (.claude/skills/, 디자인·모션 작업 시)
- apple-design (HIG 유동 인터페이스·모션 기준)
- make-interfaces-feel-better (폴리시 디테일: typography/surfaces/animations/icons/performance)
- animation-vocabulary / find-animation-opportunities / improve-animations / review-animations
- emil-design-eng
- 리퀴드 글래스 라이브러리는 refs/liquidGL/ (라이브 영상 뷰어 위 금지, backdrop-filter 우선)

[코드]
9. server.js
10. public/app.js
11. public/index.html
12. public/style.css

규칙
- 이 앱은 바닐라 JS + Express + ws 단일 서비스다. React/Vite/Vercel 기본값을 이 프로젝트에 강제하지 않는다.
- 색·간격은 style.css :root 변수 경유. 이모지·가운데점·줄표 금지. 능동태 한국어 라벨.
- 시그널링(WebRTC) 로직은 이유 없이 건드리지 않는다.
- 문서를 새로 만들거나 이름을 바꾸면 이 파일을 즉시 갱신한다.

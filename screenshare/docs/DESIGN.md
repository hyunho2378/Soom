# DESIGN.md — 동해 AI 교육 화면 공유 도구

## 플랫폼
- B형 반응형 웹. 320px ~ 데스크탑 전 구간 대응. 노트북 화면(수강생 6~7명)이 주 사용 환경.
- 단일 Node 서비스(Express 정적 + ws + REST). 클라이언트는 바닐라 JS(빌드 없음), 프론트/백 분리 없음.
- 배포는 Render 단일 웹서비스. Vite/React/Vercel을 쓰지 않으므로 vercel.json은 만들지 않는다(SPA 클라이언트 빌드가 없어 rewrites 대상이 없다).

## 스택 편차 고지 (fullstack-product-setup 기본값 대비)
- 기본값은 React+Vite+Tailwind지만 이 앱은 WebRTC 시그널링을 서버가 직접 붙잡아야 해서 단일 서버 바닐라 구조를 유지한다. 따라서 tokens.js 대신 style.css의 :root CSS 변수가 토큰 정본이고, React Router 대신 REST + WS 메시지 프로토콜이 라우팅이다.
- 유지하는 규율: 색상·간격 하드코딩 금지(변수 경유), 이모지 금지, 인라인 SVG 아이콘만, 능동태 한국어 라벨, 반응형 무결.

## 색상 팔레트 (정본: public/style.css :root)
| 역할 | 변수 | HEX |
| --- | --- | --- |
| 프라이머리 | --blue | #0053F0 |
| 프라이머리 다크 | --blue-dark | #0044C9 |
| 프라이머리 틴트 | --blue-tint | #E8EFFE |
| 본문 텍스트 | --ink | #1A1A1E |
| 서브 텍스트 | --sub | #6B6B72 |
| 배경 | --bg | #F5F6F8 |
| 카드 | --card | #FFFFFF |
| 라인 | --line | #E7E8EC |
| 성공 | --green | #16A34A |
| 경고·중지 | --red | #D92D20 |
| 트랙 B | --orange | #FF6B35 |
| 트랙 B 다크 | --orange-dark | #E24E18 |
| 트랙 B 틴트 | --orange-tint | #FFEDE5 |

트랙 A(기초) 기록물은 파랑 계열, 트랙 B(심화) 기록물은 주황 계열로 카드 좌측 액센트와 배지 색을 구분한다.

## 타이포그래피
- 폰트: Pretendard Variable(CDN). 대체 Pretendard, sans-serif.
- 큰 제목 letter-spacing 음수(-0.02em), 본문 0 근처. 제목은 타이트, 본문 line-height 1.5~1.6.
- 위계는 size + weight 조합으로 만든다(입장 h1 26/800, 룸 제목 16/800, 카드 요약 14/400 line-height 1.6).

## 간격·레이아웃
- 8pt 계열(6/8/10/12/14/16/18/20/24). 룸 본문 그리드 1fr / 260px(참가자 패널), 860px에서 1열로 접힘, 420px에서 폼 여백 축소·제출 버튼 전폭.
- 뷰어 프레임 aspect-ratio 16/9 고정. 가로 스크롤 전역 0.

## 아이콘·이모지
- 이모지 전면 금지. 드롭다운 화살표 등은 인라인 SVG. 트랙 구분은 색 점(track-dot)으로 표현.

## z-index 위계
| 층 | 값 | 요소 |
| --- | --- | --- |
| 드롭다운 패널 | 40 | 실습 항목 선택 |
| 초기화 모달 | 70 | 확인 문구 입력 |
| 라이트박스 | 80 | 이미지 확대 |

## 모션
- transition 150ms(background, color, transform, outline). 화살표 회전 transform:rotate. 발표중 표시 dot-live pulse 1.6s.
- layout·paint 유발 속성 애니메이션 금지. hover scale 금지.

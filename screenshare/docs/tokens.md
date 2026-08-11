# tokens.md — 디자인 토큰 (정본: public/style.css :root)

이 앱은 바닐라 CSS라 토큰 정본은 public/style.css 상단 :root 블록이다. tokens.js를 따로 두지 않는다(중복·표류 방지). 값 변경은 :root 한 곳만 고친다.

## colors
--blue #0053F0 / --blue-dark #0044C9 / --blue-tint #E8EFFE
--ink #1A1A1E / --sub #6B6B72
--bg #F5F6F8 / --card #FFFFFF / --line #E7E8EC
--green #16A34A / --red #D92D20
--orange #FF6B35 / --orange-dark #E24E18 / --orange-tint #FFEDE5

## typography
font-family: 'Pretendard Variable', 'Pretendard', sans-serif
제목 letter-spacing -0.02em, 본문 line-height 1.5~1.6

## spacing
8pt 계열: 6 8 10 12 14 16 18 20 24

## layout
룸 그리드 1fr / 260px, 최대 폭 1400px
뷰어 aspect-ratio 16/9

## z-index
드롭다운 40 / 모달 70 / 라이트박스 80

## motion
transition 150ms, dot-live pulse 1.6s, 화살표 rotate(180deg)

# COMPONENTS.md — 컴포넌트 목록

바닐라 구조라 별도 컴포넌트 파일은 없다. 마크업은 public/index.html, 스타일은 public/style.css, 동작은 public/app.js에 모여 있다. 아래는 논리적 컴포넌트 단위다.

| 컴포넌트 | 마크업 id/클래스 | 스타일 | 동작(app.js) |
| --- | --- | --- | --- |
| 입장 카드 | .join-card | join-screen 블록 | join() |
| 룸 헤더 | .room-header | room-header 블록 | renderParticipants, leaveBtn |
| 뷰 탭 | .view-tabs / #tabLive #tabRecords | view-tab 블록 | switchTab, 탭 배지 |
| 뷰어 프레임 | #viewerFrame #remoteVideo | viewer-frame 블록 | WebRTC ontrack, placeholder 토글 |
| 공유 컨트롤 | #shareBtn #shareStatus | btn-share 블록 | shareBtn 핸들러, stopSharing |
| 참가자 패널 | .participant-panel #participantList | participant 블록 | renderParticipants |
| 기록물 폼 | .record-form | record-form 블록 | submitRecordBtn 핸들러 |
| 커스텀 드롭다운 | #itemDropdown #itemPanel | dropdown 블록 | loadItems, buildDropdown, open/closeDropdown |
| 이미지 첨부 | #attachBtn #imageInput #previewList | attach-area 블록 | renderPreviews |
| 기록물 카드 | .record-card(.track-b) | record-card 블록 | addRecordCard, renderAllRecords |
| 라이트박스 | #lightbox | lightbox 블록 | openLightbox, closeLightbox |
| 초기화 모달 | #resetModal | modal 블록 | reset 핸들러 |

## 반응형 변형
- 룸 본문: 데스크탑 2열(뷰어 + 참가자), 860px 이하 1열(참가자 위로).
- 기록물 카드 이미지 그리드: minmax(96px, 1fr) auto-fill.
- 420px 이하: 폼 여백 축소, 제출 버튼 전폭.

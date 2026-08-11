# ROUTES.md — HTTP 라우트 + WebSocket 메시지 프로토콜

React Router가 없다. 이 앱의 라우팅은 아래 REST 엔드포인트와 WS 메시지 타입이다.

## HTTP (Express)
| 메서드 | 경로 | 용도 | 비고 |
| --- | --- | --- | --- |
| GET | / (정적) | index.html 등 public/ 서빙 | |
| GET | /uploads/:file | 업로드 이미지 서빙 | UPLOAD_DIR 정적 |
| GET | /api/items | 실습 항목 정본 목록 | 드롭다운·트랙 색 |
| POST | /api/records | 기록물 등록(multipart) | multer array images 최대 10장, 장당 5MB, image/* 만 |
| POST | /api/records/reset | 방 기록물 전체 삭제(JSON) | confirm 이 초기화 일치해야 실행 |

## WebSocket 메시지
### 클라이언트 → 서버
| type | 필드 | 용도 |
| --- | --- | --- |
| join | id, room, name | 입장 |
| start-share | | 발표 시작(이전 발표자 자동 중지) |
| stop-share | | 발표 중지 |
| offer / answer / ice | to, sdp/candidate | WebRTC 시그널 중계 |

### 서버 → 클라이언트
| type | 필드 | 용도 |
| --- | --- | --- |
| participants | list, broadcasterId | 참가자·발표자 갱신 |
| broadcaster-changed | broadcasterId, name | 발표자 변경 |
| you-are-broadcaster | viewerIds | 내가 발표자가 됨 |
| new-viewer | id | 새 시청자에게 연결 생성 |
| force-stop-share | | 발표권 넘어가 강제 중지 |
| offer / answer / ice | from, sdp/candidate | 시그널 전달 |
| records-init | list | 입장 시 방 기존 기록물 |
| record-added | record | 새 기록물 실시간 푸시 |
| records-reset | | 기록물 전체 초기화 알림 |

## 권한
- 계정·로그인 없음. 초기화는 확인 문구 입력으로만 게이트(진행자 신뢰 모델). 방 격리는 room 이름 기준.

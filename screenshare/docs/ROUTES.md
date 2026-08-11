# ROUTES.md — HTTP 라우트 + WebSocket 메시지 프로토콜

React Router가 없다. 이 앱의 라우팅은 아래 REST 엔드포인트와 WS 메시지 타입이다.
방은 4자리 코드로만 존재하고, 역할(강연자/체험자)은 서버가 세션으로 판정한다.

## HTTP (Express)
| 메서드 | 경로 | 용도 | 비고 |
| --- | --- | --- | --- |
| GET | / (정적) | index.html 등 public/ 서빙 | |
| GET | /auth/google | 구글 동의 화면으로 리다이렉트 | scope: profile, email |
| GET | /auth/google/callback | 코드 검증, users upsert, 세션 저장 후 / 로 | |
| POST | /auth/logout | 세션 파기 | |
| GET | /api/me | 세션 유저와 canSpeak, googleReady 반환 | 입장 화면 분기 기준 |
| POST | /api/rooms | 방 만들기, 4자리 코드 발급 | 강연자 전용. 이전 활성 방은 자동 종료 |
| POST | /api/rooms/close | 자기 방 종료 | 강연자 전용 |
| GET | /api/rooms/:code | 코드 유효성 확인 | active 아니면 404 |
| GET | /api/my-room | 강연자 새로고침 시 코드 복구 | 강연자 전용 |
| GET | /api/items | 실습 항목 정본 목록 | 드롭다운, 트랙 색 |
| POST | /api/records | 기록물 등록(multipart, 필드명 files) | 최대 10개. 이미지 5MB, 문서 15MB. 허용: png jpg webp gif, md, pdf, docx, html, txt. 파일은 Vercel Blob에, 메타는 DB에 저장 |
| POST | /api/records/reset | 방 기록물 전체 삭제(JSON) | 강연자 전용 + confirm 이 초기화 일치. DB와 Blob 함께 삭제 |

- multer 단계에서 거절돼도(용량, 개수, 모르는 필드) JSON 오류로 응답한다.
- 세션은 connect-pg-simple로 Neon에 저장한다. 부팅 때 세션 표와 활성 방을 미리 준비한다.

## WebSocket 메시지
업그레이드 시 서버가 세션을 읽어 역할을 재판정한다. 클라가 role을 실어 보내도 무시된다.

### 클라이언트 → 서버
| type | 필드 | 용도 |
| --- | --- | --- |
| join | id, room(4자리 코드), name | 입장. 없는 코드는 거절 |
| start-publish | | 체험자가 자기 화면을 강연자에게 보내기 시작(N대 1) |
| stop-publish | | 위 공유 중지 |
| start-share | | 강연자 시범 공유 시작(1대 N, 기존 경로) |
| stop-share | | 시범 공유 중지 |
| offer / answer / ice | to, channel, sdp/candidate | WebRTC 시그널 중계. channel은 publish 또는 demo |

### 서버 → 클라이언트
| type | 필드 | 용도 |
| --- | --- | --- |
| joined | room, role | 입장 확정. 이걸 받아야 회의실로 넘어간다 |
| join-rejected | reason | 없는 코드 등 입장 거절 |
| room-closed | reason | 강연자가 방을 닫음. 체험자 정리 |
| participants | list(id, name, role), broadcasterId, publishers | 참가자, 시범자, 공유자 갱신 |
| publish-accepted | speakerId | 공유 수락. 체험자가 이걸 받고 offer를 만든다 |
| publish-rejected | reason | 강연자 부재 또는 동시 10명 초과 |
| publish-ended | reason | 강연자 이탈로 공유 강제 종료 |
| publisher-started | id, name | 강연자에게: 격자에 셀 추가 |
| publisher-stopped | id | 강연자에게: 셀 제거 |
| you-are-broadcaster | viewerIds | 시범 공유 시작. 체험자별 연결 생성 |
| broadcaster-changed | broadcasterId, name | 시범자 변경 |
| new-viewer | id | 시범 중 새 체험자 입장 |
| force-stop-share | | 시범 강제 중지 |
| offer / answer / ice | from, channel, sdp/candidate | 시그널 전달 |
| records-init | list | 입장 시 방 기존 기록물(DB에서 로드) |
| record-added | record | 새 기록물 실시간 푸시 |
| records-reset | | 기록물 전체 초기화 알림 |

## 기록물 record 모양
```
{ id, name, itemCode, itemLabel, track, summary, createdAt,
  files: [{ url, filename, mimeType, size, kind }] }   // kind: image | markdown | document
```

## 권한
- 강연자 = 구글 로그인 유저(ADMIN_EMAILS가 있으면 그 메일만). 방 만들기, 방 종료, 기록물 초기화, 격자 수신.
- 체험자 = 코드 + 이름 입장. 자기 화면을 강연자에게 공유, 기록물 올리기.
- 방 격리는 4자리 코드 기준. 방은 강연자가 만들 때만 생기고, 강연자가 닫거나 새 방을 열 때만 사라진다.

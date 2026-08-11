# 동해 AI 교육 화면 공유 도구

실시간 화면 공유 웹앱. 발표자 한 명의 화면을 방 전원이 실시간으로 본다.
화상·마이크·채팅 없이 화면 공유만. 계정 가입 없음. 여기에 더해 수강생이 실습 결과를
남기는 실습 기록물 기능이 있다.

## 로컬 실행
```
npm install
npm start
```
http://localhost:3000 접속. 두 개의 브라우저 탭(또는 다른 기기)에서 같은 방 이름으로 입장해 테스트.

## 구조
- `server.js` : Express 정적 서빙 + ws 시그널링 + 실습 기록물 REST. 실제 영상은 P2P라 서버를 안 거친다.
- `public/index.html` : 입장 화면 + 회의실 화면(실시간 화면 / 실습 기록물 탭)
- `public/style.css` : 스타일 (Pretendard, 프라이머리 #0053F0, 트랙 B 주황 #FF6B35)
- `public/app.js` : WebRTC + 기록물 로직
- `uploads/` : 업로드 이미지 저장(런타임 생성, git 미추적)
- `data/records.json` : 기록물 영속화 파일(런타임 생성, git 미추적)
- `docs/` : 설계 문서(DESIGN/IA/ROUTES/COMPONENTS/PATTERNS/tokens/PROGRESS/SESSION_HEADER)

## 실습 기록물
- 회의실에서 실습 기록물 탭 선택.
- 이름(입장 시 값 재사용) + 실습 항목(트랙 A 파랑 / 트랙 B 주황) + 결과 요약 + 이미지 여러 장 첨부 후 올리기.
- 올린 기록물은 방 전원에게 실시간 카드로 뜬다. 다른 탭에 있으면 탭에 새 건수 배지 표시.
- 진행자는 전체 초기화로 방 기록물을 비운다(확인 문구 초기화 입력 필요).

### 기록물 동작 확인
1. 같은 방으로 브라우저 두 개 입장.
2. 한쪽에서 실습 기록물 탭 → 항목 선택 → 요약 입력 → 이미지 첨부하기로 스크린샷 첨부 → 올리기.
3. 다른 쪽 화면에 카드가 수 초 내 자동으로 뜨는지 확인. 카드 이미지를 눌러 확대(라이트박스)되는지 확인.
4. `uploads/`에 이미지 파일, `data/records.json`에 기록이 쌓이는지 확인.
5. 전체 초기화 후 양쪽 목록이 함께 비워지는지 확인.

## 배포 (Render)
1. 이 폴더를 깃허브 저장소로 올린다.
2. Render에서 New > Web Service > 저장소 연결.
3. Build Command: `npm install` / Start Command: `npm start`
4. 무료 플랜 선택. 배포 후 발급된 주소를 수강생에게 공유.

### 배포 시 이미지·기록물 저장 주의 (중요)
- Render 무료 플랜의 디스크는 휘발성이다. 재배포·수면 후 재기동 시 `uploads/` 이미지와 `data/records.json`이 사라질 수 있다.
- 강의 세션 중에는 유지되지만 세션을 넘겨 보존하려면 아래 중 하나를 쓴다.
  - Render Persistent Disk(유료)를 `/uploads`와 `/data`에 마운트.
  - 이미지를 외부 스토리지(예: 오브젝트 스토리지)로 올리고 URL만 저장.
  - 텍스트 기록만이라도 SQLite(better-sqlite3)로 바꿔 파일 하나로 보존(단 무료 디스크면 이 파일도 휘발).
- 강의 회차별로 기록물이 남아도 되면 지금 구조(JSON + uploads)로 충분하고, 회차 끝에 전체 초기화로 비우면 된다.

## 막힌 네트워크 대응
회사·기관 와이파이에서 화면이 안 뜨면 TURN 서버가 필요하다.
`public/app.js`의 `ICE_SERVERS` 배열에 무료 TURN(Metered/OpenRelay 등, 가입 후 발급)을 추가한다.

// 동해 AI 교육용 실시간 화면 공유 도구 — 시그널링 + 실습 기록물 서버
// 실제 화면 영상은 참가자 컴퓨터끼리 직접(P2P) 주고받는다.
// 이 서버는 "누가 방에 있는지", "누가 지금 발표자인지"와 WebRTC 연결에 필요한
// 신호(offer/answer/ice)만 중계한다. 영상 데이터 자체는 서버를 거치지 않는다.
// 여기에 더해 실습 기록물(이미지 포함) 게시를 REST + WebSocket으로 처리한다.

const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

// 업로드 이미지와 기록물 영속화 파일 경로. 없으면 만든다.
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_DIR = path.join(__dirname, "data");
const RECORDS_FILE = path.join(DATA_DIR, "records.json");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// 실습 항목 정본. 라벨과 트랙은 서버가 이 목록으로만 판단한다(클라이언트 값은 코드만 신뢰).
const PRACTICE_ITEMS = [
  { code: "A01", label: "A01 바로11 웹검색", track: "A" },
  { code: "A02", label: "A02 바로12 연구모드", track: "A" },
  { code: "A03", label: "A03 바로13 프로젝트만들기", track: "A" },
  { code: "A04", label: "A04 바로14 프로젝트자료생성", track: "A" },
  { code: "A05", label: "A05 바로25 구글드라이브", track: "A" },
  { code: "A06", label: "A06 바로26 지메일", track: "A" },
  { code: "A07", label: "A07 바로31 크롬조작", track: "A" },
  { code: "A08", label: "A08 바로38 사용자지정", track: "A" },
  { code: "A09", label: "A09 바로44 동해뉴스브리핑스킬", track: "A" },
  { code: "A10", label: "A10 바로51 한글변환스킬", track: "A" },
  { code: "B01", label: "B01 바로68 깃허브연결", track: "B" },
  { code: "B02", label: "B02 바로69 깃허브페이지스배포", track: "B" },
  { code: "B03", label: "B03 바로71 웹앱하네스", track: "B" },
  { code: "B04", label: "B04 바로72 에이전트평가", track: "B" },
  { code: "B05", label: "B05 바로78 브랜드만들기", track: "B" },
  { code: "B06", label: "B06 바로79 서비스디자인", track: "B" },
  { code: "B07", label: "B07 바로82 홍보영상", track: "B" },
];
const ITEM_MAP = new Map(PRACTICE_ITEMS.map((it) => [it.code, it]));

// roomId -> [record, ...]. 참가자가 모두 나가도 기록물은 유지한다.
let roomRecords = loadRecords();

function loadRecords() {
  try {
    const obj = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf-8"));
    return new Map(Object.entries(obj));
  } catch (e) {
    return new Map();
  }
}

function saveRecords() {
  try {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(Object.fromEntries(roomRecords), null, 2));
  } catch (e) {
    console.error("기록물 저장 실패:", e.message);
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// 이미지 업로드는 multer가 받아 uploads/에 저장한다.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }, // 장당 5MB, 최대 10장
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// roomId -> { clients: Map(clientId -> {ws, name}), broadcasterId: string|null }
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { clients: new Map(), broadcasterId: null });
  }
  return rooms.get(roomId);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// 방 안 모든 참가자에게 같은 메시지를 보낸다(기록물 실시간 반영용).
function broadcastToRoom(roomId, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [, c] of room.clients) send(c.ws, msg);
}

function broadcastParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const list = Array.from(room.clients.entries()).map(([id, c]) => ({
    id,
    name: c.name,
  }));
  for (const [, c] of room.clients) {
    send(c.ws, { type: "participants", list, broadcasterId: room.broadcasterId });
  }
}

function stopBroadcast(roomId, notifyOldBroadcaster) {
  const room = rooms.get(roomId);
  if (!room || !room.broadcasterId) return;
  const oldId = room.broadcasterId;
  room.broadcasterId = null;
  if (notifyOldBroadcaster) {
    const old = room.clients.get(oldId);
    if (old) send(old.ws, { type: "force-stop-share" });
  }
  for (const [, c] of room.clients) {
    send(c.ws, { type: "broadcaster-changed", broadcasterId: null, name: null });
  }
}

// ── 실습 기록물 REST ──

// 드롭다운·색상 구분에 쓸 실습 항목 정본을 내려준다.
app.get("/api/items", (req, res) => {
  res.json(PRACTICE_ITEMS);
});

// 기록물 올리기. 이미지 여러 장 포함(multipart/form-data).
app.post("/api/records", upload.array("images", 10), (req, res) => {
  const room = String(req.body.room || "").trim();
  const name = String(req.body.name || "익명").trim().slice(0, 20) || "익명";
  const itemCode = String(req.body.itemCode || "").trim();
  const summary = String(req.body.summary || "").trim().slice(0, 2000);
  const item = ITEM_MAP.get(itemCode);
  const files = req.files || [];

  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));

  if (!room || !item) {
    cleanup();
    return res.status(400).json({ error: "방 이름과 실습 항목을 확인하세요." });
  }
  if (!summary && files.length === 0) {
    cleanup();
    return res.status(400).json({ error: "결과 요약이나 이미지를 하나 이상 올리세요." });
  }

  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    itemCode: item.code,
    itemLabel: item.label, // 라벨은 서버 정본에서만 만든다.
    track: item.track,
    summary,
    images: files.map((f) => `/uploads/${f.filename}`),
    createdAt: Date.now(),
  };

  const list = roomRecords.get(room) || [];
  list.push(record);
  roomRecords.set(room, list);
  saveRecords();

  broadcastToRoom(room, { type: "record-added", record });
  res.json({ ok: true, record });
});

// 진행자용 전체 초기화. 확인 문구가 정확히 일치할 때만 실행한다.
app.post("/api/records/reset", (req, res) => {
  const room = String(req.body.room || "").trim();
  const confirm = String(req.body.confirm || "").trim();
  if (!room) return res.status(400).json({ error: "방 정보가 없습니다." });
  if (confirm !== "초기화") {
    return res.status(400).json({ error: "확인 문구가 일치하지 않습니다." });
  }

  const list = roomRecords.get(room) || [];
  list.forEach((r) =>
    (r.images || []).forEach((url) => {
      fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
    })
  );
  roomRecords.set(room, []);
  saveRecords();

  broadcastToRoom(room, { type: "records-reset" });
  res.json({ ok: true });
});

wss.on("connection", (ws) => {
  let currentRoomId = null;
  let clientId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (msg.type === "join") {
      currentRoomId = String(msg.room || "기본방").trim() || "기본방";
      clientId = String(msg.id || "").trim();
      const name = String(msg.name || "익명").trim().slice(0, 20) || "익명";
      if (!clientId) return;

      const room = getRoom(currentRoomId);
      room.clients.set(clientId, { ws, name });
      broadcastParticipants(currentRoomId);

      // 이 방의 기존 기록물을 새로 들어온 사람에게 보낸다.
      send(ws, { type: "records-init", list: roomRecords.get(currentRoomId) || [] });

      // 이미 발표 중인 사람이 있으면, 새로 들어온 사람에게 알려준다.
      if (room.broadcasterId && room.broadcasterId !== clientId) {
        const bc = room.clients.get(room.broadcasterId);
        if (bc) {
          send(ws, { type: "broadcaster-changed", broadcasterId: room.broadcasterId, name: bc.name });
          // 발표자에게는 새 시청자가 왔음을 알려 연결을 만들게 한다.
          send(bc.ws, { type: "new-viewer", id: clientId });
        }
      }
      return;
    }

    if (!currentRoomId || !clientId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (msg.type === "start-share") {
      // 이미 다른 발표자가 있으면 자동으로 넘겨받는다.
      if (room.broadcasterId && room.broadcasterId !== clientId) {
        stopBroadcast(currentRoomId, true);
      }
      room.broadcasterId = clientId;
      const me = room.clients.get(clientId);
      const viewerIds = Array.from(room.clients.keys()).filter((id) => id !== clientId);

      send(ws, { type: "you-are-broadcaster", viewerIds });
      for (const [id, c] of room.clients) {
        if (id === clientId) continue;
        send(c.ws, { type: "broadcaster-changed", broadcasterId: clientId, name: me ? me.name : "발표자" });
      }
      return;
    }

    if (msg.type === "stop-share") {
      if (room.broadcasterId === clientId) {
        stopBroadcast(currentRoomId, false);
      }
      return;
    }

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      const target = room.clients.get(msg.to);
      if (target) {
        send(target.ws, { ...msg, from: clientId });
      }
      return;
    }
  });

  ws.on("close", () => {
    if (!currentRoomId || !clientId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.clients.delete(clientId);
    if (room.broadcasterId === clientId) {
      stopBroadcast(currentRoomId, false);
    }
    if (room.clients.size === 0) {
      rooms.delete(currentRoomId);
    } else {
      broadcastParticipants(currentRoomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

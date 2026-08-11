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
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { put: blobPut, del: blobDel } = require("@vercel/blob");
const db = require("./db");

// 업로드 이미지와 기록물 영속화 파일 경로. 없으면 만든다.
// 파일은 Vercel Blob에 올린다. 로컬 디스크에는 아무것도 안 남긴다(Render 재배포에도 살아남게).
const DATA_DIR = path.join(__dirname, "data");
const RECORDS_FILE = path.join(DATA_DIR, "records.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const blobReady = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
if (!blobReady) {
  console.warn("파일 업로드 꺼짐: BLOB_READ_WRITE_TOKEN이 비어 있습니다.");
}

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

// ── 세션과 구글 로그인 ──
// 세션은 Neon에 저장한다. DB가 없으면 메모리 세션으로 떨어져 로컬에서만 동작한다.
const sessionStore = db.isEnabled()
  ? new (require("connect-pg-simple")(session))({ pool: db.getPool(), createTableIfMissing: true })
  : undefined;

const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || "개발용 임시 비밀키",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 12 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// 세션에는 최소 정보만 담는다. WS 업그레이드에서 DB를 다시 안 치기 위해서다.
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ADMIN_EMAILS가 있으면 그 메일만 강연자로 인정한다. 비어 있으면 로그인한 사람이 곧 강연자다.
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function canSpeak(user) {
  if (!user) return false;
  if (!ADMIN_EMAILS.length) return true;
  return ADMIN_EMAILS.includes(String(user.email || "").toLowerCase());
}

const googleReady = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && db.isEnabled()
);

if (googleReady) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value : "";
          const name = profile.displayName || email.split("@")[0] || "강연자";
          const { rows } = await db.query(
            `INSERT INTO users (google_id, email, name)
             VALUES ($1, $2, $3)
             ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
             RETURNING id, email, name`,
            [profile.id, email, name]
          );
          done(null, rows[0]);
        } catch (e) {
          done(e);
        }
      }
    )
  );
} else {
  console.warn("구글 로그인 꺼짐: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DATABASE_URL을 모두 채워야 켜집니다.");
}

app.get("/auth/google", (req, res, next) => {
  if (!googleReady) return res.status(503).send("구글 로그인이 아직 설정되지 않았습니다.");
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!googleReady) return res.redirect("/");
    passport.authenticate("google", { failureRedirect: "/?login=failed" })(req, res, next);
  },
  (req, res) => res.redirect("/")
);

app.post("/auth/logout", (req, res) => {
  const done = () => req.session.destroy(() => res.json({ ok: true }));
  req.logout ? req.logout(done) : done();
});

// 클라가 입장 화면에서 로그인 상태를 판단하는 창구.
app.get("/api/me", (req, res) => {
  const user = req.user || null;
  res.json({
    user: user ? { id: user.id, name: user.name, email: user.email } : null,
    canSpeak: canSpeak(user),
    googleReady,
  });
});

// ── 방(코드 기반 입장) ──
// 실시간 상태는 아래 rooms Map에 두고, DB rooms 표는 강연자 새로고침 시 코드 복구용이다.

function requireSpeaker(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "강연자로 로그인해야 합니다." });
  if (!canSpeak(req.user)) return res.status(403).json({ error: "강연자 권한이 없는 계정입니다." });
  next();
}

// 활성 방과 겹치지 않는 4자리 코드를 뽑는다.
function newRoomCode() {
  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (!rooms.has(code)) return code;
  }
  throw new Error("빈 방 코드를 찾지 못했습니다.");
}

// 방을 닫는다. 안에 있던 체험자에게 알리고 연결 상태를 정리한다.
async function closeRoom(code, reason) {
  const room = rooms.get(code);
  if (room) {
    for (const [, c] of room.clients) {
      send(c.ws, { type: "room-closed", reason: reason || "방이 종료되었습니다." });
    }
    rooms.delete(code);
  }
  if (db.isEnabled()) {
    await db
      .query("UPDATE rooms SET active = false, closed_at = now() WHERE code = $1 AND active = true", [code])
      .catch((e) => console.error("방 종료 기록 실패:", e.message));
  }
}

app.post("/api/rooms", requireSpeaker, async (req, res) => {
  try {
    // 강연자당 활성 방은 하나다. 새로 만들면 이전 방은 종료된다.
    if (db.isEnabled()) {
      const { rows } = await db.query(
        "SELECT code FROM rooms WHERE speaker_user_id = $1 AND active = true",
        [req.user.id]
      );
      for (const r of rows) await closeRoom(r.code, "강연자가 새 방을 열었습니다.");
    }
    const code = newRoomCode();
    rooms.set(code, { clients: new Map(), broadcasterId: null, speakerUserId: req.user.id });
    if (db.isEnabled()) {
      await db.query("INSERT INTO rooms (code, speaker_user_id) VALUES ($1, $2)", [code, req.user.id]);
    }
    res.json({ code });
  } catch (e) {
    console.error("방 만들기 실패:", e.message);
    res.status(500).json({ error: "방을 만들지 못했습니다." });
  }
});

app.post("/api/rooms/close", requireSpeaker, async (req, res) => {
  const code = String(req.body.code || "").trim();
  const room = rooms.get(code);
  if (room && room.speakerUserId !== req.user.id) {
    return res.status(403).json({ error: "이 방의 강연자가 아닙니다." });
  }
  await closeRoom(code, "강연자가 방을 종료했습니다.");
  res.json({ ok: true });
});

// 체험자가 코드를 넣었을 때 입장 전에 확인한다.
app.get("/api/rooms/:code", (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!rooms.has(code)) return res.status(404).json({ error: "그런 방이 없습니다." });
  res.json({ ok: true, code });
});

// 강연자가 새로고침해도 자기 방 코드를 되찾는다.
app.get("/api/my-room", requireSpeaker, (req, res) => {
  for (const [code, room] of rooms) {
    if (room.speakerUserId === req.user.id) return res.json({ code });
  }
  res.json({ code: null });
});

// multer는 메모리로만 받는다. 디스크를 안 거치고 버퍼를 그대로 Blob에 올린다.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }, // 장당 5MB, 최대 10장
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// multer는 파일명을 latin1로 읽어준다. 한글 이름이 깨지므로 UTF-8로 되돌린다.
function decodeName(originalname) {
  const raw = Buffer.from(String(originalname || ""), "latin1").toString("utf8");
  return path.basename(raw).slice(0, 80) || "파일";
}

// 버퍼를 Blob에 올리고 공개 URL을 돌려준다.
async function putToBlob(file) {
  const safeName = decodeName(file.originalname);
  const result = await blobPut(safeName, file.buffer, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.mimetype,
  });
  return result.url;
}

// Blob에서 파일을 지운다. 실패해도 흐름을 멈추지 않는다.
async function removeFromBlob(urls) {
  if (!blobReady || !urls.length) return;
  await blobDel(urls).catch((e) => console.error("Blob 삭제 실패:", e.message));
}

const server = http.createServer(app);

// 업그레이드에서 세션을 읽어야 역할을 서버가 재검증할 수 있다. 그래서 noServer로 붙인다.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  sessionMiddleware(req, {}, () => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const sessionUser = req.session && req.session.passport ? req.session.passport.user : null;
      wss.emit("connection", ws, req, sessionUser);
    });
  });
});

// code -> { clients: Map(clientId -> {ws, name, role}), broadcasterId, speakerUserId }
// 방은 POST /api/rooms 로만 생긴다. 없는 코드는 입장이 거절된다.
const rooms = new Map();

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
    role: c.role || "viewer",
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
app.post("/api/records", upload.array("images", 10), async (req, res) => {
  const room = String(req.body.room || "").trim();
  const name = String(req.body.name || "익명").trim().slice(0, 20) || "익명";
  const itemCode = String(req.body.itemCode || "").trim();
  const summary = String(req.body.summary || "").trim().slice(0, 2000);
  const item = ITEM_MAP.get(itemCode);
  const files = req.files || [];

  // 메모리로만 받았으므로 거절할 때 지울 디스크 파일이 없다.
  if (!room || !item) {
    return res.status(400).json({ error: "방 이름과 실습 항목을 확인하세요." });
  }
  if (!summary && files.length === 0) {
    return res.status(400).json({ error: "결과 요약이나 이미지를 하나 이상 올리세요." });
  }
  if (files.length && !blobReady) {
    return res.status(503).json({ error: "파일 저장소가 아직 설정되지 않았습니다." });
  }

  let images = [];
  try {
    images = await Promise.all(files.map(putToBlob));
  } catch (e) {
    console.error("Blob 업로드 실패:", e.message);
    await removeFromBlob(images);
    return res.status(502).json({ error: "파일을 저장하지 못했습니다. 다시 시도하세요." });
  }

  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    itemCode: item.code,
    itemLabel: item.label, // 라벨은 서버 정본에서만 만든다.
    track: item.track,
    summary,
    images,
    createdAt: Date.now(),
  };

  const list = roomRecords.get(room) || [];
  list.push(record);
  roomRecords.set(room, list);
  saveRecords();

  broadcastToRoom(room, { type: "record-added", record });
  res.json({ ok: true, record });
});

// 강연자용 전체 초기화. 확인 문구가 정확히 일치할 때만 실행한다.
app.post("/api/records/reset", requireSpeaker, async (req, res) => {
  const room = String(req.body.room || "").trim();
  const confirm = String(req.body.confirm || "").trim();
  if (!room) return res.status(400).json({ error: "방 정보가 없습니다." });
  if (confirm !== "초기화") {
    return res.status(400).json({ error: "확인 문구가 일치하지 않습니다." });
  }

  const list = roomRecords.get(room) || [];
  await removeFromBlob(list.flatMap((r) => r.images || []));
  roomRecords.set(room, []);
  saveRecords();

  broadcastToRoom(room, { type: "records-reset" });
  res.json({ ok: true });
});

wss.on("connection", (ws, req, sessionUser) => {
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
      const code = String(msg.room || "").trim();
      clientId = String(msg.id || "").trim();
      const name = String(msg.name || "익명").trim().slice(0, 20) || "익명";
      if (!clientId) return;

      // 없는 코드는 즉시 거절한다. 방은 강연자가 만들 때만 생긴다.
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: "join-rejected", reason: "그런 방이 없습니다. 코드를 다시 확인하세요." });
        return;
      }

      // 클라가 role을 실어 보내도 믿지 않는다. 세션으로 다시 판정한다.
      const isSpeaker = Boolean(sessionUser) && canSpeak(sessionUser) && room.speakerUserId === sessionUser.id;
      currentRoomId = code;
      room.clients.set(clientId, { ws, name, role: isSpeaker ? "speaker" : "viewer" });
      if (isSpeaker) room.speakerWsId = clientId;
      send(ws, { type: "joined", room: code, role: isSpeaker ? "speaker" : "viewer" });
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
    if (room.speakerWsId === clientId) room.speakerWsId = null;
    // 방은 비어도 지우지 않는다. 강연자가 새로고침해도 코드가 살아 있어야 한다.
    // 방을 없애는 길은 POST /api/rooms/close 와 강연자가 새 방을 여는 경우뿐이다.
    broadcastParticipants(currentRoomId);
  });
});

const PORT = process.env.PORT || 3000;

// connect-pg-simple은 세션 표를 첫 세션 저장 때 만든다. 그러면 실패가 하필 첫 로그인 순간에 드러난다.
// 부팅 때 한 번 건드려 미리 만들고, 실패하면 여기서 로그로 잡는다.
function warmSessionStore() {
  if (!sessionStore) return Promise.resolve(false);
  return new Promise((resolve) => {
    sessionStore.get("부팅확인", (err) => {
      if (err) console.error("세션 표 준비 실패:", err.message);
      resolve(!err);
    });
  });
}

// DB 연결과 스키마 적용을 끝낸 뒤 듣기 시작한다. DB가 없어도 서버는 뜬다.
db.init().then(async (ok) => {
  const sess = await warmSessionStore();
  server.listen(PORT, () => {
    console.log(
      `서버 실행 중: http://localhost:${PORT} (DB ${ok ? "연결됨" : "미연결"}, 세션 ${sess ? "DB 저장" : "메모리"})`
    );
  });
});

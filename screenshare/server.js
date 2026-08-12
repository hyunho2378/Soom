// 동해 AI 교육용 실시간 화면 공유 도구 — 시그널링 + 실습 기록물 서버
// 실제 화면 영상은 참가자 컴퓨터끼리 직접(P2P) 주고받는다.
// 이 서버는 "누가 방에 있는지", "누가 지금 발표자인지"와 WebRTC 연결에 필요한
// 신호(offer/answer/ice)만 중계한다. 영상 데이터 자체는 서버를 거치지 않는다.
// 여기에 더해 실습 기록물(이미지 포함) 게시를 REST + WebSocket으로 처리한다.

const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const path = require("path");
const multer = require("multer");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { put: blobPut, del: blobDel } = require("@vercel/blob");
const db = require("./db");

// 업로드 이미지와 기록물 영속화 파일 경로. 없으면 만든다.
// 파일은 Vercel Blob에 올린다. 로컬 디스크에는 아무것도 안 남긴다(Render 재배포에도 살아남게).
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

// 정본은 DB의 records와 record_files다. 아래 Map은 방마다 한 번만 읽어 두는 캐시다.
// 키는 rooms.id를 문자열로 만든 값이다. 코드는 방을 닫으면 재사용되므로 키로 쓰면 안 된다.
// DB가 없으면 이 Map만으로 동작한다(영속화 없음).
const roomRecords = new Map();

// DB 행을 클라이언트가 쓰는 모양으로 바꾼다.
function toRecord(row, files) {
  return {
    id: String(row.id),
    name: row.author_name,
    itemCode: row.item_code,
    itemLabel: row.item_label,
    track: row.track,
    summary: row.summary || "",
    files: files.map((f) => ({
      url: f.blob_url,
      filename: f.filename,
      mimeType: f.mime_type,
      size: Number(f.size_bytes),
      kind: f.kind,
    })),
    createdAt: new Date(row.created_at).getTime(),
  };
}

// 방 기록물을 처음 볼 때 DB에서 한 번 읽어 캐시에 채운다. roomId는 rooms.id 문자열이다.
async function loadRoomRecords(roomId) {
  if (roomRecords.has(roomId)) return roomRecords.get(roomId);
  if (!db.isEnabled()) {
    roomRecords.set(roomId, []);
    return [];
  }
  try {
    const { rows } = await db.query(
      "SELECT * FROM records WHERE room_id = $1 ORDER BY created_at, id",
      [roomId]
    );
    const ids = rows.map((r) => r.id);
    const filesByRecord = new Map(ids.map((id) => [String(id), []]));
    if (ids.length) {
      const { rows: fileRows } = await db.query(
        "SELECT * FROM record_files WHERE record_id = ANY($1::bigint[]) ORDER BY id",
        [ids]
      );
      fileRows.forEach((f) => filesByRecord.get(String(f.record_id)).push(f));
    }
    const list = rows.map((r) => toRecord(r, filesByRecord.get(String(r.id))));
    roomRecords.set(roomId, list);
    return list;
  } catch (e) {
    console.error(`[API] error route:loadRoomRecords status:500 message:${e.message}`);
    roomRecords.set(roomId, []);
    return [];
  }
}

// 기록물 한 건을 DB에 넣고 클라이언트 모양으로 돌려준다.
async function insertRecord({ roomId, name, userId, item, summary, files }) {
  if (!db.isEnabled()) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      itemCode: item.code,
      itemLabel: item.label,
      track: item.track,
      summary,
      files,
      createdAt: Date.now(),
    };
  }
  const { rows } = await db.query(
    `INSERT INTO records (room_id, author_name, author_user_id, item_code, item_label, track, summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [roomId, name, userId, item.code, item.label, item.track, summary]
  );
  const row = rows[0];
  const saved = [];
  for (const f of files) {
    const { rows: fr } = await db.query(
      `INSERT INTO record_files (record_id, blob_url, filename, mime_type, size_bytes, kind)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [row.id, f.url, f.filename, f.mimeType, f.size, f.kind]
    );
    saved.push(fr[0]);
  }
  return toRecord(row, saved);
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const app = express();
// Render는 리버스 프록시 뒤에서 돈다. 이게 없으면 세션 쿠키 secure가 안 먹고 req.protocol이 늘 http로 잡힌다.
app.set("trust proxy", 1);
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
  cookie: {
    // 배포(HTTPS)에서만 secure를 켠다. 로컬은 http라 켜면 쿠키가 아예 안 붙는다.
    secure: IS_PRODUCTION,
    sameSite: "lax",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
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
          console.log(`[Auth] login userId:${rows[0].id} email:${rows[0].email}`);
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

// Render Health Check Path 대상. 콜드 스타트 깨우기에도 쓴다.
app.get("/health", async (req, res) => {
  let dbState = "disconnected";
  if (db.isEnabled()) {
    try {
      await db.query("SELECT 1");
      dbState = "connected";
    } catch (e) {
      console.error(`[API] error route:/health status:200 message:${e.message}`);
    }
  }
  res.json({
    ok: true,
    db: dbState,
    rooms: rooms.size,
    uptime: Math.round(process.uptime()),
  });
});

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
  if (req.user) console.log(`[Auth] logout userId:${req.user.id}`);
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

// pg는 BIGSERIAL을 문자열로 준다. 세션에 담긴 id와 방에 담긴 id의 타입이 경로마다 달라질 수 있어
// 사용자 비교는 반드시 이 함수로만 한다. 여기서 어긋나면 강연자가 자기 방에서 체험자로 강등된다.
function sameUser(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function requireSpeaker(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "강연자로 로그인해야 합니다." });
  if (!canSpeak(req.user)) return res.status(403).json({ error: "강연자 권한이 없는 계정입니다." });
  next();
}

// 활성 방과 겹치지 않는 4자리 코드를 뽑는다.
// 1000~9999. 선행 0을 쓰지 않아 사람이 불러주기 쉽다.
function newRoomCode() {
  for (let i = 0; i < 200; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error("빈 방 코드를 찾지 못했습니다.");
}

// 방을 닫는다. 안에 있던 체험자에게 알리고 연결 상태를 정리한다.
async function closeRoom(code, reason) {
  console.log(`[Room] closed code:${code} reason:${reason || "종료"}`);
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
    let roomId = code; // DB가 없으면 코드를 그대로 키로 쓴다
    if (db.isEnabled()) {
      const { rows } = await db.query(
        "INSERT INTO rooms (code, speaker_user_id) VALUES ($1, $2) RETURNING id",
        [code, req.user.id]
      );
      roomId = String(rows[0].id);
    }
    rooms.set(code, {
      id: roomId,
      clients: new Map(),
      broadcasterId: null,
      speakerUserId: req.user.id,
      speakerWsId: null,
      publishers: new Set(),
    });
    console.log(`[Room] created code:${code} room_id:${roomId} speaker:${req.user.id}`);
    res.json({ code });
  } catch (e) {
    console.error(`[API] error route:/api/rooms status:500 message:${e.message}`);
    res.status(500).json({ error: "방을 만들지 못했습니다." });
  }
});

app.post("/api/rooms/close", requireSpeaker, async (req, res) => {
  const code = String(req.body.code || "").trim();
  const room = rooms.get(code);
  if (room && !sameUser(room.speakerUserId, req.user.id)) {
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
    if (sameUser(room.speakerUserId, req.user.id)) return res.json({ code });
  }
  res.json({ code: null });
});

// 받는 파일 정본. 확장자로 후보를 찾고 mime으로 한 번 더 확인한다.
const ALLOWED_TYPES = [
  { mime: "image/png", ext: [".png"], kind: "image" },
  { mime: "image/jpeg", ext: [".jpg", ".jpeg"], kind: "image" },
  { mime: "image/webp", ext: [".webp"], kind: "image" },
  { mime: "image/gif", ext: [".gif"], kind: "image" },
  { mime: "text/markdown", ext: [".md", ".markdown"], kind: "markdown", text: true },
  { mime: "application/pdf", ext: [".pdf"], kind: "document" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: [".docx"],
    kind: "document",
  },
  { mime: "text/html", ext: [".html", ".htm"], kind: "document", text: true },
  { mime: "text/plain", ext: [".txt"], kind: "document", text: true },
];
// 브라우저가 mime을 비워 보내거나 뭉뚱그려 보내는 경우가 있다. 확장자가 맞으면 통과시킨다.
const GENERIC_MIMES = new Set(["", "application/octet-stream", "application/x-download"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 15 * 1024 * 1024;

function resolveType(filename, mimetype) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  const entry = ALLOWED_TYPES.find((t) => t.ext.includes(ext));
  if (!entry) return null;
  const mime = String(mimetype || "").toLowerCase().split(";")[0].trim();
  if (mime === entry.mime) return entry;
  if (GENERIC_MIMES.has(mime)) return entry;
  // 텍스트 계열은 브라우저가 text/plain으로 보내는 일이 잦다.
  if (entry.text && mime === "text/plain") return entry;
  return null;
}

// multer는 메모리로만 받는다. 디스크를 안 거치고 버퍼를 그대로 Blob에 올린다.
const upload = multer({
  storage: multer.memoryStorage(),
  // 큰 쪽(문서 15MB)에 맞춰 두고, 이미지 5MB 제한은 종류를 안 뒤에 확인한다.
  limits: { fileSize: MAX_DOC_BYTES, files: 10 },
  fileFilter: (req, file, cb) => cb(null, Boolean(resolveType(decodeName(file.originalname), file.mimetype))),
});

// multer는 파일명을 latin1로 읽어준다. 한글 이름이 깨지므로 UTF-8로 되돌린다.
function decodeName(originalname) {
  const raw = Buffer.from(String(originalname || ""), "latin1").toString("utf8");
  return path.basename(raw).slice(0, 80) || "파일";
}

// 버퍼를 Blob에 올리고 화면에 필요한 정보까지 함께 돌려준다.
async function putToBlob(file) {
  const filename = decodeName(file.originalname);
  const entry = resolveType(filename, file.mimetype);
  const result = await blobPut(filename, file.buffer, {
    access: "public",
    addRandomSuffix: true,
    contentType: entry.mime, // mime도 서버 정본에서 정한다
  });
  return {
    url: result.url,
    filename,
    mimeType: entry.mime,
    size: file.size,
    kind: entry.kind,
  };
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

// code -> { clients: Map(clientId -> {ws, name, role}), broadcasterId, speakerUserId, speakerWsId, publishers:Set }
// 방은 POST /api/rooms 로만 생긴다. 없는 코드는 입장이 거절된다.
const rooms = new Map();

// 강연자가 동시에 받는 체험자 화면 수 상한. P2P라 강연자 기기가 감당할 수 있는 선을 지킨다.
const MAX_PUBLISHERS = 10;

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
  const publishers = Array.from(room.publishers || []);
  for (const [, c] of room.clients) {
    send(c.ws, { type: "participants", list, broadcasterId: room.broadcasterId, publishers });
  }
}

// 체험자가 강연자에게 화면을 보내는 것을 끊는다.
function removePublisher(roomId, id, tellPublisher) {
  const room = rooms.get(roomId);
  if (!room || !room.publishers || !room.publishers.has(id)) return;
  room.publishers.delete(id);
  const speaker = room.speakerWsId ? room.clients.get(room.speakerWsId) : null;
  if (speaker) send(speaker.ws, { type: "publisher-stopped", id });
  if (tellPublisher) {
    const pub = room.clients.get(id);
    if (pub) send(pub.ws, { type: "publish-ended", reason: "강연자가 방을 비웠습니다." });
  }
  broadcastParticipants(roomId);
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
// multer가 막은 경우에도 HTML 오류 페이지 대신 JSON을 준다. 클라이언트가 res.json()으로 읽기 때문이다.
function receiveFiles(req, res, next) {
  upload.array("files", 10)(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "파일 하나가 너무 큽니다. 이미지는 5MB, 문서는 15MB까지 올릴 수 있습니다."
        : err.code === "LIMIT_FILE_COUNT"
        ? "한 번에 열 개까지 올릴 수 있습니다."
        : "파일을 받지 못했습니다. 파일 종류와 개수를 확인하세요.";
    console.error(`[API] error route:/api/records status:400 message:${err.code || err.message}`);
    res.status(400).json({ error: message });
  });
}

app.post("/api/records", receiveFiles, async (req, res) => {
  const code = String(req.body.room || "").trim();
  const name = String(req.body.name || "익명").trim().slice(0, 20) || "익명";
  const itemCode = String(req.body.itemCode || "").trim();
  const summary = String(req.body.summary || "").trim().slice(0, 2000);
  const item = ITEM_MAP.get(itemCode);
  const files = req.files || [];
  const room = rooms.get(code);

  // 메모리로만 받았으므로 거절할 때 지울 디스크 파일이 없다.
  if (!room || !item) {
    return res.status(400).json({ error: "참여 코드와 실습 항목을 확인하세요." });
  }
  if (!summary && files.length === 0) {
    return res.status(400).json({ error: "결과 요약이나 파일을 하나 이상 올리세요." });
  }
  if (files.length && !blobReady) {
    return res.status(503).json({ error: "파일 저장소가 아직 설정되지 않았습니다." });
  }

  // 이미지는 5MB, 문서는 15MB. multer는 큰 쪽으로 열어 뒀으니 여기서 이미지만 다시 본다.
  const tooBig = files.find(
    (f) => resolveType(decodeName(f.originalname), f.mimetype).kind === "image" && f.size > MAX_IMAGE_BYTES
  );
  if (tooBig) {
    return res.status(400).json({ error: "이미지는 한 장에 5MB까지 올릴 수 있습니다." });
  }

  let uploaded = [];
  try {
    uploaded = await Promise.all(files.map(putToBlob));
  } catch (e) {
    console.error(`[API] error route:/api/records status:502 message:${e.message}`);
    await removeFromBlob(uploaded.map((f) => f.url));
    return res.status(502).json({ error: "파일을 저장하지 못했습니다. 다시 시도하세요." });
  }

  let record;
  try {
    // itemLabel과 track은 서버 정본(PRACTICE_ITEMS)에서만 채운다.
    record = await insertRecord({
      roomId: room.id,
      name,
      userId: req.user ? req.user.id : null,
      item,
      summary,
      files: uploaded,
    });
  } catch (e) {
    console.error(`[API] error route:/api/records status:500 message:${e.message}`);
    await removeFromBlob(uploaded.map((f) => f.url));
    return res.status(500).json({ error: "기록물을 저장하지 못했습니다." });
  }

  const list = await loadRoomRecords(room.id);
  list.push(record);

  console.log(`[API] POST /api/records room_id:${room.id} files:${uploaded.length}`);
  broadcastToRoom(code, { type: "record-added", record });
  res.json({ ok: true, record });
});

// 강연자용 전체 초기화. 확인 문구가 정확히 일치할 때만 실행한다.
app.post("/api/records/reset", requireSpeaker, async (req, res) => {
  const code = String(req.body.room || "").trim();
  const confirm = String(req.body.confirm || "").trim();
  const room = rooms.get(code);
  if (!room) return res.status(400).json({ error: "방 정보가 없습니다." });
  if (confirm !== "초기화") {
    return res.status(400).json({ error: "확인 문구가 일치하지 않습니다." });
  }

  const list = await loadRoomRecords(room.id);
  // Blob 파일을 먼저 지우고, DB 행은 records를 지우면 record_files가 CASCADE로 함께 사라진다.
  const urls = list.flatMap((r) => (r.files || []).map((f) => f.url));
  console.log(`[API] POST /api/records/reset room_id:${room.id} deleted:${list.length}records ${urls.length}files`);
  await removeFromBlob(urls);
  if (db.isEnabled()) {
    await db.query("DELETE FROM records WHERE room_id = $1", [room.id]).catch((e) => {
      console.error(`[API] error route:/api/records/reset status:500 message:${e.message}`);
    });
  }
  roomRecords.set(room.id, []);

  broadcastToRoom(code, { type: "records-reset" });
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
        console.log(`[WS] type:join from:${clientId} room:${code} -> rejected(없는 코드)`);
        send(ws, { type: "join-rejected", reason: "그런 방이 없습니다. 코드를 다시 확인하세요." });
        return;
      }

      // 클라가 role을 실어 보내도 믿지 않는다. 세션으로 다시 판정한다.
      const isSpeaker = Boolean(sessionUser) && canSpeak(sessionUser) && sameUser(room.speakerUserId, sessionUser.id);

      // C4. 한 방의 강연자는 한 명이다. 다른 로그인 유저가 남의 방에 들어오려 하면 거절한다.
      if (!isSpeaker && sessionUser && canSpeak(sessionUser)) {
        console.log(`[WS] type:join from:${clientId} room:${code} -> rejected(다른 강연자 계정)`);
        send(ws, {
          type: "join-rejected",
          reason: "이 방에는 이미 강연자가 있습니다. 로그아웃한 뒤 코드로 들어오세요.",
        });
        return;
      }

      const role = isSpeaker ? "speaker" : "viewer";

      // C3. 같은 이름과 같은 역할로 다시 들어오면 앞선 연결은 끊긴 것으로 보고 자리를 넘겨준다.
      for (const [oldId, c] of Array.from(room.clients)) {
        if (oldId !== clientId && c.name === name && (c.role || "viewer") === role) {
          console.log(`[Room] stale code:${code} ${oldId} -> ${clientId} name:${name}`);
          room.clients.delete(oldId);
          if (room.publishers) room.publishers.delete(oldId);
          if (room.speakerWsId === oldId) room.speakerWsId = null;
          if (room.broadcasterId === oldId) room.broadcasterId = null;
          try {
            c.ws.close();
          } catch (e) {}
        }
      }

      currentRoomId = code;
      room.clients.set(clientId, { ws, name, role });
      if (isSpeaker) room.speakerWsId = clientId;
      console.log(`[WS] type:join from:${clientId} room:${code} role:${role}`);
      console.log(`[Room] join code:${code} name:${name} role:${role}`);
      if (isSpeaker) {
        for (const [id, c] of room.clients) {
          if (id !== clientId) send(c.ws, { type: "speaker-reconnected" });
        }
      }
      if (sessionUser) console.log(`[Auth] role ${role} userId:${sessionUser.id} room:${code}`);
      send(ws, { type: "joined", room: code, role });
      broadcastParticipants(currentRoomId);

      // 이 방의 기존 기록물을 새로 들어온 사람에게 보낸다.
      loadRoomRecords(room.id).then((list) => send(ws, { type: "records-init", list }));

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
      console.log(`[WS] type:start-share from:${clientId} room:${currentRoomId}`);
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
      console.log(`[WS] type:stop-share from:${clientId} room:${currentRoomId}`);
      if (room.broadcasterId === clientId) {
        stopBroadcast(currentRoomId, false);
      }
      return;
    }

    // ── 체험자가 강연자에게 보내는 방향(N대 1) ──
    if (msg.type === "start-publish") {
      const speakerId = room.speakerWsId;
      const speaker = speakerId ? room.clients.get(speakerId) : null;
      if (!speaker) {
        console.log(`[WS] type:start-publish from:${clientId} room:${currentRoomId} -> rejected(강연자 부재)`);
        send(ws, { type: "publish-rejected", reason: "강연자가 아직 방에 들어오지 않았습니다." });
        return;
      }
      if (clientId === speakerId) return;
      if (!room.publishers) room.publishers = new Set();
      if (!room.publishers.has(clientId) && room.publishers.size >= MAX_PUBLISHERS) {
        console.log(`[WS] type:start-publish from:${clientId} room:${currentRoomId} -> rejected(정원 초과 ${MAX_PUBLISHERS})`);
        send(ws, {
          type: "publish-rejected",
          reason: `한 번에 ${MAX_PUBLISHERS}명까지 공유할 수 있습니다. 한 명이 멈추면 다시 시도하세요.`,
        });
        return;
      }
      room.publishers.add(clientId);
      const me = room.clients.get(clientId);
      console.log(`[WS] type:start-publish from:${clientId} room:${currentRoomId} -> accepted`);
      send(ws, { type: "publish-accepted", speakerId });
      send(speaker.ws, { type: "publisher-started", id: clientId, name: me ? me.name : "체험자" });
      broadcastParticipants(currentRoomId);
      return;
    }

    if (msg.type === "stop-publish") {
      console.log(`[WS] type:stop-publish from:${clientId} room:${currentRoomId}`);
      removePublisher(currentRoomId, clientId, false);
      return;
    }

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      const target = room.clients.get(msg.to);
      // ice는 연결마다 수십 개가 날아와 로그를 덮는다. offer와 answer만 남긴다.
      if (msg.type !== "ice") {
        console.log(
          `[WS] type:${msg.type} from:${clientId} to:${msg.to} room:${currentRoomId} channel:${msg.channel || "-"}${target ? "" : " -> 대상없음"}`
        );
      }
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
    console.log(`[Room] leave code:${currentRoomId} ${clientId}`);
    if (room.broadcasterId === clientId) {
      stopBroadcast(currentRoomId, false);
    }
    removePublisher(currentRoomId, clientId, false);
    if (room.speakerWsId === clientId) {
      room.speakerWsId = null;
      console.log(`[Room] speaker-disconnected code:${currentRoomId}`);
      // 받을 사람이 없으니 보내던 체험자들을 모두 멈춘다.
      for (const id of Array.from(room.publishers || [])) removePublisher(currentRoomId, id, true);
      // 방은 살아 있다. 강연자가 돌아올 때까지 기다리라고 알린다.
      for (const [, c] of room.clients) {
        send(c.ws, { type: "speaker-disconnected" });
      }
    }
    // 방은 비어도 지우지 않는다. 강연자가 새로고침해도 코드가 살아 있어야 한다.
    // 방을 없애는 길은 POST /api/rooms/close 와 강연자가 새 방을 여는 경우뿐이다.
    broadcastParticipants(currentRoomId);
  });
});

const PORT = process.env.PORT || 3000;

// connect-pg-simple은 세션 표를 첫 세션 저장 때 만든다. 그러면 실패가 하필 첫 로그인 순간에 드러난다.
// 부팅 때 한 번 건드려 미리 만들고, 실패하면 여기서 로그로 잡는다.
// Render 무료 플랜은 유휴 시 잠들었다 다시 뜬다. 그때 메모리 Map이 비어 버리면
// DB는 active라고 하는데 코드는 거절되는 상태가 된다. 부팅 때 활성 방을 되살린다.
async function restoreRooms() {
  if (!db.isEnabled()) return 0;
  try {
    const { rows } = await db.query("SELECT id, code, speaker_user_id FROM rooms WHERE active = true");
    rows.forEach((r) => {
      rooms.set(r.code, {
        id: String(r.id),
        clients: new Map(),
        broadcasterId: null,
        speakerUserId: r.speaker_user_id === null ? null : String(r.speaker_user_id),
        speakerWsId: null,
        publishers: new Set(),
      });
    });
    return rows.length;
  } catch (e) {
    console.error("방 복구 실패:", e.message);
    return 0;
  }
}

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
  const restored = await restoreRooms();
  server.listen(PORT, () => {
    console.log(
      `서버 실행 중: http://localhost:${PORT} (DB ${ok ? "연결됨" : "미연결"}, 세션 ${sess ? "DB 저장" : "메모리"}, 활성 방 ${restored}개 복구)`
    );
  });
});

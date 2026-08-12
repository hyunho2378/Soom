// 동해 AI 교육용 실시간 화면 공유 도구 — 클라이언트

// ICE 서버 설정.
// STUN만으로는 대칭 NAT이나 UDP를 막는 기관 와이파이에서 P2P가 성립하지 않는다.
// 시그널링(offer/answer)은 멀쩡히 오가는데 화면만 안 뜨는 증상이 바로 그 경우다.
// 그때 영상을 대신 날라주는 TURN이 필요한데, 자격증명은 주기적으로 갈리므로
// 코드에 박지 않고 서버가 환경변수에서 읽어 내려주는 값을 쓴다.
// 서버가 안 주면 구글 STUN만으로 간다. 같은 망 안에서는 그것으로 충분하다.
let ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

async function loadIceServers() {
  try {
    const cfg = await (await fetch("/api/ice")).json();
    if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) ICE_SERVERS = cfg.iceServers;
    console.log(`[WebRTC] ICE 서버 ${ICE_SERVERS.length}개 로드, TURN ${cfg.turn ? "있음" : "없음"}`);
  } catch (e) {
    console.warn("[WebRTC] ICE 설정을 못 받아 기본 STUN으로 간다:", e.message);
  }
}
loadIceServers();

function randomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// 팔레트 정본은 style.css :root의 --avatar-1 부터 --avatar-6 이다. 처음 한 번만 읽어 캐시한다.
let avatarPalette = null;
function avatarColor(name) {
  if (!avatarPalette) {
    const css = getComputedStyle(document.documentElement);
    avatarPalette = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--avatar-${i}`).trim());
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarPalette[Math.abs(hash) % avatarPalette.length];
}

const myId = randomId();
let myName = "";
let myRoom = "";
let ws = null;
let isBroadcaster = false;
let localStream = null;

const joinScreen = document.getElementById("joinScreen");
const roomScreen = document.getElementById("roomScreen");
const nameInput = document.getElementById("nameInput");
const codeInput = document.getElementById("codeInput");
const joinBtn = document.getElementById("joinBtn");
const joinHint = document.getElementById("joinHint");
const joinLoading = document.getElementById("joinLoading");
const paneSignedOut = document.getElementById("paneSignedOut");
const paneSpeaker = document.getElementById("paneSpeaker");
const paneViewer = document.getElementById("paneViewer");
const showCodeFormBtn = document.getElementById("showCodeFormBtn");
const meName = document.getElementById("meName");
const createRoomBtn = document.getElementById("createRoomBtn");
const enterRoomBtn = document.getElementById("enterRoomBtn");
const newRoomBtn = document.getElementById("newRoomBtn");
const logoutBtn = document.getElementById("logoutBtn");
const roomCodeBox = document.getElementById("roomCodeBox");
const roomCodeText = document.getElementById("roomCodeText");
const roleChip = document.getElementById("roleChip");
const closeRoomBtn = document.getElementById("closeRoomBtn");
const roomNameLabel = document.getElementById("roomNameLabel");
const participantCount = document.getElementById("participantCount");
const participantList = document.getElementById("participantList");
const leaveBtn = document.getElementById("leaveBtn");
const shareBtn = document.getElementById("shareBtn");
const shareBtnLabel = document.getElementById("shareBtnLabel");
const shareStatus = document.getElementById("shareStatus");
const shareNote = document.getElementById("shareNote");
const remoteVideo = document.getElementById("remoteVideo");
const viewerFrame = document.getElementById("viewerFrame");
const viewerPlaceholder = document.getElementById("viewerPlaceholder");
const placeholderTitle = document.getElementById("placeholderTitle");
const placeholderSub = document.getElementById("placeholderSub");
const presenterBadge = document.getElementById("presenterBadge");
const dotLive = document.getElementById("dotLive");

// 뷰어 플레이스홀더는 실제 영상 트랙이 도착할 때만 걷는다.
function setPlaceholder(state, name) {
  if (state === "gone") {
    viewerPlaceholder.classList.add("is-gone");
    return;
  }
  viewerPlaceholder.classList.remove("is-gone");
  if (state === "connecting") {
    placeholderTitle.textContent = `${name} 님의 화면을 불러오는 중입니다.`;
    placeholderSub.textContent = "잠시만 기다리세요.";
  } else {
    placeholderTitle.textContent = "아직 화면을 공유하는 사람이 없습니다.";
    placeholderSub.textContent = "아래 버튼으로 내 화면을 공유해보세요.";
  }
}

// ── 입장 화면: 도착 경로로 강연자와 체험자를 가른다 ──
let myRole = "viewer";
let myCode = "";

function showPane(pane) {
  joinLoading.classList.add("hidden");
  [paneSignedOut, paneSpeaker, paneViewer].forEach((p) => p.classList.toggle("hidden", p !== pane));
}

async function initJoinScreen() {
  // 코드를 달고 들어온 사람은 체험자다. 로그인 창구를 아예 보여주지 않는다.
  const urlCode = new URLSearchParams(location.search).get("code");
  if (urlCode) {
    codeInput.value = urlCode.replace(/\D/g, "").slice(0, 4);
    showPane(paneViewer);
    nameInput.focus();
    return;
  }
  try {
    const me = await (await fetch("/api/me")).json();
    if (me.user && me.canSpeak) {
      meName.textContent = me.user.name;
      myName = me.user.name;
      showPane(paneSpeaker);
      const mine = await (await fetch("/api/my-room")).json();
      if (mine.code) showRoomCode(mine.code);
      return;
    }
    if (me.user && !me.canSpeak) {
      joinHint.textContent = "강연자 권한이 없는 계정입니다. 코드로 입장하세요.";
      showPane(paneViewer);
      return;
    }
    if (!me.googleReady) {
      document.getElementById("googleLoginBtn").classList.add("hidden");
      joinHint.textContent = "구글 로그인이 아직 설정되지 않았습니다. 코드로 입장하세요.";
    }
  } catch (e) {
    joinHint.textContent = "상태를 불러오지 못했습니다. 새로고침하세요.";
  }
  showPane(paneSignedOut);
}

function showRoomCode(code) {
  myCode = code;
  roomCodeText.textContent = code;
  roomCodeBox.classList.remove("hidden");
  createRoomBtn.classList.add("hidden");
  enterRoomBtn.classList.remove("hidden");
  newRoomBtn.classList.remove("hidden");
}

showCodeFormBtn.addEventListener("click", () => {
  showPane(paneViewer);
  codeInput.focus();
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 4);
});

async function createRoom(btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "만드는 중입니다";
  joinHint.textContent = "";
  try {
    const res = await fetch("/api/rooms", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "방을 만들지 못했습니다.");
    showRoomCode(data.code);
  } catch (e) {
    joinHint.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
createRoomBtn.addEventListener("click", () => createRoom(createRoomBtn));
newRoomBtn.addEventListener("click", () => createRoom(newRoomBtn));

enterRoomBtn.addEventListener("click", () => join(myCode, myName, "speaker"));

logoutBtn.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.href = "/";
});

joinBtn.addEventListener("click", () => {
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  if (code.length !== 4 || !name) {
    joinHint.textContent = "참여 코드 네 자리와 이름을 모두 입력하세요.";
    return;
  }
  join(code, name, "viewer");
});
[codeInput, nameInput].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });
});

initJoinScreen();

// ── 연결과 재연결 ──
// 강의 중 와이파이가 깜빡여도 사람이 새로고침하지 않게 스스로 다시 붙는다.
const MAX_RECONNECT = 10;
const connBar = document.getElementById("connBar");
const connText = document.getElementById("connText");
const connRetryBtn = document.getElementById("connRetryBtn");

let joinedOnce = false; // 한 번이라도 방에 들어갔는지(그 뒤부터 재연결 대상)
let reconnectTries = 0;
let reconnectTimer = null;
let leavingOnPurpose = false;

function showConnBar(text, retry) {
  connText.textContent = text;
  connRetryBtn.classList.toggle("hidden", !retry);
  connBar.classList.remove("hidden");
  document.body.classList.add("has-conn-bar");
  connBar.classList.toggle("is-dead", Boolean(retry));
  // 끊긴 동안에는 올려도 남들이 실시간으로 못 받는다.
  if (submitRecordBtn) submitRecordBtn.disabled = true;
}
function hideConnBar() {
  connBar.classList.add("hidden");
  document.body.classList.remove("has-conn-bar");
  connBar.classList.remove("is-dead");
  if (submitRecordBtn) submitRecordBtn.disabled = false;
}

function join(room, name, role) {
  myRoom = room;
  myName = name;
  myRole = role;
  const btn = role === "speaker" ? enterRoomBtn : joinBtn;
  btn.disabled = true;
  btn.textContent = "입장하는 중입니다";
  joinHint.textContent = "";
  openSocket();
}

function openSocket() {
  clearTimeout(reconnectTimer);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  // 서버가 코드를 확인하고 joined를 보내줄 때까지 화면을 넘기지 않는다.
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", id: myId, room: myRoom, name: myName }));
  });

  ws.addEventListener("message", (evt) => {
    handleMessage(JSON.parse(evt.data));
  });

  ws.addEventListener("close", () => {
    if (leavingOnPurpose) return;
    // 아직 한 번도 못 들어갔으면 입장 실패로 다룬다(재연결은 방에 들어간 뒤부터).
    if (!joinedOnce) {
      resetJoinButton();
      joinHint.textContent = "연결에 실패했습니다. 잠시 후 다시 시도하세요.";
      return;
    }
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    if (!joinedOnce) {
      resetJoinButton();
      joinHint.textContent = "연결에 실패했습니다. 잠시 후 다시 시도하세요.";
    }
  });
}

function scheduleReconnect() {
  if (reconnectTries >= MAX_RECONNECT) {
    showConnBar("연결할 수 없습니다. 새로고침하세요.", true);
    return;
  }
  // 1s, 2s, 4s로 늘리되 30s에서 멈춘다.
  const wait = Math.min(1000 * Math.pow(2, reconnectTries), 30000);
  reconnectTries += 1;
  showConnBar(`연결이 끊겼습니다. 재연결 중입니다. (${reconnectTries}/${MAX_RECONNECT})`, false);
  reconnectTimer = setTimeout(openSocket, wait);
}

connRetryBtn.addEventListener("click", () => {
  reconnectTries = 0;
  showConnBar("연결이 끊겼습니다. 재연결 중입니다.", false);
  openSocket();
});

function resetJoinButton() {
  joinBtn.disabled = false;
  joinBtn.textContent = "입장하기";
  enterRoomBtn.disabled = false;
  enterRoomBtn.textContent = "방에 입장하기";
}

// 서버가 역할을 확정해 돌려준 다음에 회의실로 넘어간다.
// 재연결로 다시 들어온 경우에도 같은 경로를 탄다.
function onJoined(room, role) {
  const isReconnect = joinedOnce;
  joinedOnce = true;
  reconnectTries = 0;
  hideConnBar();
  hideSpeakerGone();

  myRole = role;
  joinScreen.classList.add("hidden");
  roomScreen.classList.remove("hidden");
  roomNameLabel.textContent = `참여 코드 ${room}`;
  roleChip.textContent = role === "speaker" ? "강연자" : "체험자";
  roleChip.classList.remove("hidden");
  roleChip.classList.toggle("is-speaker", role === "speaker");
  // 방 종료와 기록물 초기화는 강연자만 한다.
  closeRoomBtn.classList.toggle("hidden", role !== "speaker");
  resetRecordsBtn.classList.toggle("hidden", role !== "speaker");

  // 강연자는 체험자 화면을 격자로 받고, 체험자는 강연자 시범 화면 하나를 본다.
  const speaker = role === "speaker";
  gridWrap.classList.toggle("hidden", !speaker);
  viewerFrame.classList.toggle("hidden", speaker);
  applyShareAvailability(speaker);

  setupRecords();

  // 재연결이면 보내던 화면을 이어서 살린다. 스트림은 아직 살아 있으므로 시그널만 다시 태운다.
  if (isReconnect && isBroadcaster) {
    if (speaker && localStream) {
      sendSignal({ type: "start-share" });
    } else if (!speaker && myPublishStream) {
      sendSignal({ type: "start-publish" });
    } else {
      // 스트림이 이미 죽었으면 버튼만 원래대로 돌린다.
      speaker ? stopDemo(false) : stopPublishing(false);
    }
  }
}

// D2. getDisplayMedia는 iOS 사파리에 없고 안드로이드도 제한적이다. 모바일이면 공유를 막고 이유를 알린다.
function screenShareBlocked() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") return true;
  // 손가락만 있는 기기(휴대폰, 태블릿)를 막는다. 터치 노트북은 정밀 포인터가 함께 있어 통과한다.
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const hasFine = window.matchMedia("(any-pointer: fine)").matches;
  return coarse && !hasFine;
}

function applyShareAvailability(speaker) {
  setShareButton(false, speaker ? "시범 공유 시작하기" : "내 화면 공유하기");
  const blocked = screenShareBlocked();
  shareBtn.disabled = blocked;
  shareNote.classList.toggle("hidden", !blocked);
  if (blocked) {
    shareNote.textContent = "화면 공유는 PC에서만 가능합니다. 기록물 올리기는 그대로 쓸 수 있습니다.";
  }
}

// C2. 강연자 연결이 끊기면 체험자에게 대기 안내를 띄운다. 방은 살아 있다.
function showSpeakerGone() {
  if (myRole === "speaker") return;
  showConnBar("강연자 연결이 끊겼습니다. 돌아올 때까지 기다리세요.", false);
  connBar.classList.add("is-warn");
  // 강연자가 없으면 보낼 곳이 없다.
  if (isBroadcaster) stopPublishing(false);
}
function hideSpeakerGone() {
  connBar.classList.remove("is-warn");
}

// 강연자가 방을 닫으면 체험자 쪽에서 뜬다. 공유를 정리하고 알린다.
function alertRoomClosed(reason) {
  if (isBroadcaster) myRole === "speaker" ? stopDemo(false) : stopPublishing(false);
  const modal = document.getElementById("closedModal");
  document.getElementById("closedModalDesc").textContent = reason || "강연자가 방을 종료했습니다.";
  modal.classList.add("is-open");
  document.getElementById("closedModalBtn").focus();
  leavingOnPurpose = true;
  hideConnBar();
  if (ws) ws.close();
}
document.getElementById("closedModalBtn").addEventListener("click", () => {
  location.href = "/";
});

closeRoomBtn.addEventListener("click", async () => {
  closeRoomBtn.disabled = true;
  try {
    await fetch("/api/rooms/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: myRoom }),
    });
    location.href = "/";
  } catch (e) {
    closeRoomBtn.disabled = false;
  }
});

function handleMessage(msg) {
  switch (msg.type) {
    case "joined":
      onJoined(msg.room, msg.role);
      break;
    case "join-rejected":
      resetJoinButton();
      joinHint.textContent = msg.reason || "입장하지 못했습니다.";
      leavingOnPurpose = true;
      ws.close();
      break;
    case "room-closed":
      alertRoomClosed(msg.reason);
      break;
    case "speaker-disconnected":
      showSpeakerGone();
      break;
    case "speaker-reconnected":
      hideSpeakerGone();
      hideConnBar();
      break;
    case "participants":
      renderParticipants(msg.list, msg.broadcasterId, msg.publishers);
      break;
    case "broadcaster-changed":
      onBroadcasterChanged(msg.broadcasterId, msg.name);
      break;
    case "you-are-broadcaster":
      // 강연자 시범 공유. 지금 방에 있는 체험자 전원에게 연결을 연다.
      msg.viewerIds.forEach(connectDemoTo);
      break;
    case "new-viewer":
      if (myRole === "speaker" && localStream) connectDemoTo(msg.id);
      break;
    case "publish-accepted":
      onPublishAccepted(msg.speakerId);
      break;
    case "publish-rejected":
      stopPublishing(false);
      shareStatus.textContent = msg.reason || "지금은 공유할 수 없습니다.";
      break;
    case "publish-ended":
      stopPublishing(false);
      shareStatus.textContent = msg.reason || "공유가 끝났습니다.";
      break;
    case "publisher-started":
      onPublisherStarted(msg.id, msg.name);
      break;
    case "publisher-stopped":
      onPublisherStopped(msg.id);
      break;
    case "offer":
      handleOffer(msg.from, msg.sdp, msg.channel);
      break;
    case "answer":
      handleAnswer(msg.from, msg.sdp, msg.channel);
      break;
    case "ice":
      handleIce(msg.from, msg.candidate, msg.channel);
      break;
    case "force-stop-share":
      stopDemo(false);
      break;
    case "records-init":
      renderAllRecords(msg.list || []);
      break;
    case "record-added":
      addRecordCard(msg.record, true);
      break;
    case "records-reset":
      renderAllRecords([]);
      break;
  }
}

function renderParticipants(list, broadcasterId, publishers) {
  const sharing = new Set(publishers || []);
  participantCount.textContent = `참가자 ${list.length}명`;
  participantList.innerHTML = list
    .map((p) => {
      const initial = p.name.slice(0, 1).toUpperCase();
      const demo = p.id === broadcasterId;
      const publish = sharing.has(p.id);
      const tag = demo ? "시범중" : publish ? "공유중" : p.role === "speaker" ? "강연자" : "";
      return `
        <li class="participant-item ${demo || publish ? "is-presenting" : ""}">
          <span class="avatar" style="background:${avatarColor(p.name)}">${escapeHtml(initial)}</span>
          <span class="p-name">${escapeHtml(p.name)}${p.id === myId ? " (나)" : ""}</span>
          ${tag ? `<span class="p-tag ${p.role === "speaker" && !demo && !publish ? "is-role" : ""}">${tag}</span>` : ""}
        </li>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function onBroadcasterChanged(broadcasterId, name) {
  if (broadcasterId === myId || myRole === "speaker") return;

  // 이전 시범 수신 연결 정리
  if (demoPc) {
    demoPc.close();
    demoPc = null;
  }
  remoteVideo.srcObject = null;

  if (!broadcasterId) {
    setPlaceholder("idle");
    presenterBadge.classList.add("hidden");
    dotLive.classList.remove("is-live");
    shareStatus.textContent = "";
  } else {
    // 트랙이 아직 안 왔으므로 플레이스홀더는 그대로 두고 문구만 바꾼다.
    setPlaceholder("connecting", name);
    presenterBadge.classList.remove("hidden");
    presenterBadge.textContent = `${name} 님이 발표 중`;
    dotLive.classList.add("is-live");
    shareStatus.textContent = `${name} 님의 화면을 보고 있습니다.`;
  }
}

// ══════════ 화면 공유 ══════════
// 방향이 둘이다.
//  publish : 체험자 여러 명이 강연자 한 명에게 보낸다(N대 1). 보내는 쪽이 offer를 만든다.
//  demo    : 강연자가 체험자 전원에게 시범을 보인다(1대 N). 기존 방식 그대로다.
// 두 방향의 연결이 같은 상대와 동시에 살 수 있으므로 모든 시그널에 channel을 붙여 구분한다.

// 강연자 기기와 강의실 네트워크가 감당할 수 있게 낮게 잡는다. 격자에서는 작게 보이므로 충분하다.
const CAPTURE_CONSTRAINTS = {
  video: { frameRate: { max: 8 }, width: { max: 1280 }, height: { max: 720 } },
  audio: false,
};

let myPublishStream = null; // 내가 강연자에게 보내는 중인 화면
let publishPc = null; // 체험자일 때 강연자로 향하는 연결 하나
let publishTargetId = null;
const incoming = new Map(); // 강연자일 때 체험자별 수신 연결. viewerId -> {pc, name, stream}
const demoPcs = new Map(); // 강연자일 때 시범 송출 연결. viewerId -> pc
let demoPc = null; // 체험자일 때 강연자 시범을 받는 연결 하나

// 연결이 안 붙을 때 어디서 막혔는지 브라우저 콘솔만 보고 알 수 있게 네 가지를 남긴다.
// candidate의 typ가 host뿐이면 STUN이 막힌 것이고, relay가 보이면 TURN이 도는 것이다.
function newPeer(label) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.addEventListener("icecandidate", (e) => {
    console.log(`[WebRTC] ICE candidate: ${label}`, e.candidate ? e.candidate.candidate : "(수집 끝)");
  });
  pc.addEventListener("icecandidateerror", (e) => {
    console.warn(`[WebRTC] ICE 서버 오류: ${label} ${e.url || ""} ${e.errorCode} ${e.errorText}`);
  });
  pc.addEventListener("iceconnectionstatechange", () => {
    console.log(`[WebRTC] ICE state: ${label}`, pc.iceConnectionState);
  });
  pc.addEventListener("connectionstatechange", () => {
    console.log(`[WebRTC] connection: ${label}`, pc.connectionState);
  });
  pc.addEventListener("track", (e) => {
    console.log(`[WebRTC] track received: ${label}`, e.track.kind);
  });
  return pc;
}

// remoteDescription이 서기 전에 도착한 candidate는 브라우저가 거절한다.
// offer를 받아 처리하는 사이에 상대의 첫 candidate들이 먼저 들어오므로 실제로 자주 벌어진다.
// 버리지 말고 모아 뒀다가 설명이 선 직후에 넣는다.
function addIce(pc, candidate) {
  if (!pc.remoteDescription) {
    (pc.pendingIce || (pc.pendingIce = [])).push(candidate);
    return;
  }
  pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
    console.warn("[WebRTC] ICE 추가 실패:", err.message);
  });
}

function flushIce(pc) {
  const queued = pc.pendingIce;
  if (!queued || !queued.length) return;
  pc.pendingIce = null;
  console.log(`[WebRTC] 대기하던 ICE ${queued.length}개를 넣는다`);
  queued.forEach((c) => addIce(pc, c));
}

// 캡처 트랙에 힌트를 준다. 문서와 코드 화면이 대부분이라 선명도를 우선한다.
function hintDetail(stream) {
  const track = stream.getVideoTracks()[0];
  if (track && "contentHint" in track) track.contentHint = "detail";
  return track;
}

function sendSignal(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── 체험자: 내 화면을 강연자에게 보낸다 ──

async function startPublishing() {
  try {
    myPublishStream = await navigator.mediaDevices.getDisplayMedia(CAPTURE_CONSTRAINTS);
  } catch (e) {
    shareStatus.textContent = "화면 공유가 취소되었습니다.";
    return;
  }
  hintDetail(myPublishStream).addEventListener("ended", () => stopPublishing(true));
  isBroadcaster = true;
  setShareButton(true, "공유 중지");
  shareStatus.textContent = "내 화면을 강연자에게 보내고 있습니다.";
  // 보내는 사람도 자기가 무엇을 보내는지 봐야 한다. 강연자 시범을 볼 때와 같은 자리에 띄운다.
  remoteVideo.srcObject = myPublishStream;
  setPlaceholder("gone");
  presenterBadge.classList.remove("hidden");
  presenterBadge.textContent = "내 화면을 보내는 중";
  sendSignal({ type: "start-publish" });
}

// 서버가 받아주면 그때 강연자를 향해 offer를 만든다.
async function onPublishAccepted(speakerId) {
  publishTargetId = speakerId;
  if (publishPc) publishPc.close();
  publishPc = newPeer("publish->강연자");
  myPublishStream.getTracks().forEach((t) => publishPc.addTrack(t, myPublishStream));
  publishPc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ type: "ice", to: speakerId, channel: "publish", candidate: e.candidate });
  };
  const offer = await publishPc.createOffer();
  await publishPc.setLocalDescription(offer);
  sendSignal({ type: "offer", to: speakerId, channel: "publish", sdp: publishPc.localDescription });
}

function stopPublishing(notifyServer) {
  isBroadcaster = false;
  if (myPublishStream) {
    myPublishStream.getTracks().forEach((t) => t.stop());
    myPublishStream = null;
  }
  if (publishPc) {
    publishPc.close();
    publishPc = null;
  }
  publishTargetId = null;
  setShareButton(false, "내 화면 공유하기");
  shareStatus.textContent = "";
  // 내 화면 미리보기를 걷는다. 강연자 시범이 돌고 있으면 그 화면이 다시 들어온다.
  remoteVideo.srcObject = null;
  presenterBadge.classList.add("hidden");
  setPlaceholder("idle");
  if (notifyServer) sendSignal({ type: "stop-publish" });
}

// ── 강연자: 체험자 화면을 격자로 받는다 ──

function onPublisherStarted(id, name) {
  if (!incoming.has(id)) incoming.set(id, { pc: null, name, stream: null });
  else incoming.get(id).name = name;
  renderGrid();
}

function onPublisherStopped(id) {
  const entry = incoming.get(id);
  if (entry && entry.pc) entry.pc.close();
  incoming.delete(id);
  if (zoomedCellId === id) closeCellZoom();
  renderGrid();
}

// 체험자가 보낸 offer를 받아 수신 연결을 만든다.
async function acceptPublish(fromId, sdp) {
  const entry = incoming.get(fromId) || { name: "체험자", pc: null, stream: null };
  if (entry.pc) entry.pc.close();
  const pc = newPeer(`publish<-${fromId}`);
  entry.pc = pc;
  incoming.set(fromId, entry);

  pc.ontrack = (e) => {
    entry.stream = e.streams[0];
    renderGrid();
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ type: "ice", to: fromId, channel: "publish", candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") renderGrid();
  };

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  flushIce(pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal({ type: "answer", to: fromId, channel: "publish", sdp: pc.localDescription });
  renderGrid();
}

// ── 강연자: 시범 화면을 체험자 전원에게 보낸다(1대 N) ──

async function startDemo() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia(CAPTURE_CONSTRAINTS);
  } catch (e) {
    shareStatus.textContent = "화면 공유가 취소되었습니다.";
    return;
  }
  hintDetail(localStream).addEventListener("ended", () => stopDemo(true));
  isBroadcaster = true;
  setShareButton(true, "시범 공유 중지");
  shareStatus.textContent = "내 화면을 체험자 전원에게 보이고 있습니다.";
  dotLive.classList.add("is-live");
  sendSignal({ type: "start-share" });
}

function connectDemoTo(viewerId) {
  if (demoPcs.has(viewerId) || !localStream) return;
  const pc = newPeer(`demo->${viewerId}`);
  demoPcs.set(viewerId, pc);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ type: "ice", to: viewerId, channel: "demo", candidate: e.candidate });
  };
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => sendSignal({ type: "offer", to: viewerId, channel: "demo", sdp: pc.localDescription }));
}

function stopDemo(notifyServer) {
  isBroadcaster = false;
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  demoPcs.forEach((pc) => pc.close());
  demoPcs.clear();
  setShareButton(false, "시범 공유 시작하기");
  shareStatus.textContent = "";
  dotLive.classList.remove("is-live");
  if (notifyServer) sendSignal({ type: "stop-share" });
}

// ── 체험자: 강연자 시범 화면을 받는다 ──

async function acceptDemo(fromId, sdp) {
  if (demoPc) demoPc.close();
  demoPc = newPeer("demo<-강연자");
  demoPc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    setPlaceholder("gone");
  };
  demoPc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ type: "ice", to: fromId, channel: "demo", candidate: e.candidate });
  };
  await demoPc.setRemoteDescription(new RTCSessionDescription(sdp));
  flushIce(demoPc);
  const answer = await demoPc.createAnswer();
  await demoPc.setLocalDescription(answer);
  sendSignal({ type: "answer", to: fromId, channel: "demo", sdp: demoPc.localDescription });
}

// ── 시그널 라우팅 ──

function pcFor(channel, fromId) {
  if (channel === "publish") {
    // 강연자면 그 체험자에게서 받는 연결, 체험자면 내가 보내는 연결.
    return myRole === "speaker" ? (incoming.get(fromId) || {}).pc : publishPc;
  }
  return myRole === "speaker" ? demoPcs.get(fromId) : demoPc;
}

function handleOffer(fromId, sdp, channel) {
  if (channel === "publish") return acceptPublish(fromId, sdp);
  return acceptDemo(fromId, sdp);
}

function handleAnswer(fromId, sdp, channel) {
  const pc = pcFor(channel, fromId);
  if (!pc) return;
  pc.setRemoteDescription(new RTCSessionDescription(sdp))
    .then(() => flushIce(pc))
    .catch((err) => console.warn("[WebRTC] answer 처리 실패:", err.message));
}

function handleIce(fromId, candidate, channel) {
  const pc = pcFor(channel, fromId);
  if (!pc) {
    console.warn(`[WebRTC] 받을 연결이 없어 ICE를 버린다 channel:${channel} from:${fromId}`);
    return;
  }
  addIce(pc, candidate);
}

// ── 공유 버튼 ──

function setShareButton(active, label) {
  shareBtn.classList.toggle("active", active);
  shareBtnLabel.textContent = label;
}

shareBtn.addEventListener("click", () => {
  if (myRole === "speaker") {
    isBroadcaster ? stopDemo(true) : startDemo();
  } else {
    isBroadcaster ? stopPublishing(true) : startPublishing();
  }
});

// ── 격자 ──

let zoomedCellId = null;
const screenGrid = document.getElementById("screenGrid");
const gridWrap = document.getElementById("gridWrap");
const gridEmpty = document.getElementById("gridEmpty");
const gridCount = document.getElementById("gridCount");
const gridFullBtn = document.getElementById("gridFullBtn");
const gridFullLabel = document.getElementById("gridFullLabel");

// 셀은 지우고 다시 만들지 않는다. video 엘리먼트를 다시 만들면 재생이 끊긴다.
function renderGrid() {
  const ids = Array.from(incoming.keys());
  gridCount.textContent = ids.length ? ` ${ids.length}명` : "";
  gridEmpty.classList.toggle("hidden", ids.length > 0);
  screenGrid.dataset.count = String(ids.length);

  ids.forEach((id) => {
    const entry = incoming.get(id);
    let cell = screenGrid.querySelector(`[data-cell="${id}"]`);
    if (!cell) {
      cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.cell = id;
      cell.innerHTML = `
        <video autoplay playsinline muted></video>
        <span class="cell-name"></span>
        <button type="button" class="cell-zoom-btn" aria-label="크게 보기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <span class="cell-waiting">연결하는 중입니다</span>`;
      const zoomBtn = cell.querySelector(".cell-zoom-btn");
      zoomBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleCellZoom(id);
      });
      cell.addEventListener("click", () => toggleCellZoom(id));
      screenGrid.appendChild(cell);
    }
    const video = cell.querySelector("video");
    if (entry.stream && video.srcObject !== entry.stream) video.srcObject = entry.stream;
    cell.classList.toggle("is-live", Boolean(entry.stream));
    cell.querySelector(".cell-name").textContent = entry.name;
  });

  // 나간 사람 셀은 지운다.
  screenGrid.querySelectorAll(".grid-cell").forEach((cell) => {
    if (!incoming.has(cell.dataset.cell)) cell.remove();
  });

  applyZoomState();
}

// 확대한 셀에만 표시를 붙이고 격자에 상태를 알린다. CSS가 나머지를 띠로 줄인다.
function applyZoomState() {
  const active = zoomedCellId && incoming.has(zoomedCellId) ? zoomedCellId : null;
  zoomedCellId = active;
  screenGrid.classList.toggle("has-zoom", Boolean(active));
  // 하나뿐이면 확대 손잡이를 감춘다.
  screenGrid.classList.toggle("solo", incoming.size < 2);
  screenGrid.querySelectorAll(".grid-cell").forEach((cell) => {
    const on = cell.dataset.cell === active;
    cell.classList.toggle("is-zoomed", on);
    const btn = cell.querySelector(".cell-zoom-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "격자로 돌아가기" : "크게 보기");
    }
  });
}

function toggleCellZoom(id) {
  const entry = incoming.get(id);
  if (!entry || !entry.stream) return;
  // 셀이 하나뿐이면 이미 가장 크다. 확대할 것이 없다.
  if (incoming.size < 2 && zoomedCellId !== id) return;
  zoomedCellId = zoomedCellId === id ? null : id;
  applyZoomState();
}

function closeCellZoom() {
  if (!zoomedCellId) return;
  zoomedCellId = null;
  applyZoomState();
}

// 빔프로젝터로 쏠 때 격자만 전체 화면으로 띄운다.
gridFullBtn.addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await gridWrap.requestFullscreen().catch(() => {});
  }
});
document.addEventListener("fullscreenchange", () => {
  const on = Boolean(document.fullscreenElement);
  gridWrap.classList.toggle("is-full", on);
  gridFullLabel.textContent = on ? "전체 화면 끄기" : "전체 화면으로 보기";
});

// ── 나가기 ──
leaveBtn.addEventListener("click", () => {
  leavingOnPurpose = true;
  window.location.reload();
});

window.addEventListener("beforeunload", () => {
  if (!isBroadcaster) return;
  myRole === "speaker" ? stopDemo(true) : stopPublishing(true);
});

// ══════════ 실습 기록물 ══════════

const tabLive = document.getElementById("tabLive");
const tabRecords = document.getElementById("tabRecords");
const panelLive = document.getElementById("panelLive");
const panelRecords = document.getElementById("panelRecords");
const recordsBadge = document.getElementById("recordsBadge");
const recordAuthor = document.getElementById("recordAuthor");
const itemPanel = document.getElementById("itemPanel");
const summaryInput = document.getElementById("summaryInput");
const attachBtn = document.getElementById("attachBtn");
const imageInput = document.getElementById("imageInput");
const previewList = document.getElementById("previewList");
const submitRecordBtn = document.getElementById("submitRecordBtn");
const recordStatus = document.getElementById("recordStatus");
const recordsList = document.getElementById("recordsList");
const recordsEmpty = document.getElementById("recordsEmpty");
const recordsCount = document.getElementById("recordsCount");
const summaryMeta = document.getElementById("summaryMeta");
const resetRecordsBtn = document.getElementById("resetRecordsBtn");
const resetModal = document.getElementById("resetModal");
const resetConfirmInput = document.getElementById("resetConfirmInput");
const resetConfirmBtn = document.getElementById("resetConfirmBtn");
const resetCancelBtn = document.getElementById("resetCancelBtn");
const resetStatus = document.getElementById("resetStatus");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");
const lightboxPrev = document.getElementById("lightboxPrev");
const lightboxNext = document.getElementById("lightboxNext");
const lightboxCount = document.getElementById("lightboxCount");

let selectedItemCode = "";
let selectedFiles = []; // File[] (첨부 대기 목록)
let previewUrls = []; // 미리보기용 objectURL. 다시 그릴 때마다 회수한다
let recordsSetup = false;
let unreadRecords = 0; // 기록물 탭을 떠나 있는 동안 쌓인 새 기록물 수

// 입장 후 한 번만 초기화한다.
function setupRecords() {
  if (recordsSetup) return;
  recordsSetup = true;
  recordAuthor.textContent = myName;
  updateSummaryMeta();
  loadItems();
}

// 탭 전환. 영상은 background에서 계속 재생되므로 뷰어는 그대로 유지된다.
function switchTab(tab) {
  const live = tab === "live";
  tabLive.classList.toggle("is-active", live);
  tabRecords.classList.toggle("is-active", !live);
  tabLive.setAttribute("aria-selected", String(live));
  tabRecords.setAttribute("aria-selected", String(!live));
  panelLive.classList.toggle("hidden", !live);
  panelRecords.classList.toggle("hidden", live);
  if (!live) {
    // 기록물 탭을 열면 미확인 표시를 지운다.
    unreadRecords = 0;
    renderBadge();
  }
}
tabLive.addEventListener("click", () => switchTab("live"));
tabRecords.addEventListener("click", () => switchTab("records"));
// 좌우 방향키로 탭을 옮긴다.
[tabLive, tabRecords].forEach((tab) => {
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === tabLive ? tabRecords : tabLive;
    switchTab(next === tabLive ? "live" : "records");
    next.focus();
  });
});

// 실습 항목 정본을 받아 드롭다운을 만든다.
async function loadItems() {
  try {
    const res = await fetch("/api/items");
    const items = await res.json();
    buildItemList(items);
  } catch (e) {
    itemPanel.innerHTML = '<p class="item-error">항목을 불러오지 못했습니다. 새로고침하세요.</p>';
  }
}

let optionEls = []; // 실제 항목만(그룹 제목 제외)

// 실습 항목을 접지 않고 늘 펼쳐 둔다. 네이티브 radio 대신 우리 마크업으로 라디오그룹을 만든다.
function buildItemList(items) {
  const groups = { A: [], B: [] };
  items.forEach((it) => groups[it.track] && groups[it.track].push(it));
  const section = (track, title) => {
    if (!groups[track].length) return "";
    const opts = groups[track]
      .map(
        (it) => `
        <div class="item-option" role="radio" id="opt-${it.code}" aria-checked="false" tabindex="-1" data-code="${it.code}">
          <span class="track-dot ${track.toLowerCase()}"></span>
          <span class="item-option-label">${escapeHtml(it.label)}</span>
          <span class="item-check" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>
          </span>
        </div>`
      )
      .join("");
    return `<div class="item-group-label" role="presentation">${title}</div>${opts}`;
  };
  itemPanel.innerHTML = section("A", "트랙 A 기초") + section("B", "트랙 B 심화");

  optionEls = Array.from(itemPanel.querySelectorAll(".item-option"));
  // 아무것도 안 골랐을 때 Tab 한 번으로 리스트에 들어오게 첫 항목만 초점 대상으로 둔다.
  if (optionEls[0]) optionEls[0].tabIndex = 0;
  optionEls.forEach((opt, idx) => {
    opt.addEventListener("click", () => selectItem(idx));
    opt.addEventListener("keydown", (e) => onItemKey(e, idx));
  });
}

function selectItem(idx, focus) {
  const opt = optionEls[idx];
  if (!opt) return;
  selectedItemCode = opt.dataset.code;
  optionEls.forEach((o, i) => {
    const on = i === idx;
    o.setAttribute("aria-checked", String(on));
    o.classList.toggle("is-selected", on);
    o.tabIndex = on ? 0 : -1;
  });
  if (focus) opt.focus();
  opt.scrollIntoView({ block: "nearest" });
}

// 라디오그룹 관례대로 화살표로 옮기면 그 자리에서 바로 선택된다.
function onItemKey(e, idx) {
  const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End", " ", "Enter"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  if (e.key === " " || e.key === "Enter") return selectItem(idx, true);
  let next = idx;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (idx + 1) % optionEls.length;
  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (idx - 1 + optionEls.length) % optionEls.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = optionEls.length - 1;
  selectItem(next, true);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (lightbox.classList.contains("is-open")) {
    closeLightbox();
    return;
  }
  if (zoomedCellId) {
    closeCellZoom();
    return;
  }
  if (resetModal.classList.contains("is-open")) closeResetModal();
});

// 이미지 첨부 + 미리보기
attachBtn.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", () => {
  const incoming = Array.from(imageInput.files);
  incoming.forEach((f) => {
    if (selectedFiles.length >= 10) return;
    selectedFiles.push(f);
  });
  imageInput.value = ""; // 같은 파일 다시 선택 가능하게
  renderPreviews();
});

const REMOVE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

// 파일 종류별 인라인 SVG. 아이콘 폰트나 외부 자산을 쓰지 않는다.
// 20px에서도 한눈에 갈리도록 종류마다 실루엣 자체를 다르게 준다.
const DOC_PAGE = `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>`;
const FILE_ICONS = {
  // 둥근 사각 안에 M 봉우리
  markdown: `<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6.5 15.5v-7l3 3.5 3-3.5v7M16 8.5v4.5M16 13l1.75 2.5L19.5 13"/>`,
  // 접힌 문서 아래를 꽉 채운 띠로 덮는다
  pdf: `${DOC_PAGE}<rect x="5" y="13.5" width="14" height="6" rx="1.5" fill="currentColor" stroke="none"/>`,
  // 접힌 문서 안에 글줄 세 개
  docx: `${DOC_PAGE}<path d="M8 12.5h8M8 15.5h8M8 18.5h4.5"/>`,
  // 꺾쇠 두 개. 문서 모양을 아예 안 쓴다
  html: `<path d="M8.5 8L4 12l4.5 4M15.5 8L20 12l-4.5 4M13.5 5.5l-3 13"/>`,
  // 밑줄 없는 판에 T 한 글자
  txt: `<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M8 9h8M12 9v6.5"/>`,
  file: DOC_PAGE,
};

// 종류마다 아이콘, 이름, 그리고 새 탭으로 열 때 붙일 라벨을 정한다.
// open이 없으면 브라우저가 그 자리에서 못 여는 종류라 내려받기만 준다(워드가 그렇다).
function fileShape(file) {
  const name = file.filename || file.name || "파일";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["md", "markdown"].includes(ext)) return { icon: "markdown", label: "마크다운", open: "원문 보기" };
  if (ext === "pdf") return { icon: "pdf", label: "PDF", open: "미리보기" };
  if (ext === "docx") return { icon: "docx", label: "워드", open: null };
  if (["html", "htm"].includes(ext)) return { icon: "html", label: "HTML", open: "새 탭에서 열기" };
  if (ext === "txt") return { icon: "txt", label: "텍스트", open: "새 탭에서 열기" };
  return { icon: "file", label: "파일", open: null };
}

function fileIconSvg(kind, size = 20) {
  return `<svg class="file-icon icon-${kind}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FILE_ICONS[kind] || FILE_ICONS.file}</svg>`;
}

function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function isImageFile(file) {
  return (file.mimeType || file.type || "").startsWith("image/");
}

// ── 아주 작은 마크다운 렌더러 ──
// 원본을 통째로 이스케이프한 뒤 서식을 입힌다. 그래서 문서 안의 HTML은 절대 실행되지 않는다.
function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // 링크는 http와 https만 받는다. 따옴표는 막아 속성 탈출을 차단한다.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"']+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdown(src) {
  // 코드블록을 기준으로 잘라 홀수 조각만 코드로 다룬다. 치환용 표식을 안 써서 본문과 부딪힐 일이 없다.
  return String(src)
    .split(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/)
    .map((part, i) =>
      i % 2 === 1
        ? `<pre><code>${escapeHtml(part.replace(/\n$/, ""))}</code></pre>`
        : renderMarkdownBlocks(escapeHtml(part))
    )
    .join("");
}

// 코드블록을 뺀 조각을 줄 단위로 훑어 제목, 목록, 인용, 문단으로 만든다.
function renderMarkdownBlocks(text) {
  const out = [];
  let list = null;
  const flush = () => {
    if (list) out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  };
  const pushItem = (tag, html) => {
    if (!list || list.tag !== tag) {
      flush();
      list = { tag, items: [] };
    }
    list.items.push(`<li>${html}</li>`);
  };

  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    let m;
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
      flush();
      const level = m[1].length + 2;
      out.push(`<h${level}>${mdInline(m[2])}</h${level}>`);
    } else if ((m = t.match(/^[-*+]\s+(.*)$/))) {
      pushItem("ul", mdInline(m[1]));
    } else if ((m = t.match(/^\d+\.\s+(.*)$/))) {
      pushItem("ol", mdInline(m[1]));
    } else if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      out.push("<hr>");
    } else if ((m = t.match(/^&gt;\s?(.*)$/))) {
      flush();
      out.push(`<blockquote>${mdInline(m[1])}</blockquote>`);
    } else {
      flush();
      out.push(`<p>${mdInline(t)}</p>`);
    }
  }
  flush();
  return out.join("");
}

// 마크다운 본문은 Blob에서 직접 받아 카드 안에 그린다.
async function loadMarkdown(box) {
  const body = box.querySelector(".record-md-body");
  const toggle = box.querySelector(".record-md-toggle");
  try {
    const res = await fetch(box.dataset.url);
    if (!res.ok) throw new Error("불러오기 실패");
    body.innerHTML = renderMarkdown((await res.text()).slice(0, 200000));
  } catch (e) {
    body.textContent = "마크다운을 불러오지 못했습니다.";
    return;
  }
  // 길면 접어 두고 전체 보기를 준다.
  if (body.scrollHeight > 260) {
    box.classList.add("is-clipped");
    toggle.classList.remove("hidden");
    toggle.addEventListener("click", () => {
      const open = box.classList.toggle("is-open");
      toggle.textContent = open ? "접기" : "전체 보기";
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
}

function renderPreviews() {
  // 이전 objectURL을 먼저 회수하고 다시 만든다.
  previewUrls.forEach((u) => URL.revokeObjectURL(u));
  previewUrls = [];
  previewList.innerHTML = "";
  selectedFiles.forEach((file, idx) => {
    const cell = document.createElement("div");
    const remove = `<button type="button" class="preview-remove" aria-label="첨부 ${idx + 1}번 삭제">${REMOVE_ICON}</button>`;
    if (isImageFile(file)) {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      cell.className = "preview-thumb";
      cell.innerHTML = `<img src="${url}" alt="첨부 미리보기 ${idx + 1}번">${remove}`;
    } else {
      // 문서는 썸네일이 없으므로 종류 아이콘과 이름으로 보여준다.
      const shape = fileShape(file);
      cell.className = "preview-doc";
      cell.innerHTML = `
        <span class="preview-doc-icon">${fileIconSvg(shape.icon)}</span>
        <span class="preview-doc-body">
          <span class="preview-doc-name">${escapeHtml(file.name)}</span>
          <span class="preview-doc-meta">${shape.label} ${formatBytes(file.size)}</span>
        </span>${remove}`;
    }
    cell.querySelector(".preview-remove").addEventListener("click", () => {
      selectedFiles.splice(idx, 1);
      renderPreviews();
    });
    previewList.appendChild(cell);
  });
}

// 기록물 올리기
submitRecordBtn.addEventListener("click", async () => {
  if (!selectedItemCode) {
    setRecordStatus("실습 항목을 선택하세요.", "error");
    return;
  }
  const summary = summaryInput.value.trim();
  if (!summary && selectedFiles.length === 0) {
    setRecordStatus("결과 요약이나 파일을 하나 이상 올리세요.", "error");
    return;
  }

  const form = new FormData();
  form.append("room", myRoom);
  form.append("name", myName);
  form.append("itemCode", selectedItemCode);
  form.append("summary", summary);
  selectedFiles.forEach((f) => form.append("files", f));

  submitRecordBtn.disabled = true;
  submitRecordBtn.textContent = "올리는 중입니다";
  setRecordStatus("", "");
  try {
    const res = await fetch("/api/records", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setRecordStatus(data.error || "올리지 못했습니다.", "error");
    } else {
      // 서버가 방 전원에게 record-added를 보내므로 카드는 그쪽에서 그려진다.
      summaryInput.value = "";
      updateSummaryMeta();
      selectedFiles = [];
      renderPreviews();
      setRecordStatus("올렸습니다.", "ok");
    }
  } catch (e) {
    setRecordStatus("올리지 못했습니다. 잠시 후 다시 시도하세요.", "error");
  } finally {
    submitRecordBtn.disabled = false;
    submitRecordBtn.textContent = "기록물 올리기";
  }
});

let statusTimer = null;
function setRecordStatus(text, kind) {
  recordStatus.textContent = text;
  recordStatus.className = "record-status" + (kind ? " " + kind : "");
  clearTimeout(statusTimer);
  // 성공 문구는 잠시 뒤 스스로 사라진다. 오류는 남긴다.
  if (kind === "ok") statusTimer = setTimeout(() => setRecordStatus("", ""), 4000);
}

function updateSummaryMeta() {
  summaryMeta.textContent = `${summaryInput.value.length} / 2000`;
}
summaryInput.addEventListener("input", updateSummaryMeta);

// 카드 렌더링
function renderAllRecords(list) {
  recordsList.innerHTML = "";
  unreadRecords = 0; // 입장 시 초기 목록과 초기화 직후에는 안 본 건수가 없다
  // 최신이 위로 오게 역순 렌더(서버는 오래된 순으로 보낸다)
  list.slice().reverse().forEach((r) => addRecordCard(r, false));
  updateRecordsMeta();
}

function addRecordCard(record, prepend) {
  const card = document.createElement("div");
  card.className = "record-card" + (record.track === "B" ? " track-b" : "");
  if (prepend) card.classList.add("is-new");

  const all = record.files || [];
  const imageFiles = all.filter((f) => f.kind === "image");
  const markdownFiles = all.filter((f) => f.kind === "markdown");
  const docFiles = all.filter((f) => f.kind === "document");
  const urls = imageFiles.map((f) => f.url);

  const images = imageFiles
    .map(
      (f, i) => `<button type="button" class="record-image" data-index="${i}"><img src="${escapeHtml(f.url)}" alt="${escapeHtml(f.filename)}" loading="lazy"></button>`
    )
    .join("");

  // 마크다운은 카드 안에서 바로 읽게 한다. 원본은 이스케이프한 뒤 렌더한다.
  const markdown = markdownFiles
    .map(
      (f) => `
      <div class="record-md" data-url="${escapeHtml(f.url)}">
        <div class="record-md-head">
          <span class="record-md-icon">${fileIconSvg("markdown", 16)}</span>
          <span class="record-md-name">${escapeHtml(f.filename)}</span>
          <span class="record-md-size">${formatBytes(f.size)}</span>
          <button type="button" class="record-md-toggle hidden" aria-expanded="false">전체 보기</button>
          <a class="doc-action" href="${escapeHtml(f.url)}" download="${escapeHtml(f.filename)}">내려받기</a>
        </div>
        <div class="record-md-body">불러오는 중입니다.</div>
      </div>`
    )
    .join("");

  // HTML은 앱 안에서 렌더하지 않는다. 새 탭으로만 연다.
  const docs = docFiles
    .map((f) => {
      const shape = fileShape(f);
      return `
      <div class="record-doc">
        <span class="record-doc-icon">${fileIconSvg(shape.icon)}</span>
        <span class="record-doc-body">
          <span class="record-doc-name">${escapeHtml(f.filename)}</span>
          <span class="record-doc-meta">${shape.label} ${formatBytes(f.size)}</span>
        </span>
        <span class="record-doc-actions">
          ${shape.open ? `<a class="doc-action is-open" href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">${shape.open}</a>` : ""}
          <a class="doc-action" href="${escapeHtml(f.url)}" download="${escapeHtml(f.filename)}">내려받기</a>
        </span>
      </div>`;
    })
    .join("");

  card.innerHTML = `
    <div class="record-card-head">
      <span class="item-badge">${escapeHtml(record.itemLabel)}</span>
      <span class="record-author">${escapeHtml(record.name)}</span>
      <span class="record-time">${formatTime(record.createdAt)}</span>
    </div>
    ${record.summary ? `<p class="record-summary">${escapeHtml(record.summary)}</p>` : ""}
    ${images ? `<div class="record-images">${images}</div>` : ""}
    ${markdown}
    ${docs ? `<div class="record-docs">${docs}</div>` : ""}
  `;

  card.querySelectorAll(".record-image").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(urls, Number(btn.dataset.index), btn));
  });
  card.querySelectorAll(".record-md").forEach(loadMarkdown);

  if (prepend) {
    recordsList.prepend(card);
    bumpBadge();
  } else {
    recordsList.appendChild(card);
  }
  updateRecordsMeta();
}

function updateRecordsMeta() {
  const count = recordsList.children.length;
  recordsEmpty.classList.toggle("hidden", count > 0);
  recordsCount.textContent = count > 0 ? `${count}개` : "";
  renderBadge();
}

// 배지는 전체 건수가 아니라 아직 안 본 건수만 보여준다. 전체 수는 패널 헤더가 맡는다.
function renderBadge() {
  recordsBadge.textContent = String(unreadRecords);
  recordsBadge.classList.toggle("hidden", unreadRecords === 0);
}

function bumpBadge() {
  if (panelRecords.classList.contains("hidden")) {
    unreadRecords += 1;
    renderBadge();
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// 열려 있는 오버레이 밖으로 Tab이 새지 않게 막는다.
function trapFocus(e, container) {
  const items = Array.from(
    container.querySelectorAll("button:not(.hidden), input, [tabindex]:not([tabindex='-1'])")
  ).filter((el) => el.offsetParent !== null && !el.disabled);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// 라이트박스. 한 카드의 이미지 묶음을 통째로 받아 그 안에서 넘긴다.
let lightboxUrls = [];
let lightboxIndex = 0;
let lightboxOpener = null; // 닫을 때 포커스를 돌려줄 버튼

function openLightbox(urls, index, opener) {
  lightboxUrls = urls;
  lightboxIndex = index;
  lightboxOpener = opener || null;
  showLightboxImage();
  lightbox.classList.add("is-open");
  document.body.style.overflow = "hidden";
  lightboxClose.focus();
}

function showLightboxImage() {
  lightboxImg.src = lightboxUrls[lightboxIndex] || "";
  lightboxImg.alt = `첨부 이미지 확대 ${lightboxIndex + 1}번`;
  const many = lightboxUrls.length > 1;
  lightboxPrev.classList.toggle("hidden", !many);
  lightboxNext.classList.toggle("hidden", !many);
  lightboxCount.classList.toggle("hidden", !many);
  lightboxCount.textContent = `${lightboxIndex + 1} / ${lightboxUrls.length}`;
}

function stepLightbox(delta) {
  if (lightboxUrls.length < 2) return;
  lightboxIndex = (lightboxIndex + delta + lightboxUrls.length) % lightboxUrls.length;
  showLightboxImage();
}

function closeLightbox() {
  lightbox.classList.remove("is-open");
  lightboxImg.src = "";
  document.body.style.overflow = "";
  if (lightboxOpener) lightboxOpener.focus();
  lightboxOpener = null;
}
lightboxClose.addEventListener("click", closeLightbox);
lightboxPrev.addEventListener("click", () => stepLightbox(-1));
lightboxNext.addEventListener("click", () => stepLightbox(1));
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
lightbox.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") stepLightbox(-1);
  else if (e.key === "ArrowRight") stepLightbox(1);
  else if (e.key === "Tab") trapFocus(e, lightbox);
});

// 초기화 모달
const resetModalDesc = document.getElementById("resetModalDesc");

resetRecordsBtn.addEventListener("click", () => {
  const count = recordsList.children.length;
  resetModalDesc.textContent = `이 방의 기록물 ${count}개와 첨부 이미지를 모두 삭제합니다. 되돌릴 수 없습니다.`;
  resetConfirmInput.value = "";
  resetConfirmBtn.disabled = true;
  resetStatus.textContent = "";
  resetModal.classList.add("is-open");
  resetConfirmInput.focus();
});
function closeResetModal() {
  resetModal.classList.remove("is-open");
  resetRecordsBtn.focus();
}
resetCancelBtn.addEventListener("click", closeResetModal);
resetModal.addEventListener("click", (e) => {
  if (e.target === resetModal) closeResetModal();
});
resetModal.addEventListener("keydown", (e) => {
  if (e.key === "Tab") trapFocus(e, resetModal);
});
resetConfirmInput.addEventListener("input", () => {
  resetConfirmBtn.disabled = resetConfirmInput.value.trim() !== "초기화";
});
resetConfirmBtn.addEventListener("click", async () => {
  resetConfirmBtn.disabled = true;
  resetStatus.textContent = "초기화하는 중입니다.";
  try {
    const res = await fetch("/api/records/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: myRoom, confirm: resetConfirmInput.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      resetStatus.textContent = data.error || "초기화하지 못했습니다.";
      resetConfirmBtn.disabled = false;
    } else {
      // 서버가 records-reset을 방 전원에게 보내 목록을 비운다.
      closeResetModal();
    }
  } catch (e) {
    resetStatus.textContent = "초기화하지 못했습니다.";
    resetConfirmBtn.disabled = false;
  }
});

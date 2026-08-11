// 동해 AI 교육용 실시간 화면 공유 도구 — 클라이언트

// ICE 서버 설정. 기본은 구글 무료 STUN만 사용한다.
// 회사·기관 와이파이처럼 막힌 네트워크에서 화면이 안 뜨면,
// 무료 TURN 서버(Metered, OpenRelay 등)에 가입해 아래 배열에 추가한다.
// 예: { urls: "turn:openrelay.metered.ca:80", username: "...", credential: "..." }
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // 여기에 TURN 서버를 추가할 수 있다.
];

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
const peerConnections = {}; // remoteId -> RTCPeerConnection (내가 발표자일 때 여러 개)
let viewerPc = null; // 내가 시청자일 때 발표자와의 연결 하나

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
const remoteVideo = document.getElementById("remoteVideo");
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

function join(room, name, role) {
  myRoom = room;
  myName = name;
  myRole = role;
  const btn = role === "speaker" ? enterRoomBtn : joinBtn;
  btn.disabled = true;
  btn.textContent = "입장하는 중입니다";
  joinHint.textContent = "";

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  // 서버가 코드를 확인하고 joined를 보내줄 때까지 화면을 넘기지 않는다.
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", id: myId, room: myRoom, name: myName }));
  });

  ws.addEventListener("message", (evt) => {
    const msg = JSON.parse(evt.data);
    handleMessage(msg);
  });

  ws.addEventListener("close", () => {
    if (!joinScreen.classList.contains("hidden")) return;
    shareStatus.textContent = "연결이 끊어졌습니다. 페이지를 새로고침하세요.";
  });

  ws.addEventListener("error", () => {
    resetJoinButton();
    joinHint.textContent = "연결에 실패했습니다. 잠시 후 다시 시도하세요.";
  });
}

function resetJoinButton() {
  joinBtn.disabled = false;
  joinBtn.textContent = "입장하기";
  enterRoomBtn.disabled = false;
  enterRoomBtn.textContent = "방에 입장하기";
}

// 서버가 역할을 확정해 돌려준 다음에 회의실로 넘어간다.
function onJoined(room, role) {
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
  setupRecords();
}

// 강연자가 방을 닫으면 체험자 쪽에서 뜬다. 공유를 정리하고 알린다.
function alertRoomClosed(reason) {
  if (isBroadcaster) stopSharing(false);
  const modal = document.getElementById("closedModal");
  document.getElementById("closedModalDesc").textContent = reason || "강연자가 방을 종료했습니다.";
  modal.classList.add("is-open");
  document.getElementById("closedModalBtn").focus();
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
      ws.close();
      break;
    case "room-closed":
      alertRoomClosed(msg.reason);
      break;
    case "participants":
      renderParticipants(msg.list, msg.broadcasterId);
      break;
    case "broadcaster-changed":
      onBroadcasterChanged(msg.broadcasterId, msg.name);
      break;
    case "you-are-broadcaster":
      startBroadcastingTo(msg.viewerIds);
      break;
    case "new-viewer":
      if (isBroadcaster && localStream) {
        connectToViewer(msg.id);
      }
      break;
    case "offer":
      handleOffer(msg.from, msg.sdp);
      break;
    case "answer":
      handleAnswer(msg.from, msg.sdp);
      break;
    case "ice":
      handleIce(msg.from, msg.candidate);
      break;
    case "force-stop-share":
      stopSharing(false);
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

function renderParticipants(list, broadcasterId) {
  participantCount.textContent = `참가자 ${list.length}명`;
  participantList.innerHTML = list
    .map((p) => {
      const initial = p.name.slice(0, 1).toUpperCase();
      const presenting = p.id === broadcasterId;
      return `
        <li class="participant-item ${presenting ? "is-presenting" : ""}">
          <span class="avatar" style="background:${avatarColor(p.name)}">${escapeHtml(initial)}</span>
          <span class="p-name">${escapeHtml(p.name)}${p.id === myId ? " (나)" : ""}</span>
          ${presenting ? '<span class="p-tag">발표중</span>' : ""}
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
  if (broadcasterId === myId) return; // 내가 발표자면 별도 처리 안 함

  // 이전 시청 연결 정리
  if (viewerPc) {
    viewerPc.close();
    viewerPc = null;
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

// ── 발표자 쪽 로직 ──
shareBtn.addEventListener("click", async () => {
  if (isBroadcaster) {
    stopSharing(true);
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 10 },
      audio: false,
    });
  } catch (e) {
    shareStatus.textContent = "화면 공유가 취소되었습니다.";
    return;
  }

  isBroadcaster = true;
  shareBtnLabel.textContent = "공유 중지";
  shareBtn.classList.add("active");
  shareStatus.textContent = "내 화면을 공유하고 있습니다.";
  setPlaceholder("gone");
  presenterBadge.classList.remove("hidden");
  presenterBadge.textContent = "나의 화면 공유 중";
  dotLive.classList.add("is-live");
  remoteVideo.srcObject = localStream;

  localStream.getVideoTracks()[0].addEventListener("ended", () => {
    stopSharing(true);
  });

  ws.send(JSON.stringify({ type: "start-share" }));
});

function startBroadcastingTo(viewerIds) {
  viewerIds.forEach((id) => connectToViewer(id));
}

function connectToViewer(viewerId) {
  if (peerConnections[viewerId]) return;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnections[viewerId] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: "ice", to: viewerId, candidate: e.candidate }));
    }
  };

  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => {
      ws.send(JSON.stringify({ type: "offer", to: viewerId, sdp: pc.localDescription }));
    });
}

function handleAnswer(fromId, sdp) {
  const pc = peerConnections[fromId];
  if (pc) pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

function stopSharing(notifyServer) {
  isBroadcaster = false;
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  Object.values(peerConnections).forEach((pc) => pc.close());
  Object.keys(peerConnections).forEach((k) => delete peerConnections[k]);

  shareBtnLabel.textContent = "내 화면 공유하기";
  shareBtn.classList.remove("active");
  shareStatus.textContent = "";
  remoteVideo.srcObject = null;
  setPlaceholder("idle");
  presenterBadge.classList.add("hidden");
  dotLive.classList.remove("is-live");

  if (notifyServer && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stop-share" }));
  }
}

// ── 시청자 쪽 로직 ──
function handleOffer(fromId, sdp) {
  if (viewerPc) {
    viewerPc.close();
    viewerPc = null;
  }
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  viewerPc = pc;

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    setPlaceholder("gone");
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: "ice", to: fromId, candidate: e.candidate }));
    }
  };

  pc.setRemoteDescription(new RTCSessionDescription(sdp))
    .then(() => pc.createAnswer())
    .then((answer) => pc.setLocalDescription(answer))
    .then(() => {
      ws.send(JSON.stringify({ type: "answer", to: fromId, sdp: pc.localDescription }));
    });
}

function handleIce(fromId, candidate) {
  const pc = isBroadcaster ? peerConnections[fromId] : viewerPc;
  if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
}

// ── 나가기 ──
leaveBtn.addEventListener("click", () => {
  window.location.reload();
});

window.addEventListener("beforeunload", () => {
  if (isBroadcaster) stopSharing(true);
});

// ══════════ 실습 기록물 ══════════

const tabLive = document.getElementById("tabLive");
const tabRecords = document.getElementById("tabRecords");
const panelLive = document.getElementById("panelLive");
const panelRecords = document.getElementById("panelRecords");
const recordsBadge = document.getElementById("recordsBadge");
const recordAuthor = document.getElementById("recordAuthor");
const itemTrigger = document.getElementById("itemTrigger");
const itemTriggerLabel = document.getElementById("itemTriggerLabel");
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
    buildDropdown(items);
  } catch (e) {
    itemTriggerLabel.textContent = "항목을 불러오지 못했습니다";
  }
}

let optionEls = []; // 화살표 이동 대상(그룹 라벨은 제외한 실제 항목만)
let activeIndex = -1;

function buildDropdown(items) {
  const groups = { A: [], B: [] };
  items.forEach((it) => groups[it.track] && groups[it.track].push(it));
  const section = (track, title) => {
    if (!groups[track].length) return "";
    const opts = groups[track]
      .map(
        (it) => `
        <div class="dropdown-option" role="option" id="opt-${it.code}" aria-selected="false" data-code="${it.code}">
          <span class="track-dot ${track.toLowerCase()}"></span>
          <span>${escapeHtml(it.label)}</span>
        </div>`
      )
      .join("");
    return `<div class="dropdown-group-label" role="presentation">${title}</div>${opts}`;
  };
  itemPanel.innerHTML = section("A", "트랙 A 기초") + section("B", "트랙 B 심화");

  optionEls = Array.from(itemPanel.querySelectorAll(".dropdown-option"));
  optionEls.forEach((opt, idx) => {
    opt.addEventListener("click", () => selectOption(idx));
    opt.addEventListener("pointerenter", () => setActive(idx));
  });
}

function selectOption(idx) {
  const opt = optionEls[idx];
  if (!opt) return;
  selectedItemCode = opt.dataset.code;
  itemTriggerLabel.textContent = opt.querySelector("span:last-child").textContent;
  itemTriggerLabel.classList.remove("dropdown-placeholder");
  optionEls.forEach((o) => o.setAttribute("aria-selected", "false"));
  opt.setAttribute("aria-selected", "true");
  closeDropdown();
}

// 포커스는 트리거에 두고 aria-activedescendant로 활성 항목만 옮긴다.
function setActive(idx) {
  activeIndex = idx;
  optionEls.forEach((o, i) => o.classList.toggle("is-active", i === idx));
  const opt = optionEls[idx];
  if (opt) {
    itemTrigger.setAttribute("aria-activedescendant", opt.id);
    opt.scrollIntoView({ block: "nearest" });
  } else {
    itemTrigger.removeAttribute("aria-activedescendant");
  }
}

function openDropdown() {
  // 아래 공간이 모자라면 위로 펼친다.
  const below = window.innerHeight - itemTrigger.getBoundingClientRect().bottom;
  itemPanel.classList.toggle("drop-up", below < 260);
  itemPanel.classList.add("is-open");
  itemTrigger.setAttribute("aria-expanded", "true");
  const selected = optionEls.findIndex((o) => o.dataset.code === selectedItemCode);
  setActive(selected >= 0 ? selected : 0);
}
function closeDropdown() {
  itemPanel.classList.remove("is-open");
  itemTrigger.setAttribute("aria-expanded", "false");
  itemTrigger.removeAttribute("aria-activedescendant");
  optionEls.forEach((o) => o.classList.remove("is-active"));
  activeIndex = -1;
}
function dropdownOpen() {
  return itemPanel.classList.contains("is-open");
}

itemTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  dropdownOpen() ? closeDropdown() : openDropdown();
});
itemTrigger.addEventListener("keydown", (e) => {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "];
  if (!keys.includes(e.key)) return;
  if (!dropdownOpen()) {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openDropdown();
    }
    return;
  }
  e.preventDefault();
  if (e.key === "ArrowDown") setActive(Math.min(activeIndex + 1, optionEls.length - 1));
  else if (e.key === "ArrowUp") setActive(Math.max(activeIndex - 1, 0));
  else if (e.key === "Home") setActive(0);
  else if (e.key === "End") setActive(optionEls.length - 1);
  else selectOption(activeIndex);
});
itemTrigger.addEventListener("blur", () => {
  if (dropdownOpen()) closeDropdown();
});
// 항목을 눌러도 포커스는 트리거에 남긴다(누르는 순간 닫히지 않게).
itemPanel.addEventListener("pointerdown", (e) => e.preventDefault());
document.addEventListener("click", (e) => {
  if (!e.target.closest("#itemDropdown")) closeDropdown();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (dropdownOpen()) {
    closeDropdown();
    itemTrigger.focus();
    return;
  }
  if (lightbox.classList.contains("is-open")) {
    closeLightbox();
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

function renderPreviews() {
  // 이전 objectURL을 먼저 회수하고 다시 만든다.
  previewUrls.forEach((u) => URL.revokeObjectURL(u));
  previewUrls = [];
  previewList.innerHTML = "";
  selectedFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    const thumb = document.createElement("div");
    thumb.className = "preview-thumb";
    thumb.innerHTML = `<img src="${url}" alt="첨부 미리보기 ${idx + 1}번"><button type="button" class="preview-remove" aria-label="첨부 ${idx + 1}번 삭제">${REMOVE_ICON}</button>`;
    thumb.querySelector(".preview-remove").addEventListener("click", () => {
      selectedFiles.splice(idx, 1);
      renderPreviews();
    });
    previewList.appendChild(thumb);
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
    setRecordStatus("결과 요약이나 이미지를 하나 이상 올리세요.", "error");
    return;
  }

  const form = new FormData();
  form.append("room", myRoom);
  form.append("name", myName);
  form.append("itemCode", selectedItemCode);
  form.append("summary", summary);
  selectedFiles.forEach((f) => form.append("images", f));

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

  const urls = record.images || [];
  const images = urls
    .map(
      (url, i) => `<button type="button" class="record-image" data-index="${i}"><img src="${escapeHtml(url)}" alt="${escapeHtml(record.itemLabel)} 첨부 이미지 ${i + 1}번" loading="lazy"></button>`
    )
    .join("");

  card.innerHTML = `
    <div class="record-card-head">
      <span class="item-badge">${escapeHtml(record.itemLabel)}</span>
      <span class="record-author">${escapeHtml(record.name)}</span>
      <span class="record-time">${formatTime(record.createdAt)}</span>
    </div>
    ${record.summary ? `<p class="record-summary">${escapeHtml(record.summary)}</p>` : ""}
    ${images ? `<div class="record-images">${images}</div>` : ""}
  `;

  card.querySelectorAll(".record-image").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(urls, Number(btn.dataset.index), btn));
  });

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

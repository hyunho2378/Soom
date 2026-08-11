// 화면 공유 도구 UI 검증 하네스. 새 의존성 없이 프로젝트의 ws로 CDP를 직접 붙인다.
const WebSocket = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = "http://localhost:3000/";
const OUT = process.argv[2] || "/tmp/shots";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeUp(port, profile) {
  const p = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--disable-gpu", "--window-size=1440,900",
    "--use-fake-ui-for-media-stream", "--auto-accept-this-tab-capture",
  ], { stdio: "ignore" });
  return p;
}

async function targets(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error("Chrome 디버깅 포트가 안 열렸다");
}

async function newPage(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  return res.json();
}

class Page {
  constructor(wsUrl, tag) {
    this.tag = tag;
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    this.ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  }
  ready() {
    return new Promise((res, rej) => {
      // 이미 열렸으면 open 이벤트는 지나갔다. 그대로 통과시킨다.
      if (this.ws.readyState === WebSocket.OPEN) res();
      this.ws.on("open", res);
      this.ws.on("error", rej);
      this.ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
        } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
          this.logs.push(`[${this.tag}][${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
        } else if (m.method === "Runtime.exceptionThrown") {
          this.logs.push(`[${this.tag}][exception] ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
        }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(`${this.tag}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
  }
  async resize(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  }
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

(async () => {
  const profA = "/tmp/cr-a", profB = "/tmp/cr-b";
  fs.rmSync(profA, { recursive: true, force: true });
  fs.rmSync(profB, { recursive: true, force: true });
  const c1 = chromeUp(9333, profA), c2 = chromeUp(9334, profB);
  const t1 = await targets(9333), t2 = await targets(9334);

  const a = new Page(t1.webSocketDebuggerUrl, "A");
  const b = new Page(t2.webSocketDebuggerUrl, "B");
  await a.ready(); await b.ready();
  for (const p of [a, b]) {
    await p.send("Page.enable");
    await p.send("Runtime.enable");
  }

  const room = "검증방" + Date.now().toString().slice(-4);

  // 1. 입장 화면
  await a.send("Page.navigate", { url: APP });
  await sleep(1200);
  await a.shot("01-입장화면");
  const fontOk = await a.evaluate(`
    await document.fonts.ready;
    return document.fonts.check("700 16px 'Pretendard Variable'");
  `);
  check("Pretendard Variable 폰트가 실제로 로드된다", fontOk === true, String(fontOk));

  const smoothing = await a.evaluate(`return getComputedStyle(document.documentElement).webkitFontSmoothing`);
  check("루트에 antialiased 적용", smoothing === "antialiased", smoothing);

  // 2. 입장
  await a.evaluate(`
    document.getElementById("roomInput").value = ${JSON.stringify(room)};
    document.getElementById("nameInput").value = "김현호";
    document.getElementById("joinBtn").click();
    return true;
  `);
  await sleep(1000);
  const inRoom = await a.evaluate(`return !document.getElementById("roomScreen").classList.contains("hidden")`);
  check("A 입장 성공", inRoom === true);
  await a.shot("02-회의실-실시간화면");

  // 3. B 입장 후 참가자 갱신(WS 경로 무손상 확인)
  await b.send("Page.navigate", { url: APP });
  await sleep(1000);
  await b.evaluate(`
    document.getElementById("roomInput").value = ${JSON.stringify(room)};
    document.getElementById("nameInput").value = "박수강";
    document.getElementById("joinBtn").click();
    return true;
  `);
  await sleep(1000);
  const countText = await a.evaluate(`return document.getElementById("participantCount").textContent`);
  check("참가자 수가 실시간 갱신된다", countText.includes("2"), countText);

  const dotIdle = await a.evaluate(`return document.getElementById("dotLive").classList.contains("is-live")`);
  check("발표자 없을 때 라이브 점이 꺼져 있다", dotIdle === false);

  // 4. 기록물 탭과 드롭다운
  await a.evaluate(`document.getElementById("tabRecords").click(); return true`);
  await sleep(300);
  await a.evaluate(`document.getElementById("itemTrigger").click(); return true`);
  await sleep(400);
  await a.shot("03-드롭다운-열림");
  const ddState = await a.evaluate(`
    const p = document.getElementById("itemPanel"), t = document.getElementById("itemTrigger");
    return {
      open: p.classList.contains("is-open"),
      expanded: t.getAttribute("aria-expanded"),
      active: t.getAttribute("aria-activedescendant"),
      opts: p.querySelectorAll('[role="option"]').length,
      opacity: getComputedStyle(p).opacity
    };
  `);
  check("드롭다운이 열리고 ARIA가 붙는다",
    ddState.open && ddState.expanded === "true" && ddState.opts === 17 && ddState.active === "opt-A01",
    JSON.stringify(ddState));

  // 키보드로 세 칸 내려가 선택
  const kbd = await a.evaluate(`
    const t = document.getElementById("itemTrigger");
    const key = (k) => t.dispatchEvent(new KeyboardEvent("keydown", {key:k, bubbles:true, cancelable:true}));
    key("ArrowDown"); key("ArrowDown"); key("ArrowDown");
    const before = t.getAttribute("aria-activedescendant");
    key("Enter");
    return { before, label: document.getElementById("itemTriggerLabel").textContent,
             closed: !document.getElementById("itemPanel").classList.contains("is-open") };
  `);
  check("화살표와 Enter로 항목을 고른다",
    kbd.before === "opt-A04" && kbd.closed && kbd.label.startsWith("A04"), JSON.stringify(kbd));

  // 5. 이미지 첨부 후 업로드
  const uploaded = await a.evaluate(`
    const png = "iVBORw0KGgoAAAANSUhEUgAAAMgAAACWCAYAAACb3McZAAAAWklEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgFcDVYAAAaTQ1IsAAAAASUVORK5CYII=";
    const blob = await (await fetch("data:image/png;base64," + png)).blob();
    selectedFiles.push(new File([blob], "실습결과.png", { type: "image/png" }));
    renderPreviews();
    document.getElementById("summaryInput").value = "프로젝트를 만들고 자료를 넣어 정리했습니다.";
    document.getElementById("summaryInput").dispatchEvent(new Event("input"));
    return { thumbs: document.querySelectorAll(".preview-thumb").length,
             meta: document.getElementById("summaryMeta").textContent };
  `);
  check("첨부 미리보기와 글자 수 표시", uploaded.thumbs === 1 && uploaded.meta === "24 / 2000", JSON.stringify(uploaded));
  await a.shot("04-기록물-폼");

  await a.evaluate(`document.getElementById("submitRecordBtn").click(); return true`);
  await sleep(1500);
  const posted = await a.evaluate(`
    return { cards: document.querySelectorAll(".record-card").length,
             count: document.getElementById("recordsCount").textContent,
             status: document.getElementById("recordStatus").textContent,
             imgs: document.querySelectorAll(".record-image").length };
  `);
  check("기록물이 올라가고 카드가 그려진다", posted.cards === 1 && posted.imgs === 1 && posted.count === "1개", JSON.stringify(posted));
  await a.shot("05-기록물-카드");

  // 6. B는 실시간 탭에 있으므로 미확인 배지가 1이어야 한다
  const badgeB = await b.evaluate(`
    const bd = document.getElementById("recordsBadge");
    return { text: bd.textContent, hidden: bd.classList.contains("hidden"),
             cards: document.querySelectorAll(".record-card").length };
  `);
  check("다른 탭에 있으면 미확인 배지가 1", badgeB.text === "1" && !badgeB.hidden && badgeB.cards === 1, JSON.stringify(badgeB));
  await b.shot("06-B-미확인배지");

  const badgeCleared = await b.evaluate(`
    document.getElementById("tabRecords").click();
    return { text: document.getElementById("recordsBadge").textContent,
             hidden: document.getElementById("recordsBadge").classList.contains("hidden") };
  `);
  check("탭을 열면 배지가 사라진다", badgeCleared.hidden === true, JSON.stringify(badgeCleared));

  // 7. 라이트박스
  await b.evaluate(`document.querySelector(".record-image").click(); return true`);
  await sleep(400);
  const lb = await b.evaluate(`
    const l = document.getElementById("lightbox");
    const c = document.getElementById("lightboxClose");
    const diag = { vis: getComputedStyle(l).visibility, offsetParent: c.offsetParent !== null };
    return { open: l.classList.contains("is-open"), diag,
             focus: document.activeElement.id,
             navHidden: document.getElementById("lightboxPrev").classList.contains("hidden"),
             scrollLocked: document.body.style.overflow === "hidden",
             fit: getComputedStyle(document.getElementById("lightboxImg")).objectFit };
  `);
  check("라이트박스가 열리고 포커스와 스크롤을 잡는다",
    lb.open && lb.focus === "lightboxClose" && lb.scrollLocked && lb.fit === "contain" && lb.navHidden,
    JSON.stringify(lb));
  await b.shot("07-라이트박스");

  const escClosed = await b.evaluate(`
    document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
    return { open: document.getElementById("lightbox").classList.contains("is-open"),
             scroll: document.body.style.overflow };
  `);
  check("Escape로 라이트박스가 닫힌다", escClosed.open === false && escClosed.scroll === "", JSON.stringify(escClosed));

  // 8. 초기화 모달 Escape
  const modal = await b.evaluate(`
    document.getElementById("resetRecordsBtn").click();
    const desc = document.getElementById("resetModalDesc").textContent;
    const opened = document.getElementById("resetModal").classList.contains("is-open");
    document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
    return { desc, opened, closed: !document.getElementById("resetModal").classList.contains("is-open"),
             focus: document.activeElement.id };
  `);
  check("초기화 모달이 건수를 보여주고 Escape로 닫힌다",
    modal.opened && modal.closed && modal.desc.includes("1개") && modal.focus === "resetRecordsBtn",
    JSON.stringify(modal));

  // 9. 반응형
  for (const [w, h, name] of [[860, 900, "08-반응형-860"], [420, 850, "09-반응형-420"], [320, 800, "10-반응형-320"]]) {
    await a.resize(w, h);
    await sleep(400);
    await a.shot(name);
    const overflow = await a.evaluate(`
      return { doc: document.documentElement.scrollWidth, win: window.innerWidth,
               strip: getComputedStyle(document.querySelector(".participant-list")).flexDirection };
    `);
    check(`${w}px 가로 스크롤 없음`, overflow.doc <= overflow.win, JSON.stringify(overflow));
    if (w === 860) check("860px에서 참가자가 가로 띠로 접힌다", overflow.strip === "row", overflow.strip);
  }
  await a.resize(1440, 900);
  await a.evaluate(`document.getElementById("tabLive").click(); return true`);
  await sleep(300);
  await a.shot("11-실시간화면-복귀");

  // 세로가 짧은 노트북에서 공유 버튼이 접힘 위에 남는지
  await a.resize(1440, 720);
  await sleep(400);
  const fold = await a.evaluate(`
    const f = document.getElementById("viewerFrame").getBoundingClientRect();
    const b = document.getElementById("shareBtn").getBoundingClientRect();
    return { ratio: +(f.width / f.height).toFixed(2), btnBottom: Math.round(b.bottom), vh: window.innerHeight };
  `);
  check("720px 높이에서 공유 버튼이 접힘 위에 있다",
    fold.btnBottom <= fold.vh && fold.ratio === 1.78, JSON.stringify(fold));
  await a.shot("12-짧은화면-720");
  await a.resize(1440, 900);

  // 10. reduced motion
  await a.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(300);
  const rm = await a.evaluate(`
    document.getElementById("dotLive").classList.add("is-live");
    const dot = getComputedStyle(document.getElementById("dotLive")).animationName;
    document.getElementById("dotLive").classList.remove("is-live");
    return dot;
  `);
  check("reduced-motion에서 펄스가 꺼진다", rm === "none", rm);
  await a.send("Emulation.setEmulatedMedia", { features: [] });

  const logs = [...a.logs, ...b.logs];
  check("콘솔 오류 없음", logs.length === 0, logs.join(" | "));

  console.log("\n=== 요약 ===");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length} / ${results.length} 통과`);
  failed.forEach((f) => console.log(`실패: ${f.name} ${f.detail}`));

  c1.kill(); c2.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("하네스 오류:", e.message); process.exit(2); });

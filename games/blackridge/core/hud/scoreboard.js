// core/hud/scoreboard.js [W6] — hold-TAB match scoreboard + the end-of-match
// board (PVP_BUILD_PLAN Part 4.1 row W6; modes.md §6.1, §7.1–7.4).
//
// Two presentations of one table:
//   - HELD TAB while a match is live (held, not toggled — pvp_design §5.3:
//     a toggled scoreboard is a free look away from the game)
//   - the END board: 3 s after the result banner, interactive, with
//     [ REMATCH ] [ CHANGE MODE ] [ QUIT TO MENU ] and a 20 s no-input
//     auto-advance to mode select (modes.md §6.1)
//
// Rows: name, BAND (C11: bands are printed on the scoreboard), score, K/D/A,
// plus the mode column — TDM: best streak; CTF: caps/returns; FFA: placement.
// Bots are marked with the BOT chip. The human row is highlighted.
//
// The campaign debrief (hud.js, MISSION COMPLETE/FAILED — known W11 cosmetic,
// plan O3) also opens on mission:end at z-65; this board sits at z-70 above
// it, and the QUIT path drives the debrief's own "Return to base" button so
// hud.js runs its own hide+menu path (zero hud.js edits).
//
// Persistence (modes.md §6.5): localStorage only — matches, W/L/D per mode,
// best streak. Read by mode_select.js. No server-side writes.

import { shell } from "./hud.js";
import { BAND_LABEL } from "./match_hud.js";

const LS_KEY = "blackridge.pvp.stats.v1";

export function loadStats() {
  try {
    const raw = (typeof localStorage !== "undefined") && localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through */ }
  return { modes: {} };
}

function saveStats(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* full/blocked */ }
}

let styleDone = false;
function ensureBoardStyle() {
  if (styleDone || typeof document === "undefined") return;
  styleDone = true;
  if (document.getElementById("w6-board-style")) return;
  const el = document.createElement("style");
  el.id = "w6-board-style";
  el.textContent = `
#mboard{position:fixed;inset:0;z-index:60;display:none;
  font-family:var(--a10-hud-font,system-ui);color:var(--a10-ink,#e8e8e4);
  background:rgba(4,6,10,.82);-webkit-user-select:none;user-select:none;
  pointer-events:none;}
#mboard.end{z-index:70;pointer-events:auto;}
#mboard .in{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  min-width:min(640px,94vw);max-width:min(860px,94vw);}
#mboard .tbl{max-height:62vh;overflow:auto;}
#mboard h2{font-weight:400;font-size:15px;letter-spacing:.34em;margin:0 0 4px;
  opacity:.6;}
#mboard .headline{font-size:26px;letter-spacing:.22em;margin-bottom:18px;}
#mboard .headline .win{color:var(--a10-amber,#d9a441);}
#mboard .headline .loss{color:var(--a10-red,#ff4d4d);}
#mboard table{width:100%;border-collapse:collapse;font-size:13px;
  letter-spacing:.06em;}
#mboard th{font-weight:400;font-size:10px;letter-spacing:.24em;opacity:.5;
  text-align:right;padding:4px 10px;border-bottom:1px solid rgba(232,232,228,.18);}
#mboard th.l,#mboard td.l{text-align:left;}
#mboard td{padding:5px 10px;text-align:right;border-bottom:1px solid rgba(232,232,228,.07);}
#mboard tr.me td{color:var(--a10-amber,#d9a441);}
#mboard tr.dead td{opacity:.85;}
#mboard .teamhdr td{padding-top:14px;font-size:11px;letter-spacing:.3em;
  border-bottom:1px solid rgba(232,232,228,.25);}
#mboard .bg{display:inline-block;font-size:8.5px;letter-spacing:.08em;
  border:1px solid rgba(232,232,228,.35);border-radius:2px;padding:0 3px;
  margin-left:6px;vertical-align:1px;opacity:.7;}
#mboard .band{font-size:10px;letter-spacing:.14em;opacity:.6;}
#mboard .btns{margin-top:22px;display:none;}
#mboard.end .btns{display:flex;gap:26px;}
#mboard .btns button{background:none;border:1px solid rgba(232,232,228,.3);
  color:var(--a10-ink,#e8e8e4);font-family:inherit;font-size:12px;
  letter-spacing:.24em;padding:9px 18px;cursor:pointer;text-transform:uppercase;}
#mboard .btns button:hover{border-color:var(--a10-amber,#d9a441);
  color:var(--a10-amber,#d9a441);}
#mboard .auto{margin-top:10px;font-size:10px;letter-spacing:.2em;opacity:.4;
  display:none;}
#mboard.end .auto{display:block;}
`;
  document.head.appendChild(el);
}

const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function createScoreboard(ctx) {
  ensureBoardStyle();

  const root = document.createElement("div");
  root.id = "mboard";
  root.innerHTML =
    `<div class="in"><h2>SCOREBOARD</h2><div class="headline"></div>` +
    `<div class="tbl"></div>` +
    `<div class="btns">` +
    `<button data-a="rematch">Rematch</button>` +
    `<button data-a="changemode">Change mode</button>` +
    `<button data-a="quit">Quit to menu</button></div>` +
    `<div class="auto"></div></div>`;
  document.body.appendChild(root);
  const headEl = root.querySelector(".headline");
  const tblEl = root.querySelector(".tbl");
  const autoEl = root.querySelector(".auto");

  const st = {
    live: false,          // match running (between match:start and shell exit)
    held: false,          // TAB currently held
    end: false,           // end board shown
    lastMode: "tdm",
    lastDifficulty: "standard",
    endTimer: null,       // 3 s banner → board
    autoAt: 0,            // auto-advance deadline (wall clock)
    autoIv: null,
    starting: false,      // single-flight rematch
  };

  const sim = () => (ctx.sim ? ctx.sim() : null);
  const M = () => { const s = sim(); return s && s.state.match ? s.state.match : null; };

  // ------------------------------------------------------------- render
  function bandCell(a) {
    return a.kind === "bot"
      ? `<span class="band">${esc(BAND_LABEL[a.band] || a.band || "")}</span>`
      : `<span class="band">—</span>`;
  }
  function nameCell(a) {
    return `${esc(a.kind === "human" ? "YOU" : a.name)}` +
      (a.kind === "bot" ? `<span class="bg">BOT</span>` : "");
  }

  function render() {
    const m = M();
    if (!m) { tblEl.innerHTML = ""; return; }
    const ctf = m.modeId === "ctf", ffa = m.modeId === "ffa";
    const modeCols = ctf ? `<th>CAP</th><th>RET</th>` : ffa ? `<th>PLACE</th>` : `<th>STREAK</th>`;
    const header =
      `<tr><th class="l">NAME</th><th class="l">BAND</th><th>SCORE</th>` +
      `<th>K</th><th>D</th><th>A</th>${modeCols}</tr>`;

    const rowsOf = (list, placeOf) => list.map((a) => {
      const mode = ctf
        ? `<td>${a.captures || 0}</td><td>${a.returns || 0}</td>`
        : ffa ? `<td>${placeOf ? placeOf(a) : ""}</td>`
          : `<td>${a.bestStreak || 0}</td>`;
      return `<tr class="${a.actorId === 0 ? "me" : ""}${a.alive ? "" : " dead"}">` +
        `<td class="l">${nameCell(a)}</td><td class="l">${bandCell(a)}</td>` +
        `<td>${a.score}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${a.assists}</td>` +
        mode + `</tr>`;
    }).join("");

    if (ffa) {
      const sorted = m.actors.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const place = new Map();
      sorted.forEach((a, i) => place.set(a.actorId, i + 1));
      const you = place.get(0);
      tblEl.innerHTML =
        `<table>${header}${rowsOf(sorted, (a) => `${place.get(a.actorId)} / ${sorted.length}`)}</table>`;
      headEl.innerHTML = `FREE-FOR-ALL <span style="opacity:.6">·</span> ` +
        `<span class="${you === 1 ? "win" : ""}">YOU ${you} / ${sorted.length}</span>`;
      return;
    }

    const t0 = m.teams.find((t) => t.id === 0), t1 = m.teams.find((t) => t.id === 1);
    const list0 = m.actors.filter((a) => a.team === 0).sort((a, b) => b.score - a.score);
    const list1 = m.actors.filter((a) => a.team === 1).sort((a, b) => b.score - a.score);
    const s0 = ctf ? (t0 ? t0.captures : 0) : (t0 ? t0.score : 0);
    const s1 = ctf ? (t1 ? t1.captures : 0) : (t1 ? t1.score : 0);
    headEl.innerHTML =
      `<span style="color:${(t0 && t0.tint) || "#d9a441"}">${esc((t0 && t0.name) || "AMBER")} ${s0}</span>` +
      `<span style="opacity:.4;margin:0 12px">—</span>` +
      `<span style="color:${(t1 && t1.tint) || "#7c9fd0"}">${s1} ${esc((t1 && t1.name) || "SLATE")}</span>`;
    tblEl.innerHTML =
      `<table>${header}` +
      `<tr class="teamhdr"><td class="l" colspan="9" style="color:${(t0 && t0.tint) || "#d9a441"}">${esc((t0 && t0.name) || "AMBER")}</td></tr>` +
      rowsOf(list0) +
      `<tr class="teamhdr"><td class="l" colspan="9" style="color:${(t1 && t1.tint) || "#7c9fd0"}">${esc((t1 && t1.name) || "SLATE")}</td></tr>` +
      rowsOf(list1) +
      `</table>`;
  }

  // ------------------------------------------------------------- held TAB
  function onKeyDown(e) {
    if (e.code !== "Tab") return;
    if (!st.live || st.end) return;
    e.preventDefault(); // keep browser focus traversal out of the match
    if (!st.held) { st.held = true; render(); root.style.display = "block"; }
  }
  function onKeyUp(e) {
    if (e.code !== "Tab") return;
    if (st.held && !st.end) { st.held = false; root.style.display = "none"; }
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // refresh while held (interval survives hidden tabs)
  setInterval(() => { if ((st.held || st.end) && root.style.display !== "none") render(); }, 500);

  // ------------------------------------------------------------- end board
  function openEnd() {
    st.end = true;
    st.held = false;
    render();
    root.classList.add("end");
    root.style.display = "block";
    if (shell.matchHud && shell.matchHud.hideResult) shell.matchHud.hideResult();
    // 20 s no-input auto-advance → mode select (modes.md §6.1)
    st.autoAt = Date.now() + 20000;
    if (st.autoIv) clearInterval(st.autoIv);
    st.autoIv = setInterval(() => {
      const left = Math.ceil((st.autoAt - Date.now()) / 1000);
      if (left <= 0) { exitTo("modeselect"); return; }
      autoEl.textContent = `MODE SELECT IN ${left}`;
    }, 500);
    const bump = () => { st.autoAt = Date.now() + 20000; };
    root.addEventListener("pointermove", bump);
    root.addEventListener("keydown", bump);
  }

  function closeBoard() {
    st.end = false;
    st.held = false;
    root.classList.remove("end");
    root.style.display = "none";
    if (st.autoIv) { clearInterval(st.autoIv); st.autoIv = null; }
    if (st.endTimer) { clearTimeout(st.endTimer); st.endTimer = null; }
  }

  // leave the match shell: close our overlays, close the campaign debrief
  // through ITS OWN button (hud.js path: hideDebrief + hud.hide +
  // menu.show('title') — zero hud.js edits), then land on the target screen.
  function exitTo(screen) {
    closeBoard();
    st.live = false;
    if (shell.matchHud) shell.matchHud.hide();
    const base = document.querySelector('#a10-debrief [data-a="base"]');
    const debriefOpen = shell.hud && shell.hud.debriefOpen;
    if (debriefOpen && base) base.click();       // runs hud's own return path
    else {
      if (shell.hud) shell.hud.hide();
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* no-op */ }
    }
    if (shell.menu) shell.menu.show(screen);
  }

  function rematch() {
    if (st.starting) return;
    st.starting = true;
    closeBoard();
    if (shell.matchHud) shell.matchHud.hide();
    st.live = false;
    Promise.resolve(ctx.startMatch
      ? ctx.startMatch({ mode: st.lastMode, difficulty: st.lastDifficulty })
      : false)
      .then((ok) => {
        st.starting = false;
        if (!ok) exitTo("modeselect"); // honest failure → back to the cards
      })
      .catch((err) => {
        st.starting = false;
        console.error("[scoreboard] rematch failed:", err);
        exitTo("modeselect");
      });
  }

  root.addEventListener("click", (e) => {
    const a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
    if (!a) return;
    if (a === "rematch") rematch();
    else if (a === "changemode") exitTo("modeselect");
    else if (a === "quit") exitTo("title");
  });

  // ------------------------------------------------------------- events
  function onMatchStart(d) {
    closeBoard();
    st.live = true;
    st.lastMode = (d && d.mode) || st.lastMode;
    st.lastDifficulty = (d && d.difficulty) || st.lastDifficulty;
  }

  function onMissionEnd(d) {
    if (!st.live || !d || !d.match) return; // campaign end → hud.js debrief owns it
    // persistence (modes.md §6.5)
    try {
      const stats = loadStats();
      const mode = d.match.modeId || st.lastMode;
      const rec = stats.modes[mode] || (stats.modes[mode] = { matches: 0, w: 0, l: 0, d: 0, bestStreak: 0 });
      rec.matches++;
      const r = d.match.result;
      const won = r === "win" && d.match.winnerTeam === 0;
      if (r === "draw") rec.d++;
      else if (won) rec.w++;
      else rec.l++;
      const you = (d.match.actors || []).find((a) => a.actorId === 0);
      if (you && you.bestStreak > (rec.bestStreak || 0)) rec.bestStreak = you.bestStreak;
      saveStats(stats);
    } catch (e) { /* stats are best-effort */ }
    // 3 s result banner (match_hud), then the board (modes.md §6.1)
    if (st.endTimer) clearTimeout(st.endTimer);
    st.endTimer = setTimeout(openEnd, 3000);
  }

  const board = {
    attach(bridge) {
      bridge.register("match:start", onMatchStart);
      bridge.register("mission:end", onMissionEnd);
    },
    get open() { return st.end || st.held; },
    get endOpen() { return st.end; },
    _root: root,
  };
  return board;
}

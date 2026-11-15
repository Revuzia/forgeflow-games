// core/hud/challenges_ui.js — BLACKRIDGE challenges view (2026-11-13).
//
// The DOM half of core/meta/challenges.js (which stays DOM-free):
//   1. MENU ENTRY   — #br-chal-btn, self-attached to the menu root (#menu) the way
//      after_action.js attaches its profile strip; shown on the title and PVP
//      (mode-select) screens. No menu.js edit.
//   2. PANEL        — #br-chal: Daily / Weekly / Career tabs, progress bars,
//      rewards, live reset countdowns, the once-a-day swap. Career is paged so
//      every control stays on screen (gamepad spatial focus only walks visible
//      buttons). Esc / pad B closes; mouse, touch and keyboard Tab all work.
//   3. TOASTS       — #br-chal-toast: completion always; a progress toast only
//      when a multi-step challenge crosses halfway, at most one per 20 s and 3
//      per match (no spam). Same look as the level-up toast.
//   4. AFTER-ACTION — a "Challenges" section mounted through
//      shell.afterAction.addSection: progress made this match.
//
// Wording rule (owner): opponents are operators — nothing here names bots, AI,
// NPCs or difficulty.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const shell = () => globalThis.__A10_SHELL__ || {};

export function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

const SCOPE_TAG = { daily: "Daily", weekly: "Weekly", career: "Career" };
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById("br-chal-style")) return;
  const el = document.createElement("style");
  el.id = "br-chal-style";
  el.textContent = `
/* ---- menu entry ---- */
#br-chal-btn{position:absolute;right:8vw;top:84px;display:none;z-index:2;cursor:pointer;
  background:rgba(10,12,16,.55);border:1px solid rgba(232,232,228,.3);color:var(--a10-ink,#e8e8e4);
  font-family:var(--a10-hud-font,'Oswald',system-ui);font-size:12px;letter-spacing:.26em;text-transform:uppercase;
  padding:9px 16px;min-height:40px;text-align:right;}
#br-chal-btn small{display:block;font-family:var(--a10-ui-font,system-ui);font-size:9.5px;letter-spacing:.16em;opacity:.6;margin-top:2px;text-transform:none;}
#br-chal-btn b{font-weight:400;color:var(--a10-amber,#d9a441);}
#br-chal-btn:hover,#br-chal-btn:focus-visible{border-color:var(--a10-amber,#d9a441);color:var(--a10-amber,#d9a441);outline:none;}
@media (max-height:520px){#br-chal-btn{top:52px;padding:6px 12px;min-height:36px;font-size:11px;}}
/* ---- panel ---- */
#br-chal{position:fixed;inset:0;z-index:70;display:none;pointer-events:auto;overflow:auto;
  font-family:var(--a10-ui-font,system-ui);color:var(--a10-ink,#e8e8e4);
  background:linear-gradient(180deg,rgba(4,6,10,.97),rgba(4,6,10,.93));backdrop-filter:blur(6px);
  -webkit-user-select:none;user-select:none;}
#br-chal .in{width:min(1000px,94vw);margin:0 auto;padding:clamp(12px,4vh,44px) 0 20px;box-sizing:border-box;}
#br-chal .hd{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
#br-chal h2{font-family:var(--a10-hud-font,system-ui);font-weight:400;font-size:clamp(18px,3.6vh,28px);letter-spacing:.3em;margin:0 12px 0 0;}
#br-chal .tabs{display:flex;gap:6px;flex:1;}
#br-chal button{background:none;border:1px solid rgba(232,232,228,.3);color:var(--a10-ink,#e8e8e4);font-family:var(--a10-hud-font,system-ui);
  font-size:11.5px;letter-spacing:.22em;text-transform:uppercase;padding:8px 14px;min-height:38px;cursor:pointer;}
#br-chal button.on{border-color:var(--a10-amber,#d9a441);color:var(--a10-amber,#d9a441);background:rgba(217,164,65,.08);}
#br-chal button:hover,#br-chal button:focus-visible{border-color:var(--a10-amber,#d9a441);outline:none;}
#br-chal button:disabled{opacity:.35;cursor:default;}
#br-chal .meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;
  opacity:.75;margin:clamp(10px,2.4vh,20px) 0 10px;border-bottom:1px solid rgba(232,232,228,.14);padding-bottom:8px;}
#br-chal .meta b{font-weight:400;color:var(--a10-amber,#d9a441);font-variant-numeric:tabular-nums;letter-spacing:.08em;}
#br-chal .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,1.6vw,16px);}
#br-chal .card{border:1px solid rgba(232,232,228,.14);padding:clamp(8px,1.8vh,14px) 12px;display:flex;flex-direction:column;gap:6px;background:rgba(232,232,228,.02);}
#br-chal .card.done{border-color:rgba(217,164,65,.5);background:rgba(217,164,65,.06);}
#br-chal .card .nm{font-family:var(--a10-hud-font,system-ui);font-size:15px;letter-spacing:.16em;text-transform:uppercase;}
#br-chal .card .ds{font-size:12px;letter-spacing:.04em;opacity:.75;line-height:1.35;min-height:2.7em;}
#br-chal .bar{height:5px;background:rgba(232,232,228,.12);position:relative;overflow:hidden;}
#br-chal .bar b{position:absolute;left:0;top:0;bottom:0;background:var(--a10-amber,#d9a441);}
#br-chal .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;letter-spacing:.14em;font-variant-numeric:tabular-nums;}
#br-chal .ft .xp{color:var(--a10-amber,#d9a441);font-family:var(--a10-hud-font,system-ui);font-size:13px;letter-spacing:.1em;}
#br-chal .ok{font-size:10px;letter-spacing:.24em;color:#0a0c10;background:var(--a10-amber,#d9a441);padding:2px 6px;}
#br-chal .card button{padding:5px 10px;min-height:32px;font-size:10.5px;}
#br-chal .rows{display:grid;grid-template-columns:1fr 1fr;gap:6px clamp(14px,3vw,36px);}
#br-chal .tr{border-bottom:1px solid rgba(232,232,228,.08);padding:5px 0 7px;}
#br-chal .tr .t{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;letter-spacing:.1em;}
#br-chal .tr .t .n{font-family:var(--a10-hud-font,system-ui);text-transform:uppercase;letter-spacing:.16em;}
#br-chal .tr .t .n em{font-style:normal;color:var(--a10-amber,#d9a441);margin-left:6px;}
#br-chal .tr .s{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.1em;opacity:.6;margin-top:3px;font-variant-numeric:tabular-nums;}
#br-chal .tr .bar{height:3px;margin-top:4px;}
#br-chal .pg{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:11px;letter-spacing:.2em;opacity:.85;}
#br-chal .note{font-size:11px;letter-spacing:.08em;opacity:.5;margin-top:10px;}
@media (max-width:760px){#br-chal .rows{grid-template-columns:1fr;}}
@media (max-height:520px){#br-chal .card .ds{min-height:0;font-size:11px;}#br-chal .card{gap:4px;padding:7px 10px;}
  #br-chal .card .nm{font-size:13px;}#br-chal .meta{margin:8px 0 6px;}#br-chal button{min-height:34px;padding:6px 11px;}
  #br-chal h2{font-size:17px;}#br-chal .tr{padding:3px 0 4px;}}
/* ---- toast (level-up toast look, stacked under it) ---- */
#br-chal-toast{position:fixed;left:max(16px,3vw);top:calc(30% + 86px);z-index:36;pointer-events:none;text-align:left;
  padding:8px 18px 9px 14px;border:1px solid rgba(217,164,65,.35);border-left:2px solid var(--a10-amber,#d9a441);
  background:rgba(10,12,16,.84);transform:translateX(-8px);min-width:200px;max-width:min(360px,60vw);
  font-family:var(--a10-hud-font,'Oswald','Arial Narrow',system-ui,sans-serif);color:var(--a10-ink,#e8e8e4);
  opacity:0;transition:opacity .25s ease,transform .25s ease;box-shadow:0 4px 18px rgba(0,0,0,.5);}
#br-chal-toast.on{opacity:1;transform:none;}
#br-chal-toast .k{font-size:10px;letter-spacing:.3em;color:var(--a10-amber,#d9a441);}
#br-chal-toast .n{font-size:16px;letter-spacing:.18em;margin-top:2px;text-transform:uppercase;}
#br-chal-toast .u{font-size:10.5px;letter-spacing:.14em;opacity:.75;margin-top:4px;text-transform:uppercase;}
#br-chal-toast .bar{height:3px;background:rgba(232,232,228,.14);margin-top:6px;position:relative;}
#br-chal-toast .bar b{position:absolute;left:0;top:0;bottom:0;background:var(--a10-amber,#d9a441);}
#br-chal-toast.prog{border-color:rgba(232,232,228,.22);border-left-color:rgba(232,232,228,.7);}
@media (max-height:520px){#br-chal-toast{top:calc(30% + 64px);}}
/* ---- after-action section ---- */
#br-aar .chx{margin-top:clamp(12px,2.4vh,20px);}
#br-aar .chx .cr{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 12px;font-size:12px;letter-spacing:.08em;
  padding:5px 0;border-bottom:1px solid rgba(232,232,228,.06);}
#br-aar .chx .tg{font-size:9px;letter-spacing:.22em;opacity:.6;text-transform:uppercase;border:1px solid rgba(232,232,228,.25);padding:1px 5px;}
#br-aar .chx .cr.done .tg{color:#0a0c10;background:var(--a10-amber,#d9a441);border-color:var(--a10-amber,#d9a441);opacity:1;}
#br-aar .chx .bar{height:3px;margin-top:4px;}
#br-aar .chx .bar i{position:absolute;left:0;top:0;bottom:0;background:rgba(232,232,228,.45);}
#br-aar .chx .v{font-family:var(--a10-hud-font,system-ui);font-variant-numeric:tabular-nums;white-space:nowrap;}
#br-aar .chx .cr.done .v{color:var(--a10-amber,#d9a441);}
`;
  document.head.appendChild(el);
}

export function createChallengesUI(ctx, challenges) {
  ensureStyle();
  const CH = challenges;
  const ui = { open: false, tab: "daily", page: 0, tick: null, lastFocus: null };

  // =========================================================== 1. menu entry
  const btn = document.createElement("button");
  btn.id = "br-chal-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Challenges");
  function paintBtn() {
    try {
      const d = CH.daily();
      const left = d.filter((x) => !x.done).length;
      btn.innerHTML = `Challenges <b>${d.length - left}/${d.length}</b><small>Daily reset ${esc(fmtCountdown(CH.resets().daily))}</small>`;
    } catch (e) { btn.textContent = "Challenges"; }
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); openPanel(); });
  let btnPaintT = 0;
  // sit under the menu's left nav rail (clear of the mode-select panel on the
  // right); if the rail leaves no room below it, fall back to the top-right
  // corner under the profile strip (the CSS default)
  function placeBtn(menuEl) {
    const nav = menuEl.querySelector(".a10-rail .nav");
    const items = nav ? nav.querySelectorAll(".a10-item") : [];
    const last = items.length ? items[items.length - 1] : null;
    const mr = menuEl.getBoundingClientRect();
    if (last) {
      const r = last.getBoundingClientRect();
      const h = btn.offsetHeight || 44;
      const top = r.bottom + 14 - mr.top;
      if (r.height > 0 && top + h + 8 < mr.height) {
        btn.style.left = Math.round(r.left - mr.left) + "px";
        btn.style.top = Math.round(top) + "px";
        btn.style.right = "auto";
        btn.style.textAlign = "left";
        return;
      }
    }
    btn.style.left = ""; btn.style.top = ""; btn.style.right = ""; btn.style.textAlign = "";
  }
  setInterval(() => {
    const menuEl = document.getElementById("menu");
    if (!menuEl) return;
    if (btn.parentNode !== menuEl) menuEl.appendChild(btn);
    const sh = shell();
    const scr = sh.menu && sh.menu._screen;
    const want = !ui.open && menuEl.style.display !== "none" && (scr === "title" || scr === "modeselect") ? "block" : "none";
    if (btn.style.display !== want) btn.style.display = want;
    if (want === "block" && Date.now() - btnPaintT > 900) { btnPaintT = Date.now(); paintBtn(); }
    if (want === "block") placeBtn(menuEl);
  }, 250);

  // =========================================================== 2. panel
  const root = document.createElement("div");
  root.id = "br-chal";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Challenges");
  document.body.appendChild(root);

  function bar(frac) { return `<div class="bar"><b style="width:${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%"></b></div>`; }

  function cardsHtml(list, scope) {
    const canSwapAny = scope === "daily" && !CH.rerollUsed;
    return `<div class="cards">` + list.map((c) => {
      const right = c.done ? `<span class="ok">COMPLETE</span>`
        : canSwapAny && CH.canReroll(c.slot) ? `<button type="button" data-cs="${c.slot}" aria-label="Swap ${esc(c.name)}">Swap</button>` : "";
      return `<div class="card${c.done ? " done" : ""}"><div class="nm">${esc(c.name)}</div><div class="ds">${esc(c.desc)}</div>` +
        bar(c.p / c.target) +
        `<div class="ft"><span>${fmt(c.p)} / ${fmt(c.target)}</span><span class="xp">+${fmt(c.xp)} XP</span>${right}</div></div>`;
    }).join("") + `</div>`;
  }

  const PAGE = 6;
  function careerHtml() {
    const all = CH.career();
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    ui.page = Math.max(0, Math.min(pages - 1, ui.page));
    const rows = all.slice(ui.page * PAGE, ui.page * PAGE + PAGE).map((c) => {
      const tierTxt = c.maxed ? `${ROMAN[c.tiers - 1]} · MAX` : (c.tier > 0 ? ROMAN[c.tier - 1] : "—");
      const frac = c.maxed ? 1 : (c.value - c.prevTarget) / Math.max(1, c.target - c.prevTarget);
      return `<div class="tr"><div class="t"><span class="n">${esc(c.name)}<em>${tierTxt}</em></span>` +
        `<span class="xp" style="color:var(--a10-amber,#d9a441)">${c.maxed ? "" : "+" + fmt(c.xp) + " XP"}</span></div>` +
        bar(frac) +
        `<div class="s"><span>${esc(c.desc)}</span><span>${c.maxed ? fmt(c.value) : fmt(Math.min(c.value, c.target)) + " / " + fmt(c.target)}${c.maxed ? "" : " · Tier " + ROMAN[c.tier]}</span></div></div>`;
    }).join("");
    return `<div class="rows">${rows}</div>` +
      `<div class="pg"><button type="button" data-cp="-1" ${ui.page === 0 ? "disabled" : ""}>Prev</button>` +
      `<span>${ui.page + 1} / ${pages}</span>` +
      `<button type="button" data-cp="1" ${ui.page >= pages - 1 ? "disabled" : ""}>Next</button></div>`;
  }

  function render() {
    const r = CH.resets();
    let body = "";
    if (ui.tab === "daily") {
      body = `<div class="meta"><span>Daily challenges · resets in <b class="cd" data-k="daily">${esc(fmtCountdown(r.daily))}</b></span>` +
        `<span>${CH.rerollUsed ? "Swap used today" : "1 free swap today"}</span></div>` + cardsHtml(CH.daily(), "daily") +
        `<div class="note">Rewards are paid the moment a challenge completes. New challenges every day at local midnight.</div>`;
    } else if (ui.tab === "weekly") {
      body = `<div class="meta"><span>Weekly challenges · resets in <b class="cd" data-k="weekly">${esc(fmtCountdown(r.weekly))}</b></span>` +
        `<span>New set every Monday</span></div>` + cardsHtml(CH.weekly(), "weekly");
    } else {
      const s = CH.careerSummary();
      body = `<div class="meta"><span>Career · lifetime milestones</span><span>Tiers <b>${s.done} / ${s.total}</b></span></div>` + careerHtml();
    }
    const tab = (k, l) => `<button type="button" data-ct="${k}" class="${ui.tab === k ? "on" : ""}" aria-pressed="${ui.tab === k}">${l}</button>`;
    root.innerHTML = `<div class="in"><div class="hd"><h2>CHALLENGES</h2><div class="tabs">` +
      tab("daily", "Daily") + tab("weekly", "Weekly") + tab("career", "Career") +
      `</div><button type="button" data-cx="1">Back</button></div>${body}</div>`;
  }
  function tickCountdowns() {
    if (!ui.open) return;
    const r = CH.resets();
    // a period rolled over while the panel was open: redraw with the new set
    if (ui.shownDay !== r.day || ui.shownWeek !== r.week) { ui.shownDay = r.day; ui.shownWeek = r.week; rerender(); return; }
    for (const el of root.querySelectorAll(".cd")) el.textContent = fmtCountdown(r[el.getAttribute("data-k")]);
  }
  function rerender(focusSel) {
    const had = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
    const key = focusSel || (had ? selectorOf(had) : null);
    render();
    if (key) { const el = root.querySelector(key) || root.querySelector(`[data-ct="${ui.tab}"]`); if (el) try { el.focus({ preventScroll: true }); } catch (e) { /* no-op */ } }
  }
  function selectorOf(el) {
    for (const a of ["data-ct", "data-cp", "data-cs", "data-cx"]) if (el.hasAttribute(a)) return `[${a}="${el.getAttribute(a)}"]`;
    return null;
  }
  function openPanel(tab) {
    if (tab) ui.tab = tab;
    ui.open = true;
    ui.lastFocus = document.activeElement;
    const r = CH.resets(); ui.shownDay = r.day; ui.shownWeek = r.week;
    render();
    root.style.display = "block";
    btn.style.display = "none";
    const first = root.querySelector(`[data-ct="${ui.tab}"]`);
    if (first) try { first.focus({ preventScroll: true }); } catch (e) { /* no-op */ }
    if (ui.tick) clearInterval(ui.tick);
    ui.tick = setInterval(tickCountdowns, 1000);
  }
  function closePanel() {
    if (!ui.open) return;
    ui.open = false;
    root.style.display = "none";
    if (ui.tick) { clearInterval(ui.tick); ui.tick = null; }
    paintBtn();
    try { if (ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus({ preventScroll: true }); } catch (e) { /* no-op */ }
  }
  root.addEventListener("click", (e) => {
    const el = e.target && e.target.closest && e.target.closest("button");
    if (!el || !root.contains(el)) return;
    if (el.hasAttribute("data-cx")) { closePanel(); return; }
    if (el.hasAttribute("data-ct")) { ui.tab = el.getAttribute("data-ct"); ui.page = 0; rerender(`[data-ct="${ui.tab}"]`); return; }
    if (el.hasAttribute("data-cp")) { ui.page += Number(el.getAttribute("data-cp")) || 0; rerender(`[data-cp="${el.getAttribute("data-cp")}"]`); return; }
    if (el.hasAttribute("data-cs")) { CH.reroll(Number(el.getAttribute("data-cs"))); rerender(`[data-ct="daily"]`); }
  });
  window.addEventListener("keydown", (e) => {
    if (!ui.open) return;
    if (e.code === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closePanel(); return; }
    // Q / E (and [ ]) cycle tabs, like the rest of the shell's tabbed screens
    const order = ["daily", "weekly", "career"];
    let dir = 0;
    if (e.code === "KeyQ" || e.code === "BracketLeft") dir = -1;
    else if (e.code === "KeyE" || e.code === "BracketRight") dir = 1;
    if (dir) {
      e.preventDefault(); e.stopImmediatePropagation();
      ui.tab = order[(order.indexOf(ui.tab) + dir + order.length) % order.length]; ui.page = 0;
      rerender(`[data-ct="${ui.tab}"]`);
    }
  }, true);
  CH.onChange(() => { if (ui.open) rerender(); });

  // =========================================================== 3. toasts
  const toast = document.createElement("div");
  toast.id = "br-chal-toast";
  toast.setAttribute("aria-live", "polite");
  document.body.appendChild(toast);
  const q = [];
  let busy = false;
  function pump() {
    if (busy) return;
    const t = q.shift();
    if (!t) return;
    busy = true;
    toast.className = t.prog ? "prog" : "";
    toast.innerHTML = t.html;
    void toast.offsetWidth;
    toast.classList.add("on");
    setTimeout(() => { toast.classList.remove("on"); setTimeout(() => { busy = false; pump(); }, 300); }, t.prog ? 2200 : 3200);
  }
  const PROG_GAP_MS = 20000, PROG_MAX = 3;
  let progCount = 0, lastProgAt = 0;
  CH.onEvent((e) => {
    if (!e) return;
    if (e.type === "sessionEnd") { progCount = 0; return; }
    const sh = shell();
    if (sh.afterAction && sh.afterAction.open) return; // the after-action lists it
    if (e.type === "complete") {
      const kicker = e.scope === "career" ? "CAREER MILESTONE" : (SCOPE_TAG[e.scope] || "").toUpperCase() + " CHALLENGE COMPLETE";
      // drop a queued progress toast for the same challenge
      for (let i = q.length - 1; i >= 0; i--) if (q[i].prog && q[i].id === e.id) q.splice(i, 1);
      q.push({ id: e.id, html: `<div class="k">${esc(kicker)}</div><div class="n">${esc(e.name)}</div><div class="u">+${fmt(e.xp)} XP</div>` });
      pump();
    } else if (e.type === "progress") {
      if (e.target < 4) return;
      const half = e.target / 2;
      if (!(e.from < half && e.to >= half)) return;              // only the halfway crossing
      const now = Date.now();
      if (progCount >= PROG_MAX || now - lastProgAt < PROG_GAP_MS) return;
      progCount++; lastProgAt = now;
      q.push({ prog: true, id: e.id, html: `<div class="k">${esc((SCOPE_TAG[e.scope] || "").toUpperCase())} CHALLENGE</div><div class="n">${esc(e.name)}</div>` +
        `<div class="u">${fmt(e.to)} / ${fmt(e.target)}</div>${bar(e.to / e.target)}` });
      pump();
    }
  });

  // =========================================================== 4. after-action section
  function aarSection(report) {
    const s = CH.lastSession;
    if (!s || !report) return "";
    const items = s.items.slice(0, 8);
    const rows = items.length ? items.map((it) => {
      const tag = SCOPE_TAG[it.scope] || it.scope;
      if (it.scope === "career") {
        return `<div class="cr done"><span class="tg">${esc(tag)}</span><span>${esc(it.name)}</span><span class="v">+${fmt(it.xp)} XP</span></div>`;
      }
      const f0 = it.from / it.target, f1 = it.to / it.target;
      return `<div class="cr${it.done ? " done" : ""}"><span class="tg">${esc(tag)}</span>` +
        `<span>${esc(it.name)}<div class="bar"><i style="width:${(f0 * 100).toFixed(1)}%"></i><b style="left:${(f0 * 100).toFixed(1)}%;width:${(Math.max(0, f1 - f0) * 100).toFixed(1)}%"></b></div></span>` +
        `<span class="v">${it.done ? "+" + fmt(it.xp) + " XP" : fmt(it.to) + " / " + fmt(it.target) + ` <span style="opacity:.55">(+${fmt(it.to - it.from)})</span>`}</span></div>`;
    }).join("") + (s.items.length > 8 ? `<div class="none">+${s.items.length - 8} more</div>` : "")
      : `<div class="none">No challenge progress this time.</div>`;
    let reset = "";
    try { reset = `<div class="none" style="margin-top:6px">Daily reset in ${esc(fmtCountdown(CH.resets().daily))}</div>`; } catch (e) { /* no-op */ }
    return `<div class="chx"><h3>Challenges${s.xp ? ` · +${fmt(s.xp)} XP` : ""}</h3>${rows}${reset}</div>`;
  }
  (function mountAar(tries) {
    const sh = shell();
    if (sh.afterAction && sh.afterAction.addSection) { sh.afterAction.addSection(aarSection); return; }
    if (tries > 0) setTimeout(() => mountAar(tries - 1), 250);
  })(40);

  const api = {
    open: openPanel, close: closePanel,
    get visible() { return ui.open; },
    _root: root, _btn: btn, _toast: toast, _aarSection: aarSection,
  };
  shell().challengesUI = api;
  return api;
}

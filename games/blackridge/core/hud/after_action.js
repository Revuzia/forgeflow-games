// core/hud/after_action.js — BLACKRIDGE progression view (2026-11-13).
//
// The DOM half of core/meta/progression.js (which stays DOM-free):
//   1. IN-MATCH XP FEED  — "+100 KILL / +50 HEADSHOT" ticks under the crosshair,
//      batched into one burst per dispatch, with a running total. Lives inside
//      #hud (appended, no hud.js edit) so it hides with the HUD and is
//      composited by __test.capture.
//   2. TOASTS            — level-up (rank + new unlocks) and weapon level-up.
//   3. AFTER-ACTION      — #br-aar over the end board (PVP: scoreboard.js calls
//      shell.afterAction.showPending when its board opens; CONTINUE reveals the
//      board and restarts its auto-advance) or over the campaign debrief (shown
//      by this module 2.5 s after mission:end). XP by category, animated level
//      bar through every level-up, weapon XP bars, new unlocks, highlights.
//      Keyboard (Enter / Space / Esc), mouse and touch.
//   4. PROFILE STRIP     — #br-profile, attached to the menu root (#menu) and
//      shown on the title and mode-select screens: level, rank, XP bar.
//
// Wording rule (owner): opponents are operators/players — nothing here names
// bots, AI, NPCs or difficulty.

import { shell } from "./hud.js";
// pure curve functions only (no state is shared through this import)
import * as curve from "../meta/progression.js";

const MODE_NAMES = { tdm: "Skirmish", ctf: "Capture the Flag", ffa: "Free-for-All", dom: "Stronghold", campaign: "Operation" }; // [lane dom] + dom
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const titleCase = (s) => String(s || "").replace(/[_-]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

let styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === "undefined") return;
  styleDone = true;
  if (document.getElementById("br-prog-style")) return;
  const el = document.createElement("style");
  el.id = "br-prog-style";
  el.textContent = `
/* ---- in-match XP feed ---- */
#br-xpfeed{position:absolute;left:50%;top:calc(50% + 62px);transform:translateX(-50%);text-align:center;
  pointer-events:none;font-family:var(--a10-hud-font,system-ui);color:var(--a10-ink,#e8e8e4);
  opacity:0;transition:opacity .35s ease;text-shadow:0 1px 3px rgba(0,0,0,.9);}
#br-xpfeed.on{opacity:1;}
#br-xpfeed .tot{font-size:15px;letter-spacing:.14em;color:var(--a10-amber,#d9a441);font-variant-numeric:tabular-nums;}
#br-xpfeed .tot small{font-size:10px;letter-spacing:.24em;opacity:.75;margin-left:4px;}
#br-xpfeed .ln{font-size:11px;letter-spacing:.16em;opacity:.82;text-transform:uppercase;line-height:1.45;
  animation:brxpin .22s ease-out;}
#br-xpfeed .ln b{font-weight:400;color:#fff;margin-right:6px;font-variant-numeric:tabular-nums;}
@keyframes brxpin{0%{opacity:0;transform:translateY(5px);}100%{opacity:.82;transform:none;}}
/* ---- level toasts ---- */
/* left-middle: clear of the medal banner (top 22%, centre), the crosshair
   score pops, the kill feed (top right) and the objective rail (bottom left) */
#br-lvl{position:fixed;left:max(16px,3vw);top:30%;z-index:36;pointer-events:none;text-align:left;
  padding:9px 20px 10px 16px;border:1px solid rgba(217,164,65,.4);border-left:2px solid var(--a10-amber,#d9a441);
  background:rgba(10,12,16,.84);transform:translateX(-8px);
  font-family:var(--a10-hud-font,'Oswald','Arial Narrow',system-ui,sans-serif);color:var(--a10-ink,#e8e8e4);
  opacity:0;transition:opacity .25s ease,transform .25s ease;box-shadow:0 4px 18px rgba(0,0,0,.5);min-width:200px;max-width:min(360px,60vw);}
#br-lvl.on{opacity:1;transform:none;}
#br-lvl .k{font-size:10px;letter-spacing:.3em;color:var(--a10-amber,#d9a441);}
#br-lvl .n{font-size:20px;letter-spacing:.2em;margin-top:2px;}
#br-lvl .u{font-size:10.5px;letter-spacing:.16em;opacity:.75;margin-top:4px;text-transform:uppercase;}
#br-lvl.wpn{border-color:rgba(232,232,228,.25);border-left-color:rgba(232,232,228,.7);}
#br-lvl.wpn .n{font-size:15px;}
/* ---- after-action ---- */
#br-aar{position:fixed;inset:0;z-index:75;display:none;pointer-events:auto;overflow:auto;
  font-family:var(--a10-ui-font,system-ui);color:var(--a10-ink,#e8e8e4);
  background:linear-gradient(180deg,rgba(4,6,10,.975),rgba(4,6,10,.94));backdrop-filter:blur(8px);
  -webkit-user-select:none;user-select:none;}
#br-aar .in{width:min(980px,92vw);margin:0 auto;padding:clamp(18px,5vh,54px) 0 28px;box-sizing:border-box;}
#br-aar .rt{font-size:10.5px;letter-spacing:.36em;opacity:.55;text-transform:uppercase;}
#br-aar h1{font-family:var(--a10-hud-font,system-ui);font-weight:400;font-size:clamp(24px,4.4vh,34px);letter-spacing:.3em;margin:6px 0 2px;}
#br-aar h1.won{color:var(--a10-amber,#d9a441);} #br-aar h1.lost{color:var(--a10-red,#ff4d4d);}
#br-aar .sub{font-size:11.5px;letter-spacing:.2em;opacity:.55;text-transform:uppercase;}
#br-aar .lvl{display:flex;align-items:center;gap:18px;margin:clamp(14px,3vh,26px) 0 clamp(12px,2.6vh,22px);}
#br-aar .badge{width:58px;height:58px;flex:none;position:relative;}
#br-aar .badge svg{width:100%;height:100%;}
#br-aar .badge span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-family:var(--a10-hud-font,system-ui);font-size:19px;letter-spacing:.04em;padding-top:2px;}
#br-aar .lvb{flex:1;min-width:0;}
#br-aar .lvt{display:flex;justify-content:space-between;align-items:baseline;gap:12px;}
#br-aar .rk{font-family:var(--a10-hud-font,system-ui);font-size:17px;letter-spacing:.22em;text-transform:uppercase;}
#br-aar .gain{font-family:var(--a10-hud-font,system-ui);font-size:22px;letter-spacing:.1em;color:var(--a10-amber,#d9a441);font-variant-numeric:tabular-nums;}
#br-aar .bar{height:6px;background:rgba(232,232,228,.12);margin-top:8px;position:relative;overflow:hidden;}
#br-aar .bar i{position:absolute;left:0;top:0;bottom:0;background:rgba(232,232,228,.45);}
#br-aar .bar b{position:absolute;top:0;bottom:0;background:var(--a10-amber,#d9a441);}
#br-aar .lvn{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.2em;opacity:.55;margin-top:6px;font-variant-numeric:tabular-nums;}
#br-aar .lvup{color:var(--a10-amber,#d9a441);opacity:1;}
#br-aar .cols{display:grid;grid-template-columns:1fr 1fr;gap:clamp(18px,4vw,48px);}
#br-aar h3{font-weight:400;font-size:10.5px;letter-spacing:.32em;opacity:.55;margin:0 0 8px;text-transform:uppercase;
  border-bottom:1px solid rgba(232,232,228,.16);padding-bottom:6px;}
#br-aar .row{display:flex;justify-content:space-between;font-size:12.5px;letter-spacing:.08em;padding:4px 0;
  border-bottom:1px solid rgba(232,232,228,.06);}
#br-aar .row .n{opacity:.5;margin-left:8px;font-size:11px;}
#br-aar .row .x{font-family:var(--a10-hud-font,system-ui);font-variant-numeric:tabular-nums;}
#br-aar .row.tot{border-bottom:none;padding-top:8px;}
#br-aar .row.tot .x{color:var(--a10-amber,#d9a441);font-size:15px;}
#br-aar .wp{margin-bottom:10px;}
#br-aar .wp .t{display:flex;justify-content:space-between;font-size:12px;letter-spacing:.12em;}
#br-aar .wp .t .l{font-family:var(--a10-hud-font,system-ui);opacity:.7;}
#br-aar .wp .bar{height:4px;margin-top:5px;}
#br-aar .hl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;}
#br-aar .hl > div{border:1px solid rgba(232,232,228,.12);padding:7px 9px;}
#br-aar .hl .v{font-family:var(--a10-hud-font,system-ui);font-size:19px;letter-spacing:.06em;}
#br-aar .hl .k{font-size:9.5px;letter-spacing:.22em;opacity:.55;text-transform:uppercase;margin-top:1px;}
#br-aar .ul{font-size:12px;letter-spacing:.1em;padding:4px 0;}
#br-aar .ul em{font-style:normal;font-size:9px;letter-spacing:.2em;color:#0a0c10;background:var(--a10-amber,#d9a441);
  padding:1px 5px;margin-right:8px;vertical-align:1px;}
#br-aar .none{font-size:11.5px;letter-spacing:.1em;opacity:.45;}
#br-aar .foot{display:flex;align-items:center;gap:22px;margin-top:clamp(16px,3vh,28px);
  position:sticky;bottom:0;padding:10px 0;background:linear-gradient(180deg,rgba(4,6,10,0),rgba(4,6,10,.96) 35%);}
#br-aar .foot button{background:none;border:1px solid rgba(232,232,228,.35);color:var(--a10-ink,#e8e8e4);font-family:inherit;
  font-size:12px;letter-spacing:.26em;padding:11px 26px;cursor:pointer;text-transform:uppercase;min-height:44px;}
#br-aar .foot button:hover,#br-aar .foot button:focus-visible{border-color:var(--a10-amber,#d9a441);color:var(--a10-amber,#d9a441);outline:none;}
#br-aar .foot .hint{font-size:10px;letter-spacing:.22em;opacity:.4;text-transform:uppercase;}
#br-aar .warn{font-size:10.5px;letter-spacing:.12em;color:var(--a10-red,#ff4d4d);opacity:.8;margin-top:8px;}
@media (max-height:520px){#br-aar .hl .v{font-size:15px;}#br-aar .hl > div{padding:4px 7px;}#br-aar .badge{width:44px;height:44px;}
  #br-aar .foot .hint{display:none;}#br-aar .lvl{margin:10px 0;}}
@media (max-width:720px){#br-aar .cols{grid-template-columns:1fr;}#br-aar .hl{grid-template-columns:repeat(3,1fr);}}
/* ---- menu profile strip ---- */
#br-profile{position:absolute;right:8vw;top:26px;width:min(300px,40vw);display:none;pointer-events:none;
  font-family:var(--a10-hud-font,system-ui);color:var(--a10-ink,#e8e8e4);}
#br-profile .t{display:flex;align-items:baseline;gap:10px;justify-content:flex-end;}
#br-profile .lv{font-size:11px;letter-spacing:.26em;opacity:.6;}
#br-profile .lv b{font-weight:400;font-size:18px;letter-spacing:.06em;color:var(--a10-amber,#d9a441);opacity:1;margin-left:4px;}
#br-profile .rk{font-size:13px;letter-spacing:.24em;text-transform:uppercase;}
#br-profile .bar{height:3px;background:rgba(232,232,228,.14);margin-top:6px;position:relative;}
#br-profile .bar b{position:absolute;left:0;top:0;bottom:0;background:var(--a10-amber,#d9a441);}
#br-profile .x{font-size:9.5px;letter-spacing:.2em;opacity:.45;text-align:right;margin-top:4px;font-variant-numeric:tabular-nums;}
@media (max-height:520px){#br-profile{top:8px;}}
`;
  document.head.appendChild(el);
}

function badgeSvg(level) {
  // a plain chevron shield; the stripe count grows with the rank tier
  const tier = Math.floor((level - 1) / 5);
  const stripes = Math.min(3, Math.floor(tier / 4) + 1);
  let s = "";
  for (let i = 0; i < stripes; i++) s += `<path d="M14 ${44 + i * 5} L29 ${51 + i * 5} L44 ${44 + i * 5}" fill="none" stroke="#d9a441" stroke-width="2" opacity="${0.9 - i * 0.2}"/>`;
  return `<svg viewBox="0 0 58 66"><path d="M29 3 L53 12 L53 34 C53 48 42 57 29 63 C16 57 5 48 5 34 L5 12 Z" fill="rgba(217,164,65,.08)" stroke="rgba(217,164,65,.75)" stroke-width="1.5"/>${s}</svg>`;
}

export function createAfterAction(ctx, progression) {
  ensureStyle();
  const P = progression;

  // =========================================================== 1. XP feed
  const feed = document.createElement("div");
  feed.id = "br-xpfeed";
  feed.innerHTML = `<div class="tot"></div><div class="lns"></div>`;
  const feedTot = feed.querySelector(".tot");
  const feedLns = feed.querySelector(".lns");
  function mountFeed() {
    const hudEl = document.getElementById("hud");
    if (hudEl && feed.parentNode !== hudEl) hudEl.appendChild(feed);
    else if (!hudEl && !feed.parentNode) document.body.appendChild(feed);
  }
  mountFeed();
  let burst = { total: 0, lines: [] }, pending = [], flushT = null, hideT = null;
  function flushFeed() {
    flushT = null;
    mountFeed();
    // merge same-label ticks inside one dispatch ("+200 2x KILL")
    const merged = [];
    for (const p of pending) {
      const m = merged.find((x) => x.label === p.label);
      if (m) { m.amount += p.amount; m.n++; } else merged.push({ label: p.label, amount: p.amount, n: 1 });
    }
    pending = [];
    // the kill reads first, its riders after it
    const rank = (l) => (/^kill$/i.test(l) ? 0 : /^headshot$/i.test(l) ? 1 : /^assist$/i.test(l) ? 2 : 3);
    merged.sort((a, b) => rank(a.label) - rank(b.label));
    for (const m of merged) {
      burst.total += m.amount;
      burst.lines.push(m);
    }
    while (burst.lines.length > 4) burst.lines.shift();
    feedTot.innerHTML = `+${fmt(burst.total)}<small>XP</small>`;
    feedLns.innerHTML = burst.lines.map((l) =>
      `<div class="ln"><b>+${fmt(l.amount)}</b>${l.n > 1 ? l.n + "x " : ""}${esc(l.label)}</div>`).join("");
    feed.classList.add("on");
    if (hideT) clearTimeout(hideT);
    hideT = setTimeout(() => {
      feed.classList.remove("on");
      hideT = setTimeout(() => { burst = { total: 0, lines: [] }; hideT = null; }, 400);
    }, 2400);
  }
  // match/mission completion awards belong to the after-action screen, not the feed
  const FEED_SKIP = { completion: 1, win: 1, campaign: 1 };

  // =========================================================== 2. toasts
  const toast = document.createElement("div");
  toast.id = "br-lvl";
  document.body.appendChild(toast);
  const toastQ = [];
  let toastBusy = false;
  function pumpToast() {
    if (toastBusy) return;
    const t = toastQ.shift();
    if (!t) return;
    toastBusy = true;
    toast.className = t.wpn ? "wpn" : "";
    toast.innerHTML = t.html;
    // force a reflow so the fade re-runs
    void toast.offsetWidth;
    toast.classList.add("on");
    setTimeout(() => {
      toast.classList.remove("on");
      setTimeout(() => { toastBusy = false; pumpToast(); }, 300);
    }, t.wpn ? 2200 : 3200);
  }
  function unlockLine(keys) {
    if (!keys || !keys.length) return "";
    const names = keys.slice(0, 3).map((k) => P.unlockName(k));
    return `<div class="u">New: ${esc(names.join(" · "))}${keys.length > 3 ? " +" + (keys.length - 3) : ""}</div>`;
  }

  // =========================================================== events
  let aarAfterCampaignT = null;
  P.onEvent((e) => {
    if (!e) return;
    if (e.type === "xp") {
      if (FEED_SKIP[e.cat] || aar.open) return;
      pending.push({ label: e.label, amount: e.amount });
      if (!flushT) flushT = setTimeout(flushFeed, 30);
    } else if (e.type === "levelup") {
      toastQ.push({ html: `<div class="k">LEVEL UP</div><div class="n">${e.level} · ${esc(e.rank.toUpperCase())}</div>${unlockLine(e.unlocks)}` });
      pumpToast();
    } else if (e.type === "weaponlevel") {
      toastQ.push({ wpn: true, html: `<div class="k">WEAPON LEVEL</div><div class="n">${esc(e.name.toUpperCase())} · ${e.level}</div>${unlockLine(e.unlocks)}` });
      pumpToast();
    } else if (e.type === "report") {
      // PVP: scoreboard.js opens the after-action with its end board.
      // Campaign: show it over the debrief once the debrief is up.
      if (e.report && e.report.kind === "campaign") {
        if (aarAfterCampaignT) clearTimeout(aarAfterCampaignT);
        aarAfterCampaignT = setTimeout(() => { aarAfterCampaignT = null; showPending(null); }, 2500);
      }
    }
  });

  // =========================================================== 3. after-action
  const root = document.createElement("div");
  root.id = "br-aar";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "After-action report");
  document.body.appendChild(root);

  const aar = { open: false, report: null, onDone: null, anim: null, shownFor: null };

  function headline(r) {
    if (r.kind === "campaign") return r.result === "won" ? ["OPERATION COMPLETE", "won"] : ["OPERATION FAILED", "lost"];
    if (r.result === "won") return ["VICTORY", "won"];
    if (r.result === "draw") return ["DRAW", ""];
    if (r.result === "forfeit") return ["WITHDRAWN", "lost"];
    return ["DEFEAT", "lost"];
  }

  function render(r) {
    const [hl, cls] = headline(r);
    const modeName = MODE_NAMES[r.kind === "campaign" ? "campaign" : r.mode] || titleCase(r.mode || "Match");
    const where = r.kind === "campaign" ? "Meridian Ward" : titleCase(r.map || "");
    const cats = r.cats.map((c) =>
      `<div class="row"><span>${esc(c.label)}${c.n > 1 ? `<span class="n">x${c.n}</span>` : ""}</span><span class="x">+${fmt(c.xp)}</span></div>`).join("") ||
      `<div class="none">No XP this time.</div>`;
    const weapons = r.weapons.length ? r.weapons.map((w, i) =>
      `<div class="wp" data-w="${i}"><div class="t"><span>${esc(w.name.toUpperCase())} <span class="l">LV <span class="wl">${w.fromLevel}</span></span></span>` +
      `<span class="x">${w.kills} kill${w.kills === 1 ? "" : "s"} · +${fmt(w.xp)}</span></div>` +
      `<div class="bar"><i></i><b></b></div></div>`).join("") :
      `<div class="none">No weapon eliminations recorded.</div>`;
    const h = r.highlights;
    const tiles = [
      [h.kills, "Eliminations"], [h.headshots, "Headshots"], [h.bestStreak, "Best streak"],
      [r.kind === "campaign" ? h.callins : h.assists, r.kind === "campaign" ? "Call-ins" : "Assists"],
      [h.medals.length, "Medals"], [r.mode === "ctf" ? h.captures : (h.score != null ? fmt(h.score) : h.longshots), r.mode === "ctf" ? "Captures" : (h.score != null ? "Score" : "Longshots")],
    ].map(([v, k]) => `<div><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
    const unlocks = r.unlocks.length ? r.unlocks.slice(0, 8).map((k) => `<div class="ul"><em>NEW</em>${esc(P.unlockName(k))}</div>`).join("") +
      (r.unlocks.length > 8 ? `<div class="none">+${r.unlocks.length - 8} more</div>` : "") :
      (() => { const n = P.nextUnlock(); return n ? `<div class="none">Next: ${esc(P.unlockName(n.key))} at level ${n.level}</div>` : `<div class="none">Everything is unlocked.</div>`; })();
    root.innerHTML =
      `<div class="in">` +
      `<div class="rt">After-action · ${esc(modeName)}${where ? " · " + esc(where) : ""}</div>` +
      `<h1 class="${cls}">${hl}</h1>` +
      `<div class="lvl"><div class="badge">${badgeSvg(r.fromLevel)}<span class="bl">${r.fromLevel}</span></div>` +
      `<div class="lvb"><div class="lvt"><span class="rk">${esc(P.rank(r.fromLevel))}</span><span class="gain">+0 XP</span></div>` +
      `<div class="bar"><i></i><b></b></div>` +
      `<div class="lvn"><span class="cur"></span><span class="nx"></span></div></div></div>` +
      `<div class="cols"><div><h3>XP earned</h3>${cats}` +
      `<div class="row tot"><span>Total</span><span class="x">+${fmt(r.total)}</span></div>` +
      `<h3 style="margin-top:18px">Unlocks</h3>${unlocks}</div>` +
      `<div><h3>Highlights</h3><div class="hl">${tiles}</div><h3>Weapons</h3>${weapons}</div></div>` +
      (r.saved ? "" : `<div class="warn">Progress could not be saved on this device (storage unavailable).</div>`) +
      `<div class="foot"><button data-a="continue" type="button">Continue</button><span class="hint">Enter · Space · Esc</span></div>` +
      `</div>`;
  }

  // progress t in [0,1] maps XP fromXp -> toXp; the bar walks through each level
  function paint(t) {
    const r = aar.report;
    if (!r) return;
    const x = r.fromXp + (r.toXp - r.fromXp) * t;
    const lv = levelAt(x);
    const floor = levelFloor(lv), need = lv >= 55 ? 0 : xpNext(lv);
    const frac = need ? Math.min(1, (x - floor) / need) : 1;
    const startFrac = lv === r.fromLevel && need ? Math.max(0, (r.fromXp - floor) / need) : 0;
    const q = (s) => root.querySelector(s);
    const i = q(".lvl .bar i"), b = q(".lvl .bar b");
    if (i) i.style.width = (startFrac * 100).toFixed(2) + "%";
    if (b) { b.style.left = (startFrac * 100).toFixed(2) + "%"; b.style.width = (Math.max(0, frac - startFrac) * 100).toFixed(2) + "%"; }
    const bl = q(".badge .bl"); if (bl) bl.textContent = String(lv);
    const rk = q(".rk"); if (rk) rk.textContent = P.rank(lv);
    const g = q(".gain"); if (g) g.textContent = "+" + fmt(x - r.fromXp) + " XP";
    const cur = q(".lvn .cur");
    if (cur) {
      cur.textContent = need ? `${fmt(x - floor)} / ${fmt(need)}` : "MAX LEVEL";
      cur.className = "cur" + (lv > r.fromLevel ? " lvup" : "");
      if (lv > r.fromLevel) cur.textContent = `LEVEL UP · ${lv} — ` + cur.textContent;
    }
    const nx = q(".lvn .nx"); if (nx) nx.textContent = lv < 55 ? `Level ${lv + 1}` : "";
    const badge = q(".badge"); if (badge && badge.dataset.lv !== String(lv)) {
      badge.dataset.lv = String(lv);
      badge.innerHTML = badgeSvg(lv) + `<span class="bl">${lv}</span>`;
    }
    r.weapons.forEach((w, k) => {
      const el = root.querySelector(`.wp[data-w="${k}"]`);
      if (!el) return;
      const wx = w.fromXp + (w.toXp - w.fromXp) * t;
      const wl = wLevelAt(wx);
      const wf = wLevelFloor(wl), wn = wl >= 20 ? 0 : wXpNext(wl);
      const wfrac = wn ? Math.min(1, (wx - wf) / wn) : 1;
      const ws = wl === w.fromLevel && wn ? Math.max(0, (w.fromXp - wf) / wn) : 0;
      const wi = el.querySelector(".bar i"), wb = el.querySelector(".bar b"), wlab = el.querySelector(".wl");
      if (wi) wi.style.width = (ws * 100).toFixed(2) + "%";
      if (wb) { wb.style.left = (ws * 100).toFixed(2) + "%"; wb.style.width = (Math.max(0, wfrac - ws) * 100).toFixed(2) + "%"; }
      if (wlab) { wlab.textContent = String(wl); wlab.style.color = wl > w.fromLevel ? "var(--a10-amber,#d9a441)" : ""; }
    });
  }

  // curve helpers (pure functions from progression.js)
  function levelAt(x) { return curve.levelForXp(x); }
  function levelFloor(L) { return curve.levelFloor(L); }
  function xpNext(L) { return curve.xpToNext(L); }
  function wLevelAt(x) { return curve.weaponLevelForXp(x); }
  function wLevelFloor(l) { return curve.weaponLevelFloor(l); }
  function wXpNext(l) { return curve.weaponXpToNext(l); }

  function animate() {
    const r = aar.report;
    const dur = 1400 + 650 * Math.max(0, r.toLevel - r.fromLevel);
    const t0 = Date.now();
    stopAnim();
    paint(0);
    aar.anim = setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / dur);
      paint(1 - Math.pow(1 - t, 2.2));
      if (t >= 1) stopAnim();
    }, 33);
  }
  function stopAnim() { if (aar.anim) { clearInterval(aar.anim); aar.anim = null; } }
  function finish() { stopAnim(); paint(1); }

  function show(report, onDone) {
    if (!report) return false;
    aar.report = report;
    aar.onDone = onDone || null;
    aar.open = true;
    aar.shownFor = report;
    render(report);
    root.style.display = "block";
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* no-op */ }
    animate();
    const btn = root.querySelector('[data-a="continue"]');
    if (btn) try { btn.focus({ preventScroll: true }); } catch (e) { /* no-op */ }
    return true;
  }
  // the latest report, once — no-op if it was already shown
  function showPending(onDone) {
    const r = P.lastReport;
    if (!r || aar.shownFor === r) return false;
    return show(r, onDone);
  }
  function close(runDone = true) {
    if (!aar.open) return;
    stopAnim();
    aar.open = false;
    root.style.display = "none";
    const fn = aar.onDone;
    aar.onDone = null;
    if (runDone && fn) { try { fn(); } catch (e) { /* no-op */ } }
  }
  function cont() {
    // first press while the bars still run completes them; the next continues
    if (aar.anim) { finish(); return; }
    close(true);
  }
  root.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest("[data-a]");
    if (a && a.getAttribute("data-a") === "continue") { finish(); close(true); return; }
    if (aar.anim) finish(); // a tap anywhere skips the count-up
  });
  window.addEventListener("keydown", (e) => {
    if (!aar.open) return;
    if (e.code === "Enter" || e.code === "Space" || e.code === "Escape" || e.code === "NumpadEnter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      cont();
    }
  }, true);

  // =========================================================== 4. profile strip
  const strip = document.createElement("div");
  strip.id = "br-profile";
  strip.innerHTML = `<div class="t"><span class="lv">LEVEL<b></b></span><span class="rk"></span></div><div class="bar"><b></b></div><div class="x"></div>`;
  function paintStrip() {
    const lp = P.levelProgress();
    strip.querySelector(".lv b").textContent = String(lp.level);
    strip.querySelector(".rk").textContent = P.rank(lp.level);
    strip.querySelector(".bar b").style.width = (lp.frac * 100).toFixed(1) + "%";
    strip.querySelector(".x").textContent = lp.need ? `${fmt(lp.into)} / ${fmt(lp.need)} XP` : "MAX LEVEL";
  }
  P.onChange(paintStrip);
  paintStrip();
  setInterval(() => {
    const menuEl = document.getElementById("menu");
    if (!menuEl) return;
    if (strip.parentNode !== menuEl) menuEl.appendChild(strip);
    const scr = shell.menu && shell.menu._screen;
    const want = menuEl.style.display !== "none" && (scr === "title" || scr === "modeselect") ? "block" : "none";
    if (strip.style.display !== want) { strip.style.display = want; if (want === "block") paintStrip(); }
  }, 250);

  const api = {
    attach(bridge) { void bridge; mountFeed(); },
    show, showPending, close, finish,
    get open() { return aar.open; },
    _root: root, _feed: feed, _strip: strip,
  };
  shell.afterAction = api;
  return api;
}

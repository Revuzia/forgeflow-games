// core/hud/loadout_hud.js — the player-facing half of weapons-slots / loot / streaks.
//
//   · WEAPON BAR     five fixed slots [1][2][3][4][5] — owned guns lit, empty slots
//                    dim, the held gun amber with live ammo; click-free, key-driven.
//   · PICK-UP TOAST  "PICKED UP  B-12 BREAKER  [3]" / "+AMMO" (event "pickup")
//   · LOOT PROMPT    the nearest ground weapon within ~6 m, projected to the screen
//                    ("KS-23 VESPER  [2]  — walk over it"), so loot is findable
//   · STREAK TRAY    [6] MORTAR 3 · [7] AIRSTRIKE 5 · [8] ORBITAL 10 — progress to
//                    each tier, stock when earned (pulses READY), the current streak
//   · CALL-IN        "MORTAR STRIKE INBOUND  2.4" countdown + a target marker
//                    projected onto the world
//   · MEDALS         DOUBLE KILL / TRIPLE KILL / 5 KILL STREAK … banner (event "medal")
//   · SCORE POPUPS   +100 KILL / +150 HEADSHOT floating up beside the crosshair
//
// Everything is DOM under the game's #hud root (shown/hidden with it); it reads
// sim.state each frame and listens to the sim's bridge events. No game logic here.

import { relDegTo } from "./hud.js";
const STYLE_ID = "ld-style";

// ---- MEDAL EMBLEMS (2026-10-14: medals were text only). Inline SVG, one per kind,
// on a shared hexagon badge — no image assets, crisp at any DPI.
const MEDAL_ICONS = (() => {
  const hex = (stroke, fill) => `<path d="M32 3 L57 17.5 L57 46.5 L32 61 L7 46.5 L7 17.5 Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`;
  const wrap = (body, stroke = "#d9a441", fill = "rgba(20,16,8,.78)") =>
    `<svg viewBox="0 0 64 64" width="58" height="58">${hex(stroke, fill)}${body}</svg>`;
  const A = "#f0c46a", R = "#ff4a3a";
  return {
    multi: wrap(`<path d="M18 38 L32 26 L46 38" fill="none" stroke="${A}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M18 48 L32 36 L46 48" fill="none" stroke="${A}" stroke-width="5" stroke-linejoin="round" opacity=".7"/>
      <path d="M18 28 L32 16 L46 28" fill="none" stroke="${A}" stroke-width="5" stroke-linejoin="round" opacity=".45"/>`),
    streak: wrap(`<path d="M32 12 L36.5 26 L51 26 L39.5 34.5 L44 48.5 L32 40 L20 48.5 L24.5 34.5 L13 26 L27.5 26 Z" fill="${R}"/>`, R, "rgba(40,6,4,.8)"),
    headshot: wrap(`<circle cx="32" cy="32" r="13" fill="none" stroke="${A}" stroke-width="3"/>
      <path d="M32 12 V24 M32 40 V52 M12 32 H24 M40 32 H52" stroke="${A}" stroke-width="3"/>
      <circle cx="32" cy="32" r="3.5" fill="${R}"/>`),
    longshot: wrap(`<circle cx="32" cy="32" r="17" fill="none" stroke="${A}" stroke-width="2.5"/>
      <path d="M32 15 V49 M15 32 H49" stroke="${A}" stroke-width="1.6"/>
      <path d="M27 37 H37 M28.5 41 H35.5 M30 45 H34" stroke="${A}" stroke-width="2"/>`),
    revenge: wrap(`<path d="M20 22 L44 46 M44 22 L20 46" stroke="${A}" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M16 18 L24 18 L16 26 Z M48 18 L40 18 L48 26 Z" fill="${A}"/>`),
    firstblood: wrap(`<path d="M32 13 C32 13 19 30 19 38 A13 13 0 0 0 45 38 C45 30 32 13 32 13 Z" fill="${R}"/>
      <path d="M26 39 A6 6 0 0 0 31 45" fill="none" stroke="rgba(255,220,210,.6)" stroke-width="2.5" stroke-linecap="round"/>`, R, "rgba(40,6,4,.8)"),
  };
})();


const NAMES = { warden: "WARDEN", vesper: "VESPER", breaker: "BREAKER", corvus: "CORVUS", pike: "PIKE" };
const FULL_NAMES = { warden: "M-72 WARDEN", vesper: "KS-23 VESPER", breaker: "B-12 BREAKER", corvus: "LR-1 CORVUS", pike: "GS-9 PIKE" };
const SLOT_ORDER = ["warden", "vesper", "breaker", "corvus", "pike"];
const TIERS = [
  { tier: 1, id: "recon", name: "SWEEP", at: 3, key: 6 },
  { tier: 2, id: "mortar", name: "MORTAR", at: 5, key: 7 },
  { tier: 3, id: "airstrike", name: "AIRSTRIKE", at: 7, key: 8 },
  { tier: 4, id: "orbital", name: "ORBITAL", at: 10, key: 9 },
];

function css() {
  return `
#ld-root{position:absolute;inset:0;pointer-events:none;font-family:var(--a10-hud-font,'Oswald','Arial Narrow',system-ui,sans-serif);color:var(--a10-ink,#e8e8e4);}
#ld-root *{box-sizing:border-box;}
/* ---- weapon bar ---- */
#ld-bar{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:6px;align-items:flex-end;}
#ld-bar .ld-slot{position:relative;min-width:74px;padding:5px 9px 6px;border:1px solid rgba(232,232,228,.16);
  background:linear-gradient(180deg,rgba(8,12,18,.55),rgba(8,12,18,.78));border-radius:3px;text-align:center;
  transition:transform .12s ease,border-color .12s ease,background .12s ease,opacity .12s ease;opacity:.5;}
#ld-bar .ld-slot .k{position:absolute;left:5px;top:2px;font-size:10px;letter-spacing:.06em;opacity:.7;}
#ld-bar .ld-slot .n{display:block;font-size:12px;letter-spacing:.12em;margin-top:6px;white-space:nowrap;}
#ld-bar .ld-slot .a{display:block;font-size:10px;letter-spacing:.06em;opacity:.78;margin-top:1px;min-height:12px;font-variant-numeric:tabular-nums;}
#ld-bar .ld-slot.own{opacity:.92;border-color:rgba(232,232,228,.30);}
#ld-bar .ld-slot.empty .n{opacity:.35;}
#ld-bar .ld-slot.empty .a{visibility:hidden;}
#ld-bar .ld-slot.held{opacity:1;transform:translateY(-5px);border-color:var(--a10-amber,#d9a441);
  background:linear-gradient(180deg,rgba(60,42,12,.55),rgba(14,12,8,.86));box-shadow:0 0 14px rgba(217,164,65,.22);}
#ld-bar .ld-slot.held .n{color:var(--a10-amber,#d9a441);}
#ld-bar .ld-slot.low .a{color:#ff7a5c;opacity:1;}
#ld-bar .ld-slot.flash{animation:ldflash .7s ease-out;}
@keyframes ldflash{0%{background:rgba(217,164,65,.55);transform:translateY(-9px) scale(1.08);}100%{}}
/* ---- toast ---- */
#ld-toast{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);text-align:center;font-size:15px;letter-spacing:.14em;
  opacity:0;transition:opacity .2s ease;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.85);}
#ld-toast.on{opacity:1;}
#ld-toast b{color:var(--a10-amber,#d9a441);font-weight:400;}
#ld-toast small{display:block;font-size:11px;opacity:.7;letter-spacing:.1em;margin-top:2px;}
/* ---- loot prompt (projected) ---- */
#ld-loot{position:absolute;left:0;top:0;transform:translate(-50%,-100%);font-size:12px;letter-spacing:.12em;white-space:nowrap;
  opacity:0;transition:opacity .15s ease;text-shadow:0 1px 3px rgba(0,0,0,.9);padding:2px 7px;background:rgba(8,12,18,.45);border-left:2px solid var(--a10-amber,#d9a441);}
#ld-loot i{font-style:normal;opacity:.65;margin-left:6px;}
#ld-loot.on{opacity:1;}
/* ---- SIGNAL SWEEP: last-known enemy positions ---- */
#ld-recon{position:absolute;inset:0;pointer-events:none;}
#ld-recon .rc{position:absolute;transform:translate(-50%,-50%);opacity:0;text-align:center;will-change:transform,opacity;}
#ld-recon .rc i{display:block;width:11px;height:11px;margin:0 auto;transform:rotate(45deg);border:2px solid #ff3b30;
  background:rgba(255,59,48,.22);box-shadow:0 0 10px rgba(255,59,48,.55);}
#ld-recon .rc span{display:block;margin-top:3px;font-size:10px;letter-spacing:.08em;color:#ffd9d4;text-shadow:0 1px 3px #000;}
#ld-recon .cc{position:absolute;width:8px;height:8px;transform:translate(-50%,0) rotate(45deg);background:#ff3b30;opacity:0;
  box-shadow:0 0 6px rgba(255,59,48,.7);}
#ld-recon .bar{position:absolute;left:50%;top:126px;transform:translateX(-50%);font-size:11px;letter-spacing:.16em;color:#ffd9d4;
  opacity:0;transition:opacity .25s ease;text-shadow:0 1px 4px #000;white-space:nowrap;}
#ld-recon .bar.on{opacity:.92;}
#ld-recon .bar b{color:#ff3b30;font-weight:400;margin-left:8px;}
#ld-recon .bar i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff3b30;margin-right:7px;vertical-align:1px;
  animation:ldpulse 1s ease-in-out infinite;}
/* ---- streak tray ---- */
#ld-streaks{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;}
#ld-streaks .ld-st{position:relative;min-width:118px;padding:4px 9px 5px;border:1px solid rgba(232,232,228,.14);background:rgba(8,12,18,.5);
  border-radius:3px;opacity:.55;overflow:hidden;}
#ld-streaks .ld-st .t{display:flex;justify-content:space-between;gap:10px;font-size:11px;letter-spacing:.1em;white-space:nowrap;}
#ld-streaks .ld-st .t b{font-weight:400;opacity:.7;}
#ld-streaks .ld-st .bar{height:2px;margin-top:4px;background:rgba(232,232,228,.14);}
#ld-streaks .ld-st .bar i{display:block;height:100%;width:0;background:var(--a10-amber,#d9a441);transition:width .25s ease;}
#ld-streaks .ld-st.ready{opacity:1;border-color:var(--a10-kill,#ff3b30);background:rgba(60,12,10,.6);animation:ldpulse 1s ease-in-out infinite;}
#ld-streaks .ld-st.ready .bar i{background:var(--a10-kill,#ff3b30);width:100%;}
#ld-streaks .ld-st.flying{opacity:1;border-color:#fff;}
@keyframes ldpulse{0%,100%{box-shadow:0 0 0 rgba(255,59,48,0);}50%{box-shadow:0 0 14px rgba(255,59,48,.55);}}
#ld-count{min-width:62px;text-align:center;font-size:11px;letter-spacing:.14em;opacity:.0;transition:opacity .2s;}
#ld-count b{display:block;font-size:22px;font-weight:400;line-height:1;color:var(--a10-amber,#d9a441);}
#ld-count.on{opacity:.95;}
/* ---- call-in countdown + marker ---- */
#ld-call{position:absolute;left:50%;top:150px;transform:translateX(-50%);text-align:center;font-size:14px;letter-spacing:.2em;opacity:0;transition:opacity .2s;color:#ffd9d4;text-shadow:0 0 8px rgba(255,59,48,.6);}
#ld-call.on{opacity:1;}
#ld-call b{font-weight:400;font-size:22px;display:block;letter-spacing:.12em;color:#fff;}
.ld-mark{position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;opacity:0;transition:opacity .15s;}
.ld-mark.on{opacity:1;}
.ld-mark svg{width:100%;height:100%;display:block;animation:ldspin 2.4s linear infinite;}
.ld-mark.edge svg{animation:none;}
.ld-mark .ar{position:absolute;left:50%;top:50%;width:0;height:0;margin:-9px 0 0 -7px;border-left:7px solid transparent;
  border-right:7px solid transparent;border-bottom:18px solid #ff3b30;opacity:0;filter:drop-shadow(0 0 6px rgba(255,59,48,.7));}
.ld-mark.edge .ar{opacity:1;}
.ld-mark.edge svg{opacity:.35;}
.ld-mark span{position:absolute;left:50%;top:38px;transform:translateX(-50%);font-size:11px;letter-spacing:.1em;white-space:nowrap;color:#ffd9d4;}
@keyframes ldspin{to{transform:rotate(360deg);}}
/* ---- medals ---- */
#ld-medal{position:absolute;left:50%;top:22%;transform:translate(-50%,0);text-align:center;opacity:0;pointer-events:none;}
#ld-medal .i{height:58px;margin:0 auto 4px;filter:drop-shadow(0 2px 8px rgba(0,0,0,.7));}
#ld-medal .i:empty{display:none;}
#ld-medal .m{font-size:38px;letter-spacing:.22em;font-weight:400;text-shadow:0 2px 14px rgba(0,0,0,.8),0 0 22px rgba(217,164,65,.35);}
#ld-medal .s{font-size:14px;letter-spacing:.2em;opacity:.85;margin-top:2px;}
#ld-medal.streak .m{color:var(--a10-kill,#ff3b30);text-shadow:0 2px 14px rgba(0,0,0,.8),0 0 26px rgba(255,59,48,.5);}
#ld-medal.show{animation:ldmedal 2.4s cubic-bezier(.2,.9,.2,1) forwards;}
@keyframes ldmedal{0%{opacity:0;transform:translate(-50%,10px) scale(1.5);}9%{opacity:1;transform:translate(-50%,0) scale(1);}78%{opacity:1;}100%{opacity:0;transform:translate(-50%,-8px) scale(.98);}}
/* ---- score popups ---- */
#ld-score{position:absolute;left:calc(50% + 46px);top:calc(50% + 6px);}
#ld-score .p{position:absolute;left:0;top:0;white-space:nowrap;font-size:17px;letter-spacing:.08em;opacity:0;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9);animation:ldscore 1.3s ease-out forwards;}
#ld-score .p.hs{color:var(--a10-amber,#d9a441);}
#ld-score .p small{font-size:11px;opacity:.75;margin-left:5px;letter-spacing:.12em;}
@keyframes ldscore{0%{opacity:0;transform:translateY(8px);}12%{opacity:1;}100%{opacity:0;transform:translateY(-34px);}}
`;
}

function el(tag, id, cls, html) {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function createLoadoutHud(ctx) {
  if (typeof document === "undefined") return { attach() {}, update() {}, reset() {} };
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css();
    document.head.appendChild(st);
  }

  const root = el("div", "ld-root");
  const bar = el("div", "ld-bar");
  const slotEls = SLOT_ORDER.map((id, i) => {
    const s = el("div", null, "ld-slot empty",
      `<span class="k">${i + 1}</span><span class="n">${NAMES[id]}</span><span class="a"></span>`);
    bar.appendChild(s);
    return { id, s, a: s.querySelector(".a"), cache: "" };
  });
  const toast = el("div", "ld-toast");
  const lootEl = el("div", "ld-loot");
  const streaks = el("div", "ld-streaks");
  const countEl = el("div", "ld-count", null, `STREAK<b>0</b>`);
  streaks.appendChild(countEl);
  const tierEls = TIERS.map((t) => {
    const e = el("div", null, "ld-st",
      `<div class="t"><span>[${t.key}] ${t.name}</span><b>${t.at}</b></div><div class="bar"><i></i></div>`);
    streaks.appendChild(e);
    return { t, e, bar: e.querySelector(".bar i"), b: e.querySelector(".t b"), cache: "" };
  });
  const call = el("div", "ld-call");
  const MARK_HTML = `<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="12" fill="none" stroke="#ff3b30" stroke-width="2" stroke-dasharray="6 5"/><path d="M17 3v6M17 25v6M3 17h6M25 17h6" stroke="#ffd9d4" stroke-width="2"/></svg><i class="ar"></i><span></span>`;
  const mark = el("div", "ld-mark", "ld-mark", MARK_HTML);
  const marks = [mark];
  for (let i = 0; i < 2; i++) marks.push(el("div", null, "ld-mark", MARK_HTML));
  const medal = el("div", "ld-medal", null, `<div class="i"></div><div class="m"></div><div class="s"></div>`);
  const score = el("div", "ld-score");
  // SIGNAL SWEEP overlay. Markers are SNAPSHOTS (position at the sweep, fading before
  // the next one) — intel, not a wallhack that tracks a man through a wall.
  const recon = el("div", "ld-recon");
  const reconBar = el("div", null, "bar");
  recon.appendChild(reconBar);
  const RC_N = 24;
  const rcEls = [];
  for (let i = 0; i < RC_N; i++) {
    const w = el("div", null, "rc", "<i></i><span></span>");
    const c = el("div", null, "cc");
    recon.appendChild(w); recon.appendChild(c);
    rcEls.push({ w, c, span: w.querySelector("span"), txt: "" });
  }
  let reconContacts = [], reconT = -99, reconEndT = -1;
  [recon, bar, toast, lootEl, streaks, call, ...marks, medal, score].forEach((n) => root.appendChild(n));

  let mounted = false;
  function mount() {
    if (mounted) return;
    const hud = document.getElementById("hud");
    if (!hud) return;
    hud.appendChild(root);
    mounted = true;
  }

  const sim = () => (ctx.sim ? ctx.sim() : null);
  let toastT = 0;
  let medalQueue = [];
  let medalBusy = 0;
  const activeCalls = new Map(); // id -> {name, target:[3], endT, id} — every strike in flight
  let flyingIds = new Set();
  let scoreN = 0;
  let proj = null;

  function showToast(html) {
    toast.innerHTML = html;
    toast.classList.add("on");
    toastT = 2.4;
  }

  function popMedal(m) {
    medal.className = "ld-medal " + (m.kind === "streak" ? "streak" : "");
    medal.querySelector(".i").innerHTML = MEDAL_ICONS[m.kind] || MEDAL_ICONS.multi;
    medal.querySelector(".m").textContent = m.text;
    medal.querySelector(".s").textContent = m.sub || "";
    // restart the CSS animation
    medal.classList.remove("show");
    void medal.offsetWidth;
    medal.classList.add("show");
    // a kill can now earn several medals at once (multi + headshot + longshot...):
    // a backlog cycles faster so the last one is not shown seconds late
    medalBusy = medalQueue.length > 0 ? 0.85 : 1.5;
  }

  function projectToScreen(x, y, z) {
    const cam = ctx.camera;
    if (!cam) return null;
    if (!proj) proj = cam.position.clone();
    proj.set(x, y, z).project(cam);
    if (proj.z > 1 || proj.z < -1) return null;
    return [(proj.x * 0.5 + 0.5) * window.innerWidth, (-proj.y * 0.5 + 0.5) * window.innerHeight];
  }

  // ----------------------------------------------------------------- events
  function onPickup(d) {
    if (!d || d.who !== "P") return;
    if (d.kind === "ammo") {
      showToast(d.weaponId ? `<b>+AMMO</b>  ${d.name}` : `<b>+AMMO</b>  RESUPPLIED`);
    } else {
      const slot = d.slot >= 0 ? d.slot + 1 : "";
      showToast(`PICKED UP  <b>${FULL_NAMES[d.weaponId] || d.name}</b>  [${slot}]` +
        (d.equipped ? "" : `<small>press ${slot} to switch</small>`));
      if (d.slot >= 0 && slotEls[d.slot]) {
        const s = slotEls[d.slot].s;
        s.classList.remove("flash"); void s.offsetWidth; s.classList.add("flash");
      }
    }
  }
  function onMedal(d) { if (d) medalQueue.push(d); }
  function onScore(d) {
    if (!d) return;
    const p = el("div", null, "p" + (d.headshot ? " hs" : ""), `+${d.points}<small>${d.why}</small>`);
    p.style.left = (scoreN++ % 3) * 6 + "px";
    score.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
  function onStreak(d) {
    if (!d) return;
    const s = sim();
    if (d.phase === "sweep") {
      reconContacts = (d.contacts || []).slice(0, RC_N);
      reconT = s ? s.state.time : 0;
      reconEndT = d.endT || reconEndT;
      return;
    }
    if (d.phase === "call" && s && d.id === "recon") {
      flyingIds.add(d.id);
      reconEndT = d.endT || (s.state.time + (d.duration || 24));
      showToast(`<b>SIGNAL SWEEP</b> ONLINE  <small>hostiles ping on your compass every sweep</small>`);
    } else if (d.phase === "call" && s) {
      // the first impact's absolute sim time (events can reach us a few ticks late)
      activeCalls.set(d.id, { id: d.id, name: d.name, target: d.target, endT: d.plan && d.plan.length ? d.plan[0].t : s.state.time + d.eta });
      flyingIds.add(d.id);
    } else if (d.phase === "done") {
      flyingIds.delete(d.id);
      if (d.id === "recon") { reconContacts = []; reconEndT = -1; }
      activeCalls.delete(d.id);
    } else if (d.phase === "earned") {
      // the medal banner already reads "<n> KILL STREAK / NAME READY [key]" — the toast
      // only adds HOW it is used, after the banner has had its moment
      setTimeout(() => showToast(d.id === "recon"
        ? `<small>[${d.key}] launches a recon drone — every hostile pings on your compass</small>`
        : `<small>[${d.key}] calls it on the spot under your crosshair</small>`), 1600);
    } else if (d.phase === "denied" && d.reason === "none") {
      showToast(`<small>NO CALL-IN AVAILABLE</small>`);
    }
  }

  // ----------------------------------------------------------------- frame
  function update(dt) {
    mount();
    const s = sim();
    if (!s) return;
    const p = s.state.player;
    const st = s.state.streak;
    const live = p.alive && s.state.phase !== "menu";
    root.style.display = live || !p.alive ? "" : "none";

    // weapon bar
    const held = p.weapon.id;
    for (let i = 0; i < slotEls.length; i++) {
      const se = slotEls[i];
      const id = p.slots ? p.slots[i] : null;
      let cls = "ld-slot " + (id ? "own" : "empty");
      let txt = "";
      if (id) {
        const w = s.weapons[id];
        let mag, res;
        if (id === held) { mag = p.weapon.mag; res = p.weapon.reserve; cls += " held"; }
        else { const a = p._slotAmmo && p._slotAmmo[id]; mag = a ? a.mag : (w ? w.mag : 0); res = a ? a.reserve : 0; }
        txt = mag + " / " + res;
        if (w && mag + res > 0 && mag <= Math.ceil(w.mag * 0.25)) cls += " low";
      }
      const key = cls + "|" + txt;
      if (key !== se.cache) {
        se.cache = key;
        se.s.className = cls + (se.s.classList.contains("flash") ? " flash" : "");
        se.a.textContent = txt;
      }
    }

    // toast / medals timers
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast.classList.remove("on"); }
    if (medalBusy > 0) medalBusy -= dt;
    if (medalBusy <= 0 && medalQueue.length) popMedal(medalQueue.shift());

    // nearest ground weapon -> projected prompt
    let best = null, bd = 36;
    const loot = s.state.loot || [];
    for (let i = 0; i < loot.length; i++) {
      const it = loot[i];
      if (it.kind !== "weapon") continue;
      const dx = it.pos[0] - p.pos[0], dz = it.pos[2] - p.pos[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < bd && Math.abs(it.pos[1] - p.pos[1]) < 3) {
        // never advertise a gun behind a wall
        const eyeY = p.pos[1] + 1.55;
        if (s.world.losBlocked([p.pos[0], eyeY, p.pos[2]], [it.pos[0], it.pos[1] + 0.8, it.pos[2]])) continue;
        bd = d2; best = it;
      }
    }
    if (best && p.alive) {
      const sp = projectToScreen(best.pos[0], best.pos[1] + 0.95, best.pos[2]);
      const owned = p.slots && p.slots.indexOf(best.weapon) >= 0;
      if (sp) {
        lootEl.style.left = sp[0] + "px";
        lootEl.style.top = sp[1] + "px";
        const slot = SLOT_ORDER.indexOf(best.weapon) + 1;
        const html = `${FULL_NAMES[best.weapon] || best.weapon}<i>${owned ? "AMMO" : "[" + slot + "]"}</i>`;
        if (lootEl.dataset.h !== html) { lootEl.innerHTML = html; lootEl.dataset.h = html; }
        lootEl.classList.add("on");
      } else lootEl.classList.remove("on");
    } else lootEl.classList.remove("on");

    // streak tray
    if (st) {
      const c = st.count | 0;
      countEl.classList.toggle("on", c > 0);
      const cb = countEl.querySelector("b");
      if (cb.textContent !== String(c)) cb.textContent = String(c);
      for (const te of tierEls) {
        const stock = st.stock[te.t.tier - 1] | 0;
        const flying = flyingIds.has(te.t.id);
        const prog = Math.min(1, c / te.t.at);
        const key = stock + "|" + flying + "|" + (stock ? 1 : prog.toFixed(2));
        if (key !== te.cache) {
          te.cache = key;
          te.e.className = "ld-st" + (stock ? " ready" : "") + (flying ? " flying" : "");
          te.bar.style.width = (stock ? 100 : prog * 100) + "%";
          te.b.textContent = stock ? "READY" + (stock > 1 ? " x" + stock : "") : (c >= te.t.at ? te.t.at : c + "/" + te.t.at);
        }
      }
    }

    // SIGNAL SWEEP: status line, compass contacts, last-known markers
    {
      const now = s.state.time;
      const on = reconEndT > now && p.alive;
      reconBar.classList.toggle("on", on);
      if (on) {
        const html = `<i></i>SIGNAL SWEEP<b>${Math.ceil(reconEndT - now)}s</b>`;
        if (reconBar.dataset.h !== html) { reconBar.innerHTML = html; reconBar.dataset.h = html; }
      }
      const age = now - reconT;
      // fade: pop in, hold, gone just before the next sweep (2.4 s period)
      const a = !on ? 0 : age < 0.12 ? age / 0.12 : age < 1.4 ? 1 : Math.max(0, 1 - (age - 1.4) / 0.9);
      const cmp = document.getElementById("compass");
      const cr = cmp ? cmp.getBoundingClientRect() : null;
      for (let i = 0; i < RC_N; i++) {
        const r = rcEls[i];
        const c = reconContacts[i];
        if (!c || a <= 0.01) {
          if (r.w.style.opacity !== "0") { r.w.style.opacity = "0"; r.c.style.opacity = "0"; }
          continue;
        }
        const sp = projectToScreen(c.pos[0], c.pos[1] + 2.05, c.pos[2]);
        if (sp) {
          r.w.style.left = sp[0].toFixed(1) + "px"; r.w.style.top = sp[1].toFixed(1) + "px";
          r.w.style.opacity = a.toFixed(2);
          const txt = Math.round(Math.hypot(c.pos[0] - p.pos[0], c.pos[2] - p.pos[2])) + " m";
          if (txt !== r.txt) { r.txt = txt; r.span.textContent = txt; }
        } else r.w.style.opacity = "0";
        if (cr) {
          const rel = relDegTo(s, c.pos);
          const half = cr.width / 2 / 4.4;              // hud.js PX_PER_DEG
          const cl = Math.max(-half, Math.min(half, rel));
          r.c.style.left = (cr.left + cr.width / 2 + cl * 4.4).toFixed(1) + "px";
          r.c.style.top = (cr.bottom + 4).toFixed(1) + "px";
          r.c.style.opacity = (a * (Math.abs(rel) > half ? 0.45 : 1)).toFixed(2);
        }
      }
    }

    // DESIGNATE prompt / call-in countdown (soonest strike) / one marker per strike.
    // A strike off-screen (behind you, or beyond the frame edge) pins its marker to
    // the screen edge with an arrow pointing at it (2026-10-14 — it used to vanish).
    const des = ctx.input && ctx.input.designate;
    let soonest = null;
    for (const c of activeCalls.values()) if (!soonest || c.endT < soonest.endT) soonest = c;
    if (des) {
      const def = TIERS[des - 1];
      call.classList.add("on");
      const html = `${def ? def.name : "STRIKE"} — MARK TARGET<b>[LMB] CONFIRM  ·  [RMB] CANCEL</b>`;
      if (call.dataset.h !== html) { call.innerHTML = html; call.dataset.h = html; }
    } else if (soonest) {
      const left = Math.max(0, soonest.endT - s.state.time);
      call.classList.add("on");
      const html = left > 0.05 ? `${soonest.name} INBOUND<b>${left.toFixed(1)}</b>` : `${soonest.name}<b>DANGER CLOSE</b>`;
      if (call.dataset.h !== html) { call.innerHTML = html; call.dataset.h = html; }
    } else call.classList.remove("on");

    let mi = 0;
    const W = window.innerWidth, H = window.innerHeight;
    for (const c of activeCalls.values()) {
      if (mi >= marks.length) break;
      const m = marks[mi++];
      const t = c.target;
      const dist = Math.hypot(t[0] - p.pos[0], t[2] - p.pos[2]);
      const txt = Math.round(dist) + " m";
      const sp = projectToScreen(t[0], t[1] + 0.5, t[2]);
      const onScreen = sp && sp[0] > 24 && sp[0] < W - 24 && sp[1] > 24 && sp[1] < H - 24;
      if (onScreen) {
        m.style.left = sp[0] + "px"; m.style.top = sp[1] + "px";
        m.classList.remove("edge");
        const ar = m.querySelector(".ar"); ar.style.transform = "";
      } else {
        // bearing on screen: 0 deg = straight ahead (top edge), clockwise
        const rel = relDegTo(s, t) * Math.PI / 180;
        const rx = W * 0.5 - 46, ry = H * 0.5 - 46;
        const x = W * 0.5 + Math.sin(rel) * rx, y = H * 0.5 - Math.cos(rel) * ry;
        m.style.left = x + "px"; m.style.top = y + "px";
        m.classList.add("edge");
        m.querySelector(".ar").style.transform = `rotate(${rel}rad)`;
      }
      const sEl = m.querySelector("span");
      if (sEl.textContent !== txt) sEl.textContent = txt;
      m.classList.add("on");
    }
    for (; mi < marks.length; mi++) marks[mi].classList.remove("on");
  }

  function reset() {
    medalQueue = []; medalBusy = 0; activeCalls.clear(); flyingIds = new Set();
    reconContacts = []; reconT = -99; reconEndT = -1;
    toast.classList.remove("on"); toastT = 0; medal.classList.remove("show");
    for (const m of marks) m.classList.remove("on");
    call.classList.remove("on"); lootEl.classList.remove("on");
    score.innerHTML = "";
    for (const se of slotEls) se.cache = "";
    for (const te of tierEls) te.cache = "";
  }

  return {
    attach(bridge) {
      reset();
      bridge.register("pickup", onPickup);
      bridge.register("medal", onMedal);
      bridge.register("score", onScore);
      bridge.register("streak", onStreak);
    },
    update,
    reset,
    el: root,
  };
}

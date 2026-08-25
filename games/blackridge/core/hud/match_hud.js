// core/hud/match_hud.js [W6] — the PVP match HUD layer (PVP_BUILD_PLAN Part 4.1
// row W6; modes.md Part 7; arch 6.4). NEW file, its own attach(bridge, ctx):
// core/hud/hud.js is NOT edited (frozen interface) — the campaign HUD keeps
// working untouched, and everything match-shaped lives here.
//
// What this renders (modes.md §7.1–7.4, v1 scope):
//   - team score bar (TDM/CTF) / score strip (FFA), top-centre, team-tinted
//   - match clock M:SS, amber under 1:00, OT prefix in overtime
//   - match killfeed with ROSTER display names + bot glyph (the campaign
//     killfeed in hud.js shows archetype labels; while a match is live the
//     body carries .match-live and a scoped CSS rule hides #killfeed rather
//     than editing hud.js)
//   - respawn countdown + spawn-protection readout (centre-lower)
//   - warm-up rules card, on screen for the full 3.0 s, with the 3-2-1 count
//   - CTF flag strip + capture-blocked teaching line + PRESSURE banner
//   - FFA leader strip + YOU ARE MARKED banner
//   - overtime / COLLAPSE banner
//   - result banner (VICTORY / DEFEAT / DRAW + reason) — the end-of-match
//     scoreboard itself is core/hud/scoreboard.js
//
// Module scope is DOM-FREE so W7's objective.js (Node selftests) can import
// PUBLIC_FACTS from here without a document existing. All DOM work happens
// inside createMatchHud(ctx).
//
// Update model: no boot.js edit is available to this lane (W1 owns it), so the
// clock/countdown text self-drives on a 150 ms interval plus event-driven
// refreshes through the bridge. Events fire through bridge.dispatch in BOTH
// the rAF path and the synchronous stepFrames path, so probes see the same
// DOM the player does.

// ---------------------------------------------------------------------------
// PUBLIC_FACTS — Tier W (Part 3.8 / AC-35). THE closed list of facts the HUD
// publishes to the human, consumed by BOTH this HUD and core/ai/objective.js
// (W7). A fact the bots use that the human cannot see must be impossible to
// write: if it is not in this constant, it is not Tier W.
// ---------------------------------------------------------------------------
export const PUBLIC_FACTS = Object.freeze({
  // facts published in every mode
  shared: Object.freeze([
    "modeId", "phase", "clock", "timeLeft", "scoreLimit", "timeLimit",
    "teamScores",            // both team totals (or own score + leader score in FFA)
    "killfeedIdentities",    // who killed whom — identities only, never positions
    "ownRespawnCountdown", "ownSpawnProtection",
    "result", "overtimeRule",
    "collapseRing",          // {armed, radius} once overtime COLLAPSE arms
  ]),
  tdm: Object.freeze([]),    // nothing beyond shared
  ctf: Object.freeze([
    "flagStates",            // AT_STAND | CARRIED | DROPPED per flag
    "flagCarrierIdentity",   // identity is public the instant the flag leaves the stand
    "ownFlagDropPosition",   // your own dropped flag's position + return countdown
    "ownStandPosition", "enemyStandPosition",
    "carrierBeacon",         // enemy carrier position — ONLY per the beacon below
    "pressure",
  ]),
  ffa: Object.freeze([
    "leaderIdentity", "leaderScore",
    "leaderMarkerBeacon",    // leader position — only while the marker is armed
    "ownPlacement",
  ]),
  // the one piece of enemy-position information anyone gets without
  // perception (Part 3.8): identical sample, rate and error for bots + human.
  carrierBeacon: Object.freeze({ refreshS: 3.0, quantiseM: 6.0, revealAfterCarryS: 8.0 }),
  leaderMarker: Object.freeze({ atScore: 15, orLeadBy: 5 }),
});

// band → scoreboard/killfeed label (C11: bands are printed, never hidden)
export const BAND_LABEL = Object.freeze({
  recruit: "RECRUIT", regular: "REGULAR", hardened: "HARDENED", veteran: "VETERAN",
});

// ---------------------------------------------------------------------------
let styleDone = false;
function ensureMatchStyle() {
  if (styleDone || typeof document === "undefined") return;
  styleDone = true;
  if (document.getElementById("w6-style")) return; // dual ?v/bare instances
  const el = document.createElement("style");
  el.id = "w6-style";
  el.textContent = `
/* the campaign killfeed shows archetype labels; the match one shows roster
   names — one at a time, never both (zero hud.js edits) */
body.match-live #killfeed{display:none;}
/* the campaign debrief also opens on mission:end (O3 — its copy is W11's);
   during a MATCH the result banner + end scoreboard are the end screen, and
   the debrief bled through the board's translucent wash. Hidden visually —
   hud.js state is untouched and scoreboard.js still drives the debrief's own
   "Return to base" path for the shell exit. */
body.match-live #a10-debrief{display:none !important;}
#mhud{position:fixed;inset:0;z-index:35;pointer-events:none;overflow:hidden;
  font-family:var(--a10-hud-font,system-ui);color:var(--a10-ink,#e8e8e4);
  text-shadow:0 1px 2px rgba(0,0,0,.6);-webkit-user-select:none;user-select:none;display:none;}
#mhud *{box-sizing:border-box;}
/* score bar + clock, top-centre (compass sits at 18px; this block under it) */
#mh-score{position:absolute;top:44px;left:50%;transform:translateX(-50%);
  font-size:20px;letter-spacing:.12em;white-space:nowrap;text-align:center;}
#mh-score .us{font-weight:400;}
#mh-score .sep{opacity:.4;margin:0 10px;font-size:15px;}
#mh-score.pulse{animation:mhPulse 1.1s ease-in-out infinite;}
@keyframes mhPulse{0%,100%{opacity:1}50%{opacity:.55}}
#mh-clock{position:absolute;top:72px;left:50%;transform:translateX(-50%);
  font-size:14px;letter-spacing:.22em;opacity:.85;}
#mh-clock.low{color:var(--a10-amber,#d9a441);}
/* CTF flag strip, under the clock */
#mh-flags{position:absolute;top:94px;left:50%;transform:translateX(-50%);
  font-size:11px;letter-spacing:.14em;white-space:nowrap;display:none;}
#mh-flags .fl{display:inline-block;margin:0 12px;}
#mh-flags .g{display:inline-block;width:9px;height:11px;margin-right:6px;
  vertical-align:-1px;}
#mh-flags .fl.dropped .g{opacity:.45;}
#mh-flags .fl.carried .g{animation:mhPulse .9s ease-in-out infinite;}
/* match killfeed (top-right, where hud.js's sits; that one is display:none
   while .match-live) */
#mh-feed{position:absolute;right:34px;top:64px;text-align:right;font-size:12.5px;
  letter-spacing:.06em;}
#mh-feed .kr{margin-bottom:5px;opacity:0;white-space:nowrap;transition:opacity .2s;}
#mh-feed .kr .me{color:var(--a10-amber,#d9a441);}
#mh-feed .kr .med{color:var(--a10-red,#ff4d4d);}
#mh-feed .kr svg{vertical-align:-2px;margin:0 7px;opacity:.7;}
#mh-feed .kr .bg{display:inline-block;font-size:8.5px;letter-spacing:.08em;
  border:1px solid rgba(232,232,228,.35);border-radius:2px;padding:0 3px;
  margin:0 5px;vertical-align:1px;opacity:.75;}
/* centre-lower rail: respawn / protection / teaching lines */
#mh-center{position:absolute;left:50%;bottom:34%;transform:translateX(-50%);
  text-align:center;}
#mh-respawn{font-size:17px;letter-spacing:.2em;display:none;}
#mh-respawn .n{color:var(--a10-amber,#d9a441);}
#mh-protect{font-size:11px;letter-spacing:.26em;opacity:.7;display:none;margin-top:6px;}
#mh-teach{font-size:14px;letter-spacing:.2em;color:var(--a10-amber,#d9a441);
  display:none;margin-top:10px;}
/* banner rail (PRESSURE / OVERTIME / COLLAPSE / MARKED) */
#mh-banner{position:absolute;left:50%;top:24%;transform:translateX(-50%);
  font-size:16px;letter-spacing:.3em;color:var(--a10-amber,#d9a441);display:none;
  text-align:center;}
#mh-banner .sub{font-size:11px;letter-spacing:.2em;opacity:.75;margin-top:5px;
  color:var(--a10-ink,#e8e8e4);}
/* warm-up rules card */
#mh-warmup{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  text-align:center;min-width:420px;pointer-events:none;}
#mh-warmup .mode{font-size:24px;letter-spacing:.3em;margin-bottom:14px;}
#mh-warmup .rules{font-size:12.5px;letter-spacing:.1em;line-height:1.85;opacity:.85;
  font-family:var(--a10-ui-font,system-ui);}
#mh-warmup .count{font-size:44px;letter-spacing:.1em;margin-top:16px;
  color:var(--a10-amber,#d9a441);}
/* result banner — its OWN fixed layer at z-68: above the campaign debrief
   (z-65, which mission:end also opens — known W11 cosmetic, plan O3) and
   below the end board (z-70) that replaces it 3 s later */
#mh-result{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);
  z-index:68;pointer-events:none;text-align:center;display:none;
  font-family:var(--a10-hud-font,system-ui);color:var(--a10-ink,#e8e8e4);
  text-shadow:0 1px 2px rgba(0,0,0,.6);}
#mh-result h1{font-size:42px;font-weight:400;letter-spacing:.34em;margin:0;
  color:var(--a10-amber,#d9a441);}
#mh-result h1.lost{color:var(--a10-red,#ff4d4d);}
#mh-result h1.draw{color:var(--a10-ink,#e8e8e4);}
#mh-result .why{font-size:12px;letter-spacing:.3em;opacity:.65;margin-top:10px;}
/* teammate pips (through-geometry nameplates, ≤40 m, 45%, NO health bars) */
.mh-pip{position:absolute;transform:translate(-50%,-100%);font-size:10px;
  letter-spacing:.18em;opacity:.45;white-space:nowrap;}
`;
  document.head.appendChild(el);
}

const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtClock(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// tiny original weapon glyph (killfeed) — one shared silhouette
const GLYPH_SVG =
  `<svg width="22" height="8" viewBox="0 0 22 8"><path d="M0 3h13l1-2h2v2h6v2h-4l-1 2h-3l-1-2H0z" fill="currentColor"/></svg>`;

// ---------------------------------------------------------------------------
export function createMatchHud(ctx) {
  ensureMatchStyle();

  const root = document.createElement("div");
  root.id = "mhud";
  root.innerHTML =
    `<div id="mh-score"></div>` +
    `<div id="mh-clock"></div>` +
    `<div id="mh-flags"></div>` +
    `<div id="mh-feed"></div>` +
    `<div id="mh-banner"></div>` +
    `<div id="mh-center"><div id="mh-respawn"></div><div id="mh-protect"></div><div id="mh-teach"></div></div>` +
    `<div id="mh-warmup" style="display:none"><div class="mode"></div><div class="rules"></div><div class="count"></div></div>` +
    `<div id="mh-result"><h1></h1><div class="why"></div></div>` +
    `<div id="mh-pips"></div>`;
  document.body.appendChild(root);

  const el = (id) => root.querySelector("#" + id);
  const scoreEl = el("mh-score"), clockEl = el("mh-clock"), flagsEl = el("mh-flags");
  const feedEl = el("mh-feed"), bannerEl = el("mh-banner");
  const respawnEl = el("mh-respawn"), protectEl = el("mh-protect"), teachEl = el("mh-teach");
  const warmEl = el("mh-warmup"), resultEl = el("mh-result"), pipsEl = el("mh-pips");
  // the result banner escapes #mhud's stacking context (z-35) so it can sit
  // at z-68 above the campaign debrief (z-65) — see the style block note.
  document.body.appendChild(resultEl);

  // killfeed row pool (hud.js pattern: pooled, never allocated per event)
  const feedRows = [];
  for (let i = 0; i < 4; i++) {
    const r = document.createElement("div");
    r.className = "kr";
    feedEl.appendChild(r);
    feedRows.push({ el: r, t: -9, live: false });
  }
  const FEED_TTL = 6.0;

  // teammate pip pool (≤4 friendly bots)
  const pips = [];
  for (let i = 0; i < 4; i++) {
    const p = document.createElement("div");
    p.className = "mh-pip";
    p.style.display = "none";
    pipsEl.appendChild(p);
    pips.push(p);
  }

  const st = {
    active: false,           // a match is live (match:start .. return to shell)
    modeId: null,
    teams: null,             // [{id,name,tint}] from match:start
    banner: null,            // {text, sub, untilT|-1}
    teachT: -9,
    teachLastT: -9,
    marked: false,
    collapse: null,          // {armed, radius}
    pressure: false,
    resultShown: false,
  };

  const sim = () => (ctx.sim ? ctx.sim() : null);
  const M = () => { const s = sim(); return s && s.state.match ? s.state.match : null; };
  const now = () => { const s = sim(); return s ? s.state.time : 0; };

  function actorName(actorId) {
    const m = M();
    if (!m || actorId == null || !m.actors[actorId]) return "—";
    const a = m.actors[actorId];
    return a.kind === "human" ? "YOU" : a.name;
  }
  function actorIsBot(actorId) {
    const m = M();
    return !!(m && m.actors[actorId] && m.actors[actorId].kind === "bot");
  }

  // ------------------------------------------------------------- score bar
  function renderScore() {
    const m = M();
    if (!m) return;
    if (m.modeId === "ffa") {
      // YOU 12 · LEADER 17 (KESTREL) — modes.md §7.4
      let lead = null;
      for (const a of m.actors) if (!lead || a.kills > lead.kills) lead = a;
      const you = m.actors[0];
      const isYou = lead && lead.actorId === 0;
      scoreEl.innerHTML =
        `<span class="us">YOU ${you ? you.kills : 0}</span><span class="sep">·</span>` +
        `<span style="opacity:.85">LEADER ${lead ? lead.kills : 0}` +
        `${lead && !isYou ? " (" + esc(lead.name) + ")" : isYou ? " (YOU)" : ""}</span>`;
      scoreEl.classList.remove("pulse");
      return;
    }
    const t0 = m.teams.find((t) => t.id === 0), t1 = m.teams.find((t) => t.id === 1);
    if (!t0 || !t1) return;
    const ctf = m.modeId === "ctf";
    const s0 = ctf ? t0.captures : t0.score, s1 = ctf ? t1.captures : t1.score;
    const tint0 = (st.teams && st.teams[0] && st.teams[0].tint) || "#d9a441";
    const tint1 = (st.teams && st.teams[1] && st.teams[1].tint) || "#7c9fd0";
    scoreEl.innerHTML =
      `<span class="us" style="color:${tint0}">US ${s0}</span>` +
      `<span class="sep">—</span>` +
      `<span style="color:${tint1}">${s1} THEM</span>`;
    // pulses at scoreLimit − 5 (modes.md §7.2)
    const limit = ruleOf(ctf ? "captureLimit" : "scoreLimit", ctf ? 3 : 50);
    const near = Math.max(s0, s1) >= limit - (ctf ? 1 : 5);
    scoreEl.classList.toggle("pulse", near && limit > 0);
  }

  function ruleOf(key, dflt) {
    const s = sim();
    const rules = s && s.match && s.match.m ? s.match.m.rules : null;
    return rules && rules[key] != null ? rules[key] : dflt;
  }

  // ------------------------------------------------------------- clock
  function renderClock() {
    const m = M();
    if (!m) return;
    const ot = m.phase === "overtime";
    clockEl.textContent = (ot ? "OT " : "") + fmtClock(m.timeLeft);
    clockEl.classList.toggle("low", !ot && m.timeLeft <= 60 && m.phase === "live");
  }

  // ------------------------------------------------------------- flags (CTF)
  function renderFlags() {
    const m = M();
    if (!m || m.modeId !== "ctf" || !m.flags || !m.flags.length) {
      flagsEl.style.display = "none";
      return;
    }
    flagsEl.style.display = "block";
    const p = sim().state.player;
    let html = "";
    for (const f of m.flags) {
      const mine = f.team === 0;
      const tint = (st.teams && st.teams[f.team] && st.teams[f.team].tint) || (mine ? "#d9a441" : "#7c9fd0");
      const state = String(f.state || "AT_STAND").toUpperCase();
      let text = "HOME", cls = "";
      if (state === "CARRIED") {
        cls = "carried";
        const cname = actorName(f.carrier);
        if (mine) text = `TAKEN — ${esc(cname)}`; // enemy carries OUR flag
        else {
          // our side carries THEIR flag → distance to OUR stand
          const home = (m.flags.find((x) => x.team === 0) || {}).home;
          const d = home && f.pos ? Math.hypot(f.pos[0] - home[0], f.pos[2] - home[2]) : null;
          text = `${esc(cname)}${d != null ? " — " + Math.round(d) + " m TO HOME" : ""}`;
        }
      } else if (state === "DROPPED") {
        cls = "dropped";
        const d = f.pos ? Math.hypot(f.pos[0] - p.pos[0], f.pos[2] - p.pos[2]) : null;
        const cd = f.returnAtT != null ? Math.max(0, Math.ceil(f.returnAtT - now())) : null;
        text = `DROPPED${d != null ? " — " + Math.round(d) + " m" : ""}${cd != null ? " (" + cd + ")" : ""}`;
      }
      html += `<span class="fl ${cls}"><span class="g" style="background:${tint}"></span>` +
        `<span style="color:${tint}">${esc((st.teams && st.teams[f.team] && st.teams[f.team].name) || (mine ? "AMBER" : "SLATE"))}</span> ` +
        `<span style="opacity:.8">${text}</span></span>`;
    }
    flagsEl.innerHTML = html;
  }

  // ------------------------------------------------------------- killfeed
  function onDeath(d) {
    if (!st.active || !d || d.victimActor == null) return;
    const t = now();
    let slot = null;
    for (const r of feedRows) if (!r.live) { slot = r; break; }
    if (!slot) { slot = feedRows[0]; for (const r of feedRows) if (r.t < slot.t) slot = r; }
    slot.live = true; slot.t = t;
    const kA = d.attackerActor, vA = d.victimActor;
    const kBot = actorIsBot(kA), vBot = actorIsBot(vA);
    const kMe = kA === 0, vMe = vA === 0;
    const kHtml = kA == null
      ? `<span style="opacity:.5">—</span>`
      : `<span class="${kMe ? "me" : ""}">${esc(actorName(kA))}</span>${kBot ? `<span class="bg">BOT</span>` : ""}`;
    const vHtml =
      `<span class="${vMe ? "med" : ""}">${esc(actorName(vA))}</span>${vBot ? `<span class="bg">BOT</span>` : ""}`;
    slot.el.innerHTML = kHtml + GLYPH_SVG + vHtml;
    reflow();
  }
  function reflow() {
    const live = feedRows.filter((r) => r.live).sort((a, b) => a.t - b.t);
    for (const r of live) feedEl.appendChild(r.el);
  }
  function tickFeed() {
    const t = now();
    for (const r of feedRows) {
      if (!r.live) { r.el.style.opacity = "0"; continue; }
      if (t - r.t > FEED_TTL) { r.live = false; r.el.style.opacity = "0"; }
      else r.el.style.opacity = "1";
    }
  }

  // ------------------------------------------------------------- centre rail
  function renderCenter() {
    const m = M();
    if (!m) return;
    const t = now();
    const you = m.actors[0];
    // respawn countdown
    if (you && !you.alive && you.respawnAtT >= 0 && m.phase !== "ended") {
      const left = Math.max(0, you.respawnAtT - t);
      respawnEl.innerHTML = `RESPAWN IN <span class="n">${left.toFixed(1)}</span>`;
      respawnEl.style.display = "block";
    } else if (you && !you.alive && m.phase === "overtime") {
      respawnEl.innerHTML = `<span style="opacity:.75">NO RESPAWNS IN OVERTIME</span>`;
      respawnEl.style.display = "block";
    } else respawnEl.style.display = "none";
    // spawn protection
    if (you && you.alive && you.protectedUntilT >= 0 && t < you.protectedUntilT && m.phase !== "warmup") {
      protectEl.textContent = `SPAWN PROTECTION ${Math.max(0, you.protectedUntilT - t).toFixed(1)}s`;
      protectEl.style.display = "block";
    } else protectEl.style.display = "none";
    // teaching line TTL
    teachEl.style.display = t - st.teachT < 2.0 ? "block" : "none";
  }

  // ------------------------------------------------------------- banners
  function setBanner(text, sub, holdS) {
    st.banner = { text, sub: sub || "", untilT: holdS ? now() + holdS : -1 };
    renderBanner();
  }
  function clearBanner() { st.banner = null; renderBanner(); }
  function renderBanner() {
    const m = M();
    // priority: COLLAPSE > PRESSURE > MARKED > transient
    let b = st.banner;
    if (m && m.phase === "overtime" && st.collapse && st.collapse.armed) {
      const p = sim().state.player;
      const c = st.collapse.center || [-5, 0, 0];
      const d = Math.hypot(p.pos[0] - c[0], p.pos[2] - c[2]);
      const out = d > (st.collapse.radius || 12);
      b = {
        text: "COLLAPSE — MOVE TO THE PLAZA",
        sub: out ? `${Math.max(0, d - (st.collapse.radius || 12)).toFixed(0)} m TO THE RING` : "INSIDE THE RING",
        untilT: -1,
      };
    } else if (st.pressure && m && m.modeId === "ctf") {
      b = { text: "PRESSURE", sub: "DEFENDER RESPAWNS SLOWED", untilT: -1 };
    } else if (st.marked && m && m.modeId === "ffa") {
      b = b || { text: "YOU ARE MARKED", sub: "EVERYONE CAN SEE YOU", untilT: -1 };
    }
    if (b && (b.untilT < 0 || now() < b.untilT)) {
      bannerEl.innerHTML = `${esc(b.text)}<div class="sub">${esc(b.sub)}</div>`;
      bannerEl.style.display = "block";
    } else {
      if (st.banner && st.banner.untilT >= 0 && now() >= st.banner.untilT) st.banner = null;
      bannerEl.style.display = "none";
    }
  }

  // ------------------------------------------------------------- warm-up card
  const RULE_LINES = {
    tdm: (r) => [
      `First team to ${r.scoreLimit} kills wins. ${fmtClock(r.timeLimitS)}.`,
      `Respawn in ${r.respawnS} seconds. No friendly fire.`,
      `Assists count on the scoreboard, not on the team score.`,
      `A tie goes to overtime: no respawns — first death loses it for their team.`,
    ],
    ctf: (r) => [
      `First team to ${r.captureLimit} captures wins. ${fmtClock(r.timeLimitS)}.`,
      `Your own flag must be at your stand to score. Take theirs, get it home.`,
      `Carriers can't tac-sprint or throw grenades, and don't regenerate.`,
      `After 8 seconds of carrying, the enemy sees roughly where you are.`,
      `A dropped flag returns in 30 seconds — instantly if a defender touches it.`,
    ],
    ffa: (r) => [
      `First to ${r.scoreLimit} kills wins. ${fmtClock(r.timeLimitS)}. Everyone is hostile.`,
      `Respawn in ${r.respawnS} seconds.`,
      `Reach 15 kills or a 5-kill lead and everyone can see you.`,
    ],
  };
  function renderWarmup() {
    const m = M();
    if (!m || m.phase !== "warmup") { warmEl.style.display = "none"; return; }
    warmEl.style.display = "block";
    const name = { tdm: "SKIRMISH", ctf: "CAPTURE THE FLAG", ffa: "FREE-FOR-ALL" }[m.modeId] || m.modeId;
    warmEl.querySelector(".mode").textContent = name;
    const s = sim();
    const rules = s && s.match && s.match.m ? s.match.m.rules : { scoreLimit: 50, timeLimitS: 480, respawnS: 4, captureLimit: 3 };
    const lines = (RULE_LINES[m.modeId] || RULE_LINES.tdm)(rules);
    warmEl.querySelector(".rules").innerHTML = lines.map(esc).join("<br>");
    warmEl.querySelector(".count").textContent = String(Math.max(1, Math.ceil(m.timeLeft)));
  }

  // ------------------------------------------------------------- result
  function onMissionEnd(d) {
    if (!st.active || !d || !d.match) return;
    st.resultShown = true;
    const r = d.match.result; // 'win' | 'draw' | 'forfeit'
    const winner = d.match.winnerTeam;
    const h1 = resultEl.querySelector("h1"), why = resultEl.querySelector(".why");
    let text, cls = "";
    if (r === "draw") { text = "DRAW"; cls = "draw"; }
    else if (r === "forfeit" && winner !== 0) { text = "FORFEIT"; cls = "lost"; }
    else if (winner === 0) text = "VICTORY";
    else { text = "DEFEAT"; cls = "lost"; }
    h1.textContent = text;
    h1.className = cls;
    const m = M();
    const reason = (m && m.result && m.result.reason) || "";
    why.textContent = reason ? reason.toUpperCase() : "";
    resultEl.style.display = "block";
    warmEl.style.display = "none";
    respawnEl.style.display = "none";
    protectEl.style.display = "none";
    bannerEl.style.display = "none";
    // the end-of-match scoreboard (scoreboard.js) takes over 3 s later and
    // hides this banner itself via shell handoff (modes.md §6.1).
  }

  // ------------------------------------------------------------- pips
  function renderPips() {
    const m = M();
    const s = sim();
    if (!m || !s || m.modeId === "ffa" || m.phase === "ended") { // §7.4: no pips in FFA
      for (const p of pips) p.style.display = "none";
      return;
    }
    const cam = ctx.camera, TH = ctx.THREE;
    if (!cam || !TH) { for (const p of pips) p.style.display = "none"; return; }
    const pl = s.state.player;
    let i = 0;
    const v = new TH.Vector3();
    for (const b of s.state.bots) {
      if (i >= pips.length) break;
      if (!b.alive || b.team !== 0) continue;
      const d = Math.hypot(b.pos[0] - pl.pos[0], b.pos[2] - pl.pos[2]);
      if (d > 40) continue;
      v.set(b.pos[0], b.pos[1] + 2.05, b.pos[2]).project(cam);
      if (v.z > 1 || v.z < -1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      const a = m.actors[b.actorId];
      const p = pips[i++];
      p.textContent = a ? a.name : "";
      p.style.left = ((v.x * 0.5 + 0.5) * 100).toFixed(2) + "%";
      p.style.top = ((-v.y * 0.5 + 0.5) * 100).toFixed(2) + "%";
      p.style.display = "block";
    }
    for (; i < pips.length; i++) pips[i].style.display = "none";
  }

  // ------------------------------------------------------------- lifecycle
  function onMatchStart(d) {
    st.active = true;
    st.modeId = d && d.mode;
    st.teams = d && d.teams;
    st.banner = null; st.teachT = -9; st.teachLastT = -9;
    st.marked = false; st.collapse = null; st.pressure = false; st.resultShown = false;
    for (const r of feedRows) { r.live = false; r.el.style.opacity = "0"; }
    resultEl.style.display = "none";
    root.style.display = "block";
    document.body.classList.add("match-live");
    refresh();
  }
  function onMatchState(d) {
    if (!st.active) return;
    if (d && d.phase === "overtime") {
      const m = M();
      setBanner("OVERTIME", m && m.modeId === "ffa"
        ? "NO RESPAWNS — LAST LEADER STANDING" : "NO RESPAWNS — FIRST DEATH LOSES", 4.0);
    }
    refresh();
  }
  function onFlag(d) {
    if (!st.active || !d) return;
    if (d.state === "captureBlocked") {
      const t = now();
      if (t - st.teachLastT >= 3.0) { // rate-limited once per 3 s (§7.3)
        st.teachLastT = t; st.teachT = t;
        teachEl.textContent = "RETURN YOUR FLAG TO CAPTURE";
      }
    }
    renderFlags();
  }
  function onPressure(d) { st.pressure = !!(d && d.on); renderBanner(); }
  function onCollapse(d) { st.collapse = d || null; renderBanner(); }
  function onLeaderMark(d) {
    if (!st.active || !d) return;
    if (d.actorId === 0) {
      st.marked = !!d.on;
      if (d.on) setBanner("YOU ARE MARKED", "EVERYONE CAN SEE YOU", 4.0);
      else clearBanner();
    }
    renderBanner();
  }

  function refresh() {
    if (!st.active) return;
    const m = M();
    if (!m) return;
    renderScore(); renderClock(); renderFlags(); renderCenter();
    renderWarmup(); renderBanner(); tickFeed();
  }

  // self-driving tick: interval survives hidden tabs; pips ride rAF only
  // (they are cosmetic and camera-relative).
  setInterval(() => { if (st.active) refresh(); }, 150);
  (function pipLoop() {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(pipLoop);
      if (st.active) renderPips();
    }
  })();

  const matchHud = {
    attach(bridge) {
      bridge.register("match:start", onMatchStart);
      bridge.register("match:state", onMatchState);
      bridge.register("match:score", () => { if (st.active) renderScore(); });
      bridge.register("death", onDeath);
      bridge.register("respawn", () => { if (st.active) renderCenter(); });
      bridge.register("flag", onFlag);
      bridge.register("pressure", onPressure);
      bridge.register("collapse", onCollapse);
      bridge.register("leaderMark", onLeaderMark);
      bridge.register("mission:end", onMissionEnd);
    },
    // shell handoff: scoreboard.js hides the result banner when the end board
    // opens; menu return hides the whole layer.
    hideResult() { resultEl.style.display = "none"; },
    hide() {
      st.active = false;
      root.style.display = "none";
      document.body.classList.remove("match-live");
      for (const p of pips) p.style.display = "none";
    },
    get active() { return st.active; },
    _root: root,
  };
  return matchHud;
}

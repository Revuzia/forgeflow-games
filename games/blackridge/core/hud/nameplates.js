// core/hud/nameplates.js [identity lane] — floating callsigns over operators.
// One pooled DOM layer inside the HUD root (so it hides with the HUD and with
// the kill cam's `body.kc-on #hud > *` rule), ≤ 10 nodes, transform-only
// writes, LOS re-tested round-robin at ~8 Hz per body: well under 0.1 ms/frame.
//
// Rules:
//   teammates  name + small health pip, in the team colour from the settings
//              palette (colour-blind aware), shown with line of sight inside
//              MAX_D; alpha fades with distance (FULL_D → MAX_D) and when you
//              aim away from them (≤ AIM_FULL_DEG full → ≥ AIM_DIM_DEG dimmed)
//   enemies    hidden — except the NAME (no health) while your crosshair is
//              directly on one within ENEMY_D with line of sight, held for
//              ENEMY_HOLD_S after you come off them (CoD style)
//   FFA        no teammates; the enemy rule only
// Pure helpers (plateAlpha, onCrosshair) are exported for the selftest.

import { teamHex } from "../team_color.js";
import { actorOfWho } from "./callouts.js";

export const NP = {
  MAX_D: 60, FULL_D: 22, AIM_FULL_DEG: 8, AIM_DIM_DEG: 32, AIM_DIM_ALPHA: 0.35,
  ENEMY_D: 32, ENEMY_HOLD_S: 0.6, LOS_HZ: 8, HEAD_Y: 2.05, CROUCH_Y: 1.5,
};

/** teammate plate alpha from distance (m) and off-crosshair angle (deg) */
export function plateAlpha(dist, offDeg) {
  if (!(dist <= NP.MAX_D)) return 0;
  const dk = dist <= NP.FULL_D ? 1 : 1 - (dist - NP.FULL_D) / (NP.MAX_D - NP.FULL_D);
  let ak = 1;
  if (offDeg > NP.AIM_FULL_DEG) {
    const u = Math.min(1, (offDeg - NP.AIM_FULL_DEG) / (NP.AIM_DIM_DEG - NP.AIM_FULL_DEG));
    ak = 1 - u * (1 - NP.AIM_DIM_ALPHA);
  }
  return Math.max(0, Math.min(1, dk * ak));
}
/** is a body (≈0.45 m radius chest) under the crosshair at this distance? */
export function onCrosshair(dist, offDeg) {
  if (!(dist <= NP.ENEMY_D) || dist < 0.5) return false;
  const halfDeg = Math.atan2(0.45, dist) * 180 / Math.PI;
  return offDeg <= Math.max(1.2, halfDeg);
}

const CSS = `
#np-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;}
#np-layer .np{position:absolute;left:0;top:0;transform:translate3d(-999px,-999px,0);
  display:none;flex-direction:column;align-items:center;will-change:transform,opacity;
  font:700 11px/1 "Rajdhani","Segoe UI",system-ui,sans-serif;letter-spacing:.08em;
  text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.7);white-space:nowrap;}
#np-layer .np-p{margin-top:3px;width:28px;height:3px;background:rgba(0,0,0,.55);border-radius:1px;overflow:hidden;}
#np-layer .np-p i{display:block;height:100%;width:100%;background:currentColor;transform-origin:0 50%;}
body.kc-on #np-layer,body.board-open #np-layer{visibility:hidden}
`;

function palette(sim) {
  const m = sim && sim.state && sim.state.match;
  const teams = m && m.teams;
  return { friend: teamHex(0, teams), enemy: teamHex(1, teams) }; // core/team_color.js
}

export function createNameplates(ctx, deps = {}) {
  const hud = deps.hud || ctx.hud || null;
  const getSim = () => (typeof ctx.sim === "function" ? ctx.sim() : ctx.sim) || null;
  if (typeof document === "undefined" || !ctx.THREE || !ctx.camera) {
    return { update() {}, stats: () => ({ disabled: true }) };
  }
  const THREE = ctx.THREE;
  if (!document.getElementById("np-css")) {
    const st = document.createElement("style");
    st.id = "np-css"; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const layer = document.createElement("div");
  layer.id = "np-layer";
  ((hud && hud._root) || document.body).appendChild(layer);

  const pool = [];
  function node(i) {
    while (pool.length <= i) {
      const el = document.createElement("div");
      el.className = "np";
      const nm = document.createElement("span");
      const pip = document.createElement("div"); pip.className = "np-p";
      const bar = document.createElement("i"); pip.appendChild(bar);
      el.appendChild(nm); el.appendChild(pip);
      layer.appendChild(el);
      pool.push({ el, nm, pip, bar, shown: false, name: "", color: "", hp: -1, op: -1, x: -1, y: -1, pipOn: true });
    }
    return pool[i];
  }
  const v3 = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const los = new Map();       // botId → {vis, at}
  const enemyHold = new Map(); // botId → until (wall s)
  let losCursor = 0;
  const st = { frames: 0, lastMs: 0, avgMs: 0, totalMs: 0, meanMs: 0, plates: 0, enemyNames: 0, losChecks: 0 };
  const perfNow = () => (globalThis.performance ? performance.now() : Date.now());

  function hideFrom(i) {
    for (let j = i; j < pool.length; j++) if (pool[j].shown) { pool[j].el.style.display = "none"; pool[j].shown = false; }
  }

  function update() {
    const t0 = perfNow();
    const sim = getSim();
    const S = sim && sim.state;
    const P = S && S.player;
    const m = sim && sim.match;
    let used = 0;
    if (!S || !P || !m || !S.match || (hud && hud._root && hud._root.style.display === "none")) { hideFrom(0); return; }
    const cam = ctx.camera;
    // window size, not layer.clientWidth: reading layout after last frame's
    // transform writes would force a synchronous reflow every frame
    const W = window.innerWidth, H = window.innerHeight;
    cam.getWorldDirection(fwd);
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const pal = palette(sim);
    const ffa = S.match.modeId === "ffa";
    const bots = S.bots;
    const now = perfNow() / 1000;
    // LOS budget: ≈ LOS_HZ per body (one or two rays a frame at 60 fps)
    const rays = Math.max(1, Math.ceil(bots.length * NP.LOS_HZ / 60));
    for (let r = 0; r < rays && bots.length; r++) {
      const b = bots[(losCursor++) % bots.length];
      if (!b || !b.alive) continue;
      const head = [b.pos[0], b.pos[1] + (b.stance === "crouch" ? NP.CROUCH_Y : NP.HEAD_Y) - 0.35, b.pos[2]];
      let vis = true;
      try { vis = !sim.world.losBlocked([cx, cy, cz], head); } catch (_) { vis = true; }
      los.set(b.id, vis);
      st.losChecks++;
    }
    let enemies = 0;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b || !b.alive) continue;
      const a = actorOfWho(sim, b.id);
      if (!a || !a.name) continue;
      const mate = !ffa && a.team === P.team;
      const hy = b.pos[1] + (b.stance === "crouch" ? NP.CROUCH_Y : NP.HEAD_Y);
      const dx = b.pos[0] - cx, dy = hy - 0.5 - cy, dz = b.pos[2] - cz;
      const dist = Math.hypot(dx, dy, dz);
      const off = Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (dist || 1)))) * 180 / Math.PI;
      const vis = los.has(b.id) ? los.get(b.id) : false;
      let alpha = 0, color = pal.friend, pipOn = true;
      if (mate) {
        if (vis) alpha = plateAlpha(dist, off);
      } else {
        // enemy: the chest, not the plate point
        const ex = b.pos[0] - cx, ey = b.pos[1] + 1.2 - cy, ez = b.pos[2] - cz;
        const ed = Math.hypot(ex, ey, ez);
        const eo = Math.acos(Math.max(-1, Math.min(1, (ex * fwd.x + ey * fwd.y + ez * fwd.z) / (ed || 1)))) * 180 / Math.PI;
        if (vis && onCrosshair(ed, eo)) enemyHold.set(b.id, now + NP.ENEMY_HOLD_S);
        const hold = enemyHold.get(b.id);
        if (hold != null && now < hold && ed <= NP.ENEMY_D + 4) { alpha = 0.95; enemies++; }
        color = pal.enemy; pipOn = false;
      }
      if (alpha <= 0.02) continue;
      v3.set(b.pos[0], hy, b.pos[2]).project(cam);
      if (v3.z > 1 || v3.z < -1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) continue;
      const x = Math.round((v3.x * 0.5 + 0.5) * W), y = Math.round((-v3.y * 0.5 + 0.5) * H);
      const n = node(used++);
      if (!n.shown) { n.el.style.display = "flex"; n.shown = true; }
      if (n.name !== a.name) { n.nm.textContent = a.name; n.name = a.name; }
      if (n.color !== color) { n.el.style.color = color; n.color = color; }
      if (n.pipOn !== pipOn) { n.pip.style.display = pipOn ? "block" : "none"; n.pipOn = pipOn; }
      const hp = Math.max(0, Math.min(100, Math.round(b.hp)));
      if (pipOn && n.hp !== hp) { n.bar.style.transform = `scaleX(${hp / 100})`; n.hp = hp; }
      const op = Math.round(alpha * 100) / 100;
      if (n.op !== op) { n.el.style.opacity = String(op); n.op = op; }
      if (n.x !== x || n.y !== y) { n.el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`; n.x = x; n.y = y; }
    }
    hideFrom(used);
    st.plates = used; st.enemyNames = enemies;
    st.frames++;
    st.lastMs = perfNow() - t0;
    st.avgMs = st.avgMs * 0.95 + st.lastMs * 0.05;
    st.totalMs += st.lastMs; st.meanMs = st.totalMs / st.frames;
  }

  return {
    update,
    stats: () => Object.assign({}, st, { pool: pool.length }),
    _layer: layer,
  };
}

/**
 * FFG runtime — 3d/ffg_backgammon3d.js  (ES module)
 * BACKGAMMON in clean 3D on the ffg_kernel_3d substrate. Carved ivory & charcoal
 * checkers on a warm walnut board; the FULL standard ruleset — real two-dice rolls
 * (doubles = four moves), a lone blot can be hit and sent to the BAR (must re-enter
 * before any other move), and once all fifteen are home you bear off to win. You may
 * only leave a point empty by playing dice, and you must use as many dice as legally
 * possible (the higher die when only one can be played). Single-player vs a heuristic
 * AI (four skill levels). Calm, unhurried presentation. Registers genre "backgammon3d".
 */
import * as THREE from "three";
import { createClassicalMusic } from "./ffg_boardmusic.js";
const _V = new URL(import.meta.url).search;
const { register3d } = await import("./ffg_kernel_3d.js" + _V);

// ── board geometry (world units) ─────────────────────────────────────────────
const COL = 3.2;                 // spacing between adjacent point columns
const TRI_W = COL * 0.84;        // triangle base width
const TRI_LEN = 11.0;            // triangle (point) length inward
const ZEDGE = 12.6;              // half-depth: bottom edge at +ZEDGE, top at -ZEDGE
const CH_R = 1.15, CH_H = 0.55;  // checker disc radius / thickness
const FELT_Y = 0;                // top of the playing felt
const DISC_Y = FELT_Y + CH_H / 2 + 0.06;
const BAR_TOP_Y = 0.55, BAR_DISC_Y = BAR_TOP_Y + CH_H / 2 + 0.04;
const BAR_W = COL * 1.1;
const BWH = 6 * COL + COL * 0.7; // board half-width to inner frame (~21.5)
const TRAY_X = BWH + 2.9;        // bear-off trays sit just right of the frame
const OFF_Z_W = ZEDGE * 0.42, OFF_Z_B = -ZEDGE * 0.42;

function shade(hex, f) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
  const c = (v) => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
function makeSky(top, bot) {
  const cv = document.createElement("canvas"); cv.width = 8; cv.height = 256;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#" + top.toString(16).padStart(6, "0"));
  g.addColorStop(1, "#" + bot.toString(16).padStart(6, "0"));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// premium casino-table theme — warm dark ambiance, deep-green felt, gold trim
const THEME = {
  sky_top: 0x241a12, sky_bot: 0x0e0905,             // warm dark casino ambiance — makes the lit board pop
  felt: 0x1a6b3e, frame: 0x3a2414, frameRim: 0x6b4a2e,   // rich deep-green felt + dark casino wood
  tri_a: 0xe4d8bc, tri_b: 0x8a2f2a,     // warm ivory vs rich crimson points
  bar: 0x33200f, tray: 0x241610,
  fog: 0x120c07, fogD: 0.0055,
  key: 0xffe9c4, keyI: 2.4, hemiSky: 0x705e46, hemiGround: 0x241a12, hemiI: 0.5, ambI: 0.24, exposure: 1.06,
  rim: 0xbfd2ff, rimI: 0.55, env: 0.4,
  spot: 0xfff1d6, spotI: 6.0,                        // warm overhead spotlight pooling on the board
  gold: 0xd8b348,                                    // rich gold trim
};
const SIDE_COL = { w: 0xf3ecd6, b: 0x22201a };      // glossy ivory vs ebony checkers
const SIDE_NAME = { w: "Ivory", b: "Slate" };

// index -> board slot. Bottom edge (near, +Z) holds indices 0..11; top (far, -Z) 12..23.
// White travels 23 -> 0 (bears off at bottom-right home 0..5); Black travels 0 -> 23
// (bears off at top-right home 18..23). Layout forms the standard horseshoe path.
function pointLayout(i) {
  const bottom = i < 12;
  const slot = bottom ? (11 - i) : (i - 12);   // 0..11 left->right along the edge
  const xUnit = slot < 6 ? slot : slot + 1;    // insert a unit for the central bar gap
  const x = (xUnit - 6) * COL;
  const baseZ = bottom ? ZEDGE : -ZEDGE;
  const dir = bottom ? -1 : 1;                  // inward direction (toward center)
  return { x, baseZ, dir };
}
const POINTS = [];
for (let i = 0; i < 24; i++) POINTS.push(pointLayout(i));

register3d("backgammon3d", async (kernel, content) => {
  const scene = kernel.scene;
  const music = createClassicalMusic(0.15);
  const maxAniso = (kernel.renderer.capabilities && kernel.renderer.capabilities.getMaxAnisotropy) ? kernel.renderer.capabilities.getMaxAnisotropy() : 1;

  // ── environment (premium casino table — warm dark ambiance, pooled spotlight) ──
  scene.background = makeSky(THEME.sky_top, THEME.sky_bot);
  if (kernel.setEnvironment) kernel.setEnvironment(scene.background, THEME.env);
  scene.fog = new THREE.FogExp2(THEME.fog, THEME.fogD);
  if (kernel.sun) { kernel.sun.color = new THREE.Color(THEME.key); kernel.sun.intensity = THEME.keyI; kernel.sun.position.set(BWH * 0.5, ZEDGE * 3.0, ZEDGE * 1.2); }
  scene.add(new THREE.HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiI));
  scene.add(new THREE.AmbientLight(0xffffff, THEME.ambI));
  { const rim = new THREE.DirectionalLight(THEME.rim, THEME.rimI); rim.position.set(-BWH * 0.5, ZEDGE * 1.6, -ZEDGE * 1.7); scene.add(rim); }  // cool back-rim: edge sheen + separation
  { const spot = new THREE.SpotLight(THEME.spot, THEME.spotI, 0, Math.PI * 0.33, 0.62, 1.1); spot.position.set(0, 27, 3); spot.target.position.set(0, 0, 0.4); scene.add(spot.target); scene.add(spot); }  // warm spotlight pooling on the felt — the casino-table look
  kernel.renderer.toneMappingExposure = THEME.exposure;
  // AO (contact shadows) grounds the checkers on the felt — the biggest not-flat-lit jump
  if (kernel.enableBloom) kernel.enableBloom({ ssao: true, ssaoRadius: 0.9, ssaoMin: 0.002, ssaoMax: 0.07, strength: 0.2, radius: 0.6, threshold: 0.86 });

  // ══════════════════════════════════════════════════════════════════════════
  //  BACKGAMMON SIM  (pure logic — no views)
  //  state.pts[24] : signed count (+ = White/'w', - = Black/'b'); magnitude = checkers
  //  state.bar {w,b} : checkers on the bar   ·   state.off {w,b} : borne off
  //  White moves high index -> low (i-d), home = 0..5, enters on 24-d (18..23).
  //  Black moves low  index -> high (i+d), home = 18..23, enters on d-1 (0..5).
  // ══════════════════════════════════════════════════════════════════════════
  const other = (s) => (s === "w" ? "b" : "w");
  function newState() {
    const pts = new Array(24).fill(0);
    pts[0] = -2; pts[5] = 5; pts[7] = 3; pts[11] = -5;
    pts[12] = 5; pts[16] = -3; pts[18] = -5; pts[23] = 2;
    return { pts, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 } };
  }
  function cloneState(s) { return { pts: s.pts.slice(), bar: { w: s.bar.w, b: s.bar.b }, off: { w: s.off.w, b: s.off.b } }; }
  function allHome(s, side) {
    if (s.bar[side] > 0) return false;
    if (side === "w") { for (let i = 6; i < 24; i++) if (s.pts[i] > 0) return false; }
    else { for (let i = 0; i < 18; i++) if (s.pts[i] < 0) return false; }
    return true;
  }
  const whiteHigher = (s, i) => { for (let j = i + 1; j <= 5; j++) if (s.pts[j] > 0) return true; return false; };
  const blackHigher = (s, i) => { for (let j = 18; j <= i - 1; j++) if (s.pts[j] < 0) return true; return false; };

  // all legal single-die moves for `side` with die value d
  function singleMoves(s, side, d) {
    const sgn = side === "w" ? 1 : -1; const out = [];
    if (s.bar[side] > 0) {                       // forced re-entry from the bar
      const t = side === "w" ? 24 - d : d - 1;
      if (t >= 0 && t <= 23 && s.pts[t] * sgn >= -1) out.push({ from: "bar", to: t, hit: s.pts[t] * sgn === -1, die: d });
      return out;
    }
    const home = allHome(s, side);
    for (let i = 0; i < 24; i++) {
      if (s.pts[i] * sgn < 1) continue;          // need an own checker here
      if (side === "w") {
        const t = i - d;
        if (t >= 0) { if (s.pts[t] * sgn >= -1) out.push({ from: i, to: t, hit: s.pts[t] * sgn === -1, die: d }); }
        else if (home) { if (i - d === -1 || (i - d < -1 && !whiteHigher(s, i))) out.push({ from: i, to: "off", hit: false, die: d }); }
      } else {
        const t = i + d;
        if (t <= 23) { if (s.pts[t] * sgn >= -1) out.push({ from: i, to: t, hit: s.pts[t] * sgn === -1, die: d }); }
        else if (home) { if (i + d === 24 || (i + d > 24 && !blackHigher(s, i))) out.push({ from: i, to: "off", hit: false, die: d }); }
      }
    }
    return out;
  }
  function applyMove(s, side, mv) {
    const sgn = side === "w" ? 1 : -1;
    if (mv.from === "bar") s.bar[side]--; else s.pts[mv.from] -= sgn;
    if (mv.to === "off") { s.off[side]++; return; }
    if (mv.hit) { s.pts[mv.to] = 0; s.bar[other(side)]++; }
    s.pts[mv.to] += sgn;
  }
  const removeDie = (dl, d) => { const a = dl.slice(); a.splice(a.indexOf(d), 1); return a; };
  // maximum number of dice `side` can legally consume from dice-list dl (depth <= 4)
  function maxDice(s, side, dl) {
    if (!dl.length) return 0;
    let best = 0; const tried = new Set();
    for (const d of dl) {
      if (tried.has(d)) continue; tried.add(d);
      const ms = singleMoves(s, side, d);
      for (const mv of ms) {
        const ns = cloneState(s); applyMove(ns, side, mv);
        const sub = 1 + maxDice(ns, side, removeDie(dl, d));
        if (sub > best) best = sub;
        if (best >= dl.length) return best;
      }
    }
    return best;
  }
  // legal moves the player may play NOW: those that keep a maximum-length turn
  // possible, plus the "must play the higher die" rule when only one is playable.
  function offeredMoves(s, side, dl, isFirst, rolledPair) {
    const curMax = maxDice(s, side, dl);
    if (curMax === 0) return [];
    let out = []; const tried = new Set();
    for (const d of dl) {
      if (tried.has(d)) continue; tried.add(d);
      for (const mv of singleMoves(s, side, d)) {
        const ns = cloneState(s); applyMove(ns, side, mv);
        if (1 + maxDice(ns, side, removeDie(dl, d)) === curMax) out.push(mv);
      }
    }
    if (isFirst && rolledPair && rolledPair.length === 2 && rolledPair[0] !== rolledPair[1] && curMax === 1) {
      const hi = Math.max(rolledPair[0], rolledPair[1]);
      if (out.some((m) => m.die === hi)) out = out.filter((m) => m.die === hi);
    }
    return out;
  }

  // ── heuristic evaluation (from `side` perspective; higher = better) ──
  function pipCount(s, side) {
    const sgn = side === "w" ? 1 : -1; let p = s.bar[side] * 25;
    for (let i = 0; i < 24; i++) { const c = s.pts[i] * sgn; if (c > 0) p += c * (side === "w" ? (i + 1) : (24 - i)); }
    return p;
  }
  function hitRisk(s, side, i) {
    let risk = 0;
    if (side === "w") { for (let j = Math.max(0, i - 6); j < i; j++) if (s.pts[j] < 0) risk++; if (i <= 5 && s.bar.b > 0) risk++; }
    else { for (let j = i + 1; j <= Math.min(23, i + 6); j++) if (s.pts[j] > 0) risk++; if (i >= 18 && s.bar.w > 0) risk++; }
    return Math.min(risk, 3);
  }
  function evalBoard(s, side) {
    const opp = other(side), sgn = side === "w" ? 1 : -1;
    let score = (pipCount(s, opp) - pipCount(s, side)) * 1.0;
    score += (s.off[side] - s.off[opp]) * 12;
    score -= s.bar[side] * 18; score += s.bar[opp] * 14;
    for (let i = 0; i < 24; i++) {
      const c = s.pts[i] * sgn;
      if (c === 1) { score -= 6 + hitRisk(s, side, i) * 4; }
      else if (c >= 2) { score += 1.3 + ((side === "w" ? i <= 5 : i >= 18) ? 1.5 : 0); }
    }
    return score;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  VIEWS
  // ══════════════════════════════════════════════════════════════════════════
  const pointStacks = Array.from({ length: 24 }, () => []);
  const barStacks = { w: [], b: [] }, offStacks = { w: [], b: [] };

  const DISC_MAT = {
    w: new THREE.MeshStandardMaterial({ color: SIDE_COL.w, roughness: 0.2, metalness: 0.04, envMapIntensity: 0.85 }),
    b: new THREE.MeshStandardMaterial({ color: SIDE_COL.b, roughness: 0.2, metalness: 0.14, envMapIntensity: 0.6 }),
  };
  const discGeo = new THREE.CylinderGeometry(CH_R, CH_R * 1.02, CH_H, 40);
  const ridgeGeo = new THREE.TorusGeometry(CH_R * 0.74, CH_R * 0.09, 8, 36);
  function buildDisc(side) {
    const g = new THREE.Group(); const mat = DISC_MAT[side];
    const d = new THREE.Mesh(discGeo, mat); d.castShadow = true; d.receiveShadow = true; g.add(d);
    const ridge = new THREE.Mesh(ridgeGeo, mat); ridge.rotation.x = Math.PI / 2; ridge.position.y = CH_H * 0.5; g.add(ridge);
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(CH_R * 0.4, CH_R * 0.05, 8, 28),
      new THREE.MeshStandardMaterial({ color: shade(SIDE_COL[side], side === "w" ? -0.25 : 0.4), roughness: 0.5, metalness: 0.2 }));
    inlay.rotation.x = Math.PI / 2; inlay.position.y = CH_H * 0.5 + 0.01; g.add(inlay);
    g.userData.side = side; return g;
  }

  // ── procedural surface textures: fabric weave + wood grain = tactile, not flat-colored ──
  function feltTex() {
    const s = 512, cv = document.createElement("canvas"); cv.width = cv.height = s; const ctx = cv.getContext("2d");
    ctx.fillStyle = "#" + THEME.felt.toString(16).padStart(6, "0"); ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    ctx.globalAlpha = 0.06; ctx.strokeStyle = "#000";
    for (let x = 0; x < s; x += 3) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    ctx.globalAlpha = 0.045; ctx.strokeStyle = "#dfeee6";
    for (let y = 0; y < s; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 5); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t;
  }
  function woodTex(base) {
    const s = 512, cv = document.createElement("canvas"); cv.width = cv.height = s; const ctx = cv.getContext("2d");
    ctx.fillStyle = "#" + base.toString(16).padStart(6, "0"); ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * s, dark = Math.random() < 0.55;
      ctx.strokeStyle = dark ? "rgba(0,0,0,0.15)" : "rgba(255,228,196,0.07)"; ctx.lineWidth = 0.6 + Math.random() * 2.6;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 14) ctx.lineTo(x, y + Math.sin(x * 0.018 + i) * 3.5 + (Math.random() - 0.5) * 2.4);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t;
  }

  // board
  (function buildBoard() {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(BWH * 2 + COL * 1.4, 0.9, ZEDGE * 2 + COL * 1.0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(shade(THEME.frame, -0.25)), roughness: 0.55, metalness: 0.12, envMapIntensity: 0.3 }));
    plinth.position.set(0, -0.45, 0); plinth.receiveShadow = true; scene.add(plinth);
    const felt = new THREE.Mesh(new THREE.BoxGeometry(BWH * 2, 0.16, ZEDGE * 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: feltTex(), emissive: new THREE.Color(THEME.felt).multiplyScalar(0.05), roughness: 0.78, metalness: 0.0, envMapIntensity: 0.3 }));
    felt.position.set(0, FELT_Y - 0.08, 0); felt.receiveShadow = true; scene.add(felt);
    // outer frame rails
    const railMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(THEME.frame), roughness: 0.34, metalness: 0.2, envMapIntensity: 0.45 });
    const railLR = new THREE.BoxGeometry(COL * 0.9, 0.7, ZEDGE * 2 + COL * 1.0);
    const railTB = new THREE.BoxGeometry(BWH * 2 + COL * 1.4, 0.7, COL * 0.9);
    for (const x of [-(BWH + COL * 0.25), BWH + COL * 0.25]) { const m = new THREE.Mesh(railLR, railMat); m.position.set(x, 0.1, 0); m.receiveShadow = true; scene.add(m); }
    for (const z of [-(ZEDGE + COL * 0.25), ZEDGE + COL * 0.25]) { const m = new THREE.Mesh(railTB, railMat); m.position.set(0, 0.1, z); m.receiveShadow = true; scene.add(m); }
    // central bar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, BAR_TOP_Y + 0.4, ZEDGE * 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(THEME.bar), roughness: 0.4, metalness: 0.18, envMapIntensity: 0.4 }));
    bar.position.set(0, (BAR_TOP_Y - 0.1) / 1, 0); bar.receiveShadow = true; bar.castShadow = true; scene.add(bar);
    // triangles (points) + transparent click pads
    const matA = new THREE.MeshStandardMaterial({ color: THEME.tri_a, roughness: 0.66, metalness: 0.04, side: THREE.DoubleSide, envMapIntensity: 0.28 });
    const matB = new THREE.MeshStandardMaterial({ color: THEME.tri_b, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.3 });
    for (let i = 0; i < 24; i++) {
      const P = POINTS[i]; const w = TRI_W / 2, L = TRI_LEN * P.dir;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-w, 0, 0, w, 0, 0, 0, 0, L]), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
      g.computeBoundingSphere();
      const slot = i < 12 ? (11 - i) : (i - 12);
      const tri = new THREE.Mesh(g, (slot % 2 === (i < 12 ? 0 : 1)) ? matA.clone() : matB.clone());
      tri.position.set(P.x, FELT_Y + 0.02, P.baseZ); tri.receiveShadow = true; scene.add(tri);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(TRI_W, 0.4, TRI_LEN),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      pad.position.set(P.x, FELT_Y + 0.2, P.baseZ + P.dir * TRI_LEN / 2); pad.userData.point = i; scene.add(pad);
    }
    const barPad = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, 0.6, ZEDGE * 1.6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    barPad.position.set(0, BAR_TOP_Y + 0.2, 0); barPad.userData.bar = true; scene.add(barPad);
    // bear-off trays
    const trayMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(THEME.tray), roughness: 0.5, metalness: 0.14, envMapIntensity: 0.35 });
    for (const z of [OFF_Z_W, OFF_Z_B]) {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(COL * 1.6, 0.5, ZEDGE * 0.8), trayMat);
      tray.position.set(TRAY_X, 0, z); tray.receiveShadow = true; scene.add(tray);
    }
    // warm wooden floor beneath the board — grounds the scene into a room receding into fog
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(0x241811), roughness: 0.82, metalness: 0.0, envMapIntensity: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -1.5, 0); floor.receiveShadow = true; scene.add(floor);
    // gold inlaid border framing the felt — premium casino trim that glints under the spotlight
    const goldMat = new THREE.MeshStandardMaterial({ color: THEME.gold, roughness: 0.26, metalness: 0.92, envMapIntensity: 1.1 });
    const iw = BWH * 2, idp = ZEDGE * 2, gt = 0.24, gy = FELT_Y + 0.06;
    for (const [w, dp, x, z] of [[iw + gt, gt, 0, idp / 2], [iw + gt, gt, 0, -idp / 2], [gt, idp - gt, iw / 2, 0], [gt, idp - gt, -iw / 2, 0]]) {
      const gbar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, dp), goldMat); gbar.position.set(x, gy, z); gbar.castShadow = true; scene.add(gbar);
    }
    // gold caps along the central bar edges
    for (const bx of [-BAR_W / 2, BAR_W / 2]) {
      const gcap = new THREE.Mesh(new THREE.BoxGeometry(gt, 0.06, idp), goldMat); gcap.position.set(bx, BAR_TOP_Y + 0.35, 0); gcap.castShadow = true; scene.add(gcap);
    }
  })();

  // slot positions
  function pointSlotPos(i, k, n) {
    const P = POINTS[i]; const usable = TRI_LEN - CH_R * 1.4;
    const step = n > 1 ? Math.min(CH_R * 1.85, usable / (n - 1)) : 0;
    return new THREE.Vector3(P.x, DISC_Y, P.baseZ + P.dir * (CH_R * 1.1 + k * step));
  }
  const barSlotPos = (side, k) => new THREE.Vector3(0, BAR_DISC_Y, (side === "w" ? 1 : -1) * (2.0 + k * CH_R * 1.7));
  const offSlotPos = (side, k) => new THREE.Vector3(TRAY_X, DISC_Y + k * CH_H * 0.92, side === "w" ? OFF_Z_W : OFF_Z_B);
  function layoutPoint(i) { const st = pointStacks[i]; for (let k = 0; k < st.length; k++) st[k].position.copy(pointSlotPos(i, k, st.length)); }
  function layoutBar(side) { const st = barStacks[side]; for (let k = 0; k < st.length; k++) st[k].position.copy(barSlotPos(side, k)); }
  function layoutOff(side) { const st = offStacks[side]; for (let k = 0; k < st.length; k++) st[k].position.copy(offSlotPos(side, k)); }

  function clearAllDiscs() {
    for (let i = 0; i < 24; i++) { for (const d of pointStacks[i]) scene.remove(d); pointStacks[i].length = 0; }
    for (const s of ["w", "b"]) { for (const d of barStacks[s]) scene.remove(d); barStacks[s].length = 0; for (const d of offStacks[s]) scene.remove(d); offStacks[s].length = 0; }
  }
  function resetCheckers() {
    clearAllDiscs();
    for (let i = 0; i < 24; i++) {
      const v = state.pts[i]; if (!v) continue; const side = v > 0 ? "w" : "b"; const n = Math.abs(v);
      for (let k = 0; k < n; k++) { const d = buildDisc(side); scene.add(d); pointStacks[i].push(d); }
      layoutPoint(i);
    }
  }

  // ── dice tokens ──
  const diceGroup = new THREE.Group(); diceGroup.visible = false; scene.add(diceGroup);
  const PIP = {
    1: [[0, 0]], 2: [[-.25, -.25], [.25, .25]], 3: [[-.28, -.28], [0, 0], [.28, .28]],
    4: [[-.25, -.25], [.25, -.25], [-.25, .25], [.25, .25]],
    5: [[-.26, -.26], [.26, -.26], [0, 0], [-.26, .26], [.26, .26]],
    6: [[-.26, -.28], [.26, -.28], [-.26, 0], [.26, 0], [-.26, .28], [.26, .28]],
  };
  const DIE_SZ = 1.7;
  function buildDie(value, used) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(DIE_SZ, DIE_SZ, DIE_SZ),
      new THREE.MeshStandardMaterial({ color: used ? 0x6b6b70 : 0xf3ecd6, roughness: used ? 0.45 : 0.2, metalness: 0.06, envMapIntensity: 0.6, transparent: used, opacity: used ? 0.5 : 1 }));
    body.castShadow = true; g.add(body);
    const pipMat = new THREE.MeshStandardMaterial({ color: used ? 0x3a3a40 : 0x110e0a, roughness: 0.35 });
    for (const [px, pz] of (PIP[value] || [])) {
      const pip = new THREE.Mesh(new THREE.CylinderGeometry(DIE_SZ * 0.11, DIE_SZ * 0.11, 0.06, 16), pipMat);
      pip.position.set(px * DIE_SZ, DIE_SZ / 2 + 0.02, pz * DIE_SZ); g.add(pip);
    }
    return g;
  }
  function renderDice() {
    while (diceGroup.children.length) diceGroup.remove(diceGroup.children[0]);
    if (!turnTokens.length) return;
    const n = turnTokens.length, gap = DIE_SZ * 1.55, baseX = BWH * 0.34;
    for (let k = 0; k < n; k++) {
      const die = buildDie(turnTokens[k].value, turnTokens[k].used);
      die.position.set(baseX + k * gap, FELT_Y + DIE_SZ / 2 + 0.1, 0);
      die.rotation.y = (turn === "w" ? 0.12 : -0.12) * (k % 2 ? -1 : 1);
      diceGroup.add(die);
    }
    diceGroup.visible = true;
  }

  // ── highlights ──
  const _hints = [];
  function clearHints() { for (const h of _hints) { scene.remove(h); h.geometry.dispose(); h.material.dispose(); } _hints.length = 0; }
  function ringAt(pos, color, r) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.16, 10, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.copy(pos); scene.add(ring); _hints.push(ring); return ring;
  }
  const pointMidPos = (i) => { const P = POINTS[i]; return new THREE.Vector3(P.x, DISC_Y + 0.25, P.baseZ + P.dir * TRI_LEN * 0.42); };
  function hintPoint(i, isCap) { ringAt(pointMidPos(i), isCap ? 0xff7a3c : 0x5fd08a, CH_R * 1.05); }
  function offHint(side) { const p = offSlotPos(side, offStacks[side].length); p.y += 1.2; ringAt(p, 0x8fd0ff, CH_R * 1.2); }
  function sourceRing(sel) {
    if (sel === "bar") { ringAt(barSlotPos(playerSide, Math.max(0, barStacks[playerSide].length - 1)).setY(BAR_DISC_Y + 0.3), 0xffe27a, CH_R * 1.3); return; }
    const n = pointStacks[sel].length; ringAt(pointSlotPos(sel, Math.max(0, n - 1), n).setY(DISC_Y + 0.3), 0xffe27a, CH_R * 1.3);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GAME STATE + FLOW
  // ══════════════════════════════════════════════════════════════════════════
  let state = newState();
  const playerSide = content.playerSide === "b" ? "b" : "w";
  const aiSide = other(playerSide);
  let turn = "w";
  let phase = "menu", busy = false, selected = null;
  let rolled = [1, 1], turnTokens = [], movesMade = 0;
  const NOISE = { gentle: 9, casual: 3.5, sharp: 1.2, expert: 0.25 };
  let curNoise = NOISE.casual;
  function setDifficulty(d) { curNoise = NOISE[String(d || "casual").toLowerCase()] != null ? NOISE[String(d || "casual").toLowerCase()] : NOISE.casual; }
  const aiNoise = () => (kernel._testRand ? 0 : (Math.random() * 2 - 1) * curNoise);
  function sfx(n, v) { const u = content.sfx && content.sfx[n]; if (u) kernel.playSound(u, v == null ? 0.5 : v); }
  const rint6 = () => 1 + ((kernel._testRand ? Math.random() : Math.random()) * 6 | 0);

  const remainingVals = () => turnTokens.filter((t) => !t.used).map((t) => t.value);
  function markTokenUsed(d) { const t = turnTokens.find((t) => !t.used && t.value === d); if (t) t.used = true; }
  function setTurnDice(a, b) { rolled = [a, b]; const dbl = a === b; turnTokens = (dbl ? [a, a, a, a] : [a, b]).map((v) => ({ value: v, used: false })); movesMade = 0; renderDice(); }
  function rollDice() { setTurnDice(rint6(), rint6()); }

  function refreshHud() {
    const rem = remainingVals();
    const who = turn === playerSide ? "Your roll" : "Opponent";
    const dice = rem.length ? rem.join("  ") : "—";
    kernel.hud('<div style="position:absolute;left:14px;top:12px;font:600 15px system-ui,sans-serif;color:#eaf3ff;text-shadow:0 1px 4px #000">' +
      who + ' &nbsp;·&nbsp; dice ' + dice + '<br><span style="opacity:.82;font-size:12px;font-weight:500">bar ' +
      SIDE_NAME.w + " " + state.bar.w + " / " + SIDE_NAME.b + " " + state.bar.b + " &nbsp;·&nbsp; off " +
      state.off.w + " / " + state.off.b + "</span></div>");
  }

  // move animation: arc the top source checker to its landing slot; if it hits a
  // blot, that lone enemy checker is swept to the bar. State is committed on landing.
  function animateMove(side, mv, done) {
    clearHints();
    let disc = (mv.from === "bar") ? barStacks[side].pop() : pointStacks[mv.from].pop();
    if (mv.from === "bar") layoutBar(side); else layoutPoint(mv.from);
    let hitDisc = null, oppSide = null;
    if (mv.to !== "off" && mv.hit) { oppSide = other(side); hitDisc = pointStacks[mv.to].pop(); }
    const land = (mv.to === "off") ? offSlotPos(side, offStacks[side].length)
      : pointSlotPos(mv.to, pointStacks[mv.to].length, pointStacks[mv.to].length + 1);
    if (!disc) { applyMove(state, side, mv); if (done) done(); return; }
    const start = disc.position.clone();
    const lift = Math.max(3.0, start.distanceTo(land) * 0.16);
    kernel.tween({
      target: disc.position, to: { x: land.x, z: land.z }, duration: 0.42,
      onUpdate: (e) => { disc.position.y = start.y + (land.y - start.y) * e + Math.sin(Math.min(1, e) * Math.PI) * lift; },
      onComplete: () => {
        disc.position.copy(land);
        applyMove(state, side, mv);
        if (mv.to === "off") { offStacks[side].push(disc); layoutOff(side); sfx("confirm", 0.5); }
        else { pointStacks[mv.to].push(disc); layoutPoint(mv.to); sfx(mv.hit ? "hit" : "click", mv.hit ? 0.55 : 0.4); }
        if (hitDisc) {
          barStacks[oppSide].push(hitDisc);
          const bp = barSlotPos(oppSide, barStacks[oppSide].length - 1);
          kernel.tween({ target: hitDisc.position, to: { x: bp.x, y: bp.y + 1.4, z: bp.z }, duration: 0.4, onComplete: () => { hitDisc.position.copy(bp); layoutBar(oppSide); } });
        }
        if (done) done();
      },
    });
  }

  function commitMove(side, mv) {
    busy = true; deselect(); markTokenUsed(mv.die); renderDice();
    animateMove(side, mv, () => { busy = false; postMove(side); });
  }
  function postMove(side) {
    movesMade++; refreshHud();
    if (state.off[side] === 15) { endGame(side); return; }
    const rem = remainingVals();
    const opts = rem.length ? offeredMoves(state, side, rem, false, rolled) : [];
    if (opts.length === 0) { endTurn(); return; }
    if (side === aiSide) { setTimeout(aiPlay, 430); return; }
    if (state.bar[playerSide] > 0) selectBar(); else deselect();
  }
  function aiPlay() {
    if (phase !== "playing" || turn !== aiSide || busy) return;
    const rem = remainingVals();
    const opts = rem.length ? offeredMoves(state, aiSide, rem, movesMade === 0, rolled) : [];
    if (!opts.length) { endTurn(); return; }
    let best = opts[0], bv = -Infinity;
    for (const mv of opts) { const ns = cloneState(state); applyMove(ns, aiSide, mv); const v = evalBoard(ns, aiSide) + aiNoise(); if (v > bv) { bv = v; best = mv; } }
    commitMove(aiSide, best);
  }
  function endGame(side) {
    phase = "ended";
    const win = side === playerSide;
    sfx(win ? "victory" : "defeat", 0.7);
    setTimeout(() => { if (shell) shell.end(win, (win ? "You win — " : "You lose — ") + SIDE_NAME[side] + " bore off all 15 checkers"); }, 900);
  }
  function endTurn() {
    if (phase !== "playing") return;
    deselect();
    const next = other(turn);
    setTimeout(() => { if (phase === "playing") startTurn(next); }, 480);
  }
  function startTurn(side) {
    turn = side; rollDice(); refreshHud();
    const opts = offeredMoves(state, side, remainingVals(), true, rolled);
    if (opts.length === 0) { setTimeout(() => { if (phase === "playing") endTurn(); }, 950); return; }
    if (side === aiSide) { setTimeout(aiPlay, 650); return; }
    if (state.bar[playerSide] > 0) selectBar(); else deselect();
  }

  // ── selection ──
  function deselect() { selected = null; clearHints(); }
  function selectBar() {
    selected = "bar"; clearHints();
    const opts = offeredMoves(state, playerSide, remainingVals(), movesMade === 0, rolled);
    sourceRing("bar");
    for (const m of opts) if (m.from === "bar") hintPoint(m.to, m.hit);
  }
  function selectSource(i) {
    const opts = offeredMoves(state, playerSide, remainingVals(), movesMade === 0, rolled).filter((m) => m.from === i);
    if (!opts.length) { sfx("click", 0.25); return; }
    // if the only option(s) bear off with no in-board destination, do it straight away
    if (opts.every((m) => m.to === "off")) { commitMove(playerSide, opts[0]); return; }
    deselect(); selected = i; sourceRing(i);
    let hasOff = false;
    for (const m of opts) { if (m.to === "off") hasOff = true; else hintPoint(m.to, m.hit); }
    if (hasOff) offHint(playerSide);
    sfx("select", 0.4);
  }

  function onPointerDown(ev) {
    if (phase !== "playing" || busy || turn !== playerSide) return;
    if (ev.button !== 0) return;
    const hits = kernel.raycast(ev.clientX, ev.clientY, scene.children);
    if (!hits.length) return;
    let pt = null, bar = false;
    for (const h of hits) {
      let o = h.object;
      while (o) { if (o.userData && o.userData.point != null) { pt = o.userData.point; break; } if (o.userData && o.userData.bar) { bar = true; break; } o = o.parent; }
      if (pt != null || bar) break;
    }
    if (pt == null && !bar) { pt = worldToPoint(hits[0].point); if (pt == null) return; }

    const rem = remainingVals();
    const opts = offeredMoves(state, playerSide, rem, movesMade === 0, rolled);
    // forced re-entry from the bar
    if (state.bar[playerSide] > 0) {
      if (pt != null) { const mv = opts.find((m) => m.from === "bar" && m.to === pt); if (mv) { commitMove(playerSide, mv); return; } }
      selectBar(); return;
    }
    // play a highlighted destination for the selected source
    if (selected != null && selected !== "bar") {
      let mv = pt != null ? opts.find((m) => m.from === selected && m.to === pt) : null;
      if (!mv && pt === selected) mv = opts.find((m) => m.from === selected && m.to === "off");
      if (mv) { commitMove(playerSide, mv); return; }
    }
    // otherwise (re)select a source
    if (pt != null && opts.some((m) => m.from === pt)) { selectSource(pt); return; }
    deselect();
  }
  function worldToPoint(p) {
    if (!p) return null; const bottom = p.z > 0; let bi = null, bd = 1e9;
    for (let i = 0; i < 24; i++) { const P = POINTS[i]; if ((P.dir < 0) !== bottom) continue; const d = Math.abs(p.x - P.x); if (d < bd) { bd = d; bi = i; } }
    return bd < COL * 0.85 ? bi : null;
  }
  kernel.renderer.domElement.addEventListener("pointerdown", onPointerDown);

  // ── camera (straight, square-on down the board) ──
  const span = Math.max(BWH * 2, ZEDGE * 2);
  kernel.camera.fov = 42; kernel.camera.updateProjectionMatrix();
  const CAM = { x: 0, y: ZEDGE * 2.0, z: ZEDGE * 2.55 };
  kernel.camera.position.set(CAM.x, CAM.y, CAM.z);
  const orbit = kernel.enableOrbit({ target: { x: 0, y: 0, z: 0 }, minDistance: ZEDGE * 1.1, maxDistance: span * 2.0, minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.46, rotateButton: "right", autoRotate: true, autoRotateSpeed: 0.32, wasdPan: true, panSpeed: span * 0.4 });
  function squareOnCamera() { kernel.camera.position.set(CAM.x, CAM.y, CAM.z); if (orbit) { orbit.autoRotate = false; orbit.target.set(0, 0, 0); orbit.update(); } }

  // ── F3 debug overlay ──
  (function debugOverlay() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:10px;top:64px;z-index:9999;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#8effc0;background:rgba(6,12,20,.74);border:1px solid rgba(120,220,180,.35);border-radius:8px;padding:7px 11px;pointer-events:none;white-space:pre;display:none";
    (kernel.parent || document.body).appendChild(el);
    let on = false, frames = 0, acc = 0, fps = 0, lo = 999;
    kernel.onUpdate((dt) => {
      if (!on) return; frames++; acc += dt; const inst = dt > 0 ? 1 / dt : 0; if (inst < lo) lo = inst;
      if (acc >= 0.5) {
        fps = Math.round(frames / acc); frames = 0; acc = 0; const _lo = Math.round(lo); lo = 999; const r = kernel.renderer, info = r && r.info;
        const nd = pointStacks.reduce((a, s) => a + s.length, 0) + barStacks.w.length + barStacks.b.length + offStacks.w.length + offStacks.b.length;
        el.textContent = "FPS " + fps + "  (low " + _lo + ")\nDPR " + (r ? r.getPixelRatio().toFixed(2) : "?") +
          "\ndraw calls " + (info ? info.render.calls : "?") + "\ntriangles " + (info ? info.render.triangles.toLocaleString() : "?") +
          "\nturn " + turn + "  dice " + remainingVals().join(",") + "\nbar " + state.bar.w + "/" + state.bar.b + "  off " + state.off.w + "/" + state.off.b + "  checkers " + nd;
      }
    });
    window.addEventListener("keydown", (e) => { if (e.key === "F3" || e.code === "F3") { e.preventDefault(); on = !on; el.style.display = on ? "block" : "none"; if (on) el.textContent = "FPS …"; } });
    window.__BACKGAMMON_DEBUG__ = { toggle: () => { on = !on; el.style.display = on ? "block" : "none"; return on; }, fps: () => fps, state: () => ({ turn, dice: remainingVals(), bar: state.bar, off: state.off }) };
  })();

  // ── shell wiring ──
  let shell = null;
  function beginGame() {
    phase = "playing"; state = newState(); turn = "w"; movesMade = 0; busy = false; selected = null;
    resetCheckers(); clearHints(); squareOnCamera();
    try { music.start(); } catch (e) {}
    try { const _arm = () => { try { music.start(); } catch (e) {} window.removeEventListener("pointerdown", _arm); window.removeEventListener("keydown", _arm); }; window.addEventListener("pointerdown", _arm); window.addEventListener("keydown", _arm); } catch (e) {}
    startTurn("w");
  }
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      title: content.title || "Backgammon",
      tagline: content.tagline || "",
      difficulties: ["Gentle", "Casual", "Sharp", "Expert"],
      defaultDifficulty: "Casual",
      howTo: [
        { h: "GOAL", p: "Race all fifteen of your checkers around the board into your home board, then bear them all off before your opponent does. A calm game of dice and position." },
        { h: "ROLL & MOVE", p: "Two dice roll for you each turn. Left-click one of your checkers, then a highlighted point, to move it that many pips. Play each die; DOUBLES let you play the number four times." },
        { h: "POINTS & BLOTS", p: "A point held by two or more of your checkers is safe. A lone checker is a BLOT — land on an enemy blot to HIT it: it goes to the bar and must re-enter before its owner plays anything else." },
        { h: "BEAR OFF", p: "Once all fifteen of your checkers are in your home board, click a checker to bear it off. First player to bear off all fifteen wins." },
      ],
      onPlay: (d) => { setDifficulty(d); beginGame(); },
      onPause: () => { kernel.stop(); try { music.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { music.start(); } catch (e) {} },
      onMusicVolume: (v) => { try { music.setVolume(v); } catch (e) {} },
    });
    resetCheckers();      // menu preview (start position, auto-rotating)
    shell.start();
  } else { resetCheckers(); beginGame(); }

  // ══════════════════════════════════════════════════════════════════════════
  //  TEST HOOKS (parity / verification)
  // ══════════════════════════════════════════════════════════════════════════
  function countOnBoard(side) { const sgn = side === "w" ? 1 : -1; let n = 0; for (let i = 0; i < 24; i++) { const c = state.pts[i] * sgn; if (c > 0) n += c; } return n; }
  const controller = {
    __test: {
      start: () => { if (shell && shell.hide) shell.hide(); kernel._testRand = true; beginGame(); return true; },
      state: () => ({ phase, turn, busy, dice: remainingVals(), rolled: rolled.slice(), bar: { w: state.bar.w, b: state.bar.b }, off: { w: state.off.w, b: state.off.b }, board: countOnBoard("w") + countOnBoard("b") }),
      counts: () => ({ w: countOnBoard("w") + state.bar.w + state.off.w, b: countOnBoard("b") + state.bar.b + state.off.b, off: { w: state.off.w, b: state.off.b }, bar: { w: state.bar.w, b: state.bar.b } }),
      pts: () => state.pts.slice(),
      // drain any in-flight move animation deterministically (independent of rAF —
      // background QA tabs throttle requestAnimationFrame, so this pumps the tween
      // clock directly so the live commit-on-landing path can be verified headless)
      pump: (n) => { const k = kernel; for (let i = 0; i < (n || 40) && k._tweens.length; i++) k._stepTweens(0.05); return { busy, tweens: k._tweens.length }; },
      // force the current turn's dice (only meaningful before any move is played this turn)
      roll: (a, b) => { if (phase !== "playing") return false; setTurnDice(a, b); refreshHud(); const opts = offeredMoves(state, turn, remainingVals(), true, rolled); if (turn === playerSide) { if (opts.length && state.bar[playerSide] > 0) selectBar(); else deselect(); } return { turn, dice: remainingVals(), options: opts.length }; },
      // legal destinations for a source ('bar' or 0..23) given the remaining dice
      legal: (from) => offeredMoves(state, turn, remainingVals(), movesMade === 0, rolled).filter((m) => m.from === from).map((m) => ({ to: m.to, die: m.die, hit: m.hit })),
      offered: () => offeredMoves(state, turn, remainingVals(), movesMade === 0, rolled).map((m) => ({ from: m.from, to: m.to, die: m.die, hit: m.hit })),
      // play one legal die-move by from/to (animated); returns true if it was legal
      move: (from, to) => { const opts = offeredMoves(state, turn, remainingVals(), movesMade === 0, rolled); const mv = opts.find((m) => m.from === from && m.to === to); if (!mv) return false; commitMove(turn, mv); return true; },
      aiMove: () => { if (turn !== aiSide) return false; aiPlay(); return true; },
      // pure-sim playout to a finished game (no views) — PROVES the ruleset terminates
      autoResolve: (maxTurns) => {
        let s = newState(), side = "w", half = 0, turns = 0; const cap = maxTurns || 20000;
        while (turns++ < cap) {
          const a = 1 + (Math.random() * 6 | 0), b = 1 + (Math.random() * 6 | 0);
          let rem = a === b ? [a, a, a, a] : [a, b]; let first = true;
          while (rem.length) {
            const opts = offeredMoves(s, side, rem, first, [a, b]); first = false;
            if (!opts.length) break;
            let best = opts[0], bv = -Infinity;
            for (const mv of opts) { const ns = cloneState(s); applyMove(ns, side, mv); const v = evalBoard(ns, side); if (v > bv) { bv = v; best = mv; } }
            applyMove(s, side, best); half++; rem = removeDie(rem, best.die);
            if (s.off[side] === 15) break;
          }
          if (s.off.w === 15) return { ended: true, winner: "w", moves: half, turns, off: { w: s.off.w, b: s.off.b } };
          if (s.off.b === 15) return { ended: true, winner: "b", moves: half, turns, off: { w: s.off.w, b: s.off.b } };
          side = other(side);
        }
        return { ended: false, winner: null, moves: half, turns, off: { w: s.off.w, b: s.off.b } };
      },
      setDifficulty,
    },
  };
  return controller;
});

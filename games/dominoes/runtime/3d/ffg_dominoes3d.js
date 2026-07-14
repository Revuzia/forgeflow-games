/**
 * FFG runtime — 3d/ffg_dominoes3d.js  (ES module)
 * DOMINOES (draw variant, double-six set) in clean 3D on the ffg_kernel_3d
 * substrate. Ivory tiles with recessed pips on a warm felt table; match a pip
 * end onto either open end of the line, draw from the boneyard when you can't
 * play, first to empty their hand (or the lightest hand when blocked) wins.
 * Single-player vs a heuristic AI (4 skill levels). Calm, unhurried presentation.
 *
 * Model note: each of the 28 physical dominoes is exactly ONE persistent mesh
 * that migrates between zones (boneyard → a hand → the line). State is a set of
 * pure functions (deck/deal/legalMoves/applyPlay) shared by the live game AND a
 * headless autoResolve playout that proves the ruleset terminates.
 * Registers genre "dominoes3d".
 */
import * as THREE from "three";
import { createClassicalMusic } from "./ffg_boardmusic.js";
const _V = new URL(import.meta.url).search;
const { register3d } = await import("./ffg_kernel_3d.js" + _V);

function shade(hex, f) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
  const c = (v) => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
// vertical gradient sky (calm, cool-teal) used as background + a soft IBL source
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

// ── the calm parlour-table look (one warm environment, no themes) ──
const THEME = {
  sky_top: 0x2c3a40, sky_bot: 0x141c1e,
  felt: 0x2f5642, feltEdge: 0x24463a, frame: 0x5a3a24, ring: 0x6b4a2e, ringRough: 0.7,
  fog: 0x162420, fogD: 0.006,
  key: 0xfff3df, keyI: 1.7, hemiSky: 0xbfd8cf, hemiGround: 0x33463a, hemiI: 0.85, ambI: 0.58, exposure: 1.18,
  rim: 0x9fc0ff, rimI: 1.0,
  ivory: 0xe7dfca, pip: 0x241d17, gold: 0xcaa14e,
};

// tile geometry (world units): a domino is 2:1, laid flat, pips up.
const TILE_L = 2.0, TILE_W = 1.0, TILE_TH = 0.34;
const PLAYER_Z = 5.8, AI_Z = -5.8, LINE_Z = 0.0;
const HAND_W = 15.0, LINE_W = 16.0;
const BONE = { x: -8.8, z: 4.2 };
const CAM = { x: 0, y: 12.8, z: 12.8 };
const TABLE_W = 22, TABLE_D = 15.5;

const tid = (a, b) => a * 7 + b;       // unique id per physical tile (a<=b)
const pipsum = (t) => t[0] + t[1];
const handPips = (h) => h.reduce((s, t) => s + t[0] + t[1], 0);
const otherSide = (s) => (s === "p" ? "a" : "p");
function shuffle(arr, rnd) { for (let i = arr.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
function fullDeck() { const d = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) d.push([a, b]); return d; }
// small deterministic RNG for reproducible headless playouts
function mulberry32(seed) { let s = seed >>> 0; return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

register3d("dominoes3d", async (kernel, content) => {
  const scene = kernel.scene;
  const music = createClassicalMusic(0.15);   // gentle procedural piano
  const maxAniso = (kernel.renderer.capabilities && kernel.renderer.capabilities.getMaxAnisotropy) ? kernel.renderer.capabilities.getMaxAnisotropy() : 1;

  // ── environment ──
  scene.background = makeSky(THEME.sky_top, THEME.sky_bot);
  if (kernel.setEnvironment) kernel.setEnvironment(scene.background, 0.5);
  scene.fog = new THREE.FogExp2(THEME.fog, THEME.fogD);
  if (kernel.sun) { kernel.sun.color = new THREE.Color(THEME.key); kernel.sun.intensity = THEME.keyI; kernel.sun.position.set(TABLE_W * 0.25, TABLE_D * 1.4, TABLE_D * 0.55); }
  scene.add(new THREE.HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiI));
  scene.add(new THREE.AmbientLight(0xffffff, THEME.ambI));
  { const rim = new THREE.DirectionalLight(THEME.rim, THEME.rimI); rim.position.set(-TABLE_W * 0.42, TABLE_D * 0.85, -TABLE_D * 0.95); scene.add(rim); }  // cool back-rim: edge sheen + separation
  kernel.renderer.toneMappingExposure = THEME.exposure;
  // AO (contact shadows) grounds the tiles on the felt — the biggest not-flat-lit jump
  if (kernel.enableBloom) kernel.enableBloom({ ssao: true, ssaoRadius: 0.9, ssaoMin: 0.002, ssaoMax: 0.07, strength: 0.2, radius: 0.6, threshold: 0.86 });

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

  // ── table ──
  (function buildTable() {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W + 2.4, 1.2, TABLE_D + 2.4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(shade(THEME.frame, -0.25)), roughness: THEME.ringRough, metalness: 0.12, envMapIntensity: 0.3 }));
    plinth.position.set(0, -0.9, 0); plinth.receiveShadow = true; scene.add(plinth);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W + 1.2, 0.5, TABLE_D + 1.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex(THEME.frame), roughness: THEME.ringRough * 0.68, metalness: 0.2, envMapIntensity: 0.45 }));
    frame.position.set(0, -0.28, 0); frame.receiveShadow = true; scene.add(frame);
    const felt = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W, 0.36, TABLE_D),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: feltTex(), emissive: new THREE.Color(THEME.felt).multiplyScalar(0.05), roughness: 0.78, metalness: 0.0, envMapIntensity: 0.3 }));
    felt.position.set(0, -0.02, 0); felt.receiveShadow = true; scene.add(felt);
    // warm wooden floor beneath the table — grounds the scene, turns the dead void into a room receding into fog
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -1.5, 0); floor.receiveShadow = true; scene.add(floor);
    // subtle inlaid border line on the felt
    const inlay = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.1, 4), new THREE.MeshBasicMaterial({ visible: false }));
    scene.add(inlay);
  })();

  // ── tile textures (canvas → crisp pips) ──────────────────────────────────
  const P9 = { c: [.5, .5], tl: [.3, .3], tr: [.7, .3], bl: [.3, .7], br: [.7, .7], ml: [.3, .5], mr: [.7, .5] };
  const PMAP = { 0: [], 1: ["c"], 2: ["tl", "br"], 3: ["tl", "c", "br"], 4: ["tl", "tr", "bl", "br"], 5: ["tl", "tr", "c", "bl", "br"], 6: ["tl", "tr", "ml", "mr", "bl", "br"] };
  function drawPips(c, n, x0, y0, w, h) {
    const r = Math.min(w, h) * 0.084;
    for (const k of PMAP[n]) {
      const px = x0 + P9[k][0] * w, py = y0 + P9[k][1] * h;
      const gg = c.createRadialGradient(px - r * 0.32, py - r * 0.32, 1, px, py, r);
      gg.addColorStop(0, "rgba(92,82,66,0.92)"); gg.addColorStop(0.5, "rgba(36,29,23,1)"); gg.addColorStop(1, "rgba(9,7,5,1)");
      c.fillStyle = gg; c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
    }
  }
  const _ivoryHex = "#" + THEME.ivory.toString(16).padStart(6, "0");
  function baseFace(c) {
    c.fillStyle = _ivoryHex; c.fillRect(0, 0, 512, 256);
    // bone grain — fine speckle + faint veining so tiles read as carved bone, not flat plastic
    const im = c.getImageData(0, 0, 512, 256), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n - 1; }
    c.putImageData(im, 0, 0);
    c.globalAlpha = 0.05; c.strokeStyle = "#9a865e";
    for (let i = 0; i < 10; i++) { const y = Math.random() * 256; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= 512; x += 24) c.lineTo(x, y + Math.sin(x * 0.02 + i) * 5); c.stroke(); }
    c.globalAlpha = 1;
    const g = c.createRadialGradient(256, 128, 40, 256, 128, 320);
    g.addColorStop(0, "rgba(255,252,240,0.55)"); g.addColorStop(1, "rgba(120,105,80,0.12)");
    c.fillStyle = g; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = "rgba(70,55,35,0.5)"; c.lineWidth = 9; c.strokeRect(8, 8, 496, 240);
  }
  const _faceTexCache = {};
  function faceTex(a, b) {
    const id = tid(a, b); if (_faceTexCache[id]) return _faceTexCache[id];
    const cv = document.createElement("canvas"); cv.width = 512; cv.height = 256; const c = cv.getContext("2d");
    baseFace(c);
    c.strokeStyle = "rgba(70,55,35,0.5)"; c.lineWidth = 6; c.beginPath(); c.moveTo(256, 30); c.lineTo(256, 226); c.stroke();
    drawPips(c, a, 0, 0, 256, 256); drawPips(c, b, 256, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
    _faceTexCache[id] = tex; return tex;
  }
  let _backTex = null;
  function backTex() {
    if (_backTex) return _backTex;
    const cv = document.createElement("canvas"); cv.width = 512; cv.height = 256; const c = cv.getContext("2d");
    baseFace(c);
    c.save(); c.translate(256, 128); c.rotate(Math.PI / 4);
    c.strokeStyle = "rgba(202,161,78,0.8)"; c.lineWidth = 7; c.strokeRect(-52, -52, 104, 104);
    c.fillStyle = "rgba(202,161,78,0.5)"; c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.fill();
    c.restore();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
    _backTex = tex; return tex;
  }

  // shared materials + geometry (one geo for all 28 tiles; scale handles fit)
  const boxGeo = new THREE.BoxGeometry(TILE_L, TILE_TH, TILE_W);
  const ivoryMat = new THREE.MeshStandardMaterial({ color: THEME.ivory, roughness: 0.29, metalness: 0.02, envMapIntensity: 1.0 });
  const backMat = new THREE.MeshStandardMaterial({ map: backTex(), roughness: 0.36, metalness: 0.02, envMapIntensity: 0.85 });
  const _faceMatCache = {};
  function faceMat(a, b) { const id = tid(a, b); if (!_faceMatCache[id]) _faceMatCache[id] = new THREE.MeshStandardMaterial({ map: faceTex(a, b), roughness: 0.36, metalness: 0.02, envMapIntensity: 0.85 }); return _faceMatCache[id]; }
  function buildTileMesh(a, b) {
    // BoxGeometry material order: [px, nx, py, ny, pz, nz]; +Y (index 2) is the pip face.
    const mats = [ivoryMat, ivoryMat, backMat, ivoryMat, ivoryMat, ivoryMat];
    const m = new THREE.Mesh(boxGeo, mats.slice());
    m.castShadow = true; m.receiveShadow = true;
    m.userData = { a, b, id: tid(a, b) };
    return m;
  }
  function setFace(m, up) { m.material[2] = up ? faceMat(m.userData.a, m.userData.b) : backMat; }

  // ── boneyard tray + draw highlight ──
  const boneTray = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 3.2),
    new THREE.MeshStandardMaterial({ color: shade(THEME.frame, -0.1), roughness: 0.8, metalness: 0.1 }));
  boneTray.position.set(BONE.x + 0.28, 0.14, BONE.z - 0.5); boneTray.receiveShadow = true;
  boneTray.userData = { boneyard: true }; scene.add(boneTray);
  const boneRing = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0x5fd08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  boneRing.rotation.x = Math.PI / 2; boneRing.position.set(BONE.x + 0.28, 0.3, BONE.z - 0.5); boneRing.visible = false; scene.add(boneRing);
  function highlightBoneyard(on) { boneRing.visible = on; }

  // ── DOMINOES STATE (pure model reused by the live game) ─────────────────────
  const P = { hand: [] }, A = { hand: [] };
  let boneyard = [];              // [ [a,b], ... ]
  let line = [];                  // [ {l, r, id}, ... ]  left→right, l/r are the OUTWARD pip on each side
  let leftEnd = null, rightEnd = null;
  let turn = "p", phase = "menu", busy = false, selectedId = null, needDraw = false, consecutivePasses = 0;
  let aiLevel = (content.aiLevel || "casual");
  const mem = { oppLacks: new Set() };   // AI's soft read on values the human has shown they lack
  const SKILL = { gentle: "gentle", casual: "casual", sharp: "sharp", expert: "expert" };
  function setDifficulty(d) { aiLevel = SKILL[String(d || "casual").toLowerCase()] || "casual"; }
  function sfx(n, v) { const u = content.sfx && content.sfx[n]; if (u) kernel.playSound(u, v == null ? 0.5 : v); }
  const handOf = (s) => (s === "p" ? P.hand : A.hand);

  // legal moves for a hand given the open ends (line non-empty)
  function legalMoves(hand, L, R) {
    const out = [];
    for (let i = 0; i < hand.length; i++) { const t = hand[i]; if (t[0] === L || t[1] === L) out.push({ idx: i, end: "L", tile: t }); if (t[0] === R || t[1] === R) out.push({ idx: i, end: "R", tile: t }); }
    return out;
  }
  // the open ends AFTER a hypothetical move (for AI scoring)
  function endsAfter(mv) {
    if (line.length === 0) return { nl: mv.tile[0], nr: mv.tile[1] };
    if (mv.end === "L") { const o = mv.tile[0] === leftEnd ? mv.tile[1] : mv.tile[0]; return { nl: o, nr: rightEnd }; }
    const o = mv.tile[0] === rightEnd ? mv.tile[1] : mv.tile[0]; return { nl: leftEnd, nr: o };
  }
  // mutate live state by playing hand(side)[mv.idx] at mv.end
  function applyPlayState(side, mv) {
    const h = handOf(side); const tile = h[mv.idx]; h.splice(mv.idx, 1); const id = tid(tile[0], tile[1]);
    if (line.length === 0) { line.push({ l: tile[0], r: tile[1], id }); leftEnd = tile[0]; rightEnd = tile[1]; }
    else if (mv.end === "L") { let l, r; if (tile[1] === leftEnd) { l = tile[0]; r = tile[1]; } else { l = tile[1]; r = tile[0]; } line.unshift({ l, r, id }); leftEnd = l; }
    else { let l, r; if (tile[0] === rightEnd) { l = tile[0]; r = tile[1]; } else { l = tile[1]; r = tile[0]; } line.push({ l, r, id }); rightEnd = r; }
    return tile;
  }

  // ── tile VIEWS: one persistent mesh per physical tile, migrating by target ──
  const pool = {};   // id -> { mesh }
  function clearPool() { for (const k in pool) { scene.remove(pool[k].mesh); delete pool[k]; } }
  function computeTargets(selId) {
    const t = {};
    // boneyard: a tidy face-down stack
    for (let i = 0; i < boneyard.length; i++) { const tile = boneyard[i]; const id = tid(tile[0], tile[1]); const col = i % 2, row = (i / 2) | 0; t[id] = { x: BONE.x + col * 0.55, y: TILE_TH * 0.5 + 0.14 + row * 0.02, z: BONE.z - row * 0.16, rotY: 0, scale: 0.92, faceUp: false }; }
    // player hand
    { const n = P.hand.length; const hs = Math.min(1, HAND_W / Math.max(1, n * (TILE_L + 0.16))); const cell = (TILE_L + 0.16) * hs; for (let i = 0; i < n; i++) { const tile = P.hand[i]; const id = tid(tile[0], tile[1]); let y = TILE_TH * 0.5 * hs, z = PLAYER_Z; if (id === selId) { y += 0.55; z -= 0.4; } t[id] = { x: (i - (n - 1) / 2) * cell, y, z, rotY: 0, scale: hs, faceUp: true }; } }
    // ai hand (face down)
    { const n = A.hand.length; const hs = Math.min(1, HAND_W / Math.max(1, n * (TILE_L + 0.16))); const cell = (TILE_L + 0.16) * hs; for (let i = 0; i < n; i++) { const tile = A.hand[i]; const id = tid(tile[0], tile[1]); t[id] = { x: (i - (n - 1) / 2) * cell, y: TILE_TH * 0.5 * hs, z: AI_Z, rotY: 0, scale: hs, faceUp: false }; } }
    // line (recenter + scale to fit)
    { const n = line.length; const cellW = TILE_L + 0.14; const ls = Math.min(1, LINE_W / Math.max(1, n * cellW)); for (let i = 0; i < n; i++) { const e = line[i]; let rotY = 0; if (e.l === e.r) rotY = Math.PI / 2; else if (e.l > e.r) rotY = Math.PI; t[e.id] = { x: (i - (n - 1) / 2) * cellW * ls, y: TILE_TH * 0.5 * ls, z: LINE_Z, rotY, scale: ls, faceUp: true }; } }
    return t;
  }
  const lerp = (a, b, e) => a + (b - a) * e;
  function moveMesh(m, tg, dur, arcH, done) {
    const from = { x: m.position.x, y: m.position.y, z: m.position.z, ry: m.rotation.y, s: m.scale.x };
    let tRy = tg.rotY; while (tRy - from.ry > Math.PI) tRy -= Math.PI * 2; while (from.ry - tRy > Math.PI) tRy += Math.PI * 2;
    const same = Math.abs(from.x - tg.x) < 1e-3 && Math.abs(from.y - tg.y) < 1e-3 && Math.abs(from.z - tg.z) < 1e-3 && Math.abs(from.ry - tRy) < 1e-3 && Math.abs(from.s - tg.scale) < 1e-3;
    if (same && arcH === 0) { if (done) done(); return; }
    const dummy = { p: 0 };
    kernel.tween({
      target: dummy, to: { p: 1 }, duration: dur,
      onUpdate: (e) => { m.position.x = lerp(from.x, tg.x, e); m.position.z = lerp(from.z, tg.z, e); m.position.y = lerp(from.y, tg.y, e) + (arcH ? Math.sin(Math.min(1, e) * Math.PI) * arcH : 0); m.rotation.y = lerp(from.ry, tRy, e); const s = lerp(from.s, tg.scale, e); m.scale.setScalar(s); },
      onComplete: () => { m.position.set(tg.x, tg.y, tg.z); m.rotation.y = tg.rotY; m.scale.setScalar(tg.scale); if (done) done(); },
    });
  }
  function applyTargets(animated, exceptId) {
    const t = computeTargets(selectedId);
    for (const k in pool) { const id = +k; if (exceptId != null && id === exceptId) continue; const tg = t[id]; if (!tg) continue; const m = pool[k].mesh; setFace(m, tg.faceUp); if (animated) moveMesh(m, tg, 0.24, 0, null); else { m.position.set(tg.x, tg.y, tg.z); m.rotation.y = tg.rotY; m.scale.setScalar(tg.scale); } }
  }

  // ── open-end markers (choose which side to play a two-way tile) ──
  const endMarkers = [];
  function clearEndMarkers() { for (const mk of endMarkers) scene.remove(mk); endMarkers.length = 0; }
  function makeMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.07, 10, 30), new THREE.MeshBasicMaterial({ color: 0x6fe6a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; g.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0x2fae6e, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.01; g.add(disc);
    return g;
  }
  function showEndMarkers(idx) {
    clearEndMarkers();
    const moves = legalMoves(P.hand, leftEnd, rightEnd).filter((m) => m.idx === idx);
    const n = line.length, cellW = TILE_L + 0.14, ls = Math.min(1, LINE_W / Math.max(1, n * cellW));
    const half = (n * cellW * ls) / 2;
    for (const m of moves) {
      const x = m.end === "L" ? -half - 0.35 : half + 0.35;
      const mk = makeMarker(); mk.position.set(x, TILE_TH * 0.5 + 0.06, LINE_Z); mk.userData = { end: m.end };
      scene.add(mk); endMarkers.push(mk);
    }
  }

  // ── HUD (status bar + transient toast) ──
  const parentEl = kernel.parent || document.body;
  const bar = document.createElement("div");
  bar.style.cssText = "position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:40;pointer-events:none;font:600 14px/1.5 'Segoe UI',system-ui,sans-serif;color:#eaf3ee;background:rgba(8,20,16,.62);border:1px solid rgba(120,200,160,.28);border-radius:10px;padding:7px 16px;white-space:nowrap;text-shadow:0 1px 3px #000;display:none";
  parentEl.appendChild(bar);
  const toastEl = document.createElement("div");
  toastEl.style.cssText = "position:absolute;left:50%;top:16%;transform:translateX(-50%);z-index:41;pointer-events:none;font:700 17px/1.4 'Segoe UI',system-ui,sans-serif;color:#fff;background:rgba(10,24,18,.72);border:1px solid rgba(150,220,180,.35);border-radius:10px;padding:9px 20px;white-space:nowrap;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .35s";
  parentEl.appendChild(toastEl);
  let _toastT = null;
  function toast(msg, ms) { toastEl.textContent = msg; toastEl.style.opacity = "1"; if (_toastT) clearTimeout(_toastT); _toastT = setTimeout(() => { toastEl.style.opacity = "0"; }, ms || 1900); }
  function updateHUD() {
    if (phase !== "playing") { bar.style.display = "none"; return; }
    bar.style.display = "block";
    const ends = line.length ? (leftEnd + " · " + rightEnd) : "—";
    bar.innerHTML = (turn === "p" ? "<span style='color:#8bf0b8'>Your turn</span>" : "<span style='color:#f0c98b'>AI thinking…</span>") +
      "&nbsp;&nbsp;•&nbsp;&nbsp;Open ends " + ends + "&nbsp;&nbsp;•&nbsp;&nbsp;You " + P.hand.length + "&nbsp;&nbsp;AI " + A.hand.length + "&nbsp;&nbsp;Boneyard " + boneyard.length;
  }

  // ── animation: play + draw ──
  function animatePlay(side, mv, done) {
    busy = true; clearEndMarkers(); highlightBoneyard(false);
    const h = handOf(side); const tile = h[mv.idx]; const id = tid(tile[0], tile[1]); const m = pool[id].mesh;
    applyPlayState(side, mv); updateHUD();
    setFace(m, true);
    const tg = computeTargets(null)[id];
    moveMesh(m, tg, 0.42, 0.95, () => { busy = false; sfx("confirm", 0.5); if (done) done(); });
    applyTargets(true, id);   // settle the rest concurrently
  }
  function animateDraw(side, done) {
    busy = true; const tile = boneyard.pop(); handOf(side).push(tile); const id = tid(tile[0], tile[1]); const m = pool[id].mesh;
    updateHUD(); setFace(m, side === "p");
    const tg = computeTargets(null)[id];
    moveMesh(m, tg, 0.4, 0.6, () => { busy = false; sfx("click", 0.35); if (done) done(); });
    applyTargets(true, id);
  }

  // ── turn flow ──
  function nextTurn() {
    if (phase !== "playing") return;
    const side = turn; updateHUD();
    const moves = legalMoves(handOf(side), leftEnd, rightEnd);
    if (moves.length) {
      if (side === "p") { needDraw = false; highlightBoneyard(false); }
      else setTimeout(() => { if (phase === "playing" && !busy) aiPlay(moves); }, 560);
    } else if (boneyard.length) {
      if (side === "p") { needDraw = true; highlightBoneyard(true); toast("No match — click the boneyard to draw"); }
      else setTimeout(() => { if (phase === "playing" && !busy) aiDrawStep(); }, 560);
    } else pass(side);
  }
  function aiPlay(moves) { if (phase !== "playing" || busy) return; const mv = chooseAI(moves); animatePlay("a", mv, () => afterPlay("a")); }
  function aiDrawStep() {
    if (phase !== "playing") return;
    if (!boneyard.length) { pass("a"); return; }
    animateDraw("a", () => { const mv = legalMoves(A.hand, leftEnd, rightEnd); if (mv.length) aiPlay(mv); else if (boneyard.length) setTimeout(aiDrawStep, 320); else pass("a"); });
  }
  function playerDraw() {
    if (!needDraw || busy || phase !== "playing") return;
    if (!boneyard.length) { pass("p"); return; }
    mem.oppLacks.add(leftEnd); mem.oppLacks.add(rightEnd);
    animateDraw("p", () => {
      const mv = legalMoves(P.hand, leftEnd, rightEnd);
      if (mv.length) { needDraw = false; highlightBoneyard(false); toast("Drew a match — your move"); }
      else if (boneyard.length) toast("Still no match — draw again");
      else { needDraw = false; highlightBoneyard(false); pass("p"); }
    });
  }
  function pass(side) {
    consecutivePasses++; sfx("click", 0.3); needDraw = false; highlightBoneyard(false);
    toast(side === "p" ? "You pass" : "AI passes");
    if (side === "p") { mem.oppLacks.add(leftEnd); mem.oppLacks.add(rightEnd); }
    if (consecutivePasses >= 2) { endBlocked(); return; }
    turn = otherSide(side); updateHUD(); nextTurn();
  }
  function afterPlay(side) {
    consecutivePasses = 0;
    if (side === "p") mem.oppLacks.clear();
    if (handOf(side).length === 0) { endGame(side === "p"); return; }
    turn = otherSide(side); updateHUD(); nextTurn();
  }
  function endGame(playerWon) {
    phase = "ended"; clearEndMarkers(); highlightBoneyard(false); selectedId = null;
    const opp = playerWon ? handPips(A.hand) : handPips(P.hand);
    sfx(playerWon ? "victory" : "defeat", 0.7);
    const sub = playerWon ? ("You emptied your hand — opponent held " + opp + " pips.") : ("The AI went out — you held " + opp + " pips.");
    setTimeout(() => { if (shell) shell.end(playerWon, sub); }, 900);
  }
  function endBlocked() {
    phase = "ended"; clearEndMarkers(); highlightBoneyard(false); selectedId = null;
    const pp = handPips(P.hand), ap = handPips(A.hand); const playerWon = pp <= ap; // ties go to the player
    sfx(playerWon ? "victory" : "defeat", 0.7);
    setTimeout(() => { if (shell) shell.end(playerWon, "Blocked game — you " + pp + " pips vs AI " + ap + " pips."); }, 900);
  }

  // ── AI ──
  function scoreMove(mv) {
    const { nl, nr } = endsAfter(mv);
    let s = pipsum(mv.tile) * 0.8;
    if (mv.tile[0] === mv.tile[1]) s += 5;                 // shed hard-to-place doubles early
    if (aiLevel !== "casual") { let flex = 0; for (const t of A.hand) { if (t === mv.tile) continue; if (t[0] === nl || t[1] === nl) flex++; if (t[0] === nr || t[1] === nr) flex++; } s += flex * 1.1; }
    if (aiLevel === "expert") { if (mem.oppLacks.has(nl)) s += 3; if (mem.oppLacks.has(nr)) s += 3; }
    return s;
  }
  function chooseAI(moves) {
    if (!moves.length) return null;
    if (aiLevel === "gentle") return moves[kernel._testRand ? 0 : (Math.random() * moves.length) | 0];
    let best = moves[0], bestv = -Infinity;
    for (const mv of moves) { let v = scoreMove(mv); if (!kernel._testRand) v += (aiLevel === "casual" ? Math.random() * 4 : aiLevel === "sharp" ? Math.random() * 1.2 : Math.random() * 0.4); if (v > bestv) { bestv = v; best = mv; } }
    return best;
  }

  // ── input ──
  function selectTile(id) {
    if (busy || phase !== "playing" || turn !== "p") return;
    const idx = P.hand.findIndex((t) => tid(t[0], t[1]) === id); if (idx < 0) return;
    const moves = legalMoves(P.hand, leftEnd, rightEnd).filter((m) => m.idx === idx);
    if (!moves.length) { sfx("click", 0.25); toast("That tile has no match"); return; }
    if (moves.length === 1) { selectedId = null; playMove(moves[0]); return; }
    selectedId = id; sfx("select", 0.5); applyTargets(true); showEndMarkers(idx);
  }
  function playSelected(end) {
    if (selectedId == null) return;
    const idx = P.hand.findIndex((t) => tid(t[0], t[1]) === selectedId); if (idx < 0) return;
    const mv = legalMoves(P.hand, leftEnd, rightEnd).find((m) => m.idx === idx && m.end === end); if (!mv) return;
    selectedId = null; playMove(mv);
  }
  function playMove(mv) { if (busy) return; clearEndMarkers(); sfx("confirm", 0.5); animatePlay("p", mv, () => afterPlay("p")); }
  function onPointerDown(ev) {
    if (phase !== "playing" || busy || turn !== "p" || ev.button !== 0) return;
    const hit = kernel.raycast(ev.clientX, ev.clientY, scene.children); if (!hit.length) return;
    // priority: an open-end marker, then the boneyard, then a hand tile
    let endHit = null, boneHit = false, tileHit = null;
    for (const h of hit) {
      let o = h.object;
      while (o) { if (o.userData) { if (o.userData.end && endHit == null) endHit = o.userData.end; if (o.userData.boneyard) boneHit = true; if (o.userData.id != null && tileHit == null) tileHit = o.userData.id; } o = o.parent; }
    }
    if (endHit && selectedId != null) { playSelected(endHit); return; }
    if (boneHit && needDraw) { playerDraw(); return; }
    if (tileHit != null && P.hand.some((t) => tid(t[0], t[1]) === tileHit)) { selectTile(tileHit); return; }
    if (selectedId != null) { selectedId = null; clearEndMarkers(); applyTargets(true); }
  }
  kernel.renderer.domElement.addEventListener("pointerdown", onPointerDown);

  // ── camera (calm parlour-table view) ──
  const span = Math.max(TABLE_W, TABLE_D);
  kernel.camera.fov = 42; kernel.camera.updateProjectionMatrix();
  kernel.camera.position.set(CAM.x, CAM.y, CAM.z);
  const orbit = kernel.enableOrbit({ target: { x: 0, y: 0, z: 0.3 }, minDistance: 9, maxDistance: 40, minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.46, rotateButton: "right", autoRotate: true, autoRotateSpeed: 0.32 });
  function resetCamera() { kernel.camera.position.set(CAM.x, CAM.y, CAM.z); if (orbit) { orbit.target.set(0, 0, 0.3); orbit.update(); } }

  // ── F3 debug overlay ──
  (function debugOverlay() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:10px;top:10px;z-index:9999;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#8effc0;background:rgba(6,14,12,.76);border:1px solid rgba(120,220,180,.35);border-radius:8px;padding:7px 11px;pointer-events:none;white-space:pre;display:none";
    (kernel.parent || document.body).appendChild(el);
    let on = false, frames = 0, acc = 0, fps = 0, lo = 999;
    kernel.onUpdate((dt) => {
      if (!on) return; frames++; acc += dt; const inst = dt > 0 ? 1 / dt : 0; if (inst < lo) lo = inst;
      if (acc >= 0.5) {
        fps = Math.round(frames / acc); frames = 0; acc = 0; const _lo = Math.round(lo); lo = 999; const r = kernel.renderer, info = r && r.info;
        el.textContent = "FPS " + fps + "  (low " + _lo + ")\nDPR " + (r ? r.getPixelRatio().toFixed(2) : "?") + "\ndraw calls " + (info ? info.render.calls : "?") + "\ntriangles " + (info ? info.render.triangles.toLocaleString() : "?") +
          "\nturn " + turn + " phase " + phase + "\nends " + leftEnd + "/" + rightEnd + " line " + line.length + "\nP " + P.hand.length + " A " + A.hand.length + " bone " + boneyard.length;
      }
    });
    window.addEventListener("keydown", (e) => { if (e.key === "F3" || e.code === "F3") { e.preventDefault(); on = !on; el.style.display = on ? "block" : "none"; if (on) el.textContent = "FPS …"; } });
    window.__DOMINOES_DEBUG__ = { toggle: () => { on = !on; el.style.display = on ? "block" : "none"; return on; }, fps: () => fps, state: () => ({ turn, phase, leftEnd, rightEnd, line: line.length, p: P.hand.length, a: A.hand.length, bone: boneyard.length }) };
  })();

  // ── round setup / start ──
  function startRound() {
    clearPool(); clearEndMarkers(); highlightBoneyard(false);
    P.hand = []; A.hand = []; boneyard = []; line = []; leftEnd = rightEnd = null;
    selectedId = null; needDraw = false; busy = false; consecutivePasses = 0; mem.oppLacks.clear();
    const deck = shuffle(fullDeck(), Math.random);
    P.hand = deck.slice(0, 7); A.hand = deck.slice(7, 14); boneyard = deck.slice(14);
    for (const t of deck) { const id = tid(t[0], t[1]); const m = buildTileMesh(t[0], t[1]); pool[id] = { mesh: m }; scene.add(m); }
    applyTargets(false); updateHUD();
  }
  function determineOpener() {
    for (let d = 6; d >= 0; d--) { const pi = P.hand.findIndex((t) => t[0] === d && t[1] === d); if (pi >= 0) return { side: "p", idx: pi, tile: P.hand[pi] }; const ai = A.hand.findIndex((t) => t[0] === d && t[1] === d); if (ai >= 0) return { side: "a", idx: ai, tile: A.hand[ai] }; }
    let best = null; const scan = (h, side) => { for (let i = 0; i < h.length; i++) { const v = pipsum(h[i]); if (!best || v > best.v) best = { side, idx: i, tile: h[i], v }; } }; scan(P.hand, "p"); scan(A.hand, "a"); return best;
  }
  function startMusic() {
    try { music.start(); } catch (e) {}
    try { const arm = () => { try { music.start(); } catch (e) {} window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm); }; window.addEventListener("pointerdown", arm); window.addEventListener("keydown", arm); } catch (e) {}
  }
  function beginPlay() {
    startRound(); phase = "playing"; if (orbit) orbit.autoRotate = false; resetCamera(); startMusic();
    const op = determineOpener();
    toast((op.side === "p" ? "You open" : "AI opens") + " with " + op.tile[0] + "-" + op.tile[1], 2200);
    setTimeout(() => { if (phase !== "playing") return; animatePlay(op.side, { idx: op.idx, end: "R", tile: op.tile }, () => { turn = otherSide(op.side); updateHUD(); nextTurn(); }); }, 750);
  }

  // ── shell wiring ──
  let shell = null;
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      title: content.title || "Dominoes",
      tagline: content.tagline || "",
      difficulties: ["Gentle", "Casual", "Sharp", "Expert"],
      defaultDifficulty: "Casual",
      howTo: [
        { h: "GOAL", p: "Be the first to play all of your tiles. If the game locks up with nobody able to move, the lightest hand (fewest pips) wins." },
        { h: "OPEN", p: "The player holding the highest double leads with it (if nobody has a double, the heaviest tile opens). That first tile sets the two open ends of the line." },
        { h: "PLAY", p: "Left-click one of your tiles. If a pip matches an open end it plays there; when it fits BOTH ends, click the glowing end you want. Doubles are laid crosswise." },
        { h: "DRAW", p: "No tile matches either open end? Click the boneyard to draw, and keep drawing until you can play — or, if the boneyard is empty, you pass." },
      ],
      onPlay: (d) => { setDifficulty(d); beginPlay(); },
      onPause: () => { kernel.stop(); try { music.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { music.start(); } catch (e) {} },
      onMusicVolume: (v) => { try { music.setVolume(v); } catch (e) {} },
    });
    startRound();      // dealt table as the calm auto-rotating menu backdrop
    shell.start();
  } else { startRound(); beginPlay(); }

  // ── test hooks (parity / verification) ──
  // headless playout that PROVES the draw ruleset terminates (no views touched).
  function autoResolve(seed) {
    const rnd = mulberry32(seed == null ? ((Math.random() * 1e9) | 0) : seed);
    const deck = shuffle(fullDeck(), rnd);
    const hands = { p: deck.slice(0, 7), a: deck.slice(7, 14) };
    let bone = deck.slice(14), L = null, R = null, lineN = 0, t = "p", passes = 0, moves = 0;
    const legal = (h) => { const o = []; for (let i = 0; i < h.length; i++) { const x = h[i]; if (x[0] === L || x[1] === L) o.push({ idx: i, end: "L", tile: x }); if (x[0] === R || x[1] === R) o.push({ idx: i, end: "R", tile: x }); } return o; };
    const play = (side, mv) => { const h = hands[side]; const tile = h[mv.idx]; h.splice(mv.idx, 1); if (lineN === 0) { L = tile[0]; R = tile[1]; } else if (mv.end === "L") { L = tile[0] === L ? tile[1] : tile[0]; } else { R = tile[0] === R ? tile[1] : tile[0]; } lineN++; };
    // opener: highest double else heaviest tile
    let op = null; for (let d = 6; d >= 0 && !op; d--) { const pi = hands.p.findIndex((x) => x[0] === d && x[1] === d); if (pi >= 0) { op = { s: "p", i: pi }; break; } const ai = hands.a.findIndex((x) => x[0] === d && x[1] === d); if (ai >= 0) { op = { s: "a", i: ai }; break; } }
    if (!op) { let bv = -1; for (const s of ["p", "a"]) hands[s].forEach((x, i) => { if (pipsum(x) > bv) { bv = pipsum(x); op = { s, i }; } }); }
    play(op.s, { idx: op.i, end: "R", tile: hands[op.s][op.i] }); moves++; t = otherSide(op.s);
    const CAP = 800; let winner = null;
    while (moves < CAP) {
      const lm = legal(hands[t]);
      if (lm.length) { play(t, lm[(rnd() * lm.length) | 0]); passes = 0; moves++; if (hands[t].length === 0) { winner = t; break; } t = otherSide(t); }
      else if (bone.length) { hands[t].push(bone.pop()); moves++; }
      else { passes++; if (passes >= 2) break; t = otherSide(t); }
    }
    const pp = handPips(hands.p), ap = handPips(hands.a);
    if (!winner) winner = pp <= ap ? "p" : "a";
    return { ended: moves < CAP, moves, winner, playerPips: pp, aiPips: ap, boneLeft: bone.length, reason: (hands.p.length === 0 || hands.a.length === 0) ? "domino" : "blocked" };
  }
  const controller = {
    __test: {
      start: () => { if (shell) shell.hide && shell.hide(); kernel._testRand = true; beginPlay(); return true; },
      state: () => ({ phase, turn, busy, player: P.hand.length, ai: A.hand.length, boneyard: boneyard.length, line: line.length, leftEnd, rightEnd, ended: phase === "ended" }),
      counts: () => ({ player: P.hand.length, ai: A.hand.length, boneyard: boneyard.length, line: line.length }),
      hand: (s) => (s === "a" ? A.hand : P.hand).map((t) => [t[0], t[1]]),
      ends: () => ({ leftEnd, rightEnd }),
      playerMoves: () => legalMoves(P.hand, leftEnd, rightEnd).map((m) => ({ idx: m.idx, tile: [m.tile[0], m.tile[1]], end: m.end })),
      // drive one player move by hand index (+ optional end for a two-way tile)
      play: (idx, end) => { if (phase !== "playing" || busy || turn !== "p") return false; const moves = legalMoves(P.hand, leftEnd, rightEnd).filter((m) => m.idx === idx); if (!moves.length) return false; const mv = end ? moves.find((m) => m.end === end) : moves[0]; if (!mv) return false; selectedId = null; playMove(mv); return true; },
      draw: () => { if (turn !== "p" || busy) return false; if (!needDraw) { const mv = legalMoves(P.hand, leftEnd, rightEnd); if (mv.length) return false; needDraw = true; } playerDraw(); return true; },
      aiStep: () => { if (turn !== "a" || busy || phase !== "playing") return false; const mv = legalMoves(A.hand, leftEnd, rightEnd); if (mv.length) aiPlay(mv); else aiDrawStep(); return true; },
      autoResolve: (seed) => autoResolve(seed),
      setDifficulty,
    },
  };
  return controller;
});

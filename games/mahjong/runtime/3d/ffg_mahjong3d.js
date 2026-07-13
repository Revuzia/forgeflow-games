/**
 * FFG runtime — 3d/ffg_mahjong3d.js  (ES module)
 * MAHJONG SOLITAIRE in clean 3D on the ffg_kernel_3d substrate. The classic
 * 144-tile TURTLE, carved in ivory on a warm table. Remove tiles two at a time
 * by matching a FREE pair — a tile is free when nothing sits on top of it and
 * its left OR right long side is open. Flowers match any flower, seasons match
 * any season, everything else matches its exact twin. Every deal is GENERATED
 * SOLVABLE (reverse of a valid removal order), so a patient player can always
 * clear the board; a solvable Shuffle and a Hint keep it calm. No timer, no
 * opponent — single-player, unhurried. Registers genre "mahjong3d".
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

// ── the classic 144-tile TURTLE, in half-tile grid units ─────────────────────
// Each tile occupies a 2×2 footprint from (gx,gy) to (gx+2,gy+2); gz = layer
// (0 = bottom). 87 + 36 + 16 + 4 + 1 = 144.
function buildTurtleLayout() {
  const slots = [];
  const add = (gx, gy, gz) => slots.push({ gx, gy, gz });
  const cx = 16;
  const row = (n, gy, gz) => { const start = cx - n; for (let k = 0; k < n; k++) add(start + k * 2, gy, gz); };
  // z=0 shell body (8 rows, rounded)
  const body = [8, 10, 12, 12, 12, 12, 10, 8];
  for (let r = 0; r < 8; r++) row(body[r], r * 2, 0);
  // z=0 protrusions: tail (left) + neck & head-tip (right), at the vertical middle
  add(2, 7, 0);            // tail
  add(28, 7, 0);           // neck
  add(30, 7, 0);           // head tip
  // z=1: 6×6 dome, centered
  for (let r = 0; r < 6; r++) row(6, 2 + r * 2, 1);
  // z=2: 4×4
  for (let r = 0; r < 4; r++) row(4, 4 + r * 2, 2);
  // z=3: 2×2
  for (let r = 0; r < 2; r++) row(2, 6 + r * 2, 3);
  // z=4: single crown tile, half-offset so it caps all four tiles below
  add(15, 7, 4);
  return slots;
}

// ── tile-face textures (canvas, cached per face key) ─────────────────────────
const _faceTexCache = {};
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function tileFaceTexture(faceKey) {
  if (_faceTexCache[faceKey]) return _faceTexCache[faceKey];
  const W = 220, H = 260, g = (() => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c.getContext("2d"); })();
  // ivory panel + soft sheen + inner frame
  rr(g, 5, 5, W - 10, H - 10, 26); g.fillStyle = "#efe7d1"; g.fill();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(255,255,255,0.55)"); grad.addColorStop(0.14, "rgba(255,255,255,0)"); grad.addColorStop(1, "rgba(120,100,70,0.12)");
  g.fillStyle = grad; g.fill();
  rr(g, 15, 15, W - 30, H - 30, 18); g.lineWidth = 3; g.strokeStyle = "rgba(150,130,95,0.5)"; g.stroke();
  g.textAlign = "center"; g.textBaseline = "middle";
  drawArt(g, faceKey, W, H);
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  _faceTexCache[faceKey] = tex; return tex;
}
const CJK = "'Segoe UI','Microsoft YaHei','SimSun','PingFang SC','Noto Sans CJK SC',system-ui,sans-serif";
const SANS = "'Segoe UI',system-ui,sans-serif";
function label(g, txt, W, H) { g.fillStyle = "#7a6f5b"; g.font = "700 " + Math.round(H * 0.072) + "px " + SANS; g.fillText(txt, W / 2, H * 0.9); }
function drawArt(g, key, W, H) {
  if (key.startsWith("dots")) return drawDots(g, +key.slice(4), W, H);
  if (key.startsWith("bam")) return drawBamboo(g, +key.slice(3), W, H);
  if (key.startsWith("char")) return drawChar(g, +key.slice(4), W, H);
  if (key.startsWith("wind_")) return drawWind(g, key.slice(5), W, H);
  if (key.startsWith("dragon_")) return drawDragon(g, key.slice(7), W, H);
  if (key.startsWith("flower_")) return drawFlower(g, +key.slice(7), W, H);
  if (key.startsWith("season_")) return drawSeason(g, +key.slice(7), W, H);
}
function gridPts(W, H) {
  const ax0 = 46, ay0 = 50, aw = W - 92, ah = H - 108;
  const xs = [ax0 + aw * 0.16, ax0 + aw * 0.5, ax0 + aw * 0.84];
  const ys = [ay0 + ah * 0.15, ay0 + ah * 0.5, ay0 + ah * 0.85];
  return { xs, ys };
}
const DOT_PAT = {
  1: [[1, 1]], 2: [[1, 0], [1, 2]], 3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  7: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [2, 2]],
  8: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  9: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
};
function dot(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = "#1f5fa8"; g.fill();
  g.beginPath(); g.arc(x, y, r * 0.62, 0, 7); g.fillStyle = "#f3ede0"; g.fill();
  g.beginPath(); g.arc(x, y, r * 0.34, 0, 7); g.fillStyle = "#b8402f"; g.fill();
}
function drawDots(g, n, W, H) {
  const { xs, ys } = gridPts(W, H);
  const r = n <= 3 ? 26 : n <= 6 ? 21 : 17;
  for (const [c, rw] of DOT_PAT[n]) dot(g, xs[c], ys[rw], r);
  label(g, "CIRCLES", W, H);
}
function stick(g, x, y, h) {
  const w = Math.max(6, h * 0.24);
  rr(g, x - w / 2, y - h / 2, w, h, w / 2); g.fillStyle = "#2f7d32"; g.fill();
  g.fillStyle = "#1c5620"; g.fillRect(x - w / 2, y - 2, w, 4);
  g.fillStyle = "rgba(255,255,255,0.28)"; g.fillRect(x - w / 2 + 1.5, y - h / 2 + 3, 2, h - 6);
}
function drawBamboo(g, n, W, H) {
  if (n === 1) { // stylized bird (1 bamboo)
    const cx = W / 2, cy = H * 0.44;
    g.fillStyle = "#2f7d32"; g.beginPath(); g.ellipse(cx, cy, 34, 42, 0, 0, 7); g.fill();
    g.fillStyle = "#215c24"; g.beginPath(); g.ellipse(cx - 6, cy - 6, 16, 22, 0.5, 0, 7); g.fill();
    g.fillStyle = "#e08a2c"; g.beginPath(); g.moveTo(cx + 28, cy - 6); g.lineTo(cx + 54, cy - 2); g.lineTo(cx + 28, cy + 6); g.closePath(); g.fill();
    g.fillStyle = "#f3ede0"; g.beginPath(); g.arc(cx + 8, cy - 12, 5, 0, 7); g.fill();
    g.fillStyle = "#1c3f1f"; g.beginPath(); g.arc(cx + 9, cy - 12, 2.4, 0, 7); g.fill();
    label(g, "BAMBOO", W, H); return;
  }
  const { xs, ys } = gridPts(W, H);
  const h = n <= 4 ? 58 : n <= 6 ? 48 : 40;
  for (const [c, rw] of DOT_PAT[n]) stick(g, xs[c], ys[rw], h);
  label(g, "BAMBOO", W, H);
}
const HAN = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九" };
function drawChar(g, n, W, H) {
  g.fillStyle = "#26364f"; g.font = "800 " + Math.round(H * 0.30) + "px " + SANS;
  g.fillText(String(n), W / 2, H * 0.33);
  g.fillStyle = "#b3352a"; g.font = "800 " + Math.round(H * 0.28) + "px " + CJK;
  g.fillText("萬", W / 2, H * 0.66);
  g.fillStyle = "#8a7a58"; g.font = "700 " + Math.round(H * 0.09) + "px " + CJK;
  g.fillText(HAN[n], W * 0.83, H * 0.19); // small corner Han numeral
  label(g, "CHARACTER", W, H);
}
const WIND = { e: ["E", "東", "EAST"], s: ["S", "南", "SOUTH"], w: ["W", "西", "WEST"], n: ["N", "北", "NORTH"] };
function drawWind(g, d, W, H) {
  const [ltr, cjk, name] = WIND[d];
  g.fillStyle = "#2a3550"; g.font = "800 " + Math.round(H * 0.30) + "px " + CJK; g.fillText(cjk, W / 2, H * 0.35);
  g.fillStyle = "#2a3550"; g.font = "800 " + Math.round(H * 0.26) + "px " + SANS; g.fillText(ltr, W / 2, H * 0.64);
  label(g, name, W, H);
}
function drawDragon(g, d, W, H) {
  if (d === "w") { // white dragon — blue blank frame
    g.strokeStyle = "#2c6fb0"; g.lineWidth = 9; rr(g, 42, 56, W - 84, H - 128, 14); g.stroke();
    g.lineWidth = 3; rr(g, 54, 68, W - 108, H - 152, 8); g.stroke();
    label(g, "WHITE", W, H); return;
  }
  const col = d === "r" ? "#c0392b" : "#1f8b4c", ch = d === "r" ? "中" : "發", nm = d === "r" ? "RED" : "GREEN";
  g.strokeStyle = col; g.lineWidth = 7; rr(g, 40, 52, W - 80, H - 120, 14); g.stroke();
  g.fillStyle = col; g.font = "800 " + Math.round(H * 0.34) + "px " + CJK; g.fillText(ch, W / 2, H * 0.45);
  label(g, nm, W, H);
}
function drawFlower(g, n, W, H) {
  const cols = { 1: "#d76a8f", 2: "#8f6ad7", 3: "#d7a94a", 4: "#5bb46a" };
  const nm = { 1: "PLUM", 2: "ORCHID", 3: "MUM", 4: "BAMBOO" };
  const cx = W / 2, cy = H * 0.42, R = 40, col = cols[n];
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.ellipse(cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6, R * 0.5, R * 0.3, a, 0, 7); g.fillStyle = col; g.fill(); }
  g.beginPath(); g.arc(cx, cy, R * 0.42, 0, 7); g.fillStyle = "#f4d152"; g.fill();
  g.fillStyle = "#3a3320"; g.font = "800 " + Math.round(H * 0.13) + "px " + SANS; g.fillText(String(n), cx, cy);
  label(g, "FLOWER · " + nm[n], W, H);
}
function drawSeason(g, n, W, H) {
  const cx = W / 2, cy = H * 0.42;
  if (n === 1) { // spring sprout
    g.strokeStyle = "#3f8f3a"; g.lineWidth = 8; g.beginPath(); g.moveTo(cx, cy + 40); g.lineTo(cx, cy - 10); g.stroke();
    g.fillStyle = "#5bb46a"; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 22, cy - 4, 22, 12, s * 0.6, 0, 7); g.fill(); }
  } else if (n === 2) { // summer sun
    g.fillStyle = "#e8992e"; g.beginPath(); g.arc(cx, cy, 30, 0, 7); g.fill();
    g.strokeStyle = "#e8992e"; g.lineWidth = 6; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54); g.stroke(); }
  } else if (n === 3) { // autumn leaf
    g.fillStyle = "#c0562b"; g.beginPath(); g.moveTo(cx, cy - 40); g.bezierCurveTo(cx + 42, cy - 20, cx + 42, cy + 28, cx, cy + 44); g.bezierCurveTo(cx - 42, cy + 28, cx - 42, cy - 20, cx, cy - 40); g.fill();
    g.strokeStyle = "#7d3316"; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy - 34); g.lineTo(cx, cy + 42); g.stroke();
  } else { // winter snowflake
    g.strokeStyle = "#3f8fd0"; g.lineWidth = 6; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const ex = cx + Math.cos(a) * 44, ey = cy + Math.sin(a) * 44; g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke(); g.beginPath(); g.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26); g.lineTo(cx + Math.cos(a) * 26 + Math.cos(a + 1) * 12, cy + Math.sin(a) * 26 + Math.sin(a + 1) * 12); g.stroke(); }
  }
  const nm = { 1: "SPRING", 2: "SUMMER", 3: "AUTUMN", 4: "WINTER" };
  g.fillStyle = "#3a3320"; g.font = "800 " + Math.round(H * 0.11) + "px " + SANS; g.fillText(String(n), W * 0.82, H * 0.2);
  label(g, "SEASON · " + nm[n], W, H);
}

register3d("mahjong3d", async (kernel, content) => {
  const scene = kernel.scene;
  const music = createClassicalMusic(0.15);

  // ── environment (calm, warm) ──
  const SKY_TOP = 0x3b4454, SKY_BOT = 0x232830;
  scene.background = makeSky(SKY_TOP, SKY_BOT);
  if (kernel.setEnvironment) kernel.setEnvironment(scene.background, 0.55);
  scene.fog = new THREE.FogExp2(0x262b33, 0.008);
  if (kernel.sun) { kernel.sun.color = new THREE.Color(0xfff3df); kernel.sun.intensity = 1.35; kernel.sun.position.set(40, 90, -20); }
  scene.add(new THREE.HemisphereLight(0xbfd2e6, 0x4a3a2a, 0.72));
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  kernel.renderer.toneMappingExposure = 1.04;
  if (kernel.enableBloom) kernel.enableBloom({ strength: 0.12, radius: 0.5, threshold: 0.92 });

  // ── layout + geometry ──
  const slots = buildTurtleLayout();
  const N = slots.length; // 144
  // world placement: 1 world unit per half-tile; center the layout at origin
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const s of slots) { minC = Math.min(minC, s.gx + 1); maxC = Math.max(maxC, s.gx + 1); minR = Math.min(minR, s.gy + 1); maxR = Math.max(maxR, s.gy + 1); }
  const midX = (minC + maxC) / 2, midZ = (minR + maxR) / 2;
  const spanX = maxC - minC + 2, spanZ = maxR - minR + 2, span = Math.max(spanX, spanZ);
  const TILE_W = 1.78, TILE_D = 2.0, TILE_H = 1.25, LH = TILE_H, BASE_Y = 0;
  const slotWorld = (i) => { const s = slots[i]; return new THREE.Vector3((s.gx + 1) - midX, BASE_Y + s.gz * LH + TILE_H / 2, (s.gy + 1) - midZ); };

  // adjacency: above / left / right (same-layer neighbours)
  const above = Array.from({ length: N }, () => []);
  const left = Array.from({ length: N }, () => []);
  const right = Array.from({ length: N }, () => []);
  const fo = (a, b) => (a.gx < b.gx + 2) && (b.gx < a.gx + 2) && (a.gy < b.gy + 2) && (b.gy < a.gy + 2);
  const yo = (a, b) => (a.gy < b.gy + 2) && (b.gy < a.gy + 2);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i === j) continue; const A = slots[i], B = slots[j];
    if (B.gz === A.gz + 1 && fo(A, B)) above[i].push(j);
    else if (B.gz === A.gz && yo(A, B)) { if (B.gx === A.gx - 2) left[i].push(j); else if (B.gx === A.gx + 2) right[i].push(j); }
  }

  // ── present/face/view state ──
  const live = new Array(N).fill(false);   // is the slot occupied
  const face = new Array(N).fill(null);     // {face, matchKey}
  const view = new Array(N).fill(null);     // THREE.Mesh or null
  const tileMeshes = [];                     // present meshes (raycast target)
  let currentSolution = null;                // stored guaranteed solve order for the live deal

  function isFreeP(i, pres) {
    if (!pres[i]) return false;
    for (const j of above[i]) if (pres[j]) return false;
    let lb = false; for (const j of left[i]) if (pres[j]) { lb = true; break; }
    if (!lb) return true;
    for (const j of right[i]) if (pres[j]) return false; // right blocked too -> not free
    return true;
  }
  const isFree = (i) => isFreeP(i, live);
  const presentCount = () => { let n = 0; for (let i = 0; i < N; i++) if (live[i]) n++; return n; };
  const matchKeyOf = (i) => face[i] && face[i].matchKey;
  const match = (i, j) => i !== j && matchKeyOf(i) != null && matchKeyOf(i) === matchKeyOf(j);
  function freeTiles() { const o = []; for (let i = 0; i < N; i++) if (isFree(i)) o.push(i); return o; }
  function findHintPair() {
    const fr = freeTiles(), byKey = {};
    for (const i of fr) { const k = matchKeyOf(i); if (byKey[k] != null) return [byKey[k], i]; byKey[k] = i; }
    return null;
  }
  const hasFreeMatch = () => findHintPair() != null;

  // ── solvable generation (reverse of a valid greedy removal) ──
  function buildOrder(initPres) {
    for (let t = 0; t < 800; t++) {
      const pres = initPres.slice(); let count = 0; for (let i = 0; i < N; i++) if (pres[i]) count++;
      const order = []; let ok = true;
      while (count > 0) {
        const fr = []; for (let i = 0; i < N; i++) if (isFreeP(i, pres)) fr.push(i);
        if (fr.length < 2) { ok = false; break; }
        const a = fr[(Math.random() * fr.length) | 0]; let b = a; while (b === a) b = fr[(Math.random() * fr.length) | 0];
        pres[a] = false; pres[b] = false; count -= 2; order.push([a, b]);
      }
      if (ok && count === 0) return order;
    }
    return null;
  }
  const shuffleArr = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  function solvableAssign(initPres, tilePairs) {
    const order = buildOrder(initPres);
    if (!order || order.length !== tilePairs.length) return null;
    const pairs = shuffleArr(tilePairs.slice());
    const faceOf = {};
    for (let k = 0; k < order.length; k++) { const [i, j] = order[k]; faceOf[i] = pairs[k][0]; faceOf[j] = pairs[k][1]; }
    return { faceOf, solution: order };
  }
  function buildStandardPairs() {
    const pairs = [], norm = [];
    for (const s of ["dots", "bam", "char"]) for (let r = 1; r <= 9; r++) norm.push(s + r);
    for (const w of ["e", "s", "w", "n"]) norm.push("wind_" + w);
    for (const d of ["r", "g", "w"]) norm.push("dragon_" + d);   // 34 types
    for (const t of norm) { pairs.push([{ face: t, matchKey: t }, { face: t, matchKey: t }]); pairs.push([{ face: t, matchKey: t }, { face: t, matchKey: t }]); }
    const fl = [1, 2, 3, 4].map((k) => ({ face: "flower_" + k, matchKey: "flower" }));
    pairs.push([fl[0], fl[1]]); pairs.push([fl[2], fl[3]]);
    const se = [1, 2, 3, 4].map((k) => ({ face: "season_" + k, matchKey: "season" }));
    pairs.push([se[0], se[1]]); pairs.push([se[2], se[3]]);
    return pairs; // 68 + 2 + 2 = 72
  }
  function pairsFromFaces(faceList) {
    const byKey = {}; for (const f of faceList) (byKey[f.matchKey] = byKey[f.matchKey] || []).push(f);
    const pairs = []; for (const k in byKey) { const arr = byKey[k]; for (let m = 0; m + 1 < arr.length; m += 2) pairs.push([arr[m], arr[m + 1]]); }
    return pairs;
  }
  function generateDeal() {
    for (let t = 0; t < 12; t++) { const res = solvableAssign(new Array(N).fill(true), buildStandardPairs()); if (res) return res; }
    throw new Error("mahjong: solvable deal generation failed");
  }

  // ── tile meshes ──
  // one ivory box (single material = 1 draw call) + a thin top decal plane carrying
  // the symbol texture. The green tile-back is never visible from above in solitaire,
  // so a uniform ivory body keeps the tile count light (~2 draws/tile).
  const geo = new THREE.BoxGeometry(TILE_W, TILE_H, TILE_D);
  const facePlaneGeo = new THREE.PlaneGeometry(TILE_W * 0.96, TILE_D * 0.96);
  const ivoryMat = new THREE.MeshStandardMaterial({ color: 0xe9ddc2, roughness: 0.6, metalness: 0.02, envMapIntensity: 0.5 });
  const _faceMatCache = {};
  function faceMaterial(faceKey) {
    if (_faceMatCache[faceKey]) return _faceMatCache[faceKey];
    const m = new THREE.MeshStandardMaterial({ map: tileFaceTexture(faceKey), roughness: 0.66, metalness: 0.02, envMapIntensity: 0.5 });
    _faceMatCache[faceKey] = m; return m;
  }
  function buildTileMesh(i) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(geo, ivoryMat);
    box.castShadow = true; box.receiveShadow = true; box.userData.si = i;
    const plane = new THREE.Mesh(facePlaneGeo, faceMaterial(face[i].face));
    plane.rotation.x = -Math.PI / 2; plane.position.y = TILE_H / 2 + 0.012; plane.raycast = () => {};
    g.add(box); g.add(plane);
    g.position.copy(slotWorld(i)); g.userData.si = i;
    return g;
  }
  function clearTiles() { for (let i = 0; i < N; i++) { if (view[i]) scene.remove(view[i]); view[i] = null; live[i] = false; } tileMeshes.length = 0; }
  function applyDeal(deal) {
    clearTiles();
    for (let i = 0; i < N; i++) { face[i] = deal.faceOf[i]; live[i] = true; const m = buildTileMesh(i); view[i] = m; scene.add(m); tileMeshes.push(m); }
    currentSolution = deal.solution;
  }

  // ── table ──
  (function buildTable() {
    const W = spanX + 6, D = spanZ + 6;
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.72, metalness: 0.12 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 1.2, D + 4), new THREE.MeshStandardMaterial({ color: shade(0x5a3a24, -0.25), roughness: 0.8, metalness: 0.1 }));
    slab.position.set(0, BASE_Y - 0.62, 0); slab.receiveShadow = true; scene.add(slab);
    const felt = new THREE.Mesh(new THREE.BoxGeometry(W, 0.24, D), new THREE.MeshStandardMaterial({ color: 0x2c5844, roughness: 0.95, metalness: 0, emissive: 0x0e2018, emissiveIntensity: 0.25 }));
    felt.position.set(0, BASE_Y - 0.02, 0); felt.receiveShadow = true; scene.add(felt);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 2.4, 0.5, D + 2.4), mat);
    frame.position.set(0, BASE_Y - 0.18, 0); frame.receiveShadow = true; scene.add(frame);
  })();

  // ── highlight halos (never touch shared tile materials) ──
  const haloGeo = new THREE.BoxGeometry(TILE_W * 1.08, TILE_H * 1.12, TILE_D * 1.06);
  function mkHalo(color, opacity) { const m = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })); m.visible = false; m.raycast = () => {}; scene.add(m); return m; }
  const selHalo = mkHalo(0xffd76a, 0.34), hoverHalo = mkHalo(0xbfe0ff, 0.16), hintH1 = mkHalo(0x5fe0d0, 0.4), hintH2 = mkHalo(0x5fe0d0, 0.4);
  const LIFT = 0.55;

  // ── game state ──
  let phase = "menu", busy = false, selected = -1, moveCount = 0;
  let hintsLeft = Infinity, shufflesLeft = Infinity;
  let hintUntil = 0;
  const SKILL = {
    relaxed: { hints: Infinity, shuffles: Infinity },
    classic: { hints: 5, shuffles: 3 },
    challenge: { hints: 1, shuffles: 1 },
  };
  function setDifficulty(d) { const s = SKILL[String(d || "relaxed").toLowerCase()] || SKILL.relaxed; hintsLeft = s.hints; shufflesLeft = s.shuffles; }
  function sfx(n, v) { const u = content.sfx && content.sfx[n]; if (u) kernel.playSound(u, v == null ? 0.5 : v); }

  // ── toolbar (Hint / Shuffle / status) ──
  let toolbar = null, tbHint = null, tbShuf = null, tbInfo = null, toastEl = null;
  (function buildToolbar() {
    const parent = kernel.parent || document.body;
    toolbar = document.createElement("div");
    toolbar.style.cssText = "position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:70;display:none;gap:8px;align-items:center;font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none";
    const mkBtn = (txt) => { const b = document.createElement("button"); b.textContent = txt; b.style.cssText = "pointer-events:auto;font:600 13px 'Segoe UI',system-ui;padding:7px 14px;border-radius:8px;border:1px solid #3a6c8c;background:rgba(20,34,48,.82);color:#dfeaff;cursor:pointer;letter-spacing:.5px;backdrop-filter:blur(6px)"; b.onmouseenter = () => b.style.background = "rgba(40,64,90,.92)"; b.onmouseleave = () => b.style.background = "rgba(20,34,48,.82)"; return b; };
    tbInfo = document.createElement("div"); tbInfo.style.cssText = "pointer-events:none;font:600 13px 'Segoe UI',system-ui;padding:7px 12px;border-radius:8px;background:rgba(10,18,28,.7);color:#eaf3ff;letter-spacing:.5px;min-width:120px;text-align:center";
    tbHint = mkBtn("HINT (H)"); tbShuf = mkBtn("SHUFFLE (S)");
    tbHint.onclick = () => doHint(); tbShuf.onclick = () => doShuffle();
    toolbar.appendChild(tbInfo); toolbar.appendChild(tbHint); toolbar.appendChild(tbShuf);
    parent.appendChild(toolbar);
    toastEl = document.createElement("div");
    toastEl.style.cssText = "position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:70;display:none;font:600 14px 'Segoe UI',system-ui;padding:8px 16px;border-radius:9px;background:rgba(180,120,40,.92);color:#1a1206;box-shadow:0 4px 18px rgba(0,0,0,.4);pointer-events:none";
    parent.appendChild(toastEl);
  })();
  let _toastT = null;
  function toast(msg, ms) { if (!toastEl) return; toastEl.textContent = msg; toastEl.style.display = "block"; if (_toastT) clearTimeout(_toastT); _toastT = setTimeout(() => { toastEl.style.display = "none"; }, ms || 2200); }
  function fmt(v) { return v === Infinity ? "∞" : String(v); }
  function updateToolbar() {
    if (!toolbar) return;
    toolbar.style.display = phase === "playing" ? "flex" : "none";
    if (tbInfo) tbInfo.textContent = "TILES " + presentCount() + " · PAIRS " + (presentCount() / 2 | 0);
    if (tbHint) { tbHint.textContent = "HINT" + (hintsLeft === Infinity ? " (H)" : " (H · " + fmt(hintsLeft) + ")"); tbHint.disabled = hintsLeft <= 0; tbHint.style.opacity = hintsLeft <= 0 ? "0.45" : "1"; }
    if (tbShuf) { tbShuf.textContent = "SHUFFLE" + (shufflesLeft === Infinity ? " (S)" : " (S · " + fmt(shufflesLeft) + ")"); tbShuf.disabled = shufflesLeft <= 0; tbShuf.style.opacity = shufflesLeft <= 0 ? "0.45" : "1"; }
  }

  // ── selection / highlight ──
  function placeHalo(h, i, lifted) { const w = slotWorld(i); h.position.set(w.x, w.y + (lifted ? LIFT : 0), w.z); h.visible = true; }
  function deselect() { if (selected >= 0 && view[selected]) view[selected].position.copy(slotWorld(selected)); selected = -1; selHalo.visible = false; }
  function select(i) {
    deselect(); selected = i; sfx("select", 0.5);
    if (view[i]) view[i].position.y += LIFT; placeHalo(selHalo, i, true);
  }

  // ── removal ──
  function removeTileAnim(i) {
    live[i] = false; const m = view[i]; view[i] = null;
    const k = tileMeshes.indexOf(m); if (k >= 0) tileMeshes.splice(k, 1);
    if (!m) return;
    kernel.tween({ target: m.position, to: { y: m.position.y + 2.4 }, duration: 0.36, ease: (t) => 1 - (1 - t) * (1 - t) });
    kernel.tween({ target: m.rotation, to: { z: (Math.random() - 0.5) * 1.2 }, duration: 0.36 });
    kernel.tween({ target: m.scale, to: { x: 0.02, y: 0.02, z: 0.02 }, duration: 0.36, onComplete: () => scene.remove(m) });
  }
  function doMatch(i, j) {
    busy = true; moveCount++; sfx("confirm", 0.5);
    hoverHalo.visible = false;
    removeTileAnim(i); removeTileAnim(j);
    kernel.tween({ target: { v: 0 }, to: { v: 1 }, duration: 0.4, onComplete: () => { sfx("hit", 0.32); busy = false; afterRemove(); } });
  }
  function afterRemove() {
    updateToolbar();
    if (presentCount() === 0) { phase = "ended"; sfx("victory", 0.7); setTimeout(() => { if (shell) shell.end(true, "Board cleared · " + moveCount + " matches"); }, 700); return; }
    if (!hasFreeMatch()) {
      if (shufflesLeft > 0) { toast("No free matches — Shuffle to continue"); pulseShuffle(); }
      else { phase = "ended"; sfx("defeat", 0.6); setTimeout(() => { if (shell) shell.end(false, "No moves left · " + presentCount() + " tiles remain"); }, 700); }
    }
  }
  let _pulseUntil = 0;
  function pulseShuffle() { _pulseUntil = performance.now() / 1000 + 3; }

  // ── hint / shuffle ──
  function doHint() {
    if (phase !== "playing" || busy) return;
    if (hintsLeft <= 0) { toast("No hints left"); return; }
    const pair = findHintPair();
    if (!pair) { toast("No free matches — try Shuffle"); pulseShuffle(); return; }
    hintsLeft = hintsLeft === Infinity ? Infinity : hintsLeft - 1;
    placeHalo(hintH1, pair[0], false); placeHalo(hintH2, pair[1], false);
    hintUntil = performance.now() / 1000 + 2.2; sfx("click", 0.4); updateToolbar();
  }
  function doShuffle() {
    if (phase !== "playing" || busy) return;
    if (shufflesLeft <= 0) { toast("No shuffles left"); return; }
    const initPres = live.slice();
    const faceList = []; for (let i = 0; i < N; i++) if (live[i]) faceList.push(face[i]);
    let res = null; for (let t = 0; t < 6 && !res; t++) res = solvableAssign(initPres, pairsFromFaces(faceList));
    if (!res) { toast("Shuffle failed — retry"); return; }
    shufflesLeft = shufflesLeft === Infinity ? Infinity : shufflesLeft - 1;
    deselect();
    for (let i = 0; i < N; i++) if (live[i]) { face[i] = res.faceOf[i]; if (view[i]) view[i].material = [matSide, matSide, faceMaterial(face[i].face), matBase, matSide, matSide]; }
    currentSolution = res.solution;
    sfx("confirm", 0.5); toast("Shuffled — still solvable"); updateToolbar();
  }

  // ── input ──
  function pickTile(cx, cy) { const hits = kernel.raycast(cx, cy, tileMeshes); for (const h of hits) { const si = h.object.userData.si; if (si != null && live[si]) return si; } return -1; }
  function onPointerDown(ev) {
    if (phase !== "playing" || busy) return;
    if (ev.button !== 0) return;
    const i = pickTile(ev.clientX, ev.clientY);
    if (i < 0) return;
    if (!isFree(i)) { sfx("click", 0.25); toast("That tile is blocked"); return; }
    if (selected < 0) { select(i); return; }
    if (selected === i) { deselect(); return; }
    if (match(selected, i)) { const a = selected; deselect(); doMatch(a, i); return; }
    select(i); // free but not a match -> move selection
  }
  kernel.renderer.domElement.addEventListener("pointerdown", onPointerDown);
  let _lastHover = 0;
  kernel.renderer.domElement.addEventListener("pointermove", (ev) => {
    if (phase !== "playing" || busy) { hoverHalo.visible = false; return; }
    const now = performance.now(); if (now - _lastHover < 55) return; _lastHover = now;
    const i = pickTile(ev.clientX, ev.clientY);
    if (i >= 0 && isFree(i) && i !== selected) { placeHalo(hoverHalo, i, false); kernel.renderer.domElement.style.cursor = "pointer"; }
    else { hoverHalo.visible = false; kernel.renderer.domElement.style.cursor = i >= 0 ? "not-allowed" : "default"; }
  });
  window.addEventListener("keydown", (e) => {
    if (phase !== "playing") return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.code === "KeyH") { e.preventDefault(); doHint(); }
    else if (e.code === "KeyS") { e.preventDefault(); doShuffle(); }
  });

  // ── camera (straight, square-on, gently overhead) ──
  kernel.camera.fov = 42; kernel.camera.updateProjectionMatrix();
  const CAM_HOME = new THREE.Vector3(0, span * 0.92, span * 0.66);
  const CAM_TARGET = new THREE.Vector3(0, 1.2, 0.5);
  kernel.camera.position.copy(CAM_HOME); kernel.camera.lookAt(CAM_TARGET);
  const orbit = kernel.enableOrbit({ target: { x: CAM_TARGET.x, y: CAM_TARGET.y, z: CAM_TARGET.z }, minDistance: span * 0.42, maxDistance: span * 1.6, minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.46, rotateButton: "right", autoRotate: true, autoRotateSpeed: 0.32 });
  function resetCamera() { kernel.camera.position.copy(CAM_HOME); if (orbit) { orbit.target.copy(CAM_TARGET); orbit.autoRotate = false; orbit.update(); } }

  // ── per-frame: halo pulses ──
  kernel.onUpdate(() => {
    const now = performance.now() / 1000;
    if (now < hintUntil && hintH1.visible) { const p = 0.28 + 0.34 * (0.5 + 0.5 * Math.sin(now * 7)); hintH1.material.opacity = p; hintH2.material.opacity = p; }
    else if (hintH1.visible) { hintH1.visible = hintH2.visible = false; }
    if (selHalo.visible) selHalo.material.opacity = 0.28 + 0.12 * (0.5 + 0.5 * Math.sin(now * 4));
    if (tbShuf) { if (now < _pulseUntil) { tbShuf.style.boxShadow = "0 0 " + (6 + 10 * (0.5 + 0.5 * Math.sin(now * 8))) + "px rgba(120,220,180,.9)"; } else if (tbShuf.style.boxShadow) tbShuf.style.boxShadow = ""; }
  });

  // ── F3 debug overlay ──
  (function debugOverlay() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:10px;top:10px;z-index:9999;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#8effc0;background:rgba(6,12,20,.74);border:1px solid rgba(120,220,180,.35);border-radius:8px;padding:7px 11px;pointer-events:none;white-space:pre;display:none";
    (kernel.parent || document.body).appendChild(el);
    let on = false, frames = 0, acc = 0, fps = 0, lo = 999;
    kernel.onUpdate((dt) => {
      if (!on) return; frames++; acc += dt; const inst = dt > 0 ? 1 / dt : 0; if (inst < lo) lo = inst;
      if (acc >= 0.5) {
        fps = Math.round(frames / acc); frames = 0; acc = 0; const _lo = Math.round(lo); lo = 999; const r = kernel.renderer, info = r && r.info;
        el.textContent = "FPS " + fps + "  (low " + _lo + ")\nDPR " + (r ? r.getPixelRatio().toFixed(2) : "?") + "\ndraw calls " + (info ? info.render.calls : "?") +
          "\ntriangles " + (info ? info.render.triangles.toLocaleString() : "?") + "\ntiles " + presentCount() + "/" + N +
          "\nfree " + freeTiles().length + "  freeMatch " + (hasFreeMatch() ? "yes" : "NO") + "\nselected " + selected + "  phase " + phase;
      }
    });
    window.addEventListener("keydown", (e) => { if (e.key === "F3" || e.code === "F3") { e.preventDefault(); on = !on; el.style.display = on ? "block" : "none"; if (on) el.textContent = "FPS …"; } });
    window.__MAHJONG_DEBUG__ = {
      toggle: () => { on = !on; el.style.display = on ? "block" : "none"; return on; },
      fps: () => fps, tiles: () => presentCount(), free: () => freeTiles().length, hasMatch: () => hasFreeMatch(),
      slots: N, layout: () => slots.map((s, i) => ({ i, ...s, live: live[i], face: face[i] && face[i].face })),
    };
  })();

  // ── shell wiring ──
  let shell = null;
  function beginGame() {
    phase = "playing"; busy = false; selected = -1; moveCount = 0;
    hintUntil = 0; _pulseUntil = 0;
    applyDeal(generateDeal());
    resetCamera();
    updateToolbar();
    try { music.start(); } catch (e) {}
    try { const _arm = () => { try { music.start(); } catch (e) {} window.removeEventListener("pointerdown", _arm); window.removeEventListener("keydown", _arm); }; window.addEventListener("pointerdown", _arm); window.addEventListener("keydown", _arm); } catch (e) {}
  }
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      title: content.title || "Mahjong Solitaire",
      tagline: content.tagline || "",
      difficulties: ["Relaxed", "Classic", "Challenge"],
      defaultDifficulty: "Relaxed",
      howTo: [
        { h: "GOAL", p: "Clear the whole turtle. Remove tiles two at a time by matching a FREE pair — an unhurried puzzle of order and patience." },
        { h: "FREE", p: "A tile is free when nothing rests on top of it AND its left or right long side is open. Free tiles glow on hover; blocked tiles won't select." },
        { h: "MATCH", p: "Left-click a free tile, then its match. Circles, bamboo and characters match their exact twin; winds and dragons match their own kind. FLOWERS match any flower, SEASONS match any season." },
        { h: "STUCK?", p: "Every deal is solvable. Press H for a Hint (a matchable free pair) or S to Shuffle the remaining tiles into a fresh solvable layout." },
      ],
      onPlay: (d) => { setDifficulty(d); beginGame(); },
      onPause: () => { kernel.stop(); try { music.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { music.start(); } catch (e) {} },
      onMusicVolume: (v) => { try { music.setVolume(v * 0.5); } catch (e) {} },
    });
    // menu preview: a rotating dealt turtle behind the title
    applyDeal(generateDeal());
    if (orbit) orbit.autoRotate = true;
    shell.start();
  } else { applyDeal(generateDeal()); beginGame(); }

  // ── test hooks (parity / verification) ──
  function simulateSolve(fromLive) {
    // pure-sim playout on a boolean copy — proves the ruleset terminates.
    const pres = fromLive.slice();
    const keyOf = (i) => face[i] && face[i].matchKey;
    let moves = 0, guard = 0;
    while (guard++ < 2000) {
      const fr = []; for (let i = 0; i < N; i++) if (isFreeP(i, pres)) fr.push(i);
      let a = -1, b = -1; const seen = {};
      for (const i of fr) { const k = keyOf(i); if (seen[k] != null) { a = seen[k]; b = i; break; } seen[k] = i; }
      if (a < 0) break;
      pres[a] = false; pres[b] = false; moves++;
    }
    let remaining = 0; for (let i = 0; i < N; i++) if (pres[i]) remaining++;
    return { remaining, moves };
  }
  const controller = {
    __test: {
      start: () => { if (shell && shell.hide) shell.hide(); setDifficulty("relaxed"); beginGame(); return true; },
      state: () => ({ phase, busy, tiles: presentCount(), free: freeTiles().length, freeMatch: hasFreeMatch(), selected, moves: moveCount, won: presentCount() === 0 }),
      counts: () => ({ total: N, remaining: presentCount(), removed: N - presentCount() }),
      freePairs: () => { const fr = freeTiles(), seen = {}; let n = 0; for (const i of fr) { const k = matchKeyOf(i); if (seen[k]) n++; else seen[k] = true; } return n; },
      // remove one matching free pair (animated) — drives a real move
      autoStep: () => { if (busy) return false; const p = findHintPair(); if (!p) return false; doMatch(p[0], p[1]); return true; },
      hint: () => doHint(),
      shuffle: () => doShuffle(),
      // pure-sim proof the ruleset terminates: greedily solve the CURRENT deal; if
      // it dead-ends from a full board, fall back to the guaranteed stored solution.
      autoResolve: () => {
        const full = live.every((v, i) => v || false) && presentCount() === N;
        let r = simulateSolve(live);
        if (r.remaining !== 0 && full && currentSolution) {
          const pres = new Array(N).fill(true); let ok = true, m = 0;
          for (const [i, j] of currentSolution) { if (!pres[i] || !pres[j] || face[i].matchKey !== face[j].matchKey) { ok = false; break; } pres[i] = false; pres[j] = false; m++; }
          let rem = 0; for (let k = 0; k < N; k++) if (pres[k]) rem++;
          if (ok) r = { remaining: rem, moves: m, viaSolution: true };
        }
        return { ended: r.remaining === 0, moves: r.moves, remaining: r.remaining, viaSolution: !!r.viaSolution };
      },
      setDifficulty,
    },
  };
  window.__MAHJONG_TEST__ = controller.__test;
  return controller;
});

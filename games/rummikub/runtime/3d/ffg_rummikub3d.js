/**
 * FFG runtime — 3d/ffg_rummikub3d.js  (ES module)
 * RUMMIKUB in clean 3D on the ffg_kernel_3d substrate. Ivory numbered tiles on a
 * warm felt table: build GROUPS (same number, different colours) and RUNS
 * (consecutive numbers, one colour) from your rack; your first play (the initial
 * meld) must total >= 30 points; lay off spare tiles onto sets already on the
 * table; jokers are wild; if you cannot play, draw. Empty your rack to win.
 * Single-player vs a greedy AI (three skill levels). Calm, unhurried presentation.
 * Registers genre "rummikub3d".
 */
import * as THREE from "three";
import { createClassicalMusic } from "./ffg_boardmusic.js";
const _V = new URL(import.meta.url).search;
const { register3d } = await import("./ffg_kernel_3d.js" + _V);

// ── tile geometry / table dimensions (world units) ──
const TW = 1.62, TD = 2.14, TTH = 0.44, GAP = 0.16;
const PITCH = TW + GAP;
const TABLE_W = 38, TABLE_D = 30;
const RACK_Z = 9.4, BENCH_Z = 6.2, AI_Z = -11.0;
const TABLE_TOP = 0;                 // felt surface y
const TY = TABLE_TOP + TTH / 2 + 0.02; // tile resting y

// four Rummikub colours: red, blue, black, orange
const COL_HEX = [0xd23b34, 0x2f6ad9, 0x26262c, 0xe08a24];
const COL_CSS = ["#d23b34", "#2f6ad9", "#26262c", "#e08a24"];
const COL_NAME = ["Red", "Blue", "Black", "Orange"];
const COL_LBL = ["R", "B", "K", "O"];   // short, unambiguous debug codes (K = black, distinct from Blue)

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

const THEME = {
  sky_top: 0x39433f, sky_bot: 0x20272a,
  felt: 0x1f6b46, feltEdge: 0x6b4a2e, rim: 0x5a3a24,
  fog: 0x232a29, fogD: 0.009,
  key: 0xfff2df, keyI: 1.3, hemiSky: 0xbfe0d2, hemiGround: 0x3a2f22, hemiI: 0.7, ambI: 0.52, exposure: 1.03,
};

// small seedable RNG so __test / autoResolve are reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

register3d("rummikub3d", async (kernel, content) => {
  const scene = kernel.scene;
  const music = createClassicalMusic(0.14);

  // ── environment ──
  scene.background = makeSky(THEME.sky_top, THEME.sky_bot);
  if (kernel.setEnvironment) kernel.setEnvironment(scene.background, 0.5);
  scene.fog = new THREE.FogExp2(THEME.fog, THEME.fogD);
  if (kernel.sun) { kernel.sun.color = new THREE.Color(THEME.key); kernel.sun.intensity = THEME.keyI; kernel.sun.position.set(TABLE_W * 0.3, TABLE_D * 1.2, TABLE_D * 0.5); }
  scene.add(new THREE.HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiI));
  scene.add(new THREE.AmbientLight(0xffffff, THEME.ambI));
  kernel.renderer.toneMappingExposure = THEME.exposure;
  if (kernel.enableBloom) kernel.enableBloom({ strength: 0.12, radius: 0.5, threshold: 0.92 });

  // ── table ──
  (function buildTable() {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W + 3.2, 1.0, TABLE_D + 3.2),
      new THREE.MeshStandardMaterial({ color: THEME.rim, roughness: 0.72, metalness: 0.12 }));
    rim.position.set(0, -0.5, 0); rim.receiveShadow = true; scene.add(rim);
    const felt = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W, 0.5, TABLE_D),
      new THREE.MeshStandardMaterial({ color: THEME.felt, roughness: 0.96, metalness: 0.0, emissive: new THREE.Color(THEME.felt).multiplyScalar(0.12) }));
    felt.position.set(0, -0.02, 0); felt.receiveShadow = true; scene.add(felt);
    // player rack tray (a warm wooden ledge under the hand)
    const tray = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 4, 0.5, TD + 1.2),
      new THREE.MeshStandardMaterial({ color: shade(THEME.rim, 0.08), roughness: 0.6, metalness: 0.15 }));
    tray.position.set(0, 0.06, RACK_Z + 0.2); tray.receiveShadow = true; scene.add(tray);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 4, 0.5, 0.35),
      new THREE.MeshStandardMaterial({ color: shade(THEME.rim, -0.1), roughness: 0.55, metalness: 0.2 }));
    lip.position.set(0, 0.28, RACK_Z + (TD + 1.2) / 2); scene.add(lip);
  })();

  // ── shared tile resources ──
  const bodyGeo = new THREE.BoxGeometry(TW, TTH, TD);
  const faceGeo = new THREE.PlaneGeometry(TW * 0.92, TD * 0.92);
  const IVORY = new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.55, metalness: 0.04, envMapIntensity: 0.5 });
  const _faceMat = {};   // key -> MeshBasicMaterial (cached; crisp, always legible)
  function faceKey(t) { return t.joker ? "J" : (t.c + "-" + t.n); }
  function faceTexture(t) {
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 168;
    const x = cv.getContext("2d");
    // ivory tile face with a soft top-light sheen
    const g = x.createLinearGradient(0, 0, 0, 168); g.addColorStop(0, "#fbf5e4"); g.addColorStop(1, "#ece0c4");
    x.fillStyle = g; roundRect(x, 4, 4, 120, 160, 16); x.fill();
    x.strokeStyle = "rgba(120,96,54,0.35)"; x.lineWidth = 3; roundRect(x, 4, 4, 120, 160, 16); x.stroke();
    if (t.joker) {
      x.fillStyle = "#d23b34"; x.font = "bold 64px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("★", 64, 66);
      x.fillStyle = "#26262c"; x.font = "bold 26px Georgia, serif"; x.fillText("JOKER", 64, 126);
    } else {
      const col = COL_CSS[t.c];
      x.fillStyle = col; x.font = "bold 92px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(t.n), 64, 78);
      // suit dot
      x.beginPath(); x.arc(64, 138, 11, 0, Math.PI * 2); x.fillStyle = col; x.fill();
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }
  function roundRect(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
  function faceMat(t) { const k = faceKey(t); if (!_faceMat[k]) _faceMat[k] = new THREE.MeshBasicMaterial({ map: faceTexture(t) }); return _faceMat[k]; }
  let _backMat = null;
  function backMat() {
    if (_backMat) return _backMat;
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 168; const x = cv.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 168); g.addColorStop(0, "#2a3550"); g.addColorStop(1, "#1a2136");
    x.fillStyle = g; roundRect(x, 4, 4, 120, 160, 16); x.fill();
    x.strokeStyle = "rgba(150,190,255,0.35)"; x.lineWidth = 3; roundRect(x, 14, 14, 100, 140, 12); x.stroke();
    x.fillStyle = "rgba(150,190,255,0.55)"; x.font = "bold 40px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("FF", 64, 84);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    _backMat = new THREE.MeshBasicMaterial({ map: tex }); return _backMat;
  }
  function makeTile(t, faceUp) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, IVORY); body.castShadow = true; body.receiveShadow = true; grp.add(body);
    const face = new THREE.Mesh(faceGeo, faceUp === false ? backMat() : faceMat(t));
    face.rotation.x = -Math.PI / 2; face.position.y = TTH / 2 + 0.011; grp.add(face);
    return grp;
  }

  // ══ RUMMIKUB SIM (pure logic) ══════════════════════════════════════════════
  // tile = { id, joker:false, c:0..3, n:1..13 }  or  { id, joker:true }
  function buildDeck() {
    const d = []; let id = 0;
    for (let copy = 0; copy < 2; copy++)
      for (let c = 0; c < 4; c++)
        for (let n = 1; n <= 13; n++) d.push({ id: id++, joker: false, c, n });
    d.push({ id: id++, joker: true }); d.push({ id: id++, joker: true });
    return d;   // 104 numbered + 2 jokers = 106
  }
  function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function removeById(arr, id) { const i = arr.findIndex((t) => t.id === id); if (i >= 0) return arr.splice(i, 1)[0]; return null; }

  // GROUP: 3-4 tiles, one number, distinct colours (jokers fill colours)
  function isGroup(tiles) {
    if (tiles.length < 3 || tiles.length > 4) return false;
    const reals = tiles.filter((t) => !t.joker), jok = tiles.length - reals.length;
    if (reals.length === 0) return false;
    const n = reals[0].n; if (reals.some((t) => t.n !== n)) return false;
    const cols = new Set(reals.map((t) => t.c)); if (cols.size !== reals.length) return false;
    if (reals.length + jok > 4) return false;
    return true;
  }
  // RUN: >=3 tiles, one colour, consecutive numbers (jokers fill gaps). Returns start or -1.
  function runStart(tiles) {
    const L = tiles.length; if (L < 3) return -1;
    const reals = tiles.filter((t) => !t.joker); if (reals.length === 0) return -1;
    const c = reals[0].c; if (reals.some((t) => t.c !== c)) return -1;
    const nums = reals.map((t) => t.n).sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1]) return -1;
    const low = nums[0], high = nums[nums.length - 1];
    const s0 = Math.max(1, high - L + 1), s1 = Math.min(low, 13 - L + 1);
    if (s0 > s1) return -1;
    return s0;   // canonical start: window [s0, s0+L-1] contains every real number
  }
  function isRun(tiles) { return runStart(tiles) >= 0; }
  function classify(tiles) { if (isGroup(tiles)) return "group"; if (isRun(tiles)) return "run"; return null; }
  function meldValue(tiles) {
    if (isGroup(tiles)) { const n = tiles.find((t) => !t.joker).n; return n * tiles.length; }
    const s = runStart(tiles); if (s < 0) return 0;
    let sum = 0; for (let i = 0; i < tiles.length; i++) sum += (s + i); return sum;
  }
  function handValue(rack) { let v = 0; for (const t of rack) v += t.joker ? 30 : t.n; return v; }

  // ── greedy extractor: pull valid melds out of a rack (runs favoured, jokers spared) ──
  function extractOnce(pool) {
    const reals = pool.filter((t) => !t.joker), jokers = pool.filter((t) => t.joker);
    let best = null;
    const consider = (tiles) => {
      if (!classify(tiles)) return;
      const rc = tiles.filter((t) => !t.joker).length;
      if (!best || tiles.length > best.tiles.length || (tiles.length === best.tiles.length && rc > best.reals))
        best = { tiles: tiles.slice(), reals: rc };
    };
    // runs, per colour
    for (let c = 0; c < 4; c++) {
      const present = {}; for (const t of reals) if (t.c === c && !present[t.n]) present[t.n] = t;
      for (let s = 1; s <= 13; s++) {
        let jokUse = 0; const seq = [];
        for (let n = s; n <= 13; n++) {
          if (present[n]) seq.push(present[n]);
          else if (jokUse < jokers.length) { seq.push(jokers[jokUse]); jokUse++; }
          else break;
          if (seq.length >= 3) consider(seq);
        }
      }
    }
    // groups, per number
    for (let n = 1; n <= 13; n++) {
      const g = []; for (let c = 0; c < 4; c++) { const t = reals.find((r) => r.c === c && r.n === n); if (t) g.push(t); }
      let ji = 0; const gg = g.slice(); while (gg.length < 3 && ji < jokers.length) { gg.push(jokers[ji]); ji++; }
      if (gg.length >= 3) { consider(gg.slice(0, 3)); if (g.length === 4) consider(g.slice()); }
    }
    return best ? best.tiles : null;
  }
  function extractMelds(rack) {
    const pool = rack.slice(), melds = [];
    while (true) { const m = extractOnce(pool); if (!m) break; for (const t of m) removeById(pool, t.id); melds.push(m); }
    return { melds, leftover: pool };
  }
  // AI turn plan: {newMelds, layoffs:[{tile,meldIdx}], value, tilesUsed}
  function aiPlan(rack, table, melded) {
    const { melds, leftover } = extractMelds(rack);
    const value = melds.reduce((s, m) => s + meldValue(m), 0);
    if (!melded) {
      if (value < 30) return { newMelds: [], layoffs: [], value: 0, tilesUsed: 0 };
      return { newMelds: melds, layoffs: [], value, tilesUsed: melds.reduce((s, m) => s + m.length, 0) };
    }
    const layoffs = [];
    const work = table.map((m) => m.tiles.slice());
    for (const t of leftover.slice()) {
      for (let mi = 0; mi < work.length; mi++) {
        if (classify(work[mi].concat([t]))) { work[mi].push(t); layoffs.push({ tile: t, meldIdx: mi }); break; }
      }
    }
    return { newMelds: melds, layoffs, value, tilesUsed: melds.reduce((s, m) => s + m.length, 0) + layoffs.length };
  }

  // ── pure-sim playout (proves the ruleset terminates) — no views ──
  function simulate(seed) {
    const rng = mulberry32(seed >>> 0);
    const deck = shuffle(buildDeck(), rng);
    const racks = [deck.splice(0, 14), deck.splice(0, 14)];
    const pool = deck;                    // 78
    const table = []; const melded = [false, false];
    let turn = 0, pass = 0, turns = 0, winner = -1;
    const HARD = 4000;
    while (turns < HARD) {
      turns++;
      const plan = aiPlan(racks[turn], table, melded[turn]);
      if (plan.tilesUsed > 0) {
        for (const m of plan.newMelds) { table.push({ kind: classify(m), tiles: m.slice() }); for (const t of m) removeById(racks[turn], t.id); }
        for (const lo of plan.layoffs) { table[lo.meldIdx].tiles.push(lo.tile); removeById(racks[turn], lo.tile.id); }
        melded[turn] = true; pass = 0;
        if (racks[turn].length === 0) { winner = turn; break; }
      } else if (pool.length > 0) {
        racks[turn].push(pool.shift()); pass = 0;
      } else {
        pass++; if (pass >= 2) break;
      }
      turn = 1 - turn;
    }
    if (winner < 0 && (racks[0].length === 0 || racks[1].length === 0)) winner = racks[0].length === 0 ? 0 : 1;
    if (winner < 0) winner = handValue(racks[0]) <= handValue(racks[1]) ? 0 : 1;   // pool-empty tie-break
    return { ended: turns < HARD, turns, winner, pool: pool.length, racks: [racks[0].length, racks[1].length], table: table.length };
  }

  // ══ VIEWS ══════════════════════════════════════════════════════════════════
  const tableGroup = new THREE.Group(); scene.add(tableGroup);
  const rackGroup = new THREE.Group(); scene.add(rackGroup);
  const benchGroup = new THREE.Group(); scene.add(benchGroup);
  const aiGroup = new THREE.Group(); scene.add(aiGroup);
  const hintGroup = new THREE.Group(); scene.add(hintGroup);
  function clear(g) { while (g.children.length) g.remove(g.children[0]); }

  function placeTile(group, t, x, z, faceUp, lift, meldIdx, rackId) {
    const m = makeTile(t, faceUp);
    m.position.set(x, TY + (lift || 0), z);
    if (meldIdx != null) m.userData.meldIndex = meldIdx;
    if (rackId != null) m.userData.rackId = rackId;
    group.add(m); return m;
  }

  function renderTable() {
    clear(tableGroup);
    const half = TABLE_W / 2 - 2, meldGap = TW * 0.8, rowH = TD + 0.55;
    let x = -half, z = -9.0;
    for (let mi = 0; mi < table.length; mi++) {
      const tiles = table[mi].tiles, w = tiles.length * PITCH;
      if (x + w > half && x > -half) { x = -half; z = Math.min(z + rowH, 4.0); }
      for (let i = 0; i < tiles.length; i++) placeTile(tableGroup, tiles[i], x + i * PITCH + TW / 2, z, true, 0, mi);
      x += w + meldGap;
    }
  }
  function rowLayout(group, tiles, z, faceUp, opts) {
    opts = opts || {};
    const perRow = 17;
    for (let i = 0; i < tiles.length; i++) {
      const row = Math.floor(i / perRow), inRow = Math.min(perRow, tiles.length - row * perRow);
      const col = i % perRow;
      const x = (col - (inRow - 1) / 2) * PITCH;
      const zz = z + row * (TD + 0.4) * (opts.rowDir || 1);
      const staged = opts.stagedSet && opts.stagedSet.has(tiles[i].id);
      const m = placeTile(group, tiles[i], x, zz, faceUp, staged ? 0.9 : 0, null, faceUp === false ? null : tiles[i].id);
      if (staged) { m.position.z -= 0.5; }
    }
  }
  function renderRack() {
    clear(rackGroup);
    sortRack();
    rowLayout(rackGroup, playerRack, RACK_Z, true, { stagedSet: new Set(staging), rowDir: 1 });
  }
  function renderBench() {
    clear(benchGroup);
    // pending sets + layoff piles laid in a soft green-lit row in front of the table
    const flat = [];
    for (const w of workbench) for (const t of w.tiles) flat.push(t);
    if (!flat.length) return;
    const total = flat.length; let idx = 0, x0 = -(Math.min(total, 17) - 1) / 2 * PITCH;
    let x = x0;
    for (const w of workbench) {
      for (const t of w.tiles) { placeTile(benchGroup, t, x, BENCH_Z, true, 0.15); x += PITCH; idx++; if (idx % 17 === 0) x = x0; }
      x += TW * 0.6;   // gap between staged sets
    }
    // faint glow ring under the bench
  }
  function renderAI() {
    clear(aiGroup);
    const n = aiRack.length, show = Math.min(n, 20);
    for (let i = 0; i < show; i++) {
      const x = (i - (show - 1) / 2) * (PITCH * 0.62);
      placeTile(aiGroup, { joker: false, c: 0, n: 0 }, x, AI_Z, false, 0);
    }
  }
  function renderAll() { renderTable(); renderRack(); renderBench(); renderAI(); }

  // selection lift feedback: subtle bob on the bench so pending tiles read as "in hand"
  let _bob = 0;
  kernel.onUpdate((dt) => { _bob += dt; benchGroup.position.y = Math.sin(_bob * 1.6) * 0.06; });

  // ── game state ──
  let deck = [], pool = [], playerRack = [], aiRack = [], table = [];
  let workbench = [];         // [{kind:'group'|'run'|'layoff', tiles:[...], meldIdx?}]
  let staging = [];           // rack tile ids currently selected
  let meldedP = false, meldedA = false;
  let turn = "player", phase = "menu", busy = false, passStreak = 0;
  let sortMode = "run";       // 'run' (colour then number) | 'group' (number then colour)
  let aiSkill = "casual";
  const DAWDLE = { gentle: 0.35, casual: 0.1, sharp: 0.0 };
  function sfx(n, v) { const u = content.sfx && content.sfx[n]; if (u) kernel.playSound(u, v == null ? 0.5 : v); }
  function sortRack() {
    if (sortMode === "group") playerRack.sort((a, b) => (a.joker - b.joker) || ((a.n || 99) - (b.n || 99)) || ((a.c || 0) - (b.c || 0)));
    else playerRack.sort((a, b) => (a.joker - b.joker) || ((a.c || 0) - (b.c || 0)) || ((a.n || 99) - (b.n || 99)));
  }
  const findRack = (id) => playerRack.find((t) => t.id === id);

  // ── HUD control bar (DOM; pointer-events enabled) ──
  let bar = null, statusEl = null, msgEl = null, btns = {};
  function buildBar() {
    if (bar) return;
    bar = document.createElement("div");
    bar.style.cssText = "position:absolute;left:0;right:0;bottom:14px;z-index:70;display:none;flex-direction:column;align-items:center;gap:8px;font-family:'Segoe UI',system-ui,monospace;pointer-events:none";
    statusEl = document.createElement("div");
    statusEl.style.cssText = "background:rgba(8,20,16,.72);border:1px solid rgba(120,220,180,.3);border-radius:9px;padding:6px 16px;color:#dff3e6;font-size:13px;letter-spacing:.5px;text-align:center;min-width:320px";
    msgEl = document.createElement("div");
    msgEl.style.cssText = "color:#8effc0;font-size:12.5px;min-height:16px;text-shadow:0 1px 3px #000";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;pointer-events:auto;flex-wrap:wrap;justify-content:center";
    const mk = (key, label, primary, cb) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "font:bold 13px 'Segoe UI',system-ui,monospace;padding:9px 16px;cursor:pointer;border-radius:7px;letter-spacing:.5px;transition:transform .08s;" +
        (primary ? "color:#062018;background:linear-gradient(#9dffb6,#4fe084);border:1px solid #7CFC9A"
                 : "color:#dfeaff;background:rgba(28,49,72,.9);border:1px solid #3a6c8c");
      b.onmouseenter = () => { b.style.transform = "translateY(-1px)"; };
      b.onmouseleave = () => { b.style.transform = "none"; };
      b.onclick = cb; btns[key] = b; row.appendChild(b); return b;
    };
    mk("add", "+ ADD SET", false, addSet);
    mk("play", "▶ PLAY", true, commitPlay);
    mk("draw", "DRAW", false, drawAndEnd);
    mk("sort", "SORT ⇄", false, () => { sortMode = sortMode === "run" ? "group" : "run"; sfx("click", .3); renderRack(); msg("Sorted by " + (sortMode === "run" ? "colour runs" : "number groups") + "."); });
    mk("clear", "↺ CLEAR", false, clearPending);
    bar.appendChild(statusEl); bar.appendChild(msgEl); bar.appendChild(row);
    (kernel.parent || document.body).appendChild(bar);
  }
  function showBar() { buildBar(); bar.style.display = "flex"; }
  function hideBar() { if (bar) bar.style.display = "none"; }
  function msg(t) { if (msgEl) msgEl.textContent = t || ""; }
  function updateHUD() {
    if (!statusEl) return;
    const benchVal = workbench.filter((w) => w.kind !== "layoff").reduce((s, w) => s + meldValue(w.tiles), 0);
    const you = turn === "player";
    statusEl.innerHTML =
      "<b style='color:" + (you ? "#8effc0" : "#ffd27a") + "'>" + (you ? "YOUR TURN" : "AI THINKING…") + "</b>" +
      "  │  Pool <b>" + pool.length + "</b>  │  You <b>" + playerRack.length + "</b>  │  AI <b>" + aiRack.length + "</b>" +
      "  │  " + (meldedP ? "melded" : ("initial meld " + benchVal + "/30"));
    const canAct = you && !busy && phase === "playing";
    btns.draw && (btns.draw.textContent = pool.length ? "DRAW" : "PASS");
    for (const k in btns) btns[k].disabled = !canAct;
    if (btns.sort) btns.sort.disabled = !(you && phase === "playing");
    for (const k in btns) btns[k].style.opacity = btns[k].disabled ? "0.5" : "1";
  }

  // ── player actions ──
  function toggleStage(id) {
    if (turn !== "player" || busy || phase !== "playing") return;
    const i = staging.indexOf(id);
    if (i >= 0) staging.splice(i, 1); else staging.push(id);
    sfx("select", .3); renderRack(); updateHUD();
  }
  function addSet() {
    if (turn !== "player" || busy || phase !== "playing") return;
    if (staging.length < 3) { msg("A set needs at least 3 tiles selected."); return; }
    const tiles = staging.map(findRack).filter(Boolean);
    const kind = classify(tiles);
    if (!kind) { msg("Those tiles are not a valid group or run."); return; }
    for (const t of tiles) removeById(playerRack, t.id);
    workbench.push({ kind, tiles }); staging = [];
    sfx("confirm", .4); renderRack(); renderBench(); updateHUD();
    msg((kind === "group" ? "Group" : "Run") + " staged — value " + meldValue(tiles) + ". Add more sets or Play.");
  }
  function layoffToMeld(meldIdx) {
    if (turn !== "player" || busy || phase !== "playing") return;
    if (!meldedP) { msg("Make your initial 30-point meld before laying off."); return; }
    if (staging.length === 0) { msg("Select rack tiles first, then click a set to extend it."); return; }
    const tiles = staging.map(findRack).filter(Boolean);
    const pend = workbench.filter((w) => w.kind === "layoff" && w.meldIdx === meldIdx).reduce((a, w) => a.concat(w.tiles), []);
    const combined = table[meldIdx].tiles.concat(pend).concat(tiles);
    if (!classify(combined)) { msg("Those tiles don't extend that set."); return; }
    for (const t of tiles) removeById(playerRack, t.id);
    workbench.push({ kind: "layoff", meldIdx, tiles }); staging = [];
    sfx("confirm", .4); renderRack(); renderBench(); updateHUD();
    msg("Laid off " + tiles.length + " tile(s). Play to confirm your turn.");
  }
  function clearPending() {
    if (turn !== "player" || busy || phase !== "playing") return;
    for (const w of workbench) for (const t of w.tiles) playerRack.push(t);
    workbench = []; staging = [];
    sfx("click", .3); renderRack(); renderBench(); updateHUD(); msg("Returned staged tiles to your rack.");
  }
  function commitPlay() {
    if (turn !== "player" || busy || phase !== "playing") return;
    const sets = workbench.filter((w) => w.kind !== "layoff");
    const lays = workbench.filter((w) => w.kind === "layoff");
    if (!sets.length && !lays.length) { msg("Nothing to play — form a set, or Draw."); return; }
    if (!meldedP) {
      const v = sets.reduce((s, w) => s + meldValue(w.tiles), 0);
      if (v < 30) { msg("Initial meld must total 30+ (you have " + v + "). Add more or Clear."); return; }
    }
    for (const w of sets) table.push({ kind: w.kind, tiles: w.tiles });
    for (const w of lays) table[w.meldIdx].tiles = table[w.meldIdx].tiles.concat(w.tiles);
    meldedP = true; workbench = []; staging = []; passStreak = 0;
    sfx("confirm", .5); renderTable(); renderRack(); renderBench(); updateHUD();
    if (playerRack.length === 0) { endGame(true, "You emptied your rack!"); return; }
    busy = true; turn = "ai"; updateHUD(); msg("");
    setTimeout(aiTurn, 520);
  }
  function drawAndEnd() {
    if (turn !== "player" || busy || phase !== "playing") return;
    if (workbench.length) clearPending();
    if (pool.length > 0) { playerRack.push(pool.shift()); passStreak = 0; sfx("click", .4); msg("You drew a tile."); }
    else { passStreak++; msg("Pool empty — you pass."); }
    renderRack(); updateHUD();
    if (pool.length === 0 && passStreak >= 2) return endByPass();
    busy = true; turn = "ai"; updateHUD();
    setTimeout(aiTurn, 520);
  }

  // ── AI turn ──
  function aiTurn() {
    if (phase !== "playing") { busy = false; return; }
    const plan = aiPlan(aiRack, table, meldedA);
    const dawdle = pool.length > 0 && Math.random() < (DAWDLE[aiSkill] || 0) && plan.value < 40;
    if (plan.tilesUsed > 0 && !dawdle) {
      for (const m of plan.newMelds) { table.push({ kind: classify(m), tiles: m.slice() }); for (const t of m) removeById(aiRack, t.id); }
      for (const lo of plan.layoffs) { table[lo.meldIdx].tiles.push(lo.tile); removeById(aiRack, lo.tile.id); }
      meldedA = true; passStreak = 0; renderTable(); renderAI(); sfx("confirm", .4);
      if (aiRack.length === 0) { endGame(false, "The AI emptied its rack."); return; }
    } else if (pool.length > 0) {
      aiRack.push(pool.shift()); passStreak = 0; renderAI(); sfx("click", .3);
    } else {
      passStreak++;
    }
    busy = false; turn = "player"; updateHUD();
    if (pool.length === 0 && passStreak >= 2) return endByPass();
  }

  // ── end ──
  function endByPass() { const pv = handValue(playerRack), av = handValue(aiRack); endGame(pv <= av, "Pool empty — fewest tile-points wins (you " + pv + " vs AI " + av + ")."); }
  function endGame(win, sub) {
    phase = "ended"; busy = false; sfx(win ? "victory" : "defeat", .7); hideBar();
    setTimeout(() => { if (shell) shell.end(win, sub || ""); }, 800);
  }

  // ── input (raycast) ──
  function onPointerDown(ev) {
    if (phase !== "playing" || busy || turn !== "player" || ev.button !== 0) return;
    const hits = kernel.raycast(ev.clientX, ev.clientY, scene.children);
    for (const h of hits) {
      let o = h.object;
      while (o && !(o.userData && (o.userData.rackId != null || o.userData.meldIndex != null)) && o.parent) o = o.parent;
      if (o && o.userData && o.userData.rackId != null) { toggleStage(o.userData.rackId); return; }
      if (o && o.userData && o.userData.meldIndex != null) { layoffToMeld(o.userData.meldIndex); return; }
    }
  }
  kernel.renderer.domElement.addEventListener("pointerdown", onPointerDown);

  // ── camera (straight, square-on toward the player rack) ──
  const span = Math.max(TABLE_W, TABLE_D);
  kernel.camera.fov = 42; kernel.camera.updateProjectionMatrix();
  const CAM = { x: 0, y: 25, z: 27 }, TARGET = { x: 0, y: 0, z: 0.5 };
  kernel.camera.position.set(CAM.x, CAM.y, CAM.z);
  const orbit = kernel.enableOrbit({ target: TARGET, minDistance: 16, maxDistance: span * 1.9, minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.46, rotateButton: "right", autoRotate: true, autoRotateSpeed: 0.3, wasdPan: false });

  // ── F3 debug overlay ──
  (function debugOverlay() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:10px;top:10px;z-index:9999;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#8effc0;background:rgba(6,14,20,.76);border:1px solid rgba(120,220,180,.35);border-radius:8px;padding:7px 11px;pointer-events:none;white-space:pre;display:none";
    (kernel.parent || document.body).appendChild(el);
    let on = false, frames = 0, acc = 0, fps = 0, lo = 999;
    kernel.onUpdate((dt) => {
      if (!on) return; frames++; acc += dt; const inst = dt > 0 ? 1 / dt : 0; if (inst < lo) lo = inst;
      if (acc >= 0.5) {
        fps = Math.round(frames / acc); frames = 0; acc = 0; const _lo = Math.round(lo); lo = 999;
        const r = kernel.renderer, info = r && r.info;
        el.textContent = "FPS " + fps + "  (low " + _lo + ")\nDPR " + (r ? r.getPixelRatio().toFixed(2) : "?") +
          "\ndraw calls " + (info ? info.render.calls : "?") + "\ntriangles " + (info ? info.render.triangles.toLocaleString() : "?") +
          "\npool " + pool.length + "  table " + table.length + "\nyou " + playerRack.length + "  ai " + aiRack.length + "  turn " + turn;
      }
    });
    window.addEventListener("keydown", (e) => { if (e.key === "F3" || e.code === "F3") { e.preventDefault(); on = !on; el.style.display = on ? "block" : "none"; if (on) el.textContent = "FPS …"; } });
    window.__RUMMIKUB_DEBUG__ = { toggle: () => { on = !on; el.style.display = on ? "block" : "none"; return on; }, fps: () => fps, state: () => ({ pool: pool.length, table: table.length, you: playerRack.length, ai: aiRack.length, turn, phase }) };
  })();

  // ── menu ambiance: a calm demo layout under the title ──
  function menuScene() {
    const rng = Math.random;
    const d = shuffle(buildDeck(), rng);
    table = [
      { kind: "run", tiles: d.filter((t) => !t.joker && t.c === 1 && t.n >= 4 && t.n <= 7).slice(0, 4) },
      { kind: "group", tiles: [d.find((t) => !t.joker && t.c === 0 && t.n === 9), d.find((t) => !t.joker && t.c === 2 && t.n === 9), d.find((t) => !t.joker && t.c === 3 && t.n === 9)].filter(Boolean) },
    ].filter((m) => m.tiles.length >= 3);
    playerRack = d.slice(0, 14); aiRack = d.slice(14, 28); pool = d.slice(28);
    staging = []; workbench = [];
    renderAll();
  }

  // ── shell wiring ──
  let shell = null;
  function beginGame() {
    phase = "playing";
    const rng = kernel._testRand ? mulberry32(20260713) : Math.random;
    deck = shuffle(buildDeck(), rng);
    playerRack = deck.splice(0, 14); aiRack = deck.splice(0, 14); pool = deck;
    table = []; workbench = []; staging = []; meldedP = false; meldedA = false; passStreak = 0;
    turn = "player"; busy = false; sortMode = "run";
    renderAll(); showBar(); updateHUD(); msg("Select tiles to form a set worth 30+ for your opening meld.");
    if (orbit) orbit.autoRotate = false;
    kernel.camera.position.set(CAM.x, CAM.y, CAM.z);
    if (orbit) { orbit.target.set(TARGET.x, TARGET.y, TARGET.z); orbit.update(); }
    try { music.start(); } catch (e) {}
    try { const _arm = () => { try { music.start(); } catch (e) {} window.removeEventListener("pointerdown", _arm); window.removeEventListener("keydown", _arm); }; window.addEventListener("pointerdown", _arm); window.addEventListener("keydown", _arm); } catch (e) {}
  }
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      title: content.title || "Rummikub",
      tagline: content.tagline || "",
      difficulties: ["Gentle", "Casual", "Sharp"],
      defaultDifficulty: "Casual",
      howTo: [
        { h: "GOAL", p: "Be the first to play every tile from your rack onto the table. A calm game of runs, groups and patient planning." },
        { h: "SETS", p: "Build GROUPS (the same number in different colours, 3–4 tiles) and RUNS (consecutive numbers in one colour, 3+ tiles). Left-click tiles in your rack to select them, then + ADD SET." },
        { h: "OPENING MELD", p: "Your first play must total at least 30 points across the sets you lay down. Until then you cannot lay off. Jokers count as the tile they stand in for." },
        { h: "LAY OFF", p: "Once you've melded, select a spare tile and click a set already on the table to extend it — a matching colour on the end of a run, or a missing colour in a group." },
        { h: "DRAW", p: "Can't (or don't want to) play? Press DRAW to take one tile from the pool and end your turn. Jokers are wild but worth 30 penalty points if left in your rack." },
      ],
      onPlay: (d) => { aiSkill = String(d || "casual").toLowerCase(); beginGame(); },
      onPause: () => { kernel.stop(); try { music.stop(); } catch (e) {} },
      onResume: () => { kernel.start(); try { music.start(); } catch (e) {} },
      onMusicVolume: (v) => { try { music.setVolume(v * 0.5); } catch (e) {} },
    });
    menuScene();
    shell.start();
  } else { menuScene(); beginGame(); }

  // ══ test hooks (parity / verification) ══════════════════════════════════════
  const controller = {
    __test: {
      start: () => { if (shell && shell.hide) shell.hide(); kernel._testRand = true; beginGame(); return true; },
      state: () => ({ phase, turn, busy, pool: pool.length, table: table.length,
        racks: { player: playerRack.length, ai: aiRack.length }, melded: { player: meldedP, ai: meldedA },
        deckTotal: pool.length + playerRack.length + aiRack.length + table.reduce((s, m) => s + m.tiles.length, 0) + workbench.reduce((s, w) => s + w.tiles.length, 0) }),
      counts: () => ({ pool: pool.length, player: playerRack.length, ai: aiRack.length,
        table: table.reduce((s, m) => s + m.tiles.length, 0), total: buildDeck().length }),
      hand: () => playerRack.map((t) => t.joker ? "J" : (COL_LBL[t.c] + t.n)),
      rackIds: () => playerRack.map((t) => ({ id: t.id, label: t.joker ? "J" : (COL_LBL[t.c] + t.n) })),
      workbench: () => workbench.map((w) => ({ kind: w.kind, meldIdx: w.meldIdx, tiles: w.tiles.length, value: w.kind === "layoff" ? 0 : meldValue(w.tiles) })),
      validate: (kind) => { // sanity: sample validators
        const R = [{ c: 1, n: 4, joker: false }, { c: 1, n: 5, joker: false }, { c: 1, n: 6, joker: false }];
        const G = [{ c: 0, n: 7, joker: false }, { c: 1, n: 7, joker: false }, { c: 2, n: 7, joker: false }];
        const bad = [{ c: 0, n: 3, joker: false }, { c: 1, n: 8, joker: false }, { c: 2, n: 11, joker: false }];
        return { run: isRun(R), group: isGroup(G), bad: classify(bad), runVal: meldValue(R), groupVal: meldValue(G) };
      },
      // drive one turn of the LIVE (view-bound) game using the AI logic for whoever's turn it is
      step: () => {
        if (phase !== "playing" || busy) return { ok: false, reason: "not-ready" };
        const before = { pool: pool.length, you: playerRack.length, ai: aiRack.length, table: table.length };
        if (turn === "player") {
          const plan = aiPlan(playerRack, table, meldedP);
          if (plan.tilesUsed > 0) {
            for (const m of plan.newMelds) { table.push({ kind: classify(m), tiles: m.slice() }); for (const t of m) removeById(playerRack, t.id); }
            for (const lo of plan.layoffs) { table[lo.meldIdx].tiles.push(lo.tile); removeById(playerRack, lo.tile.id); }
            meldedP = true; passStreak = 0; renderTable(); renderRack(); updateHUD();
            if (playerRack.length === 0) { endGame(true, "You emptied your rack."); return { ok: true, played: true, ended: true, before, after: { you: 0 } }; }
            turn = "ai"; updateHUD();
          } else { return drawAndEndSilently(); }
        } else {
          busy = false; aiTurn();
        }
        return { ok: true, before, after: { pool: pool.length, you: playerRack.length, ai: aiRack.length, table: table.length }, turn };
      },
      draw: () => { if (turn === "player" && !busy && phase === "playing") { drawAndEnd(); return true; } return false; },
      // ── drive the REAL interactive handlers (what a human click triggers) ──
      stage: (id) => { toggleStage(id); return staging.slice(); },
      addSet: () => { const b = workbench.length; addSet(); return workbench.length > b; },
      layoff: (meldIdx) => { const b = workbench.length; layoffToMeld(meldIdx); return workbench.length > b; },
      play: () => { commitPlay(); return { turn, table: table.length, you: playerRack.length, phase }; },
      clearPending: () => { clearPending(); return workbench.length === 0; },
      // one full HUMAN turn via the real toggleStage→addSet→commitPlay/drawAndEnd path
      humanTurn: () => {
        if (phase !== "playing" || turn !== "player" || busy) return { ok: false, reason: "not-your-turn", turn, busy, phase };
        const before = { pool: pool.length, you: playerRack.length, table: table.length, melded: meldedP };
        const { melds } = extractMelds(playerRack);
        const value = melds.reduce((s, m) => s + meldValue(m), 0);
        if (melds.length && (meldedP || value >= 30)) {
          for (const m of melds) { staging = []; for (const t of m) toggleStage(t.id); addSet(); }
          commitPlay();
          return { ok: true, action: "played", sets: melds.length, value, before, after: { pool: pool.length, you: playerRack.length, table: table.length, phase } };
        }
        drawAndEnd();
        return { ok: true, action: "drew", before, after: { pool: pool.length, you: playerRack.length, phase } };
      },
      // pure-sim playout — PROVES the ruleset terminates (no views)
      autoResolve: (seed) => simulate(seed == null ? ((Math.random() * 1e9) | 0) : seed),
      // deterministic multi-game soak: every game must terminate
      soak: (n) => { let ended = 0, maxTurns = 0, wins = [0, 0]; n = n || 40; for (let i = 0; i < n; i++) { const r = simulate(1000 + i); if (r.ended) ended++; if (r.turns > maxTurns) maxTurns = r.turns; if (r.winner >= 0) wins[r.winner]++; } return { games: n, ended, maxTurns, wins }; },
      setSkill: (s) => { aiSkill = String(s || "casual").toLowerCase(); return aiSkill; },
      // deterministic board setups for exercising the interactive PLAY / gate / layoff paths
      dealTest: (mode) => {
        phase = "playing"; turn = "player"; busy = false; passStreak = 0; workbench = []; staging = [];
        const fresh = buildDeck();
        const take = (pred) => { const i = fresh.findIndex(pred); return i >= 0 ? fresh.splice(i, 1)[0] : null; };
        const T = (c, n) => take((t) => !t.joker && t.c === c && t.n === n);
        if (mode === "layoff") {
          meldedP = true; meldedA = true;
          table = [{ kind: "run", tiles: [T(0, 11), T(0, 12), T(0, 13)] }];   // red 11-12-13 on the table
          playerRack = [T(0, 5), T(1, 5), T(2, 5), T(0, 10)].filter(Boolean);  // 5s group + red 10 to lay off
        } else {
          meldedP = false; meldedA = false; table = [];
          playerRack = [T(0, 11), T(0, 12), T(0, 13), T(0, 5), T(1, 5), T(2, 5)].filter(Boolean); // run 36 + group 15
        }
        aiRack = fresh.splice(0, 14); pool = fresh;
        renderAll(); showBar(); updateHUD();
        return { mode: mode || "open", player: playerRack.length, table: table.length, hand: playerRack.map((t) => t.joker ? "J" : (COL_LBL[t.c] + t.n)) };
      },
    },
  };
  function drawAndEndSilently() {
    const before = { pool: pool.length, you: playerRack.length, ai: aiRack.length, table: table.length };
    if (pool.length > 0) { playerRack.push(pool.shift()); passStreak = 0; } else passStreak++;
    renderRack(); turn = "ai"; updateHUD();
    if (pool.length === 0 && passStreak >= 2) { endByPass(); return { ok: true, ended: true, before }; }
    return { ok: true, drew: true, before, after: { pool: pool.length, you: playerRack.length, ai: aiRack.length, table: table.length } };
  }
  return controller;
});

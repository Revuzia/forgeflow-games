/**
 * FFG runtime — 3d/ffg_elysium3d.js  (ES module)
 * ELYSIUM REALMS — luminous tile-laying realm-builder (Carcassonne, reimagined). Registers "elysium3d".
 *
 * MILESTONE M2-turns: per-player turns + Guardian/meeple ownership + majority scoring on
 * completion + a basic AI opponent, on the verified rules core (ffg_elysium_rules.js). You vs
 * Ashen AI: lay a tile (edge-matched), optionally claim a road/city/temple with a Guardian,
 * complete features to score them to the majority owner (Guardians return). Affinity Harmony
 * bonuses fold in. Next: N seats (2–5), then art decals, then online via ffg_seatplay.
 */
import * as THREE from "three";
const _V = new URL(import.meta.url).search;
const { register3d } = await import("./ffg_kernel_3d.js" + _V);
const R = await import("./ffg_elysium_rules.js" + _V);

const T = 4.2;
const AFF_COL = { ember: 0xe0885a, tide: 0x6ed4ce, gale: 0xbcd4f0, stone: 0xc8a878, lumen: 0x9be9dc };
const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

register3d("elysium3d", async (kernel, content) => {
  const { scene, camera } = kernel;
  const loader = new THREE.TextureLoader();
  const tex = (p) => { const t = loader.load(p); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

  scene.background = new THREE.Color(0x070912);
  scene.fog = new THREE.FogExp2(0x0a0d18, 0.012);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 54), new THREE.MeshStandardMaterial({ map: tex("assets/art/board_bg.jpg"), roughness: 1, color: 0x8f9ac0 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; ground.receiveShadow = true; scene.add(ground);
  const key = new THREE.DirectionalLight(0xffe9c4, 2.2); key.position.set(14, 22, 10);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.far = 80;
  key.shadow.camera.left = -30; key.shadow.camera.right = 30; key.shadow.camera.top = 30; key.shadow.camera.bottom = -30; scene.add(key);
  scene.add(new THREE.DirectionalLight(0x9be9dc, 0.8).translateX(-16).translateY(12).translateZ(-14));
  scene.add(new THREE.HemisphereLight(0x6a7bbf, 0x171326, 0.55));
  scene.add(new THREE.AmbientLight(0x3b4368, 0.34));

  // painted xAI textures (grok-imagine): glowing meadow base + stone road + alabaster city
  const meadowTex = tex("assets/tex/meadow.jpg"), roadTex = tex("assets/tex/road.jpg"), cityTex = tex("assets/tex/city.jpg");
  [meadowTex, roadTex, cityTex].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  const M = {
    grass: () => new THREE.MeshStandardMaterial({ map: meadowTex, roughness: 0.9, emissive: new THREE.Color(0x1a3a2e), emissiveIntensity: 0.12 }),
    side: new THREE.MeshStandardMaterial({ color: 0x1b2438, roughness: 0.82 }),
    road: new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.74 }),
    city: new THREE.MeshStandardMaterial({ map: cityTex, roughness: 0.5, metalness: 0.05 }),
    cityTrim: new THREE.MeshStandardMaterial({ color: 0xe8c877, roughness: 0.4, metalness: 0.5, emissive: new THREE.Color(0x6a5010), emissiveIntensity: 0.3 }),
    temple: new THREE.MeshStandardMaterial({ color: 0xe7e0ce, roughness: 0.5 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x9be9dc, emissive: new THREE.Color(0x9be9dc), emissiveIntensity: 1.4, toneMapped: false }),
  };
  // ── 3D prop dressing (trees/grass on fields, walled town clusters on cities, waystone lamps on roads) ──
  const propMat = {
    trunk: new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.9 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x2e7d46, roughness: 0.85, flatShading: true }),
    grass: new THREE.MeshStandardMaterial({ color: 0x4f9a48, roughness: 0.9, flatShading: true }),
    stone: new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.62 }),
    stoneDk: new THREE.MeshStandardMaterial({ color: 0xbfae8e, roughness: 0.7, flatShading: true }),
    roof: new THREE.MeshStandardMaterial({ color: 0xb0533a, roughness: 0.72, flatShading: true }),
    win: new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: new THREE.Color(0xffb347), emissiveIntensity: 0.9, roughness: 0.4, toneMapped: false }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x9be9dc, emissive: new THREE.Color(0x9be9dc), emissiveIntensity: 1.3, roughness: 0.3, toneMapped: false }),
    pole: new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: 0.7 }),
  };
  const noShadow = (o) => { o.traverse((m) => { if (m.isMesh) m.castShadow = false; }); return o; };
  function conifer(x, z, s) {
    const t = new THREE.Group(), h = (0.9 + Math.random() * 0.7) * s;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, h * 0.4, 5), propMat.trunk); tr.position.y = h * 0.2; t.add(tr);
    for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry((0.34 - k * 0.08) * s, 0.5 * s, 6), propMat.leaf); c.position.y = h * 0.4 + k * 0.26 * s; t.add(c); }
    t.position.set(x, 0.2, z); return noShadow(t);
  }
  function grassTuft(x, z) {
    const t = new THREE.Group(); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16 + Math.random() * 0.12, 3), propMat.grass); b.position.set((Math.random() - 0.5) * 0.16, 0.08, (Math.random() - 0.5) * 0.16); b.rotation.z = (Math.random() - 0.5) * 0.5; t.add(b); } t.position.set(x, 0.2, z); return t;
  }
  // a small stone town (neutral) tucked behind a city wall on edge d — houses + a central tower
  function cityCluster(d) {
    const g = new THREE.Group(), ex = DIR[d][0], ez = DIR[d][1];
    for (const off of [-0.24, 0.24]) {
      const hx = ex * T * 0.3 + (ex === 0 ? off * T : 0), hz = ez * T * 0.3 + (ez === 0 ? off * T : 0);
      const house = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(T * 0.15, 0.34, T * 0.15), propMat.stone); body.position.y = 0.17; house.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(T * 0.13, 0.28, 4), propMat.roof); roof.rotation.y = Math.PI / 4; roof.position.y = 0.47; house.add(roof);
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.03), propMat.win); w.position.set(0, 0.2, T * 0.075); house.add(w);
      house.position.set(hx, 0, hz); house.rotation.y = ex !== 0 ? Math.PI / 2 : 0; g.add(house);
    }
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.09, T * 0.11, 0.82, 6), propMat.stoneDk); tw.position.set(ex * T * 0.33, 0.41, ez * T * 0.33); g.add(tw);
    const tr = new THREE.Mesh(new THREE.ConeGeometry(T * 0.14, 0.34, 6), propMat.roof); tr.position.set(ex * T * 0.33, 0.95, ez * T * 0.33); g.add(tr);
    const bann = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.13), M.cityTrim); bann.position.set(ex * T * 0.33, 1.18, ez * T * 0.33); g.add(bann);
    return noShadow(g);
  }
  function renderTile(arch, rot, affinity, ghost) {
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(T * 0.96, 0.4, T * 0.96), [M.side, M.side, M.grass(affinity), M.side, M.side, M.side]);
    slab.castShadow = slab.receiveShadow = true; g.add(slab);
    const edges = [0, 1, 2, 3].map((d) => R.edgeAt({ arch, rot }, d));
    for (let d = 0; d < 4; d++) {
      const f = edges[d], ex = DIR[d][0], ez = DIR[d][1], odd = d % 2;
      if (f === "r") {
        const road = new THREE.Mesh(new THREE.BoxGeometry(odd ? T * 0.5 : T * 0.18, 0.08, odd ? T * 0.18 : T * 0.5), M.road); road.position.set(ex * T * 0.25, 0.22, ez * T * 0.25); g.add(road);
        if (!ghost) { const lamp = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 0.72, 5), propMat.pole); pole.position.y = 0.36; lamp.add(pole); const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), propMat.lamp); orb.position.y = 0.76; lamp.add(orb); lamp.position.set(ex * T * 0.4 + ez * T * 0.22, 0.2, ez * T * 0.4 + ex * T * 0.22); g.add(noShadow(lamp)); }
      } else if (f === "c") {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(odd ? T * 0.2 : T * 0.9, 0.55, odd ? T * 0.9 : T * 0.2), M.city); wall.position.set(ex * T * 0.42, 0.3, ez * T * 0.42); g.add(wall);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(odd ? T * 0.08 : T * 0.9, 0.1, odd ? T * 0.9 : T * 0.08), M.cityTrim); trim.position.set(ex * T * 0.42, 0.6, ez * T * 0.42); g.add(trim);
        if (!ghost) g.add(cityCluster(d));
      }
    }
    // scatter field props on the four corners, skipping any corner walled in by two city edges
    if (!ghost) {
      for (const [sx, sz, ea, eb] of [[1, -1, 0, 1], [1, 1, 1, 2], [-1, 1, 2, 3], [-1, -1, 3, 0]]) {
        if (edges[ea] === "c" && edges[eb] === "c") continue;
        const cx = sx * T * 0.32, cz = sz * T * 0.32;
        if (edges[ea] === "c" || edges[eb] === "c") { g.add(grassTuft(cx, cz)); continue; }
        if (Math.random() < 0.7) g.add(conifer(cx, cz, 0.9 + Math.random() * 0.35)); else g.add(grassTuft(cx, cz));
      }
    }
    if (arch.temple) {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.15, T * 0.19, 0.55, 8), M.temple); body.position.y = 0.35; g.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(T * 0.23, 0.36, 8), propMat.roof); roof.position.y = 0.73; g.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.04), propMat.win); win.position.set(0, 0.34, T * 0.19); g.add(win);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(T * 0.07, 0.42, 8), M.glow); spire.position.y = 1.08; g.add(spire);
    }
    const rim = new THREE.Mesh(new THREE.BoxGeometry(T * 0.99, 0.06, T * 0.99), new THREE.MeshBasicMaterial({ color: AFF_COL[affinity] || 0x9be9dc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.position.y = 0.21; g.add(rim);
    if (ghost) g.traverse((o) => {
      if (!o.isMesh) return;
      const mk = (mm) => { const c = mm.clone(); c.transparent = true; c.opacity = 0.45; c.depthWrite = false; return c; };
      o.material = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);   // slab top uses a material ARRAY — arrays have no .clone()
    });
    return g;
  }

  const MOTES = 80, mg = new THREE.BufferGeometry(), mp = new Float32Array(MOTES * 3), mph = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) { mp[i * 3] = (Math.random() - 0.5) * 40; mp[i * 3 + 1] = Math.random() * 8 + 0.5; mp[i * 3 + 2] = (Math.random() - 0.5) * 26; mph[i] = Math.random() * 6.28; }
  mg.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  scene.add(new THREE.Points(mg, new THREE.PointsMaterial({ color: 0x9be9dc, size: 0.16, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })));

  camera.fov = 42; camera.updateProjectionMatrix(); camera.position.set(0, 26, 22);
  const orbit = kernel.enableOrbit({ target: { x: 0, y: 0, z: 0 }, minDistance: T * 3.2, maxDistance: T * 12, minPolarAngle: 0.18, maxPolarAngle: Math.PI * 0.46, rotateButton: "right", autoRotate: true, autoRotateSpeed: 0.28, wasdPan: true, panSpeed: T * 0.6 });
  if (kernel.enableBloom) kernel.enableBloom({ ssao: false, strength: 0.55, radius: 0.6, threshold: 0.8 });

  const mkHud = (css) => { const d = document.createElement("div"); d.style.cssText = css; (kernel.parent || document.body).appendChild(d); d.style.display = "none"; return d; };
  const topBar = mkHud("position:absolute;top:14px;left:0;right:0;text-align:center;z-index:42;font-family:'Segoe UI',system-ui,monospace;pointer-events:none");
  const actionBar = mkHud("position:absolute;bottom:18px;left:0;right:0;text-align:center;z-index:43;font-family:'Segoe UI',system-ui,monospace;pointer-events:none");
  // "TILE BAG → YOU DREW" — each turn a random tile is drawn from the bag (the shuffled deck). Show
  // the BAG (face-down stack + remaining count) AND the drawn tile so the Carcassonne draw reads clearly.
  const tilePanel = document.createElement("div");
  tilePanel.style.cssText = "position:absolute;top:58px;right:16px;z-index:43;font-family:'Segoe UI',system-ui;pointer-events:none;text-align:center;display:none";
  const bagEl = document.createElement("div"); bagEl.style.cssText = "margin-bottom:7px";
  const tileCap = document.createElement("div"); tileCap.textContent = "YOU DREW"; tileCap.style.cssText = "color:#e8c877;font:800 10px 'Segoe UI';letter-spacing:2px;margin-bottom:4px";
  const tileCanvas = document.createElement("canvas"); tileCanvas.width = tileCanvas.height = 108; tileCanvas.style.cssText = "border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.55)";
  const tileHint = document.createElement("div"); tileHint.innerHTML = "↻ press <b>R</b> to rotate"; tileHint.style.cssText = "margin-top:5px;color:#bfe0d8;font:600 11px 'Segoe UI'";
  tilePanel.append(bagEl, tileCap, tileCanvas, tileHint);
  (kernel.parent || document.body).appendChild(tilePanel);

  // ── seats + turn/meeple state ──
  const SEAT_COLORS = [0x7CFC9A, 0xff9a6a, 0x9bb8ff, 0xffe27a, 0xd08cff], AI_NAMES = ["Ashen", "Umbral", "Cinder", "Verdant"];
  let SEATS = [{ name: "You", ai: false, color: SEAT_COLORS[0] }, { name: "Ashen AI", ai: true, color: SEAT_COLORS[1] }];
  let gcfg = { total: 2, ais: 1 };   // creator-chosen roster: total 2–5, `ais` AI-filled, rest hotseat humans
  function buildSeats() {
    SEATS = []; const humans = gcfg.total - gcfg.ais;
    for (let i = 0; i < humans; i++) SEATS.push({ name: i === 0 ? "You" : "Player " + (i + 1), ai: false, color: SEAT_COLORS[SEATS.length] });
    for (let i = 0; i < gcfg.ais; i++) SEATS.push({ name: AI_NAMES[i % 4] + " AI", ai: true, color: SEAT_COLORS[SEATS.length] });
  }
  let phase = "menu", board = null, deck = null, di = 0, cur = null, rot = 0, curAff = "lumen";
  let curSeat = 0, turnState = "place", lastPlaced = null, hoverCell = null, ghost = null;
  let scores = [0, 0], guardians = [7, 7], meeples = [], scoredSigs = new Set();
  // ── online (ffg_seatplay) ──
  let netMode = false, seatplay = null, _spApi = null, mySeat = 0, _applyingRemote = false, _committedRot = 0, _committedAff = "lumen";
  const world = new THREE.Group(); scene.add(world);
  const placedG = new Map(), pads = [], claimMarks = [];
  let MAP_SEED = 12345;         // realm seed: tile order + affinities (randomised per game)
  let rng = R.makeRng(12345);   // reseeded in beginGame so every online client shares one stream

  // ── portal integration: achievements + weekly leaderboard (no-ops outside the portal iframe) ──
  const _achDone = new Set();
  function ach(slug) { if (_achDone.has(slug)) return; _achDone.add(slug); try { if (window.ForgeFlow && window.ForgeFlow.unlockAchievement) window.ForgeFlow.unlockAchievement(slug); } catch (e) {} }
  function submitFinalScore(n) { try { if (window.ForgeFlow && window.ForgeFlow.gameOver) window.ForgeFlow.gameOver(Math.max(0, n | 0)); } catch (e) {} }
  const localSeat = () => (netMode ? mySeat : 0);   // the seat this human owns (offline hotseat = seat 0)
  // ── accessibility: honor prefers-reduced-motion + a polite live region for screen readers ──
  const reduceMotion = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
  const liveRegion = (() => { const d = document.createElement("div"); d.setAttribute("role", "status"); d.setAttribute("aria-live", "polite"); d.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"; (kernel.parent || document.body).appendChild(d); return d; })();
  let _lastSpoken = "";
  function announce(msg) { if (!msg || msg === _lastSpoken) return; _lastSpoken = msg; liveRegion.textContent = msg; }
  function hx(c) { return "#" + c.toString(16).padStart(6, "0"); }
  // draw the current tile as a top-down schematic (field green, tan city bands, brown road spokes, temple dot, affinity frame)
  function drawTileCard() {
    const show = phase === "playing" && cur && !SEATS[curSeat].ai && turnState === "place";
    tilePanel.style.display = show ? "block" : "none";
    if (!show) return;
    // the BAG: a face-down stack whose count shrinks as tiles are drawn
    const left = deck ? deck.length - di : 0;
    bagEl.innerHTML =
      `<div style="color:#9fb4cc;font:800 10px 'Segoe UI';letter-spacing:2px;margin-bottom:3px">TILE BAG</div>`
      + `<div style="position:relative;height:42px;width:54px;margin:0 auto">`
      + [0, 1, 2, 3, 4].map((i) => `<div style="position:absolute;left:${i * 3}px;top:${9 - i * 2}px;width:38px;height:30px;border-radius:5px;background:linear-gradient(150deg,#2c4258,#182634);border:1px solid #4a6a82;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`).join("")
      + `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9be9dc;font:800 15px 'Segoe UI';z-index:2;text-shadow:0 1px 3px #000">${left}</div></div>`
      + `<div style="color:#8fb0a8;font:700 10px 'Segoe UI';margin-top:2px">${left} left · drew ↓</div>`;
    const S = tileCanvas.width, c = tileCanvas.getContext("2d"), m = 8, cx = S / 2, cy = S / 2, bw = 15;
    c.clearRect(0, 0, S, S);
    c.fillStyle = "#4f8a4a"; c.fillRect(m, m, S - 2 * m, S - 2 * m);
    const edges = [0, 1, 2, 3].map((d) => R.edgeAt({ arch: cur, rot }, d));   // N,E,S,W (matches DIR)
    c.fillStyle = "#d9c9a3";
    edges.forEach((f, d) => { if (f !== "c") return;
      if (d === 0) c.fillRect(m, m, S - 2 * m, bw); else if (d === 1) c.fillRect(S - m - bw, m, bw, S - 2 * m);
      else if (d === 2) c.fillRect(m, S - m - bw, S - 2 * m, bw); else c.fillRect(m, m, bw, S - 2 * m);
    });
    c.strokeStyle = "#8a6a3a"; c.lineWidth = 7; c.lineCap = "round";
    const ep = [[cx, m], [S - m, cy], [cx, S - m], [m, cy]];
    edges.forEach((f, d) => { if (f !== "r") return; c.beginPath(); c.moveTo(cx, cy); c.lineTo(ep[d][0], ep[d][1]); c.stroke(); });
    if (cur.temple) { c.fillStyle = "#e7e0ce"; c.beginPath(); c.arc(cx, cy, 11, 0, 7); c.fill(); c.lineWidth = 2.5; c.strokeStyle = "#9be9dc"; c.stroke(); }
    c.strokeStyle = hx(AFF_COL[curAff] || 0x9be9dc); c.lineWidth = 4; c.strokeRect(m - 3, m - 3, S - 2 * m + 6, S - 2 * m + 6);
  }
  function updateHud() {
    drawTileCard();
    if (phase === "menu" || phase === "ended") { topBar.style.display = "none"; actionBar.style.display = "none"; return; }
    topBar.style.display = "block";
    const chips = SEATS.map((s, i) => {
      const on = i === curSeat, col = hx(s.color);
      return `<span style="display:inline-block;margin:0 4px;padding:5px 13px;border-radius:20px;font:700 13px 'Segoe UI';letter-spacing:.3px;`
        + `background:${on ? "rgba(155,233,220,.16)" : "rgba(8,16,28,.72)"};border:1px solid ${on ? col : "#33465f88"};`
        + `box-shadow:${on ? "0 0 14px " + col + "66" : "none"};color:${col}">${on ? "▸ " : ""}${s.name} ✦${scores[i]} <span style="opacity:.65">${guardians[i]}⛨</span></span>`;
    }).join("");
    const turn = SEATS[curSeat].ai ? `${SEATS[curSeat].name} is weaving the realm…`
      : (turnState === "claim" ? "Claim a feature — click a glowing gold ring, or Skip" : "Your tile is top-right ↗ — click a glowing green pad to lay it · press R to rotate");
    topBar.innerHTML = `<div>${chips}</div>`
      + `<div style="margin-top:7px;display:inline-block;background:rgba(8,14,24,.8);border:1px solid #9be9dc44;border-radius:8px;padding:4px 16px;font:600 13px 'Segoe UI';color:#cfe8e2">`
      + `<span style="opacity:.9">${turn}</span> <span style="opacity:.5">·　${deck ? deck.length - di : 0} tiles left</span></div>`;
    announce(`${SEATS[curSeat].name}. ${turn}. Scores: ` + SEATS.map((s, i) => `${s.name} ${scores[i]}`).join(", "));
    renderActionBar();
  }
  function renderActionBar() {
    if (phase !== "playing" || SEATS[curSeat].ai) { actionBar.style.display = "none"; return; }
    actionBar.style.display = "block";
    const btn = (a, label, primary) => `<button data-a="${a}" style="pointer-events:auto;cursor:pointer;margin:0 5px;padding:11px 22px;border-radius:11px;`
      + `border:1px solid ${primary ? "#7CFC9A" : "#3a4d66"};background:${primary ? "linear-gradient(#4fd06a,#2fa050)" : "rgba(14,22,38,.9)"};`
      + `color:${primary ? "#06210f" : "#dfeaff"};font:800 14px 'Segoe UI';letter-spacing:.4px;box-shadow:0 3px 12px rgba(0,0,0,.4)">${label}</button>`;
    const canUndo = !netMode && undoStack.length > 0;
    actionBar.innerHTML = (turnState === "claim"
      ? btn("skip", "Skip Claim ▸", true)
      : btn("rot", "⟳ Rotate", false) + btn("rotb", "⟲", false))
      + (canUndo ? btn("undo", "↶ Undo", false) : "");
    actionBar.querySelectorAll("button").forEach((b) => {
      const a = b.dataset.a;
      b.setAttribute("aria-label", a === "skip" ? "Skip claiming a feature and end your turn" : a === "rot" ? "Rotate the tile clockwise" : a === "rotb" ? "Rotate the tile counter-clockwise" : "Undo your last move");
      b.onclick = () => {
        if (a === "skip") { if (turnState === "claim") endLocalTurn(null); }   // snapshot already taken in humanPlace
        else if (a === "rot") { rot = (rot + 1) % 4; recomputeValid(); updateGhost(); }
        else if (a === "rotb") { rot = (rot + 3) % 4; recomputeValid(); updateGhost(); }
        else if (a === "undo") undoTurn();
      };
    });
  }
  function drawTileGroup(t, x, y) { const g = renderTile(t.arch, t.rot, t.affinity); g.position.set(x * T, 0.25, y * T); world.add(g); placedG.set(R.key(x, y), g); }
  function clearPads() { for (const p of pads) world.remove(p); pads.length = 0; }
  function clearClaimMarks() { for (const m of claimMarks) world.remove(m); claimMarks.length = 0; }
  function renderMeeple(seat, x, y, d, kind) {
    const mat = new THREE.MeshStandardMaterial({ color: SEATS[seat].color, emissive: new THREE.Color(SEATS[seat].color), emissiveIntensity: 0.4, roughness: 0.4, toneMapped: false });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(T * 0.12, T * 0.42, 6), mat); body.position.y = T * 0.21; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(T * 0.1, 10, 8), mat); head.position.y = T * 0.46; g.add(head);
    let px = x * T, pz = y * T; if (d >= 0) { px += DIR[d][0] * T * 0.3; pz += DIR[d][1] * T * 0.3; }
    g.position.set(px, 0.5, pz); g.castShadow = true; world.add(g); return g;
  }
  function flash(x, y) {
    const f = new THREE.Mesh(new THREE.RingGeometry(T * 0.3, T * 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.rotation.x = -Math.PI / 2; f.position.set(x * T, 0.9, y * T); world.add(f);
    let life = 0.7; kernel.onUpdate((dt) => { life -= dt; f.scale.multiplyScalar(1 + dt * 2); f.material.opacity = Math.max(0, life); if (life <= 0) world.remove(f); });
  }
  // pulse the placement pads so they clearly read as clickable targets (steady when the OS asks for reduced motion)
  let padT = 0;
  kernel.onUpdate((dt) => { padT += dt; const o = reduceMotion ? 0.8 : 0.45 + Math.abs(Math.sin(padT * 2.6)) * 0.5; for (const p of pads) if (p.material) p.material.opacity = o; });

  function recomputeValid() {
    clearPads();
    if (!cur || SEATS[curSeat].ai || turnState !== "place") { updateHud(); return; }
    for (const p of R.legalPlacements(board, cur).filter((p) => p.rot === rot)) {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.9, T * 0.9), new THREE.MeshBasicMaterial({ color: 0x7CFC9A, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(p.x * T, 0.05, p.y * T); world.add(pad); pads.push(pad);
    }
    updateHud();
  }
  function updateGhost() {
    if (ghost) { world.remove(ghost); ghost = null; }
    if (!cur || !hoverCell || turnState !== "place" || SEATS[curSeat].ai) return;
    if (!R.isValid(board, { arch: cur, rot }, hoverCell.x, hoverCell.y)) return;
    ghost = renderTile(cur, rot, curAff, true); ghost.position.set(hoverCell.x * T, 0.28, hoverCell.y * T); world.add(ghost);
  }

  function drawNext() {
    cur = null;
    while (di < deck.length) { const a = deck[di++]; if (R.legalPlacements(board, a).length) { cur = a; break; } }
    if (!cur) { endGame(); return; }
    curAff = R.AFFINITIES[(rng() * R.AFFINITIES.length) | 0];
    // start at the rotation with the MOST legal spots so a glowing pad ALWAYS appears immediately
    // (fixes the dead-end where rot 0 has no valid placement and the board looks empty)
    const counts = [0, 0, 0, 0]; for (const p of R.legalPlacements(board, cur)) counts[p.rot]++;
    rot = 0; for (let r = 1; r < 4; r++) if (counts[r] > counts[rot]) rot = r;
  }
  function startTurn() {
    if (phase !== "playing") return;
    turnState = "place"; drawNext();             // MUST run on every client — advances deck+affinity in lockstep
    if (!cur) return;
    if (netMode) return;                          // online: seatplay._dispatch -> iface.onTurn drives whose turn it is + AI
    if (SEATS[curSeat].ai) { updateHud(); setTimeout(aiTurn, 650); }
    else { hoverCell = null; recomputeValid(); updateGhost(); }
  }
  function doPlace(x, y) { _committedRot = rot; _committedAff = curAff; R.place(board, cur, x, y, rot, curAff); drawTileGroup(board.get(R.key(x, y)), x, y); lastPlaced = { x, y }; clearPads(); if (ghost) { world.remove(ghost); ghost = null; } }
  // wrap the turn-end so it advances the sim locally AND (online) broadcasts one bundled move
  function endLocalTurn(claimNode) {
    const p = { x: lastPlaced.x, y: lastPlaced.y, rot: _committedRot, claim: claimNode ? { node: claimNode } : null };
    const next = (curSeat + 1) % SEATS.length;
    finishTurn();
    if (netMode && !_applyingRemote && seatplay) seatplay.localMoved(p, { aff: _committedAff }, next);
  }
  function _autoPlaceBroadcast() {                 // first-legal place + biggest claim, routed through the chokepoint
    const all = R.legalPlacements(board, cur); if (!all.length) { endLocalTurn(null); return false; }
    rot = all[0].rot; doPlace(all[0].x, all[0].y);
    const opts = claimOptions(all[0].x, all[0].y); let cn = null;
    if (guardians[curSeat] > 0 && opts.length) { opts.sort((a, b) => b.size - a.size); addMeeple(curSeat, opts[0]); cn = opts[0].node; }
    endLocalTurn(cn); return true;
  }

  // features on the just-placed tile that are unclaimed (deduped by component)
  function claimOptions(x, y) {
    const t = board.get(R.key(x, y)), feats = R.features(board), opts = [], seen = new Set();
    for (let d = 0; d < 4; d++) {
      const f = R.edgeAt(t, d); if (f !== "r" && f !== "c") continue;
      const node = R.edgeNodeId(x, y, d), comp = feats.find((ft) => ft.nodeIds.includes(node));
      if (!comp) continue;
      const ckey = comp.nodeIds.slice().sort().join("|");
      if (seen.has(ckey) || meeples.some((m) => comp.nodeIds.includes(m.node))) continue;
      seen.add(ckey); opts.push({ x, y, d, node, kind: f === "c" ? "city" : "road", size: comp.size });
    }
    if (t.arch.temple) { const node = "T:" + x + "," + y; if (!meeples.some((m) => m.node === node)) opts.push({ x, y, d: -1, node, kind: "temple", size: 1 }); }
    return opts;
  }
  function addMeeple(seat, o) { meeples.push({ seat, node: o.node, x: o.x, y: o.y, d: o.d, kind: o.kind, mesh: renderMeeple(seat, o.x, o.y, o.d, o.kind) }); guardians[seat]--; }
  function enterClaim() {
    turnState = "claim"; clearClaimMarks();
    const opts = guardians[curSeat] > 0 ? claimOptions(lastPlaced.x, lastPlaced.y) : [];
    if (!opts.length) { endLocalTurn(null); return; }
    for (const o of opts) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(T * 0.17, T * 0.04, 8, 18), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = Math.PI / 2; let px = o.x * T, pz = o.y * T; if (o.d >= 0) { px += DIR[o.d][0] * T * 0.35; pz += DIR[o.d][1] * T * 0.35; }
      m.position.set(px, 0.8, pz); m.userData = o; world.add(m); claimMarks.push(m);
    }
    updateHud();
  }
  function humanPlace(x, y) {
    if (phase !== "playing" || SEATS[curSeat].ai || turnState !== "place") return false;
    if (!cur || !R.isValid(board, { arch: cur, rot }, x, y)) return false;
    pushUndo();                                   // snapshot BEFORE the move so Undo rewinds the whole round
    doPlace(x, y); ach("first_realm_woven"); enterClaim(); return true;
  }
  // ── UNDO (offline only — a networked game can't be unilaterally rewound) ──
  let undoStack = [];
  function pushUndo() { if (netMode) return; try { undoStack.push({ s: serializeState(), aff: curAff, rot }); if (undoStack.length > 20) undoStack.shift(); } catch (e) {} }
  function undoTurn() {
    if (netMode || phase !== "playing" || !undoStack.length) return false;
    const u = undoStack.pop();
    loadState(u.s);
    cur = (deck && deck[di - 1]) || cur; curAff = u.aff; rot = u.rot;   // drawNext post-increments di, so the in-hand tile is deck[di-1]
    turnState = "place"; clearClaimMarks(); clearPads();
    if (!SEATS[curSeat].ai) { hoverCell = null; recomputeValid(); updateGhost(); }
    updateHud(); saveGame(); announce("Move undone.");
    return true;
  }
  function finishTurn() { clearClaimMarks(); scoreCompletions(); updateHud(); curSeat = (curSeat + 1) % SEATS.length; startTurn(); saveGame(); }

  function aiTurn() {
    if (phase !== "playing" || !SEATS[curSeat].ai) return;   // ignore a stray scheduled call once it's a human's turn
    const legal = R.legalPlacements(board, cur);
    if (!legal.length) { finishTurn(); return; }
    const before = R.features(board).filter((f) => f.complete).length;
    let best = legal[0];
    for (const p of legal) { const test = new Map(board); test.set(R.key(p.x, p.y), { arch: cur, rot: p.rot, x: p.x, y: p.y, affinity: curAff }); if (R.features(test).filter((f) => f.complete).length > before) { best = p; break; } }
    rot = best.rot; doPlace(best.x, best.y);
    const opts = claimOptions(best.x, best.y); let cn = null;
    if (guardians[curSeat] > 0 && opts.length) { opts.sort((a, b) => b.size - a.size); addMeeple(curSeat, opts[0]); cn = opts[0].node; }
    if (netMode) endLocalTurn(cn); else finishTurn();
  }

  function scoreCompletions() {
    const me = localSeat();
    for (const f of R.features(board)) {
      if (!f.complete) continue;
      const sig = "F:" + f.nodeIds.slice().sort().join("|"); if (scoredSigs.has(sig)) continue; scoredSigs.add(sig);
      const at = centroid(f.tiles), pts = R.scoreFeature(board, f);
      const won = award(f.nodeIds, pts, at);
      if (won.includes(me)) {
        if (f.type === "road") ach("roadwarden");
        if (f.type === "city" && f.size >= 5) ach("grand_metropolis");
        if (pts > (f.type === "city" ? 2 : 1) * f.size) ach("elemental_harmony");   // scored MORE than base -> affinity Harmony bonus
      }
    }
    for (const tm of R.temples(board)) {
      if (!tm.complete) continue;
      const sig = "T:" + tm.x + "," + tm.y; if (scoredSigs.has(sig)) continue; scoredSigs.add(sig);
      if (award([sig], 1 + tm.neighbors, { x: tm.x, y: tm.y }).includes(me)) ach("temple_keeper");
    }
  }
  // END-GAME scoring: unfinished roads/cities/temples still pay out (cities at the reduced 1/tile
  // rate — the rules core's `endgame` flag). Without this the final tally silently ignored every
  // incomplete feature, which is not how the game is meant to settle.
  function finalScoring() {
    for (const f of R.features(board)) {
      if (f.complete) continue;
      const sig = "F:" + f.nodeIds.slice().sort().join("|"); if (scoredSigs.has(sig)) continue; scoredSigs.add(sig);
      award(f.nodeIds, R.scoreFeature(board, f, true), null);
    }
    for (const tm of R.temples(board)) {
      if (tm.complete) continue;
      const sig = "T:" + tm.x + "," + tm.y; if (scoredSigs.has(sig)) continue; scoredSigs.add(sig);
      award([sig], 1 + tm.neighbors, null);          // partial temple pays 1 + placed neighbors
    }
  }
  function award(nodeIds, points, at) {
    const inHere = meeples.filter((m) => nodeIds.includes(m.node));
    if (!inHere.length) return [];                    // completed but unclaimed -> nobody scores
    const tally = {}; for (const m of inHere) tally[m.seat] = (tally[m.seat] || 0) + 1;
    const max = Math.max(...Object.values(tally));
    const winners = [];
    for (const s of Object.keys(tally)) if (tally[s] === max) { scores[+s] += points; winners.push(+s); }
    for (const m of inHere) { world.remove(m.mesh); guardians[m.seat]++; }
    meeples = meeples.filter((m) => !inHere.includes(m));
    if (at) flash(at.x, at.y);
    return winners;                                   // seats that scored — drives achievement checks
  }
  function centroid(tiles) { let sx = 0, sy = 0; for (const k of tiles) { const p = k.split(","); sx += +p[0]; sy += +p[1]; } return { x: sx / tiles.length, y: sy / tiles.length }; }
  function endGame() {
    phase = "ended"; finalScoring(); clearSave(); clearPads(); clearClaimMarks(); updateHud();
    const me = localSeat(), top = Math.max(...scores), iWon = scores[me] === top;
    submitFinalScore(scores[me]);                                  // weekly leaderboard: your final Harmony
    if (iWon) { ach("realm_sovereign"); if (SEATS.length === 5 && scores[me] >= 60) ach("luminous_legend"); }
    if (netMode) return;   // online: seatplay.end() shows the result screen
    const line = SEATS.map((s, i) => `${s.name} ✦ ${scores[i]}`).join("　·　");
    announce(`Game over. ${line}`);
    if (shell) shell.end(iWon, line);
  }

  // ── input ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.25), hitP = new THREE.Vector3();
  function cellAt(cx, cy) {
    const rect = kernel.renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera);
    if (!ray.ray.intersectPlane(plane, hitP)) return null;
    return { x: Math.round(hitP.x / T), y: Math.round(hitP.z / T) };
  }
  const _blocked = () => (netMode ? curSeat !== mySeat : SEATS[curSeat].ai);   // online: only my seat may act
  kernel.renderer.domElement.addEventListener("pointermove", (e) => { if (phase !== "playing" || turnState !== "place" || _blocked()) return; hoverCell = cellAt(e.clientX, e.clientY); updateGhost(); });
  kernel.renderer.domElement.addEventListener("pointerdown", (e) => {
    if (phase !== "playing" || e.button !== 0 || _blocked()) return;
    if (turnState === "place") { const c = cellAt(e.clientX, e.clientY); if (c) humanPlace(c.x, c.y); }
    else if (turnState === "claim") {
      const rect = kernel.renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hits = ray.intersectObjects(claimMarks, false);
      if (hits.length) { const o = hits[0].object.userData; addMeeple(curSeat, o); ach("guardians_watch"); endLocalTurn(o.node); }
    }
  });
  addEventListener("keydown", (e) => {
    if (phase !== "playing") return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undoTurn(); return; }   // Ctrl/Cmd+Z = undo
    if (_blocked()) return;
    if (turnState === "place") { if (e.code === "KeyR" || e.code === "KeyE") { rot = (rot + 1) % 4; recomputeValid(); updateGhost(); } if (e.code === "KeyQ") { rot = (rot + 3) % 4; recomputeValid(); updateGhost(); } }
    else if (turnState === "claim" && e.code === "Space") { e.preventDefault(); endLocalTurn(null); }
  });

  function beginGame(seed) {
    clearSave();   // a fresh game must not resume a stale save (resumeGame does NOT route through here)
    phase = "playing"; if (orbit) orbit.autoRotate = false;
    buildSeats();
    if (netMode && seatplay && seatplay.seats.length) SEATS = seatplay.seats.map((s, i) => ({ name: s.kind === "ai" ? s.name : (i === mySeat ? "You" : "Player " + (i + 1)), ai: s.kind === "ai", color: SEAT_COLORS[i] }));
    for (const g of placedG.values()) world.remove(g); placedG.clear();
    for (const m of meeples) world.remove(m.mesh); meeples = [];
    clearPads(); clearClaimMarks();
    scores = SEATS.map(() => 0); guardians = SEATS.map(() => 7); scoredSigs = new Set(); di = 0; curSeat = 0;
    // A NEW RANDOM REALM every game: the seed drives the tile-draw order AND the affinity
    // stream, so the deck (52! orderings) and every tile element differ each play.
    // Online: the host seed arrives in the start payload so all clients share one deck.
    MAP_SEED = (seed != null ? (seed >>> 0) : (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0)) || 1;
    rng = R.makeRng(MAP_SEED);
    board = R.newBoard(); drawTileGroup(board.get(R.key(0, 0)), 0, 0);
    deck = R.makeDeck(MAP_SEED); startTurn();
  }

  // ── player-count picker (2–5, creator chooses how many are AI; rest hotseat) ──
  const cfgOv = document.createElement("div");
  cfgOv.style.cssText = "position:absolute;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(6,12,24,.55);font-family:'Segoe UI',monospace";
  (kernel.parent || document.body).appendChild(cfgOv);
  function showConfig() {
    if (shell) shell.hide && shell.hide();
    cfgOv.style.display = "flex";
    const draw = () => {
      const humans = gcfg.total - gcfg.ais;
      const btn = (label, on, cur) => `<button data-a="${on}" style="cursor:pointer;margin:2px;min-width:38px;padding:7px 11px;border-radius:8px;border:1px solid ${cur ? "#7CFC9A" : "#33465f"};background:${cur ? "linear-gradient(#2a6a3e,#184e2c)" : "rgba(20,30,50,.7)"};color:#dfeaff;font:bold 14px 'Segoe UI'">${label}</button>`;
      cfgOv.innerHTML = `<div style="background:rgba(10,18,34,.96);border:1px solid #7CFC9A;border-radius:16px;padding:26px 34px;text-align:center;color:#dfeaff;min-width:340px;box-shadow:0 12px 40px rgba(0,0,0,.6)">
        <div style="font-size:24px;font-weight:800;letter-spacing:3px;margin-bottom:4px;color:#7CFC9A">REALM WEAVERS</div>
        <div style="opacity:.7;font-size:13px;margin-bottom:16px">Choose your table</div>
        <div style="opacity:.85;margin-bottom:6px;font-size:13px">PLAYERS</div>
        <div style="margin-bottom:16px">${[2, 3, 4, 5].map((t) => btn(t, "t" + t, gcfg.total === t)).join("")}</div>
        <div style="opacity:.85;margin-bottom:6px;font-size:13px">AI OPPONENTS <span style="opacity:.6">(rest are hotseat)</span></div>
        <div style="margin-bottom:18px">${Array.from({ length: gcfg.total }, (_, a) => a).map((a) => btn(a, "a" + a, gcfg.ais === a)).join("")}</div>
        <div style="opacity:.7;font-size:12px;margin-bottom:14px">${humans} human${humans > 1 ? "s" : ""} + ${gcfg.ais} AI</div>
        <button data-a="go" style="cursor:pointer;padding:11px 40px;border-radius:9px;border:1px solid #7CFC9A;background:linear-gradient(#4fd06a,#2fa050);color:#06210f;font:bold 16px 'Segoe UI';letter-spacing:1px">▶ WEAVE</button>
      </div>`;
      cfgOv.querySelectorAll("button").forEach((b) => b.onclick = () => {
        const a = b.dataset.a;
        if (a === "go") { cfgOv.style.display = "none"; beginGame(); return; }
        if (a[0] === "t") { gcfg.total = +a.slice(1); if (gcfg.ais > gcfg.total - 1) gcfg.ais = gcfg.total - 1; }
        else if (a[0] === "a") gcfg.ais = Math.min(+a.slice(1), gcfg.total - 1);
        draw();
      });
    };
    draw();
  }

  // ── shell ──
  let shell = null;
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      title: content.title || "Elysium Realms", tagline: content.tagline || "Lay luminous lands. Complete the realm.",
      difficulties: ["Gentle", "Balanced", "Fierce"], defaultDifficulty: "Balanced",
      howTo: [
        { h: "LAY", p: "On your turn a tile appears. Hover a glowing pad, press R to rotate until the edges match, and click to lay it." },
        { h: "CLAIM", p: "Right after laying, click a gold ring to drop a Guardian on a road, city or temple — but only if no one holds that feature yet. Or press SPACE to save your Guardians." },
        { h: "SCORE", p: "When a feature is completed, whoever has the most Guardians on it scores — cities 2/tile, roads 1/tile, temples 1+neighbors — and those Guardians return to you." },
        { h: "AFFINITY", p: "Complete a feature whose tiles all share one element for bonus Harmony that grows with its size. Most Harmony when the realm is fully laid wins." },
        { h: "END + UNDO", p: "When the last tile is laid, unfinished roads, cities and temples still pay out (cities at a reduced rate) — so a half-built city is worth holding. Made a mistake? Press Ctrl+Z or the ↶ Undo button to take your move back (single-player only). Your game autosaves every turn — RESUME GAME on the title screen picks it back up." },
      ],
      onPlay: () => showConfig(), onPause: () => { try { kernel.stop(); } catch (e) {} }, onResume: () => { try { kernel.start(); } catch (e) {} },
    });
    shell.start();
  } else beginGame();

  // ── online (ffg_seatplay) — N-seat networked play, added without touching the shared shell ──
  function boardHash() {
    if (!board) return "nil";
    const tiles = [...board.entries()].map(([k, t]) => k + ":" + [0, 1, 2, 3].map((d) => R.edgeAt(t, d)).join("") + (t.arch.temple ? "T" : "")).sort().join("|");
    const ms = meeples.map((m) => m.seat + "@" + m.node).sort().join(",");   // meeple-inclusive so claim divergence is caught early
    return tiles + "||" + ms + "||" + scores.join(",") + "|" + guardians.join(",") + "|" + di + "|" + curSeat + "|" + turnState;
  }
  function applyRemoteMove(seat, p, rngA) {
    _applyingRemote = true;
    try {
      if (rngA && rngA.aff) curAff = rngA.aff;                                  // force the actor's affinity
      rot = p.rot;
      if (R.isValid(board, { arch: cur, rot }, p.x, p.y)) doPlace(p.x, p.y);    // guard the receive path
      if (p.claim) { const opts = claimOptions(p.x, p.y); const o = opts.find((o) => o.node === p.claim.node); if (o) addMeeple(seat, o); }
      finishTurn();
    } finally { _applyingRemote = false; }
  }
  function serializeState() {
    return { seed: MAP_SEED, tiles: [...board.entries()].map(([k, t]) => ({ x: t.x, y: t.y, arch: t.arch, rot: t.rot, affinity: t.affinity })), meeples: meeples.map((m) => ({ seat: m.seat, node: m.node, x: m.x, y: m.y, d: m.d, kind: m.kind })), scores: [...scores], guardians: [...guardians], scoredSigs: [...scoredSigs], di, curSeat, turnState };
  }
  function loadState(s) {
    if (s.seed != null && (s.seed >>> 0) !== MAP_SEED) { MAP_SEED = (s.seed >>> 0) || 1; rng = R.makeRng(MAP_SEED); deck = R.makeDeck(MAP_SEED); }   // same realm as the saver/host
    for (const g of placedG.values()) world.remove(g); placedG.clear();
    for (const m of meeples) world.remove(m.mesh); meeples = [];
    clearPads(); clearClaimMarks(); board = R.newBoard();
    for (const t of s.tiles) { board.set(R.key(t.x, t.y), { arch: t.arch, rot: t.rot, x: t.x, y: t.y, affinity: t.affinity }); drawTileGroup(board.get(R.key(t.x, t.y)), t.x, t.y); }
    meeples = s.meeples.map((m) => ({ ...m, mesh: renderMeeple(m.seat, m.x, m.y, m.d, m.kind) }));
    scores = [...s.scores]; guardians = [...s.guardians]; scoredSigs = new Set(s.scoredSigs); di = s.di; curSeat = s.curSeat; turnState = s.turnState;
  }

  // ── AUTOSAVE + RESUME (M6) — local single-player persistence; wholly inert during online (gated on !netMode) ──
  const SAVE_KEY = "ffg_elysium_save";
  function saveGame() {   // capture the latest in-progress LOCAL game each turn-advance; reuses serializeState (never online)
    if (netMode || phase !== "playing") return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, gcfg: { total: gcfg.total, ais: gcfg.ais }, state: serializeState() })); } catch (e) {}
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function hasSave() { try { const sv = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); return (sv && sv.v === 1 && sv.state && sv.gcfg) ? sv : null; } catch (e) { return null; } }
  function resumeGame() {   // rebuild the saved LOCAL game (offline) — mirrors beginGame's reset, then loadState instead of a fresh board
    netMode = false;
    const sv = hasSave(); if (!sv) return false;
    gcfg = sv.gcfg; buildSeats();
    phase = "playing"; if (orbit) orbit.autoRotate = false;
    for (const g of placedG.values()) world.remove(g); placedG.clear();
    for (const m of meeples) world.remove(m.mesh); meeples = [];
    clearPads(); clearClaimMarks();
    scores = SEATS.map(() => 0); guardians = SEATS.map(() => 7); scoredSigs = new Set(); di = 0; curSeat = 0;
    MAP_SEED = (sv.state && sv.state.seed != null ? (sv.state.seed >>> 0) : 12345) || 1;
    rng = R.makeRng(MAP_SEED);
    deck = R.makeDeck(MAP_SEED);                       // the SAME realm you were playing (seed is serialized)
    loadState(sv.state);                              // rebuilds board+tile meshes+meeples; restores di/curSeat/turnState/scores/guardians/scoredSigs
    turnState = "place";
    cur = (di > 0) ? deck[di - 1] : null;             // drawNext leaves cur === deck[di-1]; cur/curAff/rot are NOT serialized, so re-derive them
    if (!cur) { startTurn(); return true; }
    curAff = R.AFFINITIES[(rng() * R.AFFINITIES.length) | 0];
    const counts = [0, 0, 0, 0]; for (const p of R.legalPlacements(board, cur)) counts[p.rot]++;
    rot = 0; for (let r = 1; r < 4; r++) if (counts[r] > counts[rot]) rot = r;
    if (SEATS[curSeat].ai) { updateHud(); setTimeout(aiTurn, 650); }   // AI's turn -> schedule it the way startTurn does
    else { hoverCell = null; recomputeValid(); updateGhost(); }
    return true;
  }
  function buildSeatIface() {
    return {
      gameId: "elysium3d", parent: kernel.parent, title: "Elysium Realms", turnSeconds: 45,
      onLobbyOpen: () => { if (orbit) orbit.autoRotate = true; },
      onLobbyBack: () => { netMode = false; if (shell) { shell.phase = "menu"; shell.start(); } },
      startGame: (a) => { netMode = true; mySeat = a.mySeat; beginGame(a.seed); },
      onTurn: ({ turnSeat, acting }) => { if (acting && turnSeat === mySeat && SEATS[turnSeat] && !SEATS[turnSeat].ai) { hoverCell = null; recomputeValid(); updateGhost(); } else updateHud(); },
      applyRemoteMove,
      driveAiTurn: (seat) => { if (SEATS[seat] && SEATS[seat].ai) aiTurn(); },
      randomMove: () => _autoPlaceBroadcast(),
      isOver: () => phase === "ended",
      winnerSeat: () => { const top = Math.max(...scores); return scores.findIndex((s) => s === top); },
      serializeState, loadState, boardHash,
      setStatus: () => updateHud(),
      end: (r) => { phase = "ended"; if (shell) shell.end(r && r.winner === mySeat, r && r.reason ? r.reason : SEATS.map((s, i) => `${s.name} ✦ ${scores[i]}`).join("　·　")); },
      onPeerDrop: (seat) => { if (SEATS[seat]) { SEATS[seat].ai = true; SEATS[seat].name = (SEATS[seat].name || "Player") + " (AI)"; } updateHud(); },
      testPlayOne: () => (netMode && curSeat === mySeat ? _autoPlaceBroadcast() : false),
    };
  }
  async function startOnline() {
    if (!_spApi) { const mod = await import("../net/ffg_seatplay.js" + new URL(import.meta.url).search); _spApi = mod.installSeatPlay(buildSeatIface()); seatplay = _spApi.controller; }
    netMode = true; _spApi.openLobby();
  }
  // inject a "PLAY ONLINE" button beside the shell's PLAY (the shell rebuilds ov.innerHTML each menu())
  if (shell && typeof shell.menu === "function") {
    const _origMenu = shell.menu.bind(shell);
    shell.menu = function () {
      _origMenu();
      try {
        if (shell.phase !== "menu" || !shell.ov) return;
        const ob = document.createElement("button");
        ob.textContent = "🌐  PLAY ONLINE";
        ob.style.cssText = "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;min-width:200px;letter-spacing:1px;border-radius:7px;margin-top:8px;color:#06121f;background:linear-gradient(#9fe0ff,#4fb6e0);border:1px solid #7fd0f0;box-shadow:0 4px 18px rgba(80,180,224,.32)";
        ob.onclick = () => { shell.hide(); shell.phase = "playing"; startOnline(); };
        const playBtn = Array.prototype.find.call(shell.ov.querySelectorAll("button"), (b) => /PLAY/i.test(b.textContent) && !/ONLINE/i.test(b.textContent));
        if (playBtn && playBtn.parentNode) playBtn.parentNode.insertBefore(ob, playBtn.nextSibling); else shell.ov.appendChild(ob);
      } catch (e) {}
    };
    if (shell.phase === "menu") shell.menu();
  }
  // inject a "RESUME GAME" button beside PLAY when a local save exists (same monkey-patch technique as PLAY ONLINE)
  if (shell && typeof shell.menu === "function") {
    const _menuNoResume = shell.menu.bind(shell);
    shell.menu = function () {
      _menuNoResume();
      try {
        if (shell.phase !== "menu" || !shell.ov || !hasSave()) return;
        const rb = document.createElement("button");
        rb.textContent = "↺  RESUME GAME";
        rb.style.cssText = "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;min-width:200px;letter-spacing:1px;border-radius:7px;margin-top:8px;color:#2a1e06;background:linear-gradient(#ffe6a0,#f0c250);border:1px solid #f0d27a;box-shadow:0 4px 18px rgba(240,210,122,.32)";
        rb.onclick = () => { shell.hide(); shell.phase = "playing"; resumeGame(); };
        const playBtn = Array.prototype.find.call(shell.ov.querySelectorAll("button"), (b) => /PLAY/i.test(b.textContent) && !/ONLINE/i.test(b.textContent) && !/RESUME/i.test(b.textContent));
        if (playBtn && playBtn.parentNode) playBtn.parentNode.insertBefore(rb, playBtn.nextSibling); else shell.ov.appendChild(rb);
      } catch (e) {}
    };
    if (shell.phase === "menu") shell.menu();
  }
  try { if (new URLSearchParams(location.search).get("mode") === "online" && shell) { shell.hide(); shell.phase = "playing"; startOnline(); } } catch (e) {}
  if (typeof window !== "undefined") window.__elyDbg = () => ({ netMode, applyingRemote: _applyingRemote, hasSeatplay: !!seatplay, curSeat, mySeat, phase });

  // ── test hooks ──
  return {
    __test: {
      state: () => ({ phase, curSeat, curAI: !!(SEATS[curSeat] && SEATS[curSeat].ai), seats: SEATS.length, turnState, scores: [...scores], guardians: [...guardians], meeples: meeples.length, board: board ? board.size : 0, left: deck ? deck.length - di : 0 }),
      start: (cfg) => { if (cfg) { if (cfg.total) gcfg.total = cfg.total; if (cfg.ais != null) gcfg.ais = Math.min(cfg.ais, gcfg.total - 1); } if (shell) shell.hide && shell.hide(); beginGame(); return true; },
      // play the current seat's whole turn headlessly (place first-legal + claim biggest + finish)
      mapInfo: () => ({ seed: MAP_SEED, deck: deck ? deck.slice(0, 14).map((a) => a.id).join(",") : null, left: deck ? deck.length - di : 0 }),
      undo: () => undoTurn(),
      canUndo: () => undoStack.length,
      autoTurn: () => {
        if (phase !== "playing") return false;
        if (SEATS[curSeat].ai) { aiTurn(); return true; }
        pushUndo();                       // headless turn mirrors the human path (humanPlace snapshots too)
        const all = R.legalPlacements(board, cur); if (!all.length) { finishTurn(); return true; }
        rot = all[0].rot; doPlace(all[0].x, all[0].y);
        const opts = claimOptions(all[0].x, all[0].y);
        if (guardians[curSeat] > 0 && opts.length) { opts.sort((a, b) => b.size - a.size); addMeeple(curSeat, opts[0]); }
        finishTurn(); return true;
      },
    },
  };
});

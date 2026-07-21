import * as THREE from "three";
/**
 * royale/hud.js — every screen and overlay: main menu (map/mode select),
 * lobby fill, in-game HUD (bars, slots, mats, minimap w/ storm rings, kill
 * feed, storm timer, alive count, crosshair, hitmarker, interact hints,
 * scope + storm tints), pause, settings (volumes, sensitivity, graphics,
 * keybind remap), death/spectate, post-match stats, victory.
 *
 * All DOM (crisp text > canvas). Dynamic values only touch the DOM when they
 * change; the minimap canvas redraws at ~10Hz.
 */

let R = {};            // element registry
let K = null;
let feedTimer = [];
// Backing-store scale for the 2D canvases (minimap, compass, big map). They used
// to be sized 1:1 with their CSS box while the WebGL renderer honoured DPR and
// the locker preview supersampled 2x, so the HUD was the blurriest thing on a
// HiDPI screen. Capped at 2 — past that it is fill-rate for nothing.
const HUD_DPR = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);

const css = (el, o) => { Object.assign(el.style, o); return el; };
function h(tag, styles, text, parent) {
  const el = document.createElement(tag);
  if (styles) css(el, styles);
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";
const FONT_DISPLAY = "'Segoe UI', system-ui, sans-serif";
// AAA glass panels — translucent so the live Three.js world reads through
const PANEL = {
  background: "linear-gradient(165deg, rgba(12,24,44,0.72) 0%, rgba(8,16,30,0.82) 100%)",
  border: "1px solid rgba(140,200,255,0.28)",
  borderRadius: "16px",
  boxShadow: "0 12px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(0,0,0,0.25)",
  backdropFilter: "blur(18px) saturate(1.35)",
  WebkitBackdropFilter: "blur(18px) saturate(1.35)",
};
const PANEL_HOT = Object.assign({}, PANEL, {
  border: "1px solid rgba(120,200,255,0.55)",
  boxShadow: "0 12px 48px rgba(0,0,0,0.55), 0 0 32px rgba(60,150,255,0.22), inset 0 1px 0 rgba(255,255,255,0.14)",
});
const BTN = {
  padding: "12px 26px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)",
  cursor: "pointer", fontWeight: "800", fontSize: "15px", fontFamily: FONT,
  letterSpacing: "1.2px", textTransform: "uppercase", transition: "transform .12s ease, box-shadow .15s ease, filter .12s",
};
function ensureAAAStyles() {
  if (document.getElementById("lc-aaa-css")) return;
  if (!document.getElementById("lc-font-link")) {
    const link = document.createElement("link");
    link.id = "lc-font-link";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&family=Rajdhani:wght@500;600;700&display=swap";
    document.head.appendChild(link);
  }
  const st = document.createElement("style");
  st.id = "lc-aaa-css";
  st.textContent = `
    @keyframes lcBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
    @keyframes lcPulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
    @keyframes lcShimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
    @keyframes lcTitleIn { 0% { opacity:0; letter-spacing: 28px; filter: blur(8px) } 100% { opacity:1; letter-spacing: 10px; filter: blur(0) } }
    @keyframes lcPanelIn { 0% { opacity:0; transform: translateY(18px) scale(.97) } 100% { opacity:1; transform: none } }
    @keyframes lcGlow { 0%,100% { box-shadow: 0 0 24px rgba(60,150,255,.35), 0 8px 28px rgba(0,0,0,.45) } 50% { box-shadow: 0 0 40px rgba(90,180,255,.55), 0 8px 28px rgba(0,0,0,.45) } }
    @keyframes lcScan { 0% { transform: translateY(-100%) } 100% { transform: translateY(100%) } }
    .lc-btn-play:hover { transform: translateY(-2px) scale(1.02); filter: brightness(1.08); }
    .lc-btn-play:active { transform: translateY(1px) scale(.99); }
    .lc-mode-card { transition: transform .15s ease, border-color .15s, box-shadow .15s; }
    .lc-mode-card:hover { transform: translateX(4px); border-color: rgba(140,200,255,0.45) !important; }
    .lc-mode-card.sel { transform: translateX(8px); }
    .lc-glass-scan::after {
      content:''; position:absolute; inset:0; pointer-events:none; opacity:.06;
      background: linear-gradient(180deg, transparent, rgba(180,220,255,.4), transparent);
      animation: lcScan 7s linear infinite;
    }
  `;
  document.head.appendChild(st);
}

export function init(W) {
  K = W.SIM;
  W.randomMap = randomMap;   // net.js uses this for online match starts
  const root = h("div", { position: "absolute", inset: "0", pointerEvents: "none", fontFamily: FONT, zIndex: 40, color: "#eaf2ff", userSelect: "none" });
  W.kernel.parent.appendChild(root);
  R = { root };
  wireEvents(W);
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
/** Give the mouse back. Pointer lock routes EVERY mouse event to the locked
 *  canvas, so any overlay the player must click is dead until the lock is
 *  released. It was released in only two places — showMenu and togglePause —
 *  which left the death screen and the post-match screen (the two screens that
 *  end every single match) with unclickable buttons until the player happened
 *  to press Esc. Nothing told them to. */
function releaseCursor(W) {
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
  try { if (W && W.kernel) W.kernel.renderer.domElement.style.cursor = ""; } catch (e) {}
}

function layer(name, styles) {
  if (R[name]) { clear(R[name]); R[name].remove(); }
  R[name] = h("div", Object.assign({ position: "absolute", inset: "0", pointerEvents: "none" }, styles || {}), null, R.root);
  return R[name];
}

// ═══ MENU ════════════════════════════════════════════════════════════════════
// Maps rotate RANDOMLY every match — no picker (owner direction: "anytime you
// play, it randomly chooses").
export const BATTLE_MAPS = ["isla_viva", "ashgrid", "deepwood"];
export const randomMap = () => BATTLE_MAPS[Math.floor(Math.random() * BATTLE_MAPS.length)];
const MODE_CARDS = [
  { id: "standard", name: "BATTLE ROYALE", sub: "50 players · random map · last one standing" },
  { id: "quick", name: "QUICK MATCH", sub: "5-minute storm · double loot · hot start" },
  { id: "practice", name: "PRACTICE", sub: "No storm · random map · full loadout" },
];

// unlockLevel gives the XP bar something to pay out. Levelling used to grant
// nothing at all: the bar filled, the number went up, and the game handed back
// no reward for it.
export const MENU_SKINS = [
  { key: "soldier", name: "SGT. BRICK", sub: "Commando", unlockLevel: 1 },
  { key: "athlete", name: "DASH", sub: "Track star", unlockLevel: 1 },
  { key: "wraith", name: "NIGHTFALL", sub: "Spec-ops · all black", unlockLevel: 3 },
  { key: "juggernaut", name: "BULWARK", sub: "Heavy armor", unlockLevel: 6 },
  { key: "viper", name: "STINGER", sub: "Venom suit", unlockLevel: 10 },
];
export function skinUnlocked(W, meta) {
  const lvl = (W && W.progress && W.progress.level) || 1;
  return (meta.unlockLevel || 1) <= lvl;
}
/** The lifetime goal to chase once every skin is unlocked. The reward track is
 *  five skins and the last one lands at level 10, after which the goal slot on
 *  the menu vanished entirely and the level-up banner just said "RANK UP" —
 *  forever, on the account that had played the most. Reads the career counters
 *  the game already keeps, so it costs no new state. */
export function careerGoal(c) {
  const kills = (c && c.kills) || 0;
  const next = [100, 250, 500, 1000, 2500, 5000].find((n) => kills < n);
  return next ? next + " CAREER KILLS · " + kills + "/" + next : kills + " CAREER KILLS";
}
/** Subtitle for the level-up banner: name the reward when this level pays one
 *  out, otherwise point at the next one. Pure so it is testable without a
 *  built world. */
export function levelUpSub(lvl, career) {
  const won = MENU_SKINS.filter((s) => s.unlockLevel === lvl);
  if (won.length) return "SKIN UNLOCKED · " + won.map((s) => s.name).join(" · ");
  const next = MENU_SKINS
    .filter((s) => (s.unlockLevel || 1) > lvl)
    .sort((a, b) => a.unlockLevel - b.unlockLevel)[0];
  if (next) return "NEXT UNLOCK · " + next.name + " AT LEVEL " + next.unlockLevel;
  return "MAX RANK · NEXT: " + careerGoal(career);
}
export function getChosenSkin() { try { return localStorage.getItem("lc_skin"); } catch (e) { return null; } }
/** The stored pick, but never a locked one — progress can be cleared while a
 *  high-level skin is still saved. */
export function getPlayableSkin(W) {
  const stored = getChosenSkin();
  const meta = MENU_SKINS.find((s) => s.key === stored);
  if (meta && skinUnlocked(W, meta)) return stored;
  const first = MENU_SKINS.find((s) => skinUnlocked(W, s)) || MENU_SKINS[0];
  return first.key;
}

// ═══ CINEMATIC MENU WORLD (live Three.js on the main kernel canvas) ══════════
export function teardownMenuWorld(W) {
  if (R._menuStopPv) { try { R._menuStopPv(); } catch (e) {} R._menuStopPv = null; }
  W._menuWorld = null;
  if (W._groups && W._groups.menu3d) {
    const g = W._groups.menu3d;
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose && m.dispose());
        else if (o.material.dispose) o.material.dispose();
      }
    });
    g.clear();
  }
  // DO NOT touch scene.background / fog here — teardown runs AFTER buildMap in
  // the match-start flow, so the old dark-navy "placeholder" (0x0a1622 + 10x
  // fog) was overwriting the map's daytime sky and turning matches pitch black.
  // The map (maps.js) owns the sky; the menu (buildMenuWorld) owns its own.
}

function buildMenuWorld(W) {
  teardownMenuWorld(W);
  const g = W.group("menu3d");
  g.clear();

  // golden-hour tropical sky
  W.scene.background = new THREE.Color(0x6eb8e8);
  if (W.scene.fog) {
    W.scene.fog.color = new THREE.Color(0x8ec8e8);
    W.scene.fog.density = 0.0048;
  }
  if (W.kernel.sun) {
    W.kernel.sun.position.set(60, 48, 28);
    W.kernel.sun.intensity = 1.85;
    W.kernel.sun.color.set(0xfff0d8);
  }
  // Restore the HEMISPHERE light too. The kernel builds it at 0.9 / cool blue /
  // near-black ground and maps.js overwrites it on every match start (1.25 /
  // 0xdcefff / 0x7c8672) — nothing ever put it back, so the diorama was lit by
  // whatever the last map wanted, and by a cold blue sky-fill on first boot,
  // against the golden-hour gradient the sky dome below is authored for.
  let _hemi = null;
  W.scene.traverse((o) => { if (o.isHemisphereLight) _hemi = o; });
  if (_hemi) { _hemi.intensity = 0.8; _hemi.color.setHex(0xffe0b8); _hemi.groundColor.setHex(0x2e3a30); }
  // Restore the TONE MAPPER too, not just the exposure: a match sets
  // NoToneMapping (maps.js) for its bright-daylight look and nothing ever put it
  // back, so from the second visit onward the cinematic menu rendered unlit.
  W.kernel.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  W.kernel.renderer.toneMappingExposure = 1.12;

  // soft sky dome (gradient-ish via large inverted sphere)
  const skyGeo = new THREE.SphereGeometry(420, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3a8fd4) },
      midColor: { value: new THREE.Color(0x9ed0ef) },
      botColor: { value: new THREE.Color(0xf0c090) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=normalize(w.xyz); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 topColor,midColor,botColor; varying vec3 vW; void main(){ float h=clamp(vW.y*0.5+0.5,0.,1.); vec3 c=mix(botColor,midColor,smoothstep(0.,0.45,h)); c=mix(c,topColor,smoothstep(0.4,1.,h)); gl_FragColor=vec4(c,1.); }`,
  });
  g.add(new THREE.Mesh(skyGeo, skyMat));

  // procedural island (vertex-colored)
  const SEG = 96, ISLE = 160;
  const terrGeo = new THREE.PlaneGeometry(ISLE, ISLE, SEG, SEG);
  terrGeo.rotateX(-Math.PI / 2);
  const pos = terrGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.sqrt(x * x + z * z) / (ISLE * 0.48);
    const mask = Math.max(0, 1 - Math.pow(Math.min(1.15, d), 2.4));
    const n = Math.sin(x * 0.09) * Math.cos(z * 0.08) * 2.2 + Math.sin(x * 0.21 + z * 0.17) * 1.1;
    let hgt = (6 + n * 3.5 + (1 - d) * 9) * mask - 1.2;
    // central ridge
    const ridge = Math.exp(-((x - 8) * (x - 8) + (z + 6) * (z + 6)) / 380);
    hgt += ridge * 14 * mask;
    pos.setY(i, hgt);
    let r, gr, b;
    if (hgt < 0.6) { r = 0.90; gr = 0.84; b = 0.58; }
    else if (hgt < 4) { r = 0.28 + n * 0.02; gr = 0.52; b = 0.26; }
    else if (hgt < 12) { r = 0.22; gr = 0.44; b = 0.22; }
    else { r = 0.48; gr = 0.44; b = 0.40; }
    cols[i * 3] = r; cols[i * 3 + 1] = gr; cols[i * 3 + 2] = b;
  }
  terrGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  terrGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }));
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  g.add(terrain);

  // ocean
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2),
    // no envMapIntensity: nothing in the game ever assigns scene.environment or
    // an envMap, so it multiplied a reflection that does not exist
    new THREE.MeshStandardMaterial({ color: 0x1488b0, transparent: true, opacity: 0.88, roughness: 0.18, metalness: 0.22 })
  );
  water.position.y = 0;
  water.receiveShadow = true;
  g.add(water);

  // storm circle — the brand: purple closing ring around the island
  const stormRing = new THREE.Mesh(
    new THREE.TorusGeometry(72, 0.55, 10, 96),
    new THREE.MeshBasicMaterial({ color: 0xb46cff, transparent: true, opacity: 0.72, toneMapped: false })
  );
  stormRing.rotation.x = Math.PI / 2;
  stormRing.position.y = 3.2;
  g.add(stormRing);
  const stormGlow = new THREE.Mesh(
    new THREE.TorusGeometry(72, 2.4, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x7a3cff, transparent: true, opacity: 0.18, toneMapped: false, side: THREE.DoubleSide })
  );
  stormGlow.rotation.x = Math.PI / 2;
  stormGlow.position.y = 3.2;
  g.add(stormGlow);

  // floating sky islands
  const floaters = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + 0.4;
    const rad = 55 + (i % 3) * 18;
    const fi = new THREE.Group();
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(3.2 + i * 0.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.9, flatShading: true })
    );
    rock.scale.set(1.6, 0.55, 1.3);
    rock.castShadow = true;
    fi.add(rock);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.8, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x3d7a42, roughness: 0.85, flatShading: true })
    );
    top.position.y = 0.55;
    fi.add(top);
    // simple tree
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3020 }));
    trunk.position.y = 1.5; fi.add(trunk);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x2f7a3a, flatShading: true }));
    canopy.position.y = 3.1; fi.add(canopy);
    fi.position.set(Math.cos(ang) * rad, 18 + i * 3.5, Math.sin(ang) * rad);
    fi.userData = { baseY: fi.position.y, phase: i * 1.3, ang, rad };
    g.add(fi);
    floaters.push(fi);
  }

  // island props — procedural palms/rocks (no async wait for menu boot)
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 48;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const d = Math.sqrt(x * x + z * z) / (ISLE * 0.48);
    if (d > 0.92) continue;
    const yy = (6 + Math.sin(x * 0.09) * Math.cos(z * 0.08) * 2.2) * Math.max(0, 1 - d * d) + 0.2;
    if (yy < 1.2) continue;
    const palm = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 4.2 + Math.random(), 6), new THREE.MeshStandardMaterial({ color: 0x6b4a28 }));
    tr.position.y = 2.1; tr.castShadow = true; palm.add(tr);
    for (let k = 0; k < 5; k++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 2.8, 4),
        new THREE.MeshStandardMaterial({ color: 0x2d8a3e, flatShading: true })
      );
      leaf.position.set(0, 4.0, 0);
      leaf.rotation.z = 0.9;
      leaf.rotation.y = (k / 5) * Math.PI * 2;
      palm.add(leaf);
    }
    palm.position.set(x, yy, z);
    palm.rotation.y = Math.random() * Math.PI;
    palm.scale.setScalar(0.7 + Math.random() * 0.55);
    g.add(palm);
  }

  // atmospheric dust / spark particles
  const N = 420;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(N * 3);
  const pBase = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pBase[i * 3] = (Math.random() - 0.5) * 200;
    pBase[i * 3 + 1] = Math.random() * 55 + 2;
    pBase[i * 3 + 2] = (Math.random() - 0.5) * 200;
    pPos[i * 3] = pBase[i * 3];
    pPos[i * 3 + 1] = pBase[i * 3 + 1];
    pPos[i * 3 + 2] = pBase[i * 3 + 2];
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xd8ecff, size: 0.55, transparent: true, opacity: 0.55,
    depthWrite: false, sizeAttenuation: true, toneMapped: false,
  }));
  g.add(pts);

  // volumetric-ish god-ray planes
  for (let i = 0; i < 4; i++) {
    const ray = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 55),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.04 + i * 0.01, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    ray.position.set(-20 + i * 14, 28, -30 + i * 8);
    ray.rotation.z = -0.35;
    ray.rotation.y = 0.4;
    g.add(ray);
  }

  // soft ground fill light under island
  const fill = new THREE.PointLight(0x57b0ff, 0.55, 120);
  fill.position.set(0, 12, 0);
  g.add(fill);

  W._menuWorld = {
    t0: performance.now() / 1000,
    water, stormRing, stormGlow, floaters, pts, pBase, pPos,
    camR: 92, camH: 34, lookY: 6, speed: 0.065,
  };
  // initial camera pose
  updateMenuWorld(W, 0);
  // optional bloom for that AAA glow on emissive storm ring
  try {
    if (!W.kernel.composer) W.kernel.enableBloom({ strength: 0.45, radius: 0.55, threshold: 0.72 });
    else if (W.kernel.bloom) { W.kernel.bloom.strength = 0.45; W.kernel.bloom.threshold = 0.72; }
  } catch (e) { /* postFX optional */ }

  // decorate with real GLBs if present (async, non-blocking)
  const propUrls = ["palm.glb", "tree.glb", "rocks.glb", "pine.glb"];
  propUrls.forEach(async (name, idx) => {
    try {
      const root = await W.kernel.loadGLTF(W.assetBase + "assets/props/" + name);
      if (!W._menuWorld || W.phase !== "menu") return;
      for (let n = 0; n < 3; n++) {
        const c = root.clone(true);
        const a = (idx * 1.7 + n * 2.1) % (Math.PI * 2);
        const rr = 18 + n * 12 + idx * 4;
        c.position.set(Math.cos(a) * rr, 1.5, Math.sin(a) * rr);
        c.scale.setScalar(name === "rocks.glb" ? 2.2 : 1.4);
        c.rotation.y = a;
        // lift to terrain approx
        const d = Math.sqrt(c.position.x ** 2 + c.position.z ** 2) / (ISLE * 0.48);
        const mask = Math.max(0, 1 - Math.pow(Math.min(1.15, d), 2.4));
        c.position.y = (6 + Math.sin(c.position.x * 0.09) * 2) * mask;
        g.add(c);
      }
    } catch (e) { /* props optional */ }
  });
}

export function updateMenuWorld(W, dt) {
  const M = W._menuWorld;
  if (!M || W.phase !== "menu") return;
  const t = performance.now() / 1000 - M.t0;
  // cinematic orbit — slight elev bob, slow yaw
  const ang = t * M.speed;
  const elev = M.camH + Math.sin(t * 0.35) * 3.5;
  const r = M.camR + Math.sin(t * 0.18) * 6;
  W.camera.position.set(Math.cos(ang) * r, elev, Math.sin(ang) * r);
  W.camera.lookAt(0, M.lookY + Math.sin(t * 0.25) * 1.2, 0);
  W.camera.fov = 42;
  W.camera.updateProjectionMatrix();
  // water breathe
  if (M.water) M.water.position.y = Math.sin(t * 0.7) * 0.18;
  // storm pulse + slow spin
  if (M.stormRing) {
    M.stormRing.rotation.z = t * 0.15;
    M.stormRing.material.opacity = 0.55 + Math.sin(t * 1.4) * 0.2;
    M.stormGlow.rotation.z = -t * 0.08;
    M.stormGlow.material.opacity = 0.12 + Math.sin(t * 1.4) * 0.06;
    const pulse = 1 + Math.sin(t * 0.9) * 0.015;
    M.stormRing.scale.setScalar(pulse);
    M.stormGlow.scale.setScalar(pulse);
  }
  // floating islands bob
  for (const fi of M.floaters) {
    fi.position.y = fi.userData.baseY + Math.sin(t * 0.7 + fi.userData.phase) * 1.4;
    fi.rotation.y = t * 0.12 + fi.userData.phase;
  }
  // dust drift
  if (M.pts) {
    const arr = M.pts.geometry.attributes.position.array;
    for (let i = 0; i < M.pBase.length / 3; i++) {
      arr[i * 3] = M.pBase[i * 3] + Math.sin(t * 0.3 + i) * 2;
      arr[i * 3 + 1] = M.pBase[i * 3 + 1] + Math.sin(t * 0.5 + i * 0.7) * 1.5;
      arr[i * 3 + 2] = M.pBase[i * 3 + 2] + Math.cos(t * 0.25 + i) * 2;
    }
    M.pts.geometry.attributes.position.needsUpdate = true;
  }
}

export function showMenu(W, startMatch) {
  W.phase = "menu";
  W.paused = false;
  if (!W.progress) W.progress = loadProgress();   // the locker needs your level
  // player.js reads lc_skin straight out of localStorage, so keep the stored
  // value honest here rather than teaching it about unlocks (and importing hud)
  try {
    const ok = getPlayableSkin(W);
    if (ok !== getChosenSkin()) localStorage.setItem("lc_skin", ok);
  } catch (e) {}
  document.exitPointerLock && document.exitPointerLock();
  W.kernel.renderer.domElement.style.cursor = "";
  hideHUD();
  ensureAAAStyles();
  // clear any leftover match geometry so the cinematic diorama owns the frame
  if (W._groups) {
    for (const name of Object.keys(W._groups)) {
      if (name === "menu3d") continue;
      try { W._groups[name].clear(); } catch (e) {}
    }
  }
  buildMenuWorld(W);

  // Glass UI over the live 3D world — NO opaque fill; vignette only
  const L = layer("menu", {
    pointerEvents: "auto", overflow: "hidden",
    background: "radial-gradient(ellipse at 50% 40%, rgba(4,10,20,0.18) 0%, rgba(2,6,14,0.55) 70%, rgba(1,4,10,0.78) 100%)",
  });

  // top chrome bar
  const topBar = h("div", {
    position: "absolute", top: "0", left: "0", right: "0", height: "52px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 28px",
    background: "linear-gradient(180deg, rgba(4,10,22,0.72), transparent)",
    borderBottom: "1px solid rgba(120,180,255,0.08)",
  }, null, L);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "13px", fontWeight: "800",
    letterSpacing: "4px", color: "#8ec8ff", textShadow: "0 0 18px rgba(80,160,255,0.5)",
  }, "FORGEFLOW  ·  LAST CIRCLE", topBar);
  h("div", { fontSize: "12px", opacity: "0.55", letterSpacing: "2px", fontWeight: "600" }, "SEASON 1  ·  FREE TO PLAY", topBar);

  // center stack
  const wrap = h("div", {
    position: "absolute", inset: "0", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "20px", padding: "64px 24px 40px",
  }, null, L);

  // title block
  const titleBlock = h("div", { textAlign: "center", animation: "lcTitleIn .9s cubic-bezier(.2,.8,.2,1) both" }, null, wrap);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "clamp(42px, 7vw, 72px)", fontWeight: "900",
    letterSpacing: "10px",
    background: "linear-gradient(180deg, #ffffff 10%, #a8d4ff 55%, #4a9fff 100%)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    filter: "drop-shadow(0 0 32px rgba(80,160,255,0.55)) drop-shadow(0 6px 4px rgba(0,0,0,0.55))",
  }, "LAST CIRCLE", titleBlock);
  // Level / XP / career on the MENU. All of it existed already but was only ever
  // visible on the one post-match screen, so between sessions the game showed
  // the player no evidence they had ever played it.
  if (!W.progress) W.progress = loadProgress();
  {
    const pr = W.progress, c = pr.career || {};
    const need = xpForLevel(pr.level);
    const strip = h("div", {
      display: "flex", alignItems: "center", gap: "10px", marginTop: "10px",
      padding: "6px 14px", borderRadius: "10px", background: "rgba(4,12,24,0.5)",
      border: "1px solid rgba(120,180,255,0.18)", fontFamily: "Rajdhani, " + FONT,
    }, null, titleBlock);
    h("div", { fontSize: "13px", fontWeight: "900", color: "#ffd873", letterSpacing: "1px" }, "LVL " + pr.level, strip);
    const barW = h("div", { width: "120px", height: "8px", background: "rgba(0,0,0,0.55)", borderRadius: "4px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }, null, strip);
    h("div", { width: Math.min(100, (pr.xp / need) * 100) + "%", height: "100%", background: "linear-gradient(90deg,#4aa8ff,#7ad0ff)" }, null, barW);
    h("div", { fontSize: "11px", opacity: "0.75", letterSpacing: "1px" }, pr.xp + " / " + need + " XP", strip);
    if (c.matches) {
      // damage and timeAliveS were accumulated every match and read by NOTHING —
      // two of the seven career fields were write-only. Show them.
      h("div", {
        fontSize: "11.5px", opacity: "0.8", letterSpacing: "1px", borderLeft: "1px solid rgba(255,255,255,0.18)", paddingLeft: "10px",
      }, c.matches + " matches · " + c.wins + " wins · " + c.kills + " kills" + (c.bestPlacement ? " · best #" + c.bestPlacement : "")
         + (c.damage ? " · " + Math.round(c.damage / 1000) + "k dmg" : "") + (c.timeAliveS ? " · " + (c.timeAliveS / 3600).toFixed(1) + "h" : ""), strip);
    }
    // Coming back tomorrow rather than in a month is worth naming.
    if (pr.dayStreak > 1) {
      h("div", { fontSize: "11.5px", color: "#ffb36a", letterSpacing: "1px", borderLeft: "1px solid rgba(255,255,255,0.18)", paddingLeft: "10px" },
        "🔥 " + pr.dayStreak + "-DAY STREAK", strip);
    }
    const nextSkin = MENU_SKINS.filter((sk) => (sk.unlockLevel || 1) > pr.level).sort((a, b) => a.unlockLevel - b.unlockLevel)[0];
    h("div", { fontSize: "11.5px", color: "#9fd7ff", letterSpacing: "1px", borderLeft: "1px solid rgba(255,255,255,0.18)", paddingLeft: "10px" },
      // there was no else branch: past level 10 the goal slot silently
      // disappeared, so the menu named no target at all for a maxed account
      nextSkin ? "NEXT: " + nextSkin.name + " @ LVL " + nextSkin.unlockLevel : "MAX RANK · NEXT: " + careerGoal(c), strip);
  }
  h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "15px", fontWeight: "600",
    letterSpacing: "6px", color: "#b8d8ff", opacity: "0.85", marginTop: "6px",
    textShadow: "0 2px 12px rgba(0,0,0,0.8)",
  }, "50 DROP  ·  ONE STANDS  ·  THE STORM CLOSES", titleBlock);

  const cols = h("div", {
    display: "flex", gap: "28px", alignItems: "stretch", flexWrap: "wrap",
    justifyContent: "center", animation: "lcPanelIn .7s .15s cubic-bezier(.2,.8,.2,1) both",
  }, null, wrap);
  const leftCol = h("div", { display: "flex", flexDirection: "column", gap: "10px", justifyContent: "center", minWidth: "300px" }, null, cols);

  let selMode = W.mode === "practice" ? "practice" : (W.mode || "standard");
  const modeIcons = { standard: "⚔", quick: "⚡", practice: "◎" };
  const modeEls = MODE_CARDS.map((m, i) => {
    const c = h("div", Object.assign({
      padding: "14px 20px 14px 16px", cursor: "pointer", minWidth: "300px",
      position: "relative", overflow: "hidden", animation: `lcPanelIn .55s ${0.2 + i * 0.06}s both`,
    }, PANEL), null, leftCol);
    c.className = "lc-mode-card lc-glass-scan";
    const row = h("div", { display: "flex", gap: "14px", alignItems: "center" }, null, c);
    h("div", {
      width: "40px", height: "40px", borderRadius: "10px", display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: "18px",
      background: "linear-gradient(145deg, rgba(87,176,255,0.25), rgba(40,90,160,0.15))",
      border: "1px solid rgba(140,200,255,0.25)",
    }, modeIcons[m.id] || "●", row);
    const txt = h("div", { flex: "1" }, null, row);
    h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontWeight: "800", fontSize: "14px",
      letterSpacing: "2px", color: "#eaf4ff",
    }, m.name, txt);
    h("div", { fontFamily: "Rajdhani, " + FONT, fontSize: "14px", fontWeight: "500", opacity: "0.72", marginTop: "2px", color: "#b8d0ea" }, m.sub, txt);
    // the card IS the play button — one click launches this mode (no separate DROP IN)
    h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "16px", fontWeight: "900",
      color: "#8ec8ff", opacity: "0.85", paddingLeft: "6px",
      textShadow: "0 0 14px rgba(80,160,255,0.6)",
    }, "▶", row);
    c.onclick = () => {
      selMode = m.id; W.events.emit("uiClick"); paint();
      teardownMenuWorld(W);
      startMatch({ mapId: randomMap(), mode: m.id });
    };
    // Tab-reachable. SQUAD UP / SETTINGS / HOW TO PLAY and the locker arrows are
    // real <button>s, so the keyboard reached everything on this screen EXCEPT
    // the only three controls that start a match — these cards were plain divs
    // with a mouse handler. (Map stays random; this is focus, not a picker.)
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); c.onclick(); } };
    return { m, c };
  });
  function paint() {
    modeEls.forEach(({ m, c }) => {
      const on = m.id === selMode;
      c.classList.toggle("sel", on);
      Object.assign(c.style, on ? PANEL_HOT : PANEL);
      c.style.borderLeft = on ? "3px solid #57b0ff" : "1px solid rgba(140,200,255,0.28)";
    });
  }
  paint();

  // (No separate DROP IN button — each mode card above launches on click.)
  h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "12px", fontWeight: "700",
    letterSpacing: "2.5px", color: "#9fd0ff", opacity: "0.7", textAlign: "center",
    marginTop: "6px", marginBottom: "2px", animation: "lcGlow 3.2s ease-in-out infinite",
  }, "◂  CHOOSE A MODE TO DEPLOY  ▸", leftCol);

  const subRow = h("div", { display: "flex", gap: "10px" }, null, leftCol);
  const mkGhost = (label, parent) => h("button", Object.assign({}, BTN, {
    flex: "1", fontSize: "12px", padding: "12px 8px",
    background: "rgba(255,255,255,0.06)", color: "#cfe4ff",
    border: "1px solid rgba(140,200,255,0.2)",
    fontFamily: "Rajdhani, " + FONT, fontWeight: "700", letterSpacing: "1.5px",
  }), label, parent);
  const online = mkGhost("🌐  SQUAD UP", subRow);
  online.onclick = () => { W.events.emit("uiClick"); W.events.emit("openOnline", { mode: selMode }); };
  const settings = mkGhost("⚙  SETTINGS", subRow);
  settings.onclick = () => { W.events.emit("uiClick"); showSettings(W); };
  const howTo = mkGhost("❔  HOW TO PLAY", subRow);
  howTo.onclick = () => { W.events.emit("uiClick"); showHowToPlay(W); };
  // First run gets it unprompted. A browser BR is opened cold from a link with
  // no manual and no install — there was no onboarding of ANY kind, and two of
  // the verbs (the emotes) appeared nowhere at all until ?v=67.
  // The handle used to be discarded, so nothing could cancel it: click a mode
  // card inside that 500 ms window and the tutorial opened as a blocking
  // zIndex-70 modal OVER the drop-select — whose 12 s auto-lock kept counting
  // behind it, so a first-run player lost their landing zone to a timer.
  try {
    if (!localStorage.getItem("lc_seen_intro")) R._introT = setTimeout(() => { R._introT = null; showHowToPlay(W); }, 500);
  } catch (e) {}

  // — SKIN BAY: premium 3D turntable —
  const bay = h("div", Object.assign({
    width: "320px", padding: "16px 18px 14px", display: "flex", flexDirection: "column",
    alignItems: "center", gap: "8px", position: "relative", overflow: "hidden",
  }, PANEL), null, cols);
  bay.className = "lc-glass-scan";
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "11px", letterSpacing: "3px",
    opacity: "0.7", fontWeight: "800", color: "#9fd0ff",
  }, "OPERATIVE", bay);
  const stage = h("div", {
    position: "relative", width: "280px", height: "280px", borderRadius: "14px",
    overflow: "hidden",
    background: "radial-gradient(ellipse at 50% 78%, rgba(87,176,255,0.28) 0%, rgba(8,18,36,0.5) 45%, rgba(4,10,20,0.85) 100%)",
    border: "1px solid rgba(120,190,255,0.25)",
    boxShadow: "inset 0 0 40px rgba(40,120,255,0.12), 0 0 24px rgba(40,100,200,0.15)",
  }, null, bay);
  // chrome corners
  [["0","0","borderTop","borderLeft"], ["0","auto","borderTop","borderRight"], ["auto","0","borderBottom","borderLeft"], ["auto","auto","borderBottom","borderRight"]]
    .forEach(([t, r, a, b], i) => {
      const c = h("div", {
        position: "absolute", width: "18px", height: "18px", top: t === "0" ? "8px" : "auto",
        bottom: t === "auto" ? "8px" : "auto", left: r === "0" ? "8px" : "auto",
        right: r === "auto" ? "8px" : "auto", pointerEvents: "none", zIndex: 2,
      }, null, stage);
      c.style[a] = "2px solid rgba(120,200,255,0.7)";
      c.style[b] = "2px solid rgba(120,200,255,0.7)";
    });
  const pvCv = h("canvas", { width: "280px", height: "280px", display: "block" }, null, stage);
  pvCv.width = 560; pvCv.height = 560;
  const nameEl = h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "18px", fontWeight: "800",
    letterSpacing: "2px", color: "#eef6ff", textShadow: "0 0 16px rgba(100,180,255,0.4)",
  }, "", bay);
  const subEl = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "14px", fontWeight: "600",
    opacity: "0.7", marginTop: "-2px", color: "#a8c8e8", letterSpacing: "1px",
  }, "", bay);
  const nav = h("div", { display: "flex", gap: "10px", alignItems: "center", marginTop: "4px" }, null, bay);
  const mkArrow = (txt) => h("button", Object.assign({}, BTN, {
    padding: "8px 18px", fontSize: "18px", background: "rgba(255,255,255,0.08)",
    color: "#cfe4ff", border: "1px solid rgba(140,200,255,0.25)",
  }), txt, nav);
  const prev = mkArrow("‹");
  const dots = h("div", { display: "flex", gap: "7px" }, null, nav);
  const dotEls = MENU_SKINS.map(() => h("div", {
    width: "9px", height: "9px", borderRadius: "50%",
    background: "rgba(255,255,255,0.22)", transition: "all .18s",
    boxShadow: "0 0 0 0 rgba(87,176,255,0)",
  }, null, dots));
  const next = mkArrow("›");

  let skinIdx = Math.max(0, MENU_SKINS.findIndex((s) => s.key === getChosenSkin()));
  let pvRig = null, pvRunning = true, pvBones = null, poseMod = null, pvIdleRelax = false;
  import("./pose.js" + (new URL(import.meta.url).search || "")).then((m) => { poseMod = m; });
  const pvScene = new THREE.Scene();
  const pvCam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  pvCam.position.set(0, 1.2, 3.4); pvCam.lookAt(0, 0.95, 0);
  pvScene.add(new THREE.HemisphereLight(0xd8f0ff, 0x1a2838, 1.15));
  const pvKey = new THREE.DirectionalLight(0xfff2e0, 2.4); pvKey.position.set(2.4, 3.6, 2.8); pvScene.add(pvKey);
  const pvRim = new THREE.DirectionalLight(0x57b0ff, 1.8); pvRim.position.set(-2.6, 2.4, -2.2); pvScene.add(pvRim);
  const pvKick = new THREE.DirectionalLight(0xff8866, 0.55); pvKick.position.set(0, 1, -3); pvScene.add(pvKick);
  // reflective stage floor
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.15, 0.08, 48),
    // metalness 0.65 + envMapIntensity was a claim the renderer could not honour:
    // with no scene.environment a metal surface loses its diffuse and gains no
    // reflection back, so the "reflective" stage disc rendered as a black hole.
    new THREE.MeshStandardMaterial({ color: 0x152a42, roughness: 0.35, metalness: 0.1 })
  );
  disc.position.y = -0.04;
  pvScene.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.08, 0.025, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x57b0ff, transparent: true, opacity: 0.55, toneMapped: false })
  );
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
  pvScene.add(ring);
  // soft ground glow
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x3a8fff, transparent: true, opacity: 0.12, toneMapped: false })
  );
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01;
  pvScene.add(glow);

  const pvR = new THREE.WebGLRenderer({ canvas: pvCv, antialias: true, alpha: true, powerPreference: "high-performance" });
  pvR.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  pvR.setSize(560, 560, false);
  pvR.toneMapping = THREE.ACESFilmicToneMapping;
  pvR.toneMappingExposure = 1.15;
  pvR.outputColorSpace = THREE.SRGBColorSpace;

  async function setSkin(i) {
    skinIdx = (i + MENU_SKINS.length) % MENU_SKINS.length;
    const meta = MENU_SKINS[skinIdx];
    // Locked skins stay browsable — seeing what level 10 buys you is the point
    // of a locker — but they are not equipped and not persisted.
    const unlocked = skinUnlocked(W, meta);
    nameEl.textContent = meta.name;
    nameEl.style.opacity = unlocked ? "1" : "0.55";
    subEl.textContent = unlocked ? meta.sub.toUpperCase() : "🔒 LOCKED · REACHES LEVEL " + meta.unlockLevel;
    subEl.style.color = unlocked ? "" : "#ffcc66";
    dotEls.forEach((d, j) => {
      const on = j === skinIdx;
      const jUnlocked = skinUnlocked(W, MENU_SKINS[j]);
      d.style.background = on ? (unlocked ? "#57b0ff" : "#ffcc66") : jUnlocked ? "rgba(255,255,255,0.22)" : "rgba(255,204,102,0.28)";
      d.style.boxShadow = on ? "0 0 10px " + (unlocked ? "rgba(87,176,255,0.8)" : "rgba(255,204,102,0.8)") : "none";
      d.style.transform = on ? "scale(1.25)" : "scale(1)";
    });
    if (unlocked) { try { localStorage.setItem("lc_skin", meta.key); } catch (e) {} }
    try {
      const rig = await W.kernel.loadCharacter(W.assetBase + "assets/chars/meshy/" + meta.key + ".glb");
      if (pvRig) { pvScene.remove(pvRig.scene); W.kernel.disposeMixer(pvRig.mixer); }
      pvRig = rig;
      rig.scene.position.set(0, 0, 0);
      pvScene.add(rig.scene);
      // Drive the rig IMMEDIATELY. kernel.loadCharacter() never auto-plays a
      // clip, and the cheer/dance actions below are two awaited GLB fetches away
      // — until they land the preview loop was rendering an undriven SkinnedMesh,
      // which reads as a collapsed ~0.1 m armature (see player.js:231), not a
      // neutral T-pose. The later play() calls crossfade off this one normally.
      if (rig.animations && rig.animations[0]) rig.play(rig.animations[0].name);
      pvBones = poseMod ? poseMod.findArmBones(rig.scene) : null;
      let cheerClip = null, danceClip = null;
      for (const c of ["cheer", "dance"]) {
        try {
          const g = await W.kernel.loader.loadAsync(W.assetBase + "assets/chars/meshy/" + meta.key + "_" + c + ".glb");
          if (g.animations && g.animations[0]) {
            g.animations[0].name = c + "_menu";
            rig.actions[c + "_menu"] = rig.mixer.clipAction(g.animations[0]);
            if (c === "cheer") cheerClip = g.animations[0]; else danceClip = g.animations[0];
          }
        } catch (e) {}
      }
      if (pvRig !== rig) return;
      if (cheerClip) {
        rig.play("cheer_menu", { once: true });
        pvIdleRelax = false;
        setTimeout(() => { if (pvRig === rig && danceClip) rig.play("dance_menu"); }, Math.max(400, cheerClip.duration * 1000 - 250));
      } else if (danceClip) {
        rig.play("dance_menu");
        pvIdleRelax = false;
      } else {
        const first = rig.animations[0];
        if (first) rig.play(first.name);
        pvIdleRelax = true;
      }
    } catch (e) { /* still baking */ }
  }
  prev.onclick = () => { W.events.emit("uiClick"); setSkin(skinIdx - 1); };
  next.onclick = () => { W.events.emit("uiClick"); setSkin(skinIdx + 1); };
  setSkin(skinIdx);
  (function pvLoop() {
    if (!pvRunning || !R.menu || !R.menu.isConnected) {
      pvR.dispose();
      if (pvRig) W.kernel.disposeMixer(pvRig.mixer);
      return;
    }
    const t = performance.now() / 1000;
    if (pvRig) {
      pvRig.scene.rotation.y += 0.01;
      if (pvIdleRelax && poseMod) {
        if (!pvBones) pvBones = poseMod.findArmBones(pvRig.scene);
        if (pvBones) poseMod.applyArmPose(pvRig.scene, pvBones, "relax", 1);
      }
    }
    if (ring) ring.material.opacity = 0.4 + Math.sin(t * 2) * 0.15;
    if (glow) glow.material.opacity = 0.08 + Math.sin(t * 1.5) * 0.04;
    pvR.render(pvScene, pvCam);
    requestAnimationFrame(pvLoop);
  })();
  R._menuStopPv = () => { pvRunning = false; };

  // bottom controls strip — the LIVE bindings, not the defaults. This string was
  // hardcoded, so after a rebind (and after switching sprint to HOLD in
  // Settings) the menu confidently taught keys that no longer did anything.
  const mk = (canonical) => { const ph = physFor(W, canonical); return ph ? keyLabel(ph) : "—"; };
  h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "13px", fontWeight: "600",
    opacity: "0.6", maxWidth: "820px", textAlign: "center", lineHeight: "1.7",
    letterSpacing: "0.5px", color: "#c0d4ec",
    textShadow: "0 2px 8px rgba(0,0,0,0.9)",
    animation: "lcPanelIn .6s .4s both",
  },
  mk("KeyW") + mk("KeyA") + mk("KeyS") + mk("KeyD") + " MOVE  ·  MOUSE AIM/FIRE  ·  RMB ADS  ·  " +
  mk("Space") + " JUMP / CHUTE  ·  " + mk("ShiftLeft") + " SPRINT (" + (W.settings && W.settings.sprintToggle ? "TOGGLE" : "HOLD") + ")  ·  " +
  mk("KeyR") + " RELOAD  ·  " + mk("KeyE") + " LOOT  ·  " + mk("Digit1") + "–" + mk("Digit5") + " WEAPONS  ·  " + mk("KeyM") + " MAP",
  wrap);

  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.startMenuMusic(W));
}

export function showLoading(W, text) {
  // a new match must clear every stray screen from the previous one — including
  // the first-run How To Play, which was neither in this list nor cancellable
  if (R._introT) { clearTimeout(R._introT); R._introT = null; }
  ["post", "death", "pause", "settings", "bigmap", "howto", "menu", "hud"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  teardownMenuWorld(W);
  W.paused = false;
  ensureAAAStyles();
  const L = layer("loading", {
    pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(ellipse at 50% 40%, rgba(20,40,70,0.55) 0%, rgba(4,10,20,0.92) 70%, rgba(2,6,12,0.97) 100%)",
  });
  const box = h("div", Object.assign({ textAlign: "center", padding: "36px 48px", minWidth: "360px" }, PANEL), null, L);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "28px", fontWeight: "900", letterSpacing: "6px",
    background: "linear-gradient(180deg,#fff,#7eb8ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  }, "LAST CIRCLE", box);
  h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "16px", fontWeight: "600", opacity: "0.85",
    marginTop: "14px", letterSpacing: "2px", color: "#b8d4f0",
  }, text || "DEPLOYING…", box);
  const bar = h("div", {
    width: "300px", height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px",
    margin: "22px auto 0", overflow: "hidden", border: "1px solid rgba(120,180,255,0.2)",
  }, null, box);
  const fill = h("div", {
    width: "30%", height: "100%",
    background: "linear-gradient(90deg,#2f7fd6,#6ec4ff,#2f7fd6)", backgroundSize: "200% 100%",
    borderRadius: "2px", transition: "width .4s", animation: "lcShimmer 1.6s linear infinite",
    boxShadow: "0 0 12px rgba(87,176,255,0.6)",
  }, null, bar);
  let p = 30;
  R._loadIv = setInterval(() => { p = Math.min(92, p + 8); fill.style.width = p + "%"; }, 300);
}

// ═══ LOBBY ═══════════════════════════════════════════════════════════════════
export function showLobby(W, onDone) {
  if (R._loadIv) { clearInterval(R._loadIv); R._loadIv = null; }
  if (R.loading) { R.loading.remove(); R.loading = null; }
  if (R.menu) { R.menu.remove(); R.menu = null; }
  teardownMenuWorld(W);
  ensureAAAStyles();
  const L = layer("lobby", {
    pointerEvents: "auto",
    background: "radial-gradient(ellipse at 50% 30%, rgba(10,24,48,0.55) 0%, rgba(4,10,20,0.88) 100%)",
  });
  const wrap = h("div", {
    position: "absolute", inset: "0", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "18px",
  }, null, L);
  const mapName = (W.map && W.map.K && W.map.K.name) || W.mapId;
  const modeLabel = W.mode === "quick" ? "QUICK MATCH" : W.mode === "practice" ? "PRACTICE" : "BATTLE ROYALE";
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "13px", fontWeight: "800",
    letterSpacing: "4px", color: "#8ec8ff", opacity: "0.85",
  }, "MATCH LOBBY", wrap);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "28px", fontWeight: "900", letterSpacing: "3px",
    textShadow: "0 0 24px rgba(80,160,255,0.4)",
  }, mapName.toUpperCase() + "  ·  " + modeLabel, wrap);
  const count = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "18px", fontWeight: "600", opacity: "0.9", color: "#c8dff8",
  }, "FILLING LOBBY… 1/" + W.actors.length, wrap);
  const grid = h("div", {
    display: "grid", gridTemplateColumns: "repeat(10, 108px)", gap: "6px", maxWidth: "1180px",
    padding: "16px", borderRadius: "14px",
    background: "rgba(6,14,28,0.55)", border: "1px solid rgba(120,180,255,0.15)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
  }, null, wrap);
  const cells = W.actors.map((a) => {
    const c = h("div", {
      padding: "6px 8px", fontSize: "11px", borderRadius: "6px",
      background: "rgba(255,255,255,0.04)", color: "transparent",
      overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
      border: "1px solid rgba(255,255,255,0.05)", fontFamily: "Rajdhani, " + FONT, fontWeight: "600",
    }, a.name, grid);
    return c;
  });
  const cd = h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "56px", fontWeight: "900",
    color: "#6ec4ff", minHeight: "64px", textShadow: "0 0 32px rgba(87,176,255,0.55)",
  }, "", wrap);
  if (W.mode === "practice") h("div", { fontSize: "13px", opacity: "0.7", letterSpacing: "1px" }, "SANDBOX — NO STORM · FULL LOADOUT · FIVE RANGE DUMMIES AT 12–80M, DUE SOUTH OF SPAWN", wrap);

  // fill animation then countdown
  let filled = 1;
  cells[0].style.color = "#9fd7ff";
  cells[0].style.background = "rgba(87,176,255,0.22)";
  cells[0].style.borderColor = "rgba(87,176,255,0.45)";
  cells[0].style.boxShadow = "0 0 12px rgba(87,176,255,0.25)";
  const fillIv = setInterval(() => {
    const step = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < step && filled < cells.length; i++, filled++) {
      cells[filled].style.color = "#dfeaff";
      cells[filled].style.background = "rgba(255,255,255,0.07)";
      cells[filled].style.borderColor = "rgba(140,180,220,0.18)";
    }
    count.textContent = (W.net ? "WAITING FOR SQUAD… " : "FILLING LOBBY… ") + filled + "/" + W.actors.length;
    if (filled >= cells.length) {
      clearInterval(fillIv);
      count.textContent = W.actors.length + "/" + W.actors.length + "  —  ALL OPERATIVES READY";
      let n = W.mode === "practice" ? 1 : 3;
      cd.textContent = n;
      W.events.emit("countdownBeep", false);
      const cdIv = setInterval(() => {
        n--;
        if (n <= 0) {
          clearInterval(cdIv);
          W.events.emit("countdownBeep", true);
          L.remove(); R.lobby = null;
          onDone();
        } else { cd.textContent = n; W.events.emit("countdownBeep", false); }
      }, 900);
    }
  }, W.mode === "practice" ? 30 : 140);
}

// ═══ DROP SELECT ═════════════════════════════════════════════════════════════
// Every bot picks a named POI to land at (bots.assignDrops runs before the
// lobby) while the human was dumped over a random ground point — the worst loot
// odds on the field, and it skipped the decision every battle royale opens
// with. This is the map screen: pick a spot, read how contested it is from the
// bots' actual declared targets, lock it in. It always auto-locks on the timer
// so online clients advance together.
export function showDropSelect(W, onDone) {
  releaseCursor(W);          // you pick your landing zone by CLICKING the map
  ensureAAAStyles();
  const L = layer("dropsel", {
    pointerEvents: "auto",
    background: "radial-gradient(ellipse at 50% 40%, rgba(10,24,48,0.72) 0%, rgba(3,8,16,0.94) 100%)",
  });
  const wrap = h("div", {
    position: "absolute", inset: "0", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "10px",
  }, null, L);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "13px", fontWeight: "800",
    letterSpacing: "4px", color: "#8ec8ff", opacity: "0.85",
  }, "SELECT LANDING ZONE", wrap);

  // contest heat — bots stash their choice on brain.bb.dropTarget, so this is
  // the real inbound count, not a guess
  const pois = (W.map && W.map.pois) || [];
  const heat = pois.map((p) => {
    let n = 0;
    for (const a of W.actors) {
      const t = a.brain && a.brain.bb && a.brain.bb.dropTarget;
      if (!t) continue;
      const dx = t.x - p.x, dz = t.z - p.z;
      if (dx * dx + dz * dz <= (p.r * 1.35) * (p.r * 1.35)) n++;
    }
    return n;
  });
  const heatCol = (n) => (n >= 5 ? "#ff6b5a" : n >= 2 ? "#ffcc66" : n >= 1 ? "#9fd7ff" : "#6fe3a0");
  const heatWord = (n) => (n >= 5 ? "HOT" : n >= 2 ? "CONTESTED" : n >= 1 ? "LIGHT" : "QUIET");

  const size = Math.max(260, Math.min(window.innerHeight * 0.60, window.innerWidth * 0.60));
  const cv = h("canvas", {
    borderRadius: "10px", cursor: "crosshair",
    border: "1px solid rgba(140,200,255,0.35)", boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
  }, null, wrap);
  cv.width = size; cv.height = size;
  cv.style.width = size + "px"; cv.style.height = size + "px";
  const ctx = cv.getContext("2d");
  const S = W.map.size;
  const toPx = (v) => (v / S + 0.5) * size;
  const toWorld = (px) => (px / size - 0.5) * S;

  let pick = null;
  function draw() {
    ctx.clearRect(0, 0, size, size);
    if (W.map.minimap) ctx.drawImage(W.map.minimap, 0, 0, size, size);
    ctx.fillStyle = "rgba(4,10,20,0.22)"; ctx.fillRect(0, 0, size, size);
    ctx.textAlign = "center";
    pois.forEach((p, i) => {
      const x = toPx(p.x), z = toPx(p.z), r = Math.max(10, (p.r / S) * size);
      const c = heatCol(heat[i]);
      ctx.globalAlpha = 0.85; ctx.strokeStyle = c; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.12; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // inbound count goes INSIDE the ring — a count under the ring collides
      // with the next POI's name wherever zones sit close together
      ctx.font = "800 13px system-ui";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(heat[i] || "0", x + 1, z + 5);
      ctx.fillStyle = c;
      ctx.fillText(heat[i] || "0", x, z + 4);
      // name on a backing pill so it stays legible over any terrain
      ctx.font = "700 12px system-ui";
      const tw = ctx.measureText(p.name).width, ty = z - r - 7;
      ctx.fillStyle = "rgba(3,10,20,0.74)";
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x - tw/2 - 5, ty - 11, tw + 10, 15, 4); ctx.fill(); }
      else ctx.fillRect(x - tw/2 - 5, ty - 11, tw + 10, 15);
      ctx.fillStyle = "#fff"; ctx.fillText(p.name, x, ty);
    });
    if (pick) {
      const x = toPx(pick.x), z = toPx(pick.z);
      const t = (Date.now() % 900) / 900;
      ctx.strokeStyle = "#6ec4ff"; ctx.lineWidth = 2.4;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath(); ctx.arc(x, z, 7 + t * 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(x - 9, z); ctx.lineTo(x + 9, z);
      ctx.moveTo(x, z - 9); ctx.lineTo(x, z + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, z, 4, 0, Math.PI * 2); ctx.fillStyle = "#6ec4ff"; ctx.fill();
    }
  }

  const info = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "17px", fontWeight: "700",
    letterSpacing: "1px", color: "#c8dff8", minHeight: "22px",
  }, "CLICK THE MAP TO CHOOSE YOUR LANDING ZONE", wrap);

  function choose(wx, wz) {
    let best = -1, bd = 1e9;
    pois.forEach((p, i) => {
      const d = Math.hypot(wx - p.x, wz - p.z);
      if (d < p.r * 1.15 && d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { wx = pois[best].x; wz = pois[best].z; }
    pick = { x: wx, z: wz, name: best >= 0 ? pois[best].name : "OPEN GROUND", poi: best };
    info.textContent = "LZ: " + pick.name + "  ·  " +
      (best >= 0 ? heatWord(heat[best]) + (heat[best] ? " (" + heat[best] + " INBOUND)" : "") : "QUIET · NO LOOT CLUSTER");
    info.style.color = best >= 0 ? heatCol(heat[best]) : "#6fe3a0";
    draw();
  }
  cv.addEventListener("click", (ev) => {
    const b = cv.getBoundingClientRect();
    choose(toWorld((ev.clientX - b.left) * (size / b.width)),
           toWorld((ev.clientY - b.top) * (size / b.height)));
  });

  const row = h("div", { display: "flex", gap: "16px", alignItems: "center", marginTop: "2px" }, null, wrap);
  const timerEl = h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "22px", fontWeight: "900",
    color: "#6ec4ff", letterSpacing: "2px", minWidth: "104px", textAlign: "right",
  }, "", row);
  const go = h("button", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "15px", fontWeight: "900", letterSpacing: "2px",
    padding: "11px 26px", borderRadius: "9px", cursor: "pointer", color: "#03121f",
    border: "1px solid rgba(140,220,255,0.6)", background: "linear-gradient(180deg,#8fe0ff,#3fa9e8)",
    boxShadow: "0 8px 26px rgba(60,170,235,0.35)",
  }, "DROP", row);
  const legend = h("div", {
    display: "flex", gap: "15px", alignItems: "center", fontSize: "11px",
    letterSpacing: "1px", opacity: "0.85", fontFamily: "Rajdhani, " + FONT, fontWeight: "600",
  }, null, wrap);
  [["QUIET", 0], ["LIGHT", 1], ["CONTESTED", 2], ["HOT", 5]].forEach((e) => {
    const it = h("div", { display: "flex", gap: "5px", alignItems: "center" }, null, legend);
    h("span", {
      width: "9px", height: "9px", borderRadius: "50%", display: "inline-block",
      background: heatCol(e[1]), boxShadow: "0 0 7px " + heatCol(e[1]),
    }, null, it);
    h("span", null, e[0], it);
  });
  h("div", {
    fontSize: "11px", opacity: "0.55", letterSpacing: "1px", fontFamily: "Rajdhani, " + FONT,
  }, "THE NUMBER IN EACH ZONE IS HOW MANY OPERATIVES DECLARED IT. YOU STEER FREELY ON THE WAY DOWN.", wrap);

  let done = false;
  let left = W.mode === "practice" ? 1 : 12;
  timerEl.textContent = "AUTO " + left;
  const anim = setInterval(draw, 90);
  function finish() {
    if (done) return;
    done = true;
    clearInterval(anim); clearInterval(iv);
    if (!pick) {
      // never picked → the quietest named zone beats the old random dump
      let q = -1, qn = 1e9;
      heat.forEach((n, i) => { if (n < qn) { qn = n; q = i; } });
      pick = q >= 0
        ? { x: pois[q].x, z: pois[q].z, name: pois[q].name, poi: q }
        : null;
    }
    L.remove(); R.dropsel = null;
    onDone(pick);
  }
  const iv = setInterval(() => {
    left--;
    timerEl.textContent = left > 0 ? "AUTO " + left : "DROPPING";
    if (left <= 0) finish();
  }, 1000);
  go.addEventListener("click", finish);
  draw();
  return { finish };
}

// ═══ progression + challenges (Final Drop-style meta) ════════════════════════
// A persistent level/XP bar + one active in-match challenge card, fed off the
// existing W.match / W.t / W.stats counters. Progress persists in localStorage.
// lifetime career record — the post-match screen already computes every one of
// these numbers and used to throw them away, so nothing accrued between matches.
const CAREER0 = { matches: 0, wins: 0, kills: 0, damage: 0, bestPlacement: 0, top10s: 0, timeAliveS: 0 };
function loadProgress() {
  try {
    const p = Object.assign({ level: 1, xp: 0, lastPlayedDay: null, dayStreak: 0 }, JSON.parse(localStorage.getItem("lc_progress") || "{}"));
    p.career = Object.assign({}, CAREER0, p.career || {});
    return p;
  } catch (e) { return { level: 1, xp: 0, lastPlayedDay: null, dayStreak: 0, career: Object.assign({}, CAREER0) }; }
}
/** YYYY-MM-DD in LOCAL time. A UTC stamp rolls the day over mid-evening for
 *  anyone west of Greenwich, which would break the streak of a player who did
 *  nothing wrong. */
function dayKey(d) {
  const t = d || new Date();
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}
function saveProgress(p) { try { localStorage.setItem("lc_progress", JSON.stringify(p)); } catch (e) {} }
// fold a finished match into the lifetime record (best placement = LOWEST number)
function recordMatch(W, res) {
  if (W.mode === "practice") return null;   // sandbox stats are not a career
  const p = W.progress; if (!p) return null;
  const c = p.career || (p.career = Object.assign({}, CAREER0));
  c.matches++;
  if (res.victory) c.wins++;
  c.kills += res.kills || 0;
  c.damage += Math.round(res.damage || 0);
  c.timeAliveS += Math.round(res.timeS || 0);
  const pl = res.placement || 99;
  if (!c.bestPlacement || pl < c.bestPlacement) c.bestPlacement = pl;
  if (pl <= 10) c.top10s++;
  // Nothing in the game knew what day it was — no timestamp anywhere in the
  // save — so tomorrow was worth exactly as much as next month. One field.
  const today = dayKey();
  if (p.lastPlayedDay !== today) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    p.dayStreak = p.lastPlayedDay === dayKey(y) ? (p.dayStreak || 0) + 1 : 1;
    p.lastPlayedDay = today;
  }
  saveProgress(p);
  return c;
}
function xpForLevel(lvl) { return 800 + (lvl - 1) * 700; }   // rising curve
function addXP(W, amt) {
  // Practice is a sandbox with a no-death dummy range: damage there is
  // unlimited, so paying XP or challenge rewards for it would make levelling
  // a matter of standing still and holding the trigger.
  if (W.mode === "practice") return;
  const p = W.progress; if (!p || !amt) return;
  p.xp += amt;
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; if (W.events) W.events.emit("levelUp", p.level); }
  saveProgress(p); W._xpDirty = true;
}
const CHAL_POOL = [
  { id: "survive", label: "Survive 3 minutes", goal: 180, xp: 150, prog: (W) => Math.floor(W.t) },
  { id: "elim", label: "Get 1 elimination", goal: 1, xp: 175, prog: (W) => (W.match && W.match.kills[W.player.id]) || 0 },
  { id: "dmg", label: "Deal 300 damage", goal: 300, xp: 140, prog: (W) => Math.round((W.match && W.match.damage[W.player.id]) || 0) },
  { id: "top10", label: "Reach the final 10", goal: 1, xp: 200, prog: (W) => (W.match && W.match.aliveCount() <= 10 ? 1 : 0) },
  { id: "elim3", label: "Get 3 eliminations", goal: 3, xp: 300, prog: (W) => (W.match && W.match.kills[W.player.id]) || 0 },
];
function pickChallenges(W) {
  // the two the reference shows, plus one rotating by the player's level
  const rot = (W.progress ? W.progress.level : 1) % 3;
  const extra = [CHAL_POOL[2], CHAL_POOL[3], CHAL_POOL[4]][rot];
  return [CHAL_POOL[0], CHAL_POOL[1], extra].map((c) => Object.assign({}, c, { done: false, awarded: false }));
}

// compass ribbon — scrolling cardinal heading from the camera's facing
const _cmpDir = new THREE.Vector3();
function drawCompass(W, ctx, wpx) {
  // The backing store is wpx*dpr (see showHUD); scale so every coordinate below
  // stays in logical px. Derived from the canvas rather than read fresh off
  // window.devicePixelRatio, so it can never disagree with the buffer we have.
  const dpr = ctx.canvas.width / wpx || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const H = 18; ctx.clearRect(0, 0, wpx, H);
  if (!W.player || !W.camera) return;
  W.camera.getWorldDirection(_cmpDir);
  const bearing = (Math.atan2(_cmpDir.x, _cmpDir.z) * 180 / Math.PI + 360) % 360;   // 0 = +Z (N)
  const cx = wpx / 2, pxPerDeg = wpx / 130;
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0, 0, wpx, H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
  for (let deg = 0; deg < 360; deg += 15) { const d = ((deg - bearing + 540) % 360) - 180; if (Math.abs(d) > 64) continue; const x = cx + d * pxPerDeg; ctx.beginPath(); ctx.moveTo(x, H - 4); ctx.lineTo(x, H); ctx.stroke(); }
  const marks = [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SW", 225], ["W", 270], ["NW", 315]];
  for (const m of marks) { const d = ((m[1] - bearing + 540) % 360) - 180; if (Math.abs(d) > 64) continue; const x = cx + d * pxPerDeg; ctx.font = m[0].length === 1 ? "bold 12px sans-serif" : "10px sans-serif"; ctx.fillStyle = m[0].length === 1 ? "#ffffff" : "#9fb6cc"; ctx.fillText(m[0], x, H / 2 + 1); }
  ctx.fillStyle = "#ffd873"; ctx.beginPath(); ctx.moveTo(cx - 5, 0); ctx.lineTo(cx + 5, 0); ctx.lineTo(cx, 6); ctx.closePath(); ctx.fill();
}

// ═══ HUD ═════════════════════════════════════════════════════════════════════
export function showHUD(W) {
  const L = layer("hud");
  // The scope surround is a 92%-black radial fill over the WHOLE screen. Nothing
  // in the hud layer sets a z-index, so paint order is pure DOM order — created
  // last, it covered health, shields, ammo, the storm clock, the minimap, the
  // kill feed and the damage chevrons. Scoping a sniper blacked out every piece
  // of information you need to decide whether to take the shot. Created FIRST,
  // it sits underneath them all; its own crosshair lines are at screen centre
  // where no widget draws, and R.cross is already hidden while scoped.
  R.scope = h("div", { position: "absolute", inset: "0", display: "none", background: "radial-gradient(circle at center, rgba(0,0,0,0) 26%, rgba(0,0,0,0.92) 27%)", pointerEvents: "none" }, null, L);
  const scLine = h("div", { position: "absolute", left: "50%", top: "50%", width: "40%", height: "1px", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);
  h("div", { position: "absolute", left: "50%", top: "50%", width: "1px", height: "40%", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);
  const bottomLeft = h("div", { position: "absolute", left: "18px", bottom: "16px", width: "300px" }, null, L);
  // hp/shield — Final Drop style: icon + bar with % inside
  const mkBar = (icon, color) => {
    const row = h("div", { display: "flex", alignItems: "center", gap: "6px", marginTop: "5px" }, null, bottomLeft);
    h("div", { fontSize: "15px", width: "20px", textAlign: "center", filter: "drop-shadow(0 1px 2px #000)" }, icon, row);
    const wrap = h("div", { flex: "1", height: "16px", background: "rgba(0,0,0,0.55)", borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)", position: "relative" }, null, row);
    const fill = h("div", { width: "0%", height: "100%", background: color, transition: "width .15s" }, null, wrap);
    const pct = h("div", { position: "absolute", inset: "0", textAlign: "center", fontSize: "11px", fontWeight: "900", lineHeight: "16px", textShadow: "0 1px 2px #000" }, "", wrap);
    return { fill, pct };
  };
  const sb = mkBar("🛡", "#57b0ff");
  R.shieldBar = sb.fill; R.shieldPct = sb.pct;
  const hb = mkBar("❤", "#4ade80");
  R.hpBar = hb.fill; R.hpPct = hb.pct;
  R.hpText = h("div", { fontSize: "0px", display: "none" }, "", bottomLeft);
  // heal channel
  R.healBar = h("div", { position: "absolute", left: "50%", top: "58%", transform: "translateX(-50%)", width: "220px", height: "10px", background: "rgba(0,0,0,0.5)", borderRadius: "5px", display: "none", overflow: "hidden" }, null, L);
  R.healFill = h("div", { width: "0%", height: "100%", background: "#4ade80" }, null, R.healBar);
  // Reload had NO progress UI at all — just the word "RELOADING…" — while both
  // healing and chest-opening show a bar. A 4-second shotgun reload with no
  // sense of how far along you are is the difference between pushing and dying.
  // SHIFT is a TOGGLE (owner direction), so the latch state must be visible —
  // with hold-to-sprint your finger is the indicator; with a toggle nothing tells
  // you you are still sprinting into a fight with wide hipfire spread.
  R.sprintPip = h("div", { position: "absolute", left: "50%", top: "66.5%", transform: "translateX(-50%)",
    font: "700 11px ui-monospace,Menlo,Consolas,monospace", letterSpacing: "0.16em",
    color: "#8ef5c8", textShadow: "0 1px 3px #000", opacity: "0", transition: "opacity 140ms linear",
    pointerEvents: "none", whiteSpace: "nowrap" }, "▶ SPRINT", L);

  // top 55%, not 62.5%: the interact hint (top 60%, opaque, ~29px tall, created
  // 53 lines later in the same z-index-free layer so it paints on top) covered
  // the top half of this bar on any viewport under ~1160px — i.e. a maximised
  // 1080p browser — exactly while you stand over loot and reload.
  R.reloadBar = h("div", { position: "absolute", left: "50%", top: "55%", transform: "translateX(-50%)", width: "180px", height: "8px", background: "rgba(0,0,0,0.55)", borderRadius: "4px", display: "none", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }, null, L);
  R.reloadFill = h("div", { width: "0%", height: "100%", background: "#ffd166" }, null, R.reloadBar);

  // slots bottom right
  const br = h("div", { position: "absolute", right: "18px", bottom: "16px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }, null, L);
  R.slotsRow = h("div", { display: "flex", gap: "6px" }, null, br);
  R.ammoText = h("div", { fontSize: "22px", fontWeight: "900", textShadow: "0 2px 4px #000" }, "", br);

  // compass ribbon (very top center) — cardinal heading like the reference
  const cmpWrap = h("div", { position: "absolute", top: "4px", left: "50%", transform: "translateX(-50%)", width: "320px", height: "18px" }, null, L);
  R.compass = h("canvas", { display: "block", borderRadius: "4px", width: "320px", height: "18px" }, null, cmpWrap);
  R.compass.width = Math.round(320 * HUD_DPR); R.compass.height = Math.round(18 * HUD_DPR);

  // top center: storm timer + alive
  const tc = h("div", { position: "absolute", top: "28px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "18px", alignItems: "center", background: "rgba(0,0,0,0.4)", padding: "6px 18px", borderRadius: "10px" }, null, L);
  R.stormIcon = h("div", { fontSize: "15px" }, "⛈", tc);
  R.stormTimer = h("div", { fontSize: "17px", fontWeight: "800", minWidth: "72px" }, "", tc);
  h("div", { width: "1px", height: "18px", background: "rgba(255,255,255,0.25)" }, null, tc);
  R.aliveText = h("div", { fontSize: "17px", fontWeight: "800" }, "", tc);
  R.killsText = h("div", { fontSize: "15px", fontWeight: "700", opacity: "0.85" }, "", tc);

  // XP/level bar + active challenge card (Final Drop-style meta), below the storm bar
  if (!W.progress) W.progress = loadProgress();
  W._challenges = pickChallenges(W); W._chalIdx = 0; W._xpDirty = true; W._chalXp = 0;
  const meta = h("div", { position: "absolute", top: "66px", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "352px" }, null, L);
  const xpRow = h("div", { display: "flex", alignItems: "center", gap: "8px", width: "100%", background: "rgba(0,0,0,0.42)", padding: "4px 10px", borderRadius: "8px" }, null, meta);
  R.xpLevel = h("div", { fontSize: "12px", fontWeight: "900", color: "#ffd873", minWidth: "48px", textShadow: "0 1px 2px #000" }, "LVL 1", xpRow);
  const xpBarWrap = h("div", { flex: "1", height: "10px", background: "rgba(0,0,0,0.55)", borderRadius: "5px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }, null, xpRow);
  R.xpFill = h("div", { width: "0%", height: "100%", background: "linear-gradient(90deg,#4aa8ff,#7ad0ff)", transition: "width .3s" }, null, xpBarWrap);
  R.xpText = h("div", { fontSize: "10px", fontWeight: "700", opacity: "0.85", minWidth: "74px", textAlign: "right" }, "", xpRow);
  R.chalCard = h("div", Object.assign({ display: "none", alignItems: "center", gap: "10px", width: "100%", padding: "7px 12px" }, PANEL), null, meta);
  R.chalIcon = h("div", { fontSize: "16px" }, "🎯", R.chalCard);
  const chalMid = h("div", { flex: "1" }, null, R.chalCard);
  R.chalLabel = h("div", { fontSize: "13px", fontWeight: "800" }, "", chalMid);
  const chalBarWrap = h("div", { height: "6px", background: "rgba(0,0,0,0.5)", borderRadius: "3px", overflow: "hidden", marginTop: "4px" }, null, chalMid);
  R.chalFill = h("div", { width: "0%", height: "100%", background: "#4ade80", transition: "width .2s" }, null, chalBarWrap);
  R.chalProg = h("div", { fontSize: "11px", fontWeight: "800", opacity: "0.8", minWidth: "44px", textAlign: "right" }, "", R.chalCard);
  R.chalXp = h("div", { fontSize: "11px", fontWeight: "900", color: "#ffd873" }, "", R.chalCard);

  // minimap top left
  const mmWrap = h("div", { position: "absolute", top: "12px", left: "14px", width: "180px", height: "180px", borderRadius: "12px", overflow: "hidden", border: "2px solid rgba(120,180,255,0.35)", boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }, null, L);
  R.mmCanvas = h("canvas", { width: "180px", height: "180px" }, null, mmWrap);
  R.mmCanvas.width = Math.round(180 * HUD_DPR); R.mmCanvas.height = Math.round(180 * HUD_DPR);

  // kill feed right
  R.feed = h("div", { position: "absolute", right: "16px", top: "70px", display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end", fontSize: "12px" }, null, L);

  // crosshair — PER-WEAPON reticles (painted by paintCrosshair)
  R.cross = h("div", { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "56px", height: "56px", transition: "transform .12s" }, null, L);
  R._crossFor = null;
  R.hitmark = h("div", { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%) rotate(45deg)", fontSize: "26px", color: "#fff", opacity: "0", transition: "opacity .18s" }, "✕", L);

  // interact hint + chest-open progress ring
  R.interact = h("div", { position: "absolute", left: "50%", top: "60%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", padding: "6px 14px", borderRadius: "8px", fontSize: "14px", display: "none" }, "", L);
  R.chestRing = h("div", { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "58px", height: "58px", borderRadius: "50%", display: "none", background: "conic-gradient(#ffd254 0deg, rgba(255,255,255,0.15) 0deg)", WebkitMask: "radial-gradient(circle, transparent 22px, #000 23px)", mask: "radial-gradient(circle, transparent 22px, #000 23px)" }, null, L);

  // directional indicators (footsteps / gunfire / damage) on a screen-edge ring
  R.indicators = h("div", { position: "absolute", inset: "0", pointerEvents: "none" }, null, L);

  // parachute button indicator during the drop (Final Drop style)
  R.chuteBtn = h("div", { position: "absolute", right: "40px", bottom: "120px", width: "84px", height: "84px", borderRadius: "50%", background: "rgba(10,19,31,0.75)", border: "2px solid rgba(140,190,255,0.6)", display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }, null, L);
  R.chuteGlyph = h("div", { fontSize: "26px", lineHeight: "1.1" }, "🪂", R.chuteBtn);
  R.chuteLabel = h("div", { fontSize: "10px", fontWeight: "900", letterSpacing: "0.5px", marginTop: "2px" }, "[SPACE]", R.chuteBtn);

  // storm messages center
  R.stormMsg = h("div", { position: "absolute", left: "50%", top: "22%", transform: "translateX(-50%)", fontSize: "22px", fontWeight: "900", letterSpacing: "1px", textShadow: "0 2px 8px #000", opacity: "0", transition: "opacity .4s", color: "#d9b3ff" }, "", L);
  // BIG match announcements (deploy, alive-count milestones, eliminations, level-up)
  R.annWrap = h("div", { position: "absolute", left: "50%", top: "14%", transform: "translateX(-50%)", textAlign: "center", opacity: "0", transition: "opacity .35s, transform .35s", pointerEvents: "none" }, null, L);
  R.annTitle = h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "34px", fontWeight: "900", letterSpacing: "4px", textShadow: "0 3px 14px #000, 0 0 26px rgba(90,170,255,0.5)" }, "", R.annWrap);
  R.annSub = h("div", { fontSize: "14px", fontWeight: "700", letterSpacing: "2px", opacity: "0.85", marginTop: "4px", textShadow: "0 2px 6px #000" }, "", R.annWrap);
  R._annUntil = 0; R._aliveMark = 0; R._annPrio = 0; R._annQ = [];

  // tints
  R.stormTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(130,60,200,0) 55%, rgba(130,60,200,0.35) 100%)", opacity: "0", transition: "opacity .5s", pointerEvents: "none" }, null, L);
  R.hurtTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(200,30,30,0) 60%, rgba(200,30,30,0.4) 100%)", opacity: "0", transition: "opacity .3s", pointerEvents: "none" }, null, L);

  R._hudCache = {};
  // perf readout (opt-in): FPS always, plus link freshness when online. This is
  // deliberately NOT labelled "ping" — net.js records lastSeen timestamps, not
  // round-trip time, so calling it ping would be a lie.
  // top 44px, not 96px: the kill feed starts at top 70px and its rows are ~20px
  // + 4px gap, so a 24px chip at 96 painted over almost all of feed row 2 — and
  // the chip is created 38 lines later in the same z-index-free layer, so it won.
  R.perf = h("div", {
    position: "absolute", right: "12px", top: "44px", padding: "4px 9px", borderRadius: "6px",
    fontFamily: "ui-monospace, Consolas, monospace", fontSize: "12px", fontWeight: "700",
    color: "#9fe6c0", background: "rgba(4,10,20,0.55)", border: "1px solid rgba(120,180,255,0.18)",
    letterSpacing: "0.5px", pointerEvents: "none",
    display: W.settings && W.settings.showPerf ? "block" : "none",
  }, "— FPS", L);
  R._fpsAcc = 0; R._fpsFrames = 0; R._fpsShown = 0;
  // who you are watching once you are out, and how to change it
  R.specBar = h("div", {
    position: "absolute", left: "50%", bottom: "84px", transform: "translateX(-50%)",
    padding: "6px 16px", borderRadius: "8px", background: "rgba(4,10,20,0.6)",
    border: "1px solid rgba(140,200,255,0.25)", fontFamily: "Rajdhani, " + FONT,
    fontSize: "13px", fontWeight: "700", letterSpacing: "1.5px", color: "#cfe4ff",
    display: "none", pointerEvents: "none", whiteSpace: "nowrap",
  }, "", L);
  // practice: a live range readout, so the dummies are a measurement and not
  // just something to shoot at
  R.rangePanel = null;
  if (W.mode === "practice") {
    R.rangePanel = h("div", Object.assign({
      position: "absolute", left: "50%", top: "10px", transform: "translateX(-50%)",
      padding: "7px 16px", borderRadius: "8px", fontFamily: "Rajdhani, " + FONT,
      fontSize: "13px", fontWeight: "700", letterSpacing: "1.5px", color: "#cfe6ff",
      whiteSpace: "nowrap",
    }, PANEL), "RANGE — OPEN FIRE", L);
  }
  // deployment beat — the match used to just… start, with no moment marking it
  const tot = W.match ? W.match.totalPlayers : 50;
  if (W.mode === "practice") setTimeout(() => announce("PRACTICE", "FIVE DUMMIES DUE SOUTH · 12–80M", "#9fd7ff", 2600, ANN_PRIO.deploy), 250);
  else setTimeout(() => announce("DEPLOY", tot + " PLAYERS · LAST ONE STANDING WINS", "#9fd7ff", 2600, ANN_PRIO.deploy), 250);
}

function bar(parent, color) {
  const wrap = h("div", { width: "100%", height: "14px", background: "rgba(0,0,0,0.5)", borderRadius: "7px", overflow: "hidden", marginTop: "5px", border: "1px solid rgba(255,255,255,0.15)" }, null, parent);
  const fill = h("div", { width: "0%", height: "100%", background: color, transition: "width .15s" }, null, wrap);
  return fill;
}

function hideHUD() {
  ["hud", "death", "post", "bigmap"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
}

// ═══ per-frame update ════════════════════════════════════════════════════════
let mmT = 0, srT = 0;
export function update(W, dt) {
  if (!R.hud || !W.player) return;
  // perf readout: average over ~0.5s so the number is readable, not a strobe
  if (R.perf && W.settings && W.settings.showPerf) {
    if (R.perf.style.display === "none") R.perf.style.display = "block";
    R._fpsAcc += dt; R._fpsFrames++;
    if (R._fpsAcc >= 0.5) {
      const fps = Math.round(R._fpsFrames / R._fpsAcc);
      R._fpsAcc = 0; R._fpsFrames = 0;
      let txt = fps + " FPS";
      if (W.net && W._netStats && W._netStats.lastSeenAgeMs != null) {
        txt += "  ·  SYNC " + Math.round(W._netStats.lastSeenAgeMs) + "ms";
      }
      if (txt !== R._fpsShown) { R.perf.textContent = txt; R._fpsShown = txt; }
      R.perf.style.color = fps >= 50 ? "#9fe6c0" : fps >= 30 ? "#ffd166" : "#ff8a7a";
    }
  } else if (R.perf && R.perf.style.display !== "none") R.perf.style.display = "none";
  // when the local player is dead we SPECTATE — source the HUD from the spectated
  // actor (W._camFocus, set by updateCamera each frame) instead of the corpse,
  // which read HP 0% / shield 0% / empty inventory for the whole spectate phase.
  const p = W._camFocus || W.player;
  const C = R._hudCache;

  const hpPct = Math.max(0, Math.min(100, p.hp)) + "%";
  if (C.hp !== hpPct) {
    R.hpBar.style.width = hpPct; R.hpPct.textContent = Math.ceil(Math.max(0, Math.min(100, p.hp))) + "%";
    // The colour was baked in at creation, so the bar was the same green at 6 HP
    // as at 100 and "am I one shot from dead" was a two-digit number you had to
    // read in the bottom-left corner mid-fight. Free: this branch only runs when
    // the percentage actually changes, and lcPulse is already in ensureAAAStyles.
    R.hpBar.style.background = p.hp <= 25 ? "#ff5544" : p.hp <= 40 ? "#ffd166" : "#4ade80";
    R.hpBar.style.animation = p.hp <= 25 ? "lcPulse .55s ease-in-out infinite" : "";
    C.hp = hpPct;
  }
  const shPct = Math.max(0, Math.min(100, p.shield)) + "%";
  if (C.sh !== shPct) { R.shieldBar.style.width = shPct; R.shieldPct.textContent = Math.ceil(Math.max(0, Math.min(100, p.shield))) + "%"; C.sh = shPct; }

  // heal channel
  if (p.healing) {
    R.healBar.style.display = "block";
    const c = K.CONSUMABLES[p.healing.id];
    R.healFill.style.width = (100 * (1 - p.healing.tLeft / c.useS)) + "%";
  } else R.healBar.style.display = "none";

  // sprint pip: show while the toggle is latched. Dim when latched but not
  // actually sprinting (ADS, mid-air, walking backwards) so the pip never lies
  // about the speed you are really moving at.
  if (R.sprintPip) {
    const latched = !!(W.settings && W.settings.sprintToggle) && !!W._sprintLatch && p === W.player && !p.dead;
    const live = latched && !!p.sprinting;
    const sig = latched ? (live ? 2 : 1) : 0;
    if (C.sprint !== sig) {
      R.sprintPip.style.opacity = sig === 2 ? "0.95" : sig === 1 ? "0.4" : "0";
      R.sprintPip.style.color = sig === 2 ? "#8ef5c8" : "#cfe4da";
      C.sprint = sig;
    }
  }

  // reload progress
  if (R.reloadBar) {
    const rw = p.weapon, rdef = rw && K.WEAPONS[rw.id];
    if (rw && rw.state === "reloading" && rdef && rdef.reloadS > 0) {
      R.reloadBar.style.display = "block";
      R.reloadFill.style.width = (100 * (1 - Math.max(0, rw.reloadT) / rdef.reloadS)) + "%";
    } else R.reloadBar.style.display = "none";
  }

  // ammo + slots
  const wpn = p.weapon;
  let ammoT = "";
  if (wpn && !wpn.id.startsWith("consumable")) {
    const def = K.WEAPONS[wpn.id];
    if (def) ammoT = wpn.state === "reloading" ? "RELOADING…" : wpn.magAmmo + " / " + ((p.inventory && p.inventory.ammo[def.ammo]) || 0);
  }
  if (p.swimming) ammoT = "SWIMMING";
  if (C.ammo !== ammoT) { R.ammoText.textContent = ammoT; C.ammo = ammoT; }

  if (p.inventory) {   // spectated remote actors can have a partial inventory
    const ammoSig = Object.values(p.inventory.ammo).join(",");
    const slotSig = p.inventory.slots.map((s, i) => (s ? s.id + (s.count || "") + (s.rarity || 0) : "-") + (i === p.inventory.active ? "*" : "")).join("|") + "#" + ammoSig;
    if (C.slots !== slotSig) { paintSlots(W, p); C.slots = slotSig; }
  }

  // storm timer + alive
  srT += dt;
  if (srT > 0.25) {
    srT = 0;
    if (W.stormCtl) {
      const st = W.stormCtl.storm.stateAt(W.t);
      let txt;
      if (W.mode === "practice") txt = "∞";
      else if (st.done) txt = "CLOSED";
      else txt = (st.phaseState === "waiting" ? "shrinks " : "closing ") + fmtT(st.tToNext);
      R.stormTimer.textContent = txt;
      R.stormIcon.style.color = st.closing ? "#d9b3ff" : "#9fb6cc";
    }
    R.aliveText.textContent = "👥 " + (W.match ? W.match.aliveCount() : "—");
    R.killsText.textContent = "☠ " + (W.match ? (W.match.kills[p.id] || 0) : 0);
    if (R.specBar) {
      const me = W.player;
      if (me && !me.alive && W._camFocus && W._camFocus !== me) {
        const n = W.match ? W.match.aliveCount() : 0;
        R.specBar.style.display = "block";
        R.specBar.textContent = "SPECTATING  " + W._camFocus.name.toUpperCase() + "   ·   " + n + " ALIVE   ·   [A] / [D] TO SWITCH";
      } else R.specBar.style.display = "none";
    }
    if (R.rangePanel) {
      const s = W.stats, ds = W.rangeDummies || [];
      let dmg = 0, pops = 0, hs = 0;
      for (const d of ds) { dmg += d.dummyDamage || 0; pops += d.dummyPops || 0; hs += d.dummyHeadshots || 0; }
      const acc = s.shotsFired ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0;
      R.rangePanel.textContent = "RANGE  ·  SHOTS " + s.shotsFired + "  ·  HITS " + s.shotsHit +
        "  ·  ACC " + acc + "%  ·  HEADSHOTS " + hs + "  ·  DMG " + Math.round(dmg) + "  ·  DOWNS " + pops;
    }
    // alive-count milestones — the match had no rising arc, just a flat counter
    if (W.match && W.phase === "match" && W.mode !== "practice") {
      const al = W.match.aliveCount();
      let tier = 0;
      for (const m of [2, 5, 10, 25]) { if (al <= m) { tier = m; break; } }   // tightest first
      if (tier && (!R._aliveMark || tier < R._aliveMark)) {
        R._aliveMark = tier;
        if (tier === 2) announce("FINAL 2", "ONE KILL FROM THE WIN", "#ffd54a", 2800, ANN_PRIO.milestone);
        else announce(al + " REMAIN", tier === 25 ? "THE CIRCLE TIGHTENS" : tier === 10 ? "TOP 10 — STAY SHARP" : "FINAL 5", "#ffd54a", 2400, ANN_PRIO.milestone);
      }
    }
    // hurt tint: CLEAR only. It is set instantly by the actorHurt handler now —
    // driving the "1" from this 4Hz block cost up to 250ms of tick latency on
    // top of the element's own 300ms fade, so the screen took ~550ms to tell you
    // you were being shot, out of a 700ms window.
    if (W.t - p.lastDamageT >= 0.7) { R.hurtTint.style.transition = "opacity .3s"; R.hurtTint.style.opacity = "0"; }

    // XP/level bar (re-rendered when XP changes)
    const pr = W.progress;
    if (pr && R.xpFill && W._xpDirty) {
      const need = xpForLevel(pr.level);
      R.xpLevel.textContent = "LVL " + pr.level;
      R.xpFill.style.width = Math.min(100, 100 * pr.xp / need) + "%";
      R.xpText.textContent = pr.xp + " / " + need + " XP";
      W._xpDirty = false;
    }
    // active challenge card — advance past completed ones, award XP once
    const chs = W._challenges;
    if (chs && R.chalCard) {
      // Evaluate ALL of them, independently. This used to poll only
      // chs[W._chalIdx] and advance that pointer solely when the CURRENT
      // challenge completed — and slot 0 is always "Survive 3 minutes", so a
      // player who died at 2:30 with four kills and 600 damage banked nothing
      // from the other two. The card still shows one at a time.
      // Guarded on being ALIVE: dying does not end the match and W.t keeps
      // running, so a corpse in the spectator seat could otherwise bank
      // "Survive 3 minutes" and "Reach the final 10" without playing.
      if (W.match && W.player && W.player.alive) {
        for (const c of chs) {
          if (c.awarded) continue;
          if (c.prog(W) >= c.goal) {
            c.awarded = true; c.done = true;
            addXP(W, c.xp);
            W._chalXp = (W._chalXp || 0) + c.xp;   // banked here; the post-match screen only knew about `res`
            flashMsg("CHALLENGE COMPLETE  +" + c.xp + " XP");
          }
        }
      }
      const ch = chs.find((c) => !c.done) || null;
      if (ch && W.match) {
        const cur = Math.min(ch.goal, ch.prog(W));
        R.chalCard.style.display = "flex";
        const sig = ch.id + ":" + cur;
        if (C.chal !== sig) {
          R.chalIcon.textContent = ch.id.indexOf("elim") === 0 ? "💀" : ch.id === "survive" ? "⏱" : ch.id === "dmg" ? "🔥" : "🏆";
          R.chalLabel.textContent = ch.label;
          R.chalFill.style.width = (100 * cur / ch.goal) + "%";
          R.chalProg.textContent = cur + "/" + ch.goal;
          R.chalXp.textContent = "+" + ch.xp + " XP";
          C.chal = sig;
        }
      } else { R.chalCard.style.display = "none"; }
    }
  }

  // Compass EVERY frame; minimap at 10Hz. These used to share one gate, but the
  // ribbon's whole content is the camera's heading — a per-frame quantity that
  // changes with every mouse move — so sampling it at 10Hz made it judder while
  // you turned. It is a 320x18 canvas with a handful of strokes, next to nothing
  // beside the 180x180 minimap's drawImage of a 512x512 source.
  if (R.compass) drawCompass(W, R.compass.getContext("2d"), 320);
  mmT += dt;
  if (mmT > 0.1) { mmT = 0; drawMinimap(W, R.mmCanvas.getContext("2d"), 180, false); }

  // interact hint + chest channel ring
  const hint = W.interactHint;
  if (hint) {
    R.interact.style.display = "block";
    R.interact.textContent = hint.type === "chest"
      ? (hint.progress > 0 ? "Opening…" : "[HOLD E] Open chest")
      : interactLabel(W, hint.data);
  } else R.interact.style.display = "none";
  if (hint && hint.type === "chest" && hint.progress > 0) {
    R.chestRing.style.display = "block";
    const deg = Math.min(360, Math.round(hint.progress * 360));
    R.chestRing.style.background = `conic-gradient(#ffd254 ${deg}deg, rgba(255,255,255,0.15) ${deg}deg)`;
  } else R.chestRing.style.display = "none";

  // parachute button state during the drop
  if (p.gliding) {
    R.chuteBtn.style.display = "flex";
    const open = !!p.chute;
    R.chuteLabel.textContent = (open ? "CUT" : "OPEN") + " [SPACE]";
    R.chuteBtn.style.borderColor = open ? "rgba(255,190,90,0.8)" : "rgba(140,190,255,0.8)";
  } else if (R.chuteBtn.style.display !== "none") R.chuteBtn.style.display = "none";

  // directional indicators: fade + footstep scan
  stepIndicators(W, dt);

  // crosshair: per-weapon reticle, hidden behind the sniper scope, blooms while
  // moving. Without pointer lock it RIDES THE CURSOR (the reticle IS the mouse
  // — the OS arrow is hidden over the canvas during play).
  const wid = p.weapon ? p.weapon.id : null;
  if (R._crossFor !== wid) paintCrosshair(W, wid);
  R.cross.style.display = (p.input.ads && wid && K.WEAPONS[wid] && K.WEAPONS[wid].scope) ? "none" : "block";
  const locked = W.pointerLocked && W.pointerLocked();
  const dom = W.kernel.renderer.domElement;
  const wantCursor = p.alive && !W.paused ? "none" : "";
  if (dom.style.cursor !== wantCursor) dom.style.cursor = wantCursor;
  if (!locked && W.mousePx) {
    if (R.cross.style.left !== "0px") { R.cross.style.left = "0px"; R.cross.style.top = "0px"; }
    R.cross.style.transform = `translate(${W.mousePx.x - 28}px, ${W.mousePx.y - 28}px) scale(${C.bloom || 1})`;
    R._crossAtCursor = true;
  } else if (R._crossAtCursor) {
    R._crossAtCursor = false;
    R.cross.style.left = "50%"; R.cross.style.top = "50%";
    R.cross.style.transform = `translate(-50%,-50%) scale(${C.bloom || 1})`;
  }
  // Reticle size from the ACTUAL spread the next shot will use, not a guess.
  const spreadNow = (p.weapon && K.WEAPONS[p.weapon.id])
    ? K.effectiveSpread(p.weapon.id, p.weapon.rarity, {
        ads: !!p.input.ads,
        speed: Math.hypot(p.vel.x, p.vel.z),
        airborne: !p.onGround,
        crouching: !!p.crouching,
        sinceLastShotS: W.t - (p.lastShotT == null ? -9 : p.lastShotT),   // 0 is a REAL time, not 'missing'
      })
    : 1;
  const bloom = Math.max(0.4, Math.min(3.2, 0.35 + spreadNow * 0.55));
  if (C.bloom !== bloom) {
    C.bloom = bloom;
    if (!R._crossAtCursor) R.cross.style.transform = `translate(-50%,-50%) scale(${bloom})`;
  }
}

// ═══ directional indicators ══════════════════════════════════════════════════
// Screen-edge cues (industry standard): white footsteps for nearby movement,
// white/gold chevrons for gunfire direction (≤250m), red arcs for damage taken.
const inds = [];      // {el, ang, t, life}
const stepMarks = new Map(); // actorId -> last footstep indicator time
function addIndicator(W, worldX, worldZ, kind) {
  if (!R.indicators || !W.player) return;
  const p = W.player;
  const ang = Math.atan2(worldX - p.pos.x, worldZ - p.pos.z);   // world bearing
  const el = h("div", { position: "absolute", left: "50%", top: "50%", willChange: "transform, opacity", fontSize: kind === "damage" ? "34px" : "20px", fontWeight: "900", textShadow: "0 1px 4px #000" }, null, R.indicators);
  if (kind === "footstep") { el.textContent = "👣"; el.style.filter = "grayscale(1) brightness(2)"; el.style.fontSize = "17px"; }
  else if (kind === "shot") { el.textContent = "︿"; el.style.color = "#ffe9a0"; }
  else { el.textContent = "❮❯"; el.style.color = "#ff5544"; el.style.letterSpacing = "-4px"; }
  inds.push({ el, ang, t: 0, life: kind === "damage" ? 1.6 : kind === "shot" ? 1.2 : 0.9 });
  if (inds.length > 14) { const d = inds.shift(); d.el.remove(); }
}
function stepIndicators(W, dt) {
  if (!R.indicators) return;
  const p = W.player;
  if (!p) return;
  // footstep scan at 3Hz: moving actors within 30m (visualized sound)
  stepIndicators._acc = (stepIndicators._acc || 0) + dt;
  if (stepIndicators._acc > 0.33) {
    stepIndicators._acc = 0;
    for (const a of W.actors) {
      if (a === p || !a.alive) continue;
      const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
      if (d > 30) continue;
      if (Math.hypot(a.vel.x, a.vel.z) < 2) continue;
      const last = stepMarks.get(a.id) || -9;
      if (W.t - last < 1.4) continue;
      stepMarks.set(a.id, W.t);
      addIndicator(W, a.pos.x, a.pos.z, "footstep");
    }
  }
  // position + fade all live indicators around a screen-centered ring
  const wpx = W.kernel.renderer.domElement.clientWidth, hpx = W.kernel.renderer.domElement.clientHeight;
  const RAD = Math.min(wpx, hpx) * 0.36;
  for (let i = inds.length - 1; i >= 0; i--) {
    const d = inds[i];
    d.t += dt;
    if (d.t > d.life) { d.el.remove(); inds.splice(i, 1); continue; }
    // screen angle relative to the camera facing (0 = up/forward)
    const rel = d.ang - p.yaw + Math.PI;
    const sx = Math.sin(rel) * RAD, sy = -Math.cos(rel) * RAD;
    d.el.style.transform = `translate(calc(${sx.toFixed(0)}px - 50%), calc(${sy.toFixed(0)}px - 50%)) rotate(${(rel * 180 / Math.PI).toFixed(0)}deg)`;
    d.el.style.opacity = String(Math.max(0, 1 - d.t / d.life));
  }
}

// ── slot icons: weapons are RENDERED 3D thumbnails of the actual view models;
// consumables use big legible glyphs ─────────────────────────────────────────
let iconR = null, iconScene = null, iconCam = null;
const iconCache = {};
function ensureIconRig() {
  if (iconR) return;
  iconR = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  iconR.setSize(96, 72);
  iconScene = new THREE.Scene();
  iconScene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 1.8);
  d.position.set(2, 3, 4);
  iconScene.add(d);
  iconCam = new THREE.PerspectiveCamera(28, 96 / 72, 0.01, 20);
}
function renderThumb(proto, cacheKey, tilt) {
  if (!proto) return null;
  if (iconCache[cacheKey]) return iconCache[cacheKey];
  ensureIconRig();
  const m = proto.clone();
  iconScene.add(m);
  const bbox = new THREE.Box3().setFromObject(m);
  const c = bbox.getCenter(new THREE.Vector3());
  const span = bbox.getSize(new THREE.Vector3()).length();
  m.position.sub(c);
  m.rotation.set(tilt != null ? tilt : 0.2, -Math.PI / 2 + 0.45, 0);   // 3/4 profile
  iconCam.position.set(0, span * 0.12, span * 1.35);
  iconCam.lookAt(0, 0, 0);
  iconR.render(iconScene, iconCam);
  const url = iconR.domElement.toDataURL();
  iconScene.remove(m);
  iconCache[cacheKey] = url;
  return url;
}
function weaponIcon(W, id) {
  if (iconCache[id]) return Promise.resolve(iconCache[id]);
  if (!W.weaponProto) return Promise.resolve(null);
  return W.weaponProto(id).then((proto) => renderThumb(proto, id)).catch(() => null);
}
function itemIcon(W, id) {
  const key = "item:" + id;
  if (iconCache[key]) return Promise.resolve(iconCache[key]);
  if (!W.itemProto) return Promise.resolve(null);
  return W.itemProto(id).then((proto) => renderThumb(proto, key, 0.35)).catch(() => null);
}
const CONSUMABLE_ICONS = { bandage: "🩹", medkit: "⛑️", mini_shield: "🧪", big_shield: "🛡️" };

// ── per-weapon crosshairs ────────────────────────────────────────────────────
// Each weapon class gets its own reticle shape sized to its real spread/range:
//   pistol/smg = tight 4-line cross · AR = wider cross + dot ·
//   shotgun = pellet-spread ring · sniper = fine dot (scope on ADS) ·
//   grenade launcher = chevron arc pip · consumables = open hands (dot)
function paintCrosshair(W, weaponId) {
  if (!R.cross) return;
  clear(R.cross);
  const CENTER = 28;
  const mk = (styles) => h("div", Object.assign({ position: "absolute", background: "rgba(255,255,255,0.95)", boxShadow: "0 0 2px rgba(0,0,0,0.9)" }, styles), null, R.cross);
  const dot = (r) => mk({ left: (CENTER - r) + "px", top: (CENTER - r) + "px", width: r * 2 + "px", height: r * 2 + "px", borderRadius: "50%" });
  const line = (x, y, w, hh) => mk({ left: (CENTER + x) + "px", top: (CENTER + y) + "px", width: w + "px", height: hh + "px", borderRadius: "1px" });
  const cross4 = (gap, len, th) => {
    line(-th / 2, -gap - len, th, len);   // up
    line(-th / 2, gap, th, len);          // down
    line(-gap - len, -th / 2, len, th);   // left
    line(gap, -th / 2, len, th);          // right
  };
  const def = K.WEAPONS[weaponId];
  const cls = def ? def.cls : null;
  if (cls === "pistol" || cls === "smg") { cross4(5, 8, 2); dot(1.5); }
  else if (cls === "ar") { cross4(8, 11, 2); dot(1.5); }
  else if (cls === "shotgun") {
    // ring ≈ the real pellet cone at mid-range
    h("div", { position: "absolute", left: (CENTER - 16) + "px", top: (CENTER - 16) + "px", width: "32px", height: "32px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.9)", boxShadow: "0 0 2px rgba(0,0,0,0.9), inset 0 0 2px rgba(0,0,0,0.9)" }, null, R.cross);
    dot(1.5);
  }
  else if (cls === "sniper") { dot(2); line(-1, 10, 2, 8); }  // fine dot + drop hint (scope overlay on ADS)
  else if (cls === "launcher") {
    dot(2);
    // arc chevron hinting the lobbed trajectory
    const ch = h("div", { position: "absolute", left: (CENTER - 7) + "px", top: (CENTER + 8) + "px", width: "14px", height: "14px", border: "2px solid rgba(255,200,120,0.95)", borderTop: "none", borderLeft: "none", transform: "rotate(45deg)", boxShadow: "0 0 2px rgba(0,0,0,0.8)" }, null, R.cross);
  }
  else { dot(2); } // consumable / fallback
  R._crossFor = weaponId;
}

function paintSlots(W, p) {
  clear(R.slotsRow);
  p.inventory.slots.forEach((s, i) => {
    const active = i === p.inventory.active;
    const cell = h("div", {
      width: "56px", height: "46px", borderRadius: "8px", position: "relative",
      background: active ? "rgba(87,176,255,0.25)" : "rgba(0,0,0,0.45)",
      border: active ? "2px solid #57b0ff" : "1px solid rgba(255,255,255,0.18)",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800",
      overflow: "hidden",
    }, null, R.slotsRow);
    if (s) {
      const rc = s.kind === "weapon" ? (K.RARITY_COLOR[K.RARITY[s.rarity || 0]] || "#9da5b4") : "#8fd3a0";
      h("div", { position: "absolute", left: "0", right: "0", bottom: "0", height: "3px", background: rc }, null, cell);
      // Rarity was communicated by HUE ALONE. Add the tier as a numeral so it
      // survives any colour-vision deficiency (and reads faster for everyone).
      if (s.kind === "weapon") {
        h("div", {
          position: "absolute", left: "3px", top: "2px", fontSize: "9px", fontWeight: "900",
          color: rc, textShadow: "0 1px 2px #000", letterSpacing: "0.5px",
        }, ["I", "II", "III", "IV", "V"][s.rarity || 0], cell);
      }
      if (s.kind === "weapon") {
        const img = h("img", { width: "52px", height: "38px", objectFit: "contain", display: "none" }, null, cell);
        const txt = h("div", {}, shortName(s), cell);
        weaponIcon(W, s.id).then((url) => {
          if (url && img.isConnected) { img.src = url; img.style.display = "block"; txt.remove(); }
        });
        // reserve ammo on the slot (Final Drop style)
        const def = K.WEAPONS[s.id];
        if (def && def.ammo) h("div", { position: "absolute", right: "3px", bottom: "5px", fontSize: "10px", fontWeight: "900", textShadow: "0 1px 2px #000" }, String(p.inventory.ammo[def.ammo] || 0), cell);
      } else {
        const img = h("img", { width: "40px", height: "36px", objectFit: "contain", display: "none" }, null, cell);
        const glyph = h("div", { fontSize: "22px", lineHeight: "1" }, CONSUMABLE_ICONS[s.id] || "▣", cell);
        itemIcon(W, s.id).then((url) => {
          if (url && img.isConnected) { img.src = url; img.style.display = "block"; glyph.remove(); }
        });
      }
      if (s.count) h("div", { position: "absolute", right: "3px", top: "1px", fontSize: "10px", opacity: "0.95", textShadow: "0 1px 2px #000" }, String(s.count), cell);
    }
    h("div", { position: "absolute", left: "3px", top: "1px", fontSize: "9px", opacity: "0.6" }, String(i + 1), cell);
  });
}
function shortName(s) {
  const M = { pistol: "PSTL", smg: "SMG", ar: "AR", shotgun: "SHTG", sniper: "SNPR", glauncher: "GL", bandage: "BAND", medkit: "MED", mini_shield: "MINI", big_shield: "SHLD" };
  return M[s.id] || s.id.slice(0, 4).toUpperCase();
}
function labelFor(d) {
  if (!d) return "Pick up";
  if (d.kind === "weapon") return "Pick up " + shortName(d) + (d.id !== "grenade" ? " (" + K.RARITY[d.rarity || 0] + ")" : "");
  return "Pick up " + shortName(d);
}
/** Guns any actor may CARRY — mirrors GUN_CAP in loot.js, which is module-private
 *  there. Only the wording of this prompt depends on it, so a drift costs a
 *  slightly-off label, never wrong behaviour. */
const HUD_GUN_CAP = 3;
/** The prompt has to name the OUTCOME. E is unconditionally a swap
 *  (loot.js: pickup(..., { swap: true })), and give()'s swap branch DROPS
 *  whatever is in your active slot — but the hint always read "Pick up", so at
 *  five full slots the button that looked like a pickup threw your legendary AR
 *  on the ground for a common pistol you meant to walk past. */
function interactLabel(W, data) {
  const me = W.player, inv = me && me.inventory;
  if (!data || !inv || !W.wouldAcceptItem || W.wouldAcceptItem(me, data)) return "[E] " + labelFor(data);
  const what = labelFor(data).replace("Pick up ", "");
  // Three cases where the swap itself is refused by give() and E does nothing:
  // ammo has no swap branch at all, a same-kind consumable stack already at max
  // returns before it reads data.swap, and a weapon swap off a NON-gun slot is
  // refused at the carry cap because it would push you past it.
  const out = inv.slots[inv.active];
  const guns = inv.slots.filter((s) => s && s.kind === "weapon").length;
  const blocked = data.kind === "ammo"
    || (data.kind === "consumable" && inv.slots.some((s) => s && s.kind === "consumable" && s.id === data.id))
    || (data.kind === "weapon" && (!out || out.kind !== "weapon") && guns >= HUD_GUN_CAP);
  if (blocked) return "FULL — no room for " + what;
  return "[E] Swap for " + what + (out ? " — drops " + shortName(out) : "");
}
function fmtT(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// ═══ minimap ═════════════════════════════════════════════════════════════════
function drawMinimap(W, ctx, size, big) {
  if (!W.map) return;
  // Backing store is size*dpr; draw in logical px. The 3D renderer has honoured
  // devicePixelRatio all along and the locker preview supersamples 2x, so on a
  // HiDPI panel the 2D HUD was the softest thing on screen — worst on the 13px
  // POI labels below, which is the map's whole point.
  const dpr = ctx.canvas.width / size || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(W.map.minimap, 0, 0, size, size);
  const S = W.map.size;
  const toPx = (x) => (x / S + 0.5) * size;
  // storm circles
  if (W.stormCtl && W.mode !== "practice") {
    const st = W.stormCtl.storm.stateAt(W.t);
    ctx.strokeStyle = "rgba(190,120,255,0.95)";
    ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath(); ctx.arc(toPx(st.center.x), toPx(st.center.z), (st.radius / S) * size, 0, Math.PI * 2); ctx.stroke();
    if (st.nextRadius != null && st.nextRadius > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(toPx(st.nextCenter.x), toPx(st.nextCenter.z), (st.nextRadius / S) * size, 0, Math.PI * 2); ctx.stroke();
    }
    // dark outside veil
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(toPx(st.center.x), toPx(st.center.z), (st.radius / S) * size, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(90,30,140,0.28)";
    ctx.fill();
    ctx.restore();
  }
  // supply drop: hollow ring while it falls, filled diamond once it is down
  if (W._supplyMark) {
    const sx = toPx(W._supplyMark.x), sz = toPx(W._supplyMark.z), r = big ? 9 : 6;
    const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 260);
    ctx.strokeStyle = "rgba(255,209,102," + pulse.toFixed(2) + ")";
    ctx.lineWidth = big ? 2.6 : 1.8;
    ctx.beginPath(); ctx.arc(sx, sz, r, 0, Math.PI * 2); ctx.stroke();
    if (W._supplyMark.landed) {
      ctx.fillStyle = "rgba(255,209,102,0.9)";
      ctx.beginPath();
      ctx.moveTo(sx, sz - r * 0.6); ctx.lineTo(sx + r * 0.6, sz);
      ctx.lineTo(sx, sz + r * 0.6); ctx.lineTo(sx - r * 0.6, sz);
      ctx.closePath(); ctx.fill();
    }
  }
  // your chosen landing zone, while you are still falling toward it
  if (W.dropTarget && W.phase === "drop") {
    const dx = toPx(W.dropTarget.x), dz = toPx(W.dropTarget.z), s = big ? 13 : 8;
    ctx.strokeStyle = "#6ec4ff"; ctx.lineWidth = big ? 2.2 : 1.5;
    ctx.beginPath(); ctx.arc(dx, dz, big ? 9 : 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dx - s, dz); ctx.lineTo(dx + s, dz);
    ctx.moveTo(dx, dz - s); ctx.lineTo(dx, dz + s); ctx.stroke();
  }
  // POI names on big map
  if (big) {
    ctx.font = "700 13px system-ui";
    ctx.textAlign = "center";
    for (const p of W.map.pois) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillText(p.name, toPx(p.x) + 1, toPx(p.z) + 1);
      ctx.fillStyle = "#fff";
      ctx.fillText(p.name, toPx(p.x), toPx(p.z));
    }
  }
  // player arrow
  const p = W.player;
  if (p) {
    const px = toPx(p.pos.x), pz = toPx(p.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
}

// ═══ events, pause, death, stats, settings ══════════════════════════════════
function wireEvents(W) {
  W.events.on("hitMarker", (owner, target, dmg, isHead) => {
    if (owner !== W.player || !R.hitmark) return;
    // A shotgun blast fires this once per pellet in one frame; a body pellet
    // landing after a head pellet used to overwrite the marker back to plain
    // white, so headshots inside a blast were invisible.
    const nowMs = performance.now();
    if (!isHead && nowMs < (R._hitHeadUntil || 0)) return;
    if (isHead) R._hitHeadUntil = nowMs + 170;
    // headshots get a bigger yellow marker (audio.js adds a higher-pitched ping)
    R.hitmark.style.color = isHead ? "#ffd54a" : "#ffffff";
    R.hitmark.style.fontSize = isHead ? "34px" : "26px";
    R.hitmark.style.opacity = "1";
    setTimeout(() => { if (R.hitmark) R.hitmark.style.opacity = "0"; }, isHead ? 170 : 120);
  });
  // gunfire direction (industry-standard ~250m audible range)
  W.events.on("shotFired", (shooter, weaponId, eye) => {
    if (!W.player || shooter === W.player || !W.player.alive) return;
    const d = Math.hypot(eye.x - W.player.pos.x, eye.z - W.player.pos.z);
    if (d < 12 || d > 250) return;   // too close = obvious; too far = inaudible
    addIndicator(W, eye.x, eye.z, "shot");
  });
  // damage direction (red arc toward the attacker)
  W.events.on("actorHurt", (victim, info) => {
    // Flash the vignette HERE, before the attackerId guard, so a storm tick
    // registers too. The per-frame HUD block only clears it now.
    if (victim === W.player && R.hurtTint) {
      R.hurtTint.style.transition = "opacity .07s ease-out";
      R.hurtTint.style.opacity = "1";
    }
    if (victim !== W.player || !info.attackerId) return;
    const att = W.actorById.get(info.attackerId);
    if (att) addIndicator(W, att.pos.x, att.pos.z, "damage");
  });
  W.events.on("actorDied", (victim, killerId, weaponId) => {
    if (!R.feed) return;
    const killer = killerId ? W.actorById.get(killerId) : null;
    const el = h("div", { background: "rgba(0,0,0,0.5)", padding: "3px 10px", borderRadius: "6px" },
      (killer ? killer.name + " ⚔ " : "⛈ ") + victim.name + (weaponId ? "  ·  " + K.weaponName(weaponId) : ""), R.feed);
    if (victim === W.player || killer === W.player) el.style.color = "#ffd54a";
    setTimeout(() => el.remove(), 6000);
    while (R.feed.children.length > 6) R.feed.firstChild.remove();
    // YOUR elimination gets a banner + streak escalation (kills used to land silently)
    if (killer === W.player && victim !== W.player) {
      const n = (W.match && W.match.kills[W.player.id]) || 0;
      const streak = n >= 5 ? "RAMPAGE" : n === 4 ? "QUAD KILL" : n === 3 ? "TRIPLE KILL" : n === 2 ? "DOUBLE KILL" : null;
      announce("ELIMINATED " + victim.name.toUpperCase(), streak ? streak + " · " + n + " KILLS" : n + (n === 1 ? " KILL" : " KILLS"), "#ff8f6a", 1900, ANN_PRIO.elim);
    }
  });
  // LEVEL UP — this event was emitted every level and had ZERO listeners, so the
  // bar filled, the level ticked over, and the player was never told.
  W.events.on("levelUp", (lvl) => {
    const won = MENU_SKINS.some((s) => s.unlockLevel === lvl);
    announce("LEVEL " + lvl, levelUpSub(lvl, W.progress && W.progress.career), "#ffd54a", won ? 3600 : 3000, ANN_PRIO.level);
  });
  // Picking something up was silent apart from a blip — you could not tell a
  // legendary from a common without opening the inventory.
  W.events.on("pickedUp", (a, data) => {
    if (a !== W.player || !data) return;
    const RAR = K.RARITY || [];
    if (data.kind === "weapon") {
      const rar = RAR[data.rarity || 0] || "";
      flashMsg("PICKED UP  " + rar.toUpperCase() + " " + String(data.id).toUpperCase());
    } else if (data.kind === "consumable") {
      flashMsg("PICKED UP  " + String(data.id).replace(/_/g, " ").toUpperCase() + (data.count > 1 ? " x" + data.count : ""));
    } else if (data.kind === "ammo") {
      flashMsg("PICKED UP  " + String(data.id).toUpperCase() + " AMMO");
    }
  });
  W.events.on("stormWarning", () => flashMsg("STORM SHRINKS IN 10 SECONDS"));
  W.events.on("stormClosing", () => flashMsg("THE STORM IS CLOSING"));
  W.events.on("playerStormState", (inStorm) => { if (R.stormTint) R.stormTint.style.opacity = inStorm ? "1" : "0"; });
  W.events.on("scopeState", (on) => { if (R.scope) R.scope.style.display = on ? "block" : "none"; });
  W.events.on("toggleBigMap", () => toggleBigMap(W));
  W.events.on("escPressed", () => {
    if (R.settings) { closeSettings(W); return; }   // close the topmost modal first
    if (R.bigmap) { toggleBigMap(W); return; }
    if (W.phase === "match" || W.phase === "drop") togglePause(W);
  });
  W.events.on("playerDied", (killerId, weaponId) => showDeath(W, killerId, weaponId));
  // Supply drops are the ONLY source of legendary loot and had no marker, no
  // beacon and no landed cue — a message flashed once and then the single most
  // valuable event in the match was invisible. Track it and draw it.
  W.events.on("supplyDropSpawned", (p2) => {
    W._supplyMark = { x: p2.x, z: p2.z, landed: false, t: 0 };
    flashMsg("SUPPLY DROP INBOUND");
    announce("SUPPLY DROP", "LEGENDARY LOOT INBOUND — CHECK YOUR MAP", "#ffd166", 2400, ANN_PRIO.milestone);
  });
  W.events.on("supplyDropLanded", (p2) => {
    if (W._supplyMark) { W._supplyMark.x = p2.x; W._supplyMark.z = p2.z; W._supplyMark.landed = true; }
    else W._supplyMark = { x: p2.x, z: p2.z, landed: true, t: 0 };
    flashMsg("SUPPLY DROP HAS LANDED");
  });
}

function flashMsg(text) {
  if (!R.stormMsg) return;
  R.stormMsg.textContent = text;
  R.stormMsg.style.opacity = "1";
  setTimeout(() => { if (R.stormMsg) R.stormMsg.style.opacity = "0"; }, 2600);
}
// big centre-screen announcement (deploy / milestones / eliminations / level-up).
// Higher-priority calls override a showing one so the important beat always wins.
// PRIO: victory 3 > elimination / level-up 2 > milestone / deploy 1.
// This was last-write-wins over one node and one timer (R._annUntil was assigned
// and never read). Because match.eliminate() drops the alive count BEFORE the
// actorDied emit, and weapons.update runs before hud.update in the same frame,
// the "ELIMINATED X" banner for the kill that took the lobby to 10 was
// overwritten by "10 REMAIN" before the browser ever painted it — the kill you
// just made was the one beat you never saw.
// Equal-or-lower priority QUEUES rather than dropping: the alive milestone marks
// itself spent (R._aliveMark) before it announces, so a dropped "FINAL 2" is
// gone for the rest of the match.
const ANN_PRIO = { victory: 3, elim: 2, level: 2, milestone: 1, deploy: 1 };
function announce(text, sub, color, ms, prio) {
  if (!R.annWrap) return;
  const p = prio || 0;
  const now = performance.now();
  if (now < (R._annUntil || 0)) {
    if (p > (R._annPrio || 0)) { showAnnouncement(text, sub, color, ms, p, now); return; }
    (R._annQ = R._annQ || []).push({ text, sub, color, ms, prio: p });
    if (R._annQ.length > 6) R._annQ.length = 6;   // a 50-kill spree must not queue forever
    return;
  }
  showAnnouncement(text, sub, color, ms, p, now);
}
function showAnnouncement(text, sub, color, ms, p, now) {
  const dur = ms || 2200;
  R.annTitle.textContent = text;
  R.annTitle.style.color = color || "#eaf2ff";
  R.annSub.textContent = sub || "";
  R.annWrap.style.opacity = "1";
  R.annWrap.style.transform = "translateX(-50%) translateY(0)";
  R._annPrio = p;
  R._annUntil = now + dur;
  clearTimeout(R._annT);
  R._annT = setTimeout(() => {
    if (!R.annWrap) return;
    R.annWrap.style.opacity = "0";
    R.annWrap.style.transform = "translateX(-50%) translateY(-12px)";
    R._annPrio = 0; R._annUntil = 0;
    const q = R._annQ && R._annQ.shift();
    if (q) setTimeout(() => announce(q.text, q.sub, q.color, q.ms, q.prio), 200);
  }, dur);
}

function toggleBigMap(W) {
  if (R.bigmap) { R.bigmap.remove(); R.bigmap = null; return; }
  const L = layer("bigmap", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center" });
  const size = Math.min(window.innerHeight - 100, 640);
  const cv = h("canvas", { borderRadius: "14px", border: "2px solid rgba(120,180,255,0.35)", width: size + "px", height: size + "px" }, null, L);
  cv.width = cv.height = Math.round(size * HUD_DPR);
  drawMinimap(W, cv.getContext("2d"), size, true);
  // This overlay is a 90%-opaque full-screen fill over the whole HUD layer, so
  // opening it hid the storm countdown, the alive count and your own HP — the
  // three numbers that make the rings drawn below actionable. The sim does not
  // pause, so you had to close the map, read the clock and reopen it.
  const head = h("div", {
    position: "absolute", top: "18px", left: "50%", transform: "translateX(-50%)",
    padding: "8px 22px", borderRadius: "10px", whiteSpace: "nowrap",
    background: "rgba(4,10,20,0.6)", border: "1px solid rgba(140,200,255,0.25)",
    fontFamily: "Rajdhani, " + FONT, fontSize: "15px", fontWeight: "700", letterSpacing: "1.5px",
  }, "", L);
  const paintHead = () => {
    const bits = [];
    if (W.stormCtl && W.mode !== "practice") {
      const st = W.stormCtl.storm.stateAt(W.t);
      bits.push("⛈ " + (st.done ? "CLOSED" : (st.phaseState === "waiting" ? "SHRINKS " : "CLOSING ") + fmtT(st.tToNext)));
    }
    if (W.match) bits.push("👥 " + W.match.aliveCount() + " ALIVE");
    if (W.player) bits.push("❤ " + Math.max(0, Math.ceil(W.player.hp)) + "  🛡 " + Math.max(0, Math.ceil(W.player.shield)));
    head.textContent = bits.join("   ·   ");
  };
  paintHead();
  h("div", { position: "absolute", bottom: "26px", fontSize: "13px", opacity: "0.7" }, "M / ESC to close", L);
  L.onclick = () => toggleBigMap(W);
  R._bigIv = setInterval(() => {
    if (R.bigmap) { drawMinimap(W, cv.getContext("2d"), size, true); paintHead(); }
    else clearInterval(R._bigIv);
  }, 400);
}

function togglePause(W) {
  // ONLINE: never freeze the sim. W.paused early-returns the whole frame pipeline,
  // which also skips netMod.update — the 12Hz state broadcast stops and the host's
  // silent-guest watchdog swaps you for a bot after 12s, i.e. opening the menu used
  // to EJECT you from a match with friends. Online shows a non-blocking overlay.
  const online = !!W.net;
  if (R.pause) { R.pause.remove(); R.pause = null; if (!online) W.paused = false; return; }
  if (!online) W.paused = true;
  document.exitPointerLock && document.exitPointerLock();
  const L = layer("pause", { pointerEvents: "auto", background: "rgba(4,8,16,0.82)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", Object.assign({ padding: "34px 44px", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px", minWidth: "300px" }, PANEL), null, L);
  h("div", { fontSize: "26px", fontWeight: "900", letterSpacing: "2px" }, "PAUSED", box);
  const resume = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "RESUME", box);
  resume.onclick = () => togglePause(W);
  const st = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "SETTINGS", box);
  st.onclick = () => showSettings(W);
  const quit = h("button", Object.assign({}, BTN, { background: "rgba(255,80,80,0.2)", color: "#ff9f9f" }), "QUIT TO MENU", box);
  quit.onclick = () => { R.pause.remove(); R.pause = null; if (!online) W.paused = false; W.endMatch(false); };
  h("div", { fontSize: "11px", opacity: "0.6" },
    online ? "ONLINE — the match keeps running while this is open. Stay sharp."
           : "Note: the match keeps running in a real BR — here it pauses (single-player).", box);
}

function showDeath(W, killerId, weaponId) {
  releaseCursor(W);          // its MATCH STATS button is otherwise unclickable
  const killer = killerId ? W.actorById.get(killerId) : null;
  const L = layer("death", { pointerEvents: "auto" });
  // The big match announcement (R.annWrap) is pinned at top:14% too, and dying
  // FIRES one ("<killer> eliminated you"), so for the ~2.6s the announcement
  // holds, ELIMINATED and the announcement painted straight through each other
  // — at the single most-screenshotted moment of the match. Sit below it.
  const box = h("div", { position: "absolute", top: "26%", left: "50%", transform: "translateX(-50%)", textAlign: "center" }, null, L);
  h("div", { fontSize: "38px", fontWeight: "900", color: "#ff7a7a", textShadow: "0 3px 12px #000", letterSpacing: "3px" }, "ELIMINATED", box);
  const place = W.match.placementOf(W.player.id);
  h("div", { fontSize: "17px", marginTop: "8px", textShadow: "0 2px 6px #000" },
    "#" + place + " of " + W.match.totalPlayers + (killer ? "  ·  by " + killer.name + " (" + K.weaponName(weaponId) + ")" : "  ·  the storm got you"), box);

  // DEATH RECAP — "by <name>" alone answers none of the questions you actually
  // have when you die: how far away were they, did they headshot me, how close
  // did I come to winning that fight.
  const hit = W.player.lastHit;
  const lines = [];
  if (killer) {
    const parts = [];
    if (hit && hit.attackerId === killerId && hit.dist != null) parts.push(hit.dist + "m");
    if (hit && hit.attackerId === killerId && hit.isHead) parts.push("HEADSHOT");
    if (parts.length) lines.push({ t: "FINAL BLOW", v: parts.join("  ·  "), c: "#ffb3a7" });
    // how close you came — the single most-wanted number on a death screen
    const dealt = Math.round((killer.dmgFrom && killer.dmgFrom[W.player.id]) || 0);
    const left = Math.max(0, Math.round(killer.hp)) + (killer.shield > 0 ? " + " + Math.round(killer.shield) + " shield" : "");
    lines.push({ t: "YOU DEALT", v: dealt + " damage", c: dealt > 0 ? "#9fd7ff" : "#8fa4bb" });
    lines.push({ t: "THEY HAD LEFT", v: killer.alive ? left + " HP" : "nothing — they died too", c: killer.alive && killer.hp <= 25 ? "#ffd166" : "#cfe4ff" });
    if (killer.alive && killer.hp <= 25 && dealt > 0) lines.push({ t: "", v: "SO CLOSE.", c: "#ffd166" });
  }
  if (lines.length) {
    const recap = h("div", {
      marginTop: "14px", display: "inline-grid", gridTemplateColumns: "auto auto", gap: "4px 14px",
      padding: "10px 18px", borderRadius: "10px", background: "rgba(6,14,28,0.55)",
      border: "1px solid rgba(140,200,255,0.18)", fontFamily: "Rajdhani, " + FONT, textAlign: "left",
    }, null, box);
    for (const l of lines) {
      h("div", { fontSize: "12px", opacity: "0.65", letterSpacing: "1.5px", alignSelf: "center" }, l.t, recap);
      h("div", { fontSize: "15px", fontWeight: "700", letterSpacing: "1px", color: l.c }, l.v, recap);
    }
  }

  const row = h("div", { display: "flex", gap: "12px", justifyContent: "center", marginTop: "16px" }, null, box);
  if (killer && killer.alive) h("div", { fontSize: "13px", opacity: "0.8", alignSelf: "center" }, "Spectating " + killer.name, row);
  const btn = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "MATCH STATS", row);
  btn.onclick = () => W.endMatch(false);
}

/** The winning kill's banner + feed used to be destroyed in the frame they were
 *  born: endMatch -> showPostMatch -> hideHUD() removed the whole layer. Phase
 *  "over" is already whitelisted in the frame gate and already blocks damage, so
 *  the world can safely hold for a beat first. */
export function announceVictory(W, victory) {
  announce(victory ? "VICTORY ROYALE" : "ELIMINATED",
    victory ? "LAST ONE STANDING" : "BETTER LUCK NEXT DROP",
    victory ? "#ffd54a" : "#ff8f6a", 2600, ANN_PRIO.victory);
}

export function showPostMatch(W, res) {
  releaseCursor(W);          // PLAY AGAIN / MAIN MENU are otherwise unclickable
  hideHUD();
  ["pause", "death"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  ensureAAAStyles();
  const L = layer("post", {
    pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(ellipse at 50% 35%, rgba(12,28,52,0.5) 0%, rgba(4,8,16,0.92) 100%)",
  });
  const box = h("div", Object.assign({
    padding: "44px 64px", textAlign: "center", display: "flex", flexDirection: "column",
    gap: "10px", minWidth: "440px", position: "relative", overflow: "hidden",
  }, PANEL), null, L);
  box.className = "lc-glass-scan";
  if (res.victory) {
    h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "42px", fontWeight: "900", color: "#ffd54a",
      textShadow: "0 0 36px rgba(255,213,74,0.55)", letterSpacing: "4px",
    }, "VICTORY ROYALE", box);
    confetti(L);
  } else {
    h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "34px", fontWeight: "900", letterSpacing: "4px",
    }, "MATCH OVER", box);
  }
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "22px", fontWeight: "800",
    color: "#9fd7ff", marginBottom: "12px", letterSpacing: "2px",
  }, "#" + res.placement + " OF " + (W.match ? W.match.totalPlayers : 50), box);
  const grid = h("div", {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 36px", fontSize: "16px",
    textAlign: "left", margin: "0 auto", fontFamily: "Rajdhani, " + FONT, fontWeight: "600",
  }, null, box);
  stat(grid, "Eliminations", res.kills);
  stat(grid, "Damage dealt", res.damage);
  stat(grid, "Accuracy", res.accuracy + "%");
  stat(grid, "Survived", fmtT(res.timeS));
  // match XP → progression (kills + damage + placement + survival + victory bonus)
  if (W.mode === "practice") {
    h("div", {
      fontSize: "12.5px", opacity: "0.75", marginTop: "14px", letterSpacing: "1px",
      fontFamily: "Rajdhani, " + FONT, color: "#9fd7ff",
    }, "PRACTICE — NO XP OR CAREER PROGRESS FROM THE SANDBOX", box);
  } else if (W.progress) {
    const gained = (res.kills || 0) * 100 + Math.round((res.damage || 0) * 0.2)
      + Math.max(0, (W.match ? W.match.totalPlayers : 50) - (res.placement || 50)) * 6
      + (res.victory ? 500 : 0) + Math.round((res.timeS || 0) / 4);
    const lvlBefore = W.progress.level;
    addXP(W, gained);
    stat(grid, "XP earned", "+" + gained);
    // Challenge XP is banked the instant a card completes, in the per-frame HUD
    // loop, so it appeared NOWHERE on this screen — and with the elim3 rotation
    // the three cards are worth 625 XP against a typical ~390 match payout, i.e.
    // most of the session's progress was invisible. Report it; do NOT re-award it.
    const chalXp = W._chalXp || 0;
    if (chalXp) {
      stat(grid, "Challenges", "+" + chalXp);
      stat(grid, "Total XP", "+" + (gained + chalXp));
    }
    // fold into the LIFETIME record (these numbers used to be discarded)
    const c = recordMatch(W, res);
    if (c) {
      h("div", { fontSize: "12.5px", opacity: "0.8", marginTop: "14px", letterSpacing: "1px", fontFamily: "Rajdhani, " + FONT },
        "CAREER · " + c.matches + " matches · " + c.wins + " wins · " + c.kills + " kills · top-10s " + c.top10s + " · best #" + (c.bestPlacement || "—")
        + " · " + Math.round(c.damage / 1000) + "k dmg · " + (c.timeAliveS / 3600).toFixed(1) + "h", box);
    }
    if (W.progress.level > lvlBefore) {
      h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "17px", fontWeight: "900", color: "#ffd54a", marginTop: "8px", letterSpacing: "2px", textShadow: "0 0 18px rgba(255,213,74,0.5)" },
        "LEVEL UP  →  " + W.progress.level, box);
    }
  }
  const row = h("div", { display: "flex", gap: "12px", justifyContent: "center", marginTop: "24px" }, null, box);
  // Requeue without the menu round-trip. Going back to the menu tears the match
  // down, rebuilds the cinematic 3D menu world and re-reads the skin GLBs, just
  // to press PLAY again — a long wait between two matches of a browser BR.
  if (res.onAgain) {
    const again = h("button", Object.assign({}, BTN, {
      fontFamily: "Orbitron, " + FONT_DISPLAY,
      background: "linear-gradient(180deg,#7ef0b0,#2fae76)", color: "#04231a",
      fontSize: "16px", padding: "14px 44px", letterSpacing: "2px",
      boxShadow: "0 0 24px rgba(70,220,150,0.35)",
    }), "PLAY AGAIN", row);
    again.className = "lc-btn-play";
    again.onclick = () => { L.remove(); R.post = null; res.onAgain(); };
  }
  const menu = h("button", Object.assign({}, BTN, {
    fontFamily: "Orbitron, " + FONT_DISPLAY,
    background: "linear-gradient(180deg,#6ec4ff,#2f7fd6)", color: "#fff",
    fontSize: "16px", padding: "14px 44px", letterSpacing: "2px",
    boxShadow: "0 0 24px rgba(60,150,255,0.4)",
  }), "MAIN MENU", row);
  menu.className = "lc-btn-play";
  menu.onclick = () => { L.remove(); R.post = null; res.onMenu(); };
}
function stat(grid, label, val) {
  h("div", { opacity: "0.7" }, label, grid);
  h("div", { fontWeight: "800", textAlign: "right" }, String(val), grid);
}
function confetti(L) {
  for (let i = 0; i < 60; i++) {
    const c = h("div", {
      position: "absolute", left: Math.random() * 100 + "%", top: "-20px",
      width: "8px", height: "12px", background: ["#ffd54a", "#57b0ff", "#4ade80", "#ff7ab8"][i % 4],
      transform: "rotate(" + Math.random() * 360 + "deg)",
      transition: "top " + (2 + Math.random() * 2.5) + "s linear, transform 3s",
    }, null, L);
    setTimeout(() => { c.style.top = "110%"; c.style.transform = "rotate(" + (360 + Math.random() * 720) + "deg)"; }, 50 + Math.random() * 800);
    setTimeout(() => c.remove(), 5000);
  }
}

// ═══ settings ════════════════════════════════════════════════════════════════
const ACTIONS = [
  ["Move Forward", "KeyW"], ["Move Back", "KeyS"], ["Move Left", "KeyA"], ["Move Right", "KeyD"],
  ["Jump", "Space"], ["Sprint", "ShiftLeft"], ["Crouch", "KeyC"], ["Loot / Interact", "KeyE"],
  ["Emote — Dance", "KeyB"], ["Emote — Cheer", "KeyN"],
  ["Reload", "KeyR"], ["Map", "KeyM"],
  ["Weapon 1", "Digit1"], ["Weapon 2", "Digit2"], ["Weapon 3", "Digit3"],
  ["Weapon 4", "Digit4"], ["Weapon 5", "Digit5"],
];   // fire/ADS are mouse buttons — not keyboard-rebindable here
// Sentinel parked on an action's DEFAULT key once that key is no longer supposed
// to trigger it. canon() maps physical -> canonical and falls through to
// identity, so without this a rebound action stayed reachable from its old key.
const UNBOUND = "__unbound";
/** The physical key currently driving `canonical`, or null if nothing does. */
function physFor(W, canonical) {
  const rm = (W.settings && W.settings.remap) || {};
  for (const k in rm) if (rm[k] === canonical) return k;
  return rm[canonical] === UNBOUND ? null : canonical;
}
/** First-run controls card. Deliberately NOT a forced tutorial: one screen, the
 *  verbs that are not guessable, and a button. Reachable any time from the menu. */
export function showHowToPlay(W) {
  releaseCursor(W);
  ensureAAAStyles();
  const L = layer("howto", { pointerEvents: "auto", background: "rgba(4,8,16,0.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 });
  const box = h("div", Object.assign({ padding: "26px 34px", width: "520px", display: "flex", flexDirection: "column", gap: "10px" }, PANEL), null, L);
  h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "20px", fontWeight: "900", letterSpacing: "3px" }, "HOW TO PLAY", box);
  h("div", { fontSize: "13px", opacity: "0.8", lineHeight: "1.5", fontFamily: "Rajdhani, " + FONT },
    "50 drop in, one walks out. Pick a landing zone, loot a weapon, stay inside the circle.", box);
  const grid = h("div", { display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 16px", marginTop: "6px", fontFamily: "Rajdhani, " + FONT, fontSize: "13px" }, null, box);
  const kb = (k, what) => {
    h("div", { fontWeight: "900", color: "#9fd7ff", letterSpacing: "1px", whiteSpace: "nowrap" }, k, grid);
    h("div", { opacity: "0.85" }, what, grid);
  };
  // Read the LIVE bindings. This card closes with "Every key here can be rebound
  // in Settings" while printing hardcoded defaults, so the moment anyone took it
  // up on that, the only onboarding screen in the game taught the wrong keys.
  const kx = (canonical) => { const ph = physFor(W, canonical); return ph ? keyLabel(ph) : "—"; };
  kb(kx("KeyW") + " " + kx("KeyA") + " " + kx("KeyS") + " " + kx("KeyD"), "Move");
  kb(kx("ShiftLeft"), (W.settings && W.settings.sprintToggle) ? "Sprint — a CLICK toggles it on and off" : "Sprint — hold");
  kb(kx("KeyC"), "Crouch — slower, but a much tighter cone");
  kb(kx("Space"), "Jump · re-open the parachute in a long fall");
  kb("LMB / RMB", "Fire · aim down sights");
  kb(kx("KeyE"), "Loot — hold on a chest to open it");
  kb(kx("KeyR"), "Reload");
  kb(kx("Digit1") + " – " + kx("Digit5"), "Weapon and item slots");
  kb(kx("KeyM"), "Map");
  kb(kx("KeyB") + " / " + kx("KeyN"), "Emote — dance · cheer");
  kb("ESC", "Pause and settings");
  h("div", { fontSize: "12px", opacity: "0.7", marginTop: "6px", lineHeight: "1.5", fontFamily: "Rajdhani, " + FONT },
    "The reticle grows when your shots will scatter and tightens when they will not — standing still and crouching both help. Every key here can be rebound in Settings.", box);
  const go = h("button", Object.assign({}, BTN, {
    fontFamily: "Orbitron, " + FONT_DISPLAY, background: "linear-gradient(180deg,#6ec4ff,#2f7fd6)",
    color: "#fff", fontSize: "15px", padding: "12px 34px", letterSpacing: "2px", marginTop: "10px", alignSelf: "center",
  }), "GOT IT", box);
  go.onclick = () => {
    try { localStorage.setItem("lc_seen_intro", "1"); } catch (e) {}
    L.remove(); R.howto = null;
  };
}

function showSettings(W) {
  releaseCursor(W);
  W.captureKey = null;   // drop any armed keybind capture when (re)rendering the modal
  // Every graphics button, every sprint/ADS toggle, the perf toggle, RESET and
  // each successful rebind re-enter this function, which tears the panel down
  // and builds a fresh scroll container — so the offset went back to the top and
  // the 17-row keybind grid (below the fold at maxHeight 82vh) threw you back up
  // to the volume sliders after every single bind.
  const prevScroll = (R.settings && R.settings.firstChild) ? R.settings.firstChild.scrollTop : 0;
  if (R.settings) { R.settings.remove(); R.settings = null; }
  const L = layer("settings", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 });
  const box = h("div", Object.assign({ padding: "28px 36px", width: "560px", maxHeight: "82vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }, PANEL), null, L);
  h("div", { fontSize: "22px", fontWeight: "900", letterSpacing: "2px" }, "SETTINGS", box);

  slider(box, "Master volume", W.settings.masterVol, (v) => { W.settings.masterVol = v; applyAudio(W); });
  slider(box, "Music volume", W.settings.musicVol, (v) => { W.settings.musicVol = v; applyAudio(W); });
  slider(box, "SFX volume", W.settings.sfxVol, (v) => { W.settings.sfxVol = v; applyAudio(W); });
  slider(box, "Mouse sensitivity", W.settings.sensitivity / 2, (v) => { W.settings.sensitivity = v * 2; save(W); }, { min: 0.075 });   // never draggable to 0 — that killed mouse-look, and it persisted
  slider(box, "ADS sensitivity", W.settings.adsSensitivity / 2, (v) => { W.settings.adsSensitivity = v * 2; save(W); }, { min: 0.075 });

  // graphics
  const gRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Graphics", gRow);
  ["low", "medium", "high"].forEach((g2) => {
    const b = h("button", Object.assign({}, BTN, { padding: "7px 16px", fontSize: "13px", background: W.settings.graphics === g2 ? "#57b0ff" : "rgba(255,255,255,0.1)", color: W.settings.graphics === g2 ? "#fff" : "#cfe4ff" }), g2.toUpperCase(), gRow);
    b.onclick = () => { W.settings.graphics = g2; applyGraphics(W); save(W); showSettings(W); };
  });

  // FOV: hardcoded at 57 (70 sprinting) with no control, in a genre where an FOV
  // slider is table stakes AND a motion-sickness accommodation.
  slider(box, "Field of view", (( W.settings.fov || 57) - 50) / 35, (v) => {
    W.settings.fov = Math.round(50 + v * 35);   // 50–85
    save(W);
  });
  // Sprint and ADS were hold-only. Toggle is an accessibility need, not a taste.
  [["Sprint (SHIFT)", "sprintToggle"], ["Aim down sights", "adsToggle"]].forEach((e) => {
    const row2 = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
    h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, e[0], row2);
    [["HOLD", false], ["TOGGLE", true]].forEach((o) => {
      const on = !!W.settings[e[1]] === o[1];
      const b = h("button", Object.assign({}, BTN, {
        padding: "7px 16px", fontSize: "13px",
        background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
      }), o[0], row2);
      b.onclick = () => { W.settings[e[1]] = o[1]; save(W); showSettings(W); };
    });
  });

  // performance readout — a browser game runs on unknown hardware, so "is it me
  // or is it the game" needs an answer the player can read
  const pRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Performance readout", pRow);
  [["OFF", false], ["ON", true]].forEach((o) => {
    const on = !!W.settings.showPerf === o[1];
    const b = h("button", Object.assign({}, BTN, {
      padding: "7px 16px", fontSize: "13px",
      background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
    }), o[0], pRow);
    b.onclick = () => {
      W.settings.showPerf = o[1];
      if (R.perf) R.perf.style.display = o[1] ? "block" : "none";
      save(W); showSettings(W);
    };
  });

  // keybinds
  h("div", { fontSize: "15px", fontWeight: "800", marginTop: "8px" }, "KEYBINDS (click to rebind)", box);
  const kGrid = h("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }, null, box);
  for (const [label, canonical] of ACTIONS) {
    const row = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, null, kGrid);
    h("div", { fontSize: "13px", opacity: "0.8" }, label, row);
    // current physical key for this action — UNBOUND if its default was released
    const phys = physFor(W, canonical);
    const kb = h("button", Object.assign({}, BTN, { padding: "4px 12px", fontSize: "12px", background: "rgba(255,255,255,0.12)", color: phys ? "#dfeaff" : "#ffb3a7", minWidth: "84px" }), phys ? keyLabel(phys) : "—", row);
    kb.onclick = () => {
      kb.textContent = "press key… (Esc = cancel)";
      W.captureKey = (code) => {
        W.captureKey = null;
        const restore = () => { kb.textContent = phys ? keyLabel(phys) : "—"; };
        if (code === "Escape") { restore(); return; }   // cancel, don't bind to Esc
        const rm = W.settings.remap = W.settings.remap || {};
        // Which action does the chosen key drive right now? canon() falls
        // through to identity, so an unmapped key drives its own default.
        const owner = rm[code] !== undefined ? rm[code] : code;
        if (owner !== canonical && owner !== UNBOUND && ACTIONS.some((a) => a[1] === owner)) {
          // Refuse instead of silently stealing it: rebinding Forward onto D used
          // to kill strafe-right while its row still proudly displayed "D".
          const other = ACTIONS.find((a) => a[1] === owner);
          kb.textContent = "already: " + other[0];
          setTimeout(restore, 1400);
          return;
        }
        for (const k3 in rm) if (rm[k3] === canonical) delete rm[k3];
        delete rm[code];
        if (code === canonical) {
          delete rm[canonical];                  // back to its own default
        } else {
          rm[code] = canonical;
          rm[canonical] = UNBOUND;               // RELEASE the old default: without
          // this, canon() identity-mapped it and BOTH keys fired the action
          // (rebind Map to Q and M kept opening the map forever).
        }
        save(W);
        showSettings(W);                          // repaint every row's truth
      };
    };
  }

  const resetRow = h("div", { display: "flex", justifyContent: "flex-end", marginTop: "4px" }, null, box);
  const resetB = h("button", Object.assign({}, BTN, { padding: "5px 14px", fontSize: "12px" }), "RESET TO DEFAULTS", resetRow);
  resetB.onclick = () => { W.settings.remap = {}; save(W); showSettings(W); };

  const closeB = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff", marginTop: "10px" }), "DONE", box);
  closeB.onclick = () => closeSettings(W);
  if (prevScroll) box.scrollTop = prevScroll;
}
function closeSettings(W) {
  W.captureKey = null;                              // never leave a keybind capture armed
  if (R.settings) { R.settings.remove(); R.settings = null; }
  save(W);
}
function keyLabel(code) { return code.replace("Key", "").replace("Digit", "").replace("Left", " L").replace("Control", "CTRL"); }
function slider(box, label, val, onChange, opts) {
  const row = h("div", { display: "flex", gap: "10px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, label, row);
  const inp = h("input", { flex: "1" }, null, row);
  inp.type = "range"; inp.min = (opts && opts.min != null) ? opts.min : 0; inp.max = 1; inp.step = 0.01; inp.value = val;
  const num = h("div", { fontSize: "12px", width: "40px", textAlign: "right" }, Math.round(val * 100) + "%", row);
  inp.oninput = () => { onChange(parseFloat(inp.value)); num.textContent = Math.round(inp.value * 100) + "%"; };
}
function applyAudio(W) {
  save(W);
  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.setVolumes(W));
}
function applyGraphics(W) {
  // Single source of truth lives on W.applyGraphics (ffg_royale3d.js) so the
  // shell-kernel quality key and the LC graphics key stay unified and the tier
  // drives real fidelity (DPR + shadow res + anisotropy), not just DPR.
  if (W.applyGraphics) W.applyGraphics(W.settings.graphics);
}
function save(W) {
  try { localStorage.setItem("lc_settings", JSON.stringify(W.settings)); } catch (e) {}
}

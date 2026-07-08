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

const css = (el, o) => { Object.assign(el.style, o); return el; };
function h(tag, styles, text, parent) {
  const el = document.createElement(tag);
  if (styles) css(el, styles);
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
const FONT = "system-ui, 'Segoe UI', sans-serif";
const PANEL = { background: "rgba(10,19,31,0.92)", border: "1px solid rgba(120,180,255,0.25)", borderRadius: "14px", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" };
const BTN = { padding: "12px 26px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "800", fontSize: "16px", fontFamily: FONT, letterSpacing: "0.5px" };

export function init(W) {
  K = W.SIM;
  W.randomMap = randomMap;   // net.js uses this for online match starts
  const root = h("div", { position: "absolute", inset: "0", pointerEvents: "none", fontFamily: FONT, zIndex: 40, color: "#eaf2ff", userSelect: "none" });
  W.kernel.parent.appendChild(root);
  R = { root };
  wireEvents(W);
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
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

export const MENU_SKINS = [
  { key: "soldier", name: "SGT. BRICK", sub: "Commando" },
  { key: "athlete", name: "DASH", sub: "Track star" },
  { key: "drifter", name: "SCRAP", sub: "Street raider" },
  { key: "wraith", name: "NIGHTFALL", sub: "Spec-ops · all black" },
  { key: "juggernaut", name: "BULWARK", sub: "Heavy armor" },
  { key: "viper", name: "STINGER", sub: "Venom suit" },
];
export function getChosenSkin() { try { return localStorage.getItem("lc_skin"); } catch (e) { return null; } }

export function showMenu(W, startMatch) {
  W.phase = "menu";
  document.exitPointerLock && document.exitPointerLock();
  W.kernel.renderer.domElement.style.cursor = "";
  hideHUD();
  const L = layer("menu", { pointerEvents: "auto", overflow: "hidden", background: "linear-gradient(180deg, #050d1c 0%, #0a2038 42%, #14405c 78%, #1d5e70 100%)" });

  // — animated backdrop: drifting sky-islands, clouds, storm ring, vignette —
  if (!document.getElementById("lc-menu-css")) {
    const st = document.createElement("style");
    st.id = "lc-menu-css";
    st.textContent = `
      @keyframes lcBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-16px) } }
      @keyframes lcBob2 { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-9px) } }
      @keyframes lcDrift { 0% { transform: translateX(-6%) } 100% { transform: translateX(105vw) } }
      @keyframes lcSpin { 0% { transform: translate(-50%,0) rotate(0deg) } 100% { transform: translate(-50%,0) rotate(360deg) } }
      @keyframes lcPulse { 0%,100% { opacity: .55 } 50% { opacity: .95 } }`;
    document.head.appendChild(st);
  }
  const isle = (w, hh) => "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${hh}' viewBox='0 0 200 150'>` +
    `<polygon points='30,52 170,52 148,64 130,120 100,146 78,110 55,66' fill='#132a3d'/>` +
    `<ellipse cx='100' cy='46' rx='86' ry='16' fill='#225a46'/>` +
    `<ellipse cx='100' cy='42' rx='86' ry='14' fill='#2e7d57'/>` +
    `<rect x='88' y='12' width='7' height='26' fill='#274054'/><ellipse cx='92' cy='12' rx='24' ry='12' fill='#357a50'/>` +
    `<rect x='128' y='20' width='5' height='20' fill='#274054'/><ellipse cx='131' cy='19' rx='16' ry='9' fill='#357a50'/></svg>`);
  const bgDeco = h("div", { position: "absolute", inset: "0", pointerEvents: "none" }, null, L);
  [[0.07, 0.16, 210, "lcBob 9s ease-in-out infinite", 0.9], [0.78, 0.10, 150, "lcBob2 12s ease-in-out infinite", 0.75], [0.62, 0.30, 90, "lcBob 14s ease-in-out infinite", 0.5], [0.16, 0.52, 70, "lcBob2 11s ease-in-out infinite", 0.4]]
    .forEach(([fx, fy, wpx, anim, op]) => {
      const d = h("div", { position: "absolute", left: fx * 100 + "%", top: fy * 100 + "%", width: wpx + "px", height: wpx * 0.75 + "px", animation: anim, opacity: String(op) }, null, bgDeco);
      d.style.backgroundImage = `url("${isle(200, 150)}")`;
      d.style.backgroundSize = "contain"; d.style.backgroundRepeat = "no-repeat";
    });
  for (let i = 0; i < 3; i++) {
    h("div", { position: "absolute", top: 12 + i * 21 + "%", left: "-10%", width: 260 + i * 90 + "px", height: "34px", borderRadius: "50%", background: "rgba(190,220,255,0.05)", filter: "blur(10px)", animation: `lcDrift ${75 + i * 30}s linear infinite`, animationDelay: -i * 26 + "s" }, null, bgDeco);
  }
  // the closing circle, projected on the horizon
  h("div", { position: "absolute", left: "50%", bottom: "-42vh", width: "78vh", height: "78vh", borderRadius: "50%", border: "3px solid rgba(150,80,255,0.5)", boxShadow: "0 0 60px rgba(150,80,255,0.5), inset 0 0 80px rgba(150,80,255,0.35)", animation: "lcSpin 40s linear infinite, lcPulse 5s ease-in-out infinite" }, null, bgDeco);
  h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0) 46%, rgba(2,6,12,0.75) 100%)" }, null, bgDeco);

  // — layout: title / [modes+play | skin bay] / controls —
  const wrap = h("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px" }, null, L);
  h("div", { fontSize: "64px", fontWeight: "900", letterSpacing: "8px", background: "linear-gradient(180deg,#ffffff,#8ec8ff 60%,#57b0ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", filter: "drop-shadow(0 0 26px rgba(80,160,255,0.55)) drop-shadow(0 4px 2px rgba(0,0,0,0.6))" }, "LAST CIRCLE", wrap);
  h("div", { fontSize: "14px", opacity: "0.8", marginTop: "-18px", letterSpacing: "5px", color: "#bfe0ff" }, "50 DROP · ONE STANDS", wrap);

  const cols = h("div", { display: "flex", gap: "26px", alignItems: "stretch" }, null, wrap);
  const leftCol = h("div", { display: "flex", flexDirection: "column", gap: "12px", justifyContent: "center" }, null, cols);

  let selMode = W.mode === "practice" ? "practice" : (W.mode || "standard");
  const modeEls = MODE_CARDS.map((m) => {
    const c = h("div", Object.assign({ padding: "13px 20px", cursor: "pointer", minWidth: "290px", transition: "transform .12s, outline-color .12s" }, PANEL), null, leftCol);
    h("div", { fontWeight: "900", fontSize: "17px", letterSpacing: "1px" }, m.name, c);
    h("div", { fontSize: "12px", opacity: "0.7", marginTop: "4px" }, m.sub, c);
    c.onclick = () => { selMode = m.id; W.events.emit("uiClick"); paint(); };
    return { m, c };
  });
  function paint() {
    modeEls.forEach(({ m, c }) => { c.style.outline = m.id === selMode ? "2px solid #57b0ff" : "1px solid rgba(120,180,255,0.0)"; c.style.transform = m.id === selMode ? "translateX(6px)" : "none"; });
  }
  paint();
  const play = h("button", Object.assign({}, BTN, { fontSize: "22px", padding: "16px 0", width: "100%", background: "linear-gradient(180deg,#57b0ff,#2f7fd6)", color: "#fff", boxShadow: "0 6px 24px rgba(60,140,255,0.45)", marginTop: "6px" }), "PLAY", leftCol);
  play.onclick = () => { W.events.emit("uiClick"); startMatch({ mapId: randomMap(), mode: selMode }); };
  const subRow = h("div", { display: "flex", gap: "10px" }, null, leftCol);
  const online = h("button", Object.assign({}, BTN, { flex: "1", fontSize: "13px", padding: "11px 8px", background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "🌐 PLAY WITH FRIENDS", subRow);
  online.onclick = () => { W.events.emit("uiClick"); W.events.emit("openOnline", { mode: selMode }); };
  const settings = h("button", Object.assign({}, BTN, { flex: "1", fontSize: "13px", padding: "11px 8px", background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "⚙ SETTINGS", subRow);
  settings.onclick = () => { W.events.emit("uiClick"); showSettings(W); };

  // — SKIN BAY: live 3D turntable preview + prev/next (choice persists) —
  const bay = h("div", Object.assign({ width: "300px", padding: "14px 16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }, PANEL), null, cols);
  h("div", { fontSize: "12px", letterSpacing: "2px", opacity: "0.65", fontWeight: "800" }, "YOUR FIGHTER", bay);
  const stage = h("div", { position: "relative", width: "260px", height: "250px", borderRadius: "10px", overflow: "hidden", background: "radial-gradient(ellipse at 50% 82%, rgba(87,176,255,0.22), rgba(6,14,26,0.9) 70%)" }, null, bay);
  const pvCv = h("canvas", { width: "260px", height: "250px" }, null, stage);
  pvCv.width = 520; pvCv.height = 500;
  const nameEl = h("div", { fontSize: "19px", fontWeight: "900", letterSpacing: "1.5px", color: "#dff0ff" }, "", bay);
  const subEl = h("div", { fontSize: "11.5px", opacity: "0.65", marginTop: "-4px" }, "", bay);
  const nav = h("div", { display: "flex", gap: "10px", alignItems: "center", marginTop: "2px" }, null, bay);
  const mkArrow = (txt) => h("button", Object.assign({}, BTN, { padding: "7px 18px", fontSize: "18px", background: "rgba(255,255,255,0.12)", color: "#cfe4ff" }), txt, nav);
  const prev = mkArrow("‹");
  const dots = h("div", { display: "flex", gap: "6px" }, null, nav);
  const dotEls = MENU_SKINS.map(() => h("div", { width: "8px", height: "8px", borderRadius: "50%", background: "rgba(255,255,255,0.25)", transition: "background .15s" }, null, dots));
  const next = mkArrow("›");

  let skinIdx = Math.max(0, MENU_SKINS.findIndex((s) => s.key === getChosenSkin()));
  let pvRig = null, pvRunning = true;
  const pvScene = new THREE.Scene();
  const pvCam = new THREE.PerspectiveCamera(34, 520 / 500, 0.1, 30);
  pvCam.position.set(0, 1.25, 3.55); pvCam.lookAt(0, 0.92, 0);
  pvScene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a3444, 1.25));
  const pvKey = new THREE.DirectionalLight(0xffffff, 2.1); pvKey.position.set(2.2, 3.2, 2.6); pvScene.add(pvKey);
  const pvRim = new THREE.DirectionalLight(0x57b0ff, 1.4); pvRim.position.set(-2.4, 2.2, -2.4); pvScene.add(pvRim);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.09, 40), new THREE.MeshStandardMaterial({ color: 0x1c3852, roughness: 0.6 }));
  disc.position.y = -0.045;
  pvScene.add(disc);
  const pvR = new THREE.WebGLRenderer({ canvas: pvCv, antialias: true, alpha: true });
  pvR.setSize(520, 500, false);
  async function setSkin(i) {
    skinIdx = (i + MENU_SKINS.length) % MENU_SKINS.length;
    const meta = MENU_SKINS[skinIdx];
    nameEl.textContent = meta.name; subEl.textContent = meta.sub;
    dotEls.forEach((d, j) => { d.style.background = j === skinIdx ? "#57b0ff" : "rgba(255,255,255,0.25)"; });
    try { localStorage.setItem("lc_skin", meta.key); } catch (e) {}
    try {
      const rig = await W.kernel.loadCharacter(W.assetBase + "assets/chars/meshy/" + meta.key + ".glb");
      if (pvRig) { pvScene.remove(pvRig.scene); W.kernel.disposeMixer(pvRig.mixer); }
      pvRig = rig;
      rig.scene.position.set(0, 0, 0);
      pvScene.add(rig.scene);
      const first = rig.animations[0];
      if (first) rig.play(first.name);
    } catch (e) { /* still baking — text only */ }
  }
  prev.onclick = () => { W.events.emit("uiClick"); setSkin(skinIdx - 1); };
  next.onclick = () => { W.events.emit("uiClick"); setSkin(skinIdx + 1); };
  setSkin(skinIdx);
  (function pvLoop() {
    if (!pvRunning || !R.menu || !R.menu.isConnected) { pvR.dispose(); if (pvRig) W.kernel.disposeMixer(pvRig.mixer); return; }
    if (pvRig) pvRig.scene.rotation.y += 0.008;
    pvR.render(pvScene, pvCam);
    requestAnimationFrame(pvLoop);
  })();
  R._menuStopPv = () => { pvRunning = false; };

  h("div", { fontSize: "12px", opacity: "0.55", maxWidth: "760px", textAlign: "center", lineHeight: "1.6" },
    "WASD move · Mouse aim/fire · RMB aim down sights · SPACE jump / toggle parachute · SHIFT sprint · R reload · E loot (hold E for chests) · 1–5 / scroll weapons · B dance · N cheer · M map", wrap);
  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.startMenuMusic(W));
}

export function showLoading(W, text) {
  // a new match must clear every stray screen from the previous one
  ["post", "death", "pause", "settings", "bigmap", "menu", "hud"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  W.paused = false;
  const L = layer("loading", { pointerEvents: "auto", background: "rgba(6,12,22,0.96)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", { textAlign: "center" }, null, L);
  h("div", { fontSize: "30px", fontWeight: "900", letterSpacing: "3px" }, "LAST CIRCLE", box);
  h("div", { fontSize: "16px", opacity: "0.8", marginTop: "12px" }, text || "Loading…", box);
  const bar = h("div", { width: "280px", height: "6px", background: "rgba(255,255,255,0.12)", borderRadius: "3px", margin: "18px auto 0", overflow: "hidden" }, null, box);
  const fill = h("div", { width: "30%", height: "100%", background: "#57b0ff", borderRadius: "3px", transition: "width .4s" }, null, bar);
  let p = 30;
  R._loadIv = setInterval(() => { p = Math.min(92, p + 8); fill.style.width = p + "%"; }, 300);
}

// ═══ LOBBY ═══════════════════════════════════════════════════════════════════
export function showLobby(W, onDone) {
  if (R._loadIv) { clearInterval(R._loadIv); R._loadIv = null; }
  if (R.loading) { R.loading.remove(); R.loading = null; }
  if (R.menu) { R.menu.remove(); R.menu = null; }
  const L = layer("lobby", { pointerEvents: "auto", background: "rgba(6,12,22,0.88)" });
  const wrap = h("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }, null, L);
  const mapName = (W.map && W.map.K && W.map.K.name) || W.mapId;
  h("div", { fontSize: "26px", fontWeight: "900", letterSpacing: "2px" }, mapName.toUpperCase() + " — " + (W.mode === "quick" ? "QUICK MATCH" : W.mode === "practice" ? "PRACTICE" : "BATTLE ROYALE"), wrap);
  const count = h("div", { fontSize: "16px", opacity: "0.85" }, "Filling lobby… 1/" + W.actors.length, wrap);
  const grid = h("div", { display: "grid", gridTemplateColumns: "repeat(10, 110px)", gap: "5px", maxWidth: "1180px" }, null, wrap);
  const cells = W.actors.map((a, i) => {
    const c = h("div", { padding: "5px 7px", fontSize: "10px", borderRadius: "6px", background: "rgba(255,255,255,0.05)", color: "transparent", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", border: "1px solid rgba(255,255,255,0.06)" }, a.name, grid);
    return c;
  });
  const cd = h("div", { fontSize: "42px", fontWeight: "900", color: "#57b0ff", minHeight: "52px" }, "", wrap);
  if (W.mode === "practice") h("div", { fontSize: "13px", opacity: "0.7" }, "Sandbox — no storm. Range targets south, movement course east.", wrap);

  // fill animation then countdown
  let filled = 1;
  cells[0].style.color = "#9fd7ff"; cells[0].style.background = "rgba(87,176,255,0.18)";
  const fillIv = setInterval(() => {
    const step = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < step && filled < cells.length; i++, filled++) {
      cells[filled].style.color = "#dfeaff";
    }
    count.textContent = (W.net ? "Waiting for friends… " : "Filling lobby… ") + filled + "/" + W.actors.length;
    if (filled >= cells.length) {
      clearInterval(fillIv);
      count.textContent = W.actors.length + "/" + W.actors.length + " — ready";
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

// ═══ HUD ═════════════════════════════════════════════════════════════════════
export function showHUD(W) {
  const L = layer("hud");
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

  // slots bottom right
  const br = h("div", { position: "absolute", right: "18px", bottom: "16px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }, null, L);
  R.slotsRow = h("div", { display: "flex", gap: "6px" }, null, br);
  R.ammoText = h("div", { fontSize: "22px", fontWeight: "900", textShadow: "0 2px 4px #000" }, "", br);

  // top center: storm timer + alive
  const tc = h("div", { position: "absolute", top: "12px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "18px", alignItems: "center", background: "rgba(0,0,0,0.4)", padding: "6px 18px", borderRadius: "10px" }, null, L);
  R.stormIcon = h("div", { fontSize: "15px" }, "⛈", tc);
  R.stormTimer = h("div", { fontSize: "17px", fontWeight: "800", minWidth: "72px" }, "", tc);
  h("div", { width: "1px", height: "18px", background: "rgba(255,255,255,0.25)" }, null, tc);
  R.aliveText = h("div", { fontSize: "17px", fontWeight: "800" }, "", tc);
  R.killsText = h("div", { fontSize: "15px", fontWeight: "700", opacity: "0.85" }, "", tc);

  // minimap top left
  const mmWrap = h("div", { position: "absolute", top: "12px", left: "14px", width: "180px", height: "180px", borderRadius: "12px", overflow: "hidden", border: "2px solid rgba(120,180,255,0.35)", boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }, null, L);
  R.mmCanvas = h("canvas", { width: "180px", height: "180px" }, null, mmWrap);
  R.mmCanvas.width = 180; R.mmCanvas.height = 180;

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

  // tints
  R.stormTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(130,60,200,0) 55%, rgba(130,60,200,0.35) 100%)", opacity: "0", transition: "opacity .5s", pointerEvents: "none" }, null, L);
  R.hurtTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(200,30,30,0) 60%, rgba(200,30,30,0.4) 100%)", opacity: "0", transition: "opacity .3s", pointerEvents: "none" }, null, L);
  R.scope = h("div", { position: "absolute", inset: "0", display: "none", background: "radial-gradient(circle at center, rgba(0,0,0,0) 26%, rgba(0,0,0,0.92) 27%)", pointerEvents: "none" }, null, L);
  const scLine = h("div", { position: "absolute", left: "50%", top: "50%", width: "40%", height: "1px", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);
  h("div", { position: "absolute", left: "50%", top: "50%", width: "1px", height: "40%", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);

  R._hudCache = {};
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
  const p = W.player;
  const C = R._hudCache;

  const hpPct = Math.max(0, Math.min(100, p.hp)) + "%";
  if (C.hp !== hpPct) { R.hpBar.style.width = hpPct; R.hpPct.textContent = Math.ceil(Math.max(0, Math.min(100, p.hp))) + "%"; C.hp = hpPct; }
  const shPct = Math.max(0, Math.min(100, p.shield)) + "%";
  if (C.sh !== shPct) { R.shieldBar.style.width = shPct; R.shieldPct.textContent = Math.ceil(Math.max(0, Math.min(100, p.shield))) + "%"; C.sh = shPct; }

  // heal channel
  if (p.healing) {
    R.healBar.style.display = "block";
    const c = K.CONSUMABLES[p.healing.id];
    R.healFill.style.width = (100 * (1 - p.healing.tLeft / c.useS)) + "%";
  } else R.healBar.style.display = "none";

  // ammo + slots
  const wpn = p.weapon;
  let ammoT = "";
  if (wpn && !wpn.id.startsWith("consumable")) {
    const def = K.WEAPONS[wpn.id];
    if (def) ammoT = wpn.state === "reloading" ? "RELOADING…" : wpn.magAmmo + " / " + (p.inventory.ammo[def.ammo] || 0);
  }
  if (p.swimming) ammoT = "SWIMMING";
  if (C.ammo !== ammoT) { R.ammoText.textContent = ammoT; C.ammo = ammoT; }

  const ammoSig = Object.values(p.inventory.ammo).join(",");
  const slotSig = p.inventory.slots.map((s, i) => (s ? s.id + (s.count || "") + (s.rarity || 0) : "-") + (i === p.inventory.active ? "*" : "")).join("|") + "#" + ammoSig;
  if (C.slots !== slotSig) { paintSlots(W, p); C.slots = slotSig; }

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
    // hurt tint decay
    R.hurtTint.style.opacity = W.t - p.lastDamageT < 0.7 ? "1" : "0";
  }

  // minimap 10Hz
  mmT += dt;
  if (mmT > 0.1) { mmT = 0; drawMinimap(W, R.mmCanvas.getContext("2d"), 180, false); }

  // interact hint + chest channel ring
  const hint = W.interactHint;
  if (hint) {
    R.interact.style.display = "block";
    R.interact.textContent = hint.type === "chest"
      ? (hint.progress > 0 ? "Opening…" : "[HOLD E] Open chest")
      : "[E] " + labelFor(hint.data);
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
  const bloom = (Math.hypot(p.vel.x, p.vel.z) > 1 ? 1.3 : 1) * (p.input.ads ? 0.8 : 1);
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
function fmtT(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// ═══ minimap ═════════════════════════════════════════════════════════════════
function drawMinimap(W, ctx, size, big) {
  if (!W.map) return;
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
  W.events.on("hitMarker", (owner) => {
    if (owner !== W.player || !R.hitmark) return;
    R.hitmark.style.opacity = "1";
    setTimeout(() => { if (R.hitmark) R.hitmark.style.opacity = "0"; }, 120);
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
    if (victim !== W.player || !info.attackerId) return;
    const att = W.actorById.get(info.attackerId);
    if (att) addIndicator(W, att.pos.x, att.pos.z, "damage");
  });
  W.events.on("actorDied", (victim, killerId, weaponId) => {
    if (!R.feed) return;
    const killer = killerId ? W.actorById.get(killerId) : null;
    const el = h("div", { background: "rgba(0,0,0,0.5)", padding: "3px 10px", borderRadius: "6px" },
      (killer ? killer.name + " ⚔ " : "⛈ ") + victim.name, R.feed);
    if (victim === W.player || killer === W.player) el.style.color = "#ffd54a";
    setTimeout(() => el.remove(), 6000);
    while (R.feed.children.length > 6) R.feed.firstChild.remove();
  });
  W.events.on("stormWarning", () => flashMsg("STORM SHRINKS IN 10 SECONDS"));
  W.events.on("stormClosing", () => flashMsg("THE STORM IS CLOSING"));
  W.events.on("playerStormState", (inStorm) => { if (R.stormTint) R.stormTint.style.opacity = inStorm ? "1" : "0"; });
  W.events.on("scopeState", (on) => { if (R.scope) R.scope.style.display = on ? "block" : "none"; });
  W.events.on("toggleBigMap", () => toggleBigMap(W));
  W.events.on("escPressed", () => {
    if (R.bigmap) { toggleBigMap(W); return; }
    if (W.phase === "match" || W.phase === "drop") togglePause(W);
  });
  W.events.on("playerDied", (killerId, weaponId) => showDeath(W, killerId, weaponId));
  W.events.on("supplyDropSpawned", () => flashMsg("SUPPLY DROP INBOUND"));
}

function flashMsg(text) {
  if (!R.stormMsg) return;
  R.stormMsg.textContent = text;
  R.stormMsg.style.opacity = "1";
  setTimeout(() => { if (R.stormMsg) R.stormMsg.style.opacity = "0"; }, 2600);
}

function toggleBigMap(W) {
  if (R.bigmap) { R.bigmap.remove(); R.bigmap = null; return; }
  const L = layer("bigmap", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center" });
  const size = Math.min(window.innerHeight - 100, 640);
  const cv = h("canvas", { borderRadius: "14px", border: "2px solid rgba(120,180,255,0.35)" }, null, L);
  cv.width = cv.height = size;
  drawMinimap(W, cv.getContext("2d"), size, true);
  h("div", { position: "absolute", bottom: "26px", fontSize: "13px", opacity: "0.7" }, "M / ESC to close", L);
  L.onclick = () => toggleBigMap(W);
  R._bigIv = setInterval(() => { if (R.bigmap) drawMinimap(W, cv.getContext("2d"), size, true); else clearInterval(R._bigIv); }, 400);
}

function togglePause(W) {
  if (R.pause) { R.pause.remove(); R.pause = null; W.paused = false; return; }
  W.paused = true;
  document.exitPointerLock && document.exitPointerLock();
  const L = layer("pause", { pointerEvents: "auto", background: "rgba(4,8,16,0.82)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", Object.assign({ padding: "34px 44px", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px", minWidth: "300px" }, PANEL), null, L);
  h("div", { fontSize: "26px", fontWeight: "900", letterSpacing: "2px" }, "PAUSED", box);
  const resume = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "RESUME", box);
  resume.onclick = () => togglePause(W);
  const st = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "SETTINGS", box);
  st.onclick = () => showSettings(W);
  const quit = h("button", Object.assign({}, BTN, { background: "rgba(255,80,80,0.2)", color: "#ff9f9f" }), "QUIT TO MENU", box);
  quit.onclick = () => { R.pause.remove(); R.pause = null; W.paused = false; W.endMatch(false); };
  h("div", { fontSize: "11px", opacity: "0.6" }, "Note: the match keeps running in a real BR — here it pauses (single-player).", box);
}

function showDeath(W, killerId, weaponId) {
  const killer = killerId ? W.actorById.get(killerId) : null;
  const L = layer("death", { pointerEvents: "auto" });
  const box = h("div", { position: "absolute", top: "14%", left: "50%", transform: "translateX(-50%)", textAlign: "center" }, null, L);
  h("div", { fontSize: "38px", fontWeight: "900", color: "#ff7a7a", textShadow: "0 3px 12px #000", letterSpacing: "3px" }, "ELIMINATED", box);
  const place = W.match.placementOf(W.player.id);
  h("div", { fontSize: "17px", marginTop: "8px", textShadow: "0 2px 6px #000" },
    "#" + place + " of " + W.match.totalPlayers + (killer ? "  ·  by " + killer.name + " (" + (weaponId || "?") + ")" : "  ·  the storm got you"), box);
  const row = h("div", { display: "flex", gap: "12px", justifyContent: "center", marginTop: "16px" }, null, box);
  if (killer && killer.alive) h("div", { fontSize: "13px", opacity: "0.8", alignSelf: "center" }, "Spectating " + killer.name, row);
  const btn = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "MATCH STATS", row);
  btn.onclick = () => W.endMatch(false);
}

export function showPostMatch(W, res) {
  hideHUD();
  ["pause", "death"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  const L = layer("post", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", Object.assign({ padding: "40px 60px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", minWidth: "420px" }, PANEL), null, L);
  if (res.victory) {
    h("div", { fontSize: "44px", fontWeight: "900", color: "#ffd54a", textShadow: "0 0 30px rgba(255,213,74,0.5)", letterSpacing: "3px" }, "VICTORY ROYALE", box);
    confetti(L);
  } else {
    h("div", { fontSize: "36px", fontWeight: "900", letterSpacing: "3px" }, "MATCH OVER", box);
  }
  h("div", { fontSize: "20px", fontWeight: "800", color: "#9fd7ff", marginBottom: "10px" }, "#" + res.placement + " OF " + (W.match ? W.match.totalPlayers : 50), box);
  const grid = h("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 30px", fontSize: "15px", textAlign: "left", margin: "0 auto" }, null, box);
  stat(grid, "Eliminations", res.kills);
  stat(grid, "Damage dealt", res.damage);
  stat(grid, "Accuracy", res.accuracy + "%");
  stat(grid, "Survived", fmtT(res.timeS));
  // one life per match — no instant requeue; back to the menu
  const row = h("div", { display: "flex", gap: "12px", justifyContent: "center", marginTop: "22px" }, null, box);
  const menu = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff", fontSize: "18px", padding: "14px 44px" }), "MAIN MENU", row);
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
  ["Jump", "Space"], ["Sprint", "ShiftLeft"], ["Loot / Interact", "KeyE"],
  ["Reload", "KeyR"], ["Map", "KeyM"],
];
function showSettings(W) {
  if (R.settings) { R.settings.remove(); R.settings = null; }
  const L = layer("settings", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 });
  const box = h("div", Object.assign({ padding: "28px 36px", width: "560px", maxHeight: "82vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }, PANEL), null, L);
  h("div", { fontSize: "22px", fontWeight: "900", letterSpacing: "2px" }, "SETTINGS", box);

  slider(box, "Master volume", W.settings.masterVol, (v) => { W.settings.masterVol = v; applyAudio(W); });
  slider(box, "Music volume", W.settings.musicVol, (v) => { W.settings.musicVol = v; applyAudio(W); });
  slider(box, "SFX volume", W.settings.sfxVol, (v) => { W.settings.sfxVol = v; applyAudio(W); });
  slider(box, "Mouse sensitivity", W.settings.sensitivity / 2, (v) => { W.settings.sensitivity = v * 2; save(W); });
  slider(box, "ADS sensitivity", W.settings.adsSensitivity / 2, (v) => { W.settings.adsSensitivity = v * 2; save(W); });

  // graphics
  const gRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Graphics", gRow);
  ["low", "medium", "high"].forEach((g2) => {
    const b = h("button", Object.assign({}, BTN, { padding: "7px 16px", fontSize: "13px", background: W.settings.graphics === g2 ? "#57b0ff" : "rgba(255,255,255,0.1)", color: W.settings.graphics === g2 ? "#fff" : "#cfe4ff" }), g2.toUpperCase(), gRow);
    b.onclick = () => { W.settings.graphics = g2; applyGraphics(W); save(W); showSettings(W); };
  });

  // keybinds
  h("div", { fontSize: "15px", fontWeight: "800", marginTop: "8px" }, "KEYBINDS (click to rebind)", box);
  const kGrid = h("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }, null, box);
  for (const [label, canonical] of ACTIONS) {
    const row = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, null, kGrid);
    h("div", { fontSize: "13px", opacity: "0.8" }, label, row);
    // find current physical key for this canonical
    let phys = canonical;
    for (const k2 in (W.settings.remap || {})) if (W.settings.remap[k2] === canonical) phys = k2;
    const kb = h("button", Object.assign({}, BTN, { padding: "4px 12px", fontSize: "12px", background: "rgba(255,255,255,0.12)", color: "#dfeaff", minWidth: "84px" }), keyLabel(phys), row);
    kb.onclick = () => {
      kb.textContent = "press key…";
      W.captureKey = (code) => {
        W.captureKey = null;
        W.settings.remap = W.settings.remap || {};
        for (const k3 in W.settings.remap) if (W.settings.remap[k3] === canonical) delete W.settings.remap[k3];
        if (code !== canonical) W.settings.remap[code] = canonical;
        save(W);
        kb.textContent = keyLabel(code);
      };
    };
  }

  const closeB = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff", marginTop: "10px" }), "DONE", box);
  closeB.onclick = () => { L.remove(); R.settings = null; save(W); };
}
function keyLabel(code) { return code.replace("Key", "").replace("Digit", "").replace("Left", " L").replace("Control", "CTRL"); }
function slider(box, label, val, onChange) {
  const row = h("div", { display: "flex", gap: "10px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, label, row);
  const inp = h("input", { flex: "1" }, null, row);
  inp.type = "range"; inp.min = 0; inp.max = 1; inp.step = 0.01; inp.value = val;
  const num = h("div", { fontSize: "12px", width: "40px", textAlign: "right" }, Math.round(val * 100) + "%", row);
  inp.oninput = () => { onChange(parseFloat(inp.value)); num.textContent = Math.round(inp.value * 100) + "%"; };
}
function applyAudio(W) {
  save(W);
  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.setVolumes(W));
}
function applyGraphics(W) {
  const r = W.kernel.renderer;
  if (W.settings.graphics === "low") { r.setPixelRatio(1); r.shadowMap.enabled = false; }
  else if (W.settings.graphics === "high") { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.shadowMap.enabled = true; }
  else { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); r.shadowMap.enabled = true; }
  W.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}
function save(W) {
  try { localStorage.setItem("lc_settings", JSON.stringify(W.settings)); } catch (e) {}
}

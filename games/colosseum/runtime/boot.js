// Colosseum — bootstrap.
//
// Responsibilities, in order: detect capability -> pick a quality tier ->
// create the renderer -> build the world -> run a fixed-timestep loop.
//
// MULTIPLAYER SEAM: the simulation is advanced in fixed steps from a command
// stream, and rendering only ever reads interpolated state. Nothing here
// reaches into sim state from a rAF callback, so an authoritative server can
// later drive the same step function with the same commands and produce the
// same world (see sim/ for the deterministic pieces).

import * as THREE from "three";
import { Colosseum } from "./view/colosseum.js";
import { Crowd } from "./view/crowd.js";
import { Sky } from "./view/sky.js";
import { Hypogeum } from "./view/hypogeum.js";
import { Gates } from "./view/gates.js";
import { loadFighter, loadBeast, Actor, attachWeapon, makeGladius, makeScutum, makeTrident } from "./view/actors.js";
import { makeSand } from "./view/sand.js";
import { Equipment } from "./view/equipment.js";
import { Inventory } from "./sim/inventory.js";
import { Armoury } from "./ui/armoury.js";
import { ARENA } from "./data/arena_spec.js";
import { clamp, damp, TAU } from "./core/util.js";

const container = document.getElementById("game-container");

// ---------------------------------------------------------------------------
// Quality tier
// ---------------------------------------------------------------------------
function detectQuality() {
  const forced = new URLSearchParams(location.search).get("q");
  if (forced) return forced;
  try {
    const saved = localStorage.getItem("colosseum_quality");
    if (saved) return JSON.parse(saved);
  } catch (e) { /* first run */ }

  // Heuristic starting point; the perf monitor corrects it within a few seconds.
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return mem >= 6 && cores >= 6 ? "medium" : "low";
  if (mem >= 8 && cores >= 8) return "high";
  if (mem >= 4 && cores >= 4) return "medium";
  return "low";
}

const QUALITY = detectQuality();
const DPR_CAP = { low: 1.0, medium: 1.25, high: 1.5, ultra: 2.0 }[QUALITY] ?? 1.5;

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------
const loadEl = document.createElement("div");
loadEl.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:radial-gradient(ellipse at 50% 40%,#2a1c10,#0d0906 78%);
  z-index:10;color:#e8dcc0;font-family:Georgia,'Times New Roman',serif;transition:opacity .6s`;
loadEl.innerHTML = `
  <div style="font-size:15px;letter-spacing:9px;color:#a8916a;margin-bottom:10px">FORGEFLOW GAMES</div>
  <div style="font-size:52px;font-weight:900;letter-spacing:5px;
    background:linear-gradient(180deg,#ffeec4,#e0b558 52%,#a8471f);-webkit-background-clip:text;
    background-clip:text;color:transparent;text-align:center">COLOSSEUM</div>
  <div style="font-size:16px;letter-spacing:7px;color:#c9a86e;margin-top:4px">SANDS OF GLORY</div>
  <div style="width:320px;height:8px;border:1px solid #8a6b39;margin-top:34px;overflow:hidden;background:#1a120a">
    <div id="cl-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#8a3418,#e0b558);transition:width .25s"></div></div>
  <div id="cl-txt" style="margin-top:14px;font-size:13px;color:#9c8760;letter-spacing:1px">Raising the arena…</div>`;
container.appendChild(loadEl);
const setProgress = (f, txt) => {
  const b = loadEl.querySelector("#cl-bar");
  if (b) b.style.width = `${Math.round(f * 100)}%`;
  if (txt) loadEl.querySelector("#cl-txt").textContent = txt;
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: QUALITY !== "low",
  powerPreference: "high-performance",
  stencil: false,
});
// Viewport size. The container can legitimately measure 0x0 at boot (hidden
// iframe, a pane that has not laid out yet, display:none ancestor), and a 0x0
// drawing buffer silently renders nothing forever. Fall back to the window and
// keep watching with a ResizeObserver so the game recovers the moment it is
// actually shown.
function viewportSize() {
  const w = container.clientWidth || window.innerWidth || 1280;
  const h = container.clientHeight || window.innerHeight || 720;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_CAP));
{
  const { w, h } = viewportSize();
  renderer.setSize(w, h);
}
renderer.shadowMap.enabled = QUALITY !== "low";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, viewportSize().w / viewportSize().h, 0.25, 1200);

function applyViewport() {
  const { w, h } = viewportSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
}
applyViewport();
window.addEventListener("resize", applyViewport);
// A container that lays out late (or a pane being dragged) fires here, not on
// window resize — this is what rescues the 0x0 case.
if (window.ResizeObserver) new ResizeObserver(applyViewport).observe(container);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
setProgress(0.1, "Raising the arena…");

const sky = new Sky(scene, { timeOfDay: "afternoon" });
sky.setShadowQuality(QUALITY);
renderer.toneMappingExposure = sky.exposure();

setProgress(0.3, "Raking the harena…");
// The sand carries procedural grain plus a persistent damage layer (blood,
// scuffs, drag trails) composited in the shader — one draw call, no decals.
const { material: sandMaterial, damage: sandDamage } = makeSand(renderer, {
  size: QUALITY === "low" ? 512 : 1024,
});

setProgress(0.35, "Cutting the travertine…");
const colosseum = new Colosseum({ scene, quality: QUALITY, seed: 20260724, sandMaterial }).build();

setProgress(0.62, "Hanging the gates…");
const gates = new Gates(colosseum.group, { materials: colosseum.mat, colosseum });
const hypogeum = new Hypogeum(colosseum.group, { quality: QUALITY, seed: 20260724, materials: colosseum.mat });

setProgress(0.75, "Seating the mob…");
const crowd = new Crowd(colosseum.group, { quality: QUALITY, seed: 20260724 });

// Bake the sky into an environment map. Must happen AFTER the geometry exists
// (the bake hides scene meshes so only the sky is captured) and it is what
// stops every metal surface from rendering black.
setProgress(0.9, "Catching the light…");
sky.bakeEnvironment(renderer);

// ---------------------------------------------------------------------------
// Actors. Loaded after the world so the loading bar reflects real work, and
// awaited before the first frame so nothing pops in.
// ---------------------------------------------------------------------------
setProgress(0.94, "Arming the fighters…");

// The career save. Restored before actors so the fighter is built already
// wearing whatever the player last equipped.
const inventory = Inventory.restore();

const actors = { player: null, beast: null };
try {
  const [fighterLib, beastLib] = await Promise.all([
    loadFighter("assets/chars/gladiator"),
    // TIGER, not leopard: leopard.glb and jaguar.glb are anthropomorphic
    // beast-MEN despite their clip names, verified by rendering them. The
    // tiger is a true quadruped, one draw call, and the only cat in the
    // library shipping both an Attack and a Run clip.
    loadBeast("assets/beasts/tiger.glb"),
  ]);

  actors.player = new Actor(fighterLib, { height: 1.82, name: "player" });
  actors.player.pos.set(-16, 0, 4);
  actors.player.facing = Math.PI * 0.5;
  actors.player.play("idle");
  attachWeapon(actors.player, makeGladius(), { palm: 0.055 });
  // The scutum rides on the forearm facing forward: its local +z (the convex
  // face) must point away from the body, and its long axis runs down the arm.
  attachWeapon(actors.player, makeScutum(), {
    bone: /LeftHand|Hand_L|mixamorig.*LeftHand/i,
    palm: 0.04,
    align: "shield",
  });
  // Visible equipment: bone-attached Roman armour that the armoury drives.
  actors.player.equipment = new Equipment(actors.player);
  actors.player.equipment.applyLoadout({ armour: inventory.armourList() });

  scene.add(actors.player.root);

  actors.beast = new Actor(beastLib, {
    // Quadrupeds are sized by BODY LENGTH. A Bengal tiger is ~2.0 m nose to
    // tail-base; sizing by "height" turns a big cat into a house cat.
    length: 2.05,
    name: "beast",
    restClip: "Idle",
    clipMap: { idle: "Idle_Lie Prone", walk: "Walk", run: "Run", attack: "Attack", howl: "Howl" },
  });
  actors.beast.pos.set(2, 0, 6);
  actors.beast.facing = -Math.PI * 0.5;
  actors.beast.play("idle");
  scene.add(actors.beast.root);
} catch (e) {
  console.error("[boot] actor load failed:", e);
  window.__ACTOR_ERR__ = String(e && e.message || e);
}

setProgress(1.0, "Ready.");

// ---------------------------------------------------------------------------
// Armoury. The paper doll IS the live fighter, so a purchase is visible on the
// body the instant it is made.
// ---------------------------------------------------------------------------
const armoury = new Armoury(document.getElementById("hud"), inventory, {
  onEquip: (slot, id, inv) => {
    if (actors.player && actors.player.equipment) {
      actors.player.equipment.applyLoadout({ armour: inv.armourList() });
    }
    // Weapon and shield live on hand bones and are rebuilt by the actor layer.
    syncHeldGear(inv);
  },
  onPreviewRotate: (on) => { camRig.preview = on; },
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Tab") { e.preventDefault(); armoury.toggle(); }
});

/** Rebuild the held weapon/shield to match the inventory. */
function syncHeldGear(inv) {
  const p = actors.player;
  if (!p) return;
  // Drop existing hand mounts.
  const kill = [];
  p.model.traverse((o) => { if (o.name === "weapon_mount") kill.push(o); });
  kill.forEach((m) => { m.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); m.removeFromParent(); });

  const wid = inv.equipped.weapon;
  const maker = { gladius: makeGladius, spatha: makeGladius, sica: makeGladius, trident: makeTrident, hasta: makeTrident, dimachaerus: makeGladius }[wid] || makeGladius;
  attachWeapon(p, maker(), { palm: 0.055 });
  if (inv.equipped.shield && inv.equipped.shield !== "none") {
    attachWeapon(p, makeScutum(inv.equipped.shield === "parmula" ? { w: 0.44, h: 0.46, curve: 0.10 } : {}), {
      bone: /LeftHand|Hand_L|mixamorig.*LeftHand/i, palm: 0.04, align: "shield",
    });
  }
}

// ---------------------------------------------------------------------------
// Camera rig — a cinematic orbit until gameplay takes over.
// ---------------------------------------------------------------------------
const camRig = {
  target: new THREE.Vector3(0, 1.4, 0),
  theta: Math.PI * 0.82,
  phi: 0.30,
  dist: 46,
  auto: true,
};

function updateCamera(dt) {
  // Armoury preview: orbit the fighter close and slow so the player can see
  // what they just bought from every side.
  if (camRig.preview && actors.player) {
    camRig.theta += dt * 0.35;
    camRig.target.set(actors.player.pos.x, 1.02, actors.player.pos.z);
    camRig.dist = damp(camRig.dist, 3.4, 4, dt);
    camRig.phi = damp(camRig.phi, 0.12, 4, dt);
  } else if (camRig.auto) camRig.theta += dt * 0.055;
  const ce = Math.cos(camRig.phi);
  camera.position.set(
    camRig.target.x + Math.cos(camRig.theta) * camRig.dist * ce,
    camRig.target.y + Math.sin(camRig.phi) * camRig.dist,
    camRig.target.z + Math.sin(camRig.theta) * camRig.dist * ce
  );
  camera.lookAt(camRig.target);
}

// Mouse/touch orbit so the arena can be inspected from any angle.
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
  dragging = true; camRig.auto = false; lastX = e.clientX; lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointerup", (e) => {
  dragging = false;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  camRig.theta -= (e.clientX - lastX) * 0.005;
  camRig.phi = clamp(camRig.phi + (e.clientY - lastY) * 0.004, -0.05, 1.35);
  lastX = e.clientX; lastY = e.clientY;
});
renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();
  camRig.dist = clamp(camRig.dist * (1 + Math.sign(e.deltaY) * 0.09), 8, 260);
}, { passive: false });

// ---------------------------------------------------------------------------
// Spectacle cues. The gate and lift systems emit events on exact beats; this
// is where they turn into crowd reactions (and, once audio lands, horns).
// ---------------------------------------------------------------------------
const cueLog = [];

/**
 * ONE fixed simulation step. Both the requestAnimationFrame loop and the
 * verification harness drive the world through here, so what an automated
 * check exercises is exactly what a player gets. (These were briefly two
 * separate code paths, and the harness silently advanced nothing but the
 * crowd — gates and lifts sat frozen at t=0 while every check reported
 * "opening".)
 *
 * This is also the multiplayer seam: a server tick calls exactly this.
 */
function stepSim(dt) {
  crowd.update(dt);
  if (actors.player) actors.player.update(dt, actors.player.speed);
  if (actors.beast) actors.beast.update(dt, actors.beast.speed);
  // Gate and lift events are the cues the audio and crowd systems react to
  // (horn on gate-start, roar on cage-release), so they are dispatched here
  // rather than polled.
  for (const ev of gates.update(dt)) onGateEvent(ev);
  for (const ev of hypogeum.update(dt)) onLiftEvent(ev);
}

function onGateEvent(ev) {
  cueLog.push({ t: +(frames / 60).toFixed(2), kind: "gate", id: ev.id, event: ev.event });
  if (ev.event === "start") {
    // The grind of the Triumphalis opening is what quiets a crowd and then
    // detonates it — anticipation first, roar on the reveal.
    crowd.setExcitement(0.12, true);
  } else if (ev.event === "done") {
    crowd.react(0.85);
    if (ev.id === "triumphalis") crowd.startWave({ laps: 1, speed: 2.8, strength: 1 });
  }
}

function onLiftEvent(ev) {
  cueLog.push({ t: +(frames / 60).toFixed(2), kind: "lift", index: ev.lift.index, event: ev.event });
  if (ev.event === "doors") crowd.setExcitement(0.2, true);   // hush as the sand splits
  else if (ev.event === "rising") crowd.react(0.5);
  else if (ev.event === "released") { crowd.react(1.0); crowd.startWave({ laps: 1, speed: 3.4, strength: 1 }); }
}

// ---------------------------------------------------------------------------
// Perf monitor — a rolling frame-time average that can demote quality.
// ---------------------------------------------------------------------------
const perf = {
  samples: new Float32Array(120),
  idx: 0, filled: 0,
  push(ms) {
    this.samples[this.idx] = ms;
    this.idx = (this.idx + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled++;
  },
  avg() {
    let s = 0;
    for (let i = 0; i < this.filled; i++) s += this.samples[i];
    return this.filled ? s / this.filled : 0;
  },
  fps() { const a = this.avg(); return a > 0 ? 1000 / a : 0; },
};

// ---------------------------------------------------------------------------
// Fixed-timestep loop
// ---------------------------------------------------------------------------
const FIXED_DT = 1 / 60;
let acc = 0;
let last = performance.now();
let frames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  last = now;
  perf.push(rawMs);

  // Clamp so a tab-switch stall doesn't fast-forward the simulation.
  const dt = Math.min(rawMs / 1000, 0.1);
  acc += dt;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 5) {
    stepSim(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }

  updateCamera(dt);
  renderer.render(scene, camera);

  // Demo choreography for the arena preview: periodic crowd swells and a wave.
  frames++;
  if (frames % 600 === 120) crowd.startWave({ laps: 1, speed: 2.4, strength: 1 });
  if (frames % 300 === 0) crowd.react(0.55);
  crowd.lookAt(camRig.target);

  if (frames === 12) {
    loadEl.style.opacity = "0";
    setTimeout(() => loadEl.remove(), 700);
  }
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Verification hooks (FFG convention — 3D games are verified by evaluating
// these, because WebGL screenshots hang the preview harness).
// ---------------------------------------------------------------------------
window.__FFG3D__ = {
  renderer, scene, camera, colosseum, crowd, sky, gates, hypogeum, actors,
  inventory, armoury,
  quality: QUALITY,
  stats: () => ({
    quality: QUALITY,
    dpr: renderer.getPixelRatio(),
    fps: +perf.fps().toFixed(1),
    frameMs: +perf.avg().toFixed(2),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs ? renderer.info.programs.length : -1,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    crowd: crowd.stats(),
    gates: gates.stats(),
    hypogeum: hypogeum.stats(),
    arenaDrawCalls: colosseum.drawCallEstimate(),
    camera: { x: +camera.position.x.toFixed(1), y: +camera.position.y.toFixed(1), z: +camera.position.z.toFixed(1) },
    timeOfDay: sky.todKey,
    frames,
  }),
  __test: {
    setTimeOfDay: (k) => {
      sky.setTimeOfDay(k);
      renderer.toneMappingExposure = sky.exposure();
      sky.bakeEnvironment(renderer);   // the sky IS the fill light — re-bake it
      return k;
    },
    setCamera: (theta, phi, dist) => { camRig.auto = false; camRig.theta = theta; camRig.phi = phi; camRig.dist = dist; updateCamera(0); return true; },
    /**
     * Drive N complete frames synchronously. Verification harnesses run in a
     * hidden tab where requestAnimationFrame is suspended, so without this the
     * game looks dead to every automated check. Returns real timing measured
     * around gl.finish() so the numbers are GPU-inclusive, not just JS submit.
     */
    step: (n = 1, dt = 1 / 60) => {
      const gl = renderer.getContext();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        stepSim(dt);              // the SAME step the rAF loop runs
        updateCamera(dt);
        renderer.render(scene, camera);
        frames++;
      }
      gl.finish();
      const ms = performance.now() - t0;
      return {
        frames: n,
        totalMs: +ms.toFixed(2),
        msPerFrame: +(ms / n).toFixed(3),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        size: [renderer.domElement.width, renderer.domElement.height],
      };
    },
    resize: (w, h) => {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      return [renderer.domElement.width, renderer.domElement.height];
    },
    /**
     * Render offscreen and read the pixels back, so the frame can be inspected
     * even when the page is not compositing (hidden tab / undisplayed pane).
     * Posts the image to the dev shot server. Returns the server's reply.
     *
     * Deliberately uses a RenderTarget + readRenderTargetPixels rather than
     * canvas.toDataURL(): the latter needs preserveDrawingBuffer and returns
     * whatever survived compositing, which in a hidden tab is often nothing.
     */
    capture: async (name = "shot.png", w = 1600, h = 900, opts = {}) => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
        samples: opts.samples ?? 4,
      });
      const prevAspect = camera.aspect;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);

      const buf = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      renderer.setRenderTarget(null);

      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();

      // GL origin is bottom-left; canvas is top-left. Flip rows.
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(w, h);
      const row = w * 4;
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * row;
        img.data.set(buf.subarray(src, src + row), y * row);
      }
      ctx.putImageData(img, 0, 0);

      const url = cv.toDataURL(opts.jpeg ? "image/jpeg" : "image/png", opts.quality ?? 0.88);
      rt.dispose();
      const res = await fetch(`/__shot/${name}`, { method: "POST", body: url });
      return { name, w, h, bytes: url.length, server: await res.text() };
    },
    wave: () => { crowd.startWave({ laps: 1 }); return true; },
    excite: (v) => { crowd.setExcitement(v, true); return v; },
    openGate: (id) => { gates.open(id); return gates.stats(); },
    closeGate: (id) => { gates.close(id); return gates.stats(); },
    openLift: (i) => { hypogeum.open(i); return hypogeum.stats(); },
    /** Equip/unequip on the live model — proves purchases become visible. */
    equip: (armour) => {
      if (!actors.player || !actors.player.equipment) return null;
      const worn = actors.player.equipment.applyLoadout({ armour: armour || [] });
      return { worn, drawCalls: actors.player.equipment.drawCalls() };
    },
    worn: () => (actors.player && actors.player.equipment ? actors.player.equipment.worn() : null),
    armoury: (open) => { open ? armoury.show() : armoury.hide(); return armoury.open; },
    buy: (kind, id) => { const r = inventory.buy(kind, id); armoury.render(); return r; },
    equipItem: (slot, id) => {
      const r = inventory.equip(slot, id);
      if (r.ok && actors.player && actors.player.equipment) {
        actors.player.equipment.applyLoadout({ armour: inventory.armourList() });
        syncHeldGear(inventory);
      }
      armoury.render();
      return r;
    },
    inv: () => ({
      gold: inventory.gold, wins: inventory.wins, rank: inventory.rank().name,
      equipped: { ...inventory.equipped }, owned: JSON.parse(JSON.stringify(inventory.owned)),
      mobility: inventory.mobility(), armatura: inventory.matchedArmatura()?.name || null,
    }),
    settle: (o) => inventory.settle(o),
    blood: (x, z, r = 0.5, s = 1) => sandDamage.splat(x, z, r, "blood", s),
    scuff: (x, z, r = 0.4, s = 0.7) => sandDamage.splat(x, z, r, "scuff", s),
    dragTrail: (x0, z0, x1, z1) => { sandDamage.trail(x0, z0, x1, z1); return sandDamage.splats; },
    clearSand: () => { sandDamage.clear(); return true; },
    sandSplats: () => sandDamage.splats,
    closeLift: (i) => { hypogeum.close(i); return hypogeum.stats(); },
    cues: () => cueLog.slice(-40),
    clearCues: () => { cueLog.length = 0; return true; },
    /** Rig diagnostics — proves clips actually bound, not just that files loaded. */
    actors: () => {
      const d = {};
      for (const k of ["player", "beast"]) {
        const a = actors[k];
        if (!a) { d[k] = null; continue; }
        d[k] = {
          clips: Object.keys(a.actions),
          playing: a.currentName,
          height: +a.height.toFixed(2),
          rawRigHeight: +a.rawHeight.toFixed(3),
          pos: [+a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)],
          weaponMounts: (() => { let n = 0; a.model.traverse((o) => { if (o.name === "weapon_mount") n++; }); return n; })(),
        };
      }
      return d;
    },
    anim: (who, logical, once = false) => {
      const a = actors[who];
      if (!a) return null;
      return once ? a.playOnce(logical) : a.play(logical);
    },
    placeActor: (who, x, z, facing) => {
      const a = actors[who];
      if (!a) return null;
      a.pos.set(x, 0, z);
      if (facing !== undefined) { a.facing = facing; a.visualFacing = facing; }
      return [x, z];
    },
    dims: () => ({
      floor: { a: ARENA.floor.a, b: ARENA.floor.b },
      outer: colosseum.outer,
      caveaTop: colosseum.caveaTop,
      atticTop: colosseum.atticTop,
    }),
  },
};

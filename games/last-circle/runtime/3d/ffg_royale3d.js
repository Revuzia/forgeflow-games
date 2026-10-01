/**
 * FFG runtime — 3d/ffg_royale3d.js  (Last Circle)
 * Genre "royale": 50-player third-person battle royale shooter.
 *
 * This is the ORCHESTRATOR. All rules live in ../sim/royale.js (deterministic,
 * node-tested); rendering + input + AI live in ./royale/* submodules. This file
 * wires them into the shared world object `W` and owns the frame pipeline:
 *
 *   menu → lobby → drop → match loop → victory/defeat → stats → menu
 *
 * Frame order (update): input/brains → movement+physics → weapons/projectiles
 * → loot → storm → fx → hud. Bots emit the SAME input struct the
 * human's keyboard/mouse produces and run through the same movement/weapon
 * code — "bots are players" is structural, not simulated.
 *
 * Debug hook: window.__LC__ (world, startMatch, fastForward, state, and the
 * contract-C9 test surface: stepFrames(n, dt, render), prof(), feel()).
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
// IMPORTANT: import the kernel WITH the same ?v= query as the boot module —
// a bare "./ffg_kernel_3d.js" would be a SECOND module instance with its own
// (empty) genre registry, and boot3d would never see "royale" registered.
const { register3d } = await import("./ffg_kernel_3d.js" + V);
const [mapsMod, playerMod, weaponsMod, lootMod, stormMod, botsMod, hudMod, audioMod, fxMod, netMod] =
  await Promise.all([
    import("./royale/maps.js" + V),
    import("./royale/player.js" + V),
    import("./royale/weapons.js" + V),
    import("./royale/loot.js" + V),
    import("./royale/storm.js" + V),
    import("./royale/bots.js" + V),
    import("./royale/hud.js" + V),
    import("./royale/audio.js" + V),
    import("./royale/fx.js" + V),
    import("./royale/net.js" + V),
  ]);
const { MAPS, buildMap, disposeMapResources } = mapsMod;
// sim/royale.js is a universal script (not an ES module) — load it once via
// a classic <script> tag so it lands on window.FFG.sim.Royale.
await new Promise((res, rej) => {
  if (window.FFG && window.FFG.sim && window.FFG.sim.Royale) return res();
  const s = document.createElement("script");
  s.src = new URL("../sim/royale.js" + V, import.meta.url).href;
  // Reject with a NAMED Error: a bare `rej` handed the boot module the script's
  // load Event, whose message is "[object Event]" — the failure card could not
  // say which file was missing.
  s.onload = res; s.onerror = () => rej(new Error("failed to load " + s.src));
  document.head.appendChild(s);
});
const SIM = window.FFG.sim.Royale;

// Match teardown order (contract C8). Every module that owns per-match state
// exports disposeMatch(W); each is FEATURE-DETECTED so lanes can land in any
// order. hud/fx/audio drop references into the old roster first, weapons detaches
// held guns while W.actors still lists them, player (skeletons, name tags) before
// the roster is cleared, and the map LAST — its disposal walks the map group.
// net.js is deliberately absent: a rematch inside a SQUAD UP room re-enters
// startMatch, and tearing the session down there would eject the squad.
const MATCH_MODS = [["hud", hudMod], ["fx", fxMod], ["audio", audioMod], ["weapons", weaponsMod], ["bots", botsMod],
  ["loot", lootMod], ["player", playerMod], ["storm", stormMod], ["maps", mapsMod]];

register3d("royale", async function (kernel, content) {
  const setup = content.setup || {};

  // ── shared world ────────────────────────────────────────────────────────────
  const W = {
    THREE, kernel, content, SIM,
    scene: kernel.scene, camera: kernel.camera,
    assetBase: new URL("../../", import.meta.url).href, // game dir root
    // match config (set by menu)
    mapId: setup.defaultMap || "isla_viva",
    mode: setup.defaultMode || "standard",
    seed: (content.seed || 1) >>> 0,
    // live state
    phase: "menu",           // menu | lobby | drop | match | over
    t: 0,                    // match seconds
    actors: [], actorById: new Map(),
    player: null,
    map: null,               // built map: heightAt, pois, colliders, harvestables...
    loot: null, stormCtl: null, match: null,
    rng: SIM.mulberry32((content.seed || 1) >>> 0),
    events: mkEmitter(),
    settings: loadSettings(),
    net: null,               // multiplayer session (null = offline)
    stats: { shotsFired: 0, shotsHit: 0 },
    paused: false,
    _groups: {},             // scene groups per system
  };
  W.group = (name) => {
    if (!W._groups[name]) { const g = new THREE.Group(); g.name = name; W.scene.add(g); W._groups[name] = g; }
    return W._groups[name];
  };

  // module init (order matters: audio/fx/hud first — others emit into them)
  audioMod.init(W);
  fxMod.init(W);
  hudMod.init(W);
  playerMod.init(W);
  // Touch controls (lane L10). Installed for every device: touch.js decides for itself
  // whether to show (coarse pointer / a real touch / ?touch=1) and hides on a mouse press.
  // Without this line nothing imported it, and because game_controls.js now marks Last
  // Circle "native" (no shared shooter overlay), a phone had NO controls at all.
  import("./royale/touch.js" + V)
    .then((m) => { if (m && m.install) m.install(W, { hud: hudMod }); })
    .catch((e) => console.warn("[LC] touch controls unavailable:", e && e.message));
  weaponsMod.init(W);
  lootMod.init(W);
  stormMod.init(W);
  botsMod.init(W);
  netMod.init(W);

  // ── portal surface (LOCAL ONLY — no SDK, no network, no third party) ────────
  // The shell control bar drives window.__PAUSE__ for its Pause button and for the
  // auto-pause when the player leaves fullscreen (game_controls.js:199, 229-230).
  // Nothing ever assigned it, so both were silent. hud owns the pause menu and its
  // online-safe path (it must NOT freeze the sim online — W.paused skips
  // netMod.update and the host's silent-guest watchdog swaps you for a bot), so
  // this is a binding, not a second implementation. Same shape as cosmic-coils.
  // Guarded: hud.js exports requestPause in a parallel change, and an unguarded
  // call would turn a dead button into a thrown error.
  window.__PAUSE__ = {
    toggle: () => { if (hudMod.requestPause) hudMod.requestPause(W); },
    pause: () => { if (hudMod.requestPause) hudMod.requestPause(W, true); },
    isPaused: () => !!W.paused,
  };
  // Four lifecycle boundaries, named as INERT NO-OPS. These are the four points any
  // portal integration is defined in terms of, and all four already exist as single
  // clean call sites in this file — begin() is the exact moment the player takes
  // control, endMatch the exact moment they lose it. Naming them now costs six
  // lines; deriving the lifecycle again later costs a re-read of the whole match
  // flow. The FIRST-PARTY portal bridge (achievement/save below) is wired per
  // the owner's progression directive; third-party integrations (SDKs, ad
  // networks, trackers) stay unwired until the owner opens that gate — those
  // need external accounts and send data off-machine.
  W.hooks = {
    loadingStart: () => {},
    loadingStop: () => {},
    gameplayStart: () => {},
    gameplayStop: () => {},
    // FIRST-PARTY portal bridge (owner-directed progression work, 2026-07-27:
    // "complete ... leaderboard progression"): postMessage to the
    // forgeflowgames.com player shell, same convention as the game_over emit
    // in endMatch — unlocks and cloud saves land in OUR registry for
    // signed-in accounts; guests and standalone play are harmless no-ops.
    // THIRD-PARTY SDKs/ads/trackers remain owner-gated and unwired.
    achievement: (slug) => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "forgeflow:achievement", achievementSlug: slug }, "*");
        }
      } catch (e) {}
    },
    save: (data) => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "forgeflow:save", data, slot: 1 }, "*");
        }
      } catch (e) {}
    },
  };

  // A phone or tablet: touch.js's live flag (C6, lane L10) when it exists, else a
  // coarse primary pointer on a device that reports touch points (a touch-screen
  // laptop with a mouse reports a FINE pointer and keeps the desktop profile).
  function isTouchDevice() {
    try { if (W.touch && W.touch.active) return true; } catch (e) {}
    try {
      return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) && (navigator.maxTouchPoints || 0) > 0;
    } catch (e) { return false; }
  }

  // ── unified graphics authority ──────────────────────────────────────────────
  // ONE place owns visual fidelity so the shell-kernel key (ffg_settings.quality)
  // and the LC key (lc_settings.graphics) can never diverge again. Applied at BOOT
  // (the previous LC "high" only took effect if you re-opened Settings and re-clicked)
  // and drives REAL fidelity per tier — DPR, shadow on/off, shadow-map resolution,
  // and texture anisotropy — not just supersampling. maps.js reads W._texAniso when
  // it builds the terrain/structure/water textures.
  W._texAniso = 4;
  W.applyGraphics = function (tier) {
    tier = tier || W.settings.graphics || "medium";
    const r = kernel.renderer;
    const DPR = { low: 1, medium: 1.5, high: 2 };
    const SHADOW = { low: 0, medium: 2048, high: 4096 };
    const ANISO = { low: 1, medium: 4, high: 8 };
    const BLOOM = { low: 0, medium: 0.14, high: 0.14 };
    // Draw-call knobs. Everything above scales FILL, and the frame is not fill
    // bound: the same view rendered at 64x36 cost 3.54 ms against 3.33 ms at
    // 1280x720 — deleting 99.9% of the pixels changed nothing — while 1280x720 to
    // 1920x1080 (5x the pixels) cost 1.7x the time. A full three-tier sweep on
    // ashgrid moved 319 calls / 4.06 ms to 276 / 3.08 ms, under 1 ms, because every
    // knob in the tables aims at a bottleneck that does not exist. These two are the
    // levers that actually remove submissions from the frame. The spread is kept
    // narrow on purpose (120-200 m, not 90-250 m): loot draw distance is competitive
    // information in a BR and the tier is player-selectable.
    const LOOT_CULL = { low: 120, medium: 150, high: 200 };
    const WPN_LOD   = { low: 70,  medium: 110, high: 160 };
    W.lootCull = LOOT_CULL[tier] || 150;
    W.wpnLOD = WPN_LOD[tier] || 110;
    const maxA = (r.capabilities && r.capabilities.getMaxAnisotropy) ? r.capabilities.getMaxAnisotropy() : 8;
    // DPR goes through the kernel's budget cap (C3: effective = max(0.5, min(device,
    // tier, BUDGET.dprMax 1.5))), which also re-sizes the composer's render targets —
    // EffectComposer only reads the renderer's ratio once, at construction.
    const touch = isTouchDevice();
    const dprEff = kernel.setDpr ? kernel.setDpr(DPR[tier] || 1.5) : (r.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR[tier] || 1.5)), r.getPixelRatio());
    const shadows = tier !== "low";
    r.shadowMap.enabled = shadows;
    // Shadow VOLUME lives here rather than in the vendored kernel literal, which
    // hard-codes a +/-80 m box (160 m) around world origin on a 1600 m map — about
    // 1% of the playable area had shadows at all, and the depth pass ran every
    // frame regardless. Tighter extents + a volume that FOLLOWS the player (see
    // the frame pipeline) means medium now looks better than high used to.
    // Then the extents overcorrected: sized for a fixed +/-80 m kernel box, 55 m
    // put the shadow boundary a visible three ground-planes away — a crisp fully-lit
    // circle around you — so no building on any map cast onto the ground it stands
    // on. Widening costs almost nothing: the casters are submitted every frame
    // whatever the extent (maps.js sizes each InstancedMesh to the whole 1600 m map,
    // so the +/-55 m frustum could never reject one), and rasterisation is bounded by
    // the fixed map resolution. Texel density stays finer than the old medium tier —
    // medium 220 m/2048 = 10.7 cm, high 300 m/4096 = 7.3 cm — for 2-3x the radius.
    // widened again 2026-07-27 (rescore held the visuals band partly on shadow
    // radius): high 160->220 (440 m span / 4096 = 10.7 cm/texel — exactly the
    // texel density medium shipped at, so quality precedent exists), medium
    // 110->150. normalBias 0.05 below is the walk-up the earlier comment
    // prescribed for wider extents.
    const SHADOW_EXT = { low: 55, medium: 150, high: 220 };
    if (shadows && kernel.sun) {
      const ext = SHADOW_EXT[tier] || 55;
      const sc = kernel.sun.shadow.camera;
      if (sc.right !== ext) {
        sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
        // far was 400, and Isla Viva's high ground already eats ~338 m of that
        // when you stand on it — one hill short of the whole depth pass going
        // dark. 600 leaves real headroom for the ground-anchored focus below.
        sc.near = 1; sc.far = 600;
        sc.updateProjectionMatrix();
      }
      // acne/peter-panning control — neither was ever set
      kernel.sun.shadow.bias = -0.0004;
      // normalBias is in WORLD units and was tuned against the old 5.4 cm texel;
      // at the wider extents above one texel covers ~2x the ground, so 0.02 no
      // longer clears self-shadow acne on the terrain. Walk it back toward 0.03 if
      // contact shadows detach from wall bases (peter-panning) when facing the sun.
      kernel.sun.shadow.normalBias = 0.05;   // one texel now covers ~1.4x the ground of the 160 m tune
      W._shadowExt = ext;
      if (!kernel.sun.target.parent) W.scene.add(kernel.sun.target);
      // TOUCH PROFILE (CONTRACT_MOBILE M7): a phone/tablet GPU shares memory and
      // thermals with everything else, so the shadow map is capped at 1024 there
      // whatever tier is picked (a 2048 map is 16 MB of depth for a ~6" screen).
      // Anti-aliasing is already off on every device (the kernel builds the
      // renderer with antialias:false and the composer's RT is single-sampled), so
      // the "AA off at DPR >= 2" rule holds without a switch here.
      const sz = Math.min(SHADOW[tier] || 2048, touch ? 1024 : Infinity);
      if (kernel.sun.shadow.mapSize.x !== sz) {
        kernel.sun.shadow.mapSize.set(sz, sz);
        if (kernel.sun.shadow.map) { kernel.sun.shadow.map.dispose(); kernel.sun.shadow.map = null; }
      }
    }
    r.shadowMap.needsUpdate = true;
    W._texAniso = Math.min(ANISO[tier] || 4, maxA);
    // push anisotropy onto already-built textures. Only a texture whose value
    // actually CHANGES is flagged for re-upload: this runs once per match start,
    // and flagging every texture in the scene re-uploaded all of them each time.
    W.scene.traverse((o) => {
      const m = o.material; if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mm of mats) for (const slot of ["map", "normalMap", "roughnessMap", "emissiveMap"]) {
        const t = mm[slot];
        if (t && t.anisotropy !== W._texAniso) { t.anisotropy = W._texAniso; t.needsUpdate = true; }
      }
    });
    W._gfx = { tier, dpr: dprEff, touch, shadows, shadowMap: shadows && kernel.sun ? kernel.sun.shadow.mapSize.x : 0, aa: false };
    // Bloom was the one fidelity knob the tier tables never touched: "low"
    // disabled shadows and dropped DPR to 1 but still paid for the full
    // UnrealBloomPass blur chain every frame, even though maps.js turns match
    // bloom down to 0.14 where it is nearly invisible. EffectComposer skips a
    // pass whose `enabled` is false, so the composer stays allocated and
    // medium/high keep the menu's 0.45-strength storm-ring glow. kernel.bloom
    // only exists once the menu world has called enableBloom, hence the guard —
    // the BOOT-time applyGraphics() below runs before that, and the per-match
    // re-apply in _startMatch is what actually lands the low tier's setting.
    if (kernel.bloom) kernel.bloom.enabled = (BLOOM[tier] || 0) > 0;
    // keep the kernel's own quality key in sync (shell buttons + next boot)
    try { const s = JSON.parse(localStorage.getItem("ffg_settings") || "{}"); s.quality = tier === "medium" ? "med" : tier; localStorage.setItem("ffg_settings", JSON.stringify(s)); } catch (e) {}
  };
  W.applyGraphics();          // BOOT-apply the stored tier (the fix)

  // Snapshot the kernel's DEFAULT match lighting now, before the cinematic menu
  // (buildMenuWorld) warms the sun to golden-hour + raises exposure. buildMap
  // restores these each match so every map shows its own daylight, not menu light.
  W._lightDefaults = {
    sunIntensity: kernel.sun.intensity,
    sunColor: kernel.sun.color.getHex(),
    sunPos: kernel.sun.position.clone(),
    exposure: kernel.renderer.toneMappingExposure,
  };

  // ── shadow volume follows the player ────────────────────────────────────────
  // The kernel points its sun at (0,0,0) and nothing ever moved the target, so
  // the shadow box sat over world origin for the whole match. Keep the same sun
  // DIRECTION (offset captured per match, since buildMap re-aims the sun for
  // each map's daylight) and slide the volume with the camera focus. The centre
  // is snapped to whole shadow-texel steps or the map shimmers as you walk.
  const _sunFocus = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();
  let _shadowBeat = 0;
  // Every way out of a match (teardown, menu, error recovery) hands the shadow
  // map back to per-frame updates; the glide cadence only ever runs in a drop.
  function shadowsEveryFrame() {
    const sm = kernel.renderer.shadowMap;
    if (!sm.autoUpdate) { sm.autoUpdate = true; sm.needsUpdate = true; }
  }
  function followShadow() {
    const sun = kernel.sun;
    if (!sun || !sun.castShadow || !W._sunOff) return;
    const f = W._camFocus || W.player;
    if (!f) return;
    const ext = W._shadowExt || 55;
    const texels = (sun.shadow.mapSize && sun.shadow.mapSize.x) || 2048;
    // Anchor the volume's HEIGHT to the terrain under the focus, not to the
    // focus itself. The glider drop starts at 240-270 m, and the sun offset is
    // only ~169 m long, so following the player's raw Y lifted the whole shadow
    // camera above the world and the entire descent — the part of the match you
    // spend looking straight down at the map — rendered with no shadows at all.
    const gy = W.map && W.map.groundAt ? W.map.groundAt(f.pos.x, f.pos.z) : 0;
    // ALTITUDE-ADAPTIVE EXTENT: at ground level the tier extent covers
    // everything a shadow can visibly resolve (beyond it, detail is
    // sub-pixel), but the drop/glide looks straight DOWN from 250+ m and the
    // world outside the disc read as shadowless — the one view where the
    // benchmark's 700 m cascades actually showed. Widen with height above
    // ground; texel density falls as you rise, which is perceptually correct
    // from altitude, and the volume snaps back to the sharp tier extent on
    // landing. The 8% hysteresis keeps updateProjectionMatrix off the
    // per-frame path during level flight.
    // CAPPED at +120 m (2026-10 frame-pipeline audit): uncapped, a 250 m drop
    // widened the box to the 620 m ceiling, every caster on that disc went
    // through the depth pass, and character shadows were 86.5% of the drop
    // frame's 9.9 M triangles. The capped box is spent where the camera looks
    // (the LOOK-AHEAD below), not on the ground behind and beneath you.
    const agl = Math.max(0, f.pos.y - gy);
    const wantExt = Math.min(620, ext + (agl > 40 ? Math.min(120, (agl - 40) * 2.4) : 0));
    // GLIDE CADENCE: high above the ground nothing in the shadow map moves fast
    // enough on screen to need a fresh depth pass every frame, so above 40 m AGL
    // during the drop it is redrawn every 3rd frame (renderer.shadowMap.autoUpdate
    // off + needsUpdate on the beat). The light matrices are only re-derived when
    // the map is redrawn, so a skipped frame samples a map that matches its own
    // matrix: shadows lag by at most 2 frames, they never detach.
    const sm = kernel.renderer.shadowMap;
    if (agl > 40 && (W.phase === "drop" || f.gliding)) {
      if (sm.autoUpdate) { sm.autoUpdate = false; sm.needsUpdate = true; _shadowBeat = 0; }
      else if (++_shadowBeat % 3 === 0) sm.needsUpdate = true;
    } else if (!sm.autoUpdate) { sm.autoUpdate = true; sm.needsUpdate = true; }
    const sc = sun.shadow.camera;
    if (Math.abs(sc.right - wantExt) > wantExt * 0.08) {
      sc.left = -wantExt; sc.right = wantExt; sc.top = wantExt; sc.bottom = -wantExt;
      sc.updateProjectionMatrix();
    }
    // LOOK-AHEAD while high: from 250 m up the camera looks forward and down, so
    // the ground on screen starts ~180 m AHEAD of the point under the player and a
    // box centred under you spent most of its area off-screen behind you. Slide
    // the centre along the camera's horizontal heading by up to 3/4 of the extent;
    // the lead is 0 at 40 m AGL, so it hands back to the walking box continuously.
    let cx = f.pos.x, cz = f.pos.z, cgy = gy;
    if (agl > 40 && W.camera) {
      W.camera.getWorldDirection(_camFwd);
      const hl = Math.hypot(_camFwd.x, _camFwd.z);
      if (hl > 1e-3) {
        const lead = Math.min(sc.right * 0.75, (agl - 40) * 1.2);
        cx += (_camFwd.x / hl) * lead; cz += (_camFwd.z / hl) * lead;
        cgy = W.map && W.map.groundAt ? W.map.groundAt(cx, cz) : gy;
      }
    }
    const step = (sc.right * 2) / texels;
    _sunFocus.set(Math.round(cx / step) * step, Math.min(f.pos.y, cgy + 8), Math.round(cz / step) * step);
    sun.target.position.copy(_sunFocus);
    sun.target.updateMatrixWorld();
    sun.position.copy(_sunFocus).add(W._sunOff);
  }

  // ── match lifecycle ─────────────────────────────────────────────────────────
  async function startMatch(opts) {
    // re-entrancy guard: this function clears the world and then awaits (map
    // build, model load). A second call landing inside those awaits clears
    // nothing the first one has yet to add, so the two interleave and the
    // match ends up with two full rosters of actors. Double-fire is reachable
    // from a fast double-click on PLAY / PLAY AGAIN.
    if (W._starting) return;
    W._starting = true;
    hideMatchNotice();
    try {
      return await _startMatch(opts || {});
    } catch (err) {
      // THE choke point for all three callers (menu mode cards, PLAY AGAIN, a
      // SQUAD UP room start). A GLB that 404s or never answers used to leave the
      // player on "LOADING OPERATIVES 0/90" for good, because nothing caught the
      // rejection; now it is a way back to the menu with the reason on screen.
      return matchLoadFailed(err);
    } finally { W._starting = false; }
  }

  /** Per-match teardown (contract C8), shared by the next match start, a failed
   *  load and the error card's MAIN MENU. Idempotent: every disposeMatch is safe
   *  to call twice, and an empty roster makes the actor walk a no-op. */
  function teardownMatch() {
    const out = {};
    // DISPOSE BEFORE DROPPING THE ROSTER: every actor registers an
    // AnimationMixer with the kernel, and the kernel only ever removes one on an
    // explicit disposeMixer. Clearing the group detaches the meshes but leaves
    // the mixers in the per-frame update list, so each match played added ~50
    // more skeletons to tick — frame time degraded monotonically, match over
    // match, with no in-game recovery. Nametags are per-actor CanvasTextures
    // and leak the same way.
    for (const a of W.actors) {
      if (a.rig && a.rig.mixer && kernel.disposeMixer) kernel.disposeMixer(a.rig.mixer);
      const tag = a.nameTag;
      if (tag && tag.material) {
        if (tag.material.map) tag.material.map.dispose();
        tag.material.dispose();
      }
      // Bone textures (Skeleton.boneTexture, one per skinned actor) were the
      // biggest leak in the Stage-0 census: +60 / +49 textures per match. L5's
      // player.disposeMatch owns this; until it exists, free them here.
      // Skeleton.dispose() is idempotent (it nulls boneTexture).
      if (!playerMod.disposeMatch && a.obj) {
        a.obj.traverse((o) => { if (o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture) o.skeleton.dispose(); });
      }
    }
    // every module's own teardown (C8), while the groups and the roster still
    // hold what it must find
    for (const [name, mod] of MATCH_MODS) {
      if (!mod || typeof mod.disposeMatch !== "function") continue;
      try { out[name] = mod.disposeMatch(W); } catch (e) { console.warn("[royale] " + name + ".disposeMatch threw:", e); out[name] = { error: String(e && e.message || e) }; }
    }
    // The fallbacks below are the pre-C8 paths. Both disposers are idempotent per
    // build, so after maps/loot.disposeMatch they return zeros.
    // free the PREVIOUS map's GPU resources before detaching them (clear() only
    // unparents — geometries, materials and per-match textures stayed resident)
    W._lastMapDispose = disposeMapResources(W);
    W._lastLootDispose = lootMod.disposeLootResources ? lootMod.disposeLootResources(W) : null;
    // The storm wall is the one per-match GPU object no module frees: storm.js
    // builds a fresh CanvasTexture + cylinder + material every match (storm.js:41).
    if (!stormMod.disposeMatch) {
      const sc = W.stormCtl;
      if (sc && !sc._disposed) {
        sc._disposed = true;
        try {
          if (sc.tex) sc.tex.dispose();
          if (sc.wall) { if (sc.wall.geometry) sc.wall.geometry.dispose(); if (sc.wall.material) sc.wall.material.dispose(); }
        } catch (e) {}
      }
    }
    for (const name in W._groups) { const g = W._groups[name]; if (name !== "menu3d") g.clear(); }
    W.actors.length = 0; W.actorById.clear();
    W.rangeDummies = null;          // stale refs into the cleared roster
    if (!botsMod.disposeMatch) botsMod.resetBrains();
    if (!weaponsMod.disposeMatch) weaponsMod.reset(W);   // live rounds otherwise fly on into the next match
    if (!fxMod.disposeMatch) fxMod.reset();               // damage numbers are DOM nodes; they outlive the match
    if (W.resetInputState) W.resetInputState();
    shadowsEveryFrame();
    W._lastTeardown = out;
    return out;
  }

  // ── match-load failure: back to the menu, with a notice ─────────────────────
  function matchLoadFailed(err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.error("[royale] the match failed to load:", err);
    W.lastMatchError = { message: msg, t: Math.round(performance.now()) };
    try { teardownMatch(); } catch (e) { console.warn("[royale] teardown after a failed load threw:", e); }
    try { W.hooks.loadingStop(); } catch (e) {}
    if (W.net) { try { netMod.leave(W); } catch (e) {} }
    removeLoadingLayer();
    W.paused = false;
    try {
      hudMod.showMenu(W, startMatch);
    } catch (e) {
      // the menu itself could not be built: this is the frame-error card's job
      console.error("[royale] showMenu after a failed load threw:", e);
      if (kernel.onError) kernel.onError(e, { kind: "menu" });
      return { ok: false, error: msg };
    }
    W.phase = "menu";
    if (kernel.start && !kernel._running && !kernel.contextLost) kernel.start();
    showMatchNotice("Couldn't load the match - check your connection", msg);
    return { ok: false, error: msg };
  }

  /** hud.showMenu removes the match layers but NOT the loading screen (only
   *  showLobby does), so a load that fails under it would leave the menu buried.
   *  hud.hideLoading (lane L7) when it exists; otherwise the loading layer is found
   *  by its data-lc="loadfill" hook — the hud layer that is a child of hud's root,
   *  which is itself a child of the kernel's container. */
  function removeLoadingLayer() {
    if (typeof hudMod.hideLoading === "function") { try { hudMod.hideLoading(W); return; } catch (e) {} }
    // W.loadProgress cancels hud's creep interval as its first act (hud.js showLoading)
    if (typeof W.loadProgress === "function") { try { W.loadProgress(0, 1); } catch (e) {} }
    W.loadProgress = null;
    const host = kernel.parent;
    let n = document.querySelector('[data-lc="loadfill"]');
    while (n && n.parentElement && n.parentElement.parentElement !== host) n = n.parentElement;
    if (n && n.parentElement && n.parentElement.parentElement === host) n.remove();
  }

  /** A dismissable notice over the menu (the menu stays usable underneath). It is
   *  inserted FIRST in <body> so assistive tech and text scrapers meet it before the
   *  menu, and into the fullscreen element when one is up, or it would be hidden. */
  function showMatchNotice(title, detail) {
    hideMatchNotice();
    const fs = document.fullscreenElement;
    const host = fs && fs !== document.documentElement && fs !== document.body ? fs : document.body;
    if (!host) return null;
    const el = document.createElement("div");
    el.id = "lc-match-notice";
    el.setAttribute("role", "alert");
    el.style.cssText = "position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483000;" +
      "max-width:min(560px,calc(100vw - 32px));box-sizing:border-box;padding:14px 18px;border-radius:10px;text-align:center;" +
      "background:rgba(40,14,14,0.94);border:1px solid rgba(255,120,100,0.55);box-shadow:0 8px 28px rgba(0,0,0,0.5);" +
      "color:#ffe2dc;font:600 15px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;pointer-events:auto";
    const t = document.createElement("div");
    t.textContent = title;
    t.style.cssText = "font-weight:800;letter-spacing:.3px";
    const d = document.createElement("div");
    d.textContent = detail ? String(detail).slice(0, 220) : "";
    d.style.cssText = "margin-top:4px;font-weight:500;font-size:12px;opacity:.75;word-break:break-word";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "OK";
    b.style.cssText = "margin-top:10px;min-width:88px;min-height:44px;padding:8px 20px;border:0;border-radius:8px;cursor:pointer;" +
      "background:#ff8f6a;color:#1a0804;font:800 14px system-ui,sans-serif;letter-spacing:1px";
    b.onclick = hideMatchNotice;
    el.appendChild(t);
    if (d.textContent) el.appendChild(d);
    el.appendChild(b);
    host.insertBefore(el, host.firstChild);
    return el;
  }
  function hideMatchNotice() {
    const el = document.getElementById("lc-match-notice");
    if (el) el.remove();
  }

  // ── frame / context-loss errors (contract C2): the royale error card ────────
  // The kernel's loop catch (and webglcontextlost) dispatch here. A frame throw
  // gets MAIN MENU (tear the match down and rebuild the menu on a restarted loop)
  // and RELOAD; a lost context gets RELOAD only — every GPU resource is gone, and
  // the kernel reloads by itself when the context comes back.
  function showErrorCard(err, info) {
    const lost = !!(info && info.kind === "contextlost");
    const title = lost ? "Graphics were interrupted" : "Something went wrong";
    const detail = lost
      ? "The browser reset the graphics (this happens on phones and in background tabs). The game reloads when they come back, or press RELOAD."
      : "The game stopped on an error: " + (err && err.message ? err.message : String(err)) + ". MAIN MENU tries to carry on; RELOAD starts fresh.";
    const reload = () => { try { location.reload(); } catch (e) {} };
    const actions = lost ? [{ label: "RELOAD", onClick: reload }] : [{ label: "MAIN MENU", onClick: recoverToMenu }, { label: "RELOAD", onClick: reload }];
    W._errorCard = { title, kind: (info && info.kind) || "error", t: Math.round(performance.now()) };
    const B = window.__LC_BOOT__;
    if (B && typeof B.fail === "function") {
      try { B.fail(title, detail, actions); } catch (e) { console.error("[royale] __LC_BOOT__.fail threw:", e); }
      if (document.getElementById("lc-fail")) return;
    }
    paintErrorCard(title, detail, actions);
  }
  function paintErrorCard(title, detail, actions) {
    if (document.getElementById("lc-error-card")) return;
    const card = document.createElement("div");
    card.id = "lc-error-card";
    card.setAttribute("role", "alertdialog");
    card.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;" +
      "background:rgba(6,13,22,0.92);font:14px/1.6 system-ui,sans-serif;color:#cfe3f5;z-index:2147483600;pointer-events:auto";
    const box = document.createElement("div");
    box.style.cssText = "max-width:420px";
    const h = document.createElement("div");
    h.style.cssText = "font:700 18px/1.3 system-ui,sans-serif;color:#e8f4ff;margin-bottom:10px";
    h.textContent = title;
    const p = document.createElement("div");
    p.style.cssText = "margin-bottom:18px;word-break:break-word";
    p.textContent = detail;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:12px;justify-content:center;flex-wrap:wrap";
    actions.forEach((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.style.cssText = "min-height:44px;padding:11px 22px;border:0;border-radius:8px;cursor:pointer;font:700 14px system-ui,sans-serif;" +
        (i === 0 ? "background:#2f9e6e;color:#04140d" : "background:rgba(255,255,255,0.14);color:#eaf2ff");
      b.onclick = () => { card.remove(); a.onClick(); };
      row.appendChild(b);
    });
    box.appendChild(h); box.appendChild(p); box.appendChild(row);
    card.appendChild(box);
    (document.body || document.documentElement).insertBefore(card, document.body ? document.body.firstChild : null);
  }
  function recoverToMenu() {
    try {
      if (W._overT) { clearTimeout(W._overT); W._overT = null; }
      W._winHold = false;
      teardownMatch();
      if (W.net) netMod.leave(W);
      // hud.showMenu removes the HUD / death / post-match layers but not the pause,
      // settings or loading layers; showLoading clears every match screen (its own
      // list) and the loading layer it adds is removed straight after.
      try { hudMod.showLoading(W, ""); } catch (e) {}
      removeLoadingLayer();
      W.paused = false;
      hudMod.showMenu(W, startMatch);
      W.phase = "menu";
      W._errorCard = null;
      if (kernel.start && !kernel._running) kernel.start();
    } catch (e) {
      console.error("[royale] MAIN MENU recovery failed:", e);
      try { location.reload(); } catch (x) {}
    }
  }
  if (typeof kernel.onError === "function") kernel.onError(showErrorCard);
  // hud.js's MAIN MENU path has to run the SAME disposal the match teardown
  // does, but it cannot import maps.js/loot.js without creating a second
  // uninitialized module copy — so hand it the functions instead of the modules.
  W._disposeMap = disposeMapResources;
  W._disposeLoot = (w) => (lootMod.disposeLootResources ? lootMod.disposeLootResources(w) : null);

  async function _startMatch(opts) {
    opts = opts || {};
    W.mapId = opts.mapId || W.mapId;
    W.mode = opts.mode || W.mode;
    W.seed = opts.seed != null ? opts.seed : ((Math.random() * 0xffffffff) >>> 0);
    W.rng = SIM.mulberry32(W.seed);
    W.t = 0;
    W.phase = "lobby";
    W.paused = false;
    // The challenge pool could only ever read three numbers — W.t, match.kills,
    // match.damage — which is why it was five cards deep. Every counter added here
    // is one increment on an event that already fires (hud.js wireEvents), so an
    // expanded objective set needs no new instrumentation anywhere in the sim.
    W.stats = { shotsFired: 0, shotsHit: 0, heads: 0, chests: 0, heals: 0, stormDmg: 0, legendaries: 0, longestKillM: 0, killsByCls: {} };
    // Feel state lives on W, not inside a module's reset() — fx.js reset() takes no
    // W argument (fx.js:197), so there is nowhere else that can clear it. Dying
    // inside an explosion leaves residual camShake behind, and nothing decays it
    // while the post-match panel and the menu are up (the frame gate returns before
    // fx.update on phase "menu"), so the NEXT match opened already shaking.
    W.camShake = 0; W.fovPunch = 0; W.hitstopT = 0;
    W._winHold = false; W._winOrbit = 0; W._winDist = 0;
    W._reportedMatch = false;   // portal leaderboard bridge fires once per match

    // clear the previous world (every module's disposeMatch, the roster, the
    // groups). The menu diorama group is left to hud's teardownMenuWorld (run by
    // showLoading below), which DISPOSES it — clearing it here first left that
    // teardown an empty group, so every PLAY from the menu orphaned its GPU objects.
    teardownMatch();
    // Decide lobby difficulty ONCE, before any brain attaches (see setLobbySkill).
    botsMod.setLobbySkill(W);

    // build the world
    W.hooks.loadingStart();
    hudMod.showLoading(W, "Building " + (MAPS[W.mapId] ? MAPS[W.mapId].name : W.mapId) + "…");
    await nextFrame(); // let the loading screen paint
    W.map = await buildMap(W, W.mapId);
    // buildMap re-aims the sun per map. Reset the TARGET to origin first: this
    // subtracted `sun.target.position`, which followShadow had parked at the
    // previous match's player location — a median ~178 m from origin. So from
    // match 2 onward every map was lit from a low raking angle in a random
    // compass direction instead of its intended near-noon key, and when that
    // stale focus exceeded the shadow camera's far plane the match rendered
    // with no shadows at all. Only correct on the first match of a session.
    kernel.sun.target.position.set(0, 0, 0);
    kernel.sun.target.updateMatrixWorld();
    W._sunOff = kernel.sun.position.clone();

    const modeK = SIM.MODE[W.mode] || SIM.MODE.standard;
    // teamOf is resolved LAZILY, at elimination time: the actors it reads are
    // created below this line, so a table built here would be empty. Without a
    // team-aware win condition, friendly-fire suppression hangs the match forever
    // at two surviving squadmates — Match.eliminate ends on one team left, and with
    // no resolver every player is their own team (sim/royale.js:499-506).
    W.match = new SIM.Match({
      players: modeK.players, mode: W.mode,
      teamOf: (id) => { const a = W.actorById.get(id); return (a && a.teamId) || id; },
    });
    W.stormCtl = stormMod.createStorm(W);
    lootMod.populate(W);

    // actors: slot-based ids s0..s49 — online play maps humans onto slots
    // (each joining friend takes over a bot slot; disconnect re-attaches a brain)
    const total = W.mode === "practice" ? 1 : modeK.players;
    const names = shuffledNames(W);
    const humans = opts.humans || [{ slot: 0, name: W.settings.playerName || "You", self: true }];
    for (let i = 0; i < total; i++) {
      const hu = humans.find((x) => x.slot === i);
      if (hu) {
        // Every human in the lobby is one squad. A solo match has exactly one human,
        // so teamId stays null and teamOf falls back to the actor's own id —
        // nothing about offline play changes.
        const a = playerMod.createActor(W, { id: "s" + i, name: hu.name, isBot: false, teamId: humans.length > 1 ? "sq" : null });
        a.netRemote = !hu.self;
        if (hu.self) W.player = a;
      } else {
        const bot = playerMod.createActor(W, { id: "s" + i, name: names[i % names.length], isBot: true });
        // bots simulate on the authority only; on guest clients they're remote
        if (opts.guestOf) bot.netRemote = true;
        else botsMod.attachBrain(W, bot, total - humans.length);
      }
      W.match.register("s" + i);
    }
    // practice range dummies must exist BEFORE models load or they get no rig
    if (W.mode === "practice") playerMod.createPracticeRange(W);
    await playerMod.loadActorModels(W);
    // Weapon view-models are built once per page (weapons.js protos) and every
    // held and floor gun is a clone of them. Nothing waited for them, so with the
    // 15k-triangle bodies loading fast the guns popped into the drop 3.6-10.2 s
    // late, and their programs compiled on the frame they first appeared. Wait for
    // them here, bounded, so a missing gun file can never hold the match hostage
    // (each GLB already has the kernel's 30 s timeout; buildProtos skips a failed one).
    if (W.weaponProto) {
      try { await withTimeout(W.weaponProto("pistol"), 20000); } catch (e) { console.warn("[royale] weapon models not ready:", e && e.message); }
    }
    W.hooks.loadingStop();          // last asset fetch of the match is done here
    // Re-apply the tier now that the map's textures and the actor GLBs are in
    // the scene. applyGraphics only ever ran at BOOT and on a Settings click, and
    // its anisotropy pass is a one-shot traverse of whatever is in the scene at
    // that moment — so every character and prop texture loaded afterwards kept
    // the GLTFLoader default of 1, and "high" only ever sharpened the terrain.
    // The kernel caches by URL and clones share texture objects, so one traverse
    // here fixes every present and future clone of those assets.
    W.applyGraphics(W.settings.graphics);

    playerMod.spawnAll(W);          // positions actors (glider line or ground by mode)
    if (W.mode === "practice") playerMod.placePracticeRange(W);  // ...then line the range up
    // Warm the shader cache while the loading screen is already up (contract C7).
    // Compilation is SYNCHRONOUS inside the render call, so every program first
    // met on screen was a frame spike in the drop — the first 30 seconds a new
    // player judges the game on — and the lobby could not answer Enter for
    // 4.3-9.2 s while those frames ran. The old warm-up (compileAsync on the
    // canvas) compiled the wrong variant: every scene draw goes into the bloom
    // composer's render target, and three keys programs on the target. Measured:
    // still 24-27 new programs on drop frame 1. ffg_warmup.js compiles against the
    // composer's RT and runs ONE real composer frame (shadow depth, bloom, output,
    // uploads) with everything forced visible, then restores the scene exactly.
    // Sits after spawnAll (rigs posed) and before showLobby (loading layer up).
    await warmMatch();
    botsMod.assignDrops(W);
    hudMod.showLobby(W, () => {     // lobby → drop select → drop
      const begin = () => {
        W.phase = W.mode === "practice" ? "match" : "drop";
        W.hooks.gameplayStart();    // drop-select closed; the player has control
        hudMod.showHUD(W);
        audioMod.startMatchMusic(W);
        if (W.net) netMod.onMatchStart(W);
      };
      // NO LANDING-ZONE MAP (owner direction 2026-09-15: "i dont want the MAP to
      // come up ... I want to just drop straight in when joining a match"). The
      // glide is untouched — you still steer the whole way down — only the
      // pick-a-spot screen is gone. The zone is chosen for you by
      // playerMod.autoDropTarget, which is exactly what the old screen did when
      // its timer expired: the quietest named POI. hudMod.showDropSelect is left
      // defined but UNCALLED so the screen can be restored by reinstating this
      // one branch.
      if (modeK.drop === "glider" && W.mode !== "practice") {
        const lz = playerMod.autoDropTarget(W);
        if (lz) playerMod.setDropTarget(W, lz); else W.dropTarget = null;
      } else {
        W.dropTarget = null;                     // ground modes: no LZ marker
      }
      begin();
    });
  }

  /** C7 warm-up. Extras are objects the match creates LATER (a chute, LOD1
   *  bodies, FX pools) plus the weapon and pickup prototypes, which are never in
   *  the scene themselves (only clones are) — warmup parents them for the one
   *  frame and removes them again. Every provider is feature-detected. */
  async function warmMatch() {
    const extras = [];
    const add = (list, who) => {
      if (!list) return;
      for (const o of list) if (o && o.isObject3D) extras.push(o);
    };
    try { if (typeof playerMod.warmObjects === "function") add(playerMod.warmObjects(W), "player"); } catch (e) { console.warn("[royale] player.warmObjects threw:", e); }
    try { if (typeof fxMod.warmObjects === "function") add(fxMod.warmObjects(W), "fx"); } catch (e) { console.warn("[royale] fx.warmObjects threw:", e); }
    if (W._weaponProtos) for (const k in W._weaponProtos) add([W._weaponProtos[k]]);
    // pickup models (medkit, bandage, shield potions): already requested by
    // loot.populate; a bounded wait lets the ones that answer join the warm frame
    if (W.itemProto) {
      try {
        const ids = ["medkit", "bandage", "mini_shield", "big_shield"];
        const got = await withTimeout(Promise.all(ids.map((id) => W.itemProto(id).catch(() => null))), 8000);
        add(got);
      } catch (e) { /* bounded wait: the fallback capsules are already warm */ }
    }
    let stats = null;
    try {
      if (typeof kernel.warmup === "function") stats = await kernel.warmup({ extras });
      else {
        // pre-C7 kernel: the old canvas-variant compile + fx's own pool warm
        if (fxMod.prewarm) fxMod.prewarm(W);
        if (kernel.renderer.compileAsync) await kernel.renderer.compileAsync(W.scene, W.camera);
        else kernel.renderer.compile(W.scene, W.camera);
      }
    } catch (e) {
      // an optimisation only — never block a match start on it
      console.warn("[royale] warm-up failed (the match starts cold):", e);
    }
    W._warm = stats ? Object.assign({ extrasIn: extras.length }, stats) : { extrasIn: extras.length, legacy: typeof kernel.warmup !== "function" };
    return W._warm;
  }

  function endMatch(victory) {
    if (W.phase === "over") return;
    W.phase = "over";
    W.hooks.gameplayStop();
    const placement = W.match.placementOf(W.player.id) || W.match.aliveCount() + 1;
    // Hold the live world for a beat first. showPostMatch calls hideHUD(), which
    // removes the layer the announcement lives in — so the banner and kill feed
    // for the WINNING kill were created and destroyed in the same frame and the
    // match cut straight from a firefight to a DOM panel. Phase "over" is
    // already whitelisted in the frame gate and already blocks all damage.
    hudMod.announceVictory(W, victory);
    audioMod.onMatchEnd(W, victory);
    // The most-screenshotted moment of the match was that banner over a motionless
    // world — the winner stood still while text sat on top of him. The 2600 ms hold
    // below is already paid for, so spend it: _winHold drives the camera orbit in
    // the frame pipeline, and the cheer is the clip already bound to the emote wheel,
    // replayed through the exact path net.js uses for a peer's emote.
    // fxMod.fireworks is called defensively — it lands in fx.js alongside this and a
    // throw inside a bare setTimeout would take the victory beat down with it.
    if (victory && W.player && W.player.alive) {
      W._winHold = true;
      if (W.playRemoteEmote) W.playRemoteEmote(W.player, "cheer");
      const wp = W.player.pos;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          if (W.phase === "over" && fxMod.fireworks) fxMod.fireworks(W, wp.x + (i - 1.5) * 3, wp.y + 12, wp.z + (i % 2 ? 2.5 : -2.5));
        }, 180 + i * 420);
      }
    }
    // clears its own handle FIRST: after the natural 2600 ms fire, _overT
    // otherwise still holds the dead-but-truthy timer id, and a key pressed in
    // the 2600-2700 ms window made skip() build the post-match panel TWICE
    // (sweep finding)
    const showStats = () => { W._overT = null; hudMod.showPostMatch(W, buildPostMatch(victory, placement)); };
    if (W._overT) clearTimeout(W._overT);
    W._overT = setTimeout(showStats, 2600);
    // any key/click skips the beat
    const skip = () => { if (W._overT) { clearTimeout(W._overT); W._overT = null; showStats(); } cleanup(); };
    const cleanup = () => { window.removeEventListener("keydown", skip); window.removeEventListener("mousedown", skip); };
    window.addEventListener("keydown", skip); window.addEventListener("mousedown", skip);
    setTimeout(cleanup, 2700);
  }
  function buildPostMatch(victory, placement) {
    // W.t is match WALL-CLOCK and keeps advancing while you SPECTATE — the frame
    // loop only stops it on phase "over". So dying at 0:45 of a 12:55 match printed
    // "Survived 12:55", paid timeS/4 XP for twelve minutes of watching, and banked
    // all of it into career.timeAliveS (the lifetime hours on the menu). Match
    // .eliminate already stamps the true time into the feed (sim/royale.js:502);
    // the winner never appears there, so the W.t fallback is right for a victory.
    const elim = W.match.feed.find((f) => f.victim === W.player.id);
    // PORTAL BRIDGE (same convention as cosmic-coils): the game holds no
    // auth/DB code — the forgeflowgames.com player shell listens for
    // forgeflow:game_over (src/lib/gameBridge.ts:126) and upserts
    // leaderboard_scores best-of-week for SIGNED-IN accounts; guests and
    // standalone (window.parent === window) are harmless no-ops. Score:
    // placement dominates, kills pay, a victory crowns —
    // (50-placement)*100 + kills*200 + victory*1500, max ~14k.
    if (!W._reportedMatch) {
      W._reportedMatch = true;
      try {
        if (window.parent && window.parent !== window) {
          const sc = (50 - Math.min(50, Math.max(1, placement))) * 100 +
                     (W.match.kills[W.player.id] || 0) * 200 + (victory ? 1500 : 0);
          window.parent.postMessage({ type: "forgeflow:game_over", score: sc }, "*");
        }
      } catch (e) {}
    }
    return {
      victory,
      placement,
      kills: W.match.kills[W.player.id] || 0,
      damage: Math.round(W.match.damage[W.player.id] || 0),
      accuracy: W.stats.shotsFired ? Math.round((W.stats.shotsHit / W.stats.shotsFired) * 100) : 0,
      timeS: Math.round(elim ? elim.t : W.t),
      onMenu: () => { W.phase = "menu"; netMod.leave(W); shadowsEveryFrame(); hudMod.showMenu(W, startMatch); },
      // requeue straight into a fresh match (new random map, same mode) without
      // rebuilding the cinematic menu world and re-reading the skin GLBs
      onAgain: () => { netMod.leave(W); startMatch({ mapId: hudMod.randomMap(), mode: W.mode }); },
    };
  }
  W.endMatch = endMatch;

  // ── frame pipeline ──────────────────────────────────────────────────────────
  // Per-module profiler marks (contract C3), nested inside the kernel's own
  // "updaters" section. Only with ?prof=1: without it PROF is null and the frame
  // makes no profiler call at all.
  const PROF = kernel.prof && kernel.prof.enabled ? kernel.prof : null;
  kernel.onUpdate((dt) => {
    // cinematic menu world (orbit cam, water, storm ring, particles)
    if (W.phase === "menu") {
      if (PROF) PROF.begin("menu");
      hudMod.updateMenuWorld(W, Math.min(dt, 0.05));
      if (PROF) PROF.end("menu");
      return;
    }
    if (W.paused) return;
    if (W.phase !== "match" && W.phase !== "drop" && W.phase !== "over") return;
    // Victory hold: ~120° of orbit and a slow pull-back across the 2600 ms beat
    // endMatch already pays for. Read by player.js updateCamera — the winning
    // frame used to be a 34 px banner over a motionless world at the default
    // third-person 4.2 m.
    if (W._winHold) {
      W._winOrbit = (W._winOrbit || 0) + Math.min(dt, 0.05) * 0.8;
      W._winDist = Math.min(1.3, (W._winDist || 0) + Math.min(dt, 0.05) * 0.55);
    }
    const real = Math.min(dt, 0.05);
    let step = real;
    // HITSTOP — the one Vlambeer technique this build shipped none of; nothing in
    // runtime/ scaled frame dt on impact (the only timeScale-shaped code was the
    // animation-mixer LOD in player.js). SOLO ONLY: net.js broadcasts at 12 Hz and
    // the host swaps a silent guest for a bot after 12 s, so slowing the sim on one
    // client drifts it off the link and reads as a dropout. Decremented with the
    // REAL dt so the freeze is the same wall-clock length whatever scale is applied.
    // It scales SIM time only (feel G14; BLOCKTOOTH loop.ts: "timeScale scales SIM
    // time only. Rendering always runs"): fx, hud and audio get the real dt, so a
    // kill's damage number, marker and shake keep moving through the freeze.
    // player.update still holds the camera and gets the sim step until lane L5
    // splits it (C5); W.frameDt is the real dt for that split to read.
    if (W.hitstopT > 0) {
      W.hitstopT = Math.max(0, W.hitstopT - dt);
      if (!W.net) step *= 0.12;
    }
    W.frameDt = real;
    followShadow();
    if (W.phase !== "over") W.t += step;

    if (PROF) PROF.begin("bots");
    botsMod.update(W, step);        // brains → bot input structs (staggered)
    if (PROF) { PROF.end("bots"); PROF.begin("player"); }
    playerMod.update(W, step);      // all actors: movement + physics + camera
    if (PROF) { PROF.end("player"); PROF.begin("weapons"); }
    weaponsMod.update(W, step);     // fire/reload/projectiles/damage
    if (PROF) { PROF.end("weapons"); PROF.begin("loot"); }
    lootMod.update(W, step);        // pickups, chest channels
    if (PROF) { PROF.end("loot"); PROF.begin("storm"); }
    stormMod.update(W, step);       // circle, damage ticks, warnings
    if (PROF) { PROF.end("storm"); PROF.begin("fx"); }
    fxMod.update(W, real);          // particles, tracers, damage numbers
    if (PROF) { PROF.end("fx"); PROF.begin("hud"); }
    hudMod.update(W, real);         // bars, minimap, feed, timers
    if (PROF) PROF.end("hud");
    // audio.js had NO per-frame hook at all — it exported only init/setVolumes/
    // startMenuMusic/startMatchMusic/onMatchEnd, so listener sync, the storm bed,
    // ambience and the music duck had nowhere to live. Deliberately NOT added to
    // the fastForward loop below: that path is the deterministic test harness and
    // must stay silent and rAF-free. Guarded because audio.js lands `update` in a
    // parallel change and an unguarded call here would throw every frame.
    if (audioMod.update) {
      if (PROF) PROF.begin("audio");
      audioMod.update(W, real);
      if (PROF) PROF.end("audio");
    }
    if (W.net) {
      if (PROF) PROF.begin("net");
      netMod.update(W, real);
      if (PROF) PROF.end("net");
    }

    // win/lose
    if (W.phase === "match" && W.match && W.match.over) {
      // isWinner, not `winner === id`: the scalar is only the FIRST survivor of a
      // winning squad, so the second squadmate got the defeat screen.
      endMatch(W.match.isWinner(W.player.id));
    }
  });

  // ── lifecycle: leaving the tab pauses a solo match ──────────────────────────
  // Hidden tabs stop rAF, so the sim froze anyway — and resumed mid-firefight the
  // instant the player came back, with no warning. Solo (and practice) now opens
  // the PAUSED menu on visibilitychange-hidden / pagehide, so coming back is a
  // RESUME the player chooses. Online the sim must keep running (the host swaps a
  // silent guest for a bot), and audio.js already mutes on hide (audio.js
  // visibilitychange) — so net modes get the mute and nothing else.
  function pauseForHide() {
    if (W.net || W.paused) return;
    if (W.phase !== "match" && W.phase !== "drop") return;
    if (typeof hudMod.requestPause !== "function") return;
    // requestPause(W, true) only OPENS, but declines while a modal (big map,
    // settings) is topmost; a plain request closes that modal, then open again.
    for (let i = 0; i < 3 && !W.paused; i++) {
      try { hudMod.requestPause(W, true); if (!W.paused) hudMod.requestPause(W); } catch (e) { console.warn("[royale] pause on hide failed:", e); return; }
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") pauseForHide(); });
  window.addEventListener("pagehide", pauseForHide);

  // ── menu ───────────────────────────────────────────────────────────────────
  hudMod.showMenu(W, startMatch);

  // ── debug/test hook ─────────────────────────────────────────────────────────
  const readback = (mod, W_) => {
    if (!mod || typeof mod.readback !== "function") return null;
    try { return mod.readback(W_); } catch (e) { return { error: String(e && e.message || e) }; }
  };
  const controller = {
    W,
    startMatch,
    // test hook: bot brains (state, target, moveTo) for _harness/botcheck.py
    brains: () => (botsMod.debugBrains ? botsMod.debugBrains() : []),
    state: () => ({
      phase: W.phase, t: W.t, alive: W.match ? W.match.aliveCount() : 0,
      player: W.player ? { hp: W.player.hp, shield: W.player.shield, pos: { x: W.player.pos.x, y: W.player.pos.y, z: W.player.pos.z }, weapon: W.player.weapon && W.player.weapon.id } : null,
      map: W.mapId, mode: W.mode, seed: W.seed,
    }),
    // synchronous fast-forward for deterministic tests (no rAF dependency).
    // An INTEGER step count: `for (t = 0; t < s; t += h)` accumulated float error,
    // so fastForward(0.5, 1/30) ran 16 steps (0.533 s) instead of 15 (bots S4).
    // ceil(s/h - 1e-9) keeps the old count wherever s/h is not a whole number.
    fastForward: (seconds, stepS) => {
      const h = stepS > 0 ? stepS : 1 / 30;
      const n = Math.max(0, Math.ceil((+seconds || 0) / h - 1e-9));
      for (let i = 0; i < n; i++) {
        W.t += h;
        botsMod.update(W, h); playerMod.update(W, h); weaponsMod.update(W, h);
        lootMod.update(W, h); stormMod.update(W, h);
        if (W.match && W.match.over) break;
      }
      return controller.state();
    },
    // C9: n synchronous kernel frames (tweens -> mixers -> updaters -> camera fit
    // -> render), never waiting on rAF — the box's rAF is starved, and a hidden or
    // headless tab throttles it. render: true (default) every frame, false never,
    // a number N every Nth frame and always the last. A throw propagates.
    stepFrames: (n, dt, render) => {
      const count = Math.max(0, Math.floor(+n || 0));
      const d = dt > 0 ? dt : 1 / 60;
      const every = render === undefined || render === true ? 1 : (render === false || !render) ? 0 : Math.max(1, Math.floor(+render));
      for (let i = 0; i < count; i++) {
        const doR = every > 0 && ((i + 1) % every === 0 || i === count - 1);
        if (typeof kernel.stepFrame === "function") kernel.stepFrame(d, doR);
        else {
          // pre-C9 kernel: the same frame body by hand
          if (kernel._stepTweens) kernel._stepTweens(d);
          for (const m of kernel._mixers) if (m._ffgSkip !== true) m.update(d);
          for (const u of kernel._updaters) u(d, kernel.clock.elapsedTime);
          if (doR) { if (kernel.composer) kernel.composer.render(d); else kernel.renderer.render(kernel.scene, kernel.camera); }
        }
      }
      return { frames: count, frameNo: kernel.frameNo, phase: W.phase, t: W.t };
    },
    // C9: the frame profiler's dump (?prof=1; otherwise { enabled: false })
    prof: () => (kernel.prof && typeof kernel.prof.dump === "function" ? kernel.prof.dump() : { enabled: false, frames: 0 }),
    // C9: one read-back for the feel gates — hud (marker, reticle, band), fx
    // (damage numbers, shield breaks, particles) and audio (duck ramps, voices).
    feel: () => ({
      t: W.t, phase: W.phase, paused: !!W.paused,
      hud: readback(hudMod, W), fx: readback(fxMod, W), audio: readback(audioMod, W),
      camShake: +(W.camShake || 0).toFixed(3), hitstopT: +(W.hitstopT || 0).toFixed(3),
      settings: { shake: W.settings.shake, fov: W.settings.fov, graphics: W.settings.graphics },
      gfx: W._gfx || null, warm: W._warm || null,
    }),
  };
  window.__LC__ = controller;
  return controller;
});

// ── helpers ────────────────────────────────────────────────────────────────
function mkEmitter() {
  const ls = {};
  return {
    on: (ev, fn) => { (ls[ev] = ls[ev] || []).push(fn); },
    emit: (ev, ...args) => { const l = ls[ev]; if (l) for (let i = 0; i < l.length; i++) l[i](...args); },
  };
}
function loadSettings() {
  const def = { masterVol: 0.8, musicVol: 0.5, sfxVol: 0.9, sensitivity: 1.0, adsSensitivity: 0.8, graphics: "medium", playerName: "You", keys: {}, showPerf: false, fov: 57, sprintToggle: true, adsToggle: false, shake: 1 };   // SHIFT = click on / click off (owner direction 2026-07-21)
  // The OS "reduce motion" setting starts screen shake at HALF (feel G12;
  // DYEFIELD juice.ts honours prefersReducedMotion). Only a DEFAULT: a stored
  // choice — including FULL — always wins.
  try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) def.shake = 0.5; } catch (e) {}
  try {
    const s = Object.assign(def, JSON.parse(localStorage.getItem("lc_settings") || "{}"));
    // Settings persist, so a value dragged to an unusable extreme STAYS broken
    // across reloads — a sensitivity slider pulled to 0 left the mouse unable to
    // turn at all, on every future launch, with no way back except clearing site
    // data. Clamp on load so a bad stored value self-heals.
    s.sensitivity = Math.min(3, Math.max(0.15, +s.sensitivity || 1));
    s.adsSensitivity = Math.min(3, Math.max(0.15, +s.adsSensitivity || 0.8));
    s.fov = Math.min(85, Math.max(50, +s.fov || 57));
    // Camera shake is a motion-sickness accommodation the same way FOV and the
    // sprint/ADS toggles are, so 0 has to be reachable — and `|| 1` would bounce a
    // deliberate 0 straight back to full. Same persistence trap as the sliders above.
    s.shake = (s.shake == null || !isFinite(+s.shake)) ? 1 : Math.min(1, Math.max(0, +s.shake));
    for (const k of ["masterVol", "musicVol", "sfxVol"]) s[k] = Math.min(1, Math.max(0, +s[k] || 0));
    return s;
  } catch (e) { return def; }
}
function shuffledNames(W) {
  const pool = window.FFG.sim.Royale.BOT_NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(W.rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  return pool;
}
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
/** Reject after `ms` (a bounded wait on an optional asset; never a hang). */
function withTimeout(p, ms) {
  let to = 0;
  const timer = new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timed out after " + ms + " ms")), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(to));
}

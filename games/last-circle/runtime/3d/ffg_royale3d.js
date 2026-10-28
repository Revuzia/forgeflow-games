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
 * Frame order: input → [fixed SIM_DT ticks from an accumulator: brains →
 * movement+physics → weapons/projectiles → loot → storm → net] → view (actors
 * interpolated between ticks, camera, fx, hud, audio). Bots emit the SAME input struct the
 * human's keyboard/mouse produces and run through the same movement/weapon
 * code — "bots are players" is structural, not simulated.
 *
 * Debug hook: window.__LC__ (world, startMatch, fastForward, state, and the
 * contract-C9 test surface: stepFrames(n, dt, render), prof(), feel()).
 */
import * as THREE from "three";
import { randomHandles, handleRng } from "../ffg_handles.js";

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
// sim/navgrid.js (Wave 7, lane 7B2): the baked town navigation grid, a second universal script on window.FFG.sim.NavGrid, fetched in parallel with
// sim/royale.js below. OPTIONAL: if it fails to load the bots keep the 64 m window planner everywhere (bots.js feature-detects it), so a missing
// file is a console note, not a failure.
const navLoad = new Promise((res) => {
  if (window.FFG && window.FFG.sim && window.FFG.sim.NavGrid) return res();
  const s = document.createElement("script");
  s.src = new URL("../sim/navgrid.js" + V, import.meta.url).href;
  s.onload = res; s.onerror = () => { console.warn("[royale] navgrid.js not loaded - the bots keep the window planner:", s.src); res(); };
  document.head.appendChild(s);
});
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
await navLoad;

// Match teardown order (contract C8). Every module that owns per-match state
// exports disposeMatch(W); each is FEATURE-DETECTED so lanes can land in any
// order. hud/fx/audio drop references into the old roster first, weapons detaches
// held guns while W.actors still lists them, player (skeletons, name tags) before
// the roster is cleared, and the map LAST — its disposal walks the map group.
// net.js is deliberately absent: a rematch inside a SQUAD UP room re-enters
// startMatch, and tearing the session down there would eject the squad.
const MATCH_MODS = [["hud", hudMod], ["fx", fxMod], ["audio", audioMod], ["weapons", weaponsMod], ["bots", botsMod],
  ["loot", lootMod], ["player", playerMod], ["storm", stormMod], ["maps", mapsMod]];
// Modules the orchestrator does not import statically (touch.js is a dynamic import)
// join the same two lists once they load. WARM_ONLY holds modules that export
// warmObjects(W) (contract C-WARM) but must NOT be torn down per match (net.js).
const EXTRA_MODS = [];
const WARM_ONLY = [["net", netMod]];

// ── canvas output (the LOW tier draws straight to the canvas: see routePost) ─────
// With the composer, every scene material renders into a LINEAR render target: three
// keys tone mapping off and the colour space linear there, so the output chunks are
// no-ops, blending happens in linear light, and the OutputPass tone-maps + sRGB-encodes
// the composite once. Straight to the canvas, three runs those chunks per material
// instead, BEFORE blending. Three kinds of shader come out wrong that way:
//   1 no output chunks at all (both sky domes, maps.js / hud.js): raw linear values on
//     the canvas, far too dark. -> append the two chunks.
//   2 PREMULTIPLIED output (storm wall + bolts, fx quads, loot beams / rings write
//     vec4(colour * a, a) and only THEN run the chunks): the sRGB encode lands on the
//     premultiplied colour, and enc(a * c) >> a * enc(c) for a small a (a = 0.1:
//     0.35 vs 0.10), so faint streaks came out ~3x too hot. -> split the output into
//     the part a normal blend can show (straight colour, clamped to 1) and the excess
//     (additive light), run the chunks on the straight colour, premultiply AFTER the
//     encode (three's own order, premultiplied_alpha_fragment), add the excess as it is.
//   3 ADDITIVE blending (loot glows, fx sprites) and the excess of 2 (storm bolts are
//     premultiplied with alpha 0): an encoded colour added to an encoded background,
//     where the composer adds LINEAR light and encodes the sum. -> add the linear light
//     unencoded, scaled by CO_ADD_K = the slope of the composer's output curve at the
//     daylight sky: the sky reads sRGB ~197/255 = linear 0.56 after Neutral tone mapping
//     (identity below 0.76), and d enc/dx = (1.055/2.4) * 0.56^(1/2.4 - 1) = 0.62. With
//     k = 1 the lightning showed 6x the composer's halo (2213 vs 362 px brighter than
//     sky + 25 in one 240x280 crop); on dark ground the true slope is higher (~1.0 at
//     linear 0.25), so k errs dim there - the owner's glare rule: start low.
// Done at COMPILE time in Material.prototype.onBeforeCompile, only for programs whose
// output colour space is sRGB (the canvas); three keys programs on that colour space,
// so every render-target program (medium / high) is compiled from the untouched source.
// A material with its own onBeforeCompile (player rim, name tags; loot beams + rings, which define LC_CANVAS themselves)
// is left alone - the first two are opaque or plain alpha. A premultiplied shader that includes premultiplied_alpha_fragment
// itself (straight colour, premultiplied after the chunks) is left alone too. ?canvasfix=0 turns off 2 + 3 (A/B and rollback).
const CANVAS_FIX_EFFECTS = (() => { try { return new URLSearchParams(location.search).get("canvasfix") !== "0"; } catch (e) { return true; } })();
const CO_TM = /^[ \t]*#include\s*<tonemapping_fragment>[ \t]*$/m;
const CO_CS = /^[ \t]*#include\s*<colorspace_fragment>[ \t]*$/m;
const CO_PREMUL_PRE = [
  "float lcCanvasOutA = gl_FragColor.a;   // ORCH canvas output: premultiplied -> straight + excess",
  "vec3 lcCanvasOutN = lcCanvasOutA > 0.0 ? min( gl_FragColor.rgb / max( lcCanvasOutA, 1e-4 ), vec3( 1.0 ) ) : vec3( 0.0 );",
  "vec3 lcCanvasOutL = max( gl_FragColor.rgb - lcCanvasOutN * lcCanvasOutA, vec3( 0.0 ) );",
  "gl_FragColor.rgb = lcCanvasOutN;", ""].join("\n");
const CO_ADD_K = "0.62";
const CO_PREMUL_POST = "\ngl_FragColor.rgb = gl_FragColor.rgb * lcCanvasOutA + lcCanvasOutL * " + CO_ADD_K + ";";
const CO_ADD_PRE = "vec3 lcCanvasOutL = gl_FragColor.rgb;   // ORCH canvas output: additive light stays linear\n";
const CO_ADD_POST = "\ngl_FragColor.rgb = lcCanvasOutL * " + CO_ADD_K + ";";
function wrapOutputChunks(fs, pre, post) {
  const t = CO_TM.exec(fs), c = CO_CS.exec(fs);
  if (!c || (t && t.index > c.index)) return null;
  const first = t || c;
  const cEnd = c.index + c[0].length;
  return fs.slice(0, first.index) + pre + fs.slice(first.index, cEnd) + post + fs.slice(cEnd);
}
function lcCanvasOutput(parameters) {
  if (parameters.isRawShaderMaterial || parameters.outputColorSpace !== THREE.SRGBColorSpace) return;   // render targets: untouched
  // post AA (kernel setAA, LC-03) draws an image that is ALREADY tone-mapped + sRGB onto the canvas: appending the
  // chunks (case 1 below) would tone-map and encode it a second time
  if (this.userData && this.userData.lcNoCanvasOut) return;
  const fs = parameters.fragmentShader;
  if (typeof fs !== "string" || fs.indexOf("lcCanvasOut") !== -1) return;
  let out = null;
  if (this.isShaderMaterial && !/tonemapping_fragment|colorspace_fragment|linearToOutputTexel/.test(fs)) {
    // 1: an #include must start its own line - both sky shaders are one-liners
    if (/\}\s*$/.test(fs)) out = fs.replace(/\}\s*$/, "\n/* lcCanvasOut: chunks */\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}");
  } else if (CANVAS_FIX_EFFECTS && this.blending === THREE.AdditiveBlending) {
    out = wrapOutputChunks(fs, CO_ADD_PRE, CO_ADD_POST);                                                  // 3
  } else if (CANVAS_FIX_EFFECTS && this.isShaderMaterial && this.premultipliedAlpha && this.blending === THREE.NormalBlending
             && !/premultiplied_alpha_fragment/.test(fs)) {
    // (a shader that includes premultiplied_alpha_fragment itself writes STRAIGHT colour, runs the chunks and premultiplies after them:
    //  three's own order, already right on the canvas - and possibly HDR (> 1), which the clamp below would flatten: loot rings)
    out = wrapOutputChunks(fs, CO_PREMUL_PRE, CO_PREMUL_POST);                                            // 2
  }
  if (out) parameters.fragmentShader = out;
}
// true while the scene is drawn straight to the canvas (routePost sets it). three's program cache key has `opaque` and
// `premultipliedAlpha` but NOT the blending mode, so an additive material and a normal-blend transparent one that are
// otherwise identical resolve to ONE program, and whichever compiled first decided the source for both (proved by
// _harness/new/orch_progkey.py: 4 of 4 pairs shared, the second of each drew with the first one's output maths). While the
// hook is active the additive ones therefore carry their own key part. It is only added on the direct route, so the
// render-target programs of medium / high are keyed exactly as before (no extra programs there).
let CANVAS_DIRECT = false;
function installCanvasOutput() {
  const P = THREE.Material.prototype;
  if (P._lcCanvasOutput) return;
  const prev = P.onBeforeCompile;          // three's default is an empty method; chained in case something else hooked it first
  P.onBeforeCompile = function (parameters, renderer) {
    if (prev) prev.call(this, parameters, renderer);
    lcCanvasOutput.call(this, parameters);
  };
  const prevKey = P.customProgramCacheKey; // three's default returns onBeforeCompile.toString(), i.e. one constant for every material
  P.customProgramCacheKey = function () {
    const k = prevKey.call(this);
    return CANVAS_DIRECT && this.blending === THREE.AdditiveBlending ? k + "|lcAdd" : k;
  };
  P._lcCanvasOutput = true;
}

register3d("royale", async function (kernel, content) {
  const setup = content.setup || {};
  installCanvasOutput();      // before any program is compiled (the menu, the warm-up)

  // ── shared world ────────────────────────────────────────────────────────────
  const W = {
    THREE, kernel, content, SIM,
    scene: kernel.scene, camera: kernel.camera,
    assetBase: new URL("../../", import.meta.url).href, // game dir root
    // match config (set by menu)
    mapId: setup.defaultMap || "isla_viva",
    mode: setup.defaultMode || "standard",   // the PACE: standard | quick | practice
    teamMode: "solo",        // C-MODE team mode of the current / last match: solo | duo | trio | squad (startMatch opts.teamMode)
    teams: null,             // C-MODE teamId -> [actor ids] of the current match
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
  // FIXED-TICK accumulator state (see "frame pipeline"). Declared here, before
  // anything can call startMatch, which resets it.
  const LOOP = { acc: 0, frozen: true, ticks: 0, dropped: 0, lastTicks: 0 };
  W.simTick = 0;            // fixed sim ticks run this match (live loop and fastForward alike)
  W.alpha = 1;              // interpolation factor handed to this frame's view
  W.frameDt = 0;            // the REAL frame dt the view (camera, shake, fx, hud) runs on

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
    .then((m) => {
      if (m && m.install) m.install(W, { hud: hudMod });
      // a touch layer that ever owns GPU objects or per-match state joins C7/C8 like any module
      if (m && (typeof m.warmObjects === "function" || typeof m.disposeMatch === "function")) EXTRA_MODS.push(["touch", m]);
    })
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

  // ── post-processing route (PLAN next-steps: "Low tier: stop running the composer") ─
  // The kernel draws through kernel.composer whenever one exists (ffg_kernel_3d.js
  // _frame), and hud.js builds one for the menu and keeps it for the session. On the
  // LOW tier bloom is off, so that composer was a RenderPass into a full-size
  // half-float target plus an OutputPass blit: two extra full-screen passes and ~25 MB
  // of render targets for an image the canvas can take directly. Low therefore swaps
  // in DIRECT_POST, a composer-shaped object whose render() is the kernel's own
  // no-composer draw. It has to be an object, not null: hud.js:823 rebuilds a
  // composer whenever kernel.composer is falsy. medium/high keep the real composer
  // exactly as before. `?lowpost=1` keeps the composer on low (A/B and rollback).
  const LOW_POST = (() => { try { return new URLSearchParams(location.search).get("lowpost") === "1"; } catch (e) { return false; } })();
  const DIRECT_POST = {
    isDirectPost: true,
    passes: [], readBuffer: null, writeBuffer: null,    // warmup binds readBuffer: null = the canvas variant, which is what low draws
    render() { kernel.renderer.render(kernel.scene, kernel.camera); },
    setSize() {}, setPixelRatio() {}, dispose() {},
  };
  /** GPU side of a detached composer: render targets and the passes' targets and
   *  materials. Every object stays valid; three re-creates what it needs on the
   *  next use, so a later switch back to medium/high just works. */
  function releasePost(c) {
    try {
      if (c.renderTarget1) c.renderTarget1.dispose();
      if (c.renderTarget2) c.renderTarget2.dispose();
      for (const p of c.passes || []) if (p && typeof p.dispose === "function") p.dispose();
    } catch (e) { console.warn("[royale] releasing the post-processing targets failed:", e); }
  }
  /** Point the kernel at DIRECT_POST (direct = true) or at the real composer. Returns
   *  "direct" | "composer" | "composer-pending" (medium/high before hud.js built one). */
  function routePost(direct) {
    const cur = kernel.composer;
    CANVAS_DIRECT = !!direct;       // read by customProgramCacheKey (installCanvasOutput) when the next program is keyed
    if (direct) {
      if (cur === DIRECT_POST) return "direct";
      if (cur) { W._postComposer = cur; releasePost(cur); }
      kernel.composer = DIRECT_POST;
      return "direct";
    }
    if (cur !== DIRECT_POST) return cur ? "composer" : "composer-pending";
    let real = W._postComposer || null;
    if (real) kernel.composer = real;
    else if (typeof kernel.enableBloom === "function") {
      // low from boot: no composer was ever built. Same values hud.js uses for the
      // menu (0.45) or maps.js for a match (0.14).
      kernel.enableBloom({ strength: 0.45, radius: 0.55, threshold: 0.72 });
      real = kernel.composer;
      if (kernel.bloom && W.phase !== "menu") kernel.bloom.strength = 0.14;
    }
    if (!real) { kernel.composer = DIRECT_POST; return "direct"; }   // an older kernel with no enableBloom
    // kernel.setDpr / _resize only reach kernel.composer, so a detached one is stale
    if (real.setPixelRatio) real.setPixelRatio(kernel.renderer.getPixelRatio());
    // (kernel._sizeW starts at -1 until the kernel's first setSize, so it is only trusted when > 0)
    if (real.setSize) real.setSize(Math.max(1, kernel._sizeW > 0 ? kernel._sizeW : (kernel.viewW || window.innerWidth || 1)),
                                   Math.max(1, kernel._sizeH > 0 ? kernel._sizeH : (kernel.viewH || window.innerHeight || 1)));
    return "composer";
  }
  // Canvas output (installCanvasOutput, module level below) makes every material that
  // reaches the canvas directly - the whole low tier now - come out the way the
  // composer's OutputPass would have shown it. It is keyed to the program's output
  // colour space, so the render-target programs of medium/high are never touched.

  // ── video settings beyond the tier (LC-03 AA, LC-06 W.setGfx + ladder, LC-43 daltonize) ──────
  // W.settings.gfx is saved with the rest of lc_settings (hud.js save writes the whole object).
  //   aa: "auto" (tier default: high SMAA, medium MED_AA, low/touch off) | "off" | "fxaa" | "smaa"
  //   bloom: "auto" (tier) | "off" | "on";   dpr: "auto" | a ceiling 0.5..1.5;   autoQuality: the in-match ladder
  //   daltonize: "off" | "protan" | "deutan" | "tritan" (+ daltonizeAmt 0..1)
  const GFX_DEF = { aa: "auto", bloom: "auto", dpr: "auto", autoQuality: true, daltonize: "off", daltonizeAmt: 1 };
  function gfxPrefs() {
    const cur = W.settings.gfx;
    if (cur && typeof cur === "object" && cur._full === GFX_DEF) return cur;    // per-frame callers: no allocation
    const g = Object.assign({}, GFX_DEF, (cur && typeof cur === "object") ? cur : {});
    Object.defineProperty(g, "_full", { value: GFX_DEF, enumerable: false });   // not saved (JSON skips it)
    W.settings.gfx = g;
    return g;
  }
  // MEDIUM's AA: FXAA. The plan allowed SMAA on medium only if it measured inside the +0.8 ms GPU budget on the UHD
  // iGPU (P1-C ABAB in F:/lc_p1/P1-C/notes.txt); HIGH gets SMAA.
  const MED_AA = "fxaa";
  // URL / automation switches. Auto-tier, the ladder and the idle prefetch read the box they run on, so they are OFF
  // under browser automation (navigator.webdriver) unless asked for: every harness gate boots a fresh profile on this
  // shared iGPU, and an auto-pick there would silently move the whole suite to another tier. ?autotier= / ?ladder= /
  // ?prefetch= 1 forces one on, 0 off (A/B and rollback).
  const QS = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(""); } })();
  const AUTOMATED = (() => { try { return !!navigator.webdriver; } catch (e) { return false; } })();
  const qsOn = (k) => QS.get(k) === "1" || (QS.get(k) !== "0" && !AUTOMATED);
  const AUTOTIER_ON = qsOn("autotier"), LADDER_ON = qsOn("ladder"), PREFETCH_ON = qsOn("prefetch");
  const AA_OFF = QS.get("aa") === "0";     // ?aa=0: no post AA whatever the settings (A/B and rollback, like ?lowpost / ?canvasfix)
  // BLOOM RESOLUTION per tier (C-GFX perf): the factor on the size UnrealBloomPass gets from the composer (it already
  // works at half of that). See bloomRes. ?bloomres=<f> forces one factor on every tier (A/B and rollback).
  const BLOOM_RES_Q = (() => { const v = +QS.get("bloomres"); return v > 0 && v <= 1 ? v : null; })();
  // medium / high 0.5: the bright pass + 5 blur mips + composite run on a quarter of the pixels they did. Measured on the same
  // frozen frames (bloomres_check, ashgrid s11 1920x1080): bloom's whole contribution is max 18-19 / 255 on 0.03 % of the pixels,
  // and 0.5 against 1 differs by max 9-10 / 255 on 0.005 % of the pixels (> 8 on 1 pixel in a million) - invisible. ULTRA keeps
  // three's full-size chain (the best image); low has no bloom.
  const BLOOM_RES = { low: 1, medium: 0.5, high: 0.5, ultra: 1 };
  function bloomRes(tier) { return BLOOM_RES_Q != null ? BLOOM_RES_Q : (BLOOM_RES[tier] || 1); }
  // the four C-GFX tiers, worst to best
  const TIERS = ["low", "medium", "high", "ultra"];
  // the in-match quality ladder's state (see ladderFrame); its level survives match to match in a session
  const LAD = { level: 0, lastChange: 0, lastAbove: 0, settleUntil: 0, rawSettle: 0, p75: null, src: null, hist: [], steps: 0 };
  // LADDER STEPS, cheapest image loss first. Level n = the first n steps that CHANGE something on this screen for this
  // tier (ladderSteps). Every step is program-free: FXAA is a uniform branch of the output pass, bloom is a pass's
  // `enabled`, a shadow-map size change re-allocates the map (three keys no program on its size), DPR resizes targets.
  //   aa     SMAA -> FXAA        (high / ultra: SMAA is 7.5-10 ms on the UHD iGPU against FXAA's 0.5-0.7, P1-C notes)
  //   bloom  bloom off           (~6 ms of the UHD's medium ground frame at a nearly invisible 0.14, perf audit)
  //   shadow 4096 -> 2048 map    (high / ultra)
  //   dpr    1.5, 1.25, 1.0      (DPR 1.5 -> 1.0 roughly halves the fill-bound iGPU frame; floor 1.0, plan cut list)
  // On medium that is exactly P1-C's ladder: bloom off, DPR 1.25, DPR 1.0 (levels 1..3).
  const LADDER_ALL = [
    { id: "aa" }, { id: "bloom" }, { id: "shadow", cap: 2048 },
    { id: "dpr", cap: 1.5 }, { id: "dpr", cap: 1.25 }, { id: "dpr", cap: 1.0 },
  ];
  // the first-run auto-tier's state (see autoTierFrame)
  const AUTO = { state: "idle", frames: 0, from: 0, rawFrom: 0, why: null };

  /** A player's choice (hud.js Settings calls this with the picked tier): the auto-tier never overrides it again, and
   *  the ladder restarts from the top of the new tier. The game's own boot / match-start applies go through applyTier. */
  W.applyGraphics = function (tier) {
    if (tier) { W.settings.gfxUser = true; LAD.level = 0; LAD.hist.push({ t: Math.round(performance.now()), from: null, to: 0, why: "player tier " + tier }); }
    return applyTier(tier, "user");
  };

  function applyTier(tier, src) {
    tier = TIERS.includes(tier) ? tier : (TIERS.includes(W.settings.graphics) ? W.settings.graphics : "medium");
    const routeBefore = W._gfx ? routeKey(W._gfx) : null;
    const g = gfxPrefs();
    const r = kernel.renderer;
    const touch = isTouchDevice();
    // PHONES UNTOUCHED (owner): a touch device never runs the ULTRA tables - a stored "ultra" plays as "high" there
    // (shadow map capped at 1024 below, no post AA, DPR under the kernel's 1.5 budget: exactly today's high on a phone).
    const tierAsked = tier;
    if (touch && tier === "ultra") tier = "high";
    W.gfxTier = tier;                 // C-GFX read surface: the tier whose tables are in force

    // ULTRA (C-GFX, owner "low, med, high, ultra"; "ensure you can get it to its best"): the best the game can look -
    // full device DPR up to 2 (the kernel's 1.5 budget is lifted for this tier only), SMAA, the 4096 shadow map over the
    // widest extent with a fresh depth pass every frame (no glide cadence), 16x anisotropy, the longest loot / weapon
    // draw distances, bloom. Lanes that add a visual feature read W.gfxTier (ultra = their best setting).
    const DPR = { low: 1, medium: 1.5, high: 2, ultra: 2 };
    const DPR_MAX = { low: 1.5, medium: 1.5, high: 1.5, ultra: 2 };
    const SHADOW = { low: 0, medium: 2048, high: 4096, ultra: 4096 };
    const ANISO = { low: 1, medium: 4, high: 8, ultra: 16 };
    const BLOOM = { low: 0, medium: 0.14, high: 0.14, ultra: 0.14 };
    // Draw-call knobs. Everything above scales FILL, and the frame is not fill
    // bound: the same view rendered at 64x36 cost 3.54 ms against 3.33 ms at
    // 1280x720 — deleting 99.9% of the pixels changed nothing — while 1280x720 to
    // 1920x1080 (5x the pixels) cost 1.7x the time. A full three-tier sweep on
    // ashgrid moved 319 calls / 4.06 ms to 276 / 3.08 ms, under 1 ms, because every
    // knob in the tables aims at a bottleneck that does not exist. These two are the
    // levers that actually remove submissions from the frame. The spread is kept
    // narrow on purpose (120-200 m, not 90-250 m): loot draw distance is competitive
    // information in a BR and the tier is player-selectable.
    const LOOT_CULL = { low: 120, medium: 150, high: 200, ultra: 220 };
    const WPN_LOD   = { low: 70,  medium: 110, high: 160, ultra: 200 };
    W.lootCull = LOOT_CULL[tier] || 150;
    W.wpnLOD = WPN_LOD[tier] || 110;
    const maxA = (r.capabilities && r.capabilities.getMaxAnisotropy) ? r.capabilities.getMaxAnisotropy() : 8;
    // DPR goes through the kernel's budget cap (C3: effective = max(0.5, min(device,
    // tier, BUDGET.dprMax 1.5))), which also re-sizes the composer's render targets —
    // EffectComposer only reads the renderer's ratio once, at construction.
    // the DPR ceiling under the tier: the player's own (gfx.dpr) and the ladder's, whichever is lower
    const ladderOn = ladderActive(tier, touch);
    if (!ladderOn) LAD.level = 0;
    const lad = ladderState(tier, LAD.level);
    if (lad.level !== LAD.level) LAD.level = lad.level;      // fewer steps apply on this screen now (window moved, tier changed)
    const userCap = +g.dpr > 0 ? Math.min(2, Math.max(0.5, +g.dpr)) : Infinity;
    if (kernel.setDprMax) kernel.setDprMax(touch ? 1.5 : (DPR_MAX[tier] || 1.5));
    if (kernel.setDprCap) kernel.setDprCap(Math.min(userCap, lad.dprCap));
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
    // ultra 280: 560 m / 4096 = 13.7 cm per texel, still finer than medium's 14.6 cm, for 1.27x high's radius
    const SHADOW_EXT = { low: 55, medium: 150, high: 220, ultra: 280 };
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
      // Anti-aliasing: the renderer is antialias:false and the composer's RT is
      // single-sampled everywhere; the desktop post AA (LC-03, below) is never
      // switched on for touch, so the "AA off at DPR >= 2" rule still holds there.
      const sz = Math.min(SHADOW[tier] || 2048, touch ? 1024 : Infinity, lad.shadowCap);
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
    W._gfx = { tier, asked: tierAsked, dpr: dprEff, touch, shadows, shadowMap: shadows && kernel.sun ? kernel.sun.shadow.mapSize.x : 0, aa: false };
    // Bloom was the one fidelity knob the tier tables never touched: "low"
    // disabled shadows and dropped DPR to 1 but still paid for the full
    // UnrealBloomPass blur chain every frame, even though maps.js turns match
    // bloom down to 0.14 where it is nearly invisible. EffectComposer skips a
    // pass whose `enabled` is false, but the rest of the composer (RenderPass into
    // a half-float target + OutputPass) kept running on low, so low now leaves the
    // composer altogether (routePost above) and medium/high keep it, with the
    // menu's 0.45-strength storm-ring glow. kernel.bloom only exists once the menu
    // world has called enableBloom, hence the guard - the BOOT-time applyGraphics()
    // below runs before that, and the per-match re-apply in _startMatch is what
    // actually lands the tier's setting.
    // Colour-vision correction lives in the output pass, which the low tier's direct route does not run: with it on,
    // low keeps the composer (no bloom, no AA) - the player's own choice, so its one-time program compile is theirs.
    const cbOn = !!g.daltonize && g.daltonize !== "off";
    const post = routePost(tier === "low" && !LOW_POST && !cbOn);
    let bloomOn = (BLOOM[tier] || 0) > 0;
    if (g.bloom === "off") bloomOn = false;
    else if (g.bloom === "on" && tier !== "low") bloomOn = true;
    if (lad.bloomOff) bloomOn = false;                                          // ladder step "bloom"
    if (kernel.bloom && post !== "direct") kernel.bloom.enabled = bloomOn;
    W._gfx.post = post;
    W._gfx.bloom = post !== "direct" && !!kernel.bloom && kernel.bloom.enabled;
    // POST AA (LC-03), after the output pass: never on touch (CONTRACT_MOBILE M7) and never on the direct (low) route.
    // Never antialias:true on the renderer (BUILD_ORDER item 69): the scene is drawn into the composer's RT.
    let aa = "off";
    if (!touch && post !== "direct" && !AA_OFF) {
      if (g.aa === "auto") aa = tier === "high" || tier === "ultra" ? "smaa" : tier === "medium" ? MED_AA : "off";
      else if (g.aa === "fxaa" || g.aa === "smaa") aa = g.aa;
      if (aa === "smaa" && lad.aaDown) aa = "fxaa";      // ladder step "aa": FXAA is a uniform in the output pass (no new program)
    }
    const aaNow = kernel.setAA ? kernel.setAA(aa) : "off";
    W._gfx.aa = aa !== "off" ? aa : false;    // the mode asked for (in force once the AA module has loaded: aaNow)
    W._gfx.aaNow = aaNow;
    W._gfx.daltonize = kernel.setDaltonize ? kernel.setDaltonize(cbOn ? g.daltonize : 0, g.daltonizeAmt) : null;
    W._gfx.dprCap = kernel._dprCap === Infinity ? null : kernel._dprCap;
    W._gfx.ladder = { on: ladderOn, level: LAD.level, steps: lad.steps.slice(0, LAD.level) };
    W._gfx.bloomScale = bloomRes(tier);
    if (kernel.setBloomScale) kernel.setBloomScale(W._gfx.bloomScale);
    W._gfx.shadowCadence = tier !== "ultra";
    W._gfx.src = src || null;
    // keep the kernel's own quality key in sync (shell buttons + next boot)
    try { const s = JSON.parse(localStorage.getItem("ffg_settings") || "{}"); s.quality = tier === "medium" ? "med" : tier === "ultra" ? "high" : tier; localStorage.setItem("ffg_settings", JSON.stringify(s)); } catch (e) {}
    // D10 C-GFX: W.events 'gfxTier'(tier) once at start (the boot apply) and on every change of the tier in force, after the tables
    // above have landed (a listener reads W.gfxTier / W._gfx). A ladder step or a setGfx of another key keeps the tier: no event.
    // A listener that throws is logged, never allowed to abort the apply or starve the next listener's turn on the next change.
    // a mid-match route / shadow change re-warms the scene for the new variant (rewarmRoute above); the match start's own apply is
    // followed by warmMatch anyway (W._starting), and the menu / a teardown has no match scene to warm
    if (routeBefore !== null && routeKey(W._gfx) !== routeBefore && W.match && !W._starting &&
        (W.phase === "lobby" || W.phase === "drop" || W.phase === "match")) rewarmRoute((src || "tier") + ":" + routeBefore + "->" + routeKey(W._gfx));
    if (tier !== tierEmitted) {
      tierEmitted = tier;
      W._gfxTierEvents = (W._gfxTierEvents | 0) + 1;
      try { W.events.emit("gfxTier", tier); } catch (e) { console.warn("[royale] a gfxTier listener failed:", e && e.message); }
    }
    return W._gfx;
  }
  let tierEmitted = null;              // the tier the last 'gfxTier' event announced (D10)
  /** what keys the scene's programs: the draw route (direct canvas vs the composer's RT) and whether the shadow pass runs */
  function routeKey(g) { return (g.post === "direct" ? "direct" : "rt") + (g.shadows ? "+sh" : ""); }
  applyTier(W.settings.graphics, "boot");   // BOOT-apply the stored tier (the fix)

  function saveSettings() { try { localStorage.setItem("lc_settings", JSON.stringify(W.settings)); } catch (e) {} }

  /** W.setGfx(key, val) - the Video tab's one entry point (P2-G builds the rows). Keys:
   *    "tier" low|medium|high|ultra (a player's choice, like the Settings buttons), "aa" auto|off|fxaa|smaa,
   *    "bloom" auto|off|on, "dpr" auto|0.5..2 (a ceiling; above 1.5 only ULTRA can reach it), "autoQuality" true|false (the in-match ladder),
   *    "daltonize" off|protan|deutan|tritan, "daltonizeAmt" 0..1, "autoTier" "rerun" (forget the first-run pick).
   *  Applies at once, saves lc_settings, returns W.getGfx(). An unknown key or value throws (a UI bug, said loudly).
   *  Mid-match it never touches what the plan keeps fixed in a match: loot / weapon cull, the map build, the low route
   *  (only an explicit "tier" does, exactly as the Settings buttons always have). */
  W.setGfx = function (key, val) {
    const g = gfxPrefs();
    const bad = () => { throw new Error("W.setGfx: bad value for " + key + ": " + val); };
    switch (key) {
      case "tier":
        if (!TIERS.includes(val)) bad();
        W.settings.graphics = val; W.settings.gfxUser = true; LAD.level = 0;
        break;
      case "aa": if (!["auto", "off", "fxaa", "smaa"].includes(val)) bad(); g.aa = val; break;
      case "bloom": if (!["auto", "off", "on"].includes(val)) bad(); g.bloom = val; break;
      case "dpr":
        if (val === "auto" || val == null) g.dpr = "auto";
        else if (+val >= 0.5 && +val <= 2) g.dpr = +val; else bad();
        break;
      case "autoQuality": g.autoQuality = !!val; if (!val) LAD.level = 0; break;
      case "daltonize": if (!["off", "protan", "deutan", "tritan"].includes(val)) bad(); g.daltonize = val; break;
      case "daltonizeAmt": if (!(+val >= 0 && +val <= 1)) bad(); g.daltonizeAmt = +val; break;
      case "autoTier": if (val !== "rerun") bad(); delete W.settings.gfxAuto; W.settings.gfxUser = false; AUTO.state = "idle"; break;
      default: bad();
    }
    applyTier(W.settings.graphics, "setGfx:" + key);
    saveSettings();
    return W.getGfx();
  };
  W.getGfx = () => ({
    tier: W.settings.graphics, prefs: Object.assign({}, gfxPrefs()), user: !!W.settings.gfxUser,
    auto: W.settings.gfxAuto || null, autoState: AUTO.state, autoWhy: AUTO.why, applied: Object.assign({}, W._gfx),
    // read from the kernel NOW (W._gfx is the last apply; the menu builds its composer after the boot apply)
    live: { post: kernel.composer ? (kernel.composer.isDirectPost ? "direct" : "composer") : "none", bloom: !!(kernel.bloom && kernel.bloom.enabled && kernel.composer && !kernel.composer.isDirectPost),
            aa: kernel.aaMode || "off", dpr: kernel.dpr, dprCap: kernel._dprCap === Infinity ? null : kernel._dprCap },
    ladder: { on: ladderActive(W.settings.graphics, isTouchDevice()), level: LAD.level, p75: LAD.p75, src: LAD.src, steps: LAD.steps, hist: LAD.hist.slice(-12),
              stepList: ladderSteps(W.settings.graphics) },
    gpuTimer: !!(kernel.gpuTimer && kernel.gpuTimer.supported),
  });

  // ── LC-06 first-run auto-tier (desktop, never clicked a tier) ───────────────────────────────
  // About 90 menu frames on the GPU timer, after the menu has settled (its first frames compile programs and upload
  // textures). GPU p50 over AUTO_GPU_MS -> low. Without a timer (Firefox, Safari): live frame intervals, p50 over
  // AUTO_RAW_MS -> low (a vsync'd 60 Hz menu reads 16.7 ms whatever the GPU does, so only a clear miss counts).
  // Decided once, saved as W.settings.gfxAuto. A stored "low" / "high" (the default is medium) is a past choice.
  const AUTO_SKIP = 30, AUTO_N = 90, AUTO_GPU_MS = 12, AUTO_RAW_MS = 22;
  // UP (C-GFX): only on a GPU timer (a vsync'd frame interval cannot tell a fast GPU from a 60 Hz one) and only from the
  // default medium. HIGH when the menu's GPU p50 is <= AUTO_HIGH_MS; ULTRA only when the GPU is CLEARLY fast: the same p50
  // scaled by ULTRA's extra pixels (device DPR up to 2 against today's) is <= AUTO_ULTRA_MS. (RTX A2000 laptop dGPU,
  // P1-C: menu GPU p50 2.71 ms at DPR 1.5 -> ultra; the UHD iGPU, 17-20 ms -> low.)
  const AUTO_HIGH_MS = 5, AUTO_ULTRA_MS = 3.2;
  function autoTierEligible() {
    if (!AUTOTIER_ON) return "off";
    if (isTouchDevice()) return "touch";
    if (W.settings.gfxUser) return "player chose a tier";
    if (W.settings.gfxAuto) return "decided";
    if (W.settings.graphics === "low" || W.settings.graphics === "high" || W.settings.graphics === "ultra") return "stored " + W.settings.graphics;
    return null;
  }
  function pctl(arr, p) {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  }
  function autoTierFrame() {
    if (AUTO.state === "done" || AUTO.state === "skipped") return;
    if (AUTO.state === "idle") {
      const no = autoTierEligible();
      if (no) { AUTO.state = "skipped"; AUTO.why = no; schedulePrefetch(); return; }
      AUTO.state = "measuring"; AUTO.frames = 0;
      if (kernel.gpuTimer) kernel.gpuTimer.on = true;
    }
    if (W.settings.gfxUser) { autoTierDecide(false); return; }
    if (document.visibilityState === "hidden") return;
    AUTO.frames++;
    if (AUTO.frames === AUTO_SKIP) { AUTO.from = kernel.gpuTimer ? kernel.gpuTimer.count : 0; AUTO.rawFrom = kernel.rawCount || 0; }
    if (AUTO.frames <= AUTO_SKIP) return;
    const gt = kernel.gpuTimer;
    if (gt && gt.supported && gt.count - AUTO.from >= AUTO_N) autoTierDecide(false);
    else if (!(gt && gt.supported) && (kernel.rawCount || 0) - AUTO.rawFrom >= AUTO_N) autoTierDecide(false);
  }
  /** Decide from what has been measured. early (PLAY pressed first): from >= 30 samples, else not this session. */
  function autoTierDecide(early) {
    if (AUTO.state !== "measuring") return;
    const gt = kernel.gpuTimer;
    if (W.settings.gfxUser) {        // the player picked a tier in Settings while it measured: theirs wins
      AUTO.state = "skipped"; AUTO.why = "player chose a tier";
      if (gt && !ladderWantsTimer()) gt.on = false;
      schedulePrefetch();
      return;
    }
    const useGpu = !!(gt && gt.supported);
    const n = AUTO.frames <= AUTO_SKIP ? 0
      : useGpu ? Math.min(gt.count - AUTO.from, gt.ms.length) : Math.min((kernel.rawCount || 0) - AUTO.rawFrom, kernel.rawMs.length);
    if (n < (early ? 30 : AUTO_N)) {
      AUTO.state = "skipped"; AUTO.why = "too few samples before PLAY (" + Math.max(0, n) + ")";
      if (gt && !ladderWantsTimer()) gt.on = false;
      return;
    }
    const xs = (useGpu ? gt.ms : kernel.rawMs).slice(-n);
    const p50 = pctl(xs, 0.5), p90 = pctl(xs, 0.9);
    const lim = useGpu ? AUTO_GPU_MS : AUTO_RAW_MS;
    const from = W.settings.graphics || "medium";
    let tier = p50 > lim ? "low" : from;
    let ultraEst = null;
    if (tier === "medium" && useGpu) {
      const dev = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      const now = kernel.dpr > 0 ? kernel.dpr : 1, ult = Math.max(1, Math.min(dev, 2));
      ultraEst = p50 * (ult * ult) / (now * now);
      if (ultraEst <= AUTO_ULTRA_MS) tier = "ultra";
      else if (p50 <= AUTO_HIGH_MS) tier = "high";
    }
    const rec = { v: 1, tier, from, src: useGpu ? "gpu" : "raw", p50: +p50.toFixed(2), p90: +p90.toFixed(2), n,
                  limit: lim, early: !!early, dpr: kernel.dpr, ultraEst: ultraEst == null ? null : +ultraEst.toFixed(2), at: Date.now() };
    W.settings.gfxAuto = rec;
    AUTO.state = "done";
    if (tier !== from) { W.settings.graphics = tier; applyTier(tier, "auto"); }
    saveSettings();
    if (gt && !ladderWantsTimer()) gt.on = false;
    try { console.info("[LC] auto graphics: " + rec.src + " p50 " + rec.p50 + " ms -> " + tier); } catch (e) {}
    schedulePrefetch();
  }

  // ── LC-06 in-match quality ladder ────────────────────────────────────────────────────────────
  // Steps, best first: bloom off, then DPR 1.25, then 1.0 (a step that would change nothing on this screen is skipped).
  // Down when the GPU frame time's p75 over the last LADDER_WIN samples tops LADDER_DOWN ms; back up after LADDER_UP_HOLD
  // ms with that p75 under LADDER_UP ms; at most one step per LADDER_GAP ms. GPU time, not frame time: the levers only
  // remove pixels, and a CPU-bound drop (nav baking) must not throw away resolution that buys nothing. Without a GPU
  // timer the live frame interval stands in. Nothing else changes mid-match: loot / weapon cull, the map build and
  // the low route stay exactly as the match started.
  const LADDER_WIN = 30, LADDER_DOWN = 22, LADDER_UP = 14, LADDER_UP_HOLD = 4000, LADDER_GAP = 2000, LADDER_SETTLE = 6;
  // C-GFX CPU cut: the window's p75 is re-read every LADDER_EVAL new samples (not every frame) into one reusable typed
  // array - the old per-frame ring.slice + slice + comparator sort allocated ~3 arrays a frame for every real player.
  // 6 samples = 0.1 s at 60 fps against decisions spaced LADDER_GAP 2 s apart: the ladder decides exactly as before.
  const LADDER_EVAL = 6;
  const _ladBuf = new Float64Array(LADDER_WIN);
  let _ladLastEval = -1;
  function ladderP75(ring) {
    const n = Math.min(LADDER_WIN, ring.length);
    if (!n) return null;
    const a = n === LADDER_WIN ? _ladBuf : _ladBuf.subarray(0, n);
    for (let i = 0, o = ring.length - n; i < n; i++) a[i] = ring[o + i];
    a.sort();                                   // typed-array sort: numeric, in place, no comparator closure
    return a[Math.min(n - 1, Math.max(0, Math.round((n - 1) * 0.75)))];
  }
  function ladderActive(tier, touch) {
    return LADDER_ON && !touch && tier !== "low" && gfxPrefs().autoQuality !== false;
  }
  function ladderWantsTimer() { return ladderActive(W.settings.graphics, isTouchDevice()) && (W.phase === "match" || W.phase === "drop"); }
  /** The steps of LADDER_ALL that change something for `tier` on this screen, in order (see LADDER_ALL). Reads the
   *  device DPR through the kernel and the player's own choices (a player who set bloom off has no bloom step). */
  function ladderSteps(tier) {
    const g = gfxPrefs();
    const touch = isTouchDevice();
    const out = [];
    const smaa = !touch && !AA_OFF && (g.aa === "smaa" || (g.aa === "auto" && (tier === "high" || tier === "ultra")));
    const bloom = tier !== "low" && g.bloom !== "off";
    const shadowSz = tier === "high" || tier === "ultra" ? (touch ? 1024 : 4096) : tier === "medium" ? (touch ? 1024 : 2048) : 0;
    const dpr0 = { low: 1, medium: 1.5, high: 2, ultra: 2 }[tier] || 1.5;
    const dev = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const maxD = tier === "ultra" && !touch ? 2 : 1.5;
    const userCap = +g.dpr > 0 ? +g.dpr : Infinity;
    let dprNow = Math.max(0.5, Math.min(dev, dpr0, maxD, userCap));
    for (const st of LADDER_ALL) {
      if (st.id === "aa" && smaa) out.push("aa");
      else if (st.id === "bloom" && bloom) out.push("bloom");
      else if (st.id === "shadow" && shadowSz > st.cap) out.push("shadow");
      else if (st.id === "dpr" && dprNow > st.cap + 1e-6) { out.push("dpr" + st.cap); dprNow = st.cap; }
    }
    return out;
  }
  /** What `level` means for `tier` here: the first `level` applicable steps (clamped to how many exist). */
  function ladderState(tier, level) {
    const steps = ladderSteps(tier);
    const n = Math.max(0, Math.min(level | 0, steps.length));
    const on = steps.slice(0, n);
    let dprCap = Infinity;
    for (const k of on) if (k.startsWith("dpr")) dprCap = Math.min(dprCap, +k.slice(3));
    return { level: n, steps, aaDown: on.includes("aa"), bloomOff: on.includes("bloom"), shadowCap: on.includes("shadow") ? 2048 : Infinity, dprCap };
  }
  /** the next level from `lv` in direction dir (+1 down in quality, -1 up), or null at either end */
  function ladderNext(lv, dir) {
    const n = ladderSteps(W.settings.graphics).length;
    const to = lv + dir;
    return to >= 0 && to <= n ? to : null;
  }
  function ladderSet(to, why, p75) {
    const from = LAD.level, now = performance.now();
    LAD.level = to; LAD.lastChange = now; LAD.lastAbove = now; LAD.steps++;
    LAD.settleUntil = (kernel.gpuTimer ? kernel.gpuTimer.count : 0) + LADDER_SETTLE;
    LAD.rawSettle = (kernel.rawCount || 0) + LADDER_SETTLE;
    LAD.hist.push({ t: Math.round(now), simT: +(W.t || 0).toFixed(1), from, to, why, p75: p75 == null ? null : +p75.toFixed(2), phase: W.phase });
    if (LAD.hist.length > 40) LAD.hist.shift();
    applyTier(W.settings.graphics, "ladder");
  }
  function ladderFrame() {
    const gt = kernel.gpuTimer;
    if (!ladderActive(W.settings.graphics, isTouchDevice())) return;
    if (gt && gt.supported && !gt.on) { gt.on = true; LAD.settleUntil = gt.count + LADDER_SETTLE; }
    const useGpu = !!(gt && gt.supported);
    const count = useGpu ? gt.count : (kernel.rawCount || 0);
    const fresh = count - (useGpu ? LAD.settleUntil : LAD.rawSettle);
    if (fresh < LADDER_WIN) return;
    if (count === _ladLastEval || (_ladLastEval >= 0 && count > _ladLastEval && count - _ladLastEval < LADDER_EVAL)) return;
    _ladLastEval = count;
    const ring = useGpu ? gt.ms : kernel.rawMs;
    const p75 = ladderP75(ring);
    if (p75 == null) return;
    LAD.p75 = +p75.toFixed(2); LAD.src = useGpu ? "gpu" : "raw";
    const now = performance.now();
    if (p75 >= LADDER_UP) LAD.lastAbove = now;
    if (now - LAD.lastChange < LADDER_GAP) return;
    if (p75 > LADDER_DOWN) {
      const nx = ladderNext(LAD.level, +1);
      if (nx != null) ladderSet(nx, "p75 " + p75.toFixed(1) + " > " + LADDER_DOWN, p75);
    } else if (LAD.level > 0 && now - LAD.lastAbove >= LADDER_UP_HOLD) {
      const nx = ladderNext(LAD.level, -1);
      ladderSet(nx == null ? 0 : nx, "p75 < " + LADDER_UP + " for " + (LADDER_UP_HOLD / 1000) + " s", p75);
    }
  }
  /** TEST SURFACE (probes only, never called by the game): put the ladder at `level` now, as ladderFrame would. */
  W._ladderSet = (level, why) => { ladderSet(Math.max(0, Math.min(level | 0, ladderSteps(W.settings.graphics).length)), why || "test"); return W.getGfx(); };
  /** the GPU timer runs only while someone reads it (the auto-tier at the menu, the ladder in a match) */
  function timerHousekeeping() {
    const gt = kernel.gpuTimer;
    if (gt && gt.on && AUTO.state !== "measuring" && !ladderWantsTimer()) gt.on = false;
  }

  // ── LC-23 idle prefetch: the actor + clip GLBs, while the menu sits idle ─────────────────────
  // A cold Quick Match spent its first seconds downloading and parsing the five skins, their LOD1 bodies and the 22
  // shared clips, all only requested at match start (player.js loadActorModels). The menu now fetches them in its
  // idle time, ONE file at a time on requestIdleCallback, after the auto-tier has measured (so no parse sits inside its
  // sample window): skins parse straight into the kernel's loadCharacter cache; the LOD1 bodies and clips (plain
  // loader.loadAsync calls in player.js, which keep no cache) as bytes the kernel hands to the next request for exactly
  // that URL. PLAY aborts whatever is still in flight, so nothing is downloaded twice.
  // THE LIST: player.js exports no URL list (its SKINS / MESHY_CLIPS / DEATH_CLIPS are module-private and player.js is a
  // Wave-8 file this wave). Skin keys come from hud.js's exported MENU_SKINS, the death falls from player.js's own
  // clipLoadStats(), the loco names are player.js's MESHY_CLIPS (player.js:318-326). P1-C's probe compares the list
  // with the GLB requests of a real match load (no extras, no misses). P2: export the list from player.js.
  const PREFETCH_LOCO = ["idle", "walk", "run", "death", "hit", "dance", "cheer", "jump", "swim", "crouch",
    "rifle_idle", "rifle_walk", "rifle_run", "rifle_reload", "rifle_crouch"];
  const PF = { state: "idle", list: null, i: 0, done: 0, bytes: 0, failed: 0, ctl: null, t0: 0, ms: 0, why: null };
  function prefetchList() {
    const base = W.assetBase;
    const skins = (hudMod.MENU_SKINS || []).map((m) => m && m.key).filter(Boolean);
    let deaths = [];
    try { deaths = (playerMod.clipLoadStats && playerMod.clipLoadStats().deathClips) || []; } catch (e) { deaths = []; }
    const out = [];
    for (const k of skins) out.push({ kind: "char", url: base + "assets/chars/meshy/" + k + ".glb" });
    for (const k of skins) out.push({ kind: "bytes", url: base + "assets/chars/meshy/" + k + "_lod1.glb" });
    for (const c of PREFETCH_LOCO.concat(deaths)) out.push({ kind: "bytes", url: base + "assets/chars/clips/" + c + ".glb" });
    return out;
  }
  function schedulePrefetch() {
    if (!PREFETCH_ON || PF.state !== "idle" || W.phase !== "menu") return;
    // the shared clips are fetched once per page session by player.js: after the first match there is nothing to win
    try { if (playerMod.clipLoadStats && playerMod.clipLoadStats().mode !== "unknown") { PF.state = "done"; PF.why = "clips already loaded"; return; } } catch (e) {}
    PF.state = "running"; PF.list = prefetchList(); PF.i = 0; PF.t0 = performance.now();
    PF.ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const ric = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 50);
    const next = () => {
      if (PF.state !== "running") return;
      if (W.phase !== "menu" || PF.i >= PF.list.length) { prefetchStop(PF.i >= PF.list.length ? "done" : "left the menu"); return; }
      const it = PF.list[PF.i++];
      const p = it.kind === "char" ? kernel.prefetchCharacter(it.url) : kernel.prefetchBytes(it.url, { signal: PF.ctl ? PF.ctl.signal : undefined });
      Promise.resolve(p).then((r) => { if (r) { PF.done++; if (typeof r === "number") PF.bytes += r; } else PF.failed++; }, () => { PF.failed++; })
        .then(() => { if (PF.state === "running") ric(next); });
    };
    ric(next);
  }
  function prefetchStop(why) {
    if (PF.state !== "running") return;
    PF.state = why === "done" ? "done" : "stopped";
    PF.why = why; PF.ms = Math.round(performance.now() - PF.t0);
    if (why !== "done" && PF.ctl) { try { PF.ctl.abort(); } catch (e) {} }
  }
  W.prefetchStats = () => ({ on: PREFETCH_ON, state: PF.state, why: PF.why, n: PF.list ? PF.list.length : 0, next: PF.i, done: PF.done,
    failed: PF.failed, bytes: PF.bytes, ms: PF.state === "running" ? Math.round(performance.now() - PF.t0) : PF.ms,
    used: kernel._prefetchUsed || 0, waiting: kernel._prefetchBlobs ? kernel._prefetchBlobs.size : 0,
    list: (PF.list || prefetchList()).map((x) => x.url) });


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
    // (ULTRA: a fresh depth pass every frame, W._gfx.shadowCadence false)
    if (agl > 40 && (W.phase === "drop" || f.gliding) && !(W._gfx && W._gfx.shadowCadence === false)) {
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
    // LC-06: PLAY before the auto-tier finished decides from what it has (>= 30 samples) BEFORE the map is built, so
    // maps.js builds the tier that will be drawn. LC-23: PLAY stops the idle prefetch (in-flight bytes are aborted).
    try { if (AUTO.state === "measuring") autoTierDecide(true); } catch (e) { console.warn("[royale] auto-tier decision failed:", e); }
    try { prefetchStop("play"); } catch (e) {}
    // R1 boot (sky_lowtier boot row): a tier re-warm still linking the OLD match's programs (KHR_parallel_shader_compile links
    // off-thread) must finish before teardownMatch disposes those materials: deleting a program whose link is in flight made the
    // browser's own program-status poll hit a deleted name (GL_INVALID_VALUE: glGetProgramiv: Program object expected, measured
    // 3 to 48 per run). W._starting is already set, so the re-warm skips its frame; the wait is the link wait only, bounded.
    if (REWARM.busy && REWARM.p) { try { await withTimeout(REWARM.p, 20000); } catch (e) { /* bounded: start anyway */ } }
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
    // R1 boot: a new generation of the match world - an in-flight tier re-warm (rewarmRoute) checks it and stops drawing a world
    // that is being disposed under it
    W._matchGen = (W._matchGen | 0) + 1;
    // DISPOSE BEFORE DROPPING THE ROSTER: every actor registers an
    // AnimationMixer with the kernel, and the kernel only ever removes one on an
    // explicit disposeMixer. Clearing the group detaches the meshes but leaves
    // the mixers in the per-frame update list, so each match played added ~50
    // more skeletons to tick — frame time degraded monotonically, match over
    // match, with no in-game recovery. Nametags are per-actor CanvasTextures
    // and leak the same way. (They are not per-actor any more: a.nameTag is a
    // { visible, cell, actor } handle into the shared atlas, which player.disposeMatch
    // frees through nametags.disposeMatch.)
    for (const a of W.actors) {
      if (a.rig && a.rig.mixer && kernel.disposeMixer) kernel.disposeMixer(a.rig.mixer);
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
    for (const [name, mod] of MATCH_MODS.concat(EXTRA_MODS)) {
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
    // LC-87: a match survives a context loss (see onContextRestored below); the menu still reloads
    const keeps = lost && resumable();
    const detail = lost
      ? (keeps ? "The browser reset the graphics (this happens on phones and in background tabs). Your match carries on when they come back, or press RELOAD."
               : "The browser reset the graphics (this happens on phones and in background tabs). The game reloads when they come back, or press RELOAD.")
      : "The game stopped on an error: " + (err && err.message ? err.message : String(err)) + ". MAIN MENU tries to carry on; RELOAD starts fresh.";
    const reload = () => { try { location.reload(); } catch (e) {} };
    const actions = lost ? [{ label: "RELOAD", onClick: reload }] : [{ label: "MAIN MENU", onClick: recoverToMenu }, { label: "RELOAD", onClick: reload }];
    W._errorCard = { title, kind: (info && info.kind) || "error", t: Math.round(performance.now()) };
    const B = window.__LC_BOOT__;
    if (B && typeof B.fail === "function") {
      try { W._errorCardHandle = B.fail(title, detail, actions); } catch (e) { console.error("[royale] __LC_BOOT__.fail threw:", e); }
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

  // ── LC-87: a lost WebGL context no longer costs the match ───────────────────
  // The kernel used to reload the page on webglcontextrestored, so a phone that dropped the GPU for a second, or a
  // driver reset, threw the whole match away. three re-creates every GPU object from its CPU copy on first use
  // (textures from their images, buffers from their arrays, render targets and the shadow map from their
  // descriptions, programs recompile), and the sim never ran while the loop was stopped. So a match picks up where it
  // was: the card closes, the tier is re-applied, the loop restarts, and a SOLO match comes back paused, exactly as
  // from a hidden tab (the player resumes it). On the menu or mid-load there is nothing to keep: reload, as before.
  function resumable() { return !!W.match && (W.phase === "match" || W.phase === "drop" || W.phase === "over") && !W._starting; }
  kernel.onContextRestored = () => {
    if (!resumable()) { try { location.reload(); } catch (e) {} return; }
    try {
      try { if (W._errorCardHandle && W._errorCardHandle.close) W._errorCardHandle.close(); } catch (e) {}
      W._errorCardHandle = null;
      for (const id of ["lc-error-card", "ffg-kernel-error"]) { const el = document.getElementById(id); if (el) el.remove(); }
      W._errorCard = null;
      applyTier(W.settings.graphics, "restore");
      kernel.renderer.shadowMap.needsUpdate = true;
      if (kernel.start) kernel.start();
      pauseForHide();
      W._ctxRestores = (W._ctxRestores || 0) + 1;
      W._lastRestore = { t: Math.round(performance.now()), phase: W.phase, paused: !!W.paused, simT: +(W.t || 0).toFixed(2) };
    } catch (e) {
      console.error("[royale] resuming after the context came back failed; reloading:", e);
      try { location.reload(); } catch (x) {}
    }
  };
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
    // a new match starts with no sim debt and tick 0 (resume-primed on its first frame)
    LOOP.acc = 0; LOOP.frozen = true; LOOP.lastTicks = 0; W.simTick = 0; W.alpha = 1;
    progWatchReset();
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
    // actors: slot-based ids s0..s49 — online play maps humans onto slots
    // (each joining friend takes over a bot slot; disconnect re-attaches a brain)
    const total = W.mode === "practice" ? 1 : modeK.players;
    const humans = opts.humans || [{ slot: 0, name: W.settings.playerName || "You", self: true }];
    // C-MODE (parity LC-19, owner OD-4): the TEAM mode, orthogonal to the pace in W.mode. The menu / a squad room asks for
    // one (opts.teamMode); every human in the room is one team, so a room larger than the asked team size plays the
    // smallest mode that holds it. Teams are a pure function of (total, the humans' slots, mode): no rng draw, so the
    // world / sim streams and same-seed replay are untouched, and every peer of an online match derives the same teams.
    // The menu may pass it (opts.teamMode) or keep the player's last pick in W.settings.teamMode (lane hud's mode card).
    // The stored pick is an OFFLINE default only: an online match takes the room's choice (opts.*), never one page's own
    // setting, or two peers could derive different teams from one start message.
    const online = !!(opts.humans || opts.guestOf);
    const wantMode = opts.teamMode != null ? opts.teamMode : (!online && W.settings ? W.settings.teamMode : null);
    // D5: the start message's humans[].teamId (net.js rosterWithTeams) names the humans' teams. When EVERY human carries one, the teams
    // group by it and the mode must hold the largest such team; otherwise every human is one team (the rule above). net.js names all the
    // humans of a team mode "t0" and each solo human its own "s"+slot, so for today's starts this builds exactly the teams it always did.
    const humanTeams = humanTeamIdsOf(humans);
    const teamMode = resolveTeamMode(wantMode, humanTeams ? largestGroup(humanTeams) : humans.length, W.mode);
    const teamIds = assignTeams(total, humans.map((h) => h.slot), teamSize(teamMode), humanTeams);
    W.teamMode = teamMode;
    // teamOf is resolved LAZILY, at elimination time: the actors it reads are
    // created below this line, so a table built here would be empty. Without a
    // team-aware win condition, friendly-fire suppression hangs the match forever
    // at two surviving squadmates — Match.eliminate ends on one team left, and with
    // no resolver every player is their own team (sim/royale.js:499-506).
    W.match = new SIM.Match({
      players: modeK.players, mode: teamMode, pace: W.mode, teamSize: teamSize(teamMode),
      teamOf: (id) => { const a = W.actorById.get(id); return (a && a.teamId) || id; },
    });
    // C-MODE read surface, whatever sim/royale.js's Match does with the options above: mode = the team mode, pace = the
    // match pacing (quick | standard | practice, the same value as W.mode).
    W.match.mode = teamMode; W.match.pace = W.mode; W.match.teamSize = teamSize(teamMode);
    W.stormCtl = stormMod.createStorm(W);
    lootMod.populate(W);

    const names = shuffledNames(W);
    W.teams = new Map();             // teamId -> [actor ids], slot order (C-MODE)
    for (let i = 0; i < total; i++) {
      const hu = humans.find((x) => x.slot === i);
      const teamId = teamIds[i];
      if (!W.teams.has(teamId)) W.teams.set(teamId, []);
      W.teams.get(teamId).push("s" + i);
      if (hu) {
        // Every human in the lobby is one team (C-MODE above). Solo: the actor's own id, which is exactly what teamOf
        // fell back to before, so a solo match decides everything as it always did.
        const a = playerMod.createActor(W, { id: "s" + i, name: hu.name, isBot: false, teamId });
        a.netRemote = !hu.self;
        if (hu.self) W.player = a;
      } else {
        // a bot in the human's team is a bot TEAMMATE (duo / trio / squad): bots.js reads a.teamId for squad behaviour.
        // (No extra flag on the actor: every actor shares one hidden class, player.js createActor.)
        const bot = playerMod.createActor(W, { id: "s" + i, name: names[i % names.length], isBot: true, teamId });
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
    applyTier(W.settings.graphics, "match");

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
  async function warmMatch(slot, alive) {
    const extras = [];
    const seen = new Set();                 // the same object offered by two modules is parented once
    const by = {};                          // per-provider counts (W._warm.by) so a probe sees who contributed
    const add = (list, who) => {
      if (!list) return;
      if (list.isObject3D) list = [list];
      if (typeof list[Symbol.iterator] !== "function") return;
      let n = 0;
      for (const o of list) if (o && o.isObject3D && !seen.has(o)) { seen.add(o); extras.push(o); n++; }
      if (who) by[who] = (by[who] || 0) + n;
    };
    // C-WARM: EVERY module that exports warmObjects(W) - feature-detected, one throw
    // never costs the others their warm-up. Called after loadActorModels/spawnAll,
    // which player.warmObjects (LOD1 bodies) needs.
    for (const [name, mod] of MATCH_MODS.concat(EXTRA_MODS, WARM_ONLY)) {
      if (!mod || typeof mod.warmObjects !== "function") continue;
      try { add(mod.warmObjects(W), name); } catch (e) { console.warn("[royale] " + name + ".warmObjects threw:", e); by[name] = { error: String(e && e.message || e) }; }
    }
    if (W._weaponProtos) for (const k in W._weaponProtos) add([W._weaponProtos[k]], "weaponProtos");
    // pickup models (medkit, bandage, shield potions): already requested by
    // loot.populate; a bounded wait lets the ones that answer join the warm frame
    if (W.itemProto) {
      try {
        // the four heals + EVERY consumable the sim declares (P1-A frag; the P2 smoke and any later one join on their own
        // the moment lane loot gives them a model - an id without one answers null and adds nothing)
        const ids = ["medkit", "bandage", "mini_shield", "big_shield"];
        const CON = W.SIM && W.SIM.CONSUMABLES;
        if (CON) for (const id of Object.keys(CON)) if (!ids.includes(id)) ids.push(id);
        const got = await withTimeout(Promise.all(ids.map((id) => W.itemProto(id).catch(() => null))), 8000);
        add(got, "itemProtos");
      } catch (e) { /* bounded wait: the fallback capsules are already warm */ }
    }
    let stats = null;
    // a re-warm whose match was torn down during the pickup wait above warms nothing (the extras belong to a disposed world)
    if (alive && !alive()) { const rec = { extrasIn: extras.length, by, post: W._gfx && W._gfx.post, aborted: true }; W[slot || "_warm"] = rec; return rec; }
    try {
      if (typeof kernel.warmup === "function") stats = await kernel.warmup(alive ? { extras, alive } : { extras });
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
    const post = W._gfx && W._gfx.post;     // "direct" = low tier drew the warm frame straight to the canvas (stats.target says "composer" either way)
    const rec = stats ? Object.assign({ extrasIn: extras.length, by, post }, stats) : { extrasIn: extras.length, by, post, legacy: typeof kernel.warmup !== "function" };
    W[slot || "_warm"] = rec;               // the match-start warm stays in W._warm; a mid-match re-warm reports in W._rewarm
    return rec;
  }
  /** C-GFX: a tier change INSIDE a match (the Video tab, W.setGfx) that moves the draw route (low's direct canvas <-> the composer's RT)
   *  or turns the shadow pass on / off re-keys EVERY scene program (three keys a program on the output colour space and the shadow state).
   *  The switch frame only links what that one frame draws; whatever is off screen then (a bot across the map, a gun in a hand that was
   *  culled, a pickup out of cull range) linked on the frame it first came into view - measured: a MeshStandardMaterial body/gun program at
   *  frame 135 after medium -> low. So the same C7 warm-up the match start runs is re-run for the new route: every variant links at the
   *  switch (the player's own deliberate action), none later. One at a time; a change that lands while one runs queues ONE more. */
  const REWARM = { busy: false, again: null, n: 0, p: null };
  function rewarmRoute(why) {
    if (REWARM.busy) { REWARM.again = why; return REWARM.p; }
    REWARM.busy = true;
    REWARM.p = rewarmLoop(why);
    return REWARM.p;
  }
  async function rewarmLoop(why) {
    try {
      let w = why;
      while (w) {
        REWARM.again = null;
        if (!(W.match && !W._starting && (W.phase === "lobby" || W.phase === "drop" || W.phase === "match"))) break;
        const t0 = performance.now();
        // R1 boot (sky_lowtier boot row): the warm-up awaits (pickup models, the program-link wait); a tier change in a match
        // followed at once by the next match start ran teardownMatch under it. Bound the re-warm to the match it was for: once
        // that world is torn down or a new one is building, the remaining steps are skipped.
        const gen = W._matchGen | 0, match = W.match;
        const alive = () => (W._matchGen | 0) === gen && W.match === match && !W._starting;
        const rec = await warmMatch("_rewarm", alive);
        REWARM.n++;
        rec.why = w; rec.n = REWARM.n; rec.tier = W.gfxTier; rec.wallMs = Math.round(performance.now() - t0);
        w = REWARM.again;
      }
    } catch (e) { console.warn("[royale] tier re-warm failed:", e && e.message); }
    finally { REWARM.busy = false; }
  }

  function endMatch(victory) {
    if (W.phase === "over") return;
    // LC-44 FORFEIT: QUIT TO MENU while still alive used to fall through to aliveCount() + 1, which counts the quitter
    // too - "PLACEMENT 51 / 50" at the start of a match. Quitting is an elimination: record it through the sim first,
    // so the placement is the alive count at that moment (N / 50) and everything that reads placementOf agrees.
    // Only the local sim's bookkeeping: no death event, no kill feed line, nothing sent to peers.
    if (!victory && W.match && !W.match.over && W.player && W.player.alive && W.match.placementOf(W.player.id) == null) {
      const r = W.match.eliminate(W.player.id, null, "forfeit", W.t);
      W._forfeit = { t: +(W.t || 0).toFixed(2), placement: r ? r.placement : null, aliveAfter: W.match.aliveCount() };
    }
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
  /** post-match MAIN MENU, and the guest's rematch wait card's way out (net.js showWaitCard calls opts.onMenu after its own leave) */
  function backToMenu() {
    if (W.phase === "menu") return;
    W.phase = "menu"; netMod.leave(W); shadowsEveryFrame(); hudMod.showMenu(W, startMatch);
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
      onMenu: () => backToMenu(),
      // requeue straight into a fresh match (new random map, same mode) without
      // rebuilding the cinematic menu world and re-reading the skin GLBs
      // LC-18: in a squad room the next match keeps the room (net.rematch, lane P1-D) instead of leaving it; offline,
      // or with a net.js that has no rematch, the old path. randomMap() first and synchronously: it consumes the
      // "Run it back" map seam (hud.js _nextMap).
      // net.rematch(W, opts) returns TRUE when the squad takes it (host: the next match starts in the room; guest: it follows the
      // host, or waits on a card whose MAIN MENU is opts.onMenu) and FALSE when there is no live squad - it has already left the
      // room then, and the caller starts the solo match. (The P1 wiring ignored the boolean: a squad whose room had emptied
      // was left on the post-match panel with nothing loading.) The team mode carries over like the pace.
      onAgain: () => {
        const mapId = hudMod.randomMap();
        const next = { mapId, mode: W.mode, teamMode: W.teamMode };
        if (W.net && typeof netMod.rematch === "function") {
          let took = false;
          try { took = netMod.rematch(W, Object.assign({ onMenu: () => backToMenu() }, next)) === true; }
          catch (e) { console.warn("[royale] net.rematch failed, leaving the room instead:", e); }
          W._lastRematch = { t: Math.round(performance.now()), took, net: !!W.net };
          if (took) return;
        }
        if (W.net) netMod.leave(W);
        // a solo "Run it back" keeps the team mode only when it can be played without the room (a room of 2+ humans
        // resolved to duo/trio/squad: offline that is the same mode with bot teammates)
        startMatch(next);
      },
    };
  }
  W.endMatch = endMatch;

  // ── frame pipeline ──────────────────────────────────────────────────────────
  // Per-module profiler marks (contract C3), nested inside the kernel's own
  // "updaters" section. Only with ?prof=1: without it PROF is null and the frame
  // makes no profiler call at all.
  const PROF = kernel.prof && kernel.prof.enabled ? kernel.prof : null;

  // ── FIXED TICK (PLAN L4 phase B + L5 l, contract C5) ────────────────────────
  // A port of BLOCKTOOTH src/core/loop.ts:230-289. The SIMULATION advances in
  // whole SIM_DT ticks from an accumulator fed by the frame's real dt; the VIEW
  // runs once per rendered frame and draws actors interpolated between their
  // last two ticks (alpha = acc / SIM_DT). Before this, every module stepped
  // once per frame with that frame's dt: a jump peaked at a different height at
  // 30 Hz than at 144 Hz, cadence and movement depended on the display, and a
  // live match could never replay a fastForward one. Now:
  //   * dt is clamped to MAX_FRAME_DT and at most MAX_STEPS ticks run per frame;
  //     debt still owed after that is DROPPED (counted), never fast-forwarded
  //     (spiral-of-death guard) — a stalled tab never turns into a burst;
  //   * timeScale (hitstop, solo only) scales sim time only; the view keeps the
  //     real dt (feel G14: "timeScale scales SIM time only. Rendering always runs");
  //   * a pause or a non-match phase freezes the accumulator; resuming PRIMES it
  //     to just under one tick (RESUME_PRIME), so the first frame back continues
  //     from the last drawn state instead of popping half a tick backwards;
  //   * fastForward runs the SAME simTick at the same SIM_DT, so a seed replays
  //     identically through the live loop and through fastForward.
  // ONLINE (W.net) runs the same fixed tick (two-client sync measured — see the
  // note in the frame below); hitstop stays solo-only.
  const SIM_DT = 1 / 60, MAX_STEPS = 5, MAX_FRAME_DT = 0.1;
  const ACC_EPS = 1e-7, TICK_DUE = SIM_DT - ACC_EPS, RESUME_PRIME = 0.999;
  /** ONE simulation step of h seconds: bots, player.tick, weapons, loot, storm,
   *  net. The live accumulator and fastForward both call exactly this. */
  function simTick(h, live) {
    if (W.phase !== "over") W.t += h;
    if (PROF) PROF.begin("bots");
    botsMod.update(W, h);           // brains → bot input structs (staggered)
    if (PROF) { PROF.end("bots"); PROF.begin("player"); }
    if (playerMod.tick) playerMod.tick(W, h); else playerMod.update(W, h);   // movement + physics (all actors)
    if (PROF) { PROF.end("player"); PROF.begin("weapons"); }
    weaponsMod.update(W, h);        // fire/reload/projectiles/damage
    if (PROF) { PROF.end("weapons"); PROF.begin("loot"); }
    lootMod.update(W, h);           // pickups, chest channels
    if (PROF) { PROF.end("loot"); PROF.begin("storm"); }
    stormMod.update(W, h);          // circle, damage ticks, warnings
    if (PROF) PROF.end("storm");
    // net.js paces itself on performance.now() (12/8/5 Hz state, 10 Hz bots), so
    // it is indifferent to how often it is called; never from fastForward (the
    // deterministic harness path stays offline and silent).
    if (live && W.net) {
      if (PROF) PROF.begin("net");
      netMod.update(W, h);
      if (PROF) PROF.end("net");
    }
    W.simTick++;
    if (W._tickHook) W._tickHook(W);   // test surface only (harness replay probes)
  }
  // ── LATE-PROGRAM WATCH (every tier's "0 programs compiled after the first drop frame" bar) ───────────────────────
  // Armed on a match's first drop/match frame; the base is the program set once that frame has rendered. Any program
  // linked later is recorded (name, cache-key head, sim time, phase, tier) so a gate - or a lane adding a feature (frag,
  // smoke, DBNO, new guns, FX) - sees WHICH object was not warmed. O(1) per frame unless the program count changed.
  const PW = { state: 0, ids: null, n: 0, late: [] };
  function progWatchReset() { PW.state = 0; PW.ids = null; PW.n = 0; PW.late = []; }
  function progWatch() {
    const progs = kernel.renderer.info && kernel.renderer.info.programs;
    if (!progs) return;
    if (PW.state === 0) { PW.state = 1; return; }                       // the first drop frame renders after this call
    if (PW.state === 1) { PW.state = 2; PW.ids = new Set(progs.map((p) => p.id)); PW.n = progs.length; return; }
    if (progs.length === PW.n) return;
    PW.n = progs.length;
    for (const p of progs) {
      if (PW.ids.has(p.id)) continue;
      PW.ids.add(p.id);
      if (PW.late.length < 64) PW.late.push({ name: p.name || "", key: String(p.cacheKey || "").slice(0, 600), t: +(W.t || 0).toFixed(2),
        phase: W.phase, tier: W.gfxTier || W.settings.graphics, frame: kernel.frameNo });
    }
  }
  W.lateProgs = () => ({ armed: PW.state === 2, base: PW.ids ? PW.ids.size - PW.late.length : null, late: PW.late.slice() });

  W.loopStats = () => ({ simDt: SIM_DT, ticks: W.simTick, dropped: LOOP.dropped, lastTicks: LOOP.lastTicks, alpha: W.alpha, acc: LOOP.acc, frozen: LOOP.frozen, fixed: !W._netVarStep });

  kernel.onUpdate((dt) => {
    // cinematic menu world (orbit cam, water, storm ring, particles)
    if (W.phase === "menu") {
      LOOP.frozen = true;
      if (PROF) PROF.begin("menu");
      hudMod.updateMenuWorld(W, Math.min(dt, 0.05));
      if (PROF) PROF.end("menu");
      autoTierFrame();        // LC-06 first-run auto-tier (measures the menu's own frames)
      timerHousekeeping();
      return;
    }
    if (W.paused) { LOOP.frozen = true; timerHousekeeping(); return; }
    if (W.phase !== "match" && W.phase !== "drop" && W.phase !== "over") { LOOP.frozen = true; timerHousekeeping(); return; }
    if (W.phase === "over") timerHousekeeping(); else ladderFrame();   // LC-06 in-match quality ladder
    progWatch();
    // Victory hold: ~120° of orbit and a slow pull-back across the 2600 ms beat
    // endMatch already pays for. Read by player.js updateCamera — the winning
    // frame used to be a 34 px banner over a motionless world at the default
    // third-person 4.2 m.
    if (W._winHold) {
      W._winOrbit = (W._winOrbit || 0) + Math.min(dt, 0.05) * 0.8;
      W._winDist = Math.min(1.3, (W._winDist || 0) + Math.min(dt, 0.05) * 0.55);
    }
    const real = Math.min(dt, 0.05);
    // HITSTOP — the one Vlambeer technique this build shipped none of; nothing in
    // runtime/ scaled frame dt on impact (the only timeScale-shaped code was the
    // animation-mixer LOD in player.js). SOLO ONLY: net.js broadcasts at 12 Hz and
    // the host swaps a silent guest for a bot after 12 s, so slowing the sim on one
    // client drifts it off the link and reads as a dropout. Decremented with the
    // REAL dt so the freeze is the same wall-clock length whatever scale is applied.
    // It scales SIM time only (feel G14; BLOCKTOOTH loop.ts: "timeScale scales SIM
    // time only. Rendering always runs"): it is the accumulator's timeScale, and
    // the view (player.frame's camera, fx, hud, audio) gets the real dt.
    let timeScale = 1;
    if (W.hitstopT > 0) {
      W.hitstopT = Math.max(0, W.hitstopT - dt);
      if (!W.net) timeScale = 0.12;
    }
    W.frameDt = real;
    followShadow();

    let alpha = 1;
    if (W._netVarStep) {
      // TEST SWITCH ONLY (never set by the game): the pre-tick stepping, one
      // simTick per frame with the frame's dt, drawn at alpha 1 — kept so the
      // two-client sync probe can compare both. ONLINE RUNS THE FIXED TICK: PLAN
      // section 7 made that conditional on a two-client SQUAD UP session still
      // syncing; measured 2026-10-01 (T-tick-actors netsync.py: real net.js over
      // Supabase Realtime, a private room, host + guest stepped at a cycling
      // 1/30..1/144 frame dt, the same map + seed for 2 runs per mode): match
      // clock p90 0.033-0.041 s (variable step 0.024-0.037), each human's copy on
      // the other client p90 <= 1.09 m (<= 1.01), guest bots median 1.52-1.64 m
      // (1.51-1.54), p90 3.35-3.63 m (3.06-3.11), every death the same victim in
      // the same order on both clients, no hostLost, 0 page errors.
      LOOP.frozen = true;
      simTick(real, true);
      LOOP.lastTicks = 1;
    } else {
      if (LOOP.frozen) { LOOP.frozen = false; LOOP.acc = SIM_DT * RESUME_PRIME; }
      LOOP.acc += Math.min(dt, MAX_FRAME_DT) * timeScale;
      let n = 0;
      while (LOOP.acc >= TICK_DUE && n < MAX_STEPS) {
        LOOP.acc = Math.max(0, LOOP.acc - SIM_DT);
        simTick(SIM_DT, true);
        n++;
        // a tick that paused or left the match (match end -> menu) stops here
        if (W.paused || (W.phase !== "match" && W.phase !== "drop" && W.phase !== "over")) break;
      }
      // spiral-of-death guard: whatever is still owed after the cap is dropped
      if (LOOP.acc >= TICK_DUE) { LOOP.dropped += Math.floor((LOOP.acc + ACC_EPS) / SIM_DT); LOOP.acc = 0; }
      alpha = LOOP.acc / SIM_DT;
      alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      LOOP.lastTicks = n;
    }
    W.alpha = alpha;

    // ── view: once per rendered frame, real dt ──
    if (PROF) PROF.begin("player");
    if (playerMod.frame) playerMod.frame(W, real, alpha);   // interpolated actors, camera (live mouse look), view pass
    if (PROF) { PROF.end("player"); PROF.begin("fx"); }
    fxMod.update(W, real);          // particles, tracers, damage numbers
    if (PROF) { PROF.end("fx"); PROF.begin("hud"); }
    hudMod.update(W, real);         // bars, minimap, feed, timers
    if (PROF) PROF.end("hud");
    // audio.js had NO per-frame hook at all — it exported only init/setVolumes/
    // startMenuMusic/startMatchMusic/onMatchEnd, so listener sync, the storm bed,
    // ambience and the music duck had nowhere to live. Deliberately NOT added to
    // fastForward: that path is the deterministic test harness and must stay
    // silent and rAF-free. Guarded because audio.js lands `update` in a
    // parallel change and an unguarded call here would throw every frame.
    if (audioMod.update) {
      if (PROF) PROF.begin("audio");
      audioMod.update(W, real);
      if (PROF) PROF.end("audio");
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
      map: W.mapId, mode: W.mode, seed: W.seed, teamMode: W.teamMode,
    }),
    // synchronous fast-forward for deterministic tests (no rAF dependency).
    // An INTEGER step count: `for (t = 0; t < s; t += h)` accumulated float error,
    // so fastForward(0.5, 1/30) ran 16 steps (0.533 s) instead of 15 (bots S4).
    // ceil(s/h - 1e-9) keeps the old count wherever s/h is not a whole number.
    // FIXED TICK: it runs the live loop's own simTick at SIM_DT (stepS is accepted
    // for old callers and no longer sets the step size), plus the player view at
    // alpha 1 after each tick (camera + view pass, as player.update did here),
    // so the same seed replays identically here and through the live accumulator.
    // An integer tick count; W.t advances by exactly n * SIM_DT.
    fastForward: (seconds, stepS) => {
      const n = Math.max(0, Math.ceil((+seconds || 0) / SIM_DT - 1e-9));
      for (let i = 0; i < n; i++) {
        simTick(SIM_DT, false);
        if (playerMod.frame) playerMod.frame(W, SIM_DT, 1);
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
// Bot names: random player handles, new every match (owner 2026-10-13). The old pool shuffle still runs so the world rng
// stream (and so every sim result) is exactly what it was; the handles are seeded from that shuffled order, so every peer
// of an online match draws the same names.
function shuffledNames(W) {
  const pool = window.FFG.sim.Royale.BOT_NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(W.rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  let h = 0x811c9dc5;
  for (const ch of pool.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return randomHandles(64, { rng: handleRng(h) });
}
// ── C-MODE team modes (parity LC-19) ──────────────────────────────────────────
// K.TEAM_SIZE (sim/royale.js, lane sim) is the source of truth; until it exists the contract's own table stands in.
const TEAM_SIZE_DEF = Object.freeze({ solo: 1, duo: 2, trio: 3, squad: 4 });
function teamSizes() {
  const T = SIM && SIM.TEAM_SIZE;
  return T && typeof T === "object" && T.solo >= 1 ? T : TEAM_SIZE_DEF;
}
function teamSize(mode) { return teamSizes()[mode] || 1; }
/** The team mode a match is played in. `want` = the menu's / the room's choice. PRACTICE is always solo. Every human in
 *  the room is one team, so a room holding more humans than `want` allows plays the smallest mode that holds them all
 *  (a 3-human room that asked for duos plays trios); no choice at all = solo alone, the smallest fit for a room. */
function resolveTeamMode(want, nHumans, pace) {
  const T = teamSizes();
  const n = Math.max(1, nHumans | 0);
  if (pace === "practice") return "solo";
  if (want && T[want] >= n) return want;
  const order = Object.keys(T).sort((a, b) => T[a] - T[b]);
  for (const k of order) if (T[k] >= n) return k;
  return order[order.length - 1];
}
/** teamId per slot, a pure function of (total, the humans' slots, size). Solo (size 1): the actor's own id (exactly what
 *  Match.teamOf fell back to before teams existed). Team modes: team "t0" = every human + the lowest free bot slots up to
 *  the team size (the human's bot teammates, OD-4); the remaining bot slots, in slot order, fill t1, t2, ... (the last
 *  team may be short when the lobby does not divide evenly). */
function assignTeams(total, humanSlots, size, humanTeams) {
  const out = new Array(total);
  if (!(size > 1)) { for (let i = 0; i < total; i++) out[i] = "s" + i; return out; }
  // D5: the humans' own teamIds (the start message's), else one team "t0" for every human
  const want = [];                          // [slot, teamId] of the humans inside the lobby, in the order given
  const seen = new Set();
  humanSlots.forEach((s, k) => {
    if (!(s >= 0 && s < total) || seen.has(s)) return;
    seen.add(s);
    want.push([s, humanTeams ? humanTeams[k] : "t0"]);
  });
  // the humans' teams, in the order of each one's lowest human slot (deterministic on every peer)
  want.sort((a, b) => a[0] - b[0]);
  const groups = new Map();                 // teamId -> members so far
  for (const [s, id] of want) { out[s] = id; groups.set(id, (groups.get(id) || 0) + 1); }
  // bot teammates: each human team takes the lowest free bot slots up to the team size (a team already over it keeps its humans)
  let cur = 0;
  for (const [id, n0] of groups) {
    let n = n0;
    for (; n < size && cur < total; cur++) { if (out[cur]) continue; out[cur] = id; n++; }
  }
  // the remaining bot slots, in slot order, fill t1, t2, ... (skipping a name a human team already holds); the last may be short
  let team = 1, inTeam = 0;
  const nextFree = () => { while (groups.has("t" + team)) team++; return "t" + team; };
  let tid = nextFree();
  for (let i = 0; i < total; i++) {
    if (out[i]) continue;
    out[i] = tid;
    if (++inTeam >= size) { team++; inTeam = 0; tid = nextFree(); }
  }
  return out;
}
/** D5: the teamId of every human (index-aligned with `humans`) when EVERY one carries a usable teamId (a non-empty string of at most 24
 *  chars, net.js's own bound), else null (the boot's rule: all humans are one team). */
function humanTeamIdsOf(humans) {
  if (!Array.isArray(humans) || !humans.length) return null;
  const ids = humans.map((h) => (h && typeof h.teamId === "string" && h.teamId.length > 0 && h.teamId.length <= 24 ? h.teamId : null));
  return ids.every((x) => x) ? ids : null;
}
/** the size of the largest group of equal ids */
function largestGroup(ids) {
  const c = new Map();
  let m = 0;
  for (const id of ids) { const n = (c.get(id) || 0) + 1; c.set(id, n); if (n > m) m = n; }
  return m;
}
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
/** Reject after `ms` (a bounded wait on an optional asset; never a hang). */
function withTimeout(p, ms) {
  let to = 0;
  const timer = new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timed out after " + ms + " ms")), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(to));
}

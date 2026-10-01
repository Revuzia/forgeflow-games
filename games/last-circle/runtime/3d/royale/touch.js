/**
 * royale/touch.js — Last Circle's own on-screen touch controls (PLAN L10, contract C6).
 * A port of games/dyefield/runtime/src/touch/controls.ts (DYEFIELD _spec/CONTRACT_MOBILE.md M2) to plain ESM.
 *
 * Pointer Events only: every control reacts to pointerType "touch" (and "pen"), tracks each finger by pointerId and
 * captures it (setPointerCapture), so any number of simultaneous touches work (move + look + FIRE is the baseline).
 * game_controls.js runs Last Circle with the "native" profile, so the page-level overlay (#__ffg_touch__) is never
 * built and this is the only touch layer.
 *
 * LAYOUT (landscape, right-handed; W.settings.touchLeftHanded mirrors stick and cluster; CSS px x touchScale
 * 0.8-1.3; every target >= 44 px; all positions from the env(safe-area-inset-*) edges). The numbers L7 lays the
 * phone HUD around:
 *
 *   control  data-touch-ui  centre: dx from the RIGHT edge, dy from the BOTTOM edge   diameter   rect at scale 1
 *   JUMP     jump           dx  52, dy  84                                             64         W-84 .. W-20,  H-116 .. H-52
 *   FIRE     fire           dx 150, dy 116                                             88         W-194.. W-106, H-160 .. H-72
 *   RELOAD   reload         dx 250, dy  70                                             56         W-278.. W-222, H-98  .. H-42
 *   ADS      ads            dx  50, dy 184                                             56         W-78 .. W-22,  H-212 .. H-156
 *   USE      use            dx 138, dy 222                                             60         W-168.. W-108, H-252 .. H-192
 *   PAUSE    pause          top-right, 10 px in from the right and top edges          44         W-54 .. W-10,  10 .. 54
 *   STICK    stick          floating; faint base at home, centre (94, H-94) from LEFT  120 (knob 52)  34 .. 154, H-154 .. H-34
 *
 *   MOVE zone  x < 0.45 W and y >= band (band = top inset + clamp(0.18 H, 56, 120)): the stick base appears under
 *              the thumb; output = analog mx/mz in [-1, 1] from where the thumb LANDED, radial deadzone 0.12, linear
 *              after it, drag-follow past the rim. Full deflection while pushing forward = auto-sprint.
 *   LOOK zone  x >= 0.45 W at any height that does not start on a button: dyaw = -dx*0.0040*sens*accel,
 *              dpitch = -dy*0.0032*sens*accel, accel = 1 + 0.6*clamp((speed - 600 px/s) / 1400, 0, 1) (sens =
 *              W.settings.touchSens, default 1; the consumer then applies the mouse's sensitivity / adsSensitivity).
 *              A drag that STARTS on FIRE also looks.
 *   The left 45 % top band is inert (the pad takes it so a touch there never reaches the canvas).
 *   The portal control bar (#__ff_controls__, bottom-right, ~96 x 34) is measured on layout: if a button would come
 *   within 6 px of it the whole cluster shifts up by that much (the table already clears the default bar).
 *
 * Z-ORDER: #lc-touch is a sibling of the HUD root inside W.kernel.parent at z-index 39, directly UNDER the HUD
 * root (z 40). HUD elements that take taps (L7: slots, minimap, pause / death / settings cards) therefore win; the
 * rest of the screen is this layer's pad. L7's capture-phase HUD tap handler stops those touches before they reach
 * the pad.
 *
 * VISIBLE only in touch mode while a match is playing: phase "drop" or "match", the local player alive, not paused.
 * Hidden in the menu, lobby, death / spectate, post-match, pause. Hiding drops every touch (captures released, the
 * stick zeroed, every held button released, ADS off).
 *
 * C6 — W.touch (the only surface other modules read):
 *   active   touch mode is on: a coarse-only pointer at boot, or the last input was a touch (a trusted mouse press
 *            turns it off; ?touch=1 / ?touch=0 force it). hud.isTouchMode() is followed when L7 exports it.
 *   mx, mz   analog stick, camera-relative, |v| <= 1; mx > 0 = right, mz > 0 = forward (player.js's D-A / W-S signs)
 *   fire     FIRE held (weapons.js re-arms a semi-auto at its own rate while it is held; the press also sets
 *            W._fireEdge, the same 420 ms click buffer a mouse click sets, so a quick tap is never swallowed)
 *   use      USE held (the press edge = a tap-E item swap, held = the chest channel)
 *   jump     JUMP held (the press edge = one jump / one chute toggle)
 *   reload   RELOAD held (the press edge = one reload)
 *   pause    PAUSE held (the press edge = the game's pause path, "escPressed")
 *            fire / use / jump / reload / pause are LEVELS: true while the button is down, and every press stays
 *            true for at least one frame (a tap shorter than a frame still reaches the next frame). A consumer acts on
 *            the press EDGE of jump / reload / pause (false -> true), exactly like a key press.
 *   ads      the ADS toggle's state (a tap flips it)
 *   sprint   auto-sprint: the stick at full deflection while pushing forward
 *   takeLook() -> {dyaw, dpitch}: radians accumulated since the last call, zeroed by the read: 0.0040 / 0.0032 rad
 *            per px x touchSens x acceleration. The consumer scales them by the SAME sensitivity setting the mouse
 *            uses (W.settings.sensitivity, adsSensitivity while ADS) and applies aimassist.js. The returned object is
 *            reused: read it at once. Call it EVERY frame while W.touch.active (even when it returns zeros): that is
 *            how touch.js knows a C6 consumer exists.
 *   visible  the overlay is on screen.    readback()  harness read-back (rects, totals, bridge state).
 *   applyTo(inp, dt)  ADDITIVE helper: the whole merge in one call (look x sensitivity + aim assist; jump / reload /
 *            pause / USE press edges; USE held; fire / ads / sprint OR-ed; the stick over mx / mz when deflected).
 *            Call it at the END of player.js's per-frame input rebuild while W.touch.active. Counts as a consumer.
 *
 * FALLBACK BRIDGE: until a C6 consumer (L5's installHumanInput) calls takeLook(), touch.js drives the local player
 * itself so the layer works on its own: look (x sensitivity, + aim assist) into input.yaw / input.pitch, the press
 * edges into input.jump / input.reload / interact and the pause path, USE held into interactDown, and mx / mz / fire /
 * ads / sprint OR-ed over the keyboard values through accessors on W.player.input (player.js rebuilds those five from
 * the keyboard every frame). The bridge stands down (accessors removed) as soon as anyone else calls
 * W.touch.takeLook() - from then on the consumer owns every edge, pause included - and never runs with
 * ?touchbridge=0.
 *
 * WIRING: importing this module installs it (it waits for window.__LC__.W). The orchestrator may also call
 * install(W, { hud: hudMod }) explicitly; both are idempotent (one layer per page).
 */

const SEARCH = (() => { try { return new URL(import.meta.url).search || ""; } catch (e) { return ""; } })();
// ?v= must propagate to intra-runtime imports (FFG gotcha)
const AA = await import("./aimassist.js" + SEARCH);

export const TOUCH = {
  moveZone: 0.45,
  stickBase: 120,
  stickKnob: 52,
  stickHomePad: 34,
  deadzone: 0.12,
  lookYawPerPx: 0.0040,
  lookPitchPerPx: 0.0032,
  accelFromPxS: 600,
  accelSpanPxS: 1400,
  accelGain: 0.6,
  minTarget: 44,
  scaleMin: 0.8,
  scaleMax: 1.3,
  opacityMin: 0.35,
  opacityMax: 1,
  hapticPress: 8,
  sprintOn: 0.97,      // stick magnitude (before the deadzone remap) that starts auto-sprint ...
  sprintOff: 0.9,      // ... and the one it must fall below to stop
  sprintFwd: 0.55,     // forward share of the output needed (player.js sprints only when mz > 0.5)
  barGap: 6,
  pauseD: 44,
  pausePad: 10,
  zIndex: 39,
  pitchMax: 1.35,      // player.js mouse clamp
};

/** the thumb cluster (right-handed): centre (dx from the right safe edge, dy from the bottom safe edge), diameter */
export const CLUSTER = [
  { id: "jump", dx: 52, dy: 84, d: 64, label: "Jump (while gliding: open or cut the parachute)" },
  { id: "fire", dx: 150, dy: 116, d: 88, label: "Fire (hold; drag to aim)" },
  { id: "reload", dx: 250, dy: 70, d: 56, label: "Reload" },
  { id: "ads", dx: 50, dy: 184, d: 56, label: "Aim down sights (tap to zoom in, tap again to zoom out)" },
  { id: "use", dx: 138, dy: 222, d: 60, label: "Use (hold to open a chest, tap to swap in an item)" },
];

const ICON = {
  fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="2.2"/>'
    + '<path d="M12 1.8v5M12 17.2v5M1.8 12h5M17.2 12h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/></svg>',
  jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14.5 12 7.5l7 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M7 19.5h10" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>',
  chute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 11.5C3.4 6.3 7.3 3.2 12 3.2s8.6 3.1 9.5 8.3c-1.6-1.2-3.1-1.2-4.7 0-1.6-1.2-3.2-1.2-4.8 0-1.6-1.2-3.2-1.2-4.8 0-1.6-1.2-3.1-1.2-4.7 0z" fill="currentColor"/>'
    + '<path d="M3.5 11.8 11 19M20.5 11.8 13 19M12 11.5V19" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="9.6" y="18.4" width="4.8" height="3.6" rx="1.2" fill="currentColor"/></svg>',
  reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
    + '<path d="M19.8 3.6v4.6h-4.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ads: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<path d="M12 5.4v4.2M12 14.4v4.2M5.4 12h4.2M14.4 12h4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  use: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.4 12.6V5.4a1.6 1.6 0 0 1 3.2 0v5.4V4.2a1.6 1.6 0 0 1 3.2 0v6.6V5.6a1.6 1.6 0 0 1 3.2 0v8.2c0 4.1-2.6 7-6.4 7-2.7 0-4.4-1.4-5.7-3.6L4 12.9a1.5 1.5 0 0 1 2.4-1.8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/></svg>',
};

const CSS = `
#lc-touch { position: absolute; inset: 0; z-index: ${TOUCH.zIndex}; pointer-events: none; touch-action: none;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  --lct-o: .75; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
#lc-touch[hidden] { display: none !important; }
#lc-touch * { box-sizing: border-box; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
#lc-touch .lct-safe { position: absolute; visibility: hidden; pointer-events: none;
  left: env(safe-area-inset-left, 0px); top: env(safe-area-inset-top, 0px);
  right: env(safe-area-inset-right, 0px); bottom: env(safe-area-inset-bottom, 0px); }
#lc-touch .lct-pad { position: absolute; inset: 0; pointer-events: auto; touch-action: none; background: transparent; }
#lc-touch .lct-stick { position: absolute; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(6,14,28,.16) 0 55%, rgba(6,14,28,.30) 56% 100%);
  border: 2px solid rgba(220,236,255,.55); opacity: calc(var(--lct-o) * .55); transition: opacity .12s ease; }
#lc-touch .lct-stick.on { opacity: 1; }
#lc-touch .lct-knob { position: absolute; left: 50%; top: 50%; border-radius: 50%; pointer-events: none;
  background: rgba(220,236,255,.82); border: 2px solid rgba(6,14,28,.75); box-shadow: 0 2px 6px rgba(0,0,0,.45);
  transform: translate(-50%, -50%); will-change: transform; }
#lc-touch .lct-sprint { position: absolute; left: 50%; top: 5px; width: 26px; height: 14px; margin-left: -13px;
  pointer-events: none; opacity: 0; color: #7fffd0; transition: opacity .1s ease; }
#lc-touch .lct-sprint svg { width: 100%; height: 100%; display: block; }
#lc-touch .lct-stick.sprint .lct-sprint { opacity: 1; }
#lc-touch .lct-stick.sprint { border-color: rgba(127,255,208,.9); }
#lc-touch .lct-btn { position: absolute; border-radius: 50%; display: grid; place-items: center;
  pointer-events: auto; touch-action: none; cursor: default; color: #eef6ff;
  background: rgba(8,16,30,.46); border: 2px solid rgba(220,236,255,.78); box-shadow: 0 3px 0 rgba(0,0,0,.4);
  opacity: var(--lct-o); transition: transform .06s ease, opacity .08s ease, filter .15s ease; }
#lc-touch .lct-btn.down { opacity: 1; transform: scale(.94); }
#lc-touch .lct-btn.dim { filter: grayscale(.85) brightness(.7); }
#lc-touch .lct-ico { display: grid; place-items: center; width: 56%; height: 56%; pointer-events: none; }
#lc-touch .lct-ico svg { width: 100%; height: 100%; display: block; pointer-events: none; }
#lc-touch .lct-fire { background: rgba(255,92,72,.42); border-width: 3px; }
#lc-touch .lct-fire .lct-ico { width: 60%; height: 60%; }
#lc-touch .lct-ads.on { opacity: 1; background: rgba(230,244,255,.92); color: #0b1830; border-color: #7fd8ff;
  box-shadow: 0 3px 0 rgba(0,0,0,.4), 0 0 0 4px rgba(127,216,255,.45); }
#lc-touch .lct-use.ready { opacity: 1; border-color: #ffd166; color: #ffd166; }
#lc-touch .lct-use::before { content: ''; position: absolute; inset: -6px; border-radius: 50%; pointer-events: none;
  opacity: 0; background: conic-gradient(#ffd166 calc(var(--p, 0) * 360deg), rgba(8,16,30,.35) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px)); }
#lc-touch .lct-use.chan::before { opacity: 1; }
#lc-touch .lct-pause { background: rgba(8,16,30,.6); }
@media (prefers-reduced-motion: reduce) { #lc-touch .lct-btn, #lc-touch .lct-stick, #lc-touch .lct-sprint { transition: none; } }
`;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// ───────────────────────────── module state (one layer per page) ─────────────────────────────
const S = {
  W: null, hud: null, installed: false, built: false, disposed: false,
  forced: null,            // ?touch=1 / ?touch=0
  bridgeAllowed: true,     // ?touchbridge=0 turns the fallback bridge off
  ownMode: false,          // this module's own input-mode detector (used when hud.isTouchMode is absent)
  root: null, pad: null, safeProbe: null, stickEl: null, knobEl: null, sprintEl: null,
  btns: new Map(), tracks: new Map(), offs: [],
  visible: false,
  stickId: null, ox: 0, oy: 0, cx: 0, cy: 0, homeX: 0, homeY: 0, baseR: TOUCH.stickBase / 2, stickMag: 0,
  vw: 0, vh: 0, safe: { l: 0, t: 0, r: 0, b: 0 }, band: 64, scale: 1, lh: false, clusterShift: 0,
  lookYaw: 0, lookPitch: 0, totalYaw: 0, totalPitch: 0, lookMoved: false,
  frameNo: 0, extTakes: 0, consumerFrame: -1e9, visibleFrames: 0,
  bridgeOn: false, bridgedInput: null, useWas: false,
  // every press stays visible for >= 1 frame: a release in the same frame as its press waits for frame()
  pressFrame: { fire: -1, use: -1, jump: -1, reload: -1, pause: -1 },
  pendingRelease: { fire: false, use: false, jump: false, reload: false, pause: false },
  // presses the bridge / applyTo have turned into input edges (they act once per press, never per frame)
  applied: { use: 0, jump: 0, reload: 0, pause: 0 }, edgeOwner: false,
  presses: { fire: 0, jump: 0, reload: 0, use: 0, ads: 0, pause: 0 },
  assist: { slow: 1, dyaw: 0, dpitch: 0, target: -1 },
  ui: { fireDim: null, chute: null, useReady: null, useChan: null, useP: -1, ads: null, sprint: null },
  foes: [], foePool: [], eye: { x: 0, y: 0, z: 0 },
};
const _look = { dyaw: 0, dpitch: 0 };
const _bridgeLook = { dyaw: 0, dpitch: 0 };

/** C6: the shared touch state (W.touch). */
const T = {
  active: false,
  mx: 0, mz: 0,
  fire: false, jump: false, use: false, ads: false, sprint: false, reload: false, pause: false,
  visible: false,
  /** C6: accumulated look radians since the last call (reused object - read at once). */
  takeLook() { S.extTakes++; return take(_look); },
  readback() { return readback(); },
};

function take(o) {
  o.dyaw = S.lookYaw; o.dpitch = S.lookPitch;
  S.lookYaw = 0; S.lookPitch = 0;
  return o;
}

// ───────────────────────────── settings (feature-detected; L7 may add the rows) ─────────────────────────────
function setting(key, d) {
  const s = S.W && S.W.settings;
  return s && s[key] !== undefined ? s[key] : d;
}
const sens = () => clamp(num(+setting("touchSens", 1), 1), 0.3, 3);
const scaleOpt = () => clamp(num(+setting("touchScale", 1), 1), TOUCH.scaleMin, TOUCH.scaleMax);
const opacityOpt = () => clamp(num(+setting("touchOpacity", 0.75), 0.75), TOUCH.opacityMin, TOUCH.opacityMax);
const leftHanded = () => setting("touchLeftHanded", false) === true;
function assistStrength() {
  const v = setting("aimAssist", true);
  if (v === false) return 0;
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, 0, 1) : 1;
}

// ───────────────────────────── input mode ─────────────────────────────
function coarseOnly() {
  try {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches);
  } catch (e) { return false; }
}
function wantMode() {
  if (S.forced !== null) return S.forced;
  if (S.hud && typeof S.hud.isTouchMode === "function") { try { return !!S.hud.isTouchMode(); } catch (e) { /* fall through */ } }
  return S.ownMode;
}
function setMode(on) {
  if (T.active === on) return;
  T.active = on;
  try {
    document.documentElement.classList.toggle("lc-touch-ui", on);
  } catch (e) { /* no document */ }
  // L7 (C6): the HUD's touch mode. Same state whichever side flipped first; idempotent there.
  if (S.hud && typeof S.hud.setTouchMode === "function") {
    try {
      const hudOn = typeof S.hud.isTouchMode === "function" ? !!S.hud.isTouchMode() : null;
      if (hudOn !== on) S.hud.setTouchMode(S.W, on);
    } catch (e) { console.warn("[touch] hud.setTouchMode", e); }
  }
  if (S.W && S.W.events) { try { S.W.events.emit("touchMode", on); } catch (e) { /* listener threw */ } }
  if (!on) setVisible(false);
}

// ───────────────────────────── install ─────────────────────────────
/** Find the hud.js instance the game itself loaded (same URL, so the same module), never a second copy. */
async function findHud() {
  try {
    let url = new URL("./hud.js" + SEARCH, import.meta.url).href;
    const ents = (performance.getEntriesByType && performance.getEntriesByType("resource")) || [];
    const hit = ents.find((e) => /\/royale\/hud\.js(\?|$)/.test(e.name));
    if (hit) url = hit.name;
    else if (!ents.some((e) => e.name === url)) return null;          // never load hud.js a second time
    return await import(url);
  } catch (e) { return null; }
}

/**
 * Install the touch layer on the game world W (idempotent; one layer per page).
 * opts.hud: the hud module the game uses (else it is found through the loaded resources).
 */
export function install(W, opts) {
  if (!W || !W.kernel) return T;
  if (S.installed) { if (opts && opts.hud && !S.hud) S.hud = opts.hud; return T; }
  S.installed = true;
  S.W = W;
  if (opts && opts.hud) S.hud = opts.hud;
  const q = (typeof location !== "undefined" && location.search) || "";
  const mf = /[?&]touch=([01])(?:&|$)/.exec(q);
  S.forced = mf ? mf[1] === "1" : null;
  S.bridgeAllowed = !/[?&]touchbridge=0(?:&|$)/.test(q);
  S.ownMode = coarseOnly();
  W.touch = T;
  if (!S.hud) findHud().then((m) => { if (m && !S.hud) S.hud = m; }).catch(() => {});
  // input-mode detector (L7's hud.js runs the same rule; whichever exists is followed): a touch turns touch mode on,
  // a trusted mouse press turns it off. Capture phase on window, so it sees every press whatever stops it later.
  const onPD = (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") S.ownMode = true;
    else if (e.pointerType === "mouse" && e.isTrusted && S.tracks.size === 0) S.ownMode = false;
  };
  window.addEventListener("pointerdown", onPD, true);
  const relax = () => releaseAll();
  const onVis = () => { if (document.visibilityState === "hidden") releaseAll(); };
  window.addEventListener("blur", relax);
  document.addEventListener("visibilitychange", onVis);
  S.offs.push(() => {
    window.removeEventListener("pointerdown", onPD, true);
    window.removeEventListener("blur", relax);
    document.removeEventListener("visibilitychange", onVis);
  });
  W.kernel.onUpdate((dt) => { try { frame(dt); } catch (e) { console.error("[touch] frame", e); } });
  window.__LC_TOUCH__ = { W, touch: T, readback, install, dispose };
  return T;
}

function build() {
  if (S.built || !S.W) return;
  S.built = true;
  if (!document.getElementById("lct-css")) {
    const st = document.createElement("style");
    st.id = "lct-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  const root = document.createElement("div");
  root.id = "lc-touch";
  root.className = "lct-root";
  root.hidden = true;
  root.setAttribute("aria-label", "Touch controls");
  S.root = root;
  S.safeProbe = document.createElement("div");
  S.safeProbe.className = "lct-safe";
  S.pad = document.createElement("div");
  S.pad.className = "lct-pad";
  S.stickEl = document.createElement("div");
  S.stickEl.className = "lct-stick";
  S.stickEl.setAttribute("data-touch-ui", "stick");
  S.knobEl = document.createElement("div");
  S.knobEl.className = "lct-knob";
  S.sprintEl = document.createElement("div");
  S.sprintEl.className = "lct-sprint";
  S.sprintEl.innerHTML = '<svg viewBox="0 0 26 14" aria-hidden="true"><path d="M3 12 13 3l10 9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  S.stickEl.append(S.knobEl, S.sprintEl);
  root.append(S.safeProbe, S.pad, S.stickEl);
  const mk = (id, d, label) => {
    const e = document.createElement("div");
    e.className = "lct-btn lct-" + id;
    e.setAttribute("data-touch-ui", id);
    e.setAttribute("role", "button");
    e.setAttribute("aria-label", label);
    const icon = document.createElement("span");
    icon.className = "lct-ico";
    icon.innerHTML = ICON[id] || "";
    e.append(icon);
    root.append(e);
    const b = { id, el: e, icon, d, down: 0 };
    S.btns.set(id, b);
    listen(e, b);
    return b;
  };
  for (const c of CLUSTER) mk(c.id, c.d, c.label);
  mk("pause", TOUCH.pauseD, "Pause");
  S.btns.get("ads").el.setAttribute("aria-pressed", "false");
  listen(S.pad, null);
  const host = S.W.kernel.parent || document.body;
  host.appendChild(root);
  const relayout = () => { if (S.visible) layout(); };
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  const vv = window.visualViewport;
  if (vv) vv.addEventListener("resize", relayout);
  let ro = null;
  try { ro = new ResizeObserver(relayout); ro.observe(root); ro.observe(S.safeProbe); } catch (e) { ro = null; }
  S.offs.push(() => {
    window.removeEventListener("resize", relayout);
    window.removeEventListener("orientationchange", relayout);
    if (vv) vv.removeEventListener("resize", relayout);
    if (ro) ro.disconnect();
  });
}

/** shown only in touch mode while a match is playing (frame() decides; a no-op when unchanged) */
function setVisible(on) {
  if (on === S.visible) return;
  if (on && !S.built) build();
  S.visible = on;
  T.visible = on;
  if (!on) { releaseAll(); S.visibleFrames = 0; }
  if (S.root) S.root.hidden = !on;
  if (on) layout();
}

// ───────────────────────────── layout ─────────────────────────────
function measure() {
  const k = S.W && S.W.kernel;
  // C1 (L3): the kernel's cached view size; the root's own box otherwise
  S.vw = (k && k.viewW) || S.root.clientWidth || window.innerWidth;
  S.vh = (k && k.viewH) || S.root.clientHeight || window.innerHeight;
  const r = S.safeProbe.getBoundingClientRect();
  const rr = S.root.getBoundingClientRect();
  S.safe = {
    l: Math.max(0, r.left - rr.left), t: Math.max(0, r.top - rr.top),
    r: Math.max(0, rr.right - r.right), b: Math.max(0, rr.bottom - r.bottom),
  };
  S.rootLeft = rr.left; S.rootTop = rr.top;
  S.band = S.safe.t + clamp(S.vh * 0.18, 56, 120);
}

function place(e, cx, cy, d) {
  e.style.width = d + "px";
  e.style.height = d + "px";
  e.style.left = (cx - d / 2) + "px";
  e.style.top = (cy - d / 2) + "px";
}

function layout() {
  if (!S.root) return;
  measure();
  const s = S.scale = scaleOpt();
  const lh = S.lh = leftHanded();
  S.root.style.setProperty("--lct-o", String(opacityOpt()));
  const W = S.vw, H = S.vh, safe = S.safe;
  // the portal control bar (game_controls.js) lives bottom-right: keep every button >= barGap px clear of it
  let shift = 0;
  const bar = document.getElementById("__ff_controls__");      // position:fixed, so no offsetParent test
  const br = bar && bar.isConnected ? bar.getBoundingClientRect() : null;
  const pos = [];
  for (const c of CLUSTER) {
    const d = Math.max(TOUCH.minTarget, c.d * s);
    const cy = H - safe.b - c.dy * s;
    const cx = lh ? safe.l + c.dx * s : W - safe.r - c.dx * s;
    pos.push({ c, cx, cy, d });
    if (br && br.width > 0 && br.height > 0) {
      const g = TOUCH.barGap;
      const L = cx - d / 2 + S.rootLeft, R = cx + d / 2 + S.rootLeft, B = cy + d / 2 + S.rootTop;
      if (R > br.left - g && L < br.right + g && B > br.top - g) shift = Math.max(shift, B - (br.top - g));
    }
  }
  S.clusterShift = shift;
  for (const p of pos) {
    const b = S.btns.get(p.c.id);
    if (b) place(b.el, p.cx, p.cy - shift, p.d);
  }
  const pb = S.btns.get("pause");
  if (pb) {
    const d = Math.max(TOUCH.minTarget, TOUCH.pauseD * s);
    place(pb.el, W - safe.r - TOUCH.pausePad - d / 2, safe.t + TOUCH.pausePad + d / 2, d);
  }
  S.baseR = (TOUCH.stickBase * s) / 2;
  const knob = TOUCH.stickKnob * s;
  S.knobEl.style.width = knob + "px";
  S.knobEl.style.height = knob + "px";
  const off = TOUCH.stickHomePad * s + S.baseR;
  S.homeX = lh ? W - safe.r - off : safe.l + off;
  S.homeY = H - safe.b - off;
  if (S.stickId === null) placeStick(S.homeX, S.homeY, 0, 0);
  else { drawnCentre(); placeStick(S.cx, S.cy, T.mx, -T.mz); }
}

/** the drawn base centre = the logical origin kept fully on screen (it never moves the output) */
function drawnCentre() {
  const R = S.baseR;
  S.cx = clamp(S.ox, S.safe.l + R, Math.max(S.safe.l + R, S.vw - S.safe.r - R));
  S.cy = clamp(S.oy, S.safe.t + R, Math.max(S.safe.t + R, S.vh - S.safe.b - R));
}

function placeStick(cx, cy, kx, ky) {
  const d = S.baseR * 2;
  const e = S.stickEl.style;
  e.width = d + "px";
  e.height = d + "px";
  e.left = (cx - S.baseR) + "px";
  e.top = (cy - S.baseR) + "px";
  S.knobEl.style.transform = "translate(-50%, -50%) translate3d(" + (kx * S.baseR).toFixed(1) + "px, " + (ky * S.baseR).toFixed(1) + "px, 0)";
}

// ───────────────────────────── pointers ─────────────────────────────
function acceptPointer(e) {
  if (e.pointerType === "touch" || e.pointerType === "pen") return true;
  return S.forced === true && e.pointerType === "mouse";      // ?touch=1 on a desktop: the mouse plays the finger
}

function listen(el, btn) {
  const down = (e) => onDown(e, el, btn);
  const up = (e) => onUp(e, false);
  const cancel = (e) => onUp(e, true);
  const ctx = (e) => e.preventDefault();
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("lostpointercapture", cancel);
  el.addEventListener("contextmenu", ctx);
  S.offs.push(() => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("lostpointercapture", cancel);
    el.removeEventListener("contextmenu", ctx);
  });
}

function local(e) { return { x: e.clientX - (S.rootLeft || 0), y: e.clientY - (S.rootTop || 0) }; }
function stickSide(x) { return S.lh ? x >= S.vw * (1 - TOUCH.moveZone) : x < S.vw * TOUCH.moveZone; }
function moveZone(x, y) { return y >= S.band && stickSide(x); }

function onDown(e, el, btn) {
  if (!acceptPointer(e) || !S.visible || S.disposed) return;
  // preventDefault on pointerdown: no compatibility mouse events, so a touch never reaches player.js's canvas
  // mousedown (no pointer-lock request, no stray shot)
  if (e.cancelable) e.preventDefault();
  if (S.tracks.has(e.pointerId)) return;
  const p = local(e);
  const tr = { kind: "none", id: null, el, x: e.clientX, y: e.clientY, t: e.timeStamp, look: false };
  if (btn) {
    tr.kind = "btn";
    tr.id = btn.id;
    tr.look = btn.id === "fire";
    press(btn);
  } else if (moveZone(p.x, p.y)) {
    if (S.stickId === null) { startStick(tr, e.pointerId, p.x, p.y); stick(p.x, p.y); }
  } else if (!stickSide(p.x)) {
    tr.kind = "look";                                   // the look side, at any height (buttons catch their own)
  }                                                     // else: the stick side's top band (HUD) - tracked, inert
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
  S.tracks.set(e.pointerId, tr);
}

function startStick(tr, id, x, y) {
  tr.kind = "stick";
  S.stickId = id;
  S.ox = x;
  S.oy = y;
  drawnCentre();
  S.stickEl.classList.add("on");
}

function onMove(e) {
  const tr = S.tracks.get(e.pointerId);
  if (!tr || S.disposed) return;
  if (e.cancelable) e.preventDefault();
  if (tr.kind === "stick") { const p = local(e); stick(p.x, p.y); return; }
  if (tr.kind !== "look" && !(tr.kind === "btn" && tr.look)) return;
  const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
  const n = list && list.length ? list.length : 1;
  const k = sens();
  for (let i = 0; i < n; i++) {
    const ev = list && list.length ? list[i] : e;
    const dx = ev.clientX - tr.x, dy = ev.clientY - tr.y;
    if (!dx && !dy) continue;
    const dtMs = Math.max(4, ev.timeStamp - tr.t);
    const speed = Math.sqrt(dx * dx + dy * dy) / (dtMs / 1000);
    const accel = 1 + TOUCH.accelGain * clamp((speed - TOUCH.accelFromPxS) / TOUCH.accelSpanPxS, 0, 1);
    const dyaw = -dx * TOUCH.lookYawPerPx * k * accel;
    const dpitch = -dy * TOUCH.lookPitchPerPx * k * accel;
    S.lookYaw += dyaw;
    S.lookPitch += dpitch;
    S.totalYaw += dyaw;
    S.totalPitch += dpitch;
    S.lookMoved = true;
    tr.x = ev.clientX; tr.y = ev.clientY; tr.t = ev.timeStamp;
  }
}

function onUp(e, cancelled) {
  const tr = S.tracks.get(e.pointerId);
  if (!tr) return;
  end(e.pointerId, tr, cancelled ? null : e);
}

function end(id, tr, e) {
  S.tracks.delete(id);
  try { if (tr.el.hasPointerCapture && tr.el.hasPointerCapture(id)) tr.el.releasePointerCapture(id); } catch (err) { /* gone */ }
  if (tr.kind === "stick" && S.stickId === id) {
    S.stickId = null;
    T.mx = 0; T.mz = 0; T.sprint = false; S.stickMag = 0;
    S.stickEl.classList.remove("on");
    placeStick(S.homeX, S.homeY, 0, 0);
  } else if (tr.kind === "btn" && tr.id) {
    const b = S.btns.get(tr.id);
    if (b) release(b);
  }
}

/** stick: analog output from the logical origin with a radial deadzone, drag-follow past the rim, auto-sprint */
function stick(x, y) {
  const R = S.baseR;
  let dx = x - S.ox, dy = y - S.oy;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d > R) {
    const k = (d - R) / d;                       // drag-follow: the origin slides so the finger sits on the rim
    S.ox += dx * k;
    S.oy += dy * k;
    dx = x - S.ox; dy = y - S.oy;
    d = R;
  }
  drawnCentre();
  const mag = R > 0 ? Math.min(1, d / R) : 0;
  const dz = TOUCH.deadzone;
  let ox = 0, oy = 0;
  if (mag > dz && d > 1e-6) {
    const out = (mag - dz) / (1 - dz);
    ox = (dx / d) * out;
    oy = (dy / d) * out;
  }
  T.mx = ox;
  T.mz = -oy;                                    // screen up = forward
  S.stickMag = mag;
  const fwd = T.mz;
  T.sprint = T.sprint ? (mag >= TOUCH.sprintOff && fwd > TOUCH.sprintFwd * 0.8) : (mag >= TOUCH.sprintOn && fwd > TOUCH.sprintFwd);
  placeStick(S.cx, S.cy, R > 0 ? dx / R : 0, R > 0 ? dy / R : 0);
}

function vibrate(ms) {
  if (setting("haptics", true) === false) return;
  try { if (typeof navigator.vibrate === "function") navigator.vibrate(ms); } catch (e) { /* no user activation */ }
}

function press(b) {
  b.down++;
  b.el.classList.add("down");
  S.presses[b.id] = (S.presses[b.id] || 0) + 1;
  if (b.id === "ads") T.ads = !T.ads;           // a toggle
  else if (HELD[b.id]) {
    T[b.id] = true;
    S.pressFrame[b.id] = S.frameNo;
    S.pendingRelease[b.id] = false;
    // the FIRE press is a click edge for weapons.js, set BEFORE the next frame so the shot it causes consumes it
    // (semi-autos honour it for 420 ms like a mouse click; set after the shot it would fire a second round)
    if (b.id === "fire" && S.W) S.W._fireEdge = performance.now() || 1;
  }
  vibrate(TOUCH.hapticPress);
}

/** the buttons whose W.touch field is a held level (ADS is a toggle) */
const HELD = { fire: true, use: true, jump: true, reload: true, pause: true };
const HELD_IDS = ["fire", "use", "jump", "reload", "pause"];
function isDown(id) { const b = S.btns.get(id); return !!(b && b.down > 0); }

function release(b) {
  b.down = Math.max(0, b.down - 1);
  if (b.down > 0) return;
  b.el.classList.remove("down");
  if (!HELD[b.id]) return;
  if (S.frameNo === S.pressFrame[b.id]) S.pendingRelease[b.id] = true;   // no frame has seen this press yet: hold it one frame
  else T[b.id] = false;
}

/** the game's pause path (the same one ESC and the portal bar's pause button reach) */
function doPause() {
  const W = S.W;
  try {
    if (window.__PAUSE__ && typeof window.__PAUSE__.toggle === "function") window.__PAUSE__.toggle();
    else if (W && W.events) W.events.emit("escPressed");
  } catch (e) { console.error("[touch] pause", e); }
}

/** drop every touch (hidden / blur / disposed): releases captures, zeroes the stick, releases every button, ADS off */
function releaseAll() {
  for (const [id, tr] of [...S.tracks]) end(id, tr, null);
  S.tracks.clear();
  S.stickId = null;
  T.mx = 0; T.mz = 0; T.sprint = false; S.stickMag = 0;
  T.ads = false;
  for (let i = 0; i < HELD_IDS.length; i++) { T[HELD_IDS[i]] = false; S.pendingRelease[HELD_IDS[i]] = false; }
  S.lookYaw = 0; S.lookPitch = 0;
  for (const b of S.btns.values()) { b.down = 0; b.el.classList.remove("down"); }
  if (S.stickEl) S.stickEl.classList.remove("on");
}

// ───────────────────────────── per frame ─────────────────────────────
function frame(dt) {
  const W = S.W;
  if (!W || S.disposed) return;
  S.frameNo++;
  setMode(wantMode());
  const p = W.player;
  const show = T.active && (W.phase === "drop" || W.phase === "match") && !!p && p.alive && !W.paused;
  setVisible(show);
  // who consumes W.touch? a takeLook() from anyone but the bridge = a C6 consumer exists
  if (S.extTakes > 0) { S.consumerFrame = S.frameNo; S.extTakes = 0; }
  if (!show) { bridgeOff(); return; }
  S.visibleFrames++;
  cosmetics(W, p);
  const wantBridge = S.bridgeAllowed && S.frameNo - S.consumerFrame > 2 && S.visibleFrames >= 2;
  if (wantBridge) bridgeStep(W, p, dt);
  else bridgeOff();
  // nobody turned presses into edges this frame (an external consumer reads the levels itself): forget them, so a
  // later bridge / applyTo never replays a press it did not see
  if (!S.edgeOwner) syncApplied();
  S.edgeOwner = false;
  S.lookMoved = false;
  for (let i = 0; i < HELD_IDS.length; i++) {
    const k = HELD_IDS[i];
    if (S.pendingRelease[k] && S.frameNo !== S.pressFrame[k]) { S.pendingRelease[k] = false; if (!isDown(k)) T[k] = false; }
  }
}

function syncApplied() {
  const a = S.applied, pr = S.presses;
  a.use = pr.use || 0; a.jump = pr.jump || 0; a.reload = pr.reload || 0; a.pause = pr.pause || 0;
}

/** cheap per-frame UI state: DOM writes only when a value changes */
function cosmetics(W, p) {
  const ui = S.ui;
  const fb = S.btns.get("fire");
  const fireDim = !!(p.gliding || p.swimming);
  if (fb && fireDim !== ui.fireDim) { ui.fireDim = fireDim; fb.el.classList.toggle("dim", fireDim); }
  const jb = S.btns.get("jump");
  const chute = !!p.gliding;
  if (jb && chute !== ui.chute) { ui.chute = chute; jb.icon.innerHTML = chute ? ICON.chute : ICON.jump; }
  const ub = S.btns.get("use");
  const hint = W.interactHint;
  const ready = !!hint;
  if (ub && ready !== ui.useReady) { ui.useReady = ready; ub.el.classList.toggle("ready", ready); }
  const prog = hint && hint.type === "chest" ? Math.round(clamp(num(hint.progress, 0), 0, 1) * 50) / 50 : 0;
  const chan = prog > 0;
  if (ub && chan !== ui.useChan) { ui.useChan = chan; ub.el.classList.toggle("chan", chan); }
  if (ub && prog !== ui.useP) { ui.useP = prog; ub.el.style.setProperty("--p", String(prog)); }
  const ab = S.btns.get("ads");
  if (ab && T.ads !== ui.ads) { ui.ads = T.ads; ab.el.classList.toggle("on", T.ads); ab.el.setAttribute("aria-pressed", T.ads ? "true" : "false"); }
  if (S.stickEl && T.sprint !== ui.sprint) { ui.sprint = T.sprint; S.stickEl.classList.toggle("sprint", T.sprint); }
}

// ───────────────────────────── fallback bridge (until a C6 consumer exists) ─────────────────────────────
const BRIDGED = ["mx", "mz", "fire", "ads", "sprint"];
function bridgeAccessors(inp) {
  if (S.bridgedInput === inp) return;
  if (S.bridgedInput) unbridge(S.bridgedInput);
  const kb = {};
  for (const k of BRIDGED) kb[k] = inp[k];
  const def = (k, get) => Object.defineProperty(inp, k, { configurable: true, enumerable: true, get, set(v) { kb[k] = v; } });
  def("mx", () => (S.bridgeOn && (T.mx || T.mz) ? T.mx : kb.mx));
  def("mz", () => (S.bridgeOn && (T.mx || T.mz) ? T.mz : kb.mz));
  def("fire", () => kb.fire || (S.bridgeOn && T.fire));
  def("ads", () => kb.ads || (S.bridgeOn && T.ads));
  def("sprint", () => kb.sprint || (S.bridgeOn && T.sprint));
  Object.defineProperty(inp, "__lctKb", { value: kb, configurable: true, enumerable: false, writable: true });
  S.bridgedInput = inp;
}
function unbridge(inp) {
  const kb = inp && inp.__lctKb;
  if (kb) {
    for (const k of BRIDGED) Object.defineProperty(inp, k, { value: kb[k], writable: true, configurable: true, enumerable: true });
    delete inp.__lctKb;
  }
  if (S.bridgedInput === inp) S.bridgedInput = null;
}
function bridgeOff() {
  if (!S.bridgeOn && !S.bridgedInput) return;
  const inp = S.bridgedInput;
  S.bridgeOn = false;
  if (inp) {
    if (S.useWas) inp.interactDown = false;
    unbridge(inp);
  }
  S.useWas = false;
  S.assist.slow = 1; S.assist.dyaw = 0; S.assist.dpitch = 0; S.assist.target = -1;
}

function bridgeStep(W, p, dt) {
  const inp = p.input;
  if (!inp) return;
  bridgeAccessors(inp);
  S.bridgeOn = true;
  applyTouch(W, p, inp, dt, true);
}

/**
 * The whole C6 merge onto an input struct: look (x the mouse's sensitivity setting, + aim assist) into yaw / pitch;
 * one edge per press of JUMP (input.jump), RELOAD (input.reload), USE (input.interact) and PAUSE (the pause path);
 * USE held into interactDown. Without `viaAccessors` it also ORs fire / ads / sprint and takes the stick over mx / mz
 * when deflected: right for a caller that runs AFTER player.js rebuilt those five from the keyboard this frame
 * (W.touch.applyTo). The bridge runs after the frame pipeline, so it passes `viaAccessors` and lets the accessors
 * carry those five instead.
 */
function applyTouch(W, p, inp, dt, viaAccessors) {
  S.edgeOwner = true;
  const look = take(_bridgeLook);
  // the same sensitivity setting the mouse uses (player.js: sensitivity, adsSensitivity while ADS)
  const st = W.settings || {};
  const k = num(+(inp.ads ? st.adsSensitivity : st.sensitivity), 1) || 1;
  look.dyaw *= k; look.dpitch *= k;
  const a = assist(W, p, dt, look);
  inp.yaw += look.dyaw * a.slow + a.dyaw;
  inp.pitch = clamp(inp.pitch + look.dpitch * a.slow + a.dpitch, -TOUCH.pitchMax, TOUCH.pitchMax);
  // press EDGES, one per press (a held button never repeats; a tap shorter than a frame still counts)
  const pr = S.presses, ap = S.applied;
  if ((pr.jump || 0) > ap.jump) { inp.jump = true; ap.jump = pr.jump; }
  if ((pr.reload || 0) > ap.reload) { inp.reload = true; ap.reload = pr.reload; }
  if ((pr.use || 0) > ap.use) { inp.interact = true; ap.use = pr.use; }
  if ((pr.pause || 0) > ap.pause) { ap.pause = pr.pause; doPause(); }
  // USE held = the chest channel (loot.js reads interactDown)
  if (T.use) inp.interactDown = true;
  else if (S.useWas) inp.interactDown = false;
  S.useWas = T.use;
  if (!viaAccessors) {
    if (T.mx || T.mz) { inp.mx = T.mx; inp.mz = T.mz; }
    if (T.fire) inp.fire = true;
    if (T.ads) inp.ads = true;
    if (T.sprint) inp.sprint = true;
  }
}

/**
 * Additive to C6: the complete touch merge in one call, for the consumer in player.js's per-frame input rebuild
 * (call it at the END of the rebuild, after fire / ads / sprint / mx / mz were set from the keyboard, while
 * W.touch.active). Counts as a C6 consumer, so the fallback bridge stands down.
 */
T.applyTo = function applyTo(inp, dt) {
  const W = S.W, p = W && W.player;
  S.extTakes++;
  if (!W || !p || !inp || !S.visible) return;
  applyTouch(W, p, inp, num(dt, 1 / 60), false);
};

/** line of sight from the camera to a foe's chest (maps.js losBlocked: terrain + swept colliders) */
function canSeeFoe(f) {
  const map = S.W && S.W.map, e = S.eye;
  return !(map && typeof map.losBlocked === "function" && map.losBlocked(e.x, e.y, e.z, f.x, f.y, f.z));
}

/** aim assist for the bridge (touch mode only): foes = live, non-squad actors' chest points; LOS via the map */
function assist(W, p, dt, look) {
  const out = S.assist;
  out.slow = 1; out.dyaw = 0; out.dpitch = 0; out.target = -1;
  const k = assistStrength();
  if (!(k > 0) || !T.fire) return out;
  const cam = W.kernel && W.kernel.camera;
  if (!cam) return out;
  const eye = S.eye;
  eye.x = cam.position.x; eye.y = cam.position.y; eye.z = cam.position.z;
  let n = 0;
  const pool = S.foePool, foes = S.foes;
  for (let i = 0; i < W.actors.length; i++) {
    const o = W.actors[i];
    if (!o || o === p || !o.alive || !o.pos) continue;
    if (p.teamId && o.teamId === p.teamId) continue;
    let f = pool[n];
    if (!f) f = pool[n] = { x: 0, y: 0, z: 0 };
    f.x = o.pos.x; f.y = o.pos.y + 1.2; f.z = o.pos.z;
    foes[n] = f;
    n++;
  }
  foes.length = n;
  if (!n) return out;
  const wid = p.weapon && p.weapon.id;
  const def = wid && W.SIM && W.SIM.WEAPONS ? W.SIM.WEAPONS[wid] : null;
  const range = def && def.falloff ? clamp(def.falloff[1] * 2, 40, 200) : 120;
  const r = AA.aimAssist({
    camYaw: p.input.yaw, camPitch: p.input.pitch, eye, foes, range,
    firing: true,
    moving: S.lookMoved || T.mx !== 0 || T.mz !== 0,
    dt, strength: k,
    canSee: canSeeFoe,
  });
  out.slow = r.slow; out.dyaw = r.dyaw; out.dpitch = r.dpitch; out.target = r.target;
  return out;
}

// ───────────────────────────── read-back + teardown ─────────────────────────────
function readback() {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const rect = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const buttons = {};
  if (S.built) {
    for (const b of S.btns.values()) buttons[b.id] = rect(b.el);
    buttons.stick = rect(S.stickEl);
  }
  return {
    active: T.active, visible: S.visible, forced: S.forced,
    hud: { found: !!S.hud, setTouchMode: !!(S.hud && S.hud.setTouchMode), isTouchMode: !!(S.hud && S.hud.isTouchMode) },
    stick: { mx: r3(T.mx), mz: r3(T.mz), mag: r3(S.stickMag), active: S.stickId !== null, sprint: T.sprint },
    held: { fire: T.fire, use: T.use, jump: T.jump, reload: T.reload, pause: T.pause, ads: T.ads },
    lookRad: { yaw: r3(S.totalYaw), pitch: r3(S.totalPitch) }, pending: { dyaw: r3(S.lookYaw), dpitch: r3(S.lookPitch) },
    touches: S.tracks.size, presses: Object.assign({}, S.presses),
    bridge: { allowed: S.bridgeAllowed, on: S.bridgeOn, consumerSeen: S.consumerFrame > 0, consumerFrame: S.consumerFrame, frame: S.frameNo },
    assist: { slow: r3(S.assist.slow), dyaw: S.assist.dyaw, target: S.assist.target },
    layout: { w: S.vw, h: S.vh, safe: S.safe, band: Math.round(S.band), scale: S.scale, leftHanded: S.lh, clusterShift: Math.round(S.clusterShift) },
    buttons,
  };
}

/** remove the layer (tests / hot reload). W.touch stays, inactive. */
export function dispose() {
  if (S.disposed) return;
  releaseAll();
  bridgeOff();
  S.disposed = true;
  T.active = false; T.visible = false;
  for (const f of S.offs) { try { f(); } catch (e) { /* ignore */ } }
  S.offs.length = 0;
  if (S.root) S.root.remove();
}

export function readTouch() { return readback(); }

// ───────────────────────────── self-install on import ─────────────────────────────
// The orchestrator may call install(W) itself; until then (or if it never does) wait for the game's world.
(function autoInstall() {
  if (typeof window === "undefined") return;
  const t0 = Date.now();
  const tick = () => {
    if (S.installed) return;
    const C = window.__LC__;
    if (C && C.W && C.W.kernel) { install(C.W); return; }
    if (Date.now() - t0 < 300000) setTimeout(tick, 100);
  };
  tick();
})();

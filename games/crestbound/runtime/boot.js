/* ============================================================================
 * CRESTBOUND — runtime/boot.js
 * The module entry point. Capability check, URL parameters, ordered construction
 * of every engine-level singleton, honest boot progress, and — the thing this
 * file really exists for — a READABLE FAILURE in every case where the game
 * cannot start. A branded splash that sits there forever is the worst possible
 * outcome and this file makes it unreachable.
 *
 * Ported by transliteration from ASCENDANT runtime/boot.js (same studio) and
 * extended for CRESTBOUND: `?course=` replaces `?stage=`, the UI set is HUD +
 * Menu + CourseCard + Transitions, and the published handle is
 * `globalThis.CRESTBOUND` (contract "Global debug handle").
 *
 * ---------------------------------------------------------------------------
 * CONSTRUCTION ORDER (the dependency graph, not a preference)
 * ---------------------------------------------------------------------------
 *   Settings ──► Engine ──► Mats.init(renderer) ──► Audio ──► Save.load()
 *            ──► Input ──► ParticleSystem ──► Decals ──► Impacts
 *            ──► Game ──► HUD / Menu / CourseCard / Transitions ──► game.boot()
 *
 *   • Settings first: the quality preset decides how the renderer is built
 *     (DPR ceiling, shadow-map size, post chain), so it cannot come after.
 *   • Mats.init needs a live WebGLRenderer for its one-time procedural texture
 *     bake — the slowest boot phase, and the reason the bar is not cosmetic.
 *   • Audio is CONSTRUCTED here but never STARTED here: a Web Audio context may
 *     only be resumed from a user gesture. Game.startAudio() runs on the title
 *     PLAY click; the pointerdown/keydown fallback below catches a player who
 *     presses a key first.
 *   • Impacts is built before the FollowCamera and the post chain exist, so it
 *     is given `null` for the camera on purpose. Game._wireImpacts() hands it
 *     the real camera and engine.post the moment both exist — that is the only
 *     place those references are set. Passing engine.camera here would give
 *     Impacts a bare PerspectiveCamera with no shake/punch/setDeathCam and
 *     permanently silence them (an Ascendant bug, fixed the same way).
 *   • Game is constructed BEFORE the UI because HUD / Menu / CourseCard all
 *     take `game` in their constructors (contract §27). The UI is handed back
 *     through attachUI() before boot() runs, so nothing ever observes a
 *     half-built world.
 *
 * ---------------------------------------------------------------------------
 * URL PARAMETERS
 * ---------------------------------------------------------------------------
 *   ?dev=1                dev tools (Game.__dev appears — hard rule 9), the
 *                         debug readout, and input that never self-suspends.
 *   ?course=<id>          PRELOADS that course's module so a harness pays the
 *                         import cost before it starts measuring. On its own it
 *                         does NOT auto-start — the title menu still comes
 *                         first. WITH ?dev=1 the game boots straight into the
 *                         course, skipping the title and the intro cinematic
 *                         (that is the harness path: bootcheck / feelcheck /
 *                         camcheck / perfcheck / shots all use ?dev=1&course=).
 *                         An id that is not a course is IGNORED with a visible
 *                         notice rather than failing silently at PLAY time.
 *   ?quality=low|medium|high|ultra   overrides the stored preset for this load.
 *   ?mode=ai|online       IGNORED, deliberately. The FFG portal appends this to
 *                         every launch; a game that auto-starts on it reads as
 *                         broken (reference_ffg_play_launcher). The menu always
 *                         shows.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROMISES THE PLAYER
 * ---------------------------------------------------------------------------
 *   1. The #boot splash ALWAYS resolves — into the game, the #nogpu card, or
 *      the failure card. A module fetch that never settles is caught by the
 *      stall watchdog (progress writes are its heartbeat), because `await
 *      import()` that never returns throws nothing and would otherwise leave a
 *      frozen bar and no Reload button.
 *   2. A save that could not be read is said ONCE, on the load that repaired or
 *      replaced it (Save.recovered), never silently.
 *   3. An error AFTER boot only kills the game if it actually killed the render
 *      loop: `game.frames` counts COMPLETED frames, so a benign one-off error
 *      cannot wipe out a running session.
 *
 * NODE / MODULECHECK: `_harness/modulecheck.mjs` imports every runtime module
 * under a DOM shim to prove the graph links. Booting a renderer there is
 * meaningless, so `main()` is only auto-invoked in a real browser; under Node
 * this module is a pure link test. `main` is exported so a harness can drive it
 * deliberately.
 * ==========================================================================*/

import * as THREE from 'three';

import { Engine } from './core/engine.js';
import { Mats } from './world/materials.js';
import { Collider } from './world/collider.js';
import { Audio } from './core/audio.js';
import { Save } from './core/save.js';
import { Settings } from './core/settings.js';
import { Input } from './core/input.js';
import { ParticleSystem } from './fx/particles.js';
import { Decals } from './fx/decals.js';
import { Impacts } from './fx/impacts.js';
import { Game } from './game.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { CourseCard } from './ui/coursecard.js';
import { Transitions } from './ui/transitions.js';
import { isCourseId, KEEP_ID, COURSE_META } from './data/index.js';

export const VERSION = '0.1.0';

/* ===========================================================================
 * Environment
 * ======================================================================== */

/** True in a real browser; false under Node (modulecheck) or a worker. */
const IS_BROWSER = typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof window.requestAnimationFrame === 'function' &&
  !(typeof process !== 'undefined' && process.versions && process.versions.node);

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/* ===========================================================================
 * URL parameters
 * ======================================================================== */

const PARAMS = (() => {
  try { return new URLSearchParams(window.location.search); }
  catch (e) { return new URLSearchParams(''); }
})();

const truthy = (v) => v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on';

const DEV = truthy(PARAMS.get('dev'));
const QUALITY_PARAM = String(PARAMS.get('quality') || '').toLowerCase();
const COURSE_PARAM = PARAMS.get('course') || null;
const MODE_PARAM = PARAMS.get('mode') || null;
const VALID_QUALITY = { low: 1, medium: 1, high: 1, ultra: 1 };

/** Validated against the ONE registry of course ids (data/index.js, pure data). */
const COURSE_OK = COURSE_PARAM
  ? (() => { try { return isCourseId(COURSE_PARAM); } catch (e) { return false; } })()
  : true;

/** ?dev=1&course=<id> → boot straight into the course (the harness path). */
const BOOT_INTO_COURSE = !!(DEV && COURSE_PARAM && COURSE_OK && COURSE_PARAM !== KEEP_ID);

/* ===========================================================================
 * Boot overlay + progress
 *
 * Every progress write is also a heartbeat for the stall watchdog. `shownProgress`
 * is monotonic so a late phase can never make the bar walk backwards.
 * ======================================================================== */

const bootEl = IS_BROWSER ? document.getElementById('boot') : null;
const barEl = IS_BROWSER ? document.getElementById('boot-bar') : null;
const msgEl = IS_BROWSER ? document.getElementById('boot-msg') : null;
const noGpuEl = IS_BROWSER ? document.getElementById('nogpu') : null;
const containerEl = IS_BROWSER ? (document.getElementById('game-container') || document.body) : null;

let shownProgress = 0;
let lastProgressAt = nowMs();
let lastPhase = 'initialising';
let stallHinted = false;

function setProgress(p, message) {
  const v = Math.max(shownProgress, Math.min(1, Math.max(0, p)));
  shownProgress = v;
  if (barEl) barEl.style.width = (v * 100).toFixed(1) + '%';
  if (msgEl && typeof message === 'string' && message) msgEl.textContent = message;
  lastProgressAt = nowMs();
  if (typeof message === 'string' && message) lastPhase = message;
  stallHinted = false;
}

/**
 * Two rAFs: the first commits the style write, the second lets it actually
 * paint. Without this the bar jumps from 0 to 100 in one frame at the end and
 * the "baking materials" phase looks like a hang.
 */
function paint() {
  return new Promise((res) => {
    if (!IS_BROWSER) { res(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => res()));
  });
}

/** Runs one boot phase, repainting the bar around it. */
async function phase(p, message, fn) {
  setProgress(p, message);
  await paint();
  return fn ? fn() : undefined;
}

/** True once the splash has been resolved one way or another. */
let bootEnded = false;

function dismissBoot() {
  bootEnded = true;
  if (!bootEl) return;
  bootEl.classList.add('gone');
  window.setTimeout(() => {
    if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
  }, 600);
}

function showNoGPU(detail) {
  bootEnded = true;
  if (bootEl) bootEl.style.display = 'none';
  if (noGpuEl) {
    noGpuEl.style.display = 'flex';
    if (detail) {
      const d = document.createElement('div');
      d.style.cssText = 'margin-top:18px;font-size:11px;letter-spacing:.14em;color:#7b5a52;max-width:44ch';
      d.textContent = detail;
      noGpuEl.appendChild(d);
    }
  }
  if (typeof console !== 'undefined' && console.error) console.error('[crestbound] no WebGL 2:', detail);
}

/* ===========================================================================
 * WebGL 2 capability probe
 *
 * Runs on a THROWAWAY canvas before the Engine exists, so a machine with no
 * WebGL 2 gets the #nogpu card instead of a stack trace. The probe context is
 * released immediately (WEBGL_lose_context) — some drivers cap the number of
 * live contexts and the real one must not be the fourth of four.
 * ======================================================================== */

function probeWebGL2() {
  try {
    if (typeof window.WebGL2RenderingContext === 'undefined') return 'WebGL2RenderingContext is not defined';
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return 'canvas.getContext("webgl2") returned null';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) { try { lose.loseContext(); } catch (e) { /* probe cleanup only */ } }
    return null;
  } catch (e) {
    return String((e && e.message) || e);
  }
}

/* ===========================================================================
 * Failure card — a diagnosis, never a black screen
 * ======================================================================== */

let failureShown = false;

function injectFailureStyle() {
  if (document.getElementById('cb-fail-style')) return;
  const st = document.createElement('style');
  st.id = 'cb-fail-style';
  st.textContent = `
#cb-fail{position:absolute;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;
  padding:28px;background:radial-gradient(120% 100% at 50% 30%,#211324,#07060f 72%);
  font-family:'Rajdhani','Segoe UI',system-ui,-apple-system,sans-serif;color:#eadfd0;overflow:auto}
#cb-fail .card{width:min(680px,100%);border-radius:16px;padding:26px 28px 22px;
  background:linear-gradient(180deg,rgba(38,24,34,.88),rgba(13,10,20,.94));
  border:1px solid rgba(255,150,110,.22);box-shadow:0 26px 74px rgba(0,0,0,.62)}
#cb-fail h1{font:300 28px/1.15 inherit;letter-spacing:.2em;margin-left:.2em;text-transform:uppercase;color:#ffc39f}
#cb-fail .lead{margin-top:12px;font:400 14px/1.65 inherit;color:#cbb7ad}
#cb-fail .where{margin-top:16px;font:600 10px/1 inherit;letter-spacing:.36em;color:#8e6d63;text-transform:uppercase}
#cb-fail pre{margin-top:8px;padding:13px 15px;border-radius:10px;background:rgba(0,0,0,.44);
  border:1px solid rgba(255,255,255,.06);font:500 11.5px/1.6 ui-monospace,'Cascadia Mono',Consolas,monospace;
  color:#ffb4a2;white-space:pre-wrap;word-break:break-word;max-height:34vh;overflow:auto}
#cb-fail .row{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
#cb-fail button{appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:9px;cursor:pointer;
  padding:10px 18px;font:600 11px/1 inherit;letter-spacing:.24em;text-transform:uppercase;
  background:rgba(255,255,255,.07);color:#f3e6dd;transition:background .15s,transform .1s}
#cb-fail button:hover{background:rgba(255,255,255,.15)}
#cb-fail button:active{transform:scale(.97)}
#cb-fail button.primary{background:#ffd166;border-color:#ffd166;color:#1a1230}
#cb-fail button.primary:hover{background:#ffdd8c}
#cb-fail .hint{margin-top:14px;font:400 11px/1.6 inherit;color:#7f6d68}
`;
  document.head.appendChild(st);
}

function describe(err) {
  if (!err) return 'Unknown error (no detail was reported).';
  if (typeof err === 'string') return err;
  const name = err.name || 'Error';
  const msg = err.message || String(err);
  let out = name + ': ' + msg;
  if (err.stack) {
    const lines = String(err.stack).split('\n').slice(0, 9).join('\n');
    out = lines.indexOf(msg) === -1 ? out + '\n' + lines : lines;
  }
  if (err.filename) out += '\n  at ' + err.filename + ':' + (err.lineno || '?') + ':' + (err.colno || '?');
  return out;
}

function showFailure(err, where) {
  if (failureShown || !IS_BROWSER) {
    if (typeof console !== 'undefined' && console.error) console.error('[crestbound] fatal', err);
    return;
  }
  failureShown = true;
  bootEnded = true;
  injectFailureStyle();
  if (bootEl) bootEl.style.display = 'none';

  const detail = describe(err);
  const wrap = document.createElement('div');
  wrap.id = 'cb-fail';
  const card = document.createElement('div');
  card.className = 'card';

  const h = document.createElement('h1');
  h.textContent = 'Crestbound could not start';
  const lead = document.createElement('p');
  lead.className = 'lead';
  lead.textContent = 'Something in the runtime failed before the game could take over. ' +
    'The details below say exactly where — a reload fixes most transient cases.';
  const wh = document.createElement('div');
  wh.className = 'where';
  wh.textContent = where ? 'failed during · ' + where : 'failed during · runtime';
  const pre = document.createElement('pre');
  pre.textContent = detail;

  const row = document.createElement('div');
  row.className = 'row';
  const reload = document.createElement('button');
  reload.className = 'primary';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => { try { window.location.reload(); } catch (e) { /* sandboxed */ } });
  const copy = document.createElement('button');
  copy.textContent = 'Copy details';
  copy.addEventListener('click', () => {
    try {
      navigator.clipboard.writeText(detail);
      copy.textContent = 'Copied';
      window.setTimeout(() => { copy.textContent = 'Copy details'; }, 1600);
    } catch (e) { copy.textContent = 'Copy blocked'; }
  });
  row.appendChild(reload);
  row.appendChild(copy);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'If a reload does not help, try disabling browser extensions that block WebGL, ' +
    'or open the console for the full trace.';

  card.appendChild(h); card.appendChild(lead); card.appendChild(wh);
  card.appendChild(pre); card.appendChild(row); card.appendChild(hint);
  wrap.appendChild(card);
  (document.body || document.documentElement).appendChild(wrap);

  if (typeof console !== 'undefined' && console.error) console.error('[crestbound] fatal', err);
}

/* ===========================================================================
 * Boot stall watchdog
 *
 * The worst boot outcome is not an error — it is the branded splash sitting
 * there forever with a frozen bar, no message and no Reload button. That is
 * exactly what a module fetch that never settles produces: `await import()`
 * never returns, nothing throws, and neither the error listeners nor
 * main().catch ever fire.
 *
 * Progress is a heartbeat (every phase() and every Game onProgress call
 * refreshes it). Silence for STALL_HINT_MS turns the message into
 * "<phase> — still working"; silence for STALL_FAIL_MS hands over to the
 * failure card, naming the phase that hung. 90 s is far beyond any healthy
 * phase — the slowest, the material bake and the Keep build, are a few seconds
 * each and keep reporting — so a slow machine never trips it.
 * `window.__CRESTBOUND_BOOT_STALL_MS` lets a harness shorten the wait.
 * ======================================================================== */

const STALL_HINT_MS = 30000;
const STALL_FAIL_MS = (() => {
  try { const v = window.__CRESTBOUND_BOOT_STALL_MS | 0; return v > 0 ? v : 90000; } catch (e) { return 90000; }
})();
let stallTimer = 0;

function startStallWatch() {
  if (stallTimer || !IS_BROWSER) return;
  stallTimer = window.setInterval(() => {
    if (bootEnded || failureShown) { window.clearInterval(stallTimer); stallTimer = 0; return; }
    const idle = nowMs() - lastProgressAt;
    if (idle >= STALL_FAIL_MS) {
      window.clearInterval(stallTimer); stallTimer = 0;
      showFailure(
        new Error('Boot stalled for ' + Math.round(idle / 1000) + ' s during "' + lastPhase + '". ' +
          'A script or asset never finished loading — check the network, then reload.'),
        'startup · stalled at "' + lastPhase + '"',
      );
    } else if (idle >= STALL_HINT_MS && !stallHinted) {
      stallHinted = true;
      if (msgEl) msgEl.textContent = lastPhase + ' — still working';
    }
  }, 1000);
}

/* ===========================================================================
 * Non-fatal notices
 *
 * A small dismissible card for things the player should hear once and that must
 * never block the menu: a save that had to be repaired, a link parameter that
 * was ignored.
 * ======================================================================== */

function injectNoticeStyle() {
  if (document.getElementById('cb-notice-style')) return;
  const st = document.createElement('style');
  st.id = 'cb-notice-style';
  st.textContent = `
.cb-notice{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:80;
  width:min(600px,92vw);box-sizing:border-box;padding:13px 16px 12px 14px;border-radius:13px;
  display:flex;gap:12px;align-items:flex-start;cursor:pointer;pointer-events:auto;
  background:linear-gradient(180deg,rgba(36,24,44,.94),rgba(14,11,22,.96));
  border:1px solid rgba(255,209,102,.28);box-shadow:0 16px 44px rgba(0,0,0,.58);
  font-family:'Rajdhani','Segoe UI',system-ui,-apple-system,sans-serif;color:#ecdfd0;
  opacity:0;transition:opacity .3s ease,transform .3s ease}
.cb-notice.on{opacity:1}
.cb-notice.off{opacity:0;transform:translateX(-50%) translateY(-8px)}
.cb-notice .ic{flex:none;width:22px;height:22px;border-radius:50%;margin-top:1px;
  background:#ffd166;color:#1a1230;font:700 14px/22px inherit;text-align:center}
.cb-notice .tx{flex:1;min-width:0}
.cb-notice .t1{font:600 11px/1.2 inherit;letter-spacing:.26em;text-transform:uppercase;color:#ffd9a0}
.cb-notice .t2{margin-top:5px;font:400 12.5px/1.55 inherit;color:#cdbcb4}
.cb-notice .t3{margin-top:6px;font:500 10.5px/1.5 ui-monospace,'Cascadia Mono',Consolas,monospace;color:#95817a;
  white-space:pre-wrap;word-break:break-word;max-height:9em;overflow:auto}
.cb-notice .x{flex:none;margin:-2px -4px 0 0;font:400 16px/1 inherit;color:#95817a}
`;
  document.head.appendChild(st);
}

function showNotice(id, title, body, detail, ttlMs) {
  try {
    if (!IS_BROWSER || document.getElementById(id)) return null;
    injectNoticeStyle();
    const el = document.createElement('div');
    el.id = id;
    el.className = 'cb-notice';
    el.setAttribute('role', 'status');
    const ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = '!';
    const tx = document.createElement('div'); tx.className = 'tx';
    const t1 = document.createElement('div'); t1.className = 't1'; t1.textContent = title;
    const t2 = document.createElement('div'); t2.className = 't2'; t2.textContent = body;
    tx.appendChild(t1); tx.appendChild(t2);
    if (detail) { const t3 = document.createElement('div'); t3.className = 't3'; t3.textContent = detail; tx.appendChild(t3); }
    const x = document.createElement('div'); x.className = 'x'; x.textContent = '×';
    el.appendChild(ic); el.appendChild(tx); el.appendChild(x);
    (document.body || document.documentElement).appendChild(el);

    let gone = false;
    const hide = () => {
      if (gone) return;
      gone = true;
      el.classList.remove('on'); el.classList.add('off');
      window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 340);
    };
    el.addEventListener('click', hide);
    /* setTimeout, not rAF: a game booted in a background tab gets no animation
       frames, and the notice must not stay at opacity 0 until it is gone. */
    window.setTimeout(() => el.classList.add('on'), 30);
    /* The life clock only starts once the tab is visible, so a boot behind
       another tab still shows the notice for its full life once looked at. */
    const ttl = Math.max(2000, ttlMs || 10000);
    const arm = () => {
      if (document.visibilityState === 'hidden') {
        document.addEventListener('visibilitychange', arm, { once: true });
        return;
      }
      window.setTimeout(hide, ttl);
    };
    arm();
    return el;
  } catch (e) {
    return null;
  }
}

/** The one-time "your save could not be read" notice (Save.recovered). */
function noticeSaveRecovery(rec) {
  if (!rec) return;
  let title, body, detail = '';
  if (rec.kind === 'repaired') {
    const n = rec.repairs.length;
    title = 'Saved progress was repaired';
    body = n + (n === 1 ? ' field' : ' fields') + ' in your save could not be read and ' +
      (n === 1 ? 'was' : 'were') + ' reset. Everything else was kept, and a copy of the original is in your browser storage.';
    detail = rec.repairs.slice(0, 8).join('\n') + (n > 8 ? '\n… +' + (n - 8) + ' more' : '');
  } else if (rec.kind === 'newer-version') {
    title = 'Save from a newer version';
    body = 'Your crests were written by a newer build (v' + rec.fromVersion + ') and cannot be read by this one. ' +
      'You are starting fresh; the original was kept as a backup in your browser storage.';
  } else {
    title = 'Saved progress could not be read';
    body = 'The stored save was damaged, so you are starting fresh. A copy of the damaged data was kept in your browser storage.';
  }
  detail = detail || ('crestbound.save.v1.bak · ' + rec.kind);
  showNotice('cb-save-notice', title, body, detail, 12000);
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[crestbound] save recovered (' + rec.kind + ')', rec.repairs && rec.repairs.length ? rec.repairs : '');
  }
}

/** ?course=<id> named something that is not a course. */
function noticeBadCourse(id) {
  const known = Object.keys(COURSE_META);
  showNotice('cb-param-notice', 'Unknown course in the link',
    '"' + String(id).slice(0, 48) + '" is not a course id, so it was ignored. The game starts in the Keep as usual.',
    'valid ids: ' + KEEP_ID + ', ' + known.slice(0, 4).join(', ') + ' … ' + known[known.length - 1], 10000);
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[crestbound] ?course=' + id + ' is not a course id — ignored.');
  }
}

/* ===========================================================================
 * Global error handling
 *
 * Before boot completes, ANY uncaught error is fatal — show the card.
 * After boot, an uncaught error is only fatal if it actually killed the render
 * loop: snapshot game.frames (incremented ONLY by a completed frame) and check
 * it again 1500 ms later. A benign one-off must not wipe out a running game.
 * ======================================================================== */

let booted = false;
let gameRef = null;

function watchdog(err, where) {
  if (failureShown) return;
  if (!gameRef) { showFailure(err, where); return; }
  const before = gameRef.frames;
  window.setTimeout(() => {
    if (failureShown || !gameRef) return;
    if (gameRef.frames === before) showFailure(err, where || 'render loop');
  }, 1500);
}

if (IS_BROWSER) {
  window.addEventListener('error', (e) => {
    const err = e.error || e.message || 'Unknown script error';
    if (!booted) showFailure(e.error || e, 'startup');
    else watchdog(err, 'runtime');
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const err = (e && e.reason) || 'Unhandled promise rejection';
    if (!booted) showFailure(err, 'startup');
    else watchdog(err, 'async');
  });

  /* An early __PAUSE__ stub so game_controls.js (loaded before this module) can
     never call into `undefined` during the boot window. Game._bindWindow()
     replaces it with the real one; if boot fails, this harmless no-op remains. */
  if (!window.__PAUSE__) {
    window.__PAUSE__ = {
      toggle() { if (gameRef) gameRef.togglePause(); },
      pause() { if (gameRef) gameRef.pause('controls'); },
      resume() { if (gameRef) gameRef.resume(); },
      isPaused() { return !!(gameRef && gameRef.state === 'paused'); },
    };
  }
}

/* ===========================================================================
 * globalThis.CRESTBOUND — the debug + harness handle (contract "Global debug
 * handle"). `player`, `course` and `state` are LIVE getters because all three
 * are replaced across a run; a snapshotted value would be a lie by the second
 * course. Extras (Settings, Save, THREE, Collider) are what the harnesses need
 * to build their own probes without importing the module graph twice.
 * ======================================================================== */

function publishHandle(engine, game) {
  const handle = {
    engine,
    game,
    THREE,
    version: VERSION,
    Settings,
    Save,
    Collider,
    Mats,
    get player() { return game.player; },
    get course() { return game.course; },
    get courseId() { return game.courseId; },
    get hero() { return game.hero; },
    get cam() { return game.cam; },
    get state() { return game.state; },
    get frames() { return game.frames; },
    get ready() { return booted; },
    get dev() { return game.__dev; },
    get snapshot() { return game._snapshot(); },
    get stats() { return engine.stats; },
  };
  try {
    Object.defineProperty(globalThis, 'CRESTBOUND', { value: handle, writable: true, configurable: true });
  } catch (e) {
    globalThis.CRESTBOUND = handle;
  }
  return handle;
}

/* ===========================================================================
 * Main
 * ======================================================================== */

export async function main() {
  startStallWatch();

  /* ---- 0. capability -------------------------------------------------- */
  setProgress(0.03, 'checking device');
  await paint();
  const gpuProblem = probeWebGL2();
  if (gpuProblem) { showNoGPU(gpuProblem); return null; }

  if (MODE_PARAM && typeof console !== 'undefined' && console.info) {
    /* Deliberately inert: the portal appends ?mode= to every launch and the
       menu must still be the first thing a player sees. */
    console.info('[crestbound] ?mode=' + MODE_PARAM + ' ignored — Crestbound is single-player; showing the menu.');
  }
  if (DEV) document.documentElement.setAttribute('data-crestbound-dev', '1');

  /* ---- 1. settings (before the renderer: quality drives its construction) */
  const settings = await phase(0.08, 'reading settings', () => {
    if (QUALITY_PARAM && VALID_QUALITY[QUALITY_PARAM]) Settings.set({ quality: QUALITY_PARAM });
    return Settings.get();
  });
  const quality = Settings.quality();
  if (settings && settings.reduceMotion) document.documentElement.classList.add('cb-reduce-motion');

  /* ---- 2. renderer ---------------------------------------------------- */
  const engine = await phase(0.14, 'starting renderer', () => new Engine(containerEl));

  /* ---- 3. procedural materials (the one-time texture bake — slow phase) - */
  await phase(0.26, 'baking materials', () => {
    Mats.init(engine.renderer, quality);
    Mats.setLodDistance(quality.lodDistance);
    return Mats;
  });

  /* ---- 4. audio (context stays suspended until the first gesture) ------ */
  const audio = await phase(0.44, 'audio system', () => new Audio());

  /* ---- 5. save -------------------------------------------------------- */
  await phase(0.50, 'reading crests', () => Save.load());

  /* ---- 6. input ------------------------------------------------------- */
  const input = await phase(0.56, 'input devices', () => {
    const i = new Input(engine.renderer.domElement);
    /* Harness immunity: with ?dev=1 the input never self-suspends. Automation
       cannot hold pointer lock, and a leaked UI capture would otherwise pin
       suspended=true and swallow every jump edge feelcheck tries to measure. */
    if (DEV) i.devNoSuspend = true;
    if (typeof i.applySettings === 'function') i.applySettings(settings);
    return i;
  });

  /* ---- 7. particles, surface marks, impact orchestration --------------- */
  const particles = await phase(0.62, 'particle system', () => new ParticleSystem(engine.scene, quality));
  const decals = await phase(0.66, 'surface marks', () => new Decals(engine.scene, quality));
  const impacts = await phase(0.69, 'impact effects', () => {
    /* camera = null on purpose — see the header. Game._wireImpacts() supplies
       the real FollowCamera and engine.post once both exist. */
    const im = new Impacts(particles, audio, null, decals);
    if (im && !im.decals) im.decals = decals;   // tolerate an opts-shaped 4th arg
    return im;
  });

  /* ---- 8. the game object (the UI needs it in their constructors) ------ */
  const game = await phase(0.73, 'game systems', () => {
    const g = new Game(engine, containerEl);
    g.attach({
      input, audio, fx: particles, impacts, decals,
      mats: Mats, settings: Settings, save: Save, quality,
      dev: DEV,
      course: COURSE_OK ? COURSE_PARAM : null,
      bootIntoCourse: BOOT_INTO_COURSE,
      /* Game's own progress occupies the last 12 % of the bar — building the
         Keep is real work and the player should watch it happen. */
      onProgress: (p, m) => setProgress(0.86 + p * 0.13, m),
      onFatal: (err) => showFailure(err, 'render loop'),
    });
    return g;
  });
  gameRef = game;
  publishHandle(engine, game);

  /* ---- 9. interface --------------------------------------------------- */
  const uiRoot = document.getElementById('ui') || document.body;
  const hudRoot = document.getElementById('hud') || uiRoot;

  const ui = await phase(0.80, 'building the interface', () => ({
    /* Transitions FIRST: it owns the full-screen iris/fade layer and must sit
       UNDER the menu and the course card in DOM order. */
    transitions: new Transitions(uiRoot),
    hud: new HUD(hudRoot, game),
    card: new CourseCard(uiRoot, game),
    menu: new Menu(uiRoot, game),
  }));
  game.attachUI(ui);

  /* ---- 10. hand over -------------------------------------------------- */
  setProgress(0.86, BOOT_INTO_COURSE ? 'entering ' + COURSE_PARAM : 'entering the keep');
  await paint();
  await game.boot();

  booted = true;
  setProgress(1, 'ready');
  await paint();
  dismissBoot();

  /* ---- 11. after-boot wiring ------------------------------------------ */

  /* Visibility: a hidden tab PAUSES, and never resumes itself. Resuming on
     return is the Ascendant pointer-lock bug in another costume — the player
     would come back to a live game they are not looking at, mid-jump. Engine
     already owns the visibilitychange listener and republishes it as an event,
     so there is exactly one listener for this in the build. */
  if (engine.events && typeof engine.events.on === 'function') {
    engine.events.on('visibility', (visible) => {
      if (!visible && booted) { try { game.pause('hidden'); } catch (e) { /* already paused */ } }
    });
  }

  /* Resize: the Engine watches its own container with a ResizeObserver and the
     Game re-lays-out on window resize. Neither fires for an orientation change
     on iOS/Android (the container's box is unchanged until the visual viewport
     settles), so nudge it once the rotation has actually landed. */
  const nudgeResize = () => {
    window.setTimeout(() => { try { engine.resize(); } catch (e) { /* disposed */ } }, 120);
    window.setTimeout(() => { try { engine.resize(); } catch (e) { /* disposed */ } }, 420);
  };
  window.addEventListener('orientationchange', nudgeResize, false);
  if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
    window.visualViewport.addEventListener('resize', nudgeResize);
  }

  /* Things the player should hear once, over the title — never fatal. */
  if (Save.recovered) noticeSaveRecovery(Save.recovery);
  if (COURSE_PARAM && !COURSE_OK) noticeBadCourse(COURSE_PARAM);

  /* Audio can only start from a gesture. The title PLAY click is the intended
     one; this catches a player who presses a key or taps the canvas first. */
  const gesture = () => {
    try { game.startAudio(); } catch (e) { /* context refused — silent is fine */ }
    window.removeEventListener('pointerdown', gesture, true);
    window.removeEventListener('keydown', gesture, true);
    window.removeEventListener('touchstart', gesture, true);
  };
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('keydown', gesture, true);
  window.addEventListener('touchstart', gesture, true);

  if (DEV && typeof console !== 'undefined' && console.info) {
    console.info(
      '%c CRESTBOUND — dev mode ',
      'background:#ffd166;color:#1a1230;font-weight:700;padding:2px 6px;border-radius:3px',
      '\n  CRESTBOUND.game.__dev.goto("verdant-1")  load a course' +
      '\n  CRESTBOUND.game.__dev.tp(x,y,z)          teleport' +
      '\n  CRESTBOUND.game.__dev.give("open")       award a crest' +
      '\n  CRESTBOUND.game.__dev.noclip()           free fly' +
      '\n  CRESTBOUND.game.__dev.skipCP()           advance a checkpoint' +
      '\n  CRESTBOUND.game.__dev.freezeHazards()    stop the course clock' +
      '\n  CRESTBOUND.game.__dev.showColliders()    debug draw' +
      '\n  CRESTBOUND.game.__dev.state()            the HUD snapshot' +
      '\n  `  (backquote)                           toggle the readout',
    );
  }
  if (COURSE_PARAM && COURSE_OK && !BOOT_INTO_COURSE && typeof console !== 'undefined' && console.info) {
    console.info('[crestbound] ?course=' + COURSE_PARAM + ' preloaded. Nothing auto-starts without ?dev=1; ' +
      'the menu comes first.');
  }

  return game;
}

/* ===========================================================================
 * Go — browser only. Under Node (modulecheck) this module is a pure link test.
 * ======================================================================== */

if (IS_BROWSER) {
  main().catch((err) => showFailure(err, booted ? 'runtime' : 'startup'));
}

export default main;

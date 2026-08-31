import * as THREE from 'three';
/* ============================================================================
 * ASCENDANT — runtime/boot.js
 * Contract §22.  The module entry: capability check, URL parameters, ordered
 * construction of every engine-level singleton, real boot progress, and a
 * readable failure card in place of a black screen.
 *
 * Construction order (contract §21 note + the dependency graph):
 *   Engine -> Mats.init(renderer) -> Audio -> Save -> Settings -> Input
 *   -> ParticleSystem + Impacts -> Game -> HUD/Menu/StageSelect -> game.boot()
 * Game is built BEFORE the UI because HUD/Menu/StageSelect all take `game` in
 * their constructors (contract §20); the UI is then handed back to the Game via
 * attachUI() before boot() runs, so nothing observes a half-built world.
 *
 * URL parameters
 *   ?dev=1                     dev tools + debug draw (Game.__dev appears)
 *   ?stage=<id>                sets what PLAY loads — it does NOT auto-start
 *   ?quality=low|medium|high|ultra
 *   ?mode=ai|online            IGNORED, deliberately.  The FFG portal appends
 *                              this to every launch; a game that auto-starts on
 *                              it reads as broken (reference_ffg_play_launcher).
 *                              The title menu always shows.
 *
 * Audio is never started here.  A Web Audio context may only be resumed from a
 * user gesture — the title PLAY click is that gesture (Game.startAudio()).
 * ==========================================================================*/

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

/* ---------------------------------------------------------------------------
 * URL parameters
 * ------------------------------------------------------------------------ */
const PARAMS = (() => {
  try { return new URLSearchParams(window.location.search); }
  catch (e) { return new URLSearchParams(''); }
})();

const truthy = (v) => v === '' || v === '1' || v === 'true' || v === 'yes';
const DEV = truthy(PARAMS.get('dev'));
const QUALITY_PARAM = (PARAMS.get('quality') || '').toLowerCase();
const STAGE_PARAM = PARAMS.get('stage') || null;
const MODE_PARAM = PARAMS.get('mode') || null;
const VALID_QUALITY = { low: 1, medium: 1, high: 1, ultra: 1 };

/* ---------------------------------------------------------------------------
 * Boot overlay
 * ------------------------------------------------------------------------ */
const bootEl = document.getElementById('boot');
const barEl = document.getElementById('boot-bar');
const msgEl = document.getElementById('boot-msg');
const noGpuEl = document.getElementById('nogpu');
const containerEl = document.getElementById('game-container') || document.body;

let shownProgress = 0;

function setProgress(p, message) {
  const v = Math.max(shownProgress, Math.min(1, Math.max(0, p)));
  shownProgress = v;
  if (barEl) barEl.style.width = (v * 100).toFixed(1) + '%';
  if (msgEl && typeof message === 'string' && message) msgEl.textContent = message;
}

/** Two rAFs: one to commit the style write, one to let it actually paint. */
function paint() {
  return new Promise((res) => {
    requestAnimationFrame(() => requestAnimationFrame(() => res()));
  });
}

/** Runs one boot phase and repaints the bar around it. */
async function phase(p, message, fn) {
  setProgress(p, message);
  await paint();
  return fn ? fn() : undefined;
}

function dismissBoot() {
  if (!bootEl) return;
  bootEl.classList.add('gone');
  window.setTimeout(() => {
    if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
  }, 600);
}

function showNoGPU(detail) {
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
}

/* ---------------------------------------------------------------------------
 * WebGL 2 capability probe
 * ------------------------------------------------------------------------ */
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

/* ---------------------------------------------------------------------------
 * Failure card — a readable diagnosis instead of a black screen
 * ------------------------------------------------------------------------ */
let failureShown = false;

function injectFailureStyle() {
  if (document.getElementById('asc-fail-style')) return;
  const st = document.createElement('style');
  st.id = 'asc-fail-style';
  st.textContent = `
#asc-fail{position:absolute;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;
  padding:28px;background:radial-gradient(120% 100% at 50% 30%,#1a1013,#05070d 72%);
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e8d5cf;overflow:auto}
#asc-fail .card{width:min(660px,100%);border-radius:14px;padding:26px 28px 22px;
  background:linear-gradient(180deg,rgba(30,18,20,.86),rgba(12,9,12,.92));
  border:1px solid rgba(255,120,90,.22);box-shadow:0 24px 70px rgba(0,0,0,.6)}
#asc-fail h1{font:200 27px/1.15 inherit;letter-spacing:.2em;margin-left:.2em;text-transform:uppercase;color:#ffb9a4}
#asc-fail .lead{margin-top:12px;font:400 14px/1.65 inherit;color:#c9b4ae}
#asc-fail .where{margin-top:16px;font:600 10px/1 inherit;letter-spacing:.36em;color:#8a6a62;text-transform:uppercase}
#asc-fail pre{margin-top:8px;padding:13px 15px;border-radius:9px;background:rgba(0,0,0,.42);
  border:1px solid rgba(255,255,255,.06);font:500 11.5px/1.6 ui-monospace,'Cascadia Mono',Consolas,monospace;
  color:#ffb0a0;white-space:pre-wrap;word-break:break-word;max-height:34vh;overflow:auto}
#asc-fail .row{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
#asc-fail button{appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:8px;cursor:pointer;
  padding:10px 18px;font:600 11px/1 inherit;letter-spacing:.24em;text-transform:uppercase;
  background:rgba(255,255,255,.07);color:#f2e2dd;transition:background .15s,transform .1s}
#asc-fail button:hover{background:rgba(255,255,255,.15)}
#asc-fail button:active{transform:scale(.97)}
#asc-fail button.primary{background:#ff8a6b;border-color:#ff8a6b;color:#1a0d09}
#asc-fail button.primary:hover{background:#ffa088}
#asc-fail .hint{margin-top:14px;font:400 11px/1.6 inherit;color:#7d6a66}
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
    if (lines.indexOf(msg) === -1) out += '\n' + lines;
    else out = lines;
  }
  if (err.filename) out += '\n  at ' + err.filename + ':' + (err.lineno || '?') + ':' + (err.colno || '?');
  return out;
}

function showFailure(err, where) {
  if (failureShown) return;
  failureShown = true;
  injectFailureStyle();
  if (bootEl) bootEl.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.id = 'asc-fail';
  const detail = describe(err);
  const card = document.createElement('div');
  card.className = 'card';

  const h = document.createElement('h1');
  h.textContent = 'Ascendant could not start';
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

  card.appendChild(h);
  card.appendChild(lead);
  card.appendChild(wh);
  card.appendChild(pre);
  card.appendChild(row);
  card.appendChild(hint);
  wrap.appendChild(card);
  (document.body || document.documentElement).appendChild(wrap);

  if (typeof console !== 'undefined' && console.error) console.error('[ascendant] fatal', err);
}

/* ---------------------------------------------------------------------------
 * Global error handling
 *
 * Before boot completes, ANY uncaught error is fatal — show the card.
 * After boot, an uncaught error is only fatal if it actually killed the render
 * loop: we snapshot game.frames (incremented only by a COMPLETED frame) and
 * check it again 1500 ms later.  A benign one-off error must not wipe out a
 * running game.
 * ------------------------------------------------------------------------ */
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

/* ---------------------------------------------------------------------------
 * UI module resolution
 *
 * The contract fixes runtime/ui/hud.js by name but leaves the Menu and
 * StageSelect filenames open (§20 is written as "runtime/ui/*").  Rather than
 * make a guess that kills the whole game at link time if it is wrong, resolve
 * them dynamically over the plausible names and report precisely which module
 * is missing when none of them exist.
 * ------------------------------------------------------------------------ */
async function resolveClass(label, candidates, names) {
  const problems = [];
  for (let i = 0; i < candidates.length; i++) {
    const path = candidates[i];
    let mod = null;
    try {
      mod = await import(/* @vite-ignore */ path);
    } catch (e) {
      problems.push(path + '  ->  ' + ((e && e.message) || e));
      continue;
    }
    for (let n = 0; n < names.length; n++) {
      if (mod && typeof mod[names[n]] === 'function') return mod[names[n]];
    }
    /* A default export only counts when it is unambiguously the class we want:
       either the module exports nothing else, or the class name matches.  A
       shared module (Menu + StageSelect in one file) must never hand back the
       wrong default. */
    if (mod && typeof mod.default === 'function') {
      const keys = Object.keys(mod);
      const soleExport = keys.length === 1 && keys[0] === 'default';
      if (soleExport || names.indexOf(mod.default.name) !== -1) return mod.default;
    }
    problems.push(path + '  ->  loaded, but exports no ' + names.join(' / '));
  }
  throw new Error('Could not resolve the ' + label + ' module.\n  ' + problems.join('\n  '));
}

/* ---------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------ */
async function main() {
  /* ---- 0. capability ---- */
  setProgress(0.03, 'checking device');
  await paint();
  const gpuProblem = probeWebGL2();
  if (gpuProblem) { showNoGPU(gpuProblem); return; }

  if (MODE_PARAM) {
    /* Deliberately inert: the portal appends ?mode= to every launch and the
       menu must still be the first thing a player sees. */
    console.info('[ascendant] ?mode=' + MODE_PARAM + ' ignored — Ascendant is single-player; showing the menu.');
  }
  if (DEV) document.documentElement.setAttribute('data-ascendant-dev', '1');

  /* ---- 1. settings (before the renderer: quality drives its construction) -- */
  const settings = await phase(0.09, 'reading settings', () => {
    if (QUALITY_PARAM && VALID_QUALITY[QUALITY_PARAM]) Settings.set({ quality: QUALITY_PARAM });
    return Settings.get();
  });
  const quality = Settings.quality();

  /* ---- 2. renderer ---- */
  const engine = await phase(0.16, 'starting renderer', () => new Engine(containerEl));

  /* ---- 3. procedural materials (one-time texture bake — the slow phase) --- */
  await phase(0.30, 'baking materials', () => Mats.init(engine.renderer));

  /* ---- 4. audio (context stays suspended until the PLAY gesture) ---- */
  const audio = await phase(0.46, 'audio system', () => new Audio());

  /* ---- 5. save ---- */
  await phase(0.53, 'save data', () => Save.load());

  /* ---- 6. input ---- */
  const input = await phase(0.59, 'input devices', () => {
    const i = new Input(engine.renderer.domElement);
    // Harness immunity: with ?dev=1 the input never suspends (see input.js
    // setSuspended) - automation cannot hold pointer lock, and a leaked UI
    // capture otherwise pins suspended=true and swallows every jump edge.
    if (DEV) i.devNoSuspend = true;
    i.setSensitivity(typeof settings.sens === 'number' ? settings.sens : 1, !!settings.invertY);
    return i;
  });

  /* ---- 7. particles + surface marks ---- */
  const particles = await phase(0.66, 'particle system', () => new ParticleSystem(engine.scene, quality));
  const decals = await phase(0.68, 'surface marks', () => new Decals(engine.scene, quality));

  /* Impacts is built BEFORE the FPCamera and the Post chain exist, so it gets
     neither here: passing engine.camera (a bare PerspectiveCamera) would give it
     an object with no dip/shake/setDeathCam and permanently silence them.
     Game._wireImpacts() hands it the real FPCamera and engine.post the moment
     both exist — that is the only place those references are set. */
  const impacts = await phase(0.70, 'impact effects', () => new Impacts(particles, audio, null, { decals }));

  /* ---- 8. the game object (UI needs it) ---- */
  const game = await phase(0.74, 'game systems', () => {
    const g = new Game(engine, containerEl);
    g.attach({
      input, audio, fx: particles, impacts, decals,
      mats: Mats, settings: Settings, save: Save,
      dev: DEV,
      stage: STAGE_PARAM,
      onProgress: (p, m) => setProgress(0.88 + p * 0.11, m),
      onFatal: (err) => showFailure(err, 'render loop'),
    });
    return g;
  });
  gameRef = game;
  publishHandle(engine, game);

  /* ---- 9. interface ---- */
  const HUD = await phase(0.78, 'interface', () => resolveClass('HUD', ['./ui/hud.js'], ['HUD']));
  const Menu = await resolveClass('Menu', ['./ui/menu.js', './ui/menus.js', './ui/mainmenu.js'], ['Menu']);
  const StageSelect = await resolveClass(
    'StageSelect',
    ['./ui/stageselect.js', './ui/stage_select.js', './ui/stageSelect.js', './ui/select.js', './ui/menu.js'],
    ['StageSelect'],
  );

  const uiRoot = document.getElementById('ui') || document.body;
  const hudRoot = document.getElementById('hud') || uiRoot;

  const ui = await phase(0.84, 'building the hud', () => ({
    hud: new HUD(hudRoot, game),
    menu: new Menu(uiRoot, game),
    stageSelect: new StageSelect(uiRoot, game),
  }));
  game.attachUI(ui);

  /* ---- 10. hand over ---- */
  setProgress(0.88, 'entering the sanctum');
  await paint();
  await game.boot();

  booted = true;
  setProgress(1, 'ready');
  await paint();
  dismissBoot();

  /* Audio can only start from a gesture.  The title PLAY click is the intended
     one; this catches a player who presses a key first instead. */
  const gesture = () => {
    game.startAudio();
    window.removeEventListener('pointerdown', gesture, true);
    window.removeEventListener('keydown', gesture, true);
  };
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('keydown', gesture, true);

  if (DEV) {
    console.info(
      '%c ASCENDANT — dev mode ',
      'background:#37e0a0;color:#04120c;font-weight:700;padding:2px 6px;border-radius:3px',
      '\n  ASCENDANT.game.__dev.goto("neon-2")   load a stage' +
      '\n  ASCENDANT.game.__dev.noclip()          free fly' +
      '\n  ASCENDANT.game.__dev.skipCP()          advance a checkpoint' +
      '\n  ASCENDANT.game.__dev.tp(x,y,z)         teleport' +
      '\n  ASCENDANT.game.__dev.freezeHazards()   stop the clock' +
      '\n  ASCENDANT.game.__dev.showColliders()   debug draw' +
      '\n  `  (backquote)                         toggle the readout',
    );
  }
  if (STAGE_PARAM) {
    console.info('[ascendant] ?stage=' + STAGE_PARAM + ' — PLAY will load this stage. ' +
      'Nothing auto-starts; the menu comes first.');
  }
}

/* ---------------------------------------------------------------------------
 * window.ASCENDANT — the test-harness handle.  `player` and `stage` are live
 * getters because both are replaced across the run.
 * ------------------------------------------------------------------------ */
function publishHandle(engine, game) {
  const handle = {
    engine,
    game,
    Settings,
    Save,
    version: '1.0.0',
    /* Harness contract: feelcheck.py builds its measurement slab from
       ASCENDANT.Collider + ASCENDANT.THREE. Without these the probe's floor
       never exists and the gate fabricates 8 failures for a passing game. */
    THREE,
    Collider,
    get player() { return game.player; },
    get stage() { return game.stage; },
    get state() { return game.state; },
    get frames() { return game.frames; },
    get ready() { return booted; },
    get snapshot() { return game._snapshot(); },
  };
  try {
    Object.defineProperty(window, 'ASCENDANT', { value: handle, writable: true, configurable: true });
  } catch (e) {
    window.ASCENDANT = handle;
  }
  return handle;
}

/* ---------------------------------------------------------------------------
 * Go
 * ------------------------------------------------------------------------ */
main().catch((err) => showFailure(err, booted ? 'runtime' : 'startup'));

// DEWPOINT boot + main loop.
// Fixed 1/120 s simulation steps, rendering interpolated between the last two steps.

import { Sim } from './sim/sim.js';
import { DT } from './sim/constants.js';
import { campaigns, ELEMENT_ORDER, CAMPAIGN_LENGTH, getLevel, nextLevelId, campaignOf, elementOfLevel } from './levels/index.js';
import { createSave } from './save.js';
import { audio } from './audio.js';
import { Renderer } from './render/renderer.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { PadMenu } from './ui/nav.js';
import { AreaTracker } from './render/areas.js';
import { applyUiScale } from './ui/scale.js';
import { elementUi } from './ui/elements.js';

/** The icon (a name in ICONS) of each element's gauge, for the HUD's notices. */
const GAUGE_ICON_NAME = { water: 'steam', fire: 'heat', clay: 'moisture' };

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const boot = document.getElementById('boot');

function fatal(msg) {
  boot.classList.remove('gone'); boot.classList.add('error');
  boot.querySelector('.boot-text').textContent = msg;
}

let prefersReduced = false;
try { prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { prefersReduced = false; }
const save = createSave(undefined, { reducedMotion: prefersReduced });
save.load();
// another tab playing on the same save: merge its progress in as it happens (it merges ours the same way),
// and redraw the title screen if that is what is showing
save.listen(window, () => { try { if (state === 'title' && menus && menus.screen === 'title') menus.title(); } catch (e) { /* not booted yet */ } });

// ---------------------------------------------------------------------------- state
let renderer = null;
let sim = null;
let levelId = null;
let state = 'boot';              // 'title' | 'playing' | 'paused' | 'complete'
let acc = 0;
let last = 0;
let completeInfo = null, completeT = 0;
let audioStarted = false;
let mood = 'menu';
let inputMode = 'keyboard';       // 'keyboard' | 'touch' | 'pad': what the player is using right now (drives hint wording and on-screen controls)
let areas = new AreaTracker(null);    // the named areas of the level on screen, and which the hero has reached
const padMenu = new PadMenu();
const inp = { mx: 0, mz: 0, jump: false, form: null, restart: false };
const IDLE = { mx: 0, mz: 0, jump: false, form: null, restart: false };

// ---------------------------------------------------------------------------- elements
// The element chosen on the title screen. Only one whose campaign has levels can be chosen; a
// saved choice that is not (yet) playable falls back to the first that is.
const playable = (e) => !!campaigns[e] && campaigns[e].levels.length > 0;
let element = playable(save.element()) ? save.element() : ELEMENT_ORDER.find(playable);
/** The element of the level on screen right now (it can differ from `element` behind the title). */
function simElement() { return sim ? sim.element.id : element; }

function isTouchDevice() {
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { coarse = false; }
  return (navigator.maxTouchPoints > 0) && (coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
}

// ---------------------------------------------------------------------------- audio glue
function applyAudioSettings() {
  const s = save.data.settings;
  audio.setVolume(s.music, s.sfx);
  audio.setMuted(s.muted);
}
/** Tell the audio which element's sounds and music to use. Always BEFORE setForm (a form name only means something inside its element). */
function audioElement(e) {
  if (typeof audio.setElement === 'function') audio.setElement(e);   // older audio builds have no elements: water only
}
function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  audio.init();
  applyAudioSettings();
  audioElement(simElement());
  audio.setMusic(mood);
  audio.setForm(state === 'playing' && sim ? sim.player.form : null);
}
function setMood(m) { mood = m; audio.setMusic(m); }

// ---------------------------------------------------------------------------- look of the interface
/** Dress the whole interface (HUD and menus) for an element: Water cool, Fire hot, Clay earthy. */
function skin(e) { uiRoot.dataset.skin = e; }

/**
 * Change screens behind a wipe: the picture closes to ink, `fn` swaps what is behind it, it opens
 * again. With reduced motion (or when one is already running) `fn` simply runs.
 */
let wiping = false;
function wipe(fn) {
  if (wiping || save.data.settings.reducedMotion) { fn(); return; }
  wiping = true;
  const w = document.createElement('div');
  w.className = 'wipe in';
  uiRoot.appendChild(w);
  setTimeout(() => {
    try { fn(); } finally {
      w.className = 'wipe out';
      setTimeout(() => { w.remove(); wiping = false; }, 440);
    }
  }, 270);
}
function uiSfx(name) { startAudio(); audio.playSfx(name); }

// ---------------------------------------------------------------------------- level flow
function loadLevel(idOrData) {
  // normally a registered id; a raw level object is accepted too (debug preview of unregistered levels)
  const data = typeof idOrData === 'string' ? getLevel(idOrData) : idOrData;
  if (!data) return false;
  sim = new Sim(data);
  levelId = data.id;
  acc = 0;
  renderer.setLevel(sim);
  areas = new AreaTracker(data);
  hud.setLevel(data.name, sim.element.id);
  input.setForms(sim.element.forms);
  audioElement(sim.element.id);
  return true;
}

function startLevel(id) {
  if (!loadLevel(id)) return false;
  state = 'playing';
  completeInfo = null;
  renderer.mode = 'play';
  menus.hide();
  skin(sim.element.id);
  hud.setPaused(false);
  hud.show(true);
  input.releaseAll();
  input.enabled = true;
  setMood(sim.level.music === undefined ? 'calm' : sim.level.music);
  audio.setForm(sim.player.form);
  if (getLevel(levelId)) {
    // playing a level of another element (from the level select) makes that the chosen element
    if (playable(sim.element.id)) element = sim.element.id;
    save.setLast(levelId, elementOfLevel(getLevel(levelId)));
  }
  last = performance.now();
  try { canvas.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  return true;
}

/** The level shown behind the title for an element: the last one played in its campaign, else its first. */
function attractLevel(e) {
  const c = campaigns[e], last = save.lastFor(e);
  return c.levels.some((l) => l.id === last) ? last : c.levels[0].id;
}

/** The title screen picked another element: remember it, swap the scene behind the menu, redraw the menu. */
function selectElement(e) {
  if (!playable(e) || state !== 'title') return false;
  element = e;
  save.setElement(e);
  toTitle();
  return true;
}

function toTitle() {
  loadLevel(attractLevel(element));
  state = 'title';
  renderer.mode = 'attract';
  input.enabled = false; input.releaseAll();
  hud.show(false);
  setMood('menu');
  audio.setForm(null);
  skin(element);
  menus.title();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  hud.setPaused(true);
  input.enabled = false; input.releaseAll();
  const camp = campaignOf(levelId);
  menus.pause({
    name: sim.level.name, element: sim.element.id, number: camp ? camp.levels.findIndex((l) => l.id === levelId) + 1 : 0,
    areas: areas.areas.map((a, i) => ({ name: a.name, seen: areas.seen.has(i), here: i === areas.current })),
    shards: sim.level.shards.map((sh, i) => sim.shardsTaken.includes(i)),
  });
}

function resume() {
  if (state !== 'paused') return;
  state = 'playing';
  hud.setPaused(false);
  menus.hide();
  input.enabled = true;
  last = performance.now(); acc = 0;
  try { canvas.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}

function onComplete(e) {
  const registered = !!getLevel(levelId);
  const before = save.level(levelId);
  // an unregistered preview level (window.__dew.loadData) is never written to the save
  const rec = registered ? save.recordLevel(levelId, { shards: e.shards, timeMs: e.timeMs }) : { bestMs: e.timeMs, shards: e.shards };
  const nextId = nextLevelId(levelId);
  const camp = campaignOf(levelId);
  completeInfo = {
    element: sim.element.id, count: camp ? camp.levels.length : 0, total: CAMPAIGN_LENGTH,
    name: sim.level.name, timeMs: e.timeMs, bestMs: rec.bestMs,
    newBest: before.bestMs === 0 || e.timeMs < before.bestMs,
    shards: e.shards, allShards: rec.shards, deaths: e.deaths,
    hasNext: !!nextId, nextName: nextId ? getLevel(nextId).name : '',
  };
  state = 'complete';
  completeT = 1.6;
  hud.celebrate(sim.level.name);
  input.enabled = false; input.releaseAll();
  setMood('win');
  audio.setForm(null);
}

// ---------------------------------------------------------------------------- sim events -> audio / hud / fx
function handleEvents() {
  const evs = sim.events;
  if (!evs.length) return;
  sim.events = [];
  const quiet = state === 'title';
  const c = renderer.cam, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  for (const e of evs) {
    renderer.onEvent(e);
    if (quiet) continue;
    switch (e.type) {
      case 'sfx': {
        // pan by where the sound is across the screen (camera right = (cos yaw, -sin yaw))
        const dx = e.x - c.target.x, dz = e.z - c.target.z;
        const pan = Math.max(-1, Math.min(1, (dx * cy - dz * sy) / 9));
        audio.playSfx(e.name, { intensity: e.intensity, pan });
        break;
      }
      case 'form':
        audio.setForm(e.to);
        // the gauge ran dry and the form gave out: a clear cue, not a silent change
        if (e.cause === 'gauge') { hud.toast(sim.element.id === 'fire' ? 'Out of heat' : `Out of ${elementUi(sim.element.id).gauge.name.toLowerCase()}`, GAUGE_ICON_NAME[sim.element.id]); audio.playSfx('denied'); }
        break;
      case 'hint': hud.showHint(e.text); break;
      case 'checkpoint': hud.toast('Checkpoint', 'flag'); break;
      case 'respawn':
        if (!save.data.settings.reducedMotion) hud.blink();
        // say WHY (a fall explains itself; being put out by water, or burnt, does not)
        if (e.cause === 'water' && sim.element.id === 'fire') hud.toast('Doused', GAUGE_ICON_NAME[sim.element.id]);
        else if (e.cause === 'fire') hud.toast('Burnt', GAUGE_ICON_NAME[sim.element.id]);
        else if (e.cause === 'crush') hud.toast('Squashed', '');
        break;

      case 'complete': onComplete(e); break;
      default: break;
    }
  }
}

/** The named area the hero is in: announced the first time it is entered, shown under the level's name after. */
function trackArea() {
  if (state !== 'playing' || !areas.areas.length) return;
  const was = areas.current, first = areas.step(sim.player.x, sim.player.z);
  if (first >= 0) hud.showArea(areas.areas[first].name, first, areas.areas.length);
  else if (areas.current !== was && areas.current >= 0) hud.setArea(areas.areas[areas.current].name);
}

// ---------------------------------------------------------------------------- frame
/** One sim tick of play with this tick's input. A form key pressed while the sim cannot take it at all (riding a wire) gets the "denied" cue instead of vanishing. */
function playStep() {
  input.sample(renderer.controlYaw, inp);
  if (inp.form && sim.player.ride) { audio.playSfx('denied'); hud.toast('Not on the wire', ''); }
  sim.step(inp);
}

function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();
  const rawMs = now - last;
  last = now;
  const dt = Math.min(0.1, Math.max(0, rawMs / 1000));
  // browser zoom or moving the window to another screen changes the pixel ratio without a resize event
  if (window.devicePixelRatio !== lastDpr) resize();

  const look = input.pollGamepad();
  input.frame();
  const s = save.data.settings;
  if (state === 'playing') renderer.orbitRate(look.x, look.y, dt, s.sensitivity, s.invertY);
  renderer.steer(input.moveX, input.moveY);

  if (state === 'playing' || state === 'complete' || state === 'title') {
    acc += dt;
    let steps = 0;
    while (acc >= DT) {
      if (state === 'playing') playStep(); else sim.step(IDLE);
      handleEvents();
      acc -= DT;
      if (++steps >= 14) { acc = 0; break; }      // never spiral after a long hitch
    }
  }
  if (state === 'complete' && completeInfo) {
    completeT -= dt;
    if (completeT <= 0 && !menus.visible) { hud.show(false); hud.endCelebrate(); menus.complete(completeInfo); }
  }
  trackArea();
  // a gamepad drives whatever menu is up
  if (menus.visible) padMenu.poll(menus.nav, dt, () => { if (menus.stack.length) menus.back(); else if (state === 'paused') { uiSfx('ui_back'); resume(); } });
  const alpha = state === 'paused' ? 1 : acc / DT;
  renderer.render(alpha, state === 'paused' ? 0 : dt, state === 'playing' ? input.moveX : 0);
  hud.update(sim, dt);
  if (rawMs > 0 && rawMs < 1000) renderer.measure(rawMs, performance.now() - t0);
}

// ---------------------------------------------------------------------------- wiring
let lastDpr = 0;
function resize() {
  const w = window.innerWidth || canvas.clientWidth || 1, h = window.innerHeight || canvas.clientHeight || 1;
  lastDpr = window.devicePixelRatio;
  renderer.resize(w, h, lastDpr || 1);
  applyUiScale(document, w, h);          // a window smaller than 360 x 360 scales the whole UI down as one
}

function setInputMode(mode) {
  if (mode === inputMode) return;
  inputMode = mode;
  hud.setInputMode(mode);
}
function setTouchMode(on) { setInputMode(on ? 'touch' : 'keyboard'); }

function applySetting(key, value) {
  const v = save.setSetting(key, value);
  const s = save.data.settings;
  if (key === 'music' || key === 'sfx' || key === 'muted') applyAudioSettings();
  else if (key === 'quality') renderer.setQuality(s.quality);
  else if (key === 'reducedMotion') { renderer.reducedMotion = s.reducedMotion; document.body.classList.toggle('reduced-motion', s.reducedMotion); }
  return v;
}

let input, hud, menus;

function init() {
  try {
    renderer = new Renderer(canvas, { deviceDpr: window.devicePixelRatio || 1, startTier: isTouchDevice() ? 1 : 2 });
  } catch (e) {
    fatal('DEWPOINT needs WebGL, and this browser would not start it. Try another browser or turn on hardware acceleration.');
    throw e;
  }
  const s = save.data.settings;
  renderer.reducedMotion = s.reducedMotion;
  document.body.classList.toggle('reduced-motion', s.reducedMotion);
  renderer.setQuality(s.quality);
  applyAudioSettings();

  input = new Input(canvas, {
    onOrbit: (dx, dy) => { if (state === 'playing') renderer.orbit(dx, dy, save.data.settings.sensitivity, save.data.settings.invertY); },
    onPause: () => {
      if (state === 'playing') { uiSfx('ui_tap'); pause(); }
      else if (state === 'paused') { if (menus.stack.length) menus.back(); else { uiSfx('ui_back'); resume(); } }
      else if (menus.visible && menus.stack.length) menus.back();
    },
    onAnyGesture: startAudio,
    onDevice: setInputMode,
    onDismissHint: () => hud.dismissHint(),
    getForms: () => (sim ? { current: sim.player.form, pending: sim.player.pendForm, allowed: sim.level.forms } : null),
  });
  hud = new Hud(uiRoot, input, {
    onPause: () => { uiSfx('ui_tap'); pause(); },
    onOrbit: (dx, dy) => { if (state === 'playing') renderer.orbit(dx, dy, save.data.settings.sensitivity * 1.25, save.data.settings.invertY); },
    onGesture: startAudio,
  });
  menus = new Menus(uiRoot, {
    campaigns, order: ELEMENT_ORDER, total: CAMPAIGN_LENGTH, save,
    element: () => element,
    playing: () => (playable(simElement()) ? simElement() : element),
    setElement: selectElement,
    skin,
    play: (id) => wipe(() => startLevel(id)),
    resume,
    restartLevel: () => wipe(() => startLevel(getLevel(levelId) || sim.level.source)),
    restartCheckpoint: () => { resume(); input.requestRestart(); },
    quit: () => wipe(toTitle),
    next: () => wipe(() => { const n = nextLevelId(levelId); if (n) startLevel(n); else toTitle(); }),
    setting: applySetting,
    resetProgress: () => save.resetProgress(),
    sfx: uiSfx,
  });

  setInputMode(isTouchDevice() ? 'touch' : 'keyboard');
  window.addEventListener('pointerdown', (e) => { startAudio(); if (e.pointerType === 'touch') setInputMode('touch'); }, true);

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();

  // pause when the tab is hidden; never run audio in the background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); input.releaseAll(); audio.suspend(); }
    else { audio.resume(); last = performance.now(); acc = 0; }
  });
  window.addEventListener('pagehide', () => { audio.suspend(); });

  // stop the page itself from scrolling, zooming or selecting under the game
  const stop = (e) => { if (!(e.target instanceof Element) || !e.target.closest('.scroll, input')) e.preventDefault(); };
  document.addEventListener('touchmove', stop, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => { if (!(e.target instanceof Element) || !e.target.closest('input')) e.preventDefault(); });
  document.addEventListener('selectstart', (e) => e.preventDefault());

  // Debug hook for measured verification (DESIGN.md "Architecture").
  // The ForgeFlow control bar's Pause button calls window.__PAUSE__.toggle() when a game exposes it.
  window.__PAUSE__ = { toggle() { if (state === 'playing') pause(); else if (state === 'paused') resume(); } };
  window.__dew = {
    get sim() { return sim; },
    loadLevel(id) { return startLevel(id); },
    setForm(f) { return sim ? sim.forceForm(f) : false; },
    teleport(x, y, z) { if (!sim) return false; sim.teleport(x, y, z); renderer.snap(); return true; },
    completeLevel() { if (sim && state === 'playing') sim.complete(); return !!sim; },
    stats() { return renderer.stats(); },
    // extras (not part of the contract)
    bench(n) { return renderer.bench(n); },
    loadData(levelObject) { return startLevel(levelObject); },
    /**
     * Run the game forward by `seconds` right now, exactly as the frame loop would (real input
     * state, fixed steps, events, one render). For automated checks in a tab whose
     * requestAnimationFrame is throttled or paused.
     */
    advance(seconds = 1 / 60) {
      const n = Math.max(1, Math.round(seconds / DT));
      for (let i = 0; i < n; i++) {
        input.frame();
        renderer.steer(input.moveX, input.moveY);
        if (state === 'playing') playStep();
        else if (state === 'complete' || state === 'title') sim.step(IDLE);
        else break;
        handleEvents();
      }
      if (state === 'complete' && completeInfo) { completeT -= seconds; if (completeT <= 0 && !menus.visible) { hud.show(false); hud.endCelebrate(); menus.complete(completeInfo); } }
      trackArea();
      renderer.render(1, Math.min(0.1, seconds), input.moveX);
      hud.update(sim, seconds);
      return sim.tick;
    },
    get state() { return state; },
    get renderer() { return renderer; },
    get save() { return save.data; },
    get element() { return element; },
    /** Choose an element as the title screen does (only while the title is showing). */
    selectElement(e) { return selectElement(e); },
    toTitle() { toTitle(); return state; },
    setQuality(q) { return applySetting('quality', q); },
    setTouchMode,
    setInputMode,
    get inputMode() { return inputMode; },
    /** The named areas of the level on screen: { areas: [{ name, x0, z0, x1, z1 }], current, seen: [indices] }. */
    get areas() { return { areas: areas.areas, current: areas.current, seen: [...areas.seen] }; },
    get menus() { return menus; },
    get hud() { return hud; },
  };

  toTitle();
  last = performance.now();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  boot.classList.add('gone');
  setTimeout(() => { boot.hidden = true; }, 700);
}

window.addEventListener('error', (e) => { if (state === 'boot') fatal(`DEWPOINT could not start: ${e.message || 'unknown error'}`); });
try { init(); } catch (e) {
  if (!boot.classList.contains('error')) fatal(`DEWPOINT could not start: ${(e && e.message) || e}`);
  throw e;
}

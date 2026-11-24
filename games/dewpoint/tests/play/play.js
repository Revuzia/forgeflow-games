// The player's-eye suites. Each boots the real game (index.html: real modules, real renderer, real HUD) in an
// iframe of an exact size, stops the game's own frame loop (so nothing moves except when a suite says so), and
// then plays it the way a player does: KeyboardEvents for keys, PointerEvents for mouse drags and for touches on
// the on-screen stick, jump and form buttons. Time is stepped with __dew.advance(), the same code path as a
// frame (input -> fixed sim steps -> render). It measures what the player would see and posts the numbers to
// /__result; tests/play.test.js judges them.
//   ?suite=facing&element=water|fire   the hero's face and body point where it is heading (moving and stopped)
//   ?suite=input                        keys / touch stick move camera-relative; straight lines; jump; forms; invert-Y, sensitivity
//   ?suite=camera&w=375&h=812           every level: spawn, checkpoints and reported cramped spots; the f01 kiln walk with real keys
//   ?suite=smoke                        every level boots with no console errors or warnings, no WebGL errors, a picture that is not blank
//   ?suite=title                        the DEWPOINT wordmark always ends fully opaque (normal, animations stalled, reduced motion)
// &mutate=gaze | oldcam | recentre | settle puts an old bug back (a self-test: the suite must then FAIL).

import * as CC from '../lib/camera-check.js';
import { OldRig } from '../fixtures/old-camera.js';
import { oldGaze } from '../fixtures/old-gaze.js';

const Q = new URLSearchParams(location.search);
const SUITE = Q.get('suite') || 'smoke';
const W = Number(Q.get('w') || 1280), H = Number(Q.get('h') || 720);
const MUTATE = Q.get('mutate') || '';
const outEl = document.getElementById('out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const yieldNow = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (r) => Math.round(r * 1800 / Math.PI) / 10;

let G = null, D = null, R = null;        // the game's window, its __dew hook, its renderer
const consoleMsgs = [];                    // console.error / console.warn / uncaught errors inside the game

async function boot() {
  const f = document.createElement('iframe');
  f.style.width = `${W}px`; f.style.height = `${H}px`;
  f.src = '/index.html';
  document.body.appendChild(f);
  // hook the game's console the moment its document exists (its modules start only after index.html has fetched them)
  const t0 = performance.now();
  let hooked = false;
  while (performance.now() - t0 < 30000) {
    const w = f.contentWindow;
    if (!hooked && w && w.location && /index\.html$/.test(w.location.pathname) && w.document && w.document.readyState !== 'uninitialized') {
      for (const lvl of ['error', 'warn']) {
        const orig = w.console[lvl].bind(w.console);
        w.console[lvl] = (...a) => { consoleMsgs.push(`${lvl}: ${a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 300)}`); orig(...a); };
      }
      w.addEventListener('error', (e) => consoleMsgs.push(`uncaught: ${e.message}`));
      w.addEventListener('unhandledrejection', (e) => consoleMsgs.push(`unhandled rejection: ${e.reason}`));
      hooked = true;
    }
    if (hooked && w.__dew && w.__dew.state === 'title') break;
    await (hooked ? wait(10) : yieldNow());
  }
  G = f.contentWindow; D = G.__dew;
  if (!D) throw new Error('the game did not boot (no __dew within 30 s)');
  R = D.renderer;
  // stop the game's own frame loop: from here on time moves only through D.advance()
  G.requestAnimationFrame = () => 0;
  await wait(50);
  if (MUTATE === 'gaze') Object.getPrototypeOf(Object.getPrototypeOf(R.heroes.water || R.hero))._gaze = oldGaze;
}

// ------------------------------------------------------------------ playing like a player
const key = (code, down) => G.dispatchEvent(new G.KeyboardEvent(down ? 'keydown' : 'keyup', { key: code, code, bubbles: true, cancelable: true }));
const keys = (codes, down) => { for (const c of codes) key(c, down); };
/** Advance `sec` of game time in frames of `frame` seconds (each is input -> sim steps -> one rendered frame). */
function step(sec, frame = 1 / 60, each = null) { const n = Math.round(sec / frame); for (let i = 0; i < n; i++) { D.advance(frame); if (each) each(i); } }
function pointer(target, type, x, y, pointerType, id = 11) {
  target.dispatchEvent(new G.PointerEvent(type, { pointerId: id, pointerType, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
}
/** A mouse drag on the game canvas by (dx, dy) CSS pixels, in 10 moves. */
function mouseDrag(dx, dy = 0) {
  const c = G.document.getElementById('game'), x = W / 2, y = H / 2;
  pointer(c, 'pointerdown', x, y, 'mouse', 3);
  for (let i = 1; i <= 10; i++) pointer(c, 'pointermove', x + dx * i / 10, y + dy * i / 10, 'mouse', 3);
  pointer(c, 'pointerup', x + dx, y + dy, 'mouse', 3);
}
const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const q = (sel) => G.document.querySelector(sel);
/** Push the on-screen stick: finger down in the stick zone, moved by `frac` of the stick's reach at `angle` (0 = up, clockwise). */
function stickDown(angleDeg, frac = 1) {
  const zone = q('.touch-stickzone'), [x, y] = centre(zone), reach = (q('.touch-stick').offsetWidth || 112) * 0.5 * 0.82;
  const a = angleDeg * Math.PI / 180;
  pointer(zone, 'pointerdown', x, y, 'touch', 21);
  pointer(zone, 'pointermove', x + Math.sin(a) * reach * frac * 1.2, y - Math.cos(a) * reach * frac * 1.2, 'touch', 21);
}
function stickUp() { const zone = q('.touch-stickzone'), [x, y] = centre(zone); pointer(zone, 'pointerup', x, y, 'touch', 21); }
function tap(el, holdSec = 0.1) { const [x, y] = centre(el); pointer(el, 'pointerdown', x, y, 'touch', 31); step(holdSec); pointer(el, 'pointerup', x, y, 'touch', 31); }
function touchDrag(dx, dy) {
  const z = q('.touch-orbit'), r = z.getBoundingClientRect(), x = r.left + r.width * 0.7, y = r.top + r.height * 0.5;
  pointer(z, 'pointerdown', x, y, 'touch', 41);
  for (let i = 1; i <= 10; i++) pointer(z, 'pointermove', x + dx * i / 10, y + dy * i / 10, 'touch', 41);
  pointer(z, 'pointerup', x + dx, y + dy, 'touch', 41);
}
/** Back to the level's spawn, its own camera angle and first form, without rebuilding the level (cheap). */
function reset(form) {
  keys(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'], false);
  const sp = D.sim.level.spawn; D.teleport(sp[0], sp[1] + 0.02, sp[2]);
  R.cam.yaw = R.cam.controlYaw = D.sim.level.camYaw * Math.PI / 180; R.cam.pitch = R.cam.defaultPitch(); R.cam.manualT = 9;
  if (form) D.setForm(form);
  step(0.3, 1 / 20);
}
function start(level) {
  keys(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'], false);
  if (!D.loadLevel(level)) throw new Error(`level ${level} would not load`);
  if (MUTATE === 'oldcam' || MUTATE === 'recentre') swapCamera();
  step(0.1);
}
/** Where an object's +z points, as a world yaw (atan2(x, z), the sim's facing convention). */
function worldYaw(o) { o.updateMatrixWorld(true); const e = o.matrixWorld.elements; return Math.atan2(e[8], e[10]); }
/** The camera's own axes on the ground: right and forward (into the picture). */
function camAxes() {
  const e = R.camera.matrixWorld.elements;
  const rx = e[0], rz = e[2], rl = Math.hypot(rx, rz) || 1, fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
  return { rx: rx / rl, rz: rz / rl, fx: fx / fl, fz: fz / fl };
}

// ------------------------------------------------------------------ mutations (self-tests)
function swapCamera() {
  if (MUTATE === 'oldcam') {
    const old = new OldRig(); old.portrait = R.cam.portrait; old.mode = R.cam.mode; old.setLevel(D.sim); old.snap(D.sim.player);
    old.steer = () => {};
    R.cam = old;
  } else if (MUTATE === 'recentre') {
    // the strafe swing and the stick read against the live yaw, as before the fix
    const rig = R.cam, update = rig.update.bind(rig);
    rig.steer = function (x, y) { this.hold = Math.hypot(x, y) > 0.05 ? { x, y } : null; this.controlYaw = this.yaw; };
    rig.update = function (dt, moveX, m) {
      const p = D.sim.player, sp = Math.hypot(p.vx, p.vz), mx = this.hold ? this.hold.x : 0;
      if (this.manualT > 0.8 && sp > 0.5 && Math.abs(mx) > 0.05) this.yaw -= mx * Math.min(1, sp / 4) * 0.85 * dt;
      update(dt, moveX, m);
    };
  }
}

// ------------------------------------------------------------------ suites
const SUITES = {};

/** Face and body point the way the hero is heading: moving and stopped, every form of one element, several camera angles. */
SUITES.facing = async () => {
  const el = Q.get('element') || 'water';
  const level = el === 'water' ? 'l01' : 'f01';
  const forms = (Q.get('forms') || (el === 'water' ? 'liquid,ice,steam,film' : 'ember,blaze,smoke,spark')).split(',');
  const drags = (Q.get('drags') || '0,240,-480').split(',').map(Number);
  const KEYS_ALL = { W: [['KeyW'], 0, 1], A: [['KeyA'], -1, 0], S: [['KeyS'], 0, -1], D: [['KeyD'], 1, 0], WD: [['KeyW', 'KeyD'], 1, 1], SA: [['KeyS', 'KeyA'], -1, -1], Up: [['ArrowUp'], 0, 1], Left: [['ArrowLeft'], -1, 0] };
  const KEYS = Object.fromEntries(Object.entries(KEYS_ALL).filter(([k]) => !Q.get('keys') || Q.get('keys').split(',').includes(k)));
  const cases = [];
  const measure = (phase, rec, kx, ky) => {
    const p = D.sim.player, h = R.hero, yaw = R.cam.controlYaw, s = Math.sin(yaw), c = Math.cos(yaw);
    const heading = Math.atan2(kx * c - ky * s, -kx * s - ky * c);
    const body = worldYaw(h.bodies[p.form]), eyes = worldYaw(h.eyes);
    const e = { body: wrap(body - p.facing), eyes: wrap(eyes - p.facing) };
    if (phase === 'moving') e.input = wrap(p.facing - heading);    // the heading is the key's direction on screen
    for (const [k, v] of Object.entries(e)) if (Math.abs(v) > Math.abs(rec[phase][k] || 0)) rec[phase][k] = v;
  };
  for (const form of forms) {
    start(level);
    for (const drag of drags) {
      for (const [name, [codes, kx, ky]] of Object.entries(KEYS)) {
        reset(form);
        if (drag) mouseDrag(drag);
        step(0.1, 1 / 20);
        const rec = { moving: {}, stopped: {}, later: {} };
        keys(codes, true);
        step(0.7, 1 / 20);
        measure('moving', rec, kx, ky);
        keys(codes, false);
        const kept = D.sim.player.facing;
        step(0.6, 1 / 20); measure('stopped', rec, kx, ky);
        step(1.2, 1 / 20); measure('later', rec, kx, ky);           // past the idle hold (1.5 s): the gaze cycle may move the pupils, never the face
        rec.keptDrift = wrap(D.sim.player.facing - kept);
        cases.push({ form, drag, key: name, camYaw: deg(R.cam.yaw), moving: map(rec.moving, deg), stopped: map(rec.stopped, deg), later: map(rec.later, deg), keptDrift: deg(rec.keptDrift) });
      }
      await yieldNow();
    }
  }
  // on touch: the stick in four directions and one off-axis
  if (Q.get('touch') === '0') return { element: el, cases };
  D.setTouchMode(true);
  for (const form of forms.slice(0, 2)) {
    start(level);
    for (const ang of [0, 90, 180, 270, 20]) {
      reset(form);
      const rec = { moving: {}, stopped: {}, later: {} }, a = ang * Math.PI / 180;
      stickDown(ang); step(0.7, 1 / 20); measure('moving', rec, Math.sin(a), Math.cos(a));
      stickUp(); step(0.6, 1 / 20); measure('stopped', rec, Math.sin(a), Math.cos(a));
      cases.push({ form, touch: ang, camYaw: deg(R.cam.yaw), moving: map(rec.moving, deg), stopped: map(rec.stopped, deg), later: {}, keptDrift: 0 });
    }
  }
  D.setTouchMode(false);
  return { element: el, cases };
};
const map = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

/** Keys and touch move the hero camera-relative, in straight lines; jump and form buttons do what they say; invert-Y and sensitivity work. */
SUITES.input = async () => {
  const out = { screen: [], straight: [], jump: [], forms: [], orbit: {} };
  const PARTS = new Set((Q.get('parts') || 'screen,straight,jump,forms,orbit').split(','));
  // 1. screen directions: after orbiting the camera, W goes into the picture, S out of it, D right, A left (keys and arrows)
  const DIRS = { KeyW: 'in', ArrowUp: 'in', KeyS: 'out', ArrowDown: 'out', KeyD: 'right', ArrowRight: 'right', KeyA: 'left', ArrowLeft: 'left' };
  const screenCase = (label, press, release, want) => {
    const ax = camAxes(), p = D.sim.player, x0 = p.x, z0 = p.z;
    press(); step(0.3, 1 / 30); release();
    const dx = p.x - x0, dz = p.z - z0, l = Math.hypot(dx, dz) || 1e-9;
    const along = { in: (dx * ax.fx + dz * ax.fz) / l, out: -(dx * ax.fx + dz * ax.fz) / l, right: (dx * ax.rx + dz * ax.rz) / l, left: -(dx * ax.rx + dz * ax.rz) / l }[want];
    out.screen.push({ label, want, moved: Math.round(l * 100) / 100, along: Math.round(along * 1000) / 1000 });
  };
  if (PARTS.has('screen') || PARTS.has('straight')) start('l01');
  if (PARTS.has('screen')) for (const drag of [0, 300, -620]) {
    for (const [code, want] of Object.entries(DIRS)) {
      reset(); if (drag) mouseDrag(drag, 40); step(0.1, 1 / 30);
      screenCase(`${code} after a ${drag}px drag`, () => key(code, true), () => key(code, false), want);
    }
  }
  if (PARTS.has('screen')) D.setTouchMode(true);
  if (PARTS.has('screen')) for (const drag of [0, 300, -600]) {
    for (const [ang, want] of [[0, 'in'], [90, 'right'], [180, 'out'], [270, 'left']]) {
      reset(); if (drag) touchDrag(drag, 0); step(0.1, 1 / 30);
      screenCase(`touch stick ${ang} deg after a ${drag}px swipe`, () => stickDown(ang), () => stickUp(), want);
    }
  }
  D.setTouchMode(false);
  // 2. straight lines: hold a direction 4 s from several camera angles - the heading must not drift, the camera must not spin
  // (every key and diagonal from three angles is also held in Node, against the same camera code: tests/camera.test.js;
  // here the real page, real key events and the real frame loop, for the cases that used to bend)
  const HOLDS = { D: ['KeyD'], WD: ['KeyW', 'KeyD'], SA: ['KeyS', 'KeyA'] };
  const straight = (label, press, release) => {
    const p = D.sim.player;
    press(); step(0.25, 1 / 20);
    const h0 = p.facing, y0 = R.cam.yaw; let drift = 0, spin = 0;
    step(3.75, 1 / 20, () => { drift = Math.max(drift, Math.abs(wrap(p.facing - h0))); spin = Math.max(spin, Math.abs(wrap(R.cam.yaw - y0))); });
    release();
    out.straight.push({ label, driftDeg: deg(drift), camSpinDeg: deg(spin) });
  };
  if (PARTS.has('straight')) start('f01');
  if (PARTS.has('straight')) for (const drag of [0, -700]) for (const [n, codes] of Object.entries(HOLDS)) { reset(); if (drag) mouseDrag(drag); step(1.6, 1 / 20); straight(`${n} held 4 s, ${drag}px drag`, () => keys(codes, true), () => keys(codes, false)); await yieldNow(); }
  if (PARTS.has('straight')) D.setTouchMode(true);
  if (PARTS.has('straight')) for (const ang of [20]) { reset(); step(1.6, 1 / 20); straight(`touch stick ${ang} deg held 4 s`, () => stickDown(ang), () => stickUp()); }
  D.setTouchMode(false);
  // 3. jump: Space and the on-screen jump button
  const jumpCase = (label, press, release) => {
    const p = D.sim.player, y0 = p.y; let top = y0;
    press(); step(0.45, 1 / 60, () => { top = Math.max(top, p.y); }); release(); step(1.0);
    out.jump.push({ label, rise: Math.round((top - y0) * 100) / 100, landed: p.grounded });
  };
  if (PARTS.has('jump')) for (const lvl of ['l01', 'f01']) {
    start(lvl); step(0.3); jumpCase(`${lvl} Space`, () => key('Space', true), () => key('Space', false));
    D.setTouchMode(true); reset(); step(0.3); jumpCase(`${lvl} touch jump button`, () => { const b = q('.touch-jump'), [x, y] = centre(b); pointer(b, 'pointerdown', x, y, 'touch', 51); }, () => { const b = q('.touch-jump'), [x, y] = centre(b); pointer(b, 'pointerup', x, y, 'touch', 51); });
    D.setTouchMode(false);
  }
  // 4. forms: each number key and each form button, for both elements, gives the form its label names
  if (PARTS.has('forms')) for (const lvl of ['l12', 'f12']) {
    start(lvl); step(0.3);
    const forms = D.sim.element.forms;
    for (const touch of [false, true]) {
      D.setTouchMode(touch); reset(forms[0]); step(0.3);
      for (const i of [1, 2, 3, 0]) {
        const f = forms[i];
        const btn = touch ? q(`.touch-form.form-${f}`) : q(`.form-slot.form-${f}`);
        const label = btn ? btn.getAttribute('aria-label') : '(no button)';
        const keyText = btn && !touch ? (btn.querySelector('.form-key') || {}).textContent : '';
        if (touch) tap(btn);
        else { key(`Digit${keyText || i + 1}`, true); step(0.05); key(`Digit${keyText || i + 1}`, false); }
        step(0.7);
        out.forms.push({ level: lvl, touch, slot: i + 1, want: f, label, keyText, got: D.sim.player.form });
      }
      // Q and E cycle through the allowed forms
      if (!touch) {
        const before = D.sim.player.form; key('KeyE', true); step(0.05); key('KeyE', false); step(0.7);
        const afterE = D.sim.player.form; key('KeyQ', true); step(0.05); key('KeyQ', false); step(0.7);
        out.forms.push({ level: lvl, cycle: true, before, afterE, afterQ: D.sim.player.form });
      }
    }
    D.setTouchMode(false);
  }
  // 5. orbit settings: invert-Y flips the vertical drag, sensitivity scales it (mouse and touch)
  if (PARTS.has('orbit')) start('l01');
  const orbitCase = (touch) => {
    reset();
    const p0 = R.cam.pitch, y0 = R.cam.yaw;
    if (touch) touchDrag(60, 30); else mouseDrag(60, 30);
    return { dPitch: R.cam.pitch - p0, dYaw: wrap(R.cam.yaw - y0) };
  };
  const set = (k, v) => D.menus.api.setting(k, v);
  if (PARTS.has('orbit')) for (const touch of [false, true]) {
    D.setTouchMode(touch);
    set('invertY', false); set('sensitivity', 1); const base = orbitCase(touch);
    set('invertY', true); const inv = orbitCase(touch);
    set('invertY', false); set('sensitivity', 2); const fast = orbitCase(touch);
    set('sensitivity', 1);
    out.orbit[touch ? 'touch' : 'mouse'] = { base, inv, fast };
  }
  D.setTouchMode(false);
  return out;
};

/** The camera, measured in the real renderer: every level's spawn and checkpoints, cramped spots players reported, and the f01 kiln walk. */
SUITES.camera = async () => {
  const view = { w: W, h: H, portrait: H > W * 1.05, fov: H > W * 1.05 ? 68 : 55 };
  D.setQuality('low');                // the camera does not depend on the finish of the picture; this keeps the run short
  const res = { view, levels: [], kiln: null, spots: [], rigIsCamera: true };
  const watch = (rec, where) => {
    const v = CC.look(D.sim, R.cam, view), P = R.camera.position;
    if (Math.hypot(P.x - R.cam.pos.x, P.y - R.cam.pos.y, P.z - R.cam.pos.z) > 1e-6) res.rigIsCamera = false;
    CC.note(rec, v, where, D.sim, R.cam);
    if (v.seen === 0) { rec.hidRun = (rec.hidRun || 0) + 1; rec.hidMax = Math.max(rec.hidMax || 0, rec.hidRun); } else rec.hidRun = 0;
  };
  // 1. the f01 kiln case exactly as reported: hold W 1.2 s, then A 0.7 s - real keys, real frames - then stand a while
  {
    start('f01'); step(0.3);
    const rec = CC.newRecord();
    key('KeyW', true); step(1.2, 1 / 60, () => watch(rec, 'holding W'));
    key('KeyW', false); key('KeyA', true); step(0.7, 1 / 60, () => watch(rec, 'holding A'));
    key('KeyA', false); step(1.5, 1 / 60, () => watch(rec, 'standing by the kiln'));
    // and pressed into the kiln's corner where the report left Cinder, the camera at the level's own angle
    reset(); D.teleport(7.55, 0.02, -2.55); step(0.3, 1 / 60);
    key('KeyA', true); step(0.1, 1 / 60); key('KeyA', false);
    step(1.0, 1 / 60, () => watch(rec, 'pressed into the kiln corner'));
    const p = D.sim.player;
    res.kiln = { ...pick(rec), hero: [p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100) };
  }
  // 2. every level: spawn, every checkpoint and area start - stand, orbit the camera once round, walk a step each way
  const levels = (Q.get('levels') || '').split(',').filter(Boolean);
  for (const id of levels) {
    start(id);
    const rec = CC.newRecord();
    // the spawn and the first checkpoints (every checkpoint of every level is walked in Node with the same camera
    // code, tests/camera.test.js; here it is the real renderer, real keys and drags)
    const L = D.sim.level, pts = [[...L.spawn]];
    for (const c of L.checkpoints.slice(0, 2)) pts.push([...c.pos]);
    if (L.braziers) for (const c of L.braziers.slice(0, 2)) pts.push([c.pos[0] + 0.9, c.pos[1], c.pos[2]]);
    for (const pt of pts) {
      D.teleport(pt[0], pt[1] + 0.05, pt[2]); step(0.3, 1 / 30);
      CC.cut(rec);
      for (let k = 0; k < 4; k++) { mouseDrag(Math.round((Math.PI / 2) / 0.0052)); step(0.1, 1 / 20, () => watch(rec, `${id} at (${pt.map((v) => v.toFixed(1))}) orbiting`)); }
      for (const code of ['KeyW']) { key(code, true); step(0.4, 1 / 20, () => watch(rec, `${id} at (${pt.map((v) => v.toFixed(1))}) ${code}`)); key(code, false); }
    }
    res.levels.push({ id, points: pts.length, ...pick(rec) });
    await yieldNow();
  }
  // 3. reported cramped spots: [level, x, y, z, key to hold, seconds]
  const spots = JSON.parse(Q.get('spots') || '[]');
  for (const [id, x, y, z, code, sec] of spots) {
    start(id); D.teleport(x, y + 0.05, z); step(0.4, 1 / 30);
    const rec = CC.newRecord();
    if (code) key(code, true);
    step(sec || 1.5, 1 / 60, () => watch(rec, `${id} (${x},${y},${z}) ${code || 'standing'}`));
    if (code) key(code, false);
    step(1.0, 1 / 60, () => watch(rec, `${id} (${x},${y},${z}) after`));
    res.spots.push({ id, at: [x, y, z], code, ...pick(rec) });
  }
  return res;
};
const pick = (r) => ({ frames: r.frames, minDist: Math.round(r.minDist * 100) / 100, minAt: r.minAt, inside: r.inside, insideAt: r.insideAt, off: r.off, offAt: r.offAt, hidden: r.hidden, hiddenAt: r.hiddenAt, hidMaxFrames: r.hidMax || 0, pop: Math.round(r.pop * 100) / 100, popAt: r.popAt });

/** Every level boots in the real renderer: no console errors or warnings, no WebGL errors, a first frame that is a picture. */
SUITES.smoke = async () => {
  const gl = R.gl.getContext(), levels = (Q.get('levels') || '').split(',').filter(Boolean), res = [];
  for (const id of levels) {
    const n0 = consoleMsgs.length;
    start(id);
    // the first frame after the level is built: read it back in the same task, before the page composites it away
    D.advance(1 / 60);
    const px = new Uint8Array(4), colours = new Set(); let lumMin = 255, lumMax = 0;
    const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
      gl.readPixels(Math.floor(bw * (i + 0.5) / 9), Math.floor(bh * (j + 0.5) / 9), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      colours.add(`${px[0] >> 3},${px[1] >> 3},${px[2] >> 3}`);
      const l = (px[0] * 3 + px[1] * 6 + px[2]) / 10; lumMin = Math.min(lumMin, l); lumMax = Math.max(lumMax, l);
    }
    step(0.5, 1 / 30);
    D.setForm(D.sim.element.forms[1]); step(0.3, 1 / 30);    // a second form's materials compile too
    const glErrors = [];
    for (let e = gl.getError(), k = 0; e !== gl.NO_ERROR && k < 10; e = gl.getError(), k++) glErrors.push(e);
    res.push({ id, colours: colours.size, contrast: Math.round(lumMax - lumMin), glErrors, console: consoleMsgs.slice(n0), drawCalls: R.lastCalls });
    await yieldNow();
  }
  return { levels: res };
};

/** The title wordmark: every letter ends fully opaque - in normal play, with animations stalled, and with reduced motion. */
SUITES.title = async () => {
  const doc = G.document, res = {};
  if (MUTATE === 'settle') D.menus._settleLater = () => {};          // the menus as they were: nothing settles a stalled entrance
  const letters = () => [...doc.querySelectorAll('.logo-word span')].map((s) => { const cs = G.getComputedStyle(s); return { ch: s.textContent, opacity: Number(cs.opacity), transform: cs.transform }; });
  D.toTitle(); await wait(2200);
  res.normal = letters();
  // animations that never run (a page whose frames are not being drawn: a background tab, a hidden pane)
  const st = doc.createElement('style'); st.textContent = '*, *::before, *::after { animation-play-state: paused !important; }'; doc.head.appendChild(st);
  D.toTitle(); await wait(100);
  res.stalledEarly = letters();
  await wait(2200);
  res.stalled = letters();
  st.remove();
  // reduced motion: no pop-in at all
  D.menus.api.setting('reducedMotion', true);
  D.toTitle(); await wait(50);
  res.reduced = letters();
  D.menus.api.setting('reducedMotion', false);
  return res;
};

// ------------------------------------------------------------------ run
(async () => {
  let result;
  try {
    await boot();
    const t0 = performance.now();
    const data = await SUITES[SUITE]();
    result = { suite: SUITE, mutate: MUTATE, w: W, h: H, ms: Math.round(performance.now() - t0), data, console: consoleMsgs };
  } catch (e) {
    result = { suite: SUITE, mutate: MUTATE, fatal: String((e && e.stack) || e), console: consoleMsgs };
  }
  outEl.textContent = JSON.stringify(result, null, 1).slice(0, 20000);
  try { await fetch('/__result', { method: 'POST', body: JSON.stringify(result) }); } catch (e) { /* opened by hand: the page shows it */ }
})();

// Player's-eye tests: the real game in a real (headless) browser, played with real input events - key presses,
// mouse drags, touches on the on-screen stick and buttons - and judged on what a player sees and feels.
//   tests/play/play.html + play.js   the page that plays (one suite per run)      tests/lib/browser.js   runs it
// The 810 solvability tests prove the levels in a headless sim; none of them would have noticed the hero's face
// pointing at the camera, the camera jammed into the hero, a held D walking in a circle or the wordmark stuck
// invisible. These do, and each has a self-test that puts the old bug back and demands the suite FAIL.
// Needs Chrome, Chromium or Edge (DEWPOINT_BROWSER chooses one); with none installed every test here prints SKIP
// and passes - read this machine's result from the SKIP lines.

import { test, assert } from './lib/harness.js';
import { runPage } from './lib/browser.js';

const WATER = ['l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08', 'l09', 'l10', 'l11', 'l12'];
const FIRE = WATER.map((id) => `f${id.slice(1)}`);
const runs = new Map();
/** One browser run per query (cached: tests that share a run read the same result). */
function suite(query, timeout = 240000) {
  if (!runs.has(query)) runs.set(query, runPage(`tests/play/play.html?${query}`, { timeout }));
  return runs.get(query);
}
/** The result's data, or null when no browser is installed (SKIP). Throws on a page that failed. */
async function data(query, name) {
  const r = await suite(query);
  if (r.skipped) { console.log(`  SKIP  ${name}: ${r.skipped}`); return null; }
  assert(!r.fatal, () => `${name}: ${r.fatal}`);
  assert(!r.result.fatal, () => `${name}: the page failed: ${r.result.fatal}`);
  return r;
}
/** Console output from the game itself - in-page errors/warnings, and the browser's own log (WebGL warnings land there). */
function gameConsole(r) {
  const fromGame = r.console.filter((l) => /\/src\/|index\.html|WebGL|GL_|THREE/.test(l) && !/tests\/play\//.test(l));
  return [...r.result.console, ...fromGame];
}
const deg = (v) => Math.abs(v || 0);

// ------------------------------------------------------------------ facing
function judgeFacing(d) {
  const bad = [];
  for (const c of d.cases) {
    const what = `${c.form} ${c.key || `touch stick ${c.touch} deg`} (camera at ${c.camYaw} deg${c.drag ? `, after a ${c.drag}px drag` : ''})`;
    if (deg(c.moving.input) > 1) bad.push(`${what}: walked ${c.moving.input} deg off the key's direction on screen`);
    if (deg(c.moving.body) > 6 || deg(c.moving.eyes) > 6) bad.push(`${what}: moving, the body is ${c.moving.body} deg and the face ${c.moving.eyes} deg off the heading`);
    if (deg(c.stopped.body) > 2 || deg(c.stopped.eyes) > 2) bad.push(`${what}: just stopped, body ${c.stopped.body} deg, face ${c.stopped.eyes} deg off the heading`);
    if (deg(c.later.body) > 2 || deg(c.later.eyes) > 2) bad.push(`${what}: standing a while, body ${c.later.body} deg, face ${c.later.eyes} deg off the heading`);
    if (deg(c.keptDrift) > 0.5) bad.push(`${what}: the heading changed by ${c.keptDrift} deg after stopping`);
  }
  return bad;
}
for (const el of ['water', 'fire']) {
  test(`facing (${el}): after every key and the touch stick, every form, camera orbited two ways - face and body point where the hero is heading, moving and stopped`, async () => {
    const r = await data(`suite=facing&element=${el}&w=640&h=360&keys=W,A,S,D,WD&drags=0,-480`, `facing ${el}`);   // (the arrows are checked in the input suite)
    if (!r) return;
    const d = r.result.data;
    assert(d.cases.length >= 50, `only ${d.cases.length} cases ran`);
    const bad = judgeFacing(d);
    assert(!bad.length, () => `${bad.length} cases:\n${bad.slice(0, 12).join('\n')}`);
    const con = gameConsole(r);
    assert(!con.length, () => `console: ${con.slice(0, 5).join(' | ')}`);
  });
}
test('facing self-test: with the old gaze (face kept toward the camera) put back, the facing check FAILS', async () => {
  const r = await data('suite=facing&element=water&w=640&h=360&mutate=gaze&forms=liquid&drags=0,240&keys=W,S,D&touch=0', 'facing self-test');
  if (!r) return;
  const bad = judgeFacing(r.result.data);
  assert(bad.length >= 3, `the old camera-facing gaze passed the facing check (${bad.length} complaints)`);
});

// ------------------------------------------------------------------ input
test('input: W/A/S/D, arrows and the touch stick move the way they point on screen after the camera is orbited (mouse and touch)', async () => {
  const r = await data('suite=input&w=640&h=360&parts=screen,jump,forms,orbit', 'input');
  if (!r) return;
  const d = r.result.data, bad = [];
  assert(d.screen.length >= 34, `only ${d.screen.length} screen-direction cases`);
  for (const c of d.screen) if (!(c.moved > 0.4 && c.along > 0.97)) bad.push(`${c.label}: moved ${c.moved} m, only ${c.along} of it ${c.want}`);
  assert(!bad.length, () => bad.join('\n'));
});
test('input: jump (Space and the jump button) jumps, and every form key and form button gives the form its label names, for both elements; Q/E cycle', async () => {
  const r = await data('suite=input&w=640&h=360&parts=screen,jump,forms,orbit', 'input');
  if (!r) return;
  const d = r.result.data, bad = [];
  for (const j of d.jump) if (!(j.rise > 0.8 && j.landed)) bad.push(`${j.label}: rose ${j.rise} m, landed ${j.landed}`);
  const labels = { liquid: 'Drop', ice: 'Ice', steam: 'Steam', film: 'Film', ember: 'Ember', blaze: 'Blaze', smoke: 'Smoke', spark: 'Spark' };
  const forms = d.forms.filter((f) => !f.cycle);
  assert(forms.length === 16, `${forms.length} form presses, expected 16 (4 forms x keys and buttons x 2 elements)`);
  for (const f of forms) {
    if (f.got !== f.want) bad.push(`${f.level} ${f.touch ? 'touch button' : `key ${f.keyText}`} for ${f.want}: got ${f.got}`);
    if (f.label !== `${labels[f.want]} form`) bad.push(`${f.level}: the ${f.want} button is labelled "${f.label}"`);
    if (!f.touch && f.keyText !== String(f.slot)) bad.push(`${f.level}: the ${f.want} button shows key "${f.keyText}", it is slot ${f.slot}`);
  }
  for (const c of d.forms.filter((f) => f.cycle)) if (c.afterE === c.before || c.afterQ !== c.before) bad.push(`${c.level}: E then Q went ${c.before} -> ${c.afterE} -> ${c.afterQ}`);
  assert(!bad.length, () => bad.join('\n'));
  const con = gameConsole(r);
  assert(!con.length, () => `console: ${con.slice(0, 5).join(' | ')}`);
});
test('input: invert-Y flips a vertical drag and the camera-speed setting scales drags (mouse and touch)', async () => {
  const r = await data('suite=input&w=640&h=360&parts=screen,jump,forms,orbit', 'input');
  if (!r) return;
  for (const [dev, o] of Object.entries(r.result.data.orbit)) {
    assert(Math.abs(o.base.dPitch) > 0.05 && Math.abs(o.base.dYaw) > 0.05, `${dev}: a drag did not orbit (${JSON.stringify(o.base)})`);
    assert(Math.abs(o.inv.dPitch + o.base.dPitch) < 1e-3 && Math.abs(o.inv.dYaw - o.base.dYaw) < 1e-3, `${dev}: invert-Y: ${JSON.stringify(o.inv)} vs ${JSON.stringify(o.base)}`);
    assert(Math.abs(o.fast.dYaw - 2 * o.base.dYaw) < 1e-3 && Math.abs(o.fast.dPitch - 2 * o.base.dPitch) < 1e-3, `${dev}: camera speed 2x: ${JSON.stringify(o.fast)} vs ${JSON.stringify(o.base)}`);
  }
});
test('input: holding D, a diagonal, or the stick 20 deg off forward for 4 s (camera orbited two ways) walks a straight line in the real page - the camera never turns the path', async () => {
  const r = await data('suite=input&parts=straight', 'input straight');
  if (!r) return;
  const s = r.result.data.straight, bad = [];
  assert(s.length >= 7, `only ${s.length} holds`);
  for (const c of s) if (c.driftDeg > 3 || c.camSpinDeg > 25) bad.push(`${c.label}: heading drifted ${c.driftDeg} deg, camera turned ${c.camSpinDeg} deg`);
  assert(!bad.length, () => bad.join('\n'));
});
test('input self-test: with the old strafe swing put back, the straight-line check FAILS', async () => {
  const r = await data('suite=input&parts=straight&mutate=recentre', 'input self-test');
  if (!r) return;
  const bent = r.result.data.straight.filter((c) => c.driftDeg > 20);
  assert(bent.length >= 3, `only ${bent.length} holds bent with the old swing: ${r.result.data.straight.map((c) => `${c.label} ${c.driftDeg}`).join(' | ')}`);
});

// ------------------------------------------------------------------ camera, in the real renderer
const REPORTED_SPOTS = JSON.stringify([['f08', 15.4, 0, 0.4, '', 3.0], ['f01', 7.55, 0, -2.55, '', 1.5]]);   // the burning plank wall; Cinder pressed into the kiln's corner
function judgeCamera(d, label) {
  const bad = [];
  assert(d.rigIsCamera, `${label}: the renderer's camera is not where the rig put it`);
  const k = d.kiln;
  if (k.minDist < 2.8 || k.inside || k.off || k.hidMaxFrames > 12) bad.push(`${label} f01 kiln walk: closest ${k.minDist} m (${k.minAt}), inside ${k.inside}, off screen ${k.off}, hidden ${k.hidMaxFrames} frames`);
  for (const l of [...d.levels, ...d.spots]) {
    const id = l.id + (l.at ? ` (${l.at})` : '');
    if (l.minDist < 2.3) bad.push(`${label} ${id}: camera ${l.minDist} m from the hero at ${l.minAt}`);
    if (l.inside) bad.push(`${label} ${id}: camera inside geometry ${l.inside} frames (${l.insideAt})`);
    if (l.hidMaxFrames > 12) bad.push(`${label} ${id}: hero hidden ${l.hidMaxFrames} frames running (${l.hiddenAt})`);
    if (l.off > 2) bad.push(`${label} ${id}: hero off screen ${l.off} frames (${l.offAt})`);
  }
  return bad;
}
for (const [w, h, levels] of [[375, 812, WATER], [375, 812, FIRE], [1280, 720, WATER], [1280, 720, FIRE], [844, 390, ['l01', 'l07', 'f01', 'f05', 'f08']], [360, 640, ['l04', 'l12', 'f07', 'f12']]]) {
  const label = `${w}x${h}`;
  test(`camera in the real renderer at ${label} (${levels[0]}..${levels[levels.length - 1]}): the f01 kiln walk with real keys, and at the spawn and first checkpoints of ${levels.length} levels (orbited round, walked) the camera keeps its distance, out of walls, the hero on screen and in view`, async () => {
    const r = await data(`suite=camera&w=${w}&h=${h}&levels=${levels.join(',')}&spots=${encodeURIComponent(REPORTED_SPOTS)}`, `camera ${label}`);
    if (!r) return;
    const d = r.result.data;
    assert(d.levels.length === levels.length, `${d.levels.length} levels measured`);
    const bad = judgeCamera(d, label);
    assert(!bad.length, () => bad.slice(0, 12).join('\n'));
    const con = gameConsole(r);
    assert(!con.length, () => `console: ${con.slice(0, 5).join(' | ')}`);
  });
}
test('camera self-test: with the old camera put back in the renderer, the f01 kiln walk FAILS the camera check (phone)', async () => {
  const r = await data('suite=camera&w=375&h=812&levels=&mutate=oldcam', 'camera self-test');
  if (!r) return;
  const k = r.result.data.kiln;
  assert(k.minDist < 2.0 || k.inside > 0, `the old camera passed the kiln walk: closest ${k.minDist} m, inside ${k.inside}`);
});

// ------------------------------------------------------------------ smoke
for (const [name, levels] of [['Water', WATER], ['Fire', FIRE]]) {
  test(`smoke (${name}): all 12 levels boot in the real renderer with no console errors or warnings, no WebGL errors, and a first frame that is a picture`, async () => {
    const r = await data(`suite=smoke&w=1280&h=720&levels=${levels.join(',')}`, `smoke ${name}`);
    if (!r) return;
    const res = r.result.data.levels, bad = [];
    assert(res.length === 12, `${res.length} levels ran`);
    for (const l of res) {
      if (l.colours < 6 || l.contrast < 20) bad.push(`${l.id}: the first frame is nearly blank (${l.colours} colours, contrast ${l.contrast})`);
      if (l.glErrors.length) bad.push(`${l.id}: WebGL errors ${l.glErrors.join(', ')}`);
      if (l.console.length) bad.push(`${l.id}: console: ${l.console.slice(0, 3).join(' | ')}`);
      if (!(l.drawCalls > 0)) bad.push(`${l.id}: no draw calls`);
    }
    const con = gameConsole(r);
    if (con.length) bad.push(`console (browser log): ${con.slice(0, 5).join(' | ')}`);
    assert(!bad.length, () => bad.join('\n'));
  });
}

// ------------------------------------------------------------------ title wordmark
const letters = (list) => list.map((l) => `${l.ch}:${l.opacity}`).join(' ');
test('title: every letter of the DEWPOINT wordmark ends fully opaque and in place - normally, with animations stalled (a background tab, a hidden pane), and with reduced motion', async () => {
  const r = await data('suite=title', 'title');
  if (!r) return;
  const d = r.result.data;
  for (const k of ['normal', 'stalled', 'reduced']) {
    assert(d[k].length === 8, `${k}: ${d[k].length} letters`);
    assert(d[k].every((l) => l.opacity === 1 && l.transform === 'none'), `${k}: ${letters(d[k])}`);
  }
  assert(d.stalledEarly.some((l) => l.opacity < 1), 'the stall did not stall anything: the stalled case proves nothing');
});
test('title self-test: without the settle step, stalled animations leave the wordmark invisible and the title check FAILS', async () => {
  const r = await data('suite=title&mutate=settle', 'title self-test');
  if (!r) return;
  assert(r.result.data.stalled.some((l) => l.opacity < 1), `the stalled wordmark still ended opaque without the fix: ${letters(r.result.data.stalled)}`);
});

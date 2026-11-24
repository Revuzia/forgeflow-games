// The follow camera, judged by what the player sees. The game's own rig (src/render/camera.js - the code the
// renderer runs every frame) is driven alongside the headless sim, on a desktop window and a portrait phone:
//   - along every level's scripted route (tests/solutions/*.js), frame by frame, as a player holding that
//     stick would see it: the camera never closer than MIN_D to the hero, never inside geometry, the hero
//     never hidden (directly or through the cut-away) for more than a moment, on screen, no jumps except
//     deliberate cuts (rare);
//   - at the spawn and every checkpoint, walking into everything nearby with the camera orbited round;
//   - the cramped spots play-testers reported, which the routes must pass through;
//   - the f01 kiln walk that jammed the camera into Cinder, and the held-sideways walk that span the camera.
// The self-tests run the same checks on the camera as it was (tests/fixtures/old-camera.js) and demand they FAIL.

import { test, assert } from './lib/harness.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allLevels, getLevel } from '../src/levels/index.js';
import { Sim } from '../src/sim/sim.js';
import { play } from './lib/play.js';
import * as CC from './lib/camera-check.js';
import { OldRig } from './fixtures/old-camera.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The closest the camera may come to the middle of the hero, metres. (The rig keeps 3 m; easing and a lead ahead of the hero can take a little off.) */
const MIN_D = 2.3;
/** Longest the hero may be wholly hidden, frames at 60 Hz (a wall being cut away takes ~0.1 s to open). */
const HIDDEN_FRAMES = 12;
/** Largest jump of the camera relative to the hero in one frame that is not a deliberate cut, metres. */
const MAX_POP = 2.0;
/**
 * Most deliberate cuts on one route, and the least time between two. A cut is the camera's last resort: the hero
 * came out from under a block the camera was looking through (film leaving a long low wall) and the only way
 * round is through it - the camera cuts to the far side rather than sweeping through the wall or diving in at
 * arm's length. One per such exit; never a flurry.
 */
const MAX_CUTS = 10, CUT_GAP_S = 1.0;

// Spots play-testers reported (2026-11-23): [level, x, y or null, what]. Each must lie on the scripted route,
// so the route check covers it frame by frame.
const REPORTED = [
  ['f01', 7.55, 0, 'Cinder by the kiln prop (camera jammed in, phone)'],
  ['f05', 105, null, 'the flue tunnel under the 2.8 m roof'], ['f05', 114.9, null, 'the flue tunnel exit'],
  ['f05', 112.9, null, 'lintel'], ['f05', 142.6, null, 'lintel'], ['f05', 181.1, null, 'lintel'],
  ['f08', 15.4, null, 'the burning plank wall'], ['f04', 141, null, 'lintel'],
  ['f12', 26, null, 'lintel'], ['f12', 76, null, 'lintel'], ['f12', 323, null, 'lintel'],
  ['l01', 90, null, 'film under the first low wall (88..93.5)'], ['l01', 93.4, null, 'leaving the low wall'],
  ['l01', 102.9, null, 'low wall'], ['l01', 155, null, 'low wall 153..156'], ['l01', 156.6, null, 'leaving it'],
  ['l02', 152, null, 'low wall'], ['l04', -30, null, 'leaving a low wall'], ['l07', 175, null, 'leaving a tunnel'],
  ['l10', 155, null, 'low wall'], ['l12', 40, null, 'low walls 36..44'],
  ['l03', 39.9, 6, 'steam up a roof grate'], ['l05', 157, 6.8, 'steam shaft'], ['l06', 131, 3.9, 'steam shaft'],
  ['l08', 164, 7.5, 'steam shaft'], ['l10', 93, -1.4, 'steam shaft'], ['l12', 127, 5.3, 'steam shaft'],
];

/** Replay a level's solve() with the rig watching, as a player holding that stick. */
async function replay(data, view, Rig) {
  const mod = await import(pathToFileURL(path.join(here, 'solutions', `${data.id}.js`)).href);
  const r = play(data);
  const rig = CC.rigFor(r.sim, view, Rig);
  const rec = CC.newRecord();
  let k = 0, hid = 0, hidMax = 0, hidAt = '', pop = 0, popAt = '', lastCut = -9, cutGap = 99, cutAt = '';
  const seenNear = REPORTED.filter((s) => s[0] === data.id).map(() => false);
  const orig = r.tick.bind(r);
  r.tick = (mx = 0, mz = 0, jump = false, form = null, restart = false) => {
    orig(mx, mz, jump, form, restart);
    if (++k % 2) return;
    const cuts0 = rig.cuts || 0;
    const prev = [rig.pos.x - r.sim.player.x, rig.pos.y - r.sim.player.y, rig.pos.z - r.sim.player.z];
    if (rig.steer) CC.frameWorld(r.sim, rig, mx, mz); else rig.update(CC.FRAME, CC.strafeOf(rig.yaw, mx, mz), r.sim.player);
    const p = r.sim.player, v = CC.look(r.sim, rig, view);
    const where = `t=${r.sim.time.toFixed(2)} hero (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) ${p.form}`;
    CC.note(rec, v, where);
    if (v.seen === 0) { if (++hid > hidMax) { hidMax = hid; hidAt = where; } } else hid = 0;
    const j = Math.hypot(rig.pos.x - p.x - prev[0], rig.pos.y - p.y - prev[1], rig.pos.z - p.z - prev[2]);
    if ((rig.cuts || 0) === cuts0 && p.warp !== r.sim.tick && j > pop) { pop = j; popAt = where; }
    if ((rig.cuts || 0) !== cuts0) { if (r.sim.time - lastCut < cutGap) { cutGap = r.sim.time - lastCut; cutAt = where; } lastCut = r.sim.time; }
    REPORTED.filter((s) => s[0] === data.id).forEach((s, i) => { if (Math.abs(p.x - s[1]) < 1.5 && (s[2] === null || Math.abs(p.y - s[2]) < 2.5)) seenNear[i] = true; });
  };
  mod.solve(r);
  return { rec, hidMax, hidAt, pop, popAt, cuts: rig.cuts || 0, cutGap, cutAt, seenNear, frames: rec.frames };
}

function judge(id, vn, x) {
  const bad = [];
  if (x.rec.minDist < MIN_D) bad.push(`camera ${x.rec.minDist.toFixed(2)} m from the hero at ${x.rec.minAt}`);
  if (x.rec.inside) bad.push(`camera inside geometry for ${x.rec.inside} frames, first at ${x.rec.insideAt}`);
  if (x.hidMax > HIDDEN_FRAMES) bad.push(`hero hidden for ${x.hidMax} frames running at ${x.hidAt}`);
  if (x.pop > MAX_POP) bad.push(`camera jumped ${x.pop.toFixed(2)} m in one frame at ${x.popAt}`);
  if (x.cuts > MAX_CUTS) bad.push(`${x.cuts} camera cuts`);
  if (x.cutGap < CUT_GAP_S) bad.push(`two camera cuts ${x.cutGap.toFixed(2)} s apart, at ${x.cutAt}`);
  if (x.rec.off > x.frames * 0.01) bad.push(`hero off screen for ${x.rec.off} frames, first at ${x.rec.offAt}`);
  return bad.map((b) => `${id} ${vn}: ${b}`);
}

for (const data of allLevels) {
  test(`${data.id}: along the scripted route the camera keeps its distance, stays out of walls and keeps the hero in view (desktop and phone)`, async () => {
    const bad = [];
    for (const [vn, view] of Object.entries(CC.VIEWS)) {
      const x = await replay(data, view);
      bad.push(...judge(data.id, vn, x));
      if (vn === 'phone') REPORTED.filter((s) => s[0] === data.id).forEach((s, i) => { if (!x.seenNear[i]) bad.push(`${data.id}: the route never passes the reported spot x=${s[1]} (${s[3]}) - the check would not cover it`); });
    }
    assert(!bad.length, () => bad.join('\n'));
  });
}

test('every level: at the spawn and every checkpoint, walking into whatever is near with the camera orbited round, the camera never jams in or enters a wall', () => {
  const bad = [];
  for (const data of allLevels) {
    const sim = new Sim(data), L = sim.level;
    const pts = [L.spawn, ...L.checkpoints.map((c) => c.pos), ...(L.braziers || []).map((c) => [c.pos[0] + 0.9, c.pos[1], c.pos[2]])];
    for (const [vn, view] of [['phone', CC.VIEWS.phone]]) {
      const rec = CC.newRecord();
      for (const pt of pts) {
        for (let a = 0; a < 8; a += 1) {
          if (!CC.standAt(sim, { x: pt[0], y: pt[1], z: pt[2] })) break;
          const rig = CC.rigFor(sim, view);
          rig.yaw = L.camYaw * Math.PI / 180 + a * Math.PI / 4; rig.snap(sim.player);
          const d0 = sim.deaths;
          // walk straight ahead (into the picture) for a second and a half, then stop
          for (let f = 0; f < 110; f++) {
            CC.frame(sim, rig, f < 90 ? { x: 0, y: 1 } : null);
            if (sim.deaths !== d0) break;                 // walked off an edge: not a camera question
            if (f > 4) CC.note(rec, CC.look(sim, rig, view), `${data.id} from (${pt.map((v) => v.toFixed(1))}) heading ${a * 45} deg, frame ${f}`);
          }
        }
      }
      if (rec.minDist < MIN_D) bad.push(`${data.id} ${vn}: camera ${rec.minDist.toFixed(2)} m from the hero at ${rec.minAt}`);
      if (rec.inside) bad.push(`${data.id} ${vn}: camera inside geometry for ${rec.inside} frames, first at ${rec.insideAt}`);
    }
  }
  assert(!bad.length, () => bad.join('\n'));
});

/** The f01 kiln walk from the bug report, on a phone: hold W 1.2 s, then A 0.7 s, then stand. */
function kilnWalk(Rig) {
  const sim = new Sim(getLevel('f01')), view = CC.VIEWS.phone, rig = CC.rigFor(sim, view, Rig), rec = CC.newRecord();
  const drive = (stick, sec) => {
    for (let f = 0; f < Math.round(sec * 60); f++) {
      if (Rig) { const w = CC.worldMove(rig.yaw, stick ? stick.x : 0, stick ? stick.y : 0); for (let i = 0; i < 2; i++) { sim.step({ mx: w.mx, mz: w.mz }); sim.events.length = 0; } rig.update(CC.FRAME, stick ? stick.x : 0, sim.player); }
      else CC.frame(sim, rig, stick);
      CC.note(rec, CC.look(sim, rig, view), `hero (${sim.player.x.toFixed(2)}, ${sim.player.z.toFixed(2)})`);
    }
  };
  drive(null, 0.3); drive({ x: 0, y: 1 }, 1.2); drive({ x: -1, y: 0 }, 0.7); drive(null, 2.0);
  return rec;
}

/** Cinder standing where the report left it - pressed against the kiln's corner (7.55, 0, -2.55) - with the camera at the level's own angle. */
function kilnStand(Rig) {
  const sim = new Sim(getLevel('f01')), view = CC.VIEWS.phone, rec = CC.newRecord();
  sim.teleport(7.55, 0.02, -2.55);
  const rig = CC.rigFor(sim, view, Rig);
  for (let f = 0; f < 90; f++) {
    for (let i = 0; i < 2; i++) { sim.step({ mx: f < 30 ? 0.2 : 0, mz: f < 30 ? -0.6 : 0 }); sim.events.length = 0; }   // nudging into the corner
    rig.update(CC.FRAME, 0, sim.player);
    if (f > 30) CC.note(rec, CC.look(sim, rig, view), `hero (${sim.player.x.toFixed(2)}, ${sim.player.z.toFixed(2)})`);
  }
  return rec;
}

test('f01 kiln (the reported jam): walking W then A beside the kiln on a phone, and pressed into its corner, the camera stays back and out of the kiln', () => {
  const st = kilnStand();
  // nothing stands behind Cinder there: the camera has no reason to come in at all (a feeler starting ON the kiln's face pulled it to 3.2 m)
  assert(st.minDist >= 5 && !st.inside, `pressed into the kiln's corner: camera ${st.minDist.toFixed(2)} m from Cinder (${st.minAt}), inside ${st.inside}`);
  const rec = kilnWalk();
  assert(rec.minDist >= 2.8, `camera came to ${rec.minDist.toFixed(2)} m at ${rec.minAt}`);
  assert(!rec.inside && !rec.hidden && !rec.off, `inside ${rec.inside} (${rec.insideAt}), hidden ${rec.hidden}, off screen ${rec.off}`);
});

test('self-test: the camera checks FAIL on the camera as it was (the kiln jam, routes into walls)', async () => {
  const k = kilnStand(OldRig);
  assert(k.minDist < 1.6, `the old camera's kiln jam (${k.minDist.toFixed(2)} m) was not caught`);
  const x = await replay(getLevel('l04'), CC.VIEWS.phone, OldRig);
  const bad = judge('l04', 'phone', x);
  assert(bad.some((b) => /m from the hero/.test(b)) && bad.some((b) => /inside geometry/.test(b)), `the old camera passed the route check: ${bad.join(' | ') || 'no complaints'}`);
});

test('holding a direction walks a straight line: the camera never turns under the player (f01 spawn, every key, three camera angles)', () => {
  const bad = [];
  const holds = { W: [0, 1], A: [-1, 0], S: [0, -1], D: [1, 0], WD: [Math.SQRT1_2, Math.SQRT1_2], WA: [-Math.SQRT1_2, Math.SQRT1_2], SD: [Math.SQRT1_2, -Math.SQRT1_2], SA: [-Math.SQRT1_2, -Math.SQRT1_2], 'stick 20 deg': [Math.sin(0.35), Math.cos(0.35)] };
  for (const yawOff of [0, 1.2, -2.4]) {
    for (const [name, [x, y]] of Object.entries(holds)) {
      const sim = new Sim(getLevel('f01')), rig = CC.rigFor(sim, CC.VIEWS.phone);
      rig.yaw += yawOff; rig.controlYaw = rig.yaw; rig.snap(sim.player); rig.manualT = 9;
      for (let f = 0; f < 15; f++) CC.frame(sim, rig, { x, y });
      const h0 = sim.player.facing, y0 = rig.yaw;
      let drift = 0, spin = 0;
      for (let f = 0; f < 225 && sim.deaths === 0; f++) {
        CC.frame(sim, rig, { x, y });
        drift = Math.max(drift, Math.abs(Math.atan2(Math.sin(sim.player.facing - h0), Math.cos(sim.player.facing - h0))));
        spin = Math.max(spin, Math.abs(rig.yaw - y0));
      }
      if (drift > 0.05) bad.push(`${name} (camera turned ${yawOff} rad): the heading drifted ${(drift * 57.3).toFixed(1)} deg in 4 s`);
      if (spin > 0.45) bad.push(`${name} (camera turned ${yawOff} rad): the camera turned ${(spin * 57.3).toFixed(1)} deg by itself`);
    }
  }
  assert(!bad.length, () => bad.join('\n'));
});

test('self-test: the straight-line check FAILS on the old strafe swing (D held at f01 spawn walked a circle)', () => {
  const sim = new Sim(getLevel('f01')), rig = CC.rigFor(sim, CC.VIEWS.phone, OldRig);
  rig.manualT = 9;
  const h = [];
  for (let f = 0; f < 240 && sim.deaths === 0; f++) {
    const w = CC.worldMove(rig.yaw, 1, 0);
    for (let i = 0; i < 2; i++) { sim.step({ mx: w.mx, mz: w.mz }); sim.events.length = 0; }
    rig.update(CC.FRAME, 1, sim.player);
    h.push(sim.player.facing);
  }
  const turn = Math.abs(Math.atan2(Math.sin(h[h.length - 1] - h[0]), Math.cos(h[h.length - 1] - h[0])));
  assert(turn > 0.5 || sim.deaths > 0, `the old camera's circling walk was not reproduced (turned ${(turn * 57.3).toFixed(1)} deg, deaths ${sim.deaths})`);
});

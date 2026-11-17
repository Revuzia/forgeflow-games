// PG_RENDER node checks (PLAYGROUND, render lane; light: one short node process, no browser, no GL).
//   node _harness/renderview/pg_node_checks.ts
// Rows (ids are this file's own; the RD rows they back are named): N1 visibleTableAt against three's own projection (RD-16's exact box) and the
// spec's projection numbers; N2 bubble colours (RD-04: ink and every accent at 3:1 or better on the cream fill); N3 bubble layout and motion
// (RD-04 size and insets, RD-09 Calm / reduced motion fades only, never a grow, nothing bobs); N4 the render pose (limits, identity at 0,
// Calm <= 2 Hz, RD-11's CPU twin); N5 Home's things (arrival scale-in, quiet fade, parked = not drawn, keepsakes); N6 the place framing (RD-17,
// re-stated in round 2 to the orchestrator's model: body CENTRES plus radius inside the insets, the bubble clamped on screen, the lens rule);
// N7 round 3 (MERGE_PC doubts): the posed clip plane (doubt 1), the ONE fine-mesh reduction of a lite body (doubt 2), a place inside Home's
// HUD band (doubt 4: Home's band rows, Home's margin, the Cut bar refit, the lens walk equal to the full scan).
import * as THREE from 'three';
import { visibleTableAt } from '../../src/render/homeview.ts';
import { Emotes, EMOTE_COLOURS, EMOTE_ACCENT, type EmoteFrame } from '../../src/render/emotes.ts';
import { RenderPose } from '../../src/render/pose.ts';
import { HomeKit, HOME_BALL, HOME_MUSICBOX, HOME_SHELF } from '../../src/render/homekit.ts';
import type { EnvHub } from '../../src/render/env.ts';
import { fitPlayBounds, fitPlace, PLACE_FOVS } from '../../src/render/placeview.ts';
import { Framer, bandRows, FRAME_TUNING } from '../../src/render/framing.ts';
import { placeBand } from '../../src/render/placeview.ts';
import { fineFreqFor } from '../../src/render/lod.ts';
import { TIERS } from '../../src/render/quality.ts';

let pass = 0, fail = 0;
const row = (id: string, ok: boolean, msg: string): void => { if (ok) pass++; else fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${msg}`); };

/* ── N1: visibleTableAt ── */
{
  const cases = [{ w: 390, h: 844, ins: [151, 60, 170, 16] }, { w: 1280, h: 800, ins: [120, 24, 150, 24] }];
  let worst = 0;
  for (const c of cases) for (const scale of [0.8, 1.0, 1.25]) for (const ax of [0, 0.7]) {
    const aspect = c.w / c.h, dist = scale * Math.max(3, 2.4 / aspect), ay = 0.42 * scale, az = ax * 0.3, pitch = 0.27;
    const out = new Float32Array(4);
    const ok = visibleTableAt(ax, ay, az, dist, pitch, 35, c.w, c.h, c.ins[0], c.ins[1], c.ins[2], c.ins[3], out);
    // three's camera at the same framing; project the box's edges back to the screen
    const cam = new THREE.PerspectiveCamera(35, aspect, 0.1, 200);
    cam.position.set(ax, ay + dist * Math.sin(pitch), az + dist * Math.cos(pitch)); cam.lookAt(ax, ay, az); cam.updateMatrixWorld();
    const px = (x: number, z: number): [number, number] => { const v = new THREE.Vector3(x, 0, z).project(cam); return [(v.x * 0.5 + 0.5) * c.w, (1 - (v.y * 0.5 + 0.5)) * c.h]; };
    const near = px(out[0], out[3]), nearR = px(out[2], out[3]), far = px(0.5 * (out[0] + out[2]), out[1]);
    const errs = [
      Math.abs(near[1] - (c.h - c.ins[2])),                                     // the near row lies on the bottom inset line
      out[0] > -3.399 ? Math.abs(near[0] - c.ins[3]) : 0,                        // its left end on the left inset line (unless clipped)
      out[2] < 3.399 ? Math.abs(nearR[0] - (c.w - c.ins[1])) : 0,
      out[1] > -3.399 ? Math.abs(far[1] - c.ins[0]) : 0,                         // the far row on the top inset line (unless clipped)
    ];
    const e = Math.max(...errs); worst = Math.max(worst, e);
    if (!ok || e > 0.5) row('N1', false, `${c.w}x${c.h} s${scale} ax${ax}: box ${Array.from(out).map((v) => v.toFixed(3))} err ${e.toFixed(3)} px`);
  }
  row('N1a', worst <= 0.5, `visibleTableAt's box edges land on the inset lines in three's own projection (worst ${worst.toFixed(4)} px, bar 0.5 px; 2 frames x 3 scales x 2 aims)`);
  // the spec's projection numbers (PLAYGROUND_BUILD 9): one body at scale 1, its rest aim (0, 0.42 + 0.7 x (0.5 - 0.42), 0)
  const one = (w: number, h: number, ins: number[], s: number): Float32Array => {
    const aspect = w / h, o = new Float32Array(4), cy = 0.5 * s, ay = 0.42 * s + Math.max(0, cy - 0.42 * s) * 0.7;
    visibleTableAt(0, ay, 0, s * Math.max(3, 2.4 / aspect), 0.27, 35, w, h, ins[0], ins[1], ins[2], ins[3], o); return o;
  };
  const ph = one(390, 844, [151, 60, 170, 16], 1), dk = one(1280, 800, [120, 24, 150, 24], 1);
  console.log(`     one body, scale 1: 390x844 box x ${ph[0].toFixed(3)}..${ph[2].toFixed(3)} z ${ph[1].toFixed(3)}..${ph[3].toFixed(3)}; 1280x800 x ${dk[0].toFixed(3)}..${dk[2].toFixed(3)} z ${dk[1].toFixed(3)}..${dk[3].toFixed(3)}`);
  row('N1b', dk[3] > 0.15 && dk[3] < 0.45, `1280x800, one body: the bottom HUD covers the table in front of z ${dk[3].toFixed(3)} (spec: about 0.3 x scale)`);
  row('N1c', ph[2] - ph[0] > 0.6 && ph[2] - ph[0] < 1.6, `390x844, one body: the near row is ${(ph[2] - ph[0]).toFixed(3)} m wide (spec: 0.78 to 1.22 m at scale 0.8 to 1.25)`);
}

/* ── N2: bubble colours (WCAG relative luminance, the fill = cream at 0.92 over ink) ── */
{
  const Y = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const cr = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const C = EMOTE_COLOURS, fill = C.cream.map((v, i) => v * 0.92 + C.ink[i] * 0.08);
  const named: Record<number, readonly number[]> = { 1: C.amber, 2: C.lagoon, 3: C.coral, 4: C.dusk, 5: C.dusk };
  let worst = 99, worstName = '';
  for (const [k, v] of Object.entries({ ink: C.ink, plum: C.plum, amber: C.amber, lagoon: C.lagoon, coral: C.coral, dusk: C.dusk })) {
    const r = cr(Y(v), Y(fill)); if (r < worst) { worst = r; worstName = k; }
    console.log(`     ${k.padEnd(7)} ${r.toFixed(2)}:1 on the fill`);
  }
  row('N2a', worst >= 3, `ink, the outline and every accent at 3:1 or better on the cream fill (worst ${worstName} ${worst.toFixed(2)}:1)`);
  row('N2b', EMOTE_ACCENT.length === 25 && EMOTE_ACCENT.slice(1).every((a) => a >= 1 && a <= 5 && !!named[a]), 'each of the 24 icons has exactly one accent (amber, lagoon, coral, dusk or the place sky band)');
  row('N2c', EMOTE_ACCENT[17] === 2 && EMOTE_ACCENT[18] === 1 && EMOTE_ACCENT[22] === 5, 'the leaf is lagoon only, the moon amber-filled, the postcard a sky band (LIFE 7.1)');
}

/* ── N3: bubble layout and motion ── */
{
  const run = (w: number, h: number, quiet: boolean, phone: boolean): { minD: number; inside: boolean; overlap: number; maxScale: number; minScaleQuiet: number; bob: number; count: number } => {
    const em = new Emotes(), cam = new THREE.PerspectiveCamera(35, w / h, 0.1, 200);
    const d = Math.max(3, 2.4 / (w / h)) * 1.4;
    cam.position.set(0, 0.42 + d * Math.sin(0.27), d * Math.cos(0.27)); cam.lookAt(0, 0.42, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const bodies = [[0, 0], [0.9, -1.3], [-0.9, -1.3]];
    const f: EmoteFrame = {
      camera: cam, cssW: w, cssH: h, dpr: 2, safe: { top: 151, right: 60, bottom: 170, left: 16 }, capX: 0, capY: 0, capR: 0, ceremony: false, quiet, phone,
      anchor(id, out) { const b = bodies[id]; if (!b) return false; out[0] = b[0]; out[1] = 1.15; out[2] = b[1]; return true; },
    };
    em.show(0, 0, 4, 0, 1.6, 0, 1); em.show(1, 1, 8, 2, 1.6, 3, 0); em.show(2, 2, 22, 1, 0, 0, 0); em.show(3, 0, 5, 0, 1.6, 0, 0);
    let minD = 1e9, inside = true, overlap = 0, maxScale = 0, minScaleQuiet = 1, bob = 0;
    const out = new Float32Array(3), at = new Float32Array(3);
    for (let i = 0; i < 60 * 40; i++) {
      const t = i / 60;
      em.update(1 / 60, f);
      for (const s of em.slots) {
        if (!s.on || !s.shown) continue;
        const dPx = 2 * s.r; if (!s.dot) minD = Math.min(minD, dPx);
        if (s.x - s.r < f.safe.left - 0.5 || s.x + s.r > w - f.safe.right + 0.5 || s.y - s.r < f.safe.top - 0.5 || s.y + s.r > h - f.safe.bottom + 0.5) inside = false;
        maxScale = Math.max(maxScale, s.scale); if (quiet) minScaleQuiet = Math.min(minScaleQuiet, s.scale);
      }
      // overlap between bubbles drawn this frame (after the stacking settled: from 0.5 s)
      if (t > 0.5) for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
        const A = em.slots[a], B = em.slots[b];
        if (!A.on || !B.on || !A.shown || !B.shown) continue;
        overlap = Math.max(overlap, A.r + B.r - Math.hypot(A.x - B.x, A.y - B.y));
      }
      // nothing bobs: the wish bubble (slot 2) does not move during its hold (1 s .. 7.5 s)
      if (t > 1 && t < 7.5 && em.screen(2, out)) { if (t > 1.02) bob = Math.max(bob, Math.hypot(out[0] - at[0], out[1] - at[1])); at[0] = out[0]; at[1] = out[1]; }
    }
    return { minD, inside, overlap, maxScale, minScaleQuiet, bob, count: em.count };
  };
  const ph = run(390, 844, false, true), dk = run(1280, 800, false, false), q = run(390, 844, true, true);
  row('N3a', ph.minD >= 36 - 1e-6, `phone bubbles at least 36 CSS px (smallest non-dot ${ph.minD.toFixed(1)} px; a group keeps 36 px with its icon x0.85)`);
  row('N3b', dk.minD >= 34, `desktop bubbles: smallest ${dk.minD.toFixed(1)} px (40 px say, x0.85 group)`);
  row('N3c', ph.inside && dk.inside && q.inside, 'every bubble inside the HUD safe insets at every frame');
  row('N3d', ph.overlap <= 0.5 && dk.overlap <= 0.5, `stacked: no two bubbles overlap once settled (worst ${Math.max(ph.overlap, dk.overlap).toFixed(2)} px)`);
  row('N3e', ph.maxScale <= 1.13 && ph.maxScale >= 1.04, `not Calm: the pop overshoots about 6% and a wish re-glance grows 12% (max scale ${ph.maxScale.toFixed(3)})`);
  row('N3f', q.minScaleQuiet === 1 && q.maxScale === 1, `Calm or reduced motion: scale stays exactly 1 (a fade only; a re-glance is an opacity lift) (min ${q.minScaleQuiet}, max ${q.maxScale})`);
  row('N3g', ph.bob === 0 && q.bob === 0, `nothing bobs: a wish bubble holds still (largest move ${Math.max(ph.bob, q.bob).toFixed(3)} px)`);
  row('N3h', ph.count >= 1 && q.count >= 1, `the think bubble is still up after 40 s, as its still dot (instances drawn ${ph.count})`);
  // round 2 (RD-17's model): a bubble is clamped into the safe frame and its tail turns to point at its body; a free bubble's tail is 0 exactly;
  // style 3 (LIFE's WISH_DOT) is the still dot
  {
    const w = 390, h = 844, em = new Emotes(), cam = new THREE.PerspectiveCamera(35, w / h, 0.1, 200);
    cam.position.set(0, 0.42 + 9 * Math.sin(0.4), 9 * Math.cos(0.4)); cam.lookAt(0, 0.42, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    // body 0 free in the middle; body 1 far back at the right edge (its anchor above the top inset and under the right column); body 2 a wish dot
    const bodies = [[0, 0, 1.15], [2.2, -9, 1.6], [-0.5, 0.5, 1.15]];
    const f: EmoteFrame = { camera: cam, cssW: w, cssH: h, dpr: 2, safe: { top: 151, right: 60, bottom: 170, left: 16 }, capX: 0, capY: 0, capR: 0, ceremony: false, quiet: false, phone: true,
      anchor(id, out) { const b = bodies[id]; if (!b) return false; out[0] = b[0]; out[1] = b[2]; out[2] = b[1]; return true; } };
    em.show(0, 0, 4, 0, 5, 0, 0); em.show(1, 1, 5, 0, 5, 0, 0); em.show(2, 2, 22, 3, 0, 0, 0);
    for (let i = 0; i < 60; i++) em.update(1 / 60, f);
    const A = em.slots[0], B = em.slots[1], D = em.slots[2];
    const v = new THREE.Vector3(2.2, 1.6, -9).project(cam), ax = (v.x * 0.5 + 0.5) * w, ay = (1 - (v.y * 0.5 + 0.5)) * h;
    const inB = B.x - B.r >= 16 - 0.5 && B.x + B.r <= w - 60 + 0.5 && B.y - B.r >= 151 - 0.5;
    const tailDir = [Math.sin(B.tail), Math.cos(B.tail)], toAnchor = [ax - B.x, ay - B.y], n = Math.hypot(toAnchor[0], toAnchor[1]);
    const cosE = (tailDir[0] * toAnchor[0] + tailDir[1] * toAnchor[1]) / Math.max(1e-6, n);
    row('N3i', A.tail === 0 && inB && B.shown && cosE > 0.9999 && Math.abs(B.tail) > 0.05,
      `a bubble is clamped into the safe frame (anchor at ${ax.toFixed(0)}, ${ay.toFixed(0)} px; bubble at ${B.x.toFixed(0)}, ${B.y.toFixed(0)}) with its tail turned ${(B.tail * 180 / Math.PI).toFixed(1)} deg toward its body (cos ${cosE.toFixed(5)}); a free bubble's tail is 0 (${A.tail})`);
    row('N3j', D.on && D.style === 1 && D.dot, `style 3 (WISH_DOT) shows a wish as its still dot (style ${D.style}, dot ${D.dot})`);
  }
}

/* ── N4: the render pose ── */
{
  const p = new RenderPose(), o = new Float32Array(3);
  p.update(1 / 60, 1, 0, 0, 0, 1, 0.5, false);
  p.apply(0.3, 0.7, -0.2, o, 0);
  row('N4a', !p.active && o[0] === Math.fround(0.3) && o[1] === Math.fround(0.7) && o[2] === Math.fround(-0.2), 'all inputs 0: inactive and the CPU twin is the identity (bit for bit)');
  p.set(0.5, 0, 0.2, 9, 0, 0);
  row('N4b', Math.abs(p.leanX - 0.1) < 1e-9 && p.swayHz === 7 && Math.abs(p.swayAmp - 0.015) < 1e-9, `limits: lean 0.1 R, a shiver 7 Hz at 0.015 R (got lean ${p.leanX}, ${p.swayHz} Hz, ${p.swayAmp})`);
  p.set(0, 0, 0.3, 3, 0, 0);
  row('N4c', p.swayAmp === 0.05 && p.swayHz === 3, `a sway at most 0.05 R (got ${p.swayAmp})`);
  // Calm: the sway never runs faster than 2 Hz: count zero crossings over 5 s
  const cross = (quiet: boolean): number => {
    const q = new RenderPose(); q.set(0, 0, 0.05, 3, 0, 0); let n = 0, prev = 0;
    for (let i = 0; i < 300; i++) { q.update(1 / 60, i / 60, 0, 0, 0, 1, 0.5, quiet); const v = q.u.x; if (i > 30 && Math.sign(v) !== Math.sign(prev) && prev !== 0) n++; prev = v; }
    return n / 2 / (270 / 60);
  };
  const hzCalm = cross(true), hzNorm = cross(false);
  row('N4d', hzCalm <= 2.05 && hzNorm > 2.6, `Calm or reduced motion: a 3 Hz wiggle runs at ${hzCalm.toFixed(2)} Hz (bar 2); not Calm ${hzNorm.toFixed(2)} Hz`);
  // the eye anchor moves with the skin: a point at the eye's height moves as the vertex stage moves the skin there (same formula)
  const q = new RenderPose(); q.set(0.1, 0, 0, 0, 0, 0); for (let i = 0; i < 120; i++) q.update(1 / 60, i / 60, 0, 0, 0, 1, 0.5, false);
  q.apply(0, 0.6, 0.45, o, 0);
  row('N4e', Math.abs(o[0] - 0.05 * 0.6) < 2e-3, `a 0.1 R lean moves a point 0.6 up by 0.1 x 0.5 x 0.6 = 0.030 m (got ${o[0].toFixed(4)})`);
  const b = new RenderPose(); b.asleep = true; let mx = 0; for (let i = 0; i < 600; i++) { b.update(1 / 60, i / 60, 0, 0, 0, 1, 0.5, false); mx = Math.max(mx, Math.abs(b.u.z)); }
  row('N4f', b.active && mx > 0.005 && mx <= 0.0125, `asleep: slow breathing (depth ${mx.toFixed(4)} of the height, one breath per 4 s)`);
}

/* ── N5: Home's things ── */
{
  const hub = { apply(): void {}, release(): void {} } as unknown as EnvHub;
  const k = new HomeKit(hub);
  row('N5a', !k.update(0.1, false) && k.things.every((t) => !t.group.visible), 'no thing shown: nothing drawn (Home is today\'s frame)');
  k.setThing(HOME_MUSICBOX, true, 2.25, -1.05, 0);
  k.update(0.1, false);
  const s1 = k.things[HOME_MUSICBOX].group.scale.x;
  for (let i = 0; i < 30; i++) k.update(1 / 60, false);
  const s2 = k.things[HOME_MUSICBOX].group.scale.x;
  row('N5b', s1 > 0.1 && s1 < 1 && Math.abs(s2 - 1) < 1e-6 && k.things[HOME_MUSICBOX].group.position.x === 2.25, `an arrival scales in (${s1.toFixed(3)} at 0.1 s, ${s2.toFixed(3)} at 0.6 s) at its spot`);
  k.setThing(HOME_BALL, true, 0.85, -0.75, 0);
  k.update(0.1, true);
  const ball = k.things[HOME_BALL];
  const op = (ball.parts[0].mat as THREE.MeshStandardMaterial).opacity;
  row('N5c', ball.group.scale.x === 1 && op > 0 && op < 1 && ball.parts[0].mat.transparent, `Calm or reduced motion: an arrival is a fade at full size (opacity ${op.toFixed(3)} at 0.1 s)`);
  for (let i = 0; i < 30; i++) k.update(1 / 60, true);
  row('N5d', (ball.parts[0].mat as THREE.MeshStandardMaterial).opacity === 1 && !ball.parts[0].mat.transparent, 'the fade ends opaque (back in the opaque list)');
  const poses = new Float32Array(16); poses.set([1.1, 0.22, -0.5, 0, 0, 0, 1, 0], 0);
  k.bind(poses, 2, new Int16Array([HOME_BALL, HOME_MUSICBOX]));
  k.update(1 / 60, false);
  row('N5e', ball.group.position.x === Math.fround(1.1) && ball.group.position.z === Math.fround(-0.5), 'a bound pose moves the Felt Ball (the prop of propThing 0)');
  k.setThing(HOME_BALL, false, 0, 0, 0);
  k.update(1 / 60, false);
  row('N5f', !ball.group.visible, 'a parked thing is not drawn');
  k.setThing(HOME_SHELF, true, 0.9, -1.6, 0); k.setKeepsakes(0b101);
  for (let i = 0; i < 40; i++) k.update(1 / 60, false);
  const drawn = (k as unknown as { keep: THREE.InstancedMesh[] }).keep.reduce((a, im) => a + im.count, 0);
  row('N5g', drawn === 2, `two keepsakes on the shelf (instances ${drawn})`);
  k.dispose();
}

/* ── N6: the place framing (setPlayBounds, RD-17), re-stated in round 2 (PG_RENDER.md "Round 2"): the orchestrator's model frames bodies by
 *  their CENTRES plus radius (each corner centre's column from the ground to its top, 2 x R 0.625, inside the insets; laterally the centre); a
 *  bubble is not in the fit (N3h: it is clamped into the safe frame with its tail toward its body). Why: whole bodies could not meet the bars
 *  (N6d proves the front-row bound). The lens: the widest of PLACE_FOVS that meets the bars (N6e). Every PlaceDef's layouts are 1.25 x 3.0
 *  (tall) and 3.4 x 2.4 (wide), so one row per frame covers every place. ── */
{
  const INS = { phone: [151, 60, 170, 16], desk: [120, 24, 150, 24] } as const;
  const tall = fitPlace(0, 0, 1.25, 3.0, 390, 844, ...INS.phone);
  const wide = fitPlace(0, 0, 3.4, 2.4, 1280, 800, ...INS.desk);
  const wideOnPhone = fitPlayBounds(0, 0, 3.4, 2.4, 35, 390, 844, ...INS.phone);
  const f = (p: ReturnType<typeof fitPlayBounds>): string => p ? `lens ${p.fov} deg, pitch ${p.pitch.toFixed(3)} rad, distance ${p.dist.toFixed(2)} m, aim (${p.aimX.toFixed(2)}, ${p.aimY.toFixed(2)}, ${p.aimZ.toFixed(2)}): front ${p.frontPx.toFixed(1)} px, mid ${p.midPx.toFixed(1)} px` : 'no fit';
  console.log(`     tall 1.25 x 3.0 on 390x844: ${f(tall)}`);
  console.log(`     wide 3.4 x 2.4 on 1280x800: ${f(wide)}`);
  console.log(`     (wide 3.4 x 2.4 framed whole on 390x844, 35 deg: ${f(wideOnPhone)}; not a layout any frame uses)`);
  row('N6a', !!tall && tall.frontPx >= 100 && tall.midPx >= 80, `RD-17 tall layout on 390x844: a 1 m squishy at least 100 px at the front and 80 px mid (${tall ? tall.frontPx.toFixed(1) + ' / ' + tall.midPx.toFixed(1) : 'none'})`);
  row('N6b', !!wide && wide.midPx >= 150, `RD-17 wide layout on 1280x800: at least 150 px at mid-depth (${wide ? wide.midPx.toFixed(1) : 'none'})`);
  row('N6c', !!tall && tall.pitch >= 0.15 && tall.pitch <= 0.9 && !!wide && wide.pitch >= 0.15 && wide.pitch <= 0.9, 'both framings inside the allowed pitch 0.15 to 0.9 rad (P8)');
  // the model itself, in three's own projection: every corner centre's ground point and top (2 x 0.625) inside the safe frame
  let worst = Infinity;
  for (const [fr, w, h, ins, b] of [[tall, 390, 844, INS.phone, [1.25, 3.0]], [wide, 1280, 800, INS.desk, [3.4, 2.4]]] as const) {
    if (!fr) continue;
    const cam = new THREE.PerspectiveCamera(fr.fov, w / h, 0.1, 200);
    cam.position.set(fr.aimX, fr.aimY + fr.dist * Math.sin(fr.pitch), fr.aimZ + fr.dist * Math.cos(fr.pitch)); cam.lookAt(fr.aimX, fr.aimY, fr.aimZ); cam.updateMatrixWorld();
    for (const x of [-b[0], b[0]]) for (const z of [-b[1], b[1]]) for (const y of [0, 1.25]) {
      const v = new THREE.Vector3(x, y, z).project(cam), sx = (v.x * 0.5 + 0.5) * w, sy = (1 - (v.y * 0.5 + 0.5)) * h;
      worst = Math.min(worst, sx - ins[3], w - ins[1] - sx, sy - ins[0], h - ins[2] - sy);
    }
  }
  row('N6d', worst >= -0.01, `the model (three's projection): every corner centre's ground point and top inside the safe insets in both layouts (worst margin ${worst.toFixed(2)} px)`);
  // why whole bodies could not pass: the front row's width bound (the bounds plus a body's own width in the phone's 314 px between its side insets)
  const bound = (390 - 60 - 16) / (2 * 1.25 + 2 * 0.5);
  row('N6e', bound < 100, `whole bodies (R 0.5) cannot meet the tall front bar: front px <= 314 / (2.5 + 1.0) = ${bound.toFixed(1)} (the reason for the round-2 model)`);
  // the lens rule: the tall frame keeps the stage's 35 degrees; the wide frame takes the widest lens that meets the bar, and no wider lens does
  const wider = wide ? PLACE_FOVS.filter((v) => v > wide.fov).map((v) => fitPlayBounds(0, 0, 3.4, 2.4, v, 1280, 800, ...INS.desk)!) : [];
  row('N6f', !!tall && tall.fov === 35 && !!wide && wider.every((q) => !q.meets), `the lens: tall ${tall?.fov} deg (the stage's own); wide ${wide?.fov} deg, every wider lens misses the bar with the fit's 1% margin (${wider.map((q) => q.fov + ': ' + q.midPx.toFixed(1)).join(', ')})`);
}

/* ── N7 (round 3): the MERGE_PC doubts that node can decide ── */
{
  // N7a (doubt 1): the posed twin of a plane. Points ON a cut plane, posed by the CPU twin of the vertex stage, lie on RenderPose.applyPlane's
  // plane (the pose is affine where 0 <= h <= 1.6): the eye bead's clip plane is the posed cut face. With the pose off, the plane is unchanged.
  const P = new RenderPose();
  P.set(0.08, -0.05, 0.04, 2.5, 0.3, 0); P.asleep = true; P.deep = 1;
  for (let i = 0; i < 60; i++) P.update(1 / 60, 3 + i / 60, 0.2, -0.1, 0.0, 0.9, 0.5, false);
  let worst = 0, tilt = 0;
  const o = [0, 0, 0, 0], q = [0, 0, 0];
  for (const [nx, ny, nz] of [[1, 0, 0], [0.6, 0.3, -0.74], [0, 1, 0], [-0.2, -0.4, 0.89]]) {
    const l = Math.hypot(nx, ny, nz), n = [nx / l, ny / l, nz / l], d = n[0] * 0.25 + n[1] * 0.4 + n[2] * -0.1;
    // the bead's anchor (unposed), then points on the plane around its foot
    P.applyPlane(n[0], n[1], n[2], d, 0.3, 0.45, 0.05, o);
    tilt = Math.max(tilt, Math.acos(Math.min(1, Math.abs(o[0] * n[0] + o[1] * n[1] + o[2] * n[2]))));
    const t1 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    const ul = Math.hypot(u[0], u[1], u[2]); u[0] /= ul; u[1] /= ul; u[2] /= ul;
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const k = 0.3 * n[0] + 0.45 * n[1] + 0.05 * n[2] - d, f = [0.3 - k * n[0], 0.45 - k * n[1], 0.05 - k * n[2]];
    for (const a of [-0.12, 0, 0.12]) for (const b of [-0.12, 0, 0.12]) {
      const x = f[0] + a * u[0] + b * v[0], y = f[1] + a * u[1] + b * v[1], z = f[2] + a * u[2] + b * v[2];
      if (y < 0.0 || y > 0.9 * 1.6) continue;
      P.apply(x, y, z, q, 0);
      worst = Math.max(worst, Math.abs(o[0] * q[0] + o[1] * q[1] + o[2] * q[2] - o[3]));
    }
  }
  const Z = new RenderPose(); Z.update(1 / 60, 1, 0, 0, 0, 1, 0.5, false); Z.applyPlane(0.6, 0.8, 0, 0.3, 0.1, 0.2, 0.3, o);
  row('N7a', P.active && worst < 1e-6 && tilt > 0.01 && Math.abs(o[0] - 0.6) < 1e-12 && Math.abs(o[1] - 0.8) < 1e-12 && Math.abs(o[3] - 0.3) < 1e-12,
    `doubt 1: posed points of a cut plane lie on the posed clip plane (worst ${worst.toExponential(2)} m over 4 planes, the pose tilts them up to ${(tilt * 180 / Math.PI).toFixed(2)} deg); pose off = the plane unchanged`);

  // N7b (doubt 2): ONE size reduction. A lite body asks for the low tier's frequency (16) as a tier cap; the share law (lod.ts) is applied once
  // after it. Round 2's second cut (frequency 12 at a quarter or less, then the law again) is gone: a lite sixth on a detail-2 stub (162 sim
  // vertices) at med is 10 x 8^2 + 2 = 642 vertices; the double cut gave frequency 6 (362).
  const cap = Math.min(TIERS.med.fineFreq, TIERS.low.fineFreq), one = fineFreqFor(cap, 162, 1 / 6), dbl = fineFreqFor(12, 162, 1 / 6);
  row('N7b', cap === 16 && one === 8 && dbl === 6 && fineFreqFor(cap, 642, 1) === 16, `doubt 2: a lite body = tier cap 16, then the share law once: sixth on 162 sim vertices -> frequency ${one} (${10 * one * one + 2} vertices; the round-2 double cut gave ${dbl}); a lite whole keeps 16 (2562)`);

  // N7c (doubt 4): the place band IS Home's band: bandRows equals the rows Home's Framer fits into (its private band() in NDC) at four frames,
  // the minBand scaling included; placeBand adds Home's margin; no rows reported = no band
  const F = new Framer() as unknown as { setInsets(i: object): void; band(W: number, H: number): Float64Array };
  let bandErr = 0;
  const R = new Float64Array(4);
  for (const [W, H, ins] of [[390, 844, { top: 151, right: 60, bottom: 170, left: 16 }], [1280, 800, { top: 120, right: 24, bottom: 150, left: 24 }], [358, 201, { top: 60, right: 0, bottom: 90, left: 0 }], [960, 600, { top: 56, right: 0, bottom: 78, left: 0 }]] as const) {
    F.setInsets(ins); const B = F.band(W, H); bandRows(ins, W, H, R);
    bandErr = Math.max(bandErr, Math.abs(B[0] - (1 - 2 * R[0] / H)), Math.abs(B[1] - (-1 + 2 * R[2] / H)), Math.abs(B[2] - (-1 + 2 * R[3] / W)), Math.abs(B[3] - (1 - 2 * R[1] / W)));
  }
  const pb = placeBand({ top: 151, right: 60, bottom: 170, left: 16 }, 390, 844, new Float64Array(4)), my = Math.max(FRAME_TUNING.marginMin, FRAME_TUNING.marginFrac * 844), mx = Math.max(FRAME_TUNING.marginMin, FRAME_TUNING.marginFrac * 390);
  const none = placeBand({ top: 0, right: 0, bottom: 0, left: 0 }, 390, 844, new Float64Array(4));
  row('N7c', bandErr < 1e-12 && Math.abs(pb[0] - 151 - my) < 1e-9 && Math.abs(pb[2] - 170 - my) < 1e-9 && Math.abs(pb[1] - 60 - mx) < 1e-9 && none.every((v) => v === 0),
    `doubt 4: a place's band is Home's (bandRows = the Framer's band, max diff ${bandErr.toExponential(1)} NDC, minBand scaling at 358x201 included) plus Home's margin (390x844: ${Array.from(pb, (v) => v.toFixed(1)).join(' / ')} px); no rows = no band`);

  // N7d (doubt 4, RD-17 on Home's band): both layouts meet the bars inside the band with its margin, every corner column inside it
  const BAND = { phone: Array.from(placeBand({ top: 151, right: 60, bottom: 170, left: 16 }, 390, 844, new Float64Array(4))), desk: Array.from(placeBand({ top: 120, right: 24, bottom: 150, left: 24 }, 1280, 800, new Float64Array(4))) };
  const tb = fitPlace(0, 0, 1.25, 3.0, 390, 844, BAND.phone[0], BAND.phone[1], BAND.phone[2], BAND.phone[3]);
  const wb = fitPlace(0, 0, 3.4, 2.4, 1280, 800, BAND.desk[0], BAND.desk[1], BAND.desk[2], BAND.desk[3]);
  let wst = Infinity;
  for (const [fr, w, h, ins, b] of [[tb, 390, 844, BAND.phone, [1.25, 3.0]], [wb, 1280, 800, BAND.desk, [3.4, 2.4]]] as const) {
    if (!fr) { wst = -Infinity; continue; }
    const cam = new THREE.PerspectiveCamera(fr.fov, w / h, 0.1, 200);
    cam.position.set(fr.aimX, fr.aimY + fr.dist * Math.sin(fr.pitch), fr.aimZ + fr.dist * Math.cos(fr.pitch)); cam.lookAt(fr.aimX, fr.aimY, fr.aimZ); cam.updateMatrixWorld();
    for (const x of [-b[0], b[0]]) for (const z of [-b[1], b[1]]) for (const y of [0, 1.25]) {
      const v = new THREE.Vector3(x, y, z).project(cam), sx = (v.x * 0.5 + 0.5) * w, sy = (1 - (v.y * 0.5 + 0.5)) * h;
      wst = Math.min(wst, sx - ins[3], w - ins[1] - sx, sy - ins[0], h - ins[2] - sy);
    }
  }
  console.log(`     Home's band: tall ${tb ? `${tb.fov} deg, front ${tb.frontPx.toFixed(1)} / mid ${tb.midPx.toFixed(1)} px` : 'no fit'}; wide ${wb ? `${wb.fov} deg, front ${wb.frontPx.toFixed(1)} / mid ${wb.midPx.toFixed(1)} px` : 'no fit'}`);
  row('N7d', !!tb && tb.frontPx >= 100 && tb.midPx >= 80 && !!wb && wb.midPx >= 150 && wst >= -0.01,
    `doubt 4 + RD-17 inside Home's band (rows + margin): tall ${tb?.fov} deg ${tb?.frontPx.toFixed(1)} / ${tb?.midPx.toFixed(1)} px (bars 100 / 80), wide ${wb?.fov} deg mid ${wb?.midPx.toFixed(1)} px (bar 150); every corner column inside the band (worst ${wst.toFixed(2)} px)`);

  // N7e (doubt 4): the Cut bar in a place (the shell adds it to the bottom row while the Cut tool is in hand: +90 px) refits inside the new band,
  // and the lens walk from the last pick equals a scan from 35 degrees for every frame / row set in a mixed order (the hint never changes a pick)
  const scan = (w: number, h: number, hx: number, hz: number, i4: number[]): number => { for (const fov of PLACE_FOVS) { const f = fitPlayBounds(0, 0, hx, hz, fov, w, h, i4[0], i4[1], i4[2], i4[3]); if (f?.meets) return fov; } return 35; };
  const seq: [number, number, number, number, number[]][] = [
    [1280, 800, 3.4, 2.4, BAND.desk], [390, 844, 1.25, 3.0, BAND.phone], [1280, 800, 3.4, 2.4, [BAND.desk[0], BAND.desk[1], BAND.desk[2] + 90, BAND.desk[3]]],
    [390, 844, 1.25, 3.0, [BAND.phone[0], BAND.phone[1], BAND.phone[2] + 90, BAND.phone[3]]], [1280, 800, 3.4, 2.4, [0, 0, 0, 0]], [1280, 800, 3.4, 2.4, [BAND.desk[0] + 60, BAND.desk[1], BAND.desk[2] + 90, BAND.desk[3]]],
  ];
  let same = 0, cutIn = Infinity; const picks: string[] = [];
  for (const [w, h, hx, hz, i4] of seq) {
    const f = fitPlace(0, 0, hx, hz, w, h, i4[0], i4[1], i4[2], i4[3]), sc = scan(w, h, hx, hz, i4);
    if (f && f.fov === sc) same++;
    picks.push(`${w}x${h} rows ${i4.map((v) => Math.round(v)).join('/')}: ${f?.fov} (scan ${sc})`);
    if (f && i4[2] > 200) {
      const cam = new THREE.PerspectiveCamera(f.fov, w / h, 0.1, 200);
      cam.position.set(f.aimX, f.aimY + f.dist * Math.sin(f.pitch), f.aimZ + f.dist * Math.cos(f.pitch)); cam.lookAt(f.aimX, f.aimY, f.aimZ); cam.updateMatrixWorld();
      for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [0, 1.25]) { const v = new THREE.Vector3(x, y, z).project(cam); cutIn = Math.min(cutIn, h - i4[2] - (1 - (v.y * 0.5 + 0.5)) * h); }
    }
  }
  console.log(`     lens picks: ${picks.join('; ')}`);
  row('N7e', same === seq.length && cutIn >= -0.01, `doubt 4: with the Cut bar's +90 px the refit keeps every corner column above it (worst ${cutIn.toFixed(2)} px); the lens walk equals the full scan in ${same} of ${seq.length} mixed refits`);
}

console.log(`\npg_node_checks: ${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

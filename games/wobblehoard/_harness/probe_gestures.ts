// Gesture probe (plain node, exits 1 on failure): classification across timing/distance edges, pressure ramp values,
// two-finger slot assignment, cancel safety, wheel + pinch zoom, the 'outward' pull test, no action leaks after pointerup,
// determinism, a fuzz run with invariants, and the camera maths that backs the hit test.
import * as THREE from 'three';
import type { GestureAction, GestureHost, Gestures, BodyHit, PointerSample } from '../src/input/gestures.ts';
import { createGestures, DEFAULT_GESTURE_CONFIG } from '../src/input/gestures.ts';
import { cameraRay, createBodyHost, projectToNdc, rayPlane, cameraForward } from '../src/input/camera.ts';
import { createMockBody } from './mocks.ts';
import { mulberry32 } from '../src/core/rng.ts';

let bad = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };

// ---- a fake host: the squishy is a disc of radius 100 px at (400, 300); world = (px - centre) / 200 on the z = 0.5 plane
const C = { x: 400, y: 300, r: 100 };
const world = (x: number, y: number) => ({ x: (x - C.x) / 200, y: (C.y - y) / 200, z: 0.5 });
const host: GestureHost = {
  hitTest(x, y): BodyHit | null {
    if (Math.hypot(x - C.x, y - C.y) > C.r) return null;
    return { point: world(x, y), normal: { x: 0, y: 0, z: 1 }, dir: { x: 0, y: 0, z: -1 }, vertex: (Math.round(x) * 7 + Math.round(y)) % 642 };
  },
  bodyScreen: () => C,
  planePoint: (x, y) => world(x, y),
};

interface Rig { g: Gestures; log: GestureAction[]; types(): string[]; take(): GestureAction[]; of(t: string): GestureAction[]; clear(): void }
function rig(cfg = {}): Rig {
  const log: GestureAction[] = [];
  const g = createGestures(host, (a) => log.push(a), cfg);
  return {
    g, log,
    types: () => log.map((a) => a.type === 'gesture' ? `gesture:${a.kind}` : a.type),
    take: () => log.splice(0),
    of: (t) => log.filter((a) => a.type === t),
    clear: () => { log.length = 0; },
  };
}
const S = (id: number, x: number, y: number, t: number, button = 0): PointerSample => ({ id, x, y, t, button });
const kinds = (r: Rig): string => r.log.filter((a) => a.type === 'gesture').map((a) => (a as { kind: string }).kind).join(',');
const pressures = (r: Rig): number[] => r.log.filter((a) => a.type === 'fingerPressure').map((a) => (a as { target: number }).target);

// ============================================================ 1. tap vs hold timing edges
{
  const r = rig();
  r.g.pointerDown(S(1, 400, 300, 0)); r.g.pointerUp(S(1, 400, 300, 100));
  check('tap: down+up in 100 ms = fingerDown, pressure 0.55, tap, fingerUp(tap)', r.types().join() === 'fingerDown,fingerPressure,gesture:tap,fingerUp' && pressures(r)[0] === 0.55 && (r.of('fingerUp')[0] as { why: string }).why === 'tap', r.types().join());
}
for (const [ms, expect] of [[1, 'tap'], [179, 'tap'], [180, 'tap'], [181, 'squish'], [400, 'squish'], [2000, 'squish']] as const) {
  const r = rig();
  r.g.pointerDown(S(1, 400, 300, 0)); r.g.pointerUp(S(1, 400, 300, ms));
  check(`classification at ${ms} ms (no update() call) = ${expect}`, kinds(r) === expect, kinds(r));
}
for (const [px, expect] of [[0, 'tap'], [8, 'tap'], [13.9, 'tap'], [14, 'tap'], [14.5, 'rub'], [30, 'rub']] as const) {
  const r = rig();
  r.g.pointerDown(S(1, 400, 300, 0)); r.g.pointerMove(S(1, 400 + px, 300, 50)); r.g.pointerUp(S(1, 400 + px, 300, 100));
  check(`tap-with-movement: ${px} px sideways in 100 ms = ${expect} (slop is 14 px)`, kinds(r) === expect, kinds(r));
}

// ============================================================ 2. pressure ramp
{
  const r = rig();
  r.g.pointerDown(S(1, 400, 300, 1000));
  const at = (ms: number): number => { r.clear(); r.g.update(1000 + ms); const p = pressures(r); return p.length ? p[p.length - 1] : NaN; };
  check('ramp: nothing emitted at 100 ms and at exactly 180 ms', Number.isNaN(at(100)) && Number.isNaN(at(180)));
  const v260 = at(260);
  check('ramp: begins at the poke level (0.55), 80 ms past the hold mark it is still ~0.56', v260 >= 0.55 && v260 < 0.565, String(v260));
  const q = at(180 + 225);
  const expectQ = 0.55 + 0.45 * (0.25 * 0.25 * (3 - 2 * 0.25));
  check('ramp: quarter point (405 ms) matches 0.55 + 0.45*smoothstep(0.25)', Math.abs(q - expectQ) < 0.004, `${q.toFixed(4)} vs ${expectQ.toFixed(4)}`);
  const mid = at(180 + 450);
  check('ramp: smoothstep midpoint at 630 ms = 0.775', Math.abs(mid - 0.775) < 0.004, mid.toFixed(4));
  check('ramp: reaches exactly 1 at 1080 ms', at(1080) === 1);
  check('ramp: then emits nothing more', Number.isNaN(at(1500)) && Number.isNaN(at(5000)));
  // monotonic over a dense sweep, even with out-of-order timestamps
  const r2 = rig();
  r2.g.pointerDown(S(1, 400, 300, 0));
  let last = 0, mono = true, max = 0;
  const rr = mulberry32(5);
  for (let t = 0; t < 1400; t += 7) { r2.g.update(t - (rr() < 0.2 ? 5 : 0)); }
  for (const p of pressures(r2)) { if (p < last - 1e-9) mono = false; last = p; max = Math.max(max, p); }
  check('ramp: monotonic and bounded in [0.55, 1] even with jittered timestamps', mono && max === 1 && pressures(r2).every((p) => p >= 0.55 && p <= 1), `n=${pressures(r2).length}`);
  const emitted = pressures(r2).length;
  check('ramp: emits a bounded number of updates (not one per ms)', emitted > 20 && emitted < 160, String(emitted));
}

// ============================================================ 3. rub
{
  const r = rig();
  r.g.pointerDown(S(1, 450, 300, 0));
  r.g.pointerMove(S(1, 450, 310, 40));          // 10 px: still undecided
  check('rub: movement under 14 px emits no fingerMove', r.of('fingerMove').length === 0);
  r.g.pointerMove(S(1, 450, 330, 80));          // 30 px tangential
  r.g.pointerMove(S(1, 440, 340, 120));
  r.g.pointerUp(S(1, 440, 340, 140));
  const ups = r.of('fingerUp') as Array<{ why: string }>;
  check('rub: tangential drag = rub, fingerMove per move, fingerUp(release), no grab', kinds(r) === 'rub' && r.of('fingerMove').length === 2 && r.of('grab').length === 0 && ups.length === 1 && ups[0].why === 'release', r.types().join());
}
{
  const r = rig();
  r.g.pointerDown(S(1, 450, 300, 0));
  r.g.update(1500);
  r.g.pointerMove(S(1, 450, 340, 1600));
  r.g.update(3000);
  const after = pressures(r);
  check('rub: a hard squeeze that starts rubbing eases to <= 0.7 and never rises past it', after[after.length - 1] === 0.7 && after.slice(after.indexOf(1) + 1).every((p) => p <= 0.7), after.join(','));
}
{
  const r = rig();
  r.g.pointerDown(S(1, 450, 300, 0));
  r.g.pointerMove(S(1, 450, 340, 50));   // rub decided before the 180 ms mark
  r.g.update(2000);
  check('rub: pressure ramp caps at 0.7 when the rub started before 180 ms', Math.max(...pressures(r)) === 0.7, pressures(r).join(','));
  // drag off the body while rubbing: finger stays (no action), no pull flip
  r.clear();
  r.g.pointerMove(S(1, 700, 340, 2100));
  check('rub: dragging off the body emits nothing (finger stays on its last contact)', r.log.length === 0);
}

// ============================================================ 4. pull + the 'outward' test
{
  const r = rig();
  r.g.pointerDown(S(1, 450, 300, 0));
  r.g.pointerMove(S(1, 470, 300, 60));          // 20 px outward
  const a = r.take();
  const order = a.map((x) => x.type === 'gesture' ? 'gesture:' + x.kind : x.type).join();
  const grab = a.find((x) => x.type === 'grab') as Extract<GestureAction, { type: 'grab' }> | undefined;
  const up = a.find((x) => x.type === 'fingerUp') as Extract<GestureAction, { type: 'fingerUp' }> | undefined;
  check('pull: outward drag > 14 px = gesture:pull, fingerUp(pull), grab (in that order)', order.endsWith('gesture:pull,fingerUp,grab') && up?.why === 'pull', order);
  const hit = host.hitTest(450, 300)!;
  check('pull: grabs the vertex under the PRESS (not under the pointer now)', grab?.vertex === hit.vertex && grab.slot === 0);
  const w = world(470, 300);
  check('pull: first grab target = pointer on the camera-facing plane through the press point', !!grab && Math.abs(grab.target.x - w.x) < 1e-9 && Math.abs(grab.target.z - 0.5) < 1e-9);
  r.g.pointerMove(S(1, 520, 280, 120));
  const gm = r.of('grabMove') as Array<Extract<GestureAction, { type: 'grabMove' }>>;
  check('pull: further moves are grabMove to the world target', gm.length === 1 && Math.abs(gm[0].target.x - world(520, 280).x) < 1e-9);
  check('pull: no fingerMove (rub) once pulling', r.of('fingerMove').length === 0);
  r.g.update(5000);
  check('pull: no pressure updates while pulling (the finger is gone)', pressures(r).length === 0);
  r.clear();
  r.g.pointerUp(S(1, 520, 280, 200));
  check('pull: up = grabRelease(up) only (no fingerUp, no tap)', r.types().join() === 'grabRelease');
}
{
  // outward angle sweep around the cos > 0.2 rule (78.46 deg). press at 60 px right of centre; outward = +x
  const tryAngle = (deg: number): string => {
    const r = rig();
    r.g.pointerDown(S(1, 460, 300, 0));
    const a = (deg * Math.PI) / 180;
    r.g.pointerMove(S(1, 460 + Math.cos(a) * 20, 300 + Math.sin(a) * 20, 50));
    return kinds(r);
  };
  const table = [[0, 'pull'], [45, 'pull'], [75, 'pull'], [78, 'pull'], [79, 'rub'], [90, 'rub'], [135, 'rub'], [180, 'rub'], [-75, 'pull'], [-79, 'rub'], [270, 'rub']] as const;
  const ok = table.every(([d, e]) => tryAngle(d) === e);
  check('outward rule: pull iff cos(angle to outward) > 0.2 (78 deg pulls, 79 deg rubs, inward rubs)', ok, table.map(([d]) => `${d}:${tryAngle(d)}`).join(' '));
  // outward depends on WHERE you pressed: the same +x drag is a pull on the right side and a rub on the left side
  const side = (px: number): string => { const r = rig(); r.g.pointerDown(S(1, px, 300, 0)); r.g.pointerMove(S(1, px + 25, 300, 50)); return kinds(r); };
  check("outward is relative to the body centre: +x drag pulls on the right half, rubs on the left half", side(470) === 'pull' && side(330) === 'rub', `${side(470)}/${side(330)}`);
  // pressing at the very centre has no outward direction -> rub, whatever the drag
  const r = rig(); r.g.pointerDown(S(1, 400, 300, 0)); r.g.pointerMove(S(1, 440, 300, 50));
  check('pressing at the dead centre then dragging = rub (no outward defined)', kinds(r) === 'rub', kinds(r));
  // a fast flick: one jump far beyond 14 px decides by the whole displacement
  const f = rig(); f.g.pointerDown(S(1, 470, 300, 0)); f.g.pointerMove(S(1, 600, 310, 10));
  check('a single big jump is classified from the whole displacement (pull)', kinds(f) === 'pull');
}

// ============================================================ 5. orbit, right/middle button, wheel, pinch
{
  const r = rig();
  r.g.pointerDown(S(1, 100, 100, 0));
  r.g.pointerMove(S(1, 110, 100, 16)); r.g.pointerMove(S(1, 110, 90, 32)); r.g.pointerMove(S(1, 110, 90, 48));
  const orb = r.of('orbit') as Array<{ dx: number; dy: number }>;
  check('orbit: empty-space drag = orbit(dx,dy) per movement, announced once, nothing for a zero move', orb.length === 2 && orb[0].dx === 10 && orb[1].dy === -10 && kinds(r) === 'orbit' && r.of('fingerDown').length === 0, r.types().join());
  r.clear(); r.g.pointerUp(S(1, 110, 90, 60));
  check('orbit: up emits nothing', r.log.length === 0);
  const m = rig();
  m.g.pointerDown(S(1, 400, 300, 0, 2)); m.g.pointerMove(S(1, 420, 300, 30));
  check('right button on the BODY = orbit (no finger)', m.of('fingerDown').length === 0 && m.of('orbit').length === 1);
  const mid = rig();
  mid.g.pointerDown(S(1, 400, 300, 0, 1)); mid.g.pointerMove(S(1, 400, 330, 30));
  check('middle button on the body = orbit', mid.of('fingerDown').length === 0 && mid.of('orbit').length === 1);
  const w = rig();
  w.g.wheel(100); w.g.wheel(-250); w.g.wheel(9999); w.g.wheel(0); w.g.wheel(NaN);
  const z = w.of('zoom') as Array<{ delta: number; source: string }>;
  check('wheel: notch = 1, sign kept, clamped to +-3, 0/NaN ignored', z.length === 3 && z[0].delta === 1 && z[1].delta === -2.5 && z[2].delta === 3 && z.every((q) => q.source === 'wheel'), JSON.stringify(z.map((q) => q.delta)));
}
{
  const r = rig();
  r.g.pointerDown(S(1, 100, 100, 0)); r.g.pointerDown(S(2, 200, 100, 5));
  check('pinch: second empty-space finger announces pinch', kinds(r) === 'pinch');
  r.g.pointerMove(S(2, 300, 100, 20));      // distance 100 -> 200: spread = zoom IN = negative delta
  const z1 = r.of('zoom') as Array<{ delta: number; source: string }>;
  check('pinch: spreading = zoom in (delta < 0), 100 px = 1.11 notch, source pinch', z1.length === 1 && z1[0].source === 'pinch' && Math.abs(z1[0].delta + 100 / DEFAULT_GESTURE_CONFIG.pinchPxPerNotch) < 1e-9, JSON.stringify(z1));
  r.g.pointerMove(S(2, 200, 100, 40));      // back to 100: zoom out
  const z2 = r.of('zoom') as Array<{ delta: number }>;
  check('pinch: squeezing = zoom out (delta > 0)', z2.length === 2 && z2[1].delta > 0);
  check('pinch: no orbit while pinching', r.of('orbit').length === 0);
  r.clear();
  r.g.pointerUp(S(2, 200, 100, 60));
  r.g.pointerMove(S(1, 105, 100, 80));
  check('pinch: lifting one finger hands back to a single-finger orbit, with no jump', r.of('orbit').length === 1 && (r.of('orbit')[0] as { dx: number }).dx === 5 && r.of('zoom').length === 0);
  const t3 = rig();
  t3.g.pointerDown(S(1, 10, 10, 0)); t3.g.pointerDown(S(2, 60, 10, 1)); t3.g.pointerDown(S(3, 90, 10, 2));
  t3.g.pointerMove(S(3, 150, 50, 3));
  check('pinch: a third empty-space finger is ignored', t3.log.filter((a) => a.type !== 'gesture').length === 0);
}

// ============================================================ 6. two fingers on the body
{
  const r = rig();
  r.g.pointerDown(S(10, 350, 300, 0)); r.g.pointerDown(S(11, 450, 300, 20)); r.g.pointerDown(S(12, 400, 250, 30));
  const downs = r.of('fingerDown') as Array<{ slot: number }>;
  check('two fingers: slots 0 and 1; a third finger on the body is ignored (max 2)', downs.length === 2 && downs[0].slot === 0 && downs[1].slot === 1 && r.g.activeCount() === 3, downs.map((d) => d.slot).join());
  r.g.pointerMove(S(12, 400, 200, 40));
  check('two fingers: the ignored third finger produces no actions', !r.log.some((a) => a.type === 'orbit' || a.type === 'grab' || (a.type === 'fingerMove')));
  r.clear();
  r.g.update(1000);
  const sl = (r.of('fingerPressure') as Array<{ slot: number; target: number }>);
  check('two fingers: each ramps its own pressure on its own hold time (finger 1 is 20 ms younger)', sl.some((x) => x.slot === 0) && sl.some((x) => x.slot === 1) && sl.find((x) => x.slot === 0)!.target >= sl.find((x) => x.slot === 1)!.target);
  r.clear();
  r.g.pointerUp(S(10, 350, 300, 1100));
  r.g.pointerDown(S(13, 380, 330, 1110));
  const reuse = r.of('fingerDown') as Array<{ slot: number }>;
  check('two fingers: a freed slot is reused by the next finger', (r.of('fingerUp') as Array<{ slot: number }>)[0].slot === 0 && reuse[0].slot === 0);
  r.clear();
  r.g.pointerUp(S(12, 400, 200, 1200));
  check('two fingers: lifting the ignored finger emits nothing', r.log.length === 0);
}
{
  // one on the body, one on empty space: independent (body finger + orbit)
  const r = rig();
  r.g.pointerDown(S(1, 400, 300, 0)); r.g.pointerDown(S(2, 50, 50, 10)); r.g.pointerMove(S(2, 70, 50, 30));
  check('mixed: body finger + empty-space finger = fingerDown and orbit, no pinch', r.of('fingerDown').length === 1 && r.of('orbit').length === 1 && !kinds(r).includes('pinch'));
}

// ============================================================ 7. cancel safety
{
  const r = rig();
  r.g.pointerDown(S(1, 400, 300, 0)); r.g.pointerCancel(1, 50);
  const up = r.of('fingerUp') as Array<{ why: string }>;
  check('cancel: during a press = fingerUp(cancel), never classified as a tap', up.length === 1 && up[0].why === 'cancel' && !kinds(r).includes('tap') && r.g.activeCount() === 0, r.types().join());
  const p = rig();
  p.g.pointerDown(S(1, 450, 300, 0)); p.g.pointerMove(S(1, 480, 300, 30)); p.clear(); p.g.pointerCancel(1, 60);
  check('cancel: during a pull = grabRelease(cancel)', p.types().join() === 'grabRelease' && (p.log[0] as { why: string }).why === 'cancel');
  const a = rig();
  a.g.pointerDown(S(1, 350, 300, 0)); a.g.pointerDown(S(2, 450, 300, 5)); a.g.pointerDown(S(3, 10, 10, 6)); a.g.pointerDown(S(4, 700, 500, 7));
  a.clear(); a.g.cancelAll(100);
  const ups = (a.of('fingerUp') as Array<{ slot: number }>).map((x) => x.slot).sort();
  check('cancelAll: releases both fingers once each and drops orbit/pinch state', ups.join() === '0,1' && a.g.activeCount() === 0 && a.of('grabRelease').length === 0, a.types().join());
  a.clear(); a.g.update(5000); a.g.pointerMove(S(3, 50, 50, 5001)); a.g.pointerUp(S(1, 350, 300, 5002)); a.g.pointerCancel(2, 5003);
  check('cancelAll: afterwards nothing leaks (update / late move / late up / late cancel)', a.log.length === 0);
  const d = rig();
  d.g.pointerDown(S(1, 400, 300, 0)); d.g.pointerDown(S(1, 400, 300, 100));
  check('a duplicate pointerdown (missed up) releases the old contact first, then starts clean', d.types().join() === 'fingerDown,fingerPressure,fingerUp,fingerDown,fingerPressure' && d.g.activeCount() === 1, d.types().join());
  const n = rig();
  n.g.pointerDown(S(1, NaN, 5, 0)); n.g.pointerDown(S(2, 5, 5, Infinity)); n.g.pointerMove(S(9, 1, 1, 1));
  check('non-finite samples and unknown pointer ids are ignored', n.log.length === 0 && n.g.activeCount() === 0);
}

// ============================================================ 8. no leaks after pointerup + determinism + fuzz invariants
function fuzz(seed: number, steps: number): { log: GestureAction[]; violations: string[]; r: Rig } {
  const r = rig();
  const rnd = mulberry32(seed);
  const violations: string[] = [];
  const all: GestureAction[] = [];
  const slotDown = [false, false], grabbed = [false, false];
  let t = 0;
  const ids = [1, 2, 3, 4];
  const active = new Set<number>();
  const inspect = (): void => {
    for (const a of r.take()) {
      all.push(a); // keep a full copy for the determinism comparison
      if (a.type === 'fingerDown') { if (slotDown[a.slot]) violations.push('fingerDown on a busy slot'); slotDown[a.slot] = true; if (grabbed[a.slot]) violations.push('fingerDown while grabbed'); }
      if (a.type === 'fingerUp') { if (!slotDown[a.slot]) violations.push('fingerUp on a free slot'); slotDown[a.slot] = false; }
      if (a.type === 'fingerPressure') { if (!slotDown[a.slot]) violations.push('pressure without a finger'); if (!(a.target >= 0 && a.target <= 1)) violations.push('pressure out of range'); }
      if (a.type === 'fingerMove') { if (!slotDown[a.slot]) violations.push('fingerMove without a finger'); }
      if (a.type === 'grab') { if (grabbed[a.slot]) violations.push('double grab'); if (slotDown[a.slot]) violations.push('grab with finger still down'); grabbed[a.slot] = true; }
      if (a.type === 'grabMove') { if (!grabbed[a.slot]) violations.push('grabMove without grab'); }
      if (a.type === 'grabRelease') { if (!grabbed[a.slot]) violations.push('grabRelease without grab'); grabbed[a.slot] = false; }
    }
  };
  for (let i = 0; i < steps; i++) {
    t += Math.floor(rnd() * 90);
    const id = ids[Math.floor(rnd() * ids.length)];
    const x = rnd() < 0.6 ? C.x + (rnd() - 0.5) * 260 : rnd() * 800, y = rnd() < 0.6 ? C.y + (rnd() - 0.5) * 260 : rnd() * 600;
    const k = rnd();
    if (k < 0.25) { r.g.pointerDown(S(id, x, y, t, rnd() < 0.1 ? 2 : 0)); active.add(id); }
    else if (k < 0.65) r.g.pointerMove(S(id, x, y, t));
    else if (k < 0.85) { r.g.pointerUp(S(id, x, y, t)); active.delete(id); }
    else if (k < 0.9) { r.g.pointerCancel(id, t); active.delete(id); }
    else if (k < 0.93) { r.g.pointerDown(S(id, x, y, t)); inspect(); r.g.pointerUp(S(id, x, y, t + 40)); active.delete(id); t += 40; } // a tap
    else if (k < 0.97) r.g.update(t);
    else if (k < 0.99) r.g.wheel((rnd() - 0.5) * 300);
    else { r.g.cancelAll(t); active.clear(); }
    inspect();
  }
  r.g.cancelAll(t + 1);
  inspect();
  if (slotDown[0] || slotDown[1] || grabbed[0] || grabbed[1]) violations.push('state left dangling after cancelAll');
  if (r.g.activeCount() !== 0) violations.push('pointers left after cancelAll');
  r.g.update(t + 99999);
  if (r.log.length) violations.push('actions leaked after cancelAll');
  return { log: all, violations, r };
}
{
  let v = 0, actions = 0;
  const cover: Record<string, number> = {};
  for (let s = 1; s <= 300; s++) { const f = fuzz(s, 300); v += f.violations.length; actions += f.log.length; for (const a of f.log) { const k = a.type === 'gesture' ? a.kind : a.type; cover[k] = (cover[k] ?? 0) + 1; } if (f.violations.length && v < 4) console.log('  seed', s, f.violations.slice(0, 3)); }
  check('fuzz: 300 random multi-pointer scripts x 300 events keep every slot/grab/pressure invariant', v === 0, `${actions} actions, ${v} violations`);
  const need = ['tap', 'squish', 'rub', 'pull', 'orbit', 'pinch', 'zoom', 'grabMove', 'fingerMove', 'fingerPressure'];
  check('fuzz covers every gesture kind', need.every((k) => (cover[k] ?? 0) > 20), need.map((k) => `${k}:${cover[k] ?? 0}`).join(' '));
  // determinism: same script, same actions, bit for bit
  const a = fuzz(77, 400), b = fuzz(77, 400);
  check('deterministic: the same script yields the identical action stream', a.log.length > 50 && JSON.stringify(a.log) === JSON.stringify(b.log), `${a.log.length} actions`);
  // and the machine has no hidden wall-clock: shifting every timestamp by a constant changes nothing
  const shift = (off: number): string => {
    const r = rig(); const rnd = mulberry32(9); let t = off;
    for (let i = 0; i < 200; i++) { t += Math.floor(rnd() * 60); const id = 1 + Math.floor(rnd() * 2); const x = C.x + (rnd() - 0.5) * 260, y = C.y + (rnd() - 0.5) * 260; const k = rnd(); if (k < 0.3) r.g.pointerDown(S(id, x, y, t)); else if (k < 0.7) r.g.pointerMove(S(id, x, y, t)); else if (k < 0.9) r.g.pointerUp(S(id, x, y, t)); else r.g.update(t); }
    return JSON.stringify(r.log);
  };
  check('time-translation invariant (only differences of timestamps matter)', shift(0) === shift(123456.5));
}

// ============================================================ 9. camera maths against three.js
{
  const cam = new THREE.PerspectiveCamera(40, 390 / 844, 0.05, 50);
  cam.position.set(0.7, 1.2, 3.1); cam.lookAt(0.1, 0.35, 0); cam.updateMatrixWorld(true);
  let maxErr = 0, maxProj = 0;
  const rr = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const nx = rr() * 2 - 1, ny = rr() * 2 - 1;
    const mine = cameraRay(cam, nx, ny);
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), cam);
    maxErr = Math.max(maxErr, Math.hypot(mine.dir.x - rc.ray.direction.x, mine.dir.y - rc.ray.direction.y, mine.dir.z - rc.ray.direction.z),
      Math.hypot(mine.origin.x - rc.ray.origin.x, mine.origin.y - rc.ray.origin.y, mine.origin.z - rc.ray.origin.z));
    const p = new THREE.Vector3((rr() - 0.5) * 2, rr() * 1.5, (rr() - 0.5) * 2);
    const pr = p.clone().project(cam), my = projectToNdc(cam, p)!;
    maxProj = Math.max(maxProj, Math.abs(pr.x - my.x), Math.abs(pr.y - my.y));
  }
  check('camera: cameraRay matches THREE.Raycaster.setFromCamera (200 random ndc)', maxErr < 1e-6, `max err ${maxErr.toExponential(1)}`);
  check('camera: projectToNdc matches Vector3.project (200 random points)', maxProj < 1e-6, `max err ${maxProj.toExponential(1)}`);
  // host over the mock body: the screen centre ray hits it; far corners do not; plane round-trip
  const body = createMockBody();
  const vp = { w: 390, h: 844 };
  const bh = createBodyHost({ camera: () => cam, body: () => body, viewport: () => vp });
  const disc = bh.bodyScreen()!;
  const hit = bh.hitTest(disc.x, disc.y);
  check('host: ray through the projected body centre hits the body', !!hit && Math.abs(hit.dir.x * hit.dir.x + hit.dir.y * hit.dir.y + hit.dir.z * hit.dir.z - 1) < 1e-9);
  check('host: ray through a far corner misses', bh.hitTest(2, 2) === null && bh.hitTest(388, 840) === null);
  const edge = bh.hitTest(disc.x + disc.r * 0.8, disc.y);
  check('host: bodyScreen radius ~ the projected rest radius (a ray 0.8 r off-centre still hits, 1.4 r misses)', !!edge && bh.hitTest(disc.x + disc.r * 1.4, disc.y) === null, `r=${disc.r.toFixed(1)} px`);
  const through = hit!.point;
  const back = bh.planePoint(disc.x, disc.y, through)!;
  check('host: pull plane through the press point returns the press point under the same pixel', Math.hypot(back.x - through.x, back.y - through.y, back.z - through.z) < 1e-6);
  const moved = bh.planePoint(disc.x + 50, disc.y, through)!;
  const fwd = cameraForward(cam);
  check('host: moving the pixel moves the target within the camera-facing plane', Math.abs((moved.x - through.x) * fwd.x + (moved.y - through.y) * fwd.y + (moved.z - through.z) * fwd.z) < 1e-6 && Math.hypot(moved.x - through.x, moved.y - through.y, moved.z - through.z) > 0.01);
  check('rayPlane: parallel and behind-the-ray cases return null', rayPlane({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }) === null && rayPlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }) === null);
  // the end-to-end gesture over the real camera: press the body's right shoulder and drag away = pull
  const g = createGestures(bh, () => {});
  void g;
  const acts: GestureAction[] = [];
  const gg = createGestures(bh, (a) => acts.push(a));
  gg.pointerDown(S(1, disc.x + disc.r * 0.6, disc.y, 0)); gg.pointerMove(S(1, disc.x + disc.r * 0.6 + 40, disc.y, 80));
  check('end-to-end over the real camera + mock body: shoulder press + outward drag = pull with a world target', acts.some((a) => a.type === 'grab'), acts.map((a) => a.type).join());
}

console.log(`\n${total - bad}/${total} gesture checks passed`);
process.exit(bad ? 1 : 0);

// Gesture probe (plain node, exits 1 on failure): classification across timing/distance edges, pressure ramp values,
// two-finger slot assignment, cancel safety, wheel + pinch zoom, the 'outward' pull test, no action leaks after pointerup,
// determinism, a fuzz run with invariants, and the camera maths that backs the hit test.
// Section 10 (owner decision 2026-10-06): Shift + drag pulls both sides: the mirror itself, every fallback, Shift read only at the commit, both
// grabs released once, no-Shift = the old machine (a pinned hash of the action streams), a Shift fuzz; section 11: the real SoftBody.
import * as THREE from 'three';
import type { GestureAction, GestureHost, Gestures, BodyHit, PointerSample } from '../src/input/gestures.ts';
import { createGestures, DEFAULT_GESTURE_CONFIG } from '../src/input/gestures.ts';
import { cameraRay, createBodyHost, projectToNdc, rayPlane, cameraForward } from '../src/input/camera.ts';
import { createMockBody } from './mocks.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { SoftBody } from '../src/physics/softbody.ts';
import { speciesTemplateGenome } from '../src/data/catalog.ts';
import { createDriver } from '../src/shell/driver.ts';
import type { SoftEvent, StageLike } from '../src/contracts.ts';

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
  // owner decision 2026-10-06: with a MOUSE only the right (or middle) button turns the view; a LEFT click on empty space does nothing. A finger, a pen and a sample
  // with no type (the debug hook, the Space key) still drag empty space to turn: the old orbit rows above (no type) are unchanged on purpose.
  const SM = (id: number, x: number, y: number, t: number, button = 0, type: 'mouse' | 'touch' | 'pen' = 'mouse'): PointerSample => ({ id, x, y, t, button, type });
  const ml = rig();
  ml.g.pointerDown(SM(1, 100, 100, 0)); ml.g.pointerMove(SM(1, 130, 100, 16)); ml.g.pointerMove(SM(1, 160, 120, 32));
  const heldMs = ml.g.activeCount();
  ml.g.pointerUp(SM(1, 160, 120, 48));
  check('mouse: a LEFT drag on empty space does nothing (no orbit, no finger, no gesture notice, no zoom) and leaves no pointer behind after the up (owner decision 2026-10-06: only the right button turns the view with a mouse)',
    ml.log.length === 0 && heldMs === 1 && ml.g.activeCount() === 0, ml.types().join());
  const mr = rig();
  mr.g.pointerDown(SM(1, 100, 100, 0, 2)); mr.g.pointerMove(SM(1, 130, 100, 16, 2));
  const mm = rig();
  mm.g.pointerDown(SM(1, 100, 100, 0, 1)); mm.g.pointerMove(SM(1, 100, 130, 16, 1));
  check('mouse: the RIGHT and the MIDDLE button on empty space still turn the view (orbit announced once, dx / dy as before)',
    mr.of('orbit').length === 1 && (mr.of('orbit')[0] as { dx: number }).dx === 30 && mm.of('orbit').length === 1 && (mm.of('orbit')[0] as { dy: number }).dy === 30 && kinds(mr) === 'orbit' && kinds(mm) === 'orbit');
  const mt = rig(), mp = rig();
  mt.g.pointerDown(SM(1, 100, 100, 0, 0, 'touch')); mt.g.pointerMove(SM(1, 130, 100, 16, 0, 'touch'));
  mp.g.pointerDown(SM(1, 100, 100, 0, 0, 'pen')); mp.g.pointerMove(SM(1, 130, 100, 16, 0, 'pen'));
  check('a finger or a pen still drags empty space to turn the view (only a mouse\'s left button is switched off)', mt.of('orbit').length === 1 && mp.of('orbit').length === 1);
  const mb = rig();
  mb.g.pointerDown(SM(1, 400, 300, 0)); mb.g.pointerUp(SM(1, 400, 300, 100));
  check('mouse: a LEFT click on the squishy still pokes it (fingerDown, tap, fingerUp)', mb.types().join() === 'fingerDown,fingerPressure,gesture:tap,fingerUp');
  const mx = rig();
  mx.g.pointerDown(SM(1, 100, 100, 0)); mx.g.pointerDown(SM(2, 110, 100, 5, 2)); mx.g.pointerMove(SM(2, 140, 100, 20, 2)); mx.g.pointerMove(SM(1, 160, 100, 25));
  check('mouse: a left press on empty space does not stop a right-button drag from turning the view, and its own moves stay silent', mx.of('orbit').length === 1 && (mx.of('orbit')[0] as { dx: number }).dx === 30 && mx.types().join() === 'gesture:orbit,orbit');
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

// ============================================================ 10. SHIFT: pull both sides (owner decision 2026-10-06)
// A host with its own geometry: the squishy is a disc of radius 100 px around a MOVABLE centre, but the world mapping stays fixed
// (world = (px - 400) / 200 on the z = 0.5 plane) so a moving centre only changes the reflection. `hole(x, y)` = pixels the ray misses.
interface SHost extends GestureHost { ctr: { x: number; y: number }; hole: (x: number, y: number) => boolean; hitCalls: number; lost: boolean }
function shiftHost(o: { hole?: (x: number, y: number) => boolean } = {}): SHost {
  const h: SHost = {
    ctr: { x: 400, y: 300 }, hole: o.hole ?? (() => false), hitCalls: 0, lost: false,
    hitTest(x, y): BodyHit | null {
      h.hitCalls++;
      if (Math.hypot(x - h.ctr.x, y - h.ctr.y) > 100 || h.hole(x, y)) return null;
      return { point: world(x, y), normal: { x: 0, y: 0, z: 1 }, dir: { x: 0, y: 0, z: -1 }, vertex: (Math.round(x) * 7 + Math.round(y)) % 642 };
    },
    bodyScreen: () => (h.lost ? null : { x: h.ctr.x, y: h.ctr.y, r: 100 }),
    planePoint: (x, y) => world(x, y),
  };
  return h;
}
function rigH(h: GestureHost): Rig {
  const log: GestureAction[] = [];
  const g = createGestures(h, (a) => log.push(a));
  return { g, log, types: () => log.map((a) => a.type === 'gesture' ? `gesture:${a.kind}` : a.type), take: () => log.splice(0), of: (t) => log.filter((a) => a.type === t), clear: () => { log.length = 0; } };
}
const SH = (id: number, x: number, y: number, t: number): PointerSample => ({ id, x, y, t, button: 0, shift: true });
type Grab = Extract<GestureAction, { type: 'grab' }>;
type GMove = Extract<GestureAction, { type: 'grabMove' }>;
type GRel = Extract<GestureAction, { type: 'grabRelease' }>;
const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9;
const pullTypes = (r: Rig): string => r.types().join();
{
  // ---- the mirror itself
  const host = shiftHost();
  const r = rigH(host);
  r.g.pointerDown(S(1, 470, 300, 0));
  r.g.pointerMove(SH(1, 490, 300, 40));
  const a = r.take();
  const grabs = a.filter((x) => x.type === 'grab') as Grab[];
  const mv = host.hitTest(330, 300)!;
  check('shift pull: the committing move emits pull, fingerUp(pull), grab, grab (in that order)', a.map((x) => x.type === 'gesture' ? 'gesture:' + x.kind : x.type).join().endsWith('gesture:pull,fingerUp,grab,grab'), a.map((x) => x.type).join());
  check('shift pull: two grabs on opposite slots, the first untouched by the mirror (slot 0, the vertex under the press, no mirrorOf key)', grabs.length === 2 && grabs[0].slot === 0 && grabs[0].vertex === host.hitTest(470, 300)!.vertex && !('mirrorOf' in grabs[0]));
  check('shift pull: the second grab is slot 1, marked mirrorOf 0, on the vertex under the press reflected through the centre (330, 300)', grabs[1].slot === 1 && grabs[1].mirrorOf === 0 && grabs[1].vertex === mv.vertex, `vertex ${grabs[1].vertex} vs ${mv.vertex}`);
  check('shift pull: targets are mirrored: the first = world(490, 300), the second = world(310, 300) (the reflection through the centre)', near(grabs[0].target, world(490, 300)) && near(grabs[1].target, world(310, 300)) && grabs[0].target.x > 0 && grabs[1].target.x < 0);
  check('shift pull: ONE pull gesture is announced (slot 0), not two', a.filter((x) => x.type === 'gesture' && x.kind === 'pull').length === 1);
  check('shift pull: the snapshot shows the mirror slot, and both slots are busy (a third body finger is ignored)', r.g.snapshot()[0].mirror === 1 && (r.g.pointerDown(S(5, 380, 330, 50)), r.g.snapshot().find((s) => s.id === 5)!.mode === 'ignored') && r.take().length === 0);
  r.g.pointerUp(S(5, 380, 330, 55)); r.clear();
  // later moves: both grabMoves, the mirrored one from the reflection of the real pointer
  r.g.pointerMove(SH(1, 520, 280, 80));
  const gm = r.of('grabMove') as GMove[];
  check('shift pull: every later move = grabMove for the real slot AND for the mirror slot, the second the reflection of the pointer through the centre', gm.length === 2 && gm[0].slot === 0 && gm[1].slot === 1 && near(gm[0].target, world(520, 280)) && near(gm[1].target, world(280, 320)), JSON.stringify(gm.map((x) => [x.slot, x.target.x, x.target.y])));
  // the LIVE centre: the body slid, the mirror follows the new centre
  r.clear(); host.ctr.x = 410; host.ctr.y = 310;
  r.g.pointerMove(S(1, 530, 290, 100));
  const gl = r.of('grabMove') as GMove[];
  check('shift pull: the mirror target uses the LIVE screen centre (centre moved to 410, 310: 2c - p)', gl.length === 2 && near(gl[1].target, world(2 * 410 - 530, 2 * 310 - 290)), JSON.stringify(gl[1]?.target));
  // Shift released mid-drag (these moves carry no shift): the mirror stays until the pointer is up
  check('shift pull: Shift released mid-drag keeps the mirror (the moves above carried no shift and both grabs still follow)', gl.length === 2);
  r.clear();
  r.g.pointerUp(S(1, 530, 290, 120));
  const rel = r.of('grabRelease') as GRel[];
  check('shift pull: pointerUp releases BOTH grabs, why up, once each (real slot first), and nothing else', rel.length === 2 && rel[0].slot === 0 && rel[1].slot === 1 && rel.every((x) => x.why === 'up') && r.log.every((x) => x.type === 'grabRelease' || x.type === 'grabMove') && r.g.activeCount() === 0, pullTypes(r));
  r.clear(); r.g.pointerUp(S(1, 530, 290, 130)); r.g.pointerCancel(1, 140); r.g.cancelAll(150); r.g.update(1000);
  check('shift pull: after the release nothing leaks (late up / cancel / cancelAll / update)', r.log.length === 0);
  // the next press gets a slot again (no stuck mirror slot)
  r.g.pointerDown(S(2, 440, 300, 200)); r.g.pointerDown(S(3, 360, 300, 210));
  check('shift pull: afterwards both slots are free again (the next two fingers get slots 0 and 1)', (r.of('fingerDown') as Array<{ slot: number }>).map((x) => x.slot).join() === '0,1');
}
{
  // ---- cancel / cancelAll / a duplicate down release both
  for (const how of ['cancel', 'cancelAll', 'duplicate down'] as const) {
    const r = rigH(shiftHost());
    r.g.pointerDown(S(1, 470, 300, 0)); r.g.pointerMove(SH(1, 490, 300, 40)); r.clear();
    if (how === 'cancel') r.g.pointerCancel(1, 50); else if (how === 'cancelAll') r.g.cancelAll(50); else r.g.pointerDown(S(1, 420, 300, 50));
    const rel = r.of('grabRelease') as GRel[];
    check(`shift pull: ${how} releases both grabs once each, why cancel`, rel.length === 2 && rel.map((x) => x.slot).sort().join() === '0,1' && rel.every((x) => x.why === 'cancel'), pullTypes(r));
    r.clear(); r.g.update(5000); r.g.pointerMove(SH(1, 560, 300, 5001)); r.g.pointerUp(S(1, 560, 300, 5002)); r.g.pointerCancel(1, 5003);
    check(`shift pull: after ${how} nothing leaks`, how === 'duplicate down' ? true : r.log.length === 0);
  }
}
{
  // ---- Shift is read at the commit and only there
  const late = rigH(shiftHost());
  late.g.pointerDown(S(1, 470, 300, 0)); late.g.pointerMove(S(1, 490, 300, 40)); late.g.pointerMove(SH(1, 520, 300, 60)); late.g.pointerMove(SH(1, 540, 310, 80));
  check('Shift pressed AFTER the pull started does nothing (one grab, one grabMove stream)', late.of('grab').length === 1 && late.of('grabMove').length === 2 && (late.of('grabMove') as GMove[]).every((x) => x.slot === 0));
  late.clear(); late.g.pointerUp(SH(1, 540, 310, 100));
  check('Shift pressed after the pull: the release is the single grab only', (late.of('grabRelease') as GRel[]).length === 1);
  const early = rigH(shiftHost());
  early.g.pointerDown({ id: 1, x: 470, y: 300, t: 0, button: 0, shift: true }); early.g.pointerMove(S(1, 490, 300, 40));
  check('Shift down at the press but UP at the commit = a single pull (Shift is read at the commit)', early.of('grab').length === 1);
  const within = rigH(shiftHost());
  within.g.pointerDown(S(1, 470, 300, 0)); within.g.pointerMove(SH(1, 476, 300, 20)); within.g.pointerMove(SH(1, 480, 304, 30));
  check('Shift on moves inside the 14 px slop does not commit (still a press: no grab yet)', within.of('grab').length === 0);
  within.g.pointerMove(SH(1, 492, 300, 40));
  check('... and the first move past the slop with Shift commits the mirror', within.of('grab').length === 2);
  const onUp = rigH(shiftHost());
  onUp.g.pointerDown(S(1, 470, 300, 0)); onUp.g.pointerUp(SH(1, 500, 300, 40));
  check('a press that commits on its pointerUp (a jump) with Shift mirrors too: grab, grab, then both released', onUp.types().join().endsWith('grab,grab,grabRelease,grabRelease'), onUp.types().join());
}
{
  // ---- fallbacks: the other slot busy
  const reasons: Array<[string, number, (r: Rig) => void]> = [
    ['a second touch holds the other slot (it pressed first)', 1, (r) => { r.g.pointerDown(S(10, 350, 300, 0)); r.g.pointerDown(S(11, 470, 300, 10)); r.g.pointerMove(SH(11, 490, 300, 40)); }],
    ['a second touch holds the other slot (it pressed second)', 0, (r) => { r.g.pointerDown(S(11, 470, 300, 0)); r.g.pointerDown(S(10, 350, 300, 10)); r.g.pointerMove(SH(11, 490, 300, 40)); }],
    ["Space's synthetic finger (id -1000, at the centre) holds a slot", 1, (r) => { r.g.pointerDown(S(-1000, 400, 300, 0)); r.g.pointerDown(S(11, 470, 300, 10)); r.g.pointerMove(SH(11, 490, 300, 40)); }],
  ];
  for (const [name, slot, run] of reasons) {
    const r = rigH(shiftHost());
    run(r);
    const gs = r.of('grab') as Grab[];
    check(`shift fallback: ${name} = the plain single pull (slot ${slot}, no mirror)`, gs.length === 1 && gs[0].slot === slot && !('mirrorOf' in gs[0]), r.types().join());
    // a gesture never changes mode midway: the held finger lifting later does not add a mirror
    r.clear(); r.g.pointerUp(S(10, 350, 300, 60)); r.g.pointerUp(S(-1000, 400, 300, 61)); r.g.pointerMove(SH(11, 520, 300, 80));
    check(`shift fallback: ${name}; the other finger lifting later adds no mirror and the pull goes on single`, r.of('grab').length === 0 && (r.of('grabMove') as GMove[]).length === 1);
  }
  const free = rigH(shiftHost());
  free.g.pointerDown(S(10, 350, 300, 0)); free.g.pointerUp(S(10, 350, 300, 50));
  free.g.pointerDown(S(11, 470, 300, 100)); free.g.pointerMove(SH(11, 490, 300, 140));
  check('shift pull: a slot freed BEFORE the commit is free for the mirror (an earlier tap does not block it)', free.of('grab').length === 2);
  // the real finger holds slot 1 (slot 0 was busy at its press) and the other lifts before the commit: the mirror takes slot 0
  const swap = rigH(shiftHost());
  swap.g.pointerDown(S(10, 350, 300, 0)); swap.g.pointerDown(S(11, 470, 300, 10)); swap.g.pointerUp(S(10, 350, 300, 60)); swap.g.pointerMove(SH(11, 492, 300, 100));
  const sg = swap.of('grab') as Grab[];
  check('shift pull: the real finger on slot 1 mirrors onto slot 0 (mirrorOf 1)', sg.length === 2 && sg[0].slot === 1 && sg[1].slot === 0 && sg[1].mirrorOf === 1, JSON.stringify(sg.map((x) => [x.slot, x.mirrorOf])));
}
{
  // ---- fallbacks: the mirror point misses the body
  const half = rigH(shiftHost({ hole: (x) => x < 400 }));           // the whole left half is open air
  half.g.pointerDown(S(1, 470, 300, 0)); half.g.pointerMove(SH(1, 490, 300, 40));
  check('shift fallback: nothing hit at the mirror point (nor at any shrink) = the plain single pull, silently', half.of('grab').length === 1 && !('mirrorOf' in (half.of('grab')[0] as Grab)) && half.g.snapshot()[0].mirror === -1, half.types().join());
  half.clear(); half.g.pointerMove(SH(1, 520, 300, 60));
  check('shift fallback (miss): later moves are one grabMove each', (half.of('grabMove') as GMove[]).length === 1);
  // the shrink ladder: x1, x0.92, x0.8464, x0.7787 ... a hole over the first three tries lands on the fourth
  const hostA = shiftHost({ hole: (x) => x >= 325 && x <= 343 });
  const ra = rigH(hostA);
  ra.g.pointerDown(S(1, 470, 300, 0)); hostA.hitCalls = 0; ra.g.pointerMove(SH(1, 490, 300, 40));
  const k4 = 400 - 70 * 0.92 * 0.92 * 0.92;
  const gA = ra.of('grab') as Grab[];
  check('shift mirror shrinks toward the centre x0.92 per try: a hole over x1, x0.92, x0.8464 lands on x0.7787', gA.length === 2 && gA[1].vertex === hostA.hitTest(k4, 300)!.vertex && gA[1].mirrorOf === 0, `vertex ${gA[1]?.vertex}`);
  // down to x0.5 and no further: 364.08 px is the last try (k = 0.5132); a hole that still covers it = no mirror, with exactly 9 ray tests
  const hostB = shiftHost({ hole: (x) => x < 364 });
  const rb = rigH(hostB);
  rb.g.pointerDown(S(1, 470, 300, 0)); rb.g.pointerMove(SH(1, 490, 300, 40));
  check('shift mirror: the ninth and last try (x0.513, still >= x0.5) can hit', rb.of('grab').length === 2);
  const hostC = shiftHost({ hole: (x) => x < 364.5 });
  const rc = rigH(hostC);
  rc.g.pointerDown(S(1, 470, 300, 0)); hostC.hitCalls = 0; rc.g.pointerMove(SH(1, 490, 300, 40));
  check('shift mirror: never shrinks past x0.5 (all 9 tries missing = no mirror; 9 mirror ray tests + the press one is not repeated)', rc.of('grab').length === 1 && hostC.hitCalls === 9, `${hostC.hitCalls} tests`);
  // a lost body at the commit (bodyScreen null): single pull, no throw
  const lostH = shiftHost(); const rl = rigH(lostH);
  rl.g.pointerDown(S(1, 470, 300, 0)); lostH.lost = true;
  let threw = false; try { rl.g.pointerMove(SH(1, 490, 300, 40)); } catch { threw = true; }
  check('shift with the body lost at the commit: no mirror (and no pull either: no outward direction), nothing thrown', !threw && rl.of('grab').length === 0);
}
{
  // ---- shift where it must change nothing
  const run = (shift: boolean, script: (r: Rig, S2: (id: number, x: number, y: number, t: number, b?: number) => PointerSample) => void): string => {
    const r = rigH(shiftHost());
    script(r, (id, x, y, t, b = 0) => ({ id, x, y, t, button: b, ...(shift ? { shift: true } : {}) }));
    return JSON.stringify(r.log);
  };
  const empty = (r: Rig, S2: (id: number, x: number, y: number, t: number, b?: number) => PointerSample): void => { r.g.pointerDown(S2(1, 60, 60, 0)); r.g.pointerMove(S2(1, 90, 80, 30)); r.g.pointerUp(S2(1, 90, 80, 60)); };
  check('Shift on empty space: the orbit is identical to the same drag without Shift', run(true, empty) === run(false, empty) && run(true, empty).includes('"orbit"'));
  const right = (r: Rig, S2: (id: number, x: number, y: number, t: number, b?: number) => PointerSample): void => { r.g.pointerDown(S2(1, 470, 300, 0, 2)); r.g.pointerMove(S2(1, 520, 300, 30, 2)); r.g.pointerUp(S2(1, 520, 300, 60, 2)); };
  check('Shift with the right button on the body: orbit, identical to without Shift', run(true, right) === run(false, right) && !run(true, right).includes('"grab"'));
  const rub = (r: Rig, S2: (id: number, x: number, y: number, t: number, b?: number) => PointerSample): void => { r.g.pointerDown(S2(1, 450, 300, 0)); r.g.pointerMove(S2(1, 450, 340, 50)); r.g.pointerUp(S2(1, 450, 340, 90)); };
  check('Shift on a rub (a tangential drag): still a rub, identical, no grab', run(true, rub) === run(false, rub) && !run(true, rub).includes('"grab"'));
  const tap = (r: Rig, S2: (id: number, x: number, y: number, t: number, b?: number) => PointerSample): void => { r.g.pointerDown(S2(1, 450, 300, 0)); r.g.pointerUp(S2(1, 450, 300, 100)); };
  check('Shift on a tap or a squish: identical, no grab', run(true, tap) === run(false, tap));
  const plain = (r: Rig, S2: (id: number, x: number, y: number, t: number, b?: number) => PointerSample): void => { r.g.pointerDown(S2(1, 470, 300, 0)); r.g.pointerMove(S2(1, 490, 300, 40)); r.g.pointerMove(S2(1, 520, 280, 80)); r.g.pointerUp(S2(1, 520, 280, 120)); };
  const withFalse = rigH(shiftHost()); withFalse.g.pointerDown({ id: 1, x: 470, y: 300, t: 0, button: 0, shift: false }); withFalse.g.pointerMove({ id: 1, x: 490, y: 300, t: 40, button: 0, shift: false }); withFalse.g.pointerMove({ id: 1, x: 520, y: 280, t: 80, button: 0, shift: false }); withFalse.g.pointerUp({ id: 1, x: 520, y: 280, t: 120, button: 0, shift: false });
  check('no Shift: the pull is exactly the old pull (shift false or absent give the same stream; one grab, one move, one release)', run(false, plain) === JSON.stringify(withFalse.log) && withFalse.of('grab').length === 1 && withFalse.of('grabMove').length === 1 && withFalse.of('grabRelease').length === 1);
}
{
  // ---- differential pin: the action streams of the 300 existing no-Shift fuzz scripts, hashed, equal the OLD machine's (commit 13bf8f55).
  // A deliberate change to the gesture rules re-pins this (with a written reason); the 20 000-script differential against the old machine
  // itself is in the INPUT_SHIFT report.
  const NOSHIFT_PIN = 303302604;   // computed by running this very fuzz against `git show 13bf8f55:games/wobblehoard/src/input/gestures.ts`
  const fnv = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
  let pin = 0;
  for (let s = 1; s <= 300; s++) pin = (Math.imul(pin, 31) + fnv(JSON.stringify(fuzz(s, 300).log))) >>> 0;
  console.log(`  pin ${pin}`);
  check('differential pin: the 300 no-Shift fuzz scripts give the very action streams of the pre-Shift machine (hash pinned from commit 13bf8f55)', pin === NOSHIFT_PIN, `${pin} vs ${NOSHIFT_PIN}`);
}
{
  // ---- the Shift fuzz: random multi-pointer scripts with Shift before / during / after the press, Space's synthetic pointer, cancels, a body that slides,
  // holes the mirror ray can fall into, a body that is briefly lost. Invariants: every grab released exactly once; no action after cancelAll;
  // a mirror never starts on a busy slot; the mirrored target = the real pointer reflected through the live centre; no stuck slot; determinism.
  const shiftFuzz = (seed: number, steps: number): { log: GestureAction[]; violations: string[]; mirrors: number } => {
    const rnd = mulberry32(seed);
    const host = shiftHost({ hole: (x, y) => (seed % 4 === 1 && x < 380) || (seed % 4 === 2 && y > 330 && x < 420) });
    const log: GestureAction[] = [];
    const g = createGestures(host, (a) => log.push(a));
    const violations: string[] = [];
    const slotDown = [false, false], grabbed = [false, false];
    const mirrorOfSlot = [-1, -1];                         // mirror slot -> the real slot it mirrors, while a mirrored pull lives
    let mirrors = 0;
    let t = 0;
    let moved: { id: number; x: number; y: number } | null = null;   // the sample the machine was just fed (a move / an up)
    let lastCtr = { x: 400, y: 300 };
    const bs = host.bodyScreen;
    host.bodyScreen = () => { const c = bs(); if (c) lastCtr = { x: c.x, y: c.y }; return c; };
    const reflected = (): { x: number; y: number; z: number } => world(2 * lastCtr.x - moved!.x, 2 * lastCtr.y - moved!.y);
    const inspect = (): void => {
      let realMoved = false;
      for (const a of log.splice(0)) {
        all.push(a);
        if (a.type === 'fingerDown') { if (slotDown[a.slot] || grabbed[a.slot]) violations.push('fingerDown on a busy slot'); slotDown[a.slot] = true; }
        else if (a.type === 'fingerUp') { if (!slotDown[a.slot]) violations.push('fingerUp on a free slot'); slotDown[a.slot] = false; }
        else if (a.type === 'grab') {
          if (grabbed[a.slot] || slotDown[a.slot]) violations.push(a.mirrorOf !== undefined ? 'a mirror started on a busy slot' : 'grab on a busy slot');
          grabbed[a.slot] = true;
          if (a.mirrorOf !== undefined) {
            mirrors++;
            if (!grabbed[a.mirrorOf] || a.mirrorOf === a.slot) violations.push('mirrorOf names a slot that is not grabbing');
            mirrorOfSlot[a.slot] = a.mirrorOf;
            if (!moved) violations.push('a mirror grab outside a move / up');
            else { const w = reflected(); if (Math.hypot(a.target.x - w.x, a.target.y - w.y) > 1e-9) violations.push('first mirror target is not the reflection of the pointer'); }
          }
        } else if (a.type === 'grabMove') {
          if (!grabbed[a.slot]) violations.push('grabMove without a grab');
          if (mirrorOfSlot[a.slot] >= 0) {
            if (!realMoved) violations.push('mirror move before the real one');
            if (!moved) violations.push('a mirror move outside a move / up');
            else { const w = reflected(); if (Math.hypot(a.target.x - w.x, a.target.y - w.y) > 1e-9) violations.push('mirrored target is not the reflection of the pointer'); }
          } else realMoved = true;
        } else if (a.type === 'grabRelease') {
          if (!grabbed[a.slot]) violations.push('grabRelease without a grab (or a second release)');
          grabbed[a.slot] = false;
          mirrorOfSlot[a.slot] = -1;
        } else if (a.type === 'fingerPressure' && !slotDown[a.slot]) violations.push('pressure without a finger');
        else if (a.type === 'fingerMove' && !slotDown[a.slot]) violations.push('fingerMove without a finger');
      }
    };
    const all: GestureAction[] = [];
    const ids = [1, 2, 3, -1000];
    for (let i = 0; i < steps; i++) {
      t += Math.floor(rnd() * 90);
      const id = ids[Math.floor(rnd() * ids.length)];
      const x = rnd() < 0.7 ? 400 + (rnd() - 0.5) * 240 : rnd() * 800, y = rnd() < 0.7 ? 300 + (rnd() - 0.5) * 240 : rnd() * 600;
      const sh = rnd() < 0.5;
      const k = rnd();
      if (rnd() < 0.05) { host.ctr.x = 400 + (rnd() - 0.5) * 60; host.ctr.y = 300 + (rnd() - 0.5) * 60; }
      host.lost = rnd() < 0.02;
      moved = null;
      if (k < 0.2) g.pointerDown({ id, x: id === -1000 ? host.ctr.x : x, y: id === -1000 ? host.ctr.y : y, t, button: rnd() < 0.08 ? 2 : 0, shift: sh });
      else if (k < 0.7) { moved = { id, x, y }; g.pointerMove({ id, x, y, t, button: 0, shift: sh }); }
      else if (k < 0.85) { moved = { id, x, y }; g.pointerUp({ id, x, y, t, button: 0, shift: sh }); }
      else if (k < 0.9) g.pointerCancel(id, t);
      else if (k < 0.96) g.update(t);
      else g.cancelAll(t);
      inspect();
    }
    moved = null; host.lost = false;
    g.cancelAll(t + 1);
    inspect();
    if (grabbed[0] || grabbed[1] || slotDown[0] || slotDown[1] || g.activeCount() !== 0) violations.push('state left dangling after cancelAll');
    g.update(t + 99999); g.pointerMove({ id: 1, x: 500, y: 300, t: t + 100000, shift: true });
    if (log.length) violations.push('actions leaked after cancelAll');
    // no stuck slot: two fresh fingers get slots 0 and 1
    host.ctr.x = 400; host.ctr.y = 300;
    g.pointerDown({ id: 91, x: 440, y: 300, t: t + 200000 }); g.pointerDown({ id: 92, x: 430, y: 270, t: t + 200010 });   // (clear of every hole the fuzz hosts use)
    const slots = log.filter((a) => a.type === 'fingerDown').map((a) => (a as { slot: number }).slot).join();
    if (slots !== '0,1') violations.push(`stuck slot after cancelAll: fresh fingers got ${slots}`);
    log.length = 0; g.cancelAll(t + 300000);
    return { log: all, violations, mirrors };
  };
  let v = 0, mirrors = 0, grabsTotal = 0, firstBad = '';
  for (let s = 1; s <= 600; s++) { const f = shiftFuzz(s, 260); v += f.violations.length; mirrors += f.mirrors; grabsTotal += f.log.filter((a) => a.type === 'grab').length; if (f.violations.length && !firstBad) firstBad = `seed ${s}: ${f.violations[0]}`; }
  check('shift fuzz: 600 random scripts x 260 events (Shift before/during/after the press, Space, second touches, cancels, a sliding or lost body, holes in the mirror ray) keep every invariant', v === 0 && mirrors > 200, `${grabsTotal} grabs, ${mirrors} mirrors, ${v} violations ${firstBad}`);
  const a1 = shiftFuzz(77, 400), b1 = shiftFuzz(77, 400);
  check('shift fuzz: deterministic (the same script gives the identical action stream)', JSON.stringify(a1.log) === JSON.stringify(b1.log) && a1.log.length > 50);
}

// ============================================================ 11. SHIFT on the REAL physics (the gesture actions drive a real SoftBody through the real driver, as the game does)
// A Shift pull asked far past 1.15 x maxPull must stretch the body to its maximum on BOTH sides and never carry it (metrics.carried); the same
// drag without Shift (a lone finger) still picks the body up. The camera is the game's (35 deg, 1280 x 800, pitched down).
{
  const W = 1280, H = 800, DT = 1 / 60;
  const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 200);
  const dist = Math.max(3.0, 2.4 / (W / H)), pitch = 0.27;
  cam.position.set(0, 0.42 + dist * Math.sin(pitch), dist * Math.cos(pitch)); cam.lookAt(0, 0.42, 0); cam.updateMatrixWorld(true);
  const foldOf = (b: SoftBody): (() => number) => {   // the worst dihedral between adjacent triangles (probe_softbody's fold meter); reported, not gated
    const I = b.indices, first = new Map<number, number>(), pairs: number[] = [];
    for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], c = I[t * 3 + ((k + 1) % 3)], key = a < c ? a * 65536 + c : c * 65536 + a, o = first.get(key); if (o === undefined) first.set(key, t); else pairs.push(o, t); }
    const N = new Float64Array(I.length);
    return () => {
      const P = b.positions;
      for (let t = 0; t < I.length / 3; t++) {
        const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
        const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1e-12;
        N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
      }
      let mn = 1;
      for (let k = 0; k < pairs.length; k += 2) { const t1 = pairs[k] * 3, t2 = pairs[k + 1] * 3; mn = Math.min(mn, N[t1] * N[t2] + N[t1 + 1] * N[t2 + 1] + N[t1 + 2] * N[t2 + 2]); }
      return (Math.acos(Math.max(-1, Math.min(1, mn))) * 180) / Math.PI;
    };
  };
  const volumeOf = (b: SoftBody): number => {
    const P = b.positions, T = b.indices; let v = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, c = T[t + 1] * 3, d = T[t + 2] * 3;
      v += P[a] * (P[c + 1] * P[d + 2] - P[c + 2] * P[d + 1]) + P[a + 1] * (P[c + 2] * P[d] - P[c] * P[d + 2]) + P[a + 2] * (P[c] * P[d + 1] - P[c + 1] * P[d]);
    }
    return v / 6;
  };
  interface PhysRun { carried: boolean; grabSlots: string; snaps: Array<{ finger: number; I: number }>; left: number; right: number; minYR: number; finite: boolean; fold: number; volLo: number; volHi: number }
  /** a pull from the point `rad` x the body's screen radius from its centre, at angle `ang` (0 = right, pi/2 = up), dragged straight outward */
  const physPull = (species: string, shift: boolean, reach: number, ang = 0, rad = 0.6): PhysRun | null => {
    const b = new SoftBody(speciesTemplateGenome(species as never));
    for (let i = 0; i < 90; i++) b.step(DT);
    const host = createBodyHost({ camera: () => cam, body: () => b, viewport: () => ({ w: W, h: H }) });
    const disc = host.bodyScreen()!, R = b.restRadius, maxD = b.params.maxPull * R;
    const ux = Math.cos(ang), uy = -Math.sin(ang);
    const px0 = disc.x + ux * rad * disc.r, py0 = disc.y + uy * rad * disc.r + (ang === 0 ? 0.05 * disc.r : 0);
    if (!host.hitTest(px0, py0) || !host.hitTest(2 * disc.x - px0, 2 * disc.y - py0)) return null;
    let simT = 0, steps = 0, now = 1000;
    const driver = createDriver({ body: () => b, stage: { orbit() {}, zoom() {} } as unknown as StageLike, simTime: () => simT, stepCount: () => steps, panOfPoint: () => 0, extraSquish: () => false, interact() {}, dirty() {}, report: (e) => { throw e; } });
    const slots: number[] = [];
    const gest = createGestures(host, (a) => { if (a.type === 'grab') slots.push(a.slot); driver.onAction(a); });
    const evs: SoftEvent[] = [];
    const x0 = b.center.x, fold = foldOf(b), vol0 = volumeOf(b);
    let carried = false, minY = 1e9, mnX = 1e9, mxX = -1e9, finite = true, worstFold = 0, volLo = 1, volHi = 1;
    const frame = (): void => {
      now += DT * 1000; gest.update(now); driver.flushPendingUps(); b.step(DT); simT += DT; steps++; driver.notePress(); b.drainEvents(evs);
      if (b.metrics.carried) carried = true;
      const P = b.positions;
      for (let i = 0; i < P.length; i += 3) { if (!Number.isFinite(P[i]) || !Number.isFinite(P[i + 1]) || !Number.isFinite(P[i + 2])) finite = false; if (P[i + 1] < minY) minY = P[i + 1]; if (P[i] < mnX) mnX = P[i]; if (P[i] > mxX) mxX = P[i]; }
      worstFold = Math.max(worstFold, fold());
      const vr = volumeOf(b) / vol0; volLo = Math.min(volLo, vr); volHi = Math.max(volHi, vr);
    };
    const drag = reach * maxD * (disc.r / R);
    gest.pointerDown({ id: 1, x: px0, y: py0, t: now, button: 0 });
    for (let i = 0; i < 3; i++) frame();
    for (let i = 1; i <= 50; i++) { gest.pointerMove({ id: 1, x: px0 + (ux * drag * i) / 50, y: py0 + (uy * drag * i) / 50, t: now, button: 0, shift }); frame(); }
    for (let i = 0; i < 60; i++) frame();
    gest.pointerUp({ id: 1, x: px0 + ux * drag, y: py0 + uy * drag, t: now, button: 0, shift });
    for (let i = 0; i < 120; i++) frame();
    return {
      carried, grabSlots: slots.join(), snaps: evs.filter((e) => e.kind === 'snap').map((e) => ({ finger: e.finger, I: e.intensity })),
      left: (x0 - mnX - R) / maxD, right: (mxX - x0 - R) / maxD, minYR: minY / R, finite, fold: worstFold, volLo, volHi,
    };
  };
  const rows: string[] = [];
  let tested = 0, shiftOk = 0, plainLifts = 0, finiteAll = true, floorOk = true;
  for (const id of ['dollop', 'cushlet', 'munchip', 'twangle']) {
    const s = physPull(id, true, 1.8), p = physPull(id, false, 1.8);
    if (!s || !p) { rows.push(`${id}: no hit`); continue; }
    tested++;
    const both = s.snaps.length === 2 && s.snaps.every((x) => x.I >= 0.95) && new Set(s.snaps.map((x) => x.finger)).size === 2;
    if (!s.carried && s.grabSlots === '0,1' && both && s.left >= 0.4 && s.right >= 0.4) shiftOk++;
    if (p.carried && p.grabSlots === '0') plainLifts++;
    finiteAll = finiteAll && s.finite && p.finite;
    floorOk = floorOk && s.minYR >= -0.01 && p.minYR >= -0.01;
    rows.push(`${id}: shift carried ${s.carried}, snaps ${s.snaps.map((x) => x.I.toFixed(2)).join('/')}, sides ${s.left.toFixed(2)} / ${s.right.toFixed(2)} maxPull, fold ${s.fold.toFixed(0)} deg | plain carried ${p.carried}, fold ${p.fold.toFixed(0)} deg`);
  }
  check('REAL physics: a Shift pull asked to 1.8 x maxPull (past the 1.15 x lift limit) stretches the body to its maximum on BOTH sides (two grabs, slots 0 and 1, both snaps at the full pull level, each side of the body out >= 0.4 maxPull beyond its rest edge, measured on the skin) and NEVER sets metrics.carried',
    tested >= 3 && shiftOk === tested, `${shiftOk}/${tested} species. ${rows.join('; ')}`);
  check('REAL physics: the same drag WITHOUT Shift (a lone finger) still picks the body up (metrics.carried, one grab on slot 0)', tested >= 3 && plainLifts === tested, `${plainLifts}/${tested}`);
  check('REAL physics: no NaN anywhere, and nothing goes through the table (lowest particle >= -1% R) in either', finiteAll && floorOk);
  // a press near the top of the dome dragged up sends the MIRRORED hand down through the table: the driver keeps both hands of a Shift pair off
  // the floor (driver.ts SHIFT_FLOOR_Y). Without it 3 of 38 swept real-physics Shift pulls turned the mesh inside out (volume -0.97 .. 3.08).
  {
    const cases: Array<[string, number, number]> = [];
    for (const id of ['dollop', 'wrigglo', 'cushlet', 'twangle', 'chunkle', 'munchip']) for (const [ang, rad] of [[Math.PI / 2, 0.8], [Math.PI / 2, 0.25], [Math.PI / 4, 0.7], [-Math.PI / 4, 0.7]] as const) cases.push([id, ang, rad]);
    let n = 0, bad = 0, nanFloor = 0, carriedAny = 0, worstLo = 1, worstHi = 1;
    for (const [id, ang, rad] of cases) {
      const s = physPull(id, true, 1.8, ang, rad);
      if (!s) continue;
      n++;
      worstLo = Math.min(worstLo, s.volLo); worstHi = Math.max(worstHi, s.volHi);
      if (!(s.volLo >= 0.5 && s.volHi <= 1.5)) bad++;
      if (!s.finite || s.minYR < -0.01) nanFloor++;
      if (s.carried) carriedAny++;
    }
    check('REAL physics: Shift pulls from the top of the dome, from near the centre and from the diagonals (the mirrored hand dragged DOWN toward the table) never turn the mesh inside out (volume stays 0.5 .. 1.5 of rest), never carry the body, never go through the table',
      n >= 12 && bad === 0 && nanFloor === 0 && carriedAny === 0, `${n} pulls, volume ${worstLo.toFixed(2)} .. ${worstHi.toFixed(2)}, bad ${bad}, below floor or NaN ${nanFloor}, carried ${carriedAny}`);
  }
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

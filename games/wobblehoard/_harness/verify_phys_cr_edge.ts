// Code-review verifier: hostile calls, identity, throttle, allocation, reset determinism.
import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
import type { SoftEvent } from '../src/contracts.ts';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const g = makeStarterGenome();
let bad = 0;
const check = (name: string, ok: boolean, info = '') => { if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const finite = (b: SoftBody) => { for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) return false; return true; };
const settle = (b: SoftBody, s = 1) => { for (let i = 0; i < 60 * s; i++) b.step(1 / 60); };

// --- step edge cases
{
  const b = new SoftBody(g); const pos = b.positions; const h0 = b.stateHash();
  b.step(0); check('step(0) no-op', b.stateHash() === h0);
  b.step(NaN); check('step(NaN) no-op', b.stateHash() === h0 && finite(b));
  b.step(-1); check('step(-1) no-op', b.stateHash() === h0);
  b.step(Infinity); check('step(Inf) finite', finite(b));
  b.step(-Infinity); check('step(-Inf) finite', finite(b));
  b.step(1e9); check('step(1e9) finite', finite(b));
  b.step(1e-9); check('step(1e-9)', finite(b));
  check('positions identity stable', b.positions === pos);
  b.reset(); check('positions identity after reset', b.positions === pos);
}
// --- raycast hostile
{
  const b = new SoftBody(g);
  check('raycast zero dir', b.raycast(v(0, 1, 3), v(0, 0, 0)) === null);
  check('raycast NaN dir', b.raycast(v(0, 1, 3), v(NaN, 0, -1)) === null);
  check('raycast Inf origin', b.raycast(v(Infinity, 1, 3), v(0, 0, -1)) === null);
  check('raycast null args', b.raycast(null as any, null as any) === null);
  const h = b.raycast(v(0, 0.3, 3), v(0, 0, -1));
  check('raycast hit basic', !!h && Math.abs(h.point.z - (3 - h.t)) < 1e-9);
  const h2 = b.raycast(v(0, 0.3, 3), v(0, 0, -7));
  check('raycast unnormalised dir t scales', !!h && !!h2 && Math.abs(h2.t * 7 - h!.t) < 1e-9 && Math.abs(h2.point.z - h!.point.z) < 1e-9);
  const nlen = h ? Math.hypot(h.normal.x, h.normal.y, h.normal.z) : 0;
  check('normal unit', Math.abs(nlen - 1) < 1e-9);
  check('vertex in range', !!h && h.vertex >= 0 && h.vertex < b.vertexCount);
  const tiny = b.raycast(v(0, 0.3, 3), v(0, 0, -1e-11));
  console.log('  tiny dir 1e-11 ->', tiny === null ? 'null(miss)' : 'hit');
  const inside = b.raycast(v(0, 0.3, 0), v(0, 0, -1));
  console.log('  ray from inside ->', inside === null ? 'null' : 'hit');
  const hugeO = b.raycast(v(1e300, 0, 0), v(-1, 0, 0));
  check('raycast huge origin no throw', true, hugeO === null ? 'null' : 'hit t=' + hugeO.t);
  const ray = b.raycast(v(0, 0.3, 3), v(1e300, 0, -1e300));
  console.log('  raycast huge dir ->', ray === null ? 'null' : JSON.stringify(ray));
}
// --- finger hostile
{
  const b = new SoftBody(g);
  const top = b.raycast(v(0.0, 3, 0), v(0, -1, 0))!;
  const args = { point: top.point, normal: top.normal, dir: v(0, -1, 0) };
  b.fingerUp(0); b.fingerUp(1); check('fingerUp not down', b.metrics.fingers === 0);
  b.fingerPressure(0, 1); b.fingerMove(0, top.point);
  b.fingerDown(2 as any, args); b.fingerUp(2 as any); b.fingerUp(-1 as any); b.fingerDown('0' as any, args);
  b.fingerUp(0);
  b.fingerDown(0, args); b.fingerDown(0, args);
  settle(b, 0.2); check('double fingerDown fingers==1', b.metrics.fingers === 1, String(b.metrics.fingers));
  b.fingerUp(0); settle(b, 0.2); check('after up fingers==0', b.metrics.fingers === 0);
  b.fingerDown(0, { point: v(NaN, 0, 0), normal: top.normal, dir: v(0, -1, 0) }); check('NaN point ignored', b.metrics.fingers === 0);
  b.fingerDown(0, { point: top.point, normal: v(0, 0, 0), dir: v(0, 0, 0) }); b.fingerPressure(0, 1); settle(b, 0.3);
  check('zero normal+dir ok', finite(b) && b.metrics.fingers === 1);
  b.fingerUp(0); settle(b, 1);
  b.fingerPressure(0, NaN); b.fingerPressure(0, 99); b.fingerMove(0, v(NaN, 0, 0));
  // reset mid press
  b.fingerDown(0, args); b.fingerPressure(0, 1); settle(b, 0.4);
  b.fingerDown(1, { point: v(0.2, 0.2, 0.2), normal: v(0.5, 0.5, 0.5), dir: v(-0.5, -0.5, -0.5) });
  b.reset();
  check('reset mid press: fingers 0, no tips', b.metrics.fingers === 0 && b.tip!(0) === null && b.tip!(1) === null);
  const ev: SoftEvent[] = []; b.drainEvents(ev); check('reset clears events', ev.length === 0);
  settle(b, 1); check('reset mid press: rests', finite(b) && b.metrics.kinetic < 0.02, 'ke=' + b.metrics.kinetic);
  // fingerUp after reset should be a no-op
  b.fingerUp(0); b.fingerPressure(0, 1); settle(b, 0.3); check('post-reset press ignored', b.metrics.compression < 0.02);
}
// --- grab hostile
{
  const b = new SoftBody(g);
  b.grab(0, -1, v(0, 1, 0)); check('grab -1', !b.metrics.grabbed);
  b.grab(0, b.vertexCount, v(0, 1, 0)); check('grab n', !b.metrics.grabbed);
  b.grab(0, NaN, v(0, 1, 0)); check('grab NaN', !b.metrics.grabbed);
  b.grab(0, Infinity, v(0, 1, 0)); check('grab Inf', !b.metrics.grabbed);
  b.grab(0, 5, v(NaN, 1, 0)); check('grab NaN target', !b.metrics.grabbed);
  b.grab(2 as any, 5, v(0, 1, 0)); check('grab bad id', !b.metrics.grabbed);
  b.grabMove(0, v(0, 1, 0)); b.grabRelease(0); b.grabRelease(1);
  const ev: SoftEvent[] = []; b.drainEvents(ev); check('no events from no-op grabs', ev.length === 0, String(ev.length));
  b.grab(0, 320.7, v(0, 1, 0)); settle(b, 0.1); check('grab fractional idx ok', b.metrics.grabbed);
  b.grab(0, 100, v(0, 1, 0)); settle(b, 0.1); check('regrab ok', b.metrics.grabbed && finite(b));
  b.reset(); check('reset mid grab', !b.metrics.grabbed);
  b.grab(0, 100, v(0, 1, 0)); b.grabMove(0, v(1e300, 1e300, 1e300)); settle(b, 0.5); check('grabMove 1e300 finite', finite(b), 'safetyResets=' + b.debug.safetyResets);
  b.grabRelease(0); settle(b, 0.5);
}
// --- finger / fingerMove with huge but finite numbers
for (const big of [1e30, 1e150, 1e200, 1e300]) {
  const b = new SoftBody(g);
  const top = b.raycast(v(0.0, 3, 0), v(0, -1, 0))!;
  const args = { point: top.point, normal: top.normal, dir: v(0, -1, 0) };
  b.fingerDown(0, args); b.fingerPressure(0, 1); settle(b, 0.2);
  b.fingerMove(0, v(big, 0, big)); settle(b, 0.3);
  check('fingerMove ' + big + ' finite, no safety reset', finite(b) && b.debug.safetyResets === 0, 'sr=' + b.debug.safetyResets);
  const c = new SoftBody(g);
  c.fingerDown(0, { point: v(big, big, big), normal: v(0, 1, 0), dir: v(0, -1, 0) });
  c.fingerDown(1, { point: v(-big, big, big), normal: v(0, 1, 0), dir: v(0, -1, 0) });
  settle(c, 0.3);
  check('fingerDown huge point ' + big + ' finite, no safety reset', finite(c) && c.debug.safetyResets === 0, 'sr=' + c.debug.safetyResets + ' comp=' + c.metrics.compression);
  const d = new SoftBody(g);
  d.nudge(v(big, 0, 0)); settle(d, 0.5); check('nudge ' + big, finite(d) && d.debug.safetyResets === 0);
}
// --- nudge NaN
{
  const b = new SoftBody(g); b.nudge(v(NaN, 0, 0)); b.nudge(null as any); b.nudge(v(Infinity, 0, 0)); settle(b, 0.5); check('nudge NaN/Inf ignored', finite(b) && Math.abs(b.center.x) < 1e-6);
}
// --- gravity switching keeps shape
{
  const b = new SoftBody(g); settle(b, 1); const h = b.stateHash(); b.gravity = false; check('gravity switch instant keeps hash', b.stateHash() === h); b.gravity = true;
  check('gravity getter', b.gravity === true);
}
// --- event throttle
{
  const b = new SoftBody(g); const ev: SoftEvent[] = [];
  const top = b.raycast(v(0.0, 3, 0), v(0, -1, 0))!;
  const args = { point: top.point, normal: top.normal, dir: v(0, -1, 0) };
  const times: Record<string, number[]> = {}; let t = 0;
  for (let k = 0; k < 40; k++) {
    b.fingerDown(0, args); b.fingerPressure(0, 1);
    for (let i = 0; i < 3; i++) { b.step(1 / 60); t += 1 / 60; }
    b.fingerUp(0); b.step(1 / 60); t += 1 / 60;
    b.drainEvents(ev);
  }
  const by: Record<string, number> = {};
  for (const e of ev) by[e.kind + e.finger] = (by[e.kind + e.finger] ?? 0) + 1;
  console.log('  event counts', JSON.stringify(by), 'over', t.toFixed(2), 's');
  // drainEvents appends
  const out: SoftEvent[] = [{ kind: 'poke', at: v(0, 0, 0), normal: v(0, 1, 0), intensity: 0, heldFor: 0, finger: 0 }];
  b.drainEvents(out); check('drainEvents appends (keeps prior)', out.length === 1);
  b.fingerDown(0, args); b.fingerPressure(0, 1); settle(b, 0.5); b.drainEvents(out); const n1 = out.length; b.drainEvents(out);
  check('drainEvents clears', out.length === n1 && n1 > 1, 'n=' + n1);
  const pr = out.find(e => e.kind === 'press');
  console.log('  press event heldFor =', pr ? pr.heldFor : 'none', '(contract: 0 except release/snap)');
}
// --- allocation in step
{
  const b = new SoftBody(g); settle(b, 1);
  const top = b.raycast(v(0.0, 3, 0), v(0, -1, 0))!;
  const args = { point: top.point, normal: top.normal, dir: v(0, -1, 0) };
  b.fingerDown(0, args); b.fingerPressure(0, 1);
  (globalThis as any).gc?.();
  const m0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 3000; i++) b.step(1 / 60);
  const m1 = process.memoryUsage().heapUsed;
  console.log('  heap delta over 3000 pressed steps (no gc control):', ((m1 - m0) / 1024).toFixed(0), 'KB');
}
// --- reset determinism vs fresh
{
  const script = (b: SoftBody) => {
    const top = b.raycast(v(0.0, 3, 0), v(0, -1, 0))!;
    b.fingerDown(0, { point: top.point, normal: top.normal, dir: v(0, -1, 0) }); b.fingerPressure(0, 0.8);
    for (let i = 0; i < 40; i++) b.step(1 / 60);
    b.fingerUp(0);
    for (let i = 0; i < 40; i++) b.step(1 / 60);
    return b.stateHash();
  };
  const a = new SoftBody(g); const ha = script(a);
  const b = new SoftBody(g); for (let i = 0; i < 7; i++) b.step(1 / 100); b.reset(); const hb = script(b);
  check('reset() then script == fresh script', ha === hb, ha + ' vs ' + hb);
  const f1 = new SoftBody(g); f1.gravity = false; const fa = (() => { for (let i = 0; i < 120; i++) f1.step(1 / 60); return f1.stateHash(); })();
  const f2 = new SoftBody(g); f2.gravity = false; for (let i = 0; i < 77; i++) f2.step(1 / 60); f2.reset(); const fb = (() => { for (let i = 0; i < 120; i++) f2.step(1 / 60); return f2.stateHash(); })();
  check('float: reset() then run == fresh run', fa === fb, fa + ' vs ' + fb);
}
console.log(bad ? `${bad} FAILED` : 'all ok');

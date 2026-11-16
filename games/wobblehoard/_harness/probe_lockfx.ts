// LOCK, INTEGRATION leg: the lock marker (src/render/lockfx.ts) without a GPU. Pure THREE scene-graph objects: sprites, materials, easing, the calm / flash-governor factors, the cap of 6,
// hostile points, no allocation per frame. (The ring texture is a canvas: absent in node, which must be harmless.)
//   node _harness/probe_lockfx.ts
import { LockFx, MAX_LOCK_MARKERS } from '../src/render/lockfx.ts';

let bad = 0, total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const P = (n: number): { x: number; y: number; z: number }[] => Array.from({ length: n }, (_, i) => ({ x: i * 0.1, y: 0.4 + i * 0.01, z: 0.2 }));
const run = (f: LockFx, secs: number, rest = 0.5, gov = 1, calm = false): void => { for (let t = 0; t < secs; t += 1 / 60) f.update(1 / 60, rest, gov, calm); };
const sprites = (f: LockFx) => f.group.children as unknown as Array<{ visible: boolean; position: { x: number; y: number; z: number }; scale: { x: number }; material: { opacity: number } }>;

{
  const f = new LockFx();
  check('starts with nothing drawn: group hidden, shown 0', !f.group.visible && f.shown === 0 && f.wanted === 0);
  f.set(P(3));
  run(f, 0.02);
  check('3 points asked: after 20 ms they are appearing (shown 3, group visible), not yet at full opacity', f.shown === 3 && f.group.visible && sprites(f)[0].material.opacity < 0.5 * 0.9, `opacity ${sprites(f)[0].material.opacity.toFixed(3)}`);
  run(f, 0.5);
  const s = sprites(f);
  check('after 0.5 s: opacity at the cap (0.9 within the breathing), scale = 0.42 x the rest radius (within 7 %)', Math.abs(s[0].material.opacity - 0.9) < 0.02 && Math.abs(s[0].scale.x / (0.42 * 0.5) - 1) < 0.07, `opacity ${s[0].material.opacity.toFixed(3)}, scale ${s[0].scale.x.toFixed(4)}`);
  check('positions follow the points (x 0, 0.1, 0.2)', Math.abs(s[1].position.x - 0.1) < 1e-6 && Math.abs(s[2].position.x - 0.2) < 1e-6);
  f.set(P(1));
  run(f, 0.05);
  check('2 of 3 released: they are still fading 50 ms later (shown 3: easing out, not a pop)', f.shown === 3);
  run(f, 0.4);
  check('...and gone 0.45 s after (shown 1, the sprites hidden)', f.shown === 1 && !s[1].visible && !s[2].visible && s[0].visible);
  f.set([]);
  run(f, 0.4);
  check('an empty call (the last lock gone) clears the rest: shown 0, group hidden', f.shown === 0 && !f.group.visible);
  f.dispose();
  check('dispose does not throw and empties the group', f.group.children.length === 0);
}
{
  const f = new LockFx();
  f.set(P(10));
  run(f, 0.6);
  check(`more points than the cap (${MAX_LOCK_MARKERS}): only ${MAX_LOCK_MARKERS} are drawn`, f.shown === MAX_LOCK_MARKERS && f.wanted === MAX_LOCK_MARKERS, `shown ${f.shown}`);
}
{
  const a = new LockFx(), b = new LockFx(), c = new LockFx();
  for (const f of [a, b, c]) f.set(P(2));
  run(a, 1, 0.5, 1, false); run(b, 1, 0.5, 1, true); run(c, 1, 0.5, 0.35, false);
  const oa = sprites(a)[0].material.opacity, ob = sprites(b)[0].material.opacity, oc = sprites(c)[0].material.opacity;
  check('calm effects: softer (<= 0.56) and not breathing; the flash governor (glow factor 0.35) holds it low (<= 0.33)', ob <= 0.5501 && ob >= 0.5 && oc <= 0.9 * 0.35 * 1.0001 && oa > ob, `normal ${oa.toFixed(3)}, calm ${ob.toFixed(3)}, governed ${oc.toFixed(3)}`);
  // breathing amplitude: the scale swings by at most 6 % and the opacity never moves (a glow, never a flash: it cannot reach the 3 Hz / 10 % luminance bars)
  let lo = 1e9, hi = -1e9, olo = 1e9, ohi = -1e9;
  for (let t = 0; t < 4; t += 1 / 60) { a.update(1 / 60, 0.5, 1, false); const s = sprites(a)[0]; lo = Math.min(lo, s.scale.x); hi = Math.max(hi, s.scale.x); olo = Math.min(olo, s.material.opacity); ohi = Math.max(ohi, s.material.opacity); }
  check('normal mode: the ring breathes 6 % in size at 0.8 Hz, its opacity is constant (no flicker)', hi / lo < 1.14 && hi / lo > 1.05 && ohi - olo < 1e-6, `size swing ${(hi / lo).toFixed(3)}, opacity swing ${(ohi - olo).toExponential(2)}`);
  let clo = 1e9, chi = -1e9;
  for (let t = 0; t < 4; t += 1 / 60) { b.update(1 / 60, 0.5, 1, true); const s = sprites(b)[0]; clo = Math.min(clo, s.scale.x); chi = Math.max(chi, s.scale.x); }
  check('calm: no breathing at all (the size is constant)', chi - clo < 1e-9, `swing ${(chi - clo).toExponential(2)}`);
}
{
  const f = new LockFx();
  f.set([{ x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 0, y: 0, z: 1e300 }, null as unknown as { x: number; y: number; z: number }, { x: 1, y: 1, z: 1 }]);
  run(f, 0.5, NaN as number, NaN as number);
  let finite = true;
  for (const s of sprites(f)) if (!Number.isFinite(s.position.x + s.position.y + s.position.z + s.scale.x + s.material.opacity)) finite = false;
  check('hostile points and a NaN rest radius / glow factor: nothing throws, every sprite value stays finite', finite);
  f.set(null);
  run(f, 0.5);
  check('set(null) lets everything go', f.shown === 0);
}
{
  const f = new LockFx();
  f.set(P(5)); run(f, 1);
  const pts = P(5);
  // allocation per frame: heap growth over 20000 updates + sets with a warm pool
  const g = (globalThis as { gc?: () => void }).gc;
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) { pts[0].x = i * 1e-5; f.set(pts); f.update(1 / 60, 0.5, 1, i % 2 === 0); }
  const h1 = process.memoryUsage().heapUsed;
  check('no allocation per frame: 20000 set + update calls grow the heap by < 1 MB (no gc control: a coarse bound)', h1 - h0 < 1_000_000, `${((h1 - h0) / 1024).toFixed(0)} KB${g ? '' : ' (no --expose-gc)'}`);
}
console.log(`\n${total - bad}/${total} lock marker checks passed`);
process.exit(bad ? 1 : 0);

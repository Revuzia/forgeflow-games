// SCRATCH ONLY (netcode lane): cross-engine determinism probe. Bundled with rolldown, run in Node, Chromium,
// Firefox and WebKit; each reports checkpoint hashes of the SAME bot-driven run plus a Math micro-test.
import type { World } from '../src/core/types.ts';
import { EMPTY_RUN_META } from '../src/core/types.ts';
import { createWorld, stepWorld } from '../src/core/world.ts';
import { hasPendingDraft, rollOffer, pickUpgrade } from '../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from './bot.ts';

const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
function H() { let h = 0x811c9dc5 >>> 0; return {
  u(x: number) { for (let s = 0; s < 32; s += 8) { h ^= (x >>> s) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } },
  n(x: number) { F64[0] = x; this.u(U32[0]); this.u(U32[1]); },
  hex() { return (h >>> 0).toString(16).padStart(8, '0'); } }; }
function hashWorld(w: World): string {
  const hs = H(); const T = w.titan;
  hs.n(w.tick); hs.n(T.x); hs.n(T.z); hs.n(T.heading); hs.n(T.hp); hs.n(T.xp); hs.n(T.level); hs.n(T.height);
  for (const e of w.enemies) if (e.alive) { hs.n(e.x); hs.n(e.z); hs.n(e.hp); hs.n(e.heading); }
  for (const p of w.pickups) if (p.alive) { hs.n(p.x); hs.n(p.z); }
  for (const p of w.city.props) { hs.n(p.x); hs.n(p.z); }
  if (w.boss) { hs.n(w.boss.x); hs.n(w.boss.z); hs.n(w.boss.hp); }
  for (const b of w.city.buildings) { hs.n(b.alive); hs.n(b.floorHp); }
  return hs.hex();
}

function mathTest(): Record<string, string> {
  const out: Record<string, string> = {};
  let s = 12345 >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const N = 200000;
  const xs = new Float64Array(N), ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { xs[i] = (r() - 0.5) * 2000; ys[i] = (r() - 0.5) * 2000; }
  const fns: Record<string, (i: number) => number> = {
    sin: i => Math.sin(xs[i] * 0.01), cos: i => Math.cos(xs[i] * 0.01), tan: i => Math.tan(xs[i] * 0.001),
    atan2: i => Math.atan2(ys[i], xs[i]), exp: i => Math.exp(xs[i] * 0.005), log: i => Math.log(Math.abs(xs[i]) + 1e-3),
    pow: i => Math.pow(Math.abs(xs[i]) * 0.01 + 0.5, 1.37), hypot: i => Math.hypot(xs[i], ys[i]), sqrt: i => Math.sqrt(Math.abs(xs[i])),
    asin: i => Math.asin(ys[i] / 1000.0001), sinBig: i => Math.sin(xs[i] * 1000),
  };
  for (const k in fns) { const h = H(); const f = fns[k]; for (let i = 0; i < N; i++) h.n(f(i)); out[k] = h.hex(); }
  return out;
}

export function runProbe(titan: string, biome: string, seed: number, ticks: number): { math: Record<string, string>; checkpoints: string[]; final: string; ms: number } {
  const t0 = Date.now();
  const w = createWorld({ titan: titan as any, biome: biome as any, seed, meta: { ...EMPTY_RUN_META, unlocked: [] } as any });
  const cps: string[] = [];
  for (let i = 0; i < ticks && !w.run.result; i++) {
    let g = 0;
    while (hasPendingDraft(w) && g++ < 200) {
      const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0);
      if (!offer || !offer.length) break;
      pickUpgrade(w, botPickUpgrade(w, offer));
    }
    stepWorld(w, botInput(w));
    if ((i + 1) % 300 === 0) cps.push(hashWorld(w));
  }
  return { math: mathTest(), checkpoints: cps, final: hashWorld(w), ms: Date.now() - t0 };
}
(globalThis as any).runProbe = runProbe;

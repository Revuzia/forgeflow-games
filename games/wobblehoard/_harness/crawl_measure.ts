// R13_FIX 4: the crawl's look in numbers, per family (plain node, type stripping): a 2 m walk on the flat at the family's glide speed (GAITS), the template
// genome; in the steady part (35 cm in, 35 cm before the end): the cycle (the crawl's own phase: cycles per second), the body's height (its extent up) and its
// length along the travel (its extent along it) as % of the rest ones, min..max, and the centre's height swing as % of the rest height.
//   node _harness/crawl_measure.ts [family,...] [size 0..1] [firmness 0..1]
import { SoftBody } from '../src/physics/softbody.ts';
import { buildPropWorld } from '../src/physics/props.ts';
import { makeStarterGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';
import { GAITS } from '../src/data/life.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import type { PlaceDef } from '../src/data/places.ts';
import type { SoftEvent } from '../src/contracts.ts';

const DT = 1 / 60;
const SIZE = Number(process.argv[3] ?? 0.5), FIRM = Number(process.argv[4] ?? 0.5);
const G0: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: FIRM, bounce: 0.5, stretch: 0.5, size: SIZE });
const flatDef = { ...CABIN, things: [], walls: [], zones: [], patches: [], tall: { ...CABIN.tall, things: [], walls: [], zones: [], patches: [] } } as unknown as PlaceDef;
const GLIDE = GAITS as Record<string, { glide: number }>;
const ev: SoftEvent[] = [];
const fams = (process.argv[2] ? process.argv[2].split(',') : MATERIAL_FAMILY_IDS) as readonly string[];
const f = (x: number, d = 1): string => x.toFixed(d);
for (const fam of fams) {
  const w = buildPropWorld(flatDef, 'wide', 1);
  const b = new SoftBody(G0, { family: fam } as never);
  b.setPropWorld(w);
  const fr = (): void => { w.beginFrame(); b.step(DT); ev.length = 0; b.drainEvents(ev); w.endFrame(DT); };
  for (let i = 0; i < 90; i++) fr();
  const P = b.positions, n = P.length / 3;
  const ext = (): [number, number, number] => { let y0 = 1e9, y1 = -1e9, s0 = 1e9, s1 = -1e9; for (let i = 0; i < n; i++) { const y = P[i * 3 + 1], s = P[i * 3]; if (y < y0) y0 = y; if (y > y1) y1 = y; if (s < s0) s0 = s; if (s > s1) s1 = s; } return [y1 - y0, s1 - s0, y1]; };
  const [h0, l0] = ext(), cy0 = b.center.y;
  const x0 = b.center.x;
  b.scootTo(x0 + 2, b.center.z, GLIDE[fam].glide);
  const crawls = (w as unknown as { crawls: { s: Float64Array }[] }).crawls;
  let hMin = 9, hMax = 0, lMin = 9, lMax = 0, cyMin = 9, cyMax = -9, wraps = 0, tSteady = 0, lastPh = -1;
  for (let k = 0; k < 60 * 30; k++) {
    fr();
    const done = b.center.x - x0;
    if (done > 1.95) break;
    if (done > 0.35 && done < 1.65) {
      // (after the turn toward +x: the body's length is then along x)
      const [h, l] = ext();
      hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); lMin = Math.min(lMin, l); lMax = Math.max(lMax, l);
      cyMin = Math.min(cyMin, b.center.y); cyMax = Math.max(cyMax, b.center.y);
      const ph = crawls[0]?.s[0] ?? 0;
      if (lastPh >= 0) { let d = ph - lastPh; if (d < 0) d += 2 * Math.PI; wraps += d / (2 * Math.PI); }
      lastPh = ph; tSteady += DT;
    }
  }
  // (the rest length is along the body's own z at rest; after its turn to +x the length is measured along x: compare with the rest extent along z)
  let zs0 = 1e9, zs1 = -1e9;
  void zs0; void zs1;
  console.log(`${fam.padEnd(13)} glide ${GLIDE[fam].glide.toFixed(2)} m/s  cycle ${f(wraps / Math.max(1e-6, tSteady), 2)} Hz  height ${f(100 * hMin / h0)}..${f(100 * hMax / h0)} % (swing ${f(100 * (hMax - hMin) / h0)} %)  length ${f(100 * lMin / l0)}..${f(100 * lMax / l0)} % (swing ${f(100 * (lMax - lMin) / l0)} %)  centre y swing ${f(100 * (cyMax - cyMin) / h0)} % of h  rest h ${f(h0, 3)} l ${f(l0, 3)}  resets ${b.debug.safetyResets}`);
}

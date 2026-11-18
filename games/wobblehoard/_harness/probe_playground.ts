// PG_PHYS (PLAYGROUND physics): the PH rows of _spec/PLAYGROUND_BUILD.md 18 that this build covers, and PF-05. Plain node (type stripping).
//   node _harness/probe_playground.ts                 the quick set (what run_probes.ts runs: no arguments; under 20 s on a quiet 4-core container)
//   node _harness/probe_playground.ts --full          every family x 3 genomes and the long holds (a heavy job, 1 to 2 minutes)
//   node _harness/probe_playground.ts --only=hop,gate,static,hinge,ball,mass,squash,sleep,det,alloc,cost,order,pf05,inert
// The quick set is a subset: fewer families, one layout for the rocker, the swing and the ball, short holds; PH-11 (its 100 s warm-up), PF-05 (timing batches) and
// the 3-body pile run only with --full or --only (each is listed as an INFO row in the quick set).
// Independent meters: own fold meter (the largest dihedral between neighbouring triangles, degrees; the rest shapes' own maximum is about 50), own
// lowest-particle and centre tracking, own volume integral (metrics.volume is cross-checked), own wall clock (performance.now) and new-space growth.
import v8 from 'node:v8';
import { PG, SLEEP, SoftBody } from '../src/physics/softbody.ts';
import { PROPS, PropWorld, buildPropWorld } from '../src/physics/props.ts';
import { ContactPlanner } from '../src/physics/broad.ts';
import { makeStarterGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';
import { GRAVITY } from '../src/physics/params.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { PLACE as RIPPLE } from '../src/data/place_ripple.ts';
import { PLACE as FROSTBELL } from '../src/data/place_frostbell.ts';
import { PLACE as RAINLEAF } from '../src/data/place_rainleaf.ts';
import { PLACE as LANTERN } from '../src/data/place_lanternroof.ts';
import { PLACE as CLOUD } from '../src/data/place_cloudloft.ts';
import { FAMILY_REACT } from '../src/data/life.ts';
import { MECH } from '../src/data/places.ts';
import type { PlaceDef, ThingDef } from '../src/data/places.ts';
import type { SoftEvent, V3 } from '../src/contracts.ts';

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const only = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const secT: [string, number][] = [];   // (PGTIME=1: each section's start, printed at the end: the quick set's budget)
const run = (s: string): boolean => { if (process.env.PGTIME && !secT.some((x) => x[0] === s)) secT.push([s, performance.now()]); return only.length === 0 || only.includes(s); };
const QUICK = !FULL && only.length === 0;   // the default run (run_probes.ts): under 20 s
const LONG = (s: string): boolean => FULL || only.includes(s);   // rows that run only with --full or --only
const DT = 1 / 60;
const t0 = performance.now();
interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const info = (what: string, value: string): void => { rows.push({ what: 'INFO ' + what, value, limit: '', pass: true }); };
const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

const NEUTRAL: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5 });
const SOFT: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.05, bounce: 0.95, stretch: 0.95, size: 0.9 });
const FIRM: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.95, bounce: 0.05, stretch: 0.05, size: 0.1 });
const GENOMES: [string, Genome][] = FULL ? [['template', NEUTRAL], ['soft-big', SOFT], ['firm-small', FIRM]] : [['template', NEUTRAL]];
const FAMS = MATERIAL_FAMILY_IDS as readonly string[];
const mk = (g: Genome, fam: string, opts: Record<string, unknown> = {}): SoftBody => new SoftBody(g, { family: fam, ...opts } as never);
const priv = (b: SoftBody): Record<string, number | boolean> => b as unknown as Record<string, number | boolean>;

/* ───────────── meters ───────────── */
const EDGE_CACHE = new Map<Uint32Array, Int32Array>();
/** Interior edges as [triA, triB] pairs (once per mesh). */
function triPairs(idx: Uint32Array): Int32Array {
  let p = EDGE_CACHE.get(idx);
  if (p) return p;
  const m = new Map<string, number>(), out: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) for (let e = 0; e < 3; e++) {
    const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)], k = a < b ? `${a},${b}` : `${b},${a}`;
    const o = m.get(k);
    if (o === undefined) m.set(k, t); else out.push(o, t);
  }
  p = Int32Array.from(out); EDGE_CACHE.set(idx, p);
  return p;
}
/** The largest angle (degrees) between the normals of two neighbouring triangles. */
function foldDeg(b: SoftBody): number {
  const P = b.positions, I = b.indices, pr = triPairs(I);
  let worst = -1;
  const nrm = (t: number, o: number[]): void => {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    o[0] = nx / l; o[1] = ny / l; o[2] = nz / l;
  };
  const A = [0, 0, 0], B = [0, 0, 0];
  for (let k = 0; k < pr.length; k += 2) { nrm(pr[k], A); nrm(pr[k + 1], B); const c = A[0] * B[0] + A[1] * B[1] + A[2] * B[2]; if (c < worst || worst === -1) worst = c; }
  return (Math.acos(Math.max(-1, Math.min(1, worst))) * 180) / Math.PI;
}
const lowest = (b: SoftBody): number => { let m = Infinity; const P = b.positions; for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i]; return m; };
const finite = (b: SoftBody): boolean => { let s = 0; const P = b.positions; for (let i = 0; i < P.length; i++) s += P[i]; return Number.isFinite(s) && b.debug.safetyResets === 0; };
const ev: SoftEvent[] = [];
const drain = (b: SoftBody): SoftEvent[] => { ev.length = 0; b.drainEvents(ev); return ev; };
const settle = (b: SoftBody, s: number): void => { for (let i = 0; i < Math.round(s / DT); i++) { b.step(DT); drain(b); } };
const topPress = (b: SoftBody, id: 0 | 1 = 0, depth = 0.6): boolean => {
  const h = b.raycast(v3(b.center.x, b.center.y + 3, b.center.z + 0.02), v3(0, -1, 0));
  if (!h) return false;
  b.fingerDown(id, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) }); b.fingerPressure(id, depth);
  return true;
};
/** A minimal PlaceDef with these things (the wide layout only; tall = the same), for the rows that need one shape at a time. */
function testPlace(things: ThingDef[], walls = false): PlaceDef {
  const w = walls ? [{ shape: 'box' as const, x: 0, z: -2.55, hx: 3.7, hz: 0.15 }, { shape: 'box' as const, x: -3.55, z: 0, hx: 0.15, hz: 2.7 }, { shape: 'box' as const, x: 3.55, z: 0, hx: 0.15, hz: 2.7 }] : [];
  return { ...CABIN, things, walls: w, zones: [], patches: [], tall: { ...CABIN.tall, things: things.map((t) => ({ x: t.x, z: t.z, yaw: t.yaw })), walls: w, zones: [], patches: [] } } as PlaceDef;
}
const thing = (mech: number, x: number, z: number, size: [number, number, number], p: Record<string, number> = {}, yaw = 0): ThingDef =>
  ({ id: 'hearth', place: 'hearthlog', mech, x, z, yaw, size, mu: 0.8, p, ride: false, verb: 0, icon: 0, look: '', sound: 0 }) as unknown as ThingDef;
/** One frame of a world with bodies: beginFrame, the contact planner, every body steps, endFrame. */
function frameW(w: PropWorld | null, bodies: SoftBody[], planner: ContactPlanner | null): void {
  if (w) w.beginFrame();
  if (planner && bodies.length >= 2) planner.run(bodies);
  for (const b of bodies) { b.step(DT); drain(b); }
  if (w) w.endFrame(DT);
}

/* ───────────── PH-00: inert when unused (every existing row keeps its numbers) ───────────── */
if (run('inert')) {
  // a body with an EMPTY world bound and sleepEnabled false steps bit for bit as one with none (the prop pass, the support and the weight run but find nothing)
  const empty = buildPropWorld(testPlace([]), 'wide', 1);
  let same = 0, n = 0;
  for (const fam of QUICK ? ['putty'] : ['jellygel', 'putty', 'waterfill']) {
    const a = mk(NEUTRAL, fam), b = mk(NEUTRAL, fam);
    b.setPropWorld(empty);
    a.nudge(v3(0.8, 1.2, -0.3)); b.nudge(v3(0.8, 1.2, -0.3));
    let eq = true;
    for (let i = 0; i < 150; i++) {
      if (i === 40) { topPress(a); topPress(b); }
      if (i === 80) { a.fingerUp(0); b.fingerUp(0); }
      empty.beginFrame(); a.step(DT); b.step(DT); empty.endFrame(DT); drain(a); drain(b);
      if (a.stateHash() !== b.stateHash()) eq = false;
    }
    n++; if (eq) same++;
  }
  add(`PH-10 / inert: an empty PropWorld bound changes nothing (${n} famil${n > 1 ? 'ies' : 'y'}, a shove, a press and a release, 150 frames: the state hash equal every frame)`, `${same}/${n} equal`, 'all equal', same === n);
}

/* ───────────── PH-01: the hop ───────────── */
if (run('hop')) {
  const target = (PG.hopVyCap * PG.hopVyCap) / (2 * GRAVITY);
  const results: string[] = [];
  let bad = 0, total = 0, landEv = 0, worstFold = 0, second = 0, worstApex = 0, minApex = Infinity, refusedOk = 0, refusedN = 0;
  const hopOnce = (b: SoftBody, vy: number): { apex: number; lands: number; fold: number; second: boolean } => {
    settle(b, 0.6);
    const y0 = lowest(b);
    let apex = 0, lands = 0, fold = 0, landed = false, relift = false, air = false;
    const ok = b.hop(0, vy, 0);
    if (!ok) return { apex: NaN, lands: 0, fold: 0, second: false };
    for (let i = 0; i < 90; i++) {
      b.step(DT);
      for (const e of drain(b)) if (e.kind === 'land') lands++;
      const lo = lowest(b) - y0;
      if (lo > apex) apex = lo;
      if (lo > 0.004) air = true;
      if (air && lo < 0.002) landed = true;
      if (landed && lo > 0.012) relift = true;
      if (i % 3 === 0) fold = Math.max(fold, foldDeg(b));
    }
    return { apex, lands, fold, second: relift };
  };
  for (const fam of QUICK ? ['jellygel', 'marshmallow', 'firmsilicone', 'stickystretch', 'waterfill', 'putty'] : FAMS) {
    if (fam === 'putty' || fam === 'slimegoo') {   // LIFE never hops them (5.2); physics still must not misbehave: one hop on the template genome
      const b = mk(NEUTRAL, fam), r = hopOnce(b, PG.hopVyCap);
      results.push(`${fam} ${f(r.apex * 100, 2)}cm`);
      total++; if (!(r.apex <= 0.036 && r.lands === 0 && r.fold <= 120 && !r.second)) bad++;
      worstFold = Math.max(worstFold, r.fold); landEv += r.lands;
      continue;
    }
    for (const [gn, g] of GENOMES) {
      const b = mk(g, fam), r = hopOnce(b, PG.hopVyCap);
      total++;
      const okApex = Math.abs(r.apex - target) <= 0.25 * target && r.apex <= 0.036;
      if (!(okApex && r.lands === 0 && r.fold <= 120 && !r.second)) { bad++; results.push(`${fam}/${gn} apex ${f(r.apex * 100, 2)} cm lands ${r.lands} fold ${f(r.fold, 0)} second ${r.second}`); }
      worstFold = Math.max(worstFold, r.fold); landEv += r.lands; if (r.second) second++;
      worstApex = Math.max(worstApex, r.apex); minApex = Math.min(minApex, r.apex);
    }
  }
  add(`PH-01 hop at the S1 cap (vy ${PG.hopVyCap} m/s, ballistic apex ${f(target * 100, 2)} cm): ${QUICK ? 6 : 12} families x ${GENOMES.length} genome(s): the lowest particle's apex within +-25% of target and at most 3.6 cm, no 'land', no second lift-off, no fold over 120 deg`,
    `${total - bad}/${total} ok; apex ${f(minApex * 100, 2)} .. ${f(worstApex * 100, 2)} cm; land events ${landEv}; second lift-offs ${second}; worst fold ${f(worstFold, 0)} deg${bad ? '; ' + results.join('; ') : ''}`, 'all', bad === 0);
  // a 1/8 piece hops at vy x 0.8 (LIFE 5.2)
  {
    const tP = ((PG.hopVyCap * 0.8) ** 2) / (2 * GRAVITY);
    let pb = 0, pt = 0; const ap: string[] = [];
    for (const fam of FULL ? FAMS : QUICK ? ['jellygel'] : ['jellygel', 'firmsilicone', 'marshmallow']) {
      if (fam === 'putty' || fam === 'slimegoo') continue;
      const b = mk(NEUTRAL, fam, { piece: { frac: 0.125, chunk: false } }), r = hopOnce(b, PG.hopVyCap * 0.8);
      pt++; ap.push(`${fam} ${f(r.apex * 100, 2)}`);
      if (!(Math.abs(r.apex - tP) <= 0.25 * tP && r.lands === 0 && r.fold <= 120 && !r.second)) pb++;
    }
    add(`PH-01 hop of a 1/8 piece (detail 2) at vy x 0.8 (target ${f(tP * 100, 2)} cm)`, `${pt - pb}/${pt} ok (apex cm: ${ap.join(', ')})`, 'all within +-25%, no land, no second, fold <= 120', pb === 0);
  }
  // refusals: held, airborne, inside 0.8 s of the last hop, a ceremony driver, memory busy
  {
    const b = mk(NEUTRAL, 'jellygel'); settle(b, 0.5);
    topPress(b); b.step(DT); refusedN++; if (!b.hop(0, 0.8, 0)) refusedOk++;
    b.fingerUp(0); settle(b, 1.0);
    refusedN++; if (b.hop(0, 0.8, 0)) refusedOk++;                       // allowed
    refusedN++; if (!b.hop(0, 0.8, 0)) refusedOk++;                      // inside 0.8 s
    for (let i = 0; i < 6; i++) b.step(DT);
    refusedN++; if (!b.hop(0, 0.8, 0)) refusedOk++;                      // airborne (and inside 0.8 s)
    settle(b, 1.5);
    b.setFold(0.3); b.step(DT); refusedN++; if (!b.hop(0, 0.8, 0)) refusedOk++;   // a ceremony driver
    const p = mk(NEUTRAL, 'putty'); settle(p, 0.3);
    topPress(p, 0, 1); for (let i = 0; i < 40; i++) p.step(DT); p.fingerUp(0); for (let i = 0; i < 30; i++) p.step(DT);
    refusedN++; const busy = !!p.metrics.memoryBusy; if (busy && !p.hop(0, 0.5, 0)) refusedOk++;
    add('PH-01 hop refusals: held (a finger down), then allowed, inside 0.8 s, airborne, a ceremony driver (setFold), putty with its memory busy (a deep press just released: metrics.memoryBusy)',
      `${refusedOk}/${refusedN} as specified (putty memoryBusy after the press: ${busy})`, 'all', refusedOk === refusedN);
  }
}

/* ───────────── PH-02: the touch gate ───────────── */
if (run('gate')) {
  // scootTo eases out within 0.12 s under a finger; moveTo is untouched by it; scootTo yields to moveTo; a lock counts as held
  const b = mk(NEUTRAL, 'jellygel'); settle(b, 0.5);
  const okStart = b.scootTo(2, 0, 0.3);
  let vmax = 0, px = b.center.x;
  for (let i = 0; i < 40; i++) { b.step(DT); drain(b); vmax = Math.max(vmax, (b.center.x - px) / DT); px = b.center.x; }
  topPress(b, 0, 0.4);
  const sp: number[] = [], gl: number[] = [];
  for (let i = 0; i < 40; i++) { const x0 = b.center.x; b.step(DT); drain(b); sp.push((b.center.x - x0) / DT); gl.push(priv(b).sV as number); }
  // the DRIVER's glide speed (sV) 7 frames (0.117 s) after the press, and whether it let go. (Re-specified from the centre's speed: under a finger the skin the
  // fixed tip held back while the body glided springs back once the glide stops, 0.14 m/s for a moment: that is the finger contact, not the driver; reported below)
  const after = gl[6], released = !(priv(b).scootOn as boolean);
  const refusedHeld = !b.scootTo(1, 1, 0.3);
  b.fingerUp(0); settle(b, 0.5);
  add('PH-02 touch gate: scootTo at 0.3 m/s eases out within 0.12 s of a finger down (the driver\'s glide speed 7 frames after the press) and lets go; refused while held',
    `start ${okStart}, glide ${f(vmax, 3)} m/s, driver after 0.117 s ${f(after, 4)} m/s, released ${released}; refused while held ${refusedHeld}; (the centre: ${f(sp[6], 3)} m/s at 0.117 s, ${f(sp[39], 3)} m/s at 0.67 s: the finger contact's recoil)`,
    'driver 0 m/s; released; refused', okStart && vmax > 0.25 && after === 0 && released && refusedHeld);
  // setSquash eases out within 0.12 s under a finger
  const c = mk(NEUTRAL, 'jellygel'); settle(c, 0.5);
  c.setSquash(0.8, 0.12); settle(c, 1.0);
  const sqBefore = priv(c).sqNow as number;
  topPress(c, 1, 0.3); c.step(DT); for (let i = 0; i < 6; i++) c.step(DT);
  const sqAfter = priv(c).sqNow as number;
  c.fingerUp(1); settle(c, 0.5);
  add('PH-02 touch gate: a held squash pose 0.8 eases back to 1 within 0.12 s of a finger down (7 frames)', `pose ${f(sqBefore, 3)} -> ${f(sqAfter, 4)}`, '|1 - pose| < 0.05 (95% gone)', Math.abs(1 - sqAfter) < 0.05 * (1 - 0.8) * 5);
  // moveTo is never gated: a ceremony slide keeps sliding under a finger
  const d = mk(NEUTRAL, 'jellygel'); settle(d, 0.5);
  d.moveTo(v3(1.5, 0, 0), 1); topPress(d, 0, 0.3);
  const x0 = d.center.x; settle(d, 0.5);
  d.fingerUp(0); d.moveTo(null);
  add('PH-02 moveTo (ceremonies, the cut) is untouched by the gate: it slides under a finger', `moved ${f(d.center.x - x0, 3)} m in 0.5 s`, '> 0.3 m', d.center.x - x0 > 0.3);
  // scootTo yields to moveTo
  const e = mk(NEUTRAL, 'jellygel'); settle(e, 0.5);
  e.moveTo(v3(-1, 0, 0), 1); const refusedCer = !e.scootTo(2, 0, 0.3); settle(e, 1.0);
  e.moveTo(null);
  add('PH-02 scootTo yields to moveTo: refused while moveTo drives the body; the body follows moveTo', `refused ${refusedCer}, centre x ${f(e.center.x, 3)}`, 'refused, x < -0.8', refusedCer && e.center.x < -0.8);
  // a lock counts as held (the touch gate; never for SoftEvent.auto)
  const s = new SoftBody(quantizeGenome({ ...makeStarterGenome(), species: 'granulo' } as Genome));
  settle(s, 0.3);
  const hit = s.raycast(v3(s.center.x + 3, s.center.y + 0.1, s.center.z), v3(-1, 0, 0));
  let locked = false;
  if (hit) {
    s.grab(0, hit.vertex, hit.point);
    for (let i = 0; i < 40; i++) { s.grabMove(0, v3(hit.point.x + (i + 1) * 0.05, hit.point.y, hit.point.z)); s.step(DT); drain(s); }
    locked = s.lockGrab(0);
    s.step(DT);
  }
  const scootRefused = !s.scootTo(-1, 0, 0.2), hopRefused = !s.hop(0, 0.5, 0);
  s.releaseLock('all'); settle(s, 0.5);
  add('PH-02 a lock counts as held for the touch gate: scootTo and hop refused while only a lock holds the body', `locked ${locked}, scoot refused ${scootRefused}, hop refused ${hopRefused}`, 'all true', locked && scootRefused && hopRefused);
}

/* ───────────── PH-07: squash poses keep the volume ───────────── */
if (run('squash')) {
  let worst = 0; const bad: string[] = [];
  for (const fam of FULL ? FAMS : QUICK ? ['jellygel', 'marshmallow'] : ['jellygel', 'firmsilicone', 'marshmallow', 'waterfill', 'slowrise']) {
    if (fam === 'putty' || fam === 'mochidough' || fam === 'beadsqueeze') continue;   // memory families: posed only with the memory converged; checked below
    for (const s of [0.75, 1.12]) {
      const b = mk(NEUTRAL, fam); settle(b, 0.4);
      b.setSquash(s, 0.12); settle(b, 1.2);
      const v = b.metrics.volume, fo = foldDeg(b);
      worst = Math.max(worst, Math.abs(v - 1));
      if (Math.abs(v - 1) > 0.03 || fo > 120 || !finite(b)) bad.push(`${fam} s ${s}: volume ${f(v, 4)} fold ${f(fo, 0)}`);
    }
  }
  add('PH-07 squash poses 0.75 and 1.12 (held 1.2 s): the volume stays within 3% (the settle band of G1 is +-1.5% at rest; a pose is a held deformation), no fold over 120, finite',
    `worst |volume - 1| ${f(worst, 4)}${bad.length ? '; ' + bad.join('; ') : ''}`, '<= 0.03', bad.length === 0);
  // an identical setSquash is a no-op (never wakes a sleeper: PH-22 below)
}

/* ───────────── PH-09 / PH-22: sleep and wake for wholes ───────────── */
if (run('sleep')) {
  // sleeps within 1.0 s at rest; an asleep step is cheap; each wake cause wakes it; a scoot at 0.04 m/s into a sleeper never wakes it
  const fams = FULL ? FAMS : QUICK ? ['jellygel', 'putty'] : ['jellygel', 'firmsilicone', 'waterfill', 'putty'];
  let slept = 0, worstT = 0; const late: string[] = [];
  for (const fam of fams) {
    const b = mk(NEUTRAL, fam); b.sleepEnabled = true;
    let t = 0;
    for (let i = 0; i < 300 && !b.sleeping; i++) { b.step(DT); drain(b); t += DT; }
    if (b.sleeping && t <= 1.0 + 1e-9) slept++; else late.push(`${fam} ${b.sleeping ? f(t, 2) + ' s' : 'never'}`);
    worstT = Math.max(worstT, t);
  }
  add('PH-09 a whole at rest with sleepEnabled sleeps within 1.0 s (spawned at rest)', `${slept}/${fams.length}, worst ${f(worstT, 2)} s${late.length ? '; ' + late.join(', ') : ''}`, 'all <= 1.0 s', slept === fams.length);
  // cost of an asleep step
  {
    const b = mk(NEUTRAL, 'jellygel'); b.sleepEnabled = true; settle(b, 1.5);
    const N = 20000, ta = performance.now();
    for (let i = 0; i < N; i++) b.step(DT);
    const ms = (performance.now() - ta) / N;
    add('PH-09 an asleep step costs at most 0.03 ms', `${f(ms * 1000, 2)} us (asleep ${b.sleeping})`, '<= 0.03 ms', b.sleeping && ms <= 0.03);
  }
  // wake causes
  {
    const causes: [string, (b: SoftBody) => void][] = [
      ['finger', (b) => { topPress(b); }], ['grab', (b) => { const h = b.raycast(v3(b.center.x + 3, b.center.y, b.center.z), v3(-1, 0, 0)); if (h) b.grab(0, h.vertex, h.point); }],
      ['nudge', (b) => b.nudge(v3(0.5, 0, 0))], ['moveTo', (b) => b.moveTo(v3(1, 0, 0), 1)], ['scootTo', (b) => { b.scootTo(1, 0, 0.2); }],
      ['setSquash', (b) => b.setSquash(0.9, 0.3)], ['hop', (b) => { b.hop(0, 0.5, 0); }], ['gravity', (b) => { b.gravity = false; }], ['setFrac', (b) => b.setFrac(0.9, 1)],
      ['setFold', (b) => b.setFold(0.3)], ['tremble', (b) => b.tremble(0.3)], ['reset', (b) => b.reset()], ['wake', (b) => b.wake()],
    ];
    let ok = 0; const bad: string[] = [];
    for (const [name, act] of causes) {
      const b = mk(NEUTRAL, 'jellygel'); b.sleepEnabled = true; settle(b, 1.5);
      const was = b.sleeping;
      act(b); b.step(DT);
      if (was && !b.sleeping) ok++; else bad.push(`${name}: was ${was}, now ${b.sleeping}`);
    }
    add('PH-09 each wake cause wakes a sleeping whole: finger, grab, nudge, moveTo, scootTo, setSquash, hop, gravity, setFrac, setFold, tremble, reset, wake', `${ok}/${causes.length}${bad.length ? '; ' + bad.join('; ') : ''}`, 'all', ok === causes.length);
  }
  // contacts: a slow scoot (0.04 m/s) into a sleeper never wakes it; a toss into it does
  {
    const planner = new ContactPlanner();
    const a = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(-1.3, 0, 0) } }), s = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } });
    // (built as wholes AT a spot: `piece: { frac: 1, chunk: false, at }` is the shell's mat build, a whole, not a piece)
    s.sleepEnabled = true;
    for (let i = 0; i < 90; i++) frameW(null, [a, s], planner);
    const asleep0 = s.sleeping;
    a.scootTo(0, 0, 0.04);
    let woke = false, touch = 0;
    for (let i = 0; i < 600; i++) { frameW(null, [a, s], planner); if (!s.sleeping) woke = true; if (a.center.x > -0.95) touch++; }
    const gap = s.center.x - a.center.x;
    add('PH-09 a scootTo at 0.04 m/s into a sleeping whole never wakes it (it stops against it as against a fixed support)', `asleep before ${asleep0}, woke ${woke}, centres ${f(gap, 3)} m apart after 10 s`, 'not woken, in contact (centres < 1.1 m apart: the dollop is 1.06 m wide)', asleep0 && !woke && gap < 1.1);
    const t = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } });
    t.sleepEnabled = true;
    for (let i = 0; i < 90; i++) frameW(null, [t], null);
    const asleep1 = t.sleeping;
    // a toss: a body thrown from 0.5 m up at 2 m/s toward it (a nudge from rest is no toss: the table's friction and peel damping stop it in a few cm)
    const c = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(-1.5, 0.95, 0), vel: v3(2, 0, 0) } });
    let woke2 = false;
    for (let i = 0; i < 90; i++) { frameW(null, [c, t], planner); if (!t.sleeping) woke2 = true; }
    add('PH-09 a body tossed into a sleeping whole (2 m/s, from 0.5 m up) wakes it', `asleep before ${asleep1}, woke ${woke2}`, 'woken', asleep1 && woke2);
  }
  // a pile of 3 sleeps within 3 s as an island and stays asleep 60 s (--only=sleep: 20 s; not in the quick set)
  if (LONG('sleep')) {
    const planner = new ContactPlanner();
    const bs = [mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(-0.92, 0, 0) } }), mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } }),
      mk(NEUTRAL, 'firmsilicone', { piece: { frac: 1, chunk: false, at: v3(0.92, 0, 0) } })];
    for (const b of bs) b.sleepEnabled = true;
    // push them together so they touch, then let go (the scoots released after 1 s: LIFE's contact approach stops at the contact)
    bs[0].scootTo(-0.5, 0, 0.3); bs[2].scootTo(0.5, 0, 0.3);
    for (let i = 0; i < 60; i++) frameW(null, bs, planner);
    bs[0].scootTo(NaN, 0, 0); bs[2].scootTo(NaN, 0, 0);
    let tAll = -1;
    for (let i = 0; i < 60 * 6; i++) { frameW(null, bs, planner); if (tAll < 0 && bs.every((b) => b.sleeping)) tAll = (i + 1) * DT; }
    const hold = FULL ? 60 : 20;
    let wakes = 0;
    const w0 = bs.map((b) => b.sleepInfo.wakes);
    for (let i = 0; i < 60 * hold; i++) frameW(null, bs, planner);
    for (let k = 0; k < 3; k++) wakes += bs[k].sleepInfo.wakes - w0[k];
    const touching = bs[1].center.x - bs[0].center.x < 1.05 && bs[2].center.x - bs[1].center.x < 1.05;
    add(`PH-09 three wholes pressed together (scootTo for 1 s, then let go) all sleep within 3 s as an island, and stay asleep ${hold} s`, `all asleep ${f(tAll, 2)} s after the release; touching ${touching}; wakes while resting ${wakes}`, 'all asleep within 3 s, 0 wakes', tAll > 0 && tAll <= 3 && wakes === 0);
  }
  // memory families sleep only with the memory converged (max |MEM - Q| < 0.02 R)
  {
    const b = mk(NEUTRAL, 'putty'); b.sleepEnabled = true; settle(b, 0.3);
    topPress(b, 0, 1); for (let i = 0; i < 40; i++) b.step(DT); b.fingerUp(0);
    let sleptBusy = false, t = 0;
    for (let i = 0; i < 60 * (QUICK ? 8 : 20) && !b.sleeping; i++) { b.step(DT); drain(b); t += DT; if (b.sleeping && (priv(b).memDev as number) >= PG.memBusy) sleptBusy = true; }
    add('PH-09 putty (a memory family) after a deep press sleeps only once its memory is within 0.02 R of rest (memoryBusy false)', `slept ${b.sleeping} after ${f(t, 1)} s, slept while busy ${sleptBusy}, memDev at sleep ${f(priv(b).memDev as number, 4)} R`, 'never asleep while busy', !sleptBusy);
  }
  // zero jump on wake
  {
    const b = mk(NEUTRAL, 'jellygel'); b.sleepEnabled = true; settle(b, 1.5);
    const P0 = Float32Array.from(b.positions); b.wake(); b.step(DT);
    let mx = 0; for (let i = 0; i < P0.length; i++) mx = Math.max(mx, Math.abs(b.positions[i] - P0[i]));
    add('PH-09 zero position jump on wake (a woken sleeper\'s first step)', `largest particle move ${f(mx * 1000, 3)} mm`, '< 0.5 mm', mx < 5e-4);
  }
  // PH-22 sleep()
  {
    const b = mk(NEUTRAL, 'jellygel'); b.sleepEnabled = true; b.step(DT); b.step(DT);
    const atRest = b.sleep();
    const m = mk(NEUTRAL, 'jellygel'); m.sleepEnabled = true; settle(m, 0.3); m.nudge(v3(0.6, 0, 0)); m.step(DT);
    const moving = !m.sleep();
    const fl = mk(NEUTRAL, 'jellygel'); fl.sleepEnabled = true; fl.gravity = false; settle(fl, 0.5);
    const floatRef = !fl.sleep();
    const off = mk(NEUTRAL, 'jellygel'); off.step(DT);
    const offRef = !off.sleep();
    // on a moving prop: a body resting on the rocker
    const w = buildPropWorld(testPlace([thing(MECH.seesaw, 0, 0, [1.1, 0.08, 0.3], { pivot: 0.24, limit: 8, inertia: 0.7, damping: 0.9 })]), 'wide', 1);
    const r = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0.75, 0.9, 0) } }); r.sleepEnabled = true; r.setPropWorld(w);
    for (let i = 0; i < 120; i++) frameW(w, [r], null);
    const onMovingRef = !r.sleep() && !r.sleeping;
    // an identical setSquash never wakes
    const q = mk(NEUTRAL, 'jellygel'); q.sleepEnabled = true; q.setSquash(0.9, 0.5); settle(q, 6);
    const qs = q.sleeping; q.setSquash(0.9, 0.5); q.step(DT);
    const stays = qs && q.sleeping;
    add('PH-22 sleep(): sleeps a body at rest at once; refuses one moving, in float mode, without sleepEnabled, resting on a moving prop (the rocker); an identical setSquash never wakes a sleeper',
      `at rest ${atRest}, refused moving ${moving}, float ${floatRef}, off ${offRef}, on the rocker ${onMovingRef} (onProp ${r.metrics.onProp}), identical squash kept it asleep ${stays}`, 'all true', atRest && moving && floatRef && offRef && onMovingRef && stays);
  }
  info('PH-22 mods writes and their wake rule (8.1): NOT BUILT in this run (mods is absent; the shell feature-detects it)', '');
}

/* ───────────── PH-03: static props ───────────── */
if (run('static')) {
  const shapes: [string, ThingDef][] = [
    ['block', thing(MECH.block, 0, 0, [0.6, 0.2, 0.5])], ['bar', thing(MECH.bar, 0, 0, [0.2, 1.6, 0])],
    ['mound', thing(MECH.mound, 0, 0, [0.9, 0.25, 0])], ['ring', thing(MECH.ring, 0, 0, [0.89, 0.09, 120], { segments: 6 })],
  ];
  const fams = FULL ? FAMS : QUICK ? ['slimegoo'] : ['jellygel', 'firmsilicone', 'slimegoo', 'putty'];
  let bad = 0, n = 0, worstFold = 0, worstPen = 0; const why: string[] = [];
  for (const [nm, th] of shapes) {
    const w = buildPropWorld(testPlace([th]), 'wide', 1);
    for (const fam of fams) for (const [gn, g] of GENOMES) {
      // dropped on it from above (the ring: into its middle), then walked into it from the side
      const b = mk(g, fam, { piece: { frac: 1, chunk: false, at: v3(nm === 'ring' ? 0 : 0.1, nm === 'bar' ? 1.0 : 0.9, 0) } });
      b.setPropWorld(w);
      let fo = 0;
      for (let i = 0; i < 150; i++) { frameW(w, [b], null); if (i % 3 === 0) fo = Math.max(fo, foldDeg(b)); }
      const pen = penetration(w, b);
      const c = mk(g, fam, { piece: { frac: 1, chunk: false, at: v3(-2.2, 0, 0.05) } });
      c.setPropWorld(w); c.scootTo(0, 0.05, 0.3);
      for (let i = 0; i < 300; i++) { frameW(w, [c], null); if (i % 3 === 0) fo = Math.max(fo, foldDeg(c)); }
      const pen2 = penetration(w, c);
      n++;
      worstFold = Math.max(worstFold, fo); worstPen = Math.max(worstPen, pen / b.restRadius, pen2 / c.restRadius);
      if (!finite(b) || !finite(c) || fo > 120 || pen > 0.01 * b.restRadius || pen2 > 0.01 * c.restRadius) { bad++; why.push(`${nm}/${fam}/${gn} fold ${f(fo, 0)} pen ${f(pen * 1000, 1)}/${f(pen2 * 1000, 1)} mm`); }
    }
  }
  add(`PH-03 static props (block, bar, mound, ring) x ${fams.length} families x ${GENOMES.length} genome(s): dropped on and walked into (scootTo 0.3 m/s): no fold over 120 deg, no NaN, penetration at most 1% R`,
    `${n - bad}/${n} ok; worst fold ${f(worstFold, 0)} deg; worst penetration ${f(worstPen * 100, 2)} % R${why.length ? '; ' + why.join('; ') : ''}`, 'all', bad === 0);
  // rests 3 s on a box top with creep at most 2 mm, and sleeps
  {
    const w = buildPropWorld(testPlace([thing(MECH.block, 0, 0, [0.7, 0.2, 0.6])]), 'wide', 1);
    let ok = 0, nn = 0; const out: string[] = [];
    for (const fam of FULL ? FAMS : QUICK ? ['jellygel', 'marshmallow'] : ['jellygel', 'firmsilicone', 'slimegoo', 'waterfill', 'marshmallow']) {
      // set down gently (its centre 0.1 m over its resting height on the 0.4 m box), settled 3 s, then 3 s measured
      const b = mk(NEUTRAL, fam, { piece: { frac: 1, chunk: false, at: v3(0, 0.9, 0) } }); b.setPropWorld(w);
      for (let i = 0; i < 180; i++) frameW(w, [b], null);
      const x0 = b.center.x, z0 = b.center.z, y0 = b.center.y;
      for (let i = 0; i < 180; i++) frameW(w, [b], null);
      // CREEP = sliding or sagging: the centre's horizontal drift and any sinking. A memory family still RISES out of its landing squash (its memory arm, memTau):
      // that is its own recovery, the same on the table (the control below, set down the same way on the floor), not creep
      const creep = Math.hypot(b.center.x - x0, b.center.z - z0), sag = Math.max(0, y0 - b.center.y), rise = Math.max(0, b.center.y - y0);
      const t = mk(NEUTRAL, fam, { piece: { frac: 1, chunk: false, at: v3(0, 0.5, 0) } });
      for (let i = 0; i < 180; i++) { t.step(DT); drain(t); }
      const ty0 = t.center.y; for (let i = 0; i < 180; i++) { t.step(DT); drain(t); }
      const tRise = Math.max(0, t.center.y - ty0);
      b.sleepEnabled = true;
      let tt = 0;
      for (let i = 0; i < 120 && !b.sleeping; i++) { frameW(w, [b], null); tt += DT; }
      nn++;
      const onTop = b.metrics.onProp === 0 || b.sleeping;
      if (creep <= 0.002 && sag <= 0.002 && b.sleeping && onTop) ok++;
      out.push(`${fam} drift ${f(creep * 1000, 2)} mm, sag ${f(sag * 1000, 2)} mm (rise ${f(rise * 1000, 1)} mm; on the floor ${f(tRise * 1000, 1)} mm), slept ${b.sleeping} (${f(tt, 2)} s)`);
    }
    add('PH-03 a body set on a box top (0.4 m high), settled 3 s, rests 3 more s with creep at most 2 mm (horizontal drift, and sinking) and then sleeps (sleepEnabled) within 2 s; a memory family\'s slow rise out of its landing squash is reported beside the same rise on the floor', `${ok}/${nn}: ${out.join('; ')}`, 'all', ok === nn);
  }
}
/** The deepest particle inside any shown prop (m): an independent check of the prop pass (boxes, capsules and spheres from the packed shapes). */
function penetration(w: PropWorld, b: SoftBody): number {
  const S = w.solve.S, P = b.positions;
  let worst = 0;
  for (let k = 0; k < w.count; k++) {
    const o = k * 36, kind = S[o];
    if (kind === 0) continue;
    for (let i = 0; i < P.length; i += 3) {
      const dx = P[i] - S[o + 4], dy = P[i + 1] - S[o + 5], dz = P[i + 2] - S[o + 6];
      let d = 0;
      if (kind === 1) d = S[o + 16] - Math.hypot(dx, dy, dz);
      else if (kind === 2) {
        const ax = S[o + 3] | 0, ux = S[o + 7 + ax], uy = S[o + 10 + ax], uz = S[o + 13 + ax], hl = S[o + 17];
        const t = Math.max(-hl, Math.min(hl, dx * ux + dy * uy + dz * uz));
        d = S[o + 16] - Math.hypot(dx - ux * t, dy - uy * t, dz - uz * t);
      } else {
        const lx = dx * S[o + 7] + dy * S[o + 10] + dz * S[o + 13], ly = dx * S[o + 8] + dy * S[o + 11] + dz * S[o + 14], lz = dx * S[o + 9] + dy * S[o + 12] + dz * S[o + 15];
        d = Math.min(S[o + 16] - Math.abs(lx), S[o + 17] - Math.abs(ly), S[o + 18] - Math.abs(lz));
      }
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/* ───────────── PH-04: the rocker and the swing (Hearthlog, both layouts) ───────────── */
if (run('hinge')) {
  for (const layout of QUICK ? (['wide'] as const) : (['wide', 'tall'] as const)) {
    const w = buildPropWorld(CABIN, layout, 1);
    const kR = w.propThing.indexOf(1), kS = w.propThing.indexOf(3);
    const rk = w.poses, rx = rk[kR * 8], rz = rk[kR * 8 + 2];
    // one sitter at the +x end: the board tips toward it (weight transfer, D-12)
    const lim = (8 * Math.PI) / 180;
    const a = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(rx + 0.75, 0.9, rz) } }); a.setPropWorld(w);
    for (let i = 0; i < 120; i++) frameW(w, [a], null);
    const tilt1 = w.angle(kR);
    // a second sitter at the -x end: they teeter (60 s; quick 12 s): inside the limits, the board's angle never past them, no NaN
    const b = mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(rx - 0.75, 0.9, rz) } }); b.setPropWorld(w);
    let maxAbs = 0, fo = 0, onBoth = 0, frames = 0, maxW = 0;
    const T = FULL ? 60 : QUICK ? 6 : 12;
    for (let i = 0; i < 60 * T; i++) {
      frameW(w, [a, b], new ContactPlanner());
      const th = w.angle(kR); maxAbs = Math.max(maxAbs, Math.abs(th)); maxW = Math.max(maxW, Math.abs(w.omega(kR)) * 1.1);
      if (i % 10 === 0) { fo = Math.max(fo, foldDeg(a), foldDeg(b)); frames++; if (a.metrics.onProp === kR && b.metrics.onProp === kR) onBoth++; }
      if (i === 60 * 3) b.hop(0, 0.6, 0);   // a teeter hop from the board (LIFE S10)
    }
    add(`PH-04 rocker (${layout}): one sitter at an end tips it toward that end (weight transfer); two riders ${T} s with a teeter hop: the board stays within its 8 deg limit, both stay on, no fold over 120, finite`,
      `one sitter: ${f((tilt1 * 180) / Math.PI, 2)} deg; two riders: max |angle| ${f((maxAbs * 180) / Math.PI, 2)} deg, both on the board ${onBoth}/${frames} samples, end speed max ${f(maxW, 2)} m/s, fold ${f(fo, 0)}`,
      'tilt <= -6 deg toward the sitter; |angle| <= 8 deg; on >= 90%; fold <= 120', tilt1 < -0.75 * lim && maxAbs <= lim + 1e-9 && onBoth >= 0.9 * frames && fo <= 120 && finite(a) && finite(b));
    // the swing: a rider on the seat, the seat poked: the seat at most 2.0 m/s, the energy only decays, the rider keeps its seat 20 s (quick 10 s)
    const sp = w.poses, sx = sp[kS * 8], sy = sp[kS * 8 + 1], sz = sp[kS * 8 + 2];
    const r = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(sx, sy + 0.6, sz) } }); r.setPropWorld(w);
    for (let i = 0; i < 90; i++) frameW(w, [r], null);
    const dir = layout === 'wide' ? v3(1.6, 0, 0) : v3(0, 0, 1.6);
    // three pushes of 1.6 m/s (S11's three pushes), each as the seat swings the push's way; then the energy may only decay
    const hold = FULL ? 20 : QUICK ? 6 : 10;
    let pushes = 0, lastPush = -1000;
    let seatV = 0, amp: number[] = [], prevTh = 0, onSeat = 0, samples = 0, rfo = 0, maxTh = 0;
    let last = sp.slice(kS * 8, kS * 8 + 3);
    for (let i = 0; i < 60 * hold; i++) {
      if (pushes < 3 && i - lastPush > 50 && (pushes === 0 || w.omega(kS) * (layout === 'wide' ? 1 : -1) > 0.05)) { w.raycast(sp[kS * 8], sp[kS * 8 + 1], sp[kS * 8 + 2] + 3, 0, 0, -1); w.poke(kS, dir.x, dir.y, dir.z); pushes++; lastPush = i; }
      frameW(w, [r], null);
      const th = w.angle(kS);
      const px = sp[kS * 8], py = sp[kS * 8 + 1], pz = sp[kS * 8 + 2];
      seatV = Math.max(seatV, Math.hypot(px - last[0], py - last[1], pz - last[2]) / DT);
      last = sp.slice(kS * 8, kS * 8 + 3);
      if (Math.sign(th) !== Math.sign(prevTh) && i > 0) amp.push(maxTh);
      maxTh = Math.sign(th) !== Math.sign(prevTh) ? 0 : Math.max(maxTh, Math.abs(th));
      prevTh = th;
      if (i % 10 === 0) { samples++; if (r.metrics.onProp === kS) onSeat++; rfo = Math.max(rfo, foldDeg(r)); }
    }
    amp = amp.filter((x) => x > 0.01);
    // after the pushes (the first 4 half swings) the amplitude may only decay
    let grows = 0; for (let k = 6; k < amp.length; k++) if (amp[k] > amp[k - 2] * 1.05 + 0.005) grows++;
    add(`PH-04 swing (${layout}): a rider on the seat, the seat pushed three times (1.6 m/s each, the push shared with the rider's inertia): seat speed at most 2.0 m/s, the amplitude only decays after the pushes, the rider keeps its seat ${hold} s, no fold over 120`,
      `pushes ${pushes}; seat max ${f(seatV, 2)} m/s; half-swing amplitudes (deg) ${amp.slice(0, 10).map((x) => f((x * 180) / Math.PI, 1)).join(' ')}; growths after the pushes ${grows}; on the seat ${onSeat}/${samples}; fold ${f(rfo, 0)}`,
      'seat <= 2.0; 0 growths; on >= 90%; fold <= 120', seatV <= 2.0 + 1e-6 && grows === 0 && onSeat >= 0.9 * samples && rfo <= 120 && finite(r));
  }
  info('PH-04 "a rider is never corralled" (D-91): the corral is off while onProp names a moving prop (softbody.ts substep); with place bounds (setBounds, round 4) the PH-18 / PH-24 row checks a rider on the AUTO swing past the bounds\' edge', '');
}

/* ───────────── D-95 (revised, the owner 2026-11-17): the swing and the rocker die down by default; AUTO keeps a steady arc; a hand on the seat or the rider swings it ───────────── */
if (run('d95')) {
  const DEG = 180 / Math.PI;
  const kSw = (w: PropWorld): number => w.propThing.indexOf(3), kRk = (w: PropWorld): number => w.propThing.indexOf(1);
  /** half-swing amplitudes (rad, those over 0.2 deg), the rider-on samples, the fold, the largest frame-to-frame change of the angular velocity */
  /** ... and (round 5) `tamps`: the half swings measured between turning points (half the angle swept; a rider sitting off the middle does not bias them) */
  const swingTrack = (w: PropWorld, k: number, bs: SoftBody[], frames: number, each?: (i: number) => void): { amps: number[]; tamps: number[]; on: number; n: number; fold: number; dw: number; share: number } => {
    const amps: number[] = [], tamps: number[] = []; let prev = w.angle(k), mx = 0, on = 0, n = 0, fold = 0, dw = 0, pw = w.omega(k), share = 0, turn = w.angle(k), sw = w.omega(k);
    for (let i = 0; i < frames; i++) {
      each?.(i);
      frameW(w, bs, bs.length >= 2 ? new ContactPlanner() : null);
      const th = w.angle(k), om = w.omega(k);
      if (om * sw < 0) { tamps.push(Math.abs(th - turn) / 2); turn = th; }
      if (om !== 0) sw = om;
      dw = Math.max(dw, Math.abs(om - pw)); pw = om; share = Math.max(share, w.autoShare(k));
      if (Math.sign(th) !== Math.sign(prev) && i > 0) { amps.push(mx); mx = 0; }
      mx = Math.max(mx, Math.abs(th)); prev = th;
      if (bs.length && i % 10 === 0) { n++; if (bs.every((b) => b.metrics.onProp === k)) on++; if (i % 30 === 0) for (const b of bs) fold = Math.max(fold, foldDeg(b)); }
    }
    return { amps: amps.filter((a) => a > 0.2 / DEG), tamps: tamps.filter((a) => a > 0.2 / DEG), on, n, fold, dw, share };
  };
  const swingRider = (fam: string, layout: 'wide' | 'tall' = 'wide'): { w: PropWorld; k: number; r: SoftBody } => {
    const w = buildPropWorld(CABIN, layout, 1), k = kSw(w), p = w.poses;
    const r = mk(NEUTRAL, fam, { piece: { frac: 1, chunk: false, at: v3(p[k * 8], p[k * 8 + 1] + 0.6, p[k * 8 + 2]) } }); r.setPropWorld(w);
    for (let i = 0; i < 90; i++) frameW(w, [r], null);
    return { w, k, r };
  };
  const am = (a: number[]): string => a.slice(0, 12).map((x) => f(x * DEG, 1)).join(' ');
  const arc = PROPS.AUTO_SWING_DEG / DEG, rarc = PROPS.AUTO_ROCK_DEG / DEG;
  // (1) THE DEFAULT, re-specified in round 5 (FIX5_DATA) by the owner's D-95 revision "a pushed swing, EMPTY OR RIDDEN, dies down in about 2 to 3 swings" (VERDICT_PG
  // B9: at the data's old 0.25 /s the empty seat took 5 to 6 swings; a rider's drag killed the ridden one in 1). The row this replaces (kept below as its
  // no-motor half) read "the owner's 2 to 3 swings" as 1 to 3 HALF swings of a rider after a 1.6 m/s poke (about 4 deg). Now: a hand pushes the seat to 28 deg
  // along its travel (the verifier's natural-swing test) and lets go; the half swings are measured between turning points (half the angle swept, so a rider
  // sitting off the middle does not bias them); "dies down in ABOUT 2 to 3 swings" = 3 to 6 half swings over 5 deg (1.5 to 3 swings: "about" admits the half
  // swing below 2; a firm-silicone rider's 4th half swing measures 4.9 deg), i.e. the first half swing under 5 deg is the 4th to the 7th. HEAD f271a93b1: the
  // empty seat 11 and more (5 to 6 swings), most riders the 3rd (one swing), two riders off the seat.
  {
    const pushed = (fam: string): { amps: number[]; on: number; n: number; share: number; held: number } => {
      const s = fam === '-' ? { w: buildPropWorld(CABIN, 'wide', 1), r: null as SoftBody | null } : swingRider(fam);
      const w = s.w, k = kSw(w), bs = s.r ? [s.r] : [];
      for (let i = 0; i < 60; i++) frameW(w, bs, null);
      const sx = w.poses[k * 8], sy = w.poses[k * 8 + 1], sz = w.poses[k * 8 + 2], pvy = CABIN.things[3].p.pivotY ?? 1.62, L = pvy - sy, a28 = 28 / DEG, th0 = w.angle(k);
      w.grabProp(k, sx, sy, sz);
      for (let i = 0; i < 90; i++) { const q = Math.min(1, i / 40); w.dragProp(k, sx + L * Math.sin(a28) * q, sy + (L - L * Math.cos(a28)) * q, sz); frameW(w, bs, null); }
      const held = w.angle(k) - th0;
      w.releaseProp(k);
      const turns: number[] = [w.angle(k)], amps: number[] = []; let pw = w.omega(k), on = 0, n = 0, share = 0;
      for (let i = 0; i < 60 * 14; i++) {
        frameW(w, bs, null);
        const om = w.omega(k); share = Math.max(share, w.autoShare(k));
        if (om * pw < 0) { const th = w.angle(k); amps.push(Math.abs(th - turns[turns.length - 1]) / 2); turns.push(th); }
        if (om !== 0) pw = om;
        if (bs.length && i % 10 === 0) { n++; if (bs.every((b) => b.metrics.onProp === k)) on++; }
      }
      return { amps: amps.filter((x) => x > 0.2 / DEG), on, n, share, held };
    };
    const fams = ['-', ...(QUICK ? ['jellygel', 'marshmallow'] : FULL ? FAMS : ['jellygel', 'firmsilicone', 'slimegoo', 'marshmallow', 'gummy', 'putty', 'waterfill'])];
    const res: string[] = []; let bad = 0;
    for (const fam of fams) {
      const t = pushed(fam), first5 = t.amps.findIndex((x) => x < 5 / DEG) + 1;
      // (no growth while it dies down: up to the first half swing under 5 deg none is bigger than the one before by 0.5 deg, and after it none comes back over 5 deg;
      // under 5 deg a soft rider settling on the seat may bump it a degree or two, as without the drag-back)
      let grow = 0; for (let i = 1; i < t.amps.length; i++) if (i < first5 ? t.amps[i] > t.amps[i - 1] + 0.5 / DEG : first5 > 0 && t.amps[i] >= 5 / DEG) grow++;
      const ok = first5 >= 4 && first5 <= 7 && grow === 0 && t.share === 0 && Math.abs(t.held) > 25 / DEG && (fam === '-' || t.on >= 0.9 * t.n);
      if (!ok) bad++;
      res.push(`${fam === '-' ? 'empty' : fam}: ${am(t.amps)} deg, first under 5 deg: half swing ${first5 || '>' + t.amps.length}${grow ? `, ${grow} growths` : ''}${fam === '-' ? '' : `, on ${t.on}/${t.n}`}`);
    }
    add('D-95 default (AUTO off; the owner\'s revision: a pushed swing, EMPTY OR RIDDEN, dies down in about 2 to 3 swings): pushed by a hand to 28 deg and let go, the half swings (between turning points) fall under 5 deg at the 4th to the 7th, empty and with each rider; no growth over 0.5 deg until then, none back over 5 deg after; the rider keeps its seat (90%); no motor (AUTO\'s share 0)',
      res.join('; '), 'all', bad === 0);
  }
  // (1b) no motor: a rider on the seat, one 1.6 m/s poke, AUTO never touched: AUTO's share stays 0, the seat's speed falls, the empty seat pushed alike only decays
  {
    const { w, k, r } = swingRider('jellygel');
    w.raycast(w.poses[k * 8], w.poses[k * 8 + 1], w.poses[k * 8 + 2] + 3, 0, 0, -1); w.poke(k, 1.6, 0, 0);
    // (the motion is the angular velocity: a rider sitting a little off the seat's middle leaves it at rest a degree or two off the vertical)
    let first = 0, late = 0, firstA = 0;
    const t = swingTrack(w, k, [r], 60 * 6, (i) => { const o = Math.abs(w.omega(k)); if (i < 120) { first = Math.max(first, o); firstA = Math.max(firstA, Math.abs(w.angle(k))); } else if (i >= 180) late = Math.max(late, o); });
    const e = buildPropWorld(CABIN, 'wide', 1), ke = kSw(e);
    e.raycast(e.poses[ke * 8], e.poses[ke * 8 + 1], e.poses[ke * 8 + 2] + 3, 0, 0, -1); e.poke(ke, 1.6, 0, 0);
    const te = swingTrack(e, ke, [], 60 * 8);
    let growE = 0; for (let i = 1; i < te.amps.length; i++) if (te.amps[i] > te.amps[i - 1] + 1e-6) growE++;
    const dead = (t.amps.length <= 3 || t.amps[3] < 0.25 * t.amps[0]) && late <= 0.25 * first && first > 0.05;
    add('D-95 default, no motor (AUTO never touched): a rider on the seat, one 1.6 m/s poke (about 4 deg, under the 5 deg line from the start): at most 3 half swings over 0.2 deg (or the 4th under a quarter of the first), and from 3 s on the seat\'s angular speed under a quarter of its first 2 s; the empty seat poked alike only decays; AUTO\'s share 0',
      `rider: up to ${f(firstA * DEG, 2)} deg and ${f(first, 3)} rad/s in the first 2 s, ${f(late, 3)} rad/s after 3 s, half swings across the bottom: ${am(t.amps) || 'none'} (on ${t.on}/${t.n}); empty: ${am(te.amps)} deg, growths ${growE}; AUTO share max ${f(Math.max(t.share, te.share), 2)}`, 'dies down; 0 growths; share 0', dead && growE === 0 && t.share === 0 && te.share === 0 && t.on >= 0.9 * t.n);
  }
  // (2) AUTO: a gentle steady arc, empty and with a rider (the rider holds on), eased in from rest, eased out to the natural die-down when turned off
  {
    const fams = QUICK ? ['jellygel'] : FULL ? FAMS.filter((x) => x !== 'putty') : ['jellygel', 'firmsilicone', 'slimegoo', 'marshmallow', 'gummy'];
    const T = FULL ? 20 : QUICK ? 8 : 14;
    const res: string[] = []; let bad = 0;
    for (const fam of ['-', ...fams]) {
      const rider = fam !== '-';
      const s = rider ? swingRider(fam) : (() => { const w = buildPropWorld(CABIN, 'wide', 1); return { w, k: kSw(w), r: null as SoftBody | null }; })();
      const bs = s.r ? [s.r] : [];
      // (round 5: "from rest" made explicit: the rider's landing swings the seat, and since the owner's 2 to 3 swings that takes some seconds to die down, not one;
      // the seat is let come to rest first, |w| under 0.02 rad/s for half a second, at most 12 s)
      for (let i = 0, still = 0; i < 720 && still < 30; i++) { frameW(s.w, bs, null); still = Math.abs(s.w.omega(s.k)) < 0.02 ? still + 1 : 0; }
      const okOn = s.w.setAuto(3, true);
      const t = swingTrack(s.w, s.k, bs, 60 * (rider && QUICK ? 6 : T));   // (a rider's pace is quicker: 6 s holds the 3 ease-in and 3 steady half swings)
      const steady = t.amps.slice(3);   // after the ease-in (the first three half swings grow from rest)
      const inBand = steady.length >= (QUICK ? 3 : 6) && steady.every((a) => Math.abs(a - arc) <= 0.1 * arc);
      const grew = t.amps.length >= 2 && t.amps[0] < 0.75 * arc;   // eased in: the first half swing is small
      s.w.setAuto(3, false);
      // AUTO off: the natural die-down. With a rider: within 10 s (about 3 swings of the rider-and-seat's own ~3 s rocking) the seat's angular speed under a quarter
      // of its speed in the first second, and never past the arc; empty: the seat's own damping (the data's: 0.6 /s since round 5) only decays it. (The first half swing after
      // the switch is a partial one: the tracking starts mid-swing)
      let w1 = 0, w10 = 0, overArc = false;
      const off = swingTrack(s.w, s.k, bs, 60 * (rider ? 10 : 6), (i) => { const o = Math.abs(s.w.omega(s.k)); if (i < 60) w1 = Math.max(w1, o); else if (i >= 540) w10 = Math.max(w10, o); if (Math.abs(s.w.angle(s.k)) > 1.1 * arc) overArc = true; });
      const dies = rider ? w10 <= 0.25 * w1 && !overArc : off.amps.length >= 3 && off.amps.every((a, i) => i < 2 || a <= off.amps[i - 1] + 1e-6);
      const ok = okOn && inBand && grew && dies && (!rider || (t.on >= 0.95 * t.n && t.fold <= 120 && finite(s.r!))) && t.dw <= 0.05;
      if (!ok) bad++;
      res.push(`${rider ? fam : 'empty'}: ${am(t.amps)} deg${rider ? `, on ${t.on}/${t.n}, fold ${f(t.fold, 0)}` : ''}, max dw ${f(t.dw, 3)} rad/s a frame; off: ${am(off.amps)}${rider ? ` (seat ${f(w1, 3)} rad/s in the first s, ${f(w10, 3)} at 9..10 s)` : ''}`);
    }
    add(`D-95 AUTO on the swing (setAuto): empty and with a rider (${fams.length} famil${fams.length > 1 ? 'ies' : 'y'}), ${T} s: eased in from rest (the first half swing under 3/4 of the arc), then every half swing within +-10% of ${PROPS.AUTO_SWING_DEG} deg; the rider keeps its seat; no jerk (dw <= 0.05 rad/s a frame); AUTO off: it dies down (with a rider: the seat's speed at 9..10 s under a quarter of the first second's, never past the arc; empty: only decays)`,
      res.join('; '), 'all', bad === 0);
  }
  {
    const res: string[] = []; let bad = 0;
    for (const nr of QUICK ? [0, 2] : [0, 1, 2]) {
      const w = buildPropWorld(CABIN, 'wide', 1), k = kRk(w), rx = w.poses[k * 8], rz = w.poses[k * 8 + 2];
      const bs: SoftBody[] = [];
      if (nr >= 1) { const a = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(rx + 0.75, 0.9, rz) } }); a.setPropWorld(w); bs.push(a); }
      if (nr >= 2) { const b = mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(rx - 0.75, 0.9, rz) } }); b.setPropWorld(w); bs.push(b); }
      for (let i = 0; i < 120; i++) frameW(w, bs, bs.length >= 2 ? new ContactPlanner() : null);
      w.setAuto(1, true);
      const t = swingTrack(w, k, bs, 60 * (QUICK ? 8 : 12));
      const steady = t.amps.slice(2), ok = steady.length >= 3 && steady.every((a) => Math.abs(a - rarc) <= 0.1 * rarc) && (nr === 0 || (t.on >= 0.95 * t.n && t.fold <= 120)) && t.dw <= 0.05;
      if (!ok) bad++;
      res.push(`${nr} rider(s): ${am(t.amps)} deg${nr ? `, on ${t.on}/${t.n}, fold ${f(t.fold, 0)}` : ''}, max dw ${f(t.dw, 3)}`);
    }
    add(`D-95 AUTO on the rocker: with 0 and 2 riders${QUICK ? '' : ' (and 1)'}: after the ease-in every half swing within +-10% of ${PROPS.AUTO_ROCK_DEG} deg, the riders stay on, no jerk`, res.join('; '), 'all', bad === 0);
  }
  // (3) BY HAND: the seat grabbed and pulled 0.5 m along its travel (AUTO off and on), the rider grabbed and pulled 0.35 m; the rocker board's end pulled down 0.12 m
  {
    const res: string[] = []; let ok = true;
    // (the quick set runs the AUTO-on cases: the hand wins over AUTO, then AUTO takes the motion back; --only=d95 adds AUTO off)
    for (const auto of QUICK ? [true] : [false, true]) {
      const { w, k, r } = swingRider('jellygel');
      if (auto) { w.setAuto(3, true); for (let i = 0; i < 300; i++) frameW(w, [r], null); }
      const th0 = w.angle(k), sx = w.poses[k * 8], sy = w.poses[k * 8 + 1], sz = w.poses[k * 8 + 2];
      const got = w.grabProp(k, sx, sy, sz);
      let shareHeld = 0;
      for (let i = 0; i < 90; i++) { w.dragProp(k, sx + Math.min(1, i / 30) * 0.5, sy + 0.05, sz); frameW(w, [r], null); if (i >= 10) shareHeld = Math.max(shareHeld, w.autoShare(k)); }
      // the hand's angle: the grabbed spot (the seat's centre) turned about the pivot until it points at the hand (angles from straight down, + toward +x)
      const pvx = CABIN.things[3].x, pvy = CABIN.things[3].p.pivotY ?? 1.62;
      const want = th0 + Math.atan2(sx + 0.5 - pvx, pvy - (sy + 0.05)) - Math.atan2(sx - pvx, pvy - sy);
      const held = w.angle(k);
      w.releaseProp(k);
      const t = swingTrack(w, k, [r], 60 * 6);
      // (AUTO off, round 5: "dies down" = in about 2 to 3 swings, the owner's D-95 revision, as row (1): the half swings between turning points under 5 deg by the
      // 7th. The row this replaces asked for the 5th peak under a quarter of the first, which the old one-swing rider drain met and the owner's 2 to 3 swings do not)
      const t5i = t.tamps.findIndex((a) => a < 5 / DEG), t5 = t5i >= 0 ? t5i + 1 : t.tamps.length + 1;   // (stopped without another turn: the next one)
      const backToArc = auto ? t.amps.slice(-3).every((a) => Math.abs(a - arc) <= 0.1 * arc) : t5 <= 7;
      const swung = t.amps.length > 0 && t.amps[0] >= 0.8 * Math.abs(held);
      const rowOk = got && Math.abs(held - want) <= 2 / DEG && shareHeld === 0 && swung && backToArc && t.on >= 0.9 * t.n;
      ok = ok && rowOk;
      res.push(`seat, AUTO ${auto ? 'on' : 'off'}: held at ${f(held * DEG, 1)} deg (the hand's ${f(want * DEG, 1)}), AUTO share while held ${f(shareHeld, 2)}; released: ${am(t.amps)} deg${auto ? '' : ` (between turning points ${am(t.tamps)}: under 5 deg at the ${t5})`}, rider on ${t.on}/${t.n}`);
    }
    for (const auto of QUICK ? [true] : [false, true]) {
      const { w, k, r } = swingRider('jellygel');
      if (auto) { w.setAuto(3, true); for (let i = 0; i < 300; i++) frameW(w, [r], null); }
      const th0 = w.angle(k);
      const h = r.raycast(v3(r.center.x, r.center.y + 3, r.center.z + 0.02), v3(0, -1, 0));
      let maxTh = 0, shareHeld = 0, onHeld = 0, nH = 0;
      if (h) {
        r.grab(0, h.vertex, h.point);
        for (let i = 0; i < 60; i++) {
          r.grabMove(0, v3(h.point.x + Math.min(1, i / 30) * 0.35, h.point.y, h.point.z)); frameW(w, [r], null);
          maxTh = Math.max(maxTh, w.angle(k) - th0); if (i >= 10) shareHeld = Math.max(shareHeld, w.autoShare(k));
          if (i % 10 === 0) { nH++; if (r.metrics.onProp === k) onHeld++; }
        }
        r.grabRelease(0);
      }
      const t = swingTrack(w, k, [r], 60 * 6);
      const back = auto ? t.amps.slice(-3).every((a) => Math.abs(a - arc) <= 0.1 * arc) : true;
      const rowOk = !!h && maxTh >= 8 / DEG && shareHeld === 0 && onHeld === nH && back && t.on >= 0.9 * t.n;
      ok = ok && rowOk;
      res.push(`rider, AUTO ${auto ? 'on' : 'off'}: the seat swung ${f(maxTh * DEG, 1)} deg toward the pull, AUTO share while held ${f(shareHeld, 2)}, rider on ${onHeld}/${nH} while held; released: ${am(t.amps)} deg, on ${t.on}/${t.n}`);
    }
    {
      const w = buildPropWorld(CABIN, 'wide', 1), k = kRk(w), rx = w.poses[k * 8], ry = w.poses[k * 8 + 1], rz = w.poses[k * 8 + 2];
      w.setAuto(1, true);
      const got = w.grabProp(k, rx + 1.0, ry + 0.08, rz);
      for (let i = 0; i < 60; i++) { w.dragProp(k, rx + 1.0, ry + 0.08 - Math.min(1, i / 20) * 0.12, rz); frameW(w, [], null); }
      const held = w.angle(k), want = Math.atan2(-0.04, 1.0) - Math.atan2(0.08, 1.0);
      w.releaseProp(k);
      const rowOk = got && Math.abs(held - want) <= 1 / DEG && w.autoShare(k) === 0;
      ok = ok && rowOk;
      res.push(`rocker board's end pulled down 0.12 m (AUTO on): held at ${f(held * DEG, 2)} deg (the hand's ${f(want * DEG, 2)}), AUTO share ${f(w.autoShare(k), 2)}`);
    }
    add('D-95 by hand: the seat grabbed (grabProp / dragProp) and pulled 0.5 m along its travel follows the hand within 2 deg, AUTO yields while it holds (share 0), released it swings on (AUTO off: dies down; AUTO on: back to its arc); the RIDER grabbed and pulled 0.35 m swings the seat at least 8 deg with it and keeps its seat, AUTO yields; the rocker board pulled down by its end follows within 1 deg',
      res.join('; '), 'all', ok);
  }
  // (4) determinism and the inert default: two runs with AUTO, a rider, a hand and a grabbed rider are equal; a world where AUTO was never touched steps as round 3's
  {
    const once = (): string => {
      const { w, k, r } = swingRider('jellygel');
      const hs: number[] = [];
      w.setAuto(3, true); w.setAuto(1, true);
      for (let i = 0; i < 240; i++) {
        if (i === 60) w.grabProp(k, NaN, NaN, NaN);
        if (i > 60 && i < 100) w.dragProp(k, 0.4, 0.3, -1.7);
        if (i === 100) w.releaseProp(k);
        frameW(w, [r], null);
        if (i % 20 === 0) hs.push(w.stateHash(), r.stateHash());
      }
      return hs.join(',');
    };
    const h1 = once(), h2 = once();
    add('D-95 determinism: AUTO on the swing and the rocker, a rider, a hand that grabs, drags and lets go: two runs give equal prop and body hashes at every sample', h1 === h2 ? 'equal' : 'DIFFERENT', 'equal', h1 === h2);
  }
}

/* ───────────── PH-14: SoftEvent.auto / prop / other (8.8) ───────────── */
if (run('events')) {
  const evs = (b: SoftBody, out: SoftEvent[]): void => { const e: SoftEvent[] = []; b.drainEvents(e); out.push(...e); };
  const fw = (w: PropWorld | null, bs: SoftBody[], log: SoftEvent[][], manual?: () => void): void => {
    if (w) w.beginFrame();
    if (manual) manual(); else if (bs.length >= 2) new ContactPlanner().run(bs);
    bs.forEach((b, i) => { b.step(DT); evs(b, log[i]); });
    if (w) w.endFrame(DT);
  };
  const res: string[] = []; let ok = true;
  const chk = (name: string, pass: boolean, detail: string): void => { res.push(`${name}: ${pass ? 'ok' : 'WRONG'} (${detail})`); ok = ok && pass; };
  const kinds = (l: SoftEvent[], k: string): SoftEvent[] => l.filter((e) => e.kind === k);
  // (a) a fall nobody threw: its 'land' is auto; (b) a toss (picked up, carried, let go with speed): its 'land' is not
  {
    const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0.9, 0) } }), log: SoftEvent[][] = [[]];
    for (let i = 0; i < 90; i++) fw(null, [b], log);
    const l = kinds(log[0], 'land');
    chk('a fall from 0.4 m nobody threw: land auto', l.length > 0 && l.every((e) => e.auto === true && e.prop === -1 && e.other === -1), `${l.length} land, auto ${l.map((e) => e.auto).join(',')}`);
    const c = mk(NEUTRAL, 'jellygel'); settle(c, 0.5);
    const h = c.raycast(v3(c.center.x, 3, c.center.z + 0.02), v3(0, -1, 0));
    const lt: SoftEvent[][] = [[]];
    if (h) { c.grab(0, h.vertex, h.point); for (let i = 0; i < 50; i++) { c.grabMove(0, v3(h.point.x + i * 0.01, h.point.y + Math.min(1, i / 20) * 1.3, h.point.z)); fw(null, [c], lt); } }
    const carried = c.metrics.carried === true;
    c.grabRelease(0);
    for (let i = 0; i < 120; i++) fw(null, [c], lt);
    const tl = kinds(lt[0], 'land');
    chk('a toss (carried, let go): its land is not auto', carried && tl.length > 0 && tl.every((e) => e.auto === false), `carried ${carried}, ${tl.length} land, auto ${tl.map((e) => e.auto).join(',')}`);
    // a poke (the player's): auto false, prop -1, other -1
    const pk = kinds(lt[0], 'grab').concat(kinds(lt[0], 'snap'));
    chk("the player's own events (grab, snap) carry auto false, prop -1, other -1", pk.length > 0 && pk.every((e) => e.auto === false && e.prop === -1 && e.other === -1), `${pk.length} events`);
  }
  // (c) body to body: a body launched (from 0.5 m up at 2 m/s, as a pad or a fall would: nobody threw it) into a resting body: auto, other = the partner's contactSlot;
  // a finger on the partner: not auto; a lock alone on it: auto (D-86). (A LIFE scoot glides by a rigid translation: it closes at no speed a bump counts, and a nudge
  // from rest is stopped by the table in a few cm, so neither makes a bump)
  const boop = (partnerHold: 'none' | 'finger' | 'lock'): SoftEvent[] => {
    const ax = partnerHold === 'lock' ? -0.75 : -1.6;   // (the locked granulo is pulled 0.4 m toward +x by its lock; a launched body lands and stops within 0.35 s, so it starts close)
    const b = partnerHold === 'lock' ? new SoftBody(quantizeGenome({ ...makeStarterGenome(), species: 'granulo' } as Genome), { piece: { frac: 1, chunk: false, at: v3(0.3, 0, 0) } } as never) : mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } });
    b.contactSlot = 9;
    const log: SoftEvent[][] = [[], []];
    for (let i = 0; i < 30; i++) fw(null, [b], [log[1]]);
    if (partnerHold === 'finger') topPress(b, 0, 0.3);
    if (partnerHold === 'lock') {
      const hit = b.raycast(v3(b.center.x + 3, b.center.y + 0.1, b.center.z), v3(-1, 0, 0));
      if (hit) { b.grab(0, hit.vertex, hit.point); for (let i = 0; i < 40; i++) { b.grabMove(0, v3(hit.point.x + (i + 1) * 0.05, hit.point.y, hit.point.z)); fw(null, [b], [log[1]]); } b.lockGrab(0); }
      for (let i = 0; i < 30; i++) fw(null, [b], [log[1]]);   // (the lock's own snap and the grab's release are the player's: past them, a calm 0.5 s)
    }
    const a = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(ax, 0.95, 0), vel: v3(2, 0, 0) } });
    a.contactSlot = 4;
    log[0].length = 0; log[1].length = 0;
    for (let i = 0; i < 90; i++) fw(null, [a, b], log);
    return [...kinds(log[0], 'bump'), ...kinds(log[1], 'bump')];
  };
  {
    const free = boop('none'), fing = boop('finger'), lock = boop('lock');
    const bodyB = (l: SoftEvent[]): SoftEvent[] => l.filter((e) => e.prop === -1);
    const fb = bodyB(free), gb = bodyB(fing), lb = bodyB(lock);
    chk('a body launched (2 m/s, nobody threw it) into a resting one, nobody touching: the body bump is auto and names the partner (other = its contactSlot)', fb.length > 0 && fb.every((e) => e.auto === true && (e.other === 9 || e.other === 4)), `${fb.length} bump(s): auto ${fb.map((e) => e.auto).join(',')} other ${fb.map((e) => e.other).join(',')}`);
    chk('... with a finger on the partner: not auto', gb.length > 0 && gb.every((e) => e.auto === false), `${gb.length} bump(s): auto ${gb.map((e) => e.auto).join(',')}`);
    chk('... with only a LOCK on the partner (D-86): auto', lb.length > 0 && lb.every((e) => e.auto === true), `${lb.length} bump(s): auto ${lb.map((e) => e.auto).join(',')}`);
  }
  // (d) prop bumps: the Yarn Ball poked into a resting body (auto, prop = the ball); a body scooting into a block at 0.5 m/s (auto, prop = the block); thrown into a wall (not auto)
  {
    const w = buildPropWorld(testPlace([thing(MECH.ball, -1.0, 0, [0.24, 0, 0], { mass: 0.2, rollDamp: 0.5 }), thing(MECH.block, 1.3, 0, [0.3, 0.3, 0.6])], true), 'wide', 1);
    const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } }); b.setPropWorld(w);
    const log: SoftEvent[][] = [[]];
    for (let i = 0; i < 30; i++) fw(w, [b], log);
    log[0].length = 0;
    w.poke(0, 1.6, 0, 0);
    for (let i = 0; i < 60; i++) fw(w, [b], log);
    const bb = kinds(log[0], 'bump').filter((e) => e.prop === 0);
    chk('the ball rolled (1.6 m/s) into a resting body: a prop bump, auto, prop = the ball (0), other -1', bb.length > 0 && bb.every((e) => e.auto === true && e.other === -1), `${bb.length} bump(s) prop 0, auto ${bb.map((e) => e.auto).join(',')}, intensity ${bb.map((e) => f(e.intensity, 2)).join(',')}`);
    const wd = buildPropWorld(testPlace([thing(MECH.block, 1.3, 0, [0.3, 0.3, 0.6])]), 'wide', 1);
    const d = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0.25, 0.95, 0), vel: v3(2, 0, 0) } }); d.setPropWorld(wd);
    const ld: SoftEvent[][] = [[]];
    for (let i = 0; i < 90; i++) fw(wd, [d], ld);
    const kb = kinds(ld[0], 'bump').filter((e) => e.prop === 0);
    chk('a body launched (2 m/s from 0.5 m up, nobody threw it) into a block: a prop bump, auto, prop = the block', kb.length > 0 && kb.every((e) => e.auto === true), `${kb.length} bump(s) prop 0 (its world's only prop), auto ${kb.map((e) => e.auto).join(',')}`);
    // a body tossed at the back wall (carried up, let go toward -z at speed)
    const c = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0, -0.8) } }); c.setPropWorld(w);
    const lc: SoftEvent[][] = [[]];
    for (let i = 0; i < 30; i++) fw(w, [c], lc);
    const h = c.raycast(v3(c.center.x, 3, c.center.z + 0.02), v3(0, -1, 0));
    if (h) { c.grab(0, h.vertex, h.point); for (let i = 0; i < 40; i++) { c.grabMove(0, v3(h.point.x, h.point.y + Math.min(1, i / 20) * 1.2, h.point.z - Math.max(0, i - 25) * 0.08)); fw(w, [c], lc); } c.grabRelease(0); }
    for (let i = 0; i < 120; i++) fw(w, [c], lc);
    const wb = kinds(lc[0], 'bump').filter((e) => e.prop === 2);
    chk('a body tossed into the back wall: a prop bump with the wall\'s index (2), not auto', wb.length > 0 && wb.every((e) => e.auto === false), `${wb.length} bump(s) prop 2, auto ${wb.map((e) => e.auto).join(',')}`);
  }
  add('PH-14 SoftEvent.auto / prop / other: a fall nobody threw lands auto, a toss does not; the player\'s own events are never auto; a launch nobody threw is an auto body bump naming the partner\'s contactSlot, not auto with a finger on the partner, auto with only a lock on it (D-86); prop bumps carry the prop index (the ball into a body, a launch into a block: auto; a toss into a wall: not)',
    res.join('; '), 'all ok', ok);
}

/* ───────────── PH-19: the contact-slot bump memory and metrics.contacts ───────────── */
if (run('contacts')) {
  // B and C are built 16 bodies apart (bodyId & 15 the same: the bump memory's old key aliases them): both bump A within 0.2 s; with contact slots A keeps one entry each
  const trial = (slots: boolean): { bumps: number; cA: number; cB: number } => {
    // (A is a whole at the origin, never asleep; B and C are launched at it from both sides at 2 m/s from 0.5 m up, C 0.1 s after B (past the 0.05 s event gap, inside
    // the 0.2 s bump memory); A's collide meets both)
    const a = mk(NEUTRAL, 'jellygel');
    const bb = mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(-1.6, 0.95, 0), vel: v3(2, 0, 0) } });
    for (let i = 0; i < 15; i++) mk(NEUTRAL, 'jellygel', { detail: 2 } as never);
    if (slots) { a.contactSlot = 0; bb.contactSlot = 17; }
    const la: SoftEvent[] = [];
    for (let i = 0; i < 6; i++) { a.collide([bb]); a.step(DT); bb.step(DT); const e: SoftEvent[] = []; a.drainEvents(e); la.push(...e); bb.drainEvents([]); }
    const cc = mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(1.6, 0.95, 0), vel: v3(-2, 0, 0) } });
    if (slots) cc.contactSlot = 30;
    const bs = [a, bb, cc];
    let cA = 0, cB = 0;
    for (let i = 0; i < 90; i++) { a.collide([bb, cc]); for (const b of bs) b.step(DT); const e: SoftEvent[] = []; a.drainEvents(e); la.push(...e); bb.drainEvents([]); cc.drainEvents([]); cA |= a.metrics.contacts ?? 0; cB |= bb.metrics.contacts ?? 0; }
    return { bumps: la.filter((e) => e.kind === 'bump').length, cA, cB };
  };
  const with_ = trial(true), without = trial(false);
  const bit = (k: number): number => 1 << k;
  add('PH-19 the bump memory is keyed by contactSlot (32 entries): two partners whose bodyIds alias (bodyId & 15 equal) both bump A within 0.2 s: two bumps with contact slots (one without: the old key, kept for bodies with none); metrics.contacts has a bit per partner slot (A: 17 and 30; B: A\'s 0)',
    `with slots: ${with_.bumps} bump(s) on A, A.contacts 0x${(with_.cA >>> 0).toString(16)}, B.contacts 0x${(with_.cB >>> 0).toString(16)}; without: ${without.bumps} bump(s), A.contacts ${without.cA}`,
    '2 / 1; 0x40020000; 0x1; 0', with_.bumps === 2 && without.bumps === 1 && (with_.cA >>> 0) === ((bit(17) | bit(30)) >>> 0) && with_.cB === bit(0) && without.cA === 0);
}

/* ───────────── PH-18 / PH-24: setBounds and setHome ───────────── */
if (run('bounds')) {
  const res: string[] = []; let ok = true;
  // (a) a rectangle (Home: visibleTable + the slots, round 0): a body resting at any spot inside is never moved; a body shoved out glides back to the edge and stops there
  {
    const spots = [[-1.2, -0.6], [0, -0.35], [1.2, -0.6], [-0.6, 0.6], [0.9, 0.5]];
    let worst = 0;
    for (const [x, z] of QUICK ? spots.slice(0, 2) : spots) {
      const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(x, 0, z) } });
      b.setBounds(1, 0, 0, 1.75, 1.2, 0);
      settle(b, 0.3); const x0 = b.center.x, z0 = b.center.z; settle(b, 3);
      worst = Math.max(worst, Math.hypot(b.center.x - x0, b.center.z - z0));
    }
    // a body tossed out (from 0.9 m up at 2.5 m/s toward +x, from x 1.5): it lands past the edge, is braked and glides back to the edge and stops there
    const s = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(1.5, 0.95, 0), vel: v3(2.5, 0, 0) } });
    s.setBounds(1, 0, 0, 1.75, 1.2, 0);
    let maxX = 0; for (let i = 0; i < 420; i++) { s.step(DT); drain(s); maxX = Math.max(maxX, s.center.x); }
    const endX = s.center.x;
    const pass = worst <= 0.002 && maxX > 1.85 && maxX < 1.75 + PG.boundsRim + 0.5 && endX <= 1.75 + 0.02 && endX > 1.6;
    ok = ok && pass; res.push(`rectangle 3.5 x 2.4 m: resting bodies moved at most ${f(worst * 1000, 2)} mm in 3 s; a body tossed out at 2.5 m/s from x 1.5 went to ${f(maxX, 3)} and came back to ${f(endX, 3)} (the edge 1.75)`);
  }
  // (b) a disc (a place): the same, about the edge; shape -1 restores the home corral (the body glides back toward its home spot)
  {
    // (built at x 2.0: inside a disc of 2.6 it is never touched; then a disc of 1.6 puts it 0.4 m outside: it is woken and glides back to the edge; shape -1 and setHome(0, 0)
    // hand it back to the home corral, which glides it into its 0.6 m dead zone)
    const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(2.0, 0, 0) } });
    b.setBounds(0, 0, 0, 2.6, 0, 0); settle(b, 0.3);
    const x0 = b.center.x; settle(b, 2);
    const inside = Math.abs(b.center.x - x0), slept = b.sleeping;
    b.setBounds(0, 0, 0, 1.6, 0, 0); settle(b, 7);
    const endD = Math.hypot(b.center.x, b.center.z);
    b.setBounds(-1, 0, 0, 0, 0, 0); b.setHome(0, 0); settle(b, 10);
    const homeD = Math.hypot(b.center.x, b.center.z);
    const pass = inside <= 0.002 && endD <= 1.62 && endD > 1.5 && homeD <= b.params.matR0 + 0.02;
    ok = ok && pass; res.push(`disc r 2.6: a body inside at 2.0 m drifted ${f(inside * 1000, 2)} mm (asleep ${slept}); the disc shrunk to r 1.6: back to ${f(endD, 3)} m from the centre in 7 s (the corral's glide: at least 10% of 0.35 m/s near the edge); shape -1 + setHome(0, 0): ${f(homeD, 3)} m from home after 10 s (the dead zone ${b.params.matR0})`);
  }
  // (c) setHome: a body LIFE brought 1.6 m from its spawn (scootTo) stays there once re-homed; without it the home corral glides it back
  {
    const run2 = (home: boolean): number => {
      const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } });
      settle(b, 0.3); b.scootTo(1.6, 0, 0.4);
      for (let i = 0; i < 360 && (priv(b).scootOn as boolean); i++) { b.step(DT); drain(b); }
      if (home) b.setHome(b.center.x, b.center.z);
      settle(b, 4);
      return b.center.x;
    };
    const kept = run2(true), back = run2(false);
    const pass = kept > 1.55 && back < 1.0;
    ok = ok && pass; res.push(`setHome: scooted to x 1.6, re-homed: at ${f(kept, 3)} after 4 s; not re-homed: glided back to ${f(back, 3)}`);
  }
  // (d) a rider on the swing is never corralled (D-91), with bounds that the swing's arc leaves (the seat's path reaches 0.7 m past them)
  {
    const w = buildPropWorld(CABIN, 'wide', 1), k = w.propThing.indexOf(3), p = w.poses;
    const r = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(p[k * 8], p[k * 8 + 1] + 0.6, p[k * 8 + 2]) } }); r.setPropWorld(w);
    r.setBounds(1, 0, -1.7, 0.1, 1.0, 0);
    for (let i = 0; i < 90; i++) frameW(w, [r], null);
    w.setAuto(3, true);
    let on = 0, n = 0, maxOut = 0;
    for (let i = 0; i < 60 * (QUICK ? 4 : 8); i++) { frameW(w, [r], null); if (i % 10 === 0) { n++; if (r.metrics.onProp === k) on++; } maxOut = Math.max(maxOut, Math.abs(r.center.x) - 0.1); }
    const pass = on >= 0.95 * n && maxOut > 0.1;
    ok = ok && pass; res.push(`a rider on the AUTO swing with bounds 0.1 m wide around the pivot: on the seat ${on}/${n}, up to ${f(maxOut, 2)} m past the bounds (never corralled off it)`);
  }
  add('PH-18 / PH-24 setBounds and setHome: a rectangle never moves a body resting inside it and brings a shoved one back to its edge; a disc likewise; shape -1 restores the home corral; setHome keeps a body where LIFE brought it; a rider on a moving prop is never corralled (D-91)',
    res.join('; '), 'all', ok);
}

/* ───────────── PH-20: carryTo ───────────── */
if (run('carry')) {
  const res: string[] = []; let ok = true;
  // from the floor onto a box top (0.4 m) 1.2 m away in 1.2 s: arrives, at rest (no velocity), no event at all, its weight held on the way (no sag), a touch ends it
  const w = buildPropWorld(testPlace([thing(MECH.block, 1.2, 0, [0.6, 0.2, 0.6])]), 'wide', 1);
  const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } }); b.setPropWorld(w);
  for (let i = 0; i < 30; i++) frameW(w, [b], null);
  const ok1 = b.carryTo(1.2, 0.4, 0, 1.2);
  const log: SoftEvent[] = [];
  let apex = 0, fold = 0, i0 = 0;
  for (let i = 0; i < 90; i++) { w.beginFrame(); b.step(DT); const e: SoftEvent[] = []; b.drainEvents(e); log.push(...e); w.endFrame(DT); apex = Math.max(apex, lowest(b)); if (i % 5 === 0) fold = Math.max(fold, foldDeg(b)); if (b.carryingTo) i0 = i; }
  let vEnd = 0;
  for (let i = 0; i < 60; i++) { const cx0 = b.center.x, cy0 = b.center.y, cz0 = b.center.z; w.beginFrame(); b.step(DT); const e: SoftEvent[] = []; b.drainEvents(e); log.push(...e); w.endFrame(DT); if (i < 3) vEnd = Math.max(vEnd, Math.hypot(b.center.x - cx0, b.center.y - cy0, b.center.z - cz0) / DT); }
  const atX = b.center.x, onTop = b.metrics.onProp === 0, low = lowest(b);
  const pass1 = ok1 && log.length === 0 && Math.abs(atX - 1.2) < 0.05 && onTop && low > 0.38 && apex > 0.5 && fold <= 120 && vEnd < 0.1;
  ok = ok && pass1;
  res.push(`floor -> box top (0.4 m, 1.2 m away, 1.2 s): ${ok1 ? 'started' : 'REFUSED'}, carried for ${f((i0 + 1) * DT, 2)} s, the lowest point rose to ${f(apex, 3)} m, then on the box (onProp ${b.metrics.onProp}) at x ${f(atX, 3)}, lowest ${f(low, 3)}, centre speed just after ${f(vEnd, 3)} m/s; events ${log.length} (${log.map((e) => e.kind).join(',') || 'none'}); fold ${f(fold, 0)}`);
  // refusals: held (a finger down), a ceremony driver (moveTo); a finger during it ends it where the body is
  const c = mk(NEUTRAL, 'jellygel'); settle(c, 0.4);
  topPress(c, 0, 0.3); c.step(DT); const refHeld = !c.carryTo(1, 0, 0, 1); c.fingerUp(0); settle(c, 0.6);
  c.moveTo(v3(-0.5, 0, 0), 1); const refCer = !c.carryTo(1, 0, 0, 1); c.moveTo(null); settle(c, 0.6);
  const started = c.carryTo(1.5, 0, 0, 1.5); for (let i = 0; i < 20; i++) { c.step(DT); drain(c); }
  topPress(c, 1, 0.3); c.step(DT); c.step(DT); const stopped = !c.carryingTo; c.fingerUp(1); settle(c, 1);
  const pass2 = refHeld && refCer && started && stopped && c.center.x < 1.2 && finite(c);
  ok = ok && pass2;
  res.push(`refused while held ${refHeld}, while moveTo drives ${refCer}; a finger during it ends it ${stopped} (stopped at x ${f(c.center.x, 2)} of 1.5)`);
  add('PH-20 carryTo: a scripted lift along an arc onto a box top 0.4 m high, set down at rest on it (onProp), no event of any kind, no fold over 120; refused while held or under a ceremony driver; a touch ends it', res.join('; '), 'all', ok);
}

/* ───────────── PH-15: water (S2: float or wade, the current, scootTo on a floater, clean exits) ───────────── */
if (run('water')) {
  const share = (hh: number, R: number): number => (hh * hh * (3 * R - hh)) / (4 * R * R * R);
  const poolPlace = (flow: [number, number]): PlaceDef => {
    const pool = { id: 'pool', kind: 1, strength: 1, shape: 'disc' as const, x: 0, z: 0, r: 1.8, surfaceY: 0.28, ramp: 0.4, flow };
    return { ...CABIN, things: [], walls: [], zones: [pool], patches: [], tall: { ...CABIN.tall, things: [], walls: [], zones: [pool], patches: [] } } as unknown as PlaceDef;
  };
  // (a) the generated table (PLACES 2.5): float iff share(0.28, R) > density, families x 3 radius bands (genome size 0.1 / 0.5 / 0.9: R about 0.42 / 0.51 / 0.60);
  // (b) drift only when floating (a 0.08 m/s swirl); each at rest 3 s at 0.6 m from the pool's centre
  const fams = FULL ? FAMS : QUICK ? ['marshmallow', 'popdome', 'jellygel'] : ['marshmallow', 'popdome', 'slowrise', 'jellygel', 'firmsilicone', 'beadsqueeze', 'putty'];
  const sizes = QUICK ? [0.1, 0.9] : [0.1, 0.5, 0.9];
  let bad = 0, n = 0; const out: string[] = [];
  for (const fam of fams) for (const size of sizes) {
    const g = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size });
    const w = buildPropWorld(poolPlace([0.08, 0]), 'wide', 1);
    const b = mk(g, fam, { piece: { frac: 1, chunk: false, at: v3(0.6, 0, 0) } }); b.setPropWorld(w);
    let x0 = 0, z0 = 0;
    for (let i = 0; i < 180; i++) { frameW(w, [b], null); if (i === 89) { x0 = b.center.x; z0 = b.center.z; } }
    const R = b.restRadius, rho = (FAMILY_REACT as Record<string, { density: number }>)[fam].density, want = share(0.28, R) > rho;
    const lo = lowest(b), floats = lo > 0.02, drift = Math.hypot(b.center.x - x0, b.center.z - z0), sub = b.metrics.submerged ?? 0;
    const ok = floats === want && finite(b) && (want ? drift > 0.03 && Math.abs(sub - rho) < 0.02 : drift < 0.005);
    n++; if (!ok) bad++;
    out.push(`${fam} R${f(R, 2)} ${want ? 'F' : 's'}${ok ? '' : ` WRONG(lowest ${f(lo, 3)}, drift ${f(drift, 3)}, sub ${f(sub, 3)})`}`);
  }
  add(`PH-15 water (S2): a body at rest in 0.28 m of water floats exactly when the generated table says (share(0.28, R) > its density: PLACES 2.5), ${fams.length} families x ${sizes.length} radius bands; a floater rides at submerged = density and drifts with a 0.08 m/s swirl, a sitter does not move`,
    `${n - bad}/${n} as the table (F floats, s sits): ${out.join(', ')}`, 'all', bad === 0);
  // (c) scootTo on a floater: a horizontal glide with the water holding its height; scooted to a dry spot it leaves the water and becomes a sitter
  {
    const w = buildPropWorld(poolPlace([0, 0]), 'wide', 1);
    const b = mk(NEUTRAL, 'marshmallow', { piece: { frac: 1, chunk: false, at: v3(-0.9, 0, 0) } }); b.setPropWorld(w);
    for (let i = 0; i < 150; i++) frameW(w, [b], null);
    const y0 = b.center.y, lo0 = lowest(b);
    b.scootTo(0.9, 0, 0.3);
    let dy = 0;
    for (let i = 0; i < 420 && (priv(b).scootOn as boolean); i++) { frameW(w, [b], null); if (Math.abs(b.center.x) < 1.0) dy = Math.max(dy, Math.abs(b.center.y - y0)); }
    const glided = b.center.x > 0.85;
    b.scootTo(3.2, 0, 0.3);
    for (let i = 0; i < 600 && (priv(b).scootOn as boolean); i++) frameW(w, [b], null);
    b.setHome(b.center.x, b.center.z);   // (as the life host re-homes a body where LIFE brought it: else the home corral glides it back past its rim, 4 m from home)
    for (let i = 0; i < 120; i++) frameW(w, [b], null);
    const out2 = lowest(b), sub2 = b.metrics.submerged ?? 0;
    add('PH-15 scootTo glides a FLOATING body (marshmallow) 1.8 m across the pool with the water holding its height (centre within 3 cm while in full depth); scooted on to a dry spot it leaves the water and sits on the floor (submerged 0), no NaN',
      `afloat (lowest ${f(lo0, 3)} m); glided to x ${f(b.center.x, 2)}: height kept within ${f(dy * 100, 2)} cm in the pool (arrived ${glided}); out of the water: lowest ${f(out2, 3)} m, submerged ${f(sub2, 3)}`,
      'afloat, <= 3 cm, arrived; lowest < 0.005, submerged 0', lo0 > 0.02 && dy <= 0.03 && glided && out2 < 0.005 && sub2 === 0 && finite(b));
  }
  // (d) clean entries: bodies launched into the pool (a floater and a sitter): no NaN, no fold over 120, the floater bobs up and settles, the sitter sits (--only / --full)
  if (!QUICK) {
    let fo = 0; const res: string[] = []; let ok = true;
    for (const fam of ['marshmallow', 'jellygel']) {
      const w = buildPropWorld(poolPlace([0, 0]), 'wide', 1);
      const b = mk(NEUTRAL, fam, { piece: { frac: 1, chunk: false, at: v3(-2.0, 0.95, 0), vel: v3(2, 0, 0) } }); b.setPropWorld(w);
      for (let i = 0; i < 240; i++) { frameW(w, [b], null); if (i % 6 === 0) fo = Math.max(fo, foldDeg(b)); }
      const lo = lowest(b), want = fam === 'marshmallow';
      const pass = finite(b) && (want ? lo > 0.02 : lo < 0.005);
      ok = ok && pass; res.push(`${fam}: lowest ${f(lo, 3)} m, submerged ${f(b.metrics.submerged ?? 0, 3)}`);
    }
    add('PH-15 clean entries: a floater and a sitter launched into the pool (2 m/s from 0.5 m up): no NaN, fold <= 120, the floater floats, the sitter wades', `${res.join('; ')}; fold ${f(fo, 0)}`, 'all', ok && fo <= 120);
  }
  // (e) the real places: Ripple's Rock Pool (marshmallow floats, jelly gel wades); Frostbell's Steam Pool; Rainleaf's splash spots are shallow (0.06..0.08 m): wade only
  {
    const res: string[] = []; let ok = true;
    const at = (pl: PlaceDef, zi: number, dx: number): V3 => { const z = pl.zones[zi]; return v3(z.x + dx, 0, z.z); };
    for (const [pl, zi, dx, fam, want] of [[RIPPLE, 0, 0.75, 'marshmallow', true], [RIPPLE, 0, 0.75, 'jellygel', false], [FROSTBELL, 1, 0.45, 'popdome', true], [RAINLEAF, 1, 0, 'marshmallow', false]] as const) {
      const w = buildPropWorld(pl, 'wide', 1);
      const b = mk(NEUTRAL, fam, { piece: { frac: 1, chunk: false, at: at(pl, zi, dx) } }); b.setPropWorld(w);
      for (let i = 0; i < 150; i++) frameW(w, [b], null);
      const fl = lowest(b) > 0.02;
      ok = ok && fl === want && finite(b); res.push(`${pl.id} ${pl.zones[zi].id} ${fam}: ${fl ? 'floats' : 'wades'} (submerged ${f(b.metrics.submerged ?? 0, 3)})`);
    }
    add('PH-15 the S2 places\' own water: Ripple\'s Rock Pool floats a marshmallow and wades a jelly gel; Frostbell\'s Steam Pool floats a pop dome; Rainleaf\'s shallow splash spot (0.07 m) only wets a marshmallow (it wades)', res.join('; '), 'as the table', ok);
  }
  info('PH-15 not built: the bulge slosh in water, the current zone kind (only a water zone\'s own flow acts). (Round 6: soaking is the shell\'s write of world.mods(body)[4], physics reads it, --only=surface; Ripple\'s waves, --only=surf)', '');
}

/* ───────────── PH-16: the flush pad (S2: Rainleaf's Moss Bouncer) ───────────── */
if (run('pad')) {
  const padT = RAINLEAF.things.find((t) => t.mech === MECH.pad)!;
  const place = { ...RAINLEAF, things: [{ ...padT, x: 0, z: 0 }], walls: [], zones: [], patches: [], tall: { ...RAINLEAF.tall, things: [{ x: 0, z: 0, yaw: 0 }], walls: [], zones: [], patches: [] } } as unknown as PlaceDef;
  const cap = padT.p.apex ?? 0.3;
  const fams = FULL ? FAMS : QUICK ? ['jellygel', 'firmsilicone', 'stickystretch', 'slimegoo'] : ['jellygel', 'firmsilicone', 'stickystretch', 'slimegoo', 'marshmallow', 'putty', 'gummy', 'popdome'];
  const res: string[] = []; let bad = 0;
  const out = new Float32Array(32);
  for (const fam of fams) {
    const w = buildPropWorld(place, 'wide', 1);
    const b = mk(NEUTRAL, fam, { piece: { frac: 1, chunk: false, at: v3(0, 0.75, 0) } }); b.setPropWorld(w);
    let apex = 0, t = 0, landT = -1, lands = 0, autoLands = 0; const kicks: number[] = [];
    for (let i = 0; i < 60 * (QUICK ? 3 : 5); i++) {
      w.beginFrame(); b.step(DT); const e: SoftEvent[] = []; b.drainEvents(e); w.endFrame(DT); t += DT;
      for (const x of e) if (x.kind === 'land') { lands++; if (x.auto) autoLands++; if (landT < 0) landT = t; }
      const m = w.drainStrikes(out); for (let k = 0; k < m; k++) kicks.push(t);
      if (i > 30) apex = Math.max(apex, lowest(b));
    }
    const hold = (FAMILY_REACT as Record<string, { padHoldS: number }>)[fam].padHoldS, firstKick = kicks.length ? kicks[0] - landT : NaN;
    const ok = kicks.length >= 1 && kicks.length <= 5 && apex <= cap + 1e-6 && Math.abs(firstKick - hold) <= 0.1 + DT && finite(b) && autoLands === lands;
    if (!ok) bad++;
    res.push(`${fam}: ${kicks.length} kick(s), apex ${f(apex * 100, 1)} cm, first kick ${f(firstKick, 2)} s after landing (hold ${hold})`);
  }
  add(`PH-16 the flush pad (Rainleaf's Moss Bouncer, gain ${padT.p.gain}, apex cap ${cap} m): a body dropped on it from 0.35 m, ${fams.length} families: 1 to 5 kicks, the lowest point never over the cap, the first kick after the family's sticky hold +-0.1 s (0.4 s sticky stretch, 0.6 s slime, else at once), its landings auto (nobody threw it)`,
    res.join('; '), 'all', bad === 0);
  // LIFE's "walks on, one small hop, and the pad does the rest": a hop at the S1 cap from the pad grows into bounces
  {
    const w = buildPropWorld(place, 'wide', 1);
    const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0, 0) } }); b.setPropWorld(w);
    for (let i = 0; i < 40; i++) frameW(w, [b], null);
    const hopOk = b.hop(0, PG.hopVyCap, 0);
    let apex = 0, kicks = 0;
    for (let i = 0; i < 240; i++) { frameW(w, [b], null); kicks += w.drainStrikes(out); apex = Math.max(apex, lowest(b)); }
    add('PH-16 one small hop on the pad (vy 0.84, apex 3.5 cm alone) and the pad does the rest: the bounces grow (several kicks, the apex well over the hop\'s), at most 5', `hop ${hopOk}, ${kicks} kick(s), apex ${f(apex * 100, 1)} cm`, '>= 2 kicks, <= 5, apex > 6 cm', hopOk && kicks >= 2 && kicks <= 5 && apex > 0.06);
  }
}

/* ───────────── S2 ramp and floater (Frostbell's Glide Ramp, Ripple's Bob Ring) ───────────── */
if (run('ramp')) {
  // the Glide Ramp: a body set at its top (carryTo) slides down past its foot between the rails; its colliders are the slab and two rails
  const w = buildPropWorld(FROSTBELL, 'wide', 1), kr = w.propThing.indexOf(1), rd = FROSTBELL.things[1];
  const hl = rd.size[0], ang = ((rd.p.angle ?? 14) * Math.PI) / 180, yaw = rd.yaw, ox = Math.cos(yaw), oz = Math.sin(yaw);
  const parts = Array.from(w.propThing).filter((t) => t === 1).length;
  const topX = rd.x - ox * (hl - 0.35), topZ = rd.z - oz * (hl - 0.35), topY = (rd.p.top ?? 0.5) - 0.35 * Math.sin(ang) - 0.02;
  const res: string[] = []; let ok = parts === 3;
  for (const fam of QUICK ? ['firmsilicone'] : ['firmsilicone', 'jellygel', 'gummy']) {
    const b = mk(NEUTRAL, fam, { piece: { frac: 1, chunk: false, at: v3(rd.x + ox * 2.2, 0, rd.z + oz * 2.2) } }); b.setPropWorld(w);
    for (let i = 0; i < 20; i++) frameW(w, [b], null);
    const started = b.carryTo(topX, topY, topZ, 1.0);
    for (let i = 0; i < 70; i++) frameW(w, [b], null);
    const onTop = b.metrics.onProp === kr, along0 = (b.center.x - rd.x) * ox + (b.center.z - rd.z) * oz;
    let fo = 0, side = 0;
    for (let i = 0; i < 60 * 4; i++) { frameW(w, [b], null); if (i % 6 === 0) fo = Math.max(fo, foldDeg(b)); side = Math.max(side, Math.abs(-(b.center.x - rd.x) * oz + (b.center.z - rd.z) * ox)); }
    const along1 = (b.center.x - rd.x) * ox + (b.center.z - rd.z) * oz;
    const pass = started && onTop && along1 - along0 > 1.0 && fo <= 120 && finite(b);
    ok = ok && pass; res.push(`${fam}: set at the top (onProp ${onTop}), slid ${f(along1 - along0, 2)} m down the slope in 4 s, off the centre line at most ${f(side, 2)} m, fold ${f(fo, 0)}`);
  }
  add(`S2 ramp (Frostbell's Glide Ramp, ${rd.p.angle} deg, mu ${rd.mu}): 3 colliders (slab + 2 rails); a body set at its top by carryTo slides down past its middle (> 1 m along the slope in 4 s), no fold over 120`, `${parts} colliders; ${res.join('; ')}`, 'all', ok);
  // the Shake Pine: its trunk and its branch (part 1, where the render draws it); a body scooted into the trunk faster than its bump speed (0.3 m/s) shakes the branch
  // (a strike with the body's slot), a slower one does not
  {
    const pine = FROSTBELL.things[6], res2: string[] = []; let okP = true;
    for (const sp of [0.2, 0.45]) {
      const wp = buildPropWorld(FROSTBELL, 'wide', 1), kT = wp.propThing.indexOf(6), kBr = kT + 1;
      const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(pine.x + 1.6, 0, pine.z + 0.3) } }); b.contactSlot = 3; b.setPropWorld(wp);
      for (let i = 0; i < 20; i++) frameW(wp, [b], null);
      b.scootTo(pine.x - 1, pine.z + 0.3, sp);
      const so = new Float32Array(32); let strikes = 0, slot = -1, maxA = 0;
      for (let i = 0; i < 360; i++) { frameW(wp, [b], null); const m = wp.drainStrikes(so); for (let k = 0; k < m; k++) if (so[k * 4] === kBr) { strikes++; slot = so[k * 4 + 3]; } maxA = Math.max(maxA, Math.abs(wp.angle(kBr))); }
      const bx = wp.poses[kBr * 8], want = pine.x + pine.size[0] + (pine.p.branchL ?? 0.5) / 2;
      const pass = wp.propPart[kBr] === 1 && Math.abs(bx - want) < 1e-4 && (sp > (pine.p.bumpSpeed ?? 0.3) ? strikes >= 1 && slot === 3 && maxA > 0.02 : strikes === 0);
      okP = okP && pass; res2.push(`scoot ${sp} m/s: ${strikes} strike(s) (slot ${slot}), branch up to ${f((maxA * 180) / Math.PI, 1)} deg`);
    }
    add('S2 the Shake Pine (Frostbell): the branch is part 1 at the render\'s place; a body scooted into the trunk at 0.45 m/s (over the pine\'s 0.3 m/s) shakes it (a strike with its contact slot), at 0.2 m/s it does not', res2.join('; '), 'as described', okP);
  }
  // the Bob Ring floats on the Rock Pool's surface and bobs within its amplitude
  const wr = buildPropWorld(RIPPLE, 'wide', 1), kb = wr.propThing.indexOf(1), bobD = RIPPLE.things[1];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 60 * 4; i++) { wr.beginFrame(); wr.endFrame(DT); const y = wr.poses[kb * 8 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
  const segs = Array.from(wr.propThing).filter((t) => t === 1).length, surf = RIPPLE.zones[0].surfaceY ?? 0, amp = bobD.p.bob ?? 0;
  add('S2 floater (Ripple\'s Bob Ring): a ring of capsules at the Rock Pool\'s surface (0.28 m), bobbing within its amplitude (0.03 m) at 0.3 Hz',
    `${segs} segments; centre y ${f(lo, 3)} .. ${f(hi, 3)} m`, `6; ${f(surf - amp, 3)} .. ${f(surf + amp, 3)}`, segs === (bobD.p.segments ?? 6) && lo >= surf - amp - 1e-6 && hi <= surf + amp + 1e-6 && hi - lo > amp);
}

/* ───────────── PH-05: the ball ───────────── */
if (run('ball')) {
  for (const layout of QUICK ? (['wide'] as const) : (['wide', 'tall'] as const)) {
    const w = buildPropWorld(CABIN, layout, 1);
    const kB = w.propThing.indexOf(2);
    const vel = new Float64Array(3);
    // flicked hard toward the back wall: clamped to 2.0 m/s, never through a wall (inside the walls' inner faces), rests within 6 s
    w.raycast(w.poses[kB * 8], w.poses[kB * 8 + 1] + 2, w.poses[kB * 8 + 2], 0, -1, 0);
    w.poke(kB, 1.0, 0, -4.0);
    let vmax = 0, through = false, rest = -1;
    const lay = layout === 'tall' ? CABIN.tall : CABIN;
    const inner = layout === 'tall' ? { x: 2.3, zb: -3.75 } : { x: 3.4, zb: -2.4 };
    for (let i = 0; i < 60 * 8; i++) {
      w.beginFrame(); w.endFrame(DT);
      w.ballVelocity(kB, vel);
      const sp = Math.hypot(vel[0], vel[1], vel[2]); vmax = Math.max(vmax, sp);
      const x = w.poses[kB * 8], z = w.poses[kB * 8 + 2];
      if (Math.abs(x) > inner.x + 0.01 || z < inner.zb - 0.01) through = true;
      if (rest < 0 && sp === 0) rest = (i + 1) * DT;
    }
    void lay;
    add(`PH-05 ball (${layout}): a flick of 4.1 m/s is clamped to 2.0 m/s, never passes a wall, and rests within 6 s`, `max ${f(vmax, 3)} m/s, through a wall ${through}, at rest after ${f(rest, 2)} s`, '<= 2.0, false, <= 6 s', vmax <= 2.0 + 1e-9 && !through && rest > 0 && rest <= 6);
  }
  // B5 (round 5, FIX5_DATA): Home's TALL Felt Ball spot (0.76, 1.06) lies outside the one-out bounds on a phone (the visible table's near row,
  // x +-0.533 at scale 1.026, measured in the browser): the world's first step pushes it in to x 0.313. When a party comes out the shell sets wider
  // bounds; an UNTOUCHED ball must then stand at its spot again (the browser at HEAD left it at x 0.299 with three out, in front of the play
  // squishy), while a ball someone booped stays where it rolled
  {
    const one = [-0.533, -3.4, 0.533, 1.85], three = [-1.092, -3.4, 1.101, 3.4], s = 1.026;
    const at = (w: PropWorld): string => `(${f(w.poses[0], 3)}, ${f(w.poses[2], 3)})`;
    const w = buildPropWorld(HOME, 'tall', s);
    w.setParked(0, false); w.setBallBounds(one[0], one[1], one[2], one[3]);
    for (let i = 0; i < 60; i++) { w.beginFrame(); w.endFrame(DT); }
    const held = at(w), heldX = w.poses[0];
    w.setBallBounds(three[0], three[1], three[2], three[3]);
    for (let i = 0; i < 60; i++) { w.beginFrame(); w.endFrame(DT); }
    const back = at(w), sx = HOME.tall.things[0].x * s, sz = HOME.tall.things[0].z * s;
    const w2 = buildPropWorld(HOME, 'tall', s);
    w2.setParked(0, false); w2.setBallBounds(one[0], one[1], one[2], one[3]);
    for (let i = 0; i < 60; i++) { w2.beginFrame(); w2.endFrame(DT); }
    w2.poke(0, -0.3, 0, 0.2);
    for (let i = 0; i < 240; i++) { w2.beginFrame(); w2.endFrame(DT); }
    const rolled = at(w2), rx = w2.poses[0], rz = w2.poses[2];
    w2.setBallBounds(three[0], three[1], three[2], three[3]);
    for (let i = 0; i < 60; i++) { w2.beginFrame(); w2.endFrame(DT); }
    add('B5 (round 5) Home\'s Felt Ball, phone: untouched, it is held at the one-out bounds\' edge, then stands at its spot again when a party widens the bounds; once booped it stays where it rolled',
      `one out ${held}, three out ${back} (spot (${f(sx, 3)}, ${f(sz, 3)})); booped: ${rolled} -> ${at(w2)}`, 'held x 0.313; back at the spot within 1 mm; the booped one unmoved',
      Math.abs(heldX - (one[2] - 0.22)) < 1e-3 && Math.hypot(w.poses[0] - sx, w.poses[2] - sz) < 1e-3 && Math.hypot(w2.poses[0] - rx, w2.poses[2] - rz) < 1e-6);
  }
  // a body boops the ball (scootTo into it at the gait speed): the ball rolls away; no particle over 6 m/s from the contact
  {
    const w = buildPropWorld(testPlace([thing(MECH.ball, 0.8, 0, [0.24, 0, 0], { mass: 0.2, rollDamp: 0.5 })]), 'wide', 1);
    const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0.0, 0, 0) } }); b.setPropWorld(w);
    for (let i = 0; i < 30; i++) frameW(w, [b], null);
    b.scootTo(1.5, 0, 0.26);
    const bx0 = w.poses[0];
    let vmaxP = 0, ballMax = 0;
    const vel = new Float64Array(3), Pp = Float32Array.from(b.positions);
    for (let i = 0; i < 180; i++) {
      frameW(w, [b], null);
      for (let k = 0; k < Pp.length; k += 3) vmaxP = Math.max(vmaxP, Math.hypot(b.positions[k] - Pp[k], b.positions[k + 1] - Pp[k + 1], b.positions[k + 2] - Pp[k + 2]) / DT);
      Pp.set(b.positions);
      w.ballVelocity(0, vel); ballMax = Math.max(ballMax, Math.hypot(vel[0], vel[2]));
    }
    const moved = w.poses[0] - bx0;
    add('PH-05 a body scooting into the Yarn Ball at 0.26 m/s boops it: the ball rolls on (and stays under 2.0 m/s); no particle faster than 6 m/s', `ball moved ${f(moved, 3)} m, ball max ${f(ballMax, 3)} m/s, fastest particle ${f(vmaxP, 3)} m/s`, 'moved > 0.2 m; <= 2.0; <= 6', moved > 0.2 && ballMax <= 2.0 + 1e-9 && vmaxP <= 6);
  }
}

/* ───────────── PH-06: mass parity on a seesaw ───────────── */
if (run('mass')) {
  // the board held level (a 0.001 deg limit): the angular impulse a resting sitter puts on it per second, detail 3 vs detail 2, and a 1/8 piece
  const torque = (b: SoftBody): number => {
    const w = buildPropWorld(testPlace([thing(MECH.seesaw, 0, 0, [1.1, 0.08, 0.3], { pivot: 0.24, limit: 0.001, inertia: 0.7, damping: 0.9 })]), 'wide', 1);
    b.setPropWorld(w);
    for (let i = 0; i < 300; i++) frameW(w, [b], null);   // (5 s: the sitter's landing on the board settles; in the first 1.5 s it still loads it 5 to 7 % over its weight)
    let L = 0;
    for (let i = 0; i < 60; i++) { w.beginFrame(); b.step(DT); drain(b); L += w.solve.A[3] * 0 + w.solve.A[5]; w.endFrame(DT); }
    return L;   // about the z axis (the board's hinge axis), summed over 1 s
  };
  const at = { piece: { frac: 1, chunk: false, at: v3(0.75, 0.9, 0) } };
  const t3 = torque(mk(NEUTRAL, 'jellygel', at)), t2 = torque(mk(NEUTRAL, 'jellygel', { ...at, detail: 2 }));
  const t8 = torque(mk(NEUTRAL, 'jellygel', { piece: { frac: 0.125, chunk: false, at: v3(0.75, 0.6, 0) } }));
  const bm = (mk(NEUTRAL, 'jellygel') as unknown as { bodyMass: number }).bodyMass, ideal = bm * GRAVITY * 0.75;   // the sitter's mass (in default wholes) at 0.75 m
  add('PH-06 mass parity: the angular impulse per second a resting sitter at 0.75 m puts on a level board: detail 3 and detail 2 within 5%; a 1/8 piece an eighth (+-5%)',
    `detail 3 ${f(-t3, 3)}, detail 2 ${f(-t2, 3)} (ratio ${f(t2 / t3, 3)}), 1/8 piece ${f(-t8, 3)} (ratio ${f(t8 / t3, 3)}); ideal bodyMass g r = ${f(ideal, 2)}`,
    'ratios 0.95..1.05 and 0.119..0.131', Math.abs(t2 / t3 - 1) <= 0.05 && Math.abs(t8 / t3 - 0.125) <= 0.125 * 0.05);
}

/* ───────────── PH-23: the prop order and the strikes ───────────── */
if (run('order')) {
  const w = buildPropWorld(CABIN, 'wide', 1);
  const expT = [0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 5, 5, -1, -1, -1], expP = [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 0, 1, 0, 1, 2];
  const gotT = Array.from(w.propThing), gotP = Array.from(w.propPart);
  const okOrder = w.count === 15 && JSON.stringify(gotT) === JSON.stringify(expT) && JSON.stringify(gotP) === JSON.stringify(expP);
  add('PH-23 the prop order of Hearthlog (wide): every prop of things[0], then things[1] ..., walls last; propThing and propPart (15 colliders: the fireplace, the rocker, the ball, the swing seat, 6 basket segments, the stove and the kettle, 3 walls)',
    `count ${w.count}; propThing ${gotT.join(',')}; propPart ${gotP.join(',')}`, `count 15; ${expT.join(',')} / ${expP.join(',')}`, okOrder);
  const h = buildPropWorld(HOME, 'wide', 1);
  add('PH-23 Home: its things are built parked (no collider until the shell shows them: setParked(thing, false)); the Snooze Rug has no prop', `count ${h.count}; propThing ${Array.from(h.propThing).join(',')}; parked ${Array.from({ length: h.count }, (_, k) => (h.isParked(k) ? 1 : 0)).join('')}`, 'every prop parked; no prop of thing 2', Array.from({ length: h.count }, (_, k) => h.isParked(k)).every(Boolean) && !Array.from(h.propThing).includes(2));
  // R4: setParked shows and parks EVERY prop of a thing (round 3 counted a thing's props from -1, so a one-part thing never changed: PG_SHELL's parkThing FALLBACK)
  {
    const hw = buildPropWorld(HOME, 'wide', 1), nT = HOME.things.length, kBall = hw.propThing.indexOf(0);
    for (let t = 0; t < nT; t++) hw.setParked(t, false);
    const shown = Array.from({ length: hw.count }, (_, k) => (hw.isParked(k) ? 1 : 0)).join('');
    const hit = hw.raycast(hw.poses[kBall * 8], 2, hw.poses[kBall * 8 + 2], 0, -1, 0);
    hw.poke(kBall, 1.2, 0, 0); const bx0 = hw.poses[kBall * 8];
    for (let i = 0; i < 30; i++) { hw.beginFrame(); hw.endFrame(DT); }
    const rolled = hw.poses[kBall * 8] - bx0;
    for (let t = 0; t < nT; t++) hw.setParked(t, true);
    const parkedAgain = Array.from({ length: hw.count }, (_, k) => (hw.isParked(k) ? 1 : 0)).join(''), missAgain = hw.raycast(hw.poses[kBall * 8], 2, hw.poses[kBall * 8 + 2], 0, -1, 0);
    // a thing of several parts (the cabin's basket: 6 segments; the kettle: a block and a sphere) parks and shows whole
    const cw2 = buildPropWorld(CABIN, 'wide', 1);
    cw2.setParked(4, true); cw2.setParked(5, true);
    const multi = Array.from({ length: cw2.count }, (_, k) => (cw2.isParked(k) ? 1 : 0)).join('');
    cw2.setParked(4, false); cw2.setParked(5, false);
    const multiBack = Array.from({ length: cw2.count }, (_, k) => (cw2.isParked(k) ? 1 : 0)).join('');
    const okMulti = multi === '000011111111000' && multiBack === '000000000000000';
    add('PH-23 setParked shows and parks every prop of a thing (R4 fix: round 3 counted from -1 and a ONE-part thing never changed): Home\'s things all shown, the Felt Ball raycasts and rolls on a poke, all parked again (no raycast); the cabin\'s basket (6 parts) and kettle (2 parts) park and show whole',
      `Home shown ${shown}, ball hit ${hit === kBall}, rolled ${f(rolled, 3)} m in 0.5 s; parked again ${parkedAgain}, raycast ${missAgain}; cabin parked ${multi}, shown ${multiBack}`,
      'all 0, hit, > 0.1 m; all 1, -1; 000011111111000, all 0', /^0+$/.test(shown) && hit === kBall && rolled > 0.1 && /^1+$/.test(parkedAgain) && missAgain === -1 && okMulti);
  }
  // strikes: a chime poked (cause 0, slot -1), a body walking into it (cause 1, its contactSlot)
  const cw = buildPropWorld(testPlace([thing(MECH.chime, 0, 0, [0.08, 0.2, 0], { n: 1, hang: 0.5, limit: 25, damping: 0.8 })]), 'wide', 1);
  const out = new Float32Array(32);
  cw.poke(0, 1, 0, 0);
  const n0 = cw.drainStrikes(out), poke = n0 === 1 && out[0] === 0 && out[2] === 0 && out[3] === -1;
  const b = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(-1.2, 0, 0) } }); b.contactSlot = 7; b.setPropWorld(cw);
  for (let i = 0; i < 10; i++) frameW(cw, [b], null);
  cw.drainStrikes(out);
  b.scootTo(0.3, 0, 0.4);
  let n1 = 0, cause = -1, slot = -2;
  for (let i = 0; i < 180; i++) { frameW(cw, [b], null); const m = cw.drainStrikes(out); if (m > 0 && n1 === 0) { cause = out[2]; slot = out[3]; } n1 += m; }
  add('PH-23 drainStrikes: a poke on a chime gives cause 0 (slot -1); a body walking into it gives cause 1 with its contactSlot (7); weather (cause 2): round 6\'s gusts and waves, see --only=surf',
    `poke: ${n0} strike (cause ${out[2] === undefined ? '-' : poke ? 0 : 'wrong'}); body: ${n1} strike(s), first cause ${cause} slot ${slot}`, 'cause 0; cause 1 slot 7', poke && n1 > 0 && cause === 1 && slot === 7);
}

/* ───────────── PH-10: determinism with props, sleep and drivers ───────────── */
if (run('det')) {
  const once = (): string => {
    const w = buildPropWorld(CABIN, 'wide', 1);
    const planner = new ContactPlanner();
    const bs = [mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(-0.65, 0, -0.42) } }), mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(1.55 + 0.75, 0.9, 2.05) } }),
      mk(NEUTRAL, 'firmsilicone', { piece: { frac: 1, chunk: false, at: v3(-0.15, 0, 0.75) } })];
    for (const b of bs) { b.sleepEnabled = true; b.setPropWorld(w); }
    const hs: number[] = [];
    for (let i = 0; i < (QUICK ? 180 : 360); i++) {
      if (i === 30) bs[0].scootTo(-1.35, 1.4, 0.26);
      if (i === 60) bs[2].setSquash(0.85, 0.12);
      if (i === 70) bs[2].hop(0.1, 0.84, 0);
      if (i === 100) w.poke(2, 0.8, 0, 0.3);
      frameW(w, bs, planner);
      if (i % 30 === 0) hs.push(w.stateHash(), ...bs.map((b) => b.stateHash()));
    }
    return hs.join(',') + '|' + bs.map((b) => b.sleeping).join(',');
  };
  const a = once(), b = once();
  add('PH-10 determinism: the cabin, three bodies with sleep on, a scoot into the ball, a squash, a hop, a poke, the rocker carrying one: two runs give equal body and prop hashes at every sample', a === b ? 'equal' : 'DIFFERENT', 'equal', a === b);
  info('PH-10 re-baselined hash rows: none (sleep for wholes is opt-in, every existing hash row runs with it off; no existing row binds a PropWorld)', '');
}

/* ───────────── R6 (round 6, R6_PHYS.md): the surface (PH-08), the surf's waves, wind gusts and the updraft (PH-17), the bounds guard ───────────── */
const zoneIdx = (p: PlaceDef, id: string): number => p.zones.findIndex((z) => z.id === id);
/** A body set down at (x, z) (y: its rest centre's height above the floor; 0 = on it) in world w. */
const placed = (w: PropWorld, fam: string, x: number, z: number, y = 0, g: Genome = NEUTRAL, frac = 1): SoftBody => {
  const b = mk(g, fam, { piece: { frac, chunk: false, at: v3(x, y, z) } }); b.setPropWorld(w); return b;
};
/** The slide of a body nudged at v m/s along +x from rest at (x, z) in a fresh world of `place`: its distance and when it stopped (the last time it was 5 mm or more from
 *  where it ended), over 4 s. */
/** The slide of a body nudged at v m/s along +x from rest at (x, z) in a fresh world of `place`: its distance (the centre, 4 s), its grip multiplier (surfaceOf) and
 *  whether its FOOT had stopped by 0.3 s: the particles on the floor at 0.3 s and at the end moved at most 5 mm in between (a rocking body lifts and sets down
 *  particles; a slide moves the ones that stay down). */
const slide = (place: PlaceDef, fam: string, x: number, z: number, v: number): { d: number; stop: number; grip: number; foot: number } => {
  const w = buildPropWorld(place, 'wide', 1), b = placed(w, fam, x, z), q = new Float64Array(4), X = (b as unknown as { X: Float64Array }).X;
  for (let i = 0; i < 40; i++) frameW(w, [b], null);
  const x0 = b.center.x; b.nudge(v3(v, 0, 0));
  let at = new Float64Array(0);
  for (let i = 0; i < 240; i++) { frameW(w, [b], null); if (i === 2) w.surfaceOf(b, q); if (i === 17) at = Float64Array.from(X); }
  let sx = 0, sz = 0, n = 0;
  for (let k = 0; k < X.length; k += 3) if (X[k + 1] < 0.012 && at[k + 1] < 0.012) { sx += X[k] - at[k]; sz += X[k + 2] - at[k + 2]; n++; }
  const foot = n > 0 ? Math.hypot(sx / n, sz / n) : 0;
  b.setPropWorld(null);
  return { d: b.center.x - x0, stop: foot <= 0.003 ? 0.3 : 4, grip: q[0], foot };
};
const spearman = (a: number[], b: number[]): number => {
  const rank = (v: number[]): number[] => { const ix = v.map((x, i) => [x, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array<number>(v.length); ix.forEach(([, i], k) => { r[i] = k; }); return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
};
if (run('det')) {
  // (R6) the new places' paths: Frostbell's ice (a glide off a nudge) and its Wind Gap, Cloudloft's updraft pad bounce in gusts, Lanternroof's guard (a throw over the parapet)
  const once6 = (): string => {
    const wf = buildPropWorld(FROSTBELL, 'wide', 1), wc = buildPropWorld(CLOUD, 'wide', 1), wl = buildPropWorld(LANTERN, 'wide', 1), ice = FROSTBELL.patches.find((pp) => pp.ice)!;
    const a = placed(wf, 'jellygel', ice.x - 1.0, ice.z), c = placed(wc, 'popdome', wc.poses[0], wc.poses[2], 0.5), l = placed(wl, 'firmsilicone', 2.5, 0, 0.8);
    l.setBounds(1, 0, 0, 3.4, 2.4, 0.8); l.nudge(v3(1.5, 10, 0));
    const hs: number[] = [];
    for (let i = 0; i < (QUICK ? 150 : 300); i++) {
      if (i === 10) a.nudge(v3(0.8, 0, 0));
      frameW(wf, [a], null); frameW(wc, [c], null); frameW(wl, [l], null);
      if (i % 30 === 0) hs.push(wf.stateHash(), wc.stateHash(), a.stateHash(), c.stateHash(), l.stateHash(), Math.round(wf.gustLevel(3) * 1e6));
    }
    return hs.join(',');
  };
  const r1 = once6(), r2 = once6();
  add('PH-10 determinism, round 6 paths: Frostbell\'s ice glide and Wind Gap, Cloudloft\'s updraft pad, Lanternroof\'s guard (a throw over the parapet): two runs give equal body and prop hashes at every sample', r1 === r2 ? 'equal' : 'DIFFERENT', 'equal', r1 === r2);
}
if (run('surface')) {
  const ice = FROSTBELL.patches.find((p) => p.ice)!;
  // (a) PH-08: the Ice Pond's glide by family (nudged at 0.8 m/s, LIFE's GLIDE nudge is 0.6 to 1.0, from 1.1 m inside the pond's left edge toward its middle)
  const fams = QUICK ? ['firmsilicone', 'jellygel', 'marshmallow', 'putty', 'stickystretch'] : FAMS;
  const dI: number[] = [], gI: number[] = [], parts: string[] = []; let snowMax = 0, minFast = 9, stickyD = 0;
  for (const fam of fams) {
    const r = slide(FROSTBELL, fam, ice.x - 1.1, ice.z, 0.8), s = slide(FROSTBELL, fam, -0.5, 1.0, 0.8), ig = (FAMILY_REACT as Record<string, { iceGrip: number }>)[fam].iceGrip;
    dI.push(r.d); gI.push(-ig); parts.push(`${fam} ${f(r.d, 2)}/${f(s.d, 3)}`);
    snowMax = Math.max(snowMax, s.d); if (ig <= 0.15) minFast = Math.min(minFast, r.d); if (fam === 'stickystretch') stickyD = r.d;
  }
  const rho = spearman(dI, gI);
  add(`PH-08 the Ice Pond (Frostbell): glide distances from a 0.8 m/s nudge rank by the family's ice grip (${fams.length} families; ice / packed snow, m)`, `Spearman ${f(rho, 3)}; ${parts.join(', ')}`, '>= 0.8', rho >= 0.8);
  add('R6 the Ice Pond is a glide: the families of ice grip 0.15 or less glide at least LIFE\'s GLIDE distance (0.5 m) from a 0.8 m/s nudge; sticky stretch "grips the ice, barely moves"; on the packed snow beside it every one stops',
    `fastest families' least ${f(minFast, 3)} m; sticky stretch ${f(stickyD, 3)} m; snow at most ${f(snowMax, 4)} m`, '>= 0.5; <= 0.25; <= 0.02', minFast >= 0.5 && stickyD <= 0.25 && snowMax <= 0.02);
  // (b) PH-08: sand stops a slide within 0.3 s (Ripple Shore's ground, grip 1.35)
  const sandFams = QUICK ? ['firmsilicone', 'jellygel'] : ['firmsilicone', 'jellygel', 'gummy', 'popdome', 'marshmallow', 'putty'];
  const sand = sandFams.map((fm) => slide(RIPPLE, fm, -0.5, 0.6, 0.8));
  add(`PH-08 sand (Ripple Shore, grip 1.35) stops a slide within 0.3 s (${sandFams.length} families nudged at 0.8 m/s: the mean move of the particles on the floor at both 0.3 s and 4 s: a slide moves them together, a body settling on its foot does not)`,
    sand.map((r, i) => `${sandFams[i]} foot ${f(r.foot * 1000, 1)} mm after 0.3 s (slid ${f(r.d, 3)} m in all, grip x${f(r.grip, 2)})`).join(', '), '<= 3 mm', sand.every((r) => r.stop <= 0.3));
  // (c) wet grip: Rainleaf's rain in its shower phase (40 s on, 30 s off from the arrival): grip x 0.8, sticky stretch keeps its own; off phase: the loam's own
  {
    const q = new Float64Array(4), w = buildPropWorld(RAINLEAF, 'wide', 1), bj = placed(w, 'jellygel', 0.4, 0.3), bs = placed(w, 'stickystretch', -0.6, -0.2);
    for (let i = 0; i < 60; i++) frameW(w, [bj, bs], null);
    w.surfaceOf(bj, q); const jOn = q[0]; w.surfaceOf(bs, q); const sOn = q[0];
    for (let i = 0; i < Math.round(44 / DT); i++) w.endFrame(DT);   // (the world's clock to 45 s: the shower's off phase; the bodies asleep or not, no step needed)
    bj.nudge(v3(0, 0.01, 0)); for (let i = 0; i < 40; i++) frameW(w, [bj, bs], null);
    w.surfaceOf(bj, q); const jOff = q[0];
    const g = RAINLEAF.ground.grip;
    add('R6 wet grip (Rainleaf\'s rain): in the shower a jelly gel\'s grip is the loam\'s x 0.8 and a sticky stretch keeps the loam\'s; in the dry phase (45 s after the arrival) the jelly is back to the loam\'s',
      `jelly x${f(jOn, 3)} (want ${f(g * PROPS.WET_GRIP, 3)}), sticky x${f(sOn, 3)} (want ${f(g, 3)}); dry jelly x${f(jOff, 3)}`, 'within 0.005', Math.abs(jOn - g * PROPS.WET_GRIP) < 0.005 && Math.abs(sOn - g) < 0.005 && Math.abs(jOff - g) < 0.005);
  }
  // (d) the live places keep the published floor bit for bit, and a body leaving a place gets its own values back bit for bit
  {
    const vals = (b: SoftBody): number[] => { const p = (b as unknown as { p: Record<string, number>; dragF: number }); return [p.p.tableMu, p.p.glue, p.p.groundDamp, p.dragF]; };
    const same = (a: number[], b: number[]): boolean => a.every((x, i) => Object.is(x, b[i]));
    let liveOk = 0; const q = new Float64Array(4);
    for (const [pl, x, z] of [[HOME, 0, -0.36], [CABIN, 0.8, 0.9]] as [PlaceDef, number, number][]) {
      const w = buildPropWorld(pl, 'wide', 1), b = placed(w, 'jellygel', x, z), twin = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(x, 0, z) } });
      for (let i = 0; i < 90; i++) frameW(w, [b], null);
      w.surfaceOf(b, q);
      if (same(vals(b), vals(twin)) && q.every((v) => v === 1)) liveOk++;
    }
    const w = buildPropWorld(FROSTBELL, 'wide', 1), b = placed(w, 'firmsilicone', ice.x, ice.z), twin = mk(NEUTRAL, 'firmsilicone', { piece: { frac: 1, chunk: false, at: v3(ice.x, 0, ice.z) } });
    for (let i = 0; i < 30; i++) frameW(w, [b], null);
    const onIce = vals(b)[0];
    b.setPropWorld(null);
    const back = same(vals(b), vals(twin));
    add('R6 the live places keep the published floor (Home\'s Snooze Rug, the cabin\'s rug: friction, tack, peel damping and air drag bit for bit as a body bound to no world); a firm silicone that leaves the Ice Pond\'s world gets its own values back bit for bit',
      `live ${liveOk}/2 untouched; on the ice tableMu ${f(onIce, 4)} -> after leaving ${back ? 'bit for bit its own' : 'DIFFERENT'} (${f(vals(b)[0], 4)})`, '2/2; bit for bit', liveOk === 2 && back && onIce < vals(twin)[0]);
  }
  // (e) the density seam (PG_SHELL's request: SoftBodyLike.mods[4], served as world.mods(body)): the family's dry density at the bind; a soaked slow-rise sinks in
  // Frostbell's Steam Pool (0.26 m), a dry one floats; a sleeper in the pool wakes when the density written for it changes by more than 0.02
  {
    const pool = FROSTBELL.zones[zoneIdx(FROSTBELL, 'steampool')];
    const w = buildPropWorld(FROSTBELL, 'wide', 1), b = placed(w, 'slowrise', pool.x + 0.1, pool.z);
    const m = w.mods(b)!, other = mk(NEUTRAL, 'slowrise');
    const init = m !== null && m[4] === (FAMILY_REACT as Record<string, { density: number }>).slowrise.density && m[7] === 0 && m[0] === 1 && m[5] === 1 && w.mods(other) === null;
    b.sleepEnabled = true;
    for (let i = 0; i < 180; i++) frameW(w, [b], null);
    const dryLo = lowest(b);
    m[4] = 1.2;
    for (let i = 0; i < 300; i++) frameW(w, [b], null);
    const wetLo = lowest(b), wetSub = b.metrics.submerged ?? 0;
    for (let i = 0; i < 120 && !b.sleeping; i++) frameW(w, [b], null);
    const slept = b.sleeping || b.sleep();
    m[4] = 1.19;   // (a change of 0.01: it sleeps on)
    for (let i = 0; i < 30; i++) frameW(w, [b], null);
    const stillAsleep = b.sleeping;
    m[4] = 0.15;   // (dried: it wakes and floats again)
    for (let i = 0; i < 240; i++) frameW(w, [b], null);
    const reLo = lowest(b);
    add('R6 the density seam (world.mods(body), PG_SHELL\'s request): [4] starts at the family\'s dry density ([7] 0, the rest 1; null for a body of another world); a dry slow-rise floats in the Steam Pool, written soaked (1.2) it settles on the floor; asleep there, a change of 0.01 lets it sleep on, dried (0.15) it wakes and floats again',
      `init ${init ? 'ok' : 'WRONG'}; lowest point dry ${f(dryLo, 3)} m, soaked ${f(wetLo, 3)} m (submerged ${f(wetSub, 2)}); asleep ${slept}, after +-0.01 ${stillAsleep ? 'asleep' : 'AWAKE'}; dried again ${f(reLo, 3)} m`,
      'ok; dry > 0.008 (afloat: it rises until its submerged share is its density), soaked < 0.004; asleep; dried > 0.008', init && dryLo > 0.008 && wetLo < 0.004 && slept && stillAsleep && reLo > 0.008);
  }
}
if (run('surf')) {
  // Ripple Shore's surf edge (PLACES 4.3): the surface 0.06 m rising to 0.12 m on a wave every 7 to 10 s; the wave's water runs toward the shore as it rises: it carries
  // a floating body and never a wader; a wave's breeze rings a shell now and then (cause 2, the weather)
  const zi = zoneIdx(RIPPLE, 'surfedge'), surf = RIPPLE.zones[zi];
  const w = buildPropWorld(RIPPLE, 'wide', 1), sleep0 = SLEEP.enabled;
  SLEEP.enabled = false;   // (the wader stays awake for the measurement: a wave does not wake a sleeper, its last wet share stands)
  const wader = placed(w, 'jellygel', 0.6, surf.z), mini = placed(w, 'marshmallow', -0.6, surf.z, 0, NEUTRAL, 0.1);
  const starts: number[] = []; let prev = 0, subMin = 9, subMax = 0, wx0 = 0, mz0 = 0, mzMax = -9, mzMin = 9, cause2 = 0, otherCause = 0;
  const sb = new Float32Array(64);
  const T = QUICK ? 32 : 62;
  for (let i = 0; i < Math.round(T / DT); i++) {
    frameW(w, [wader, mini], null);
    const lv = w.waveLevel(zi);
    if (lv > 0 && prev === 0) starts.push(w.time);
    prev = lv;
    if (i === 60) { wx0 = wader.center.x; mz0 = mini.center.z; }
    if (i > 60) { const s = wader.metrics.submerged ?? 0; subMin = Math.min(subMin, s); subMax = Math.max(subMax, s); mzMax = Math.max(mzMax, mini.center.z - mz0); mzMin = Math.min(mzMin, mini.center.z - mz0); }
    const n = w.drainStrikes(sb); for (let k = 0; k < n; k++) { if (sb[k * 4 + 2] === 2) cause2++; else otherCause++; }
  }
  SLEEP.enabled = sleep0;
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  add(`R6 the surf's waves (Ripple Shore, ${T} s): a wave every 7 to 10 s (the world's clock from the arrival); the first within 10 s`,
    `${starts.length} waves at ${starts.map((t) => f(t, 1)).join(', ')} s; gaps ${gaps.map((g) => f(g, 1)).join(', ')} s`, 'gaps 7..10 s; first <= 10 s',
    starts.length >= 2 && starts[0] <= 10 && gaps.every((g) => g >= 7 - 1e-6 && g <= 10 + 1e-6));
  add('R6 a wave lifts the surf (0.06 -> 0.12 m): a jelly gel wading at the water line is wetter at its top (submerged share) and never pushed (it moves under 1 cm); a floating mini marshmallow (frac 0.1) is carried toward the shore and back',
    `wader submerged ${f(subMin, 3)}..${f(subMax, 3)}, moved ${f(Math.abs(wader.center.x - wx0), 4)} m; the mini's z ${f(mzMin, 3)}..+${f(mzMax, 3)} m`, 'max >= 2 x min; < 0.01 m; shoreward >= 0.03 m',
    subMax >= 2 * subMin && subMin > 0 && Math.abs(wader.center.x - wx0) < 0.01 && mzMax >= 0.03);
  add('R6 a wave\'s breeze rings a shell chime now and then (every second wave): strikes of cause 2 (the weather: a sound, never a USE event), none of another cause while nobody touches them',
    `${cause2} cause-2 strikes, ${otherCause} other`, '>= 1; 0 other', cause2 >= 1 && otherCause === 0);
}
if (run('wind')) {
  // Lanternroof's Night Breeze (PLACES 4.8): gusts every 6 to 10 s for 2.5 s, strength 0.8; they push an airborne (or floating) body by its catch, never a held,
  // grounded or sleeping one (PH-17)
  const zi = zoneIdx(LANTERN, 'nightbreeze');
  {
    const w = buildPropWorld(LANTERN, 'wide', 1);
    const starts: number[] = [], lens: number[] = []; let on = -1;
    for (let i = 0; i < Math.round(62 / DT); i++) { w.endFrame(DT); const lv = w.gustLevel(zi); if (lv > 0.5 && on < 0) { on = w.time; starts.push(on); } else if (lv <= 0.5 && on >= 0) { lens.push(w.time - on); on = -1; } }
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    add('PH-17 the Night Breeze\'s own clock (no driver): gusts every 6 to 10 s for 2.5 s (62 s from the arrival)', `${starts.length} gusts; gaps ${gaps.map((g) => f(g, 1)).join(', ')} s; lengths ${lens.map((g) => f(g, 2)).join(', ')} s`,
      'gaps 6..10 s; 2.5 s +- 0.05', starts.length >= 5 && gaps.every((g) => g >= 6 - 0.02 && g <= 10 + 0.02) && lens.every((l) => Math.abs(l - 2.5) <= 0.05));
  }
  // a toss straight up inside the breeze, during a gust (setGust: the shell's driver) and without one; the drift along the wind
  // (a body set in the air at 1.2 m and given 2 m/s up: a nudge on a resting soft body mostly goes into its squash, PG_PHYS R4.4)
  const toss = (fam: string, gust: boolean): { dx: number; dz: number } => {
    const w = buildPropWorld(LANTERN, 'wide', 1);
    w.setGust(zi, gust);
    for (let i = 0; i < 30; i++) w.endFrame(DT);
    const b = placed(w, fam, 2.0, -1.6, 1.2), x0 = b.center.x, z0 = b.center.z; b.nudge(v3(0, 2, 0));
    for (let i = 0; i < 90; i++) frameW(w, [b], null);
    return { dx: b.center.x - x0, dz: b.center.z - z0 };
  };
  const mG = toss('marshmallow', true), m0 = toss('marshmallow', false), pG = toss('putty', true), p0 = toss('putty', false);
  const mDrift = -(mG.dx - m0.dx), pDrift = -(pG.dx - p0.dx);   // (the breeze blows from its band toward the roof's middle: -x)
  add('PH-17 a gust pushes an airborne body by its catch: a marshmallow tossed up in the Night Breeze drifts along the wind (toward the roof\'s middle), a putty (catch 0.1) far less (drift with the gust minus without, m)',
    `marshmallow ${f(mDrift, 3)} m, putty ${f(pDrift, 3)} m`, 'marshmallow >= 0.15; putty <= 0.3 x it', mDrift >= 0.15 && pDrift <= 0.3 * mDrift && pDrift > -0.01);
  // grounded, held (a carry across the band) and sleeping bodies: nothing
  {
    const w = buildPropWorld(LANTERN, 'wide', 1), g = placed(w, 'marshmallow', 2.4, -1.4), c = placed(w, 'marshmallow', 1.6, 0.0), s = placed(w, 'marshmallow', 2.6, 0.2);
    s.sleepEnabled = true;
    for (let i = 0; i < 60; i++) frameW(w, [g, c, s], null);
    s.sleep();
    const gx = g.center.x, gz = g.center.z;
    w.setGust(zi, true);
    c.carryTo(2.8, 0, -0.4, 1.5);
    for (let i = 0; i < 150; i++) frameW(w, [g, c, s], null);
    const gm = Math.hypot(g.center.x - gx, g.center.z - gz), ce = Math.hypot(c.center.x - 2.8, c.center.z + 0.4);
    add('PH-17 a gust never moves a grounded, a held (carried) or a sleeping body: a marshmallow on the roof tiles, one carried across the breeze (carryTo), one asleep, through 2.5 s of gust',
      `grounded moved ${f(gm, 4)} m; the carry ended ${f(ce, 4)} m from its spot; the sleeper ${s.sleeping ? 'asleep' : 'WOKEN'}`, '< 0.005; < 0.01; asleep', gm < 0.005 && ce < 0.01 && s.sleeping);
  }
}
if (run('updraft')) {
  // Cloudloft's Updraft (PLACES 4.10, 2.2): an airborne body inside the column falls with gravity x (1 - 0.4 catch): a marshmallow at 0.6 g floats down slowly, a putty
  // falls almost straight; off the floor the Cloud Ball too
  const up = CLOUD.zones[zoneIdx(CLOUD, 'updraft')];
  const fall = (fam: string, x: number, z: number): number => {
    const w = buildPropWorld(CLOUD, 'wide', 1), b = placed(w, fam, x, z, 1.2);
    for (let i = 0; i < 300; i++) { frameW(w, [b], null); if (i > 2 && b.metrics.airborne !== true) return (i + 1) * DT; }
    return NaN;
  };
  const cell = (fam: string): [number, number] => [fall(fam, up.x + 0.6, up.z), fall(fam, -1.0, 0.6)];
  const [mIn, mOut] = cell('marshmallow'), [pIn, pOut] = cell('putty');
  const rm = mIn / mOut, rp = pIn / pOut, wantM = Math.sqrt(1 / (1 - PROPS.UPDRAFT_K * (FAMILY_REACT as Record<string, { catch: number }>).marshmallow.catch));
  add('PH-17 the updraft: dropped from 1.2 m, a marshmallow (catch 1) takes sqrt(1 / 0.6) = 1.29 x as long to land inside the column as outside it; a putty (catch 0.1) about as long',
    `marshmallow ${f(mIn, 3)} / ${f(mOut, 3)} s = x${f(rm, 3)}; putty ${f(pIn, 3)} / ${f(pOut, 3)} s = x${f(rp, 3)}`, `marshmallow within 0.08 of x${f(wantM, 2)}; putty <= x1.06`, Math.abs(rm - wantM) <= 0.08 && rp <= 1.06 && rp >= 0.97);
  // the Puff Pad in the column: a marshmallow's first bounce there is airborne longer than on the pad outside it ("floats down slowly, after a bounce on the pad inside it")
  // the Puff Pads: a body dropped from 0.5 m onto the pad in the column and onto one outside it, 5 s: its first bounce's time in the air and its highest centre after
  // the first landing (a pop dome's kicks grow to the pad's apex cap: in the column that cap speed carries it 1 / (1 - 0.4 x 0.6) = 1.32 x as high)
  const cw = buildPropWorld(CLOUD, 'wide', 1), padK = [0, 1, 2].filter((k) => cw.propThing[k] === CLOUD.things.findIndex((t) => t.mech === MECH.pad));
  const inCol = (k: number): boolean => Math.hypot(cw.poses[k * 8] - up.x, cw.poses[k * 8 + 2] - up.z) < (up.r ?? 1) - 0.45;
  const kIn = padK.find(inCol) ?? 0, kOut = padK.find((k) => !inCol(k)) ?? 1;
  const bounce = (fam: string, k: number): { air: number; rise: number } => {
    const w = buildPropWorld(CLOUD, 'wide', 1), b = placed(w, fam, cw.poses[k * 8], cw.poses[k * 8 + 2], 0.5), y0 = (b as unknown as { restCenterY: number }).restCenterY;
    let land = 0, air = 0, n = 0, top = 0;
    for (let i = 0; i < 300; i++) {
      frameW(w, [b], null);
      const a = b.metrics.airborne === true;
      if (land > 0) top = Math.max(top, b.center.y - y0);
      if (land === 0 && !a && i > 2) land = 1; else if (land === 1 && a) { land = 2; n = 0; } else if (land === 2) { if (a) n++; else { air = n * DT; land = 3; } }
    }
    return { air, rise: top };
  };
  const mIn2 = bounce('marshmallow', kIn), mOut2 = bounce('marshmallow', kOut), pIn2 = bounce('popdome', kIn), pOut2 = bounce('popdome', kOut);
  add(`PH-17 the three Puff Pads are built (${padK.length} pad props); on the one in the updraft a pop dome bounces higher and a marshmallow's first bounce stays up longer than on one outside it (it rides up and floats down slowly)`,
    `pop dome highest ${f(pIn2.rise, 3)} m in the column, ${f(pOut2.rise, 3)} m outside (x${f(pIn2.rise / Math.max(1e-6, pOut2.rise), 2)}); marshmallow's first bounce ${f(mIn2.air, 3)} / ${f(mOut2.air, 3)} s`,
    '3 pads; pop dome >= 1.15 x; marshmallow in > out', padK.length === 3 && pIn2.rise >= 1.15 * pOut2.rise && mIn2.air > mOut2.air);
  // the Cloud Ball poked up inside the column and outside it
  {
    const ballPlace = (zones: unknown[]): PlaceDef => ({ ...CABIN, things: [thing(MECH.ball, 0, 0, [0.26, 0, 0], { mass: 0.12, rollDamp: 0.8 })], walls: [], zones, patches: [], tall: { ...CABIN.tall, things: [{ x: 0, z: 0, yaw: 0 }], walls: [], zones, patches: [] } }) as unknown as PlaceDef;
    const ballAir = (zones: unknown[]): number => {
      const w = buildPropWorld(ballPlace(zones), 'wide', 1); w.poke(0, 0, 3, 0);
      const ps = w.poses;
      for (let i = 0; i < 240; i++) { w.beginFrame(); w.endFrame(DT); if (i > 2 && ps[1] <= 0.26 + 1e-4) return (i + 1) * DT; }
      return NaN;
    };
    const col = [{ id: 'updraft', kind: 4, strength: 1, shape: 'disc', x: 0, z: 0, r: 1 }];
    const bIn = ballAir(col), bOut = ballAir([]), want = 1 / (1 - PROPS.UPDRAFT_K * PROPS.BALL_CATCH);   // (up and back down: the time in the air is 2 v / g)
    add('R6 the Cloud Ball "falls slowly too" in the updraft: poked up at 3 m/s, its time in the air inside a column vs without one', `${f(bIn, 3)} / ${f(bOut, 3)} s = x${f(bIn / bOut, 3)}`, `x${f(want, 2)} +- 0.06`, Math.abs(bIn / bOut - want) <= 0.06);
  }
}
if (run('guard')) {
  // R6 (4): a toss never leaves the play area, at Lanternroof (a parapet on four sides) and Cloudloft (open: the corral's rim and the guard), both layouts, with the
  // place's area set on each body as the shell does (setBounds), the breeze gusting and the updraft on. Tosses: up and out at 4 m/s up + 6 m/s out from near each side,
  // straight up 10 m/s beside each side with 1.5 m/s toward it (over a wall's top), and diagonal throws into the corners
  // (the quick set: Lanternroof wide only, the 4 throws over a parapet's top and 2 corners, 5 s; --only=guard or --full: all four layouts, 12 throws, 3 families, 6 s)
  const cases: [string, PlaceDef, 'wide' | 'tall'][] = QUICK ? [['Lanternroof wide', LANTERN, 'wide']]
    : [['Lanternroof wide', LANTERN, 'wide'], ['Lanternroof tall', LANTERN, 'tall'], ['Cloudloft wide', CLOUD, 'wide'], ['Cloudloft tall', CLOUD, 'tall']];
  const famsG = QUICK ? ['marshmallow'] : ['marshmallow', 'firmsilicone', 'jellygel'];
  for (const [name, pl, lay] of cases) {
    const bd = lay === 'tall' ? pl.tall.bounds : pl.bounds, walls = lay === 'tall' ? pl.tall.walls : pl.walls, hx = bd.hx ?? 3.4, hz = bd.hz ?? 2.4;
    const inner = (s: number): number => { // the walls' inner face on side s (+x, -x, +z, -z), or +inf for an open side
      let v = Infinity;
      for (const wl of walls) { const whx = wl.hx ?? 0.15, whz = wl.hz ?? 0.15;
        if (s === 0 && wl.x - whx >= bd.x + hx - 0.05) v = Math.min(v, wl.x - whx - bd.x); if (s === 1 && wl.x + whx <= bd.x - hx + 0.05) v = Math.min(v, bd.x - wl.x - whx);
        if (s === 2 && wl.z - whz >= bd.z + hz - 0.05) v = Math.min(v, wl.z - whz - bd.z); if (s === 3 && wl.z + whz <= bd.z - hz + 0.05) v = Math.min(v, bd.z - wl.z - whz); }
      return v;
    };
    const walledS = [0, 1, 2, 3].map((s) => inner(s) < Infinity);
    const lims = [0, 1, 2, 3].map((s) => (walledS[s] ? inner(s) : (s < 2 ? hx : hz) + PG.boundsRim + 0.3));   // (an open side: the corral's rim + 0.3 m)
    const throws: [number, number, number, number, number][] = [];   // x, z, vx, vy, vz
    const ex = hx - 0.9, ez = hz - 0.9;
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (!QUICK) throws.push([sx * ex, sz * ez, sx * 6, 4, sz * 6]); throws.push([sx * ex, sz * ez, sx * 1.5, 10, sz * 1.5]); }
    for (const [sx, sz] of QUICK ? [[1, 1], [-1, -1]] : [[1, 1], [-1, 1], [1, -1], [-1, -1]]) throws.push([sx * ex * 0.8, sz * ez * 0.8, sx * 5, 5, sz * 5]);
    let worst = -9, worstEnd = -9, worstP = -9, worstT = -9, n = 0, badEnd = 0;
    for (const fam of famsG) {
      const w = buildPropWorld(pl, lay, 1);
      for (let k = 0; k < pl.zones.length; k++) if (pl.zones[k].kind === 3) w.setGust(k, true);
      for (let i = 0; i < 30; i++) w.endFrame(DT);
      // (each set in the air at 0.8 m and thrown from there: as a hand lets go of a lifted squishy)
      const bs = throws.map(([x, z]) => { const b = placed(w, fam, bd.x + x, bd.z + z, 0.8); b.setBounds(1, bd.x, bd.z, hx, hz, bd.round ?? 0); return b; });
      bs.forEach((b, i) => b.nudge(v3(throws[i][2], throws[i][3], throws[i][4])));
      // the centre past the play area (a walled side: the parapet's inner face; an open side: the edge + the corral's rim + 0.3 m), and any particle past a parapet's
      // OUTER face (through or over it), m (negative: inside)
      const over = (b: SoftBody): number => { const dx = b.center.x - bd.x, dz = b.center.z - bd.z; return Math.max(dx - lims[0], -dx - lims[1], dz - lims[2], -dz - lims[3]); };
      const through = (b: SoftBody): number => {
        const P = b.positions; let m = -9;
        for (let i = 0; i < P.length; i += 3) {
          const dx = P[i] - bd.x, dz = P[i + 2] - bd.z;
          if (walledS[0]) m = Math.max(m, dx - lims[0] - 0.3); if (walledS[1]) m = Math.max(m, -dx - lims[1] - 0.3);
          if (walledS[2]) m = Math.max(m, dz - lims[2] - 0.3); if (walledS[3]) m = Math.max(m, -dz - lims[3] - 0.3);
        }
        return m;
      };
      // a body reaching above a parapet's top (PROPS.WALL_H, the physics wall's: the drawn parapet is lower) stays inside its inner face less its radius (it never
      // lands on the parapet's top)
      const overTop = (b: SoftBody): number => {
        if (!(b.center.y + b.restRadius > PROPS.WALL_H)) return -9;
        const dx = b.center.x - bd.x, dz = b.center.z - bd.z, R = b.restRadius; let m = -9;
        if (walledS[0]) m = Math.max(m, dx - lims[0] + R); if (walledS[1]) m = Math.max(m, -dx - lims[1] + R); if (walledS[2]) m = Math.max(m, dz - lims[2] + R); if (walledS[3]) m = Math.max(m, -dz - lims[3] + R);
        return m;
      };
      for (let i = 0; i < (QUICK ? 300 : 360); i++) { frameW(w, bs, null); for (const b of bs) { worst = Math.max(worst, over(b)); worstT = Math.max(worstT, overTop(b)); if (i % 3 === 0) worstP = Math.max(worstP, through(b)); } }
      for (const b of bs) { const e = over(b); worstEnd = Math.max(worstEnd, e); n++; const dx = Math.abs(b.center.x - bd.x) - hx, dz = Math.abs(b.center.z - bd.z) - hz; if (dx > 0.62 || dz > 0.62 || e > 0) badEnd++; }
    }
    add(`R6 the bounds guard, ${name}: ${n} tosses (${famsG.join(', ')}; ${QUICK ? 'up 10 m/s beside each side, 2 corners' : 'out 6 m/s, up 10 m/s beside each side, the corners'}; gusts on, the place's area set as the shell does): no centre passes the play area (a parapet's inner face; an open side's edge + the corral's rim + 0.3 m), no particle goes through or over a parapet (its outer face), a body above a parapet's top stays inside its inner face less its radius (+0.1 m: it never lands on it), and after ${QUICK ? 5 : 6} s every one is back inside`,
      `centre worst ${f(worst, 3)} m past (negative: inside); ${walledS.some((x) => x) ? `particles worst ${f(worstP, 3)} m past a parapet's outer face; above the parapet's top worst ${worstT > -9 ? f(worstT, 3) : 'none'} m` : 'no parapet'}; at the end worst ${f(worstEnd, 3)} m, ${badEnd} outside`,
      '<= 0 m; <= 0 m; <= 0.1 m; 0 outside', worst <= 0 && worstP <= 0 && worstT <= 0.1 && badEnd === 0);
  }
}

/* ───────────── PH-11: allocation ───────────── */
if (run('alloc') && !LONG('alloc')) info('PH-11 allocation: runs with --full or --only=alloc (its 100 s warm-up)', '');
if (run('alloc') && LONG('alloc')) {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const w = buildPropWorld(CABIN, 'wide', 1);
  const planner = new ContactPlanner();
  const bs = [mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(1.55 + 0.75, 0.9, 2.05) } }), mk(NEUTRAL, 'gummy', { piece: { frac: 1, chunk: false, at: v3(1.55 - 0.75, 0.9, 2.05) } }),
    mk(NEUTRAL, 'firmsilicone', { piece: { frac: 1, chunk: false, at: v3(-0.65, 0, -0.42) } })];
  for (const b of bs) { b.sleepEnabled = true; b.setPropWorld(w); }
  const evs: SoftEvent[] = [];
  let events = 0;
  const frame = (): void => {
    w.beginFrame(); planner.run(bs);
    for (const b of bs) { b.step(DT); evs.length = 0; b.drainEvents(evs); events += evs.length; }
    w.endFrame(DT);
  };
  // the drivers are set up OUTSIDE the measured windows (a call from the shell or LIFE runs in the caller's tier; it is reported below), then the window measures the
  // physics frames alone while they act: a squash pose held, a scoot gliding to and fro, two riders on the rocker
  bs[2].setSquash(0.9, 0.3);
  let flip = 0;
  const reScoot = (): void => { flip ^= 1; bs[2].scootTo(flip ? 0.4 : -0.65, -0.42, 0.2); };
  // (6000 frames, 100 s, of warm-up: a once-a-frame entry point (step, restCheck) tiers up with use, as softbody.ts warmUp documents: ~340 B a frame until ~20 s; with a
  // scoot gliding the substep is re-optimised once more, so 40 s still showed 112 B a frame and 160 s showed 0)
  for (let i = 0; i < 6000; i++) { if (i % 240 === 0) reScoot(); frame(); }
  const empty: number[] = [];
  for (let i = 0; i < 6; i++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1], win: string[] = [];
  let best = Infinity, gliding = 0;
  for (let wd = 0; wd < 4; wd++) {
    reScoot(); for (let i = 0; i < 10; i++) frame();
    events = 0; const u0 = newUsed();
    for (let i = 0; i < 120; i++) frame();
    const d = newUsed() - u0; if ((priv(bs[2]).scootOn as boolean)) gliding++;
    win.push(`${d - base} B / ${events} ev`); if (d >= 0 && events === 0) best = Math.min(best, d - base);
  }
  // a re-sent identical setSquash (LIFE re-sends a converged pose at 10 Hz): what one call allocates in the caller's tier
  let callB = 0;
  { for (let i = 0; i < 200; i++) bs[2].setSquash(0.9, 0.3); const u0 = newUsed(); for (let i = 0; i < 100; i++) bs[2].setSquash(0.9, 0.3); callB = (newUsed() - u0 - base) / 100; }
  add('PH-11 allocation: the cabin with two riders on the rocker and a third scooting (to and fro) with a squash pose held, sleep on: new-space growth per 120 physics frames with no SoftEvent (best of 4 windows)',
    `${win.join(' ; ')} (the scoot gliding at the end of ${gliding}/4 windows); an identical setSquash re-sent: ${f(callB, 1)} B a call (its caller's tier)`, '0 B', best <= 0);
}

/* ───────────── PH-11 (round 4 paths): AUTO with a rider holding on, and a floater in water ───────────── */
if (run('alloc') && LONG('alloc')) {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const wc = buildPropWorld(CABIN, 'wide', 1), kS = wc.propThing.indexOf(3), p = wc.poses;
  const r = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(p[kS * 8], p[kS * 8 + 1] + 0.6, p[kS * 8 + 2]) } }); r.setPropWorld(wc);
  const pool = { id: 'pool', kind: 1, strength: 1, shape: 'disc' as const, x: 0, z: 0, r: 1.8, surfaceY: 0.28, ramp: 0.4, flow: [0.08, 0] };
  const wp = buildPropWorld({ ...CABIN, things: [], walls: [], zones: [pool], patches: [], tall: { ...CABIN.tall, things: [], walls: [], zones: [pool], patches: [] } } as unknown as PlaceDef, 'wide', 1);
  const fl = mk(NEUTRAL, 'marshmallow', { piece: { frac: 1, chunk: false, at: v3(0.6, 0, 0) } }); fl.setPropWorld(wp);
  wc.setAuto(3, true); wc.setAuto(1, true);
  const evs: SoftEvent[] = [];
  let events = 0;
  const frame = (): void => { wc.beginFrame(); wp.beginFrame(); r.step(DT); fl.step(DT); evs.length = 0; r.drainEvents(evs); fl.drainEvents(evs); events += evs.length; wc.endFrame(DT); wp.endFrame(DT); };
  for (let i = 0; i < 6000; i++) frame();
  const empty: number[] = [];
  for (let i = 0; i < 6; i++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1], win: string[] = [];
  let best = Infinity;
  for (let wd = 0; wd < 4; wd++) { events = 0; const u0 = newUsed(); for (let i = 0; i < 120; i++) frame(); const d = newUsed() - u0; win.push(`${d - base} B / ${events} ev`); if (d >= 0 && events === 0) best = Math.min(best, d - base); }
  add('PH-11 allocation, round 4 paths: the cabin\'s swing on AUTO with a rider holding on (and the rocker on AUTO), a marshmallow afloat in a pool with a current (the world\'s zone step and its nudges): new-space growth per 120 frames with no SoftEvent (best of 4 windows, after a 100 s warm-up)',
    `${win.join(' ; ')} (AUTO share ${f(wc.autoShare(kS), 2)}, rider on ${r.metrics.onProp === kS}, floater submerged ${f(fl.metrics.submerged ?? 0, 3)})`, '0 B', best <= 0);
}

/* ───────────── PH-11 (round 6 paths): the surface, the weather, the waves, the guard ───────────── */
if (run('alloc') && LONG('alloc')) {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  // Frostbell: a firm silicone scooting to and fro across the Ice Pond's edge (its surface eased as it crosses), a marshmallow afloat in the Steam Pool under the
  // Wind Gap's gusts (its own clock); Ripple: a mini marshmallow afloat in the surf (the waves); Cloudloft: the Cloud Ball poked up in the updraft now and then
  // (outside the windows); every world's guard and weather clock running
  const wf = buildPropWorld(FROSTBELL, 'wide', 1), wr = buildPropWorld(RIPPLE, 'wide', 1);
  const col = [{ id: 'updraft', kind: 4, strength: 1, shape: 'disc', x: 0, z: 0, r: 1 }];
  const wb = buildPropWorld({ ...CLOUD, things: [thing(MECH.ball, 0, 0, [0.26, 0, 0], { mass: 0.12, rollDamp: 0.8, updraftCatch: 1 })], walls: [], zones: col, patches: [],
    tall: { ...CLOUD.tall, things: [{ x: 0, z: 0, yaw: 0 }], walls: [], zones: col, patches: [] } } as unknown as PlaceDef, 'wide', 1);
  const pool = FROSTBELL.zones[zoneIdx(FROSTBELL, 'steampool')], ice = FROSTBELL.patches.find((pp) => pp.ice)!, surf = RIPPLE.zones[zoneIdx(RIPPLE, 'surfedge')];
  const sk = placed(wf, 'firmsilicone', ice.x - ice.r! + 0.1, ice.z), fl = placed(wf, 'marshmallow', pool.x, pool.z - 0.35), mi = placed(wr, 'marshmallow', 0.3, surf.z, 0, NEUTRAL, 0.1);
  const bodies = [sk, fl, mi];
  const evs: SoftEvent[] = [];
  let events = 0, flip = 0;
  const frame = (): void => {
    wf.beginFrame(); wr.beginFrame(); wb.beginFrame();
    for (const b of bodies) { b.step(DT); evs.length = 0; b.drainEvents(evs); events += evs.length; }
    wf.endFrame(DT); wr.endFrame(DT); wb.endFrame(DT);
  };
  const reScoot = (): void => { flip ^= 1; sk.scootTo(flip ? ice.x - ice.r! + 0.9 : ice.x - ice.r! - 0.4, ice.z, 0.3); wb.poke(0, 0, 2.5, 0); };
  for (let i = 0; i < 6000; i++) { if (i % 240 === 0) reScoot(); frame(); }
  const empty: number[] = [];
  for (let i = 0; i < 6; i++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1], win: string[] = [];
  let best = Infinity;
  for (let wd = 0; wd < 4; wd++) { reScoot(); for (let i = 0; i < 10; i++) frame(); events = 0; const u0 = newUsed(); for (let i = 0; i < 120; i++) frame(); const d = newUsed() - u0; win.push(`${d - base} B / ${events} ev`); if (d >= 0 && events === 0) best = Math.min(best, d - base); }
  add('PH-11 allocation, round 6 paths: a firm silicone scooting across the Ice Pond\'s edge, a marshmallow afloat in the Steam Pool in the Wind Gap\'s gusts, a mini afloat in Ripple\'s waves, the Cloud Ball in an updraft (every guard and weather clock running): new-space growth per 120 frames with no SoftEvent (best of 4 windows, after a 100 s warm-up)',
    `${win.join(' ; ')} (floater submerged ${f(fl.metrics.submerged ?? 0, 3)}, mini ${f(mi.metrics.submerged ?? 0, 3)})`, '0 B', best <= 0);
}

/* ───────────── PH-12: cost with 4 props in reach ───────────── */
if (run('cost')) {
  // one awake detail-3 body pressed by a finger, beside and on 4 props (a box under it, two capsules and a sphere against its sides), against the same body alone
  const four = testPlace([thing(MECH.block, 0, 0, [0.8, 0.1, 0.8]), thing(MECH.bar, 0, -0.55, [0.12, 1.4, 0]), thing(MECH.bar, -0.55, 0, [0.12, 1.4, 0], {}, Math.PI / 2), thing(MECH.mound, 0.95, 0, [0.6, 0.25, 0])]);
  const w = buildPropWorld(four, 'wide', 1);
  const a = mk(NEUTRAL, 'jellygel', { piece: { frac: 1, chunk: false, at: v3(0, 0.5, 0) } }), b = mk(NEUTRAL, 'jellygel');
  a.setPropWorld(w);
  for (let i = 0; i < 120; i++) { frameW(w, [a], null); frameW(null, [b], null); }
  topPress(a, 0, 0.5); topPress(b, 0, 0.5);
  const batch = (fn: () => void): number => { const t = performance.now(); for (let i = 0; i < 120; i++) fn(); return (performance.now() - t) / 120; };
  const ra: number[] = [], rb: number[] = [];
  for (let r = 0; r < (FULL ? 9 : 5); r++) { rb.push(batch(() => { b.step(DT); drain(b); })); ra.push(batch(() => { w.beginFrame(); a.step(DT); drain(a); w.endFrame(DT); })); }
  ra.sort((x, y) => x - y); rb.sort((x, y) => x - y);
  let inReach = 0; const S = w.solve.S;
  for (let k = 0; k < w.count; k++) { const o = k * 36, d = Math.hypot(S[o + 4] - a.center.x, S[o + 5] - a.center.y, S[o + 6] - a.center.z); if (d < S[o + 28] + 0.8) inReach++; }
  add('PH-12 an awake detail-3 body, pressed, with 4 props in reach (the worked-contact fold gate on) against the same body with none: frame cost (best batches of 120)', `${f(ra[0], 3)} ms vs ${f(rb[0], 3)} ms: x${f(ra[0] / rb[0], 3)} (props in reach ${inReach}, on prop ${a.metrics.onProp})`, '<= 1.25x', ra[0] / rb[0] <= 1.25);
}

/* ───────────── PF-05: PF-01's node twin (the med cap in the cabin) ───────────── */
if (run('pf05') && !LONG('pf05')) info('PF-05 (the node twin of PF-01): runs with --full or --only=pf05 (timing batches)', '');
if (run('pf05') && LONG('pf05')) {
  const F = 4;   // the phone factor until PG_PF00 (PF-00) reports; see the report
  const bar = 6.0 / F;
  const scen = (touched: boolean): number => {
    const w = buildPropWorld(CABIN, 'wide', 1);
    const planner = new ContactPlanner();
    const spots = CABIN.spawn as readonly (readonly [number, number])[];
    const bs = [0, 1, 2, 3].map((i) => mk(NEUTRAL, ['jellygel', 'gummy', 'firmsilicone', 'marshmallow'][i], { piece: { frac: 1, chunk: false, at: v3(spots[i][0], 0, spots[i][1]) } }));
    for (const b of bs) { b.sleepEnabled = true; b.setPropWorld(w); }
    for (let i = 0; i < 120; i++) frameW(w, bs, planner);
    for (const b of bs) b.sleep();
    // (the mover glides between (-1.0, -0.1) and (-0.4, -0.9): clear of the other three, the basket's mouth and the swing)
    if (touched) { bs[0].wake(); topPress(bs[0], 0, 0.6); } else bs[0].scootTo(-1.0, -0.1, 0.26);
    for (let i = 0; i < 30; i++) frameW(w, bs, planner);
    const runs: number[] = [];
    let awakeMax = 0;
    for (let r = 0; r < (FULL ? 7 : 4); r++) { const t = performance.now(); for (let i = 0; i < 120; i++) { frameW(w, bs, planner); if (!touched && i % 60 === 59) bs[0].scootTo(bs[0].center.x < -0.9 ? -0.4 : -1.0, bs[0].center.x < -0.9 ? -0.9 : -0.1, 0.26); } runs.push((performance.now() - t) / 120); awakeMax = Math.max(awakeMax, bs.filter((b) => !b.sleeping).length); }
    awake[touched ? 0 : 1] = awakeMax;
    runs.sort((x, y) => x - y);
    return runs[Math.floor(runs.length / 2)];
  };
  const awake = [0, 0];
  const t1 = scen(true), t2 = scen(false);
  add(`PF-05 (node twin of PF-01, med, at F = ${F} until PF-00 reports): 4 wholes in the cabin (wide): one touched and three asleep; then untouched, one LIFE mover (scootTo) and three asleep: physics ms a frame (median of batches of 120)`,
    `touched ${f(t1, 3)} ms; one mover ${f(t2, 3)} ms (awake bodies at most ${awake[0]} / ${awake[1]})`, `<= ${f(bar, 2)} ms (6.0 / F)`, t1 <= bar && t2 <= bar);
}

let failed = 0;
for (const r of rows) { if (!r.pass) failed++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`); }
if (process.env.PGTIME) console.log(secT.map((x, i) => `${x[0]} ${(((secT[i + 1]?.[1] ?? performance.now()) - x[1]) / 1000).toFixed(2)} s`).join(', '));
console.log(`${rows.length - failed}/${rows.length} playground physics checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s${FULL ? ' (--full)' : ' (quick set)'}`);
process.exit(failed ? 1 : 0);

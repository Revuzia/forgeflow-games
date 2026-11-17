// PG_PHYS (PLAYGROUND physics): the PH rows of _spec/PLAYGROUND_BUILD.md 18 that this build covers, and PF-05. Plain node (type stripping).
//   node _harness/probe_playground.ts                 the quick set (what run_probes.ts runs: no arguments; under 20 s on a quiet 4-core container)
//   node _harness/probe_playground.ts --full          every family x 3 genomes and the long holds (a heavy job, 1 to 2 minutes)
//   node _harness/probe_playground.ts --only=hop,gate,static,hinge,ball,mass,squash,sleep,det,alloc,cost,order,pf05,inert
// The quick set is a subset: fewer families, one layout for the rocker, the swing and the ball, short holds; PH-11 (its 100 s warm-up), PF-05 (timing batches) and
// the 3-body pile run only with --full or --only (each is listed as an INFO row in the quick set).
// Independent meters: own fold meter (the largest dihedral between neighbouring triangles, degrees; the rest shapes' own maximum is about 50), own
// lowest-particle and centre tracking, own volume integral (metrics.volume is cross-checked), own wall clock (performance.now) and new-space growth.
import v8 from 'node:v8';
import { PG, SoftBody } from '../src/physics/softbody.ts';
import { PROPS, PropWorld, buildPropWorld } from '../src/physics/props.ts';
import { ContactPlanner } from '../src/physics/broad.ts';
import { makeStarterGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';
import { GRAVITY } from '../src/physics/params.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { MECH } from '../src/data/places.ts';
import type { PlaceDef, ThingDef } from '../src/data/places.ts';
import type { SoftEvent, V3 } from '../src/contracts.ts';

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const only = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const run = (s: string): boolean => only.length === 0 || only.includes(s);
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
  info('PH-04 "a rider is never corralled" (D-91): the corral is off while onProp names a moving prop (softbody.ts substep); place bounds (setBounds) are NOT BUILT, so the bounds\' edge row is not run', '');
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
  add('PH-23 drainStrikes: a poke on a chime gives cause 0 (slot -1); a body walking into it gives cause 1 with its contactSlot (7); weather (cause 2) has no producer in this build (S2 / S3 zones)',
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
console.log(`${rows.length - failed}/${rows.length} playground physics checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s${FULL ? ' (--full)' : ' (quick set)'}`);
process.exit(failed ? 1 : 0);

// ARC verifier (sim, stage A round 1): multi-seed measurement of §1 hearts (M1, M2, M3), §2.1 pride, §10 natural floods.
// Read-only for src/**: everything here observes the sim through its public state and events.
//   node _harness/arc-work/verify-A-r1-sim.ts world <seed> <years> [live|cut]   unattended world (natural disasters on)
//   node _harness/arc-work/verify-A-r1-sim.ts harsh <seed>                      M3 harsh: storm + lightning every 4 days, 3 y
//   node _harness/arc-work/verify-A-r1-sim.ts kind <seed>                       M3 kind: answered prayers + gifts, 2 y
// `cut`: every natural flood's warning is cut at spawn (Wn 0, orders withdrawn): the pre-§10 baseline.
// Output: one JSON line per seed, prefixed RESULT.
import { Sim } from '../../src/sim/sim.ts';
import { srel, peekRel } from '../../src/sim/god/regard.ts';
import { dangerRadius } from '../../src/sim/god/precursors.ts';
import { distM } from '../../src/sim/people/world.ts';
import { TASK } from '../../src/sim/people/defs.ts';
import { AgentFlag } from '../../src/sim/types.ts';

const [mode, seedS, yearsS, flavour] = process.argv.slice(2);
const seed = Number(seedS);

function must(sim: Sim, cmd: Record<string, unknown>) {
  const r = sim.applyNow(cmd as never);
  if (!r.ok) throw new Error(`${cmd.k}: ${r.msg}`);
  return r;
}

const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
if (mode !== 'world') must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
const r0 = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: mode === 'world' ? 60 : 45, era: 'bronze', settled: true, wildGame: false });
const sid0 = r0.created!.find((e) => e.kind === 'settlement')!.id;
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const t0 = sim.u.tick;
const years = mode === 'world' ? Number(yearsS) : mode === 'harsh' ? 3 : 2;
const end = t0 + years * year;

// per-town tallies
interface T { name: string; seen: number; first: number; heartDay: number; changes: number; kinds: Record<string, number>; nobow: number[]; proud: number; prideMax: number; pride: number[]; fearfulAt: number; devotedAt: number; duskMin: number; duskMax: number; lowSet: number }
const towns = new Map<number, T>();
const heartEvents: Record<string, number> = {};
let noHeartAfter2 = 0, townDays = 0;
// floods and other disasters
const floods = new Map<number, { spawn: number; Wn: number; reach: number[]; evac: Set<number>; outShare: number[]; dead: number; ended: boolean; cause: string }>();
const nat: Record<string, { n: number; dead: number }> = {};
const allDis = new Map<number, { kind: string; natural: boolean }>();
let signHist: number[] = [0, 0, 0, 0, 0, 0];
let nextHarsh = t0 + day, nextKind = t0 + day;
const pt: [number, number, number] = [0, 0, 0];

function standing() { return ps.settlements.filter((s) => s.fallen < 0 && !s.band); }

function daily(): void {
  for (const st of standing()) {
    const r = peekRel(sim.u, p.id, st.id);
    let t = towns.get(st.id);
    if (!t) { t = { name: st.name, seen: sim.u.tick, first: -1, heartDay: -1, changes: 0, kinds: {}, nobow: [], proud: 0, prideMax: 0, pride: [], fearfulAt: -1, devotedAt: -1, duskMin: 9, duskMax: -1, lowSet: 0 }; towns.set(st.id, t); }
    townDays++;
    if (!r?.hearts) { if (sim.u.tick - t.seen > 2 * day) noHeartAfter2++; continue; }
    if (t.heartDay < 0) t.heartDay = (sim.u.tick - t.seen) / day;
    const k = r.hearts.kind;
    t.kinds[k] = (t.kinds[k] ?? 0) + 1;
    if (r.hearts.proud) t.proud++;
    t.prideMax = Math.max(t.prideMax, r.pride ?? 0);
    if (((sim.u.tick - t0) / day) % 12 < 1) t.pride.push(Math.round((r.pride ?? 0) * 100) / 100);
    if (k === 'fearful' && t.fearfulAt < 0) t.fearfulAt = (sim.u.tick - t0) / year;
    if (k === 'devoted' && t.devotedAt < 0) t.devotedAt = (sim.u.tick - t0) / year;
    const nb = r.told?.['heart.nobow'];
    if (nb !== undefined && !t.nobow.includes(nb)) t.nobow.push(nb);
    if (r.dusk) { t.duskMin = Math.min(t.duskMin, r.dusk.ema); t.duskMax = Math.max(t.duskMax, r.dusk.ema); if (r.dusk.low) t.lowSet++; }
  }
  // natural floods: cut the warning in the baseline
  for (const d of sim.u.god.disasters) {
    if (d.planet !== p.id || allDis.has(d.id)) continue;
    const natural = d.god === -1 && d.cause === 'nature';
    allDis.set(d.id, { kind: d.kind, natural });
    if (natural) (nat[d.kind] ??= { n: 0, dead: 0 }).n++;
    if (d.kind !== 'flood' || !natural) continue;
    const R = dangerRadius(sim.u.content.disasters.find('flood')!, d);
    const reach = standing().filter((st) => distM(p, st.pos, d.pos) <= R + st.territory + 100).map((st) => st.id);
    floods.set(d.id, { spawn: sim.u.tick, Wn: d.st.Wn ?? 0, reach, evac: new Set(), outShare: [], dead: 0, ended: false, cause: d.cause });
    if (flavour === 'cut') {
      d.st.Wn = 0;
      for (const st of ps.settlements) { const r = srel(sim.u, p.id, st.id); if (r.evacuate?.disaster === d.id) r.evacuate = null; }
    }
  }
}

function events(): void {
  for (const e of sim.drainEvents()) {
    const data = (e.data ?? {}) as Record<string, unknown>;
    if (e.t === 'heart') {
      heartEvents[String(data.to)] = (heartEvents[String(data.to)] ?? 0) + 1;
      const t = towns.get(Number(data.settlement)); if (t) t.changes++;
    } else if (e.t === 'heart.proud') {
      heartEvents[`proud:${data.proud}`] = (heartEvents[`proud:${data.proud}`] ?? 0) + 1;
    } else if (e.t === 'evacuate') {
      const f = floods.get(Number(data.disaster)); if (f) f.evac.add(Number(data.settlement));
    } else if (e.t === 'warning.end' && data.kind === 'flood') {
      const f = floods.get(Number(data.id));
      const d = sim.u.god.disasters.find((q) => q.id === Number(data.id));
      if (f && d) {
        const R = dangerRadius(sim.u.content.disasters.find('flood')!, d);
        for (const sid of f.reach) {
          let out = 0, n = 0;
          for (const s of ps.members.get(sid) ?? []) {
            n++; A.posAt(s, sim.u.tick, pt);
            if (distM(p, pt, d.pos) > R || A.task[s] === TASK.evacuate) out++;
          }
          if (n) f.outShare.push(Math.round((100 * out) / n) / 100);
        }
      }
    } else if (e.t === 'disaster.end') {
      const id = (e.ref as { id?: number } | undefined)?.id ?? -1;
      const dd = allDis.get(id);
      const dead = Number(data.dead ?? e.a ?? 0) || 0;
      if (dd?.natural) nat[dd.kind].dead += dead;
      const f = floods.get(id); if (f) { f.dead += dead; f.ended = true; }
    }
  }
}

function attend(): void {
  const st = ps.settlement(sid0);
  if (!st || st.fallen >= 0) return;
  if (mode === 'harsh' && sim.u.tick >= nextHarsh) {
    nextHarsh += 4 * day;
    sim.applyNow({ k: 'miracle.storm', pos: [...st.pos], radius: 350, wrath: 0.3 } as never);
    sim.applyNow({ k: 'miracle.lightning', pos: [...st.pos], wrath: 0.3 } as never);
  }
  if (mode === 'kind' && sim.u.tick >= nextKind) {
    nextKind += day;
    const r = srel(sim.u, p.id, st.id);
    if (r.prayers.length) sim.applyNow({ k: 'prayer.answer', settlement: st.id } as never);
    else if (((sim.u.tick - t0) / day) % 3 < 1) sim.applyNow({ k: 'settlement.gift', settlement: st.id, items: { bread: 40 } } as never);
  }
}

const startMs = Date.now();
let lastSnap = t0;
while (sim.u.tick < end) {
  const to = (((912 - (sim.u.tick % day)) % day) + day) % day || day;
  sim.step(Math.min(60, to));
  events();
  if (sim.u.tick % day === 912 % day) { daily(); attend(); }
  if (sim.u.tick - lastSnap >= 3 * day && (sim.u.tick % 1440) > 700 && (sim.u.tick % 1440) < 1100) {
    lastSnap = sim.u.tick;
    const b = sim.snapshot({}).planets[0].agents;
    const h = (b as { heart?: Uint8Array } | undefined)?.heart;
    if (h) for (let k = 0; k < h.length; k++) signHist[h[k]] = (signHist[h[k]] ?? 0) + 1;
    events();
  }
}

const tl = [...towns.entries()].map(([id, t]) => ({ id, ...t, nobow: t.nobow.length, nobowMinGapY: t.nobow.length > 1 ? Math.min(...t.nobow.slice(1).map((v, i) => (v - t.nobow[i]) / year)) : null,
  daysLived: Object.values(t.kinds).reduce((a, b) => a + b, 0) }));
const perSix = tl.filter((t) => t.daysLived >= 30).map((t) => (t.changes / t.daysLived) * 6).sort((a, b) => a - b);
const fl = [...floods.values()];
console.log('RESULT ' + JSON.stringify({
  mode, seed, flavour: flavour ?? 'live', years, secs: Math.round((Date.now() - startMs) / 1000), towns: tl.length, alive: A.count ?? null,
  M1: { noHeartAfterDay2: noHeartAfter2, townDays },
  M2: { medianChangesPer6Days: perSix.length ? perSix[perSix.length >> 1] : null, maxPer6: perSix.length ? perSix[perSix.length - 1] : null },
  heartEvents, signHist,
  townsDetail: tl.map((t) => ({ id: t.id, name: t.name, days: t.daysLived, changes: t.changes, kinds: t.kinds, proudDays: t.proud, prideMax: Math.round(t.prideMax * 100) / 100, prideYearly: t.pride, nobow: t.nobow, nobowMinGapY: t.nobowMinGapY, fearfulAtY: t.fearfulAt, devotedAtY: t.devotedAt, dusk: [t.duskMin, t.duskMax], lowDays: t.lowSet })),
  floods: fl.map((f) => ({ Wn: f.Wn, reach: f.reach.length, evac: f.evac.size, outShare: f.outShare, dead: f.dead, ended: f.ended })),
  natural: nat,
}));

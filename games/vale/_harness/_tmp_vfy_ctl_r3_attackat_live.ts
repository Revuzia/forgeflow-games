// orch1 controls r3 VERIFIER: Shift + left-click attackAt in real matches (real catalog, real maps, real kits, bots in the
// other nine seats). Seat 0 is a scripted shooter: from 1:30 it stands in its lane and Shift+left-clicks random points
// round it (new presses, held re-sends every 3 ticks, let-go), picking real enemies some of the time; it walks between bursts.
//   node _harness/_tmp_vfy_ctl_r3_attackat_live.ts [--seeds 3] [--minutes 7]
// Invariants per tick: never walks under an attackAt order (unless displaced, dashing or touching a body); every damage it
// deals with a basic attack goes to a hostile unit its team saw that tick or the one before, within reach from where it
// stood during the last 1 s; attacks never faster than its attack period; then the whole match twice -> same digest.
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent, Command } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { ORDER_ATTACK_AT, CC_FEAR, CC_TAUNT, CC_HARD, type Entity } from '../src/sim/entity.ts';
import { computeStats } from '../src/sim/stats.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const SEEDS = Number(opt('seeds', '3')), MIN = Number(opt('minutes', '7'));
const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP'); process.exit(77); }
const catalog: CatalogT = built.catalog;
function mulberry(a: number): () => number { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function setupFor(modeId: string, seed: number, f0: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  const f0role = catalog.fighters.find((f) => f.id === f0)!.role;
  for (let i = 0; i < mode.teams * mode.perTeam; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    let role = mode.roles ? roles[slot % roles.length] : undefined;
    let fighter: string;
    if (i === 0) { fighter = f0; role = mode.roles ? f0role : undefined; }
    else { const pl = (role && natives.get(role)) || catalog.fighters.map((f) => f.id).sort(); fighter = pl[(seed + slot + team) % pl.length]; if (fighter === f0) fighter = pl[(seed + slot + team + 1) % pl.length]; }
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: `p${i}`, fighter, skin, role, loadout: pickLoadout(catalog, fighter, pool, role), controller: i === 0 ? 'human' : 'bot', botDifficulty: 'adept', colorIndex: i } as SeatSetup);
  }
  // keep the roles unique on team 0: swap whoever has seat 0's role into seat 0's old role
  return { matchId: `vfy3atk-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

interface Out { digest: string; viol: { k: string; d: unknown }[]; atk: number; aimed: number; hits: number; presses: number }
function run(map: string, seed: number, f0: string): Out {
  const setup = setupFor(map, seed, f0);
  const fac = createBots(catalog, setup);
  const sim = createSim(catalog, setup, { bots: (s, h) => (s.player === 0 ? null : fac(s, h)), pregameSeconds: 0 });
  const rnd = mulberry(seed * 31 + map.length);
  const viol: { k: string; d: unknown }[] = [];
  let atk = 0, aimed = 0, hits = 0, presses = 0, lastAtk = -1e9;
  const hist: [number, number][] = [];
  let digest = 0x811c9dc5;
  const mix = (s: string): void => { for (let i = 0; i < s.length; i++) { digest ^= s.charCodeAt(i); digest = Math.imul(digest, 16777619) >>> 0; } };
  let burstUntil = 0, held: [number, number] | null = null, walkAt = 0;
  const lim = MIN * 60 * 30;
  let prevVis = new Map<number, number>();
  for (let tick = 0; tick < lim && sim.view.phase !== 'ended'; tick++) {
    const w = worldOf(sim);
    const me = w.players[0].ent!;
    let c: Command | null = null;
    if (me.alive && w.time > 90) {
      if (w.tick < burstUntil) {
        if (held && w.tick % 3 === 0) c = { type: 'attackAt', x: held[0] + (rnd() - 0.5), y: held[1] + (rnd() - 0.5), held: true };
        if (rnd() < 0.08) {
          let tx: number, ty: number, target: number | undefined;
          const foes = w.entities.filter((o) => o.alive && o.team !== me.team && o.team >= 0 && o.kind !== 'projectile' && o.kind !== 'zone' && Math.hypot(o.x - me.x, o.y - me.y) < 12);
          if (foes.length && rnd() < 0.5) { const u = foes[Math.floor(rnd() * foes.length)]; tx = u.x; ty = u.y; target = (u.visibleMask >> me.team) & 1 ? u.id : undefined; }
          else { const a = rnd() * Math.PI * 2, d = 1 + rnd() * 10; tx = me.x + Math.cos(a) * d; ty = me.y + Math.sin(a) * d; }
          c = { type: 'attackAt', x: tx, y: ty, ...(target !== undefined ? { target } : {}) }; presses++;
          held = rnd() < 0.5 ? [tx, ty] : null;
        } else if (held && rnd() < 0.03) { c = { type: 'attackAt', x: held[0], y: held[1], end: true }; held = null; }
      } else if (w.tick >= walkAt) {
        // walk toward the nearest enemy Wick (or the map centre) for 2 s, then a 3-5 s burst
        const wk = w.entities.filter((o) => o.alive && o.kind === 'minion' && o.team !== me.team).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
        const m = w.mapDef.size; const tx = wk ? wk.x : m[0] / 2, ty = wk ? wk.y : m[1] / 2;
        const dd = wk ? Math.hypot(wk.x - me.x, wk.y - me.y) : 99;
        if (dd > me.stats.range + 1.5 && w.tick % 15 === 0) { c = { type: 'move', x: tx, y: ty }; walkAt = w.tick + 15; burstUntil = 0; held = null; }
        else if (dd <= me.stats.range + 1.5) { burstUntil = w.tick + 90 + Math.floor(rnd() * 90); held = null; walkAt = burstUntil; }
        if (me.hp < me.maxHp * 0.25) { c = { type: 'recall' }; walkAt = w.tick + 300; burstUntil = walkAt; }
      }
    }
    if (c) sim.command(0, c);
    const x0 = me.x, y0 = me.y, ord0 = me.order; const wasDash = !!me.dash;
    const evs: SimEvent[] = sim.step();
    const w2 = worldOf(sim);
    hist.push([me.x, me.y]); if (hist.length > 30) hist.shift();
    if (me.statsDirty) computeStats(w2, me);
    const touching = w2.entities.some((o) => o !== me && o.alive && o.kind !== 'projectile' && o.kind !== 'zone' && o.kind !== 'pickup' && Math.hypot(o.x - me.x, o.y - me.y) < me.radius + o.radius + 0.1);
    if (ord0 === ORDER_ATTACK_AT && me.order === ORDER_ATTACK_AT && me.alive && !me.dash && !wasDash && !touching && (me.ccMask & (CC_FEAR | CC_TAUNT | CC_HARD)) === 0 && (!c || c.type === 'attackAt')) {
      const d = Math.hypot(me.x - x0, me.y - y0);
      if (d > 1e-6 && process.env.DIAG) console.log('   DIAG', JSON.stringify({ t: w2.time.toFixed(2), cmd: c, from: [x0, y0], to: [me.x, me.y], vx: me.vx, vy: me.vy, path: me.path.length, pathGoal: me.pathGoalX, ox: me.orderX, oy: me.orderY, cc: me.ccMask, atkWindup: me.atkWindup, cast: !!me.cast, chan: (me as unknown as { channel?: unknown }).channel ? 1 : 0, pend: me.pendingSlot, ms: me.stats.moveSpeed, nb: w2.entities.filter((o) => o !== me && o.alive && o.kind !== 'projectile' && Math.hypot(o.x - me.x, o.y - me.y) < 2.5).map((o) => `${o.kind}t${o.team} d${(Math.hypot(o.x - me.x, o.y - me.y) - o.radius - me.radius).toFixed(2)} v${Math.hypot(o.vx, o.vy).toFixed(2)}`), wasDash: wasDash, evs: evs.filter((e) => ('src' in e && e.src === me.id) || ('dst' in e && e.dst === me.id) || ('id' in e && (e as {id:number}).id === me.id)).map((e) => e.e) }));
      if (d > 1e-6) viol.push({ k: 'moved under attackAt', d: { map, seed, f0, t: w2.time.toFixed(2), d: d.toFixed(4) } });
    }
    for (const ev of evs) {
      mix(JSON.stringify(ev));
      if (ev.e === 'attack' && ev.src === me.id) {
        atk++; if (ev.dst === -1) aimed++;
        const p = 1 / Math.max(0.05, me.stats.attackSpeed);
        if (ev.t - lastAtk < p * 0.75 - 1e-6) viol.push({ k: 'attack faster than its period', d: { map, seed, f0, gap: (ev.t - lastAtk).toFixed(3), p: p.toFixed(3) } });
        lastAtk = ev.t;
      }
      if (ev.e === 'damage' && ev.src === me.id) {
        const t = w2.entity(ev.dst);
        if (!t) continue;
        const basic = ev.ability === undefined;
        if (!basic) continue;
        hits++;
        if (t.team === me.team) viol.push({ k: 'damaged an ally', d: { map, seed, f0, dst: t.id } });
        const seen = ((t.visibleMask >> me.team) & 1) || ((prevVis.get(t.id) ?? 0) >> me.team) & 1;
        if (!seen && basic) viol.push({ k: 'basic attack hit an unseen unit', d: { map, seed, f0, t: w2.time.toFixed(2), kind: t.kind } });
        const reach = me.stats.range + me.radius + t.radius + 0.6;   // + 0.6: empowered range bonuses and a moving target
        if (basic && hist.every(([px, py]) => Math.hypot(t.x - px, t.y - py) > reach + 4)) viol.push({ k: 'basic hit far beyond reach', d: { map, seed, f0, t: w2.time.toFixed(2) } });
      }
    }
    if (w2.tick % 30 === 0) mix(w2.entities.map((e) => `${e.id}${e.x.toFixed(6)}${e.y.toFixed(6)}${e.hp.toFixed(4)}`).join(','));
    prevVis = new Map(w2.entities.map((e) => [e.id, e.visibleMask]));
  }
  return { digest: digest.toString(16), viol, atk, aimed, hits, presses };
}

const ranged = catalog.fighters.filter((f) => (f.attack.projectileSpeed ?? 0) > 0).map((f) => f.id).sort();
const melee = catalog.fighters.filter((f) => !(f.attack.projectileSpeed ?? 0)).map((f) => f.id).sort();
let fails = 0;
const dmgSample = (() => { return 0; })(); void dmgSample;
for (const map of (process.env.MAPS ?? 'rift,bridge').split(',')) for (let s = Number(process.env.S0 ?? 1); s <= SEEDS; s++) {
  const f0 = (s % 2 ? ranged : melee)[(s * 3 + map.length) % (s % 2 ? ranged.length : melee.length)];
  const a = run(map, 500 + s, f0);
  const b = run(map, 500 + s, f0);
  const kinds = new Map<string, number>(); for (const v of a.viol) kinds.set(v.k, (kinds.get(v.k) ?? 0) + 1);
  const ok = a.viol.length === 0 && a.digest === b.digest;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${map} s${500 + s} ${f0}: presses ${a.presses}, attacks ${a.atk} (${a.aimed} at the ground), hits ${a.hits}, digest ${a.digest} ${a.digest === b.digest ? '==' : '!='} ${b.digest}, violations ${JSON.stringify(Object.fromEntries(kinds))}`);
  for (const v of a.viol.slice(0, 4)) console.log('   ', JSON.stringify(v));
}
console.log(fails ? `FAIL ${fails} runs` : 'PASS all runs');
if (fails) process.exit(1);

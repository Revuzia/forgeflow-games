// probe (lane AI, 2026-11-15; owner: "the bots need to be much smarter, they need to defend their base, sneak attack,
// defend their partners"; owner_rulings 40): the computer-controlled fighters' DECISIONS, gated per difficulty. It never
// changes a decision — it reads events, entity state and each controller's public and private fields after the step.
// Grown from the diagnosis probe _tmp_diag_ai.ts (commit e5ea2bac1), whose numbers are the baseline in ruling 40.
//
//   node _harness/probe_sim_bot_tactics.ts                      the gate (npm run probe): RIFT 48 seeds + FRAY 24 seeds per
//                                                               tier (novice, adept, veteran; same tier on both sides),
//                                                               cut at 30:00, one worker per tier
//                                                               (48, was 16: a 16-game window put the veteran Wick-falls read
//                                                               at 0.88-1.31 a game across seed windows, a 1.1 bar inside the
//                                                               noise — owner_rulings 44; every bar now sits ≥ 2 standard
//                                                               errors from the value measured at the commit that set it)
//   flags: --seeds N (RIFT; FRAY gets the same unless --fray-seeds N) · --seed0 N · --cut S · --diffs a,b · --suites rift,bridge,fray
//          --out <json> (raw per-game data) · --merge a.json,b.json (print the table of saved runs, no gates) · --table
//
// Gates (per tier novice / adept / veteran; "-" = reported only):
//   base defence    fsiege.inner+base undefended-with-bodies share (fighter siege time on an inner or base structure with
//                   no defender within 16 m while 2+ of the team are alive)   ≤ 45 / 35 / 20 %
//                   base intrusions left without 2 defenders for 20 s, per game  ≤ 3 / 1.5 / 1
//                   recalls to defend (a recall started 45 m+ from an open base intrusion)  adept + veteran > 0
//                   inner or base structures taken by Wicks alone (no enemy fighter within 15 m) while two of the team
//                   above 60 % health stood within 16 m, per game  ≤ 2 / 1.6 / 1.1 (owner_rulings 42)
//   peel            episodes with an ally within 12 m: no response ≤ 30 / 24 / 22 %, every helper walked away ≤ 20 / 16 / 16.5 %
//   sneak           gank approach (and lurk) time visible to the enemy ≤ 15 % (adept, veteran; the strike is reported);
//                   ganks struck from a lurk (mid game on): adept + veteran > 0
//   fog honesty     enemy casts recorded for a team that could not see the caster as the tick started nor after it (a cast
//                   that reveals its caster is seen; a record already holding that instant is not this cast's): 0 (every tier)
//   overextension   deaths per team-minute while 2,000+ Gleam ahead ≤ 1.5 × the even rate (adept, veteran)
//   objectives      Longshade taken in ≥ 25 % of the RIFT games that pass 18:00 (veteran) · a lamp of the taking
//                   team within 16 m of the pit at ≥ 10 % of objective takes (adept, veteran)
//   ladder          veteran's inner+base undefended share ≤ adept's + 5 points, and its peel no-response ≤ adept's + 5 points
//   fray            reported: retreat-mode deaths (mode 3 s before), kills on the score leader
// Every match is a pure function of (catalog, setup).
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import type { Entity } from '../src/sim/entity.ts';
import { ORDER_MOVE, ORDER_ATTACK_MOVE, ORDER_ATTACK } from '../src/sim/entity.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { spawn } from 'node:child_process';
import { ranked } from '../src/sim/effects.ts';
import { SLOT_INDEX } from '../src/sim/entity.ts';
import { abilityInfo, U_HEAL, U_SHIELD } from '../src/sim/bots/knowledge.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

const CC = new Set(['stun', 'root', 'silence', 'disarm', 'airborne', 'taunt', 'fear', 'sleep', 'slow']);
const HARD_CC = new Set(['stun', 'root', 'airborne', 'taunt', 'fear', 'sleep']);

function loadCatalog(): CatalogT {
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.error('content build failed'); process.exit(77); }
  return r.catalog;
}

function lineup(catalog: CatalogT, modeId: string, seed: number, diff: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam;
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  const all = catalog.fighters.map((f) => f.id).sort();
  if (!mode.roles || mode.teams > 2) {
    const start = (seed * n) % all.length;
    for (let i = 0; i < n; i++) {
      const fighter = all[(start + ((i + seed) % n)) % all.length];
      const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
      seats.push({ player: i, team: Math.floor(i / mode.perTeam), name: catalog.botNames[i % catalog.botNames.length], fighter, skin,
        loadout: pickLoadout(catalog, fighter, pool), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
    }
  } else {
    const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
    const natives = new Map<string, string[]>();
    for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
    for (const l of natives.values()) l.sort();
    for (let i = 0; i < n; i++) {
      const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam, role = roles[slot % roles.length];
      const pl = natives.get(role) ?? all;
      const fighter = pl[(seed + slot + team) % pl.length];
      const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
      seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
        loadout: pickLoadout(catalog, fighter, pool, role), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
    }
  }
  return { matchId: `diag-${modeId}-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

type Acc = Record<string, number>;
const add = (a: Acc, k: string, v = 1): void => { a[k] = (a[k] ?? 0) + v; };

interface GameOut {
  mode: string; seed: number; dur: number; winner: number; reason: string;
  c: Acc;                          // counters
  h: Record<string, Acc>;          // histograms
  resp: Record<string, number[]>;  // response-time samples
}

function runGame(catalog: CatalogT, modeId: string, seed: number, diff: string, cut: number): GameOut {
  const setup = lineup(catalog, modeId, seed, diff);
  const n = setup.seats.length;
  const ctrls: (BotController | null)[] = setup.seats.map(() => null);
  const factory = createBots(catalog, setup);
  const bots = (seat: SeatSetup, host: Parameters<typeof factory>[1]): BotController | null => { const c = factory(seat, host); ctrls[seat.player] = c; return c; };
  const sim = createSim(catalog, setup, { bots, pregameSeconds: 0 });
  const W = () => sim.world;
  const ctl = (p: number) => ctrls[p] as unknown as { mode?: string; lane?: number; jungle?: boolean; support?: boolean; roamPhase?: string; roamTarget?: number;
    brain?: { answer: Map<number, number> }; m?: unknown } | null;
  // fog honesty: casts unseen by an observer team, checked two steps later against that team's cooldown memory
  const pendingCast: { tick: number; team: number; src: number; si: number; pre: number; back: number; after: boolean }[] = [];
  // (the team's memory of a caster's cooldowns, read the way the probe's check reads it)
  const memOf = (team: number, src: number): Float64Array | null => {
    const mm = teamCtl(team)?.m as unknown as { castSeen?: unknown } | undefined;
    const cs = mm?.castSeen;
    return typeof cs === 'function' ? (cs as (t: number, id: number) => Float64Array | null).call(mm, team, src) : cs instanceof Map ? (cs.get(src) as Float64Array | undefined) ?? null : null;
  };
  const teamCtl = (team: number) => { for (let p = 0; p < n; p++) if (setup.seats[p].team === team && ctrls[p]) return ctl(p); return null; };
  const prevRoam = new Array<string>(n).fill('');
  const strikes: { p: number; target: number; t: number; lurk: boolean }[] = [];
  const modeOf = (p: number): string => ctl(p)?.mode ?? '?';
  const out: GameOut = { mode: modeId, seed, dur: 0, winner: -1, reason: 'cut', c: {}, h: {}, resp: {} };
  const C = out.c, H = (k: string): Acc => (out.h[k] ??= {}), R = (k: string, v: number): void => { (out.resp[k] ??= []).push(v); };
  const ffa = setup.seats.some((s) => s.team !== Math.floor(s.player / Math.max(1, setup.seats.filter((x) => x.team === 0).length)));
  const teams = new Set(setup.seats.map((s) => s.team)).size;
  const isFray = teams > 2;
  void ffa;
  const thicketAt = (x: number, y: number): number => (W().vision as unknown as { thicketAt(x: number, y: number): number }).thicketAt(x, y);
  const visTo = (e: Entity, team: number): boolean => team >= 0 && team < 31 && (e.visibleMask & (1 << team)) !== 0;

  // structure classes by requires-depth: outer (0), inner (1), base (2+)
  const sList = () => structuresOf(W());
  const depthOf = new Map<string, number>();
  {
    const defs = new Map(sList().map((s) => [s.def.id, s.def] as const));
    const dep = (id: string, g = 0): number => {
      if (depthOf.has(id)) return depthOf.get(id)!;
      const d = defs.get(id); if (!d || g > 10) return 0;
      const v = (d.requires ?? []).length ? 1 + Math.max(...(d.requires ?? []).map((r) => dep(r, g + 1))) : 0;
      depthOf.set(id, v); return v;
    };
    for (const id of defs.keys()) dep(id);
  }
  const cls = (id: string): string => { const d = depthOf.get(id) ?? 0; return d === 0 ? 'outer' : d === 1 ? 'inner' : 'base'; };

  // per-structure siege state
  const sDmgAt = new Map<number, number>(), sFDmgAt = new Map<number, number>();
  const sEpisode = new Map<number, { start: number; fighters: boolean; responded: boolean }>();
  // per-fighter damage log from enemy fighters (victim → [t, amount, src])
  const dmgLog = new Map<number, { t: number; a: number; src: number }[]>();
  const ccAt = new Map<number, number>();
  const lastFDmg = new Map<number, number>();   // victim → last time a fighter damaged it (engagement opener)
  const peel = new Map<number, { start: number; helpers: Set<number>; divers: Set<number>; resp: Set<string>; d0: Map<number, number>; victimTeam: number; modes0: string[]; ready: boolean }>();
  const peelCd = new Map<number, number>();
  const visHist: Map<number, boolean[]> = new Map();  // fighter → visible-to-enemy over the last 10 s at 3 Hz (FIFO 30)
  const posHist: Map<number, [number, number][]> = new Map();
  const minionPos = new Map<number, [number, number, number]>(); // id → x, y, since
  const roamStart = new Map<number, number>(); const roamVis = new Map<number, [number, number]>();
  const prevMode = new Array<string>(n).fill('');
  const modeHist: string[][] = setup.seats.map(() => []);
  const respawnAt = new Array<number>(n).fill(-1e9);
  const ultAt6 = new Array<number>(n).fill(-1);
  const lastCast = new Map<number, { t: number; slot: string }>();
  const baseIntr: Map<number, { start: number; x: number; y: number; done: boolean }> = new Map();
  let lowFor = new Array<number>(n).fill(0);
  const goldAt: Record<number, number[]> = {};
  const ent2p = (id: number): number => W().players.findIndex((p) => p.entity === id);
  const credit = (id: number): Entity | null => { const w = W(); const e = id >= 0 ? w.entity(id) ?? null : null; return e ? w.creditFighter(e) : null; };

  const camps = (catalog.maps.find((m) => m.id === setup.map)?.camps ?? []).map((c) => ({ id: c.id, objective: !!c.objective, x: c.units[0]?.at[0] ?? 0, y: c.units[0]?.at[1] ?? 0, unit: c.units[0]?.unit ?? '' }));
  // (owner_rulings 44, the round-2 verifier's repros) the map's roads and fountains: invaders in a team's own half of the Dialwood
  const mapDef = catalog.maps.find((m) => m.id === setup.map)!;
  const roads = (mapDef.lanes ?? []).map((l) => l.path as [number, number][]);
  const offRoad = (x: number, y: number, r: number): boolean => {
    for (const p of roads) for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i]; const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      if ((ax + vx * t - x) ** 2 + (ay + vy * t - y) ** 2 < r * r) return false;
    }
    return true;
  };
  const fountains = (mapDef.bases ?? []).map((b) => ({ team: b.team, x: b.fountain.at[0], y: b.fountain.at[1] }));
  const ownHalf = (team: number, x: number, y: number): boolean => {
    const o = fountains.find((f) => f.team === team), e = fountains.find((f) => f.team !== team);
    return !!o && !!e && (x - o.x) ** 2 + (y - o.y) ** 2 < (x - e.x) ** 2 + (y - e.y) ** 2;
  };
  // invader episodes: enemy fighter id → since when it has been in the team's sight alone in its half, and whether punished
  const invEp = new Map<number, { since: number; counted: boolean; hitAt: number }>();
  // the carry-partner peel: carry victim → episode with its partner (the support of its road, or its road partner) within 6 m
  const carryStyles = new Set(['marksman', 'artillery', 'burst']);
  const styleOfDef = new Map(catalog.fighters.map((f) => [f.id, f.ai.style as string]));
  const partnerEp = new Map<number, { start: number; partner: number; divers: Set<number>; resp: boolean }>();
  const partnerCd = new Map<number, number>();
  // dithering: per fighter, its positions over the last 12 s (3 Hz)
  const ditherCd = new Array<number>(n).fill(0);
  const swungAt = new Array<number>(n).fill(0);
  // FRAY low-health contact episodes
  const lowEp = new Map<number, { t: number; m: string }>();
  const lowCd = new Map<number, number>();
  const castAt = new Map<number, number>();
  // (owner_rulings 44, round 2) the designated peeler: a dive (enemy fighters took 20 % of a fighter's health in 2 s) is
  // answered by the support of its team within 8 m, else the nearest teammate within 12 m above 35 % health (not recalling)
  // — damage on a diver, a hold on a diver it cast, or a heal or shield on the partner; the latency is kept
  const respEp = new Map<number, { start: number; resp: number; divers: Set<number>; lat: number; com: number; lane: boolean }>();
  const respCd = new Map<number, number>();
  // (owner_rulings 44, round 2) the collapse: a lone enemy fighter seen in a team's half (in its Dialwood, or on a road),
  // outside its towers' cover, with two or more of the team free — 2+ of the team within 12 m of it (or it dead) within 15 s
  const colEp = new Map<number, { team: number; start: number; seen: number; last: number; jungle: boolean; free: number; done: boolean }>();
  const colCd = new Map<number, number>();
  // (owner_rulings 44, round 2) RIFT low health with a foe within 10 m (FRAY's read, on the roads)
  const rLowEp = new Map<number, { t: number; m: string }>();
  const rLowCd = new Map<number, number>();
  const lim = cut > 0 ? cut : 3600;
  let guard = 0;
  while (sim.view.phase !== 'ended' && guard++ < 30 * 3700) {
    // (each fighter's visibility as the tick starts: what the teams can see while its casts happen — vision rebuilds late in the tick)
    const mask0 = new Map<number, number>();
    for (const pl of W().players) if (pl.ent) mask0.set(pl.ent.id, pl.ent.visibleMask);
    // (each team's cooldown memory of each enemy fighter as the tick starts: a cast is recorded by the team only if the
    // memory changes to it during or after this step — an earlier cast of another rank can land on the same instant)
    const memPre = new Map<number, number[]>();
    for (let t = 0; t < teams; t++) for (const pl of W().players) {
      const f = pl.ent; if (!f || f.team === t) continue;
      const a = memOf(t, f.id); if (a) memPre.set(t * 100000 + f.id, Array.from(a));
    }
    const evs: SimEvent[] = sim.step();
    const w = W(), now = w.time;
    if (now > lim) break;
    for (const ev of evs) {
      switch (ev.e) {
        case 'damage': {
          const dst = w.entity(ev.dst); if (!dst) break;
          const src = credit(ev.src);
          if (dst.kind === 'structure') {
            sDmgAt.set(dst.id, now);
            if (src) sFDmgAt.set(dst.id, now);
          } else if (dst.kind === 'fighter' && src && src.team !== dst.team) {
            let l = dmgLog.get(dst.id); if (!l) { l = []; dmgLog.set(dst.id, l); }
            l.push({ t: now, a: ev.amount, src: src.id });
            // engagement opener: first fighter hit on this victim in 8 s
            if (now - (lastFDmg.get(dst.id) ?? -1e9) > 8) {
              add(C, 'open.n');
              if (thicketAt(src.x, src.y) >= 0) add(C, 'open.fromBush');
              const vh = visHist.get(src.id);
              if (vh && vh.length >= 6 && vh.slice(-6, -2).every((v) => !v)) add(C, 'open.fromFog');
            }
            lastFDmg.set(dst.id, now);
            // peel responses: a helper hitting a diver
            for (const [vid, pe] of peel) if (pe.divers.has(dst.id) && pe.helpers.has(src.id) && vid !== src.id) pe.resp.add('hitDiver');
            for (const [, pe] of partnerEp) { if (pe.partner === src.id && pe.divers.has(dst.id)) pe.resp = true; }
            const pe0 = partnerEp.get(dst.id); if (pe0) pe0.divers.add(src.id);
            const ie = invEp.get(dst.id); if (ie && ie.hitAt < 0 && src.team !== dst.team) ie.hitAt = now;
            // designated peeler: its blow on a diver answers; a new dive opens an episode
            for (const [, re] of respEp) if (re.lat < 0 && re.resp === src.id && re.divers.has(dst.id)) re.lat = now - re.start;
            const re0 = respEp.get(dst.id);
            if (re0) re0.divers.add(src.id);
            else if (!isFray && now >= (respCd.get(dst.id) ?? 0)) {
              let burst2 = 0; const dv = new Set<number>();
              for (const x of l) if (now - x.t <= 2) { burst2 += x.a; dv.add(x.src); }
              if (burst2 >= dst.maxHp * 0.2) {
                let best: Entity | null = null, bd = Infinity, sup: Entity | null = null;
                for (const q of w.players) {
                  const a = q.ent; if (!a || a === dst || !a.alive || a.team !== dst.team || a.hp < a.maxHp * 0.5 || a.stateOverride === 'recall') continue;
                  const d2 = (a.x - dst.x) ** 2 + (a.y - dst.y) ** 2;
                  if (d2 > 144) continue;
                  if (d2 <= 64 && ctl(q.player)?.support) sup = a;
                  if (d2 < bd) { bd = d2; best = a; }
                }
                const r = sup ?? best;
                if (r) respEp.set(dst.id, { start: now, resp: r.id, divers: dv, lat: -1, com: -1, lane: now < 840 });
                else { add(C, 'resp.noneNear'); respCd.set(dst.id, now + 4); }
              }
            }
          }
          break;
        }
        case 'status': {
          const dst = w.entity(ev.dst); if (!dst || dst.kind !== 'fighter') break;
          if (HARD_CC.has(ev.status)) ccAt.set(dst.id, now);
          if (CC.has(ev.status)) for (const [, pe] of peel) if (pe.divers.has(dst.id)) pe.resp.add('ccDiver');
          // (a status event carries no source: a CC on a diver the partner cast at within the last second is the partner's)
          if (CC.has(ev.status)) for (const [, pe] of partnerEp) if (pe.divers.has(dst.id) && now - (castAt.get(pe.partner) ?? -1e9) <= 1) pe.resp = true;
          if (CC.has(ev.status)) for (const [, re] of respEp) if (re.lat < 0 && re.divers.has(dst.id) && now - (castAt.get(re.resp) ?? -1e9) <= 1) re.lat = now - re.start;
          break;
        }
        case 'heal': {
          const dst = w.entity(ev.dst); const src = credit(ev.src);
          if (dst && src && dst.kind === 'fighter' && src.id !== dst.id) {
            const pe = peel.get(dst.id); if (pe && pe.helpers.has(src.id)) pe.resp.add('healShield');
            const pp = partnerEp.get(dst.id); if (pp && pp.partner === src.id) pp.resp = true;
            const rr = respEp.get(dst.id); if (rr && rr.lat < 0 && rr.resp === src.id) rr.lat = now - rr.start;
            add(C, 'allyHeal.amt', ev.amount);
          }
          break;
        }
        case 'shield': { const pe = peel.get(ev.dst); if (pe) pe.resp.add('shieldAny'); const pp = partnerEp.get(ev.dst); if (pp && now - (castAt.get(pp.partner) ?? -1e9) <= 0.6) pp.resp = true; const rr = respEp.get(ev.dst); if (rr && rr.lat < 0 && now - (castAt.get(rr.resp) ?? -1e9) <= 0.6) rr.lat = now - rr.start; break; }
        case 'cast': {
          const src = w.entity(ev.src); if (!src || src.kind !== 'fighter') break;
          const p = ent2p(src.id);
          castAt.set(src.id, now);
          add(H('cast.slot'), ev.slot);
          // fog: a cast the other teams cannot see — and whether that team's cooldown memory recorded it anyway
          const si = SLOT_INDEX[ev.slot];
          const sl = si !== undefined && si <= 3 ? src.slots[si] : null;
          for (let t = 0; t < teams; t++) if (t !== src.team) {
            add(C, 'cast.observers');
            if (((mask0.get(src.id) ?? src.visibleMask) & (1 << t)) === 0) {
              add(C, 'cast.unseenObservers');
              // (a cast event re-sent for a cast already under way carries that cast's start time: the memory of it is from then)
              if (sl && ev.t >= w.time - 0.2) { const rank = Math.max(1, Math.min(sl.baseDef.maxRank, Math.ceil(src.level / 2))); pendingCast.push({ tick: w.tick, team: t, src: src.id, si: si!, pre: memPre.get(t * 100000 + src.id)?.[si!] ?? -1, back: ev.t + ev.castTime + ranked(sl.def.cooldown, rank), after: visTo(src, t) || src.statuses.some((st) => st.kind === 'reveal' && (st as { srcTeam?: number }).srcTeam === t) }); }
            }
          }
          let ef = 0;
          for (const pl of w.players) { const f = pl.ent; if (f && f.alive && f.team !== src.team && (f.x - src.x) ** 2 + (f.y - src.y) ** 2 <= 15 * 15) ef++; }
          if (ev.slot === 'ult') { add(C, 'ult.casts'); if (ef === 0) add(C, 'ult.noEnemy15'); }
          if (ev.slot === 'a1' || ev.slot === 'a2' || ev.slot === 'a3' || ev.slot === 'ult') {
            add(C, 'abil.casts'); if (ef > 0) add(C, 'abil.casts.withEnemy');
            const lc = lastCast.get(src.id);
            if (lc && lc.slot !== ev.slot && now - lc.t <= 2 && ef > 0) add(C, 'abil.chain');
            lastCast.set(src.id, { t: now, slot: ev.slot });
          }
          if (ev.slot.startsWith('spell')) add(C, 'spell.casts');
          if (ev.slot.startsWith('item')) add(C, 'itemActive.casts');
          void p;
          break;
        }
        case 'levelUp': if (ev.level === 6) ultAt6[ev.player] = now; break;
        case 'respawn': respawnAt[ev.player] = now; break;
        case 'recall': if (ev.state === 'start') {
          add(C, 'recall.start');
          const me = w.players[ev.player]?.ent;
          for (const [team, bi] of baseIntr) if (me && team === me.team && !bi.done && (me.x - bi.x) ** 2 + (me.y - bi.y) ** 2 > 45 * 45) add(C, 'base.recallToDefend');
        } break;
        case 'gold': if (ev.reason === 'cs') add(C, 'cs.fighter'); break;
        case 'death': {
          const v = w.entity(ev.dst);
          if (ev.kind === 'minion') { add(C, 'minion.deaths'); if (now <= 840) { add(C, 'minion.deaths14'); const k = credit(ev.killer); if (k && v && k.team !== v.team) add(C, 'minion.lh14'); } }
          if (ev.kind === 'monster' && v) {
            const cp = camps.find((c) => Math.abs(c.x - v.x) < 9 && Math.abs(c.y - v.y) < 9);
            const k = credit(ev.killer);
            if (cp && k && (v.def === cp.unit)) {
              const side = cp.id.startsWith('a_') ? 0 : cp.id.startsWith('s_') ? 1 : -1;
              add(H('camp.kill'), `${cp.unit}:${side < 0 ? 'mid' : side === k.team ? 'own' : 'invade'}`);
            }
          }
          if (ev.kind === 'fighter' && v) {
            const p = ent2p(v.id); const mh = p >= 0 ? modeHist[p] : [];
            const md = mh.length >= 10 ? mh[mh.length - 10] : mh[0] ?? '?';
            add(C, 'f.deaths'); add(H('death.mode3s'), md);
            if (!isFray && teams === 2) { let lead = 0; for (const t of w.teams) lead += t.team === v.team ? t.gold : -t.gold; add(C, lead <= -2000 ? 'death.behind' : lead >= 2000 ? 'death.ahead' : 'death.even'); }
            const k = credit(ev.killer);
            if (!k && ev.assists.length === 0) add(C, 'f.deaths.unforced');
            // died under an enemy tower
            for (const s of sList()) { const st = s.ent; if (st.alive && st.team !== v.team && st.attackDef && (st.x - v.x) ** 2 + (st.y - v.y) ** 2 <= (st.stats.range + st.radius + 1.5) ** 2) { add(C, 'f.deaths.underEnemyTower'); break; } }
            if (p >= 0 && lowFor[p] >= 2) add(C, 'f.deaths.stayedLow');
            if (p >= 0 && now - respawnAt[p] < 75 && respawnAt[p] > 0) add(C, 'f.deaths.within75sOfRespawn');
            // isolated: no ally within 25 m
            let ally = false;
            for (const pl of w.players) { const f = pl.ent; if (f && f !== v && f.alive && f.team === v.team && (f.x - v.x) ** 2 + (f.y - v.y) ** 2 <= 25 * 25) { ally = true; break; } }
            if (!ally && !isFray) add(C, 'f.deaths.isolated');
            // a diver punished
            for (const [, pe] of peel) if (pe.divers.has(v.id)) pe.resp.add('diverDied');
          }
          break;
        }
        case 'takedown': {
          const vp = w.players[ev.victim]; const ve = vp?.ent; if (!ve) break;
          add(C, 'td.n');
          const parts = [ev.killer, ...ev.assists].filter((x) => x >= 0);
          for (const st of strikes) if (st.target === ve.id && now - st.t <= 8 && parts.includes(st.p)) { add(C, st.lurk ? 'gank.successLurk' : 'gank.success'); st.t = -1e9; }
          if (isFray) {
            const kp = w.players[ev.killer]?.ent;
            if (kp) {
              // was the victim the lowest-health enemy in 15 m of the killer, and the score leader?
              let lowest = true; let lead = 0;
              for (const pl of w.players) { if ((pl.score ?? 0) > lead) lead = pl.score ?? 0; const f = pl.ent; if (!f || !f.alive || f === kp || f === ve) continue; if ((f.x - kp.x) ** 2 + (f.y - kp.y) ** 2 <= 225 && f.hp / f.maxHp < ve.maxHp * 0 + 0.0001 + 0) lowest = false; }
              void lowest;
              if ((vp.score ?? 0) >= lead && lead > 0) add(C, 'fray.killLeader');
            }
            break;
          }
          // RIFT/BRIDGE: rotations — a participant from another road or the grove, and whether it came out of the fog
          let lane = -1, bd = Infinity;
          for (let p = 0; p < n; p++) {
            const c = ctl(p); const f = w.players[p]?.ent;
            if (!c || !f || f.team !== ve.team || c.jungle || (c.lane ?? -1) < 0) continue;
            void bd; void lane;
          }
          let rot = false, fog = false;
          const vic = ctl(ev.victim);
          for (const pp of parts) {
            const c = ctl(pp), f = w.players[pp]?.ent; if (!c || !f) continue;
            const moved = c.jungle || (vic && (vic.lane ?? -1) >= 0 && (c.lane ?? -1) >= 0 && c.lane !== vic.lane);
            if (moved) {
              rot = true;
              const vh = visHist.get(f.id);
              if (vh && vh.length >= 24 && vh.slice(0, vh.length - 9).filter((x) => x).length <= (vh.length - 9) * 0.3) fog = true;
            }
          }
          if (rot) { add(C, 'td.rotation'); if (fog) add(C, 'td.rotationFromFog'); }
          if (parts.length >= 2) add(C, 'td.multi');
          add(H('td.time'), now < 840 ? 'lane' : now < 1500 ? 'mid' : 'late');
          break;
        }
        case 'structure': {
          const st = w.entity(ev.id); const s = sList().find((x) => x.ent === st);
          if (st && s) {
            const c = cls(s.def.id); let def = 0, alive = 0;
            for (const pl of w.players) { const f = pl.ent; if (f && f.alive && f.team === st.team) { alive++; if ((f.x - st.x) ** 2 + (f.y - st.y) ** 2 <= 20 * 20) def++; } }
            add(C, `fall.${c}`); if (def === 0 && alive >= 2) add(C, `fall.${c}.noDefender`);
            // (owner_rulings 42: a structure taken by Wicks alone while two fit defenders stood beside it)
            let foes = 0, fit = 0;
            for (const pl of w.players) { const f = pl.ent; if (!f || !f.alive) continue; const d2 = (f.x - st.x) ** 2 + (f.y - st.y) ** 2;
              if (f.team !== st.team && d2 <= 15 * 15) foes++; else if (f.team === st.team && d2 <= 16 * 16 && f.hp > f.maxHp * 0.6) fit++; }
            if (foes === 0 && fit >= 2) {
              add(C, `fall.${c}.wicksOverFit`);
              for (const pl of w.players) { const f = pl.ent; if (f && f.alive && f.team === st.team && (f.x - st.x) ** 2 + (f.y - st.y) ** 2 <= 16 * 16 && f.hp > f.maxHp * 0.6) add(H('fall.wicksOverFit.mode'), modeOf(pl.player)); }
            }
          }
          break;
        }
        case 'objective': {
          const cp = camps.find((c) => c.unit === ev.unit) ?? null;
          add(H('obj'), `${ev.unit}`);
          if (cp) {
            let enemy = 0, own = 0;
            for (const pl of w.players) { const f = pl.ent; if (!f || !f.alive || (f.x - cp.x) ** 2 + (f.y - cp.y) ** 2 > 25 * 25) continue; if (f.team === ev.team) own++; else enemy++; }
            if (enemy > 0) add(C, 'obj.contested');
            // (owner_rulings 44: taken with one of the taking team there while three or more enemies stood within 22 m)
            let own22 = 0, en22 = 0;
            for (const pl of w.players) { const f = pl.ent; if (!f || !f.alive || (f.x - cp.x) ** 2 + (f.y - cp.y) ** 2 > 22 * 22) continue; if (f.team === ev.team) own22++; else en22++; }
            if (own22 <= 1 && en22 >= 3) {
              add(C, 'obj.outnumbered');
              for (const pl of w.players) { const f = pl.ent; if (f && f.alive && f.team === ev.team && (f.x - cp.x) ** 2 + (f.y - cp.y) ** 2 <= 22 * 22) add(H('obj.outnumbered.mode'), `${modeOf(pl.player)}/${ev.unit}`); }
            }
            let lamp = false;
            for (const u of w.entities) if (!u.removed && u.alive && u.kind === 'ward' && u.team === ev.team && (u.x - cp.x) ** 2 + (u.y - cp.y) ** 2 <= 16 * 16) { lamp = true; break; }
            if (lamp) add(C, 'obj.lamp');
            add(C, 'obj.n'); add(C, 'obj.ownAt', own);
            // taken by the team behind on Gleam?
            let lead = 0; for (const t of w.teams) lead += t.team === ev.team ? t.gold : -t.gold;
            if (lead < -1000) add(C, 'obj.byBehind');
          }
          break;
        }
        case 'end': out.winner = ev.result.winningTeam; out.reason = 'end'; break;
        default: break;
      }
    }
    for (let i = pendingCast.length - 1; i >= 0; i--) {
      const pc = pendingCast[i];
      if (w.tick - pc.tick < 2) continue;
      const mm = teamCtl(pc.team)?.m as unknown as { castSeen?: unknown } | undefined;
      const cs = mm?.castSeen;
      // (the cooldown memory is a per-team lookup; before lane AI G4 it was one map for every team)
      const arr = typeof cs === 'function' ? (cs as (t: number, id: number) => Float64Array | null).call(mm, pc.team, pc.src) : cs instanceof Map ? (cs.get(pc.src) as Float64Array | undefined) ?? null : null;
      // (written by this cast: an earlier cast of another rank can land on the same instant by chance)
      if (arr && Math.abs(arr[pc.si] - pc.back) < 1e-9 && Math.abs(pc.pre - pc.back) >= 1e-9 && !pc.after) add(C, 'cast.leaked');
      pendingCast.splice(i, 1);
    }
    // (the designated peeler commits: an attack swing or an attack order on a diver)
    for (const [, re] of respEp) {
      if (re.com >= 0) continue;
      const pe = w.entity(re.resp);
      if (pe && pe.alive && (re.divers.has(pe.atkTarget) || (pe.order === ORDER_ATTACK && re.divers.has(pe.orderTarget)))) re.com = now - re.start;
    }
    for (let p = 0; p < n; p++) {
      const c = ctl(p); if (!c || c.roamPhase === undefined) continue;
      const ph = c.mode === 'roam' ? c.roamPhase : '';
      if (ph === 'strike' && prevRoam[p] !== 'strike' && prevRoam[p] !== '') { strikes.push({ p, target: c.roamTarget ?? -1, t: now, lurk: prevRoam[p] === 'lurk' }); add(C, prevRoam[p] === 'lurk' ? 'gank.strikeLurk' : 'gank.strikeApproach'); }
      if (ph === 'lurk' && prevRoam[p] !== 'lurk') add(C, 'gank.lurks');
      prevRoam[p] = ph;
    }
    if (strikes.length > 64) strikes.splice(0, strikes.length - 64);
    // ── 3 Hz sampling ──
    if (w.tick % 10 !== 0 || w.phase !== 'live') continue;
    const dt = 10 / 30;
    const players = w.players;
    // visibility / position histories
    for (let p = 0; p < n; p++) {
      const f = players[p]?.ent; if (!f) continue;
      let vh = visHist.get(f.id); if (!vh) { vh = []; visHist.set(f.id, vh); }
      let vis = false; for (let t = 0; t < teams; t++) if (t !== f.team && visTo(f, t)) { vis = true; break; }
      vh.push(f.alive && vis); if (vh.length > 30) vh.shift();
      let ph = posHist.get(f.id); if (!ph) { ph = []; posHist.set(f.id, ph); }
      ph.push([f.x, f.y]); if (ph.length > 36) ph.shift();
      if (!f.alive) { lowFor[p] = 0; continue; }
      const md = modeOf(p);
      modeHist[p].push(md); if (modeHist[p].length > 12) modeHist[p].shift();
      if (ultAt6[p] < 0 && f.level >= 6) ultAt6[p] = now;
      add(H('mode.time'), md, dt);
      if (f.hp < f.maxHp * 0.3 && md !== 'retreat' && md !== 'recall') lowFor[p] += dt; else if (f.hp >= f.maxHp * 0.3) lowFor[p] = 0;
      // bush waits
      if (thicketAt(f.x, f.y) >= 0) { add(C, 'bush.time', dt); if (Math.abs(f.vx) + Math.abs(f.vy) < 0.1) add(C, 'bush.stillTime', dt); }
      // stuck: a move order running, < 0.4 m in 3 s, not casting / held
      if ((f.order === ORDER_MOVE || f.order === ORDER_ATTACK_MOVE) && ph.length >= 10 && !f.cast && !f.dash && f.stateOverride !== 'recall') {
        const [ox, oy] = ph[ph.length - 10];
        if ((f.x - ox) ** 2 + (f.y - oy) ** 2 < 0.16 && (f.orderReqX - f.x) ** 2 + (f.orderReqY - f.y) ** 2 > 4) { add(C, 'stuck.time', dt); add(H('stuck.where'), `${Math.round(f.x / 5) * 5},${Math.round(f.y / 5) * 5}`, dt); }
      }
      // roam episodes
      if (md === 'roam' && prevMode[p] !== 'roam') { roamStart.set(p, now); roamVis.set(p, [0, 0]); add(C, 'roam.n'); }
      if (md === 'roam') { const rv = roamVis.get(p)!; rv[0]++; if (vh[vh.length - 1]) rv[1]++; const ph = ctl(p)?.roamPhase ?? '?'; add(C, `roam.ph.${ph}`); if (vh[vh.length - 1]) add(C, `roam.phVis.${ph}`); }
      if (prevMode[p] === 'roam' && md !== 'roam') {
        const rv = roamVis.get(p); if (rv && rv[0] > 0) { add(C, 'roam.samples', rv[0]); add(C, 'roam.visibleSamples', rv[1]); }
        R('roam.len', now - (roamStart.get(p) ?? now));
      }
      if (md === 'defend' && prevMode[p] !== 'defend') add(C, 'defend.entries');
      prevMode[p] = md;
    }
    if (!isFray && teams === 2) for (let tm = 0; tm < 2; tm++) { let lead = 0; for (const t of w.teams) lead += t.team === tm ? t.gold : -t.gold; add(C, lead <= -2000 ? 'tm.behind' : lead >= 2000 ? 'tm.ahead' : 'tm.even', dt / 60); }
    // team gold
    if (!isFray && Math.abs(now % 60) < dt) { const m = Math.round(now / 60); goldAt[m] = w.teams.map((t) => t.gold); }
    // structures under siege
    for (const s of sList()) {
      const st = s.ent; if (!st.alive) { sEpisode.delete(st.id); continue; }
      const att = now - (sDmgAt.get(st.id) ?? -1e9) <= 1.2, fatt = now - (sFDmgAt.get(st.id) ?? -1e9) <= 1.5;
      const c = cls(s.def.id);
      let def = 0, alive = 0, nearest = Infinity;
      for (const pl of players) {
        const f = pl.ent; if (!f || !f.alive || f.team !== st.team) continue;
        alive++;
        const d2 = (f.x - st.x) ** 2 + (f.y - st.y) ** 2; if (d2 < nearest) nearest = d2;
        if (d2 <= 16 * 16) def++;
      }
      if (att) {
        add(C, `siege.${c}.time`, dt);
        if (def === 0) { add(C, `siege.${c}.undefended`, dt); if (alive >= 2) add(C, `siege.${c}.undefendedBodies`, dt); }
        if (fatt) {
          add(C, `fsiege.${c}.time`, dt);
          if (def === 0 && alive >= 2) {
            add(C, `fsiege.${c}.undefendedBodies`, dt);
            for (const pl of players) { const f = pl.ent; if (f && f.alive && f.team === st.team) add(H(`fsiege.${c}.absentMode`), modeOf(pl.player), dt); }
          }
        }
      }
      let ep = sEpisode.get(st.id);
      if (fatt && !ep) { ep = { start: now, fighters: true, responded: def > 0 }; sEpisode.set(st.id, ep); add(C, `ep.${c}`); if (def > 0) add(C, `ep.${c}.defendedAtStart`); }
      if (ep && !ep.responded && def > 0) { ep.responded = true; R(`resp.${c}`, now - ep.start); }
      if (ep && !att && now - (sDmgAt.get(st.id) ?? 0) > 8) { if (!ep.responded) add(C, `resp.${c}.never`); sEpisode.delete(st.id); }
    }
    // base intrusion (enemy fighter within 20 m of a base-class structure of a team)
    if (!isFray) for (let team = 0; team < teams; team++) {
      let ix = 0, iy = 0, hit = false;
      for (const s of sList()) {
        if (s.def.team !== team || cls(s.def.id) !== 'base' || !s.ent.alive) continue;
        for (const pl of players) { const f = pl.ent; if (f && f.alive && f.team !== team && (f.x - s.ent.x) ** 2 + (f.y - s.ent.y) ** 2 <= 20 * 20) { hit = true; ix = f.x; iy = f.y; break; } }
        if (hit) break;
      }
      let bi = baseIntr.get(team);
      if (hit && (!bi || bi.done && now - bi.start > 30)) { bi = { start: now, x: ix, y: iy, done: false }; baseIntr.set(team, bi); add(C, 'base.intrusions'); }
      if (bi && !bi.done) {
        let at = 0, alive = 0;
        for (const pl of players) { const f = pl.ent; if (f && f.alive && f.team === team) { alive++; if ((f.x - bi.x) ** 2 + (f.y - bi.y) ** 2 <= 25 * 25) at++; } }
        if (at >= Math.min(2, alive) && alive > 0) { bi.done = true; R('resp.base2', now - bi.start); }
        else if (!hit && now - bi.start > 20) { bi.done = true; add(C, 'base.intrusion.unanswered'); }
        if (!bi.done) add(C, 'base.intrusion.time', dt);
      }
    }
    // peel episodes
    for (const pl of players) {
      const v = pl.ent; if (!v || !v.alive) continue;
      const l = dmgLog.get(v.id); if (l) while (l.length && now - l[0].t > 2.5) l.shift();
      const burst = l ? l.reduce((a, x) => a + x.a, 0) : 0;
      const cc = now - (ccAt.get(v.id) ?? -1e9) < 0.5;
      if (!peel.has(v.id) && now >= (peelCd.get(v.id) ?? 0) && (burst >= v.maxHp * 0.2 || (cc && l && l.length > 0))) {
        const helpers = new Set<number>(), d0 = new Map<number, number>();
        for (const q of players) { const a = q.ent; if (a && a !== v && a.alive && a.team === v.team && (a.x - v.x) ** 2 + (a.y - v.y) ** 2 <= 144) { helpers.add(a.id); d0.set(a.id, Math.hypot(a.x - v.x, a.y - v.y)); } }
        const divers = new Set(l ? l.map((x) => x.src) : []);
        if (isFray) continue;
        add(C, 'peel.episodes');
        if (helpers.size === 0) { add(C, 'peel.isolated'); peelCd.set(v.id, now + 5); continue; }
        const modes0 = [...helpers].map((h) => modeOf(ent2p(h)));
        let ready = false;
        for (const h of helpers) { const a = w.entity(h); if (!a) continue; for (let i = 0; i < 4; i++) { const sl = a.slots[i]; if (sl && sl.ready) { const inf = abilityInfo(sl.def); if (inf.allyUnit && (inf.use & (U_HEAL | U_SHIELD))) ready = true; } } }
        peel.set(v.id, { start: now, helpers, divers, resp: new Set(), d0, victimTeam: v.team, modes0, ready });
      }
    }
    for (const [vid, pe] of [...peel]) {
      if (now - pe.start < 3) continue;
      const v = w.entity(vid);
      add(C, 'peel.withHelpers');
      if (pe.resp.has('hitDiver')) add(C, 'peel.hitDiver');
      if (pe.resp.has('ccDiver')) add(C, 'peel.ccDiver');
      if (pe.resp.has('healShield')) add(C, 'peel.healShield');
      if (pe.resp.has('diverDied')) add(C, 'peel.diverDied');
      if (pe.ready) { add(C, 'peel.healReady'); if (pe.resp.has('healShield')) add(C, 'peel.healReadyUsed'); }
      if (pe.resp.size === 0 || (pe.resp.size === 1 && pe.resp.has('shieldAny'))) { add(C, 'peel.noResponse'); for (const m of pe.modes0) add(H('peel.noRespMode'), m); }
      let fled = 0;
      for (const hid of pe.helpers) { const a = w.entity(hid); if (!a || !a.alive || !v) continue; if (Math.hypot(a.x - v.x, a.y - v.y) > (pe.d0.get(hid) ?? 0) + 4) fled++; const p = ent2p(hid); add(H('peel.helperMode'), modeOf(p)); }
      if (fled === pe.helpers.size) add(C, 'peel.allHelpersLeft');
      if (!v || !v.alive) add(C, 'peel.victimDied');
      peel.delete(vid); peelCd.set(vid, now + 5);
    }
    // ── owner_rulings 44 (the round-2 verifier's repros) ──
    if (!isFray) {
      // (a) a fit fighter standing idle beside its own inner or base structure that enemy fighters are hitting, no enemy fighter
      // within 12 m of it (ruling 42's post held an untouched Lantern while the Bell Needles and the Hourbell fell 14-21 m away)
      for (const s of sList()) {
        const st = s.ent; if (!st.alive || cls(s.def.id) === 'outer' || now - (sFDmgAt.get(st.id) ?? -1e9) > 1.5) continue;
        for (const pl of players) {
          const f = pl.ent; if (!f || !f.alive || f.team !== st.team || f.hp < f.maxHp * 0.6) continue;
          const d2 = (f.x - st.x) ** 2 + (f.y - st.y) ** 2; if (d2 > 25 * 25) continue;
          const ph = posHist.get(f.id); if (!ph || ph.length < 4) continue;
          const [ox, oy] = ph[ph.length - 4];
          if ((f.x - ox) ** 2 + (f.y - oy) ** 2 > 1) continue;
          let near = false; for (const q of players) { const g = q.ent; if (g && g.alive && g.team !== f.team && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 12 * 12) { near = true; break; } }
          if (near) continue;
          add(C, 'post.idleBesideSiege', dt); add(H('post.idleMode'), modeOf(pl.player), dt);
        }
      }
      // (b) an invader: an enemy fighter in the team's sight, alone (no other of its side within 14 m), off the roads by 9 m, in
      // the team's own half, 3:00-14:00 — punished when the team's fighters damage it within 20 s of 8 s in sight
      if (now >= 180 && now < 840) for (let team = 0; team < teams; team++) for (const pl of players) {
        const f = pl.ent; if (!f || f.team === team) continue;
        let ok = f.alive && visTo(f, team) && ownHalf(team, f.x, f.y) && offRoad(f.x, f.y, 9);
        if (ok) for (const q of players) { const g = q.ent; if (g && g !== f && g.alive && g.team === f.team && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 14 * 14) { ok = false; break; } }
        const key = f.id * 8 + team;
        let ie = invEp.get(f.id);
        if (!ok) { if (ie && !ie.counted && ie.since >= 0 && now - ie.since < 8) invEp.delete(f.id); continue; }
        if (!ie) { ie = { since: now, counted: false, hitAt: -1 }; invEp.set(f.id, ie); }
        if (!ie.counted && now - ie.since >= 8) { ie.counted = true; add(C, 'invade.episodes'); }
        void key;
      }
      for (const [id, ie] of [...invEp]) {
        if (!ie.counted) continue;
        if (ie.hitAt >= 0 && ie.hitAt - ie.since <= 28) { add(C, 'invade.punished'); invEp.delete(id); }
        else if (now - ie.since > 28) invEp.delete(id);
      }
      // (c) a dived carry with its road partner within 6 m: the partner damages, holds or heals within 3 s
      for (const pl of players) {
        const v = pl.ent; if (!v || !v.alive || !carryStyles.has(styleOfDef.get(v.def) ?? '')) continue;
        const pe = partnerEp.get(v.id);
        if (pe) {
          if (now - pe.start >= 3) { add(C, 'partner.episodes'); if (pe.resp) add(C, 'partner.responded'); else add(H('partner.noRespMode'), modeOf(ent2p(pe.partner))); partnerEp.delete(v.id); partnerCd.set(v.id, now + 5); }
          continue;
        }
        if (now < (partnerCd.get(v.id) ?? 0)) continue;
        const l = dmgLog.get(v.id); const burst = l ? l.reduce((a, x) => a + x.a, 0) : 0;
        if (burst < v.maxHp * 0.2) continue;
        const vc = ctl(pl.player); if (!vc || vc.jungle || (vc.lane ?? -1) < 0) continue;
        let partner = -1;
        for (const q of players) {
          const a = q.ent; if (!a || a === v || !a.alive || a.team !== v.team || (a.x - v.x) ** 2 + (a.y - v.y) ** 2 > 36) continue;
          const ac = ctl(q.player); if (ac && !ac.jungle && ac.lane === vc.lane) { partner = a.id; break; }
        }
        if (partner < 0) continue;
        partnerEp.set(v.id, { start: now, partner, divers: new Set(l ? l.map((x) => x.src) : []), resp: false });
      }
      // (d) dithering (owner_rulings 44, round 2: legs, not steps — last-hit footwork weaves a metre at a time and is not
      // pacing): full health, no enemy fighter within 30 m, no swing at anything for the 12 s, and the walk splits into 3+
      // legs of 4 m+ in alternating directions while it ends within 5 m of where it started
      for (let p = 0; p < n; p++) {
        const f = players[p]?.ent; if (!f || !f.alive) { swungAt[p] = now; continue; }
        if (f.atkTarget >= 0 || f.cast) swungAt[p] = now;
        if (f.hp < f.maxHp * 0.9 || now < ditherCd[p] || now - swungAt[p] < 12) continue;
        const ph = posHist.get(f.id); if (!ph || ph.length < 36) continue;
        let near = false; for (const q of players) { const g = q.ent; if (g && g.alive && g.team !== f.team && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 30 * 30) { near = true; break; } }
        if (near) continue;
        // legs: runs of 1-s displacements (every 3rd sample) whose direction stays within 90 degrees
        const legs: number[] = []; let lx = 0, ly = 0, len = 0;
        for (let i = 3; i < ph.length; i += 3) {
          const dx = ph[i][0] - ph[i - 3][0], dy = ph[i][1] - ph[i - 3][1], m = Math.hypot(dx, dy);
          if (m < 0.5) continue;
          if (len > 0 && dx * lx + dy * ly < 0) { legs.push(len); len = 0; }
          lx = dx; ly = dy; len += m;
        }
        if (len > 0) legs.push(len);
        const big = legs.filter((x) => x >= 4).length;
        const net = Math.hypot(ph[ph.length - 1][0] - ph[0][0], ph[ph.length - 1][1] - ph[0][1]);
        if (big >= 3 && net <= 5 && f.stateOverride !== 'recall') { add(C, 'dither.episodes'); add(H('dither.mode'), modeOf(p)); ditherCd[p] = now + 12; }
      }
    }
    // ── owner_rulings 44, round 2 ──
    if (!isFray) {
      // (f) the designated peeler's episodes close 4 s after the dive
      for (const [vid, re] of [...respEp]) {
        if (now - re.start < 4) continue;
        add(C, re.lane ? 'resp.lane.episodes' : 'resp.episodes');
        if (re.lat >= 0) R(re.lane ? 'resp.lane.lat' : 'resp.lat', re.lat);
        const cm = re.lat >= 0 && re.com >= 0 ? Math.min(re.lat, re.com) : Math.max(re.lat, re.com);
        if (cm >= 0) R(re.lane ? 'resp.lane.com' : 'resp.com', cm);
        else { add(C, re.lane ? 'resp.lane.none' : 'resp.none'); const rp = ent2p(re.resp); if (rp >= 0) add(H('resp.noneMode'), modeOf(rp)); }
        respEp.delete(vid); respCd.set(vid, now + 4);
      }
      // (g) collapse on a lone enemy in a team's half
      for (let team = 0; team < teams; team++) for (const pl of players) {
        const f = pl.ent; if (!f || f.team === team) continue;
        const key = f.id * 8 + team;
        let ok = f.alive && visTo(f, team) && ownHalf(team, f.x, f.y) && now >= 180;
        if (ok) for (const q of players) { const g = q.ent; if (g && g !== f && g.alive && g.team === f.team && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 14 * 14) { ok = false; break; } }
        if (ok) for (const s of sList()) { const st = s.ent; if (st.alive && st.team === f.team && st.attackDef && (st.x - f.x) ** 2 + (st.y - f.y) ** 2 <= (st.stats.range + st.radius + 4) ** 2) { ok = false; break; } }
        let ce = colEp.get(key);
        if (ce && !ce.done) {
          // resolved: two of the team within 12 m of it, or it died
          let at = 0; for (const q of players) { const g = q.ent; if (g && g.alive && g.team === team && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 12 * 12) at++; }
          if (!f.alive || at >= 2) { ce.done = true; add(C, ce.jungle ? 'col.j.episodes' : now < 840 ? 'col.l.episodes' : 'col.r.episodes'); add(C, ce.jungle ? 'col.j.ok' : now < 840 ? 'col.l.ok' : 'col.r.ok'); R(ce.jungle ? 'col.j.lat' : 'col.r.lat', now - ce.start); colCd.set(key, now + 20); continue; }
          if (ok) { ce.seen += dt; ce.last = now; }
          if (now - ce.start > 15 || now - ce.last > 3) {
            ce.done = true;
            // (counted only when it stayed in our ground in sight for 6 s: a target that left at once was not there to punish)
            if (ce.seen >= 6) { add(C, ce.jungle ? 'col.j.episodes' : now < 840 ? 'col.l.episodes' : 'col.r.episodes'); }
            colCd.set(key, now + 20);
          }
          continue;
        }
        if (!ok || now < (colCd.get(key) ?? 0)) { if (ce && ce.done) colEp.delete(key); continue; }
        // free fighters: alive, above 60 %, not recalling, within 50 m of it, no other visible enemy fighter within 15 m of them
        let free = 0;
        for (const q of players) {
          const g = q.ent; if (!g || !g.alive || g.team !== team || g.hp < g.maxHp * 0.6 || g.stateOverride === 'recall') continue;
          if ((g.x - f.x) ** 2 + (g.y - f.y) ** 2 > 50 * 50) continue;
          let busy = false; for (const o of players) { const h = o.ent; if (h && h !== f && h.alive && h.team !== team && visTo(h, team) && (h.x - g.x) ** 2 + (h.y - g.y) ** 2 <= 15 * 15) { busy = true; break; } }
          if (!busy) free++;
        }
        if (free < 2) continue;
        colEp.set(key, { team, start: now, seen: 0, last: now, jungle: offRoad(f.x, f.y, 9), free, done: false });
      }
      // (h) RIFT: under 25 % with an enemy fighter within 10 m — 4 s later still within 12 m of one and alive
      for (const pl of players) {
        const f = pl.ent; if (!f) continue;
        const nearest = (): number => { let bd = Infinity; for (const q of players) { const g = q.ent; if (g && g.alive && g.team !== f.team) bd = Math.min(bd, Math.hypot(g.x - f.x, g.y - f.y)); } return bd; };
        const le = rLowEp.get(pl.player);
        if (le) {
          if (!f.alive) { add(C, 'rift.low.died'); rLowEp.delete(pl.player); rLowCd.set(pl.player, now + 8); }
          else if (now - le.t >= 4) { const st = nearest() <= 12; add(C, st ? 'rift.low.stayed' : 'rift.low.clear'); if (st) add(H('rift.low.stayMode'), le.m); rLowEp.delete(pl.player); rLowCd.set(pl.player, now + 8); }
          continue;
        }
        if (!f.alive || f.hp >= f.maxHp * 0.25 || now < (rLowCd.get(pl.player) ?? 0) || nearest() > 10) continue;
        add(C, 'rift.low.episodes'); rLowEp.set(pl.player, { t: now, m: modeOf(pl.player) });
      }
      // (i) a fit fighter away from its base while enemy fighters hit a base structure: 25-80 m off, not closing in, no enemy
      // fighter within 12 m of it, not recalling (the whole team turns for the core)
      const awayDone = new Set<number>();
      for (const s of sList()) {
        const st = s.ent; if (!st.alive || cls(s.def.id) !== 'base' || now - (sFDmgAt.get(st.id) ?? -1e9) > 1.5) continue;
        for (const pl of players) {
          const f = pl.ent; if (!f || !f.alive || f.team !== st.team || f.hp < f.maxHp * 0.6 || f.stateOverride === 'recall' || awayDone.has(f.id)) continue;
          const d = Math.hypot(f.x - st.x, f.y - st.y); if (d <= 25 || d > 80) continue;
          const ph = posHist.get(f.id); if (!ph || ph.length < 4) continue;
          const [ox, oy] = ph[ph.length - 4];
          if (Math.hypot(ox - st.x, oy - st.y) - d >= 1.5) continue;
          let near = false; for (const q of players) { const g = q.ent; if (g && g.alive && g.team !== f.team && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 12 * 12) { near = true; break; } }
          if (near) continue;
          awayDone.add(f.id); add(C, 'base.fitAway', dt); add(H('base.fitAwayMode'), modeOf(pl.player), dt);
        }
      }
    }
    // (e) FRAY: under 25 % with an enemy fighter within 10 m — 4 s later still within 12 m of one ("stayed"), clear, or dead
    if (isFray) for (const pl of players) {
      const f = pl.ent; if (!f) continue;
      const nearest = (): number => { let bd = Infinity; for (const q of players) { const g = q.ent; if (g && g !== f && g.alive && g.team !== f.team) bd = Math.min(bd, Math.hypot(g.x - f.x, g.y - f.y)); } return bd; };
      const le = lowEp.get(pl.player);
      if (le) {
        if (!f.alive) { add(C, 'fray.low.died'); lowEp.delete(pl.player); lowCd.set(pl.player, now + 8); }
        else if (now - le.t >= 4) { const st = nearest() <= 12; add(C, st ? 'fray.low.stayed' : 'fray.low.clear'); if (st) add(H('fray.low.stayMode'), le.m); lowEp.delete(pl.player); lowCd.set(pl.player, now + 8); }
        continue;
      }
      if (!f.alive || f.hp >= f.maxHp * 0.25 || now < (lowCd.get(pl.player) ?? 0) || nearest() > 10) continue;
      add(C, 'fray.low.episodes'); lowEp.set(pl.player, { t: now, m: modeOf(pl.player) });
    }
    // focus coherence: teams with >= 3 fighters attacking enemy fighters
    if (!isFray) for (let team = 0; team < teams; team++) {
      const tg: Acc = {}; let k = 0;
      for (const pl of players) { const f = pl.ent; if (!f || !f.alive || f.team !== team || f.atkTarget < 0) continue; const t = w.entity(f.atkTarget); if (t && t.kind === 'fighter' && t.team !== team) { add(tg, String(t.id)); k++; } }
      if (k >= 3) { add(C, 'focus.samples'); add(C, 'focus.onTop', Math.max(...Object.values(tg)) / k); }
    }
    // grouping vs split from 14:00 (every 5 s)
    if (!isFray && now >= 840 && w.tick % 150 === 0) for (let team = 0; team < teams; team++) {
      const fs = players.map((q) => q.ent).filter((f): f is Entity => !!f && f.alive && f.team === team);
      if (fs.length < 3) continue;
      let big = 0;
      for (const a of fs) { let c = 0; for (const b of fs) if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= 20 * 20) c++; if (c > big) big = c; }
      add(C, 'group.samples'); add(C, 'group.largestShare', big / fs.length);
      for (const a of fs) {
        let alone = true; for (const b of fs) if (b !== a && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= 45 * 45) { alone = false; break; }
        if (!alone) continue;
        let nearES = false; for (const s of sList()) if (s.ent.alive && s.def.team !== team && (s.ent.x - a.x) ** 2 + (s.ent.y - a.y) ** 2 <= 30 * 30) { nearES = true; break; }
        add(C, nearES ? 'group.splitPushers' : 'group.aloneElsewhere');
      }
    }
    // minions stuck (no target, < 0.3 m in 3 s)
    if (w.tick % 30 === 0) for (const u of w.entities) {
      if (u.removed || !u.alive || u.kind !== 'minion') continue;
      const mp = minionPos.get(u.id);
      if (!mp || (u.x - mp[0]) ** 2 + (u.y - mp[1]) ** 2 > 0.09) { minionPos.set(u.id, [u.x, u.y, now]); continue; }
      if (u.atkTarget < 0 && now - mp[2] >= 3) { add(C, 'minion.stuckSec'); add(H('minion.stuckWhere'), `${Math.round(u.x / 4) * 4},${Math.round(u.y / 4) * 4}`); }
    }
    // FRAY: time with no enemy within 25 m
    if (isFray) for (const pl of players) { const f = pl.ent; if (!f || !f.alive) continue; let any = false; for (const q of players) { const g = q.ent; if (g && g !== f && g.alive && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 625) { any = true; break; } } add(C, any ? 'fray.engagedTime' : 'fray.idleTime', dt); }
  }
  const w = W();
  out.dur = w.time;
  // ult usage per minute alive after level 6
  for (let p = 0; p < n; p++) if (ultAt6[p] >= 0) add(C, 'ult.minutesAfter6', (w.time - ultAt6[p]) / 60);
  // ahead / behind at 15:00
  const g15 = goldAt[15];
  if (g15 && g15.length === 2) {
    const lead = g15[0] - g15[1];
    add(H('lead15'), Math.abs(lead) < 1500 ? 'even' : (lead > 0) === (out.winner === 0) ? 'aheadWon' : out.winner < 0 ? 'aheadUndecided' : 'aheadLost');
  }
  // items held at the end
  const anti = new Set(catalog.items.filter((i) => JSON.stringify(i).includes('grievous')).map((i) => i.id));
  for (const pl of w.players) {
    const its = pl.items.filter((x): x is string => !!x);
    add(C, 'items.held', its.length);
    if (its.some((x) => anti.has(x))) add(C, 'items.antiHealOwners');
    for (const it of its) add(H('items'), `${setup.seats[pl.player].role ?? '-'}:${it}`);
  }
  add(C, 'players', w.players.length);
  return out;
}

function merge(paths: string[]): void {
  const by: Record<string, GameOut[]> = {};
  for (const p of paths) {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { diff: string; games: GameOut[] } | { diff: string; games: GameOut[] }[];
    for (const j of Array.isArray(raw) ? raw : [raw]) for (const g of j.games) (by[`${g.mode}/${j.diff}`] ??= []).push(g);
  }
  for (const [key, gs] of Object.entries(by).sort()) {
    const C: Acc = {}, H: Record<string, Acc> = {}, R: Record<string, number[]> = {};
    for (const g of gs) { for (const [k, v] of Object.entries(g.c)) add(C, k, v); for (const [k, a] of Object.entries(g.h)) for (const [x, v] of Object.entries(a)) add((H[k] ??= {}), x, v); for (const [k, a] of Object.entries(g.resp)) (R[k] ??= []).push(...a); }
    const mins = gs.reduce((a, g) => a + g.dur / 60, 0);
    const med = (a: number[]): string => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1].toFixed(1); };
    const pc = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(0)}%` : '-');
    console.log(`\n=== ${key}: ${gs.length} games, ${mins.toFixed(0)} game-min, median ${med(gs.map((g) => g.dur / 60))} min, ends ${gs.filter((g) => g.reason === 'end').length}`);
    for (const c of ['outer', 'inner', 'base']) {
      console.log(`  ${c}: sieged ${(C[`siege.${c}.time`] ?? 0).toFixed(0)} s, undefended ${pc(C[`siege.${c}.undefended`] ?? 0, C[`siege.${c}.time`] ?? 0)} (with ≥2 alive ${pc(C[`siege.${c}.undefendedBodies`] ?? 0, C[`siege.${c}.time`] ?? 0)}); by fighters ${(C[`fsiege.${c}.time`] ?? 0).toFixed(0)} s, undefended-with-bodies ${pc(C[`fsiege.${c}.undefendedBodies`] ?? 0, C[`fsiege.${c}.time`] ?? 0)}; fighter-siege episodes ${C[`ep.${c}`] ?? 0} (defended at start ${C[`ep.${c}.defendedAtStart`] ?? 0}); undefended-start response median ${med(R[`resp.${c}`] ?? [])} s (n ${(R[`resp.${c}`] ?? []).length}), never answered ${C[`resp.${c}.never`] ?? 0}; falls ${C[`fall.${c}`] ?? 0}, with no defender in 20 m and ≥2 alive ${C[`fall.${c}.noDefender`] ?? 0}`);
      const am = H[`fsiege.${c}.absentMode`]; if (am) console.log(`     absent defenders' modes: ${Object.entries(am).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${v.toFixed(0)}s`).join(', ')}`);
    }
    console.log(`  base intrusions ${C['base.intrusions'] ?? 0}: 2-defender response median ${med(R['resp.base2'] ?? [])} s, unanswered ${C['base.intrusion.unanswered'] ?? 0}, recalls-to-defend ${C['base.recallToDefend'] ?? 0}`);
    console.log(`  peel: episodes ${C['peel.episodes'] ?? 0}, isolated ${pc(C['peel.isolated'] ?? 0, C['peel.episodes'] ?? 0)}; with helpers ${C['peel.withHelpers'] ?? 0}: hit diver ${pc(C['peel.hitDiver'] ?? 0, C['peel.withHelpers'] ?? 0)}, cc diver ${pc(C['peel.ccDiver'] ?? 0, C['peel.withHelpers'] ?? 0)}, heal/shield ${pc(C['peel.healShield'] ?? 0, C['peel.withHelpers'] ?? 0)}, no response ${pc(C['peel.noResponse'] ?? 0, C['peel.withHelpers'] ?? 0)}, all helpers left ${pc(C['peel.allHelpersLeft'] ?? 0, C['peel.withHelpers'] ?? 0)}, victim died ${pc(C['peel.victimDied'] ?? 0, C['peel.withHelpers'] ?? 0)}, diver died ${pc(C['peel.diverDied'] ?? 0, C['peel.withHelpers'] ?? 0)}`);
    if (H['peel.helperMode']) console.log(`     helper modes: ${Object.entries(H['peel.helperMode']).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`  takedowns ${C['td.n'] ?? 0} (${((C['td.n'] ?? 0) / mins).toFixed(2)}/min): rotations ${pc(C['td.rotation'] ?? 0, C['td.n'] ?? 0)}, of them from fog ${pc(C['td.rotationFromFog'] ?? 0, C['td.rotation'] ?? 0)}; multi-participant ${pc(C['td.multi'] ?? 0, C['td.n'] ?? 0)}; phase ${JSON.stringify(H['td.time'] ?? {})}`);
    console.log(`  roams ${C['roam.n'] ?? 0} (median ${med(R['roam.len'] ?? [])} s), visible to enemy ${pc(C['roam.visibleSamples'] ?? 0, C['roam.samples'] ?? 0)} of roam time`);
    console.log(`  engagement openers ${C['open.n'] ?? 0}: from a thicket ${pc(C['open.fromBush'] ?? 0, C['open.n'] ?? 0)}, out of fog ${pc(C['open.fromFog'] ?? 0, C['open.n'] ?? 0)}; thicket time ${((C['bush.time'] ?? 0) / Math.max(1, C['players'] ?? 1) / gs.length * 0 + (C['bush.time'] ?? 0) / (mins * 60 * 10) * 100).toFixed(1)}% of fighter-time, standing still in one ${((C['bush.stillTime'] ?? 0) / (mins * 60 * 10) * 100).toFixed(2)}%`);
    console.log(`  focus: ${(C['focus.samples'] ?? 0)} samples with ≥3 on fighters, share on the top target ${(((C['focus.onTop'] ?? 0) / Math.max(1, C['focus.samples'] ?? 0)) * 100).toFixed(0)}%`);
    console.log(`  deaths ${C['f.deaths'] ?? 0} (${((C['f.deaths'] ?? 0) / mins).toFixed(2)}/min): under enemy tower ${pc(C['f.deaths.underEnemyTower'] ?? 0, C['f.deaths'] ?? 0)}, stayed <30% ≥2 s outside retreat ${pc(C['f.deaths.stayedLow'] ?? 0, C['f.deaths'] ?? 0)}, isolated ${pc(C['f.deaths.isolated'] ?? 0, C['f.deaths'] ?? 0)}, <75 s after respawn ${pc(C['f.deaths.within75sOfRespawn'] ?? 0, C['f.deaths'] ?? 0)}, unforced ${pc(C['f.deaths.unforced'] ?? 0, C['f.deaths'] ?? 0)}`);
    if (H['death.mode3s']) console.log(`     mode 3 s before death: ${Object.entries(H['death.mode3s']).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (C['tm.even'] !== undefined) console.log(`     deaths per team-minute: behind ≥2000 ${((C['death.behind'] ?? 0) / Math.max(0.1, C['tm.behind'] ?? 0)).toFixed(2)} (${(C['tm.behind'] ?? 0).toFixed(0)} min), even ${((C['death.even'] ?? 0) / Math.max(0.1, C['tm.even'] ?? 0)).toFixed(2)}, ahead ${((C['death.ahead'] ?? 0) / Math.max(0.1, C['tm.ahead'] ?? 0)).toFixed(2)}`);
    console.log(`  last hits (Wicks by fighters before 14:00) ${pc(C['minion.lh14'] ?? 0, C['minion.deaths14'] ?? 0)}`);
    const fm = (C['players'] ?? 10) / gs.length * mins / gs.length * gs.length;
    void fm;
    const seatMin = gs.reduce((a, g) => a + (g.c['players'] ?? 10) * g.dur / 60, 0);
    console.log(`  abilities ${((C['abil.casts'] ?? 0) / seatMin).toFixed(2)}/seat-min (with an enemy fighter in 15 m ${pc(C['abil.casts.withEnemy'] ?? 0, C['abil.casts'] ?? 0)}), chains ${pc(C['abil.chain'] ?? 0, C['abil.casts.withEnemy'] ?? 0)}; ults ${((C['ult.casts'] ?? 0) / Math.max(1, C['ult.minutesAfter6'] ?? 1)).toFixed(2)}/min after lvl 6, no enemy in 15 m ${pc(C['ult.noEnemy15'] ?? 0, C['ult.casts'] ?? 0)}; spells ${((C['spell.casts'] ?? 0) / seatMin).toFixed(2)}/seat-min, item actives ${((C['itemActive.casts'] ?? 0) / seatMin).toFixed(3)}/seat-min`);
    console.log(`  fog: casts the observing team could not see ${pc(C['cast.unseenObservers'] ?? 0, C['cast.observers'] ?? 0)}; of them recorded in its cooldown memory ${C['cast.leaked'] ?? 0}`);
    console.log(`  ganks: lurks ${C['gank.lurks'] ?? 0}, strikes from a lurk ${C['gank.strikeLurk'] ?? 0} (takedown within 8 s ${C['gank.successLurk'] ?? 0}), from an approach ${C['gank.strikeApproach'] ?? 0} (${C['gank.success'] ?? 0})`);
    if (H['peel.noRespMode']) console.log(`     no-response helper modes: ${Object.entries(H['peel.noRespMode']).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`  peel heal/shield where one was ready ${pc(C['peel.healReadyUsed'] ?? 0, C['peel.healReady'] ?? 0)}; objective takes with a lamp of the taker within 16 m ${pc(C['obj.lamp'] ?? 0, C['obj.n'] ?? 0)}`);
    console.log(`  objectives ${JSON.stringify(H['obj'] ?? {})}: contested ${pc(C['obj.contested'] ?? 0, C['obj.n'] ?? 0)}, mean own at ${((C['obj.ownAt'] ?? 0) / Math.max(1, C['obj.n'] ?? 0)).toFixed(1)}, by the team behind ${C['obj.byBehind'] ?? 0}; camps ${JSON.stringify(H['camp.kill'] ?? {})}`);
    console.log(`  grouping (14:00+): largest cluster ${(((C['group.largestShare'] ?? 0) / Math.max(1, C['group.samples'] ?? 0)) * 100).toFixed(0)}% of the living team; split pushers ${((C['group.splitPushers'] ?? 0) / Math.max(1, C['group.samples'] ?? 0)).toFixed(2)}/team-sample, alone elsewhere ${((C['group.aloneElsewhere'] ?? 0) / Math.max(1, C['group.samples'] ?? 0)).toFixed(2)}`);
    console.log(`  lead at 15:00 ${JSON.stringify(H['lead15'] ?? {})}; defend entries ${C['defend.entries'] ?? 0}; recalls ${C['recall.start'] ?? 0}`);
    const mt = H['mode.time'] ?? {}; const tot = Object.values(mt).reduce((a, b) => a + b, 0);
    console.log(`  mode share: ${Object.entries(mt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / tot) * 100).toFixed(1)}%`).join(', ')}`);
    console.log(`  stuck (move order, < 0.4 m in 3 s): ${((C['stuck.time'] ?? 0) / seatMin).toFixed(2)} s/seat-min; hotspots ${Object.entries(H['stuck.where'] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v.toFixed(0)}s`).join(' ')}`);
    console.log(`  Wicks stuck (no target, < 0.3 m in 3 s): ${(C['minion.stuckSec'] ?? 0)} Wick-s; hotspots ${Object.entries(H['minion.stuckWhere'] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    if (key.startsWith('fray')) console.log(`  fray: idle (no one in 25 m) ${pc(C['fray.idleTime'] ?? 0, (C['fray.idleTime'] ?? 0) + (C['fray.engagedTime'] ?? 0))}, kills on the score leader ${pc(C['fray.killLeader'] ?? 0, C['td.n'] ?? 0)}`);
    console.log(`  items: anti-heal owners ${pc(C['items.antiHealOwners'] ?? 0, C['players'] ?? 0)}, mean held ${((C['items.held'] ?? 0) / Math.max(1, C['players'] ?? 1)).toFixed(1)}`);
  }
}

interface TierRun { diff: string; games: GameOut[] }

function sum(gs: GameOut[], k: string): number { return gs.reduce((a, g) => a + (g.c[k] ?? 0), 0); }
function share(a: number, b: number): number { return b > 0 ? a / b : 0; }

/** the gates of the header, per tier; returns the failures */
function gates(runs: TierRun[]): string[] {
  const fails: string[] = [];
  const line = (ok: boolean, name: string, v: string, bar: string): void => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}: ${v} (bar ${bar})`); if (!ok) fails.push(name); };
  const rpt = (name: string, v: string): void => console.log(`  ---- ${name}: ${v}`);
  const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;
  const by: Record<string, { rift: GameOut[]; fray: GameOut[] }> = {};
  for (const r of runs) { const b = (by[r.diff] ??= { rift: [], fray: [] }); for (const g of r.games) { if (g.mode === 'rift') b.rift.push(g); else if (g.mode === 'fray') b.fray.push(g); } }
  // (bars: the diagnosis baseline of e5ea2bac1 in owner_rulings 40, beaten with room for an 8-seed window's noise)
  const T = { undef: { novice: 0.45, adept: 0.35, veteran: 0.20 }, unans: { novice: 3, adept: 1.5, veteran: 1 }, noResp: { novice: 0.30, adept: 0.24, veteran: 0.22 },
    left: { novice: 0.20, adept: 0.16, veteran: 0.165 }, wicksOver: { novice: 2, adept: 1.6, veteran: 1.1 }, roamVis: { novice: 0.25, adept: 0.15, veteran: 0.15 },
    // (owner_rulings 44)
    idle: { novice: 60, adept: 20, veteran: 10 }, punish: { novice: 0, adept: 0.3, veteran: 0.5 }, partner: { novice: 0.3, adept: 0.6, veteran: 0.75 },
    dither: { novice: 3, adept: 1.5, veteran: 1 }, frayStay: { novice: 1, adept: 0.6, veteran: 0.5 },
    // (owner_rulings 44, round 2)
    respLat: { novice: 2.5, adept: 2.5, veteran: 1.5 }, resp: { novice: 0, adept: 0.8, veteran: 0.8 }, collapse: { novice: 0, adept: 0, veteran: 0.6 },
    // (away: under half the pre-lane bots' 42.9 / 15.5 / 20.8 s a game on seeds 101-164, ≥ 2 SE above the round-2 code's 12.1 / 4.4 / 1.8)
    away: { novice: 25, adept: 9, veteran: 6 } } as const;
  const undefShare: Record<string, number> = {}, noRespShare: Record<string, number> = {};
  for (const diff of ['novice', 'adept', 'veteran'] as const) {
    const b = by[diff];
    if (!b) continue;
    const R = b.rift, F = b.fray;
    console.log(`\n${diff}: ${R.length} RIFT games, ${F.length} FRAY games`);
    if (R.length > 0) {
      const ut = sum(R, 'fsiege.inner.undefendedBodies') + sum(R, 'fsiege.base.undefendedBodies'), tt = sum(R, 'fsiege.inner.time') + sum(R, 'fsiege.base.time');
      undefShare[diff] = share(ut, tt);
      line(undefShare[diff] <= T.undef[diff], `${diff} base defence: inner+base fighter siege with no defender in 16 m`, pct(undefShare[diff]), `≤ ${pct(T.undef[diff])}`);
      const un = sum(R, 'base.intrusion.unanswered') / R.length;
      line(un <= T.unans[diff], `${diff} base defence: intrusions unanswered per game`, un.toFixed(2), `≤ ${T.unans[diff]}`);
      // (owner_rulings 42: an inner or base structure taken by Wicks alone with two fit defenders within 16 m)
      const wo = (sum(R, 'fall.inner.wicksOverFit') + sum(R, 'fall.base.wicksOverFit')) / R.length;
      line(wo <= T.wicksOver[diff], `${diff} base defence: inner+base falls to Wicks alone beside two fit defenders, per game`, wo.toFixed(2), `≤ ${T.wicksOver[diff]}`);
      // (recalls to defend are pooled over adept and veteran below: a few a window, a tier's own count is noise)
      rpt(`${diff} recalls to defend`, String(sum(R, 'base.recallToDefend')));
      const wh = sum(R, 'peel.withHelpers');
      noRespShare[diff] = share(sum(R, 'peel.noResponse'), wh);
      line(noRespShare[diff] <= T.noResp[diff], `${diff} peel: no response with an ally within 12 m`, pct(noRespShare[diff]), `≤ ${pct(T.noResp[diff])}`);
      const left = share(sum(R, 'peel.allHelpersLeft'), wh);
      line(left <= T.left[diff], `${diff} peel: every helper walked away`, pct(left), `≤ ${pct(T.left[diff])}`);
      rpt(`${diff} peel: heal/shield on the victim where one was ready`, pct(share(sum(R, 'peel.healReadyUsed'), sum(R, 'peel.healReady'))));
      rpt(`${diff} peel: diver died`, pct(share(sum(R, 'peel.diverDied'), wh)));
      // (the approach is the sneak — the strike is a fight in the open by nature, so it is reported, not gated)
      const rva = share(sum(R, 'roam.phVis.approach') + sum(R, 'roam.phVis.lurk'), sum(R, 'roam.ph.approach') + sum(R, 'roam.ph.lurk'));
      if (diff !== 'novice') line(rva <= T.roamVis[diff], `${diff} sneak: gank approach time visible to the enemy`, pct(rva), `≤ ${pct(T.roamVis[diff])}`);
      rpt(`${diff} sneak: all roam time visible to the enemy (strike included)`, pct(share(sum(R, 'roam.visibleSamples'), sum(R, 'roam.samples'))));
      rpt(`${diff} sneak: ganks struck from a lurk (mid game on)`, `${sum(R, 'gank.strikeLurk')} (from approach ${sum(R, 'gank.strikeApproach')}, lurk kills ${sum(R, 'gank.successLurk')})`);
      rpt(`${diff} sneak: rotations out of fog`, pct(share(sum(R, 'td.rotationFromFog'), sum(R, 'td.rotation'))));
      rpt(`${diff} sneak: fights opened from a thicket`, pct(share(sum(R, 'open.fromBush'), sum(R, 'open.n'))));
      const leak = sum(R, 'cast.leaked') + sum(F, 'cast.leaked');
      line(leak === 0, `${diff} fog honesty: hidden casts recorded`, `${leak} of ${sum(R, 'cast.unseenObservers') + sum(F, 'cast.unseenObservers')} unseen`, '= 0');
      const ah = share(sum(R, 'death.ahead'), sum(R, 'tm.ahead')), ev = share(sum(R, 'death.even'), sum(R, 'tm.even'));
      if (diff !== 'novice' && sum(R, 'tm.ahead') >= 5) line(ah <= ev * 1.5, `${diff} overextension: deaths per team-minute ahead vs even`, `${ah.toFixed(2)} vs ${ev.toFixed(2)}`, '≤ 1.5 × even');
      else rpt(`${diff} deaths per team-minute ahead vs even`, `${ah.toFixed(2)} vs ${ev.toFixed(2)}`);
      rpt(`${diff} isolated deaths`, pct(share(sum(R, 'f.deaths.isolated'), sum(R, 'f.deaths'))));
      const long = R.filter((g) => g.dur >= 1080), ls = long.reduce((a, g) => a + (g.h.obj?.longshade ?? 0), 0);
      if (diff === 'veteran' && long.length >= 3) line(ls / long.length >= 0.25, `${diff} objectives: Longshade per game past 18:00`, `${(ls / long.length).toFixed(2)} (${long.length} games)`, '≥ 0.25');
      else rpt(`${diff} Longshade per game past 18:00`, long.length ? (ls / long.length).toFixed(2) : '-');
      const lamp = share(sum(R, 'obj.lamp'), sum(R, 'obj.n'));
      if (diff !== 'novice' && sum(R, 'obj.n') >= 10) line(lamp >= 0.1, `${diff} objectives: a lamp of the taking team near the pit`, pct(lamp), '≥ 10 %');
      else rpt(`${diff} objective takes with a lamp near`, pct(lamp));
      rpt(`${diff} objectives contested`, pct(share(sum(R, 'obj.contested'), sum(R, 'obj.n'))));
      rpt(`${diff} grouping 14:00+: largest cluster`, pct(share(sum(R, 'group.largestShare'), sum(R, 'group.samples'))));
      rpt(`${diff} ability chains`, pct(share(sum(R, 'abil.chain'), sum(R, 'abil.casts.withEnemy'))));
      // ── owner_rulings 44 (the round-2 verifier's repros) ──
      const idle = sum(R, 'post.idleBesideSiege') / R.length;
      line(idle <= T.idle[diff], `${diff} base defence: fit fighters standing idle within 25 m of an inner or base structure under fighter attack, no enemy within 12 m (s per game)`, idle.toFixed(1), `≤ ${T.idle[diff]}`);
      const ie = sum(R, 'invade.episodes'), ip = share(sum(R, 'invade.punished'), ie);
      if (diff !== 'novice' && ie >= 8) line(ip >= T.punish[diff], `${diff} sneak: invaders seen 8 s alone in our half of the Dialwood (3:00-14:00) hit within 20 s`, `${pct(ip)} of ${ie}`, `≥ ${pct(T.punish[diff])}`);
      else rpt(`${diff} invaders punished`, `${pct(ip)} of ${ie}`);
      const pe = sum(R, 'partner.episodes'), pr = share(sum(R, 'partner.responded'), pe);
      if (pe >= 20) line(pr >= T.partner[diff], `${diff} peel: a dived carry's road partner within 6 m damages, holds or heals for it within 3 s`, `${pct(pr)} of ${pe}`, `≥ ${pct(T.partner[diff])}`);
      else rpt(`${diff} partner peel`, `${pct(pr)} of ${pe}`);
      const dith = sum(R, 'dither.episodes') / R.length;
      line(dith <= T.dither[diff], `${diff} dithering: full health, no enemy within 30 m, no swing in 12 s, 3+ back-and-forth legs of 4 m+ ending within 5 m (per game)`, dith.toFixed(2), `≤ ${T.dither[diff]}`);
      rpt(`${diff} objectives taken with one of ours against three of theirs within 22 m`, String(sum(R, 'obj.outnumbered')));
      // ── owner_rulings 44, round 2 ──
      const lats = R.flatMap((g) => g.resp['resp.com'] ?? []), rEp = sum(R, 'resp.episodes');
      const lim = T.respLat[diff], inT = lats.filter((x) => x <= lim).length, rs = share(inT, rEp);
      { const ld = R.flatMap((g) => g.resp['resp.lat'] ?? []); rpt(`${diff} designated peeler lands a blow, hold, heal or shield within ${lim} s (from 14:00)`, `${pct(share(ld.filter((x) => x <= lim).length, rEp))} of ${rEp}; within 3 s ${pct(share(ld.filter((x) => x <= 3).length, rEp))}`); }
      const rSe = Math.sqrt(rs * (1 - rs) / Math.max(1, rEp));
      if (diff !== 'novice' && rEp >= 30) line(rs >= T.resp[diff], `${diff} peel: the designated peeler (support within 8 m, else the nearest teammate within 12 m above half health) turns on the diver (attack or attack order on it, hold, heal or shield) within ${lim} s (from 14:00)`, `${pct(rs)} ± ${pct(rSe)} of ${rEp}`, `≥ ${pct(T.resp[diff])}`);
      else rpt(`${diff} designated peeler answers within ${lim} s (from 14:00)`, `${pct(rs)} ± ${pct(rSe)} of ${rEp}`);
      { const ll = R.flatMap((g) => g.resp['resp.lane.com'] ?? []), le2 = sum(R, 'resp.lane.episodes'); rpt(`${diff} designated peeler answers within ${lim} s (laning phase)`, `${pct(share(ll.filter((x) => x <= lim).length, le2))} of ${le2}`); }
      const cj = sum(R, 'col.j.episodes'), cr = sum(R, 'col.r.episodes'), cok = sum(R, 'col.j.ok') + sum(R, 'col.r.ok'), cs = share(cok, cj + cr);
      const cSe = Math.sqrt(cs * (1 - cs) / Math.max(1, cj + cr));
      if (diff === 'veteran' && cj + cr >= 20) line(cs >= T.collapse[diff], `${diff} sneak: a lone enemy seen 6 s in our Dialwood (3:00+) or on a road in our half (14:00+), out of its towers' cover, two of ours free: 2+ on it within 15 s`, `${pct(cs)} ± ${pct(cSe)} of ${cj + cr} (Dialwood ${pct(share(sum(R, 'col.j.ok'), cj))} of ${cj}, roads ${pct(share(sum(R, 'col.r.ok'), cr))} of ${cr})`, `≥ ${pct(T.collapse[diff])}`);
      else rpt(`${diff} collapse on a lone enemy in our half`, `${pct(cs)} ± ${pct(cSe)} of ${cj + cr} (Dialwood ${pct(share(sum(R, 'col.j.ok'), cj))} of ${cj}, roads ${pct(share(sum(R, 'col.r.ok'), cr))} of ${cr}; laning-phase roads ${pct(share(sum(R, 'col.l.ok'), sum(R, 'col.l.episodes')))} of ${sum(R, 'col.l.episodes')})`);
      const rle = sum(R, 'rift.low.episodes'), rls = share(sum(R, 'rift.low.stayed'), rle);
      { const hs: Acc = {}; for (const g of R) for (const [k2, v] of Object.entries(g.h['rift.low.stayMode'] ?? {})) add(hs, k2, v); rpt(`${diff} RIFT low and stayed: mode at the start`, Object.entries(hs).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2} ${v}`).join(', ')); }
      { const hs: Acc = {}; for (const g of R) for (const [k2, v] of Object.entries(g.h['fall.wicksOverFit.mode'] ?? {})) add(hs, k2, v); rpt(`${diff} falls to Wicks beside fit defenders: the fit defenders' modes`, Object.entries(hs).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2} ${v}`).join(', ')); }
      { const hs: Acc = {}; for (const g of R) for (const [k2, v] of Object.entries(g.h['resp.noneMode'] ?? {})) add(hs, k2, v); rpt(`${diff} designated peeler that did not answer: its mode`, Object.entries(hs).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2} ${v}`).join(', ')); }
      { const hs: Acc = {}; for (const g of R) for (const [k2, v] of Object.entries(g.h['base.fitAwayMode'] ?? {})) add(hs, k2, v); rpt(`${diff} fit and away while the base is hit: mode (s)`, Object.entries(hs).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2} ${v.toFixed(0)}`).join(', ')); }
      rpt(`${diff} self-preservation: under 25 % with a foe in 10 m, still beside one 4 s later (RIFT)`, `${pct(rls)} of ${rle} (clear ${pct(share(sum(R, 'rift.low.clear'), rle))}, died ${pct(share(sum(R, 'rift.low.died'), rle))})`);
      const away = R.map((g) => g.c['base.fitAway'] ?? 0), am = away.reduce((a, b) => a + b, 0) / R.length;
      const aSe = Math.sqrt(away.reduce((a, b) => a + (b - am) ** 2, 0) / Math.max(1, R.length - 1) / R.length);
      line(am <= T.away[diff], `${diff} base defence: fit fighters 25-80 m from a base structure under fighter attack, not closing in, no foe within 12 m (s per game)`, `${am.toFixed(1)} ± ${aSe.toFixed(1)}`, `≤ ${T.away[diff]}`);
      const ob = sum(R, 'obj.outnumbered');
      rpt(`${diff} objectives: taken with one of ours against three of theirs within 22 m (per game; open, owner_rulings 44)`, `${(ob / R.length).toFixed(3)} (${ob})`);
      { const hs: Acc = {}; for (const g of R) for (const [k2, v] of Object.entries(g.h['obj.outnumbered.mode'] ?? {})) add(hs, k2, v); rpt(`${diff} objectives taken outnumbered: the taker's mode / camp`, Object.entries(hs).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2} ${v}`).join(', ')); }
    }
    if (F.length > 0) {
      const fd = F.reduce((a, g) => a + (g.h['death.mode3s']?.retreat ?? 0), 0), all = sum(F, 'f.deaths');
      // (reported: FRAY keeps its retreat rules — an early-burst retreat there handed one kit the placements, owner_rulings 40)
      rpt(`${diff} fray: deaths that were already in retreat 3 s before`, pct(share(fd, all)));
      { const hs: Acc = {}; for (const g of F) for (const [k2, v] of Object.entries(g.h['fray.low.stayMode'] ?? {})) add(hs, k2, v); rpt(`${diff} fray low and stayed: mode at the start`, Object.entries(hs).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2} ${v}`).join(', ')); }
      rpt(`${diff} fray: kills on the score leader`, pct(share(sum(F, 'fray.killLeader'), sum(F, 'td.n'))));
      // (owner_rulings 44: under 25 % with a foe within 10 m — still within 12 m of one 4 s later and alive)
      const le = sum(F, 'fray.low.episodes'), ls = share(sum(F, 'fray.low.stayed'), le);
      line(ls <= T.frayStay[diff], `${diff} fray: under 25 % with a foe in 10 m, still beside one 4 s later`, `${pct(ls)} of ${le} (clear ${pct(share(sum(F, 'fray.low.clear'), le))}, died ${pct(share(sum(F, 'fray.low.died'), le))})`, `≤ ${pct(T.frayStay[diff])}`);
    }
  }
  {
    const rift = runs.filter((r) => r.diff === 'adept' || r.diff === 'veteran').flatMap((r) => r.games.filter((g) => g.mode === 'rift'));
    if (rift.length > 0) {
      line(sum(rift, 'base.recallToDefend') > 0, 'adept + veteran base defence: recalls to defend', String(sum(rift, 'base.recallToDefend')), '> 0');
      line(sum(rift, 'gank.strikeLurk') > 0, 'adept + veteran sneak: ganks struck from a lurk', String(sum(rift, 'gank.strikeLurk')), '> 0');
    }
  }
  if (undefShare.veteran !== undefined && undefShare.adept !== undefined) line(undefShare.veteran <= undefShare.adept + 0.05, 'ladder: veteran base defence vs adept', `${pct(undefShare.veteran)} vs ${pct(undefShare.adept)}`, '≤ adept + 5 points');
  if (noRespShare.veteran !== undefined && noRespShare.adept !== undefined) line(noRespShare.veteran <= noRespShare.adept + 0.05, 'ladder: veteran peel no-response vs adept', `${pct(noRespShare.veteran)} vs ${pct(noRespShare.adept)}`, '≤ adept + 5 points');
  return fails;
}

const MERGE = opt('merge', '');
const WORKER = opt('worker', '');
if (MERGE) merge(MERGE.split(','));
else if (WORKER) {
  const seeds = Number(opt('seeds', '48')), seed0 = Number(opt('seed0', '1')), cut = Number(opt('cut', '1800'));
  const fraySeeds = Number(opt('fray-seeds', argv.includes('--seeds') ? String(seeds) : '24'));
  const suites = opt('suites', 'rift,fray').split(',');
  const catalog = loadCatalog();
  const games: GameOut[] = [];
  for (const s of suites) for (let i = 0; i < (s === 'fray' ? fraySeeds : seeds); i++) games.push(runGame(catalog, s, seed0 + i, WORKER, cut));
  writeFileSync(opt('out', ''), JSON.stringify({ diff: WORKER, games }));
} else {
  const diffs = opt('diffs', 'novice,adept,veteran').split(',');
  const pass = ['seeds', 'seed0', 'cut', 'suites', 'fray-seeds'].flatMap((k) => (argv.includes(`--${k}`) ? [`--${k}`, opt(k, '')] : []));
  const t0 = Date.now();
  const tmp = (d: string): string => `_harness/_reports/_tmp_tactics_${process.pid}_${d}.json`;
  const runs = await Promise.all(diffs.map((d) => new Promise<TierRun>((done, fail) => {
    const ch = spawn(process.execPath, [process.argv[1], '--worker', d, '--out', tmp(d), ...pass], { stdio: ['ignore', 'inherit', 'inherit'] });
    ch.on('close', (code) => { if (code !== 0) { fail(new Error(`worker ${d} exited ${code}`)); return; } done(JSON.parse(readFileSync(tmp(d), 'utf8')) as TierRun); });
  })));
  const outp = opt('out', '');
  if (outp) writeFileSync(outp, JSON.stringify(runs));
  for (const r of runs) writeFileSync(tmp(r.diff), JSON.stringify(r));
  console.log(`probe_sim_bot_tactics: ${runs.reduce((a, r) => a + r.games.length, 0)} games in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (argv.includes('--table')) merge(runs.map((r) => tmp(r.diff)));
  const fails = gates(runs);
  for (const r of runs) { try { unlinkSync(tmp(r.diff)); } catch { /* gone already */ } }
  console.log(fails.length ? `\nFAIL: ${fails.length} gate(s)` : '\nPASS: every gate');
  process.exit(fails.length ? 1 : 0);
}

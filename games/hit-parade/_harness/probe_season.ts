// HIT PARADE - G11 THE SEASON gate, node part (lane AI, CONTRACT §11, §13 G11, §23.6). Node only, no browser.
//
//   node _harness/probe_season.ts        (run_probes runs it with no args)   -v  per-run lines
//
// What it proves, on the REAL data/ + the REAL app/flow.ts ladder builder (the one game.ts runs) + the REAL sim + CPU:
//   S1 ladder data    data/ladder.json season / pilot slot arrays are what flow.ts ladderSpecs() reads (not its silent
//                     defaults): 8 bouts + BRAWL BREAK after Ep 3 + HECKLER TOSS after Ep 6 (SEASON), 5 bouts + BRAWL BREAK
//                     after Ep 2 (PILOT); rival at Ep 5; mini boss THE FREAK then BOSS RICKY last; every string key the
//                     ladder names (banter / cards / endings) exists; ladder rivals == fighters/<id>.json rival
//   S2 resolution     every fighter (12, bosses included) x SEASON / PILOT x difficulty -2 / 0 / +2 x 6 run seeds:
//                     slot kinds in order, episode numbers, levels = spec + shift clamped 0..8, bonus level 0, random
//                     opponents distinct / never the player / never the rival, rival slot = the fighter's rival, mini
//                     boss / boss slots, every opponent's home stage is a built stage, deterministic per seed
//   S3 bonus rounds   BRAWL BREAK and HECKLER TOSS for all 12 fighters in the sim exactly as game.ts stages them (mode
//                     brawl / heckler, P2 = the player's own id at cpu 0 - absent): the round runs to MATCH_END, winner 0,
//                     a scripted player scores (> 0), the CPU gives word 0 in both modes
//   S4 boss phases    RICKY (the boss slot's CPU L6) in an arcade bout: phase 2 fires (PHASE event) the first time he drops
//                     below 50 %, stays for the later rounds (unique u0 = 2), his CPU plays the phase-2 recipe table and
//                     starts phase-2 moves (PYRO / SEASON FINALE) after it
//   S5 full runs      a PILOT for every fighter and a SEASON for 3 fighters, slot by slot as game.ts runs them (arcade
//                     bouts vs the slot's CPU level, the player = the 'optimal' persona as a stand-in, bonus rounds by the scripted
//                     player), continues on a loss, until SeasonRun.cleared -> the ending card's data: fighters/<id>.json
//                     `ending` text + ladder.json endings key + unlocks.seasonClear
// The browser half of G11 (real key events through the menus, a bonus round and the boss to the ending card) is
// `python _harness/playtest.py --season`.

import { loadGameData } from '../runtime/src/core/data.ts';
import type { GameData, SimEvent } from '../runtime/src/core/types.ts';
import { createMatch, readFighter, readMatch, step } from '../runtime/src/core/sim/match.ts';
import type { Match, MatchCfg } from '../runtime/src/core/sim/match.ts';
import { EV, EVX, eventsSince } from '../runtime/src/core/sim/events.ts';
import { F, PH, ST, fighterBase } from '../runtime/src/core/sim/layout.ts';
import { createCpu } from '../runtime/src/core/ai/cpu.ts';
import { createPersona } from '../runtime/src/core/ai/personas.ts';
import { buildSeason, ladderSpecs, SeasonRun } from '../runtime/src/app/flow.ts';
import type { SeasonLength, SeasonRoster, SeasonSlot } from '../runtime/src/app/flow.ts';
import { playableStage } from '../runtime/src/ui/data.ts';

const VERBOSE = process.argv.includes('-v');
const data: GameData = loadGameData();
const ladder = data.ladder as unknown as Record<string, unknown>;
const strings = data.strings as Record<string, string>;
const ALL = Object.keys(data.fighters);
const MINI = String(ladder.miniBoss ?? 'freak');
const BOSS = String(ladder.boss ?? 'ricky');

let checks = 0;
const fails: string[] = [];
function ok(cond: boolean, label: string): boolean {
  checks++;
  if (!cond) fails.push(label);
  if (VERBOSE || !cond) console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  return cond;
}
const lines: string[] = [];
function say(s: string): void {
  lines.push(s);
  console.log(s);
}

// the roster exactly as game.ts roster() builds it (playable = every fighter but the mini boss / boss; rival from JSON)
const roster: SeasonRoster = {
  playable: ALL.filter((id) => id !== MINI && id !== BOSS),
  miniboss: MINI,
  boss: BOSS,
  rival: (id) => {
    const r = (data.fighters[id] as unknown as { rival?: string }).rival;
    return typeof r === 'string' && r && r !== '-' && data.fighters[r] && ALL.includes(r) ? r : null;
  },
};
const homeStage = (id: string | null): string => {
  const st = id ? (data.fighters[id] as unknown as { stage?: string }).stage : undefined;
  return typeof st === 'string' && st ? st : 'rust_theater';
};
const builtStages = new Set(((data.stages as unknown as { stages?: { id: string; status?: string }[] }).stages ?? []).filter((s) => s.status !== 'todo').map((s) => s.id));

// ------------------------------------------------------------------ S1 ladder data
{
  const want: Record<SeasonLength, string[]> = {
    season: ['bout', 'bout', 'bout', 'brawl', 'bout', 'rival', 'bout', 'heckler', 'miniboss', 'boss'],
    pilot: ['bout', 'bout', 'brawl', 'bout', 'miniboss', 'boss'],
  };
  for (const len of ['season', 'pilot'] as const) {
    const raw = ladder[len] as unknown[];
    const specs = ladderSpecs(ladder, len);
    const kinds = specs.map((s) => s.kind);
    ok(Array.isArray(raw) && raw.length === specs.length && kinds.every((k, i) => (raw[i] as { kind: string }).kind === k), `S1 ${len}: flow.ladderSpecs reads data/ladder.json (${specs.length} slots) - not its defaults`);
    ok(JSON.stringify(kinds) === JSON.stringify(want[len]), `S1 ${len} slot order ${kinds.join(' ')}`);
    const bouts = specs.filter((s) => s.kind !== 'brawl' && s.kind !== 'heckler').length;
    ok(bouts === (len === 'season' ? 8 : 5), `S1 ${len}: ${bouts} bouts (CONTRACT §1: SEASON 8, PILOT 5)`);
    const lv = specs.filter((s) => s.kind !== 'brawl' && s.kind !== 'heckler').map((s) => s.level);
    ok(lv.every((l, i) => i === 0 || l >= lv[i - 1]) && lv[lv.length - 1] === 6, `S1 ${len} Normal levels never drop, boss L6: ${lv.join(' ')}`);
    ok(specs.find((s) => s.kind === 'miniboss')?.opponent === MINI && specs.find((s) => s.kind === 'boss')?.opponent === BOSS, `S1 ${len}: mini boss ${MINI}, boss ${BOSS}`);
  }
  const keys: string[] = [];
  for (const r of (ladder.rivals as { fighter: string; rival: string; banter: string[] }[])) {
    keys.push(...r.banter);
    ok(roster.rival(r.fighter) === r.rival, `S1 ladder rivals: ${r.fighter} -> ${r.rival} == fighters/${r.fighter}.json rival (${roster.rival(r.fighter)})`);
  }
  for (const c of Object.values(ladder.cards as Record<string, Record<string, string>>)) keys.push(...Object.values(c));
  for (const k of Object.values(ladder.endings as Record<string, string>)) keys.push(k);
  const missing = keys.filter((k) => !(k in strings));
  ok(missing.length === 0, `S1 ${keys.length} ladder string keys resolve in strings.json${missing.length ? ' MISSING ' + missing.join(',') : ''}`);
  const unl = (ladder.unlocks as { seasonClear?: string[] } | undefined)?.seasonClear ?? [];
  ok(unl.includes(MINI) && unl.includes(BOSS), `S1 unlocks.seasonClear = ${unl.join(',')}`);
  const bonus = ladder.bonus as Record<string, { mode: string; seconds: number }>;
  ok(bonus.brawl?.mode === 'brawl' && bonus.brawl.seconds === data.system.brawl?.seconds && bonus.heckler?.mode === 'heckler' && bonus.heckler.seconds === (data.system as unknown as { heckler?: { seconds?: number } }).heckler?.seconds,
    `S1 bonus rounds: brawl ${bonus.brawl?.seconds} s / heckler ${bonus.heckler?.seconds} s == system.json (${data.system.brawl?.seconds} / ${(data.system as unknown as { heckler?: { seconds?: number } }).heckler?.seconds})`);
}

// ------------------------------------------------------------------ S2 resolution (12 fighters x 2 lengths x 3 difficulties x 6 seeds)
{
  let runs = 0;
  const bad: string[] = [];
  const orders = new Set<string>();
  for (const fighter of ALL) for (const len of ['season', 'pilot'] as const) for (const diff of [-2, 0, 2]) for (let sd = 1; sd <= 6; sd++) {
    runs++;
    const init = { fighter, color: 0, scheme: 0 as const, length: len, difficulty: diff, seed: sd * 7919 };
    const slots = buildSeason(init, roster, ladder);
    const again = buildSeason(init, roster, ladder);
    const specs = ladderSpecs(ladder, len);
    const tag = `${fighter}/${len}/d${diff}/s${sd}`;
    if (JSON.stringify(slots) !== JSON.stringify(again)) bad.push(`${tag} not deterministic`);
    if (slots.length !== specs.length) bad.push(`${tag} ${slots.length} slots`);
    const rival = roster.rival(fighter);
    const randoms: string[] = [];
    let ep = 0;
    slots.forEach((s: SeasonSlot, i) => {
      const sp = specs[i];
      const bonus = s.kind === 'brawl' || s.kind === 'heckler';
      if (s.kind !== sp.kind) bad.push(`${tag} slot ${i} kind ${s.kind}`);
      if (!bonus) ep++;
      if (s.episode !== (bonus ? 0 : ep)) bad.push(`${tag} slot ${i} episode ${s.episode}`);
      const lv = bonus ? 0 : Math.max(0, Math.min(8, sp.level + diff));
      if (s.level !== lv) bad.push(`${tag} slot ${i} level ${s.level} != ${lv}`);
      if (bonus && s.opponent !== null) bad.push(`${tag} bonus slot has opponent ${s.opponent}`);
      if (s.kind === 'bout') {
        if (!s.opponent || s.opponent === fighter || s.opponent === MINI || s.opponent === BOSS) bad.push(`${tag} bout opponent ${s.opponent}`);
        if (s.opponent === rival && specs.some((x) => x.kind === 'rival')) bad.push(`${tag} rival drawn as a random bout`);
        randoms.push(s.opponent ?? '');
      }
      if (s.kind === 'rival' && s.opponent !== (rival ?? s.opponent)) bad.push(`${tag} rival slot ${s.opponent} != ${rival}`);
      if (s.kind === 'rival' && roster.playable.includes(fighter) && s.opponent !== rival) bad.push(`${tag} rival ${s.opponent} (fighter JSON rival ${rival})`);
      if (s.kind === 'miniboss' && s.opponent !== MINI) bad.push(`${tag} mini boss ${s.opponent}`);
      if (s.kind === 'boss' && s.opponent !== BOSS) bad.push(`${tag} boss ${s.opponent}`);
      if (!bonus) {
        const st = playableStage(data as never, s.stage ?? homeStage(s.opponent));
        if (!builtStages.has(st)) bad.push(`${tag} slot ${i} stage ${st} not built`);
      }
    });
    if (new Set(randoms).size !== randoms.length) bad.push(`${tag} duplicate random opponents ${randoms.join(',')}`);
    if (fighter === 'johnny' && len === 'season' && diff === 0) orders.add(randoms.join(','));
  }
  ok(bad.length === 0, `S2 ${runs} ladders (12 fighters x SEASON/PILOT x difficulty -2/0/+2 x 6 seeds) resolve: kinds, episodes, levels, opponents, rival, bosses, built stages, deterministic${bad.length ? ' - ' + bad.slice(0, 6).join('; ') + (bad.length > 6 ? ` (+${bad.length - 6})` : '') : ''}`);
  ok(orders.size >= 4, `S2 run seeds reshuffle the random opponents (johnny SEASON Normal: ${orders.size} distinct orders over 6 seeds)`);
  const mirror = ALL.filter((id) => !roster.playable.includes(id));
  say(`ladders: ${runs} resolved; note - a boss played by the player meets its own mirror in its slot (${mirror.map((id) => `${id} vs ${id}`).join(', ')}: flow.ts buildSeason, game.ts colours the mirror)`);
}

// ------------------------------------------------------------------ helpers: a bout / bonus round as game.ts stages it
interface BoutOut { winner: number; frames: number; ev: SimEvent[]; m: Match }
function runMatch(cfg: MatchCfg, w0: (m: Match, f: number) => number, w1: (m: Match) => number, maxF = 40000, keepEv = false): BoutOut {
  const m = createMatch(cfg, data);
  const ev: SimEvent[] = [];
  let seq = m.events.count;
  for (let f = 0; f < maxF; f++) {
    step(m, w0(m, f), w1(m));
    if (keepEv && m.events.count !== seq) {
      const tmp: SimEvent[] = [];
      eventsSince(m.events, 0, tmp);
      ev.push(...tmp.slice(Math.max(0, tmp.length - (m.events.count - seq))));
      seq = m.events.count;
    }
    if (m.s[2] === PH.MATCH_END) break;
  }
  const ms = readMatch(m);
  return { winner: ms.winner, frames: ms.frame, ev, m };
}
/** the scripted bonus-round player: jabs toward the nearest goon (brawl), parries objects that come close (heckler) */
function bonusPlayer(): (m: Match, f: number) => number {
  let t = 0;
  return (m: Match, f: number): number => {
    const snap = readMatch(m);
    const me = readFighter(m, 0);
    t++;
    if (snap.brawl?.mode === 'heckler') {
      // hold PARRY while an object is about to arrive (a held parry is live; tapping it spends the recovery)
      const near = (snap.proj ?? []).some((p) => p.kind === 2 && Math.abs(p.x - me.x) < 1.3);
      return near ? 1024 : 0;
    }
    const goons = snap.brawl?.goons ?? [];
    let best: { x: number } | null = null;
    for (const g of goons) if (!g.down && (!best || Math.abs(g.x - me.x) < Math.abs(best.x - me.x))) best = g;
    if (!best) return 0;
    const dx = best.x - me.x;
    const toward = dx > 0 ? 8 : 4;
    if (Math.abs(dx) > 0.9) return toward;
    return f % 6 === 0 ? 16 : f % 6 === 3 ? 32 : 0; // L, then M
  };
}

// ------------------------------------------------------------------ S3 bonus rounds for all 12 fighters
{
  const res: string[] = [];
  let bad = 0;
  for (const mode of ['brawl', 'heckler'] as const) for (const id of ALL) {
    const cfg: MatchCfg = { mode, stage: playableStage(data as never, homeStage(id)), seed: 4242, p: [{ fighter: id, color: 0, scheme: 0, cpu: -1 }, { fighter: id, color: 1, scheme: 0, cpu: 0 }] };
    const cpu = createCpu(0, id, 7);
    let cpuWords = 0;
    const r = runMatch(cfg, bonusPlayer(), (m) => { const w = cpu.input(m, 1); cpuWords |= w; return w; }, 6000);
    const snap = readMatch(r.m);
    const score = snap.brawl?.score ?? 0;
    const good = r.winner === 0 && r.m.s[2] === PH.MATCH_END && score > 0 && cpuWords === 0;
    if (!good) bad++;
    res.push(`${mode}:${id}=${score}${good ? '' : '!'}`);
  }
  ok(bad === 0, `S3 BRAWL BREAK + HECKLER TOSS x ${ALL.length} fighters staged as game.ts does: MATCH_END, winner 0, scripted player scores > 0, CPU word 0 (${bad} bad)`);
  say(`bonus rounds (score): ${res.join(' ')}`);
}

// ------------------------------------------------------------------ S4 boss phases (ricky, the boss slot)
{
  let phaseRuns = 0;
  let persisted = 0;
  let p2moves = 0;
  let kit2 = 0;
  let n = 0;
  const notes: string[] = [];
  for (let sd = 1; sd <= 4; sd++) {
    const hero = ['johnny', 'patch', 'lotus', 'boneyard'][sd - 1];
    const cfg: MatchCfg = { mode: 'arcade', stage: playableStage(data as never, homeStage(BOSS)), seed: 900 + sd, p: [{ fighter: hero, color: 0, scheme: 0, cpu: -1 }, { fighter: BOSS, color: 0, scheme: 0, cpu: 6 }] };
    const player = createCpu(8, hero, sd * 3);
    const boss = createCpu(6, BOSS, sd * 5);
    let phaseAt = -1;
    let roundAtPhase = -1;
    let laterRound = false;
    let moves2 = 0;
    let kit2seen = false;
    let lastInst = -1;
    const m = createMatch(cfg, data);
    let seq = m.events.count;
    const bb = fighterBase(1);
    for (let f = 0; f < 40000; f++) {
      step(m, player.input(m, 0), boss.input(m, 1));
      if (m.events.count !== seq) {
        const tmp: SimEvent[] = [];
        eventsSince(m.events, 0, tmp);
        for (const e of tmp.slice(Math.max(0, tmp.length - (m.events.count - seq)))) if (e.type === EVX.PHASE && e.a === 1 && phaseAt < 0) {
          phaseAt = m.s[1];
          roundAtPhase = readMatch(m).round;
        }
        seq = m.events.count;
      }
      if (phaseAt >= 0) {
        const snapR = readMatch(m).round;
        if (snapR > roundAtPhase && m.s[2] === PH.FIGHT && readFighter(m, 1).unique[0] === 2) laterRound = true;
        if (boss.brain.bound && boss.brain.kit.phase === 2) kit2seen = true;
        const inst = m.s[bb + F.mvInst];
        const mv = m.s[bb + F.mv];
        if (inst !== lastInst && mv >= 0) {
          lastInst = inst;
          if (m.s[bb + F.st] === ST.ATTACK && m.cf[1].moves[mv].phase2) moves2++;
        }
      }
      if (m.s[2] === PH.MATCH_END) break;
    }
    n++;
    const ms = readMatch(m);
    if (phaseAt >= 0) phaseRuns++;
    if (laterRound) persisted++;
    if (moves2 > 0) p2moves++;
    if (kit2seen) kit2++;
    notes.push(`${hero}: phase2 f${phaseAt} (round ${roundAtPhase}), later round u0=2 ${laterRound}, phase-2 moves ${moves2}, rounds ${ms.wins.join('-')}`);
  }
  ok(phaseRuns === n, `S4 RICKY boss bouts reach phase 2 (PHASE event) ${phaseRuns}/${n}`);
  ok(kit2 === phaseRuns && p2moves >= Math.max(1, phaseRuns - 1), `S4 after the phase change his CPU plays the phase-2 recipe table (${kit2}/${phaseRuns}) and starts phase-2 moves (${p2moves}/${phaseRuns} bouts)`);
  const multi = notes.filter((s) => !/rounds 2-0|rounds 0-2/.test(s) || /later round u0=2 true/.test(s)).length;
  ok(persisted >= 1, `S4 phase 2 persists into a later round of the bout (unique u0 = 2 after the next ROUND_INTRO): ${persisted}/${n} bouts (${multi} went past the phase round)`);
  if (VERBOSE) for (const s of notes) console.log(`    ${s}`);
  say(`boss phases: ${notes.join('; ')}`);
}

// ------------------------------------------------------------------ S5 full runs to the ending
{
  const cleared: string[] = [];
  const bad: string[] = [];
  const runFor = (fighter: string, len: SeasonLength, seed: number): void => {
    const run = new SeasonRun({ fighter, color: 0, scheme: 0, length: len, difficulty: 0, seed }, roster, ladder);
    const seeds = new Set<number>();
    let bouts = 0;
    let bonus = 0;
    let guard = 0;
    while (!run.done && guard++ < 80) {
      const slot = run.current()!;
      const isBonus = slot.kind === 'brawl' || slot.kind === 'heckler';
      const opp = slot.opponent ?? fighter;
      const stage = playableStage(data as never, slot.stage ?? homeStage(slot.opponent));
      const sd = run.slotSeed();
      seeds.add(sd);
      const cfg: MatchCfg = {
        mode: slot.kind === 'brawl' ? 'brawl' : slot.kind === 'heckler' ? 'heckler' : 'arcade', stage, seed: sd,
        p: [{ fighter, color: 0, scheme: 0, cpu: -1 }, { fighter: opp, color: opp === fighter ? 1 : 0, scheme: 0, cpu: isBonus ? 0 : slot.level }],
      };
      let won: boolean;
      if (isBonus) {
        const cpu = createCpu(0, opp, sd);
        const r = runMatch(cfg, bonusPlayer(), (m) => cpu.input(m, 1), 6000);
        won = r.winner === 0;
        bonus++;
        if (!won) bad.push(`${fighter}/${len} ${slot.kind} winner ${r.winner}`);
      } else {
        // the stand-in player: the harness 'optimal' persona (fast honest reactions) - a CPU L8 stand-in loses some
        // matchups for dozens of continues (measured: zambini PILOT 55 continues), which tests nothing about the ladder
        const player = createPersona('optimal', fighter, sd ^ 0x55);
        const cpu = createCpu(slot.level, opp, sd);
        const r = runMatch(cfg, (m) => player.input(m, 0), (m) => cpu.input(m, 1));
        won = r.winner === 0;
        bouts++;
      }
      const out = run.record(won);
      if (out === 'retry') run.continueSlot();
    }
    const ending = (data.fighters[fighter] as unknown as { ending?: string }).ending ?? '';
    const endKey = (ladder.endings as Record<string, string>)[fighter] ?? (ladder.endings as Record<string, string>).default;
    const good = run.cleared && ending.length > 20 && !!endKey && endKey in strings && seeds.size === bouts + bonus;
    if (!good) bad.push(`${fighter}/${len}: cleared ${run.cleared}, ending ${ending.length} chars, key ${endKey}, seeds ${seeds.size}/${bouts + bonus}`);
    cleared.push(`${fighter}/${len}: ${bouts} bouts (+${run.continues} continues) ${bonus} bonus${good ? '' : ' !'}`);
  };
  for (const id of ALL) runFor(id, 'pilot', 31337 + id.length);
  for (const id of ['johnny', 'lotus', 'gazza']) runFor(id, 'season', 777 + id.length);
  ok(bad.length === 0, `S5 ${cleared.length} full ladders (PILOT x ${ALL.length} fighters + SEASON x 3) cleared slot by slot as game.ts runs them, continues on losses, a fresh sim seed per slot / continue, each fighter's ending text + ending key present${bad.length ? ' - ' + bad.join('; ') : ''}`);
  say(`full runs: ${cleared.join('; ')}`);
}

const pass = fails.length === 0;
console.log(`${pass ? 'PASS' : 'FAIL'} probe_season: ${checks - fails.length}/${checks} checks (G11 node: ladder data, ${ALL.length} fighters x SEASON/PILOT resolution, bonus rounds, boss phases, full runs to the ending)`);
process.exit(pass ? 0 : 1);

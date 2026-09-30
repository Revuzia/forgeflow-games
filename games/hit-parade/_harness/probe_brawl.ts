// probe_brawl (G2, lane SIM, CHANGED(SIM) P2 - CONTRACT §4.3.14, §28.4): BRAWL BREAK and HECKLER TOSS in the real sim.
//   BRAWL: bonus state + absent fighter 1, waves from both sides, <= maxActive alive, attack tokens (<= tokens holders,
//   grants >= tokenSpacingF apart), every goon attack telegraphed >= telegraphMinF, player hits / KOs / crowd hits / combo
//   cash-out score x the RATINGS multiplier, block / parry / perfect parry vs goons (no world freeze), a hit drops 2 grades
//   and never takes the last HP, 45 s -> TIMEOVER -> MATCH_END (winner 0), goon anim table + ids.
//   HECKLER: arcs aimed at the player, <= maxLive in the air, parry = points, perfect x2, block = 0, hit = -hitCost, 40 s.
//   Both: twin runs identical, save / step / load / re-step every frame == straight run, for every fighter as the player.
// Numbers come from data/system.json (brawl / heckler); nothing is restated. Usage: node _harness/probe_brawl.ts [-v]
import { I, dirBits, evs, newMatch, run, sb, tester } from './fixtures/simkit.ts';
import { checksum, load, readFighter, readMatch, save, step } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { loadGameData } from '../runtime/src/core/data.ts';
import { EV, SCORE_WHY } from '../runtime/src/core/sim/events.ts';
import { BR, BRAWL_BASE, F, G, GOON_CAP, GS, P, PH, PROJ_CAP, ST, STATE_INTS_BRAWL, W, goonBase, projBase } from '../runtime/src/core/sim/layout.ts';
import { comboBonus } from '../runtime/src/core/sim/brawl.ts';
import { compileBrawl } from '../runtime/src/core/sim/compile.ts';
import type { SimEvent } from '../runtime/src/core/types.ts';

const t = tester('probe_brawl');
const data = loadGameData();
const BRS = data.system.brawl!;
const HK = data.system.heckler!;
const cb = compileBrawl(data);
const U = 100000;
const H = (k: number): number => BRAWL_BASE + k;

function mk(mode: 'brawl' | 'heckler', p1 = 'johnny', seed = 1): Match {
  return newMatch({ p1, p2: 'johnny', data, mode, s1: 0, s2: 0, seed });
}
const gb = (k: number): number => goonBase(k);
function aliveGoons(m: Match): number[] {
  const out: number[] = [];
  for (let k = 0; k < GOON_CAP; k++) if (m.s[gb(k) + G.act] !== 0 && m.s[gb(k) + G.st] !== GS.DOWN) out.push(k);
  return out;
}
function until(m: Match, pred: () => boolean, max: number, in1 = 0): number {
  for (let k = 0; k < max; k++) {
    if (pred()) return k;
    step(m, in1, 0);
  }
  return pred() ? max : -1;
}
/** A plausible player: jabs, mediums, specials by a fixed pattern, turns to the nearest goon (the sim does). */
function botWord(f: number): number {
  if (f % 90 < 30 && f % 6 === 0) return I.L;
  if (f % 90 === 40) return I.M;
  if (f % 90 === 55) return I.S;
  if (f % 180 === 70) return I.H;
  return 0;
}

// ================================================================= BRAWL BREAK: setup
{
  const m = mk('brawl');
  t.eq(m.s.length, STATE_INTS_BRAWL, `brawl state = STATE_INTS_BRAWL (${STATE_INTS_BRAWL} ints)`);
  const f1 = readFighter(m, 1);
  t.ok(f1.absent === true && f1.state === ST.ABSENT, 'fighter 1 is absent (FighterSnap.absent, state ABSENT)');
  const b = readMatch(m).brawl;
  t.ok(!!b && b.mode === 'brawl' && b.timeLeft === BRS.seconds && b.goons.length === 0, `MatchSnap.brawl: mode brawl, ${BRS.seconds} s, no goons yet`, JSON.stringify(b && { mode: b.mode, t: b.timeLeft }));
  t.eq(b!.ratings, BRS.ratings.start, `RATINGS start at ${BRS.ratings.start}`);
  for (const k of BRS.kinds) {
    const tab = data.goonAnims[k.id];
    t.ok(!!tab && tab.length === 34 + BRS.moves.length && tab[34].clip === BRS.moves[0].anim?.clip, `goon anim table for ${k.id}: 34 shared + ${BRS.moves.length} moves (${tab?.[34]?.clip})`);
  }
  for (const mv of BRS.moves) t.ok(mv.startup >= BRS.telegraphMinF, `goon ${mv.id}: startup ${mv.startup} >= telegraph floor ${BRS.telegraphMinF}`);
}

// ================================================================= BRAWL BREAK: a whole round with a scripted player
{
  const m = mk('brawl');
  const events: SimEvent[] = [];
  let maxAlive = 0;
  let maxTokens = 0;
  let maxTele = 0;
  let sawLeft = false;
  let sawRight = false;
  let minHp = 1e9;
  let minGrant = 1e9;
  let lastGrantF = -1e9;
  let attacks = 0;
  let shortTele = 0;
  const atkStart = new Int32Array(GOON_CAP).fill(-1);
  const hadToken = new Int32Array(GOON_CAP);
  let freezes = 0;
  let prevFrame = m.frame();
  for (let f = 0; f < 60 * (BRS.seconds + 5) && m.s[W.phase] !== PH.MATCH_END; f++) {
    step(m, botWord(f), 0);
    const fr = m.frame();
    const alive = aliveGoons(m);
    maxAlive = Math.max(maxAlive, alive.length);
    let tok = 0;
    let tele = 0;
    const px = m.s[sb(0) + F.x];
    for (let k = 0; k < GOON_CAP; k++) {
      const g = gb(k);
      if (m.s[g + G.act] === 0) {
        atkStart[k] = -1;
        continue;
      }
      if (m.s[g + G.token] !== 0) {
        tok++;
        if (hadToken[k] === 0) {
          minGrant = Math.min(minGrant, fr - lastGrantF);
          lastGrantF = fr;
        }
      }
      hadToken[k] = m.s[g + G.token] !== 0 ? 1 : 0;
      if (m.s[g + G.st] === GS.ATTACK) {
        const mv = cb.moves[m.s[g + G.mv]];
        if (m.s[g + G.mvF] < mv.startup) tele++;
        if (m.s[g + G.mvF] === 1) {
          atkStart[k] = fr;
          attacks++;
        }
        if (m.s[g + G.mvF] === mv.startup && atkStart[k] >= 0 && fr - atkStart[k] + 1 < BRS.telegraphMinF) shortTele++;
      }
      if (m.s[g + G.st] !== GS.DOWN) {
        if (m.s[g + G.x] < px) sawLeft = true;
        else sawRight = true;
      }
    }
    maxTokens = Math.max(maxTokens, tok);
    maxTele = Math.max(maxTele, tele);
    minHp = Math.min(minHp, m.s[sb(0) + F.hp]);
    if (m.s[W.freeze] > 0 && m.s[W.freezeKind] === 2) freezes++;
    for (const e of evs(m, prevFrame + 1)) events.push(e);
    prevFrame = fr;
  }
  const b = readMatch(m).brawl!;
  t.ok(m.s[W.phase] === PH.MATCH_END && readMatch(m).winner === 0, 'the brawl ends on the timer: MATCH_END, winner 0');
  const to = events.find((e) => e.type === EV.TIMEOVER);
  t.ok(!!to && to.a === 0, 'TIMEOVER a = 0 (the bonus round is always cleared)');
  t.ok(maxAlive <= BRS.maxActive && maxAlive >= 2, `alive goons never exceed maxActive ${BRS.maxActive} (max seen ${maxAlive})`);
  t.ok(sawLeft && sawRight, 'goons come from both sides of the line');
  t.ok(maxTokens <= BRS.tokens, `attack tokens held <= ${BRS.tokens} every frame (max ${maxTokens})`);
  t.ok(maxTele <= BRS.tokens, `goons telegraphing an attack at once <= ${BRS.tokens} (max ${maxTele})`);
  t.ok(minGrant >= BRS.tokenSpacingF, `token grants >= ${BRS.tokenSpacingF} f apart (min ${minGrant})`);
  t.ok(attacks >= 5 && shortTele === 0, `every goon attack telegraphs >= ${BRS.telegraphMinF} f (${attacks} attacks, ${shortTele} short)`);
  t.ok(minHp >= 1, `the player's HP never drops below 1 (min ${minHp})`);
  t.eq(freezes, 0, 'no world freeze from parries in the bonus round');
  const spawns = events.filter((e) => e.type === EV.GOON_SPAWN);
  t.ok(spawns.length >= BRS.waves[0].length && spawns.every((e) => e.a >= 8 && e.a < 8 + GOON_CAP && (e.c === -1 || e.c === 1)), `GOON_SPAWN payload a 8+slot, c side (${spawns.length} spawns)`);
  const scoreSum = events.filter((e) => e.type === EV.SCORE).reduce((a, e) => a + e.b, 0);
  const lastScore = events.filter((e) => e.type === EV.SCORE).pop();
  t.ok(scoreSum === b.score && (!lastScore || lastScore.c === b.score), `SCORE deltas sum to the final score ${b.score} and c = the running total`);
  t.ok(b.downed >= 1 && events.filter((e) => e.type === EV.GOON_DOWN).length === b.downed, `GOON_DOWN per KO (${b.downed})`);
  t.ok(events.some((e) => e.type === EV.HIT && e.a === 0 && e.b >= 8) && events.some((e) => e.type === EV.HIT && e.a >= 8 && e.b === 0), 'HIT events both ways carry 8+slot for goons');
  t.note(`brawl run: score ${b.score}, ratings ${b.ratings}, downed ${b.downed}, spawned ${b.spawned}, hitsTaken ${b.hitsTaken}, attacks ${attacks}`);
}

// ================================================================= BRAWL BREAK: targeted scoring checks (test setup places goons)
function placeGoon(m: Match, k: number, kind: number, xM: number, st: number = GS.WAIT): void {
  const g = gb(k);
  for (let j = 0; j < 32 && j < G.reserved + 1; j++) m.s[g + j] = 0;
  m.s[g + G.act] = 1;
  m.s[g + G.kind] = kind;
  m.s[g + G.x] = Math.round(xM * U);
  m.s[g + G.facing] = xM < m.s[sb(0) + F.x] / U ? 1 : -1;
  m.s[g + G.hp] = cb.kindHp[kind];
  m.s[g + G.mv] = -1;
  m.s[g + G.hitInst] = -1;
  m.s[g + G.think] = 999;
  m.s[g + G.st] = st;
}
function stopWaves(m: Match): void {
  m.s[H(BR.waveLeft)] = 0;
  m.s[H(BR.waveTimer)] = -100000;
}
{
  // a player hit: damage, HIT to 8+slot, points x multiplier
  const m = mk('brawl');
  stopWaves(m);
  m.s[sb(0) + F.x] = 0;
  placeGoon(m, 0, 0, 0.75);
  m.s[H(BR.lastGrant)] = -100000; // no tokens: the goon stays passive
  const hp0 = m.s[gb(0) + G.hp];
  const mult = BRS.ratings.mult[Math.trunc(m.s[H(BR.ratings)] / 10000)];
  const e0 = m.frame();
  step(m, I.L, 0);
  until(m, () => m.s[gb(0) + G.hp] < hp0, 12);
  const dmg = hp0 - m.s[gb(0) + G.hp];
  const want = (data.fighters.johnny.moves['5L'].damage ?? 0);
  t.eq(dmg, want, `johnny 5L deals its move damage to a goon (${want})`);
  const hit = evs(m, e0).find((e) => e.type === EV.HIT && e.a === 0);
  t.ok(!!hit && hit.b === 8, 'HIT a 0, b 8 + slot', JSON.stringify(hit));
  const sc = evs(m, e0).find((e) => e.type === EV.SCORE && e.d === SCORE_WHY.HIT);
  t.eq(sc ? sc.b : -1, Math.trunc((BRS.score.hit[0] * mult) / 100), `a light hit scores ${BRS.score.hit[0]} x mult ${mult}%`);
  // crowd hit: two goons inside one 5H
  const m2 = mk('brawl');
  stopWaves(m2);
  m2.s[H(BR.lastGrant)] = -100000;
  m2.s[sb(0) + F.x] = 0;
  placeGoon(m2, 0, 0, 0.8);
  placeGoon(m2, 1, 2, 1.25);
  const e2 = m2.frame();
  step(m2, I.H, 0);
  run(m2, 16, 0, 0);
  const hits = evs(m2, e2).filter((e) => e.type === EV.HIT && e.a === 0 && e.b >= 8);
  const crowd = evs(m2, e2).find((e) => e.type === EV.SCORE && e.d === SCORE_WHY.CROWD);
  t.ok(hits.length === 2 && !!crowd, `one strike hits two goons = a crowd hit (+${BRS.score.crowd} x mult)`, `hits ${hits.length}, crowd ${JSON.stringify(crowd)}`);
  // KO: GOON_DOWN + KO points; combo cash-out after comboCashF
  const m3 = mk('brawl');
  stopWaves(m3);
  m3.s[H(BR.lastGrant)] = -100000;
  m3.s[sb(0) + F.x] = 0;
  placeGoon(m3, 0, 2, 0.75);
  m3.s[gb(0) + G.hp] = 1;
  const e3 = m3.frame();
  step(m3, I.L, 0);
  run(m3, 10, 0, 0);
  const down = evs(m3, e3).find((e) => e.type === EV.GOON_DOWN);
  t.ok(!!down && down.a === 8 && readMatch(m3).brawl!.downed === 1 && evs(m3, e3).some((e) => e.type === EV.SCORE && e.d === SCORE_WHY.KO), 'a KO: GOON_DOWN (a 8 + slot) + KO points, downed 1');
  t.ok(readMatch(m3).brawl!.goons.some((g) => g.down), 'the KO\'d goon shows down: true while it fades');
  const kk = until(m3, () => m3.s[gb(0) + G.act] === 0, BRS.downF + 60);
  t.ok(kk >= 0, `the defeated goon's slot frees after downF ${BRS.downF}`);
  // combo cash-out
  const m4 = mk('brawl');
  stopWaves(m4);
  m4.s[H(BR.lastGrant)] = -100000;
  m4.s[sb(0) + F.x] = 0;
  placeGoon(m4, 0, 1, 0.75);
  m4.s[gb(0) + G.hp] = 99999;
  const e4 = m4.frame();
  for (let k = 0; k < 3; k++) {
    step(m4, I.L, 0);
    run(m4, 12, 0, 0);
  }
  const hitsN = readMatch(m4).brawl!.combo;
  const cashK = until(m4, () => evs(m4, e4).some((e) => e.type === EV.SCORE && e.d === SCORE_WHY.COMBO), BRS.score.comboCashF + 5);
  const cash = evs(m4, e4).find((e) => e.type === EV.SCORE && e.d === SCORE_WHY.COMBO);
  const multNow = readMatch(m4).brawl!.mult;
  t.ok(hitsN >= 2 && cashK >= 0 && !!cash && cash.b === Math.trunc((comboBonus(hitsN) * multNow) / 100), `combo cash-out ${BRS.score.comboCashF} f after the last hit: round(5 x ${hitsN}^1.5) x mult = ${cash?.b}`);
  t.eq(comboBonus(4), 40, 'comboBonus(4) = round(5 x 8) = 40');
  t.eq(comboBonus(10), 158, 'comboBonus(10) = round(5 x 31.62) = 158');
}
{
  // goons vs the player: block, parry (points), perfect parry (points x2, no freeze), hit = -2 grades
  const setup = (): Match => {
    const m = mk('brawl');
    stopWaves(m);
    m.s[sb(0) + F.x] = 0;
    m.s[sb(0) + F.facing] = 1;
    placeGoon(m, 0, 0, 0.9);
    m.s[H(BR.ratings)] = 45000; // grade 4
    // make the goon throw its jab now
    const g = gb(0);
    m.s[g + G.mv] = 0;
    m.s[g + G.mvF] = 1;
    m.s[g + G.st] = GS.ATTACK;
    m.s[g + G.facing] = -1;
    return m;
  };
  const jab = cb.moves[0];
  // block
  {
    const m = setup();
    const e0 = m.frame();
    run(m, jab.startup + 2, dirBits(m, 0, 4), 0);
    t.ok(evs(m, e0).some((e) => e.type === EV.BLOCK && e.a === 8 && e.b === 0) && m.s[H(BR.hitsTaken)] === 0, 'holding back blocks a goon jab (BLOCK a 8, b 0)');
  }
  // perfect parry: press PARRY so contact lands on parry frame <= perfectFrames
  {
    const m = setup();
    const e0 = m.frame();
    run(m, jab.startup - 2, 0, 0);
    run(m, 4, I.PARRY, 0);
    const pp = evs(m, e0).find((e) => e.type === EV.PERFECT_PARRY);
    const sc = evs(m, e0).find((e) => e.type === EV.SCORE && e.d === SCORE_WHY.PERFECT);
    t.ok(!!pp && pp.a === 8 && !!sc && sc.b === Math.trunc((BRS.score.perfect * BRS.ratings.mult[4]) / 100), `perfect parry vs a goon: PERFECT_PARRY + ${BRS.score.perfect} x mult (${sc?.b})`);
    t.eq(m.s[W.freeze], 0, 'no world freeze on a bonus-round perfect parry');
  }
  // normal parry
  {
    const m = setup();
    const e0 = m.frame();
    run(m, jab.startup - 8, 0, 0);
    run(m, 12, I.PARRY, 0);
    const pa = evs(m, e0).find((e) => e.type === EV.PARRY);
    t.ok(!!pa && evs(m, e0).some((e) => e.type === EV.SCORE && e.d === SCORE_WHY.PARRY), `parry vs a goon: PARRY + ${BRS.score.parry} x mult`);
  }
  // hit: -2 grades to the band floor
  {
    const m = setup();
    const e0 = m.frame();
    run(m, jab.startup + 2, 0, 0);
    t.ok(evs(m, e0).some((e) => e.type === EV.HIT && e.a === 8 && e.b === 0), 'an unguarded player is hit (HIT a 8, b 0)');
    t.eq(readMatch(m).brawl!.grade, 2, 'getting hit drops RATINGS 2 grades (4 -> 2)');
    t.eq(m.s[H(BR.ratings)], 20000, 'to that band\'s floor');
  }
}

// ================================================================= HECKLER TOSS
function hecklerFirstContact(m: Match): { frames: number; dir: number } {
  // look ahead on a copy of the state: frames until an object touches the idle player (HIT from the crowd)
  const slot = new Int32Array(m.s.length);
  save(m, slot);
  const f0 = m.frame();
  let n = -1;
  let dir = 0;
  for (let k = 1; k < 400; k++) {
    // the travel direction of the object closest to the player (the one about to touch)
    let best = 1 << 30;
    for (let p = 0; p < PROJ_CAP; p++) {
      if (m.s[projBase(p) + P.act] === 0 || m.s[projBase(p) + P.kind] !== 2) continue;
      const d = Math.abs(m.s[projBase(p) + P.x] - m.s[sb(0) + F.x]);
      if (d < best) {
        best = d;
        dir = m.s[projBase(p) + P.vx] >= 0 ? 1 : -1;
      }
    }
    step(m, 0, 0);
    if (evs(m, f0 + 1).some((e) => e.type === EV.HIT && e.a === 2)) {
      n = k;
      break;
    }
  }
  load(m, slot);
  return { frames: n, dir };
}
{
  const m = mk('heckler');
  const b0 = readMatch(m).brawl!;
  t.ok(b0.mode === 'heckler' && b0.timeLeft === HK.seconds, `heckler: ${HK.seconds} s`);
  // an idle player gets hit by an arc aimed at him
  until(m, () => m.s[W.phase] === PH.FIGHT, 200);
  const e0 = m.frame();
  const k = until(m, () => evs(m, e0).some((e) => e.type === EV.HIT && e.a === 2), 400);
  t.ok(k >= 0, 'an object thrown from the crowd reaches an idle player (arc aimed at him)');
  const thr = evs(m, e0).find((e) => e.type === EV.HECKLE_THROW);
  t.ok(!!thr && thr.b >= 0 && thr.b < HK.objects.length, `HECKLE_THROW b = object type (${thr ? HK.objects[thr.b].id : '?'})`);
  const hitSc = evs(m, e0).find((e) => e.type === EV.SCORE && e.d === SCORE_WHY.HECKLE_HIT);
  t.ok(!!hitSc && hitSc.b <= 0, `a heckle hit costs points (SCORE reason 9, b ${hitSc?.b} <= 0; floor 0)`);
  // perfect parry = x2, parry, block
  const pm = mk('heckler', 'johnny', 3);
  until(pm, () => pm.s[W.phase] === PH.FIGHT, 200);
  let perfects = 0;
  let parries = 0;
  let blocks = 0;
  let pts = 0;
  for (let round = 0; round < 6; round++) {
    const c = hecklerFirstContact(pm);
    if (c.frames < 0) break;
    const kind = round % 3; // 0 perfect, 1 parry, 2 block
    const e1 = pm.frame();
    if (kind === 0) {
      run(pm, c.frames - 2, 0, 0);
      run(pm, 4, I.PARRY, 0);
    } else if (kind === 1) {
      run(pm, Math.max(0, c.frames - 8), 0, 0);
      run(pm, 10, I.PARRY, 0);
    } else {
      const away = c.dir > 0 ? I.R_ : I.L_;
      run(pm, Math.max(0, c.frames - 3), 0, 0);
      run(pm, 6, away, 0); // guard only at the end (walking back earlier would step out of the arc)
    }
    const ev1 = evs(pm, e1);
    if (ev1.some((e) => e.type === EV.PERFECT_PARRY && e.a === 2)) {
      perfects++;
      pts += ev1.filter((e) => e.type === EV.SCORE && e.d === SCORE_WHY.HECKLE_PERFECT).reduce((a, e) => a + e.b, 0);
    }
    if (ev1.some((e) => e.type === EV.PARRY && e.a === 2)) parries++;
    if (ev1.some((e) => e.type === EV.BLOCK && e.a === 2)) blocks++;
    run(pm, 40, 0, 0); // let the arms recover (parry recovery) before the next object
  }
  t.ok(perfects >= 1, `perfect-parried objects: ${perfects} (x2 points: ${pts})`);
  t.ok(parries >= 1, `parried objects: ${parries}`);
  t.ok(blocks >= 1, `blocked objects (no score, no penalty): ${blocks}`);
  // whole round: maxLive, timer, MATCH_END
  const wm = mk('heckler', 'patch', 5);
  let maxLive = 0;
  for (let f = 0; f < 60 * (HK.seconds + 5) && wm.s[W.phase] !== PH.MATCH_END; f++) {
    step(wm, 0, 0);
    let live = 0;
    for (let p = 0; p < PROJ_CAP; p++) if (wm.s[projBase(p) + P.act] !== 0 && wm.s[projBase(p) + P.kind] === 2) live++;
    maxLive = Math.max(maxLive, live);
    const proj = readMatch(wm).proj ?? [];
    for (const q of proj) if (q.kind === 2 && (q.owner !== 2 || q.obj === undefined)) maxLive = 99;
  }
  t.ok(maxLive >= 1 && maxLive <= HK.maxLive, `objects in the air <= maxLive ${HK.maxLive} (max ${maxLive}); MatchSnap.proj kind 2 owner 2 with obj`);
  t.ok(wm.s[W.phase] === PH.MATCH_END && readMatch(wm).winner === 0, 'heckler ends on the timer: MATCH_END, winner 0');
  t.note(`heckler: ${wm.s[H(BR.heckles)]} throws, score ${readMatch(wm).brawl!.score}, hits taken ${readMatch(wm).brawl!.hitsTaken}`);
}

// ================================================================= determinism (every fighter as the player, both modes)
{
  let twin = 0;
  let saveLoad = 0;
  let runs = 0;
  for (const id of Object.keys(data.fighters).sort()) {
    for (const mode of ['brawl', 'heckler'] as const) {
      const a = mk(mode, id, 7);
      const b = mk(mode, id, 7);
      const d = mk(mode, id, 7);
      const slot = new Int32Array(d.s.length);
      const N = mode === 'brawl' ? 1500 : 900;
      for (let f = 0; f < N; f++) {
        const w = botWord(f) | (f % 240 < 60 ? dirBits(a, 0, 6) : 0);
        step(a, w, 0);
        step(b, w, 0);
        if (checksum(a) !== checksum(b)) twin++;
        save(d, slot);
        step(d, w, 0);
        const c1 = checksum(d);
        load(d, slot);
        step(d, w, 0);
        if (checksum(d) !== c1 || c1 !== checksum(a)) saveLoad++;
      }
      runs++;
    }
  }
  t.eq(twin, 0, `twin bonus runs identical checksums (${runs} runs: 12 fighters x brawl + heckler)`);
  t.eq(saveLoad, 0, 'save / step / load / re-step every frame == straight run');
}

t.done();

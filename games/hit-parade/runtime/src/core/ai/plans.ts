// HIT PARADE - per-fighter game plans for the CPU's neutral (lane AI, CONTRACT §11 "per-fighter game
// plans ... from fighters/<id>.json cpu.style"). THREE-free. Called by the brain every `thinkF` frames
// while it is free and nothing reactive (punish, block, anti-air) is happening.
//
// One planner, parameterised by the style table in data/cpu.json `styles` and the fighter's own `cpu`
// lists (resolved to measured recipes in kit.ts): shoto (fireball + anti-air + footsies), rushdown (walk /
// dash in, pokes, throws, approach specials), grappler (walk in guarded, command grab in range), zoner
// (keep away, projectile cadence, escape), charge (sit in down-back, charge specials), stance, bigbody
// (armored moves as reads), aerial (jumps + air specials), setplay (setups at mid range), counter (waits,
// counter stance as a reaction tool - see brain.decideStrike). The aggression lever decides attack vs wait.
//
// CHANGED(AI3D) (CONTRACT §35.9 / §35.17): the ring (ringPlan below) - circle-walk off my wall, a READ sidestep vs a
// linear-happy opponent (patch / spin ride a step-attack on it), homing / antiStep pokes vs a stepper, circle the
// opponent onto its wall. Every distance / wall rule above reads the fight-line projection (sense.ts), so the plans
// keep working anywhere in the ring.

import { ST } from '../sim/layout.ts';
import type { Brain, Decision } from './brain.ts';
import { B } from './pad.ts';
import { planCircle, stepOrder } from './ring3d.ts';

const M = 100000;

function pick<T>(b: Brain, xs: readonly T[]): T | undefined {
  if (xs.length === 0) return undefined;
  return xs[Math.floor(b.rnd() * xs.length)];
}

/** weighted choice among [weight, fn] options (weights <= 0 skipped); an unavailable pick is re-rolled among the rest */
function choose(b: Brain, opts: [number, () => Decision | null][]): Decision | null {
  const live = opts.filter(([w]) => w > 0);
  while (live.length > 0) {
    let tot = 0;
    for (const [w] of live) tot += w;
    let r = b.rnd() * tot;
    let k = 0;
    for (; k < live.length - 1; k++) {
      r -= live[k][0];
      if (r <= 0) break;
    }
    const d = live[k][1]();
    if (d) return d;
    live.splice(k, 1);
  }
  return null;
}

function usableIn(b: Brain, list: readonly number[], needReach: boolean): number[] {
  return list.filter((k) => !b.kit.moves[k].inert && b.canUse(k) && (!needReach || b.inReach(k)));
}

/**
 * CHANGED(AI) P2 (task: honest low-level defense): the chance to hold a guard posture in the opponent's range this
 * decision. No level can react to a 4-12 f ground attack (reactF 18-60 f), so blocking one is a GUESS - and a player
 * guesses from habits: the opponent's observed attack rate when it stands in its range (habits.ts, committed after the
 * reaction delay). `base` = the level's flat guard lever; the level's `habit` weight blends in block x attack rate.
 */
export function guardChance(b: Brain, base: number): number {
  const P = b.profile;
  const pA = b.habits.attackRate;
  const g = (1 - P.habit) * base + P.habit * Math.min(1, P.block * 2) * pA;
  return Math.max(0, Math.min(0.95, g));
}

/** CHANGED(AI3D): is the opponent free to act this frame (it may start an attack on any frame) */
function opFreeNow(st: number): boolean {
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B || st === ST.SIDESTEP || st === ST.SIDEWALK || st === ST.STEP_END;
}

/**
 * CHANGED(AI3D) (§35.9): the ring options of a neutral decision, or null. All honest: geometry I can see (ring3d.ts),
 * habits committed after my reaction delay (habits.ts), the opponent's visible state.
 */
export function ringPlan(b: Brain, aggro: boolean, opThreat: number): Decision | null {
  const s = b.seen;
  const P = b.profile;
  const op = s.op;
  const kit = b.kit;
  const d = s.dist;
  const h = b.habits;
  const opFree = opFreeNow(op.st);
  if (op.st === ST.KNOCKDOWN || op.air || s.me.air) return null;
  // (1) my back on the ring wall (along the fight line): circle-walk until there is room behind me again - not into a
  // running attack, and inside its range less often the more it attacks there (its habit: a circle-walk is no guard)
  const opSwinging = op.st === ST.ATTACK && op.cm !== null && op.mvF <= op.cm.lastActive;
  const inRange = d <= opThreat + 20000;
  if (P.circle > 0 && s.backU < 130000 && !opSwinging && b.rnd() < P.circle * (inRange ? 1 - h.attackRate : 1)) {
    const pl = planCircle(b.m, s, 'escape', 180000, 80);
    if (pl) {
      b.stats.circlesEscape++;
      return { t: 'circle', bit: pl.bit, frames: pl.frames <= b.m.sys.stepFrames ? 1 : pl.frames, atk: -1 };
    }
  }
  // (2) it steps a lot near me (visible starts, habits.stepRate): a homing / cpu.antiStep move where one reaches
  if (P.antiStep > 0 && opFree && h.stepRate > 0.15 && b.rnd() < P.antiStep * Math.min(1, h.stepRate * 2.5) * (aggro ? 1 : 0.5)) {
    const k = b.antiStepPick();
    if (k >= 0) {
      b.stats.antiSteps++;
      return { t: 'move', idx: k };
    }
  }
  // (3) a READ sidestep inside its range vs its linear habit (a step a few frames before a linear move's active frames
  // evades it, STEPTUNE §35.15; vs a homing-happy opponent less often); patch / spin ride their step-attack on it
  if (P.stepGuess > 0 && opFree && d <= opThreat + 40000 && d > kit.cf.pushFS + op.cf.pushFS + 15000) {
    const p = P.stepGuess * (0.4 + 3 * P.habit * h.linearRate) * (1 - h.homingRate);
    if (b.rnd() < p) {
      b.stats.stepGuesses++;
      const [bit] = stepOrder(b.m, s);
      return { t: 'circle', bit, frames: 1, atk: aggro && kit.stepAttack >= 0 ? kit.stepAttack : -1 };
    }
  }
  // (4) circle the opponent onto ITS wall from mid range (its back then takes the pushback / the wall splat)
  if (P.circle > 0 && aggro && s.opBackU > 220000 && s.backU > 150000 && d > 130000 && d < 320000 && b.rnd() < P.circle * 0.3) {
    const pl = planCircle(b.m, s, 'corner', 110000, 60);
    if (pl) {
      b.stats.circlesCorner++;
      return { t: 'circle', bit: pl.bit, frames: pl.frames <= b.m.sys.stepFrames ? 1 : pl.frames, atk: -1 };
    }
  }
  return null;
}

export function neutralPlan(b: Brain): Decision {
  const s = b.seen;
  const me = s.me;
  const op = s.op;
  const kit = b.kit;
  const st = b.style;
  const P = b.profile;
  const d = s.dist;
  const think = P.thinkF;

  // boss tools first (armor reads, phase 2 pressure)
  if (b.tools) {
    const t = b.tools.neutral(b);
    if (t) return t;
  }

  const aggro = b.rnd() < b.aggression();
  const closeU = kit.cf.pushFS + op.cf.pushFS + kit.cf.throwRange + 8000; // CHANGED(fixer) D2: push-box fronts
  const pokes = usableIn(b, kit.lists.pokes.length > 0 ? kit.lists.pokes : kit.roles.poke ?? [], true);
  const zoning = (kit.lists.zoning.length > 0 ? kit.lists.zoning : kit.projMoves).filter((k) => b.canUse(k));
  const opThreat = b.opReach + (me.cf.hurtStand[0] >> 1) + 25000;
  const cornerBehind = Math.abs(me.x) > s.wall - 100000 && me.x * s.dx < 0;
  const guard = (frames: number): Decision => ({ t: 'guard', crouch: b.chooseGuardCrouch(), frames });

  // CHANGED(AI) P2: the fighter's unique (uniques.ts): counter reads, teleports, stance, armor steps, the ball, installs
  if (b.projEta() > 30) {
    const u = b.uniq.neutral(b, aggro);
    if (u) return u;
  }

  // opponent knocked down: walk up for the wakeup (okizeme) at higher levels, else hang back
  if (op.st === ST.KNOCKDOWN) {
    if (aggro && P.level >= 3 && d > closeU + 20000) return { t: 'hold', d: 6, frames: Math.min(think, 12) };
    if (aggro && P.level >= 4 && op.stun <= 6 && d <= closeU + 30000) {
      const meaty = pokes.find((k) => b.timeToActive(k) >= op.stun);
      if (meaty !== undefined) return { t: 'move', idx: meaty };
    }
    return { t: 'guard', crouch: true, frames: 6 };
  }

  // an opponent projectile the CPU has reacted to is on its way: nothing committal into it (a keep-away
  // style may answer with its own to clash); the latched block / parry / jump happens in brain.projGuard
  const eta = b.projEta();
  const keepAway0 = st.backOff >= 0.3;
  if (eta <= 30) {
    if (st.zone > 0 && zoning.length > 0 && d > 200000 && eta > 16 && b.rnd() < st.zone) {
      const z = pick(b, zoning);
      if (z !== undefined) return { t: 'move', idx: z };
    }
    if (eta <= 12) return { t: 'guard', crouch: true, frames: eta + 4 };
    // a dash fits before it arrives: close in (the anti-zoning lever)
    if (!keepAway0 && d > kit.rangeLo && eta > kit.cf.dashFFrames + 14 && b.rnd() < P.antiZone) {
      return { t: 'steps', steps: [{ d: 6, b: 0 }, { d: 5, b: 0 }, { d: 6, b: 0 }] };
    }
    // between projectiles: walk in (the latched block still comes up at 12 frames out, brain.projGuard)
    if (!keepAway0 && d > kit.rangeLo) return { t: 'hold', d: 6, frames: Math.max(2, eta - 12) };
    return { t: 'guard', crouch: true, frames: Math.min(eta + 4, 34) };
  }

  // the opponent is stuck in a long recovery out of reach (a projectile it threw, a whiffed special): move in
  if (!keepAway0 && op.st === ST.ATTACK && op.cm && !op.air && op.mvF > op.cm.lastActive && op.cm.total - op.mvF >= 14 && d > 150000 && b.rnd() < 0.5 + st.walkIn * 0.5) {
    return { t: 'steps', steps: [{ d: 6, b: 0 }, { d: 5, b: 0 }, { d: 6, b: 0 }] };
  }

  // CHANGED(AI3D): the ring (circle off my wall, anti-step, read steps, circle it onto its wall)
  {
    const r = ringPlan(b, aggro, opThreat);
    if (r) return r;
  }

  // respect a presser (FIGHTING_DESIGN §12 "block+punish beats mash"): the opponent has been pressing buttons
  // (visible move starts, brain.opPressing) and is free to press again, and I am inside the range the buttons
  // it has been pressing cover by the time they are active (its walk-in included, brain.pressZone). Walking,
  // dashing or starting a slower button there loses to the next press; a player who has seen the pattern
  // (the profile's `respect` chance, one roll per decision) swings a longer button where the walk-in will meet
  // it (brain.spacePoke) or holds a guard and lets block -> interrupt / whiff punish (brain.punishTick) do
  // the work. Outside that zone it still pokes / zones / jumps as its style says.
  // frames until the opponent can press again (0 = free now); a travel that arrives after that walks into it
  let opBusy = 99;
  if (op.st === ST.IDLE || op.st === ST.CROUCH || op.st === ST.WALK_F || op.st === ST.WALK_B || op.st === ST.DASH_F || op.st === ST.DASH_B) opBusy = 0;
  else if (op.st === ST.ATTACK && !op.air && op.cm !== null) opBusy = op.mvF <= op.cm.lastActive ? 0 : op.cm.total - op.mvF + 1;
  else if (op.st === ST.LAND || op.st === ST.RECOVER || op.st === ST.PARRY_REC || op.st === ST.BLOCKSTUN || op.st === ST.HITSTUN) opBusy = op.stun;
  const respect = P.respect > 0 && b.opPressing() && b.rnd() < P.respect;
  const pressZone = respect ? b.pressZone() : 0;
  /** would moving `travel` U over `frames` frames put me inside a presser's zone once it can press again? */
  const intoPress = (travel: number, frames: number): boolean => respect && opBusy <= frames && d - travel <= pressZone;
  const dashTravel = kit.cf.dashF[kit.cf.dashFFrames] ?? 0;
  const dashFrames = kit.cf.dashFFrames + 2;
  if (intoPress(0, 2)) {
    const sp = opBusy === 0 ? b.spacePoke() : -1;
    if (sp >= 0) {
      b.stats.spacePokes++;
      return { t: 'route', steps: [sp].concat(P.route >= 3 ? b.followUps(sp).slice(-1) : []) };
    }
    b.stats.respects++;
    return { t: 'guard', crouch: b.chooseGuardCrouch(), frames: Math.max(4, think >> 1) };
  }

  // charge fighters keep their charge (down-back = back AND down charge, and a crouch guard)
  if (st.charge && !aggro) return { t: 'guard', crouch: true, frames: think + 8 };
  // CHANGED(AI) P2: at zoning range with the charge special not charged yet: sit in down-back until it is (the kit's
  // chargeF, 45 f for Krane) - the next decision releases it (canUse sees the stored charge)
  if (st.charge && d > (st.backOff >= 0.3 ? Math.min(kit.rangeLo, 220000) : kit.rangeHi * 0.85) && st.zone > 0) {
    const chargeZ = (kit.lists.zoning.length > 0 ? kit.lists.zoning : kit.projMoves).filter((k) => kit.moves[k].recipe !== null && kit.moves[k].recipe!.charge !== 0 && !b.canUse(k));
    if (chargeZ.length > 0 && zoning.length === 0) {
      const need = Math.max(4, kit.cf.mw.chargeFrames - me.chB + 2);
      return { t: 'guard', crouch: true, frames: Math.min(need, think + 30) };
    }
  }

  // zoners / setplay / shotos at range: projectile cadence (never two of your own on screen). A keep-away
  // style fires anywhere inside its own range; the others from the far end of theirs.
  const keepAway = st.backOff >= 0.3;
  const zoneFrom = keepAway ? Math.min(kit.rangeLo, 220000) : kit.rangeHi * 0.85;
  if (d > zoneFrom && st.zone > 0 && zoning.length > 0 && b.rnd() < st.zone * (aggro ? 1 : 0.8)) {
    const z = pick(b, zoning);
    if (z !== undefined) return { t: 'move', idx: z };
  }

  // keep-away: too close for comfort
  if (st.backOff > 0 && d < kit.rangeLo && b.rnd() < st.backOff) {
    if (st.escape > 0 && b.rnd() < st.escape) {
      const e = usableIn(b, kit.lists.escape, false);
      if (e.length > 0) return { t: 'move', idx: e[0] };
    }
    if (!cornerBehind) {
      if (b.rnd() < 0.4) return { t: 'steps', steps: [{ d: 4, b: 0 }, { d: 5, b: 0 }, { d: 4, b: 0 }] };
      return { t: 'hold', d: 4, frames: think };
    }
  }

  // IMPACT on reads (L5+), and vs STAGE FRIGHT in the corner (L4+: stun on hit or block)
  if (kit.impact >= 0 && d < 190000 && b.canUse(kit.impact)) {
    const opCornered = Math.abs(op.x) > s.wall - 150000 && op.x * s.dx > 0;
    if (P.nerve >= 2 && op.fright && opCornered && b.rnd() < 0.25) return { t: 'move', idx: kit.impact };
    if (P.nerve >= 3 && aggro && b.rnd() < 0.02) return { t: 'move', idx: kit.impact };
  }

  // a keep-away style already inside its range does not walk in: it waits for the next zoning window
  if (aggro && !(keepAway && d >= kit.rangeLo)) {
    if (d <= closeU) {
      const grabs = usableIn(b, kit.lists.grab, true);
      // CHANGED(AI3D): a command-grab SUPER (Bruno COLD STORAGE) is a grab too - thrown out up close when the meter policy
      // spends it (a spare bar: 3 bars, or the latched Lv1 spend roll; never while saving toward Lv3)
      for (const sp of [kit.sup1, kit.sup3]) {
        if (sp < 0 || !kit.moves[sp].grab || grabs.indexOf(sp) >= 0 || !b.canUse(sp) || !b.inReach(sp)) continue;
        const lv3 = kit.moves[sp].super === 3;
        if (lv3 ? b.showBars() >= 3 : b.showBars() >= 3 || b.spendLv1) grabs.push(sp);
      }
      const mix = usableIn(b, (kit.roles.low ?? []).concat(kit.roles.overhead ?? []), true).filter((k) => kit.moves[k].normal || kit.moves[k].special);
      const armor = usableIn(b, kit.lists.armor, true);
      const dec = choose(b, [
        [st.throw, () => (kit.throwF >= 0 && b.inReach(kit.throwF) ? { t: 'move', idx: b.rnd() < 0.8 || cornerBehind ? kit.throwF : kit.throwB >= 0 ? kit.throwB : kit.throwF } : null)],
        [st.grab, () => { const g = pick(b, grabs); return g !== undefined ? { t: 'move', idx: g } : null; }],
        [st.poke + 0.1, () => {
          const steps = b.kit.lists.combo.filter((k) => kit.moves[k].recipe !== null);
          if (steps.length > 0 && b.canUse(steps[0]) && b.inReach(steps[0])) {
            const n = P.route <= 1 ? 1 : P.route === 2 ? 2 : steps.length;
            return { t: 'route', steps: steps.slice(0, n) };
          }
          const p = pick(b, pokes);
          return p !== undefined ? { t: 'route', steps: [p].concat(P.route >= 3 ? b.followUps(p).slice(-1) : []) } : null;
        }],
        [st.mix, () => { const x = pick(b, mix); return x !== undefined ? { t: 'move', idx: x } : null; }],
        [st.armor, () => { const a = pick(b, armor); return a !== undefined ? { t: 'move', idx: a } : null; }],
        [0.15 * guardChance(b, 1) / Math.max(0.05, P.guard + 0.05), () => guard(think)],
      ]);
      if (dec) return dec;
    } else if (d <= kit.rangeHi + 40000) {
      const approach = usableIn(b, kit.lists.approach, true);
      // CHANGED(AI) P2: the kit's other specials (in no fighter JSON cpu list) as occasional pokes where they connect now
      // and are not badly unsafe (armored ones always qualify) - so every special of a kit shows up
      const other = b.otherSpecials().filter((k) => b.canUse(k) && b.inReach(k) && (kit.moves[k].advBlock >= -12 || kit.moves[k].armored));
      const jumpIn = d > 150000 && d < 300000;
      const dec = choose(b, [
        [st.poke, () => { const p = pick(b, pokes); return p !== undefined ? { t: 'move', idx: p } : null; }],
        [st.approach, () => { const a = pick(b, approach); return a !== undefined ? { t: 'move', idx: a } : null; }],
        [st.dash, () => ((cornerBehind || d > 120000) && !intoPress(dashTravel, dashFrames) ? { t: 'steps', steps: [{ d: 6, b: 0 }, { d: 5, b: 0 }, { d: 6, b: 0 }] } : null)],
        [jumpIn ? st.jump : 0, () => { b.stats.jumps++; return { t: 'steps', steps: [{ d: 9, b: 0 }, { d: 9, b: 0 }] }; }],
        [st.walkIn, () => (intoPress(kit.cf.walkF * think, think) ? null : { t: 'hold', d: 6, frames: think })],
        [st.air > 0 && jumpIn ? st.air : 0, () => { b.stats.jumps++; return { t: 'steps', steps: [{ d: 9, b: 0 }, { d: 9, b: 0 }] }; }],
        [other.length > 0 ? 0.08 : 0, () => { const o = pick(b, other); return o !== undefined ? { t: 'move', idx: o } : null; }],
      ]);
      if (dec) return dec;
    } else {
      const approach = usableIn(b, kit.lists.approach, true);
      const dec = choose(b, [
        [st.walkIn + 0.1, () => (intoPress(kit.cf.walkF * (think + 6), think + 6) ? null : { t: 'hold', d: 6, frames: think + 6 })],
        [st.dash, () => (intoPress(dashTravel, dashFrames) ? null : { t: 'steps', steps: [{ d: 6, b: 0 }, { d: 5, b: 0 }, { d: 6, b: 0 }] })],
        [st.approach, () => { const a = pick(b, approach); return a !== undefined ? { t: 'move', idx: a } : null; }],
        [st.jump * 0.5, () => { b.stats.jumps++; return { t: 'steps', steps: [{ d: 9, b: 0 }, { d: 9, b: 0 }] }; }],
      ]);
      if (dec) return dec;
    }
  }

  // CHANGED(AI) P2: a throw-happy opponent up close (its observed throw share): step out of throw range, or (L3+)
  // press a fast button - a strike beats a throw on the same frame - instead of holding a guard it would throw
  if (d <= closeU + 10000 && op.st !== ST.KNOCKDOWN) {
    const h = b.habits;
    const pT = P.habit * h.confidence() * h.pThrow();
    if (pT > 0 && b.rnd() < pT) {
      b.stats.throwEscapes++;
      if (P.level >= 3 || P.level < 0) {
        const jab = kit.lights.find((k) => b.canUse(k) && b.inReach(k));
        if (jab !== undefined && b.rnd() < 0.5) return { t: 'move', idx: jab };
      }
      if (!cornerBehind) return { t: 'hold', d: 4, frames: Math.max(8, think >> 1) };
    }
  }

  // waiting: get back to the preferred range (footsies), guard inside the opponent's threat range
  const closer = st.walkIn >= 0.7; // rushdown / grappler live up close
  if (!closer && d < kit.rangeLo && !cornerBehind && b.rnd() < 0.3 + st.backOff) {
    if (keepAway && b.rnd() < 0.35) return { t: 'steps', steps: [{ d: 4, b: 0 }, { d: 5, b: 0 }, { d: 4, b: 0 }] };
    return { t: 'hold', d: 4, frames: think };
  }
  // CHANGED(AI) P2: the guard posture is a guess from its habits (guardChance), not a flat roll
  if (d <= opThreat && b.rnd() < guardChance(b, P.guard + 0.1)) {
    b.stats.habitGuards++;
    return guard(think + 4);
  }
  if (st.setup > 0 && d > kit.rangeLo && b.rnd() < st.setup) {
    const setup = usableIn(b, kit.lists.setup, false);
    if (setup.length > 0) return { t: 'move', idx: setup[0] };
  }
  if (d > kit.rangeHi && !intoPress(kit.cf.walkF * think, think) && b.rnd() < st.walkIn + 0.2) return { t: 'hold', d: 6, frames: think };
  if (d < kit.rangeLo && !cornerBehind && b.rnd() < st.backOff + 0.1) return { t: 'hold', d: 4, frames: think };
  if (d <= opThreat + 60000 && b.rnd() < guardChance(b, P.guard)) {
    b.stats.habitGuards++;
    return guard(think);
  }
  return { t: 'none', frames: think };
}

export { B, M };

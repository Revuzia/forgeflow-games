// Arcane Realms TCG — AI opponent.
// Turn-local greedy action-sequence search with heuristic state evaluation +
// exact lethal solver (the Hearthstone-AI competition baseline architecture).
// The AI sees only what a human would: enemy hand/deck/trap contents are
// stripped via aiView() before any reasoning happens. It plays through the
// exact same action API as the player.

import { cardById } from './cards.js?v=16';
import { legalActions, applyAction, cloneState, aiView, effAtk, hasKw, opponentOf } from './engine.js?v=16';
import { rngNext } from './rng.js?v=16';

export const DIFFICULTIES = {
  squire:   { label: 'Squire',   noise: 5.0, lethal: false, lookahead: false, blunder: 0.25 },
  knight:   { label: 'Knight',   noise: 0.6, lethal: true,  lookahead: false, blunder: 0 },
  archmage: { label: 'Archmage', noise: 0,   lethal: true,  lookahead: true,  blunder: 0 },
};

const KW_VALUE = {
  guard: 1.2, flying: 1.1, lifesteal: 1.0, venomous: 1.7, cleave: 1.4,
  piercing: 0.8, ward: 1.2, stealth: 0.7, swift: 0.4,
};

export function evaluate(state, side) {
  const foe = opponentOf(side);
  if (state.winner === side) return 1e9;
  if (state.winner === foe) return -1e9;
  if (state.winner === 'draw') return 0;
  const me = state.players[side];
  const en = state.players[foe];
  let s = 0;
  // hero health — piecewise: every point matters when low, topping-off is cheap
  // (keeps the AI from burning cards on 2-HP heals at 28/30)
  const ownHp = me.hp <= 15 ? 2.2 * me.hp : 2.2 * 15 + 0.8 * (me.hp - 15);
  s += ownHp - (me.hp <= 5 ? 40 : 0) - (me.hp <= 10 ? 12 : 0);
  s -= 2.6 * en.hp - (en.hp <= 5 ? 30 : 0) - (en.hp <= 10 ? 10 : 0);
  // board material
  const unitVal = (u, p) => {
    let v = 1.15 * effAtk(state, p, u) + 1.0 * u.hp + 0.8; // body premium
    if (!u.silenced) {
      for (const k of u.kw) v += KW_VALUE[k] || 0;
      v += (u.frenzy || 0) * 0.35 + (u.regenerate || 0) * 0.5;
    }
    if (u.frozen) v -= 1.6;
    return v;
  };
  for (const u of me.board) s += 1.9 * unitVal(u, side);
  for (const u of en.board) s -= 2.0 * unitVal(u, foe);
  // hand + resources
  s += 1.15 * Math.min(me.hand.length, 8);
  s -= 1.0 * Math.min(en.hand.length, 8);
  s += 1.4 * (me.manaMax - en.manaMax);
  s += 0.9 * me.traps.length - 0.9 * en.traps.length;
  s -= 2.0 * me.fatigue * me.fatigue;
  return s;
}

// ── exact-ish lethal solver ──────────────────────────────────────────────
// Finds a kill line this turn: burn spells + attacks through guards.
// Returns an ordered action list or null.
export function findLethal(view, side) {
  const me = view.players[side];
  const foeIdx = opponentOf(side);
  const en = view.players[foeIdx];
  const enemyHp = en.hp;

  // ready attackers (assume we can enter combat if in main)
  const attackers = me.board.filter((u) =>
    !u.tapped && !u.frozen && !(u.sick && !hasKw(u, 'swift')) && effAtk(view, side, u) > 0);
  // burn: direct-damage spells we can aim at the enemy hero
  const burn = [];
  for (const h of me.hand) {
    const def = cardById(h.card);
    if (def.type !== 'spell' || !def.fx) continue;
    let face = 0;
    for (const op of def.fx) {
      if (op.op === 'damage' && op.target === 'chosen' && def.target && def.target.kind === 'any') face += op.amount;
      if (op.op === 'damage' && op.target === 'enemy-hero') face += op.amount;
      if (op.op === 'aoe' && op.includeHero) face += op.amount;
    }
    if (face > 0) burn.push({ iid: h.iid, cost: def.cost, face, needsTarget: !!def.target });
  }
  // best burn subset within mana (≤10 hand cards → brute force)
  let bestBurn = { dmg: 0, items: [] };
  const n = burn.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    let cost = 0, dmg = 0; const items = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { cost += burn[i].cost; dmg += burn[i].face; items.push(burn[i]); }
    if (cost <= me.mana && dmg > bestBurn.dmg) bestBurn = { dmg, items };
  }

  const guards = en.board.filter((u) => hasKw(u, 'guard') && !(u.stealth && !u.silenced));
  const atkOf = (u) => effAtk(view, side, u);

  if (guards.length === 0) {
    const total = attackers.reduce((a, u) => a + atkOf(u), 0) + bestBurn.dmg;
    if (total < enemyHp) return null;
    const plan = [];
    for (const b of bestBurn.items) plan.push({ type: 'play', iid: b.iid, target: { kind: 'hero', p: foeIdx } });
    if (view.phase === 'main') plan.push({ type: 'combat' });
    for (const u of attackers) plan.push({ type: 'attack', attacker: u.iid, target: { kind: 'hero', p: foeIdx } });
    return { plan, kind: 'direct' };
  }

  // guards exist: greedily assign smallest attackers to chew each guard, rest to face.
  // (heuristic, verified by simulation before committing)
  const sorted = attackers.slice().sort((a, b) => atkOf(a) - atkOf(b));
  const used = new Set();
  const guardKills = [];
  for (const g of guards.slice().sort((a, b) => a.hp - b.hp)) {
    let hpLeft = g.hp;
    const killers = [];
    for (const u of sorted) {
      if (used.has(u.iid) || hpLeft <= 0) continue;
      // don't feed venomous guards our big attackers first — order is fine for heuristic
      killers.push(u); used.add(u.iid); hpLeft -= atkOf(u);
    }
    if (hpLeft > 0) return null; // can't clear guards → no lethal through this path
    guardKills.push({ guard: g, killers });
  }
  const faceDmg = attackers.filter((u) => !used.has(u.iid)).reduce((a, u) => a + atkOf(u), 0) + bestBurn.dmg;
  if (faceDmg < enemyHp) return null;
  const plan = [];
  for (const b of bestBurn.items) plan.push({ type: 'play', iid: b.iid, target: { kind: 'hero', p: foeIdx } });
  if (view.phase === 'main') plan.push({ type: 'combat' });
  for (const gk of guardKills) for (const u of gk.killers) plan.push({ type: 'attack', attacker: u.iid, target: { kind: 'unit', iid: gk.guard.iid } });
  for (const u of attackers.filter((x) => !used.has(x.iid))) plan.push({ type: 'attack', attacker: u.iid, target: { kind: 'hero', p: foeIdx } });
  return { plan, kind: 'through-guards' };
}

// verify a lethal plan actually wins in simulation (traps may foil it — that's fine, we try)
function verifyPlan(view, side, plan) {
  const sim = cloneState(view);
  try {
    for (const act of plan) {
      if (sim.winner !== null) break;
      applyAction(sim, act);
    }
  } catch { return false; }
  return sim.winner === side;
}

// ── greedy chooser ───────────────────────────────────────────────────────
export function chooseAction(state, side, difficulty = 'knight') {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.knight;
  const view = aiView(state, side);

  // 1) lethal?
  if (diff.lethal) {
    const lethal = findLethal(view, side);
    if (lethal && verifyPlan(view, side, lethal.plan) && lethal.plan.length) {
      return lethal.plan[0];
    }
  }

  // 2) greedy: evaluate every candidate action one step deep
  const acts = legalActions(view);
  if (!acts.length) return { type: 'end' };
  const baseline = evaluate(view, side);
  const enemyTraps = view.players[opponentOf(side)].traps.length;
  // dedicated rng cursor for personality noise (deterministic per position,
  // decorrelated from game rng)
  const noiseRng = { rngState: (view.rngState ^ 0x9e3779b9) | 0 };

  let scored = [];
  for (const act of acts) {
    if (act.type === 'end') continue;
    if (act.type === 'combat') continue; // handled below
    const sim = cloneState(view);
    let score;
    try {
      applyAction(sim, act);
      score = evaluate(sim, side);
    } catch { continue; }
    // caution: attacking into possible traps / casting spells into counterspell
    if (enemyTraps > 0) {
      if (act.type === 'attack') score -= 0.9 * enemyTraps;
      if (act.type === 'play' && cardById(handCard(view, side, act.iid) || 'nt01').type === 'spell') score -= 0.5 * enemyTraps;
    }
    if (diff.noise) score += (rngNext(noiseRng) - 0.5) * 2 * diff.noise;
    scored.push({ act, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // occasional deliberate blunder on easy
  if (diff.blunder && scored.length > 1 && rngNext(noiseRng) < diff.blunder) {
    return scored[Math.min(1 + Math.floor(rngNext(noiseRng) * 2), scored.length - 1)].act;
  }

  // 3) two-step lookahead for the top candidates (archmage)
  if (diff.lookahead && scored.length) {
    const top = scored.slice(0, 6);
    for (const cand of top) {
      const sim = cloneState(view);
      try {
        applyAction(sim, cand.act);
        if (sim.winner !== null || sim.active !== side) { cand.score2 = evaluate(sim, side); continue; }
        let best2 = evaluate(sim, side);
        for (const act2 of legalActions(sim)) {
          if (act2.type === 'end' || act2.type === 'combat') continue;
          const sim2 = cloneState(sim);
          try {
            applyAction(sim2, act2);
            best2 = Math.max(best2, evaluate(sim2, side));
          } catch { /* skip */ }
        }
        cand.score2 = best2;
      } catch { cand.score2 = -Infinity; }
    }
    top.sort((a, b) => (b.score2 ?? b.score) - (a.score2 ?? a.score));
    if (top.length && (top[0].score2 ?? top[0].score) > baseline + 0.15) return top[0].act;
  } else if (scored.length && scored[0].score > baseline + 0.15) {
    return scored[0].act;
  }

  // 4) nothing beneficial: if in main and attacks would exist in combat, go to combat
  if (view.phase === 'main') {
    const sim = cloneState(view);
    try {
      applyAction(sim, { type: 'combat' });
      const attacks = legalActions(sim).filter((a) => a.type === 'attack');
      if (attacks.length) {
        // only bother if at least one attack is non-suicidal per greedy eval
        for (const a of attacks) {
          const sim2 = cloneState(sim);
          try {
            applyAction(sim2, a);
            if (evaluate(sim2, side) > baseline - 0.5) return { type: 'combat' };
          } catch { /* skip */ }
        }
      }
    } catch { /* fall through */ }
  }
  return { type: 'end' };
}

function handCard(view, side, iid) {
  const h = view.players[side].hand.find((x) => x.iid === iid);
  return h ? h.card : null;
}

// runs the AI's whole turn on a real state (used by selftest + AI-vs-AI)
export function runAiTurn(state, side, difficulty = 'knight', maxActions = 60) {
  const allEvents = [];
  let guard = 0;
  while (state.winner === null && state.active === side && guard++ < maxActions) {
    const act = chooseAction(state, side, difficulty);
    const ev = applyAction(state, act);
    allEvents.push({ act, ev });
    if (act.type === 'end' || act.type === 'concede') break;
  }
  // safety: if we hit the cap without ending, force end
  if (state.winner === null && state.active === side) {
    allEvents.push({ act: { type: 'end' }, ev: applyAction(state, { type: 'end' }) });
  }
  return allEvents;
}

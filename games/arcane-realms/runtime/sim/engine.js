// Arcane Realms TCG — rules engine (pure data, deterministic, UI-agnostic).
// The view layer replays the `events` returned by applyAction as animations.
// AI and selftest drive the exact same action API the player uses.

import { CARDS, COLLECTIBLE, cardById } from './cards.js?v=23';
import { rngInt, rngPick, rngShuffle, seedFrom } from './rng.js?v=23';

export const MAX_BOARD = 6;
export const MAX_HAND = 10;
export const MAX_TRAPS = 3;
export const MAX_MANA = 10;
export const HERO_HP = 30;
export const TURN_LIMIT = 60;

// ─────────────────────────── game creation ───────────────────────────

export function createGame({ seed = 1, decks, names = ['You', 'Opponent'], heroes = ['dawn', 'grave'], first = null }) {
  if (!decks || decks.length !== 2) throw new Error('need 2 decks');
  const state = {
    rngState: seedFrom(seed),
    turn: 0,
    active: 0,
    phase: 'main',
    iid: 1,
    winner: null,
    players: [null, null],
  };
  const goesFirst = first === null ? rngInt(state, 2) : first;
  for (let p = 0; p < 2; p++) {
    const deck = decks[p].slice();
    for (const id of deck) cardById(id); // validate
    rngShuffle(state, deck);
    state.players[p] = {
      name: names[p], hero: heroes[p],
      hp: HERO_HP, maxHp: HERO_HP,
      mana: 0, manaMax: 0,
      deck, hand: [], board: [], traps: [], grave: [],
      fatigue: 0,
    };
  }
  state.active = goesFirst;
  const ev = [{ t: 'game-start', first: goesFirst }];
  // opening hands: first player 3, second player 4 + Arcane Ember
  drawCards(state, goesFirst, 3, ev);
  drawCards(state, 1 - goesFirst, 4, ev);
  addCardToHand(state, 1 - goesFirst, 'tk_ember', ev);
  beginTurn(state, ev);
  state._openingEvents = ev;
  return state;
}

function nextIid(state) { return state.iid++; }

function handEntry(state, p, cardId) {
  return { iid: nextIid(state), card: cardId };
}

// ─────────────────────────── helpers ───────────────────────────

export function opponentOf(p) { return 1 - p; }

export function unitByIid(state, iid) {
  for (let p = 0; p < 2; p++) {
    const u = state.players[p].board.find((x) => x.iid === iid);
    if (u) return { unit: u, side: p };
  }
  return null;
}

export function effAtk(state, side, unit) {
  const def = cardById(unit.card);
  let a = unit.atk;
  if (!unit.silenced) {
    if (unit.frenzy && unit.hp < unit.maxHp) a += unit.frenzy;
    // +Attack auras from OTHER friendly units (read-time). filter: none = all others,
    // {tribe} = one tribe, {tribes:[...]} = several.
    for (const other of state.players[side].board) {
      if (other === unit || other.silenced) continue;
      const aura = cardById(other.card).aura;
      if (aura && aura.atk) {
        const f = aura.filter || {};
        const tribes = f.tribes || (f.tribe ? [f.tribe] : null);
        if (!tribes || tribes.includes(def.tribe)) a += aura.atk;
      }
    }
  }
  return Math.max(0, a);
}

export function hasKw(unit, kw) {
  return !unit.silenced && unit.kw.includes(kw);
}

// Keyword-grant auras (e.g. "your other creatures have Lifesteal/Piercing"). Unlike
// +Attack auras (read-time in effAtk), granted keywords are materialised onto the
// unit's kw list and re-derived whenever the board changes — this can't kill a unit,
// so no death cascade. Innate keywords are never removed; only aura-granted ones.
function recomputeAuraKw(state) {
  for (let p = 0; p < 2; p++) {
    const board = state.players[p].board;
    for (const u of board) {
      const grant = new Set();
      if (!u.silenced) {
        const def = cardById(u.card);
        for (const other of board) {
          if (other === u || other.silenced) continue;
          const aura = cardById(other.card).aura;
          if (!aura || !aura.grant) continue;
          const f = aura.filter || {};
          const tribes = f.tribes || (f.tribe ? [f.tribe] : null);
          if (!tribes || tribes.includes(def.tribe)) for (const k of aura.grant) grant.add(k);
        }
      }
      const innate = cardById(u.card).kw || [];
      for (const k of (u._auraKw || [])) if (!grant.has(k) && !innate.includes(k)) {
        const i = u.kw.indexOf(k); if (i >= 0) u.kw.splice(i, 1);
      }
      for (const k of grant) if (!u.kw.includes(k)) u.kw.push(k);
      u._auraKw = [...grant];
    }
  }
}

// Overcharge: friendly units whose aura triggers when their controller casts a spell.
function fireSpellwatch(state, side, ev) {
  for (const w of state.players[side].board.slice()) {
    if (w.silenced || w.hp <= 0) continue;
    const aura = cardById(w.card).aura;
    if (aura && aura.trigger === 'spell-played' && aura.fx) {
      ev.push({ t: 'overcharge', iid: w.iid, card: w.card });
      resolveOps(state, aura.fx, { side, selfUnit: w, chosen: null, card: cardById(w.card) }, ev);
    }
  }
}

export function makeUnit(state, cardId) {
  const def = cardById(cardId);
  return {
    iid: nextIid(state),
    card: cardId,
    atk: def.atk, hp: def.hp, maxHp: def.hp,
    kw: (def.kw || []).slice(),
    frenzy: def.frenzy || 0,
    regenerate: def.regenerate || 0,
    tapped: false, frozen: false, sick: true,
    ward: (def.kw || []).includes('ward'),
    stealth: (def.kw || []).includes('stealth'),
    silenced: false,
    extraAttacks: 0,
  };
}

// ─────────────────────────── draw / hand ───────────────────────────

function drawCards(state, p, n, ev) {
  const pl = state.players[p];
  for (let i = 0; i < n; i++) {
    if (pl.deck.length === 0) {
      pl.fatigue += 1;
      ev.push({ t: 'fatigue', p, amount: pl.fatigue });
      damageHero(state, p, pl.fatigue, ev, { source: 'fatigue' });
      continue;
    }
    const cardId = pl.deck.pop();
    if (pl.hand.length >= MAX_HAND) {
      pl.grave.push(cardId);
      ev.push({ t: 'burn', p, card: cardId });
      continue;
    }
    const e = handEntry(state, p, cardId);
    pl.hand.push(e);
    ev.push({ t: 'draw', p, iid: e.iid, card: cardId, deckLeft: pl.deck.length });
  }
}

function addCardToHand(state, p, cardId, ev) {
  const pl = state.players[p];
  if (pl.hand.length >= MAX_HAND) {
    pl.grave.push(cardId);
    ev.push({ t: 'burn', p, card: cardId });
    return null;
  }
  const e = handEntry(state, p, cardId);
  pl.hand.push(e);
  ev.push({ t: 'add-card', p, iid: e.iid, card: cardId });
  return e;
}

// ─────────────────────────── turn flow ───────────────────────────

function beginTurn(state, ev) {
  state.turn += 1;
  const p = state.active;
  const pl = state.players[p];
  state.phase = 'main';
  ev.push({ t: 'turn-start', p, turn: state.turn });

  // untap & thaw
  for (const u of pl.board) {
    u.extraAttacks = 0;
    if (u.frozen) {
      u.frozen = false; // thaws, but stays tapped this turn
      ev.push({ t: 'thaw', iid: u.iid });
    } else if (u.tapped) {
      u.tapped = false;
      ev.push({ t: 'untap', iid: u.iid });
    }
    u.sick = false;
  }
  // regenerate
  for (const u of pl.board.slice()) {
    if (u.regenerate && !u.silenced && u.hp < u.maxHp && u.hp > 0) {
      const healed = Math.min(u.regenerate, u.maxHp - u.hp);
      u.hp += healed;
      ev.push({ t: 'heal', target: { kind: 'unit', iid: u.iid }, amount: healed, source: 'regenerate' });
    }
  }
  // mana
  pl.manaMax = Math.min(MAX_MANA, pl.manaMax + 1);
  pl.mana = pl.manaMax;
  ev.push({ t: 'mana', p, mana: pl.mana, manaMax: pl.manaMax });
  // draw
  drawCards(state, p, 1, ev);
  checkWin(state, ev);
  // turn limit safety: decide by hp
  if (!state.winner && state.turn > TURN_LIMIT) {
    const [a, b] = state.players;
    state.winner = a.hp === b.hp ? 'draw' : (a.hp > b.hp ? 0 : 1);
    ev.push({ t: 'win', winner: state.winner, reason: 'turn-limit' });
  }
}

// ─────────────────────────── damage / heal / death ───────────────────────────

function damageHero(state, p, amount, ev, opts = {}) {
  if (amount <= 0 || state.winner !== null) return 0;
  const pl = state.players[p];
  pl.hp -= amount;
  ev.push({ t: 'damage', target: { kind: 'hero', p }, amount, source: opts.source || null, sourceIid: opts.sourceIid || null });
  checkWin(state, ev);
  return amount;
}

function damageUnit(state, side, unit, amount, ev, opts = {}) {
  if (amount <= 0 || unit.hp <= 0) return 0;
  unit.hp -= amount;
  ev.push({ t: 'damage', target: { kind: 'unit', iid: unit.iid }, amount, source: opts.source || null, sourceIid: opts.sourceIid || null });
  if (opts.venomous && unit.hp > 0) {
    unit._venomed = true;
    ev.push({ t: 'venom', iid: unit.iid });
  }
  return amount;
}

function healTarget(state, tgt, amount, ev, source) {
  if (amount <= 0) return;
  if (tgt.kind === 'hero') {
    const pl = state.players[tgt.p];
    const healed = Math.min(amount, pl.maxHp - pl.hp);
    if (healed > 0) {
      pl.hp += healed;
      ev.push({ t: 'heal', target: { kind: 'hero', p: tgt.p }, amount: healed, source });
    }
  } else {
    const found = unitByIid(state, tgt.iid);
    if (!found) return;
    const u = found.unit;
    const healed = Math.min(amount, u.maxHp - u.hp);
    if (healed > 0) {
      u.hp += healed;
      ev.push({ t: 'heal', target: { kind: 'unit', iid: u.iid }, amount: healed, source });
    }
  }
}

function checkWin(state, ev) {
  if (state.winner !== null) return;
  const dead0 = state.players[0].hp <= 0;
  const dead1 = state.players[1].hp <= 0;
  if (dead0 || dead1) {
    state.winner = dead0 && dead1 ? 'draw' : (dead0 ? 1 : 0);
    ev.push({ t: 'win', winner: state.winner, reason: 'hp' });
  }
}

// removes dead units, fires Last Rites + death traps, loops until stable
function reapDeaths(state, ev) {
  let guard = 0;
  while (guard++ < 30) {
    let any = false;
    for (let p = 0; p < 2; p++) {
      const pl = state.players[p];
      const dead = pl.board.filter((u) => u.hp <= 0 || u._venomed || u._destroyed);
      if (!dead.length) continue;
      any = true;
      for (const u of dead) {
        const idx = pl.board.indexOf(u);
        if (idx >= 0) pl.board.splice(idx, 1);
        pl.grave.push(u.card);
        ev.push({ t: 'death', iid: u.iid, card: u.card, p });
        // Last Rites
        const def = cardById(u.card);
        if (def.rites && !u.silenced) {
          ev.push({ t: 'rites', iid: u.iid, card: u.card });
          resolveOps(state, def.rites, { side: p, selfUnit: null, chosen: null, card: def }, ev);
        }
        // enemy-death traps (opponent of the dead unit's owner)
        const foe = opponentOf(p);
        fireTraps(state, foe, 'enemy-death', { deadCard: u.card, deadSide: p }, ev);
        // deathwatch: this owner's surviving units that trigger on a friendly death
        for (const w of pl.board.slice()) {
          if (w.silenced || w.hp <= 0 || w._venomed || w._destroyed) continue;
          const wa = cardById(w.card).aura;
          if (wa && wa.trigger === 'friendly-creature-dies' && wa.fx) {
            ev.push({ t: 'deathwatch', iid: w.iid, card: w.card });
            resolveOps(state, wa.fx, { side: p, selfUnit: w, chosen: null, card: cardById(w.card) }, ev);
          }
        }
      }
    }
    recomputeAuraKw(state); // an anthem may have died — revert its granted keywords
    if (!any) break;
  }
}

// ─────────────────────────── traps ───────────────────────────

function fireTraps(state, owner, trigger, ctx, ev) {
  const pl = state.players[owner];
  if (!pl.traps.length || state.winner !== null) return { negated: false };
  let negated = false;
  const fired = [];
  for (const tr of pl.traps.slice()) {
    if (tr.unknown) continue; // AI-view placeholder — never fires in simulation
    const def = cardById(tr.card);
    if (!def.trap || def.trap.on !== trigger) continue;
    // steal-corpse needs board room, else stays armed
    if (def.trap.fx.some((o) => o.op === 'steal-corpse') && pl.board.length >= MAX_BOARD) continue;
    fired.push(tr);
    ev.push({ t: 'trap-trigger', p: owner, iid: tr.iid, card: tr.card, trigger });
    for (const op of def.trap.fx) {
      if (op.op === 'negate-spell') { negated = true; continue; }
      if (op.op === 'steal-corpse') {
        // resummon the dead enemy creature under trap owner's control
        const u = makeUnit(state, ctx.deadCard);
        // remove from the dying side's grave (it was just pushed)
        const g = state.players[ctx.deadSide].grave;
        const gi = g.lastIndexOf(ctx.deadCard);
        if (gi >= 0) g.splice(gi, 1);
        pl.board.push(u);
        ev.push({ t: 'summon', p: owner, iid: u.iid, card: u.card, stolen: true });
        continue;
      }
      resolveOps(state, [op], { side: owner, selfUnit: null, chosen: null, trigger: ctx, card: def }, ev);
    }
    const ti = pl.traps.indexOf(tr);
    if (ti >= 0) pl.traps.splice(ti, 1);
    pl.grave.push(tr.card);
    if (trigger === 'enemy-death') break; // one corpse, one trap
  }
  if (fired.length) reapDeaths(state, ev);
  return { negated };
}

// ─────────────────────────── effect DSL ───────────────────────────

// ctx: { side (caster side), selfUnit (unit that carries the effect, or null),
//        chosen ({kind,side,iid} or null), chosen2, trigger ({attackerIid,...}), card }
function resolveTargets(state, sel, ctx) {
  const { side } = ctx;
  const foe = opponentOf(side);
  switch (sel) {
    case 'chosen': return ctx.chosen ? [ctx.chosen] : [];
    case 'chosen2': return ctx.chosen2 ? [ctx.chosen2] : [];
    case 'self': return ctx.selfUnit ? [{ kind: 'unit', iid: ctx.selfUnit.iid }] : [];
    case 'self-hero': return [{ kind: 'hero', p: side }];
    case 'enemy-hero': return [{ kind: 'hero', p: foe }];
    case 'trigger-attacker': {
      if (!ctx.trigger || ctx.trigger.attackerIid == null) return [];
      const f = unitByIid(state, ctx.trigger.attackerIid);
      return f ? [{ kind: 'unit', iid: f.unit.iid }] : [];
    }
    case 'all-enemy-creatures': return state.players[foe].board.map((u) => ({ kind: 'unit', iid: u.iid }));
    case 'all-friendly-creatures': return state.players[side].board.map((u) => ({ kind: 'unit', iid: u.iid }));
    case 'all-other-friendly-creatures':
      return state.players[side].board.filter((u) => u !== ctx.selfUnit).map((u) => ({ kind: 'unit', iid: u.iid }));
    case 'all-creatures':
      return [...state.players[0].board, ...state.players[1].board].map((u) => ({ kind: 'unit', iid: u.iid }));
    case 'random-enemy-creature': {
      const u = rngPick(state, state.players[foe].board.filter((x) => x.hp > 0));
      return u ? [{ kind: 'unit', iid: u.iid }] : [];
    }
    case 'random-friendly-creature': {
      const u = rngPick(state, state.players[side].board.filter((x) => x.hp > 0 && x !== ctx.selfUnit));
      return u ? [{ kind: 'unit', iid: u.iid }] : [];
    }
    case 'adjacent-to-chosen': {
      if (!ctx.chosen || ctx.chosen.kind !== 'unit') return [];
      const f = unitByIid(state, ctx.chosen.iid);
      if (!f) return [];
      const board = state.players[f.side].board;
      const i = board.indexOf(f.unit);
      const out = [];
      if (i > 0) out.push({ kind: 'unit', iid: board[i - 1].iid });
      if (i < board.length - 1) out.push({ kind: 'unit', iid: board[i + 1].iid });
      return out;
    }
    default: throw new Error('unknown target selector: ' + sel);
  }
}

// ward check: op with a *specific chosen/trigger* target hitting an ENEMY unit with ward
function wardBlocks(state, ctx, tgt, sel, ev) {
  if (tgt.kind !== 'unit') return false;
  if (sel !== 'chosen' && sel !== 'chosen2' && sel !== 'trigger-attacker') return false;
  const f = unitByIid(state, tgt.iid);
  if (!f) return false;
  if (f.side === ctx.side) return false; // own effects don't break own ward
  const u = f.unit;
  if (u.ward && !u.silenced) {
    u.ward = false;
    u.kw = u.kw.filter((k) => k !== 'ward');
    ev.push({ t: 'ward-break', iid: u.iid });
    return true;
  }
  return false;
}

export function resolveOps(state, ops, ctx, ev) {
  for (const op of ops) {
    if (state.winner !== null) return;
    const sel = op.target || null;
    switch (op.op) {
      case 'damage': {
        const amount = op.amountFromCapturedAtk ? (ctx._capturedAtk ?? 0) : op.amount;
        for (const tgt of resolveTargets(state, sel, ctx)) {
          if (wardBlocks(state, ctx, tgt, sel, ev)) continue;
          if (tgt.kind === 'hero') damageHero(state, tgt.p, amount, ev, { source: 'effect', sourceIid: ctx.selfUnit?.iid });
          else {
            const f = unitByIid(state, tgt.iid);
            if (f) damageUnit(state, f.side, f.unit, amount, ev, { source: 'effect' });
          }
        }
        break;
      }
      case 'aoe': {
        const foe = opponentOf(ctx.side);
        let targets = [];
        if (op.side === 'enemy') targets = state.players[foe].board.slice();
        else if (op.side === 'all') targets = [...state.players[0].board, ...state.players[1].board];
        else if (op.side === 'all-others') targets = [...state.players[0].board, ...state.players[1].board].filter((u) => u !== ctx.selfUnit);
        for (const u of targets) damageUnit(state, null, u, op.amount, ev, { source: 'aoe' });
        if (op.includeHero) damageHero(state, foe, op.amount, ev, { source: 'aoe' });
        break;
      }
      case 'heal': {
        for (const tgt of resolveTargets(state, sel, ctx)) {
          let amount = op.amount;
          if (op.amountFromTargetHp && ctx._capturedHp != null) amount = ctx._capturedHp;
          healTarget(state, tgt, amount, ev, 'effect');
        }
        break;
      }
      case 'draw': {
        const who = op.who === 'enemy' ? opponentOf(ctx.side) : ctx.side;
        drawCards(state, who, op.count, ev);
        break;
      }
      case 'buff': {
        for (const tgt of resolveTargets(state, sel, ctx)) {
          if (tgt.kind !== 'unit') continue;
          if (wardBlocks(state, ctx, tgt, sel, ev)) continue;
          const f = unitByIid(state, tgt.iid);
          if (!f) continue;
          const u = f.unit;
          u.atk += op.atk || 0;
          u.hp += op.hp || 0;
          u.maxHp += op.hp || 0;
          if (op.kw) for (const k of op.kw) {
            if (!u.kw.includes(k)) u.kw.push(k);
            if (k === 'ward') u.ward = true;
            if (k === 'stealth') u.stealth = true;
          }
          ev.push({ t: 'buff', iid: u.iid, atk: op.atk || 0, hp: op.hp || 0, kw: op.kw || [] });
        }
        break;
      }
      case 'debuff': {
        for (const tgt of resolveTargets(state, sel, ctx)) {
          if (tgt.kind !== 'unit') continue;
          if (wardBlocks(state, ctx, tgt, sel, ev)) continue;
          const f = unitByIid(state, tgt.iid);
          if (!f) continue;
          const u = f.unit;
          u.atk = Math.max(0, u.atk + (op.atk || 0));
          if (op.hp) { u.hp += op.hp; u.maxHp = Math.max(1, u.maxHp + op.hp); }
          ev.push({ t: 'debuff', iid: u.iid, atk: op.atk || 0, hp: op.hp || 0 });
        }
        break;
      }
      case 'summon': {
        const who = op.who === 'enemy' ? opponentOf(ctx.side) : ctx.side;
        const pl = state.players[who];
        for (let i = 0; i < op.count; i++) {
          if (pl.board.length >= MAX_BOARD) break;
          const u = makeUnit(state, op.token);
          pl.board.push(u);
          ev.push({ t: 'summon', p: who, iid: u.iid, card: u.card });
        }
        break;
      }
      case 'destroy': {
        for (const tgt of resolveTargets(state, sel, ctx)) {
          if (tgt.kind !== 'unit') continue;
          if (!op.friendly && wardBlocks(state, ctx, tgt, sel, ev)) continue;
          const f = unitByIid(state, tgt.iid);
          if (!f) continue;
          f.unit._destroyed = true;
          ev.push({ t: 'destroy', iid: f.unit.iid });
        }
        break;
      }
      case 'silence': {
        for (const tgt of resolveTargets(state, sel, ctx)) {
          if (tgt.kind !== 'unit') continue;
          if (wardBlocks(state, ctx, tgt, sel, ev)) continue;
          const f = unitByIid(state, tgt.iid);
          if (!f) continue;
          const u = f.unit;
          u.silenced = true;
          u.kw = [];
          u.ward = false;
          u.stealth = false;
          ev.push({ t: 'silence', iid: u.iid });
        }
        break;
      }
      case 'freeze': {
        for (const tgt of resolveTargets(state, sel, ctx)) {
          if (tgt.kind !== 'unit') continue;
          if (wardBlocks(state, ctx, tgt, sel, ev)) continue;
          const f = unitByIid(state, tgt.iid);
          if (!f) continue;
          f.unit.frozen = true;
          f.unit.tapped = true;
          ev.push({ t: 'freeze', iid: f.unit.iid });
        }
        break;
      }
      case 'freeze-all': {
        const foe = opponentOf(ctx.side);
        for (const u of state.players[foe].board) {
          u.frozen = true; u.tapped = true;
          ev.push({ t: 'freeze', iid: u.iid });
        }
        break;
      }
      case 'freeze-random': {
        const foe = opponentOf(ctx.side);
        const pool = state.players[foe].board.filter((u) => !u.frozen);
        for (let i = 0; i < op.count && pool.length; i++) {
          const u = pool.splice(rngInt(state, pool.length), 1)[0];
          u.frozen = true; u.tapped = true;
          ev.push({ t: 'freeze', iid: u.iid });
        }
        break;
      }
      case 'bounce': {
        for (const tgt of resolveTargets(state, sel, ctx)) {
          if (tgt.kind !== 'unit') continue;
          if (wardBlocks(state, ctx, tgt, sel, ev)) continue;
          const f = unitByIid(state, tgt.iid);
          if (!f) continue;
          const pl = state.players[f.side];
          const idx = pl.board.indexOf(f.unit);
          if (idx >= 0) pl.board.splice(idx, 1);
          // tokens evaporate; real cards return to hand (base copy)
          const def = cardById(f.unit.card);
          if (def.rarity !== 'token') addCardToHand(state, f.side, f.unit.card, ev);
          ev.push({ t: 'bounce', iid: f.unit.iid, card: f.unit.card, p: f.side });
        }
        break;
      }
      case 'ramp': {
        const pl = state.players[ctx.side];
        pl.manaMax = Math.min(MAX_MANA, pl.manaMax + op.amount);
        ev.push({ t: 'ramp', p: ctx.side, manaMax: pl.manaMax });
        break;
      }
      case 'temp-mana': {
        const pl = state.players[ctx.side];
        pl.mana = Math.min(MAX_MANA, pl.mana + op.amount);
        ev.push({ t: 'mana', p: ctx.side, mana: pl.mana, manaMax: pl.manaMax, temp: true });
        break;
      }
      case 'resurrect': {
        const pl = state.players[ctx.side];
        const f = op.filter || {};
        for (let i = 0; i < op.count; i++) {
          if (pl.board.length >= MAX_BOARD) break;
          const pool = pl.grave.filter((id) => {
            const d = cardById(id);
            return d.type === 'creature' && d.rarity !== 'token' && (!f.maxCost || d.cost <= f.maxCost);
          });
          if (!pool.length) break;
          const pick = rngPick(state, pool);
          pl.grave.splice(pl.grave.indexOf(pick), 1);
          const u = makeUnit(state, pick);
          pl.board.push(u);
          ev.push({ t: 'summon', p: ctx.side, iid: u.iid, card: pick, resurrected: true });
        }
        break;
      }
      case 'add-random': {
        const pool = op.rarity ? COLLECTIBLE.filter((c) => c.rarity === op.rarity) : COLLECTIBLE;
        for (let i = 0; i < op.count; i++) {
          const pick = rngPick(state, pool);
          if (pick) addCardToHand(state, ctx.side, pick.id, ev);
        }
        break;
      }
      case 'add-card-id': {
        for (let i = 0; i < (op.count || 1); i++) addCardToHand(state, ctx.side, op.card, ev);
        break;
      }
      case 'multi-hit': {
        // each hit strikes a random enemy character (creature or hero)
        const mhFoe = opponentOf(ctx.side);
        for (let i = 0; i < op.count; i++) {
          if (state.winner !== null) break;
          const pool = state.players[mhFoe].board.filter((u) => u.hp > 0 && !u._venomed && !u._destroyed);
          const roll = rngInt(state, pool.length + 1);
          if (roll >= pool.length) {
            damageHero(state, mhFoe, op.amount, ev, { source: 'multi-hit' });
          } else {
            damageUnit(state, mhFoe, pool[roll], op.amount, ev, { source: 'multi-hit' });
          }
        }
        break;
      }
      case 'discard-random': {
        const who = op.who === 'enemy' ? opponentOf(ctx.side) : ctx.side;
        const pl = state.players[who];
        for (let i = 0; i < op.count; i++) {
          if (!pl.hand.length) break;
          const idx = rngInt(state, pl.hand.length);
          const [h] = pl.hand.splice(idx, 1);
          pl.grave.push(h.card);
          ev.push({ t: 'discard', p: who, card: h.card, iid: h.iid });
        }
        break;
      }
      case 'bounce-all': {
        const bSide = op.side === 'enemy' ? opponentOf(ctx.side) : ctx.side;
        const pl = state.players[bSide];
        for (const u of pl.board.slice()) {
          if (op.maxCost != null && cardById(u.card).cost > op.maxCost) continue;
          const idx = pl.board.indexOf(u);
          if (idx >= 0) pl.board.splice(idx, 1);
          const def = cardById(u.card);
          if (def.rarity !== 'token') addCardToHand(state, bSide, u.card, ev);
          ev.push({ t: 'bounce', iid: u.iid, card: u.card, p: bSide });
        }
        break;
      }
      case 'grave-to-hand': {
        const pl = state.players[ctx.side];
        const gf = op.filter || {};
        for (let i = 0; i < op.count; i++) {
          const pool = pl.grave.filter((id) => {
            const d = cardById(id);
            return d.type === 'creature' && d.rarity !== 'token' && (!gf.maxCost || d.cost <= gf.maxCost);
          });
          if (!pool.length) break;
          const pick = rngPick(state, pool);
          pl.grave.splice(pl.grave.indexOf(pick), 1);
          addCardToHand(state, ctx.side, pick, ev);
        }
        break;
      }
      case 'untap-all': {
        // grants every OTHER friendly creature one extra attack this turn
        for (const u of state.players[ctx.side].board) {
          if (u === ctx.selfUnit) continue;
          u.extraAttacks += 1;
          if (u.tapped && !u.frozen) { u.tapped = false; ev.push({ t: 'untap', iid: u.iid }); }
        }
        ev.push({ t: 'time-surge', p: ctx.side });
        break;
      }
      case 'fight': {
        const a = ctx.chosen && unitByIid(state, ctx.chosen.iid);
        const b = ctx.chosen2 && unitByIid(state, ctx.chosen2.iid);
        if (a && b) {
          const aAtk = effAtk(state, a.side, a.unit);
          const bAtk = effAtk(state, b.side, b.unit);
          ev.push({ t: 'fight', a: a.unit.iid, b: b.unit.iid });
          damageUnit(state, b.side, b.unit, aAtk, ev, { source: 'fight', venomous: hasKw(a.unit, 'venomous') });
          damageUnit(state, a.side, a.unit, bAtk, ev, { source: 'fight', venomous: hasKw(b.unit, 'venomous') });
          applyLifesteal(state, a.side, a.unit, aAtk, ev);
          applyLifesteal(state, b.side, b.unit, bAtk, ev);
        }
        break;
      }
      case 'negate-spell': break; // handled in fireTraps
      case 'steal-corpse': {
        // rally/fx path: reanimate a random creature from the ENEMY grave onto your board.
        // (The trap path is handled separately in fireTraps with the just-died corpse.)
        const pl = state.players[ctx.side];
        if (pl.board.length >= MAX_BOARD) break;
        const g = state.players[opponentOf(ctx.side)].grave;
        const pool = g.filter((id) => {
          const d = cardById(id);
          return d.type === 'creature' && d.rarity !== 'token' && (!op.filter || !op.filter.maxCost || d.cost <= op.filter.maxCost);
        });
        if (!pool.length) break;
        const pick = rngPick(state, pool);
        g.splice(g.lastIndexOf(pick), 1);
        const u = makeUnit(state, pick);
        pl.board.push(u);
        ev.push({ t: 'summon', p: ctx.side, iid: u.iid, card: pick, stolen: true });
        break;
      }
      default: throw new Error('unknown op: ' + op.op);
    }
  }
  reapDeaths(state, ev);
}

function applyLifesteal(state, side, unit, amount, ev) {
  if (amount > 0 && hasKw(unit, 'lifesteal')) {
    healTarget(state, { kind: 'hero', p: side }, amount, ev, 'lifesteal');
    ev.push({ t: 'lifesteal', iid: unit.iid, amount });
  }
}

// gm13 Soul Harvest / gmc6 Soul Transfer need target stats captured before destroy
function precaptureHp(state, ops, ctx) {
  if (ops.some((o) => o.amountFromTargetHp) && ctx.chosen && ctx.chosen.kind === 'unit') {
    const f = unitByIid(state, ctx.chosen.iid);
    if (f) ctx._capturedHp = Math.max(0, f.unit.hp);
  }
  if (ops.some((o) => o.amountFromCapturedAtk) && ctx.chosen && ctx.chosen.kind === 'unit') {
    const f = unitByIid(state, ctx.chosen.iid);
    if (f) ctx._capturedAtk = effAtk(state, f.side, f.unit);
  }
}

// ─────────────────────────── target validation ───────────────────────────

export function validTargets(state, side, spec) {
  // returns [{kind:'unit',iid}|{kind:'hero',p}] matching a card's target spec
  const foe = opponentOf(side);
  const out = [];
  const f = spec.filter || {};
  const unitOk = (u, uSide) => {
    if (u.hp <= 0) return false;
    if (uSide !== side && u.stealth && !u.silenced) return false; // enemy stealth untargetable
    if (f.maxCost != null && cardById(u.card).cost > f.maxCost) return false;
    if (f.minAtk != null && effAtk(state, uSide, u) < f.minAtk) return false;
    if (f.minHp != null && u.hp < f.minHp) return false;
    if (f.damaged && u.hp >= u.maxHp) return false;
    return true;
  };
  const pushUnits = (p) => { for (const u of state.players[p].board) if (unitOk(u, p)) out.push({ kind: 'unit', iid: u.iid }); };
  switch (spec.kind) {
    case 'any': pushUnits(side); pushUnits(foe); out.push({ kind: 'hero', p: side }, { kind: 'hero', p: foe }); break;
    case 'creature': pushUnits(side); pushUnits(foe); break;
    case 'enemy-creature': pushUnits(foe); break;
    case 'friendly-creature': pushUnits(side); break;
    case 'friendly-any': pushUnits(side); out.push({ kind: 'hero', p: side }); break;
    default: throw new Error('unknown target kind: ' + spec.kind);
  }
  return out;
}

// ─────────────────────────── legal actions ───────────────────────────

export function legalActions(state) {
  if (state.winner !== null) return [];
  const side = state.active;
  const pl = state.players[side];
  const foe = state.players[opponentOf(side)];
  const acts = [];

  // plays
  for (const h of pl.hand) {
    const def = cardById(h.card);
    if (def.cost > pl.mana) continue;
    if (def.type === 'creature') {
      if (state.phase !== 'main') continue;
      if (pl.board.length >= MAX_BOARD) continue;
      if (def.target) {
        const tgts = validTargets(state, side, def.target);
        for (const t of tgts) acts.push({ type: 'play', iid: h.iid, target: t });
        if (def.target.optional || tgts.length === 0) acts.push({ type: 'play', iid: h.iid });
      } else {
        acts.push({ type: 'play', iid: h.iid });
      }
    } else if (def.type === 'spell') {
      if (def.target2) {
        // two-target spell (Predator's Pounce)
        const t1s = validTargets(state, side, def.target);
        const t2s = validTargets(state, side, def.target2);
        for (const t1 of t1s) for (const t2 of t2s) acts.push({ type: 'play', iid: h.iid, target: t1, target2: t2 });
      } else if (def.target) {
        for (const t of validTargets(state, side, def.target)) acts.push({ type: 'play', iid: h.iid, target: t });
      } else {
        acts.push({ type: 'play', iid: h.iid });
      }
    } else if (def.type === 'trap') {
      if (pl.traps.length >= MAX_TRAPS) continue;
      acts.push({ type: 'play', iid: h.iid });
    }
  }

  // attacks (combat phase)
  if (state.phase === 'combat') {
    const guards = foe.board.filter((u) => hasKw(u, 'guard') && !(u.stealth && !u.silenced));
    for (const u of pl.board) {
      if (u.tapped || u.frozen) continue;
      if (u.sick && !hasKw(u, 'swift')) continue;
      if (effAtk(state, side, u) <= 0) continue;
      const attackerFlying = hasKw(u, 'flying');
      const canHit = (d) => {
        if (d.stealth && !d.silenced) return false;
        const dFly = hasKw(d, 'flying') && !d.tapped && !hasKw(d, 'guard');
        if (dFly && !attackerFlying) return false;
        return true;
      };
      if (guards.length) {
        for (const g of guards) if (canHit(g)) acts.push({ type: 'attack', attacker: u.iid, target: { kind: 'unit', iid: g.iid } });
        // if no guard is legally attackable by this attacker, it may attack normally
        if (!guards.some(canHit)) {
          for (const d of foe.board) if (canHit(d) && !hasKw(d, 'guard')) acts.push({ type: 'attack', attacker: u.iid, target: { kind: 'unit', iid: d.iid } });
          acts.push({ type: 'attack', attacker: u.iid, target: { kind: 'hero', p: opponentOf(side) } });
        }
      } else {
        for (const d of foe.board) if (canHit(d)) acts.push({ type: 'attack', attacker: u.iid, target: { kind: 'unit', iid: d.iid } });
        acts.push({ type: 'attack', attacker: u.iid, target: { kind: 'hero', p: opponentOf(side) } });
      }
    }
  }

  if (state.phase === 'main') acts.push({ type: 'combat' });
  acts.push({ type: 'end' });
  return acts;
}

// ─────────────────────────── apply action ───────────────────────────

export function applyAction(state, action) {
  if (state.winner !== null) throw new Error('game over');
  const ev = [];
  const side = state.active;
  const pl = state.players[side];

  switch (action.type) {
    case 'play': {
      const hi = pl.hand.findIndex((h) => h.iid === action.iid);
      if (hi < 0) throw new Error('card not in hand');
      const h = pl.hand[hi];
      const def = cardById(h.card);
      if (def.cost > pl.mana) throw new Error('not enough mana');
      if (def.type === 'creature' && state.phase !== 'main') throw new Error('creatures only in main phase');
      if (def.type === 'creature' && pl.board.length >= MAX_BOARD) throw new Error('board full');
      if (def.type === 'trap' && pl.traps.length >= MAX_TRAPS) throw new Error('trap limit');
      // validate chosen targets
      const vt = (spec, t) => t && validTargets(state, side, spec).some((x) => (x.kind === 'unit' ? t.kind === 'unit' && x.iid === t.iid : t.kind === 'hero' && x.p === t.p));
      if (def.target && action.target && !vt(def.target, action.target)) throw new Error('bad target');
      if (def.target && !def.target.optional && def.type === 'spell' && !action.target) throw new Error('target required');
      if (def.target2 && (!action.target2 || !vt(def.target2, action.target2))) throw new Error('bad second target');

      pl.hand.splice(hi, 1);
      pl.mana -= def.cost;
      ev.push({ t: 'mana', p: side, mana: pl.mana, manaMax: pl.manaMax });

      if (def.type === 'creature') {
        const u = makeUnit(state, h.card);
        const slot = action.slot != null ? Math.max(0, Math.min(pl.board.length, action.slot)) : pl.board.length;
        pl.board.splice(slot, 0, u);
        ev.push({ t: 'play-creature', p: side, iid: u.iid, card: h.card, slot, handIid: h.iid });
        // rally fires unless the card wanted a target and none was chosen
        if (def.rally && def.rally.length && (!def.target || action.target)) {
          const ctx = { side, selfUnit: u, chosen: action.target || null, card: def };
          ev.push({ t: 'rally', iid: u.iid });
          precaptureHp(state, def.rally, ctx);
          resolveOps(state, def.rally, ctx, ev);
        }
        recomputeAuraKw(state); // a new creature may grant, or newly receive, keyword auras
      } else if (def.type === 'spell') {
        ev.push({ t: 'play-spell', p: side, card: h.card, handIid: h.iid, target: action.target || null });
        // counterspell traps
        const { negated } = fireTraps(state, opponentOf(side), 'enemy-spell', { card: h.card }, ev);
        if (negated) {
          ev.push({ t: 'negate', card: h.card });
          pl.grave.push(h.card);
        } else {
          const ctx = { side, selfUnit: null, chosen: action.target || null, chosen2: action.target2 || null, card: def };
          precaptureHp(state, def.fx, ctx);
          resolveOps(state, def.fx, ctx, ev);
          pl.grave.push(h.card);
          fireSpellwatch(state, side, ev); // Overcharge — friendly units that react to your spells
        }
      } else if (def.type === 'trap') {
        pl.traps.push({ iid: h.iid, card: h.card });
        ev.push({ t: 'play-trap', p: side, iid: h.iid });
      }
      break;
    }

    case 'attack': {
      if (state.phase !== 'combat') throw new Error('attacks only in combat phase');
      const found = unitByIid(state, action.attacker);
      if (!found || found.side !== side) throw new Error('bad attacker');
      const attacker = found.unit;
      if (attacker.tapped || attacker.frozen) throw new Error('attacker tapped/frozen');
      if (attacker.sick && !hasKw(attacker, 'swift')) throw new Error('summoning sickness');
      // legality via legalActions (guards/flying/stealth)
      const legal = legalActions(state).some((a) => a.type === 'attack' && a.attacker === action.attacker &&
        (a.target.kind === 'unit' ? action.target.kind === 'unit' && a.target.iid === action.target.iid
                                  : action.target.kind === 'hero' && a.target.p === action.target.p));
      if (!legal) throw new Error('illegal attack target');

      const foeSide = opponentOf(side);
      ev.push({ t: 'attack-declared', attacker: attacker.iid, target: action.target });

      // defender traps fire on declaration
      fireTraps(state, foeSide, 'creature-attacked', { attackerIid: attacker.iid }, ev);
      if (action.target.kind === 'hero') fireTraps(state, foeSide, 'hero-attacked', { attackerIid: attacker.iid }, ev);

      // attack may have been neutralized by traps
      const stillThere = unitByIid(state, attacker.iid);
      if (!stillThere || attacker.frozen || attacker.hp <= 0) {
        ev.push({ t: 'attack-fizzle', attacker: attacker.iid });
        break;
      }
      let targetUnit = null;
      if (action.target.kind === 'unit') {
        const tf = unitByIid(state, action.target.iid);
        if (!tf) { ev.push({ t: 'attack-fizzle', attacker: attacker.iid }); break; }
        targetUnit = tf.unit;
      }

      // tap + break stealth
      attacker.tapped = true;
      if (attacker.stealth) { attacker.stealth = false; attacker.kw = attacker.kw.filter((k) => k !== 'stealth'); ev.push({ t: 'stealth-break', iid: attacker.iid }); }
      ev.push({ t: 'tap', iid: attacker.iid });

      const atk = effAtk(state, side, attacker);
      if (action.target.kind === 'hero') {
        ev.push({ t: 'combat', attacker: attacker.iid, target: action.target });
        damageHero(state, action.target.p, atk, ev, { source: 'combat', sourceIid: attacker.iid });
        applyLifesteal(state, side, attacker, atk, ev);
      } else {
        const defBoard = state.players[foeSide].board;
        const ti = defBoard.indexOf(targetUnit);
        const retAtk = effAtk(state, foeSide, targetUnit);
        const targetHpBefore = targetUnit.hp;
        ev.push({ t: 'combat', attacker: attacker.iid, target: action.target });
        // attacker hits target (+cleave neighbors)
        damageUnit(state, foeSide, targetUnit, atk, ev, { source: 'combat', sourceIid: attacker.iid, venomous: hasKw(attacker, 'venomous') });
        let dealt = atk;
        if (hasKw(attacker, 'cleave')) {
          for (const ni of [ti - 1, ti + 1]) {
            const n = defBoard[ni];
            if (n && n !== targetUnit) {
              damageUnit(state, foeSide, n, atk, ev, { source: 'cleave', sourceIid: attacker.iid, venomous: hasKw(attacker, 'venomous') });
              dealt += atk;
            }
          }
        }
        // piercing overflow
        if (hasKw(attacker, 'piercing') && (targetUnit.hp <= 0 || targetUnit._venomed)) {
          const excess = atk - targetHpBefore;
          if (excess > 0) {
            ev.push({ t: 'pierce', attacker: attacker.iid, amount: excess });
            damageHero(state, foeSide, excess, ev, { source: 'pierce', sourceIid: attacker.iid });
          }
        }
        // retaliation
        damageUnit(state, side, attacker, retAtk, ev, { source: 'retaliation', sourceIid: targetUnit.iid, venomous: hasKw(targetUnit, 'venomous') });
        applyLifesteal(state, side, attacker, dealt, ev);
        applyLifesteal(state, foeSide, targetUnit, retAtk, ev);
        // defender-side vengeance traps
        const targetDied = targetUnit.hp <= 0 || targetUnit._venomed;
        if (targetDied) fireTraps(state, foeSide, 'friendly-killed-by-attack', { attackerIid: attacker.iid }, ev);
      }
      // extra attacks (Chronarch Vex)
      if (attacker.hp > 0 && !attacker._venomed && !attacker._destroyed && attacker.extraAttacks > 0 && attacker.tapped) {
        attacker.extraAttacks -= 1;
        attacker.tapped = false;
        ev.push({ t: 'untap', iid: attacker.iid, extra: true });
      }
      reapDeaths(state, ev);
      break;
    }

    case 'combat': {
      if (state.phase !== 'main') throw new Error('not in main phase');
      state.phase = 'combat';
      ev.push({ t: 'phase', phase: 'combat' });
      break;
    }

    case 'end': {
      ev.push({ t: 'turn-end', p: side });
      state.active = opponentOf(side);
      beginTurn(state, ev);
      break;
    }

    case 'concede': {
      state.winner = opponentOf(side);
      ev.push({ t: 'win', winner: state.winner, reason: 'concede' });
      break;
    }

    default: throw new Error('unknown action: ' + action.type);
  }

  checkWin(state, ev);
  return ev;
}

// ─────────────────────────── cloning (for AI) ───────────────────────────

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

// strip hidden info so the AI can't cheat: enemy hand/deck contents & trap identities
export function aiView(state, aiSide) {
  const v = cloneState(state);
  const foe = v.players[opponentOf(aiSide)];
  foe.hand = foe.hand.map((h, i) => ({ iid: -1000 - i, card: 'nt01' })); // opaque placeholders
  foe.deck = foe.deck.map(() => 'nt01');
  foe.traps = foe.traps.map((t, i) => ({ iid: -2000 - i, card: '__unknown_trap__', unknown: true }));
  return v;
}

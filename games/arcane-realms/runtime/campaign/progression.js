// Arcane Realms TCG — progression: card ownership, gold, campaign saves,
// achievements, Arcane Packs, card backs. All state lives in Store.data
// (localStorage) and is validated/covered by selftest.

import { CARDS, COLLECTIBLE, EXPANSION_IDS, cardById } from '../sim/cards.js?v=23';
import { STARTER_DECKS } from '../sim/decks.js?v=23';
import { CHAPTERS, ACHIEVEMENTS, CARDBACK_INFO, PACK_COST, PACK_SIZE, PACK_WEIGHTS, DUPE_FACTOR, SELL_VALUES, allBattles } from './campaign_data.js?v=23';

export { PACK_COST, PACK_SIZE, SELL_VALUES };
export function sellValue(rarity) { return SELL_VALUES[rarity] ?? 5; }

// ── setup / migration ────────────────────────────────────────────
export function initProgress(store) {
  const d = store.data;
  if (!d.owned) {
    d.owned = {};
    // the full BASE set is owned from the start (starter decks + pvp fully
    // playable); the 60-card expansion unlocks through the campaign
    for (const c of COLLECTIBLE) if (!EXPANSION_IDS.has(c.id)) d.owned[c.id] = 1;
  }
  // migrate legacy boolean ownership → copy counts (needed for duplicates + selling)
  for (const k in d.owned) if (d.owned[k] === true) d.owned[k] = 1;
  d.gold = d.gold ?? 0;
  d.battlesWon = d.battlesWon || {};        // battleId -> winCount
  d.achievements = d.achievements || {};    // achId -> true (claimed)
  d.cardbacks = d.cardbacks || { default: true };
  d.cardback = d.cardback || 'default';
  d.campaignWins = d.campaignWins ?? 0;     // total campaign victories (incl repeats)
  store.save();
  return d;
}

export function isOwned(store, cardId) {
  return !!store.data.owned[cardId];
}
export function copiesOf(store, cardId) {
  const v = store.data.owned[cardId];
  return v === true ? 1 : (v || 0);
}
export function ownedCount(store) {
  return Object.keys(store.data.owned).length;
}
// total duplicate copies across the collection (extras beyond the first of each) —
// drives the "sellable dupes" hint in the collection header.
export function dupeCount(store) {
  let n = 0;
  for (const k in store.data.owned) n += Math.max(0, copiesOf(store, k) - 1);
  return n;
}

// sell one duplicate copy for gold. Only extras (copies ≥ 2) can be sold, so the
// collection count never regresses and no saved deck can break.
export function sellCard(store, cardId) {
  const c = cardById(cardId);
  if (!c) return { ok: false, reason: 'Unknown card.' };
  const n = copiesOf(store, cardId);
  if (n <= 1) return { ok: false, reason: 'Only duplicate copies can be sold.' };
  const gold = sellValue(c.rarity);
  store.data.owned[cardId] = n - 1;
  store.data.gold = (store.data.gold || 0) + gold;
  store.save();
  return { ok: true, gold, copies: n - 1 };
}

// battle availability: chapter N unlocks when chapter N-1's boss is beaten;
// battle M in a chapter unlocks when battle M-1 is beaten
export function battleState(store, chapterIdx, battleIdx) {
  const d = store.data;
  const ch = CHAPTERS[chapterIdx];
  const b = ch.battles[battleIdx];
  if (d.battlesWon[b.id]) return 'won';
  if (battleIdx > 0 && !d.battlesWon[ch.battles[battleIdx - 1].id]) return 'locked';
  if (chapterIdx > 0) {
    const prevBoss = CHAPTERS[chapterIdx - 1].battles.at(-1);
    if (!store.data.battlesWon[prevBoss.id]) return 'locked';
  }
  return 'open';
}

export function campaignSummary(store) {
  const d = store.data;
  const cleared = allBattles().filter((b) => d.battlesWon[b.id]).length;
  return { cleared, total: allBattles().length, gold: d.gold };
}

// ── rewards ──────────────────────────────────────────────────────
// returns {gold, newCards:[ids], dupes:[ids], cardback|null, firstClear}
export function grantBattleRewards(store, battle) {
  const d = store.data;
  const firstClear = !d.battlesWon[battle.id];
  d.battlesWon[battle.id] = (d.battlesWon[battle.id] || 0) + 1;
  d.campaignWins += 1;
  const out = { gold: 0, newCards: [], dupes: [], cardback: null, firstClear, packCards: [] };
  if (firstClear) {
    out.gold = battle.rewards.gold;
    for (const id of battle.rewards.cards || []) {
      if (!d.owned[id]) { d.owned[id] = 1; out.newCards.push(id); }
      else { d.owned[id] = copiesOf(store, id) + 1; out.dupes.push(id); }
    }
    for (let i = 0; i < (battle.rewards.pack || 0); i++) out.packCards.push(...rollPack(store, 2).map((c) => c.id));
    if (battle.rewards.cardback && !d.cardbacks[battle.rewards.cardback]) {
      d.cardbacks[battle.rewards.cardback] = true;
      out.cardback = battle.rewards.cardback;
    }
  } else {
    out.gold = Math.max(20, Math.round(battle.rewards.gold * 0.3)); // replay reward
  }
  d.gold += out.gold;
  store.save();
  return out;
}

// rarity-weighted pick from `pool`; owned cards get DUPE_FACTOR weight so they
// appear only occasionally (as sellable duplicates).
function weightedPick(pool, d) {
  let total = 0;
  const weighted = pool.map((c) => {
    total += (PACK_WEIGHTS[c.rarity] || 1) * (d.owned[c.id] ? DUPE_FACTOR : 1);
    return [total, c];
  });
  const roll = Math.random() * total;
  return weighted.find(([t]) => roll < t)[1];
}

// A pack of expansion cards. The FIRST slot is a "pity" slot — guaranteed to be a
// brand-new card while any remain — so a pack never disappoints. The remaining
// slots roll from the whole expansion with unowned heavily favoured, letting
// duplicates trickle in as the set fills. Returns [{id, isNew, rarity}].
export function rollPack(store, count = PACK_SIZE) {
  const d = store.data;
  const expansion = COLLECTIBLE.filter((c) => EXPANSION_IDS.has(c.id));
  const out = [];
  for (let i = 0; i < count; i++) {
    const unowned = expansion.filter((c) => !d.owned[c.id]);
    let pick;
    if (i === 0 && unowned.length) pick = weightedPick(unowned, d); // pity: guaranteed new
    else if (expansion.length) pick = weightedPick(expansion, d);
    else break;
    const isNew = !d.owned[pick.id];
    d.owned[pick.id] = copiesOf(store, pick.id) + 1;
    out.push({ id: pick.id, isNew, rarity: pick.rarity });
  }
  store.save();
  return out;
}

// returns {ok, cards:[{id,isNew,rarity,dupGold}]} — dupGold is the sell-back value
// shown on duplicate reveals.
export function buyPack(store) {
  const d = store.data;
  if (d.gold < PACK_COST) return { ok: false, reason: `Needs ${PACK_COST} gold.` };
  const unowned = COLLECTIBLE.filter((c) => EXPANSION_IDS.has(c.id) && !d.owned[c.id]);
  if (!unowned.length) return { ok: false, reason: 'Collection complete — no new cards to find!' };
  d.gold -= PACK_COST;
  const cards = rollPack(store, PACK_SIZE).map((c) => ({ ...c, dupGold: c.isNew ? 0 : sellValue(c.rarity) }));
  store.save();
  return { ok: true, cards };
}

// ── achievements ─────────────────────────────────────────────────
function progressSnapshot(store) {
  const d = store.data;
  const ownedDefs = Object.keys(d.owned).map((id) => CARDS[id]).filter(Boolean);
  return {
    campaignWins: d.campaignWins || 0,
    battlesCleared: Object.keys(d.battlesWon).length,
    totalWins: (d.record?.wins || 0),
    raresOwned: ownedDefs.filter((c) => c.rarity === 'rare').length,
    epicsOwned: ownedDefs.filter((c) => c.rarity === 'epic').length,
    legendariesOwned: ownedDefs.filter((c) => c.rarity === 'legendary').length,
  };
}

// returns newly-completed achievements with their granted rewards
export function checkAchievements(store) {
  const d = store.data;
  const snap = progressSnapshot(store);
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (d.achievements[a.id]) continue;
    if (!a.check(snap)) continue;
    d.achievements[a.id] = true;
    const grant = { id: a.id, name: a.name, desc: a.desc, gold: a.rewards.gold || 0, cards: [], cardback: null };
    d.gold += grant.gold;
    for (const id of a.rewards.cards || []) {
      if (!d.owned[id]) { d.owned[id] = 1; grant.cards.push(id); }
    }
    if (a.rewards.cardback && !d.cardbacks[a.rewards.cardback]) {
      d.cardbacks[a.rewards.cardback] = true;
      grant.cardback = a.rewards.cardback;
    }
    unlocked.push(grant);
  }
  if (unlocked.length) store.save();
  return unlocked;
}

export function achievementList(store) {
  const snap = progressSnapshot(store);
  return ACHIEVEMENTS.map((a) => ({
    ...a, done: !!store.data.achievements[a.id], met: a.check(snap),
  }));
}

// ── campaign battle mods (applied to a freshly-created engine state) ──
// state is pure data, so campaign twists are simple mutations before render.
export function applyBattleMods(state, battle, enemySide, makeUnit) {
  const mods = battle.mods || {};
  const en = state.players[enemySide];
  if (mods.enemyHp) { en.hp = mods.enemyHp; en.maxHp = mods.enemyHp; }
  if (mods.extraCards) {
    for (let i = 0; i < mods.extraCards; i++) {
      const cardId = en.deck.pop();
      if (cardId) en.hand.push({ iid: state.iid++, card: cardId });
    }
  }
  if (mods.enemyBoard) {
    for (const tok of mods.enemyBoard) {
      const u = makeUnit(state, tok);
      u.sick = false;
      en.board.push(u);
    }
  }
  if (mods.tempManaStart) {
    // the commander's first turns run hot
    en.manaMax = Math.min(10, en.manaMax + mods.tempManaStart);
    en.mana = en.manaMax;
  }
  return state;
}

// selftest support: everything in the expansion must be obtainable
export function unlockCoverage() {
  const granted = new Set();
  for (const b of allBattles()) for (const id of b.rewards.cards || []) granted.add(id);
  for (const a of ACHIEVEMENTS) for (const id of a.rewards.cards || []) granted.add(id);
  const packOnly = [...EXPANSION_IDS].filter((id) => !granted.has(id));
  return { granted: [...granted], packOnly };
}

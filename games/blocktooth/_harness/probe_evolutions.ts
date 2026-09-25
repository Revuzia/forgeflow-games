// BLOCKTOOTH v2 — lane L2 probe: evolutions, banish, lock, v2 draft rules (FEATURES_V2 §7, §15.3).
// Run: node _harness/probe_evolutions.ts   (Node 22+ strips types). THREE-free. Exit 0 ok, 1 failure.
//
//   1. every recipe: ready → offered (chest: slot 0, or slot 1 behind a held card, no extra draw;
//      level-up: exactly ONE extra rng.loot draw, evo in slot 2 exactly when that draw < evoDraftChance)
//   2. taking it: evo replaces the base (owned + order), companion kept, every base stat ≥ its maxed-base
//      value, tally.evolutions
//   3. re-take cases: after evolving, the base is never offered again (level-up + chest, 400 rolls) and
//      evolutionsReady never lists an owned evolution (even with the base artificially re-maxed)
//   4. lock: held card → slot 0 next draft (HELD FROM LAST REPORT), dedupe (held id also rolled → that
//      slot re-rolled once, +1 draw), reroll keeps the held slot, charges + refunds, move, pick clears,
//      an ineligible held card is dropped without refund, a held evolution is delivered while ready
//   5. banish: refill in place (1 draw, avoids the offer), empty refill shrinks the offer, the last card
//      of a 1-card offer is refused (state untouched), charges, banishing the held card refunds its lock,
//      a banished evolution is never ready
//   6. tally counters: rerolls, banishes, locks, evolutions
//   7. unlock filter: a fresh profile never sees a locked card or locked evolution; a full profile sees
//      every locked card of its titan
//   8. no evolution ready and nothing held ⇒ exactly the pre-v2 rng.loot draw count (one per offered card)
//   9. determinism of a scripted draft session with banish / lock / reroll / evolve

import type { TitanId, UpgradeDef, World } from '../src/core/types.ts';

const WM = await import('../src/core/world.ts');
const DR = await import('../src/upgrades/draft.ts');
const EN = await import('../src/upgrades/engine.ts');
const { UPGRADES, UPGRADE_BY_ID } = await import('../src/data/upgrades.ts');
const { EVOLUTIONS } = await import('../src/data/evolutions.ts');
const { DRAFT_V2 } = await import('../src/core/config.ts');
const { TITAN_IDS } = await import('../src/core/types.ts');
const { STAT_KEYS } = await import('../src/upgrades/stats.ts');

const { rollOffer, rerollOffer, pickUpgrade, hasPendingDraft, isEligible, banishCard, lockCard, evolutionsReady, deliveredHold } = DR;
const { applyUpgrade } = EN;

let fails = 0, passes = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) passes++;
  else { fails++; console.log(`  FAIL  ${msg}`); }
}
function section(t: string): void { console.log(`\n== ${t} ==`); }

const LOCKED_IDS = UPGRADES.filter((u) => u.locked).map((u) => u.id).sort();

/** Fresh world, no spawns. `full` = every locked card unlocked (w.meta is read-only for the sim, but the
 *  probe sets it directly so it does not depend on meta/perks.ts sanitizeRunMeta). */
function fresh(tid: TitanId, seed = 11, full = false): World {
  const w = WM.createWorld({ titan: tid, biome: 'grideast', seed });
  w.cheats.noSpawns = true;
  w.events.length = 0;
  w.meta.unlocked = full ? LOCKED_IDS.slice() : [];
  return w;
}
/** Count rng.loot draws (and remember the values) from now on. */
function countLoot(w: World): { n: number; vals: number[] } {
  const c = { n: 0, vals: [] as number[] };
  const f = w.rng.loot;
  w.rng.loot = () => { const v = f(); c.n++; c.vals.push(v); return v; };
  return c;
}
function maxOut(w: World, id: string): void {
  const u = UPGRADE_BY_ID[id];
  for (let i = 0; i < u.maxStacks; i++) applyUpgrade(w, id);
}
function setRecipe(w: World, evoId: string): void {
  const e = UPGRADE_BY_ID[evoId];
  maxOut(w, e.evo!.base);
  if ((w.upgrades.owned[e.evo!.with] ?? 0) < 1) applyUpgrade(w, e.evo!.with);
}
const titanOf = (u: UpgradeDef): TitanId => u.titan ?? 'molo';
const distinct = (a: readonly string[]): boolean => new Set(a).size === a.length;

// ═══════════════════════════════ 1–3. every recipe ═══════════════════════════════
section('1-3. EVOLUTIONS: ready → offered → taken → never again');
{
  const lines: string[] = [];
  let lvHits = 0, lvTrials = 0;
  for (const r of EVOLUTIONS) {
    const e = UPGRADE_BY_ID[r.id];
    const tid = titanOf(e);
    const full = !!e.locked;

    // not ready before the recipe; locked evo not ready on a fresh profile even with the recipe
    {
      const w = fresh(tid, 31, full);
      ok(!evolutionsReady(w).includes(r.id), `${r.id}: not ready on an empty build`);
      maxOut(w, r.base);
      ok(!evolutionsReady(w).includes(r.id), `${r.id}: not ready without the companion ${r.with}`);
      if (e.locked) {
        const wf = fresh(tid, 31, false);
        setRecipe(wf, r.id);
        ok(!evolutionsReady(wf).includes(r.id), `${r.id}: locked evolution not ready on a fresh profile`);
      }
    }

    // CHEST draft: slot 0, no extra draw
    {
      const w = fresh(tid, 41, full);
      setRecipe(w, r.id);
      ok(evolutionsReady(w)[0] === r.id, `${r.id}: ready once ${r.base} is maxed and ${r.with} owned`);
      w.upgrades.chestDrafts = 1;
      const c = countLoot(w);
      const o = rollOffer(w, true);
      ok(o[0] === r.id && distinct(o) && o.length === 3, `${r.id}: chest draft → slot 0 (${o.join(',')})`);
      ok(c.n === 3, `${r.id}: chest evo costs no extra draw (${c.n} draws = the 3 rolled cards)`);
      // take it
      const T = w.titan;
      const beforeStats: Record<string, number> = {};
      const baseDef = UPGRADE_BY_ID[r.base];
      const baseStats = [...new Set(baseDef.effects.filter((x) => !!x.stat).map((x) => x.stat!))];
      for (const k of STAT_KEYS) beforeStats[k] = T.stats[k];
      const orderIdx = w.upgrades.order.indexOf(r.base);
      const ev0 = w.tally.evolutions;
      pickUpgrade(w, r.id);
      ok(w.upgrades.owned[r.id] === 1 && !(r.base in w.upgrades.owned), `${r.id}: taking it deletes owned[${r.base}]`);
      ok(w.upgrades.order.indexOf(r.id) === orderIdx && !w.upgrades.order.includes(r.base) && w.upgrades.order.filter((x) => x === r.id).length === 1,
        `${r.id}: evo id replaces the base in pick order (slot ${orderIdx})`);
      ok((w.upgrades.owned[r.with] ?? 0) >= 1, `${r.id}: companion ${r.with} kept`);
      ok(w.tally.evolutions === ev0 + 1, `${r.id}: tally.evolutions +1`);
      ok(w.upgrades.chestDrafts === 0 && w.upgrades.offer === null, `${r.id}: the pick consumed the chest draft`);
      const worse = baseStats.filter((k) => T.stats[k] < beforeStats[k] - 1e-9);
      ok(worse.length === 0, `${r.id}: every base stat ≥ maxed base (${baseStats.map((k) => `${k} ${beforeStats[k].toFixed(2)}→${T.stats[k].toFixed(2)}`).join(', ')})`);
      ok(T.hp > 0 && T.hp <= T.maxHp && Number.isFinite(T.hp), `${r.id}: HP sane after evolving (${T.hp.toFixed(1)}/${T.maxHp.toFixed(1)})`);
      lines.push(`${r.id.padEnd(28)} ${tid.padEnd(10)} ${baseStats.map((k) => `${k} ${beforeStats[k].toFixed(2)}→${T.stats[k].toFixed(2)}`).join(', ') || '(trigger-only base)'}`);

      // 3. re-take cases
      ok(!isEligible(w, UPGRADE_BY_ID[r.base]), `${r.id}: base ${r.base} no longer eligible`);
      ok(!evolutionsReady(w).includes(r.id), `${r.id}: evolutionsReady never lists the owned evolution`);
      let baseSeen = 0, evoSeen = 0;
      for (let i = 0; i < 400; i++) {
        w.upgrades.offer = null;
        const o2 = rollOffer(w, i % 2 === 0);
        if (o2.includes(r.base)) baseSeen++;
        if (o2.includes(r.id)) evoSeen++;
      }
      ok(baseSeen === 0 && evoSeen === 0, `${r.id}: after evolving, 400 drafts never offer ${r.base} (${baseSeen}) or the evo (${evoSeen})`);
      // even with the base artificially re-maxed, the owned evo is never ready again
      w.upgrades.owned[r.base] = baseDef.maxStacks;
      ok(!evolutionsReady(w).includes(r.id), `${r.id}: re-maxed base does not make the owned evo ready again`);
    }

    // CHEST draft behind a held card: slot 1
    {
      const w = fresh(tid, 43, full);
      setRecipe(w, r.id);
      w.upgrades.pendingDrafts = 1;
      // open a level-up draft whose evo draw is forced high, lock a card, pick another
      const o1 = rollOffer(w, false);
      const cand = o1.filter((id) => id !== r.id);
      const held = cand[cand.length - 1];
      ok(lockCard(w, held) === true && w.upgrades.locked === held, `${r.id}: lock ${held}`);
      pickUpgrade(w, cand[0] === held ? cand[1] : cand[0]);
      if (!evolutionsReady(w).includes(r.id)) setRecipe(w, r.id);    // the pick may not touch the recipe; keep it ready
      w.upgrades.chestDrafts = 1;
      const o2 = rollOffer(w, true);
      const heldOk = isEligible(w, UPGRADE_BY_ID[held]);
      if (heldOk) ok(o2[0] === held && o2[1] === r.id && distinct(o2), `${r.id}: chest with a held card → held slot 0, evo slot 1 (${o2.join(',')})`);
      else ok(o2[0] === r.id, `${r.id}: held card no longer eligible → evo slot 0 (${o2.join(',')})`);
      ok(w.upgrades.locked === null, `${r.id}: the hold is delivered (cleared)`);
    }

    // LEVEL-UP draft: exactly one extra draw; evo in slot 2 iff that draw < evoDraftChance
    for (let s = 0; s < 40; s++) {
      const w = fresh(tid, 1000 + s * 7, full);
      setRecipe(w, r.id);
      w.upgrades.pendingDrafts = 1;
      const c = countLoot(w);
      const o = rollOffer(w, false);
      const hit = o.includes(r.id);
      const rolledCards = o.length;                            // slot 2 replaced on a hit: that rolled card is discarded
      const last = c.vals[c.vals.length - 1];
      lvTrials++;
      if (hit) lvHits++;
      ok(c.n === rolledCards + 1, `${r.id} seed ${s}: level-up with an evo ready = one extra draw (${c.n} vs ${rolledCards}+1)`);
      ok(hit === (last < DRAFT_V2.evoDraftChance) && (!hit || o[2] === r.id), `${r.id} seed ${s}: evo in slot 2 exactly when the extra draw < ${DRAFT_V2.evoDraftChance} (draw ${last.toFixed(3)}, offer ${o.join(',')})`);
      ok(distinct(o), `${r.id} seed ${s}: offer distinct`);
    }
  }
  console.log(lines.join('\n'));
  const share = lvHits / lvTrials;
  console.log(`level-up drafts with an evolution ready: evo offered in ${lvHits}/${lvTrials} = ${(100 * share).toFixed(1)} % (evoDraftChance ${DRAFT_V2.evoDraftChance})`);
  ok(Math.abs(share - DRAFT_V2.evoDraftChance) < 0.06, `level-up evo share ≈ evoDraftChance (${(100 * share).toFixed(1)} %)`);
}

// several ready at once: the FIRST in catalogue order is offered
{
  const w = fresh('molo', 5, true);
  setRecipe(w, 'evo_shear_wall_certificate');
  setRecipe(w, 'evo_full_block_bite');
  const rd = evolutionsReady(w);
  ok(rd[0] === 'evo_shear_wall_certificate' && rd.includes('evo_full_block_bite'), `two ready → catalogue order (${rd.join(',')})`);
  w.upgrades.chestDrafts = 1;
  ok(rollOffer(w, true)[0] === 'evo_shear_wall_certificate', 'chest offers the first ready evolution');
  // only an evolution left to offer: hasPendingDraft true and a level-up offer is never empty
  const w2 = fresh('molo', 6);
  setRecipe(w2, 'evo_shear_wall_certificate');
  for (const u of UPGRADES) if (isEligible(w2, u)) w2.upgrades.owned[u.id] = u.maxStacks;
  w2.upgrades.pendingDrafts = 1;
  ok(hasPendingDraft(w2), 'an evolution alone keeps hasPendingDraft true');
  const o = rollOffer(w2, false);
  ok(o.length === 1 && o[0] === 'evo_shear_wall_certificate', `pool empty except the evo → it is offered alone (${o.join(',')})`);
}

// ═══════════════════════════════ 4. LOCK ═══════════════════════════════
section('4. LOCK');
{
  // charges, refund, move, pick clears
  const w = fresh('voltkite', 12);
  w.upgrades.pendingDrafts = 3;
  const o = rollOffer(w);
  const [a, b, c] = o;
  const L0 = w.upgrades.lockLeft;
  ok(L0 === DRAFT_V2.locks && w.upgrades.banishLeft === DRAFT_V2.banishes, `run starts with LOCK ${DRAFT_V2.locks} / BANISH ${DRAFT_V2.banishes}`);
  ok(lockCard(w, a) === true && w.upgrades.locked === a && w.upgrades.lockLeft === L0 - 1 && w.tally.locks === 1, 'lock spends a charge');
  ok(lockCard(w, a) === false && w.upgrades.locked === null && w.upgrades.lockLeft === L0 && w.tally.locks === 0, 'unlocking within the draft refunds it');
  ok(lockCard(w, a) === true && lockCard(w, b) === true && w.upgrades.locked === b && w.upgrades.lockLeft === L0 - 1, 'locking another card moves the hold, no refund, no extra charge');
  ok(lockCard(w, 'no_such_card') === false && w.upgrades.locked === b, 'locking a card not on offer does nothing');
  // pick the held card → hold cleared, no extra charge
  pickUpgrade(w, b);
  ok(w.upgrades.locked === null && w.upgrades.lockLeft === L0 - 1, 'picking the held card clears the hold without spending more');
  // hold c, pick a → next draft delivers c in slot 0
  const o2 = rollOffer(w);
  const held = o2[2];
  lockCard(w, held);
  pickUpgrade(w, o2[0]);
  ok(w.upgrades.lockLeft === 0, 'second lock spent the last charge');
  const o3 = rollOffer(w);
  ok(o3[0] === held && distinct(o3) && w.upgrades.locked === null && deliveredHold(w) === held, `held card arrives in slot 0 of the next draft (${o3.join(',')}), HELD FROM LAST REPORT = ${deliveredHold(w)}`);
  ok(lockCard(w, o3[1]) === false && w.upgrades.locked === null, 'no LOCK charge left → lock refused');
  void c;
}
{
  // dedupe: held id also rolled into slot 1/2 → that slot re-rolled once (+1 draw); tiny pool of 3
  let dupSeen = 0, noDupSeen = 0;
  for (let s = 0; s < 60 && (dupSeen < 3 || noDupSeen < 3); s++) {
    const w = fresh('hearthback', 200 + s);
    for (const r of EVOLUTIONS) w.upgrades.banished.push(r.id);   // maxing the rest must not make a recipe ready
    const keep = UPGRADES.filter((u) => isEligible(w, u) && u.rarity === 'common').slice(0, 4).map((u) => u.id);
    for (const u of UPGRADES) if (isEligible(w, u) && !keep.includes(u.id)) w.upgrades.owned[u.id] = u.maxStacks;
    w.upgrades.pendingDrafts = 2;
    const o1 = rollOffer(w);
    const held = o1[1];
    lockCard(w, held);
    const pickId = o1[0];
    pickUpgrade(w, pickId);
    // a pick does not max a 4-5 stack card; the pool is still `keep`
    const c = countLoot(w);
    const o2 = rollOffer(w);
    const baseDraws = Math.min(3, keep.filter((id) => isEligible(w, UPGRADE_BY_ID[id])).length);
    ok(o2[0] === held && distinct(o2) && o2.length === baseDraws, `seed ${s}: held in slot 0, offer distinct (${o2.join(',')})`);
    const extra = c.n - baseDraws;
    ok(extra === 0 || extra === 1, `seed ${s}: dedupe costs at most one draw (${c.n} for ${baseDraws})`);
    if (extra === 1) dupSeen++; else noDupSeen++;
  }
  console.log(`lock dedupe over a 4-card pool: re-rolled a duplicate ${dupSeen}×, no duplicate ${noDupSeen}×`);
  ok(dupSeen > 0 && noDupSeen > 0, 'both dedupe cases observed (held id also rolled / not rolled)');
}
{
  // reroll keeps the held slot; tally.rerolls
  const w = fresh('briarwick', 21);
  applyUpgrade(w, 'appeals_process');
  w.upgrades.pendingDrafts = 1;
  const o = rollOffer(w);
  const held = o[1];
  lockCard(w, held);
  const r0 = w.tally.rerolls;
  const o2 = rerollOffer(w)!;
  ok(!!o2 && o2[1] === held && o2.length === 3 && distinct(o2) && o2.filter((id) => id !== held).every((id) => !o.includes(id)),
    `reroll keeps the held card in slot 1, others fresh (${o.join(',')} → ${o2.join(',')})`);
  ok(w.tally.rerolls === r0 + 1, 'rerollOffer increments tally.rerolls');
  const o3 = rerollOffer(w)!;
  ok(!!o3 && o3[1] === held && w.tally.rerolls === r0 + 2, 'second reroll keeps it too');
  ok(rerollOffer(w) === null && w.tally.rerolls === r0 + 2, 'no reroll left → null, tally unchanged');
}
{
  // a held card that is no longer eligible (maxed through another path) is dropped, no refund
  const w = fresh('molo', 22);
  w.upgrades.pendingDrafts = 2;
  const o = rollOffer(w);
  lockCard(w, o[2]);
  pickUpgrade(w, o[0]);
  const L = w.upgrades.lockLeft;
  maxOut(w, o[2]);
  const o2 = rollOffer(w);
  ok(!o2.includes(o[2]) && w.upgrades.locked === null && w.upgrades.lockLeft === L, `ineligible held card dropped silently, charge not refunded (${o2.join(',')})`);
}
{
  // a held evolution is delivered while its recipe is ready (and never duplicated by the evo step)
  const w = fresh('molo', 23);
  setRecipe(w, 'evo_shear_wall_certificate');
  w.upgrades.chestDrafts = 1;
  const o = rollOffer(w, true);
  lockCard(w, o[0]);
  pickUpgrade(w, o[1]);
  w.upgrades.pendingDrafts = 1;
  const o2 = rollOffer(w, false);
  ok(o2[0] === 'evo_shear_wall_certificate' && o2.filter((id) => id === 'evo_shear_wall_certificate').length === 1, `held evolution delivered in slot 0 of a level-up draft (${o2.join(',')})`);
}

// ═══════════════════════════════ 5. BANISH ═══════════════════════════════
section('5. BANISH');
{
  const w = fresh('hearthback', 31);
  w.upgrades.pendingDrafts = 1;
  const o = rollOffer(w);
  const c = countLoot(w);
  const n0 = w.upgrades.banishLeft;
  const o2 = banishCard(w, o[1])!;
  ok(!!o2 && o2.length === 3 && o2[0] === o[0] && o2[2] === o[2] && !o.includes(o2[1]) && distinct(o2), `banish refills that slot in place (${o.join(',')} → ${o2 ? o2.join(',') : 'null'})`);
  ok(c.n === 1, `banish refill = one rng.loot draw (${c.n})`);
  ok(w.upgrades.banished.includes(o[1]) && w.upgrades.banishLeft === n0 - 1 && w.tally.banishes === 1 && w.upgrades.offer === o2, 'banish bookkeeping (banished, charge, tally, offer)');
  ok(!isEligible(w, UPGRADE_BY_ID[o[1]]), 'a banished card is out of the pool');
  let seen = 0;
  for (let i = 0; i < 300; i++) { w.upgrades.offer = null; if (rollOffer(w, i % 2 === 0).includes(o[1])) seen++; }
  ok(seen === 0, `banished card never offered again (300 drafts, ${seen})`);
  w.upgrades.offer = null; w.upgrades.pendingDrafts = 1;
  const o3 = rollOffer(w);
  banishCard(w, o3[0]);
  ok(w.upgrades.banishLeft === 0 && banishCard(w, w.upgrades.offer![0]) === null, 'no BANISH charge left → refused');
  ok(banishCard(w, 'no_such_card') === null, 'banishing a card not on offer is refused');
}
{
  // empty refill → offer shrinks; last card refused, state untouched
  const w = fresh('briarwick', 32);
  for (const r of EVOLUTIONS) w.upgrades.banished.push(r.id);   // maxing the rest must not make a recipe ready
  const keep = UPGRADES.filter((u) => isEligible(w, u) && u.rarity === 'common').slice(0, 3).map((u) => u.id);
  for (const u of UPGRADES) if (isEligible(w, u) && !keep.includes(u.id)) w.upgrades.owned[u.id] = u.maxStacks;
  w.upgrades.pendingDrafts = 1;
  w.upgrades.banishLeft = 5;
  const o = rollOffer(w);
  ok(o.length === 3, `3-card pool → 3-card offer (${o.join(',')})`);
  const c = countLoot(w);
  const o2 = banishCard(w, o[1])!;
  ok(!!o2 && o2.length === 2 && o2[0] === o[0] && o2[1] === o[2] && c.n === 0, `empty refill → the slot is removed, no draw (${o2 ? o2.join(',') : 'null'}, ${c.n} draws)`);
  const o3 = banishCard(w, o2[0])!;
  ok(!!o3 && o3.length === 1 && o3[0] === o[2], `second empty refill → 1 card (${o3 ? o3.join(',') : 'null'})`);
  const bl = w.upgrades.banishLeft, bn = w.upgrades.banished.length, tb = w.tally.banishes;
  ok(banishCard(w, o3[0]) === null, 'banishing the last card of a 1-card offer is refused');
  ok(w.upgrades.banishLeft === bl && w.upgrades.banished.length === bn && w.tally.banishes === tb && w.upgrades.offer!.length === 1 && c.n === 0,
    'refused banish leaves charges, banished list, tally and offer untouched');
}
{
  // banishing the held card clears the hold and refunds its lock
  const w = fresh('molo', 33);
  w.upgrades.pendingDrafts = 1;
  const o = rollOffer(w);
  lockCard(w, o[0]);
  const L = w.upgrades.lockLeft;
  banishCard(w, o[0]);
  ok(w.upgrades.locked === null && w.upgrades.lockLeft === L + 1 && w.tally.locks === 0, 'banishing the held card clears the hold and refunds the LOCK charge');
}
{
  // banishing an evolution skips it for the run
  const w = fresh('molo', 34);
  setRecipe(w, 'evo_arterial_bypass');
  w.upgrades.chestDrafts = 1;
  const o = rollOffer(w, true);
  ok(o[0] === 'evo_arterial_bypass', 'evo offered in the chest draft');
  const o2 = banishCard(w, 'evo_arterial_bypass')!;
  ok(!!o2 && !o2.includes('evo_arterial_bypass') && !evolutionsReady(w).includes('evo_arterial_bypass'), `banished evolution no longer ready (${o2 ? o2.join(',') : 'null'})`);
  w.upgrades.offer = null;
  ok(!rollOffer(w, true).includes('evo_arterial_bypass'), 'and never offered again');
}

// ═══════════════════════════════ 7. UNLOCK FILTER ═══════════════════════════════
section('7. UNLOCK FILTER');
for (const tid of TITAN_IDS) {
  const wf = fresh(tid, 51, false), wu = fresh(tid, 51, true);
  (wf.titan as { rank: number }).rank = 2; (wu.titan as { rank: number }).rank = 2;   // minRank-1 unlockables eligible
  const seenF = new Set<string>(), seenU = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    wf.upgrades.offer = null; wu.upgrades.offer = null;
    for (const id of rollOffer(wf, i % 3 === 0)) seenF.add(id);
    for (const id of rollOffer(wu, i % 3 === 0)) seenU.add(id);
  }
  const mine = LOCKED_IDS.filter((id) => { const u = UPGRADE_BY_ID[id]; return !u.evo && (!u.titan || u.titan === tid); });
  const leakF = [...seenF].filter((id) => UPGRADE_BY_ID[id].locked || UPGRADE_BY_ID[id].evo || UPGRADE_BY_ID[id].perk);
  const missU = mine.filter((id) => !seenU.has(id));
  const perkU = [...seenU].filter((id) => UPGRADE_BY_ID[id].evo || UPGRADE_BY_ID[id].perk);
  console.log(`${tid}: fresh profile saw ${seenF.size} ids (locked/evo/perk leaks ${leakF.length}); full profile saw ${mine.length - missU.length}/${mine.length} of its locked cards`);
  ok(leakF.length === 0, `${tid}: fresh profile never rolls a locked, evolution or perk card (${leakF.join(',')})`);
  ok(missU.length === 0, `${tid}: full profile rolls every locked card of its titan (missing ${missU.join(',')})`);
  ok(perkU.length === 0, `${tid}: full profile never rolls an evolution or perk card`);
}

// ═══════════════════════════════ 8. DRAW COUNT ═══════════════════════════════
section('8. NO EVOLUTION READY ⇒ PRE-v2 DRAW COUNT');
{
  let drafts = 0, bad = 0, withEvo = 0;
  for (const tid of TITAN_IDS) {
    const w = fresh(tid, 61);
    const c = countLoot(w);
    for (let i = 0; i < 300; i++) {
      w.upgrades.pendingDrafts = 1;
      const chest = i % 4 === 0;
      if (chest) w.upgrades.chestDrafts = 1;
      const ready = evolutionsReady(w).length > 0;
      const n0 = c.n;
      const o = rollOffer(w, chest);
      if (ready) { withEvo++; pickUpgrade(w, o[0]); continue; }
      drafts++;
      if (c.n - n0 !== o.length) { bad++; if (bad < 4) console.log(`  draws ${c.n - n0} for ${o.length} cards (${tid} draft ${i})`); }
      pickUpgrade(w, o[i % o.length]);
    }
  }
  console.log(`${drafts} drafts with no evolution ready: draws = offered cards in ${drafts - bad}; ${withEvo} drafts had one ready (skipped)`);
  ok(bad === 0 && drafts > 1000, 'no evolution ready and nothing held ⇒ exactly one rng.loot draw per offered card (the pre-v2 count)');
}

// ═══════════════════════════════ 9. DETERMINISM ═══════════════════════════════
section('9. DETERMINISM (scripted session: banish · lock · reroll · evolve)');
{
  const run = (seed: number): string => {
    const w = fresh('voltkite', seed, true);
    applyUpgrade(w, 'appeals_process');
    const log: string[] = [];
    for (let i = 0; i < 60; i++) {
      w.upgrades.pendingDrafts = 1;
      if (i % 5 === 0) w.upgrades.chestDrafts = 1;
      let o = rollOffer(w);
      log.push(o.join('+'));
      if (i % 7 === 3 && w.upgrades.banishLeft > 0) { o = banishCard(w, o[o.length - 1]) ?? o; log.push('B:' + o.join('+')); }
      if (i % 6 === 2) { lockCard(w, o[o.length - 1]); log.push('L:' + String(w.upgrades.locked)); }
      if (i % 4 === 1) { const r = rerollOffer(w); if (r) { o = r; log.push('R:' + o.join('+')); } }
      const evo = o.find((id) => !!UPGRADE_BY_ID[id].evo);
      const pick = evo ?? o.find((id) => id !== w.upgrades.locked) ?? o[0];
      pickUpgrade(w, pick);
    }
    log.push(JSON.stringify(w.upgrades.owned), w.upgrades.order.join(','), JSON.stringify([w.tally.rerolls, w.tally.banishes, w.tally.locks, w.tally.evolutions]));
    return log.join('|');
  };
  const a = run(77), b = run(77), c = run(78);
  ok(a === b, 'same seed ⇒ identical scripted draft session');
  ok(a !== c, 'different seed ⇒ different session');
  const tail = a.split('|').slice(-1)[0];
  console.log(`session seed 77: ${a.length} chars, tally [rerolls, banishes, locks, evolutions] = ${tail}`);
}

// ═══════════════════════════════ 10. REACHABILITY (measured, FEATURES_V2 §7.4.6 / §14) ═══════════════════════════════
// A draft-only model of one run (40 level-up drafts at Size I→V + 2 chest drafts, fresh profile, 120 seeds per
// titan) under two players: CHASE (takes an offered evolution, else the best recipe card — a base it already
// stacks, a base whose companion it owns, any recipe card — rerolls an offer with no recipe card, LOCKs the
// runner-up recipe base) and NONE (takes an offered evolution, else slot 0). The gate bot is closer to NONE
// (its generic scoring spreads picks), so GATE 2 rarely sees an evolution; the numbers are printed for the
// owner / orchestrator. Guard: a chasing player completes a recipe in ≥ 25 % of runs (evolutions are
// reachable at all under the §7.4 rules).
section('10. REACHABILITY (draft-only model)');
{
  const DRAFTS = 40, CHESTS = 2, N = 120;
  const model = (tid: TitanId, chase: boolean): { runs: number; evos: number; first: number[] } => {
    let runs = 0, evos = 0;
    const first: number[] = [];
    for (let s = 0; s < N; s++) {
      const w = fresh(tid, 5000 + s);
      const mine = EVOLUTIONS.filter((r) => { const u = UPGRADE_BY_ID[r.id]; return (!u.titan || u.titan === tid) && !u.locked; });
      const recipe = new Set<string>();
      for (const r of mine) { recipe.add(r.base); recipe.add(r.with); }
      const score = (id: string): number => {
        const u = UPGRADE_BY_ID[id];
        if (u.evo) return 1e6;
        if (!chase) return 0;
        const r = mine.find((x) => x.base === id);
        const own = w.upgrades.owned[id] ?? 0;
        if (r) return 100 + 20 * own + ((w.upgrades.owned[r.with] ?? 0) > 0 ? 50 : 0);
        return recipe.has(id) && own === 0 ? 60 : 0;
      };
      let got = 0, f = -1;
      for (let d = 0; d < DRAFTS + CHESTS; d++) {
        (w.titan as { rank: number }).rank = Math.min(4, Math.floor(d / 9));
        const chest = d % 20 === 19;
        if (chest) w.upgrades.chestDrafts = 1; else w.upgrades.pendingDrafts = 1;
        let o = rollOffer(w, chest);
        if (chase && Math.max(...o.map(score)) === 0 && w.upgrades.rerolls > 0) o = rerollOffer(w) ?? o;
        let best = o[0];
        for (const id of o) if (score(id) > score(best)) best = id;
        if (chase && !w.upgrades.locked) {
          const hold = o.filter((id) => id !== best && score(id) >= 100).sort((a, b) => score(b) - score(a))[0];
          if (hold) lockCard(w, hold);
        }
        pickUpgrade(w, best);
        if (UPGRADE_BY_ID[best].evo) { got++; if (f < 0) f = d; }
      }
      if (got) { runs++; first.push(f); }
      evos += got;
    }
    first.sort((a, b) => a - b);
    return { runs, evos, first };
  };
  for (const tid of TITAN_IDS) {
    const c = model(tid, true), n = model(tid, false);
    const med = (a: number[]) => (a.length ? String(a[a.length >> 1] + 1) : '-');
    console.log(`${tid.padEnd(10)} CHASE: ≥1 evolution in ${c.runs}/${N} runs (${(c.evos / N).toFixed(2)}/run, median first at draft ${med(c.first)} of ${DRAFTS + CHESTS}) · NONE: ${n.runs}/${N}`);
    ok(c.runs >= 0.25 * N, `${tid}: a recipe-chasing player completes an evolution in ≥ 25 % of runs (${c.runs}/${N})`);
  }
}

console.log(`\nRESULT: ${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

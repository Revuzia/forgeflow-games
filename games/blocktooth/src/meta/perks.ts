// BLOCKTOOTH v2 — starting perks + run-meta sanitising (FEATURES_V2 §8.5). SIM: THREE-free, deterministic.
// Lane L5 (META/ENDLESS-SIM).
//
// Call sites (L0 pre-wire): world.ts createWorld → sanitizeRunMeta(opts.meta), then applyPerk(w) after
// recomputeStats and before hp = maxHp; checkRunEnd → tryRevive(w) before declaring death.
//
// | perk                     | how it is applied                                                        |
// |--------------------------|--------------------------------------------------------------------------|
// | PETTY CASH               | hidden perk card perk_card_petty_cash (rerolls +1 → every draft refills 1 more) |
// | RED TAPE                 | upgrades.banishLeft += PERKS.redTapeBanish, lockLeft += PERKS.redTapeLock |
// | WARM MIC                 | ult.charge = ULT.max, ult.ready = true (no 'ultCharged' event: createWorld's events are cleared by the first tick; the HUD reads state) |
// | SAFETY INSPECTION        | hidden perk card perk_card_safety_inspection (armor +8)                  |
// | STAY OF DEMOLITION       | tryRevive: once per run, hp = stayHpFrac × maxHp, ult.invulnT ≥ stayInvulnS (covers dot) + 'revive' event |
// | ADVANCE TIP-LINE         | read from w.meta.perk by meta/objectives.ts (+1 OVERLOAD SITE) and the marker view (reach × 2) |
//
// Measured (L5, 2026-09-25, `node _harness/probe_meta.ts` section H: 4 titans × GRID-EAST × 6 perks, seed 1337, gate
// bot, the C2 tree with L4's map sim in progress). Size-up times (s) II / III / IV / V · boss · result:
//
//   | titan      | none                  | WARM MIC              | SAFETY INSPECTION     | others*               |
//   |------------|-----------------------|-----------------------|-----------------------|-----------------------|
//   | MOLO       | 93/211/300/403 clear  | 120/228/351/430 clear | 100/234/342/424 clear | = none                |
//   | VOLT-KITE  | 99/228/326/417 clear  | 109/233/383/474 clear | 99/225/393/492 dead   | = none (TIP-LINE dead 509) |
//   | HEARTHBACK | 114/257/402/490 clear | 94/231/368/422 clear  | 114/262/382/440 clear | = none                |
//   | BRIARWICK  | 120/237/333/419 clear | 121/233/350/424 clear | 114/232/344/420 clear | = none                |
//   * PETTY CASH / RED TAPE: the gate bot never rerolls / banishes, so its runs are unchanged; STAY OF
//     DEMOLITION never triggered (no death before the clear); TIP-LINE only moves the map sim.
// Every Size inside its GATE-2 band (II 60–150 · III 150–300 · IV 280–450 · V 400–560), boss ≤ 560 s: 0 band
// violations, so every number is the §8.5 default. WARM MIC slows Size I–II a little on MOLO / VOLT-KITE: the
// fire-on-ready bot spends the free UPROAR at once, and UPROAR kill XP is banked at ULT.killXpMul.

import type { PerkId, RunMeta, World } from '../core/types.ts';
import { EMPTY_RUN_META, PERK_IDS } from '../core/types.ts';
import { PERKS, ULT } from '../core/config.ts';
import { PERKS_DEF } from '../data/perks.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { recomputeStats, stat } from '../upgrades/stats.ts';
import { ringPoint, spawnEnemy } from '../ai/enemies.ts';
import { bindEndlessSpawns } from './endless.ts';

// EXTENDED COVERAGE's RAMROD spawner is bound here (this module is imported by world.ts alone) so that
// meta/endless.ts — imported by titansim / enemies / director / bosses for its multipliers — never pulls
// ai/enemies.ts → world.ts → upgrades/engine.ts into their import graphs (see meta/endless.ts).
bindEndlessSpawns({ ringPoint, spawnEnemy });

function isPerk(v: unknown): v is PerkId { return typeof v === 'string' && (PERK_IDS as readonly string[]).includes(v); }

/**
 * A complete, valid RunMeta from anything (RunOptions.meta may be missing, partial or hand-built by a
 * harness). `unlocked` keeps only real `locked` card ids, de-duplicated and sorted; `perk` must be a
 * PerkId; `palette` is an integer 0..2; `reviveUsed` is a boolean. Always a fresh object.
 */
export function sanitizeRunMeta(v: unknown): RunMeta {
  const out: RunMeta = { ...EMPTY_RUN_META, unlocked: [] };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.unlocked)) {
    const set = new Set<string>();
    for (const id of o.unlocked) {
      if (typeof id !== 'string') continue;
      const u = UPGRADE_BY_ID[id];
      if (u && u.locked === true) set.add(id);
    }
    out.unlocked = [...set].sort();
  }
  out.perk = isPerk(o.perk) ? o.perk : null;
  const pal = typeof o.palette === 'number' ? o.palette : Number(o.palette);
  out.palette = Number.isFinite(pal) ? Math.max(0, Math.min(2, Math.round(pal))) : 0;
  out.reviveUsed = o.reviveUsed === true;
  return out;
}

/**
 * Grant a hidden perk card: one stack, stats recomputed, newly granted rerolls usable at once — what
 * upgrades/engine.ts applyUpgrade does for a card without triggers (perk cards have none). Done here
 * rather than through applyUpgrade so the world.ts → perks.ts import chain stays free of the trigger
 * engine (probe_combat stubs titansim and would otherwise fail to link engine.ts).
 */
function grantPerkCard(w: World, id: string): void {
  const U = w.upgrades;
  if ((U.owned[id] ?? 0) > 0) return;
  const before = stat(w, 'rerolls');
  U.owned[id] = 1;
  U.order.push(id);
  recomputeStats(w);
  const dr = stat(w, 'rerolls') - before;
  if (dr !== 0 && Number.isFinite(dr)) U.rerolls = Math.max(0, U.rerolls + dr);
}

/** createWorld, after recomputeStats and before hp = maxHp. Applies w.meta.perk (no-op for null). */
export function applyPerk(w: World): void {
  const id = w.meta.perk;
  if (!id) return;
  const def = PERKS_DEF[id];
  if (def && def.card && UPGRADE_BY_ID[def.card]) grantPerkCard(w, def.card);
  const U = w.upgrades;
  switch (id) {
    case 'perk_red_tape':
      U.banishLeft += PERKS.redTapeBanish;
      U.lockLeft += PERKS.redTapeLock;
      break;
    case 'perk_warm_mic':
      w.ult.charge = ULT.max;
      w.ult.ready = true;
      break;
    default:
      break;   // PETTY CASH / SAFETY INSPECTION = their card; STAY = tryRevive; TIP-LINE = map + marker view
  }
}

/**
 * checkRunEnd, before declaring death. STAY OF DEMOLITION, once per run: the titan is back at
 * PERKS.stayHpFrac × maxHp with w.ult.invulnT ≥ PERKS.stayInvulnS (hurtTitan checks it first, so damage
 * over time is blocked too), and a 'revive' event. Returns true when the titan was revived.
 */
export function tryRevive(w: World): boolean {
  const T = w.titan;
  if (T.alive || w.run.result) return false;
  if (w.meta.perk !== 'perk_stay_of_demolition' || w.meta.reviveUsed) return false;
  if (!(T.maxHp > 0)) return false;
  w.meta.reviveUsed = true;
  T.alive = true;
  T.hp = Math.max(1, PERKS.stayHpFrac * T.maxHp);
  w.ult.invulnT = Math.max(w.ult.invulnT, PERKS.stayInvulnS);
  w.events.push({ type: 'revive', x: T.x, z: T.z });
  return true;
}

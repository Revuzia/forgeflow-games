p = r'C:\Users\TestRun\Claude Claw\forgeflow-games\games\blocktooth\src\upgrades\draft.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("""import { EVOLUTIONS, EVO_OF_BASE } from '../data/evolutions.ts';""", """import { EVOLUTIONS, EVO_OF_BASE, EVO_ROWS_OF_PART, EVO_NUDGE, evoReadyStacks } from '../data/evolutions.ts';
import type { EvolutionRow } from '../core/types.ts';""")
old_pool = """const POOL: UpgradeDef[] = [];
const WTS: number[] = [];

function buildPool(w: World, chest: boolean, exclude: readonly string[] | null, exclude2: readonly string[] | null = null): void {
  POOL.length = 0;
  for (const u of UPGRADES) {
    if (!isEligible(w, u)) continue;
    if (chest && u.rarity === 'common') continue;
    if (exclude && exclude.includes(u.id)) continue;
    if (exclude2 && exclude2.includes(u.id)) continue;
    POOL.push(u);
  }
}

const CNT: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };

/** Rarity-first sampling without replacement of up to `k` cards from POOL (one rng.loot draw per card). */
function sample(w: World, k: number, out: string[]): void {
  const luck = stat(w, 'luck');
  let n = POOL.length;
  WTS.length = n;
  while (out.length < k && n > 0) {
    CNT.common = 0; CNT.rare = 0; CNT.epic = 0; CNT.legendary = 0;
    for (let i = 0; i < n; i++) CNT[POOL[i].rarity]++;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = POOL[i].rarity;
      WTS[i] = rarityWeight(r, luck) / CNT[r];
      total += WTS[i];
    }
    let x = w.rng.loot() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) { x -= WTS[i]; if (x < 0) { pick = i; break; } }
    out.push(POOL[pick].id);
    // remove by shifting (keeps the remaining order = catalogue order → stable determinism)
    for (let i = pick; i < n - 1; i++) POOL[i] = POOL[i + 1];
    n--;
    POOL.length = n;
  }
}"""
new_pool = """const POOL: UpgradeDef[] = [];
const POOL_M: number[] = [];                             // F1: per-card weight multiplier (recipe nudge), parallel to POOL
const WTS: number[] = [];

function buildPool(w: World, chest: boolean, exclude: readonly string[] | null, exclude2: readonly string[] | null = null): void {
  POOL.length = 0;
  POOL_M.length = 0;
  for (const u of UPGRADES) {
    if (!isEligible(w, u)) continue;
    if (chest && u.rarity === 'common') continue;
    if (exclude && exclude.includes(u.id)) continue;
    if (exclude2 && exclude2.includes(u.id)) continue;
    POOL.push(u);
    POOL_M.push(recipeNudge(w, u.id));
  }
}

const CNT: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };

/**
 * Rarity-first sampling without replacement of up to `k` cards from POOL (one rng.loot draw per card).
 * F1: inside a rarity a card's share is POOL_M[i] / (sum of POOL_M over that rarity); the rarity split itself
 * is untouched. With every multiplier 1 the weights are bit-identical to the pre-F1 rarityWeight / count.
 */
function sample(w: World, k: number, out: string[]): void {
  const luck = stat(w, 'luck');
  let n = POOL.length;
  WTS.length = n;
  while (out.length < k && n > 0) {
    CNT.common = 0; CNT.rare = 0; CNT.epic = 0; CNT.legendary = 0;
    for (let i = 0; i < n; i++) CNT[POOL[i].rarity] += POOL_M[i];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = POOL[i].rarity;
      WTS[i] = rarityWeight(r, luck) * POOL_M[i] / CNT[r];
      total += WTS[i];
    }
    let x = w.rng.loot() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) { x -= WTS[i]; if (x < 0) { pick = i; break; } }
    out.push(POOL[pick].id);
    // remove by shifting (keeps the remaining order = catalogue order → stable determinism)
    for (let i = pick; i < n - 1; i++) { POOL[i] = POOL[i + 1]; POOL_M[i] = POOL_M[i + 1]; }
    n--;
    POOL.length = n;
    POOL_M.length = n;
  }
}"""
assert old_pool in s
s = s.replace(old_pool, new_pool)

old_ready = """/**
 * Ready evolution ids in catalogue order: owned[evo] is 0, owned[base] is maxed, owned[with] ≥ 1, the evo
 * is not banished, it is this titan's (or generic), and a `locked` evo is in w.meta.unlocked.
 */
export function evolutionsReady(w: World): string[] {
  const out: string[] = [];
  const owned = w.upgrades.owned;
  for (const r of EVOLUTIONS) {
    if ((owned[r.id] ?? 0) > 0) continue;
    const e = UPGRADE_BY_ID[r.id];
    const b = UPGRADE_BY_ID[r.base];
    if (!e || !b) continue;
    if (e.titan && e.titan !== w.titanId) continue;
    if ((owned[r.base] ?? 0) !== b.maxStacks) continue;
    if (!((owned[r.with] ?? 0) >= 1)) continue;
    if (banishedOf(w).includes(r.id)) continue;
    if (e.locked && !unlockedOf(w).includes(r.id)) continue;
    out.push(r.id);
  }
  return out;
}"""
new_ready = """/** F1: the evolution can still happen this run: not owned, this titan's (or generic), not banished, unlocked. */
function evoLive(w: World, r: EvolutionRow): boolean {
  if ((w.upgrades.owned[r.id] ?? 0) > 0) return false;
  const e = UPGRADE_BY_ID[r.id];
  if (!e || !UPGRADE_BY_ID[r.base] || !UPGRADE_BY_ID[r.with]) return false;
  if (e.titan && e.titan !== w.titanId) return false;
  if (banishedOf(w).includes(r.id)) return false;
  if (e.locked && !unlockedOf(w).includes(r.id)) return false;
  return true;
}

/**
 * Ready evolution ids in catalogue order: owned[evo] is 0, owned[base] >= min(EVO_READY_STACKS, base
 * maxStacks) (F1; was: maxed), owned[with] >= 1, the evo is not banished, it is this titan's (or generic),
 * and a `locked` evo is in w.meta.unlocked.
 */
export function evolutionsReady(w: World): string[] {
  const out: string[] = [];
  const owned = w.upgrades.owned;
  for (const r of EVOLUTIONS) {
    if (!evoLive(w, r)) continue;
    if ((owned[r.base] ?? 0) < evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks)) continue;
    if (!((owned[r.with] ?? 0) >= 1)) continue;
    out.push(r.id);
  }
  return out;
}

/**
 * F1 draft nudge: EVO_NUDGE when card `id` is the missing half of a live, STARTED recipe (the companion,
 * not owned yet, once the base is owned; or the base, below its ready stacks, once either half is owned),
 * else 1. Pure function of the world (no draws).
 */
export function recipeNudge(w: World, id: string): number {
  const rows = EVO_ROWS_OF_PART[id];
  if (!rows) return 1;
  const owned = w.upgrades.owned;
  for (const r of rows) {
    if (!evoLive(w, r)) continue;
    const haveB = owned[r.base] ?? 0, haveW = owned[r.with] ?? 0;
    if (id === r.base && haveB < evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks) && (haveB >= 1 || haveW >= 1)) return EVO_NUDGE;
    if (id === r.with && haveW < 1 && haveB >= 1) return EVO_NUDGE;
  }
  return 1;
}

/** F1 recipe progress of one live recipe (UI hint rows: EVOLUTION READY / "2 OF 3 · NEEDS <WITH>"). */
export interface EvoProgress { evo: string; base: string; with: string; baseHave: number; baseNeed: number; withHave: boolean; ready: boolean }

/**
 * F1: every live recipe of this run that is STARTED (either half owned), ready ones first, then by how
 * close they are; catalogue order breaks ties. For the HUD / draft 'EVOLUTION READY' hint (read-only).
 */
export function evolutionProgress(w: World): EvoProgress[] {
  const out: EvoProgress[] = [];
  const owned = w.upgrades.owned;
  for (const r of EVOLUTIONS) {
    if (!evoLive(w, r)) continue;
    const baseHave = owned[r.base] ?? 0, withHave = (owned[r.with] ?? 0) >= 1;
    if (baseHave === 0 && !withHave) continue;
    const baseNeed = evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks);
    out.push({ evo: r.id, base: r.base, with: r.with, baseHave, baseNeed, withHave, ready: baseHave >= baseNeed && withHave });
  }
  const gap = (p: EvoProgress): number => Math.max(0, p.baseNeed - p.baseHave) + (p.withHave ? 0 : 1);
  return out.map((p, i) => ({ p, i })).sort((a, b) => gap(a.p) - gap(b.p) || a.i - b.i).map((x) => x.p);
}

/**
 * F1: for an offered card, the evolution it advances (`completes` = taking it makes that recipe ready),
 * or null. Draft-card hint ("COMPLETES <EVO NAME>" / "TOWARD <EVO NAME>"); only started recipes count.
 */
export function recipeHint(w: World, id: string): { evo: string; completes: boolean } | null {
  const rows = EVO_ROWS_OF_PART[id];
  if (!rows) return null;
  const owned = w.upgrades.owned;
  let best: { evo: string; completes: boolean } | null = null;
  for (const r of rows) {
    if (!evoLive(w, r)) continue;
    const need = evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks);
    let haveB = owned[r.base] ?? 0, haveW = owned[r.with] ?? 0;
    if (haveB === 0 && haveW === 0) continue;
    if (id === r.base) { if (haveB >= need) continue; haveB++; }
    else { if (haveW >= 1) continue; haveW++; }
    const completes = haveB >= need && haveW >= 1;
    if (!best || (completes && !best.completes)) best = { evo: r.id, completes };
  }
  return best;
}"""
assert old_ready in s
s = s.replace(old_ready, new_ready)
open(p, 'w', encoding='utf-8').write(s)
print('patched')

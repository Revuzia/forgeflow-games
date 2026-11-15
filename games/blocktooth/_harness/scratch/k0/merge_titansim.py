import sys
p = 'src/titans/titansim.ts'
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    n = s.count(old)
    if n != cnt:
        print('MISMATCH', n, repr(old[:80]))
        sys.exit(1)
    s = s.replace(old, new)


rep("""// Lane extras: gainGrowth (the 'mass' upgrade action), growToRank (dev cheat), paceMul, refundDash,
// dashRechargeS.
""", """// Lane extras: gainGrowth (the 'mass' upgrade action), growToRank (dev cheat), paceMul, refundDash,
// dashRechargeS.
// GATEKEEPERS (§7.3, lane K0 pre-wire): grow() ranks up only while T.rank + 1 <= w.gates.unlocked and then
// runs checkGateLock (the lock of the next Size gate); breachTo(w, rank) is the kill-tick MASS BREACH
// meta/gates.ts onGateDefeated / onMainDefeated call; paceMul holds the catch-up while a fight is alive.
""")

rep("""import type { DamageKind, DamageOpts, Enemy, TitanDef, TitanState, Tier, World } from '../core/types.ts';""",
    """import type { DamageKind, DamageOpts, Enemy, RankIndex, TitanDef, TitanState, Tier, World } from '../core/types.ts';""")
rep("""import { endlessDmgMul } from '../meta/endless.ts';
""", """import { endlessDmgMul } from '../meta/endless.ts';
import { fightAlive, lockGate } from '../meta/gates.ts';
""")

rep("""export function paceMul(w: World): number {
  const T = w.titan;
  const next = T.rank + 1;""", """export function paceMul(w: World): number {
  const T = w.titan;
  // GATEKEEPERS §2.2 / §4.2: the climax is governed (the city boss due or alive at Size IV); no catch-up
  // while any fight is alive
  if (T.rank === 3 && (w.gates.pending === 4 || w.gates.active === 4)) return AHEAD_MIN;
  if (fightAlive(w)) return 1;
  const next = T.rank + 1;""")

rep("""export function growToRank(w: World, rank: number, minLevel = 0): number {
  const T = w.titan;
  const want = clamp(Math.floor(Number.isFinite(rank) ? rank : 0), 0, 4);""", """export function growToRank(w: World, rank: number, minLevel = 0): number {
  const T = w.titan;
  const want = clamp(Math.floor(Number.isFinite(rank) ? rank : 0), 0, 4);
  // GATEKEEPERS §7.3: the dev cheat (cheat.rank / cheat.level) still jumps Sizes — a documented bypass
  // that opens every gate up to the wanted Size first
  if (want > w.gates.unlocked) w.gates.unlocked = want as RankIndex;""")

rep("""function grow(w: World, r0: number): void {
  const T = w.titan, K = T.kit;
  let guard = 0;
  while (T.rank < 4 && T.level >= RANK_LEVELS[T.rank + 1] && guard++ < 5) rankUp(w);
  const dur""", """function grow(w: World, r0: number): void {
  const T = w.titan, K = T.kit;
  let guard = 0;
  // GATEKEEPERS §2.1: a Size is only entered once its gate is open (gates.unlocked)
  while (T.rank < 4 && T.rank + 1 <= w.gates.unlocked && T.level >= RANK_LEVELS[T.rank + 1] && guard++ < 5) rankUp(w);
  checkGateLock(w);
  const dur""")

rep("""function rankUp(w: World): void {""", """/**
 * GATEKEEPERS §7.2 (ModTitanAddV3): the lock check grow() runs after its level loop; meta/gates.ts
 * onGateDefeated calls it after the breach (§2.5 step 5) so a chained lock does not wait for a level-up.
 */
export function checkGateLock(w: World): void {
  const T = w.titan;
  if (T.rank < 4 && T.level >= RANK_LEVELS[T.rank + 1] && w.gates.unlocked <= T.rank) lockGate(w, (T.rank + 1) as 1 | 2 | 3 | 4, false);
}

/**
 * GATEKEEPERS §7.2 (ModTitanAddV3): breach to Size `rank` NOW (the kill tick). Tops the level up to
 * RANK_LEVELS[rank] with exact XP if it is below (a capped kill; the drafts are owed and counted in
 * gates.topUpLevels), sets gates.unlocked = rank, then the real rankUp path (stats, heal, events, the
 * MASS BREACH tween). Never shrinks.
 */
export function breachTo(w: World, rank: RankIndex): void {
  const T = w.titan;
  const want = clamp(Math.floor(Number.isFinite(rank) ? rank : 0), 0, 4) as RankIndex;
  if (want > w.gates.unlocked) w.gates.unlocked = want;
  if (!T.alive || want <= T.rank) return;
  const lv0 = T.level;
  const need = RANK_LEVELS[want];
  while (T.level < need) {
    T.level++;
    T.xpToNext = xpToNext(T.level);
    w.upgrades.pendingDrafts++;
    w.events.push({ type: 'levelUp', level: T.level });
  }
  if (T.level !== lv0) { T.xp = 0; w.gates.topUpLevels += T.level - lv0; }
  grow(w, T.rank);
}

function rankUp(w: World): void {""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok titansim.ts')

import sys
p = 'src/testsurface.ts'
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    n = s.count(old)
    if n != cnt:
        print('MISMATCH', n, repr(old[:90]))
        sys.exit(1)
    s = s.replace(old, new)


rep("""//   __BT__.cheat.{ult, powerup, objective, endless, evolveReady, bossSpawn, tillOpen}   dev only
""", """//   __BT__.cheat.{ult, powerup, objective, endless, evolveReady, bossSpawn, tillOpen}   dev only
//   GATEKEEPERS (§7.3, lane K0):
//   __BT__.state().gates           GatesState + the live gatekeeper (id, hp, meter, drumOpen / overheated / folded)
//   __BT__.cheat.{gateLock, gateKill, gateHp, gatesOpen, finaleSkip}   dev only; bossSpawn(id) also takes GATE_IDS
""")
rep("""import type {
  BiomeId, BossId, EndlessState, EnemyKind, ObjectiveKind, ObjectiveTarget, PowerUpKind, RunMeta, RunStats, SimEvent,
  TitanId, TitanInput, UltPhase, World,
} from './core/types.ts';
import { BIOME_IDS, BOSS_IDS, ENEMY_KINDS, OBJECTIVE_KINDS, POWERUP_KINDS, TITAN_IDS } from './core/types.ts';
import { CAMERA, CITY, cameraDistance, rankForLevel } from './core/config.ts';""", """import type {
  BiomeId, BossId, EndlessState, EnemyKind, GateId, GateSlot, GatesState, ObjectiveKind, ObjectiveTarget, PowerUpKind, RankIndex,
  RunMeta, RunStats, SimEvent, TitanId, TitanInput, UltPhase, World,
} from './core/types.ts';
import { BIOME_IDS, BOSS_IDS, ENEMY_KINDS, GATE_IDS, OBJECTIVE_KINDS, POWERUP_KINDS, TITAN_IDS, isGateId } from './core/types.ts';
import { CAMERA, CITY, cameraDistance, rankForLevel } from './core/config.ts';""")
rep("""import { spawnBoss } from './ai/bosses/index.ts';
import { killEnemy } from './combat/damage.ts';""", """import { spawnBoss, spawnGate } from './ai/bosses/index.ts';
import { killEnemy } from './combat/damage.ts';
import { endFinale, flushGateBreach, lockGate } from './meta/gates.ts';""")
rep("""export interface BtBossState {
  id: string; phase: number; hp: number; maxHp: number; meter: number; attack: string | null;
  alive: boolean; introT: number; staggerT: number; x: number; z: number;
}""", """export interface BtBossState {
  id: string; phase: number; hp: number; maxHp: number; meter: number; attack: string | null;
  alive: boolean; introT: number; staggerT: number; x: number; z: number;
  /** GATEKEEPERS: 'main' (a city boss) | 'gate'; slot = the Size it guards (0 = an EXTENDED COVERAGE rematch) */
  role: string; slot: number;
}

/** GATEKEEPERS §7.3: the GatesState fields (arrays copied) + the live gatekeeper, if one is in the slot. */
export interface BtGatesState extends GatesState {
  live: { id: GateId; hp: number; maxHp: number; meter: number; drumOpen: boolean; overheated: boolean; folded: boolean; weakMask: number } | null;
}""")
rep("""  boss: BtBossState | null;
  run: RunStats | null;
  frozen: boolean; testFrozen: boolean; ending: boolean;""", """  boss: BtBossState | null;
  run: RunStats | null;
  /** GATEKEEPERS §7.3 (null outside a run) */
  gates: BtGatesState | null;
  frozen: boolean; testFrozen: boolean; ending: boolean;""")
rep("""  /** field any boss id (incl. parkade6) */
  bossSpawn(id: BossId): string | null;
  /** PARKADE-6 only: open the TILL for `s` seconds */
  tillOpen(s: number): number;
}""", """  /** field any boss id (incl. parkade6); GATEKEEPERS: a gatekeeper id fields it through spawnGate(w, id, 0) */
  bossSpawn(id: BossId): string | null;
  /** PARKADE-6 only: open the TILL for `s` seconds */
  tillOpen(s: number): number;
  // ── GATEKEEPERS (§7.3) — cheats only SET UP state ──
  /** lock Size gate `slot` (1..4) now through meta/gates.ts lockGate (the real lock path); returns gates.pending */
  gateLock(slot: number): number;
  /** kill the live fight (gatekeeper or city boss) and run its breach now (flushGateBreach); returns true if one died */
  gateKill(): boolean;
  /** set the live fight's HP to `frac` × max (0 < frac ≤ 1); returns the HP */
  gateHp(frac: number): number;
  /** open every gate through slot n (0..4) without fights, then the Size the level already implies (real rank-ups,
   *  no drafts); returns gates.unlocked */
  gatesOpen(n: number): number;
  /** end the Size V finale now (the app's Enter / A path: endFinale); returns gates.finaleDone */
  finaleSkip(): boolean;
}""")
rep("""        drafts: { pending: 0, levelUps: 0, chests: 0, rerolls: 0, offer: null },
        owned: {}, boss: null, run: null,
      };""", """        drafts: { pending: 0, levelUps: 0, chests: 0, rerolls: 0, offer: null },
        owned: {}, boss: null, run: null, gates: null,
      };""")
rep("""      boss: b ? {
        id: b.id, phase: b.phase, hp: b.hp, maxHp: b.maxHp, meter: b.meter, attack: b.attack,
        alive: b.alive, introT: b.introT, staggerT: b.staggerT, x: b.x, z: b.z,
      } : null,
      run: { ...w.run },
    };
  };""", """      boss: b ? {
        id: b.id, phase: b.phase, hp: b.hp, maxHp: b.maxHp, meter: b.meter, attack: b.attack,
        alive: b.alive, introT: b.introT, staggerT: b.staggerT, x: b.x, z: b.z, role: b.role, slot: b.slot,
      } : null,
      run: { ...w.run },
      gates: gatesState(w),
    };
  };

  /** GATEKEEPERS §7.3: GatesState (arrays copied) + the live gatekeeper's id, hp, meter and weak-point flags. */
  const gatesState = (w: World): BtGatesState => {
    const G = w.gates, b = w.boss;
    const live = b && b.alive && b.role === 'gate' ? {
      id: b.id as GateId, hp: b.hp, maxHp: b.maxHp, meter: b.meter,
      drumOpen: (b.data.drumOpen ?? 0) > 0, overheated: (b.data.overheated ?? 0) > 0, folded: (b.data.folded ?? 0) > 0,
      weakMask: b.data.weakMask ?? 0,
    } : null;
    return {
      ...G,
      spawnT: G.spawnT.slice(), killT: G.killT.slice(), rematchN: [G.rematchN[0], G.rematchN[1], G.rematchN[2]],
      live,
    };
  };""")
rep("""    bossSpawn(id) {
      const w = devOnly('bossSpawn');
      if (!(BOSS_IDS as readonly string[]).includes(id)) throw new Error(`cheat.bossSpawn: unknown boss '${String(id)}' (${BOSS_IDS.join(', ')})`);
      app.mutate((ww) => spawnBoss(ww, id));
      return w.boss && w.boss.alive ? w.boss.id : null;
    },""", """    bossSpawn(id) {
      const w = devOnly('bossSpawn');
      if (isGateId(id)) {
        app.mutate((ww) => spawnGate(ww, id, 0));   // GATEKEEPERS §7.3
        return w.boss && w.boss.alive ? w.boss.id : null;
      }
      const main = BOSS_IDS.find((m) => m === id);
      if (!main) throw new Error(`cheat.bossSpawn: unknown boss '${String(id)}' (${[...BOSS_IDS, ...GATE_IDS].join(', ')})`);
      app.mutate((ww) => spawnBoss(ww, main));
      return w.boss && w.boss.alive ? w.boss.id : null;
    },""")
rep("""      b.data.tillOpen = Math.max(0, num(sec, 3));
      return b.data.tillOpen;
    },
  };""", """      b.data.tillOpen = Math.max(0, num(sec, 3));
      return b.data.tillOpen;
    },
    // ── GATEKEEPERS (§7.3) ──
    gateLock(slot) {
      const w = devOnly('gateLock');
      const s = Math.floor(num(slot, 0));
      if (!(s >= 1 && s <= 4)) throw new Error(`cheat.gateLock: slot must be 1..4 (got ${String(slot)})`);
      app.mutate((ww) => lockGate(ww, s as GateSlot, false));
      return w.gates.pending;
    },
    gateKill() {
      const w = devOnly('gateKill');
      const b = w.boss;
      if (!b || !b.alive) return false;
      app.mutate((ww) => {
        const bb = ww.boss;
        if (!bb || !bb.alive) return;
        bb.introT = 0;
        bossUltHit(ww, 1, 0);           // exact, body-only, exempt from the per-second cap → defeat()
        flushGateBreach(ww);            // the breach now, so its events route with the kill's
      });
      return !b.alive;
    },
    gateHp(frac) {
      const w = devOnly('gateHp');
      const b = w.boss;
      if (!b || !b.alive) throw new Error('cheat.gateHp: no live gatekeeper or city boss');
      const f = Math.min(1, Math.max(1e-4, num(frac, 1)));
      b.hp = Math.max(1e-3, f * b.maxHp);
      return b.hp;
    },
    gatesOpen(n) {
      const w = devOnly('gatesOpen');
      const k = Math.max(0, Math.min(4, Math.floor(num(n, 0)))) as RankIndex;
      app.mutate((ww) => {
        const G = ww.gates;
        if (k > G.unlocked) G.unlocked = k;
        if (G.pending !== 0 && G.pending <= k) { G.pending = 0; G.dueT = Infinity; G.capped = false; }
        const want = Math.min(k, rankForLevel(ww.titan.level));
        if (want > ww.titan.rank) growToRank(ww, want);
      });
      return w.gates.unlocked;
    },
    finaleSkip() {
      const w = devOnly('finaleSkip');
      app.mutate((ww) => endFinale(ww));
      return w.gates.finaleDone;
    },
  };""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok testsurface.ts')

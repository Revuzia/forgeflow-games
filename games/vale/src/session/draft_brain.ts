// VALE session — the draft-bot seam and the session's fallback draft brain.
//
// Bots draft through the SAME DraftActions a player sends (draft.ts applies both identically).
// DraftHost asks a seat's DraftBrain for one action at a time, with the DraftState as that seat
// sees it (hidden information stays hidden from bots too). Returning null means "nothing now".
//
// The BOTS lane ships the real brain (src/sim/bots/draft.ts createDraftBrain(catalog, seed): role
// need, comfort, counters, threat bans); bots_link.ts wires it in. This fallback keeps every pick
// protocol playable without it: ban a random available fighter no ally is hovering; hover then lock
// a fighter of the seat's role (RoleDef id on FighterDef.role, then secondaryRole), else any; on a
// Bridge bench swap once for a fighter of the seat's role when its own is off-role.

import type { CatalogT } from '../contracts/catalog.ts';
import type { DraftAction, DraftState } from '../contracts/session.ts';
import type { PlayerId } from '../contracts/sim.ts';
import { Rng } from '../sim/rng.ts';

export interface DraftBrain {
  act(state: DraftState, seat: PlayerId): DraftAction | null;
}
export type DraftBrainFactory = (catalog: CatalogT, seed: number) => DraftBrain;

export function createFallbackDraftBrain(catalog: CatalogT, seed: number): DraftBrain {
  const rng = new Rng(seed);
  const fighters = new Map(catalog.fighters.map((f) => [f.id, f]));
  const fits = (fighter: string, role: string | undefined): number => {
    if (!role) return 1;
    const f = fighters.get(fighter);
    if (!f) return 0;
    return f.role === role ? 2 : f.secondaryRole === role ? 1 : 0;
  };
  const best = (cands: readonly string[], role: string | undefined): string | null => {
    if (cands.length === 0) return null;
    let top = -1;
    for (const c of cands) top = Math.max(top, fits(c, role));
    const pool = cands.filter((c) => fits(c, role) === top);
    return rng.pick(pool);
  };
  return {
    act(s: DraftState, seat: PlayerId): DraftAction | null {
      const me = s.seats.find((x) => x.player === seat);
      if (!me) return null;
      const myTurn = !!s.turn && s.turn.players.includes(seat);
      if (s.phase === 'ban') {
        if (!myTurn) return null;
        const allyHovers = new Set(s.seats.filter((x) => x.team === me.team && x.hover).map((x) => x.hover as string));
        const ownBans = new Set(s.bans.filter((b) => b.team === me.team && b.fighter).map((b) => b.fighter as string));
        const cands = s.available.filter((f) => !allyHovers.has(f) && !ownBans.has(f));
        return cands.length ? { a: 'ban', fighter: rng.pick(cands) } : null;
      }
      if (s.phase === 'pick') {
        if (me.locked) return null;
        if (me.hover && s.available.includes(me.hover)) return myTurn ? { a: 'lock' } : null;
        const allyHovers = new Set(s.seats.filter((x) => x.team === me.team && x.player !== seat && x.hover).map((x) => x.hover as string));
        const cands = s.available.filter((f) => !allyHovers.has(f));
        const f = best(cands.length ? cands : s.available, me.role);
        return f ? { a: 'hover', fighter: f } : null;
      }
      if (s.phase === 'bench') {
        if (!me.locked || fits(me.locked, me.role) === 2) return null;
        const bench = s.bench[me.team] ?? [];
        const better = bench.filter((f) => fits(f, me.role) > fits(me.locked as string, me.role));
        return better.length ? { a: 'benchSwap', fighter: rng.pick(better) } : null;
      }
      return null;
    },
  };
}

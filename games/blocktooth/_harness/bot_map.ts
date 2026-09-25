// BLOCKTOOTH v2 — gate-bot detours to map objectives and power-ups (FEATURES_V2 §5.5 / §6; lane L4).
// Deterministic, read-only (never mutates gameplay state). bot.ts calls it when no hostile paint threatens
// the titan (`!threatened`) and, when it returns a point, walks straight at it (its own stuck detector and
// bounds clamp still apply). Policy (§5.5), in priority order:
//   1. RELIEF DEPOT when HP < 60 % (the nearest live one within its strand range) — also during a boss fight;
//   2. no detours at all while a boss is on the field (the fight is the bot's job);
//   3. a power-up token within PU_NEAR × spawnRing (the nearest; tokens live 30 s);
//   4. an OVERLOAD SITE within 1.5 × spawnRing (a Size I prop site or a Size II+ building: walking into it
//      is how the bot flattens it — contact smash + the auto-attack on the nearest city target);
//   5. a RECORDS ANNEX only when it is nearly on the way (within ANNEX_NEAR × spawnRing).

import type { World } from '../src/core/types.ts';
import { spawnRing } from '../src/ai/director.ts';

export const BOT_MAP_TUNE = {
  reliefHp: 0.6,
  reliefRange: 2.5,     // × spawnRing
  puNear: 1.0,          // × spawnRing
  overloadRange: 1.5,   // × spawnRing (§5.5)
  annexNear: 0.5,       // × spawnRing
};

export function botDetour(w: World, out: { x: number; z: number }): { x: number; z: number } | null {
  const T = w.titan;
  if (!T.alive || w.run.result) return null;
  const m = w.map;
  if (!m) return null;
  const ring = spawnRing(w);
  const hp = T.maxHp > 0 ? T.hp / T.maxHp : 1;

  // 1. RELIEF DEPOT when hurt
  if (hp < BOT_MAP_TUNE.reliefHp) {
    const o = nearestObjective(w, 'reliefDepot', BOT_MAP_TUNE.reliefRange * ring);
    if (o) { out.x = o.x; out.z = o.z; return out; }
  }
  // 2. the boss fight comes first
  const b = w.boss;
  if (b && b.alive) return null;
  // 3. power-ups
  let best = Infinity, bx = 0, bz = 0;
  const lim = BOT_MAP_TUNE.puNear * ring;
  for (const p of m.powerups) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - T.x, p.z - T.z);
    if (d <= lim && d < best) { best = d; bx = p.x; bz = p.z; }
  }
  if (best < Infinity) { out.x = bx; out.z = bz; return out; }
  // 4. OVERLOAD SITE
  const ov = nearestObjective(w, 'overloadSite', BOT_MAP_TUNE.overloadRange * ring);
  if (ov) { out.x = ov.x; out.z = ov.z; return out; }
  // 5. RECORDS ANNEX, only when it is nearly on the way
  const an = nearestObjective(w, 'recordsAnnex', BOT_MAP_TUNE.annexNear * ring);
  if (an) { out.x = an.x; out.z = an.z; return out; }
  return null;
}

function nearestObjective(w: World, kind: 'overloadSite' | 'reliefDepot' | 'recordsAnnex', lim: number): { x: number; z: number } | null {
  const T = w.titan;
  let best = Infinity, pick: { x: number; z: number } | null = null;
  for (const o of w.map.objectives) {
    if (!o.alive || o.kind !== kind) continue;
    const d = Math.hypot(o.x - T.x, o.z - T.z);
    if (d <= lim && d < best) { best = d; pick = o; }
  }
  return pick;
}

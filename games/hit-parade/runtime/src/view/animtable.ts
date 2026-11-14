// HIT PARADE - the per-fighter anim table (CONTRACT §17 rules 1-3) and sim-frame -> clip-seconds mapping.
//
// SIM builds `GameData.anims` (§19.9 "always built"); the view uses it when present and otherwise builds the same
// table here from the fighter JSON + clips.json by the §17 rule, so the lab (and any fixture without anims) poses
// identically. Pure functions, no THREE.

import type { AnimRef, ViewClipFacts, ViewFighterDef, ViewGameData } from './types.ts';

/** CONTRACT §6.2 shared system clips, in §17 rule 2 order (animId 0..33). */
export const SYSTEM_CLIPS = [
  'idle', 'walk_f', 'walk_b', 'crouch', 'crouch_idle', 'jump_up', 'jump_f', 'jump_b', 'land', 'dash_f', 'dash_b',
  'block_high', 'block_low', 'hit_high_s', 'hit_high_l', 'hit_body', 'hit_low', 'hit_air', 'crumple', 'kd_fall_b',
  'kd_fall_f', 'kd_ground_b', 'kd_ground_f', 'wake_b', 'wake_f', 'wall_splat', 'thrown_f', 'thrown_b', 'dizzy',
  'ko_fall', 'timeover_lose', 'parry', 'impact_windup', 'shove',
] as const;
export const SYSTEM_COUNT = SYSTEM_CLIPS.length;   // 34

/** system clips that loop at rate 1 (everything else clamps at its end) when clips.json says nothing */
const LOOPING = new Set(['idle', 'walk_f', 'walk_b', 'crouch_idle', 'block_high', 'block_low', 'dizzy', 'kd_ground_b', 'kd_ground_f']);

/** clips.json may be `{ clips: {id: facts}, heightM, ... }` or flat `{id: facts}`; returns the per-clip map */
export function clipFactsOf(file: unknown): Record<string, ViewClipFacts> {
  if (!file || typeof file !== 'object') return {};
  const f = file as Record<string, unknown>;
  const inner = f.clips;
  const src = (inner && typeof inner === 'object' ? inner : f) as Record<string, unknown>;
  const out: Record<string, ViewClipFacts> = {};
  for (const k of Object.keys(src)) {
    const v = src[k] as { dur?: unknown } | null;
    if (v && typeof v === 'object' && typeof v.dur === 'number') out[k] = v as ViewClipFacts;
  }
  return out;
}

/** §5.2 default warp: [[0,0],[startup, contact],[startup+active+recovery, dur]] */
function derivedWarp(m: { startup?: number; active?: number; recovery?: number }, facts: ViewClipFacts | undefined): number[][] | null {
  if (!facts) return null;
  const s = m.startup ?? 0, a = m.active ?? 0, r = m.recovery ?? 0;
  const total = s + a + r;
  if (!(total > 0) || !(facts.dur > 0)) return null;
  const contact = typeof facts.contact === 'number' ? facts.contact : facts.dur * (s / total);
  return s > 0 ? [[0, 0], [s, contact], [total, facts.dur]] : [[0, 0], [total, facts.dur]];
}

/** Build the §17 rule 2 table for one fighter. */
export function buildAnimTable(def: ViewFighterDef, clipsFile: unknown): AnimRef[] {
  const facts = clipFactsOf(clipsFile);
  const out: AnimRef[] = [];
  for (const c of SYSTEM_CLIPS) out.push({ clip: c, warp: null, loop: facts[c]?.loop ?? LOOPING.has(c), moveId: -1 });
  const keys = Object.keys(def.moves || {});
  keys.forEach((k, i) => {
    const m = def.moves[k];
    const clip = m.anim?.clip ?? k;
    const warp = m.anim?.warp && m.anim.warp.length >= 2 ? m.anim.warp : derivedWarp(m, facts[clip]);
    out.push({ clip, warp, loop: false, moveId: i });
  });
  // intro and taunt entries always exist (clip '' when the kit has none - renders idle), as SIM's core/data.ts builds it
  out.push({ clip: def.intro ?? '', warp: null, loop: false, moveId: -1 });
  for (const w of def.win ?? []) out.push({ clip: w, warp: null, loop: facts[w]?.loop ?? false, moveId: -1 });
  out.push({ clip: def.taunt ?? '', warp: null, loop: false, moveId: -1 });
  // §19.10 grab (connect) clips, one per move with a grab block, time-scaled over the lock frames
  keys.forEach((k, i) => {
    const g = (def.moves[k] as { grab?: { clip?: string; frames: number } }).grab;
    if (!g) return;
    const clip = g.clip ?? def.moves[k].anim?.clip ?? '';
    const dur = facts[clip]?.dur ?? g.frames / 60;
    out.push({ clip, warp: [[0, 0], [g.frames, dur]], loop: false, moveId: i });
  });
  return out;
}

/** The table the view uses for a fighter: SIM's when present (single source of truth), else built here. */
export function animTableFor(data: ViewGameData, fighterId: string): ReadonlyArray<AnimRef> {
  const sim = data.anims?.[fighterId];
  if (sim && sim.length) return sim;
  const def = data.fighters[fighterId];
  if (!def) return SYSTEM_CLIPS.map((c) => ({ clip: c, warp: null, loop: LOOPING.has(c), moveId: -1 }));
  return buildAnimTable(def, data.clips?.[fighterId]);
}

/** move ids in §17 rule 1 order */
export function moveKeys(def: ViewFighterDef | undefined): string[] {
  return def ? Object.keys(def.moves || {}) : [];
}

/** piecewise-linear warp: sim frame -> clip seconds (clamped at both ends) */
export function pwl(warp: ReadonlyArray<ReadonlyArray<number>>, f: number): number {
  const n = warp.length;
  if (n === 0) return 0;
  if (f <= warp[0][0]) return warp[0][1];
  for (let i = 1; i < n; i++) {
    const a = warp[i - 1], b = warp[i];
    if (f <= b[0]) {
      const span = b[0] - a[0];
      return span > 0 ? a[1] + (b[1] - a[1]) * ((f - a[0]) / span) : b[1];
    }
  }
  return warp[n - 1][1];
}

/** §17 rule 3: seconds into the clip for (entry, animFrame); `dur` = the clip's real duration */
export function animSeconds(e: AnimRef, frame: number, dur: number): number {
  const f = frame > 0 ? frame : 0;
  let t = e.warp ? pwl(e.warp, f) : f / 60;
  if (!(dur > 0)) return 0;
  if (e.loop && !e.warp) {
    t = t % dur;
  } else if (t > dur) t = dur;
  return t < 0 ? 0 : t;
}

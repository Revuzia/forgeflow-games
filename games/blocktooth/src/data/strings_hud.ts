// BLOCKTOOTH v2 — copy for the v2 HUD: ability bar, UPROAR meter, ACTIVE panel, objective tracker,
// screen markers and the v2 toast stack (FEATURES_V2 §4, §5.4, §6.3, §8.4). Lane L8. THREE-free data.
//
// Every string is original (FEATURES_V2 §0.7 / §1): no reference copy ("CHARGED", "ROAR!!", "★n" …).
// Names of objectives / power-ups / ultimates come from their own data files; this file holds only
// the HUD's own words.

export const HUD2 = {
  // ── UPROAR meter (§4.5) ──
  uproar: 'UPROAR',
  uproarReady: 'UPROAR READY',
  cooling: 'COOLING',
  roaring: 'ON AIR',
  keyUltKb: 'E',
  keyUltPad: 'Y',
  /** one-time Size I hint toast on the first charge-up of a profile's first run */
  hintKicker: 'FIELD NOTE',
  hintTitleKb: 'UPROAR READY — PRESS E',
  hintTitlePad: 'UPROAR READY — PRESS Y',
  hintSub: 'EVERYTHING IN VIEW GETS THE MESSAGE',

  // ── ACTIVE panel (§4.4) ──
  active: 'ACTIVE',
  ready: 'READY',
  keyHookKb: 'SPACE',
  keyHookPad: 'A',
  wires: 'WIRES',
  shell: 'SHELL',
  blooms: 'BLOOMS',

  // ── ability bar (§4.2 / §4.3) ──
  badgeMax: 'MAX',
  badgeEvo: 'EVO',
  badgeLevel: 'L',          // + stacks → L2…L5
  evoFlag: 'EVO',

  // ── objective tracker (§4.6) ──
  trackerHead: 'ON THE DESK',
  blk: 'BLK',
  goalPrefix: 'GOAL',
  /** power-up HUD burst suffix (`RED LIGHT!`) */
  bang: '!',

  // ── toasts (§8.4) ──
  reviveKicker: 'STAY OF DEMOLITION',
  reviveTitle: 'DEMOLITION POSTPONED',
  reviveSub: 'THE SUBJECT IS BACK ON ITS FEET — ONE APPEAL PER RUN',
  // Gate F: a recipe just became ready (upgrades/draft.ts evolutionProgress)
  evoReadyKicker: 'RESTRUCTURING APPROVED',
  evoReadyTitle: 'EVOLUTION READY',
  evoReadySub: 'WATCH THE NEXT REPORTS FOR THE RESTRUCTURED FILE',
} as const;

/**
 * The status card's `hp / max` text. maxHp is fractional (base × card multipliers × RANKS[rank].hpMul),
 * and the old readout rounded the two sides differently (ceil(hp) vs round(maxHp)): at full HP a max
 * of e.g. 157.4 read `158 / 157`. Both sides now use the same integer max, and the HP side is clamped
 * into [1, max] while alive (ceil keeps a sliver of HP from reading 0), 0 only when it is really 0.
 * Pure (node probe: probe_icons). Lives here, not in ui/hud.ts, so node can import it without the CSS.
 */
export function hpReadout(hp: number, maxHp: number): string {
  const max = Math.max(1, Math.round(Number.isFinite(maxHp) ? maxHp : 1));
  const h = Number.isFinite(hp) ? hp : 0;
  const cur = h <= 0 ? 0 : Math.max(1, Math.min(max, Math.ceil(h - 1e-6)));
  return `${cur} / ${max}`;
}

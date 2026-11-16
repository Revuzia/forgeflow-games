// GENESIS — POWERS-GROWTH §6: the words and the small state of the god's standing, kept out of the DOM files so each line
// can be tested. The sim does the counting (query 'reach', Snapshot.reach, powersQuery's priceNow/locked/…); this file
// only says it in plain words. Rules of the owner: no alignment meter, no single bar between trust and fear, none of
// the words good / evil / kind / cruel / light / dark, the two bars never compared or coloured as right and wrong.

import type { ReachView, TownReach as TownReach_ } from '../sim/god/reach.ts';
import type { Power } from './powers.ts';

export type { ReachView };

const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const r0 = (v: number) => Math.round(v);
/** a price without a stray fraction: 15, 7.5 */
export function money(v: number): string { return String(Math.round(v * 10) / 10); }

/** "They call you the Whispered." */
export function standingLine(r: ReachView): string {
  return r.tier <= 0 ? 'They do not know your name yet.' : `They call you the ${r.standing}.`;
}

/** the next step and its hold, or the fall that is counting */
export function nextLine(r: ReachView): string {
  if (r.falling > 0) return `Fewer speak your name. ${NUM[r.falling] ?? r.falling} day${r.falling === 1 ? '' : 's'}.`;
  const n = r.next;
  if (!n) return '';
  if (n.held > 0 && n.hold > 0) return `${n.standing} when they have followed a season: ${n.held} of ${n.hold} days.`;
  return `${n.standing} when ${n.f} follow (${r.following} now).`;
}

/** the gauge's tooltip */
export function gaugeTitle(r: ReachView): string {
  if (r.believers <= 0) return 'No one gives to you yet.';
  const g = r.gathered;
  return `Worship ${r0(r.pool)} of ${r0(r.cap)}. The people gave ${r0(g.total)} yesterday, ${r0(g.trust)} in trust and ${r0(g.fear)} in fear.`;
}

/** "23 trust you" / "21 fear you", and the ones who do both */
export function barTitle(r: ReachView, road: 'trust' | 'fear'): string {
  const n = road === 'trust' ? r.trust : r.fear;
  return `${n} ${road} you${r.both > 0 ? `; ${r.both} of them both` : ''}`;
}

/** 0..1 -> a whole percent for a bar's width */
export function pct(v: number): number { return Math.round(Math.max(0, Math.min(1, v)) * 100); }

/** the god's-card pieces as plain data (the HUD draws them; a test reads them) */
export function reachCard(r: ReachView): { stand: string; next: string; gauge: number; gaugeTitle: string; trust: number; fear: number; trustTitle: string; fearTitle: string; pool: number; cap: number } | null {
  if (!r.bound) return null;
  return {
    stand: standingLine(r), next: nextLine(r), gauge: r.cap > 0 ? pct(r.pool / r.cap) : 0, gaugeTitle: gaugeTitle(r),
    trust: pct(r.trustShare), fear: pct(r.fearShare), trustTitle: barTitle(r, 'trust'), fearTitle: barTitle(r, 'fear'), pool: r0(r.pool), cap: r0(r.cap),
  };
}

// ── the powers ──

export type PowerState = 'open' | 'poor' | 'locked';

/** which of the three wheel/palette states a power is in (unbound worlds: always open) */
export function powerState(p: Power): PowerState {
  if (p.locked === true) return 'locked';
  if (p.affordable === false) return 'poor';
  return 'open';
}

/** the size a cast is aimed at: the brush radius, and a power or scale value when the card sets one (sent to the sim's 'reach.price') */
export interface CastSize { radius?: number; power?: number; scale?: number }

/** the sim's own price at a size (query 'reach.price'): the UI keeps no copy of the formula */
export interface SimPrice { priceNow?: number; price?: number; free?: boolean; clay?: boolean; beyond?: boolean; basePrice?: number; freeDeed?: boolean; cooldownText?: string | null; readyIn?: number; locked?: boolean; reason?: string | null }

/** the arguments of a 'reach.price' query for a power at a size, over a world and a town when the cast is aimed there */
export function priceArgs(p: Power, size: CastSize = {}, at: { planet?: number; settlement?: number; pos?: ArrayLike<number> | null } = {}): Record<string, unknown> {
  const a: Record<string, unknown> = { id: p.id };
  if (typeof size.radius === 'number') a.radius = size.radius;
  if (typeof size.power === 'number') a.power = size.power;
  if (typeof size.scale === 'number') a.scale = size.scale;
  if (typeof at.planet === 'number') a.planet = at.planet;
  if (typeof at.settlement === 'number') a.settlement = at.settlement;
  // the aimed point (the sim finds the town there: the free first deed in answer to its open question)
  if (at.pos && at.pos.length >= 3) a.pos = [at.pos[0], at.pos[1], at.pos[2]];
  return a;
}

/**
 * The cost line on a power card, or null in an unbound world (no costs). The numbers are the sim's: `sim` is its answer
 * for this size (query 'reach.price'); without it the power's own 'powers' row (the default size) stands.
 */
export function costLine(p: Power, sim: SimPrice | null = null): string | null {
  const q: SimPrice = sim ?? p;
  const now = q.priceNow;
  if (now === undefined) return null;
  if (q.clay) return 'Free on empty ground.';
  if (!(now > 0)) return q.freeDeed ? 'Free: the first deed in answer.' : 'Free.';
  if (q.beyond ?? p.beyond) return `Beyond your standing: ${money(now)} worship.`;
  const base = q.basePrice ?? p.basePrice ?? p.price;
  if (base === undefined || now > base + 1e-9) return `Costs ${money(now)} worship at this size.`;
  return `Costs ${money(now)} worship.`;
}

/**
 * What the card's cost line says: the sim's answer for THIS world, size and aim decides (free clay and the free first
 * deed open a power the planet-less 'powers' row calls locked); until it arrives the power's own row stands.
 */
export function cardCostText(p: Power, sim: SimPrice | null = null): string | null {
  const known = sim !== null && typeof sim.locked === 'boolean';
  const locked = known ? sim!.locked === true : p.locked === true;
  if (locked) return (known ? sim!.reason : null) ?? p.reason ?? 'Beyond your reach.';
  return costLine(p, sim);
}

/** the cooldown line, from the sim's own text ("Ready in 12 minutes."); null when ready or unbound */
export function readyLine(p: Power, sim: SimPrice | null = null): string | null {
  const q: SimPrice = sim ?? p;
  const t = q.cooldownText;
  if (typeof t === 'string' && t) return `Still gathering strength. ${t}`;
  return null;
}

/** the tooltip for a wheel slot or palette row in the poor or locked state (null when open) */
export function stateTitle(p: Power, r: ReachView | null): string | null {
  const s = powerState(p);
  if (s === 'open') return null;
  if (p.reason) return p.reason;
  if (s === 'locked') return `Beyond your reach. ${p.name} opens when you are ${r?.next?.standing ?? 'higher'}.`;
  const need = p.priceNow ?? 0;
  return `${p.name} needs ${money(need)} worship${r ? `. ${r0(r.pool)} is gathered` : ''}.`;
}

/** the small mark on a locked power: the standing it waits for (short), from the reason's own words when it has them */
export function lockMark(p: Power): string {
  const m = /when you are (\w+(?: \w+)?):/.exec(p.reason ?? '');
  return m ? m[1] : '';
}

/** the small cost numeral on a wheel slot: "15", nothing when free or unbound */
export function costNumeral(p: Power): string {
  if (p.priceNow === undefined || !(p.priceNow > 0)) return '';
  return money(p.priceNow);
}

// ── the town ──

export interface TownReach { pop?: number; believers?: number; trust?: number; fear?: number; gave?: number; spent?: boolean; trade?: boolean; unseen?: boolean; defiant?: boolean; proud?: boolean; broken?: boolean; freeDeed?: boolean }

/** trust and fear in words, never numbers */
function roadWords(trust: number, fear: number): string {
  return trust > fear * 1.5 ? ', most in trust' : fear > trust * 1.5 ? ', most in fear' : ', in trust and in fear alike';
}

/** the town's lines (spec §6); only what is known is said */
export function townReachLines(t: TownReach): string[] {
  const out: string[] = [];
  if (t.believers !== undefined && t.pop !== undefined && t.pop > 0) {
    out.push(`${t.believers} of ${t.pop} believe${t.believers > 0 ? roadWords(t.trust ?? 0, t.fear ?? 0) : ''}.${t.gave !== undefined ? ` They gave ${r0(t.gave)} yesterday.` : ''}`);
  }
  if (t.spent) out.push('They have given all they will today.');
  if (t.trade) out.push('Trade and pilgrims carry your name here.');
  if (t.unseen) out.push('You have not been seen here; they give less.');
  if (t.proud) out.push('They are proud of what they have made; each counts for one.');
  if (t.defiant) out.push('They count for nothing while they defy you.');
  if (t.broken) out.push('Your word to them was broken; only those on the road count, and they give half.');
  if (t.freeDeed) out.push(FREE_DEED_TOWN);
  return out;
}

/** the lines of a town from the sim's per-town fields (TownReach in src/sim/god/reach.ts) and its population */
export function townLines(t: SimTown | null | undefined, pop: number): string[] {
  if (!t) return [];
  return townReachLines({
    pop: Math.max(pop, t.believers), believers: t.believers, trust: t.trust, fear: t.fear, gave: t.gaveYesterday?.total,
    spent: t.measure > 0 && t.left <= 0.05, trade: (t.linkParts?.trade ?? 0) > 0 || (t.linkParts?.pilgrims ?? 0) > 0,
    unseen: t.unseen, proud: t.proud && !t.defiant, defiant: t.defiant, broken: t.brokenCovenant, freeDeed: t.freeDeed,
  });
}
export type SimTown = TownReach_;

/** the town card's line while the town's open question waits: the first deed in answer costs nothing */
export const FREE_DEED_TOWN = 'They wait for your answer; the first deed in answer costs nothing.';

/**
 * A town the sim's per-town list does not carry gives nothing: it has no believers, or the god was never seen in it.
 * `belief` is the town's own belief (0..1) when the card has it. Never the meters' "They give to you in trust."
 */
export function townAbsentLine(belief?: number): string {
  return typeof belief === 'number' && belief >= 0.3 ? 'You have not been seen here; no one here gives to you yet.' : 'No one here gives to you yet.';
}

/** a words-only fallback from the town's regard meters (no counts yet from the sim): one soft line, no numbers */
export function townRoadWords(regard: { trust: number; fear: number } | undefined): string | null {
  if (!regard) return null;
  const t = regard.trust, f = regard.fear;
  if (t < 0.15 && f < 0.15) return null;
  if (t >= 0.15 && f >= 0.15) return 'They give to you in trust and in fear.';
  return t >= 0.15 ? 'They give to you in trust.' : 'They give to you in fear.';
}

/** the town's bars for the town card: the part of its believers on each road, as widths 0..100 */
export function townBars(t: SimTown | null | undefined, pop: number): { trust: number; fear: number } | null {
  if (!t || t.believers <= 0) return null;
  const n = Math.max(pop, t.believers, 1);
  return { trust: pct(t.trust / n), fear: pct(t.fear / n) };
}

// ── the moments ──

/** the toast for a standing event ('reach.rose' / 'reach.fell'), or null */
export function standingToast(type: string, data: { name?: string; to?: number }): { title: string; text: string } | null {
  const name = String(data.name ?? '');
  if (!name) return null;
  if (type === 'reach.rose') return { title: 'Standing', text: `They call you the ${name} now.` };
  if (type === 'reach.fell') return { title: 'Standing', text: `Fewer speak your name. They call you the ${name} now.` };
  return null;
}

// ── the setting ──

export type ReachSetting = 'unbound' | 'bound' | 'strict';
export const SETTING_CHOICES: { value: ReachSetting; label: string; title: string }[] = [
  { value: 'unbound', label: 'Unbound', title: 'Every power, anywhere, now: no standing, no worship to spend' },
  { value: 'bound', label: 'Belief bounds my power', title: 'What the people give, you may spend; the bigger miracles open as more follow you' },
  { value: 'strict', label: 'Strict', title: 'As Belief bounds my power, and the small acts also cost worship and rest, as the old restraint did' },
];
export const SETTING_NOTE = 'Unbound: every power, anywhere, now. Belief bounds my power: your standing and the worship the people give set what you can do. Strict: the same, and small acts cost too.';
export const LEGACY_LABEL = { label: 'Restraint (old save)', value: 'On', note: 'powers cost worship and need time, as in the save' };

/** the position the world is in, from the sim's reach view (unknown until it answers) */
export function settingOf(r: ReachView | null): ReachSetting {
  return r?.bound ? (r.strict ? 'strict' : 'bound') : 'unbound';
}

/** the command for a position of the setting */
export function settingCommand(v: string): { k: 'meta.reach'; bound: boolean; strict?: boolean } {
  // (the middle position names `strict: false`: without it the sim keeps Strict while the world stays bound)
  return v === 'strict' ? { k: 'meta.reach', bound: true, strict: true } : v === 'bound' ? { k: 'meta.reach', bound: true, strict: false } : { k: 'meta.reach', bound: false };
}

// ── the first-run hint ──

export const FIRST_HINT = 'Small acts are always yours. Greater works are paid in worship, and the people give as they believe.';
export const HINT_KEY = 'genesis.reach.hint';
/** whether the hint was dismissed before (a blocked store counts as dismissed for this visit only when it was set) */
export function hintSeen(): boolean { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } }
export function hintDismiss(): void { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* shown again next visit */ } }

/** the 'powers' poll asks for the world looked at, so free clay there shows as free on the wheel and the palette */
export function reachPollArgs(planet: number | null | undefined): Record<string, unknown> {
  return typeof planet === 'number' && planet >= 0 ? { planet } : {};
}

// ── the live state ──

/**
 * The latest reach view and what newly opened. The shell feeds it (query 'reach', then 'powers') every few seconds while
 * the world is bound; the HUD, the wheel, the palette and the cards read it. A power that was locked and now is not
 * is "fresh" once: the wheel pulses it a single time.
 */
export class ReachFeed {
  view: ReachView | null = null;
  private fresh = new Set<string>();
  private lockedBefore = new Map<string, boolean>();

  get bound(): boolean { return this.view?.bound === true; }

  /** the sim's reach view; the standing's rise or fall is the HUD's to pulse (it compares ticks itself) */
  setView(v: unknown): void {
    this.view = v && typeof v === 'object' && typeof (v as ReachView).bound === 'boolean' ? (v as ReachView) : null;
  }

  /** the powers' per-power fields (rows from query 'powers'); returns how many just opened */
  noteLocks(rows: { id: string; locked?: boolean }[]): number {
    let n = 0;
    for (const r of rows) {
      const was = this.lockedBefore.get(r.id);
      if (was === true && r.locked === false) { this.fresh.add(r.id); n++; }
      if (typeof r.locked === 'boolean') this.lockedBefore.set(r.id, r.locked);
    }
    return n;
  }

  /** true once for a newly opened power */
  takeFresh(id: string): boolean { return this.fresh.delete(id); }
  isFresh(id: string): boolean { return this.fresh.has(id); }
}

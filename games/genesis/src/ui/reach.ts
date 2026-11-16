// GENESIS — POWERS-GROWTH §6: the words and the small state of the god's standing, kept out of the DOM files so each line
// can be tested. The sim does the counting (query 'reach', Snapshot.reach, powersQuery's priceNow/locked/…); this file
// only says it in plain words. Rules of the owner: no alignment meter, no single bar between trust and fear, none of
// the words good / evil / kind / cruel / light / dark, the two bars never compared or coloured as right and wrong.

import type { ReachView } from '../sim/god/reach.ts';
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

/** the cost line on a power card, or null in an unbound world (no costs) */
export function costLine(p: Power): string | null {
  if (p.priceNow === undefined) return null;
  if (p.free && !(p.priceNow > 0)) return 'Free.';
  if (!(p.priceNow > 0)) return 'Free.';
  if (p.beyond) return `Beyond your standing: ${money(p.priceNow)} worship.`;
  if (p.price !== undefined && p.priceNow > p.price + 1e-9) return `Costs ${money(p.priceNow)} worship at this size.`;
  return `Costs ${money(p.priceNow)} worship.`;
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

export interface TownReach { pop?: number; believers?: number; trust?: number; fear?: number; gave?: number; spent?: boolean; trade?: boolean; unseen?: boolean; defiant?: boolean }

/** the town popover's lines (spec §6); only what is known is said */
export function townReachLines(t: TownReach): string[] {
  const out: string[] = [];
  if (t.believers !== undefined && t.pop !== undefined && t.pop > 0) {
    const road = (t.trust ?? 0) > (t.fear ?? 0) * 1.5 ? ', most in trust' : (t.fear ?? 0) > (t.trust ?? 0) * 1.5 ? ', most in fear' : ', in trust and in fear alike';
    out.push(`${t.believers} of ${t.pop} believe${t.believers > 0 ? road : ''}.${t.gave !== undefined ? ` They gave ${r0(t.gave)} yesterday.` : ''}`);
  }
  if (t.spent) out.push('They have given all they will today.');
  if (t.trade) out.push('Trade and pilgrims carry your name here.');
  if (t.unseen) out.push('You have not been seen here; they give less.');
  if (t.defiant) out.push('They count for nothing while they defy you.');
  return out;
}

/** a words-only fallback from the town's regard meters (no counts yet from the sim): one soft line, no numbers */
export function townRoadWords(regard: { trust: number; fear: number } | undefined): string | null {
  if (!regard) return null;
  const t = regard.trust, f = regard.fear;
  if (t < 0.15 && f < 0.15) return null;
  if (t >= 0.15 && f >= 0.15) return 'They give to you in trust and in fear.';
  return t >= 0.15 ? 'They give to you in trust.' : 'They give to you in fear.';
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

export type ReachSetting = 'unbound' | 'bound';
export const SETTING_CHOICES: { value: ReachSetting; label: string; title: string }[] = [
  { value: 'unbound', label: 'Unbound', title: 'Every power, anywhere, now: no standing, no worship to spend' },
  { value: 'bound', label: 'Belief bounds my power', title: 'What the people give, you may spend; the bigger miracles open as more follow you' },
];
export const SETTING_NOTE = 'Unbound: every power, anywhere, now. Belief bounds my power: your standing and the worship the people give set what you can do.';

/** the command for a position of the setting */
export function settingCommand(v: string): { k: 'meta.reach'; bound: boolean } { return { k: 'meta.reach', bound: v === 'bound' }; }

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

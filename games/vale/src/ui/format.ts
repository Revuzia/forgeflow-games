// VALE UI — number, time and rich-text formatting (WORLD §5 voice: exact numbers with units, "12 s",
// m:ss above a minute, thousands separators, tabular numerals for anything that changes).

import type { CatalogView } from './catalog_view.ts';

const NF = new Intl.NumberFormat('en-US');
const NF1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const fmtInt = (n: number): string => NF.format(Math.round(n));
export const fmtNum = (n: number): string => (Math.abs(n) >= 100 ? NF.format(Math.round(n)) : Number.isInteger(n) ? NF.format(n) : NF2.format(n));
export const fmt1 = (n: number): string => NF1.format(n);
export const fmtSigned = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtInt(Math.abs(n))}`;

/** "12 s" below a minute, "1:24" above */
export function fmtWait(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `${s} s` : fmtClock(s);
}
/** always m:ss */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const d = n % 10;
  return `${n}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`;
}
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const numberWord = (n: number): string => WORDS[n] ?? fmtInt(n);

export function fmtWhen(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `Today ${hm}`;
  const y = new Date(now - 86400000).toDateString() === d.toDateString();
  if (y) return `Yesterday ${hm}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── tooltip text: {placeholders} name Scaling paths in the record (catalog.ts AbilityCore.desc) ────
// Convention (documented for the CONTENT lane): `{effects.0.onHit.0.amount}` is a dot path from the
// record (ability / passive / spell / boon / item). A bare key (`{duration}`) resolves to the first
// field with that name, depth-first. Scaling values print as "60/90/120 (+80% bonus Attack)",
// fractions of keys like `power`/`percent`/`*Pct` print as %, durations get " s", distances " m".

export type DmgTone = 'physical' | 'magic' | 'true' | 'heal' | 'shield' | 'plain';
export interface ValueSeg { kind: 'value'; text: string; ratios: { text: string; tone: DmgTone }[]; tone: DmgTone; missing?: boolean }
export type Seg = { kind: 'text'; text: string } | ValueSeg;

const PCT_KEYS = /^(power|percent|.*Pct|crit|lifesteal|omnivamp|tenacity|healShieldPower|assistShare|sellRatio|p)$/;
const SEC_KEYS = /^(duration|cooldown|castTime|delay|interval|recharge|window|windup)$/;
const M_KEYS = /^(range|radius|distance|width|length|inner|minRange|passWidth)$/;

type Any = Record<string, unknown>;
interface Found { value: unknown; key: string; parent: Any | null }

function walkPath(root: unknown, path: string[]): Found | null {
  let cur: unknown = root, parent: Any | null = null, key = '';
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return null;
    parent = cur as Any;
    key = p;
    cur = Array.isArray(cur) ? (cur as unknown[])[Number(p)] : (cur as Any)[p];
    if (cur === undefined) return null;
  }
  return { value: cur, key, parent };
}
function findKey(root: unknown, key: string, depth = 0): Found | null {
  if (!root || typeof root !== 'object' || depth > 12) return null;
  if (!Array.isArray(root) && key in (root as Any)) return { value: (root as Any)[key], key, parent: root as Any };
  for (const v of Array.isArray(root) ? root : Object.values(root as Any)) {
    const f = findKey(v, key, depth + 1);
    if (f) return f;
  }
  return null;
}

function toneOf(parent: Any | null, key: string): DmgTone {
  if (!parent) return 'plain';
  if (parent.op === 'damage' && key === 'amount') return parent.type === 'magic' ? 'magic' : parent.type === 'true' ? 'true' : 'physical';
  if (parent.op === 'heal' && key === 'amount') return 'heal';
  if (parent.op === 'shield' && key === 'amount') return 'shield';
  return 'plain';
}

function unitFor(key: string, n: number): string {
  if (PCT_KEYS.test(key) && Math.abs(n) <= 5) return `${fmtNum(Math.round(n * 1000) / 10)}%`;
  if (SEC_KEYS.test(key)) return `${fmtNum(n)} s`;
  if (M_KEYS.test(key)) return `${fmtNum(n)} m`;
  return fmtNum(n);
}
function ranked(v: unknown, key: string): string {
  if (typeof v === 'number') return unitFor(key, v);
  if (Array.isArray(v)) {
    const nums = v.filter((x): x is number => typeof x === 'number');
    if (nums.every((x) => x === nums[0])) return unitFor(key, nums[0] ?? 0);
    const unit = unitFor(key, nums[0] ?? 0).replace(/^[-\d.,]+/, '');
    return nums.map((x) => unitFor(key, x).replace(unit, '')).join('/') + unit;
  }
  return '';
}

const RATIO_LABEL: Record<string, [string, string, DmgTone]> = {
  ad: ['stat.ad', 'Attack', 'physical'], bonusAd: ['stat.bonus_ad', 'bonus Attack', 'physical'], ap: ['stat.ap', 'Power', 'magic'],
  maxHp: ['stat.max_hp', 'max Health', 'plain'], bonusHp: ['stat.bonus_hp', 'bonus Health', 'plain'], armor: ['stat.armor', 'Armor', 'plain'],
  resist: ['stat.resist', 'Resist', 'plain'], maxRes: ['stat.max_res', 'max resource', 'plain'],
  targetMaxHp: ['stat.target_max_hp', "of the target's max Health", 'plain'], targetMissingHp: ['stat.target_missing_hp', "of the target's missing Health", 'plain'],
  targetCurrentHp: ['stat.target_current_hp', "of the target's current Health", 'plain'],
};

/** resolve a desc string into text + value segments */
export function richText(cv: CatalogView, record: unknown, desc: string): Seg[] {
  const out: Seg[] = [];
  const re = /\{([A-Za-z0-9_.]+)\}/g;
  let last = 0;
  for (const m of desc.matchAll(re)) {
    if (m.index! > last) out.push({ kind: 'text', text: desc.slice(last, m.index) });
    last = m.index! + m[0].length;
    const path = m[1].split('.');
    const f = walkPath(record, path) ?? (path.length === 1 ? findKey(record, path[0]) : null);
    if (!f) { out.push({ kind: 'value', text: '?', ratios: [], tone: 'plain', missing: true }); continue; }
    const tone = toneOf(f.parent, f.key);
    const v = f.value;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const s = v as Any;
      const ratios: ValueSeg['ratios'] = [];
      for (const [k, r] of Object.entries(s)) {
        if (k === 'base' || typeof r !== 'number') continue;
        if (k === 'level') { ratios.push({ text: `+${fmtNum(r)} per level`, tone: 'plain' }); continue; }
        const lab = RATIO_LABEL[k];
        if (lab) ratios.push({ text: `+${fmtNum(Math.round(r * 1000) / 10)}% ${cv.t(lab[0], lab[1])}`, tone: lab[2] });
      }
      const pc = s.perCounter as { per: number } | undefined, pm = s.perMark as { per: number } | undefined;
      if (pc) ratios.push({ text: `× ${fmtNum(pc.per)} per stack`, tone: 'plain' });
      if (pm) ratios.push({ text: `× ${fmtNum(pm.per)} per mark`, tone: 'plain' });
      out.push({ kind: 'value', text: ranked(s.base, f.key), ratios, tone });
    } else {
      out.push({ kind: 'value', text: ranked(v, f.key) || String(v), ratios: [], tone });
    }
  }
  if (last < desc.length) out.push({ kind: 'text', text: desc.slice(last) });
  return out;
}

/** plain-text version (aria labels, search) */
export function richPlain(segs: Seg[]): string {
  return segs.map((s) => (s.kind === 'text' ? s.text : s.text + (s.ratios.length ? ` (${s.ratios.map((r) => r.text).join(', ')})` : ''))).join('');
}

// HIT PARADE - THE SEASON copy + presentation helpers (lane UI; CONTRACT 26.3 season text by lane FIGHTERS, 27.4).
//
// Every line a season screen shows comes from the fighter files (introLine, winQuotes, banter, ending - CONTRACT 26.3)
// with strings.json as the fallback (banter.<a>.<b>, quote.<id>.n, ending.<id>, ending.default), so the cards never
// print an empty bubble while a fighter file is still being authored.
//   banterLines(a, b)  both sides' pre-fight lines, interleaved P1 1, P2 1, P1 2, P2 2 (each side from its own file:
//                      banter[<opponent>] else banter.default; a line wrapped in ( ) is a stage direction - THE FREAK)
//   introLine(id)      the VS-card line
//   winQuote(id, seed) one of winQuotes (seeded: both online screens and a rematch replay pick the same)
//   endingPages(id)    the ending text split into pages of whole sentences for the ending card sequence
//   bonusGrade(...)    S / A / B / C for a BRAWL BREAK / HECKLER TOSS result (presentation only, never scoring)

import type { UiFighterDef, UiGameData } from './types.ts';
import { fighter } from './data.ts';
import { has, pool, t, tOr } from './strings.ts';

export interface BanterLine { who: 0 | 1; text: string; direction: boolean }

function linesOf(f: UiFighterDef | null, vs: string): string[] {
  const b = f?.banter;
  if (!b) return [];
  const pick = b[vs] ?? b.default;
  return Array.isArray(pick) ? pick.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
}

/** both sides' pre-fight lines, interleaved; strings.json banter.<a>.<b> (one line a side) when a file has none */
export function banterLines(data: UiGameData, a: string, b: string): BanterLine[] {
  let la = linesOf(fighter(data, a), b);
  let lb = linesOf(fighter(data, b), a);
  if (!la.length && has(`banter.${a}.${b}`)) la = [t(`banter.${a}.${b}`)];
  if (!lb.length && has(`banter.${b}.${a}`)) lb = [t(`banter.${b}.${a}`)];
  const out: BanterLine[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i]) out.push({ who: 0, text: la[i], direction: /^\(.*\)$/.test(la[i].trim()) });
    if (lb[i]) out.push({ who: 1, text: lb[i], direction: /^\(.*\)$/.test(lb[i].trim()) });
  }
  return out;
}

export function introLine(data: UiGameData, id: string): string {
  const s = fighter(data, id)?.introLine;
  return typeof s === 'string' ? s.trim() : '';
}

/** a win quote: the fighter file's winQuotes, else strings quote.<id>.n, else quote.default.n; `seed` picks the line */
export function winQuote(data: UiGameData, id: string, seed: number): string {
  const q = fighter(data, id)?.winQuotes;
  const list = Array.isArray(q) && q.length ? q.filter((s) => typeof s === 'string' && s) : [];
  const src = list.length ? list : pool(`quote.${id}`).length ? pool(`quote.${id}`) : pool('quote.default');
  if (!src.length) return '';
  const k = Math.abs(Math.trunc(Number.isFinite(seed) ? seed : 0)) % src.length;
  return src[k];
}

/** the ending text split into pages of whole sentences (<= 2 sentences / ~190 chars a page) */
export function endingPages(data: UiGameData, id: string): string[] {
  const raw = fighter(data, id)?.ending;
  const text = (typeof raw === 'string' && raw.trim() ? raw : tOr(`ending.${id}`, t('ending.default'))).trim();
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const pages: string[] = [];
  let cur = '';
  let n = 0;
  for (const s of sentences) {
    if (cur && (n >= 2 || cur.length + s.length > 190)) { pages.push(cur); cur = ''; n = 0; }
    cur = cur ? `${cur} ${s}` : s;
    n++;
  }
  if (cur) pages.push(cur);
  return pages.length ? pages : [text];
}

export type Grade = 'S' | 'A' | 'B' | 'C';
/**
 * A letter for a bonus-round result (presentation: the score itself is the sim's SCORE sum).
 *   brawl   : goons put down in the round (S >= 16, A >= 12, B >= 7)
 *   heckler : share of the thrown objects parried (S >= 0.9, A >= 0.7, B >= 0.45); nothing thrown yet -> by score
 */
export function bonusGrade(mode: 'brawl' | 'heckler', t0: { goonsDown: number; heckles: number; parried: number; hitsTaken: number }): Grade {
  if (mode === 'brawl') {
    const n = t0.goonsDown;
    return n >= 16 ? 'S' : n >= 12 ? 'A' : n >= 7 ? 'B' : 'C';
  }
  const share = t0.heckles > 0 ? t0.parried / t0.heckles : 0;
  return share >= 0.9 ? 'S' : share >= 0.7 ? 'A' : share >= 0.45 ? 'B' : 'C';
}

/** the rules lines of a bonus card (strings card.<kind>.rule.n) */
export function bonusRules(kind: 'brawl' | 'heckler'): string[] {
  return pool(`card.${kind}.rule`);
}

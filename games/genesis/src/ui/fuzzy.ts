// GENESIS — fuzzy matching for the command palette (CONTRACT.md §16.2). DOM-free (tests/ui-logic.test.ts).
//
// A query matches a text when its characters appear in order. The score rewards what people mean when they type a
// few letters: a match at the start of the text or of a word, runs of consecutive characters, whole-word and prefix
// hits, and short texts; gaps cost a little. Several query words must each match (any order), so "rain blood" finds
// "Blood rain". Returns the matched character positions for highlighting.

export interface FuzzyHit {
  score: number;
  /** indices into the text of the matched characters */
  at: number[];
}

const WORD_SEP = /[\s\-_/.:,()·]/;

function isWordStart(t: string, i: number): boolean {
  return i === 0 || WORD_SEP.test(t[i - 1]) || (t[i - 1] === t[i - 1].toLowerCase() && t[i] !== t[i].toLowerCase());
}

/** best in-order match of one query word in a text (dynamic programming over positions, small strings) */
function matchWord(q: string, text: string, lower: string): FuzzyHit | null {
  const n = q.length, m = lower.length;
  if (!n) return { score: 0, at: [] };
  if (n > m) return null;
  // quick reject: characters in order at all?
  let k = 0;
  for (let i = 0; i < m && k < n; i++) if (lower[i] === q[k]) k++;
  if (k < n) return null;
  // exact substring: strongest signal
  const sub = lower.indexOf(q);
  if (sub >= 0) {
    const at: number[] = [];
    for (let i = 0; i < n; i++) at.push(sub + i);
    let score = 10 * n + (sub === 0 ? 30 : isWordStart(text, sub) ? 18 : 0);
    // a whole word
    if ((sub + n === m || WORD_SEP.test(lower[sub + n])) && isWordStart(text, sub)) score += 12;
    return { score, at };
  }
  // DP: best[i][j] = best score matching q[0..i] with q[i] at text position j
  const NEG = -1e9;
  let prev = new Float64Array(m).fill(NEG);
  const from: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const cur = new Float64Array(m).fill(NEG);
    const back = new Int32Array(m).fill(-1);
    let bestPrev = NEG, bestPrevAt = -1;
    for (let j = 0; j < m; j++) {
      // the best of prev[0..j-1] (gap allowed), and prev[j-1] (consecutive) handled separately
      if (i > 0 && j > 0 && prev[j - 1] > bestPrev) { bestPrev = prev[j - 1]; bestPrevAt = j - 1; }
      if (lower[j] !== q[i]) continue;
      const wordStart = isWordStart(text, j);
      const base = 4 + (wordStart ? 9 : 0);
      if (i === 0) { cur[j] = base + (j === 0 ? 14 : 0) - Math.min(6, j * 0.4); continue; }
      let s = NEG, b = -1;
      if (prev[j - 1] > NEG / 2) { s = prev[j - 1] + base + 7; b = j - 1; }
      if (bestPrevAt >= 0 && bestPrev > NEG / 2) {
        const gap = j - 1 - bestPrevAt;
        const g = bestPrev + base - Math.min(5, 1 + gap * 0.5);
        if (g > s) { s = g; b = bestPrevAt; }
      }
      cur[j] = s;
      back[j] = b;
    }
    from.push(back);
    prev = cur;
  }
  let best = NEG, bj = -1;
  for (let j = 0; j < m; j++) if (prev[j] > best) { best = prev[j]; bj = j; }
  if (bj < 0 || best < NEG / 2) return null;
  const at: number[] = new Array(n);
  let j = bj;
  for (let i = n - 1; i >= 0; i--) { at[i] = j; j = i > 0 ? from[i][j] : -1; }
  return { score: best, at };
}

/** score a query (one or more words) against a text; null = no match */
export function fuzzy(query: string, text: string): FuzzyHit | null {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, at: [] };
  const lower = text.toLowerCase();
  let score = 0;
  const at: number[] = [];
  for (const w of words) {
    const h = matchWord(w, text, lower);
    if (!h) return null;
    score += h.score;
    at.push(...h.at);
  }
  // shorter texts and fewer words rank higher for the same hits
  score -= Math.min(8, text.length * 0.08);
  at.sort((a, b) => a - b);
  return { score, at: [...new Set(at)] };
}

/**
 * Best score over a primary text and its alternatives (synonyms): a hit on the name counts fully, a hit on a synonym a
 * little less (it explains why the row is there).
 */
export function fuzzyAny(query: string, primary: string, alts: readonly string[] = [], altWeight = 0.82): { score: number; at: number[]; via: string | null } | null {
  const p = fuzzy(query, primary);
  let best: { score: number; at: number[]; via: string | null } | null = p ? { score: p.score, at: p.at, via: null } : null;
  for (const a of alts) {
    const h = fuzzy(query, a);
    if (h && (!best || h.score * altWeight > best.score)) best = { score: h.score * altWeight, at: [], via: a };
  }
  return best;
}

/** wrap matched characters in <mark> (text is escaped) */
export function highlight(text: string, at: readonly number[]): string {
  if (!at.length) return esc(text);
  const set = new Set(at);
  let out = '', open = false;
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m && !open) { out += '<mark>'; open = true; }
    if (!m && open) { out += '</mark>'; open = false; }
    out += esc(text[i]);
  }
  if (open) out += '</mark>';
  return out;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

// GENESIS — ARC §4 and §5, the UI's pure words: the covenant offer on the Decision card, the confirm a refused cast
// shows, the wrath slider's notch under "always gentle", the Promises rows of The god, the HUD age line, the title card,
// and the Book (query 'story', StoryView §5.3) laid out as blocks for the chronicle panel and its MD / HTML / TXT export.
//
// The sim composes every sacred line (the Book's paragraphs, the character lines, the epithet, the age names, the vow
// words of the chronicle). The UI only frames them: headings, the years under them, the order of §5.5, and the few
// button words the spec gives (§4.2 "in words", §4.4 confirm, §4.5 card). No slider number ever reaches sacred text.

import type { ChronicleEntry, Command, CommandResult, EntityRef, PlanetSnap, SettlementView, Vow } from '../sim/types.ts';
import type { Choice, ChoiceOption } from './decision.ts';
import { numWords } from './decision.ts';

// ───────────────────────────── the vows (§4.2) ─────────────────────────────

export const VOWS: readonly Vow[] = ['no-flood', 'spare-the-many', 'gentle', 'warn-first'];

/** the vow in words (§4.2 table: UI and chronicle) */
export const VOW_LABEL: Record<Vow, string> = {
  'no-flood': 'Never again by water',
  'spare-the-many': 'Never again so many',
  gentle: 'Always gentle',
  'warn-first': 'Always warn first',
};

/** what the god binds itself to, under each button (plain words, no slider numbers: §0.3 rule 9) */
export const VOW_SAYS: Record<Vow, string> = {
  'no-flood': 'no flood and no great wave from your hand.',
  'spare-the-many': 'you may still strike, but never take so many.',
  gentle: 'your harm will scare them, and most will live.',
  'warn-first': 'an omen or a prophet before every blow.',
};

/** "Aru", "Aru and Tesh", "Aru, Tesh and Vorn" (more than four: "Aru, Tesh, Vorn and two more") */
export function joinNames(names: readonly string[]): string {
  const n = names.filter(Boolean);
  if (!n.length) return '';
  if (n.length === 1) return n[0];
  const shown = n.length > 4 ? [...n.slice(0, 3), `${numWords(n.length - 3)} more`] : n;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** "Flood of Aru" / "the Flood of Aru" -> "the Flood of Aru" */
export function theName(name: string): string {
  const n = name.trim();
  return /^the\s/i.test(n) ? `the${n.slice(3)}` : `the ${n}`;
}

type Offer = NonNullable<PlanetSnap['covenantOffer']>;
type Names = Map<number, Pick<SettlementView, 'name'>>;

/** the covenant's choice (§4.5): the same card, placement and pill as the tower's */
export function covenantChoice(o: Offer, planet: number, names: Names): Choice {
  const title = `After ${theName(o.name)}`;
  const towns = o.towns.length;
  const meta = [o.dead > 0 ? `${numWords(o.dead)} dead` : 'no one died',
    towns === 1 ? 'one town struck' : `${numWords(towns)} towns struck`,
    o.household ? `${o.household} came through it whole` : ''].filter(Boolean).join(' · ');
  const options: ChoiceOption[] = VOWS.map((vow, i) => ({
    key: String(i + 1), id: vow, label: VOW_LABEL[vow], says: VOW_SAYS[vow],
    cmd: { k: 'covenant.make', vow, offer: o.id, planet } as Command,
  }));
  const where = joinNames(o.towns.map((id) => names.get(id)?.name ?? '').filter(Boolean));
  return {
    id: `covenant:${o.id}`,
    pill: title,
    title,
    meta,
    why: where ? `The survivors of ${where} look to the sky.` : 'The survivors look to the sky.',
    options,
  };
}

/** "Say nothing" (§4.2 covenant.decline: chronicled as silence) */
export function declineCommand(o: Pick<Offer, 'id'>, planet: number): Command {
  return { k: 'covenant.decline', offer: o.id, planet };
}

// ───────────────────────────── keeping and breaking (§4.4) ─────────────────────────────

export interface CovenantRefusal { kind: 'covenant'; covenant: number; vow: Vow }

/** the additive `CommandResult.refusal` (§6.4) when it is the covenant's */
export function covenantRefusal(r: CommandResult | null | undefined): CovenantRefusal | null {
  const f = (r as (CommandResult & { refusal?: unknown }) | null | undefined)?.refusal as Partial<CovenantRefusal> | undefined;
  return f && f.kind === 'covenant' && typeof f.covenant === 'number' ? { kind: 'covenant', covenant: f.covenant, vow: (f.vow ?? 'gentle') as Vow } : null;
}

/** the same command, sent again to break the promise ("Break it"): a cast gets `covenant: 'break'`, words get the clause */
export function breakCommand(c: Command): Command {
  if (c.k === 'freeform' && typeof c.text === 'string') {
    if (/\bbreak (my|the) (covenant|promise)\b/i.test(c.text)) return c;
    return { ...c, text: `${c.text.trim().replace(/[.!\s]+$/, '')}, and break my covenant` };
  }
  return { ...c, covenant: 'break' };
}

/** the names of a covenant's towns, from the planet's covenant view (or the settlement views that carry it) */
export function covenantTownNames(pv: { covenant?: PlanetSnap['covenant']; settlements: readonly Pick<SettlementView, 'id' | 'name' | 'covenant'>[] } | undefined, id: number): string[] {
  if (!pv) return [];
  const by = new Map(pv.settlements.map((s) => [s.id, s.name]));
  if (pv.covenant && pv.covenant.id === id) return pv.covenant.towns.map((t) => by.get(t) ?? '').filter(Boolean);
  return pv.settlements.filter((s) => s.covenant?.id === id).map((s) => s.name);
}

/** the confirm (§4.4 PLY): "This breaks your promise to the people of Aru. They will remember." */
export function confirmWords(towns: readonly string[], vow: Vow): { text: string; vow: string } {
  const who = towns.length ? `the people of ${joinNames(towns)}` : 'the people';
  return { text: `This breaks your promise to ${who}. They will remember.`, vow: `You promised: ${VOW_LABEL[vow].toLowerCase()}.` };
}

/** the wrath slider's notch (§4.4): at 0.3 while a kept `gentle` covenant holds on the planet */
export function wrathNotch(cov: PlanetSnap['covenant'] | undefined, towns: readonly string[]): { at: number; title: string } | null {
  if (!cov || cov.status !== 'kept' || cov.vow !== 'gentle') return null;
  return { at: 0.3, title: `Your promise to ${joinNames(towns) || 'them'}: always gentle` };
}

// ───────────────────────────── Promises (The god, §4.5) ─────────────────────────────

/** one covenant as `query('covenants')` gives it (§6.6: the record with townNames, yearsKept, vowWords) */
export interface CovenantRow {
  id: number; planet: number; made: number; vow: Vow; after: string; settlements: number[];
  household?: { id: number; name: string }; status: 'kept' | 'broken'; broken: number;
  townNames?: string[]; yearsKept?: number; vowWords?: string;
}

/** the covenants of `query('covenants')`, whether it answers a list or `{ covenants, offers }` */
export function covenantRows(q: unknown, planet?: number): CovenantRow[] {
  const list = Array.isArray(q) ? q : (q && typeof q === 'object' && Array.isArray((q as { covenants?: unknown }).covenants)) ? (q as { covenants: unknown[] }).covenants : [];
  return (list as CovenantRow[]).filter((c) => c && typeof c === 'object' && typeof c.vow === 'string' && typeof c.id === 'number' && (planet == null || c.planet == null || c.planet === planet))
    .sort((a, b) => a.made - b.made || a.id - b.id);
}

export interface PromiseLine { id: number; vow: string; status: string; kept: boolean; after: string; household: string; towns: string; look: number | null }

/** a row of the Promises section: its vow in words, "kept 14 years" / "broken in year N", the household, the towns */
export function promiseLine(c: CovenantRow, yearOf: (tick: number) => number, nowYear: number, names: Names): PromiseLine {
  const towns = c.townNames?.length ? c.townNames : c.settlements.map((s) => names.get(s)?.name ?? '').filter(Boolean);
  const years = c.yearsKept ?? Math.max(0, nowYear - yearOf(c.made));
  const status = c.status === 'broken'
    ? `broken in year ${yearOf(c.broken)}`
    : years < 1 ? 'kept since this year' : `kept ${numWords(years)} ${years === 1 ? 'year' : 'years'}`;
  return {
    id: c.id, vow: VOW_LABEL[c.vow] ?? c.vow, status, kept: c.status !== 'broken', after: c.after ? `after ${theName(c.after)}` : '',
    household: c.household?.name ?? '', towns: joinNames(towns), look: c.settlements[0] ?? null,
  };
}

/** the settlement inspector's line (§4.5): "Under the promise of year 140 (kept)" */
export function underPromise(cv: SettlementView['covenant'] | undefined): string {
  if (!cv) return '';
  return `Under the promise of year ${cv.year} (${cv.status === 'broken' ? 'broken' : 'kept'})`;
}

// ───────────────────────────── the age (§5.5) ─────────────────────────────

/** the HUD line under the date: the age's name (shown in small caps), and the year it began */
export function ageLine(age: PlanetSnap['age'] | undefined, sinceYear: number | null): { name: string; since: string } | null {
  if (!age || !age.name) return null;
  return { name: age.name, since: sinceYear != null && sinceYear > 0 ? `since year ${sinceYear}` : '' };
}

/** the title card when an age begins: "Here begins *The Scattering at Kel-Amar*." */
export function titleCard(name: string): { pre: string; name: string; post: string } {
  return { pre: 'Here begins', name: name.replace(/[.\s]+$/, ''), post: '.' };
}

/** watches the primary planet's age: a new age id (after the first one seen on this world) is a title card */
export class AgeWatch {
  private seen = new Map<number, number>();
  private world = '';
  private tick = -1;
  /** returns the age's name when a card should show now (a new world, a load or a rewind starts over: no card) */
  step(worldKey: string, planet: number, age: PlanetSnap['age'] | undefined, tick = 0): string | null {
    const jumped = this.tick >= 0 && (tick < this.tick - 1 || tick > this.tick + 3 * 1440);
    this.tick = tick;
    if (worldKey !== this.world || jumped) { this.world = worldKey; this.seen.clear(); }
    if (age === undefined) return null;
    const id = age ? age.id : -1;
    const was = this.seen.get(planet);
    this.seen.set(planet, id);
    return was !== undefined && was !== id && age && age.name ? age.name : null;
  }
}

// ───────────────────────────── the Book (§5.3, §5.5) ─────────────────────────────

export type PeopleChar = 'fear' | 'trust' | 'pride' | 'defiance' | 'faith' | 'forgetting' | 'many-minds';
export type GodChar = 'wrath' | 'mercy' | 'patience' | 'wonders' | 'silence' | 'faithfulness';
export interface StoryAge { id: number; name: string; kind: string; from: number; to: number | null; paragraphs: string[]; told?: string }
export interface StoryView {
  planet: number;
  title: string;
  opening: string;
  people: { character: PeopleChar; line: string };
  god: { character: GodChar; line: string; epithet: string };
  ages: StoryAge[];
  generations: string[];
  promises: string[];
  closing: string;
  note?: string;
}

/** a StoryView, or null when the answer is not one (the sim not built yet, a lookdev world) */
export function asStory(q: unknown): StoryView | null {
  const s = q as Partial<StoryView> | null;
  if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !Array.isArray(s.ages)) return null;
  return {
    planet: typeof s.planet === 'number' ? s.planet : 0, title: s.title, opening: s.opening ?? '',
    people: s.people ?? { character: 'many-minds', line: '' }, god: s.god ?? { character: 'silence', line: '', epithet: 'the god' },
    ages: s.ages.filter((a) => a && typeof a.name === 'string').map((a) => ({ ...a, paragraphs: Array.isArray(a.paragraphs) ? a.paragraphs : [] })),
    generations: Array.isArray(s.generations) ? s.generations : [], promises: Array.isArray(s.promises) ? s.promises : [],
    closing: s.closing ?? '', note: s.note,
  };
}

/** "years 31–44", "year 31", "since year 197" (an open age) */
export function ageYears(a: Pick<StoryAge, 'from' | 'to'>): string {
  if (a.to == null) return `since year ${a.from}`;
  if (a.to <= a.from) return `year ${a.from}`;
  return `years ${a.from}–${a.to}`;
}

export type BookBlock =
  | { t: 'title'; text: string }
  | { t: 'note'; text: string }
  | { t: 'opening'; text: string }
  | { t: 'character'; text: string; who: 'people' | 'god' }
  | { t: 'epithet'; text: string }
  | { t: 'age'; id: number; name: string; kind: string; years: string; paragraphs: string[]; told?: string; open: boolean }
  | { t: 'section'; name: string; lines: string[] }
  | { t: 'closing'; text: string };

/** the Book's order (§5.5): title, opening, the two character lines, what they call you, the ages oldest first,
 *  Generations, Promises, the closing line (a migrated world's note under the title) */
export function bookBlocks(s: StoryView): BookBlock[] {
  const out: BookBlock[] = [{ t: 'title', text: s.title }];
  if (s.note) out.push({ t: 'note', text: s.note });
  if (s.opening) out.push({ t: 'opening', text: s.opening });
  if (s.people.line) out.push({ t: 'character', text: s.people.line, who: 'people' });
  if (s.god.line) out.push({ t: 'character', text: s.god.line, who: 'god' });
  out.push({ t: 'epithet', text: s.god.epithet || 'the god' });
  for (const a of [...s.ages].sort((x, y) => x.from - y.from || x.id - y.id)) {
    out.push({ t: 'age', id: a.id, name: a.name, kind: a.kind, years: ageYears(a), paragraphs: a.paragraphs, told: a.told, open: a.to == null });
  }
  if (s.generations.length) out.push({ t: 'section', name: 'Generations', lines: s.generations });
  if (s.promises.length) out.push({ t: 'section', name: 'Promises', lines: s.promises });
  if (s.closing) out.push({ t: 'closing', text: s.closing });
  return out;
}

/** the export's file name: "The Book of the {people} of {planet}.md" (only characters a file system refuses go) */
export function bookFileName(s: Pick<StoryView, 'title'>, fmt: 'md' | 'html' | 'txt'): string {
  const base = (s.title || 'The Book').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base}.${fmt}`;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));

/** the Book as a document (§5.5 Export): every age heading, in the panel's order */
export function bookExport(s: StoryView, fmt: 'md' | 'html' | 'txt'): string {
  const B = bookBlocks(s);
  if (fmt === 'md') {
    let o = '';
    for (const b of B) {
      switch (b.t) {
        case 'title': o += `# ${b.text}\n\n`; break;
        case 'note': o += `_${b.text}_\n\n`; break;
        case 'opening': o += `${b.text}\n\n`; break;
        case 'character': o += `${b.text}\n\n`; break;
        case 'epithet': o += `What they call you: **${b.text}**\n\n`; break;
        case 'age': o += `## ${b.name}\n\n_${b.years}_\n\n${b.paragraphs.map((p) => `${p}\n\n`).join('')}${b.told ? `> _${b.told}_\n\n` : ''}`; break;
        case 'section': o += `## ${b.name}\n\n${b.lines.join(' ')}\n\n`; break;
        case 'closing': o += `---\n\n_${b.text}_\n`; break;
      }
    }
    return o;
  }
  if (fmt === 'txt') {
    let o = '';
    for (const b of B) {
      switch (b.t) {
        case 'title': o += `${b.text.toUpperCase()}\n${'='.repeat(b.text.length)}\n\n`; break;
        case 'note': case 'opening': case 'character': o += `${b.text}\n\n`; break;
        case 'epithet': o += `What they call you: ${b.text}\n\n`; break;
        case 'age': o += `${b.name.toUpperCase()}\n(${b.years})\n\n${b.paragraphs.map((p) => `${p}\n`).join('')}${b.told ? `\n  ${b.told}\n` : ''}\n`; break;
        case 'section': o += `${b.name.toUpperCase()}\n\n${b.lines.join(' ')}\n\n`; break;
        case 'closing': o += `* * *\n\n${b.text}\n`; break;
      }
    }
    return o;
  }
  let body = '';
  for (const b of B) {
    switch (b.t) {
      case 'title': body += `<h1>${esc(b.text)}</h1>`; break;
      case 'note': body += `<p class="note">${esc(b.text)}</p>`; break;
      case 'opening': body += `<p class="opening">${esc(b.text)}</p>`; break;
      case 'character': body += `<p class="char">${esc(b.text)}</p>`; break;
      case 'epithet': body += `<p class="epithet">What they call you: <b>${esc(b.text)}</b></p>`; break;
      case 'age': body += `<h2>${esc(b.name)}</h2><p class="years">${esc(b.years)}</p>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${b.told ? `<p class="told">${esc(b.told)}</p>` : ''}`; break;
      case 'section': body += `<h2>${esc(b.name)}</h2><p>${esc(b.lines.join(' '))}</p>`; break;
      case 'closing': body += `<p class="closing">${esc(b.text)}</p>`; break;
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(s.title)}</title><style>
body{background:#0b0e16;color:#efe7d6;font:18px/1.65 'Cormorant Garamond',Georgia,serif;max-width:38em;margin:3em auto;padding:0 1.5em}
h1{font-weight:500;letter-spacing:.06em;color:#f3dfae;font-size:2em;text-align:center;margin-bottom:.2em}
h2{font-weight:500;color:#f3dfae;letter-spacing:.04em;margin:2em 0 0;font-size:1.35em}
.years{font:12px Inter,system-ui,sans-serif;color:#9c968a;letter-spacing:.08em;margin:.1em 0 .8em}
.opening{font-style:italic;text-align:center}.char{margin:.2em 0}.epithet{color:#d9b878;margin:1em 0 1.5em}
.told{font-style:italic;color:#d9c9a4;border-left:2px solid rgba(217,184,120,.4);padding-left:.8em}
.note{font-size:.9em;color:#9c968a;text-align:center;font-style:italic}.closing{text-align:center;font-style:italic;margin-top:2.5em;color:#f3dfae}
p{margin:.45em 0}
</style></head><body>${body}</body></html>`;
}

// ───────────────────────────── a paragraph's place (§5.5: lines inside an age fly there) ─────────────────────────────

const norm = (t: string) => t.replace(/^Year \d+[.,:]\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** the chronicle entry a paragraph was made from (the sim strips "Year N." and keeps the words), and where it was */
export function paragraphPlace(p: string, entries: readonly ChronicleEntry[], planet: number): EntityRef | null {
  const n = norm(p);
  if (n.length < 12) return null;
  let best: ChronicleEntry | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.planet !== planet || !e.refs?.length) continue;
    const m = norm(e.text);
    if (m.length < 12) continue;
    if (m === n) { best = e; break; }
    if (!best && m.length >= 24 && (n.includes(m) || m.includes(n))) best = e;
  }
  if (!best) return null;
  for (const r of best.refs ?? []) {
    if (r.kind === 'settlement' || r.kind === 'agent' || r.kind === 'disaster' || r.kind === 'building') return { ...r, planet: r.planet ?? best.planet };
  }
  return null;
}

// ───────────────────────────── words that open the Book (§6.5 UI intent `open-book`) ─────────────────────────────

const OPEN_BOOK = /\b(tell me (our|the|their|its) story|read (me )?(the|our|their) (story|book)|what kind of (people are they|god am i)|open the book)\b/i;

/** "tell me our story", "read the story of Aru", "what kind of god am I": the Book opens (the sim answers in words too);
 *  returns the town named after "of", if any */
export function openBookIntent(text: string): { open: boolean; town: string | null } {
  if (!OPEN_BOOK.test(text)) return { open: false, town: null };
  const m = /\b(?:story|book) of ([\w][\w' -]*?)[.?!]*$/i.exec(text.trim());
  return { open: true, town: m ? m[1].trim() : null };
}

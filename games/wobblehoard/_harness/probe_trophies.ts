// UI B6b probe: the numbers and words behind the Trophies and Records screens (src/ui/trophiesData.ts), measured from OUTSIDE the code under test against the REAL evaluator
// (core/achievements.ts), the REAL stacks of a seeded Hoard (collection/stacks.ts over real rows), and the data file. Plain node; exits 1 on failure. The DOM side of the screen
// (cards, switch, filter, keyboard, modes) is _harness/uikit/trophies_check.mjs.
//   D  states: earned / locked / hidden are told apart by the evaluator's facts; a hidden trophy that is not earned never leaks its name or its condition
//   T  tier counts and points: 8 / 7 / 3 / 2 rows = 355 XP; for 300 random earned sets the screen's numbers equal the evaluator's (earnedCount, earnedPoints)
//   F  filters: each tier shows exactly its rows, in the data file's order
//   R  Records: every tile is a real counter and every counter (but the species one, which is the Hoard's own number) has a tile; nothing is shown that nothing records
//   H  Hoard facts: species, squishies, rarest and the rarity bars equal an independent count over the same rows
//   W  words: kind wording (no loss, no streak, no timer, no "missed"); the scan of the screen's source for what must not be there (a storage write, a network call, innerHTML)
//   C  colour: the screen's new pairs measured with theme.ts's own formula (ink on each medal tint, text on the earned-card tint, the status tick)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS, ACH_TIERS, ACH_TOTAL_POINTS, COUNTER_KEYS, createEvaluator, emptyAchSave } from '../src/core/achievements.ts';
import type { AchSave } from '../src/core/achievements.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { TIERS, TIER_SPECIES_COUNTS } from '../src/core/rarity.ts';
import { CATALOG, speciesBaseGenome } from '../src/data/catalog.ts';
import { FLAG_SEEN, makeRow, rowToItem } from '../src/collection/store.ts';
import { buildStacks } from '../src/collection/stacks.ts';
import { DERIVED, MEDALS, PALETTE, contrastRatio, mixHex } from '../src/ui/theme.ts';
import {
  FILTERS, HIDDEN_LINE, HIDDEN_NAME, RECORD_TILES, TIER_RANK, TIER_WORDS, conditionOf, countLine, filterLine, filterRows, heroNote, hoardFacts, nameOf, rarestLine, recordTiles,
  sinceLine, statusWord, tierCounts, trophyRowsOf,
} from '../src/ui/trophiesData.ts';

let bad = 0, total = 0;
const check = (id: string, name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${name}${extra ? '  ' + extra : ''}`); };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(resolve(here, '..', p), 'utf8');
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

const evalWith = (earned: readonly string[], counters: Partial<AchSave['counters']> = {}) => {
  const save = emptyAchSave(NOW);
  earned.forEach((s, i) => { save.earned[s] = NOW + i; });
  Object.assign(save.counters, counters);
  return createEvaluator({ save, now: () => NOW, onUnlock: () => {} });
};
const slugs = ACHIEVEMENTS.map((d) => d.slug);
const hiddenSlugs = ACHIEVEMENTS.filter((d) => d.hidden).map((d) => d.slug);

/* ═══════════════════════ D: states ═══════════════════════ */
{
  const none = trophyRowsOf(evalWith([]));
  const all = trophyRowsOf(evalWith(slugs));
  check('D01', `20 rows in the data file's order; none earned: every hidden row is "hidden" (${hiddenSlugs.join(', ')}), the rest "locked"`,
    none.length === 20 && none.every((r, i) => r.def.slug === slugs[i]) && none.every((r) => r.state === (r.def.hidden ? 'hidden' : 'locked') && r.at === null));
  check('D02', 'all earned: every row is "earned" with its stamp, hidden ones included (found = shown)', all.length === 20 && all.every((r) => r.state === 'earned' && typeof r.at === 'number'));
  const one = trophyRowsOf(evalWith([hiddenSlugs[0]]));
  check('D03', 'one hidden trophy earned shows as earned (its real name and condition), the other hidden one stays hidden',
    one.find((r) => r.def.slug === hiddenSlugs[0])!.state === 'earned' && one.find((r) => r.def.slug === hiddenSlugs[1])!.state === 'hidden');
  const leak = none.filter((r) => r.state === 'hidden').every((r) => nameOf(r) === HIDDEN_NAME && conditionOf(r) === HIDDEN_LINE && !nameOf(r).includes(r.def.name) && !conditionOf(r).toLowerCase().includes(r.def.description.toLowerCase().replace(/\.$/, '')));
  check('D04', 'a hidden trophy that is not earned says "???" and the fixed line: its real name and condition appear nowhere in the strings the screen draws', leak && none.filter((r) => r.state === 'hidden').length === 2);
  const shown = none.filter((r) => r.state === 'locked').every((r) => nameOf(r) === r.def.name && conditionOf(r) === r.def.description);
  check('D05', 'a locked (not hidden) trophy shows its real name and condition (the player may aim for it)', shown);
  const ev = evalWith([], { species: 7 });
  const sp = trophyRowsOf(ev).filter((r) => r.progress);
  check('D06', 'progress exists only on the species rows (10, 25, 40, 50), capped at the target: 7 species -> 7 of 10, 7 of 25, 7 of 40, 7 of 50',
    eqArr(sp.map((r) => r.def.slug), ['species_10', 'species_25', 'species_40', 'all_fifty']) && sp.every((r) => r.progress!.value === 7 && r.progress!.target === r.def.trigger.min));
  const big = trophyRowsOf(evalWith([], { species: 99 })).find((r) => r.def.slug === 'species_10')!;
  check('D07', 'progress never passes its target (99 species -> 10 of 10)', big.progress!.value === 10 && big.progress!.target === 10);
  check('D08', 'status words: Earned / Hidden / Not yet', statusWord(all[0]) === 'Earned' && statusWord(none.find((r) => r.state === 'hidden')!) === 'Hidden' && statusWord(none[0]) === 'Not yet');
}
function eqArr(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((x, i) => x === b[i]); }

/* ═══════════════════════ T: counts and points ═══════════════════════ */
{
  const none = tierCounts(trophyRowsOf(evalWith([])));
  check('T01', 'totals: bronze 8, silver 7, gold 3, diamond 2, all 20; points 40 + 105 + 90 + 120 = 355 = ACH_TOTAL_POINTS',
    none.bronze.total === 8 && none.silver.total === 7 && none.gold.total === 3 && none.diamond.total === 2 && none.all.total === 20 && none.bronze.points === 40 && none.silver.points === 105 && none.gold.points === 90 && none.diamond.points === 120 && none.all.points === 355 && ACH_TOTAL_POINTS === 355);
  const rnd = mulberry32(2026);
  let ok = true, first = '';
  for (let k = 0; k < 300; k++) {
    const set = slugs.filter(() => rnd() < 0.4);
    const ev = evalWith(set);
    const c = tierCounts(trophyRowsOf(ev));
    const per = ACH_TIERS.reduce((n, t) => n + c[t].earned, 0);
    const pts = ACH_TIERS.reduce((n, t) => n + c[t].earnedPoints, 0);
    if (c.all.earned !== ev.earnedCount() || c.all.earnedPoints !== ev.earnedPoints() || per !== c.all.earned || pts !== c.all.earnedPoints || c.all.earned !== set.length) { ok = false; first = first || set.join(','); }
  }
  check('T02', 'for 300 random earned sets the screen\'s counts and XP equal the evaluator\'s earnedCount() / earnedPoints(), and the four tiers add up to "all"', ok, first);
  check('T03', 'the count line, the hero sentence and the filter line (kind wording: no "missed", no "lost", no "behind")',
    countLine(7, 20) === '7 / 20' && heroNote(0, 20) === 'Trophies arrive as you play, at your own pace.' && heroNote(20, 20) === 'Every trophy found. Nicely done.' && heroNote(9, 20) === '11 still to find.' && filterLine('gold', { earned: 1, total: 3, points: 90, earnedPoints: 30 }) === 'Gold trophies: 1 of 3 earned.' && filterLine('all', { earned: 9, total: 20, points: 355, earnedPoints: 65 }) === 'All trophies: 9 of 20 earned.');
  check('T04', 'rank pips: bronze 1, silver 2, gold 3, diamond 4; the tier words are plain', TIER_RANK.bronze === 1 && TIER_RANK.silver === 2 && TIER_RANK.gold === 3 && TIER_RANK.diamond === 4 && TIER_WORDS.diamond === 'Diamond');
}

/* ═══════════════════════ F: filters ═══════════════════════ */
{
  const rows = trophyRowsOf(evalWith(['first_squish', 'tier_up']));
  const okTier = ACH_TIERS.every((t) => { const f = filterRows(rows, t); return f.length === ACHIEVEMENTS.filter((d) => d.tier === t).length && f.every((r) => r.def.tier === t) && eqArr(f.map((r) => r.def.slug), ACHIEVEMENTS.filter((d) => d.tier === t).map((d) => d.slug)); });
  check('F01', 'each tier filter shows exactly that tier\'s rows in the data file\'s order; "all" shows 20; the chip order is All, Bronze, Silver, Gold, Diamond', okTier && filterRows(rows, 'all').length === 20 && FILTERS.join() === 'all,bronze,silver,gold,diamond');
}

/* ═══════════════════════ R: Records ═══════════════════════ */
{
  const c = { squeezes: 1, stretches: 2, tosses: 3, cuts: 4, joins: 5, capsules: 6, merges: 7, tasks: 8, species: 9 };
  const tiles = recordTiles(c);
  const ids = tiles.map((t) => t.id);
  check('R01', `every tile is a real counter of the save (${ids.join(', ')}); every counter except "species" has a tile; labels are unique; the value is the counter's`,
    ids.every((i) => (COUNTER_KEYS as readonly string[]).includes(i)) && COUNTER_KEYS.filter((k) => k !== 'species').every((k) => ids.includes(k as never)) && new Set(RECORD_TILES.map((t) => t.label)).size === RECORD_TILES.length && tiles.every((t) => t.value === c[t.id]));
  const src = read('src/ui/trophiesData.ts') + read('src/ui/later-trophies.ts');
  check('R02', 'nothing is shown that nothing records: no play time, no longest stretch (grep over the two source files)', !/play ?time|playMs|longest|maxStretch|bestStretch/i.test(src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  // the same numbers in the real game: every counter the tile reads is bumped by a real trigger (core/achievements.ts), checked by name
  const ach = read('src/core/achievements.ts');
  check('R03', 'every tile counter is bumped in the evaluator (bump(\'squeezes\' | \'stretches\' | \'tosses\' | \'cuts\' | \'joins\' | \'capsules\' | \'merges\' | \'tasks\'))', ids.every((i) => new RegExp(`bump\\('${i}'\\)`).test(ach)), ids.filter((i) => !new RegExp(`bump\\('${i}'\\)`).test(ach)).join());
  check('R04', 'the since line: the date, and the honest note that earlier play is not counted', sinceLine('8 Oct 2026') === 'Counting started 8 Oct 2026. Play before that is not counted.');
}

/* ═══════════════════════ H: the Hoard's numbers ═══════════════════════ */
{
  const rnd = mulberry32(77);
  let ok = true, why = '';
  for (let run = 0; run < 40; run++) {
    const items = [];
    const n = Math.floor(rnd() * 90);
    for (let i = 0; i < n; i++) {
      const d = CATALOG[Math.floor(rnd() * (rnd() < 0.7 ? 20 : CATALOG.length))];
      items.push(rowToItem(makeRow(`g-${(run * 100 + i).toString(36).padStart(12, '0')}`, speciesBaseGenome(d.id, i), NOW - i * 1000, FLAG_SEEN, 'drop'), 'practice')!);
    }
    const stacks = buildStacks(items, 'practice', NOW);
    const f = hoardFacts(stacks);
    // an independent count over the items themselves
    const bySp = new Map<string, number>();
    for (const it of items) bySp.set(it.species, (bySp.get(it.species) ?? 0) + 1);
    const owned = [...bySp.keys()];
    const tiers = owned.map((s) => CATALOG.find((d) => d.id === s)!.tier);
    const per = TIERS.map((t) => tiers.filter((x) => x === t).length);
    const topIdx = tiers.length ? Math.max(...tiers.map((t) => TIERS.indexOf(t))) : -1;
    const topNames = owned.filter((s) => TIERS.indexOf(CATALOG.find((d) => d.id === s)!.tier) === topIdx).map((s) => CATALOG.find((d) => d.id === s)!.name).sort();
    const good = f.species === owned.length && f.total === 50 && f.squishies === items.length && eqArr(f.bars.map((b) => String(b.owned)), per.map(String)) && eqArr(f.bars.map((b) => String(b.total)), TIER_SPECIES_COUNTS.map(String))
      && (topIdx < 0 ? f.rarest === null : !!f.rarest && f.rarest.tier === TIERS[topIdx] && eqArr([...f.rarest.names].sort(), topNames)) && f.bars.reduce((a, b) => a + b.owned, 0) === f.species;
    if (!good) { ok = false; why = `run ${run}: ${JSON.stringify(f)}`; break; }
  }
  check('H01', 'for 40 random Hoards (0 to 90 squishies) species, squishies, the rarest tier and its names, and the six rarity bars equal an independent count over the same rows', ok, why);
  const empty = hoardFacts([]);
  check('H02', 'an empty Hoard: 0 species, 0 squishies, rarest null ("Nothing yet"), six empty bars with the real totals 14 / 11 / 10 / 7 / 5 / 3',
    empty.species === 0 && empty.squishies === 0 && empty.rarest === null && rarestLine(empty.rarest) === 'Nothing yet' && eqArr(empty.bars.map((b) => `${b.owned}/${b.total}`), ['0/14', '0/11', '0/10', '0/7', '0/5', '0/3']));
  check('H03', 'rarestLine: one species names it ("Legendary: Dollop"), several count them ("Epic: 3 species")', rarestLine({ tier: 'legendary', name: 'Legendary', names: ['Dollop'] }) === 'Legendary: Dollop' && rarestLine({ tier: 'epic', name: 'Epic', names: ['a', 'b', 'c'] }) === 'Epic: 3 species');
}

/* ═══════════════════════ W: words and what must not be in the screen ═══════════════════════ */
{
  const uiSrc = read('src/ui/later-trophies.ts'), dataSrc = read('src/ui/trophiesData.ts'), openSrc = read('src/shell/trophiesOpen.ts'), css = read('src/ui/trophies.css');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const words = [...strip(dataSrc + uiSrc + openSrc).matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)].map((m) => m[1] ?? m[2]).filter((s) => /[A-Za-z]{4,} [A-Za-z]{3,}/.test(s));
  const banned = /\b(lost|loses|missed|miss|expire|expired|expires|hurry|streak|only \d+ left|don'?t miss|last chance|behind|failed|you have not|you haven'?t)\b/i;
  const hits = words.filter((w) => banned.test(w));
  check('W01', `kind wording: none of ${words.length} player-facing strings of the screen has loss, streak, timer or shame words`, hits.length === 0, hits.join(' | '));
  check('W02', 'no storage write, no network call, no innerHTML in the screen (it only reads and draws; text goes through textContent)', !/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|postMessage|innerHTML|insertAdjacentHTML|eval\(|new Function/.test(strip(uiSrc + dataSrc)));
  check('W03', 'the account line is set with textContent from accountLine() and never from a name (the bridge never reads one)', /accountLine\(o\.trophies\.bridge\.state\)/.test(uiSrc) && !/\.displayName|\.username|\.email|\.avatar/.test(uiSrc));
  check('W04', 'strict CSP: no style attribute written as text (setAttribute(\'style\'), cssText, style=), styles only through the CSSOM', !/setAttribute\(\s*['"]style|cssText|style\s*=\s*['"`]/.test(strip(uiSrc)));
  check('W05', 'the chunk is named later-*: the entry file is src/ui/later-trophies.ts and the first-play launcher imports it dynamically only (no static import of it anywhere in src)', (() => {
    const all = ['src/shell/hudBinding.ts', 'src/shell/boot.ts', 'src/shell/trophiesOpen.ts', 'src/ui/menu.ts'].map(read).join('\n');
    return /import\('\.\.\/ui\/later-trophies\.ts'\)/.test(openSrc) && !/^import (?!type)[^\n]*later-trophies/m.test(all);
  })());
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  check('W06', 'no raw hex colour, no `transition: all`, no z-index in trophies.css (tokens only; forced-colors and contrast-more are handled)', !/#[0-9a-fA-F]{3,8}\b/.test(rules) && !/transition:\s*all/.test(rules) && !/z-index/.test(rules) && /forced-colors: active/.test(rules) && /prefers-contrast: more/.test(rules));
}

/* ═══════════════════════ C: colour ═══════════════════════ */
{
  const ink = PALETTE.ink;
  let worst = 99, which = '';
  for (const t of ACH_TIERS) {
    const tier = MEDALS[t];
    // the medal: ink icon on the tier colour and on the bright first stop (the icon sits near the centre of the radial gradient)
    for (const [name, bg] of [['tier', tier], ['bright stop', mixHex(tier, PALETTE.cream, 0.52)], ['dark stop', mixHex(tier, ink, 0.2)]] as const) {
      const r = contrastRatio(ink, bg);
      if (r < worst) { worst = r; which = `${t} ${name}`; }
    }
  }
  check('C01', `the medal icon (ink) on every tier colour's three gradient stops is >= 3 (graphics); worst ${worst.toFixed(2)} (${which})`, worst >= 3);
  let worstT = 99, whichT = '';
  for (const t of ACH_TIERS) {
    const bg = mixHex(DERIVED.surface2, MEDALS[t], 0.12);
    for (const [name, fg] of [['cream', PALETTE.cream], ['dim', DERIVED.creamDim], ['ok', DERIVED.ok]] as const) {
      const r = contrastRatio(fg, bg);
      if (r < worstT) { worstT = r; whichT = `${t} ${name}`; }
    }
  }
  check('C02', `text on the earned card's tint (12 % of the tier colour over surface2): cream, dim and the green "Earned" are all >= 4.5; worst ${worstT.toFixed(2)} (${whichT})`, worstT >= 4.5);
  let worstD = 99;
  for (const t of ACH_TIERS) worstD = Math.min(worstD, contrastRatio(MEDALS[t], DERIVED.panel));
  check('C03', `the locked medal's dashed ring and the hollow pips (tier colour on the panel) are >= 3; worst ${worstD.toFixed(2)}`, worstD >= 3);
  check('C04', `a locked card's text on the panel: dim >= 4.5 (${contrastRatio(DERIVED.creamDim, DERIVED.panel).toFixed(2)}), cream >= 4.5 (${contrastRatio(PALETTE.cream, DERIVED.panel).toFixed(2)})`, contrastRatio(DERIVED.creamDim, DERIVED.panel) >= 4.5 && contrastRatio(PALETTE.cream, DERIVED.panel) >= 4.5);
  check('C05', `the Records numerals (amber) on the tile surface (surface2): ${contrastRatio(PALETTE.amber, DERIVED.surface2).toFixed(2)} >= 4.5`, contrastRatio(PALETTE.amber, DERIVED.surface2) >= 4.5);
}

console.log(`\n${total - bad}/${total} checks passed`);
process.exit(bad ? 1 : 0);

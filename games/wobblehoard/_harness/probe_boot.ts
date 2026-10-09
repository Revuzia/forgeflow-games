// Title and boot probe (plain node, exits 1 on failure; UI.md B2b): the static loading card of index.html against the real jelly glyph table and the
// theme tokens (it duplicates data by necessity: it paints before any script), the boot card's pure helpers, the title's copy, and a STATIC audit of
// title.css / jelly.css / boot.css. No DOM, no browser: the pictures and the live checks are _harness/uikit/title_shots.mjs and title_checks.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ADV, GLYPHS, glyphFor } from '../src/ui/jelly/glyphs.ts';
import { jellyWidth } from '../src/ui/jelly/jelly.ts';
import { BOOT_LINES, BOOT_TOTAL, bootFill, bootLineIndex } from '../src/ui/bootCard.ts';
import { CTA_LABEL, INTRO_MS, STATUS_READY, STATUS_WARMING, TAGLINE, WORD } from '../src/ui/titleCopy.ts';
import { DERIVED, JELLY, PALETTE, mixHex } from '../src/ui/theme.ts';

let bad = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** The property names declared inside every @keyframes frame of a stylesheet (brace matching, comments already stripped). */
function keyframeProps(css: string): string[] {
  const out: string[] = [];
  for (let at = css.indexOf('@keyframes'); at >= 0; at = css.indexOf('@keyframes', at + 1)) {
    const open = css.indexOf('{', at);
    let depth = 1, i = open + 1;
    for (; i < css.length && depth; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; }
    const body = css.slice(open + 1, i - 1);
    for (const frame of body.matchAll(/[^{}]+{([^{}]*)}/g)) for (const d of frame[1].split(';')) { const n = d.split(':')[0].trim(); if (n) out.push(n); }
  }
  return out;
}

const html = read('index.html');
const bootCss = read('src/ui/boot.css');
const titleCss = stripComments(read('src/ui/title.css'));
const jellyCss = stripComments(read('src/ui/jelly/jelly.css'));

// ============================================================ the loading card (index.html)
{
  const card = /<div id="boot"[\s\S]*?<\/div>\s*(?=<noscript>)/.exec(html)?.[0] ?? '';
  check('boot card: #boot is a polite status region, starts at step 0 and its first line is the first boot line', /<div id="boot" role="status" aria-live="polite" data-step="0">/.test(card) && card.includes(`<p class="boot-line" id="boot-line">${BOOT_LINES[0]}</p>`));
  check('boot card: the watchdog line and its Reload link are in the markup (CSS shows them after 12 s)', /<p class="boot-slow">[^<]*<a href="\.\/">Reload<\/a>/.test(card) && /\.boot-slow \{[^}]*animation: bt-slow \.01s linear 12s forwards/.test(bootCss));
  const mark = /<div class="boot-mark"[\s\S]*?<\/svg>\s*<\/div>/.exec(card)?.[0] ?? '';
  check('boot card: the wordmark SVG is within its 2.6 KB budget (UI.md 5)', mark.length > 0 && mark.length <= 2600, `${mark.length} B`);
  check('boot card: the wordmark reads SQUISH KEEPER to assistive tech and draws nothing else (the drawings are aria-hidden)', /role="img" aria-label="SQUISH KEEPER"/.test(mark) && (mark.match(/<svg [^>]*aria-hidden="true"/g) ?? []).length === 2);
  // every glyph path is the jelly table's, byte for byte
  const paths = [...mark.matchAll(/<path id="bt-(.)" d="([^"]+)"\/>/g)];
  check('boot card: every drawn letter is a glyph of the jelly table, path for path', paths.length === 9 && paths.every(([, c, d]) => GLYPHS[c]?.[1] === d), paths.map((p) => p[1]).join(''));
  // the word groups lay the letters out with the table's advances
  const wordUses = (id: string): Array<[string, number]> => [...(new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(mark)?.[1] ?? '').matchAll(/<use href="#bt-(.)"(?: x="(\d+)")?\/>/g)].map((m) => [m[1], Number(m[2] ?? 0)]);
  const expect = (t: string): Array<[string, number]> => { let x = 0; return [...t].map((ch) => { const r: [string, number] = [ch, x]; x += glyphFor(ch)![0] + ADV; return r; }); };
  check('boot card: SQUISH and KEEPER are laid out with the table advances (ADV 10)', JSON.stringify(wordUses('bt-wa')) === JSON.stringify(expect('SQUISH')) && JSON.stringify(wordUses('bt-wb')) === JSON.stringify(expect('KEEPER')));
  const vb = [...mark.matchAll(/viewBox="-6 -9 (\d+) 124"/g)].map((m) => Number(m[1]));
  check('boot card: each drawing\'s viewBox is its word\'s width + 12 (the jelly padding), and boot.css sizes it by the same units', vb.join() === `${jellyWidth('SQUISH') + 12},${jellyWidth('KEEPER') + 12}` && /\.bt-a \{ width: calc\(var\(--cap\) \* 4\.14\); \}/.test(bootCss) && /\.bt-b \{ width: calc\(var\(--cap\) \* 4\.67\); \}/.test(bootCss), vb.join(' / '));
  // the amber body gradient and the shade are the jelly amber tone
  const s = JELLY.amber;
  const stops = [...mark.matchAll(/<stop offset="([\d.]+)" stop-color="(#[0-9a-f]{6})"\/>/g)].map((m) => [Number(m[1]), m[2]] as const);
  check('boot card: the body gradient is the jelly amber tone (top, body, belly) and the gloss is white .9 to .25', JSON.stringify(stops) === JSON.stringify([[0, s.top], [0.42, s.body], [1, mixHex(s.body, s.shade, 0.55)]]) && /stop-color="#fff" stop-opacity="\.9"/.test(mark) && /stop-color="#fff" stop-opacity="\.25"/.test(mark));
  check('boot card: five passes per word (shadow, outline, shade, body, gloss), the shadow down 7, the shade down 3, the gloss up-left', ['wa', 'wb'].every((w) => ['sh', 'ol', 'sd', 'bd', 'hi'].every((p) => new RegExp(`<use class="bt-${p}"[^>]*href="#bt-${w}"`).test(mark))) && /class="bt-sh" transform="translate\(0 7\)"/.test(mark) && /class="bt-sd" transform="translate\(0 3\)"/.test(mark) && /class="bt-hi"[^>]*transform="translate\(-3 -4\)"/.test(mark));
  check('boot card: the stroke widths match jelly.css (shadow 26, outline 26, shade 20, body 20, gloss 5)', /\.bt-sh \{[^}]*stroke-width: 26px/.test(bootCss) && /\.bt-ol \{[^}]*stroke-width: 26px/.test(bootCss) && /\.bt-sd \{[^}]*stroke-width: 20px/.test(bootCss) && /\.bt-bd \{ stroke-width: 20px/.test(bootCss) && /\.bt-hi \{ stroke-width: 5px/.test(bootCss) && /\.jl-sh \{[^}]*stroke-width: 26px/.test(jellyCss) && /\.jl-sd \{[^}]*stroke-width: 20px/.test(jellyCss) && /\.jl-hi \{[^}]*stroke-width: 5px/.test(jellyCss));
  check('boot.css: the <noscript> message sits above the loading card (both z 30 = the boot step of the z scale, K13; the noscript comes later in the page, so it paints over the card), or a visitor with scripts off would never read it', /#boot \{[^}]*z-index: 30/.test(bootCss) && /noscript \{[^}]*z-index: 30/.test(bootCss) && html.indexOf('id="boot"') > 0 && html.indexOf('id="boot"') < html.indexOf('<noscript>') && /<noscript>[^<]*JavaScript[^<]*<\/noscript>/.test(html));
  check('index.html: no inline script, no <style>, no style attribute; boot.css is linked (a strict CSP holds)', !/<script\b(?![^>]*\bsrc=)/i.test(html) && !/<style\b/i.test(html) && !/\sstyle=/i.test(html) && /<link rel="stylesheet" href="\.\/src\/ui\/boot\.css">/.test(html));
}

// ============================================================ boot.css colours are the theme's (the card paints before the theme installs)
{
  const v = (n: string): string => new RegExp(`--${n}: (#[0-9a-f]{6})`).exec(bootCss)?.[1] ?? '';
  const pairs: Array<[string, string]> = [['b-ink', PALETTE.ink], ['b-felt', PALETTE.felt], ['b-cream', PALETTE.cream], ['b-dim', DERIVED.creamDim], ['b-track', DERIVED.track], ['b-edge', DERIVED.edge], ['b-lagoon', PALETTE.lagoon], ['b-gel', DERIVED.gelHi], ['b-amber', PALETTE.amber], ['b-deep', DERIVED.amberDeep], ['b-shade', JELLY.amber.shade]];
  const wrong = pairs.filter(([n, hex]) => v(n) !== hex).map(([n]) => n);
  check('boot.css: its --b-* colours equal the theme tokens (ink, felt, cream, dim, track, edge, lagoon, gel, amber, deep) and the jelly shade', wrong.length === 0, wrong.join(' '));
  check('boot.css: hex colours only in the :root token block (no raw hex anywhere else)', !/#[0-9a-fA-F]{3,8}\b/.test(bootCss.replace(/:root \{[\s\S]*?\n\}/, '')));
  check('boot.css: Calm and reduced motion stop the bob and the sheen; no transition: all', /prefers-reduced-motion: reduce\) \{ \.boot-mark, \.boot-fill::after \{ animation: none; \}/.test(bootCss) && /body\[data-calm="true"\] \.boot-mark/.test(bootCss) && !/transition: all/.test(bootCss));
}

// ============================================================ boot events and lines (R09: the count, not three stages)
{
  check('bootCard: 4 events (3 imports + createGame); the line follows the count 0 -> 1 -> 3 -> 4 as first / second / third', BOOT_TOTAL === 4 && [0, 1, 2, 3, 4].map(bootLineIndex).join() === '0,1,1,2,2');
  check('bootCard: the fill is count / 4 and clamps to 0..1', bootFill(0) === 0 && bootFill(1) === 0.25 && bootFill(2) === 0.5 && bootFill(4) === 1 && bootFill(9) === 1 && bootFill(-1) === 0);
  check('bootCard: the three lines are the UI.md 6 copy', BOOT_LINES.join('|') === 'Warming up the jelly…|Finding the felt…|Waking the squishy…');
  const boot = read('src/shell/boot.ts');
  check('boot.ts: one progress event per import (three .then(tick)) and one for createGame, announced on window as wh:boot-progress', (boot.match(/import\('[^']+'\)\.then\(tick\)/g) ?? []).length === 3 && /progress\(\+\+finished\);\s*\/\/ createGame done/.test(boot) && /'wh:boot-progress'/.test(boot));
  check('boot.ts: the loading card leaves only when the title is ready, and every failure path removes it (an error card sits under it)', /bootCard\.leave\(\)/.test(boot) && /document\.getElementById\('boot'\)\?\.remove\(\);\s*\/\/ the loading card sits above an error card/.test(boot) && /getElementById\('boot'\)\?\.remove\(\)/.test(read('src/main.ts')));
}

// ============================================================ the title's copy and wiring
{
  check('title: the lockup is SQUISH KEEPER, the button reads "Wake it up", the tagline is the product line (a squishy toy that squishes back)', WORD === 'SQUISH KEEPER' && CTA_LABEL === 'Wake it up' && TAGLINE === 'A squishy toy that squishes back.');
  check('title: busy and ready status lines (screen readers) and an intro of about 1.2 s', STATUS_WARMING === 'Warming up…' && /^Ready\./.test(STATUS_READY) && INTRO_MS >= 1100 && INTRO_MS <= 1300);
  const card = read('src/ui/titleCard.ts');
  check('title: the lockup is the one h1 (jelly tag h1, real text SQUISH KEEPER) and names the dialog (aria-labelledby)', /jelly\(WORD, \{[^}]*tag: 'h1'/.test(card) && /'aria-labelledby': 'wh-title-name'/.test(card));
  check('title: a keydown or a pointerdown anywhere skips the intro; the Sound chip is a switch (aria-pressed = sound on); the button keeps the .cta class', /addEventListener\('keydown', skip, true\)/.test(card) && /addEventListener\('pointerdown', skip, true\)/.test(card) && /'aria-pressed', String\(!m\)/.test(card) && /class: 'cta k-btn k-gel k-cta'/.test(card));
  const boot = read('src/shell/boot.ts');
  // RE-SPECIFIED by B4a (the owner changed the design on 2026-10-08: the Menu and its Settings row exist): the flags moved to shell/destinations.ts, and Settings is true; the rule is unchanged (a chip is drawn only when its screen exists)
  const dest = read('src/shell/destinations.ts');
  // RE-SPECIFIED again by B6b (the owner changed the design on 2026-10-08: the screens arrive one batch at a time, so a row that pins WHICH flags are true breaks every time a batch flips its own):
  // the rule is unchanged and is now checked as the rule: four literal flags, Settings on, and every flag that is true has its `case` in hudBinding.ts openDestination (a chip that does nothing is worse than none)
  const flags = /DESTINATIONS[^=]*= \{ howto: (true|false), trophies: (true|false), credits: (true|false), settings: (true|false) \}/.exec(dest);
  const hudSrc = read('src/shell/hudBinding.ts');
  const dflags = flags ? (['howto', 'trophies', 'credits', 'settings'] as const).filter((_, i) => flags[i + 1] === 'true') : [];
  check(`title: a destination chip is drawn only when its screen exists (shell/destinations.ts: ${flags ? flags[0].replace(/^[^{]*/, '') : '?'}; every flag that is true has its case in hudBinding.openDestination), boot.ts takes the flags from there, and the dev-only ?titlechips=1 shows them all`,
    !!flags && flags[4] === 'true' && dflags.every((id) => new RegExp(`case '${id}'`).test(hudSrc)) && /TITLE_DESTINATIONS[^=]*= DESTINATIONS/.test(boot) && /import\.meta\.env\.DEV && cfg\.titleChips/.test(boot));
}

// ============================================================ static audit of the sheets this batch owns
{
  const owned: Array<[string, string]> = [['title.css', titleCss], ['jelly.css', jellyCss]];
  check('K13 (B2b sheets): no transition: all, no raw hex colour, no backdrop-filter of its own (the glass is the kit\'s), no -webkit-text-fill-color', owned.every(([, s]) => !/transition: all/.test(s) && !/#[0-9a-fA-F]{3,8}\b/.test(s) && !/backdrop-filter/.test(s) && !/text-fill-color/.test(s)));
  check('K08 (B2b sheets): every idle and intro animation is a role token that Calm and reduced motion set to none (jelly drop, jelly idle, title rise / pop)', /--k-an-jl-drop: none; --k-an-jl-idle: none/.test(jellyCss) && /body\[data-calm="true"\] \{ --k-an-title-in: title-fade; --k-an-title-pop: title-fade; \}/.test(titleCss) && /prefers-reduced-motion: reduce\) \{ body:not\(\[data-calm="false"\]\) \{ --k-an-jl-drop: none/.test(jellyCss) && /prefers-reduced-motion: reduce\) \{ body:not\(\[data-calm="false"\]\) \{ --k-an-title-in: title-fade/.test(titleCss));
  check('title.css and jelly.css: every @keyframes frame moves only transform and opacity (plus its own timing function)', keyframeProps(titleCss + jellyCss).length > 0 && keyframeProps(titleCss + jellyCss).every((p) => ['transform', 'opacity', 'animation-timing-function'].includes(p)), [...new Set(keyframeProps(titleCss + jellyCss))].join(' '));
  check('title.css: the five layouts of UI.md 4.2 are addressed through the card\'s own data-layout (wide short, stack, strip, tiny)', ['[data-layout="wide"][data-density="short"]', '[data-layout="stack"]', '[data-layout="strip"]', '[data-layout="tiny"]'].every((k) => titleCss.includes(k)));
  check('title.css: the tiny CTA is 44 high (the hit size) and the stack / wide CTA keeps the kit\'s 64', /\[data-layout="tiny"\] \.cta \{ min-height: var\(--wh-hit\)/.test(titleCss) && !/\.title \.cta \{[^}]*min-height/.test(titleCss));
}

console.log(`\n${total - bad}/${total} title and boot checks passed`);
process.exit(bad ? 1 : 0);

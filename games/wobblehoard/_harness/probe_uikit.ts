// UI foundations probe (plain node, exits 1 on failure; UI.md B0): the design tokens, the contrast table, the layout classifier, the icon
// family, the motion helpers and a STATIC audit of base.css / kit.css / a11y.css. No DOM, no browser: the pictures and the real-pixel
// checks are _harness/uikit/shoot.mjs (K01 / K02 / K03 / K08 subsets) and the K-rows of the later batches.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import {
  CONTRAST_PAIRS, DERIVED, ELEV, EASE, JELLY, MEDALS, MEDAL_IDS, MOTION, PALETTE, RADII, SIZES, SPACE, TIERS, TIER_IDS, TYPE, WEIGHT, Z,
  contrastRatio, mixHex, themeVars,
} from '../src/ui/theme.ts';
import { ICON_NAMES, ICON_PATHS, iconPaths } from '../src/ui/icons.ts';
import { KIT_SIZES, applyLayout, bindHoard, dockFor, layoutFor, sameLayout } from '../src/ui/layout.ts';
import type { LayoutHandle, LayoutState } from '../src/ui/layout.ts';
import { CALM_FADE_MS, CALM_MOVE_MS, durationFor, play } from '../src/ui/motion.ts';

let bad = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

// ============================================================ tokens (UI.md 3.2)
{
  check('tokens: type scale is 12 / 14 / 16 / 18 / 22 / 28 / 36 and weights are 600 / 800 only', Object.values(TYPE).join() === '12,14,16,18,22,28,36' && WEIGHT.mid === 600 && WEIGHT.bold === 800);
  check('tokens: space 4 8 12 16 24 32 48; radii 6 10 16 20 28 pill', SPACE.join() === '4,8,12,16,24,32,48' && Object.values(RADII).join() === '6,10,16,20,28,999');
  check('tokens: motion 80 / 140 / 220 / 360 / 900 ms, spring and ease-out curves', Object.values(MOTION).join() === '80,140,220,360,900' && EASE.out === 'cubic-bezier(.2, .8, .2, 1)' && EASE.spring === 'cubic-bezier(.34, 1.56, .64, 1)');
  check('tokens: z-index scale play 2, hud 3, bar 5, dock 6, panel 7, modal 10, toast 15, fatal 20, boot 30', JSON.stringify(Z) === '{"play":2,"hud":3,"bar":5,"dock":6,"panel":7,"modal":10,"toast":15,"fatal":20,"boot":30}');
  check('tokens: elevation e1 / e2 / e3 + the lip; every hit target size is 44', Object.keys(ELEV).join() === 'e1,e2,e3,lip,lipPressed' && SIZES.hit === 44 && SIZES.btnH === 48 && SIZES.ctaH === 64 && SIZES.chipH === 32 && SIZES.switchW === 56 && SIZES.switchH === 32 && SIZES.trackH === 10 && SIZES.thumb === 28);
  check('K13 shape of the scales: 7 font sizes (<= 8), 6 radii (<= 6), 9 z-indexes (<= 9)', new Set(Object.values(TYPE)).size <= 8 && new Set(Object.values(RADII)).size <= 6 && new Set(Object.values(Z)).size <= 9);
  const v = themeVars();
  check('tokens: the new colours are exact (UI.md 3.1) and exposed as --wh-*', v['--wh-surface2'] === '#261c48' && v['--wh-surface3'] === '#2f2358' && v['--wh-gel-hi'] === '#ffd592' && v['--wh-lip'] === '#b5611a' && v['--wh-ok'] === '#7be0a4' && v['--wh-plum-bright'] === '#b894f2' && v['--wh-ring'] === PALETTE.lagoon && v['--wh-ring-halo'] === PALETTE.ink);
  check('tokens: PALETTE.plum stays the old surface tone (probe_app asserts it); the UI.md "plum" is DERIVED.plumBright', PALETTE.plum === '#2a1744' && DERIVED.plumBright === '#b894f2');
  check('tokens: --wh-font-ui does not shadow styles.css --wh-font; every token name is unique and kebab-case', !('--wh-font' in v) && Object.keys(v).every((k) => /^--wh-[a-z0-9-]+$/.test(k)) && Object.keys(v).length === new Set(Object.keys(v)).size, `${Object.keys(v).length} tokens`);
  check('tokens: glass is plum at .86 and the scrim ink at .62; the focus-ring halo spread is ring + offset + 2 (7 px)', v['--wh-glass'] === 'rgba(42, 23, 68, 0.86)' && v['--wh-scrim'] === 'rgba(20, 16, 42, 0.62)' && v['--wh-ring-halo-spread'] === '7px');
  check('tokens: the six rarity frames and tells live in theme.ts only (core/rarity.ts carries no frameHex / tellHex / prismHex: UI.md 3.1, K13 raw hex = 0)', TIER_IDS.length === 6 && TIER_IDS.every((id) => /^#[0-9a-f]{6}$/.test(TIERS[id].frame) && /^#[0-9a-f]{6}$/.test(TIERS[id].tell)) && !/frameHex|tellHex|prismHex/.test(read('src/core/rarity.ts')));
  check('tokens: 4 medals, 6 rarity frames, and a jelly stop set (top / body / shade) for each tone, tier and medal', MEDAL_IDS.length === 4 && TIER_IDS.length === 6 && Object.keys(JELLY).length === 5 + 6 + 4 && Object.values(JELLY).every((s) => /^#[0-9a-f]{6}$/.test(s.top) && /^#[0-9a-f]{6}$/.test(s.body) && /^#[0-9a-f]{6}$/.test(s.shade)));
  check('tokens: the jelly shade is darker than the body and the top lighter, for every stop set', Object.entries(JELLY).every(([, s]) => contrastRatio(s.shade, '#000000') < contrastRatio(s.body, '#000000') && contrastRatio(s.top, '#000000') > contrastRatio(s.body, '#000000') - 1e-9));
  check('tokens: mixHex is a plain sRGB mix (0 -> a, 1 -> b, .5 -> midpoint)', mixHex('#000000', '#ffffff', 0) === '#000000' && mixHex('#000000', '#ffffff', 1) === '#ffffff' && mixHex('#000000', '#ffffff', 0.5) === '#808080');
}

// ============================================================ contrast table (UI.md 3.1, 9 K01)
{
  const names = CONTRAST_PAIRS.map((p) => p.name);
  const failing = CONTRAST_PAIRS.filter((p) => contrastRatio(p.fg, p.bg) < p.min);
  check(`contrast: ${CONTRAST_PAIRS.length} pairs, names unique, none under 3, every one meets its minimum`, names.length === new Set(names).size && CONTRAST_PAIRS.every((p) => p.min >= 1.5) && failing.length === 0, failing.map((f) => f.name).join('; '));
  const ui = CONTRAST_PAIRS.filter((p) => p.name.startsWith('UI:'));
  check('contrast: the UI v3 rows (>= 60) include the focus ring + ink halo over white, the translucent containers over white, tiers, medals and jelly tones', ui.length >= 60
    && names.some((n) => n.includes('halo (ink) over a white scene')) && names.some((n) => n.includes('glass over white')) && names.some((n) => n.includes('scrim over white'))
    && TIER_IDS.every((id) => names.includes(`UI: rarity frame ${id} on ink`) && names.includes(`UI: rarity frame ${id} on panel`))
    && MEDAL_IDS.every((id) => names.includes(`UI: medal ${id} on ink`)) && ['amber', 'cream', 'coral', 'lagoon', 'plum'].every((t) => names.includes(`UI: jelly tone ${t} on panel`)), `${ui.length} UI rows`);
  const r = (a: string, b: string): number => contrastRatio(a, b);
  check('contrast: the numbers UI.md 3.1 quotes hold (panel 15.46, edge on surface2 3.51, gel 13.35 / 10.37 / 6.92, coral 6.00, plum 7.52 / 7.03, lagoon on white 1.72)',
    r(PALETTE.cream, DERIVED.panel).toFixed(2) === '15.46' && r(DERIVED.edge, DERIVED.surface2).toFixed(2) === '3.51' && r(PALETTE.ink, DERIVED.gelHi).toFixed(2) === '13.35' && r(PALETTE.ink, PALETTE.amber).toFixed(2) === '10.37'
    && r(PALETTE.ink, DERIVED.amberDeep).toFixed(2) === '6.92' && r(PALETTE.ink, PALETTE.coral).toFixed(2) === '6.00' && r(PALETTE.ink, DERIVED.plumBright).toFixed(2) === '7.52' && r(DERIVED.plumBright, DERIVED.panel).toFixed(2) === '7.03' && r(PALETTE.lagoon, '#ffffff').toFixed(2) === '1.72');
  check('contrast: cream on coral stays FORBIDDEN (2.76), so no coral fill carries cream text', r(PALETTE.cream, PALETTE.coral) < 3);
  check('contrast: the weakest control edge a tool can have (edge on surface3) is still >= 3', r(DERIVED.edge, DERIVED.surface3) >= 3);
}

// ============================================================ layout classifier (UI.md 4.1)
{
  const bySize = KIT_SIZES.map((s) => ({ s, got: layoutFor(s.w, s.h) }));
  check('layout: the 8 kit sizes classify as UI.md 4.1 says (wide, wide-short, stack-tall, stack, strip, strip, tiny, strip)', KIT_SIZES.length === 8 && bySize.every(({ s, got }) => got.layout === s.layout), bySize.map(({ s, got }) => `${s.w}x${s.h}=${got.layout}${got.short ? '/short' : ''}${got.tall ? '/tall' : ''}`).join(' '));
  const L = (w: number, h: number): string => { const x = layoutFor(w, h); return x.layout + (x.short ? '+short' : '') + (x.tall ? '+tall' : ''); };
  check('layout: boundaries (tiny 420 x 260, strip height 440, stack width 819, short 560, tall 700)',
    L(420, 260) === 'tiny' && L(421, 260) === 'strip' && L(420, 261) === 'strip' && L(1280, 440) === 'strip' && L(1280, 441) === 'wide+short' && L(1280, 561) === 'wide' && L(819, 900) === 'stack+tall' && L(820, 900) === 'wide'
    && L(888, 560) === 'wide+short' && L(888, 561) === 'wide' && L(390, 700) === 'stack+tall' && L(390, 699) === 'stack' && L(300, 400) === 'stack' && L(1024, 768) === 'wide', [L(420, 260), L(421, 260), L(420, 261), L(819, 900), L(820, 900), L(888, 560), L(390, 699)].join(' '));
  check('layout: a coarse 1024x768 tablet stays wide and portrait phones are never strip (UI_RED R06 rejected "strip with coarse pointer")', L(1024, 768) === 'wide' && L(375, 440) === 'stack' && L(300, 400) === 'stack');
  check('layout: nonsense sizes (0, negative, NaN-ish) never throw and classify', ['0x0', '-5x-5', '1e9x1e9'].every((s) => { const [w, h] = s.split('x').map(Number); return typeof layoutFor(w, h).layout === 'string'; }));
  const fake = { dataset: {} as Record<string, string | undefined> } as unknown as HTMLElement;
  applyLayout(layoutFor(888, 500), fake);
  const d1 = JSON.stringify(fake.dataset);
  applyLayout(layoutFor(390, 844), fake);
  check('layout: applyLayout writes data-layout / data-density / data-tall / data-dock (the dock form, B3a) and clears density when it no longer applies', d1 === '{"layout":"wide","density":"short","tall":"false","dock":"compact"}' && fake.dataset.layout === 'stack' && fake.dataset.density === undefined && fake.dataset.tall === 'true' && fake.dataset.dock === 'compact');
  check('layout: sameLayout ignores pixel drift inside a class', sameLayout(layoutFor(1280, 800), layoutFor(1281, 801)) && !sameLayout(layoutFor(1280, 800), layoutFor(888, 500)));
}

// ============================================================ icons (UI.md 3.3)
{
  // RE-SPECIFIED (reason: the owner changed the design on 2026-10-08): the three tool glyphs were pinned to the old tray's file, which is deleted (UI.md 4.6); they are pinned
  // to the same paths as literals now (the glyphs are the old ones, byte for byte; icons.ts is their only home)
  const TOOL_PATHS: Record<'hand' | 'cut' | 'snap', string[]> = {
    hand: ['M8 12.5V6.8a1.6 1.6 0 0 1 3.2 0V11', 'M11.2 10.6V5.4a1.6 1.6 0 0 1 3.2 0v5.2', 'M14.4 10.8V6.6a1.6 1.6 0 0 1 3.2 0v6.6c0 4-2.6 6.8-6.2 6.8-2.6 0-4.1-1.3-5.4-3.4l-2-3.4a1.5 1.5 0 0 1 2.5-1.6L8 13'],
    cut: ['M5 19 15.5 8.5', 'M15.5 8.5l2.6-2.6a1.8 1.8 0 0 1 2.5 2.5L18 11', 'M5 19l3.6-.9', 'M9 15.4l2.2 2.2'],
    snap: ['M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z', 'M12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'],
  };
  check(`icons: ${ICON_NAMES.length} icons, unique camelCase names, none empty, unknown name draws nothing`, ICON_NAMES.length >= 55 && ICON_NAMES.length === new Set(ICON_NAMES).size && ICON_NAMES.every((n) => /^[a-z][A-Za-z0-9]*$/.test(n) && iconPaths(n).length > 0) && iconPaths('nope').length === 0);
  const need = ['hand', 'cut', 'snap', 'split', 'join', 'stamp', 'roll', 'menu', 'trophy', 'shelf', 'lock', 'minis', 'gear', 'close', 'soundOn', 'soundOff', 'fullscreen', 'fullscreenExit', 'hoard', 'capsule', 'heart', 'clock', 'check', 'plus', 'help', 'more', 'chevronLeft', 'arrowRight', 'info', 'success', 'warning', 'error'];
  check('icons: every icon the spec and the audit name exists (tools, HUD, status, and the replacements for the text glyphs heart / clock / chevron / arrow / plus / help / more)', need.every((n) => n in ICON_PATHS), need.filter((n) => !(n in ICON_PATHS)).join(','));
  check('icons: hand / cut / snap are the original tool glyphs (pinned literals, re-specified 2026-10-08) and split / join are the UI.md strings', (['hand', 'cut', 'snap'] as const).every((n) => JSON.stringify([...ICON_PATHS[n]]) === JSON.stringify(TOOL_PATHS[n]))
    && ICON_PATHS.split[0] === 'M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4' && ICON_PATHS.join[0] === 'M3 12h7M7 8.5 10.5 12 7 15.5M21 12h-7M17 8.5 13.5 12 17 15.5');
  const CMD = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/;
  const all = Object.entries(ICON_PATHS).flatMap(([n, ds]) => (ds as readonly string[]).map((d) => ({ n, d })));
  check('icons: every path uses only M L H V C S Q T A Z commands (no text, no transform, no image)', all.every(({ d }) => CMD.test(d)), all.filter(({ d }) => !CMD.test(d)).map(({ n }) => n).join(','));
  // endpoints of absolute commands stay on the 24 grid (a typo like "M12 3v180" would draw nothing useful)
  const bad24: string[] = [];
  for (const { n, d } of all) {
    const nums = d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    if (nums.some((x) => !Number.isFinite(x) || Math.abs(x) > 24)) bad24.push(n);
  }
  check('icons: no number in any path exceeds the 24 grid', bad24.length === 0, bad24.join(','));
  const svgCount = Object.values(ICON_PATHS).reduce((a, ds) => a + (ds as readonly string[]).join('').length, 0);
  check(`icons: the whole family is small (path data under 6 KB raw)`, svgCount < 6144, `${svgCount} chars`);
}

// ============================================================ motion (UI.md 3.2 / 7)
{
  check('motion: Calm collapses MOVE to ~0 and every FADE to 140 ms; normal keeps the token', durationFor(220, 'move', true) === CALM_MOVE_MS && durationFor(80, 'fade', true) === CALM_FADE_MS && CALM_FADE_MS === 140 && CALM_MOVE_MS < 0.1 && durationFor(220, 'move', false) === 220 && durationFor(80, 'fade', false) === 80);
  check('motion: play() on something without WAAPI returns null (no fallback branch needed in callers)', play({} as Element, [{ opacity: 0 }, { opacity: 1 }]) === null);
}

// ============================================================ the three sheets, audited statically (UI.md 3.3, 7, K13)
{
  const files = { base: read('src/ui/base.css'), kit: read('src/ui/kit.css'), a11y: read('src/ui/a11y.css') };
  const css = Object.fromEntries(Object.entries(files).map(([k, s]) => [k, stripComments(s)])) as Record<keyof typeof files, string>;
  const allCss = css.base + css.kit + css.a11y;
  const tokens = themeVars();

  check('css: no raw hex colour outside theme.ts (base, kit, a11y; icons, motion and layout have none either)', !/#[0-9a-fA-F]{3,8}\b/.test(allCss) && !/#[0-9a-fA-F]{6}/.test(stripComments(read('src/ui/icons.ts')) + read('src/ui/motion.ts') + read('src/ui/layout.ts')));
  const usedWh = [...allCss.matchAll(/var\(\s*(--wh-[a-z0-9-]+)/g)].map((m) => m[1]);
  const missingWh = [...new Set(usedWh)].filter((t) => !(t in tokens));
  check(`css: every var(--wh-*) the sheets read is a token theme.ts installs (${new Set(usedWh).size} distinct)`, missingWh.length === 0, missingWh.join(', '));
  const declared = new Set([...allCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const usedK = [...allCss.matchAll(/var\(\s*(--(?:k|fill|p)[a-z0-9-]*)/g)].map((m) => m[1]);
  const missingK = [...new Set(usedK)].filter((t) => !declared.has(t));
  check(`css: every role token a component reads (--k-*, --fill, --p) is declared somewhere (${new Set(usedK).size} distinct)`, missingK.length === 0, missingK.join(', '));
  check('css: no `transition: all`, no opacity .5 as a disabled look, no `!important` outside [hidden], no transparent text fill (W8)',
    !/transition(-property)?\s*:\s*all\b/.test(allCss) && !/opacity\s*:\s*\.5\s*[;}]/.test(allCss) && (allCss.match(/!important/g) ?? []).length === 1 && !/-webkit-text-fill-color\s*:\s*transparent/.test(allCss));

  // every :hover lives inside @media (hover: hover) (touch never gets a sticky hover)
  const scan = (src: string): { prelude: string; stack: string[] }[] => {
    const out: { prelude: string; stack: string[] }[] = [];
    const stack: string[] = [];
    let buf = '';
    for (const ch of src) {
      if (ch === '{') { out.push({ prelude: buf.trim(), stack: [...stack] }); stack.push(buf.trim()); buf = ''; }
      else if (ch === '}') { stack.pop(); buf = ''; }
      else if (ch === ';') buf = '';
      else buf += ch;
    }
    return out;
  };
  const hoverBad = [...scan(css.base), ...scan(css.kit), ...scan(css.a11y)].filter((b) => /:hover\b/.test(b.prelude) && !b.stack.some((s) => /^@media\s*\(hover:\s*hover\)/.test(s)));
  check('css: every :hover rule sits inside @media (hover: hover)', hoverBad.length === 0, hoverBad.slice(0, 3).map((b) => b.prelude.slice(0, 60)).join(' | '));
  const backdrops = (allCss.match(/(?<!-webkit-)backdrop-filter\s*:/g) ?? []).length;
  check('css: backdrop-filter is declared once (the .k-glass class); K13 allows at most 4 containers', backdrops === 1, `${backdrops} declaration(s)`);
  const fontLit = [...allCss.matchAll(/font(?:-size)?\s*:[^;{}]*/g)].map((m) => m[0]).filter((d) => /(^|[\s/])\d+(\.\d+)?px/.test(d.replace(/var\([^)]*\)/g, '')) && !/font-family/.test(d));
  check('css: font sizes come from the type tokens only (no literal px in font / font-size)', fontLit.length === 0, fontLit.slice(0, 3).join(' | '));
  const zLit = [...allCss.matchAll(/z-index\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--wh-z-[a-z]+\)$/.test(v) && !/^[01]$/.test(v));
  check('css: z-index is a --wh-z-* token (or 0 / 1 for stacking inside a component)', zLit.length === 0, zLit.join(','));
  check('css: every kit component class is k- prefixed (no collision with .panel .toast .seg .icon .cta .row)', [...css.kit.matchAll(/(?:^|[\s,>+~(])\.([a-z][a-z0-9_-]*)/gm)].map((m) => m[1]).filter((c) => !c.startsWith('k-') && c !== 'sr-only').length === 0,
    [...new Set([...css.kit.matchAll(/(?:^|[\s,>+~(])\.([a-z][a-z0-9_-]*)/gm)].map((m) => m[1]).filter((c) => !c.startsWith('k-')))].join(','));
  // RE-SPECIFIED at B7 (UI.md 8: "delete every legacy rule the new kit replaces"). B0 pinned "base.css repeats three rules styles.css already has verbatim" while the legacy sheet still existed;
  // B7 moved them: the global reset, [hidden] and .sr-only live ONLY in base.css now (one source), together with the one visually-hidden rule for the labels that leave a compact bar / dock.
  // base.css therefore holds: the three globals, that one rule (its selectors are listed here, so a new one is a decision), `body` custom properties only; styles.css must NOT repeat any of them.
  const baseRules = scan(css.base).filter((b) => b.stack.length === 0).map((b) => b.prelude);
  const bodyBlock = /(?:^|\n)body\s*\{([^}]*)\}/.exec(css.base)?.[1] ?? '';
  const stylesCss = stripComments(read('src/ui/styles.css'));
  const hiddenRule = baseRules.find((r) => r.startsWith('.sr-only')) ?? '';
  const hiddenSel = hiddenRule.replace(/\s+/g, ' ').trim();   // (a comma inside :is() makes a split by comma wrong: compare the whole prelude)
  check('css: base.css = the three globals (*, [hidden], .sr-only), the compact-bar label hiding (a listed set of selectors) and body custom properties only; styles.css does not repeat them; a11y.css is k- classes and body[data-*] hooks only',
    baseRules.filter((r) => !r.startsWith('.k-') && !r.startsWith('@media') && !r.startsWith('.sr-only')).sort().join('|') === '*, *::before, *::after|[hidden]|body'
    && hiddenSel === '.sr-only, .opts:is([data-labels="icon"], [data-labels="tight"]) .opts-btn--ic > .opts-label, .opts[data-labels="tight"] .opts-seg .k-seg-face > span, .opts:not([data-labels="long"]) .snap-tint-word, .dock:not([data-form="full"]) .dock-tool-label, .dock:not([data-form="full"]) .dock-hoard .hoard-btn-word'
    && bodyBlock.split(';').map((d) => d.trim()).filter(Boolean).every((d) => d.startsWith('--'))
    && !/box-sizing\s*:\s*border-box/.test(stylesCss) && !/\[hidden\]\s*\{/.test(stylesCss) && !/\.sr-only\b/.test(stylesCss)
    && scan(css.a11y).filter((b) => b.stack.length <= 1 && b.prelude && !b.prelude.startsWith('@')).every((b) => /^(body|\.k-|\[)/.test(b.prelude.split(',')[0].trim()) || /^body/.test(b.prelude)),
    baseRules.filter((r) => !r.startsWith('.k-')).join(' | ').slice(0, 300));
  check('css: the focus ring is an outline plus the ink halo (box-shadow) and is composed with the component shadow, never `none`', /outline:\s*var\(--k-ring-w\)\s+solid\s+var\(--k-ring\)/.test(css.kit) && /0 0 0 var\(--k-halo-spread\) var\(--k-halo\)/.test(css.kit) && !/box-shadow:\s*var\(--k-sh,\s*none\)/.test(css.kit));

  // a11y.css: every mode exists and the Calm selector is the one the shell writes (data-calm="true", never the bare attribute)
  check('a11y: Calm, reduced-motion, Quality low, contrast-more and forced-colors hooks are all present', /body\[data-calm="true"\]/.test(css.a11y) && /prefers-reduced-motion:\s*reduce/.test(css.a11y) && /body\[data-quality="low"\]/.test(css.a11y) && /prefers-contrast:\s*more/.test(css.a11y) && /forced-colors:\s*active/.test(css.a11y));
  check('a11y: no bare body[data-calm] (it would also match "false", hudBinding writes String(calm))', !/data-calm\](?!=)/.test(allCss) && !/\[data-calm\]/.test(allCss));
  check('a11y: Calm sets every MOVE role to ~0, every FADE role to 140 ms and every idle animation name to none', ['--k-mv-1', '--k-mv-2', '--k-mv-3', '--k-mv-4', '--k-fd-1', '--k-fd-2', '--k-fd-3', '--k-fd-4', '--k-an-dots', '--k-an-breathe', '--k-an-wobble'].every((t) => new RegExp(`body\\[data-calm="true"\\]\\s*\\{[^}]*${t}:`).test(css.a11y)));
  const more = css.a11y.slice(css.a11y.indexOf('@media (prefers-contrast: more)'), css.a11y.indexOf('@media (forced-colors: active)'));
  const forced = css.a11y.slice(css.a11y.indexOf('@media (forced-colors: active)'));
  check('a11y: contrast-more drops blur, gloss and the jelly SVG and thickens the ring to 4 px; forced-colors uses system colours, drops gradients and glass', ['--k-backdrop: none', '--k-gloss-a: 0', '--k-ring-w: 4px', '--k-jelly-svg: none', '--k-container: var(--wh-panel)'].every((t) => more.includes(t))
    && ['Highlight', 'HighlightText', 'ButtonFace', 'ButtonText', 'CanvasText', 'GrayText', '--k-gel-image: none', '--k-backdrop: none', '--k-gloss-a: 0', '--k-gel-border: 2px solid ButtonText'].every((t) => forced.includes(t)));
  check('a11y: every --k-* role the kit reads has a default in base.css (modes override, never introduce)', [...css.a11y.matchAll(/(--k-[a-z0-9-]+)\s*:/g)].map((m) => m[1]).every((t) => new RegExp(`${t}\\s*:`).test(css.base)), [...new Set([...css.a11y.matchAll(/(--k-[a-z0-9-]+)\s*:/g)].map((m) => m[1]).filter((t) => !new RegExp(`${t}\\s*:`).test(css.base)))].join(','));

  // size (K05 shares 38 KB of minified CSS across ALL UI batches: B0 should stay a small part of it)
  // the real minifier Vite uses (lightningcss) when it is installed, else a crude whitespace strip (always >= the real size)
  const crude = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s*([{};:,>])\s*/g, '$1').replace(/;}/g, '}');
  let how = 'crude strip';
  let min = crude(allCss);
  try {
    const lc = createRequire(import.meta.url)('lightningcss') as { transform(o: { filename: string; code: Buffer; minify: boolean }): { code: Uint8Array } };
    min = Object.entries(files).map(([k, s]) => Buffer.from(lc.transform({ filename: k + '.css', code: Buffer.from(s), minify: true }).code).toString()).join('');
    how = 'lightningcss';
  } catch { /* crude */ }
  const gz = gzipSync(min, { level: 9 }).length;
  // K05: ALL dist CSS <= 80 KB minified. The working tree's old sheets already minify to ~53 KB (styles 23.1 + hoard 29.1 + boot 0.7); the "42,087 B" in
  // UI.md is the 2026-10-05 dist. So B0 is a RATCHET: it may not grow, and B2-B7 must delete the old rules their kit classes replace.
  check(`size (ratchet): base + kit + a11y minified <= 26 KB and <= 6 KB gzip (${how}); later batches delete the old CSS they replace (K05: 80 KB for ALL css)`, min.length <= 26 * 1024 && gz <= 6 * 1024, `${min.length} B minified, ${gz} B gzip`);
}

// ============================================================ the toolbar (UI.md 4.1 to 4.3, B3a)
{
  const d = (w: number, h: number): string => { const x = dockFor(layoutFor(w, h)); return `${x.form}/${x.attach}/${x.hoard}/${x.labels ? 'labels' : 'icons'}`; };
  check('dock: the 8 kit sizes take the forms of UI.md 4.2 (wide full with labels; wide-short and stack compact; strip compact with the Hoard button in the bottom row; tiny bare)',
    d(1280, 800) === 'full/above/dock/labels' && d(888, 500) === 'compact/above/dock/icons' && d(390, 844) === 'compact/above/dock/icons' && d(320, 568) === 'compact/above/dock/icons'
    && d(844, 390) === 'compact/inline/row/icons' && d(568, 320) === 'compact/inline/row/icons' && d(632, 355) === 'compact/inline/row/icons' && d(358, 201) === 'bare/inline/dock/icons',
    KIT_SIZES.map((k) => `${k.w}x${k.h}=${d(k.w, k.h)}`).join(' '));
  // B7: the Table | Float pair made the full dock 772 px wide; under WIDE_FULL_MIN_W (1120) it would slide under the name plate and the ring, so a narrow wide window (a tablet landscape) takes the compact form
  check('dock: wide and under 1120 px takes the compact form (1024x768, 1119x700, 820x600), from 1120 px the full one; the layout class stays wide (R06)',
    d(1024, 768) === 'compact/above/dock/icons' && d(1119, 700) === 'compact/above/dock/icons' && d(820, 600) === 'compact/above/dock/icons' && d(1120, 700) === 'full/above/dock/labels' && d(1366, 768) === 'full/above/dock/labels'
    && layoutFor(1024, 768).layout === 'wide' && layoutFor(1024, 768).narrow && !layoutFor(1120, 700).narrow && !layoutFor(1024, 768).short && sameLayout(layoutFor(1000, 700), layoutFor(1001, 701)) && !sameLayout(layoutFor(1119, 700), layoutFor(1120, 700)),
    [d(1024, 768), d(1119, 700), d(1120, 700)].join(' '));
  const fakeBody = { dataset: {} as Record<string, string | undefined> } as unknown as HTMLElement;
  applyLayout(layoutFor(358, 201), fakeBody);
  check('dock: applyLayout writes body[data-dock] (the form)', fakeBody.dataset.dock === 'bare');
  // bindHoard moves ONE node between the dock and the bottom row as the layout changes (never clones it)
  type Fake = { parentElement: unknown; insertBefore(n: { parentElement: unknown }, ref: unknown): void };
  const mk = (): Fake => { const p: Fake = { parentElement: null, insertBefore(n) { n.parentElement = p; } }; return p; };
  const dock = mk(), row = mk();
  const node = { parentElement: null as unknown };
  let cb: ((n: LayoutState, b: LayoutState) => void) | null = null;
  let cur = layoutFor(1280, 800);
  const handle: LayoutHandle = { current: () => cur, update: () => cur, onChange: (f) => { cb = f; return () => { cb = null; }; }, dispose: () => {} };
  bindHoard(handle, node as unknown as HTMLElement, { dock: dock as unknown as HTMLElement, row: row as unknown as HTMLElement });
  const where = (): string => (node.parentElement === dock ? 'dock' : node.parentElement === row ? 'row' : 'none');
  const seen: string[] = [where()];
  for (const [w, h] of [[844, 390], [358, 201], [390, 844], [632, 355]] as const) { const before = cur; cur = layoutFor(w, h); (cb as ((n: LayoutState, b: LayoutState) => void) | null)?.(cur, before); seen.push(where()); }
  check('dock: the Hoard node is in the dock for wide, stack and tiny and in the bottom row for strip (1280 dock, 844x390 row, 358x201 dock, 390x844 dock, 632x355 row)', seen.join() === 'dock,row,dock,dock,row', seen.join());

  // static audit of the toolbar's own sources
  const tcss = stripComments(read('src/ui/toolbar.css'));
  const tts = read('src/ui/toolbar.ts') + read('src/ui/tooltip.ts');
  check('toolbar css: no raw hex colour, no `transition: all`, no backdrop-filter of its own (glass is `.k-glass`), no px font size (type tokens only), z-index from the token scale',
    !/#[0-9a-fA-F]{3,8}\b/.test(tcss) && !/transition:\s*all/.test(tcss) && !/backdrop-filter/.test(tcss) && !/font-size:\s*[0-9.]+px/.test(tcss) && [...tcss.matchAll(/z-index:\s*([^;]+);/g)].every((m) => /^var\(--wh-z-/.test(m[1].trim())));
  check('toolbar ts: text only through textContent (no innerHTML / outerHTML / insertAdjacentHTML), no inline style attribute or <style>, no storage',
    !/innerHTML|outerHTML|insertAdjacentHTML/.test(tts) && !/setAttribute\(\s*['"]style['"]/.test(tts) && !/createElement\(\s*['"]style['"]/.test(tts) && !/localStorage|sessionStorage|indexedDB/.test(tts));
  check('toolbar css: the dock sizes are the UI.md 4.2 numbers (64 / 52 / 44 bars, 48 / 44 tools) and there is no :hover rule (kit.css owns hover, fine pointers only)',
    /--dk-bar-h: 64px/.test(tcss) && /--dk-bar-h: 52px/.test(tcss) && /--dk-bar-h: 44px/.test(tcss) && /--dk-tool-h: 48px/.test(tcss) && !/:hover/.test(tcss));
}

// ============================================================ Table | Float in the toolbar (UI.md 1.8, the owner's call of 2026-10-09: "float/table should be in the toolbar, not in settings")
{
  const tts = stripComments(read('src/ui/toolbar.ts')), hud = stripComments(read('src/shell/hudBinding.ts')), key = stripComments(read('src/input/keyboard.ts'));
  const tcss = stripComments(read('src/ui/toolbar.css'));
  check('Table | Float: GRAVITY_MODES is Table (gravity on, icon table, cue on, line "Table") and Float (icon float, cue off, line "Floating"); both icons exist; the key is G',
    /id: 'table', table: true, label: 'Table', icon: 'table'[^}]*sound: 'on', line: 'Table'/.test(tts) && /id: 'float', table: false, label: 'Float', icon: 'float'[^}]*sound: 'off', line: 'Floating'/.test(tts)
    && iconPaths('table').length > 0 && iconPaths('float').length > 0 && /GRAVITY_KEY = 'G'/.test(tts));
  check('Table | Float: the pair is a role=group "Gravity" of two aria-pressed buttons INSIDE the Tools toolbar (one roving Tab stop, the arrows walk it), >= 44 px in every form, with a tooltip, and its sound is the setting\'s cue (data-sound none)',
    /role: 'group', 'aria-label': 'Gravity'/.test(tts) && /toolsEl\.append\(gravSep, gravEl\)/.test(tts) && /'aria-pressed': 'false', 'aria-keyshortcuts': GRAVITY_KEY/.test(tts) && /\.\.\.\(gravHidden \? \[\] : gravItems\(\)\)/.test(tts)
    && /\.dock:not\(\[data-form="full"\]\) :is\(\.dock-tool, \.dock-grav-opt\) \{ width: var\(--wh-hit\)/.test(tcss) && /\.dock-tool, \.dock-grav-opt \{ flex: none; min-height: var\(--dk-tool-h\)/.test(tcss) && /attachTooltip\(b, `\$\{m\.label\} \(\$\{GRAVITY_KEY\}\)`/.test(tts) && /b\.dataset\.sound = 'none'/.test(tts));
  check('Table | Float: when the tray is too narrow the Hoard drops its count, then the pair goes behind More as a role=group of two menuitemradio items, then the tools (SHAPES ladder); a strip bar keeps OPTS_ROOM',
    /const SHAPES[\s\S]*?\{ icon: false, pair: true \}, \{ icon: true, pair: true \}, \{ icon: false, pair: false \}, \{ icon: true, pair: false \}/.test(tts) && /role: 'menuitemradio'[^}]*'data-grav': m\.id/.test(tts) && /OPTS_ROOM = 320/.test(tts) && /\.dock:is\(\[data-form="bare"\], \[data-hoard="icon"\]\) \.dock-hoard\.hoard-btn \{ width: var\(--wh-hit\)/.test(tcss));
  check('Table | Float: hudBinding gives the toolbar the gravity setting (initial value and onSet -> setSetting), repaints it from the \'settings\' event, says the face ("Table" / "Floating" from GRAVITY_MODES) and plays one cue per change; the pair rests with the tools (key gravity)',
    /gravity: \{ table: g\.settings\.gravity, onSet: \(t\) => g\.setSetting\('gravity', t\) \}/.test(hud) && /tb\.setGravity\(s\.gravity\)/.test(hud) && /announcer\.say\(m\.line\)/.test(hud) && /cue\(m\.sound\)/.test(hud) && /\[\.\.\.tools, 'gravity'\]/.test(hud) && !/On the table/.test(hud));
  check('Table | Float: the G key still toggles gravity (keyboard.ts) and the Settings panel keeps no gravity code (probe_screens pins its rows)',
    /app\.toggleGravity\(\)/.test(key) && !/gravity/i.test(stripComments(read('src/ui/settingsPanel.ts')).replace(/\/\/.*$/gm, '')));
}

console.log(`\n${total - bad}/${total} UI foundation checks passed`);
process.exit(bad ? 1 : 0);

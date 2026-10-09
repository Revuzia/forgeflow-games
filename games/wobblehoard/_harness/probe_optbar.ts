// Options bars probe (plain node, exits 1 on failure; UI.md B3b): the contract with the Cutter (cutContract.ts), the bar's words against shell/cutText.ts,
// the hint line and tool caption policy (hint.ts), the quick switcher's forms, and a STATIC audit of optionsBar.css / hud.css and the DOM hooks the browser
// harness (browser_shell.mjs) still finds the Cut and Snap bars by. No DOM: the pictures and the live behaviour are _harness/uikit/shoot.mjs and
// _harness/uikit/optbar_check.mjs (the label modes, the style control, the capsule waiting, the switcher forms in a real browser).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { CUT_BAR_LABELS, CUT_STYLE_CONTROL, CUT_STYLE_IDS, readCutStyle, stubCut } from '../src/ui/cutContract.ts';
import type { CutLike } from '../src/ui/cutContract.ts';
import { HINT_IDLE_MS, HINT_TEXT, HINT_TOOLS, createHintController, showsToolCaption, toolSourceOfPointer } from '../src/ui/hint.ts';
import { QUICK_MAX, switchFormFor } from '../src/ui/quickSwitch.ts';
import * as T from '../src/shell/cutText.ts';
import type { Cutter } from '../src/shell/cut.ts';

let bad = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

// ============================================================ the contract with the Cutter (UI.md 4.4, CUT_A.md SR1)
{
  // compile-time: the shell's Cutter is a CutLike (tsc fails this file if the Cutter drops or retypes a field the bar reads)
  const asLike = (c: Cutter): CutLike => c;
  void asLike;
  check('CutLike: the shell\'s Cutter is assignable to it (checked by tsc)', true);
  check('the style control is behind the flag CUT_STYLE_CONTROL (true: the Cutter offers the seam since CUT-A S0)', CUT_STYLE_CONTROL === true && CUT_STYLE_IDS.join() === 'clean,minis');

  const none = readCutStyle({ cut: { pieces: 1, maxPieces: 2, busy: false, canSplit: true } });
  check('readCutStyle: a Cutter with no seam = not offered (style clean, locked)', !none.offered && none.style === 'clean' && !none.canChange, JSON.stringify(none));
  const s = stubCut();
  const v0 = readCutStyle({ cut: s });
  check('readCutStyle: a whole, idle Cutter with the seam = offered, clean, free', v0.offered && v0.style === 'clean' && v0.canChange, JSON.stringify(v0));
  check('stubCut follows SR1: setStyle changes the style while whole and answers true', s.setStyle('minis') === true && s.style === 'minis' && readCutStyle({ cut: s }).style === 'minis');
  s.pieces = 2;
  check('stubCut: with two pieces the style is locked and setStyle answers false, no change', readCutStyle({ cut: s }).canChange === false && s.setStyle('clean') === false && s.style === 'minis');
  check('stubCut: asking for the style already set is true even while locked (nothing to refuse)', s.setStyle('minis') === true);
  s.pieces = 1; s.busy = true;
  check('stubCut: a cut or a join that plays also locks it', readCutStyle({ cut: s }).canChange === false && s.setStyle('clean') === false);
  check('stubCut records every ask in order (the kit page and the checks read it)', s.asked.join() === 'minis,clean,minis,clean', s.asked.join());
}

// ============================================================ the bar's own words against cutText.ts (UI.md 4.4: cutText.ts is their home)
{
  const L = CUT_BAR_LABELS;
  check('labels: the style words are cutText.styleLabel, the locked reason is cutText.styleLocked (drift guard)', L.style.clean.long === T.styleLabel('clean') && L.style.minis.long === T.styleLabel('minis') && L.styleLocked === T.styleLocked, JSON.stringify([L.style, L.styleLocked]));
  check('labels: every button has long, short and (by default) a full accessible name; the short word is a prefix of the long one (WCAG 2.5.3 label in name)',
    [L.split, L.join, L.undo, L.done].every((b) => b.long.length > 0 && b.short.length > 0 && b.long.toLowerCase().startsWith(b.short.toLowerCase())), JSON.stringify([L.split, L.join, L.undo, L.done]));
  check('labels: the button words match the ones cutText.toolPicked names (Split in two, Undo cut, Reconnect all)', T.toolPicked(true).includes(L.split.long) && T.toolPicked(true).includes(L.undo.long) && T.toolPicked(true).includes(L.join.long));
  check('labels: the count is "N pieces" (the old bar\'s words)', L.pieces(2) === '2 pieces' && L.pieces(6) === '6 pieces');
  check('labels: the group names are the old bar\'s (the harness and the live region find "Cut tool")', L.group === 'Cut tool' && L.styleGroup === 'Cut style');
}

// ============================================================ the hint line and the tool caption policy (UI.md 4.1, R10)
{
  const c = createHintController();
  check('hint: before the first interaction the line is the gesture help; the first-run tool line is held back', c.line('touch') === HINT_TEXT.touch && c.visible(0));
  c.interact(1000);
  check('hint: right after an interaction the pill hides', !c.visible(1500));
  // the pill comes back after the idle gap: with no tool tried yet it is the first-run line
  check(`hint: back after ${HINT_IDLE_MS / 1000} s idle and no tool tried: the line is "Tap a tool to try it." (touch)`, c.visible(1000 + HINT_IDLE_MS) && c.line('touch') === 'Tap a tool to try it.' && c.line('touch') === HINT_TOOLS.touch, c.line('touch'));
  check('hint: one first-run wording per input style, none longer than the gesture help', (['touch', 'pointer', 'keyboard'] as const).every((m) => HINT_TOOLS[m].length > 0 && HINT_TOOLS[m].length <= HINT_TEXT[m].length));
  c.toolTried();
  check('hint: once a tool was tried the first-run line is retired (the gesture help again)', c.line('touch') === HINT_TEXT.touch && c.line('keyboard') === HINT_TEXT.keyboard);
  const c2 = createHintController();
  check('hint: a new controller starts over (nothing is stored: a reload shows the first-run line again)', c2.line('touch') === HINT_TEXT.touch);
  check('hint: the wording never names a price, a currency or a timer', Object.values({ ...HINT_TEXT, ...HINT_TOOLS }).every((t) => !/coin|gem|\$|cost|pay|earn|timer|second/i.test(t)));
  check('tool caption: shown for a tool change by touch or key, not for a mouse click (it has the tooltip) or the game\'s own change', showsToolCaption('touch') && showsToolCaption('key') && !showsToolCaption('mouse') && !showsToolCaption('game'));
  check('tool caption: pointerType touch and pen = touch, mouse and "" = mouse', toolSourceOfPointer('touch') === 'touch' && toolSourceOfPointer('pen') === 'touch' && toolSourceOfPointer('mouse') === 'mouse' && toolSourceOfPointer('') === 'mouse');
}

// ============================================================ the quick switcher's forms (UI.md 4.2, R12)
{
  check('switcher: row on wide and on tall stack, fold on stack under 700 high, none in strip and tiny', switchFormFor('wide', false) === 'row' && switchFormFor('stack', true) === 'row' && switchFormFor('stack', false) === 'fold' && switchFormFor('strip', false) === 'off' && switchFormFor('tiny', false) === 'off');
  check('switcher: at most five buttons (the owner\'s requirement)', QUICK_MAX === 5);
}

// ============================================================ static audit: optionsBar.css, hud.css, the DOM hooks
{
  const css = stripComments(read('src/ui/optionsBar.css'));
  check('optionsBar.css: no raw hex colour, no transition: all, no backdrop-filter (glass is the dock\'s), no opacity .5 disabled look', !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/transition:\s*all/.test(css) && !/backdrop-filter/.test(css) && !/opacity:\s*\.5\b/.test(css));
  const modes = new Set([...css.matchAll(/data-labels="([a-z]+)"/g)].map((m) => m[1]));
  const src = read('src/ui/optionsBar.ts');
  const declared = /LABEL_MODES: readonly LabelMode\[\] = \[([^\]]+)\]/.exec(src)?.[1].replace(/['\s]/g, '').split(',') ?? [];
  check('optionsBar.css only keys on label modes optionsBar.ts declares (long short icon tight)', declared.join() === 'long,short,icon,tight' && [...modes].every((m) => declared.includes(m)), `${declared.join()} | ${[...modes].join()}`);
  check('optionsBar.css: every control is 44 (the hit token), the segmented faces are 36 with a hit input reaching 44', /--seg-face-h:\s*36px/.test(css) && /min-height:\s*var\(--wh-hit\)/.test(css) && /top:\s*-4px;\s*bottom:\s*-4px/.test(css));
  check('optionsBar.css: forced-colors and Calm have their own rules (Highlight on the chosen swatch, no swatch transition under Calm)', /forced-colors: active[\s\S]*Highlight/.test(css) && /body\[data-calm="true"\] \.snap-swatch\s*\{\s*transition:\s*none/.test(css));

  const hud = stripComments(read('src/ui/hud.css'));
  check('hud.css: the old .cutbar / .snapbar / .snap-tint-btn / .act-btn rules are gone (the bars live in optionsBar.css)', !/\.cutbar|\.snapbar|\.snap-tint-btn|\.snap-swatch|\.act-btn|\.cta-btn/.test(hud));
  check('hud.css: pieces that carry a kit class are overridden with a COMPOUND selector (kit.css loads after hud.css and wins a tie): .k-btn.capsule-btn, .k-btn.qs-btn', /\.k-btn\.capsule-btn\s*\{/.test(hud) && /\.k-btn\.qs-btn\s*\{/.test(hud));
  check('hud.css: the capsule waiting breathes through the Calm-aware animation token (twice) and keeps a steady halo; Calm shows "Ready" on the ring', /\.capsule-btn\[data-ready="true"\][\s\S]*animation:\s*var\(--k-an-breathe\)[^;]*\s2;/.test(hud) && /body\[data-calm="true"\] \.meter\[data-full="true"\] \.meter-ready\s*\{\s*display:\s*grid/.test(hud));
  check('hud.css: the hint pill is the kit container tone with NO backdrop-filter of its own (at most four glass containers), 14 px at the body weight', /\.hint\s*\{[^}]*background:\s*var\(--k-container\)[^}]*font:\s*var\(--wh-w-mid\) var\(--wh-fs-small\)/.test(hud) && !/\.hint[^{]*\{[^}]*backdrop-filter/.test(hud));
  check('hud.css: the switcher is not drawn in strip and tiny, and folds on a short stack', /body\[data-layout="strip"\] \.qswitch, body\[data-layout="tiny"\] \.qswitch \{ display: none; \}/.test(hud) && /body\[data-layout="stack"\]:not\(\[data-tall="true"\]\) \.qs-fold \{ display: flex; \}/.test(hud));

  // the hooks browser_shell.mjs still finds the bars by (UI.md 9.1 changes a selector only if it is listed there with its reason; the Cut and Snap bars are not)
  const cut = read('src/ui/cutBar.ts'), snap = read('src/ui/snapBar.ts');
  const hooks = ['cutbar', 'cutbar-text', 'cutbar-count', 'cutbar-row', 'cutbar-acts', 'blade', 'blade-glow', 'blade-line', "key: 'split'", "key: 'join'", "key: 'undo'", "key: 'done'"];
  check('cutBar.ts keeps the DOM hooks the harness and hud.css use', hooks.every((h) => cut.includes(h)), hooks.filter((h) => !cut.includes(h)).join());
  const shooks = ['snapbar', 'snapbar-text', 'snap-tints', 'snap-tint-btn', 'snap-swatch', 'snap-tint-word', 'snap-save', 'snap-tint', 'snap-shade', "key: 'save'", "key: 'done'", "role: 'radio'", "'data-tint'"];
  check('snapBar.ts keeps the DOM hooks the harness and hud.css use', shooks.every((h) => snap.includes(h)), shooks.filter((h) => !snap.includes(h)).join());
  check('cutBar.ts: Split and Reconnect are really `disabled` when there is nothing to do and only aria-disabled while a cut plays (the keyboard focus must not drop)', /split\.el\.disabled = noSplit/.test(cut) && /aria-disabled', String\(busy \|\| noSplit\)/.test(cut));
  check('cutBar.ts: the style control is a native radiogroup, locked = aria-disabled (never `disabled`: a press must reach the Cutter), the reason is its description', /role: 'radiogroup'/.test(cut) && /seg\.setAttribute\('aria-disabled', String\(locked\)\)/.test(cut) && /'aria-describedby': lockId/.test(cut) && !/input\.disabled|radios.*\.disabled/.test(cut));
  check('cutBar.ts / snapBar.ts import no shell module (the UI holds no cut copy and no game state)', !/from '\.\.\/shell\//.test(cut) && !/from '\.\.\/shell\//.test(snap));
  check('snapBar.ts: no inline style except the CSSOM gradient and swatch variable (CSP)', !/\.cssText|setAttribute\('style'|innerHTML/.test(snap) && !/innerHTML|cssText|setAttribute\('style'/.test(cut));
  const optsrc = stripComments(src);
  check('optionsBar.ts: no innerHTML / cssText / inline style attribute', !/innerHTML|cssText|setAttribute\('style'/.test(optsrc));

  // K05 (ALL dist CSS <= 80 KB minified; the tree is over it today: the UI batches must delete what they replace). The real minifier Vite uses when installed,
  // else a crude whitespace strip (always >= the real size). hud.css was 19.3 KB minified before B3b (UI_RUN B3a), the Cut and Snap bar rules in it ~5.9 KB.
  const lc = (() => { try { return createRequire(import.meta.url)('lightningcss') as { transform(o: { filename: string; code: Buffer; minify: boolean }): { code: Uint8Array } }; } catch { return null; } })();
  const min = (f: string): Buffer => {
    const code = readFileSync(resolve(here, '..', f));
    return lc ? Buffer.from(lc.transform({ filename: f, code, minify: true }).code) : Buffer.from(stripComments(code.toString()).replace(/\s+/g, ' '));
  };
  const hudMin = min('src/ui/hud.css'), optMin = min('src/ui/optionsBar.css');
  check(`K05 ratchet (${lc ? 'lightningcss' : 'crude strip'}): hud.css <= 17.5 KB minified (19.3 KB before B3b), optionsBar.css <= 6.5 KB (about 1.2 KB of it is the bridge for the undocked bar that dies with the Toys tray in B3c)`,
    hudMin.length <= 17.5 * 1024 && optMin.length <= 6.5 * 1024, `hud ${hudMin.length} B (${gzipSync(hudMin).length} gz), optionsBar ${optMin.length} B (${gzipSync(optMin).length} gz)`);
}

console.log(`\n${total - bad}/${total} optbar checks passed`);
process.exit(bad ? 1 : 0);

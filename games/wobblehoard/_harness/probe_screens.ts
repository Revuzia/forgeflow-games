// B4b screens probe (plain node, exits 1 on failure; UI.md 6, 6.1, 8 B4b): the DATA of the later-* screens (Settings rows, How to play, Credits, the Photo card's words), the
// Photo route's decisions against fake windows, the chunk boundary (what is first-play and what is not), and a static audit of the new sheets. The live checks (keyboard, reflow at 320,
// Calm, forced-colors, the card inside the portal's sandbox) are _harness/uikit/b4b_checks.mjs and _harness/portal/photo_check.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { SETTING_KEYS } from '../src/core/settings.ts';
import { FEATURES } from '../src/core/features.ts';
import { PRIVACY_LINE } from '../src/portal/copy.ts';
import {
  CREDITS_BUILT_WITH, CREDITS_CRAFT, CREDITS_PRIVACY, GUIDE_CARDS, GUIDE_KEYS, KEYS_LINE, QUALITY_OPTIONS, SETTINGS_GROUPS, THREE_LICENCE, VOICES_ROW,
} from '../src/ui/screens/screenCopy.ts';
import { PHOTO_HINT, PHOTO_LINE } from '../src/ui/screens/photoCopy.ts';
import { downloadBlob, needsPhotoCard, photoEnv, routePhoto } from '../src/shell/photoRoute.ts';
import type { PhotoEnv } from '../src/shell/photoRoute.ts';
import { iconPaths } from '../src/ui/icons.ts';

let bad = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const walk = (dir: string, out: string[] = []): string[] => { for (const e of readdirSync(dir)) { const p = resolve(dir, e); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };

// ============================================================ Settings rows (UI.md 6)
{
  const rows = SETTINGS_GROUPS.flatMap((g) => g.rows);
  const keyed = rows.filter((r): r is Extract<typeof r, { key: string }> => 'key' in r).map((r) => r.key as string);
  check('Settings: the four groups are Sound, Feel, Motion, Other, in that order', SETTINGS_GROUPS.map((g) => g.title).join() === 'Sound,Feel,Motion,Other');
  check('Settings: every key of core/settings.ts has exactly ONE control (none missing, none twice, none unknown)', SETTING_KEYS.every((k) => keyed.filter((x) => x === k).length === 1) && keyed.length === SETTING_KEYS.length, `rows ${keyed.length} keys ${SETTING_KEYS.length}`);
  const ids = rows.map((r) => r.id);
  check('Settings: row ids are unique and keep the `wh-` ids the harness knows (volume, music, boost, shake, extra, haptics, calm, skip, fast, keys, gravity, quality)', new Set(ids).size === ids.length && ['wh-volume', 'wh-music', 'wh-boost', 'wh-shake', 'wh-extra', 'wh-haptics', 'wh-calm', 'wh-skip', 'wh-fast', 'wh-keys', 'wh-gravity', 'wh-quality'].every((i) => ids.includes(i)) && ids.every((i) => /^wh-[a-z-]+$/.test(i)));
  const sound = SETTINGS_GROUPS[0].rows, feel = SETTINGS_GROUPS[1].rows;
  check('Settings: Sound = Volume, Music, UI sounds, Louder squish; Feel = Extra squish, Haptics (only where the device vibrates), Gravity, Quality; Motion = Calm, Shake, Skip, Fast open; Other = Keyboard shortcuts + the How to play link',
    sound.map((r) => r.id).join() === 'wh-volume,wh-music,wh-uisounds,wh-boost' && feel.map((r) => r.id).join() === 'wh-extra,wh-haptics,wh-gravity,wh-quality' && SETTINGS_GROUPS[2].rows.map((r) => r.id).join() === 'wh-calm,wh-shake,wh-skip,wh-fast' && SETTINGS_GROUPS[3].rows.map((r) => r.id).join() === 'wh-keys,wh-howto-link'
    && (feel[1] as { needs?: string }).needs === 'vibrate');
  check('Settings: Quality is a 4-way segmented control (Auto, Low, Medium, High) whose values are the game\'s tiers', QUALITY_OPTIONS.map((o) => o.value).join() === 'auto,low,med,high' && (feel[3] as { kind: string }).kind === 'seg');
  check('Settings: the labels the browser harness reads are unchanged (Volume, Music, Louder squish, Extra squish, Gravity, Calm effects, Screen shake, Skip animations, Fast open, Keyboard shortcuts, Quality, Haptics)',
    ['Volume', 'Music', 'Louder squish', 'Extra squish', 'Gravity', 'Calm effects', 'Screen shake', 'Skip animations', 'Fast open', 'Keyboard shortcuts', 'Quality', 'Haptics'].every((l) => rows.some((r) => r.label === l)));
  check('Settings: the Voices switch is a hidden component (FEATURES.voices is false, VOICES_ROW is in no group, the panel mounts it only when the flag AND a place to keep it exist)',
    FEATURES.voices === false && FEATURES.reset === false && !ids.includes(VOICES_ROW.id) && /features\.voices && o\.voices/.test(read('src/ui/settingsPanel.ts')));
  check('Settings: the "Start over" component is NOT built (UI.md 10 / 11 R19: the owner\'s call): no reset text in the panel or the copy', !/start over|reset progress/i.test(read('src/ui/settingsPanel.ts') + read('src/ui/screens/screenCopy.ts')));
}

// ============================================================ the words (UI.md 6, 6.1, 4.5: verbatim where the spec gives them)
{
  const all = JSON.stringify([SETTINGS_GROUPS, GUIDE_CARDS, GUIDE_KEYS, CREDITS_BUILT_WITH, KEYS_LINE, CREDITS_CRAFT, PHOTO_HINT, PHOTO_LINE]);
  check('the privacy line is UI.md 6\'s draft word for word, and Credits shows the one the bridge probe pins (portal/copy.ts)', PRIVACY_LINE === 'Your squishies live in this browser. Signed in to ForgeFlow Games, only your trophies are shared with the site.' && CREDITS_PRIVACY === PRIVACY_LINE);
  check('Credits: "All sound is synthesised in your browser. All art is drawn in code." word for word', CREDITS_CRAFT === 'All sound is synthesised in your browser. All art is drawn in code.');
  check('the Photo card says what UI.md 6.1 and 4.5 say, word for word', PHOTO_HINT === 'Press and hold the picture (or right-click it) and choose Save image.' && PHOTO_LINE === 'Photo ready. Press and hold the picture to save it.');
  check('Credits names three.js and Vite (MIT) and TypeScript (Apache-2.0); the licence text is the MIT text of three.js (the notice that has to travel with the code)',
    CREDITS_BUILT_WITH.map((c) => `${c.name}:${c.licence}`).join() === 'three.js:MIT,Vite:MIT,TypeScript:Apache-2.0' && /^The MIT License$/.test(THREE_LICENCE[0]) && /three\.js authors/.test(THREE_LICENCE[1]) && /THE SOFTWARE IS PROVIDED "AS IS"/.test(THREE_LICENCE[4]) && /Permission is hereby granted/.test(THREE_LICENCE[2]));
  const three = read('node_modules/three/LICENSE').replace(/\s+/g, ' ');
  check('the three.js licence text equals node_modules/three/LICENSE (modulo line breaks)', three.includes(THREE_LICENCE[2]) && three.includes(THREE_LICENCE[3]) && three.includes(THREE_LICENCE[4]) && three.includes(THREE_LICENCE[1]));
  check('How to play has the five cards of UI.md 6 in order (Squish, Stretch, Capsules, Tools, Hoard and merge)', GUIDE_CARDS.map((c) => c.title).join() === 'Squish,Stretch,Capsules,Tools,Hoard and merge');
  check('kind wording and the product rules: no paywall, ad, currency, loss or timer in any screen text; the word Toys is not used (UI.md 4.6)', !/\b(buy|pay|paid|price|coins?|premium|ads?|lose|lost|miss(ed)?|timer|toys?)\b/i.test(all));
}

// ============================================================ the key table names every key the game answers
{
  const kb = stripComments(read('src/input/keyboard.ts'));
  const letters = new Set<string>();
  for (const m of kb.matchAll(/key === '([a-zA-Z])'/g)) letters.add(m[1].toUpperCase());
  const tableKeys = new Set(GUIDE_KEYS.flatMap((r) => r.keys.map((k) => k.toUpperCase())));
  const lineKeys = new Set(KEYS_LINE.match(/(?:^|[ ·:])([A-Z?]|\[ \]|1 2 3|Esc)(?= )/g)?.map((m) => m.replace(/[ ·:]/g, '')) ?? []);
  check('How to play: every letter key input/keyboard.ts handles has a row in the key table', letters.size >= 6 && [...letters].every((l) => tableKeys.has(l)), `keyboard.ts: ${[...letters].join('')}`);
  check('How to play: the digits 1 2 3, [ ] , Esc, Space, ?, + and the pointer rows (Shift + drag, right-drag) are in the table', ['1', '2', '3', '[', ']', 'ESC', 'SPACE', '?', '+', 'SHIFT', 'RIGHT-DRAG'].every((k) => tableKeys.has(k)));
  check('Settings keys line: names G M H F P ? and 1 2 3 C S (the same keys the table has)', ['G gravity', 'M sound', 'H Hoard', 'F full screen', 'P Menu', '? How to play', '1 2 3 tools', 'C cut', 'S snap', '[ ] switch squishy', 'Esc closes'].every((t) => KEYS_LINE.includes(t)), [...lineKeys].join(''));
  check('every key of the table is an `onX` the shell wires: ? is wired in boot.ts (onHelp -> openHelp)', /onHelp: \(\) => \{ ui\.openHelp\(\); \}/.test(read('src/shell/boot.ts')));
}

// ============================================================ the Photo route (UI.md 6.1) against fake windows
{
  const top = {} as Window;
  const mk = (o: { self: unknown; top: () => unknown; anchor: boolean }): Window => ({
    get self() { return o.self; }, get top() { return o.top(); },
    document: { createElement: () => (o.anchor ? { download: '' } : {}) },
  } as unknown as Window);
  const standalone = mk({ self: top, top: () => top, anchor: true });
  const framed = mk({ self: {}, top: () => ({}), anchor: true });
  const blocked = mk({ self: {}, top: () => { throw new Error('SecurityError'); }, anchor: true });
  const noDownloadAttr = mk({ self: top, top: () => top, anchor: false });
  const e = (w: Window): PhotoEnv => photoEnv(w);
  check('photoEnv: a top-level page is not embedded and its anchors take `download`; a frame is embedded; a top that cannot be reached counts as embedded', e(standalone).embedded === false && e(standalone).anchorDownload === true && e(framed).embedded === true && e(blocked).embedded === true);
  check('needsPhotoCard: only a top-level page that can download skips the card', !needsPhotoCard(e(standalone)) && needsPhotoCard(e(framed)) && needsPhotoCard(e(blocked)) && needsPhotoCard(e(noDownloadAttr)));
  const run = (env: PhotoEnv, dl: () => boolean) => { const log: string[] = []; const route = routePhoto({ env, card: () => log.push('card'), download: () => { log.push('download'); return dl(); } }); return { route, log: log.join() }; };
  const s = run(e(standalone), () => true), f = run(e(framed), () => true), n = run(e(noDownloadAttr), () => true), x = run(e(standalone), () => false), t = run(e(standalone), () => { throw new Error('boom'); });
  check('routePhoto: standalone keeps the download and shows no card', s.route === 'download' && s.log === 'download');
  check('routePhoto: inside a frame the card shows and the download is NOT tried (a dropped download gives no sign, so it cannot be confirmed)', f.route === 'card' && f.log === 'card');
  check('routePhoto: a page without anchor `download` goes to the card without trying', n.route === 'card' && n.log === 'card');
  check('routePhoto: a download that cannot even be tried (false, or a throw) falls back to the card, once', x.route === 'card' && x.log === 'download,card' && t.route === 'card' && t.log === 'download,card');
  // downloadBlob against a fake document: one hidden anchor, clicked once, removed; false when the URL cannot be made
  const made: string[] = []; let clicked = 0, removed = 0;
  const g = globalThis as unknown as { URL: { createObjectURL?: (b: unknown) => string; revokeObjectURL?: (u: string) => void }; window?: unknown };
  const prev = { c: g.URL.createObjectURL, r: g.URL.revokeObjectURL, w: g.window };
  g.window = { setTimeout: (f: () => void) => { f(); return 0; } };
  g.URL.createObjectURL = () => { made.push('url'); return 'blob:fake'; };
  g.URL.revokeObjectURL = () => { made.push('revoke'); };
  const doc = { createElement: () => ({ href: '', download: '', hidden: false, click: () => { clicked++; }, remove: () => { removed++; } }), body: { append: () => {} } } as unknown as Document;
  const ok = downloadBlob({} as Blob, 'a.png', doc);
  g.URL.createObjectURL = () => { throw new Error('no'); };
  const none = downloadBlob({} as Blob, 'a.png', doc);
  g.URL.createObjectURL = prev.c; g.URL.revokeObjectURL = prev.r; g.window = prev.w;
  check('downloadBlob: one anchor, one click, the object URL revoked; false (and no click) when the URL cannot be made', ok === true && clicked === 1 && removed === 1 && made.join() === 'url,revoke' && none === false && clicked === 1);
}

// ============================================================ the chunk boundary (UI.md 8 B4: first-play = Menu shell, pause, modal, toast, error card; later-* = the rest)
{
  const files = walk(resolve(ROOT, 'src')).filter((f) => /\.ts$/.test(f)).map((f) => relative(ROOT, f).replace(/\\/g, '/'));
  const LATER = /(?:^|\/)(settingsPanel|screens\/(later-[a-z-]+|howToPlay|credits|screenFrame|guideArt|screenCopy))(\.ts)?$/;
  const offenders: string[] = [];
  for (const f of files) {
    if (f.startsWith('src/ui/screens/') || f === 'src/ui/settingsPanel.ts') continue;
    const src = stripComments(read(f));
    for (const m of src.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)'/g)) {
      if (m[1]) continue;   // a type import is erased
      if (LATER.test(m[3].replace(/\.ts$/, '')) || /\/screens\/later-/.test(m[3])) offenders.push(`${f} imports ${m[3]}`);
    }
    for (const m of src.matchAll(/import\('([^']+)'\)/g)) if (/screens\/later-|settingsPanel/.test(m[1]) && f !== 'src/shell/screens.ts') offenders.push(`${f} dynamically imports ${m[1]}`);
  }
  check('chunk boundary: nothing first-play imports Settings, How to play, Credits or the Photo card by value; shell/screens.ts alone holds the two dynamic imports', offenders.length === 0 && /import\('\.\.\/ui\/screens\/later-screens\.ts'\)/.test(read('src/shell/screens.ts')) && /import\('\.\.\/ui\/screens\/later-photo\.ts'\)/.test(read('src/shell/screens.ts')), offenders.join(' | '));
  const hb = stripComments(read('src/shell/hudBinding.ts'));
  check('hudBinding.ts: Settings is built by the host (createSettingsHost), never by createSettingsPanel; the Photo card goes through routePhoto; the cover is one set of keys (Menu, screen, photo) over g.suspend(\'covered\')',
    /createSettingsHost\(/.test(hb) && !/createSettingsPanel\(/.test(hb) && /routePhoto\(/.test(hb) && /const covers = new Set<string>\(\)/.test(hb) && /g\.suspend\('covered'\)/.test(hb));
  const first = ['src/ui/menu.ts', 'src/ui/modal.ts', 'src/ui/toast.ts', 'src/ui/errorCard.ts', 'src/shell/pauseCtl.ts', 'src/shell/fullscreen.ts', 'src/shell/photoRoute.ts'];
  check('first-play files stay free of lazy imports and of the later-* words (pause() is synchronous; photoRoute.ts is pure)', first.every((f) => !/import\(/.test(stripComments(read(f)))));
  check('shell/photoRoute.ts is pure (no DOM at import, no CSS, no imports): the probes and the shell share it', !/^import /m.test(stripComments(read('src/shell/photoRoute.ts'))));
  const hist = read('src/ui/screens/later-photo.ts');
  check('Photo card: the picture is a data: URL (img-src allows data:, not blob:); "Open in a new tab" hides itself when window.open returns nothing; the live line is spoken; Esc closes through the layer stack (openLayer)',
    /readAsDataURL/.test(hist) && /window\.open\(url, '_blank'\)/.test(hist) && /tab\.hidden = true/.test(hist) && /o\.say\(PHOTO_LINE\)/.test(hist) && /openLayer\(/.test(hist) && !/img\.src = URL\.createObjectURL/.test(hist));
}

// ============================================================ the sheets (K05, K06, K13: tokens only)
{
  for (const f of ['src/ui/screens/screens.css', 'src/ui/screens/photo.css']) {
    const css = stripComments(read(f));
    check(`${f}: no raw hex or rgb(a) colour, no \`transition: all\`, no backdrop-filter`, !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/rgba?\(/.test(css) && !/transition:\s*all/.test(css) && !/backdrop-filter/.test(css));
    const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
    const shorthand = [...css.matchAll(/font:\s*([^;}]+)/g)].map((m) => m[1].trim());
    check(`${f}: every font size is a token (--wh-fs-*), every radius a token (--wh-r-*), every z-index a token (--wh-z-*)`,
      sizes.every((v) => /^var\(--wh-fs-[a-z0-9]+\)$/.test(v)) && shorthand.every((v) => /var\(--wh-fs-[a-z0-9]+\)/.test(v)) && [...css.matchAll(/border-radius:\s*([^;}]+)/g)].every((m) => /var\(--wh-r-/.test(m[1]) || /^0$/.test(m[1].trim()) || /calc\(/.test(m[1]) || /^0 /.test(m[1].trim()) || /^50%$/.test(m[1].trim())) && [...css.matchAll(/z-index:\s*([^;}]+)/g)].every((m) => /var\(--wh-z-/.test(m[1])), `${sizes.join(' | ')}`);
    const hov = css.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/g, '');
    check(`${f}: :hover appears only inside @media (hover: hover)`, !/:hover/.test(hov));
    const kf = [...css.matchAll(/@keyframes [\w-]+ \{([^}]*\{[^}]*\}[^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/([a-z-]+):/g)].map((x) => x[1]));
    check(`${f}: every keyframe it defines moves only transform and opacity (it defines none: the ov-* keyframes are overlay.css's)`, kf.every((p) => p === 'transform' || p === 'opacity') && !/@keyframes/.test(css));
    const durs = [...css.matchAll(/(?:transition|animation):\s*([^;]+);/g)].map((m) => m[1]);
    check(`${f}: every duration is a Calm token (--k-mv-* moves, --k-fd-* fades): Calm collapses the moves and keeps the fades`, durs.every((d) => !/\b\d+(\.\d+)?m?s\b/.test(d.replace(/var\([^)]*\)/g, '').replace(/\b0s\b/g, ''))), durs.filter((d) => /\b\d+m?s\b/.test(d.replace(/\b0s\b/g, ''))).join(' | '));
  }
  const art = read('src/ui/screens/guideArt.ts');
  const used = ['hand', 'cut', 'snap', 'sparkle'].filter((n) => art.includes(`'${n}'`));   // the tools' chips take their name as an argument, the sparkle is a literal call
  check('How to play pictures: drawn in code, `aria-hidden`, and every icon they borrow exists in the kit (icons.ts)', /'aria-hidden': 'true'/.test(art) && used.length === 4 && used.every((n) => iconPaths(n).length > 0), used.join());
  const settings = stripComments(read('src/ui/settingsPanel.ts'));
  check('text goes through textContent only in the new screens (no innerHTML, no outerHTML, no insertAdjacentHTML)', ['src/ui/settingsPanel.ts', 'src/ui/screens/screenFrame.ts', 'src/ui/screens/howToPlay.ts', 'src/ui/screens/credits.ts', 'src/ui/screens/later-photo.ts', 'src/shell/screens.ts'].every((f) => !/innerHTML|outerHTML|insertAdjacentHTML/.test(stripComments(read(f)))) && /\.k-slider|k-slider/.test(settings));
}

console.log(`\n${total - bad}/${total} screens checks passed`);
process.exit(bad ? 1 : 0);

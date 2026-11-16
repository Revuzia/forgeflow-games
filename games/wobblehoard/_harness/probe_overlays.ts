// B4a overlays probe (plain node, exits 1 on failure; UI.md 6, 6.1, 8 B4a): the pure logic of the pause contract and of full screen against fakes, the destination flags, the toast
// timings, and a STATIC audit of the first-play overlay code and sheet (overlay.css, the toast / modal / menu sources). The live checks (focus trap, Esc order, __PAUSE__ in the
// real game, the toasts on screen, the sounds) are browser_shell.mjs --only=menu-pause,fullscreen-gate,toasts,modal-layers,ui-sounds,error-cards.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DESTINATIONS, DEST_ICONS, DEST_LABELS, MENU_ORDER, TITLE_ORDER } from '../src/shell/destinations.ts';
import { createPauseCtl } from '../src/shell/pauseCtl.ts';
import { createFullscreen } from '../src/shell/fullscreen.ts';
import { TOAST_MS } from '../src/ui/toast.ts';
import { iconPaths } from '../src/ui/icons.ts';

let bad = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

// ============================================================ destinations
{
  // RE-SPECIFIED by B4b (How to play and Credits exist now; Trophies is B6b's flag and row)
  check('destinations: Settings (B4a), How to play and Credits (B4b) exist; the Menu lists Settings first, the title chips end with Settings', DESTINATIONS.settings === true && DESTINATIONS.howto === true && DESTINATIONS.credits === true && MENU_ORDER[0] === 'settings' && TITLE_ORDER[TITLE_ORDER.length - 1] === 'settings');
  check('destinations: every destination has a label and a drawn icon', (Object.keys(DESTINATIONS) as Array<keyof typeof DESTINATIONS>).every((k) => DEST_LABELS[k].length > 0 && iconPaths(DEST_ICONS[k]).length > 0) && MENU_ORDER.length === 4 && TITLE_ORDER.length === 4);
}

// ============================================================ the pause contract (UI.md 6.1) against a fake Menu
{
  let phase: 'title' | 'play' | 'error' | 'boot' = 'title';
  let open = false, opens = 0, closes = 0, lastWhy = '';
  const menu = { get isOpen() { return open; }, open() { if (open) return false; open = true; opens++; return true; }, close(why?: string) { if (!open) return false; open = false; closes++; lastWhy = why ?? ''; return true; } };
  const p = createPauseCtl({ phase: () => phase, menu });
  p.pause();
  check('__PAUSE__: pause() on the title does nothing', opens === 0 && !open);
  phase = 'play';
  p.pause(); p.pause();
  check('__PAUSE__: pause() in play opens the Menu, a second pause() changes nothing (idempotent)', open && opens === 1);
  p.resume(); p.resume();
  check('__PAUSE__: resume() closes it as "resume", a second resume() changes nothing', !open && closes === 1 && lastWhy === 'resume');
  p.toggle(); const a = open; p.toggle();
  check('__PAUSE__: toggle() opens then closes', a && !open && opens === 2 && closes === 2);
  phase = 'error';
  p.pause();
  check('__PAUSE__: pause() on the error card does nothing', !open && opens === 2);
}

// ============================================================ full screen (UI.md 6.1) against a fake document
{
  type Listener = () => void;
  const mk = (o: { enabled: boolean; reject?: boolean }) => {
    const ls: Record<string, Listener[]> = {};
    const doc = {
      fullscreenEnabled: o.enabled, fullscreenElement: null as unknown,
      documentElement: { requestFullscreen: async () => { if (o.reject) throw new TypeError('denied'); doc.fullscreenElement = doc.documentElement; (ls.fullscreenchange ?? []).forEach((f) => f()); } },
      exitFullscreen: async () => { doc.fullscreenElement = null; (ls.fullscreenchange ?? []).forEach((f) => f()); },
      addEventListener: (n: string, f: Listener) => { (ls[n] ??= []).push(f); }, removeEventListener: () => {},
    };
    return doc;
  };
  const off = createFullscreen(mk({ enabled: false }) as unknown as Document);
  check('full screen: not enabled by the page = not supported, not available, and a request says no', !off.supported && !off.available && (await off.set(true)) === false);
  const ok = mk({ enabled: true }); const fsOk = createFullscreen(ok as unknown as Document);
  const seen: string[] = []; fsOk.onChange((on, av) => seen.push(`${on}/${av}`));
  const t1 = await fsOk.toggle(); const on1 = fsOk.isOn(); const t2 = await fsOk.toggle();
  check('full screen: toggle() enters and leaves, isOn() follows the document, onChange hears both', t1 && on1 && t2 && !fsOk.isOn() && seen.join() === 'true/true,false/true', seen.join());
  const no = createFullscreen(mk({ enabled: true, reject: true }) as unknown as Document);
  const got: string[] = []; no.onChange((on, av) => got.push(`${on}/${av}`));
  const r = await no.set(true);
  check('full screen: a refusal at the request is handled (false, not thrown), marks it unavailable and tells the listeners once; a later request does not ask again', r === false && !no.available && no.supported && got.join() === 'false/false' && (await no.set(true)) === false && got.length === 1, got.join());
}

// ============================================================ the toast timings (UI.md 6: 3.2 s trophies, 2.6 s the rest; 3 s and 2 s on the portal phone)
{
  check('toasts: 2.6 s, trophies 3.2 s; on the portal phone 2 s and 3 s', TOAST_MS.normal === 2600 && TOAST_MS.trophy === 3200 && TOAST_MS.tinyNormal === 2000 && TOAST_MS.tinyTrophy === 3000);
}

// ============================================================ a STATIC audit of the overlay sheet and sources
{
  const css = stripComments(read('src/ui/overlay.css'));
  check('K13 (overlay.css): no transition: all, no raw hex colour, no backdrop-filter of its own (the glass is the kit\'s), no -webkit-text-fill-color', !/transition: all/.test(css) && !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/backdrop-filter/.test(css) && !/text-fill-color/.test(css));
  const zs = [...css.matchAll(/z-index:\s*([^;}]+)/g)].map((m) => m[1].trim());
  check('K13 (overlay.css): every z-index is a token of the scale (--wh-z-*)', zs.length > 0 && zs.every((z) => /^var\(--wh-z-(toast|modal|fatal)\)$/.test(z)), zs.join(' | '));
  const durs = [...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]);
  check('K08 (overlay.css): every entrance animation takes its duration from the Calm tokens (--k-mv-* for movement, --k-fd-* for a fade); the one idle wobble is gated off by Calm and reduced motion', durs.filter((d) => !/--k-(mv|fd)-\d/.test(d)).every((d) => /ov-wobble/.test(d)) && /prefers-reduced-motion: no-preference\) \{ body:not\(\[data-calm="true"\]\) \.errorcard-mascot/.test(css));
  const kf = [...css.matchAll(/@keyframes [\w-]+ \{([^}]*\{[^}]*\}[^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/([a-z-]+):/g)].map((x) => x[1]));
  check('K06 (overlay.css): every keyframe moves only transform and opacity', kf.length > 0 && kf.every((p) => p === 'transform' || p === 'opacity'), [...new Set(kf)].join());
  const styles = stripComments(read('src/ui/styles.css'));
  // RE-SPECIFIED by B4b (the owner changed the design on 2026-10-08): Quality is a 4-way segmented control now, so Settings has no <select> and no `.row-select` rule; the Hoard's Sort is the one select left
  check("styles.css: no `select` rule carries a min-width (it leaked into every select, the Hoard's Sort too); the legacy .toast / .errorcard / .net-banner / .cta rules are gone (overlay.css owns them); the Settings panel rules moved to the later-* chunk (screens.css)",
    !/(^|\n)select \{[^}]*min-width/.test(styles) && !/\.row-select/.test(styles) && !/\n\.toast \{/.test(styles) && !/\.errorcard/.test(styles) && !/\.net-banner/.test(styles) && !/\n\.cta \{/.test(styles) && !/\n\.panel \{/.test(styles));
  const files = ['src/ui/menu.ts', 'src/ui/modal.ts', 'src/ui/toast.ts', 'src/ui/errorCard.ts', 'src/ui/uiSound.ts', 'src/shell/pauseCtl.ts', 'src/shell/fullscreen.ts', 'src/shell/destinations.ts'];
  check('first-play (UI.md 8 B4, R19): the Menu, the modal, the toasts, the error card, the pause and full screen load no later-* chunk and import nothing lazily (pause() is synchronous)', files.every((f) => !/import\(/.test(stripComments(read(f))) && !/later-/.test(read(f).replace(/\/\/.*$/gm, ''))));
  check('text goes through textContent only in the new overlay sources (no innerHTML, no outerHTML, no insertAdjacentHTML)', files.every((f) => !/innerHTML|outerHTML|insertAdjacentHTML/.test(stripComments(read(f)))));
  // RE-SPECIFIED by B4b: the last stub (the Photo card) is real; the stub file is gone
  check('the Photo card is real (B4b): shell/entryStubs.ts is deleted, shell/photoRoute.ts decides the route and the card is the later-* chunk ui/screens/later-photo.ts', !existsSync(resolve(here, '..', 'src/shell/entryStubs.ts')) && existsSync(resolve(here, '..', 'src/shell/photoRoute.ts')) && existsSync(resolve(here, '..', 'src/ui/screens/later-photo.ts')));
  const hb = read('src/shell/hudBinding.ts');
  check('hudBinding.ts: the HUD button is the Menu (onMenu), Esc layers 2 and 3 are the layer stack (closeTopLayer), the Menu suspends the game as "covered" and resumes it on close', /onMenu: \(\) => \{ menu\?\.toggle\(\); \}/.test(hb) && /closeTopLayer\('escape'\)/.test(hb) && /g\.suspend\('covered'\)/.test(hb) && /g\.unsuspend\('covered'\)/.test(hb));
  const hud = read('src/ui/hud.ts');
  check('hud.ts: the top row is [Full screen, Mute sound, Menu] in Tab order, the Menu button names a dialog (aria-haspopup, aria-expanded, aria-controls) and keeps its own sound', /h\('div', \{ class: 'hud-actions' \}, fsBtn, muteBtn, menuBtn\)/.test(hud) && /'aria-haspopup': 'dialog'/.test(hud) && /'aria-controls': 'wh-menu'/.test(hud) && /'data-sound': 'none'/.test(hud));
}

console.log(`\n${total - bad}/${total} overlay checks passed`);
process.exit(bad ? 1 : 0);

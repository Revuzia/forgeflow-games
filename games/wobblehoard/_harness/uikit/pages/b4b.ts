// B4b page: THE SECONDARY SCREENS (UI.md 6, 8 B4b): the five How to play pictures at two sizes (`b4b-art`), and four scenes at exactly the viewport's size (`settings-scene`, `howto-scene`,
// `credits-scene`, `photo-scene`) that open the REAL screens over a mock HUD, so a sheet at the 8 kit sizes shows what the game shows (a side panel, a card, a bottom sheet, a strip
// card, or the tiny full screen by layout). The screens' sheets (screens.css, photo.css) are the later-* chunk's: they load here by import.
import { h } from '../../../src/ui/dom.ts';
import { defaultSettings, resolveSettings } from '../../../src/core/settings.ts';
import { createSettingsPanel } from '../../../src/ui/settingsPanel.ts';
import { openHowTo } from '../../../src/ui/screens/howToPlay.ts';
import { openCredits } from '../../../src/ui/screens/credits.ts';
import { guideArt } from '../../../src/ui/screens/guideArt.ts';
import { showPhotoCard } from '../../../src/ui/screens/later-photo.ts';
import { GUIDE_CARDS } from '../../../src/ui/screens/screenCopy.ts';
import '../../../src/ui/screens/screens.css';
import '../b4b.css';
import { scene } from './b4a.ts';
import { cell, sub } from './types.ts';
import type { KitSection } from './types.ts';

const art: KitSection = {
  id: 'b4b-art', title: 'B4b parts: the How to play pictures',
  note: 'Five small pictures drawn in code (inline SVG, aria-hidden, coloured by the theme tokens): shown at the card size and at 3x so the drawing can be read.',
  build(host) {
    host.append(sub('Card size (72 x 56) on the panel and on white'));
    const row = (): HTMLElement => h('div', { class: 'kp-art-row' }, ...GUIDE_CARDS.map((c) => guideArt(c.id)));
    host.append(cell('five pictures', row(), { col: true }), cell('the same over white (forced and contrast modes redraw them in system colours)', row(), { tone: 'white', col: true }));
    host.append(sub('3x'));
    host.append(cell('read the strokes', h('div', { class: 'kp-art-row kp-art-row--big' }, ...GUIDE_CARDS.map((c) => guideArt(c.id))), { col: true }));
  },
};

const settings = resolveSettings(defaultSettings({ vibrate: true, reducedMotion: false }), { vibrate: true, reducedMotion: false });

const settingsScene = scene('settings-scene', 'Scene: Settings open (the real panel: a side panel, a bottom sheet, or the tiny full screen by layout)', 'The title takes the focus; the squishy stays live under a side panel (not modal). Sound, Feel, Motion, Other; Quality is the 4-way segmented control; Haptics is drawn (a touch device).', (stage, btn) => {
  const p = createSettingsPanel(stage, { settings, hapticsSupported: true, onChange: () => {}, onHowTo: () => {}, returnFocusTo: btn });
  p.open(btn);
  p.el.dataset.open = 'true';
  p.el.style.transition = 'none';
});
const howtoScene = scene('howto-scene', 'Scene: How to play (the real screen: five cards and the key table)', 'A card on a wide screen (two columns when short), a bottom sheet on a stack, a strip card of two columns, the whole screen on the portal phone. The close button has the focus.', (stage) => {
  openHowTo({ parent: stage });
});
const creditsScene = scene('credits-scene', 'Scene: Credits (the real screen: version, built with, privacy line, Licences)', 'Everything is set with textContent; the Licences disclosure holds the three.js MIT text.', (stage) => {
  openCredits({ parent: stage });
});
const photoScene = scene('photo-scene', 'Scene: the Photo card (the real card over a mock HUD, a drawn test picture)', 'Where a download cannot be confirmed (the portal sandbox): the picture to press-and-hold or right-click and save; "Open in a new tab" only where the browser opens one.', (stage) => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 360;
  const x = c.getContext('2d');
  const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  if (x) {
    const g = x.createRadialGradient(320, 250, 20, 320, 200, 360);
    g.addColorStop(0, css('--wh-felt')); g.addColorStop(1, css('--wh-ink'));
    x.fillStyle = g; x.fillRect(0, 0, 640, 360);
    x.fillStyle = css('--wh-amber');
    x.beginPath(); x.ellipse(320, 215, 120, 105, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = css('--wh-ink');
    x.beginPath(); x.ellipse(280, 205, 14, 18, 0, 0, Math.PI * 2); x.ellipse(360, 205, 14, 18, 0, 0, Math.PI * 2); x.fill();
  }
  c.toBlob((blob) => { if (blob) void showPhotoCard({ parent: stage, blob, alt: 'Photo of your squishy, Dollop, Common', say: () => {} }); }, 'image/png');
});

export const b4bSections = (): KitSection[] => [art, settingsScene, howtoScene, creditsScene, photoScene];

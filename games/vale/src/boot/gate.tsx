// VALE boot — the branded plates shown INSTEAD of the app (W1-E): a device that cannot play (TECH-07) and a second tab
// (TECH-08). They draw with the shell's own classes (booterr plate), before any session, catalog or asset exists, so a
// phone that follows a shared link spends a few KB, not 5 MB, and no one can queue a match that draws nothing.
import { render } from 'preact';
import { Icon } from '../ui/components/Glyphs.tsx';
import { loadFonts } from '../ui/fonts.ts';
import { shipText, type DeviceProblem, type ShipKey } from './device.ts';

interface PlateAction { label: string; primary?: boolean; run: () => void }
interface Plate { title?: string; text: string; actions: PlateAction[] }

function showPlate(root: HTMLElement, p: Plate): void {
  void loadFonts().then(() => render(
    <div class="app booterr" data-plate="ship">
      <div class="backdrop" aria-hidden="true" />
      <div class="booterr__plate plate pad-l" role="alert">
        <span class="bar__brand">VALE</span>
        {p.title ? <p class="t-h3 booterr__title">{p.title}</p> : null}
        <div class="errstate"><Icon name="danger" class="errstate__glyph" /><p class="t-body errstate__text">{p.text}</p></div>
        <div class="booterr__actions" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {p.actions.map((a) => (
            <button type="button" class={`btn ${a.primary ? 'btn--chalk' : 'btn--secondary'} btn--m`} onClick={a.run}><span class="btn__label">{a.label}</span></button>
          ))}
        </div>
      </div>
    </div>, root));
}

/** a device that cannot play: no WebGL2 (Reload), a touch-only device or a window under 1024 x 600 (Make it full screen) */
export function showDevicePlate(root: HTMLElement, p: DeviceProblem, tryAnyway: () => void): void {
  const reload = (): void => location.reload();
  const t = (k: ShipKey): string => shipText(k);
  if (p.kind === 'webgl') showPlate(root, { text: t('state.error.webgl'), actions: [{ label: t('ship.device.reload'), primary: true, run: reload }] });
  else showPlate(root, {
    text: p.kind === 'touch' ? t('ship.device.touch') : t('ship.device.small'),
    actions: [p.kind === 'touch'
      ? { label: t('ship.device.try'), primary: true, run: tryAnyway }
      // a small window: ask for full screen (a refusal or a browser without it is fine), then go on exactly as "Try anyway"
      : { label: t('ship.device.fullscreen'), primary: true, run: () => {
        try { void document.documentElement.requestFullscreen?.()?.catch(() => {}); } catch { /* not allowed here */ }
        tryAnyway();
      } }],
  });
}

/** VALE is open in another tab ('other': this tab arrived second; 'moved': another tab took over from this one) */
export function showTabPlate(root: HTMLElement, why: 'other' | 'moved', playHere: () => void): void {
  showPlate(root, {
    title: shipText('ship.tab.title'),
    text: shipText(why === 'other' ? 'ship.tab.body' : 'ship.tab.moved'),
    actions: [{ label: shipText('ship.tab.use'), primary: true, run: playHere }],
  });
}

/** the lost-picture plate for a renderer that keeps failing (the match's own HUD is gone with the app) */
export function showLostPlate(root: HTMLElement): void {
  showPlate(root, { title: shipText('ship.view.lost'), text: shipText('ship.view.lost_sub'), actions: [{ label: shipText('ship.device.reload'), primary: true, run: () => location.reload() }] });
}

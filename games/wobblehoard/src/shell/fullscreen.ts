// Full screen (UI.md 6.1): the [FS] button, the Menu switch and the F key. Only where the page may use it: `document.fullscreenEnabled` (false on an iPhone; false in a portal
// frame whose `allow` lacks "fullscreen"). A browser can still say no at the moment of the request (no user gesture, a policy): that is handled, not thrown. The first refusal marks
// full screen unavailable for the rest of the visit, so the button and the Menu row go away instead of promising a thing that does nothing.
// The prefixed forms (webkit) cover an iPad's Safari. `fullscreenchange` is the single source of truth for "is it on": the Esc key, the browser's own exit and our button all end there.

type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export interface Fullscreen {
  /** the page may use full screen at all */
  readonly supported: boolean;
  /** supported and not refused yet */
  readonly available: boolean;
  isOn(): boolean;
  /** ask for full screen on / off; resolves true when the request was accepted, false when it was refused or unavailable */
  set(on: boolean): Promise<boolean>;
  toggle(): Promise<boolean>;
  /** run `cb` on every change of the state or the availability; returns the unsubscribe */
  onChange(cb: (on: boolean, available: boolean) => void): () => void;
  destroy(): void;
}

export function createFullscreen(doc: Document = document): Fullscreen {
  const d = doc as FsDoc;
  const supported = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  let refused = false;
  const listeners = new Set<(on: boolean, available: boolean) => void>();
  const isOn = (): boolean => !!(d.fullscreenElement || d.webkitFullscreenElement);
  const fire = (): void => { for (const cb of [...listeners]) { try { cb(isOn(), supported && !refused); } catch (e) { console.error(e); } } };
  const events = ['fullscreenchange', 'webkitfullscreenchange'];
  for (const ev of events) d.addEventListener(ev, fire);

  const set = async (on: boolean): Promise<boolean> => {
    if (!supported || refused) return false;
    if (on === isOn()) return true;
    try {
      if (on) {
        const el = d.documentElement as FsEl;
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        else throw new Error('no requestFullscreen');
      } else if (d.exitFullscreen) await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
      return true;
    } catch {
      // asking to LEAVE never fails for a reason that matters; a refusal to enter marks it unavailable (the portal frame may deny it)
      if (on) { refused = true; fire(); }
      return false;
    }
  };
  return {
    supported,
    get available() { return supported && !refused; },
    isOn,
    set,
    toggle: () => set(!isOn()),
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    destroy() { for (const ev of events) d.removeEventListener(ev, fire); listeners.clear(); },
  };
}

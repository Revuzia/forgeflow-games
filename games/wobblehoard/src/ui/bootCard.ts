// The loading card (UI.md 6 "Loading", R09): the static #boot card of index.html, driven by the COUNT of finished boot events. boot.ts awaits ONE
// Promise.all of three dynamic imports (physics, stage, audio) and then createGame, so there are no three ordered stages: the line follows how
// many have finished (1, 2, 3, then createGame = 4), its copy is indicative, and the bar is count / 4. The card is plain DOM and CSS (boot.css);
// no script means no progress, only the first line and the 12 s watchdog (CSS). Styles go through the CSSOM (--p), never an inline attribute.

/** The events boot.ts counts: three module imports and createGame. */
export const BOOT_TOTAL = 4;
export const BOOT_LINES = ['Warming up the jelly…', 'Finding the felt…', 'Waking the squishy…'] as const;
/** Which line shows after `done` events: nothing yet = the first, one or two = the second, three or four = the third. */
export const bootLineIndex = (done: number): 0 | 1 | 2 => (done >= 3 ? 2 : done >= 1 ? 1 : 0);
/** The bar's fill, 0..1: count / total (the card's CSS keeps a 12 % floor before the first event so the bar never looks empty). */
export const bootFill = (done: number, total = BOOT_TOTAL): number => Math.min(1, Math.max(0, done / total));

export interface BootCard {
  /** `done` boot events have finished. */
  setProgress(done: number): void;
  /** Fade the card out and remove it (the title is already under it). */
  leave(): void;
  /** Remove it at once (an error card is about to show). */
  remove(): void;
}

export function createBootCard(el: HTMLElement | null): BootCard {
  let gone = false;
  const line = el?.querySelector<HTMLElement>('#boot-line') ?? null;
  const drop = (): void => { gone = true; el?.remove(); };
  return {
    setProgress(done) {
      if (!el || gone) return;
      el.dataset.step = String(done);
      el.style.setProperty('--p', String(Math.max(0.12, bootFill(done)).toFixed(3)));
      const text = BOOT_LINES[bootLineIndex(done)];
      if (line && line.textContent !== text) line.textContent = text;
    },
    leave() {
      if (!el || gone) return;
      el.dataset.leaving = 'true';
      el.addEventListener('transitionend', drop, { once: true });
      window.setTimeout(drop, 600);   // transitions off (reduced motion) or never started: still gone
    },
    remove: drop,
  };
}

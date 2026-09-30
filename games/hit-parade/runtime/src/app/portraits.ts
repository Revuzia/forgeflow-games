// HIT PARADE - portrait queue (CHANGED(integrator), P1 integration; SHELL area). CONTRACT §22.3: the menus / HUD show
// setPortraits() images; until a fighter has one, a comic initials badge stands in. This renders them with VIEW's
// Showcase.portrait() (the fighter GLB in its toon look) one at a time and hands each to the UI as it lands:
//   * need(id)    - a fighter on screen right now (bout fighters, the hovered select slot): jumps the queue;
//   * all(ids)    - the whole roster, progressively in the background (menus only; a bout pauses the queue).
// Portraits are colour 0 (the UI tints the frame per colour). A failed render leaves the badge (never retried).

import type { Showcase } from '../view/showcase.ts';

/**
 * CHANGED(fixer) D5: the portrait's pixel size = the largest place it is drawn. The VS splash and the results card show it
 * at up to ~95 % of the viewport height (measured 761 x 846 CSS px at 1600 x 900); it used to be a 256 px image stretched
 * 3.3x (blurred, stair-stepped hair). One image serves every slot (the small HUD / grid badges downscale it cleanly).
 * Rounded up to 128 px, clamped 512 .. 1536 (896 at 1600 x 900 / DPR 1, 1152 at 1920 x 1080, 1536 at DPR 2).
 */
export function portraitSize(): number {
  const vw = Math.max(1, window.innerWidth || 1280), vh = Math.max(1, window.innerHeight || 720);
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const cssNeed = Math.min(vh, vw * 0.62) * 0.95;
  const px = Math.ceil((cssNeed * dpr) / 128) * 128;
  return Math.max(512, Math.min(1536, px));
}

export class PortraitQueue {
  private readonly done = new Map<string, string>();
  private readonly failed = new Set<string>();
  private readonly queue: string[] = [];
  private readonly urgent = new Set<string>();
  private busy = false;
  /** false while a bout steps (the background queue waits) */
  allowed: () => boolean = () => true;
  private readonly sc: Showcase;
  private readonly hand: (map: Record<string, string>) => void;

  constructor(sc: Showcase, hand: (map: Record<string, string>) => void) {
    this.sc = sc;
    this.hand = hand;
  }

  has(id: string): boolean { return this.done.has(id); }
  get count(): number { return this.done.size; }

  /** render `id` next (front of the queue) */
  need(id: string): void {
    if (!id || id === 'random' || this.done.has(id) || this.failed.has(id)) return;
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.unshift(id);
    this.urgent.add(id);
    this.pump();
  }

  /** queue every id (background) */
  all(ids: readonly string[]): void {
    for (const id of ids) if (!this.done.has(id) && !this.failed.has(id) && !this.queue.includes(id)) this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    if (this.busy || !this.queue.length) return;
    if (!this.urgent.has(this.queue[0]) && !this.allowed()) { window.setTimeout(() => this.pump(), 1500); return; }
    const id = this.queue.shift() as string;
    this.urgent.delete(id);
    this.busy = true;
    this.sc.portrait(id, 0, portraitSize()).then((url) => {
      if (url) { this.done.set(id, url); this.hand({ [id]: url }); } else this.failed.add(id);
    }).catch(() => { this.failed.add(id); }).finally(() => {
      this.busy = false;
      if (this.queue.length) window.setTimeout(() => this.pump(), 120);
    });
  }
}

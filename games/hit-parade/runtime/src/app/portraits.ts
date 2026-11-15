// HIT PARADE - portrait queue (CHANGED(integrator), P1 integration; SHELL area). CONTRACT §22.3: the menus / HUD show
// setPortraits() images; until a fighter has one, a comic initials badge stands in. This renders them with VIEW's
// Showcase.portrait() (the fighter GLB in its toon look) one at a time and hands each to the UI as it lands:
//   * need(id)    - a fighter on screen right now (bout fighters, the hovered select slot): jumps the queue;
//   * all(ids)    - the whole roster, progressively in the background (menus only; a bout pauses the queue).
// Portraits are colour 0 (the UI tints the frame per colour). A failed render leaves the badge (never retried).
// CHANGED(wf6 fixer) D8 (CONTRACT §35.26): a BAKED set ships in runtime/public/portraits/ (_harness/bake_portraits.py renders
// it with this same Showcase.portrait at BAKE_SIZE): useBaked() fetches its index at boot, decodes the images and hands them
// over at once, so character select never opens on initials badges (measured: 'GZ' / 'SP' tiles 1.2 s in, real portraits
// ~5 s later on a loaded machine - 12 fighter GLBs rendered one by one). A fighter whose baked image is at least the
// display need (portraitSize()) is never re-rendered; a bigger screen still gets a sharper runtime render, swapped in later.

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

export interface BakedIndex { size: number; ids: string[]; ext?: string }

export class PortraitQueue {
  private readonly done = new Map<string, string>();
  /** CHANGED(wf6 fixer) D8: fighter id -> the baked image's pixel size (handed to the UI at boot) */
  private readonly baked = new Map<string, number>();
  /** CHANGED(wf6 fixer) D8: the baked index is loading - the queue waits for it (no render it would make moot) */
  private loading: Promise<unknown> | null = null;
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

  has(id: string): boolean { return this.done.has(id) || this.baked.has(id); }

  /** CHANGED(wf6 fixer) D8: true when the baked image already covers the display need (no runtime render) */
  private covered(id: string): boolean { return (this.baked.get(id) ?? 0) >= portraitSize(); }

  /**
   * CHANGED(wf6 fixer) D8: load the baked set (`base` = the public base URL). Resolves with the ids handed over; a missing /
   * broken index (lab, an old deploy) resolves [] and the runtime queue renders everything as before.
   */
  useBaked(base: string): Promise<string[]> {
    const p = this.loadBaked(base);
    this.loading = p;
    void p.finally(() => { if (this.loading === p) this.loading = null; this.pump(); });
    return p;
  }

  private async loadBaked(base: string): Promise<string[]> {
    try {
      const r = await fetch(`${base}portraits/index.json`, { cache: 'no-cache' });
      if (!r.ok) return [];
      const ix = (await r.json()) as BakedIndex;
      const size = Number(ix.size) || 0;
      const ext = ix.ext || 'webp';
      const map: Record<string, string> = {};
      await Promise.all((ix.ids ?? []).map(async (id) => {
        if (this.done.has(id)) return;
        const url = `${base}portraits/${id}.${ext}`;
        try {
          const img = new Image();
          img.src = url;
          await img.decode();                                  // decoded before the UI swaps it in: no blank flash
          map[id] = url;
          this.baked.set(id, size);
        } catch { /* that one renders at runtime */ }
      }));
      if (Object.keys(map).length) this.hand(map);
      return Object.keys(map);
    } catch { return []; }
  }
  get count(): number { return this.done.size; }

  /** render `id` next (front of the queue) */
  need(id: string): void {
    if (!id || id === 'random' || this.done.has(id) || this.failed.has(id) || this.covered(id)) return;
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.unshift(id);
    this.urgent.add(id);
    this.pump();
  }

  /** queue every id (background) */
  all(ids: readonly string[]): void {
    for (const id of ids) if (!this.done.has(id) && !this.failed.has(id) && !this.covered(id) && !this.queue.includes(id)) this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    if (this.busy || this.loading || !this.queue.length) return;
    // CHANGED(wf6 fixer) D8: drop what the baked set turned out to cover
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.covered(this.queue[i])) { this.urgent.delete(this.queue[i]); this.queue.splice(i, 1); }
    if (!this.queue.length) return;
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

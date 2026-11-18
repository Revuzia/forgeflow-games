// PLAYGROUND round 8 (R8_SHELL 4): THE FRIENDSHIP FRAME's photo (QUESTS 6.10 and 10: the Friends Everywhere finale's keepsake "Friendship Frame", "a thumbnail of
// the X8 photo, at most 12 KB under its own key, shows in it on the Journal page"; PLAYGROUND_BUILD 11.15: "a JPEG data URL of about 160 x 120 under its own key
// `wobblehoard:v2:journal.frame`, written once at the X8 photo"). A `later-*` module of its own (the file name is the chunk name): the life host imports it only
// when X8 completes with a photo in hand, so it is in neither the first-play download nor the life chunk.
//
// The simplest reading of the spec, as built: the photo that completes X8 is the last one the player took (Snap > Save writes the PHOTO record that X8 counts, so
// the quest completes on that photo's record); its thumbnail (160 x 120, the photo cropped to fill, JPEG) is written once under the key and never replaced; the
// Journal's Keepsakes page shows it in the Friendship Frame once that keepsake is found.
import { JOURNAL_FRAME_KEY, JOURNAL_FRAME_MAX_CHARS } from '../collection/journal.ts';
import type { StorageLike } from '../core/settings.ts';

/** the thumbnail's size (CSS px of the data URL's picture) */
export const FRAME_W = 160, FRAME_H = 120;
/** the JPEG qualities tried in turn until the data URL fits JOURNAL_FRAME_MAX_CHARS */
export const FRAME_QUALITY = [0.82, 0.68, 0.54, 0.4, 0.28] as const;

/** a 2D canvas the size of the thumbnail (the DOM's; node checks pass their own) */
export interface FrameCanvas {
  width: number; height: number;
  getContext(kind: '2d'): { drawImage(img: unknown, x: number, y: number, w: number, h: number): void; fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void } | null;
  toDataURL(type: string, quality?: number): string;
}
export interface FrameMakers {
  /** decode the photo (createImageBitmap) */
  decode(blob: Blob): Promise<{ width: number; height: number; close?(): void }>;
  canvas(): FrameCanvas;
}
const domMakers = (): FrameMakers | null => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  return { decode: (b) => createImageBitmap(b), canvas: () => document.createElement('canvas') as unknown as FrameCanvas };
};

/** where the photo is drawn so it FILLS the 4:3 thumbnail (cropped about its centre): [x, y, w, h] */
export function coverRect(srcW: number, srcH: number, w = FRAME_W, h = FRAME_H): [number, number, number, number] {
  const s = Math.max(w / Math.max(1, srcW), h / Math.max(1, srcH)), dw = srcW * s, dh = srcH * s;
  return [(w - dw) / 2, (h - dh) / 2, dw, dh];
}

/** a stored frame is a JPEG data URL no longer than the cap (anything else under the key is not shown) */
export const validFrame = (u: unknown): u is string => typeof u === 'string' && u.startsWith('data:image/jpeg;base64,') && u.length <= JOURNAL_FRAME_MAX_CHARS;

/** the thumbnail of a photo: a JPEG data URL of FRAME_W x FRAME_H, at the best quality that fits the cap; null when it cannot be made */
export async function makeFrameThumb(blob: Blob, makers: FrameMakers | null = domMakers()): Promise<string | null> {
  if (!makers) return null;
  let img: { width: number; height: number; close?(): void } | null = null;
  try {
    img = await makers.decode(blob);
    const cv = makers.canvas();
    cv.width = FRAME_W; cv.height = FRAME_H;
    const x = cv.getContext('2d');
    if (!x) return null;
    x.fillStyle = '#14102a'; x.fillRect(0, 0, FRAME_W, FRAME_H);
    const r = coverRect(img.width, img.height);
    x.drawImage(img, r[0], r[1], r[2], r[3]);
    for (const q of FRAME_QUALITY) { const u = cv.toDataURL('image/jpeg', q); if (validFrame(u)) return u; }
    return null;
  } catch { return null; }
  finally { try { img?.close?.(); } catch { /* gone */ } }
}

/** the frame now (null when none, or what is under the key is not a valid frame) */
export function readFrame(storage: StorageLike | null): string | null {
  try { const u = storage?.getItem(JOURNAL_FRAME_KEY) ?? null; return validFrame(u) ? u : null; } catch { return null; }
}

/** written ONCE: when no valid frame is stored yet, the photo's thumbnail goes under the key. Resolves true when it wrote. A failed write (quota) leaves nothing. */
export async function storeFrame(storage: StorageLike | null, blob: Blob, make: (b: Blob) => Promise<string | null> = (b) => makeFrameThumb(b)): Promise<boolean> {
  if (!storage || readFrame(storage)) return false;
  const u = await make(blob);
  if (!validFrame(u) || readFrame(storage)) return false;
  try { storage.setItem(JOURNAL_FRAME_KEY, u); return storage.getItem(JOURNAL_FRAME_KEY) === u; } catch { return false; }
}

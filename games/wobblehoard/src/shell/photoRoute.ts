// Snap > Save photo: which way a photo leaves the page (UI.md 6.1). PURE (the window is passed in), so _harness/probe_screens.ts decides every case without a browser.
//
// The portal puts the game in an iframe whose sandbox lacks `allow-downloads` (PUBLISH_CHECKLIST_SHORT 6): an `<a download>` click there does nothing, silently (Chromium
// measured: 0 download events; with the flag, 1). A page gets no event for a download a frame dropped and cannot read the sandbox flags of a cross-origin parent, so the
// download cannot be CONFIRMED from inside a frame. The rule is therefore structural, never a guess about a host name or a browser:
//   * embedded in any frame (self !== top, or top is unreachable)      -> the Photo card (the picture, to press-and-hold or right-click and save)
//   * a page that cannot even try (no `download` attribute on anchors,  -> the Photo card
//     or the blob URL could not be made)
//   * otherwise (a top-level page)                                       -> the download, and the toast "Photo saved."
// First-play code (this file is tiny and the Snap bar needs it at once); the card itself is the later-* chunk `ui/screens/later-photo.ts`.

export interface PhotoEnv {
  /** this document is not the top one (a portal frame, an embed); unreachable top counts as embedded */
  embedded: boolean;
  /** anchors in this browser know the `download` attribute */
  anchorDownload: boolean;
}

export function photoEnv(win: Window = window): PhotoEnv {
  let embedded: boolean;
  try { embedded = win.self !== win.top; } catch { embedded = true; }
  let anchorDownload = false;
  try { anchorDownload = 'download' in win.document.createElement('a'); } catch { anchorDownload = false; }
  return { embedded, anchorDownload };
}

/** true when the Photo card is the way (before any download is tried) */
export const needsPhotoCard = (e: PhotoEnv): boolean => e.embedded || !e.anchorDownload;

export type PhotoRoute = 'card' | 'download';
export interface PhotoIo {
  env: PhotoEnv;
  /** show the Photo card (async: a later-* chunk) */
  card(): void;
  /** try the download; false = it could not even be tried (then the card shows) */
  download(): boolean;
}

/** Decide and act: the card when a download cannot be confirmed, else the download. Returns the route taken. */
export function routePhoto(io: PhotoIo): PhotoRoute {
  if (needsPhotoCard(io.env)) { io.card(); return 'card'; }
  let ok = false;
  try { ok = io.download(); } catch { ok = false; }
  if (ok) return 'download';
  io.card();
  return 'card';
}

/** The download itself: a hidden anchor with a blob URL, clicked once (the way it has always worked). False when the browser cannot make the URL. */
export function downloadBlob(blob: Blob, name: string, doc: Document = document): boolean {
  let url: string;
  try { url = URL.createObjectURL(blob); } catch { return false; }
  const a = doc.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

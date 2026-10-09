// The B4 entry points as NAMED NO-OP STUBS (UI.md 8, B3c). The overlays (the Menu, the Photo card, Full screen, the portal's pause) are B4's; the keys, Esc and
// the Save photo path already call these names, so B4 replaces this file's bodies (or points the imports at `shell/{pauseCtl,fullscreen}.ts` and the Menu)
// and touches no caller. Until then every stub does nothing and says so: a key that reaches one is not consumed and nothing opens.

/** The Menu (key P, Esc with nothing open): open it; true when it opened. B4. */
export function openMenu(): boolean { return false; }

/** Full screen on / off (key F, the [FS] button). B4 (`shell/fullscreen.ts`: only where `document.fullscreenEnabled`). */
export function toggleFullscreen(): void { /* B4 */ }

/** The Photo card (Snap > Save photo inside a sandboxed iframe, or when a download cannot be confirmed; UI.md 6.1): show the photo in a dialog;
 *  true when it did (then the download path is skipped). Standalone and until B4: false, the download + the live line "Photo saved." stand. */
export function openPhotoCard(_photo: Blob, _fileName: string): boolean { return false; }

/** The portal's pause (`window.__PAUSE__.pause()`, UI.md 6.1): open the Menu and suspend the game as 'covered'. B4 (`shell/pauseCtl.ts`). */
export function pause(): void { /* B4 */ }

/** Esc, layers 2 and 3 of UI.md 4.5: close the Photo card or a modal, then the Menu; true when something closed. B4. */
export function closeOverlay(): boolean { return false; }

/** Live-region lines that belong to the B4 overlays (UI.md 4.5, word for word), kept here so B4 says exactly these. */
export const OVERLAY_LINES = {
  menuOpen: 'Menu open.',
  photoReady: 'Photo ready. Press and hold the picture to save it.',
} as const;

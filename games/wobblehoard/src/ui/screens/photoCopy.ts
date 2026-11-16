// The words of the Photo card (UI.md 6.1, 4.5). Its own file so the later-* chunk of the card does not share a module with the other screens' chunk (a shared module would become a
// chunk of its own without the `later-` prefix, and G0b would count it as first-play). PURE data: the probe reads it.
export const PHOTO_TITLE = 'Your photo';
/** UI.md 6.1, word for word. */
export const PHOTO_HINT = 'Press and hold the picture (or right-click it) and choose Save image.';
/** The live line (UI.md 4.5, word for word). */
export const PHOTO_LINE = 'Photo ready. Press and hold the picture to save it.';
export const PHOTO_NEW_TAB = 'Open in a new tab';
export const PHOTO_DONE = 'Done';
/** said when the browser refuses the new tab (the button then goes away; the hint stays the way to save) */
export const PHOTO_TAB_BLOCKED = 'A new tab could not open here. Press and hold the picture to save it.';

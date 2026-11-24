// One root scale token for the whole UI. The screens are designed for a window of at least
// UI_MIN_W x UI_MIN_H (a 360 x 640 phone, a 640 x 360 landscape phone). In anything smaller (a narrow
// desktop pane, a split screen) the UI is laid out as if the window were that big and scaled down in
// one go, so no component wraps a label, clips a button or overflows on its own. Down to UI_FLOOR the
// text stays legible; below it the scale stops shrinking.
// ui.css reads --ui-scale (and --uvw / --uvh, the window in the UI's own pixels).

export const UI_MIN_W = 360;
export const UI_MIN_H = 360;
export const UI_FLOOR = 0.5;

/** The scale for a window of w x h CSS pixels: 1 at or above the design minimum, smaller below it. */
export function uiScale(w, h) {
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.max(UI_FLOOR, Math.min(1, w / UI_MIN_W, h / UI_MIN_H));
}

/** Apply it to a document (browser only): sets --ui-scale on <html> and marks it when the UI is shrunk. */
export function applyUiScale(doc, w, h) {
  const s = uiScale(w, h), root = doc.documentElement;
  root.style.setProperty('--ui-scale', String(Math.round(s * 1000) / 1000));
  root.classList.toggle('ui-shrunk', s < 1);
  return s;
}

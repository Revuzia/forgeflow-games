// The layout audit: geometry checks on the real screens (real DOM, real ui.css, real Menus and Hud),
// run inside a browser frame of an exact size by tests/layout/audit.html and driven from
// tests/layout.test.js. Everything is measured, nothing is guessed from the CSS.
//
// Rules (a violation is a string; an empty list is a pass):
//   offscreen   a visible element reaches past the window (scrolling panels may extend downwards only)
//   wrapped     a button label, tab, tag, title or name that must stay on one line is on two
//   truncated   text cut short (ellipsis or clipped), so a name is not fully readable
//   overlap     two controls / text blocks cover each other; the wordmark's INK (outline, drop shadow, tilt)
//               counts as part of the wordmark, so the tagline must clear it
//   small       a control smaller than 44 UI pixels in its smaller side
// Sizes are checked in the UI's own pixels where that matters (the UI scales down in a tiny window).

const SKIP = '.confetti, .complete-rays, .win-flash, .hud-blink, .wipe, .touch-orbit, .touch-stickzone, .touch-stick';
const ONE_LINE = '.btn:not(.primary):not(.danger) > span, .seg-btn, .el-who, .el-progress span, .stop-time, .stop-badge, .el-soon, .tab, .chip, .panel-tag, .panel-head h2, .hud-name, .hud-area, .hud-banner-eyebrow, .el-name, .logo-word';
// text that may wrap (a long level name, a note) but only so far: a label never takes a line per word
const MAX_LINES = [['.btn.primary > span, .btn.danger > span', 2], ['.row-label', 3], ['.complete-name, .stop-name, .el-detail-name, .road-head', 2]];
const CONTROLS = 'button, [role="button"], .tagline, .el-detail, .hud-name, .hud-area, .hud-banner, .hud-hint, .hud-shards, .hud-meter, .formbar, .touch-forms, .touch-jump, .stat-v';
const BIG = 'button, [role="button"], .tab, .icon-btn:not(.ghost), .touch-form, .touch-jump, .form-slot';

const R = (e) => e.getBoundingClientRect();
const name = (e) => {
  const t = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  const c = e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return `${e.tagName.toLowerCase()}${c}${t ? ` "${t}"` : ''}`;
};
const visible = (e) => {
  const r = R(e);
  if (r.width < 1 || r.height < 1) return false;
  for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || n.hidden) return false;
  }
  return true;
};
const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
const hit = (a, b, slop = 1) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > slop && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > slop;

/** Number of text lines an element's own text is laid out on. */
export function lineCount(e) {
  const tops = [];
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    for (const r of range.getClientRects()) { if (r.width > 0.5 && !tops.some((t) => Math.abs(t - r.top) < r.height * 0.5)) tops.push(r.top); }
  }
  return tops.length;
}

/** The wordmark with its ink: every letter's box, grown by half the outline and the drop shadow. */
export function wordmarkInk(word) {
  const cs = getComputedStyle(word);
  const stroke = parseFloat(cs.webkitTextStrokeWidth) || 0;
  const drop = parseFloat((cs.textShadow.match(/\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px/) || [])[2]) || 0;
  let box = null;
  for (const s of word.children) {
    const r = R(s);
    box = box ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  if (!box) return null;
  return { left: box.left - stroke / 2, right: box.right + stroke / 2, top: box.top - stroke / 2, bottom: box.bottom + stroke / 2 + drop, stroke, drop };
}

/**
 * @param root     the #ui element
 * @param opts     { w, h, scale }  window size, UI scale (visual px per UI px)
 */
export function auditLayout(root, { w, h, scale = 1 }) {
  const out = [];
  const view = { left: 0, top: 0, right: w, bottom: h };
  const all = [...root.querySelectorAll('*')].filter((e) => !e.matches(SKIP) && !e.closest(SKIP) && visible(e));

  // offscreen
  for (const e of all) {
    const r = R(e), sc = e.closest('.scroll');
    if (sc && e !== sc) {
      const s = R(sc);
      if (r.left < s.left - 1 || r.right > s.right + 1) out.push(`offscreen: ${name(e)} sticks out of its scrolling list sideways (${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(s.left)}..${Math.round(s.right)})`);
      continue;
    }
    if (!inside(r, view)) out.push(`offscreen: ${name(e)} is at ${Math.round(r.left)},${Math.round(r.top)} - ${Math.round(r.right)},${Math.round(r.bottom)} in a ${w}x${h} window`);
  }

  // wrapped and truncated
  for (const e of all) {
    const cap = e.matches(ONE_LINE) ? 1 : (MAX_LINES.find(([sel]) => e.matches(sel)) || [0, 0])[1];
    if (cap) {
      const n = lineCount(e);
      if (n > cap) out.push(`wrapped: ${name(e)} is on ${n} lines (at most ${cap})`);
    }
    const cs = getComputedStyle(e);
    const clips = cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    if (clips && e.scrollWidth > e.clientWidth + 1 && e.textContent.trim() && !e.matches('.chapter, .el-bar, .meter, .hud-meter-bar, .switch, .stops') && !e.querySelector('svg, button')) {
      out.push(`truncated: ${name(e)} (${e.scrollWidth}px of text in ${e.clientWidth}px)`);
    }
  }
  // an area name in the banner may take two lines but never a word per line
  const bn = root.querySelector('.hud-banner-name');
  if (bn && visible(bn)) {
    const n = lineCount(bn);
    if (n > 2) out.push(`wrapped: the area banner "${bn.textContent}" is on ${n} lines`);
  }

  // overlap between controls / text blocks (not parent and child)
  const blocks = all.filter((e) => e.matches(CONTROLS));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      if (a.contains(b) || b.contains(a)) continue;
      if ((a.matches('.hud-hint') && b.matches('.hud-banner')) || (b.matches('.hud-hint') && a.matches('.hud-banner'))) continue;   // the hint gives way to the banner (hud.has-banner)
      if (hit(R(a), R(b), 2)) out.push(`overlap: ${name(a)} and ${name(b)}`);
    }
  }
  // the title: the tagline must clear the wordmark's ink
  const word = root.querySelector('.logo-word'), tag = root.querySelector('.tagline');
  if (word && visible(word)) {
    const ink = wordmarkInk(word);
    if (ink && !inside(ink, view)) out.push(`offscreen: the wordmark's ink (${Math.round(ink.left)}..${Math.round(ink.right)} x ${Math.round(ink.top)}..${Math.round(ink.bottom)}) leaves the ${w}x${h} window`);
    if (ink && tag && visible(tag) && hit(ink, R(tag), 0.5)) {
      out.push(`overlap: the tagline (${Math.round(R(tag).top)}..${Math.round(R(tag).bottom)}) covers the wordmark's ink (${Math.round(ink.top)}..${Math.round(ink.bottom)})`);
    }
    const fs = parseFloat(getComputedStyle(word).fontSize) * scale;       // the letters must be big enough to read
    if (fs < 28) out.push(`small: the wordmark is only ${fs.toFixed(1)}px tall`);
  }

  // touch targets, in UI pixels
  for (const e of all) {
    if (!e.matches(BIG) || e.matches('.hud-pause, .seg-btn, .el-card.locked')) continue;
    const r = R(e), m = Math.min(r.width, r.height) / scale;
    if (m < 43.5) out.push(`small: ${name(e)} is ${Math.round(r.width / scale)}x${Math.round(r.height / scale)} UI px`);
  }
  return out;
}

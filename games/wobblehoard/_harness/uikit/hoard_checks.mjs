// B5 live rows: measurements on the REAL Hoard UI inside the kit scenes (pages/b5.ts), at the kit sizes and modes. Every row prints a number or a fact.
//   node _harness/uikit/hoard_checks.mjs [--sizes=1280x800,390x844,...] [--modes=normal,calm,contrast,forced] [--port=5436]
// Rows: ONE close button per panel (audit W13) | the Sort select keeps its id | the double-rim frame (3 px of the tier colour + a 2 px ink ring) on every owned plinth
// and a visible gem + tier word on every plinth in the grid view | no species name broken inside a word, Tidy / result rows keep 12 ch for the name (audit weakness 5)
// | the hold-to-merge label is a dual layer: cream on the track and ink on amber, both >= 4.5:1 (audit weakness 6: it was 1.48:1), the fill layer aria-hidden
// | every control >= 44 x 44 | no horizontal overflow, the panel / card / pad / plate inside the viewport | the plate's place per layout | Calm: nothing animates
// | forced-colors: the selected tab differs from the others, no backdrop-filter | one close button on the card too.
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';
import { KIT_SIZES } from '../../src/ui/layout.ts';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (name, dflt = '') => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : dflt; };
const PORT = Number(opt('port', '5436'));
const MODES = opt('modes', 'normal,calm,contrast,forced').split(',').filter(Boolean);
const want = opt('sizes').split(',').filter(Boolean);
const SIZES = KIT_SIZES.filter((s) => !want.length || want.includes(`${s.w}x${s.h}`));
const MODE_CTX = { normal: { reducedMotion: 'no-preference' }, calm: { reducedMotion: 'reduce' }, contrast: { contrast: 'more' }, forced: { forcedColors: 'active' } };
const SECTIONS = ['hoard-shelf', 'hoard-grid', 'hoard-card', 'hoard-gift', 'merge-pad', 'merge-hold', 'tidy-plan', 'plate-new', 'hoard-parts'];
void ROOT;

let fails = 0, rows = 0;
const row = (name, ok, extra = '') => { rows++; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };

/** Runs in the page. Returns plain facts per scene. */
function measure() {
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const sec = (id) => document.getElementById(`sec-${id}`);
  const out = { iw: innerWidth, ih: innerHeight, hscroll: document.documentElement.scrollWidth - innerWidth };
  const inView = (r) => r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5;
  const sceneBox = (id) => { const s = sec(id)?.querySelector('.kp-scene'); return s ? s.getBoundingClientRect() : null; };
  const rel = (id, e) => { const sb = sceneBox(id); const r = e.getBoundingClientRect(); return sb ? { left: r.left - sb.left, right: r.right - sb.left, top: r.top - sb.top, bottom: r.bottom - sb.top, width: r.width, height: r.height } : r; };
  // --- shelf
  const shelf = sec('hoard-shelf');
  if (shelf) {
    const panel = shelf.querySelector('.hoard');
    out.shelf = {
      closeVisible: [...panel.querySelectorAll('button')].filter((b) => vis(b) && /close|dismiss/i.test(b.getAttribute('aria-label') ?? '')).length,
      gotIt: [...panel.querySelectorAll('button')].filter((b) => /got it/i.test(b.textContent)).length,
      sortId: !!panel.querySelector('#wh-hoard-sort'), sortVisible: vis(panel.querySelector('#wh-hoard-sort')),
      plinths: panel.querySelectorAll('.plinth').length, shelves: panel.querySelectorAll('.shelf').length,
      owned: [...panel.querySelectorAll('.plinth[data-owned="true"]')].map((p) => { const cs = getComputedStyle(p); return { bw: parseFloat(cs.borderTopWidth), style: cs.borderTopStyle, ring: /0px 0px 0px 2px/.test(cs.boxShadow) || cs.boxShadow.includes('2px'), gem: !!p.querySelector('svg.plinth-gem'), name: p.getAttribute('aria-label') }; }).slice(0, 200),
      names: [...panel.querySelectorAll('.plinth-name')].filter(vis).map((n) => { const cs = getComputedStyle(n); const lh = parseFloat(cs.lineHeight) || 16; const r = n.getBoundingClientRect(); return { t: n.textContent, lines: Math.round(r.height / lh), cut: n.scrollWidth > n.clientWidth + 1 }; }),
      panelRect: rel('hoard-shelf', panel), iw: innerWidth, ih: innerHeight,
      tabSelected: [...panel.querySelectorAll('.hoard-tab')].map((t) => ({ sel: t.getAttribute('aria-selected'), bg: getComputedStyle(t).backgroundColor, bgi: getComputedStyle(t).backgroundImage.slice(0, 12), name: t.getAttribute('aria-label') })),
      backdrop: getComputedStyle(panel).backdropFilter,
    };
    out.shelf.controls = [...panel.querySelectorAll('button, select, input')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { c: String(e.className).split(' ')[0] || e.tagName, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.w < 44 || r.h < 44);
    out.shelf.scrollW = [panel.scrollWidth, panel.clientWidth];
    { const pb = panel.getBoundingClientRect(); out.shelf.outside = [...panel.querySelectorAll('button, select, h2, p')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < pb.left - 0.5 || b.right > pb.right + 0.5); }).map((e) => String(e.className).split(' ')[0] || e.tagName); }
  }
  // --- grid view: every plinth shows its gem and its tier word
  const grid = sec('hoard-grid');
  if (grid) out.grid = { tierWords: [...grid.querySelectorAll('.plinth')].map((p) => { const w = p.querySelector('.plinth-tier'); return { word: w?.textContent, shown: w ? vis(w) : false }; }).filter((x) => !x.shown || !x.word).length, n: grid.querySelectorAll('.plinth').length };
  // --- card
  const card = sec('hoard-card');
  if (card) {
    const c = card.querySelector('.hcard');
    const cs = getComputedStyle(c);
    out.card = { closeVisible: [...c.querySelectorAll('button')].filter((b) => vis(b) && /close the hoard/i.test(b.getAttribute('aria-label') ?? '')).length, rect: rel('hoard-card', c), bw: parseFloat(cs.borderTopWidth), name: c.querySelector('#wh-card-name')?.textContent, nameCut: (() => { const n = c.querySelector('#wh-card-name'); return n.scrollWidth > n.clientWidth + 1; })(),
      small: [...c.querySelectorAll('button')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { c: String(e.className).split(' ')[0], w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.w < 44 || r.h < 44),
      outside: [...c.querySelectorAll('button, h2, p')].filter((e) => { const b = e.getBoundingClientRect(); const cb = c.getBoundingClientRect(); return b.width > 0 && (b.left < cb.left - 0.5 || b.right > cb.right + 0.5); }).length, scrollW: [c.scrollWidth, c.clientWidth] };
  }
  // --- gift
  const gift = sec('hoard-gift');
  if (gift) out.gift = { cards: gift.querySelectorAll('.gift').length, checked: gift.querySelector('.gift[aria-checked="true"] .gift-check') ? vis(gift.querySelector('.gift[aria-checked="true"] .gift-check')) : false, cut: [...gift.querySelectorAll('.gift-name, .gift-tier, .gift-own')].filter((n) => n.scrollWidth > n.clientWidth + 1).length };
  // --- merge pad: the hold button is a dual layer
  const pad = sec('merge-pad');
  if (pad) {
    const hb = pad.querySelector('.hold-btn');
    const lab = hb.querySelector('.hold-label'), fill = hb.querySelector('.merge-fill');
    const track = getComputedStyle(hb).backgroundColor, base = getComputedStyle(lab).color, fillBg = getComputedStyle(fill).backgroundColor, fillFg = getComputedStyle(fill).color;
    out.pad = { track, base, fillBg, fillFg, rBase: ratio(base, track), rFill: ratio(fillFg, fillBg), fillHidden: fill.getAttribute('aria-hidden'), text: lab.textContent, fillText: fill.textContent, bh: Math.round(hb.getBoundingClientRect().height),
      rect: rel('merge-pad', pad.querySelector('.hmerge')), scrollW: [pad.querySelector('.hmerge').scrollWidth, pad.querySelector('.hmerge').clientWidth], slots: pad.querySelectorAll('.slot').length };
  }
  const held = sec('merge-hold');
  if (held) { const fill = held.querySelector('.merge-fill'); out.held = { clip: getComputedStyle(fill).clipPath, p: held.querySelector('.hold-btn').style.getPropertyValue('--p') }; }
  // --- tidy rows: the name keeps its own line
  const tidy = sec('tidy-plan');
  if (tidy) out.tidy = { rows: [...tidy.querySelectorAll('.hmerge-outs .out')].map((o) => { const n = o.querySelector('.out-name'); const cs = getComputedStyle(n); const lh = parseFloat(cs.lineHeight) || 20; const r = n.getBoundingClientRect(); return { name: n.textContent, w: Math.round(r.width), lines: Math.round(r.height / lh), minW: Math.round(parseFloat(cs.fontSize) * 6) }; }), noteCaps: getComputedStyle(tidy.querySelector('.hmerge-note') ?? tidy.querySelector('.hmerge-sub')).textTransform };
  // --- parts: the long-name rows at 320 px
  const parts = sec('hoard-parts');
  if (parts) out.parts = { rows: [...parts.querySelectorAll('.kp-narrow .out')].map((o) => { const n = o.querySelector('.out-name'); const lh = parseFloat(getComputedStyle(n).lineHeight) || 20; const r = n.getBoundingClientRect(); return { name: n.textContent, w: Math.round(r.width), lines: Math.round(r.height / lh), cut: n.scrollWidth > n.clientWidth + 1 }; }), plates: [...parts.querySelectorAll('.plate')].filter(vis).length, anims: document.getAnimations().filter((a) => a.playState === 'running').length };
  // --- plate
  const plate = sec('plate-new');
  if (plate) { const p = plate.querySelector('.plate'); const cs = getComputedStyle(p); out.plate = { rect: rel('plate-new', p), visible: vis(p) && cs.opacity === '1', bw: parseFloat(cs.borderTopWidth), chip: p.querySelector('.plate-chip')?.textContent, name: p.querySelector('.plate-name')?.textContent, tier: p.querySelector('.plate-tier')?.textContent, gem: !!p.querySelector('svg.gem'), nameCut: (() => { const n = p.querySelector('.plate-name'); return n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).textOverflow !== 'ellipsis'; })() }; }
  out.running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getKeyframes().some((k) => 'transform' in k || 'opacity' in k)).map((a) => a.animationName ?? a.transitionProperty ?? 'anim');
  out.inViewDummy = inView({ left: 0, right: 0, top: 0, bottom: 0 });
  return out;
}

const vite = await startVite(PORT);
let browser = null;
try {
  browser = await launch({});
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark', ...(MODE_CTX[mode] ?? {}) });
    for (const size of SIZES) {
      const tag = `[${mode} ${size.w}x${size.h}]`;
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(`${vite.url}_harness/uikit/index.html?batch=B5&only=${SECTIONS.join(',')}${mode === 'calm' ? '&calm=1' : ''}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 30000 });
      await page.waitForTimeout(600);
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));   // panels slide in (220 ms): measure the settled boxes
      const m = await page.evaluate(measure);
      row(`${tag} no page errors, no horizontal scroll (K03)`, errs.length === 0 && m.hscroll <= 0, `hscroll ${m.hscroll}${errs.length ? ' ' + errs[0].slice(0, 120) : ''}`);
      const s = m.shelf;
      row(`${tag} the shelf: ONE visible close button (W13); "Got it" is a word, not a second X`, s.closeVisible === 1 && s.gotIt <= 1, `close ${s.closeVisible}, got it ${s.gotIt}`);
      row(`${tag} the Sort select keeps #wh-hoard-sort${size.h <= 260 ? '' : ' and shows'}`, s.sortId && s.sortVisible, JSON.stringify({ id: s.sortId, vis: s.sortVisible }));
      row(`${tag} 50 plinths on 6 shelves; every owned plinth has a ${mode === 'forced' ? 'border' : '3 px tier rim + 2 px ink ring'} and a gem`, s.plinths === 50 && s.shelves === 6 && s.owned.length > 0 && s.owned.every((o) => o.gem && (mode === 'forced' || (o.bw >= 3 && o.ring))), `owned ${s.owned.length}, rim ${[...new Set(s.owned.map((o) => o.bw))].join('/')}`);
      row(`${tag} no species name broken inside a word (<= 2 lines) or cut off`, s.names.every((n) => n.lines <= 2 && !n.cut), s.names.filter((n) => n.lines > 2 || n.cut).slice(0, 3).map((n) => `${n.t}:${n.lines}`).join(' ') || `${s.names.length} names`);
      row(`${tag} grid view: every plinth shows its tier word beside the gem (rarity is never colour alone)`, m.grid.tierWords === 0, `${m.grid.tierWords} of ${m.grid.n} lack it`);
      row(`${tag} every shelf control is >= 44 x 44 (K02)`, s.controls.length === 0, s.controls.slice(0, 4).map((c) => `${c.c} ${c.w}x${c.h}`).join(', ') || 'all >= 44');
      row(`${tag} nothing in the shelf sticks out of the sheet sideways (the browser reflow row: a Sort select did at 320 px)`, s.outside.length === 0, s.outside.slice(0, 3).join(',') || 'none');
      row(`${tag} the panel is inside the viewport and does not scroll sideways`, s.panelRect.left >= -0.5 && s.panelRect.right <= m.iw + 0.5 && s.panelRect.top >= -0.5 && s.panelRect.bottom <= m.ih + 0.5 && s.scrollW[0] <= s.scrollW[1] + 1, JSON.stringify({ l: Math.round(s.panelRect.left), r: Math.round(s.panelRect.right), t: Math.round(s.panelRect.top), b: Math.round(s.panelRect.bottom), sw: s.scrollW }));
      if (mode === 'forced') {
        const sel = s.tabSelected.find((t) => t.sel === 'true'), other = s.tabSelected.find((t) => t.sel === 'false');
        row(`${tag} forced-colors: the selected tab differs from the others; no backdrop-filter`, sel && other && sel.bg !== other.bg && s.backdrop === 'none', `${sel?.bg} vs ${other?.bg}`);
      }
      const c = m.card;
      row(`${tag} the card: ONE close button, the jelly name is whole, every button >= 44, nothing sticks out sideways`, c.closeVisible === 1 && !c.nameCut && c.small.length === 0 && c.outside === 0 && c.scrollW[0] <= c.scrollW[1] + 1, JSON.stringify({ close: c.closeVisible, nameCut: c.nameCut, small: c.small.slice(0, 2), outside: c.outside }));
      row(`${tag} the card keeps the tier frame (3 px) and sits inside the viewport`, (mode === 'forced' || c.bw >= 3) && c.rect.right <= m.iw + 0.5 && c.rect.bottom <= m.ih + 0.5 && c.rect.left >= -0.5 && c.rect.top >= -0.5, `border ${c.bw}, rect ${Math.round(c.rect.left)},${Math.round(c.rect.top)} ${Math.round(c.rect.right)},${Math.round(c.rect.bottom)}`);
      row(`${tag} the gift: three cards; the pick shows a check mark (not colour alone); no text cut`, m.gift.cards === 3 && m.gift.checked && m.gift.cut === 0, JSON.stringify(m.gift));
      const p = m.pad;
      row(`${tag} hold to merge: the label is a dual layer, cream on the track >= 4.5 and ink on amber >= 4.5, the fill layer aria-hidden (was 1.48:1)`, mode === 'forced' || (p.rBase >= 4.5 && p.rFill >= 4.5 && p.fillHidden === 'true' && p.text === p.fillText), `base ${p.rBase.toFixed(2)} (${p.base} on ${p.track}), fill ${p.rFill.toFixed(2)} (${p.fillFg} on ${p.fillBg}), height ${p.bh}`);
      row(`${tag} merge pad: two slots, inside the viewport, no sideways scroll; held 55 % clips the fill layer`, p.slots === 2 && p.rect.left >= -0.5 && p.rect.right <= m.iw + 0.5 && p.scrollW[0] <= p.scrollW[1] + 1 && /inset/.test(m.held.clip), `clip ${m.held.clip}`);
      row(`${tag} Tidy rows: the name keeps its own line (>= 12 ch) and does not break per letter; the note is a sentence, not capitals`, m.tidy.rows.length > 0 && m.tidy.rows.every((r) => r.lines <= 2 && r.w >= r.minW) && m.tidy.noteCaps === 'none', JSON.stringify(m.tidy.rows.map((r) => `${r.name}:${r.w}px/${r.lines}`)));
      row(`${tag} the long-name rows of the parts sheet (320 px column): names whole, <= 2 lines`, m.parts.rows.every((r) => r.lines <= 2 && !r.cut && r.w >= 70), JSON.stringify(m.parts.rows.map((r) => `${r.name}:${r.w}/${r.lines}`)));
      const pl = m.plate;
      const layout = size.layout;
      const topOk = layout === 'wide' ? Math.abs(pl.rect.top - 10) <= 2 : layout === 'tiny' ? Math.abs(m.ih - pl.rect.bottom - 9) <= 2 && Math.round(pl.rect.height) <= 40 : Math.abs(pl.rect.top - 70) <= 2;
      row(`${tag} reveal plate (${layout}): ${layout === 'wide' ? 'top y 10' : layout === 'tiny' ? 'the bottom row, one line 36 high' : 'top y 70'}, tier rim 3 px, gem + jelly tier + species + sticker, whole on screen`,
        pl.visible && topOk && (mode === 'forced' || pl.bw >= 3) && pl.gem && pl.chip === 'NEW' && !!pl.tier && !!pl.name && pl.rect.left >= -0.5 && pl.rect.right <= m.iw + 0.5 && !pl.nameCut, JSON.stringify({ top: Math.round(pl.rect.top), bottom: Math.round(pl.rect.bottom), h: Math.round(pl.rect.height), w: Math.round(pl.rect.width), chip: pl.chip, tier: pl.tier }));
      if (mode === 'calm') row(`${tag} Calm: no transform or opacity animation is running after settle (K08)`, m.running.length === 0, m.running.join(',') || 'none');
      await page.close();
    }
    await ctx.close();
  }
} catch (e) {
  fails++;
  console.log('FAIL harness crashed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
} finally {
  if (browser) await browser.close().catch(() => {});
  vite.stop();
}
console.log(`\n${rows - fails}/${rows} Hoard kit rows passed`);
process.exit(fails ? 1 : 0);

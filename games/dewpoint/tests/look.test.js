// The v2 look as data (DESIGN-V2.md section 2): nine themes that are each their own place and time
// of day, three campaign palettes, the ink ids the outline pass tells edges by, and the interface's
// colour tokens - whose text must be legible on every surface in all three skins.

import { test, assert, eq } from './lib/harness.js';
import { readFileSync } from 'node:fs';
import { THEMES, THEME_NAMES, CAMPAIGN_THEMES, resolveTheme, surfaceFor, paintFor } from '../src/render/themes.js';
import { INK, inkOfNormal, GeoBuilder } from '../src/render/geo.js';
import { ELEMENT_UI, UI_ELEMENT_ORDER } from '../src/ui/elements.js';

const HEX = /^#[0-9a-f]{6}$/i;
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('themes: nine themes, three per campaign, in chapter order', () => {
  eq(THEME_NAMES, ['slip', 'loft', 'kiln', 'pilot', 'flue', 'wire', 'wedge', 'bisque', 'glost']);
  eq(CAMPAIGN_THEMES, { water: ['slip', 'loft', 'kiln'], fire: ['pilot', 'flue', 'wire'], clay: ['wedge', 'bisque', 'glost'] });
  for (const [camp, names] of Object.entries(CAMPAIGN_THEMES)) for (const n of names) eq(THEMES[n].campaign, camp, n);
  eq(new Set(THEME_NAMES.map((n) => THEMES[n].time)).size, 9, 'each theme is its own time of day');
  eq(resolveTheme('glost').name, 'glost'); eq(resolveTheme('lava').name, 'slip');
});

test('themes: every theme has what the renderer reads, in the units it expects', () => {
  for (const n of THEME_NAMES) {
    const t = THEMES[n];
    for (const k of ['fog', 'ink', 'trim', 'silhouette', 'silhouetteFar']) assert(HEX.test(t[k]), `${n}.${k} = ${t[k]}`);
    for (const k of ['top', 'mid', 'horizon', 'glow', 'sun', 'cloud', 'cloudShade']) assert(HEX.test(t.sky[k]), `${n}.sky.${k}`);
    for (const k of ['base', 'swirl', 'deep']) assert(HEX.test(t.abyss[k]), `${n}.abyss.${k}`);
    assert(t.fogNear > 10 && t.fogFar > t.fogNear + 30, `${n}: haze from ${t.fogNear} to ${t.fogFar} m`);
    assert(Math.hypot(...t.sun) > 0.5 && t.sun[1] > 0.3, `${n}: the key light comes from above`);
    assert(t.hemi.length === 2 && t.key.length === 1 && [...t.hemi, ...t.key].every((c) => c.length === 3 && c.every((v) => v >= 0 && v <= 1.5)), `${n}: light colours are linear rgb`);
    assert(t.dark >= 0 && t.dark <= 1 && t.moteLight >= 0 && t.glowK > 0 && t.poolK > 0, `${n}: dark / moteLight / glowK / poolK`);
    assert(typeof t.time === 'string' && t.time, `${n}.time`);
    assert(!(t.sky.sunSize > 0 && t.sky.moon > 0), `${n}: a sun or a moon, not both`);
    for (const m of ['tile', 'cream', 'brick', 'dark', 'metal', 'clay']) {
      const s = surfaceFor(t, m);
      for (const side of ['top', 'side']) {
        const p = paintFor(t, s[side]);
        assert(Object.prototype.hasOwnProperty.call(t.paints, s[side]), `${n}/${m}.${side}: no paint named "${s[side]}"`);
        assert(typeof p.kind === 'string' && p.tones.length >= 1 && p.tones.every((c) => HEX.test(c)) && HEX.test(p.line), `${n}: paint ${s[side]}`);
        assert(contrast(p.line, p.tones[0]) >= 1.6, `${n}: the line-work of "${s[side]}" does not show on its fill (${contrast(p.line, p.tones[0]).toFixed(2)}:1)`);
      }
    }
  }
});

test('themes: shadows are coloured, never grey, and day is brighter than night', () => {
  for (const n of THEME_NAMES) {
    const sky = THEMES[n].hemi[0], spread = Math.max(...sky) - Math.min(...sky);
    assert(spread >= 0.02, `${n}: the shadow colour ${sky} is a neutral grey`);
    const lit = sky.map((v, i) => v + THEMES[n].key[0][i]);
    assert(Math.max(...lit) <= 1.3, `${n}: a sunlit face would burn out (${lit.map((v) => v.toFixed(2))})`);
  }
  const bright = (n) => THEMES[n].hemi[0].reduce((s, v, i) => s + v + THEMES[n].key[0][i], 0);
  for (const w of CAMPAIGN_THEMES.water) for (const f of CAMPAIGN_THEMES.fire) assert(bright(w) > bright(f), `${w} should be brighter than ${f}`);
  for (const f of CAMPAIGN_THEMES.fire) assert(THEMES[f].moteLight > 0 && THEMES[f].dark >= 0.5, `${f}: dark enough for Cinder to light it`);
  for (const w of [...CAMPAIGN_THEMES.water, ...CAMPAIGN_THEMES.clay]) assert(THEMES[w].dark < 0.2, `${w} is a daylight theme`);
});

test('ink ids: the faces of a box are told apart, coplanar faces are not, glow is never inked', () => {
  const ids = [INK.top, INK.slope, INK.x, INK.z, INK.bottom, INK.hero, INK.eye, ...[0, 1, 2, 3, 4, 5].map(INK.prop)];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert(Math.abs(ids[i] - ids[j]) >= 0.02, `ink ids ${ids[i]} and ${ids[j]} are too close for the edge test`);
  for (const face of [INK.top, INK.slope, INK.x, INK.z, INK.bottom]) for (const other of [INK.top, INK.slope, INK.x, INK.z, INK.bottom]) assert(face === other || Math.abs(face - other) >= 0.05, 'the faces of a box differ by at least the edge threshold');
  eq(INK.none, 0); assert(INK.sky > 0.006 && INK.sky < 0.05, 'the sky has an id of its own, so silhouettes against it are inked');
  eq(inkOfNormal(0, 1, 0), INK.top); eq(inkOfNormal(0, -1, 0), INK.bottom); eq(inkOfNormal(1, 0, 0), INK.x); eq(inkOfNormal(-1, 0, 0), INK.x);
  eq(inkOfNormal(0, 0, -1), INK.z); eq(inkOfNormal(0.5, 0.86, 0), INK.slope);
  const b = new GeoBuilder().box(0, 0, 0, 1, 1, 1).box(1, 0, 0, 2, 1, 1);
  const tops = []; for (let i = 0; i < b.n; i++) if (b.nrm[i * 3 + 1] > 0.9) tops.push(b.si[i * 3 + 1]);
  assert(tops.length === 8 && tops.every((v) => v === INK.top), 'two boxes side by side share the id of their tops: no seam is drawn between them');
  const g = new GeoBuilder(); g.glow.box(0, 0, 0, 1, 1, 1, { color: [1, 0, 0], tint: [1, 1, 1] }); g.box(2, 0, 0, 3, 1, 1, { top: 3, side: 4 });
  assert(g.si.slice(0, 72).every((v, i) => (i % 3 === 0 ? v === -1 : i % 3 === 1 ? v === 0 : true)), 'unlit paint is layer -1, ink id 0');
  eq(g.si[72], 3, 'and the builder is back to normal after it');
  const cyl = new GeoBuilder().cylinder(0, 0, 0, 1, 1, 1, 8);
  eq(new Set(cyl.si.filter((v, i) => i % 3 === 1)).size, 1, 'a round prop has one id: it is outlined, its facets are not');
});

// ---- the interface's tokens, read from the stylesheet itself
const css = readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8');
function tokens(selector) {
  const i = css.indexOf(selector), j = css.indexOf('}', i), out = {};
  assert(i >= 0, `no ${selector} block in ui.css`);
  css.slice(i, j).replace(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g, (all, k, v) => { out[k] = v; return all; });
  return out;
}

test('ui tokens: text is legible on every surface, in all three skins (WCAG contrast, worst case 4.5:1)', () => {
  const base = tokens(':root {');
  const skins = { water: base, fire: { ...base, ...tokens('#ui[data-skin="fire"]') }, clay: { ...base, ...tokens('#ui[data-skin="clay"]') } };
  let worst = Infinity, where = '';
  const need = (skin, fg, bg, min, text = true) => {
    const t = skins[skin], c = contrast(t[fg], t[bg]);
    if (text && c < worst) { worst = c; where = `${skin}: ${fg} on ${bg}`; }
    assert(c >= min, `${skin}: --${fg} ${t[fg]} on --${bg} ${t[bg]} is ${c.toFixed(2)}:1, needs ${min}:1`);
  };
  for (const s of UI_ELEMENT_ORDER) {
    for (const k of ['ink', 'paper', 'paper-2', 'text', 'dim', 'el', 'el-deep', 'el-ink', 'accent', 'accent-ink', 'focus', 'inv', 'inv-text']) assert(HEX.test(skins[s][k] || ''), `${s}: token --${k}`);
    need(s, 'text', 'paper', 7); need(s, 'text', 'paper-2', 7);          // body text
    need(s, 'dim', 'paper', 4.5); need(s, 'dim', 'paper-2', 4.5);        // secondary text, small
    need(s, 'el-ink', 'el', 4.5); need(s, 'accent-ink', 'accent', 4.5);  // labels on the accent colours
    need(s, 'inv-text', 'inv', 7);                                       // inverted chips (key caps, counters, the area line)
    need(s, 'focus', 'ink', 3, false);                                   // the focus ring against its ink surround: 3:1 for non-text
  }
  assert(worst >= 4.5, `worst text contrast ${worst.toFixed(2)}:1 (${where})`);
  if (process.env.DEW_REPORT) console.log(`        worst text contrast: ${worst.toFixed(2)}:1 (${where})`);
});

test('ui tokens: one component set, three skins - cool water, hot fire, earthy clay', () => {
  for (const id of UI_ELEMENT_ORDER) assert(css.includes(`.el-card[data-element="${id}"]`), `no card colours for ${id}`);
  for (const id of UI_ELEMENT_ORDER) assert(HEX.test(ELEMENT_UI[id].accent) && HEX.test(ELEMENT_UI[id].accentDeep));
  const warm = (hex) => { const n = parseInt(hex.slice(1), 16); return (n >> 16 & 255) > (n & 255); };
  assert(!warm(tokens(':root {').el), 'water is cool'); assert(warm(tokens('#ui[data-skin="fire"]').el), 'fire is hot'); assert(warm(tokens('#ui[data-skin="clay"]').el), 'clay is earthy');
  assert(lum(tokens('#ui[data-skin="fire"]').paper) < 0.05, 'fire panels are dark, so its embers glow');
  assert(lum(tokens(':root {').paper) > 0.8 && lum(tokens('#ui[data-skin="clay"]').paper) > 0.8, 'water and clay panels are light paper');
});

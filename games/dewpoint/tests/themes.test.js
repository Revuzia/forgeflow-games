// Chapter themes (src/render/themes.js): the optional level `theme` field must be accepted by the
// level loader, resolved with a safe fallback by the renderer, and every registered level that
// sets one must name a theme that exists (a typo would silently fall back to 'slip').

import { test, assert, eq } from './lib/harness.js';
import { Sim } from '../src/sim/sim.js';
import { levels } from '../src/levels/index.js';
import { THEMES, THEME_NAMES, DEFAULT_THEME, themeName, resolveTheme, surfaceFor } from '../src/render/themes.js';
import l01 from '../src/levels/l01.js';

const MATS = ['tile', 'cream', 'brick', 'dark', 'metal', 'clay'];   // LEVELS.md, block `mat`

test('resolver: known names, and a quiet fallback for anything else', () => {
  for (const n of THEME_NAMES) eq(resolveTheme(n).name, n);
  eq(themeName({ theme: 'kiln' }), 'kiln');
  eq(themeName({ source: { theme: 'loft' } }), 'loft', 'runtime level reads its source data');
  for (const bad of [undefined, null, '', 'Kiln', 'lava', 7, {}, [], '__proto__', 'constructor', 'toString']) {
    eq(themeName({ theme: bad }), DEFAULT_THEME, `theme ${JSON.stringify(bad)}`);
    eq(resolveTheme(bad).name, DEFAULT_THEME);
  }
  eq(themeName(null), DEFAULT_THEME); eq(themeName(undefined), DEFAULT_THEME);
});

test('every theme paints every block material, and unknown mats fall back to tile', () => {
  for (const n of THEME_NAMES) {
    const t = THEMES[n];
    for (const m of MATS) {
      const s = surfaceFor(t, m);
      assert(s && typeof s.top === 'string' && typeof s.side === 'string', `${n}/${m}`);
    }
    eq(surfaceFor(t, 'nonsense'), t.surfaces.tile);
    eq(surfaceFor(t, '__proto__'), t.surfaces.tile);
    for (const k of ['fog', 'fogDensity', 'sky', 'hemi', 'key', 'trim', 'lamp', 'ambient', 'backdrop']) assert(t[k] !== undefined, `${n} missing ${k}`);
  }
});

test('level loader accepts the theme field (any value; the renderer validates it)', () => {
  for (const theme of [...THEME_NAMES, 'unknown', undefined, 5]) {
    const sim = new Sim({ ...l01, theme });
    eq(sim.level.source.theme, theme);
  }
});

test('registered levels: theme, when set, is one of slip / loft / kiln', () => {
  for (const l of levels) {
    if (l.theme === undefined) continue;
    assert(THEME_NAMES.includes(l.theme), `${l.id}: theme ${JSON.stringify(l.theme)} is not one of ${THEME_NAMES.join(', ')}`);
  }
  for (const id of ['l01', 'l02', 'l03']) eq(levels.find((l) => l.id === id).theme, 'slip', id);
});

/**
 * What does the rampart-walk fix cost in geometry? Builds verdant-1's fort def
 * three ways against the REAL builder and prints triangles + collider count:
 * the shipped ring walk with its aperture, the same ring with no aperture, and
 * `roofSolid` (the old full-footprint lid). Pure geometry — draw calls cannot
 * change, the building is one merged mesh with the same six material groups in
 * every case.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, 'modulecheck.mjs'), 'utf8');
// reuse modulecheck's DOM shim verbatim
const shim = src.slice(src.indexOf('function shimDom()'), src.indexOf('shimDom();'));
eval(shim + '\nshimDom();');

const B = await import(pathToFileURL(join(HERE, '..', 'runtime/world/builders.js')).href);
const THEME = (await import(pathToFileURL(join(HERE, '..', 'runtime/world/themes.js')).href));
const theme = THEME.themeFor ? THEME.themeFor('verdant') : (THEME.THEMES && THEME.THEMES.verdant);

const base = {
  kind: 'building', style: 'fort', p: [0, 11.70, -24], s: [22, 5.4, 22],
  mat: 'stone', wallThick: 2.0, footing: 2.0, rampart: true, merlons: true,
  doors: [{ side: 'south', w: 4.6, h: 5.0 }, { side: 'north', w: 3.0, h: 4.0 }],
};
const cases = [
  ['ring + shaft aperture (shipped)', { ...base, roofOpen: [{ x: -9.65, z: -9.45, w: 4.70, d: 5.10 }] }],
  ['ring, no aperture', { ...base }],
  ['roofSolid (the old lid)', { ...base, roofSolid: true }],
];
for (const [name, def] of cases) {
  const { mesh, colliders } = B.buildBuilding(def, theme, new Map());
  const g = mesh.geometry;
  const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
  console.log('  %s  tris %s  verts %s  colliders %d',
    name.padEnd(32), String(tris).padStart(6),
    String(g.attributes.position.count).padStart(6), colliders.length);
}

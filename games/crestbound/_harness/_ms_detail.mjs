// missions lane scratch probe: print what a mission changes (tags, paths, crest homes)
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, documentElement: { style: {} }, head: { appendChild() {} }, body: { appendChild() {} } };
const C = await import(pathToFileURL(join(ROOT, 'runtime/world/course.js')).href);
const def = (await import(pathToFileURL(join(ROOT, 'runtime/data/courses', process.argv[2] + '.js')).href)).default;
for (const mid of process.argv.slice(3)) {
  const r = C.resolveMission(def, mid === 'null' ? null : mid);
  console.log('== mission', mid);
  for (const c of r.def.critters) if (c.tag) console.log('  critter', c.kind, c.tag, JSON.stringify(c.path || c.p));
  for (const o of r.def.objects) if (o.tag) console.log('  object', o.kind, o.tag, JSON.stringify({ p: o.p, period: o.period }));
  console.log('  added objects:', r.def.objects.length - def.objects.length, 'crestsLive', JSON.stringify(r.def.crestsLive));
  for (const c of r.def.crests) if (c.id === mid) console.log('  crest', c.id, 'p', JSON.stringify(c.p), 'spawnAt', JSON.stringify(c.spawnAt));
  console.log('  base def untouched:', def.critters.find(c => c.tag === 'yard-bumbler').path[0].join(','), def.objects.find(o => o.tag === 'mill').period);
}

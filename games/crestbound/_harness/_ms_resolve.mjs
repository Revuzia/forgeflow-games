// missions lane scratch probe: resolveMission against real course data (node, no DOM)
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, documentElement: { style: {} }, head: { appendChild() {} }, body: { appendChild() {} } };
const C = await import(pathToFileURL(join(ROOT, 'runtime/world/course.js')).href);
const idx = await import(pathToFileURL(join(ROOT, 'runtime/data/index.js')).href);
const ids = process.argv[2] ? process.argv[2].split(',') : (idx.ALL_COURSE_IDS || []);
let bad = 0;
for (const id of ids) {
  const def = (await import(pathToFileURL(join(ROOT, 'runtime/data/courses', id + '.js')).href)).default;
  const r0 = C.resolveMission(def, null);
  const line = [id, 'plain:' + (r0.def === def ? 'IDENTITY' : 'resolved')];
  try { const v = C.Course.validate(def); line.push('validate ok, ' + v.warnings.length + ' warn'); for (const w of v.warnings) if (w.startsWith('mission')) line.push('  W ' + w); } catch (e) { bad++; line.push('VALIDATE FAIL ' + e.message); }
  for (const m of C.missionList(def)) {
    const r = C.resolveMission(def, m.id);
    const mi = r.mission;
    line.push(`  ${m.index + 1} ${m.id.padEnd(7)} ${m.declared ? 'M' : '-'} "${m.name}" present=[${mi.present}] absent=[${mi.absent}] obj ${def.objects.length}->${r.def.objects.length} crit ${(def.critters || []).length}->${(r.def.critters || []).length} counts=${JSON.stringify(mi.counts)} routes=${JSON.stringify(mi.routes)} at=${JSON.stringify(mi.at)} unmatched=${JSON.stringify(mi.unmatched)}`);
  }
  console.log(line.join('\n'));
}
process.exit(bad ? 1 : 0);

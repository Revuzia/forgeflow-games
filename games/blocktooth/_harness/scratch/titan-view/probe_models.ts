// titan-view lane scratch probe: geometry sanity for every titan model (node, type-stripped).
import { buildTitanModel } from '../../../src/titans/models.ts';
import type { TitanId } from '../../../src/core/types.ts';
const ids: TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
let bad = 0;
for (const id of ids) {
  const m = buildTitanModel(id);
  let tris = 0, minY = Infinity, maxY = -Infinity, nan = 0, wsum = 0, idxBad = 0;
  const nb = m.meshes[0].skeleton.bones.length;
  for (const mesh of m.meshes) {
    const pos = mesh.geometry.getAttribute('position');
    const sw = mesh.geometry.getAttribute('skinWeight');
    const si = mesh.geometry.getAttribute('skinIndex');
    tris += pos.count / 3;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (!Number.isFinite(y) || !Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getZ(i))) nan++;
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
      if (Math.abs(s - 1) > 1e-4) wsum++;
      if (si.getX(i) >= nb || si.getY(i) >= nb) idxBad++;
    }
  }
  const ok = nan === 0 && wsum === 0 && idxBad === 0 && Math.abs(maxY - 1) < 1e-6 && minY > -0.02 && minY < 0.02;
  if (!ok) bad++;
  console.log(`${id.padEnd(10)} meshes=${m.meshes.length} tris=${tris} bones=${nb} y=[${minY.toFixed(3)}, ${maxY.toFixed(3)}] size=${JSON.stringify({ w: +m.size.width.toFixed(2), l: +m.size.length.toFixed(2), z0: +m.size.zMin.toFixed(2), z1: +m.size.zMax.toFixed(2) })} legs=${m.legs.map((l) => l.name + ':' + l.pole.map((v) => v.toFixed(2)).join(',')).join(' ')} nan=${nan} badW=${wsum} badIdx=${idxBad} ${ok ? 'OK' : 'FAIL'}`);
  m.dispose();
}
console.log(bad ? `FAIL ${bad}` : 'ALL OK');
process.exit(bad ? 1 : 0);

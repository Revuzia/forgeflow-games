() => { const root = window.__BT__.debugCore.scene.getObjectByName('civilians'); const m = new root.matrixWorld.constructor(); const e = m.elements; const U = [];
 let meshes = []; root.traverse(o => { if (o.isInstancedMesh && !/ink/.test(o.name)) meshes.push(o.name + ':' + o.count + ':' + Object.keys(o.geometry.attributes).join('|')); });
 root.traverse(o => { if (!o.isInstancedMesh || /ink/.test(o.name) || !o.visible) return; const a = o.geometry.attributes.iC1; if (!a) return;
  for (let i = 0; i < o.count; i++) { const mask = a.getW(i); if (!((mask >> 6) & 1)) continue; o.getMatrixAt(i, m); const s = Math.hypot(e[0], e[1], e[2]); if (s < 1e-4) continue; U.push([e[12], e[14], s, o.name]); } });
 let p104 = 0, p08 = 0, minD = 99; for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) { const d = Math.hypot(U[i][0]-U[j][0], U[i][1]-U[j][1]) / Math.max(U[i][2], U[j][2]); minD = Math.min(minD, d); if (d < 1.04) p104++; if (d < 0.8) p08++; }
 return { umbrellas: U.length, pairsCanopyOverlap: p104, pairsUnder08: p08, minD: +minD.toFixed(3), meshes: meshes.slice(0, 3) }; }

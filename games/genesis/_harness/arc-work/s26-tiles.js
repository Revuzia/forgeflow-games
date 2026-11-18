(() => { const tc = globalThis.__TCACHE__; if (!tc) return 'no cache'; const lod = tc.lod, cam = tc.cam, out = []; let sA = 0, sT = 0;
  for (const [p, t] of tc.tiles) { if (t.lastUsed !== tc.frame) continue; const sc = p.sphere.center; const dx = sc.x - cam.x, dy = sc.y - cam.y, dz = sc.z - cam.z;
    const dc = Math.hypot(dx, dy, dz), l = Math.hypot(sc.x, sc.y, sc.z), ndv = Math.max(0, -(dx * sc.x + dy * sc.y + dz * sc.z) / l / dc), size = lod.size(p.level);
    sA += t.area; sT += t.cls >= 0 ? [24, 32, 48, 72, 96, 144, 192, 288, 576][t.cls] ** 2 / 2 : 0;
    out.push([p.level, +size.toFixed(1), Math.round(t.dn), Math.round(dc), +ndv.toFixed(2), +((p.hMax - p.hMin) / size).toFixed(2), Math.round(t.need), Math.round(t.area), t.cls]); }
  out.sort((a, b) => b[7] - a[7]);
  const pick = out.filter((_, i) => i < 12 || i % Math.max(1, Math.floor(out.length / 25)) === 0);
  return `N=${out.length} areaSum=${Math.round(sA)} texSum=${Math.round(sT)} [lvl,size,dn,dc,ndv,relief,need,area,cls] ` + JSON.stringify(pick); })()

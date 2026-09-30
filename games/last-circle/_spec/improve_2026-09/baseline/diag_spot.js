// Dump map geometry around reported stuck spots (read-only).
async ([seed, mapId, spots]) => {
  const C = window.__LC__, W = C.W;
  await C.startMatch({ mapId, mode: "standard", seed });
  W.paused = true;
  const m = W.map;
  function obstacleAt(x, z, y) {
    const cols = m.queryColliders(x, z, 0.6);
    for (const c of cols) {
      if (c.kind === "ramp") continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      if (c.minY < y + 2.0 && c.maxY > y + 0.55) return true;
    }
    return false;
  }
  const cellBlocked = (x, z) => { const g = m.heightAt(x, z); if (g < m.waterY + 0.3) return true; return obstacleAt(x, z, g); };
  const out = [];
  for (const [x, y, z] of spots) {
    let poi = null, pd = 1e9;
    for (const p of m.pois) { const d = Math.hypot(p.x - x, p.z - z); if (d < pd) { pd = d; poi = p; } }
    const cols = m.queryColliders(x, z, 5).map((c) => ({ kind: c.kind || "box", minX: +c.minX.toFixed(2), maxX: +c.maxX.toFixed(2), minY: +c.minY.toFixed(2), maxY: +c.maxY.toFixed(2), minZ: +c.minZ.toFixed(2), maxZ: +c.maxZ.toFixed(2), tag: c.tag || c.name || c.type || null }));
    const inside = cols.filter((c) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ);
    const grid = [];
    for (let dz = -4; dz <= 4; dz++) { let row = ""; for (let dx = -4; dx <= 4; dx++) row += (dx === 0 && dz === 0) ? "@" : (cellBlocked(x + dx * 1.5, z + dz * 1.5) ? "#" : "."); grid.push(row); }
    out.push({ spot: [x, y, z], ground: +m.heightAt(x, z).toFixed(2), waterY: m.waterY, poi: poi && poi.name, poiD: +pd.toFixed(1), ncols: cols.length, inside, cols: cols.slice(0, 14), grid });
  }
  return out;
}

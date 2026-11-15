// How often is a bot standing INSIDE a wall/building volume, split by the camera-distance LOD
// (player.js:962 far = > 250 m from the camera => terrain-only movement, no wall blocking).
// Args: [seed, mapId, seconds, skipStart] - skipStart (L1F): the harness already started the match and left the lobby with a
// REAL Enter (common.start_match) with the kernel loop frozen; without it the probe starts its own (audit behaviour).
async ([seed, mapId, seconds, skipStart]) => {
  const C = window.__LC__, W = C.W;
  if (!skipStart) {
    await C.startMatch({ mapId, mode: "standard", seed });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  }
  W.paused = true;
  const m = W.map;
  // inside = the actor's capsule centre column overlaps a non-ramp collider at body height
  const inside = (a) => {
    for (const c of m.queryColliders(a.pos.x, a.pos.z, 0.4)) {
      if (c.kind === "ramp") continue;
      if (a.pos.x < c.minX - 0.2 || a.pos.x > c.maxX + 0.2 || a.pos.z < c.minZ - 0.2 || a.pos.z > c.maxZ + 0.2) continue;
      if (c.minY < a.pos.y + 1.4 && c.maxY > a.pos.y + 0.6) return true;
    }
    return false;
  };
  let farN = 0, nearN = 0, farIn = 0, nearIn = 0, underFloor = 0;
  const wasFarIn = new Map(); let farToNearInside = 0;
  const ex = [];
  for (let el = 0; el < seconds; el += 0.5) {
    C.fastForward(0.5, 1 / 30);
    const cp = W.camera.position;
    for (const a of W.actors) {
      if (!a.alive || !a.isBot || a.gliding) continue;
      const far = a.pos.distanceToSquared(cp) > 250 * 250;
      const ins = inside(a);
      if (far) { farN++; if (ins) farIn++; } else { nearN++; if (ins) nearIn++; }
      if (!far && ins && wasFarIn.get(a.id)) { farToNearInside++; if (ex.length < 6) ex.push({ id: a.id, t: +W.t.toFixed(1), x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(1), z: +a.pos.z.toFixed(1) }); }
      wasFarIn.set(a.id, far && ins);
    }
    if (W.match.over) break;
  }
  return { seed, map: W.mapId, simT: +W.t.toFixed(1), farN, nearN, farIn, nearIn, farToNearInside, ex };
}

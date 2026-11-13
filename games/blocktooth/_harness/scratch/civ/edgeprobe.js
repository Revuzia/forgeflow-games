(() => {
  // place one calm civilian so that it straddles the right screen edge near the bottom, at > 1.6x the
  // target figure's on-screen height, and hold it there for the next frames (debug probe)
  const B = window.__BT__, core = B.debugCore, cam = core.camera;
  const r = core.scene.getObjectByName('civilians'); const S = r.userData.civState; const d = r.userData.civ;
  let i = -1; for (let k = 0; k < S.st.length; k++) if (S.st[k] === 1 || S.st[k] === 2) { i = k; break; }
  if (i < 0) return 'none';
  const V = cam.position.constructor;
  const hit = (nx, ny) => { const v = new V(nx, ny, 0.5).unproject(cam); const dir = v.sub(cam.position).normalize(); const t = (0.16 - cam.position.y) / dir.y; return cam.position.clone().add(dir.multiplyScalar(t)); };
  let best = null;
  for (let ny = -0.95; ny < 0.2; ny += 0.05) {
    const p = hit(0.985, ny); const dist = p.distanceTo(cam.position);
    const h = window.innerHeight; const pxK = h / (2 * Math.tan(cam.fov * Math.PI / 360)); const px = 1.5 * S.scale() * pxK / dist;
    if (px > d.figPx * 1.1 && !best) best = { x: p.x, z: p.z, ny, px: Math.round(px) };
  }
  if (!best) return 'no spot';
  window.__edgeProbe = { i, x: best.x, z: best.z };
  if (!window.__edgeProbeTimer) window.__edgeProbeTimer = setInterval(() => { const q = window.__edgeProbe; S.x[q.i] = q.x; S.z[q.i] = q.z; S.st[q.i] = 2; }, 4);
  S.x[i] = best.x; S.z[i] = best.z; S.st[i] = 2;
  return { i, best, fade: S.fade[i] };
})()

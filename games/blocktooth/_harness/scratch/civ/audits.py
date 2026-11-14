# extra audits for civshot2.py (scratch)
FAC_JS = """() => {
  const city = window.__BT__.world.city;
  const root = window.__BT__.debugCore.scene.getObjectByName('civilians');
  const S = root.userData.civState; const sc = S.scale();
  let all = 0, flee = 0, nearAll = 0, nearFlee = 0, inside = 0;
  const faceCount = new Map();
  for (let i = 0; i < S.st.length; i++) {
    const st = S.st[i]; if (st !== 1 && st !== 2 && st !== 3) continue;
    const x = S.x[i], z = S.z[i]; all++; if (st === 3) flee++;
    for (const b of city.buildings) {
      if (b.collapsed) continue;
      const ax = Math.abs(x - b.x) - b.w / 2, az = Math.abs(z - b.z) - b.d / 2;
      if (ax < -0.05 && az < -0.05) { inside++; break; }
      if (ax < 0.3 * sc && az < 0.3 * sc) {
        nearAll++; if (st === 3) nearFlee++;
        const face = b.id + (ax > az ? (x > b.x ? 'E' : 'W') : (z > b.z ? 'S' : 'N'));
        faceCount.set(face, (faceCount.get(face) || 0) + 1);
        break;
      }
    }
  }
  let maxFace = 0, maxFaceId = null; for (const [k, v] of faceCount) if (v > maxFace) { maxFace = v; maxFaceId = k; }
  // one-deep line detector: civilians within 0.6 m x scale of the same face
  const line = new Map();
  for (let i = 0; i < S.st.length; i++) {
    const st = S.st[i]; if (st !== 1 && st !== 2 && st !== 3) continue;
    const x = S.x[i], z = S.z[i];
    for (const b of city.buildings) {
      if (b.collapsed) continue;
      const ax = Math.abs(x - b.x) - b.w / 2, az = Math.abs(z - b.z) - b.d / 2;
      if (ax < 0.6 * sc && az < 0.6 * sc && Math.max(ax, az) > -0.05) {
        const face = b.id + (ax > az ? (x > b.x ? 'E' : 'W') : (z > b.z ? 'S' : 'N'));
        line.set(face, (line.get(face) || 0) + 1); break;
      }
    }
  }
  let maxLine = 0; for (const v of line.values()) if (v > maxLine) maxLine = v;
  return { scale: sc, alive: all, fleeing: flee, inside, within03_all: nearAll, within03_flee: nearFlee,
           pctFlee: flee ? +(100 * nearFlee / flee).toFixed(1) : 0, pctAll: all ? +(100 * nearAll / all).toFixed(1) : 0,
           maxPerFace03: maxFace, maxFaceId, maxPerFace06: maxLine, dbg: root.userData.civ };
}"""

UMB_JS = """() => {
  const root = window.__BT__.debugCore.scene.getObjectByName('civilians');
  const S = root.userData.civState; const sc = S.scale();
  const U = [], B = [];
  for (let i = 0; i < S.st.length; i++) {
    const st = S.st[i]; if (st !== 1 && st !== 2 && st !== 3) continue;
    const mk = S.col[i * 20 + 7];
    if ((mk >> 6) & 1) U.push(i);
    if ((mk >> 7) & 1) B.push(i);
  }
  let p104 = 0, p08 = 0, minD = 99;
  for (let a = 0; a < U.length; a++) for (let b = a + 1; b < U.length; b++) {
    const i = U[a], j = U[b]; const d = Math.hypot(S.x[i] - S.x[j], S.z[i] - S.z[j]) / sc;
    if (d < minD) minD = d; if (d < 1.04) p104++; if (d < 0.8) p08++;
  }
  // arms-out (panic / wave) pairs: centre distance / scale
  let armsMin = 99, armsUnder09 = 0; const A = [];
  for (let i = 0; i < S.st.length; i++) { const st = S.st[i]; if (st !== 1 && st !== 2 && st !== 3) continue; if (S.pose[i] === 1 || S.pose[i] === 4) A.push(i); }
  for (let a = 0; a < A.length; a++) for (let j = 0; j < S.st.length; j++) {
    const i = A[a]; if (j === i) continue; const st = S.st[j]; if (st !== 1 && st !== 2 && st !== 3) continue;
    const d = Math.hypot(S.x[i] - S.x[j], S.z[i] - S.z[j]) / sc; if (d < armsMin) armsMin = d; if (d < 0.9) armsUnder09++;
  }
  return { umbrellas: U.length, balloons: B.length, umbPairsUnder104: p104, umbPairsUnder08: p08, umbMin: +minD.toFixed(3),
           armsOut: A.length, armsMin: +armsMin.toFixed(3), armsPairsUnder09: armsUnder09, minSepRatio: root.userData.civ.minSepRatio, minGap: root.userData.civ.minGap };
}"""

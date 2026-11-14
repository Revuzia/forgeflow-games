import * as THREE from 'three';

/**
 * PRISM BOULEVARD — dense neon megacity scenery module.
 *
 * A cyberpunk downtown that surrounds the huge (radius ~808) hover circuit:
 *   • a lit neon-grid city FLOOR (procedural CanvasTexture — replaces the dark disc)
 *   • a NEAR ring of glass skyscrapers hugging the track (setbacks / tapers / spires,
 *     emissive window-grid facades, rooftop light-crowns, antennae + beacons,
 *     sky-bridges spanning adjacent towers)
 *   • a MID ring of towers filling the middle distance
 *   • a FAR skyline layer (silhouettes that fade into the fog for depth)
 *   • holographic billboards floating among the towers (additive neon)
 *   • a subtle starfield backdrop + faint pace-rings over the racing line
 *
 * PERFORMANCE: every repeated prop is drawn with a single InstancedMesh, so the
 * whole city costs ~14 draw calls regardless of the ~1600 instances placed.
 * DETERMINISTIC: only ctx.rnd is used (never Math.random) — including the
 * procedural textures, so a given seed always renders the identical city.
 *
 * Interface: export function buildScene(ctx) — adds meshes to ctx.group.
 *   ctx = { group, samples, def, rnd, HALF, totalLength }
 */
export function buildScene(ctx) {
  const { group, samples, def, rnd, HALF } = ctx;
  const R = def.radius;
  const GROUND_Y = -2; // matches the engine's former ground plane height

  // ---- palette (from the circuit def) -------------------------------------
  const railHex = '#' + (def.rail >>> 0).toString(16).padStart(6, '0');
  const accentHex = '#' + (def.accent >>> 0).toString(16).padStart(6, '0');
  const WARM = '#ffd9a6';
  const WHITEISH = '#dff6ff';

  const dummy = new THREE.Object3D();
  const tmpCol = new THREE.Color();

  // Wrap a textured material's dispose() so it frees its CanvasTextures when the
  // engine tears the race group down (engine disposes materials but not their
  // maps — this prevents a GPU-texture leak across repeated races).
  const selfDispose = (mat) => {
    const orig = mat.dispose.bind(mat);
    mat.dispose = () => {
      for (const k of ['map', 'emissiveMap']) if (mat[k] && mat[k].dispose) mat[k].dispose();
      orig();
    };
    return mat;
  };

  // =========================================================================
  // Procedural CanvasTextures (deterministic via rnd)
  // =========================================================================
  const makeCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };

  // Lit window-grid facade. `mix` biases the lit-window colour toward one neon.
  const makeWindowTexture = (mix, cols, rows, litProb) => {
    const W = 128;
    const H = 256;
    const cv = makeCanvas(W, H);
    const g = cv.getContext('2d');
    // Facade base — a faint vertical glow so towers read against the sky even
    // where windows are dark (brighter near the top, near-black at the base).
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#151633');
    grad.addColorStop(0.6, '#0a0a1c');
    grad.addColorStop(1, '#040410');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const mx = W * 0.12;
    const my = H * 0.04;
    const cw = (W - 2 * mx) / cols;
    const ch = (H - 2 * my) / rows;
    const winW = cw * 0.6;
    const winH = ch * 0.5;
    const pick = () => {
      const t = rnd();
      if (mix === 'cyan') return t < 0.68 ? railHex : t < 0.84 ? WHITEISH : accentHex;
      if (mix === 'magenta') return t < 0.68 ? accentHex : t < 0.84 ? WARM : railHex;
      return t < 0.4 ? railHex : t < 0.78 ? accentHex : t < 0.9 ? WHITEISH : WARM;
    };
    for (let r = 0; r < rows; r++) {
      const darkFloor = rnd() < 0.16; // whole unlit floors
      for (let c = 0; c < cols; c++) {
        const x = mx + c * cw + (cw - winW) / 2;
        const y = my + r * ch + (ch - winH) / 2;
        if (!darkFloor && rnd() < litProb) {
          const col = pick();
          g.shadowColor = col;
          g.shadowBlur = 5;
          g.fillStyle = col;
          g.fillRect(x, y, winW, winH);
          g.shadowBlur = 0;
        } else {
          g.fillStyle = '#0a0a18';
          g.fillRect(x, y, winW, winH);
        }
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };

  // Neon city floor — dark base, dim minor grid, bright major (block) lines with
  // magenta accents at some intersections. Tiled via RepeatWrapping.
  const makeGroundTexture = () => {
    const S = 256;
    const cv = makeCanvas(S, S);
    const g = cv.getContext('2d');
    g.fillStyle = '#03030b';
    g.fillRect(0, 0, S, S);
    // minor grid
    g.strokeStyle = 'rgba(0,240,255,0.14)';
    g.lineWidth = 1;
    const minor = 32;
    for (let i = 0; i <= S; i += minor) {
      g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, S); g.stroke();
      g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(S, i + 0.5); g.stroke();
    }
    // major block lines (glowing cyan) at tile edges + centre
    g.shadowColor = railHex;
    g.shadowBlur = 8;
    g.strokeStyle = railHex;
    g.lineWidth = 3;
    for (const p of [0, S / 2, S]) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.shadowBlur = 0;
    // magenta accent nodes at block corners
    g.fillStyle = accentHex;
    for (const px of [0, S / 2, S]) {
      for (const py of [0, S / 2, S]) {
        g.shadowColor = accentHex; g.shadowBlur = 10;
        g.fillRect(px - 3, py - 3, 6, 6);
        g.shadowBlur = 0;
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  // Holographic billboard content (drawn on black → invisible under additive
  // blending, only the neon shapes glow).
  const makeHoloTexture = (kind) => {
    const W = 256;
    const H = 160;
    const cv = makeCanvas(W, H);
    const g = cv.getContext('2d');
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    g.shadowBlur = 8;
    if (kind === 0) {
      // equalizer bars + scanlines
      const bars = 14;
      const bw = (W / bars) * 0.62;
      for (let i = 0; i < bars; i++) {
        const col = rnd() < 0.5 ? railHex : accentHex;
        const bh = H * (0.2 + rnd() * 0.7);
        g.fillStyle = col; g.shadowColor = col;
        g.fillRect(i * (W / bars) + (W / bars - bw) / 2, H - bh, bw, bh);
      }
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(223,246,255,0.35)';
      g.lineWidth = 1;
      for (let y = 6; y < H; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    } else {
      // target rings + radial ticks + banner bar
      const cx = W * 0.5;
      const cy = H * 0.44;
      for (let r = 0; r < 4; r++) {
        g.strokeStyle = r % 2 ? accentHex : railHex;
        g.shadowColor = g.strokeStyle;
        g.lineWidth = 2.5;
        g.beginPath(); g.arc(cx, cy, 14 + r * 16, 0, Math.PI * 2); g.stroke();
      }
      g.strokeStyle = railHex; g.shadowColor = railHex; g.lineWidth = 2;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * 66, cy + Math.sin(ang) * 66);
        g.lineTo(cx + Math.cos(ang) * 76, cy + Math.sin(ang) * 76);
        g.stroke();
      }
      g.shadowColor = accentHex; g.fillStyle = accentHex;
      g.fillRect(W * 0.14, H - 26, W * 0.72, 12);
      g.shadowBlur = 0;
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  const winTex = [
    makeWindowTexture('cyan', 6, 16, 0.55),
    makeWindowTexture('magenta', 6, 16, 0.5),
    makeWindowTexture('mixed', 7, 18, 0.58),
  ];
  const farTex = makeWindowTexture('mixed', 5, 12, 0.42);
  const groundTex = makeGroundTexture();
  const holoTex = [makeHoloTexture(0), makeHoloTexture(1)];

  // =========================================================================
  // GROUND — lit neon-grid city floor
  // =========================================================================
  const groundSize = R * 5.6;
  const tileWorld = 320;
  groundTex.repeat.set(groundSize / tileWorld, groundSize / tileWorld);
  const groundMat = selfDispose(
    new THREE.MeshStandardMaterial({
      color: 0x05040e,
      metalness: 0.55,
      roughness: 0.42,
      emissive: 0xffffff,
      emissiveMap: groundTex,
      emissiveIntensity: 0.55,
    })
  );
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  group.add(ground);

  // =========================================================================
  // Instance accumulators (one InstancedMesh built per bucket at the end)
  // =========================================================================
  const bodyM = [[], [], []]; // detailed tower tiers, one array per window texture
  const farM = []; // far skyline silhouettes
  const antM = []; // antenna masts
  const beaconM = []; // antenna beacon tips
  const roofM = []; // rooftop light-crowns
  const roofC = []; // rooftop crown colours
  const bridgeM = []; // sky-bridges

  // Build a tower's stacked tiers into bucket `tex`; returns {cx,cz,topY,w,d}.
  const addTower = (cx, cz, footW, footD, height, yaw, tex, opts) => {
    const arr = bodyM[tex];
    let w = footW;
    let d = footD;
    let y = GROUND_Y;
    const st = rnd();
    let tiers;
    let shrink;
    let spire = false;
    if (st < 0.38) {
      tiers = 1; shrink = 1;
    } else if (st < 0.76) {
      tiers = rnd() < 0.5 ? 2 : 3; shrink = 0.7 + rnd() * 0.1; // setback block
    } else {
      tiers = rnd() < 0.6 ? 2 : 3; shrink = 0.56 + rnd() * 0.1; spire = true; // tapered spire
    }
    let hrem = height;
    for (let t = 0; t < tiers; t++) {
      const last = t === tiers - 1;
      let th = last ? hrem : hrem * (0.42 + rnd() * 0.16);
      let tw = w;
      let td = d;
      if (spire && last) {
        tw = Math.max(2.4, w * 0.32);
        td = Math.max(2.4, d * 0.32);
        th = Math.max(th, height * 0.24);
      }
      dummy.position.set(cx, y + th / 2, cz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(tw, th, td);
      dummy.updateMatrix();
      arr.push(dummy.matrix.clone());
      y += th;
      hrem -= th;
      if (last) { w = tw; d = td; } else { w *= shrink; d *= shrink; }
    }
    const topY = y;

    // rooftop light-crown
    if (opts.rooftop && rnd() < 0.82) {
      dummy.position.set(cx, topY + 0.6, cz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(w * 1.06 + 2.5, 1.3, d * 1.06 + 2.5);
      dummy.updateMatrix();
      roofM.push(dummy.matrix.clone());
      roofC.push(rnd() < 0.5 ? def.rail : def.accent);
    }
    // antenna mast + beacon
    if (spire || rnd() < opts.antenna) {
      const antH = 22 + rnd() * 70;
      dummy.position.set(cx, topY + antH / 2, cz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.9, antH, 0.9);
      dummy.updateMatrix();
      antM.push(dummy.matrix.clone());
      dummy.position.set(cx, topY + antH + 2.5, cz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      beaconM.push(dummy.matrix.clone());
    }
    return { cx, cz, topY, w, d };
  };

  // =========================================================================
  // NEAR ring — glass towers hugging the track (placed along the centerline)
  // =========================================================================
  const NEAR = 108;
  const N = samples.length;
  const nearTops = new Array(NEAR).fill(null);
  const nearOut = new Array(NEAR).fill(true);
  for (let i = 0; i < NEAR; i++) {
    const si = (Math.floor((i / NEAR) * N) + Math.floor(rnd() * 3)) % N;
    const s = samples[si];
    // outward = the side direction that points away from the map centre
    const radial = s.side.x * s.pos.x + s.side.z * s.pos.z;
    const outSign = radial >= 0 ? 1 : -1;
    const useOut = rnd() < 0.72;
    nearOut[i] = useOut;
    const sign = useOut ? outSign : -outSign;
    const gap = HALF + 30 + rnd() * (useOut ? 150 : 70);
    const cx = s.pos.x + s.side.x * sign * gap;
    const cz = s.pos.z + s.side.z * sign * gap;
    const footW = 16 + rnd() * 34;
    const footD = 16 + rnd() * 34;
    const height = 140 + rnd() * 300;
    const yaw = Math.atan2(s.tangent.x, s.tangent.z) + (rnd() - 0.5) * 0.5;
    const tex = i % 3;
    nearTops[i] = addTower(cx, cz, footW, footD, height, yaw, tex, { rooftop: true, antenna: 0.35 });
  }

  // Sky-bridges between adjacent, same-side near towers within a sane span.
  for (let i = 0; i < NEAR; i++) {
    const A = nearTops[i];
    const B = nearTops[(i + 1) % NEAR];
    if (!A || !B || nearOut[i] !== nearOut[(i + 1) % NEAR]) continue;
    const dx = B.cx - A.cx;
    const dz = B.cz - A.cz;
    const dist = Math.hypot(dx, dz);
    if (dist < 55 || dist > 250 || rnd() > 0.42) continue;
    const by = Math.min(A.topY, B.topY) * (0.5 + rnd() * 0.28);
    const dir = new THREE.Vector3(dx, 0, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    dummy.position.set((A.cx + B.cx) / 2, by, (A.cz + B.cz) / 2);
    dummy.quaternion.copy(q);
    dummy.scale.set(dist, 2.6, 3.4);
    dummy.updateMatrix();
    bridgeM.push(dummy.matrix.clone());
  }

  // =========================================================================
  // MID ring — fills the middle distance (radial scatter)
  // =========================================================================
  const MID = 150;
  for (let i = 0; i < MID; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = R * (1.22 + rnd() * 0.64);
    const cx = Math.cos(a) * rr;
    const cz = Math.sin(a) * rr;
    const footW = 20 + rnd() * 42;
    const footD = 20 + rnd() * 42;
    const height = 130 + rnd() * 330;
    const yaw = rnd() * Math.PI * 2;
    const tex = Math.floor(rnd() * 3);
    addTower(cx, cz, footW, footD, height, yaw, tex, { rooftop: rnd() < 0.5, antenna: 0.22 });
  }

  // =========================================================================
  // FAR skyline — cheap single-box silhouettes that fade into the fog
  // =========================================================================
  const FAR = 220;
  for (let i = 0; i < FAR; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = R * (1.9 + rnd() * 0.62);
    const cx = Math.cos(a) * rr;
    const cz = Math.sin(a) * rr;
    const w = 26 + rnd() * 64;
    const d = 26 + rnd() * 64;
    const h = 170 + rnd() * 440;
    dummy.position.set(cx, GROUND_Y + h / 2, cz);
    dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    farM.push(dummy.matrix.clone());
  }

  // =========================================================================
  // Materialize the instanced buckets
  // =========================================================================
  const pushInstanced = (matrices, geo, mat, colors) => {
    if (!matrices.length) { geo.dispose(); mat.dispose(); return; }
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    for (let i = 0; i < matrices.length; i++) inst.setMatrixAt(i, matrices[i]);
    inst.instanceMatrix.needsUpdate = true;
    if (colors) {
      for (let i = 0; i < colors.length; i++) inst.setColorAt(i, tmpCol.setHex(colors[i]));
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
    inst.frustumCulled = false; // towers ring the whole map; keep them all live
    group.add(inst);
    return inst;
  };

  // detailed tower bodies — 3 buckets (one per window texture)
  for (let k = 0; k < 3; k++) {
    const mat = selfDispose(
      new THREE.MeshStandardMaterial({
        color: 0x0a0818,
        metalness: 0.5,
        roughness: 0.5,
        emissive: 0xffffff,
        emissiveMap: winTex[k],
        emissiveIntensity: 1.1,
      })
    );
    pushInstanced(bodyM[k], new THREE.BoxGeometry(1, 1, 1), mat);
  }

  // far skyline
  const farMat = selfDispose(
    new THREE.MeshStandardMaterial({
      color: 0x080614,
      metalness: 0.4,
      roughness: 0.6,
      emissive: 0xffffff,
      emissiveMap: farTex,
      emissiveIntensity: 0.5,
    })
  );
  pushInstanced(farM, new THREE.BoxGeometry(1, 1, 1), farMat);

  // antenna masts (dark structural, faint rail glow)
  pushInstanced(
    antM,
    new THREE.CylinderGeometry(0.9, 0.5, 1, 6),
    new THREE.MeshStandardMaterial({
      color: 0x05040c,
      metalness: 0.6,
      roughness: 0.4,
      emissive: def.rail,
      emissiveIntensity: 0.35,
    })
  );
  // beacon tips (punchy)
  pushInstanced(
    beaconM,
    new THREE.OctahedronGeometry(2.1, 0),
    new THREE.MeshBasicMaterial({ color: def.rail, toneMapped: false })
  );
  // rooftop light-crowns (rail/accent per instance)
  pushInstanced(
    roofM,
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    roofC
  );
  // sky-bridges
  pushInstanced(
    bridgeM,
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x0c0a1e,
      metalness: 0.5,
      roughness: 0.5,
      emissive: def.accent,
      emissiveIntensity: 0.32,
    })
  );

  // =========================================================================
  // Holographic billboards — additive neon panels floating among the towers
  // =========================================================================
  const HOLO = 28;
  const holoM = [[], []];
  for (let i = 0; i < HOLO; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = R * (1.12 + rnd() * 0.62);
    const h = 45 + rnd() * 150;
    const w = 30 + rnd() * 46;
    const bucket = i % 2;
    dummy.position.set(Math.cos(a) * rr, h, Math.sin(a) * rr);
    dummy.scale.set(w, w * (0.62 + rnd() * 0.12), 1);
    dummy.lookAt(0, h, 0);
    dummy.updateMatrix();
    holoM[bucket].push(dummy.matrix.clone());
  }
  for (let b = 0; b < 2; b++) {
    const mat = selfDispose(
      new THREE.MeshBasicMaterial({
        map: holoTex[b],
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    pushInstanced(holoM[b], new THREE.PlaneGeometry(1, 1), mat);
  }

  // =========================================================================
  // Starfield backdrop (fog-exempt, additive)
  // =========================================================================
  const STARS = 300;
  const starM = [];
  const starC = [];
  for (let i = 0; i < STARS; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = R * (1.6 + rnd() * 1.0);
    const y = 180 + rnd() * 700;
    const sz = 1.6 + rnd() * 3.4;
    dummy.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
    dummy.scale.set(sz, sz, sz);
    dummy.lookAt(0, y * 0.4, 0);
    dummy.updateMatrix();
    starM.push(dummy.matrix.clone());
    const t = rnd();
    starC.push(t < 0.72 ? 0xdff6ff : t < 0.86 ? def.rail : def.accent);
  }
  pushInstanced(
    starM,
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
    starC
  );

  // =========================================================================
  // Faint pace-rings over the racing line (subtle readability guide)
  // =========================================================================
  const RINGS = 10;
  const ringM = [];
  for (let i = 0; i < RINGS; i++) {
    const idx = Math.floor((i / RINGS) * N) % N;
    const s = samples[idx];
    dummy.position.set(s.pos.x, s.pos.y + 7, s.pos.z);
    dummy.scale.set(1, 1, 1);
    dummy.lookAt(s.pos.x + s.tangent.x, s.pos.y + 7 + s.tangent.y, s.pos.z + s.tangent.z);
    dummy.updateMatrix();
    ringM.push(dummy.matrix.clone());
  }
  pushInstanced(
    ringM,
    new THREE.TorusGeometry(HALF * 1.2, 0.45, 6, 30),
    new THREE.MeshBasicMaterial({
      color: def.accent,
      transparent: true,
      opacity: 0.3,
      toneMapped: false,
    })
  );
}

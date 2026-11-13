// core/fx/lootfx.js — the WORLD half of weapon loot: every item in sim.state.loot is
// drawn as the gun itself, slowly turning and bobbing above a glowing ring with a
// tall light beam, so a weapon dropped in a dark, rain-soaked street can be found
// from across the block. Reads sim.state.loot each frame (events are optional).
//
// The weapon model comes from weapon_meshes.js `buildWorldWeapon(id)` through
// ctx.weaponMeshes (boot wires it); until that exists — or if it fails — a clean
// primitive silhouette stands in, so the item is never invisible.

import * as THREE from "three";

const COLORS = {
  warden: 0xffc15a, vesper: 0x62e2ff, breaker: 0xff7a3a, corvus: 0xb890ff, pike: 0xf2f2f2, ammo: 0x6dff8a,
};

function gradTex(kind) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  if (kind === "ring") {
    const r = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    r.addColorStop(0.0, "rgba(255,255,255,0.10)");
    r.addColorStop(0.55, "rgba(255,255,255,0.12)");
    r.addColorStop(0.78, "rgba(255,255,255,0.85)");
    r.addColorStop(0.90, "rgba(255,255,255,0.30)");
    r.addColorStop(1.0, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  } else {
    const l = g.createLinearGradient(0, 128, 0, 0);
    l.addColorStop(0.0, "rgba(255,255,255,0.65)");
    l.addColorStop(0.35, "rgba(255,255,255,0.22)");
    l.addColorStop(1.0, "rgba(255,255,255,0)");
    g.fillStyle = l; g.fillRect(0, 0, 128, 128);
    // soften the vertical edges
    const e = g.createLinearGradient(0, 0, 128, 0);
    e.addColorStop(0.0, "rgba(0,0,0,1)"); e.addColorStop(0.3, "rgba(0,0,0,0)");
    e.addColorStop(0.7, "rgba(0,0,0,0)"); e.addColorStop(1.0, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out"; g.fillStyle = e; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createLootFx(ctx) {
  const root = new THREE.Group();
  root.name = "loot_fx";
  ctx.scene.add(root);

  const ringTex = gradTex("ring");
  const beamTex = gradTex("beam");
  const ringGeo = new THREE.CircleGeometry(1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const beamGeoA = new THREE.PlaneGeometry(0.55, 3.6);
  beamGeoA.translate(0, 1.8, 0);
  const beamGeoB = beamGeoA.clone();
  beamGeoB.rotateY(Math.PI / 2);

  const matCache = new Map();
  function addMat(tex, color) {
    const key = tex.uuid + color;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        map: tex, color, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false,
      });
      matCache.set(key, m);
    }
    return m;
  }
  const tintMats = new Map();
  // stand-in silhouettes carry a faint emissive in the item's colour so the gun reads
  // inside its own light beam instead of as a black cut-out
  const mats = (weapon) => {
    let m = tintMats.get(weapon);
    if (!m) {
      const c = COLORS[weapon] || 0xffffff;
      m = {
        dark: new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.7, emissive: c, emissiveIntensity: 0.28 }),
        trim: new THREE.MeshStandardMaterial({ color: 0x9aa2aa, roughness: 0.35, metalness: 0.8, emissive: c, emissiveIntensity: 0.22 }),
      };
      tintMats.set(weapon, m);
    }
    return m;
  };
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x2f4a33, roughness: 0.7, metalness: 0.1, emissive: 0x0d2a14, emissiveIntensity: 0.9 });

  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };

  // primitive stand-in silhouettes — barrel along +X (they lie flat and spin)
  function fallbackModel(weapon) {
    const g = new THREE.Group();
    const { dark: darkMat, trim: trimMat } = mats(weapon);
    switch (weapon) {
      case "breaker":
        g.add(box(0.95, 0.07, 0.07, darkMat, 0.05, 0, 0), box(0.5, 0.05, 0.05, trimMat, 0.3, -0.06, 0),
          box(0.26, 0.11, 0.08, darkMat, -0.5, -0.02, 0), box(0.1, 0.18, 0.06, darkMat, -0.2, -0.11, 0));
        break;
      case "corvus":
        g.add(box(1.1, 0.06, 0.06, darkMat, 0.1, 0, 0), box(0.34, 0.07, 0.07, trimMat, 0.05, 0.075, 0),
          box(0.3, 0.1, 0.07, darkMat, -0.6, -0.01, 0), box(0.08, 0.16, 0.05, darkMat, -0.1, -0.1, 0));
        break;
      case "vesper":
        g.add(box(0.6, 0.08, 0.07, darkMat, 0.05, 0, 0), box(0.12, 0.2, 0.06, darkMat, -0.05, -0.13, 0),
          box(0.1, 0.17, 0.05, trimMat, 0.12, -0.12, 0), box(0.26, 0.05, 0.05, trimMat, 0.5, 0, 0));
        break;
      case "pike":
        g.add(box(0.28, 0.07, 0.05, darkMat, 0.05, 0.02, 0), box(0.09, 0.15, 0.045, darkMat, -0.04, -0.07, 0));
        break;
      default: // warden + anything else
        g.add(box(0.95, 0.075, 0.07, darkMat, 0.05, 0, 0), box(0.28, 0.1, 0.07, darkMat, -0.55, -0.01, 0),
          box(0.1, 0.2, 0.06, darkMat, -0.08, -0.13, 0), box(0.1, 0.17, 0.05, trimMat, 0.2, -0.12, 0),
          box(0.3, 0.04, 0.04, trimMat, 0.2, 0.06, 0));
    }
    return g;
  }

  const items = new Map(); // id -> entry
  const pads = new Map();  // pad key -> {g, ring, ...}  (PVP racks: pedestal + recharge ring)
  let lastSim = null;
  let clock = 0;

  function build(it) {
    const color = COLORS[it.kind === "ammo" ? "ammo" : it.weapon] || 0xffffff;
    const g = new THREE.Group();
    g.position.set(it.pos[0], it.pos[1], it.pos[2]);

    const ring = new THREE.Mesh(ringGeo, addMat(ringTex, color));
    ring.scale.setScalar(0.95);
    ring.position.y = 0.04;
    ring.renderOrder = 6;
    if (it.src !== "rack") g.add(ring); // racks: the pad draws the ring
    const beamA = new THREE.Mesh(beamGeoA, addMat(beamTex, color));
    const beamB = new THREE.Mesh(beamGeoB, addMat(beamTex, color));
    beamA.renderOrder = beamB.renderOrder = 6;
    g.add(beamA, beamB);

    const hold = new THREE.Group();
    hold.position.y = 0.72;
    hold.scale.setScalar(1.75); // oversize on purpose: it has to read from across a street
    g.add(hold);
    let model;
    if (it.kind === "ammo") {
      model = new THREE.Group();
      model.add(box(0.46, 0.26, 0.3, crateMat, 0, 0, 0), box(0.5, 0.04, 0.34, mats("ammo").trim, 0, 0.14, 0),
        box(0.14, 0.05, 0.31, addMat(beamTex, color), 0, 0.0, 0));
    } else {
      const wm = ctx.weaponMeshes && ctx.weaponMeshes.buildWorldWeapon;
      if (wm) {
        // buildWorldWeapon (world_weapon.js) is synchronous: a group at the grip, barrel
        // along -Z, shared geometry/materials. If its GLB is still loading the group is
        // filled in place the moment it lands — nothing to await.
        try { model = wm(it.weapon); } catch (e) { model = null; }
      }
      if (!model) model = fallbackModel(it.weapon);
    }
    hold.add(model);
    root.add(g);
    return { g, hold, ring, beamA, beamB, born: clock, id: it.id, phase: (it.id * 1.7) % 6.28 };
  }

  function dispose(e) {
    root.remove(e.g);
  }

  // ---- RACK PADS (PVP). A weapon rack is a permanent fixture: a low pedestal and a
  // ring on the floor that stay put when the gun has been taken (dim, "recharging")
  // and light up the moment it is back. The gun + beam are the loot item's own visuals.
  const padBaseMat = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.6, metalness: 0.6 });
  function buildPad(pad) {
    const color = COLORS[pad.weapon] || 0xffffff;
    const g = new THREE.Group();
    g.position.set(pad.pos[0], pad.pos[1], pad.pos[2]);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.85), padBaseMat);
    base.position.y = 0.045;
    // thin lit edge around the pedestal top (an outline, not a slab)
    const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5, 0.09, 0.85)),
      new THREE.LineBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.6 }));
    rim.position.y = 0.045;
    const ring = new THREE.Mesh(ringGeo, addMat(ringTex, color).clone()); // own material: opacity animates per pad
    ring.scale.setScalar(1.15);
    ring.position.y = 0.06;
    ring.renderOrder = 6;
    g.add(base, rim, ring);
    root.add(g);
    return { g, ring, rim, color, mat: ring.material };
  }

  return {
    update(dt) {
      const s = ctx.sim ? ctx.sim() : null;
      if (!s) return;
      clock += Math.min(dt, 0.1);
      if (s !== lastSim) { for (const e of items.values()) dispose(e); items.clear(); for (const e of pads.values()) root.remove(e.g); pads.clear(); lastSim = s; }
      const loot = s.state.loot || [];
      const alive = new Set();
      const t = s.state.time;
      for (let i = 0; i < loot.length; i++) {
        const it = loot[i];
        alive.add(it.id);
        let e = items.get(it.id);
        if (!e) { e = build(it); items.set(it.id, e); }
        const age = clock - e.born;
        const grow = Math.min(1, age / 0.3);
        // dropped guns shrink away over their last second
        const fade = it.ttl > 0 ? Math.max(0, Math.min(1, (it.born + it.ttl - t) / 1.0)) : 1;
        e.g.scale.setScalar(Math.max(0.001, grow * fade));
        // a beam is a 0.55 m x 3.6 m card: with the camera a metre from it (a bot dropped its
        // gun at your feet, the kill cam sits on a corpse) it would fill the whole frame.
        // Thin it out and hide it inside ~1.8 m; the gun model + prompt carry the read up close.
        {
          const cp = ctx.camera.position;
          const cd = Math.hypot(cp.x - e.g.position.x, cp.z - e.g.position.z);
          const bs = Math.max(0, Math.min(1, (cd - 1.8) / 3.0));
          e.beamA.visible = e.beamB.visible = bs > 0.02;
          e.beamA.scale.x = e.beamB.scale.x = bs;
          e.hold.visible = cd > 0.9;
        }
        e.hold.rotation.y = clock * 0.9 + e.phase;
        e.hold.position.y = 0.72 + Math.sin(clock * 2.2 + e.phase) * 0.05;
        e.ring.scale.setScalar(0.88 + Math.sin(clock * 2.6 + e.phase) * 0.07);
      }
      for (const [id, e] of items) if (!alive.has(id)) { dispose(e); items.delete(id); }

      // rack pads
      const list = s.state.lootPads || [];
      const seen = new Set();
      for (let i = 0; i < list.length; i++) {
        const pd = list[i];
        if (pd.src !== "rack") continue;
        seen.add(pd.key);
        let e = pads.get(pd.key);
        if (!e) { e = buildPad(pd); pads.set(pd.key, e); }
        // recharge progress 0..1 (1 = ready)
        let prog = 1;
        if (!pd.ready && pd.readyAt != null && pd.respawnS > 0) prog = Math.max(0, Math.min(1, 1 - (pd.readyAt - t) / pd.respawnS));
        else if (!pd.ready) prog = 0;
        const pulse = 0.88 + Math.sin(clock * 2.6 + i) * 0.06;
        e.ring.scale.setScalar(pd.ready ? 1.15 * pulse : 1.05 + 0.1 * prog);
        // an empty pad stays visible but dim; it brightens as the gun comes back
        e.mat.opacity = pd.ready ? 1 : 0.18 + 0.4 * prog;
        e.rim.material.opacity = pd.ready ? 0.7 : 0.18;
      }
      for (const [k, e] of pads) if (!seen.has(k)) { root.remove(e.g); pads.delete(k); }
    },
    clear() { for (const e of items.values()) dispose(e); items.clear(); for (const e of pads.values()) root.remove(e.g); pads.clear(); },
    count: () => items.size,
    root,
  };
}

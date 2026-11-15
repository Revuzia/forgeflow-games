# -*- coding: utf-8 -*-
"""Harness capabilities the replay pass did not have.

The 2026-09-08 replay pass could not test 162 of the 315 logged playtest defects.
Grouped by WHY, the blockers were:

  A. the report carries no machine-readable coordinate   -> STATION RESOLVER
  B. the driver cannot reach / stand at the station      -> GOTO + VERIFY
  C. the defect needs a save state the driver cannot set -> SAVE-STATE SETTER
  D. the defect needs a hazard phase to come round       -> CLOCK ADVANCE
  E. the defect needs two inputs at once                 -> TWO-INPUT
  F. the claim is about what the FRAME shows             -> SCREEN / MATERIAL / PIXEL READ

This module supplies all six as reusable helpers on top of `_playlib.Play`, so a
future lane never has to re-invent them.

Everything here is measurement only. Nothing in this file edits the game.
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play

# ===========================================================================
# The in-page toolbox. Installed ONCE per page as window.__CBX.
# Everything is allocation-free-agnostic (a harness may allocate) but must not
# mutate persistent game state except where a helper says so and restores it.
# ===========================================================================
TOOLBOX = r"""
() => {
  const G = () => globalThis.CRESTBOUND.game;
  const T = () => globalThis.CRESTBOUND.THREE;
  const E = () => globalThis.CRESTBOUND.engine;
  const n2 = (v) => (typeof v === 'number' && isFinite(v)) ? +v.toFixed(2) : null;
  const n3 = (v) => (typeof v === 'number' && isFinite(v)) ? +v.toFixed(3) : null;

  function capsuleAt(x, y, z, r, h) {
    const TH = T();
    r = r === undefined ? 0.38 : r; h = h === undefined ? 1.5 : h;
    return { a: new TH.Vector3(x, y + r, z), b: new TH.Vector3(x, y + h - r, z), r: r };
  }

  /* ---------------------------------------------------------------- ground */
  // Cast DOWN from `fromY` at (x,z) through boxes + heightfields.
  function groundAt(x, z, fromY) {
    const g = G(), TH = T(); const c = g.course; if (!c || !c.broadphase) return null;
    fromY = (fromY === undefined) ? 400 : fromY;
    const o = new TH.Vector3(x, fromY, z), d = new TH.Vector3(0, -1, 0);
    const out = { t: 0, normal: new TH.Vector3(), collider: null };
    let best = null;
    if (c.broadphase.raycast(o, d, 900, out)) {
      best = { y: +(fromY - out.t).toFixed(3), ny: n3(out.normal.y),
               surface: out.collider ? (out.collider.surface || 'normal') : 'heightfield',
               solid: out.collider ? out.collider.solid !== false : true };
    }
    // heightfields answer directly too (the raycast marches them, but a NaN
    // outside the field is worth reporting separately)
    let hf = null;
    const hfs = (c.broadphase.heightfields) || [];
    for (let i = 0; i < hfs.length; i++) {
      const v = hfs[i].heightAt(x, z);
      if (isFinite(v) && (hf === null || v > hf)) hf = +v.toFixed(3);
    }
    return { ray: best, hf: hf };
  }

  /* ------------------------------------------------------- what is at a point */
  function probePoint(x, y, z) {
    const g = G(), TH = T(); const c = g.course; if (!c) return null;
    const cap = capsuleAt(x, y, z, 0.38, 1.5);
    const out = { p: [n2(x), n2(y), n2(z)] };
    // kill volumes that would kill a hero standing here, right now
    const kills = [];
    const kv = c.killVolumes || [];
    for (let i = 0; i < kv.length; i++) {
      const k = kv[i];
      try { if (k.active !== false && k.hits(cap)) kills.push({ kind: k.kind, ref: k.ref && (k.ref.kind || (k.ref.def && k.ref.def.kind)) || null }); } catch (e) {}
    }
    out.kills = kills;
    // solid colliders overlapping the body column
    const box = new TH.Box3(new TH.Vector3(x - 0.38, y, z - 0.38), new TH.Vector3(x + 0.38, y + 1.5, z + 0.38));
    const list = [];
    try { c.broadphase.query(box, list); } catch (e) {}
    const overl = [];
    for (let i = 0; i < list.length && i < 60; i++) {
      const k = list[i];
      if (!k || k.active === false || k.solid === false) continue;
      if (!k.aabb || !k.aabb.intersectsBox(box)) continue;
      // The FLOOR intersects the body box at every station, which made the first
      // cut report `insideFrac 1` everywhere and say nothing. Count only a box
      // that intrudes into the body column above the feet.
      if (!(k.aabb.max.y > y + 0.25 && k.aabb.min.y < y + 1.45)) continue;
      overl.push({ surface: k.surface || 'normal', group: k.group,
                   c: [n2(k.center.x), n2(k.center.y), n2(k.center.z)],
                   h: [n2(k.half.x), n2(k.half.y), n2(k.half.z)],
                   ref: k.ref ? (k.ref.kind || (k.ref.def && k.ref.def.kind) || 'hazard') : null });
    }
    out.inside = overl;
    // volumes (water/current/ladder/...)
    const vols = [];
    const vv = c.volumes || [];
    for (let i = 0; i < vv.length; i++) {
      const v = vv[i];
      try {
        if (!(v.overlapsCapsule ? v.overlapsCapsule(cap) : v.contains(cap.a))) continue;
        // Shallow-copy PRIMITIVES only. JSON.stringify on a Volume's props walks
        // into three.js objects and makes r172 log "Unable to serialize Texture"
        // once per property — 60 console warnings per course, all from the probe.
        const pr = {};
        if (v.props) for (const k of Object.keys(v.props)) {
          const val = v.props[k];
          const t = typeof val;
          if (t === 'number' || t === 'string' || t === 'boolean') pr[k] = val;
          else if (Array.isArray(val) && val.every(q => typeof q === 'number')) pr[k] = val.slice();
          else if (val && typeof val.x === 'number' && typeof val.z === 'number') pr[k] = [n2(val.x), n2(val.y), n2(val.z)];
        }
        vols.push({ kind: v.kind, props: pr });
      } catch (e) {}
    }
    out.volumes = vols;
    // ground UNDER THE FEET: a ray started well above the station finds the deck
    // ABOVE it, which is what made the first cut report 34.9 m under a 22.1 m deck.
    out.ground = groundAt(x, z, y + 0.4);
    out.groundFromAbove = groundAt(x, z, y + 80);
    // headroom: the first solid surface above the head
    try {
      const TH2 = T(), c2 = g.course;
      // Cast from just above the FEET, not from head height: a ceiling that is
      // 1.0 m over the floor (azure-2#08's bracket under gallery 2) sits BELOW
      // a 1.5 m head, and a ray started at 1.55 m begins above it and reports
      // 9 m of headroom.
      const o2 = new TH2.Vector3(x, y + 0.12, z), d2 = new TH2.Vector3(0, 1, 0);
      const r2 = { t: 0, normal: new TH2.Vector3(), collider: null };
      out.ceiling = c2.broadphase.raycast(o2, d2, 40, r2) ? +(0.12 + r2.t).toFixed(2) : null;
    } catch (e) { out.ceiling = null; }
    return out;
  }

  /* ------------------------------------------------ D. CLOCK-ADVANCE HELPER */
  // Deterministically walk the course clock and report, at every sampled phase,
  // whether a hero standing at (x,y,z) would be killed / blocked / carried.
  // DETERMINISM LAW: reset(t) places a hazard exactly where update(t) would, so
  // this needs no wall-clock waiting at all. The live clock is restored after.
  function phaseScan(x, y, z, tmax, n) {
    const g = G(); const c = g.course; if (!c) return null;
    tmax = tmax || 24; n = n || 48;
    const live = c.clock;
    const rows = [];
    const hz = c.hazards || [];
    for (let s = 0; s <= n; s++) {
      const t = tmax * s / n;
      for (let i = 0; i < hz.length; i++) {
        try { if (hz[i].h && hz[i].h.reset) hz[i].h.reset(t); } catch (e) {}
      }
      try { if (c._refreshHazardColliders) c._refreshHazardColliders(); } catch (e) {}
      const pp = probePoint(x, y, z);
      rows.push({ t: +t.toFixed(2), kills: pp.kills.map(k => k.kind + (k.ref ? ':' + k.ref : '')),
                  inside: pp.inside.length, ground: pp.ground && pp.ground.ray ? pp.ground.ray.y : null });
    }
    for (let i = 0; i < hz.length; i++) { try { if (hz[i].h && hz[i].h.reset) hz[i].h.reset(live); } catch (e) {} }
    try { if (c._refreshHazardColliders) c._refreshHazardColliders(); } catch (e) {}
    c.clock = live;
    const killT = rows.filter(r => r.kills.length).map(r => r.t);
    const insideT = rows.filter(r => r.inside > 0).map(r => r.t);
    const grounds = rows.map(r => r.ground).filter(v => v !== null);
    return { tmax: tmax, n: n, rows: rows,
             killFrac: +(killT.length / rows.length).toFixed(3), killT: killT.slice(0, 12),
             insideFrac: +(insideT.length / rows.length).toFixed(3),
             groundMin: grounds.length ? +Math.min.apply(null, grounds).toFixed(2) : null,
             groundMax: grounds.length ? +Math.max.apply(null, grounds).toFixed(2) : null,
             everGround: grounds.length > 0 };
  }

  /* ------------------------------------------------ C. SAVE-STATE SETTER */
  // Set the preconditions a defect needs: crest totals, per-course crests,
  // gate flags, an active power hat, secret triggers, a checkpoint index.
  function saveSet(o) {
    const g = G(); o = o || {};
    const res = {};
    try {
      if (o.unlockAll) { g.__dev.unlockAll(); res.unlockAll = true; }
      if (Array.isArray(o.crests)) {
        for (const c of o.crests) g.save.collectCrest(c[0], c[1]);
        res.crestTotal = g.save.crestTotal();
      }
      if (typeof o.crestTotal === 'number') {
        // synthesise crests on OTHER courses so a gate sees the total
        const ids = ['open', 'sigils', 'coins', 'secret', 'boss', 'race', 'power'];
        const cs = [];
        for (const r of (g.__dev.realms() || [])) for (const cid of (r.courses || [])) cs.push(cid);
        let need = o.crestTotal - g.save.crestTotal();
        outer: for (const cid of (cs.length ? cs : ['verdant-1', 'verdant-2', 'verdant-3', 'ember-1'])) {
          if (cid === g.courseId) continue;   // never touch the course under test
          for (const k of ids) { if (need <= 0) break outer; g.save.collectCrest(cid, k); need--; }
        }
        res.crestTotal = g.save.crestTotal();
      }
      if (o.power) { g.__dev.power(o.power, o.powerS || 600); res.power = g.power ? g.power.id : null; }
      if (Array.isArray(o.triggers) && g.course && typeof g.course.trigger === 'function') {
        res.triggered = [];
        for (const t of o.triggers) res.triggered.push([t, g.course.trigger(t)]);
      }
      if (o.flags) { for (const k of Object.keys(o.flags)) g.save.flags.set(k, o.flags[k]); res.flags = Object.keys(o.flags); }
      if (typeof o.cp === 'number') { g.__dev.skipCP(o.cp); res.cp = g.cpIndex; }
      if (o.refreshGates && g._refreshGateState) { g._refreshGateState(); res.gates = true; }
    } catch (e) { res.error = String(e).slice(0, 200); }
    res.crestTotalNow = g.save ? g.save.crestTotal() : null;
    res.powerNow = g.power ? g.power.id : null;
    return res;
  }

  /* ------------------------------------------------ F. SCREEN / FRAME READS */
  // What stands between the lens and the hero, and how much of the frame does it
  // take? Projects every visible mesh's world AABB into NDC and clips to screen.
  function screenBlockers(minArea) {
    const g = G(), TH = T(), en = E();
    const P = g.player, C = g.cam; if (!P || !C) return null;
    // FollowCamera exposes the three.js camera as `.camera`. The replay pass's
    // probe read `.cam`, so EVERY camera measurement it took came back null.
    const cam = C.camera || C.cam || en.camera; if (!cam) return null;
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    const head = new TH.Vector3(P.pos.x, P.pos.y + 1.15, P.pos.z);
    const headNdc = head.clone().project(cam);
    const headDist = cam.position.distanceTo(head);
    const heroRoot = g.hero && g.hero.root;
    const isHero = (o) => { let q = o; while (q) { if (q === heroRoot) return true; q = q.parent; } return false; };
    const isSky = (o) => /sky|dome|cloud|star|sun\b|fog|glow\.field|godray/i.test(o.name || '') ||
                         (o.material && !Array.isArray(o.material) && o.material.depthWrite === false &&
                          !(o.material.map));
    // ---- what is BETWEEN the lens and Nim: a real ray, not a bounding box
    const dir = head.clone().sub(cam.position); const L = dir.length(); dir.normalize();
    const rc = new TH.Raycaster(cam.position.clone(), dir, 0.05, Math.max(0.1, L - 0.45));
    rc.camera = cam;   // sprites raycast against the camera
    rc.firstHitOnly = false;
    let hits = [];
    try { hits = rc.intersectObjects(en.scene.children, true) || []; } catch (e) { hits = []; }
    const occluders = [];
    for (const h of hits) {
      const o = h.object;
      if (!o || isHero(o) || isSky(o)) continue;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.transparent && m.opacity !== undefined && m.opacity < 0.25) continue;
      occluders.push({ name: o.name || o.type, d: n2(h.distance),
                       mat: m ? (m.name || m.type) : null,
                       color: m && m.color ? '#' + m.color.getHexString() : null });
      if (occluders.length >= 5) break;
    }
    // ---- how much of the FRAME each near object takes
    const box = new TH.Box3(), v = new TH.Vector3();
    const out = [];
    en.scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh) || !o.geometry) return;
      if (isHero(o) || isSky(o)) return;
      try { box.setFromObject(o); } catch (e) { return; }
      if (box.isEmpty()) return;
      if (box.containsPoint(cam.position)) return;   // a shell the lens is inside is not a blocker
      const bs = box.getSize(new TH.Vector3());
      if (Math.max(bs.x, bs.y, bs.z) > 40) return;   // terrain / merged chunk / sky, not an obstruction
      box.getCenter(v);
      const d = cam.position.distanceTo(v);
      if (d > headDist + 1.0) return;
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9, anyFront = false;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        v.project(cam);
        if (v.z > -1 && v.z < 1) anyFront = true;
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      if (!anyFront) return;
      const cx0 = Math.max(-1, x0), cx1 = Math.min(1, x1), cy0 = Math.max(-1, y0), cy1 = Math.min(1, y1);
      if (cx1 <= cx0 || cy1 <= cy0) return;
      const area = ((cx1 - cx0) * (cy1 - cy0)) / 4;
      if (area < (minArea === undefined ? 0.04 : minArea)) return;
      const coversHead = headNdc.x >= x0 && headNdc.x <= x1 && headNdc.y >= y0 && headNdc.y <= y1 && d < headDist;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      out.push({ name: o.name || (o.parent && o.parent.name) || o.type,
                 area: +Math.min(1, area).toFixed(3), dist: n2(d), coversHead: coversHead,
                 // World height band. A race pad on the floor projects across the
                 // whole screen when the lens is low, and "it fills the frame" then
                 // means nothing: a thing that HIDES something stands up in front
                 // of you, so the rule needs to know how tall it is and where.
                 y0: n2(box.min.y), y1: n2(box.max.y),
                 mat: m ? (m.name || m.type) : null,
                 color: m && m.color ? '#' + m.color.getHexString() : null });
    });
    out.sort((a, b) => b.area - a.area);
    return { headOnScreen: Math.abs(headNdc.x) < 1 && Math.abs(headNdc.y) < 1 && headNdc.z > -1 && headNdc.z < 1,
             headNdc: [n2(headNdc.x), n2(headNdc.y)], headDist: n2(headDist),
             camDist: n2(C.dist), mode: C.mode, occluders: occluders,
             occluded: occluders.length > 0,
             blockers: out.slice(0, 8),
             frontArea: +Math.min(1, out.reduce((a, b) => a + b.area, 0)).toFixed(3) };
  }

  // Nearest meshes to a point with their RESOLVED material colour — answers
  // "the gold deck renders olive", "the hay bales are steel blue", "the pedestal
  // is grass" without a human eye.
  function matsNear(x, y, z, r) {
    const en = E(), TH = T();
    r = r || 6;
    const p = new TH.Vector3(x, y, z), box = new TH.Box3(), v = new TH.Vector3();
    const out = [];
    en.scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh) || !o.geometry) return;
      try { box.setFromObject(o); } catch (e) { return; }
      if (box.isEmpty()) return;
      const d = box.distanceToPoint(p);
      if (d > r) return;
      box.getCenter(v);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        out.push({ name: o.name || o.type, d: n2(d),
                   c: [n2(v.x), n2(v.y), n2(v.z)],
                   size: [n2(box.max.x - box.min.x), n2(box.max.y - box.min.y), n2(box.max.z - box.min.z)],
                   mat: m.name || m.type,
                   color: m.color ? '#' + m.color.getHexString() : null,
                   emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
                   rough: n2(m.roughness), metal: n2(m.metalness),
                   map: !!m.map, transparent: !!m.transparent, opacity: n2(m.opacity) });
      }
    });
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, 14);
  }

  // Read the actual rendered pixels. Returns mean linear luminance + mean sRGB
  // of a screen rectangle in 0..1 coordinates (0,0 = top-left).
  function pixels(rx, ry, rw, rh) {
    const en = E();
    const cv = en.renderer.domElement;
    const W = cv.width, H = cv.height;
    const x = Math.max(0, Math.round(rx * W)), y = Math.max(0, Math.round(ry * H));
    const w = Math.max(1, Math.min(W - x, Math.round(rw * W))), h = Math.max(1, Math.min(H - y, Math.round(rh * H)));
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    const ctx = c2.getContext('2d');
    ctx.drawImage(cv, x, y, w, h, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g2 = 0, b = 0, lmin = 2, lmax = -1, sat = 0, n = 0;
    const lin = (u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], Gc = d[i + 1], B = d[i + 2];
      r += R; g2 += Gc; b += B; n++;
      const L = 0.2126 * lin(R) + 0.7152 * lin(Gc) + 0.0722 * lin(B);
      if (L < lmin) lmin = L; if (L > lmax) lmax = L;
      const mx = Math.max(R, Gc, B), mn = Math.min(R, Gc, B);
      sat += mx ? (mx - mn) / mx : 0;
    }
    return { rgb: [Math.round(r / n), Math.round(g2 / n), Math.round(b / n)],
             lum: +(0.2126 * lin(r / n) + 0.7152 * lin(g2 / n) + 0.0722 * lin(b / n)).toFixed(4),
             lmin: +lmin.toFixed(4), lmax: +lmax.toFixed(4), sat: +(sat / n).toFixed(3), n: n };
  }

  /* --------------------------------------------------- scarf / rig motion */
  // Rigid-vs-cloth: sample every descendant of the hero root and report how much
  // each moved in LOCAL space over the samples the caller takes.
  function heroSample() {
    const g = G(), TH = T();
    const h = g.hero; if (!h || !h.root) return null;
    const out = [];
    h.root.updateMatrixWorld(true);
    const inv = h.root.matrixWorld.clone().invert();
    const v = new TH.Vector3();
    h.root.traverse((o) => {
      const nm = (o.name || '').toLowerCase();
      if (!nm) return;
      v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
      out.push([o.name, n3(v.x), n3(v.y), n3(v.z)]);
    });
    // THE SCARF IS NOT A NODE. hero.js merges its geometry into `nim.body` and
    // rewrites the vertices each frame from a Float32Array of verlet particles
    // (`_scarfP`, 7 links = 8 particles) hung off `nim.staticBone`. Sampling
    // Object3D positions therefore reports the scarf as perfectly still, whatever
    // it is doing — so read the particle array itself.
    const sp = h._scarfP;
    if (sp && sp.length >= 6) {
      for (let i = 0; i * 3 + 2 < sp.length; i++) {
        v.set(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2]).applyMatrix4(inv);
        out.push(['scarf.p' + i, n3(v.x), n3(v.y), n3(v.z)]);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------- text objects */
  // Every authored `text`/sign object with its world box and screen coverage.
  function textBoards(x, y, z, r) {
    const g = G(), en = E(), TH = T();
    const c = g.course; if (!c) return null;
    const objs = (c.def && c.def.objects) || [];
    const near = [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (!o || (o.kind !== 'text' && o.kind !== 'deco')) continue;
      if (!Array.isArray(o.p)) continue;
      const d = Math.hypot(o.p[0] - x, (o.p[1] || 0) - y, o.p[2] - z);
      if (d > (r || 14)) continue;
      near.push({ kind: o.kind, p: o.p.map(n2), d: n2(d), text: o.text || o.kindOf || null,
                  size: o.size !== undefined ? o.size : null, rot: o.rot || null });
    }
    near.sort((a, b) => a.d - b.d);
    return near.slice(0, 10);
  }

  /* -------------------------------------------------------- course audit */
  // Whole-course facts a per-station probe cannot see: what surface every deck
  // reports, what the collectibles are actually made of, what the HUD says, what
  // the wardens / breakables / quicksand / powers are doing.
  function courseAudit() {
    const g = G(), en = E(), TH = T();
    const c = g.course; if (!c) return null;
    const res = { id: g.courseId, clock: n2(c.clock) };
    // surfaces under every checkpoint + the spawn
    const pts = [];
    if (c.def && c.def.spawn && c.def.spawn.p) pts.push(['spawn', c.def.spawn.p]);
    for (const cp of (c.def && c.def.checkpoints) || []) pts.push([cp.id || 'cp', cp.p]);
    res.surfaces = pts.map(([id, p]) => {
      const gr = groundAt(p[0], p[2], p[1] + 40);
      return { id: id, p: p.map(n2), surface: gr && gr.ray ? gr.ray.surface : null,
               y: gr && gr.ray ? gr.ray.y : null };
    });
    // collectible materials (coins / sigils / crests)
    const coll = [];
    en.scene.traverseVisible((o) => {
      const nm = (o.name || '').toLowerCase();
      if (!/coin|sigil|crest|ring|pedestal/.test(nm)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m) return;
      coll.push({ name: o.name, count: o.count === undefined ? null : o.count,
                  visible: o.visible, color: m.color ? '#' + m.color.getHexString() : null,
                  emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
                  emiInt: n2(m.emissiveIntensity), opacity: n2(m.opacity),
                  transparent: !!m.transparent, metal: n2(m.metalness), rough: n2(m.roughness) });
    });
    res.collectibleMats = coll.slice(0, 16);
    // HUD, verbatim
    const hud = document.querySelector('.cb-hud') || document.getElementById('hud');
    res.hudText = hud ? (hud.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400) : null;
    const pr = document.querySelector('.cb-prompt');
    res.prompt = pr ? { text: (pr.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                        shown: pr.classList.contains('show') } : null;
    res.bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    // critters
    // A critter's mesh hangs off the course group, so `mesh.position` is LOCAL and
    // reads (0, 0, 0) for most of them. World position or nothing.
    const wp = (o) => { if (!o) return null; const v = o.getWorldPosition(new TH.Vector3());
                        return [n2(v.x), n2(v.y), n2(v.z)]; };
    res.critters = (c.critters || []).map(k => ({
      kind: k.kind || (k.def && k.def.kind), state: k.state || null,
      hp: k.hp === undefined ? null : k.hp, alive: k.alive === undefined ? null : !!k.alive,
      p: wp(k.mesh) || (k.def && k.def.p ? k.def.p.map(n2) : null),
      kills: (k.kills || []).length,
      killsActive: (k.kills || []).filter(v => v.active !== false).length }));
    // hazards by kind, with the flags a defect usually names
    const byKind = {};
    for (const rec of (c.hazards || [])) {
      const k = rec.kind || 'other';
      byKind[k] = byKind[k] || { n: 0, broken: 0, colliders: 0, kills: 0, volumes: 0 };
      byKind[k].n++; if (rec.broken) byKind[k].broken++;
      byKind[k].colliders += (rec.colliders || []).length;
      byKind[k].kills += (rec.kills || []).length;
      byKind[k].volumes += (rec.volumes || []).length;
    }
    res.hazardsByKind = byKind;
    res.triggered = c._triggered ? Array.from(c._triggered) : [];
    res.volumeKinds = {};
    for (const v of (c.volumes || [])) res.volumeKinds[v.kind] = (res.volumeKinds[v.kind] || 0) + 1;
    res.counts = g._collectibles && g._collectibles.counts ? JSON.parse(JSON.stringify(g._collectibles.counts)) : null;
    res.crestDefs = (g._crestDefs || []).map(d => ({ id: d.id, type: d.type, trigger: d.trigger || null }));
    res.power = g.power ? g.power.id : null;
    res.stats = en.stats ? { draws: en.stats.drawCalls, tris: en.stats.tris, fps: n2(en.stats.fps) } : null;

    // SURFACE CENSUS — 'every deck in a steel foundry reports the default
    // surface' is a fact about the colliders, not about one station.
    const surf = {};
    try {
      const all = [];
      const bb = c.bounds && c.bounds.isBox3 ? c.bounds
               : new TH.Box3(new TH.Vector3(-300, -200, -300), new TH.Vector3(300, 300, 300));
      c.broadphase.query(bb, all);
      for (const k of all) { if (!k || k.solid === false) continue;
        const sname = k.surface || 'normal'; surf[sname] = (surf[sname] || 0) + 1; }
      res.surfaceCensus = { total: all.length, bySurface: surf };
    } catch (e) { res.surfaceCensus = { error: String(e).slice(0, 120) }; }

    // RING / POWER OVERLAY — "ten wing rings are drawn before you have the hat".
    // Ask the HAZARD RECORDS, not mesh names: the ring meshes are built inside a
    // `rings` hazard and carry no 'ring' in their names, so a name scan read 0.
    let rings = 0, ringsVisible = 0; const ringY = [];
    for (const rec of (c.hazards || [])) {
      if ((rec.kind || '') !== 'rings') continue;
      const root = rec.h && rec.h.mesh;
      if (!root) continue;
      root.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        rings++;
        let vis = o.visible, q = o.parent;
        while (vis && q) { vis = q.visible; q = q.parent; }
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const op = m && m.opacity !== undefined ? m.opacity : 1;
        if (vis && op > 0.02) { ringsVisible++; ringY.push(n2(o.getWorldPosition(new TH.Vector3()).y)); }
      });
    }
    res.rings = { n: rings, visible: ringsVisible, y: ringY.slice(0, 12), power: res.power };

    // AMBIENT PARTICLES — "the snow sits ON the ground instead of falling".
    // Only the particle system's OWN buffers count; a name scan matched merged
    // static meshes (`merged_cb.snow.rime`) and measured the level, not the weather.
    try {
      const ps = [];
      en.scene.traverse((o) => {
        const nm = o.name || '';
        if (!/^fx\.|particle/i.test(nm)) return;
        if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        const a = o.geometry.attributes.position, n = Math.min(a.count, 400);
        let above = 0, below = 0, seen = 0, hi = -1e9, lo = 1e9;
        for (let i = 0; i < n; i++) {
          const px = a.getX(i), py = a.getY(i), pz = a.getZ(i);
          if (!isFinite(py) || (px === 0 && py === 0 && pz === 0)) continue;
          const gr = groundAt(px, pz, py + 60);
          if (!gr || !gr.ray) continue;
          seen++; const dy = py - gr.ray.y;
          if (dy > 0.6) above++; else below++;
          if (dy > hi) hi = dy; if (dy < lo) lo = dy;
        }
        if (seen) ps.push({ name: nm, count: a.count, sampled: seen, aboveGround: above,
                            atGround: below, dyMax: n2(hi), dyMin: n2(lo) });
      });
      res.particles = ps.slice(0, 6);
    } catch (e) { res.particles = [{ error: String(e).slice(0, 120) }]; }

    return res;
  }

  globalThis.__CBX = { capsuleAt, groundAt, probePoint, phaseScan, saveSet, courseAudit,

                       screenBlockers, matsNear, pixels, heroSample, textBoards };
  return Object.keys(globalThis.__CBX);
}
"""


class Probe(Play):
    """`Play` plus the six capabilities the replay pass lacked."""

    # ------------------------------------------------------------ toolbox
    def install(self):
        return self.js(TOOLBOX)

    def cbx(self, fn, *args):
        return self.js("(a) => globalThis.__CBX[a[0]].apply(null, a.slice(1))", [fn] + list(args))

    # ---------------------------------------------- B. GOTO + VERIFY helper
    def goto_verify(self, xyz, settle_ms=850, tol=1.6, search=True):
        """Teleport to `xyz`, let the hero settle, and VERIFY he is standing there.

        Returns {ok, reason, at, ground, ...}. When the authored point is inside
        geometry / over a hole / in a kill box, and `search` is on, a small ring of
        offsets (and a lift) is tried and the first standable one is reported as
        `usedOffset` — so a station the replay pass called unreachable becomes a
        measurement instead of a blank.
        """
        cands = [(0.0, 0.0, 0.0), (0.0, 1.2, 0.0)]
        if search:
            # a bounded ring: 4 compass offsets at two radii, each with a lift.
            for lift in (0.0, 1.2):
                for rad in (1.4, 2.8):
                    for k in range(4):
                        a = k * math.pi / 2
                        cands.append((round(rad * math.cos(a), 2), lift, round(rad * math.sin(a), 2)))
        seen, tries = set(), []
        for (dx, dy, dz) in cands:
            key = (dx, dy, dz)
            if key in seen:
                continue
            seen.add(key)
            p = [xyz[0] + dx, xyz[1] + dy, xyz[2] + dz]
            self.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", p)
            self.wait(160)
            d0 = self.snap()
            self.wait(settle_ms)
            d1 = self.snap()
            drift = math.hypot(d1["x"] - p[0], d1["z"] - p[2])
            rec = {"tried": p, "end": [d1["x"], d1["y"], d1["z"]], "state": d1["st"],
                   "grounded": d1["gr"], "surface": d1["sf"], "died": d1["deaths"] > d0["deaths"],
                   "dy": round(d1["y"] - p[1], 2), "drift": round(drift, 2), "inWater": d1["w"]}
            tries.append(rec)
            ok = (not rec["died"]) and drift <= tol and abs(rec["dy"]) <= 2.5 and \
                 (rec["grounded"] or rec["inWater"] or d1["st"] in ("climb", "swimIdle", "swim"))
            if ok:
                return {"ok": True, "reason": "", "at": rec["end"], "usedOffset": [dx, dy, dz],
                        "rec": rec, "tries": len(tries),
                        "ground": self.cbx("groundAt", p[0], p[2], p[1] + 60),
                        "point": self.cbx("probePoint", rec["end"][0], rec["end"][1], rec["end"][2])}
            if len(tries) >= 18:
                break
        first = tries[0]
        why = ("dies on arrival" if first["died"] else
               "falls out of the world (dy %.1f m)" % first["dy"] if first["dy"] < -2.5 else
               "is pushed out (drift %.1f m)" % first["drift"] if first["drift"] > tol else
               "never becomes grounded")
        return {"ok": False, "reason": why, "at": first["end"], "rec": first, "tries": len(tries),
                "ground": self.cbx("groundAt", xyz[0], xyz[2], xyz[1] + 60),
                "point": self.cbx("probePoint", xyz[0], xyz[1], xyz[2])}

    def snap(self):
        return self.js("""() => { const G=CRESTBOUND.game, P=G.player, C=G.cam;
          return { st:P?P.state:null, x:P?+P.pos.x.toFixed(2):null, y:P?+P.pos.y.toFixed(2):null,
            z:P?+P.pos.z.toFixed(2):null, vy:P?+P.vel.y.toFixed(2):null, sp:P?+(P.speed||0).toFixed(2):null,
            gr:P?!!P.grounded:null, sf:P?P.surface:null, w:P?!!P.inWater:null, sub:P?!!P.submerged:null,
            deaths:G.deaths|0, gs:G.state, crests:G.save?G.save.crestTotal():0,
            coins:(G._collectibles&&G._collectibles.counts)?G._collectibles.counts.coins:null,
            sig:(G._collectibles&&G._collectibles.counts)?G._collectibles.counts.sigils:null,
            cd:C?+C.dist.toFixed(2):null, cy:C?+C.yaw.toFixed(2):null,
            pw:G.power?G.power.id:null,
            t:CRESTBOUND.engine?+CRESTBOUND.engine.elapsed.toFixed(2):0 }; }""")

    # ------------------------------------------------ C. SAVE-STATE SETTER
    def set_save(self, **kw):
        return self.cbx("saveSet", kw)

    # ------------------------------------------------ D. CLOCK ADVANCE
    def phase_scan(self, xyz, tmax=24, n=48):
        """Every hazard phase in `tmax` seconds, at this point, without waiting."""
        return self.cbx("phaseScan", xyz[0], xyz[1], xyz[2], tmax, n)

    def set_clock(self, t):
        return self.js("(t)=>CRESTBOUND.game.__dev.setClock(t)", t)

    # ------------------------------------------------ E. TWO-INPUT HELPER
    def two_input(self, hold, tap, hold_first_ms=600, tap_ms=90, after_ms=1400, sample_ms=100):
        """Hold one key (or set), then TAP another while it is still down.

        This is the human order for every two-input move: hold C while running,
        then Space (long jump); hold W into a wall, then Space (wall kick); hold
        crouch, then a direction (sink-and-swim).  Returns the sampled trace.
        """
        hold = [hold] if isinstance(hold, str) else list(hold)
        a = self.snap()
        self.down(*hold)
        self.wait(hold_first_ms)
        mid = self.snap()
        self.tap(tap, tap_ms)
        trace, peak = [], a["y"]
        t = 0
        while t < after_ms:
            self.wait(sample_ms); t += sample_ms
            s = self.snap(); trace.append(s["st"]); peak = max(peak, s["y"])
        self.up(*hold)
        self.wait(200)
        b = self.snap()
        return {"start": a, "atTap": mid, "end": b, "states": trace,
                "uniqueStates": sorted(set(trace)),
                "apex": round(peak - a["y"], 2),
                "dist": round(math.hypot(b["x"] - mid["x"], b["z"] - mid["z"]), 2),
                "speedAtTap": mid["sp"], "died": b["deaths"] > a["deaths"]}

    def run_then(self, run_ms, hold, tap, **kw):
        """Run up with W, then run the two-input move while still holding W."""
        self.down("W")
        self.wait(run_ms)
        r = self.two_input([h for h in ([hold] if isinstance(hold, str) else hold)], tap, **kw)
        self.up("W")
        self.wait(150)
        return r

    def wall_kick_ladder(self, xyz, yaw, kicks=6, into_ms=260, gap_ms=340):
        """Hold the stick into a wall and tap Space each time a contact is made.

        Reports the launch height of every kick, so a shaft that "tops out" is a
        number, not an impression.
        """
        self.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", list(xyz))
        self.wait(320)
        self.face_yaw(yaw)
        a = self.snap()
        launches, states = [], []
        self.down("W")
        self.tap("Space", 90)
        for i in range(kicks):
            self.wait(into_ms)
            s = self.snap()
            states.append(s["st"])
            self.tap("Space", 80)
            self.wait(gap_ms)
            s2 = self.snap()
            states.append(s2["st"])
            launches.append(round(s2["y"] - a["y"], 2))
        self.up("W")
        peak = max([l for l in launches] + [0.0])
        self.wait(500)
        b = self.snap()
        return {"start": [a["x"], a["y"], a["z"]], "launches": launches, "maxGain": peak,
                "states": sorted(set(states)), "kicked": states.count("wallkick"),
                "end": [b["x"], b["y"], b["z"]], "died": b["deaths"] > a["deaths"]}

    # A GL canvas without preserveDrawingBuffer reads back BLACK from a 2D
    # context, so the frame stats come off a real screenshot instead.
    def frame_stats(self, rect=(0.0, 0.0, 1.0, 1.0), tag=None):
        from PIL import Image
        png = self.shot(tag or "frame")
        im = Image.open(png).convert("RGB")
        W, H = im.size
        x0, y0 = int(rect[0] * W), int(rect[1] * H)
        x1, y1 = max(x0 + 1, int((rect[0] + rect[2]) * W)), max(y0 + 1, int((rect[1] + rect[3]) * H))
        im = im.crop((x0, y0, min(W, x1), min(H, y1)))
        px = list(im.getdata())
        n = len(px)

        def lin(u):
            u /= 255.0
            return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
        r = sum(p[0] for p in px) / n
        g = sum(p[1] for p in px) / n
        b = sum(p[2] for p in px) / n
        lums = [0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]) for p in px]
        lums.sort()
        sat = sum((max(p) - min(p)) / max(1, max(p)) for p in px) / n
        return {"png": os.path.relpath(png, os.path.dirname(HERE)),
                "rgb": [round(r), round(g), round(b)],
                "lum": round(sum(lums) / n, 4),
                "p05": round(lums[int(0.05 * n)], 4), "p95": round(lums[int(0.95 * n)], 4),
                "sat": round(sat, 3), "n": n}

    def face_yaw(self, yaw):
        self.js("(y)=>{const G=CRESTBOUND.game; G.player.__test.setFacing(y); if(G.cam){G.cam.yaw=y; G.cam._rcHoldT=0;}}", yaw)
        self.wait(120)

    # ------------------------------------------------ F. FRAME / SCREEN READS
    def cam_sweep(self, xyz, yaws=8, settle_ms=420):
        """Stand still and orbit. Reports the worst camera pose at this station."""
        self.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", list(xyz))
        self.wait(500)
        rows = []
        for i in range(yaws):
            yaw = round(2 * math.pi * i / yaws - math.pi, 3)
            self.face_yaw(yaw)
            self.wait(settle_ms)
            sb = self.cbx("screenBlockers", 0.04)
            if not sb:
                continue
            rows.append({"yaw": yaw, "camDist": sb["camDist"], "headOnScreen": sb["headOnScreen"],
                         "headDist": sb["headDist"], "occluded": sb["occluded"],
                         "occluders": [o["name"] for o in sb["occluders"]][:3],
                         "topBlocker": sb["blockers"][0] if sb["blockers"] else None,
                         "coverArea": round(min(1.0, sum(b["area"] for b in sb["blockers"] if b["coversHead"])), 3),
                         "frontArea": sb["frontArea"]})
        if not rows:
            return None
        worst = min(rows, key=lambda r: (r["camDist"] if r["camDist"] is not None else 9))
        hid = [r for r in rows if (not r["headOnScreen"]) or r["occluded"]]
        return {"rows": rows, "worstDist": worst["camDist"],
                "minDist": min(r["camDist"] for r in rows if r["camDist"] is not None),
                "hiddenYaws": len(hid), "yaws": len(rows),
                "occludedYaws": sum(1 for r in rows if r["occluded"]),
                "maxCover": max(r["coverArea"] for r in rows),
                "maxFront": max(r["frontArea"] for r in rows)}


# ===========================================================================
# A. STATION RESOLVER — pull a driveable coordinate out of a prose report.
# ===========================================================================
_NUM = r"~?\s*(-?\d+(?:\.\d+)?)"
_TRIPLE = re.compile(r"[\(\[]\s*" + _NUM + r"\s*,\s*" + _NUM + r"\s*,\s*" + _NUM + r"\s*[\)\]]")
# `[13, gy+0.14, -47]`, `(0, ~4.5, -12.8)`, `(-9.4, 16.70 / 16.30, -29.0)` — the
# tester writes a real position with a symbolic or ambiguous HEIGHT. Take the x/z
# and resolve the y off the live ground.
_TRIPLE_ANY_Y = re.compile(r"[\(\[]\s*" + _NUM + r"\s*,\s*([^,\)\]]{1,24}?)\s*,\s*" + _NUM + r"\s*[\)\]]")
_PAIR = re.compile(r"[\(\[]\s*" + _NUM + r"\s*,\s*" + _NUM + r"\s*[\)\]]")
_XZ = re.compile(r"\bx\s*[=:]?\s*" + _NUM + r"\D{1,16}?\bz\s*[=:]?\s*" + _NUM)
# ...and the same pair written the other way round ("the chamber along z = -2,
# from the terrace mouth at x 25"), which is how rime-3#23 names the crusher cave.
_ZX = re.compile(r"\bz\s*[=:]?\s*" + _NUM + r"\D{1,42}?\bx\s*[=:]?\s*" + _NUM)
_HEIGHT = re.compile(r"\b(?:floor|top|deck|y|height|ground|lip|ledge|rim|shelf)s?\s*(?:top\s*)?[=:]?\s*" + _NUM)
# `x -9.50 .. -6.50, z -35.50 .. -32.50` — an authored interior, take its centre.
_SPAN = re.compile(r"\bx\s*[=:]?\s*" + _NUM + r"\s*(?:\.\.|to|-)\s*" + _NUM + r"\D{0,18}?\bz\s*[=:]?\s*" + _NUM + r"\s*(?:\.\.|to|-)\s*" + _NUM)


def stations_from_text(d, limit=3):
    """Every coordinate a human wrote in this defect, strongest first.

    Ranking, learned from the first cut's misses: a bracketed (x, y, z) beats an
    (x, z) pair whose height the harness has to guess; the WHERE line (the place
    he named) beats the HAPPENED narrative (where he ended up), which beats DID
    (where he STARTED). A pair with no height borrows one from any field of the
    same report before falling back to the live ground.
    """
    cands = []
    for field in ("where", "happened", "did", "should"):
        t = d.get(field) or ""
        for m in _TRIPLE.finditer(t):
            cands.append({"p": [float(m.group(1)), float(m.group(2)), float(m.group(3))],
                          "src": field, "kind": "triple"})
        for m in _TRIPLE_ANY_Y.finditer(t):
            mid = m.group(2)
            if re.fullmatch(r"~?\s*-?\d+(?:\.\d+)?", mid or ""):
                continue                      # already caught by _TRIPLE
            hy = re.search(r"-?\d+(?:\.\d+)?", mid or "")
            cands.append({"p": [float(m.group(1)), float(hy.group(0)) if hy else 0.0, float(m.group(3))],
                          "src": field, "kind": "triple~", "needsGround": not hy})
        for m in _SPAN.finditer(t):
            seg = t[max(0, m.start() - 90): m.end() + 120]
            h = _HEIGHT.search(seg)
            cands.append({"p": [round((float(m.group(1)) + float(m.group(2))) / 2.0, 2),
                                float(h.group(1)) if h else 0.0,
                                round((float(m.group(3)) + float(m.group(4))) / 2.0, 2)],
                          "src": field, "kind": "span", "needsGround": not h})
        for rx, kind, flip in ((_PAIR, "pair", False), (_XZ, "xz", False), (_ZX, "zx", True)):
            for m in rx.finditer(t):
                seg = t[max(0, m.start() - 90): m.end() + 120]
                h = _HEIGHT.search(seg)
                a, b = float(m.group(1)), float(m.group(2))
                if flip:
                    a, b = b, a          # the text gave z first
                cands.append({"p": [a, float(h.group(1)) if h else 0.0, b],
                              "src": field, "kind": kind, "needsGround": not h})
    if not cands:
        return []
    # a height named ANYWHERE in the report beats a guess off the ground
    allh = None
    for field in ("where", "happened", "did"):
        mm = _HEIGHT.search(d.get(field) or "")
        if mm:
            allh = float(mm.group(1))
            break
    for c in cands:
        if c.get("needsGround") and allh is not None:
            c["p"][1] = allh
            c["needsGround"] = False
            c["heightFrom"] = "another line of the same report"
    srcRank = {"where": 0, "happened": 1, "did": 2, "should": 3}
    kindRank = {"triple": 0, "triple~": 1, "span": 2, "pair": 2, "xz": 2, "zx": 2}
    # SOURCE OUTRANKS FORM. rime-2#16's WHERE line names both ends of the hop as
    # `(6.40, top 35.35, -46.00) to (5.20, top 36.80, -49.72)` while its HAPPENED
    # line gives the MISS position `(3.88, 33.90, -47.95)` as a clean triple. Ranking
    # by form first picked the miss position as the launch block and drove the
    # crossing test from the wrong place.
    cands.sort(key=lambda c: (1 if c.get("needsGround") else 0,
                              srcRank.get(c["src"], 4), kindRank.get(c["kind"], 3)))
    seen, res = set(), []
    for c in cands:
        k = (round(c["p"][0] * 2), round(c["p"][1] * 2), round(c["p"][2] * 2))
        if k in seen:
            continue
        seen.add(k)
        res.append(c)
        if len(res) >= limit:
            break
    return res

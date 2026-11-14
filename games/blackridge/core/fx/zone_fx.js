// core/fx/zone_fx.js [lane dom] — STRONGHOLD's in-world zone visuals.
//
// Per zone (pooled — exactly three, built once at boot, never `new` in a
// handler or a frame):
//   - a ground RING at the capture radius in the owner's colour (neutral =
//     bone white), pulsing red/owner while CONTESTED
//   - a faint DISC fill so the ring reads as an area, not a line
//   - the CAPTURE ARC just inside the ring, in the capturing team's colour,
//     drawn as a partial ring via geometry.setDrawRange (no per-frame
//     geometry rebuild: the ring is indexed in theta order, 6 indices per
//     segment)
//   - a POLE with a small banner in the owner's colour, so a zone reads from
//     across the map over cover
//
// Cost: 3 zones × 5 meshes, two shared geometries per kind, MeshBasic for the
// flat parts (unlit, readable at night, no new light-count permutation) and
// MeshLambert for the pole (already in the compiled program set — the level
// is Lambert throughout). Everything joins the scene at creation, VISIBLE but
// parked 200 m under the world, so the boot prewarm pass (scene compile)
// builds its programs before the first firefight; the first update() with no
// STRONGHOLD match live hides it.
//
// View-only: reads sim.state.match.mode.zones (the public board), writes
// nothing back to the sim. Driven per frame from boot's viewUpdates (hidden
// tabs / stepFrames included) and snapped on the `zonecap` / `match:start`
// events.

import { teamNum, teamColorGen } from "../team_color.js";

const NEUTRAL = 0xe8e8e4;
// [polish v149] team colours come from core/team_color.js (colour-blind aware);
// the per-zone signature carries teamColorGen() so a palette change re-tints.
const TEAM = { get 0() { return teamNum(0); }, get 1() { return teamNum(1); } };
const RED = 0xff4d4d;
const POLE_H = 3.4;

export function createZoneFx(ctx) {
  const TH = ctx.THREE;
  const group = new TH.Group();
  group.name = "dom-zones";

  const gRing = new TH.RingGeometry(0.9, 1.0, 64, 1);
  const gArc = new TH.RingGeometry(0.76, 0.88, 64, 1);
  const gDisc = new TH.CircleGeometry(0.9, 48);
  const gPole = new TH.BoxGeometry(0.07, POLE_H, 0.07);
  const gCloth = new TH.PlaneGeometry(0.95, 0.6);
  const ARC_SEGS = 64;

  const flatMat = (opacity) => new TH.MeshBasicMaterial({
    color: NEUTRAL, transparent: true, opacity, depthWrite: false,
    side: TH.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  const views = [];
  for (let i = 0; i < 3; i++) {
    const root = new TH.Group();
    const flat = new TH.Group();
    flat.rotation.x = -Math.PI / 2;
    flat.position.y = 0.04;
    const ringMat = flatMat(0.8), discMat = flatMat(0.09), arcMat = flatMat(0.92);
    const ring = new TH.Mesh(gRing, ringMat);
    const disc = new TH.Mesh(gDisc, discMat);
    // each arc needs its OWN draw range → its own geometry (cloned once here)
    const arcGeo = gArc.clone();
    arcGeo.setDrawRange(0, 0);
    const arc = new TH.Mesh(arcGeo, arcMat);
    arc.position.z = 0.002;
    flat.add(disc, ring, arc);
    root.add(flat);
    const pole = new TH.Mesh(gPole, new TH.MeshLambertMaterial({ color: 0x3a3d42 }));
    pole.position.y = POLE_H / 2;
    const clothMat = new TH.MeshBasicMaterial({ color: NEUTRAL, side: TH.DoubleSide });
    const cloth = new TH.Mesh(gCloth, clothMat);
    cloth.position.set(0.5, POLE_H - 0.38, 0);
    root.add(pole, cloth);
    for (const o of [ring, disc, arc, pole, cloth]) { o.frustumCulled = true; o.renderOrder = 2; }
    root.position.set(0, -200, 0); // parked for the prewarm compile
    group.add(root);
    views.push({ root, flat, ring, disc, arc, arcGeo, ringMat, discMat, arcMat, clothMat, cloth, pole,
      sig: "", posSig: "", arcN: -1 });
  }
  ctx.scene.add(group);

  const sim = () => (ctx.sim ? ctx.sim() : null);
  const TMP = new TH.Color();
  let shown = true; // starts visible (prewarm); first update decides

  function setShown(on) {
    if (on === shown) return;
    shown = on;
    group.visible = on;
  }

  function update() {
    const s = sim();
    const M = s && s.state && s.state.match;
    // [lane modes] OUTPOST publishes its live hill (+ the previewed next one) on the same board
    const zones = M && (M.modeId === "dom" || M.modeId === "hill") && M.mode && M.mode.zones;
    if (!zones || !zones.length) { setShown(false); return; }
    setShown(true);
    const t = s.state.time;
    for (let i = 0; i < views.length; i++) {
      const v = views[i], z = zones[i];
      if (!z) { v.root.visible = false; continue; }
      v.root.visible = true;
      const ps = z.pos[0] + "," + z.pos[1] + "," + z.pos[2] + "," + z.r;
      if (ps !== v.posSig) {
        v.posSig = ps;
        v.root.position.set(z.pos[0], z.pos[1], z.pos[2]);
        v.flat.scale.set(z.r, z.r, 1);
      }
      const own = z.owner === 0 || z.owner === 1 ? TEAM[z.owner] : NEUTRAL;
      const sig = own + ":" + z.capTeam + ":" + (z.contested ? 1 : 0) + (z.preview ? "p" : "") + ":" + teamColorGen();
      if (sig !== v.sig) {
        v.sig = sig;
        v.ringMat.color.setHex(own);
        v.discMat.color.setHex(own);
        v.discMat.opacity = z.owner >= 0 ? 0.08 : 0.05;
        v.clothMat.color.setHex(own);
        v.arcMat.color.setHex(z.capTeam === 0 || z.capTeam === 1 ? TEAM[z.capTeam] : NEUTRAL);
        v.ringMat.opacity = z.preview ? 0.32 : 0.8; // [lane modes] the next hill reads as a ghost
        v.cloth.visible = !z.preview; v.pole.visible = !z.preview;
      }
      if (z.contested) {
        // contested: the ring breathes between red and the owner colour
        const k = 0.5 + 0.5 * Math.sin(t * 9);
        v.ringMat.color.setHex(own).lerp(TMP.setHex(RED), k);
        v.sig = ""; // restore the owner colour on the next calm frame
      }
      const n = z.prog > 0 ? Math.max(1, Math.round(z.prog * ARC_SEGS)) : 0;
      if (n !== v.arcN) { v.arcN = n; v.arcGeo.setDrawRange(0, n * 6); }
      // banner sway — a yaw waggle, no vertex work
      v.cloth.rotation.y = Math.sin(t * 1.6 + i * 2.2) * 0.2;
    }
  }

  return {
    attach(bridge) {
      bridge.register("zonecap", update);
      bridge.register("hill", update); // [lane modes]
      bridge.register("match:start", () => { for (const v of views) { v.sig = ""; v.posSig = ""; v.arcN = -1; } update(); });
    },
    update,
    _group: group,
  };
}

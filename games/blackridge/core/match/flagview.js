// core/match/flagview.js [W6] — the CTF flags' 3D representation
// (PVP_BUILD_PLAN C22; architecture.md §3.3).
//
// C22 ruling, implemented literally: a POOLED pair of flag meshes, created
// once at boot, never `new` in a handler, whose transform is written each
// frame from `sim.state.match.flags[i].pos` plus the carrier's yaw and a
// fixed back-offset. It NEVER reparents — parenting to a skinned actor is a
// bind-pose trap (doctrine §1); following a position costs nothing.
//
// View-side only: imports THREE via ctx, reads sim.state.match.flags and the
// `flag` event, writes NOTHING back to the sim (arch §3.5 doctrine boundary).
// When no match/no flags exist (campaign, TDM, FFA) both meshes are hidden
// and the module is inert.
//
// Program budget note (AC-49): materials are MeshLambertMaterial (already in
// the compiled program set — the level uses Lambert throughout), and both
// meshes join the scene at creation time (parked out of view) so any compile
// happens at boot, never during a firefight.

const BACK_OFFSET = 0.35;   // m behind the carrier's spine
const CARRY_H = 1.55;       // cloth top height while carried
const STAND_H = 2.5;        // pole height at a stand (content flags standH)

export function createFlagView(ctx) {
  const TH = ctx.THREE;
  const group = new TH.Group();
  group.name = "w6-flags";

  const flags = []; // [{root, cloth, tintHex}]
  for (let i = 0; i < 2; i++) {
    const root = new TH.Group();
    // pole: thin box (no cylinder → fewer verts, same silhouette at range)
    const pole = new TH.Mesh(
      new TH.BoxGeometry(0.05, STAND_H, 0.05),
      new TH.MeshLambertMaterial({ color: 0x3a3d42 }),
    );
    pole.position.y = STAND_H / 2;
    root.add(pole);
    // cloth: double-sided quad near the pole top
    const clothMat = new TH.MeshLambertMaterial({ color: 0xffffff, side: TH.DoubleSide });
    const cloth = new TH.Mesh(new TH.PlaneGeometry(0.85, 0.55), clothMat);
    cloth.position.set(0.45, STAND_H - 0.35, 0);
    root.add(cloth);
    root.visible = false;
    // parked below the world until first placement (prewarm can still compile)
    root.position.set(0, -100, 0);
    group.add(root);
    flags.push({ root, cloth, mat: clothMat, tinted: false });
  }
  ctx.scene.add(group);

  const sim = () => (ctx.sim ? ctx.sim() : null);

  function carrierBody(s, m, actorId) {
    if (actorId == null || !m.actors[actorId]) return null;
    const a = m.actors[actorId];
    if (a.who === "P") return s.state.player;
    return s.state.bots.find((b) => b.id === a.who) || null;
  }

  function update() {
    const s = sim();
    const m = s && s.state.match ? s.state.match : null;
    const list = m && m.flags ? m.flags : null;
    if (!list || !list.length) {
      for (const f of flags) f.root.visible = false;
      return;
    }
    const t = s.state.time;
    for (let i = 0; i < flags.length; i++) {
      const fv = flags[i];
      const fd = list[i];
      if (!fd) { fv.root.visible = false; continue; }
      // tint once per team assignment (teams carry their authored tints)
      if (!fv.tinted) {
        const team = m.teams && m.teams.find((tm) => tm.id === fd.team);
        const tint = (team && team.tint) || (fd.team === 0 ? "#d9a441" : "#7c9fd0");
        fv.mat.color.set(tint);
        fv.tinted = true;
      }
      const state = String(fd.state || "AT_STAND").toUpperCase();
      const pos = fd.pos || fd.home;
      if (!pos) { fv.root.visible = false; continue; }
      fv.root.visible = true;
      if (state === "CARRIED") {
        const body = carrierBody(s, m, fd.carrier);
        const yaw = body ? body.yaw : 0;
        const bx = body ? body.pos[0] : pos[0];
        const by = body ? body.pos[1] : pos[1];
        const bz = body ? body.pos[2] : pos[2];
        // fixed back-offset along -forward (forward = [-sin yaw, -cos yaw])
        fv.root.position.set(
          bx + Math.sin(yaw) * BACK_OFFSET,
          by + CARRY_H - STAND_H, // cloth top rides at the shoulders
          bz + Math.cos(yaw) * BACK_OFFSET,
        );
        fv.root.rotation.y = yaw;
        fv.root.scale.setScalar(0.7); // stowed read, still visible from behind
      } else {
        fv.root.position.set(pos[0], pos[1], pos[2]);
        fv.root.scale.setScalar(1);
        fv.root.rotation.y = 0;
      }
      // idle cloth sway — cheap, no vertex work, just a yaw waggle
      fv.cloth.rotation.y = Math.sin(t * 1.7 + i * 2.1) * 0.18;
    }
  }

  // self-driving: visual-only, so rAF is the right clock; hidden tabs simply
  // stop animating (the meshes still place correctly on the next visible
  // frame — nothing gameplay-bearing lives here).
  (function loop() {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(loop);
      update();
    }
  })();

  return {
    attach(bridge) {
      // placement is per-frame; the event hook exists so a captured/reset
      // flag snaps the same frame the sim says so, not a frame later.
      bridge.register("flag", update);
      bridge.register("match:start", () => {
        for (const f of flags) f.tinted = false;
        update();
      });
    },
    update, // exposed for harness/manual stepping
    _group: group,
  };
}

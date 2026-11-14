// core/fx/tag_fx.js [lane modes] — RECLAIM's in-world tags.
//
// A tag is a small spinning diamond plate in the VICTIM's team colour, bobbing
// at chest height over where they fell, with a faint ground ring. Pooled: 24
// views (the mode's maxTags) built once at boot, joined to the scene VISIBLE but
// parked 200 m under the world so the boot prewarm compiles their programs;
// the first update() with no RECLAIM match hides the group. MeshBasic only
// (unlit, readable at night, no new light permutation). A tag in its last 5 s
// blinks. View-only: reads sim.state.match.mode.tags, writes nothing back.

const TEAM = [0xd9a441, 0x7c9fd0];
const POOL = 24;

export function createTagFx(ctx) {
  const TH = ctx.THREE;
  const group = new TH.Group();
  group.name = "tags";
  const gTag = new TH.OctahedronGeometry(0.22, 0);
  const gRing = new TH.RingGeometry(0.42, 0.5, 32, 1);
  const views = [];
  for (let i = 0; i < POOL; i++) {
    const root = new TH.Group();
    const mat = new TH.MeshBasicMaterial({ color: TEAM[0] });
    const tag = new TH.Mesh(gTag, mat);
    tag.scale.set(1, 1.5, 0.45);
    const ringMat = new TH.MeshBasicMaterial({
      color: TEAM[0], transparent: true, opacity: 0.55, depthWrite: false, side: TH.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const ring = new TH.Mesh(gRing, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    root.add(tag, ring);
    root.position.set(0, -200, 0);
    group.add(root);
    views.push({ root, tag, mat, ringMat, id: -1, team: -1 });
  }
  ctx.scene.add(group);
  const sim = () => (ctx.sim ? ctx.sim() : null);
  let shown = true;

  function update() {
    const s = sim();
    const M = s && s.state && s.state.match;
    const tags = M && M.modeId === "tags" && M.mode && M.mode.tags;
    if (!tags) { if (shown) { shown = false; group.visible = false; } return; }
    if (!shown) { shown = true; group.visible = true; }
    const t = s.state.time;
    for (let i = 0; i < POOL; i++) {
      const v = views[i], g = tags[i];
      if (!g) { if (v.root.visible) v.root.visible = false; v.id = -1; continue; }
      v.root.visible = true;
      if (v.id !== g.id) {
        v.id = g.id;
        v.root.position.set(g.pos[0], g.pos[1], g.pos[2]);
      }
      if (v.team !== g.team) {
        v.team = g.team;
        const c = TEAM[g.team] != null ? TEAM[g.team] : 0xe8e8e4;
        v.mat.color.setHex(c); v.ringMat.color.setHex(c);
      }
      v.tag.position.y = 1.05 + Math.sin(t * 2.6 + g.id) * 0.08;
      v.tag.rotation.y = t * 2.2 + g.id;
      const left = g.expiresT - t;
      v.tag.visible = left > 5 || Math.floor(t * 6) % 2 === 0;
    }
  }

  return {
    attach(bridge) {
      bridge.register("tag", update);
      bridge.register("match:start", () => { for (const v of views) { v.id = -1; v.team = -1; } update(); });
    },
    update,
    _group: group,
  };
}

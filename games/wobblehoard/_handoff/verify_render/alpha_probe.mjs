// Which draw leaves the canvas NON-OPAQUE (alpha < 1)? The canvas is composited over the CSS gradient of #stage (src/ui/styles.css),
// so alpha < 1 shows that gradient through (lighter halos, hard quad edges) and toDataURL screenshots show holes.
// Replays the calm Common capsule reveal to burst + 9 frames (out/look/black2), then hides object groups one at a time.
import { setup } from './common.mjs';
const env = await setup({ width: 1280, height: 800 });
const r = await env.page.evaluate(async () => {
  const V = window.__V__; V.newStage(1280, 800, 'med', 1);
  const c = V.ctx, st = c.stage, out = {};
  const cc = document.createElement('canvas'); cc.width = 1280; cc.height = 800; const x = cc.getContext('2d', { willReadFrequently: true });
  const count = () => { st.render(); x.clearRect(0, 0, 1280, 800); x.drawImage(c.canvas, 0, 0); const d = x.getImageData(0, 0, 1280, 800).data; let lt1 = 0, lt05 = 0, z = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] < 255) lt1++; if (d[i] < 128) lt05++; if (d[i] === 0) z++; } return { lt1, lt05, zero: z }; };
  // a: idle play body + a waiting capsule (normal mode)
  V.frames(40, 1 / 30);
  const cap0 = st.dropCapsule(); V.frames(80, 1 / 30);
  out.idleWithCapsule = count();
  cap0.remove(); V.frames(2, 1 / 30);
  out.idleNoCapsule = count();
  // b: calm common reveal, stop at burst + 9 frames
  const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); st.setBody(c.play, g); V.frames(40, 1 / 30);
  st.setCalmEffects(true);
  const cap = st.dropCapsule(); let k = 0; while (!cap.landed && k < 200) { V.frame(1 / 30, false); k++; } V.frames(20, 1 / 30);
  for (let i = 0; i < 15; i++) { cap.setSqueeze(i / 15); V.frame(1 / 30, false); }
  let burst = -1, f = 0;
  const h = st.playCapsuleReveal({ result: { genome: V.resultGenome('common'), tier: 'common' }, createBody: V.mkBody, capsule: cap }, { onBeat: (b) => { if (b === 'burst') burst = f; } });
  while (h.active && (burst < 0 || f < burst + 9)) { V.frame(1 / 30, false); f++; }
  out.calmBurstPlus9 = count();
  const toggle = (label, objs) => { const prev = objs.map((o) => o.visible); objs.forEach((o) => { o.visible = false; }); out['hide_' + label] = count(); objs.forEach((o, i) => { o.visible = prev[i]; }); };
  const v = st.views.find((w) => w.id === h.resultBodyId);
  toggle('resultJelly', [v.jelly.mesh]);
  toggle('resultCore', [v.core.group]);
  toggle('resultFace', [v.face.group]);
  toggle('resultFx', [v.fx.group]);
  toggle('resultDecals', [v.decals.shadow, v.decals.pool]);
  toggle('resultRarity', [v.rarity.group]);
  const capGroup = st.scene.children.find((o) => o.type === 'Group' && o.children.some((kk) => kk.type === 'Group' && kk.children.some((m) => m.renderOrder === 12)));
  if (capGroup) toggle('capsule', [capGroup]);
  const others = st.scene.children.filter((o) => o.type === 'Mesh');
  others.forEach((o, i) => toggle(`sceneMesh${i}_ro${o.renderOrder}_${o.material?.type}`, [o]));
  out.views = st.views.map((w) => ({ id: w.id, visible: w.visible }));
  return out;
});
for (const [k, v] of Object.entries(r)) console.log(k, JSON.stringify(v));
console.log('console', env.bad.slice(0, 5));
await env.close();

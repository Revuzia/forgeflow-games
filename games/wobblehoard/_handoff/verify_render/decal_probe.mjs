// Isolate the hard-edged patch under a waiting capsule, and the transmission "window" when the capsule overlaps a body (phone portrait).
import { setup, b64, S } from './common.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const dir = `${S}/out/look/decal_probe`; mkdirSync(dir, { recursive: true });
for (const [w, h, q, tag] of [[1280, 800, 'med', 'desk'], [390, 844, 'med', 'phone'], [390, 844, 'high', 'phonehigh']]) {
  const env = await setup({ width: w, height: h });
  const r = await env.page.evaluate(async ([w, h, q]) => {
    const V = window.__V__; V.newStage(w, h, q, 1);
    const c = V.ctx, st = c.stage, out = {};
    V.frames(30, 1 / 30);
    st.dropCapsule(); V.frames(80, 1 / 30);
    out.base = V.png();
    // the capsule root group: a Group with a child Group (rig) whose meshes have renderOrder 12
    const capGroup = st.scene.children.find((o) => o.type === 'Group' && o.children.some((k) => k.type === 'Group' && k.children.some((m) => m.renderOrder === 12)));
    out.found = !!capGroup;
    if (capGroup) {
      const decals = capGroup.children.filter((k) => k.type === 'Mesh');
      for (const d of decals) d.visible = false;
      st.render(); out.noCapDecals = c.canvas.toDataURL('image/png');
      for (const d of decals) d.visible = true;
      const rig = capGroup.children.find((k) => k.type === 'Group'); rig.visible = false;
      st.render(); out.noCapShell = c.canvas.toDataURL('image/png'); rig.visible = true;
    }
    // hide the play body's decals (renderOrder -40 / -39 meshes inside the body view group)
    const v = st.views[0];
    v.decals.shadow.visible = false; v.decals.pool.visible = false;
    st.render(); out.noBodyDecals = c.canvas.toDataURL('image/png');
    return out;
  }, [w, h, q]);
  for (const k of ['base', 'noCapDecals', 'noCapShell', 'noBodyDecals']) if (r[k]) writeFileSync(`${dir}/${tag}_${k}.png`, b64(r[k]));
  console.log(tag, 'capsule group found', r.found, env.bad.slice(0, 3));
  await env.close();
}

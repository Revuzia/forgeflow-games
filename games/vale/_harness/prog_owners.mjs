// VALE harness — r12 B4 programs: every live WebGL program of the render bench (RIFT, densest fight) with the
// materials and scene parts that own it and its first fragment uniforms, so the program budget can be worked down.
//   VALE_URL=http://localhost:<port> node _harness/prog_owners.mjs [t=900] [q=high]      (prints one line per program)
import { open } from './pw.mjs';
const T = Number(process.argv[2] ?? 900), Q = process.argv[3] ?? 'high';
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=rift&q=${Q}&t=${T}&dev=1&hud=1`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
await page.waitForTimeout(5000);
await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
await page.waitForTimeout(2000);
const res = await page.evaluate(() => {
  const r = window.__VALE_BENCH__.renderer;
  const gl = r.gl;
  const props = gl.properties;
  const owners = new Map();
  const note = (mat, where) => {
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const p = props.get(m);
      const progs = p.programs ? [...p.programs.values()] : [];
      for (const pr of progs) {
        const k = pr.id;
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k).add(`${m.type}:${m.name || ''}:${where}`);
      }
    }
  };
  const walk = (root, label) => root?.traverse?.((o) => {
    let top = o; while (top.parent && top.parent !== root) top = top.parent;
    const w = `${label}/${top.name || top.type}`;
    note(o.material, w); note(o.customDepthMaterial, w + '#depth'); note(o.customDistanceMaterial, w + '#dist');
  });
  walk(r.scene, 'scene'); walk(r.vfx?.scene, 'vfx'); walk(r.overlay?.scene, 'ovl'); walk(r.overlay?.teleScene, 'tele');
  walk(r.warmScene, 'warm');
  // post passes
  for (const pass of r.post?.composer?.passes ?? []) {
    for (const [k, v] of Object.entries(pass)) {
      if (v && v.isMaterial) note(v, `post/${pass.name}.${k}`);
      if (v && typeof v === 'object' && !v.isMaterial) for (const [k2, v2] of Object.entries(v)) if (v2 && v2.isMaterial) note(v2, `post/${pass.name}.${k}.${k2}`);
    }
    if (pass.fullscreenMaterial) note(pass.fullscreenMaterial, `post/${pass.name}.fs`);
    for (const e of pass.effects ?? []) note(e?.material, `post/${pass.name}.effect`);
  }
  walk(r.vfx?.distortScene, 'distort');
  walk(r.hoverRim?.scene, 'hover');
  for (const [k, v] of Object.entries(r.hoverRim ?? {})) if (v && v.isMaterial) note(v, 'hover.' + k);
  for (const [k, v] of Object.entries(r.crowd ?? {})) if (v instanceof Map) for (const s of v.values()) walk(s.group, 'crowd.' + k);
  const g2 = gl.getContext();
  const list = gl.info.programs.map((p) => {
    const vs = g2.getShaderSource(p.vertexShader?.shader ?? p.vertexShader) ?? '';
    const fs = g2.getShaderSource(p.fragmentShader?.shader ?? p.fragmentShader) ?? '';
    const hint = (fs.match(/uniform [a-zA-Z0-9]+ (u[A-Z][a-zA-Z0-9]*)/g) ?? []).slice(0, 4).map((x) => x.split(' ').pop()).join(',');
    return { id: p.id, type: p.type, name: p.name, used: p.usedTimes, owners: [...(owners.get(p.id) ?? [])].slice(0, 4), hint };
  });
  return list;
});
for (const p of res) console.log(p.id, p.type, JSON.stringify(p.name), p.used, '{' + p.hint + '}', p.owners.join(' | ').slice(0, 200));
await browser.close();

// W2-A scratch: every live program at the RIFT/BRIDGE bench fight with its owners and full cache key (for merging).
//   VALE_URL=http://localhost:<port> node _harness/_tmp_w2a_progs.mjs <mode> <t> <q> <out.json>
import { writeFileSync } from 'node:fs';
import { open } from './pw.mjs';
const MODE = process.argv[2] ?? 'rift', T = Number(process.argv[3] ?? 900), Q = process.argv[4] ?? 'high', OUT = process.argv[5];
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${MODE}&q=${Q}&t=${T}&dev=1&hud=1`, { wait: false, hmr: false });
try { await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: Number(process.env.W2A_WAIT ?? 300000) }); }
catch (e) { console.log('TIMEOUT', JSON.stringify(await page.evaluate(() => ({ b: window.__VALE_BENCH__ ? Object.keys(window.__VALE_BENCH__) : null, st: window.__VALE_BENCH__?.status ?? window.__VALE_BENCH__?.stage, err: String(window.__VALE_BENCH__?.error ?? '') })))); console.log(logs.slice(0, 30).join('\n')); await browser.close(); process.exit(1); }
if (await page.evaluate(() => window.__VALE_BENCH__?.error)) { console.log('BENCH ERROR', await page.evaluate(() => String(window.__VALE_BENCH__.error))); console.log(logs.slice(0,30).join('\n')); }
await page.waitForTimeout(4000);
await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
await page.waitForTimeout(2500);
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
        if (!owners.has(pr.id)) owners.set(pr.id, new Set());
        owners.get(pr.id).add(`${m.type}:${m.name || ''}:${where}`);
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
  for (const [k, v] of Object.entries(r.crowd ?? {})) if (v instanceof Map) for (const s of v.values()) walk(s.group, 'crowd.' + k);
  return { info: { calls: gl.info.render.calls, tris: gl.info.render.triangles }, list: gl.info.programs.map((p) => ({ id: p.id, name: p.name, used: p.usedTimes, key: p.cacheKey, owners: [...(owners.get(p.id) ?? [])].slice(0, 12) })) };
});
if (OUT) writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log('programs', res.list.length, JSON.stringify(res.info));
for (const p of res.list) console.log(p.id, JSON.stringify(p.name), p.used, p.owners.join(' | ').slice(0, 300));
await browser.close();

// VALE harness — round 4 MSAA-1: the post chain with the GR-3 MSAA path removed draws the same pixels as the chain that
// carried it (20aaa35ba, MSAA_ULTRA_SAMPLES 0) and as the chain before it (20aaa35ba^), on High and Ultra.
//   node _harness/fw_r4_mem_msaa_px.mjs [--q high,ultra] [--seed 7] [--t 300]
// Each variant is its own vite dev server started here, whose only difference is src/render/post.ts served from a git
// revision through a load hook (nothing on disk is swapped): 'gr3' = 20aaa35ba, 'pre' = 20aaa35ba^, 'now' = the tree.
// 'pre' runs twice ('pre' and 'pre2'): the same code in two pages is the noise floor. Every page shows the same frozen
// frames (render bench, manual frames, fixed seed and time, the same focus spots); the canvas buffers are compared byte for
// byte. Report _harness/_reports/fw_r4_mem_msaa_px.json, frames _harness/_shots/fw_r4_msaa_px/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const TIERS = arg('q', 'high,ultra').split(',');
const SEED = Number(arg('seed', 7)), T = Number(arg('t', 300));
const OUT = join(HERE, '_shots', 'fw_r4_msaa_px'); mkdirSync(OUT, { recursive: true });
const POST = 'games/vale/src/render/post.ts';
const rev = (r) => execFileSync('git', ['show', `${r}:${POST}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
const SRC = { gr3: rev('20aaa35ba'), pre: rev('20aaa35ba^'), pre2: rev('20aaa35ba^'), now: null };
const load = () => execFileSync('uptime').toString().trim().replace(/.*load averages?: /, '');

const vite = await import('vite');
async function serve(name, port) {
  const body = SRC[name];
  const plugin = { name: `fw-r4-post-${name}`, enforce: 'pre', load(id) { if (body && id.split('?')[0].endsWith('/src/render/post.ts')) return body; return null; } };
  const s = await vite.createServer({ configFile: join(ROOT, 'vite.config.ts'), root: ROOT, logLevel: 'error', cacheDir: join(ROOT, 'node_modules', `.vite_fw_r4_${name}`), plugins: [plugin], server: { port, strictPort: true, host: 'localhost', hmr: false, watch: null } });
  await s.listen();
  return s;
}

const rep = { at: new Date().toISOString(), seed: SEED, t: T, load0: load(), tiers: {} };
const frames = {};   // name → tier → spot → rgba
let port = 5193;
for (const name of Object.keys(SRC)) {
  const server = await serve(name, port);
  process.env.VALE_URL = `http://localhost:${port}`;
  const { openBench, B } = await import(`./gfx_lib.mjs?v=${name}`);
  frames[name] = {};
  try {
    for (const q of TIERS) {
      // a bench that does not come up inside openBench's 300 s on a loaded machine is opened again (twice at most)
      let opened = null;
      for (let k = 0; k < 3 && !opened; k++) { try { opened = await openBench({ q, t: T, seed: SEED, w: 1600, h: 900, dsf: 1 }); } catch (e) { console.log(`${name} ${q}: bench open ${k + 1} failed (${String(e.message).slice(0, 80)}; load ${load()})`); } }
      if (!opened) throw new Error(`${name} ${q}: bench never opened`);
      const { browser, page, logs } = opened;
      try {
        const spots = await B(page, (b) => { const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)]; return { fight: [f.x, f.y], struct: [s.x, s.y] }; });
        frames[name][q] = {};
        for (const [k, [x, y]] of Object.entries(spots)) {
          const px = await B(page, (b, p) => {
            b.focus(p[0], p[1]); b.zoom(31); b.renderer.director.telegraphs.length = 0; b.clearAim();
            for (let i = 0; i < 25; i++) b.renderer.render(1 / 60);
            b.renderer.render(0); b.renderer.render(0);
            const gl = b.renderer.gl.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, d = new Uint8Array(W * H * 4);
            gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, d);
            const png = document.getElementById('c').toDataURL('image/png').split(',')[1];
            let bin = ''; for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
            return { W, H, raw: btoa(bin), png };
          }, [x, y]);
          writeFileSync(join(OUT, `${name}_${q}_${k}.png`), Buffer.from(px.png, 'base64'));
          frames[name][q][k] = { width: px.W, height: px.H, data: Buffer.from(px.raw, 'base64') };
        }
        if (logs.length) (rep.logs ??= {})[`${name}_${q}`] = logs.slice(0, 5);
      } finally { await browser.close().catch(() => {}); }
      console.log(`${name} ${q}: frames taken (load ${load()})`);
    }
  } finally { await server.close(); }
  port++;
}
const diff = (a, b) => {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return { comparable: false };
  let n = 0, max = 0;
  for (let i = 0; i < a.data.length; i += 4) { let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c])); if (m) { n++; if (m > max) max = m; } }
  return { pixels: a.width * a.height, differ: n, maxDiff: max };
};
let identical = true;
for (const q of TIERS) {
  rep.tiers[q] = {};
  for (const k of Object.keys(frames.pre[q] ?? {})) {
    const r = { now_vs_pre: diff(frames.now[q][k], frames.pre[q][k]), now_vs_gr3: diff(frames.now[q][k], frames.gr3[q][k]), noise_pre_vs_pre2: diff(frames.pre[q][k], frames.pre2[q][k]) };
    rep.tiers[q][k] = r;
    if (r.now_vs_pre.differ !== 0 || r.now_vs_gr3.differ !== 0) identical = false;
    console.log(`${q} ${k}: now vs pre ${JSON.stringify(r.now_vs_pre)}  now vs gr3 ${JSON.stringify(r.now_vs_gr3)}  noise ${JSON.stringify(r.noise_pre_vs_pre2)}`);
  }
}
rep.identical = identical; rep.load1 = load();
writeFileSync(join(HERE, '_reports', 'fw_r4_mem_msaa_px.json'), JSON.stringify(rep, null, 1));
console.log(`MSAA-1 pixels: ${identical ? 'IDENTICAL' : 'DIFFER'} → _harness/_reports/fw_r4_mem_msaa_px.json`);
process.exit(identical ? 0 : 1);

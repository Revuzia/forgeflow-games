// VALE harness — A/B frames at the gameplay camera (r12 B4 "the look must not change"): the render bench in manual
// mode (fixed 1/30 s frames, the same seed, so two builds see the same sim), assets given 9 s of real time to land,
// then the densest fight, the centre, two quadrant spots and a base, each as raw RGBA (+ a PNG screenshot).
//   VALE_URL=<build A> node _harness/ab_frames.mjs <dirA> <mode> <q> <t>
//   VALE_URL=<build B> node _harness/ab_frames.mjs <dirB> <mode> <q> <t>
//   node _harness/ab_frames.mjs --diff <dirA> <dirB> [--out <dir>] [--thr 8]   pixels whose max channel delta > thr,
//                                                                              and a diff PNG per frame (red = differs)
// VFX particles are not seeded: a fight frame differs by ~0.1 % between two runs of ONE build (the noise floor).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

if (process.argv[2] === '--diff') {
  const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const [, A, Bd] = a, OUTD = opt('out', null), thr = Number(opt('thr', 8));
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const png = (rgb, w, h) => {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };
  if (OUTD) mkdirSync(OUTD, { recursive: true });
  for (const f of readdirSync(A).filter((x) => x.endsWith('.rgba')).sort()) {
    if (!existsSync(join(Bd, f))) { console.log(f, 'missing in B'); continue; }
    const pa = readFileSync(join(A, f)), pb = readFileSync(join(Bd, f));
    const meta = JSON.parse(readFileSync(join(A, f.replace('.rgba', '.json')), 'utf8'));
    const W = meta.w, H = meta.h, rgb = Buffer.alloc(W * H * 3);
    let n = 0, maxd = 0;
    for (let i = 0, p = 0; i < pa.length; i += 4, p++) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d > maxd) maxd = d;
      const o = ((H - 1 - Math.floor(p / W)) * W + (p % W)) * 3;           // readPixels rows are bottom-up
      if (d > thr) { n++; rgb[o] = 255; rgb[o + 1] = 40; rgb[o + 2] = 40; } else rgb[o] = rgb[o + 1] = rgb[o + 2] = (pa[i] * 0.3 + pa[i + 1] * 0.59 + pa[i + 2] * 0.11) * 0.35;
    }
    if (OUTD) writeFileSync(join(OUTD, f.replace('.rgba', '_diff.png')), png(rgb, W, H));
    console.log(f.padEnd(28), `${n} px > ${thr} (${(100 * n / (W * H)).toFixed(3)} %)  max ${maxd}`);
  }
  process.exit(0);
}

const { open } = await import('./pw.mjs');
const [OUT, MODE = 'rift', Q = 'high', T = '900'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=${MODE}&q=${Q}&t=${T}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(2, 1 / 30));
await page.waitForTimeout(9000);                          // every model, prop and texture lands in real time
await B((b) => b.frames(30, 1 / 30));
const m = await B((b) => { const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); return { size: m.size, bases: m.bases.map((x) => x.spawn) }; });
const f = await B((b) => b.fight());
const [W, H] = m.size;
const spots = { fight: f ? [f.x, f.y] : [W / 2, H / 2], centre: [W / 2, H / 2], q1: [W * 0.3, H * 0.3], q3: [W * 0.7, H * 0.65], ...(m.bases[0] ? { base: [m.bases[0][0] + 6, m.bases[0][1]] } : {}) };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B((b, p) => { b.focus(p[0], p[1]); b.frames(20, 1 / 30); }, [x, y]);
  const px = await page.evaluate(() => {
    const gl = window.__VALE_BENCH__.renderer.gl.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
    let s = ''; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768));
    return { w, h, b64: btoa(s) };
  });
  writeFileSync(join(OUT, `${MODE}_${Q}_${k}.rgba`), Buffer.from(px.b64, 'base64'));
  writeFileSync(join(OUT, `${MODE}_${Q}_${k}.json`), JSON.stringify({ w: px.w, h: px.h, x, y }));
  await page.screenshot({ path: join(OUT, `${MODE}_${Q}_${k}.png`) });
  console.log(k, x.toFixed(1), y.toFixed(1), px.w, px.h);
}
await browser.close();

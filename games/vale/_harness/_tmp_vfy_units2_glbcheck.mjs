// verify UNITS2 r1: per GLB (base ref vs HEAD): KiB, triangles, ruling 32 reserved shares (8-bit and float HSV, max),
// base-colour texel diff over all texels, head-skinned texels, and 'face' texels (head-skinned, forward-facing normal,
// lower 60 % of the head's height). Also writes a diff image per fighter to the scratchpad.
//   node _harness/_tmp_vfy_units2_glbcheck.mjs <baseRef> a,b,c <outdir>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const [BASE, IDS, OUTD] = process.argv.slice(2);
const CT = { 5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767], 5123: [Uint16Array, 65535], 5125: [Uint32Array, 1], 5126: [Float32Array, 1] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const parse = (b) => {
  let off = 12, js, bin;
  while (off < b.length) { const ln = b.readUInt32LE(off), ty = b.readUInt32LE(off + 4); const ch = b.subarray(off + 8, off + 8 + ln); if (ty === 0x4E4F534A) js = JSON.parse(ch.toString()); else bin = ch; off += 8 + ln; }
  return { js, bin };
};
const acc = ({ js, bin }, i) => {
  const a = js.accessors[i], bv = js.bufferViews[a.bufferView], [T, nm] = CT[a.componentType], n = NC[a.type];
  const es = T.BYTES_PER_ELEMENT, stride = bv.byteStride || es * n, start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const rd = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    let v = dv[rd](start + k * stride + c * es, true);
    if (a.normalized) v = Math.max(v / nm, -1);
    out[k * n + c] = v;
  }
  return { v: out, n, count: a.count };
};
const img = async ({ js, bin }, suf) => {
  const im = js.images.find((x) => (x.name || '').endsWith(suf)); const bv = js.bufferViews[im.bufferView];
  const d = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const { data, info } = await sharp(Buffer.from(d)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
};
const fillTri = (m, W, H, p) => {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  const [a, b, c] = p; const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-12) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
    if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) m[y * W + x] = 1;
  }
};
const headMasks = (g, W, H) => {
  const { js } = g; const sk = js.skins[0];
  const headNode = sk.joints.find((j) => js.nodes[j].name === 'head');
  const hs = new Set(); const st = [headNode];
  while (st.length) { const n = st.pop(); const k = sk.joints.indexOf(n); if (k >= 0) hs.add(k); st.push(...(js.nodes[n].children || [])); }
  const mh = new Uint8Array(W * H), mf = new Uint8Array(W * H);
  for (const m of js.meshes) for (const p of m.primitives) {
    const at = p.attributes; if (at.TEXCOORD_0 === undefined) continue;
    const uv = acc(g, at.TEXCOORD_0).v, J = acc(g, at.JOINTS_0).v, Wt = acc(g, at.WEIGHTS_0).v, P = acc(g, at.POSITION).v, N = acc(g, at.NORMAL).v;
    const ix = acc(g, p.indices).v; const nv = P.length / 3;
    const ish = new Uint8Array(nv); let y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < nv; k++) {
      let hw = 0, tw = 0; for (let c = 0; c < 4; c++) { tw += Wt[k * 4 + c]; if (hs.has(J[k * 4 + c])) hw += Wt[k * 4 + c]; }
      ish[k] = hw / Math.max(tw, 1e-9) > 0.5 ? 1 : 0;
      if (ish[k]) { y0 = Math.min(y0, P[k * 3 + 1]); y1 = Math.max(y1, P[k * 3 + 1]); }
    }
    const ylim = y0 + 0.6 * (y1 - y0);
    for (let t = 0; t < ix.length; t += 3) {
      const v = [ix[t], ix[t + 1], ix[t + 2]];
      if (!v.every((k) => ish[k])) continue;
      const pts = v.map((k) => [uv[k * 2] * W, uv[k * 2 + 1] * H]);
      fillTri(mh, W, H, pts);
      if (v.every((k) => N[k * 3 + 2] > 0.35 && P[k * 3 + 1] < ylim)) fillTri(mf, W, H, pts);
    }
  }
  return { mh, mf };
};
const RES = { ally: [200, 225], harm: [28, 50], tritanAltRose: [340, 350], heal: [125, 150] };
const reserved = ({ data, W, H }) => {
  const cntP = {}, cntF = {}; for (const k in RES) { cntP[k] = 0; cntF[k] = 0; }
  let used = 0;
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx <= 2) continue; used++;
    const d = mx - mn; let h = 0;
    if (d > 0) h = mx === r ? (((g - b) / d) % 6 + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; const s = d / mx;
    const h8 = Math.floor(((h / 360) % 1) * 255) / 255 * 360, s8 = Math.floor(s * 255) / 255;
    for (const k in RES) { const [a, bb] = RES[k]; if (h >= a && h <= bb && s > 0.4) cntF[k]++; if (h8 >= a && h8 <= bb && s8 > 0.4) cntP[k]++; }
  }
  const o = {}; for (const k in RES) o[k] = +(100 * Math.max(cntP[k], cntF[k]) / Math.max(used, 1)).toFixed(2);
  return o;
};
const tris = (js) => js.meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + js.accessors[p.indices].count / 3, 0), 0);
const res = {};
for (const sid of IDS.split(',')) {
  const path = `art/out/fighters/${sid}/${sid}.glb`;
  const nb = readFileSync(path), ob = execFileSync('git', ['show', `${BASE}:games/vale/${path}`], { maxBuffer: 1 << 26 });
  const gn = parse(nb), go = parse(ob);
  const an = await img(gn, '_base'), ao = await img(go, '_base');
  const { W, H } = an;
  const { mh, mf } = headMasks(gn, W, H);
  const d = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(an.data[i * 3 + c] - ao.data[i * 3 + c])); d[i] = m; }
  const stat = (sel) => { let n = 0, s = 0, g12 = 0; for (let i = 0; i < W * H; i++) { if (!sel(i)) continue; if (Math.max(ao.data[i * 3], ao.data[i * 3 + 1], ao.data[i * 3 + 2]) <= 2) continue; n++; s += d[i]; if (d[i] > 12) g12++; } return { texels: n, meanAbs: n ? +(s / n).toFixed(2) : null, shareGt12: n ? +(g12 / n).toFixed(4) : null }; };
  const matChanged = gn.js.materials.map((m, i) => [m, go.js.materials[i]]).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([a, b]) => ({ name: a.name, before: b.pbrMetallicRoughness?.baseColorFactor, after: a.pbrMetallicRoughness?.baseColorFactor }));
  res[sid] = { kib: +(nb.length / 1024).toFixed(1), kibBase: +(ob.length / 1024).toFixed(1), tris: tris(gn.js), trisBase: tris(go.js), reserved: reserved(an), reservedBase: reserved(ao),
    all: stat(() => true), headNonFace: stat((i) => mh[i] && !mf[i]), face: stat((i) => mf[i]), materialsChanged: matChanged };
  await sharp(Buffer.from(d.map((x) => Math.min(255, x * 4))), { raw: { width: W, height: H, channels: 1 } }).png().toFile(`${OUTD}/diff_${sid}.png`);
  const ov = Buffer.alloc(W * H * 3); for (let i = 0; i < W * H; i++) { ov[i * 3] = an.data[i * 3]; ov[i * 3 + 1] = an.data[i * 3 + 1]; ov[i * 3 + 2] = an.data[i * 3 + 2]; if (mf[i]) { ov[i * 3] = Math.min(255, ov[i * 3] + 80); } }
  await sharp(ov, { raw: { width: W, height: H, channels: 3 } }).resize(512).png().toFile(`${OUTD}/facemask_${sid}.png`);
  console.log(sid, JSON.stringify(res[sid]));
}
writeFileSync(`${OUTD}/glbcheck.json`, JSON.stringify(res, null, 1));

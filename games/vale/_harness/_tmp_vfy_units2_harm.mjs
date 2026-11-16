import sharp from 'sharp'; import { readFileSync } from 'node:fs';
const parse = (b) => { let off = 12, js, bin; while (off < b.length) { const ln = b.readUInt32LE(off), ty = b.readUInt32LE(off + 4); const ch = b.subarray(off + 8, off + 8 + ln); if (ty === 0x4E4F534A) js = JSON.parse(ch.toString()); else bin = ch; off += 8 + ln; } return { js, bin }; };
for (const sid of process.argv.slice(2)) {
  const g = parse(readFileSync(`art/out/fighters/${sid}/${sid}.glb`)); const im = g.js.images.find((q) => q.name.endsWith('_base')); const bv = g.js.bufferViews[im.bufferView];
  const { data, info } = await sharp(Buffer.from(g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let used = 0, F = 0, P = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3], gg = data[i * 3 + 1], b = data[i * 3 + 2]; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); if (mx <= 2) continue; used++;
    const d = mx - mn; if (!d) continue; let h = mx === r ? (((gg - b) / d) % 6 + 6) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h *= 60; const s = d / mx;
    if (h >= 28 && h <= 50 && s > 0.4) F++;
    const h8 = Math.floor(((h / 360) % 1) * 255) / 255 * 360, s8 = Math.floor(s * 255) / 255; if (h8 >= 28 && h8 <= 50 && s8 > 0.4) P++;
  }
  console.log(sid, 'harm float', (100 * F / used).toFixed(2), 'pil', (100 * P / used).toFixed(2));
}

// crop old/new albedo + diff + face mask of one fighter at a texel box: node ... <base> <sid> x y w h out.png
import { readFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process'; import sharp from 'sharp';
const [BASE, sid, x, y, w, h, out] = process.argv.slice(2);
const parse = (b) => { let off = 12, js, bin; while (off < b.length) { const ln = b.readUInt32LE(off), ty = b.readUInt32LE(off + 4); const ch = b.subarray(off + 8, off + 8 + ln); if (ty === 0x4E4F534A) js = JSON.parse(ch.toString()); else bin = ch; off += 8 + ln; } return { js, bin }; };
const img = ({ js, bin }) => { const im = js.images.find((q) => q.name.endsWith('_base')); const bv = js.bufferViews[im.bufferView]; return Buffer.from(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)); };
const p = `art/out/fighters/${sid}/${sid}.glb`;
const nw = img(parse(readFileSync(p))), od = img(parse(execFileSync('git', ['show', `${BASE}:games/vale/${p}`], { maxBuffer: 1 << 26 })));
const ex = { left: +x, top: +y, width: +w, height: +h };
const S = 512 / Math.max(+w, +h);
const a = await sharp(od).extract(ex).resize(Math.round(w * S), Math.round(h * S), { kernel: 'nearest' }).png().toBuffer();
const b = await sharp(nw).extract(ex).resize(Math.round(w * S), Math.round(h * S), { kernel: 'nearest' }).png().toBuffer();
await sharp({ create: { width: Math.round(w * S) * 2 + 8, height: Math.round(h * S), channels: 3, background: '#fff' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: Math.round(w * S) + 8, top: 0 }]).png().toFile(out);

// base vs head row-3 close-ups (cells 0,1,4,5) + gameplay cell 0 at 1:1 and at 64 px: node ... <dir> <sid>
import sharp from 'sharp';
const [D, sid] = process.argv.slice(2);
const out = [];
let y = 0;
for (const v of ['base', 'head']) {
  const f = `${D}/${v}_${sid}.png`; let x = 0;
  for (const c of [0, 1, 4, 5]) { out.push({ input: await sharp(f).extract({ left: c * 360, top: 720, width: 360, height: 360 }).png().toBuffer(), left: x, top: y }); x += 364; }
  const g = await sharp(f).extract({ left: 0, top: 0, width: 360, height: 360 }).extract({ left: 90, top: 90, width: 180, height: 180 }).png().toBuffer();
  out.push({ input: g, left: x, top: y });
  out.push({ input: await sharp(g).resize(64, 64).png().toBuffer(), left: x + 184, top: y });
  out.push({ input: await sharp(g).resize(128, 128).png().toBuffer(), left: x + 184, top: y + 70 });
  y += 364;
}
await sharp({ create: { width: 364 * 4 + 184 + 132, height: y, channels: 3, background: '#fff' } }).composite(out).jpeg({ quality: 88 }).toFile(`${D}/ab_${sid}.jpg`);

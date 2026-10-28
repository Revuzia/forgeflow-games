import { open } from './pw.mjs';
import { createHash } from 'node:crypto';
const { browser, page } = await open('/?dev=1', { width: 1200, height: 900 });
await page.waitForTimeout(2500);
const feats = ['normal', "'zero' 0", "'zero' 1", "'ss01' 1", "'ss02' 1", "'ss03' 1", "'ss04' 1", "'ss05' 1", "'ss06' 1", "'ss07' 1", "'salt' 1", "'cv01' 1", "'cv02' 1", "'cv03' 1", "'cv04' 1", "'onum' 1"];
const fams = ['Atkinson Hyperlegible Next', 'Atkinson Hyperlegible Mono', 'Instrument Sans Variable'];
await page.evaluate(({ feats, fams }) => {
  const box = document.createElement('div');
  box.id = 'zprobe';
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:grid;grid-template-columns:repeat(16,70px);gap:2px;padding:4px';
  for (const fam of fams) for (const f of feats) {
    const el = document.createElement('div');
    el.textContent = '0';
    el.style.cssText = `font-family:'${fam}';font-size:56px;line-height:70px;height:70px;text-align:center;color:#000;font-feature-settings:${f}`;
    box.appendChild(el);
  }
  document.body.appendChild(box);
}, { feats, fams });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const cells = await page.locator('#zprobe > div').all();
let i = 0;
const res = {};
for (const fam of fams) {
  const row = {};
  for (const f of feats) { const b = await cells[i++].screenshot(); row[f] = createHash('md5').update(b).digest('hex').slice(0, 6); }
  res[fam] = row;
}
await page.locator('#zprobe').screenshot({ path: '_harness/_shots/fw_W2_zero_probe.png' });
console.log(JSON.stringify(res, null, 1));
await browser.close();

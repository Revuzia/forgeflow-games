// R10 LOCOMOTION: the crawl's browser filmstrip (one heavy job). The real game at Home (?dev=1), LIFE's autonomy off so the walk is scripted,
// the play body walks by scootTo (LIFE's own travel driver) and frames are captured over a crawl cycle: from the game camera and side-on.
//   node _harness/crawl_film.mjs [--port 5356] [--w 1280 --h 800] [--genome seed] [--out dir] [--tag name] [--every 6] [--frames 48] [--crawl 0|1]
import { startVite, launch } from './pw.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 5356)), W = Number(arg('w', 1280)), Hh = Number(arg('h', 800));
const OUT = resolve(arg('out', '_shots/crawl')), TAG = arg('tag', `${W}x${Hh}`), EVERY = Number(arg('every', 6)), FRAMES = Number(arg('frames', 48));
const GENOMES = String(arg('fam', '')).split(',').filter(Boolean);
const CRAWL_ON = arg('crawl', '1') !== '0', SIDE = arg('side', '1') !== '0', DIST = Number(arg('dist', 1.0)), PLACE = arg('place', ''), LIFE = arg('life', '0') === '1';
mkdirSync(OUT, { recursive: true });
const vite = await startVite(PORT);
const browser = await launch();
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${vite.url}?dev=1`, { waitUntil: 'load' });
  await page.waitForSelector('.cta:not([disabled])', { timeout: 120000 });
  const b = await page.locator('.cta').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 60000 });
  await page.evaluate(async () => {
    const pm = await import('/src/physics/props.ts');
    const cm = await import('/src/physics/crawl.ts');
    window.__CR__ = cm;
    const orig = pm.PropWorld.prototype.beginFrame;
    pm.PropWorld.prototype.beginFrame = function () { window.__PW__ = this; return orig.call(this); };
  });
  // wait for the life chunk and its world (step the game: the dev hook pauses the rAF loop)
  for (let k = 0; k < 400; k++) {
    const ok = await page.evaluate(() => { window.__WH__.step(1 / 60, 10); return !!(window.__PW__ && window.__PW__.bodies && window.__PW__.bodies.length > 0); });
    if (ok) break;
    await page.waitForTimeout(50);
  }
  if (PLACE) { const ok = await page.evaluate((p) => window.__WH__.travel(p, true), PLACE); console.log(`travel ${PLACE}: ${ok}`); for (let k = 0; k < 40; k++) { await page.evaluate(() => window.__WH__.step(1 / 60, 10)); await page.waitForTimeout(30); } }
  const grab = async (file) => { const url = await page.evaluate(() => { const st = window.__WH__.shell.stageObj(); st.render(); return st.canvas.toDataURL('image/png'); }); writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); };
  if (LIFE) {
    // LIFE drives (autonomy on): step until a squishy crawls on its own, then film it
    let who = -1;
    for (let k = 0; k < 900 && who < 0; k++) {
      who = await page.evaluate(() => { window.__WH__.step(1 / 60, 6); const w = window.__PW__; if (!w) return -1; for (let i = 0; i < w.crawls.length; i++) if (w.crawls[i].on && w.crawls[i].s[1] > 0.85) return i; return -1; });
      if (k % 20 === 0) await page.waitForTimeout(10);
    }
    console.log(`life: crawler ${who}`);
    if (who >= 0) {
      const name = `${TAG}_life${PLACE ? '_' + PLACE : ''}`;
      for (let f = 0; f < FRAMES; f += EVERY) {
        const idx = String(f).padStart(3, '0');
        const s = await page.evaluate((i) => { const w = window.__PW__, bd = w.bodies[i], c = w.crawls[i]; return { fam: bd.family, x: bd.center.x, z: bd.center.z, on: c.on, a: c.s[1], ph: c.s[0] }; }, who);
        await grab(`${OUT}/${name}_game_${idx}.png`);
        if (SIDE) {
          await page.evaluate((i) => {
            const st = window.__WH__.shell.stageObj(), cam = st.camera, w = window.__PW__, bd = w.bodies[i], c = w.crawls[i];
            if (!window.__SIDE__) { const ux = c.s[2], uz = c.s[3], cx = bd.center.x + ux * 0.25, cz = bd.center.z + uz * 0.25; window.__SIDE__ = { x: cx - uz * 4.6, z: cz + ux * 4.6, lx: cx, lz: cz }; }
            window.__CAM__ = { p: cam.position.clone(), q: cam.quaternion.clone() };
            const S = window.__SIDE__; cam.position.set(S.x, 0.45, S.z); cam.lookAt(S.lx, 0.4, S.lz); cam.updateMatrixWorld();
          }, who);
          await grab(`${OUT}/${name}_side_${idx}.png`);
          await page.evaluate(() => { const cam = window.__WH__.shell.stageObj().camera; cam.position.copy(window.__CAM__.p); cam.quaternion.copy(window.__CAM__.q); cam.updateMatrixWorld(); });
        }
        console.log(`  frame ${idx} ${s.fam} x ${s.x.toFixed(3)} z ${s.z.toFixed(3)} on ${s.on} amp ${s.a.toFixed(2)} phase ${s.ph.toFixed(2)}`);
        await page.evaluate((e) => window.__WH__.step(1 / 60, e), EVERY);
      }
    }
  }
  if (!LIFE) await page.evaluate(() => window.__WH__.setSetting('autonomy', false));
  const list = LIFE ? [] : GENOMES.length ? GENOMES : [''];
  for (const gn of list) {
    if (gn) {
      const sp = await page.evaluate(async (fam) => {
        const gm = await import('/src/core/genome.ts'), cm = await import('/src/data/catalog.ts');
        const s = cm.CATALOG.find((d) => cm.familyOf(d.id) === fam);
        if (!s) return null;
        window.__WH__.setGenome(gm.encodeGenome({ ...gm.makeStarterGenome(), species: s.id }));
        return s.id;
      }, gn);
      console.log(`family ${gn}: species ${sp}`);
      await page.evaluate(() => window.__WH__.step(1 / 60, 150));
    }
    const info = await page.evaluate(([on, dist]) => {
      window.__CR__.CRAWL.on = on;
      const w = window.__PW__, bd = w.bodies[0];
      window.__WH__.step(1 / 60, 30);
      const c = bd.center, sp = { slowrise: 0.18, marshmallow: 0.22, mochidough: 0.18, jellygel: 0.26, waterfill: 0.22, putty: 0.12, stickystretch: 0.2, slimegoo: 0.1, firmsilicone: 0.32, popdome: 0.28, gummy: 0.28, beadsqueeze: 0.22 }[bd.family] ?? 0.2;
      window.__T__ = { x0: c.x, z0: c.z, sp, dist };
      bd.scootTo(c.x + dist, c.z, sp);
      return { family: bd.family, x: c.x, z: c.z, sp, n: bd.n, R: bd.restRadius };
    }, [CRAWL_ON, DIST]);
    console.log(`body ${JSON.stringify(info)}`);
    // walk in: 0.6 s, then the film
    await page.evaluate(() => window.__WH__.step(1 / 60, 36));
    const name = `${TAG}_${info.family}${CRAWL_ON ? '' : '_glide'}`;
    for (let f = 0; f < FRAMES; f += EVERY) {
      const s = await page.evaluate(() => { const bd = window.__PW__.bodies[0]; const c = window.__PW__.crawls[0]; return { x: bd.center.x, ph: c ? c.s[0] : 0, a: c ? c.s[1] : 0 }; });
      const idx = String(f).padStart(3, '0');
      await grab(`${OUT}/${name}_game_${idx}.png`);
      if (SIDE) {
        // side-on: the stage camera moved level with the body, square to the travel, for this one picture (put back after)
        await page.evaluate(() => {
          const st = window.__WH__.shell.stageObj(), cam = st.camera, bd = window.__PW__.bodies[0], c = bd.center;
          window.__CAM__ = { p: cam.position.clone(), q: cam.quaternion.clone() };
          const mx = window.__T__.x0 + window.__T__.dist * 0.5;
          cam.position.set(mx, 0.42, window.__T__.z0 + 5.2); cam.lookAt(mx, 0.42, window.__T__.z0); cam.updateMatrixWorld();
        });
        await grab(`${OUT}/${name}_side_${idx}.png`);
        await page.evaluate(() => { const cam = window.__WH__.shell.stageObj().camera; cam.position.copy(window.__CAM__.p); cam.quaternion.copy(window.__CAM__.q); cam.updateMatrixWorld(); });
      }
      console.log(`  frame ${idx} x ${s.x.toFixed(3)} phase ${s.ph.toFixed(2)} amp ${s.a.toFixed(2)}`);
      await page.evaluate((e) => window.__WH__.step(1 / 60, e), EVERY);
    }
    await page.evaluate(() => { const bd = window.__PW__.bodies[0]; bd.scootTo(NaN, 0, 0); bd.setHome(bd.center.x, bd.center.z); window.__WH__.step(1 / 60, 90); });
  }
} finally {
  await browser.close();
  vite.stop();
  console.log(`problems: ${problems.length}${problems.length ? '\n  ' + problems.slice(0, 5).join('\n  ') : ''}`);
}

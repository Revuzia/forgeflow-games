// UI B6a: the trophies and the portal bridge in the REAL game, inside the portal's exact iframe (sandbox and allow strings), against the LOCAL stand-in host
// (_harness/portal/bridge_host.html). Dev server only (the debug hook drives real pointer events through the real physics; no real portal, R2 or Supabase is ever called).
//   node _harness/portal/portal_check.mjs [--only=standalone,signed,guest,silent,phone] [--port=5440]
// Sections: standalone (no parent frame: no forgeflow message at all, trophies still saved) | signed (888x500, signed in: whoami answered, the real squeeze / pull /
// capsule / cut / reconnect earn their trophies, each posted once with the memo's shape >= 1 s apart, the host's "server" accepted exactly those, no name or id in the
// game, a reload re-posts once per page and the server stays idempotent) | guest (only whoami; a later sign-in catches up) | silent (3 probes 4 s apart, then quiet; a
// later sign-in catches up) | phone (358x201 box boots and posts). Ports 5440-5449 only; one browser; everything started is stopped.
import { launch, startVite } from '../pw.mjs';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const PORT = Number(opt('port', '5440'));
const ONLY = opt('only').split(',').filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const stamp = (m) => console.log(`     .. ${((Date.now() - T0) / 1000).toFixed(0)} s  ${m}`);
let total = 0, bad = 0, section = '';
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${section}] ${name}${extra !== '' ? '  ' + extra : ''}`); };
const SANDBOX = 'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms';
const ALLOW = 'autoplay; fullscreen; gamepad; pointer-lock';
const ACH_KEY = 'wobblehoard:v1:ach';
const GAME = encodeURIComponent('../../index.html?dev=1&rseed=7');

let browser, vite;
const errsOf = [];

async function openHost({ mode = 'signed', size = '888x500' } = {}) {
  const context = await browser.newContext({ viewport: { width: 980, height: 780 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => { addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); }); });
  const page = await context.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  errsOf.push(errs);
  await page.goto(`${vite.url}_harness/portal/bridge_host.html?mode=${mode}&size=${size}&game=${GAME}`, { waitUntil: 'load' });
  const frame = await waitFrame(page);
  await frame.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  return { context, page, frame, errs };
}
async function waitFrame(page) {
  for (let i = 0; i < 200; i++) { const f = page.frames().find((x) => x !== page.mainFrame() && x.url().includes('index.html')); if (f) return f; await sleep(100); }
  throw new Error('the game frame did not appear');
}
const playNow = async (frame) => { await frame.locator('.cta').click({ force: true }); await frame.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 }); };
/** a real squeeze on the dome: down for 96 sim steps, then up (the physics emits 'release' with heldFor ~1.6 s). step(dt, n) renders ONCE per call, so batch it. */
const squeeze = (frame) => frame.evaluate(() => {
  const wh = window.__WH__; const B = wh.bodyScreen(); wh.pause(); wh.step(1 / 60, 30);
  wh.pointerDown(B.x, B.y - 0.45 * B.rPx / innerHeight);
  wh.step(1 / 60, 96);
  wh.pointerUp(); wh.step(1 / 60, 20);
  return wh.state().events.filter((e) => e.kind === 'release').map((e) => ({ i: e.intensity, h: e.heldFor }));
});
/** a real pull from the right shoulder, `n` drags outward, then let go; reports every snap and whether the body was ever carried (sampled every few steps) */
const pull = (frame, n) => frame.evaluate((n) => {
  const wh = window.__WH__; const B = wh.bodyScreen(); wh.pause(); wh.step(1 / 60, 10);
  const rr = B.rPx / innerWidth; let carried = false;
  const look = () => { if (wh.state().metrics.carried) carried = true; };
  wh.pointerDown(B.x + 0.62 * rr, B.y - 0.04); wh.step(1 / 60, 8);
  for (let i = 1; i <= n; i++) { wh.pointerMove(B.x + 0.62 * rr + i * 0.022, B.y - 0.04 - i * 0.006); wh.step(1 / 60, 3); look(); }
  for (let k = 0; k < 5; k++) { wh.step(1 / 60, 8); look(); }
  wh.pointerUp();
  for (let k = 0; k < 3; k++) { wh.step(1 / 60, 10); look(); }
  wh.step(1 / 60, 120);
  return { snaps: wh.state().events.filter((e) => e.kind === 'snap').map((e) => e.intensity), carried };
}, n);
const bridge = (page) => page.evaluate(() => ({
  log: window.__BRIDGE.log, unlocked: window.__BRIDGE.unlocked, xp: window.__BRIDGE.xp, dupes: window.__BRIDGE.dupes, unknown: window.__BRIDGE.unknown, dropped: window.__BRIDGE.dropped, mode: window.__BRIDGE.mode,
}));
const inMsgs = (b, type) => b.log.filter((x) => x.dir === 'in' && x.type === type);
const achPosts = (b) => inMsgs(b, 'forgeflow:achievement');
const slugsOf = (b) => achPosts(b).map((x) => x.msg.achievementSlug);
const ach = (frame) => frame.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, ACH_KEY);
const gapsOf = (posts) => posts.slice(1).map((p, i) => p.t - posts[i].t);
const eqSet = (a, b) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join();

async function main() {
  vite = await startVite(PORT);
  browser = await launch();
  try {
    // ───────────────────────────────────────────────── standalone
    if (want('standalone')) {
      section = 'standalone';
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await context.addInitScript(() => {
        window.__fw = [];
        addEventListener('message', (e) => { if (e.data && typeof e.data === 'object' && typeof e.data.type === 'string' && e.data.type.startsWith('forgeflow:')) window.__fw.push(e.data); });
        addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); });
      });
      const page = await context.newPage();
      const errs = []; errsOf.push(errs);
      page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await page.goto(`${vite.url}index.html?dev=1&rseed=7`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      check('top-level page: window.parent is the window itself (no frame)', await page.evaluate(() => window.parent === window));
      await playNow(page.mainFrame());
      await squeeze(page.mainFrame());
      await sleep(5000);
      const fw = await page.evaluate(() => window.__fw);
      const saved = await ach(page.mainFrame());
      check('standalone: no forgeflow message of any kind is posted (not even whoami) after a real squeeze and 5 s', fw.length === 0, `${fw.length} messages`);
      check('standalone: the trophy is still earned and saved on this device under wobblehoard:v1:ach (first_squish)', !!saved && saved.v === 1 && 'first_squish' in saved.earned && saved.counters.squeezes >= 1, JSON.stringify(saved && saved.earned));
      check('standalone: no CSP violation and no console error', (await page.evaluate(() => window.__csp || [])).length === 0 && errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────── signed in, 888x500
    if (want('signed')) {
      section = 'signed';
      const { context, page, frame, errs } = await openHost({ mode: 'signed', size: '888x500' });
      const attrs = await page.evaluate(() => { const f = document.querySelector('iframe'); return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), w: f.clientWidth, h: f.clientHeight }; });
      check('the frame has the portal\'s exact sandbox and allow strings at 888x500', attrs.sandbox === SANDBOX && attrs.allow === ALLOW && attrs.w === 888 && attrs.h === 500, JSON.stringify(attrs));
      await sleep(800);
      let b = await bridge(page);
      const who = inMsgs(b, 'forgeflow:whoami');
      const idOut = b.log.filter((x) => x.dir === 'out' && x.type === 'forgeflow:identity');
      check('boot: the game asked who is signed in (one whoami, with a _reqId, from its own frame) and the host answered with the same _reqId', who.length === 1 && who[0].fromGame && typeof who[0].msg._reqId === 'string' && Object.keys(who[0].msg).sort().join() === '_reqId,type' && idOut.length === 1 && idOut[0].msg._reqId === who[0].msg._reqId && idOut[0].msg.signedIn === true, JSON.stringify(who[0] && who[0].msg));
      check('nothing but whoami has been sent before the player does anything', b.log.filter((x) => x.dir === 'in').length === 1);
      await playNow(frame);
      const t0 = Date.now();
      const rel = await squeeze(frame); stamp('squeeze done');
      const p1 = await pull(frame, 12); stamp('pull 1 done');
      const tPull = Date.now();
      const maxSnap = Math.max(0, ...p1.snaps);
      // a very long drag: past the body's limit the physics may carry it (a throw); whatever happens is read back from the events and compared with what was posted
      const p2 = await pull(frame, 24); stamp('pull 2 done');
      const maxSnap2 = Math.max(0, ...p2.snaps);
      // a capsule through the real meter and the real openCapsule call (the observer wraps it)
      const granted = await frame.evaluate(() => window.__WH__.shell.grant(1));
      await frame.evaluate(() => { void window.__WH__.shell.openCapsule(); });   // not awaited: the reveal ceremony needs the steps below (the result is decided at once)
      await frame.evaluate(() => { window.__WH__.step(1 / 60, 400); });
      const opened = await frame.evaluate(() => window.__WH__.shell.hoardState().items.filter((i) => i.origin === 'drop').map((i) => i.tier)); stamp('capsule opened');
      // a real Cut-tool cut (the true cut builds its two pieces over sim steps) and a real Reconnect all
      await frame.locator('.dock-tool[data-tool="cut"]').click();
      const cutRes = await frame.evaluate(() => { const r = window.__WH__.shell.cutSwipe(0.30, 0.52, 0.70, 0.52); window.__WH__.step(1 / 60, 260); return { r, pieces: window.__WH__.shell.tools().pieces }; });
      stamp('cut done');
      let rejoined = null;
      if (cutRes.pieces >= 2) {
        await frame.getByRole('button', { name: /reconnect all/i }).click();
        rejoined = await frame.evaluate(() => { window.__WH__.step(1 / 60, 300); return window.__WH__.shell.tools().pieces; });
      }
      await sleep(25_000);   // the pacer posts one every 1.1 s; the bridge clock is real time
      b = await bridge(page);
      const posted = slugsOf(b);
      const posts = achPosts(b);
      const allIn = b.log.filter((x) => x.dir === 'in');
      const required = ['first_squish', 'first_stretch', 'first_capsule'].concat(cutRes.pieces >= 2 ? ['first_cut'] : []).concat(rejoined === 1 ? ['whole_again'] : []);
      const tierOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
      const topTier = Math.max(...opened.map((t) => tierOrder.indexOf(t)), 0);
      const allowedExtra = new Set(['medley']);
      if (Math.max(maxSnap, maxSnap2) >= 0.95) allowedExtra.add('full_stretch');
      if (p1.carried || p2.carried) allowedExtra.add('lift_toss');
      if (topTier >= 2) allowedExtra.add('rare_find'); if (topTier >= 3) allowedExtra.add('epic_find'); if (topTier >= 4) allowedExtra.add('legendary_find'); if (topTier >= 5) allowedExtra.add('mythic_find');
      check('the real events earned the trophies: a squeeze held ' + (rel[0] ? rel[0].h.toFixed(2) + ' s' : '?') + ', a pull to ' + maxSnap.toFixed(2) + ' (then ' + maxSnap2.toFixed(2) + '), a capsule (' + opened.join(',') + '), a cut to ' + cutRes.pieces + ' pieces, back to ' + rejoined,
        required.every((s) => posted.includes(s)), `posted [${posted.join(',')}] required [${required.join(',')}]`);
      check('every posted trophy is justified by what the game measured (full_stretch only after a pull of 0.95+, lift_toss only after a carry, finds only up to the opened tier); nothing else', posted.every((s) => required.includes(s) || allowedExtra.has(s)) && (maxSnap >= 0.95 || maxSnap2 >= 0.95 ? posted.includes('full_stretch') : !posted.includes('full_stretch')), `extras [${posted.filter((s) => !required.includes(s)).join(',')}] carried ${p1.carried}/${p2.carried}`);
      check('each trophy was posted exactly once in this page', new Set(posted).size === posted.length);
      check('consecutive trophy posts are >= 1 s apart (host clock)', gapsOf(posts).every((g) => g >= 1000), `gaps [${gapsOf(posts).join(',')}]`);
      const keysOK = posts.every((p) => Object.keys(p.msg).sort().join() === 'achievementSlug,type' && typeof p.msg.achievementSlug === 'string' && p.fromGame);
      const types = new Set(allIn.map((x) => x.type));
      check('every message the game sent has the memo\'s shape and only whoami and achievement exist (no score, save, load, game_over)', keysOK && eqSet([...types], ['forgeflow:whoami', 'forgeflow:achievement']) && allIn.length === 1 + posts.length, [...types].join());
      check('the "server" (host) accepted exactly the posted set once each: unlocked = posted, no duplicates, no unknown slug, XP = the rows\' points', eqSet(Object.keys(b.unlocked), posted) && b.dupes === 0 && b.unknown.length === 0 && b.xp === Object.values(b.unlocked).reduce((n, u) => n + u.points, 0) && b.xp > 0, `xp ${b.xp}`);
      const saved = await ach(frame);
      check('the earned set on this device equals what was posted (signed in: nothing earned stays unposted)', !!saved && eqSet(Object.keys(saved.earned), posted), JSON.stringify(saved && Object.keys(saved.earned)));
      const leak = await frame.evaluate((u) => { const h = document.documentElement.outerHTML + JSON.stringify({ ...localStorage }) + document.body.innerText; return [u.username, u.id, u.avatar_url, '0000005b0055'].filter((s) => s && h.includes(s)); }, await page.evaluate(() => window.__BRIDGE.USER));
      check('the game never shows or stores the account name, avatar or id (DOM, aria, titles, localStorage all scanned)', leak.length === 0, leak.join(','));
      check('strict CSP: no violation in the frame; no console error or page error in the host or the game', (await frame.evaluate(() => window.__csp || [])).length === 0 && errs.length === 0, errs.slice(0, 3).join(' | '));
      // a reload (a new page): every earned slug is posted once more, once, and the server stays idempotent
      const nBefore = posts.length;
      const idxBefore = b.log.length;
      await page.evaluate(() => { document.querySelector('iframe').contentWindow.location.reload(); });
      await sleep(3000);
      const fr2 = await waitFrame(page);
      await fr2.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await sleep(1200 * (nBefore + 2));
      const b2 = await bridge(page);
      const after = b2.log.slice(idxBefore).filter((x) => x.dir === 'in' && x.type === 'forgeflow:achievement');
      const afterSlugs = after.map((x) => x.msg.achievementSlug);
      check('after a reload the new page posts every earned trophy once (catch-up), >= 1 s apart; the server counts them as duplicates and adds no XP', eqSet(afterSlugs, posted) && afterSlugs.length === posted.length && gapsOf(after).every((g) => g >= 1000) && b2.dupes === posted.length && b2.xp === b.xp, `${afterSlugs.length} re-posted, dupes ${b2.dupes}, xp ${b2.xp}`);
      await context.close();
    }

    // ───────────────────────────────────────────────── guest
    if (want('guest')) {
      section = 'guest';
      const { context, page, frame, errs } = await openHost({ mode: 'guest', size: '888x500' });
      await sleep(600);
      await playNow(frame);
      await squeeze(frame);
      await sleep(6000);
      let b = await bridge(page);
      const saved = await ach(frame);
      check('a guest: whoami answered with signedIn:false, no trophy message at all, yet the trophy is earned and saved on the device', inMsgs(b, 'forgeflow:whoami').length === 1 && b.log.filter((x) => x.dir === 'in').length === 1 && b.log.find((x) => x.dir === 'out' && x.type === 'forgeflow:identity').msg.signedIn === false && !!saved && 'first_squish' in saved.earned, JSON.stringify(saved && saved.earned));
      await page.evaluate(() => window.__BRIDGE.setMode('signed'));
      await sleep(3000);
      b = await bridge(page);
      check('signing in later (a pushed identity, no _reqId) posts the trophies earned as a guest, once', eqSet(slugsOf(b), Object.keys(saved.earned)) && slugsOf(b).length === Object.keys(saved.earned).length && b.xp > 0, slugsOf(b).join());
      await page.evaluate(() => window.__BRIDGE.setMode('guest'));
      await sleep(500);
      check('signing out posts nothing and the game keeps running', (await bridge(page)).log.filter((x) => x.dir === 'in').length === 1 + slugsOf(b).length && errs.length === 0, errs.join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────── silent parent
    if (want('silent')) {
      section = 'silent';
      const { context, page, frame, errs } = await openHost({ mode: 'silent', size: '888x500' });
      await playNow(frame);
      await squeeze(frame);
      await sleep(14_000);
      let b = await bridge(page);
      const who = inMsgs(b, 'forgeflow:whoami');
      const gaps = gapsOf(who);
      check('a silent parent: exactly 3 whoami probes about 4 s apart, then nothing more, and no trophy post even though one was earned', who.length === 3 && gaps.every((g) => g > 3500 && g < 5500) && b.log.filter((x) => x.dir === 'in').length === 3, `probes ${who.length} gaps [${gaps.join(',')}]`);
      await page.evaluate(() => window.__BRIDGE.setMode('signed'));
      await sleep(3000);
      b = await bridge(page);
      check('a pushed sign-in still reaches a silent client: it catches up', slugsOf(b).includes('first_squish') && b.xp > 0, slugsOf(b).join());
      check('no console error', errs.length === 0, errs.join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────── portal phone
    if (want('phone')) {
      section = 'phone';
      const { context, page, frame, errs } = await openHost({ mode: 'signed', size: '358x201' });
      const attrs = await page.evaluate(() => { const f = document.querySelector('iframe'); return { w: f.clientWidth, h: f.clientHeight }; });
      await playNow(frame);
      await squeeze(frame);
      await sleep(4000);
      const b = await bridge(page);
      check('the 358x201 portal-phone box boots, earns and posts first_squish with no error', attrs.w === 358 && attrs.h === 201 && slugsOf(b).includes('first_squish') && errs.length === 0 && (await frame.evaluate(() => window.__csp || [])).length === 0, `${attrs.w}x${attrs.h} ${errs.join(' | ')}`);
      await context.close();
    }
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
    try { vite.stop(); } catch { /* ignore */ }
  }
  console.log(`\n${total - bad}/${total} checks passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); try { vite && vite.stop(); } catch { /* ignore */ } process.exit(2); });

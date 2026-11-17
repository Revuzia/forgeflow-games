// VALE harness - orch1 W2-E HUD capture (before / after of the same seeds and camera spots), 1920x1080 and 1366x768.
// Collects and measures; judges nothing. Uses ux_lib (Rec: heavy slot, paired shots, DOM scan).
//   UX_OUT=<dir> VALE_URL_DEV=http://localhost:<port> python3 art/blender/common/heavy.py run -- node _harness/w2e_capture.mjs <part>
// parts: rift (idle, ping wheel, fight + number meter, dead recap, scoreboard) | fray (hour board, draft helper, shop names) | post (postgame tables)
import { Rec, startQueue, driveFlow, deadline } from './ux_lib.mjs';

const DEV = process.env.VALE_URL_DEV ?? 'http://localhost:5299';
const part = process.argv[2] ?? 'rift';
const wait = (p, ms) => p.waitForTimeout(ms);
const homeReady = async (rec) => { await rec.page.waitForFunction(() => !!document.querySelector('.scr--home') && !!window.__vale, null, { timeout: 90000 }); await wait(rec.page, 1200); };
async function installWatch(rec) {
  await rec.V((v) => {
    const c = v.state.match.value; const w = (window.__uxw = { ev: [] });
    const me = () => c.view.players[c.you];
    c.onEvents((evs) => {
      const my = me()?.entity;
      for (const e of evs) {
        if (e.e === 'death' && e.dst === my) w.ev.push({ e: 'died', t: e.t });
        else if (e.e === 'damage' && (e.src === my || e.dst === my)) { const o = c.view.entity(e.src === my ? e.dst : e.src); w.ev.push({ e: 'dmg', t: e.t, other: o?.kind, dir: e.src === my ? 'out' : 'in' }); }
        if (w.ev.length > 400) w.ev.splice(0, 200);
      }
    });
  });
}
const poll = (rec) => rec.V((v) => {
  const c = v.state.match.value; if (!c) return null; const w = window.__uxw; const me = c.view.players[c.you]; const my = c.view.entity(me?.entity);
  let near = 0; if (my) for (const e of c.view.entities) if (e.kind === 'fighter' && e.alive && (e.x - my.x) ** 2 + (e.y - my.y) ** 2 < 100) near++;
  return { phase: c.view.phase, time: +c.view.time.toFixed(1), dead: (me?.respawnIn ?? 0) > 0, respawnIn: me?.respawnIn, near, ended: !!c.view.result, evs: w.ev.splice(0) };
});
const setScale = (rec, s) => rec.V((v, k) => v.state.match.value?.setTimeScale(k), s);
async function toMatch(rec, mode, queue, tag) {
  await startQueue(rec, mode, queue);
  await driveFlow(rec, tag + '_flow', { maxMs: 300000, cap: 0, paired: false });
  await rec.page.waitForFunction(() => !!window.__vale?.state?.match?.value, null, { timeout: 60000 });
  await installWatch(rec);
}
/** in-page meter: damage numbers (.wpop) vs the HP-bar plates the renderer published (globalThis.__valeHudPlates), sampled per frame */
const METER = () => new Promise((resolve) => {
  const out = { frames: 0, popsSeen: 0, overBarFull: 0, overBarSoft: 0, maxPerTarget: 0, plates: typeof globalThis.__valeHudPlates, samples: [] };
  const seen = new Set();
  let n = 0;
  const step = () => {
    const P = globalThis.__valeHudPlates;
    const pops = [...document.querySelectorAll('.wpop:not(.wpop--gold)')];
    const per = new Map();
    for (const el of pops) {
      const r = el.getBoundingClientRect(); const op = +getComputedStyle(el).opacity;
      if (!seen.has(el)) { seen.add(el); out.popsSeen++; }
      const tgt = el.dataset.dst; if (tgt) per.set(tgt, (per.get(tgt) ?? 0) + 1);
      if (P && op > 0.05) {
        for (const q of P.rects()) {
          const ox = Math.min(r.right, q.r) - Math.max(r.left, q.l), oy = Math.min(r.bottom, q.b) - Math.max(r.top, q.t);
          if (ox > 1 && oy > 1) { if (op > 0.99) out.overBarFull++; else out.overBarSoft++; break; }
        }
      }
    }
    for (const c of per.values()) out.maxPerTarget = Math.max(out.maxPerTarget, c);
    out.frames++;
    if (++n < 240) requestAnimationFrame(step); else resolve(out);
  };
  requestAnimationFrame(step);
});

async function rift() {
  const rec = new Rec('w2e_rift'); await rec.open('/?dev=1&autopilot=match&speed=1&seed=7', { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 1);
    await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => {});
    await wait(p, 1500);
    rec.step('idle'); await rec.snap2('idle', 'HUD at the fountain, match live');
    await rec.snap2('dial_crop', 'Dial Bar crop', { clipSel: '.hud__bottom' });
    await rec.snap2('topbar_crop', 'top bar crop', { clipSel: '.hud__top' });
    await rec.snap2('minimap_crop', 'minimap crop', { clipSel: '.hud__map' });
    await p.mouse.move(980, 520);
    await rec.snap2('ping_wheel', 'ping wheel (G held 0.5 s)', { before: async (pg) => { await pg.mouse.move(980, 520); await pg.keyboard.down('KeyG'); await pg.waitForTimeout(600); }, after: async (pg) => { await pg.keyboard.up('KeyG'); } });
    await p.mouse.click(1250, 420, { button: 'right' });
    await rec.snap1('click_marker', 'right-click move marker, shot as soon as the click returns');
    await setScale(rec, 4);
    const got = new Set(); const t0 = Date.now(); let st;
    while (Date.now() - t0 < 12 * 60 * 1000) {
      await wait(p, 200); st = await poll(rec); if (!st || st.ended) break;
      const out = st.evs.some((x) => x.e === 'dmg' && x.dir === 'out' && x.other === 'fighter');
      if (out && !got.has('fight')) {
        got.add('fight'); await setScale(rec, 1);
        const m = await p.evaluate(METER); rec.obs('number meter 4 s at x1 (frames, pops seen, pops over a bar at full alpha / reduced alpha, max per target, plates api)', m);
        await setScale(rec, 0); rec.step('fight'); await rec.snap2('fight', `first outgoing fighter damage (sim paused, t=${st.time})`);
        await setScale(rec, 1); await wait(p, 500); await rec.snap2('fight_live', 'same fight 0.5 s later, sim x1');
        await setScale(rec, 4);
      }
      if (st.near >= 4 && st.time > 120 && !got.has('teamfight')) {
        got.add('teamfight'); await setScale(rec, 1); const m = await p.evaluate(METER); rec.obs('number meter in the teamfight', m);
        await setScale(rec, 0); rec.step('teamfight'); await rec.snap2('teamfight', `${st.near} fighters within 10 m (paused, t=${st.time})`); await setScale(rec, 4);
      }
      if (st.dead && !got.has('dead')) {
        got.add('dead'); await setScale(rec, 1); rec.step('dead'); await wait(p, 1700);
        await rec.snap2('dead_recap', `dead, respawn in ${st.respawnIn?.toFixed?.(1)} s (x1; t=${st.time})`);
        await wait(p, 1500); await rec.snap2('dead_later', 'dead, 3 s after the death');
        await setScale(rec, 4);
      }
      if (st.time > 330 && !got.has('late')) { got.add('late'); await setScale(rec, 0); rec.step('late'); await rec.snap2('midgame', `HUD at ${st.time}s`); await rec.snap2('scoreboard', 'scoreboard held (Tab)', { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } }); await setScale(rec, 4); }
      if (['fight', 'dead', 'late', 'teamfight'].every((k) => got.has(k))) break;
      if (st.time > 900 && got.size >= 3) break;
    }
    rec.obs('captured', [...got]); rec.obs('last poll', st);
  } catch (e) { rec.obs('rift failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

async function fray() {
  const rec = new Rec('w2e_fray'); await rec.open('/?dev=1&autopilot=match&speed=1&seed=7', { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await startQueue(rec, 'fray', 'Standard');
    let shot = false;
    await driveFlow(rec, 'fray_flow', { maxMs: 300000, cap: 0, paired: false, until: async (st) => { if (st.scr === 'scr--draft' && !shot) { shot = true; await wait(p, 900); await rec.snap2('fray_draft', 'FRAY draft screen'); } return false; } });
    await p.waitForFunction(() => !!window.__vale?.state?.match?.value, null, { timeout: 60000 });
    await installWatch(rec); await setScale(rec, 1);
    await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => {});
    await wait(p, 1500);
    rec.step('hour'); await rec.snap2('fray_idle', 'FRAY HUD (hour board and chips)');
    await rec.snap2('fray_scoreboard', 'FRAY scoreboard held', { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } });
    await p.keyboard.press('KeyP'); await wait(p, 900); await rec.snap2('fray_shop', 'shop open'); await p.keyboard.press('KeyP');
  } catch (e) { rec.obs('fray failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

async function post() {
  const rec = new Rec('w2e_post'); await rec.open('/?dev=1&autopilot=match&speed=1&seed=7', { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 16);
    const t0 = Date.now();
    while (Date.now() - t0 < 14 * 60 * 1000) { await wait(p, 500); const st = await poll(rec); if (!st || st.ended) break; }
    await p.waitForFunction(() => !!document.querySelector('.scr--postgame'), null, { timeout: 90000 }).catch(() => rec.obs('postgame never appeared'));
    await wait(p, 2200);
    await rec.snap2('postgame_summary', 'postgame default tab');
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.scr--postgame [role=tab]')].map((t) => (t.innerText || '').trim()));
    for (const l of tabs) { try { await p.locator('.scr--postgame [role=tab]', { hasText: l }).first().click({ timeout: 3000 }); await wait(p, 700); await rec.snap2('postgame_' + l.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16), `postgame tab ${l}`); } catch { /* none */ } }
  } catch (e) { rec.obs('post failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

/** the death recap in its first and settled frames (seed 11 reaches a death; same route as ux_run dead) */
async function dead() {
  const rec = new Rec('w2e_dead'); await rec.open(`/?dev=1&autopilot=match&speed=1&seed=${process.env.W2E_SEED ?? '11'}`, { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 8);
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < 14 * 60 * 1000) {
      await wait(p, 200); st = await poll(rec); if (!st || st.ended) break;
      if (st.dead) {
        await setScale(rec, 1); rec.step('dead'); await wait(p, 1700);
        await rec.snap2('dead_recap', `dead, respawn in ${st.respawnIn?.toFixed?.(1)} s, 1.7 s after the death (x1; t=${st.time})`);
        await wait(p, 1500); await rec.snap2('dead_later', 'dead, 3 s after the death');
        const hasMore = await p.evaluate(() => !!document.querySelector('.recap__more'));
        if (hasMore) { await p.locator('.recap__more').click().catch(() => {}); await wait(p, 300); await rec.snap2('dead_recap_expanded', 'recap with all sources shown'); }
        await p.keyboard.press('KeyP'); await wait(p, 800); await rec.snap2('dead_shop', 'shop opened while dead'); await p.keyboard.press('KeyP');
        rec.obs('death', { time: st.time, respawnIn: st.respawnIn });
        break;
      }
    }
    rec.obs('last poll', st);
  } catch (e) { rec.obs('dead failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

const parts = { rift, fray, post, dead };
if (!parts[part]) { console.error('part? ' + Object.keys(parts).join(' | ')); process.exit(2); }
await deadline(part, 40 * 60 * 1000, parts[part]);
process.exit(0);

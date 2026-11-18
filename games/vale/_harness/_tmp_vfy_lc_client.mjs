// verifier-only (look close r1): the real client (HUD on) on RIFT: a fight frame with damage numbers and the first kill banner.
//   UX_OUT=<dir> VALE_URL=http://localhost:<port> python3 art/blender/common/heavy.py run -- node _harness/_tmp_vfy_lc_client.mjs
import { Rec, startQueue, driveFlow } from './ux_lib.mjs';
const wait = (p, ms) => p.waitForTimeout(ms);
const rec = new Rec('vfy_lc', { vps: [['1920x1080', 1920, 1080]] });
await rec.open('/?dev=1&autopilot=match&speed=1&seed=7');
const p = rec.page;
await p.waitForFunction(() => !!document.querySelector('.scr--home') && !!window.__vale, null, { timeout: 90000 });
await wait(p, 1500);
await startQueue(rec, 'rift', 'Lantern Drill');
await driveFlow(rec, 'rift', { maxMs: 300000, cap: 0, paired: false });
await p.waitForFunction(() => !!window.__vale?.state?.match?.value, null, { timeout: 60000 });
const setScale = (k) => rec.V((v, s) => v.state.match.value?.setTimeScale(s), k);
const poll = () => rec.V((v) => { const c = v.state.match.value; if (!c) return null; const me = c.view.players[c.you]; const my = c.view.entity(me?.entity); let enemyNear = 0; if (my) for (const e of c.view.entities) if (e.kind === 'fighter' && e.alive && e.team !== my.team && (e.x - my.x) ** 2 + (e.y - my.y) ** 2 < 120) enemyNear++; return { time: +c.view.time.toFixed(1), dead: (me?.respawnIn ?? 0) > 0, enemyNear, ended: !!c.view.result, kill: !!document.querySelector('.announce.is-kill'), pops: document.querySelectorAll('.wpop:not(.wpop--gold)').length }; });
await setScale(6);
const got = new Set(); const t0 = Date.now(); const notes = [];
while (Date.now() - t0 < 12 * 60 * 1000 && got.size < 3) {
  await wait(p, 150); const st = await poll(); if (!st || st.ended) break;
  if (st.kill && !got.has('kill')) { got.add('kill'); await setScale(0); rec.step('kill'); await rec.snap1('kill_banner', `first kill banner t=${st.time}`); notes.push(['kill', st]); await setScale(6); }
  if (st.enemyNear >= 1 && st.time > 90 && !st.dead && !got.has('fight')) { got.add('fight'); await setScale(1); for (let i = 0; i < 12; i++) { await wait(p, 120); const s2 = await poll(); if (s2.pops >= 2) break; } await setScale(0); rec.step('fight'); await rec.snap1('fight_numbers', `fight with damage numbers t=${st.time}`); notes.push(['fight', await poll()]); await setScale(6); }
  if (st.enemyNear >= 1 && st.time > 300 && !st.dead && got.has('fight') && !got.has('fight2')) { got.add('fight2'); await setScale(1); await wait(p, 900); await setScale(0); rec.step('fight2'); await rec.snap1('fight_numbers_late', `later fight t=${st.time}`); notes.push(['fight2', await poll()]); await setScale(6); }
}
console.log(JSON.stringify(notes));
await rec.finish({ notes2: notes });

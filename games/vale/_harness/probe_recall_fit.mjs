// VALE harness — CW1 r2 (CW6 handoffs): the recall clip spans the whole recall channel once, and any clip played in the
// dash state rides the dash's progress (Marund's domefall_leap). The REAL client (dev server, real Chrome GPU, heavy slot):
// a RIFT co-op match, your seat drafted by the dev autopilot; every other seat muted.
//
//   recall   your fighter recalls (the sim's own command; RIFT recall 7 s). Every frame the actor's clip and the clip's
//            playback time are logged. done: the recall clip plays from 0 to its end ONCE over the channel (time rises
//            monotonically, no wrap back to the opening), its time tracks stateTime / stateDuration × clip duration
//            (max |error| ≤ 1 frame of clip time), and the last second of the channel is the clip's last seventh, not its
//            opening.
//   dash     the actor's own animate() is fed a dash-state view whose anim is a non-'dash' role (cast_a1 stands in
//            for Marund's domefall_leap: any clip but 'stunned') at progress 0, 0.25, 0.5, 0.75, 1: done: clip time ==
//            progress × clip duration.
//
//   node _harness/probe_recall_fit.mjs [--tag x]   → _harness/_reports/fw_CW1_recall_fit[_tag].json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const TAG = opt('tag', '');
const OUT = join(HERE, '_reports', `fw_CW1_recall_fit${TAG ? '_' + TAG : ''}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), recall: null, dash: null, pass: true, fails: [] };
const fail = (m) => { report.pass = false; report.fails.push(m); console.log('FAIL', m); };

const { browser, page } = await open('/?dev=1&autopilot=draft', { hmr: false });
try {
  const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
  const click = async (l) => { await l.waitFor({ state: 'visible', timeout: 30000 }); await frames(); await l.click({ timeout: 30000 }); };
  await page.waitForTimeout(2000);
  await click(page.locator('.nav__item', { hasText: 'Play' })); await page.waitForTimeout(500);
  await click(page.locator('.station', { hasText: 'RIFT' }).first()); await page.waitForTimeout(500);
  await click(page.locator('.qcard').filter({ hasText: /Lantern Drill|Co-op vs/ }).first()); await page.waitForTimeout(300);
  await click(page.getByRole('button', { name: 'Find match' }));
  await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
  const ready = page.getByRole('button', { name: /^Ready/ }); if (await ready.count()) await click(ready.first());
  await waitFor(page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
  await waitFor(page, (v) => v.state.match.value?.view.phase === 'live', 240000);
  await waitFor(page, (v) => { const c = v.state.match.value, R = v.state.renderer; const me = c.view.players.find((p) => p.player === c.you); const a = R.actors.get(me.entity); return !!a?.model; }, 60000);
  await page.waitForTimeout(1500);

  const setup = await vale(page, (v) => {
    const c = v.state.match.value, W = c.sim.world, R = v.state.renderer;
    const me = c.view.players.find((p) => p.player === c.you);
    const orig = W.command.bind(W);
    W.command = (p, cmd) => { if (p === c.you) orig(p, cmd); };
    const a = R.actors.get(me.entity);
    const L = { frames: [] };
    window.__RF = L;
    const tick = () => {
      requestAnimationFrame(tick);
      const ev = c.view.entity(me.entity);
      const act = a.current;
      L.frames.push({ key: a.currentKey, time: act ? act.time : null, dur: act ? act.getClip().duration : null, clip: act ? act.getClip().name : null,
        state: ev?.state, st: ev?.stateTime, sd: ev?.stateDuration });
      if (L.frames.length > 4000) L.frames.splice(0, 1000);
    };
    requestAnimationFrame(tick);
    return { me: me.entity, fighter: W.entity(me.entity).def?.id ?? '', recallClip: !!a.template?.clips.get(a.template.roles.recall ?? 'recall') };
  });
  report.setup = setup;
  console.log('setup', JSON.stringify(setup));

  // ── recall ──
  await vale(page, () => { window.__RF.frames.length = 0; });
  await vale(page, (v) => v.state.match.value.send({ type: 'recall' }));
  await page.waitForTimeout(7600);
  const fr = await vale(page, () => window.__RF.frames.filter((f) => f.state === 'recall'));
  const rec = fr.filter((f) => f.key === 'recall' && f.time !== null);
  let wraps = 0, maxErr = 0, n = 0;
  for (let i = 1; i < rec.length; i++) if (rec[i].time + 1e-3 < rec[i - 1].time) wraps++;
  for (const f of rec) { if (f.sd > 0) { const want = Math.min(f.dur - 1e-3, (f.st / f.sd) * f.dur); maxErr = Math.max(maxErr, Math.abs(f.time - want)); n++; } }
  const last = rec.filter((f) => f.sd > 0 && f.st >= f.sd - 1);
  const lastMin = last.length ? Math.min(...last.map((f) => f.time / f.dur)) : null;
  const sd = rec[0]?.sd ?? null, dur = rec[0]?.dur ?? null;
  report.recall = { frames: fr.length, recallFrames: rec.length, clip: rec[0]?.clip ?? null, clipDur: dur, channel: sd, wraps, maxErrS: +maxErr.toFixed(4),
    lastSecondMinFrac: lastMin === null ? null : +lastMin.toFixed(3), endFrac: rec.length ? +(rec[rec.length - 1].time / rec[rec.length - 1].dur).toFixed(3) : null,
    sample: rec.filter((_, i) => i % 30 === 0).map((f) => [+f.st.toFixed(2), +f.time.toFixed(3)]) };
  console.log('recall', JSON.stringify(report.recall));
  if (!setup.recallClip) console.log('(this fighter has no recall clip of its own: the fallback loops, not gated)');
  else {
    if (!rec.length) fail('no recall frames logged');
    if (wraps > 0) fail(`recall clip wrapped ${wraps}x during the channel`);
    if (maxErr > 1 / 30) fail(`recall clip time off the channel progress by ${maxErr.toFixed(3)} s`);
    if (lastMin !== null && lastMin < 6 / 7 - 0.03) fail(`the channel's last second plays clip fraction ${lastMin} (< 6/7: the opening replays)`);
  }

  // ── dash progress (actor.animate on a dash-state view with a non-'dash' role) ──
  report.dash = await vale(page, (v) => {
    const c = v.state.match.value, R = v.state.renderer;
    const me = c.view.players.find((p) => p.player === c.you);
    const a = R.actors.get(me.entity);
    const ev = c.view.entity(me.entity);
    const role = a.template?.clips.get(a.template.roles.cast_a1 ?? 'cast_a1') ? 'cast_a1' : 'attack1';
    const out = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const over = { state: 'dash', anim: role, stateTime: p * 0.6, stateDuration: 0.6, vx: 0, vy: 0 };
      const fake = new Proxy(ev, { get: (t, k) => (k in over ? over[k] : Reflect.get(t, k)) });
      a.animate(fake, 0, 0);
      const act = a.current;
      out.push({ p, key: a.currentKey, frac: act ? +(act.time / act.getClip().duration).toFixed(3) : null });
    }
    return { role, out };
  });
  console.log('dash', JSON.stringify(report.dash));
  for (const o of report.dash.out) if (o.frac === null || Math.abs(o.frac - o.p) > 0.01) fail(`dash-state ${report.dash.role} at progress ${o.p}: clip at ${o.frac}`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(report.pass ? 'PASS' : 'FAIL', OUT);
  await browser.close();
  process.exit(report.pass ? 0 : 1);
}

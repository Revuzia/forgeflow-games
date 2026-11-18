// VALE harness — lane W2-D live verify (ruling 54), real Chrome 1920x1080, real keys (Playwright -> CDP input):
//   migration   a stored profile with quickCast: true and no castModes loads as quick on every slot
//   release     quick cast with indicator: Q held 300 ms shows the aim and sends nothing; the cast is sent on the release
//               frame (the send happens in the same animation frame as the keyup, measured by a rAF counter)
//   buffer      Ardit's Lancing Run (windup 0.15 s + 7 m dash at 16 m/s), E pressed mid-dash (and 150 ms before its end):
//               the sim casts E within 2 ticks of the dash end
//   ring        held C: the attack-range ring radius = stats.range + body radius; the renderer's program count unchanged
//   level       Ctrl + E levels E up (default levelUpMod)
// node _harness/verify_w2d_live.mjs → _harness/_reports/w2d_live.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '_reports', 'w2d_live.json');
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), checks: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); };

const { browser, page, logs } = await open('/?dev=1', { hmr: false });
const sleep = (ms) => page.waitForTimeout(ms);
try {
  const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
  // ── migration: a stored quickCast: true profile without castModes ───────────────────────────────
  await sleep(1500);
  await page.evaluate(() => {
    const k = 'vale.profile.v1';
    const p = JSON.parse(localStorage.getItem(k));
    const c = (p.profile ?? p).settings.controls;
    delete c.castModes; c.quickCast = true;
    localStorage.setItem(k, JSON.stringify(p));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale, null, { timeout: 30000 });
  await sleep(1500);
  const mig = await vale(page, (v) => v.session.profile().settings.controls);
  check('migration: quickCast=true loads as quick on every slot', mig.castModes && Object.values(mig.castModes).length === 7 && Object.values(mig.castModes).every((m) => m === 'quick'), mig.castModes);
  // the lane's own setup: Q quick with indicator
  await vale(page, (v) => { const c = v.session.profile().settings.controls; v.session.updateSettings({ controls: { ...c, castModes: { ...c.castModes, a1: 'quickIndicator' } } }); });

  // ── a practice match as Ardit ──────────────────────────────────────────────────────────────────
  const click = async (l) => { await l.waitFor({ state: 'visible', timeout: 20000 }); await frames(); await l.click({ timeout: 20000 }); };
  const SCR = '.scr--practice:not(.is-leaving)';
  await click(page.locator('.nav__item', { hasText: 'Play' })); await sleep(500);
  await click(page.locator('.play__links button', { hasText: 'Practice' }));
  await waitFor(page, (v) => v.router.route.value.screen === 'practice', 10000);
  await sleep(800);
  let card = page.locator(`${SCR} .fcard`).filter({ hasText: 'Ardit' }).first();
  if (!(await card.count())) card = page.locator(`${SCR} .fcard[aria-label*="Ardit"]`).first();
  await click(card); await sleep(300);
  await click(page.getByRole('button', { name: 'Start practice' }));
  await waitFor(page, (v) => v.state.match.value?.view.phase === 'live', 180000);
  await waitFor(page, (v) => { const c = v.state.match.value, R = v.state.renderer; const me = c.view.players[c.you]; return !!R.actors.get(me.entity)?.model; }, 60000);
  await page.locator('.hud .dbar').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.mouse.move(1100, 520);
  await vale(page, (v) => {
    const c = v.state.match.value, W = c.sim.world, me = c.view.players[c.you];
    const orig = c.send.bind(c);
    window.__F = 0;
    const loop = () => { window.__F++; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__H = { cmds: [], ticks: [], keyups: [], me: me.entity };
    c.send = (cmd) => { window.__H.cmds.push({ f: window.__F, wall: performance.now(), t: W.time, tick: W.tick, cmd: JSON.parse(JSON.stringify(cmd)) }); orig(cmd); };
    window.__harness = (cmd) => orig(cmd);
    window.addEventListener('keyup', (e) => { window.__H.keyups.push({ code: e.code, f: window.__F, wall: performance.now(), n: window.__H.cmds.length }); }, { capture: true });
    const step = W.step.bind(W);
    W.step = (...a) => {
      const evs = step(...a);
      const e = W.entity(me.entity);
      const casts = evs.filter((x) => x.e === 'cast' && x.src === me.entity).map((x) => x.slot);
      window.__H.ticks.push({ tick: W.tick, t: W.time, dash: !!e?.dash, cast: e?.cast ? e.cast.phase : null, casts, pending: W.players[c.you].pendingCast ?? null });
      if (window.__H.ticks.length > 4000) window.__H.ticks.splice(0, 1000);
      return evs;
    };
    orig({ type: 'practice', action: 'toggleStructures' });
    for (let i = 0; i < 8; i++) orig({ type: 'practice', action: 'level' });
    orig({ type: 'practice', action: 'toggleCooldowns' });
  });
  await sleep(500);
  await vale(page, (v) => { for (const s of ['a1', 'a3', 'a1', 'a3', 'a2']) window.__harness({ type: 'levelUp', slot: s }); });
  await sleep(500);

  // ── level: Ctrl + W levels W up ─────────────────────────────────────────────────────────────────
  {
    const n0 = await vale(page, () => window.__H.cmds.length);
    await page.keyboard.down('ControlLeft'); await page.keyboard.press('KeyW'); await page.keyboard.up('ControlLeft');
    await sleep(200);
    const sent = await vale(page, (v, n) => window.__H.cmds.slice(n).map((c) => c.cmd), n0);
    check('Ctrl + W sends levelUp a2 and no cast', sent.some((c) => c.type === 'levelUp' && c.slot === 'a2') && !sent.some((c) => c.type === 'cast'), sent);
  }

  // ── ring: held C ────────────────────────────────────────────────────────────────────────────────
  {
    const before = await vale(page, (v) => ({ programs: v.state.renderer.stats().programs, info: v.state.renderer.renderer?.info?.programs?.length ?? null }));
    await page.keyboard.down('KeyC');
    await sleep(400);
    const on = await vale(page, (v) => { const c = v.state.match.value, R = v.state.renderer, e = c.sim.world.entity(c.view.players[c.you].entity); return { ring: R.rangeRing, want: e.stats.range + e.radius, x: e.x, y: e.y, programs: R.stats().programs, info: R.renderer?.info?.programs?.length ?? null }; });
    await page.screenshot({ path: join(HERE, '_shots', 'w2d_live_ring.png') }).catch(() => null);
    await page.keyboard.up('KeyC');
    await sleep(300);
    const off = await vale(page, (v) => ({ ring: v.state.renderer.rangeRing, programs: v.state.renderer.stats().programs }));
    check(`ring radius ${on.ring?.radius?.toFixed(3)} = stats.range + body radius ${on.want.toFixed(3)}`, !!on.ring && Math.abs(on.ring.radius - on.want) < 1e-6 && Math.hypot(on.ring.x - on.x, on.ring.y - on.y) < 1.0, on);
    check('…hidden on release', off.ring === null, off);
    check(`programs unchanged (${before.programs} -> ${on.programs} -> ${off.programs})`, before.programs === on.programs && on.programs === off.programs, { before, on: on.programs, off: off.programs });
    report.programs = { before, on: on.programs, off: off.programs };
  }

  // ── release + buffer: Q held 300 ms (aim, nothing sent), released (cast on the release frame); E mid-dash ──
  const trial = async (eDelayMs, label) => {
    await vale(page, () => window.__harness({ type: 'practice', action: 'heal' }));
    await sleep(600);
    const n0 = await vale(page, () => window.__H.cmds.length);
    const k0 = await vale(page, () => window.__H.keyups.length);
    await page.keyboard.down('KeyQ');
    await sleep(300);
    const held = await vale(page, (v, n) => ({ aim: !!v.state.renderer.aim, aiming: v.state.input?.aiming?.value?.slot ?? null, cast: window.__H.cmds.slice(n).filter((c) => c.cmd.type === 'cast').length }), n0);
    await page.keyboard.up('KeyQ');
    await sleep(eDelayMs);
    await page.keyboard.press('KeyE');
    await sleep(900);
    const r = await vale(page, (v, a) => ({ cmds: window.__H.cmds.slice(a.n0), keyups: window.__H.keyups.slice(a.k0), ticks: window.__H.ticks.slice(-140) }), { n0, k0 });
    const qUp = r.keyups.find((k) => k.code === 'KeyQ');
    const qCast = r.cmds.find((c) => c.cmd.type === 'cast' && c.cmd.slot === 'a1');
    const eCmd = r.cmds.find((c) => c.cmd.type === 'cast' && c.cmd.slot === 'a3');
    const t = r.ticks;
    const qTick = t.find((x) => x.casts.includes('a1'));
    let dashEnd = null;
    for (let i = 1; i < t.length; i++) if (qTick && t[i].tick > qTick.tick && t[i - 1].dash && !t[i].dash) { dashEnd = t[i].tick; break; }
    const eTick = t.find((x) => x.casts.includes('a3'));
    const busyAtPress = eCmd ? t.find((x) => x.tick === eCmd.tick + 1) : null;
    const res = {
      label, held, qUpFrame: qUp?.f, qSendFrame: qCast?.f, qSendMinusKeyupMs: qCast && qUp ? +(qCast.wall - qUp.wall).toFixed(2) : null,
      dashEnd, eCmdTick: eCmd?.tick, eCastTick: eTick?.tick, msBeforeDashEnd: eCmd && dashEnd !== null ? Math.round((dashEnd - eCmd.tick - 1) * 1000 / 30) : null,
      busyWhenProcessed: busyAtPress ? (busyAtPress.dash || busyAtPress.cast !== null) : null, pendingSeen: t.some((x) => x.pending === 'a3'),
    };
    report[label] = res;
    console.log(label, JSON.stringify(res));
    return res;
  };
  const a = await trial(260, 'trial_mid_dash');
  check('held 300 ms: the aim shows and no cast is sent', a.held.aim && a.held.cast === 0, a.held);
  check(`release: the cast is sent in the keyup's own frame (frame ${a.qUpFrame} vs ${a.qSendFrame}, ${a.qSendMinusKeyupMs} ms)`, a.qUpFrame !== undefined && a.qUpFrame === a.qSendFrame, a);
  check(`E pressed mid-dash: the sim held it (pendingCast a3) and cast it ${a.eCastTick - a.dashEnd} tick(s) after the dash end`, a.busyWhenProcessed && a.pendingSeen && a.eCastTick !== undefined && a.dashEnd !== null && a.eCastTick - a.dashEnd >= 0 && a.eCastTick - a.dashEnd <= 2, a);
  // E about 150 ms before the dash end: windup 150 + dash 438 ms from the release; aim for ~150 ms before
  const b = await trial(Math.max(0, (a.dashEnd - a.eCmdTick - 1) * 1000 / 30 + 260 - 150), 'trial_150ms');
  check(`E pressed ${b.msBeforeDashEnd} ms before the dash end: cast ${b.eCastTick - b.dashEnd} tick(s) after it`, b.busyWhenProcessed && b.eCastTick !== undefined && b.dashEnd !== null && b.eCastTick - b.dashEnd >= 0 && b.eCastTick - b.dashEnd <= 2, b);
  const c2 = await trial(Math.max(0, (a.dashEnd - a.eCmdTick - 1) * 1000 / 30 + 260 - 150), 'trial_150ms_2');
  check(`repeat: E pressed ${c2.msBeforeDashEnd} ms before the dash end: cast ${c2.eCastTick - c2.dashEnd} tick(s) after it; release frame ${c2.qUpFrame === c2.qSendFrame ? 'same' : 'different'}`, c2.busyWhenProcessed && c2.eCastTick - c2.dashEnd >= 0 && c2.eCastTick - c2.dashEnd <= 2 && c2.qUpFrame === c2.qSendFrame, c2);
  report.consoleErrors = logs.filter((l) => /error/i.test(l));
  check('0 console errors', report.consoleErrors.length === 0, report.consoleErrors.slice(0, 5));
} catch (err) {
  report.error = String(err?.stack ?? err);
  console.log('ERROR', report.error);
} finally {
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
const failed = report.checks.filter((c) => !c.ok).length + (report.error ? 1 : 0);
console.log(`w2d live: ${report.checks.length - report.checks.filter((c) => !c.ok).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

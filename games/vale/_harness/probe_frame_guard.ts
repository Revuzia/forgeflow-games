// VALE harness (lane W1-E, TECH-09): the frame loop's failure counting (boot/frame_guard.ts), pure.
//   node _harness/probe_frame_guard.ts
import { check, finish } from './fixtures/sim_fixture.ts';
import { FAIL_LIMIT, FrameGuard, parseFault } from '../src/boot/frame_guard.ts';

const boom = (): never => { throw new Error('boom'); };
const mk = (fault = {}) => {
  const ev: string[] = [], logs: string[] = [];
  const g = new FrameGuard<{ id: number }>({
    fault, log: (m) => logs.push(m),
    onPumpDead: (m) => ev.push(`pumpDead:${m.id}`), onRenderDead: (a) => ev.push(`renderDead:${a}`), onRenderOk: () => ev.push('renderOk'),
  });
  return { g, ev, logs };
};

{
  const { g, ev, logs } = mk();
  const m = { id: 1 };
  for (let i = 0; i < FAIL_LIMIT - 1; i++) g.pump(m, 0, boom);
  check('29 failures: the match is still alive', ev.length === 0 && !g.pumpIsDead);
  g.pump(m, 0, () => {});
  for (let i = 0; i < FAIL_LIMIT - 1; i++) g.pump(m, 0, boom);
  check('one good frame resets the count (consecutive, not total)', ev.length === 0);
  g.pump(m, 0, boom);
  check('30 consecutive failures: onPumpDead once', ev.join() === 'pumpDead:1' && g.pumpIsDead, ev);
  let ran = 0;
  for (let i = 0; i < 100; i++) g.pump(m, 0, () => { ran++; boom(); });
  check('a dead match is never pumped again and fires nothing more', ran === 0 && ev.length === 1);
  check('the console got failure 1, 10, 20, 30 of each run, not every frame', logs.length === 7, logs.length);
  const next = { id: 2 };
  g.pump(next, 0, () => { ran++; });
  check('the next match is a fresh start', ran === 1 && !g.pumpIsDead);
}
{
  const { g, ev } = mk();
  let t = 0;
  for (let i = 0; i < FAIL_LIMIT; i++) g.draw(t += 16, boom);
  check('30 draw failures: lost plate + retry (attempt 1)', ev.join() === 'renderDead:1' && g.renderState === 1, ev);
  for (let i = 0; i < FAIL_LIMIT - 1; i++) g.draw(t += 16, boom);
  check('the retry gets its own 30 frames', ev.length === 1);
  g.draw(t += 16, boom);
  check('still failing after the retry: attempt 2 once', ev.join() === 'renderDead:1,renderDead:2', ev);
  for (let i = 0; i < 200; i++) g.draw(t += 16, boom);
  check('then it stays quiet', ev.length === 2);
  g.draw(t += 16, () => {});
  check('a draw that works again clears the plate', ev[ev.length - 1] === 'renderOk' && g.renderState === 0, ev);
  g.draw(t += 16, () => {});
  check('and says so once', ev.filter((e) => e === 'renderOk').length === 1);
}
{
  const { g, ev } = mk({ pump: 5 });
  const m = { id: 7 };
  let ran = 0;
  g.pump(m, 4.9, () => { ran++; });
  check('injected pump fault: nothing before its time', ran === 1 && ev.length === 0);
  for (let i = 0; i < FAIL_LIMIT; i++) g.pump(m, 5 + i / 60, () => { ran++; });
  check('injected pump fault: 30 throws from t=5 end the match', ev.join() === 'pumpDead:7' && ran === 1, [ev, ran]);
}
{
  const { g, ev } = mk({ render: 2 });
  let t = 1000, ran = 0;
  g.draw(t, () => { ran++; });
  g.draw(t += 1900, () => { ran++; });
  check('injected render fault: nothing before its time', ran === 2 && ev.length === 0);
  for (let i = 0; i < FAIL_LIMIT; i++) g.draw(t += 20 + 100, () => { ran++; });
  check('injected render fault: 30 throws after 2 s', ev.join() === 'renderDead:1', ev);
}
check('parseFault is dev-only', JSON.stringify(parseFault('?fault=pump:60', false)) === '{}' && parseFault('?fault=pump:60', true).pump === 60);
check('parseFault reads both and ignores junk', (() => { const f = parseFault('?fault=pump:20,render:3,x:1,pump:zz', true); return f.pump === 20 && f.render === 3; })());
finish('probe_frame_guard');

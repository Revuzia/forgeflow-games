// VALE harness (lane W1-E, TECH-07 and TECH-08): the device gate's decisions (boot/device.ts), the English of the ship
// plates against content/strings.en.json (the two must say the same words), and the one-tab lock (boot/tabs.ts) against a
// fake navigator.locks.
//   node _harness/probe_boot_gate.ts
import { readFileSync } from 'node:fs';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { deviceProblem, MIN_HEIGHT, MIN_WIDTH, SHIP_TEXT, shipText, type DeviceFacts } from '../src/boot/device.ts';

const desktop: DeviceFacts = { webgl2: true, coarse: false, anyFine: true, width: 1920, height: 1080 };
const p = (f: Partial<DeviceFacts>, o: { noRender?: boolean; dev?: boolean; tried?: boolean } = {}) => deviceProblem({ ...desktop, ...f }, { noRender: false, dev: false, tried: false, ...o });

section('device decisions', () => {
  check('desktop plays', p({}) === null);
  check('1280x720 plays', p({ width: 1280, height: 720 }) === null);
  check('exactly 1024x600 plays', p({ width: MIN_WIDTH, height: MIN_HEIGHT }) === null);
  check('no WebGL2: webgl plate, no try-anyway', JSON.stringify(p({ webgl2: false })) === '{"kind":"webgl","tryAnyway":false}');
  check('touch only (pointer coarse, no fine pointer): touch plate with try-anyway', JSON.stringify(p({ coarse: true, anyFine: false })) === '{"kind":"touch","tryAnyway":true}');
  check('a hybrid (coarse primary, a mouse attached) plays', p({ coarse: true, anyFine: true }) === null);
  check('1023 wide: small plate', p({ width: 1023 })?.kind === 'small' && p({ width: 1023 })?.tryAnyway === true);
  check('599 high: small plate', p({ height: 599 })?.kind === 'small');
  check('phone (touch + small): touch wins', p({ coarse: true, anyFine: false, width: 390, height: 844 })?.kind === 'touch');
  check('"Try anyway" lifts touch and small', p({ coarse: true, anyFine: false }, { tried: true }) === null && p({ width: 800 }, { tried: true }) === null);
  check('"Try anyway" never lifts a missing WebGL2', p({ webgl2: false }, { tried: true })?.kind === 'webgl');
  check('?render=0 in a shipped build is the webgl plate even with try-anyway', p({}, { noRender: true, tried: true })?.kind === 'webgl' && p({}, { noRender: true })?.tryAnyway === false);
  check('?render=0 with ?dev=1 (harness runs) is unchanged', p({}, { noRender: true, dev: true }) === null);
  check('dev does not lift a device that cannot draw', p({ webgl2: false }, { dev: true })?.kind === 'webgl');
});

section('plate text = strings.en.json', () => {
  const strings = JSON.parse(readFileSync(new URL('../content/strings.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  for (const [k, v] of Object.entries(SHIP_TEXT)) check(`${k} matches strings.en.json`, strings[k] === v, [strings[k], v]);
  check('shipText prefers a catalog string', shipText('ship.tab.use', { 'ship.tab.use': 'X' }) === 'X' && shipText('ship.tab.use') === 'Play here');
  const BANNED = /\b(bots?|a\.?i\.?|cpu|computer[- ]controlled|npcs?)\b/i;
  check('no plate text names bots / AI / CPU', Object.values(SHIP_TEXT).every((v) => !BANNED.test(v)));
});

// ── tabs.ts against a fake Web Locks implementation ───────────────────────────────────────────────
type Cb = (lock: unknown) => Promise<void> | void;
class FakeLocks {
  holder: { reject(e: Error): void } | null = null;
  request(_n: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: Cb): Promise<unknown> {
    if (this.holder && !opts.steal) { if (opts.ifAvailable) return Promise.resolve(cb(null)); }
    return new Promise((resolve, reject) => {
      if (this.holder && opts.steal) this.holder.reject(Object.assign(new Error('stolen'), { name: 'AbortError' }));
      this.holder = { reject };
      Promise.resolve(cb({ name: 'vale-profile' })).then(resolve, reject);
    });
  }
}
{
  const fake = new FakeLocks();
  Object.defineProperty(globalThis, 'navigator', { value: { locks: fake }, configurable: true });
  const { acquireTab, stealTab, tabLocksSupported } = await import('../src/boot/tabs.ts');
  check('locks supported under the fake', tabLocksSupported());
  let lostA = 0, lostB = 0;
  const a = await acquireTab(() => { lostA++; });
  check('first tab gets the lock', a === true);
  const b = await acquireTab(() => { lostB++; });
  check('second tab finds it taken (false), nothing lost yet', b === false && lostA === 0);
  const stole = await stealTab(() => { lostB++; });
  await new Promise((r) => setTimeout(r, 10));
  check('"Play here" steals it; the first tab is told it lost it, once', stole === true && lostA === 1 && lostB === 0, { lostA, lostB });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  check('no navigator.locks: never blocks play', (await acquireTab(() => {})) === true && !tabLocksSupported());
}
finish('probe_boot_gate');

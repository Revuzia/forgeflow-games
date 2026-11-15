// VALE harness (lane W1-E, TECH-08): two stores on one storage area (two tabs of one browser profile). The second tab
// can never overwrite the wallet, skins or history the first one saved; its refused save tells the UI ('stale'); a
// storage event from the other tab tells it earlier; storage that is missing or throws tells it 'degraded'.
//
//   node _harness/probe_session_two_tabs.ts
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { sessionCatalog } from './fixtures/session_fixture.ts';
import { ManualClock } from '../src/session/clock.ts';
import { LocalSession } from '../src/session/local_session.ts';
import { LocalProfileStore, PROFILE_KEY, type StoreStatus } from '../src/session/profile_store.ts';
import type { Profile } from '../src/contracts/session.ts';

const cat = sessionCatalog();
class Area { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const stored = (a: Area): Profile & { rev?: number } => JSON.parse(a.getItem(PROFILE_KEY)!);
const boot = (a: Area, seed: number): { s: LocalSession; store: LocalProfileStore; seen: StoreStatus[] } => {
  const store = new LocalProfileStore(undefined, PROFILE_KEY, a);
  const seen: StoreStatus[] = [];
  store.onStatus((x) => seen.push(x));
  return { s: new LocalSession({ catalog: cat, store, clock: new ManualClock(), seed }), store, seen };
};

section('second tab cannot overwrite the first', () => {
  const area = new Area();
  const A = boot(area, 1);
  const B = boot(area, 2);                       // both tabs hold the same profile now
  check('both tabs booted on one identity', A.s.identity.id === B.s.identity.id);
  const revBoot = stored(area).rev ?? 0;
  check('the blob carries a rev', revBoot >= 1, revBoot);
  // tab A earns: wallet, a skin, a history entry
  A.s.rename('Alpha');
  const after = stored(area);
  check('tab A saved (rev advanced)', (after.rev ?? 0) > revBoot && after.identity.displayName === 'Alpha');
  const alphaWallet = JSON.stringify(after.wallet), alphaOwned = after.owned.length, alphaHist = after.history.length;
  // tab B (older view) saves: refused
  B.s.rename('Bravo');
  const kept = stored(area);
  check('tab B save refused: name, wallet, skins and history are tab A\'s', kept.identity.displayName === 'Alpha' && JSON.stringify(kept.wallet) === alphaWallet && kept.owned.length === alphaOwned && kept.history.length === alphaHist, kept.identity.displayName);
  check('tab B was told: stale', B.seen.includes('stale') && B.store.stale, B.seen);
  check('tab A was never told anything', A.seen.length === 0 && !A.store.stale);
  B.s.updateSettings({ gameplay: { ...B.s.profile().settings.gameplay, minimapSide: 'left' } });
  check('every later save of tab B stays refused', stored(area).identity.displayName === 'Alpha' && (stored(area).rev ?? 0) === (kept.rev ?? 0));
  A.s.rename('Alpha2');
  check('tab A keeps saving', stored(area).identity.displayName === 'Alpha2' && (stored(area).rev ?? 0) > (kept.rev ?? 0));
});

section('wallet, skins and history written by the first tab survive', () => {
  const area = new Area();
  const A = new LocalProfileStore(undefined, PROFILE_KEY, area), B = new LocalProfileStore(undefined, PROFILE_KEY, area);
  const base = boot(new Area(), 9).s.profile();
  A.loadRaw(); B.loadRaw();
  A.save(base);
  const rich: Profile = structuredClone(base);
  rich.wallet.fx_coin = 9999;
  rich.owned.push({ ...base.owned[0], sku: 'x:extra', ref: 'fx_extra_skin' } as Profile['owned'][number]);
  rich.history.unshift({ matchId: 'm1' } as Profile['history'][number]);
  A.save(rich);
  B.loadRaw();                                    // B re-reads: it is up to date with A's save
  const poor = structuredClone(base); poor.wallet.fx_coin = 1;
  const before = stored(area);
  check('a store that re-read the newer blob may save (it is up to date)', (() => { B.save(poor); return stored(area).wallet.fx_coin === 1; })());
  check('fixture sanity: A had written 9999', before.wallet.fx_coin === 9999 && before.history.length === 1 && before.owned.length === base.owned.length + 1);
  // true race: C read at rev r, A writes r+1, C writes
  const C = new LocalProfileStore(undefined, PROFILE_KEY, area);
  C.loadRaw();
  A.loadRaw(); A.save(rich);
  C.save(poor);
  const fin = stored(area);
  check('stale C could not overwrite A: wallet 9999, 1 history, extra skin', fin.wallet.fx_coin === 9999 && fin.history.length === 1 && fin.owned.some((o) => o.ref === 'fx_extra_skin'), fin.wallet);
  check('C is stale and says so once', C.stale);
});

section('storage event from another tab', () => {
  const area = new Area();
  const A = boot(area, 3), B = boot(area, 4);
  A.s.rename('Alpha');
  const blob = area.getItem(PROFILE_KEY);
  B.store.onStorageEvent('some.other.key', blob);
  check('another key is ignored', !B.store.stale);
  B.store.onStorageEvent(PROFILE_KEY, blob);
  check('the profile key at a newer rev marks the tab stale before it saves', B.store.stale && B.seen.includes('stale'));
  B.store.onStorageEvent(PROFILE_KEY, blob);
  check('told once', B.seen.filter((x) => x === 'stale').length === 1);
  const own = boot(new Area(), 5);
  own.s.rename('Mine');
  own.store.onStorageEvent(PROFILE_KEY, new Area().getItem('x'));
  check('a removed key (null) does not mark stale', !own.store.stale);
});

section('degraded storage tells the player', () => {
  const none = new LocalProfileStore(undefined, PROFILE_KEY, null);
  const seen: StoreStatus[] = [];
  none.onStatus((x) => seen.push(x));
  check('no storage: degraded delivered at subscription', none.degraded && seen.join() === 'degraded', seen);
  const throwing: Area = new Area();
  let throwOn = false;
  const area = { getItem: (k: string) => throwing.getItem(k), setItem: (k: string, v: string) => { if (throwOn) throw new Error('QuotaExceededError'); throwing.setItem(k, v); }, removeItem: (k: string) => throwing.removeItem(k) };
  const store = new LocalProfileStore(undefined, PROFILE_KEY, area);
  const got: StoreStatus[] = [];
  store.onStatus((x) => got.push(x));
  const s = new LocalSession({ catalog: cat, store, clock: new ManualClock(), seed: 6 });
  check('healthy storage: nothing said', got.length === 0 && !store.degraded);
  throwOn = true;
  s.rename('Quota');
  s.rename('Quota2');
  check('setItem throws: degraded once, the session keeps running from memory', got.join() === 'degraded' && store.degraded && s.profile().identity.displayName === 'Quota2', got);
  check('the memory copy holds the latest profile', (JSON.parse((store as unknown as { memory: string }).memory) as Profile).identity.displayName === 'Quota2');
});

finish('probe_session_two_tabs');

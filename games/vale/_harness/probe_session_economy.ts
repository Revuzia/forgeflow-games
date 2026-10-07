// probe (lane SESSION): the economy through a LocalSession — grant (play) → purchase → equip → the
// equipped skin in the next match → persistence round-trip (MemoryProfileStore and a localStorage
// stand-in) → ledger/ownership invariants; settings + loadouts persist; a schema-0 save migrates on
// boot and is written back as schema 1; a save from a newer client is never overwritten.
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { harness, lastOf, PROFILE_V0, runFlow, sessionCatalog } from './fixtures/session_fixture.ts';
import { PROFILE_SCHEMA } from '../src/contracts/session.ts';
import { ManualClock } from '../src/session/clock.ts';
import { checkInvariants } from '../src/session/economy.ts';
import { LocalSession } from '../src/session/local_session.ts';
import { LocalProfileStore, MemoryProfileStore, PROFILE_KEY } from '../src/session/profile_store.ts';

const cat = sessionCatalog();

section('grant → purchase → equip → wear it → persist → invariants', () => {
  const h = harness({ autopilot: 'match' });   // your draft seat stays yours (no brain picking your skin)
  const s = h.session;
  check('a new profile owns every base skin and has the starter wallet', s.profile().wallet.fx_coin === 25 && cat.store.starterOwnership.every((k) => s.profile().owned.some((o) => o.ref === k)));
  const f = s.purchase('fx_offer_brawler_alt');
  check('25 coin < 40 → funds; nothing changes', !f.ok && f.reason === 'funds' && s.profile().wallet.fx_coin === 25 && s.profile().ledger.length === 1);
  let games = 0;
  while (s.profile().wallet.fx_coin < 40 && games < 4) { const r = runFlow(h, { queue: 'fx_s_coop' }); if (!r.ok) break; games++; }
  const coin = s.profile().wallet.fx_coin;
  check(`earned by play (${games} game(s)) → ${coin} coin`, coin >= 40 && s.profile().ledger.some((e) => e.reason === 'match_grant'));
  const before = h.events.length;
  const r = s.purchase('fx_offer_brawler_alt');
  const p = s.profile();
  const last = p.ledger[p.ledger.length - 1];
  check("purchase: −40 ledger entry ('purchase', ref sku) and an OwnershipRecord pointing at it", r.ok && last.delta === -40 && last.reason === 'purchase' && last.ref === 'fx_offer_brawler_alt'
    && r.ok && r.record.txn === last.txn && r.record.ref === 'fx_brawler_alt' && r.record.fighter === 'fx_brawler' && r.record.catalogVersion === cat.version && p.wallet.fx_coin === coin - 40);
  check("a 'profile' event follows and the store has it", h.events.slice(before).some((e) => e.type === 'profile') && JSON.parse(h.store.raw()!).owned.some((o: { ref: string }) => o.ref === 'fx_brawler_alt'));
  check('buying it again → owned', (s.purchase('fx_offer_brawler_alt') as { reason: string }).reason === 'owned');
  check('unknown / expired skus refused', (s.purchase('fx_nope') as { reason: string }).reason === 'unknown_sku' && (s.purchase('fx_offer_expired') as { reason: string }).reason === 'unavailable');
  check('equip: unowned skin refused, owned accepted', !s.equipSkin('fx_ranger', 'fx_ranger_alt').ok && s.equipSkin('fx_brawler', 'fx_brawler_alt').ok && s.profile().equipped.fx_brawler === 'fx_brawler_alt');
  const q = runFlow(h, { queue: 'fx_s_quick', preset: { fighter: 'fx_brawler', role: 'fx_role_top' } });
  const me = q.setup?.seats.find((x) => x.controller === 'human');
  check('the next match wears the equipped skin', q.ok && me?.fighter === 'fx_brawler' && me.skin === 'fx_brawler_alt', me);
  check('invariants hold: balance = Σ ledger, unique ownership, equipped ⊆ owned', checkInvariants(s.profile(), cat).length === 0, checkInvariants(s.profile(), cat));
  const q2 = runFlow(h, { queue: 'fx_s_quick', preset: { fighter: 'fx_brawler', role: 'fx_role_top', skin: 'fx_brawler_skin' } });
  const q3 = runFlow(h, { queue: 'fx_s_quick', preset: { fighter: 'fx_ranger', role: 'fx_role_top', skin: 'fx_ranger_alt' } });
  check('QueueRequest.preset.skin picks an owned skin for that match; an unowned one is ignored', q2.ok && q3.ok
    && q2.setup!.seats.find((x) => x.controller === 'human')!.skin === 'fx_brawler_skin' && q3.setup!.seats.find((x) => x.controller === 'human')!.skin === 'fx_ranger_skin'
    && s.profile().equipped.fx_brawler === 'fx_brawler_alt');

  s.updateSettings({ audio: { ...s.profile().settings.audio, music: 0.25 }, video: { ...s.profile().settings.video, preset: 'ultra' } });
  s.saveLoadout('fx_brawler', { spells: ['fx_spell_heal', 'fx_spell_heal', 'fx_bogus'], boons: ['fx_boon_a'] });
  const snapshot = JSON.stringify(s.profile());
  const again = new LocalSession({ catalog: cat, store: h.store, clock: h.clock, seed: 99 });
  check('a new session on the same store loads the identical profile', JSON.stringify(again.profile()) === snapshot && again.identity.id === s.identity.id);
  const p2 = again.profile();
  check('settings and the sanitized loadout survived', p2.settings.audio.music === 0.25 && p2.settings.video.preset === 'ultra' && p2.settings.video.maxDpr === 2
    && p2.loadouts.fx_brawler.spells.join() === 'fx_spell_heal' && p2.loadouts.fx_brawler.boons.join() === 'fx_boon_a');
  check('history, ledger, ownership and invariants survived', p2.history.length === games + 3 && p2.owned.some((o) => o.ref === 'fx_brawler_alt') && checkInvariants(p2, cat).length === 0);
});

section('localStorage persistence across sessions', () => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); },
  };
  const clock = new ManualClock();
  const a = new LocalSession({ catalog: cat, clock, seed: 5 });
  a.rename('Keeper');
  check(`the default store writes localStorage['${PROFILE_KEY}']`, mem.has(PROFILE_KEY) && JSON.parse(mem.get(PROFILE_KEY)!).identity.displayName === 'Keeper');
  const b = new LocalSession({ catalog: cat, clock, seed: 6 });
  check('the next boot reads it back (same identity, name)', b.identity.id === a.identity.id && b.identity.displayName === 'Keeper');
  delete (globalThis as { localStorage?: unknown }).localStorage;
  const c = new LocalSession({ catalog: cat, clock, store: new LocalProfileStore(), seed: 7 });
  check('no localStorage → a working in-memory session', c.profile().schema === PROFILE_SCHEMA && c.identity.id !== a.identity.id);
});

section('a schema-0 save migrates on boot and is written back as schema 1', () => {
  const store = new MemoryProfileStore(structuredClone(PROFILE_V0));
  const s = new LocalSession({ catalog: cat, store, clock: new ManualClock(), seed: 3 });
  const p = s.profile();
  check('migrated: identity, wallet via a migration ledger entry, ownership records, rating', p.schema === PROFILE_SCHEMA && s.identity.id === 'local-legacy0001'
    && p.wallet.fx_coin === 70 && p.ledger[0]?.reason === 'migration' && p.owned.some((o) => o.ref === 'fx_brawler_alt') && p.ratings.fx_s_rating?.rating === 1620);
  check('starter skins added, invariants hold', cat.store.starterOwnership.every((k) => p.owned.some((o) => o.ref === k)) && checkInvariants(p, cat).length === 0, checkInvariants(p, cat));
  const saved = JSON.parse(store.raw()!);
  check('the store now holds schema 1', saved.schema === PROFILE_SCHEMA && saved.identity.id === 'local-legacy0001' && !('coins' in saved));
  const again = new LocalSession({ catalog: cat, store, clock: new ManualClock(), seed: 4 });
  check('booting again changes nothing', JSON.stringify(again.profile()) === JSON.stringify(p));
  const r = s.purchase('fx_offer_brawler_alt');
  check('migrated ownership counts (the alt skin is already owned)', !r.ok && r.reason === 'owned');
});

section('a save from a newer client is never overwritten', () => {
  const future = JSON.stringify({ schema: PROFILE_SCHEMA + 1, identity: { id: 'acct-9' }, wallet: { fx_coin: 999 } });
  const store = new MemoryProfileStore(future);
  const s = new LocalSession({ catalog: cat, store, clock: new ManualClock(), seed: 8 });
  s.rename('Temp');
  s.updateSettings({ gameplay: { ...s.profile().settings.gameplay, minimapSide: 'left' } });
  check('the session runs on a fresh in-memory profile', s.profile().schema === PROFILE_SCHEMA && s.profile().wallet.fx_coin === 25);
  check('the stored blob is untouched', store.raw() === future);
});

section('profile() hands out copies', () => {
  const h = harness();
  const p = h.session.profile();
  p.wallet.fx_coin = 1_000_000;
  p.owned.length = 0;
  check('mutating the copy does not touch the session', h.session.profile().wallet.fx_coin === 25 && h.session.profile().owned.length > 0);
  check("profile events carry copies too", (() => { h.session.rename('Copy Test'); const e = lastOf(h, 'profile')!; e.profile.wallet.fx_coin = 5; return h.session.profile().wallet.fx_coin === 25; })());
});

finish('probe_session_economy');

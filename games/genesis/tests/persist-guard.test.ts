import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANNER_ID, assessStorage, installPersistGuard, requestPersist, showSavesBanner, type BannerDoc, type BannerEl } from '../src/persist/guard.ts';

function fakeDoc(): { doc: BannerDoc; added: BannerEl[] } {
  const added: BannerEl[] = [];
  const mk = (): BannerEl => {
    const kids: BannerEl[] = [];
    const el: BannerEl = {
      id: '', textContent: '', style: { cssText: '' }, onclick: null, setAttribute() {}, appendChild(e) { kids.push(e); },
      remove() { const i = added.indexOf(el); if (i >= 0) added.splice(i, 1); },
    };
    return el;
  };
  return { added, doc: { getElementById: (id) => added.find((e) => e.id === id) ?? null, createElement: mk, body: { appendChild: (e) => { added.push(e); } } } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('persist(): asked once, granted or not; a missing or throwing API is null, never an error', async () => {
  assert.equal(await requestPersist(undefined), null);
  assert.equal(await requestPersist({}), null);
  assert.equal(await requestPersist({ persist: async () => true }), true);
  assert.equal(await requestPersist({ persist: async () => false }), false);
  assert.equal(await requestPersist({ persisted: async () => true, persist: async () => assert.fail('already persisted') }), true);
  assert.equal(await requestPersist({ persist: async () => { throw new Error('no'); } }), null);
});

test('a private window is recognised: no IndexedDB, or a tiny quota; a normal one is not', async () => {
  assert.equal((await assessStorage({ idbUsable: false })).usable, false);
  assert.equal((await assessStorage({ idbUsable: true, storage: { estimate: async () => ({ quota: 80 * 1048576 }) } })).usable, false);
  assert.equal((await assessStorage({ idbUsable: true, storage: { estimate: async () => ({ quota: 40e9 }) } })).usable, true);
  assert.equal((await assessStorage({ idbUsable: true, storage: { estimate: async () => { throw new Error('x'); } } })).usable, true);
  assert.equal((await assessStorage({})).usable, true, 'unknown is not accused');
});

test('the banner is added once, says to export, and dismisses', () => {
  const { doc, added } = fakeDoc();
  assert.equal(showSavesBanner(doc), true);
  assert.equal(showSavesBanner(doc), false);
  assert.equal(added.length, 1);
  assert.equal(added[0].id, BANNER_ID);
  added[0].remove();
  assert.equal(added.length, 0);
});

test('the guard: persist() after the FIRST save only; a private window gets the banner at once', async () => {
  let asks = 0, puts = 0;
  const store = { put: async (_r: never) => { puts++; return 'k'; } };
  const { doc, added } = fakeDoc();
  const g = installPersistGuard(store, { env: { idbUsable: true, storage: { persist: async () => { asks++; return true; } } }, doc });
  await tick();
  assert.equal(asks, 0, 'not before a save');
  assert.equal(added.length, 0, 'a normal window: no banner');
  await store.put(1 as never); await store.put(2 as never); await tick();
  assert.equal(puts, 2);
  assert.equal(asks, 1, 'once');
  assert.equal(g.persisted(), true);

  const priv = fakeDoc();
  const g2 = installPersistGuard({ put: async () => 1 }, { env: { idbUsable: false }, doc: priv.doc });
  await tick();
  assert.equal(g2.bannerShown(), true);
  assert.equal(priv.added.length, 1);
});

test('a save the browser refuses shows the banner (and still throws to the panel); a full quota does not', async () => {
  const a = fakeDoc();
  const bad = { put: async (_r: never): Promise<unknown> => { throw new Error('the browser refused to keep it'); } };
  installPersistGuard(bad, { env: { idbUsable: true }, doc: a.doc });
  await assert.rejects(bad.put(1 as never));
  assert.equal(a.added.length, 1);

  const b = fakeDoc();
  const full = { put: async (_r: never): Promise<unknown> => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
  installPersistGuard(full, { env: { idbUsable: true }, doc: b.doc });
  await assert.rejects(full.put(1 as never));
  assert.equal(b.added.length, 0, 'the panel already explains a full quota');
});

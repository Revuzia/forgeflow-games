// GENESIS — UI fix round 3: a save asked for while another is being written waits and follows (never dropped, the
// typed name kept until it lands); loads wait too; a god's act brings the autosave forward; the autosave cadence an
// earlier build kept by default (10 minutes) gives way to 2 (src/ui/saves.ts, src/ui/prefs.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g.window ??= globalThis;
g.document ??= { hidden: false, addEventListener() {} };
const { Saves, ACT_SAVE_DELAY_MS, ACT_SAVE_GAP_MS } = await import('../src/ui/saves.ts');
const { DEFAULT_PREFS } = await import('../src/ui/prefs.ts');

const HDR = await (async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  return new Sim({ seed: 7, scenario: 'sandbox', overrides: { n: 8 } } as never).save();
})();
const bytes = () => HDR.buffer.slice(HDR.byteOffset, HDR.byteOffset + HDR.byteLength) as ArrayBuffer;

function rig(o: { slow?: number } = {}) {
  const s = Object.create(Saves.prototype) as InstanceType<typeof Saves> & Record<string, unknown>;
  const kept: string[] = [], toasts: string[] = [], loads: string[] = [];
  let gate: (() => void) | null = null;
  const nameIn = { value: '' };
  Object.assign(s, {
    host: { prefs: { value: { game: { autosaveMinutes: 2 } } }, source: 'worker', toast: (t: { text: string }) => toasts.push(t.text), sound() {}, keybinds: { hint: () => 'F5' } },
    deps: {
      keepable: () => true, packs: () => [], world: () => ({ scenario: 'sandbox' }), thumb: async () => null,
      // the first write is held until released (a 26 MB autosave being written)
      save: async () => { if (o.slow && !gate) await new Promise<void>((ok) => { gate = ok; }); return bytes(); },
      load: async () => { loads.push('load'); return { ok: true }; }, loaded() {},
    },
    store: { put: async (r: { id: string; name: string }) => { kept.push(`${r.id}:${r.name}`); }, get: async () => undefined },
    describe: () => ({ world: 'Gaia', worlds: ['Gaia'], calendar: 'Year 1', summary: '' }),
    nameIn, panel: { isOpen: false, close() {} }, lastAuto: performance.now(), autoAt: 0, actedAt: null, firstAuto: true, lastThumb: null, last: null,
    busy: false, busyWhat: null, queue: Promise.resolve(), autoQueued: null,
  });
  Object.defineProperty(s, 'isOpen', { get: () => false });
  return { s, kept, toasts, loads, nameIn, release: () => { const f = gate; gate = () => {}; f?.(); } };
}
const tick = () => new Promise((ok) => setTimeout(ok, 5));

test('a named save while the autosave is being written follows it, with a word, and keeps the typed name until it lands', async () => {
  const r = rig({ slow: 1 });
  const auto = r.s.autosave();
  await tick();
  assert.equal(r.s.pending, true);
  r.nameIn.value = 'Publish test';
  const named = (r.s as unknown as { saveNew(): Promise<void> }).saveNew();
  await tick();
  assert.ok(r.toasts.some((t) => /Still keeping the autosave… your save will follow/.test(t)), r.toasts.join(' | '));
  assert.equal(r.nameIn.value, 'Publish test', 'the name stays while it waits');
  assert.equal(r.kept.length, 0);
  r.release();
  assert.equal(await auto, true);
  await named;
  assert.deepEqual(r.kept.map((k) => k.replace(/^s[0-9a-z]+:/, 's:')), ['auto:Autosave', 's:Publish test']);
  assert.equal(r.nameIn.value, '', 'cleared once kept');
  assert.ok(r.toasts.includes('Kept: Publish test.'));
});

test('F5 and the god\'s save while the autosave is being written are kept after it; autosaves asked twice are one', async () => {
  const r = rig({ slow: 1 });
  const a1 = r.s.autosave();
  await tick();
  const q = r.s.quicksave();
  const a2 = r.s.autosave(), a3 = r.s.autosave();
  const ctl = r.s.control({ save: 1 });
  r.release();
  await Promise.all([a1, q, a2, a3, ctl]);
  assert.deepEqual(r.kept.map((k) => k.replace(/^s[0-9a-z]+:/, 's:')), ['auto:Autosave', 'quick:Quicksave', 'auto:Autosave', 's:Year 1']);
  assert.ok(r.toasts.some((t) => /your quicksave will follow/.test(t)));
  assert.equal(r.s.pending, false);
});

test('a load asked for while a save is being written opens after it (not dropped)', async () => {
  const r = rig({ slow: 1 });
  const a = r.s.autosave();
  await tick();
  const l = (r.s as unknown as { loadRecord(x: unknown): Promise<boolean> }).loadRecord({ id: 'x', name: 'Named', bytes: bytes(), packJson: [] });
  await tick();
  assert.equal(r.loads.length, 0);
  r.release();
  await a;
  assert.equal(await l, true);
  assert.deepEqual(r.loads, ['load']);
});

test('a failed write does not stall the queue', async () => {
  const r = rig();
  let n = 0;
  (r.s as unknown as { store: { put(x: { id: string }): Promise<void> } }).store.put = async (x) => { if (n++ === 0) throw new Error('quota'); r.kept.push(x.id); };
  const [a, b] = await Promise.all([r.s.saveSlot('one', 'One'), r.s.saveSlot('two', 'Two')]);
  assert.deepEqual([a, b], [false, true]);
  assert.deepEqual(r.kept, ['two']);
});

test('a god\'s act brings the autosave forward: soon after it, but not more than about once a minute', async () => {
  const r = rig();
  const s = r.s as unknown as Record<string, number | boolean> & { frame(): void; acted(): void };
  s.firstAuto = false;
  s.lastAuto = performance.now() - ACT_SAVE_GAP_MS - 1;
  s.acted();
  s.frame(); await tick();
  assert.equal(r.kept.length, 0, 'not at once');
  s.actedAt = performance.now() - ACT_SAVE_DELAY_MS - 1;
  s.frame(); await tick();
  assert.deepEqual(r.kept, ['auto:Autosave']);
  s.acted(); s.actedAt = performance.now() - ACT_SAVE_DELAY_MS - 1;
  s.frame(); await tick();
  assert.deepEqual(r.kept, ['auto:Autosave'], 'a minute has not passed since the last one');
});

test('the autosave comes every 2 minutes by default; an old unchosen 10 gives way, a chosen one stays', async () => {
  assert.equal(DEFAULT_PREFS.game.autosaveMinutes, 2);
  const mem: Record<string, string> = {};
  g.localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; }, removeItem: (k: string) => { delete mem[k]; } };
  const { PrefsStore } = await import('../src/ui/prefs.ts');
  mem['genesis.prefs.v1'] = JSON.stringify({ game: { autosaveMinutes: 10, edgePan: true, pauseHidden: 'auto' } });
  const a = new PrefsStore(true);
  assert.equal(a.value.game.autosaveMinutes, 2, `old default migrated (${JSON.stringify(a.value.game)})`);
  mem['genesis.prefs.v1'] = JSON.stringify({ game: { autosaveMinutes: 10, autosaveChosen: true, edgePan: true, pauseHidden: 'auto' } });
  assert.equal(new PrefsStore(true).value.game.autosaveMinutes, 10);
});

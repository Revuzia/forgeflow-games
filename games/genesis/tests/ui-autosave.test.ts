// GENESIS — a short visit keeps its world (publish finding: a player who left within 10 minutes found Continue disabled):
// the first autosave comes early (src/ui/saves.ts autosaveDue), and a page going hidden or away keeps the world
// (src/ui/embed.ts TimeGuard -> Saves.leaving), once per hide, whatever the pause setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
const docL: Record<string, Array<() => void>> = {};
const winL: Record<string, Array<() => void>> = {};
g.window ??= globalThis;
(g.window as { addEventListener: unknown }).addEventListener = (k: string, f: () => void) => { (winL[k] ??= []).push(f); };
const doc = { hidden: false, addEventListener: (k: string, f: () => void) => { (docL[k] ??= []).push(f); } };
g.document = doc;
const { TimeGuard } = await import('../src/ui/embed.ts');
const { Saves, autosaveDue, FIRST_AUTOSAVE_MS, LEAVE_GAP_MS } = await import('../src/ui/saves.ts');

const fire = (L: Record<string, Array<() => void>>, k: string) => { for (const f of L[k] ?? []) f(); };

test('the first autosave of a world comes within two minutes, then every N minutes; off stays off', () => {
  assert.ok(FIRST_AUTOSAVE_MS >= 60_000 && FIRST_AUTOSAVE_MS <= 120_000);
  assert.equal(autosaveDue(FIRST_AUTOSAVE_MS - 1, 10, true), false);
  assert.equal(autosaveDue(FIRST_AUTOSAVE_MS, 10, true), true, 'first autosave early');
  assert.equal(autosaveDue(FIRST_AUTOSAVE_MS, 10, false), false, 'later ones keep the cadence');
  assert.equal(autosaveDue(10 * 60000, 10, false), true);
  assert.equal(autosaveDue(60000, 1, true), true, 'a 1-minute cadence is not slowed by the early first');
  assert.equal(autosaveDue(1e9, 0, true), false, 'autosave off');
});

function guard(pref = 'off') {
  const st = { speed: 3, keeps: 0 };
  for (const k of Object.keys(docL)) delete docL[k];
  for (const k of Object.keys(winL)) delete winL[k];
  new TimeGuard({
    speed: () => st.speed, setSpeed: (x) => { st.speed = x; }, openMenu() {}, closeWindows() {}, windowOpen: () => false,
    titleOpen: () => false, hiddenPref: () => pref, toast() {}, keep: () => { st.keeps++; },
  });
  return st;
}

test('a page going hidden keeps the world, even where it does not pause; pagehide after it does not keep twice', () => {
  for (const pref of ['off', 'on']) {
    const st = guard(pref);
    doc.hidden = true; fire(docL, 'visibilitychange');
    assert.equal(st.keeps, 1, `hidden keeps (pause ${pref})`);
    assert.equal(st.speed, pref === 'on' ? 0 : 3);
    fire(winL, 'pagehide');
    assert.equal(st.keeps, 1, 'one keep per hide');
    doc.hidden = false; fire(docL, 'visibilitychange');
    doc.hidden = true; fire(docL, 'visibilitychange');
    assert.equal(st.keeps, 2, 'hidden again: kept again');
    doc.hidden = false;
  }
});

test('pagehide alone (the frame navigated away) keeps the world', () => {
  const st = guard();
  fire(winL, 'pagehide');
  assert.equal(st.keeps, 1);
});

function saves(o: { min?: number; keepable?: boolean; source?: string; autoAt?: number }) {
  const s = Object.create(Saves.prototype) as InstanceType<typeof Saves> & Record<string, unknown>;
  const calls: string[] = [];
  Object.assign(s, {
    host: { prefs: { value: { game: { autosaveMinutes: o.min ?? 10 } } }, source: o.source ?? 'worker' },
    deps: { keepable: () => o.keepable ?? true },
    lastAuto: performance.now(), autoAt: o.autoAt ?? 0, firstAuto: true, busy: false, lastThumb: null,
    saveSlot: async (id: string) => { calls.push(id); return true; },
  });
  return { s, calls };
}

test('Saves.leaving keeps the autosave, except behind the title, with autosave off, or right after one', async () => {
  let r = saves({}); r.s.leaving(); await Promise.resolve();
  assert.deepEqual(r.calls, ['auto']);
  r = saves({ keepable: false }); r.s.leaving(); assert.deepEqual(r.calls, []);
  r = saves({ min: 0 }); r.s.leaving(); assert.deepEqual(r.calls, []);
  r = saves({ source: 'main' }); r.s.leaving(); assert.deepEqual(r.calls, []);
  r = saves({ autoAt: Date.now() - LEAVE_GAP_MS / 2 }); r.s.leaving(); assert.deepEqual(r.calls, []);
  r = saves({ autoAt: Date.now() - LEAVE_GAP_MS * 2 }); r.s.leaving(); assert.deepEqual(r.calls, ['auto']);
});

test('Saves.frame: the first autosave of a world comes early, the title holds it back', async () => {
  const r = saves({});
  const s = r.s as unknown as Record<string, number | boolean> & { frame(): void };
  s.lastAuto = performance.now() - FIRST_AUTOSAVE_MS - 10;
  s.frame(); await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(r.calls, ['auto']);
  assert.equal(s.firstAuto, false);
  s.lastAuto = performance.now() - FIRST_AUTOSAVE_MS - 10;
  s.frame(); assert.deepEqual(r.calls, ['auto'], 'the second waits the full interval');
  const t = saves({ keepable: false });
  const ts = t.s as unknown as Record<string, number | boolean> & { frame(): void };
  ts.lastAuto = performance.now() - 1e7; ts.frame(); assert.deepEqual(t.calls, []);
  assert.equal(ts.firstAuto, true);
});

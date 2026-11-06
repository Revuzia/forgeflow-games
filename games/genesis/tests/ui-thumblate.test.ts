// GENESIS — a save's picture is the save's own (release minor #6): on a starved GPU the frame copy for an autosave can take
// longer than the save waits (THUMB_WAIT_MS). The save is then written WITHOUT a picture (never the previous save's) and the
// copy, when it comes, is put on that save (src/client/thumbjpeg.ts thumbOfFrame, src/ui/saves.ts withLateThumb /
// SaveStore.setThumb) — unless another save has gone into the slot since.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thumbOfFrame } from '../src/client/thumbjpeg.ts';

const g = globalThis as unknown as Record<string, unknown>;
g.window ??= globalThis;
g.document ??= { hidden: false, addEventListener() {} };
const { withLateThumb } = await import('../src/ui/saves.ts');

class Bmp { closed = false; tag: string; constructor(tag: string) { this.tag = tag; } close() { this.closed = true; } }
const enc = async (b: ImageBitmap) => `data:image/jpeg;base64,${(b as unknown as Bmp).tag}`;
const later = <T>(ms: number, v: T) => new Promise<T>((ok) => setTimeout(() => ok(v), ms));

test('a frame copied in time is the save\'s picture', async () => {
  const lates: string[] = [];
  const r = await thumbOfFrame(later(5, new Bmp('now') as unknown as ImageBitmap), enc, (u) => lates.push(u), 200);
  assert.deepEqual(r, { url: 'data:image/jpeg;base64,now', late: false, failed: false });
  await later(30, 0);
  assert.equal(lates.length, 0);
});

test('a frame copy slower than the wait: no picture now (not an earlier one), the save\'s own when it comes', async () => {
  const lates: string[] = [];
  const t0 = Date.now();
  const r = await thumbOfFrame(later(120, new Bmp('slow') as unknown as ImageBitmap), enc, (u) => lates.push(u), 30, 5000);
  assert.ok(Date.now() - t0 < 110, 'the save does not wait for the slow copy');
  assert.deepEqual(r, { url: null, late: true, failed: false });
  assert.equal(lates.length, 0);
  await later(150, 0);
  assert.deepEqual(lates, ['data:image/jpeg;base64,slow'], 'the late picture is handed on');
});

test('a copy later than the late window is let go (closed), and a failed copy falls back', async () => {
  const lates: string[] = [];
  const b = new Bmp('stale');
  const r = await thumbOfFrame(later(80, b as unknown as ImageBitmap), enc, (u) => lates.push(u), 10, 20);
  assert.equal(r.late, true);
  await later(120, 0);
  assert.equal(lates.length, 0);
  assert.equal(b.closed, true, 'the bitmap is released');
  const f = await thumbOfFrame(Promise.resolve(null), enc, undefined, 50);
  assert.deepEqual(f, { url: null, late: false, failed: true }, 'no bitmap: the caller takes its fallback');
  const rej = await thumbOfFrame(Promise.reject(new Error('lost')), enc, undefined, 50);
  assert.equal(rej.failed, true);
});

test('a frame in time but an encode slower than the wait (cold worker, slow software GPU): the save does not wait, the picture comes late', async () => {
  const lates: string[] = [];
  const slowEnc = (b: ImageBitmap) => later(120, `data:image/jpeg;base64,${(b as unknown as Bmp).tag}`);
  const t0 = Date.now();
  const r = await thumbOfFrame(later(2, new Bmp('enc') as unknown as ImageBitmap), slowEnc, (u) => lates.push(u), 30, 5000);
  assert.ok(Date.now() - t0 < 110, 'the save does not wait for the slow encode');
  assert.deepEqual(r, { url: null, late: true, failed: false });
  await later(150, 0);
  assert.deepEqual(lates, ['data:image/jpeg;base64,enc'], 'the encoded picture is handed on');
  // an encode past the late window, or one that gives nothing, hands nothing on
  const l2: string[] = [];
  await thumbOfFrame(later(2, new Bmp('x') as unknown as ImageBitmap), (b) => later(100, `u${(b as unknown as Bmp).tag}`), (u) => l2.push(u), 10, 30);
  await thumbOfFrame(later(2, new Bmp('y') as unknown as ImageBitmap), () => later(40, null), (u) => l2.push(u), 10, 5000);
  await thumbOfFrame(later(2, new Bmp('z') as unknown as ImageBitmap), () => Promise.reject(new Error('worker')), (u) => l2.push(u), 10, 5000);
  await later(150, 0);
  assert.deepEqual(l2, []);
});

test('end to end: a late encode is patched onto the save it was taken for (SaveStore.setThumb via withLateThumb)', async () => {
  const slot = { id: 'auto1', tick: 92, date: 777, thumb: null as string | null, name: 'Autosave' };
  const late = (url: string): void => { const n = withLateThumb(slot, 92, 777, url); if (n) slot.thumb = n.thumb; };
  const r = await thumbOfFrame(later(1, new Bmp('w') as unknown as ImageBitmap), (b) => later(60, `J${(b as unknown as Bmp).tag}`), late, 20, 5000);
  slot.thumb = r.url; // the write
  assert.equal(slot.thumb, null);
  await later(100, 0);
  assert.equal(slot.thumb, 'Jw', 'the slot gets its own picture');
});

test('the worker limit covers the late window, and the worker is warmed when a world starts', () => {
  const src = readFileSync(new URL('../src/client/thumbjpeg.ts', import.meta.url), 'utf8');
  const n = (k: string) => Number(src.match(new RegExp(`export const ${k} = ([\\d_]+)`))![1].replace(/_/g, ''));
  assert.ok(n('THUMB_WORKER_MS') >= n('THUMB_WAIT_MS') + n('THUMB_LATE_MS'));
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /warmThumbWorker\(\);/);
});

test('the late picture goes on its own save only: not on a newer save in the slot, not over a picture', () => {
  const rec = { id: 'auto1', tick: 5000, date: 111, thumb: null as string | null, name: 'x' };
  assert.deepEqual(withLateThumb(rec, 5000, 111, 'P'), { ...rec, thumb: 'P' });
  assert.equal(withLateThumb(rec, 6000, 222, 'P'), null, 'a newer save went into the slot');
  assert.equal(withLateThumb({ ...rec, date: 222 }, 5000, 111, 'P'), null, 'same tick (paused), another write');
  assert.equal(withLateThumb({ ...rec, thumb: 'Q' }, 5000, 111, 'P'), null, 'it has its own picture');
});

test('the wiring: app.thumb hands `late` through; writeSlot gives it the save it was taken for and writes the same date', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /thumbOfFrame\(frame, \(b\) => encodeThumb\(b, 0\.8\), late\)/);
  assert.match(app, /thumb: \(late\?: \(url: string\) => void\) => this\.thumb\(late\)/);
  assert.doesNotMatch(app, /ok\('late'\), 8000/, 'the old drop-on-late race is gone');
  const saves = readFileSync(new URL('../src/ui/saves.ts', import.meta.url), 'utf8');
  assert.match(saves, /this\.deps\.thumb\(late\)/);
  assert.match(saves, /patchThumb\(id, hdr\.tick, date, url\)/);
  assert.match(saves, /tick: hdr\.tick, date, /);
  const shell = readFileSync(new URL('../src/ui/shell.ts', import.meta.url), 'utf8');
  assert.match(shell, /thumb: \(late\) => deps\.thumb\(late\)/);
});

import { test, assert, eq } from './lib/harness.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSave, sanitize, defaults, SAVE_KEY } from '../src/save.js';

function memStore(initial) {
  const m = new Map(initial ? [[SAVE_KEY, initial]] : []);
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

test('the save key is the published one', () => {
  eq(SAVE_KEY, 'dewpoint.save.v1');
});

test('first run: defaults, exact published shape', () => {
  const s = createSave(memStore());
  const d = s.load();
  eq(d, { v: 1, levels: {}, last: '', settings: { music: 0.6, sfx: 0.8, muted: false, quality: 'auto', invertY: false, sensitivity: 1, reducedMotion: false } });
  eq(s.loadStatus, 'missing');
  assert(s.persistent);
});

test('round trip through storage', () => {
  const st = memStore();
  const a = createSave(st); a.load();
  a.recordLevel('l01', { shards: [2, 0], timeMs: 61234.4 });
  a.setSetting('quality', 'low');
  a.setSetting('sensitivity', 1.5);
  a.setLast('l02');
  const b = createSave(st); b.load();
  eq(b.data.levels.l01, { done: true, shards: [0, 2], bestMs: 61234 });
  eq(b.data.settings.quality, 'low');
  eq(b.data.settings.sensitivity, 1.5);
  eq(b.data.last, 'l02');
  eq(Object.keys(JSON.parse(st.m.get(SAVE_KEY))).sort(), ['last', 'levels', 'settings', 'v']);
});

test('recordLevel merges: shards are a union, best time only improves, done never reverts', () => {
  const s = createSave(memStore()); s.load();
  s.recordLevel('a', { shards: [1], timeMs: 50000 });
  s.recordLevel('a', { shards: [0], timeMs: 70000 });
  eq(s.level('a'), { done: true, shards: [0, 1], bestMs: 50000 });
  s.recordLevel('a', { shards: [], timeMs: 30000 });
  eq(s.level('a'), { done: true, shards: [0, 1], bestMs: 30000 });
  s.recordLevel('a', { shards: [2, 2, 7, -1, 1.5, 'x'], timeMs: NaN });
  eq(s.level('a'), { done: true, shards: [0, 1, 2], bestMs: 30000 });
  eq(s.totalShards(), 3);
  eq(s.level('never'), { done: false, shards: [], bestMs: 0 });
});

test('corrupt JSON falls back to defaults without throwing', () => {
  for (const junk of ['{', 'not json', '{"v":1,"levels":', '\u0000\u0001', 'undefined']) {
    const s = createSave(memStore(junk));
    eq(s.load(), defaults(), `junk ${JSON.stringify(junk)}`);
    eq(s.loadStatus, 'corrupt');
  }
});

test('valid JSON of the wrong type falls back to defaults', () => {
  for (const junk of ['null', '42', '"str"', '[]', 'true', '[1,2,3]']) {
    const s = createSave(memStore(junk));
    eq(s.load(), defaults(), `junk ${junk}`);
  }
});

test('partial data keeps what is valid and fills the rest', () => {
  const s = createSave(memStore(JSON.stringify({ levels: { l01: { done: true } }, settings: { music: 0.25 } })));
  const d = s.load();
  eq(d.levels.l01, { done: true, shards: [], bestMs: 0 });
  eq(d.settings.music, 0.25);
  eq(d.settings.sfx, 0.8);
  eq(d.last, '');
  eq(d.v, 1);
});

test('wrongly typed fields are replaced one by one, not wholesale', () => {
  const d = sanitize({
    v: 'one',
    levels: { ok: { done: true, shards: [0, 1, 2], bestMs: 1000 }, bad1: null, bad2: 'x', bad3: { done: 'yes', shards: 'all', bestMs: -5 }, bad4: { shards: [0, 0, 3, 99, null, '1', 2.5, 2] } },
    last: 12,
    settings: { music: 7, sfx: -3, muted: 'no', quality: 'ultra', invertY: 1, sensitivity: 1e9, reducedMotion: null },
  });
  eq(d.v, 1);
  eq(d.levels.ok, { done: true, shards: [0, 1, 2], bestMs: 1000 });
  eq(d.levels.bad1, { done: false, shards: [], bestMs: 0 });
  eq(d.levels.bad2, { done: false, shards: [], bestMs: 0 });
  eq(d.levels.bad3, { done: false, shards: [], bestMs: 0 });
  eq(d.levels.bad4, { done: false, shards: [0, 2], bestMs: 0 });
  eq(d.last, '');
  eq(d.settings, { music: 1, sfx: 0, muted: false, quality: 'auto', invertY: false, sensitivity: 3, reducedMotion: false });
});

test('non-finite numbers and hostile keys are neutralised', () => {
  const raw = JSON.parse('{"levels":{"__proto__":{"done":true},"constructor":{"done":true},"x":{"bestMs":1e999}},"settings":{"music":null,"sensitivity":"fast"}}');
  const d = sanitize(raw);
  eq(Object.keys(d.levels), ['x']);
  eq(d.levels.x.bestMs, 0);
  eq(d.settings.music, 0.6);
  eq(d.settings.sensitivity, 1);
  eq({}.done, undefined, 'Object.prototype must not be polluted');
});

test('unknown fields from a newer build survive a rewrite', () => {
  const st = memStore(JSON.stringify({ v: 1, future: { a: 1 }, levels: { l01: { done: true, shards: [1], bestMs: 5, medal: 'gold' } }, last: 'l01', settings: { music: 0.5, haptics: true } }));
  const s = createSave(st); s.load();
  s.setSetting('sfx', 0.3);
  const back = JSON.parse(st.m.get(SAVE_KEY));
  eq(back.future, { a: 1 });
  eq(back.levels.l01.medal, 'gold');
  eq(back.settings.haptics, true);
  eq(back.settings.sfx, 0.3);
});

test('storage that throws on read: game runs on in-memory defaults', () => {
  const s = createSave({ getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } });
  eq(s.load(), defaults());
  eq(s.loadStatus, 'unavailable');
  assert(!s.persistent);
  s.recordLevel('l01', { shards: [0], timeMs: 1000 });          // must not throw
  eq(s.level('l01').done, true, 'progress is still tracked in memory');
  eq(s.write(), false);
});

test('storage that throws on write (quota): no throw, flagged non-persistent, memory copy intact', () => {
  const st = memStore();
  st.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
  const s = createSave(st); s.load();
  assert(s.persistent);
  s.setSetting('muted', true);
  assert(!s.persistent);
  eq(s.data.settings.muted, true);
});

test('no storage at all (null) behaves like unavailable', () => {
  const s = createSave(null);
  eq(s.load(), defaults());
  assert(!s.persistent);
  eq(s.write(), false);
});

test('default storage lookup does not throw in Node (no localStorage global)', () => {
  const s = createSave();
  s.load();
  s.setSetting('music', 0.1);
  eq(s.data.settings.music, 0.1);
});

test('setSetting validates through the same sanitiser', () => {
  const s = createSave(memStore()); s.load();
  eq(s.setSetting('quality', 'potato'), 'auto');
  eq(s.setSetting('music', 5), 1);
  eq(s.setSetting('sensitivity', 0), 0.2);
  eq(s.setSetting('invertY', true), true);
});

test('first-run setting defaults can be overridden (e.g. OS reduced motion) but never beat saved values', () => {
  const fresh = createSave(memStore(), { reducedMotion: true }); fresh.load();
  eq(fresh.data.settings.reducedMotion, true);
  const saved = createSave(memStore(JSON.stringify({ settings: { reducedMotion: false } })), { reducedMotion: true }); saved.load();
  eq(saved.data.settings.reducedMotion, false);
});

test('resetProgress wipes levels but keeps settings', () => {
  const s = createSave(memStore()); s.load();
  s.recordLevel('a', { shards: [0], timeMs: 1 }); s.setSetting('music', 0.2);
  s.resetProgress();
  eq(s.data.levels, {}); eq(s.data.settings.music, 0.2);
});

// ---- architecture rules that are cheap to enforce here ----
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('localStorage is referenced only in src/save.js', () => {
  const offenders = walk(path.join(root, 'src')).filter((f) => /\.(js|css|html)$/.test(f))
    .filter((f) => path.basename(f) !== 'save.js' && /localStorage|sessionStorage/.test(readFileSync(f, 'utf8')));
  const index = readFileSync(path.join(root, 'index.html'), 'utf8');
  if (/localStorage|sessionStorage/.test(index)) offenders.push('index.html');
  eq(offenders.map((f) => path.relative(root, f)), []);
});

test('src/sim is DOM-free and three-free', () => {
  const bad = [];
  for (const f of walk(path.join(root, 'src', 'sim'))) {
    const t = readFileSync(f, 'utf8');
    if (/\b(document|window|navigator|requestAnimationFrame)\b|three\.module|from ['"]three/.test(t)) bad.push(path.relative(root, f));
  }
  eq(bad, []);
});

test('nothing in the shipped game references an http(s) URL', () => {
  const files = [path.join(root, 'index.html'), ...walk(path.join(root, 'src'))].filter((f) => /\.(js|css|html)$/.test(f));
  const bad = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      // the SVG/XHTML namespace strings are identifiers, never fetched
      const stripped = l.replace(/http:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink)/g, '');
      if (/https?:\/\//.test(stripped)) bad.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
  eq(bad, []);
});

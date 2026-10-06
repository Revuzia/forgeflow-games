// Collection probe (plain node, exits 1 on any failure): the client-only PRACTICE collection of _spec/COLLECTION.md (phase P2's logic and
// the ghost side of P3) and the core/save.ts audit fixes. Acceptance tests C01-C09, C11, C12 of COLLECTION section 11 as they apply to the
// practice ledger (C10 is probe_collection_imports.ts; the ghost merge is probe_merge.ts), plus this lane's own checks:
//   A  core/save.ts: migrations, newer genomes, the protected backup slot, sanitising, two tabs, dropped writes
//   C  COLLECTION 11 C01..C12
//   P  the practice economy: determinism, table cap, odds, shelf cap, restock, tasks, hearts, the feed's clock and allocations,
//      two tabs on the v2 save, storage failures, copy, the interface
// Deterministic: every clock and random source is injected; no timers run (writes are flushed by hand).
import v8 from 'node:v8';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { SoftEvent, SoftEventKind } from '../src/contracts.ts';
import { GENOME_VERSION, encodeGenome, genomeEquals, makeStarterGenome, newInstance } from '../src/core/genome.ts';
import type { Genome, SquishyInstance } from '../src/core/genome.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { addInteraction, createMeter, DAY_MS, previewInteraction } from '../src/core/meter.ts';
import type { Interaction, InteractionDetail, MeterState } from '../src/core/meter.ts';
import { TASK_DEFS, TASKS_MAX_PER_WEEK, RESTOCK_POOL, weekKeyOf } from '../src/core/drops.ts';
import { TIER_ODDS, TIER_COUNT } from '../src/core/rarity.ts';
import {
  GENOME_MIGRATIONS, PROFILE_BACKUP_KEY, PROFILE_KEY, PROFILE_MIGRATIONS, PROFILE_VERSION, PARENTS_MAX as PROFILE_PARENTS_MAX, createProfileStore,
  loadProfile, migrateVersioned, parseProfile, profileSalvageValue, readProfile, saveProfile, freshProfile,
} from '../src/core/save.ts';
import type { StorageSubscribe } from '../src/core/save.ts';
import { guardStorage, memoryStorage } from '../src/core/settings.ts';
import type { StorageLike } from '../src/core/settings.ts';
import { CATALOG, SPECIES, speciesBaseGenome } from '../src/data/catalog.ts';
import { createCollection } from '../src/collection/index.ts';
import type { Collection, CollectionEvent, HoardItem, HoardSave, MirrorRow } from '../src/collection/index.ts';
import {
  GHOST_CAP, HOARD_BACKUP_KEY, HOARD_KEY, MAX_EVENTS_PER_BATCH, PENDING_TTL_MS, TASK_CAPSULE_CAP, WH_QUEUE_MAX,
} from '../src/collection/constants.ts';
import {
  FLAG_FAV, FLAG_OFFERED, FLAG_RESERVED, FLAG_SEEN, emptyHoard, forgetAccount, freshHoard, loadHoard, makeRow, rebaseHoard, rowToItem, sanitizeHoard,
  serializeHoard,
} from '../src/collection/store.ts';
import { buildStacks, filterStacks, sortStacks, tidyCandidates } from '../src/collection/stacks.ts';
import {
  bumpTasks, createFeedOutcome, dayOf, findGhostIds, ghostClaimRestock, ghostCompleteTask, ghostFeed, ghostOpen, ghostRestockView, ghostTaskRows,
  practiceTasksFor,
} from '../src/collection/ghost.ts';
import { createMappedTouch, createPreviewMeter, createTouchBuffer, foldMeter, mapSoftEvent } from '../src/collection/meterfeed.ts';
import type { MappedTouch } from '../src/collection/meterfeed.ts';
import { COPY, loadStatusCopy, mergeRuleCopy, meterCopy, plinthLabel, saveStateCopy } from '../src/collection/copy.ts';
import { MERGE_COST } from '../src/core/merge.ts';

let bad = 0;
let total = 0;
const check = (id: string, name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${name}${extra ? '  ' + extra : ''}`); };
const section = (s: string): void => console.log(`\n== ${s}`);
const here = dirname(fileURLToPath(import.meta.url));

/* ───────────────────────────── helpers ───────────────────────────── */

const T0 = Date.UTC(2026, 9, 5, 9, 0, 0); // a Monday, 09:00 UTC
let T = T0;
const now = (): number => T;
const V = { x: 0, y: 0, z: 0 }, N = { x: 0, y: 1, z: 0 };
const ev = (kind: SoftEventKind, intensity = 0.5, heldFor = 0): SoftEvent => ({ kind, at: V, normal: N, intensity, heldFor, finger: 0 });
const timers: Array<() => void> = [];
const fakeTimers = { setTimer: (fn: () => void): unknown => { timers.push(fn); return fn; }, clearTimer: (h: unknown): void => { const i = timers.indexOf(h as () => void); if (i >= 0) timers.splice(i, 1); } };
const mk = (storage: StorageLike | null, seed = 1, extra: Partial<Parameters<typeof createCollection>[0]> = {}): Collection =>
  createCollection({ storage, now, random: mulberry32(seed), ...fakeTimers, ...extra });
const stored = (m: StorageLike): HoardSave => JSON.parse(m.getItem(HOARD_KEY)!) as HoardSave;
const counting = (seed: number): { fn: () => number; n: () => number } => { const r = mulberry32(seed); let k = 0; return { fn: () => { k++; return r(); }, n: () => k }; };
/** Feed a varied, human-paced stream (poke / long squeeze / pull, 1.1 s apart) of `n` touches through the collection. */
function play(c: Collection, n: number, stepMs = 1100): void {
  for (let i = 0; i < n; i++) {
    T += stepMs;
    const k = i % 3;
    c.feed(k === 0 ? ev('poke') : k === 1 ? ev('release', 0.5, 1.2) : ev('snap', 0.6), T);
  }
}
const uuidLike = (r: () => number): string => {
  const h = (n: number): string => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-a${h(3)}-${h(12)}`;
};
/** Several "tabs" over one storage: a write in one tab fires the others' subscriptions (the browser's 'storage' event semantics). */
function makeTabs(inner: StorageLike, n: number): { storage: StorageLike; subscribe: StorageSubscribe }[] {
  const subs: Array<Set<(k: string | null) => void>> = Array.from({ length: n }, () => new Set());
  return Array.from({ length: n }, (_, i) => ({
    storage: {
      getItem: (k: string) => inner.getItem(k),
      setItem: (k: string, v: string) => { inner.setItem(k, v); subs.forEach((s, j) => { if (j !== i) for (const fn of s) fn(k); }); },
      removeItem: (k: string) => { inner.removeItem(k); subs.forEach((s, j) => { if (j !== i) for (const fn of s) fn(k); }); },
    },
    subscribe: (fn: (k: string | null) => void) => { subs[i].add(fn); return () => { subs[i].delete(fn); }; },
  }));
}
const v1Profile = (mem: StorageLike, id: string, pokes: number): SquishyInstance => {
  const st = createProfileStore(mem, { makeInstance: () => newInstance(makeStarterGenome(), { kind: 'starter' }, 'Dollop', id, T0 - DAY_MS), ...fakeTimers });
  for (let i = 0; i < pokes; i++) st.bump('pokes');
  st.flush();
  return st.profile.instance;
};
const throwing: StorageLike = { getItem(): string | null { throw new Error('SecurityError'); }, setItem(): void { throw new Error('QuotaExceededError'); }, removeItem(): void { throw new Error('x'); } };

/* ═════════════════════════════ A. core/save.ts audit fixes ═════════════════════════════ */
section('A  core/save.ts: migration, sanitising, two tabs');
{
  // A1 the migration machinery (the tables are empty while v1 is the only format, so it is exercised with test steps)
  const steps = { 1: (x: Record<string, unknown>) => ({ ...x, v: 2, added: true }), 2: (x: Record<string, unknown>) => ({ ...x, v: 3, renamed: x.added }) };
  const input = { v: 1, keep: 'me' };
  const m = migrateVersioned(input, 3, steps);
  check('A01', 'migrateVersioned runs every step in order (v1 -> v3) and reports where it started; the input is not mutated',
    m.ok && m.from === 1 && m.value.v === 3 && m.value.renamed === true && m.value.keep === 'me' && JSON.stringify(input) === '{"v":1,"keep":"me"}');
  const r2 = migrateVersioned({ v: 1 }, 3, { 1: steps[1] });
  const r3 = migrateVersioned({ v: 4 }, 3, steps);
  const r4 = [{ v: 1.5 }, { v: '1' }, {}, null, [], 7].map((x) => migrateVersioned(x, 3, steps));
  const r5 = migrateVersioned({ v: 1 }, 2, { 1: (x: Record<string, unknown>) => ({ ...x, v: 5 }) });
  const r6 = migrateVersioned({ v: 1 }, 2, { 1: () => { throw new Error('boom'); } });
  check('A02', 'a missing step, a wrong output version or a throwing step is "unmigratable"; a version above the target is "newer"; junk never throws',
    !r2.ok && r2.why === 'unmigratable' && !r3.ok && r3.why === 'newer' && r4.every((r) => !r.ok && r.why === 'unmigratable') && !r5.ok && !r6.ok);
  const covered = (tab: Readonly<Record<number, unknown>>, top: number): boolean => { for (let v = 1; v < top; v++) if (typeof tab[v] !== 'function') return false; return true; };
  check('A03', `PROFILE_MIGRATIONS covers 1..${PROFILE_VERSION - 1} and GENOME_MIGRATIONS covers 1..${GENOME_VERSION - 1} (a version bump without its step fails here)`,
    covered(PROFILE_MIGRATIONS, PROFILE_VERSION) && covered(GENOME_MIGRATIONS, GENOME_VERSION));

  // A4 a genome written by a newer build: 'newer', never overwritten (it used to read as corrupt and replace the squishy and its id)
  const mem = memoryStorage();
  v1Profile(mem, 'stable-id-0001', 3);
  const good = mem.getItem(PROFILE_KEY)!;
  const future = JSON.parse(good); future.instance.genome.v = GENOME_VERSION + 1; future.instance.genome.newField = 7;
  const fm = memoryStorage({ [PROFILE_KEY]: JSON.stringify(future) });
  const before = fm.getItem(PROFILE_KEY);
  const fs = createProfileStore(fm, fakeTimers); fs.bump('pokes'); fs.flush(); fs.dispose();
  check('A04', 'a profile whose genome is NEWER than this build loads as "newer": the key stays byte-identical and nothing is parked',
    loadProfile(fm).status === 'newer' && fs.status === 'newer' && fm.getItem(PROFILE_KEY) === before && fm.getItem(PROFILE_BACKUP_KEY) === null && readProfile(fm).status === 'newer');

  // A5 the backup slot keeps the more recoverable blob
  const damaged = JSON.parse(good); delete damaged.v; // the squishy is intact, the envelope is not
  const bm = memoryStorage({ [PROFILE_KEY]: JSON.stringify(damaged) });
  const b1 = loadProfile(bm);
  const kept = bm.getItem(PROFILE_BACKUP_KEY);
  bm.setItem(PROFILE_KEY, '{junk');
  const b2 = loadProfile(bm);
  const afterJunk = bm.getItem(PROFILE_BACKUP_KEY);
  const jm = memoryStorage({ [PROFILE_BACKUP_KEY]: 'old junk', [PROFILE_KEY]: '{new junk' });
  loadProfile(jm);
  check('A05', 'a backup that holds a readable squishy is never replaced by junk; junk replaces junk (newest wins); an empty slot takes anything',
    b1.status === 'corrupt' && kept === JSON.stringify(damaged) && profileSalvageValue(kept) === 2 && b2.status === 'corrupt' && afterJunk === kept && jm.getItem(PROFILE_BACKUP_KEY) === '{new junk');

  // A6 sanitising: unknown genome keys and unbounded parents are not kept or re-saved
  const dirty = JSON.parse(good);
  dirty.instance.genome.evil = 'x'.repeat(5000);
  dirty.instance.genome.__proto_like = { a: 1 };
  dirty.instance.origin = { kind: 'blend', parents: ['p-1', 5, 'y'.repeat(129), '', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9', 'p-10'] };
  dirty.instance.extra = 'z';
  const dm = memoryStorage({ [PROFILE_KEY]: JSON.stringify(dirty) });
  const ds = createProfileStore(dm, fakeTimers); ds.bump('pulls'); ds.flush();
  const resaved = dm.getItem(PROFILE_KEY)!;
  const gk = Object.keys(ds.profile.instance.genome).sort().join();
  const parents = ds.profile.instance.origin.parents ?? [];
  check('A06', `a stored genome keeps only the Genome keys and parent ids are bounded (strings of 1..128, at most ${PROFILE_PARENTS_MAX}); the re-saved text carries neither the junk keys nor the long strings`,
    ds.status === 'ok' && !gk.includes('evil') && !gk.includes('__proto_like') && Object.keys(makeStarterGenome()).sort().join() === gk && parents.length === PROFILE_PARENTS_MAX
    && parents.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 128) && !resaved.includes('evil') && !resaved.includes('yyyy') && !resaved.includes('"extra"') && ds.profile.instance.id === 'stable-id-0001',
    `${parents.length} parents kept, ${resaved.length} chars re-saved`);
  const rs = JSON.parse(good); rs.instance.origin = { kind: 'restock' };
  const rp = parseProfile(rs);
  check('A07', "origin 'restock' (COLLECTION 3.5) loads and round-trips", !!rp && rp.instance.origin.kind === 'restock' && parseProfile(JSON.parse(JSON.stringify(rp)))?.instance.origin.kind === 'restock');

  // A8 two tabs on one profile: counters merge, nothing is clobbered
  const tm = memoryStorage();
  v1Profile(tm, 'tab-id-0001', 0);
  const a = createProfileStore(tm, fakeTimers), b = createProfileStore(tm, fakeTimers);
  for (let i = 0; i < 3; i++) a.bump('pokes');
  a.flush();
  b.bump('pulls'); b.bump('pulls'); b.flush();
  a.bump('pokes'); a.flush();
  const st = JSON.parse(tm.getItem(PROFILE_KEY)!).stats;
  check('A08', 'two tabs bumping one profile: the stored counters are the sum of both (pokes 4, pulls 2), each store detected the other (was: the last writer wins)',
    st.pokes === 4 && st.pulls === 2 && (a.conflicts ?? 0) >= 1 && (b.conflicts ?? 0) >= 1 && a.profile.stats.pulls === 2 && b.profile.stats.pokes === 3, JSON.stringify(st));
  // the instance another tab wrote first wins, in place (the shell holds a reference)
  const im = memoryStorage();
  v1Profile(im, 'first-tab-01', 0);
  const c = createProfileStore(im, fakeTimers);
  const ref = c.profile.instance;
  const other = freshProfile({ makeInstance: () => newInstance(makeStarterGenome(), { kind: 'starter' }, 'Dollop', 'second-tab-02', T0) });
  other.stats.squishes = 9;
  saveProfile(im, other);
  c.bump('pokes'); c.flush();
  const sx = JSON.parse(im.getItem(PROFILE_KEY)!);
  check('A09', "another tab's instance is adopted in place (same object, its id) and its counters kept, plus this tab's own delta",
    c.profile.instance === ref && ref.id === 'second-tab-02' && sx.instance.id === 'second-tab-02' && sx.stats.squishes === 9 && sx.stats.pokes === 1);
  // the injected subscription: an idle tab adopts without writing
  const shared = memoryStorage();
  v1Profile(shared, 'sub-id-0001', 0);
  const [t1, t2] = makeTabs(shared, 2);
  const p1 = createProfileStore(t1.storage, { ...fakeTimers, subscribe: t1.subscribe });
  const p2 = createProfileStore(t2.storage, { ...fakeTimers, subscribe: t2.subscribe });
  const w2 = p2.writes;
  for (let i = 0; i < 5; i++) p1.bump('squishes');
  p1.flush();
  check('A10', "with the injected 'storage' subscription an idle tab adopts the other tab's profile at once and writes nothing",
    p2.profile.stats.squishes === 5 && p2.writes === w2);
  p1.dispose(); p2.dispose();
  // a newer build in another tab: stop writing
  const nm = memoryStorage();
  v1Profile(nm, 'newer-tab-01', 0);
  const n1 = createProfileStore(nm, fakeTimers);
  nm.setItem(PROFILE_KEY, JSON.stringify({ v: PROFILE_VERSION + 1, instance: { future: true } }));
  const nt = nm.getItem(PROFILE_KEY);
  n1.bump('pokes'); n1.flush(); n1.bump('pokes'); n1.flush();
  check('A11', 'a profile written meanwhile by a NEWER build in another tab is never overwritten', nm.getItem(PROFILE_KEY) === nt);
  check('A12', 'saveProfile reports a write that a guarded storage silently dropped (false), and never throws',
    saveProfile(guardStorage(throwing), freshProfile()) === false && saveProfile(throwing, freshProfile()) === false && saveProfile(null, freshProfile()) === false);
}

/* ═════════════════════════════ C. COLLECTION section 11 ═════════════════════════════ */
section('C  COLLECTION.md section 11 (practice ledger)');
{
  // C01 migration from the v1 profile
  T = T0;
  const mem = memoryStorage();
  const inst = v1Profile(mem, 'aaaaaaaa-1111-4222-a333-444444444444', 1234);
  const v1Text = mem.getItem(PROFILE_KEY)!;
  const c = mk(mem);
  const first = c.items()[0];
  check('C01', 'a v1 profile with 1234 pokes migrates: v2 written, ghost one is the starter with the SAME id, the v1 key is byte-identical',
    c.storage().load === 'migrated' && c.items().length === 1 && first.id === inst.id && first.origin === 'starter' && first.ghost && first.ledger === 'practice'
    && genomeEquals(first.genome, inst.genome) && mem.getItem(HOARD_KEY) !== null && stored(mem).migratedFromV1 === true && mem.getItem(PROFILE_KEY) === v1Text);
  play(c, 600);
  let opened1 = 0;
  for (let i = 0; i < 4; i++) if ((await c.openCapsule()).ok) opened1++;
  c.flush(); c.dispose();
  const again = mk(mem);
  check('C01', 'after a session (touches, capsules opened, flushed) the v1 key is still byte-identical and nothing was parked; a reload reads v2 as stored',
    opened1 > 0 && mem.getItem(PROFILE_KEY) === v1Text && mem.getItem(PROFILE_BACKUP_KEY) === null && again.storage().load === 'ok' && again.items().length === 1 + opened1 && again.items()[0].id === inst.id,
    `${opened1} opened`);
  again.dispose();
  // the shell's own profile store passed in: same id even on a first visit
  const fresh = memoryStorage();
  const shellStore = createProfileStore(fresh, fakeTimers);
  const c2 = mk(fresh, 2, { profile: shellStore.profile });
  check('C01', "with the shell's loaded profile passed in (deps.profile) the starter ghost has the shell's starter id on a first visit",
    c2.items()[0].id === shellStore.profile.instance.id && c2.storage().load === 'migrated');
  c2.dispose();

  // C02 corrupt v2 parks and boots; v:3 is read-only
  const cm = memoryStorage({ [HOARD_KEY]: '{"v":2,"ghosts":[' });
  const cv1 = v1Profile(cm, 'bbbbbbbb-1111-4222-a333-444444444444', 0);
  const cc = mk(cm);
  check('C02', 'a corrupt v2 blob is parked in the .unreadable key, the app boots (from the v1 starter), the status is "recovered" with plain copy',
    cc.storage().load === 'recovered' && cc.storage().parked && cm.getItem(HOARD_BACKUP_KEY) === '{"v":2,"ghosts":[' && cc.items()[0].id === cv1.id
    && sanitizeHoard(stored(cm), T, mulberry32(1)) !== null && typeof loadStatusCopy('recovered') === 'string');
  const broken = memoryStorage({ [HOARD_KEY]: JSON.stringify({ v: 2, ghosts: 'nope', deviceId: 5 }) });
  const bc = mk(broken);
  check('C02', 'a v2 envelope without a ghost list is parked too and a fresh shelf starts (one starter ghost)', bc.storage().load === 'recovered' && broken.getItem(HOARD_BACKUP_KEY) !== null && bc.items().length === 1);
  const v3Text = JSON.stringify({ v: 3, ghosts: [['future']], newThing: true });
  const nm = memoryStorage({ [HOARD_KEY]: v3Text });
  const nc = mk(nm);
  play(nc, 300); await nc.openCapsule(); await nc.setFav([nc.items()[0].id], true); nc.flush(); nc.dispose();
  check('C02', 'a v:3 blob is read-only: the session runs in memory, the key is byte-identical afterwards, nothing parked, save state "off"',
    nc.storage().load === 'newer' && nc.storage().save === 'off' && nm.getItem(HOARD_KEY) === v3Text && nm.getItem(HOARD_BACKUP_KEY) === null && nc.items().length >= 1);
  // the v2 backup slot keeps the more recoverable blob too
  const goodSave = serializeHoard(freshHoard(T, mulberry32(9)));
  const pm = memoryStorage({ [HOARD_BACKUP_KEY]: goodSave, [HOARD_KEY]: '{junk' });
  mk(pm).dispose();
  check('C02', 'a v2 backup holding readable ghosts is never replaced by a junk blob', pm.getItem(HOARD_BACKUP_KEY) === goodSave);

  // C03 every row is validated on load
  const r = mulberry32(3);
  const base = freshHoard(T, r);
  const dollop = encodeGenome(makeStarterGenome());
  const plumpet = encodeGenome(speciesBaseGenome('plumpet', 11));
  const okRows: unknown[] = [
    makeRow('g-good00000001', speciesBaseGenome('plumpet', 11), T, FLAG_SEEN, 'drop'),
    ['g-good00000002', 1, plumpet, T + 1, FLAG_FAV | FLAG_OFFERED | FLAG_RESERVED, 7, 0, 1],
    ['g-good00000003', 0, dollop, T + 2, 0, 0, T + DAY_MS, 4, ['g-par000000001', 5, 'q'.repeat(100), 'g-par000000002', 'g-par000000003', 'g-par000000004']],
  ];
  const badRows: Array<[string, unknown]> = [
    ['bad genome code', ['g-bad000000001', 0, 'g1.garbage', T, 0, 0, 0, 1]],
    ['unknown species index 50', ['g-bad000000002', 50, dollop, T, 0, 0, 0, 1]],
    ['species index that does not match the code', ['g-bad000000003', 1, dollop, T, 0, 0, 0, 1]],
    ['non-integer species index', ['g-bad000000004', 1.5, plumpet, T, 0, 0, 0, 1]],
    ['oversized id (65)', ['x'.repeat(65), 0, dollop, T, 0, 0, 0, 1]],
    ['id with bad characters', ['g-<script>', 0, dollop, T, 0, 0, 0, 1]],
    ['negative tradeCount', ['g-bad000000005', 0, dollop, T, 0, -1, 0, 1]],
    ['negative bornAt', ['g-bad000000006', 0, dollop, -5, 0, 0, 0, 1]],
    ['null lockedUntil', ['g-bad000000007', 0, dollop, T, 0, 0, null, 1]],
    ['unknown origin code', ['g-bad000000008', 0, dollop, T, 0, 0, 0, 9]],
    ['flags out of range', ['g-bad000000009', 0, dollop, T, 99, 0, 0, 1]],
    ['row too short', ['g-bad000000010', 0, dollop, T, 0, 0, 0]],
    ['not a row', { id: 'g-bad000000011' }],
    ['duplicate id', ['g-good00000001', 0, dollop, T, 0, 0, 0, 1]],
  ];
  const hostile = { ...JSON.parse(serializeHoard(base)), ghosts: [...JSON.parse(serializeHoard(base)).ghosts, ...okRows, ...badRows.map((b) => b[1])] };
  const hm = memoryStorage({ [HOARD_KEY]: JSON.stringify(hostile) });
  let hc: Collection | null = null;
  try { hc = mk(hm); } catch { hc = null; }
  const items = hc ? hc.items() : [];
  const g2 = items.find((i) => i.id === 'g-good00000002'), g3 = items.find((i) => i.id === 'g-good00000003');
  check('C03', `every row is validated: ${badRows.length} bad rows (${badRows.map((b) => b[0]).join('; ')}) are dropped, the 4 good ones kept, nothing throws`,
    !!hc && items.length === 4 && items.every((i) => /^[A-Za-z0-9_-]{1,64}$/.test(i.id)) && hc.storage().load === 'repaired', `${items.length} items, ${hc?.storage().load}`);
  check('C03', 'the dropped rows are not lost silently: the original save is parked byte for byte and the status says "repaired"',
    hm.getItem(HOARD_BACKUP_KEY) === JSON.stringify(hostile) && typeof loadStatusCopy('repaired') === 'string');
  check('C03', 'a ghost row cannot carry trade data (tradeCount 7 -> 0, offered and reserved cleared, the heart kept); a blend row keeps only valid parent ids (at most 3)',
    !!g2 && g2.tradeCount === 0 && !g2.offered && !g2.reserved && g2.fav && !!g3 && g3.origin === 'blend' && JSON.stringify(g3.parents) === '["g-par000000001","g-par000000002","g-par000000003"]' && g3.lockedUntil === T + DAY_MS);
  // fuzz: hostile saves never throw, never yield an undecodable or oversized item
  const fr = mulberry32(77);
  const junk = (d: number): unknown => {
    const k = Math.floor(fr() * 10);
    if (d > 3) return k < 5 ? fr() * 1e6 - 5e5 : 'x';
    return [null, -1, 1.5, 1e308, '', 'g1.AAAA', true, [], {}, Array.from({ length: Math.floor(fr() * 9) }, () => junk(d + 1))][k];
  };
  let fuzzOk = true, fuzzItems = 0;
  for (let i = 0; i < 400; i++) {
    const s = JSON.parse(serializeHoard(freshHoard(T, mulberry32(i)))) as Record<string, unknown>;
    const keys = Object.keys(s);
    for (let j = 0; j < 4; j++) s[keys[Math.floor(fr() * keys.length)]] = junk(0);
    const rows = Array.isArray(s.ghosts) ? s.ghosts as unknown[] : (s.ghosts = []) as unknown[];
    for (let j = 0; j < 20; j++) { const row = JSON.parse(JSON.stringify(okRows[j % 3])) as unknown[]; row[Math.floor(fr() * 9)] = junk(1); rows.push(row); }
    try {
      const fm = memoryStorage({ [HOARD_KEY]: JSON.stringify(s) });
      const fc = mk(fm, i);
      const its = fc.items();
      fuzzItems += its.length;
      if (!its.every((it) => /^[A-Za-z0-9_-]{1,64}$/.test(it.id) && encodeGenome(it.genome) === it.code && it.ghost && it.tradeCount === 0) || its.length > 128) fuzzOk = false;
      fc.meter(); fc.stacks(); fc.tasks(); fc.restock(); fc.dispose();
    } catch (e) { fuzzOk = false; console.log('  fuzz threw:', (e as Error).message); break; }
  }
  check('C03', '400 randomly damaged saves (junk in the envelope and in the rows) load without throwing; every surviving item decodes and is a valid ghost', fuzzOk, `${fuzzItems} items survived`);

  // C04 stacks
  const sr = mulberry32(44);
  const its: HoardItem[] = [];
  for (let i = 0; i < 260; i++) {
    const d = CATALOG[sr() < 0.7 ? Math.floor(sr() * 14) : Math.floor(sr() * CATALOG.length)];
    const flags = (sr() < 0.12 ? FLAG_FAV : 0) | (sr() < 0.7 ? FLAG_SEEN : 0) | (sr() < 0.05 ? FLAG_OFFERED | FLAG_RESERVED : 0);
    const row = makeRow(`g-${i.toString(36).padStart(12, '0')}`, speciesBaseGenome(d.id, i), T0 + Math.floor(sr() * 20) * 1000, flags, 'drop', sr() < 0.1 ? T + 3600_000 : 0);
    its.push(rowToItem(row, i < 220 ? 'practice' : 'real')!);
  }
  const ghostsOnly = its.filter((i) => i.ledger === 'practice'), realOnly = its.filter((i) => i.ledger === 'real');
  const stacks = buildStacks(its, 'practice', T);
  const keeperOk = stacks.every((s) => {
    const cs = ghostsOnly.filter((i) => i.species === s.species).sort((a, b) => a.bornAt - b.bornAt || (a.id < b.id ? -1 : 1));
    const want = cs.find((i) => i.fav) ?? cs[0];
    return s.copies === cs.length && s.keeper === (want ? want.id : null) && !s.spareIds.includes(s.keeper ?? '') && s.spares === Math.max(0, cs.length - 1) && s.spareIds.length === s.spares;
  });
  let shuffled = true;
  const ref = JSON.stringify(stacks);
  for (let k = 0; k < 20; k++) { const sh = its.slice(); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(sr() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; } if (JSON.stringify(buildStacks(sh, 'practice', T)) !== ref) shuffled = false; }
  const realStacks = buildStacks(its, 'real', T);
  check('C04', `buildStacks: ${stacks.length} entries in catalog order; copies sum to the ghost count; spares = copies - 1; keeper = first hearted else oldest (ties by id), never a spare`,
    stacks.length === 50 && stacks.every((s, i) => s.idx === i) && stacks.reduce((n, s) => n + s.copies, 0) === ghostsOnly.length && keeperOk);
  check('C04', 'shuffling the input 20 times changes nothing; real and ghost items never share a stack or a count',
    shuffled && realStacks.reduce((n, s) => n + s.copies, 0) === realOnly.length && stacks.every((s) => s.ledger === 'practice') && realStacks.every((s) => s.ledger === 'real'));
  const mergeOk = stacks.every((s) => s.mergeableIds.every((id) => { const it = ghostsOnly.find((g) => g.id === id)!; return id !== s.keeper && !it.fav && !it.reserved && !it.offered && !(it.lockedUntil !== null && it.lockedUntil > T); }));
  const plan = tidyCandidates(stacks, { includeRare: false, maxPairs: 10 });
  const planRare = tidyCandidates(stacks, { includeRare: true, maxPairs: 99 });
  const tierOfId = (id: string): number => ghostsOnly.find((g) => g.id === id)!.tierIdx;
  check('C04', `mergeable spares are never the keeper, hearted, locked, reserved or shelved; Tidy-up groups are ${MERGE_COST} of one species, Common/Uncommon by default, never Mythic, at most maxPairs`,
    mergeOk && plan.length <= 10 && plan.every((g) => g.length === MERGE_COST && g.every((id) => tierOfId(id) <= 1) && new Set(g.map((id) => ghostsOnly.find((x) => x.id === id)!.species)).size === 1)
    && planRare.every((g) => g.every((id) => tierOfId(id) < 5)) && planRare.length >= plan.length, `${plan.length} default groups, ${planRare.length} with Rare+`);
  const sortedName = sortStacks(stacks, 'name');
  const onlySpares = filterStacks(stacks, { view: 'cabinet', sort: 'tier', tiers: 0, lanes: 0, onlySpares: true, onlyMissing: false, onlyHearts: false, onlyShelf: false });
  const tierMask = filterStacks(stacks, { view: 'cabinet', sort: 'tier', tiers: 0b100, lanes: 0, onlySpares: false, onlyMissing: false, onlyHearts: false, onlyShelf: false });
  check('C04', 'sorts and filters: name order, "only spares", a tier chip (Rare only)',
    sortedName.every((s, i) => i === 0 || sortedName[i - 1].name <= s.name) && onlySpares.every((s) => s.spares > 0) && tierMask.length === 10 && tierMask.every((s) => s.tier === 'rare'));

  // C05 account switch and sign-out
  const s5 = freshHoard(T, mulberry32(5));
  const tagA = 'a'.repeat(32), tagB = 'b'.repeat(32);
  s5.mirror = { acctTag: tagA, at: T, version: 3, items: [], meter: createMeter(), credits: 1, pity: [0, 0, 0, 0, 0, 0], serverDay: dayOf(T) };
  s5.pending = [{ kind: 'open', idem: 'k'.repeat(20), acctTag: tagA, at: T }, { kind: 'merge', idem: 'm'.repeat(20), acctTag: tagB, at: T }];
  s5.prefs.sort = 'name';
  const toB = forgetAccount(s5, tagB), out = forgetAccount(s5, null), stay = forgetAccount(s5, tagA);
  check('C05', 'account switch removes the old mirror and its pending keys; sign-out removes all; the same account keeps both; prefs and ghosts stay',
    toB.mirror === null && toB.pending.length === 1 && toB.pending[0].acctTag === tagB && out.mirror === null && out.pending.length === 0 && stay.mirror?.acctTag === tagA && stay.pending.length === 1
    && JSON.stringify(toB.ghosts) === JSON.stringify(s5.ghosts) && toB.prefs.sort === 'name' && JSON.stringify(out.ghosts) === JSON.stringify(s5.ghosts));

  // C06 sizes
  const rr = mulberry32(6);
  const rows = (n: number): MirrorRow[] => Array.from({ length: n }, (_, i) => {
    const d = CATALOG[Math.floor(rr() * CATALOG.length)];
    return makeRow(uuidLike(rr), speciesBaseGenome(d.id, i), T0 - Math.floor(rr() * 60 * DAY_MS), rr() < 0.3 ? FLAG_FAV | FLAG_SEEN : FLAG_SEEN, 'drop', rr() < 0.05 ? T0 + 3600_000 : 0);
  });
  const k331 = JSON.stringify(rows(331)).length, k1000 = JSON.stringify(rows(1000)).length;
  const shelf = freshHoard(T, mulberry32(7)); while (shelf.ghosts.length < GHOST_CAP) shelf.ghosts.push(makeRow(`g-${shelf.ghosts.length.toString(36).padStart(12, '0')}`, speciesBaseGenome('plumpet', shelf.ghosts.length), T, FLAG_SEEN, 'drop'));
  const shelfBytes = serializeHoard(shelf).length;
  check('C06', '331 items serialise to under 40 KB and 1000 to under 110 KB (compact rows)', k331 < 40_000 && k1000 < 110_000, `331: ${(k331 / 1000).toFixed(1)} KB, 1000: ${(k1000 / 1000).toFixed(1)} KB, a full practice shelf (${GHOST_CAP}) ${(shelfBytes / 1000).toFixed(1)} KB, park cap 20 KB`);
  check('C06', `a full Practice shelf (${GHOST_CAP} ghosts) fits the 20 000-character park slot whole, so a parked shelf is never truncated`, shelfBytes < 20_000);

  // C07 meterfeed
  const out7: MappedTouch = createMappedTouch();
  // RE-SPECIFIED 2026-10-06 (owner, FUN.md 2.2: a stretch held out pays per second): a snap now also carries its hold (heldS = heldFor,
  // clamped 0..10 s like a squeeze hold), shown after '@'; the table's other rows are unchanged
  const map = (e: SoftEvent): string => (mapSoftEvent(e, out7) ? `${out7.kind}:${Number(out7.amount.toFixed(3))}${out7.kind === 'pull' ? '@' + Number(out7.heldS.toFixed(3)) : out7.heldS !== 0 ? '@!' : ''}` : '-');
  const table: Array<[SoftEvent, string]> = [
    [ev('poke', 0.3), 'poke:0'], [ev('release', 0.5, 0.39), '-'], [ev('release', 0.5, 0.4), 'squeeze:0.4'], [ev('release', 0.5, 2.5), 'squeeze:2.5'],
    [ev('release', 0.5, 12), 'squeeze:10'], [ev('release', 0.5, NaN), '-'], [ev('release', 0.5, Infinity), '-'], [ev('snap', 0.2), 'pull:0.2@0'], [ev('snap', 0.35), 'pull:0.35@0'],
    [ev('snap', 1.5), 'pull:1@0'], [ev('snap', -1), 'pull:0@0'], [ev('snap', NaN), '-'], [ev('press', 0.9, 1), '-'], [ev('land', 0.9), '-'], [ev('grab', 0.9), '-'],
    [ev('snap', 0.8, 2.5), 'pull:0.8@2.5'], [ev('snap', 0.8, 12), 'pull:0.8@10'], [ev('snap', 0.8, NaN), 'pull:0.8@0'], [ev('snap', 0.8, -3), 'pull:0.8@0'], [ev('snap', 0.8, Infinity), 'pull:0.8@0'],
  ];
  const got = table.map(([e]) => map(e));
  check('C07', 'meterfeed maps SoftEvents as DESIGN 5.4 says (poke; release >= 0.4 s -> squeeze with the hold, capped 10 s; snap -> pull with the intensity, clamped 0..1, and its hold heldFor, clamped 0..10 s (not finite = 0); press, land, grab, short release, NaN -> nothing)',
    got.every((g, i) => g === table[i][1]), got.join(' '));
  const buf = createTouchBuffer(1000);
  const br = mulberry32(8);
  const pushed: number[] = [];
  let tt = T0;
  const pushedHold: number[] = [];
  for (let i = 0; i < 700; i++) { tt += br() < 0.1 ? -500 : Math.floor(br() * 900); const k = Math.floor(br() * 3); pushed.push(k); const h = br() * 12 - 1; pushedHold.push(k === 2 ? Math.min(10, Math.max(0, h)) : -1); buf.push(k, br(), tt, h); }
  const kindsOut: number[] = [];
  let maxLen = 0, ordered = true, batches = 0, holdsOk = true, ints: Interaction[] = [];
  const inter0 = buf.interactions();
  for (let b = buf.batch(); b; b = buf.batch()) {
    batches++; maxLen = Math.max(maxLen, b.length);
    if (b[0][2] !== 0) ordered = false;
    for (let i = 0; i < b.length; i++) {
      kindsOut.push(b[i][0]); if (i && b[i][2] < b[i - 1][2]) ordered = false; if (!Number.isInteger(b[i][2])) ordered = false;
      const want = pushedHold[kindsOut.length - 1];
      if (want < 0 ? b[i].length !== 3 : b[i].length !== 4 || b[i][3] !== want) holdsOk = false;   // a pull carries its clamped hold, nothing else does
    }
    buf.consume(b.length);
  }
  ints = inter0;
  const holdsInter = ints.every((it, i) => (it.kind === 'pull' ? it.heldS === pushedHold[i] : it.heldS === undefined));
  check('C07', `the batch builder never exceeds ${MAX_EVENTS_PER_BATCH} touches, never reorders (dtMs from 0, whole ms, never decreasing, even when the clock steps back), loses none`,
    maxLen <= MAX_EVENTS_PER_BATCH && ordered && kindsOut.join() === pushed.join() && buf.size === 0, `${batches} batches, longest ${maxLen}`);
  check('C07', 'a pull is reported with its hold as a 4th element [2, level, dtMs, heldS] (clamped 0..10 s), the other kinds as [kind, amount, dtMs]; the preview fold sees the same holds',
    holdsOk && holdsInter && ints.length === 700);
  const ob = createTouchBuffer(10);
  for (let i = 0; i < 15; i++) ob.push(i % 3, 1, T0 + i * 1000);
  const dropped = ob.dropBefore(T0 + 12_000);
  check('C07', 'the buffer drops the oldest when full and drops touches older than the bank', ob.overflowed === 5 && dropped === 7 && ob.size === 3 && ob.oldestMs() === T0 + 12_000);

  // C08 the preview meter reconciles
  const mr = mulberry32(9);
  let foldOk = true, previewOk = true;
  for (let s = 0; s < 60; s++) {
    const touches: Interaction[] = [];
    let t8 = T0 + s * 1e7;
    for (let i = 0; i < 300; i++) { t8 += 200 + Math.floor(mr() * 3000); const k = Math.floor(mr() * 3); touches.push({ kind: (['poke', 'squeeze', 'pull'] as const)[k], amount: k === 1 ? mr() * 3 : mr(), heldS: k === 2 ? mr() * 4 : undefined, tMs: t8 }); }
    const server = foldMeter(createMeter(), touches);
    const k = Math.floor(mr() * touches.length);
    const acked = foldMeter(createMeter(), touches.slice(0, k));
    if (JSON.stringify(foldMeter(acked, touches.slice(k))) !== JSON.stringify(server) || JSON.stringify(foldMeter(server, [])) !== JSON.stringify(server)) foldOk = false;
    const pv = createPreviewMeter();
    for (const x of touches) { if (pv.pending(x) !== addInteraction(pv.state, x).spGained) previewOk = false; pv.touch(x); }
    if (JSON.stringify(pv.state) !== JSON.stringify(server)) previewOk = false;
    pv.reconcile(JSON.parse(JSON.stringify(acked)), touches.slice(k));
    if (JSON.stringify(pv.state) !== JSON.stringify(server) || pv.optimisticCapsules !== 0) previewOk = false;
  }
  check('C08', 'for 60 random streams: fold(addInteraction, serverMeter, unacked) equals the server meter, and with nothing unacked it IS the server meter', foldOk);
  check('C08', 'the preview meter equals the fold of its own touches (and pending(touch) equals what that touch then pays), and after reconcile(serverMeter, unacked) the same state', previewOk);

  // C08 the pending preview (FUN.md 2.2): collection.previewTouch(kind, heldS, level) is what the touch in progress pays when it ends now
  {
    T = T0 + 20 * DAY_MS;
    const mp = memoryStorage();
    const cp = mk(mp, 81);
    const pr = mulberry32(81);
    const pt = cp.previewTouch!.bind(cp);
    let changes = 0;
    const off = cp.onChange(() => { changes++; });
    const gain = (b: ReturnType<Collection['meter']>, a: ReturnType<Collection['meter']>): number => {
      const dc = a.playCredits - b.playCredits;
      return dc > 0 ? b.threshold - b.sp + a.sp + (dc - 1) * a.threshold : a.sp - b.sp;
    };
    let n = 0, mism = 0, worst = 0, paid = 0, zeroFull = 0, zeroShort = 0, zeroNoSnap = 0, pulls = 0, medley = 0, opened = 0, fulls = 0;
    for (let i = 0; i < 900; i++) {
      T += pr() < 0.5 ? 250 + Math.floor(pr() * 600) : 600 + Math.floor(pr() * 3500);
      const k = Math.floor(pr() * 3);
      const held = k === 0 ? 0 : pr() * 4.2;
      const level = k === 2 ? (pr() < 0.1 ? pr() * 0.05 : pr()) : 0;
      const kind = (['poke', 'squeeze', 'pull'] as const)[k];
      const b0 = cp.meter();
      const c0 = changes;
      const p = pt(kind, held, level);
      if (changes !== c0 || JSON.stringify(cp.meter()) !== JSON.stringify(b0)) { mism++; break; } // a preview changes nothing
      if (k === 2 && level <= 0.05) { if (p === 0) zeroNoSnap++; else mism++; continue; } // the physics fires no snap: nothing to feed
      cp.feed(k === 0 ? ev('poke') : k === 1 ? ev('release', 0.5, held) : ev('snap', level, held), T);
      const a0 = cp.meter();
      const g = gain(b0, a0);
      if (Math.abs(g - p) > 1e-9) { mism++; worst = Math.max(worst, Math.abs(g - p)); }
      n++; if (p > 0) paid++; if (k === 2 && p > 0) pulls++;
      if (b0.tableFull) { fulls++; if (p === 0) zeroFull++; }
      if (k === 1 && held < 0.4 && p === 0) zeroShort++;
      if (p > 2.7) medley++;
      if (a0.playCredits >= WH_QUEUE_MAX && pr() < 0.05) { while (cp.meter().playCredits > 0) { void cp.openCapsule(); opened++; } }
    }
    off();
    check('C08', 'previewTouch(kind, heldS, level) equals what the touch then pays through feed (pending arc = banked SP), over 900 touches with capsules, medleys, a full table and short squeezes',
      mism === 0 && n > 700 && paid > 500 && pulls > 100 && zeroFull > 5 && zeroFull === fulls && zeroShort > 5 && zeroNoSnap > 5 && medley > 5 && opened > 0,
      `${n} fed, ${paid} paid, ${pulls} stretches, ${medley} with a medley, ${fulls} on a full table (all 0), ${zeroShort} short squeezes (0), ${zeroNoSnap} no-snap pulls (0), ${mism} mismatches (worst ${worst})`);
    // allocations: a warmed-up per-frame call (two held fingers), measured like P09. The holds and levels come from a prepared list of
    // numbers (a tagged array: the sentinel string keeps its elements boxed), so this counts previewTouch's own allocations; a caller that
    // passes a freshly computed fraction boxes that argument itself, as any JS call does
    const newUsedP = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
    const accP = new Float64Array(1);
    const HS: unknown[] = []; for (let i = 0; i < 256; i++) HS.push(0.4 + (i % 250) * 0.0123); HS.push('sentinel');
    const LV: unknown[] = []; for (let i = 0; i < 256; i++) LV.push(0.3 + (i % 97) * 0.0071); LV.push('sentinel');
    const frame = (nf: number): void => { let a = 0; for (let i = 0; i < nf; i++) { a += pt('pull', HS[i & 255] as number, LV[i & 255] as number); a += pt('squeeze', HS[(i + 7) & 255] as number, 0); } accP[0] += a; };
    for (let w = 0; w < 100; w++) frame(1000);
    const bw: number[] = []; for (let k = 0; k < 6; k++) { const u0 = newUsedP(); bw.push(newUsedP() - u0); }
    let bestP = Infinity;
    for (let w = 0; w < 8; w++) { const u0 = newUsedP(); frame(10000); const dd = newUsedP() - u0 - bw[5]; if (dd >= 0 && dd < bestP) bestP = dd; }
    T += 5000;
    check('C08', 'previewTouch allocates nothing: exact new-space growth over 20 000 calls (10 000 frames with a held stretch and a held squeeze)', bestP <= 64 && accP[0] > 0, `${bestP} B per 20 000 calls`);
    const objForm = (pt as unknown as (q: unknown) => number)({ kind: 'pull', amount: 0.8, heldS: 2, level: 0.8, tMs: 123 });
    const garbage = [pt('pull', NaN, NaN), pt('squeeze', -1, 0), pt('tap' as never, 1, 1), pt(undefined as never, 1, 1), (pt as unknown as (q: unknown) => number)(null), pt('pull', Infinity, 7)];
    check('C08', 'previewTouch also takes one object { kind, heldS, level } (the shell\'s feature-detecting call), and answers garbage with a finite number, never throwing',
      objForm === pt('pull', 2, 0.8) && objForm > 0 && garbage.every((v) => Number.isFinite(v) && v >= 0) && garbage[0] === 0 && garbage[2] === 0 && garbage[5] === pt('pull', 0, 1),
      `object form ${objForm.toFixed(3)} SP; garbage ${garbage.map((v) => v.toFixed(2)).join(' ')}`);
    // a stretch held out: the pending arc grows with the hold, then stops at the cap
    const arc = [0.2, 0.6, 1, 2, 3, 4].map((h) => pt('pull', h, 0.9));
    const sq = [0.3, 0.5, 1, 1.79, 1.8, 3, 5].map((h) => pt('squeeze', h, 0));
    check('C08', 'the pending arc grows while held: a stretch from its base by 0.55 SP a second up to 3 s, a squeeze from 0.4 s by 0.45 a second with the soft pop at 1.8 s (x freshness), then flat',
      arc.every((v, i) => i === 0 || v > arc[i - 1] || (i >= 5 && v === arc[i - 1])) && sq[0] === 0 && sq.slice(1, 6).every((v, i) => v > sq[i]) && sq[6] === sq[5] && sq[4] - sq[3] > 0.4 * sq[4] / 2.65,
      `stretch ${arc.map((v) => v.toFixed(2)).join('/')}, squeeze ${sq.map((v) => v.toFixed(2)).join('/')}`);
    cp.dispose();
  }

  // C09 no outgoing message, and the guard the bridge will use
  const g = globalThis as Record<string, unknown>;
  const calls: string[] = [];
  const saved: Record<string, unknown> = {};
  const patched: string[] = [];
  for (const k of ['fetch', 'postMessage', 'XMLHttpRequest', 'WebSocket', 'EventSource']) { try { saved[k] = g[k]; g[k] = (..._a: unknown[]) => { calls.push(k); }; patched.push(k); } catch { /* not writable here */ } }
  let beaconPatched = false;
  try { const nav = g.navigator as Record<string, unknown> | undefined; if (nav) { Object.defineProperty(nav, 'sendBeacon', { value: () => { calls.push('sendBeacon'); return true; }, configurable: true }); beaconPatched = true; } } catch { beaconPatched = false; }
  const sm = memoryStorage();
  const sc = mk(sm, 21);
  play(sc, 900);
  for (let i = 0; i < 5; i++) await sc.openCapsule();
  const rv = sc.restock(); await sc.claimRestock(rv.offer[0]);
  for (const tk of sc.tasks()) await sc.completeTask(tk.def.id);
  for (const p of sc.tidyPlan({ includeRare: true })) { const pv = sc.previewMerge(p); if (pv.ok) await sc.merge(p, pv.digest); }
  await sc.setFav([sc.items()[0].id], true); await sc.markSeen(sc.items().map((i) => i.id));
  sc.flush(); sc.sync(); sc.dispose();
  for (const k of patched) try { g[k] = saved[k]; } catch { /* ignore */ }
  if (beaconPatched) try { delete (g.navigator as Record<string, unknown>).sendBeacon; } catch { /* ignore */ }
  check('C09', `a whole practice session (touches, ${sc.practice().opened} capsules, restock, tasks, merges, hearts) makes no network or postMessage call of any kind`,
    calls.length === 0, `${calls.length} calls${beaconPatched ? '' : ' (sendBeacon not patchable here; the source scan covers it)'}`);
  const ids = new Set(sc.items().map((i) => i.id));
  const someGhost = sc.items()[1]?.id ?? sc.items()[0].id;
  check('C09', 'findGhostIds (the outbound guard the bridge will call) finds a ghost id anywhere in a payload, and nothing in a payload of real ids',
    findGhostIds({ fn: 'wh_merge', args: { idem: 'x'.repeat(20), items: ['real-uuid', someGhost] } }, ids).join() === someGhost
    && findGhostIds({ deep: [[[{ k: `prefix-${someGhost}` }]]] }, ids).length === 1 && findGhostIds({ fn: 'wh_merge', args: { items: [uuidLike(mr), uuidLike(mr)] } }, ids).length === 0);

  // C11 hostile pending entries; C12 the mirror never holds an auth id
  const h11 = JSON.parse(serializeHoard(freshHoard(T, mulberry32(11)))) as Record<string, unknown>;
  h11.pending = [
    { kind: 'merge', idem: 'A'.repeat(24), acctTag: 'c'.repeat(32), at: T, items: ['g-x', 'g-y'], pick: 'dollop', touches: [[0, 1, 2]] },
    { kind: 'open', idem: 'short', acctTag: 'c'.repeat(32), at: T },
    { kind: 'steal', idem: 'B'.repeat(24), acctTag: 'c'.repeat(32), at: T },
    { kind: 'tidy', idem: 'C'.repeat(24), acctTag: 'c'.repeat(32), at: T - PENDING_TTL_MS - 1 },
    'junk', null,
  ];
  h11.mirror = { acctTag: 'd'.repeat(32), authId: '0b5c5c8e-aaaa-bbbb-cccc-dddddddddddd', email: 'kid@example.com', at: T, version: 1, items: [], meter: createMeter(), credits: 0, pity: [0, 0, 0, 0, 0, 0], serverDay: 1 };
  const m11 = memoryStorage({ [HOARD_KEY]: JSON.stringify(h11) });
  const calls11: string[] = [];
  const keep = g.fetch; g.fetch = () => { calls11.push('fetch'); };
  const c11 = mk(m11); await c11.setFav([c11.items()[0].id], true); c11.flush();
  g.fetch = keep;
  const s11 = stored(m11);
  check('C11', 'forged pending entries are reduced to {kind, idem, acctTag, at} (item ids, picks and touches dropped), malformed and stale ones removed, and nothing is sent',
    s11.pending.length === 1 && Object.keys(s11.pending[0]).sort().join() === 'acctTag,at,idem,kind' && !JSON.stringify(s11.pending).includes('g-x') && calls11.length === 0);
  const t12 = JSON.stringify(s11.mirror);
  const forged = { ...h11, mirror: { ...(h11.mirror as object), acctTag: '0b5c5c8e-aaaa-bbbb-cccc-dddddddddddd' } };
  const f12 = sanitizeHoard(forged, T, mulberry32(1));
  check('C12', 'the stored mirror keeps only acctTag (no auth id, no email); a mirror whose tag is not a 32-hex hash (e.g. a raw auth UUID) is wiped on load',
    !t12.includes('authId') && !t12.includes('kid@example.com') && !t12.includes('0b5c5c8e') && s11.mirror?.acctTag === 'd'.repeat(32) && !!f12 && f12.save.mirror === null);
  c11.dispose();
}

/* ═════════════════════════════ P. the practice economy ═════════════════════════════ */
section('P  practice economy, feed, storage');
{
  // P01 determinism
  const run = (seed: number): string => {
    T = T0;
    const m = memoryStorage();
    const c = mk(m, seed);
    play(c, 1500);
    for (let i = 0; i < 6; i++) void c.openCapsule();
    const plan = c.tidyPlan({ includeRare: true }); void c.tidy(plan);
    c.flush(); c.dispose();
    return m.getItem(HOARD_KEY)!;
  };
  const a = run(5), b = run(5), d = run(6);
  check('P01', 'same seed, clock and script => byte-identical saves; another seed => a different shelf', a === b && a !== d);

  // P02 the table cap
  T = T0;
  const m2 = memoryStorage();
  const c2 = mk(m2, 2);
  const evs: CollectionEvent[] = [];
  c2.onEvent((e) => evs.push(e));
  play(c2, 3000);
  const full = c2.meter();
  const sp0 = full.sp, last0 = (stored(m2).ghostMeter as MeterState).lastEventMs;
  c2.flush();
  const lastStored = stored(m2).ghostMeter.lastEventMs;
  play(c2, 100);
  c2.flush();
  check('P02', `at ${WH_QUEUE_MAX} play capsules the practice meter stops paying (SP and the last touch time do not move); "table-full" is announced once`,
    full.tableFull && full.playCredits === WH_QUEUE_MAX && c2.meter().sp === sp0 && stored(m2).ghostMeter.lastEventMs === lastStored && evs.filter((e) => e.type === 'table-full').length === 1
    && evs.filter((e) => e.type === 'capsule').length === WH_QUEUE_MAX && meterCopy(full) === COPY.tableFull, `last touch ${last0}`);
  await c2.openCapsule();
  play(c2, 400);
  check('P02', 'opening one frees the table: the meter pays again and the next capsule arrives', c2.meter().playCredits === WH_QUEUE_MAX && evs.filter((e) => e.type === 'capsule').length === WH_QUEUE_MAX + 1);
  c2.dispose();

  // P03 practice capsule odds are the public odds
  const s3 = emptyHoard('oddsdevice0001');
  const r3 = mulberry32(33);
  const tiers = new Array<number>(TIER_COUNT).fill(0);
  const n3 = 30000;
  for (let i = 0; i < n3; i++) {
    s3.ghostCapsules = 1;
    const o = ghostOpen(s3, { rand: r3, now: T });
    if (o.ok) { tiers[o.tier_idx]++; s3.ghosts.length = 0; }
  }
  const z = tiers.map((k, i) => (k - n3 * TIER_ODDS[i]) / Math.sqrt(n3 * TIER_ODDS[i] * (1 - TIER_ODDS[i])));
  check('P03', `${n3} practice capsules follow the public tier odds (every tier within 4.5 sigma)`, tiers.reduce((x, y) => x + y, 0) === n3 && z.every((v) => Math.abs(v) < 4.5),
    tiers.map((k, i) => `${(100 * k / n3).toFixed(2)}% (z ${z[i].toFixed(1)})`).join(' '));

  // P04 shelf cap and empty table: refused, nothing consumed, no randomness drawn
  const s4 = freshHoard(T, mulberry32(4));
  while (s4.ghosts.length < GHOST_CAP) s4.ghosts.push(makeRow(`g-${s4.ghosts.length.toString(36).padStart(12, '0')}`, makeStarterGenome(), T, FLAG_SEEN, 'drop'));
  s4.ghostCapsules = 2;
  const cr = counting(1);
  const r4 = ghostOpen(s4, { rand: cr.fn, now: T });
  const s4b = emptyHoard('emptydevice0001');
  const r4b = ghostOpen(s4b, { rand: cr.fn, now: T });
  check('P04', `a full shelf (${GHOST_CAP}) refuses with "shelf_full" and an empty table with "no_capsule"; neither consumes a capsule or draws a random number`,
    !r4.ok && r4.error === 'shelf_full' && s4.ghostCapsules === 2 && !r4b.ok && r4b.error === 'no_capsule' && cr.n() === 0 && COPY.shelfFull.length > 0);
  const s4c = emptyHoard('drawdevice00001'); s4c.ghostCapsules = 1;
  const cr2 = counting(2);
  const r4c = ghostOpen(s4c, { rand: cr2.fn, now: T });
  check('P04', 'an open draws exactly 3 numbers for the roll plus 12 for the ghost id; the item is unseen, origin "drop", a practice ghost', r4c.ok && cr2.n() === 15 && !r4c.item.seen && r4c.item.origin === 'drop' && r4c.item.ghost && r4c.source === 'play');

  // P05 restock
  T = T0;
  const m5 = memoryStorage();
  const c5 = mk(m5, 5);
  const v5 = c5.restock();
  const pool = new Set(RESTOCK_POOL.map((x) => x.id));
  const notOffered = RESTOCK_POOL.map((x) => x.id).find((id) => !v5.offer.includes(id))!;
  const bad5 = await c5.claimRestock(notOffered);
  const ok5 = await c5.claimRestock(v5.offer[0]);
  const again5 = await c5.claimRestock(v5.offer[1]);
  const v5b = c5.restock();
  T += DAY_MS;
  const v5c = c5.restock();
  const ok5b = await c5.claimRestock(v5c.offer[2]);
  check('P05', 'restock offers 3 distinct Common/Uncommon species (new ones first), takes only an offered pick, once per UTC day, as origin "restock"',
    v5.offer.length === 3 && new Set(v5.offer).size === 3 && v5.offer.every((x) => pool.has(x)) && !v5.claimed && !bad5.ok && bad5.error === 'not_offered'
    && ok5.ok && ok5.item.origin === 'restock' && ok5.is_new && !again5.ok && again5.error === 'already_claimed' && v5b.claimed && !v5c.claimed && ok5b.ok,
    `${v5.offer.join(',')} / next day ${v5c.offer.join(',')}`);
  const sameDay = ghostRestockView(stored(m5), T).offer.slice().sort().join();
  check('P05', 'the offer is deterministic for (device, UTC day): a reload shows the same three', sameDay === c5.restock().offer.slice().sort().join());
  c5.dispose();

  // P06 tasks: the counting rules (COLLECTION 7.10), claim flow, weekly limit
  const det = (o: Partial<InteractionDetail>): InteractionDetail => ({ base: 1, freshness: 1, medley: 0, dailyRate: 1, doubleTap: false, valveClamped: false, ...o });
  const prog: Record<string, number> = {};
  const def = (id: string) => TASK_DEFS.find((t) => t.id === id)!;
  const all = TASK_DEFS.slice();
  bumpTasks(prog, all, 'poke', 0, det({ paidAs: 'poke', freshness: 0.6 }), 2);        // gentle + calm
  bumpTasks(prog, all, 'poke', 0, det({ paidAs: 'poke', freshness: 0.2 }), 0.5);      // neither
  bumpTasks(prog, all, 'poke', 0, det({ paidAs: 'poke', doubleTap: true }), 0.1);     // double tap: nothing
  bumpTasks(prog, all, 'squeeze', 1.0, det({ paidAs: 'squeeze' }), null);            // slow squeeze (>= 1 s)
  bumpTasks(prog, all, 'squeeze', 2.1, det({ paidAs: 'squeeze' }), null);            // slow + long + soft-pop streak 1
  bumpTasks(prog, all, 'squeeze', 1.9, det({ paidAs: 'squeeze' }), null);            // streak 2
  bumpTasks(prog, all, 'squeeze', 0.5, det({ paidAs: 'squeeze' }), null);            // streak reset
  bumpTasks(prog, all, 'pull', 0.36, det({ paidAs: 'pull', medley: 2 }), null);      // snap + medley
  bumpTasks(prog, all, 'pull', 0.94, det({ paidAs: 'pull' }), null);                 // snap, but short of its limit: no stretch
  bumpTasks(prog, all, 'pull', 1.0, det({ paidAs: 'pull' }), null);                  // snap + stretch (pulled to its maxPull)
  bumpTasks(prog, all, 'squeeze', 0.3, det({ paidAs: 'poke', freshness: 1 }), 3);    // a short squeeze is paid as a poke
  check('P06', 'task counters follow COLLECTION 7.10 (gentle and calm pokes, slow and long squeezes, the soft-pop streak and its reset, snaps, stretch, medleys, a short squeeze counts as a poke)',
    prog[def('gentle-pokes-20').id] === 2 && prog['pokes-sleepy-10'] === 2 && prog['slow-squeezes-5'] === 3 && prog['squeeze-long-3'] === 1 && prog['soft-pops-5'] === 2
    && prog['soft-pops-5#streak'] === 0 && prog['snaps-3'] === 3 && prog['stretch-double'] === 1 && prog['medley-1'] === 1, JSON.stringify(prog));
  // the flow, on a raw save
  const monday = Math.floor(T0 / DAY_MS);
  const s6 = emptyHoard('taskdevice00001');
  const tday = monday;
  const offered = practiceTasksFor(s6.deviceId, tday);
  const tNow = tday * DAY_MS + 3600_000;
  const nd = ghostCompleteTask(s6, offered[0].id, tNow);
  s6.ghostTasks.day = tday; s6.ghostTasks.progress[offered[0].id] = offered[0].target;
  s6.ghostCapsules = WH_QUEUE_MAX; // the table is full: task capsules bypass the cap
  const ok6 = ghostCompleteTask(s6, offered[0].id, tNow);
  const dup6 = ghostCompleteTask(s6, offered[0].id, tNow);
  const no6 = ghostCompleteTask(s6, 'not-a-task', tNow);
  const rows6 = ghostTaskRows(s6, tNow);
  check('P06', 'a task is refused until done ("not_done" with progress and target), then pays one task capsule even on a full table, once a day; an unknown id is "not_offered"',
    !nd.ok && nd.error === 'not_done' && nd.target === offered[0].target && ok6.ok && s6.ghostTaskCapsules === 1 && ok6.credits === WH_QUEUE_MAX + 1
    && !dup6.ok && dup6.error === 'already_claimed' && !no6.ok && no6.error === 'not_offered' && rows6[0].claimed && rows6[0].done);
  let claimed = 1, weekly = '';
  for (let dd = 1; dd < 7 && !weekly; dd++) {
    const day = tday + dd;
    if (weekKeyOf(day) !== weekKeyOf(tday)) break;
    for (const t of practiceTasksFor(s6.deviceId, day)) {
      s6.ghostTasks.day = day; s6.ghostTasks.progress[t.id] = t.target;
      const r = ghostCompleteTask(s6, t.id, day * DAY_MS + 1000);
      if (r.ok) claimed++; else { weekly = r.error; break; }
    }
  }
  check('P06', `at most ${TASKS_MAX_PER_WEEK} task capsules a week ("weekly_limit"); the table row then says so`,
    claimed === TASKS_MAX_PER_WEEK && weekly === 'weekly_limit' && ghostTaskRows(s6, (tday + 3) * DAY_MS).every((r) => r.weeklyLimitReached), `${claimed} claimed, then ${weekly}`);
  // through the feed: find a day that offers gentle pokes and poke gently
  let dayP = monday, dev = '';
  T = T0;
  const m6 = memoryStorage();
  const c6 = mk(m6, 6);
  dev = stored(m6).deviceId;
  for (let k = 0; k < 400 && !practiceTasksFor(dev, dayP).some((t) => t.id === 'gentle-pokes-20'); k++) dayP++;
  T = dayP * DAY_MS + 3600_000;
  for (let i = 0; i < 25; i++) { T += 1500; c6.feed(ev('poke'), T); }
  const row6 = c6.tasks().find((t) => t.def.id === 'gentle-pokes-20');
  const got6 = row6 ? await c6.completeTask('gentle-pokes-20') : null;
  check('P06', 'through the feed: 25 gentle pokes complete "Twenty gentle pokes" and the task pays a capsule',
    !!row6 && row6.done && row6.progress === 20 && !!got6 && got6.ok && c6.meter().credits >= 1, row6 ? `${row6.progress}/${row6.target}` : 'no such day');
  c6.dispose();

  // P07 hearts and seen
  T = T0;
  const m7 = memoryStorage();
  const c7 = mk(m7, 7);
  for (let round = 0; round < 40 && !c7.stacks().some((s) => s.copies >= 3); round++) {
    play(c7, 600);
    while ((await c7.openCapsule()).ok) { /* open everything */ }
    if (c7.meter().doneToday) T += DAY_MS;
  }
  const st7 = c7.stacks().find((s) => s.copies >= 3) ?? c7.stacks()[0];
  const spare = st7.spareIds[st7.spareIds.length - 1];
  if (spare) await c7.setFav([spare], true);
  const st7b = c7.stacks().find((s) => s.species === st7.species)!;
  await c7.markSeen(c7.items().map((i) => i.id));
  check('P07', 'hearting a spare makes it the keeper (the old keeper becomes a spare) and keeps it out of the mergeable spares',
    !!spare && st7b.keeper === spare && !st7b.mergeableIds.includes(spare) && st7b.keeperHearted && st7b.spareIds.includes(st7.keeper!), `${st7.species} x${st7.copies}`);
  c7.flush();
  check('P07', 'markSeen clears every unseen dot; the heart and the seen flags are saved', c7.stacks().every((s) => s.unseen === 0) && stored(m7).ghosts.some((r) => r[0] === spare && (r[4] & FLAG_FAV) !== 0) && stored(m7).ghosts.every((r) => (r[4] & FLAG_SEEN) !== 0));
  c7.dispose();

  // P08 the feed's clock: a page clock (performance.now()) is anchored to the epoch; a reload does not refuse touches
  T = T0;
  const m8 = memoryStorage();
  const c8 = mk(m8, 8);
  c8.feed(ev('poke'), 1234.5); // a performance.now()-style time
  c8.flush();
  const l8 = stored(m8).ghostMeter.lastEventMs ?? 0;
  c8.dispose();
  T = T0 + 30_000;
  const c8b = mk(m8, 8);
  c8b.feed(ev('poke'), 50); // the page clock restarted after the reload
  c8b.flush();
  const l8b = stored(m8).ghostMeter.lastEventMs ?? 0;
  check('P08', 'the feed anchors any ms clock to the epoch (a performance.now() time lands at the epoch "now"), and after a reload touches are accepted, not refused as out of order',
    Math.abs(l8 - T0) < 1000 && Math.abs(l8b - (T0 + 30_000)) < 1000 && dayOf(l8) === dayOf(T0));
  c8b.dispose();

  // P09 allocations of the per-frame call
  T = T0;
  const m9s = memoryStorage();
  const c9 = mk(m9s, 9, { throttleMs: 1e12 });
  const newUsed = (): number => { for (const s of v8.getHeapSpaceStatistics()) if (s.space_name === 'new_space') return s.space_used_size; return NaN; };
  const idle = [ev('press', 0.4), ev('land', 0.2), ev('grab', 0.5), ev('release', 0.3, 0.2)];
  for (let i = 0; i < 40000; i++) c9.feed(idle[i & 3], T);
  const emptyW: number[] = [];
  for (let k = 0; k < 6; k++) { const u0 = newUsed(); emptyW.push(newUsed() - u0); }
  const base9 = emptyW[emptyW.length - 1];
  let bestIdle = Infinity;
  for (let w = 0; w < 8; w++) { const u0 = newUsed(); for (let i = 0; i < 20000; i++) c9.feed(idle[i & 3], T); const dd = newUsed() - u0 - base9; if (dd >= 0 && dd < bestIdle) bestIdle = dd; }
  // paid touches: the collection's own share, measured against core addInteraction alone on the same touch stream (lockstep)
  const pokeEv = ev('poke'), snapEv = ev('snap', 0.5);
  let m9: MeterState = createMeter();
  const it9: Interaction = { kind: 'poke', amount: 0, tMs: 0 };
  const core9 = (t: number, i: number): void => { it9.kind = i % 2 ? 'poke' : 'pull'; it9.amount = i % 2 ? 0 : 0.5; it9.tMs = t; m9 = addInteraction(m9, it9).state; };
  const coll9 = (t: number, i: number): void => c9.feed(i % 2 ? pokeEv : snapEv, t);
  let k9 = 0;
  const steps9 = (n: number, a: ((t: number, i: number) => void) | null, b: ((t: number, i: number) => void) | null): void => { for (let i = 0; i < n; i++) { T += 1300; k9++; if (a) a(T, k9); if (b) b(T, k9); } };
  const keepPaying = (): void => {
    while (c9.meter().playCredits > 0) void c9.openCapsule();
    if (m9.dayCapsules >= 6) { T = (Math.floor(T / DAY_MS) + 1) * DAY_MS + 9 * 3600_000; steps9(30, coll9, core9); }
  };
  for (let i = 0; i < 30; i++) { keepPaying(); steps9(50, coll9, core9); }
  let bestColl = Infinity, bestCore = Infinity;
  for (let w = 0; w < 8; w++) {
    keepPaying();
    const t0 = T, k0 = k9;
    let u0 = newUsed();
    steps9(100, coll9, null);
    let dd = newUsed() - u0 - base9; if (dd >= 0 && dd < bestColl) bestColl = dd;
    T = t0; k9 = k0; steps9(100, null, core9);                       // the core meter catches up on the same touches
    keepPaying();
    const t1 = T, k1 = k9;
    u0 = newUsed();
    steps9(100, null, core9);
    dd = newUsed() - u0 - base9; if (dd >= 0 && dd < bestCore) bestCore = dd;
    T = t1; k9 = k1; steps9(100, coll9, null);                       // and the collection catches up
  }
  c9.flush();
  const sameMeter = JSON.stringify(stored(m9s).ghostMeter) === JSON.stringify(m9); // the two meters really saw the same touches
  const perColl = Math.round(bestColl / 100), perCore = Math.round(bestCore / 100);
  check('P09', 'feed() allocates nothing for a SoftEvent that is not a touch (press, land, grab, a short release): exact new-space growth over 20 000 calls',
    bestIdle <= 64, `${bestIdle} B per 20 000 calls`);
  check('P09', "a paid touch costs the collection layer at most 512 B on top of core addInteraction's own new state (same touch stream, lockstep)",
    sameMeter && Number.isFinite(perColl) && Number.isFinite(perCore) && perColl - perCore <= 512, `collection ${perColl} B/touch, core alone ${perCore} B/touch, layer ${perColl - perCore} B`);
  c9.dispose();

  // P10 two tabs on the v2 save
  T = T0;
  const shared = memoryStorage();
  const A = mk(shared, 10);
  const B = mk(shared, 11);
  play(A, 900); A.flush();                                   // A earns capsules
  const starterId = B.items()[0].id;
  await B.setFav([starterId], true); B.flush();               // B (stale) hearts the starter
  const mid = stored(shared);
  await A.openCapsule(); A.flush();                           // A (stale) opens a capsule
  const end = stored(shared);
  const favIn = (s: HoardSave): boolean => s.ghosts.some((r) => r[0] === starterId && (r[4] & FLAG_FAV) !== 0);
  check('P10', "two tabs on one v2 save: each tab's change survives the other's write (B's heart on top of A's capsules, then A's new ghost on top of B's heart)",
    mid.ghostCapsules > 0 && favIn(mid) && end.ghosts.length === 2 && favIn(end) && end.ghostCapsules === mid.ghostCapsules - 1 && end.ghostOpened === 1,
    `capsules ${mid.ghostCapsules} -> ${end.ghostCapsules}, ghosts ${end.ghosts.length}, conflicts A ${A.storage().conflicts} B ${B.storage().conflicts}`);
  A.dispose(); B.dispose();
  const rb = rebaseHoard(freshHoard(T, mulberry32(1)), freshHoard(T, mulberry32(1)), freshHoard(T, mulberry32(1)));
  check('P10', 'rebaseHoard of three equal saves is that save', serializeHoard(rb) === serializeHoard(freshHoard(T, mulberry32(1))));
  const inner = memoryStorage();
  const [ta, tb] = makeTabs(inner, 2);
  const CA = mk(ta.storage, 12, { subscribe: ta.subscribe });
  const CB = mk(tb.storage, 13, { subscribe: tb.subscribe });
  const evB: string[] = [];
  CB.onEvent((e) => evB.push(e.type));
  let changesB = 0;
  CB.onChange(() => { changesB++; });
  play(CA, 900); await CA.openCapsule(); CA.flush();
  check('P10', "with the injected 'storage' subscription the idle tab adopts the other tab's shelf at once and announces it ('external')",
    CB.items().length === CA.items().length && CB.meter().credits === CA.meter().credits && evB.includes('external') && changesB > 0);
  CA.dispose(); CB.dispose();

  // P11 storage failures never crash and never pass silently
  T = T0;
  let fail = true;
  const flaky: StorageLike = { getItem: (k) => (fail ? null : backing.getItem(k)), setItem: (k, v) => { if (fail) throw new Error('QuotaExceededError'); backing.setItem(k, v); }, removeItem: (k) => backing.removeItem(k) };
  const backing = memoryStorage();
  let threw = false;
  let c11: Collection | null = null;
  const ev11: CollectionEvent[] = [];
  try {
    c11 = mk(flaky, 14);
    c11.onEvent((e) => ev11.push(e));
    const r0 = c11.storage();
    play(c11, 900); await c11.openCapsule(); c11.flush();
    const r1 = c11.storage();
    fail = false;
    await c11.markSeen(c11.items().map((i) => i.id)); c11.flush();
    const r2 = c11.storage();
    check('P11', 'a quota error on write: the status says "failing" (with plain copy), the game keeps playing, and the next good write says "ok" again',
      r0.save === 'failing' && r1.save === 'failing' && r2.save === 'ok' && saveStateCopy('failing') !== null && ev11.some((e) => e.type === 'storage') && c11.items().length === 2 && backing.getItem(HOARD_KEY) !== null);
  } catch { threw = true; }
  const silent = mk(guardStorage(throwing), 15);
  const nul = mk(null, 16);
  const blocked = mk(throwing, 17);
  play(nul, 300); await nul.openCapsule();
  check('P11', 'a storage that swallows writes is reported as failing; no storage at all, or one that throws on read, runs in memory as "unavailable" with saving "off"; nothing throws',
    !threw && silent.storage().save === 'failing' && nul.storage().load === 'unavailable' && nul.storage().save === 'off' && blocked.storage().load === 'unavailable' && nul.items().length === 2
    && loadStatusCopy('unavailable') !== null);
  silent.dispose(); nul.dispose(); blocked.dispose(); c11?.dispose();

  // P12 copy and the interface
  const texts = [...Object.values(COPY), loadStatusCopy('recovered')!, loadStatusCopy('repaired')!, loadStatusCopy('newer')!, loadStatusCopy('unavailable')!, saveStateCopy('failing')!, mergeRuleCopy()];
  const jargon = /\b(error|errno|exception|null|undefined|json|storage|quota|localstorage|corrupt|invalid|failed)\b|!/i;
  check('P12', 'player copy is plain: no jargon words, no exclamation marks, every line under 140 characters, the merge rule derives its count from MERGE_COST',
    texts.every((t) => t.length > 0 && t.length < 140 && !jargon.test(t)) && mergeRuleCopy().includes(['no', 'one', 'two', 'three'][MERGE_COST]), texts.filter((t) => jargon.test(t)).join(' | '));
  const st12 = buildStacks([], 'practice', T)[0];
  check('P12', 'plinth labels read like "Dollop, Common, Not yet" / "Dollop, Common, 3 copies, 2 spare, new"',
    plinthLabel(st12) === 'Dollop, Common, Not yet' && plinthLabel({ ...st12, copies: 3, spares: 2, unseen: 1 }) === 'Dollop, Common, 3 copies, 2 spare, new');
  T = T0;
  const c12 = mk(memoryStorage(), 18);
  const realStacks = c12.stacks('real');
  check('P12', 'the interface in this build: mode "guest", ledger "practice"; real-ledger reads are empty (50 empty real stacks); every action answers on the practice ledger',
    c12.mode === 'guest' && c12.ledger === 'practice' && c12.items('real').length === 0 && realStacks.length === 50 && realStacks.every((s) => s.copies === 0 && s.ledger === 'real')
    && c12.stacks().every((s) => s.ledger === 'practice') && c12.restock().ledger === 'practice' && (await c12.openCapsule()).ledger === 'practice');
  c12.dispose();
  check('P12', 'the restock pool, the task pool and the catalog are what this module assumes (25 restock species, 8 tasks, 50 species, MERGE_COST 2 or 3)',
    RESTOCK_POOL.length === 25 && TASK_DEFS.length === 8 && SPECIES.length === 50 && (MERGE_COST === 2 || MERGE_COST === 3) && TASK_CAPSULE_CAP >= TASKS_MAX_PER_WEEK);
}

/* ───────────────────────────── the source itself ───────────────────────────── */
section('S  sources');
{
  const dir = resolve(here, '../src/collection');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && statSync(join(dir, f)).isFile());
  const lines = files.reduce((n, f) => n + readFileSync(join(dir, f), 'utf8').split('\n').length, 0);
  check('S01', `src/collection holds the planned logic files and no server file (bridge.ts, api.ts, sync.ts are not in this build): ${files.join(', ')}`,
    ['constants.ts', 'types.ts', 'store.ts', 'stacks.ts', 'ghost.ts', 'meterfeed.ts', 'copy.ts', 'index.ts'].every((f) => files.includes(f)) && !files.some((f) => ['bridge.ts', 'api.ts', 'sync.ts'].includes(f)),
    `${lines} lines`);
  void addInteraction; void loadHoard;
}

console.log(`\n${total - bad}/${total} checks passed`);
process.exit(bad ? 1 : 0);

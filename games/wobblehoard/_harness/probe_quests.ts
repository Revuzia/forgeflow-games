// PLAYGROUND quest reducer probe (PG_QUESTS): QU-01 to QU-16 of _spec/PLAYGROUND_BUILD.md 18 over src/core/quests.ts, the rules of
// src/data/quests.ts and the shown set of src/collection/journal.ts. Plain node:  node _harness/probe_quests.ts   (exit 1 on any failure).
// Rows that need another lane's code print NOT RUN with the reason (never PASS): QU-13 (the real lifeStep), QU-03's motion-gate half (LF-10's
// scripted gate), QU-08's producer half (the shell's ring writers). Thresholds are the spec's, never loosened.
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PlayEventRing } from '../src/contracts.ts';
import {
  SC, applyEventFields, applyPlayEvent, blockedByAutonomy, buildQuestDefs, chapterOpen, createQuestOut, createQuestState, finaleOpen, hasKeys, isDone, isShown, markDone,
  needsAutonomy, openPlacesByStamps, placeOpen, questOpen, setQuestDay, setQuestParty, trackerQuest, QOUT, UNLOCK_FRIENDS, keyRoute, SQUEEZE_MIN_S,
  doableAt, giftReady, setGiftState,
} from '../src/core/quests.ts';
import type { QuestDefs, QuestState, PlaceCaps } from '../src/core/quests.ts';
import { PLACE_CAPS, THING_PLACE, PLACE_SHIPPED, PLACE_OPENS_AT, journalDefs, createJournal, mergeJournals, serializeJournal } from '../src/collection/journal.ts';
import { PLACE_IDS, PLACE_INFO, THING_IDS, MECH, ZONE, KEPT_PLACE_IDS, placeDropped } from '../src/data/places.ts';
import type { PlaceDef } from '../src/data/places.ts';
import { REACT_KIND as R, SOCIAL_KIND as S, USE_VERB, WISH_KIND, TOUCH, SPECIES_LIFE } from '../src/data/life.ts';
import { QUESTS, CHAPTERS, EV, BY, EV_FLAG, FACT, WISH_STATE, FRIEND_LEVEL, PIECES_USE, UI_KIND, GIFT_LISTS } from '../src/data/quests.ts';
import { CATALOG } from '../src/data/catalog.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..');
let bad = 0, notRun = 0;
const row = (id: string, what: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${extra ? '  ' + extra : ''}`); };
const skip = (id: string, what: string, why: string): void => { notRun++; console.log(`NOT RUN ${id} ${what}  (${why})`); };
const info = (id: string, what: string): void => console.log(`info ${id} ${what}`);

// (round 6, D-96) the seven kept places have a PlaceDef; DEFS stays indexed by place idx (a dropped place's slot is null)
const DEFS: (PlaceDef | null)[] = [];
for (const id of PLACE_IDS) DEFS.push(placeDropped(id) ? null : ((await import(`../src/data/place_${id}.ts`)) as { PLACE: PlaceDef }).PLACE);
const NQ = QUESTS.length;
/** (round 6, D-96) the quests that ship: the 80 that are not tombstones of the dropped places' chapters. */
const KEPT_Q = QUESTS.filter((q) => !q.dropped).map((q) => q.idx);
void KEPT_PLACE_IDS;
const sp = (id: string): number => CATALOG.findIndex((d) => d.id === id);
const famOf = (s: number): number => MATERIAL_FAMILY_IDS.indexOf(CATALOG[s].family);
const qIdx = (id: string): number => QUESTS.findIndex((q) => q.id === id);
const bit = (i: number): number => 1 << i;

/* ═══════════════════════════════ defs for a shipped set ═══════════════════════════════ */
function defsFor(shipped: readonly boolean[], caps: readonly PlaceCaps[] = PLACE_CAPS): QuestDefs {
  return buildQuestDefs({ placeIds: PLACE_IDS, thingIds: THING_IDS, shipped, opensAt: PLACE_OPENS_AT, thingPlace: THING_PLACE, caps });   // (round 6: by place idx, D-96)
}

/* ═══════════════════════════════ caps derived from the PlaceDefs (QU-14's independent recomputation) ═══════════════════════════════ */
const ANY_SOCIAL = [S.GREET, S.CHAT, S.BOOP, S.NUZZLE, S.COPY, S.PARADE, S.SING, S.SNUGGLE, S.PILE, S.COMFORT, S.MIRROR, S.DUET, S.TWIRL].reduce((m, k) => m | bit(k), 0);
function capsOf(def: PlaceDef): PlaceCaps {
  let reacts = 0, socials = ANY_SOCIAL, verbs = 0, soak = false, warm = false;
  for (const z of def.zones) {
    if (z.kind === ZONE.water) { reacts |= (z.surfaceY ?? 0) >= 0.12 ? bit(R.WADE) | bit(R.FLOAT) : bit(R.SPLASH); soak = true; socials |= bit(S.SQUIRT); if (z.flow) reacts |= bit(R.DRIFT); if (z.glow) reacts |= bit(R.GLOW); }
    if (z.kind === ZONE.current) reacts |= bit(R.DRIFT);
    if (z.kind === ZONE.wet) { soak = true; socials |= bit(S.SQUIRT); }
    if (z.shower) reacts |= bit(R.SHOWER);
    if (z.kind === ZONE.warm) { warm = true; const s = z.strength; if (s >= 0.5) reacts |= bit(R.WARM); if (0.75 * s >= 0.5) reacts |= bit(R.TOAST); if (s >= 0.6) reacts |= bit(R.RISE) | bit(R.OOZE); }
    if (z.kind === ZONE.cold) reacts |= bit(R.SHIVER) | bit(R.FROST);
    if (z.kind === ZONE.wind) reacts |= bit(R.HOLD_ON);
    if (z.kind === ZONE.updraft) reacts |= bit(R.LIFT);
    if (z.kind === ZONE.magnet) reacts |= bit(R.RATTLE);
    if (z.kind === ZONE.echo) socials |= bit(S.ECHO);
  }
  if (soak) reacts |= bit(R.SOAK);
  if (soak && warm) reacts |= bit(R.DRY);
  if (def.ground.mark > 0) reacts |= bit(R.PRINT);
  for (const p of def.patches) { if (p.ice || (p.mods.grip ?? 1) < 0.5) reacts |= bit(R.GLIDE); if (p.mark) reacts |= bit(R.PRINT); }
  for (const t of def.things) {
    verbs |= bit(t.verb);
    if (t.mech === MECH.seesaw) socials |= bit(S.TEETER);
    if (t.mech === MECH.swing) socials |= bit(S.PUSH);
    if (t.mech === MECH.ball) socials |= bit(S.PASS);
    if (t.peek) socials |= bit(S.PEEK);
    if (t.id === 'shakepine' || t.id === 'snowball') reacts |= bit(R.SNOWCAP);
    if ((t.id === 'moondish' && def.night) || t.id === 'starscope') reacts |= bit(R.GAZE_SKY);
    if (t.id === 'bubblepatch') reacts |= bit(R.FIZZ);
    if (t.id === 'dripleaf') reacts |= bit(R.SHOWER);
  }
  if (Object.values(SPECIES_LIFE).some((l) => l.place === def.id)) reacts |= bit(R.LOVE);
  return { reacts, socials, verbs };
}
const DERIVED_CAPS = DEFS.map((d) => d ? capsOf(d) : { reacts: 0, socials: 0, verbs: 0 });   // (D-96: a dropped place produces nothing)
const ALL = PLACE_IDS.map(() => true);
const S1 = PLACE_SHIPPED;
void PLACE_INFO;
const dAll = defsFor(ALL, DERIVED_CAPS);
const dS1 = journalDefs();

/* ═══════════════════════════════ minimal event scripts (QU-02) ═══════════════════════════════ */
type Rec = [kind: number, sub: number, place: number, thing: number, a: number, b: number, fam: number, n2: number, by: number, flag: number, v: number];
const firstSub = (d: QuestDefs, c: number): number => { for (let s = 0; s < 96; s++) if (d.cSub[c * 3 + (s >>> 5)] & (1 << (s & 31))) return s; return -1; };
const subs = (d: QuestDefs, c: number): number[] => { const o: number[] = []; for (let s = 0; s < 96; s++) if (d.cSub[c * 3 + (s >>> 5)] & (1 << (s & 31))) o.push(s); return o; };
const BEST_A = sp('dollop'), BEST_B = sp(SPECIES_LIFE.dollop.friend);
/** one species per family (for distinct 'family') */
const BY_FAM = MATERIAL_FAMILY_IDS.map((f) => CATALOG.findIndex((c) => c.family === f));
function capablePlaces(d: QuestDefs, caps: readonly PlaceCaps[], c: number): number[] {
  const out: number[] = [];
  const ev = d.cEv[c], s = firstSub(d, c);
  for (let p = 0; p < d.nPlaces; p++) {
    if (!(d.placeShipped & bit(p))) continue;
    if (d.cPlace[c] >= 0 && d.cPlace[c] !== p) continue;
    if (d.cPlace[c] === -2 && p === 0) continue;
    if (d.cThing[c] >= 0 && d.thingPlace[d.cThing[c]] !== p) continue;
    const cap = caps[p];
    if (ev === EV.REACT && (s < 0 ? cap.reacts === 0 : !(cap.reacts & bit(s)))) continue;
    if (ev === EV.PIECES && (s < PIECES_USE ? !(cap.reacts & bit(s)) : !(cap.verbs & bit(s - PIECES_USE)))) continue;
    if (ev === EV.SOCIAL && s >= 0 && !(cap.socials & bit(s))) continue;
    if (ev === EV.DISCOVER && s === FACT.PLACE && !(cap.reacts & bit(R.LOVE))) continue;
    if (ev === EV.WISH && d.cV[c] === WISH_KIND.PLACE && p === 0) continue;
    out.push(p);
  }
  return out;
}
function scriptFor(d: QuestDefs, caps: readonly PlaceCaps[], q: number): Rec[] {
  const recs: Rec[] = [];
  const same = sp('puddlo');
  for (let c = d.qFirst[q]; c < d.qFirst[q + 1]; c++) {
    const ev = d.cEv[c], s0 = firstSub(d, c), places = capablePlaces(d, caps, c);
    const dist = d.cDist[c], n = d.cCount[c];
    for (let k = 0; k < n; k++) {
      let place = dist === 6 ? places[k] : places[0];
      let a = d.cSame[c] ? same : dist === 1 ? k + 2 : dist === 2 ? BY_FAM[k] : 4;
      let b = dist === 5 ? 20 + k : 7;
      const fam = d.cFam[c] >= 0 ? d.cFam[c] : famOf(a);
      const by = d.cBy[c] === 1 ? BY.PLAYER : BY.SELF;
      const v = ev === EV.TOUCH ? (d.cV[c] === d.cV[c] ? d.cV[c] : 0.5) : ev === EV.WISH ? (d.cV[c] === d.cV[c] ? d.cV[c] : WISH_KIND.NAP) : dist === 4 ? k : 0;
      if (dist === 5) a = 10 + k;
      if (ev === EV.DISCOVER) {
        if (s0 === FACT.PLACE) recs.push([EV.REACT, R.LOVE, place, -1, k + 30, 255, famOf(k + 30), 1, BY.SELF, 0, 0]);
        else if (s0 === FACT.FRIEND) recs.push([EV.SOCIAL, S.GREET, place, -1, BEST_A, BEST_B, famOf(BEST_A), 2, BY.SELF, 0, 0]);
        continue;
      }
      if (ev === EV.FRIEND) { for (let z = 0; z < 6; z++) recs.push([EV.SOCIAL, S.NUZZLE, place, -1, 40 + k, 41 + k, famOf(40 + k), 2, BY.SELF, 0, 0]); continue; }
      if (place === undefined) place = 0;
      const sub = s0 >= 0 ? s0 : ev === EV.REACT ? (caps[place].reacts & bit(R.WARM) ? R.WARM : Math.log2(caps[place].reacts & -caps[place].reacts)) : 0;
      recs.push([ev, sub, place, d.cThing[c], a, b, fam, Math.max(d.cMinN[c], ev === EV.SOCIAL ? 2 : 1), by, d.cFlag[c], v]);
    }
  }
  return recs;
}
/** A state where quest q is open: every shipped place open, the first wish shown, 5 mains of its chapter done (finale), 2 finales (FE). */
function stateFor(d: QuestDefs, q: number): { st: QuestState; out: ReturnType<typeof createQuestOut> } {
  const st = createQuestState(d), out = createQuestOut(256);
  setQuestDay(st, 20407);
  st.sc[SC.PL] = d.placeShipped; st.sc[SC.FW] = 1; st.sc[SC.WISHER] = 255;
  const ch = d.qChapter[q];
  if (ch === CHAPTERS.length - 1) { markDone(st, d, CHAPTERS[0].finale, out); markDone(st, d, CHAPTERS[1].finale, out); }
  if (d.qKind[q] === 1 && ch !== 0) { let m = 0; for (let j = 0; j < d.nq && m < 5; j++) if (d.qChapter[j] === ch && d.qKind[j] === 0) { markDone(st, d, j, out); m++; } }
  out.n = 0;
  return { st, out };
}
const apply = (st: QuestState, d: QuestDefs, out: ReturnType<typeof createQuestOut>, r: Rec): number => applyEventFields(st, d, out, ...r);

/* ═══════════════════════════════ QU-01: pure, allocation-free, imports ═══════════════════════════════ */
{
  const src = readFileSync(resolve(ROOT, 'src/core/quests.ts'), 'utf8');
  const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)].map((m) => `${m[2]}${m[1] ? ':type' : ''}`);
  const allowed = ['./rng.ts', '../data/quests.ts', '../data/life.ts', '../data/catalog.ts'];
  const valueImports = imports.filter((i) => !i.endsWith(':type'));
  row('QU-01', 'src/core/quests.ts imports only ./rng.ts, ../data/quests.ts, ../data/life.ts, ../data/catalog.ts and types (no meter, no clock, no random)',
    valueImports.every((i) => allowed.includes(i)) && !/meter\.ts|Date\.now|Math\.random|performance\.now|new Date/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), imports.join(', '));
  const roll = ['roll' + 'Capsule', 'roll' + 'Merge'];
  const files = ['src/core/quests.ts', 'src/collection/journal.ts', 'src/collection/journal_store.ts', '_harness/probe_quests.ts', '_harness/probe_journal.ts', '_harness/probe_pg_economy.ts'];
  const hits = files.filter((f) => { try { const t = readFileSync(resolve(ROOT, f), 'utf8'); return roll.some((w) => t.includes(w)); } catch { return false; } });
  row('QU-01', 'the capsule-roll function names appear in none of the Journal files (probe I03 scans strings and comments too)', hits.length === 0, hits.join(', ') || `${files.length} files`);
  // 10 000 ring records through applyPlayEvent after warm-up: 0 B
  const cap = 64;
  const ring: PlayEventRing = { n: 0, dropped: 0, kind: new Uint8Array(cap), sub: new Uint8Array(cap), place: new Uint8Array(cap), thing: new Int16Array(cap), a: new Uint8Array(cap),
    b: new Uint8Array(cap), fam: new Uint8Array(cap), n2: new Uint8Array(cap), by: new Uint8Array(cap), flag: new Uint8Array(cap), v: new Float32Array(cap) };
  const pool: Rec[] = [];
  for (let q = 0; q < NQ; q++) if (isShown(dAll, q)) for (const r of scriptFor(dAll, DERIVED_CAPS, q)) pool.push(r);
  pool.push([EV.VISIT, 0, 1, -1, 0, 255, 255, 0, 1, 0, 0], [EV.WISH, WISH_STATE.SHOWN, 0, 1, 3, 255, 0, 0, 0, 0, WISH_KIND.PLACE], [EV.SIGNATURE, 0, 1, -1, 0, 255, 0, 0, 0, 0, 0]);
  for (let k = 0; k < cap; k++) { const r = pool[k % pool.length]; ring.kind[k] = r[0]; ring.sub[k] = r[1]; ring.place[k] = r[2]; ring.thing[k] = r[3]; ring.a[k] = r[4]; ring.b[k] = r[5]; ring.fam[k] = r[6]; ring.n2[k] = r[7]; ring.by[k] = r[8]; ring.flag[k] = r[9]; ring.v[k] = r[10]; }
  ring.n = cap;
  const st = createQuestState(dAll), out = createQuestOut(64);
  setQuestDay(st, 20407);
  setQuestParty(st, [0, 1, 2], [0, 1, 2], 3);
  const run = (events: number): void => { for (let e = 0; e < events; e++) { if (out.n > 48) out.n = 0; applyPlayEvent(st, ring, e & (cap - 1), dAll, out); } };
  run(20000);
  const newUsed = (): number => { for (const s of v8.getHeapSpaceStatistics()) if (s.space_name === 'new_space') return s.space_used_size; return NaN; };
  const base: number[] = []; for (let k = 0; k < 6; k++) { const u = newUsed(); base.push(newUsed() - u); }
  let best = Infinity;
  for (let w = 0; w < 6; w++) { const u = newUsed(); run(10000); const dd = newUsed() - u - base[5]; if (dd >= 0 && dd < best) best = dd; }
  row('QU-01', 'applyPlayEvent allocates 0 B over 10 000 ring records after warm-up (every shown rule\'s script, visits, wishes, signatures: completions, facts, friendship, warmth)', best === 0,
    `${best} B per 10 000 events; ${st.sc[SC.ST]} stamps, ${pool.length} distinct records`);
}

/* ═══════════════════════════════ QU-02: every quest from its minimal script; replay; near miss ═══════════════════════════════ */
{
  const fails: string[] = [], replayFails: string[] = [], nearFails: string[] = [];
  for (const q of KEPT_Q) {   // (round 6, D-96: the 80 kept quests; the 30 tombstones are checked never shown and never done in QU-14)
    const script = scriptFor(dAll, DERIVED_CAPS, q);
    const { st, out } = stateFor(dAll, q);
    if (!questOpen(st, dAll, q)) { fails.push(`${QUESTS[q].id} (not open)`); continue; }
    for (const r of script) apply(st, dAll, out, r);
    if (!isDone(st, q)) { fails.push(QUESTS[q].id); continue; }
    out.n = 0;
    const stamps = st.sc[SC.ST];
    for (const r of script) apply(st, dAll, out, r);
    let again = 0; for (let k = 0; k < out.n; k++) if (out.kind[k] === QOUT.QUEST && out.a[k] === q) again++;
    if (again !== 0 || !isDone(st, q) || st.sc[SC.ST] < stamps) replayFails.push(QUESTS[q].id);
    // near miss: the script without its last record never completes it
    const n2 = stateFor(dAll, q);
    for (const r of script.slice(0, -1)) apply(n2.st, dAll, n2.out, r);
    if (isDone(n2.st, q)) nearFails.push(QUESTS[q].id);
  }
  row('QU-02', `every one of the ${KEPT_Q.length} kept quests completes from its generated minimal event script (an all-shipped build, so all ${KEPT_Q.length} are shown; re-specified in round 6: was 110, D-96 dropped 30)`, fails.length === 0, fails.join(', ') || `${KEPT_Q.length} of ${KEPT_Q.length}`);
  row('QU-02', 'replaying a completed quest\'s script completes it no second time (no second stamp, no decrement)', replayFails.length === 0, replayFails.join(', '));
  row('QU-02', 'a near-miss script (the minimal script without its last record) completes none of them', nearFails.length === 0, nearFails.join(', '));
  // field near misses: wrong place, wrong by, too few characters, wrong thing
  const nm: string[] = [];
  const tryMiss = (id: string, mutate: (r: Rec) => void): void => {
    const q = qIdx(id); const sc = scriptFor(dAll, DERIVED_CAPS, q); const { st, out } = stateFor(dAll, q);
    for (const r of sc) { const x = r.slice() as Rec; mutate(x); apply(st, dAll, out, x); }
    if (isDone(st, q)) nm.push(id);
  };
  tryMiss('C1', (r) => { r[2] = 0; });                                     // VISIT Home, not the cabin
  tryMiss('H9', (r) => { r[8] = BY.SELF; });                               // the ball rolled by itself, not flicked
  tryMiss('C6', (r) => { r[7] = 2; });                                     // two pieces, not three
  tryMiss('I4', (r) => { r[3] = -1; });                                    // snow with no thing (not the pine)
  tryMiss('R3', (r) => { r[10] = 0; });                                    // the same shell three times
  tryMiss('X8', (r) => { r[9] = 0; });                                     // no best pair in the photo
  tryMiss('H8', (r) => { r[10] = WISH_KIND.NAP; });                        // a nap wish, not the place wish
  { let k = 0; tryMiss('X5', (r) => { if (k++ === 0) r[2] = 0; }); }        // Home is not 'away': two places beyond Home and Home
  row('QU-02', 'field near misses do not complete: C1 at Home, H9 by itself, C6 with 2 pieces, I4 without the pine, R3 one shell 3 times, X8 without the best pair, H8 with a nap wish, X5 with Home as one of its 3 places',
    nm.length === 0, nm.join(', ') || '8 of 8');
}

/* ═══════════════════════════════ QU-03: fairness (Q3, Q4) ═══════════════════════════════ */
{
  const touch = QUESTS.filter((q) => q.clauses.some((c) => c.ev === EV.TOUCH));
  const leaks: string[] = [];
  for (const qd of touch) {
    const q = qd.idx; const { st, out } = stateFor(dAll, q);
    for (const r of scriptFor(dAll, DERIVED_CAPS, q)) { const x = r.slice() as Rec; if (x[0] === EV.TOUCH && (x[1] === TOUCH.SQUEEZE)) x[10] = SQUEEZE_MIN_S - 0.01; apply(st, dAll, out, x); }
    for (let k = 0; k < 50; k++) apply(st, dAll, out, [EV.TOUCH, TOUCH.POKE, 2, -1, 0, 255, 0, 1, BY.PLAYER, 0, 0]);
    if (qd.clauses.some((c) => c.ev === EV.TOUCH && c.sub?.includes(TOUCH.SQUEEZE)) && isDone(st, q)) leaks.push(qd.id);
  }
  row('QU-03', 'Q3: no TOUCH clause accepts a press under 0.4 s (H1, R8: their scripts with 0.39 s squeezes and 50 pokes complete nothing); no clause counts a poke', leaks.length === 0 && !QUESTS.some((q) => q.clauses.some((c) => c.ev === EV.TOUCH && c.sub?.includes(TOUCH.POKE))),
    leaks.join(', ') || `${touch.map((q) => q.id).join(', ')}`);
  const commons = new Map<string, number>(); for (const c of CATALOG) if (c.tier === 'common') commons.set(c.family, (commons.get(c.family) ?? 0) + 1);
  const famBad = QUESTS.filter((q) => q.kind !== 'bonus' && q.clauses.some((c) => c.family !== undefined && (commons.get(MATERIAL_FAMILY_IDS[c.family]) ?? 0) < 2)).map((q) => q.id);
  const minNBad = QUESTS.filter((q) => q.clauses.some((c) => (c.minN ?? 0) > 6)).map((q) => q.id);
  row('QU-03', 'Q4 (static): a main quest names a family only if it has 2 or more Commons; no clause needs more than 6 characters in one event (low caps: 3 wholes, 6 characters); no clause names a species',
    famBad.length === 0 && minNBad.length === 0 && !QUESTS.some((q) => q.clauses.some((c) => 'species' in c)), [...famBad, ...minNBad].join(', ') || 'none');
  skip('QU-03', 'Q4 against LIFE 10.3\'s revised motion gate (the floor, the ride allowance for C3, L9, U4, C5, G3, the soft boop) at moverCap 1', 'needs PG_LIFE\'s src/life/attention.ts gate and LF-10\'s scripted gate');
}

/* ═══════════════════════════════ QU-04: counts (Q5) ═══════════════════════════════ */
{
  const over = QUESTS.filter((q) => q.clauses.some((c) => c.count > (q.kind === 'bonus' ? (c.distinct ? 6 : 5) : (c.distinct ? 4 : 3)))).map((q) => q.id);
  row('QU-04', 'Q5: a main quest or finale repeats one deed at most 3 times (distinct at most 4), a bonus at most 5 (distinct 6)', over.length === 0, over.join(', ') || `${NQ} quests`);
}

/* ═══════════════════════════════ the reducer's own state rules (brief S0 items 3 and 4): friendship, warmth, facts, keepsakes ═══════════════════════════════ */
{
  const out = createQuestOut(512);
  // friendship (LIFE 6.2): points by moment, x1.5 for a best-friend pair before the 20-a-day cap, levels as FRIEND records, no points for a wish's greet
  const st = createQuestState(dS1); setQuestDay(st, 100);
  const soc = (k: number, a: number, b: number, v = 0): void => { applyEventFields(st, dS1, out, EV.SOCIAL, k, 0, -1, a, b, 0, 2, BY.SELF, 0, v); };
  const pts = (a: number, b: number): number => { const lo = Math.min(a, b), hi = Math.max(a, b); for (let r = 0; r < st.sc[SC.FRN]; r++) if (st.frLo[r] === lo && st.frHi[r] === hi) return st.frPts[r]; return 0; };
  out.n = 0;
  soc(S.NUZZLE, BEST_A, BEST_B); const p1 = pts(BEST_A, BEST_B);                 // 2 x 1.5 = 3
  soc(S.GREET, 2, 3, -1); const p0 = pts(2, 3);                                   // a friend wish's grant greet: no points
  for (let k = 0; k < 20; k++) soc(S.NUZZLE, 2, 3); const pCap = pts(2, 3);       // capped at 20 a day
  const levels = Array.from({ length: out.n }, (_, k) => k).filter((k) => out.kind[k] === QOUT.FRIEND && out.a[k] === 2 && out.b[k] === 3).map((k) => out.by[k]).join();
  setQuestDay(st, 101); soc(S.NUZZLE, 2, 3); const pNext = pts(2, 3);
  for (let k = 0; k < 20; k++) { setQuestDay(st, 102 + k); for (let z = 0; z < 10; z++) soc(S.NUZZLE, 2, 3); }
  const closeLv = Array.from({ length: out.n }, (_, k) => k).some((k) => out.kind[k] === QOUT.FRIEND && out.by[k] === FRIEND_LEVEL.CLOSE);
  row('friendship', 'LIFE 6.2: a best-friend pair earns x1.5 (nuzzle 2 -> 3), a friend wish\'s greet earns 0, at most 20 a pair a UTC day, Met at 1 / Friends at 12 / Close at 40 each a FRIEND record once',
    p1 === 3 && p0 === 0 && pCap === 20 && levels === '1,2' && pNext === 22 && closeLv, `best ${p1}, wish greet ${p0}, day cap ${pCap}, levels [${levels}], next day ${pNext}`);
  // eviction: 128 rows, never a pair at Friends or closer or a best-friend pair; the Met-only pair with the fewest points goes first
  const e = createQuestState(dS1); setQuestDay(e, 5);
  for (let r = 0; r < 128; r++) { e.frLo[r] = r < 64 ? 0 : 1; e.frHi[r] = 2 + (r % 64); e.frPts[r] = r < 100 ? 15 : 1 + (r % 3); }
  e.frLo[127] = BEST_A; e.frHi[127] = BEST_B; e.frPts[127] = 1; e.sc[SC.FRN] = 128;
  const before = Array.from(e.frPts);
  applyEventFields(e, dS1, out, EV.SOCIAL, S.GREET, 0, -1, 40, 45, 0, 2, BY.SELF, 0, 0);
  const evictedRow = before.findIndex((p, r) => e.frLo[r] === 40 && e.frHi[r] === 45 && p !== undefined);
  const okEvict = evictedRow >= 100 && evictedRow < 127 && before[evictedRow] === 1 && e.frLo[127] === BEST_A && e.frPts.slice(0, 100).every((p) => p === 15);
  for (let r = 100; r < 127; r++) e.frPts[r] = 13;  // now every row is Friends or closer, or the best pair
  applyEventFields(e, dS1, out, EV.SOCIAL, S.GREET, 0, -1, 41, 46, 0, 2, BY.SELF, 0, 0);
  let stored = false; for (let r = 0; r < 128; r++) if (e.frLo[r] === 41 && e.frHi[r] === 46) stored = true;
  row('friendship', 'at 128 rows a new pair replaces the Met-only pair with the fewest points; never a Friends+ pair or a best-friend pair; with none to drop the new pair waits',
    okEvict && !stored && e.frLo[127] === BEST_A, `replaced row ${evictedRow} (${before[evictedRow]} pt)`);
  // warmth (LIFE 6.3): +1 loved touch (3 a day), +3 a granted wish, +2 its favourite place once a day, +1 a nap there once a day; max 50
  const w = createQuestState(dS1); setQuestDay(w, 9);
  const dol = sp('dollop');                                                                   // favourite place: Hearthlog
  setQuestParty(w, [7], [dol], 1);
  for (let k = 0; k < 5; k++) applyEventFields(w, dS1, out, EV.SIGNATURE, 0, 0, -1, dol, 255, 0, 1, BY.SELF, 0, 0);
  const wLoved = w.wm[7];
  applyEventFields(w, dS1, out, EV.WISH, WISH_STATE.GRANTED, 0, -1, dol, 255, 0, 0, BY.PLAYER, 0, WISH_KIND.NAP);
  for (let k = 0; k < 2; k++) applyEventFields(w, dS1, out, EV.BRING, 0, 1, -1, dol, 255, 0, 2, BY.PLAYER, 0, 0);
  for (let k = 0; k < 2; k++) applyEventFields(w, dS1, out, EV.SOCIAL, S.PILE, 1, -1, dol, 3, 0, 2, BY.SELF, 0, 0);
  const wDay1 = w.wm[7];
  setQuestDay(w, 10); applyEventFields(w, dS1, out, EV.BRING, 0, 1, -1, dol, 255, 0, 2, BY.PLAYER, 0, 0);
  for (let k = 0; k < 40; k++) applyEventFields(w, dS1, out, EV.WISH, WISH_STATE.GRANTED, 0, -1, dol, 255, 0, 0, BY.PLAYER, 0, WISH_KIND.NAP);
  row('warmth', 'LIFE 6.3 per item: loved touch +1 at most 3 a day (5 -> 3), a granted wish +3, its favourite place +2 once a day, a nap there +1 once a day (day 1: 9), next day +2 again; it never passes 50',
    wLoved === 3 && wDay1 === 9 && w.wm[7] === 50, `loved ${wLoved}, day 1 ${wDay1}, end ${w.wm[7]}`);
  // facts (QUESTS 9): each from its event
  const f = createQuestState(dS1); setQuestDay(f, 9);
  const s0 = sp('puddlo'), bf = sp(SPECIES_LIFE.puddlo.friend), fav = THING_IDS.indexOf(SPECIES_LIFE.puddlo.thing);
  const ev = (k: number, sub: number, place: number, thing: number, a: number, b = 255, v = 0, by: number = BY.SELF): void => { applyEventFields(f, dS1, out, k, sub, place, thing, a, b, 0, 2, by, 0, v); };
  ev(EV.BRING, 0, 0, -1, s0); ev(EV.REACT, R.LOVE, 2, -1, s0); ev(EV.REACT, R.SPLASH, 2, -1, s0, 255); ev(EV.USE, USE_VERB.WADE, 2, fav, s0);
  ev(EV.SOCIAL, S.GREET, 0, -1, s0, bf); ev(EV.REACT, R.WARM, 1, 6, s0); ev(EV.REACT, R.SHIVER, 1, -1, s0); ev(EV.REACT, R.GLIDE, 3, -1, s0);
  ev(EV.SOCIAL, S.SING, 0, -1, s0, 3); ev(EV.SIGNATURE, 0, 0, -1, s0); ev(EV.WISH, WISH_STATE.GRANTED, 0, -1, s0, 255, WISH_KIND.NAP, BY.PLAYER); ev(EV.SOCIAL, S.MIRROR, 0, -1, s0, s0);
  const mask = f.fx[s0];
  row('facts', 'QUESTS 9: F0 bring, F1 a LOVE react, F2 a use of its favourite thing, F3 its best friend\'s greet (both), F4 water, F5 warm, F6 cold, F7 ground, F8 a song, F9 its signature, F10 a granted wish, F11 a twin dance: all 12; a gold page counted once',
    mask === 0xfff && (f.fx[bf] & (1 << FACT.FRIEND)) !== 0 && f.sc[SC.GOLD] === 1, `mask ${mask.toString(2)}, gold ${f.sc[SC.GOLD]}`);
  // keepsakes (QUESTS 10)
  const k = createQuestState(dAll); setQuestDay(k, 9); out.n = 0;
  k.sc[SC.FW] = 1; k.sc[SC.PL] = dAll.placeShipped;
  applyEventFields(k, dAll, out, EV.SOCIAL, S.GREET, 0, -1, BEST_A, BEST_B, 0, 2, BY.SELF, 0, 0);                    // Pair Charm (bit 11)
  for (let d2 = 0; d2 < 3; d2++) { setQuestDay(k, 20 + d2); for (let z = 0; z < 10; z++) applyEventFields(k, dAll, out, EV.SOCIAL, S.NUZZLE, 0, -1, 4, 5, 0, 2, BY.SELF, 0, 0); }  // Ribbon (12)
  for (let p = 0; p < 5; p++) applyEventFields(k, dAll, out, EV.SOCIAL, S.SING, p, -1, 4, 5, 0, 3, BY.SELF, 0, 0);                 // Songbook (14)
  for (let z = 0; z < 10; z++) applyEventFields(k, dAll, out, EV.WISH, WISH_STATE.GRANTED, 0, -1, 4, 255, 0, 0, BY.PLAYER, 0, WISH_KIND.NAP);  // Wish Jar (15)
  for (let p = 0; p < 10; p++) if (!placeDropped(p)) applyEventFields(k, dAll, out, EV.VISIT, 0, p, -1, 255, 255, 255, 1, BY.PLAYER, 0, 0);   // Pocket Map (18): the seven (D-96)
  markDone(k, dAll, CHAPTERS[0].finale, out);                                                                                        // Felt Star (0)
  const ks = k.sc[SC.KS];
  const want = [0, 11, 12, 14, 15, 18].reduce((m, b) => m | (1 << b), 0);
  row('keepsakes', 'QUESTS 10: the Felt Star at the Home finale; the Pair Charm at the first best pair, the Friendship Ribbon at the first Close friends, the Songbook at 5 song places, the Wish Jar at 10 wishes, the Pocket Map at every place; each once',
    (ks & want) === want && (ks & ~want) === 0, `bits ${(ks >>> 0).toString(2)}`);
}

/* ═══════════════════════════════ QU-05: finales open at 5 of 7 (Home's at the first wish), never earlier ═══════════════════════════════ */
{
  const early: string[] = [], late: string[] = [];
  for (const ch of CHAPTERS) { if (ch.dropped) continue;   // (round 6, D-96: a dropped chapter has no finale)
    const q = ch.finale;
    const st = createQuestState(dAll), out = createQuestOut(256);
    setQuestDay(st, 20407);
    st.sc[SC.PL] = dAll.placeShipped;
    if (ch.idx === CHAPTERS.length - 1) { st.sc[SC.FW] = 1; markDone(st, dAll, CHAPTERS[0].finale, out); markDone(st, dAll, CHAPTERS[1].finale, out); }
    const mains = QUESTS.filter((x) => x.chapter === ch.idx && x.kind === 'main').map((x) => x.idx);
    const script = scriptFor(dAll, DERIVED_CAPS, q);
    if (ch.idx === 0) {
      for (const r of script) apply(st, dAll, out, r);
      if (isDone(st, q) || finaleOpen(st, dAll, 0)) early.push(`${QUESTS[q].id} before the first wish`);
      apply(st, dAll, out, [EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE]);
      for (const r of script) apply(st, dAll, out, r);
      if (!isDone(st, q)) late.push(QUESTS[q].id);
      continue;
    }
    for (let m = 0; m < 4; m++) markDone(st, dAll, mains[m], out);
    for (const r of script) apply(st, dAll, out, r);
    if (isDone(st, q) || finaleOpen(st, dAll, ch.idx)) early.push(`${QUESTS[q].id} at 4 of 7`);
    markDone(st, dAll, mains[4], out);
    for (const r of script) apply(st, dAll, out, r);
    if (!isDone(st, q)) late.push(QUESTS[q].id);
  }
  row('QU-05', 'each finale opens at 5 of its 7 main quests and never earlier (its script at 4 of 7 completes nothing, at 5 it does); Home\'s opens when the first wish shows', early.length === 0 && late.length === 0,
    [...early, ...late.map((x) => `${x} did not open`)].join(', ') || `${CHAPTERS.length} finales`);
}

/* ═══════════════════════════════ QU-06: places open by stamps, in order; unshipped skipped, stamps kept ═══════════════════════════════ */
{
  const at = PLACE_OPENS_AT;   // (by place idx, round 6)
  const order: string[] = [];
  const st = createQuestState(dAll), out = createQuestOut(512);
  apply(st, dAll, out, [EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE]);
  let ok = placeOpen(st, 1) && !placeOpen(st, 2);
  for (let q = 0; q < NQ && st.sc[SC.ST] < 80; q++) {
    if (QUESTS[q].kind === 'finale' || QUESTS[q].dropped) continue;
    const before = st.sc[SC.PL];
    out.n = 0;
    markDone(st, dAll, q, out);
    const opened = st.sc[SC.PL] & ~before;
    for (let p = 0; p < PLACE_IDS.length; p++) if (opened & bit(p)) { order.push(`${PLACE_IDS[p]}@${st.sc[SC.ST]}`); if (st.sc[SC.ST] !== at[p]) ok = false; }
  }
  const inOrder = order.map((s) => PLACE_IDS.indexOf(s.split('@')[0] as typeof PLACE_IDS[number])).every((p, i, a) => i === 0 || p > a[i - 1]);
  // (re-specified in round 6 for D-96: the five places past the cabin at 12 / 20 / 28 / 36 / 45, was eight at 12 .. 72; Lanternroof and Cloudloft take
  // the dropped Fizzwell Tub's and Cogwhistle Bench's slots, the same 8 to 9 stamp gaps of QUESTS 7)
  row('QU-06', 'stamps open the places in order, each exactly at its threshold (12 / 20 / 28 / 36 / 45), all shipped; a dropped place never opens', ok && inOrder && order.join(' ') === 'ripple@12 frostbell@20 rainleaf@28 lanternroof@36 cloudloft@45', order.join(' '));
  // an unshipped place is skipped and its stamps kept; it opens the moment it ships
  const mixed = PLACE_IDS.map((id) => id === 'home' || id === 'hearthlog' || id === 'frostbell');
  const dM = defsFor(mixed, DERIVED_CAPS);
  const s2 = createQuestState(dM), o2 = createQuestOut(512);
  s2.sc[SC.PL] = 3; s2.sc[SC.FW] = 1;
  for (let q = 0; q < 25; q++) markDone(s2, dM, q, o2);
  const skipped = !placeOpen(s2, 2) && placeOpen(s2, 3);
  const dM2 = defsFor(PLACE_IDS.map((id, i) => mixed[i] || id === 'ripple'), DERIVED_CAPS);
  openPlacesByStamps(s2, dM2, o2);
  row('QU-06', 'with Ripple unshipped and Frostbell shipped, 25 stamps open Frostbell (Ripple skipped, its stamps kept); Ripple opens the moment it ships', skipped && placeOpen(s2, 2),
    `stamps ${s2.sc[SC.ST]}, places ${s2.sc[SC.PL].toString(2)}`);
  // (RE-SPECIFIED in round 7, R7_LIFE: the row said "this S1 build: 20 stamps open nothing beyond Home and Hearthlog (the S2 / S3 places have not shipped)".
  // Ripple Shore, Frostbell Ridge and Rainleaf Garden ship from round 7 (the orchestrator's brief: R6_SHELL_open_s2.patch), so the build's rule is checked for
  // the places that SHIP (PLACE_INFO, the build's own table): at 20 stamps and at the most this build's shown quests give, the open places are exactly Home,
  // Hearthlog and every shipped place whose threshold the stamps reach; an unshipped place never opens. Still true of the S1 build: only Home and Hearthlog.)
  const shipped = PLACE_INFO.filter((p) => p.shipped).map((p) => p.idx), shownQ = QUESTS.filter((q) => isShown(dS1, q.idx) && q.kind !== 'finale').map((q) => q.idx);
  const opensBuild: string[] = [];
  let buildOk = true;
  for (const n of [20, Math.min(45, shownQ.length)]) {
    const s3 = createQuestState(dS1), o3 = createQuestOut(512);
    s3.sc[SC.FW] = 1; s3.sc[SC.PL] = 3;
    for (const q of shownQ) { if (s3.sc[SC.ST] >= n) break; markDone(s3, dS1, q, o3); }
    let want = 3;
    for (const p of shipped) if (p > 1 && typeof PLACE_OPENS_AT[p] === 'number' && PLACE_OPENS_AT[p] <= s3.sc[SC.ST]) want |= bit(p);
    if (s3.sc[SC.PL] !== want) buildOk = false;
    opensBuild.push(`${s3.sc[SC.ST]} stamps: ${PLACE_IDS.filter((_, p) => s3.sc[SC.PL] & bit(p)).join(' ')}`);
  }
  row('QU-06', `this build (shipped: ${shipped.map((p) => PLACE_IDS[p]).join(', ')}): stamps open exactly the shipped places whose threshold they reach, never an unshipped one`, buildOk, opensBuild.join('; '));
}

/* ═══════════════════════════════ QU-07: gift finales need the player ═══════════════════════════════ */
{
  const playerEv = new Set<number>([EV.TOUCH, EV.PHOTO]);
  const gifts = CHAPTERS.filter((c) => c.gift).map((c) => QUESTS[c.finale]);
  const noPlayer = gifts.filter((q) => !q.clauses.some((c) => playerEv.has(c.ev) || c.by === BY.PLAYER)).map((q) => q.id);
  const tagBad = gifts.filter((q) => q.playerClause === undefined || !(playerEv.has(q.clauses[q.playerClause].ev) || q.clauses[q.playerClause].by === BY.PLAYER)).map((q) => q.id);
  row('QU-07', 'each gift finale (C8, R8, I8, G8, X8) has a player-caused clause (TOUCH, PHOTO or by PLAYER), named by its playerClause', noPlayer.length === 0 && tagBad.length === 0, [...noPlayer, ...tagBad].join(', ') || gifts.map((q) => q.id).join(' '));
  const lifeOnly: string[] = [];
  for (const g of gifts) {
    const { st, out } = stateFor(dAll, g.idx);
    for (const r of scriptFor(dAll, DERIVED_CAPS, g.idx)) { if (r[0] === EV.TOUCH || r[0] === EV.PHOTO) continue; const x = r.slice() as Rec; x[8] = BY.SELF; apply(st, dAll, out, x); }
    for (const k of [WISH_KIND.NAP, WISH_KIND.SONG, WISH_KIND.THING, WISH_KIND.WARM]) for (let p = 0; p < 10; p++) apply(st, dAll, out, [EV.WISH, WISH_STATE.GRANTED, p, -1, 5, 255, 0, 0, BY.SELF, 0, k]);
    if (isDone(st, g.idx)) lifeOnly.push(g.id);
  }
  row('QU-07', 'a script where LIFE alone acts (every record by SELF, LIFE granting nap, song, thing and warm-up wishes in every place) completes no gift finale', lifeOnly.length === 0, lifeOnly.join(', ') || '0 of 5');
}

/* ═══════════════════════════════ QU-08: producers and the fields the reducer reads ═══════════════════════════════ */
{
  const PRODUCER: Record<number, string> = { [EV.VISIT]: 'shell place manager', [EV.BRING]: 'shell party manager', [EV.TOUCH]: 'shell drainBody', [EV.USE]: 'LIFE host, prop strikes, shell',
    [EV.REACT]: 'LIFE host (REACT_TRIGGERS)', [EV.SOCIAL]: 'LIFE host', [EV.FRIEND]: 'this reducer', [EV.WISH]: 'LIFE host, shell (SEEN)', [EV.DISCOVER]: 'this reducer', [EV.PIECES]: 'LIFE host',
    [EV.CUT]: 'shell cut.ts', [EV.WHOLE]: 'shell cut.ts', [EV.PHOTO]: 'shell Snap shutter', [EV.CAPSULE]: 'shell ceremony end', [EV.GIFT]: 'the journal claim', [EV.UI]: 'shell UI', [EV.SIGNATURE]: 'LIFE host' };
  const used = [...new Set(QUESTS.flatMap((q) => q.clauses.map((c) => c.ev)))];
  row('QU-08', 'every event kind a rule uses has a named producer (QUESTS 4)', used.every((e) => PRODUCER[e]), used.map((e) => `${Object.keys(EV).find((k) => (EV as Record<string, number>)[k] === e)}`).join(' '));
  // the fields: a REACT's thing, a PIECES count, a USE RING's part in v, flag bit 3, a photo at the shutter (PHOTO is all X8 needs)
  const t = (id: string, recs: Rec[]): boolean => { const q = qIdx(id); const { st, out } = stateFor(dAll, q); for (const r of recs) apply(st, dAll, out, r); return isDone(st, q); };
  const pine = THING_IDS.indexOf('shakepine'), chimes = THING_IDS.indexOf('shellchimes');
  const ok = t('I4', [[EV.REACT, R.SNOWCAP, 3, pine, 4, 255, 0, 1, 0, 0, 0]]) && !t('I4', [[EV.REACT, R.SNOWCAP, 3, -1, 4, 255, 0, 1, 0, 0, 0]])
    && t('C6', [[EV.PIECES, R.WARM, 1, 6, 4, 255, 0, 3, 0, 0, 0]]) && !t('C6', [[EV.PIECES, R.WARM, 1, 6, 4, 255, 0, 2, 0, 0, 0]])
    && t('R3', [0, 1, 2].map((k) => [EV.USE, USE_VERB.RING, 2, chimes, 4, 255, 0, 1, 0, 0, k] as Rec)) && !t('R3', [0, 1, 2].map(() => [EV.USE, USE_VERB.RING, 2, chimes, 4, 255, 0, 1, 0, 0, 1] as Rec))
    && t('H2', [[EV.USE, USE_VERB.ROLL, 0, 0, 4, 255, 0, 1, BY.PLAYER, EV_FLAG.AUTONOMY_OFF, 0]]) && !t('H2', [[EV.USE, USE_VERB.ROLL, 0, 0, 4, 255, 0, 1, BY.PLAYER, 0, 0]])
    && t('X8', [[EV.PHOTO, 0, 1, -1, 255, 255, 255, 3, BY.PLAYER, EV_FLAG.BEST_PAIR, 0]]);
  row('QU-08', 'the reducer reads every field a rule needs: a REACT\'s thing (I4), a PIECES count in n2 (C6), a USE RING\'s part in v (R3), flag bit 3 (H2), a PHOTO record alone (X8: the shutter, no save)', ok);
  skip('QU-08', 'the producers write those fields the same way (the shell ring writers, LIFE host events)', 'needs PG_SHELL\'s src/shell/events.ts and the LIFE host (build order step 3)');
}

/* ═══════════════════════════════ QU-09: keyboard parity (K derived from the producer table) ═══════════════════════════════ */
{
  const mismatch: string[] = [];
  for (let q = 0; q < NQ; q++) {
    const tag = QUESTS[q].keys;
    const k = hasKeys(dAll, q), star = (dAll.keyStar[q >>> 5] & (1 << (q & 31))) !== 0;
    if (!k) mismatch.push(`${QUESTS[q].id} tagged ${tag}, no route`);
    else if (tag === 'K' && star) mismatch.push(`${QUESTS[q].id} tagged K, needs the stretch`);
    else if (tag === 'K*' && !star) mismatch.push(`${QUESTS[q].id} tagged K*, has a plain route`);
  }
  row('QU-09', 'K is derived per clause from the keyboard routes (Space, the stretch, Go play with..., Tap it yourself for every switch, ball and tapped thing, Enter on a bubble, Wishes now, the Cut bar, the shutter, Travel) and matches every quest\'s tag (I4 included: the Shake Pine is tapped)',
    mismatch.length === 0, mismatch.join('; ') || `${NQ} quests, ${QUESTS.filter((q) => q.keys === 'K*').map((q) => q.id).join(' ')} K*`);
  row('QU-09', 'no route for a toss: a TOSS clause would not be K (route table self-check)', keyRoute(EV.TOUCH, TOUCH.TOSS) === 0 && keyRoute(EV.TOUCH, TOUCH.SQUEEZE) === 1 && keyRoute(EV.TOUCH, TOUCH.STRETCH) === 2);
  // the K quests (not K*) of every opened set reach every threshold
  const reach = (d: QuestDefs, pred: (q: number) => boolean): string[] => {
    const miss: string[] = [];
    for (let p = 2; p < PLACE_IDS.length; p++) {
      if (!(d.placeShipped & bit(p))) continue;
      const t = PLACE_OPENS_AT[p];   // (by place idx, round 6: a dropped place never ships, so it is skipped above)
      const avail = QUESTS.filter((q) => isShown(d, q.idx) && pred(q.idx) && (CHAPTERS[q.chapter].place < 0 ? true : PLACE_OPENS_AT[CHAPTERS[q.chapter].place] <= 0 || PLACE_OPENS_AT[CHAPTERS[q.chapter].place] < t)).length;
      if (avail < t) miss.push(`${PLACE_IDS[p]} needs ${t}, ${avail} reachable`);
    }
    return miss;
  };
  const kOnly = (q: number): boolean => hasKeys(dAll, q) && !(dAll.keyStar[q >>> 5] & (1 << (q & 31)));
  const m1 = reach(dAll, kOnly);
  row('QU-09', 'without the keyboard stretch (K quests only), the stamps of the places open before each threshold reach it (all-shipped build; Friends Everywhere counted)', m1.length === 0, m1.join('; ') || 'all 5 thresholds');
  const cs1 = QUESTS.filter((q) => isShown(dS1, q.idx) && kOnly(q.idx)).length;
  row('QU-09', 'this S1 build: K quests (not K*) shown with Home and Hearthlog reach Ripple Shore\'s 12 for when it ships', cs1 >= 12, `${cs1} K stamps`);
}

/* ═══════════════════════════════ QU-10: nothing decrements ═══════════════════════════════ */
{
  let seed = 12345;
  const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const st = createQuestState(dAll), out = createQuestOut(64);
  setQuestParty(st, [0, 1, 2, 3], [0, 1, 2, 3], 4);
  const snap = (): number[] => [...st.done, ...st.cnt, ...st.fx, ...st.pv, ...st.wm, st.sc[SC.ST], st.sc[SC.KS] >>> 0, st.sc[SC.PL], st.sc[SC.WG], st.sc[SC.SG]];
  // friendship by pair: a pair's points never fall; the only way out of the 128 rows is LIFE 6.2's eviction of a Met-only, non-best pair
  const frMap = (): Map<number, number> => { const m = new Map<number, number>(); for (let r = 0; r < st.sc[SC.FRN]; r++) m.set(st.frLo[r] * 256 + st.frHi[r], st.frPts[r]); return m; };
  let prevFr = frMap(), evicted = 0;
  const bitsSnap = (): Uint32Array => st.bits.slice();
  let prev = snap(), prevBits = bitsSnap(), down = '';
  const kinds = [EV.VISIT, EV.BRING, EV.TOUCH, EV.USE, EV.REACT, EV.SOCIAL, EV.WISH, EV.PIECES, EV.PHOTO, EV.CAPSULE, EV.UI, EV.SIGNATURE, EV.FRIEND, EV.DISCOVER, EV.GIFT];
  for (let e = 0; e < 20000 && !down; e++) {
    if (e % 1000 === 0) setQuestDay(st, 20407 + e / 1000);
    out.n = 0;
    const r: Rec = [kinds[Math.floor(rnd() * kinds.length)], Math.floor(rnd() * 25), Math.floor(rnd() * 10), Math.floor(rnd() * 64) - 1, Math.floor(rnd() * 50), Math.floor(rnd() * 50),
      Math.floor(rnd() * 12), Math.floor(rnd() * 5), rnd() < 0.5 ? 0 : 1, Math.floor(rnd() * 16), rnd() * 3];
    apply(st, dAll, out, r);
    const now = snap(), nb = bitsSnap();
    for (let i = 0; i < now.length; i++) if (now[i] < prev[i] && !(i < 4)) { down = `index ${i} ${prev[i]} -> ${now[i]} at event ${e}`; break; }
    for (let i = 0; i < 4 && !down; i++) if ((prev[i] & ~now[i]) !== 0) down = `done bit lost at ${e}`;
    for (let i = 0; i < nb.length && !down; i++) if ((prevBits[i] & ~nb[i]) !== 0) down = `clause bit lost at ${e}`;
    const fr = frMap();
    for (const [k, p] of prevFr) {
      const q = fr.get(k);
      if (q === undefined) { evicted++; const lo = k >> 8, hi = k & 255; if (p >= 12 || dAll.spFriend[lo] === hi) down = `pair ${lo}-${hi} at ${p} points evicted at ${e}`; }
      else if (q < p) down = `pair ${k >> 8}-${k & 255} ${p} -> ${q} at ${e}`;
    }
    prevFr = fr;
    prev = now; prevBits = nb;
  }
  row('QU-10', 'no path decrements: 20 000 random records (every kind, hostile fields, 20 day changes): stamps, done bits, counters and their bitsets, facts, visits, friendship, warmth, keepsakes, places, wishes granted only grow', !down,
    down || `stamps ${st.sc[SC.ST]}, friendship rows ${st.sc[SC.FRN]} (${evicted} Met-only evictions at the 128-row cap, LIFE 6.2), warmth ${Array.from(st.wm.slice(0, 4)).join('/')}`);
  // merging never lowers either
  const a = createJournal(dAll, 'abcdefgh12'), b = createJournal(dAll, 'abcdefgh12');
  for (let e = 0; e < 3000; e++) { const r: Rec = [kinds[e % 12], e % 24, e % 10, (e % 63) - 1, e % 50, (e * 7) % 50, e % 12, e % 5, e % 2, e % 16, (e % 7) / 2]; apply(e % 2 ? a.st : b.st, dAll, out, r); out.n = 0; }
  const m = mergeJournals(a, b, dAll);
  let lower = '';
  const fields: (keyof QuestState)[] = ['cnt', 'fx', 'pv', 'done'];
  for (const f of fields) { const x = m.st[f] as unknown as ArrayLike<number>, y = a.st[f] as unknown as ArrayLike<number>, z = b.st[f] as unknown as ArrayLike<number>; for (let i = 0; i < x.length; i++) if (x[i] < y[i] || x[i] < z[i]) { if (f !== 'done' || ((y[i] | z[i]) & ~x[i]) !== 0) lower = `${f}[${i}]`; } }
  row('QU-10', 'the two-tab merge never lowers a counter, a fact, a visit or a done bit (CS-13 with CO-06)', !lower && m.st.sc[SC.ST] >= Math.max(a.st.sc[SC.ST], b.st.sc[SC.ST]), lower || `stamps ${a.st.sc[SC.ST]} + ${b.st.sc[SC.ST]} -> ${m.st.sc[SC.ST]}`);
  row('QU-10', 'no main quest has a within-visit clause (the grammar has no visit field: counters are persistent)', !QUESTS.some((q) => q.clauses.some((c) => Object.keys(c).some((k) => /visit/i.test(k)))));
}

/* ═══════════════════════════════ QU-11: the regular-player stream ═══════════════════════════════ */
const tt = (id: string): number => THING_IDS.indexOf(id as typeof THING_IDS[number]);
/** QUESTS 13's first ten minutes as timed records: Dollop, the first capsule's newcomer P, a third H (minutes of play). */
function firstTen(P: number, H: number): [number, Rec][] {
  const D = sp('dollop');
  return [
    [0.4, [EV.TOUCH, TOUCH.SQUEEZE, 0, -1, D, 255, famOf(D), 1, BY.PLAYER, 0, 0.9]],
    [0.7, [EV.USE, USE_VERB.ROLL, 0, tt('feltball'), D, 255, famOf(D), 1, BY.SELF, 0, 0]],
    [1.0, [EV.TOUCH, TOUCH.STRETCH, 0, -1, D, 255, famOf(D), 1, BY.PLAYER, 0, 0.6]],
    [1.5, [EV.CAPSULE, 0, 0, -1, P, 255, famOf(P), 1, BY.PLAYER, 0, 0]],
    [1.55, [EV.BRING, 0, 0, -1, P, 255, famOf(P), 2, BY.PLAYER, 0, 0]],
    [1.6, [EV.SOCIAL, S.GREET, 0, -1, D, P, famOf(D), 2, BY.SELF, 0, 0]],
    [2.5, [EV.UI, UI_KIND.EMOTE_TAP, 0, -1, P, 255, famOf(P), 1, BY.PLAYER, 0, 0]],
    [2.5, [EV.WISH, WISH_STATE.SHOWN, 0, 1, D, 255, famOf(D), 1, BY.SELF, 0, WISH_KIND.PLACE]],
    [3.0, [EV.WISH, WISH_STATE.SEEN, 0, 1, D, 255, famOf(D), 1, BY.PLAYER, 0, WISH_KIND.PLACE]],
    [4.0, [EV.BRING, 0, 1, -1, D, 255, famOf(D), 2, BY.PLAYER, 0, 0]], [4.0, [EV.BRING, 0, 1, -1, P, 255, famOf(P), 2, BY.PLAYER, 0, 0]],
    [4.0, [EV.VISIT, 0, 1, -1, 255, 255, 255, 2, BY.PLAYER, 0, 0]],
    [4.3, [EV.REACT, R.LOVE, 1, -1, D, 255, famOf(D), 1, BY.SELF, 0, 0]],
    [6.0, [EV.REACT, R.WARM, 1, tt('hearth'), D, 255, famOf(D), 1, BY.SELF, 0, 0]], [6.2, [EV.REACT, R.WARM, 1, tt('hearth'), P, 255, famOf(P), 1, BY.SELF, 0, 0]],
    [6.5, [EV.USE, USE_VERB.ROLL, 1, tt('yarnball'), D, 255, famOf(D), 1, BY.SELF, 0, 0]], [6.7, [EV.USE, USE_VERB.ROLL, 1, tt('yarnball'), P, 255, famOf(P), 1, BY.SELF, 0, 0]],
    [7.5, [EV.USE, USE_VERB.LISTEN, 1, tt('kettle'), P, 255, famOf(P), 1, BY.SELF, 0, 0]],
    [8.2, [EV.SOCIAL, S.TEETER, 1, tt('rockerboard'), D, P, famOf(D), 2, BY.SELF, 0, 0]],
    [9.0, [EV.CAPSULE, 0, 1, -1, H, 255, famOf(H), 1, BY.PLAYER, 0, 0]],
    [9.5, [EV.SOCIAL, S.PILE, 1, tt('snugbasket'), H, P, famOf(H), 2, BY.SELF, 0, 0]],
  ];
}
{
  // QUESTS 13's first ten minutes as a timed record stream (a new player; Dollop, then the first capsule's newcomer Puddlo, then a third, Thumbly)
  const st = createQuestState(dS1), out = createQuestOut(256);
  setQuestDay(st, 20407);
  const script = firstTen(sp('puddlo'), sp('thumbly'));
  const at: string[] = [];
  let hearth = -1, h8 = -1;
  for (const [min, r] of script) {
    out.n = 0; apply(st, dS1, out, r);
    for (let k = 0; k < out.n; k++) if (out.kind[k] === QOUT.QUEST) at.push(`${QUESTS[out.a[k]].id}@${min}`);
    if (hearth < 0 && placeOpen(st, 1)) hearth = min;
    if (h8 < 0 && isDone(st, qIdx('H8'))) h8 = min;
  }
  const n10 = st.sc[SC.ST];
  // QUESTS 13: about 10 stamps in 10 minutes; Hearthlog opens at about 2:30 to 5:00; the Home finale on arrival, about 3:30 to 5:30 (+-50%)
  row('QU-11', 'the first ten minutes of QUESTS 13 as a timed stream (S1 part): about 10 stamps in 10 minutes (+-50%), Hearthlog open at 2:30-5:00 and H8 at 3:30-5:30 (+-50%), every stamp the table names',
    n10 >= 5 && n10 <= 15 && hearth >= 1.25 && hearth <= 7.5 && h8 >= 1.75 && h8 <= 8.25 && ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'C1', 'C10', 'C2', 'C4', 'C7', 'C5'].every((id) => at.some((x) => x.startsWith(id + '@'))),
    `${n10} stamps: ${at.join(' ')}; Hearthlog open at ${hearth} min, H8 at ${h8} min`);
}
{
  // QU-11's multi-day half for an S2 build (Home, Hearthlog, Ripple, Frostbell, Rainleaf shipped). The player: QUESTS 13's first ten minutes
  // (newcomer Thumbly, third Munchip: neither is a best friend of the other or of Dollop), then at the start of the session after a place
  // opens, a trip there (0.5 min and a VISIT) once the chapter in hand has its finale or nothing left to do; otherwise the tracker's choice at the place they are in,
  // else a finale or another open quest there, else travel (0.5 min and a VISIT) to the newest open place with work left. PACE (an assumption
  // taken from QUESTS 7, not a measurement): a main quest about every 3.5 min of play, a finale 5, a VISIT 0.5, a "who loves it" find 2; an
  // active day is 25 min (day 1 in two sessions of 12.5). Each quest's records are QU-02's minimal script, all at open places. Gifts: claimed at
  // once, one a day (the collection's rule): Hearthlog's Puddlo and Ripple's Boingle (QUESTS 6.10), then each list's first. X3 is the GREET of
  // that gift pair. Gate row: the order, the stamp counts, no stall, X3 by the pair. Reported (QU-11 is a "reported" row): the times against
  // QUESTS 7, +-50% (Ripple in day 1's second session, est. 18.75 min; Frostbell day 2, 37.5; Rainleaf day 3, 62.5; Friends Everywhere the
  // second session, 18.75).
  const SHIP2 = PLACE_INFO.map((_, i) => i <= 4);
  const d2 = defsFor(SHIP2);
  const st = createQuestState(d2), out = createQuestOut(256);
  const DAY0 = 20407, DAYLEN = 25;
  let t = 0, cur = 0, stalls = 0, lastClaim = -1;
  setQuestDay(st, DAY0);
  const opened: number[] = PLACE_IDS.map(() => -1), stampsAt: number[] = PLACE_IDS.map(() => -1), events: string[] = [];
  let fe = -1, x3 = -1, x3pair = '';
  const owned = new Set<number>([sp('dollop')]);
  const feed = (r: Rec, min: number): void => {
    out.n = 0; apply(st, d2, out, r);
    for (let k = 0; k < out.n; k++) {
      if (out.kind[k] === QOUT.QUEST) { const id = QUESTS[out.a[k]].id; if (id === 'X3' && x3 < 0) { x3 = min; x3pair = `${CATALOG[r[4]]?.id}+${CATALOG[r[5]]?.id}`; } if (QUESTS[out.a[k]].kind === 'finale') events.push(`${id}@${min.toFixed(1)}`); }
      if (out.kind[k] === QOUT.UNLOCK) { if (out.a[k] === UNLOCK_FRIENDS) { if (fe < 0) fe = min; } else if (out.a[k] < opened.length && opened[out.a[k]] < 0) { opened[out.a[k]] = min; stampsAt[out.a[k]] = st.sc[SC.ST]; } }
    }
    for (let p = 0; p < PLACE_IDS.length; p++) if (opened[p] < 0 && placeOpen(st, p)) { opened[p] = min; stampsAt[p] = st.sc[SC.ST]; }
    if (fe < 0 && chapterOpen(st, CHAPTERS.length - 1)) fe = min;
  };
  const GIFT_PICK: Record<number, string> = { 1: 'puddlo', 2: 'boingle' };
  const claimGifts = (): void => {
    const today = DAY0 + Math.floor(t / DAYLEN);
    for (let ch = 1; ch < CHAPTERS.length; ch++) {
      if (lastClaim === today || !giftReady(st, ch)) continue;
      const s0 = sp(GIFT_PICK[ch] ?? GIFT_LISTS[ch][0]);
      setGiftState(st, ch, 2, s0, today); lastClaim = today; owned.add(s0);
      feed([EV.GIFT, 0, cur, -1, s0, 255, famOf(s0), 1, BY.PLAYER, 0, 0], t);
      events.push(`gift:${CATALOG[s0].id}@${t.toFixed(1)}`);
    }
  };
  for (const [min, r] of firstTen(sp('thumbly'), sp('munchip'))) { t = min; cur = r[2]; feed(r, t); if (r[0] === EV.CAPSULE) owned.add(r[4]); }
  t = 10; claimGifts();
  const PUD = sp('puddlo'), BOI = sp('boingle'), X3 = qIdx('X3');
  const recsOf = (q: number): Rec[] => q === X3 ? [[EV.SOCIAL, S.GREET, cur, -1, PUD, BOI, famOf(PUD), 2, BY.SELF, EV_FLAG.BEST_PAIR, 0]] : scriptFor(d2, PLACE_CAPS, q);
  const ready = (q: number): boolean => {
    if (!isShown(d2, q) || isDone(st, q) || !questOpen(st, d2, q)) return false;
    if (q === X3) return owned.has(PUD) && owned.has(BOI);
    const recs = recsOf(q);
    return recs.length > 0 && recs.every((r) => r[2] === 0 || placeOpen(st, r[2]));
  };
  const costOf = (q: number): number => (QUESTS[q].kind === 'finale' ? 5 : d2.cEv[d2.qFirst[q]] === EV.VISIT ? 0.5 : d2.cEv[d2.qFirst[q]] === EV.DISCOVER ? 2 : 3.5);
  const order: string[] = [];
  const sessionOf = (m: number): number => (m < DAYLEN ? (m < DAYLEN / 2 ? 0 : 1) : 1 + Math.floor(m / DAYLEN));
  let visitedNewest = 1;
  while (t < 4 * DAYLEN) {
    setQuestDay(st, DAY0 + Math.floor(t / DAYLEN));
    // a newly opened place: the player goes there at the start of the next session (the Places button shows it; nothing pushes)
    let newest = -1;
    for (let p = PLACE_IDS.length - 1; p > visitedNewest && newest < 0; p--) if (opened[p] >= 0 && sessionOf(t) > sessionOf(opened[p])) newest = p;
    const chCur = CHAPTERS.findIndex((c) => c.place === cur);
    if (newest >= 0 && chCur >= 0 && !isDone(st, CHAPTERS[chCur].finale) && QUESTS.some((qq, j) => qq.chapter === chCur && ready(j))) newest = -1;
    if (newest >= 0) { visitedNewest = newest; if (cur !== newest) { cur = newest; t += 0.5; feed([EV.VISIT, 0, cur, -1, 255, 255, 255, 2, BY.PLAYER, 0, 0], t); order.push(`>${PLACE_IDS[cur]}@${t.toFixed(1)}`); claimGifts(); continue; } }
    let q = trackerQuest(st, d2, cur, false, true);
    if (q >= 0 && !ready(q)) q = -1;
    if (q < 0) for (let j = 0; j < NQ && q < 0; j++) if (ready(j) && doableAt(d2, j, cur)) q = j;
    if (q < 0) {
      // travel to the newest open place with work left
      let to = -1;
      for (let p = PLACE_IDS.length - 1; p >= 0 && to < 0; p--) if (p !== cur && (p === 0 || placeOpen(st, p))) for (let j = 0; j < NQ; j++) if (ready(j) && doableAt(d2, j, p)) { to = p; break; }
      if (to < 0) { stalls++; t += 3.5; claimGifts(); continue; }
      cur = to; t += 0.5; order.push(`>${PLACE_IDS[cur]}@${t.toFixed(1)}`);
      feed([EV.VISIT, 0, cur, -1, 255, 255, 255, 2, BY.PLAYER, 0, 0], t);
      claimGifts();
      continue;
    }
    t += costOf(q);
    order.push(`${QUESTS[q].id}@${t.toFixed(1)}`);
    for (const r of recsOf(q)) { if (r[2] !== cur && r[2] !== 0 && placeOpen(st, r[2])) { cur = r[2]; } feed(r, t); }
    claimGifts();
  }
  const within = (v: number, est: number): boolean => v >= est * 0.5 && v <= est * 1.5;
  const rip = opened[2], fro = opened[3], rain = opened[4];
  const boiAt = events.find((e) => e.startsWith('gift:boingle')), pudAt = events.find((e) => e.startsWith('gift:puddlo'));
  const after = (e: string | undefined): number => (e ? Number(e.split('@')[1]) : Infinity);
  const inOrder = rip >= 0 && fro > rip && rain > fro && stampsAt[2] >= 12 && stampsAt[3] >= 20 && stampsAt[4] >= 28 && stampsAt[2] < 14 && stampsAt[3] < 22 && stampsAt[4] < 30;
  // the hard part of the stream (a gate): every S2 place opens within four active days, in order, at its stamp count; no stall; X3 by the gift pair
  // (re-specified in round 6 for D-96: the first S3 place is now Lanternroof (idx 7, 36 stamps), was the dropped Fizzwell Tub (idx 5, 36 stamps))
  row('QU-11', 'the multi-day stream, S2 build: Ripple, Frostbell and Rainleaf open in order at 12, 20 and 28 stamps within four active days; Lanternroof (S3) stays shut; the player never runs out of open work; X3 completes by the gift pair Puddlo and Boingle after both are claimed',
    inOrder && !placeOpen(st, 7) && !placeOpen(st, 5) && stalls === 0 && x3 >= after(boiAt) && x3pair === 'puddlo+boingle',
    `stamps at opening ${stampsAt[2]} / ${stampsAt[3]} / ${stampsAt[4]}; ${st.sc[SC.ST]} stamps at ${t.toFixed(1)} min (Lanternroof needs 36); stalls ${stalls}; X3 at ${x3.toFixed(1)} min (${x3pair}); ${pudAt ?? 'no Puddlo'} ${boiAt ?? 'no Boingle'}`);
  // QU-11 is a REPORTED row (PLAYGROUND_BUILD 18): the times against QUESTS 7's estimates, +-50%, at the pace assumed above
  const rep = (name: string, v: number, est: number, when: string): string => `${name} ${v.toFixed(1)} min (QUESTS 7: ${when}, est. ${est} -> ${within(v, est) ? 'within' : 'OUTSIDE'} +-50%)`;
  info('QU-11', `reported, S2 stream vs QUESTS 7: ${rep('Ripple', rip, 18.75, "day 1's second session")}; ${rep('Frostbell', fro, 37.5, 'about day 2')}; ${rep('Rainleaf', rain, 62.5, 'about day 3')}; ${rep('Friends Everywhere', fe, 18.75, 'the second session')}; finales and gifts ${events.join(' ')}`);
  info('QU-11', `S2 stream order: ${order.join(' ')}`);
}

/* ═══════════════════════════════ QU-12: wish caps ═══════════════════════════════ */
{
  const st = createQuestState(dS1), out = createQuestOut(64);
  setQuestDay(st, 100);
  const show = (s: number): number => applyEventFields(st, dS1, out, EV.WISH, WISH_STATE.SHOWN, 0, 2, s, 255, 0, 0, 0, 0, WISH_KIND.PLACE);
  show(10); show(11); show(12); show(13);
  const kept = (): number[] => Array.from(st.wiSp.subarray(0, st.sc[SC.WIN]));
  const a1 = kept().join();
  show(11);
  const a2 = kept().join();
  applyEventFields(st, dS1, out, EV.WISH, WISH_STATE.GRANTED, 1, -1, 13, 255, 0, 0, BY.PLAYER, 0, WISH_KIND.PLACE);
  const a3 = kept().join();
  row('QU-12', 'the Journal keeps at most 3 wishes, one per squishy: a 4th replaces the oldest quietly, a re-shown wish moves to the newest, a granted one leaves', a1 === '11,12,13' && a2 === '12,13,11' && a3 === '12,11', `${a1} | ${a2} | ${a3}`);
  const j1 = createJournal(dS1, 'abcdefgh12'), j2 = createJournal(dS1, 'abcdefgh12');
  setQuestDay(j1.st, 100); setQuestDay(j2.st, 101);
  for (const s of [1, 2]) applyEventFields(j1.st, dS1, out, EV.WISH, WISH_STATE.SHOWN, 0, 2, s, 255, 0, 0, 0, 0, 1);
  for (const s of [3, 4]) applyEventFields(j2.st, dS1, out, EV.WISH, WISH_STATE.SHOWN, 0, 2, s, 255, 0, 0, 0, 0, 1);
  const m = mergeJournals(j1, j2, dS1);
  row('QU-12', 'two tabs: the store keeps the newest 3 of the union', Array.from(m.st.wiSp.subarray(0, m.st.sc[SC.WIN])).join() === '2,3,4', Array.from(m.st.wiSp.subarray(0, m.st.sc[SC.WIN])).join());
}

/* ═══════════════════════════════ QU-13 ═══════════════════════════════ */
skip('QU-13', 'every quest of a shipped chapter completes from a scripted run of the real lifeStep and the host\'s ring writes', 'needs PG_LIFE\'s lifeStep and PG_SHELL\'s LIFE host (build order step 3)');

/* ═══════════════════════════════ QU-14: shown quests against the shipped set ═══════════════════════════════ */
{
  const capDiff = PLACE_IDS.map((id, p) => { const a = PLACE_CAPS[p], b = DERIVED_CAPS[p]; return a.reacts === b.reacts && a.socials === b.socials && a.verbs === b.verbs ? '' : `${id} table r${a.reacts} s${a.socials} v${a.verbs} vs derived r${b.reacts} s${b.socials} v${b.verbs}`; }).filter(Boolean);
  row('QU-14', 'journal.ts PLACE_CAPS equals the caps recomputed from every PlaceDef (LIFE 4.2\'s triggers, LIFE 6.1\'s moments, the things\' verbs)', capDiff.length === 0, capDiff.join('; ') || `${PLACE_IDS.length} places`);
  const tp: string[] = [];
  for (const def of DEFS) if (def) for (const t of def.things) if (THING_PLACE[THING_IDS.indexOf(t.id)] !== def.idx) tp.push(`${t.id}`);
  row('QU-14', 'journal.ts THING_PLACE matches every ThingDef.place', tp.length === 0 && THING_PLACE.length === THING_IDS.length, tp.join(', ') || `${THING_IDS.length} things`);
  const shown = QUESTS.filter((q) => isShown(dS1, q.idx)).map((q) => q.id);
  // (RE-SPECIFIED in round 7, R7_LIFE: the row said "this S1 build shows exactly Home's 10, Hearthlog's 10 and Friends Everywhere's X1, X2, X3, X6 and X10
  // (its finale X8 waits: 4 shown mains)". Ripple Shore, Frostbell Ridge and Rainleaf Garden ship from round 7 (the orchestrator's brief), so the shown set is
  // checked for the places that SHIP (PLACE_INFO): every quest of each shipped place's chapter, and Friends Everywhere's: X1, X2, X3, X6, X10 with Home and
  // Hearthlog alone (X4 sings in 3 places, X5 visits 3 away places, X7 needs water, cold and warmth, X9 piles in 3 places: none there; X8 waits), all ten
  // once three more places ship. A shipped set this table does not know fails the row with the set named.)
  const chap = (letter: string): string[] => Array.from({ length: 10 }, (_, k) => `${letter}${k + 1}`);
  const shipIds = PLACE_INFO.filter((p) => p.shipped).map((p) => p.id).join(' ');
  const WANT: Record<string, string[]> = {
    'home hearthlog': [...chap('H'), ...chap('C'), 'X1', 'X2', 'X3', 'X6', 'X10'],
    'home hearthlog ripple frostbell rainleaf': [...chap('H'), ...chap('C'), ...chap('R'), ...chap('I'), ...chap('G'), ...chap('X')],
  };
  const want = WANT[shipIds] ?? [];
  row('QU-14', `this build (shipped: ${shipIds}) shows exactly the shipped places' chapters and Friends Everywhere's quests their places can complete`, want.length > 0 && shown.join() === want.join(), shown.join(' '));
  // every shown quest completes with only shipped places in its script
  const bad: string[] = [];
  for (const id of shown) {
    const q = qIdx(id); const sc = scriptFor(dS1, PLACE_CAPS, q); const { st, out } = stateFor(dS1, q);
    if (sc.some((r) => r[0] !== EV.DISCOVER && r[2] !== 255 && !(dS1.placeShipped & bit(r[2])))) { bad.push(`${id} (unshipped place)`); continue; }
    for (const r of sc) apply(st, dS1, out, r);
    if (!isDone(st, q)) bad.push(id);
  }
  row('QU-14', 'every shown quest of this build completes from a script that uses only shipped places and their things', bad.length === 0, bad.join(', ') || `${shown.length} quests`);
  // the tracker never shows a hidden quest, and a finale's hidden-ness holds against its own events
  const st = createQuestState(dS1), out = createQuestOut(256);
  st.sc[SC.FW] = 1; st.sc[SC.PL] = 3;
  for (const id of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']) markDone(st, dS1, qIdx(id), out);
  const seen = new Set<number>();
  for (let pass = 0; pass < 30; pass++) {
    for (const place of [0, 1]) for (const key of [false, true]) for (const auto of [true, false]) { const q = trackerQuest(st, dS1, place, key, auto); if (q >= 0) seen.add(q); }
    const q = trackerQuest(st, dS1, 0, false, true); if (q >= 0) markDone(st, dS1, q, out);
  }
  const hiddenSeen = [...seen].filter((q) => !isShown(dS1, q)).map((q) => QUESTS[q].id);
  // (RE-SPECIFIED in round 7, R7_LIFE: the hidden quest whose own events must not complete it was X8, hidden in the S1 build; with Ripple, Frostbell and
  // Rainleaf shipped X8 is shown, so the row takes this build's first hidden quest with a script: X8 in the S1 build, a quest of an unshipped place's
  // chapter (Lanternroof's) once the three ship; the tracker half is unchanged)
  const hid = isShown(dS1, qIdx('X8')) ? QUESTS.find((q) => !isShown(dS1, q.idx) && !q.dropped && scriptFor(dAll, DERIVED_CAPS, q.idx).length > 0)?.idx ?? -1 : qIdx('X8');
  const s8 = hid >= 0 ? stateFor(dS1, hid) : null;
  if (s8) for (const r of scriptFor(dAll, DERIVED_CAPS, hid)) apply(s8.st, dS1, s8.out, r);
  row('QU-14', `the tracker never shows a hidden quest (30 passes over both places, key and pointer, autonomy on and off), and hidden ${hid >= 0 ? QUESTS[hid].id : '(none)'} does not complete from its own events`, hiddenSeen.length === 0 && !!s8 && !isDone(s8.st, hid) && seen.size > 0,
    hiddenSeen.join(', ') || `${seen.size} quests offered: ${[...seen].map((q) => QUESTS[q].id).join(' ')}`);
}

/* ═══ QU-14 (round 6, D-96): the dropped places' 30 tombstone quests are never shown and never done, in any build ═══ */
{
  const tomb = QUESTS.filter((q) => q.dropped).map((q) => q.idx), p: string[] = [];
  if (tomb.length !== 30 || tomb.some((q) => !((q >= 50 && q < 70) || (q >= 80 && q < 90)))) p.push(`tombstones ${tomb.length}: ${tomb.join(' ')}`);
  for (const d of [dAll, dS1]) {
    if (d.placeShipped & ((1 << 5) | (1 << 6) | (1 << 8))) p.push('a dropped place ships');
    for (const q of tomb) if (isShown(d, q)) p.push(`${QUESTS[q].id} shown`);
  }
  // the busiest state there is: every place bit set (dropped ones too), the first wish shown, then every kept quest's script and 2 finales
  const st = createQuestState(dAll), out = createQuestOut(1024); st.sc[SC.FW] = 1; st.sc[SC.PL] = 0xffff;
  for (const q of KEPT_Q) for (const r of scriptFor(dAll, DERIVED_CAPS, q)) { out.n = 0; apply(st, dAll, out, r); }
  for (const q of tomb) { markDone(st, dAll, q, out); if (isDone(st, q)) p.push(`${QUESTS[q].id} done`); }
  for (const ch of [5, 6, 8]) if (chapterOpen(st, ch)) p.push(`chapter ${ch} open`);
  if (st.sc[SC.KS] & ((1 << 5) | (1 << 6) | (1 << 8))) p.push('a retired keepsake bit set');
  row('QU-14', '(round 6, D-96) the 30 tombstone quests of the dropped places are shown in no build (all-shipped included), never done (every kept script played, markDone tried), their chapters never open, their keepsake bits never set',
    p.length === 0, p.join(', ') || `${tomb.length} tombstones; ${st.sc[SC.ST]} stamps from the kept scripts`);
}

/* ═══════════════════════════════ the tracker's order (SH-20's rule, the reducer half) ═══════════════════════════════ */
{
  const st = createQuestState(dS1), out = createQuestOut(256);
  const T = (place: number, key = false, auto = true): string => { const q = trackerQuest(st, dS1, place, key, auto); return q < 0 ? '-' : QUESTS[q].id; };
  const seq: string[] = [T(0)];
  markDone(st, dS1, qIdx('H1'), out); seq.push(T(0));
  applyEventFields(st, dS1, out, EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE);
  seq.push(T(1));                                              // at the cabin: its own chapter first
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']) markDone(st, dS1, qIdx(id), out);
  seq.push(T(1));                                              // the cabin's mains done: Home's next doable here (H2 'at Home' is skipped: H3)
  for (const id of ['H2', 'H3', 'H4', 'H5', 'H6', 'H7']) markDone(st, dS1, qIdx(id), out);
  seq.push(T(1), T(0));
  row('SH-20 (reducer)', 'the tracker: Home first at Home (H1, then H2), the cabin\'s own chapter at the cabin (C1), then Home\'s quests doable there (never the rug\'s H10 at the cabin), never a finale or a bonus',
    seq.join(' ') === 'H1 H2 C1 H3 - -', seq.join(' '));
}

/* ═══════════════════════════════ QU-15: the first wish without Dollop ═══════════════════════════════ */
{
  const runCase = (wisher: number, party: number[]): { open: boolean; h8: boolean; c1: boolean; stamps: number; wg: number; facts: number } => {
    const st = createQuestState(dS1), out = createQuestOut(256);
    setQuestDay(st, 20407);
    setQuestParty(st, party.map((_, i) => i), party, party.length);
    applyEventFields(st, dS1, out, EV.WISH, WISH_STATE.SHOWN, 0, 1, wisher, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE);
    const open = placeOpen(st, 1) && chapterOpen(st, 1) && finaleOpen(st, dS1, 0);
    const before = st.sc[SC.ST];
    for (const s of party) applyEventFields(st, dS1, out, EV.BRING, 0, 1, -1, s, 255, famOf(s), party.length, BY.PLAYER, 0, 0);
    applyEventFields(st, dS1, out, EV.VISIT, 0, 1, -1, 255, 255, 255, party.length, BY.PLAYER, 0, 0);
    // LIFE's own record of the same grant in the same visit is not counted twice
    if (wisher !== 255) applyEventFields(st, dS1, out, EV.WISH, WISH_STATE.GRANTED, 1, -1, wisher, 255, 0, 0, BY.PLAYER, 0, WISH_KIND.PLACE);
    return { open, h8: isDone(st, qIdx('H8')), c1: isDone(st, qIdx('C1')), stamps: st.sc[SC.ST] - before, wg: st.sc[SC.WG], facts: wisher < 64 ? st.fx[wisher] : 0 };
  };
  const a = runCase(sp('puddlo'), [sp('puddlo'), sp('crumbit')]);               // no Dollop owned: the party member out longest wishes
  const b = runCase(sp('crumbit'), [sp('crumbit')]);                             // Dollop on the shelf, the trip with someone else
  const c = runCase(255, [sp('swishel')]);                                       // nobody could show it by 5:00: it rested in the Journal
  const ok = [a, b, c].every((r) => r.open && r.h8 && r.c1 && r.stamps === 2 && r.wg === 1);
  row('QU-15', 'the first wish with no Dollop owned, with Dollop on the shelf, and resting in the Journal at 5:00: Hearthlog and Home\'s finale open when it shows; the first arrival at Hearthlog with any party completes H8 (and C1), exactly once',
    ok && (a.facts & (1 << FACT.WISH)) !== 0, JSON.stringify([a, b, c]));
}

/* ═══════════════════════════════ QU-16: autonomy off ═══════════════════════════════ */
{
  const selfClauses = QUESTS.filter((q) => q.clauses.some((c) => c.by === BY.SELF)).map((q) => q.id);
  const flagged: string[] = [], plain: string[] = [];
  for (const id of selfClauses) {
    const q = qIdx(id); const sc = scriptFor(dAll, DERIVED_CAPS, q);
    const s1 = stateFor(dAll, q), s2 = stateFor(dAll, q);
    for (const r of sc) { const x = r.slice() as Rec; x[8] = BY.PLAYER; const y = x.slice() as Rec; x[9] |= EV_FLAG.AUTONOMY_OFF; apply(s1.st, dAll, s1.out, x); apply(s2.st, dAll, s2.out, y); }
    if (!isDone(s1.st, q)) flagged.push(id);
    if (isDone(s2.st, q) && sc.every((r) => r[0] === EV.USE)) plain.push(id);
  }
  row('QU-16', 'a by-SELF clause accepts a by-PLAYER record with flag bit 3 ("Go play with..." while autonomy is off) and refuses one without it', flagged.length === 0 && plain.length === 0,
    `${selfClauses.join(' ')}${flagged.length ? ' | not accepted: ' + flagged.join(' ') : ''}${plain.length ? ' | accepted without the flag: ' + plain.join(' ') : ''}`);
  const blocked = QUESTS.filter((q) => needsAutonomy(dAll, q.idx)).map((q) => q.id);
  const st = createQuestState(dAll);
  const shows = blocked.every((id) => blockedByAutonomy(st, dAll, qIdx(id), false) && !blockedByAutonomy(st, dAll, qIdx(id), true));
  row('QU-16', 'a quest whose moments need a squishy to move on its own reports "Needs: Squishies move on their own" (blockedByAutonomy) only while autonomy is off', shows && blocked.length > 0, blocked.join(' '));
  // thresholds reachable with autonomy off (blocked quests excluded; a finale counts when its 5 mains can be done)
  const miss: string[] = [];
  for (let p = 2; p < PLACE_IDS.length; p++) {
    if (placeDropped(p)) continue;   // (round 6, D-96: a dropped place has no threshold; its tombstones count for nothing)
    const t = PLACE_OPENS_AT[p];
    const avail = QUESTS.filter((q) => !q.dropped && !needsAutonomy(dAll, q.idx) && (CHAPTERS[q.chapter].place < 0 || [0, 1].includes(CHAPTERS[q.chapter].place) || PLACE_OPENS_AT[CHAPTERS[q.chapter].place] < t)).length;
    if (avail < t) miss.push(`${PLACE_IDS[p]} ${avail}/${t}`);
  }
  row('QU-16', 'with autonomy off every opening threshold is reachable (stamps of the places open before it, blocked quests left out)', miss.length === 0, miss.join(' ') || 'all 5');
  const s1 = QUESTS.filter((q) => isShown(dS1, q.idx) && !needsAutonomy(dS1, q.idx)).length;
  row('QU-16', 'this S1 build with autonomy off: the shown, unblocked stamps reach Ripple Shore\'s 12 for when it ships', s1 >= 12, `${s1} stamps`);
}

console.log(`\n${bad === 0 ? 'all run checks passed' : `${bad} FAILED`}; ${notRun} NOT RUN (other lanes' code not there yet)`);
void FRIEND_LEVEL; void UI_KIND; void UNLOCK_FRIENDS; void serializeJournal;
process.exit(bad ? 1 : 0);

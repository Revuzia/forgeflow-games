// THE PARTY CUTTER (D-103, owner 2026-11-23: "allow ability to cut multiple squishies at the same time - now i can only cut 1 squishy at a time before being told to
// recombine to be able to cut another"). Part of the life chunk (later-life.ts imports it): no first-play bytes.
//
//   * ONE CUTTER PER CUT SQUISHY. shell/cut.ts's cutter is one set of pieces of one squishy (one cut tree, one animation, one parting, one touch-to-join contact) and stays
//     that. The play squishy's cutter is the one game.ts builds (`base`): with one squishy out every call here goes straight to it, so the published cut is untouched. For
//     every OTHER squishy out that a stroke crosses, this file makes one more cutter with the same createCutter, over a MEMBER VIEW of the body manager (memberBodies):
//     `body` = that squishy's anchor piece, `identity` = its own genome, tier and item id, `promote` / `swapTo` re-point that squishy's own extra record.
//   * WHO OWNS A PIECE. The anchor piece of a cut party member is the extra that carries its item id and no `piece` flag (so the mat, the Friends strip and the quick
//     switcher still count the squishy as out); its other pieces are extras with `piece: true` and `of` = that item id. A cutter only reads its own piece list, so pieces
//     of different squishies can never join; all of them are bodies in one world space, so they push, squish, carry and toss like any body.
//   * THE PLAY SQUISHY STAYS WHO IT WAS: cutting does not change who you play with (D-99's exchange at the stroke is gone; it existed because there was one tree).
//   * A STROKE is offered to every squishy it crosses on screen (somewhere along it a body of that squishy is the nearest one under the line; a squishy wholly hidden behind
//     another is not crossed), the play squishy first, then mat order; each cutter cuts the piece of ITS squishy the stroke passes over most. Split in
//     two (the keyboard's cut) halves the biggest piece out (a whole counts 1; ties: the play squishy, then mat order).
//   * THE BUDGET is the party's: at most PARTY_PIECES live pieces across all cut squishies while two or more are out (and never more than LIFE's character slots hold).
//     Each cutter's own cap is what the others leave (pieces that a playing cut is about to make count from the stroke on), so a stroke that would pass the budget cuts
//     what fits; the cutter that is refused says the party's line, which the Cut bar also SHOWS (cutText.isShown). One squishy out: the published ceiling (64) alone.
//   * EACH AT ITS OWN SPOT: a squishy goes back together where it stood when it was first cut (with a party out; one squishy out: the middle, as published).
//   * LEAVING: reconnectAll(false) reconnects every set at once. A party member that leaves the mat while it is cut takes its pieces with it (the sweep in update).
import type { SoftBodyLike, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { getSpecies } from '../data/catalog.ts';
import type { CameraLike } from '../input/camera.ts';
import { cameraRay, pxToNdc, raycastAt } from '../input/camera.ts';
import type { BodyManager, ExtraBody, PlayIdentity } from './bodies.ts';
import type { CutDeps, Cutter, CutResult, CutSetRow } from './cut.ts';
import { createCutter, MIN_SWIPE_PX } from './cut.ts';
import * as T from './cutText.ts';
import type { Game } from './game.ts';

/** THE PARTY'S PIECE BUDGET (D-103): the most live pieces across every cut squishy while two or more squishies are out, at every quality tier (the physics is the same at
 *  every tier, D-101). Derived from the cost per piece measured at the low tier (_handoff/reports/R14_MULTICUT.md, "Budget"): three squishies each in four pieces. */
export const PARTY_PIECES = 12;
/** LIFE's character slots (later-life.ts CAP): every squishy out holds one (a cut one keeps its slot as its pieces' group key) and every piece one */
export const LIFE_SLOTS = 16;
/** a set that is whole and idle is kept this long after its last stroke (its refusal's tremble ends in the cutter's update) */
const KEEP_S = 0.6;

export interface PartyCutHooks {
  /** the LIFE host's room for a first cut (later-life beforeCut: every untouched whole sleeps); how many squishies went back to the shelf (always 0) */
  beforeCut?(): number;
}

/** the party cutter: a Cutter, plus what the harness reads */
export interface PartyCutter extends Cutter {
  readonly sets: readonly CutSetRow[];
  readonly budget: number | null;
}

interface MemberSet {
  key: string;
  cutter: Cutter;
  view: BodyManager;
  /** where it goes back together (where it stood when it was first cut) */
  home: V3;
  row: CutSetRow;
  /** its row showed it cut or busy last step: one more row (pieces 1) follows, so a reader that counts per squishy sees it whole again */
  wasCut: boolean;
  keepUntil: number;
}

const ORIGIN: V3 = { x: 0, y: 0, z: 0 };
const RANK: Readonly<Record<CutResult, number>> = { cut: 7, limit: 6, thin: 5, loose: 4, busy: 3, miss: 2, short: 1, unsupported: 0 };
const better = (a: CutResult, b: CutResult): CutResult => (RANK[b] > RANK[a] ? b : a);

/** A party member's view of the body manager: the cutter of ONE squishy out (not the play squishy) works on it exactly as the play squishy's cutter works on the real one.
 *  The member is the extra that carries `key` (its item id) and no `piece` flag; while it is cut that record is its anchor piece. */
function memberBodies(base: BodyManager, key: string, first: ExtraBody, d: CutDeps): BodyManager {
  let anchor: SoftBodyLike = first.body;
  const identity: PlayIdentity = { genome: first.genome, tier: first.tier, itemId: key, nickname: null };
  const rec = (): ExtraBody | null => { const xs = base.extras; for (let i = 0; i < xs.length; i++) if (xs[i].itemId === key && !xs[i].piece) return xs[i]; return null; };
  return {
    get body() { const r = rec(); if (r) anchor = r.body; return anchor; },
    get identity() { return identity; },
    get extras() { return base.extras; },
    build: (g) => base.build(g),
    /** the squishy in another body (whole again, at its own spot): its record is replaced */
    swapTo(genome, opts = {}) {
      try {
        const b = opts.body ?? base.build(genome), old = rec();
        try { b.gravity = d.gravity(); } catch { /* optional */ }
        if (base.addExtra(b, genome, { tier: identity.tier, itemId: key, shared: true }) < 0) return false;
        if (old) base.removeExtra(old.id);
        anchor = b;
        return true;
      } catch (e) { d.report(e); return false; }
    },
    adopt() { /* a ceremony's body is the play squishy's, never a member's */ },
    addExtra: (b, g, o = {}) => base.addExtra(b, g, { ...o, of: key }),
    removeExtra: (id) => base.removeExtra(id),
    placeExtras: (p) => base.placeExtras(p),
    /** a piece becomes the member's anchor: it takes the item id (the record of the body it replaces leaves) */
    promote(b) {
      const xs = base.extras;
      let x: ExtraBody | null = null;
      for (let i = 0; i < xs.length; i++) if (xs[i].body === b) { x = xs[i]; break; }
      if (!x) return false;
      const old = rec();
      x.itemId = key; x.piece = false;
      if (old && old !== x) base.removeExtra(old.id);
      anchor = b;
      return true;
    },
    viewIdOf: (b) => base.viewIdOf(b),
    get contactBodies() { return base.contactBodies; },
    get contactStats() { return base.contactStats; },
    setGhost: (b, on) => base.setGhost(b, on),
    step: (dt) => base.step(dt),
  };
}

export function createPartyCutter(game: Game, base: Cutter, deps: CutDeps, hooks: PartyCutHooks = {}): PartyCutter {
  const bodies = game.bodies;
  /** the play squishy's own deps as game.ts made them (the members' cutters start from these; the play squishy's object gets the party's members below) */
  const d0: CutDeps = { ...deps };
  const say0 = d0.say;
  const members: MemberSet[] = [];
  const rows: CutSetRow[] = [{ key: '', play: true, name: '', species: '', pieces: 1, busy: false }];
  /** rows of members that are gone (whole again and dropped, or off the mat): shown once more at pieces 1 */
  const spare: CutSetRow[] = [];
  let playHome: V3 | null = null;
  let playGenome: Genome | null = null;
  /** several squishies are (or were, until everyone is whole) cut at once: the lines name the squishy */
  let multi = false;
  let inStroke = false, budgetSaid = false;
  let ceilingTest: number | null = null;
  let lastResult: CutResult | null = null;

  /** squishies out, the play squishy included (the mat's count, counted here without its array: this runs every step) */
  const out = (): number => { const xs = bodies.extras; let n = 1; for (let i = 0; i < xs.length; i++) if (!xs[i].piece) n++; return n; };
  const party = (): boolean => out() >= 2;
  const budget = (): number => Math.max(2, Math.min(PARTY_PIECES, LIFE_SLOTS - out()));
  const after = (c: Cutter): number => c.piecesAfter ?? c.pieces;
  /** the pieces of every cut squishy but `except` (a cut that plays counts with what it is about to make) */
  const used = (except: Cutter | null): number => {
    let n = 0;
    if (base !== except) { const k = after(base); if (k > 1) n += k; }
    for (let i = 0; i < members.length; i++) { const c = members[i].cutter; if (c === except) continue; const k = after(c); if (k > 1) n += k; }
    return n;
  };
  /** the most pieces THIS squishy may have now (at least 1: a whole then cannot be cut, and says why) */
  const roomFor = (c: Cutter): number => Math.max(1, budget() - used(c));
  const othersCut = (c: Cutter): boolean => used(c) > 0;
  const nameOf = (genome: Genome, itemId: string | null, nickname: string | null): string => {
    if (nickname) return nickname;
    try { const it = itemId ? game.hoard.item(itemId) : null; if (it) return it.name; } catch { /* the catalog name */ }
    try { return getSpecies(genome.species)?.name ?? 'Squishy'; } catch { return 'Squishy'; }
  };

  /** the party's budget is said ONCE per stroke or press (two squishies refused by one stroke say one line), in the party's words; every other line passes */
  const say = (t: string): void => {
    if (t === T.lotOfPieces && party()) {
      if (inStroke && budgetSaid) return;
      budgetSaid = true;
      say0(T.partyFull(budget()));
      return;
    }
    say0(t);
  };

  // ---- the play squishy's cutter learns of the party (its deps object is the one it reads; one squishy out: every answer is the published one) ----
  deps.say = say;
  deps.pieceCap = () => (party() ? roomFor(base) : null);
  deps.homeSpot = () => playHome;
  deps.name = () => (multi ? rows[0].name : null);
  deps.keepCache = () => othersCut(base);

  const setOf = (key: string): MemberSet | null => { for (let i = 0; i < members.length; i++) if (members[i].key === key) return members[i]; return null; };
  function makeSet(xb: ExtraBody): MemberSet {
    const key = xb.itemId as string, c = xb.body.center;
    const view = memberBodies(bodies, key, xb, d0);
    const set: MemberSet = {
      key, view, cutter: base, home: { x: c.x, y: 0, z: c.z }, wasCut: false, keepUntil: 0,
      row: spare.pop() ?? { key: '', play: false, name: '', species: '', pieces: 1, busy: false },
    };
    set.row.key = key; set.row.play = false; set.row.name = nameOf(xb.genome, key, null); set.row.species = xb.genome.species; set.row.pieces = 1; set.row.busy = false;
    set.cutter = createCutter({
      ...d0, bodies: view, say,
      // a party member is only ever cut with the party out: the party stays (never the published mat clear), every untouched whole sleeps first (the host's rule)
      clearMat: () => { try { return hooks.beforeCut?.() ?? 0; } catch (e) { d0.report(e); return 0; } },
      pieceCap: () => roomFor(set.cutter),
      homeSpot: () => set.home,
      name: () => (multi ? set.row.name : null),
      keepCache: () => othersCut(set.cutter),
    });
    try { if (base.style !== set.cutter.style) set.cutter.setStyle(base.style); } catch (e) { d0.report(e); }
    if (ceilingTest !== null) set.cutter.setCeilingForTest(ceilingTest);
    members.push(set);
    return set;
  }
  /** where a squishy stands now is where it goes back together, noted while it is whole */
  const noteHome = (set: MemberSet): void => { if (set.cutter.pieces === 1 && !set.cutter.busy) { const c = set.view.body.center; set.home.x = c.x; set.home.z = c.z; } };
  const notePlayHome = (): void => {
    if (base.pieces !== 1 || base.busy) return;
    if (!party()) { playHome = null; return; }
    const c = game.body.center;
    playHome = { x: c.x, y: 0, z: c.z };
  };
  /** the member's record (the extra with its item id and no piece flag) */
  const alive = (key: string): boolean => { const xs = bodies.extras; for (let i = 0; i < xs.length; i++) if (xs[i].itemId === key && !xs[i].piece) return true; return false; };
  /** The squishies a stroke crosses AS THE PLAYER SEES IT: on some sample of the line (cut.ts targetOf's samples: every ~6 px, 13 at least, so a thin tip is found) a body of the
   *  squishy is the NEAREST one under it. A squishy wholly hidden behind another along the whole stroke is not crossed. `play`: the play squishy; `keys`: party members. */
  const crossedKeys: string[] = [];
  function strokeOwners(x0: number, y0: number, x1: number, y1: number): boolean {
    crossedKeys.length = 0;
    let play = false;
    try {
      const cam = d0.stage.camera as unknown as CameraLike, vp = d0.viewport(), xs = bodies.extras;
      const K = Math.max(13, Math.min(60, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6)));
      for (let k = 0; k < K; k++) {
        const f = k / (K - 1), n = pxToNdc(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, vp), r = cameraRay(cam, n.x, n.y);
        let bestT = Infinity, who: string | null | undefined;   // undefined: nothing under this sample; null: the play squishy
        const h0 = raycastAt(game.body, r.origin, r.dir, ORIGIN);
        if (h0) { bestT = h0.t; who = null; }
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i];
          if (!x.shared) continue;
          const h = raycastAt(x.body, r.origin, r.dir, ORIGIN);
          if (h && h.t < bestT) { bestT = h.t; who = x.piece ? x.of ?? null : x.itemId; }
        }
        if (who === null) play = true; else if (typeof who === 'string' && !crossedKeys.includes(who)) crossedKeys.push(who);
      }
    } catch (e) { d0.report(e); }
    return play;
  }
  /** the squishies out that are not the play squishy and can be cut: whole members and the anchors of cut ones (shared space only), in mat order */
  const memberRecords = (): ExtraBody[] => bodies.extras.filter((x) => !x.piece && x.shared && x.itemId !== null);
  const maxFrac = (c: Cutter): number => { let m = 0; for (const f of c.fracs()) if (f > m) m = f; return m; };

  /** per step, after every cutter's update: the rows (the play squishy first), the sweep of members that left the mat, the idle sets dropped */
  function refresh(): void {
    const id = game.identity, r0 = rows[0];
    if (playGenome !== id.genome || r0.key !== (id.itemId ?? '')) { playGenome = id.genome; r0.key = id.itemId ?? ''; r0.name = nameOf(id.genome, id.itemId, id.nickname); r0.species = id.genome.species; }
    r0.pieces = base.pieces; r0.busy = base.busy;
    let n = 1, cutNow = after(base) > 1 ? 1 : 0;
    const t = d0.simTime();
    for (let i = 0; i < members.length; i++) {
      const s = members[i], c = s.cutter;
      const gone = !alive(s.key);
      if (gone) {
        // it left the mat (sent back to the shelf) while it may be in pieces: its pieces go with it, and nothing is rebuilt
        const xs = bodies.extras;
        for (let k = xs.length - 1; k >= 0; k--) if (xs[k].piece && xs[k].of === s.key) { try { bodies.removeExtra(xs[k].id); } catch (e) { d0.report(e); } }
      }
      const pieces = gone ? 1 : c.pieces, busy = gone ? false : c.busy;
      if (!gone && after(c) > 1) cutNow++;
      const show = pieces > 1 || busy || s.wasCut;
      s.row.pieces = pieces; s.row.busy = busy;
      s.wasCut = pieces > 1 || busy;
      if (show) rows[n++] = s.row;
      if (gone || (!s.wasCut && !show && t >= s.keepUntil)) {
        // (a set that showed a row this step is dropped on a later step, when that row is no longer read)
        if (!show) spare.push(s.row);
        members.splice(i--, 1);
      }
    }
    rows.length = n;
    if (cutNow >= 2) multi = true; else if (cutNow === 0) multi = false;
    if (base.pieces === 1 && !base.busy && !party()) playHome = null;
  }

  const cutter: PartyCutter = {
    get supported() { return base.supported; },
    get pieces() {
      let n = 0;
      const k = base.pieces;
      if (k > 1) n += k;
      for (let i = 0; i < members.length; i++) { const m = members[i].cutter.pieces; if (m > 1) n += m; }
      return n > 0 ? n : 1;
    },
    fracs() {
      let any = false;
      for (let i = 0; i < members.length; i++) if (members[i].cutter.pieces > 1) { any = true; break; }
      if (!any) return base.fracs();
      const all: number[] = base.pieces > 1 ? base.fracs() : [];
      for (const s of members) if (s.cutter.pieces > 1) all.push(...s.cutter.fracs());
      return all;
    },
    get busy() { if (base.busy) return true; for (let i = 0; i < members.length; i++) if (members[i].cutter.busy) return true; return false; },
    get canSplit() { return party() || members.length ? used(null) < budget() : base.canSplit; },
    get maxPieces() { return party() ? budget() : base.maxPieces; },
    get budget() { return party() ? budget() : null; },
    get style() { return base.style; },
    get canChangeStyle() { if (!base.canChangeStyle) return false; for (let i = 0; i < members.length; i++) if (!members[i].cutter.canChangeStyle) return false; return true; },
    setStyle(next) {
      if (next !== 'clean' && next !== 'minis') return false;
      if (next === base.style) return true;
      if (!cutter.canChangeStyle) { say0(T.styleLocked); return false; }
      const ok = base.setStyle(next);
      if (ok) for (const s of members) s.cutter.setStyle(next);
      return ok;
    },
    prewarm() { base.prewarm(); },
    swipe(x0, y0, x1, y1) {
      // one squishy out and nothing of a party in pieces: the published cut, call for call
      if (!base.supported || (!party() && !members.length)) return (lastResult = base.swipe(x0, y0, x1, y1));
      if (!(Math.hypot(x1 - x0, y1 - y0) >= MIN_SWIPE_PX)) return (lastResult = base.swipe(x0, y0, x1, y1));   // (a tap or a short swipe: the published answer, 'short')
      inStroke = true; budgetSaid = false;
      try {
        // every squishy the stroke crosses on screen, the play squishy first, then mat order; a cutter that is busy answers 'busy' for its own squishy only
        const playCrossed = strokeOwners(x0, y0, x1, y1);
        let res: CutResult = 'miss';
        if (playCrossed) { notePlayHome(); res = base.swipe(x0, y0, x1, y1); }
        const t = d0.simTime();
        for (const xb of memberRecords()) {
          const key = xb.itemId as string;
          if (!crossedKeys.includes(key)) continue;
          const set = setOf(key) ?? makeSet(xb);
          noteHome(set);
          set.keepUntil = t + KEEP_S;
          res = better(res, set.cutter.swipe(x0, y0, x1, y1));
        }
        return (lastResult = res);
      } finally { inStroke = false; }
    },
    splitInTwo() {
      if (!base.supported || (!party() && !members.length)) return (lastResult = base.splitInTwo());
      inStroke = true; budgetSaid = false;
      try {
        // the biggest piece out (a whole counts 1): ties go to the play squishy, then mat order
        let bestF = maxFrac(base), bestX: ExtraBody | null = null;
        for (const xb of memberRecords()) {
          const set = setOf(xb.itemId as string), f = set ? maxFrac(set.cutter) : 1;
          if (f > bestF + 1e-9) { bestF = f; bestX = xb; }
        }
        if (!bestX) { notePlayHome(); return (lastResult = base.splitInTwo()); }
        const set = setOf(bestX.itemId as string) ?? makeSet(bestX);
        noteHome(set);
        set.keepUntil = d0.simTime() + KEEP_S;
        return (lastResult = set.cutter.splitInTwo());
      } finally { inStroke = false; }
    },
    reconnectAll(animated) {
      let any = base.reconnectAll(animated);
      for (let i = 0; i < members.length; i++) { try { if (members[i].cutter.reconnectAll(animated)) any = true; } catch (e) { d0.report(e); } }
      return any;
    },
    reconnect(key, animated) {
      if (rows[0].key === key && (base.pieces > 1 || base.busy)) return base.reconnectAll(animated);
      const set = setOf(key);
      return set ? set.cutter.reconnectAll(animated) : false;
    },
    update(dt) {
      base.update(dt);
      for (let i = 0; i < members.length; i++) { try { members[i].cutter.update(dt); } catch (e) { d0.report(e); } }
      refresh();
    },
    isPiece(b) {
      if (base.isPiece(b)) return true;
      for (let i = 0; i < members.length; i++) if (members[i].cutter.isPiece(b)) return true;
      return false;
    },
    ownerOf(b) {
      if (base.isPiece(b)) return game.identity.itemId ?? '';
      for (let i = 0; i < members.length; i++) if (members[i].cutter.isPiece(b)) return members[i].key;
      return null;
    },
    cutting(b) {
      if (base.cutting?.(b)) return true;
      for (let i = 0; i < members.length; i++) if (members[i].cutter.cutting?.(b)) return true;
      return false;
    },
    get piecesAfter() { const n = used(null); return n > 0 ? n : 1; },
    regions() {
      let any = false;
      for (let i = 0; i < members.length; i++) if (members[i].cutter.pieces > 1) { any = true; break; }
      if (!any) return base.regions();
      const all = base.pieces > 1 ? base.regions() : [];
      for (const s of members) if (s.cutter.pieces > 1) all.push(...s.cutter.regions());
      return all;
    },
    get info() {
      const b = base.info;
      if (!members.length) return party() ? { ...b, ceiling: budget(), lastResult } : b;
      let hits = b.ceilingHits, refusals = b.buildRefusals, parts = b.lastParts;
      for (const s of members) { const i = s.cutter.info; hits += i.ceilingHits; refusals += i.buildRefusals; if (i.lastParts > parts) parts = i.lastParts; }
      return { ceiling: party() ? budget() : b.ceiling, ceilingHits: hits, lastParts: parts, lastResult, buildRefusals: refusals };
    },
    setCeilingForTest(n) { ceilingTest = n; base.setCeilingForTest(n); for (const s of members) s.cutter.setCeilingForTest(n); },
    get sets() { return rows; },
    dispose() {
      for (const s of members.splice(0)) { try { s.cutter.reconnectAll(false); } catch (e) { d0.report(e); } }
      base.dispose();
    },
  };
  refresh();
  return cutter;
}

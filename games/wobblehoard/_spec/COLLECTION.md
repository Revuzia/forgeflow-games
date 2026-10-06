# WOBBLEHOARD module 1 and 1b: COLLECTION (the local-first Hoard) and SERVER MINT

Next-step module document. An engineer should be able to build module 1 (the Hoard on the player's device) and module 1b (the server that mints every real squishy) from this file without a meeting.
Decisions it implements: [`DESIGN.md`](DESIGN.md) sections 5, 7, 8 and 10. Sibling documents: [`MERGE.md`](MERGE.md), [`TRADE.md`](TRADE.md), the build order and the owner's open decisions in [`NEXT_STEPS.md`](NEXT_STEPS.md).
The ceremony visuals and sounds (capsule drop, open, reveal) are built by the render and audio lanes: this file only calls them (section 10) and links to DESIGN section 6.

**Grades used here.** **[V]** = verified by running something in this session. **[R]** = read in the repo this session. **[S]** = taken from DESIGN's own [S]/[O] grades, not re-checked. **[G]** = general knowledge, not verified. **[U]** = my assumption, needs a spike or an owner answer.

**What was actually run (read before trusting the SQL).** The draft SQL in Appendix A was loaded into a scratch PostgreSQL 16.14 with a minimal stand-in for Supabase (roles `anon`, `authenticated`, `service_role`, an `auth.users` table, `auth.uid()` read from the same `request.jwt.claim.sub` setting that migration 0008's self-test uses) and driven by two suites: **149 SQL-level checks** (TRADE.md Appendix C, run through `psql` with `set role authenticated`, many of them with 10 to 48 parallel sessions) and **36 host-level checks** (Appendix C of this file: the reference host of Appendix B running the game's real `meter.ts`, `drops.ts`, `merge.ts`, `catalog.ts` against the SQL, with the real 50-species catalog). All 185 passed on 2026-10-02. **Not run:** a real Supabase project, PostgREST, Edge Functions or Deno, the portal, any browser UI. Everything marked "NOT APPLIED" is a draft: nothing was written to `supabase/migrations/` and nothing was deployed.

**Revised on 2026-10-05 after an audit, and run again the same day** [V]:
the grant revocation is now scoped to the WH objects by name, with a privilege snapshot before the migration and an audit after it (A.0, A.2, A.7);
the local save keeps only idempotency keys of in-flight operations, never their parameters, and a reload asks the new read `wh_op_status` instead of
re-sending anything (5.1, 7.7); the mirror stores a salted account tag instead of the auth id (5.4); Tidy-up sub-keys are hashes (Appendix B, one new
host check in Appendix C); the bridge's limits are described as what they are (8.2). The trade-side revisions are listed in TRADE.md. With all of
them, the SQL, the runner and this file's host were cut **verbatim out of the three documents** by a script and run on a scratch PostgreSQL 16.14:
**170 of 170 SQL checks, 37 of 37 host checks** (against `src/core` and `src/data` as they stood on 2026-10-05), the ops pack clean, and the privilege
audit A.7 passing; A.7 was also shown to **fail** the migration when a schema-wide revoke or a stray grant is injected (A.7). Still not run: Supabase,
PostgREST, the Edge Function, Deno, the portal, any UI.

---

## 1. Summary

1. **Two modules in one file.** Module 1 is the player-side Hoard: a local-first inventory store, stacks by species, the capsule table, restock, tasks, the meter ring, the detail card with a live pokeable squishy. Module 1b is the server that mints every real item.
2. **A real squishy exists only on the server.** Every instance has a server-minted UUID. A local save is never promoted: a guest keeps a *Practice shelf* of "ghost" items that live on the device and are never sent anywhere. Nothing a guest does can be claimed on sign-in except the player's own settings.
3. **The server runs the game's own code.** `meter.ts`, `drops.ts`, `merge.ts`, `catalog.ts`, `genome.ts`, `rarity.ts` run unchanged in a small TypeScript host (a Supabase Edge Function is the recommendation, section 7.2). The host decides; the database function that commits the result enforces every invariant it can check without running game math (ownership, locks, caps, tier rules, genome code integrity, conservation).
4. **Five operations and reads.** `wh_hello`, `wh_report_play`, `wh_open_capsule`, `wh_claim_restock`, `wh_complete_task`, plus the reads `wh_state`, `wh_inventory` and `wh_op_status` (the stored answers of the player's own keys, 7.7). Merge (`wh_merge`, `wh_tidy`) is in `MERGE.md`. Every mutating call carries a client-generated idempotency key; a retry returns the stored answer.
5. **Touch is validated by time, not by trust.** The client reports touches as `[kind, amount, dtMs]` (a pull adds its hold in seconds, `[2, level, dtMs, heldS]`, since the 2026-10-06 per-second stretch pay, DESIGN 5.4). The host lays the batch out so its last touch is "now", drops anything that would land before the last accepted touch or outside a 5-minute bank, and runs `addInteraction` over what is left. Measured here: a forged 24-minute stream sent as 12 back-to-back batches earns **2 capsules**; a forged 25-minute stream (1500 pokes, one second apart) accepted at face value earns **9** (section 7.5) [V].
6. **Randomness is a CSPRNG function, with the three draws logged.** `rollCapsule` and `rollMerge` accept a function as their random source, so the host passes `crypto.getRandomValues` and records the draws. Replaying a logged roll reproduced the result **2000 of 2000** times for capsules and for merges [V]. There is no 32-bit seed to recover.
7. **Concurrency is optimistic, per account.** Every state-changing call bumps `wh_accounts.version`; the host reads, decides, commits at `expect_version`, and starts over on `conflict`. Parallel callers cannot double-open a capsule or double-merge a pair [V].
8. **Local-first means the device is a cache for signed-in players.** The Hoard opens instantly from a compact mirror (33 KB for 331 items, 100 KB for 1000 [V]) and is read-only until the server answers.
9. **The portal bridge gets one new message pair** (`forgeflow:rpc` and `forgeflow:rpc_result`) and an allowlist per game slug. The game never sees a token.
10. **Order of work:** local store and Hoard UI on practice items first (no server needed), then the migration and host, then the bridge, then wire the two together (section 12).

## 2. Decisions

### 2.1 Taken from DESIGN (not reopened)

Odds, tiers, meter rules, caps, restock and tasks (5.2, 5.4); repeats allowed; a local save is never promoted (7.1, 7.2, 8.3); server-minted ids; `tradeCount` server-only; the portal bridge pattern; no real-money path; no free text anywhere; flash and calm rules (6.6).

### 2.2 Proposed here (need the owner's or the lead's nod; each is cheap to change before code exists)

| # | Proposal | Why | Cost of reversing later |
|---|---|---|---|
| C-1 | Server logic = TypeScript host running the game's own modules + SQL commit functions that enforce invariants. Not a PL/pgSQL port. | DESIGN says "the server must re-run these verbatim". A port drifts; the sim, probes and server would stop agreeing. | Medium: the commit-function interface is host-agnostic, so the host can move (Edge Function, Cloudflare Worker, Node) without touching SQL. |
| C-2 | Random source = CSPRNG function with logged draws. | A `mulberry32` seed is 32 bits; a revealed genome seed would leak the roll seed to a brute-forcer. Logged draws give audit and replay with no seed to protect. | Low. |
| C-3 | Optimistic concurrency with `wh_accounts.version` and a retry in the host. | The commit function cannot run game math, so it cannot recompute a roll; it can refuse a roll made against stale state. | Low. |
| C-4 | A 5-minute "bank" of reportable play time; touches that would land before the last accepted touch are dropped. | Closes the time-compression exploit (7.5) without any device attestation. | Low (two constants). |
| C-5 | At most **5 unopened play capsules** wait on the table; at 5, meter accrual pauses (nothing is lost, touches are simply not paid). Task capsules bypass the cap. | DESIGN says "up to 5 on the table" but not what happens at 5. Pausing is the simplest rule that bounds stockpiles. | Low. |
| C-6 | Guests get a Practice shelf; "claim on sign-in" grants nothing. | Any promotion path is a forgery path (a hand-edited save would mint a Mythic). | Adding an optional welcome grant later is one function (section 5.3). |
| C-7 | `trade_enabled` defaults to **false** for every account; only the owner (or a future portal age flow) turns it on. | DESIGN open question 1 (age and consent) is unanswered; the strictest default is off. | None. |
| C-8 | "Day" for the meter, restock, tasks and merge cap = **UTC day** (as `meter.ts` already does); trade caps use rolling 24 hours (TRADE.md). | `meter.ts` and `daySeed` already assume a day key. The boundary is one config value if the owner prefers another. | Low. |
| C-9 | Items store the `g1.` share string (`genome_code`) next to `species_idx`, `tier_idx`, `genome_seed`. `'restock'` becomes an additive origin kind. | A merge result's genome depends on its parents' genomes, so it cannot be re-derived from `(species, seed)` alone. DESIGN 7.1 already allows `'restock'` as an additive. | Low. |
| C-10 | Every mutating call has an idempotency key (16 to 64 characters of `A-Za-z0-9_-`), kept 30 days (play batches 1 day: one row per 45 seconds of play would otherwise dominate the table). | Lost responses, reloads and two tabs must never double-pay. | Low. |

## 3. Module boundary

### 3.1 Files

**Client, new, logic only (no DOM except where noted):**

| File | What it holds |
|---|---|
| `src/collection/constants.ts` | `WH_QUEUE_MAX = 5`, batch limits, bank, caps. A probe checks it against the SQL config seeds. |
| `src/collection/types.ts` | `HoardItem`, `HoardSave`, `MirrorRow`, `PendingOp`, `Stack`, `ServerState`. |
| `src/collection/store.ts` | Load, save, migrate and park the v2 save through an injected `StorageLike` (same contract as `core/save.ts`). |
| `src/collection/stacks.ts` | Pure derivations: stacks by species, keeper and spares, filters, sorts, Tidy-up candidates. |
| `src/collection/ghost.ts` | The practice economy for guests: local meter, local capsules, local merge. The ONLY file allowed to call `rollCapsule` or `rollMerge` on the client. |
| `src/collection/meterfeed.ts` | `SoftEvent` to `Interaction` mapping (DESIGN 5.4), the batch builder, the local preview meter. |
| `src/collection/bridge.ts` | The postMessage client (`whoami`, `rpc`), a state machine `standalone / waiting / silent / guest / signedIn` copied from `games/blocktooth/src/net/portal.ts`. The only file that touches `window.parent`. |
| `src/collection/api.ts` | Typed wrappers for every `wh_*` call; validates every response shape at runtime (never trust the reply). |
| `src/collection/sync.ts` | Mirror, pending-op keys, reconcile through `wh_op_status`, backoff (section 7.7). |
| `src/collection/copy.ts` | Error code to plain-English player text (section 9.9). |
| `src/collection/index.ts` | `createCollection(deps)` returning the `Collection` interface the shell and UI use. |

**Client, new, DOM (SHELL owns `src/ui/**`):** `src/ui/hoard/` with `hoardPanel.ts`, `plinth.ts`, `detailCard.ts`, `capsuleDock.ts`, `restockPanel.ts`, `tasksPanel.ts`, `meterRing.ts`, `speciesIcon.ts`, `a11y.ts`.

**Server, new, outside the game folder:** `supabase/migrations/00NN_wobblehoard_mint.sql` (applied by hand by the owner, like 0002 to 0008; the number is the next free one: `0007` is absent from the repo, ask), `supabase/functions/wh-api/index.ts` with `_shared/wh/core` and `_shared/wh/data` (vendored copies of the game's modules plus `host.ts`, Appendix B), `games/wobblehoard/_harness/vendor_server.mjs` and `probe_server_vendor.ts` (copy and hash check, so "verbatim" is enforced, not hoped for).

**Portal, changed (not by this lane):** `src/lib/gameBridge.ts` gains the `forgeflow:rpc` handler and the allowlist (section 8). No existing table, policy or function is altered by any of this work, and the migration proves it: it snapshots every privilege of the portal's objects first and fails as a whole if any changed (Appendix A.0 and A.7). The one trigger on `auth.users` is described in TRADE.md section 16.5.

### 3.2 Import rules (enforced by a probe, `probe_collection_imports.ts`)

* `src/collection/**` imports only `../core/*.ts`, `../data/catalog.ts` and `../contracts.ts` (types). Never `physics`, `render`, `audio`, `ui` or `three`.
* `src/ui/hoard/**` imports `collection/*`, `ui/dom.ts`, `ui/theme.ts` and `contracts.ts` types. It never imports `rollCapsule` or `rollMerge`.
* `rollCapsule` and `rollMerge` may appear on the client only in `collection/ghost.ts`. A real item never comes from client code.
* The server host imports `core/*` and `data/*` verbatim and nothing from `collection/` or `ui/`.

### 3.3 What the module takes from core and data

| Module | Used for | Where it runs |
|---|---|---|
| `core/meter.ts`: `createMeter`, `addInteraction`, `sanitizeMeter`, `meterFill`, `dailyStatus`, `capsuleThreshold`, `DAY_MS` | Meter, caps, ramp | Client: preview ring and ghost meter. Server: authoritative. |
| `core/drops.ts`: `rollCapsule`, `capsuleGenome`, `daySeed`, `restockOffer`, `restockDisplayOrder`, `isValidRestockPick`, `dailyTasks`, `TASK_DEFS`, `claimTask`, `createTaskState`, `weekKeyOf`, `makeRng`, `draw` | Capsules, restock, tasks | Client: ghosts and offer display. Server: authoritative. |
| `core/merge.ts`: `previewMerge`, `rollMerge`, `MERGE_COST`, `createMergePity`, `lineageGenome` | Merge | See MERGE.md. |
| `core/rarity.ts`: `TIERS`, `TIER_ODDS`, `oddsPerSpecies`, `TIER_STYLE` (gem shape, frame colour) | Gems, labels, public odds text | Client and server. |
| `core/genome.ts`: `encodeGenome`, `decodeGenome`, `genomeEquals`, `newInstance`, `SquishyInstance` | Item storage format | Client and server. |
| `data/catalog.ts`: `CATALOG`, `SPECIES`, `getSpecies`, `speciesBaseGenome`, `SPECIES_BY_TIER`, `tierOf` | Species data | Client and server. |

### 3.4 The `Collection` interface (what the shell and the UI call; sketch)

```ts
export interface Collection {
  readonly mode: 'loading' | 'guest' | 'signedIn';
  readonly ledger: 'real' | 'practice';                    // which items the Hoard is showing right now
  items(ledger?: 'real' | 'practice'): HoardItem[];
  stacks(ledger?: 'real' | 'practice'): Stack[];           // 50 entries, owned or not
  meter(): { fill: number; credits: number; resting: boolean; doneToday: boolean; tableFull: boolean; offline: boolean };
  onChange(fn: () => void): () => void;
  feed(ev: SoftEvent, tMs: number): void;                  // call from the frame loop where the shell already drains SoftEvents for audio and haptics
  previewTouch?(kind: 'poke' | 'squeeze' | 'pull', heldS: number, level: number): number;   // the pending arc while a touch is held (9.7); 0 for a tap (a poke, a squeeze under 0.4 s)
  openCapsule(): Promise<OpenResult>;                      // result first; see section 10
  restock(): { offer: SpeciesId[]; claimed: boolean };  claimRestock(pick: SpeciesId): Promise<ClaimResult>;
  tasks(): { def: TaskDef; progress: number; done: boolean; claimed: boolean }[];  completeTask(id: string): Promise<void>;
  previewMerge(ids: string[]): { preview: MergePreview; digest: string };  merge(ids: string[], digest: string): Promise<MergeResult>;   // MERGE.md
  tidyPlan(opts: { includeRare: boolean }): string[][];  tidy(plan: string[][]): Promise<TidyResult>;
  setFav(ids: string[], fav: boolean): Promise<void>;  markSeen(ids: string[]): Promise<void>;
  // trade, shelf, friends, board, block, report: TRADE.md
}
```

### 3.5 Changes to frozen or SHELL-owned files (all additive; report them when made)

1. `core/genome.ts` `SquishyInstance.origin.kind` union gains `'restock'` (DESIGN 7.1 allows it). `core/save.ts` `parseInstance` has a hard-coded whitelist `['starter','drop','task','blend','trade']` that must gain `'restock'` or a restock item will fail to load.
2. Nothing in `contracts.ts` for this module. (MERGE uses the existing optional `playMergeCeremony` and `mergeStart`.)
3. Genome codes compare with `genomeEquals`, **not** `JSON.stringify`: `decodeGenome` builds the object with a different key order, so a string comparison of two equal genomes is false [V: found while testing].

## 4. Trust model: who decides what

| Decision | Client | Server |
|---|---|---|
| Which squishies exist and who owns them | Never. A mirror is a cache. | Always: `wh_items`, one row per squishy, UUID minted by the database. |
| What a capsule contains | Practice capsules only (ghosts). | `rollCapsule` with a CSPRNG, stored with the three draws. |
| How many SP a touch is worth, whether a capsule is earned | Previews the ring. | `addInteraction` over server-placed times; credits come only from the meter's own counter. |
| Which three species the restock offers | Displays (same code, same seed). | Recomputes and refuses any other pick. |
| Whether a task is done | Shows a progress bar. | Counts touches itself; the client's "done" is a hint. |
| Merge odds, the roll, the pity counter | `previewMerge` for the panel. | Rolls and stores pity (MERGE.md). |
| Locks, caps, hearts, reservations | Greys out buttons. | Enforces in the commit function. |
| What time it is | Never trusted. Only relative offsets (`dtMs`) are sent. | `now()` of the database. |

The game iframe is untrusted for rolls but not powerless: it holds the player's session through the portal, so a compromised game build can call any allowed RPC as that player (it cannot do more than the player can). All games share one CDN origin [R] (`forgeflow-games-cdn.isimcha85.workers.dev/<slug>/`, uploaded by `pipeline/deploy_game.py`), so `localStorage` is shared by every game on it, and by any script injected into any of them. **The local save is hostile input at all times, and it must also hold nothing another script could turn into an action or an identity:**

* **No replayable parameters.** A sibling game could write a fake pending merge naming two of the player's own spare ids (it can read them from the mirror) and this game would send it, with the player's session, on the next load. So `pending` holds only idempotency keys and op kinds, never item ids, picks or touches, and nothing from storage is ever re-sent: after a reload the client asks `wh_op_status` what happened to those keys (7.7). Every op that consumes, chooses or moves items needs a fresh confirmation in the current session.
* **No portal auth id.** The mirror is tagged with a salted hash of the account id (5.4), not the id itself (TRADE.md 5.1: the game must never forward it).
* **The clean fix is a separate origin per game** (owner decision NEXT_STEPS D-16); until then the two rules above are the mitigation.

## 5. The local-first inventory

### 5.1 Types and save format

```ts
export const HOARD_VERSION = 2 as const;

/** One squishy as the Hoard shows it: real (server) or ghost (practice, device only). */
export interface HoardItem {
  id: string;                 // real: server UUID.  ghost: 'g-' + 12 random base36 chars
  species: SpeciesId;
  genome: Genome;             // decoded from the g1 code, never edited
  name: string;               // catalog name, or an optional nickname chosen from a fixed list (no free text)
  bornAt: number;             // epoch ms
  origin: 'starter' | 'drop' | 'task' | 'restock' | 'blend';
  parents?: string[];         // blend only
  tradeCount: number;         // server value; ghosts are always 0
  lockedUntil: number | null; // epoch ms on the SERVER clock; null = free
  fav: boolean; offered: boolean; seen: boolean; reserved: boolean;
  ghost: boolean;             // true = never tradeable, never mergeable with real items, never sent anywhere
}

/** Compact storage row: [id, speciesIdx, g1code, bornAt, flags, tradeCount, lockedUntil|0, originCode]; flags: fav 1, offered 2, seen 4, reserved 8. */
export type MirrorRow = [string, number, string, number, number, number, number, number];

export interface HoardSave {
  v: 2;
  deviceId: string;             // random; only prefixes idempotency keys; never an identity, never sent as one
  ghosts: MirrorRow[];          // the Practice shelf (cap 100)
  ghostMeter: MeterState;       // practice meter (core/meter.ts)
  ghostPity: number[];          // practice merge pity, length 6
  ghostCapsules: number;        // unopened practice capsules (cap 5)
  mirror: null | {              // read-only cache of the signed-in account
    acctTag: string;            // NOT the auth id: the first 32 hex characters of SHA-256('wh-acct:' + deviceId + ':' + authId) (section 5.4)
    at: number; version: number;
    items: MirrorRow[]; meter: MeterState; credits: number; pity: number[]; serverDay: number;
  };
  pending: PendingOp[];         // in-flight mutating ops: KEYS ONLY, never their parameters (section 7.7)
  prefs: { view: 'cabinet' | 'grid'; sort: SortKey; tiers: number; lanes: number; onlySpares: boolean; onlyMissing: boolean };
  migratedFromV1: boolean;
}

/** What a reload may know about an operation that was in flight: its kind and key, nothing else. No item ids, picks, task ids or touches are
 *  ever stored, so nothing read back from this shared storage can be turned into a request (section 4). Capped at 20 entries, dropped after 10 minutes. */
export interface PendingOp { kind: 'play' | 'open' | 'restock' | 'task' | 'merge' | 'tidy' | 'trade'; idem: string; acctTag: string; at: number }
```

* Key `wobblehoard:v2:hoard`; unreadable blobs are parked in `wobblehoard:v2:hoard.unreadable` (20 000 characters), exactly like `core/save.ts` does for v1. A blob with `v > 2` is **newer**: run on a fresh in-memory save and never overwrite it.
* The slice-1 key `wobblehoard:v1:profile` is **never deleted or rewritten by this module** (rollback safety; `createProfileStore` keeps counting stats there).
* Every row is validated on load: `decodeGenome(code)` must return a genome (else the row is dropped), species index inside the catalog, `id` a string of at most 64 characters, row counts capped (ghosts 100, mirror 2000). A hand-edited save can crash nothing and mint nothing.
* **Size [V]:** compact rows are 100 bytes per item: 5 KB for 50 items, **33 KB for 331 items** (the sim's week-9 mean), **100 KB for 1000**. As full `SquishyInstance` objects the same would be 51 KB and 153 KB. localStorage allows about 5 MB [G], so the budget is generous; throttle writes to one per 2 s like `core/save.ts`.
* Writes are throttled and flushed on `pagehide` and `visibilitychange` hidden. A write failure (private mode, quota) is swallowed; the app keeps playing and shows nothing.

### 5.2 Migration v1 to v2

1. If `wobblehoard:v2:hoard` parses and validates: use it. Done.
2. Else read `wobblehoard:v1:profile` with the existing `loadProfile`. If it is `ok`, build a v2 save whose ghosts are `[profile.instance]` (same id, so it stays stable), `migratedFromV1: true`, empty meter, empty everything else. Write it. **Leave the v1 key alone.**
3. Else (fresh visit or corrupt v1): create the starter ghost with `newInstance(makeStarterGenome(), { kind: 'starter' })` as `core/save.ts` does, write v2.
4. Probe `probe_collection.ts`: v1 blob with N stats migrates, v2 exists, v1 key byte-identical afterwards; corrupt v1 parks and still boots; `v: 3` blob is read-only.

### 5.3 Stacks, keeper and spares

`stacks.ts` is pure and runs in node. `buildStacks(items): Stack[]` returns one entry for each of the 50 species (owned or not) in catalog order:

```ts
interface Stack {
  idx: number; species: SpeciesId; tier: TierId;
  copies: number;                 // items of this species in the active ledger (real, or ghost when viewing Practice)
  keeper: string | null;          // the first hearted copy, else the oldest by bornAt (ties by id)
  spareIds: string[];             // every other copy, newest first
  spares: number;                 // copies - 1 (0 when unowned)
  mergeable: number;              // spares that are not hearted, not locked, not reserved
  locked: number; unseen: number; offered: number;
}
```

* **Real and ghost items never share a stack or a count.** Signed in: the Hoard shows real items; the Practice shelf is a separate tab. Guest: only the Practice shelf exists.
* "Spare" is *derived*, never stored: `copies - 1`. The keeper is the heart, else the oldest, so a player can choose which copy stays by hearting it. Spare badges read "x3" on the plinth and "2 spare" on the card.
* **Tidy-up candidates** (MERGE.md): from each stack, `mergeable` copies in groups of `MERGE_COST`, newest first, never the keeper, never hearted, locked or reserved items. With M = 2 and 3 copies there is one candidate pair.
* Properties checked by the probe: the sum of `copies` equals the item count; `spares = copies - 1`; the keeper is never in `spareIds`; the result is identical after shuffling the input.

### 5.4 Account switching, sign-out and shared devices

* The mirror carries `acctTag`, a salted hash of the portal's account id (`deviceId` is the salt; `crypto.subtle.digest`), never the id itself: every game on the shared origin can read this storage (section 4). The game recomputes the tag from the identity the portal sends and compares. A different account (or sign-out) **wipes the mirror from storage** and the pending keys tagged with the old account. Prefs and the Practice shelf stay. Rationale: kids share tablets; the strictest design leaves no real inventory behind.
* Two tabs: every send is idempotent and the server is the source of truth, so two tabs cannot double-pay; the mirror is last-write-wins and re-fetched on focus. No locking is needed.

## 6. Guest and signed-in flows

| | Guest, standalone, or portal that never answers | Signed in |
|---|---|---|
| Items | Practice shelf (ghosts) only | Real items from the server |
| Meter | Local, practice (`ghost.ts`) | Local preview ring; the server's meter is the truth |
| Capsules | Client rolls with `rollCapsule` and a local random source; ghost items | Server rolls; real items |
| Restock, tasks | Practice, seeded from the device id | Server, seeded from the account |
| Merge | Practice merge on ghosts (client `rollMerge`) | Server `wh_merge` |
| Trade, board, friends | Not available; the buttons show "Sign in to trade" | Available if the account is allowed (TRADE.md) |
| Starter Dollop | The slice-1 Dollop is ghost number one | The server mints one real starter (`origin: 'starter'`) on first contact |

### 6.1 The bridge states

`standalone` (no parent frame), `waiting` (asked `whoami`), `silent` (the parent never answered: an older portal, treat as guest for good), `guest` (portal answered `signedIn: false`), `signedIn`. Copy the machine and its timers from `games/blocktooth/src/net/portal.ts` [R] (3 `whoami` tries, 4 s apart). A sign-in after Play arrives as an unsolicited `forgeflow:identity` push [R]; the game must switch from guest to signed-in without a reload.

### 6.2 First sign-in

1. `identity.signedIn` becomes true: call `wh_hello` (host). It creates the account row and **one real starter Dollop** if none exists. A second call creates nothing [V].
2. Call `wh_state` and `wh_inventory`; fill the mirror; show the real Hoard.
3. The Practice shelf is kept under its own tab with a dashed frame and the label "Practice". Nothing is converted.

### 6.3 What "claim on sign-in" can and cannot do

**Can:** keep the Practice shelf visible; keep settings and prefs; skip the first-capsule hint if the player already opened practice capsules (a pure UI decision).
**Cannot (by design):** promote any ghost item, copy local meter progress, count practice capsules, or import the local starter. Reason: every import path is a forgery path; a hand-edited localStorage would otherwise become a Mythic.
**Optional, not adopted:** a one-time welcome grant of up to 3 capsule credits (the length of the onboarding ramp 30 + 50 + 75 SP, about 77 s to the first one for a regular player since the taps stopped paying, 63 s before [DESIGN 5.4]) when a guest signs in having opened 3 practice capsules, with the server meter's `earned` advanced by the same number so the ramp is not paid twice. It is bounded (3), once per account, and saves about five minutes of play; it needs one more commit function. Recommendation: skip it.

### 6.4 Sign-in nudges

No pressure copy, no timers, no "you will lose it". One quiet chip on the Practice tab: "Sign in to keep real squishies and trade." It never interrupts touching and is dismissible for the session.

## 7. Module 1b: the server mint

### 7.1 Picture

```
 game iframe (cross-origin CDN)                  portal page (forgeflowgames.com)                     Supabase project (qkid)
 +-----------------------------+   postMessage   +-----------------------------------+  user JWT       +------------------------------------+
 | src/collection/bridge.ts    | --------------> | gameBridge.ts  (allowlist by slug)| --------------> | (A) PostgREST rpc: wh_state, wh_inventory,|
 |   forgeflow:rpc {fn,args}   | <-------------- |   forgeflow:rpc_result            |                 |     wh_set_fav, trade and friend RPCs  |
 +-----------------------------+                 +-----------------------------------+  user JWT       | (B) Edge Function wh-api (Deno, verify_jwt)|
                                                                                        --------------> |     wh_hello, wh_report_play, wh_open_capsule,|
                                                                                                        |     wh_claim_restock, wh_complete_task, wh_merge|
                                                                                                        |     runs core/*.ts, calls wh__* as service_role|
                                                                                                        |     wh__commit_*  SQL: locks, invariants, ledger|
                                                                                                        +------------------------------------+
```

### 7.2 Why a host plus commit functions, and where the host runs

The game logic is TypeScript (`mulberry32`, float trig in `lineageGenome`, the meter's valve ledger). A PL/pgSQL port would have to reproduce it bit for bit and keep doing so forever, and the economy sim, probes and server would then agree only by luck. Instead:

* **The host** (TypeScript, Appendix B) reads the account state, runs the game's own functions with a CSPRNG, and proposes a result.
* **The commit functions** (SQL, `wh__commit_*`, Appendix A) are the only writers. They take the account lock, check `expect_version`, check every rule they *can* check without game math (ownership, locks, caps, tier arithmetic, species/tier agreement against `wh_species`, genome code integrity, "credits equal the meter counter", "play time cannot be in the future"), write the item and the ledger row, and store the answer under the idempotency key. A buggy host is stopped loudly (`wh_bad_roll`, `wh_bad_play`: the transaction rolls back); a **malicious host** (one that holds the service key) can still mint a Mythic, so the service key is the trust root: keep it in the function's secrets, never in the portal bundle.
* **Where the host runs** is an owner decision (NEXT_STEPS D-6). Recommendation: a **Supabase Edge Function** `wh-api` (Deno): the user's JWT is verified by the platform, no new vendor, same project. The game modules use `.ts` relative imports, which Deno accepts [G]; vendor them into `_shared/wh/` (the vendor script and hash probe make "verbatim" enforceable) because whether the Supabase CLI bundles imports from outside `supabase/functions` is [U]. Alternatives that need **no SQL change**: a Cloudflare Worker (the repo already has `workers/games-cdn` and wrangler) calling PostgREST with the service key; any Node host. Fallback if the owner rejects any server code: port to PL/pgSQL **with golden vectors generated from the TS** (a sizeable risk; not recommended).

**The Edge Function entry point (sketch, not run).** The user id comes from the verified JWT, never from the body; the function name is checked against an allowlist; the body is size-limited; the browser calls it from the portal, so it must answer CORS for the portal origin [G].

```ts
// supabase/functions/wh-api/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createHost } from './_shared/wh/host.ts';          // Appendix B, imports the vendored ./core and ./data
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);   // secret: never in the portal bundle
const host = createHost({ rpc: async (fn, p) => { const { data, error } = await admin.rpc(fn, { p }); if (error) throw error; return data; } });
const OPS = { wh_hello: (u) => host.bootstrap(u), wh_report_play: host.reportPlay, wh_open_capsule: host.openCapsule, wh_claim_restock: host.claimRestock,
              wh_complete_task: host.completeTask, wh_merge: host.merge, wh_tidy: host.tidy };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return cors(json({ ok: false, error: 'not_signed_in' }, 401));
  const len = req.headers.get('content-length');                 // refuse a large or unannounced body BEFORE reading it into memory
  if (len === null || !/^[0-9]{1,6}$/.test(len) || Number(len) > 16384) return cors(json({ ok: false, error: 'bad_payload' }, 413));
  const raw = await req.text(); if (raw.length > 16384) return cors(json({ ok: false, error: 'bad_payload' }, 413));
  const { fn, args } = JSON.parse(raw); const op = (OPS as any)[fn];
  if (!op) return cors(json({ ok: false, error: 'not_allowed' }, 403));
  try { return cors(json(await op(user.id, args ?? {}))); } catch { return cors(json({ ok: false, error: 'busy' }, 503)); }   // log the detail server-side only
});
```

### 7.3 Tables (DDL in Appendix A, NOT APPLIED)

| Table | Purpose | Written by |
|---|---|---|
| `wh_species` | `idx`, `id`, `tier_idx` for all species; the commit functions check every roll against it. Seeded from the catalog by a generator (`_harness/gen_wh_species.ts`) and checked by a probe; appending a species is a one-row migration plus a host redeploy. | migration |
| `wh_config` | Kill switches (`minting_enabled`, `merging_enabled`, `trading_enabled`, `board_enabled`), `merge_cost`, caps, lock hours, trade numbers. | owner, SQL |
| `wh_accounts` | One row per player: `public_id` (the only id other players ever see), `version`, meter JSON, `last_event_ms`, merge pity, restock and task state, counters, trade gate, handle, redeem counters. | commit functions |
| `wh_items` | One row per squishy ever minted: `owner_id`, `species_idx`, `tier_idx`, `genome_code`, `genome_seed`, `origin`, `parents`, `trade_count`, `version`, `locked_until`, `reserved_trade_id`, `fav`, `offered_at`, `consumed_at`. Rows are never deleted by the game (a merge sets `consumed_at`). | commit functions |
| `wh_capsules` | The queue: one row per earned capsule (`source` play or task), opened in strict FIFO order (`seq`). | commit functions |
| `wh_ops` | Idempotency: `(user_id, idem)` with the stored answer and a digest of the arguments; 30-day retention, play batches 1 day (`wh__purge`, run daily). | commit functions |
| `wh_ledger` | Append-only (a trigger refuses update and delete): `mint`, `consume`, `transfer`, `burn` with the draws and odds basis in `detail`. No foreign keys, so it survives account deletion. | commit functions |
| `wh_rate` | Per-account token buckets for the offer and board RPCs (TRADE.md 7.4); one row per account and bucket. | `wh__take` |

Client access: RLS is on for every table; `anon` and `authenticated` have **no write privileges at all** (a direct insert answers 42501, checked [V]). The privileges are taken back **by name, on the WH objects only** (A.2): a schema-wide revoke would also strip the portal's own grants and break the site, and the migration's own audit (A.0, A.7) fails it if any non-WH privilege changed; a player may `select` only their own `wh_accounts`, `wh_items`, `wh_capsules` rows (and the public species list). Everything else goes through RPCs, as 0008 does for BLOCKTOOTH. In particular `wh_trades` and `wh_blocks` are not readable at all, because they carry another player's auth id (TRADE.md section 7.1).

### 7.4 The operations

All mutating calls require `idem`. The host's reply is the JSON shown; a replay carries `"replayed": true`. `server_now_ms` and `server_day` are returned by `wh_state` and by `wh_report_play`; the client uses them for the daily reset, never its own clock.

| Operation | Transport | Input | Output | What the server recomputes | Errors |
|---|---|---|---|---|---|
| `wh_hello` | host | none | `{ok, created}` | Creates the account and one starter Dollop if absent (idempotent by existence). | `frozen`, `no_user` |
| `wh_state` | SQL rpc | none | version, `public_id`, handle, `server_now_ms`, `server_day`, meter, credits, merges today, restock claimed today, task state and progress, trading readiness, kill-switch flags | Everything. | `not_signed_in`, `no_account` |
| `wh_inventory` | SQL rpc | `{after?: uuid, limit?: 1..200}` | `{items: [...], next}` (keyset pagination by id) | Everything (own rows only). | `bad_payload` |
| `wh_report_play` | host | `{idem, events: [[kind 0..2, amount, dtMs, heldS?], ...] up to 120}` (`heldS` on pulls only) | `{ok, credits, version, paid_sp, accepted, clipped, queue_full, meter:{sp, earned, day_capsules}, server_now_ms, week}` | The time placement, the whole meter, the queue cap, the task counters. | `bad_payload`, `frozen`, `busy`, `idem_reuse` |
| `wh_open_capsule` | host | `{idem}` (opens the oldest credit) | `{ok, item_id, species_idx, tier_idx, genome_code, is_new, copies, source, credits_left, version}` | Tier, species, genome seed (CSPRNG), the genome, the id, `is_new` and `copies` from the database. | `no_capsule`, `frozen`, `busy`, `idem_reuse` |
| `wh_claim_restock` | host | `{idem, pick: SpeciesId}` | `{ok, item_id, species_idx, tier_idx, genome_code, is_new, copies, version}` | The three offered species from `daySeed(uid, serverDay, 'restock')` (refuses any other pick), the day, the once-a-day rule, the genome. | `not_offered`, `already_claimed`, `wrong_day`, `frozen` |
| `wh_complete_task` | host | `{idem, task_id}` | `{ok, credits, version}` | Today's two tasks from `daySeed(uid, serverDay, 'tasks')`, progress from the server's own counters, `claimTask` (once a day, 5 a week). | `not_offered`, `not_done` (with `progress`, `target`), `already_claimed`, `weekly_limit` |
| `wh_set_fav`, `wh_mark_seen` | SQL rpc | `{item_ids[], fav?}` | `{ok}` | Own items only. Hearting removes an item from the offer shelf and does not bump the item version (it is cosmetic). | `bad_payload` |
| `wh_op_status` | SQL rpc | `{idems: [up to 20 keys]}` | `{ok, ops: {key: {op, at, result}}}` | Own stored answers only (`wh_ops`). A key that is absent never committed, or is still running and will show up in `wh_inventory`. Read-only: it never runs anything (7.7). | `bad_payload` |

**Open by "next credit", not by id.** The table shows up to 5 capsule objects, but the client never names a capsule: `wh_open_capsule` opens the oldest unopened credit. That is why an *optimistic* capsule drop (fired by the client's preview meter the moment its ring fills, so the cue feels instant) is safe: if the server credited fewer, the first open answers `no_capsule`, the capsule melts gently, and the ring resumes. [V: host test "no credit left: no_capsule"].

### 7.5 `wh_report_play`: the time budget and what the server does with a batch

The reference implementation is `host_play` below (Appendix B has the whole file).

```ts
  /* ---------------- wh_report_play ---------------- */
  type Ev = [kind: 0 | 1 | 2, amount: number, dtMs: number, heldS?: number];   // heldS: a pull's hold, grab to release (2026-10-06, DESIGN 5.4)
  const KIND: TouchKind[] = ['poke', 'squeeze', 'pull'];
  function bump(progress: Record<string, any>, tasks: TaskDef[], k: TouchKind, amount: number, d: { freshness: number; doubleTap: boolean; medley: number; paidAs?: TouchKind }, gapSincePokeS: number | null): void {
    for (const t of tasks) {
      const key = t.id; let n = Number(progress[key] ?? 0);
      const paid = d.paidAs ?? k;
      if (t.metric === 'pokes' && paid === 'poke' && !d.doubleTap) { if (t.param ? (gapSincePokeS === null || gapSincePokeS >= t.param) : d.freshness >= 0.5) n++; }
      if (t.metric === 'squeezes' && paid === 'squeeze' && amount >= (t.param ?? 0.4)) n++;
      if (t.metric === 'snaps' && paid === 'pull' && amount >= 0.35) n++;
      if (t.metric === 'stretch' && paid === 'pull' && amount >= STRETCH_2X_INTENSITY) n++;
      if (t.metric === 'medleys' && d.medley > 0) n++;
      if (t.metric === 'softPops') {
        const sk = `${key}#streak`;
        if (paid === 'squeeze') { if (amount >= 1.8) { progress[sk] = Number(progress[sk] ?? 0) + 1; n = Math.max(n, progress[sk]); } else progress[sk] = 0; }
      }
      progress[key] = n;
    }
  }
  async function reportPlay(uid: string, req: { idem: string; events: Ev[] }) {
    if (!isIdem(req?.idem) || !Array.isArray(req.events) || req.events.length > MAX_EVENTS_PER_BATCH) return { ok: false, error: 'bad_payload' };
    let prev = -1; const evs: Ev[] = [];
    for (const e of req.events) {
      if (!Array.isArray(e) || ![0, 1, 2].includes(e[0]) || !Number.isFinite(e[1]) || !Number.isInteger(e[2]) || e[2] < prev || e[2] < 0) return { ok: false, error: 'bad_payload' };
      if (e.length > 4 || (e.length === 4 && (e[0] !== 2 || !Number.isFinite(e[3])))) return { ok: false, error: 'bad_payload' };   // only a pull carries a hold
      prev = e[2]; evs.push([e[0], Math.min(e[0] === 2 ? 1 : 10, Math.max(0, e[1])), e[2], e[0] === 2 ? Math.min(10, Math.max(0, e[3] ?? 0)) : 0]);
    }
    return withRetry(uid, req.idem, req, async () => {
      const st = await call('wh__read_state', { uid }); if (!st.ok) return st;
      const t = deps.now ? deps.now() : st.now_ms; let meter: MeterState = st.meter && st.meter.v ? sanitizeMeter(st.meter) : createMeter();
      // THE TIME BUDGET: the batch is laid out so its LAST event is "now" and every spacing is kept; an event that would land at or before the last
      // accepted touch (or older than the 5-minute bank) is dropped. You cannot report more play time than has actually passed.
      const dtLast = evs.length ? evs[evs.length - 1][2] : 0;
      const placed = evs.map((e) => ({ e, t: t - (dtLast - e[2]) })).filter((x) => x.t > st.last_event_ms && x.t >= t - BANK_MAX_MS);
      const clipped = evs.length - placed.length;
      const day = Math.floor(t / DAY_MS); const week = weekKeyOf(day);
      const tasks = dailyTasks(daySeed(uid, day, 'tasks'));
      const progress: Record<string, any> = st.task_progress && st.task_progress.day === day ? { ...st.task_progress } : { day };
      let credits = 0, paid = 0, lastPoke: number | null = meter.lastMs[0], accepted = 0, lastT = st.last_event_ms; let stoppedFull = false;
      for (const { e, t: tm } of placed) {
        if (Number(st.credits_play) + credits >= WH_QUEUE_MAX) { stoppedFull = true; break; }       // table full: accrual pauses (nothing is lost, the touches are simply not paid)
        const r = addInteraction(meter, { kind: KIND[e[0]], amount: e[1], heldS: e[3], tMs: tm, dayKey: Math.floor(tm / DAY_MS) });
        if (r.detail.refused) continue;
        bump(progress, tasks, KIND[e[0]], e[1], r.detail, KIND[e[0]] === 'poke' && lastPoke !== null ? (tm - lastPoke) / 1000 : null);
        if (KIND[e[0]] === 'poke') lastPoke = tm;
        meter = r.state; credits += r.capsulesEarned; paid += r.spGained; accepted++; lastT = tm;
      }
      const res = await call('wh__commit_play', { uid, idem: req.idem, args_digest: digestOf(req), expect_version: st.version, meter, last_event_ms: Math.max(lastT, st.last_event_ms), add_credits: credits, task_progress: progress });
      return res.ok ? { ...res, paid_sp: paid, accepted, clipped, queue_full: stoppedFull, meter: { sp: meter.sp, earned: meter.earned, day_capsules: meter.dayCapsules }, server_now_ms: t, week } : res;
    });
  }
```

**The rule in words.** The batch is laid out so that its **last touch is "now" on the server clock**, keeping every spacing the client reported. A touch is dropped if it would land at or before the last accepted touch (`last_event_ms`) or more than 5 minutes (`BANK_MAX_MS`) in the past. The commit function independently refuses a `last_event_ms` that is in the future (more than 2 s ahead of the database clock) or older than the stored one. Consequence: **you cannot report more play time than has actually passed.**

**Measured [V].** *(2026-10-05, the original rules; through the host unless said otherwise.)* `meter.ts` fed 1500 pokes reported one second apart (a forged 25-minute stream) as one request earned **9 capsules** (the daily hard stop is 12). Through the host, 12 back-to-back 120-event batches claiming 24 minutes in a few real milliseconds were **clipped (1320 of 1440 events dropped) and earned 2 capsules**. A scripted cycler at 3.3 s per touch reached the daily 12 after 68 reported minutes: that is real-time play and is held by the valve and the cap exactly as DESIGN 5.4 says.

**Re-measured on `meter.ts` alone, with the rules of 2026-10-06 after "short taps pay nothing" (squeeze 0.7 SP + 0.6 a second, stretch 1.0 SP + 0.65 a second, taps 0; not run through the host or the SQL).** The same forged stream of **1500 pokes one second apart earns 0 SP and 0 capsules**: a tap pays nothing. The forged stream that does pay is a paid kind: **1500 squeezes (held 1 s) one second apart earn 4 capsules** (340 SP; the 0.03 to 0.17 freshness factor holds them down), 1500 stretches 4 capsules, and **1500 alternating squeezes and stretches (both held 3 s) one second apart, the best forged mix, earn 10 capsules in 25 minutes** (883 SP, held to the 40 SP/min valve); the daily 12 is reached by that mix at 1.65 s per touch after about 41 minutes. A squeeze-and-stretch cycler at 3.3 s per touch whose holds are 2.5 s reaches the daily 12 after **47 minutes**, or **60** when its stretches are held 0 s (the old rules: about 65 to 76); a tap-squeeze-stretch cycler at 3.3 s per touch with 2.5 s holds, whose taps are dead time, reaches it after **62** minutes. The 68 minutes above was measured through the host and was not re-run.

**Other rules in the host.** At most 120 events per request, `dtMs` non-decreasing, kinds 0 to 2 only, amounts clamped (squeeze 0 to 10 s, pull 0 to 1, a pull's hold 0 to 10 s; a hold on any other kind, or a fifth element, is `bad_payload`); the table-full rule (C-5): once credits reach 5 the host stops processing the batch, answers `queue_full: true` and the meter does not move.

**2026-10-06 edit (ECON lane), not re-run.** For the per-second stretch pay (DESIGN 5.4, FUN.md 2.2) a pull now reports its hold as a 4th element and the host passes it to `addInteraction` as `heldS` (this section and Appendix B). The meter itself is probed (`probe_economy.ts`, `probe_collection.ts`), but neither the host suite (Appendix C) nor the SQL suite has been re-run against this draft since; re-run both before it is applied anywhere (gate G9). The draft stays **NOT APPLIED**. The SQL needs no change: it stores the meter as JSON and checks counters, never pay values.

**2026-10-06, later the same day (ECON_NOTAP lane), not re-run: "short taps pay nothing."** The owner decided that a tap (a `poke` event, or a squeeze released under 0.4 s) pays 0 SP; squeezes held 0.4 s or more, stretches and holds still pay, re-tuned to 0.7 SP + 0.6 SP a second (squeeze) and 1.0 SP + 0.65 SP a second (stretch). The host code in this section and Appendix B needs **no change**: it passes every touch to `addInteraction`, which pays a poke 0 and keeps counting it for the tasks (`bump` below still reads `d.freshness` and `d.doubleTap` for the "gentle" and "calm" poke tasks, so the meter still reports them). The medley is now a squeeze and a stretch within 12 s (a tap neither joins nor completes it), still reported as `d.medley`. The forged-stream test in Appendix C was rewritten to forge squeezes (a stream of pokes now earns nothing, which would test nothing). Neither the host suite nor the SQL suite has been re-run (gate G9); the draft stays **NOT APPLIED**.

**Offline buffering.** The client may hold up to 5 minutes of touches **in memory** while offline or while a request is in flight and send them later; anything older than the bank is simply not paid. Touches are never written to storage, so a reload loses the unsent ones (7.7). Batch every 30 to 45 s while touching, on `visibilitychange: hidden`, and just before opening a capsule.

### 7.6 Plausibility checks against macros (DESIGN risk 7)

No check can tell a perfect macro that runs in real time from a human; DESIGN risk 7 says "cannot be zero" and this table is honest about it. The aim is to raise the cost from "a script POSTs a number" to "a script runs for as long as a human would, and still gets only a human's daily cap".

| # | Check | Catches | In the reference host? |
|---|---|---|---|
| P1 | Time budget (above): last touch is now, no overlap, 5-minute bank | Time compression, instant farming, two devices claiming the same minutes | **Yes** [V] |
| P2 | `addInteraction`'s own freshness, valve (40 SP/min) and daily cap (8 full, 4 at 25%, stop at 12) | Taps at any speed (0 SP/min: a tap pays nothing); machine-speed squeezing or stretching (held 0.3 to 0.45 s every 0.5 s: 4 to 5 SP/min, the 0.03 freshness floor); the best-cadence squeeze (1.8 s every 2.4 s), full stretches held 3 s back to back and squeeze-stretch cyclers all held to the valve, 40 SP/min (2026-10-06 rules after "short taps pay nothing", DESIGN 5.4) | **Yes** (the code itself) |
| P3 | Credits equal the meter counter (`earned` rose by exactly `add_credits`), `dayCapsules <= 12`, unopened plus new `<= 5`, `add_credits <= 3` | A host bug or a forged commit | **Yes** (SQL, `wh_bad_play`) [V] |
| P4 | Batch size 120, ordered `dtMs`, finite amounts, valid kinds | Junk, overflow | **Yes** [V] |
| P5 | Per-account call rate (for example 1 request per 2 s): add `wh_accounts.last_batch_at` and refuse earlier calls in `wh__commit_play` | Cost abuse (request floods) | **No** [proposed]; the time budget already makes floods pay nothing |
| P6 | Regularity score: the coefficient of variation of inter-touch intervals over 40 or more touches; a perfect cycler is under 0.02, a person is above about 0.15 [U: my estimate, unmeasured]. Action: set a `suspect` flag, pay at 25%, show it in the ops view, never ban automatically | Naive scripted cyclers | **No** [proposed] |
| P7 | Physical limits: more than 12 touches per second sustained, more than 3 pulls per second, a squeeze or pull hold longer than the gap since the previous touch plus 3 s (two fingers) | Fabricated spacing, fabricated holds (a stretch pays per second held since 2026-10-06; freshness already pays a pull reported 0.5 s after the last one only 3%) | **No** [proposed] |
| P8 | No cash value: capsules have no sale price and trade is same-tier only (DESIGN 5.4) | Removes most of the reason to farm | By design |

**Residual risk.** A randomised real-time macro at the physical limit earns the daily cap: 12 capsules a day against about 9 for a devoted human (DESIGN 5.4, after the taps stopped paying; it was about 10), so one macro account gains roughly a third over the keenest player. The real exposure is **many accounts**: every account is a new 12-capsule stream. That is why trading is gated (default off, 2 days and 10 capsules to start, 3 trades a day, 1 per partner a day: TRADE.md sections 6 and 9) and why the ops view watches account creation bursts and one-sided flows.

### 7.7 Concurrency, retries and failure

| Situation | What happens | Why nothing is lost or doubled |
|---|---|---|
| The response to a mutating call is lost; the client retries with the same `idem` | The host asks `wh__get_op` first and returns the stored answer | One row in `wh_ops` per `(user, idem)`; check-after-lock in every commit function [V] |
| Retry arrives while the first call is still running | The second blocks on the account row lock, then finds the stored answer | Same lock, same table [V: 20 parallel same-key calls, one execution] |
| The same `idem` with different arguments | `idem_reuse` | The arguments digest is stored with the key [V] |
| Two devices, or two tabs, act at once | One commits; the other gets `conflict`, the host re-reads and re-decides (fresh draws; the discarded roll was never shown to anyone) | `expect_version` [V: host retries after an injected concurrent bump] |
| A database lock cannot be taken within 3 s | `busy` (a retryable error), nothing written | `lock_timeout` on every function [V: a held lock fails fast, then the same call succeeds] |
| The host crashes before the commit | Nothing happened; the client retries | |
| The host crashes after the commit, before replying | The client retries and gets the stored answer | |
| The tab is closed while a capsule opens | The server already minted it. On the next load the item shows as unseen (a "NEW" dot) in the Hoard, with a "Replay reveal" button on its card | Result first, theatre second (DESIGN section 6) |
| The player is offline | Touches buffer for up to 5 minutes, the ring pauses with "Waiting for connection"; capsules wait; the Hoard is read-only | |
| Kill switch (`minting_enabled` false) | Every mint answers `frozen`; the Hoard stays readable | |
| The portal is an older build without `forgeflow:rpc` | The bridge state becomes `silent`; the game behaves as a guest | |
| The player's session expired | The portal's refresh fails; the call returns an error the game shows as "Sign in again" | |

**Retries live in memory; storage holds keys only** (see section 4, MERGE.md 6 and TRADE.md 8.4).

* **In the same session** a lost or timed-out call is retried by re-sending the request kept **in memory**, with the same key, for up to 5 minutes (3 tries with backoff). Memory cannot be read or written by another page, so this is safe.
* **Before sending**, the client appends `{kind, idem, acctTag, at}` to `pending` in storage. Never the item ids, the restock pick, the task id or the touches.
* **After a reload nothing is re-sent from storage.** The client keeps the keys younger than 10 minutes whose tag matches the signed-in account, asks `wh_op_status({idems})`, refreshes `wh_state` and `wh_inventory`, and clears `pending`. A key found there committed: its stored answer drives the UI (a capsule that opened shows its item as unseen with "Replay reveal"; a merge shows its result card). A key not found never committed, or is still running and will appear in the next inventory refresh; either way the player simply does it again, which for a merge, a Tidy-up, a restock pick or a trade means **a fresh confirmation in the current session**. A forged `pending` entry can therefore cause at most a status read of a key, never an action.
* **Touches not yet sent are lost on a reload or a crash** (at most one batch interval, 30 to 45 s, since batches are also sent on `visibilitychange: hidden` and before a capsule opens). The meter simply pays a little less; nothing is owed and nothing can be injected.
* **Trade operations are never retried after a reload**: the client re-fetches the trade and shows the review again.

### 7.8 Random source and what is logged

* The host passes a function to `rollCapsule` and `rollMerge`: `() => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296`, and records each value. The ledger row of a mint carries `detail.draws` (three numbers); a merge also carries the odds basis, the pity before and the odds digest (MERGE.md).
* **Replay** (audit): feed the logged draws back as the random function and call the same core function with the logged state. [V: 2000 of 2000 capsule rolls and 2000 of 2000 merge rolls reproduced exactly; a refused merge selection consumed zero draws.]
* A fresh seed per roll from `crypto` would also work, but a 32-bit `mulberry32` state is brute-forceable from any revealed output (the genome seed is one), and a function source avoids the question entirely.

### 7.9 Day boundary and clocks

The meter's day defaults to the UTC day; `daySeed(uid, dayKey, purpose)` takes the same day number. **The host takes the time and the day from the database clock** (`wh__read_state` returns `now_ms` and `server_day`), never from its own clock: a skewed Edge Function clock would otherwise place touches in the future (the commit function refuses that with `wh_bad_play`) or pick the wrong restock day near midnight. `deps.now` in the reference host is a test seam only [V: a host with no injected clock accepted a batch and a restock]. `wh_state` returns `server_day` to the client. The client must use `server_day` for restock and task display; a wrong device clock then changes nothing. If the owner prefers another boundary, change one constant in the host (`DAY_OFFSET_MS`, to be added) and one in the SQL day expressions. Restock offers and tasks are derivable by anyone who knows the account's UUID and the day (the seed is a hash of public strings); they are Common and Uncommon species and small tasks, so this is harmless [V: deterministic, 3 draws].

### 7.10 Tasks: how the server judges them

The draft only knows `kind`, `amount` and the meter's own detail, so each task metric in `TASK_DEFS` is judged from those. Counters are stored per day in `wh_accounts.task_progress` (aggregates only; no per-touch log is kept: children's data minimisation).

| Metric | Counted when | Notes |
|---|---|---|
| `pokes` | a poke (a tap; since "short taps pay nothing" of 2026-10-06 it pays no SP, but it still counts here, as it does for the statistics) that is not a double-tap; with no `param`, freshness at least 0.5 ("gentle": with the poke tau of 0.75 s, a gap of 0.53 s or more; the meter still reports `detail.freshness` and `detail.doubleTap` for a tap for this); with `param` p, at least p seconds since the previous poke ("calm pause") | A task capsule is the one thing a tap can still lead to (2 tasks offered a day, 5 a week): see ECON_NOTAP in the handoff reports |
| `squeezes` | a squeeze with hold at least `param` seconds (default 0.4) | "slow squeezes" p = 1, "long squeezes" p = 2 |
| `softPops` | longest streak of consecutive squeezes each held 1.8 s or more; a shorter squeeze resets it | my reading of "in a row" [U] |
| `medleys` | the meter paid a medley bonus (since 2026-10-06 "short taps pay nothing": a squeeze and a stretch within 12 s; a tap neither joins nor completes it) | The task text still says "Poke, squeeze and pull within twelve seconds": a poke in it is harmless but no longer needed |
| `snaps` | a pull with snap intensity at least 0.35 | |
| `stretch` | a pull with intensity at least `STRETCH_FULL_INTENSITY` (0.95) | Settled by physics round 2: a snap's intensity is the pull level, grab distance / the body's own family `maxPull` (1.0 at the limit, where the physics clamps), so every family can reach it. Only the stretchy family can reach twice its size, so the task reads "Stretch one as far as it will go" (id `stretch-double` kept, because offers are seeded by id). |

### 7.11 Account lifecycle

* **Bootstrap:** `wh_hello` (host) creates the row and the starter in one transaction and is safe to call every sign-in.
* **Deletion:** a `BEFORE DELETE` trigger on `auth.users` (Appendix A of TRADE.md) cancels the player's live trades, writes a `burn` ledger row for every live item and deletes the items; the ledger keeps the pseudonymous trail. [V] It fails loudly rather than orphan items: if it ever breaks, deleting a user errors until ops fixes it.
* **No change to `profiles` or the sign-up trigger.** `handle_new_user` is untouched; a user whose profile trigger failed still works (the WH tables reference `auth.users`, not `profiles`).

### 7.12 Telemetry (DESIGN risk 5: re-measure the minutes per capsule: 3.5 in the sim after "short taps pay nothing", DESIGN 5.4)

Aggregate only: per UTC day, buckets of (active minutes per capsule, capsules opened, touches by kind), with no user id in the aggregate table. A table like `wh_stats_daily(day, metric, bucket, n)` incremented by `wh__commit_play` is enough. It is not in the draft; add it with the first playtest (decision D-9 in NEXT_STEPS).

## 8. The portal bridge

### 8.1 Messages

| Message | Direction | Payload |
|---|---|---|
| `forgeflow:whoami` | game to portal | `{_reqId}` (existing) |
| `forgeflow:identity` | portal to game | `{_reqId?, signedIn, id, username, avatar_url, level}` (existing; also pushed on sign-in and sign-out). **The game must never display `username` or `avatar_url`**: `profiles.username` can be the local part of an email address (`handle_new_user` derives it from the email) [R]. |
| `forgeflow:rpc` | game to portal | `{_reqId, fn: 'wh_open_capsule', args: {...}}` |
| `forgeflow:rpc_result` | portal to game | `{_reqId, ok, data?, error?}` where `data` is the function's JSON and `error` is a short code |

### 8.2 Portal side (change to `src/lib/gameBridge.ts`; sketch, not written)

```ts
// slug -> function -> transport. ANYTHING not listed is refused: the portal must never become an open RPC proxy.
const GAME_RPC: Record<string, Record<string, 'sql' | 'host'>> = {
  wobblehoard: {
    wh_hello: 'host', wh_report_play: 'host', wh_open_capsule: 'host', wh_claim_restock: 'host', wh_complete_task: 'host', wh_merge: 'host', wh_tidy: 'host',
    wh_state: 'sql', wh_inventory: 'sql', wh_op_status: 'sql', wh_set_fav: 'sql', wh_mark_seen: 'sql', wh_handle_set: 'sql', wh_shelf_set: 'sql',
    wh_friend_code_get: 'sql', wh_friend_code_rotate: 'sql', wh_friend_redeem: 'sql', wh_friend_respond: 'sql', wh_friend_list: 'sql', wh_friend_shelf: 'sql', wh_friend_remove: 'sql',
    wh_listing_create: 'sql', wh_board_search: 'sql', wh_propose_trade: 'sql', wh_trade_view: 'sql', wh_counter_trade: 'sql', wh_confirm_trade: 'sql', wh_cancel_trade: 'sql',
    wh_trade_inbox: 'sql', wh_trade_emote: 'sql', wh_block: 'sql', wh_unblock: 'sql', wh_block_list: 'sql', wh_listing_cancel: 'sql', wh_report: 'sql',
  },
};
// = the 7 host operations + the 28 client RPCs of TRADE.md 7.2 (the same 28 that COLLECTION A.7 allows `authenticated` to execute).
// guard: slug must be the game CURRENTLY being played (currentGameSlug), the source frame check already in handleGameMessage applies,
// args JSON <= 16 KB, at most 8 calls per second per frame, `args.idem` present and well-formed for every mutating function.
// NOTE: this guard only covers calls made THROUGH the bridge. Every 'sql' function is executable by `authenticated`, so a player can call
// PostgREST directly with their own JWT and skip it. The real limits are server-side (TRADE.md 7.4): a request-body limit at the gateway or
// edge, the per-account buckets in the database, the host's own content-length check (7.2), and every function's own rules.
// 'sql'  -> supabase.rpc(fn, { p: args })           (the 0008 pattern: one jsonb parameter named p)
// 'host' -> supabase.functions.invoke('wh-api', { body: { fn, args } })   (the user's JWT is attached by supabase-js)
// reply  -> frame.contentWindow.postMessage({ type: 'forgeflow:rpc_result', _reqId, ok, data | error }, gameFrameOrigin)
```

* **Retries:** reuse the portal's existing `callStatsRpc` backoff (1, 2, 4 s on network, 429, 5xx) [R]; safe because every mutating call is idempotent. Never retry 4xx.
* **A guest** gets `{ok: false, error: 'not_signed_in'}` at once (as the stats messages do [R]).
* **The game side** (`bridge.ts`): one pending map keyed by `_reqId`, 15 s timeout per call (`noack` on timeout, which the sync engine treats as "unknown": it asks `wh_state` before assuming anything), only messages whose `ev.source === window.parent` are read.
* **Hardening for later (H1):** a portal-rendered confirm for trades, outside the iframe, so a compromised game build cannot confirm a trade programmatically (TRADE.md 12.6).
* **Deploy:** the portal is not auto-deployed. After the `gameBridge.ts` change run `pipeline/deploy_portal.py` [R: DEPLOY.md]; a game update goes through `upload_game.py`. Nothing in this lane deploys anything.

## 9. Hoard UI specification

Visual language: the felt cabinet from DESIGN section 2, tokens from `src/ui/theme.ts` (`--wh-ink`, `--wh-panel`, `--wh-cream`, `--wh-amber`, `--wh-lagoon`, `--wh-coral`, `--wh-edge`), system font stack with a heavy rounded weight (CONTRACT section 7), plain short English. Rarity is never colour-only: every tier shows its **gem shape** (circle, diamond, hexagon, 4-star, 6-star, 8-prism: `TIER_STYLE[tier].gem`), its **text label** and its frame colour.

### 9.1 Entry points and layout

* A HUD button "Hoard" (bottom centre) with the collection count "23 of 50"; keyboard `H`; closes with `Esc`. The panel is an overlay above the live stage; the play body keeps simulating underneath (paused when the panel covers the stage: `visibilitychange`-style pause is the shell's call).
* **Phone (under 640 px wide):** full-screen sheet, header 56 px, content scrolls vertically, detail card is a bottom sheet (70% height). **Desktop:** panel 880 px wide, detail card as a right column.
* Header: title, "23 of 50" with a progress bar (not colour-only: the number is text), tabs **Real** and **Practice** (Practice only appears if ghosts exist; for a guest it is the only tab), filters, sort, **Tidy up** (MERGE.md), close.

### 9.2 The cabinet: stacks by species

* Default view "cabinet": six tier shelves (Common to Mythic) in a vertical stack, each a row of plinths (CSS grid, `repeat(auto-fill, minmax(96px, 1fr))`, gap 8 px). Alternative "grid" view: one flat grid in catalog order. Both show **all 50** species so the shelf is a visible goal.
* **Plinth** (button, at least 88 by 112 px, hit area 44 px minimum): species thumbnail (section 9.8), name below in text (always), tier gem top-left (20 px), stack badge bottom-right "x3" when the player has 2 or more, a coral dot top-right for unseen, a small clock when every copy is locked, a heart when the keeper is hearted, a "shelf" mark when something of the stack is on the offer shelf (TRADE), a dashed frame for ghosts.
* **Unowned:** the plinth is dim (opacity 0.55 with 4.5:1 text contrast kept), shows a silhouette (the thumbnail tinted `--wh-edge`), the name and gem, and "Not yet". Names are shown because the board and the friend shelf talk in species icons and the player needs to know what to look for.
* **Filters** (chips, multi-select, 44 px high): tier (six chips each with the gem and the word), "feel" lane (Jelly, Fill, Chew, Foam, Dough, Rubber: the six lanes of `LANES`; the twelve families appear on the card), toggles **Only spares**, **Only missing**, **On my shelf**, **Hearts**. A chip count "(3)" shows how many species match. State persists in `prefs`.
* **Sort:** Tier (default), Newest, Name, Most spares, Collection order.
* **Spare badges:** the plinth shows "x3"; the card shows "2 spare". A tier row that is complete shows a quiet "Row complete" tag; the fixed cosmetic reward (DESIGN 5.11) is the shelf light, never an item.

### 9.3 The detail card with the live squishy

Tapping a plinth opens the card and loads that stack's keeper into the main stage: `stage.setBody(createBody(genome), genome)` and `stage.setBodyTier(id, tier)` (render contract in `contracts.ts`), so **the squishy on the card is the live soft body, pokeable, squeezable and pullable** with the slice-1 gestures. Those touches feed the meter exactly as on the main screen. `app.ts` owns the body and the stage, so the UI does not call them directly: the SHELL lane adds one small method to `App` (for example `focusInstance(genome, tier)` and `restorePrimary()`), and the Hoard calls that.

* Content: name (catalog name, or the optional nickname from the fixed list), tier gem and label, family and a one-line touch feel (catalog `blurb`, family text from `materials.ts`), the public odds "Appears in 0.60% of capsules" (`oddsPerSpecies`), and the instance strip: one swatch per copy showing that copy's unique look; selecting one swaps the live body to that instance. Each swatch shows: heart (keeper marker), "On shelf", a clock with "free in 6 h" if locked, "traded 2x", and the origin (Capsule, Merge, Restock, Task, Starter, Practice).
* Actions: **Heart** (protects from merge, Tidy-up and trade; also removes from the shelf), **Merge** (visible when the stack has `MERGE_COST` or more copies; opens MERGE.md's panel with this stack selected), **Put on shelf** (TRADE.md), **Replay reveal** (only for items still unseen), **Nickname** (a pick from the 24-name list in `ui/names.ts`, never free text).
* Close returns the player's previous squishy to the table. Opening the card never costs anything and never starts a timer.

### 9.4 The capsule table (queue of up to 5)

* On load and after sign-in, each unopened credit becomes a capsule object, **staggered 150 ms apart**: `stage.dropCapsule({ onLand })` (neutral translucent shell; the tier is never spoiled by the shell: DESIGN 6.3). Up to 5; the HUD ring shows "x3" beside it.
* Open by holding the capsule 0.5 s or tapping it (DESIGN 6.3). **DOM twin for keyboard and screen readers:** a button "Open a capsule (3 waiting)" in the HUD does the same call; the 3D object alone is never the only way.
* Sequence (result first, section 10): press starts `setSqueeze`, the call `wh_open_capsule` goes out at once, the squeeze continues until the answer arrives, then the reveal plays with the server's item. If the answer takes over 1.5 s the capsule keeps wobbling; at 10 s it stops and says "Still working. Your capsule is safe." and the client asks `wh_state`.
* **Table full (5):** the ring shows a quiet "Table full: open one to keep going" (aria-live polite, once). No timer, no guilt.

### 9.5 Restock: pick one of three

A HUD chip "Daily gift" glows softly when unclaimed (no countdown, no expiry text, no accumulation: DESIGN 8.4). It opens a shelf of three plinths in `restockDisplayOrder` (species you lack first, higher tier first). Each shows thumbnail, name, gem, and "New to you" or "You have 2". The player taps one, then **Take this one**. The server confirms; a repeat Common or Uncommon plays the 0.8 s quick reveal, a new species plays the full reveal. After claiming, the chip reads "Come back tomorrow" and is quiet.

### 9.6 Tasks

A "Today" panel with the two tasks of the day (`dailyTasks`): plain text, a progress bar and a number ("3 of 5"), driven by the server's counters with a local preview in between. When done: **Collect capsule**. After 5 tasks in a week the panel says "That's all the tasks for this week" with no streak, no loss language. Tasks are style-neutral (any hand can do any of them).

### 9.7 Meter ring and capsule drop hooks

* **Ring:** around the HUD gem, `meterFill(previewMeter)`. The preview runs the same `addInteraction` as the server on the client's own touches and is **reconciled** on every `wh_report_play` reply: `preview = fold(addInteraction, serverMeter, unackedEvents)`; the ring eases to the corrected value over 400 ms, never jumps backwards visibly by more than the unacked events.
* **At 100%:** one ring pulse (400 ms, ease-out, single, never repeating), `audio.meterFull?.({ quiet })` (quieter mid-squeeze), `stage.dropCapsule?.()`, haptic ticks (DESIGN 6.2). Reduced motion: the capsule fades in at the HUD instead of dropping.
* **States:** normal; **resting** ("Squishies are resting, filling slowly": daily rate 25%, tinted dim, announced once politely); **done for today** ("They'll be ready tomorrow", the 12-a-day hard stop: the ring stays full of tomorrow, nothing lost); **table full**; **offline** ("Waiting for connection", the ring keeps previewing and the touches buffer for up to 5 minutes).
* **Mapping `SoftEvent` to `Interaction`** (DESIGN 5.4; `meterfeed.ts`): `poke` becomes a poke (a tap: it pays 0 SP since "short taps pay nothing", 2026-10-06, but it is still reported and still counts for the tasks and the statistics); `release` with `heldFor >= 0.4` becomes a squeeze with `amount = heldFor`; `snap` becomes a pull with `amount = intensity` (the pull level) and `heldS = heldFor` (the seconds from the grab to the release, 0 to 10 s): at a level of 0.35 or more the meter pays per second held, below that the flat "never stretched" rate (the meter handles the rate: pass the intensity as is). Contact times are kept as `dtMs` offsets from the first event of the batch; a pull's hold rides as a 4th element.
* **Pending arc** (FUN.md 2.2, 2026-10-06): while a squeeze or a stretch is held, the ring shows a lighter arc of `collection.previewTouch(kind, heldS, level)`, the SP that touch would pay if it ended now (core `previewInteraction`: pay, freshness, a medley it would complete, the daily rate, the valve's room; 0 on a full table, and 0 for a tap: `previewTouch('poke', ...)` is 0 and so is a squeeze held under 0.4 s). It banks exactly that on the release unless another touch lands first. Pure and allocation-free; the real ledger's preview meter has the same `pending(it)`.

### 9.8 Species icons

The board and the friend shelf talk in icons, so all 50 species need a small image. Nothing is pre-rendered art (the project ships no image assets): `speciesIcon.ts` renders `speciesTemplateGenome(id)` once through the stage into a 96 px `OffscreenCanvas` or `ImageBitmap` and caches it in memory (50 images of 96 by 96 by 4 bytes are 1.8 MB; render lazily as plinths scroll in). **[U]** the cost per icon at `low` quality is unmeasured; budget a spike. **Fallback** if a render fails or is not ready: the tier gem on a flat tint of the species colour with the first letter. This is a dependency on the render lane (a `renderIcon(genome, px)` helper); until it exists, ship the fallback.

### 9.9 Empty, error and offline states (copy is plain English; no blame)

| State | Where | Copy | Behaviour |
|---|---|---|---|
| First run, no capsules | Hoard | "One squishy so far. Squish to earn capsules." | Hint toward the stage |
| Practice only (guest) | Hoard | "Practice shelf. These live on this device." + chip "Sign in to keep real squishies and trade." | Dismissible |
| No spares | Merge button | "No spares yet" | Disabled with a reason in text |
| Offline, signed in | Banner | "Offline. Your Hoard is read-only until we reconnect." | Ring previews; capsules wait |
| Server busy | Toast | "Busy for a moment. Trying again." | Auto retry with the same key, 3 tries |
| `frozen` | Banner | "Capsules are paused for a short while." | Read-only Hoard |
| `no_capsule` | Capsule melts | "That one fizzled. Keep squishing." | Ring resumes |
| `queue_full` | Ring | "Table full: open one to keep going." | |
| `not_signed_in` | Toast | "Sign in again to keep going." | |
| `idem_reuse`, `bad_payload`, `no_account` | Developer error | "Something went wrong. Reload and try again." + console detail | Log once |
| Save unreadable | Toast | "Your practice shelf could not be read. A copy was kept." | Parked blob |
| Stale mirror | Hoard | "Showing your last saved Hoard" | Refresh in the background |

Error codes shared with MERGE.md and TRADE.md are in TRADE.md section 7.3 with the same copy.

### 9.10 Accessibility

* **Keyboard:** the plinth grid is a roving-tabindex grid (arrows move, `Enter` or `Space` opens the card, `Esc` closes it, then the panel); the card and the sheet trap focus and return it to the plinth that opened them. Skip link "Skip to the card". The capsule has the DOM twin (9.4). No gesture is the only way: hold-to-open also opens on `Enter` held 0.5 s or a single tap.
* **Screen readers:** each plinth has an accessible name such as "Dollop, Common, 3 copies, 2 spare, new". Counts are text, not only badges. A polite live region announces "A capsule is ready", "Table full", "Resting", "Reconnected". The ring has `role="meter"` with `aria-valuenow` as a percentage and a text label.
* **Targets and contrast:** targets at least 44 by 44 px; text at least 4.5:1 and focus rings 3:1 using the existing pairs in `theme.ts` `CONTRAST_PAIRS` (extend that list for the new surfaces and let `probe_app.ts` assert them).
* **Motion and light:** all motion obeys Calm effects and `prefers-reduced-motion` (DESIGN 6.6); no flashing; the capsule drop becomes a fade; the ring pulse is removed under Calm.
* **Text size:** the layout survives 200% text; labels wrap, never truncate the count.
* **Colour-blind safe:** gem shape plus text label plus frame; the unseen dot is paired with the text "New" for screen readers.

## 10. Ceremony hooks (link only)

The reveal and the sounds are DESIGN section 6 and the render and audio lanes' work; this module only calls them, in this order, **result first, theatre second**:

```ts
const r = await collection.openCapsule();                  // 1. the server decides and has already written the item
if (!r.ok) return showError(r.error);                      // 2. nothing to animate on failure
const genome = decodeGenome(r.genome_code)!;               // 3. the genome is the server's, not a client roll
const spec: CapsuleRevealSpec = { result: { genome, tier: tierName(r.tier_idx), isNew: r.is_new },
  createBody: (g) => new SoftBody(g), capsule: dockedCapsule, quick: !r.is_new && r.tier_idx <= 1 };
const handle = stage.playCapsuleReveal?.(spec, { onBeat });   // 4. render lane: 'grab' | 'crack' | 'burst' | 'reveal' | 'settle'
audio.capsuleBeat?.({ beat: 'burst', tier });              // 5. audio lane, fired from onBeat; reveal() for the tier motif
await handle?.done;                                        // skippable after 350 ms; the result is never hidden
collection.markSeen([r.item_id]);                          // 6. the unseen dot clears
```

Every `stage.*` and `audio.*` member used here is optional in `contracts.ts`; feature-detect and fall back to the plain reveal card if absent. The capsule drop uses `stage.dropCapsule`, `audio.meterFull`. Do not redefine any of these types.

## 11. Acceptance tests

IDs map to probes and manual checks. "Probe" means a plain-node file in `_harness/` (the `npm run probe` pattern: `probe_*.ts` run under `node` with type stripping).

**Local store and stacks (probe `probe_collection.ts`)**

| ID | Check |
|---|---|
| C01 | A v1 profile migrates to a v2 save with the starter as ghost one (same id); the v1 key is byte-identical afterwards |
| C02 | A corrupt v2 blob is parked in the `.unreadable` key and the app boots on a fresh save; a `v: 3` blob is read-only and never overwritten |
| C03 | Every row is validated on load: a bad genome code, an unknown species, an oversized id, a negative count are dropped; nothing throws |
| C04 | `buildStacks`: the copies sum to the item count; `spares = copies - 1`; the keeper is the first hearted else the oldest; shuffling the input changes nothing; real and ghost items never share a stack |
| C05 | Account switch and sign-out remove the mirror and the pending ops of the old account; prefs and ghosts stay |
| C06 | 331 items serialise to under 40 KB and 1000 to under 110 KB (compact rows) |
| C07 | `meterfeed`: the mapping table of section 9.7 on synthetic `SoftEvent`s (a snap's hold included); the batch builder never exceeds 120 events or reorders `dtMs`, and a pull carries its clamped hold |
| C08 | The preview meter reconciles: for random streams, `fold(addInteraction, serverMeter, unacked)` equals the server meter when nothing is unacked; the pending preview (`previewTouch`, `pending`) equals what the touch then pays, and allocates nothing |
| C09 | No outgoing message ever contains a ghost id (scan every `forgeflow:rpc` the fake bridge sees) |
| C10 | `probe_collection_imports.ts`: the import rules of section 3.2 hold |
| C11 | Hostile storage: a save whose `pending` holds forged entries (with or without extra fields such as item ids, picks or touches) makes the client send nothing on load except one `wh_op_status` with keys; a merge, Tidy-up, restock or trade is never sent without a fresh in-session confirmation |
| C12 | The stored mirror never contains the portal's auth id (only `acctTag`); switching accounts with a forged tag wipes the mirror |

**Server (the Appendix C host suite is the template; the SQL suite is TRADE.md Appendix C)**

| ID | Check | Status |
|---|---|---|
| S01 | Bootstrap creates one account and exactly one starter; a second call creates nothing | [V] |
| S02 | A forged 24-minute stream in 12 batches earns 2 capsules, not 9; replaying a batch returns the stored answer; bad payloads refused | [V] |
| S03 | Credits equal the meter counter and never exceed the table of 5 | [V] |
| S04 | 300 capsules opened: every roll passes the SQL integrity checks (species byte, seed, tier); tier mix plausible against 76.3 / 13 / 6 / 2.8 / 1.4 / 0.5 | [V] |
| S05 | The same idempotency key opens one capsule; 10 parallel opens with one credit succeed once | [V] |
| S06 | Restock: only an offered species is accepted, once a day; the item has origin `restock` | [V] |
| S07 | Tasks: refused until the server's counters say done; once a day each; 5 a week; the capsule opens as origin `task` | [V] |
| S08 | A bad host roll (wrong tier, species byte, seed) rolls everything back loudly | [V] |
| S09 | Direct inserts, updates, deletes and reads of other tables answer 42501; the commit functions are not callable by players | [V] |
| S10 | Kill switch `minting_enabled` false: every mint answers `frozen` | [partly V: trading flag tested; minting flag shares `wh__flag`] |
| S11 | Replay audit: for logged draws, `rollCapsule` and `rollMerge` reproduce the stored species and tier | [V] |
| S12 | `probe_server_vendor.ts`: the vendored `_shared/wh/core` and `data` hash equal the game's | to build |
| S13 | `wh_config` seeds equal the TypeScript constants (`merge_cost`, caps, lock hours) | to build |
| S14 | A real Supabase project: the same suites through PostgREST and the Edge Function | **not run** |
| S15 | The migration's privilege audit (A.0, A.7) passes on the migration as written and fails it on a schema-wide revoke, a callable helper, a usable WH sequence or an extra table grant | [V 2026-10-05, scratch database] |
| S16 | Tidy-up with a 64-character key runs every merge under its own sub-key; a retry replays all of them | [V 2026-10-05, host suite] |
| S17 | `wh_op_status` answers only the caller's own keys, from stored answers, and refuses junk | [V 2026-10-05, TRADE.md T17] |

**UI (browser harness in the style of `_harness/browser_shell.mjs`; screenshots to `_shots/`)**

| ID | Check |
|---|---|
| U01 | The Hoard shows all 50 plinths in cabinet and grid views; unowned plinths are dim with names |
| U02 | Filters and sorts change the visible set; the chip counts are right; prefs persist |
| U03 | The detail card loads the keeper as the live body; a synthetic poke changes `metrics`; swapping instances changes the genome hash |
| U04 | Keyboard only: open the Hoard, move through plinths, open a card, heart a copy, open a capsule through its DOM twin, close with Esc; focus returns correctly |
| U05 | 390 by 844 touch emulation: no horizontal scroll; every target at least 44 px; the sheet scrolls |
| U06 | Reduced motion: the capsule fades in; no pulses; Calm effects on |
| U07 | Offline: the banner appears, the ring keeps previewing, no error toast storm |
| U08 | A Hoard of 331 items opens in under 300 ms and scrolls at 60 fps on the reference phone profile [U targets] |
| U09 | Contrast pairs for every new surface pass `probe_app.ts` |

## 12. Work breakdown (rough, one engineer; sizes are my estimates [U])

| # | Work | Size | Depends on |
|---|---|---|---|
| 1 | `store.ts`, `stacks.ts`, migration, probes C01 to C06 | M, 3 to 4 days | slice 1 |
| 2 | `meterfeed.ts`, preview meter, `ghost.ts` (practice economy), probes C07 C08 | M, 3 days | 1 |
| 3 | Hoard UI: cabinet, plinths, filters, sort, detail card with the live body, empty and error states, accessibility | L, 8 to 10 days | 1, 2, species icons |
| 4 | Species icon atlas (render lane helper plus fallback) | S to M, 2 days plus a spike | render lane |
| 5 | Capsule table, restock and tasks UI, ceremony wiring (sections 9.4 to 9.7, 10) | M, 3 to 4 days | 3, render and audio ceremonies |
| 6 | Migration `00NN_wobblehoard_mint.sql`: tables, helpers, commit functions, RLS, self-test DO block in the 0008 style (a subset of the SQL suite that fits one transaction) | M, 4 days | owner applies by hand |
| 7 | Host: `wh-api` Edge Function, vendor script and hash probe, config parity probe | M, 4 to 5 days | 6 |
| 8 | Portal: `forgeflow:rpc` handler, allowlist, deploy | S to M, 2 to 3 days | owner deploys the portal |
| 9 | `bridge.ts`, `api.ts`, `sync.ts`, pending ops, reconcile; wire to the UI | M, 4 days | 7, 8 |
| 10 | Staging project, run the two suites against it, fix drift | M, 3 days | 6 to 9 |
| 11 | Telemetry table and the aggregate ops queries (TRADE.md section 14) | S, 1 to 2 days | 6 |
| **Total** | | **about 40 to 50 engineer-days** before MERGE and TRADE | |

Steps 1 to 5 need no server and can ship first as a practice-only Hoard.

## 13. Unverified claims and open questions

* **Not in the draft, needed before launch:** the scheduled jobs: the daily call to `wh__purge()` (the function is in the draft [V]: `wh_ops` 30 days and play batches 1 day, finished trade events 13 months, reports 12 months, idle rate buckets 1 day) and the hourly conservation check (TRADE.md 14.3); a per-account rate limit on the host operations (P5; the `wh__take` bucket of TRADE.md 7.4 can serve).
* **Not run anywhere real:** Supabase (RLS through PostgREST, `SECURITY DEFINER` ownership, default privileges as the stub imitates them), Edge Functions, Deno import behaviour, the portal bridge, every UI.
* **[G]** Supabase Edge Function limits and pricing; Deno accepting `.ts` relative imports; `supabase functions deploy` bundling files outside `supabase/functions`; localStorage quota (about 5 MB); that anonymous sign-ins exist (see NEXT_STEPS D-4).
* **[U]** the 5-minute bank and the 5-capsule table cap are my numbers; the regularity thresholds in P6 are guesses; `STRETCH_2X_INTENSITY`; icon render cost; the sizes in section 12.
* The slice-1 `app.ts` notes the real body's stretch tops out near 0.3 and its release intensities run 0.35 to 0.57; the meter's thresholds (0.4 s hold, 0.35 snap) assume those (DESIGN risk 12). `probe_economy.ts` now prints the snap intensity of scripted pulls on the current body (informative): on 2026-10-05, 0.31 at 1.5 x the rest radius and 0.41 at 2.2 x. Since physics round 2 the snap intensity is the pull level (1.0 = the family's maxPull): on 2026-10-06 the starter read 0.28 at 0.5 x, 0.56 at 1.0 x, 0.84 at 1.5 x and 1.00 at 2.2 x, so 0.35 means "pulled about a third of the way". Re-measure with the real meter on a device.
* **The 2026-10-05 revisions** (the scoped revocation and the privilege audit of A.0, A.2 and A.7, `wh_op_status`, the `wh_rate` buckets, the Tidy-up sub-key and its host check) **ran on a scratch PostgreSQL 16 only** (170/170 SQL, 37/37 host, 2026-10-05 [V]). Re-run both suites after any edit to an appendix, and on staging before the migration is applied anywhere (gate G9).
* **[G/U]** whether the Supabase API gateway can be given a request-body limit for PostgREST calls, and what its default is (TRADE.md 7.4).
* **Owner questions** that this module depends on are collected in `NEXT_STEPS.md`: hosting (D-6), age gating (D-5), account requirements (D-4), telemetry (D-9).

---

## Appendix A. Draft SQL (NOT APPLIED; verified on local PostgreSQL 16 with a stub on 2026-10-02, and after the revisions on 2026-10-05)

Split into the order it would be one migration file, inside one `begin; ... commit;` with a self-test DO block at the end in the style of `0008_blocktooth_stats.sql`. The social and trade tables and functions are in `TRADE.md` Appendix A and the merge commit function in `MERGE.md` Appendix A. **One migration is recommended**, in this order (each step needs the ones before it):

1. A.0 here (the privilege snapshot: the first statement after `begin;`), 2. A.1 here, 3. TRADE A.1 (social and trade tables, `wh_rate`), 4. A.2 here (= TRADE A.1b: RLS, grants, config), 5. A.3 to A.6 here, 6. MERGE Appendix A, 7. TRADE A.2 to A.4, 8. A.7 here (the privilege audit: the last statement before `commit;`). The ops pack (TRADE A.5) is not part of the migration.

If the owner splits it into two files, each file gets its own A.0 and A.7, and A.2's revoke list names only the objects that file creates. Names, signatures and error codes are the contract; bodies are drafts.

### A.0 Privilege snapshot (the first statement of the migration)

```sql
-- 0. Snapshot the privileges, RLS flag and policy count of every EXISTING object in public that is not WH's (the portal's tables, views,
--    sequences and functions: games, profiles, game_saves, leaderboards, friendships, df_*, bt_* ...), so A.7 can prove this migration changed
--    none of them. A plain table (not a temp table) so the snapshot also survives when the appendices are loaded as separate files in a test;
--    A.7 drops it. Its name starts with wh_, so it is not part of what it snapshots.
create table public.wh__acl_before as
  select 'rel:' || c.oid::regclass::text as obj,
         coalesce(c.relacl::text, '<default>') || ' rls=' || c.relrowsecurity::text
           || ' policies=' || (select count(*) from pg_policy pol where pol.polrelid = c.oid)::text as acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname not like 'wh\_%'
  union all
  select 'fn:' || p.oid::regprocedure::text, coalesce(p.proacl::text, '<default>')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like 'wh\_%';
```

### A.1 Tables: reference, accounts, items, capsules, idempotency, ledger

```sql
-- 1. reference + config -------------------------------------------------------------------------------------------
create table public.wh_species (
  idx      smallint primary key check (idx between 0 and 255),
  id       text not null unique check (id ~ '^[a-z]{3,24}$'),
  tier_idx smallint not null check (tier_idx between 0 and 5)
);
create table public.wh_config (
  key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);

-- 2. accounts -----------------------------------------------------------------------------------------------------
create table public.wh_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  public_id          text not null unique check (public_id ~ '^[0-9a-f]{12}$'),   -- the ONLY id other players ever see
  version            integer not null default 0,                                     -- bumped by every state change of this account
  created_at         timestamptz not null default now(),
  meter              jsonb not null default '{}'::jsonb,                             -- src/core/meter.ts MeterState
  last_event_ms      bigint not null default 0,                                      -- server-clock ms of the last accepted touch
  merge_pity         smallint[] not null default '{0,0,0,0,0,0}' check (cardinality(merge_pity) = 6),
  merges_day         integer not null default 0,
  merges_today       smallint not null default 0,
  restock_day        integer,
  restock_pick       smallint references public.wh_species(idx),
  task_state         jsonb not null default '{}'::jsonb,                             -- drops.ts TaskState
  task_progress      jsonb not null default '{}'::jsonb,                             -- today's counters
  capsules_opened    integer not null default 0,
  trade_enabled      boolean not null default false,                                 -- default OFF: age/consent decision is the owner's
  restricted_until   timestamptz,                                                    -- a moderation hold: pauses trading and every social surface
  auto_hold_at       timestamptz,                                                    -- start of the last AUTOMATIC report hold (TRADE 13): reports filed before it never count again
  hold_reviewed_at   timestamptz,                                                    -- set by ops when a person has reviewed a hold; a second automatic hold needs it
  handle_adj         smallint, handle_noun smallint, handle_num smallint, handle_changed_at timestamptz,
  redeem_window_at   timestamptz, redeem_attempts smallint not null default 0
);

create unique index wh_accounts_handle on public.wh_accounts (handle_adj, handle_noun, handle_num) where handle_adj is not null;

-- 3. items --------------------------------------------------------------------------------------------------------
create table public.wh_items (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.wh_accounts(user_id) on delete restrict,
  species_idx    smallint not null references public.wh_species(idx),
  tier_idx       smallint not null check (tier_idx between 0 and 5),
  genome_code    text not null check (genome_code ~ '^g1\.[A-Za-z0-9_-]{35}$'),
  genome_seed    bigint not null check (genome_seed between 0 and 4294967295),
  origin         text not null check (origin in ('starter','drop','task','restock','blend')),
  parents        uuid[],
  born_at        timestamptz not null default now(),
  trade_count    integer not null default 0,
  version        integer not null default 0,
  locked_until   timestamptz,
  reserved_trade_id uuid,
  fav            boolean not null default false,
  offered_at     timestamptz,
  seen_at        timestamptz,
  consumed_at    timestamptz,
  consumed_by    uuid,
  check ((origin = 'blend') = (parents is not null))
);
create index wh_items_owner on public.wh_items (owner_id) where consumed_at is null;
create index wh_items_owner_species on public.wh_items (owner_id, species_idx) where consumed_at is null;
create index wh_items_reserved on public.wh_items (reserved_trade_id) where reserved_trade_id is not null;
create index wh_items_offered on public.wh_items (tier_idx, species_idx) where offered_at is not null and consumed_at is null;

create table public.wh_capsules (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null,                                   -- strict FIFO: capsules open in the order they were earned
  owner_id uuid not null references public.wh_accounts(user_id) on delete cascade,
  source text not null check (source in ('play','task')),
  earned_at timestamptz not null default now(),
  opened_at timestamptz, item_id uuid
);
create index wh_capsules_queue on public.wh_capsules (owner_id, seq) where opened_at is null;

-- 4. idempotency + ledger -----------------------------------------------------------------------------------------
create table public.wh_ops (
  user_id uuid not null, idem text not null check (idem ~ '^[A-Za-z0-9_-]{16,64}$'),
  op text not null, args_digest text not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key (user_id, idem)
);
create index wh_ops_age on public.wh_ops (created_at);

create table public.wh_ledger (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('mint','consume','transfer','burn')),
  item_id uuid not null,
  from_user uuid, to_user uuid,                                   -- no FK on purpose: survive account deletion, pseudonymous afterwards
  ref_kind text not null check (ref_kind in ('capsule','restock','task','starter','merge','trade','admin','account_delete')),
  ref_id uuid, detail jsonb
);
create index wh_ledger_item on public.wh_ledger (item_id, id);
create index wh_ledger_ref on public.wh_ledger (ref_kind, ref_id);
create function public.wh__ledger_immutable() returns trigger language plpgsql as $$ begin raise exception 'wh_ledger is append-only'; end $$;
create trigger wh_ledger_no_update before update or delete on public.wh_ledger for each row execute function public.wh__ledger_immutable();
revoke all on function public.wh__ledger_immutable() from public, anon, authenticated;
```

### A.2 Row level security, grants, config seeds (covers the TRADE tables too)

```sql
-- 6. direct access: RLS on, writes revoked, narrow own-row reads --------------------------------------------------
alter table public.wh_species enable row level security;      alter table public.wh_config enable row level security;
alter table public.wh_accounts enable row level security;     alter table public.wh_items enable row level security;
alter table public.wh_capsules enable row level security;     alter table public.wh_ops enable row level security;
alter table public.wh_ledger enable row level security;       alter table public.wh_friend_codes enable row level security;
alter table public.wh_friend_requests enable row level security; alter table public.wh_friends enable row level security;
alter table public.wh_blocks enable row level security;       alter table public.wh_reports enable row level security;
alter table public.wh_listings enable row level security;     alter table public.wh_trades enable row level security;
alter table public.wh_trade_items enable row level security;  alter table public.wh_trade_events enable row level security;
alter table public.wh_rate enable row level security;

create policy wh_species_read  on public.wh_species  for select using (true);
create policy wh_accounts_own  on public.wh_accounts for select using (user_id = auth.uid());
create policy wh_items_own     on public.wh_items    for select using (owner_id = auth.uid());
create policy wh_capsules_own  on public.wh_capsules for select using (owner_id = auth.uid());
-- wh_blocks and wh_trades carry the OTHER player's auth id, so a direct select would break the privacy design: they have NO client policy and no grant, like every table below.
-- wh_ops, wh_ledger, wh_config, wh_reports, wh_friend_*, wh_listings, wh_trade_items, wh_trade_events, wh_blocks, wh_trades, wh_rate: RPC only.

-- Supabase's default privileges GRANT ALL on every new public table and sequence to anon and authenticated: take that back on the WH objects
-- ONLY, BY NAME, as 0008 does for bt_*. NEVER "revoke ... on all tables in schema public": that strips the portal's own grants too (games,
-- profiles, game_saves, leaderboards, friendships, df_*, bt_*) and breaks the whole site (found by the 2026-10-05 audit in the earlier draft).
-- COLLECTION A.7 fails the migration if any non-WH privilege changed, and if a WH table or sequence is missing from these lists.
revoke all on table public.wh_species, public.wh_config, public.wh_accounts, public.wh_items, public.wh_capsules, public.wh_ops, public.wh_ledger,
  public.wh_friend_codes, public.wh_friend_requests, public.wh_friends, public.wh_blocks, public.wh_reports, public.wh_listings,
  public.wh_trades, public.wh_trade_items, public.wh_trade_events, public.wh_rate from anon, authenticated;
revoke all on sequence public.wh_capsules_seq_seq, public.wh_ledger_id_seq, public.wh_reports_id_seq from anon, authenticated;
grant select on public.wh_species, public.wh_accounts, public.wh_items, public.wh_capsules to authenticated;
grant select on public.wh_species to anon;

insert into public.wh_config(key, value) values
  ('minting_enabled','true'), ('merging_enabled','true'), ('trading_enabled','true'), ('board_enabled','true'),
  ('merge_cost','2'), ('merge_daily_cap','10'), ('merge_lock_hours','24'), ('receive_lock_hours','24'),
  ('trade_daily_cap','3'), ('trade_pair_cap','1'), ('trade_confirm_cooldown_s','5'), ('trade_ttl_async_h','24'), ('trade_ttl_live_s','60'),
  ('new_account_days','2'), ('new_account_capsules','10'),
  ('rate_offer','{"cap": 30, "per_s": 0.1}'), ('rate_search','{"cap": 30, "per_s": 0.5}');      -- per-account token buckets (TRADE 7.4)
```

### A.3 Helpers

```sql
create function public.wh__flag(p_key text) returns boolean language sql stable set search_path = public as
$$ select coalesce((select value = 'true'::jsonb from public.wh_config where key = p_key), false) $$;

create function public.wh__cfg_int(p_key text, p_default integer) returns integer language sql stable set search_path = public as
$$ select coalesce((select (value #>> '{}')::integer from public.wh_config where key = p_key), p_default) $$;

-- is this item reservation held by a LIVE trade? (lazy expiry: no cron needed; an expired trade frees its items by itself)
create function public.wh__res_free(p_res uuid, p_trade uuid) returns boolean language sql stable set search_path = public as
$$ select p_res is null or (p_trade is not null and p_res = p_trade)
       or not exists (select 1 from public.wh_trades t where t.id = p_res and t.status in ('proposed','countered') and t.expires_at > now()) $$;

create function public.wh__blocked(a uuid, b uuid) returns boolean language sql stable set search_path = public as
$$ select exists (select 1 from public.wh_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a)) $$;

create function public.wh__are_friends(a uuid, b uuid) returns boolean language sql stable set search_path = public as
$$ select exists (select 1 from public.wh_friends where user_lo = least(a, b) and user_hi = greatest(a, b)) $$;

-- a g1. share string must decode to 26 bytes, version 1, and carry the species byte and seed the host claims (cheap SQL-side integrity check)
create function public.wh__genome_ok(p_code text, p_species smallint, p_seed bigint) returns boolean language plpgsql immutable set search_path = public as $$
declare b bytea;
begin
  if p_code !~ '^g1\.[A-Za-z0-9_-]{35}$' then return false; end if;
  b := decode(rpad(translate(substr(p_code, 4), '-_', '+/'), 36, '='), 'base64');
  return length(b) = 26 and get_byte(b, 0) = 1 and get_byte(b, 1) = p_species
     and (get_byte(b, 4)::bigint + (get_byte(b, 5)::bigint << 8) + (get_byte(b, 6)::bigint << 16) + (get_byte(b, 7)::bigint << 24)) = p_seed;
exception when others then return false;
end $$;

-- The helpers above are plain functions the definer functions call. Supabase grants EXECUTE on every new function to anon and authenticated, so take it back:
-- left open, wh__are_friends(a, b) and wh__blocked(a, b) would let any signed-in player probe the friendships and blocks of ANY two accounts by auth id,
-- and auth ids are world-readable through the portal's profiles table. (Found by reviewing my own draft; checked [V] below.)
revoke all on function public.wh__flag(text), public.wh__cfg_int(text, integer), public.wh__res_free(uuid, uuid), public.wh__blocked(uuid, uuid), public.wh__are_friends(uuid, uuid) from public, anon, authenticated;
```

### A.4 Open one capsule (the commit function)

```sql
-- ---- opening one capsule: the HOST rolled (src/core/drops.ts rollCapsule, CSPRNG draws); this function only validates and writes ----
create function public.wh__commit_open_capsule(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := (p->>'uid')::uuid; v_idem text := p->>'idem'; v_digest text := p->>'args_digest';
  a public.wh_accounts%rowtype; v_prev public.wh_ops%rowtype; v_cap public.wh_capsules%rowtype;
  v_sp smallint := (p->>'species_idx')::smallint; v_tier smallint := (p->>'tier_idx')::smallint; v_seed bigint := (p->>'genome_seed')::bigint;
  v_code text := p->>'genome_code'; v_def public.wh_species%rowtype; v_item uuid := gen_random_uuid(); v_before integer; v_res jsonb;
begin
  if not public.wh__flag('minting_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'open_capsule' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if a.version <> (p->>'expect_version')::integer then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  select * into v_cap from public.wh_capsules where owner_id = v_uid and opened_at is null order by seq limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_capsule'); end if;
  select * into v_def from public.wh_species where idx = v_sp;
  if not found or v_def.tier_idx <> v_tier or not public.wh__genome_ok(v_code, v_sp, v_seed) then
    raise exception 'wh_bad_roll' using errcode = 'P0001';       -- a host bug: roll back everything, loudly
  end if;
  select count(*) into v_before from public.wh_items where owner_id = v_uid and species_idx = v_sp and consumed_at is null;
  insert into public.wh_items (id, owner_id, species_idx, tier_idx, genome_code, genome_seed, origin)
    values (v_item, v_uid, v_sp, v_tier, v_code, v_seed, case v_cap.source when 'task' then 'task' else 'drop' end);
  update public.wh_capsules set opened_at = now(), item_id = v_item where id = v_cap.id;
  insert into public.wh_ledger (kind, item_id, to_user, ref_kind, ref_id, detail)
    values ('mint', v_item, v_uid, case v_cap.source when 'task' then 'task' else 'capsule' end, v_cap.id, jsonb_build_object('draws', p->'draws'));
  update public.wh_accounts set version = version + 1, capsules_opened = capsules_opened + 1 where user_id = v_uid;
  v_res := jsonb_build_object('ok', true, 'item_id', v_item, 'species_idx', v_sp, 'tier_idx', v_tier, 'genome_code', v_code,
            'is_new', v_before = 0, 'copies', v_before + 1, 'source', v_cap.source,
            'credits_left', (select count(*) from public.wh_capsules where owner_id = v_uid and opened_at is null), 'version', a.version + 1);
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'open_capsule', v_digest, v_res);
  return v_res;
end $$;
```

### A.5 Bootstrap, reads, play report, restock, task, early replay

```sql
-- ===== account bootstrap, state reads, play report, restock, task (DRAFT; tested locally; NOT APPLIED) =====

-- first contact: create the account row and mint the starter Dollop (the HOST supplies the genome; origin 'starter')
create function public.wh__bootstrap(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := (p->>'uid')::uuid; a public.wh_accounts%rowtype; v_item uuid := gen_random_uuid(); v_sp smallint := (p->>'species_idx')::smallint; v_seed bigint := (p->>'genome_seed')::bigint; v_pid text;
begin
  if not public.wh__flag('minting_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  perform 1 from auth.users where id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;
  loop
    v_pid := substr(md5(gen_random_uuid()::text), 1, 12);
    begin
      insert into public.wh_accounts (user_id, public_id, meter) values (v_uid, v_pid, p->'meter') on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then null;                                    -- public_id collision: draw another
    end;
  end loop;
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if exists (select 1 from public.wh_items where owner_id = v_uid and origin = 'starter') then return jsonb_build_object('ok', true, 'created', false); end if;
  if v_sp <> 0 or not public.wh__genome_ok(p->>'genome_code', v_sp, v_seed) then raise exception 'wh_bad_roll' using errcode = 'P0001'; end if;
  insert into public.wh_items (id, owner_id, species_idx, tier_idx, genome_code, genome_seed, origin) values (v_item, v_uid, v_sp, 0, p->>'genome_code', v_seed, 'starter');
  insert into public.wh_ledger (kind, item_id, to_user, ref_kind) values ('mint', v_item, v_uid, 'starter');
  update public.wh_accounts set version = version + 1 where user_id = v_uid;
  return jsonb_build_object('ok', true, 'created', true, 'item_id', v_item);
end $$;

-- everything the HOST needs to decide (no personal data, no other player's data)
create function public.wh__read_state(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := (p->>'uid')::uuid; a public.wh_accounts%rowtype; v_day integer := floor(extract(epoch from now()) / 86400)::integer;
begin
  select * into a from public.wh_accounts where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  return jsonb_build_object('ok', true, 'now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'server_day', v_day, 'version', a.version, 'meter', a.meter, 'last_event_ms', a.last_event_ms, 'pity', to_jsonb(a.merge_pity),
    'merges_today', case when a.merges_day = v_day then a.merges_today else 0 end, 'restock_day', a.restock_day, 'task_state', a.task_state, 'task_progress', a.task_progress,
    'credits', (select count(*) from public.wh_capsules where owner_id = v_uid and opened_at is null),
    'credits_play', (select count(*) from public.wh_capsules where owner_id = v_uid and opened_at is null and source = 'play'),
    'owned', coalesce((select jsonb_object_agg(species_idx::text, n) from (select species_idx, count(*) as n from public.wh_items where owner_id = v_uid and consumed_at is null group by species_idx) s), '{}'::jsonb),
    'public_id', a.public_id, 'created_at', a.created_at, 'trade_enabled', a.trade_enabled);
end $$;

create function public.wh__read_items(p jsonb) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'species_idx', i.species_idx, 'tier_idx', i.tier_idx, 'genome_code', i.genome_code, 'locked_until', i.locked_until, 'fav', i.fav,
    'reserved', not public.wh__res_free(i.reserved_trade_id, null)) order by i.id), '[]'::jsonb)
  from public.wh_items i where i.owner_id = (p->>'uid')::uuid and i.consumed_at is null and i.id in (select (jsonb_array_elements_text(p->'ids'))::uuid) $$;

-- a processed batch of touches: the HOST ran src/core/meter.ts addInteraction over server-placed times; this keeps the invariants
create function public.wh__commit_play(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := (p->>'uid')::uuid; v_idem text := p->>'idem'; v_digest text := p->>'args_digest'; a public.wh_accounts%rowtype; v_prev public.wh_ops%rowtype;
  v_add integer := (p->>'add_credits')::integer; v_last bigint := (p->>'last_event_ms')::bigint; v_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_m jsonb := p->'meter'; v_old_earned integer; v_unopened integer; v_res jsonb;
begin
  if not public.wh__flag('minting_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'play' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if a.version <> (p->>'expect_version')::integer then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  v_old_earned := coalesce((a.meter->>'earned')::integer, 0);
  select count(*) into v_unopened from public.wh_capsules where owner_id = v_uid and opened_at is null and source = 'play';
  if v_last < a.last_event_ms or v_last > v_now_ms + 2000                         -- you cannot claim play time that has not happened
     or v_add not between 0 and 3 or (v_m->>'earned')::integer - v_old_earned <> v_add   -- credits come ONLY from the meter's own counter
     or coalesce((v_m->>'dayCapsules')::integer, 0) > 12 or v_unopened + v_add > 5 then
    raise exception 'wh_bad_play' using errcode = 'P0001';                        -- a host bug, not a player error: roll back loudly
  end if;
  insert into public.wh_capsules (owner_id, source) select v_uid, 'play' from generate_series(1, v_add);
  update public.wh_accounts set meter = v_m, last_event_ms = v_last, task_progress = coalesce(p->'task_progress', task_progress), version = version + 1 where user_id = v_uid;
  v_res := jsonb_build_object('ok', true, 'version', a.version + 1, 'credits', v_unopened + v_add + (select count(*) from public.wh_capsules where owner_id = v_uid and opened_at is null and source = 'task'));
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'play', v_digest, v_res);
  return v_res;
end $$;

create function public.wh__commit_restock(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := (p->>'uid')::uuid; v_idem text := p->>'idem'; v_digest text := p->>'args_digest'; a public.wh_accounts%rowtype; v_prev public.wh_ops%rowtype;
  v_day integer := (p->>'day')::integer; v_sp smallint := (p->>'species_idx')::smallint; v_seed bigint := (p->>'genome_seed')::bigint; v_def public.wh_species%rowtype;
  v_item uuid := gen_random_uuid(); v_before integer; v_res jsonb;
begin
  if not public.wh__flag('minting_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'restock' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if a.version <> (p->>'expect_version')::integer then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  if abs(v_day - floor(extract(epoch from now()) / 86400)::integer) > 0 then return jsonb_build_object('ok', false, 'error', 'wrong_day'); end if;
  if a.restock_day = v_day then return jsonb_build_object('ok', false, 'error', 'already_claimed'); end if;
  select * into v_def from public.wh_species where idx = v_sp;
  if not found or v_def.tier_idx > 1 or not public.wh__genome_ok(p->>'genome_code', v_sp, v_seed) then raise exception 'wh_bad_roll' using errcode = 'P0001'; end if;
  select count(*) into v_before from public.wh_items where owner_id = v_uid and species_idx = v_sp and consumed_at is null;
  insert into public.wh_items (id, owner_id, species_idx, tier_idx, genome_code, genome_seed, origin) values (v_item, v_uid, v_sp, v_def.tier_idx, p->>'genome_code', v_seed, 'restock');
  insert into public.wh_ledger (kind, item_id, to_user, ref_kind, detail) values ('mint', v_item, v_uid, 'restock', jsonb_build_object('day', v_day, 'offer', p->'offer'));
  update public.wh_accounts set restock_day = v_day, restock_pick = v_sp, version = version + 1 where user_id = v_uid;
  v_res := jsonb_build_object('ok', true, 'item_id', v_item, 'species_idx', v_sp, 'tier_idx', v_def.tier_idx, 'genome_code', p->>'genome_code', 'is_new', v_before = 0, 'copies', v_before + 1, 'version', a.version + 1);
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'restock', v_digest, v_res);
  return v_res;
end $$;

create function public.wh__commit_task(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := (p->>'uid')::uuid; v_idem text := p->>'idem'; v_digest text := p->>'args_digest'; a public.wh_accounts%rowtype; v_prev public.wh_ops%rowtype; v_ts jsonb := p->'task_state'; v_res jsonb;
begin
  if not public.wh__flag('minting_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'task' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if a.version <> (p->>'expect_version')::integer then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  if coalesce((v_ts->>'claimedThisWeek')::integer, 99) > 5 then raise exception 'wh_bad_task' using errcode = 'P0001'; end if;      -- DESIGN 5.4: at most 5 tasks a week
  insert into public.wh_capsules (owner_id, source) values (v_uid, 'task');
  update public.wh_accounts set task_state = v_ts, version = version + 1 where user_id = v_uid;
  v_res := jsonb_build_object('ok', true, 'version', a.version + 1, 'credits', (select count(*) from public.wh_capsules where owner_id = v_uid and opened_at is null));
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'task', v_digest, v_res);
  return v_res;
end $$;

-- early replay: the HOST asks first, so a retry after a lost response never re-reads (consumed) inputs or re-rolls anything
create function public.wh__get_op(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.wh_ops%rowtype;
begin
  select * into v from public.wh_ops where user_id = (p->>'uid')::uuid and idem = p->>'idem';
  if not found then return 'null'::jsonb; end if;
  if v.args_digest <> p->>'args_digest' then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
  return v.result || '{"replayed":true}'::jsonb;
end $$;

-- retention, run daily by a scheduled job (the job itself is NOT in the draft): idempotency rows 30 days (play batches 1 day: one every ~45 s of play would otherwise
-- dominate the table), finished trade events 13 months, reports 12 months, idle rate buckets 1 day. The ledger is never purged.
create function public.wh__purge() returns jsonb language plpgsql security definer set search_path = public as $$
declare a integer; b integer; c integer;
begin
  delete from public.wh_ops where created_at < now() - interval '30 days' or (op = 'play' and created_at < now() - interval '1 day');  get diagnostics a = row_count;
  delete from public.wh_trade_events e using public.wh_trades t where t.id = e.trade_id and t.status in ('executed', 'cancelled', 'expired', 'failed') and t.updated_at < now() - interval '13 months';  get diagnostics b = row_count;
  delete from public.wh_reports where at < now() - interval '12 months';  get diagnostics c = row_count;
  delete from public.wh_rate where at < now() - interval '1 day';                     -- an idle bucket is full again: the row adds nothing
  return jsonb_build_object('ops', a, 'trade_events', b, 'reports', c);
end $$;

revoke all on function public.wh__bootstrap(jsonb), public.wh__read_state(jsonb), public.wh__read_items(jsonb), public.wh__commit_play(jsonb), public.wh__commit_restock(jsonb), public.wh__commit_task(jsonb), public.wh__get_op(jsonb), public.wh__purge() from public, anon, authenticated;
grant execute on function public.wh__bootstrap(jsonb), public.wh__read_state(jsonb), public.wh__read_items(jsonb), public.wh__commit_play(jsonb), public.wh__commit_restock(jsonb), public.wh__commit_task(jsonb), public.wh__get_op(jsonb), public.wh__purge() to service_role;
```

### A.6 Client reads and small writes (collection side)

```sql
-- ===== client reads and small writes, collection side: state, inventory, op status, hearts, seen (DRAFT; tested locally on 2026-10-02 except wh_op_status; NOT APPLIED) =====

create function public.wh_state(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.wh_accounts%rowtype; v_gate text;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (TRADE 7.4)
  select * into a from public.wh_accounts where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  v_gate := public.wh__gate(a);
  return jsonb_build_object('ok', true, 'version', a.version, 'public_id', a.public_id, 'handle', jsonb_build_object('adj', a.handle_adj, 'noun', a.handle_noun, 'num', a.handle_num),
    'server_now_ms', floor(extract(epoch from now()) * 1000)::bigint, 'server_day', floor(extract(epoch from now()) / 86400)::integer,
    'meter', a.meter, 'credits', (select count(*) from public.wh_capsules where owner_id = v_uid and opened_at is null),
    'merges_today', case when a.merges_day = floor(extract(epoch from now()) / 86400)::integer then a.merges_today else 0 end, 'merge_pity', to_jsonb(a.merge_pity),
    'restock_claimed_today', a.restock_day = floor(extract(epoch from now()) / 86400)::integer, 'task_state', a.task_state, 'task_progress', a.task_progress,
    'trading', jsonb_build_object('enabled', a.trade_enabled, 'ready', v_gate is null and public.wh__flag('trading_enabled'), 'why_not', coalesce(v_gate, case when not public.wh__flag('trading_enabled') then 'frozen' end),
       'trades_24h', (select count(*) from public.wh_trades x where x.status = 'executed' and x.executed_at > now() - interval '24 hours' and v_uid in (x.a_user, x.b_user))),
    'flags', jsonb_build_object('minting', public.wh__flag('minting_enabled'), 'merging', public.wh__flag('merging_enabled'), 'trading', public.wh__flag('trading_enabled'), 'board', public.wh__flag('board_enabled')));
end $$;

create function public.wh_inventory(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_after uuid; v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 200), 1), 200); v_rows jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (TRADE 7.4)
  begin v_after := nullif(p->>'after', '')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select coalesce(jsonb_agg(x order by x.id), '[]'::jsonb) into v_rows from (
    select i.id, i.species_idx, i.tier_idx, i.genome_code, i.origin, floor(extract(epoch from i.born_at) * 1000)::bigint as born_ms, i.trade_count, i.locked_until, i.fav, i.offered_at is not null as offered,
           i.seen_at is not null as seen, not public.wh__res_free(i.reserved_trade_id, null) as reserved, i.parents
    from public.wh_items i where i.owner_id = v_uid and i.consumed_at is null and (v_after is null or i.id > v_after) order by i.id limit v_limit) x;
  return jsonb_build_object('ok', true, 'items', v_rows, 'next', case when jsonb_array_length(v_rows) = v_limit then v_rows->(v_limit - 1)->>'id' end);
end $$;

create function public.wh_set_fav(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ids uuid[];
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (TRADE 7.4)
  begin if jsonb_array_length(p->'item_ids') > 50 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if; v_ids := array(select (jsonb_array_elements_text(p->'item_ids'))::uuid);
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  update public.wh_items set fav = coalesce((p->>'fav')::boolean, false), offered_at = case when coalesce((p->>'fav')::boolean, false) then null else offered_at end
    where id = any(v_ids) and owner_id = v_uid and consumed_at is null;                                       -- cosmetic flag: it does NOT bump item.version
  return jsonb_build_object('ok', true);
end $$;

create function public.wh_mark_seen(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ids uuid[];
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (TRADE 7.4)
  begin v_ids := array(select (jsonb_array_elements_text(p->'item_ids'))::uuid); exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  update public.wh_items set seen_at = now() where id = any(v_ids) and owner_id = v_uid and seen_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- after a reload the client asks what happened to the operations it had in flight, BY KEY ONLY (section 7.7). It never re-sends their parameters:
-- a key that is not here never committed (or is still running and will show up in wh_inventory). Read-only. (Added 2026-10-05.)
create function public.wh_op_status(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_keys text[];
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (TRADE 7.4)
  begin
    if jsonb_typeof(p->'idems') is distinct from 'array' or jsonb_array_length(p->'idems') > 20 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
    v_keys := array(select jsonb_array_elements_text(p->'idems'));
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  return jsonb_build_object('ok', true, 'ops', coalesce((select jsonb_object_agg(o.idem, jsonb_build_object('op', o.op, 'at', o.created_at, 'result', o.result))
    from public.wh_ops o where o.user_id = v_uid and o.idem = any(v_keys)), '{}'::jsonb));
end $$;

revoke all on function public.wh_state(jsonb), public.wh_inventory(jsonb), public.wh_op_status(jsonb), public.wh_set_fav(jsonb), public.wh_mark_seen(jsonb) from public, anon;
grant execute on function public.wh_state(jsonb), public.wh_inventory(jsonb), public.wh_op_status(jsonb), public.wh_set_fav(jsonb), public.wh_mark_seen(jsonb) to authenticated;
```

### A.7 Privilege audit (the last statement before `commit;`; added 2026-10-05)

**Verified on 2026-10-05 [V]** on the scratch database: it passes on the migration as written. Loaded again with everything except A.7 and then one
injected change each, it raised `WH_SELFTEST_FAIL` every time: the first draft's `revoke all on all tables in schema public from anon, authenticated`
("portal objects changed: rel:portal_sentinel"), the same on all sequences, `grant execute` on the helper `wh__blocked` to `authenticated`, `grant usage`
on `wh_ledger_id_seq`, `grant insert` on `wh_items`, and enabling RLS on the portal's sentinel table. On the real project the snapshot also covers every
portal table, view, sequence and function in `public`, so none of them can change without rolling the whole migration back.

```sql
-- Raises WH_SELFTEST_FAIL, and so rolls the WHOLE migration back, if
--  (1) any privilege, RLS flag or policy count of a NON-WH object in public differs from the snapshot of A.0 (the portal is untouched),
--  (2) players hold anything on a wh_ table or view beyond SELECT on wh_species (anon and authenticated) and on wh_accounts, wh_items,
--      wh_capsules (authenticated),
--  (3) players can use any wh_ sequence, or
--  (4) players can execute a wh_ function that is not one of the 28 client RPCs (TRADE.md 7.2).
-- The functional self-test (a one-transaction subset of the SQL suite, in the style of 0008's) is still to be written (TRADE.md 18.3).
do $$
declare v_bad text;
begin
  with now_acl as (
    select 'rel:' || c.oid::regclass::text as obj,
           coalesce(c.relacl::text, '<default>') || ' rls=' || c.relrowsecurity::text
             || ' policies=' || (select count(*) from pg_policy pol where pol.polrelid = c.oid)::text as acl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relname not like 'wh\_%'
    union all
    select 'fn:' || p.oid::regprocedure::text, coalesce(p.proacl::text, '<default>')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname not like 'wh\_%')
  select string_agg(coalesce(b.obj, a.obj), ', ' order by coalesce(b.obj, a.obj)) into v_bad
    from public.wh__acl_before b full join now_acl a on a.obj = b.obj
   where b.acl is distinct from a.acl;
  if v_bad is not null then raise exception 'WH_SELFTEST_FAIL portal objects changed: %', v_bad; end if;

  select string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ') into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'wh\_%' and table_name <> 'wh__acl_before' and grantee in ('anon', 'authenticated')
     and not (privilege_type = 'SELECT' and (table_name = 'wh_species' or (grantee = 'authenticated' and table_name in ('wh_accounts', 'wh_items', 'wh_capsules'))));
  if v_bad is not null then raise exception 'WH_SELFTEST_FAIL players hold table privileges they must not: %', v_bad; end if;

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'wh\_%'
     and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('anon', c.oid, 'select') or has_sequence_privilege('anon', c.oid, 'update')
       or has_sequence_privilege('authenticated', c.oid, 'usage') or has_sequence_privilege('authenticated', c.oid, 'select') or has_sequence_privilege('authenticated', c.oid, 'update'));
  if v_bad is not null then raise exception 'WH_SELFTEST_FAIL players can use WH sequences: %', v_bad; end if;

  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'wh\_%'
     and (has_function_privilege('anon', p.oid, 'execute')
       or (has_function_privilege('authenticated', p.oid, 'execute') and p.proname not in (
           'wh_block', 'wh_block_list', 'wh_board_search', 'wh_cancel_trade', 'wh_confirm_trade', 'wh_counter_trade', 'wh_friend_code_get',
           'wh_friend_code_rotate', 'wh_friend_list', 'wh_friend_redeem', 'wh_friend_remove', 'wh_friend_respond', 'wh_friend_shelf', 'wh_handle_set',
           'wh_inventory', 'wh_listing_cancel', 'wh_listing_create', 'wh_mark_seen', 'wh_op_status', 'wh_propose_trade', 'wh_report', 'wh_set_fav',
           'wh_shelf_set', 'wh_state', 'wh_trade_emote', 'wh_trade_inbox', 'wh_trade_view', 'wh_unblock')));
  if v_bad is not null then raise exception 'WH_SELFTEST_FAIL players can execute: %', v_bad; end if;
end $$;
drop table public.wh__acl_before;
```

## Appendix B. Reference host (TypeScript, DRAFT, NOT DEPLOYED)

The whole file as it ran in the host suite. In production the imports are the vendored copies `./core/*.ts` and `./data/*.ts` (`_shared/wh/`), `Db.rpc` is `supabase.rpc` with the service key, and the entry point `index.ts` wraps these functions behind `{fn, args}` after verifying the JWT and taking `uid` from it (never from the body). `merge`, `tidy` and `preview` are explained in MERGE.md.

```ts
// WOBBLEHOARD "wh-api" REFERENCE HOST (DRAFT, NOT DEPLOYED). It runs the game's OWN core modules verbatim (vendored as ./core and ./data) and
// reaches Postgres only through the wh__* functions. `Db.rpc` is PostgREST (service role) in production and a psql shell-out in the local test.
import { addInteraction, createMeter, sanitizeMeter, DAY_MS } from './core/meter.ts';
import type { MeterState, TouchKind } from './core/meter.ts';
import { rollCapsule, capsuleGenome, restockOffer, daySeed, dailyTasks, claimTask, createTaskState, weekKeyOf, isValidRestockPick, TASK_DEFS } from './core/drops.ts';
import type { TaskState, TaskDef } from './core/drops.ts';
import { previewMerge, rollMerge, MERGE_COST } from './core/merge.ts';
import type { MergePreviewOk, MergeRollOk } from './core/merge.ts';
import { encodeGenome, decodeGenome, makeStarterGenome } from './core/genome.ts';
import { CATALOG, SPECIES, speciesBaseGenome, getSpecies } from './data/catalog.ts';
import type { SpeciesId } from './data/catalog.ts';
import { hashString } from './core/rng.ts';
import { createHash, webcrypto } from 'node:crypto';

export interface Db { rpc(fn: string, payload: Record<string, unknown>): Promise<any> | any }
export interface HostDeps { /** test seam only: in production the host uses the DATABASE clock (st.now_ms), so a skewed host clock can never place touches in the future or pick the wrong day */ now?: () => number }

export const WH_QUEUE_MAX = 5;            // unopened play capsules waiting on the table (DESIGN 6.1)
export const MAX_EVENTS_PER_BATCH = 120;
export const BANK_MAX_MS = 300_000;       // at most 5 minutes of buffered play are accepted late
export const STRETCH_FULL_INTENSITY = 0.95;  // the snap intensity (pull level, 1.0 = the family's maxPull) that counts as "as far as it will go"

const secureUnit = (log?: number[]) => (): number => { const u = new Uint32Array(1); webcrypto.getRandomValues(u); const x = u[0] / 4294967296; log?.push(x); return x; };
const u32 = (): number => { const u = new Uint32Array(1); webcrypto.getRandomValues(u); return u[0]; };
const digestOf = (o: unknown): string => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 32);
const idxOf = (id: SpeciesId): number => CATALOG.find((d) => d.id === id)!.idx;
const isIdem = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(x);
/** Tidy-up's key for its i-th merge: a hash, so sub-keys can never collide. (The first draft used `${idem}-${i}`.slice(0, 64), which drops the
 *  suffix for a 63- or 64-character key: every merge then shared one key and the second one answered idem_reuse.) 40 characters, inside the idem alphabet. */
export const tidySubKey = (idem: string, i: number): string => 't' + createHash('sha256').update(`wh-tidy:${idem}:${i}`).digest('hex').slice(0, 39);

/** What the preview panel and the server both compute: if this changed between preview and commit, the player is shown the new odds first. */
export function oddsDigest(p: MergePreviewOk): string {
  // not a security feature (a player who forges it only changes the odds they themselves accept): a cheap, synchronous, shared checksum
  // (FNV-1a from core/rng.ts, so the browser computes the identical value with no crypto API)
  return hashString(JSON.stringify([p.inputSpecies, p.tierUpChance, p.outcomes.map((o) => [o.species, Math.round(o.probability * 1e9)])])).toString(36);
}

export function createHost(db: Db, deps: HostDeps = {}) {
  const call = async (fn: string, payload: Record<string, unknown>) => db.rpc(fn, payload);
  /** optimistic concurrency: read state, decide with fresh randomness, commit at expect_version; on `conflict` start over (the discarded roll was never shown to anyone) */
  async function withRetry<T extends { ok: boolean; error?: string }>(uid: string, idem: string, args: unknown, attempt: () => Promise<T>, tries = 4): Promise<T> {
    const prior = await call('wh__get_op', { uid, idem, args_digest: digestOf(args) });          // a retry after a lost response returns the stored answer first
    if (prior) return prior as T;
    let last!: T;
    for (let i = 0; i < tries; i++) { last = await attempt(); if (last.error !== 'conflict') return last; }
    return { ok: false, error: 'busy' } as T;
  }
  const code = (e: string): string => e.replace(/-/g, '_');                                       // core uses 'mixed-species'; the API speaks 'mixed_species'

  /* ---------------- first contact ---------------- */
  async function bootstrap(uid: string) {
    const g = makeStarterGenome();
    return call('wh__bootstrap', { uid, species_idx: 0, genome_code: encodeGenome(g), genome_seed: g.seed, meter: createMeter() });
  }

  /* ---------------- wh_report_play ---------------- */
  type Ev = [kind: 0 | 1 | 2, amount: number, dtMs: number, heldS?: number];   // heldS: a pull's hold, grab to release (2026-10-06, DESIGN 5.4)
  const KIND: TouchKind[] = ['poke', 'squeeze', 'pull'];
  function bump(progress: Record<string, any>, tasks: TaskDef[], k: TouchKind, amount: number, d: { freshness: number; doubleTap: boolean; medley: number; paidAs?: TouchKind }, gapSincePokeS: number | null): void {
    for (const t of tasks) {
      const key = t.id; let n = Number(progress[key] ?? 0);
      const paid = d.paidAs ?? k;
      if (t.metric === 'pokes' && paid === 'poke' && !d.doubleTap) { if (t.param ? (gapSincePokeS === null || gapSincePokeS >= t.param) : d.freshness >= 0.5) n++; }
      if (t.metric === 'squeezes' && paid === 'squeeze' && amount >= (t.param ?? 0.4)) n++;
      if (t.metric === 'snaps' && paid === 'pull' && amount >= 0.35) n++;
      if (t.metric === 'stretch' && paid === 'pull' && amount >= STRETCH_2X_INTENSITY) n++;
      if (t.metric === 'medleys' && d.medley > 0) n++;
      if (t.metric === 'softPops') {
        const sk = `${key}#streak`;
        if (paid === 'squeeze') { if (amount >= 1.8) { progress[sk] = Number(progress[sk] ?? 0) + 1; n = Math.max(n, progress[sk]); } else progress[sk] = 0; }
      }
      progress[key] = n;
    }
  }
  async function reportPlay(uid: string, req: { idem: string; events: Ev[] }) {
    if (!isIdem(req?.idem) || !Array.isArray(req.events) || req.events.length > MAX_EVENTS_PER_BATCH) return { ok: false, error: 'bad_payload' };
    let prev = -1; const evs: Ev[] = [];
    for (const e of req.events) {
      if (!Array.isArray(e) || ![0, 1, 2].includes(e[0]) || !Number.isFinite(e[1]) || !Number.isInteger(e[2]) || e[2] < prev || e[2] < 0) return { ok: false, error: 'bad_payload' };
      if (e.length > 4 || (e.length === 4 && (e[0] !== 2 || !Number.isFinite(e[3])))) return { ok: false, error: 'bad_payload' };   // only a pull carries a hold
      prev = e[2]; evs.push([e[0], Math.min(e[0] === 2 ? 1 : 10, Math.max(0, e[1])), e[2], e[0] === 2 ? Math.min(10, Math.max(0, e[3] ?? 0)) : 0]);
    }
    return withRetry(uid, req.idem, req, async () => {
      const st = await call('wh__read_state', { uid }); if (!st.ok) return st;
      const t = deps.now ? deps.now() : st.now_ms; let meter: MeterState = st.meter && st.meter.v ? sanitizeMeter(st.meter) : createMeter();
      // THE TIME BUDGET: the batch is laid out so its LAST event is "now" and every spacing is kept; an event that would land at or before the last
      // accepted touch (or older than the 5-minute bank) is dropped. You cannot report more play time than has actually passed.
      const dtLast = evs.length ? evs[evs.length - 1][2] : 0;
      const placed = evs.map((e) => ({ e, t: t - (dtLast - e[2]) })).filter((x) => x.t > st.last_event_ms && x.t >= t - BANK_MAX_MS);
      const clipped = evs.length - placed.length;
      const day = Math.floor(t / DAY_MS); const week = weekKeyOf(day);
      const tasks = dailyTasks(daySeed(uid, day, 'tasks'));
      const progress: Record<string, any> = st.task_progress && st.task_progress.day === day ? { ...st.task_progress } : { day };
      let credits = 0, paid = 0, lastPoke: number | null = meter.lastMs[0], accepted = 0, lastT = st.last_event_ms; let stoppedFull = false;
      for (const { e, t: tm } of placed) {
        if (Number(st.credits_play) + credits >= WH_QUEUE_MAX) { stoppedFull = true; break; }       // table full: accrual pauses (nothing is lost, the touches are simply not paid)
        const r = addInteraction(meter, { kind: KIND[e[0]], amount: e[1], heldS: e[3], tMs: tm, dayKey: Math.floor(tm / DAY_MS) });
        if (r.detail.refused) continue;
        bump(progress, tasks, KIND[e[0]], e[1], r.detail, KIND[e[0]] === 'poke' && lastPoke !== null ? (tm - lastPoke) / 1000 : null);
        if (KIND[e[0]] === 'poke') lastPoke = tm;
        meter = r.state; credits += r.capsulesEarned; paid += r.spGained; accepted++; lastT = tm;
      }
      const res = await call('wh__commit_play', { uid, idem: req.idem, args_digest: digestOf(req), expect_version: st.version, meter, last_event_ms: Math.max(lastT, st.last_event_ms), add_credits: credits, task_progress: progress });
      return res.ok ? { ...res, paid_sp: paid, accepted, clipped, queue_full: stoppedFull, meter: { sp: meter.sp, earned: meter.earned, day_capsules: meter.dayCapsules }, server_now_ms: t, week } : res;
    });
  }

  /* ---------------- wh_open_capsule ---------------- */
  async function openCapsule(uid: string, req: { idem: string }) {
    if (!isIdem(req?.idem)) return { ok: false, error: 'bad_payload' };
    return withRetry(uid, req.idem, { op: 'open' }, async () => {
      const st = await call('wh__read_state', { uid }); if (!st.ok) return st;
      if (Number(st.credits) < 1) return { ok: false, error: 'no_capsule' };
      const draws: number[] = []; const roll = rollCapsule(secureUnit(draws)); const g = capsuleGenome(roll);
      return call('wh__commit_open_capsule', { uid, idem: req.idem, args_digest: digestOf({ op: 'open' }), expect_version: st.version, species_idx: idxOf(roll.species), tier_idx: roll.tierIndex, genome_code: encodeGenome(g), genome_seed: roll.genomeSeed, draws });
    });
  }

  /* ---------------- wh_claim_restock ---------------- */
  async function claimRestock(uid: string, req: { idem: string; pick: string }) {
    if (!isIdem(req?.idem) || typeof req.pick !== 'string') return { ok: false, error: 'bad_payload' };
    return withRetry(uid, req.idem, { op: 'restock', pick: req.pick }, async () => {
      const st = await call('wh__read_state', { uid }); if (!st.ok) return st;
      const day = Math.floor((deps.now ? deps.now() : st.now_ms) / DAY_MS); const seed = daySeed(uid, day, 'restock');
      if (!isValidRestockPick(seed, req.pick)) return { ok: false, error: 'not_offered' };         // the server recomputes the three offered species
      const gs = u32(); const g = speciesBaseGenome(req.pick as SpeciesId, gs);
      return call('wh__commit_restock', { uid, idem: req.idem, args_digest: digestOf({ op: 'restock', pick: req.pick }), expect_version: st.version, day, species_idx: idxOf(req.pick as SpeciesId), genome_code: encodeGenome(g), genome_seed: gs, offer: restockOffer(seed) });
    });
  }

  /* ---------------- wh_complete_task ---------------- */
  async function completeTask(uid: string, req: { idem: string; task_id: string }) {
    if (!isIdem(req?.idem) || typeof req.task_id !== 'string') return { ok: false, error: 'bad_payload' };
    return withRetry(uid, req.idem, { op: 'task', id: req.task_id }, async () => {
      const st = await call('wh__read_state', { uid }); if (!st.ok) return st;
      const day = Math.floor((deps.now ? deps.now() : st.now_ms) / DAY_MS);
      const offered = dailyTasks(daySeed(uid, day, 'tasks')); const def = offered.find((t) => t.id === req.task_id);
      if (!def) return { ok: false, error: 'not_offered' };
      const progress = st.task_progress && st.task_progress.day === day ? st.task_progress : {};
      if (Number(progress[def.id] ?? 0) < def.target) return { ok: false, error: 'not_done', progress: Number(progress[def.id] ?? 0), target: def.target };   // judged from the server's own touch counters
      const ts: TaskState = st.task_state && 'week' in st.task_state ? st.task_state : createTaskState();
      const c = claimTask(ts, offered, def.id, day); if (!c.ok) return { ok: false, error: code(c.reason) };
      return call('wh__commit_task', { uid, idem: req.idem, args_digest: digestOf({ op: 'task', id: def.id }), expect_version: st.version, task_state: c.state });
    });
  }

  /* ---------------- wh_merge ---------------- */
  const idOfIdx = (i: number): SpeciesId => SPECIES[i];
  async function merge(uid: string, req: { idem: string; items: string[]; odds_digest?: string }, hook?: () => Promise<void> | void) {
    if (!isIdem(req?.idem) || !Array.isArray(req.items) || req.items.length !== MERGE_COST || new Set(req.items).size !== MERGE_COST) return { ok: false, error: 'wrong_count' };
    return withRetry(uid, req.idem, { op: 'merge', items: [...req.items].sort() }, async () => {
      const st = await call('wh__read_state', { uid }); if (!st.ok) return st;
      const rows: any[] = await call('wh__read_items', { uid, ids: req.items });
      if (rows.length !== MERGE_COST) return { ok: false, error: 'not_yours' };
      const owned: Record<string, number> = {}; for (const [k, v] of Object.entries(st.owned as Record<string, number>)) owned[idOfIdx(Number(k))] = Number(v);
      const state = { owned, pity: st.pity as number[] };
      const inputs = rows.map((r) => ({ species: idOfIdx(r.species_idx), genome: decodeGenome(r.genome_code)! }));
      const pre = previewMerge(inputs, state);
      if (!pre.ok) return { ok: false, error: code(pre.error) };
      if (req.odds_digest && req.odds_digest !== oddsDigest(pre)) return { ok: false, error: 'odds_changed', preview: pre };    // honest preview: the player sees the new odds before anything is consumed
      const draws: number[] = []; const roll = rollMerge(inputs, secureUnit(draws), state);
      if (!roll.ok) return { ok: false, error: code(roll.error) };
      if (hook) await hook();                                                                            // test seam: a concurrent change between read and commit
      return call('wh__commit_merge', {
        uid, idem: req.idem, args_digest: digestOf({ op: 'merge', items: [...req.items].sort() }), expect_version: st.version, inputs: req.items, cost: MERGE_COST,
        out_species_idx: idxOf(roll.outcome.species), out_tier_idx: rowTier(roll), tier_up: roll.outcome.tierUp,
        genome_seed: roll.outcome.genomeSeed, genome_code: encodeGenome(roll.outcome.genome), pity_after: roll.pityAfter,
        audit: { draws, reason: roll.reason, odds_basis: pre.basis, tier_up_chance: pre.tierUpChance, pity_before: st.pity, odds_digest: oddsDigest(pre), cost: MERGE_COST,
                 candidates: pre.outcomes.map((o) => [o.species, o.isNew ? 0 : 1]) },       // everything a replay needs besides the parents' genomes
      });
    });
  }
  const TIERS6 = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const rowTier = (r: MergeRollOk): number => TIERS6.indexOf(r.outcome.tier);

  /* ---------------- wh_tidy: the SAME merge, repeated, each atomic, each with its own sub-key ---------------- */
  async function tidy(uid: string, req: { idem: string; plan: string[][] }) {
    if (!isIdem(req?.idem) || !Array.isArray(req.plan) || req.plan.length > 10) return { ok: false, error: 'bad_payload' };
    const results: any[] = [];
    for (let i = 0; i < req.plan.length; i++) {
      const r = await merge(uid, { idem: tidySubKey(req.idem, i), items: req.plan[i] });
      results.push(r); if (!r.ok) break;                                                                 // stop at the first refusal; what was done stays done
    }
    return { ok: true, results, done: results.filter((r) => r.ok).length };
  }

  /** What the client's preview panel shows, computed from the SERVER's state (the client computes it from its mirror; the digest is how the two are compared) */
  async function preview(uid: string, items: string[]) {
    const st = await call('wh__read_state', { uid }); const rows: any[] = await call('wh__read_items', { uid, ids: items });
    const owned: Record<string, number> = {}; for (const [k, v] of Object.entries(st.owned as Record<string, number>)) owned[idOfIdx(Number(k))] = Number(v);
    const pre = previewMerge(rows.map((r) => ({ species: idOfIdx(r.species_idx), genome: decodeGenome(r.genome_code)! })), { owned, pity: st.pity as number[] });
    return pre.ok ? { ok: true as const, preview: pre, digest: oddsDigest(pre) } : { ok: false as const, error: code(pre.error) };
  }

  return { bootstrap, reportPlay, openCapsule, claimRestock, completeTask, merge, tidy, preview };
}
```

## Appendix C. Host test suite (36/36 on 2026-10-02; 37/37 with the check added on 2026-10-05, run that day)

Run against the scratch database after loading the SQL of Appendix A (and TRADE.md Appendix A, which the conservation view lives in). `Db.rpc` shells out to `psql` as `service_role`. The Tidy-up check with a 64-character key was added after the 2026-10-05 audit; the whole suite passed 37 of 37 on 2026-10-05 [V].

```ts
// Local test of the reference host against the draft SQL (PG16 + stub). Plain node: node host_test.ts
import { spawnSync } from 'node:child_process';
import { createHost, oddsDigest, WH_QUEUE_MAX, tidySubKey } from './host_ref.ts';
import { CATALOG, SPECIES, speciesBaseGenome } from './data/catalog.ts';
import { TIERS, TIER_ODDS } from './core/rarity.ts';
import { MERGE_COST, previewMerge } from './core/merge.ts';
import { decodeGenome, genomeEquals, encodeGenome } from './core/genome.ts';
import { DAY_MS } from './core/meter.ts';
import { restockOffer, daySeed, dailyTasks } from './core/drops.ts';
import { randomUUID } from 'node:crypto';

const PSQL = ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'wh', '-At', '-q'];
const run = (args: string[]): string => { const r = spawnSync('psql', [...PSQL, ...args], { encoding: 'utf8' }); if (r.status !== 0 || /ERROR/.test(r.stderr)) throw new Error(r.stderr.trim()); return r.stdout.trim(); };
const sql = (q: string): string => run(['-c', q]);
const db = { rpc(fn: string, payload: Record<string, unknown>) { const out = run(['-c', 'set role service_role', '-c', `select public.${fn}('${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb)`]); return JSON.parse(out); } };
let bad = 0, n = 0; const check = (name: string, ok: boolean, extra: unknown = ''): void => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? '  ' + JSON.stringify(extra) : ''}`); };
const idem = (): string => randomUUID().replace(/-/g, '') + 'abcdef01';
const TIER_IDX = (t: string): number => TIERS.indexOf(t as never);

// the real catalog into wh_species (test seeding script; production: generated by _harness/gen_wh_species.ts, checked by a probe)
sql('delete from public.wh_species');
sql('insert into public.wh_species (idx, id, tier_idx) values ' + CATALOG.map((d) => `(${d.idx}, '${d.id}', ${TIER_IDX(d.tier)})`).join(','));
check('50 species seeded from src/data/catalog.ts', sql('select count(*) from public.wh_species') === '50');

const uid = randomUUID(); sql(`insert into auth.users (id, email) values ('${uid}', 'h@invalid.test')`);
let clock = Date.now(); const host = createHost(db, { now: () => clock });
console.log('== bootstrap ==');
const b1 = await host.bootstrap(uid); const b2 = await host.bootstrap(uid);
check('bootstrap creates the account and ONE starter Dollop whose real g1 code passes the SQL integrity check', b1.ok && b1.created && b2.ok && !b2.created && sql(`select count(*) from public.wh_items where owner_id='${uid}' and origin='starter'`) === '1', b1);
const starter = sql(`select genome_code from public.wh_items where owner_id='${uid}'`);
check('stored starter genome decodes to the species Dollop', decodeGenome(starter)?.species === 'dollop');

console.log('== wh_report_play: the time budget ==');
// a forged 25-minute stream in ONE request (1500 events: split into 120-event batches an attacker would send back to back). It forges SQUEEZES held 3 s
// (kind 1, amount 3): since 2026-10-06 ("short taps pay nothing") a stream of pokes (kind 0) earns nothing and would test nothing. Not re-run.
const forged = (offset: number) => Array.from({ length: 120 }, (_, i) => [1, 3, (offset + i) * 1000] as [1, number, number]);
let credited = 0, clippedTotal = 0; const t0 = Date.now(); clock = t0;
for (let b = 0; b < 12; b++) { const r = await host.reportPlay(uid, { idem: idem(), events: forged(b * 120) }); if (!r.ok) { console.log(r); break; } credited += r.credits === undefined ? 0 : 0; clippedTotal += r.clipped; }
const afterForge = JSON.parse(sql(`select jsonb_build_object('sp', meter->'sp', 'earned', meter->'earned') from public.wh_accounts where user_id='${uid}'`));
check('12 back-to-back batches claiming 24 minutes in a few real milliseconds are clipped to the 5-minute bank (most events dropped)', clippedTotal > 1000 && afterForge.earned <= 3, { earned: afterForge.earned, clippedTotal });
const credits = Number(sql(`select count(*) from public.wh_capsules where owner_id='${uid}' and opened_at is null`));
check('credits equal the meter counter, never more than the table holds', credits === afterForge.earned && credits <= WH_QUEUE_MAX, { credits });
const replay = await host.reportPlay(uid, { idem: 'x'.repeat(20), events: forged(0).slice(0, 5) }); const replay2 = await host.reportPlay(uid, { idem: 'x'.repeat(20), events: forged(0).slice(0, 5) });
check('replaying a batch (same idem) returns the stored result', replay2.replayed === true, replay2);
check('bad payloads are refused (out-of-order dt, 121 events, bad kind, NaN)', (await host.reportPlay(uid, { idem: idem(), events: [[0, 0, 5], [0, 0, 1]] as never })).error === 'bad_payload' && (await host.reportPlay(uid, { idem: idem(), events: forged(0).concat(forged(1)) })).error === 'bad_payload'
  && (await host.reportPlay(uid, { idem: idem(), events: [[7, 0, 0]] as never })).error === 'bad_payload' && (await host.reportPlay(uid, { idem: idem(), events: [[1, NaN, 0]] as never })).error === 'bad_payload');
// an honest human-like stream in real time: 3.3 s per touch, varied, split in batches
sql(`update public.wh_accounts set meter = '{}'::jsonb, last_event_ms = 0 where user_id='${uid}'`); sql(`delete from public.wh_capsules where owner_id='${uid}'`);
clock = Date.now(); const honest: [0 | 1 | 2, number, number][] = []; const kinds: [0 | 1 | 2, number][] = [[0, 0], [1, 2.0], [2, 0.9]];
for (let i = 0; i < 100; i++) honest.push([kinds[i % 3][0], kinds[i % 3][1], i * 3300]);
const rh = await host.reportPlay(uid, { idem: idem(), events: honest.map((e) => e) }); // 100 events spanning 5.4 minutes: the first ones fall outside the 5-minute bank
check('a 5.5-minute honest stream (100 touches, 3.3 s apart): the oldest 30 s fall outside the 5-minute bank, the rest are paid', rh.ok && rh.clipped >= 8 && rh.clipped <= 10 && rh.accepted >= 90, { accepted: rh.accepted, clipped: rh.clipped, paid: rh.paid_sp?.toFixed(1) });

console.log('== wh_open_capsule: 300 opens ==');
sql(`delete from public.wh_capsules where owner_id='${uid}'`); sql(`insert into public.wh_capsules (owner_id, source) select '${uid}', 'play' from generate_series(1, 300)`);
const counts = new Array(6).fill(0); let okc = 0, newc = 0;
for (let i = 0; i < 300; i++) { const r = await host.openCapsule(uid, { idem: idem() }); if (r.ok) { okc++; counts[r.tier_idx]++; if (r.is_new) newc++; } else { console.log(r); break; } }
check('300 capsules opened, every roll accepted by the SQL integrity checks (species byte, seed, tier)', okc === 300, { okc });
check('tier mix is plausible against the public odds (76.3/13/6/2.8/1.4/0.5)', counts[0] > 200 && counts[0] < 255 && counts[1] > 20 && counts[1] < 60 && counts.slice(3).reduce((a, b) => a + b, 0) < 25, counts);
const dup = await host.openCapsule(uid, { idem: idem() });
check('no credit left: no_capsule', dup.error === 'no_capsule');
const k1 = idem(); sql(`insert into public.wh_capsules (owner_id, source) values ('${uid}', 'play')`);
const o1 = await host.openCapsule(uid, { idem: k1 }); const o2 = await host.openCapsule(uid, { idem: k1 });
check('same idem key opens ONE capsule and returns the same item', o1.ok && o2.replayed && o1.item_id === o2.item_id && sql(`select count(*) from public.wh_capsules where owner_id='${uid}' and opened_at is null`) === '0');
const row = sql(`select genome_code from public.wh_items where id='${o1.item_id}'`);
check('stored genome equals the pure function of (species, genomeSeed) the client would derive', genomeEquals(decodeGenome(row)!, speciesBaseGenome(CATALOG[o1.species_idx].id, Number(sql(`select genome_seed from public.wh_items where id='${o1.item_id}'`)))));

console.log('== database clock (no injected clock) ==');
{
  const real = createHost(db);                                           // no deps.now: the host takes time and day from the DATABASE
  const u = randomUUID(); sql(`insert into auth.users (id, email) values ('${u}', 'c@invalid.test')`); await real.bootstrap(u);
  const r1 = await real.reportPlay(u, { idem: idem(), events: [[0, 0, 0], [1, 2, 3300], [2, 0.9, 6600]] });
  check('with the database clock the first batch is accepted and nothing is in the future', r1.ok && r1.accepted === 3 && r1.clipped === 0, { accepted: r1.accepted, clipped: r1.clipped });
  const day0 = Number(sql('select floor(extract(epoch from now()) / 86400)')); const offer0 = restockOffer(daySeed(u, day0, 'restock'));
  const rr = await real.claimRestock(u, { idem: idem(), pick: offer0[0] });
  check('restock uses the database day', rr.ok === true, rr);
}
console.log('== restock and tasks ==');
const day = Math.floor(clock / DAY_MS); const offer = restockOffer(daySeed(uid, day, 'restock'));
sql(`update public.wh_accounts set task_progress = '{}'::jsonb, task_state = '{}'::jsonb where user_id='${uid}'`);
check('picking a species that was not offered is refused by the host', (await host.claimRestock(uid, { idem: idem(), pick: CATALOG.find((d) => !offer.includes(d.id) && d.tier === 'common')!.id })).error === 'not_offered');
const rs = await host.claimRestock(uid, { idem: idem(), pick: offer[1] });
check('restock pick of an offered species mints a restock item', rs.ok && sql(`select origin from public.wh_items where id='${rs.item_id}'`) === 'restock', rs);
check('a second restock the same day is refused', (await host.claimRestock(uid, { idem: idem(), pick: offer[0] })).error === 'already_claimed');
const tasks = dailyTasks(daySeed(uid, day, 'tasks'));
check('a task that is not done is refused with its progress', (await host.completeTask(uid, { idem: idem(), task_id: tasks[0].id })).error === 'not_done');
sql(`update public.wh_accounts set task_progress = jsonb_build_object('day', ${day}, '${tasks[0].id}', ${tasks[0].target}) where user_id='${uid}'`);
const tk = await host.completeTask(uid, { idem: idem(), task_id: tasks[0].id });
check('a done task pays one task-source capsule', tk.ok && sql(`select count(*) from public.wh_capsules where owner_id='${uid}' and opened_at is null and source='task'`) === '1', tk);
check('the same task again today: already_claimed', (await host.completeTask(uid, { idem: idem(), task_id: tasks[0].id })).error === 'already_claimed');
sql(`update public.wh_accounts set task_state = jsonb_build_object('week', ${Math.floor((day + 3) / 7)}, 'claimedThisWeek', 5, 'day', ${day - 1}, 'claimedToday', '[]'::jsonb), task_progress = jsonb_build_object('day', ${day}, '${tasks[1].id}', ${tasks[1].target}) where user_id='${uid}'`);
check('the weekly limit of 5 is enforced', (await host.completeTask(uid, { idem: idem(), task_id: tasks[1].id })).error === 'weekly_limit');
const ct = await host.openCapsule(uid, { idem: idem() }); check('the task capsule opens as origin task', ct.ok && ct.source === 'task' && sql(`select origin from public.wh_items where id='${ct.item_id}'`) === 'task');

console.log('== wh_merge ==');
const mu = randomUUID(); sql(`insert into auth.users (id, email) values ('${mu}', 'm@invalid.test')`); await host.bootstrap(mu);
const give = (sp: string, k: number): string[] => Array.from({ length: k }, (_, i) => { const g = speciesBaseGenome(sp as never, 1000 + i + Math.floor(Math.random() * 1e6)); const id = randomUUID(); const d = CATALOG.find((x) => x.id === sp)!;
  sql(`insert into public.wh_items (id, owner_id, species_idx, tier_idx, genome_code, genome_seed, origin) values ('${id}', '${mu}', ${d.idx}, ${TIER_IDX(d.tier)}, '${encodeGenome(g)}', ${g.seed}, 'drop')`); sql(`insert into public.wh_ledger (kind, item_id, to_user, ref_kind) values ('mint', '${id}', '${mu}', 'capsule')`); return id; });
const dollops = give('dollop', 6); const plump = give('plumpet', 2);
let st = JSON.parse(sql(`select public.wh__read_state('{"uid":"${mu}"}'::jsonb)`));
let r = await host.merge(mu, { idem: idem(), items: dollops.slice(0, 2) });
check('merge: two Dollops become one new squishy; inputs consumed; output locked; pity stored', r.ok && r.consumed.length === MERGE_COST && sql(`select count(*) from public.wh_items where id = any(array['${dollops[0]}','${dollops[1]}']::uuid[]) and consumed_at is not null`) === '2', r);
check('the audit trail has the three draws, the odds basis, pity before and the digest', JSON.parse(sql(`select detail from public.wh_ledger where item_id='${r.item_id}' and kind='mint'`)).draws.length === 3);
const e1 = idem(); const mres = await host.merge(mu, { idem: e1, items: dollops.slice(2, 4) }); const mres2 = await host.merge(mu, { idem: e1, items: dollops.slice(2, 4) });
check('replay with the same idem returns the same result (no second merge)', mres.ok && mres2.replayed && mres2.item_id === mres.item_id);
const bump = async () => { sql(`update public.wh_accounts set version = version + 1 where user_id='${mu}'`); };
let hookCalls = 0; const rc = await host.merge(mu, { idem: idem(), items: dollops.slice(4, 6) }, async () => { if (hookCalls++ === 0) await bump(); });
check('a concurrent change between read and commit: the host retries from fresh state and succeeds (conflict never reaches the player)', rc.ok && hookCalls === 2, { hookCalls });
const pv = await host.preview(mu, plump);
const stale = await host.merge(mu, { idem: idem(), items: plump, odds_digest: 'deadbeef' });
check('a stale odds digest is refused with the NEW preview and nothing is consumed (honest preview)', stale.error === 'odds_changed' && !!stale.preview && sql(`select count(*) from public.wh_items where id = any(array['${plump[0]}','${plump[1]}']::uuid[]) and consumed_at is null`) === '2', stale.error);
const good = await host.merge(mu, { idem: idem(), items: plump, odds_digest: (pv as any).digest });
check('with the matching digest it proceeds', good.ok, good.error);
check('mixed species refused', (await host.merge(mu, { idem: idem(), items: [give('dollop', 1)[0], give('plumpet', 1)[0]] })).error === 'mixed_species');
const myth = give('prismelo', 2); check('a Mythic pair cannot merge', (await host.merge(mu, { idem: idem(), items: myth })).error === 'mythic_cannot_merge');
check('merging items that are not yours is refused', (await host.merge(mu, { idem: idem(), items: [randomUUID(), randomUUID()] })).error === 'not_yours');
// tidy: 12 planned pairs, cap 10 a day (4 merges already happened today: 6 more fit)
const pairs: string[][] = []; for (let i = 0; i < 12; i++) pairs.push(give('wisplet', 2));
const td = await host.tidy(mu, { idem: idem(), plan: pairs.slice(0, 10) });
check('Tidy-up stops at the daily cap of 10 merges (what ran stays done)', td.ok && td.done === 10 - Number(sql(`select merges_today - ${td.done} from public.wh_accounts where user_id='${mu}'`)) && Number(sql(`select merges_today from public.wh_accounts where user_id='${mu}'`)) === 10, { done: td.done, last: td.results.at(-1)?.error });
// Tidy-up with the longest allowed key: every merge runs under its own sub-key, and a retry replays all of them (added 2026-10-05)
{
  sql(`update public.wh_accounts set merges_today = 0 where user_id='${mu}'`);            // test only: a fresh day for this account
  const pairs64: string[][] = []; for (let i = 0; i < 3; i++) pairs64.push(give('cushlet', 2));
  const k64 = 'a'.repeat(64); const t64 = await host.tidy(mu, { idem: k64, plan: pairs64 }); const again = await host.tidy(mu, { idem: k64, plan: pairs64 });
  check('Tidy-up with a 64-character key: 3 merges under 3 distinct sub-keys, and the retry replays all 3', t64.ok && t64.done === 3 && again.done === 3 && again.results.every((r: any) => r.replayed === true)
    && new Set([0, 1, 2].map((i) => tidySubKey(k64, i))).size === 3, { done: t64.done, errors: t64.results.map((r: any) => r.error) });
}
// REPLAY AUDIT: rebuild each merge from its ledger row (draws, pity before, candidate ownership) and the parents' stored genomes, and compare
{
  const { rollMerge: rm } = await import('./core/merge.ts');
  const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('item', i.id, 'species', i.species_idx, 'code', i.genome_code, 'audit', l.detail, 'parents', (select jsonb_agg(p.genome_code order by array_position(i.parents, p.id)) from public.wh_items p where p.id = any(i.parents)), 'pspecies', (select min(p.species_idx) from public.wh_items p where p.id = any(i.parents)))), '[]'::jsonb) from public.wh_items i join public.wh_ledger l on l.item_id = i.id and l.kind = 'mint' and l.ref_kind = 'merge' where i.origin = 'blend' and i.owner_id = '${mu}'`));
  let same = 0;
  for (const r of rows) {
    const a = r.audit; const pid = SPECIES[r.pspecies]; const owned: Record<string, number> = { [pid]: MERGE_COST };
    for (const [sp, have] of a.candidates) owned[sp] = have;
    const it = r.parents.map((c: string) => ({ species: pid, genome: decodeGenome(c)! }));
    let k = 0; const res = rm(it as never, () => a.draws[k++], { owned, pity: a.pity_before });
    if (res.ok && CATALOG.find((d) => d.id === res.outcome.species)!.idx === r.species && encodeGenome(res.outcome.genome) === r.code) same++;
  }
  check('REPLAY: every merge in the ledger is reproduced exactly (species and genome) from its logged draws, pity, candidate ownership and the parents', rows.length >= 6 && same === rows.length, { merges: rows.length, reproduced: same });
}
check('every merge result is a legal tier move (never below the inputs; at most one up)', sql(`select count(*) from public.wh_items o join public.wh_items p on p.id = any(o.parents) where o.origin='blend' and (o.tier_idx < p.tier_idx or o.tier_idx > p.tier_idx + 1)`) === '0');
check('the conservation view is empty after all of it', sql('select count(*) from public.wh_v_conservation') === '0', sql('select problem from public.wh_v_conservation limit 3'));
console.log(`\n${n - bad}/${n} host checks passed`); process.exit(bad ? 1 : 0);
```

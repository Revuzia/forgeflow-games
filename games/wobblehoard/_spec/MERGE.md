# WOBBLEHOARD module 2: MERGE (two of a kind become one new squishy)

Next-step module document. An engineer should be able to build the whole merge flow, server and client, from this file without a meeting.
Rules and numbers: [`DESIGN.md`](DESIGN.md) 5.6 (the merge rules), 5.9 (supply and outcomes), 5.10 (locks), 6.4 (the ceremony; **linked, not documented here**), 8.3 (dupe-proofing). The code that already exists and is tested: `src/core/merge.ts` (`MERGE_COST`, `previewMerge`, `rollMerge`). The server mint it stands on is [`COLLECTION.md`](COLLECTION.md); trade, which shares the lock, is [`TRADE.md`](TRADE.md).

**Grades.** **[V]** verified by running it in this session. **[R]** read in the repo. **[S]** a DESIGN claim not re-checked. **[G]** general knowledge. **[U]** my assumption or an open question.

**What was run.** The merge commit function (Appendix A) and the reference host (`host_merge`, Appendix B; the whole file is `COLLECTION.md` Appendix B) were exercised against a scratch PostgreSQL 16 with a Supabase stand-in: **36 host checks and the 149-check SQL suite pass** (the merge-specific checks are listed in section 10). A scratch **copy** of the game with `MERGE_COST = 3` was run through the probes to produce the checklist in section 8 (the repository files were not modified). Not run: a real Supabase project, the Edge Function, the ceremony, any UI.

---

## 1. Summary

1. **Rule in one line (DESIGN 5.6):** `MERGE_COST` (2) squishies of the same species, Common to Legendary, are consumed and one new random squishy is minted, never below their tier, always up when the row is finished, up after 4 duds in a row.
2. **The server decides, the client only previews.** The client calls `previewMerge` for exact odds. It **never rolls a real merge**: the host runs `rollMerge` with CSPRNG draws against the account's true ownership and pity counters, and the commit function consumes the inputs and mints the output in one transaction.
3. **Honest preview.** The preview carries an *odds digest*. If the odds the player was shown differ from what the server computes (a trade or merge in another tab changed ownership or pity), the call is refused with `odds_changed` and the new preview, and **nothing is consumed**.
4. **Exact draw order, three draws, always:** 1) tier-up roll, 2) species roll, 3) genome seed. A refused selection consumes zero draws. Logged draws replay a merge exactly: **10 of 10** ledger merges, rebuilt from their logged draws, pity, candidate ownership and the parents' genomes, matched [V].
5. **Result first, theatre second.** The ceremony needs the result up front (`MergeCeremonySpec.result`), so the order is: hold, call, answer, ceremony. A closed tab, a lost response or a crash can never lose or duplicate an item: the answer is committed before any animation starts.
6. **Safety UX from DESIGN:** hold 0.5 s (release early cancels, nothing sent), exact odds, a last-copy warning, hearted items protected, output locked 24 hours (cannot trade or merge), at most 10 merges a day.
7. **Tidy-up** (the only descendant of the six-input blender) is up to 10 independent atomic merges chosen by the client, each with its own sub-key, stopping at the first refusal, sharing the daily cap.
8. **Provenance:** every output stores `origin: 'blend'` and `parents`; the consumed items stay in the table with `consumed_at`; the ledger carries the draws, the odds basis, the pity before and the odds digest.
9. **Flipping `MERGE_COST` to 3** is one line in the game plus **seven edit sites in one probe file**, a config row and a host redeploy; a mismatch between host and database aborts loudly [V]. Full checklist in section 8.
10. **One database function, `wh__commit_merge`,** writes merges. Players cannot call it; only the host (service role) can.
11. **Merge never replaces trade:** DESIGN 5.8 shows merge-only routes cost about as much as waiting for the drop for Rare and above.
12. **Unverified:** the UI, the ceremony wiring, the real-Supabase behaviour.

## 2. Decisions

### 2.1 Inherited from DESIGN

All of 5.6: inputs, output tier rule, finished row always tiers up, pity 4 per input tier, species roll never the input species with unowned weight 1.5, lineage look, no variants, hold 0.5 s, preview, last-copy warning, favourites protected, output locked 24 hours, 10 merges a day, Tidy-up up to 10 spare-pair merges never touching favourites or the last copy. Result first (section 6).

### 2.2 Proposed here

| # | Proposal | Why |
|---|---|---|
| M-1 | The merge request carries an **odds digest**; a stale digest is refused (`odds_changed`) with the fresh preview and nothing is consumed. | "Preview honesty" (DESIGN risk 9): the player must never merge at odds they were not shown. |
| M-2 | "Owned" for the unowned-species weight and the finished-row test counts **every live item of the account**, including locked and reserved ones. | Species ownership is a collection fact, not a trading fact; a locked arrival still means you own the species. |
| M-3 | Tidy-up is N sequential atomic merges (sub-keys `<key>-0` to `<key>-9`), not one big transaction; it stops at the first refusal and what ran stays done. | Each merge changes pity and ownership, so each must be rolled against fresh state; atomic per merge, idempotent as a whole. |
| M-4 | Tidy-up defaults to **Common and Uncommon only** and never touches items on the offer shelf; "Include Rare and above" is an off-by-default toggle. | DESIGN 5.9: Rare-and-above spares are the trade fuel. DESIGN says Tidy-up spares favourites and the last copy; it does not say this, so it is mine [U]. |
| M-5 | A Tidy-up plays the full ceremony only for its **best result** (highest tier, then newest species) and shows the rest as a results list. | Ten full ceremonies would run at least 22 seconds (ten Common merges at 2.2 s each; more for higher tiers). DESIGN 6 specifies no bulk ceremony [U]. |
| M-6 | The merge cap counts **merges**, not inputs, and resets at the **UTC day** (the meter's day). | Same day as the meter and restock. |
| M-7 | Client and host share one tiny pure function, `oddsDigest`, built on `hashString` (FNV-1a, already in `core/rng.ts`). It lives in a new file `src/core/oddsDigest.ts`. | The browser needs it synchronously; it is a staleness check, not a security feature. |

## 3. The flow, end to end

### 3.1 The merge pad (client)

1. **Select a stack** with `copies >= MERGE_COST` (detail card, "Merge"). Mythic stacks show "Mythic squishies can't merge" and no button (the core refuses with `mythic-cannot-merge`).
2. **The inputs are chosen for you:** the newest copies that are not hearted, not locked, not on a live swap and not on the offer shelf, never the keeper unless the player taps it (a last-copy merge). The pad shows `MERGE_COST` slots, each a swatch of that exact copy; tapping a slot lets the player pick another copy of the same species. Unselectable copies carry a reason chip in text ("Locked 5 h", "On a swap", "Hearted", "On your shelf").
3. **The odds preview** (all from `previewMerge`, shown before anything is sent):
   * "Chance to move up to {upTier}: {pct}%" and why: *normal*, **"Your {tier} row is complete: this merge always moves up"** (finished row), or **"Guaranteed: {n} duds in a row"** (pity due); and, when the table chance applies, "{dudsUntilPity} more without moving up and the next one is guaranteed".
   * Every possible result as an icon with name, tier gem, exact probability, and a **NEW** tag where the player owns none (`outcomes`, stay-tier rows first).
   * "You still lack {lackingInTier} in {tier} and {lackingInNextTier} in {nextTier}."
   * "The new squishy is locked for 24 hours." "Merges today: 3 of 10."
   * **Last-copy warning** (`usesLastCopy`): a modal "This uses your last {name}. Merge anyway?", focus on Cancel.
4. **Hold to merge, 0.5 s** (`MERGE_HOLD_MS`): a progress ring fills; releasing early cancels and **nothing is sent**; `Enter` or `Space` held 0.5 s does the same; an accessibility setting allows tap-then-confirm. The label is "Hold to merge".
5. **On completion:** the client writes the request into `pending` (key and arguments) **first**, then calls `wh_merge` with `{ idem, items, odds_digest }`.
6. **While waiting** (typically a few hundred milliseconds [U]): the two bodies stay on the pad, the pad glows (CSS, no audio). After 1.2 s a quiet progress ring appears; at 8 s: "Taking a moment. Your squishies are safe." and the client asks `wh_state`/`wh_inventory` to find out what happened.
7. **On the answer:** `stage.playMergeCeremony` with the server's result (section 7), then the new squishy lands on the pad, a "locked 24 h" chip, and the unseen dot clears when the ceremony ends.
8. **Refusals** show plain text and leave everything as it was: `odds_changed` shows the new preview and says "The odds changed. Have another look."; `locked`, `favourite`, `reserved`, `not_yours` say which copy and why; `daily_cap` says "10 merges today. They're resting until tomorrow."; `frozen` says "Merging is paused for a short while."

### 3.2 Locks, caps and protections

| Rule | Where it is enforced |
|---|---|
| Inputs must be the caller's, unconsumed, **not locked**, **not hearted**, **not reserved by a live trade**, one species, not Mythic, exactly `MERGE_COST` of them | `wh__commit_merge` [V: `not_yours`, `locked`, `favourite`, `reserved`, `mixed_species`, `mythic_cannot_merge`, `wrong_count`] and the core's `resolveInputs` |
| Output locked 24 hours (`merge_lock_hours`): cannot be traded or merged | the commit function sets `locked_until`; trade and merge both check it [V] |
| At most 10 merges per UTC day (`merge_daily_cap`) | commit function counter [V: 10 succeed, the 11th is `daily_cap`] |
| Hearts protect an item from merge and Tidy-up | commit function refuses a hearted input; the UI never selects one |
| Hold 0.5 s, the preview, the last-copy warning | UI policy, not part of the roll (the header of `merge.ts` says so) |
| Kill switch `merging_enabled` | commit function |

### 3.3 Tidy-up

* **Button** in the Hoard header when at least one candidate exists. It opens a plan sheet.
* **Candidates** (`stacks.ts`): for each stack, the `mergeable` copies (not the keeper, not hearted, locked, reserved or on the shelf), grouped newest first in groups of `MERGE_COST`. Stacks are ordered by tier ascending then catalog index, so the flood of Commons is recycled first. Default tiers: Common and Uncommon; a toggle includes Rare and above (M-4). The plan has at most `min(10, 10 - merges_today)` pairs.
* **The sheet** lists the pairs grouped by species with a one-line summary per species of the *first* merge's odds and the note "Odds are recalculated after each merge." It shows the cap ("7 merges left today") and a **single hold 0.5 s** confirms the whole plan.
* **Execution:** `wh_tidy({ idem, plan: [[idA, idB], ...] })`. The host runs the merges one after another, each with the sub-key `<idem>-<i>`, each rolled against freshly read state (pity and ownership change after every merge), and **stops at the first refusal**. What ran stays done [V: Tidy-up stopped at the daily cap with 6 done and a `daily_cap` as the last result].
* **Result:** a results sheet (one row per merge: input species, output species and tier gem, NEW and TIER UP tags) and the full ceremony for the best result only (M-5). Retrying the same Tidy-up key after a lost response re-walks the plan: each sub-key returns its stored result, so the assembled answer is identical.

## 4. Server

### 4.1 Where things run

`wh_merge` and `wh_tidy` are host operations (the TypeScript host of COLLECTION.md section 7.2). The host reads state, previews, rolls and calls `wh__commit_merge`, the only SQL function that writes a merge (Appendix A). The client reaches both through the `forgeflow:rpc` bridge (COLLECTION.md section 8).

### 4.2 The host algorithm (reference code; the whole file is COLLECTION.md Appendix B)

```ts
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
      const r = await merge(uid, { idem: `${req.idem}-${i}`.slice(0, 64).padEnd(16, '0'), items: req.plan[i] });
      results.push(r); if (!r.ok) break;                                                                 // stop at the first refusal; what was done stays done
    }
    return { ok: true, results, done: results.filter((r) => r.ok).length };
  }
```

**In words, per call:**

1. Malformed request (not exactly `MERGE_COST` distinct ids, bad key): `wrong_count` or `bad_payload`.
2. **Early replay:** ask `wh__get_op(uid, idem, args digest)`; a stored answer is returned as it is (and `idem_reuse` if the arguments differ). This runs **before** reading the inputs, because after a successful merge the inputs no longer exist [V: found by a test that failed before this step was added].
3. Read the account state (`wh__read_state`): version, pity, owned counts by species, merges today; read the selected items (`wh__read_items`). Fewer than `MERGE_COST` rows: `not_yours`.
4. Build the `MergeState`: `owned` counts by species **id** from all live items (M-2), `pity` from the account.
5. `previewMerge(inputs, state)`. If it refuses, map the core's hyphenated code to the API's underscored code (`mixed-species` becomes `mixed_species`).
6. **Digest check** (M-1): if the request carries `odds_digest` and it differs from `oddsDigest(preview)`, answer `odds_changed` with the fresh preview. Nothing consumed, no draws taken.
7. `rollMerge(inputs with genomes, csprng, state)` with a recording random function. Exactly three draws are taken (step order below).
8. Commit through `wh__commit_merge` with `expect_version`. On `conflict` (another operation changed the account between the read and the commit) go back to step 3 with fresh state and **fresh draws**: the discarded roll was never shown to anyone, and the conflict does not depend on the draw values, so retrying cannot bias outcomes. After 4 conflicts: `busy`.

### 4.3 The exact draw order (from `merge.ts`; never reorder)

| Draw | Used for | Code |
|---|---|---|
| `u1` | the tier-up roll: `tierUp = u1 < odds.pEff` where `pEff` is the table chance, or 1 if the row is finished or pity is due | `mergeDrawCore` |
| `u2` | the species inside the output tier, by weight (1, or 1.5 for a species the player does not own): `pickWeighted(weights, total, u2)` | `mergeDrawCore` |
| `u3` | the genome seed: `floor(u3 * 2^32)`; the genome is `speciesBaseGenome(species, seed)` with the parents' hue and pattern mixed in by `lineageGenome` | `rollMerge` |

`rollMerge` validates the selection **before** drawing anything and refuses with `{ ok: false, error }` and **zero draws consumed** [V: a refused roll left the random stream untouched]. Pity: the counter of the *input* tier resets on a tier-up and grows by one on a dud (capped at 255); the commit stores the returned `pityAfter` array.

### 4.4 Seeds: how the client previews but the server decides

* The client calls `previewMerge(inputs, mirrorState)`: **no randomness at all**; it returns exact odds from the mirror's ownership counts and pity.
* The client **never calls `rollMerge` for real items.** (Practice merges for ghosts do, in `collection/ghost.ts` only; ghosts never reach the server.) A made-up client seed cannot produce a real item: only the host's roll mints.
* The host's random source is a function: `() => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296`, each value recorded. No seed exists to be recovered. `RngSource` accepts a function (`drops.ts`), so this needs no change to `merge.ts`.
* The preview is as fresh as the mirror. The **odds digest** closes the gap: it summarises exactly what was shown (input species, effective tier-up chance, and every candidate with its probability to 1e-9), and the server refuses if its own preview differs.

```ts
// client (collection/api.ts), sketch
const preview = previewMerge(inputs, mirrorState);               // exact odds; no randomness
if (!preview.ok) return showRefusal(preview.error);
const r = await bridge.rpc('wh_merge', { idem: newKey(), items: ids, odds_digest: oddsDigest(preview) });
if (!r.ok && r.error === 'odds_changed') return showPreview(r.preview);   // fresh odds, nothing was consumed
```

### 4.5 The commit function (`wh__commit_merge`, Appendix A)

In one transaction it: takes the account lock; replays a stored answer for the key; checks `expect_version`; checks the count equals `wh_config.merge_cost` and the host's `cost` equals it (**a mismatch raises and rolls back**, whichever side was deployed first); checks the daily cap; locks the input items **in ascending id order**; checks each is the caller's, unconsumed, unlocked, not hearted, not reserved, one species, not Mythic; checks the host's roll for **internal consistency** without running game math: the output species exists, its tier equals the claimed tier, it is not the input species, the tier is the input tier or one above, `tier_up` agrees, the genome code is well-formed and carries the claimed species and seed, and `pity_after` is six values between 0 and 255 (a violation raises `wh_bad_roll` and rolls back loudly: a host bug, not a player error); then inserts the output (`origin = 'blend'`, `parents`, `locked_until = now + 24 h`), marks the inputs consumed (`consumed_at`, `consumed_by`, version bump, off the shelf), writes the ledger (`consume` per input, `mint` for the output with the audit JSON), stores the pity and the counters, and stores the answer under the key.

What it cannot check is that the *probabilities* were honoured: that is the host's job and the service key's trust (COLLECTION.md 7.2). Detection is statistical: O12 and the replay audit in section 5.

## 5. Audit and provenance

| Where | Field | Content |
|---|---|---|
| `wh_items` (output) | `origin`, `parents`, `born_at`, `locked_until`, `genome_code`, `genome_seed` | `'blend'`, the consumed ids, the lock |
| `wh_items` (inputs) | `consumed_at`, `consumed_by` | the output id; rows are never deleted by the game |
| `wh_ledger` | `consume` (one per input), `mint` (the output) | `ref_kind = 'merge'`, `ref_id` = the output id |
| `wh_ledger.detail` of the `mint` | audit JSON | `draws` (u1, u2, u3), `reason` (roll, finished-row, pity, stay), `odds_basis`, `tier_up_chance`, `pity_before` (six values), `odds_digest`, `cost`, `candidates` (every candidate species with 0 if the player lacked it, else 1) |
| `wh_ops` | the answer under `(user, idem)` | 30 days |

**Replay** (audit tool, section 10 test R1): rebuild `owned` as `{inputSpecies: cost}` plus the logged candidates, `pity = pity_before`, feed the logged `draws` as the random function, call `rollMerge` with the parents' stored genomes (their rows still exist), and compare species and genome code with the output. [V: 10 of 10 matched.]

**Recall** (a bad batch): ops query O11 walks the `parents` links recursively from a tainted set; O4 finds any item that moved or was consumed within 24 hours of arriving (must be empty); the receive lock guarantees a tainted arrival cannot be laundered through a merge for 24 hours (DESIGN 5.10: laundered copies fell from 63 to 0 in the toy ring [S]).

## 6. Failure, retry and "result first"

Rule: **the server commits the result before any animation starts.** A request is written to `pending` before it is sent; a retry carries the same key.

| Situation | What happens | Why nothing is lost or doubled |
|---|---|---|
| The tab is closed during the ceremony | The merge was committed before the ceremony. On the next load the output shows as an unseen item (a "NEW" dot) with a "Replay reveal" button; the inputs are gone | The answer was stored first [V by construction: the commit precedes the reply] |
| The response is lost | The client retries the same key within 5 minutes (a retry after 5 minutes is not made automatically: the Hoard is refreshed instead) | `wh_ops` returns the stored answer [V: replay returned the same item] |
| Double tap, or hold twice | The second call has a new key on inputs that are now consumed: `not_yours` | The inputs are locked by the first commit's rows [V: 20 parallel merges of one pair: one commits] |
| Two devices merge the same pair | One commits; the other gets `conflict` internally, re-reads and gets `not_yours` | `expect_version`, then ownership |
| Something else changed the account in between (a trade, a capsule) | The host retries from fresh state with fresh draws; if the odds shown differ: `odds_changed` | Optimistic concurrency [V: injected bump, retry succeeded]; digest |
| The database lock is busy | `busy`, nothing written; retry with the same key | 3 second `lock_timeout` [V] |
| `merging_enabled` is false | `frozen` | |
| The host crashes before the commit | Nothing happened | |
| The host crashes after the commit | The retry returns the stored answer | |
| A merge is retried after the daily cap was reached by another merge in between | `daily_cap` with the inputs untouched | The cap check precedes any write |
| The ceremony API is missing (an older build) | The plain result card is shown | Every `stage.*` and `audio.*` call is optional |

## 7. Calling the ceremony (types are in `src/contracts.ts`; do not redefine them)

```ts
const r = await collection.merge(items, preview);                 // result first
if (!r.ok) return showRefusal(r);
const parents = items.map((it) => ({ genome: it.genome, tier: tierName(it.tier) }));       // the consumed copies, for the look of the fold
const result = { genome: decodeGenome(r.genome_code)!, tier: tierName(r.tier_idx), tierUp: r.tier_up, isNew: r.is_new };
const spec: MergeCeremonySpec = { parents, result, createBody: (g) => new SoftBody(g) };   // 2 or 3 parents: MERGE_COST
const handle = stage.playMergeCeremony?.(spec, { onBeat });        // render lane; beats: 'press' 'fold' 'charge' 'burst' 'reveal' 'settle'
const snd = audio.mergeStart?.({ tier: result.tier, chargeS: handle ? handle.duration * 0.45 : 0, calm });   // audio lane: hum, squelch, ticks
// from onBeat: at 'burst' call snd?.burst({ tier: result.tier, tierUp: result.tierUp, mythicVariant, durationS });  on abort call snd?.stop()
await handle?.done;                                                 // skippable after 350 ms; the result is never hidden (DESIGN 6.1)
collection.markSeen([r.item_id]);
```

* **Durations, beats, particles, sounds, haptics, the flash budget and Calm effects:** DESIGN 6.1, 6.4 to 6.7. Not repeated here.
* **The ceremony needs the result up front** (`MergeCeremonySpec.result`), so it cannot start before the answer. That is why the order is hold, call, answer, ceremony, and why the wait (section 3.1 step 6) is plain pad glow.
* **Skip:** `handle.skip()` jumps to the final frame with the 120 ms crossfade and fires the remaining beats; the output is placed either way.
* **Feature detection:** `playMergeCeremony`, `mergeStart`, `duck` are optional members; if absent, show the result card (species, tier gem, NEW, TIER UP, lineage swatches) with no animation.
* **Parents count:** `parents.length` is `MERGE_COST` (2 or 3). The render lane clamps to 2 or 3 parents [R: `ceremony.ts` line 436]; see section 8.

## 8. Flipping `MERGE_COST` from 2 to 3 safely

**The owner's rule** (DESIGN 5.6): earning a squishy takes 3 minutes or more of effort, so merge cost is 2; at about 1.5 minutes or less it would be 3. At the chosen meter (100 SP, 3.1 to 3.8 minutes a capsule) the answer is 2, and the sim shows M = 3 fails the "a mergeable set in the first one or two sessions" target (first mergeable set 36.6 minutes against 10.4; 8% and 27% have one by 12 and 25 minutes against 57% and 91%). **The meter rate and M are a pair: 100 SP and M = 2.** Flip only if a real playtest measures the effort per capsule at 1.5 minutes or less, or the owner changes the meter too.

**Checklist (each item was checked in a scratch copy of the game with `MERGE_COST = 3`; the repository was not modified):**

| # | Change | Detail | Checked |
|---|---|---|---|
| 1 | `src/core/merge.ts` | `export const MERGE_COST = 3;` The probe enforces that it is defined once, as a single literal. | [V] |
| 2 | `_harness/probe_economy.ts`: **7 edit sites** | With the constant changed alone the probe fails 3 checks and then **crashes** with a `TypeError` at the first hard-coded pair. Sites (text anchors; lines at the time of writing): the pin `check('MERGE_COST is 2 ...', MERGE_COST === 2)` (line 292); the invalid-selection check with two-element literals `[ids(0)[0], ids(0)[1]]`, `[ids(0)[0], 'nope']`, `[null, null]` (lines 303 and 304); the `{species, genome}` input check built from a two-element array sliced to `MERGE_COST` (line 307); the finished-row loop `owned[id] = 2` (line 349); the pity case `{ [ids(1)[3]]: 2 }` (line 392); the lineage test with exactly two parents and `owned: { ...: 2 }` (line 441). Replace the literals by `MERGE_COST`-sized arrays (`Array.from({ length: MERGE_COST }, ...)`) and `owned = MERGE_COST`; change the pin. **After those edits the probe passed 98 of 98 at M = 3** (the unedited probe passes 98 of 98 at M = 2). | [V] |
| 3 | `probe_catalog.ts`, `probe_genome.ts` | Pass unchanged at M = 3. `probe_app.ts` needs `three` and could not be run in my scratch copy; run it. | [V] / [U] |
| 4 | `_harness/sim_economy.ts` | Reads the constant. It ran at M = 3 (`--quick --days 120`, 2 minutes) and printed `MERGE_COST=3`. Re-run the full sim (about 6 minutes) and **re-quote DESIGN 5.6 to 5.11** before telling anyone the economy is unchanged: DESIGN's M = 3 column already shows the direction (first mergeable set 36.6 minutes). | [V] ran, results not re-quoted |
| 5 | `_spec/DESIGN.md` 5.6 heading, tables and prose; `_spec/CATALOG.md` | The heading says "MERGE_COST = 2"; CATALOG.md is generated: `node _harness/gen_catalog_doc.ts`. | [R] |
| 6 | Database | `update public.wh_config set value = '3' where key = 'merge_cost';` **and** redeploy the host with the new vendored `merge.ts` (the vendor probe fails if they differ). The commit function aborts (`wh_cost_mismatch`) if host and database disagree, so a half-done flip fails loudly instead of corrupting anything. | [V: host 3 against database 2 aborted; the check is symmetric by construction] |
| 7 | Client copy | Never write "two" or "2" for the cost in UI text: derive it (`MERGE_COST`) in `copy.ts`: pad slot count, the "hold to merge" help, tutorial lines, the Tidy-up rule `mergeable >= MERGE_COST`, empty-state text. The odds themselves do not depend on the cost (`previewMerge` at cost 2 and 3 differ only in `cost`, `usesLastCopy` and the not-enough-copies error: probe line 465 [R]). | [R] |
| 8 | Ceremony | `MergeCeremonySpec.parents` is documented "2 or 3" and `ceremony.ts` clamps to 2..3 [R]. **Look at a 3-parent ceremony on a real device**; I did not. | [U] |
| 9 | Tidy-up | Each merge consumes 3 items: the same 10-a-day cap now removes up to 30 items a day. Decide whether the cap stays 10 (it counts merges). | [U] |
| 10 | In-flight state | Merges are atomic and nothing persists mid-merge, so there is nothing to migrate. Existing items are unaffected. Old clients still showing "2" would be wrong: the vendored client bundle and the host must ship together; the host's `cost` check refuses a stale host, and a stale client's request fails with `wrong_count` (it sends 2 ids). | [V] / by construction |

## 9. The merge-specific numbers (DESIGN 5.6, 5.9, for the reader's convenience, not re-derived)

Tier-up chance Common 30%, Uncommon 25%, Rare 20%, Epic 15%, Legendary 10%; a finished row always tiers up; pity after 4 duds; unowned weight x1.5; outcomes over 120 days: 95% tier up, 79% return a species the player owns; about 8.5 merges per player per 100 days; Tidy-up would remove about 17% of item sources [S: DESIGN sim]. A merge is a gamble; trade is exact (DESIGN 5.8).

## 10. Tests

| ID | Check | How | Status |
|---|---|---|---|
| R1 | Replay: every merge in the ledger is reproduced (species and genome) from its logged draws, pity before, candidate ownership and the parents' genomes | host suite | [V] 10 of 10 |
| R2 | A refused selection consumes zero draws; exactly three draws on success | `probe_economy.ts` (existing) and my replay script | [V] |
| R3 | Odds digest: a stale digest returns `odds_changed` with the fresh preview and nothing is consumed; the matching digest proceeds | host suite | [V] |
| R4 | Idempotent replay: the same key returns the same item and consumes nothing more | host suite, SQL T11 | [V] |
| R5 | Early replay works when the inputs no longer exist | host suite (the bug it found) | [V] |
| R6 | 20 parallel merges of the same pair: one commits | SQL T11 | [V] |
| R7 | Concurrent change between read and commit: the host retries on fresh state | host suite | [V] |
| R8 | Locked, hearted, reserved, mixed, Mythic, not-yours, wrong count: refused with the right code | SQL T11, host suite | [V] |
| R9 | 10 merges a UTC day, the 11th `daily_cap`; Tidy-up stops at the cap and keeps what ran | SQL T11, host suite | [V] |
| R10 | A bad host roll (wrong tier, same species, species byte mismatch) is rejected loudly and nothing changes; a cost mismatch aborts | SQL T11 | [V] |
| R11 | Every merge result is a legal tier move; conservation view empty afterwards | host suite | [V] |
| R12 | Distribution: tier-up rates, pity ceiling of 4 duds, finished row always up | `probe_economy.ts` (existing, 300 000 rolls per case) | [V] 98/98 at M = 2 (unedited) and at M = 3 (after the edits) |
| R13 | Client preview equals the server's preview for the same state (same digest) | probe with the shared `oddsDigest` | to build |
| R14 | Receive lock: a received or merge-made item cannot be merged or traded for 24 hours | SQL T1, T14 | [V] |
| R15 | UI: the pad, odds panel, last-copy modal, hold, cap and lock states; keyboard and screen reader; the ceremony call order (result first) with a fake stage | browser harness | to build |
| R16 | The flip checklist (section 8) run as a script in CI against a scratch copy | script | to build |

## 11. Work breakdown (rough, one engineer [U])

| # | Work | Size | Depends on |
|---|---|---|---|
| 1 | `src/core/oddsDigest.ts` (shared, pure) and its probe | S, half a day | none |
| 2 | Host `wh_merge`, `wh_tidy`, `preview` and the commit function in the migration (the reference code exists) | S, 2 days | COLLECTION 1b |
| 3 | Client: merge pad, odds panel, last-copy modal, hold, refusals, `pending` handling | M, 3 days | COLLECTION Hoard |
| 4 | Ceremony wiring (section 7) with fallbacks | S, 1 day | render and audio ceremonies |
| 5 | Tidy-up: plan sheet, execution, results sheet, best-result ceremony | M, 2 to 3 days | 3, 4 |
| 6 | Tests R13, R15, R16; the replay audit as a script | S to M, 2 days | 2 to 5 |
| **Total** | | **about 9 to 11 engineer-days** | |

## 12. Unverified claims and open questions

* Not run on a real Supabase project, through the Edge Function, or in any browser; the UI and the ceremony wiring are specification only.
* **[U]** typical server latency (a few hundred milliseconds), the 1.2 s and 8 s thresholds in 3.1, M-4 and M-5 (Tidy-up defaults and its ceremony), the 5-minute auto-retry window.
* **[R]** the render lane's ceremony supports 2 to 3 parents by its source; I did not see it run.
* The flip checklist was produced from a copy of the game as it stood on 2026-10-02; other lanes were editing `src` at the time. Re-run the scratch flip when someone actually flips.
* The sim was not re-run at M = 3 in full; DESIGN's M = 3 column is quoted, not re-derived.
* Owner decision: whether the merge cap stays at 10 when `MERGE_COST` is 3 (item 9), and whether Tidy-up should protect Rare and above by default (M-4).

---

## Appendix A. Draft SQL: the merge commit function (NOT APPLIED; verified on local PostgreSQL 16 with a stub, 2026-10-02)

The helpers it calls (`wh__flag`, `wh__cfg_int`, `wh__res_free`, `wh__genome_ok`) and the tables are in `COLLECTION.md` Appendix A.

```sql
-- ---- one merge: the HOST ran rollMerge (src/core/merge.ts, three CSPRNG draws, state read at expect_version); this validates and writes ----
create function public.wh__commit_merge(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := (p->>'uid')::uuid; v_idem text := p->>'idem'; v_digest text := p->>'args_digest';
  v_cost integer := public.wh__cfg_int('merge_cost', 2); v_cap integer := public.wh__cfg_int('merge_daily_cap', 10); v_lock integer := public.wh__cfg_int('merge_lock_hours', 24);
  a public.wh_accounts%rowtype; v_prev public.wh_ops%rowtype; v_in uuid[]; v_day integer := floor(extract(epoch from now()) / 86400)::integer;
  v_today integer; n integer; v_sp_lo smallint; v_sp_hi smallint; v_t_lo smallint; v_t_hi smallint;
  v_out_sp smallint := (p->>'out_species_idx')::smallint; v_out_tier smallint := (p->>'out_tier_idx')::smallint; v_up boolean := (p->>'tier_up')::boolean;
  v_seed bigint := (p->>'genome_seed')::bigint; v_code text := p->>'genome_code'; v_def public.wh_species%rowtype;
  v_pity smallint[]; v_new uuid := gen_random_uuid(); v_before integer; v_res jsonb; v_why text;
begin
  if not public.wh__flag('merging_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  v_in := array(select (jsonb_array_elements_text(p->'inputs'))::uuid);
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'merge' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if a.version <> (p->>'expect_version')::integer then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  if cardinality(v_in) <> v_cost or cardinality(array(select distinct unnest(v_in))) <> v_cost then return jsonb_build_object('ok', false, 'error', 'wrong_count'); end if;
  if (p->>'cost')::integer <> v_cost then raise exception 'wh_cost_mismatch' using errcode = 'P0001'; end if;  -- host and DB disagree on MERGE_COST: stop everything
  v_today := case when a.merges_day = v_day then a.merges_today else 0 end;
  if v_today >= v_cap then return jsonb_build_object('ok', false, 'error', 'daily_cap'); end if;
  perform 1 from public.wh_items where id = any(v_in) order by id for update;          -- items ascending (global lock order)
  select count(*), min(species_idx), max(species_idx), min(tier_idx), max(tier_idx) into n, v_sp_lo, v_sp_hi, v_t_lo, v_t_hi
    from public.wh_items where id = any(v_in) and owner_id = v_uid and consumed_at is null;
  if n <> v_cost then return jsonb_build_object('ok', false, 'error', 'not_yours'); end if;
  select case when bool_or(locked_until > now()) then 'locked' when bool_or(fav) then 'favourite'
              when bool_or(not public.wh__res_free(reserved_trade_id, null)) then 'reserved' end into v_why
    from public.wh_items where id = any(v_in);
  if v_why is not null then return jsonb_build_object('ok', false, 'error', v_why); end if;
  if v_sp_lo <> v_sp_hi then return jsonb_build_object('ok', false, 'error', 'mixed_species'); end if;
  if v_t_hi >= 5 then return jsonb_build_object('ok', false, 'error', 'mythic_cannot_merge'); end if;
  select * into v_def from public.wh_species where idx = v_out_sp;
  if not found or v_def.tier_idx <> v_out_tier or v_out_sp = v_sp_lo or v_out_tier not in (v_t_lo, v_t_lo + 1)
     or v_up <> (v_out_tier = v_t_lo + 1) or not public.wh__genome_ok(v_code, v_out_sp, v_seed) then
    raise exception 'wh_bad_roll' using errcode = 'P0001';
  end if;
  v_pity := array(select (jsonb_array_elements_text(p->'pity_after'))::smallint);
  if cardinality(v_pity) <> 6 or exists (select 1 from unnest(v_pity) x where x < 0 or x > 255) then raise exception 'wh_bad_pity' using errcode = 'P0001'; end if;
  select count(*) into v_before from public.wh_items where owner_id = v_uid and species_idx = v_out_sp and consumed_at is null;
  insert into public.wh_items (id, owner_id, species_idx, tier_idx, genome_code, genome_seed, origin, parents, locked_until)
    values (v_new, v_uid, v_out_sp, v_out_tier, v_code, v_seed, 'blend', v_in, now() + make_interval(hours => v_lock));
  update public.wh_items set consumed_at = now(), consumed_by = v_new, version = version + 1, offered_at = null where id = any(v_in);
  insert into public.wh_ledger (kind, item_id, from_user, ref_kind, ref_id) select 'consume', unnest(v_in), v_uid, 'merge', v_new;
  insert into public.wh_ledger (kind, item_id, to_user, ref_kind, ref_id, detail) values ('mint', v_new, v_uid, 'merge', v_new, p->'audit');
  update public.wh_accounts set version = version + 1, merge_pity = v_pity, merges_day = v_day, merges_today = v_today + 1 where user_id = v_uid;
  v_res := jsonb_build_object('ok', true, 'item_id', v_new, 'species_idx', v_out_sp, 'tier_idx', v_out_tier, 'tier_up', v_up, 'genome_code', v_code,
            'is_new', v_before = 0, 'consumed', to_jsonb(v_in), 'pity', to_jsonb(v_pity), 'merges_today', v_today + 1, 'version', a.version + 1);
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'merge', v_digest, v_res);
  return v_res;
end $$;
```

Config rows it reads (seeded in `COLLECTION.md` A.2): `merging_enabled`, `merge_cost`, `merge_daily_cap`, `merge_lock_hours`.

# WOBBLEHOARD module 3: TRADE (required by the owner)

The owner's brief: **"Players collect squishies and trade them with other players. Trading is required."** This is the full v1 specification of trade: rules, state machine, tables, RPCs, the atomic swap, locks and caps, the species-icon board, friend codes, the review screen, block and report, moderation and ops, the kill switch, the ledger, privacy and child safety, integration with the existing portal accounts, tests and a work breakdown. Rules come from [`DESIGN.md`](DESIGN.md) 5.7 to 5.10 and 8; the server mint it stands on is [`COLLECTION.md`](COLLECTION.md); merge is [`MERGE.md`](MERGE.md); the order of work is in [`NEXT_STEPS.md`](NEXT_STEPS.md).

**Grades.** **[V]** verified by running it in this session. **[R]** read in the repo this session. **[S]** a claim DESIGN itself grades [S] (a web search summary; not re-opened here). **[G]** general knowledge, not verified. **[U]** my assumption or an open question.

**What was run.** The draft SQL in Appendix A was loaded into a scratch PostgreSQL 16.14 with a minimal Supabase stand-in (roles, `auth.users`, `auth.uid()` via the `request.jwt.claim.sub` setting, default privileges imitating Supabase's) and exercised by **149 checks** (Appendix C; each psql call is a separate database session, so the "parallel" tests are real concurrent transactions, up to 48 at a time). **All 149 passed on 2026-10-02**, together with 36 host-level checks described in COLLECTION.md. **Not run:** a real Supabase project, PostgREST, the portal, any UI, load tests, and anything about real children. Nothing was written to `supabase/migrations/`; everything marked NOT APPLIED is a draft.

**Revised on 2026-10-05 after a security audit, and NOT run since** (this container has no PostgreSQL; checked by reading only): the grant revocation is
scoped to WH objects and audited (COLLECTION A.0, A.2, A.7); trading switched off now closes every social surface (16.1, a trigger); the report hold
cannot be re-armed and needs reporters who interacted with the account (13); friend-code errors no longer reveal a code's validity (5.3); a counter
keeps the trade's tier, and board trades stay 1 for 1 through proposals and counters (D-T5); the incoming-offer cap holds under concurrency (8.2);
the payload claim is corrected and per-account rate buckets are added (7.4); a moderation hold pauses trades instead of failing them (D-T10).
New checks for each are in Appendix C, marked "added 2026-10-05, not run".

---

## 1. Summary of the design

1. **Item for item, same tier, same count.** A swap moves 1 to 3 real squishies each way, all of one tier. No currency, no tips, no free text, no lopsided deal by construction (DESIGN 5.7).
2. **Only the server moves items.** One database function, `wh__trade_execute`, swaps owners, bumps `trade_count`, locks the arrivals for 24 hours and writes two ledger rows in a single transaction. Clients send item ids and an idempotency key, never item data.
3. **Consent is bound to exact terms.** A confirmation names a `terms_version`. Any change (a counter) bumps the version and voids the other side's consent. A party can only confirm terms the server has recorded as *shown to them* at least 5 seconds earlier. A scam-by-switch race (A counters while B confirms) was run 24 times and never executed unseen terms [V].
4. **Asynchronous by default, live optional.** The board and offline partners need an async protocol, so DESIGN's "both confirm within 60 s" becomes: each confirmation is explicit and version-bound, a proposal lives 24 hours, and a `live` mode re-arms a 60 second window at each step (section 3, D-T1).
5. **Escrow is a reservation, not custody.** The party waiting on an answer has their items reserved; the other side's items are checked and swapped in the same transaction. Reservations expire by themselves when the trade expires (no cron).
6. **Locks and caps close the abuse windows:** 24 hour receive lock (no trading or merging a fresh arrival), 3 completed trades per rolling 24 hours, 1 per partner per rolling 24 hours, new accounts need 2 days and 10 capsules. In a toy laundering ring the dupe-bug spread was 4233 copies with no limits and 5 with the lock, cap and pair limit (DESIGN 5.10 [S: sim]); in my run a mule with 10 tainted copies could place 3 and none could be merged or passed on [V].
7. **Deterministic lock order everywhere:** trade row, then both accounts in ascending id, then items in ascending id. 57 mixed operations (confirm, cancel, merge, shelf, block) over 6 accounts produced zero deadlocks [V].
8. **Species-icon board, no text.** Listings are up to 3 offered items and up to 3 wanted species of one tier. Nobody sees another player's whole Hoard: only an opt-in **offer shelf** (at most 12) and the listing items.
9. **Friend codes:** 8 characters from a 31-letter alphabet (39.6 bits), rotatable, 10 attempts an hour, and a code only ever creates a request the owner must accept.
10. **Strictest-case identity:** other players see a handle (two words from fixed lists plus a number) and an avatar, nothing else. No other player's auth id, email, username or avatar ever leaves the database through a WH function. Trading is **off by default** for every account until the owner decides the age question.
11. **Ops:** a kill switch (`wh_config`), an append-only ledger, a conservation view that must be empty, and an ops query pack (all executed once on the scratch data [V]).
12. **The one honest limit:** the sim says trade makes finishing the shelf about 1.5 to 1.7 times faster, not 2 times, and supplies about a third of Epic-and-above first copies. Section 2 says so plainly and lists levers the owner could pull, none adopted.

## 2. The honest limit, and levers the owner could pull (none adopted)

**The plain statement.** In the economy sim, a regular player who trades finishes all 50 species in about **131 days against 205 solo, a factor of 1.56 at the median (1.69 at p25, 1.52 at p75, 1.57 at p90)** [sim K]. Of all Epic-and-above first copies, about **33% arrive by trade**, 65% by capsule, 1% by merge [sim L]; of a finisher's last five species, 52% arrive by trade [sim L]. A frictionless oracle (everyone willing, no caps) reaches only 1.76 times [sim P]. [All from the canonical run of `_harness/sim_economy.ts`, DESIGN 5.0 (sections K, L, P); behaviour in that sim is assumed, not measured: DESIGN 5.12.] **Trade is specified (not built: NEXT_STEPS section 1), required as a feature, and useful, but with the current rules a player can finish the shelf without trading.** The owner's phrase "trading is required" is met as a module; it is **not** met as a mechanic that forces a player to trade. Trading moves copies; it cannot create them, so the rarest species bound both routes.

**Levers that would raise trade's importance, with their costs. None is adopted; each needs the owner's decision (NEXT_STEPS D-2) and, for any of them, a sim run before code.**

| Lever | What it does | Cost and risk |
|---|---|---|
| L1 Account exclusives: each account's capsules never contain a few species (for example 2 per tier from Rare up, chosen by a hash of the account id); those species can only arrive by trade | Completion truly requires trading; each player is a source of what the others cannot drop | Breaks "free, calm, no gate": a child who cannot trade (age gate, no friends, no sign-in) can **never finish**. Needs per-account odds disclosure (DESIGN 8.1). Sybil accounts become valuable (an alt farm supplies exclusives). The sim must be extended. High design cost. |
| L2 Version groups (a softer L1): two groups A and B at sign-up; each group's capsules lack the other group's 4 to 6 exclusive species | Same, with a simpler story ("friends with the other version") | Same gating risk; group imbalance; confusing for solo players. |
| L3 Fewer drops of the top tiers, more spares of the middle | Raises the share of Epic+ that comes from trade | The sim already tried six catalogs: 1.53x to 1.76x, none at 2x (DESIGN 5.8). Slows everyone. |
| L4 Mandatory trade for the very last species (a "gift" species only a friend can give: a once-per-account friend gift) | A small social moment without gating the shelf | Cheap but gimmicky; still gated by age and friends. |
| L5 Co-op meter bonus: when a friend trades with you, both meters get a small one-time boost (for example 20 SP) | Rewards trading without requiring it | A pressure mechanic (UK Children's Code: no nudge techniques [S]); invites trade farming between alts. |
| L6 Reduce friction (cap 3 to 5, lock 24 h to 12 h, no new-account gate) | Raises the share of willing traders | The sim's oracle row says friction is not the bottleneck (1.76x even with none); it weakens the abuse controls. |
| L7 Seasonal "swap events" (a week where a rotating species is available only by trade) | Time-boxed pull toward trading | Needs seasons (DESIGN risk 3) and creates time pressure (FOMO), which DESIGN 8.4 forbids. |

**Recommendation (not adopted):** ship v1 as designed, measure the real trade share in the first month, and decide on L4 or L2 only if the number disappoints and the age gate is settled.

## 3. Decisions: taken from DESIGN, and where this document deviates

### 3.1 Taken from DESIGN, unchanged

Item-for-item, same tier, same count 1 to 3 (5.7); any spare for any spare ("favour swap", the server checks tier and count only); friend code or board; 24 hour receive lock; 3 completed trades a day (the sim value; "raise to 5 as headroom"); 1 per partner a day; new accounts need 2 days and 10 capsules; server-authoritative atomic swap with a ledger; never trade a share string, code or screenshot; no free-text chat; fixed emotes (6); fixed report reasons; friend codes of 8 characters without look-alike letters, mutual accept, 10 attempts an hour; anonymous alias (adjective plus noun); block and report on every trade card; a global kill switch and an hourly conservation check; `tradeCount` server-only.

### 3.2 Deviations and proposals (D-T)

| # | Deviation or proposal | Why |
|---|---|---|
| **D-T1** | DESIGN 5.7 says "both confirm within 60 s". Here each confirmation is **explicit, bound to a `terms_version`, and server-checked for a 5 second review**; a proposal lives **24 hours** (async); a `mode: 'live'` trade uses a **60 second** window re-armed by each counter. | The board and an offline partner make a literal 60 s rule useless (the other player is never there). The properties the 60 s rule buys (no stale agreements, no switch-after-agree, no indefinitely held items) are provided by version-bound consent, expiry and lazy reservation expiry. The live path keeps the 60 s feel when both are present. |
| D-T2 | An opt-in **offer shelf** (at most 12 items) is the only thing friends can see; a listing exposes at most 3 of its items. | Nobody's full Hoard is visible to anyone: privacy by default. |
| D-T3 | Reservations expire **lazily** (an item is free when the trade holding it is not live). | No cron dependency; expired trades never hold items (tested). |
| D-T4 | Trade caps are **rolling 24 hour windows**, not UTC days. | A UTC-day cap lets you do 3 at 23:59 and 3 at 00:01. Caps matter most for value-moving actions. |
| D-T5 | A board listing is **1 for 1 with up to 3 alternatives on each side**; k-for-k (2 or 3 each) is available through direct proposals to friends. **Enforced** (since 2026-10-05) in `wh_propose_trade` and in `wh_counter_trade`, which also keeps a board counter inside its listing. | Keeps the matching rule trivial and checkable, and keeps strangers to the smallest possible exchange. |
| D-T6 | `trade_enabled` is **false by default**, flipped only by the owner (or a future age/consent flow). | DESIGN open question 1. The strictest default is off. |
| D-T7 | The friend graph is **WH's own** (`wh_friends`), not the portal's `friendships`. | The portal table's RLS lets a user forge an `accepted` row with anyone (section 17). |
| D-T8 | Epic and above need a **1 second hold** on the final confirm, on top of the 5 second review. | Same rule as merge's hold-to-confirm; cheap protection for the 15 most valuable species. |
| D-T9 | `terms_version`, not a time window, is the anti-switch mechanism. | A switch cannot be raced: the confirm names a version. |
| D-T10 | Caps, the global freeze and a **moderation hold** on either party are **non-terminal**: the trade stays alive and nobody's consent changes (a hold answers the generic `unavailable`, so the other party does not learn a hold exists). Every other failure is terminal (`failed`, reason recorded, items released). | A player who hits today's cap can still complete tomorrow if the offer is still alive; a 24 h hold (possibly from false reports) must not destroy an innocent player's swaps. |

## 4. Threat model

Assets: the integrity of the item ledger; players (children first) from scams, pressure and exposure; the owner from legal exposure.

| Attacker goal | Attack | Control | Proved by |
|---|---|---|---|
| Duplicate an item | Replay a confirm; confirm in parallel; double-click | One transaction; `wh_ops` idempotency; trade row lock; status check | T1, T2 |
| Spend one item twice | Offer the same item in many proposals at once | Reservation set by a conditional lock; `reserved_trade_id` checked at commit | T3 |
| Trade what is locked | Offer a fresh arrival or a merge output | `locked_until` checked at propose and at commit | T1, T14 |
| Launder a duped item through merge | Receive, merge away, trade the result | Receive lock covers merge too; merge outputs are locked 24 h; `parents` lets a bad batch be recalled | T14, ops O4 and O11 |
| Switch the terms after the other side agreed | Counter while the other confirms | Confirm names `terms_version`; a counter voids consent; confirm requires that version was shown | T4, T4b |
| Make the other side confirm blind | Skip the review | Server requires `viewed == terms_version` and 5 seconds | T1, T4 |
| Confuse the other side (look-alike species) | Offer a similar-looking item | Review screen shows species **names** and counts, same tier only, exact instance look | UI spec 12 |
| Bypass caps | Parallel confirms; many partners | Caps counted under both account locks, rolling windows | T7, T13 |
| Deadlock the database | Opposite-order operations | Fixed lock order; 3 second `lock_timeout` | T13, T16 |
| Forge ownership or tier | Tampered ids, sizes, tiers, someone else's items | Every id re-validated against `wh_items` under lock; tier checked | T5 |
| Write tables directly | Direct insert, update, delete via PostgREST | RLS on, writes revoked (42501) | T5 |
| Call internals | `wh__trade_execute`, `wh__commit_*` | Execute revoked from anon and authenticated | T5, T11 |
| Map other people's friendships and blocks | Call the helper `wh__are_friends(a, b)` or `wh__blocked(a, b)` with any two auth ids (which are world-readable through the portal's `profiles` table) | Execute revoked on every helper (**found in my own review: Supabase grants EXECUTE on new functions to players by default, so the first draft left them open**); the privilege audit queries O14 and O15 list what players can call and must match the client RPC list exactly | T5, T17c |
| Learn who a child is | Link a handle to a username or email (for example through a direct select of `wh_trades`, whose rows carry the partner's auth id) | WH never returns an auth id, email, username or avatar; `public_id` is separate; profiles stay unread; **no client access to `wh_trades` or `wh_blocks`** | T5, section 5, 17 |
| Reach a child | Guess a friend code; spam requests | 8 characters, 10 attempts an hour, a code only creates a request, rotation, incoming request caps | T9 |
| Harass | Repeated proposals, requests | Block (instant, symmetric), live and incoming caps (held under both account locks), per-account rate buckets, reports with a soft hold | T3b, T10, T17b, T18 |
| Silence an innocent by false reports | A ring files reports, then keeps re-filing them | Only reporters who pass the new-account gate **and interacted with the account in the last 7 days** count; 3 distinct needed; only reports filed after the last hold count; **at most one automatic hold before a person reviews it**; 24 h, never a ban; a hold pauses trades without ending them | T18 |
| Probe friend codes through error answers | Park 10 outgoing requests, then try codes and compare the answers | The redeemer's own limits answer before any code lookup; every target-side failure answers `not_found` | T9 |
| Reach a child whose trading was switched off | An existing friend, a pending request, the shelf | The social gate on every surface plus the switch-off trigger (16.1) | T19 |
| Flood the database | Call PostgREST directly with one's own JWT (the bridge's limits do not apply), large bodies | A body limit at the gateway (to configure, 7.4), per-account rate buckets, every function's own limits | T17b (buckets); the gateway is not tested |
| Cash trading | Sell items for money | Tier parity means no value can be moved by lopsided deals; one-sided species flows are monitored; forbidden in the terms | ops O6, O7 |
| Multi-account farms | Many alts funnelling items | Gate, caps, ops view of bursts and tight clusters | ops O6 to O8, O10 |
| Hijack a session | A compromised game build confirms trades as the player | Cannot be fully prevented by the game; hardening H1: a portal-rendered confirm (section 12.6) | not built |
| Replay captured traffic | Resend a captured request | Idempotent: same key returns the stored result; JWT expiry limits the window | T1, T2 |
| Break the economy by editing a save | Hand-edit localStorage | Local items are ghosts, never sent | COLLECTION C09 |

## 5. Identity, visibility and privacy design

### 5.1 Ids and names

* **`auth.users.id`** (the portal account id) is the internal key of every WH table. **No WH function ever returns another player's auth id.** The game itself is told its *own* id by the portal (`forgeflow:identity`); it must never forward it.
* **`public_id`** (12 random hex characters, `wh_accounts.public_id`) is the only id other players see. It exists so that nothing in WH can be joined to the portal's world-readable `profiles` table (section 17).
* **Handle** = adjective index (0 to 63) + noun index (0 to 63) + a server-assigned two-digit number (10 to 99), unique as a triple (a unique index). Shown as "Jolly Pebble 42". The two word lists live in client data (`src/data/handles.ts`, to write) and are curated by the owner: **all 4096 combinations must be reviewed** (a probe checks every pair against a language-safety list as `probe_catalog.ts` does for species names; the lists themselves are the owner's content decision, NEXT_STEPS D-8). A handle can change at most once every 7 days (an impersonation guard), and every card also shows the partner's avatar squishy and "friends for N days" so a changed name cannot pass as a trusted one.
* **Avatar** = the player's best or chosen squishy rendered from its `genome_code` (a look-only share string; exposes nothing personal).

### 5.2 Who can see what

| Data | Self | Friend | Board viewer | Trade partner via board | Anyone else | Owner/ops (SQL) |
|---|---|---|---|---|---|---|
| Handle, `public_id` | yes | yes | lister only | yes | no | yes |
| Auth id, email, portal username, avatar, level, online status | own only | **never** | **never** | **never** | never | yes (ops only) |
| Whole Hoard | yes | **no** | no | no | no | yes |
| Offer shelf (at most 12, look and species) | yes | yes | no | no | no | yes |
| Listing items (at most 3) and wanted species | yes | no | yes | yes | no | yes |
| Trade history | own trades | own trades | no | own trades | no | yes |
| Friend list, block list | own | no | no | no | no | yes |
| Reports filed | no (not echoed) | no | no | no | no | yes |

WH does not read or write `profiles.is_online`, `current_game_slug` or `last_seen_at`; it exposes no presence at all.

### 5.3 Friend codes

* **Alphabet** `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 characters; no 0, O, 1, I, L), length 8: **39.6 bits, 8.5e11 codes** [V: computed]. Generated with `gen_random_bytes` and rejection sampling (accept a byte below 248 = 31 x 8, so there is no modulo bias).
* **Guessing:** with 1,000,000 live codes, one account at the limit (240 attempts a day) has a 2.8e-4 chance per day of hitting any code; 100 sybil accounts at the limit have 2.8e-2 per day [V: computed]. That is why **a code hit only creates a request** the owner must accept: a lucky guess buys a request the owner can decline, not access. Incoming pending requests are capped at 20 per player and expire after 7 days; a code can be rotated at any time (at most once a minute) and the old one stops working at once [V].
* **Attempts:** every redeem call counts, success or not; 10 an hour per account; the counter is committed even on failure (the function returns, never raises, so the update is not rolled back) [V: the 11th and 12th attempts answer `slow_down` and the counter stands at 10].
* **No oracle:** a wrong code, your own code, a blocked pair, a target that fails the gate, a target at its friend limit and a target with 20 pending requests all answer the same `not_found`. The redeemer's **own** limits (30 friends: `friend_limit`; 10 pending outgoing requests: `too_many_requests`) are checked **before the code is looked up**, so those answers are the same for every code. (Fixed after the 2026-10-05 audit: they used to be checked after the lookup, so an attacker who parked 10 requests could tell valid codes from invalid ones, 10 an hour, without ever creating a request the target could see.)
* **If both players asked each other,** the second redeem completes the friendship [V].
* **No email or username search anywhere.** DESIGN: do not reuse the portal's `find_users` (it searches by email or username) [R: 0003].
* A friend limit of 30 per player bounds a ring's size (my number [U]).

### 5.4 Blocks and reports (rules; the screens are in section 13)

Block is instant and symmetric in effect: it removes the friendship, cancels live trades between the two (items released), cancels pending requests, hides each from the other's board, and makes the other's code and proposals answer the generic `not_found` or `unavailable` [V]. The blocked player is not told. Unblock does not restore the friendship.

## 6. The trade state machine

```
 CLIENT ONLY                                   SERVER (wh_trades.status)
 +--------+  A reviews both sides, 5 s   +-----------------------------------------------+
 | DRAFT  |  cool-down, taps Send  ----> |  PROPOSED   terms_version 1, A confirmed v1   |<-----------------------------+
 +--------+  (wh_propose_trade)          |  A's items reserved                            |   either party: wh_counter_  |
                                         +-----------------------------------------------+   trade (v+1; the counterer's  |
                                           |            |                |                    items reserved; the other's  |
   B (the other party) views v1,           |            |                |                    consent is void)             |
   waits 5 s, wh_confirm_trade             |            |                v                                                 |
                                           |            |        +--------------------+                                    |
                                           v            |        |  COUNTERED         |------------------------------------+
                          +------------------------+    |        |  terms_version N   |   same exits as PROPOSED
                          | BOTH-CONFIRMED         |    |        +--------------------+
                          | (transient: same       |    |
                          |  transaction, recorded |    |  wh_cancel_trade / wh_block / wh_friend_remove /
                          |  as an event only)     |    |  account deleted ------------------------------> +-----------+
                          +------------------------+    |                                                  | CANCELLED |
                               |              |         |  expires_at passes (24 h async, 60 s live,       +-----------+
                  every check passes     a check fails  |  re-armed by a counter) --------------------->  +-----------+
                               v          for good      |                                                  | EXPIRED   |
                         +----------+     v             |                                                  +-----------+
                         | EXECUTED |  +--------+       |
                         +----------+  | FAILED |  reason recorded, items released
                                       +--------+
```

* **draft** exists only in the client. The server never stores an unsent offer.
* **both-confirmed** is a logical state: the second confirmation and the swap are one transaction, so it never rests in the table. If the swap cannot proceed, the trade becomes `failed` (terminal) or the call returns a non-terminal error and nothing is recorded. This is deliberate: a persisted "both confirmed but not executed" state is exactly where dupes and stuck trades come from.
* **Roles:** `a_user` is the initiator of the trade row and never changes; either party can counter. `a_confirmed` and `b_confirmed` hold the `terms_version` each side last confirmed. Both-confirmed means both equal the current `terms_version`.

| Transition | Who | Guards (all re-checked under locks) | Effect |
|---|---|---|---|
| draft to PROPOSED | A, `wh_propose_trade` | Signed in; kill switch on; both pass the gate (trade allowed, not restricted, 2 days, 10 capsules); not blocked; friends or a live listing; no other live trade between the pair; A has at most 3 live outgoing and the partner at most 10 incoming; 1 to 3 items each, equal counts, no duplicates; all items one tier; A's items owned, unlocked, not hearted, not reserved; the partner's items are on their offer shelf, unlocked, not hearted, not reserved; board: items inside the listing and the given species among the listing's wants | Trade row, items snapshot with `item_version`, A's items reserved, `a_confirmed = 1`, expiry set |
| PROPOSED or COUNTERED to COUNTERED | Either party, `wh_counter_trade` | Live and unexpired; `expect_version` equals current; at most 20 versions per trade; same item rules; items of the old terms count as free for this trade | Terms replaced, `terms_version + 1`, the counterer's confirmation set, the other's void, reservations moved to the counterer's items, expiry re-armed |
| to EXECUTED | The party that has not confirmed the current version, `wh_confirm_trade` | Live and unexpired; `expect_version` equals current; the caller was **shown** this version (`viewed == terms_version`) at least 5 seconds ago; kill switch on; both gates; not blocked; friends (friend trades); rolling 24 h caps for both and the pair; every item still owned by the right party, same `version`, unlocked, not hearted, not reserved by another live trade, tier matches | Owners swapped; `trade_count + 1`; `version + 1`; `locked_until = now + 24 h`; reservations and shelf marks cleared; two ledger rows per item pair; both accounts' versions bumped; listing closed |
| to FAILED | the same call | A terminal check failed: gate lost for good (trading switched off), blocked, not friends, items gone or moved or changed or locked or hearted or reserved, size or tier broken | `failed`, `ended_reason` set, items released, event logged. **Committed** (the function returns normally) |
| to CANCELLED | Either party `wh_cancel_trade`; `wh_block`; `wh_friend_remove`; account deletion; trading switched off for either party (the trigger of 16.1) | Live | Items released |
| to EXPIRED | Time (checked lazily by any touch of the trade; no cron) | `expires_at <= now()` | Items released; a stale reservation never blocks anything meanwhile |
| Non-terminal refusals | the same confirm call | kill switch off (`frozen`), `daily_cap`, `partner_daily_cap`, `pair_cap`, or a moderation hold on either party (`unavailable`) | Trade stays alive, nobody's consent changes, no record |

**Time rules.** `async`: 24 hours from the last change of terms. `live`: 60 seconds, re-armed by each counter (a first confirmation does not re-arm). Idempotency keys are kept 30 days.

## 7. Tables, RPCs and error codes

### 7.1 Tables (DDL in Appendix A.1, NOT APPLIED)

| Table | Purpose |
|---|---|
| `wh_friend_codes` | One current code per account (unique, regex-checked) |
| `wh_friend_requests` | A request from a code redemption; one pending per direction; 7 day expiry |
| `wh_friends` | Mutual friendship as ONE row with `user_lo < user_hi` (consent by construction; the portal's two-row scheme can be half-forged) |
| `wh_blocks` | Directional row, symmetric effect |
| `wh_reports` | Fixed reason 1 to 6, no text |
| `wh_rate` | Per-account token buckets (7.4) |
| `wh_listings` | The board: 1 to 3 offered item ids, up to 3 wanted species or `want_open`, one tier, 7 day expiry, at most 3 active per player |
| `wh_trades`, `wh_trade_items`, `wh_trade_events` | The trade, its current terms with an item-version snapshot, an append-only event log (propose, counter, confirm, cancel, expire, fail, execute, emote) |

RLS (Appendix A.1b here, A.2 in `COLLECTION.md`): on for all; **no write privilege for `anon` or `authenticated` on any table**; narrow own-row selects only on `wh_accounts`, `wh_items`, `wh_capsules` and the public `wh_species`. **`wh_trades` and `wh_blocks` have no client access at all**, because their rows carry the *other* player's auth id and a direct select would hand it over (found in my own review of an earlier draft that had a party-select policy; fixed; checked [V]). Everything else is reachable only through the RPCs below. Every RPC refuses a payload over 8 KB (`bad_payload`) as its first step [V on 2026-10-02]; **that is a sanity limit, not protection against large bodies**: PostgREST has already read and parsed the request and Postgres has built the `jsonb` value before the function runs (an earlier version of this paragraph said "before parsing it", which was wrong). The real limits are in 7.4.

### 7.2 The RPC surface (all take one `jsonb` parameter `p` like 0008; all return `{ok, ...}` or `{ok:false, error}`)

All are `SECURITY DEFINER`, `search_path = public`, `lock_timeout = 3s`, executable by `authenticated` only (`anon` revoked), keyed on `auth.uid()` (never on a parameter). The internals (`wh__*`, helpers included) are executable by nobody but `service_role`; there are exactly **28** client RPCs (the 27 checked by the audit query O14 on 2026-10-02 [V], plus `wh_op_status`, added 2026-10-05 and not run), and the migration's own audit (COLLECTION A.7) fails if a player can execute anything else.

| RPC | Input | Output | Notes |
|---|---|---|---|
| `wh_friend_code_get()` | none | `{code}` | creates on first call |
| `wh_friend_code_rotate()` | none | `{code}` | at most once a minute |
| `wh_friend_redeem(p)` | `{code}` | `{requested}` or `{friends}` or `{already_friends}` | 10 attempts an hour; the caller's own limits answer first; every code-side failure is the same `not_found` (5.3) |
| `wh_friend_respond(p)` | `{request_id, accept}` | `{accepted}` | recipient only; accepting needs both sides past the gate (16.1) |
| `wh_friend_list(p)` | none | friends, incoming requests (handles only), outgoing count | empty (with `paused: true`) for a gated caller; gated friends and their requests are left out (16.1) |
| `wh_friend_shelf(p)` | `{friend_ref}` | the friend's offered, unlocked, free items with `is_new_to_you` | friends only, both past the gate |
| `wh_friend_remove(p)` | `{friend_ref}` | `{cancelled_trades}` | cancels live friend trades |
| `wh_shelf_set(p)` | `{item_ids[] up to 12}` | `{offered}` | replaces the whole shelf; refuses hearted, locked, consumed, not-yours |
| `wh_listing_create(p)` | `{items[1..3], wants[0..3], open}` | `{listing_id}` | items on the shelf, one tier, wants of that tier |
| `wh_listing_cancel(p)` | `{listing_id}` | `{ok}` | owner only |
| `wh_board_search(p)` | `{tier?, species?}` | up to 30 listings: `listing_id, lister, handle, tier, offers[], want_species, want_open, you_can_give[]` | excludes own, blocked both ways, ungated listers; rate bucket `search` (7.4) |
| `wh_propose_trade(p)` | `{idem, partner_ref? , listing_id?, give[], get[], mode?}` | `{trade_id, status, terms_version, expires_at}` | 1 for 1 through the board (D-T5); locks both accounts (8.2); rate bucket `offer` |
| `wh_trade_view(p)` | `{trade_id}` | exact terms, `you_give`, `you_receive` (look, species, tier, `trade_count`, `you_own_species`), `you_confirmed`, `they_confirmed`, `confirm_in_ms`, partner handle | **records that this version was shown to this party** |
| `wh_counter_trade(p)` | `{idem, trade_id, expect_version, give[], get[]}` | `{status:'countered', terms_version, expires_at}` | keeps the trade's tier (`tier_mismatch` otherwise); a board trade stays 1 for 1 inside its listing (`bad_size`, `listing_mismatch`); rate bucket `offer` |
| `wh_confirm_trade(p)` | `{idem, trade_id, expect_version}` | `{status:'executed'}` or `{waiting_for_partner}` or an error | executes on the second consent |
| `wh_cancel_trade(p)` | `{idem, trade_id}` | `{status:'cancelled'}` | either party |
| `wh_trade_inbox(p)` | none | live trades and those changed in the last 3 days, with partner handle and confirmation flags | poll every 20 s while a trade panel is open, 60 s otherwise |
| `wh_trade_emote(p)` | `{trade_id, emote 1..6}` | `{ok}` | 1 hello, 2 thanks, 3 wow, 4 oops, 5 bye, 6 good swap; one per 5 s; both parties past the gate |
| `wh_block(p)`, `wh_unblock(p)`, `wh_block_list(p)` | `{partner_ref}` | counts and handles | |
| `wh_report(p)` | `{partner_ref, reason 1..6}` | `{ok}` | 5 a day; the automatic hold rules are in section 13 |
| `wh_handle_set(p)` | `{adj 0..63, noun 0..63}` | `{handle}` | once a week; the number is server-assigned and unique |
| `wh_state`, `wh_inventory`, `wh_op_status`, `wh_set_fav`, `wh_mark_seen` | see COLLECTION.md | | |

**Admin** (plain `update` statements run by the owner in the SQL editor; see section 15): `trade_enabled`, `restricted_until`, `hold_reviewed_at`, `wh_config`.

### 7.4 Payload limits and per-account rates (revised 2026-10-05)

* **What does not protect the database:** the 8 KB check inside each function runs after PostgREST and Postgres have parsed the body (7.1), and
  the portal bridge's guard (16 KB, 8 calls a second: COLLECTION 8.2) covers only calls made through the bridge. Every client RPC is granted to
  `authenticated`, so a player can call PostgREST directly with their own JWT and skip the bridge.
* **Body size: at the edge.** Configure a request-body limit in front of PostgREST for the WH functions (the Supabase API gateway, or a
  Cloudflare Worker in front of the project) [G/U: whether and how the Supabase gateway exposes this setting was not checked]. The Edge Function
  host refuses a large or unannounced body by its `content-length` before reading it (COLLECTION 7.2). Each function also computes its
  idempotency digest only **after** the 8 KB check, so an oversized body is at least not re-serialised and hashed.
* **Call rate: per account, in the database.** `wh__take(uid, bucket)` is a token bucket in `wh_rate` (one row per account and bucket), refilled
  continuously; a call over the rate answers the non-terminal `slow_down` and writes nothing else. Buckets (`wh_config`, tunable without a deploy):
  `offer` (`wh_propose_trade`, `wh_counter_trade`): 30 tokens, 0.1 a second; `search` (`wh_board_search`): 30 tokens, 0.5 a second.
  `wh_friend_redeem` (10 attempts an hour, counted even on failure) and `wh_report` (5 a day) already have stricter limits of their own.
  A replay of a stored answer (same idempotency key) costs no token, so an honest retry is never refused.
* **What remains:** buckets bound each account, not each client: many accounts, or many requests without a valid JWT, are the gateway's job
  (NEXT_STEPS P8). The host operations (COLLECTION 7.4) have no bucket yet (COLLECTION 7.6 P5).

### 7.3 Error codes and player copy (shared with COLLECTION and MERGE)

| Code | Meaning | Player sees |
|---|---|---|
| `not_signed_in`, `no_account` | no session or no account row | "Sign in to trade." |
| `frozen` | a kill switch is on | "Swaps are paused for a short while." |
| `unavailable` | partner, block, gate or typo: **one generic answer** | "That swap can't be sent right now." |
| `not_allowed` | trading not enabled for you | "Trading isn't switched on for your account yet." |
| `too_new` | under 2 days or under 10 capsules | "Trading unlocks after a couple of days of play." |
| `pair_busy` | an open swap with this player already exists | "You already have an open swap with them." |
| `too_many_open` | 3 outgoing live offers | "You have 3 offers waiting. Cancel one to send another." |
| `bad_size`, `bad_items`, `tier_mismatch` | counts, duplicates, mixed tiers | "Both sides need the same number of squishies of the same tier." |
| `not_yours`, `gone`, `locked`, `favourite`, `reserved`, `not_offered`, `changed` | item state | "One of these squishies isn't available. Pick again." (the specific reason is shown in text under the item) |
| `listing_mismatch` | the given species is not what the listing wants | "They are looking for something else." |
| `review_first` | the terms were not shown to you | (UI bug: reload the swap) |
| `wait` (+ `wait_ms`) | the 5 second review has not passed | the button count-down |
| `changed` (+ `terms_version`) | the terms changed under you | "They changed the swap. Have another look." |
| `expired`, `not_pending` | too late | "That swap is over." |
| `daily_cap`, `partner_daily_cap`, `pair_cap` | caps | "You've done 3 swaps today. Try again tomorrow." / "They've done their swaps for today." / "You already swapped with them today." |
| `blocked`, `not_friends` | relationship changed | "That swap isn't possible any more." |
| `slow_down` | rate limit | "A little slower, please." |
| `friend_limit`, `too_many_requests`, `too_many_listings`, `not_offerable` | limits | plain sentence each |
| `busy` | lock timeout | "Busy for a moment. Trying again." (auto retry, same key) |
| `too_many_changes` | a negotiation reached 20 versions | "That swap has been changed too many times. Start a new one." |
| `idem_reuse`, `bad_payload` | client bug (or a payload over 8 KB) | "Something went wrong. Reload and try again." |

## 8. The atomic swap

### 8.1 Algorithm (`wh_confirm_trade` calling `wh__trade_execute`; Appendix A.2)

1. **Lock the trade row** (`for update`). Not a party: `not_found` (no hint a trade exists).
2. **Lock both accounts in ascending `user_id`.**
3. **Idempotency check, after the locks** (check-after-lock): a stored answer for `(caller, idem)` is returned (`replayed: true`); a stored key with a different arguments digest is `idem_reuse`.
4. If the trade is not live: `not_pending`. If `expires_at <= now()`: record `expired`, release items, answer `expired` (committed).
5. `expect_version` must equal `terms_version` (`changed` otherwise). The caller must not already have confirmed it (`waiting_for_partner`).
6. **Review gate:** `viewed_version == terms_version` (else `review_first`) and `now >= viewed_at + 5 s` (else `wait` with the milliseconds left).
7. If the other side has confirmed this version, call `wh__trade_execute`; otherwise record the consent.
8. **Execute** (inside the same transaction): kill switch; both gates; block; friendship (friend trades); rolling 24 hour caps for A, for B and for the pair (counted under both account locks, so two parallel executes involving one account serialise); **lock all items ascending**; per item check: exists and unconsumed, owned by the side the trade says, `version` equals the snapshot, `locked_until` passed, not hearted, not reserved by another live trade, tier equals the trade's. Then one `update` swaps `owner_id`, increments `trade_count` and `version`, sets `locked_until = now() + 24 h`, clears the reservation and the shelf mark; insert one `transfer` ledger row per item; bump both accounts' `version`; close the listing; mark `executed`; log the event.
9. Store the answer under the caller's key (same transaction) and return.

### 8.2 Lock order and why it cannot deadlock

Every function that takes more than one lock takes them in this order: **trade row, then account rows in ascending id, then item rows in ascending id** (`select ... order by id for update`). `wh_cancel_trade`, `wh_counter_trade`, `wh_confirm_trade`, `wh_block`, `wh_friend_remove` follow it literally. `wh_propose_trade` has no trade row yet: it locks **both** accounts in ascending id (since 2026-10-05: with only its own account locked, parallel proposals from different accounts all passed the partner's incoming-offer check, 13 live against a cap of 10 in the audit's test), then the items. `wh_report` locks both accounts in ascending id. The single-account functions (`wh__commit_merge`, `wh__commit_open_capsule`) take their own account first and their items after, which is a prefix of the same order, and they never take a trade row after an account. The rate bucket row (`wh_rate`, 7.4) is only ever taken after the caller's account and before any item, and nothing that holds an item waits for it. The one exception to the order is the trigger that runs when trading is switched off (16.1): it runs inside the update of an account row, so it takes that account's trade rows with `NOWAIT` and never waits in the wrong order (if a trade is being confirmed at that instant, the switch fails with `lock_not_available` and the owner runs it again). A cycle would need a function that takes an item before an account or an account before a trade row: none exists. A `lock_timeout` of 3 seconds on every function turns the (never observed) pathological case into a retryable `busy` instead of a hang [V: a held lock failed fast in 2.5 to 5 s and the same call then succeeded]. [V] 57 mixed operations in parallel over 6 accounts (confirm, cancel, merge, shelf, block): zero deadlocks, the conservation view clean afterwards.

### 8.3 Version columns

* `wh_accounts.version` is bumped by every change of that account's state (capsule, merge, trade). The host's optimistic commits use it.
* `wh_items.version` is bumped by every **economic** change (ownership, lock, consumption), not by cosmetic flags (heart, shelf, seen), so hearting an item does not kill a pending trade of another item. A trade stores each item's version when the terms are set and refuses to execute if it moved.
* `wh_trades.terms_version` is the consent token.

### 8.4 Idempotency

`wh_ops(user_id, idem)` stores the result and a digest of the arguments, written in the same transaction as the effect. Pure rejections are not stored (they have no side effects and re-evaluate on retry); successes and **terminal failures** (which wrote state) are. 20 parallel confirms with one key: all `ok`, 19 `replayed`, one swap. 20 parallel confirms with 20 different keys: exactly one `executed`, 19 `not_pending` [V]. 10 parallel proposals with one key: one trade, every caller gets the same `trade_id` [V].

### 8.5 Failure matrix

| What fails | Result |
|---|---|
| Any unexpected exception inside the transaction (a bug, a full disk, a killed connection) | **Everything rolls back**: owners, status, ledger, reservations, counts unchanged; the trade is still alive; the same confirm can be retried. [V: an injected failure after the swap left nothing moved, and the same confirm then succeeded.] |
| A rule that can never be satisfied (item gone, gate lost, blocked) | The function **returns** (no exception) after setting `failed` and releasing items, so the verdict commits |
| A rule that may pass later (caps, kill switch) | The function returns the error and writes nothing; the trade stays alive |
| Client disconnects mid-call | The call is one statement in one transaction: it completes or is cancelled as a whole [G: PostgREST cancels the query when the HTTP connection drops]. The client re-fetches `wh_trade_view` and `wh_trade_inbox` rather than assuming |
| Lock timeout | `busy`, nothing written; retry with the same key |
| Two parties act at the same moment | Serialised by the trade row lock; the loser sees `changed`, `not_pending` or `waiting_for_partner` |

Isolation level is READ COMMITTED with explicit row locks. SERIALIZABLE would also work but turns contention into serialization failures the client must retry; with this lock order it is not needed.

## 9. Locks and caps, and why

| Rule | Value | Justification (DESIGN 5.10, sim) |
|---|---|---|
| Receive lock | 24 h on traded-in items and merge outputs: cannot trade or merge | "A 24 h lock costs honest players nothing": trades per 1000 players a day 36.1 with no lock, 36.0 with 1 day, 35.4 with 3 days; species owned 44.77 / 44.88 / 44.71. It stops laundering: merge outputs built from dupes 63 to 0 and innocent holders 906 to 170 in the toy ring. |
| Daily cap | 3 completed trades per rolling 24 h per account | The sim value ("raise to 5 as headroom"). Together with the pair limit it is what stops raw giver-side dupe-bug copying: the ring went from 720 copies (lock only) to 5 (lock, cap, pair). |
| Pair cap | 1 per partner per rolling 24 h | Prevents ping-pong between two accounts; part of the 5 / 0 / 1 result. |
| New-account gate | 2 days and 10 capsules opened, both sides | DESIGN 5.7. Raises the cost of throwaway accounts. |
| Live offers | 3 outgoing, 10 incoming per player | Spam and reservation hoarding (my numbers [U]). Both counted under both account locks (8.2). |
| Offer shelf | 12 items | Privacy and the size of what one player can expose (my number [U]). |
| Friends | 30 | Bounds ring size (my number [U]). |
| Rolling windows | not UTC days | Day-boundary gaming. |

[V] in the scratch database: three trades in 24 hours executed, the fourth answered `daily_cap` and stayed alive, and after back-dating the first three by 25 hours the same standing confirm executed; a second trade with the same partner was proposed but answered `pair_cap` at confirm. In a toy ring a mule holding 10 tainted copies placed at most **3** in the first 24 hours (the cap), and the receivers could neither merge nor pass them on (`locked`).

## 10. The wants and offers board (species icons, no text)

**Listing.** A player with at least one item on their offer shelf can post up to **3 active listings**. A listing is: **1 to 3 offered items** (all one tier, all on the shelf, free), and either **1 to 3 wanted species of that tier** or `want_open` ("any of this tier", the favour swap). It lives 7 days (`expires_at`), can be cancelled, and closes when a trade through it executes. Each side of a board trade is **1 for 1** (D-T5): the proposer gives one item, receives one of the listing's offered items. Bigger swaps (2 or 3 each way) are possible between friends. Enforced on the server (since 2026-10-05; not run): a board proposal with more than one item a side answers `bad_size`, and a counter on a board trade must stay 1 for 1 with the lister's item one of the listing's offers and the proposer's item of a wanted species (`listing_mismatch`).

**What a viewer sees.** Icon, species name, tier gem and the unique look of each offered item, the wanted species as icons with names (or "any of this tier"), the lister's handle and avatar. **Nothing else**: no profile, no history, no online status, no free text.

**Matching rule (`wh_board_search`).** A listing is *actionable for me* when it is of the tier I look at, I am not blocked either way, the lister passes the gate, its items are still free, and **I have at least one item on my own offer shelf whose species is in the listing's wants** (or the listing is open). `you_can_give` returns exactly those item ids. A listing is a *perfect match* for me when one of its offered species is also one I do not own (`is_new_to_you` per offered item). Filters: tier, and "offers this species". Results: newest first, at most 30 per call.

**Proposing from the board.** I pick one of `you_can_give` and one of the listing's offered items and call `wh_propose_trade` with `listing_id`. The server re-checks: tier equal, the requested item inside the listing's offered items, my given species among its wants (or open). A mismatch answers `listing_mismatch` [V]. The lister then sees my proposal in their inbox and can counter or confirm. **No instant accept**: nothing on the board ever executes without the lister's review.

**Why not instant accept.** Several proposals for the same listing item can exist; each holds only its own proposer's reservation. When the lister confirms one, the others can no longer succeed: if the lister confirms one of them they fail with `not_yours` (their own `failed` verdict) and release their items [V by the ownership check]. **Known limitation:** the other proposers are not told at once. Cleaning up the other live trades inside the swap would take trade-row locks after item locks and break the lock order of section 8.2, so it is done lazily: their items stay reserved until they cancel or the offer expires (at most 24 hours), and the inbox could compute an `item_gone` flag on read to say so sooner (not in the draft).

**Abuse limits.** 3 active listings; 10 incoming live trades per player; a block hides listings both ways [V]; a listing of a held or ungated account disappears.

## 11. Friend codes: flows

1. **Show my code:** `wh_friend_code_get`. The UI shows it as 8 large characters with a copy button and a "New code" button (`wh_friend_code_rotate`). It never encodes a name or an id.
2. **Enter a friend's code:** a field limited to the 31 allowed characters (the keyboard layout hides the rest; lowercase and a dash are accepted and normalised). `wh_friend_redeem` answers "Request sent" or "That code didn't work" (never says why). 10 attempts an hour.
3. **Accept:** the code's owner sees "Jolly Pebble 42 wants to swap with you" with Accept and Not now (`wh_friend_respond`). Nobody becomes a friend without both actions.
4. **Remove:** `wh_friend_remove` ends the friendship and cancels live friend trades [V].
5. **Sharing the code outside the game** (a parent texting it, a friend saying it at school) is how it travels; the game never asks for contacts, never suggests players and never shows a search box.

## 12. The review screen

One component, used twice: by the proposer before sending ("They will see exactly this") and by the recipient before confirming. Both sides see the **same exact items**.

### 12.1 Content

```
+--------------------------------------------------------+
|  Swap with  (avatar)  Jolly Pebble 42                  |  handle from the fixed lists, their avatar, "friends for 12 days" or "from the board"
|  Same tier: (hexagon) Rare                             |  tier gem + word: the parity is stated, not hidden
|--------------------------------------------------------|
|  YOU GIVE                                              |
|  [live look]  Spirelo     (hexagon) Rare     you have 3|  exact instance, species NAME as text, gem, how many you own
|  [live look]  Zingle      (hexagon) Rare     you have 1|
|--------------------------------------------------------|
|  YOU RECEIVE                                           |
|  [live look]  Petalop     (hexagon) Rare     NEW to you|  or "You have 1"; "traded 2x" if it has history
|  [live look]  Gloopsy     (hexagon) Rare     You have 2|
|--------------------------------------------------------|
|  Arrives locked for 24 hours: you can't swap or merge  |
|  it until then.      You've done 1 of 3 swaps today.   |
|                                                        |
|  [ Not now ]                        [ Swap  (5) ]      |  enabled after 5 s; Epic and above: press and HOLD 1 s
+--------------------------------------------------------+
```

* Two equal-sized lists, "You give" first. The species **name is always text** next to the icon, so look-alike colours cannot confuse. Counts are equal by construction and shown as "2 for 2".
* No value language, no "fair" or "unfair" badge (all swaps are same tier), no pressure copy, no timer except the cool-down. The expiry is shown quietly ("Offer open until tomorrow, 14:00").
* "NEW to you" or "You have N" is information, not a nudge. The look of each copy is rendered from its `genome_code`, so what you see is the exact squishy you will own.
* If the terms changed since the player last looked, a banner "They changed the swap. Have another look." highlights the difference and **restarts the cool-down** (a new version means a new view).

### 12.2 The 5 second cool-down (fat-finger and scam-by-confusion)

The button is disabled and labelled with the count ("Swap (5)", "Swap (4)" ...). It is **server-enforced**, not only drawn: `wh_trade_view` records "this version was shown to you at time T"; `wh_confirm_trade` refuses with `review_first` if the version was never shown and `wait` (with the milliseconds left) before T + 5 s [V]. A script can wait 5 seconds, so this is protection against mistakes and quick-switch tricks, not against a determined bot. The proposer's own consent at send time is gated by the same screen on their client only (they chose both sides themselves); the server does not require it. The tests prove that the server enforces the gate; they do not prove that anyone read the screen.

### 12.3 Hold to confirm for Epic and above (D-T8)

For tiers Epic, Legendary and Mythic the final button is press-and-hold for **1.0 second** with a progress ring (`Enter` or `Space` held, for keyboards). Releasing early cancels. Tap-to-confirm is available under an accessibility setting for players who cannot hold; the 5 second review still applies.

### 12.4 Result

"Swapped!" with the received items, a calm settle animation (Calm effects respected), the line "They're locked for 24 hours", and a quiet "Say thanks" row of the six fixed emotes. No sound beyond the existing tier cues; no confetti.

### 12.5 Accessibility

Focus lands on the heading; the two lists are `role="list"` with each item named "Give: Spirelo, Rare, you have 3"; the count-down is announced once ("You can confirm in 5 seconds") and again when ready; the hold button has an alternative single-activation path; all targets at least 44 by 44 px; contrast pairs from `theme.ts`; nothing relies on colour; the review text is selectable and readable at 200% size.

### 12.6 Hardening H1 (not in v1)

A compromised game build could call `wh_confirm_trade` itself after the 5 seconds. The game cannot prevent that. H1: the portal renders the final confirmation **outside the iframe**: the game asks the portal (`forgeflow:trade_confirm_request {trade_id, expect_version}`), the portal fetches the terms itself with the user's session, shows a plain-text dialog (species names, tiers, counts) and only then calls the RPC. Cost: roughly 3 to 5 days of portal work plus a bridge message; benefit: a build compromise cannot move items without a human click in the portal. Recommended before any open launch to children.

## 13. Block and report: flows

* **Where:** on every trade card, the review screen, the friend list and each listing: a "..." menu with **Block** and **Report**.
* **Block:** a confirm "Blocking removes them from your friends and cancels your swaps with them. They won't be told." One tap on Block. Effects in 5.4. A "Blocked" list with Unblock lives in Settings (handles only).
* **Report:** pick one of six fixed reasons, each a plain sentence, no free text: 1 "Their name bothers me", 2 "Too many offers or requests", 3 "They tried to trick me", 4 "I think they are cheating", 5 "They made me feel uncomfortable", 6 "Something else". Reason 5 also shows "Talk to a grown-up you trust." The reply is always "Thanks. We'll take a look." The reporter is never named to the reported player and never told the outcome. A report does not block; offer Block next to it.
* **Automatic effect** (revised 2026-10-05; the old rule re-armed the hold on every repeat report, so three sybil accounts could keep anyone on hold indefinitely): three **distinct** reporters within 7 days put the reported account on a **24 hour hold** (`restricted_until`) and queue it for human review, but only reporters who (a) pass the new-account gate and (b) **had a real interaction with the account in the last 7 days** count: a trade row between them in either direction (which includes a proposal on its listing), a friend request either way, or a friendship. Only reports filed **after the last automatic hold started** count. **At most one automatic hold until a person has reviewed it** (`hold_reviewed_at`), and after a review at most one per 7 days. It never bans and never touches items; a hold pauses the account's trades without ending them (D-T10) and closes its social surfaces while it lasts (16.1). [V on 2026-10-02 for the original rule: two eligible reporters plus one brand-new account did nothing, a third eligible one held the account, and the held account could neither propose nor be proposed to. The revised rule: T18, added 2026-10-05, not run.]
* **Ops follow-up:** query O9 lists accounts by distinct reporters, blocks received and their hold history. A person decides, sets `hold_reviewed_at` (15.1) and clears or extends the hold; an unreviewed hold lifts by itself after 24 h.

## 14. Moderation and ops

### 14.1 The ops pack

Read-only SQL, run as the owner or `service_role`, in Appendix A.5 (all 15 queries executed against the scratch data without errors [V]; they have not been run on production-like data volumes). O1 conservation (must be empty), O2 duplicated looks, O3 items without a clean birth, **O4 receive-lock bypass (must be empty)**, **O5 cap bypass (no account above 3 in a rolling 24 h)**, O6 rings and funnels (many trades with few partners, or 8 or more distinct partners in 14 days), O7 pairs trading at the cap, O8 account creation bursts and gate progress, O9 abuse signals, O10 suspected macro accounts (capsules per day), **O11 recall by `parents` (recursive)**, O12 what a mint batch became, O13 stale reservations, **O14 and O15 privilege audits (functions and tables a player can use: the lists must match section 7.2 and section 7.1 exactly; run after every migration)**.

### 14.2 What to watch and when to act

| Signal | Looks like | First action |
|---|---|---|
| O1 returns any row | a dupe, a lost item, a bug | **Freeze** (15.1), then investigate with O3, O2, O4 |
| O4 or O5 returns a row | a lock or cap bypass | Freeze trading; the bug is in a function, not a player |
| O6 funnels or O7 tight pairs | sybil farm or laundering | Set `restricted_until` on the accounts; review with O8 and O10 |
| O9 reporters of 3 or more | harassment | Read the reports (reasons only), decide hold or clear |
| O10 many accounts at the daily cap | macros | The meter's cap already limits them; consider the P6 regularity flag (COLLECTION 7.6) |
| O12 shows a burst of one species | a bad roll | Freeze minting; recall with O11 |

### 14.3 Hourly job

A scheduled job runs O1 and, on any row, sets `wh_config.trading_enabled = false` and `merging_enabled = false` and alerts the owner. A daily job calls `select public.wh__purge();` (retention: section 16.4; the function is in Appendix A.5 of COLLECTION.md and tested [V]). Supabase has `pg_cron` as an optional extension [G]; if it is unavailable use the owner's existing scheduler (the repo's daily pipeline) calling a SQL function. The job is not in the draft. **It must be built before launch**: DESIGN 8.3 promises a conservation check "every hour".

## 15. Kill switch, ledger and recall

### 15.1 Kill switch

`wh_config` rows `minting_enabled`, `merging_enabled`, `trading_enabled`, `board_enabled` (JSON `true` or `false`). Every function reads its switch at the start of its transaction, so a transaction already past the check completes and the next one is refused with `frozen`. Trades in flight are not damaged: the confirm answers `frozen` and the trade stays alive for later [V: confirm and propose both refused while the switch was off; the same standing confirm executed after it was switched back on].

```sql
-- FREEZE (SQL editor, service role):
update public.wh_config set value = 'false', updated_at = now() where key in ('trading_enabled', 'merging_enabled', 'minting_enabled', 'board_enabled');
-- THAW:
update public.wh_config set value = 'true', updated_at = now() where key in ('trading_enabled', 'merging_enabled', 'minting_enabled', 'board_enabled');
-- Allow one tester to trade / hold an account:
update public.wh_accounts set trade_enabled = true where public_id = '<their public id>';
update public.wh_accounts set restricted_until = now() + interval '48 hours' where public_id = '<id>';
-- A person reviewed a report hold (13): record it, and clear the hold if it was unfounded:
update public.wh_accounts set hold_reviewed_at = now(), restricted_until = null where public_id = '<id>';
-- Switch trading OFF for an account (also cancels its requests, live trades, listings and shelf: the trigger of 16.1). If it fails with
-- lock_not_available, a trade of that account was being confirmed at that instant: run it again.
update public.wh_accounts set trade_enabled = false where public_id = '<id>';
```

The client reads the flags from `wh_state.flags` and greys the relevant buttons with the `frozen` copy.

### 15.2 The ledger

`wh_ledger` is append-only (a trigger refuses update and delete [V]) with no foreign keys, so it survives account deletion. Kinds: `mint` (capsule, task, restock, starter, merge), `consume` (merge input), `transfer` (trade, with the trade id), `burn` (account deletion). Invariants checked by `wh_v_conservation`: every live item has exactly one mint row; its owner equals the last mint or transfer recipient; every consumed item has a consume row; no item is reserved by an unknown trade; and **mints minus consumes minus burns equals live items**. A cloned row, planted in the scratch data, was flagged by three of those checks [V].

### 15.3 Recall runbook (bad batch, hack or exploit)

1. **Freeze** (15.1). 2. Find the window: O12 (what a mint batch became) and O3. 3. List descendants by merges with **O11** (recursive on `parents`) and trades with `wh_ledger` where `ref_kind = 'trade'` for those item ids. 4. Decide per item: remove (a ledger `burn` row written by an admin function, to be written) or leave. 5. Thaw. There is no automatic undo of trades: items moved by a legitimate trade stay with the receiver unless the owner decides a manual correction, written as an admin transaction that produces ledger rows. **The admin recall function is not in the draft and must be written and tested before launch.**

## 16. Privacy and child safety (design for the strictest case)

Statements marked [S] are the ones DESIGN 3.2 and 8.2 give; I did not re-check them. Everything else about law is [G] and **not legal advice**. The owner needs counsel for the age question.

### 16.1 Controls

| Control | Design |
|---|---|
| No free text anywhere | Handles from fixed lists; emotes 1 to 6; reports with fixed reasons; no chat, voice, photos, location or contacts |
| Minimal identity | A handle and an avatar squishy. No profile page. No other player's auth id, email, portal username, avatar, level or online status ever leaves a WH function |
| High-privacy defaults | Trading **off** until switched on; offer shelf empty until the player adds items; no discoverability (no search, no suggestions) |
| No nudges | No streaks, no countdown FOMO, no push notifications, no "last chance", no social-proof counters; the board shows no popularity numbers (UK Children's Code: no nudge techniques [S]) |
| Data minimisation | WH tables hold the auth id, game data, counters and fixed codes. No IP, device id, free text or per-touch log. Telemetry is aggregate only (COLLECTION 7.12) |
| Parental and age control | The portal has **no age field and no parental flow** [R: a search of `src` and `pages` for age, birth, parental and COPPA terms found only the privacy page text]. `trade_enabled` is the seam: owner-set today, set by a future age/consent flow later. **It cuts every social surface, not only trading** (revised 2026-10-05; the old draft let a gated child still accept friend requests and expose its shelf): while an account fails the gate (trading off, or a moderation hold) it cannot accept a friend request or redeem a code, its friend list and requests are empty, its friends no longer see it or its shelf, emotes are refused, and it is invisible on the board. Switching `trade_enabled` off also **cancels** its pending friend requests both ways, its live trades (items released) and its listings, and empties its offer shelf (trigger `wh_on_trade_disabled`, A.3). Existing friendships are **suspended**, not deleted: owner decision NEXT_STEPS D-17 |
| Safe by construction | Same-tier swaps (no lopsided deals), 24 h lock, caps, review screen, block, report, kill switch |

### 16.2 UK Children's Code and COPPA, as far as DESIGN states them

UK Children's Code (15 standards): high-privacy defaults, profiling off, no nudge techniques, geolocation off [S]. COPPA: verifiable parental consent under 13; the rule was amended on 22 April 2025 (retention limits, more data counts as personal) [S]. DESIGN 8.2: the game collects no personal data of its own; consent is the portal's job; "trading is enabled only for accounts the portal marks as old enough or parent-approved". **What I can add [G]:** the duties depend on whether the service is directed to children or has actual knowledge of a child's age; email sign-up with no age screen is a known risk area; consent age differs by country. **[U/R]** The portal's privacy page says "We do not knowingly collect personal information from children under 13. No account creation is required to play games." [R: `pages/privacy/+Page.tsx`], while real items need an account (an email address): that sentence needs the owner's and counsel's attention before real collecting launches.

### 16.3 Age gating options for the owner (NEXT_STEPS D-5)

| Option | What it is | Cost |
|---|---|---|
| A. Closed beta | `trade_enabled` set by hand for named adults and testers | Zero code; zero risk to children; small audience |
| B. Neutral age screen at portal sign-up, trading only for 13+ (or 16+) | A date-of-birth or age-band question stored in a portal table; a SECURITY DEFINER function sets `trade_enabled` | Portal work; self-declared, so weak; "actual knowledge" duties [G] |
| C. Verifiable parental consent | A third-party flow | Cost and friction; the only real answer if children are the audience |
| D. Adults only | Trading for verified adults | Excludes the toy's likely audience |

Until the owner picks, **A is the only safe default** and is what the draft implements.

### 16.4 Retention and deletion

`wh_ops` idempotency rows: 30 days (play batches 1 day). `wh_trade_events` of finished trades: 13 months for dispute and fraud review, then the events are deleted and the trade row stays [U: a policy for counsel]. Reports: 12 months. All three are enforced by `wh__purge()`, which a daily job must call. The ledger: indefinite (no personal data: pseudonymous uuids). Account deletion: section 16.5.

### 16.5 Account deletion and the one trigger on `auth.users`

`wh__on_user_delete` (Appendix A.3) is a `BEFORE DELETE` trigger on `auth.users`: it cancels the player's live trades, releases reservations, writes a `burn` ledger row for every live item and deletes the items; the account, friend, block and listing rows then go by `ON DELETE CASCADE`. [V: after deleting a user in the scratch database, the burn rows existed, the account was gone and the conservation view was empty.] It does **not** swallow errors: if it ever fails, deleting that user fails visibly (the foreign key from items to accounts is `RESTRICT` on purpose) and ops fixes it, rather than leaving orphan items. The portal already has `on_auth_user_created` on this table [R: 0002, 0003]; this is a second trigger on the same table, on delete, not on insert.

## 17. Integration with the existing portal accounts, friends and profiles

**What exists and what I found [R].**

* `profiles` (0002): `SELECT using (true)`, so **anyone, including `anon`, can read every profile**: `username`, `avatar_url`, `level`, `xp`, `is_online`, `current_game_slug`, `last_seen_at`. `handle_new_user` derives `username` from the user metadata or **the local part of the email address**, so for many users `username` is the first half of their email. The `forgeflow:identity` bridge message gives the game `username` and `avatar_url`.
* `friendships` (0003): the INSERT policy only checks `auth.uid() = user_id` (nothing about `status`), and the UPDATE policy lets either participant set any `status`. So **a user can insert an `accepted` row toward anyone without their consent**, and a requester can flip their own pending request to `accepted`. A single-direction accepted row is therefore not consent.
* `find_users(query)` searches by exact email or partial username and is granted to `anon` and `authenticated`.
* The portal's Friends page (`pages/friends/+Page.tsx`) calls `find_users` and writes `friendships` directly from the browser [R].

**What WH does about each.**

| Existing thing | WH treats it as | Why |
|---|---|---|
| `auth.users.id` and the portal session | **Reused**: the key of every WH table and the identity the portal's JWT carries | One account system; no new sign-in |
| `profiles` | Not read, not written, not joined. FKs point at `auth.users`, not `profiles` | `handle_new_user` can fail silently and leave a user without a profile [R: its `EXCEPTION WHEN OTHERS` block]; the WH tables still work for them. Joining would expose email-derived names |
| `friendships` | Not used as consent. WH has its own `wh_friends` (one row per pair, both parties acted). A **portal-friend hint** is possible later: show "Portal friend" only when **both** directional rows are `accepted`; it still needs a WH friend request accepted in game. Not in v1 | Section above: one-direction rows are forgeable. Even a real portal friend may have found the child by username search |
| `find_users` | Never called by the game or any WH function | DESIGN 8.2 |
| `forgeflow:identity` fields `username`, `avatar_url`, `level` | Ignored. The game displays only the WH handle | Email-derived names |
| `game_saves` (cloud save slots) | Not used for the Hoard | A game can write arbitrary JSON into its own save [R: `saveGameData` merges whatever the game sends]; ownership must never come from it |
| `profiles.is_online`, `current_game_slug` | Not touched | WH exposes no presence |

**Nothing existing is altered.** The migration only creates `wh_*` tables, functions, triggers on its own tables and one trigger on `auth.users`; it does not `ALTER` any existing table, policy or function and does not touch `handle_new_user`, `find_users` or `set_updated_at`. Its grant revocation names the WH objects one by one (COLLECTION A.2): the first draft's `revoke all on all tables in schema public from anon, authenticated` would have stripped the portal's own grants (games, profiles, game_saves, leaderboards, friendships, df_*, bt_*) and broken the site, and the test suite could not see it because the stub held only WH tables (found by the 2026-10-05 audit). The migration now snapshots every privilege of the portal's objects first and fails as a whole if any changed (COLLECTION A.0 and A.7), and the test stub has a portal sentinel table (Appendix B, check in T17c). **Pre-existing exposure the owner should know about (not WH's to fix):** the world-readable `profiles` table and the permissive `friendships` policies are a privacy and consent risk for any children's use of the portal, with or without WH. Recommended separately: restrict `profiles` SELECT to what the UI needs, and make `friendships` writes go through a function that checks the other side.

**Migration practice [R]:** like 0008, one file with its own `begin; ... commit;`, applied by hand (Management API or Dashboard), not re-runnable (a second apply fails at the first `create table` and rolls back whole), ending with a self-test `DO` block that acts as fake signed-in users inside a subtransaction and raises `WH_SELFTEST_FAIL` on any failed check. The project is `qkidwgyapmitrdxnavmi` (accounts live there; `wugox...` is Realtime only) [R: 0008 header, platform.md]. Migration numbering: the next free number after `0008`; `0007` is absent from the repo.

## 18. Test plan

### 18.1 What the harness proves (Appendix C; run 2026-10-02; 149/149)

IDs are the section numbers of the runner. "Parallel" means that many separate database sessions at once. **Checks added on 2026-10-05** (in T3b, T4, T9, T10, T17b, T17c, T18 and the new T19) cover the audit's findings and **have not been run**: there is no PostgreSQL in the container that wrote them.

| ID | Proves | Method |
|---|---|---|
| T1 | Happy path: propose, view, the 5 s wait (`review_first`, `wait`), execute; owners swapped, `trade_count`, 24 h lock, shelf and reservation cleared, two ledger rows; replay of the same confirm returns the stored result; a new key on an executed trade is `not_pending`; key reuse with other arguments is `idem_reuse`; conservation empty; received item cannot be re-offered or merged | sequential |
| T2 | **N parallel acceptors of the same offer:** 20 parallel confirms with 20 keys: exactly one `executed`, 19 `not_pending`, one swap in the ledger. 20 parallel with one key: all `ok`, one execution | 20 sessions |
| T3 | **Double-spend of an item:** 20 parallel proposals of ONE item to 20 friends: exactly one accepted, 19 `reserved`; a merge of a reserved item is refused | 20 sessions |
| T3b | **Incoming cap under concurrency** (added 2026-10-05, not run): 20 friends propose to one account at once: exactly 10 live incoming offers | 20 sessions |
| T4 | Counter bumps the version, moves the reservation, voids the other consent; confirming the old version is `changed`; the other side must view v2 first; executes v2. Added 2026-10-05 (not run): a counter that switches the tier is `tier_mismatch` and leaves the trade as it was | sequential |
| T4b | **Scam-by-switch race:** A counters while B confirms the old terms, 24 pairs, 8 at a time: B only ever executed the terms B had been shown, or was told `changed`; the countered item never moved unseen | 48 sessions |
| T5 | **Tampered payloads (12 kinds):** wrong tier mix, count mismatch, 4 items, someone else's item, duplicate ids, same item both sides, empty, unknown uuid, not a uuid, a 1000-element array, an unshelved item, null arrays; non-friend partner, self partner, short idem, `anon`, signed-out; a stranger viewing or confirming; **direct insert, update, delete; selects of the ledger, config, the conservation view, `wh_trades`, `wh_blocks`, `wh_friends`, `wh_trade_items`; calling `wh__trade_execute` and the helpers `wh__are_friends`, `wh__blocked`, `wh__flag`, `wh__cfg_int`; self-enabling `trade_enabled`**; RLS: a player reads only their own items | sequential |
| T6 | **Partial failure:** an exception injected after the swap: nothing moved, trade still proposed, no ledger rows, reservation intact; the same confirm without the fault succeeds | fault injection |
| T7 | Caps: 3 in 24 h execute, the 4th is `daily_cap` and stays alive; after back-dating 25 h it executes; a second trade with the same partner is `pair_cap` | sequential |
| T8 | Expiry frees items without any job; an expired trade cannot be confirmed and is recorded `expired`; **kill switch**: confirm and propose `frozen`, the trade stays alive, then executes after thaw | sequential |
| T9 | Friend codes: alphabet and length, own and junk codes `not_found`, redeem makes a request not a friendship, only the owner can respond, the 11th attempt is `slow_down` and the counter committed, rotation kills the old code, mutual requests complete. Added 2026-10-05 (not run): with 10 requests parked, a valid and an invalid code get the same `too_many_requests` and nothing reaches the target | sequential |
| T10 | Block mid-trade cancels, releases, unfriends; both sides get the generic answers; board listing, search (`you_can_give`), `listing_mismatch`, a proposal through a listing between non-friends, block hides listings. Added 2026-10-05 (not run): 2 for 2 through the board is `bad_size`, and a board counter can neither grow to 2 for 2 nor leave the listing | sequential |
| T11, T12 | The merge and capsule commit functions: validation, replay, conflict, 20 parallel merges of one pair (one commits), 10 parallel opens with one credit (one opens), bad host rolls rejected loudly, cost mismatch aborts, 10 merges a day then `daily_cap`; 10 parallel first-contact bootstraps make one account and one starter | up to 20 sessions |
| T13 | **Deadlock storm:** 57 mixed operations (confirm, cancel, merge commits, shelf, block) over 6 accounts, 48 at a time: zero deadlocks, conservation clean | 48 sessions |
| T14 | **Laundering ring:** a mule with 10 duplicated items; at most 3 placed in 24 h; receivers cannot merge or pass them on | sequential |
| T15 | Ops: a cloned row is flagged by the conservation view; deleting an account burns its items; conservation clean again | sequential |
| T16 | A held lock fails fast (3 s `lock_timeout`), then the same call succeeds; 10 parallel retries of one propose make one trade; same key different arguments is `idem_reuse` | 10 sessions |
| T17 | `wh_state`, paging, favourites block proposing and merging, friend shelf privacy, handle rules, inbox, emotes, unfriend, seen | sequential |
| T17b | An oversized payload is refused (a sanity limit after parsing, 7.4); a negotiation is capped at 20 versions; deleting an account also deletes its idempotency rows. Added 2026-10-05 (not run): with the `offer` bucket at 3 tokens and no refill, the 4th proposal answers `slow_down` and writes nothing | sequential |
| T17c | **Privilege audit:** the only `wh_` functions a player can execute are the client RPCs (27 on 2026-10-02; 28 with `wh_op_status`) (no helper, no commit function, no trigger function) and `anon` can execute none; players hold SELECT on `wh_species`, `wh_accounts`, `wh_items`, `wh_capsules` and nothing else on any `wh_` table. Added 2026-10-05 (not run): the stub's portal sentinel table and sequence keep their grants after the migration | catalog queries |
| T17d | Retention: `wh__purge()` removes play idempotency rows after 1 day and the others after 30 days and nothing else; players cannot call it | sequential |
| T18 | Reports: the hold needs 3 distinct eligible reporters (a brand-new reporter does not count); the held account cannot trade; report rate limit; unblock keeps the friendship removed; listing cancel. Revised 2026-10-05 (not run): reporters with no interaction do not count; a repeat report cannot re-arm the hold; a second automatic hold needs a review first | sequential |
| T19 | **Trading switched off** (added 2026-10-05, not run): an account on a hold cannot accept a pending request; switching trading off cancels the pending request, the live trade (items released) and the listing and empties the shelf; the gated account sees no friends or requests; its friends no longer see it or its shelf; the friendship is suspended and returns when trading is switched on again | sequential |

### 18.2 How to run it (local, no Supabase needed)

PostgreSQL 16 plus Python 3 and `psql`: load the stub (Appendix B), then the migration in the order given at the top of COLLECTION.md Appendix A (the snapshot A.0 first, the audit A.7 last), then `t_helpers.sql`, set `trade_confirm_cooldown_s` to 5 (the default) and run the runner. A full run is about 80 seconds. The same runner works against a **staging Supabase project** if `call()` is changed to PostgREST requests with test users' JWTs (the Auth admin API creates them over HTTP; no new dependency); never run it against production.

### 18.3 Not covered, to add before launch

**Every check added on 2026-10-05** (run the whole suite first); the request-body limit at the gateway (7.4); through PostgREST (RLS and grants as Supabase really configures them); the Edge Function and the portal bridge end to end; load (hundreds of parallel confirms, a large `wh_items`); the `DO`-block self-test inside the migration (a one-transaction subset of T1, T3, T5 to T8, T11, T12, T15 in the style of 0008's self-test); the hourly conservation job; the admin recall function; the UI.

## 19. Work breakdown (rough, one engineer [U])

| # | Work | Size | Depends on |
|---|---|---|---|
| 1 | Turn Appendix A into the real migration; the self-test DO block; apply to a staging project; run the runner through PostgREST | M, 4 to 5 days | COLLECTION 1b |
| 2 | Handle word lists (owner content), `handles.ts`, language-safety probe over all 4096 pairs | S, 1 to 2 days plus the owner's review | owner |
| 3 | Client: friend codes, friend list, requests, shelf management, handle picker | M, 5 to 6 days | 1 |
| 4 | Client: board (listing editor, search, results) and the species-icon grid | M, 4 to 5 days | 3, icons |
| 5 | Client: the review screen, proposals, counters, inbox, result, emotes, hold-to-confirm, cool-down, accessibility | L, 7 to 9 days | 3 |
| 6 | Client: block, report, blocked list, error copy | S, 2 days | 5 |
| 7 | Portal: allowlist entries for the trade functions (the bridge exists after COLLECTION step 8) | S, 1 day | portal deploy |
| 8 | Ops: hourly conservation job, freeze automation, admin recall function, alerting, the ops pack on staging data | M, 4 to 5 days | 1 |
| 9 | Tests: the DO-block self-test, the through-PostgREST runner, a UI harness script, a load test | M, 4 to 5 days | 1 to 5 |
| 10 | Closed beta with allow-listed adults, then review O1 to O15 weekly | 2 weeks calendar | all |
| 11 | Hardening H1 (portal-rendered confirm) | M, 3 to 5 days | portal |
| **Total** | | **about 30 to 40 engineer-days** after the server mint exists | |

## 20. Unverified claims and open questions

* **Never run on real Supabase:** RLS and grants under PostgREST, `SECURITY DEFINER` ownership, default privileges (the stub imitates them), `lock_timeout` behaviour under pooling, trigger privileges on `auth.users`.
* **[G]:** `pg_cron` availability; PostgREST cancelling a query when the HTTP connection drops; the legal statements in 16.2.
* **[U]:** every cap and limit marked [U] in section 9 (offer shelf 12, friends 30, live offers 3 and 10); the retention periods; the sizes in section 19; the 1 second hold; the choice of 6 reports reasons.
* **Owner questions** (NEXT_STEPS): D-5 age gating (trading stays off until answered), D-2 whether trade should be mandatory for completion, D-8 handle word lists, D-4 account requirements.
* **Not in the draft, needed before launch:** the scheduled jobs (the hourly conservation check with auto-freeze, the daily `wh__purge()` call), the admin recall function, the portal-friend hint, the request-body limit at the gateway (7.4), rate limits on the host operations (the trade and board RPCs have the buckets of 7.4).
* **Revised on 2026-10-05 and not run:** everything listed at the top of this document under "Revised on 2026-10-05". The SQL was checked by reading only; run the whole suite, with the new checks, before anything is applied.
* **Owner decision D-17:** whether friendships are suspended (the draft) or deleted when trading is switched off.
* The scam-by-switch and confirm tests prove the **server** enforces version-bound consent; they do not prove a person reads the screen. The review screen needs usability testing with real players, including children, under the owner's consent rules.

---

## Appendix A. Draft SQL (NOT APPLIED; verified on local PostgreSQL 16 with a stub, 2026-10-02)

Run after `COLLECTION.md` Appendix A.1 (tables for items and accounts) and before its A.2 (row level security, which also covers these tables). All of these belong in one migration file, inside one `begin; ... commit;`; the full order (from the privilege snapshot A.0 to the privilege audit A.7) is at the top of COLLECTION.md Appendix A.

### A.1 Social and trade tables

```sql
-- 5. social + trade -----------------------------------------------------------------------------------------------
create table public.wh_friend_codes (
  user_id uuid primary key references public.wh_accounts(user_id) on delete cascade,
  code text not null unique check (code ~ '^[2-9A-HJKMNP-Z]{8}$'),
  rotated_at timestamptz not null default now()
);
create table public.wh_friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.wh_accounts(user_id) on delete cascade,
  to_user   uuid not null references public.wh_accounts(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(), decided_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  check (from_user <> to_user)
);
create unique index wh_friend_requests_one_pending on public.wh_friend_requests (from_user, to_user) where status = 'pending';
create table public.wh_friends (
  user_lo uuid not null references public.wh_accounts(user_id) on delete cascade,
  user_hi uuid not null references public.wh_accounts(user_id) on delete cascade,
  since timestamptz not null default now(),
  primary key (user_lo, user_hi), check (user_lo < user_hi)
);
create index wh_friends_hi on public.wh_friends (user_hi);
create table public.wh_blocks (
  blocker uuid not null references public.wh_accounts(user_id) on delete cascade,
  blocked uuid not null references public.wh_accounts(user_id) on delete cascade,
  at timestamptz not null default now(),
  primary key (blocker, blocked), check (blocker <> blocked)
);
create index wh_blocks_blocked on public.wh_blocks (blocked);
create table public.wh_reports (
  id bigserial primary key, reporter uuid not null, reported uuid not null, trade_id uuid,
  reason smallint not null check (reason between 1 and 6), at timestamptz not null default now(), status text not null default 'open'
);
create index wh_reports_reported on public.wh_reports (reported, at desc);

create table public.wh_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wh_accounts(user_id) on delete cascade,
  tier_idx smallint not null,
  offer_items uuid[] not null check (cardinality(offer_items) between 1 and 3),
  want_species smallint[] not null default '{}' check (cardinality(want_species) <= 3),
  want_open boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '7 days',
  active boolean not null default true,
  check (want_open or cardinality(want_species) >= 1)
);
create index wh_listings_board on public.wh_listings (tier_idx, created_at desc) where active;

create table public.wh_trades (
  id uuid primary key default gen_random_uuid(),
  a_user uuid not null references public.wh_accounts(user_id) on delete cascade,     -- initiator
  b_user uuid not null references public.wh_accounts(user_id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed','countered','executed','cancelled','expired','failed')),
  mode text not null default 'async' check (mode in ('async','live')),
  via text not null check (via in ('friend','board')),
  listing_id uuid,
  tier_idx smallint not null,
  terms_version integer not null default 1,
  a_confirmed integer not null default 0, b_confirmed integer not null default 0,
  a_viewed integer not null default 0, a_viewed_at timestamptz,
  b_viewed integer not null default 0, b_viewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  expires_at timestamptz not null, executed_at timestamptz, ended_reason text,
  check (a_user <> b_user)
);
create index wh_trades_a on public.wh_trades (a_user, status, expires_at);
create index wh_trades_b on public.wh_trades (b_user, status, expires_at);
create index wh_trades_exec_a on public.wh_trades (a_user, executed_at) where status = 'executed';
create index wh_trades_exec_b on public.wh_trades (b_user, executed_at) where status = 'executed';
create table public.wh_trade_items (
  trade_id uuid not null references public.wh_trades(id) on delete cascade,
  item_id uuid not null, side char(1) not null check (side in ('a','b')),
  item_version integer not null,
  primary key (trade_id, item_id)
);
create index wh_trade_items_item on public.wh_trade_items (item_id);
create table public.wh_trade_events (
  trade_id uuid not null references public.wh_trades(id) on delete cascade,
  seq integer not null, at timestamptz not null default now(), actor uuid, kind text not null, terms_version integer, detail jsonb,
  primary key (trade_id, seq)
);
-- per-account token buckets (7.4; added 2026-10-05, NOT run): one row per account and bucket, refilled continuously by wh__take
create table public.wh_rate (
  user_id uuid not null references public.wh_accounts(user_id) on delete cascade,
  bucket text not null check (bucket ~ '^[a-z]{1,16}$'),
  tokens real not null, at timestamptz not null default now(),
  primary key (user_id, bucket)
);
```

### A.1b Row level security, grants and config seeds (the same block as `COLLECTION.md` A.2, repeated so this document stands alone; run it once, after all the tables)

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

### A.2 Trade functions: helpers, propose, view, cancel, the atomic swap, confirm, counter

```sql
-- ===== trade: propose / view / counter / confirm (executes on the second confirmation) / cancel (DRAFT; tested locally; NOT APPLIED) =====

create function public.wh__ev(p_trade uuid, p_actor uuid, p_kind text, p_ver integer, p_detail jsonb default null) returns void language sql set search_path = public as
$$ insert into public.wh_trade_events (trade_id, seq, actor, kind, terms_version, detail)
   select p_trade, coalesce(max(seq), 0) + 1, p_actor, p_kind, p_ver, p_detail from public.wh_trade_events where trade_id = p_trade $$;

-- the gate every trading account passes (the OTHER side's failure is reported as the same generic code: nothing leaks)
create function public.wh__gate(a public.wh_accounts) returns text language sql stable set search_path = public as
$$ select case when not a.trade_enabled then 'not_allowed'
               when coalesce(a.restricted_until, '-infinity') > now() then 'not_allowed'
               when a.created_at > now() - make_interval(days => public.wh__cfg_int('new_account_days', 2)) then 'too_new'
               when a.capsules_opened < public.wh__cfg_int('new_account_capsules', 10) then 'too_new' end $$;

-- validate the items of one set of terms. Caller has ALREADY locked the items (ascending id). Returns NULL when fine, else the first problem code.
create function public.wh__check_terms(p_trade uuid, p_caller uuid, p_other uuid, p_give uuid[], p_get uuid[], p_need_offered boolean) returns text language plpgsql stable set search_path = public as $$
declare v_bad text; v_tiers integer;
begin
  if cardinality(p_give) not between 1 and 3 or cardinality(p_give) <> cardinality(p_get) then return 'bad_size'; end if;
  if cardinality(array(select distinct unnest(p_give || p_get))) <> cardinality(p_give) + cardinality(p_get) then return 'bad_items'; end if;
  select min(case
      when i.id is null or i.consumed_at is not null then 'gone'
      when i.owner_id <> case when i.id = any(p_give) then p_caller else p_other end then 'not_yours'
      when i.locked_until > now() then 'locked'
      when i.fav then 'favourite'
      when not public.wh__res_free(i.reserved_trade_id, p_trade) then 'reserved'
      when p_need_offered and i.id = any(p_get) and i.offered_at is null then 'not_offered'
    end), count(distinct i.tier_idx) into v_bad, v_tiers
  from unnest(p_give || p_get) as want(id) left join public.wh_items i on i.id = want.id;
  if v_bad is not null then return v_bad; end if;
  if v_tiers <> 1 then return 'tier_mismatch'; end if;
  return null;
end $$;

create function public.wh__release(p_trade uuid) returns void language sql set search_path = public as
$$ update public.wh_items set reserved_trade_id = null where reserved_trade_id = p_trade $$;

-- per-account token bucket (7.4; added 2026-10-05, NOT run). false = over the rate. It never raises, so the refill accounting commits even when
-- the caller then refuses. wh_config 'rate_<bucket>' = {"cap": n, "per_s": r}. Callers take it after their account lock and before any item lock.
create function public.wh__take(p_uid uuid, p_bucket text) returns boolean language plpgsql set search_path = public as $$
declare v_cfg jsonb := (select value from public.wh_config where key = 'rate_' || p_bucket);
        v_cap real := coalesce((v_cfg->>'cap')::real, 30); v_rate real := coalesce((v_cfg->>'per_s')::real, 0.1); v_left real;
begin
  insert into public.wh_rate (user_id, bucket, tokens, at) values (p_uid, p_bucket, v_cap, now()) on conflict (user_id, bucket) do nothing;
  update public.wh_rate set tokens = least(v_cap, tokens + greatest(0, extract(epoch from (now() - at)))::real * v_rate), at = now()
   where user_id = p_uid and bucket = p_bucket returning tokens into v_left;
  if v_left is null or v_left < 1 then return false; end if;
  update public.wh_rate set tokens = tokens - 1 where user_id = p_uid and bucket = p_bucket;
  return true;
end $$;

-- ---------------------------------------------------------------- propose
create function public.wh_propose_trade(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := auth.uid(); v_idem text := p->>'idem'; v_digest text;
  v_give uuid[]; v_get uuid[]; v_listing uuid; v_mode text := coalesce(p->>'mode', 'async');
  a public.wh_accounts%rowtype; b public.wh_accounts%rowtype; v_prev public.wh_ops%rowtype; l public.wh_listings%rowtype;
  v_partner uuid; v_via text; v_err text; v_tier smallint; v_trade uuid := gen_random_uuid(); v_ttl interval; v_res jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  v_digest := md5(p::text);                                                                                        -- only after the size check
  if v_idem is null or v_idem !~ '^[A-Za-z0-9_-]{16,64}$' or v_mode not in ('async', 'live') then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
  begin
    if jsonb_typeof(p->'give') <> 'array' or jsonb_typeof(p->'get') <> 'array' or jsonb_array_length(p->'give') > 3 or jsonb_array_length(p->'get') > 3 then
      return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
    v_give := array(select (jsonb_array_elements_text(p->'give'))::uuid);
    v_get  := array(select (jsonb_array_elements_text(p->'get'))::uuid);
    v_listing := nullif(p->>'listing_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload');
  end;
  if not public.wh__flag('trading_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  -- the partner, found WITHOUT a lock first: by public id (a friend) or through a board listing ...
  if p->>'partner_ref' is not null then select user_id into v_partner from public.wh_accounts where public_id = p->>'partner_ref'; end if;
  if v_listing is not null then
    select * into l from public.wh_listings where id = v_listing and active and expires_at > now();
    if not found then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
    if v_partner is not null and v_partner <> l.user_id then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
    v_partner := l.user_id;
  end if;
  -- ... then BOTH accounts locked in ascending user_id (the global order, 8.2), so the partner's incoming-offer count and the pair check below
  -- cannot be raced by parallel proposals from other accounts (2026-10-05 audit: 20 parallel proposals left 13 live offers against a cap of 10)
  perform 1 from public.wh_accounts where user_id in (v_uid, coalesce(v_partner, v_uid)) order by user_id for update;
  select * into a from public.wh_accounts where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'propose' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if not public.wh__take(v_uid, 'offer') then return jsonb_build_object('ok', false, 'error', 'slow_down'); end if;      -- 7.4; a replay above costs no token
  if public.wh__gate(a) is not null then return jsonb_build_object('ok', false, 'error', public.wh__gate(a)); end if;
  if v_partner is not null then select * into b from public.wh_accounts where user_id = v_partner; end if;
  if b.user_id is null or b.user_id = v_uid or public.wh__gate(b) is not null or public.wh__blocked(v_uid, b.user_id) then
    return jsonb_build_object('ok', false, 'error', 'unavailable');       -- one generic answer: no hint whether a block, a gate or a typo caused it
  end if;
  v_via := case when public.wh__are_friends(v_uid, v_partner) then 'friend' when v_listing is not null then 'board' end;
  if v_via is null then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  -- D-T5: between strangers (through the board) a trade is 1 for 1; 2 or 3 each way only between friends
  if v_via = 'board' and (cardinality(v_give) <> 1 or cardinality(v_get) <> 1) then return jsonb_build_object('ok', false, 'error', 'bad_size'); end if;
  if exists (select 1 from public.wh_trades t where t.status in ('proposed','countered') and t.expires_at > now()
             and ((t.a_user = v_uid and t.b_user = v_partner) or (t.a_user = v_partner and t.b_user = v_uid))) then
    return jsonb_build_object('ok', false, 'error', 'pair_busy'); end if;
  if (select count(*) from public.wh_trades t where t.a_user = v_uid and t.status in ('proposed','countered') and t.expires_at > now()) >= 3 then
    return jsonb_build_object('ok', false, 'error', 'too_many_open'); end if;
  if (select count(*) from public.wh_trades t where t.b_user = v_partner and t.status in ('proposed','countered') and t.expires_at > now()) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  if cardinality(v_give) between 1 and 3 or cardinality(v_get) between 1 and 3 then
    perform 1 from public.wh_items where id = any(v_give || v_get) order by id for update;                 -- items ascending
  end if;
  v_err := public.wh__check_terms(v_trade, v_uid, v_partner, v_give, v_get, true);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  select tier_idx into v_tier from public.wh_items where id = v_give[1];
  if v_listing is not null and (l.tier_idx <> v_tier or not (v_get <@ l.offer_items)
       or not (l.want_open or not exists (select 1 from public.wh_items g where g.id = any(v_give) and g.species_idx <> all (l.want_species)))) then
    return jsonb_build_object('ok', false, 'error', 'listing_mismatch'); end if;
  v_ttl := case v_mode when 'live' then make_interval(secs => public.wh__cfg_int('trade_ttl_live_s', 60)) else make_interval(hours => public.wh__cfg_int('trade_ttl_async_h', 24)) end;
  insert into public.wh_trades (id, a_user, b_user, status, mode, via, listing_id, tier_idx, terms_version, a_confirmed, expires_at)
    values (v_trade, v_uid, v_partner, 'proposed', v_mode, v_via, v_listing, v_tier, 1, 1, now() + v_ttl);
  insert into public.wh_trade_items (trade_id, item_id, side, item_version)
    select v_trade, i.id, case when i.id = any(v_give) then 'a' else 'b' end, i.version from public.wh_items i where i.id = any(v_give || v_get);
  update public.wh_items set reserved_trade_id = v_trade where id = any(v_give);                        -- the waiting party's items are reserved
  perform public.wh__ev(v_trade, v_uid, 'propose', 1);
  update public.wh_accounts set version = version + 1 where user_id = v_uid;
  v_res := jsonb_build_object('ok', true, 'trade_id', v_trade, 'status', 'proposed', 'terms_version', 1, 'expires_at', now() + v_ttl);
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'propose', v_digest, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------- view (records that THIS version was shown to THIS party: the confirm gate reads it)
create function public.wh_trade_view(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := auth.uid(); v_trade uuid; t public.wh_trades%rowtype; v_side char(1); o public.wh_accounts%rowtype; v_cd integer := public.wh__cfg_int('trade_confirm_cooldown_s', 5);
  v_seen integer; v_seen_at timestamptz; v_status text;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin v_trade := (p->>'trade_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select * into t from public.wh_trades where id = v_trade and (a_user = v_uid or b_user = v_uid);
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_side := case when t.a_user = v_uid then 'a' else 'b' end;
  select * into o from public.wh_accounts where user_id = case v_side when 'a' then t.b_user else t.a_user end;
  if t.status in ('proposed','countered') then
    if v_side = 'a' then update public.wh_trades set a_viewed = terms_version, a_viewed_at = now() where id = v_trade and a_viewed <> terms_version;
    else update public.wh_trades set b_viewed = terms_version, b_viewed_at = now() where id = v_trade and b_viewed <> terms_version; end if;
    select * into t from public.wh_trades where id = v_trade;
  end if;
  v_seen_at := case v_side when 'a' then t.a_viewed_at else t.b_viewed_at end;
  v_status := case when t.status in ('proposed','countered') and t.expires_at <= now() then 'expired' else t.status end;
  return jsonb_build_object('ok', true, 'trade_id', t.id, 'status', v_status, 'mode', t.mode, 'via', t.via, 'tier_idx', t.tier_idx, 'terms_version', t.terms_version,
    'you_are', v_side, 'you_confirmed', (case v_side when 'a' then t.a_confirmed else t.b_confirmed end) = t.terms_version,
    'they_confirmed', (case v_side when 'a' then t.b_confirmed else t.a_confirmed end) = t.terms_version,
    'expires_at', t.expires_at, 'confirm_in_ms', greatest(0, ceil(extract(epoch from (coalesce(v_seen_at, now()) + make_interval(secs => v_cd) - now())) * 1000))::integer,
    'partner', jsonb_build_object('ref', o.public_id, 'adj', o.handle_adj, 'noun', o.handle_noun, 'num', o.handle_num),
    'you_give', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'species_idx', i.species_idx, 'tier_idx', i.tier_idx, 'genome_code', i.genome_code, 'trade_count', i.trade_count,
                  'you_own_species', (select count(*) from public.wh_items m where m.owner_id = v_uid and m.species_idx = i.species_idx and m.consumed_at is null)) order by i.id)
                  from public.wh_trade_items ti join public.wh_items i on i.id = ti.item_id where ti.trade_id = t.id and ti.side = v_side), '[]'::jsonb),
    'you_receive', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'species_idx', i.species_idx, 'tier_idx', i.tier_idx, 'genome_code', i.genome_code, 'trade_count', i.trade_count,
                  'you_own_species', (select count(*) from public.wh_items m where m.owner_id = v_uid and m.species_idx = i.species_idx and m.consumed_at is null)) order by i.id)
                  from public.wh_trade_items ti join public.wh_items i on i.id = ti.item_id where ti.trade_id = t.id and ti.side <> v_side), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- cancel (either party, any time before execution)
create function public.wh_cancel_trade(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); v_idem text := p->>'idem'; v_digest text; v_trade uuid; t public.wh_trades%rowtype; v_prev public.wh_ops%rowtype; v_res jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  v_digest := md5(p::text);
  if v_idem is null or v_idem !~ '^[A-Za-z0-9_-]{16,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
  begin v_trade := (p->>'trade_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select * into t from public.wh_trades where id = v_trade and (a_user = v_uid or b_user = v_uid) for update;          -- trade row first
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform 1 from public.wh_accounts where user_id in (t.a_user, t.b_user) order by user_id for update;               -- then accounts ascending
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'cancel' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if t.status not in ('proposed','countered') then return jsonb_build_object('ok', false, 'error', 'not_pending', 'status', t.status); end if;
  perform 1 from public.wh_items where reserved_trade_id = t.id order by id for update;                              -- then items ascending
  perform public.wh__release(t.id);
  update public.wh_trades set status = case when expires_at <= now() then 'expired' else 'cancelled' end, ended_reason = 'cancelled_by_' || case when a_user = v_uid then 'a' else 'b' end, updated_at = now() where id = t.id;
  perform public.wh__ev(t.id, v_uid, 'cancel', t.terms_version);
  v_res := jsonb_build_object('ok', true, 'status', 'cancelled');
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'cancel', v_digest, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------- the atomic swap (internal: the caller holds the trade row lock and both account locks)
create function public.wh__trade_execute(p_trade uuid) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  t public.wh_trades%rowtype; ra public.wh_accounts%rowtype; rb public.wh_accounts%rowtype; v_bad text; v_cnt integer; n_a integer; n_b integer;
  v_cap integer := public.wh__cfg_int('trade_daily_cap', 3); v_pair integer := public.wh__cfg_int('trade_pair_cap', 1); v_lock integer := public.wh__cfg_int('receive_lock_hours', 24);
  v_terminal boolean := true;
begin
  select * into t from public.wh_trades where id = p_trade;
  if not public.wh__flag('trading_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen', 'terminal', false); end if;   -- global switch: the trade stays alive
  select * into ra from public.wh_accounts where user_id = t.a_user;  select * into rb from public.wh_accounts where user_id = t.b_user;
  v_bad := coalesce(public.wh__gate(ra), public.wh__gate(rb));
  -- a moderation hold (restricted_until in the future, both still trade_enabled) is TEMPORARY: like the caps it refuses without ending the trade
  -- (D-T10), and with the generic 'unavailable' so the other party does not learn that a hold exists. Trading switched off stays terminal.
  if v_bad = 'not_allowed' and ra.trade_enabled and rb.trade_enabled then v_bad := 'unavailable'; v_terminal := false; end if;
  if v_bad is null and public.wh__blocked(t.a_user, t.b_user) then v_bad := 'blocked'; end if;
  if v_bad is null and t.via = 'friend' and not public.wh__are_friends(t.a_user, t.b_user) then v_bad := 'not_friends'; end if;
  if v_bad is null then                                                          -- caps are ROLLING 24 h windows, counted under both account locks
    select count(*) into v_cnt from public.wh_trades x where x.status = 'executed' and x.executed_at > now() - interval '24 hours' and (x.a_user = t.a_user or x.b_user = t.a_user);
    if v_cnt >= v_cap then v_bad := 'daily_cap'; v_terminal := false; end if;
    if v_bad is null then
      select count(*) into v_cnt from public.wh_trades x where x.status = 'executed' and x.executed_at > now() - interval '24 hours' and (x.a_user = t.b_user or x.b_user = t.b_user);
      if v_cnt >= v_cap then v_bad := 'partner_daily_cap'; v_terminal := false; end if;
    end if;
    if v_bad is null then
      select count(*) into v_cnt from public.wh_trades x where x.status = 'executed' and x.executed_at > now() - interval '24 hours'
        and ((x.a_user = t.a_user and x.b_user = t.b_user) or (x.a_user = t.b_user and x.b_user = t.a_user));
      if v_cnt >= v_pair then v_bad := 'pair_cap'; v_terminal := false; end if;
    end if;
  end if;
  if v_bad is null then
    perform 1 from public.wh_items where id in (select item_id from public.wh_trade_items where trade_id = p_trade) order by id for update;     -- items ascending
    select count(*) filter (where side = 'a'), count(*) filter (where side = 'b') into n_a, n_b from public.wh_trade_items where trade_id = p_trade;
    if n_a <> n_b or n_a not between 1 and 3 then v_bad := 'bad_size';
    else
      select min(case
          when i.id is null or i.consumed_at is not null then 'gone'
          when i.owner_id <> case ti.side when 'a' then t.a_user else t.b_user end then 'not_yours'
          when i.version <> ti.item_version then 'changed'
          when i.locked_until > now() then 'locked'
          when i.fav then 'favourite'
          when not public.wh__res_free(i.reserved_trade_id, p_trade) then 'reserved'
          when i.tier_idx <> t.tier_idx then 'tier_mismatch' end) into v_bad
      from public.wh_trade_items ti left join public.wh_items i on i.id = ti.item_id where ti.trade_id = p_trade;
    end if;
  end if;
  if v_bad is not null then
    if v_terminal then                                                           -- can never succeed: record it, free the items, COMMIT (no exception)
      perform public.wh__release(p_trade);
      update public.wh_trades set status = 'failed', ended_reason = v_bad, updated_at = now() where id = p_trade;
      perform public.wh__ev(p_trade, null, 'fail', t.terms_version, jsonb_build_object('reason', v_bad));
    end if;
    return jsonb_build_object('ok', false, 'error', v_bad, 'terminal', v_terminal);
  end if;
  update public.wh_items i set owner_id = case ti.side when 'a' then t.b_user else t.a_user end, trade_count = i.trade_count + 1, version = i.version + 1,
         locked_until = now() + make_interval(hours => v_lock), reserved_trade_id = null, offered_at = null
    from public.wh_trade_items ti where ti.trade_id = p_trade and ti.item_id = i.id;
  insert into public.wh_ledger (kind, item_id, from_user, to_user, ref_kind, ref_id, detail)
    select 'transfer', ti.item_id, case ti.side when 'a' then t.a_user else t.b_user end, case ti.side when 'a' then t.b_user else t.a_user end, 'trade', p_trade, jsonb_build_object('terms_version', t.terms_version)
    from public.wh_trade_items ti where ti.trade_id = p_trade;
  update public.wh_accounts set version = version + 1 where user_id in (t.a_user, t.b_user);
  update public.wh_listings set active = false where id = t.listing_id;
  update public.wh_trades set status = 'executed', executed_at = now(), updated_at = now(), a_confirmed = terms_version, b_confirmed = terms_version where id = p_trade;
  perform public.wh__ev(p_trade, null, 'execute', t.terms_version);
  return jsonb_build_object('ok', true, 'executed', true, 'trade_id', p_trade);
end $$;

-- ---------------------------------------------------------------- confirm: records the caller's consent for ONE terms version; the second consent executes in the same transaction
create function public.wh_confirm_trade(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := auth.uid(); v_idem text := p->>'idem'; v_digest text; v_trade uuid; v_expect integer;
  t public.wh_trades%rowtype; v_prev public.wh_ops%rowtype; v_side char(1); v_viewed integer; v_viewed_at timestamptz; v_cd integer := public.wh__cfg_int('trade_confirm_cooldown_s', 5);
  v_mine integer; v_theirs integer; v_ex jsonb; v_res jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  v_digest := md5(p::text);
  if v_idem is null or v_idem !~ '^[A-Za-z0-9_-]{16,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
  begin v_trade := (p->>'trade_id')::uuid; v_expect := (p->>'expect_version')::integer; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select * into t from public.wh_trades where id = v_trade and (a_user = v_uid or b_user = v_uid) for update;          -- LOCK ORDER 1: the trade row
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform 1 from public.wh_accounts where user_id in (t.a_user, t.b_user) order by user_id for update;               -- LOCK ORDER 2: both accounts, ascending id
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'confirm' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if t.status not in ('proposed','countered') then return jsonb_build_object('ok', false, 'error', 'not_pending', 'status', t.status); end if;
  if t.expires_at <= now() then                                                    -- lazy expiry: record it and free the items
    perform 1 from public.wh_items where reserved_trade_id = t.id order by id for update;
    perform public.wh__release(t.id);
    update public.wh_trades set status = 'expired', ended_reason = 'expired', updated_at = now() where id = t.id;
    perform public.wh__ev(t.id, null, 'expire', t.terms_version);
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if v_expect is distinct from t.terms_version then return jsonb_build_object('ok', false, 'error', 'changed', 'terms_version', t.terms_version); end if;
  v_side := case when t.a_user = v_uid then 'a' else 'b' end;
  v_viewed := case v_side when 'a' then t.a_viewed else t.b_viewed end;  v_viewed_at := case v_side when 'a' then t.a_viewed_at else t.b_viewed_at end;
  v_mine := case v_side when 'a' then t.a_confirmed else t.b_confirmed end;  v_theirs := case v_side when 'a' then t.b_confirmed else t.a_confirmed end;
  if v_mine = t.terms_version then return jsonb_build_object('ok', true, 'status', t.status, 'waiting_for_partner', true); end if;
  if v_viewed <> t.terms_version then return jsonb_build_object('ok', false, 'error', 'review_first'); end if;             -- you must have been SHOWN these exact terms
  if now() < v_viewed_at + make_interval(secs => v_cd) then
    return jsonb_build_object('ok', false, 'error', 'wait', 'wait_ms', ceil(extract(epoch from (v_viewed_at + make_interval(secs => v_cd) - now())) * 1000)::integer); end if;
  if v_theirs = t.terms_version then
    v_ex := public.wh__trade_execute(t.id);
    if (v_ex->>'ok')::boolean is not true then
      if (v_ex->>'terminal')::boolean then                                         -- side effects were written (trade failed): remember the answer for replays
        insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'confirm', v_digest, v_ex);
      end if;
      return v_ex;
    end if;
    v_res := jsonb_build_object('ok', true, 'status', 'executed', 'trade_id', t.id);
  else
    if v_side = 'a' then update public.wh_trades set a_confirmed = terms_version, updated_at = now() where id = t.id;
    else update public.wh_trades set b_confirmed = terms_version, updated_at = now() where id = t.id; end if;
    perform public.wh__ev(v_trade, v_uid, 'confirm', t.terms_version);
    v_res := jsonb_build_object('ok', true, 'status', t.status, 'waiting_for_partner', true);
  end if;
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'confirm', v_digest, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------- counter: either party replaces BOTH sets of terms; the counterer's consent is implied, the other side's is void
create function public.wh_counter_trade(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := auth.uid(); v_idem text := p->>'idem'; v_digest text; v_trade uuid; v_expect integer; v_give uuid[]; v_get uuid[];
  t public.wh_trades%rowtype; v_prev public.wh_ops%rowtype; v_side char(1); v_other uuid; v_err text; v_res jsonb; v_ver integer;
  v_ttl interval; v_me public.wh_accounts%rowtype; l public.wh_listings%rowtype; v_a uuid[]; v_b uuid[]; v_tier smallint;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  v_digest := md5(p::text);
  if v_idem is null or v_idem !~ '^[A-Za-z0-9_-]{16,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
  begin
    v_trade := (p->>'trade_id')::uuid; v_expect := (p->>'expect_version')::integer;
    if jsonb_typeof(p->'give') <> 'array' or jsonb_typeof(p->'get') <> 'array' or jsonb_array_length(p->'give') > 3 or jsonb_array_length(p->'get') > 3 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
    v_give := array(select (jsonb_array_elements_text(p->'give'))::uuid); v_get := array(select (jsonb_array_elements_text(p->'get'))::uuid);
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select * into t from public.wh_trades where id = v_trade and (a_user = v_uid or b_user = v_uid) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform 1 from public.wh_accounts where user_id in (t.a_user, t.b_user) order by user_id for update;
  select * into v_prev from public.wh_ops where user_id = v_uid and idem = v_idem;
  if found then
    if v_prev.op <> 'counter' or v_prev.args_digest <> v_digest then return jsonb_build_object('ok', false, 'error', 'idem_reuse'); end if;
    return v_prev.result || '{"replayed":true}'::jsonb;
  end if;
  if not public.wh__take(v_uid, 'offer') then return jsonb_build_object('ok', false, 'error', 'slow_down'); end if;      -- 7.4
  if not public.wh__flag('trading_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  if t.status not in ('proposed','countered') or t.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'not_pending', 'status', t.status); end if;
  if v_expect is distinct from t.terms_version then return jsonb_build_object('ok', false, 'error', 'changed', 'terms_version', t.terms_version); end if;
  if t.terms_version >= 20 then return jsonb_build_object('ok', false, 'error', 'too_many_changes'); end if;                -- a negotiation is not a chat
  v_side := case when t.a_user = v_uid then 'a' else 'b' end;  v_other := case v_side when 'a' then t.b_user else t.a_user end;
  select * into v_me from public.wh_accounts where user_id = v_uid;
  if public.wh__gate(v_me) is not null or public.wh__blocked(v_uid, v_other) then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  -- D-T5 also binds counters: a board trade (a_user = the proposer, b_user = the lister) stays 1 for 1, the lister's item one of the listing's
  -- offers and the proposer's item of a wanted species (2026-10-05 audit: strangers could counter their way to 3 for 3)
  if t.via = 'board' then
    if cardinality(v_give) <> 1 or cardinality(v_get) <> 1 then return jsonb_build_object('ok', false, 'error', 'bad_size'); end if;
    v_a := case v_side when 'a' then v_give else v_get end;  v_b := case v_side when 'a' then v_get else v_give end;
    select * into l from public.wh_listings where id = t.listing_id;
    if not found or not (v_b <@ l.offer_items)
       or not (l.want_open or exists (select 1 from public.wh_items g where g.id = v_a[1] and g.species_idx = any (l.want_species))) then
      return jsonb_build_object('ok', false, 'error', 'listing_mismatch'); end if;
  end if;
  perform 1 from public.wh_items where id in (select item_id from public.wh_trade_items where trade_id = t.id union select unnest(v_give || v_get)) order by id for update;
  v_err := public.wh__check_terms(t.id, v_uid, v_other, v_give, v_get, true);        -- items this trade already reserves count as free here
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  -- a counter keeps the trade's tier: tier_idx is what both review screens state ("Same tier: Rare"); another tier is refused, never switched
  select tier_idx into v_tier from public.wh_items where id = v_give[1];
  if v_tier is distinct from t.tier_idx then return jsonb_build_object('ok', false, 'error', 'tier_mismatch'); end if;
  perform public.wh__release(t.id);                                                -- the previous waiting party's reservation goes away
  v_ver := t.terms_version + 1;
  v_ttl := case t.mode when 'live' then make_interval(secs => public.wh__cfg_int('trade_ttl_live_s', 60)) else make_interval(hours => public.wh__cfg_int('trade_ttl_async_h', 24)) end;
  delete from public.wh_trade_items where trade_id = t.id;
  insert into public.wh_trade_items (trade_id, item_id, side, item_version)
    select t.id, i.id, case when i.id = any(v_give) then v_side else case v_side when 'a' then 'b' else 'a' end end, i.version from public.wh_items i where i.id = any(v_give || v_get);
  update public.wh_items set reserved_trade_id = t.id where id = any(v_give);
  update public.wh_trades set status = 'countered', terms_version = v_ver, expires_at = now() + v_ttl, updated_at = now(),
      a_confirmed = case when v_side = 'a' then v_ver else 0 end, b_confirmed = case when v_side = 'b' then v_ver else 0 end where id = t.id;
  perform public.wh__ev(t.id, v_uid, 'counter', v_ver);
  v_res := jsonb_build_object('ok', true, 'status', 'countered', 'terms_version', v_ver, 'expires_at', now() + v_ttl);
  insert into public.wh_ops (user_id, idem, op, args_digest, result) values (v_uid, v_idem, 'counter', v_digest, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------- privileges: client RPCs for authenticated only; internals for nobody
revoke all on function public.wh__commit_open_capsule(jsonb), public.wh__commit_merge(jsonb), public.wh__trade_execute(uuid), public.wh__check_terms(uuid,uuid,uuid,uuid[],uuid[],boolean),
  public.wh__release(uuid), public.wh__ev(uuid,uuid,text,integer,jsonb), public.wh__gate(public.wh_accounts), public.wh__genome_ok(text,smallint,bigint),
  public.wh__take(uuid, text) from public, anon, authenticated;
grant execute on function public.wh__commit_open_capsule(jsonb), public.wh__commit_merge(jsonb) to service_role;
revoke all on function public.wh_propose_trade(jsonb), public.wh_trade_view(jsonb), public.wh_cancel_trade(jsonb), public.wh_confirm_trade(jsonb), public.wh_counter_trade(jsonb) from public, anon;
grant execute on function public.wh_propose_trade(jsonb), public.wh_trade_view(jsonb), public.wh_cancel_trade(jsonb), public.wh_confirm_trade(jsonb), public.wh_counter_trade(jsonb) to authenticated;
```

### A.3 Friend codes, shelf, board, block, report, deletion trigger, conservation view

```sql
-- ===== friend codes, shelf, board, block, report, account deletion, ops views (DRAFT; tested locally; NOT APPLIED) =====

create function public.wh__new_code() returns text language plpgsql volatile set search_path = public, extensions as $$
declare alpha constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; b bytea; o text; i integer; x integer;
begin
  loop
    o := '';
    while length(o) < 8 loop
      b := gen_random_bytes(16);
      for i in 0..15 loop
        x := get_byte(b, i);
        if x < 248 and length(o) < 8 then o := o || substr(alpha, (x % 31) + 1, 1); end if;   -- 248 = 31 x 8: rejection sampling, no modulo bias
      end loop;
    end loop;
    exit when not exists (select 1 from public.wh_friend_codes where code = o);
  end loop;
  return o;
end $$;

create function public.wh_friend_code_get() returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); v_code text;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  perform 1 from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select code into v_code from public.wh_friend_codes where user_id = v_uid;
  if v_code is null then v_code := public.wh__new_code(); insert into public.wh_friend_codes (user_id, code) values (v_uid, v_code); end if;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

create function public.wh_friend_code_rotate() returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); v_code text; v_at timestamptz;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  perform 1 from public.wh_accounts where user_id = v_uid for update;
  select rotated_at into v_at from public.wh_friend_codes where user_id = v_uid;
  if v_at is not null and v_at > now() - interval '1 minute' then return jsonb_build_object('ok', false, 'error', 'slow_down'); end if;
  v_code := public.wh__new_code();
  insert into public.wh_friend_codes (user_id, code) values (v_uid, v_code) on conflict (user_id) do update set code = excluded.code, rotated_at = now();
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- a code only ever creates a REQUEST: the code's owner still has to accept (so a lucky guess buys nothing but a request they can decline)
create function public.wh_friend_redeem(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare
  v_uid uuid := auth.uid(); v_code text := upper(regexp_replace(coalesce(p->>'code', ''), '[\s-]', '', 'g')); a public.wh_accounts%rowtype; v_owner uuid; o public.wh_accounts%rowtype; v_rev uuid;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  if a.redeem_window_at is null or a.redeem_window_at < now() - interval '1 hour' then a.redeem_window_at := now(); a.redeem_attempts := 0; end if;
  if a.redeem_attempts >= 10 then
    return jsonb_build_object('ok', false, 'error', 'slow_down', 'retry_after_s', ceil(extract(epoch from (a.redeem_window_at + interval '1 hour' - now())))::integer);
  end if;
  update public.wh_accounts set redeem_window_at = a.redeem_window_at, redeem_attempts = a.redeem_attempts + 1 where user_id = v_uid;   -- every attempt counts; the function RETURNS (never raises) so this commits
  if public.wh__gate(a) is not null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  -- the caller's OWN limits come BEFORE any code lookup, so their answers are the same for every code (2026-10-05 audit: checked after the lookup,
  -- they told a caller with 10 parked requests which codes were valid, without ever creating a request the target could see). A player at these
  -- limits can still accept an incoming request with wh_friend_respond.
  if (select count(*) from public.wh_friends where v_uid in (user_lo, user_hi)) >= 30 then return jsonb_build_object('ok', false, 'error', 'friend_limit'); end if;
  if (select count(*) from public.wh_friend_requests where from_user = v_uid and status = 'pending' and expires_at > now()) >= 10 then return jsonb_build_object('ok', false, 'error', 'too_many_requests'); end if;
  if v_code !~ '^[2-9A-HJKMNP-Z]{8}$' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select user_id into v_owner from public.wh_friend_codes where code = v_code;
  if v_owner is null or v_owner = v_uid or public.wh__blocked(v_uid, v_owner) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;   -- same answer for all of: wrong, own, blocked
  select * into o from public.wh_accounts where user_id = v_owner;
  if public.wh__gate(o) is not null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if public.wh__are_friends(v_uid, v_owner) then return jsonb_build_object('ok', true, 'already_friends', true); end if;
  -- the TARGET's limits answer like a wrong code
  if (select count(*) from public.wh_friends where v_owner in (user_lo, user_hi)) >= 30 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select id into v_rev from public.wh_friend_requests where from_user = v_owner and to_user = v_uid and status = 'pending' and expires_at > now() for update;
  if v_rev is not null then                                                     -- they already asked me: this is the acceptance
    insert into public.wh_friends (user_lo, user_hi) values (least(v_uid, v_owner), greatest(v_uid, v_owner)) on conflict do nothing;
    update public.wh_friend_requests set status = 'accepted', decided_at = now() where id = v_rev;
    return jsonb_build_object('ok', true, 'friends', true);
  end if;
  if (select count(*) from public.wh_friend_requests where to_user = v_owner and status = 'pending' and expires_at > now()) >= 20 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  insert into public.wh_friend_requests (from_user, to_user) values (v_uid, v_owner) on conflict do nothing;
  return jsonb_build_object('ok', true, 'requested', true);
end $$;

create function public.wh_friend_respond(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); r public.wh_friend_requests%rowtype; v_accept boolean := coalesce((p->>'accept')::boolean, false);
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin select * into r from public.wh_friend_requests where id = (p->>'request_id')::uuid and to_user = v_uid for update;
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  if not found or r.status <> 'pending' or r.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_accept then
    if public.wh__blocked(r.from_user, r.to_user) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    -- the age/consent seam (16.1): nobody gains a friend while either side fails the gate (trading off or a moderation hold); same generic answer
    if exists (select 1 from public.wh_accounts x where x.user_id in (r.from_user, r.to_user) and public.wh__gate(x) is not null) then
      return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if (select count(*) from public.wh_friends where r.from_user in (user_lo, user_hi)) >= 30 or (select count(*) from public.wh_friends where v_uid in (user_lo, user_hi)) >= 30 then
      return jsonb_build_object('ok', false, 'error', 'friend_limit'); end if;
    insert into public.wh_friends (user_lo, user_hi) values (least(r.from_user, r.to_user), greatest(r.from_user, r.to_user)) on conflict do nothing;
  end if;
  update public.wh_friend_requests set status = case when v_accept then 'accepted' else 'declined' end, decided_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'accepted', v_accept);
end $$;

-- offer shelf: the ONLY items another player can ever see or request
create function public.wh_shelf_set(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); v_ids uuid[]; v_ok integer;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin
    if jsonb_typeof(p->'item_ids') <> 'array' or jsonb_array_length(p->'item_ids') > 12 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
    v_ids := array(select distinct (jsonb_array_elements_text(p->'item_ids'))::uuid);
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  perform 1 from public.wh_accounts where user_id = v_uid for update;
  perform 1 from public.wh_items where owner_id = v_uid and (id = any(v_ids) or offered_at is not null) order by id for update;
  select count(*) into v_ok from public.wh_items where id = any(v_ids) and owner_id = v_uid and consumed_at is null and not fav and (locked_until is null or locked_until <= now());
  if v_ok <> cardinality(v_ids) then return jsonb_build_object('ok', false, 'error', 'not_offerable'); end if;
  update public.wh_items set offered_at = null where owner_id = v_uid and offered_at is not null and not (id = any(v_ids));
  update public.wh_items set offered_at = coalesce(offered_at, now()) where id = any(v_ids);
  return jsonb_build_object('ok', true, 'offered', cardinality(v_ids));
end $$;

create function public.wh_listing_create(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); a public.wh_accounts%rowtype; v_items uuid[]; v_want smallint[]; v_open boolean := coalesce((p->>'open')::boolean, false); v_tier smallint; v_id uuid;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  if not public.wh__flag('board_enabled') or not public.wh__flag('trading_enabled') then return jsonb_build_object('ok', false, 'error', 'frozen'); end if;
  begin
    if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') not between 1 and 3 or jsonb_array_length(coalesce(p->'wants', '[]'::jsonb)) > 3 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
    v_items := array(select (jsonb_array_elements_text(p->'items'))::uuid);
    v_want := array(select distinct (jsonb_array_elements_text(coalesce(p->'wants', '[]'::jsonb)))::smallint);
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found or public.wh__gate(a) is not null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if (select count(*) from public.wh_listings where user_id = v_uid and active and expires_at > now()) >= 3 then return jsonb_build_object('ok', false, 'error', 'too_many_listings'); end if;
  perform 1 from public.wh_items where id = any(v_items) order by id for update;
  if (select count(*) from public.wh_items i where i.id = any(v_items) and i.owner_id = v_uid and i.consumed_at is null and i.offered_at is not null and not i.fav
        and (i.locked_until is null or i.locked_until <= now())) <> cardinality(v_items) then return jsonb_build_object('ok', false, 'error', 'not_offerable'); end if;
  select min(tier_idx) into v_tier from public.wh_items where id = any(v_items);
  if (select count(distinct tier_idx) from public.wh_items where id = any(v_items)) <> 1
     or (cardinality(v_want) > 0 and (select count(*) from public.wh_species s where s.idx = any(v_want) and s.tier_idx = v_tier) <> cardinality(v_want))
     or (not v_open and cardinality(v_want) = 0) then return jsonb_build_object('ok', false, 'error', 'tier_mismatch'); end if;
  insert into public.wh_listings (user_id, tier_idx, offer_items, want_species, want_open) values (v_uid, v_tier, v_items, v_want, v_open) returning id into v_id;
  return jsonb_build_object('ok', true, 'listing_id', v_id);
end $$;

create function public.wh_board_search(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); a public.wh_accounts%rowtype; v_tier smallint; v_species smallint;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin v_tier := nullif(p->>'tier', '')::smallint; v_species := nullif(p->>'species', '')::smallint; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select * into a from public.wh_accounts where user_id = v_uid;
  if not found or public.wh__gate(a) is not null or not public.wh__flag('board_enabled') then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if not public.wh__take(v_uid, 'search') then return jsonb_build_object('ok', false, 'error', 'slow_down'); end if;      -- 7.4: the board query is the heaviest read
  return jsonb_build_object('ok', true, 'listings', coalesce((select jsonb_agg(x) from (
    select l.id as listing_id, ac.public_id as lister, ac.handle_adj, ac.handle_noun, ac.handle_num, l.tier_idx, l.want_species, l.want_open,
      (select jsonb_agg(jsonb_build_object('item_id', i.id, 'species_idx', i.species_idx, 'genome_code', i.genome_code, 'is_new_to_you',
          not exists (select 1 from public.wh_items m where m.owner_id = v_uid and m.species_idx = i.species_idx and m.consumed_at is null)) order by i.id)
         from public.wh_items i where i.id = any(l.offer_items) and i.owner_id = l.user_id and i.consumed_at is null and (i.locked_until is null or i.locked_until <= now()) and not i.fav and public.wh__res_free(i.reserved_trade_id, null)) as offers,
      (select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) from public.wh_items m
         where m.owner_id = v_uid and m.consumed_at is null and m.offered_at is not null and not m.fav and m.tier_idx = l.tier_idx and (m.locked_until is null or m.locked_until <= now())
           and public.wh__res_free(m.reserved_trade_id, null) and (l.want_open or m.species_idx = any(l.want_species))) as you_can_give
    from public.wh_listings l join public.wh_accounts ac on ac.user_id = l.user_id
    where l.active and l.expires_at > now() and l.user_id <> v_uid and not public.wh__blocked(v_uid, l.user_id) and public.wh__gate(ac) is null
      and (v_tier is null or l.tier_idx = v_tier)
      and (v_species is null or exists (select 1 from public.wh_items i where i.id = any(l.offer_items) and i.species_idx = v_species))
    order by l.created_at desc limit 30) x), '[]'::jsonb));
end $$;

create function public.wh_block(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); v_other uuid; v_trades uuid[];
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  select user_id into v_other from public.wh_accounts where public_id = p->>'partner_ref';
  if v_other is null or v_other = v_uid then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select coalesce(array_agg(id order by id), '{}') into v_trades from public.wh_trades where status in ('proposed','countered') and ((a_user = v_uid and b_user = v_other) or (a_user = v_other and b_user = v_uid));
  perform 1 from public.wh_trades where id = any(v_trades) order by id for update;                          -- trade rows, then accounts, then items: the global order
  perform 1 from public.wh_accounts where user_id in (v_uid, v_other) order by user_id for update;
  perform 1 from public.wh_items where reserved_trade_id = any(v_trades) order by id for update;
  update public.wh_items set reserved_trade_id = null where reserved_trade_id = any(v_trades);
  update public.wh_trades set status = 'cancelled', ended_reason = 'blocked', updated_at = now() where id = any(v_trades) and status in ('proposed','countered');
  insert into public.wh_blocks (blocker, blocked) values (v_uid, v_other) on conflict do nothing;
  delete from public.wh_friends where user_lo = least(v_uid, v_other) and user_hi = greatest(v_uid, v_other);
  update public.wh_friend_requests set status = 'cancelled', decided_at = now() where status = 'pending' and ((from_user = v_uid and to_user = v_other) or (from_user = v_other and to_user = v_uid));
  return jsonb_build_object('ok', true, 'cancelled_trades', cardinality(v_trades));
end $$;

-- fixed reasons: 1 name bothers me, 2 too many offers or requests, 3 tried to trick me, 4 I think they are cheating, 5 made me uncomfortable, 6 something else
-- Automatic hold (section 13; revised 2026-10-05, NOT run): THREE DIFFERENT reporters within 7 days who pass the new-account gate AND had a real
-- interaction with the reported account in those 7 days (a trade row between them either way, which includes a proposal on its listing, a friend
-- request either way, or a friendship), counting only reports filed after the last automatic hold started, put the account on a 24 h hold for
-- human review. At most ONE automatic hold until a person has reviewed it (hold_reviewed_at), then at most one per 7 days. Never a ban.
-- (The old rule re-armed the hold on every repeat report by the same three accounts, which needed no relationship to the target.)
create function public.wh_report(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); v_other uuid; v_reason smallint; me public.wh_accounts%rowtype; o public.wh_accounts%rowtype; v_n integer;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin v_reason := (p->>'reason')::smallint; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  select user_id into v_other from public.wh_accounts where public_id = p->>'partner_ref';
  if v_other is null or v_other = v_uid or v_reason not between 1 and 6 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
  perform 1 from public.wh_accounts where user_id in (v_uid, v_other) order by user_id for update;     -- both accounts, ascending (8.2): the hold updates the other one
  select * into me from public.wh_accounts where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  select * into o from public.wh_accounts where user_id = v_other;
  if (select count(*) from public.wh_reports where reporter = v_uid and at > now() - interval '24 hours') >= 5 then return jsonb_build_object('ok', false, 'error', 'slow_down'); end if;
  insert into public.wh_reports (reporter, reported, reason) values (v_uid, v_other, v_reason);
  if public.wh__gate(me) is null
     and (o.auto_hold_at is null or (o.hold_reviewed_at > o.auto_hold_at and o.auto_hold_at < now() - interval '7 days')) then
    select count(distinct r.reporter) into v_n
      from public.wh_reports r join public.wh_accounts ra on ra.user_id = r.reporter
     where r.reported = v_other and r.at > now() - interval '7 days' and r.at > coalesce(o.auto_hold_at, '-infinity')
       and public.wh__gate(ra) is null
       and (exists (select 1 from public.wh_trades t where t.created_at > now() - interval '7 days'
                     and ((t.a_user = r.reporter and t.b_user = v_other) or (t.a_user = v_other and t.b_user = r.reporter)))
         or exists (select 1 from public.wh_friend_requests q where q.created_at > now() - interval '7 days'
                     and ((q.from_user = r.reporter and q.to_user = v_other) or (q.from_user = v_other and q.to_user = r.reporter)))
         or public.wh__are_friends(r.reporter, v_other));
    if v_n >= 3 then
      update public.wh_accounts set restricted_until = greatest(coalesce(restricted_until, now()), now() + interval '24 hours'), auto_hold_at = now()
       where user_id = v_other;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.wh_unblock(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  delete from public.wh_blocks where blocker = v_uid and blocked = (select user_id from public.wh_accounts where public_id = p->>'partner_ref');
  return jsonb_build_object('ok', true);                                            -- friendship is NOT restored: they have to be invited again
end $$;

create function public.wh_block_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  return jsonb_build_object('ok', true, 'blocked', coalesce((select jsonb_agg(jsonb_build_object('ref', o.public_id, 'adj', o.handle_adj, 'noun', o.handle_noun, 'num', o.handle_num) order by b.at)
    from public.wh_blocks b join public.wh_accounts o on o.user_id = b.blocked where b.blocker = v_uid), '[]'::jsonb));
end $$;

create function public.wh_listing_cancel(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin update public.wh_listings set active = false where id = (p->>'listing_id')::uuid and user_id = v_uid;
  exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  return jsonb_build_object('ok', true);
end $$;

-- account deletion: burn what the account holds (ledger keeps the pseudonymous trail) and let the FKs cascade. Fails LOUDLY rather than orphan items.
create function public.wh__on_user_delete() returns trigger language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
begin
  perform 1 from public.wh_trades where status in ('proposed','countered') and (a_user = old.id or b_user = old.id) order by id for update;
  update public.wh_items set reserved_trade_id = null where reserved_trade_id in (select id from public.wh_trades where a_user = old.id or b_user = old.id);
  update public.wh_trades set status = 'cancelled', ended_reason = 'account_deleted', updated_at = now() where status in ('proposed','countered') and (a_user = old.id or b_user = old.id);
  insert into public.wh_ledger (kind, item_id, from_user, ref_kind) select 'burn', id, old.id, 'account_delete' from public.wh_items where owner_id = old.id and consumed_at is null;
  delete from public.wh_items where owner_id = old.id;
  delete from public.wh_ops where user_id = old.id;
  return old;
end $$;
create trigger wh_on_user_delete before delete on auth.users for each row execute function public.wh__on_user_delete();

-- The age/consent seam (16.1; added 2026-10-05, NOT run): when trading is switched OFF for an account (the owner, or a future age or consent flow),
-- every social surface closes at once. Pending friend requests both ways are cancelled, live trades are cancelled and their items released,
-- listings close and the offer shelf is emptied. Existing friendships are SUSPENDED: kept, but every function hides them while the account fails
-- the gate (owner decision NEXT_STEPS D-17 may turn this into a delete). This runs INSIDE the update of the account row, so it must never WAIT for a
-- trade row (that would invert the lock order of 8.2): trade rows are taken with NOWAIT, and if one is being confirmed at that instant the update
-- fails with lock_not_available and the owner runs it again.
create function public.wh__on_trade_disabled() returns trigger language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_trades uuid[];
begin
  select coalesce(array_agg(id order by id), '{}') into v_trades from public.wh_trades
   where status in ('proposed', 'countered') and (a_user = new.user_id or b_user = new.user_id);
  perform 1 from public.wh_trades where id = any(v_trades) order by id for update nowait;
  perform 1 from public.wh_items where reserved_trade_id = any(v_trades) order by id for update;
  update public.wh_items set reserved_trade_id = null where reserved_trade_id = any(v_trades);
  update public.wh_trades set status = 'cancelled', ended_reason = 'trading_off', updated_at = now() where id = any(v_trades) and status in ('proposed', 'countered');
  update public.wh_friend_requests set status = 'cancelled', decided_at = now() where status = 'pending' and (from_user = new.user_id or to_user = new.user_id);
  update public.wh_listings set active = false where user_id = new.user_id and active;
  update public.wh_items set offered_at = null where owner_id = new.user_id and offered_at is not null;
  return null;
end $$;
create trigger wh_on_trade_disabled after update of trade_enabled on public.wh_accounts
  for each row when (old.trade_enabled and not new.trade_enabled) execute function public.wh__on_trade_disabled();

-- ops: conservation + anomaly views (service_role / SQL editor only)
create view public.wh_v_conservation as
  select 'live_item_without_exactly_one_mint'::text as problem, i.id::text as ref from public.wh_items i
    where i.consumed_at is null and (select count(*) from public.wh_ledger l where l.item_id = i.id and l.kind = 'mint') <> 1
  union all select 'consumed_item_without_consume_row', i.id::text from public.wh_items i
    where i.consumed_at is not null and not exists (select 1 from public.wh_ledger l where l.item_id = i.id and l.kind = 'consume')
  union all select 'owner_differs_from_last_ledger_entry', i.id::text from public.wh_items i
    where i.consumed_at is null and i.owner_id is distinct from (select l.to_user from public.wh_ledger l where l.item_id = i.id and l.kind in ('mint','transfer') order by l.id desc limit 1)
  union all select 'item_reserved_by_unknown_trade', i.id::text from public.wh_items i
    where i.reserved_trade_id is not null and not exists (select 1 from public.wh_trades t where t.id = i.reserved_trade_id)
  union all select 'live_count_differs_from_ledger', 'global' where
    (select count(*) from public.wh_ledger where kind = 'mint') - (select count(*) from public.wh_ledger where kind in ('consume','burn')) <> (select count(*) from public.wh_items where consumed_at is null);

revoke all on public.wh_v_conservation from anon, authenticated;
revoke all on function public.wh__new_code(), public.wh__on_user_delete(), public.wh__on_trade_disabled() from public, anon, authenticated;
revoke all on function public.wh_friend_code_get(), public.wh_friend_code_rotate(), public.wh_friend_redeem(jsonb), public.wh_friend_respond(jsonb), public.wh_shelf_set(jsonb), public.wh_listing_create(jsonb),
  public.wh_board_search(jsonb), public.wh_block(jsonb), public.wh_report(jsonb), public.wh_unblock(jsonb), public.wh_block_list(jsonb), public.wh_listing_cancel(jsonb) from public, anon;
grant execute on function public.wh_friend_code_get(), public.wh_friend_code_rotate(), public.wh_friend_redeem(jsonb), public.wh_friend_respond(jsonb), public.wh_shelf_set(jsonb), public.wh_listing_create(jsonb),
  public.wh_board_search(jsonb), public.wh_block(jsonb), public.wh_report(jsonb), public.wh_unblock(jsonb), public.wh_block_list(jsonb), public.wh_listing_cancel(jsonb) to authenticated;
```

### A.4 Social reads and small writes

```sql
-- ===== client reads and small writes, social side: handle, friends list, friend shelf, unfriend, trade inbox, emotes (DRAFT; tested locally; NOT APPLIED) =====

-- handle = two words from fixed lists (indexes 0..63) + a server-assigned 2-digit number; changeable once a week (impersonation guard)
create function public.wh_handle_set(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.wh_accounts%rowtype; v_adj smallint; v_noun smallint; v_num smallint; v_try integer := 0;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin v_adj := (p->>'adj')::smallint; v_noun := (p->>'noun')::smallint; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  if v_adj not between 0 and 63 or v_noun not between 0 and 63 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
  select * into a from public.wh_accounts where user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  if a.handle_changed_at is not null and a.handle_changed_at > now() - interval '7 days' then return jsonb_build_object('ok', false, 'error', 'slow_down'); end if;
  loop
    v_num := 10 + floor(random() * 90)::smallint; v_try := v_try + 1;
    begin
      update public.wh_accounts set handle_adj = v_adj, handle_noun = v_noun, handle_num = v_num, handle_changed_at = now() where user_id = v_uid;
      exit;
    exception when unique_violation then if v_try > 20 then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'handle', jsonb_build_object('adj', v_adj, 'noun', v_noun, 'num', v_num));
end $$;

create function public.wh_friend_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); me public.wh_accounts%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  -- the age/consent seam (16.1): a gated account sees no friends and no requests, and gated accounts are left out of everyone's list
  select * into me from public.wh_accounts where user_id = v_uid;
  if not found or public.wh__gate(me) is not null then
    return jsonb_build_object('ok', true, 'paused', true, 'friends', '[]'::jsonb, 'requests_in', '[]'::jsonb, 'requests_out', 0); end if;
  return jsonb_build_object('ok', true,
    'friends', coalesce((select jsonb_agg(jsonb_build_object('ref', o.public_id, 'adj', o.handle_adj, 'noun', o.handle_noun, 'num', o.handle_num, 'since', f.since) order by f.since)
       from public.wh_friends f join public.wh_accounts o on o.user_id = case when f.user_lo = v_uid then f.user_hi else f.user_lo end
       where v_uid in (f.user_lo, f.user_hi) and public.wh__gate(o) is null), '[]'::jsonb),
    'requests_in', coalesce((select jsonb_agg(jsonb_build_object('request_id', r.id, 'ref', o.public_id, 'adj', o.handle_adj, 'noun', o.handle_noun, 'num', o.handle_num, 'at', r.created_at) order by r.created_at)
       from public.wh_friend_requests r join public.wh_accounts o on o.user_id = r.from_user
       where r.to_user = v_uid and r.status = 'pending' and r.expires_at > now() and public.wh__gate(o) is null), '[]'::jsonb),
    'requests_out', (select count(*) from public.wh_friend_requests r where r.from_user = v_uid and r.status = 'pending' and r.expires_at > now()));
end $$;

create function public.wh_friend_shelf(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_other uuid; me public.wh_accounts%rowtype; o public.wh_accounts%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  select * into o from public.wh_accounts where public_id = p->>'friend_ref';
  select * into me from public.wh_accounts where user_id = v_uid;
  v_other := o.user_id;
  -- friends only, and both past the gate (16.1): a gated account neither shows its shelf nor looks at anyone's
  if v_other is null or me.user_id is null or not public.wh__are_friends(v_uid, v_other) or public.wh__blocked(v_uid, v_other)
     or public.wh__gate(me) is not null or public.wh__gate(o) is not null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'species_idx', i.species_idx, 'tier_idx', i.tier_idx, 'genome_code', i.genome_code,
      'is_new_to_you', not exists (select 1 from public.wh_items m where m.owner_id = v_uid and m.species_idx = i.species_idx and m.consumed_at is null)) order by i.id)
    from public.wh_items i where i.owner_id = v_other and i.consumed_at is null and i.offered_at is not null and not i.fav and (i.locked_until is null or i.locked_until <= now()) and public.wh__res_free(i.reserved_trade_id, null)), '[]'::jsonb));
end $$;

create function public.wh_friend_remove(p jsonb) returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '3s' as $$
declare v_uid uuid := auth.uid(); v_other uuid; v_trades uuid[];
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  select user_id into v_other from public.wh_accounts where public_id = p->>'friend_ref';
  if v_other is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select coalesce(array_agg(id order by id), '{}') into v_trades from public.wh_trades where status in ('proposed','countered') and via = 'friend' and ((a_user = v_uid and b_user = v_other) or (a_user = v_other and b_user = v_uid));
  perform 1 from public.wh_trades where id = any(v_trades) order by id for update;
  perform 1 from public.wh_accounts where user_id in (v_uid, v_other) order by user_id for update;
  perform 1 from public.wh_items where reserved_trade_id = any(v_trades) order by id for update;
  update public.wh_items set reserved_trade_id = null where reserved_trade_id = any(v_trades);
  update public.wh_trades set status = 'cancelled', ended_reason = 'unfriended', updated_at = now() where id = any(v_trades) and status in ('proposed','countered');
  delete from public.wh_friends where user_lo = least(v_uid, v_other) and user_hi = greatest(v_uid, v_other);
  return jsonb_build_object('ok', true, 'cancelled_trades', cardinality(v_trades));
end $$;

create function public.wh_trade_inbox(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  return jsonb_build_object('ok', true, 'trades', coalesce((select jsonb_agg(x order by x.updated_at desc) from (
    select t.id as trade_id, case when t.a_user = v_uid then 'a' else 'b' end as you_are, case when t.status in ('proposed','countered') and t.expires_at <= now() then 'expired' else t.status end as status,
           t.terms_version, t.tier_idx, t.mode, t.via, t.expires_at, t.updated_at,
           (case when t.a_user = v_uid then t.a_confirmed else t.b_confirmed end) = t.terms_version as you_confirmed,
           (case when t.a_user = v_uid then t.b_confirmed else t.a_confirmed end) = t.terms_version as they_confirmed,
           (select count(*) from public.wh_trade_items ti where ti.trade_id = t.id and ti.side = 'a') as items_each,
           jsonb_build_object('ref', o.public_id, 'adj', o.handle_adj, 'noun', o.handle_noun, 'num', o.handle_num) as partner
    from public.wh_trades t join public.wh_accounts o on o.user_id = case when t.a_user = v_uid then t.b_user else t.a_user end
    where v_uid in (t.a_user, t.b_user) and (t.status in ('proposed','countered') or t.updated_at > now() - interval '3 days') order by t.updated_at desc limit 40) x), '[]'::jsonb));
end $$;

-- six fixed emotes, no text: 1 hello, 2 thanks, 3 wow, 4 oops, 5 bye, 6 good swap
create function public.wh_trade_emote(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_trade uuid; v_emote smallint; t public.wh_trades%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if octet_length(p::text) > 8192 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;      -- a sanity limit only: PostgREST has already parsed the body (7.4)
  begin v_trade := (p->>'trade_id')::uuid; v_emote := (p->>'emote')::smallint; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end;
  if v_emote not between 1 and 6 then return jsonb_build_object('ok', false, 'error', 'bad_payload'); end if;
  select * into t from public.wh_trades where id = v_trade and (a_user = v_uid or b_user = v_uid) for update;
  if not found or t.status not in ('proposed','countered') then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if exists (select 1 from public.wh_accounts x where x.user_id in (t.a_user, t.b_user) and public.wh__gate(x) is not null) then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;                                                 -- 16.1: no contact while either side is gated
  if exists (select 1 from public.wh_trade_events e where e.trade_id = v_trade and e.actor = v_uid and e.kind = 'emote' and e.at > now() - interval '5 seconds') then return jsonb_build_object('ok', false, 'error', 'slow_down'); end if;
  perform public.wh__ev(v_trade, v_uid, 'emote', t.terms_version, jsonb_build_object('emote', v_emote));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.wh_handle_set(jsonb), public.wh_friend_list(jsonb), public.wh_friend_shelf(jsonb), public.wh_friend_remove(jsonb), public.wh_trade_inbox(jsonb), public.wh_trade_emote(jsonb) from public, anon;
grant execute on function public.wh_handle_set(jsonb), public.wh_friend_list(jsonb), public.wh_friend_shelf(jsonb), public.wh_friend_remove(jsonb), public.wh_trade_inbox(jsonb), public.wh_trade_emote(jsonb) to authenticated;
```

### A.5 Ops pack (read-only)

```sql
-- ===== OPS PACK: run in the SQL editor / as service_role. Read-only. (DRAFT; each query executed once on local PG16 after the test suite) =====

-- O1  Conservation: must return no rows. Any row = freeze trading and merging (section 15.1).
select * from public.wh_v_conservation;

-- O2  Duplicated looks: the same share string alive on two items (a cloned row or a replayed mint). Collisions of honest mints are possible only for
--     identical (species, 32-bit seed) pairs, which at a few thousand copies per species is a rarity: investigate every row.
select genome_code, count(*) as live_copies, array_agg(id order by born_at) as items, array_agg(owner_id order by born_at) as owners
from public.wh_items where consumed_at is null group by genome_code having count(*) > 1;

-- O3  Items without a clean birth: a live item must have exactly one mint ledger row (also part of O1; this lists by owner for triage)
select i.owner_id, count(*) as suspicious_items
from public.wh_items i where i.consumed_at is null and (select count(*) from public.wh_ledger l where l.item_id = i.id and l.kind = 'mint') <> 1 group by 1 order by 2 desc;

-- O4  The receive lock was bypassed: an item moved or was consumed within 24 h of arriving (must return no rows)
select l1.item_id, l1.at as arrived, l2.kind as then_did, l2.at as at
from public.wh_ledger l1 join public.wh_ledger l2 on l2.item_id = l1.item_id and l2.id > l1.id and l2.at < l1.at + interval '24 hours'
where (l1.kind = 'transfer' or (l1.kind = 'mint' and l1.ref_kind = 'merge')) and l2.kind in ('transfer', 'consume');

-- O5  Caps bypassed: more than 3 executed trades in any rolling 24 h for one account (must return no rows), and more than 1 with the same partner
select u, executed_at, count(*) over (partition by u order by executed_at range between interval '24 hours' preceding and current row) as in_24h
from (select a_user as u, executed_at from public.wh_trades where status = 'executed' union all select b_user, executed_at from public.wh_trades where status = 'executed') x
order by in_24h desc limit 20;

-- O6  Laundering rings and funnels (14 days): many trades with few partners, or one account on the receiving end of many distinct partners
with e as (select a_user as u, b_user as v from public.wh_trades where status = 'executed' and executed_at > now() - interval '14 days'
           union all select b_user, a_user from public.wh_trades where status = 'executed' and executed_at > now() - interval '14 days')
select u, count(*) as trades, count(distinct v) as partners from e group by u having (count(*) >= 6 and count(distinct v) <= 2) or count(distinct v) >= 8 order by trades desc;

-- O7  Tight clusters: pairs that trade at the cap every day (candidate sybil pairs)
select least(a_user, b_user) as p1, greatest(a_user, b_user) as p2, count(*) as trades, min(executed_at) as first, max(executed_at) as last
from public.wh_trades where status = 'executed' and executed_at > now() - interval '30 days' group by 1, 2 having count(*) >= 5 order by trades desc;

-- O8  Account creation bursts and how fast new accounts reach the trade gate
select date_trunc('hour', created_at) as hour, count(*) as new_accounts, count(*) filter (where capsules_opened >= 10) as past_gate from public.wh_accounts group by 1 having count(*) >= 5 order by 1 desc;

-- O9  Abuse signals (7 days): reports against an account from distinct reporters, blocks received, proposals that die unanswered
select a.public_id, a.restricted_until, a.auto_hold_at, a.hold_reviewed_at,
  (select count(distinct r.reporter) from public.wh_reports r where r.reported = a.user_id and r.at > now() - interval '7 days') as reporters_7d,
  (select count(*) from public.wh_blocks b where b.blocked = a.user_id) as blocked_by,
  (select count(*) from public.wh_trades t where t.a_user = a.user_id and t.created_at > now() - interval '7 days' and t.status in ('cancelled', 'expired')) as dead_proposals_7d
from public.wh_accounts a
where exists (select 1 from public.wh_reports r where r.reported = a.user_id and r.at > now() - interval '7 days') or exists (select 1 from public.wh_blocks b where b.blocked = a.user_id)
order by reporters_7d desc, blocked_by desc limit 50;

-- O10 Suspected macro accounts: capsules per day at the cap for many days (the daily cap is 12 from play)
select a.public_id, a.capsules_opened, a.created_at, round(a.capsules_opened / greatest(1, extract(epoch from (now() - a.created_at)) / 86400)::numeric, 1) as per_day
from public.wh_accounts a where a.created_at < now() - interval '3 days' order by per_day desc limit 20;

-- O11 RECALL: everything descended from a tainted set of items through merges (the parents column), with the current holder
with recursive taint(id) as (
  select unnest(array['00000000-0000-0000-0000-000000000000']::uuid[])
  union select i.id from public.wh_items i join taint t on t.id = any(i.parents))
select i.id, i.owner_id, i.origin, i.consumed_at, i.locked_until from public.wh_items i join taint using (id);

-- O12 What did one mint batch become: live items minted in a time window with their current owners (to bound a bad-roll incident)
select l.ref_kind, count(*) as minted, count(*) filter (where i.consumed_at is null) as still_live, count(distinct i.owner_id) as holders
from public.wh_ledger l left join public.wh_items i on i.id = l.item_id where l.kind = 'mint' and l.at between now() - interval '1 hour' and now() group by 1;

-- O13 Stale reservations (an item reserved by a trade that is no longer live; harmless, the lock is lazy, but a long list means a bug)
select i.id, i.reserved_trade_id, t.status from public.wh_items i join public.wh_trades t on t.id = i.reserved_trade_id where t.status not in ('proposed', 'countered') or t.expires_at <= now();

-- O14 Privilege audit (functions): every wh_ function that a player can call. Must be EXACTLY the 28 client RPCs of TRADE.md section 7.2; `anon` must have none.
--     (The migration runs the same check, and a check that the portal's own grants are unchanged, as its last statement: COLLECTION A.7.)
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('anon', p.oid, 'execute') as anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'wh\_%' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) order by 1;

-- O15 Privilege audit (tables): what players can do to wh_ tables. Must be SELECT on wh_species (anon too), wh_accounts, wh_items, wh_capsules (authenticated) and nothing else.
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_name like 'wh\_%' group by 1, 2 order by 1, 2;
```

## Appendix B. Local test stand-in and helpers (TEST ONLY; never part of a migration)

`00_stub.sql` stands in for the parts of Supabase the draft needs. `t_helpers.sql` creates accounts and items directly and seeds a small fake species roster (it is replaced by the real 50-species roster in the host suite).

```sql
-- Minimal Supabase stand-in for local testing ONLY (never applied anywhere real).
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; create schema auth;
drop schema if exists extensions cascade; create schema extensions;
create extension if not exists pgcrypto schema extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
-- Supabase default privileges: new public objects are granted to anon/authenticated/service_role (the migrations REVOKE what they must)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role, public;
-- A sentinel for the portal's OWN objects (added 2026-10-05): created like Supabase creates any table (so it gets the default grants), it must keep
-- them through the migration. The first draft's schema-wide revoke would have stripped them, and a stub with only wh_ tables could not show it.
create table public.portal_sentinel (id bigserial primary key, note text);
```

```sql
-- TEST-ONLY helpers (never part of the draft)
insert into public.wh_species (idx, id, tier_idx) values
 (0,'aaa',0),(1,'bbb',0),(2,'ccc',0),(3,'ddd',1),(4,'eee',1),(5,'fff',2),(6,'ggg',2),(7,'hhh',3),(8,'iii',4),(9,'jjj',5),(10,'kkk',2),(11,'lll',2)
 on conflict do nothing;
create or replace function public.t_genome(sp smallint, seed bigint) returns text language plpgsql as $$
declare b bytea := decode(repeat('00', 26), 'hex');
begin
  b := set_byte(b, 0, 1); b := set_byte(b, 1, sp);
  b := set_byte(b, 4, (seed & 255)::int); b := set_byte(b, 5, ((seed >> 8) & 255)::int); b := set_byte(b, 6, ((seed >> 16) & 255)::int); b := set_byte(b, 7, ((seed >> 24) & 255)::int);
  return 'g1.' || translate(rtrim(encode(b, 'base64'), '='), '+/', '-_');
end $$;
create sequence if not exists public.t_seq;
create or replace function public.t_acct(p_enabled boolean default true) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); n bigint := nextval('public.t_seq');
begin
  insert into auth.users (id, email) values (u, 't' || u || '@invalid.test');
  insert into public.wh_accounts (user_id, public_id, created_at, capsules_opened, trade_enabled, handle_adj, handle_noun, handle_num)
    values (u, substr(md5(u::text), 1, 12), now() - interval '10 days', 25, p_enabled, n % 64, (n / 64) % 64, 10 + (n / 4096) % 90);
  return u;
end $$;
create or replace function public.t_item(p_owner uuid, p_sp smallint, p_offered boolean default true, p_locked boolean default false) returns uuid language plpgsql as $$
declare i uuid := gen_random_uuid(); v_seed bigint := floor(random() * 4294967295)::bigint; v_tier smallint;
begin
  select tier_idx into v_tier from public.wh_species where idx = p_sp;
  insert into public.wh_items (id, owner_id, species_idx, tier_idx, genome_code, genome_seed, origin, locked_until, offered_at)
    values (i, p_owner, p_sp, v_tier, public.t_genome(p_sp, v_seed), v_seed, 'drop', case when p_locked then now() + interval '24 hours' end, case when p_offered then now() end);
  insert into public.wh_ledger (kind, item_id, to_user, ref_kind) values ('mint', i, p_owner, 'capsule');
  return i;
end $$;
create or replace function public.t_friends(a uuid, b uuid) returns void language sql as
$$ insert into public.wh_friends (user_lo, user_hi) values (least(a, b), greatest(a, b)) on conflict do nothing $$;
```

## Appendix C. Test runner (Python 3 and `psql`; ran 149/149 on 2026-10-02)

Each `call()` is a separate `psql` process, that is a separate database session with its own role and `auth.uid()`. `ThreadPoolExecutor(n)` gives n concurrent sessions. Section numbers are the test ids of section 18.

```python
import subprocess, json, uuid, time, sys, concurrent.futures as cf, random

PSQL = ['psql', '-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'wh', '-At', '-q']
fails = 0; checks = 0
def check(name, ok, extra=''):
    global fails, checks
    checks += 1
    if not ok: fails += 1
    print(('ok   ' if ok else 'FAIL ') + name + (('  ' + str(extra)) if extra else ''))
def sql(q):
    r = subprocess.run(PSQL + ['-c', q], capture_output=True, text=True)
    if r.returncode != 0 or 'ERROR' in r.stderr: raise RuntimeError(r.stderr.strip() or q)
    return r.stdout.strip()
def sqlerr(q):
    r = subprocess.run(PSQL + ['-c', q], capture_output=True, text=True)
    return r.stdout.strip(), r.stderr.strip()
def call(uid, fn, payload=None, role='authenticated'):
    args = '' if payload is None else "'" + json.dumps(payload).replace("'", "''") + "'::jsonb"
    cmd = PSQL + (['-c', f"set request.jwt.claim.sub='{uid}'"] if uid else []) + ['-c', f'set role {role}', '-c', f'select public.{fn}({args})']
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = r.stdout.strip().splitlines()
    if r.returncode == 0 and out:
        try: return json.loads(out[-1])
        except Exception: return {'_raw': out[-1]}
    return {'_error': (r.stderr or '').strip()[:300]}
def idem(): return uuid.uuid4().hex + uuid.uuid4().hex[:8]
def acct(enabled=True): return sql(f"select public.t_acct({'true' if enabled else 'false'})")
def item(owner, sp, offered=True, locked=False): return sql(f"select public.t_item('{owner}', {sp}::smallint, {'true' if offered else 'false'}, {'true' if locked else 'false'})")
def friends(a, b): sql(f"select public.t_friends('{a}','{b}')")
def pid(u): return sql(f"select public_id from public.wh_accounts where user_id='{u}'")
def owner_of(i): return sql(f"select owner_id from public.wh_items where id='{i}'")
def conservation(): return sql("select count(*) from public.wh_v_conservation")
def pair_with_items(spa=5, spb=6, offered=True):
    a, b = acct(), acct(); friends(a, b)
    return a, b, item(a, spa, offered), item(b, spb, offered)
def propose(a, b, give, get, **kw):
    return call(a, 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(b), 'give': give, 'get': get, **kw})
def view(u, t): return call(u, 'wh_trade_view', {'trade_id': t})
def confirm(u, t, v=1, key=None): return call(u, 'wh_confirm_trade', {'idem': key or idem(), 'trade_id': t, 'expect_version': v})
def set_cfg(k, v): sql(f"update public.wh_config set value='{json.dumps(v)}'::jsonb where key='{k}'")
def settle(): time.sleep(5.3 if sql("select value from public.wh_config where key='trade_confirm_cooldown_s'") != '0' else 0.05)

t0 = time.time()
print('== 1. happy path, cooldown, replay ==')
a, b, a1, b1 = pair_with_items()
r = propose(a, b, [a1], [b1]); tid = r.get('trade_id')
check('propose ok, status proposed, A is confirmed on v1', r.get('ok') and r.get('status') == 'proposed' and r.get('terms_version') == 1, r)
check('A item reserved, B item not', sql(f"select reserved_trade_id from public.wh_items where id='{a1}'") == tid and sql(f"select coalesce(reserved_trade_id::text,'') from public.wh_items where id='{b1}'") == '')
check('B confirm before viewing is refused (review_first)', confirm(b, tid).get('error') == 'review_first')
v = view(b, tid)
check('view shows you_give / you_receive with exact items, partner handle, no user ids', v.get('ok') and len(v['you_give']) == 1 and v['you_receive'][0]['item_id'] == a1 and v['you_give'][0]['item_id'] == b1 and 'user_id' not in json.dumps(v) and v['you_are'] == 'b', v)
c = confirm(b, tid)
check('confirm inside the 5 s cool-down is refused (wait)', c.get('error') == 'wait' and 0 < c.get('wait_ms', 0) <= 5000, c)
settle()
key = idem(); c = confirm(b, tid, 1, key)
check('confirm after the cool-down executes', c.get('ok') and c.get('status') == 'executed', c)
check('owners swapped', owner_of(a1) == b and owner_of(b1) == a)
check('trade_count 1, receive lock ~24h, offered cleared, reservation cleared', sql(f"select trade_count=1 and locked_until > now()+interval '23 hours' and offered_at is null and reserved_trade_id is null from public.wh_items where id in ('{a1}','{b1}') group by 1") == 't')
check('two transfer ledger rows', sql(f"select count(*) from public.wh_ledger where ref_kind='trade' and ref_id='{tid}'") == '2')
c2 = confirm(b, tid, 1, key)
check('replay of the SAME confirm returns the stored result, no second swap', c2.get('ok') and c2.get('replayed') is True and sql(f"select count(*) from public.wh_ledger where ref_kind='trade' and ref_id='{tid}'") == '2', c2)
check('a NEW idem key on an executed trade is refused (not_pending)', confirm(b, tid).get('error') == 'not_pending')
check('idem key reuse with different arguments is refused', call(b, 'wh_confirm_trade', {'idem': key, 'trade_id': tid, 'expect_version': 2}).get('error') == 'idem_reuse')
check('conservation view is empty', conservation() == '0', conservation())
check('A cannot re-offer or merge the item it just received (locked)', call(b, 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(a), 'give': [a1], 'get': [b1]}).get('error') in ('locked', 'pair_busy', 'unavailable', 'not_yours') )
lk2 = item(b, 5, False, True); vb = int(sql(f"select version from public.wh_accounts where user_id='{b}'"))
check('merge commit refuses a received (locked) item', call(None, 'wh__commit_merge', {'uid': b, 'idem': idem(), 'args_digest': 'x', 'expect_version': vb, 'inputs': [a1, lk2], 'cost': 2, 'out_species_idx': 6, 'out_tier_idx': 2, 'tier_up': False, 'genome_seed': 1, 'genome_code': 'g1.' + 'A' * 35, 'pity_after': [0]*6}, role='service_role').get('error') == 'locked')

set_cfg('trade_confirm_cooldown_s', 0)
print('== 2. N parallel acceptors ==')
a, b, a1, b1 = pair_with_items(); tid = propose(a, b, [a1], [b1])['trade_id']; view(b, tid); settle()
with cf.ThreadPoolExecutor(20) as ex: res = list(ex.map(lambda _: confirm(b, tid), range(20)))
ok = [x for x in res if x.get('ok')]; np_ = [x for x in res if x.get('error') == 'not_pending']
check('20 parallel confirms, distinct idem keys: exactly 1 executes, 19 not_pending', len(ok) == 1 and len(np_) == 19 and ok[0].get('status') == 'executed', [x.get('error') or x.get('status') for x in res][:6])
check('exactly one swap in the ledger', sql(f"select count(*) from public.wh_ledger where ref_kind='trade' and ref_id='{tid}'") == '2' and owner_of(a1) == b)
a, b, a1, b1 = pair_with_items(); tid = propose(a, b, [a1], [b1])['trade_id']; view(b, tid); settle(); k = idem()
with cf.ThreadPoolExecutor(20) as ex: res = list(ex.map(lambda _: confirm(b, tid, 1, k), range(20)))
check('20 parallel confirms, SAME idem key: all ok, one execution, the rest replayed', all(x.get('ok') for x in res) and sum(1 for x in res if x.get('replayed')) == 19 and sql(f"select count(*) from public.wh_ledger where ref_kind='trade' and ref_id='{tid}'") == '2', [x.get('replayed') for x in res][:5])

print('== 3. double-spend of one item across many proposals ==')
a = acct(); a1 = item(a, 5); partners = [acct() for _ in range(20)]
for p_ in partners: friends(a, p_)
bi = {p_: item(p_, 6) for p_ in partners}
with cf.ThreadPoolExecutor(20) as ex: res = list(ex.map(lambda p_: propose(a, p_, [a1], [bi[p_]]), partners))
oks = [x for x in res if x.get('ok')]
check('20 parallel proposals of ONE item: exactly one is accepted', len(oks) == 1, sorted(set((x.get('error') or 'ok') for x in res)))
check('the item is reserved by exactly that trade', sql(f"select reserved_trade_id from public.wh_items where id='{a1}'") == oks[0]['trade_id'])
# merge cannot consume a reserved item
r = call(None, 'wh__commit_merge', {'uid': a, 'idem': idem(), 'args_digest': 'x', 'expect_version': int(sql(f"select version from public.wh_accounts where user_id='{a}'")), 'inputs': [a1, item(a, 5)], 'cost': 2, 'out_species_idx': 6, 'out_tier_idx': 2, 'tier_up': False, 'genome_seed': 1, 'genome_code': 'g1.' + 'A' * 35, 'pity_after': [0]*6}, role='service_role')
check('merge refuses an item reserved by a live trade', r.get('error') == 'reserved', r)

print('== 3b. the incoming live-offer cap holds under concurrency (added 2026-10-05, not run) ==')
hub = acct(); frs = [acct() for _ in range(20)]
for f_ in frs: friends(hub, f_)
hub_items = {f_: item(hub, 6) for f_ in frs}; their = {f_: item(f_, 5) for f_ in frs}
with cf.ThreadPoolExecutor(20) as ex: res = list(ex.map(lambda f_: propose(f_, hub, [their[f_]], [hub_items[f_]]), frs))
live = int(sql(f"select count(*) from public.wh_trades where b_user='{hub}' and status in ('proposed','countered') and expires_at > now()"))
check('20 friends propose to one account at once: exactly 10 live incoming offers (both accounts are locked in ascending id)', live == 10 and sum(1 for x in res if x.get('ok')) == 10, (live, sorted(set((x.get('error') or 'ok') for x in res))))

print('== 4. counter, versions, scam-by-switch ==')
a, b, a1, b1 = pair_with_items(); b2 = item(b, 6); tid = propose(a, b, [a1], [b1])['trade_id']
view(b, tid); settle()
r = call(b, 'wh_counter_trade', {'idem': idem(), 'trade_id': tid, 'expect_version': 1, 'give': [b2], 'get': [a1]})
check('B counters with a different item: version 2, status countered', r.get('ok') and r.get('terms_version') == 2 and r.get('status') == 'countered', r)
check('reservation moved to B (the waiting party); A item still reserved? no: only B waits', sql(f"select coalesce(reserved_trade_id::text,'') from public.wh_items where id='{b2}'") == tid and sql(f"select coalesce(reserved_trade_id::text,'') from public.wh_items where id='{b1}'") == '')
check('A confirming the OLD version is refused (changed)', confirm(a, tid, 1).get('error') == 'changed')
check('A must view v2 before confirming', confirm(a, tid, 2).get('error') == 'review_first')
va = view(a, tid); check('A sees the new exact items', va.get('terms_version') == 2 and va['you_receive'][0]['item_id'] == b2 and va['you_give'][0]['item_id'] == a1)
settle(); c = confirm(a, tid, 2)
check('A confirms v2 -> executes', c.get('ok') and c.get('status') == 'executed' and owner_of(b2) == a and owner_of(a1) == b, c)
check('B untouched item b1 stayed with B', owner_of(b1) == b)
a, b, a1, b1 = pair_with_items(); tid = propose(a, b, [a1], [b1])['trade_id']; b_unc, a_unc = item(b, 3), item(a, 4)
r = call(b, 'wh_counter_trade', {'idem': idem(), 'trade_id': tid, 'expect_version': 1, 'give': [b_unc], 'get': [a_unc]})
check('a counter cannot switch a Rare trade to Uncommon items (tier_mismatch; terms and tier unchanged) [added 2026-10-05, not run]', r.get('error') == 'tier_mismatch'
      and sql(f"select terms_version || ':' || tier_idx from public.wh_trades where id='{tid}'") == '1:2', r)

print('== 4b. scam-by-switch race: A counters while B confirms the old terms ==')
swapped_bad = 0; ex_cnt = 0; ch_cnt = 0
def race(_):
    a, b = acct(), acct(); friends(a, b); a1, a1b, b1 = item(a, 5), item(a, 5), item(b, 6)
    t = propose(a, b, [a1], [b1])['trade_id']; view(b, t)
    with cf.ThreadPoolExecutor(2) as ex2:
        f1 = ex2.submit(call, a, 'wh_counter_trade', {'idem': idem(), 'trade_id': t, 'expect_version': 1, 'give': [a1b], 'get': [b1]})
        f2 = ex2.submit(confirm, b, t, 1); r1, r2 = f1.result(), f2.result()
    executed = sql(f"select status from public.wh_trades where id='{t}'") == 'executed'
    v1_terms_only = owner_of(a1) == b and owner_of(a1b) == a and owner_of(b1) == a
    untouched = owner_of(a1) == a and owner_of(a1b) == a and owner_of(b1) == b
    return executed, v1_terms_only, untouched, r1.get('error'), r2.get('error')
with cf.ThreadPoolExecutor(8) as ex: rr = list(ex.map(race, range(24)))
check('24 races: B only ever executes the terms B was shown (v1) or is told they changed; the countered item never moves unseen', all((e and v) or (not e and u) for e, v, u, _, _ in rr), [(e, r1, r2) for e, _, _, r1, r2 in rr][:4])
print('       outcomes:', sorted(set((e, r1, r2) for e, _, _, r1, r2 in rr)))

print('== 5. tampered payloads ==')
a, b, a1, b1 = pair_with_items(); a2 = item(a, 5); a3 = item(a, 0); x_other = item(acct(), 6); b_t1 = item(b, 3)
bad = {
  'wrong tier mix': dict(give=[a1], get=[b_t1]), 'count mismatch': dict(give=[a1, a2], get=[b1]), 'four items': dict(give=[a1, a2, a3, item(a, 5)], get=[b1, item(b, 6), item(b, 6), item(b, 6)]),
  'give someone elses item': dict(give=[x_other], get=[b1]), 'duplicate ids': dict(give=[a1, a1], get=[b1, item(b, 6)]), 'same item both sides': dict(give=[a1], get=[a1]),
  'empty': dict(give=[], get=[]), 'unknown uuid': dict(give=[str(uuid.uuid4())], get=[b1]), 'not uuid': dict(give=['x'], get=[b1]), 'huge array': dict(give=[a1] * 1000, get=[b1]),
  'ask for an unshelved item': dict(give=[a1], get=[item(b, 6, offered=False)]), 'null species-level junk': dict(give=None, get=None),
}
for name, kw in bad.items():
    r = call(a, 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(b), **kw})
    check(f'tampered propose refused: {name}', r.get('ok') is False and 'trade_id' not in r, r.get('error') or r)
check('no trade rows were created by any of them', sql(f"select count(*) from public.wh_trades where a_user='{a}'") == '0')
check('partner who is not a friend: generic unavailable', call(a, 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(acct()), 'give': [a1], 'get': [b1]}).get('error') == 'unavailable')
check('partner = self: unavailable', call(a, 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(a), 'give': [a1], 'get': [b1]}).get('error') == 'unavailable')
check('bad idem (too short): bad_payload', call(a, 'wh_propose_trade', {'idem': 'abc', 'partner_ref': pid(b), 'give': [a1], 'get': [b1]}).get('error') == 'bad_payload')
check('anon cannot call propose', 'permission denied' in call(None, 'wh_propose_trade', {'idem': idem()}, role='anon').get('_error', ''))
check('signed-out authenticated call raises not_signed_in', 'not_signed_in' in call(None, 'wh_propose_trade', {'idem': idem()}).get('_error', ''))
tid = propose(a, b, [a1], [b1])['trade_id']
check('a stranger cannot view or confirm someone elses trade', view(acct(), tid).get('error') == 'not_found' and confirm(acct(), tid).get('error') == 'not_found')
for stmt in [f"insert into public.wh_items (owner_id,species_idx,tier_idx,genome_code,genome_seed,origin) values ('{a}',5,2,'g1.{'A'*35}',1,'drop')", f"update public.wh_items set owner_id='{a}' where id='{b1}'",
             f"delete from public.wh_items where id='{a1}'", f"update public.wh_trades set status='executed' where id='{tid}'", "select * from public.wh_ledger", f"select public.wh__trade_execute('{tid}')",
             f"update public.wh_accounts set trade_enabled=true where user_id='{a}'", "select * from public.wh_config", "select * from public.wh_v_conservation",
             "select * from public.wh_trades", "select * from public.wh_blocks", "select * from public.wh_friends", "select * from public.wh_trade_items",
             f"select public.wh__are_friends('{a}'::uuid, '{b}'::uuid)", f"select public.wh__blocked('{a}'::uuid, '{b}'::uuid)", "select public.wh__flag('trading_enabled')", "select public.wh__cfg_int('merge_cost', 2)"]:
    out, err = sqlerr(f"set request.jwt.claim.sub='{a}'; set role authenticated; {stmt}")
    check('direct access denied: ' + stmt[:55], 'permission denied' in err or out == '' or 'row-level security' in err, err[:80] or out[:40])
out, _ = sqlerr(f"set request.jwt.claim.sub='{a}'; set role authenticated; select count(*) from public.wh_items")
check('RLS: a player can read ONLY their own items', out.splitlines()[-1] == sql(f"select count(*) from public.wh_items where owner_id='{a}'"))

print('== 6. atomicity: a failure after the swap rolls EVERYTHING back ==')
a, b, a1, b1 = pair_with_items(); tid = propose(a, b, [a1], [b1])['trade_id']; view(b, tid); settle()
sql("create or replace function public.wh__ev(p_trade uuid, p_actor uuid, p_kind text, p_ver integer, p_detail jsonb default null) returns void language plpgsql set search_path = public as $$ begin if p_kind = 'execute' and current_setting('wh.fault', true) = '1' then raise exception 'injected fault'; end if; insert into public.wh_trade_events (trade_id, seq, actor, kind, terms_version, detail) select p_trade, coalesce(max(seq),0)+1, p_actor, p_kind, p_ver, p_detail from public.wh_trade_events where trade_id = p_trade; end $$")
r = subprocess.run(PSQL + ['-c', f"set request.jwt.claim.sub='{b}'", '-c', "set wh.fault='1'", '-c', 'set role authenticated', '-c', f"select public.wh_confirm_trade('{json.dumps({'idem': idem(), 'trade_id': tid, 'expect_version': 1})}'::jsonb)"], capture_output=True, text=True)
check('the injected failure surfaced as an error', 'injected fault' in r.stderr, r.stderr[:80])
check('nothing moved: owners, status, ledger, reservation, trade_count all unchanged', owner_of(a1) == a and owner_of(b1) == b and sql(f"select status from public.wh_trades where id='{tid}'") == 'proposed'
      and sql(f"select count(*) from public.wh_ledger where ref_kind='trade' and ref_id='{tid}'") == '0' and sql(f"select reserved_trade_id from public.wh_items where id='{a1}'") == tid and sql(f"select trade_count from public.wh_items where id='{a1}'") == '0')
c = confirm(b, tid); check('the same confirm without the fault then succeeds', c.get('ok') and c.get('status') == 'executed', c)
sql("create or replace function public.wh__ev(p_trade uuid, p_actor uuid, p_kind text, p_ver integer, p_detail jsonb default null) returns void language sql set search_path = public as $$ insert into public.wh_trade_events (trade_id, seq, actor, kind, terms_version, detail) select p_trade, coalesce(max(seq), 0) + 1, p_actor, p_kind, p_ver, p_detail from public.wh_trade_events where trade_id = p_trade $$")

print('== 7. caps (rolling 24 h) ==')
a = acct(); ps = [acct() for _ in range(5)]; its = []
for p_ in ps: friends(a, p_)
done = 0
for i, p_ in enumerate(ps[:4]):
    ai, bi_ = item(a, 5), item(p_, 6); r = propose(a, p_, [ai], [bi_]); tid = r['trade_id']; view(p_, tid)
    c = confirm(p_, tid)
    if i < 3: done += 1 if c.get('status') == 'executed' else 0
    last = (c, tid, p_, ai, bi_)
check('three trades in a rolling 24 h execute', done == 3, done)
check('the 4th is refused with daily_cap and is NOT killed (still proposed)', last[0].get('error') == 'daily_cap' and sql(f"select status from public.wh_trades where id='{last[1]}'") == 'proposed', last[0])
sql(f"update public.wh_trades set executed_at = now() - interval '25 hours' where a_user='{a}' and status='executed'")
settle(); c = confirm(last[2], last[1]); check('after 25 h the same standing confirm succeeds', c.get('status') == 'executed', c)
# per partner: pair cap 1
a, b = acct(), acct(); friends(a, b); a1, b1, a2, b2 = item(a, 5), item(b, 6), item(a, 5), item(b, 6)
t1 = propose(a, b, [a1], [b1])['trade_id']; view(b, t1); settle(); confirm(b, t1)
r2 = propose(a, b, [a2], [b2])
check('second proposal to the same partner within 24 h can be proposed but not executed', r2.get('ok'), r2)
view(b, r2['trade_id']); settle(); c = confirm(b, r2['trade_id'])
check('and its execution is refused with pair_cap', c.get('error') == 'pair_cap', c)

print('== 8. expiry, lazy release, kill switch ==')
a, b, a1, b1 = pair_with_items(); tid = propose(a, b, [a1], [b1])['trade_id']; view(b, tid); settle()
sql(f"update public.wh_trades set expires_at = now() - interval '1 second' where id='{tid}'")
a1b = item(a, 5); r = propose(a, b, [a1], [b1])
check('an expired trade frees its items by itself (no cron): a new proposal with the same item works before anyone touched the old one', r.get('ok'), r)
c = confirm(b, tid); check('the expired trade cannot be confirmed (expired) and is now recorded as expired', c.get('error') == 'expired' and sql(f"select status from public.wh_trades where id='{tid}'") == 'expired', c)
tid2 = r['trade_id']; view(b, tid2); settle(); set_cfg('trading_enabled', False)
c = confirm(b, tid2); check('kill switch: confirm returns frozen and the trade stays alive', c.get('error') == 'frozen' and sql(f"select status from public.wh_trades where id='{tid2}'") == 'proposed', c)
check('kill switch: propose returns frozen', propose(a, b, [item(a, 5)], [item(b, 6)]).get('error') == 'frozen')
set_cfg('trading_enabled', True); c = confirm(b, tid2); check('switch back on: the standing confirm executes', c.get('status') == 'executed', c)

print('== 8b. live mode: a short window re-armed by each counter ==')
set_cfg('trade_ttl_live_s', 3)
a, b, a1, b1 = pair_with_items(); b2 = item(b, 6); r = propose(a, b, [a1], [b1], mode='live'); tid = r['trade_id']
check('a live proposal gets the short window (3 s in this test)', sql(f"select expires_at < now() + interval '4 seconds' from public.wh_trades where id='{tid}'") == 't')
time.sleep(2.0); c = call(b, 'wh_counter_trade', {'idem': idem(), 'trade_id': tid, 'expect_version': 1, 'give': [b2], 'get': [a1]})
time.sleep(1.5); v = view(a, tid)
check('a counter re-arms the live window (alive 3.5 s after the proposal, which alone would have expired at 3 s)', c.get('ok') and v.get('status') == 'countered', (c.get('error'), v.get('status')))
time.sleep(3.2); check('and the window then runs out by itself', view(a, tid).get('status') == 'expired')
set_cfg('trade_ttl_live_s', 60)
a2, b2_, a1_, b1_ = pair_with_items(); ra = propose(a2, b2_, [a1_], [b1_])
check('an async proposal lives about 24 hours', sql(f"select expires_at > now() + interval '23 hours' and expires_at < now() + interval '25 hours' from public.wh_trades where id='{ra['trade_id']}'") == 't')

print('== 9. friend codes ==')
u1, u2, u3 = acct(), acct(), acct()
code = call(u1, 'wh_friend_code_get')['code']
check('code is 8 chars from the 31-letter alphabet', len(code) == 8 and all(ch in '23456789ABCDEFGHJKMNPQRSTUVWXYZ' for ch in code), code)
check('own code: not_found; junk: not_found', call(u1, 'wh_friend_redeem', {'code': code}).get('error') == 'not_found' and call(u2, 'wh_friend_redeem', {'code': 'ZZZZZZZZ'}).get('error') == 'not_found')
r = call(u2, 'wh_friend_redeem', {'code': code.lower()[:4] + '-' + code.lower()[4:]}); check('redeem (lowercase, dash) creates a REQUEST, not a friendship', r.get('requested') and sql(f"select count(*) from public.wh_friends") is not None and not call(u2, 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(u1), 'give': [item(u2, 5)], 'get': [item(u1, 6)]}).get('ok'), r)
rid = sql(f"select id from public.wh_friend_requests where from_user='{u2}' and to_user='{u1}' and status='pending'")
check('only the code owner can respond', call(u3, 'wh_friend_respond', {'request_id': rid, 'accept': True}).get('error') == 'not_found')
check('owner accepts: friends', call(u1, 'wh_friend_respond', {'request_id': rid, 'accept': True}).get('accepted') is True and sql(f"select count(*) from public.wh_friends where user_lo=least('{u1}'::uuid,'{u2}'::uuid) and user_hi=greatest('{u1}'::uuid,'{u2}'::uuid)") == '1')
spam = acct(); errs = []
for i in range(12): errs.append(call(spam, 'wh_friend_redeem', {'code': 'ABCDEFGH' if i % 2 else '23456789'}).get('error'))
check('10 attempts an hour: the 11th is slow_down, and failed attempts were counted (the counter committed)', errs[10] == 'slow_down' and errs[11] == 'slow_down' and sql(f"select redeem_attempts from public.wh_accounts where user_id='{spam}'") == '10', errs)
old = call(u1, 'wh_friend_code_get')['code']; sql(f"update public.wh_friend_codes set rotated_at = now() - interval '2 minutes' where user_id='{u1}'"); new = call(u1, 'wh_friend_code_rotate')['code']
check('rotation invalidates the old code', new != old and call(u3, 'wh_friend_redeem', {'code': old}).get('error') == 'not_found' and call(u3, 'wh_friend_redeem', {'code': new}).get('requested'))
u4 = acct(); c4 = call(u4, 'wh_friend_code_get')['code']; call(u3, 'wh_friend_redeem', {'code': c4}); r = call(u4, 'wh_friend_redeem', {'code': call(u3, 'wh_friend_code_get')['code']})
check('both sides asked each other: the second redeem completes the friendship', r.get('friends') is True)
o_ = acct(); parked = [acct() for _ in range(10)]
for t_ in parked: call(o_, 'wh_friend_redeem', {'code': call(t_, 'wh_friend_code_get')['code']})
sql(f"update public.wh_accounts set redeem_attempts = 0 where user_id='{o_}'")             # test only: a fresh hour of attempts
tgt = acct(); tcode = call(tgt, 'wh_friend_code_get')['code']
rv, ri = call(o_, 'wh_friend_redeem', {'code': tcode}), call(o_, 'wh_friend_redeem', {'code': 'ZZZZZZZZ'})
check('no oracle: with 10 requests parked, a valid and an invalid code get the same too_many_requests, and nothing reaches the target [added 2026-10-05, not run]',
      rv.get('error') == 'too_many_requests' and ri.get('error') == 'too_many_requests' and sql(f"select count(*) from public.wh_friend_requests where to_user='{tgt}'") == '0', (rv, ri))

print('== 10. block mid-trade, board ==')
a, b, a1, b1 = pair_with_items(); tid = propose(a, b, [a1], [b1])['trade_id']
r = call(b, 'wh_block', {'partner_ref': pid(a)})
check('block cancels the live trade, frees the items, removes the friendship', r.get('cancelled_trades') == 1 and sql(f"select status from public.wh_trades where id='{tid}'") == 'cancelled' and sql(f"select coalesce(reserved_trade_id::text,'') from public.wh_items where id='{a1}'") == ''
      and sql(f"select count(*) from public.wh_friends where user_lo=least('{a}'::uuid,'{b}'::uuid) and user_hi=greatest('{a}'::uuid,'{b}'::uuid)") == '0', r)
check('blocked side gets the generic unavailable, and the code path says not_found', propose(a, b, [a1], [b1]).get('error') == 'unavailable' and call(a, 'wh_friend_redeem', {'code': call(b, 'wh_friend_code_get')['code']}).get('error') == 'not_found')
l, m = acct(), acct(); l1, l2 = item(l, 5), item(l, 6); m1, m2 = item(m, 5), item(m, 10)
lst = call(l, 'wh_listing_create', {'items': [l1, l2], 'wants': [5]})
check('listing: 2 offers of one tier, wants a species of that tier', lst.get('ok'), lst)
s = call(m, 'wh_board_search', {'tier': 2}); L = [x for x in s['listings'] if x['listing_id'] == lst['listing_id']]
check('board search finds it, shows what I can give (my shelf item of a wanted species) and what is NEW to me', len(L) == 1 and L[0]['you_can_give'] == [m1] and len(L[0]['offers']) == 2 and 'user_id' not in json.dumps(s), s if not L else '')
r = call(m, 'wh_propose_trade', {'idem': idem(), 'listing_id': lst['listing_id'], 'give': [m2], 'get': [l1]})
check('listing mismatch: giving a species the lister did not ask for is refused', r.get('error') == 'listing_mismatch', r)
r = call(m, 'wh_propose_trade', {'idem': idem(), 'listing_id': lst['listing_id'], 'give': [m1, item(m, 5)], 'get': [l1, l2]})
check('a stranger cannot propose 2 for 2 through the board (D-T5) [added 2026-10-05, not run]', r.get('error') == 'bad_size', r)
r = call(m, 'wh_propose_trade', {'idem': idem(), 'listing_id': lst['listing_id'], 'give': [m1], 'get': [l2]})
check('board proposal between non-friends works through the listing', r.get('ok') is True, r)
bt = r['trade_id']; view(l, bt)
c2 = call(l, 'wh_counter_trade', {'idem': idem(), 'trade_id': bt, 'expect_version': 1, 'give': [l1, l2], 'get': [m1, m2]})
c3 = call(l, 'wh_counter_trade', {'idem': idem(), 'trade_id': bt, 'expect_version': 1, 'give': [item(l, 6)], 'get': [m1]})
check('a board trade cannot be countered into 2 for 2, nor to an item outside the listing [added 2026-10-05, not run]', c2.get('error') == 'bad_size' and c3.get('error') == 'listing_mismatch', (c2, c3))
sql(f"insert into public.wh_blocks(blocker, blocked) values ('{l}','{m}')")
check('a block hides listings both ways', all(x['listing_id'] != lst['listing_id'] for x in call(m, 'wh_board_search', {})['listings']))

print('== 11. merge commit (host-computed roll) ==')
u = acct(); m_a, m_b = item(u, 0, False), item(u, 0, False); ver = int(sql(f"select version from public.wh_accounts where user_id='{u}'"))
code_out = sql("select public.t_genome(3::smallint, 777)")
pl = {'uid': u, 'idem': idem(), 'args_digest': 'd1', 'expect_version': ver, 'inputs': [m_a, m_b], 'cost': 2, 'out_species_idx': 3, 'out_tier_idx': 1, 'tier_up': True, 'genome_seed': 777, 'genome_code': code_out, 'pity_after': [0, 0, 0, 0, 0, 0], 'audit': {'draws': [0.1, 0.2, 0.3]}}
r = call(None, 'wh__commit_merge', pl, role='service_role')
check('merge commits: new item, inputs consumed, output locked 24 h, parents recorded', r.get('ok') and r['tier_up'] is True and sql(f"select count(*) from public.wh_items where id in ('{m_a}','{m_b}') and consumed_at is not null") == '2'
      and sql(f"select origin='blend' and parents @> array['{m_a}','{m_b}']::uuid[] and locked_until > now() + interval '23 hours' from public.wh_items where id='{r['item_id']}'") == 't', r)
r2 = call(None, 'wh__commit_merge', pl, role='service_role'); check('replay with the same idem returns the stored result', r2.get('replayed') is True and r2['item_id'] == r['item_id'])
check('stale expect_version is a conflict (host re-reads and re-rolls)', call(None, 'wh__commit_merge', {**pl, 'idem': idem(), 'inputs': [item(u, 0, False), item(u, 0, False)]}, role='service_role').get('error') == 'conflict')
check('authenticated players cannot call the commit functions', 'permission denied' in call(u, 'wh__commit_merge', pl).get('_error', ''))
for tag, bad_pl in {'wrong out tier': {'out_tier_idx': 2}, 'same species out': {'out_species_idx': 0, 'genome_code': sql("select public.t_genome(0::smallint, 777)")}, 'genome code species byte mismatch': {'genome_code': sql("select public.t_genome(4::smallint, 777)")}}.items():
    ver = int(sql(f"select version from public.wh_accounts where user_id='{u}'")); i1, i2 = item(u, 0, False), item(u, 0, False)
    out, err = sqlerr(f"set role service_role; select public.wh__commit_merge('{json.dumps({**pl, 'idem': idem(), 'expect_version': ver, 'inputs': [i1, i2], **bad_pl})}'::jsonb)")
    check('a bad host roll is rejected loudly and rolls back: ' + tag, 'wh_bad_roll' in err and sql(f"select count(*) from public.wh_items where id in ('{i1}','{i2}') and consumed_at is not null") == '0', err[:60])
# parallel merges of the same pair
u2_ = acct(); p1, p2 = item(u2_, 1, False), item(u2_, 1, False); ver = int(sql(f"select version from public.wh_accounts where user_id='{u2_}'")); cd = sql("select public.t_genome(3::smallint, 5)")
def mk(_): return call(None, 'wh__commit_merge', {'uid': u2_, 'idem': idem(), 'args_digest': 'p', 'expect_version': ver, 'inputs': [p1, p2], 'cost': 2, 'out_species_idx': 3, 'out_tier_idx': 1, 'tier_up': True, 'genome_seed': 5, 'genome_code': cd, 'pity_after': [0]*6}, role='service_role')
with cf.ThreadPoolExecutor(20) as ex: res = list(ex.map(mk, range(20)))
check('20 parallel merges of the same two items: exactly one commits', sum(1 for x in res if x.get('ok')) == 1, sorted(set((x.get('error') or 'ok') for x in res)))
# daily cap
u3_ = acct(); n_ok = 0; last = None
for i in range(11):
    ver = int(sql(f"select version from public.wh_accounts where user_id='{u3_}'")); i1, i2 = item(u3_, 0, False), item(u3_, 0, False)
    last = call(None, 'wh__commit_merge', {'uid': u3_, 'idem': idem(), 'args_digest': 'c', 'expect_version': ver, 'inputs': [i1, i2], 'cost': 2, 'out_species_idx': 1, 'out_tier_idx': 0, 'tier_up': False, 'genome_seed': 9, 'genome_code': sql("select public.t_genome(1::smallint, 9)"), 'pity_after': [1,0,0,0,0,0]}, role='service_role')
    n_ok += 1 if last.get('ok') else 0
check('10 merges a UTC day, the 11th is daily_cap', n_ok == 10 and last.get('error') == 'daily_cap', (n_ok, last))
ver_u = int(sql(f"select version from public.wh_accounts where user_id='{u}'")); ci = [item(u, 0, False), item(u, 0, False)]
check('cost mismatch between host and DB aborts', 'wh_cost_mismatch' in sqlerr("set role service_role; select public.wh__commit_merge('" + json.dumps({**pl, 'idem': idem(), 'cost': 3, 'expect_version': ver_u, 'inputs': ci}) + "'::jsonb)")[1])

print('== 12. capsule commit ==')
u = acct(); sql(f"insert into public.wh_capsules(owner_id, source) values ('{u}','play'),('{u}','task')"); ver = int(sql(f"select version from public.wh_accounts where user_id='{u}'"))
cp = {'uid': u, 'idem': idem(), 'args_digest': 'o', 'expect_version': ver, 'species_idx': 7, 'tier_idx': 3, 'genome_seed': 123456789, 'genome_code': sql("select public.t_genome(7::smallint, 123456789)"), 'draws': [0.97, 0.5, 0.2]}
r = call(None, 'wh__commit_open_capsule', cp, role='service_role')
check('open_capsule: mints, marks the oldest credit opened, is_new true, credits_left 1', r.get('ok') and r['is_new'] is True and r['credits_left'] == 1 and r['source'] == 'play', r)
check('replay returns the stored result and mints nothing more', call(None, 'wh__commit_open_capsule', cp, role='service_role').get('replayed') is True and sql(f"select count(*) from public.wh_items where owner_id='{u}'") == '1')
def oc(_): return call(None, 'wh__commit_open_capsule', {**cp, 'idem': idem(), 'expect_version': ver + 1}, role='service_role')
with cf.ThreadPoolExecutor(10) as ex: res = list(ex.map(oc, range(10)))
check('10 parallel opens with ONE credit left: exactly one succeeds', sum(1 for x in res if x.get('ok')) == 1 and sql(f"select count(*) from public.wh_items where owner_id='{u}'") == '2', sorted(set((x.get('error') or 'ok') for x in res)))
sql(f"insert into public.wh_capsules(owner_id, source) values ('{u}','play')"); ver_c = int(sql(f"select version from public.wh_accounts where user_id='{u}'"))
out, err = sqlerr("set role service_role; select public.wh__commit_open_capsule('" + json.dumps({**cp, 'idem': idem(), 'expect_version': ver_c, 'species_idx': 8, 'tier_idx': 4}) + "'::jsonb)")
check('a roll whose genome code does not carry its species is rejected loudly and the credit stays unopened', 'wh_bad_roll' in err and sql(f"select count(*) from public.wh_capsules where owner_id='{u}' and opened_at is null") == '1', err[:60])

bu = str(uuid.uuid4()); sql(f"insert into auth.users (id, email) values ('{bu}', 'b@invalid.test')"); bcode = sql("select public.t_genome(0::smallint, 5)")
with cf.ThreadPoolExecutor(10) as ex: res = list(ex.map(lambda _: call(None, 'wh__bootstrap', {'uid': bu, 'species_idx': 0, 'genome_code': bcode, 'genome_seed': 5, 'meter': {}}, role='service_role'), range(10)))
check('10 parallel first-contact bootstraps: exactly one account and ONE starter', sum(1 for x in res if x.get('created')) == 1 and sql(f"select count(*) from public.wh_items where owner_id='{bu}' and origin='starter'") == '1' and sql(f"select count(*) from public.wh_accounts where user_id='{bu}'") == '1', [x.get('created') or x.get('error') for x in res][:5])

print('== 13. deadlock freedom under a mixed parallel storm ==')
set_cfg('trade_daily_cap', 100); set_cfg('trade_pair_cap', 100)
ac = [acct() for _ in range(6)]
for i in range(6):
    for j in range(i + 1, 6): friends(ac[i], ac[j])
trades = []
random.seed(7)
for k in range(60):
    x, y = random.sample(range(6), 2); ax, by = item(ac[x], 5), item(ac[y], 6)
    r = propose(ac[x], ac[y], [ax], [by])
    if r.get('ok'): trades.append((ac[x], ac[y], r['trade_id']))
for (x, y, t) in trades: view(y, t)
settle()
mer = []
for q in range(24):
    o_ = ac[q % 6]; mer.append((o_, item(o_, 0, False), item(o_, 0, False)))
def storm(job):
    kind, payload = job
    if kind == 'cancel': return ('cancel', call(payload[0], 'wh_cancel_trade', {'idem': idem(), 'trade_id': payload[2]}))
    if kind == 'confirm': return ('confirm', confirm(payload[1], payload[2]))
    if kind == 'merge':
        o_, m1, m2 = payload; v_ = int(sql(f"select version from public.wh_accounts where user_id='{o_}'"))
        return ('merge', call(None, 'wh__commit_merge', {'uid': o_, 'idem': idem(), 'args_digest': 'm', 'expect_version': v_, 'inputs': [m1, m2], 'cost': 2, 'out_species_idx': 1, 'out_tier_idx': 0, 'tier_up': False, 'genome_seed': 9, 'genome_code': sql("select public.t_genome(1::smallint, 9)"), 'pity_after': [1,0,0,0,0,0]}, role='service_role'))
    if kind == 'shelf': return ('shelf', call(payload, 'wh_shelf_set', {'item_ids': []}))
    if kind == 'block': return ('block', call(payload[0], 'wh_block', {'partner_ref': pid(payload[1])}))
jobs = [('cancel' if random.random() < 0.12 else 'confirm', tr) for tr in trades] + [('merge', m_) for m_ in mer] + [('shelf', a_) for a_ in ac for _ in range(3)] + [('block', (ac[0], ac[5]))]
random.shuffle(jobs)
with cf.ThreadPoolExecutor(48) as ex: res = list(ex.map(storm, jobs))
dead = [r for _, r in res if 'deadlock' in json.dumps(r).lower() or '40P01' in json.dumps(r)]
ran = sum(1 for k, r in res if k == 'confirm' and r.get('status') == 'executed')
check(f'{len(jobs)} mixed operations in parallel (confirm, cancel, merge, shelf, block) over 6 accounts: zero deadlocks, {ran} swaps executed', not dead and ran > 5, [r for _, r in res if r.get('_error')][:2])
print('       outcomes:', {k + ':' + str(r.get('error') or r.get('status') or ('ok' if r.get('ok') else r.get('_error', '?')[:20])): 1 for k, r in res[:0]} or sorted(set((k, str(r.get('error') or r.get('status') or ('ok' if r.get('ok') else 'err'))) for k, r in res)))
check('conservation holds after the storm', conservation() == '0', sql('select problem, ref from public.wh_v_conservation limit 3'))
set_cfg('trade_daily_cap', 3); set_cfg('trade_pair_cap', 1)

print('== 14. laundering ring: a dupe-bug at one mule, then the caps ==')
mules = [acct() for _ in range(6)]
for i in range(6):
    for j in range(i + 1, 6): friends(mules[i], mules[j])
tainted = [item(mules[0], 5) for _ in range(10)]
placed = 0
for k in range(1, 6):
    tg = item(mules[k], 6); r = propose(mules[0], mules[k], [tainted[k - 1]], [tg])
    if r.get('ok'):
        view(mules[k], r['trade_id'])
        if k == 1: settle()
        c = confirm(mules[k], r['trade_id']); placed += 1 if c.get('status') == 'executed' else 0
# the next-hop: a mule that just received a tainted copy tries to merge it away or pass it on
tl = "','".join(tainted)
recv = sql(f"select id from public.wh_items where id = any(array['{tl}']::uuid[]) and owner_id <> '{mules[0]}' limit 1")
hop = call(sql(f"select owner_id from public.wh_items where id='{recv}'"), 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(mules[5]), 'give': [recv], 'get': [item(mules[5], 6)]})
check('inside the first 24 h the dupes spread to at most 3 accounts (the account cap), not 5', placed == 3, placed)
check('a freshly received tainted copy can neither be merged nor passed on (receive lock)', hop.get('error') in ('locked', 'daily_cap', 'unavailable') and hop.get('ok') is not True, hop)

print('== 15. ops: detection and account deletion ==')
x = acct(); xi = item(x, 5)
sql(f"insert into public.wh_items (owner_id,species_idx,tier_idx,genome_code,genome_seed,origin) select owner_id,species_idx,tier_idx,genome_code,genome_seed,origin from public.wh_items where id='{xi}'")
bad = sql("select problem from public.wh_v_conservation")
check('a cloned row (dupe bug) is flagged by the conservation view', 'live_item_without_exactly_one_mint' in bad and 'live_count_differs_from_ledger' in bad, bad.replace('\n', ','))
sql(f"delete from public.wh_items where owner_id='{x}' and id <> '{xi}'")
sql(f"delete from auth.users where id='{x}'")
check('deleting the auth user burns its items into the ledger and removes the account', sql(f"select count(*) from public.wh_ledger where kind='burn' and from_user='{x}'") == '1' and sql(f"select count(*) from public.wh_accounts where user_id='{x}'") == '0')
check('conservation is clean again', conservation() == '0', sql('select problem, ref from public.wh_v_conservation limit 3'))

print('== 16. lock timeout and propose idempotency under parallel retries ==')
a, b, a1, b1 = pair_with_items()
holder = subprocess.Popen(PSQL + ['-c', f"begin; select 1 from public.wh_accounts where user_id='{a}' for update; select pg_sleep(6); commit;"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.0); t1 = time.time(); r = propose(a, b, [a1], [b1]); el = time.time() - t1
check('a stuck lock fails fast (3 s lock_timeout) with a retryable error instead of hanging', 'lock timeout' in json.dumps(r) and 2.5 < el < 5.0, (round(el, 1), str(r)[:70]))
holder.wait(); r = propose(a, b, [a1], [b1])
check('after the lock is released the same call works (nothing was half-done)', r.get('ok') is True and sql(f"select count(*) from public.wh_trades where a_user='{a}'") == '1', r)
a, b, a1, b1 = pair_with_items(); k = idem(); body = {'idem': k, 'partner_ref': pid(b), 'give': [a1], 'get': [b1]}
with cf.ThreadPoolExecutor(10) as ex: res = list(ex.map(lambda _: call(a, 'wh_propose_trade', body), range(10)))
check('10 parallel retries of ONE propose (same idem): one trade, every caller gets the same trade_id', sql(f"select count(*) from public.wh_trades where a_user='{a}'") == '1' and len(set(x.get('trade_id') for x in res)) == 1 and all(x.get('ok') for x in res), [x.get('replayed') for x in res][:4])
check('same idem with different arguments: idem_reuse', call(a, 'wh_propose_trade', {**body, 'give': [item(a, 5)]}).get('error') == 'idem_reuse')

print('== 17. client reads and small writes ==')
a, b, a1, b1 = pair_with_items(); a2 = item(a, 5, False); sql(f"update public.wh_accounts set trade_enabled = true where user_id in ('{a}','{b}')")
st = call(a, 'wh_state'); check('wh_state: server clock and day, meter, trading readiness, no other-player data', st.get('ok') and st['trading']['ready'] is True and 'server_now_ms' in st and st['public_id'] == pid(a), {k: st.get(k) for k in ('trading',)})
inv = call(a, 'wh_inventory', {'limit': 1}); inv2 = call(a, 'wh_inventory', {'limit': 1, 'after': inv['next']})
check('wh_inventory pages by id: 1 + 1 + done', inv['ok'] and len(inv['items']) == 1 and len(inv2['items']) == 1 and inv2['next'] is not None and inv['items'][0]['id'] != inv2['items'][0]['id'] and call(a, 'wh_inventory', {'after': inv2['next']})['next'] is None)
call(a, 'wh_set_fav', {'item_ids': [a1], 'fav': True})
check('favourite: a hearted item cannot be proposed (and leaves the shelf)', propose(a, b, [a1], [b1]).get('error') == 'favourite' and sql(f"select offered_at is null from public.wh_items where id='{a1}'") == 't')
check('favourite: and cannot be merged', call(None, 'wh__commit_merge', {'uid': a, 'idem': idem(), 'args_digest': 'x', 'expect_version': int(sql(f"select version from public.wh_accounts where user_id='{a}'")), 'inputs': [a1, a2], 'cost': 2, 'out_species_idx': 6, 'out_tier_idx': 2, 'tier_up': False, 'genome_seed': 1, 'genome_code': 'g1.' + 'A' * 35, 'pity_after': [0]*6}, role='service_role').get('error') == 'favourite')
call(a, 'wh_set_fav', {'item_ids': [a1], 'fav': False}); call(a, 'wh_shelf_set', {'item_ids': [a1]})
sh = call(a, 'wh_friend_shelf', {'friend_ref': pid(b)}); check('friend shelf shows only offered, unlocked items of a friend', sh.get('ok') and [x['item_id'] for x in sh['items']] == [b1], sh)
check('friend shelf of a non-friend is not_found', call(a, 'wh_friend_shelf', {'friend_ref': pid(acct())}).get('error') == 'not_found')
h1 = call(a, 'wh_handle_set', {'adj': 3, 'noun': 5}); check('handle: two list indexes + server number', h1.get('ok') and 10 <= h1['handle']['num'] <= 99, h1)
check('handle change is limited to once a week; out-of-range words refused', call(a, 'wh_handle_set', {'adj': 4, 'noun': 5}).get('error') == 'slow_down' and call(b, 'wh_handle_set', {'adj': 64, 'noun': 1}).get('error') == 'bad_payload')
r = propose(a, b, [a1], [b1]); fl = call(a, 'wh_friend_list'); ib = call(b, 'wh_trade_inbox')
check('inbox lists the live trade for the partner with handle only', r.get('ok') and 'user' not in json.dumps(ib) and len(fl['friends']) == 1 and ib['trades'][0]['trade_id'] == r['trade_id'] and ib['trades'][0]['you_are'] == 'b', str(ib)[:100])
check('emote: fixed set only, rate limited', call(a, 'wh_trade_emote', {'trade_id': r['trade_id'], 'emote': 2}).get('ok') and call(a, 'wh_trade_emote', {'trade_id': r['trade_id'], 'emote': 2}).get('error') == 'slow_down' and call(a, 'wh_trade_emote', {'trade_id': r['trade_id'], 'emote': 9}).get('error') == 'bad_payload')
fr = call(a, 'wh_friend_remove', {'friend_ref': pid(b)}); check('unfriending cancels the live trade and frees the items', fr.get('cancelled_trades') == 1 and sql(f"select status from public.wh_trades where id='{r['trade_id']}'") == 'cancelled' and propose(a, b, [a1], [b1]).get('error') == 'unavailable')
check('mark_seen sets the flag', call(a, 'wh_mark_seen', {'item_ids': [a1]}).get('ok') and sql(f"select seen_at is not null from public.wh_items where id='{a1}'") == 't')
ox, oy, oxi, oyi = pair_with_items(); ko = idem(); po = call(ox, 'wh_propose_trade', {'idem': ko, 'partner_ref': pid(oy), 'give': [oxi], 'get': [oyi]})
so, sother = call(ox, 'wh_op_status', {'idems': [ko, idem()]}), call(oy, 'wh_op_status', {'idems': [ko]})
check('wh_op_status returns the stored answer of an own key only (nothing for an unknown key or for another player), and refuses junk [added 2026-10-05]',
      po.get('ok') and list(so['ops'].keys()) == [ko] and so['ops'][ko]['result']['trade_id'] == po['trade_id'] and sother['ops'] == {} and call(ox, 'wh_op_status', {'idems': 'x'}).get('error') == 'bad_payload', so)
print('== 17b. payload guard, counter cap, ops cleanup on deletion ==')
a, b, a1, b1 = pair_with_items(); huge = {'idem': idem(), 'partner_ref': pid(b), 'give': [a1], 'get': [b1], 'pad': 'x' * 9000}
check('an oversized payload (9 KB) is refused as the first step (a sanity limit: PostgREST has already parsed it; 7.4)', call(a, 'wh_propose_trade', huge).get('error') == 'bad_payload' and call(a, 'wh_board_search', {'pad': 'x' * 9000}).get('error') == 'bad_payload' and call(a, 'wh_friend_redeem', {'code': 'x' * 9000}).get('error') == 'bad_payload')
rb, rb2 = acct(), acct(); friends(rb, rb2); set_cfg('rate_offer', {'cap': 3, 'per_s': 0})
outs = [call(rb, 'wh_propose_trade', {'idem': idem(), 'partner_ref': pid(rb2), 'give': [str(uuid.uuid4())], 'get': [str(uuid.uuid4())]}) for _ in range(4)]
set_cfg('rate_offer', {'cap': 30, 'per_s': 0.1})
check('rate bucket: with rate_offer at 3 tokens and no refill, the 4th proposal in a row answers slow_down and writes nothing [added 2026-10-05, not run]',
      [o.get('error') for o in outs] == ['gone', 'gone', 'gone', 'slow_down'] and sql(f"select count(*) from public.wh_trades where a_user='{rb}'") == '0', [o.get('error') for o in outs])
a, b = acct(), acct(); friends(a, b); ai = [item(a, 5) for _ in range(3)]; bi = [item(b, 6) for _ in range(3)]
tid = propose(a, b, [ai[0]], [bi[0]])['trade_id']; ver = 1; last = None
for k in range(21):
    who, give, get = (b, [bi[k % 3]], [ai[k % 3]]) if k % 2 == 0 else (a, [ai[(k + 1) % 3]], [bi[(k + 1) % 3]])
    last = call(who, 'wh_counter_trade', {'idem': idem(), 'trade_id': tid, 'expect_version': ver, 'give': give, 'get': get})
    if last.get('ok'): ver = last['terms_version']
    else: break
check('a negotiation is capped at 20 versions (too_many_changes)', last.get('error') == 'too_many_changes' and ver == 20, (ver, last))
ghost = acct(); sql(f"insert into public.wh_ops (user_id, idem, op, args_digest, result) values ('{ghost}', 'g' || repeat('0', 20), 'x', 'd', '{{}}'::jsonb)"); sql(f"delete from auth.users where id='{ghost}'")
check('deleting an account also deletes its idempotency rows', sql(f"select count(*) from public.wh_ops where user_id='{ghost}'") == '0')

print('== 17c. privilege audit (the queries O14 and O15 of the ops pack) ==')
fn_ok = sql("select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wh\\_%' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))")
expected = sorted('wh_block wh_block_list wh_board_search wh_cancel_trade wh_confirm_trade wh_counter_trade wh_friend_code_get wh_friend_code_rotate wh_friend_list wh_friend_redeem wh_friend_remove wh_friend_respond wh_friend_shelf wh_handle_set wh_inventory wh_listing_cancel wh_listing_create wh_mark_seen wh_op_status wh_propose_trade wh_report wh_set_fav wh_shelf_set wh_state wh_trade_emote wh_trade_inbox wh_trade_view wh_unblock'.split())
check('the ONLY wh_ functions a player can call are the 28 client RPCs (no helper, no commit function, no trigger function); anon can call none', fn_ok.split(',') == expected and sql("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wh\\_%' and has_function_privilege('anon', p.oid, 'execute')") == '0', fn_ok.split(',') if fn_ok.split(',') != expected else '')
tg = sql("select string_agg(table_name || ':' || grantee || ':' || privs, ' ' order by table_name, grantee) from (select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'wh\\_%' group by 1, 2) x")
check('table privileges: players have SELECT on species, accounts, items, capsules and NOTHING else on any wh_ table', tg == 'wh_accounts:authenticated:SELECT wh_capsules:authenticated:SELECT wh_items:authenticated:SELECT wh_species:anon:SELECT wh_species:authenticated:SELECT', tg)
check("the migration left the portal's own objects alone: the sentinel keeps anon SELECT, authenticated INSERT and sequence USAGE [added 2026-10-05, not run]",
      sql("select has_table_privilege('anon', 'public.portal_sentinel', 'select') and has_table_privilege('authenticated', 'public.portal_sentinel', 'insert') and has_sequence_privilege('authenticated', 'public.portal_sentinel_id_seq', 'usage')") == 't')

print('== 17d. retention ==')
pu = acct()
for k, (op, age) in enumerate([('play', '2 days'), ('play', '2 hours'), ('merge', '10 days'), ('merge', '40 days')]):
    sql(f"insert into public.wh_ops (user_id, idem, op, args_digest, result, created_at) values ('{pu}', 'purge' || repeat('0', 14) || '{k}', '{op}', 'd', '{{}}'::jsonb, now() - interval '{age}')")
out = call(None, 'wh__purge', None, role='service_role')
check('purge removes play idempotency rows after 1 day and the others after 30 days, and nothing else', out.get('ops') == 2 and sql(f"select count(*) from public.wh_ops where user_id='{pu}'") == '2', out)
check('players cannot call the purge', 'permission denied' in call(pu, 'wh__purge', None).get('_error', ''))

print('== 18. reports, unblock, listings ==')
v = acct(); rs = [acct() for _ in range(3)]; young = acct(); sql(f"update public.wh_accounts set created_at = now() where user_id='{young}'")
for s_ in [acct() for _ in range(3)]: call(s_, 'wh_report', {'partner_ref': pid(v), 'reason': 3})
check('three eligible reporters with NO interaction with the account (no trade, request or friendship in 7 days) do not hold it [added 2026-10-05, not run]', sql(f"select restricted_until is null from public.wh_accounts where user_id='{v}'") == 't')
for r_ in rs + [young]: friends(r_, v)                                    # an interaction: a friendship
for r_ in rs[:2]: call(r_, 'wh_report', {'partner_ref': pid(v), 'reason': 3})
call(young, 'wh_report', {'partner_ref': pid(v), 'reason': 3})
check('reports from a NEW account (fails the gate) and only two eligible reporters do not trigger a hold', sql(f"select restricted_until is null from public.wh_accounts where user_id='{v}'") == 't')
call(rs[2], 'wh_report', {'partner_ref': pid(v), 'reason': 5})
check('a third DISTINCT eligible reporter puts the account on a 24 h trade hold (not a ban)', sql(f"select restricted_until > now() + interval '23 hours' and restricted_until < now() + interval '25 hours' from public.wh_accounts where user_id='{v}'") == 't')
w = acct(); friends(v, w); vi, wi = item(v, 5), item(w, 6)
check('the held account cannot propose or be proposed to (generic unavailable)', propose(v, w, [vi], [wi]).get('error') == 'not_allowed' and propose(w, v, [wi], [vi]).get('error') == 'unavailable', (propose(v, w, [vi], [wi]).get('error'), propose(w, v, [wi], [vi]).get('error')))
sql(f"update public.wh_accounts set restricted_until = now() - interval '1 minute' where user_id='{v}'"); sql(f"update public.wh_reports set at = at - interval '25 hours' where reported='{v}'")
call(rs[0], 'wh_report', {'partner_ref': pid(v), 'reason': 3})
check('a repeat report by one of the same reporters does NOT re-arm the hold [added 2026-10-05, not run]', sql(f"select restricted_until < now() from public.wh_accounts where user_id='{v}'") == 't')
fresh = [acct() for _ in range(3)]
for r_ in fresh: friends(r_, v); call(r_, 'wh_report', {'partner_ref': pid(v), 'reason': 2})
check('three NEW eligible reporters cannot cause a second automatic hold before a person has reviewed the first [added 2026-10-05, not run]', sql(f"select restricted_until < now() from public.wh_accounts where user_id='{v}'") == 't')
sql(f"update public.wh_accounts set hold_reviewed_at = now(), auto_hold_at = now() - interval '8 days' where user_id='{v}'")
call(fresh[0], 'wh_report', {'partner_ref': pid(v), 'reason': 2})
check('after a review, and 7 days after the last automatic hold, eligible reports can hold it again [added 2026-10-05, not run]', sql(f"select restricted_until > now() + interval '23 hours' from public.wh_accounts where user_id='{v}'") == 't')
check('report abuse is limited to 5 a day; bad reasons refused', call(rs[0], 'wh_report', {'partner_ref': pid(w), 'reason': 9}).get('error') == 'bad_payload' and all(call(rs[0], 'wh_report', {'partner_ref': pid(w), 'reason': 2}).get('ok') for _ in range(4)) and call(rs[0], 'wh_report', {'partner_ref': pid(w), 'reason': 2}).get('error') == 'slow_down')
ha, hb, ha1, hb1 = pair_with_items(); htid = propose(ha, hb, [ha1], [hb1])['trade_id']; view(hb, htid); settle()
sql(f"update public.wh_accounts set restricted_until = now() + interval '1 hour' where user_id='{ha}'"); hc = confirm(hb, htid)
check('a confirm while the other party is on a hold answers the generic unavailable and the trade stays alive (D-T10) [added 2026-10-05]',
      hc.get('error') == 'unavailable' and hc.get('terminal') is False and sql(f"select status from public.wh_trades where id='{htid}'") == 'proposed', hc)
sql(f"update public.wh_accounts set restricted_until = null where user_id='{ha}'"); hc = confirm(hb, htid)
check('when the hold ends, the same standing confirm executes [added 2026-10-05]', hc.get('status') == 'executed', hc)
x, y = acct(), acct(); friends(x, y); call(x, 'wh_block', {'partner_ref': pid(y)}); bl = call(x, 'wh_block_list')
check('block list shows handles only; unblock removes the block but NOT the friendship', len(bl['blocked']) == 1 and 'user' not in json.dumps(bl) and call(x, 'wh_unblock', {'partner_ref': pid(y)}).get('ok') and sql(f"select count(*) from public.wh_blocks where blocker='{x}'") == '0' and sql(f"select count(*) from public.wh_friends where user_lo=least('{x}'::uuid,'{y}'::uuid) and user_hi=greatest('{x}'::uuid,'{y}'::uuid)") == '0')
l = acct(); li = item(l, 5); lst = call(l, 'wh_listing_create', {'items': [li], 'wants': [5, 6]}); other = acct()
check('a listing can be cancelled by its owner only and then disappears from the board', call(other, 'wh_listing_cancel', {'listing_id': lst['listing_id']}).get('ok') and any(z['listing_id'] == lst['listing_id'] for z in call(other, 'wh_board_search', {})['listings']) and call(l, 'wh_listing_cancel', {'listing_id': lst['listing_id']}).get('ok') and not any(z['listing_id'] == lst['listing_id'] for z in call(other, 'wh_board_search', {})['listings']))
print('== 19. trading switched off (the age/consent seam) closes every social surface (added 2026-10-05, not run) ==')
adult, child, pal = acct(), acct(), acct(); friends(child, pal)
ccode = call(child, 'wh_friend_code_get')['code']; rq = call(adult, 'wh_friend_redeem', {'code': ccode})
rid = sql(f"select id from public.wh_friend_requests where from_user='{adult}' and to_user='{child}' and status='pending'")
sql(f"update public.wh_accounts set restricted_until = now() + interval '1 hour' where user_id='{child}'")
check('an account on a hold cannot accept a pending friend request (generic not_found), and the request stays pending',
      rq.get('requested') is True and call(child, 'wh_friend_respond', {'request_id': rid, 'accept': True}).get('error') == 'not_found' and sql(f"select status from public.wh_friend_requests where id='{rid}'") == 'pending')
sql(f"update public.wh_accounts set restricted_until = null where user_id='{child}'")
ci, pi_ = item(child, 5), item(pal, 6); tr = propose(pal, child, [pi_], [ci]); lc = call(child, 'wh_listing_create', {'items': [item(child, 5)], 'wants': [5]})
sql(f"update public.wh_accounts set trade_enabled = false where user_id='{child}'")
check('switching trading off cancels the pending request, the live trade (items released) and the listing, and empties the offer shelf',
      tr.get('ok') and lc.get('ok') and sql(f"select status from public.wh_friend_requests where id='{rid}'") == 'cancelled' and sql(f"select status from public.wh_trades where id='{tr['trade_id']}'") == 'cancelled'
      and sql(f"select coalesce(reserved_trade_id::text,'') from public.wh_items where id='{pi_}'") == '' and sql(f"select count(*) from public.wh_listings where user_id='{child}' and active") == '0'
      and sql(f"select count(*) from public.wh_items where owner_id='{child}' and offered_at is not null") == '0', (tr, lc))
cl = call(child, 'wh_friend_list')
check('the gated account sees no friends and no requests', cl.get('paused') is True and cl['friends'] == [] and cl['requests_in'] == [], cl)
check('its friends no longer see it or its shelf, and it cannot look at theirs', all(f['ref'] != pid(child) for f in call(pal, 'wh_friend_list')['friends'])
      and call(pal, 'wh_friend_shelf', {'friend_ref': pid(child)}).get('error') == 'not_found' and call(child, 'wh_friend_shelf', {'friend_ref': pid(pal)}).get('error') == 'not_found')
pair_sql = f"select count(*) from public.wh_friends where user_lo=least('{child}'::uuid,'{pal}'::uuid) and user_hi=greatest('{child}'::uuid,'{pal}'::uuid)"
suspended = sql(pair_sql) == '1'
sql(f"update public.wh_accounts set trade_enabled = true where user_id='{child}'")
check('the friendship is suspended, not deleted (owner decision D-17), and is visible again once trading is back on', suspended and any(f['ref'] == pid(child) for f in call(pal, 'wh_friend_list')['friends']))
print(f'\n{checks - fails}/{checks} checks passed in {time.time() - t0:.0f} s')
sys.exit(1 if fails else 0)
```

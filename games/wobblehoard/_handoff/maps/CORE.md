# SEAM MAP: CORE lane (src/core, src/data, src/collection) for PLAYGROUND

Read-only analysis, 2026-11-15, HEAD as found (no file changed except this one). Paths are relative to G = games/wobblehoard.

## Summary
- The genome (src/core/genome.ts:25-47) already holds enough to give every squishy a stable personality: firmness, bounce, stretch,
  size, eyeStyle, eyeSpacing/Size/Height, gloss, translucency and a uint32 `seed`. Per-species facts (family, lane, tier, signature
  touch, tags) live in one frozen table, src/data/catalog.ts. New per-species and per-family PLAYGROUND data belongs in NEW flat data
  modules keyed by SpeciesId / MaterialFamilyId (src/data/life.ts, places.ts, quests.ts). Do NOT add fields to MATERIAL_FAMILIES:
  probe_materials.ts:34-37 requires the exact key sets.
- The economy is a pure state machine (src/core/meter.ts) whose pace is proven by _harness/sim_economy.ts and probe_economy.ts.
  A quest system must read its OWN event stream and must never call addInteraction or feed touches. Then the pace holds by
  construction. Only capsule rewards touch the economy. Make them one-time and bounded.
- The save is `wobblehoard:v2:hoard`, HOARD_VERSION 2 (src/collection/constants.ts:23-24). Unknown keys are dropped on load, and a v != 2
  blob that is not newer is parked and replaced (store.ts:226, 386-397). Recommendation: put the Journal under its OWN key
  (`wobblehoard:v2:journal`), with its own version, rather than inside HoardSave.
- Purity is enforced by three probes: probe_collection_imports.ts (collection imports, the rollCapsule rule over ALL of src, clocks),
  probe_genome.ts:87-120 (core+data import graph acyclic, each module loads first in bare node) and catalog / IDX locks. src/life/**
  is covered by NO probe today. It needs its own import probe.
- The name and language gates live only inside _harness/probe_catalog.ts (not exported). Today they screen species, families, lanes,
  tiers and TASK_DEFS. No new place, thing, quest or keepsake text is screened until someone wires it in.

## 1. Genome, personality, favourites, species data

**What a genome holds** (genome.ts:25-47): `v`, `species`, `seed` (uint32 cosmetic), hue, chroma, lightness, coreHue, coreGlow,
translucency, gloss, **firmness, bounce, stretch, size**, glitter, speckle, pattern (4), **eyeStyle** (dot/oval/sleepy/wide), eyeSpacing,
eyeSize, eyeHeight. All unit fields are quantised to 1/255 and hues to whole degrees (genome.ts:66-85). The share string is 26 bytes
("g1." + 35 chars, genome.ts:146-193). One genome has exactly one string, so `encodeGenome(g)` is a safe identity or hash key.
`pitchRatio(g)` (genome.ts:140-144) already gives a voice pitch: -7 semitones per unit of size, +4 per unit of firmness, +-0.75 from the
seed. The voices (D3) should reuse it.

**Stable traits.** Derive traits from fields that are FIXED per instance and that the player can feel:
- `firmness`, `bounce`, `stretch` also drive the physics (materials.ts:518-534 `modulate`). A trait from them matches the feel (bouncy
  = playful, firm = steady, stretchy = curious). Catalog spread (my one-off node script over the 50 templates): firmness 0.25..0.8
  (median 0.4), bounce 0.2..0.9 (0.55), stretch 0.25..0.95 (0.5), size 0.35..0.7 (0.5). An instance moves +-0.08 inside its band
  (catalog.ts:125-129), plus a 0.04 signature bias (catalog.ts:635).
- `eyeStyle` is a fixed per-species enum: dot 10, oval 16, wide 12, sleepy 12. Good for a visible temperament (sleepy = napper,
  wide = noticer).
- `signature` (poke 19 / squeeze 20 / pull 11, catalog.ts:88) is the touch the species loves: a natural "likes to be ..." trait.
- `seed` is uint32 and differs per instance. Use `mulberry32(g.seed ^ SALT)` (rng.ts:4-14) with a NEW salt constant for any per-instance
  roll. Never reuse the salts 0x9e3779b9 (randomGenome), 0x51ed270b (pitchRatio) or 0x5bd1e995 (speciesBaseGenome).
- Traits must be a pure function of the genome (no stored trait), so a traded or merged squishy carries its personality for free.

**Deterministic favourites.** Per SPECIES (favourite place, favourite thing, best friend species): hand-author them as a 50-row table
in src/data/life.ts, keyed by SpeciesId, with `satisfies Record<SpeciesId, ...>` so a missing species fails tsc. Then a probe locks the
rules: friend != self, every place has favourites, no family has only one place, friendship is symmetric or a deliberate ring.
Hashing (`hashString(id)`, rng.ts:17-24) gives no control over the friend graph. If a hash must be used, salt it with the species ID,
never the idx or the name: ids are frozen (species.ts:3-22), names may change (catalog.ts:10-11). Per INSTANCE (a small twist, such
as which thing in a place it likes most): use the seed as above. Make it a discovery the player can make, but keep the species
favourite as the main fact.

**How species data is organised.** `SPECIES` (species.ts:23-36) is the append-only id list: idx = the share-string byte, max 255.
`CATALOG` (catalog.ts:596) is built from `RAW` (catalog.ts:212-580) and `SHAPES` (153-210), deep-frozen, and checked at load
(599-603). A SpeciesDef (catalog.ts:100-120) has: idx, id, name, tier, family, lane, signature, silhouette, shape, look, bands, blurb
(at most 90 chars) and tags. Lookups: `getSpecies` (safe for outside ids), `speciesDef`, `familyOf`, `tierOf`, `SPECIES_BY_TIER`.
Lanes: 6 lanes x (everyday + signature family) (catalog.ts:77-84); species per family are in the section 2 table.

**How to add per-species or per-family data.**
1. Use a new flat module in src/data/ (not a subfolder: probe_genome.ts:90 reads src/core and src/data NON-recursively, so a subfolder
   escapes the graph and load checks). Import only `../core/*.ts` types/values and `./catalog.ts`, `./materials.ts`. No DOM, no clock.
2. Type tables as `Record<SpeciesId, X>` / `Record<MaterialFamilyId, X>` so the compiler forces full coverage.
3. Add a probe (`_harness/probe_life_data.ts`): coverage, ranges, language gate (see 6). run_probes.ts picks up any probe_*.ts
   (run_probes.ts:9).
4. The catalog doc generator (_harness/gen_catalog_doc.ts) only reads catalog, shapes, materials, rarity and palette.
   probe_catalog.ts:813-814 fails if _spec/CATALOG.md differs from `renderCatalogDoc()`. If favourites are added to the doc, add the
   section to the generator AND regenerate in the same change, or the probe fails. A separate generator for `_spec/LIFE_TABLE.md` is
   safer.
5. Locks that must not move: IDX_LOCK (probe_catalog.ts:56, 346), 50 species and tier counts 14/11/10/7/5/3 (probe_catalog.ts:336-338,
   806), RESTOCK_POOL 25 and TASK_DEFS.length 8 (probe_collection.ts:912-913).

## 2. The 12 material families: physical signatures (src/data/materials.ts:263-356)

| family (species) | firm smOmega | bleed (air out) | memory / held dent | bounce intDamp (low = jiggly) | maxPull | tack / strings | slosh mass | jam | look | basis for PLAYGROUND reactions |
|---|---|---|---|---|---|---|---|---|---|---|
| slowrise (3) | 20 | 0.55, airTau 1.45 s | memStiff 2, no hold | 18 (dead) | 1.0 | 0.10 | 0 | 0.35 | opaque, cap 0.30, fuzz 0.35 | soaks water like a sponge, slow to rise in the cold, sinks into snow and leaves a slow print, a dull bounce |
| marshmallow (5) | 13 (softest foam) | 0.35, airTau 0.28 s | 0.5 | 12 | 1.3 | 0.20 | 0 | 0.10 | powdery, roughness 0.95, cap 0.40 | toasts by the fire (look), floats high, squashes flat in a pile |
| mochidough (4) | 14 | 0.05 | 3.0, yield 0.045, heal 2.5 s (keeps a print) | 16 | 2.1 | 0.30 | 0 | 0.10 | milky, cap 0.45 | picks up sand (look), keeps prints in snow, sags when warm |
| jellygel (5) | 23 | 0 | 0.1 | 4.6 (wobbly) | 1.73 | 0.15 | 0 | 0 | clear 0.82, gloss 0.88 | wobbles long after a bounce, glows in sun, a clear body shows water |
| waterfill (5) | 11 | 0 (volOmega 650) | 0.1 | 3.2 (most wobbly) | 1.5 | 0.05 | **0.45 @ 2.6 Hz, zeta 0.10** | 0 | clearest 0.93 | floats and sloshes, sways on a swing or a seesaw, cold makes it slow (look) |
| putty (3) | 12 | 0 | **5.0**, yield 0.07, heal 40 s; speedDamp 28 | 12 | 2.3 | 0.20 | 0 | 0 | opaque, cap 0.30 | firm on a fast hit, flows when held, keeps sand and snow prints for ages, stiffens in the cold |
| stickystretch (5) | 16 | 0 | 0.8 | 3.4 | **2.9** | **0.90 / 0.85**, table mu 1.10 | 0 | 0 | 0.6 | sticks to sand, snow and slides (grips a slope), strings on a pull |
| slimegoo (4) | **9.5** (softest) | 0 | 3.0, memTau 0.8 | 16 | 2.7 | 0.75 / **1.0** | 0 | 0 | gloss 0.96, glitter 1.3 | oozes on warm stones, collects sand (look), slow on snow |
| firmsilicone (3) | **38** | 0.02 | 0.05 | **2.0** (springiest) | 1.15 | 0.10 | 0 | 0.15 | 0.25 | best bouncer (springy cap, trampoline), fastest on ice |
| popdome (3) | **44** (stiffest) | 0.30 | 0 | 2.4 | 0.8 | 0 | 0 | 0.50 | 0.35 | stiff, springs back; **snap = 1 is PLANNED, not built** (materials.ts:301-305): no place may promise a pop or a flip |
| gummy (5) | 30 | 0 | 0.35 | 8 | 1.25 | 0.30 | 0 | 0.10 | clear 0.9 | quick bounce, a little sticky, goes soft when warm (look) |
| beadsqueeze (5) | 15 | 0.18 | 2.0, yield 0.05 | 14 | 1.4 | 0 | 0.20 @ 3.5 Hz, zeta 0.35 | **0.85** | grain 0.9, cap 0.50 | rattles, crunches on sand, heavy and slow in water |

Notes. (a) No family has a density, buoyancy, heat or wetness number today. Floating, soaking, toasting and freezing need NEW per-family
data in a new module (e.g. `FAMILY_REACTIONS: Record<MaterialFamilyId, {...}>` in src/data/places.ts or life.ts), not in
MaterialParams. The derived `feelOf()` scores (materials.ts:470-484: firm, squashy, slowRise, holdsDent, bouncy, stretchy, tacky,
sloshy, snappy, rateStiff, each 0..1) are a ready default for ranking: e.g. "best on the trampoline" = max `bouncy`, "sticks to the
slope" = max `tacky`. (b) The `planned.promiseWords` gate (materials.ts:232-238; probe_catalog.ts:772-786) screens only family and
species blurbs and tags. It must be extended to place and thing texts that mention popdome (pop, flip, snap, click). (c) Per-instance
modulation is bounded, x0.8..x1.25 (materials.ts:509-534), so a family's character never flips between instances: reactions can be
per family.

## 3. Meter, valve, daily cap, tasks, restock

**Exact rules** (src/core/meter.ts; numbers at 64-122):
- Tap (poke, or a squeeze held under 0.4 s) pays **0** (PAY.poke, :67; mapping :274). A squeeze pays 0.7 + 0.6/s of hold (capped at 3 s),
  plus 0.5 for a soft pop at a hold of 1.8 s or more (:289-293). A stretched pull (level 0.35 or more) pays 1.0 + 0.65/s (capped at 3 s).
  A pull that never stretched pays 0.5 flat (:294-301).
- Freshness: x clamp((gap / tau)^2, 0.03, 1), tau 2.4 s for a squeeze and 3.0 s for a pull (:98-103, :304-310).
- Medley: +2 SP for a squeeze plus a stretched pull within 12 s, then a 25 s cooldown (:106-107, :312-327).
- Valve: 40 SP in any rolling 60.0..60.5 s (500 ms buckets x 121) (:108-110, :329-338).
- Capsule ramp: 30 / 50 / 75 SP, then 100 SP each (:112-113). Daily: 8 capsules at full rate, then 25% rate, hard stop at 12 a UTC day
  (:114-116, :246).
- State is plain JSON and is never mutated (:126-147). `sanitizeMeter` clamps times from the future (:160-189).

**Practice wiring.** `Collection.feed` (collection/index.ts:166-185) maps SoftEvent to a touch (meterfeed.ts:43-65) and calls `ghostFeed`
(ghost.ts:93-114). At WH_QUEUE_MAX = 5 waiting play capsules the touch is **not fed at all**: no SP and no task progress (ghost.ts:95).
Every SoftEvent that reaches `feed` counts, from whichever body it came. Freshness is per KIND across all bodies, so pieces and extra
squishies cannot multiply pay (the valve and the freshness still bound them), but **an autonomous hop or nudge that emits
'release' (held 0.4 s or more) or 'snap' would be idle income**. The shell must feed `collection.feed` only with events from player
input. No probe checks this today (see Extension points).

**Daily tasks** (src/core/drops.ts:112-183): 8 TASK_DEFS (:131-140), metrics stretch / softPops / pokes / squeezes / medleys / snaps.
`dailyTasks(daySeed(deviceId, day, 'tasks'))` picks 2 a day (:143-149). Each claimed task gives 1 capsule, at most 5 a week (weeks start
Monday, `weekKeyOf` :152). Counting: `bumpTasks` (ghost.ts:65-81) is called on every accepted touch with the meter's
InteractionDetail. Thresholds (constants.ts:61-72): stretch 0.95 or more, snaps 0.35 or more, soft-pop streak 1.8 s or more, squeezes
default 0.4 s. Progress resets each UTC day (ghost.ts:101). Task capsules skip the table cap but are capped at TASK_CAPSULE_CAP = 10
(constants.ts:41; ghost.ts:193). Restock: 1 of 3 Common or Uncommon species from a pool of 25, once per UTC day, origin 'restock'
(drops.ts:80-110; ghost.ts:139-166).

**How quests can count richer events without touching the pace.** Use a separate pure reducer:
`applyQuestEvent(state, ev, defs, dayKey) -> {state, completed[]}` in src/core/quests.ts. `ev` is a small closed union produced by the
shell and LIFE hosts: visit(place), useThing(thing, species), pair(a, b, kind), pieceJoin, wishGranted(species, wish), discover(species,
fact), photo, and touch(kind, amount) copied from the same MappedTouch. It must never call addInteraction or previewInteraction, and it
must never be fed from ghostFeed. It should count touches even when the table is full (unlike tasks today, ghost.ts:95), so a quest
never stalls on "open a capsule first". Allocation-free like bumpTasks (a reusable record, counters in a Record keyed by quest id).
Deterministic: dayKey is injected and no clock is read. Server-friendly: core/ is shared with the host (drops.ts:6-9).

**Safe rewards.** Safe: keepsakes, discoveries, place unlocks, cosmetic or Journal stamps, a chosen gift species. None of these change
SP or capsules. Bounded: one capsule per chapter finale, paid once for life (for example 4 chapters = 4 capsules, about 14 active
minutes of play at 3.5 min a capsule). It goes through the existing task-capsule path (`ghostTaskCapsules`, bypasses the table cap,
cap 10) and needs a new grant function in **ghost.ts** (the only client file allowed to call rollCapsule, probe I03). Use origin
'task' (or 'restock' for a picked gift): ORIGINS is append-only (store.ts:50), and a row with a NEW origin code (5) is DROPPED by every
older build's `sanitizeRow` (store.ts:96), which parks the save and reports 'repaired'. Unsafe: any repeatable daily capsule beyond the
5-a-week task budget; any SP grant (it bypasses the valve and freshness); anything paid for autonomous behaviour.

**How the simulation proves it.** sim_economy.ts imports the real meter and drops (sim_economy.ts:18-27). Add (a) a "quest" source in
the macro model, a fixed list of one-time capsules on the days a regular player would reach each finale. Re-quote section C (median
active minutes per capsule: unchanged by construction, since the meter is untouched) and section K (days to all 50: moves a little,
quote both). (b) Rows in probe_economy.ts: lifetime quest capsules at most Q; quest capsules a day at most 1; a LIFE world stepped for
N simulated minutes with no player input earns exactly 0 SP (compare the "pure tapper earns 0" row, probe_economy.ts:230-234). The pace
gate stays: paying styles at 3.0..3.8 active min a capsule (probe_economy.ts:221-224). Measured now (ECON_NOTAP.md:58-66): squeezer 3.2,
puller 3.5, mixed 3.7, holder 3.2. A full sim run is about 390 s (DESIGN 5.4) and counts as a heavy job.

## 4. The collection store

**Format.** Key `wobblehoard:v2:hoard`, backup `wobblehoard:v2:hoard.unreadable` with at most 20 000 chars (constants.ts:23-27).
HoardSave (types.ts:121-148): deviceId, ghosts (compact MirrorRow[], types.ts:76), ghostMeter, ghostPity[6], ghostCapsules (<= 5),
ghostTaskCapsules (<= 10), ghostRestockDay, ghostTasks, ghostMerges, ghostOpened, mirror, pending, prefs, migratedFromV1.
`serializeHoard` writes a FIXED key list (store.ts:259-265), and `sanitizeHoard` rebuilds the save field by field (store.ts:225-256),
so **unknown keys are silently dropped on load and never written back**. Other keys: `wobblehoard:v1:profile` (read only from here,
save.ts:31) and `wobblehoard:v1:settings` (SETTINGS_VERSION 2; it carries unknown keys through, settings.ts:4-14).

**Migration machinery.** `migrateVersioned(x, target, steps)` (save.ts:82-97) is generic, never throws and refuses 'newer' or
'unmigratable'. PROFILE_MIGRATIONS and GENOME_MIGRATIONS are empty (save.ts:71-73). The Hoard has **no** step table:
`sanitizeHoard` refuses v != 2 (store.ts:226). loadHoard treats v > 2 as 'newer' (in memory, never writes, store.ts:386-389). Any other
version is parked and **replaced by a fresh or v1-migrated shelf** (store.ts:390-397). So raising HOARD_VERSION to 3 requires adding
a HOARD_MIGRATIONS step table (through migrateVersioned) first, or every v2 shelf would be parked and replaced on first load. A v3
blob also makes the deployed CDN build (2683d349) go read-only ('newer').

**Bounded sizes.** Ghosts: 100 (load 128). Mirror: 2000 rows. Pending: 20 entries, 10-minute TTL. Parents: 3 per row. Ids: 64 chars of
A-Za-z0-9_- (constants.ts:31-47). Rows are about 100 bytes each: 331 items under 40 KB, 1000 under 110 KB (COLLECTION 5.1; C06).
localStorage is about 5 MB.

**Two-tab safety.** Before each write the store re-reads the key. If the text changed, it adopts the other tab's save (when this tab
has nothing unsaved) or does a three-way `rebaseHoard` (store.ts:423-465): items by id, counters add their deltas, the meter comes
from the most recent side, tasks take the later day or a union. A `subscribe` hook makes an idle tab follow the other (store.ts:582-585).
A failed write is detected by reading it back (store.ts:556-557).

**What a Journal needs, and how big.** Recommended: a separate `wobblehoard:v2:journal` = `{ v: 1, quests, species, friends, keepsakes,
wishes, places, warmth }`. It gets its own sanitize / serialize / park / two-tab store, cloned from createHoardStore (store.ts:498-600).
Old builds never read the key, so a rollback cannot eat it. Almost every field only grows (bit sets, max counters), so the two-tab merge
is a union or max, simpler than rebaseHoard. Sizing (my estimates, JSON):
- quests: about 40 x [stateByte, counter] ~ 0.6 KB;
- discoveries: 50 species x a 16-bit mask ~ 0.4 KB;
- friendship: a sparse list of [speciesIdxA, speciesIdxB, level 0..255], capped at 128 pairs (1225 possible) ~ 1.5 KB;
- keepsakes: a bit set of 64 ~ 0.1 KB; places: a bit set; wishes: at most 3 open [species, wishId, sinceDay];
- per-instance warmth: {ghostId: level}, at most GHOST_CAP 100 ids x about 22 B ~ 2.2 KB. Prune ids that are no longer on the shelf when
  it loads, because merges consume ghosts.
Total about 5 KB. **Cap it at 16 000 chars** so the blob always parks whole (PARK_MAX_CHARS 20 000), and add a probe row like C06.
Naming warning: "Heart" already means the favourite flag (types.ts:46, FLAG_FAV store.ts:44). Per-instance affection must use another
word in code and copy (for example "warmth"), or players and engineers will confuse the two. Pieces have no HoardItem id: count their
deeds for the parent instance.

## 5. Import rules and purity probes

| Rule | Where enforced | Applies to |
|---|---|---|
| collection imports only `./x.ts`, `../core/x.ts`, `../data/x.ts`, `../contracts.ts` (type only) | probe_collection_imports.ts:69-82 (I01, I02) | src/collection/** |
| `rollCapsule` / `rollMerge` appear only in collection/ghost.ts (definitions in core/drops.ts, core/merge.ts); **strings count, comments do not** | :85-97 (I03), over EVERY file in src | whole src |
| no window/document/storage/navigator/fetch/performance/crypto/timers in collection | :99-112 (I04) | src/collection/** |
| no Date.now / Math.random / new Date in collection except exactly 2 injected defaults in index.ts | :113-115 (I05) | src/collection/** |
| MERGE_COST only imported from core/merge.ts | :118-127 (I06) | src/collection/** |
| ui/hoard imports only collection, ui/dom, ui/theme, contracts types | :129-137 (I07) | src/ui/hoard/** |
| core+data value-import graph acyclic; every module loads first in a fresh node | probe_genome.ts:87-120 | top-level src/core/*.ts, src/data/*.ts only |
| collection holds the 8 planned files and no bridge/api/sync | probe_collection.ts:917-925 (S01) | adding files is fine |

Layout that passes:
- `src/core/quests.ts`: imports `./rng.ts`, `./drops.ts` (only for daySeed, weekKeyOf, makeRng), `../data/quests.ts`, `../data/catalog.ts`.
  No clock and no DOM. The word rollCapsule must not appear anywhere, not even in a string.
- `src/data/places.ts`, `src/data/life.ts`, `src/data/quests.ts`: flat files. Import only core leaf modules (rng, rarity, genome types)
  and `./catalog.ts`, `./materials.ts`. They must never value-import `../core/quests.ts` (that would make a cycle with core/quests).
  Data only, no randomness.
- `src/collection/journal.ts` (+ `journal_store.ts`): allowed imports as above. Time comes as a parameter (I05 counts index.ts clock
  reads EXACTLY: a third read anywhere fails). Collection may not import src/life (I01), so LIFE events reach the Journal through the
  shell.
- `src/life/**`: nothing checks it yet. Add `_harness/probe_life_imports.ts` from the same scanner (stripComments / importsOf, :25-63).
  Allowed: `./`, `../core/`, `../data/`, `../contracts.ts` (type only). Forbidden: three, physics, render, audio, ui, shell, DOM and
  timer globals, Date.now, Math.random, performance.now. Add a determinism row: the same seed and script give identical intents.

## 6. Language-safety and originality checks for new names

All in `_harness/probe_catalog.ts`, section 7. The functions are module-local, NOT exported.
- **Originality** (`denyReason` :153, `denyReasonText` :170, `compoundReason` :193). Curated lists: toys, games, characters, brands,
  190 Pokemon, 40 Neopets (:91-121). Wide lists from `_harness/data/deny_pokemon.json` (1025 species) and `deny_creatures.json`
  (Digimon at least 200, Neopets 55, Moshi 6) (:125-135). The whole list has at least 1500 names (:687).
  NAME rules: equals, contains (5+ letters) or within edit distance 1, both as spelled and as read aloud (`spoken()`).
  PROSE rules: edit distance 1 against the curated list, whole-word equality against the wide lists, and contains for entries of 8+
  letters.
- **Language safety** (`unsafeReason` :277, `unsafeReasonText` :291). English plus 16 languages, stored reversed (:227-247), with
  sound-alike edits and short-root starts and ends (cum, ass, poo, pee ...) (`spoken` :253, roots :258-259). Prose allows the homographs nut, hump and bite.
- **Coverage today**: species name, id, blurb, tags and silhouette (:738-742); family names, family blurbs and look-bound reasons; lane
  names; tier names; TASK_DEFS texts (:743-755). COPY in collection/copy.ts gets only a jargon, "!" and 140-char check
  (probe_collection.ts:898-901), **not the deny or safety gates**.
- **Traps for PLAYGROUND words** (checked against the lists with one node call):
  - The curated list holds elsa, olaf, moana, maui, nemo, pingu, snoopy and spongebob. A snowman or a beach theme must not use them,
    nor any name one letter away.
  - The wide list holds ordinary-looking words that fail as whole prose words or as names: ditto, golem, slowpoke, seel, onix, muk,
    snom, snover, cubchoo, litwick, lampent, torkoal, shellos, wingull, sandygast, palossand, swablu, cottonee, jumpluff, applin,
    pineco, starly, flittle, marill, palmon, agumon.
- **How to run:** `node _harness/probe_catalog.ts` (light, under a minute in my reading; I did not run it). To screen new data: move
  the gate functions into an exported `_harness/name_gate.ts` (behaviour unchanged, the same self-tests) and call it from a new probe
  over PLACES, things, quests, keepsakes and squishmoji names, plus a promiseWords check for popdome. Also screen any new COPY with
  the gate.

## 7. Known open items in this lane
- probe_collection C08 previewTouch allocation row fails (73/74 at the session baseline, SESSION3.md). It predates this session.
- ECON: a cheap scripted path, a 0.4 s press every 2.4 s = 23.5 SP/min (STATUS.md, KNOWN OPEN). The owner may want a longer minimum hold.
- Pop Dome snap planned, not built (materials.ts:301-305): every new text must avoid its promise words.
- DESIGN 5.0 headline numbers are stale (3.1 min, 205/131 days against the current 3.5 min, 247/153 days, DESIGN 5.4). Re-quote at Stage C.
- The 'pokes' metric is kept in TaskDef for saved and server data but no task uses it (drops.ts:124, 130).
- Nicknames are not stored (types.ts:35-36; MirrorRow has no slot). Any "name your friend" quest would need a new slot.
- ORIGINS and MirrorRow are wire formats shared with the planned server DDL (COLLECTION App. A). Adding an origin or a row field is a
  server change too.
- No probe keeps autonomous events out of `collection.feed` (see 3).
- SQUISHY_SCIENCE section 4 is hand-copied from materials.ts, with no generator (SQUISHY_SCIENCE.md:264).

## Extension points

| What to add | Where | How hard | Risk |
|---|---|---|---|
| Trait derivation `traitsOf(genome)` (pure, from firmness, bounce, stretch, size, eyeStyle, signature) | src/data/life.ts or src/life/traits.ts | small | low; keep it total for half-built genomes like resolveMaterial |
| Per-species favourites (place, thing, friend), 50 rows | src/data/life.ts `Record<SpeciesId, ...>` + probe | medium (content) | the friend graph must be authored; names go through the gate |
| Per-family reactions (floats, soaks, toasts, slides, bounces) | src/data/places.ts or life.ts `Record<MaterialFamilyId, ...>` | small | do NOT touch MATERIAL_FAMILIES keys (probe_materials:34) |
| Place and thing definitions | src/data/places.ts | medium | lazy code elsewhere; data stays tiny and pure |
| Quest defs + reducer | src/data/quests.ts + src/core/quests.ts | medium | never call meter functions; no rollCapsule text |
| Journal state + store under its own key | src/collection/journal.ts, journal_store.ts; key in constants.ts | medium | two-tab merge, parking, a 16 000 char cap |
| One-time quest capsule grant | src/collection/ghost.ts (new function) + Collection interface member | small | origin must be an existing code; cap 10 task capsules; shelf cap 100 (shelf_full) |
| Journal reads in the Collection interface (`journal()`, `onEvent` 'quest-done') | src/collection/types.ts:354-409, index.ts | small | additive only; shell lane consumes |
| LIFE import probe | _harness/probe_life_imports.ts | small | none |
| Name gate as a shared module + PLAYGROUND text probe | _harness/name_gate.ts, probe_playground_text.ts | small | must keep probe_catalog behaviour byte-identical |
| Economy rows: 0 SP from LIFE, quest capsules bounded | _harness/probe_economy.ts, sim_economy.ts | medium (sim is heavy) | re-quote section C and K numbers |

## Constraints and numbers
- Pace: paying styles 3.0..3.8 active min a capsule (gate), measured 3.2 / 3.5 / 3.7 / 3.2. Regular median 3.5 (p10 2.7, p90 6.1).
  First capsule 77 s. MERGE_COST 2 (merge.ts:41), and it flips to 3 only at about 1.5 min a capsule.
- Valve 40 SP/min. Ramp 30/50/75/100. Daily 8 + 4 at 25%, stop at 12. Tasks 2 a day, 5 a week. Restock 1 of 3 a day. Table 5 play
  capsules. Task capsules 10. Shelf 100 ghosts. Merges 10 a day, 24 h output lock (merge.ts:51-52).
- Tier odds 76.3 / 13 / 6 / 2.8 / 1.4 / 0.5 (rarity.ts:32). 50 species, 14/11/10/7/5/3. idx at most 255, append only.
- Genome: 21 fields, 26-byte share string. Seed uint32. Instance bands +-0.08 for firmness, bounce, stretch.
- Storage: rows about 100 B. Parked blob at most 20 000 chars. Journal recommended at most 16 000 chars (about 5 KB expected).
- Hot paths allocation-free (bumpTasks, previewInteraction, feed for non-touch events: types.ts:369-370).
- Not checked by me: no probe, tsc or sim was run (two tiny node scripts only: catalog spreads, deny-list membership); COLLECTION 9
  read by headings only; SQUISHY_SCIENCE 4 beyond its first tables not read.

## Open questions for the designers
1. Are favourites per species only (simple, learnable: "all Puddlos love the beach"), or per instance with a species default? I suggest
   species first, with an instance twist as a later discovery.
2. Is the best friend a symmetric pair, or a one-way "likes"? 50 is even, so 25 perfect pairs is possible. Cross-lane pairs teach the
   families better.
3. Does affection (warmth) belong to an instance (lost when merged) or to a species? Merging consumes the instance (store.ts:434). Does
   a merge carry the parents' warmth over?
4. Quest capsules: how many for life (I suggest at most 1 per chapter finale), and should they use the 5-a-week task budget instead?
5. Do touch-based quest steps count while the table is full (I suggest yes, see 3)?
6. Is the Journal practice-only on this device like the ghosts, or planned for the server? If it is planned for the server, keep it in
   core/ form now (pure reducer, aggregates only, no per-touch log: COLLECTION 7.10 data minimisation).
7. Which reactions are physics (needs PHYS data: buoyancy, ground grip) and which are only looks or sounds? The family table above has
   no density or heat axis today.

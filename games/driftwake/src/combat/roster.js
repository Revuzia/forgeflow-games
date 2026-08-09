/**
 * ROSTER — the seam between the thirty rigged enemy BODIES and the combat
 * numbers. Nothing else in the tree knows both halves, and that is deliberate:
 * `combatData.js` owns HP/damage/telegraphs and must never learn a slug;
 * `assets/enemies/manifest.json` owns meshes and scales and must never learn a
 * balance number. This file is where a slug becomes a spawnable unit.
 *
 * WHY THE NUMBERS ARE NOT WRITTEN DOWN HERE. Every combat field below is read
 * off the matching `combatData.ENEMIES` row at module init, not transcribed.
 * The R3 reconciliation (`_spec/_build/roster_reconciled.json`, 38 discrepancies)
 * found four HP, three speed, two telegraph and seven variant-drift conflicts
 * between the roster board and combatData, and gave combatData the win in every
 * one of them — "combatData is the executable L10 anchor contract; the roster
 * page is derived documentation". Transcribing the winners would just recreate
 * the drift one edit later, so the merge runs at init instead. Init-time only:
 * the frame path never touches this module, and no helper here allocates.
 *
 * WHAT THIS FILE DOES OWN — the fields combatData has no opinion about, because
 * they describe a body rather than a fight: mesh file, engineScale, animRole,
 * grip, weapon prop, element, range band, pack doctrine, and the arena/boss
 * presentation rows. Those come from the roster board
 * (`F:\GrokUI\driftwake_enemies_meshy\_build_roster_html.py`), the only
 * mesh-anchored source, via the reconciliation.
 *
 * FOUR PLACES A SOURCE WAS OVERRULED, each marked `OVERRIDE:` at its use site:
 *   1. combatKey on 65/73/75 — both the manifest and the reconciliation still say
 *      null. combatData.js has carried `rimeSkierRaider`, `sandMummy` and
 *      `boneKnight` since 2026-08-07 (33 rows, verified by import). combatData
 *      wins: all thirty bodies now resolve to a row, none are orphans.
 *   2. hyperArmor on the golem and the three boss bodies — combatData omits the
 *      flag, the roster board sets it. enemies.js:551 and :734 read
 *      `row.hyperArmor` to decide whether a windup survives a stagger, so a
 *      missing flag is not a neutral default: it gets these units interrupted
 *      out of every windup. Roster board wins (reconciliation #9, severity high).
 *   3. Boss structure on 61_v3_cold_frost_golem — combatData's cold realm boss is
 *      `moraineElder` off `moraineColossus`, which has NO MESH, and its
 *      `shrinebreaker` row is a 760 HP miniboss. The roster board makes the Frost
 *      Golem the 2000 HP realm boss that opens Sand. Roster board wins
 *      (reconciliation #0, severity critical): an unshippable structure loses to
 *      a shippable one. The golem's FIELD numbers still come from combatData.
 *   4. attackPeakDmg on the three boss bodies — see `undamagedAttacks` below.
 *
 * BODIES ARE BIND-POSE ONLY. `manifest.enemies[slug].anims === null` is how the
 * runtime knows a body still has no motion; `ROLE_KIT` names the slots the clip
 * stage will fill, and `clipSlotsFor()` is what the AI state machine should ask
 * for. Clips are retargeted PER BODY and never shared (tools/blender_retarget.py
 * measures 0.51 matrix_local maxdiff between rigs; games/colosseum shipped shared
 * clips once and got feet 13–22 cm apart at idle).
 *
 * LOADING IS PER REALM. `BY_REALM` exists because the three realms are 2.961 /
 * 2.731 / 2.748 MiB and the budget is 3.0 MiB per realm — never 8.4 MiB at once.
 */

import { ENEMIES, TIER_TABLE } from "./combatData.js";

/* ------------------------------------------------------------------ *
 * ROLE_KIT — animRole -> the ordered clip slots the asset pipeline emits
 * ------------------------------------------------------------------ */

/**
 * Fifteen animation roles. Each list is `CORE_ANIMS` (idle/walk/run/hit/death,
 * every body gets them) followed by that role's attack slots, which is exactly
 * what `tools/build_enemy_assets.py::clip_slots()` writes into
 * `assets/enemies/manifest.json` — these lists were generated FROM the manifest,
 * not typed next to it, and `_selfCheck()` re-asserts the equality is still true
 * for every body at init. Ask for a slot that is not in this list and the
 * retarget stage will have produced nothing to play.
 *
 * The `boss` list really does contain "death" twice: the core set contributes
 * one and the roster board's boss kit names a third attack "death" (a two-handed
 * sword death clip). Left as the pipeline emits it — dedupe here and this list
 * stops matching the manifest, which is the property that matters.
 */
export const ROLE_KIT = {
    /** swarm — first body: 01_cold_rime_imp */
    swarm: ["idle", "walk", "run", "hit", "death", "rake_flurry", "pounce", "spit", "roar"],
    /** brute — first body: 02_cold_glacier_brute */
    brute: ["idle", "walk", "run", "hit", "death", "overhead_smash", "sweep", "charge", "finisher"],
    /** stalker — first body: 03_cold_frost_stalker */
    stalker: ["idle", "walk", "run", "hit", "death", "crouch", "leap", "rake"],
    /** mage — first body: 16_sand_dust_mage */
    mage: ["idle", "walk", "run", "hit", "death", "cast_bolt", "cast_zone", "heavy_lance"],
    /** raider — first body: 25_ash_scorch_raider */
    raider: ["idle", "walk", "run", "hit", "death", "combo", "lunge", "throw"],
    /** sentinel — first body: 28_ash_cinder_sentinel */
    sentinel: ["idle", "walk", "run", "hit", "death", "block", "thrust", "slash", "bash"],
    /** assassin — first body: 29_ash_soot_assassin */
    assassin: ["idle", "walk", "run", "hit", "death", "stealth", "dash_slash", "backstab", "vanish"],
    /** cultist — first body: 34_v2_cold_ice_cultist */
    cultist: ["idle", "walk", "run", "hit", "death", "cast_bolt", "cast_snare", "channel"],
    /** boss — first body: 50_v2_sand_dune_warden */
    boss: ["idle", "walk", "run", "hit", "death", "heavy_combo", "ranged", "death"],
    /** warden — first body: 60_v2_ash_scorch_warden */
    warden: ["idle", "walk", "run", "hit", "death", "sweep", "slam", "aura_cast"],
    /** golem — first body: 61_v3_cold_frost_golem */
    golem: ["idle", "walk", "run", "hit", "death", "punch", "pound", "swat"],
    /** knight — first body: 68_v3_cold_hail_plate_guard */
    knight: ["idle", "walk", "run", "hit", "death", "slash_combo", "shield_slam", "guard"],
    /** mummy — first body: 73_v3_sand_mummy */
    mummy: ["idle", "walk", "run", "hit", "death", "grab_wrap", "curse_cast", "spit", "shambling"],
    /** bandit — first body: 77_v3_sand_windscour_bandit */
    bandit: ["idle", "walk", "run", "hit", "death", "slash", "kick", "throw"],
    /** guardian — first body: 88_v3_ash_furnace_guardian */
    guardian: ["idle", "walk", "run", "hit", "death", "smash", "breath_cast", "grapple"],
};

/* ------------------------------------------------------------------ *
 * MESH side — one literal per body. NO combat numbers live in here.
 * ------------------------------------------------------------------ */

/**
 * `engineScale` is not optional and is not a suggestion: raw Meshy exports
 * differ by more than 2x between bodies (golem 2.1991 vs mummy 0.9867), and the
 * pipeline's own comment (build_enemy_assets.py:167-169) says it "normalises
 * this body to the player's head-above-feet height and then folds in the
 * roster's deliberate size intent". It ALREADY CONTAINS `sizeScale` — multiply
 * the two together and the golem comes out 4.8x. `sizeScale` is carried only so
 * gameplay code can read the design intent (brute 1.45, golem 2.2) without
 * re-deriving it from a matrix.
 */
const MESH = {
    "01_cold_rime_imp": {
        n: "01", name: "Rime Imp", realm: "cold",
        role: "swarm", animRole: "swarm", key: "rimeImp",
        mesh: "01_cold_rime_imp.glb", bytes: 326428,
        engineScale: 1.4101, sizeScale: 1.0, aabbHeightM: 1.68354, joints: 46,
        grip: "CLAWS / BODY", weaponProp: "Claws (body) — no prop",
        element: "ice", rangeBand: "Mid", mage: false,
        attackDoc: "rake 4×3 · pounce 8 · ice spit 3", attackPeakDmgDoc: 8,
        special: "Pack Call: first spotter aggros imps in 30 m; +15% atk speed / nearby imp (cap 3)",
        pack: { mode: "always", note: "3–6 on erupt; never solo", byDifficulty: "E:3  N:4–5  H:5–6 + sprite" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "02_cold_glacier_brute": {
        n: "02", name: "Glacier Brute", realm: "cold",
        role: "brute", animRole: "brute", key: "glacierBrute",
        mesh: "02_cold_glacier_brute.glb", bytes: 324532,
        engineScale: 1.5025, sizeScale: 1.45, aabbHeightM: 1.70975, joints: 52,
        grip: "2H MAUL", weaponProp: "Ice maul prop (mesh empty hands)",
        element: "ice/phys", rangeBand: "Melee", mage: false,
        attackDoc: "slam 22 (4 m) · sweep 16 · ram 18", attackPeakDmgDoc: 22,
        special: "Rime Carapace 260. MINIBOSS The Icewall 1200 — mid-realm; does NOT open Sand.",
        pack: { mode: "solo+", note: "Field tank / Glacier Line · arena as Icewall", byDifficulty: "E:solo  N:1+cultist  H:1+2 casters" },
        bossKind: "miniboss", bossName: "The Icewall (field 520 → arena 1200)", bossKey: "glacierIcewall", arenaHp: 1200, arenaStance: 160,
    },
    "03_cold_frost_stalker": {
        n: "03", name: "Frost Stalker", realm: "cold",
        role: "stalker", animRole: "stalker", key: "frostStalker",
        mesh: "03_cold_frost_stalker.glb", bytes: 295420,
        engineScale: 0.9804, sizeScale: 1.0, aabbHeightM: 1.89823, joints: 28,
        grip: "DUAL KNIVES", weaponProp: "Frost knives prop",
        element: "ice", rangeBand: "Melee", mage: false,
        attackDoc: "pounce 18 · rake 7×2 · backflip 9", attackPeakDmgDoc: 18,
        special: "Powder Dive pursuer: submerged 13 m/s, 60 m leash. Mini-Vortex on wake → stun 1.5 s",
        pack: { mode: "pair", note: "Hunt packs: 2 stalkers + imps", byDifficulty: "E:1  N:2  H:2 + imp screen" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "31_v2_cold_rime_imp": {
        n: "31", name: "Rime Imp v2", realm: "cold",
        role: "swarm", animRole: "swarm", key: "rimeImp",
        mesh: "31_v2_cold_rime_imp.glb", bytes: 305788,
        engineScale: 1.1927, sizeScale: 1.0, aabbHeightM: 1.89386, joints: 52,
        grip: "CLAWS / BODY", weaponProp: "Claws",
        element: "ice", rangeBand: "Mid", mage: false,
        attackDoc: "same kit as 01 · slightly faster spit", attackPeakDmgDoc: 8,
        special: "Visual upgrade of Rime Imp; same Pack Call doctrine",
        pack: { mode: "always", note: "Interchangeable with 01 in Imp Warren", byDifficulty: "E:3  N:4–5  H:5–6" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
        variantOf: "01_cold_rime_imp",
    },
    "32_v2_cold_glacier_brute": {
        n: "32", name: "Glacier Brute v2", realm: "cold",
        role: "brute", animRole: "brute", key: "glacierBrute",
        mesh: "32_v2_cold_glacier_brute.glb", bytes: 319568,
        engineScale: 1.518, sizeScale: 1.0, aabbHeightM: 1.31368, joints: 28,
        grip: "2H MAUL", weaponProp: "Ice maul prop",
        element: "ice/phys", rangeBand: "Melee", mage: false,
        attackDoc: "smash + ice shockwave · ram", attackPeakDmgDoc: 24,
        special: "Higher ARM/poise flavor of Glacier Brute",
        pack: { mode: "solo+", note: "Elite single-threat", byDifficulty: "E:solo  N:solo+  H:1+support" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
        variantOf: "02_cold_glacier_brute",
    },
    "34_v2_cold_ice_cultist": {
        n: "34", name: "Ice Cultist", realm: "cold",
        role: "cultist", animRole: "cultist", key: "rimeboundCultist",
        mesh: "34_v2_cold_ice_cultist.glb", bytes: 328328,
        engineScale: 1.0046, sizeScale: 1.0, aabbHeightM: 1.87803, joints: 34,
        grip: "STAFF CAST", weaponProp: "Ice staff / totem prop",
        element: "ice", rangeBand: "Far", mage: true,
        attackDoc: "rune bolt 8×2 · glyph snare 14 · lash 10", attackPeakDmgDoc: 14,
        special: "★ TRUE MAGE. Rime Ritual shields allies 15 m (−50% frost). Interrupt = team stagger",
        pack: { mode: "pack", note: "Ritual Circle w/ guard + imps; never alone", byDifficulty: "E:1+imps  N:1+guard  H:1+guard+imps" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "39_v2_cold_blizzard_assassin": {
        n: "39", name: "Blizzard Assassin", realm: "cold",
        role: "assassin", animRole: "assassin", key: "blizzardAssassin",
        mesh: "39_v2_cold_blizzard_assassin.glb", bytes: 268672,
        engineScale: 0.984, sizeScale: 1.0, aabbHeightM: 1.89866, joints: 34,
        grip: "DUAL 1H", weaponProp: "Short blades / ice darts prop",
        element: "ice", rangeBand: "Mid", mage: false,
        attackDoc: "dash 16 · needles 4×3 · exec 8×4=32", attackPeakDmgDoc: 32,
        special: "Whiteout Cloak stealth; 3× openers. Wave strips cloak. One stealth striker at a time",
        pack: { mode: "solo+", note: "Solo pick-off or Elite Hunt with Colossus", byDifficulty: "E:solo rare  N:1  H:1 + elite" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "61_v3_cold_frost_golem": {
        n: "61", name: "Frost Golem", realm: "cold",
        role: "golem", animRole: "golem", key: "packIceGolem",
        mesh: "61_v3_cold_frost_golem.glb", bytes: 280732,
        engineScale: 2.1991, sizeScale: 2.2, aabbHeightM: 1.85955, joints: 34,
        grip: "BODY/FISTS", weaponProp: "Crystal arms (no prop)",
        element: "ice/phys", rangeBand: "Melee", mage: false,
        attackDoc: "piston 24 · pound 20 · swat 16 · core shockwave · masonry lob", attackPeakDmgDoc: 24,
        special: "★ COLD REALM BOSS fixed L10 — 5 crystal cores (body invuln). Kill opens Sand. Field elite 300 HP cores.",
        pack: { mode: "boss", note: "Arena gate · 34 m shrine cirque", byDifficulty: "Arena only" },
        bossKind: "realm_boss", bossName: "Shrinebreaker (field 300 cores → arena 2000)", bossKey: "shrinebreaker", arenaHp: 2000, arenaStance: 0,
        // OVERRIDE 3: combatData BOSSES has `shrinebreaker` as a 760 HP miniboss
        // and gives Cold to `moraineElder` (base moraineColossus, no mesh). The
        // roster board makes this body the 2000 HP realm boss that opens Sand.
        // OVERRIDE 2: recon #9 (winner A): enemies.js:551/:734 read row.hyperArmor to keep a windup alive through a stagger
        hyperArmorFromRoster: true,
    },
    "65_v3_cold_rime_skier_raider": {
        n: "65", name: "Rime Skier Raider", realm: "cold",
        // OVERRIDE 1: manifest.json and roster_reconciled.json both still say
        // combatKey null here — both predate the mesh-anchored row landing.
        role: "raider", animRole: "raider", key: "rimeSkierRaider",
        mesh: "65_v3_cold_rime_skier_raider.glb", bytes: 317068,
        engineScale: 1.1714, sizeScale: 1.0, aabbHeightM: 1.68026, joints: 34,
        grip: "1H AXE/SPEAR", weaponProp: "Spear / ice axe prop",
        element: "ice/phys", rangeBand: "Mid", mage: false,
        attackDoc: "slide charge 14 · spear poke 9 · snow spray 6", attackPeakDmgDoc: 14,
        special: "MESH-ONLY (no combatData row). Alpine ski-leather skirmisher — high mobility anti-kite",
        pack: { mode: "pair", note: "2–3 skirmishers; can fill Scout Screen role", byDifficulty: "E:1–2  N:2  H:3 + imp" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "68_v3_cold_hail_plate_guard": {
        n: "68", name: "Hail Plate Guard", realm: "cold",
        role: "knight", animRole: "knight", key: "hailPlateGuard",
        mesh: "68_v3_cold_hail_plate_guard.glb", bytes: 338128,
        engineScale: 1.1949, sizeScale: 1.0, aabbHeightM: 1.39657, joints: 46,
        grip: "1H SWORD+SHIELD", weaponProp: "Sword + shield prop",
        element: "ice/phys", rangeBand: "Melee", mage: false,
        attackDoc: "hook 18 · check 12 · hail stomp 14", attackPeakDmgDoc: 18,
        special: "Hailstone Bulwark: planted KB/fling immune; frontal bolts ricochet. Protects mages",
        pack: { mode: "post", note: "Post guard with cultist/imps (Ritual Circle)", byDifficulty: "E:solo post  N:1+cultist  H:1+mage+imps" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "11_sand_dune_imp": {
        n: "11", name: "Dune Imp", realm: "sand",
        role: "swarm", animRole: "swarm", key: "duneImp",
        mesh: "11_sand_dune_imp.glb", bytes: 288348,
        engineScale: 1.2109, sizeScale: 1.0, aabbHeightM: 1.73746, joints: 52,
        grip: "CLAWS / BODY", weaponProp: "Claws",
        element: "sand", rangeBand: "Mid", mage: false,
        attackDoc: "rake 5×2 · pounce 9 · grit fling", attackPeakDmgDoc: 9,
        special: "Dune Dive: pack submerges as mounds, resurfaces surrounding player",
        pack: { mode: "always", note: "3–6 mounds; Mound Field pack", byDifficulty: "E:3  N:5  H:5–6 + husk" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "12_sand_dune_brute": {
        n: "12", name: "Dune Brute", realm: "sand",
        role: "brute", animRole: "brute", key: "duneBrute",
        mesh: "12_sand_dune_brute.glb", bytes: 302084,
        engineScale: 1.1092, sizeScale: 1.0, aabbHeightM: 1.66229, joints: 34,
        grip: "2H MAUL", weaponProp: "Stone club prop",
        element: "sand/phys", rangeBand: "Melee", mage: false,
        attackDoc: "slam 26 · sweep 20 · bulldoze 24 · grab 28", attackPeakDmgDoc: 28,
        special: "Anchored Mass: full KB/fling immune. Spike-stun only opener. MINIBOSS: Gatekeeper of Brass 1500",
        pack: { mode: "solo+", note: "Brass Wall tank; rarely alone on Hard", byDifficulty: "E:solo  N:1+bandits  H:1+bandits+mage" },
        bossKind: "miniboss", bossName: "Gatekeeper of Brass (1500 HP)", bossKey: "gatekeeperOfBrass", arenaHp: 1500, arenaStance: 220,
    },
    "13_sand_dust_stalker": {
        n: "13", name: "Dust Stalker", realm: "sand",
        role: "stalker", animRole: "stalker", key: "dustStalker",
        mesh: "13_sand_dust_stalker.glb", bytes: 275672,
        engineScale: 0.98, sizeScale: 1.0, aabbHeightM: 1.89883, joints: 34,
        grip: "DUAL KNIVES", weaponProp: "Curved knives prop",
        element: "sand", rangeBand: "Melee", mage: false,
        attackDoc: "opener 26 (~3×) · flurry 6×3 · hamstring 10", attackPeakDmgDoc: 26,
        special: "Sand Shroud pursuer 13 m/s submerged, 60 m leash — Sand anti-kite",
        pack: { mode: "pair", note: "1–2 with packs; stealth token shared", byDifficulty: "E:1  N:1–2  H:2" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "16_sand_dust_mage": {
        n: "16", name: "Dust Mage", realm: "sand",
        role: "mage", animRole: "mage", key: "dustMage",
        mesh: "16_sand_dust_mage.glb", bytes: 247328,
        engineScale: 0.9766, sizeScale: 1.0, aabbHeightM: 1.89831, joints: 34,
        grip: "STAFF CAST", weaponProp: "Staff / sand focus prop",
        element: "sand", rangeBand: "Far", mage: true,
        attackDoc: "grit bolt 9 · sandblast 12 · dust devil 4/s · glass lance 22★", attackPeakDmgDoc: 22,
        special: "★ TRUE MAGE. Mirage Step blink + clone. Glass lance = 1.5 s red interruptible channel",
        pack: { mode: "pack", note: "Always with bandits/brute (ranged slot rule)", byDifficulty: "E:1+imps  N:1+bandits  H:1+brute pack" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "43_v2_sand_dust_stalker": {
        n: "43", name: "Dust Stalker v2", realm: "sand",
        role: "stalker", animRole: "stalker", key: "dustStalker",
        mesh: "43_v2_sand_dust_stalker.glb", bytes: 260704,
        engineScale: 0.9911, sizeScale: 1.0, aabbHeightM: 1.89916, joints: 28,
        grip: "DUAL KNIVES", weaponProp: "Knives prop",
        element: "sand", rangeBand: "Melee", mage: false,
        attackDoc: "same as 13, cleaner silhouette", attackPeakDmgDoc: 26,
        special: "Elite pack stalker variant",
        pack: { mode: "pair", note: "Swap with 13", byDifficulty: "E:1  N:1–2  H:2" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
        variantOf: "13_sand_dust_stalker",
    },
    "48_v2_sand_dune_sentinel": {
        n: "48", name: "Dune Sentinel", realm: "sand",
        role: "sentinel", animRole: "sentinel", key: "duneSentinel",
        mesh: "48_v2_sand_dune_sentinel.glb", bytes: 302680,
        engineScale: 1.0325, sizeScale: 1.0, aabbHeightM: 1.8986, joints: 34,
        grip: "1H+SHIELD", weaponProp: "Halberd / spear + shield prop",
        element: "sand/phys", rangeBand: "Melee", mage: false,
        attackDoc: "sweep 18 · chop 30 · stomp quake 14", attackPeakDmgDoc: 30,
        special: "Watchman's Horn: 35 m sight; pulls imps/bandits 30 m. Snipe 36–40 m or Spike-cancel",
        pack: { mode: "post", note: "Watch Post: 1 sentinel + scouts", byDifficulty: "E:solo post  N:1+2 scouts  H:1+bandits" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "50_v2_sand_dune_warden": {
        n: "50", name: "Dune Warden", realm: "sand",
        role: "warden", animRole: "boss", key: "duneWarden",
        mesh: "50_v2_sand_dune_warden.glb", bytes: 308672,
        engineScale: 0.997, sizeScale: 1.0, aabbHeightM: 1.89869, joints: 28,
        grip: "2H GLAIVE", weaponProp: "Khopesh / glaive prop",
        element: "sand", rangeBand: "Mid", mage: false,
        attackDoc: "sand slash 18 · khopesh chain · warden slam · geyser", attackPeakDmgDoc: 18,
        special: "★ REALM BOSS. Sand Ward dome + Decree troop command. Stance 220. Fixed L20",
        pack: { mode: "boss", note: "Arena only + adds; not ambient", byDifficulty: "Arena script only" },
        bossKind: "realm_boss", bossName: "Warden of the Sundered Gate", bossKey: "duneWarden", arenaHp: 2400, arenaStance: 220,
        // OVERRIDE 2: roster board L393 hyper=True; recon never diffed boss rows for this field
        hyperArmorFromRoster: true,
    },
    "73_v3_sand_mummy": {
        n: "73", name: "Sand Mummy", realm: "sand",
        // OVERRIDE 1: manifest.json and roster_reconciled.json both still say
        // combatKey null here — both predate the mesh-anchored row landing.
        role: "mummy", animRole: "mummy", key: "sandMummy",
        mesh: "73_v3_sand_mummy.glb", bytes: 263080,
        engineScale: 0.9867, sizeScale: 1.0, aabbHeightM: 1.89857, joints: 34,
        grip: "FISTS/WRAP", weaponProp: "Bandaged fists (optional khopesh prop)",
        element: "sand/dark", rangeBand: "Melee", mage: false,
        attackDoc: "grab 14 · curse DoT 4/s · sand spit 8 · wrap snare 10", attackPeakDmgDoc: 14,
        special: "MESH-ONLY undead. #73 IS MUMMY (user lock) — not scorpion. Slow horror / decay stacks",
        pack: { mode: "pair", note: "1–2 with imp mounds; rarely packs alone", byDifficulty: "E:1  N:1–2  H:2 + imps" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "75_v3_sand_bleached_bone_knight": {
        n: "75", name: "Bone Knight", realm: "sand",
        // OVERRIDE 1: manifest.json and roster_reconciled.json both still say
        // combatKey null here — both predate the mesh-anchored row landing.
        role: "knight", animRole: "knight", key: "boneKnight",
        mesh: "75_v3_sand_bleached_bone_knight.glb", bytes: 315344,
        engineScale: 0.9915, sizeScale: 1.0, aabbHeightM: 1.85197, joints: 34,
        grip: "1H SWORD+SHIELD", weaponProp: "Bone sword + shield prop",
        element: "phys/dark", rangeBand: "Melee", mage: false,
        attackDoc: "slash combo 12×2 · shield slam 18 · bone shard 10", attackPeakDmgDoc: 20,
        special: "MESH-ONLY. Undead bone plate; can stand in for Hourglass Automaton post if needed",
        pack: { mode: "solo+", note: "Solo elite or with 2 imps", byDifficulty: "E:solo  N:1+imps  H:1+bandit" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "77_v3_sand_windscour_bandit": {
        n: "77", name: "Windscour Bandit", realm: "sand",
        role: "bandit", animRole: "bandit", key: "windscourBandit",
        mesh: "77_v3_sand_windscour_bandit.glb", bytes: 299320,
        engineScale: 0.9899, sizeScale: 1.0, aabbHeightM: 1.89794, joints: 52,
        grip: "1H SCIMITAR", weaponProp: "Scimitar + dagger prop",
        element: "sand/phys", rangeBand: "Melee", mage: false,
        attackDoc: "slash 9×2 · grit blind · boot shove 6 · flank +30%", attackPeakDmgDoc: 9,
        special: "Pack Doctrine: NEVER alone — 3–5, one off-camera. Great Vortex designed wipe",
        pack: { mode: "always", note: "Bandit Doctrine flagship pack", byDifficulty: "E:3  N:4  H:5 + mage" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "21_ash_cinder_imp": {
        n: "21", name: "Cinder Imp", realm: "ash",
        role: "swarm", animRole: "swarm", key: "cinderImp",
        mesh: "21_ash_cinder_imp.glb", bytes: 308696,
        engineScale: 1.332, sizeScale: 1.0, aabbHeightM: 1.76962, joints: 34,
        grip: "CLAWS / BODY", weaponProp: "Claws",
        element: "fire", rangeBand: "Mid", mage: false,
        attackDoc: "rake 5×2 · lunge 8 · frenzy bite DoT", attackPeakDmgDoc: 8,
        special: "Ash-drift pop: buried packs of 3–6; death cinder puff 3 dmg",
        pack: { mode: "always", note: "3–6 erupt packs", byDifficulty: "E:3  N:4–5  H:5–6" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "22_ash_slag_brute": {
        n: "22", name: "Slag Brute", realm: "ash",
        role: "brute", animRole: "brute", key: "slagBrute",
        mesh: "22_ash_slag_brute.glb", bytes: 322996,
        engineScale: 1.1603, sizeScale: 1.0, aabbHeightM: 1.58415, joints: 34,
        grip: "2H MAUL", weaponProp: "Slag hammer prop",
        element: "fire/phys", rangeBand: "Melee", mage: false,
        attackDoc: "slam 28 · backhand 22 · slag charge 26", attackPeakDmgDoc: 28,
        special: "Too heavy to fling; Vortex 50% slow only. Charge into Spike wall = self-stagger",
        pack: { mode: "solo+", note: "Widowmaker triad with assassin + mage", byDifficulty: "E:solo  N:1+mage  H:1+assassin+mage" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "25_ash_scorch_raider": {
        n: "25", name: "Scorch Raider", realm: "ash",
        role: "raider", animRole: "raider", key: "scorchRaider",
        mesh: "25_ash_scorch_raider.glb", bytes: 273612,
        engineScale: 0.9917, sizeScale: 1.0, aabbHeightM: 1.89863, joints: 28,
        grip: "1H AXE/SPEAR", weaponProp: "Hatchet / fire axe prop",
        element: "fire/phys", rangeBand: "Melee", mage: false,
        attackDoc: "combo 7×3 · ember flick 8 · cutting lunge 14", attackPeakDmgDoc: 14,
        special: "Slope-chaser: toboggan 17 m/s downslope — Ash anti-kite. Cast-on-the-move lesson",
        pack: { mode: "pack", note: "Slope Chase: 3 raiders + mage", byDifficulty: "E:2  N:3  H:3–4 + mage" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "26_ash_smoke_mage": {
        n: "26", name: "Smoke Mage", realm: "ash",
        role: "mage", animRole: "mage", key: "smokeMage",
        mesh: "26_ash_smoke_mage.glb", bytes: 285292,
        engineScale: 1.0089, sizeScale: 1.0, aabbHeightM: 1.86678, joints: 34,
        grip: "STAFF CAST", weaponProp: "Ember staff prop",
        element: "fire/dark", rangeBand: "Far", mage: true,
        attackDoc: "smolder bolt 12 · ash pall 5/s · ember lash 14", attackPeakDmgDoc: 14,
        special: "★ TRUE MAGE. Smoke-step escape (max ×2). Spike-stun interrupts step",
        pack: { mode: "pack", note: "In nearly every Ash pack (ranged slot)", byDifficulty: "E:1+imps  N:1+raiders  H:1+full triad" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "28_ash_cinder_sentinel": {
        n: "28", name: "Cinder Sentinel", realm: "ash",
        role: "sentinel", animRole: "sentinel", key: "cinderSentinel",
        mesh: "28_ash_cinder_sentinel.glb", bytes: 283408,
        engineScale: 0.9911, sizeScale: 1.0, aabbHeightM: 1.88411, joints: 34,
        grip: "1H+SHIELD", weaponProp: "Spear + tower shield prop",
        element: "fire/phys", rangeBand: "Melee", mage: false,
        attackDoc: "sweep 16 · advancing thrust 20 · crest bash 12", attackPeakDmgDoc: 20,
        special: "Beacon crest: 3 s ignition pings ash enemies 40 m. Fixed patrols; snipe 36–40 m",
        pack: { mode: "post", note: "Beacon Route: 1 + 2 raiders", byDifficulty: "E:solo patrol  N:1+2 raiders  H:1+mage+raiders" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "29_ash_soot_assassin": {
        n: "29", name: "Soot Assassin", realm: "ash",
        role: "assassin", animRole: "assassin", key: "sootAssassin",
        mesh: "29_ash_soot_assassin.glb", bytes: 253104,
        engineScale: 0.9805, sizeScale: 1.0, aabbHeightM: 1.89902, joints: 28,
        grip: "DUAL 1H", weaponProp: "Twin daggers prop",
        element: "fire/dark", rangeBand: "Melee", mage: false,
        attackDoc: "backstab 30 (3×) · flurry 6×4 · soot slip", attackPeakDmgDoc: 30,
        special: "Soot veil shimmer; punishes cast/carve commits. Fragile — 4 bolts once caught",
        pack: { mode: "solo+", note: "Widowmaker: 1 assassin + brute + mage", byDifficulty: "E:rare solo  N:1  H:1 + triad" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "53_v2_ash_soot_stalker": {
        n: "53", name: "Soot Stalker", realm: "ash",
        role: "stalker", animRole: "stalker", key: "sootStalker",
        mesh: "53_v2_ash_soot_stalker.glb", bytes: 256812,
        engineScale: 0.9905, sizeScale: 1.0, aabbHeightM: 1.89823, joints: 34,
        grip: "DUAL KNIVES", weaponProp: "Claws / short blades prop",
        element: "fire", rangeBand: "Melee", mage: false,
        attackDoc: "eruption pounce 18 · hooked rake 8×2 + Shredded", attackPeakDmgDoc: 18,
        special: "Ash-swimming mound; pairs alternate opposite pounces. Mini-Vortex counter",
        pack: { mode: "pair", note: "Pall Trap: 2 stalkers under mage cloud", byDifficulty: "E:1  N:2  H:2 + imps" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "60_v2_ash_scorch_warden": {
        n: "60", name: "Scorch Warden", realm: "ash",
        role: "warden", animRole: "warden", key: "scorchWarden",
        mesh: "60_v2_ash_scorch_warden.glb", bytes: 304772,
        engineScale: 1.1051, sizeScale: 1.0, aabbHeightM: 1.73598, joints: 52,
        grip: "2H GLAIVE", weaponProp: "Fire glaive / mace + chain prop",
        element: "fire", rangeBand: "Mid", mage: false,
        attackDoc: "mace slam 26 · chain drag · suppression stomp 16", attackPeakDmgDoc: 26,
        special: "Warding rune field 12 m: −30% spell dmg, vortex halved. Bolts from outside full",
        pack: { mode: "post", note: "Jailer Camp: warden + mage + imps", byDifficulty: "E:solo camp  N:1+mage  H:1+mage+imps" },
        bossKind: "none", bossName: null, bossKey: null, arenaHp: null, arenaStance: null,
    },
    "86_v3_ash_volcanic_plate_knight": {
        n: "86", name: "Volcanic Plate Knight", realm: "ash",
        role: "knight", animRole: "boss", key: "volcanicPlateKnight",
        mesh: "86_v3_ash_volcanic_plate_knight.glb", bytes: 290060,
        engineScale: 1.1827, sizeScale: 1.0, aabbHeightM: 1.49822, joints: 34,
        grip: "1H SWORD+SHIELD", weaponProp: "Magma sword / fists prop",
        element: "fire/phys", rangeBand: "Mid", mage: false,
        attackDoc: "seismic punch · magma sweep · basalt lob · scar burn", attackPeakDmgDoc: 28,
        special: "★ REALM BOSS / FINALE. Progressive Fracture 3-phase. Stance 300. Fixed L30",
        pack: { mode: "boss", note: "Arena finale only", byDifficulty: "Arena script only" },
        bossKind: "realm_boss", bossName: "Volcanic Plate Knight (finale)", bossKey: "volcanicPlateKnight", arenaHp: 3000, arenaStance: 300,
        // OVERRIDE 2: roster board L527 hyper=True; recon never diffed boss rows for this field
        hyperArmorFromRoster: true,
    },
    "88_v3_ash_furnace_guardian": {
        n: "88", name: "Furnace Guardian", realm: "ash",
        role: "guardian", animRole: "guardian", key: "furnaceGuardian",
        mesh: "88_v3_ash_furnace_guardian.glb", bytes: 302552,
        engineScale: 1.2867, sizeScale: 1.0, aabbHeightM: 1.55954, joints: 34,
        grip: "2H HAMMER", weaponProp: "Forge hammer prop",
        element: "fire", rangeBand: "Mid", mage: false,
        attackDoc: "furnace vent cone · slag spit 16 · stoke pulse · grate grapple", attackPeakDmgDoc: 16,
        special: "★ MINIBOSS. Core duel: douse grate 3 stages → 5 s stun + ×1.5 weak. Breath = cone not bullet",
        pack: { mode: "boss", note: "Forge-gate arena", byDifficulty: "Arena script only" },
        bossKind: "miniboss", bossName: "Furnace Guardian", bossKey: "furnaceGuardian", arenaHp: 2200, arenaStance: 260,
        // OVERRIDE 2: roster board L538 hyper=True; recon never diffed boss rows for this field
        hyperArmorFromRoster: true,
    },
};

/* ------------------------------------------------------------------ *
 * ROSTER — MESH row + its combatData row, merged at init
 * ------------------------------------------------------------------ */

/** combatData row by key, built once so the merge below is not O(n²). */
const ROW_BY_KEY = {};
for (let i = 0; i < ENEMIES.length; i++) ROW_BY_KEY[ENEMIES[i].key] = ENEMIES[i];

/**
 * Thirty mesh-backed units keyed by slug, in roster order (cold 10, sand 10,
 * ash 10). Combat fields are the combatData row's, renamed off its `*M`/`*Max`
 * suffixes into the flat names the roster board and the AI both use.
 *
 * @typedef {object} RosterUnit
 * @property {string}  slug         asset id; `assets/enemies/<slug>.glb`
 * @property {string}  combatKey    key into combatData.ENEMIES (never null — see OVERRIDE 1)
 * @property {number}  engineScale  apply verbatim; already includes sizeScale
 * @property {number}  tier         TIER.* id — feeds damageable.register() directly
 * @property {string}  tierName     TIER_TABLE[tier].name, for logs and tooling
 * @property {number}  burstSpeed   sprint OR submerged pursuit — read `burstIsSubmerged`
 * @property {boolean} burstIsSubmerged  true = the burst is a submerged dive, not a run
 * @property {boolean} telegraphAligned  false = telegraphMs[] is SHORTER than damages[];
 *                                  indexing telegraphMs by damage index is unsafe
 * @property {string[]} undamagedAttacks  attack names whose row damage is null
 */
export const ROSTER = {};

for (const slug in MESH) {
    const m = MESH[slug];
    const row = ROW_BY_KEY[m.key];
    if (!row) throw new Error("roster.js: no combatData row for " + slug + " key " + m.key);

    // Peak single hit off the row itself. The reconciliation's #16-#18 give this
    // field to combatData, but its #3-#5 give the SAME three boss rows to the
    // roster board because combatData leaves those attacks' damage null. Both
    // cannot be right, so neither number is invented here: `attackPeakDmg` is
    // strictly what combatData can pay out today, `attackPeakDmgDoc` is the
    // board's design peak, and `undamagedAttacks` names the gap between them.
    let peak = 0;
    const undamaged = [];
    for (let i = 0; i < row.damages.length; i++) {
        const d = row.damages[i];
        if (d.dmg == null) undamaged.push(d.name);
        else if (d.dmg > peak) peak = d.dmg;
    }

    ROSTER[slug] = {
        slug, n: m.n, name: m.name, realm: m.realm,
        role: m.role, animRole: m.animRole, combatKey: m.key,
        variantOf: m.variantOf || null,

        // ---- body (this file's own) ----
        mesh: m.mesh, bytes: m.bytes, joints: m.joints,
        engineScale: m.engineScale, sizeScale: m.sizeScale,
        aabbHeightM: m.aabbHeightM,
        grip: m.grip, weaponProp: m.weaponProp,

        // ---- combat numbers (combatData.ENEMIES, never transcribed) ----
        archetype: row.archetype,
        tier: row.tier, tierName: TIER_TABLE[row.tier].name, cost: row.cost,
        hp: row.hp, speed: row.speed,
        perception: row.perceptionM,
        attackRange: row.attackRangeM,
        gapCloser: row.gapCloserM == null ? 0 : row.gapCloserM,
        poise: row.poiseMax,
        carapace: row.carapaceHp == null ? null : row.carapaceHp,
        // combatData splits the two: `burstSpeed` is a sprint, `submergedSpeed` is
        // a dive the player cannot be hit out of except by Mini-Vortex. The roster
        // board flattened both into one "burst" column, which is how a stalker
        // reads as a sprinter. Kept flat for the AI, flagged so it can tell.
        burstSpeed: row.burstSpeed == null
            ? (row.submergedSpeed == null ? null : row.submergedSpeed)
            : row.burstSpeed,
        burstIsSubmerged: row.burstSpeed == null && row.submergedSpeed != null,
        leash: row.leashM == null ? null : row.leashM,   // null = engine default (40 m)
        hyperArmor: !!row.hyperArmor || !!m.hyperArmorFromRoster,
        construct: !!row.construct,
        telegraphMs: row.telegraphMs,
        telegraphAligned: row.telegraphMs.length === row.damages.length,
        attackPeakDmg: peak,
        undamagedAttacks: undamaged,

        // ---- doctrine / presentation (roster board) ----
        element: m.element, rangeBand: m.rangeBand, mage: m.mage,
        attackDoc: m.attackDoc, attackPeakDmgDoc: m.attackPeakDmgDoc,
        special: m.special, pack: m.pack,
        bossKind: m.bossKind, bossName: m.bossName, bossKey: m.bossKey,
        arenaHp: m.arenaHp, arenaStance: m.arenaStance,
    };
}

/* ------------------------------------------------------------------ *
 * Indexes — all built at init, all O(1) at call time
 * ------------------------------------------------------------------ */

/**
 * Slugs per realm in roster order, ten each. This is the download unit: the
 * pipeline's realm budget is 3.0 MiB and the three realms measure 2.961 / 2.731
 * / 2.748 MiB, so a loader that walks BY_REALM stays inside it and a loader that
 * walks ROSTER does not.
 */
export const BY_REALM = { cold: [], sand: [], ash: [] };
for (const slug in ROSTER) BY_REALM[ROSTER[slug].realm].push(slug);

/** slug -> combatData key. Thirty entries; no nulls. */
export const KEY_BY_SLUG = {};
for (const slug in ROSTER) KEY_BY_SLUG[slug] = ROSTER[slug].combatKey;

/* ------------------------------------------------------------------ *
 * MESH_REUSE — the six combatData rows with no body of their own
 * ------------------------------------------------------------------ */

/**
 * Thirty bodies, thirty-three rows. These six keys are spawnable in combat and
 * have nothing to render, and the roster board's own MISSING_MESH list
 * (_build_roster_html.py:549-556) names exactly these six. Five are cheap
 * dress-ups of a body that already exists; ONE IS A REAL HOLE — see
 * `scorpionHusk.meshGap`.
 *
 * `scale` multiplies the host's `engineScale` (which is already normalised, so
 * 1 = wear the body as-is). Only two scales are named by the reconciliation;
 * the other four are 1 because no source states otherwise, and inventing a
 * number for them would be exactly the failure this file exists to prevent.
 * `tint` is a token, not a colour: the material work is the renderer's call and
 * no source states a hex value.
 */
export const MESH_REUSE = {
    /** Hoarfrost Sprite (cold fodder) — 34_v2_cold_ice_cultist */
    hoarfrostSprite: {
        host: "34_v2_cold_ice_cultist", scale: 0.7, tint: "cyan-emissive",
        meshGap: false,
        why: "reuse the Ice Cultist mesh scaled ~0.7 with a cyan emissive tint - both are cold fodder/light casters (ROLE_KIT 'cultist' grip STAFF CAST); no new Meshy spend",
    },
    /** Moraine Colossus (cold elite) — 32_v2_cold_glacier_brute */
    moraineColossus: {
        host: "32_v2_cold_glacier_brute", scale: 1.9, tint: null,
        meshGap: false,
        why: "reuse Glacier Brute v2 at sizeScale ~1.9; A's MISSING_MESH marks Moraine 'Design park only - Sand gate is #61 Frost Golem / Shrinebreaker', so this is the cheap stand-in, not a new mesh",
    },
    /** Glass Revenant (cold light) — 39_v2_cold_blizzard_assassin */
    glassRevenant: {
        host: "39_v2_cold_blizzard_assassin", scale: 1, tint: "glass-refractive",
        meshGap: false,
        why: "reuse Blizzard Assassin mesh with a glass/refractive material swap - both are light cold skirmishers with 1H silhouettes",
    },
    /** Scour Scout (sand medium) — 65_v3_cold_rime_skier_raider */
    scourScout: {
        host: "65_v3_cold_rime_skier_raider", scale: 1, tint: "sand-palette",
        meshGap: false,
        why: "the skier raider IS a 'raider' ROLE_KIT unit with slide/spear kit; retexture to sand palette. A's PACKS 'Watch Post' needs 2 Scouts",
    },
    /** Hourglass Automaton (sand heavy) — 75_v3_sand_bleached_bone_knight */
    hourglassAutomaton: {
        host: "75_v3_sand_bleached_bone_knight", scale: 1, tint: "sand-brass",
        meshGap: false,
        // The reconciliation asks for the golem kit here, but the host body is
        // animRole 'knight' and the clip stage retargets per body — golem slots
        // would not exist on 75. Use the host's kit until the pipeline is told
        // to emit a second kit for this body.
        rosterSuggestedAnimRole: "golem",
        why: "A's own meshNote on 75 says 'can stand in for Hourglass Automaton post if needed'; reuse it with a sand/brass material and the golem ROLE_KIT",
    },
    /** Scorpion Husk (sand light) — 73_v3_sand_mummy */
    scorpionHusk: {
        host: "73_v3_sand_mummy", scale: 1, tint: null,
        // The one genuine mesh gap in the roster. The board locks #73 as a
        // MUMMY, not a scorpion (_build_roster_html.py:553 'separate from #73
        // mummy'), and no quadruped or arthropod body exists among the thirty.
        // A mummy buried in sand reads as the same ambush, but it is a
        // SUBSTITUTION, not a match — flagged so it stays a visible decision.
        meshGap: true,
        why: "MESH GAP - A explicitly locks #73 as MUMMY, not scorpion ('#73 IS MUMMY (user lock) - not scorpion'). No quadruped/arthropod mesh exists in the 30. Recommend: retire scorpionHusk's buried-ambush role onto 73_v3_sand_mummy (a buried mummy reads the same) OR budget one new Meshy generation",
    },
};

/**
 * combatData key -> the body that renders it. Thirty-three entries: the
 * twenty-seven bodies plus the six reuse hosts, so every spawnable key resolves.
 * Records are built once here; `bodyForKey()` only indexes, it never allocates.
 * Where two bodies share a key (rimeImp, glacierBrute, dustStalker each have a
 * base and a v2 re-skin) the FIRST in roster order wins — the v2 is reachable
 * through ROSTER and carries `variantOf` back to its base.
 */
export const BODY_BY_KEY = {};
for (const slug in ROSTER) {
    const k = ROSTER[slug].combatKey;
    if (!BODY_BY_KEY[k]) {
        BODY_BY_KEY[k] = { slug, scale: 1, tint: null, reuse: false, meshGap: false };
    }
}
for (const k in MESH_REUSE) {
    const r = MESH_REUSE[k];
    BODY_BY_KEY[k] = {
        slug: r.host, scale: r.scale, tint: r.tint, reuse: true, meshGap: r.meshGap,
    };
}

/** combatData key -> slug of the body that renders it (reuse hosts included). */
export const SLUG_BY_KEY = {};
for (const k in BODY_BY_KEY) SLUG_BY_KEY[k] = BODY_BY_KEY[k].slug;

/* ------------------------------------------------------------------ *
 * Helpers — index-only, zero allocation
 * ------------------------------------------------------------------ */

/**
 * Ordered clip slots for a body. The returned array is the shared ROLE_KIT one:
 * read it, never push to it.
 * @param {string} slug
 * @returns {string[]|null} null if the slug is not in the roster
 */
export function clipSlotsFor(slug) {
    const u = ROSTER[slug];
    return u ? ROLE_KIT[u.animRole] : null;
}

/**
 * Uniform scale to apply to a loaded body. Already folds the roster's size
 * intent — do NOT also multiply by `sizeScale`.
 * @param {string} slug
 * @returns {number} 1 if the slug is unknown, so a miss renders at native size
 *   rather than collapsing the mesh to a point
 */
export function engineScaleFor(slug) {
    const u = ROSTER[slug];
    return u ? u.engineScale : 1;
}

/**
 * Which body renders a combatData key, and how it must be dressed.
 * @param {string} key combatData.ENEMIES[].key
 * @returns {{slug:string, scale:number, tint:string|null, reuse:boolean,
 *   meshGap:boolean}|null} prebuilt record — do not mutate
 */
export function bodyForKey(key) {
    return BODY_BY_KEY[key] || null;
}

/* ------------------------------------------------------------------ *
 * Self-check — the invariants this file exists to hold
 * ------------------------------------------------------------------ */

/**
 * Re-asserts at init what the generator asserted at authoring time. Cheap
 * (thirty iterations, no allocation beyond the error path) and it fails loudly:
 * a body added to manifest.json without a roster entry, or a ROLE_KIT list that
 * drifts from the clip slots the pipeline emits, is a black enemy or a missing
 * animation at runtime — a thrown module is a much shorter debug.
 *
 * `manifest` is the parsed assets/enemies/manifest.json. Callers that already
 * fetch the manifest should pass it; there is no fetch in here, because this
 * module must stay importable by tools and tests with no network.
 *
 * @param {object} [manifest] parsed manifest.json, if available
 * @returns {string[]} problems found; empty array means clean
 */
export function selfCheck(manifest) {
    const bad = [];
    const slugs = Object.keys(ROSTER);
    if (slugs.length !== 30) bad.push("ROSTER has " + slugs.length + " units, expected 30");
    for (const r in BY_REALM) {
        if (BY_REALM[r].length !== 10) {
            bad.push("BY_REALM." + r + " has " + BY_REALM[r].length + ", expected 10");
        }
    }
    for (const slug of slugs) {
        const u = ROSTER[slug];
        if (!ROLE_KIT[u.animRole]) bad.push(slug + ": animRole " + u.animRole + " not in ROLE_KIT");
        if (!ROW_BY_KEY[u.combatKey]) bad.push(slug + ": combatKey " + u.combatKey + " has no row");
        if (!(u.engineScale > 0)) bad.push(slug + ": engineScale " + u.engineScale);
    }
    for (const k in MESH_REUSE) {
        if (!ROSTER[MESH_REUSE[k].host]) bad.push("MESH_REUSE." + k + ": host is not a roster slug");
        if (ROW_BY_KEY[k] === undefined) bad.push("MESH_REUSE." + k + ": no combatData row");
    }
    if (manifest && manifest.enemies) {
        for (const slug of slugs) {
            const e = manifest.enemies[slug];
            if (!e) { bad.push(slug + ": absent from manifest"); continue; }
            const want = ROLE_KIT[ROSTER[slug].animRole];
            const got = e.clipSlots || [];
            if (want.length !== got.length || want.some((s, i) => s !== got[i])) {
                bad.push(slug + ": ROLE_KIT." + ROSTER[slug].animRole + " != manifest clipSlots");
            }
            if (e.engineScale !== ROSTER[slug].engineScale) {
                bad.push(slug + ": engineScale drifted from manifest");
            }
        }
    }
    return bad;
}

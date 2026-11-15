# Shroud of the Ancients — Act 1: The Shattered Seal

## Premise

The realm of **Valdris** was once one whole world. Long ago, an order called the
Ancients raised the **Sacred Veil** — a planar membrane that separated their
lush living homeland from a shadow-reflection of itself. They sealed the
Shadow side, the **Obsidian Wastes**, behind seven crystal-shard locks
seeded across the world, and went on with peace.

Centuries later, the Veil is **shattering**. Five of the seven seals already
slip; black wisps bleed through. The Ancients are dead. Only their relics —
the seven shards, when reunited — can mend it.

Kaelen, a hooded relic-seeker drawn to the Veil's resonance, finds the
first shard fragment — the **Astral Shard** — at the foot of a fallen
shrine outside the village of Canopy. The Shard glows in his hand. He
hears the Veil whisper.

## Act 1: "The Shattered Seal"

**Setting**: the **Verdant Cradle** — a lush jungle realm where overgrown
ancient ruins hint at the fallen order. Kaelen arrives at sunrise.

**Goal**: retrieve the **First Relic** from the **Ruins of First Light**
sanctuary deep below the Cradle. The Relic is guarded by the **Guardian of
First Light**, a stone golem the Ancients left to test those who would
take up the burden of restoration.

### Story beats (in play order)

1. **Arrival at Canopy Village** — Kaelen wakes at the village square.
   Tutorial overlay teaches movement. A glowing yellow figure (Elder Mira)
   stands at the center.

2. **Elder Mira's charge** — Mira tells Kaelen the seal under the Ruins
   weakens. The villagers cannot enter; the Veil pushes them back. Only
   one who already bears a shard fragment can pass. She points south to
   the **Emerald Thicket**.
   - Quest state: `talk_to_mira` → `enter_thicket`
   - Tutorial advances: step 1 → step 2 ("press DOWN to head south")

3. **The Emerald Thicket** — winding jungle paths. The first **Thornback
   Lurker** ambushes from a thorn cluster. Tutorial advances to step 3
   ("press Z to swing your sword"). Kaelen defeats it and finds his
   first **bioluminescent flower** at the edge of the clearing — a
   side-quest item for Heda back in the village.

4. **The Waterfall Hollow** — a side path behind a curtain of mist. The
   scholar **Liora** waits here, expecting Kaelen. (Mira sent word.) She
   gives him the **Stormcrest Bow** so he can reach the Wraithwhispers
   in the ruins below. Quest state: `has_bow=true`.

5. **The Cave System** *(optional)* — a hidden entrance past the
   waterfall. Inside: glowing blue crystals, the **Crystalspine Boar**
   mini-boss, and the **second First-Light shard**. Reward: bomb refill
   + a Heart Piece.

6. **The Thicket fork** — three more bioluminescent flowers among the
   foliage. (The third flower is hidden by `thicket_c`'s upper-right
   tree cluster.) Heda's side quest can be completed by returning to
   her hut with all three.

7. **Ruins entrance** — the door arch stands at the south of the
   Thicket. Kaelen passes through; the Shard pulses brighter, the air
   chills.

8. **Ruins Foyer** — a 3-way fork. The north door is locked (small
   key). East and west open. Lock-until-cleared: Veilstalkers fall on
   Kaelen from the shadows; he must defeat them before any door opens.

9. **East branch** — Kaelen finds the **small key** behind a cluster of
   Wraithwhispers and a Veilstalker. Push-block puzzle in east_b yields
   a rupee chest. East_c (bonus) holds the **Dungeon Map**.

10. **West branch** — the **Geomancer Statue** mini-boss guards the
    way. Its slam shockwave hits hard. Defeating it drops Kaelen's
    **Bombs**. West_c (bonus) holds the **Dungeon Compass**.

11. **North-corridor sequence** — back through the foyer (key consumed)
    into the locked north chamber. Four ancient statues watch the room.
    Kaelen must strike each one with his sword until each faces center;
    only then does the next door open.

12. **The Mid Corridor** — a 7-enemy gauntlet (Veilstalkers,
    Wraithwhispers, a Thornback ambush). Lock-until-cleared.

13. **The Trap Room** — spike rows flank a narrow safe corridor. A
    **Mudborn Shambler** lumbers in the middle; killing it splits it
    into two **Pups**. **Echo Knights** patrol the edges (sword-immune
    — Kaelen must rely on bow and bombs). Lock-until-cleared.

14. **Big Key Chamber** — six enemies (Veilstalkers + Wraithwhispers)
    pour out when Kaelen enters. Their defeat reveals the **Big Key** and
    a bomb refill chest. Lock-until-cleared.

15. **The Big Door** — opens to the boss room. The Shard burns hot at
    Kaelen's belt.

16. **The Guardian of First Light** — a massive stone golem with glowing
    teal eyes and gold rune cracks across its body. Two phases:
    - **Phase 1**: chase + 3.5-second slam-shockwave. Sword-vulnerable.
    - **Phase 2** (after Phase 1 HP depletes): the Guardian's body
      flares gold, becoming sword-immune. Only bombs and bow shafts
      damage it now. It moves faster, fires a 4-projectile cardinal
      burst every 4 seconds. The shockwave is wider. Survive its bursts;
      strike between them with bow + bombs.

17. **Victory** — the Guardian's eyes dim. The First Relic — a brilliant
    teal crystal — rises from the stone floor. Kaelen takes it. Dawn
    light breaks through the ceiling above. The Shard at his belt and
    the Relic in his hand resonate; he hears the Veil mend, briefly.
    Six relics remain.

## Characters

- **Kaelen** *(the Relic Seeker — the player)*. Hooded, asymmetric cloak:
  emerald-green / gold-trim on the left, obsidian-black / silver-trim on
  the right. The Astral Shard glows at his belt. He says little; the Shard
  speaks for him.
- **Elder Mira** *(quest-giver)*. Wise, silver-haired, gold-and-cream robes,
  walks with a staff. She read the Ancients' inscriptions when she was
  young. She knows what the Veil's failure means.
- **Heda the Herbalist** *(side quest)*. Brown ponytail, green apron, smells
  of cyan flowers. She trades a Heart Piece for three bioluminescent flowers.
- **Dax the Trader** *(merchant)*. Bearded, purple cloak, money pouch at
  shoulder. Sells trinkets — and warnings. (Shop UI is not yet wired in
  Act 1; he's atmospheric until Act 2.)
- **Liora the Scholar** *(ally)*. Young, brown ponytail, glasses, blue robes
  with gold embroidery. Always reading. Knows the Wraithwhispers are afraid
  of bowfire. Gives Kaelen the Stormcrest Bow.
- **The Guardian of First Light** *(boss)*. A stone golem of the Ancients'
  making. Not evil — a test left behind. Glowing teal eyes. Speaks once,
  in low rune-words, before the fight begins.

## Antagonist (seen but not fought in Act 1)

- **The Shrouded King** *(end-of-game antagonist; foreshadowed in Act 1)*.
  A figure half-consumed by living shadow, glowing white void-eyes, tattered
  royal black robes, obsidian-shard crown. He was once an Ancient. He **wants**
  the Veil to fail. Hinted at in Mira's dialogue and a single moment after the
  Guardian boss when his portrait flashes during the Win-fade.

## Tutorial flow (LIVE in code as `quest.tutorial_step`)

| Step | Prompt | Advance trigger |
|---|---|---|
| 0 | "Use ARROW KEYS or WASD to move." | first non-zero player velocity |
| 1 | "Walk up to Elder Mira and press C to talk." | Mira intro dialogue closes |
| 2 | "Press DOWN to head south through the door to the Thicket." | entering an `emerald_thicket` zone |
| 3 | "Press Z to swing your sword. Try defeating an enemy." | first Z keypress |
| 4 | "Press X to use your selected item, C to cycle." | first X keypress |
| 5 | (no overlay) | — |

A floating **`[C] TALK`** prompt appears above any NPC the player walks
within 18 px of.

## Music (already wired per zone)

- Canopy Village → calm theme
- Emerald Thicket / Shrine Path → adventurous overworld
- Ruins of First Light → tense dungeon
- Boss Arena (Guardian) → boss track
- Win screen → triumphant victory cue
- Game Over → mournful low-strings

## Items obtained in Act 1

| Item | Source | Purpose |
|---|---|---|
| Astral Shard | already on Kaelen at scene start | Story; pulses near seals |
| Stormcrest Bow | Liora dialogue, thicket_waterfall | Required for Wraithwhispers + boss phase 2 |
| Bombs | Geomancer Statue miniboss drop | Required for weak walls + boss phase 2 |
| Dungeon Map | ruins_east_c chest | Minimap shows unvisited rooms |
| Dungeon Compass | ruins_west_c chest | Minimap red-dots uncollected items |
| 4 Heart Pieces | shrine_path_c, thicket_waterfall, cave_treasure, shrine_relic | Together: +1 max heart |
| 1 Heart Piece (Heda quest) | flower side quest reward | Same |
| Heart Container | Guardian boss reward | +1 max heart |
| Small Keys (1) | ruins_east_a chest | Consumed by foyer N door |
| Big Key | ruins_big_key_room | Opens boss door (not consumed) |
| Bomb refills | ruins_east_b chest, big_key_room, cave_treasure | +3 bombs each |

## End-of-Act state

After Win screen:
- `quest.main_quest = "act1_complete"`
- `flags.first_relic = true`
- save deleted (Act 1 cleared; player can replay or start Act 2 when shipped)
- Elder Mira's dialogue switches to her `after_dungeon` line

## Pass 3 (Act 2) seed

The Astral Shard and First Relic resonate after the boss. As Kaelen
returns to the village, the Shard pulls north — the next seal weakens.
Act 2: **Echoes in the Dark**, the **Crystal Depths**, the **Prismarch**.

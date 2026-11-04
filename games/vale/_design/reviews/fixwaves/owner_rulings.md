# Rulings for the parity fix waves

2026-10-28. The owner delegated these calls to the lead developer: "you decide on what is best and industry standard". Each ruling is final unless the owner overrides it. Fix-wave verifiers treat this page as the owner's recorded ruling.

The common standard is how broad-audience team games (teen-rated MOBAs and hero brawlers) handle character and systems design:
- Faces and masks read as alive and readable from the gameplay camera, never as horror.
- Skins change material and palette but not silhouette or accent placement.
- Genre conventions are shared by every MOBA. Rules, names, numbers and presentation are each game's own.

## 1. Longshade: the sundial plate replaces the ink tears (approved)

**Ruling:** keep W5a's change. The ink tear streaks are removed. The chalk plate reads as a sundial with a brass hour-line inlay, and Longshade keeps its lamp eyes.

**Why:**
- Tear-streaked masks are a stock horror trope, so they break the standing rule against masks or faces that read as horror.
- The hour-line motif comes from VALE's own world (the stopped dial, WORLD.md).
- Longshade is a monster, not a Wick. Lamp eyes on a creature are fine; the no-face rule is for Wicks only.

## 2. Odrum Shadeprint: a warm amber lacquer mask (approved)

**Ruling:** keep W5b's change. The mask is warm amber lacquer `#B39272` with honey-amber inlays in the eye slits. This is now written into `_design/fighters/odrum.md` under Shadeprint.

**Why:**
- A grey mask with hollow eye slits reads blank or menacing at portrait size.
- Lit, warm eye inlays keep the face alive.
- The skin keeps its silhouette and ink cloth. Only the material changes, which is the standard for skins.

## 3. Rishal: accent on the visor ridge and temple fins (approved)

**Ruling:** Rishal's accent is the narrow ridge blade on the visor's top edge plus the two swept fins off the left temple. The rear vanes are removed and nothing glows on the crest. The fins are accent on every skin, and skins never recolour them. This is recorded in `_design/fighters/rishal.md` §7 and §9.

**Measured:** three_qa accent is 2.28–2.29 %, all of it in the top half, for the base and both skins.

**Why:**
- A fighter's signature light belongs on the head or weapon, where the high three-quarter gameplay camera always sees it.
- Rear-mounted emissive slabs read as noise and can be hidden by the body.
- Fixed accent locations across skins are what keep a fighter identifiable in a fight.

## 4. W4 systems re-key: approved (`W4_systems_rekey.md`)

**Ruling:** the re-key is signed off as the systems direction.

**What stays:** genre archetypes are kept. Every MOBA has them: a blink, a heal or shield, wards, boots, potions, starters, camp buffs and an item cap. Dota 2, SMITE, Heroes of the Storm and Pokémon UNITE all ship their own versions, so keeping them is not copying.

**What changed:** each system now has a VALE rule from the world of the stopped dial:
- the shadow left by Glint Step;
- the Saplight pool you have to stand in;
- starters that fold into your first core;
- the dial-slot rule in place of a one-apex cap;
- side-bound camp buffs.

Its own names, numbers and presentation complete it.

**Conditions:**
- `_harness/probe_sim_rekey.ts` stays in the probe suite as a gate. No headline number may come within 10 % of its gauge counterpart, and no rule may map one to one.
- Later balance tuning can move numbers only within that gate.
- Rows W4 adds after this date fall under the same gate. They need no further sign-off unless the gate fails.

## 5. Two more sensitivity calls made in the same pass

**Dunsom:** the small gold beaked mask reads like a plague-doctor mask in painted close-ups. Ruling: shorten and round the beak. It becomes a short rounded bill, no longer than the mask's eye-to-chin height, so it no longer reads as a plague-doctor beak at portrait or splash size. The change goes to character art (W5b or the integration pass). Afterwards, Dunsom can return to the painted cards.

**Hooded Lamp ward:** replace the pointed finial with a rounded knob. A plain rounded dome keeps the single blue lamp core with no eye-like pair, which follows the no-pointed-hoods rule. The change goes to unit art (W5a or the integration pass).

## 6. Greatwick back lantern: slits, never a pair of panes (lead, by delegation, 2026-11-03)

**Problem:** the closing review flagged the Greatwick back lantern as a blocker, because its two round lit panes read as a pair of eyes.

**Ruling:** the lantern lights through narrow slits behind thick mullions, and never through two equal round panes.
- Aubade has 3 slits.
- Serenade has a ring of 12 slit cores.

This follows the no-eyes-on-faceless-units rule (Wicks have no face).

**Evidence:** `probe_wick_sweep` r4 finds 0 `greatwickPairs` on both the sweep frames and the lane frames (`_harness/_reports/fw_CW4_r4_wick_sweep.json`).

## 7. Crown rule for soft head coverings (2026-10-29, after the closing review)

**Ruling:** one roster-wide threshold replaces case-by-case calls on hoods.

**Scope:** a cloth hood, cowl, wrap or soft cap whose top is the highest point of the head. This covers fighters, every skin, Wicks, wards and monsters. Hard parts (helmet ridges, visor blades such as Rishal's ruling-3 accent, metal crowns, finials, hat brims) are not soft head coverings. They need only the visual check below.

**Measure:** the crown fit radius at 3 cm under the top must be **at least 10 cm**. Use `_harness/_reports/closing_vashil_tools/geo2.mjs`, which computes R = ((min(width, depth) / 2)² + d²) / (2d) on the body mesh, as in `closing_critic_crown_radius.txt`.

**Visual check:** from behind and three-quarter-behind at the 28.5 m gameplay camera, the head must not read as a peaked or pointed hood on any skin. A pale covering over a pale robe needs a dark break so the crown reads as a rounded shape.

**Applies now:**

| Fighter | R at 3 cm | Status |
|---|---|---|
| Vashil (all skins) | 7.0 cm | Fails. CW5 rounds the cowl; wave target ≥ 12 cm tip radius and ≥ 19 cm wide 5 cm under the top. |
| Kemdo (all skins) | 8.1 cm | Fails. CW5 rounds the hood crown. |
| Ulkro (all skins) | 7.0 cm | Fails. CW5 rounds the hood crown. |
| Odrum (felt cap, all skins) | 5.0 cm | Fails if the cap is soft felt. CW6 rounds it, together with odrum-M2 (cap reads as scalp). |

Marund Long Evening and Rishal measure sharp tops, but those are hard parts (hat finial, ridge blade). They take the visual check only.

**Why:** "No tall, pointed or conical hoods" is a standing sensitivity rule. A number makes it checkable in a gate instead of a matter of taste. 10 cm at 3 cm is blunter than every hood the closing critic flagged and sharper than the rounded caps already accepted (Lisvel 11.9, Nurrow 11.3, Burdam 13.8, Dunsom 17.7).

## 8. Par bar is 7.5 (owner, 2026-10-29)

**Owner's words:** "A grade of 7.5 is good as well."

**Ruling:** a dimension or fighter is **ON PAR** at a verified score of **7.5 or more** with **no blocker open**.

- A **blocker** (sensitivity, broken or crash class) must be fixed at any score.
- A **major** on a dimension or fighter that already scores 7.5 or more no longer blocks par. It moves to the polish backlog.
- Waves and verifiers re-score fighters against 7.5, not 8.

**Status under this bar at the closing review (2026-10-29):**

| | Areas |
|---|---|
| On par | HUD 8.0, Originality 7.8, Combat 7.5, Maps 7.5, Menus 7.5 |
| Below par | Performance 7.0, Audio 6.5, Gameplay 6.0, all 16 fighters (5.5-6.5) |
| Open blockers | Vashil's cowl (CW5), the Greatwick lantern (CW4) |
| Not yet scored | Neutral monsters (CW4), the camera and input feel (CW1) |

## 9. Voice stays scoped out (lead, by delegation, 2026-11-03)

**Question (AUD-C2):** should VALE add fighter voice lines and a spoken announcer? CONTRACT §11 scopes voice out, and the closing review called it the largest audio difference a LoL player still hears.

**Ruling:** voice stays out for this release.
- CONTRACT §11 forbids imported or library samples, and the studio has no voice cast. Synthesized speech would sound worse than no speech, which is not the industry standard for a shipped game.
- The standard alternative is what VALE already has: a tonal announcer with on-screen text, plus each fighter's non-verbal call (`f_<id>_call`).
- AUD-C2 is an accepted scope gap. It does **not** count against the Audio score at the par bar (ruling 8). Reviewers grade audio on what is in scope.
- Revisit it if the owner funds a voice cast.

## 10. Ult first-beat core where the tint clips (lead, by delegation, 2026-11-03)

**Problem:** CW1 found that a ×2.3 core on warm ground forces the core to near-white. That breaks the victim-box white gate: luma above 225 with chroma under 30.

**Ruling:** keep the tint and the victim's readability.
- When the lifted ground reaches the post-grade luma clip (about 218), the core target drops to **×2.0**. Everywhere else it stays ×2.3.
- There is no near-white allowance. Industry practice is that the target under an effect must stay readable, and a white-out also hurts players with photosensitivity.

## 11. Compact builds and the on-screen height gauge (lead, by delegation, 2026-11-03)

**Rule:** the 105-130 px height gauge (measured at 28.5 m and 1080p) applies to standard builds.
- **Compact builds** (anchor 1.6 m: Sukri, and any fighter whose sheet says compact) may sit at **85-105 px**, if their selection ring, health bar and silhouette still pass the readability probes. Small-bodied fighters are an established MOBA archetype.
- **Fighters not marked compact** (Ilsheta, Lisvel, Nurrow base, Rishal, Odrum) must reach 105 px through `art.scale`.
- Marund Long Evening at 130.4 px counts as inside the gauge. Rounding 0.4 px is not worth a rebuild.

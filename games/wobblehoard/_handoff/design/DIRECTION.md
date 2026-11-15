# PLAYGROUND: the orchestrator's direction for the design panel (2026-11-15)

This page is the input to the design panel. It holds the owner's request in their words, the decisions the orchestrator has already
taken (do not reopen them without a strong, written reason), the hard constraints, the open questions the designers must answer, and
the outputs the panel must produce. The final specs are written by the synthesizer into `_spec/`.

## 1. The owner's request (verbatim, 2026-11-15)

> You are the orchestrator of the advancement of this project. Use opus agents and choose necessary model strength (medium vs extra vs
> max) depending on the task. Create environments we can put squshies into - ex. The beach, a snowy mountain, a forest log cabin.
> Create things within each environment squshies can interact with in their own way. Allow multiple squshies to be placed on the screen
> at the same time, and they can interact with each other in cute ways, emoji, little sounds they can make like communicating. Also when
> a squishy is cut into pieces, those pieces should be able to perform similar interactions without too much feedback if there's alot of
> characters. Get this to be a real playable game with goals, "quests", or something that will give playing it a purpose.

Five asks, each of which must be visibly true in the finished game:
1. **Places.** Environments to put squishies into: at least the beach, a snowy mountain and a forest log cabin (plus today's felt mat as "Home").
2. **Things to interact with.** Each place has its own interactable things, and squishies interact with them **in their own way**.
3. **Several squishies at once, being social.** They interact with each other in cute ways: emotes ("emoji"), little sounds like communicating.
4. **Pieces too, without noise.** Cut pieces do similar interactions, and the feedback stays calm when there are many characters.
5. **A real game with purpose.** Goals, quests, or something else that gives playing a purpose.

## 1b. OWNER CLARIFICATION (2026-11-15, after the panel started): the three places were EXAMPLES, not the list

> I gave you SOME examples of environments and didn't want to limit you to them. I expect more than just what I suggested.

This overrides every "at least the beach, a snowy mountain and a forest log cabin" below. What it means for the design:
- **A world of places, not three.** The final design must have **at least 8 places beyond Home**, invented by us and clearly different
  from each other in ground, zones, things, weather, light, sound and what squishies do there. The owner's three are in, and they are
  the minority. Think widely: for example a rain-soaked garden with puddles and leaves, a bath or bubble pool, a kitchen counter
  (dough, flour, a warm oven door), a moonlit rooftop or night sky with wind, a cave with crystals and echoes, a meadow with wind and
  dandelions, a pond with lily pads, a playground or toy room, a desert dune, a cloud top, a music room, an aquarium floor, a
  lantern-lit night market of objects (no characters), a workshop bench with magnets and springs. These are prompts, not a list to copy:
  pick and invent the set that gives the most different play.
- **Places must be cheap to add.** The data model (D5) is the point: a new place is mostly data (ground, zones, a set of things built
  from a shared library of prop mechanisms, palette, ambience recipe, reaction rules) plus a small lazy scene module. The design must show
  the shared mechanism library (about 12 to 16 mechanisms that all the things are built from) and what a ninth or tenth place costs.
- **More than the examples in every other ask too.** More things per place where they earn their keep, a richer set of social
  interactions, and a Journal with a chapter per place plus cross-place quests. Surprise the owner; do not stop at what was named.
- **Slices change.** S1 is still one complete new place with life, social play, pieces and the first Journal chapter. S2 adds the next
  three places; S3 the remaining four or more. The unlock order spreads them over weeks of play.
- A proposal or judgement written before this note that designs only three places is incomplete on this point: the synthesizer must
  extend it to the full set, in the same quality (names, ground, zones, things, family reactions, quests, budgets).

## 2. What exists today (read the code and the maps in `_handoff/maps/` for the details)

- A 3D soft-body squishy toy (custom XPBD, 50 species in 6 rarity tiers, 12 material families with distinct feel), procedural audio
  with a generative music bed, a Three.js stage with ceremonies. Play pays "squish points" into a meter (holds and stretches pay, taps
  are free play); a full meter drops a capsule; capsules give squishies; two of a kind merge; a Hoard gallery; daily tasks and restock.
- Tools: Hand (poke, squish, stretch, Shift two-sided pull), pick up and toss, Cut and reconnect (pieces are real soft bodies), Snap
  (photo), a play mat that holds up to 3 / 4 / 5 squishies (low / med / high quality) with body-to-body contact and bump events.
- Squishies have eyes only (no mouth, no limbs: an art-direction rule). Eyes already follow the pointer, widen and squint.
- The physics has ceremony drivers (`setFold`, `moveTo`, `tremble`, `burstOpen`), `nudge`, float mode, material families with tack,
  slosh, plastic memory, air bleed.
- Queued before this request and still wanted afterwards (do not design them away): the UI overhaul (`_spec/UI.md`), LOCK and
  multi-pull (`_spec/LOCK.md`), Stamp and Roll tools (`_spec/FUN.md`), trading (`_spec/TRADE.md`, needs a server), ffgames portal work.

## 3. Decisions already taken by the orchestrator

| # | Decision | Why |
|---|---|---|
| D1 | **Squishies become a little bit alive.** A new pure-logic lane, LIFE (`src/life/**`, no DOM, no three, deterministic, injected clock and random source), gives every character on screen a small brain: a personality from its genome, needs or moods, perception of nearby squishies and things, and a few behaviours. Its only outputs are intents (hop, lean, look, emote, speak, use a thing) that the shell applies through the physics and the stage. The player stays the main actor: any touch overrides the brain at once. | Asks 2, 3, 4 |
| D2 | **Emotes are our own drawn icon set ("squishmoji"), not system emoji.** Small vector icons drawn procedurally in our style (heart, music note, sparkle, question mark, zzz, sun, snowflake, flame, droplet, shell, leaf and so on), shown in small bubbles above a squishy. | System emoji differ per device, can be missing in headless tests, and are not our art. The owner's word "emoji" is honoured by the idea, not the font. |
| D3 | **Voices are synthesised.** Each species gets a small procedural voice (chirps, coos, purrs, hums) whose pitch follows its size and whose timbre follows its material family; squishies answer each other; several can fall into harmony with the music's key. No samples, no speech, no words. | The zero-assets rule; originality. |
| D4 | **One attention budget for feedback.** Emote bubbles, voices, haptics and effect particles from autonomous behaviour all draw on one global budget, with priorities (touched by the player, then whole squishies, then pieces; near the middle of the frame first) and hard caps per second and at once. Pieces use a smaller repertoire, quieter and higher voices, and many pieces doing the same thing share one bubble and one sound. Calm effects lowers every cap further. | Ask 4 |
| D5 | **Places are data plus lazy code.** One pure data module describes each place (ground behaviour, zones such as water, warmth and cold, the things in it and where, palette, ambience, how each material family reacts). Physics, render, audio, LIFE and quests all read the same definitions. Each place's render and audio code loads only when the place is first opened. | One source of truth; keeps the first load small. |
| D6 | **Things are simple physical props, not more soft bodies.** Static and simple dynamic colliders (ball, seesaw, slide or slope, swing, springy cap, floating things), zones (water with buoyancy and drag, warm, cold, wind) and a ground model per place (grip, softness, slipperiness). Soft bodies collide with them both ways where the prop moves. | Performance and robustness: a whole soft body already costs about 1.7 to 2.3 ms a frame. |
| D7 | **Bodies must be able to sleep, and background bodies may run lighter.** A resting, untouched body with resting neighbours costs almost nothing; a body the player is not touching may run on a lighter mesh on low and medium quality. The designers set the character caps from measured costs. | 5 whole bodies with contact cost about 10 ms a frame today. |
| D8 | **Purpose comes from caring and discovering, not from a currency.** No new currency, no timers that punish, no fail states, no paywall, no ads. Progress is a Journal (quests in chapters, one chapter per place), discoveries about each species (what it loves, how it reacts, who its friends are), friendship, keepsakes and unlocks. Any capsule or squish-point reward must be bounded so the measured pace (a capsule per 3 to 4 minutes of active play, MERGE_COST 2) still holds; one-time rewards are preferred. | Product rules; the tested economy. |
| D9 | **The size gate is re-specified for this feature.** Today every build fails over 1229 KB in total (about 1139 KB used). New budget: the first load (entry page plus everything it needs before play) stays at or under 1300 KB; the whole build may grow to 2000 KB; each place loads lazily. The designers may tighten these numbers but must keep the first load small. | A large feature cannot fit in 90 KB; players should still start fast. |
| D10 | **Everything stays original and procedural.** No copied characters, names, layouts or sounds; no textures, models, fonts or samples from anywhere. Squishies keep their eyes-only faces. No new animal or human characters are added to the places (things are objects, plants and weather). | The original brief; `_spec/REFERENCES.md`. |
| D11 | **Accessibility and calm.** Everything works with keyboard only, with reduced motion and Calm effects, at 320 CSS px, and with sound off (emotes carry the meaning that voices carry). No flashing (the existing flash gate holds). | The existing bar (`_spec/DESIGN.md` 6.6, `_spec/UI.md`). |
| D12 | **New lanes and ownership.** LIFE: `src/life/**`. WORLD data: `src/data/places.ts`, `src/data/life.ts`, `src/data/quests.ts` (content). QUESTS logic: `src/core/quests.ts`, journal state in `src/collection/**`. Physics props, zones, ground, hop and sleep: `src/physics/**`. Places, props, emote bubbles and looks: `src/render/**`. Ambience, voices, prop sounds: `src/audio/**`. Travel, party, hosts for LIFE and quests, and all new screens: `src/shell/**`, `src/ui/**`. All seams go through `src/contracts.ts`, additive and optional. | The lane model that has worked so far. |

## 4. Hard constraints (measured or decided earlier)

- **Machine targets.** A mid-range phone at 60 frames a second on `med` quality; `low` must stay playable. Physics today: one whole body
  1.6 to 2.3 ms a frame (detail 3, 642 particles, 6 substeps); pieces under 0.35 of a whole use detail 2 (162 particles) and 6 of
  them cost about what 2 whole bodies cost; 5 whole bodies with contact about 10 ms. The shell refuses more bodies when the frame
  average is over 30 ms.
- **Limits today.** Mat: 3 / 4 / 5 squishies by quality. Cut: up to 4 / 6 / 6 pieces of ONE squishy, no piece under 1/8.
- **Rules of the code base.** TypeScript strict with `erasableSyntaxOnly`, relative imports end in `.ts`, no new dependencies, a strict
  Content Security Policy (no inline script or style), zero allocation per frame in hot paths, determinism in physics and LIFE, every
  cross-lane seam additive and optional in `src/contracts.ts`, save keys `wobblehoard:v1:*` never renamed (new state needs a migration).
- **Economy.** Taps pay nothing; a squeeze pays 0.7 + 0.6 per second (to 3 s), a stretch 1.0 + 0.65 per second; a 40 points a minute
  valve; 12 capsules a day at full rate. Autonomous behaviour must never earn points by itself (no idle income).
- **Tone.** Kind, cozy, a toy first. Words a seven-year-old can read. Nothing scary, nothing to lose.

## 5. What the designers must work out (answer every one)

1. **The places.** For each of Home, the beach, the snowy mountain and the forest log cabin: an original name, the look in one
   paragraph (palette inside the existing token family, time of day, weather), the ground behaviour, the zones, and 4 to 6 things with
   their physics (which simple collider or mechanism), what the player can do with each, and what squishies do with each by
   themselves.
2. **"In their own way."** A table of how each of the 12 material families reacts to each place's zones and things (for example a
   water-filled one floats and sloshes, a foam one soaks up water and squirts when squeezed, a marshmallow one toasts by the fire, a
   firm one slides fast on ice). Which reactions are physics, which are looks, which are sounds. Plus a per-species favourite place,
   favourite thing and best friend, derived deterministically, to be discovered by the player.
3. **Life.** The personality traits and where they come from; the needs or moods; the behaviour list with triggers (idle, wander,
   notice, greet, nuzzle, copy, play with a thing, sing together, pile up and nap, comfort, sulk, show a wish); how a squishy moves by
   itself (a hop made of an anticipation squash and an impulse); what the player's touch does to the brain; how squishies are kept
   inside the place.
4. **Social play.** The pair and group interactions, each with its emote, its voice exchange, its physics, how it starts and ends,
   and what friendship it builds. How friendship is stored (bounded storage) and what it unlocks.
5. **Emotes and voices.** The squishmoji list (about 24, each with a meaning), bubble rules, and the voice design (syllables,
   pitch and timbre by species, call and response, harmony), with exact caps for the attention budget on phone and desktop, normal
   and Calm.
6. **Pieces.** What a piece can and cannot do, how groups of pieces share feedback, the character caps (whole squishies plus pieces)
   by quality tier, and what happens to the brain when a squishy is cut or made whole.
7. **Purpose.** The Journal: chapters, about 8 to 10 quests per chapter with exact completion rules that the code can check from
   events, a finale per chapter, the order in which places unlock, wishes (a squishy asks for something with a thought bubble),
   discoveries per species, keepsakes, and the first ten minutes of a new player (onboarding quest by quest). What a returning
   player does on day 2, day 7 and day 30. Which rewards touch the economy and proof that the pace holds.
8. **Screens.** Travel (choosing a place), bringing squishies along (the party), the Journal, the quest tracker, wish bubbles, quest
   complete moments, keepsakes, new settings (chatter volume, autonomy on or off). Each must fit the play view without clutter on a
   390 x 844 phone and follow `_spec/UI.md`.
9. **Architecture.** Exact additive contract members, the data model of a place and a thing, the LIFE step interface (world snapshot
   in, intents out, zero allocation), the physics additions (ground, zones, prop colliders and mechanisms, hop, sleep, lighter
   background bodies), render and audio additions, save format and migration, lazy loading, and the build order with dependencies.
10. **Budgets and proof.** Character caps, frame-time budget per subsystem, the size budget, and an acceptance checklist with ids per
    lane that a verifier can run (node probes first, browser checks second).
11. **What to cut.** A first shippable slice (one new place fully working with life, social play and a first Journal chapter), then
    the other two places, so something playable exists early.

## 6. Outputs of the panel

- Each designer: one complete proposal file under `_handoff/design/`, covering every question above, from their own angle.
- Each judge: scores, the best ideas to keep from each proposal, and a must-fix list.
- The synthesizer: the final specs `_spec/PLACES.md`, `_spec/LIFE.md`, `_spec/QUESTS.md` and `_spec/PLAYGROUND_BUILD.md` (architecture,
  ownership, exact contract additions, budgets, build order, acceptance checks, verification charters), the additive members applied
  to `src/contracts.ts` with a clean typecheck, and one brief per lane under `_handoff/briefs/`.

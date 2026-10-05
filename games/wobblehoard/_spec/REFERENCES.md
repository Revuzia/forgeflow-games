# Reference clips: what we took (ideas only) and what we refuse to copy

The owner pointed at two short clips on X. They were reviewed on 2026-10-05 from downloaded copies kept **outside the repo**
(frame contact sheets at 3-4 fps and an audio spectrogram, in the session scratchpad). **No frame, sound, name, character,
colour scheme or UI element from them is in this game.** This page records interaction *ideas* only, how WOBBLEHOARD does
each one its own way, and the guardrails reviewers check.

| Clip | What it is |
|---|---|
| A: `x.com/SPAC89/status/2105783511433318451` (20 s, no audio) | Split-screen comparison of two AI-built versions of one tech demo: a translucent, glowing jellyfish toy on black, with short serif captions in Spanish |
| B: `x.com/AugustCastilIo/status/2105350465001029697` (45.7 s, music + effects) | A browser squishy toy: a pastel shelf of glossy animal-shaped squishies, slime trays, a settings panel and a paid "Premium" tier with a 6-input blender |

## 1. Clip A, beat by beat

| Caption (translated) | What happens | Our take |
|---|---|---|
| "Touch the light" | A touch blooms light at the contact point | **Contact glow**: a soft light bloom where the finger presses, tinted by the core colour, on top of the existing pressure blush (render) |
| "To the limit" | The bell and a tentacle are pulled out 3-4x their length like taffy, then spring back with a wobble | **Long pulls for stretchy families**: Sticky Stretch and Slime Goo pull to their family `maxPull` (2.1-2.9x), neck and spring back; firm families resist (physics round 2) |
| "The form remembers" | It returns exactly to shape | Shape matching + the Zener memory arm (already the core of the solver) |
| "Each cut, another size" / "One form, many pieces" / "Stretch one piece" / "Everything reconnects" | Slicing into 4, 8, then a grid of chunks that can each be pulled, then re-merging | **Not in v1.** Listed as the *Jelly Lab* stretch module in `NEXT_STEPS.md` (needs split/rejoin topology) |
| "All the light in one ball" / "Concentrated light" / "And it becomes a jellyfish again" | The tentacles wrap the bell into a glowing ball, which then springs back | The **merge ceremony fold**: parents fold into one glowing ball (`setFold`), charge, burst open (`burstOpen`) |
| "Aurora. Amber. Abyssal." | Three colourways of the same toy | Recorded as an owner decision: optional rare **colourway variants** per species (a collecting dimension; changes the economy, so the sim must be re-run first) |

## 2. Clip B, beat by beat

| Caption | What happens | Our take |
|---|---|---|
| "poke." | A shelf of three squishies; a poke dents one, its face squints; a tap makes it hop | Poke / squish / release with squint-on-release eyes (built). Ours: dark felt play-mat, translucent jelly, eyes only, original species |
| "mix and match." | Many squishies are tossed in; they fall, collide, tumble and pile up on the shelf | **Play mat with several squishies out at once** (bring them out of the hoard), **soft body-to-body contact**, and **pull past the limit = pick it up**, then toss it (physics + shell, stage B) |
| "pull. pop." | Trays of clear and glitter slime; a strand is pulled up, necks and snaps; bubbles | Ours lives in the squishies themselves: tacky families (Sticky Stretch, Slime Goo) **string and snap** with bubbles and a pop (physics tack + render strands + the existing pop voice). A separate slime-tray mode is not planned |
| "more squish." | A premium "maximum squishy mode": louder sounds, extra squish | Free settings: *Louder squish* (built) and an optional *Extra squish* depth (shell) |
| "Premium: the Blender." | A paid 6-input blender liquifies squishies into 3 two-tone hybrids, "Keep them" | **Free merge**: 2 of the same species become 1 random squishy from the catalog, with the fold-into-a-ball ceremony. No paywall, no code box, no hybrids-with-split-colours, no "New squishies!" modal |
| Settings | Volume, Haptics, Screen shake, Gravity (off = float on a tabletop), Dark mode | All present except a theme switch (ours is dark by design; a light theme is optional polish) |
| Audio | A looping music bed under everything; squeaky chirps on pokes; a wet noise band for slime; a blender whirr; chime partials on the reveal | All effect families exist in our synth engine. **Gap: music.** We add an original, generative, gentle ambient bed with its own volume, ducked under ceremonies (audio, stage B) |

## 3. What we deliberately do NOT copy (reviewer checklist)

- No animal-character squishies (bunny, cat, bear, penguin, dragon, octopus, red panda) and no faces with mouths or blush.
- No pastel white / lilac / mint / bubble-gum palette; ours is dusk-indigo felt, amber key light, lagoon rim, ember coral (CONTRACT section 7).
- No bottom pill tab bar layout, no "Premium" tier, no code box, no paywall of any kind.
- No "Squishy Studio"-like naming, no mashed-up hybrid names, no "two-tone" split-colour hybrids.
- No black-void glowing-jellyfish look, no Spanish serif captions, no aurora/amber/abyssal names.
- No sampled or imitated sounds and no imitation of the reference music: every sound is synthesised from our own recipes (`SOUND.md`).

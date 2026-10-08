# PETS_IDEAS: what makes pet games delightful without traps, 86 scored ideas, a top ten, and the dark patterns to refuse

**Lens:** IDEAS AND REFERENCES (one of the PETS design lenses; the voices, toys, care and physics lenses write their own memos).
**Date:** 2026-10-08. **Status:** design memo, read-only on the game. Nothing under `src/`, `_harness/` or `public/` was touched.
**Owner's words (2026-10-08):** voices ("Pokemon had their own way of interacting where they would say their name, or do cute and fun things"), real
toys (a ball, a stick), pets that you feed, give water and "refill" after a leak, "more interactions, and consider other ideas". This memo is the
"other ideas" part.

**Evidence grades (same convention as DESIGN.md):** **[O]** I opened the page this session and read it. **[S]** the claim comes from a web-search
result summary; I did not open the page. **[G]** general knowledge, unchecked. **[C]** I read the code or spec in this repo
(`path:line`). **[M]** I computed it with a script in my scratch folder (the number comes from a formula and a table, not from a run of the game).
Search tool used: WebSearch, standard mode, 21 searches; 6 pages opened with WebFetch (one more returned HTTP 403 and one was unreachable: section 15).

---

## 0. The answer in twelve lines

1. **Are we working on the sounds each squishy makes?** Not in the code: a search of `src/audio` for `species` finds nothing, and the `SquishAudio`
   contract has no voice member (`src/contracts.ts:219-282`) [C]. In the plan: yes. `_handoff/STATUS.md:28` records a running design workflow with six
   designers, one of them a voice-synthesis prototype, that writes `_spec/PETS.md` [C]. This memo does not design the voice synthesiser; it shows how
   voices should connect to the soft body, the music, calling, and sound sensitivity (ideas CR-05, RH-01, RH-10, RH-11, CR-06, AC-01 to AC-05).
2. **Toys.** Understood: the tray the code calls "Toys" holds tools (`src/ui/toyTray.ts:1-3`), and `_spec/UI.md` decision 7 frees the word for a real
   toy shelf [C]. Real toys belong to another lens; the ideas below that depend on a toy are marked "needs".
3. **What I produced:** 86 scored ideas in 9 groups (17 are the examples from the task, assessed; 69 are new), a mechanical ranking, an editorial top ten
   with build specs, the three ideas that would make the game memorable, a byte-priced build order, 20 dark patterns with a refusal rule each, and an
   economy check.
4. **Top ten (section 8):** the body speaks (speech pulse and squeak-true cries); friends feel each other (sympathetic wobble and hug); tilt the tray;
   sweet spot; hiccups, sneezes and yawns; chorus in key; anchored outfits; warm and cool; signature moves and quirks; call tune and everyone looks.
5. **The three that would make the game memorable (section 9):** **the body speaks**, **friends feel each other**, **tilt the tray**. Together with
   their twins (squeak-true cries, hug) they cost **10.5 to 18 KB** [M].
6. **Bytes:** the ten editorial slots cost **42 to 73 KB** (midpoint about 58) [M]. Today 1143 KB are used of 1229 KB; the UI plan treats the whole remaining
   headroom as its budget ("roughly 90 KB to live in", `_spec/UI.md:26`) and the task text says the overhaul needs about 90 KB, so 1143 + 90 = 1233 KB is
   already about 4 KB over the gate before a single pet feature. **The gate has to rise whatever is built;** section 10 gives the
   numbers and what fits at each gate. The owner decides.
7. **No new squish-point source.** None of the 86 ideas adds a way to earn; ideas that contain a hold or a stretch pay exactly by the existing rules, and
   the meter's freshness is per touch KIND, not per squishy (`src/core/meter.ts:46`), so five squishies do not multiply it [C]. No simulation is needed
   (section 12). One real risk found: scripted "ghost finger" reactions must never reach the meter (section 4, P1).
8. **The edge:** 37 of the 86 ideas score 4 or 5 on soft-body uniqueness (17 score 4, 20 score 5) [M]. The best ones make the jelly the instrument:
   it sings by being squeezed, it answers a friend by shivering, it slides when you tilt, it softens when warm.
9. **Do not copy the cry pattern of any franchise.** Pokemon's first two generations reused a small set of base cries (38 and 68) altered in pitch and
   length, and later generations used digitised sounds [S]. The idea "few base voices, many variations" is generic and cheap; chip-square timbres and
   a creature that only repeats its own name are the signature of that franchise and are avoided (section 8, T1).
10. **Refuse:** death or long sickness, real-time hunger clocks, push notifications, sad pleading faces, pay-to-fix, streaks, random care rewards, a
    microphone, pain sounds, limited-time items. Twenty patterns with evidence are in section 11.
11. **Seven questions need the owner** (section 14). The four that matter most: the gate, how best friends are made, whether accessories are all free
    from the start, and whether tilt may ask for the phone's motion permission.
12. **What I did not do:** run the game, listen to anything, or measure the physics. Every physics number here is derived from tables and code comments
    (section 15).

---

## 1. What exists today (read this session; every row has a path)

| # | Fact | Evidence | Consequence for the ideas |
|---|---|---|---|
| 1 | No pet state exists. A case-insensitive search of `src/**/*.ts` for hunger, thirst, leak, mood, affection and bond finds only unrelated hits (the capsule's light "leak" in `render/capsule.ts`, a node-leak probe in `audio/dsp.ts:26`). | grep, this session [C] | Everything below is greenfield; the word "leak" is already used for the capsule's tell-light, so the UI copy for a leaking squishy needs another word. |
| 2 | No per-species or speech audio. `SquishAudio` has poke, squishStart, release, land, pop, blend, meterFull, capsuleBeat, reveal, mergeStart, duck, setMusic, bump, lift, toss, strand, cut, rejoin; nothing speaks. | `src/contracts.ts:219-282`; grep `species` in `src/audio` finds nothing [C] | A voice layer is new. It must be cheap to rate-limit and to caption (SOUND.md already has the pattern: the bump limiter). |
| 3 | The face is two ink-dark eyes anchored to the surface; it blinks, looks at the pointer, widens when compression is above 0.3, squints while springing back; **no mouth**. DESIGN's originality checklist says "two glossy eyes, no mouth". | `src/render/face.ts:1-12`; `_spec/DESIGN.md:702` [C] | A voice needs a body language that is not a mouth: the whole body pulses (idea CR-05). |
| 4 | Eyes ride the squash through a rest-mesh mapper (a barycentric surface anchor); glitter and fx use the same mapper. | `face.ts:3-8`; `render/fx.ts:15,230` [C] | Hats, glasses and bows can be anchored the same way (PL-11) at small cost. |
| 5 | Physics hooks that exist: `nudge` (clamped to 12 m/s), two finger slots, `setFrac` (clamped to 1/8..1, smoothstep over seconds), `setFold`, `moveTo`, `tremble`, `burstOpen` (overshoot 1 + 0.25 x strength), `collide` + `bump`, `setNeck`. | `contracts.ts:132-195`; `physics/softbody.ts:159,912,1020,1194,1207,1213,1223,1229,1313,1331` [C] | Most care and play ideas are scripts over these hooks, with no new physics. Ones that need something else are marked with `!` in the Needs column. |
| 6 | Metrics for sound and look: `compression`, `compressionRate`, `volume`, `kinetic`, `slosh` (water-fill and bead-squeeze only: 10 species), `strands`, `pull`, `carried`. Foam, marshmallow, bead and dome families bleed volume (`volBleedMax` 0.55, 0.35, 0.18, 0.3). | `contracts.ts:55-81`; family counts from `catalog.ts` grep; bleed from `SQUISHY_SCIENCE.md` section 4 [C] | Squeak-true cries (RH-11) can be driven by real signals. |
| 7 | Table contact is Coulomb friction, `tableMu` is 0.3 to 1.5; family values run from 0.55 (water-fill) to 1.1 (sticky stretch). Gravity constant is 10. | `softbody.ts:43`; `data/materials.ts:107`; `SQUISHY_SCIENCE.md` section 4 table; `physics/params.ts:16` [C] | Tilt (PL-04) and mat swaps (EN-05) have a real, per-material threshold: atan(mu) (section 8, T3). |
| 8 | The play mat holds 3, 4 or 5 bodies by quality tier; no more come out when the frame average is above 30 ms; five bodies with contact cost about 10 ms a frame. | `shell/mat.ts` `MAT_LIMIT`, `FRAME_BUSY_MS`; `RESUME.md` section 2 PHYSICS [C] | A prop that is itself a SoftBody takes a squishy's slot. Rigid props need analytic colliders (not built; the Stamp and Roll physics round is planned to add kinematic tool shapes: `FUN.md` build order 4). |
| 9 | A "mat corral" holds each body near its home spot (0.6 m dead zone, 2.5 m rim). | `contracts.ts:106` [C] | Tilt and slides stay inside the mat; nothing wanders off. |
| 10 | Music: generative, 66 BPM (one beat 0.909 s, a bar 3.636 s), light swing 0.045, harmonic fields held 8, 12 or 16 bars (29.1, 43.6, 58.2 s), at most 6 live notes. Engine voice cap 24. | `audio/music.ts:5-8,21-30`; `audio/engine.ts:23` [C][M] | A chorus can be tuned to the current field; a beat clock for swaying exists in the constants. |
| 11 | Every species has a catalog "signature touch": 19 poke, 20 squeeze, 11 pull. 12 material families, 3 to 5 species each. | `data/catalog.ts` (grep of `signature:` and `family:`) [C] | Signature moves (CO-04) can be keyed to a tag that already exists. |
| 12 | Instance fields: name (picked from 24 fixed nicknames), `bornAt`, `origin.parents`, `tradeCount`. No pet fields. | `core/genome.ts` `SquishyInstance`; `ui/names.ts` [C] | Per-squishy pet data is an additive save field; personality can be derived from `genome.seed` with nothing stored. |
| 13 | Settings today: volume, squishBoost, haptics, shake, gravity, quality, music, extraSquish, calm, skipAnimations, fastOpen, shortcuts. No voices switch. One polite live region merges messages within 250 ms. | `contracts.ts:421-442`; `ui/announcer.ts:1-3` [C] | Voice switch, volume, ceiling and captions are new rows (AC-01, AC-02). |
| 14 | No device-motion code and no microphone use: a search of `src` for devicemotion, deviceorientation, getUserMedia and microphone finds nothing. Haptics is a `navigator.vibrate` wrapper that does nothing on iOS Safari. | grep; `input/haptics.ts:1` [C] | Tilt would be a first, and is opt-in. Haptic voices (AC-08) are Android-only. |
| 15 | Economy: taps pay 0; a squeeze held 0.4 s or more pays 0.7 + 0.6 per second (capped at 3 s); a stretched release pays 1.0 + 0.65 per second; freshness depends on the touch KIND; a valve of 40 SP a minute; at most 12 capsules a day from play. | `core/meter.ts:27,46`; `DESIGN.md` 5.4 [C] | New activities pay only through these. Free taps (pop-it pad, drum, keys, signature pokes) cannot be farmed. |
| 16 | Bundle: 1143 KB used of the 1229 KB gate (STATUS.md, 2026-10-07); the UI overhaul needs about 90 KB. The old `dist/` (dated 2026-10-05) shows the proportions: stage chunk 685,875 B (three.js), main 223,867 B, audio engine 63,479 B, softbody 53,750 B, css 42,087 B. | `_handoff/STATUS.md:4,19,28`; `_spec/UI.md:26`; `dist/assets` listing (stale) [C] | Pet code competes with the UI for the last ~86 KB: see section 10. |

**Byte calibration (how I priced the ideas).** I minified six existing modules with the repo's own bundler (rolldown, minify on, `three` external) and
counted output bytes. Sources include their imported helpers, so each is a slight upper bound.

| Module | Source bytes | Lines | Minified bytes | Output bytes per source line |
|---|---|---|---|---|
| `audio/interact.ts` | 21,206 | 384 | 12,034 | 31 |
| `audio/voices.ts` | 25,945 | 571 | 13,873 | 24 |
| `audio/cut.ts` | 31,669 | 538 | 16,062 | 30 |
| `render/face.ts` | 16,574 | 312 | 8,778 | 28 |
| `ui/toyTray.ts` | 6,756 | 127 | 3,773 | 30 |
| `ui/snapBar.ts` | 6,703 | 115 | 3,855 | 34 |

So **about 30 bytes of shipped code per line of lean TypeScript** (24 to 34) [M]. I priced each idea as lines x 30 B, plus 0.25 to 0.5 KB per
procedural prop or icon, and quote a range of roughly +-40 %. The G0 gate counts raw bytes of `dist/` (`CONTRACT.md:184`), so all KB below are raw
minified bytes, not gzip.

---

## 2. Research: what the reference games do, and where they go wrong

I searched for each reference and opened the pages that carry a design claim I rely on. Where a page was blocked or only a search summary was
available, the row says [S]. All wording is mine; no passages are copied.

| Reference | Why it delights | What keeps people coming back | Failure modes found | What Squish Keeper takes / refuses | Grade and source |
|---|---|---|---|---|---|
| **Tamagotchi (1996, and the 2013 app revival)** | A tiny creature that visibly needs you; the pocket device keeps its own clock, sleeps at night, calls for food by day. | Responsibility itself: neglect leads to a ghost and a headstone in the Japanese releases; English releases softened the scene; the loss is reversible by hatching a new one. | Blame and finality aimed at children; the app revival carried the old attention-seeking alerts over as push notifications. | **Take** the warmth of "it is small and it is mine". **Refuse** death, grave scenes, a device clock, nagging. | [S] [Mental Floss](https://mentalfloss.com/article/642373/tamagotchi-history), [Spectator](https://www.spectatornews.com/showcase/2008/10/what-ever-happened-to-tamagotchis/), [TouchArcade 2013](https://toucharcade.com/2013/04/05/tamagotchi-l-i-f-e-lets-you-relive-the-iconic-virtual-pets-constant-nagging-with-constant-push-notifications/) |
| **Nintendogs (2005)** | Touch is the interface: stroke, rub the tummy, throw a ball or disc, play tug; you name the dog and call it by voice; teaching a trick is a tap-and-speak loop. | Daily care, tricks, expressive dogs that react to your voice. | The microphone matched earlier recordings, wanted the same intonation each time, and confused similar commands. Neglect turned the dogs resentful: they growl, refuse petting and ignore their name; an adult wrote years later that the guilt persists. | **Take** touch-first play and "toys you throw with your finger". **Refuse** the love/hate decay and the microphone. A tune is a reliable call. | [O] [Nintendo World Report review](https://www.nintendoworldreport.com/review/4394), [O] [Gfinity essay](https://www.gfinityesports.com/article/i-left-my-nintendogs-decades-ago-and-the-guilt-is-eating-me-alive) |
| **Pokemon-Amie (X/Y) and Refresh (Sun/Moon)** | Petting reactions vary by spot; every creature eats in its own way; a bounce-the-yarn-ball minigame ("Head It") was called fun and relaxing; Refresh adds comb, towel, brush and dryer care after battles. | Affection is permanent: it does not fall with neglect. Fullness and enjoyment drift down over time, but nothing is lost: affection stays. | Timed berry-dragging was called stressful; a camera-based facial-expression feature was called embarrassing and unreliable; affection that boosted battles made players grind minigames. | **Take** permanent bonds (CO-01), varied reactions, the ball-off-the-body play, care props. **Refuse** timed drags, camera features, and any stat that gives power. The Amie rub sound reportedly changes pitch to tell you whether you hit a liked or a disliked spot, and a disliked spot adds nothing [S Bulbapedia via search]; we keep a warm/cool sound and drop the disliked spot (CA-05). | [O] [Smogon](https://www.smogon.com/smog/issue40/pokemon-amie), [O] [Serebii Refresh](https://serebii.net/sunmoon/pokemonrefresh.shtml); Bulbapedia returned HTTP 403 to me, so its details are [S] |
| **Neko Atsume** | You set out food and toys and watch; cats arrive on their own, never owned; cats do not come while you watch. | Almost no upkeep, no punishment for absence; discovery of which item attracts which cat; mementos arrive at hidden, uneven times. | A fish economy nudges spending on better items. Hidden variable timing is a reward-schedule technique. | **Take** "being away is neutral, coming back is a small present". **Refuse** hidden-schedule rewards on anything that is care. | [S] [Daily Collegian](https://dailycollegian.com/2016/01/neko-atsume-app-offers-fun-feline-diversion), [Mechanics of Magic](https://mechanicsofmagic.com/?p=16102); the AV Club page was not reachable |
| **Viva Pinata** | The garden is the game: terrain, plants and water lure species; a romance dance minigame ends in an egg. | The staged funnel (sighting, visit, residency, romance). | Hidden requirements; the maze minigame with lives; breeding to sell for coins. | **Take** "the environment invites visitors" (sunbeam spot, weather) and a dance as a celebration. **Refuse** hidden gates, lives, selling. | [S] [Viva Pinata Wiki](https://vivapinata.fandom.com/wiki/Garden) and review pages |
| **My Singing Monsters (and Composer)** | Each monster contributes one layer of a song; three sound families (a cappella, percussion, pitched instrument). Composer lets you assign each monster a part and balance loudness. | The sense of building a song from characters. | Not examined; I did not research its timers or currency, so I make no claim. | **Take** voices as parts of one piece in one key (RH-01). | [S] [MSM Wiki](https://mysingingmonsters.fandom.com/wiki/Monsters/Composer), [Big Blue Bubble](https://www.bigbluebubble.com/my-singing-monsters-composer-press/) |
| **Talking Tom family** | The pet echoes what you say in an altered voice; a therapist-parent used it to practise hard consonants. | Instant cause and effect. | Common Sense Media notes heavy advertising, crude humour, data sharing and ad-tracking; poking him too hard makes him fall over or groan; a 2014 self-regulator found ads not clearly labelled; a reviewer calls the loop a chore list. | **Take** the echo as a rhythm echo with no recording (RH-04). **Refuse** ads, data, and pain reactions to rough play. | [S] [Common Sense](https://www.commonsensemedia.org/app-reviews/my-talking-tom-2), [Screenwise](https://screenwiseapp.com/media/my-talking-tom-game), [CARU](https://bbbprograms.org/media/newsroom/decisions/caru-reviews-outfit-7-s-talking-tom-cat-2-app-recommends-modifications), [CoolMomTech](https://coolmomtech.com/2010/11/the-cat-in-the-app/) |
| **Toca Boca and Sago Mini** | Open-ended play with no win, no loss and no timer; Sago Mini found that removing narration let children invent their own stories, and its effects wear off, so a character is never ruined. | Autonomy and silly reactions. | Toca moved in 2018 to a free app with paid unlocks. | **Take** reversible, short-lived effects (dye fades, hats come off) and silence-by-default narration. | [S] [Sago Mini letter](https://sagomini.com/article/sago-mini-letter-to-parents/), [Cooney Center Q and A](https://joanganzcooneycenter.org/2014/11/14/qa-with-sago-sagos-jason-krogh/), [Axios on Toca](https://www.axios.com/2018/11/21/toca-boca-in-app-purchases-toca-life-world) |
| **Webkinz** | Plush tag unlocks a virtual pet and room; phrase-only chat. | Pets get sick but cannot die. | Access renews only by buying another pet; a KinzCash arcade loop. | **Take** phrase-only social. **Refuse** buy-to-keep and grind-for-currency. | [S] [Wikipedia](https://en.wikipedia.org/wiki/Webkinz), [Wharton](https://knowledge.wharton.upenn.edu/?p=6600); "sick but cannot die" is from a parent's blog quoting the guidance: [humphd](https://blog.humphd.org/vocamus-1333/) |
| **Finch (self-care pet)** | The bird never dies, missed days cost nothing, there are options to turn off sounds and animations. | Gentle accountability. | Critics: no history view for people who like it; a daily-completion focus can create the guilt it avoids; chore fatigue. | **Take** "the companion's wellbeing is not tied to attendance"; offer an optional history (Firsts, CO-06). | [S] [HabitBox review](https://habitbox.app/blog/finch-app-review), [SIIT](https://siit.co/blog/finch-app-a-virtual-pet-s-impact-on-self-care/39680) |
| **Slime and ASMR simulators** | Sound and touch are the product: apps advertise per-material squish sounds and haptics, freeze-and-release states, a pop. | In ASMR research, sound triggers are reported as stronger than visual ones; a "just right" completion feeling is a proposed reason "oddly satisfying" clips work. | No peer-reviewed evidence that these apps relieve stress; the claims are developers'. | **Take** per-material sound as the investment, and clear completion cues (a pop, a flip, a snap). **Refuse** stress-relief claims in our copy. | [S] [Frontiers 2021](https://www.frontiersin.org/journals/behavioral-neuroscience/articles/10.3389/fnbeh.2021.761621/pdf), [Discover](https://www.discovermagazine.com/why-are-oddly-satisfying-videos-sosatisfying-218), [Live Science](https://www.livescience.com/62091-oddlysatisfying-videos-satisfying.html), [app listing](https://apps.apple.com/app/id1584784222) |
| **Animal Crossing "Animalese"** | Villagers babble: each letter maps to a speech sound, pitch and speed follow emotion and personality; it sidesteps translation. | Instant personality from pitch alone. | Largely unintelligible by design (letters to syllables is also how an earlier version worked). | **Take** the idea of a name turned into syllables, pitch as personality (RH-10). Ours is synthesised, original, not speech. | [S] [Nookipedia](https://nookipedia.com/wiki/Animalese) |
| **Pokemon cries** | Each creature has a recognisable cry; generations I and II used 38 and 68 base cries, reused with pitch and length changes; later generations used digitised sounds. | Identity at almost no memory. | Cartridge limits produced shared cries. | **Take** "few base voices (by family), many variations (by species, size)". **Avoid** chip-square timbre and a name-only cry, which are that franchise's signature. | [S] [Bulbapedia: Cry](https://bulbapedia.bulbagarden.net/wiki/Cry) |
| **Procedural creature voices (No Man's Sky, Spore)** | No Man's Sky synthesises creature calls from physical-feeling parameters (body mass, windpipe length, wetness, harshness) with formant filters; Spore tied a creature's sound to the mouth part you chose. | A voice that is consistent with the body. | Not applicable. | **Take** deriving the voice from body numbers: our genome already has size and firmness, and `pitchRatio(genome)` does it. Our creature has no mouth, so the body itself moves (CR-05). | [S] [Renoise forum copy of a New Yorker report](https://forum.renoise.com/t/procedural-creature-sounds-simulate-vocal-chords-pharynx-mouth/43691), [Smithsonian](https://www.smithsonianmag.com/smart-news/how-video-game-designers-make-artificial-creatures-sound-real-180955268/), [Mix](https://www.mixonline.com/sfp/sfp-magical-world-spore-369211) |
| **Dark-pattern research on children's games and apps** | n/a | n/a | A recent short paper finds 18 deceptive patterns across five popular games, and an interview-based framework lists grinding and paid enhancements among them; a UK study of 42 families links daily rewards and celebratory sounds to slot-machine design; a regulator told a pet game to stop threatening to seize a neglected pet unless a fine was paid in virtual money [O]; a developer blog says some pet games charge to automate feeding; a 2013 guide reports a pet app that sent threatening notices to a nine-year-old. | See section 11. | [O] [CARU, Mall Girl](https://bbbprograms.org/media/newsroom/decisions/caru-recommends-toy-box-apps-modify-advertising-for-mall-girl-app-to-avoid-undue-sales-pressure); [S] [SciTePress paper](https://scitepress.org/PublishedPapers/2025/133658), [PMC framework](https://pmc.ncbi.nlm.nih.gov/articles/PMC9206186/), [Newcastle/Loughborough via WNHub](https://wnhub.io/news/analytics/item-1012), [Urban Airship guide](https://mobilemarketingmagazine.com/urban-airship-guide-highlights-bad-push-messaging/), [devlog](https://itch.io/devlog/73412/2-on-virtual-pets-part-1-of-2.amp) |
| **Children's Code (UK ICO), standard 13** | n/a | n/a | The final text I opened asks services to nudge children toward wellbeing behaviours such as taking breaks and to offer pause-and-save tools; it does **not** name streaks (the 2019 draft did, as reward loops) [O][S]. | Break buddy (RH-09) is a recommended kind of nudge. | [O] [ICO standard 13](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/13-nudge-techniques/) |
| **Sound accessibility guidance** | n/a | n/a | Xbox guidance asks for independent volume and mute per audio category; an accessibility article asks for captions that describe non-speech sounds; a Minecraft feedback post from a sound-sensitive autistic player asks for a maximum-volume limit separate from the volume slider, because sudden loud sounds frighten even when expected. | Voice switch, volume and a separate peak ceiling (AC-02); captions (AC-01). | [S] [Xbox guideline 105](https://devdocs.xbox.com/gaming/accessibility/xbox-accessibility-guidelines/105), [audio accessibility article](https://www.abratabia.com/game-accessibility/audio-accessibility.php), [Minecraft feedback](https://feedback.minecraft.net/hc/en-us/community/posts/30748470150285-Accessibility-Max-Volume-Limit-for-Sound-Sensitive-Players) |

**Gaps I am not hiding.** "Pocket Pets" returned nothing usable. Pou returned only app-listing and spam pages, so I make no claim about it. For Spore I found
no source that its creature voices were procedural, only recorded and processed (the procedural part was its music). I found no peer-reviewed study of
guilt notifications or pay-to-feed in children's pet games; the evidence is regulator decisions, press, and design essays (section 15).

### 2.1 Eight things the research says to do

1. **Make absence neutral.** The best-loved gentle games (Neko Atsume, Finch, Amie's permanent affection) never punish being away; the most-remembered guilt (Tamagotchi graves, Nintendogs resentment) came from states that worsen with absence [O/S].
2. **Let a bond only go up.** Amie's affection is permanent while the harmless things (fullness, enjoyment) drift [O]. Anything that decays can be mourned.
3. **Reward with reactions, not with currency.** The reactions people praise are varied petting responses and funny eating animations [O Smogon]; the stress people report comes from timers and mini-games with a fail state [O].
4. **Touch first, props second.** Nintendogs and Amie both build play from touch plus a thrown or bounced object; the "Head It" ball bounce is a direct precedent for a ball that squashes into our body [O].
5. **Do not use a microphone.** Reliability was mediocre in 2005 [O] and the privacy duties today (COPPA, `DESIGN.md:671-679`) make it unacceptable. A tune is an honest "call".
6. **Identity from a small kit.** Few base voices x variations is how a franchise got 100s of recognisable cries on tiny hardware [S]; derive the variations from body numbers [S].
7. **Sound is the product in squishy toys.** ASMR research reports audio as the stronger trigger [S]; invest in material-true sound and completion cues, not in menus.
8. **Sound safety is its own control.** Separate switch, volume and a hard ceiling; captions for every cry [S].

---

## 3. Ten laws of a kind pet (the contract every idea below obeys)

| # | Law | Why (evidence) | How it is checked |
|---|---|---|---|
| L1 | **Absence is neutral.** Nothing gets worse because you were away. Coming back is a small present at most. | Tamagotchi graves, Nintendogs resentment [O/S]; `DESIGN.md:689` | No code path reads wall-clock time to change a squishy's state; a verifier sets the clock a year ahead and diffs the save. |
| L2 | **Wants are pictures, not pleas.** A want is a small picture bubble that leaves by itself; never a sad face, a counter or a repeat. | Mall Girl pet-seizure message [O] | Eye emotes are a closed list of 6 (heart, star, spiral, sleepy, wide, content); a test fails if a "sad/cry" id exists. |
| L3 | **Bonds only go up.** Hearts, firsts and pair bonds never decrease, by absence or trade. Any drifting value goes to neutral and stops, and unlocks nothing that can be lost. | Amie [O] | Property test: apply 10,000 random events; every bond value is monotone. |
| L4 | **Care changes how it looks and sounds, never what you can do or own.** No gating, no currency, no randomness in care. | `DESIGN.md:665-669` | No care function takes or returns a squish point or an item id. |
| L5 | **Everything is optional; the toy is the point.** Nothing must be done. | Toca Boca, Neko Atsume [S] | The first 5 minutes of a run can be played with every pet UI closed. |
| L6 | **Voices are short, quiet, rare, switchable, captioned, and never pain.** | Talking Tom reactions [S]; Minecraft feedback [S] | Rate limits and ceiling in section 4, P3; a sound panel with a human listener for rough-play cries. |
| L7 | **No microphone, camera, location, free text.** | `DESIGN.md:671-679`; Nintendogs [O]; Amie camera feature [O] | grep for getUserMedia stays at 0 hits. |
| L8 | **Celebration is small.** At most 1.2 s, at most one per 8 s, no escalation by repetition, no jackpot cascade. | Slot-machine link in the UK study [S] | A probe plays 50 celebrations in 60 s and counts audible ones. |
| L9 | **Calm, reduced motion and sound sensitivity are first-class.** Every idea has a Calm variant (no pulses, no hops, captions, fades). | `DESIGN.md:609` | Run each idea under Calm: no body motion above the stated cap. |
| L10 | **If it has no jiggle it must be nearly free.** The game's edge is the soft body; menu-only features (S=1) should cost 2 KB or less. | Task brief | 21 ideas have S=1; 13 of them cost 2 KB or less. The exceptions are listed so the owner can veto them: three task examples (photo props CR-01 3-5 KB, call tune CR-06 4-6, diorama EN-03 10-16), two accessibility modes (AC-06 3-4, AC-07 2-3), my memory book (CR-07 6-9), sound book (CO-02 2-3), and the online-gifts item (SO-10 6-10), which is excluded. |

---

## 4. Eight engine primitives that make most ideas cheap

| # | Primitive | What it is | Rules | KB |
|---|---|---|---|---|
| P1 | **Ghost finger** | A scripted tap through the existing finger path (`fingerDown`, `fingerPressure`, `fingerMove`, `fingerUp` on a free slot) so a body can be given ripples, hiccups, copycat wobbles with no new physics (`contracts.ts:132-137`). | Used only when both finger slots are free. Every scripted press lasts at most 0.3 s, which the meter reads as a tap (0 SP below 0.4 s). **The shell must also tag these events and drop them from the meter feed, haptics and `audio.poke`** (`shell/feedback.ts:123` routes `poke` to audio): otherwise a scripted press held 0.4 s or more would pay. This is the one real economy risk in this memo. | 0.8 |
| P2 | **Reaction director** | Picks idle reactions (hiccup, yawn, peek) from a quirk table. | At most 1 reaction per 8 s per mat; none within 3 s of a touch; none in the first 10 s of a session; at most 6 per session; Calm halves the rate and removes hops. | 1.2 |
| P3 | **Voice gate** | One function every cry goes through: rate limit, ceiling, switch, caption, speech pulse. | Per squishy at least 1.2 s between cries; global at least 400 ms; at most 2 sounding; idle chatter at most one cry per 20 s per mat; copies the token-bucket pattern of the bump limiter in SOUND.md round 3. | 1.5 |
| P4 | **Beat clock** | Beat phase from the audio clock: phi = ((t - t0) mod 0.909 s) / 0.909 s. | Calm and music-off: no beat effects. | 0.3 |
| P5 | **Tilt source** | A unit vector from `devicemotion` (opt-in), arrow keys, or dragging the mat edge. | Low-pass 0.15 s; clamp +-25 degrees of device tilt; iOS needs a permission prompt from a user gesture; default off. | 1.0 |
| P6 | **Personality from the seed** | Quirk, favourite spot and default call derived from `genome.seed` with a hash. | Nothing stored; same genome gives the same personality on every device. | 0.4 |
| P7 | **Prop kit** | Hats, bows, glasses as small procedural meshes anchored through the same rest mapper as the eyes. | At most 12 extra draw calls for five squishies. | 0.25 per prop |
| P8 | **Analytic colliders** | Sphere, capsule, plane, torus colliders for the squishy to press against. | **Not built.** The planned Stamp and Roll physics round adds kinematic tool shapes; bounce house, ball pit, float tray, slide and arch ride on it. Cost belongs to that round. | n/a |

---

## 5. Scoring rubric (all four axes: higher is better for us)

| Axis | 5 | 3 | 1 |
|---|---|---|---|
| **D** Delight | A child shows it to someone. (Held to about one idea in five: 18 of 86.) | Pleasant, forgettable. | Functional. |
| **S** Soft-body uniqueness | The jelly physics IS the idea; impossible with a rigid sprite. | Physics decorates it. | Menu or skin only. |
| **B** Build ease (5 = cheapest) | At most 2 engineer-days, existing hooks, at most 3 KB. | 1 to 2 weeks, up to 12 KB, one small physics or render change. | A new subsystem across physics, render and audio, over 25 KB. |
| **K** Kid-safety | Nothing can go wrong: no pressure, no data, no loud or scary sound. | Needs a guard (rate limit, caption, ceiling). | A social surface or a pressure risk needing an owner decision; ideas at 3 or below are never in the top ten. |

**Rank = 2D + 2S + B + K** (maximum 30). Delight and soft-body edge are what make a thing memorable here; build ease and safety are gates. The table
also shows **KB** (raw minified, range) and **Needs** (a `!` marks something that does not exist today; lower-case names exist).

---

## 6. The 86 ideas

Counts: 86 ideas; 17 are examples from the task (marked [prompt]); 69 are new. Group sizes: care 12, play 14, social 11, creative 8, environment 9,
collection 7, rhythm and voice 11, seasonal 6, accessibility 8. Means: D 4.01, S 3.06, B 3.43, K 4.83 (K is high because I did not write down ideas I
judged unsafe; the one social item that needs a decision, SO-10, scores 3 and is excluded from the top ten). Twelve ideas need something that does
not exist today. All scores are mine (one designer); treat the ranking as an argument, not a measurement.

### CARE (beyond food, water, leaks and toys) (12)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| CA-01 [prompt] | **Bubble bath** | Foam piles on the body; rubbing makes it squeak, a squeeze pops the foam off in a burst, a sloshy rinse clears the rest. | 5 | 3 | 3 | 5 | 24 | 8-12 | fx(bubbles), nudge, decal |
| CA-02 [prompt] | **Nap bed and night mode** | A pillow and a lamp dial: it settles, lids droop, the body breathes between 94 % and 100 % of its volume over 4 s (setFrac is clamped at 1), the music thins to a lullaby; any touch wakes it with a stretch. Sleep is a choice, never a need. | 4 | 4 | 4 | 5 | 25 | 4-6 | frac, face(lids), music |
| CA-03 [prompt] | **Spa stone** | A warm stone slides over it; the jiggle slows, the core glows warm, a sigh; pays only if you really hold, by the existing squeeze rule. | 4 | 4 | 3 | 5 | 24 | 5-8 | !TEMP setter, face, voice |
| CA-04 | **Shine cloth** | Rub in circles and a glint travels under the cloth; gloss rises for a minute and fades; hearts at the end. | 3 | 3 | 4 | 5 | 21 | 2-3 | shader uniform (gloss) |
| CA-05 | **Sweet spot** | Each squishy has one favourite place (from its seed): stroke near it and a ripple, a giggle and a glow answer, and the stroke sound rises as you get warm. There is no disliked spot. | 5 | 4 | 3 | 5 | 26 | 3-5 | finger(ghost ripple), face, voice |
| CA-06 | **Warm and cool** | A heat lamp and a cool tile change its real material for 20 s: warm is softer and recovers sooner, cool is firmer and sluggish to rebound (foam most), the way viscoelastic foam behaves. | 4 | 5 | 3 | 5 | 26 | 3-5 | !TEMP setter, shader tint |
| CA-07 | **Smooth-out** | Stroke over a putty or mochi dent to knead it flat before it heals by itself (putty heals in 40 s, mochi in 2.5 s); it heals faster under your hand. | 3 | 5 | 4 | 5 | 25 | 1.5-2.5 | !HEAL boost (tiny), finger |
| CA-08 | **Heartbeat hold** | Hold a light squeeze and feel a slow heartbeat: the core breathes at about 0.8 Hz, the phone thumps softly; it pays exactly like any squeeze and nothing more. | 4 | 3 | 5 | 5 | 24 | 1 | core glow, haptic |
| CA-09 | **There, there** | After a hard toss it trembles for a second and a slow stroke settles it with a sigh; never a meter, never "hurt", and it never makes a pain sound. | 3 | 4 | 4 | 4 | 22 | 1-2 | tremble, voice |
| CA-10 | **Hiccups, sneezes and yawns** | Now and then a hiccup jolts it and sends a bubble up (tap its top to cure it with a giggle), a sneeze puffs dust, a yawn stretches it tall: slapstick from the physics. | 5 | 5 | 4 | 5 | 29 | 2-3 | nudge, finger(ghost), voice |
| CA-11 | **Wants as pictures** | At most one tiny picture bubble (sun, bath, ball) per 90 s floats up for 15 s and pops; no counter, no repeat, nothing lost if ignored; tapping it starts that activity. | 3 | 1 | 4 | 4 | 16 | 2 | ui bubble |
| CA-12 | **Snow-globe shake** | Shake the phone (or drag the table) and the glitter inside the body swirls and settles slowly through the jelly. | 4 | 4 | 3 | 5 | 24 | 3-4 | nudge, glitter advection (render), devicemotion |

### PLAY (14)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| PL-01 [prompt] | **Bounce house** | An inflatable pad: land on it and it launches higher, squashed flat on impact; three bounces and it waddles off. | 5 | 5 | 3 | 5 | 28 | 4-8 | nudge on land (cheat) or !ANALYTIC colliders |
| PL-02 | **Trampoline sheet** | A flat jelly sheet that squishies bounce on; two on it make each other bounce, and the sheet dips under both. | 4 | 5 | 2 | 5 | 25 | 6-10 | collide, one extra SoftBody (a mat slot, about 2 ms) |
| PL-03 [prompt] | **Ball pit** | 40 small firm balls the squishy sinks into; balls squash against it, roll off and pile back. | 5 | 5 | 1 | 5 | 26 | 12-20 | !ANALYTIC (many spheres), instancing |
| PL-04 | **Tilt the tray** | Tilt the phone (or arrow keys, or drag the tray edge) and squishies slide, roll and slosh inside the mat corral; water-fills slosh loudest; flat again and they settle. | 5 | 5 | 4 | 5 | 29 | 2-4 | nudge per frame, devicemotion (optional permission) |
| PL-05 | **Taffy tug** | A sticky strand between your finger and a squishy: pull together, let go and it springs; a draw is the only result; pays exactly like a stretch. | 4 | 5 | 3 | 4 | 25 | 3-5 | strands, grab |
| PL-06 | **Glow trail** | Drag a small light bead over the mat: eyes follow, then hops, then a belly slide; drop it and the squishy settles on the spot. | 4 | 3 | 4 | 5 | 23 | 2-3 | moveTo, nudge, face(look) |
| PL-07 | **Squeeze-through arch** | Push a squishy at a ring narrower than its body: it squeezes through, deforming, and re-inflates; firm ones wedge and pop through. | 4 | 5 | 1 | 5 | 24 | 8-14 | !ANALYTIC (torus collider) |
| PL-08 | **Pop-it pad** | A board of 24 domes; each press inverts with a thock, flip the board for more; taps pay nothing and there is no score. | 4 | 2 | 3 | 5 | 20 | 5-8 | audio thock, dome flip animation (the Pop Dome snap physics is not built) |
| PL-09 | **Bubble wand** | Swipe to blow soap bubbles; squishies chase and pop them with a boop, and bubbles stick to tacky families first. | 4 | 3 | 3 | 5 | 22 | 4-6 | fx(bubbles), face(look), nudge |
| PL-10 | **Twirl** | Swipe around a squishy to spin it; it goes dizzy (spiral eyes) and wobbles back; dome species spin like tops. | 4 | 4 | 2 | 4 | 22 | 3-5 | !SPIN (angular impulse), face |
| PL-11 [prompt] | **Anchored outfits** | 24 procedural hats, bows, scarves and glasses that ride the squash like the eyes do: the hat dents the top, the bow wobbles a beat late. | 5 | 4 | 2 | 5 | 25 | 8-12 | face RestMapper anchoring, geometry |
| PL-12 [prompt] | **Dance floor** | Floor tiles glow with the music bed (66 BPM, one beat per 0.91 s); squishies sway and hop on the downbeat; never above 1.1 flashes a second, off in Calm. | 4 | 4 | 4 | 5 | 25 | 3-5 | music beat clock, nudge |
| PL-13 [prompt] | **Hide and seek** | A squishy hides behind a cushion or a leaf; its core glows brighter as your finger gets closer; a peek-a-boo giggle on finding; never timed. | 4 | 2 | 3 | 5 | 20 | 4-6 | occluder props, voice |
| PL-14 | **Slide and ramp** | A gentle slope: slime leaves a trail, putty squashes at the bottom, jelly bounces; it climbs back by itself. | 4 | 4 | 2 | 5 | 23 | 5-8 | !ANALYTIC (plane) |

### SOCIAL (between your own squishies; one online item, flagged) (11)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| SO-01 [prompt] | **Feed two together, make friends** | A treat shared by two (or two bowls eaten together) starts a friendship: they bump, chirp, and a heart bridge glows between them. | 4 | 3 | 3 | 5 | 22 | 3-4 | bump, care lens treats, cut bridge visual |
| SO-02 [prompt] | **Sympathetic wobble** | Best friends phase-lock: poke one and the other answers a beat later at about 40 % strength in the same rhythm, like coupled clocks. | 5 | 5 | 4 | 5 | 29 | 1-2 | nudge, bump, drainEvents |
| SO-03 | **Hug** | Two squishies lean together and squash at the contact, cores glowing where they touch; pinch them closer and hearts float up. | 5 | 5 | 3 | 5 | 28 | 2-3 | collide, moveTo, fx |
| SO-04 | **Nap pile** | Sleepy squishies drift together, sink a little into each other and breathe in unison under a soft bass hum. | 5 | 5 | 3 | 5 | 28 | 2-3 | collide, frac breath, music |
| SO-05 | **Everyone looks** | The eyes of every squishy turn to whoever just made a sound and the bodies lean a few degrees toward it. | 4 | 2 | 5 | 5 | 22 | 0.5-1 | face look target |
| SO-06 | **Family voice** | A merged squishy sings the pitches of its two parents as a two-note interval; the Hoard card plays it, so lineage becomes audible. | 4 | 1 | 4 | 5 | 19 | 1-2 | voice, origin.parents |
| SO-07 | **Hello bump** | When two squishies meet they greet with a short call and answer chosen by their families; the first meeting of a pair adds hearts. | 4 | 3 | 4 | 5 | 23 | 2-3 | bump, voice |
| SO-08 | **Fair share** | Cut a treat in two (the cut readout glows when the halves are within 5 %) and give one half to each squishy; uneven halves still work with a giggle. | 4 | 5 | 2 | 5 | 25 | 2-4 | cut (true-cut rebuild), measureCut, treats |
| SO-09 | **Playdate photo** | Snap with up to 5 squishies: a "say cheese" call makes them all squint into smiles and one throws confetti. | 4 | 1 | 4 | 5 | 19 | 2 | snap, face(squint) |
| SO-10 | **Little gifts (online friends)** | Leave a snack, no text, on a friend-code friend's shelf; no counter, no streak, no thank-you prompts. | 3 | 1 | 1 | 3 | 12 | 6-10 | server, trade friend graph (same switch as trading) |
| SO-11 | **Copycat** | One squishy imitates the last gesture you made on another (the same squash and stretch, a beat late). | 4 | 4 | 3 | 5 | 24 | 2-3 | finger(ghost), event replay |

### CREATIVE (8)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| CR-01 [prompt] | **Photo studio props** | Paper backdrops, a spotlight, a frame and confetti drawn procedurally for the Snap tool. | 4 | 1 | 4 | 5 | 19 | 3-5 | snap |
| CR-02 | **Dye drops** | Drip colour into a clear water-fill squishy and watch it swirl with the slosh and fade within a minute (the genome is never touched). | 5 | 5 | 2 | 5 | 27 | 6-10 | slosh metric, !SHADER advected dye |
| CR-03 | **Squish prints** | Press a squishy onto a paper card to stamp the shape of its base in its colour: round ones leave discs, spiky ones leave stars. | 4 | 5 | 3 | 5 | 26 | 4-6 | positions at the table, canvas card |
| CR-04 | **Eye emotes** | Heart eyes, star eyes, spiral eyes and sleepy lids as short overlays on the existing eyes; each mood has its own shape. | 4 | 2 | 4 | 5 | 21 | 2-3 | face |
| CR-05 | **Speech pulse** | When a squishy cries out, its whole body swells a few percent in time with the loudness (it has no mouth): you SEE the voice leave the body. | 5 | 5 | 3 | 5 | 28 | 1.5-3 | !PULSE (small radial goal modulation) or frac wiggle |
| CR-06 [prompt] | **Call tune** | Choose a 3-note tune on a pentatonic keypad as your squishy's call; play it and the squishy turns, hops over and answers in its own voice. No microphone, ever. | 5 | 1 | 3 | 5 | 20 | 4-6 | voice, moveTo, ui keypad |
| CR-07 | **Memory book** | A picture-book page per play day made from Snap shots and auto-stickers; no missed pages shown, no counts. | 4 | 1 | 2 | 5 | 17 | 6-9 | snap, local storage |
| CR-08 | **Doodle trail** | Slime leaves a glossy trail, glitter squishies a sparkle trail; it fades in 30 s and a swipe wipes it. | 4 | 3 | 3 | 5 | 22 | 3-5 | decal |

### ENVIRONMENT (9)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| EN-01 [prompt] | **Rain puddles** | Rain rings in puddles; squishies splash and slosh, dome species shed drops, and a rainbow follows the sun. | 4 | 3 | 2 | 5 | 21 | 6-10 | decal, fx, nudge |
| EN-02 [prompt] | **Touch garden** | A planter where watering sprouts grow by stages during the session; no real-time clock, never wilts; harvest goes into the treat jar. | 4 | 2 | 2 | 5 | 19 | 7-10 | procedural plants, care lens treats |
| EN-03 [prompt] | **Cozy diorama** | A shelf scene that gains one small object per species you own (a teacup for a mochi); it only grows, never shrinks. | 4 | 1 | 2 | 5 | 17 | 10-16 | procedural props x50 |
| EN-04 | **Float tray** | Shallow water: foam floats high, putty sinks, water-fills sit low; touches make ripple rings (extends the planned Float). | 5 | 5 | 2 | 5 | 27 | 6-10 | !ANALYTIC (water plane), buoyancy per family |
| EN-05 | **Mat swaps** | Felt, grass, ice and bouncy rubber: each sets table friction (mu 0.3 for ice up to 1.5) so squishies visibly slide or grip. | 4 | 4 | 3 | 5 | 24 | 3-5 | !MU setter (tableMu is 0.3..1.5 in materials.ts) |
| EN-06 | **Sunbeam spot** | A warm patch drifts across the mat; an idle squishy slowly leans into it with half-closed lids: an invitation to watch, not a request. | 4 | 3 | 3 | 5 | 22 | 3-4 | moveTo, face, shader |
| EN-07 | **Lamp dial** | A manual light dial from day to dusk to lamplight; "follow my clock" is optional and purely visual. | 3 | 1 | 5 | 5 | 18 | 1-2 | stage lighting |
| EN-08 | **Wind sway** | A small fan makes light squishies lean and thin strands stream sideways. | 3 | 4 | 4 | 5 | 23 | 1-2 | nudge, strands |
| EN-09 [prompt] | **Treat dispenser (pick your own)** | A toy vending machine with six lit buttons that each show exactly what falls out; it lands with a wobble; nothing is random, nothing to buy. | 4 | 3 | 3 | 4 | 21 | 4-6 | capsule drop visuals, care lens |

### COLLECTION (7)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| CO-01 | **Bond hearts (never fade)** | Each squishy has 0 to 5 hearts that only go up with shared play and never down, by absence or by trade; hearts unlock cosmetic flourishes only. | 4 | 1 | 5 | 5 | 20 | 1.5-2 | save field |
| CO-02 | **Sound book** | Hoard cards play each species' voice with its caption; unmet species show a question-mark bubble. | 4 | 1 | 4 | 5 | 19 | 2-3 | voice, hoard |
| CO-03 | **Quirks** | Each squishy has one quirk from its genome seed (shy hides behind others, bold bumps first, sleepy yawns, silly hiccups, curious peeks); nothing is stored. | 4 | 2 | 5 | 5 | 22 | 3-4 | genome.seed, reactions |
| CO-04 | **Signature moves** | Each of the 50 species has one trick keyed to its catalog signature touch (19 poke, 20 squeeze, 11 pull) and its family: 12 family recipes plus a per-species twist (a boing spiral, a melt-sigh, a twang). | 5 | 4 | 3 | 5 | 26 | 5-14 | catalog.signature, burst/tremble/fold/nudge, voice |
| CO-05 | **Pair bonds** | Two squishies can become best friends (by sharing a treat or a hug); the pair shows a thin bridge glow and unlocks a pair-only move. | 4 | 3 | 4 | 4 | 22 | 2 | save field, cut bridge visual |
| CO-06 | **Firsts** | Stickers for a first nap, hug, song and bath; they cannot be missed or expire and show no counts. | 4 | 1 | 5 | 5 | 20 | 1-2 | save field |
| CO-07 | **Hoard chord** | On the Hoard screen the owned squishies hum a soft chord in the music's key (at most 5 voices, very quiet); more squishies, richer chord. | 4 | 2 | 4 | 4 | 20 | 1-2 | voice, music field |

### RHYTHM AND VOICE (11)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| RH-01 [prompt] | **Chorus in key (orchestra)** | Each squishy on the mat is a section (bass, mid, lead, bell, percussion by size and family); voices snap to the music bed's current chord and a held squeeze swells that part. | 5 | 4 | 3 | 5 | 26 | 3-5 | music field export, voice |
| RH-02 | **Sway** | Idle squishies sway on the 0.91 s beat with a tiny nudge on each downbeat, bouncier genomes more; Calm switches it off. | 4 | 4 | 5 | 5 | 26 | 0.8-1 | music beat clock, nudge |
| RH-03 | **Squishy keys** | Poking different squishies plays a pentatonic scale across the mat (bigger = lower); every order sounds fine. | 4 | 3 | 4 | 5 | 23 | 1.5-2 | voice, pentatonic table |
| RH-04 | **Echo** | Tap a short rhythm on one squishy and it plays it back as wobbles and voice; nothing is right or wrong. | 4 | 3 | 4 | 5 | 23 | 3-4 | finger(ghost), voice |
| RH-05 | **Jelly theremin** | Hold a squishy and slide: pitch follows compression and the tone swells, a mellow wave with a hard ceiling. | 4 | 5 | 3 | 4 | 25 | 2-3 | metrics.compression, voice |
| RH-06 | **Shaker** | Bead and liquid squishies are shakers: shake the phone or the mouse and the slosh metric becomes soft rattles. | 4 | 5 | 4 | 4 | 26 | 2 | metrics.slosh, devicemotion, voice |
| RH-07 | **Jelly drum** | Tap a squishy like a drum: pitch from where and how deep you hit, with a soft membrane thump. | 4 | 4 | 3 | 4 | 23 | 2-3 | poke events, voice |
| RH-08 | **Lullaby mode** | Tap the moon: music slows to 54 BPM, voices drop to hums, the heartbeat hold gets gentler; another tap leaves. | 4 | 2 | 5 | 5 | 22 | 1-1.5 | music tempo, voice |
| RH-09 | **Break buddy** | After about 30 minutes the squishies yawn and curl up and offer a rest; dismissable, at most once an hour. | 3 | 2 | 5 | 5 | 20 | 0.5 | clock, reactions |
| RH-10 | **Name babble** | Each squishy says its own name as 2 to 3 formant syllables built from its letters (not speech): Dollop goes "doh-lup". It never says other words. | 5 | 3 | 2 | 5 | 23 | 10-16 | voice core (formant + bubble consonants) |
| RH-11 | **Squeak-true cries** | The cry is played by the physics: pitch follows the compression rate, foam and bead bodies squeak as their volume escapes, water-fills burble with slosh. | 5 | 5 | 3 | 4 | 27 | 4-6 | metrics.compressionRate / volume / slosh, voice |

### SEASONAL (always available all year; a season only makes things more visible) (6)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| SE-01 | **Squishday** | On the day a squishy was born (bornAt) it wears a party hat and confetti pops; the party is also a button any day; a missed day costs nothing. | 4 | 1 | 5 | 5 | 20 | 1-2 | bornAt, outfits |
| SE-02 | **Snow day** | Snow on the mat with footprints, and a white putty snowball to roll. | 4 | 3 | 3 | 5 | 22 | 4-6 | decal, fx |
| SE-03 | **Blossom breeze** | Petals drift and stick to tacky families but slide off slick ones. | 4 | 3 | 3 | 5 | 22 | 3-5 | fx, tack metric |
| SE-04 | **Leaf pile** | A pile of leaves to burrow into; 60 particles that part around the body. | 4 | 3 | 3 | 5 | 22 | 3-5 | fx, nudge |
| SE-05 | **Cozy spooky** | A pumpkin lantern, a ghost-sheet hat and a gentle "boo" giggle; cute rather than scary, with an off switch. | 4 | 2 | 4 | 4 | 20 | 2-3 | outfits, voice |
| SE-06 | **Season tint** | The mat and light tint follow the local date; free, no content locked behind it. | 3 | 1 | 5 | 5 | 18 | 0.5 | stage lighting |

### ACCESSIBILITY (8)

| ID | Idea | One line | D | S | B | K | Rank | KB | Needs |
|---|---|---|---|---|---|---|---|---|---|
| AC-01 | **Voice captions** | Every cry prints a short caption in a speech bubble and in the live region ("Dollop sings a happy bloop"), at most one per 2 s. | 3 | 1 | 5 | 5 | 18 | 1 | announcer (250 ms merge) |
| AC-02 | **Voice switch, volume and ceiling** | Voices get their own switch, slider and a separate loudest-peak ceiling set by a test chime, so a sudden sound can never startle. | 3 | 1 | 5 | 5 | 18 | 1-2 | settings panel, audio chain |
| AC-03 | **Seen voices** | With voices off, or for deaf players, the speech pulse, a drifting note glyph and a vibration beat show every cry. | 4 | 4 | 4 | 5 | 25 | 1 | speech pulse, haptic |
| AC-04 | **Soft voices preset** | Low-passed coos (centroid under 2.5 kHz), attack of at least 40 ms, no sudden peaks and no repeated cry within 5 s. | 3 | 1 | 5 | 5 | 18 | 0.5 | voice params |
| AC-05 | **Quiet room** | One switch: Calm effects, soft voices, captions on, haptics off, music off, camera locked, animation slowed. | 3 | 1 | 5 | 5 | 18 | 0.5 | settings |
| AC-06 | **One-switch scan** | A scanning highlight steps through the actions; one key or tap picks the highlighted one. | 3 | 1 | 2 | 5 | 15 | 3-4 | ui, keyboard |
| AC-07 | **Big-hands mode** | 1.5x targets, doubled hold times, no two-finger gesture needed, and a "hold for me" button for a stretch. | 3 | 1 | 3 | 5 | 16 | 2-3 | ui, gestures, LOCK concept |
| AC-08 | **Haptic voices** | Each cry has its own vibration beat; Android only and off by default. | 2 | 1 | 5 | 4 | 15 | 0.5-1 | haptics.ts |

Notes on the tables above (rubric in section 5; D = delight, S = soft-body uniqueness, B = build ease, K = kid-safety; Rank = 2D + 2S + B + K):

* Distribution [M]. D: 15 threes, 52 fours, 18 fives, one two. S: 21 ones, 10 twos, 18 threes, 17 fours, 20 fives. B: 3 ones, 13 twos, 30 threes, 24 fours, 16 fives.
  K: one three (SO-10), 13 fours, 72 fives.
* The 17 task examples are all assessed, some with a sharper twist: the "nap bed" breathes through `setFrac`, which is clamped at 1, so the breath is
  94 % to 100 % of volume (the linear size change is 2 %, cbrt 0.94 = 0.98) [C][M]; the "garden" grows by touch in the session, never by a real-time
  clock; the "treat dispenser" shows what it gives; "name-calling" becomes a call tune because there is no microphone; the "orchestra" is tuned to the music.
* Seasonal rule: everything seasonal is available all year. A season only makes a thing more visible. No limited-time item exists (section 11, row 9).
* SO-10 (gifts between online friends) is listed so that the owner sees it was considered, and is excluded: it needs the same account switch as trading
  (`DESIGN.md:676-678`) and adds social obligation.
* Where two ideas share one build, the cost is not additive: for example CA-10, CA-05, SO-11 and RH-04 share the ghost finger (P1) and the reaction
  director (P2), so the second and later ones are cheaper than the table says.

---

## 7. Mechanical ranking, and why my top ten is editorial

The 24 highest by Rank (ties broken by delight) [M]:

| # | ID | Idea | D | S | B | K | Rank |
|---|---|---|---|---|---|---|---|
| 1 | CA-10 | Hiccups, sneezes and yawns | 5 | 5 | 4 | 5 | 29 |
| 2 | PL-04 | Tilt the tray | 5 | 5 | 4 | 5 | 29 |
| 3 | SO-02 | Sympathetic wobble | 5 | 5 | 4 | 5 | 29 |
| 4 | CR-05 | Speech pulse | 5 | 5 | 3 | 5 | 28 |
| 5 | PL-01 | Bounce house | 5 | 5 | 3 | 5 | 28 |
| 6 | SO-03 | Hug | 5 | 5 | 3 | 5 | 28 |
| 7 | SO-04 | Nap pile | 5 | 5 | 3 | 5 | 28 |
| 8 | CR-02 | Dye drops | 5 | 5 | 2 | 5 | 27 |
| 9 | EN-04 | Float tray | 5 | 5 | 2 | 5 | 27 |
| 10 | RH-11 | Squeak-true cries | 5 | 5 | 3 | 4 | 27 |
| 11 | CA-05 | Sweet spot | 5 | 4 | 3 | 5 | 26 |
| 12 | CO-04 | Signature moves | 5 | 4 | 3 | 5 | 26 |
| 13 | PL-03 | Ball pit | 5 | 5 | 1 | 5 | 26 |
| 14 | RH-01 | Chorus in key (orchestra) | 5 | 4 | 3 | 5 | 26 |
| 15 | CA-06 | Warm and cool | 4 | 5 | 3 | 5 | 26 |
| 16 | CR-03 | Squish prints | 4 | 5 | 3 | 5 | 26 |
| 17 | RH-02 | Sway | 4 | 4 | 5 | 5 | 26 |
| 18 | RH-06 | Shaker | 4 | 5 | 4 | 4 | 26 |
| 19 | PL-11 | Anchored outfits | 5 | 4 | 2 | 5 | 25 |
| 20 | AC-03 | Seen voices | 4 | 4 | 4 | 5 | 25 |
| 21 | CA-02 | Nap bed and night mode | 4 | 4 | 4 | 5 | 25 |
| 22 | PL-02 | Trampoline sheet | 4 | 5 | 2 | 5 | 25 |
| 23 | PL-05 | Taffy tug | 4 | 5 | 3 | 4 | 25 |
| 24 | PL-12 | Dance floor | 4 | 4 | 4 | 5 | 25 |

The strict mechanical top ten, if the owner prefers a pure score cut, is: CA-10, PL-04, SO-02, CR-05, PL-01, SO-03, SO-04, CR-02, EN-04, RH-11. **My
editorial ten differs on purpose**, and the reasons are:

* **PL-01 Bounce house (28)** is held back: the cheap version (a nudge when the body lands) looks fake next to a body that squashes; the honest version
  needs analytic colliders (P8), which arrive with the Stamp and Roll physics round. It is the first item of phase E.
* **SO-04 Nap pile (28)** needs a sleep system, a pair system and two or more bodies; it follows T2 (phase C) and reuses its contact code.
* **CR-02 Dye drops (27) and EN-04 Float tray (27)** are wonderful and expensive (B=2: an advected-dye shader; a water plane with buoyancy per family).
  They are the "if the budget grows" items.
* **CR-03 Squish prints (26)** is the best idea that is not in the ten: pressing a squishy onto a card to stamp the shape of its base. It needs a card
  UI and a canvas, so it leads the "next" list.
* **RH-06 Shaker (26)** waits for the voice ceiling (AC-02) because K=4 (loudness). **RH-02 Sway (26)** is so cheap (0.8 to 1 KB) that it ships in phase A
  without taking a top-ten slot.
* **In my ten but low on the mechanical list:** the call tune (rank 20) and everyone looks (22) because name-calling was one of the owner's examples
  and a tune is the only reliable call without a microphone; quirks (22) because they are the data every reaction (T5) and signature move (T9) reads;
  outfits (25) because outfits were an owner example and the anchoring is a reuse of the eye code.

---

## 8. The top ten (editorial), with build specs

Each slot is a package of one or two table ideas that share a build. Effort is engineer-days of a lane engineer including that lane's own probes;
independent verification adds about 40 % (`RESUME.md` section 4). KB is raw minified bytes [M].

| Slot | Name | Members (rank each) | KB | Engineer-days (build) | Lanes |
|---|---|---|---|---|---|
| T1 | **The body speaks** | CR-05 Speech pulse (28) + RH-11 Squeak-true cries (27) | 5.5-9 | 5-11 | AUDIO, SHELL (PHYS for option B) |
| T2 | **Friends feel each other** | SO-02 Sympathetic wobble (29) + SO-03 Hug (28) | 3-5 | 4-6 | SHELL |
| T3 | **Tilt the tray** | PL-04 Tilt the tray (29) | 2-4 | 2-3 | SHELL, INPUT |
| T4 | **Sweet spot** | CA-05 Sweet spot (26) | 3-5 | 3-4 | SHELL, RENDER, AUDIO |
| T5 | **Hiccups, sneezes and yawns** | CA-10 Hiccups, sneezes and yawns (29) | 2-3 | 3 | SHELL, AUDIO |
| T6 | **Chorus in key** | RH-01 Chorus in key (orchestra) (26) | 3-5 | 3-4 | AUDIO, SHELL |
| T7 | **Anchored outfits** | PL-11 Anchored outfits (25) | 8-12 | 6-8 | RENDER, UI, SHELL |
| T8 | **Warm and cool** | CA-06 Warm and cool (26) | 3-5 | 4 | PHYS, RENDER, UI |
| T9 | **Signature moves and quirks** | CO-04 Signature moves (26) + CO-03 Quirks (22) | 8-18 | 8-12 | SHELL, PHYS (tuning), AUDIO |
| T10 | **Call tune and everyone looks** | CR-06 Call tune (20) + SO-05 Everyone looks (22) | 4.5-7 | 5-6 | UI, SHELL, AUDIO |
| | **Total** | | **42-73** | **43-61** (with 40 % independent verification: 60-85) | |

Dependencies: T1, T4, T5, T6, T9 and T10 need the base voices from the voice lens (their cost is not counted here; my RH-10 line prices a stand-alone
voice core at 10 to 16 KB). T7 and T10 use the generic shelf and item-picker that `_spec/UI.md` decision 7 builds. T2 needs two or more mat bodies
(`shell/mat.ts`). T3 and T8 each need one small, new input or physics setter. Suggested file names are suggestions only.

### T1. The body speaks (CR-05 Speech pulse + RH-11 Squeak-true cries)

* **The moment.** Poke a Dollop and it answers with its two-syllable cry. On each syllable the whole body gets about 6 % taller and 3 % narrower for
  roughly 90 ms, so you see the sound leave a creature that has no mouth. Squeeze it while it is singing and the pitch bends up; let go and it glides
  back down. A slow-rise or marshmallow squishy squeaks as its air escapes; a water-fill burbles while its liquid core swings; a deaf player sees every
  syllable as a pulse and a small drifting note.
* **Speech pulse, option A (no physics change).** Call `burstOpen(s)` at each syllable onset with s = 0.06 to 0.12. Its goal overshoot is 1 + 0.25 s,
  so +1.5 % to +3.0 % radius and +4.6 % to +9.3 % volume goal [M]; it settles by itself (`softbody.ts:1229`). Schedule it on the same timer the shell
  already uses to line sounds up with effects (`shell/feedback.ts:112`).
* **Speech pulse, option B (a small new hook).** `pulse(amp)` modulates the shape-matching goal: 6 % taller, 3 % narrower in each horizontal direction,
  so the volume stays neutral: 1.06 x 0.97 x 0.97 = 0.997 [M]. Eased with the cry's amplitude envelope, capped at 4 Hz. Better for yawns (T5) as well.
  Calm effects: cap 2 %; reduced motion: no motion at all, the caption (AC-01) and the note glyph remain.
* **Squeak-true cries (starting values, tune by ear, untested).** Pitch f = f_base x pitchRatio(genome) x 2^(b/12) with
  b = clamp(1.25 x compressionRate, -3, +5) semitones, so a fast squeeze (4 per second) is +5 and a release (-2.4 per second) is -3. Loudness from real
  air flow: a = clamp(-d(volume)/dt / 0.6, 0, 1) for the bleeding families (slow-rise 0.55, marshmallow 0.35, pop dome 0.3, bead 0.18 of volume), and
  a = `metrics.slosh` for water-fill and bead squeeze (10 species). `pitchRatio` already makes bigger squishies lower and firmer ones higher
  (`core/genome.ts:140`), so size is part of the voice for free.
* **Voice originality rules (for the voice lens).** Timbres come from this game's own palette (bloops, bubbles, gel formants: SOUND.md), not chip square
  waves. No cry is only the species name repeated. A distinctness test over 8 numbers per voice (f0, two formants, glide, vibrato, bubble density,
  syllable count, length), z-scored, requires a distance of at least 1.0 for all 1,225 pairs of the 50 species [M count]; and a human panel hears all
  50 blind. The test cannot prove "sounds like nothing else"; the panel does.
* **Guards.** Everything goes through the voice gate (P3): per squishy at least 1.2 s between cries, global at least 400 ms, two at once at most,
  idle chatter at most one per 20 s, never in the first 10 s of a session, none while the voice switch is off. A hard ceiling set by the player's test chime
  (AC-02). Cries to rough handling are surprise or delight (a "whee" on a toss, a "boing" on a hard landing), never pain.
* **Effort and bytes.** Shell voice gate and syllable hooks 2 days; squeak-true audio 3 to 4; integration 1 to 2; option B adds 2 to 3 days of physics and its
  own verifier. 5 to 11 days. **5.5 to 9 KB.**
* **What would break it.** A pulse that is off the audio clock reads as a glitch (sync to the audio onset time); pulse plus a cut or a pull in progress
  (skip the pulse while fingers are down on that body); five squishies speaking at once (the gate).

### T2. Friends feel each other (SO-02 Sympathetic wobble + SO-03 Hug)

* **The moment.** Two squishies are best friends. Poke one; a moment later its friend shivers and leans toward it, softly, in the same rhythm. Pinch them
  together and they press into each other, their cores glowing where they touch, a few hearts rising.
* **Wobble rule.** For a source event on A (poke, release, land, bump), schedule on friend B one nudge toward A: v = 0.4 x intensity x 1.2 m/s, up to
  0.48 m/s (a 1.15 cm hop) [M], plus 0.3 of it upward, at a delay of one period of B's own wobble, T = 2 pi / smOmega. That is "pushing a swing at its own
  rhythm" and makes the answer read as a reply, not a twitch. Estimated delays by family [M, from the smOmega table in SQUISHY_SCIENCE.md section 4; verify with a
  ring-down measurement]: firm silicone 165 ms, pop dome 143, gummy 209, jelly 273, slow-rise 314, sticky 393, bead 419, mochi 449, marshmallow 483,
  putty 524, water-fill 571, slime 661. Calm: gain 0.2. An echo is flagged so it can never trigger another echo, at most one echo per 250 ms, and an
  echo is dropped from the meter, haptics and `audio.poke` (P1 rule).
* **Hug.** `collide` already pushes bodies apart and reports `bump` (`softbody.ts:1331`); while a pinch holds both, `moveTo` pulls the two centres together
  with stiffness 0.3 for at most 2 s; a glow at the mean contact point (the cut bridge glow can be reused); glitter in the core hue as hearts. A hug that
  holds 1.5 s makes the pair best friends. A shared treat (SO-01) is the other way in.
* **State.** Two item ids in a new additive save list; at most two pairs on the mat. Pairs never dissolve. If one is traded away the other keeps an
  "old pal" chip with no message (law L3).
* **Effort and bytes.** Wobble 2 days, hug 3; 4 to 6 days. **3 to 5 KB.** Uses two mat slots (each body costs about 2 ms a frame; `RESUME.md` section 2).
* **What would break it.** Motion overload with five bodies (only the pair echoes); the echo loop; a save written by an older build that lacks the list
  (default empty).

### T3. Tilt the tray (PL-04)

* **The moment.** Tilt the phone; the squishies slide, roll and slosh across the mat, the water-filled ones first; tilt back and they slosh home. On a
  desktop the arrow keys tilt it, or you drag the mat edge.
* **The numbers [M].** Table contact is Coulomb friction (`softbody.ts:43`), so a body starts to slide when tan(tilt) > mu. Per family:

| Family | mu | Slides above (virtual tilt, degrees) | Device tilt at gain 1.6 | Result at the 25-degree cap | Species |
|---|---|---|---|---|---|
| water-fill | 0.55 | 28.8 | 18.0 | slides | 5 |
| jelly gel | 0.60 | 31.0 | 19.4 | slides | 5 |
| bead squeeze | 0.65 | 33.0 | 20.6 | slides | 5 |
| gummy | 0.70 | 35.0 | 21.9 | slides | 5 |
| putty | 0.70 | 35.0 | 21.9 | slides | 3 |
| slow-rise | 0.70 | 35.0 | 21.9 | slides | 3 |
| marshmallow | 0.75 | 36.9 | 23.0 | slides | 5 |
| mochi dough | 0.80 | 38.7 | 24.2 | slides | 4 |
| pop dome | 0.80 | 38.7 | 24.2 | slides | 3 |
| firm silicone | 0.90 | 42.0 | 26.2 | leans and clings | 3 |
| slime goo | 0.95 | 43.5 | 27.2 | leans and clings | 4 |
| sticky stretch | 1.10 | 47.7 | 29.8 | leans and clings | 5 |

  38 of the 50 species slide at full tilt; the 12 firm, slimy and sticky ones lean and cling, so the material is visible. Each frame the shell calls
  `nudge` with the lateral component g sin(theta_v) x dt; at the full 40 degrees of virtual tilt that is 10 x sin 40 x (1/60) = 0.107 m/s a frame [M],
  far under the 12 m/s clamp (`softbody.ts:159`). Water-fill and bead slosh is driven by the centre-of-mass velocity (`softbody.ts:437`), so it should
  slosh even where the body does not slide (to verify). The mat corral (0.6 m dead zone, 2.5 m rim) keeps everyone on the mat. It pairs with mat swaps
  (EN-05): on an ice mat (mu 0.3) everything slides at 16.7 degrees of virtual tilt.
* **Input and safety.** `devicemotion` is opt-in: iOS needs a permission request from a user gesture; the default is off, remembered in Settings. Fallbacks:
  arrow keys (while a "Tilt" mode is on, so the G and M shortcuts are untouched), and dragging the mat edge. Low-pass 0.15 s. A body with a finger down is
  skipped. Calm and reduced motion: gain 0.5, so only leaning and slosh, no slides.
* **Effort and bytes.** 2 to 3 days; **2 to 4 KB.**
* **What would break it.** Sensor noise and drift (filter, dead zone of 2 degrees); screen-rotation conflicts (use the sensor frame, not the screen frame);
  a permission prompt that frightens (explain with a picture, ask once, never again if refused).

### T4. Sweet spot (CA-05)

* **The moment.** Stroke your squishy with a fingertip. Somewhere on it (different for each one) the stroke sound rises, a ripple spreads, it giggles
  and glows. There is no wrong place and no "disliked" spot.
* **Numbers.** The spot is a direction on the front hemisphere from the genome seed: azimuth in -60 to +60 degrees, elevation -10 to +50 degrees (nothing
  stored; P6). Closeness s = clamp(1 - angle/55 degrees, 0, 1). The stroke sound is shifted by (1 + 0.5 s), up to +7 semitones. The giggle plays when
  s > 0.75 and the stroke has travelled about one body radius near the spot; cool-down 6 s per squishy. The ripple is a ghost-finger tap (P1) at the spot,
  depth 0.25, 0.12 s.
* **Why this shape.** Amie's petting reactions varied by spot and the pitch of the rub told you whether you had hit a liked or a disliked place [S Bulbapedia];
  a disliked spot added nothing [S]. We keep the positive half only, so there is never a "wrong" stroke and no guilt (L2).
* **Effort and bytes.** 3 to 4 days (stroke detector on the finger-move path, ripple, voice, glow); **3 to 5 KB.**
* **Economy note.** A stroke is a long touch, and today a touch held 0.4 s or more pays as a squeeze whatever it does while down (the meter reads
  `heldFor`); the sweet spot adds no pay and changes none.

### T5. Hiccups, sneezes and yawns (CA-10)

* **The moment.** Now and then the squishy gets the hiccups: a small jolt up, a bubble rising inside, a "hic", two to four times about 0.7 s apart. Tap its
  top and it giggles and they stop. Another time it sneezes (a little lean back, then a puff and a shiver) or yawns (a slow stretch tall, eyes
  narrowing).
* **Numbers.** Hiccup: `nudge` up 0.5 m/s (a 1.25 cm hop [M]) plus `spawnFx('bubbles', ..., 0.3)`. Sneeze: `tremble(0.3)` for 0.25 s then `burstOpen(0.15)`
  (+3.75 % radius, volume goal x1.117 [M]) and a dust puff. Yawn: two slow `burstOpen(0.08)` pulses 1.2 s apart with the eyes' squint, or option B's pulse.
  Frequency by quirk (T9): silly hiccups, sleepy yawns, tidy shakes off dust. Reaction director (P2): at most one reaction per 8 s, none within 3 s of a
  touch, none in the first 10 s, at most 6 a session; Calm removes the hop and keeps the squint.
* **Effort and bytes.** 3 days; **2 to 3 KB.** Uses P1, P2.
* **What would break it.** Becoming annoying (the caps above and the quirk gating are the control); a reaction fired during a cut or a pull.

### T6. Chorus in key (RH-01)

* **The moment.** Bring three squishies out. Poke each: each answers on a different note of the chord the music is playing, the bells join in, and a
  held squeeze swells that squishy's part. No note can be wrong.
* **Numbers.** The music walks four related harmonic fields of one diatonic collection, each held 8, 12 or 16 bars: 29.1, 43.6 or 58.2 s at 66 BPM
  (bar = 3.636 s) [C][M]. Expose the current field's tones; assign parts by size rank (largest = bass at the root, then third, fifth, and a high bell for
  the fourth and fifth squishies); quantise each voice to the nearest chord tone within +-200 cents with a 30 ms glide; retune only at field changes.
  With the music off, fall back to a fixed pentatonic. Polyphony: engine cap 24 voice groups; the chorus uses at most 5.
* **Effort and bytes.** 3 to 4 days (audio 2, shell 1 to 2); **3 to 5 KB.** Needs a one-function export from `audio/music.ts`.
* **What would break it.** Two notes clashing at a field change (retune is deferred to the next downbeat); loudness stacking (the ceiling and the
  five-voice cap).

### T7. Anchored outfits (PL-11)

* **The moment.** Open the wardrobe, pick a party hat and round glasses. The hat sits on the top and dips a little when the squishy squashes, then
  wobbles back a beat late; the glasses ride the eyes. It shows in every photo (Snap).
* **Items (24).** Eight hats (cap, beanie, crown, party, top hat, nightcap, bowl hat, sun hat), four head extras (leaf, flower, antennae, ears), four
  glasses (round, star, sun, tiny monocle), four neckwear (scarf, bow tie, bell, bandana), four bows and clips.
* **Anchoring.** Reuse the rest-mesh mapper that carries the eyes (`face.ts:3-8`): the anchor for a hat is the highest rest vertex in the +Y cone,
  found automatically per species, so odd silhouettes need no hand-placement. A critically-damped-ish follower spring (omega 14 rad/s, damping ratio
  0.35, so about 31 % overshoot and a 0.48 s period [M]) gives the late wobble. The "dent" is visual only (the anchor patch sinks 1.5 %). Calm: no follower.
* **State.** A `wear` list per item id in an additive save field; not part of the genome, so share strings and `probe_genome` pins do not change; free, not
  random, not tradeable.
* **Effort and bytes.** 6 to 8 days (24 small meshes, the anchoring, the picker on the shelf from UI decision 7, save); **8 to 12 KB.** At most 12 extra
  draw calls for five squishies.
* **What would break it.** Clipping on thin silhouettes (clamp the anchor offset to the surface normal); content creep (the cap is 24).

### T8. Warm and cool (CA-06)

* **The moment.** Hold a lamp over a slow-rise squishy and it relaxes, softens and sags a little; hold an ice tile over it and it firms up and goes
  sluggish; after 20 s it eases back. A child learns, by playing, that foam changes with temperature.
* **Numbers (starting values, [G] direction).** Temperature T in [-1, +1] slewed with a 3 s time constant; the effect strength e per family (slow-rise 1.0,
  putty 0.8, slime 0.7, marshmallow and mochi 0.6, gummy and sticky 0.5, jelly 0.4, water-fill and bead 0.3, firm silicone and dome 0.15): smOmega x
  (1 - 0.18 e T) and memTau x (1 - 0.4 e T). So warm slow-rise is 18 % softer with a memory arm that relaxes in 60 % of the time; cold is the reverse. The
  repo notes the foam's glass transition sits near room temperature (`SQUISHY_SCIENCE.md` section 1, row 1). Measure with the existing recovery probe
  (SQUISHY_SCIENCE.md 3.10).
* **Needs.** A runtime setter that rescales the solver's cached material numbers (today they are fixed at construction; I did not trace every consumer,
  so the physics lane must confirm what can be rescaled live). Tint: a few percent of warm or cool hue; no heat shimmer (no distortion, no flash).
  Words: "warm" and "cool" only, never "hot", "burn" or "freeze".
* **Effort and bytes.** 4 days (2 physics with a 12-family verifier, 1 render, 1 UI); **3 to 5 KB.**
* **What would break it.** A setter that leaves a body in a different state after a round trip (a verifier checks that T = 0 restores the state hash).

### T9. Signature moves and quirks (CO-04 + CO-03)

* **The moment.** Every species has a thing it does when you give it its favourite touch, and every squishy has a little personality. A Twangle does a
  ringing twang when you stretch and let go; a Dollop does a spin-hop when tapped; a Plumpet shivers happily when squeezed.
* **Grammar, not 50 hand-made animations.** 12 family recipes x 3 triggers x a per-species twist x a tier flourish. Triggers come from the catalog's
  signature tag: 19 species on a tap (free, pays 0), 20 on a hold of 0.6 to 2 s released, 11 on a stretched release (level 0.35 or more) [C]. Recipes (all
  scripts over existing hooks): jelly = spring-hop and wobble ring; water-fill = slosh roll; bead = rattle shiver (`tremble`); gummy = three quick chew
  squashes (ghost presses); marshmallow = puff-up (`burstOpen`) and settle; slow-rise = a slow rise with a sigh (`setFrac` 0.9 to 1 over 1.5 s); mochi =
  pat-a-cake side presses; putty = sag and re-form; sticky stretch = a ringing twang (strand); slime = a drip-stretch; firm silicone = a tight double
  bounce; pop dome = a squash and a pop sound (the real snap physics is not built, `catalog.ts` header). Twist: amplitude 0.7 to 1.3 and pitch +-3
  semitones by species index. Tier flourish: 0, 4, 8, 12, 16, 24 sparks from Common to Mythic (x0.3 in Calm).
* **Quirks.** q = hash(seed) mod 6: shy (peeks from behind another squishy), bold (first to bump), sleepy (yawns), silly (hiccups), curious (watches the
  pointer a bit more), tidy (shakes off dust). All six are happy quirks; none is a flaw. Stored: nothing.
* **Effort and bytes.** 8 to 12 days (12 recipes must be tuned on the physics, plus audio); **8 to 18 KB** (the recipes are about 3 KB of data; the
  low end uses the grammar, the high end is 50 bespoke tricks).
* **Economy.** The move itself pays 0; the touches that trigger it pay as they do today. Free-tap species get a joyful reward for something that pays
  nothing, which is the point.
* **What would break it.** Fifty species x tuning cost (start with the 12 family recipes and ship the twists); two species whose tricks look the same
  (the twist and the tier flourish must differ visibly).

### T10. Call tune and everyone looks (CR-06 + SO-05)

* **The moment.** Tap the small bell on a squishy's name plate. A five-key keypad appears (the notes of a pentatonic scale in the music's key); play
  three notes and that is its call. Later, press the bell: every squishy's eyes turn toward you, the called one perks up, turns, hops over and answers
  in its own voice with your three notes. No microphone, ever.
* **Numbers.** 5 keys, 3 notes = 5^3 = 125 tunes (250 with a short or long rhythm) [M]; stored in one byte; a call lasts 0.9 s; the squishy travels with
  `moveTo` (stiffness 0.6) to a point 1.6 radii in front of the camera; the others use "everyone looks": each face's look target switches to the speaker
  (`StageFrameInput.pointerNdc` already steers the eyes, `contracts.ts:289`) and the bodies lean 2 to 3 degrees toward it.
* **Why not the microphone.** Nintendogs' voice matching compared your speech with earlier recordings, wanted the same intonation, and confused similar
  commands [O NWR]; and a child's voice is exactly the data `DESIGN.md:671` says the game never collects. A tune is reliable and silent.
* **Effort and bytes.** UI keypad with a keyboard path and live-region labels 2 days, voice answer and `moveTo` 2, save and polish 1 to 2; 5 to 6 days.
  **4.5 to 7 KB.**
* **What would break it.** `moveTo` fighting a finger on the same body (skip while touched); eight notes of keypad on a 320 px phone (44 px targets:
  five keys fit).

---

## 9. The three that would make the game memorable

The test I used: *could a 10-second screen recording with no caption make a stranger ask what game it is, and could it not be done by a sprite
game?*

1. **The body speaks (T1).** Every pet game has cries; here the cry is made of the toy's own body: it swells with each syllable, bends when you squeeze it,
   squeaks as its air leaves. It answers the owner's voice question with something only a soft body can do, and it is not an imitation of any franchise's
   cry because no mouth, no chip timbre and no name-repeat pattern is used.
2. **Friends feel each other (T2).** In other games friendship is a number. Here two bodies are coupled: poke one and the other shivers a beat later, at
   its own natural rhythm, and a hug squashes them into each other. It makes the pets feel alive to each other, and it costs 3 to 5 KB.
3. **Tilt the tray (T3).** It turns the phone into the toy. Water-filled squishies slosh first, sticky ones cling: the difference between the 12 materials
   becomes something you do with your hand, which is the whole reason this game has 12 materials.

Together with their twins (the squeak-true cries and the hug) they cost **10.5 to 18 KB** (the three alone: 4.5 to 9 KB) [M]. A close fourth is **chorus
in key (T6)**: the mat becomes a band that cannot play a wrong note. If one had to be cut to fit a budget, cut T7 (outfits, 8 to 12 KB), not these.

---

## 10. Build order, bytes, and the gate

**Phases** (the KB are the ranges from the table in section 6, summed by script [M]; the voice core is extra):

| Phase | Contents | Ideas | KB | Cumulative KB |
|---|---|---|---|---|
| A. Free with the voices (no new physics) | voice captions, switch and ceiling (AC-01, 02, 04, 05), seen voices (AC-03), speech pulse (CR-05), everyone looks (SO-05), sway (RH-02), firsts (CO-06), bond hearts (CO-01) | 10 | 9.3-14 | 9.3-14 |
| B. The memorable three and the ghost-finger reactions | sympathetic wobble (SO-02), tilt (PL-04), hiccups (CA-10), sweet spot (CA-05), heartbeat hold (CA-08), squeak-true cries (RH-11) | 6 | 13-21 | 22.3-35 |
| C. Personality and the band | quirks (CO-03), chorus (RH-01), squishy keys (RH-03), call tune (CR-06), nap bed (CA-02), hug (SO-03), nap pile (SO-04), hello bump (SO-07), lullaby (RH-08), break buddy (RH-09) | 10 | 23-34 | 45.3-69 |
| D. Looks and materials (one setter each) | outfits (PL-11), warm and cool (CA-06), signature moves (CO-04), mat swaps (EN-05), Squishday (SE-01) | 5 | 20-38 | 65.3-107 |
| E. Needs the analytic-collider round | bounce house (PL-01), float tray (EN-04), squeeze-through arch (PL-07), ball pit (PL-03), slide (PL-14) | 5 | 35-60 | 100.3-167 |

**Bundle arithmetic [M], against the gate G0 = 1229 KB:**

| Step | Total KB |
|---|---|
| Used today (STATUS.md) | 1143 |
| + UI overhaul (about 90) | 1233 (over the gate by about 4) |
| + phase A | 1242-1247 |
| + phases A-B | 1255-1268 |
| + phases A-C | 1278-1302 |
| + phases A-D | 1298-1340 |
| + phases A-E | 1333-1400 |
| plus a stand-alone voice core (RH-10) | +10-16 |

**The gate has to rise whatever is built** (the UI alone passes it). My recommendation for the owner to consider: **1,500 KB.** That covers the UI, my
phases A to D and a voice core (at most 1,356 KB at the high estimates) with at least 144 KB spare for phase E and the toys and care lenses, and it keeps three.js (the 686 KB stage chunk in the last
measured build) as the dominant cost, so load time stays reasonable. **If the owner keeps 1229 KB,** the headroom is 86 KB; to fit phases A and B at the
high estimate (35 KB) the UI would have to shrink to about 51 KB. Ship phase A (9 to 14 KB) alone if the UI keeps its 90.

**Best value per KB** (idea with K of 4 or more and D of 4 or more, by (D + S) / mid-KB [M]): sway 8.9, everyone looks 8.0, seen voices 8.0, heartbeat hold
7.0, sympathetic wobble 6.7, lullaby mode 4.8, shaker 4.5, speech pulse 4.4, hiccups 4.0, hug 4.0, nap pile 4.0, squishy keys 4.0.

---

## 11. Dark patterns to refuse (20), with the rule that prevents each

[O] = I read the source; [S] = from a search summary; [C] = from this repo's specs.

| # | Pattern | Where it shows up in pet games | Where it could creep into this memo | Our rule |
|---|---|---|---|---|
| 1 | Death, long sickness, abandonment states | Tamagotchi graves and ghosts [S]; Nintendogs dogs that resent absence, growl and ignore their names [O] | any mood or need meter | Nothing worsens because of absence or inaction; the lowest state is "content" (L1). |
| 2 | Real-time clocks that run while you are away | Tamagotchi's own clock [S]; Nintendogs clock [S]; Animal Crossing time gates (`DESIGN.md` 3.1) | Touch garden (EN-02), Squishday (SE-01), sunbeam (EN-06), lamp dial (EN-07) | Growth moves only with interaction in the session; the calendar and clock unlock nothing and change no behaviour. "Follow my clock" is visual only. |
| 3 | Push notifications and nagging | the Tamagotchi revival's alerts [S]; a pet app that sent threats to a nine-year-old [S] | wants (CA-11), break buddy (RH-09) | No push, ever (`DESIGN.md:689`). In-game suggestions are pictures that leave by themselves, at most 4 a session. |
| 4 | Guilt faces, pleading, "your pet feels neglected" messages | the Mall Girl message that a regulator made the company drop [O]; Nintendogs growls [O] | eye emotes (CR-04), wants (CA-11) | The closed emote list has no sad or crying face; a want is a picture with positive affect (L2). |
| 5 | Pay to fix, pay to automate chores, premium currency | the pet that is taken unless a fine is paid in virtual money, with real-money top-ups [O]; pet games that charge to automate feeding [S]; Webkinz premium points [S] | any shop idea | No currency and no purchase path (`DESIGN.md:665`); care props are free and unlimited. |
| 6 | Chore fatigue, grind loops | Finch critics [S]; Amie minigame grinding [O Smogon]; KinzCash [S] | a "care list" | There is no care list; nothing must be done (L5); activities pay no squish points and no item. |
| 7 | Random rewards tied to care or toys | loot-box research [S]; hidden-schedule mementos [S] | treat dispenser (EN-09), outfits (PL-11) | Every care or cosmetic outcome is chosen by the player and shown first; capsule odds stay only in the existing capsule loop. |
| 8 | Streaks and daily login rewards | streaks as "reward loops" in the ICO's 2019 draft [S]; the final standard text I opened does not name them [O] | Firsts (CO-06), Squishday (SE-01), bond (CO-01) | No counters, no "days in a row", a missed day shows nothing (`DESIGN.md:689`). |
| 9 | Scarcity and limited-time items (FOMO) | seasonal events | the seasonal group | Seasonal items are always available; a season only highlights them. |
| 10 | Third-party ads, disguised ads, cross-promotion | a regulator found ads not clearly labelled in a talking-pet app [S]; heavy ads reported [S] | none | No ad slot of any kind; no self-promotion inside a toy. |
| 11 | Celebration inflation, slot-machine sounds | a UK study links daily rewards and celebratory sounds to slot design [S] | Firsts, bond hearts, hello bump | One short quiet reward at most every 8 s, no escalation by repetition, no jackpot cascades (L8). |
| 12 | Social pressure, comparison, gift obligations | Snapchat-style streaks [S]; Webkinz-style visiting | little gifts (SO-10) | No counters, no leaderboards, no "send one back"; SO-10 is excluded until the trading switch exists. |
| 13 | Microphone, camera, face recognition, location | Nintendogs microphone [O]; Amie's camera feature, called unreliable [O]; the Talking Tom family's data sharing [S] | name-calling (CR-06) | No microphone, camera or location (L7); motion sensing is opt-in and local. |
| 14 | Pain or distress sounds from rough play | a talking pet that falls over or groans when poked too hard [S] | tossing, poking, hug | Cries to rough handling are surprise or delight, never pain; no knock-out animation; a human listens to the panel. |
| 15 | Repetition and noise annoyance | a bystander tired of repeated commands in Nintendogs [S]; echo apps [S] | voices (T1) | Voice gate limits (P3) and idle chatter at most one per 20 s. |
| 16 | Hidden requirements and trial-and-error gating | Viva Pinata's hidden conditions [S] | sweet spot, pair bonds | Nothing is required; the spot is found by warm/cool; a pair forms in two clear ways. |
| 17 | Timed minigames with failure | Amie's timed berry drag called stressful [O] | hide and seek (PL-13), pop-it pad (PL-08) | No timers, lives or fail states; every game ends when the player stops. |
| 18 | Hidden decay of bonded stats | Nintendogs love/hate [O] | bond hearts (CO-01) | Bonds only go up (L3); any ephemeral value moves toward neutral and stops. |
| 19 | Nudges: unequal buttons, loaded wording | ICO standard 13 examples [O/S] | break buddy, wants | "Rest" and "Keep playing" have equal size and tone. |
| 20 | Sensory overload: flashing and loud peaks | `DESIGN.md:606-609`; sound-sensitive players [S] | dance floor (PL-12), shaker, drum | The flash budget (at most 2 luminance flashes a second), Calm, and the voice ceiling (AC-02) apply to every new effect. |

---

## 12. Economy check (DESIGN 5.4)

* **No idea adds a way to earn.** None changes `meter.ts`, the pay table, the valve (40 SP a minute) or the daily cap (12 capsules a day from play). No
  simulation is needed because no pay rule changes; if any idea were to pay, `_harness/sim_economy.ts` would have to be re-run with the owner's yes.
* **Ideas that contain a hold or a stretch** pay exactly by the existing rules and nothing more: spa stone (CA-03), heartbeat hold (CA-08), taffy tug
  (PL-05), hug's pinch (SO-03), strokes on the sweet spot (CA-05), jelly theremin (RH-05). Freshness is per touch KIND (`meter.ts:46`), so hugging five
  squishies does not multiply the pay.
* **Free taps stay free:** pop-it pad, jelly drum, squishy keys, signature moves on tap-signature species, curing a hiccup. A tap pays 0 at any speed
  (`DESIGN.md` 5.4), so these cannot be farmed.
* **The one real risk is scripted touches (P1).** A reaction that presses the body through the finger path emits `poke`/`release` events like a real finger.
  A scripted press held 0.4 s or more would pay. Rule: every scripted press lasts at most 0.3 s, is tagged, and is dropped from the meter feed, the
  haptics and `audio.poke`. Test: 1,000 scripted reactions must produce 0.000 SP.
* **Bond hearts, firsts, pairs, outfits, call tunes** never convert to squish points, capsules or items.

---

## 13. How an independent verifier should try to break these

| Slot | Checks (each with a number a script can assert) |
|---|---|
| T1 | Same species and seed give the same cry hash on two runs; 100 pokes in 5 s produce at most the gate's allowance of cries; peak at or under the configured ceiling for all 50 species x 3 moods; one caption per cry; `metrics.volume` stays within 0.97 to 1.03 during option B's pulse; Calm pulse at most 2 %; with voices off, no audio started and the pulse plus glyph still appear; the pairwise distance test over 1,225 pairs. |
| T2 | One poke produces exactly one echo; the echo delay is within 30 ms of the table; no echo triggers an echo; trading one of a pair away leaves the other intact; the save loads with the list absent. |
| T3 | Scripted tilt to 25 degrees: the order in which families start to slide matches atan(mu) order; no NaN; no crease past 120 degrees on any of 50 species in 10 s; nudge below 12 m/s; the permission-denied and no-sensor paths work; the keyboard path works; Calm gain 0.5. |
| T4 | The spot is identical across sessions; no output exists for a distant stroke; meter unchanged compared with the same touch without the feature. |
| T5 | No reaction within 3 s of a touch, in the first 10 s, or more than 6 a session; none during a cut or a pull; Calm has no hop. |
| T6 | Every chorus note is within 200 cents of a chord tone; retune only at a field change; music off gives the fallback scale; at most 5 chorus voices alive. |
| T7 | An accessory stays within 2 px of its anchor in five squash poses; at most +12 draw calls; `probe_genome` pins unchanged; Calm has no follower motion. |
| T8 | Setting T to 0 restores the state hash exactly; all 12 families are stable at T = +1 and -1; recovery time moves in the stated direction. |
| T9 | Each of the 50 moves completes in under 2.5 s with no NaN; 0 SP from any move; two species with the same family differ visibly (screenshot diff above a threshold). |
| T10 | No permission prompt for the microphone or camera anywhere; the keypad works with keyboard and touch and has live-region labels; a call completes with five bodies on the mat. |
| All | Strict CSP intact; bundle within the (new) gate; `tsc` clean; no console error; the full existing shell harness still passes. |

---

## 14. Questions for the owner (genuine product choices), each with my recommendation

1. **The bundle gate.** The UI overhaul alone passes 1229 KB. Raise G0 to **1,500 KB**? (Alternative: shrink the UI to about 51 KB and ship only phases A and B.) *Recommend raising it and keeping the per-feature cost table in section 6 as the budget ledger.*
2. **How do two squishies become best friends?** By a hug held 1.5 s, by sharing a treat, or both? *Recommend both, never by luck or time.* And may a trade ever show a sad message for the one left behind? *Recommend no: an "old pal" chip only.*
3. **Accessories (T7): all 24 free from the start, or each unlocked by trying the matching activity once?** *Recommend all free from the start; a first-time sparkle in Firsts celebrates wearing one. No gating, no randomness.*
4. **May tilt ask for the phone's motion permission (T3)?** On iOS this shows a system prompt. *Recommend yes, opt-in, asked once from a button with a picture, never again if refused; arrows and edge-drag always work.*
5. **Idle chatter.** Should squishies ever speak without being touched? *Recommend rarely (one cry per 20 s per mat at most, never in the first 10 s, off in Quiet room); touch always gets an answer.*
6. **Seasonal content.** Highlight only, or truly time-limited? *Recommend highlight only (section 11, row 9).*
7. **First-run sound question.** One line on the title card: "Sounds: normal, soft, off". *Recommend yes; it is the cheapest sound-sensitivity protection and sets the voice ceiling before any cry plays.*

---

## 15. What I did not do, and the limits of this memo

* I did not run the game, listen to anything, or measure the physics. Every physics number (echo delays, slide angles, volume changes, hop heights) comes
  from tables and formulas in the specs and code comments [M]; the slide thresholds assume the table friction behaves as a Coulomb cone with the family mu
  (`softbody.ts:43`), which a verifier must confirm. Starting values for squeak-true cries, warm and cool, and spring constants are guesses to tune by ear.
* KB figures are estimates: about 30 bytes per line of lean code, calibrated on six modules, +-40 %. I did not write prototype code in the game.
* Scores are one designer's opinion. Delight in particular is a judgement; I held fives to about one in five.
* Evidence: I opened and read six pages (CARU Mall Girl, ICO standard 13, Smogon on Amie, Serebii on Refresh, Nintendo World Report on Nintendogs, Gfinity on
  Nintendogs guilt). The Bulbapedia page returned HTTP 403 and the AV Club page was unreachable, so those claims are search-summary grade [S]. Everything
  else in section 2 is [S]. "Pocket Pets" returned nothing usable; Pou returned only listing pages and I make no claim about it; I found no source for
  procedural voices in Spore and no study that measures guilt notifications in children's pet games.
* The sibling PETS lenses (voices, toys, care, physics) were being written at the same time; at my last look `_handoff/design/` held only the CUT2 memos and a UI reference (no PETS memo yet),
  so I could not align with them. Items that depend on their output say so.
* The ICO's 2019 draft named streaks as reward loops; the final standard-13 text I opened does not. I cite both honestly (section 11, row 8).

---

## 16. Sources

**Opened and read [O]:** [CARU decision on Mall Girl](https://bbbprograms.org/media/newsroom/decisions/caru-recommends-toy-box-apps-modify-advertising-for-mall-girl-app-to-avoid-undue-sales-pressure);
[ICO Children's Code standard 13](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/13-nudge-techniques/);
[Smogon: Enjoying Pokemon-Amie](https://www.smogon.com/smog/issue40/pokemon-amie);
[Serebii: Pokemon Refresh](https://serebii.net/sunmoon/pokemonrefresh.shtml);
[Nintendo World Report: Nintendogs review](https://www.nintendoworldreport.com/review/4394);
[Gfinity: the Nintendogs guilt essay](https://www.gfinityesports.com/article/i-left-my-nintendogs-decades-ago-and-the-guilt-is-eating-me-alive).

**Search-summary grade [S]:** [Mental Floss: Tamagotchi history](https://mentalfloss.com/article/642373/tamagotchi-history);
[Spectator: what happened to Tamagotchis](https://www.spectatornews.com/showcase/2008/10/what-ever-happened-to-tamagotchis/);
[TouchArcade: Tamagotchi L.I.F.E.](https://toucharcade.com/2013/04/05/tamagotchi-l-i-f-e-lets-you-relive-the-iconic-virtual-pets-constant-nagging-with-constant-push-notifications/);
[Bulbapedia: Pokemon-Amie](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon-Amie) (403 to me);
[Daily Collegian: Neko Atsume](https://dailycollegian.com/2016/01/neko-atsume-app-offers-fun-feline-diversion);
[Mechanics of Magic: Neko Atsume](https://mechanicsofmagic.com/?p=16102);
[Viva Pinata Wiki: Garden](https://vivapinata.fandom.com/wiki/Garden);
[My Singing Monsters Wiki: Composer](https://mysingingmonsters.fandom.com/wiki/Monsters/Composer);
[Big Blue Bubble: Composer press](https://www.bigbluebubble.com/my-singing-monsters-composer-press/);
[Common Sense Media: My Talking Tom 2](https://www.commonsensemedia.org/app-reviews/my-talking-tom-2);
[Screenwise: My Talking Tom](https://screenwiseapp.com/media/my-talking-tom-game);
[CARU: Talking Tom Cat 2](https://bbbprograms.org/media/newsroom/decisions/caru-reviews-outfit-7-s-talking-tom-cat-2-app-recommends-modifications);
[CoolMomTech: the cat in the app](https://coolmomtech.com/2010/11/the-cat-in-the-app/);
[Sago Mini letter to parents](https://sagomini.com/article/sago-mini-letter-to-parents/);
[Sago Mini message from the CEO](https://sagomini.com/article/message-from-the-ceo/);
[Cooney Center Q and A with Sago Sago](https://joanganzcooneycenter.org/2014/11/14/qa-with-sago-sagos-jason-krogh/);
[Axios: Toca Boca changes course](https://www.axios.com/2018/11/21/toca-boca-in-app-purchases-toca-life-world);
[Wikipedia: Webkinz](https://en.wikipedia.org/wiki/Webkinz);
[Wharton: Webkinz](https://knowledge.wharton.upenn.edu/?p=6600);
[HabitBox: Finch review](https://habitbox.app/blog/finch-app-review);
[SIIT: Finch](https://siit.co/blog/finch-app-a-virtual-pet-s-impact-on-self-care/39680);
[Frontiers in Behavioral Neuroscience: ASMR](https://www.frontiersin.org/journals/behavioral-neuroscience/articles/10.3389/fnbeh.2021.761621/pdf);
[Discover: oddly satisfying](https://www.discovermagazine.com/why-are-oddly-satisfying-videos-sosatisfying-218);
[Live Science: oddly satisfying](https://www.livescience.com/62091-oddlysatisfying-videos-satisfying.html);
[a slime-simulator app listing](https://apps.apple.com/app/id1584784222);
[Nookipedia: Animalese](https://nookipedia.com/wiki/Animalese);
[Bulbapedia: Cry](https://bulbapedia.bulbagarden.net/wiki/Cry);
[Renoise forum copy of a New Yorker report on procedural creature sounds](https://forum.renoise.com/t/procedural-creature-sounds-simulate-vocal-chords-pharynx-mouth/43691);
[Smithsonian: artificial creatures that sound real](https://www.smithsonianmag.com/smart-news/how-video-game-designers-make-artificial-creatures-sound-real-180955268/);
[Mix: Spore sound](https://www.mixonline.com/sfp/sfp-magical-world-spore-369211);
[PMC: deceptive design patterns in children's games](https://pmc.ncbi.nlm.nih.gov/articles/PMC9206186/);
[WNHub on the Newcastle/Loughborough loot-box report](https://wnhub.io/news/analytics/item-1012);
[Urban Airship guide to bad push messaging](https://mobilemarketingmagazine.com/urban-airship-guide-highlights-bad-push-messaging/);
[itch.io devlog on virtual pets](https://itch.io/devlog/73412/2-on-virtual-pets-part-1-of-2.amp);
[Xbox accessibility guideline 105](https://devdocs.xbox.com/gaming/accessibility/xbox-accessibility-guidelines/105);
[audio accessibility article](https://www.abratabia.com/game-accessibility/audio-accessibility.php);
[SciTePress: deceptive patterns in games](https://scitepress.org/PublishedPapers/2025/133658);
[humphd: on the ethics of virtual endings (Webkinz guidance)](https://blog.humphd.org/vocamus-1333/);
[Minecraft feedback: max volume limit](https://feedback.minecraft.net/hc/en-us/community/posts/30748470150285-Accessibility-Max-Volume-Limit-for-Sound-Sensitive-Players).

**In this repo [C]:** `_handoff/briefs/RESUME.md`, `_handoff/STATUS.md`, `_spec/DESIGN.md`, `_spec/FUN.md`, `_spec/UI.md`, `_spec/LOCK.md`, `_spec/SQUISHY_SCIENCE.md`,
`_spec/SOUND.md`, `src/contracts.ts`, `src/physics/softbody.ts`, `src/data/catalog.ts`, `src/data/materials.ts`, `src/render/face.ts`, `src/audio/music.ts`,
`src/audio/engine.ts`, `src/shell/mat.ts`, `src/shell/xp.ts`, `src/shell/feedback.ts`, `src/core/meter.ts`, `src/core/genome.ts`, `src/ui/toyTray.ts`,
`src/ui/announcer.ts`, `src/ui/names.ts`, `src/input/haptics.ts`.

**My scratch (not part of the game):** the idea data and the generator that built the tables and the numbers marked [M]:
`.../scratchpad/pets/ideas/ideas.mjs`, `gen.mjs`, `phases.mjs`, `top10.mjs`, `calib.mjs` (the byte calibration).

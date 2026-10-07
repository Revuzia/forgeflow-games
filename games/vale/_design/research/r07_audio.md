# R07: Audio Design of Shipped Competitive Lane-Brawlers

Gap-fill pass 2026-10-07: 40 searches, 29 claims verified, 7 corrected, 24 still unverified.

**Project:** VALE (Forgeflow Games), an original browser-based competitive lane-brawler (custom Three.js / WebGL2 client)
**Date:** 2026-10-07
**Primary reference:** League of Legends (LoL) as of 2026. **Secondary:** Dota 2. **Comparisons:** Overwatch (readability by sound), others where noted.

> **How this was gathered (read this first).**
> - **First pass (no search).** The first draft had no web search budget and no page fetches. Its citations [1]-[20] come from sibling reports (r01, r02, r04, r05) and were not re-opened by this report.
> - **Gap-fill pass (2026-10-07, 40 searches).** A second pass ran 40 web searches against the [unverified] items, prioritizing claims that drive Vale's design. Both page fetches it tried (audiogang.org, surrenderat20.net) were blocked by the egress proxy, so every new citation [21]-[58] rests on **search-result snippets and search summaries, not on reading the full page**. Where a snippet was thin or ambiguous, the text says so.
> - **Labels.** **[n]** = cited. **[unverified]** = still not confirmed after the gap-fill pass. *Analysis* = design reasoning, not a claim about any shipped game. **Corrected:** marks a statement the gap-fill pass changed, with what changed.
> - Section 8 lists what is still open.

---

## 0. Summary of the key principles

1. **Audio is a readability system first and a mood system second.** In a top-down competitive game, sound has to tell you what is happening off-screen, who caused it, and how dangerous it is, faster than your eyes can. Mood comes after that. *(Analysis.)* Riot's own sound team describes League's audio the same way: sound should explain how abilities work and must not get in the way of play, and with ten players at once no single "instrument" may drown out the rest [38][39].
2. **Weight follows gameplay importance.** Riot's VFX guide gives every spell an importance rating and keeps the strongest visual treatment (pure white) for ultimates [14][15]. Audio should use the same ladder: auto-attacks are light, basic abilities heavier, ultimates and objective events heaviest. *(Analysis, building on [14][15].)*
3. **Threat beats self beats ally beats ambience.** When the mix is crowded, enemy threats and critical announcements should win. Overwatch's GDC 2016 "play by sound" talk describes exactly this: each other player gets an importance score in the mix, and an enemy who is aiming at you outranks a closer one who is not [44][45].
4. **Music in the match stays in the background and reacts to play.** **Corrected:** the first draft said LoL's main map has no state-driven music. In fact the 2014 Summoner's Rift update shipped new music that Riot said reacts to how far the game has progressed and to where the player's champion is, while staying unobtrusive across long, fight-heavy games [35][36]. Dota 2 uses a more overt dynamic score with laning, battle, Smoke and Roshan cues [26][27], driven by a weighted battle-intensity calculation [29][30]. Both keep music from hiding gameplay cues.
5. **Every gate in the client has a sound signature.** The ready-check sound is the most important sound in the whole client, because the player has only about **12 s** to answer it [1] and missing it hurts the whole lobby [1][2]. Third-party platforms treat this as a solved problem: FACEIT plays match-found and server-ready sounds even when the player is tabbed out or minimized, on by default [55].
6. **The announcer is a scheduled, prioritized queue, not a list of triggers.** Events collide all the time in teamfights. Priority, merging and expiry rules decide what the player actually hears. *(Analysis. LoL's and Dota's internal scheduling rules are still [unverified].)* Dota's scripting API does confirm that announcer lines are scoped: to one player, to a team, or to a team at a map location [31][32].
7. **Pings and comms are audio.** Dota plays different sounds for different ping types, and different sounds again for pings on allied and enemy buildings [9]. Voice lines on the chat wheel are a monetized cosmetic category [10]. *(Facts from r04.)*
8. **One palette, one key, one motif.** A small team gets cohesion by building menu music, match ambience, stingers and UI sounds from one shared set of instruments, one tonal center and one short motif. *(Analysis.)*

---

## 1. Music

### 1.1 Client, login and menu beds

- **LoL** has historically shipped a new animated login screen with its own theme for each season, event or champion launch, and gives players separate toggles for login music and client music [unverified]. *Principle:* the login theme acts as marketing. It is the "what's new" signal before any text loads.
- **Dota 2:** equipping a music pack (see 1.3) changes the main-menu music as well as hero-select and in-match music [28]. Whether the default menu theme changes with each major update is [unverified].
- *Analysis: what a menu bed has to do.*
  - **It must survive hours of looping.** Players sit in menus, parties and queues for a long time. A good bed avoids a strong melodic hook in the loop, since a hook repeated every 60 s gets irritating. It saves the motif for the intro and for transitions.
  - **It must leave room for UI sounds and voice chat.** Keep the bed out of the 1-4 kHz speech band (a gentle EQ dip there) and keep its dynamics flat, so clicks and party voices sit on top.
  - **It must accept interruption.** The queue-pop and ready-check sounds cut into the bed. The bed should duck smoothly, not stop abruptly.
  - **Typical numbers [unverified, practitioner norm]:** 2-4 minute loops built from 8- or 16-bar sections, tempos around 70-100 BPM for ambient beds, sparse percussion or none.

### 1.2 Champion select / draft music

- LoL's draft timers are about 30-40 s per pick or ban turn, depending on version [16][17].
- **Corrected:** the first draft said LoL's champ-select music changes with the draft phase. What the gap-fill pass found is different: the classic Draft Pick theme is described as **one composed track that builds over time**. It opens on a gong-like hit, adds drums and rising strings after about 12 s, adds a repeated-note string layer for urgency around 40 s, enters a pre-chorus around 50 s, and reaches a string-led crescendo around 1:30, which lines up with when champions are typically being locked in [37]. Whether the client also switches music by phase, or adds a final-seconds tick, is still [unverified].
- When a player locks in, LoL plays a lock-in sound plus that champion's short pick voice line [unverified]. *Principle:* the lock-in is a commitment, so it gets a strong "this is final" sound. A personal, character-specific cue then confirms identity to the player and to allies.
- *Analysis: two ways to build the intensity ramp.*
  - **Cheap (LoL-style, per [37]):** one linear track whose arrangement builds over roughly the expected length of the draft. No runtime logic, but it drifts out of sync when a draft runs fast or slow.
  - **Reactive (Vale proposal):** a phase layer (calm texture in bans, more pulse in picks, fullest arrangement in final loadout) plus a timer layer that only the player whose turn it is hears: in the last 5-10 s of their own turn, add a tick or pulse that speeds up, or raise a filter cutoff, so it means "you must act now" and not general noise.
  - **Resolution:** when the draft ends, a short sting leads into the loading screen. That marks the change from "deciding" to "playing."

### 1.3 In-match music: two approaches

| | LoL (Summoner's Rift) | Dota 2 |
|---|---|---|
| Approach | **Corrected:** ambience plus a low-key reactive score. The 2014 map update brought new music meant to react to game progress and to the champion's surroundings, balanced so it does not intrude during long games full of fights; it reached the PBE in November 2014, after the map itself [35][36] | Overt dynamic score that follows game state [26][27][29] |
| States | Exact states and triggers [unverified] | Music-pack file sets confirm: **laning/explore** (several tracks, each split into layers that blend), **battle** (several tracks with start, middle and end parts), **Smoke of Deceit** (with separate end variants), **Roshan** (with an end variant) [26]. Packs also cover main menu, hero select, death and multi-kill moments [28]. Victory, defeat, respawn and pre-game states [unverified] |
| Switching | [unverified] | **Corrected:** the first draft described a binary "battle starts on hero damage" rule. Valve's scripting API shows a **weighted** system instead: battle music comes from a "music calculation" that units can add extra weight to, and a script can set a music status plus a continuous intensity value when automatic battle music is turned off [29][30]. The exact damage/time thresholds are [unverified] |
| Cosmetics | Music varies by mode or event [unverified] | **Music packs** are equipped in a Music slot in the global loadout and replace the default music in menus, hero select and matches; sold in the store and on the Steam Market, many from TI battle passes or artist collaborations [27][28] |

*Analysis: why each works.*
- **LoL's restrained approach** works because its information density is extreme. Skillshot wind-ups, ability voice lines and the announcer fill the soundscape, so the score is kept low and reactive rather than foregrounded [35][38].
- **Dota's overt approach** works because music becomes information. A battle cue tells you that you are in a fight, and a Smoke cue reminds the whole stealthed group of their state. The cost is complexity. Valve's weighting model [29] is the useful lesson: intensity is a number that many sources feed, not an on/off flag.

*Analysis: a state machine you can build.*
1. **Inputs (local player only):** a battle-intensity score fed by weighted sources (Dota-style [29]): hero damage dealt or taken recently, enemy heroes visible nearby, own HP fraction, alive or dead, objective fight nearby. Bosses and enemy heroes add more weight than minions.
2. **States:** `calm` (laning/explore), `tension` (enemies visible, no damage yet), `combat`, `objective`, `dead`, `respawn`.
3. **Hysteresis:** enter `combat` when intensity crosses an upper threshold; leave only after it stays under a lower threshold for about 6-10 s. This stops flapping during poke. *[specific values are a starting guess; tune in playtest]*
4. **Quantize transitions:** switch on the next beat or bar boundary with a short crossfade, or use pre-authored start/end segments (Dota's packs ship explicit start and end pieces for battle, Smoke and Roshan [26]). Exception: `dead` cuts immediately, because death is a hard stop.
5. **Never use music as the only signal.** Every music state change must also have a visual or HUD cue (see section 5).

### 1.4 Match end, post-game

- Both games mark the end of a match with distinct victory and defeat stings tied to the destruction of the final structure. An announcer line and a large banner play with them [unverified].
- *Analysis.*
  - **Victory** resolves to the home key, gets brighter, and is longer (4-8 s).
  - **Defeat** should be dignified, not mocking. Use a minor or suspended resolution that is shorter and quieter. A player who just lost 30 minutes of effort should not be punished by the soundtrack.
  - **Post-game** returns to a calmer version of the menu bed. Progression tick-ups should be audible over it, for example a soft tick rising in pitch to a "landed" accent, as r05 proposes.

---

## 2. Announcer

### 2.1 Event classes

These are the event classes shipped lane-brawlers announce. The table describes the classes and their rules, not anyone's wording.

| Class | Typical events | Scope | Notes |
|---|---|---|---|
| Match flow | Welcome, countdown to first minion wave, minions spawned, victory/defeat | Everyone | LoL's first minion wave now comes at 0:30, so the opening sequence is short (r02) [wording unverified] |
| First kill of the match | First blood | Everyone | LoL restored a +100 g first-blood bonus in 26.1 [5][6], so the event carries economy and not just spectacle. First blood is the first champion kill of the game [42] |
| Personal combat | You killed someone, you died, an ally died, an enemy died | Personal or team | Phrased from the listener's point of view [unverified] |
| Multi-kills | 2 to 5 kills in quick succession | Everyone | Verified for LoL: double through penta, each kill within a few seconds of the last [42]. The 5-kill tier is the rarest |
| Sprees | Kill-streak tiers; ending one | Everyone | Verified for LoL: six tiers, starting at 3 kills without dying and topping out at 8 or more, with no time limit between kills [42]. The claim that the genre's ladder comes from arena-FPS announcers is [unverified]. Do not copy the ladder's wording |
| Shutdown | Killing a player with a bounty | Everyone | In LoL, bounties of **150 g or more** are shown and announced as a shutdown [3][4] |
| Team wipe | All five enemies dead | Everyone | Verified for LoL: an "ace" is scored by killing the last living enemy champion, and the announcement credits the player who scored it [43] |
| Structures | Turret/tower, inhibitor/barracks destroyed; inhibitor respawning; base under attack | Team-relative | "Your" vs "enemy" phrasing [unverified] |
| Objectives | Epic monster slain by your team or the enemy team; buffs | Team-relative | [unverified] |
| Pickups / timers | Rune spawn reminders (Dota) | Personal or team | [unverified] |

**Scope is an engine-level concept in Dota.** Valve's scripting API has separate calls to play an announcer line for one player, for a whole team, and for a team at a map location [31][32]. Vale's announcer API should expose the same three scopes. *(Fact [31][32]; recommendation is analysis.)*

### 2.2 Priority and queueing

How LoL and Dota schedule announcer lines internally is still **[unverified]** after the gap-fill pass. *Analysis:* the following model fits how both behave from the player's side, and it is a sound spec for Vale.

1. **One announcer voice at a time.** Lines never overlap. Every candidate line goes into a priority queue.
2. **Priority bands (highest first):**
   - P0: match end
   - P1: your own death or kill, team wipe, base under attack
   - P2: shutdown, multi-kill, first blood
   - P3: objective taken, structure destroyed
   - P4: sprees, ally or enemy kills not involving you
   - P5: informational timers
3. **Merging:** if a double kill becomes a triple within the window, replace the queued line. Do not play both. (LoL's multi-kill window is "a few seconds" between kills [42], so the merge window must be at least that long.)
4. **Expiry:** each line has a time-to-live, roughly 2-4 s for P3-P5. A stale line is dropped. Hearing "turret destroyed" 8 s late is worse than not hearing it.
5. **Preemption:** only P0-P1 may cut off a line already playing, with a short fade, not a hard stop.
6. **The banner is always shown.** Even when a voice line is merged or dropped, its on-screen banner or kill-feed entry still appears. Sound may be lossy. Text must not be.
7. **Ducking:** while the announcer speaks, duck music and ambience by about 6-9 dB and other SFX by about 2-4 dB. Never duck enemy threat cues (see 4.2).

### 2.3 Voice packs as cosmetics

- **Dota 2** has **announcer packs** that replace the default announcer, including novelty voices such as a Gabe Newell pack added in 2018 [33], and a separate class of **Mega-Kills** announcer items (multi-kill and streak callouts), several of which came from The International battle passes [33][34]. Who in a match hears a player's equipped pack is [unverified]. Chat-wheel voice lines and sound effects are also sold or given as rewards [10]. Viewers of tournament broadcasts can pick from up to six broadcaster audio streams [11].
- **Corrected (nuance added):** **LoL** does not sell announcer packs, but not for lack of trying. Riot planned to release its first announcer packs in fall 2020 and put them on hold because COVID-era constraints made voice-over production hard; it chose to protect voice actors and kept its limited VO capacity for champions and Legendary skins [40]. The gap-fill pass found no evidence that packs launched between 2021 and October 2026 [unverified].
- *Analysis:* audio cosmetics monetize well because they are **heard all match, and some are heard by everyone in the lobby**. The rule that keeps them fair: a cosmetic pack must cover **the complete event set at matching priority and duration**. A pack that is shorter, quieter or less clear than the default would become a competitive disadvantage, or an advantage. The LoL case [40] also shows the real cost: a full announcer set is a large VO job, and every new event class means re-recording every pack.

---

## 3. Sound effects

### 3.1 Impact layering (craft norm [unverified as any studio's documented practice])

A readable hit has three time layers, each with its own job:

| Layer | Time | Job | Typical content |
|---|---|---|---|
| **Transient** | 0-30 ms | "It connected." Sets timing precision | Click, snap, crack; bright high-mid energy |
| **Body** | 30-300 ms | "What it is." Material and caster identity | Pitched or tonal element, whoosh-to-thud, elemental texture |
| **Tail** | 300 ms-2 s | "How big it was." Scale and space | Reverb, debris, low rumble, ringing |

*Analysis: rules that follow from this.*
- **Weight ladder.** Auto-attack: transient plus a short body, no tail. Basic ability: all three layers, moderate tail. Ultimate: all three, plus a sub-bass layer and a pre-cast wind-up the enemy can react to. This matches Riot's VFX approach, where visual weight follows a spell's importance rating [14][15], and Riot's description of champion SFX as a constant trade-off between gameplay clarity and character theme [39].
- **Crits** reuse the auto-attack sound plus an extra transient layer (bright, sharper attack) and a pitch variant, so they read as "the same action, but more."
- **Variation without confusion.** Use round-robin samples (3-5 per sound) and ±1-2 semitone or ±10% random pitch to stop machine-gun repetition. Keep the transient consistent so the timing cue stays reliable.
- **Wind-ups are the most important sound for the enemy.** The tell before a dangerous ability (charge, draw, inhale) must be distinct and loud enough to hear across a teamfight. That is where counterplay lives. The impact matters more to the caster. Overwatch's "Pavlovian response" pillar (players learn to react to a sound before they think) is the same idea [45].

### 3.2 Economy and progress sounds

No shipped-game documentation of LoL's or Dota's gold or shop sounds turned up in the gap-fill pass; this table remains *analysis*, with one craft source noted.

| Event | Function | Design notes (analysis unless cited) |
|---|---|---|
| **Gold earned** (last hit) | Confirms a successful last hit; trains timing | Short, bright, slightly randomized pitch. Play it **only for the local player's own gold**. Last-hitting is a core skill, so the sound is the reward loop. Craft guidance from a sound-library vendor: when a coin cue fails it is usually because it is too bright (reads as harsh, cuts the whole mix) or fires late (feels detached from the pickup) [58]. Fire it on the same frame as the gold number |
| **Minion death** | Background information | Very quiet and voice-limited (see 4.3). Hundreds play per match |
| **Structure hit** | Tells you your structure is under pressure | Heavy and low. Allied-structure-under-attack gets its own warning, rate-limited |
| **Structure destroyed** | Major milestone | Big tail, debris, announcer line. Plating or partial rewards in LoL [r02] each deserve a smaller "chunk" sound |
| **Level up** | Power spike, new rank available | Rising tonal flourish in the game's key, plus VFX |
| **Item purchased** | Confirms a shop transaction | Coin or register family, distinct from the gold-earned sound so the two never get confused. Respond on the click frame, before the server confirms; play a distinct "denied" sound if the server rejects it |
| **Ward placed** | Confirms placement | Soft and local. Enemies hear nothing. Ward destroyed or expired gets a distinct "lost vision" cue |
| **Recall / return-to-base** | Channel; risk of interruption | A charging loop for the ~8 s channel (4 s for LoL's empowered mid-quest recall [7]; Baron's buff also empowers recall [8]), then a "pop" on completion and a broken sound on interruption. Whether enemies can hear it is a design decision (see open questions) |
| **Ping** | Team communication | Each ping type gets its own sound. Dota uses different sounds for pings on allied and enemy buildings [9] |

### 3.3 Client UI sounds and the queue pop

- **The ready check is about 12 s** in LoL, and one player who declines or misses it sends the lobby back to queue [1]. LoL also counts three failed ready checks as one dodge for penalty purposes [2]. That makes the match-found sound **the highest-stakes sound in the product.**
- **Precedent (verified):** FACEIT's Season 9 matchmaking update added distinct sounds for "match found", "server ready" and "match going live", on by default and adjustable in settings, explicitly so players can tab out while queuing; the prompts play from the website or desktop client even when tabbed away or minimized [55].
- In LoL, the client is reported to come to the front and flash the taskbar when a match is found [still unverified].
- *Analysis: why the queue pop must grab attention.*
  1. **The player is probably elsewhere.** They are in another tab, or have audio down for a video.
  2. **Timbre:** wide-band and bright with a sharp attack, so it cuts through other audio and laptop speakers. Make it rhythmic (2-3 pulses) rather than one hit, since repetition is what pulls attention back.
  3. **Loudness:** mix it 3-6 dB hotter than other UI sounds, on its own slider or with a floor that a "mute UI" setting cannot go below. Warn the player in settings if they turn it off.
  4. **Recognizable but not alarming.** Players will hear it thousands of times. It needs to say "go" without causing stress.
  5. **Separate sounds for separate gates** (FACEIT-style [55]): "match found, accept now" and "match starting" are different events and deserve different sounds.
- *Browser specifics for Vale:*
  - **Verified:** Chrome has applied its autoplay policy to the Web Audio API since Chrome 71. An `AudioContext` created before any user gesture starts out `suspended` and must be resumed (or a source started) inside a user gesture [51]. Resume it on the first click in the client (for example, Play), or the queue pop will be silent.
  - **Verified:** Chrome throttles timers in background tabs (a per-tab time budget that kicks in after about 10 s in the background), but tabs that are playing audio or hold an active WebSocket or WebRTC connection are exempt so connections do not time out [52]. So a queued Vale tab with its matchmaking WebSocket open should still receive the message promptly. Play the pop **directly from the WebSocket `onmessage` handler**, not from the render loop. That `requestAnimationFrame` stops in hidden tabs is [unverified] here but widely assumed; the advice holds either way.
  - Add redundant channels: the Notification API (with permission), a flashing `document.title`, and a favicon badge [unverified as to current browser behavior].
- **UI hover/click** (per r05): hover should be barely audible and rate-limited. Press makes its sound on press, not release. Confirm, back, error, tab, reward and timer-urgent each get a distinct sound. Feedback for every input is part of "juice" [12][13].

---

## 4. Mixing

### 4.1 Loudness targets

| Standard | Integrated target | True peak | Notes |
|---|---|---|---|
| EBU R 128 (broadcast) | -23 LUFS | -1 dBTP | European broadcast norm, often borrowed for game cinematics [not re-checked in this pass] |
| ATSC A/85 (US broadcast) | -24 LKFS | — | [not re-checked in this pass] |
| **Sony ASWG-R001** (games, published 2013; background in [22]) | **-24 LUFS ±2 LU** for home console, measured with an ITU-R BS.1770-3 compliant meter [21][23] | see IESD | Microsoft, Nintendo and the IESD later endorsed the same console level [23]. **Corrected:** the first draft put "about -18 LUFS for portable or mobile" inside ASWG-R001. The -18 LUFS figure is Sony's **portable** target (it was set for the PS Vita) [21] |
| **IESD (G.A.N.G.) Mix Reference Levels v03.02** | Console -24 LUFS ±2 LU; **mobile -16 LUFS ±2 LU** [24] | **≤ -1 dBTP** [24] | Measure over **at least 30 minutes of representative gameplay**, not single assets [24]. (Snippet-level only; the PDF fetch was blocked) |
| Practice notes | Runtime master compression can lift a -24 LUFS mix toward -18 or -16 LUFS when the listening environment is noisy [21]; mobile apps commonly land at -16 to -18 LUFS [25] | — | — |

*Analysis for Vale.* Browser players mostly use laptop speakers or headsets, in rooms with other noise, and mix with music and video in other tabs. That is closer to Sony's portable case than to a living-room console. Proposal:
- **Default mix: -18 LUFS integrated ±2 LU**, true peak ≤ -1 dBTP, measured IESD-style over a 30-minute capture of a representative match, with a gentle master limiter.
- **Optional "full dynamics" mode** for headphone players: drop the master gain and limiter toward the -24 LUFS console target, so transients (wind-ups, ults) have more headroom. *(Analysis; test whether players want it.)*
- Normalize every music track and stinger to a fixed loudness so nothing in the menu flow jumps out, apart from the deliberately louder queue pop.
- Ship separate sliders: master, music, SFX, announcer, UI, voice chat and pings (LoL now has built-in team voice [18][19][56]). Separate speech, effects and music controls are also a basic accessibility guideline [49].

### 4.2 Bus structure and priority

*Analysis: a proposed hierarchy* (top wins, lower buses get ducked):

1. **Critical alerts:** ready check, own low-HP warning, base under attack.
2. **Announcer.**
3. **Enemy threat cues:** wind-ups and ult casts aimed at or near you, ganks out of fog.
4. **Own actions:** abilities, hits, gold.
5. **Ally actions.**
6. **Neutral and world:** minions, jungle monsters, structures.
7. **Music and ambience.**

Supporting evidence from shipped games:
- **Overwatch (GDC 2016, "The Elusive Goal: Play by Sound")** [44][45]: the audio team's pillars were hero voice-over, a clear mix, pinpoint positioning, gameplay information and a Pavlovian response. Every other player gets a mix "importance" from how threatening they are: an enemy farther away but aiming at you earns more threat points, and so sits higher in the mix, than a nearer enemy who is looking elsewhere [45]. *For Vale (analysis):* bus 3 should not be a fixed bus but a threat score per enemy (targeting you, ability aimed at you, distance, on-screen size).
- **A 5v5 console MOBA (lead, attribution uncertain):** a search summary of a 2013 Post Magazine issue describes a team that, after long playtesting, set sound priorities by radius and situation (voice-over first, then ability SFX, then music, then announcer, then Foley) and ducked by radius and by how many players were nearby, using Wwise for the first time [57]. The summary named the game as "Predecessor (originally Guardians)", which looks wrong; a follow-up search tied that issue to *Guardians of Middle-earth* (2012). Treat this as a lead to read, not a fact.
- **Ducking:** side-chain each bus from those above it, with fast attack (10-30 ms), medium release (200-500 ms) and modest depth (3-9 dB). Do not use hard muting. *(Analysis; values are starting points.)*
- **Dynamic "HDR" mixing (verified as a technique):** DICE's Frostbite engine introduced HDR audio in *Battlefield: Bad Company*. It maps a wide range of in-world loudness onto a moving "window" of output loudness: the loudest current sounds set the top of the window, and quieter sounds below the window's bottom are attenuated or culled, so "every sound is important, but not at the same time" [47]. Wwise ships an HDR feature built on the same idea [48]. Its use in any MOBA is [unverified]; it suits teamfights in principle.

### 4.3 Voice limits and audio LOD

- *Analysis.* A late-game teamfight can fire hundreds of sound events per second: 10 heroes, waves of minions, projectiles and DoT ticks.
  - **Per-sound instance caps:** for example, at most 3 minion deaths and 2 identical projectile impacts at once. When the cap is hit, steal the quietest or oldest voice.
  - **Global voice budget:** about 32-48 concurrent voices in a browser, ranked by priority × audibility.
  - **Distance LOD:** off-screen sounds beyond a radius drop to a cheaper variant (no tail, mono) or are culled. Priority-1 to 3 events are never culled.
  - **Tick merging:** DoT and aura ticks within 100 ms merge into one event.
- Web Audio builds a node graph for every sound. Pool nodes, reuse `GainNode`/`PannerNode` chains, and avoid creating a `ConvolverNode` per sound. Use one or two shared reverb sends [unverified as perf numbers; profile in Vale].

### 4.4 Spatial audio for a top-down camera

- **The problem:** the camera hovers above and behind the hero, often away from it (free camera). *(Analysis.)*
- **Options:**

| Listener placement | Pros | Cons |
|---|---|---|
| At the camera | Matches what you see. Panning lines up with the screen | Sounds near your hero get quiet when you look away. Height makes everything feel distant |
| On the hero | You always hear your surroundings | Breaks when the camera is unlocked. Sounds on screen pan the wrong way |
| **Hybrid (recommended, analysis)** | Listener at the camera's ground focus point, oriented to the screen (left = left). Distance attenuation uses a flattened 2D distance. Plus a second "awareness" pass for sounds near your hero, so threats near you stay audible even when the camera is elsewhere | More code. Needs a priority rule for which pass wins |

- **Attenuation:** in an RTS-style view, use 2D (x,z) distance, a large inner radius about the size of the screen, and a gentle rolloff. Panning should be moderate (roughly ±60% max), so headphone users do not get hard-panned fatigue. That LoL and Dota attenuate by distance from the camera's view is [unverified]. LoL's 2014 map music does take the champion's location into account [35], which suggests at least some audio is hero-anchored.
- **Fog of war:** sounds from units in fog should be heard only if the design allows it. Leaking sounds from fogged positions is an information leak. *(Analysis; open question.)*

### 4.5 Readability: enemy vs ally

- *Analysis:* the player needs to know **who** cast something before **what** it is.
  - **Enemy versions of key sounds.** **Corrected:** the first draft said Overwatch's enemy ultimate lines are the loudest. What the gap-fill pass confirmed is that Overwatch uses **different ultimate lines for allies and enemies** (for example, one hero's enemy-facing line is the same phrase in a different language), with ally lines generally clearer and encouraging and enemy lines harsher and more warning-like [46]. A loudness difference is [unverified]. VALORANT doing the same is [unverified].
  - **Own-hero sounds** can be closer and drier, mixed for feel. Enemy sounds are mixed for threat.
  - **Allegiance sweeteners:** add a short, consistent "enemy" layer (a darker transient, for example) on every enemy ability wind-up. Players learn it once and recognize it everywhere.
  - **Silhouette by frequency:** give each hero class a home frequency range (heavy brawlers low-mid, mages airy high-mid, marksmen tight transient) so overlapping abilities stay separable.

---

## 5. Accessibility

- LoL ships accessibility options such as a colorblind mode [20]. Audio-specific options in LoL and Dota (subtitles for the announcer, visual sound indicators) are still **[unverified]**. That both games show announcer events as on-screen banners and kill-feed entries, duplicating most announcer audio as text, is [unverified] here.
- **Verified (Game Accessibility Guidelines)** [49]: provide separate volume controls or mutes for effects, speech and background music; make sure no essential information is carried by sound alone, and replicate important supplementary audio information (such as the direction of a threat) in text or visuals; let subtitles or captions be turned on before any sound plays, and caption significant background sounds. The Xbox Accessibility Guidelines' audio items were not checked in this pass [unverified].
- **Verified (Fortnite)** [50]: the "Visualize Sound Effects" setting in the Audio menu draws icons on a color-coded ring around the screen center, showing the direction and type of nearby sounds (footsteps, chests, gunfire and explosions get different colors). It also helps players without headphones and in loud tournament settings.
- *Analysis for Vale:*
  1. **Every announcer line has a banner.** Text, icons and portraits, kept on screen long enough to read (2.5-4 s).
  2. **Every music-state change has a HUD equivalent** (for example, a combat-state border glow on own portrait).
  3. **Off-screen threat indicators** at the screen edge for enemy wind-ups and ults that are audible but off-screen (a top-down cousin of Fortnite's ring [50]).
  4. **A mono mix option** and a **"reduce loud transients" option** (a stronger limiter for players with hearing sensitivity).
  5. **Ready-check redundancy:** sound, notification, tab title and favicon (3.3).
  6. **Subtitle the hero voice lines** that carry gameplay information (for example, "my ult is ready"), and do not subtitle flavor lines. Captions must be available before the first sound plays [49].

---

## 6. Original, cohesive music on a small team

*Analysis, with tool claims marked.*

### 6.1 Make one "sonic DNA" sheet before writing anything

- **Tonal center:** pick one home key or mode (for example, D Dorian) for menus, draft and match ambience. Victory resolves to the tonic. Defeat lands on a suspended or relative minor chord.
- **Motif:** one 4-6 note motif, the game's sonic logo. Use it in:
  - full form for the login and victory sting,
  - fragmented form for the draft lock-in and level-up,
  - two or three notes for the queue pop and the reward tick-up.
- **Palette:** five to eight signature instruments or synth patches, used everywhere. For example, a plucked metallic instrument, a warm pad, low taiko-like drums, an airy flute or whistle, and a granular texture. UI sounds and stings come from the same patches, which is what makes the whole product feel like one game. (Riot's own composers describe building each champion theme from what playing that champion feels like, which then drives instrumentation and tempo [41]; Vale can apply the same question to the game as a whole.)
- **Tempo grid:** one BPM family (for example, 90 BPM with 180 for combat layers), so every layer and stinger lines up at bar boundaries.

### 6.2 Structure: vertical layers plus horizontal stingers

- **Vertical layering:** author each bed as 3-5 synced stems (pad, pulse, percussion, melody, texture) of the same length. Game state fades stems in and out, for example draft phase to phase or match calm to combat. This is the cheapest kind of dynamic music: one composition, several mixes. Dota's laning tracks ship as layered stems in exactly this way [26].
- **Horizontal re-sequencing:** short 4- or 8-bar segments plus transition stingers, chosen at bar boundaries. Use it where the music needs a real change of character (`dead`, victory). Dota's battle, Smoke and Roshan cues ship with separate start and end pieces [26].
- **Loop lengths:** 8 or 16 bars per stem (about 20-45 s at 90 BPM). Use longer, stem-varied cycles for menus, so the full combination repeats rarely.

### 6.3 Browser implementation notes

- Use decoded `AudioBuffer`s with `AudioBufferSourceNode.loop`, scheduled against `AudioContext.currentTime`, for sample-accurate gapless loops and bar-quantized transitions. An `<audio>` element loop can leave audible gaps [unverified].
- **Verified:** MP3 files carry encoder delay and padding (silent samples at the start and end) that a decoder must trim using the LAME/Xing header [54]. Reports indicate Chrome and Firefox trim it when decoding for Web Audio, but Safari has produced audible gaps when looping such MP3s [54]. Do not use MP3 for loops.
- **Corrected:** the first draft recommended Ogg/Opus. Safari was the last major browser that could not decode Opus through Web Audio; per a 2024 engine-vendor report, **WebM Opus** has decoded consistently on macOS and iOS since **Safari 17.4** [53]. Recommendation: WebM/Opus as the primary format, AAC (in MP4) as a fallback for older Safari, WAV only for very short stingers, and test on Safari before locking the pipeline.
- Stream long menu beds, and decode short SFX up front. Lazy-load each hero's SFX bank when that hero appears in the draft.
- Wwise and FMOD both have web or WASM targets [unverified], but a custom Web Audio graph may be enough at Vale's scale (decision in 7c).

### 6.4 Where Blender fits

The team already has Blender. It is not a music tool, but it helps with **sync**: [unverified feature details]
- Use Blender's Video Sequencer to scrub hero animations against draft SFX and confirm that impacts land on contact frames.
- Mark contact or foot-plant frames with timeline markers, and export them (as glTF extras or a JSON sidecar) so the Three.js client fires SFX exactly on those frames. That keeps audio in sync when animation timing changes later.
- Speaker objects can preview rough 3D positioning for menu dioramas.

Use a DAW (any free or low-cost one) for music and SFX authoring.

---

## 7. Implications for Vale

### (a) Principles and systems worth adopting, in original form

1. **Audio weight ladder tied to gameplay importance:** auto-attack < ability < ultimate < objective < match end, sharing the importance ratings used for VFX [14][15], and judged against Riot's test that sound must clarify play, never distract from it [38][39].
2. **Threat-scored enemy cues as the top gameplay sound.** Score each enemy by threat to the local player (targeting you, ability aimed at you, distance), Overwatch-style [44][45], and mix their wind-ups by that score. Add a shared "enemy" sweetener layer, and use distinct ally and enemy versions of ultimate cues [46].
3. **Announcer as a priority queue** with merging, expiry and preemption (2.2), **three scopes** (player, team, team-at-location, as in Dota's API [31][32]), and **a banner for every line**.
4. **Clear event classes:** first takedown (with its economy bonus, LoL-style [5][6]), multi-takedowns (merge window at least as long as the multi-kill window), streak tiers, bounty-ending kills (announce at a visible threshold, as LoL does at 150 g [3]), team wipe [43], structures, objectives, match end. Write original names and wording.
5. **Ambience-first match with a reactive music layer.** Both reference games have one: LoL's is restrained and reacts to game progress and location [35]; Dota's is overt and weighted [26][29]. Vale: `calm`, `tension`, `combat`, `objective` and `dead` states driven by a **weighted intensity score**, with hysteresis, bar-quantized changes, authored start/end segments and a HUD cue for each state.
6. **Draft music.** Ship the cheap version first (one composed track whose arrangement builds over the expected draft length, as LoL's Draft Pick theme does [37]), then add a per-player urgency layer on the local player's own turn timer.
7. **Queue pop as a critical system:** louder, multi-pulse, played from the WebSocket handler (Chrome exempts tabs with open WebSockets from background timer throttling [52]), with the `AudioContext` resumed on the first click (autoplay policy [51]), plus Notification, tab-title and favicon redundancy. Use separate sounds for "match found" and "match starting", as FACEIT does [55]. LoL's ready check is about 12 s [1].
8. **Bus hierarchy and ducking** (4.2), **voice budgets and audio LOD** (4.3), and **hybrid listener placement** (4.4). Consider an HDR-style loudness window for teamfights [47][48].
9. **Loudness spec:** **-18 LUFS integrated ±2 LU** (Sony's portable target [21], a fit for laptop/headset browser play), true peak ≤ -1 dBTP, measured over ≥30 minutes of representative match capture (IESD method [24]); optional "full dynamics" mode near the -24 LUFS console target [21][23]. Normalized music; separate sliders for each category, including voice chat [18][56] and a separate speech slider for accessibility [49].
10. **Distinct ping sounds per ping type and target,** following Dota's allied-vs-enemy building distinction [9].
11. **Audio cosmetics** (announcer packs, Mega-Kills-style callout packs, music packs, chat-wheel lines) as a later monetization track, with a parity rule: same event coverage, priority and clarity as the default [10][27][34]. Budget for VO cost honestly: Riot shelved LoL's announcer packs partly over VO production limits [40].
12. **One sonic-DNA sheet:** key, motif, palette and tempo grid, shared by menu bed, draft, match ambience, stings and UI sounds. Author match music as layered stems plus start/end segments [26].
13. **Accessibility baseline from the Game Accessibility Guidelines** [49]: no essential information by sound alone, separate speech/effects/music volumes, captions available before the first sound, plus an off-screen threat indicator inspired by Fortnite's sound visualizer [50].
14. **Audio formats:** WebM/Opus primary, AAC fallback, no MP3 for loops; test Safari ≥17.4 [53][54].

### (b) Protected expression that must NOT be copied

- Any **recordings or samples** from LoL, Dota 2 or other titles: music, SFX, UI sounds, the match-found sound, ping sounds, announcer voices.
- **Announcer wording and delivery** that identifies a specific game: LoL's or Dota's exact line set and phrasing, including LoL's spree-tier names and multi-kill names, and the inherited arena-shooter spree ladder words. Vale's event classes and tier counts can match the genre, but the words, voice casting and delivery must be original.
- **Melodies, motifs, chord progressions and arrangements** of any game's login, champ-select, victory or defeat themes. This includes the specific build structure of LoL's Draft Pick theme (gong opening, string build, guitar-punctuated pre-chorus) [37]: borrow the *idea* of a timed build, not the arrangement. Also do not write "sound-alike" tracks to a reference temp track; compose from Vale's own DNA sheet.
- **Character voice lines,** pick or lock-in quotes and ultimate callouts of any existing champion or hero, including Overwatch's ally/enemy line pairs.
- **Names** of the reference games' announcer packs, music packs, item slots (for example "Mega-Kills") and modes.

### (c) Open questions

1. **How much dynamic music in the match?** Both reference games use reactive music, so it is genre-standard [35][26]. Ship ambience plus a restrained two-state layer (calm/combat) first, then add `tension`/`objective`?
2. **Recall audibility:** can enemies hear a recall channel nearby (a counterplay cue), or only the recalling team?
3. **Sound in fog of war:** do sounds from fogged units play? If they do, it leaks information; if they don't, the world feels dead. Possible middle ground: muffled, direction-only cues for big ultimates.
4. **Middleware:** a custom Web Audio graph, or a Wwise/FMOD web build (licensing, bundle size, WASM start-up cost)? Wwise's HDR feature [48] is one argument for middleware.
5. **Announcer voice:** record a human actor (cost, consistency, re-records for new events), or build a modular system that stitches lines from parts? LoL's shelved packs [40] show the re-record cost compounds once cosmetic packs exist.
6. **Loudness target:** -18 LUFS default is now grounded in Sony's portable target [21]; still measure browser competitors and test the "full dynamics" mode with headphone players.
7. **Mobile and laptop speakers:** do we need a "small speakers" mix preset (less sub-bass, more upper-mid)?
8. **Blender export:** which path carries animation markers into the client: glTF extras, a sidecar JSON, or naming conventions?
9. **Asset budget:** total audio download size in the first session, and how much can be lazy-loaded per hero.
10. **Threat scoring inputs:** which signals does the sim expose cheaply enough for an Overwatch-style per-enemy threat score [45]?

---

## 8. Still open after the gap-fill pass

The gap-fill pass closed most of the first draft's search list (Dota music system, ASWG/IESD numbers, Overwatch GDC talk, accessibility guidelines, Fortnite visualizer, autoplay and throttling, Opus/MP3 in Safari, LoL announcer packs, LoL multi-kill/spree/ace rules, LoL Rift music). These items remain [unverified] (24):

1. LoL login-screen themes per season/event and separate login/client music toggles.
2. Whether Dota's default menu theme changes with major updates (packs changing it is verified [28]).
3. LoL lock-in sound and champion pick voice line in champ select.
4. Whether LoL's champ-select music switches by phase or adds a final-seconds tick (only the linear Draft Pick build is verified [37]).
5. LoL queue pop: focus stealing, taskbar flash, minimized behavior.
6. Victory and defeat stings tied to the final structure in both games.
7. LoL and Dota announcer queueing internals (priority, merging, expiry).
8. Listener-perspective phrasing of personal kill/death lines.
9. Team-relative phrasing for structures and objectives.
10. Dota rune-spawn announcer reminders.
11. The arena-FPS origin of the spree ladder.
12. Three-layer impact structure as any studio's documented practice.
13. VALORANT ally/enemy ultimate lines.
14. Camera-based distance attenuation in LoL and Dota.
15. LoL and Dota audio accessibility options (subtitles, visual sound cues) and banner/kill-feed duplication of announcer lines.
16. EBU R 128 and ATSC A/85 values (not re-checked).
17. `requestAnimationFrame` pausing in hidden tabs; current Notification API behavior.
18. Wwise and FMOD web/WASM targets.
19. Blender Video Sequencer scrubbing, marker export to glTF, Speaker objects.
20. Who in a Dota match hears a player's announcer or Mega-Kills pack.
21. LoL Rift music's exact states and triggers (the reactive design is verified [35]).
22. Dota victory, defeat, respawn and pre-game music states.
23. Whether LoL announcer packs launched at any point 2021-2026.
24. Which game the Post Magazine priority/ducking description [57] actually covers.

Suggested next searches: Dota 2 wiki "Music" page via a mirror; LoL wiki "Announcer" (full line list and conditions); GDC Vault for Riot or Valve audio sessions 2015-2026; Xbox Accessibility Guidelines 105-106 (audio); Wwise/FMOD web export docs; Blender 4.x manual on markers and Speaker objects.

---

## Sources

**[1]-[20]:** seen in search results by sibling research agents in this run and cited in their reports; not re-opened by this report. The report each came from is in brackets.
**[21]-[58]:** found by this report's gap-fill pass (2026-10-07). All are based on search-result snippets or search summaries; no full page was read (fetches were blocked). What each supports is in brackets.

1. https://wiki.leagueoflegends.com/en-us/Queuing_and_Matchmaking [r05 #22: ready check about 12 s; a decline or miss sends the lobby back to queue]
2. https://www.leagueoflegends.com/en-us/news/dev/dev-tackling-queue-dodging/ [r01 #26: three failed ready checks count as one dodge]
3. https://wiki.leagueoflegends.com/en-us/Champion_gold_bounties [r02 #32: bounty shown at 150 g or more and announced as a shutdown]
4. https://lol.fandom.com/wiki/Patch_14.21 [r02 #33: gold-based bounty system]
5. https://www.sportskeeda.com/esports/league-legends-patch-26-1-notes [r02 #20: +100 g first-blood bonus restored]
6. https://wiki.leagueoflegends.com/en-us/V26.01 [r02 #21: patch 26.1]
7. https://www.altchar.com/game-news/league-of-legends-2026-new-role-quests-explained-am4h80I7pPyE [r02 #11: recall about 8 s; empowered mid-quest recall 4 s]
8. https://wiki.leagueoflegends.com/en-us/Baron_Nashor [r02 #40: Baron buff includes an empowered recall]
9. https://dota2.fandom.com/wiki/Ping [r04 #32: different ping sounds by ping type and for allied vs enemy buildings]
10. https://hawk.live/posts/dota-2-chat-wheel-guide [r04 #33: chat-wheel voice lines and sounds are paid or reward content]
11. https://liquipedia.net/dota2/Spectating [r04 #66: up to six broadcaster audio streams]
12. https://www.gamedeveloper.com/design/oil-it-or-spoil-it- [r05 #56: juice as constant feedback through sound and motion]
13. https://school.gdquest.com/glossary/juicing [r05 #57: juice definition]
14. https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/ [r04 #60: VFX goals of clarity and minimal clutter]
15. https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf [r04 #61: spell importance rating; white reserved for ultimates]
16. https://wiki.leagueoflegends.com/en-us/Draft_Pick [r05 #17: draft turn timers]
17. https://mein-mmo.de/en/lol-pick-rank,133513/ [r05 #18: draft turn timers of about 30-40 s]
18. https://www.leagueoflegends.com/en-us/news/dev/tldw-team-voice-classic-more-dev-update/ [r01 #58: built-in team voice]
19. https://accountshark.net/blog/lol-team-voice-chat-patch-26-20-guide [r01 #59: team voice in patch 26.20]
20. https://support.riotgames.com/en-us/league-of-legends/gameplay/colorblind-mode [r04 #54: LoL colorblind mode]
21. https://designingsound.org/2013/02/loudness-in-game-audio/ [ASWG-R001 published 2013, adopts -24 LUFS for console; Sony's -18 LUFS portable/Vita target; runtime compression toward -18/-16 LUFS in noisy settings]
22. https://designingsound.org/2012/07/30/video-games-and-loudness-standards-interview-with-sonys-garry-taylor/ [background interview on Sony's loudness standards work]
23. https://fast-and-wide.com/blog/46-blog/3716-sound-design-level-up [console titles normalized to -24 LUFS ±2 LU, measured per ITU-R BS.1770-3; Microsoft, Nintendo and IESD agreed]
24. https://www.audiogang.org/wp-content/uploads/2015/04/IESD-Mix-Ref-Levels-v03.02.pdf [IESD: console -24 LUFS ±2, mobile -16 LUFS ±2, true peak ≤ -1 dBTP, measure ≥30 min of representative gameplay; snippets only, fetch blocked]
25. https://audiomediainternational.com/mobile-loudness-an-adaptive-approach/ [mobile games commonly target -16 to -18 LUFS]
26. https://steamcommunity.com/sharedfiles/filedetails/changelog/376475494 [Dota 2 music-pack file set: layered laning tracks, battle tracks with start/middle/end, Smoke with end variants, Roshan with end variant]
27. https://liquipedia.net/dota2/AWOLNATION_-_Magic_Sticks_of_Dynamite_Music_Pack [Dota 2 music packs as cosmetic items, including artist collaborations]
28. https://gamersdecide.com/articles/dota-2-best-music-packs [music packs equipped in the Music slot; replace main-menu, hero-select and battle music; include death and multi-kill sounds]
29. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/CDOTA_BaseNPC.SetAdditionalBattleMusicWeight [units add weight to the battle-music calculation]
30. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/CDOTAPlayer.SetMusicStatus [script sets music status plus intensity; applies when automatic battle music is disabled]
31. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/Global.EmitAnnouncerSoundForPlayer [announcer line scoped to one player]
32. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/Global.EmitAnnouncerSoundForTeam [announcer line scoped to a team; a sibling call scopes to a team at a location]
33. https://www.gameinformer.com/2018/08/22/gabe-newell-announcer-lines-added-to-dota-2-he-believes-in-you [Gabe Newell announcer lines in Dota 2, 2018; Mega-Kills pack via TI battle pass]
34. https://liquipedia.net/dota2/Mega-Kills:_Juggernaut [Mega-Kills announcer items as a separate cosmetic class]
35. https://www.surrenderat20.net/2014/10/red-post-collection-preseason-2015_31.html [Riot: updated Summoner's Rift music reacts to game progress and the champion's environment, balanced to stay unintrusive; music to follow the map launch]
36. https://www.surrenderat20.net/2014/11/1119-pbe-update.html [new Summoner's Rift music on PBE, November 2014]
37. https://www.oneesports.gg/league-of-legends/best-song-riot-games-music [description of the classic Draft Pick theme's timed build and crescendo near lock-in]
38. https://nexus.leagueoflegends.com/en-us/2019/11/giants-pop-stars-making-music-with-sound-design/ [Riot: sound should explain abilities and not distract from gameplay; with up to ten players, no single element may overpower the rest]
39. https://nexus.leagueoflegends.com/en-us/2018/07/the-stories-behind-leagues-sfx [Riot: champion SFX balance gameplay clarity against character theme; snippet-level]
40. https://www.gosugamers.net/lol/news/52049-league-of-legends-announcer-packs-are-on-hold-for-now [LoL announcer packs planned for fall 2020, put on hold over COVID-era VO production constraints]
41. https://riotgames.com/en/news/creating-champion-themes-riot-games-music [Riot composers derive champion themes from how the champion feels to play; informs instrumentation and tempo]
42. https://afkgaming.com/esports/guide/kill-streaks-in-league-of-legends-explained [LoL first blood; multi-kills within a few seconds; spree tiers from 3 to 8+ kills without dying, no time limit]
43. https://wiki.leagueoflegends.com/en-us/Ace [LoL ace: killing the last living enemy champion; announcement credits the scorer]
44. https://gdcvault.com/play/1023010/Overwatch-The-Elusive-Goal-Play [Overwatch GDC 2016 audio talk, "The Elusive Goal: Play by Sound"]
45. https://pcgamesn.com/overwatch/overwatch-devs-on-creating-a-game-you-can-play-by-sound-and-announcing-dolby-atmos-support [Overwatch: five audio pillars; per-player mix importance from threat ("threat points")]
46. https://gamertweak.com/ultimate-voice-lines-ow-2/ [Overwatch: different ultimate lines for allies and enemies; ally lines clearer, enemy lines harsher]
47. https://www.ea.com/frostbite/news/how-hdr-audio-makes-battlefield-bad-company-go-boom [DICE/Frostbite HDR audio: sliding loudness window, loudest sounds win]
48. https://designingsound.org/2013/06/finding-your-way-with-high-dynamic-range-audio-in-wwise/ [HDR audio feature in Wwise]
49. https://gameaccessibilityguidelines.com/intermediate/ and https://gameaccessibilityguidelines.com/?p=21 [separate volume controls for effects, speech and music; no essential information by sound alone; captions available before any sound]
50. https://www.gamespot.com/articles/how-to-use-visualize-audio-effects-in-fortnite/1100-6498314/ [Fortnite "Visualize Sound Effects": directional, color-coded sound icons]
51. https://developer.chrome.com/blog/autoplay [Web Audio covered by Chrome's autoplay policy since Chrome 71; resume AudioContext after a user gesture]
52. https://www.androidpolice.com/2017/03/14/google-introduces-background-tab-throttling-chrome-57-desktop/ [Chrome background-tab timer budget; tabs playing audio or with WebSocket/WebRTC connections exempt]
53. https://construct.net/en/blogs/construct-official-blog-1/opus-audio-construct-891 [Safari could not decode Opus via Web Audio; WebM Opus consistent on macOS and iOS from Safari 17.4]
54. https://hydrogenaudio.org/index.php?msg=729580 and https://bugs.webkit.org/show_bug.cgi?id=228215 [MP3 encoder delay/padding trimmed via LAME/Xing header; reports of audible gaps when looping MP3 in Safari Web Audio (exact bug ID not confirmed)]
55. https://support.faceit.com/hc/en-us/articles/28929321212188-Season-9-Queue-Alerts-Update-FAQ [FACEIT: sounds for match found, server ready and match live; on by default; play while tabbed out or minimized]
56. https://rdy.gg/en/lol/news/lol-dev-update-september-2026 [September 2026 LoL dev update gives the Team Voice release date]
57. https://digital.copcomm.com/i/115625/37 [Post Magazine, 2013 issue: a 5v5 console MOBA's priority-by-radius ducking scheme; game attribution uncertain, likely Guardians of Middle-earth]
58. https://morphic.com/resources/sounds/coin-sound-effects [vendor craft guidance: coin cues fail by being too bright or firing late]

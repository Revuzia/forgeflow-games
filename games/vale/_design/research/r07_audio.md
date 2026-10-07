# R07: Audio Design of Shipped Competitive Lane-Brawlers

**Project:** VALE (Forgeflow Games), an original browser-based competitive lane-brawler (custom Three.js / WebGL2 client)
**Date:** 2026-10-07
**Primary reference:** League of Legends (LoL) as of 2026. **Secondary:** Dota 2. **Comparisons:** Overwatch (readability by sound), others where noted.

> **How this was gathered (read this first).** This report had **no web search budget**. The shared per-turn search budget (200 calls, shared by every agent in the run) was already used up before this agent's first query, so all four opening searches came back unexecuted. Direct page fetches were also blocked by the network egress proxy on every domain tried (dota2.fandom.com, en.wikipedia.org, developer.mozilla.org). Because of that:
> - **Cited claims [n]** come only from facts that sibling research reports (r01, r02, r04, r05 in this folder) confirmed through search results in this run. Their URLs are listed in Sources, with the report each came from. I did not re-check them myself.
> - **[unverified]** marks claims about how shipped games sound or behave, and about standards or tools, that come from general practitioner knowledge and that I could not confirm. Treat them as hypotheses until someone checks them.
> - *Analysis* marks my own design reasoning. It is not a claim about any shipped game.
> - Section 8 lists the exact searches to run in a follow-up pass to close these gaps before the audio spec is locked.

---

## 0. Summary of the key principles

1. **Audio is a readability system first and a mood system second.** In a top-down competitive game, sound has to tell you what is happening off-screen, who caused it, and how dangerous it is, faster than your eyes can. Mood comes after that. *(Analysis.)*
2. **Weight follows gameplay importance.** Riot's VFX guide gives every spell an importance rating and keeps the strongest visual treatment (pure white) for ultimates [14][15]. Audio should use the same ladder: auto-attacks are light, basic abilities heavier, ultimates and objective events heaviest. *(Analysis, building on [14][15].)*
3. **Threat beats self beats ally beats ambience.** When the mix is crowded, enemy threats and critical announcements should win. Decorative layers should drop first. *(Analysis. Overwatch's public talk on this is listed in section 8 [unverified].)*
4. **The match is mostly unscored on purpose.** LoL's main map relies mainly on ambience and event stings rather than a constant soundtrack [unverified]. Dota 2 uses a state-driven dynamic score [unverified]. Both approaches keep music from hiding gameplay cues.
5. **Every gate in the client has a sound signature.** The ready-check sound is the most important sound in the whole client, because the player has only about **12 s** to answer it [1] and missing it hurts the whole lobby [1][2].
6. **The announcer is a scheduled, prioritized queue, not a list of triggers.** Events collide all the time in teamfights. Priority, merging and expiry rules decide what the player actually hears. *(Analysis. LoL's exact rules are [unverified].)*
7. **Pings and comms are audio.** Dota plays different sounds for different ping types, and different sounds again for pings on allied and enemy buildings [9]. Voice lines on the chat wheel are a monetized cosmetic category [10]. *(Facts from r04.)*
8. **One palette, one key, one motif.** A small team gets cohesion by building menu music, match ambience, stingers and UI sounds from one shared set of instruments, one tonal center and one short motif. *(Analysis.)*

---

## 1. Music

### 1.1 Client, login and menu beds

- **LoL** has historically shipped a new animated login screen with its own theme for each season, event or champion launch, and gives players separate toggles for login music and client music [unverified]. *Principle:* the login theme acts as marketing. It is the "what's new" signal before any text loads.
- **Dota 2** plays a main-menu theme that changes with major updates and events. Music packs (see 1.3) can also change menu music [unverified].
- *Analysis: what a menu bed has to do.*
  - **It must survive hours of looping.** Players sit in menus, parties and queues for a long time. A good bed avoids a strong melodic hook in the loop, since a hook repeated every 60 s gets irritating. It saves the motif for the intro and for transitions.
  - **It must leave room for UI sounds and voice chat.** Keep the bed out of the 1-4 kHz speech band (a gentle EQ dip there) and keep its dynamics flat, so clicks and party voices sit on top.
  - **It must accept interruption.** The queue-pop and ready-check sounds cut into the bed. The bed should duck smoothly, not stop abruptly.
  - **Typical numbers [unverified, practitioner norm]:** 2-4 minute loops built from 8- or 16-bar sections, tempos around 70-100 BPM for ambient beds, sparse percussion or none.

### 1.2 Champion select / draft music

- LoL's draft timers are about 30-40 s per pick or ban turn, depending on version [16][17]. Over the years, LoL's champ-select music has been described as changing with the phase (bans, picks, finalization), with tension rising and a ticking or pulse layer in the final seconds of a timer [unverified].
- When a player locks in, LoL plays a lock-in sound plus that champion's short pick voice line [unverified]. *Principle:* the lock-in is a commitment, so it gets a strong "this is final" sound. A personal, character-specific cue then confirms identity to the player and to allies.
- *Analysis: the intensity ramp.* A draft is a sequence of countdowns. Music can track them in two layers:
  - **Phase layer (slow):** a calmer texture during bans, more pulse during picks, the fullest arrangement during the final loadout phase.
  - **Timer layer (fast):** in the last 5-10 s of the local player's own turn, add a tick or pulse that speeds up, or raise a filter cutoff. It should apply only to the player whose turn it is, so it means "you must act now" and not general noise.
  - **Resolution:** when the draft ends, a short sting leads into the loading screen. That marks the change from "deciding" to "playing."

### 1.3 In-match music: two schools

| | LoL (Summoner's Rift) | Dota 2 |
|---|---|---|
| Approach | Mostly ambience and event stings. Some music at match start and in special modes. No continuous soundtrack in normal play [unverified] | Dynamic score that follows game state [unverified] |
| States | Not state-driven in normal play [unverified] | Commonly described states: hero select, strategy/pre-game, laning/explore, battle, Roshan fight, smoke (stealth), death, respawn, victory, defeat [unverified] |
| Switching | n/a | A battle cue starts when the local hero is fighting (dealing or taking hero damage) and falls back to explore after a quiet period. Death cuts to a death cue. Smoke of Deceit gets its own sneaking cue [unverified] |
| Cosmetics | Music varies by mode or event [unverified] | **Music packs** are equippable cosmetics that replace the whole state set [unverified] |

*Analysis: why each works.*
- **LoL's minimal approach** works because its information density is extreme. Skillshot wind-ups, ability voice lines and the announcer fill the soundscape, and a constant score would mask them. Ambience (wind, birds, river, distant jungle creatures) gives a sense of place without competing with cues.
- **Dota's dynamic approach** works because music becomes information. A battle cue tells you that you are in a fight, and a smoke cue reminds the whole stealthed group of their state. The cost is complexity. Thresholds need hysteresis, so music does not flap between states during poke trades.

*Analysis: a state machine you can build.*
1. **Inputs (local player only):** hero damage dealt or taken in the last N seconds, number of enemy heroes visible near you, own HP fraction, alive or dead, objective fight nearby.
2. **States:** `calm` (laning/explore), `tension` (enemies visible, no damage yet), `combat`, `objective`, `dead`, `respawn`.
3. **Hysteresis:** enter `combat` on the first hero damage. Leave it only after about 6-10 s with no hero damage. This stops flapping during poke. *[unverified as specific values]*
4. **Quantize transitions:** switch on the next beat or bar boundary with a short crossfade, or use pre-authored transition stingers. Exception: `dead` cuts immediately, because death is a hard stop.
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

These are the event classes shipped lane-brawlers announce. The table describes the classes, not anyone's wording.

| Class | Typical events | Scope | Notes |
|---|---|---|---|
| Match flow | Welcome, countdown to first minion wave, minions spawned, victory/defeat | Everyone | LoL's first minion wave now comes at 0:30, so the opening sequence is short (r02) [unverified wording] |
| First kill of the match | First blood | Everyone | LoL restored a +100 g first-blood bonus in 26.1 [5][6], so the event carries economy and not just spectacle |
| Personal combat | You killed someone, you died, an ally died, an enemy died | Personal or team | Phrased from the listener's point of view [unverified] |
| Multi-kills | 2 to 5 kills within a short window | Everyone | 5-kill events are the rarest, biggest moments [unverified wording] |
| Sprees | Kill streak tiers; ending one | Everyone | The genre's spree ladder comes from arena-FPS announcers [unverified]. Do not copy the ladder's wording |
| Shutdown | Killing a player with a bounty | Everyone | In LoL, bounties of **150 g or more** are shown and announced as a shutdown [3][4] |
| Team wipe | All five enemies dead | Everyone | [unverified wording] |
| Structures | Turret/tower, inhibitor/barracks destroyed; inhibitor respawning; base under attack | Team-relative | "Your" vs "enemy" phrasing [unverified] |
| Objectives | Epic monster slain by your team or the enemy team; buffs | Team-relative | [unverified] |
| Pickups / timers | Rune spawn reminders (Dota) | Personal | [unverified] |

### 2.2 Priority and queueing

How LoL and Dota schedule announcer lines internally is **[unverified]**. *Analysis:* the following model fits how both behave from the player's side, and it is a sound spec for Vale.

1. **One announcer voice at a time.** Lines never overlap. Every candidate line goes into a priority queue.
2. **Priority bands (highest first):**
   - P0: match end
   - P1: your own death or kill, team wipe, base under attack
   - P2: shutdown, multi-kill, first blood
   - P3: objective taken, structure destroyed
   - P4: sprees, ally or enemy kills not involving you
   - P5: informational timers
3. **Merging:** if a double kill becomes a triple within the window, replace the queued line. Do not play both.
4. **Expiry:** each line has a time-to-live, roughly 2-4 s for P3-P5. A stale line is dropped. Hearing "turret destroyed" 8 s late is worse than not hearing it.
5. **Preemption:** only P0-P1 may cut off a line already playing, with a short fade, not a hard stop.
6. **The banner is always shown.** Even when a voice line is merged or dropped, its on-screen banner or kill-feed entry still appears. Sound may be lossy. Text must not be.
7. **Ducking:** while the announcer speaks, duck music and ambience by about 6-9 dB and other SFX by about 2-4 dB. Never duck enemy threat cues (see 4.2).

### 2.3 Voice packs as cosmetics

- **Dota 2** sells or rewards **announcer packs** that replace the default announcer, plus a separate class of multi-kill announcer items. Many are themed or crossover voices [unverified]. Chat-wheel voice lines and sound effects are also sold or given as rewards [10]. Viewers of tournament broadcasts can pick from up to six broadcaster audio streams [11].
- **LoL** generally ships one default announcer per map or mode and does not sell announcer packs [unverified].
- *Analysis:* audio cosmetics monetize well because they are **heard all match, and some are heard by everyone in the lobby**. The rule that keeps them fair: a cosmetic pack must cover **the complete event set at matching priority and duration**. A pack that is shorter, quieter or less clear than the default would become a competitive disadvantage, or an advantage.

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
- **Weight ladder.** Auto-attack: transient plus a short body, no tail. Basic ability: all three layers, moderate tail. Ultimate: all three, plus a sub-bass layer and a pre-cast wind-up the enemy can react to. This matches Riot's VFX approach, where visual weight follows a spell's importance rating [14][15].
- **Crits** reuse the auto-attack sound plus an extra transient layer (bright, sharper attack) and a pitch variant, so they read as "the same action, but more."
- **Variation without confusion.** Use round-robin samples (3-5 per sound) and ±1-2 semitone or ±10% random pitch to stop machine-gun repetition. Keep the transient consistent so the timing cue stays reliable.
- **Wind-ups are the most important sound for the enemy.** The tell before a dangerous ability (charge, draw, inhale) must be distinct and loud enough to hear across a teamfight. That is where counterplay lives. The impact matters more to the caster.

### 3.2 Economy and progress sounds

| Event | Function | Design notes (analysis unless cited) |
|---|---|---|
| **Gold earned** (last hit) | Confirms a successful last hit; trains timing | Short, bright, slightly randomized pitch. Play it **only for the local player's own gold**. Last-hitting is a core skill, so the sound is the reward loop |
| **Minion death** | Background information | Very quiet and voice-limited (see 4.3). Hundreds play per match |
| **Structure hit** | Tells you your structure is under pressure | Heavy and low. Allied-structure-under-attack gets its own warning, rate-limited |
| **Structure destroyed** | Major milestone | Big tail, debris, announcer line. Plating or partial rewards in LoL [r02] each deserve a smaller "chunk" sound |
| **Level up** | Power spike, new rank available | Rising tonal flourish in the game's key, plus VFX |
| **Item purchased** | Confirms a shop transaction | Coin or cash-register family, distinct from the gold-earned sound. One-frame response |
| **Ward placed** | Confirms placement | Soft and local. Enemies hear nothing. Ward destroyed or expired gets a distinct "lost vision" cue |
| **Recall / return-to-base** | Channel; risk of interruption | A charging loop for the ~8 s channel (4 s for LoL's empowered mid-quest recall) [7], then a "pop" on completion and a broken sound on interruption. Whether enemies can hear it is a design decision (see open questions) |
| **Ping** | Team communication | Each ping type gets its own sound. Dota uses different sounds for pings on allied and enemy buildings [9] |

### 3.3 Client UI sounds and the queue pop

- **The ready check is about 12 s** in LoL, and one player who declines or misses it sends the lobby back to queue [1]. LoL also counts three failed ready checks as one dodge for penalty purposes [2]. That makes the match-found sound **the highest-stakes sound in the product.**
- In LoL, the client is reported to come to the front and flash the taskbar when a match is found, with a distinctive alarm-like sound [unverified].
- *Analysis: why the queue pop must grab attention.*
  1. **The player is probably elsewhere.** They are in another tab, or have audio down for a video.
  2. **Timbre:** wide-band and bright with a sharp attack, so it cuts through other audio and laptop speakers. Make it rhythmic (2-3 pulses) rather than one hit, since repetition is what pulls attention back.
  3. **Loudness:** mix it 3-6 dB hotter than other UI sounds, on its own slider or with a floor that a "mute UI" setting cannot go below. Warn the player in settings if they turn it off.
  4. **Recognizable but not alarming.** Players will hear it thousands of times. It needs to say "go" without causing stress.
- *Browser specifics for Vale [unverified, check against current browser docs]:*
  - Browsers keep the Web Audio `AudioContext` suspended until a user gesture. Resume it on the first click in the client (for example, Play), or the queue pop can be silent.
  - Hidden tabs throttle timers and pause `requestAnimationFrame`. Play the pop **directly from the network message handler** (WebSocket `onmessage`), not from the render loop.
  - Add redundant channels: the Notification API (with permission), a flashing `document.title`, and a favicon badge.
- **UI hover/click** (per r05): hover should be barely audible and rate-limited. Press makes its sound on press, not release. Confirm, back, error, tab, reward and timer-urgent each get a distinct sound. Feedback for every input is part of "juice" [12][13].

---

## 4. Mixing

### 4.1 Loudness targets [all unverified this session; confirm before spec]

| Standard | Integrated target | True peak | Notes |
|---|---|---|---|
| EBU R 128 (broadcast) | -23 LUFS | -1 dBTP | European broadcast norm, often borrowed for game cinematics |
| ATSC A/85 (US broadcast) | -24 LKFS | — | — |
| Sony ASWG-R001 (games) | about -24 LUFS ±2 for home console; about -18 LUFS for portable or mobile | about -1 dBTP | Recommends measuring a long stretch (about 30 min) of representative gameplay, not single assets |

*Analysis for Vale.* Browser players mostly use laptop speakers or headsets, and mix with music and video in other tabs. A practical target is about **-18 to -20 LUFS integrated** over a typical match, with true peak at or below -1 dBTP and a gentle master limiter. Normalize every music track and stinger to a fixed loudness so nothing in the menu flow jumps out, apart from the deliberately louder queue pop. Ship separate sliders: master, music, SFX, announcer, UI, voice chat and pings (LoL now has built-in team voice [18][19]).

### 4.2 Bus structure and priority

*Analysis: a proposed hierarchy* (top wins, lower buses get ducked):

1. **Critical alerts:** ready check, own low-HP warning, base under attack.
2. **Announcer.**
3. **Enemy threat cues:** wind-ups and ult casts aimed at or near you, ganks out of fog.
4. **Own actions:** abilities, hits, gold.
5. **Ally actions.**
6. **Neutral and world:** minions, jungle monsters, structures.
7. **Music and ambience.**

- **Ducking:** side-chain each bus from those above it, with fast attack (10-30 ms), medium release (200-500 ms) and modest depth (3-9 dB). Do not use hard muting.
- **Dynamic "HDR" mixing** (from the shooter genre) chooses at runtime which sounds are loudest and lowers quieter ones relative to them. It suits teamfights [unverified as applied in any MOBA].

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

- **Attenuation:** in an RTS-style view, use 2D (x,z) distance, a large inner radius about the size of the screen, and a gentle rolloff. Panning should be moderate (roughly ±60% max), so headphone users do not get hard-panned fatigue. LoL and Dota both appear to attenuate by distance from the camera's view [unverified].
- **Fog of war:** sounds from units in fog should be heard only if the design allows it. Leaking sounds from fogged positions is an information leak. *(Analysis; open question.)*

### 4.5 Readability: enemy vs ally

- *Analysis:* the player needs to know **who** cast something before **what** it is.
  - **Enemy versions of key sounds** (wind-ups, ultimates) are louder, brighter and longer than ally versions. Overwatch is widely reported to use different ultimate voice lines for allies and enemies, with the enemy version loudest [unverified]. VALORANT reportedly does the same with ally and enemy ultimate lines [unverified].
  - **Own-hero sounds** can be closer and drier, mixed for feel. Enemy sounds are mixed for threat.
  - **Allegiance sweeteners:** add a short, consistent "enemy" layer (a darker transient, for example) on every enemy ability wind-up. Players learn it once and recognize it everywhere.
  - **Silhouette by frequency:** give each hero class a home frequency range (heavy brawlers low-mid, mages airy high-mid, marksmen tight transient) so overlapping abilities stay separable.

---

## 5. Accessibility

- LoL ships accessibility options such as a colorblind mode [20]. Audio-specific options in LoL and Dota (subtitles for the announcer, visual sound indicators) are **[unverified]**. Both games do show announcer events as on-screen banners and kill-feed entries, which already duplicates most announcer audio as text [unverified].
- The genre-wide guidance (Game Accessibility Guidelines, Xbox Accessibility Guidelines) says: never convey essential information by sound alone, give separate volume controls for speech, effects and music, and subtitle important speech [unverified].
- Fortnite's "visualize sound effects" option, a radial indicator of nearby sound direction and type, is often cited as the reference implementation [unverified].
- *Analysis for Vale:*
  1. **Every announcer line has a banner.** Text, icons and portraits, kept on screen long enough to read (2.5-4 s).
  2. **Every music-state change has a HUD equivalent** (for example, a combat-state border glow on own portrait).
  3. **Off-screen threat indicators** at the screen edge for enemy wind-ups and ults that are audible but off-screen.
  4. **A mono mix option** and a **"reduce loud transients" option** (a stronger limiter for players with hearing sensitivity).
  5. **Ready-check redundancy:** sound, notification, tab title and favicon (3.3).
  6. **Subtitle the hero voice lines** that carry gameplay information (for example, "my ult is ready"), and do not subtitle flavor lines.

---

## 6. Original, cohesive music on a small team

*Analysis, with tool claims [unverified].*

### 6.1 Make one "sonic DNA" sheet before writing anything

- **Tonal center:** pick one home key or mode (for example, D Dorian) for menus, draft and match ambience. Victory resolves to the tonic. Defeat lands on a suspended or relative minor chord.
- **Motif:** one 4-6 note motif, the game's sonic logo. Use it in:
  - full form for the login and victory sting,
  - fragmented form for the draft lock-in and level-up,
  - two or three notes for the queue pop and the reward tick-up.
- **Palette:** five to eight signature instruments or synth patches, used everywhere. For example, a plucked metallic instrument, a warm pad, low taiko-like drums, an airy flute or whistle, and a granular texture. UI sounds and stings come from the same patches, which is what makes the whole product feel like one game.
- **Tempo grid:** one BPM family (for example, 90 BPM with 180 for combat layers), so every layer and stinger lines up at bar boundaries.

### 6.2 Structure: vertical layers plus horizontal stingers

- **Vertical layering:** author each bed as 3-5 synced stems (pad, pulse, percussion, melody, texture) of the same length. Game state fades stems in and out, for example draft phase to phase or match calm to combat. This is the cheapest kind of dynamic music: one composition, several mixes.
- **Horizontal re-sequencing:** short 4- or 8-bar segments plus transition stingers, chosen at bar boundaries. Use it where the music needs a real change of character (`dead`, victory).
- **Loop lengths:** 8 or 16 bars per stem (about 20-45 s at 90 BPM). Use longer, stem-varied cycles for menus, so the full combination repeats rarely.

### 6.3 Browser implementation notes [unverified, check against current browser docs]

- Use decoded `AudioBuffer`s with `AudioBufferSourceNode.loop`, scheduled against `AudioContext.currentTime`, for sample-accurate gapless loops and bar-quantized transitions. An `<audio>` element loop can leave audible gaps.
- MP3 encoder padding causes loop gaps. Prefer Ogg/Opus or AAC with loop points set in code, or WAV for short stingers, and test on Safari.
- Stream long menu beds, and decode short SFX up front. Lazy-load each hero's SFX bank when that hero appears in the draft.
- Wwise and FMOD both have web or WASM targets, but a custom Web Audio graph may be enough at Vale's scale (decision in 7c).

### 6.4 Where Blender fits

The team already has Blender. It is not a music tool, but it helps with **sync**: [unverified feature details]
- Use Blender's Video Sequencer to scrub hero animations against draft SFX and confirm that impacts land on contact frames.
- Mark contact or foot-plant frames with timeline markers, and export them (as glTF extras or a JSON sidecar) so the Three.js client fires SFX exactly on those frames. That keeps audio in sync when animation timing changes later.
- Speaker objects can preview rough 3D positioning for menu dioramas.

Use a DAW (any free or low-cost one) for music and SFX authoring.

---

## 7. Implications for Vale

### (a) Principles and systems worth adopting, in original form

1. **Audio weight ladder tied to gameplay importance:** auto-attack < ability < ultimate < objective < match end, sharing the importance ratings used for VFX [14][15].
2. **Enemy wind-up cues as the top-priority gameplay sound,** with a shared "enemy" sweetener layer and louder enemy versions of ultimate cues.
3. **Announcer as a priority queue** with merging, expiry and preemption (2.2), and **a banner for every line**.
4. **Clear event classes:** first takedown (with its economy bonus, LoL-style [5][6]), multi-takedowns, streaks, bounty-ending kills (announce at a visible threshold, as LoL does at 150 g [3]), team wipe, structures, objectives, match end. Write original names and wording.
5. **Ambience-first match with a light dynamic layer:** calm, tension, combat, objective and dead states, with hysteresis, bar-quantized changes and a HUD cue for each state.
6. **Draft music tracking the timer,** with an urgency layer only for the player whose turn it is.
7. **Queue pop as a critical system:** louder, multi-pulse, played from the network handler, plus Notification, tab-title and favicon redundancy; the ready check is about 12 s in LoL [1].
8. **Bus hierarchy and ducking** (4.2), **voice budgets and audio LOD** (4.3), and **hybrid listener placement** (4.4).
9. **Loudness spec:** about -18 to -20 LUFS integrated, true peak ≤ -1 dBTP, normalized music, separate sliders for each category, including voice chat [18].
10. **Distinct ping sounds per ping type and target,** following Dota's allied-vs-enemy building distinction [9].
11. **Audio cosmetics** (announcer packs, music packs, chat-wheel lines) as a later monetization track, with a parity rule: same event coverage, priority and clarity as the default [10].
12. **One sonic-DNA sheet:** key, motif, palette and tempo grid, shared by menu bed, draft, match ambience, stings and UI sounds.

### (b) Protected expression that must NOT be copied

- Any **recordings or samples** from LoL, Dota 2 or other titles: music, SFX, UI sounds, the match-found sound, ping sounds, announcer voices.
- **Announcer wording and delivery** that identifies a specific game: LoL's or Dota's exact line set and phrasing, and the inherited arena-shooter spree ladder words. Vale's event classes can match the genre, but the words, voice casting and delivery must be original.
- **Melodies, motifs, chord progressions and arrangements** of any game's login, champ-select, victory or defeat themes. Also do not write "sound-alike" tracks to a reference temp track; compose from Vale's own DNA sheet.
- **Character voice lines,** pick or lock-in quotes and ultimate callouts of any existing champion or hero.
- **Names** of the reference games' announcer packs, music packs and modes.

### (c) Open questions

1. **Dynamic music, or ambience only, in the match?** Start ambience-only with stings (cheaper, safer for readability) and add the dynamic layer later?
2. **Recall audibility:** can enemies hear a recall channel nearby (a counterplay cue), or only the recalling team?
3. **Sound in fog of war:** do sounds from fogged units play? If they do, it leaks information; if they don't, the world feels dead. Possible middle ground: muffled, direction-only cues for big ultimates.
4. **Middleware:** a custom Web Audio graph, or a Wwise/FMOD web build (licensing, bundle size, WASM start-up cost)?
5. **Announcer voice:** record a human actor (cost, consistency, re-records for new events), or build a modular system that stitches lines from parts?
6. **Loudness target:** confirm the -18 to -20 LUFS proposal against measured browser competitors and the Sony ASWG document.
7. **Mobile and laptop speakers:** do we need a "small speakers" mix preset (less sub-bass, more upper-mid)?
8. **Blender export:** which path carries animation markers into the client: glTF extras, a sidecar JSON, or naming conventions?
9. **Asset budget:** total audio download size in the first session, and how much can be lazy-loaded per hero.

---

## 8. Follow-up verification pass (searches this report could not run)

Run these searches before the audio spec is locked. Each one replaces an [unverified] item.

1. Dota 2 music system: state names, battle trigger rules, Smoke cue, music packs (Dota 2 wiki "Music," Liquipedia).
2. Dota 2 announcer packs and the separate multi-kill announcer slot: who hears what.
3. LoL champ-select music phases and the final-seconds ramp. LoL login screen and music toggles.
4. LoL Summoner's Rift in-match music policy (2014 map update audio notes, Riot dev posts).
5. LoL announcer event list and queueing behavior (LoL wiki "Announcer").
6. Overwatch GDC 2016 audio talk on playing by sound (threat-based mixing, ally vs enemy ult lines).
7. Sony ASWG-R001 numbers (-24/-18 LUFS, true peak, measurement window), plus any PC or web loudness guidance.
8. Game Accessibility Guidelines and Xbox Accessibility Guidelines audio items. Fortnite's visualize-sound-effects feature.
9. Browser autoplay policy, Web Audio gapless looping, Opus/AAC support in Safari 2026, background-tab timer throttling.
10. LoL queue-pop behavior: focus stealing, taskbar flash, behavior when the client is minimized.
11. Riot, Valve or Predecessor audio postmortems or interviews (GDC Vault, A Sound Effect, Designing Sound).
12. Blender: Video Sequencer audio scrubbing, timeline marker export to glTF, Speaker objects in the current Blender version.

---

## Sources

All URLs below were seen in search results by sibling research agents in this run and cited in their reports. They were **not** re-opened or re-checked by this agent (search budget exhausted, fetches blocked). The report each came from is in brackets.

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

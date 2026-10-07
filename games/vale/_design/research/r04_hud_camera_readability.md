# R04: In-Match HUD, Camera, Readability and Spectator

**Project:** VALE (Forgeflow Games), an original browser-based competitive lane-brawler (custom Three.js / WebGL2 client)
**Date:** 2026-10-07
**Primary reference:** League of Legends (LoL) as of 2026. **Secondary:** Dota 2.
**Method note:** All facts below come from web search results. The network egress proxy blocked direct page fetches for every domain tried (the LoL wiki, Liquipedia, Dexerto, PCGamesN, esports.gg, hawk.live, Riot Nexus and others). Citations therefore point to pages whose content showed up in search snippets. The shared search budget ran out before a few camera-geometry numbers could be confirmed, and those are marked **[unverified]**. Any claim that is my own design reasoning, not a reported fact, is labeled *analysis*.

---

## 0. Summary of the key principles

1. **Keep the center clear and the edges dense.** Shipped lane-brawler HUDs put the player's own controls at the bottom center, map awareness in one bottom corner, and match-state information (score, clock, team portraits) along the top edge. The middle of the screen is where the fight happens and stays open.
2. **Color shows allegiance. Shape and position show identity.** Health bars are colored by relationship (self, ally, enemy), not by unit type. Accessibility modes re-map those colors.
3. **Measure health in fixed units.** Tick marks every fixed amount of HP let players count effective HP at a glance, independent of max HP.
4. **Communicate through context, not chat.** Smart pings carry structured data (cooldowns, timers, item readiness) so players can coordinate without voice or typing. Rate limits, per-sender mutes and removing abusable pings keep the channel from becoming a harassment tool.
5. **Explain every death.** A death recap that breaks damage down by source and type turns a frustrating moment into something the player can learn from.
6. **The camera is a fairness system.** A fixed angled top-down camera with a capped zoom gives everyone the same information. Lane and map geometry are then laid out to cancel the camera's built-in asymmetry.
7. **VFX need a hierarchy.** The visual intensity of an effect should match how much it matters in play. The most dangerous part of an effect (for example, a missile's tip) should get the highest contrast.
8. **Spectating is a separate product.** A directed camera, fog toggles, advantage graphs, a broadcast delay and replay time controls turn the same simulation into something worth watching.

---

## 1. HUD anatomy and density

### 1.1 Macro layout: where things live and why

- **LoL's in-game HUD** puts abilities, health, mana and experience in the bottom center. Player information and stats sit to the left of that cluster, and the minimap is on the right [1]. In an earlier HUD overhaul the item inventory moved to the right of the ability bar. Riot said playtesting cleared the move despite early concerns [2]. *Analysis:* this places the things you press most (abilities, items, summoner spells) in one horizontal strip, so the eye moves sideways between related controls and never crosses the playfield.
- **Dota 2** uses a top bar with both teams' hero portraits, one team on each side. Each portrait has health and mana under it, a small indicator showing whether that hero's ultimate is ready, and a respawn timer on a greyed-out portrait when the hero is dead. The game clock sits between the two teams [3]. *Analysis:* the top edge acts as a glanceable "state of the world" strip. The bottom edge is "state of me."
- **Spectator and esports HUDs** show the same layering principle. The LoL Esports broadcast HUD moved gold into a more central spot on the top bar, because gold reflects game state better than kills do [17]. The 2025 First Stand broadcast overlay was criticized by viewers [18], a reminder that density changes are noticed and judged quickly.

*Analysis (typical layout pattern):*

| Screen region | Typical contents | Rationale |
|---|---|---|
| Bottom center | Portrait, level/XP, HP/resource, abilities, summoner/utility spells, items, gold | Primary input surface, near the hotkeys you think about. Keeps the player's eye low and central. |
| Bottom corner (LoL: right) | Minimap, camera-lock toggle | Big-picture awareness. The corner gives it a large square without covering lanes. |
| Top edge / top-right | Team score, clock, KDA/CS, objective strip | Slow-changing match state. Checked occasionally. |
| Left/right edges | Team frames (ally portraits, HP, ult status) | Ally health is needed for peel and assist decisions. |
| Upper-mid / right side | Kill feed, announcements | Transient events. They fade out. |

The exact on-screen positions of LoL's kill feed, announcement banner and team frames in the 2026 client were not confirmed in this research **[unverified]**.

### 1.2 Ability bar

- **Leveling affordance:** LoL lets players spend a skill point with a modifier plus the ability key (for example Ctrl/Alt with Q/W/E/R), as well as by clicking an on-bar level-up control [8]. Each level grants one point, which can unlock an ability or raise its rank [8].
- **Cooldown, cost and rank display:** Shipped MOBAs use a radial "clock-wipe" sweep with a numeric countdown for cooldowns, show resource cost on or near the icon, and mark rank with small pips under each slot. I could not confirm LoL's exact 2026 visual treatment (pip shape, cost placement, insufficient-mana tinting) **[unverified]**.
- **Every HUD element is also a ping source:** In LoL, Ctrl/Alt-clicking an ability, summoner spell, item, health or mana bar, the gold display, or an epic-monster or buff timer icon sends a structured message to team chat, such as an ability showing "Ready" or its remaining seconds [9]. *Analysis:* this makes the HUD a two-way surface. Anything the player can see, they can share with the team.

### 1.3 Health and resource bars

- **Color by relationship:** In LoL your own champion's bar is green, allies' bars are blue and enemies' bars are red [4].
- **Segmenting ticks:** In a 2013 health-bar update, LoL added small ticks that each represent up to 100 HP, plus a full, darker tick at each 1,000 HP. This made high-HP champions easier to read [5][6]. *Principle:* ticks in fixed units let players compare absolute health across champions with very different maximums. A percentage-only bar hides that.
- **Shields and damage-type previews:** Shields appear as a separately colored extension of the health bar. One champion's kit uses an orange box for a physical shield and purple for a magic shield [7]. Whether LoL has a universal color code for all shields (for example, white or grey for generic shields and distinct tints for magic-only or physical-only shields) was not confirmed **[unverified]**.
- **Damage-type color language:** In LoL, physical damage reads as orange or white, magic as teal, and true damage as a bright white [38]. This language shows up again in the death recap (section 4).

### 1.4 Objective timers and team-state strips

- LoL's 2025 season added Atakhan to the objective-timer HUD as a large section between Baron and Dragons, with a different icon for each of its forms. It also added a Feats of Strength panel showing which feats each team had completed, in team colors [10].
- Patch 26.1 (January 2026) removed Atakhan and Feats of Strength and moved Baron's spawn back to 20 minutes [11][12][13]. Reporting described objective overload as a common player complaint [11]. *Analysis:* every new objective adds a HUD element that players must track. HUD real estate works as a design budget. If an objective needs its own large timer panel, that is a signal of cognitive cost.
- The 2026 season also added Role Quests, which differ by role [78]. Their HUD representation was not researched here **[unverified]**.

### 1.5 Dota-specific HUD details worth noting

- Patch 7.35 added an **XP range indicator**: hovering over your hero level shows the radius in which you earn experience, with no modifier key needed [14]. *Principle:* reveal invisible rule-space on demand. If a mechanic depends on an invisible radius, give players a way to see it.

### 1.6 Scale settings and HUD screen share

- LoL offers separate HUD Scale, Chat Scale and Minimap Scale sliders from 0 to 100. A pro player suggested HUD scale around 0-30 and minimap scale around 33 as a good balance between legibility and screen coverage [15].
- Dota offers an "extra large minimap" option (a console variable makes it larger still) and a minimap hero-icon size setting of roughly 100-130% [16].
- **Screen-area estimate (analysis, [unverified]):** At default scale, a LoL-style HUD covers roughly 12-20% of a 16:9 screen. That breaks down as a bottom-center bar of about 10% screen height across about 35-45% of the width, a minimap square of about 20-25% screen height in one corner, and thin top-edge strips. Competitive players tend to shrink the HUD and keep the minimap fairly large. *Principle:* let players trade HUD legibility for playfield, but set a floor so critical information stays readable at minimum scale.

---

## 2. Minimap

### 2.1 LoL

- Living champions appear on the minimap as circular **portraits**. Dead champions are not drawn. Portraits that overlap can hide each other, so you may see fewer than expected [19].
- **Wards** use team-colored icons with different shapes: stealth wards show as a three-pointed star and control wards as an eye [19]. *Principle:* shape tells you the type and color tells you the team, so the two can be read independently.
- **Towers** are shown while they stand and removed when destroyed [19]. The minimap becomes a live record of the structure state.
- **Fog of war** is a dark shroud over the parts of the map your team cannot see [19].
- A small camera icon next to the minimap toggles camera lock [20].
- Minimap clicking (left-click to move the camera, right-click to issue a move order) is standard practice. Exact 2026 bindings were not confirmed **[unverified]**.

### 2.2 Dota 2

- By default, Dota draws heroes on the minimap as abstract markers (arrows and circles/crosses). Options include hero icons while holding Alt, inverting that toggle, or always showing icons or names [16][21].
- In patch 7.35, enemy hero markers changed from crosses to **arrows that show facing**, and the hero icon and movement direction could be shown together [14][22].
- *Principle (analysis):* There is a tradeoff between **identity** (portraits tell you who) and **heading** (arrows tell you where they're going). Dota's 7.35 change shows that both matter. Heading is especially useful for spotting rotations early.

### 2.3 Minimap design takeaways (analysis)

- Draw lanes so they run along clearly separated diagonals or edges. Then a glance at the minimap shows which lane a unit is in.
- Use a small set of distinct shapes, each in team color: hero, structure, ward, objective, ping.
- Use the minimap as both an input surface (camera jump, move, ping) and an output surface (pings, fog, objectives).

---

## 3. Ping language and voice-less communication

### 3.1 LoL ping set (2026)

- The current ping wheel has **eight smart pings**: Retreat, Push, On My Way, All-In, Assist Me, Need Vision, Enemy Missing and Enemy Vision. Hold Alt or Ctrl, drag toward a direction and release [23].
- **History and lessons:** The Preseason 2023 update added Push, All-In, Hold and Bait [24][25]. In patch 13.20, Bait was replaced by Enemy Vision and Hold by Need Vision, and the Vision Cleared ping and the separate vision ping wheel were removed [26][25]. Riot had called the way Bait was being used (mostly to taunt teammates) "unacceptable" [27]. *Principle:* every ping type gets used in ways you didn't intend. Cut any ping whose main real-world use is blame or sarcasm.
- **Smart pings on HUD and world objects:** Pings can target abilities, summoner spells, items, health and mana bars, gold, and epic-monster or buff timers. Each sends a formatted message with readiness or remaining time [9].

### 3.2 Rate limits

- LoL caps pings at **2/4/6/7/7 within 5 seconds, scaling with Honor level**. Going over the cap blocks pinging for 6/12/16/20/24 seconds, and the block grows if you keep trying. A separate cap allows Generic, Alert and Enemy Missing pings **3 times each per 6 seconds** [28].
- *Principle:* rate limits protect the channel's signal value. Tying the allowance to a behavior score (Honor) rewards good communicators without fully silencing anyone.

### 3.3 Muting

- LoL chat commands include `/muteping` (mute pings from one player or all players), `/mute` (mute text from a player) and `/fullmute` (mute all text and pings for the session) [29]. Patch 13.4 added `/muteself` and `/deafen`, which also tell allies that the player has opted out [30].
- The Tab scoreboard has per-player icons to mute emotes, pings or everything [31].
- *Principle:* make muting granular (pings separate from text separate from emotes), quick to reach, and per sender. A self-mute that tells teammates about it sets expectations instead of leaving them guessing.

### 3.4 Dota 2 pings and chat wheel

- Alt-clicking the minimap or world places an **exclamation-mark ping** with a sound. Ctrl+Alt-click places an **X "danger" ping** with a different sound [32]. Pings on buildings play different sounds for allied and enemy buildings, which effectively says "defend" or "attack." Pinging an enemy hero signals intent to attack [32].
- **Item pings** report whether an item is ready, and if not, its remaining cooldown and/or how much mana is still needed. Pinging an empty teleport slot reports that it is empty and its cooldown [32].
- The **chat wheel** has eight directional phrases per wheel, with a primary and a secondary wheel (16 lines from two keys). Phrases are customizable and include defaults like "Well played," "Missing," "Help" and "Get back" [33][34]. Hero-specific voice lines and sound effects are paid or reward content [33].

### 3.5 Voice-less communication principles (analysis)

1. **Pings should carry data, not only location.** Timers and readiness are what make pings better than typing.
2. **Each ping needs a distinct sound and icon.** Players often notice pings in peripheral vision or by ear.
3. **Directional radial menus** let a practiced player send a message in one fast flick.
4. **Positive and logistical messages beat negative ones.** Leave out pings that mainly mean "you are bad."
5. **Throttle, mute and score behavior** as one connected system.

---

## 4. Death recap

### 4.1 LoL

- LoL's death recap went almost ten years without an update. A redesign shipped around patch 9.14 (2019) with the stated goals of being accurate, informative and easy to read [35][36].
- The redesigned recap shows a **pie chart of total damage split into physical and magic**, the **length of the fight**, the **three biggest damage sources** and **how long you were crowd-controlled**. An expanded view lists the specific spells that finished you and your killers' scores [35].
- The recap covers non-champion damage (turrets, minions, monsters) and the time window the damage arrived in [37].
- The older recap was widely seen as unreliable [35]. *Principle:* if a recap is wrong, it does more harm than having none, because it teaches the wrong lesson. It has to come straight from the simulation's damage log.

### 4.2 Dota 2

- Dota's death summary breaks damage taken down by source (hero, creep, tower), names the responsible enemy heroes and their abilities, and lists debuffs that contributed [39]. A damage breakdown panel reportedly opens on death by default and closes on respawn **[unverified: source page not individually confirmed]**.
- In Dota's post-game, a per-source damage breakdown (spells, attacks, items) is a Dota Plus (paid) feature [40].

### 4.3 Recap design takeaways (analysis)

- Answer three questions in under 3 seconds: *who* killed me, *how fast* it happened, and *what type* of damage it was (which suggests the counter-itemization).
- Show crowd-control time, because "I couldn't act" is a different lesson from "I took too much damage."
- Use one consistent damage-type color language across the HUD, damage numbers and the recap.

---

## 5. Scoreboard (in-match and end-of-game)

### 5.1 LoL

- The Tab scoreboard shows each player's K/D/A, CS and items, and gold and other metrics can be compared [41]. It also holds the per-player mute controls [31]. The full 2026 Tab layout (level, summoner spell cooldowns, team gold difference, dragon and objective counts) was not confirmed in detail **[unverified]**. The 2025 objective-timer and Feats HUD shows that objective state is part of the at-a-glance surface [10].
- The post-game stats screen groups performance into **Combat** (damage, kills), **Income** (gold, CS) and **Map Control** (vision, objectives), including vision score, gold earned and CS per minute [41].

### 5.2 Dota 2

- The in-game/spectator **Game Stats** dropdown ranks players by a selectable stat: K/D/A, last hits/denies, level, XPM, current gold, net worth, GPM and buyback status [42].
- The post-game has a **scoreboard** (items, KDA, net worth, GPM, XPM), **graphs** (team net worth and XP over time), an **MVP screen** with two honorable mentions, and a paid damage **breakdown** tab [40].

### 5.3 Takeaways (analysis)

- In-match: show the decision-relevant comparison (item and level differences, ultimate and summoner availability) rather than vanity totals.
- Post-game: group stats by the skill they reflect (fighting, economy, map). That supports a "what to improve" story more than one composite score.
- Graphs of team advantage over time are the clearest way to show where a match turned.

---

## 6. Camera

### 6.1 LoL

- **Lock modes:** LoL has three locked-camera variants. *Per-Side Offset* shifts the view based on which side of the map you start on. *Fixed Offset* keeps your champion at screen center. *Semi-Locked* lets you move the camera while locked, but only as far as keeps your champion on screen [43][20]. Y toggles lock, as does the camera icon beside the minimap [20].
- **Pan:** Edge-pan (mouse) and keyboard pan have separate speed sliders [43].
- **Zoom:** Scroll zooms between a fixed minimum and maximum. Live-game zoom is capped so every player gets the same field of view, and external zoom modifications risk account penalties [44]. Replays allow a further zoom-out [45].
- **Angle and FOV:** A low-reliability secondary source reports a 40-degree field of view with the camera tilted about 56 degrees below horizontal [46] **[unverified]**.
- **2026 change: WASD and Dynamic Camera.** WASD movement went live in unranked queues. Turning it on also turns on a **Dynamic Camera** that keeps the champion on screen and follows the mouse, at adjustable speed. A **Scout Ahead** control (middle mouse by default) lets the camera move freely while held and snaps it back on release [47][48][49]. *Principle:* if movement moves to the keyboard, the camera has to take on some of the work the mouse used to do.

### 6.2 Dota 2

- The default camera distance is **1134** units, the value the custom-game API overrides [50]. Default pitch and FOV were not confirmed **[unverified]**.
- Camera tools include edge pan (the most common method), **camera grip** (a held key for fine drag-panning), double-tapping select-hero to re-center, a "hold select hero to follow" option and an option to re-center on respawn [51][52].

### 6.3 Why a fixed, angled, top-down camera

- **Fairness:** An angled camera sees more ground in some directions than others. One level designer's write-up of a shipped MOBA explains that lanes were aligned with the camera's rotation so both sides got equal views, and team objectives were centered so neither team had a geometric edge [53]. LoL's Per-Side Offset camera option [43] addresses the same problem from the camera side.
- **Information parity:** Capping zoom keeps information equal [44]. In a game built on fog of war and vision control, a wider view would be a direct competitive advantage.
- *Analysis:* A downward pitch of roughly 50-60 degrees keeps character silhouettes readable (a slight 3/4 view) while keeping ground indicators (AoE circles, skillshot paths) close to their true shape. Lower pitch adds perspective distortion to ground telegraphs and lets tall objects hide units behind them. Pure top-down (90 degrees) loses silhouette and height cues. The bottom HUD covers the area just below the player, so the default framing usually puts the champion slightly above the center of the screen.

---

## 7. Readability

### 7.1 Health-bar coloring and colorblind modes

- **LoL default:** self green, allies blue, enemies red [4].
- **LoL colorblind mode:** your own bar turns **yellow**, allies stay **blue** and enemies stay **red**, and minion bars follow the same scheme [54][55]. *Analysis:* the main fix is moving "self" off green, which is hard to tell apart from both red and grass-green terrain. Some players say the mode does too little for people with actual color-vision deficiency [56]. Re-mapping a single hue is not a full accessibility solution.
- **Dota 2:** colorblind mode turns HUD health bars **blue**, and the player's own and allied overhead bars blue. A separate "Differentiate Ally Healthbars" option makes allied bars **ochre** while your own stays green [57]. Dota also added a "high-visibility hero health bars" option under Interface [58].
- Players of other genre titles (Deadlock) have publicly asked for a colorblind setting for enemy colors specifically [65]. This suggests enemy-color customization is an expected feature.

### 7.2 Hover, outline and targeting aids

- In LoL, hovering over an enemy gives it a **red outline** [59]. **Target Champions Only** (a held key) makes attack and targeting commands prefer champions over minions, and **Attack Move on Cursor** picks the enemy nearest the cursor, not nearest the champion [59]. *Principle:* readability includes how input is interpreted. Make it easy to pick the right target in a crowd.

### 7.3 VFX hierarchy and telegraphs

- Riot's public VFX style guide (2017) sets four goals: gameplay clarity, minimal clutter, supporting the champion's theme, and surprise and delight. These are achieved through value, color, shape and timing [60][61].
- **Visual hierarchy:** designers rate a spell's importance (1-10) so its visual weight matches its gameplay weight. Pure white is reserved for ultimates, the most important and most damaging effects [61][63].
- **Area of focus:** the part of an effect a player must react to (for example, a missile's tip) gets the highest contrast, highest saturation and most detail. Secondary elements are kept quieter [62][61].
- **Avoid red in champion VFX** where it could be confused with enemy-signaling. Riot steered a champion's visual update away from red for this reason [64].
- **Enemy-visible telegraphs:** Searches did not confirm whether LoL shows an enemy caster's aiming indicator to the target, or which abilities show ground warnings to enemies **[unverified]**. *Analysis:* the shipped genre generally hides the caster's aim from enemies (reaction then depends on reading the cast animation and projectile) but shows delayed-impact AoEs on the ground to everyone. Vale should decide this per ability class and keep it consistent.

### 7.4 Shape coding and red/green avoidance (analysis)

- Never let red versus green be the only difference between two meanings. Pair team color with shape (ward star vs eye [19]), position (team frames on a fixed side) and outline style.
- Keep the friend/foe hue pair far apart in luminance as well as hue. Blue vs orange/red holds up better than red vs green under common color-vision deficiencies.
- Offer at least: a self-color override, an enemy-color override, and a high-visibility health bar option.

---

## 8. Spectator mode

### 8.1 Dota 2 (the strongest reference)

- **Camera modes:** *Directed Camera* follows important events automatically. *Free Camera* gives full control and includes a "Showcase View." *Player Perspective* shows exactly what a chosen player sees. *Hero Chase* keeps the camera on one hero [66]. Later updates added **Override Cam**, which lets you pan away while in a non-free mode and returns to the chosen mode after a short delay, and click-to-focus a hero within Directed Cam [66].
- **Fog options:** spectators can view through either team's fog or with both teams' vision combined. Without that, heroes are fully visible to spectators by default [66].
- **Graphs:** a **combo graph** shows win probability, gold and XP together with their deltas. A **momentum indicator** shows which team's performance has improved more in the last two minutes. These arrived around TI10 (2021) [67][68][79].
- **Stat panels:** the Game Stats dropdown ranks players by KDA, LH/D, level, XPM, gold, net worth, GPM and buyback status [42].
- **Broadcasters:** viewers can choose from up to six broadcaster audio streams [66].
- **Delay:** DotaTV delay is set by the organizer in the lobby. Valve added an automatic 15-minute delay option for tournament lobbies [69]. Some organizers have required 10-minute delays plus 5 more for community streams [70].
- **Replay:** In a later replay UI revision, speed moved into a dropdown and timeline hover timestamps were removed, which content editors criticized [71]. *Principle:* replay tools are also creator tools, and scrubbing precision matters to the people who make content about the game.

### 8.2 LoL

- Spectator mode can follow one player, pan manually, auto-pan to action or cycle through players, and can zoom out further than normal play allows. It can show one team's perspective and toggle fog of war [72][73].
- Time controls include play/pause, jumping to a time, and speeds from 0.25x to 8x [72][74].
- The spectator HUD lines up both teams' champions on the sides with health, ability/ultimate cooldowns and summoner spells, plus a bottom table of kills, items and CS [73].
- **Delay:** the standard spectator delay is about three minutes, to stop spectators from feeding live information to players [75]. Reports conflict on whether custom games are exempt **[unverified]**.
- **Replays:** match-history replays (.rofl files) are tied to a patch and stop opening after the client updates. The timeline is auto-marked with kills and objectives. Players can switch to any champion's view, change speed, and toggle fog, health bars and the minimap [76]. Highlights can be exported as .webm video [77].

### 8.3 Spectator takeaways (analysis)

- Build spectating on the same **deterministic replay/event stream** as the game, so live spectating, delayed broadcast and replay share one pipeline.
- The minimum useful feature set is: directed camera, hero chase, free cam, player perspective, fog toggle (team A / team B / both), advantage graph, per-player stat table, time controls and event-marked timeline.
- Make the delay configurable by the server or the match host.

---

## 9. Implications for Vale

### (a) Principles and systems worth adopting, in original form

1. **Zoned HUD:** player controls bottom center, minimap in one bottom corner (with a sliding position option), slow-changing match state on the top edge, team frames on a side edge, transient events fading in the upper area. Separate HUD scale and minimap scale sliders, with a legibility floor.
2. **Fixed-unit HP ticks** (for example, a light tick every 100 HP and a heavy tick every 1,000, tuned to Vale's HP scale), plus a distinct shield overlay segment. Every bar colored by **relationship** (self / ally / enemy), never by unit class.
3. **One damage-type color language** shared by damage numbers, health-bar flashes, tooltips and the death recap. Choose Vale's own hues.
4. **Structured smart pings:** a small directional wheel (about 6-8 entries, all positive or logistical), plus Alt-click on any HUD element (ability, item, resource, gold, objective timer) to share readiness or time. Give each ping a distinct sound.
5. **Comms safety from day one:** rolling-window ping throttle with escalating lockout; per-type caps; per-player mute of pings, text and emotes, reachable from the scoreboard; a self-mute that tells allies; any taunt-prone ping left out entirely.
6. **Death recap** from the server damage log: top 3 sources, damage-type split, fight duration, time spent crowd-controlled, killing blow abilities. Show it automatically during the death timer.
7. **Camera:** fixed pitch around 50-60 degrees, narrow FOV (about 35-45 degrees) to limit perspective distortion, capped zoom identical for all players, lock and semi-lock modes, edge pan plus a drag-grip key, double-tap re-center, and a hold-to-scout key that snaps back. If Vale supports WASD, add a mouse-biased follow camera.
8. **Map geometry aligned to the camera** so both teams get equal view depth. Mirror or rotate the map so neither side looks "up" into the HUD more than the other, or add a per-side camera offset.
9. **Readability rules for VFX:** a per-ability importance score that limits brightness and saturation; pure white reserved for top-tier threats; brightest point at the dangerous edge; no hue that could read as "enemy" used in a friendly kit.
10. **Accessibility:** self-color override, enemy-color override, high-visibility bars, and shape and position redundancy for every team-color signal.
11. **Minimap:** shapes encode the unit type, team color encodes allegiance, and heroes show both identity and **heading**. Clickable for camera, movement and pings.
12. **Spectator/replay on one event-stream pipeline**, with a directed camera, fog toggles, an advantage graph with a short-window momentum cue, a stat table, a configurable delay, and replay time controls with precise scrubbing.
13. **Practical note (the user said the studio PC has Blender):** Use Blender to block out a lane segment at true gameplay scale and render test framings at candidate pitch/FOV/zoom values. Overlay a HUD mock to measure screen coverage before committing values to the Three.js camera. Blender also works for authoring Vale's own original indicator meshes (AoE rings, skillshot decals) and minimap icon silhouettes.

### (b) Protected expression that must NOT be copied

- Any game's **HUD art, frame shapes, ornamentation, layouts as exact compositions, fonts, icons and iconography** (ping glyphs, ward symbols, objective icons, the ultimate-ready diamond, minimap portrait frames).
- **Ping and chat-wheel wording as a set, voice lines and ping sounds.** Write Vale's own labels and record original audio.
- **Names of systems or modes** ("Death Recap," "Feats of Strength," "Showcase View," "Hero Chase," "Scout Ahead," "Dynamic Camera," "Honor," "Dota Plus") and champion, hero or objective names.
- **Specific color hex values or palettes** lifted from these games' UIs. Pick Vale's palette independently and test it for color-vision deficiencies.
- **Broadcast overlay designs** (LoL Esports / TI layouts).
- Exact numbers can serve as reference points (tick spacing, throttle counts, zoom distances), but Vale should tune its own values for its own scale and pacing rather than copying them as tuning.

### (c) Open questions

1. **Telegraph policy:** Which Vale ability classes show their aim or impact zone to enemies, and when? (LoL's policy was not confirmed here.)
2. **Exact camera numbers:** Default pitch/FOV for both reference games were not confirmed. Vale should settle them through the Blender framing tests above and playtests.
3. **Minimap side:** Bottom-right (LoL) vs bottom-left (Dota default **[unverified]**). Should it be selectable?
4. **WASD support:** If Vale supports WASD movement, what camera-follow model and scout key will it use?
5. **Ping throttle tied to a behavior score?** It needs a behavior/reputation system to exist first.
6. **Spectator delay defaults** for ranked vs custom vs tournament lobbies, and whether to show live win probability (which needs a trained model).
7. **Browser constraints:** Can a WebGL2 HUD reach the needed density (crisp text at small scales, many icons) at a stable frame rate? Should the HUD be DOM/CSS over the canvas or rendered in-canvas?
8. **Objective HUD budget:** How many concurrent objective timers can Vale show before hitting the overload LoL ran into with Atakhan and Feats?

---

## Sources

1. https://destructoid.com/?p=189503
2. https://www.gosugamers.net/news/21884-massive-item-and-hud-overhaul-coming-in-next-league-of-legends-update
3. https://www.oneesports.gg/dota2/the-complete-beginners-guide-to-watching-dota-2-as-an-esport/
4. https://wiki.leagueoflegends.com/en-us/Life
5. https://www.nerfplz.com/2013/02/xelnath-shows-off-new-health-bars.html
6. https://www.surrenderat20.net/2013/02/improved-health-bars-coming-soon-to.html
7. https://www.mobafire.com/league-of-legends/question/camilles-shield-2114
8. https://nerfplz.com/2011/07/how-to-smart-cast-on-league-of-legends.html
9. https://blog.loltheory.gg/how-to-ping-cooldowns-lol
10. https://wiki.leagueoflegends.com/en-us/V25.S1.1
11. https://esports.gg/news/league-of-legends/atakhan-feats-of-strength-league-of-legends-2026/
12. https://www.sportskeeda.com/esports/league-legends-patch-26-1-notes
13. https://www.turtlebeach.com/blog/league-of-legends-season-1-2026-all-objective-changes-atakhan-removed-and-more
14. https://esports.gg/news/dota-2/dota-2-7-35-update-adds-new-minimap-icons-xp-range-indicator-and-more
15. https://www.invenglobal.com/lol/articles/15067/three-in-game-settings-that-you-need-to-change-in-league-of-legends-ft-geng-nemesis
16. https://www.pcgamesn.com/dota-2/options-settings
17. https://lolesports.com/news/summer-broadcast-updates-the-hud
18. https://www.esports.net/news/lol/first-stands-controversial-new-overlay/
19. https://lol.fandom.com/wiki/New_To_League/Understanding_the_Stream/The_Minimap
20. https://blog.loltheory.gg/how-to-unlock-camera-lol/
21. https://liquipedia.net/dota2/Minimap
22. https://www.pcinvasion.com/?p=126762
23. https://blog.loltheory.gg/how-to-ping-lol/
24. https://comicbook.com/gaming/news/league-of-legends-preseason-update-pings/
25. https://comicbook.com/gaming/news/league-of-legends-bait-ping-update/
26. https://x.com/LeagueOfLeaks/status/1711810896002253145?lang=en
27. https://www.dexerto.com/league-of-legends/lol-devs-plan-to-remove-bait-ping-feature-after-slamming-unacceptable-abuse-2302857/
28. https://wiki.leagueoflegends.com/en-us/Ping
29. https://support-leagueoflegends.riotgames.com/hc/en-us/articles/201752704-Chat-Commands
30. https://afkgaming.com/esports/guide/lol-patch-134-chat-features-commands-party-chat-mute-self-deafen-explained
31. https://support.riotgames.com/league-of-legends/gameplay/how-to-mute-and-block-players
32. https://dota2.fandom.com/wiki/Ping
33. https://hawk.live/posts/dota-2-chat-wheel-guide
34. https://lis-skins.com/blog/how-to-bind-a-phrase-in-dota-2/
35. https://www.pcgamesn.com/league-of-legends/death-recap
36. https://www.oneesports.gg/league-of-legends/here-is-your-first-look-at-the-new-league-of-legends-death-recap-screen/
37. https://leagueoflegends.fandom.com/wiki/Death_recap
38. https://metabot.gg/en/league/guides/ad-vs-ap-damage-types
39. https://www.ludo.guide/guide/dota-2/gameplay-mechanics-systems/game-systems-features/dota-plus/death-summary-tool
40. https://www.oneesports.gg/dota2/how-to-view-post-game-analytics-in-dota-2/
41. https://mobalytics.gg/blog/how-to-use-the-league-of-legends-stats-tab-to-improve/
42. https://dota2.gamepedia.com/File:Spectator02gamestats.jpg
43. https://wiki.leagueoflegends.com/en-us/Settings
44. https://www.esports.net/wiki/guides/how-to-zoom-out-league-of-legends/
45. https://www.gosunoob.com/guides/lol-zoom-out-further/
46. https://lensviewing.com/what-is-the-camera-angle-used-in-league-of-legends/
47. https://support-leagueoflegends.riotgames.com/hc/en-us/articles/46818184335763-League-of-Legends-Keyboard-WASD-Input-FAQ
48. https://ixbt.games/en/news/2025/12/02/avtory-league-of-legends-predstavili-upravlenie-na-wasd-i-rezim-razvedki-dlia-igrovoi-kamery.html
49. https://news.exitlag.com/news/league-of-legends-2026-season-impressions/
50. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/CDOTABaseGameMode.SetCameraDistanceOverride
51. https://www.sportskeeda.com/esports/5-tips-master-camera-movement-dota-2
52. https://esports.gg/guides/dota-2/how-to-lock-your-camera-in-dota-2
53. https://danouellette.com/infinitecrisis
54. https://support.riotgames.com/en-us/league-of-legends/gameplay/colorblind-mode
55. https://en.number13.de/league-of-legends-change-these-settings-as-a-new-player/
56. https://www.gamepressure.com/newsroom/lol-colorblind-mode-is-useles-for-players-suffering-from-actual-c/za2e03
57. https://dota2.fandom.com/wiki/Health
58. https://www.gamersunchained.com/news/health-bars-are-now-more-visible-in-dota-2-and-voting-opens-for-collectors-cache
59. https://mobalytics.gg/blog/lol-s13-must-have-settings/
60. https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/
61. https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf
62. https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-1-creating-areas-of-focus/11614
63. https://www.vfxapprentice.com/blog/10-league-of-legends-vfx-design-tips
64. https://devtrackers.gg/leagueoflegends/p/668c1112-syndra-vfx-update-pre-pbe-preview
65. https://forums.playdeadlock.com/threads/a11y-colorblind-setting-for-enemy-colors.10548/latest
66. https://liquipedia.net/dota2/Spectating
67. https://hawk.live/posts/valve-updated-spectator-hud
68. https://www.sportskeeda.com/esports/massive-dota-2-update-brings-the-international-compendium-quality-life-changes
69. https://digistatement.com/dota-2-valve-adds-15-minute-delay-on-dota-tv/
70. https://afkgaming.com/dota2/news/7278-gorgc-bashes-one-esports-community-broadcast-guidelines-for-singapore-major
71. https://esports.gg/news/dota-2/replay-revulsion-editor-unhappy-with-changes-to-dota-2-replay-system/
72. https://wiki.leagueoflegends.com/en-us/Spectator
73. https://www.pcgamer.com/uk/the-full-breakdown-on-league-of-legends-spectator-mode
74. https://www.pcgamer.com/uk/league-of-legends-spectator-mode-revamp-adds-time-controls-and-ai-driven-camera
75. https://www.surrenderat20.net/2012/04/full-spectator-mode-included-in-next.html
76. https://clip.dor.gg/en/blog/league-of-legends-replay-guide
77. https://mein-mmo.de/en/league-of-legends-replay-system,119869
78. https://www.sheepesports.com/en/all/articles/league-of-legends-season-1-2026-begins-everything-you-need-to-know/en
79. https://www.gfinityesports.com/dota/major-changes-before-ti10/

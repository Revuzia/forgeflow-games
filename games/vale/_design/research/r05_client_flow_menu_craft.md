# R05: Client Flow, Screen Inventory, and the Craft of Finished Menus

Research brief for **VALE** (Forgeflow Games). Compiled 2026-10-07.
Scope: the out-of-match product (the "client"), how a shipped lane-brawler moves a player from launch to match and back, and what makes menus feel finished instead of placeholder.
Primary reference: League of Legends (LoL) as of 2025-2026. Secondary: Dota 2. Others are mentioned for comparison only.

> **How this was gathered (read this first).** Facts come from web search results; every claim carries an inline citation [n] that maps to the Sources list. Direct page fetches were blocked by the network egress proxy for every domain tried (LoL wiki, leagueoflegends.com, riotgames.com, technology.riotgames.com, nexus.leagueoflegends.com, dota2.com, developer.valvesoftware.com, gamespot.com, gamedeveloper.com, valhead.com), so claims rest on search-result summaries rather than full articles. The shared web-search budget for this run ran out partway through the menu-craft section. Because of that, the planned searches on Overwatch/Hearthstone GDC UI talks, gameuidatabase.com, interfaceingame.com, skeleton loaders, and UI audio were never run. Where section 3 goes past what the sources confirm, the text is marked **[unverified]** and should be read as practitioner synthesis, not as a reported fact.

---

## 0. Key takeaways

1. **The client is a product with its own performance budget.** Riot treated "client boot time" and "champ select lock-in time" as headline metrics and spent years on a dedicated cleanup campaign to improve them [13][14]. Slowness in menus reads to players as a broken game.
2. **The flow is a funnel with timed gates.** It runs Home, then Play/mode, then Party lobby with positions, then Queue, then a short ready check (12 s in LoL [22]), then a timed draft, then Loading, then the Match, then a timed honor vote, then Post-game, and back to the Lobby. Every gate has a timer, a visible state, and a penalty or fallback for not responding [22][23][28].
3. **Social coordination is built into draft UI.** Pick/ban intent is shown to allies before you lock [19], and position swaps take one click with no typing (LoL 25.08 [20]). Trades are short, timed requests [17].
4. **Both leaders are moving toward fewer decisions before the match.** Dota 2 replaced its in-match ban phase with ban preferences saved on the account [43][44]. LoL now auto-assigns Smite and support items [20] and enforces position selection in the lobby [26].
5. **The home screen has become a season stage.** LoL's 2025 "Activity Center" put the season theme, the pass, and missions on the landing page and moved news into a separate overlay called the "Info Hub" [2][3]. Dota 2 rotates the whole dashboard background to match the current live event [48].
6. **Dota 2's lasting strength is a client that teaches and shows.** It has a built-in Watch/DotaTV tab with live previews and graphs [34][35], replays with DVR and player-perspective camera [41], a team graph on the post-game page [40], a hero grid you can edit and share [36], a no-queue Demo Hero sandbox [33][37], and a filterable custom lobby browser [38][39].
7. **The next step is a client merged with the game.** Riot has confirmed a new "around-game" client for 2027, merged with the game experience. Reports say it uses one application in the manner of VALORANT [5][6][8]. A browser game like Vale starts with that advantage, because the menus and the 3D match share one runtime.
8. **Finished menus come from complete state coverage, consistent motion, and restraint, more than from ornament.** Riot's client visual language rests on three shapes, each with one job [16]. Motion guidance puts most UI transitions in the 100 to 300 ms range, using ease-out for things that enter and faster ease-in for things that leave [51][52][53].

---

## 1. League of Legends: the client as it exists now

### 1.1 Architecture, and the lessons it teaches

- The LoL client is a web stack inside a native shell. The front-end runs in the Chromium Embedded Framework (CEF). Data-side "back-end plugins" are C++ REST microservices, and the presentation side is made of JavaScript plugins [10][11]. Each plugin can be built, tested, and deployed on its own, and plugins declare API changes with semantic versioning [11].
- The design gave teams freedom to use their own frameworks. Some teams avoided Ember.js and used web components directly, and others brought in existing apps built with other frameworks [10]. That freedom later cost a lot. In the Client Cleanup campaign Riot cut **63% of the bootstrap Ember apps and 57% of the plugins**. Boot time for 90% of players fell from **29.5 s to 16 s** during 2020 [13].
- Riot named two target metrics: **client bootstrap time** and **champ select lock-in time** [14]. It also fixed slow filtering in the champ select grid [13]. A CEF upgrade in patch 11.17 cut memory use, CPU use, and crash rates [12].
- The "Animation in the League of Legends Client" engineering post says the client looks like a web app but is really a game UI with high-quality visuals. The team used CSS animations, the Web Animations API (`Element.animate`), GSAP, Lottie, Canvas/WebGL, and pre-rendered video, chosen case by case, because **no single tool covers every case** [15]. CSS animation hit render-performance limits early [15].

**Why it matters for Vale:** use one UI framework and one component library from the start. Track boot-to-interactive time and draft-lock latency as KPIs. Choose the animation technique per element type instead of using one tool for everything.

### 1.2 Visual-language principles (functional, not stylistic)

- Riot wanted a fantasy-flavored client without stock fantasy-UI clichés. The idea was to frame the whole client as an in-world tool the player operates [16].
- The shape language comes down to **three shapes, each with one job**. The square gives structure and stability, the diamond guides the eye to key information, and the circle pulls focus to primary items that need a reaction [16].
- A stated goal was that the language should scale to new features **without a dedicated visual artist** for every screen [16]. In other words, it is a system and not hand-painted one-offs.

The transferable principle is that shape carries meaning. If one shape always means "act now", players learn where to look. Riot's specific shapes, gold-and-blue palette, frames, and ornaments are protected expression (see section 5b).

### 1.3 Screen inventory and flow (current LoL)

| Stage | What the player sees and does | Gate / timer / fallback | Source |
|---|---|---|---|
| **Launch / boot** | Client loads. Players of every spec saw faster loads in 2025 | Boot time is a tracked KPI | [3][13] |
| **Home ("Activity Center")** | Tabs on the left for the season theme, the season pass, other in-client experiences, and patch notes. The top area shows current pass level, XP progress, and the next reward. A mission list shows description, progress, and reward | n/a | [2][3] |
| **Info Hub** | An overlay on top of the Activity Center that rotates news: cinematics, skins, champions, esports, dev updates | Kept apart from the home screen to reduce clutter | [2] |
| **In-client narrative** | A motion comic at the 2025 S1 launch, and a seasonal client meta-game ("Demacia Rising") in 2026 S1 | n/a | [3][26][27] |
| **Profile** | No longer a navigation tab. You open it by clicking your profile icon | n/a | [1] |
| **Play, then mode select** | Mode choice, presented as tiles/cards **[unverified: current visual layout]** | n/a | n/a |
| **Party lobby** | Invites, plus position selection, which is now **required in all Summoner's Rift games** (2026) | Position enforced before queue | [26][27] |
| **Queue, then ready check** | Accept/Decline popup when a full match is found | **12 s**. Anyone who declines or misses it sends the rest back to queue. Repeat offenders get dodge penalties (in ranked: a 6-minute queue lockout and a 3 LP loss) | [22][23] |
| **Champion select (draft)** | Intent: a hovered pick appears in your circular portrait and a ban intent in a separate square portrait, both visible to allies before your turn. Bans and picks take turns in a timeline. Skin and loadout choices sit in the same screen | Each pick or ban has a timer of about 30 to 40 s, depending on the version and source [17][18] | [17][18][19] |
| **Trades/swaps** | Pick-order trade: Swap button next to an ally portrait, before either player locks. Champion trade: click the ally after everyone has locked. One-click **Role Swap** request (25.08) | Pick-order trade request lasts 10 s, champion trade 30 s | [17][20] |
| **Automation in draft** | Smite auto-assigned to junglers, support item auto-granted (25.08). Free rune pages raised to 3 (26.1) | Removes mistakes made under time pressure | [20][26] |
| **Draft integrity** | If a player in champ select is reported and confirmed as griefing, the lobby is ended (26.1) | Lobby terminates | [26][27] |
| **Loading screen** | One card per player with the skin's loading art, a border that shows current rank (Silver and above), a level border, and an alternate view with champion mastery | Border updates the moment you rank up | [24][25] |
| **Post-game: honor** | Before the post-game lobby, each player gets a short timed vote to commend one teammate in a category (reported as about 40 s, three categories). In 2025 Honor reset everyone to level 3 and stopped resetting each year | Timed. Skippable [unverified] | [28][29] |
| **Post-game lobby** | Scoreboard, progression, and return to lobby or play again **[unverified: current layout, graph availability]** | n/a | n/a |
| **Collection** | Holds pre-game items (loadout) and personalization items. Champion and skin grids can be filtered by role and ownership, and skins grouped by champion, set, or tier **[filter details unverified]** | n/a | [1] |
| **Store** | Featured items, bundles, rotating sales, and a Buy RP flow (choose a payment method, pick a currency bundle, balance updates on confirm). Clicking a skin card opens details and an animation preview | Purchase confirmation step | [30][31] |
| **Settings** | Sections for client and in-game settings **[unverified: current section list]** | n/a | n/a |

### 1.4 2025 to 2026 changes, and where LoL is heading

- **2025 season-first redesign.** Riot's stated aim was to cut noise and clutter and put the season's theme up front almost everywhere. News was moved out of the home screen into the Info Hub overlay [2]. Home, Profile, and Collection were the main areas redesigned [1][3].
- **League Next (2027).** Riot has confirmed a brand-new "around-game" client fully integrated with the game, a full visual overhaul of Summoner's Rift, related gameplay and runes changes, and a better new-player experience [5][6][59]. Reporting says the separate launcher will be replaced so players reach the game faster [7]. Some outlets also say client and engine will be merged into one app with animated 3D champions in the menus, as in VALORANT. **Treat the 3D-menu detail as reported, not confirmed** [8]. At a summer-2026 briefing, executive producer Paul Bellezza said the new client is on track, with more details due by year-end [9]. Data-mined hints of a third ("tertiary") role preference in queue are **speculative** [21].

**Design reading.** In 2025 and 2026 Riot's client changes went in one direction: fewer decisions under time pressure (auto Smite, auto support item, one-click role swap, enforced positions), a home screen that shows the season and progress first, and a merge of menus with the game. The pain points they address are slow boots, a clunky lobby-to-game handoff, and screens that feel separate from the game.

---

## 2. Dota 2: client strengths worth studying

Dota 2's dashboard was rebuilt from scratch on Valve's **Panorama** UI framework for the 2015 "Reborn" update [32][50]. Panorama works like web authoring: XML for layout, CSS for style, and JavaScript for behavior. Unlike a plain web page, it can place game content such as 3D models and particles directly inside the UI [49]. The top-level headers are Heroes, Watch, Learn, Custom Games/Arcade, and Store [32].

| Strength | What it does | Why it works | Source |
|---|---|---|---|
| **Watch tab / DotaTV** | Lists live tournament games, high-skill games, and friends' games. Each live preview shows game state, gold and XP graphs, and player stats so you can choose what to watch | Watching becomes a browsable shelf with enough information to choose from | [34][35] |
| **Spectator cameras** | Directed camera, free camera, player perspective, and hero chase. Spectators choose which team's fog of war to see | Different camera modes suit different viewers (casual, analyst, learner) | [34] |
| **Replays** | "Watch Later" bookmark. Replays of friends' games and top-rated replays. DVR rewind. Player-perspective playback shows that player's cursor and UI use | Learning by watching happens inside the client, with no extra tools | [35][41] |
| **Replay UX caveats** | Replay speeds were moved into a dropdown, which video editors complained about. Replay downloads expire after a set window | Hiding a control that power users need often draws complaints | [41][42] |
| **Match details / post-game** | Scoreboard tab (items, K/D/A, net worth, GPM/XPM), Graphs tab (team net worth and XP over time, to find turning points), a damage breakdown for subscribers, and an MVP screen with two honorable mentions | The graph explains why the match was won or lost. The MVP screen recognizes more than one player | [40] |
| **Post-game graphs upgraded** | The 2025 Spring Forward update improved post-game graphs, among many quality-of-life fixes | They keep investing in post-game review | [47] |
| **Hero grid editor** | Several grid presets, drag-and-drop heroes, categories you can rename and resize, export and share | Players can sort heroes to match their own approach | [36] |
| **Demo Hero** | A button on each hero page opens a solo sandbox right away, with no queue, no MMR at stake, instant levels and items, target dummies, and options for no cooldowns or infinite mana. It also previews equipped cosmetics, including ones you don't own | Try before you play, and try before you buy, with no social cost | [33][37] |
| **Custom lobby browser** | Lists open lobbies with filters and sorting by game type, connection quality, slots left, and friends or local network. Each custom game gets its own landing page | Players can find a game without leaving the client | [38][39] |
| **Ban preferences** | The in-match ban phase was removed (7.35d). Players save up to four avoided heroes on their account, and at least one is guaranteed to be banned | Fewer decisions in draft and fewer misclicks. Draft-assistant cheats lose their value | [43][44] |
| **Pre-match analytics** | An experimental subscriber feature shows expected skill spread, ping, and behavior scores, with the option to accept or requeue | Shows how the matchmaker decided | [45] |
| **Settings search** | Settings were reorganized with a search bar, and new settings are flagged as new | Players can find settings in a large settings menu | [46] |
| **Event-driven dashboard** | The main menu background is swapped to the current event, and older events drop to a smaller banner slot (Sept 2026) | The menu reflects the current event without a redesign | [48] |

---

## 3. Menu craft: what separates finished from placeholder

### 3.1 Motion timing

The table combines published UI-motion guidance [51][52][53]. These are web and app guidelines. Game menus often run a little slower and more expressive on purpose. Carbon calls this "expressive" motion, and Material says emphasized easing with longer durations reads as more stylized while utility screens should stay short and standard [53][54].

| Interaction class | Duration guide | Notes |
|---|---|---|
| Micro-feedback (toggle, checkbox, pip) | about 100 ms | Feels instant [51][52] |
| Hover, press, tooltip, dropdown | about 150 to 200 ms | Most common range [52] |
| Menu open, larger state change | about 200 to 300 ms | Most UI motion should stay under about 300 ms [52] |
| Layout change (drawer, modal, accordion) | about 300 to 500 ms | Use for panels that move a long way [52] |
| Exit animations | about 75% of the enter duration | Things leaving should not hold attention [52] |

Perception anchors from the same guidance: about 100 ms reads as instant, about 230 ms is roughly how long it takes to visually register a change, and about 1 s is where attention starts to drift [52]. Material 3 defines its timing as named tokens, starting at 50 ms (`short1`), plus emphasized and standard easing curves in accelerate and decelerate variants [54][55]. **The principle: define motion as tokens, never as one-off numbers.**

Easing: use ease-out (fast start, soft landing) for things that enter and ease-in for things that leave. Don't use ease-in for things that enter, because the slow start feels sluggish [52].

### 3.2 Choreography and reveal sequences [mostly unverified]

- **Stagger, don't dump.** Lists and grids that fade in as a cascade (each tile about 20 to 40 ms after the last) look built rather than pasted. Cap the total so a 100-item grid doesn't take two seconds **[unverified]**.
- **Reveal in order of importance.** Post-game should go outcome banner, then the player's own result, then progression bars filling, then rewards, then social actions (honor, play again). LoL puts the honor vote before the post-game lobby as its own timed step [28]. Dota stages its MVP screen before the details [40].
- **Number tick-ups** (XP, currency, rank points) should count with ease-out over about 0.6 to 1.2 s, play a soft tick sound with pitch rising toward the end, and finish on a "landed" accent. Players need a way to skip **[unverified]**.
- **Juice is communication.** Game-feel writing describes juice as constant, generous feedback, so that every input confirms itself with sound and motion [56][57]. In menus that means each click gets an answer within one frame, plus a sound.

### 3.3 State coverage: the clearest sign of a finished menu

Every interactive element needs a designed look for each state below. Placeholder UI usually has only the default and maybe a hover. The rows are a practitioner checklist **[unverified as a cited standard]**. The LoL and Dota examples are cited.

| State | Requirement | Example from shipped games |
|---|---|---|
| Default | Clear affordance (looks clickable) | n/a |
| Hover / focus | Visible within one frame. **Keyboard/controller focus must look as strong as mouse hover** | n/a |
| Pressed | Brief depress, plus a sound on press, not on release | n/a |
| Selected / active | Lasts after the pointer leaves, and stays distinct from hover | Draft intent portrait vs locked pick [19] |
| Disabled | Dimmed and explains why (tooltip) | n/a |
| Locked (not owned / not yet unlocked) | Different from disabled. Shows a path to unlock (price, level, mission) | Ownership filters in the collection [1]. Mastery hidden until a threshold [24] |
| Loading | Skeleton or placeholder at final size (no layout jump). Spinner only when the wait is long | Riot treated lock-in and grid filtering speed as KPIs [13][14] |
| Error | Plain message, a retry, and no dead end | Ready-check failure returns you to queue automatically [22] |
| Empty | A designed empty state with a next action ("No replays yet: watch a featured match") | n/a |
| Timed | Countdown visible on the element itself, with an urgency change near zero | Ready check (12 s), trades (10/30 s) [17][22] |
| New / unseen | Badge that clears once seen | Dota marks new settings as new [46] |

### 3.4 Latency hiding and perceived speed [partly unverified]

- **Optimistic UI.** Show the result of an action right away, then roll it back if the server rejects it. This suits favorite, hover-intent, and equip actions. Do not use it for purchases.
- **Purchase confirms are deliberately not optimistic.** They need an explicit confirmation step and then a celebration once the server confirms [30][31].
- **Preload the next likely screen.** While the player is in queue, preload the draft screen's portraits. During draft, preload the match. LoL's tracked KPIs (boot, lock-in) show that the moments around the queue are where waits feel worst [14].
- **Use waits to show content.** The loading screen shows teammates and opponents with rank and mastery [24], so the wait becomes scouting time.

### 3.5 Audio per interaction [unverified]

A finished client has a small, consistent set of UI sounds: hover (very quiet, rate-limited), press, confirm, back/cancel, error, tab switch, reward, timer-urgent, and match-found (loud, must cut through an alt-tab). The match-found sound matters most in the whole client because it brings players back to the window during the 12 s ready check [22]. Keep a separate UI volume slider.

### 3.6 Backgrounds, depth, and liveness

- Both reference clients use the **background as the live event channel**. LoL builds the home screen around the season theme [2], and Dota swaps the dashboard background for the current event [48].
- Panorama integrates 3D models and particles into the UI [49]. League Next is reported to bring 3D champions into menus [8]. Riot's older client used pre-rendered video where real-time rendering cost too much [15].
- For the web: GPU-backed Lottie renderers now exist (dotlottie-web ships WebGL/WebGPU backends), because rasterization was the bottleneck [58]. In general: use a cheap, layered parallax or a light 3D scene, pause it when the tab is hidden, and offer a reduced-motion option **[unverified as a cited practice]**.

### 3.7 Grid, typography, ornament, iconography

- **Ornament with a job.** Riot's visual language limits decorative shapes to roles (structure, guidance, focus) and was built to scale without bespoke art for each screen [16]. The craft lesson is to decorate the hierarchy, not the empty space.
- **One spacing scale and one type ramp** (for example, 4/8 px spacing; display, title, body, caption, number). Use tabular numerals for timers and stats so digits don't jitter while counting **[unverified]**.
- **Consistent icon grammar.** Use one stroke weight, one corner rule, and one meaning per icon across the client. Rank, role, and currency icons should look the same in the lobby, the loading screen, profile, and post-game, as LoL's rank border does [24][25].

### 3.8 Input, accessibility, and localization [unverified unless cited]

- Every screen should be fully usable by keyboard (and gamepad, if planned), with visible focus rings and predictable tab order. Esc means back, Enter means confirm. Do not move focus without a reason.
- Provide UI scale (at least 80 to 150%), a colorblind-safe palette for team colors, and text contrast that meets WCAG AA. Never use color alone for state.
- Localization room: design every label to fit about 30 to 40% longer text. Never put text inside images. Build layouts that can grow.
- Findability: a big settings menu needs search. Dota added it in 2025 [46].

---

## 4. Common failure modes of indie and jam menus [practitioner synthesis, unverified]

| Failure | What the player feels | Fix |
|---|---|---|
| Default browser/engine widgets (stock buttons, scrollbars, select boxes) | "Prototype" | Build your own component kit with every state from 3.3 |
| Only a default state, or default plus hover | Clicks feel dead, and focus is invisible on keyboard | Full state matrix, with a sound on press |
| Spacing and font sizes chosen by eye on each screen | A vague sense of wrongness | Spacing tokens and a type ramp, enforced by lint or review |
| Screens appear and vanish with no transition | Feels cheap and gives no sense of place | Shared transition grammar: content slides in the direction you navigate, and modals scale and fade |
| Text-only buttons with no hierarchy | Unclear which action matters | One primary action per screen, visually dominant. Riot keeps one shape for focus [16] |
| No loading, empty, or error states | Blank panels, frozen clicks, dead ends | Design these first, because they are what players see on slow connections |
| Everything animates, slowly | Feels sluggish | Keep most motion between 100 and 300 ms. Make exits faster than entrances [52] |
| Blocking spinners during server calls | Waits feel longer | Optimistic UI, preloading, skeletons |
| Ornament everywhere | Noise, and no hierarchy | Ornament marks hierarchy only [16] |
| Post-game is just a "You Win" label | Little reason to queue again | Staged reveal, progression fill, recognition, a one-click requeue |

---

## 5. Implications for Vale

### (a) Principles and systems worth adopting, in original form

1. **Use a funnel with visible gates.** Home, Play, Party lobby (positions chosen here), Queue, a short ready check of about 10 to 15 s, a timed draft, Loading (scouting cards), the Match, a short timed recognition vote, staged post-game, then one-click requeue or return to lobby. Each gate needs a timer, a state, and a fallback [22][17][28].
2. **Show draft intent to allies.** Allies should see your hover/intent before you lock it in [19]. Add one-click role-swap and pick-swap requests with short timeouts [17][20].
3. **Take decisions out of the timed window.** Auto-assign obvious loadout items. Consider saved ban preferences per account, or a short draft with defaults that are already filled in [20][43][44]. Make a loadout editor (Vale's version of runes) available outside draft so draft only confirms.
4. **The home screen is the season stage.** It shows the season theme, pass progress (level, XP, next reward), and missions. News sits in a separate dismissible overlay [2][3]. The background is the live event channel [48].
5. **Measure performance from day one.** Treat time from boot to interactive, draft lock-in latency, and screen-transition frame time as tracked KPIs [13][14]. Use one UI framework and one component library. Riot's multi-framework client needed a long cleanup [10][13].
6. **Match the animation tool to the job** [15]. CSS or the Web Animations API for state changes, a tween library for choreography, GPU Lottie or sprite sheets for ornate vector effects [58], Three.js scenes for 3D backdrops and champion turntables, and pre-rendered video only for heavy, non-interactive intros.
7. **Use our advantage: menus and match share one runtime.** Vale's menus and match already share one WebGL2 runtime, which is what League Next is building toward [5][8]. Use the shared runtime for live 3D in the menus (hero turntables in collection and draft, a "demo hero" sandbox) instead of separate image assets.
8. **Copy Dota's teaching tools in our own form.** A Demo Hero-style sandbox launched from each hero page [33][37]. A replay system with timeline, speed controls kept visible [42], and player-perspective camera [41]. Post-game team graphs that show turning points [40]. A grid editor players can customize and share [36]. A watch tab with live previews [34][35].
9. **Treat the state matrix as the "done" bar for every component.** Default, hover/focus, pressed, selected, disabled, locked, loading, error, empty, timed, new.
10. **Use motion tokens.** For example `--dur-micro: 100ms`, `--dur-fast: 160ms`, `--dur-base: 240ms`, `--dur-panel: 360ms`, with exits at about 0.75 times the entrance, ease-out for entering and ease-in for leaving [52][54]. Add an expressive set used only for rewards and reveals.
11. **Use a shape language with fixed jobs.** Pick our own small set of shapes, each with one job (structure / guidance / call-to-action), so new screens don't need custom art [16].
12. **Blender in the pipeline.** The team has Blender on the PC. Use it to author original menu backdrops, hero turntable scenes, and reward-reveal props, exported as glTF for the Three.js client. Use it as well for short pre-rendered loops where real-time rendering would cost too much on low-end machines [15].

### (b) Protected expression that must NOT be copied

- Riot's specific visual identity: the Hextech look, the gold-and-teal palette, the exact three shapes as used, frame ornaments, rank emblems and borders, the loading-screen card layout, mastery visuals, the "Activity Center"/"Info Hub" names and layouts [2][16][24].
- Riot names and terms: Riot Points/RP, Honor, the Honor categories and the honor skin line, Mastery, Eternals, Battle Pass branding, champion names, splash art, skins, and the sounds of the client (the match-found sound, music) [28][30].
- Dota 2's names and assets: DotaTV, Dota Plus, the hero portraits, the Panorama dashboard art and layout, Demo Hero branding, Arcade branding [33][34][40].
- Exact screen layouts and component arrangements of either client, including the draft screen's arrangement of portraits, columns, and timer bar. Re-derive layout from Vale's own information hierarchy.
- Any fonts, icon sets, UI sounds, or announcer voice lines from either game.

### (c) Open questions

1. **Draft model.** A full alternating ban/pick draft (LoL ranked) or saved ban preferences with a quick pick (Dota 2 style)? This affects queue-to-match time and how much the draft screen has to explain.
2. **Ready-check length in a browser.** A browser tab is easy to lose. Should Vale use the Notification API, the tab title, or the favicon to signal match found? What timeout is fair, given 12 s in LoL [22]?
3. **Requeue policy.** After a decline, does the rest of the party automatically go back to queue at their place, as in LoL [22]?
4. **3D in menus vs low-end hardware.** Collection and draft turntables could be live, but what fallback do we use when the GPU budget is tight? (Pre-rendered loops made in Blender, or still images?)
5. **Replays in a browser.** Can the deterministic simulation support replay-from-inputs, so the replay system is cheap? How long are replays kept [41]?
6. **Post-game recognition.** A commend vote (LoL), an algorithmic MVP (Dota) [28][40], or both? How do we resist people using it to grief?
7. **Monetization surfaces.** Where does the store sit relative to the home screen? What preview depth (3D try-on, demo sandbox with cosmetics as in Dota [37]) do we offer before purchase?
8. **Accessibility baseline.** Which UI-scale range, colorblind modes, and reduced-motion behavior do we commit to at launch?
9. **Research gaps to close later.** These searches were cut off by budget: the Overwatch, Hearthstone, and Destiny GDC UI talks, gameuidatabase.com and interfaceingame.com reviews, LoL's current post-game screen and settings sections, and skeleton-loader and UI-audio sources. Re-run them before locking the UI spec.

---

## Sources

1. https://wiki.leagueoflegends.com/en-us/Client
2. https://www.leagueoflegends.com/en-us/news/dev/dev-seasons-in-2025/
3. https://wiki.leagueoflegends.com/en-us/V25.S1.1
4. https://www.mobafire.com/league-of-legends/news/pbe-25-s1-1
5. https://www.dexerto.com/league-of-legends/riot-confirms-plans-for-lol-shakeup-in-2027-with-new-visuals-client-3296182/
6. https://www.gamesradar.com/games/league-of-legends/league-of-legends-is-getting-a-new-client-entirely-new-visuals-and-a-bit-of-new-gameplay-in-a-massive-2027-update-reportedly-codenamed-league-next/
7. https://www.gamespot.com/articles/league-of-legends-in-line-for-major-overhaul-here-are-all-of-the-changes-so-far/1100-6537097/
8. https://riftdaily.com/league-next/
9. https://x.com/InvenGlobal/status/2077046586471817694
10. https://technology.riotgames.com/node/40
11. https://www.riotgames.com/en/news/under-hood-league-client%E2%80%99s-hextech-ui
12. https://leagueoflegends.com/en-us/news/dev/client-cleanup-we-launched-the-updated-chromium-embedded-framework-cef
13. https://www.leagueoflegends.com/en-au/news/dev/client-cleanup-2020-recap-what-s-ahead/
14. https://leagueoflegends.com/en-us/news/dev/the-client-cleanup-continues
15. https://technology.riotgames.com/node/81
16. https://nexus.leagueoflegends.com/en-us/2016/12/the-visual-language-of-hextech
17. https://wiki.leagueoflegends.com/en-us/Draft_Pick
18. https://mein-mmo.de/en/lol-pick-rank,133513/
19. https://wiki.leagueoflegends.com/en-us/Draft
20. https://www.altchar.com/game-news/league-of-legends-adds-role-swapping-to-champion-select-in-patch-25.08-a55pL0D58lKN
21. https://ggscore.com/en/lol/news/77952
22. https://wiki.leagueoflegends.com/en-us/Queuing_and_Matchmaking
23. https://support.riotgames.com/en-us/league-of-legends/gameplay/queue-dodging
24. https://wiki.leagueoflegends.com/en-us/Loading_Screen
25. https://www.esports.net/wiki/guides/lol-level-borders/
26. https://wiki.leagueoflegends.com/en-us/V26.01
27. https://www.invenglobal.com/articles/20061/league-of-legends-season-1-2026-for-demacia-launches-with-major-gameplay-changes-new-skins-and-esports-format-updates
28. https://leagueoflegends.fandom.com/wiki/Honor
29. https://blog.loltheory.gg/honor-system-lol/
30. https://wiki.leagueoflegends.com/en-us/Store
31. https://blog.usro.net/2025/06/buying-league-of-legends-stuff/
32. https://liquipedia.net/dota2/Dota_2_Reborn
33. https://www.dota2.com/reborn/part1?l=english
34. https://liquipedia.net/dota2/Spectating
35. https://www.tentonhammer.com/guides/spectating-games-in-dota-2.amp
36. https://devtrackers.gg/dota/p/1ed2fc01-summer-scrub-part-2
37. https://jeu.video/en/guide/dota-2-progression-steps-before-matchmaking
38. https://esports.gg/news/dota-2/how-to-create-a-lobby-in-dota-2/
39. https://gosugamers.net/dota2/news/31418-reborn-part-2-custom-games-are-here
40. https://www.oneesports.gg/dota2/how-to-view-post-game-analytics-in-dota-2/
41. https://lhm.gg/post/best-tools-for-dota-2-spectating-observing-and-hud-management
42. https://esports.gg/news/dota-2/replay-revulsion-editor-unhappy-with-changes-to-dota-2-replay-system/
43. https://www.esports.net/news/dota/dota-2-patch-7-35d/
44. https://esports.gg/news/dota-2/how-the-new-bans-work-in-dota-2-ranked-matchmaking
45. https://www.gosugamers.net/dota2/news/70900-dota-2-patch-7-35d-arrives-with-new-matchmaking-features-with-a-hint-about-the-crownfall-update
46. https://www.pcgamesn.com/dota-2/7-39-patch-notes-spring-forward-2025
47. https://tips.gg/article/all-dota-2-spring-forward-changes-new-ui-features-and-fixes-in-patch-7-39/
48. https://www.cgmagonline.com/articles/dota-2-september-updates-bundles/
49. https://developer.valvesoftware.com/wiki/Panorama/Overview
50. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Panorama
51. https://valhead.com/?p=2978
52. https://gunnel.funnel.io/18/01-guidelines/7_animation-principles
53. https://v9.carbondesignsystem.com/guidelines/motion
54. https://material.io/design/motion/customization.html
55. https://api.flutter.dev/flutter/material/Easing-class.html
56. https://www.gamedeveloper.com/design/oil-it-or-spoil-it-
57. https://school.gdquest.com/glossary/juicing
58. https://lottiefiles.com/blog/working-with-lottie-animations/hardware-accelerated-lottie-on-the-web-dotlottie-web-now-ships-webgl-webgpu
59. https://www.engadget.com/gaming/a-total-league-of-legends-revamp-is-coming-in-2027-130000644.html

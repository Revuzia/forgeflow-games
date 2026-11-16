# UI reference audit: DYEFIELD (quality bar for Squish Keeper), 2026-10-08, read-only

Cut short at the coordinator's request after 2.4 h. Evidence tags: [live] seen or measured in the published build, [src] read in source, [calc] computed by me. Nothing in the game folders was edited.

## 1. How to see it
- Live (public): https://forgeflow-games-cdn.isimcha85.workers.dev/dyefield/index.html (CDN_BASE in pipeline/deploy_game.py:716). No CSP header, `no-store` HTML, hashed assets `immutable`.
- The live build is NEWER than the worktree. Live has CAREER and PLAY ONLINE; the worktree (`3c3f23d7`, v1.4.0) has neither. `master` is v1.5.1 (`d461bfb0`, `5472f469`). I read master with `git archive` into scratch. No local build possible (no node_modules; never install).
- Harness: Playwright via `_harness/pw.mjs`, one browser at a time. Dev hooks: `?lobby=1`, `?dev=1&autostart=1&mode=&rule=&map=`, `?statsdev=1`, `window.__DF__`.
- Phone shots are 844x390 dpr 2 (1688x780): DYEFIELD is landscape-only on touch. Portrait is only the rotate overlay (390x844 dpr 2).

## 2. Screens and systems (live)
Boot card (static in index.html) -> title (live 3D Pier 18 under scrims) -> PLAY (map select), LOADOUT, SETTINGS, HOW TO PLAY, CREDITS, CAREER, PLAY ONLINE (home, join, search, room, notice) -> match loading card (arena thumb + name) -> CLICK/TAP TO PLAY -> 3-2-1 countdown with key legend -> HUD -> pause (+ QUIT confirm modal) -> death slate (WASHED BY + 3 s ring) -> victory slate (teams, washout, FFA podium) -> PLAY AGAIN / LOBBY.
Also: error cards (load failed with file + HTTP status + one auto-retry, start failed, stall watchdog, WebGL2 required, mouse capture blocked, graphics reset), rotate overlay, low-tank toast, PROTECTED chip, +1 pop, kill feed, F1 panel, FPS pill, iPhone tip, achievement toast. Count: 7 menu screens + CAREER + 5 online + 6 boot/error cards + 4 slates.
Interactive controls [live]: title 10, PLAY 17, LOADOUT 9, SETTINGS 17 (5 switches, 5 sliders, 22 key-remap buttons; touch 8 and 8).
No unlock-reveal screen and no end-of-run "front page" (Blocktooth has both); DYEFIELD has CAREER + toast.

## 3. Type system
- Display: Lilita One 400 (single weight). Body: Nunito 400/700/800/900. Real fonts: @fontsource, woff2 latin only per request: Lilita 10.7 KB, Nunito 16.2-16.7 KB each [live]. CSS bundle 133 KB raw, 27 KB gz, with two fonts inlined as data URIs. SK may not copy this (font-src 'none').
- Scale [src, counts across 6 CSS files, 200 KB source]: px sizes used 10 to 64; most used 12 (80x), 14 (45), 13 (43), 15 (32), 16 (29), 20 (23). Titles use clamp(), e.g. h2 `clamp(40px,4.3vw,66px)`. Weights: display 400 (131x), Nunito 800 (28), 900 (26), 700 (17). Caps tracking: .03 to .08em on display, .12 to .18em on 11px captions. Numerals: tabular-nums on timers and scores.
- Display lettering is CSS, not drawn: Lilita at 107.5px (1280 wide), `-webkit-text-stroke:4px ink; paint-order:stroke fill; text-shadow:0 6px 0 ink`, DYE #ff8a1f + FIELD #8a7cff, rotate(-3deg), drop-shadow 0 8px 0 rgba(10,20,44,.35). It is static (no wobble). H1 has aria-label "DYEFIELD"; the boot card also has an h1, so two h1 exist while both are in the DOM [live].

## 4. Tokens and surfaces [src styles.css:5-28, measured]
ink #14203a, ink2 #22325a, cream #fff8ec, paper #fdf1dc, sea #1fb5c9, sea-deep #0a6a8c, sky #9cd3ff, sun #ffa84a, sun-dye #ff8a1f, gulf #8a7cff, gulf-dye #5b4bf0, neutral #e9e2d2, ok #43d17a, warn #ffd23f, bad #ff5a5f. 80 distinct hex in all CSS (not tidy).
- Radii: pills 999px (63x), circles 50% (43x), cards 22-24, buttons 18, inner thumbs 14-16. Borders: 4px on cards and pills, 3px on small controls, 2px on chips. Depth = hard drop shadow, zero blur, `0 5px 0 ink` (36x), 3px (36x), 4px (34x), 6px (20x), 8px on cards. Scrims: gradients rgba(10,20,44,.66 to 0), `blur(2-3px)` in 3 places only.
- Cards = cream plate + ink border + drop; chips = ink pill, cream 11px caps; key caps 26x24, radius 8, 2px ink.

## 5. Buttons and states [live computed]
- Title stack item: 320x51, radius 18, 4px border, shadow `0 6px 0 ink`, Lilita 26.24px, tracking .05em. PLAY: 201x72, 39.7px, gradient #ffc27a to #ffa84a, text #2a1300. PLAY ONLINE tile: 102x69, gradient #a6eef6 to #1fb5c9. START: 236x83, bobs (dfBob 1.8s).
- Hover and keyboard focus are the SAME look: crew colour fill, `translateX(12px) rotate(-1deg)`, shadow `0 8px 0` (+ `0 0 0 4px cream` ring on primary), chevron slides open. Press: `translateY(4px)`, shadow `0 2px 0`. Selected card: crew fill + ✓ badge 28-32px at top-right. Disabled (online off): grey gradient #e6e9ef to #b9c1d0.
- No `:focus-visible` outline: 2 rules vs 45 `outline:none`; focus is the hover look, desktop only (`html:not(.df-touch)`). Mouse hover MOVES keyboard focus (menus.ts). Touch gets `:active` brightness .93.
- Sizes: switch 62x34 (touch 76x44), range track 14px + 24px thumb (touch 30px), seg button 40px (touch 44), key-remap button 30-36px. My touch audit at 844x390: zero targets under 44 px on title, PLAY, LOADOUT, SETTINGS [live]; 2 text runs at 11px in HOW TO PLAY.

## 6. Motion [src]
36 keyframes. Springy easings `cubic-bezier(.2,1.6,.4,1)` (12x) and `(.2,1.5,.4,1)` (10x). Transitions .08-.3s (mostly .12-.15s). Countdown digit `scale(3)->1.9` .45s; toast .3s; victory slam .5s; stamp .42s; timer tick .5s. Victory tally: bars fill .35-1.65 s, stamp 1.75 s, buttons .9 s. No panel stagger, no screen transition (screens swap via `hidden`). Reduced motion: 10 `@media` blocks + a SETTINGS toggle (OS default) turn pulses and shakes into fades. Camera shake, confetti, hit markers in juice.ts.

## 7. Icons
No family: 5 SVG strings (cloudburst, wellspring, jelly-charge, dice, gamepad), 9 touch glyphs, text crew marks ◉ ▲ ■ ◆ ★ ✚ ⬟ ⬢ (shape + colour), 3 online glyphs. Ink stroke 1.6-2.8. Kit and map pictures are baked WebP renders (5.6-17 KB): SK has none.

## 8. Sound
4 UI samples (hover, click, back, start) from a 497 KB `sfx.ogg` sprite, plus tick, confirm, special_ready, tank_low, dry, hit_dealt on a UI bus that is never ducked; 5 music cues. Hover sound on mouse focus-move only; toggles and sliders just reuse `click`. SK needs procedural equivalents, not these files.

## 9. Accessibility [src counts + calc]
Good: radiogroups for kits, maps, mode, rule; `role=switch`; stats as `role=meter`; alertdialog; aria-live x9, aria-label x41; colour-blind marks (shape + hatch); key remap with SWAP/CANCEL; spatial arrow and gamepad navigation; Esc/B back; Tab trapped per screen.
Weak: 0 forced-colors and 0 prefers-contrast rules. Contrast [calc]: ink on cream 15.3, ink2 11.9, PLAY text 9.2-11.1, cream on gulf-dye 5.4. Failing: cream on sun-dye 2.23 (score chips, ink stroke only), error red on cream 2.89, empty key 2.53, placeholder 2.17, locked achievement title 2.58, switch-off track vs card 1.38, silver/gold tier chips 1.72/1.33.

## 10. Portal integration [src master + live]
postMessage to `window.parent`, silent no-op standalone. `forgeflow:load {slot:1,_reqId}` probes (5 tries, about 60 s) -> `save_loaded`; `forgeflow:score {int}`; `forgeflow:achievement {achievementSlug}` paced 3 s apart, once per slug per page; `forgeflow:save` debounced 1.5 s; reply origin allowlist. 29 achievements, 340 XP (bronze 5, silver 15, gold 30) from `stats/achievements.json`, also read by the seeder `pipeline/seed_dyefield_achievements.py`. Toast: top-centre 420x60, cream, 4px ink, 3.2 s each, queued, "+N more" after 3, "+15 XP" signed in else "Saved on this device". CAREER panel: 8 cards (4 tiles, 4 modes, records, totals, kits, arenas, online, 29 achievements, last 10 matches).
Store: `public/game_meta.json` (`mobile_support:"full"`), `thumbnail.png` 1280x720 1.38 MB, manifest + 4 icons, README 250 lines. No ForgeFlow controls bar (`game_controls.js` 404; Blocktooth has it). Its index.html has an inline `<style>` and inline boot-guard script: not valid under SK's strict CSP.

## 11. Shared studio house style (DYEFIELD vs BLOCKTOOTH)
Shared: one in-world metaphor and copy; thick ink outline + HARD zero-blur offset shadow; tracked caps display face over one body face; key-chip hint bar bottom-right; boot card with marching diagonal-stripe bar; boot guard + fatal card with RELOAD; bundled fonts; achievement slug bridge; game_meta + thumbnail + README. DYEFIELD is round, cream, phone-ready; BLOCKTOOTH is skewed, sharp, desktop only. SK should take the structure, not the hard-shadow surface.

## 12. Gaps SK can beat
Static CSS-text title; no panel choreography; no focus ring; no contrast-more or forced-colors; 80 loose hex colours; hover=focus; no unlock screen.

## 13. Not done
No screenshot of a real unlock toast (the stats record became eligible once, `first_match` unlocked, but the toast had hidden before capture; the injected-markup pass was killed). No reduced-motion, forced-colors or prefers-contrast shots; phone touch audit stopped after HOW TO PLAY. Blocktooth phone skipped (mobile none). PLAY ONLINE search/room/notice need a server: not seen.

## 14. Screenshots
Dir `C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad/ui/dyefield/shots/`. Prefix `d` desktop 1280x800, `p` phone, `bd` Blocktooth.
- d01 boot loading; d03 title; d04/d04b/d05/d05b title hover loadout, hover play, pressed, keyboard focus; d06 PLAY; d08 PLAY FFA+washout+storm; d09, d10, d11 LOADOUT (FFA, pop-well, gulf+name); d12, d13, d13b, d14 SETTINGS (default, key listening, key conflict, scrolled); d15 HOW TO PLAY; d16 CREDITS.
- d17 loading arena card; d18 CLICK TO PLAY; d19, d25 countdown; d20, d26, d34 HUD; d27 low tank; d28 WASHED BY; d29 final seconds; d30, d31, d32, d33 victory slates (teams, FFA washout: `_ffa_washout_`); d22, d23, d24 pause, pause settings, quit confirm.
- d40, d41 PLAY ONLINE home, JOIN ROOM; d42, d43 CAREER empty; d44, d45 (+_s1..s3), d46 CAREER after a match; d50 load-failure card.
- p01 rotate overlay (390x844); p03 title; p06 PLAY; p09 LOADOUT; p12, p14 SETTINGS; p15, p15b HOW TO PLAY; p16 CREDITS; p17 loading card; p19 countdown; p20, p26 touch HUD; p22 pause; p24 quit; p28 WASHED BY; p31 FFA victory; p40, p41 online; p42, p43 CAREER; p44, p45 CAREER with data.
- bd01 Blocktooth boot; bd03 title; bd04 goals; bd05, bd06 select; bd10, bd12 HUD; bd13 pause (mid-fade); bd14 settings.
- `meta_*.json` and `*.mjs` capture scripts are in the parent folder `ui/dyefield/`.

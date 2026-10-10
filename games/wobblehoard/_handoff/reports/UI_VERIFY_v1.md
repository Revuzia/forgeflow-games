# UI_VERIFY_v1: V1 ART DIRECTOR (independent), snapshot of commit 44cc7aca

Method: `git archive 44cc7aca` snapshot + node_modules junction (live tree untouched, no git writes, no game edits). Real game on vite 5540 / 5541, Playwright mouse / CDP touch / keyboard, one browser at a time, machine at 100 % CPU (shots slow). Evidence folder `<scratch>/3b1103ab-.../scratchpad/verify_ui_v1/` (below `S/`): `S/raw` = builder-style 21 scenes x 7 sizes (JS-driven opens), `S/sheets` contact sheets, `S/mine/<size>` = my real-input run (title, hover, focus rings, tooltips, cut, snap, float, menu stack, Hoard family, error, photo; AUDIT / JL / SCROLLBOX lines in `log.txt`), `S/mine/probe2` reachability numbers, `S/mine/probe3` Calm, plate rects, boot card. Real-input depth: 1280x800 (full), 888x500 (full, incl. reveal tiers), 358x201 (light). 390x844, 844x390, 568x320, 320x568 are judged from the 21-scene pictures plus probe numbers (not re-driven: time and CPU).
Studio levels from the `UI_REF_*` pictures: DYEFIELD = cream plates, 4 px ink border, hard drop shadow, big chunky Lilita buttons; BLOCKTOOTH = showpiece lockup, test-card pause, tabloid achievements. SK deliberately takes the structure, not the hard shadow (UI.md 11).

## 1. Parity scorecard (UI.md 2). Ref = BT/DF/Now > Target
| Criterion | Ref | After | Judgement and picture |
|---|---|---|---|
| Title | 4/4/2>5 | **4** | Glossy jelly lockup, live scene, gel CTA: premium. Not 5: tagline pill and 30 px chips read like a web page under a 330x66 CTA (`mine/1280x800/t01_title`); at 568x320, 358x201, 320x568 plate or lockup sits on the squishy's peak. |
| Pause (Menu) | 5/4/0>5 | **4** | Tidy, jelly heading, gel Resume, six rows (`raw/menu_1280x800`). No personality beyond a list; BT's test card and DF's chunky cards have more. |
| Settings | 3/4/2>4 | **4** (3 on short) | Clean groups, 28 px thumbs. 888x500 shows 354 of 1370 px, 358x201 about 1.5 rows (`sheets/888x500_2`). |
| Achievements | 5/4/0>5 | **4** | "2 / 20" jelly numerals, coin medals, tier filters are strong (`raw/trophies_1280x800`); earned state is a green line, no celebration; locked cards dashed and dim. |
| Stats (Records) | 3/4/0>4 | **4** | Bars, tier gems, counters (`raw/records_1280x800`). |
| How to play | 2/3/0>3 | **4** | Five drawn cards + key table; at 888x500 the card fills the height. |
| Credits | 0/3/0>3 | **4** | Clear; licences disclosure; privacy line. |
| Loading | 4/4/1>4 | **4** | Static jelly wordmark, bar, line; no overflow at 1280 / 390 / 358 (`mine/probe3/boot_*`). |
| Toasts | 4/4/1>4 | **4** | Icon + line pills, coral error edge, trophy pill; 12 px text and a 30 px pill (small); they cover the head at strip / tiny. |
| Reveals | 5/2/3>4 | **3** (2 at 358x201) | One plate shape for Common and Mythic; tier word in the small flat jelly; plate covers the head at 888x500, 844x390, 320x568; at 358x201 it lies over the dock (F5). The 390x844 plate is good (`probe3/plate_390x844`). |
| Buttons | 3/3/2>5 | **4** | Gel and glass family consistent; focus ring 3 px lagoon + ink halo visible (`mine/1280x800/p02_focus_*`). Not 5: secondary pills plain, options bar icon-only on phones. |
| Type | 5/5/1>5 | **5** (display) | Jelly lettering legible and one finish at every use I saw (lockup, headings, tier names, numerals, boot card; builder glyph sheet read). Nits in M7. |
| Icons | 5/2/2>4 | **4** | One 24-grid stroke-2 family, no text glyphs. |
| Motion | 4/4/2>4 | **4** (not filmed) | Inventory only: normal = jl-idle (lockup, brand), k-breathe (CTA), Hoard dot pulse; **Calm = 0 infinite animations** on title, play, capsule ready (measured, `probe3.out`). |
| Sound | 4/3/0>4 | not scored | V1 does not listen (V3 K09). |
| Accessibility | 1/2/3>5 | **4** (visual share) | Rings and focus tooltips visible; contrast and forced-colors are V2's. |

**K15 verdict: FAIL.** Targets missed: Title 4<5, Pause 4<5, Achievements 4<5, Buttons 4<5, Reveals 3<4 (art-direction judgement; only the owner can waive, UI.md 2), plus the sub-3 cells below.

## 2. Screen x size scores (1-5): 1280x800 | 888x500 | 390x844 | 844x390 | 568x320 | 358x201 | 320x568
- Title: 4 4 4 4 3 3 3 | Play HUD, dock, Table|Float: 4 4 4 4 4 3 4 | Cut / Snap bars: 4 4 3 4 3 3 3
- Menu: 4 4 4 4 4 3 4 | Settings: 4 3 4 3 3 3 4 | How to play: 4 3 4 3 3 3 4 | Credits: 4 3 4 4 3 3 4
- **Hoard shelf: 4 2 4 3 3 2 4** | Hoard card: 4 3 4 3 3 **2** 4 | **Merge pad: 4 2 4 2 2 2 3** | Gift / Today: 4 3 4 3 3 2 4
- Reveal plate: 3 3 4 3 3 **2** 3 | Trophies: 4 4 4 4 3 3 4 | Records: 4 4 4 4 3 3 4 | Toasts: 4 4 4 3 3 3 4
- Offline / error card: 4 4 4 4 3 **2** 4 | Photo card: 4 4 4 4 3 3 3
Under 3 (blocks publication per K15): Hoard shelf 888x500, 358x201; Hoard card 358x201; Merge pad 888x500, 844x390, 568x320, 358x201; Gift 358x201; reveal plate 358x201; error card 358x201.

## 3. Findings
**F1 MAJOR: five parity targets missed (K15)**: section 1 (Title, Pause, Achievements, Buttons 4 vs 5; Reveals 3 vs 4). Repro: open the pictures named in the table. Direction: Reveals first (tier-scaled plate: size, jelly md for the tier word, motion), then Title chips and plate size.
**F2 MAJOR: primary gel actions sit below the fold in Hoard panels on short screens.** Repro: Hoard, Plumpet, Merge; real DOM, y top..bottom vs viewport height: "Hold to merge" 725..789 / 500 (888x500), 703..767 / 390 (844x390), 691..755 / 320 (568x320), 754..798 / 201 (358x201), 803..867 / 568 (320x568), 782..846 / 844 (390x844, 2 px). Gift "Take this one": 441..505 vs scroller end 481 (888x500), 341..405 / 381 (844x390), 273..337 / 320 (568x320), 211..255 / 201 (358x201). The dialogs scroll but nothing says so. Evidence `mine/probe2.out`, `probe2/merge_*.png`, `sheets/888x500_3`.
**F3 MAJOR: Hoard shelf first view is chrome on the portal desktop box.** 888x500: note, tabs, tool row and the COMMON heading fill 440 of 500 px, plinths show about 50 px, `hoard-body` scroller 220 px (`mine/888x500/h00_shelf.png`, SCROLLBOX 220/2342). 358x201: scroller 141 px (3331 content); the Hoard card shows 179 of 912 px, so Hearted / Merge are about 700 px down (`mine/358x201/h07_card.png`). Direction: collapse the Practice note and tool row on short / strip / tiny, pin card actions.
**F4 MAJOR: error card hides its only action at 358x201 (4 px at 568x320).** Reload 260..304 vs 201 px; the card scrolls (394 px content, overflow auto) with no cue; first view is mascot + headline only (`mine/358x201/e00_error.png`, `probe2/error_358x201.png`). A crashed player sees a dead end.
**F5 MAJOR: tiny-layout reveal plate overlaps the dock.** 358x201 Epic New: plate rect 12,146 334x36 over the Hoard button 12,151 44x44; dock icons ghost through the plate (`probe3/plate_358x201.png`). UI.md 4.2 says the plate REPLACES the bottom row; K11 forbids the overlap.
**M1 MINOR** Title chips 30 px high / 11-12 px text and a small tagline pill under a 330x66 CTA at 1280x800 (`t01_title`).
**M2 MINOR** Title plate or lockup covers the squishy's peak at 568x320, 358x201, 320x568 (`sheets/568x320_1`, `358x201_1`, `320x568_1`).
**M3 MINOR** Settings panel covers half of the Hoard button at 844x390 (`sheets/844x390_2`); Settings is a 354 px window at 888x500.
**M4 MINOR** Toasts cover the head at 844x390, 568x320, 358x201; a trophy toast (z 15) sits on the Photo card at 358x201 (`sheets/358x201_2`). Desktop toast text is 12 px.
**M5 MINOR** Tooltip "Hoard (H)" covers the hint line (`mine/888x500/p01_tip_hoard.png`).
**M6 MINOR** Options bar on phones is icon-only: split, join, and the circle / branch glyphs for Clean cut / Minis are cryptic (`raw/play-cut_390x844`); at 358x201 Snap is behind More (a real-touch Snap needs More, then Snap).
**M7 MINOR** Jelly nits: sm optical size is flat (brand, tier names, "Merge Dollop"); Rare tone dimmer than the other tiers; `%` reads as a slashed double circle; at 358x201 Trophies, Records and the "1 / 20" hero numeral drop to sm (`JL` lines, `mine/358x201/log.txt`).
**M8 MINOR** "UNCOMMON" touches the card edge in Gift cards at 320x568 (`sheets/320x568_2`); Photo card Done cut by the card bottom at 320x568 (baseline picture, not measured).
**NOTE** The CTA `k-breathe` never settles, so Playwright "stable" waits fail (use force); not a player defect. The builder run shows no plate at 390x844 and 358x201 because the 3.6 s plate was gone before the slow screenshot; my rect probe shows it at 390x844 [65,70,260,119], clear of the squishy.

## 4. Jelly lettering audit (JL logs)
Uses seen: title lockup xl (682x108 at 888x500, 255x40 at 358x201), HUD brand sm, panel headings md (sm at 358x201), tier names sm, "2 / 20" lg, merge / tidy headings sm, error heading md, boot wordmark. Legible, one finish everywhere. Idle / bounce only on the lockup and the brand (spec); Calm: 0 infinite animations. forced-colors / contrast-more not shot by me.

## 5. Not done
Real-input pictures at 390x844, 844x390, 568x320, 320x568 (judged from the 21-scene sheets); motion filmstrips; sound; K01 pixel contrast; reveal tiers at phone sizes beyond the Epic rect; Photo card measurements (probe selector missed it).

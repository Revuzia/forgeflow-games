# WOBBLEHOARD: design decisions (collection, merge, trade, reveal)

Working title. This is the decision document that `COLLECTION.md`, `BLEND.md`, `TRADE.md` and every implementer follow.
Slice 1 (poke, squish, pull, release one squishy) is built elsewhere; everything here is what comes after it.
Numbers marked **[sim]** are quoted from `_harness/sim_economy.ts` (run `node _harness/sim_economy.ts`, about 7 minutes for 5000 players; `--quick` for a fast check;
deterministic). Player behaviour in that sim is **assumed**, not measured (section 5.9).

**Evidence grades used in this file.** **[O]** = I opened the page. **[S]** = the URL was returned by a web search whose result
summary states the claim; the page itself was NOT opened. **[G]** = general knowledge, unverified. Why so few [O]: the sandbox
egress proxy refused every host I tried through `WebFetch` and `curl` (`EGRESS_BLOCKED` / `403 CONNECT`) except
`developer.apple.com` and `github.com`; x.com (the reference clips) is blocked too, so the clips were never seen, only described.

---

## 1. Pitch and pillars

**WOBBLEHOARD** is a glossy, translucent jelly toy you actually touch. Poke it, squeeze it, pull it and let go; real touching
fills a **Squish meter**, and every full meter drops a **free capsule** holding one random squishy out of **50**, in six visible
rarities. Spare copies are not waste: **two of the same merge into one new random squishy**, and **trading** is how you get the
exact one you are missing.

| Pillar | What it means in practice |
|---|---|
| **Touch is the currency** | Capsules come from varied, real touching (about 3 to 4 minutes of play each), never from a shop, a timer wall or a purchase. |
| **Rarity you can see and feel** | Tier changes the object: material, glow, aura, sparkle, idle motion, sound. Not just a label. |
| **Merge is luck, trade is exact** | Merge gambles with spares. Trade swaps precisely what each side needs. Neither replaces the other. |
| **Free, calm, kid-safe** | No real money, no paid randomness, no free-text chat, no streak punishment, no strobing. |
| **Original everything** | Names, palette, sounds, UI and effects are ours (checklist, section 9). |

## 2. The two reference clips: ideas taken, versions ours

Clips could not be opened (x.com blocked); this maps the owner's descriptions only. Nothing visual or audible is copied.

| Idea in the brief (clip) | Our original version |
|---|---|
| Shelf of glossy collectibles you poke until they squash (1) | The **Hoard**: a dark felt cabinet of lit plinths, one per species, a stack badge for spares. Poking a squishy on its plinth is the slice-1 interaction. |
| Mix-and-match row (1) | The **Merge pad** (section 5.6): two same-species squishies pressed together; the result keeps their colours as lineage. |
| Slime pull-and-pop with glitter and bubbles (1) | **Pull-and-let-go (snap)**: stretch, release, trapped-air bubbles and glitter inside the body (slice 1, RENDER lane). It pays the meter. |
| Blender combines up to six into a hybrid (1) | **Not core.** The input count in the clip is not a design number. A capped **Tidy-up** (bulk merge, up to 10 merges a day) is the only descendant (5.6). |
| Settings: louder squish, volume, haptics, screen shake, gravity vs float (1) | Same settings, our labels and layout (`CONTRACT.md` section 8) plus **Calm effects** (section 6.6). |
| Translucent jelly that stretches, divides, reconnects (2) | Slice-1 soft body; the **fold** in the merge ceremony reuses the same body. |
| Fold into a glowing ball, then spring back (2) | The **merge ceremony** (section 6): two bodies converge, fold into one glowing ball, charge, spring open, reveal. Our own timing, colours and sound. |
| Made to be touched (2) | The meter pays for touching in *varied* ways and ignores mashing (5.4). |

## 3. Research summary

### 3.1 Collecting and trading in similar games

| Game | How items are earned, found, unlocked | What makes trading meaningful (or absent) | Failures and lessons | Source |
|---|---|---|---|---|
| **Slime Rancher** | Feed slimes; a pure slime that eats another type's plort becomes a **largo** (two plorts per meal); a largo that eats a third type becomes hostile **Tarr**. Plorts sell at a market. | No player trading (single-player, **[G]**). The **plort market** has saturation: selling raises it, it decays 25% each midnight, price = base, saturation and two noise layers. | Combining with a risk is a strong hook. Market saturation is a clean anti-grind sink. We borrow *diminishing returns on repeating one action*. | **[S]** [Largo](https://slimerancher.fandom.com/wiki/Largo_Slimes), [Plort Market](https://slimerancher.fandom.com/wiki/Plort_Market_(Slime_Rancher_2)) |
| **Adopt Me!** | Eggs hatch pets; **4 Full Grown pets of one species fuse into a Neon, 4 Neons into a Mega Neon**. | Heavy player trading. A 3-question **Trade License** gates Legendary and Ultra-rare trades; 30-day trade history; unfair-trade warning; cross-trades and Robux trades are against the rules. | Scams ("trust trades", quick-switch) persist despite rules. Precedent for same-species merge (deterministic there). | **[S]** [official post](https://www.playadopt.me/news/trade-changes-and-scam-prevention-update), [guide](https://guidebros.com/game-guides/adopt-me/trade-safety-system-update), [Neon](https://adoptme.fandom.com/wiki/Neon_Pets) |
| **Neko Atsume** | Place food and toys; cats visit passively, even app closed; 40+ cats, 17 rare ones need specific items; silver and gold fish. | None needed (solo). | No fail state is calming; waiting is not tactile, so touch is our currency instead. | **[S]** [Wikipedia](https://en.wikipedia.org/wiki/Neko_Atsume), [GeekWire](https://www.geekwire.com/2016/app-of-the-week-tame-your-cat-craving-with-neko-atsume-aka-kitty-collector/) |
| **Pokemon GO** | Exploration, eggs, raids. | Trade needs friends, same place (or "Forever Friends" remotely), costs **Stardust** that falls with friendship level; limited special trades per day; Lucky trades. | Deliberate friction limits abuse and keeps scarcity. No free chat in a trade (**[G]**). | **[S]** [Help: trading](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/96-trading-pokemon/), [remote](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/5312-trading-remotely/), [Lucky](https://pokemongolive.com/post/luckypokemon-update/) |
| **Animal Crossing NH** | Real-time clock; daily events; Sunday turnip market (spoils after a week); villagers. | Villager and item swaps between friends (**[G]**). | Hard time gates invite time-travel workarounds. We use a daily *gift*, never a gate. | **[S]** [clock](https://www.playanimalcrossing.com/animal-crossing-clock/), [turnips](https://game8.co/games/Animal-Crossing-New-Horizons/archives/284591) |
| **Little Alchemy 2** | Start with 4 elements, combine **two at a time**; 720 items; hints. | None (solo). | "Combine two" is the simplest gesture to teach. Their results are deterministic; ours are random, so we need the preview. | **[S]** [wiki](https://little-alchemy.fandom.com/wiki/Little_Alchemy_2) |
| **Monster Rancher** | Combine two monsters; the primary parent passes more traits; same-species parents give (almost) that species; randomness in inherited moves; costs gold. | Not central. | Combination as a long-lived hook. | **[S]** [wiki](https://mymonsterrancher.fandom.com/wiki/Combining), [guide](https://gamefaqs.gamespot.com/ps/197977-monster-rancher-2/faqs/76372/fusion) |
| **Neopets** | Earn Neopoints, buy, auction; Trading Post offers can mix items and points. | Player-driven prices; information asymmetry (closed deals are not public). | Currency **inflation** when sources outrun sinks. We trade item-for-item with no currency, so no price to inflate or fake. | **[S]** [Irpan](https://www.alexirpan.com/2018/11/10/neopets-economy.html), [Neopian Times](https://www.neopets.com/ntimes/index.phtml?section=526352&week=516) |
| **Gacha / loot boxes** | Paid random pulls; "pity" guarantees (Genshin: hard pity at 90 pulls, 50/50 rule). | Often tradeable; that is what Belgium (2018) called gambling. | FTC fined Cognosphere **$20 million** (Jan 2025) over loot boxes sold to under-16s without parental consent and misleading odds. **Netherlands** Council of State overturned the EA fine (Mar 2022). **China** has required odds disclosure since 2017; **Japan** banned "kompu gacha" (collect a full set of random items to unlock a bonus) in 2012; **Brazil** bans loot boxes for minors (2025 law). Apple guideline 3.1.1 (opened, **[O]**): "must disclose the odds of receiving each type of item ... prior to purchase". Google Play and ESRB/PEGI labels follow. | **[O]** [Apple](https://developer.apple.com/app-store/review/guidelines/); **[S]** [pity](https://game8.co/games/Genshin-Impact/archives/305937), [FTC](https://www.ftc.gov/news-events/news/press-releases/2025/01/genshin-impact-game-developer-will-be-banned-selling-lootboxes-teens-under-16-without-parental), [Belgium/NL](https://www.pcgamesn.com/ea-loot-boxes-belgium), [2026 overview](https://blog.promise.legal/lootbox-regulation-2026-game-studios/), [Google](https://www.fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds), [China](https://kotaku.com/china-passes-law-forcing-games-with-loot-boxes-to-discl-1789828850), [Japan](https://www.lexology.com/library/detail.aspx?g=9207df10-a8a2-4f67-81c3-6a148a6100e2), [Brazil](https://cadeproject.org/updates/brazil-approves-first-law-to-protect-childrens-rights-online/), [labels](https://www.reedsmith.com/en/perspectives/2020/04/esrb-and-pegi-introduce-loot-box-warnings) |
| **Duplicates in card/box games** | Overwatch cut duplicate loot ("you cannot get owned items until you own all of that rarity", credits as compensation); Hearthstone **disenchants** spares into dust (crafting costs 4 to 8 times the yield). | Spares become a currency. | The owner chose "repeats allowed, no dupe protection". We make spares useful (merge, same-tier swaps) instead of hiding them. | **[S]** [Overwatch](https://www.pcgamesn.com/overwatch/overwatch-loot-box-duplicate-reduction), [Hearthstone](https://hearthstone.fandom.com/wiki/Crafting) |
| **Idle collector (Capybara Go)** | Idle gains with offline caps, companions with passive buffs, sessions from 90 s to 2 h. | None central. | Capped accrual works; we have no idle accrual because touch is the currency. | **[S]** [BlueStacks](https://www.bluestacks.com/blog/game-guides/capybara-go/cbg-beginners-guide-en.html), [progression](https://www.mobilegamereport.com/articles/capybara-go-progression-2026) |
| **Tamagotchi (1996)** | How well you care (care mistakes in the child and teen stages) decides the adult character. | None. | "How you play shapes what you get" is the ancestor of our *affinity* idea. We tested it (5.5). | **[S]** [characters](https://tamagotchi.fandom.com/wiki/Tamagotchi_(1996_Pet)/Character_list), [care guide](https://thaao.net/tama/p1/) |
| **Physical squishy and blind-box toys** | Squishmallows have a **six-tier rarity scale** with unit caps (Rare silver 75,000, Ultra Rare gold 50,000, Special 20,000, Select 5,000). Blind boxes use common, rare, chase and "secret" tiers; vendor blogs quote secret odds of 1 in 72 to 1 in 144 or worse. | Secondary markets exist for chase pieces (vendor blogs, weak evidence). | Collectors chase sets and secrets; tier is shown on a **tag**, which we replace with a visible material change. | **[S]** [Squishmallow tiers](https://squishmallowsquad.fandom.com/wiki/Rarity_Scale), [chase tiers](https://www.funshop.com/drops/limited-editions-chase-figures-and-rarity-tiers-across-major-blind-box-brands/), [secret odds, vendor blog](https://smartbuy.alibaba.com/popmart/what-are-the-odds-of-getting-the-secret-labubu) |
| **Pokemon TCG Pocket (trading)** | Packs. | Trading launched Jan 2025 needing **Trade Tokens** (burned from duplicate cards) and hourglasses; backlash; reworked 29 Jul 2025 to use an existing currency. | Friction meant to stop multi-account abuse also killed casual trading. | **[S]** [VGC](https://www.videogameschronicle.com/news/pokemon-tcg-pockets-trading-feature-is-changing-after-fan-backlash/), [GameSpot](https://www.gamespot.com/articles/one-of-pokemon-tcg-pockets-worst-features-will-be-revamped-july-29/1100-6533199/) |
| **Roblox (collectible trading)** | Limited items. | Premium required; trading and inventory must be enabled; under-13 accounts need a follow/friend link (devforum); chat for under-9 off by default. | Gating cuts scam surface; scams still happen. | **[S]** [help](https://en.help.roblox.com/hc/en-us/articles/203313310-Trading-on-Roblox), [devforum](https://devforum.roblox.com/t/can-13-players-trade-on-roblox-questions-on-trading/2432708), [chat](https://about.roblox.com/newsroom/2025/11/roblox-requires-age-checks-limits-minor-and-adult-chat) |

### 3.2 Safe-trading patterns

| Pattern | What we learned | Used here | Source |
|---|---|---|---|
| Steam trade hold | 15-day hold unless a mobile authenticator has been on for 7 days; friends of over a year get a 1-day hold. | A short **24 h receive lock** (kids, no 2FA) instead of days. | **[S]** [steamvaults](https://steamvaults.org/blog/why-steam-trade-hold-is-15-days), [forum](https://steamcommunity.com/discussions/forum/1/3279193518770589678/) |
| Pokemon GTS and Wonder Trade | Deposit a Pokemon and **request species and level** by menu; others search; Wonder Trade is a blind swap with **no communication**. | Searchable **wants/offers board built from species icons**, no text. | **[S]** [Newsweek](https://www.newsweek.com/pokemon-home-trading-gts-wonder-friend-trade-room-how-1487046), [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Trade) |
| Club Penguin Ultimate Safe Chat | Players pick phrases from a menu; filtered mode hides blocked lines from others. | **No free text at all**; fixed emotes. | **[S]** [wiki](https://www.clubpenguinwiki.info/wiki/Ultimate_Safe_Chat) |
| UK Children's Code (15 standards) | High-privacy defaults, profiling off, no nudge techniques, geolocation off. | Section 8. | **[S]** [ICO standards](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/code-standards/) |
| COPPA | Verifiable parental consent under 13; rule amended 22 Apr 2025 (retention limits, more data counted as personal). | No personal data collected by the game; consent is the portal's job (open question 1). | **[S]** [FTC FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [2025 rule](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data) |
| Duplication exploits | RuneScape's 2003 party-hat dupe made over two million copies and was never rolled back; Diablo 2 had several dupes. | Single-writer ledger, conservation check, locks, caps (section 8.3). | **[S]** [RuneScape](https://runescape.fandom.com/wiki/Duplication_glitch), [Diablo 2](https://gist.github.com/amtal/bf941bde443eefc7d4626fd439d7f480), [overview](https://en.wikipedia.org/wiki/Duping_(video_games)) |
| Atomic server-side moves | Make every item move one all-or-nothing transaction; never "add before remove"; cooldowns and locks close time windows. | `commit_trade` and `merge` RPCs (8.3). | **[S]** [bugnet](https://bugnet.io/blog/how-to-fix-inventory-item-duplication-bug), [gamedev.net](https://gamedev.net/forums/topic/260848-duping/) |
| Dark patterns, daily streaks | Streaks and timers exploit loss aversion and FOMO, worst for children. | No streak punishment, no countdown FOMO (8.4). | **[S]** [arXiv 2207.09928](https://arxiv.org/pdf/2207.09928) |
| Flashing content | WCAG 2.3.1: no more than 3 flashes in any second. 685 viewers were hospitalised after a 1997 broadcast with red/blue flashing. | Flash budget, Calm effects (6.6). | **[S]** [WCAG](https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html), [Porygon episode](https://en.wikipedia.org/wiki/Denn%C5%8D_Senshi_Porygon) |
| Birthday and coupon-collector maths | Expected draws to collect all n equally likely items = n times H(n) (50 items: about 225). | Calibrates every "first pair / first triple" number below. | **[S]** [Wikipedia](https://en.wikipedia.org/wiki/Coupon_collector%27s_problem) |

**In-repo facts read directly (no web):** the portal already has Supabase accounts (`supabase/migrations/0002_user_accounts.sql`, email sign-up), a
`friendships` table and a `find_users(query)` RPC that searches **by email or username** (`0003_achievements_friends_activity.sql`), and a
`postMessage` bridge where "the game never sees a token" (`games/blocktooth/src/net/portal.ts`). Trading reuses the bridge pattern and **must not** reuse `find_users`.

## 4. Options weighed

Score 0 (bad) to 3 (good). "Trade needed" = does the option make players *need* each other, not just allow it.

| Option | Trade **needed** | No paywall, no paid randomness | Fits a 3D **tactile** toy | Kid-safe | Exploit-resistant | Build cost (3 = cheap) | Sum /18 |
|---|---|---|---|---|---|---|---|
| Buy with soft currency | 0 (just buy it) | 2 | 1 | 2 | 2 | 2 | 9 |
| Explore a world to find them | 1 | 3 | 1 | 3 | 3 | 0 | 11 |
| Tasks and quests only | 0 | 3 | 1 | 3 | 3 | 2 | 12 |
| Passive collecting (Neko style) | 1 | 3 | 1 | 3 | 3 | 2 | 13 |
| Deterministic crafting (Little Alchemy style) | 0 | 3 | 2 | 3 | 3 | 1 | 12 |
| Paid gacha | 2 | **0** | 2 | **0** | 1 | 2 | 7 |
| Trade only (no earn loop) | 3 | 3 | 1 | 1 | 1 | 0 | 9 |
| Blender of 2 to 6, genome mix | 1 | 3 | 3 | 3 | 2 | 2 | 14 |
| **Touch meter + restock + tasks + merge 2 + same-tier swaps (chosen mix)** | **3** | **3** | **3** | **3** | **2** | **1** | **15** |

Why the mix wins: touch is the one input only this game has; a free random drop creates *spares and gaps*, which is exactly what makes
a swap worth doing; merge gives spares a purpose (so trade is not the only use of a duplicate); server-authoritative swaps are the
price (build cost 1). The paid-gacha row is shown only to explain what we refuse (3.1).

## 5. THE CHOSEN LOOP

### 5.1 In nine lines

1. **Touch** (poke, squeeze-and-release, pull-and-let-go, mixed) pays **squish points**; **100 SP = one free capsule** (about **3 to 4 active minutes**).
2. **Open the capsule** (squeeze it until it cracks): one random squishy of **50**, six tiers. Odds are public. Repeats are allowed.
3. **Daily Restock**: once a day, pick 1 of 3 offered Common or Uncommon squishies (a gift, not a gate). **Two small tasks** a day (max 5 a week) each pay one capsule.
4. **Merge**: **2 of the same species -> 1 new random squishy**, never below their tier; a finished row always moves up; after 4 duds in a row the next one moves up.
5. **Trade**: exact same-tier swaps (1 to 3 per trade), friend code or species-icon board, server-authoritative, 24 h receive lock, no currency, no text.
6. Rarity is **visible in the object** (section 5.3) and **felt** (material families, 5.2).
7. Merge is random, trade is exact, so they do not compete (5.8).
8. Everything is free. There is no real-money path (section 8).
9. Targets: a regular player owns all 50 in about **131 days (33 active hours) with trading vs 216 days (54 hours) solo [sim]**.

### 5.2 The catalog: 50 species, 6 tiers, material families

| Tier | Species | Odds per capsule | Per species | Capsules to 1st of one specific species | Capsules to 1st of any in tier | Merge tier-up chance |
|---|---|---|---|---|---|---|
| Common | **14** | 76.3% | 5.45% | 18 | 1.3 | 30% |
| Uncommon | **11** | 13.0% | 1.18% | 85 | 7.7 | 25% |
| Rare | **10** | 6.0% | 0.60% | 167 | 16.7 | 20% |
| Epic | **7** | 2.8% | 0.40% | 250 | 35.7 | 15% |
| Legendary | **5** | 1.4% | 0.28% | 357 | 71.4 | 10% |
| Mythic | **3** | 0.5% | 0.17% | 600 | 200 | cannot merge (top) |
| **Total** | **50** | 100% | | | | |

Room to grow past 60: new species append to the end of `SPECIES` and to the tier of their choice; see risk 3 (seasons). The catalog
agent builds species 0..49 from this table. **Species 0 is Dollop** (the slice squishy), Common.

**Why these counts and odds [sim, section Q]:** the first guess (16/12/10/6/4/2 at 50/25/14/7/3/1) finished all 50 in **45 days with trade** (too easy).
Steeper odds with more Epic-and-above species stretch the tail; the chosen set gives first Rare around day 3, first Epic day 7, first Legendary day 15, first Mythic day 38
(medians over all players; for regular players day 2 / 5 / 10 / 30) and 131 days to finish for a regular trader.

**Material families (rule reserved; the families themselves come from `_spec/SQUISHY_SCIENCE.md` and `src/data/materials.ts`, owned by another agent):**

* Every species belongs to **exactly one material family**. A family fixes its **touch feel** (firmness, bounce, stretch, damping, recovery time presets
  fed into `SoftBody`), so a collector wants variety in *feel*, not only colour.
* Use **6 families** (letters A to F here; examples to map: slow-rise foam, mochi/taba, gel/jelly, liquid-filled, slime/putty, plus one more).
* Each family has species in **at least 4 tiers** and **6 to 10 species** overall; no tier is more than 40% one family.
* Suggested allocation (catalog agent may move any cell by one, totals fixed):

| Tier (n) | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Common (14) | 3 | 3 | 2 | 2 | 2 | 2 |
| Uncommon (11) | 2 | 2 | 2 | 2 | 2 | 1 |
| Rare (10) | 2 | 2 | 2 | 2 | 1 | 1 |
| Epic (7) | 1 | 1 | 1 | 1 | 1 | 2 |
| Legendary (5) | 1 | 1 | 1 | 1 | 1 | 0 |
| Mythic (3) | 1 | 1 | 1 | 0 | 0 | 0 |

* Each species also carries a cosmetic **signature touch** tag (poke, squeeze or pull) used for hint text and a small look bias in its genome roll.
  It does **not** change drop odds (5.5).

### 5.3 Rarity you can see: the visual language per tier

Tier is a property of the **species** (catalog), not stored in `Genome`. The render lane layers a **tier FX pass** on top of the genome
look, keyed by `tierOf(species)`; the genome numbers keep their slice-1 meaning. Colours come from the existing palette tokens.
Tier is never colour-only: each also has a **gem shape**, a **text label** and a **sound signature**.

| Tier | Body material | Core and inner light | Aura and floor light | Sparkle | Idle motion | UI gem and frame |
|---|---|---|---|---|---|---|
| **Common** | Plain jelly, matte-gloss, one hue | Dim core | Plain contact shadow | None | Blink, breathe | Circle, cream frame |
| **Uncommon** | A little more translucency | Warm core | Faint tinted light pool | A few glitter flecks inside | Blink, breathe | Diamond, lagoon frame |
| **Rare** | Deeper transmission, rim glow, speckle or swirl layer | Visible glowing "seed" core | Soft rim halo | Moderate glitter | Core pulses slowly (under 0.5 Hz) | Hexagon, dusk-violet frame |
| **Epic** | Two-tone gradient body, stronger pressure blush | Bloom on the core | 3 to 5 slow orbiting motes; caustic ring on the table | Glitter drifts upward | Motes trail when it moves | Four-point star, ember-coral frame |
| **Legendary** | Slow **aurora** gradient moving inside the body | Bright core, faint light pillar on idle | Ring on the table pulses at 0.25 Hz | Dense glitter, short spark trail | Settles with a visible wobble ring | Six-point star, sodium-amber frame |
| **Mythic** | **Thin-film iridescence** (hue shifts with view angle) | Prism core | Soft light dome; small orbiting satellite sphere(s) | Constellation of fixed star points inside | Own idle hum (audio), slow breathing glow | Eight-point prism, slowly rotating frame |

Audio signature on idle/reveal rises with tier (section 6). Budget note for RENDER: tier FX are per-tier shaders and particle presets, not per-species art;
Epic and above is 15 of 50 species.

### 5.4 Earning: the Squish meter (explicit active-play model)

**Meter rule (touch to squish points), as tested [sim A]:**

| Touch | Pays | Notes |
|---|---|---|
| Poke | 0.8 SP | Needs a distinct contact; double taps under about 0.25 s do not pay. |
| Squeeze and release | 0.7 SP + 0.45 per second held (hold counted up to 3 s) | **Soft pop** +0.5 SP if held 1.8 s or more. |
| Pull and let go (snap) | 1.8 SP | About a quarter (0.5) if it never stretched. |
| **Medley** | +2 SP | Three different kinds inside 12 s; then 25 s cooldown. |
| **Freshness** (anti-mash) | pay x clamp((seconds since your last touch of the SAME kind / tau)^2, 0.03, 1) | tau: poke 0.9 s, squeeze 2.4 s, pull 3.0 s. |
| **Valve** | at most 40 SP in any rolling minute | Never binds a human (about 27 SP/min). |
| **Daily cap** | 8 capsules at full rate, then 25% rate, hard stop at 12 a day from play | "Squishies need rest." Not a punishment: nothing is lost, the meter just fills slowly. |
| **Onboarding ramp** | capsule 1, 2, 3 cost 30, 50, 75 SP, then 100 | First capsule in about **64 seconds** [sim]. |

`SoftEvent` mapping for SHELL: `poke` -> poke; `release` with `heldFor` >= 0.4 s -> squeeze; `snap` with `intensity` >= 0.35 -> pull (below that, the quarter rate).
The valve, freshness and caps are **server-side** (the client only reports touches).

**Human touch model and what it pays [sim A, 400 five-minute streams per archetype]:**

| Archetype | Pokes / squeezes / pulls per min | SP per minute | Share of SP poke / squeeze / pull | Active minutes per capsule |
|---|---|---|---|---|
| Poker | 19.9 / 4.4 / 2.7 | 27.3 | 57 / 26 / 16% | **3.7** |
| Squeezer | 2.7 / 14.2 / 2.8 | 28.2 | 9 / 75 / 16% | **3.6** |
| Puller | 2.7 / 3.0 / 13.5 | 26.2 | 10 / 19 / 71% | **3.8** |
| Mixed (varied) | 8.8 / 6.7 / 6.7 | 31.3 | 26 / 37 / 37% | **3.2** |

Every style earns within about 15% of each other, and **variety pays about 15% more** (medley). Bots: mashing 8 pokes a second earns **11.6 SP/min (43% of a human)**;
a scripted poke-squeeze-pull cycler reaches the valve (about 40 to 44 SP/min). Either is stopped by the daily cap at **12 capsules a day from play, versus about 10 for devoted human players** (9.8 per active day including tasks).
Capsules have no cash value (no currency, same-tier swaps only), which removes most of the reason to farm. Sessions modelled: casual 1 to 2 x 3 to 5 min; regular about 2 x 10 to 15 min;
devoted 2 to 3 x 12 to 22 min.

**Result [sim C, 5000 players]:** measured **3.1 active minutes per capsule** for regular players (steady touch time per capsule 3.2 to 3.8; tasks lower it a little).
Capsules per active day: casual 2.6, regular 7.1, devoted 9.8 (plus 1 restock pick). **First capsule 64 s** for regular players (poker 66, squeezer 65, puller 69, mixed 59 s). A regular player's first pair of any species arrives after **5 capsules (10.7 active minutes)**;
first triple after 14 capsules (36.7 minutes). Pure capsule birthday maths with these odds gives about 6.7 capsules to the first repeat (sqrt(pi / (2 x sum of squared odds)) + 2/3, my calculation);
the sim's 5 is lower because the starter Dollop, restock picks and task capsules also create repeats. This is within the owner's band (2 to 5 minutes per capsule, not under 1.5, not over 6).

**Restock and tasks.** *Restock:* once per day, 3 random Common or Uncommon species are offered (25 species pool); pick one, new ones shown first. Misses do not accumulate or punish.
*Tasks:* 2 offered a day ("stretch one to 2x", "five soft pops in a row"), each completed task pays one capsule, **max 5 tasks a week**, tasks are style-neutral.

### 5.5 Playstyle affinity: tested, then dropped from the drop odds

The hypothesis: what you drop depends on how you play (tilt which species inside a tier), so your hoard has gaps other styles fill. Implemented as
`weight = exp(beta x recent share of that style)` inside a tier only (tier odds untouched, Legendary and Mythic ignore it), with global supply rebalanced so no style group is scarcer.

| beta | P(random pair has a feasible swap), day 60: different-style / same-style | Trade speed-up, regular traders, all 50 (p50) | Slowest vs fastest archetype, all 50 | Slowest vs fastest, Epic row |
|---|---|---|---|---|
| 0 (off) | 56% / 55% | **1.62x** | 1.07x | 1.11x |
| 2 | 61% / 56% | 1.67x | 1.10x | 1.17x |
| 4 | not shown | 1.83x | 1.21x | 1.18x |

**Verdict: drop it from species odds.** At a fair strength (beta 2) it adds about 3% to the trade speed-up and 5 points of "different-style pair" matching; at the strength where it helps
(beta 4: +13%) the slowest style takes about 20% longer to finish, which reads as "my way of playing is penalised". It also needs supply-balancing maths and complicates odds disclosure.
**Kept as flavour only:** the style of your touching tints the *look and feel traits* of what you roll within a species (more bounce for pokers, etc.), cosmetic, not economic.
Revisit only after a real playtest shows trading is too weak (the knob exists in the sim as `beta`).

### 5.6 Merge: the rules (MERGE_COST = 2)

**One constant, `MERGE_COST = 2`, exported from `_harness/sim_economy.ts` (the catalog agent moves it to `src/core/merge.ts`).**

| Rule | Value |
|---|---|
| Inputs | **2 squishies of the same species**, Common to Legendary (Mythic cannot merge: nothing above it). Both are consumed, one new squishy is minted, in one server transaction. |
| Output tier | **Never below the inputs' tier.** Tier-up chance: Common 30%, Uncommon 25%, Rare 20%, Epic 15%, Legendary 10%. |
| **Finished row** | If you own every species of the input tier, **the merge always tiers up** (to a random species of the next tier). Merges are never wasted on a complete row. |
| Pity | After **4 merges in a row from the same tier without a tier-up, the next one tiers up** (so never more than 4 duds in a row). The counter is per input tier, so it cannot be banked on cheap fodder and spent on a Legendary pair. |
| Species roll | Random inside the output tier, **never the input species**; species you do not own are weighted **x1.5** (mild). No "guaranteed new species" rule (it added nothing once finished rows tier up, [sim F vs G]). |
| Look of the result | Species template mixed with the inputs' hue and pattern (circular mean, jitter): the lineage colours are visible. `origin = { kind: 'blend', parents: [idA, idB] }`. |
| Variants and colourways | **None in v1.** Every instance's genome is already unique. A cosmetic "Prism" colourway (same tier for trade parity) is a possible season addition. |
| Bulk N-input merge | A true multi-input blender (the clip's six) is **deferred**; only the capped Tidy-up below exists in v1. |
| Safety | **Hold to merge** 0.5 s (release early cancels, nothing consumed). **Preview** shows exact tier odds and how many species you still lack in the output and next tier. A warning appears if it uses your **last copy**. Favourited squishies are protected. Output **locked 24 h** (cannot trade or merge). Daily cap **10 merges**. |
| **Tidy-up** (bulk merge, the only descendant of the 6-input blender) | One button that runs up to 10 eligible spare-pair merges, never touching favourites or your last copy of a species. |

**Why M = 2 and not 3 (applying the owner's rule).** The rule: if actually earning a squishy takes decent effort (3 minutes or more), merge cost is 2; if it is easy (about 1.5 minutes or less), 3; in between, break the tie with the sim.
At 100 SP per capsule a regular player spends **3.1 to 3.8 active minutes per capsule**, which is the decent-effort band, so **M = 2**. The sim agrees: a pair arrives in the
first one or two sessions for regular players (**91% by 25 minutes, 55% by the first 12**), whereas a triple would take **36 minutes, 27% by 25 minutes**, i.e. three or more sessions.
Trade still wins for the last species at M = 2 (5.8). Side by side [sim O, 3000 players, 450 days, regular players willing to trade]:

| Metric | **100 SP, M=2 (chosen)** | 100 SP, M=3 | 40 SP (about 1.3 to 1.5 min), M=2 | 40 SP, M=3 |
|---|---|---|---|---|
| Active minutes per capsule (measured) | **3.1** | 3.1 | 2.0 | 2.0 |
| First capsule | 64 s | 64 s | 26 s | 26 s |
| Minutes to first mergeable set | **10.6** | 36.0 | 4.7 | 19.3 |
| Have a mergeable set by 12 / 25 active minutes | **56% / 92%** | 8% / 28% | 92% / 100% | 32% / 61% |
| Days to all 50, p50: solo / with trade | 214 / 131 | 226 / 132 | 139 / 88 | 149 / 87 |
| Solo-to-trade time ratio: Epic row / all 50 | 1.79x / 1.63x | 1.93x / 1.71x | 1.86x / 1.58x | 1.89x / 1.71x |
| Epic+ first copies that came by trade / by merge | 34% / 2% | 34% / 1% | 33% / 1% | 33% / 1% |
| Merges per player per 100 days | 8.5 | 8.3 | 8.1 | 7.9 |
| Live merges returning a NEW species / feel-bad | 34% / 12% | 30% / 10% | 33% / 12% | 30% / 10% |
| Capsule repeat rate, first 60 days / whole run | 90% / 98% | 90% / 98% | 92% / 99% | 92% / 99% |

M = 3 has a slightly better trade ratio but fails the "mergeable set in the first one or two sessions" target at the chosen meter, and a faster meter that would fix that (40 SP) is
the "too easy" band (all 50 in about 88 days with trade). **The meter rate and M are a pair: 100 SP and M = 2.**
**Sensitivity** (2000 players, regular traders, days to all 50 solo / trade): as modelled 3.1 min/capsule **214 / 130**; players **2x slower** (5.4 min/capsule, the edge of grindy) **351 / 228**
(71% -> 92% finished by day 450); **2x faster** (2.2 min) **152 / 95**; **half the play time** **405 / 262**. The design holds at both extremes.

### 5.7 Trade: the v1 rules

| Rule | Value |
|---|---|
| What moves | Squishy instances, item-for-item. **No currency, no free text.** |
| Parity | **Same tier, same count**: 1 to 3 squishies per side. A Rare can only ever be swapped for a Rare. No lopsided deal is possible by construction. |
| Any spare for any spare | A side may take one of your spares even if it already owns that species (a "favour swap"); the server only checks tier and count. (Sim: both sides must gain a new species -> 145 days to finish; favour swaps allowed -> 130.) |
| Finding a partner | **Friend code** (mutual accept) or the public **wants/offers board**: a grid of species icons, searchable by species and tier, 3 offers and 3 wants per listing. Anonymous alias, no profile. |
| Locks and caps | **24 h receive lock** on traded-in and merge-made squishies (cannot trade or merge); **max 3 completed trades a day** (sim value; raise to 5 as headroom), **1 per partner per day**; new accounts need 2 days and 10 capsules opened before trading. |
| Atomic | Server holds both offers in escrow, both confirm within 60 s, then one transaction swaps owners, bumps `tradeCount`, writes the ledger. Anything fails: nothing moves. |
| Never | Trading a share string, a code or a screenshot. Free-text chat. Currency, tips or bundles of different tiers. |

### 5.8 Why trade stays NEEDED (and merge does not replace it)

* **Merge is random, trade is exact.** Cost of **one specific species by merge only** (a collector who counts only merge outputs, feeding merges from the target's tier and the one below) versus by plain drop [sim M]:

| Target tier | By drop (capsules) | By merge only, M=2: capsules median (mean) / merges median | By merge only, M=3: capsules median (mean) / merges median | By trade |
|---|---|---|---|---|
| Common | 18 | 35 (45) / 14 | 54 (68) / 11 | 0 capsules, 1 swap |
| Uncommon | 85 | 32 (38) / 15 | 64 (76) / 17 | 0, 1 swap |
| Rare | 167 | **126 (158) / 14** | 260 (304) / 14 | 0, 1 swap |
| Epic | 250 | **202 (236) / 8** | 419 (486) / 10 | 0, 1 swap |
| Legendary | 357 | **304 (361) / 6** | 664 (720) / 7 | 0, 1 swap |
| Mythic | 600 | **837 (1057) / 7** | 1402 (1543) / 6 | 0, 1 swap |

  At M=2 merge is no better than waiting for the drop (0.9 to 1.0x of the drop cost for Rare to Legendary, 1.8x for Mythic; at M=3 it is 1.8 to 2.6x), and **trade costs zero capsules** when a partner has the spare.
  Merge roughly matches a drop for Rare to Legendary because re-rolling spares of the target's tier turns "any copy" into "that copy" at about the odds a drop would; it is cheaper only for Uncommon
  (it recycles the flood of Common spares), a row that is cheap anyway. So it stays a recycler and a lottery ticket, not a route to a specific Epic or above.
* **Where the last species came from** [sim L, all willing traders who finished, no churn]: of the **last 5 species** a finisher completed, **52% arrived by trade, 44% by capsule, 4% by merge**.
  For the last 5 Epic-and-above: **51% trade, 45% capsule, 4% merge**. Over all Epic+ first copies: capsule 66%, **trade 33%**, merge 2% (solo world: merge 7%).
* **Trade speeds completion** (regular traders, same players solo vs trade) [sim K]: Rare row **66 -> 34 days (1.9x)**, Epic row **101 -> 57 (1.8x)**, Legendary **135 -> 78 (1.7x)**, Mythic **184 -> 121 (1.5x)**, all 50 **216 -> 131 (1.65x at p50; 1.63x at p25, 1.58x at p75, 1.60x at p90)**.
  Finished all 50 by day 120: **7% solo vs 43% with trade**. Casual traders: all 50 by day 450, **2% solo vs 27% with trade**; Epic row **47% vs 94%**.
* **Honest limit: the owner's "at least about 2x" is not reached for the whole shelf (about 1.6 to 1.7x).** Trading moves copies around; it cannot create them, so the rarest species bound both routes. Even a
  frictionless oracle (everyone willing, no friction, cap 20) only reaches **1.78x** [sim P: 215 / 121]. The knobs, if the owner wants more: more species in the top tiers, or steeper odds (both tried in section Q, all within 1.65x to 1.76x). We chose pacing over a bigger ratio.
* Merge does **not** make trade pointless: switching merge off entirely moves "all 50 with trade" from 130 to 130 days and solo from 214 to 226 (merge helps solo by about 5%, trade-world by nothing).

### 5.9 Duplicates and supply [sim D, G, F; 60-day cohort with churn, trade on]

| Week | Capsule repeat rate | Repeat rate of Rare-and-above capsules | Species owned (of 50), mean |
|---|---|---|---|
| 1 | 56% | 10% | 20.3 |
| 2 | 87% | 30% | 27.2 |
| 3 | 92% | 47% | 31.8 |
| 4 | 95% | **60%** | 34.8 |
| 8 | 98% | 84% | 41.3 |

* **Repeat band.** Commons repeat over 90% from week 3 (they are merge fodder and same-tier swap currency), so the useful band is the **Rare+ repeat rate: crossing 50% in week 4**, which is when
  trade fuel (spare Rare, Epic copies) becomes plentiful. Capsule reveals must therefore celebrate **"new"** and compress **"repeat Common"** (section 6).
* **Does merge keep supply from inflating? No, not by itself.** Sources are about 36 items per player per week; the merge sink (each merge destroys 2, mints 1: net minus 1) removes **2 to 3%**; mean items held grows to **328 per
  player by week 9** (335 with merging off). With the capped **Tidy-up** it removes **about 17% of sources** (items held 283 at week 9). Item *count* inflation is harmless to progression value because
  trade parity is by tier, not by price, and Epic+ is only about 4.7% of capsules; but the UI must **stack by species** and offer Tidy-up, and an optional soft cap (for example 150 spare slots)
  is a later knob. Daily caps, not merge, are what bound production.
* **Merge outcomes** [sim F, 60 days]: 6.6 merges per player (casual 3.3, regular 8.2, devoted 10.3); 68% of players ever merge. Because finished rows always tier up, outcomes shift up: Common 12.5%,
  Uncommon 56%, Rare 26%, Epic 4.5%, Legendary 1.2%, Mythic 0.2% (capsules: 76 / 13 / 6 / 2.8 / 1.4 / 0.5). Of all merges over 120 days: **95% tier up, 79% return a species the player already owns** (so an owned
  species at a *higher* tier is the usual result, which is still a better trade-currency tier), only about 5% return the same tier. A merge never returns a lower tier.
* **Feel-bad ladder** (120 days, "live" merge = something new was still reachable; feel-bad = returns an owned species AND no tier-up):

| Merge rules (each row adds one) | Live merges: new species | Live: tier-up | **Live feel-bad** | Longest dud streak (p95 / max) |
|---|---|---|---|---|
| A. Floor only | 4% | 0% | 96% | 71 / 135 |
| B. + tier-up chances | 11% | 27% | 71% | 11 / 25 |
| C. + unowned x1.5 | 15% | 27% | 70% | 12 / 29 |
| D. + pity after 4 duds in a row | 16% | 33% | 65% | 4 / 4 |
| E. + finished-row boost x2 (cap 60%) | 22% | 52% | 49% | 4 / 4 |
| **F. finished row always tiers up (chosen)** | **36%** | **89%** | **13%** | **3 / 4** |

### 5.10 How often you own M of the same, and a lock's cost [sim E, I, N]

* **Share of players owning at least 2 / at least 3 / at least 4 of one species of a tier** (merging off so copies accumulate; day 7 / 30 / 60):

| Tier | At least 2 | At least 3 | At least 4 (two spares while keeping one) |
|---|---|---|---|
| Common | 97 / 100 / 100% | 78 / 99 / 100% | 64 / 95 / 100% |
| Uncommon | 68 / 98 / 100% | 26 / 81 / 98% | 6 / 68 / 89% |
| Rare | 20 / 68 / 84% | 2 / 43 / 71% | 0 / 20 / 57% |
| Epic | 8 / 48 / 73% | 0 / 19 / 52% | 0 / 5 / 28% |
| Legendary | 3 / 29 / 57% | 0 / 6 / 28% | 0 / 1 / 10% |
| Mythic | 1 / 8 / 26% | 0 / 1 / 7% | 0 / 0 / 1% |

  At **M = 2** a reckless merge needs the "at least 2" column and a careful one (keeping a copy on the shelf) the "at least 3" column: Common is mergeable in week 1, Uncommon in weeks 2 to 4,
  Rare in weeks 4 to 8, Epic after week 8, and a Mythic pair is the multi-month event it should be. At M = 3 the same columns shift one to the right (careful = "at least 4"), which is why a first triple takes 36 minutes.
* **A 24 h lock costs honest players nothing** (60 days): trades per 1000 players a day 36.1 (no lock) / 35.9 (1 day) / 35.2 (3 days); species owned 44.91 / 44.77 / 44.70.
* **Does the lock stop merge-then-trade laundering?** Toy ring model (6 bot mules, 30 trades/hour each, 25% of hops cash out to innocents; "x/y/z" = extra copies / merge outputs / innocent holders at detection):

| Policy | Dupe bug, detected at 24 h | Stolen 20 items, at 24 h |
|---|---|---|
| No limits | 4233 / 63 / 906 | 4 / 4 / 16 |
| **Receive-and-merge lock 24 h only** | 720 / **0** / 170 | 0 / **0** / 6 |
| Daily cap 5 + 1 per pair only | 37 / 7 / 16 | 2 / 2 / 15 |
| **Lock + cap + pair limit** | **5 / 0 / 1** | 0 / 0 / 10 |

  The lock stops **laundering** (merging tainted copies into clean-looking items: 63 -> 0) and slows **spread** (906 -> 170 innocents). It does **not** stop the raw copying of a giver-side dupe bug
  (4233 -> 720 only because mules wait); **the daily cap and the per-pair limit do that**, and the real fix is atomic transactions. Provenance (`origin.parents`, `tradeCount`, the ledger) lets
  a tainted merge output be recalled even if it slipped through.

### 5.11 Pacing for the median regular player [sim K]

| Milestone | Solo (p50 day) | With trade (p50 day) |
|---|---|---|
| Common row (14) | 9 | 6 |
| Uncommon row (11) | 19 | 12 |
| Rare row (10) | 66 | 34 |
| Epic row (7) | 101 | 57 |
| Legendary row (5) | 135 | 78 |
| Mythic row (3) | 184 | 121 |
| **All 50** | **216 (about 54 active hours)** | **131 (about 33 active hours)** |

A tier row finished is a **fixed cosmetic reward** (shelf light, frame), never an extra random item (the Japanese kompu-gacha lesson). First Rare day 3, Epic day 7, Legendary day 15, Mythic day 38 (medians, all players; regular players 2 / 5 / 10 / 30).

### 5.12 Limits of the sim (read before trusting a number)

* **Behaviour is assumed:** touch speed, session lengths, active days (0.4 / 0.7 / 0.9), churn, willingness to trade (30 / 55 / 75%), friends (35% have none), when people merge (30% merge even finished rows). **The 3.1 minutes per capsule is a model of human touching, not a measurement**; the first real playtest must
  re-measure it and the capsule cost (100 SP) is the one dial to retune.
* Trading is modelled as same-tier swaps matched daily over friends plus a species-searchable board; real timing, notifications and UI friction are not modelled. The "favour swap" acceptance (50%) is a guess; with
  mutual-need only, trade finishes in 145 days instead of 130.
* The population is one cohort in one catalog; no new species arrive, no seasons, no players joining later (veterans would hold spares newcomers cannot afford; risk 3).
* Active hours count only touching time. Bots, multi-accounting and real-money trading are not modelled beyond the toy ring.
* Sim cost of the tier FX, art and server are out of scope. Everything is deterministic (seeded `mulberry32`), so changing one rule shows its effect exactly.

---

## 6. Merge ceremony and capsule reveal

Result first, theatre second: **the server decides the outcome before any animation starts**, so skipping, a closed tab or a crash can never lose or duplicate an item. All visuals are
procedural (Three.js, existing soft body); all sounds are synthesised (WebAudio); nothing here uses a sample or a reference asset.

### 6.1 Duration budgets (skippable by tap after 350 ms)

| Result tier | Capsule open | Merge ceremony | Notes |
|---|---|---|---|
| Common | **1.6 s** (repeat: 0.8 s quick pop) | 2.2 s | repeat Commons never hold the player |
| Uncommon | 2.0 s | 2.6 s | |
| Rare | 2.6 s | 3.2 s | |
| Epic | 3.2 s | 3.8 s | |
| Legendary | 3.9 s | 4.5 s | |
| Mythic | **4.5 s** | **5.2 s** | |

**Tap anywhere after 350 ms** jumps to the final reveal frame (squishy placed, plate shown) with a 120 ms crossfade. The result is never hidden by a skip. Setting **Fast open** compresses
repeat Common and Uncommon to 0.8 s but still plays new species and every Rare+ (skippable). Queued capsules wait on the table (up to 5); the player opens them when ready, never mid-squish.

### 6.2 Meter-full cue

* **Visual:** the meter ring around the HUD gem reaches 100%; one soft ring pulse (400 ms, ease-out, single, not repeating); a **neutral translucent capsule drops from above next to the squishy and lands with a wobble**, staying as a tappable object. No full-screen effect, no interruption of touching.
* **Audio:** two-note rising "plink-plonk" (sine plus short pluck, about 180 ms), quieter when the player is mid-squeeze. **Haptic:** one 10 ms tick on fill, one 18 ms thump on landing.
* Reduced motion: the capsule fades in at the HUD instead of dropping.

### 6.3 Capsule open reveal (beat sheet)

Open by **squeezing the capsule** until it cracks (hold 0.5 s; a tap also works). Beats for a Common; higher tiers stretch B2 and B3 and add pre-roll.

| Beat | Common (1.6 s) | What the player sees | What the player hears |
|---|---|---|---|
| B0 Grab (0 to 0.35 s) | 0.35 | Capsule wobbles; shell stays neutral (**tier is never spoiled by the shell colour**) | soft squeak, rising |
| B1 Crack (0.35 to 0.65 s) | 0.30 | Hairline cracks; **light leaks through them in the tier colour** (the tell) | shell "tick" |
| B2 Burst (0.65 to 1.0 s) | 0.35 | Shell halves fly; squishy drops out and lands (soft-body landing) | `pop` voice plus tier cue |
| B3 Reveal (1.0 to 1.6 s) | 0.60 | Small camera push; name plate slides in; **NEW** badge or **x2 spare** chip | tier motif (6.5) |

**Escalation by tier** (all values per reveal; particles are small, additive, low-area):

| Tier | Pre-roll before B2 | Light tell at B1 | Particles at B2 | Rings | Camera | Time-scale |
|---|---|---|---|---|---|---|
| Common | none | warm cream, faint | 12 round motes | 0 | none | 1.0 |
| Uncommon | none | lagoon, soft | 24 motes + 6 glitter | 0 | push 2% | 1.0 |
| Rare | 0.3 s hum swell | dusk-violet, brighter | 40 motes + 12 glitter | 1 | push 4%, orbit 6 degrees | 1.0 |
| Epic | 0.5 s rising tone | ember-coral core flare (slow ramp, not a pulse) | 70 motes + spiral trails | 2 | push 6%, arc 10 degrees | 0.6 for 250 ms |
| Legendary | 0.8 s choir-like swell | sodium-amber aurora ribbons, light pillar 0.8 s | 120 motes + ribbons | 3 | pull-back reveal, arc 15 degrees | 0.5 for 350 ms |
| Mythic | 1.0 s: **250 ms audio duck**, then swell | prism dome, constellation points converge | 200 particles + 24 star points | 3 | dolly + arc 25 degrees | 0.4 for 500 ms |

### 6.4 Merge ceremony beat sheet (two bodies converge)

Player drags two same-species squishies onto the **merge pad**, presses and holds the pad **0.5 s** (release early cancels; after the hold the server call fires and the outcome is final).
Timings below are for a **Common result (2.2 s total)**; higher tiers lengthen **T2 charge** and **T4 reveal** to the budgets in 6.1.

| Beat | Time | What the player sees | What the player hears | Haptic |
|---|---|---|---|---|
| **T0 Press together** | 0 to 0.4 s | The two bodies slide to the pad centre and **squash against each other**; cores glow brighter where they touch | low hum (80 Hz sine plus 2nd partial) fades in; wet squelch from the existing squish voice | slow rumble pulses (8 ms every 60 ms) |
| **T1 Fold** | 0.4 to 0.9 s | Both bodies **fold toward their shared centre into one translucent glowing ball** (shape-matching target is a sphere); the two parents' colours swirl together | squelch pitch rises with compression | rumble speeds up |
| **T2 Charge** | 0.9 to 1.3 s (longer for higher tiers) | The ball compresses and trembles; **motes spiral inward**; its light drifts toward the **result tier's colour** (the tell); strain blush saturates | hum glides up about a fifth; noise tick rate rises | pulses 8 to 14 ms, closer together |
| **T3 Burst** | 1.3 to 1.5 s | The ball **springs open** (overshoots to 1.25x, settles); shock ring(s) and a **single** light ramp (attack 80 ms, decay 400 ms); camera kick by tier | burst: noise transient plus tier bell (6.5) | one thump by tier (6.7) |
| **T4 Reveal** | 1.5 to 2.2 s | New squishy rises from the burst and lands; name plate; **NEW** or **spare**; a **TIER UP** banner (+0.4 s accent) if it moved up | tier motif | tier pattern |

Escalation by result tier uses the same table as 6.3 (particles, rings, camera, time-scale), plus: **tier-up merges** add a rising ladder glissando on T3 and a banner;
the **lineage colours** of the two parents remain visible in the new body's hue and pattern for the reveal.

### 6.5 Sound design by tier (synthesised, original; voices go in `src/audio/voices.ts`)

| Tier | Signature |
|---|---|
| Common | single soft "bloop": sine pair gliding 180 to 260 Hz, 180 ms |
| Uncommon | bloop plus a two-note chime (major third) |
| Rare | bell cluster (3 inharmonic partials) with short shimmer; perfect-fifth interval |
| Epic | low filtered-saw swell, 4-note rising arpeggio (octave span), soft whoosh |
| Legendary | formant "choir" pad, rising sweep, bell chord with a major ninth |
| Mythic | **unique 3-note motif per Mythic species** over a sub-bass swell, preceded by the 250 ms duck |
| Meter-full | two-note "plink-plonk" (6.2) |
| Merge T0 to T3 | hum (80 Hz plus partial) gliding up a fifth, squelch voice, noise-tick density rising, burst as above |

### 6.6 Flash-safe, reduced-motion and accessibility variants

* **Flash budget (always on):** never more than **2 luminance flashes in any 1 s** (stricter than the 3 per second in WCAG 2.3.1); the burst is **one ramp**, never a pulse train; screen-wide additive flash alpha **at most 0.25**;
  ring pulses at least **500 ms apart**; **no saturated-red flashing**, and the palette's ember-coral and lagoon-cyan must **never alternate faster than 2 Hz** (the 1997 incident involved red and blue flashing, at roughly 12 Hz, **[G]**).
  Implementation: a `FlashGovernor` in render counts luminance transitions per rolling second and clamps extras; an automated probe renders each reveal headless, computes per-frame mean luminance, and fails if any 1-second window has more than 3 flash transitions.
* **Calm effects** (setting; **on by default when `prefers-reduced-motion` is set**): no camera moves, no slow-motion, no screen shake, particle counts x0.3, rings become fades, all durations x0.65, **no pulses at all**; tier shown by static aura, gem frame and sound.
* **Skip animations** setting jumps straight to the reveal frame (plate and badge). **Sound off** keeps every visual cue. **Haptics off** is a setting; web vibration is unavailable on iOS Safari (**[G]**) so nothing depends on it.
* **Rarity is never colour-only:** gem shape (circle, diamond, hexagon, 4-star, 6-star, prism) plus text label plus sound signature.

### 6.7 Haptics per tier (`navigator.vibrate` patterns, milliseconds, optional)

| Event | Pattern |
|---|---|
| Meter full | [10] then on landing [18] |
| Common | [12] |
| Uncommon | [12, 60, 8] |
| Rare | [10, 50, 14, 50, 18] |
| Epic | [14, 40, 18, 40, 22, 40, 26, 80, 30] |
| Legendary | [10, 20, 14, 20, 18, 20, 22, 20, 26, 20, 30, 120, 45] |
| Mythic | swell [10, 25, 12, 25, 14, 25, 16, 25, 18, 25, 20, 25, 22], gap 250, then [60, 60, 60] |
| Merge T0 to T2 | rumble [8, 52] repeating, tightening to [14, 20]; T3 burst by result tier above |

---

## 7. Module map, build order and the seams the slice already leaves

### 7.1 Seams in the code today

| Seam | Today | What the economy needs |
|---|---|---|
| `Genome.species` (`src/core/genome.ts`) | `SPECIES = ['dollop']`; share string stores the species **index in one byte** | Grow to 50 ids, **append-only** (never reorder, up to 256). Tier and family are **not** in `Genome`; they come from the catalog by species. |
| `Genome` numeric traits | quantised to 1/255, `seed` uint32 cosmetic | Capsule genome = species template with jitter; merge genome = template mixed with the two parents (circular mean of hue and coreHue). Every instance stays visually unique. |
| Share string `g1.` | lossless, 38 chars, hostile input returns `null` | **Look-only.** Never a claim ticket for ownership; trade, merge and board accept item ids, not strings. A decoded string is a "ghost" you can view, not own. |
| `SquishyInstance.id` | `crypto.randomUUID()` default | Owned items get a **server-minted** id (unique constraint, never reused). Client ids are local-ghost only. |
| `SquishyInstance.origin` | `{ kind: 'starter' \| 'drop' \| 'task' \| 'blend' \| 'trade'; parents? }` | **Immutable creation record.** `drop` = capsule, `task`, `blend` = merge output (keep the string, avoid touching the frozen type), `parents` = the 2 consumed ids. `trade` is **not written** (provenance of ownership is `tradeCount` plus the ledger). Add `'restock'` as an optional additive later. |
| `SquishyInstance.tradeCount` | `0` at birth | **Server increments only**, never the client; shown as "traded Nx". |
| `SquishyInstance.name` | free string | Catalog name plus optional nickname chosen from a fixed list. **No free text.** |
| Server record (new, not in `genome.ts`) | none | `ItemRecord { instance, ownerId, version, lockedUntil, inTradeId? }` kept server-side; `version` powers optimistic concurrency. |
| `SoftEvent` (`src/contracts.ts`) | `poke`, `press`, `release`, `land`, `grab`, `snap` with `intensity`, `heldFor` | Meter inputs (5.4). **No new physics events needed.** |
| Portal bridge | `postMessage`, game never sees a token (`blocktooth/src/net/portal.ts`) | Add `forgeflow:rpc` request/response for `wh_*` calls; guests stay local. |

### 7.2 Modules and build order

| Order | Module | Contents | Depends on |
|---|---|---|---|
| 0 | Slice 1 (now) | Soft body, audio, render, shell for one squishy | none |
| 1 | **COLLECTION** (`COLLECTION.md`) | `src/core/catalog.ts` (50 species: id, name, tier, family, signature touch), `economy.ts` (odds, costs), `meter.ts` (rules in 5.4), capsule open + reveal (6.3), Hoard UI with stacks, restock, tasks. Local-only items flagged non-tradeable. | slice 1, `materials.ts` |
| 1b | **SERVER MINT** | Supabase tables + RPCs: `wh_report_play`, `wh_open_capsule`, `wh_claim_restock`, `wh_complete_task`. Server owns the meter caps, the RNG and ids. **A local save is never promoted to tradeable.** | 1, portal bridge |
| 2 | **MERGE** (`BLEND.md`) | `src/core/merge.ts` (`MERGE_COST`, roll, preview), `wh_merge` RPC, ceremony (6.4), Tidy-up | 1b |
| 3 | **TRADE** (`TRADE.md`) | friend codes, board, `wh_propose_trade` / `wh_confirm_trade` / `wh_cancel`, escrow, locks, ledger, reports, kill-switch | 1b (parallel with 2) |

Why server mint comes before trade: a forgeable local inventory makes every Mythic suspect. Why trade can start without merge: they share only the lock.

---

## 8. Safety and ethics

### 8.1 Money and randomness
* **No real-money path in v1**: no purchases, no ads, no virtual currency. Capsules, restock and tasks are free, so there is no paid randomness.
  If money ever appears, the rule is fixed now: **direct purchase of cosmetics only, never random, never tradeable for tier items**.
* **Odds are public anyway:** the tier table (5.2) and the merge preview odds are shown in-game, the practice Apple requires for paid random items (**[O]** guideline 3.1.1) and the FTC enforced in 2025.
* Completing a row gives a **fixed cosmetic**, never a random bonus item.

### 8.2 Players and privacy (design for the strictest case)
* **No free text anywhere**: names from lists, trade emotes from a fixed set of 6, reports from fixed reasons. No voice, photos, location or contacts.
* **Friend code or board only.** Codes are 8 characters without look-alike letters, mutual accept, 10 attempts an hour. **Do not use the portal's `find_users`** (searches by email or username).
* Anonymous alias (adjective plus noun) and the player's best squishy as avatar; no profile page.
* Age: the portal account is email-based, so COPPA and UK Children's Code duties sit with the portal. The game collects **no personal data of its own**, keeps high-privacy defaults, profiling off, no nudges.
  Recommended: trading is enabled only for accounts the portal marks as old enough or parent-approved (open question 1).
* Block and report on every trade card; blocked players cannot see your board listings.

### 8.3 Dupe-proofing and provenance
* **Single writer:** only server RPCs change ownership. Clients send item ids and an idempotency key, never item data.
* **`commit_trade`:** one transaction locks both item sets (`SELECT ... FOR UPDATE`), re-checks owner, `version`, `lockedUntil` and `inTradeId`, swaps owners, bumps `tradeCount` and `version`, sets `lockedUntil`, writes two ledger rows; any failure rolls back everything. **`merge`:** consume 2 and mint 1 in one transaction with a server-side RNG.
* **Conservation check** every hour: items minted minus items consumed must equal items held; a mismatch freezes trading. A **kill-switch** freezes trading and merging globally. Ledger plus `origin.parents` let a bad batch be traced and recalled.
* **Locks and caps:** 24 h receive and merge lock, 3 trades a day, 1 per partner a day, new-account gate (5.7). Together they cut a hostile ring's output from thousands of copies to about 5 and its laundering to 0 (5.10).
* **Real-money trading:** no currency, and tier parity means value cannot be moved with lopsided deals; still forbidden in the terms and monitored for one-sided flows.

### 8.4 Pressure and rhythm
* No streaks, no countdown FOMO, no "you lost it", no push notifications by default. Restock offers refresh daily and never accumulate guilt. Caps are framed as rest, not punishment (UK Children's Code: no nudge techniques).
* Merge is never silent: hold to confirm, preview odds, last-copy warning, favourites protected.

### 8.5 Light, motion, sound
* Flash budget and Calm effects (6.6); **photosensitivity** is treated as a safety issue, not polish. Volume ramps on every voice; haptics optional.

---

## 9. Originality checklist (a reviewer ticks each box)

- [ ] **Names:** no species, tier or mechanic name copies a reference or a known franchise; **do not use** plort, largo, Tarr, neon, mega, Squishmallow, Pokemon words, "gacha pull" or any brand. Tier names (Common to Mythic) are generic English; a trademark search on all 50 species names and the title is done before release.
- [ ] **Palette:** only the `CONTRACT.md` tokens (ink-indigo, plum, dusk violet, felt, sodium amber, lagoon, ember coral, cream); no pastel-kawaii shelf; tier colours come from these tokens.
- [ ] **Shapes and faces:** two glossy eyes, no mouth; species shapes are our radial-deformation families, not traced from any toy or game.
- [ ] **Sounds:** every voice is WebAudio synthesis in `src/audio/voices.ts`; no samples, loops or recordings; the Mythic motifs are ours.
- [ ] **UI:** our layout (felt cabinet Hoard, merge pad, capsule drop), our type (system stack, heavy rounded), our wordmark; nothing resembles a reference screen.
- [ ] **Reference assets:** zero files from either clip or any game; `git ls-files` shows no audio, image, font or model binaries except `public/thumbnail.png` rendered from our game.
- [ ] **Copy:** plain, short English; no reference to another game, brand or character in any string.
- [ ] **Effects:** the merge ceremony's fold-and-spring is our soft-body timing and colours, not a recreation of the clip.
- [ ] **Mechanics credited as common practice only:** same-species fusion (Adopt Me's Neon is 4-to-1 and deterministic), combine-two (Little Alchemy), request/offer boards (Pokemon GTS) are generic patterns; our rules and numbers are our own.

---

## 10. Risks and open questions for the owner

| # | Risk or question | Why it matters | Suggested answer |
|---|---|---|---|
| 1 | **Age and consent.** Who is the audience, and does the portal account (email sign-up, `find_users` by email) allow children? | COPPA, UK Children's Code, Apple Kids rules. Trading needs sign-in. | Decide the age bar; trading only for parent-approved or old-enough accounts; guests play locally with no trading. |
| 2 | **Server dependency.** Trade, merge and capsule opening need the Supabase ledger. | A forgeable local save would ruin the economy; offline play cannot be tradeable. | Build 1b before 2 and 3; keep a local "demo shelf" that is never promoted. |
| 3 | **The economy ends.** A regular finishes all 50 in about 131 days with trade. | After that, no new species means no trade, and veterans' spares cannot help newcomers. | Plan **seasons**: about 4 to 6 new species every 8 weeks, appended to tiers; cosmetics for finished rows. |
| 4 | **Solo-to-trade is 1.6 to 1.7x, not 2x.** | Trade cannot mint copies; even a frictionless oracle reaches 1.78x. | Accept, or add more Epic+ species. We chose pacing. |
| 5 | **Every number rests on assumed behaviour.** | 3.1 min per capsule is a model of human touching. | Playtest early; instrument aggregate (not personal) timing; retune `capsuleCost`. Sensitivity: 2x slower is 5.4 min per capsule (edge of grind). |
| 6 | **Dozens of repeat Commons.** 90% of capsules are repeats by week 3. | Could feel flat. | Reveal compresses repeats; Tidy-up; Rare+ repeats are the trade fuel. If it feels flat, raise Uncommon odds before touching the meter. |
| 7 | **Bots and macros.** | A cycler hits 40 SP/min. | Daily cap of 12 capsules, server-side plausibility checks on touches, no cash value. Cannot be zero. |
| 8 | **Grey-market trading** of tier items outside the game. | Happens in every trading game. | Terms; tier-parity makes buying with lopsided deals impossible; monitor one-sided flows. |
| 9 | **Merge preview honesty and last-copy mistakes.** | Regret erodes trust. | Hold-to-confirm, last-copy warning, favourites. |
| 10 | **Art cost.** 15 of 50 species are Epic or above with tier FX. | Time. | FX are per-tier presets, not per-species. |
| 11 | **Trade fuel for Mythics.** Only 3 species; a swap needs a spare of the *other* Mythic. | Mythic swaps are rare events. | Intended. Check in the first month of data. |
| 12 | **Physics lane must emit the touches the meter reads** (`release.heldFor`, `snap.intensity` threshold). | The 3.1 min figure assumes the micro-model's timings. | Add the meter to the G3/G4 gates. |
| 13 | **Sources.** All research is [S] except Apple's guidelines. | Some claims may have drifted. | Re-verify 3.1 and 3.2 once a network without the egress block is available. |

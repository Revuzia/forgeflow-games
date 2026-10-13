# VALE — the owner's brief (verbatim, 2026-10-07) and later direction

This is the contract with the owner. Do not soften it. Later direction from the owner is
appended below the brief.

---

You are the lead on an original live-service game for Forgeflow Games. Working title: Vale. Ship a playable vertical slice at AAA production standard, with high-tier graphics, not a jam prototype and not a clone.

STACK
Choose the engine, renderer, and art pipeline that will produce the best-looking playable version you can actually finish. Do not default to the easiest web demo. Unity, Unreal, Godot, or a custom Three.js / WebGPU client are all allowed. Pick one and commit. Use Blender, or an equivalent DCC, for hero characters, weapons, and map landmarks. Use a material, lighting, and post stack that reads as a shipped game: PBR, a real sky, fog, contact shadows, a locked color grade. Procedural tools are allowed for terrain, scatter, trim, and crowds. They are not allowed to replace the hero roster or the landmarks. If a tool is required for the look and you can run it, use it. Do not describe the look and ship blocks.

RESEARCH, THEN INVENT
Before any content is locked, research agents gather what a shipped competitive lane-brawler actually is. Do not trust memory. Confirm the live mode list. Primary reference for systems: League of Legends as it exists now, plus public notes on Dota 2 where the client, spectator, and post-game are stronger references.

Research the whole product, not just the match:
- Match rules, roles, phases, vision, objectives, items, draft, queues, bots, one-lane brawl.
- Client flow: home, play, party, mode select, lobby, loadout, collection, shop, profile, settings, post-game.
- HUD, minimap, ping language, death recap, scoreboard.
- Camera, readability, telegraph, colorblind team coding.
- Art direction and UI craft of shipped games in this genre: what makes a menu feel finished, not what it depicts.
- Audio: music beds, impact, announcer, shop confirm, match end.
- Session model used by live games of this type.

Write an internal design note in original words. Then write a one-page style bible before production: world, palette, type, menu mood, in-game camera, HUD density. The bible is law for every screen.

Do not copy. Not names, kits, ability text, item lists, map layout, objective names, UI layout, fonts, icons, VFX, music, voice, lore, or trademarks. Riot, League of Legends, Summoner's Rift, Howling Abyss, Dota, and every fighter and skin name from those games are off limits. Public systems may inform the design. Protected expression may not. If a detail is not invented here, invent it.

SCOPE
Three original modes. Queues are not modes.

1. RIFT — two teams of five. Three lanes, a jungle, structures that must fall before the core. Roles are a contract. Standard queue, a faster queue, a ranked queue with its own rating, and co-op against bots. Same map, different rules layers.
2. BRIDGE — one lane, five versus five, fighters assigned at random, with a bench trade. Shorter match. Teamfight is the game.
3. FRAY — free-for-all. Every player is their own team. Last one standing, or first to a kill score, on a small map with a shared shop and pickups. Death sends you back in. Placement matters, not just the winner.

No autobattler. No pair mode. No rotating party mode in this slice. Leave a mode slot in the client so one can be added later from data.

CLIENT
The client is part of the game. Home, play, collection, shop, profile, settings, post-game. Mode select must make Rift, Bridge, and Fray feel like one product. Champ select, loadout, and shop use the style bible, not a default engine menu. Post-game shows the result, the grants, and a path back to play. Settings include video, audio, controls, colorblind mode, and UI scale.

ROSTER
A launch roster large enough that draft, bans, and random assignment all function. Each fighter has a role, a resource, a distinct kit, and a clear job in a fight. Kits are original. A small item catalog with real build paths. A setup layer chosen before the match. The same roster plays all three modes. Fray may use a lighter loadout if the full shop would break a free-for-all.

PRESENTATION
High-tier, not placeholder. Readable at camera distance: silhouette, team color, telegraph, impact. In Fray every fighter needs their own color. Original world, original names, original interface. Spectator clarity beats decoration. Hero fighters are modeled and lit. Maps have landmarks and lanes that read from the minimap. Menus are designed screens, with motion, states, and empty states. Audio is original and matches the bible: a menu bed, a match bed, impact, and a match-end sting. No imported soundtrack.

PRODUCTION BAR
Simulation and presentation are separate. Content is data. A new fighter, map, item, skin, or screen does not require a rewrite.
Client build and content build ship separately. Catalog is versioned. Old clients keep the old schema.
Cosmetics never change stats. Currency earned by play buys skins. Ownership is an explicit record.
Bots can fill every mode. A practice tool and a custom lobby exist.
Ranked is a queue on Rift with a rating, not a separate game.
Target a stable 1080p60 on a reasonable gaming PC, with a scalable quality ladder.
Session model is explicit: local with bots for this slice, with the seam for a dedicated server. No accounts. Leave the seam where login replaces the local profile.
The client boots from a catalog URL so it can move to a CDN later without a rebuild.

DONE
A person can move through the client, queue each mode, draft or get assigned, play a full match to a real win condition, hear the match end, read the post-game, earn currency, buy a skin, and equip it. Bots can fill every mode. The design note cites what was researched, names the stack and why, includes the style bible, and lists every name that was deliberately not used. Graphics and menus are shippable, not blocks.

---

## Owner direction after the first build (2026-10-13)

- **Quality bar.** The visual quality must match League of Legends. That covers VFX (spells must
  have great effects), characters, scenery, menus and descriptions. The owner reviewed the first
  screenshots and judged that none of these were near that bar yet.
- **3D art.** No Meshy or any other external 3D generator. Use Blender and make much better models.
- **2D art.** xAI (Grok image generation) may be used for 2D images: scenery, icons, key art and
  anything else 2D. It runs on the owner's PC, where the key lives in
  `state/.secrets/tokens.json`, and Chrome with the Claude extension is available there.
- **Machine.** Work moves to the owner's PC (local mode) for its GPU, xAI access and real-browser
  testing.

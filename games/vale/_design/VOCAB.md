# VALE — shared content vocabulary (LEAD, 2026-10-07)

Every content author uses ONLY these ids for presentation hooks. The vocabulary agent writes the full
records (content/vfx.json, content/audio.json); authors reference ids. New ids need a LEAD note here.

## Asset path conventions (AssetRef, relative to the catalog root)
- Fighter base: `assets/fighters/<fighter>/<fighter>.glb`, `assets/fighters/<fighter>/portrait.png`, `…/splash.png`, `…/icon.png`
- Skin: id `<fighter>_<variant>` → `assets/fighters/<fighter>/<skin_id>.glb`, `…/<skin_id>_portrait.png`, `…/<skin_id>_splash.png`. The base skin id is `<fighter>_base` and points at the base files.
- Units: `assets/units/<unit_id>.glb` (+ `assets/units/<unit_id>_icon.png` when it needs one)
- Maps: `assets/maps/<map_id>/scene.glb`, `…/sky.hdr`, `…/minimap.png`; the locked grade `assets/grade/vale_grade_01.cube`
- Icons (SVG, authored by the UI icon lane): abilities `assets/ui/icons/abilities/<ability_id>.svg` · items `assets/ui/icons/items/<item_id>.svg` · spells/boons `assets/ui/icons/setup/<id>.svg` · roles/classes/resources/currency/ranks/team buffs/paths `assets/ui/icons/<family>/<id>.svg`
- Mode cards: `assets/ui/modes/<mode>_card.webp`, glyph `assets/ui/modes/<mode>_glyph.svg`; home art `assets/ui/home/<id>.webp`
- Audio: cue `assets/audio/<cue_id>.ogg`; music `assets/audio/music/<music_id>.ogg`

## VFX library (content/vfx.json, CONTRACT §9.5; bible: Lumen = additive light + glass shards, Shade = ink with a light rim; emissive caps T0–T4 0.8·1.5·3·6·≥10; only T4 reaches white; danger edge brightest; impacts throw opaque chips; up = help, out = harm)
Projectiles: lib_bolt_lumen, lib_bolt_shade, lib_arrow, lib_shard_volley, lib_orb_lumen, lib_orb_shade, lib_thrown_blade, lib_lob
Impacts: lib_hit_phys_light, lib_hit_phys_heavy, lib_hit_magic, lib_hit_true, lib_crit
Areas: lib_burst_lumen, lib_burst_shade, lib_slam_ground, lib_cone_sweep, lib_ring_pulse, lib_line_cleave
Zones: lib_zone_lumen, lib_zone_shade, lib_zone_glass (slow), lib_zone_ember (burn)
Movement: lib_dash_trail, lib_blink, lib_leap
Status/buffs: lib_shield_up, lib_heal_rise, lib_haste, lib_stun_ring, lib_root_bind, lib_slow_glass, lib_silence, lib_empower, lib_reveal_mark, lib_mark_stack
Summon: lib_summon_rise
Ultimate tier: lib_ult_windup, lib_ult_lumen, lib_ult_shade
World: lib_level_up, lib_respawn, lib_recall, lib_death_shatter, lib_gleam_pickup, lib_sunmote_pickup, lib_structure_fall, lib_wick_death, lib_needle_shot, lib_objective_taken
Bespoke presets: `<fighter>_<slot>_<word>` (every ultimate gets one; others optional).

## Audio cues (content/audio.json; bible: D Dorian + Lydian G#, glass and wood UI, never beeps, enemy T3+ wind-ups share one shade-breath swell)
UI: ui_hover, ui_click, ui_confirm, ui_back, ui_error, ui_tab, ui_toggle, ui_slider, ui_queue_search, ui_queue_pop, ui_accept, ui_lockin, ui_ban, ui_hover_fighter, ui_shop_buy, ui_shop_sell, ui_shop_undo, ui_currency_tick, ui_equip, ui_purchase, ui_reward_reveal, ui_level_account, ui_notify
Match: m_level_up, m_takedown, m_ally_down, m_self_down, m_respawn, m_objective_ally, m_objective_enemy, m_structure_ally_fall, m_structure_enemy_fall, m_wave_spawn, m_recall_start, m_recall_done, m_ping_alert, m_ping_danger, m_ping_onmyway, m_ping_missing, m_ping_assist, m_ping_push, m_ping_vision, m_ping_objective, m_ping_retreat, m_gleam, m_countdown, m_match_start, m_sudden_death, m_sunmote, m_eliminated, m_announce_minor, m_announce_major, m_enemy_windup, m_victory_sting, m_defeat_sting, m_placement_sting
Combat: c_swing_light, c_swing_heavy, c_shot_bow, c_shot_bolt_lumen, c_shot_bolt_shade, c_thrown, c_hit_phys_light, c_hit_phys_heavy, c_hit_magic, c_hit_true, c_crit, c_cast_lumen, c_cast_shade, c_cast_charge, c_cast_big, c_proj_whoosh, c_dash, c_blink, c_slam, c_burst_lumen, c_burst_shade, c_zone_loop, c_shield, c_heal, c_stun, c_slow, c_root, c_buff, c_summon, c_ult_windup, c_ult_release, c_needle_shot, c_needle_hit, c_structure_fall, c_wick_die, c_monster_roar, c_monster_hit, c_death_shatter
Music ids: mus_menu (60 BPM), mus_draft (90), mus_match_rift, mus_match_bridge, mus_match_fray (120; each with a layer `intense`), mus_postgame

## Sim plane orientation (bible camera looks −Z)
Screen-left = low x (Aubade), screen-right = high x (Serenade), screen-top = low y, screen-bottom = high y. Team maps mirror across x = size[0]/2.

## Calibration ranges (public-system reference ranges; tune within them)
Fighter L1 hp 560–690 (+92–112/lvl) · ad 52–66 (+2.8–3.8) · armor 26–38 (+4–5) · resist 30–32 (+1.3–2) · attackSpeed 0.62–0.70 base (+1.5–3.5%/lvl as growth fraction) · moveSpeed 3.30–3.60 m/s · melee range 1.6–2.1 m · ranged 5.0–6.0 m · ability range ≤ 10 m (longer gets an edge marker, ≤ 14 m) · basic cooldowns 5–16 s · ult 70–130 s · rank-1 basic damage 50–95 + ratio 0.3–0.9 · Light pool 280–420 (+30–50/lvl) · level cap 18 (Rift).

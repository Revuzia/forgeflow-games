# VALE fighter kits (from content/fighters, collected not judged)

Sources: content/fighters/*.json. Numbers with / are per rank 1-5; 'dmg ap/bonusHp' etc are scaling coefficients. Damage lists only op=damage effects; DoT/zone payloads nested in effects are included where they use op damage.

## Ardit (ardit) - Pavise bearer
role grovehunter / lampglass, class class_plinth, resource res_light, difficulty 1, tags aubade, melee, frontline, protector, disarm, aura

Base: hp 670 (+108), res 30, ad 58, armor 36, mr 32, AS 0.64, MS 3.35, auto range 1.9, phys, windup 0.25

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Turned Blades | - | - | triggers: statusApplied | - | - | - | - | - |
| a1 | Lancing Run | 14/13/12/11/10 | 60/65/70/75/80 res | direction 7 | 0.15 | magic 70/105/140/175/210 (0.5ap+0.03bonusHp) | - | damage, dash, displace | - |
| a2 | Glare | 13/12.5/12/11.5/11 | 60/65/70/75/80 res | direction 5 | 0.3 | magic 55/85/115/145/175 (0.5ap) | - | area, damage, status | disarm, slow |
| a3 | Spire Strike | 8/7.5/7/6.5/6 | 40/45/50/55/60 res | self - | 0.25 | magic 60/95/130/165/200 (0.55ap) | - | area, damage, status | slow |
| ult | Muster | 110/95/80 | 100 res | self - | 0.35 | - | - | buff, status, zone | disarm |

Text:
- passive: Each time Ardit disarms an enemy fighter (at most once per 1.5 s from each enemy), he gains {triggers.0.effects.0.stats.armor} armor and magic resist for 5 s. This stacks up to 3 times.
- a1: Ardit runs up to 7 m behind the pavise and stops at the first enemy fighter he meets. They take {effects.0.onPass.0.amount} magic damage and are knocked airborne for 0.75 s.
- a2: Ardit tilts the pavise to catch the dawn. Enemies in a 5 m, 70° cone take {effects.0.onHit.0.amount} magic damage, are slowed by 25% for 1.5 s and are disarmed for {effects.0.onHit.2.duration}.
- a3: Ardit drives the pavise's spire into the ground. Enemies within 2.5 m take {effects.0.onHit.0.amount} magic damage (60% more against monsters) and are slowed by 20% for 1.5 s.
- ult: Ardit raises the pavise as a beacon for 5 s. Allied fighters within 6 m, himself included, gain 20% move speed and {effects.0.onTick.0.statScaling.armor} armor and magic resist, and every enemy fighter that enters the 6 m radius is disarmed for 1 s.

## Burdam (burdam) - Grudge holder
role shadehold / grovehunter, class class_breaker, resource res_tally, difficulty 1, tags serenade, melee, bruiser, sustain, marks, pull

Base: hp 665 (+109), res -, ad 64, armor 34, mr 32, AS 0.66, MS 3.45, auto range 2, phys, windup 0.26

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Long Memory | - | - | triggers: damageTaken, attackHit | - | - | - | - | - |
| a1 | Bear Down | 10/9.5/9/8.5/8 | 0 res | unit 5 | 0.1 | phys 60/90/120/150/180 (0.8bonusAd) | - | damage, dash, if, status | slow |
| a2 | Stubborn | 13/12/11/10/9 | 30 res | self - | 0 | phys 50/80/110/140/170 (0.5bonusAd) | - | area, buff, damage | - |
| a3 | Old Wound | 8/7.5/7/6.5/6 | 40 res | direction 4 | 0.25 | phys 70/105/140/175/210 (0.9bonusAd); phys 20/30/40/50/60 (0.27bonusAd) | - | area, damage, if, status | slow |
| ult | Settled Account | 90/75/60 | 0 res | none - | 0.35 | phys 40/65/90 (0.25bonusAd) | heal 0 (0.03maxHp) | area, consumeMark, damage, displace, heal, if, status | stun |

Text:
- passive: When an enemy fighter damages Burdam, they gain a Grudge stack for 6 s (up to 5; at most one stack per 0.5 s from each enemy). Burdam's basic attacks against a Grudge-bearer heal him for 1.5% of his max Health and give him {triggers.1.effects.1.amount} Tally.
- a1: Burdam lunges up to 5 m at an enemy and chops them for {effects.0.onArrive.0.amount} physical damage. A Grudge-bearer is also slowed by 40% for 1.5 s.
- a2: For 3 s Burdam gains {effects.0.statScaling.armor} armor and magic resist and 30% tenacity. When it ends he stamps, dealing {effects.0.onExpire.0.onHit.0.amount} physical damage to enemies within 3 m.
- a3: Burdam cleaves a 4 m, 100° arc for {effects.0.onHit.0.amount} physical damage. Grudge-bearers hit take {effects.0.onHit.1.then.0.amount} more physical damage and are slowed by 50%, fading over 2 s.
- ult: Every Grudge-bearer within 7 m is dragged 3 m toward Burdam and stunned for 0.5 s. Each pays {effects.0.onHit.0.then.0.perStack.0.amount} physical damage per Grudge stack, and Burdam heals 3% of his max Health per stack. This spends the Grudges.

## Dunsom (dunsom) - Dusk herder
role dialcross / lampglass, class class_caster, resource res_light, difficulty 3, tags serenade, ranged, mage, displacement, control, root

Base: hp 580 (+94), res 80, ad 54, armor 26, mr 30, AS 0.64, MS 3.35, auto range 5.2, magic, windup 0.23

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Settling | - | - | triggers: statusApplied | - | - | - | - | - |
| a1 | Draw In | 8/7.5/7/6.5/6 | 60/65/70/75/80 res | point 9 | 0.25 | magic 60/94/128/162/196 (0.55ap); magic 12 (3level+0.1ap) | - | area, damage, displace, if | - |
| a2 | Crook Sweep | 11/10.5/10/9.5/9 | 70 res | direction 7 | 0.3 | magic 80/120/160/200/240 (0.55ap); magic 12 (3level+0.1ap) | - | damage, displace, if, projectile | - |
| a3 | Step Through Dusk | 15/14/13/12/11 | 60 res | direction 4 | 0 | - | - | blink | - |
| ult | Driving Hour | 120/100/80 | 100 res | point 9 | 0.35 | magic 200/300/400 (0.8ap); magic 12 (3level+0.1ap) | - | area, consumeMark, damage, displace, if, mark, status | root |

Text:
- passive: Enemies Dunsom displaces are Settled for {triggers.0.effects.0.duration}. Each time his abilities damage a Settled enemy, they take 12 bonus magic damage, plus 3 per level and 10% of his Power.
- a1: After 0.4 s, enemies within 3 m of a point up to 9 m away take {effects.0.onHit.0.amount} magic damage and are drawn up to 2 m toward its center.
- a2: Dunsom sweeps a wave of dusk 7 m along the ground. Every enemy it touches takes {effects.0.onHit.0.amount} magic damage and is pushed up to 2.5 m toward the point he aimed at.
- a3: Dunsom steps through the dusk and reappears up to {effects.0.distance} away.
- ult: Dunsom picks a point within 9 m. Every enemy within 5 m of him is hurled up to 5 m toward it, and 0.6 s later the point erupts: enemies within 2.5 m take {effects.2.onHit.0.amount} magic damage and are rooted for 1.25 s.

## Ervet (ervet) - Glass blade
role shadehold / dialcross, class class_breaker, resource res_light, difficulty 2, tags aubade, melee, bruiser, forms, shatter, airborne

Base: hp 645 (+105), res 30, ad 63, armor 31, mr 30, AS 0.65, MS 3.45, auto range 2, phys, windup 0.25

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Dawnglass Edge | - | - | triggers: attackHit, attackHit | - | - | - | - | - |
| a1 | Heavy Arc | 9/8.5/8/7.5/7 | 45/50/55/60/65 res | direction 3.5 | 0.3 | magic 70/105/140/175/210 (0.5ap+0.03bonusHp) | - | area, damage, status | slow |
| a2 | Glass Guard | 14/13/12/11/10 | 50/55/60/65/70 res | self - | 0.1 | - | shield 30/45/60/75/90 (0.1maxHp) | shield | - |
| a3 | Shatter | 16/15/14/13/12 | 60/65/70/75/80 res | self - | 0.3 | magic 80/120/160/200/240 (0.6ap) | - | area, damage, form, status, zone | slow |
| ult | Whole Again | 100/85/70 | 100 res | point 6 | 0.3 | magic 150/250/350 (0.7ap+0.05bonusHp) | - | area, damage, dash, displace, form, mark | - |

Text:
- passive: Ervet's attacks deal an extra 2% of her max Health as magic damage. With the blade whole she has +15 armor and magic resist; in Hilt form she has 15 less than her base armor and resist, but moves 20% faster and attacks 30% faster (reach 1.7 m). Her attack on an enemy carrying a lodged shard tears it out: it bursts for 20 + 6 per level (+3% bonus Health) magic damage and slows by 30% for 1 s, to that enemy and everyone within 1.75 m of it.
- a1: Ervet sweeps the blade through a 3.5 m, 140° arc, dealing {effects.0.onHit.0.amount} magic damage and slowing enemies by 25% for 1.5 s.
- a2: Ervet braces behind the blade and shields herself for {effects.0.amount} for 2 s.
- a3: Ervet smashes the blade into the ground: enemies within 3 m take {effects.0.onHit.0.amount} magic damage and are slowed by 40% for 1.5 s. Shards slow by 20% for 2 s and the blade breaks into its Hilt for up to 6 s.
- ult: Ervet leaps up to 6 m and calls every shard home. As she lands, enemies within 4.5 m take {effects.0.onArrive.0.onHit.0.amount} magic damage, are dragged 2 m toward her and each keeps a lodged shard for 6 s. The blade is whole again for 6 s at its usual reach; her attacks tear lodged shards out (see Dawnglass Edge).

## Hesmi (hesmi) - Shard bearer
role shadehold / grovehunter, class class_plinth, resource res_unlit, difficulty 2, tags hourless, melee, tank, zone, stun, cooldowns

Base: hp 690 (+112), res -, ad 60, armor 38, mr 32, AS 0.62, MS 3.35, auto range 1.8, phys, windup 0.245

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Shade-Fed | - | - | triggers: attackHit, damageTaken | - | - | - | - | - |
| a1 | Plant Shard | 12/11/10/9/8 | 0 none | point 6 | 0.3 | phys 80/120/160/200/240 (0.04bonusHp) | - | area, damage, mark, status, zone | slow, stun |
| a2 | Shoulder the Stone | 11/10.5/10/9.5/9 | 0 none | direction 4.5 | 0.1 | phys 60/90/120/150/180 (0.03bonusHp) | - | damage, dash, displace, mark | - |
| a3 | Stand Firm | 16/15/14/13/12 | 0 none | self - | 0 | - | - | buff, counter | - |
| ult | Felled Shard | 110/95/80 | 0 none | point 9 | 0.35 | phys 150/250/350 (0.06bonusHp) | - | area, damage, mark, status, zone | haste, slow, stun |

Text:
- passive: Hesmi's basic attacks against Shaded enemies deal {triggers.0.effects.0.amount} bonus physical damage (60% against monsters). While Stand Firm lasts, enemy fighters who hit her become Shaded.
- a1: Hesmi drives a shard into the ground up to 6 m away. For 3 s it casts a 9 m by 2.5 m shadow pointing away from her: enemies in it are slowed by 25% and Shaded. Then the shard topples along its shadow: enemies still in it take {effects.0.onExpire.0.onHit.0.amount} physical damage and are stunned for 0.75 s.
- a2: Hesmi lunges 4.5 m. Enemies she passes take {effects.0.onPass.0.amount} physical damage, are knocked 1.5 m aside and become Shaded.
- a3: For 2.5 s Hesmi gains {effects.0.statScaling.armor} armor and magic resist and 30% tenacity. Enemy fighters who hit her meanwhile become Shaded.
- ult: Hesmi drops a great shard at a point within 9 m. After 0.75 s, enemies under it (2 m) take {effects.0.onHit.0.amount} physical damage and are stunned for 1.25 s. It then throws a 12 m by 5 m shadow for 5 s that slows enemies by 40% and Shades them, while allied fighters in it gain 15% move speed.

## Ilsheta (ilsheta) - Lamp hanger
role lampglass / None, class class_tender, resource res_light, difficulty 1, tags aubade, ranged, support, heal, shield, vision

Base: hp 570 (+92), res 100, ad 52, armor 26, mr 30, AS 0.63, MS 3.35, auto range 5.4, magic, windup 0.23

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Warm Hands | - | - | triggers: abilityHit | - | - | - | - | - |
| a1 | Glint Bolt | 7/6.5/6/5.5/5 | 50/55/60/65/70 res | direction 9 | 0.25 | magic 60/95/130/165/200 (0.6ap) | - | damage, projectile, status | slow |
| a2 | Hung Lamp | 14/13/12/11/10 | 70/75/80/85/90 res | unit 8 | 0.2 | - | heal 10/14/18/22/26 (0.06ap); heal 4/5.6/7.2/8.8/10.4 (0.024ap) | heal, if, mark, reveal, status, zone | haste, slow |
| a3 | Dawnglass Shell | 12/11.5/11/10.5/10 | 60/65/70/75/80 res | unit 7 | 0 | - | shield 60/95/130/165/200 (0.45ap) | shield, status | haste |
| ult | Every Window Lit | 120/100/80 | 100 res | none - | 0.3 | - | heal 16/24/32 (0.08ap); heal 6.4/9.6/12.8 (0.032ap) | area, heal, if, mark, repeat, reveal, status, zone | haste |

Text:
- passive: Ilsheta's heals restore 40% more to allies who are stunned, rooted, slowed, airborne, asleep, feared or taunted, and give them 15% move speed for 1.5 s (once per 4 s per ally).
- a1: Ilsheta throws a dawnglass bolt up to 9 m. The first enemy hit takes {effects.0.onHit.0.amount} magic damage and is slowed by 25% for 1.5 s.
- a2: Ilsheta hangs a lamp on an allied fighter or herself for 4 s. Every 0.5 s it heals allied fighters within 3 m of its bearer for {effects.0.onTick.0.amount}, and enemies in its light are revealed and slowed by 10%.
- a3: Ilsheta shields an allied fighter or herself for {effects.0.amount} for 2.5 s and gives them 20% move speed for 1 s.
- ult: Ilsheta lights a lamp on every allied fighter within 9 m, herself included, for 5 s. Each lamp heals its bearer for {effects.0.onHit.0.effects.0.amount} every 0.5 s (Warm Hands applies) and reveals enemy fighters within 2.5 m of it.

## Kemdo (kemdo) - Burning glass
role grovehunter / shadehold, class class_breaker, resource res_heat, difficulty 2, tags hourless, melee, bruiser, diver, heat, true_damage

Base: hp 630 (+100), res -, ad 64, armor 33, mr 32, AS 0.65, MS 3.45, auto range 2.1, phys, windup 0.25

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Cooling Kill | - | - | triggers: takedown | - | - | - | - | - |
| a1 | Long Thrust | 7/6.5/6/5.5/5 | 20 res | direction 4.5 | 0.25 | phys 58/84/110/136/162 (0.7bonusAd); true 10/15/20/25/30 (0.035targetMaxHp) | - | area, damage, if | - |
| a2 | Heat Shimmer | 12/11/10/9/8 | 25 res | direction 5 | 0 | - | - | dash, status, zone | slow |
| a3 | Vent | 12/11/10/9/8 | 0 none | self - | 0 | phys 60/90/120/150/180 (0.5bonusAd) | - | area, buff, damage, displace, resource | - |
| ult | Held Focus | 100/85/70 | 30 res | unit 6 | 0.25 | true 24/38/52 (0.15bonusAd) | - | buff, damage, zone | - |

Text:
- passive: When Kemdo takes part in an enemy fighter's takedown, all her Heat vents at once. It does not shorten an overheat already under way.
- a1: Kemdo thrusts along a 4.5 m line, dealing {effects.0.onHit.0.amount} physical damage. Slowed enemies also take {effects.0.onHit.1.then.0.amount} damage that ignores armor and resist (half against monsters).
- a2: Kemdo dashes 5 m and leaves a heat shimmer along her path for 2 s that slows enemies inside by 25%.
- a3: Kemdo releases 50 Heat in a 3 m blast: enemies take {effects.1.onHit.0.amount} physical damage and are knocked back 1 m, and she gains {effects.2.statScaling.armor} armor and magic resist for 1.5 s. Vent costs no Heat and can be cast while overheated.
- ult: Kemdo focuses the stopped sun on an enemy fighter within 6 m for 3 s. A 2 m spot follows them and deals {effects.0.onTick.0.amount} damage that ignores armor and resist every 0.5 s to every enemy in it, and Kemdo gains {effects.1.stats.omnivamp} Drain for the duration.

## Lisvel (lisvel) - Morning archer
role shaftlight / lampglass, class class_slinger, resource res_light, difficulty 1, tags aubade, ranged, marksman, haste, pierce, range

Base: hp 595 (+94), res 20, ad 61, armor 26, mr 30, AS 0.68, MS 3.35, auto range 5.9, phys, windup 0.21

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Reach of Morning | - | - | triggers: abilityHit | - | - | - | - | - |
| a1 | Dawn Line | 11/10.5/10/9.5/9 | 55/60/65/70/75 res | direction 10 | 0.25 | phys 55/85/115/145/175 (0.7bonusAd) | - | damage, projectile, status, zone | haste, slow |
| a2 | Backstep | 10/9.5/9/8.5/8 | 30/32/34/36/38 res | direction 3 | 0.1 | - | - | buff, dash, status | slow |
| a3 | Morning Draw | 16/15/14/13/12 | 40/42/44/46/48 res | self - | 0 | - | - | buff | - |
| ult | Sun Corridor | 100/85/70 | 100 res | direction 14 | 0.35 | phys 130/220/310 (0.9bonusAd) | - | area, buff, damage, status, zone | haste, slow |

Text:
- passive: Each ability that hits an enemy fighter adds 0.4 m to Lisvel's attack range for 5 s, up to 3 times (once per 1.5 s from each enemy).
- a1: Lisvel looses an arrow up to 10 m that passes through every enemy on its path, dealing {effects.2.onHit.0.amount} physical damage to each. The path stays lit for 3 s: allies on it, Lisvel included, move {effects.0.onTick.0.power} faster, and enemies crossing it are slowed by 15%.
- a2: Lisvel hops 3 m away from the cursor. Her next attack within 3 s reaches 2 m farther and slows the target by 25% for 1.5 s.
- a3: Lisvel draws faster, gaining 30/35/40/45/50% attack speed for 4 s.
- ult: After 0.75 s a 14 m by 3 m shaft of light lands, dealing {effects.0.onHit.0.amount} physical damage and slowing enemies by 40%. It stays for 5 s: allies inside move 30% faster, and Lisvel gains 20% attack speed while she stands in it.

## Marund (marund) - Dome mason
role lampglass / shadehold, class class_plinth, resource res_light, difficulty 1, tags serenade, melee, frontline, protector, zone, displacement, shield

Base: hp 680 (+110), res 40, ad 58, armor 36, mr 32, AS 0.64, MS 3.35, auto range 1.9, phys, windup 0.25

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Hearthside | - | - | triggers: interval | - | - | - | - | - |
| a1 | Shoulder In | 12/11.5/11/10.5/10 | 50/55/60/65/70 res | direction 4.5 | 0.15 | magic 70/105/140/175/210 (0.5ap+0.02bonusHp) | - | consumeMark, damage, dash, displace, if, status | root, slow |
| a2 | Shelter Dome | 16/15/14/13/12 | 70/75/80/85/90 res | self - | 0.25 | - | - | area, buff, displace, zone | - |
| a3 | Mortar Pail | 9/8.5/8/7.5/7 | 55/60/65/70/75 res | point 8 | 0.25 | magic 60/95/130/165/200 (0.6ap) | - | area, damage, mark, status | slow |
| ult | Domefall | 100/85/70 | 100 res | point 7 | 0.3 | magic 150/250/350 (0.7ap) | shield 80/130/180 (0.08maxHp) | area, damage, dash, displace, shield, status | stun |

Text:
- passive: Allied fighters within 5 m of Marund, himself included, regenerate 0.4% of Marund's max Health every second.
- a1: Marund charges up to 4.5 m and stops at the first enemy, dealing {effects.0.onPass.0.amount} magic damage and knocking them back 2 m. The target is slowed by 30% for 1.5 s, or rooted for 1.25 s instead if it is Mortared (this spends the Mortar).
- a2: Marund raises a 3 m dome around himself for {effects.1.duration}. Enemies inside are pushed 2.5 m away from him, and no enemy can walk in while it stands; allies come and go freely. Allied fighters inside, Marund included, gain {effects.1.onTick.0.statScaling.armor} armor and magic resist.
- a3: Marund lobs wet mortar up to 8 m. After 0.5 s, enemies within 2 m take {effects.0.onHit.0.amount} magic damage, are slowed by 35% for 1.5 s and are Mortared for 4 s. Shoulder In roots a Mortared enemy.
- ult: Marund leaps up to 7 m, unstoppable. Where he lands, enemies within 3.5 m take {effects.0.onArrive.0.onHit.0.amount} magic damage, are flung 2.5 m outward and are stunned for 1 s, and allied fighters there, Marund included, gain a {effects.0.onArrive.1.onHit.0.amount} shield for 3 s.

## Nurrow (nurrow) - Lull singer
role grovehunter / dialcross, class class_striker, resource res_tally, difficulty 3, tags serenade, melee, assassin, sleep, isolation, tally

Base: hp 610 (+99), res -, ad 62, armor 29, mr 30, AS 0.67, MS 3.55, auto range 1.7, phys, windup 0.25

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Quiet Kill | - | - | triggers: takedown | - | - | - | - | - |
| a1 | Felt Step | 9.5/9/8.5/8/7.5 | 0 res | point 4 | 0.1 | magic 70/105/140/175/210 (0.5ap+0.4bonusAd) | - | damage, dash, if | - |
| a2 | Lullaby Dart | 12/11.5/11/10.5/10 | 0 res | direction 8 | 0.25 | - | - | projectile, status | sleep |
| a3 | Snuff | 9/8.5/8/7.5/7 | 35 res | unit 2 | 0.15 | magic 85/120/155/190/225 (0.6ap+0.3bonusAd) | - | cooldown, damage, if, status | silence |
| ult | Lull the Rest | 110/95/80 | 0 res | unit 6 | 0.25 | magic 170/270/370 (0.7ap+0.5bonusAd) | - | area, damage, dash, if, mark, status | sleep |

Text:
- passive: When Nurrow gets a takedown, every enemy fighter within 5 m of her falls asleep for 1 s. Damage wakes a sleeper.
- a1: Nurrow lunges up to 4 m toward a point and stops at the first enemy fighter she reaches, dealing {effects.0.onPass.0.then.0.amount} magic damage. Felt soles: a sleeping enemy takes no damage and stays asleep.
- a2: Nurrow throws a dart up to 8 m. The first enemy fighter it hits falls asleep for {effects.0.onHit.0.duration}. The dart deals no damage, and damage wakes the sleeper. Felt Step does not wake them; Snuff on a sleeper silences longer and comes back sooner.
- a3: Nurrow snuffs an adjacent enemy for {effects.1.amount} magic damage and silences them for {effects.2.duration}. Snuffing a sleeper deals no extra damage: the silence runs {effects.0.then.1.duration} instead and 70% of the cooldown comes back.
- ult: Nurrow names an enemy fighter within 6 m and lunges at them for {effects.1.onArrive.0.amount} magic damage. Every other enemy fighter within 5 m of that target falls asleep for 2 s.

## Odrum (odrum) - Amber setter
role shaftlight / shadehold, class class_slinger, resource res_light, difficulty 2, tags serenade, ranged, marksman, zone, root, shred

Base: hp 600 (+96), res 20, ad 60, armor 27, mr 30, AS 0.66, MS 3.35, auto range 5.6, phys, windup 0.23

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Cracked Amber | - | - | triggers: statusApplied | - | - | - | - | - |
| a1 | Resin Shot | 11/10.5/10/9.5/9 | 60/65/70/75/80 res | point 9 | 0.25 | phys 70/110/150/190/230 (0.7bonusAd) | - | area, damage, status, zone | root, slow |
| a2 | Swing Out | 9/8.5/8/7.5/7 | 50 res | self - | 0.2 | phys 60/90/120/150/180 (0.6bonusAd) | - | area, damage, status | haste, slow |
| a3 | Step and Load | 12/11/10/9/8 | 40 res | direction 3.5 | 0 | phys 30/50/70/90/110 (0.4bonusAd) | - | buff, damage, dash, status | slow |
| ult | Amber Hour | 110/95/80 | 100 res | point 12 | 0.35 | phys 200/325/450 (0.9bonusAd) | - | area, damage, status, zone | root, slow |

Text:
- passive: When Odrum roots an enemy, or slows one that is already rooted, the amber cracks: they lose {triggers.0.effects.0.power} armor and {triggers.0.effects.1.power} magic resist for 2.5 s (once per 2 s per enemy).
- a1: Odrum lobs resin up to 9 m. It lands after 0.5 s as a 2.5 m pool that slows enemies by 35%. After 1.5 s it sets: enemies still inside take {effects.0.onExpire.0.onHit.0.amount} physical damage and are rooted for 1 s.
- a2: Odrum whirls the sling: enemies within 3 m take {effects.0.onHit.0.amount} physical damage and are slowed by 30% for 1.5 s, and he gains 25% move speed for 1.5 s.
- a3: Odrum hops up to 3.5 m. His next basic attack within 3 s carries a resin pellet: {effects.1.empowerAttacks.effects.0.amount} bonus physical damage and a 25% slow for 1.5 s.
- ult: Odrum hurls a great ball of resin up to 12 m. It lands after 0.75 s as a 5 m pool that slows enemies by 45%. After 2 s it sets: everyone still inside takes {effects.0.onExpire.0.onHit.0.amount} physical damage and is rooted for 1.5 s, so the whole group cracks.

## Rishal (rishal) - Glass runner
role dialcross / grovehunter, class class_striker, resource res_heat, difficulty 3, tags aubade, melee, assassin, mobility, heat, marks

Base: hp 590 (+96), res -, ad 62, armor 28, mr 30, AS 0.68, MS 3.55, auto range 1.7, phys, windup 0.25

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Split Glass | - | - | triggers: attackHit | - | - | - | - | - |
| a1 | Glass Dash | 0.5 | 15 res | direction 5 | 0 | phys 45/70/95/120/145 (0.5bonusAd) | - | damage, dash, mark, zone | - |
| a2 | Glint Cut | 7/6.5/6/5.5/5 | 25 res | unit 2 | 0.15 | phys 40/60/80/100/120 (0.55bonusAd) | - | damage, if, repeat, status | slow |
| a3 | Feint | 14/13/12/11/10 | 20 res | direction 4 | 0 | phys 45/70/95/120/145 (0.5bonusAd) | - | damage, dash, mark, zone | - |
| ult | Long Glint | 100/85/70 | 30 res | direction 9 | 0.2 | phys 150/250/350 (1bonusAd) | - | damage, dash, mark, status, zone | slow |

Text:
- passive: Enemies who cross Rishal's glass tracks are Cut (up to 3, for 5 s). His next basic attack on a Cut enemy spends every Cut: each deals {triggers.0.effects.0.perStack.0.amount} bonus physical damage and vents 8 Heat.
- a1: Rishal dashes 5 m and leaves a glass track on the ground behind him for 3 s. Enemies on the track when it forms, and enemies who step onto it later, take {effects.0.onEnter.0.amount} physical damage and are Cut. Holds 2 charges.
- a2: Rishal slashes an adjacent enemy twice, {effects.0.effects.0.amount} physical damage each. A Cut target is also slowed by 60%, fading over 1 s.
- a3: Rishal springs 4 m in the opposite direction to his aim, then lays a glass track over the ground he covered: enemies on it, or who step onto it within 3 s, take {effects.0.onArrive.0.onEnter.0.amount} physical damage and are Cut.
- ult: Rishal rushes 9 m, unstoppable. Every enemy he passes takes {effects.1.onPass.0.amount} physical damage, gains 3 Cuts and is slowed by 50% for 1 s. The whole line stays a glass track for 4 s that Cuts enemies who step onto it.

## Sukri (sukri) - Rim wanderer
role lampglass / None, class class_tender, resource res_light, difficulty 2, tags hourless, ranged, support, shield, pull, root

Base: hp 565 (+92), res 100, ad 52, armor 27, mr 30, AS 0.63, MS 3.4, auto range 5, magic, windup 0.23

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Spare Hour | - | - | triggers: lowHp | - | - | - | - | - |
| a1 | Mote Toss | 7/6.5/6/5.5/5 | 50/55/60/65/70 res | point 8 | 0.25 | magic 50/75/100/125/150 (0.5ap) | heal 50/80/110/140/170 (0.5ap) | area, damage, heal | - |
| a2 | Draw Near | 12/11.5/11/10.5/10 | 60/65/70/75/80 res | unit 7 | 0.15 | - | shield 60/90/120/150/180 (0.5ap) | displace, if, shield | - |
| a3 | Wrap Cast | 14/13/12/11/10 | 60/65/70/75/80 res | direction 8 | 0.25 | magic 45/70/95/120/145 (0.45ap) | - | damage, projectile, status | root |
| ult | Gather In | 120/100/80 | 100 res | self - | 0.4 | - | shield 90/140/190 (0.5ap) | area, displace, if, shield, status, zone | slow |

Text:
- passive: Once every 90 s, when Sukri drops below 30% health, he and allied fighters within 6 m cannot be targeted for 1 s.
- a1: Sukri tosses a mote up to 8 m. After 0.5 s, allies within 2.5 m are healed for {effects.0.onHit.0.amount} and enemies take {effects.1.onHit.0.amount} magic damage.
- a2: Sukri draws an allied fighter within 7 m up to 5 m toward him and shields them for {effects.1.amount} for 2 s. Cast on himself, it only shields. The pull knocks the ally airborne for 0.25 s, which interrupts a cast in progress.
- a3: Sukri throws a weighted wrap up to 8 m. The first enemy fighter it hits takes {effects.0.onHit.0.amount} magic damage and is rooted for {effects.0.onHit.1.duration}.
- ult: Every allied fighter within 10 m is drawn up to 4 m toward Sukri and shielded for {effects.0.onHit.1.amount} for 4 s. A 4 m ring of dust then slows enemies around him by 30% for 2 s. The pull knocks allies airborne for 0.25 s.

## Tunlan (tunlan) - Shadow puppeteer
role dialcross / shaftlight, class class_caster, resource res_heat, difficulty 2, tags serenade, ranged, mage, fear, heat, control

Base: hp 575 (+93), res -, ad 53, armor 26, mr 30, AS 0.64, MS 3.35, auto range 5.2, magic, windup 0.24

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Startle | - | - | triggers: abilityHit | - | - | - | - | - |
| a1 | Hound Shadow | 9/8.5/8/7.5/7 | 20 res | direction 9 | 0.3 | magic 70/105/140/175/210 (0.6ap) | - | damage, projectile, status | fear |
| a2 | Hand Shadow | 11/10.5/10/9.5/9 | 25 res | unit 7 | 0.25 | magic 80/115/150/185/220 (0.6ap) | - | damage, if, status | slow, stun |
| a3 | Lamp Flare | 13/12/11/10/9 | 20 res | self - | 0.15 | - | - | area, displace, status | slow |
| ult | Shadow Play | 110/95/80 | 30 res | direction 9 | 0.3 | magic 175/275/375 (0.8ap) | - | area, damage, status | fear |

Text:
- passive: The first time each 8 s that Tunlan hits an enemy fighter with an ability, they are slowed by 40% for 1 s.
- a1: A shadow hound runs 9 m along the ground, dealing {effects.0.onHit.0.amount} magic damage to every enemy it touches and sending them running in fear for {effects.0.onHit.1.duration}.
- a2: A shadow hand grips an enemy within 7 m for {effects.0.amount} magic damage and a 60% slow that fades over 1.5 s. A feared enemy is stunned for {effects.1.then.0.duration} instead of slowed.
- a3: Tunlan flares her lamp: enemies within 3 m are pushed back 1.5 m and slowed by 30% for {effects.0.onHit.1.duration}.
- ult: After 0.6 s an enormous shadow beast fills a 9 m, 50° cone, dealing {effects.0.onHit.0.amount} magic damage and sending enemies running in fear for {effects.0.onHit.1.duration}.

## Ulkro (ulkro) - Dart hunter
role shaftlight / grovehunter, class class_slinger, resource res_tally, difficulty 3, tags hourless, ranged, marksman, mobility, run_up, tally

Base: hp 600 (+95), res -, ad 60, armor 27, mr 30, AS 0.67, MS 3.5, auto range 5.4, phys, windup 0.21

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Run-up | - | - | triggers: moveDistance, moveDistance | - | - | - | - | - |
| a1 | Hurl | 8/7.5/7/6.5/6 | 0 res | direction 10 | 0.3 | phys 55/85/115/145/175 (0.7bonusAd); phys 55/85/115/145/175 (0.7bonusAd+{'counter': 'ulkro_runup', 'per': 0.25}perCounter) | - | counter, damage, projectile | - |
| a2 | Bound | 11/10.5/10/9.5/9 | 0 res | point 4 | 0.1 | - | - | counter, dash | - |
| a3 | Hamstring Dart | 12/11.5/11/10.5/10 | 35 res | unit 6 | 0.2 | phys 40/55/70/85/100 (0.4bonusAd) | - | damage, reveal, status | slow |
| ult | Long Run | 90/80/70 | 40 res | self - | 0.2 | - | - | area, form | - |

Text:
- passive: Every 4 m Ulkro runs adds a Run-up stack, up to 4; stacks fade 8 s after the last one. While Long Run is active, every 3 m she runs also sends a dart at the nearest enemy fighter within 7 m for {triggers.1.effects.0.onHit.0.onHit.0.amount} physical damage.
- a1: Ulkro throws a long dart up to 10 m. The first enemy it hits takes {effects.0.onHit.0.amount} physical damage, plus 25% more for every Run-up stack she holds. The throw spends all her stacks.
- a2: Ulkro leaps up to 4 m and gains 2 Run-up stacks.
- a3: Ulkro darts an enemy within 6 m for {effects.0.amount} physical damage. They are slowed by 40% for {effects.1.duration} and revealed for 4 s.
- ult: For {effects.1.duration} Ulkro runs 35% faster, and every 3 m she runs a dart flies at the nearest enemy fighter within 7 m. The darts grow with her level and Attack.

## Vashil (vashil) - Bell ringer
role dialcross / shaftlight, class class_caster, resource res_light, difficulty 1, tags aubade, ranged, mage, stun, hum, zone

Base: hp 570 (+92), res 80, ad 53, armor 26, mr 30, AS 0.64, MS 3.35, auto range 5.3, magic, windup 0.24

| slot | name | cd (r1-5) | cost | targeting / range | cast | damage | heal/shield | ops | statuses |
|---|---|---|---|---|---|---|---|---|---|
| passive | Hum | - | - | triggers: abilityHit, abilityHit, abilityHit | - | - | - | - | - |
| a1 | Peal | 9/8.5/8/7.5/7 | 55/60/65/70/75 res | point 9 | 0.2 | magic 60/95/130/165/200 (0.6ap) | - | area, damage, status | slow |
| a2 | Glass Chime | 7/6.5/6/5.5/5 | 40/42/44/46/48 res | direction 9 | 0.2 | magic 60/90/120/150/180 (0.55ap) | - | damage, projectile | - |
| a3 | Ring Out | 10/9.5/9/8.5/8 | 45/50/55/60/65 res | direction 3.5 | 0.2 | magic 50/80/110/140/170 (0.5ap) | - | area, damage, displace | - |
| ult | Morning Toll | 100/85/70 | 100 res | point 9 | 0.3 | magic 90/140/190 (0.45ap) | - | area, damage, repeat | - |

Text:
- passive: Vashil's abilities leave an enemy fighter humming for 3 s. When an ability strikes a humming enemy while another humming enemy stands within 3.5 m of it, the two notes chord: every humming enemy within 3.5 m of the struck one is stunned for 1 s and stops humming, and cannot hum again for 8 s. A lone humming enemy struck again is slowed by 35% for 1.25 s and keeps humming.
- a1: After 0.4 s a ring of sound lands at a point up to 9 m away. Enemies between 1.5 m and 3.5 m from its center take {effects.0.onHit.0.amount} magic damage and are slowed by 30% for 1.5 s; the center stays quiet.
- a2: Vashil strikes a fast chime-bolt that flies up to 9 m and deals {effects.0.onHit.0.amount} magic damage to the first enemy it hits.
- a3: Vashil swings the rod: enemies in a 3.5 m, 90° cone take {effects.0.onHit.0.amount} magic damage and are pushed back 2 m.
- ult: Vashil tolls a great bell over a 4.5 m area up to 9 m away, three times, 0.75 s apart. Each toll deals {effects.0.effects.0.onHit.0.amount} magic damage and hums everyone it strikes, so two enemies caught together chord on the second toll.

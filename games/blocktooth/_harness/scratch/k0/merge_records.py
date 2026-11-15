import sys


def edit(p, pairs):
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print('MISMATCH', p, n, repr(old[:90]))
            sys.exit(1)
        s = s.replace(old, new)
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('ok', p)


edit('src/data/perks.ts', [(
    """  perk_tip_line: { id: 'perk_tip_line', name: 'ADVANCE TIP-LINE', desc: '+1 OVERLOAD SITE active; objective arrows reach twice as far', card: null },
};""",
    """  perk_tip_line: { id: 'perk_tip_line', name: 'ADVANCE TIP-LINE', desc: '+1 OVERLOAD SITE active; objective arrows reach twice as far', card: null },
  // GATEKEEPERS §6.5 (K0 Record completion; not in PERK_IDS until lane K2c adds its goal WITHOUT A DENT).
  // Applied by bosses/index.ts spawnGate (meter 0.25), never by applyPerk.
  perk_deferred_maintenance: { id: 'perk_deferred_maintenance', name: 'DEFERRED MAINTENANCE', desc: 'Every gatekeeper arrives with its meter at 25 %', card: null },
};""")])

edit('src/meta/tally.ts', [(
    """    hookT: -1, hookPickups: 0, hookKills: 0,
    peakRank: 0, blocks: 0,
  };""",
    """    hookT: -1, hookPickups: 0, hookKills: 0,
    // GATEKEEPERS §7.2 RunTallyAddV3 (K0: initialisation only; lane K1a adds the event cases, §6.5)
    gateKills: 0, gateCleanKills: 0, gateTotalFightS: Infinity, gateTippedFastS: Infinity, gateStallsBestFight: 0,
    gateSwitchFastS: Infinity, gateRematches: 0, gateStaggersThisFight: 0, gateFightDmg: 0,
    peakRank: 0, blocks: 0,
  };""")])

edit('src/render/hazardview.ts', [
    ("""  oil: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {""",
     """  // GATEKEEPERS (K0 Record completion): WET PAINT placeholder — a flat safety-yellow road-marking coat with a
  // wet sheen. Not in HKINDS yet (no material is built, so no program / draw call is added); lane K2a owns
  // the real look and registers the kind.
  paint: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float n = vnoise(L / (R * 0.4) + seed * 11.0);
  float e = sd + (n - 0.5) * R * 0.12;
  float inside = 1.0 - smoothstep(-aa, aa, e);
  if (inside <= 0.001) return vec4(0.0);
  float sheen = smoothstep(0.6, 0.95, vnoise(L / (R * 0.25) + vec2(t * 0.1, 0.0)));
  vec3 col = mix(lin(vec3(1.0, 0.82, 0.4)), vec3(1.0), 0.25 * sheen);
  return vec4(col, 0.85 * inside);
}`,
  oil: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {"""),
    ("""        case 'oil': break;
      }""", """        case 'oil': break;
        case 'paint': break;   // GATEKEEPERS: decal only (lane K2a)
      }"""),
])

edit('src/render/projectileview.ts', [(
    """  spark:      { len: 0.7, minPx: 9, rMul: 1.2, halo: '#9ff6ff', haloK: 1.3, haloA: 0.5, streak: '#dffcff', streakK: 5, streakW: 0.18, streakA: 0.75, puff: 0, orient: 'tumble' },
};""",
    """  spark:      { len: 0.7, minPx: 9, rMul: 1.2, halo: '#9ff6ff', haloK: 1.3, haloA: 0.5, streak: '#dffcff', streakK: 5, streakW: 0.18, streakA: 0.75, puff: 0, orient: 'tumble' },
  // GATEKEEPERS (K0 Record completion, placeholders): no mesh is built for these until lane K2a registers the
  // kinds (drawOne skips a kind without a mesh). Lengths are the rigs' home scale (× H of the held Size).
  paintCan:   { len: 0.5, minPx: 12, rMul: 0, halo: null, haloK: 0, haloA: 0, streak: null, streakK: 0, streakW: 0, streakA: 0, puff: 0, orient: 'tumble' },
  sawhorse:   { len: 4.4, minPx: 18, rMul: 0, halo: null, haloK: 0, haloA: 0, streak: null, streakK: 0, streakW: 0, streakA: 0, puff: 0, orient: 'tumble' },
  callFlare:  { len: 1.2, minPx: 12, rMul: 0, halo: '#ff6f5e', haloK: 0.9, haloA: 0.5, streak: '#ffb347', streakK: 3, streakW: 0.3, streakA: 0.6, puff: 2, orient: 'vel' },
};""")])

edit('src/ui/goals.ts', [(
    """  tier4CollapseFrac: 'wreck', bossKillsLife: 'bullseye', staggersBestFight: 'ripple', boats: 'ripple', fastClearS: 'rush',
};""",
    """  tier4CollapseFrac: 'wreck', bossKillsLife: 'bullseye', staggersBestFight: 'ripple', boats: 'ripple', fastClearS: 'rush',
  // GATEKEEPERS §6.5 (K0 Record completion; lane K2c adds the goals)
  gateTippedFastS: 'gatekeeper', gateStallsBestFight: 'gatekeeper', gateSwitchFastS: 'gatekeeper', gateCleanKills: 'gatekeeper',
  gateTotalFightS: 'gatekeeper', gateRematchesLife: 'gatekeeper',
};""")])

edit('src/v2types.ts', [
    ("""  | 'ribbon' | 'swatch' | 'key' | 'till';
export type MarkerKind = 'overloadSite' | 'reliefDepot' | 'recordsAnnex' | 'powerup' | 'till';""",
     """  | 'ribbon' | 'swatch' | 'key' | 'till'
  | 'gatekeeper';   // GATEKEEPERS §7.2: a hazard-striped sawhorse (K0 placeholder glyph; lane K2b draws the final one)
export type MarkerKind = 'overloadSite' | 'reliefDepot' | 'recordsAnnex' | 'powerup' | 'till'
  | 'gate' | 'weakPoint';   // GATEKEEPERS §7.2: an arriving / off-screen gatekeeper; an exposed weak point (lane K2b)"""),
    ("""export interface TabloidExtra {
  newGoals: { goal: string; unlock: string }[];     // "NEW ON THE RECORD" sidebar (names, already resolved)
  canContinue: boolean;                             // clear variant only: show KEEP GOING
}""", """export interface TabloidExtra {
  newGoals: { goal: string; unlock: string }[];     // "NEW ON THE RECORD" sidebar (names, already resolved)
  canContinue: boolean;                             // clear variant only: show KEEP GOING
  /** GATEKEEPERS §7.2 (TabloidExtraAddV3): the gatekeeper that held the titan when it died (its name), else null.
   *  The dead front page's sub-head `HELD AT SIZE II BY CORDON-2` (lane K2b, ui/broadcast.ts). */
  heldBy: string | null;
}
/** GATEKEEPERS §7.2 (CiviliansAddV3): render/civilians.ts gains surge() in lane K2a; game.ts calls it only when present. */
export interface CiviliansAddV3 { surge(x: number, z: number, radius: number, count: number): void }"""),
])

edit('src/ui/icons.ts', [
    ("""// ─────────────────────────────── the glyph set (58) ───────────────────────────────""",
     """// ─────────────────────────────── the glyph set (59) ───────────────────────────────"""),
    ("""  till: [rect(5, 2.5, 14, 12.5) + ' ' + rect(1.8, 15, 15.2, 6),
    rect(10, 5.2, 4, 1.4) + ' ' + rect(7.8, 8.6, 8.4, 3.4) + ' ' + rect(4, 17.1, 6, 1.6)],
};""",
     """  till: [rect(5, 2.5, 14, 12.5) + ' ' + rect(1.8, 15, 15.2, 6),
    rect(10, 5.2, 4, 1.4) + ' ' + rect(7.8, 8.6, 8.4, 3.4) + ' ' + rect(4, 17.1, 6, 1.6)],
  // GATEKEEPERS (K0 placeholder; lane K2b owns the final drawing): a sawhorse — a striped rail on two A-frames
  gatekeeper: [rect(2, 5, 20, 4.5) + ' ' + poly([4.2, 9.5, 6.4, 9.5, 4.4, 21, 2.2, 21]) + ' ' + poly([7.6, 9.5, 9.8, 9.5, 11.2, 21, 9, 21])
    + ' ' + poly([14.2, 9.5, 16.4, 9.5, 15, 21, 12.8, 21]) + ' ' + poly([17.6, 9.5, 19.8, 9.5, 21.8, 21, 19.6, 21]),
    poly([4.5, 5.5, 7.5, 5.5, 5.5, 9, 2.5, 9]) + ' ' + poly([10.5, 5.5, 13.5, 5.5, 11.5, 9, 8.5, 9]) + ' ' + poly([16.5, 5.5, 19.5, 5.5, 17.5, 9, 14.5, 9])],
};"""),
])

edit('_harness/probe_icons.ts', [
    ("""  'key', 'till',
];
ok(EXPECTED.length === 58, `expected list has 58 ids (${EXPECTED.length})`);
ok(GLYPH_IDS.length === 58, `GLYPHS has 58 ids (${GLYPH_IDS.length})`);""",
     """  'key', 'till',
  'gatekeeper',   // GATEKEEPERS §7.2 (K0: GlyphId grew by one; lane K2b draws the final glyph)
];
ok(EXPECTED.length === 59, `expected list has 59 ids (${EXPECTED.length})`);
ok(GLYPH_IDS.length === 59, `GLYPHS has 59 ids (${GLYPH_IDS.length})`);"""),
])

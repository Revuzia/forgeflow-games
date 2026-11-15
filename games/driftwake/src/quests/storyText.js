/**
 * STORY TEXT — every word the meaning layer shows (_spec/QUEST_DESIGN.md).
 *
 * PURE DATA. No imports, no game logic, nothing on a frame path. The only
 * code in this file is the one-time deep freeze at the bottom, so no consumer
 * can mutate a shared string table by accident.
 *
 * VOICE (QUEST_DESIGN §1). The Echo is the remnant voice of the first
 * Wakecaster, living in the shrines. It speaks one to three short lines, never
 * more: spare, warm, a little sad, no exposition dumps, no modern slang.
 *
 * THE STORY UNDER THE LINES (so every lane writes toward the same truth):
 *   - One world, bound by anchor-stones, seven to a land. The first Wakecaster
 *     set them and carved the roads between the lands (Cold lore).
 *   - Six Wardens, two per land, were chosen to keep the anchors lit. They
 *     were guardians. When the world broke they held on alone, and the Drift
 *     whispered that letting go would be a mercy (Sand lore).
 *   - The Ash smiths built the Furnace to be one heart for every land. The
 *     first Wakecaster carved the wake that fed it every anchor's light. It
 *     cracked, and the world cracked with it. Some of that light became the
 *     Echo, so mending the Drift means giving it back, and the Echo ends (Ash
 *     lore, the ending).
 *
 * SECTIONS AND IDS. Every entry that can be persisted, emitted or looked up
 * carries a stable string `id`, unique across the whole object:
 *   intro                 'intro'                  3 lines (QUEST §6.1)
 *   steps[stepId]         'cold.1' .. 'ash.6'      title (<= 40), tracker (<= 60)
 *   stepOrder[realm]      step ids in chain order
 *   echo['echo.<step>']   'echo.cold.1' ..         lines spoken when that step
 *                                                  COMPLETES. echo.cold.1 is
 *                                                  exactly 2 lines (QUEST §6.3).
 *                                                  echo.ash.6 is the SAME frozen
 *                                                  array as ending.echo: the
 *                                                  ending is that step's beat,
 *                                                  so play it once.
 *   shrines[realm][shrineId]  'shrine.<realm>.<shrineId>'  name + ONE line,
 *                         spoken on the shrine's first activation in that realm.
 *                         Keys are world/shrine.js SHRINE_IDS, which are shared
 *                         by all three realms: shrines.sand.cold_spawn IS the
 *                         Sand spawn shrine.
 *   lore[realm][i]        'lore.<realm>.<1..12>'   12 per realm, in escalation
 *                                                  order; voice 'echo' or
 *                                                  'inscription'; 1-3 lines
 *   chronicle[realm]      'chronicle.<realm>'      the all-12 reward page
 *   bounties[realm][i]    'bounty.<realm>.<1..3>'  unit = combatData ENEMIES key;
 *                                                  index 2 is the relic bounty
 *   trials[realm][i]      'trial.<realm>.<1..3>'   landmark = world/landmarks.js
 *                                                  LANDMARK_TYPES key the name
 *                                                  refers to; index 2 is the
 *                                                  relic (gold) trial
 *   relics[id]            'relic.<name>'           effect = QUEST §4.2 verbatim
 *   boons[id]             'boon.<name>'            effect = QUEST §4.1 verbatim;
 *                                                  keyed by realm + kind
 *                                                  ('mini'|'realm', the
 *                                                  'boss:killed' kind) + pick
 *   boonPairs['<realm>.<kind>']   [boonIdA, boonIdB]
 *   shop[id], trails[id], driftmarks, hints[id], trackers[id], ui, ending
 *
 * TEMPLATES. A few strings carry {tokens} for the consumer to fill:
 *   trackers.underLevel   {level}       trackers.bountyLastSeen  {place}
 *   ui.toasts.*           {title} {medal} {amount} {name}
 *   ui.side.*             {found} {total}
 *
 * TWO THINGS A CONSUMER MUST KNOW (see the lane report):
 *   1. QUEST §2's first draft was headed "18 steps, 6 per realm" but its own
 *      table gives Cold 8 steps (3 onboarding + 5). This file follows the
 *      table, 8 + 6 + 6 = 20, and §2's heading now says so.
 *   2. THE SIX WARDENS ARE THE SIX LIVE BOSSES (orchestrator decision,
 *      2026-09-30). The first QUEST §2 draft named the Cold MINI boss "the
 *      Shrinebreaker" and the Cold REALM boss "the Moraine Elder"; the game
 *      spawns neither that way. The live roster (combat/roster.js bossKind
 *      rows, read by combat/bossEncounters.js BOSS_BY_REALM) is:
 *        cold  mini  The Icewall            realm  Shrinebreaker
 *        sand  mini  Gatekeeper of Brass    realm  Warden of the Sundered Gate
 *        ash   mini  Furnace Guardian       realm  Volcanic Plate Knight
 *      Step titles (cold.5 "Break the Icewall", cold.7 "The Shrinebreaker"),
 *      lore.sand.8/9 and QUEST_DESIGN.md §2 now name those six. There is no
 *      Moraine Elder in the game. Boons stay keyed by realm + kind, never
 *      bossKey, so a roster rename can never orphan a boon pair.
 */

/* ------------------------------------------------------------------ *
 * The ending's three lines — shared by ending.echo and echo['echo.ash.6']
 * ------------------------------------------------------------------ */

const ENDING_ECHO = [
    "Every anchor burns. I can feel the shards turning home.",
    "Now the light goes back where it belongs, and I go with it. Do not be sad.",
    "Thank you for listening, Wakecaster. Ride on, and let the world remember your wake.",
];

/* ------------------------------------------------------------------ *
 * STORY
 * ------------------------------------------------------------------ */

export const STORY = {

    /** QUEST §6.1 — the intro card over the key art, one sentence per line. */
    intro: {
        id: "intro",
        lines: [
            "The world broke, and what is left drifts apart as three shards: Cold, Sand, and Ash.",
            "The Wardens sworn to keep their anchor-shrines lit have turned, and they are tearing the anchors loose.",
            "You are the last Wakecaster, the last who can carve a wake between the shards and mend the Drift.",
        ],
    },

    /** QUEST §2 — the spine. Titles verbatim from the spec; trackers <= 60. */
    steps: {
        "cold.1": { id: "cold.1", realm: "cold", title: "The Last Wakecaster",
            tracker: "Touch the shrine." },
        "cold.2": { id: "cold.2", realm: "cold", title: "Carve Your Wake",
            tracker: "Hold RMB to surf. Carve 150 m of wake." },
        "cold.3": { id: "cold.3", realm: "cold", title: "Answer the Drift",
            tracker: "Defeat 5 creatures of the Drift." },
        "cold.4": { id: "cold.4", realm: "cold", title: "Kindle the Ring",
            tracker: "Awaken 3 of the 6 ring shrines." },
        "cold.5": { id: "cold.5", realm: "cold", title: "Break the Icewall",
            tracker: "Find its arena and break it." },
        "cold.6": { id: "cold.6", realm: "cold", title: "Wake the Anchors",
            tracker: "Awaken all 6 ring shrines." },
        "cold.7": { id: "cold.7", realm: "cold", title: "The Shrinebreaker",
            tracker: "Face the Warden of the Cold in its arena." },
        "cold.8": { id: "cold.8", realm: "cold", title: "Cross the Drift",
            tracker: "Step through the portal." },

        "sand.1": { id: "sand.1", realm: "sand", title: "Where the Sand Remembers",
            tracker: "Touch the first shrine of the Sand." },
        "sand.2": { id: "sand.2", realm: "sand", title: "Kindle the Ring",
            tracker: "Awaken 3 of the 6 ring shrines." },
        "sand.3": { id: "sand.3", realm: "sand", title: "The Gatekeeper of Brass",
            tracker: "Find the Gatekeeper's arena and break him." },
        "sand.4": { id: "sand.4", realm: "sand", title: "Wake the Anchors",
            tracker: "Awaken all 6 ring shrines." },
        "sand.5": { id: "sand.5", realm: "sand", title: "Warden of the Sundered Gate",
            tracker: "Face the Warden and his last command." },
        "sand.6": { id: "sand.6", realm: "sand", title: "Onward, Into Ash",
            tracker: "Step through the portal." },

        "ash.1": { id: "ash.1", realm: "ash", title: "The Burning Shard",
            tracker: "Touch the first shrine of the Ash." },
        "ash.2": { id: "ash.2", realm: "ash", title: "Kindle the Ring",
            tracker: "Awaken 3 of the 6 ring shrines." },
        "ash.3": { id: "ash.3", realm: "ash", title: "The Furnace Guardian",
            tracker: "Douse the Furnace Guardian's fire." },
        "ash.4": { id: "ash.4", realm: "ash", title: "Wake the Anchors",
            tracker: "Awaken all 6 ring shrines." },
        "ash.5": { id: "ash.5", realm: "ash", title: "The Volcanic Plate Knight",
            tracker: "Face the last Warden in his arena." },
        "ash.6": { id: "ash.6", realm: "ash", title: "Mend the Drift",
            tracker: "Pass through the portal. Touch the first shrine." },
    },

    /** Chain order per realm — the index is the save's `quest.main.<realm>`. */
    stepOrder: {
        cold: ["cold.1", "cold.2", "cold.3", "cold.4", "cold.5", "cold.6", "cold.7", "cold.8"],
        sand: ["sand.1", "sand.2", "sand.3", "sand.4", "sand.5", "sand.6"],
        ash: ["ash.1", "ash.2", "ash.3", "ash.4", "ash.5", "ash.6"],
    },

    /**
     * The Echo on every step's COMPLETION. Each line leads toward the next
     * step, so the dialogue box doubles as the "what now" the tracker shows.
     */
    echo: {
        "echo.cold.1": { id: "echo.cold.1", step: "cold.1", lines: [
            "You found me. I am the Echo, all that is left of the first Wakecaster.",
            "The shards are pulling apart. Ride, and let the snow remember what a wake is.",
        ] },
        "echo.cold.2": { id: "echo.cold.2", step: "cold.2", lines: [
            "There. The ground remembers you now.",
            "Listen. Something in the Drift heard it too.",
        ] },
        "echo.cold.3": { id: "echo.cold.3", step: "cold.3", lines: [
            "Only hungry things the Drift has made. There will be more.",
            "The anchors matter more. Wake the ring of stones around us.",
        ] },
        "echo.cold.4": { id: "echo.cold.4", step: "cold.4", lines: [
            "Three stones answer. The ring is waking.",
            "Something heavy stirs where the anchors fell. It knows you are here.",
        ] },
        "echo.cold.5": { id: "echo.cold.5", step: "cold.5", lines: [
            "I chose the Wardens, every one.",
            "I remember when this one was kind.",
        ] },
        "echo.cold.6": { id: "echo.cold.6", step: "cold.6", lines: [
            "All six anchors burn. The Cold holds, for now.",
            "Its greatest Warden will have felt that. It is waiting for you.",
        ] },
        "echo.cold.7": { id: "echo.cold.7", step: "cold.7", lines: [
            "The Warden of the Cold is broken, and a door opens where it fell.",
            "Go through. I will be waiting in the stones on the other side.",
        ] },
        "echo.cold.8": { id: "echo.cold.8", step: "cold.8", lines: [
            "Sand. I had forgotten how warm the world could be.",
            "Find the first stone. I am there too.",
        ] },

        "echo.sand.1": { id: "echo.sand.1", step: "sand.1", lines: [
            "The Sand remembers everything it buries. Even me.",
            "Wake the ring. The dunes are listening.",
        ] },
        "echo.sand.2": { id: "echo.sand.2", step: "sand.2", lines: [
            "The ring warms. Somewhere in the dunes, brass is stirring.",
        ] },
        "echo.sand.3": { id: "echo.sand.3", step: "sand.3", lines: [
            "He held that gate for a city that is only dust now.",
            "I think he was waiting for someone to tell him he could stop.",
        ] },
        "echo.sand.4": { id: "echo.sand.4", step: "sand.4", lines: [
            "Six anchors burn. The Warden of the Gate has felt it.",
            "He will meet you the old way, with his whole command.",
        ] },
        "echo.sand.5": { id: "echo.sand.5", step: "sand.5", lines: [
            "He closed the gate when the world split. His people were on the other side.",
            "Let him rest. The way to Ash is open.",
        ] },
        "echo.sand.6": { id: "echo.sand.6", step: "sand.6", lines: [
            "Ash. This is where it happened.",
            "Keep moving. The ground here is still angry.",
        ] },

        "echo.ash.1": { id: "echo.ash.1", step: "ash.1", lines: [
            "I have not stood on this shard since the day it broke.",
            "Wake the ring, and I will tell you what we did here.",
        ] },
        "echo.ash.2": { id: "echo.ash.2", step: "ash.2", lines: [
            "The ring answers, and the Furnace feels it.",
            "Its keeper has never once let the fire go out.",
        ] },
        "echo.ash.3": { id: "echo.ash.3", step: "ash.3", lines: [
            "The fire goes quiet. It kept that forge burning longer than anyone can remember.",
            "No one ever told it to stop. I should have.",
        ] },
        "echo.ash.4": { id: "echo.ash.4", step: "ash.4", lines: [
            "Every anchor burns. Only one Warden is left.",
            "He was the first I ever named. He will not yield.",
        ] },
        "echo.ash.5": { id: "echo.ash.5", step: "ash.5", lines: [
            "Rest, old friend. You held the plates together as long as anyone could.",
            "The last door is open. It leads home.",
        ] },
        /** The ending IS this step's beat — the same array as ending.echo. */
        "echo.ash.6": { id: "echo.ash.6", step: "ash.6", lines: ENDING_ECHO },
    },

    /**
     * QUEST §5 — one line on each shrine's first activation, 21 in all.
     * Cold wakes the Echo; Sand remembers the Wardens; Ash begins to spend it.
     * No line assumes an activation order.
     */
    shrines: {
        cold: {
            cold_spawn: { id: "shrine.cold.cold_spawn", name: "The First Stone",
                line: "Warm hands on cold stone. I had almost forgotten the feeling." },
            shrine_e: { id: "shrine.cold.shrine_e", name: "Rimefast Anchor",
                line: "Feel that? The shard leans back toward the others, just slightly." },
            shrine_ne: { id: "shrine.cold.shrine_ne", name: "Hoarlight Anchor",
                line: "I set this stone myself. My hands were younger then." },
            shrine_nw: { id: "shrine.cold.shrine_nw", name: "Palewind Anchor",
                line: "An anchor is only a stone that remembers where it belongs." },
            shrine_w: { id: "shrine.cold.shrine_w", name: "Deepdrift Anchor",
                line: "The Wardens tore at this one. They did not quite finish." },
            shrine_sw: { id: "shrine.cold.shrine_sw", name: "Sleetmoor Anchor",
                line: "Every stone you wake, I wake a little more with it." },
            shrine_se: { id: "shrine.cold.shrine_se", name: "Brightfrost Anchor",
                line: "The Cold is quieter now. Even the wind is listening." },
        },
        sand: {
            cold_spawn: { id: "shrine.sand.cold_spawn", name: "Gatefoot Stone",
                line: "Warm stone, even at the root. The Sand never lets go of the sun." },
            shrine_e: { id: "shrine.sand.shrine_e", name: "Brasswell Anchor",
                line: "The gate-watch lit this one every dusk. Their names are gone from the stone." },
            shrine_ne: { id: "shrine.sand.shrine_ne", name: "Sunward Anchor",
                line: "The Wardens swore their oaths with a hand on an anchor like this one." },
            shrine_nw: { id: "shrine.sand.shrine_nw", name: "Oathsand Anchor",
                line: "They were guardians once. Remember that, when you have to break them." },
            shrine_w: { id: "shrine.sand.shrine_w", name: "Dunewatch Anchor",
                line: "A Warden's mark, scratched deep. Even lost, they could not stop tending it." },
            shrine_sw: { id: "shrine.sand.shrine_sw", name: "Scarab Anchor",
                line: "Listen. Under the sand, the old road still runs toward the gate." },
            shrine_se: { id: "shrine.sand.shrine_se", name: "Longshadow Anchor",
                line: "Every anchor you light, a Warden somewhere feels it, and remembers." },
        },
        ash: {
            cold_spawn: { id: "shrine.ash.cold_spawn", name: "The Cinder Stone",
                line: "Still warm. This ground has not cooled since the day it cracked." },
            shrine_e: { id: "shrine.ash.shrine_e", name: "Emberfall Anchor",
                line: "Each anchor you wake here takes a little of my voice. Do not stop for that." },
            shrine_ne: { id: "shrine.ash.shrine_ne", name: "Slagreach Anchor",
                line: "Smell that? Slag and old smoke. The smiths worked here." },
            shrine_nw: { id: "shrine.ash.shrine_nw", name: "Cinderhold Anchor",
                line: "The Furnace still pulls at this stone. I can feel it drinking." },
            shrine_w: { id: "shrine.ash.shrine_w", name: "Blackglass Anchor",
                line: "I carved a road of light through this valley once. I wish I had not." },
            shrine_sw: { id: "shrine.ash.shrine_sw", name: "Ashen Anchor",
                line: "When the last anchor burns, I will go into the stones. Not yet." },
            shrine_se: { id: "shrine.ash.shrine_se", name: "Last Light Anchor",
                line: "Whatever happens at the end, Wakecaster, you did this well." },
        },
    },

    /**
     * QUEST §3.4 — 36 shards, 12 per realm, in escalation order. Cold: the
     * anchors and the first Wakecaster. Sand: the Wardens were guardians.
     * Ash: what broke the world, and what mending it will cost the Echo.
     */
    lore: {
        cold: [
            { id: "lore.cold.1", title: "One World", voice: "echo", lines: [
                "Once there was one world, not three.",
                "You could ride from the ice to the dunes before the sun went down.",
            ] },
            { id: "lore.cold.2", title: "The Anchor Verse", voice: "inscription", lines: [
                "Seven stones to a land, seven lights to hold it fast.",
                "Let none go dark while a Wakecaster lives.",
            ] },
            { id: "lore.cold.3", title: "What an Anchor Holds", voice: "echo", lines: [
                "An anchor does not hold a land down.",
                "It holds it close to the others, the way one hand holds another.",
            ] },
            { id: "lore.cold.4", title: "The First Wake", voice: "echo", lines: [
                "I was a child on a plank of river ice when the ground first answered me.",
                "The wake I carved that day is still under this snow.",
            ] },
            { id: "lore.cold.5", title: "Wake Glass", voice: "echo", lines: [
                "Carve a wake deep enough and the ground keeps it, as glass.",
                "We traded it, built with it, and wore it for luck.",
            ] },
            { id: "lore.cold.6", title: "The Wakecasters' Road", voice: "inscription", lines: [
                "Here rode the Wakecasters, who carved the roads between the lands.",
                "Follow their wake, traveller, and it will carry you home.",
            ] },
            { id: "lore.cold.7", title: "The Keel", voice: "echo", lines: [
                "My first board had a keel of river ice.",
                "I rode it until it was a sliver, and I kept the sliver.",
            ] },
            { id: "lore.cold.8", title: "Frost on the Stone", voice: "inscription", lines: [
                "When the anchor frosts over, the land is drifting.",
                "Light it, and ride for the next.",
            ] },
            { id: "lore.cold.9", title: "The Rime Shelf", voice: "echo", lines: [
                "The Rime Shelf was the first land I anchored.",
                "It was never the warmest. It was always home.",
            ] },
            { id: "lore.cold.10", title: "The Hush", voice: "echo", lines: [
                "The Drift began as a hush.",
                "One night every anchor dimmed at once, and by morning the Sand was further away.",
            ] },
            { id: "lore.cold.11", title: "The Wakecaster's Vow", voice: "inscription", lines: [
                "I carve so others may cross.",
                "I cross so none are left behind.",
            ] },
            { id: "lore.cold.12", title: "The Last Rider", voice: "echo", lines: [
                "There were hundreds of us once, and we rode out along the Drift to hold the lands together.",
                "None came back but me, and I did not come back whole.",
                "Now there is only you.",
            ] },
        ],
        sand: [
            { id: "lore.sand.1", title: "The Six Keepers", voice: "echo", lines: [
                "The anchors needed keepers who would never sleep.",
                "I chose six, two for every land, and every one of them said yes.",
            ] },
            { id: "lore.sand.2", title: "The Warden's Oath", voice: "inscription", lines: [
                "I will keep the light. I will keep the gate.",
                "I will keep watch until the world no longer needs me.",
            ] },
            { id: "lore.sand.3", title: "The Open Gate", voice: "echo", lines: [
                "This was a city built around a gate, and the gate stood open to every land.",
                "Traders rode in from the ice with Wake Glass in their packs.",
            ] },
            { id: "lore.sand.4", title: "Carved Above the Gate", voice: "inscription", lines: [
                "Here stands the Gatekeeper, clad in brass.",
                "He turns away no traveller in need, and lets no thief pass.",
            ] },
            { id: "lore.sand.5", title: "Brass and Children", voice: "echo", lines: [
                "The Gatekeeper was gentle with children.",
                "On feast days he knelt so they could polish his brass.",
            ] },
            { id: "lore.sand.6", title: "The Warden of the Gate", voice: "echo", lines: [
                "The Warden of the Gate could call a hundred spears with one raised blade.",
                "In all his years he never once needed to.",
            ] },
            { id: "lore.sand.7", title: "The Night of the Split", voice: "echo", lines: [
                "When the world broke, the gate broke with it.",
                "The Warden closed what was left. His own people were on the far side.",
            ] },
            { id: "lore.sand.8", title: "The Mason of the Cold", voice: "echo", lines: [
                "The Shrinebreaker was built to lift anchor-stones into place.",
                "It had the gentlest hands of anything I ever knew.",
            ] },
            { id: "lore.sand.9", title: "The Wall of the Glacier", voice: "echo", lines: [
                "The Icewall was old before I was born.",
                "It leaned its back against the glacier so the Cold's anchors would not slide.",
            ] },
            { id: "lore.sand.10", title: "The Whisper", voice: "echo", lines: [
                "The Drift never forces. It whispers that the pulling will stop if you only let go.",
                "Every Warden heard it, alone, for a very long time.",
            ] },
            { id: "lore.sand.11", title: "Scratched Beneath a Warden's Mark", voice: "inscription", lines: [
                "Still here. Still keeping. Still here.",
            ] },
            { id: "lore.sand.12", title: "Mercy", voice: "echo", lines: [
                "They do not hate the anchors.",
                "They believe the lands are in pain, and that letting them drift apart would be a kindness.",
            ] },
        ],
        ash: [
            { id: "lore.ash.1", title: "The Plate", voice: "echo", lines: [
                "The Volcanic Plate was the richest of the lands.",
                "Its smiths could work stone as if it were wax.",
            ] },
            { id: "lore.ash.2", title: "The Furnace Stone", voice: "inscription", lines: [
                "Here we raise the Furnace: one heart to hold every land as one.",
                "Let no anchor ever burn alone again.",
            ] },
            { id: "lore.ash.3", title: "One Heart", voice: "echo", lines: [
                "Seven anchors to a land had always been enough.",
                "We wanted one heart for all of them. We wanted never to be afraid again.",
            ] },
            { id: "lore.ash.4", title: "The Wake of Light", voice: "echo", lines: [
                "The Furnace needed the light of every anchor, so I carved a wake to carry it here.",
                "It was the finest wake I ever made. I was proud of it.",
            ] },
            { id: "lore.ash.5", title: "The Guardian's Charge", voice: "inscription", lines: [
                "The Guardian feeds the Furnace. The fire must not go out.",
                "The fire must not go out.",
            ] },
            { id: "lore.ash.6", title: "The Crack", voice: "echo", lines: [
                "The Furnace drank every light we gave it and asked for more.",
                "When there was no more, it cracked, and the world cracked with it.",
            ] },
            { id: "lore.ash.7", title: "The First Warden", voice: "echo", lines: [
                "The Plate Knight was the first Warden I named.",
                "When the ground split, he drove his fists into it and held the plates together.",
            ] },
            { id: "lore.ash.8", title: "Holding", voice: "echo", lines: [
                "He is holding still, I think. Holding, and breaking, and holding.",
                "He cannot tell the two apart anymore.",
            ] },
            { id: "lore.ash.9", title: "Where the Light Went", voice: "echo", lines: [
                "The light we fed the Furnace did not vanish.",
                "Some of it sank into the stones. Some of it became me.",
            ] },
            { id: "lore.ash.10", title: "The Price of Mending", voice: "echo", lines: [
                "The anchors are dim because their light is gone.",
                "To mend the Drift it must be given back, and I am most of what is left of it.",
            ] },
            { id: "lore.ash.11", title: "Carved by the First", voice: "inscription", lines: [
                "When the last anchor burns, pour what remains of me into the stones.",
                "Do not wait for me to be ready. I will not be.",
            ] },
            { id: "lore.ash.12", title: "An Echo's End", voice: "echo", lines: [
                "Do not grieve for an echo.",
                "An echo only lasts while someone is listening, and you listened.",
            ] },
        ],
    },

    /** QUEST §3.4 — the journal page unlocked by all 12 shards of a realm. */
    chronicle: {
        cold: { id: "chronicle.cold", title: "Chronicle of the Rime Shelf", lines: [
            "Before the Drift there was one world, and the Wakecasters carved the roads that bound it.",
            "Seven anchor-stones held each land close to the others. I set the first of them here.",
            "One night every anchor dimmed, and by morning the lands had begun to drift apart.",
            "We rode out to hold them. I am all that came back, and I am only a voice.",
        ] },
        sand: { id: "chronicle.sand", title: "Chronicle of the Sundered Gate", lines: [
            "I chose six Wardens to keep the anchors lit, two for every land, and all of them said yes.",
            "They were guardians: of gates, of glaciers, of children polishing brass on feast days.",
            "When the world broke they held on alone, and the Drift told them that letting go was mercy.",
            "They are not cruel. They are tired. Breaking them is the kindest thing left to do.",
        ] },
        ash: { id: "chronicle.ash", title: "Chronicle of the Volcanic Plate", lines: [
            "We built the Furnace to be one heart for every land, and I carved the wake that fed it.",
            "It drank the light of every anchor and cracked, and the world cracked with it. That is the Drift.",
            "The light was not lost. It sank into the stones, and some of it became me.",
            "To mend the Drift the light must go home. When it does, I will go with it.",
        ] },
    },

    /**
     * QUEST §3.3 — three named elites per realm. `unit` is a real
     * combatData.ENEMIES key of that realm (never a boss row, never a unit
     * that shares a name with a Warden). Index 2 drops the realm's relic.
     */
    bounties: {
        cold: [
            { id: "bounty.cold.1", unit: "rimeImp", name: "Frostfang, the Starved",
                desc: "An imp that outlived its whole warren one winter. It has been hungry ever since." },
            { id: "bounty.cold.2", unit: "frostStalker", name: "Hollowdrift, Who Swims Below",
                desc: "Hunts under the powder, following the wakes of riders who never reach the next shrine." },
            { id: "bounty.cold.3", unit: "glacierBrute", name: "Old Hoarback",
                desc: "It wears three winters of rime like armour. Crack the shell, and it only gets angrier." },
        ],
        sand: [
            { id: "bounty.sand.1", unit: "windscourBandit", name: "Kesh the Grinning",
                desc: "Last of the dune bandit captains. He blinds you first and laughs about it after." },
            { id: "bounty.sand.2", unit: "sandMummy", name: "The Unburied Steward",
                desc: "It kept the gate-city's ledgers. It still collects from anyone who lingers too long." },
            { id: "bounty.sand.3", unit: "boneKnight", name: "The Oathbone Knight",
                desc: "Swore to guard the gate road until relieved. No one ever came to relieve him." },
        ],
        ash: [
            { id: "bounty.ash.1", unit: "scorchRaider", name: "Emberheel",
                desc: "Rides the slopes on burning bracers, faster than most can surf. Not faster than you." },
            { id: "bounty.ash.2", unit: "sootAssassin", name: "The Soot Widow",
                desc: "Waits in the heat-shimmer for one careless cast. Most of her quarry only ever made one." },
            { id: "bounty.ash.3", unit: "slagBrute", name: "Slagmaw, the Unquenched",
                desc: "Too heavy to throw and too hot to hold. Lure its charge into stone, then strike." },
        ],
    },

    /**
     * QUEST §3.2 — three Wake Trials per realm, each named for the landmark
     * it runs past (landmarks.js LANDMARK_TYPES label). The trial lane should
     * lay each line through or beside an instance of `landmark`, or the name
     * lies. Index 2 is the trial whose gold pays the realm's relic.
     */
    trials: {
        cold: [
            { id: "trial.cold.1", landmark: "rimeCircle", name: "Rime Circle Run",
                desc: "Thread the gates round the henge and down the long slope beyond it." },
            { id: "trial.cold.2", landmark: "frozenCrest", name: "Under the Frozen Crest",
                desc: "Ride the curl of the frozen wave and drop off its lip at speed." },
            { id: "trial.cold.3", landmark: "glacierGate", name: "Through the Glacier Gate",
                desc: "The oldest line on the Shelf, from the high snow down through the gate." },
        ],
        sand: [
            { id: "trial.sand.1", landmark: "sunkenColonnade", name: "Down the Sunken Colonnade",
                desc: "Follow the drowned avenue, pillar to pillar, as it sinks into the dunes." },
            { id: "trial.sand.2", landmark: "bleachedRibs", name: "Between the Bleached Ribs",
                desc: "Carve through the old carcass and out across the open sand." },
            { id: "trial.sand.3", landmark: "watchSpire", name: "The Watch Spire Descent",
                desc: "The couriers' run, from the tallest mark in the world to the valley floor." },
        ],
        ash: [
            { id: "trial.ash.1", landmark: "basaltColonnade", name: "Past the Basalt Colonnade",
                desc: "A fast line along the black columns. Do not touch them; they are still warm." },
            { id: "trial.ash.2", landmark: "emberVent", name: "The Ember Vent Line",
                desc: "Weave between the vents while the ground breathes smoke." },
            { id: "trial.ash.3", landmark: "calderaRim", name: "Round the Caldera Rim",
                desc: "The hardest ride on the Plate: all the way round the broken crater." },
        ],
    },

    /** QUEST §4.2 — twelve relics. `effect` is the spec's text, verbatim. */
    relics: {
        "relic.rimeHeart": { id: "relic.rimeHeart", realm: "cold", name: "Rime Heart",
            effect: "Chill lasts +1 s",
            flavor: "A heart of ice that never learned how to thaw." },
        "relic.frostglassLens": { id: "relic.frostglassLens", realm: "cold", name: "Frostglass Lens",
            effect: "bolt range +20%",
            flavor: "Ground from Wake Glass. Far things come near through it." },
        "relic.keelOfTheFirst": { id: "relic.keelOfTheFirst", realm: "cold", name: "Keel of the First",
            effect: "surf speed +6%",
            flavor: "A sliver of river ice from the first board. It still wants to ride." },
        "relic.warmHands": { id: "relic.warmHands", realm: "cold", name: "Warm Hands",
            effect: "mana regen +20%",
            flavor: "Mittens, darned many times. Someone loved the one who wore them." },
        "relic.brassBuckle": { id: "relic.brassBuckle", realm: "sand", name: "Brass Buckle",
            effect: "−15% damage taken from heavies",
            flavor: "Polished bright by children's hands, a long time ago." },
        "relic.sandGlass": { id: "relic.sandGlass", realm: "sand", name: "Sand Glass",
            effect: "spell cooldowns −8%",
            flavor: "The sand runs a little faster for those in a hurry." },
        "relic.duneRunner": { id: "relic.duneRunner", realm: "sand", name: "Dune Runner",
            effect: "surf jump +25%",
            flavor: "Worn by the couriers who rode the dune roads before the gate fell." },
        "relic.scorpionsPatience": { id: "relic.scorpionsPatience", realm: "sand", name: "Scorpion's Patience",
            effect: "+10% damage for 2 s after a dodge-surf",
            flavor: "Wait. Slip aside. Then strike." },
        "relic.emberCoil": { id: "relic.emberCoil", realm: "ash", name: "Ember Coil",
            effect: "bolts ignite, 3 dmg/s 2 s",
            flavor: "Wire from the Furnace's heart. It has never once cooled." },
        "relic.plateShard": { id: "relic.plateShard", realm: "ash", name: "Plate Shard",
            effect: "+15% max HP",
            flavor: "A splinter of the Knight's armour. Heavier than it looks." },
        "relic.furnaceCore": { id: "relic.furnaceCore", realm: "ash", name: "Furnace Core",
            effect: "vortex +20% duration",
            flavor: "A cinder from the Furnace. It turns slowly in your palm." },
        "relic.wakemender": { id: "relic.wakemender", realm: "ash", name: "Wakemender",
            effect: "motes heal +50%",
            flavor: "A Wakecaster's needle, for stitching torn wakes. And other torn things." },
    },

    /**
     * QUEST §4.1 — twelve boons, a pick-of-two per boss first kill. `effect`
     * is the spec's text, verbatim. Keyed by realm + kind + pick (0 = the
     * spec's left option), NOT by boss key — see the header, note 2.
     */
    boons: {
        "boon.rimeEdge": { id: "boon.rimeEdge", realm: "cold", kind: "mini", pick: 0,
            name: "Rime Edge", effect: "+8% frost damage",
            flavor: "Every cut leaves a little winter behind it." },
        "boon.deepChill": { id: "boon.deepChill", realm: "cold", kind: "mini", pick: 1,
            name: "Deep Chill", effect: "Chill stacks to 6",
            flavor: "Slower, and slower, and still." },
        "boon.glacialGuard": { id: "boon.glacialGuard", realm: "cold", kind: "realm", pick: 0,
            name: "Glacial Guard", effect: "+10% max HP",
            flavor: "The glacier's patience, worn like a coat." },
        "boon.frostNova": { id: "boon.frostNova", realm: "cold", kind: "realm", pick: 1,
            name: "Frost Nova", effect: "the Arc chills twice",
            flavor: "The cold arrives, and then it arrives again." },
        "boon.quickenedSpikes": { id: "boon.quickenedSpikes", realm: "sand", kind: "mini", pick: 0,
            name: "Quickened Spikes", effect: "Spikes cooldown −2 s",
            flavor: "The ground is quicker to answer you now." },
        "boon.tidalForce": { id: "boon.tidalForce", realm: "sand", kind: "mini", pick: 1,
            name: "Tidal Force", effect: "Wave knockback +30%, Wave damage +8%",
            flavor: "A wave with the whole Sand behind it." },
        "boon.sandstep": { id: "boon.sandstep", realm: "sand", kind: "realm", pick: 0,
            name: "Sandstep", effect: "+8% surf speed",
            flavor: "The dunes part a little for you." },
        "boon.sunder": { id: "boon.sunder", realm: "sand", kind: "realm", pick: 1,
            name: "Sunder", effect: "+12% damage to staggered foes",
            flavor: "Strike them while they are still falling." },
        "boon.cinderbrand": { id: "boon.cinderbrand", realm: "ash", kind: "mini", pick: 0,
            name: "Cinderbrand", effect: "+8% damage vs chilled",
            flavor: "Fire and frost, meeting in the same wound." },
        "boon.greatVortex": { id: "boon.greatVortex", realm: "ash", kind: "mini", pick: 1,
            name: "Great Vortex", effect: "Vortex radius +15%",
            flavor: "The storm remembers how large it used to be." },
        "boon.heartOfTheDrift": { id: "boon.heartOfTheDrift", realm: "ash", kind: "realm", pick: 0,
            name: "Heart of the Drift", effect: "+12% all damage",
            flavor: "The light the Furnace stole, turned to your purpose." },
        "boon.undyingWake": { id: "boon.undyingWake", realm: "ash", kind: "realm", pick: 1,
            name: "Undying Wake", effect: "once per fight, survive a lethal hit at 1 HP",
            flavor: "Not yet. The world still needs riding." },
    },

    /** The six pairs, `<realm>.<kind>` -> [pick 0, pick 1]. */
    boonPairs: {
        "cold.mini": ["boon.rimeEdge", "boon.deepChill"],
        "cold.realm": ["boon.glacialGuard", "boon.frostNova"],
        "sand.mini": ["boon.quickenedSpikes", "boon.tidalForce"],
        "sand.realm": ["boon.sandstep", "boon.sunder"],
        "ash.mini": ["boon.cinderbrand", "boon.greatVortex"],
        "ash.realm": ["boon.heartOfTheDrift", "boon.undyingWake"],
    },

    /** QUEST §4.3 — the shrine shop. `effect` is the spec's text; no prices
     *  here (numbers belong to the rewards lane and PROGRESSION_DESIGN). */
    shop: {
        "shop.vitality": { id: "shop.vitality", name: "Vitality",
            effect: "+4% max HP each", ranks: ["I", "II", "III", "IV", "V"],
            flavor: "Wake Glass, ground fine and taken with snowmelt." },
        "shop.wellspring": { id: "shop.wellspring", name: "Wellspring",
            effect: "+4% max mana each", ranks: ["I", "II", "III", "IV", "V"],
            flavor: "The shrines lend you a little of their depth." },
        "shop.reroll": { id: "shop.reroll", name: "Boon Reroll",
            effect: "One boon reroll token",
            flavor: "Change your mind. The shrines will not hold it against you." },
        "shop.trail": { id: "shop.trail", name: "Wake Trail",
            effect: "A new colour for your wake",
            flavor: "No use at all, except the joy of it." },
        "shop.slot3": { id: "shop.slot3", name: "Relic Slot 3",
            effect: "Unlock the third relic slot early",
            flavor: "Free once the Warden of the Sundered Gate falls." },
    },

    /** QUEST §4.3 — the six cosmetic wake trail colours. The id names the hue. */
    trails: {
        "trail.frost": { id: "trail.frost", name: "Frostlight",
            desc: "A pale blue wake, like the first frost on a window." },
        "trail.aurora": { id: "trail.aurora", name: "Aurora",
            desc: "Green light, the way the Cold sky used to dance." },
        "trail.brass": { id: "trail.brass", name: "Brassglow",
            desc: "Gold as a polished buckle in the noon sun." },
        "trail.dusk": { id: "trail.dusk", name: "Duskveil",
            desc: "The violet of the dunes just after sunset." },
        "trail.ember": { id: "trail.ember", name: "Emberline",
            desc: "Orange sparks that die slowly behind you." },
        "trail.garnet": { id: "trail.garnet", name: "Garnet",
            desc: "Deep red, like slag in the moment it cools." },
    },

    /** QUEST §4.4 — the post-cap pick, a one-click toast. Effects verbatim. */
    driftmarks: {
        id: "driftmarks",
        toast: "Driftmark earned. Choose one.",
        picks: {
            dmg: { id: "driftmark.dmg", name: "Keen Mark", effect: "+0.5% damage" },
            hp: { id: "driftmark.hp", name: "Hale Mark", effect: "+0.5% max HP" },
            surf: { id: "driftmark.surf", name: "Swift Mark", effect: "+0.3% surf speed" },
        },
    },

    /** QUEST §6 — one-time prompts, persisted by id in quest.hintsSeen. */
    hints: {
        "hint.surf": { id: "hint.surf", text: "Hold RMB to surf" },
        "hint.bolt": { id: "hint.bolt", text: "LMB — Bolt" },
        "hint.arc": { id: "hint.arc", text: "1 — Frost Arc" },
        "hint.journal": { id: "hint.journal", text: "J — Journal, M — Map, E — Interact" },
    },

    /** Tracker lines that are not a step's own (all <= 60). */
    trackers: {
        postGame: { id: "tracker.postGame", text: "The world is whole. Ride on." },
        underLevel: { id: "tracker.underLevel", text: "Grow stronger — reach level {level}" },
        bountyLastSeen: { id: "tracker.bountyLastSeen", text: "Last seen near the {place}" },
    },

    /** QUEST §7 — the fixed UI words. Labels only; layout is the UI lane's. */
    ui: {
        speaker: "The Echo",
        toasts: {
            questComplete: "Quest Complete — {title}",
            shrineAwakened: "Shrine Awakened",
            relicFound: "Relic Found",
            loreFound: "Lore Shard Found",
            chronicle: "Chronicle Unlocked",
            bountyClaimed: "Bounty Claimed — {name}",
            trialMedal: "{medal} Medal — {name}",
            wakeGlass: "+{amount} Wake Glass",
            boonChosen: "Boon Chosen — {name}",
        },
        journalTabs: { main: "Main", side: "Side", lore: "Lore", stats: "Stats" },
        shrineMenu: { rest: "Rest", travel: "Travel", boons: "Boons",
            relics: "Relics", shop: "Shop", chronicle: "Chronicle" },
        side: {
            caches: "Relic caches found {found}/{total}",
            trials: "Wake Trials",
            bounties: "Bounties",
        },
        /** Save `trials.<id>.medal` 1..3 -> medals[medal - 1]; 0 = none yet. */
        medals: ["Bronze", "Silver", "Gold"],
        currency: "Wake Glass",
        locked: "???",
    },

    /** QUEST §9 — "Mend the Drift". */
    ending: {
        id: "ending",
        echo: ENDING_ECHO,
        card: "The Drift is mended.",
        playerTitle: "Wakecaster",
        credits: [
            { id: "credits.title", heading: "DRIFTWAKE", lines: [
                "A ForgeFlow Games production",
            ] },
            { id: "credits.team", heading: "Made by", lines: [
                "ForgeFlow Games",
            ] },
            { id: "credits.systems", heading: "The world and its systems", lines: [
                "Terrain, snow shading and live snow deformation",
                "The breaking-wave surf wake and its spray",
                "Sky, atmosphere, weather and light",
                "The Wakecaster's spells, from the Frost Arc to the Great Vortex",
                "Three realms: the Rime Shelf, the Sundered Gate and the Volcanic Plate",
                "Twenty-one shrines and forty-five landmarks",
                "The enemy roster, the pack director and six Warden fights",
                "Progression, boons, relics, Wake Glass and Driftmarks",
                "Quests, relic caches, Wake Trials, bounties and lore",
                "Sound, voices and music",
            ] },
            { id: "credits.upstream", heading: "Built on SNOWFLOW", lines: [
                "A real-time snow rendering tech demo by Maksymilian Dendura",
                "Released under the MIT Licence",
            ] },
            { id: "credits.fx", heading: "Spell effect techniques", lines: [
                "Adapted from LinearAbiltyCastingThreeJS by mohamedachrefelouafi",
                "Released under the MIT Licence",
                "Shockwave rings, burst shells, telegraph and cast rings, the frost-arc decal",
            ] },
            { id: "credits.engine", heading: "Engine", lines: [
                "three.js r172, MIT Licence",
            ] },
            { id: "credits.art", heading: "Models", lines: [
                "Hero and enemy models generated with Meshy",
            ] },
            { id: "credits.sound", heading: "Sound", lines: [
                "Kenney — Impact Sounds, CC0",
                "Sonniss — #GameAudioGDC 2024 bundle",
            ] },
            { id: "credits.music", heading: "Music", lines: [
                "“Hollow Wave” by Forge Flow Labs",
            ] },
            { id: "credits.thanks", heading: "And you", lines: [
                "Thank you for riding, Wakecaster.",
            ] },
        ],
    },
};

/* ------------------------------------------------------------------ *
 * Freeze, once, all the way down — the "single frozen object" contract.
 * ------------------------------------------------------------------ */

(function deepFreeze(o) {
    Object.freeze(o);
    for (const k of Object.keys(o)) {
        const v = o[k];
        if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
    }
})(STORY);

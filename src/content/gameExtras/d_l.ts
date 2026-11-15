import type { GameExtra } from "./types";

export const EXTRAS_D_L: Record<string, GameExtra> = {
  dominoes: {
    about:
      "This is draw dominoes with the full double-six set of 28 ivory tiles on a warm felt table. Each player starts with seven tiles. You match a pip end onto either open end of the snaking line, and if you cannot play you draw from the boneyard until you can. You play a computer opponent at four skill levels, with no timer and soft piano.",
    howTo: [
      "Click a tile in your hand to select it, then click a highlighted open end of the line to play it. Only legal ends are highlighted.",
      "A tile can be played when one of its pip counts matches the number at an open end of the line.",
      "If you have no playable tile, click the boneyard to draw until you get one you can play.",
      "The first player to empty their hand wins the round.",
      "If the game blocks up and nobody can play, the player with the lightest hand wins. Right-drag rotates the camera and the wheel zooms.",
    ],
    tips: [
      "Play doubles early. A double can only be placed on a matching end, so holding one for too long can leave it stuck in your hand.",
      "Keep a mix of numbers in your hand. A hand that all shares one number is easy for the table to block.",
      "Keep track of which numbers have been played a lot. When a number is nearly used up, tiles carrying it become harder to place.",
      "If the game looks like it will block, count your pips. Because the lightest hand wins a blocked game, getting rid of heavy tiles first matters.",
    ],
  },

  "dungeon-forge": {
    about:
      "Dungeon Forge is a dungeon construction kit and an escape game in one. In build mode you paint rooms and corridors across up to five floors, add doors and locks, hide keys, and place traps and monsters in a fantasy or sci-fi theme. In play mode you try to escape it, alone or co-op, before the race clock runs out. Friends can build the same dungeon with you in real time using a four-letter room code.",
    howTo: [
      "In build mode, left-click to place and drag to paint. Right-drag orbits the camera, middle-drag pans, the wheel zooms, R rotates a piece, Tab changes floor and Del deletes.",
      "Add doors and lock any of them, then make sure a key exists somewhere: on the floor, in a chest or carried by a monster.",
      "Use the solvability checker to prove the dungeon can actually be beaten before you share it.",
      "To play, use WASD to move, the mouse to look, left-click to attack, right-click or F for a bolt, E to interact, Q for a potion, Shift to sprint and V to swap between first and third person.",
      "Reach the glowing exit portal to finish. Share a room code to build and playtest with friends, or publish a finished dungeon under a short code with a fastest-escape leaderboard.",
    ],
    tips: [
      "Start with one floor and a few rooms. A small dungeon that works is more fun to test than a large one you never finish.",
      "Place the key somewhere the player can reach, and let the solvability checker confirm it. A dungeon nobody can finish is the most common building mistake.",
      "Mix the difficulty of your guards and traps. Chest loot scales with difficulty, so a harder dungeon pays out more.",
      "Light matters. Torches and neon make a dungeon easier to read as well as better looking.",
      "Playtest your own dungeon with a friend. A second person finds the shortcuts you did not intend.",
    ],
  },

  dyefield: {
    about:
      "DYEFIELD is a third-person turf-paint arena. Each match runs on one of three harbor arenas - Pier 18 Plaza, Lockwell Works and Cinder Reef - and you choose a mode: Teams 4 v 4, Free-for-all with eight runners, or a 1 v 1 Duel. The rule is either Turf, where the floor is the scoreboard, or Washout, where the most washes wins. Four kits change how you paint and fight.",
    howTo: [
      "Open Play and choose your mode, your rule and your arena, then pick a kit in the Loadout screen.",
      "Move with WASD and look with the mouse. Left-click fires, rolls or charges depending on your kit, and the right mouse button aims.",
      "Hold SHIFT while standing on your own colour to slick down into the dye. You move faster, stay hidden and refill your tank.",
      "Use E for your Jelly Charge throwable and Q for your special: Cloudburst or Wellspring.",
      "To play with a friend online, use Create Room and share the four-character code, or both choose the same mode and rule in Quick Match.",
    ],
    tips: [
      "Your own colour is a highway and a refill pool. Enemy colour is glue: you slog through it and cannot slick, so avoid crossing it when you can go around.",
      "Match the kit to the arena. Sheet-Drum's roller covers a wide lane as you walk, Needle-Glint charges up long lines from a distance, and Pop-Well fires slow airborne bursts where a direct hit removes a runner.",
      "In Teams, cover ground that your crew has not yet painted. Re-painting a tile that is already yours scores nothing new.",
      "In Washout, paint still moves you, refills your tank and charges your special, so staying active matters even when you are not scoring.",
      "Colourblind marks (shape plus colour), key remapping and quality settings are all in the menus if you need them.",
    ],
  },

  "edge-keeper": {
    about:
      "In Edge Keeper every player owns one wall of a living polygon and has two lives. Miss the ball and your edge shatters, and the arena closes into a tighter shape around whoever is left. The last wall standing wins. You can play the classic eight-player octagon or the twenty-player Arena ring, solo, on one keyboard with a friend, or online.",
    howTo: [
      "Slide your paddle with the mouse, A and D, or the arrow keys. You only have to cover your own wall.",
      "Keep the ball from passing your edge. You have two lives before your wall shatters.",
      "For local two-player on one keyboard, the second player uses Q and E.",
      "Players who are knocked out stay in the match as saboteurs. Press 1, 2 or 3 to choose a bumper, a warp or a spinner, then click to place it.",
      "Online, host a room and share the code, find a match, or join from a link. Press M to mute and Esc for the menu.",
    ],
    tips: [
      "Stay centred on your wall and react to the ball rather than guessing where it will go. Small corrections are more reliable than large ones.",
      "As walls shatter, the arena closes into a tighter shape, so the court you are defending changes during the match. Stay alert after every elimination.",
      "If you are knocked out, you are not finished. Place bumpers, warps and spinners to change the court for the players who remain.",
      "Try the Arena ring once you are comfortable. Its spinning core of prizes and traps changes how rallies develop.",
    ],
  },

  "ember-sanctum": {
    about:
      "Ember Sanctum is a five-realm story told through isometric arena fights. You choose a champion - the Crucible Knight, the Storm Adept or the Umbral Ranger - and fight escalating waves across the Ember Crucible, Frostveil Circle, Stormspire Board, Umbral Fen and Solar Bastion. Each realm ends with a named Warden who speaks to you before the fight. A PVP Arena lets you take your champion into duels against a rival.",
    howTo: [
      "Choose a champion on the title screen, then pick Campaign to play through the realms.",
      "Move with WASD and attack with the left mouse button. Keys 1, 2 and 3 use your skills and Shift dodges.",
      "As the Crucible Knight, press V to switch between the two-handed and sword-and-shield stances in the middle of a fight.",
      "Use the right mouse button to look around and the scroll wheel to zoom. Press SPACE or click to advance boss dialogue.",
      "For the PVP Arena choose Duel of Champions (best of three), Ember Rush (a 120-second kill-score race) or Last Sanctum (endless waves, last champion standing).",
      "On a phone or tablet there is a joystick and ability buttons on screen.",
    ],
    tips: [
      "Each Warden has telegraphed signature attacks. Watch for the wind-up and dodge on the signal rather than reacting to the hit.",
      "Use Shift to dodge out of a telegraphed attack instead of trying to out-damage it. Moving out of the danger is usually cheaper than taking the hit.",
      "Learn your champion's three skills before attempting a Warden fight. Each class has a different way to control space.",
      "The Knight's stance swap is worth practising: one stance for damage, the other for defence.",
    ],
  },

  "grid-rush": {
    about:
      "Grid Rush is a neon hover-kart racer set on luminous ribbon tracks across five cyber arenas. You pilot one of six original chassis, drift to charge your turbine, grab Data Orbs for gadgets and race three-lap circuits against rival crews, with synthwave music and a live standings display.",
    howTo: [
      "Steer with A and D or the arrow keys, accelerate with W and brake or reverse with S.",
      "Press SPACE to jump and SHIFT for a burst of speed.",
      "Drive through Data Orbs to pick up a gadget, then press E or the left mouse button to use it.",
      "Drift through corners to charge your turbine.",
      "Finish three laps ahead of your rivals. Press Esc to pause.",
    ],
    tips: [
      "Pick a chassis to suit your driving. The six - Prism Sled, Volt Runner, Glass Phantom, Mag-Drill, Echo Wedge and Nova Disc - are different craft, so try more than one.",
      "Save defensive gadgets for when you are being chased and offensive ones for when a rival is just ahead of you.",
      "Drift whenever the track bends. It is how you charge your turbine, so a lap with more clean drifts builds more charge than one driven straight through the corners.",
      "Use the standings display to decide how aggressive to be. If you are far ahead, hold a clean line instead of risking a collision.",
    ],
  },

  "harpoon-pop": {
    about:
      "Harpoon Pop is a 3D arcade game about splitting bouncing bubbles with a harpoon wire. Pip the diver clears bubbles that split into smaller ones when hit, across 12 hand-built stages from Mt. Fuji to Giza and then an endless generated world tour. You can play solo, share one keyboard in local two-player co-op, or team up online with a friend using Quick Match or a four-letter room code.",
    howTo: [
      "On the title screen, use the left and right arrows to choose 1 Player, Online Co-op or Local 2P.",
      "Move left and right with the arrow keys and fire the harpoon with SPACE, the up arrow or Z. In local 2P the second player uses A and D to move and W to fire.",
      "Hit a bubble and it splits in two. Keep splitting until the bubbles are gone, and clear every bubble before the clock runs out.",
      "Do not get touched. Each diver has their own lives, weapon and shield, and a downed partner returns on the next stage.",
      "Press P to pause when playing offline, M for sound and N for music.",
    ],
    tips: [
      "Chain pops quickly for a score multiplier of up to x8. Slow, careful clearing is safer but scores less.",
      "Hitting a bubble at the top of its arc gives an APEX bonus, and grazing a bubble without being hit triggers a short bullet-time moment.",
      "Collect power-ups that drop from popped bubbles: double or triple wire, power wire, rapid fire, slow-mo, a force field, dynamite and extra lives.",
      "Bomb bubbles trigger chain reactions, so pop them when the neighbours are the ones you want gone. From stage 3, stinger drones fire back, so keep an eye on the sky.",
    ],
  },

  "hit-parade": {
    about:
      "HIT PARADE is a 3D arena fighting game staged as a late-night TV fight show. The two fighters face each other inside a ring you can walk all the way around, so the main idea is the sidestep. There are twelve contestants, five 360-degree arenas, an eight-episode arcade season, local and online versus, and a full training room. The violence is comic only.",
    howTo: [
      "Choose a control type: Easy is the keyboard default with one key per special, Simple uses a special button plus a direction, and Classic uses motion inputs.",
      "On Easy, walk with A and D, jump with W or SPACE, crouch with S and hold SHIFT to block. J, K and L are punch, kick and heavy.",
      "Tap Q or E to sidestep, or hold to circle-walk around your opponent. The camera orbits with you.",
      "Use the special keys U, I, O and P, H for a super, F to throw and R to parry. Press F1 to show or hide the controls bar.",
      "Choose The Season for the arcade ladder, Versus for a match on one screen, Online for Quick Match or a room code, or Training to practise.",
    ],
    tips: [
      "Straight attacks and straight projectiles can be sidestepped on a read, but homing attacks track a stepper, so mix your steps with blocks and parries.",
      "The ring wall is a weapon. Launch someone into it for a wall splat.",
      "Use the Training room. It shows frame data, 3D hitboxes and every move list, and the dummy can be set to block, step or fight back.",
      "Big characters step less well than small ones, so choose a fighter who fits how you want to move.",
    ],
  },

  "iron-tide": {
    about:
      "Iron Tide is a 3D naval duel between hidden fleets. You place your ships, then trade salvos across two side-by-side seas against a hunting computer opponent. Sinking an enemy ship earns a one-use upgrade - Recon Scan, Barrage, Salvo, Sonar or Double Tap - and chaining sinks builds up your power.",
    howTo: [
      "Left-click to place each ship, press R to rotate it, or press A to auto-place the fleet.",
      "Left-click a square on the enemy sea to fire a salvo.",
      "Sink a ship to earn an upgrade, then use keys 1 to 5 to trigger an ability.",
      "Right-drag rotates the camera, WASD moves it and the wheel zooms. Press Esc to pause.",
      "Choose a difficulty before you start. Sink every enemy ship before yours are sunk.",
    ],
    tips: [
      "After a hit, probe the squares next to it first. The rest of that ship is almost certainly beside the hit.",
      "Search the open water in a spread-out pattern instead of firing at neighbouring squares. It finds ships faster.",
      "Save Recon Scan and Sonar for when you have no leads, and use Barrage, Salvo or Double Tap once you know where a ship is.",
      "Place your own fleet unpredictably. Ships clustered together are easier to find than ships spread across the sea.",
    ],
  },

  "last-circle": {
    about:
      "Last Circle is a third-person battle royale shooter. Every match is a 50-player lobby on one of three maps - the tropical Isla Viva, the shattered downtown of Ashgrid and the conifer wilds of Deepwood - with loot chests, high ground and a shrinking storm. There are Standard, five-minute Quick and Practice modes. It needs a keyboard and mouse.",
    howTo: [
      "Everyone drops with a pistol. Press SPACE to toggle your parachute and steer toward a location.",
      "Move with WASD, aim with the mouse and fire with the left button. Aim down sights with the right button and sprint with SHIFT.",
      "Press and hold E to open chests and pick up loot. Use 1 to 5 or the scroll wheel to switch weapons and R to reload.",
      "Open the map with M and keep track of the storm. Stay inside the safe circle as it shrinks.",
      "Be the last player standing to win. Choose Quick for a five-minute storm, or Practice to learn a map.",
    ],
    tips: [
      "Land near loot, not near the middle of the crowd. An early pistol-only fight is a coin flip.",
      "Look for shields and better weapons in chests, and watch for supply drops.",
      "Move toward the next circle early. Being late means fighting the storm and the other players at once.",
      "High ground gives you sightlines, but it also exposes you to every other player. Check the area before you settle.",
    ],
  },

  luminascape: {
    about:
      "LuminaScape is a calm nature world-builder with no score and no timer. You sculpt hills, carve rivers, raise oceans, paint twelve kinds of ground and fill the world with trees, flowers, animals, cottages, castles and town decor. Animals roam on a day-and-night cycle, and you can put on the helmet at any time and walk your world in third person. LuminaScape Together lets friends visit your world with a room code.",
    howTo: [
      "Pick a tool from the bar at the bottom of the screen, then click or drag on the ground. Left-click places, sculpts or paints, click-and-hold grows, and dragging scatters.",
      "Right-drag to orbit, scroll to zoom and use WASD to pan the view. Right-click rotates an object while you place it.",
      "Edit anything you place: resize it, rotate it, recolour it, or restyle a building's roof, walls, windows and doors.",
      "Add weather and events from the climate tools, from rain and fog to storms and volcanoes.",
      "Press Play (the helmet) to walk your world: WASD to move, Shift to run and drag to look. Ctrl+Z and Ctrl+Y undo and redo.",
    ],
    tips: [
      "Start with terrain. Shape the land and the water first, then paint the ground, then plant and build. Details sit better on a finished base.",
      "Use undo freely. Ctrl+Z makes experimenting with a tool risk-free.",
      "Try changing the time of day and the weather once your world is set. The same scene can look very different at dusk.",
      "Host a room and invite a friend to see your world live, or use Quick Match to meet another traveller.",
    ],
  },
};

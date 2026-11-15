import type { GameExtra } from "./types";

export const EXTRAS_M_Z: Record<string, GameExtra> = {
  mahjong: {
    about:
      "Mahjong Solitaire is a calm tile-matching game. The 144 carved tiles are stacked into the classic turtle layout - circles, bamboo, characters, winds, dragons, flowers and seasons - and you clear them two at a time by matching a free pair. There is no timer, and every deal is generated so that it can be solved.",
    howTo: [
      "A tile is free when nothing sits on top of it and its left or right side is open.",
      "Click a free tile, then click a free tile that matches it, and the pair is removed.",
      "Flowers match any other flower and seasons match any other season. Every other tile matches its identical twin.",
      "Press H for a hint when you are stuck, or press S to shuffle the remaining tiles into a fresh solvable layout.",
      "Remove every tile to clear the board. Right-drag rotates the camera and the wheel zooms.",
    ],
    tips: [
      "Work on the tall stacks first. Clearing the tiles that cover others opens up more pairs than picking off the edges.",
      "When two tiles of the same kind are both free, check whether a third or fourth copy is buried before you choose which pair to take. Taking the wrong pair can leave a copy trapped.",
      "Look for the end tiles of long rows. They are often the key to freeing the rest of the row.",
      "Hints and the shuffle are there to be used. They are the kind of help a patient player takes without guilt.",
    ],
  },

  "neon-veil": {
    about:
      "Neon Veil is a neon sky combat flight game. You thread cyberpunk skylines, lock heat-seeking rockets, pick up weapon crates and fly portal rings between sectors in dogfights against outlaw pilots. It plays with mouse and keyboard, and there is a multiplayer option from the menu.",
    howTo: [
      "Fly with WASD and aim with the mouse. Fire with the left mouse button.",
      "Hold the right mouse button for afterburner, and press F to raise your shield.",
      "Press 1 to 6 to choose a weapon. Fly through weapon crates to collect new ones.",
      "Fly through the portal rings to move between sectors.",
      "Press Esc to pause and M to mute.",
    ],
    tips: [
      "Use afterburner to get out of trouble or to close on a target, not as your default speed.",
      "Raise your shield before you enter a crowded fight, not after the first hit.",
      "Rockets lock on, so use them when a target is in front of you and keep your guns for the quick, close shots.",
      "Check which weapons you are carrying and switch with 1 to 6 instead of staying on the first one.",
    ],
  },

  "pirates-cove": {
    about:
      "Pirate's Cove is a real-time 3D sea sandbox. You sail a ship across a wide reflective ocean with a throttle and a rudder, while other ships patrol and wander the waves. Some are pirates and marauders who will hunt you, and combat is live and resolves on dice-style rolls with damage bands and critical hits. Dozens of small islands hold buried treasure, fights ashore and castaways to rescue.",
    howTo: [
      "Press W and S for throttle and A and D to steer.",
      "Press SPACE to fire a broadside at a ship in range.",
      "Sail close to an island and press E to dock.",
      "Ashore, move with WASD, press SPACE to use your blade or bow and press E to return to your ship.",
      "Dig up treasure, fight pirates ashore, drive off marauders or rescue castaways who join your crew.",
    ],
    tips: [
      "Turn your ship to face a target side-on before you fire. A broadside needs the target beside you, not in front.",
      "Do not fight everything you see. Some ships hunt you but others only wander, so choose fights that suit your ship.",
      "Islands are worth the detour. Rescued castaways add to your crew.",
      "Keep an eye on your health before you pick a fight.",
    ],
  },

  rimfall: {
    about:
      "Rimfall is a one-on-one fighter between two spinning tops in a bowl. Every hit, signature move and brace costs spin. You win a round by knocking your rival over the rim, by running them out of spin until they topple, or on a decision if both are still standing after overtime. The first to win two rounds takes the match.",
    howTo: [
      "Move with WASD or the arrow keys, and aim by pointing the mouse at the bowl floor.",
      "Press SPACE for your signature move. Each of the six spinners has a different one.",
      "Hold SHIFT to brace and resist being knocked over the lip. On a gamepad, use the left stick to move, right stick to aim, A or RT for the signature and B or LT to brace.",
      "Win rounds by ring-out, by outlasting your rival's spin, or on a decision after overtime. Win two rounds to win the match.",
      "Choose from six spinners and five bowls, and play against a computer opponent on Easy to Hard.",
    ],
    tips: [
      "Every action costs spin, so make each one count. Brace only when you are close to the rim.",
      "Each bowl has a charging pad at its centre. In your first rounds, find out what it does for your spinner.",
      "In overtime the rim sinks, so any solid hit can end the round. Be careful about where you stand.",
      "Learn the bowls. Rimeglass Flats has an icy outer ring, Spillway has a low gate at each end, Highcairn has a summit mound and Brinkfall tilts toward an open gate.",
    ],
  },

  rummikub: {
    about:
      "This is Rummikub in a calm 3D setting. The pool has 106 tiles: the numbers 1 to 13 in four colours, twice over, plus two jokers. You build tiles onto the table as groups or runs and try to empty your rack before the computer empties its own. There is no timer, with turned ivory tiles on warm felt and gentle piano.",
    howTo: [
      "A group is the same number in different colours. A run is consecutive numbers in one colour.",
      "Your first play, the initial meld, must total at least 30 points using tiles from your own rack.",
      "Click tiles in your rack to select them, then press Play to lay a valid set on the table.",
      "After your first meld, you can add spare tiles to sets already on the table. A joker can stand in for any tile.",
      "If you cannot play, press Draw to take a tile. The first player to empty their rack wins.",
    ],
    tips: [
      "Plan your initial meld around the highest numbers you hold, because 30 points is easier to reach with big tiles.",
      "Keep jokers as long as you can. A joker is most valuable when it completes a play that nothing else can.",
      "Look at the table before every turn. Adding to sets that are already there is often cheaper than starting new ones.",
      "Count the tiles. There are exactly two of each tile, so you can work out which ones are still out there.",
    ],
  },

  siegeheart: {
    about:
      "Siegeheart turns tower defense inside out. Your keep stands at the centre of the battlefield and enemy armies approach from every edge along several winding roads. You garrison the ground with Ballistae, Arcane Spires, Oil Cauldrons, Siege Crossbows, Holy Beacons and Storm Callers, and mine the roads with Rune Traps and Thorn Barricades. There are 45 levels across five fronts, and endless sieges.",
    howTo: [
      "Press a number from 1 to 8 to choose a tower, then click to place it. Shift-click places several at once.",
      "Press SPACE to start a wave once your defence is ready.",
      "Select a tower and press U to upgrade it or X to sell it. Esc cancels a placement.",
      "Left-drag pans the map, right-drag orbits and R resets the view.",
      "Defend the keep. It visibly cracks and burns as it takes damage and heals when it is repaired.",
    ],
    tips: [
      "Enemies arrive from every side, so a defence in one corner is not enough. Cover each road before you invest deeply in one.",
      "Holy Beacons repair your walls mid-battle, so keep one near the keep when a long siege begins.",
      "Use Rune Traps and Thorn Barricades to mine the roads before a wave arrives, not after.",
      "Each front ends in a multi-phase boss. Keep funds in reserve for the second half of the fight.",
    ],
  },

  skybattle: {
    about:
      "Sky Battle is a vertical platformer where you climb through endless, procedurally themed battle zones. You hop between platforms, stomp enemies and keep ascending, and every climb is different. It is a quick pick-up-and-play arcade game on a keyboard or gamepad.",
    howTo: [
      "Move with the arrow keys or WASD. Jump with Up, W or SPACE.",
      "Defeat enemies by landing on them from above.",
      "On a gamepad, move with the left stick and jump with A.",
      "Keep climbing. Each level is a new layout.",
    ],
    tips: [
      "Jump on enemies rather than walking into them. Landing on top is the way to defeat them.",
      "Look at the next platform before you jump, not at the one you are standing on.",
      "Move steadily upward. Rushing a single large jump is riskier than taking two small ones.",
    ],
  },

  "squish-keeper": {
    about:
      "Squish Keeper is a squishy toy that squishes back. Every squishy is a soft 3D body driven by a real-time soft-body simulation, so every dent and wobble is worked out as you play. Squishing and stretching fills a ring, and a full ring drops a capsule that opens to reveal one of 50 squishies in six rarities. There is no combat and no timer.",
    howTo: [
      "Click to poke the squishy and hold to squish it. Press on it and drag outward to stretch it, then let go to watch it snap back.",
      "Hold SHIFT and drag, or use two fingers on a touch screen, to pull both sides at once.",
      "Fill the ring by squishing and stretching to drop a capsule. Open it to add a new squishy to your Hoard (press H).",
      "Pick the Cut tool (key 2 or C) to slice a squishy, and Snap (key 3 or S) to take a photo against a backdrop you choose.",
      "Press ? for how to play, M to mute, F for full screen and the square brackets to switch squishy.",
    ],
    tips: [
      "Each squishy shows its odds and rarity, so you can see what is rare before you collect it.",
      "Check the daily gift and the short list of daily tasks each time you play.",
      "Holding Merge on two spare copies of a kind can turn them into something rarer.",
      "Calm effects in Settings removes camera moves, flashes and shake if you want a gentler experience.",
    ],
  },

  thronedrift: {
    about:
      "Thronedrift is a top-down arena survival game across five floating realm-boards: the Emberthrone, Glacier Court, Tempest Ring, Umbra Throne and Aurelian Bastion. You choose a Warrior, Archer or Mage and fight waves of skeletons, imps, orcs, brutes, wisps and realm champions. Chaining hits builds combo multipliers from 2x up to 32x, and the run ends at the Crown of Fire.",
    howTo: [
      "Move with WASD. Attack with J or by clicking.",
      "Use keys 1, 2 and 3 for your three abilities.",
      "As the Warrior, press TAB to swap between the two-handed weapon and sword and shield. With sword and shield, hold 3 to block.",
      "Chain hits quickly to build the combo multiplier.",
      "On a phone or tablet, use the on-screen joystick and ability buttons.",
    ],
    tips: [
      "Your three classes control space in different ways: the Warrior up close, the Archer with fan shots and arrow rain, and the Mage with fireballs, frost orbs and a ward.",
      "Keep your combo alive. A long chain is worth far more than the same hits spread out.",
      "Fire and frost change the ground itself, so use them to shape where enemies can stand.",
      "With sword and shield, a well-timed block can produce a perfect-parry pulse. It is worth learning the timing.",
    ],
  },

  "tide-breakers": {
    about:
      "Tide Breakers is a turn-based naval skirmish on open water with no grid. Each turn every ship spends actions to steer to a new position, within its speed and turn rate, and to fire its guns, within its range, firing arc and line of sight. Enemies are always visible, so it is a duel of angles and positioning. You sink the whole enemy fleet to win, against a computer opponent that manoeuvres for firing solutions.",
    howTo: [
      "Click one of your ships to select it, then click open water to drive it there.",
      "Click an enemy that is inside your ship's firing arc to fire.",
      "Press Q or E to rotate in place. Right-drag rotates the camera, WASD pans and the wheel zooms.",
      "Each ship has limited actions per turn, so choose between moving and firing.",
      "Sink every ship in the enemy fleet to win. Press Esc to pause.",
    ],
    tips: [
      "Aim to bring your guns to bear on the enemy while staying out of theirs. Position matters as much as damage.",
      "Closing the distance increases damage, but it also puts you inside their range.",
      "Your own ships can block a shot, so a friendly hull can shelter a weaker ship.",
      "Think about the next turn when you move. A ship that ends its turn broadside to the enemy fleet is the easiest target.",
    ],
  },

  understone: {
    about:
      "Understone is a 2D sandbox survival adventure set in a vast procedurally generated world. You mine ores by torchlight, craft better gear, raise a fortress and face the monsters that own the night, including bosses that will end you if you arrive unprepared. It plays with a keyboard and mouse or a gamepad.",
    howTo: [
      "Move with A and D, jump with SPACE, aim with the mouse and use your tool or weapon with the left button.",
      "Right-click to interact. Press I for the inventory, C for crafting and 1 to 0 for the hotbar.",
      "Dig down for ores, then craft stronger tools and armour from them.",
      "Build a shelter before night. Drag items to move or equip them, and press Esc to pause.",
      "On a gamepad, use the left stick to move, A to jump, the right stick to aim, RT to use and Y for the inventory.",
    ],
    tips: [
      "Get better gear before you go looking for bosses. They are tough enough to end an unprepared player.",
      "Bring light. Mining by torchlight lets you see ore and danger before you reach it.",
      "Build a safe place early and return to it when night falls.",
      "Keep your hotbar organised. Putting your most-used items on 1 to 5 saves time in a fight.",
    ],
  },

  "vector-storm": {
    about:
      "Vector Storm is a neon twin-stick arena shooter. Your ship is inside a pulsing arena where the geometry hunts you. You kite escalating swarms of vector shapes, chain score multipliers, grab power-ups and survive wave after wave. Movement and aim are separate, so you can retreat in one direction while shooting in another.",
    howTo: [
      "Move with WASD or the left stick.",
      "Aim with the mouse or the right stick.",
      "Fire with the left mouse button.",
      "Collect power-ups as they appear and keep your score multiplier going.",
      "Survive each wave and see how far you can get.",
    ],
    tips: [
      "Keep moving. Standing still in an arena of homing shapes is how most runs end.",
      "Use the twin sticks: move one way and aim another. You can retreat from the swarm while still shooting at it.",
      "Chain kills to keep the multiplier up, because a score is mostly built on long chains.",
      "Pick up power-ups when it is safe. Do not drag a crowd into a corner for one.",
    ],
  },

  wanderwild: {
    about:
      "Wanderwild is a cozy low-poly survival RPG. You choose a class - warrior, mage or ranger - gather and craft, befriend your neighbours and travel through five living biomes: meadows, swamps, dunes, frozen wastes and the molten Blight. By day you explore, and when night falls far from town, monsters come, so you fight them off with melee, spells or arrows. You can play solo or in co-op.",
    howTo: [
      "Move with WASD, run with Shift and jump with SPACE. Drag to look and scroll to zoom.",
      "Left-click to attack. Press Tab to lock on to a target.",
      "Press E to interact, C to craft, G to dig or mine, I for the inventory, M for the map and L for lore.",
      "Tame mounts, take quests and level up your hero.",
      "Press Esc to pause. Choose co-op from the menu to play with friends.",
    ],
    tips: [
      "Pick the class that matches how you want to fight: melee, spells or arrows.",
      "Travel gradually. The five biomes range from sunny meadows to frozen wastes and the molten Blight, so gather and craft before you go far.",
      "Try not to be far from town when night falls. Monsters come at night.",
      "Common, rare and epic loot drop along the way. Check your inventory regularly.",
    ],
  },

  "warboard-chess": {
    about:
      "This is classic chess in clean 3D with the complete rules: legal moves, check, checkmate, castling, en passant, under-promotion, and draws by stalemate, repetition, the fifty-move rule or insufficient material. You can play White, Black or Random against a computer opponent at six strengths, from Novice to Grandmaster, or play a friend online.",
    howTo: [
      "Click a piece, then click a highlighted square to move it.",
      "Choose White, Black or Random and a computer level before you start.",
      "Press Q or E to rotate the view by 90 degrees and R to flip sides. Rank and file coordinates always face you.",
      "Press Z to take back a move and H for a hint. You can copy your game as PGN.",
      "Choose from eight board themes. Right-drag orbits the camera, the wheel zooms and WASD pans.",
    ],
    tips: [
      "Control the centre, develop your knights and bishops early, and castle to protect your king.",
      "Before every move, ask what your opponent's last move is threatening.",
      "Start on a lower level and use the hint and take-back to learn why a move was a mistake.",
      "Online games are rated, so use the computer levels for practice before you play for rating.",
    ],
  },
};

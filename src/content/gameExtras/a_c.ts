import type { GameExtra } from "./types";

export const EXTRAS_A_C: Record<string, GameExtra> = {
  "arcane-realms": {
    about:
      "Arcane Realms is a collectible card game you can learn in a single sitting. Start with one of the ready-made decks, duel the computer on the gentlest difficulty, and once the turn structure feels natural move on to the deck builder and make a deck of your own. The five realms - Emberforge, Tidecall, Wildgrove, Dawnward and Gravemire - each play differently, so it is worth trying more than one.",
    howTo: [
      "Pick one of the ready-made decks, or open the Deck Builder and build your own. A deck can combine realms under the deck builder's two-realm rule.",
      "Choose a computer difficulty before the duel. There are three, from Squire up to the Archmage, who plans two moves ahead.",
      "Drag a card from your hand onto the table to play it. Cards cost mana, so the cards you can afford decide what you can do each turn.",
      "To attack, drag one of your creatures onto its target. A creature taps sideways when it attacks and untaps at the start of your next turn.",
      "Right-click any card to read its text and keywords. Press SPACE to move to the next phase and Esc to cancel a move you have started.",
    ],
    tips: [
      "Read the keywords before you commit a creature. Guard, Flying, Ward, Venomous and Cleave each change how combat works, and right-click shows what they do.",
      "Watch the live mana curve in the deck builder. A deck full of expensive cards leaves you with an empty table in the early turns.",
      "Traps are played face-down and fire during your opponent's turn, so they reward planning one turn ahead rather than spending everything at once.",
      "Use smart-fill to complete a half-built deck, then swap the last few cards by hand to suit your style.",
      "The collection screen has filters, so you can find every card of a realm quickly before you start building.",
    ],
  },

  ascendant: {
    about:
      "Ascendant is a first-person obstacle course where the movement is the whole game. You start in a quiet hub called the Sanctum, ringed by five portals, and climb through five worlds: Neon Dojo, Lava Foundry, Frozen Spire, Sky Temple and Prism Crown. Every hazard runs on a fixed timing, so the course that stopped you presents exactly the same pattern on the next attempt.",
    howTo: [
      "Move with WASD and look with the mouse. Hold SHIFT to sprint and CTRL to crouch.",
      "Press SPACE to jump and hold it for a higher jump. Let go early for a shorter hop.",
      "Walk off a ledge and you still have a brief moment to jump. You can also press jump slightly before you land and it will register.",
      "Press T to return to your last checkpoint, R to restart the whole stage and TAB to open stage select. The timer keeps running while you retry.",
      "Collect the orbs on the riskier line if you want a better score, and clear a world to move on to the next portal.",
    ],
    tips: [
      "Learn the rhythm instead of reacting. Crushers, blades and vanishing panels repeat on a clock, so watching one full cycle before you move saves a lot of deaths.",
      "Use variable jump height. A tap and a full hold travel different distances, and choosing between them is the core skill of the game.",
      "You have real air control, so a bad launch is often recoverable. Steer in the air instead of giving up on the jump.",
      "Wall-slides can be pushed off, which lets you chain a recovery after a missed landing.",
      "On slippery or crumbling sections slow down first. Momentum is preserved, so arriving too fast is a common way to overshoot.",
    ],
  },

  "ashwall-nights": {
    about:
      "Ashwall Nights splits each round in two. By day you manage a hilltop town, spending wood, stone and food on buildings that produce villagers and soldiers. At night you take the field yourself as a mounted Ashwarden and fight undead hordes. Survive ten nights and defeat the Nightlord, but if the Town Heart falls you lose. The game needs a keyboard and mouse.",
    howTo: [
      "Move with WASD and aim or orbit the camera with the mouse. Left-click to attack and use Q, E and R for your abilities.",
      "Press B to open the build menu, then press a number from 1 to 9 to choose a building and click to place it.",
      "Use the daytime to raise walls and rune towers and to build the barracks and houses that produce soldiers and villagers.",
      "Press N when you are ready to end the day and bring on the night. Use G for the gate and F to toggle follow.",
      "Press V to repair damaged buildings, and press Esc to pause at any time.",
    ],
    tips: [
      "The Town Heart is the only thing you cannot afford to lose. Keep your defences between it and the approach the undead take.",
      "Spend on production early. More villagers and soldiers mean more resources and a stronger line for every night that follows.",
      "Do not end the day on impulse. Finish your walls and towers first, because the night does not wait for the build queue.",
      "Repair between waves rather than during them. A broken wall is cheaper to fix in the quiet part of the day.",
    ],
  },

  backgammon: {
    about:
      "This is standard backgammon in a calm 3D setting: a walnut-and-ivory board, soft light and gentle piano. You race fifteen checkers around the board on real two-dice rolls while your opponent races the other way, and you can play against a computer opponent at four skill levels. There is no timer, so it suits a relaxed game as well as a thoughtful one.",
    howTo: [
      "The dice roll for you at the start of each turn. Rolling doubles gives you four moves of that number instead of two.",
      "Click one of your checkers, then click a highlighted point to move it. Only legal destinations are highlighted.",
      "If you leave a single checker alone on a point (a blot) and your opponent lands on it, it is hit and sent to the bar. You must re-enter it before moving anything else.",
      "When all fifteen of your checkers are in your home board, you can start bearing them off.",
      "The first player to bear off all fifteen checkers wins. Right-drag to rotate the camera and scroll to zoom.",
    ],
    tips: [
      "Try not to leave blots within reach of the opponent's checkers. A hit costs you the distance that checker had already travelled.",
      "Points with two or more checkers are safe and block your opponent. Building several points in a row makes it hard for them to get past.",
      "Doubles are worth a lot of movement, so look for the plays that use all four steps well rather than the first one that is legal.",
      "Choose a lower skill level first to learn the flow of hitting and re-entering, then raise it as the rules become automatic.",
    ],
  },

  "bastion-realms": {
    about:
      "Bastion Realms is a complete tower defense campaign: 45 levels across five realms - the Verdant Hollow, Cinder Wastes, Frostmaw Expanse, Sunken Ruins and Astral Isles - each with its own enemies, hazards, music and boss. You build and upgrade eight kinds of tower along winding paths and adapt to what each wave brings. Each realm also has an Endless mode for pushing your record.",
    howTo: [
      "Press a number from 1 to 8 to choose a tower, then click a spot beside the path to place it. Shift-click places several in a row.",
      "Click a tower to select it. Press U to upgrade it or X to sell it. Press right mouse button or Esc to cancel a placement.",
      "Look at the composition of the next wave, then press SPACE to start it when you are ready.",
      "Drag or use the mouse wheel to move the camera around the map.",
      "Finish a level to earn stars and work toward achievements.",
    ],
    tips: [
      "Enemies come armored, warded, flying, regenerating and shielded, and the tower types differ in what they counter. Mixing tower types is more reliable than stacking one.",
      "Place towers where the path curves back toward them. They get more time on target at bends than on straight runs.",
      "Boss fights summon reinforcements, raise shields and phase out of harm, so keep some area damage and spare funds for the middle of the fight.",
      "Selling and rebuilding is part of the game. If a wave shows a new enemy type, adjust before you start it.",
      "Use Endless mode to try towers you do not normally use. Nothing is at stake there beyond your own record.",
    ],
  },

  blackridge: {
    about:
      "BLACKRIDGE is a night-rain, modern-military first-person shooter set in the blacked-out harbor district of Meridian Ward. It has a one-mission campaign and three competitive modes - Skirmish 5v5, Capture the Flag and Free-for-All - across three arenas, each with ten operators per match. It plays on desktop with keyboard and mouse, and in landscape on phones and tablets with a move stick and on-screen buttons.",
    howTo: [
      "Choose Campaign for the single mission, or PVP and pick an arena and a mode before you deploy.",
      "Move with WASD, look with the mouse, fire with the left button and aim down sights with the right. Hold SHIFT to sprint and press CTRL while sprinting to slide.",
      "PVP starts you with a pistol. Walk over glowing weapon racks and the guns your victims drop to pick them up, and switch weapons with 1 to 5.",
      "String kills together without dying to earn killstreaks: a recon sweep at 3 kills, a mortar strike at 5, an airstrike at 7 and an orbital barrage at 10. Press 6, 7, 8 or 9 to call them.",
      "Hold TAB for the live scoreboard, press G to throw a grenade and F to interact.",
    ],
    tips: [
      "Each arena rewards a different style. Lanternwalk is dense blocks and arcades, Switchyard is a long covered shed between two yards, and Saltmarket is one great hall wrapped in narrow stall rows.",
      "Slide and mantle are for moving between cover, not only for speed. Use them to get from one piece of cover to the next without stopping in the open.",
      "In Capture the Flag, protect the carrier. Escorts and a runner cut off from help are the difference between a capture and a lost flag.",
      "Reload while out of sight. Fights are decided by who has the full magazine when they next meet.",
      "Cook a grenade before throwing it so it goes off closer to the target.",
    ],
  },

  "block-breaker": {
    about:
      "Block Breaker is a neon brick-breaking arcade game with smooth physics. You bounce a ball off a paddle to clear glowing rows of blocks. Each row scores higher than the last, and the ball speeds up as you progress, so the early levels teach control and the later ones test it. It is the quickest game on the site to pick up and a good first stop.",
    howTo: [
      "Move the paddle with the arrow keys or A and D. On a gamepad use the left stick.",
      "Click or press any key to launch the ball. On a gamepad press A.",
      "Bounce the ball back up with the paddle and break the blocks. Do not let the ball fall past the paddle.",
      "Clear every block to finish the level and see how many levels you can complete in a row.",
    ],
    tips: [
      "Where the ball meets the paddle changes the angle. Hitting it with the edge sends it sideways, which lets you aim at a specific block.",
      "Clear a column down the side early. A ball that gets behind the blocks can break many of them without coming back.",
      "Higher rows score more, so aim for them once you are comfortable rather than clearing only the bottom rows.",
      "As the ball speeds up, stay centred under it rather than chasing it. Small, early movements are steadier than big late ones.",
    ],
  },

  blocktooth: {
    about:
      "BLOCKTOOTH is an isometric horde-survival game in which you wake up as a tiny monster in a crosswalk and eat your way up the skyline. You grow by eating parked cars, kiosks, lamp posts, shops and finally towers, passing five size ranks. You can play solo, or in a four-player online VS match. A run lasts about 20 minutes. It is desktop only, with keyboard or gamepad.",
    howTo: [
      "Pick one of four titans: Molo the smash tank, Volt-Kite the chain assassin, Hearthback the eruption fortress or Briarwick the area-control beast. Each attacks automatically.",
      "Move with WASD or the arrow keys. Press SPACE for your titan's signature ability and SHIFT to dash.",
      "When you level up, a three-card mutation report opens. Press 1, 2 or 3 to take a card, or press R to reroll the hand.",
      "Heavy enemy attacks are painted on the ground before they land. Step out of the paint or dash through it.",
      "For online VS, use Quick Match or a four-letter room code. To warm up offline, choose VS Practice.",
    ],
    tips: [
      "Eat constantly. Growth is your main source of safety, and every size rank pulls the camera back and makes more of the city edible.",
      "Choose mutations that fit your titan. There are 158 upgrades, including cards that only certain titans can take and legendary ones.",
      "Dash is your answer to the painted warnings. Keep it ready for the boss fights instead of spending it on small groups.",
      "In VS, the leader wears the front-page crown and everyone else gets a bounty on it, so being first brings attention as well as rewards.",
      "In Final Notice there are no respawns and a condemnation ring closes in. Keep track of where the ring is and do not trade health for a small gain.",
    ],
  },

  checkers: {
    about:
      "This is standard American checkers (draughts) on a warm wooden 3D board, with no timer and gentle piano in the background. Men move diagonally forward, kings move in any direction, captures are forced, and a jump that can continue must continue. You play a computer opponent at one of four skill levels, which makes it easy to start gently and step up.",
    howTo: [
      "Click one of your pieces, then click a highlighted square to move it. Only legal squares are highlighted.",
      "If you can capture, you must. Jump an enemy piece by moving diagonally over it into the empty square behind it.",
      "If the same piece can jump again after landing, it must keep jumping. Chain captures can clear several pieces in one turn.",
      "Reach the far side of the board to crown a king, which can move forward and backward.",
      "Capture or block all of your opponent's pieces to win. Right-drag rotates the camera and the mouse wheel zooms.",
    ],
    tips: [
      "Keep your back row as long as you can. It stops the opponent from crowning easily.",
      "Control the centre of the board. Pieces there have more options and are harder to trap against the edge.",
      "Because captures are forced, you can sacrifice a piece to drag an enemy piece out of position and set up a multi-jump.",
      "Before every move, check what the forced capture would be for your opponent. Many mistakes come from giving them a jump you did not see.",
      "When you are ahead, trade pieces. When behind, avoid simple exchanges and keep the position complicated.",
    ],
  },

  "cosmic-coils": {
    about:
      "Cosmic Coils is a 3D snake-battle game played on tiny living planets. Each match drops you on a random world - Verdant meadows, Ember wastes, Glacier fields, Dune seas or the glowing Abyss - with its own terrain, sky, weather and music. You grow by collecting gems and the essence left by serpents you defeat. You can practise against computer-controlled serpents, or play real-time online with a room code or in the public arena.",
    howTo: [
      "Steer with the mouse, or with A and D. Your serpent moves on its own, so the work is in choosing the line.",
      "Hold W, the left mouse button or SPACE to boost. Boosting is faster but burns some of your mass.",
      "Press S or the right mouse button to slow down, and use the wheel to zoom the camera.",
      "Eat glowing gems to grow. Cut across a rival's path so they hit your body, and collect the essence they leave behind.",
      "Online, share a room code with friends or join the public arena from the Play Online screen.",
    ],
    tips: [
      "Boost for a purpose: to escape, or to cut someone off. Spending mass on a boost you do not need makes you smaller and easier to beat.",
      "Avoid head-first collisions. A single head-first mistake bursts your serpent, so keep your head clear of other bodies and use your own body as the trap.",
      "Weather such as blizzards, sandstorms and ember rain changes visibility, so keep a wider turning circle when you cannot see far.",
      "Your serpent grows as you eat, so a loop that was safe when you were small can trap you when you are long. Leave yourself room to turn.",
    ],
  },
};

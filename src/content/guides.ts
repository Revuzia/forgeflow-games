import { GUIDE_MORE } from "./guideMore";

// Original how-to guides. Each one is general, accurate game knowledge that is
// useful on its own, and links to the ForgeFlow games it relates to.
//
// Editing rules: no comparisons to other named games, no health or earnings
// claims, and nothing about opponents that would reveal how a match is filled.

export type GuideSection = {
  h: string;
  p?: string[];
  list?: string[];
  ordered?: boolean;
  /** common questions, shown as a short Q and A under the section heading */
  faq?: { q: string; a: string }[];
};

export type Guide = {
  slug: string;
  title: string;
  description: string;
  /** ISO date the guide was first published */
  published: string;
  topic: "Board games" | "Strategy" | "Action" | "Playing online" | "Mobile";
  intro: string;
  sections: GuideSection[];
  /** slugs of the ForgeFlow games this guide relates to (the game page links back) */
  games: string[];
};

const BASE_GUIDES: Guide[] = [
  {
    slug: "backgammon-rules-and-basic-strategy",
    title: "How to Play Backgammon: Rules, Setup and Basic Strategy",
    description:
      "A clear introduction to backgammon: the board, how checkers move, hitting and the bar, bearing off, and the handful of ideas that make beginners play better.",
    published: "2026-10-28",
    topic: "Board games",
    intro:
      "Backgammon is one of the oldest board games still played today, and it mixes luck with real decisions. The dice decide how far you can move; you decide which checkers move, and that choice is where the skill lives. This guide covers the rules in order, then the few strategic ideas that help most when you are starting out.",
    sections: [
      {
        h: "The board and the goal",
        p: [
          "The board has 24 narrow triangles called points, split into four quadrants of six. Each player has fifteen checkers and they travel in opposite directions around the board. Your last quadrant, the home board, is where you gather your checkers before you start removing them.",
          "The goal is to bring all fifteen of your checkers into your home board and then bear them off, which means take them off the board, before your opponent does.",
        ],
      },
      {
        h: "How a turn works",
        p: [
          "You roll two dice and move by the numbers shown. You can use the two numbers on two different checkers, or on the same checker one after the other. If you roll a double you play that number four times instead of two.",
          "You may not land on a point that holds two or more of your opponent's checkers. A point with a single opposing checker, called a blot, can be landed on, and doing so hits it.",
        ],
      },
      {
        h: "Hitting and the bar",
        p: [
          "A checker that is hit is placed on the bar in the middle of the board. Its owner must bring it back into play in your home board before moving anything else, using a die roll that matches an open point. If every entry point is blocked, they lose that turn.",
          "Hits are the main swing in a game, because a hit checker loses the whole distance it had travelled.",
        ],
      },
      {
        h: "Bearing off",
        p: [
          "Once all fifteen of your checkers are in your home board, you may start removing them. A roll lets you remove a checker from the point that matches the number. If there is no checker on that point, you may move a checker down by that number, and if no checker is on a higher point, you may remove one from the highest point you do have.",
        ],
      },
      {
        h: "Five ideas that help beginners",
        list: [
          "Avoid leaving blots where your opponent can reach them. The risk is greatest when they have checkers a short distance behind the blot.",
          "Make points. Two or more checkers on a point are safe and block your opponent from landing there.",
          "Build several points next to each other. A wall of points is hard to get past.",
          "Hit when it is safe. Sending an opponent's checker to the bar costs them the distance it had travelled.",
          "Count the race. Add up how many pips each side still needs to bring every checker off. When you are ahead, play safe. When behind, you need hits.",
        ],
      },
      {
        h: "Practise against the computer",
        p: [
          "The Backgammon game on ForgeFlow Games uses the standard rules described here and has four computer skill levels. Start on the lowest and concentrate on the hit-and-re-enter rhythm before you raise the level.",
        ],
      },
    ],
    games: ["backgammon"],
  },

  {
    slug: "checkers-rules-and-strategy",
    title: "Checkers (Draughts) Rules and Strategy for Beginners",
    description:
      "Learn the rules of American checkers: how pieces move, forced captures, multi-jumps and kings, plus simple strategy to stop losing pieces for nothing.",
    published: "2026-10-28",
    topic: "Board games",
    intro:
      "Checkers looks simple, but the rule that captures are forced turns every move into a small puzzle. Learn that one rule well and your play improves quickly. This guide covers the rules of American checkers, also called draughts, and gives you a short list of habits that win games.",
    sections: [
      {
        h: "Setup and movement",
        p: [
          "The game is played on the dark squares of an eight-by-eight board. Each player starts with twelve pieces on the three rows nearest them. Ordinary pieces, called men, move one square diagonally forward onto an empty square.",
        ],
      },
      {
        h: "Captures are forced",
        p: [
          "If one of your pieces is next to an enemy piece and the square behind it is empty, you can jump over it and remove it. In this version of the rules, you must capture whenever you can. If you have a choice of captures, you may pick any of them.",
          "If your piece lands on a square from which it can jump again, it must keep jumping. A chain of captures in one turn is called a multi-jump.",
        ],
      },
      {
        h: "Kings",
        p: [
          "When a man reaches the far row it becomes a king and is marked with a second piece on top. A king can move and capture diagonally in all four directions, one square at a time. Kings are much stronger than men, so crowning one is often the turning point of a game.",
        ],
      },
      {
        h: "How a game is won",
        p: [
          "You win by capturing all of your opponent's pieces or by leaving them with no legal move.",
        ],
      },
      {
        h: "Habits that win games",
        list: [
          "Keep your back-row pieces at home for as long as you can. They stop your opponent from getting kings.",
          "Control the centre. A piece in the middle has more moves and is harder to trap against the edge.",
          "Move in groups so that your pieces protect each other. A piece with a friend behind it cannot be jumped.",
          "Before each move, check what the forced capture would be for your opponent. Many beginners give away pieces because they do not look.",
          "Use the forced-capture rule. A sacrifice that forces your opponent to jump into a bad spot can set up a double or triple jump for you.",
          "When you are ahead by a piece, trade pieces. When you are behind, avoid trades and keep the game complicated.",
        ],
      },
      {
        h: "Play it on ForgeFlow Games",
        p: [
          "Our Checkers game uses these rules on a 3D wooden board and offers four skill levels against the computer, so you can start gently. You can also play a friend online.",
        ],
      },
    ],
    games: ["checkers"],
  },

  {
    slug: "chess-for-beginners",
    title: "Chess for Beginners: Rules, Opening Principles and Common Mistakes",
    description:
      "A beginner's guide to chess: how each piece moves, the special rules (castling, en passant, promotion), how a game ends and the opening principles that avoid early losses.",
    published: "2026-10-28",
    topic: "Board games",
    intro:
      "Chess has a reputation for being hard, but the rules are short and the early game follows a few clear principles. This guide walks you through the pieces, the special moves, the ways a game can end and the opening habits that keep beginners out of trouble.",
    sections: [
      {
        h: "The pieces",
        list: [
          "The king moves one square in any direction. It can never move into check.",
          "The queen moves any number of squares in a straight line, in any direction.",
          "A rook moves any number of squares along a rank or a file.",
          "A bishop moves any number of squares diagonally and always stays on the same colour of square.",
          "A knight moves in an L-shape: two squares in one direction and one square to the side. It is the only piece that can jump over others.",
          "A pawn moves forward one square, or two squares on its first move. It captures one square diagonally forward.",
        ],
      },
      {
        h: "Special rules",
        list: [
          "Castling moves the king two squares toward a rook and places the rook on the other side of the king. You can castle only if neither piece has moved, the squares between them are empty and the king is not in, passing through, or landing in check.",
          "En passant lets a pawn capture an enemy pawn that has just moved two squares and landed beside it, as if the enemy pawn had moved only one.",
          "Promotion: a pawn that reaches the far rank becomes a queen, rook, bishop or knight of your choice. Choosing something other than a queen is called under-promotion.",
        ],
      },
      {
        h: "How a game ends",
        p: [
          "Check is when a king is attacked. Checkmate is when the king is attacked and has no legal way to escape, and it wins the game. A draw can happen by stalemate (the player to move has no legal move but is not in check), by repetition of the same position, by the fifty-move rule, or when neither side has enough pieces left to checkmate.",
        ],
      },
      {
        h: "Opening principles",
        list: [
          "Control the centre with your pawns and pieces.",
          "Develop your knights and bishops early so that they take part in the game.",
          "Castle early. It protects your king and brings a rook into play.",
          "Do not move the same piece twice in the opening unless there is a reason, and do not bring out your queen too early.",
          "Before every move, ask what your opponent's last move is threatening.",
        ],
      },
      {
        h: "Common beginner mistakes",
        list: [
          "Leaving pieces undefended, so they can be captured for free.",
          "Attacking with one or two pieces and no support.",
          "Missing a simple tactic such as a fork, where one piece attacks two targets at once.",
          "Ignoring the opponent's threats while pursuing your own plan.",
        ],
      },
      {
        h: "Practise",
        p: [
          "Our Chess game offers six computer levels from Novice to Grandmaster, take-backs and hints, so you can see why a move was a mistake. You can also play a friend online.",
        ],
      },
    ],
    games: ["warboard-chess"],
  },

  {
    slug: "mahjong-solitaire-tips",
    title: "Mahjong Solitaire: How Matching Works and Tips to Clear the Board",
    description:
      "How mahjong solitaire works, what makes a tile free, how flowers and seasons match, and practical tips for clearing the classic turtle layout without getting stuck.",
    published: "2026-10-28",
    topic: "Board games",
    intro:
      "Mahjong solitaire is a quiet matching puzzle played with mahjong tiles. It is easy to learn and surprisingly easy to get stuck in, because the order in which you remove tiles matters. This guide explains the rules and gives you habits that make a clear board much more likely.",
    sections: [
      {
        h: "The layout and the tiles",
        p: [
          "A full set has 144 tiles. They are stacked into a layout, most commonly the classic turtle. The tiles include three suits (circles, bamboo and characters), the winds, the dragons, and the flowers and seasons.",
        ],
      },
      {
        h: "What makes a tile free",
        p: [
          "You can only remove a tile that is free. A tile is free when nothing sits on top of it and at least one of its left or right sides is open. A tile that is covered, or hemmed in on both sides, cannot be selected yet.",
        ],
      },
      {
        h: "How tiles match",
        p: [
          "You remove tiles in pairs. Two free tiles match when they are identical, with one exception: any flower matches any other flower, and any season matches any other season, even though their pictures differ.",
        ],
      },
      {
        h: "Tips for clearing the board",
        list: [
          "Work on the tall stacks first. Removing the tiles that cover others frees more pairs than picking at the edges.",
          "Before you remove a pair, count the copies. There are four of most tiles. If two are free and two are buried, take the pair that frees the most.",
          "Look at the ends of long rows. The end tiles are often what is holding the rest of the row hostage.",
          "Do not remove a pair just because you can. Ask which tiles it frees, and whether it buries something else.",
          "Use the hint and the shuffle when you are truly stuck. They exist to keep the game enjoyable.",
        ],
      },
      {
        h: "A solvable deal",
        p: [
          "On ForgeFlow Games every deal is generated so that it can be solved, so if you get stuck, an earlier decision was the cause. Hints are available with H, and S reshuffles the remaining tiles into a new solvable layout.",
        ],
      },
    ],
    games: ["mahjong"],
  },

  {
    slug: "rummikub-rules-explained",
    title: "Rummikub Rules Explained: Runs, Groups, Jokers and the First Meld",
    description:
      "How to play Rummikub: the tiles, what counts as a run or a group, the 30-point first meld, using jokers, and tips for emptying your rack first.",
    published: "2026-10-28",
    topic: "Board games",
    intro:
      "Rummikub is a tile-based rummy game. You build sets of numbered tiles on the table and try to be the first to play every tile in your rack. The rules are short, but there are a few details, especially the first meld, that beginners often miss. This guide covers them in order.",
    sections: [
      {
        h: "The tiles",
        p: [
          "There are 106 tiles: the numbers 1 to 13 in four colours, two copies of each, plus two jokers. At the start every player takes a rack of tiles from the pool.",
        ],
      },
      {
        h: "Runs and groups",
        list: [
          "A run is three or more consecutive numbers in the same colour, such as 4, 5 and 6 in blue.",
          "A group is three or four tiles with the same number in different colours, such as three 9s in red, blue and black.",
        ],
      },
      {
        h: "The first meld",
        p: [
          "Your first play must add up to at least 30 points, using only tiles from your own rack. A tile counts for its number, so a run of 10, 11 and 12 is worth 33. Until you have made this opening meld, you cannot add tiles to sets already on the table.",
        ],
      },
      {
        h: "Playing after your first meld",
        p: [
          "After that, you can lay down new sets and add spare tiles to sets already on the table. If you cannot play, you draw a tile and your turn ends.",
        ],
      },
      {
        h: "Jokers",
        p: [
          "A joker stands in for any tile you need it to be. It is the most flexible tile in the game, so use it wisely.",
        ],
      },
      {
        h: "Tips",
        list: [
          "Plan your first meld around your highest tiles. Thirty points is easier to reach with big numbers.",
          "Keep jokers for as long as you can. Use one when it completes a play nothing else can.",
          "Look at the table before every turn. Extending a set that is already there is often cheaper than starting a new one.",
          "Remember that there are exactly two of each tile, so you can work out which ones your opponent might still hold.",
        ],
      },
    ],
    games: ["rummikub"],
  },

  {
    slug: "how-to-play-dominoes",
    title: "How to Play Dominoes: The Double-Six Draw Game",
    description:
      "The rules of draw dominoes with a double-six set: the tiles, how to match ends, drawing from the boneyard, what happens when the game blocks and simple strategy.",
    published: "2026-10-28",
    topic: "Board games",
    intro:
      "Dominoes is among the easiest tile games to learn, and a little planning goes a long way. This guide explains draw dominoes with a standard double-six set and a handful of tips for playing it well.",
    sections: [
      {
        h: "The set",
        p: [
          "A double-six set has 28 tiles. Each tile is divided into two halves showing between zero and six pips. Every combination appears once, including the seven doubles, which have the same number on both halves.",
        ],
      },
      {
        h: "Setting up and playing",
        p: [
          "Each player takes seven tiles. The rest form the boneyard, from which you draw when you cannot play. The first tile is placed to start the line. After that, each player in turn plays a tile from their hand that matches the number at either end of the line.",
          "If you have no tile that matches, you draw from the boneyard until you get one that does, and then you play it.",
        ],
      },
      {
        h: "Winning a round",
        p: [
          "The first player to play all their tiles wins the round. If the game blocks, meaning nobody can play and the boneyard is empty, the player with the lowest total of pips left in their hand wins.",
        ],
      },
      {
        h: "Strategy",
        list: [
          "Play doubles early. A double can only be placed on a matching end, so it is easy to get stuck with one in your hand.",
          "Keep a mix of numbers. A hand that all shares one number is easy to block.",
          "Count the tiles. When most of one number has been played, you know your opponent has few left of it.",
          "Think about the ends of the line. Leave an end that suits your hand, not theirs.",
          "If a block looks likely, play your heavy tiles first, because a blocked game is decided by the lightest hand.",
        ],
      },
      {
        h: "Play against the computer",
        p: [
          "Our Dominoes game uses the double-six set on a felt table and has four computer skill levels, so you can learn the flow at your own pace.",
        ],
      },
    ],
    games: ["dominoes"],
  },

  {
    slug: "parkour-platformer-tips",
    title: "Parkour Platformer Tips: Momentum, Coyote Time and Jump Buffering",
    description:
      "How first-person and 3D platformers really work: momentum, jump height, coyote time, jump buffering and air control, with practical ways to practise each.",
    published: "2026-10-28",
    topic: "Action",
    intro:
      "Precision platformers feel hard until you understand what the controls are doing for you. Most of them use a small set of ideas that make jumping feel fair. Once you know them, you can use them on purpose. These are the ones that matter most.",
    sections: [
      {
        h: "Momentum",
        p: [
          "In a game that preserves momentum, the speed you have when you leave the ground carries through the jump. That means a running jump goes much farther than a standing one, and it also means you can arrive at a platform too fast. Practise the run-up as much as the jump itself.",
        ],
      },
      {
        h: "Variable jump height",
        p: [
          "Many platformers let you hold the jump button for a higher jump and release it early for a shorter one. This gives you control over how far you travel and how high you rise. Practise tapping and holding on a flat floor until you know the difference by feel.",
        ],
      },
      {
        h: "Coyote time",
        p: [
          "Coyote time is a brief window after you walk off a ledge in which you can still jump. It exists to make the game forgiving, and you can use it to jump a fraction later than you would expect, getting extra distance.",
        ],
      },
      {
        h: "Jump buffering",
        p: [
          "Jump buffering remembers a jump press made slightly before you land and performs it the moment you touch the ground. It makes chained jumps smooth. When a course asks for a sequence of platforms, press jump a little early instead of waiting to land.",
        ],
      },
      {
        h: "Air control",
        p: [
          "Good platformers let you steer in the air. If a jump looks bad, you can often correct it. Think of the launch as the start of the movement, not the end.",
        ],
      },
      {
        h: "How to practise",
        list: [
          "Learn the pattern first. When hazards run on a fixed clock, watch one full cycle before you move.",
          "Use checkpoints on purpose. Practise one section until it is automatic, then connect it to the next.",
          "Do not fight your sensitivity. If mouse-look makes you overshoot, lower it for precision sections.",
          "Take a short break after repeated failures. A rested player often clears in one attempt what was stuck for twenty.",
        ],
      },
      {
        h: "Try it",
        p: [
          "Ascendant is a first-person parkour game across five worlds that uses momentum, variable jump height, coyote time, jump buffering and air control. Its hazards run on a fixed clock, so every attempt shows the same timing.",
        ],
      },
    ],
    games: ["ascendant", "skybattle"],
  },

  {
    slug: "horde-survival-tips",
    title: "Horde Survival Games: How to Build a Strong Run",
    description:
      "Practical advice for wave-survival and horde games: movement, upgrades, reading telegraphed attacks and managing risk, whatever the theme.",
    published: "2026-10-28",
    topic: "Action",
    intro:
      "In a horde or wave survival game, you are always outnumbered, and the game is about staying alive and getting stronger as the numbers grow. The theme changes, from monsters to geometry, but the habits that help are the same. Here are the ones that matter most.",
    sections: [
      {
        h: "Movement is your first defence",
        p: [
          "Keep moving. Standing still lets groups of enemies surround you. Move in wide arcs so that enemies chase you in a line instead of cutting you off.",
        ],
      },
      {
        h: "Read the warnings",
        p: [
          "Strong attacks are usually telegraphed: a marker on the ground, a wind-up animation or a sound. The skill is in recognising the signal and moving before the hit, not after. Learn each warning once and it becomes automatic.",
        ],
      },
      {
        h: "Upgrades",
        list: [
          "Choose upgrades that work together. A few that support each other beat many that do not.",
          "Take defence early. A run that survives longer sees more upgrades.",
          "Use rerolls if you have them. A hand of upgrades that does not fit your build is worth replacing.",
          "Match your choices to your character. Each one has a different style, so pick upgrades that make what it does well even better.",
        ],
      },
      {
        h: "Dashes and cooldowns",
        p: [
          "An escape ability is only useful when it is ready. Do not spend your dash on a small danger and then face a large one without it. Treat cooldowns as a resource.",
        ],
      },
      {
        h: "Chains and multipliers",
        p: [
          "Score multipliers reward unbroken sequences. In a game with a combo meter, a long chain is worth far more than the same number of hits spread out, so play to keep the chain alive.",
        ],
      },
      {
        h: "Games to try",
        p: [
          "BLOCKTOOTH is an isometric game where you grow by eating the city and choose mutation cards as you level. Thronedrift is a top-down arena with three classes and combo multipliers up to 32x. Vector Storm is a neon twin-stick shooter where you kite swarms of vector shapes. Ember Sanctum is an isometric arena with named bosses and telegraphed signature attacks.",
        ],
      },
    ],
    games: ["blocktooth", "thronedrift", "vector-storm", "ember-sanctum"],
  },

  {
    slug: "tower-defense-basics",
    title: "Tower Defense Basics: Economy, Chokepoints and Counters",
    description:
      "How tower defense works and how to get better at it: spending wisely, where to place towers, matching towers to enemy types and preparing for boss waves.",
    published: "2026-10-28",
    topic: "Strategy",
    intro:
      "Tower defense games give you a limited budget and an unlimited supply of enemies. Winning comes from deciding where to spend, and that is easier when you know what to look for. This guide covers the principles that apply to nearly every game of the type.",
    sections: [
      {
        h: "Economy first",
        p: [
          "Most of these games pay you for defeating enemies and for finishing waves, so the early game is about building a defence that holds while the economy grows. Spend on what you need for the next wave, but avoid wasting funds on duplicates before you have covered the basics.",
        ],
      },
      {
        h: "Where to build",
        list: [
          "Place towers beside bends in the path. The enemies stay in range longer when the path turns toward the tower.",
          "Cover several parts of the path, not one spot. Enemies that survive the first tower should meet a second.",
          "Leave space for upgrades and for new towers when the game shows you a new enemy type.",
        ],
      },
      {
        h: "Know your enemy types",
        p: [
          "Many games include armoured enemies, flying enemies, shielded or warded enemies and enemies that regenerate. Each of them is a reason to have more than one tower type. Read the wave information before you start the wave and check that your defence can answer what is coming.",
        ],
      },
      {
        h: "Upgrade or add?",
        p: [
          "An upgrade is usually a more efficient way to add power than a new tower when your tower is already well placed. A new tower is better when you need coverage somewhere new or a different damage type. The right choice depends on what is breaking through.",
        ],
      },
      {
        h: "Boss waves",
        p: [
          "Bosses often summon more enemies, raise shields or change phase during the fight. Keep some funds in reserve and a mix of single-target and area damage so that you can respond.",
        ],
      },
      {
        h: "Games to try",
        p: [
          "Bastion Realms is a 45-level campaign across five realms with eight tower types. Siegeheart puts the keep at the centre of the map with enemies coming from every edge. Ashwall Nights combines town building by day with hero combat at night.",
        ],
      },
    ],
    games: ["bastion-realms", "siegeheart", "ashwall-nights"],
  },

  {
    slug: "deck-building-101",
    title: "Deck Building 101: Mana Curves, Synergy and Consistency",
    description:
      "How to build a good deck in a collectible card game: choosing a plan, balancing your mana curve, keeping the deck consistent and testing changes.",
    published: "2026-10-28",
    topic: "Strategy",
    intro:
      "A good deck is not the one with the strongest cards, it is the one whose cards work together and can actually be played. The principles below are common to most collectible card games and apply to building a deck from the ground up.",
    sections: [
      {
        h: "Start with a plan",
        p: [
          "Decide how your deck is going to win before you choose the cards. It might be attacking early, controlling the table, or building toward a few powerful cards. Every card in the deck should support that plan.",
        ],
      },
      {
        h: "The mana curve",
        p: [
          "The mana curve is the number of cards at each cost. A good curve has cheap cards you can play in the first turns, a middle of solid cards and a few expensive finishers. A deck that is all expensive cards leaves you doing nothing early on, and a deck of only cheap cards runs out of power.",
        ],
      },
      {
        h: "Synergy",
        p: [
          "Cards that support each other are worth more than their individual power. If several of your cards share a keyword or reward the same action, they become better as a group.",
        ],
      },
      {
        h: "Consistency",
        list: [
          "Use multiples of the cards that matter most to your plan.",
          "Do not include a card just because it is strong. Include it if it fits.",
          "Keep the deck at the minimum size allowed, so that you draw your best cards more often.",
          "Respect colour or realm limits. A deck with too many different colours cannot be played reliably.",
        ],
      },
      {
        h: "Test and adjust",
        p: [
          "Play the deck several times and take notes on which cards you did not enjoy drawing and which ones you wished you had more of. Swap one or two at a time so you can tell what changed.",
        ],
      },
      {
        h: "Try it in Arcane Realms",
        p: [
          "Arcane Realms has a full deck builder with a live mana curve, a smart-fill option to complete a deck, collection filters and a two-realm rule for combining realms. You can try a deck against a computer opponent at three difficulties.",
        ],
      },
    ],
    games: ["arcane-realms"],
  },

  {
    slug: "naval-tactics-basics",
    title: "Naval Tactics Games: Angles, Range and Searching for Hidden Ships",
    description:
      "Practical advice for turn-based and real-time naval games: positioning, firing arcs, search patterns for hidden fleets and when to commit to an attack.",
    published: "2026-10-28",
    topic: "Strategy",
    intro:
      "Naval games reward patience and geometry. Whether you are searching a hidden grid or steering a fleet across open water, a few habits make a large difference. These ideas apply across the naval games on ForgeFlow Games.",
    sections: [
      {
        h: "Searching for hidden ships",
        list: [
          "Search in a spread-out pattern first, rather than firing at neighbouring squares. It covers more water and finds ships faster.",
          "After a hit, probe the squares beside it. The rest of the ship is next to the hit.",
          "Remember how long ships are. When a gap is smaller than your smallest remaining enemy ship, there is no point firing into it.",
        ],
      },
      {
        h: "Placing your own fleet",
        p: [
          "Vary your layout. Ships that are always placed in the same pattern or pushed against the edge are easier to find. Leave gaps, and mix orientations.",
        ],
      },
      {
        h: "Free movement and firing arcs",
        p: [
          "When ships move freely, a gun can only fire within its arc and range. That means your position matters as much as your damage. Try to bring your guns to bear while staying out of your opponent's arc.",
        ],
      },
      {
        h: "Range and damage",
        p: [
          "Damage often rises as the distance falls, but closing in also puts you inside the enemy's range. Decide whether you are trading shots at long range or committing to a close attack, and do not drift into the space between.",
        ],
      },
      {
        h: "Use your fleet as cover",
        p: [
          "A friendly ship can block a line of fire. Positioning a strong hull between the enemy and a weak ship protects it for a turn.",
        ],
      },
      {
        h: "Games to try",
        p: [
          "Iron Tide is a duel between hidden fleets with one-use upgrades earned by sinking ships. Tide Breakers is a turn-based skirmish on open water with no grid. Pirate's Cove is a real-time sandbox where you sail, fight and dock at islands.",
        ],
      },
    ],
    games: ["iron-tide", "tide-breakers", "pirates-cove"],
  },

  {
    slug: "play-with-friends-room-codes-quick-match",
    title: "Playing Online With Friends: Room Codes, Quick Match and Co-op",
    description:
      "How online play works on ForgeFlow Games: creating a room and sharing a four-character code, joining with a code, using Quick Match, and why you and a friend sometimes end up in different matches.",
    published: "2026-10-28",
    topic: "Playing online",
    intro:
      "Many of the games on ForgeFlow Games can be played online. They share a few common ways to find other players, and knowing the differences saves a lot of confusion when you want to play with a particular friend. This guide explains each one.",
    sections: [
      {
        h: "Create a room and share the code",
        p: [
          "This is the most reliable way to play with a specific person. Open the game's online or multiplayer screen and choose Create Room. The game gives you a short room code, typically four characters. Send the code to your friend.",
        ],
      },
      {
        h: "Join with a code",
        p: [
          "Your friend opens the same game, chooses Join Room and types the code. Some games also give you an invite link that fills in the code for you. Codes use letters and numbers, and some leave out characters that are easy to confuse, such as the letter I and the number 1.",
        ],
      },
      {
        h: "Quick Match",
        p: [
          "Quick Match puts you in a queue to find a game. It is quick and convenient, but there is no guarantee that two friends will land in the same match. Quick Match queues are usually separate for each game mode and each rule, so if you pick different options, you will not meet.",
          "To use it with a friend, both players should pick exactly the same mode and rule at about the same time. If it is important that you play together, use a room code instead.",
        ],
      },
      {
        h: "Make sure you are on the same version",
        p: [
          "Some games only match players who are running the same version. If a game has been updated while a tab was open, reload the page, because an out-of-date tab can wait in a queue that nobody else is in.",
        ],
      },
      {
        h: "Co-op and visiting",
        p: [
          "Some games are cooperative rather than competitive. In LuminaScape you can host your world and a friend can visit it. In Dungeon Forge friends build the same dungeon with you in real time and then playtest it together.",
        ],
      },
      {
        h: "Games with online play",
        p: [
          "Online play is available in DYEFIELD, HIT PARADE, BLOCKTOOTH (VS), Edge Keeper, Harpoon Pop, Cosmic Coils, Dungeon Forge, LuminaScape, Wanderwild (co-op), Chess, Checkers, Iron Tide, Tide Breakers and Arcane Realms. Look for Play Online, Multiplayer, Quick Match or Create Room on each game's menu.",
        ],
      },
    ],
    games: ["dyefield", "edge-keeper", "cosmic-coils", "dungeon-forge", "luminascape", "checkers", "warboard-chess", "iron-tide", "tide-breakers", "harpoon-pop", "hit-parade"],
  },

  {
    slug: "browser-games-on-phones-and-tablets",
    title: "Playing Browser Games on a Phone or Tablet: Controls and Performance Tips",
    description:
      "How to get the best experience from browser games on a phone or tablet: what the Mobile badges mean, using landscape and full screen, and keeping games running smoothly.",
    published: "2026-10-28",
    topic: "Mobile",
    intro:
      "Browser games work on phones and tablets, but not every game is designed for touch. Knowing what to look for before you start saves time. This guide explains how ForgeFlow Games labels touch support and gives a few tips to keep games smooth on a mobile device.",
    sections: [
      {
        h: "What the badges mean",
        p: [
          "Game cards carry a small badge. Mobile means the game has full on-screen touch controls and is playable on phones and tablets. Mobile* means partial touch controls, so some actions still need a keyboard. A game marked Desktop only needs a keyboard and mouse and will not work properly on a touch screen.",
          "On a touch device the games that will not work are dimmed and labelled instead of hidden, so you can still browse the whole catalogue.",
        ],
      },
      {
        h: "Turn the device sideways",
        p: [
          "Most action games with on-screen sticks and buttons are designed for landscape. Rotating the device gives the game more room, and keeps the controls from covering what you need to see.",
        ],
      },
      {
        h: "Use full screen",
        p: [
          "Where a game offers a full-screen button, use it. It removes browser bars and gives the game the whole display.",
        ],
      },
      {
        h: "Keep performance smooth",
        list: [
          "Close other tabs and apps before you start a 3D game.",
          "Use the quality or graphics setting if the game has one. A lower setting is smoother on older devices.",
          "Charge your device. Games that draw 3D graphics use more power than a web page.",
          "If a game is slow, reload the page. A fresh start clears memory.",
        ],
      },
      {
        h: "Board games and puzzles are the easy start",
        p: [
          "Turn-based games such as Checkers, Backgammon, Mahjong Solitaire and Rummikub are marked as fully mobile, and they ask little of a device. They are a good place to begin if you are new to playing in the browser.",
        ],
      },
    ],
    games: ["checkers", "backgammon", "mahjong", "rummikub", "squish-keeper", "harpoon-pop"],
  },
];

/** every guide, with the extra sections (worked example + common questions) from guideMore.ts merged in */
export const GUIDES: Guide[] = BASE_GUIDES.map((g) => {
  const more = GUIDE_MORE[g.slug] || [];
  const body = more.filter((s) => !s.faq);
  const faq = more.filter((s) => s.faq);
  const last = g.sections[g.sections.length - 1];
  // worked examples go before the closing section; the common questions come last
  return { ...g, sections: [...g.sections.slice(0, -1), ...body, last, ...faq] };
});

export const guideBySlug = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);

/** guides that mention a given game, for the "Related guides" block on a game page */
export const guidesForGame = (gameSlug: string): Guide[] => GUIDES.filter((g) => g.games.includes(gameSlug));

/** rough word count of a guide, used by the build-time content check */
export function guideWordCount(g: Guide): number {
  const words = (s: string) => (s.match(/[A-Za-z']{2,}/g) || []).length;
  return (
    words(g.intro) +
    g.sections.reduce((n, s) => n + words(s.h) + (s.p || []).reduce((m, t) => m + words(t), 0) + (s.list || []).reduce((m, t) => m + words(t), 0) + (s.faq || []).reduce((m, f) => m + words(f.q) + words(f.a), 0), 0)
  );
}

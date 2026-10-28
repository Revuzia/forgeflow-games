import type { GuideSection } from "./guides";

// Second half of each guide: a worked example or a longer how-to, then common
// questions. Merged into GUIDES in guides.ts (same slugs).
export const GUIDE_MORE: Record<string, GuideSection[]> = {
  "backgammon-rules-and-basic-strategy": [
    {
      h: "A worked example: hitting a blot",
      p: [
        "Suppose your opponent leaves a single checker, a blot, four pips in front of one of your checkers. Any roll with a 4 on either die lets you hit it directly. A roll of 3 and 1 can also reach it, by moving the same checker 3 and then 1, as long as the point you pass through is open. The more combinations that reach a blot, the more likely you are to hit it, and the same is true for your own blots when you are the one leaving them.",
        "This is why experienced players count the distance between their blots and enemy checkers before every move. A blot that is a long way from any enemy checker is much safer than one that is right in front of them.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "What is a pip?", a: "A pip is one step on the board, or one dot on a die. The pip count is the total number of pips each side needs to move all its checkers home and off the board. It is the quickest way to see who is winning the race." },
        { q: "Can I move a checker backward?", a: "No. Every checker moves only in the direction of your home board." },
        { q: "What if I cannot make a legal move?", a: "You lose that turn. This happens most often when a checker is on the bar and every entry point is blocked." },
        { q: "Is backgammon luck or skill?", a: "Both. The dice decide what you can do on a single turn, but over many games the player who makes better choices about hitting, blocking and safety wins more often." },
      ],
    },
  ],

  "checkers-rules-and-strategy": [
    {
      h: "A worked example: the forced-capture trap",
      p: [
        "Imagine your piece sits next to an enemy piece, with an empty square behind your piece. Your opponent has to jump it, because captures are forced. If, after that jump, their piece lands on a square where one of your other pieces can jump it and then continue over a second piece, you have traded one piece for two. This kind of sacrifice is the main tactic in checkers, and it works precisely because your opponent has no choice.",
        "The best defence is to look at every forced capture you might be giving away before you move, and to ask where the capturing piece will end up.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Can men capture backward?", a: "In American checkers, ordinary men only capture forward. Kings can capture in any diagonal direction." },
        { q: "What if I have more than one capture available?", a: "You may choose any of them. The rule is that you must capture, not that you must take the longest chain." },
        { q: "When does a man become a king?", a: "When it lands on the far row. In most rules the move ends there, and the new king waits until the next turn to move." },
        { q: "Is it better to start with a strong or a gentle opponent?", a: "Start gentle. You learn faster when you can see the consequences of a move and still have a chance of winning." },
      ],
    },
  ],

  "chess-for-beginners": [
    {
      h: "What the pieces are worth",
      p: [
        "Players use a simple point scale to decide whether a trade is good: a pawn is worth about 1, a knight or a bishop about 3, a rook about 5 and a queen about 9. The king cannot be traded, so it has no value on the scale. Trading a knight for a bishop is roughly even, but giving up a rook for a knight loses material.",
        "These are guides, not laws. A well-placed knight can be worth more than a badly placed rook, and a pawn on the verge of promotion is worth far more than one.",
      ],
    },
    {
      h: "A simple plan for your first ten moves",
      list: [
        "Move a centre pawn two squares to claim space.",
        "Bring out a knight, then the other knight, toward the centre.",
        "Develop your bishops so they have open diagonals.",
        "Castle to tuck your king away and bring a rook toward the middle.",
        "Before every move, check three things: what can your opponent capture, what is your opponent threatening, and can you make a useful capture or threat of your own.",
      ],
      ordered: true,
    },
    {
      h: "Common questions",
      faq: [
        { q: "Is stalemate a win?", a: "No, it is a draw. It happens when the player to move is not in check but has no legal move." },
        { q: "Can I castle if my king is in check?", a: "No. You also cannot castle through a square that is attacked or into check, and neither the king nor that rook may have moved before." },
        { q: "Why does a pawn sometimes capture a pawn beside it?", a: "That is en passant. It is allowed only on the move right after the enemy pawn has advanced two squares from its starting position." },
        { q: "How do I avoid blunders?", a: "Slow down at the end of your analysis and check whether the piece you are about to move was protecting anything, and whether the square you are moving to can be attacked." },
      ],
    },
  ],

  "mahjong-solitaire-tips": [
    {
      h: "Reading the layout",
      p: [
        "Before your first move, look at the whole turtle. The tall central stacks hold many tiles that are covered by others, and the long rows on each side are held in place by their end tiles. A good first move opens as many new free tiles as possible. A bad first move removes a pair that was not blocking anything.",
        "As you play, keep asking which tiles are stuck. A tile that is covered and also hemmed in on both sides will stay stuck until both the tile above it and one neighbour are gone.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Why do flowers and seasons match even when they look different?", a: "By tradition there are only single copies of each flower and season, so any flower pairs with any other flower and any season with any other season." },
        { q: "Is there a timer?", a: "Not in our version. You can take as long as you like." },
        { q: "What should I do if I think no moves are left?", a: "Use the hint to check, then shuffle. The shuffle rearranges the remaining tiles into a layout that can still be solved." },
        { q: "Is every game winnable?", a: "On ForgeFlow Games every deal is generated so that it can be solved. If you get stuck, an earlier choice was usually the cause." },
      ],
    },
  ],

  "rummikub-rules-explained": [
    {
      h: "A worked example: making your first meld",
      p: [
        "Say your rack contains a red 11, a red 12, a red 13 and a blue 9, a black 9 and an orange 9. The red run of 11, 12 and 13 is worth 36 points, which clears the 30-point requirement on its own. The three 9s in different colours are a group worth 27, so you would need to add something to them to reach 30 if you wanted to play them as your meld.",
        "You can combine several sets in one turn to reach 30, so long as every tile comes from your own rack.",
      ],
    },
    {
      h: "Rearranging the table",
      p: [
        "In the traditional rules, once you have made your first meld you may rearrange tiles already on the table, provided that every set is valid when your turn ends and you use at least one tile from your own rack. Splitting a long run in two, or taking a tile from a group of four, are common ways to free up a tile for your own play.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Can a run go around from 13 to 1?", a: "No. A run goes up from 1 to 13 and cannot wrap around." },
        { q: "How many tiles are in a group?", a: "Three or four, each of a different colour." },
        { q: "What is a joker worth in my first meld?", a: "A joker counts for the value of the tile it replaces." },
        { q: "What if I cannot play?", a: "Draw one tile and end your turn." },
      ],
    },
  ],

  "how-to-play-dominoes": [
    {
      h: "A short sample game",
      p: [
        "You hold seven tiles and the line starts with a 6-4. One end shows 6 and the other shows 4. You play a 4-2 on the 4 end, so the ends now show 6 and 2. Your opponent plays a 6-6 double on the 6 end. The ends are now 6 and 2 again, but the 6 end is a double, which means the next player to use that end needs a tile with a 6.",
        "Each turn you ask the same questions: which of my tiles fit either end, which one leaves the ends in a state that suits my hand, and which one is the hardest to place later.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "How many tiles do I start with?", a: "Seven each in the two-player draw game, with the rest in the boneyard." },
        { q: "What if the boneyard runs out and I still cannot play?", a: "You pass. If nobody can play, the game is blocked and the player with the fewest pips left wins." },
        { q: "Why play doubles early?", a: "A double only fits one number, so it can get stuck in your hand for the rest of the game. Playing it early removes that risk." },
        { q: "Can I see my opponent's tiles?", a: "No. The only information you have is the tiles on the table and the ones in your own hand, which is why counting the numbers that have been played is useful." },
      ],
    },
  ],

  "parkour-platformer-tips": [
    {
      h: "A practice routine that works",
      p: [
        "Pick one skill at a time. Spend a few minutes on running jumps until you can land them reliably. Then practise short hops with a quick tap of the jump button. Then try chaining two jumps with an early press. Each skill is simple on its own, and the difficulty comes from combining them.",
        "When you are stuck in a section, do not repeat the whole course each time. Return to the nearest checkpoint, work out the one step that fails, and practise only that step.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Why do I keep overshooting platforms?", a: "Usually because you are carrying too much speed. In games that preserve momentum, ease off the run key just before the jump, or tap instead of holding it." },
        { q: "Is it cheating to use coyote time?", a: "No. It is part of the design, and every player has it. Using it deliberately is simply good technique." },
        { q: "How do I improve my timing?", a: "Watch the hazard for a full cycle before you move, and count the rhythm. Timing improves quickly once you stop reacting and start predicting." },
        { q: "My hands get tired. What can I change?", a: "Take short breaks, and consider lowering the mouse sensitivity so that small hand movements do not turn the camera too far." },
      ],
    },
  ],

  "horde-survival-tips": [
    {
      h: "Thinking about a build",
      p: [
        "Imagine you are offered three upgrades. One raises damage, one adds a second attack and one improves your defence. The best choice depends on what your run is missing. If you are being overwhelmed, take the defence. If you are strong but slow at clearing enemies, take the damage. If your current attack has a clear weakness, such as a short range, take the upgrade that covers it.",
        "Good players make this choice by asking what will kill them next, not what looks strongest in isolation.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Should I fight or run?", a: "Both. Moving while you fight is the basic skill, and retreating to reset the crowd is often better than standing your ground." },
        { q: "How do I learn boss attacks?", a: "Watch the first wind-up and note what the warning looks like. Bosses repeat their moves, so your second attempt is much easier than your first." },
        { q: "Is it worth rerolling upgrades?", a: "Usually, when none of the offered cards fit what you already have. A reroll is cheaper than a card you do not need." },
        { q: "What makes a run end early?", a: "Standing still, using the escape ability on a small threat, and ignoring warnings are the most common causes." },
      ],
    },
  ],

  "tower-defense-basics": [
    {
      h: "Reading a wave before it starts",
      p: [
        "Many tower defense games show you what is in the next wave. Treat that as a short checklist. Count the number of enemies and note any special types: fast, armoured, flying, shielded or regenerating. Then look at your defence and ask whether it covers each type. If a flying wave is coming and none of your towers can hit flying enemies, you want to fix that before you press start, not after.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Is it better to upgrade or to build more towers?", a: "If the tower is well placed, an upgrade is usually the more efficient use of funds. If you need coverage in a new spot or a different damage type, build a new tower." },
        { q: "What if an enemy keeps leaking through?", a: "Find where it gets through and place a tower beside that part of the path. Then check whether you have a tower type that is effective against that enemy." },
        { q: "Is selling a tower a mistake?", a: "No. Selling and rebuilding is part of the game, and it is often the right call when a wave shows you that your layout does not fit." },
        { q: "How do I prepare for a boss?", a: "Keep funds in reserve and a mix of single-target and area damage. Bosses change during the fight, so you may need to adapt." },
      ],
    },
  ],

  "deck-building-101": [
    {
      h: "A sample curve to start from",
      p: [
        "A common starting point is to think of your deck in three bands. Many cheap cards that you can play in the first turns, a healthy middle of cards that do the main work, and a small number of expensive cards that win the game. If your game uses a 30-card deck, a split of roughly a third in each band is a reasonable first draft. Treat it as a draft, not a rule, and adjust it to your plan.",
        "After a few games, notice which band you wished you had more of. If you were often stuck with nothing to play early, add cheaper cards. If you ran out of ways to finish, add a stronger top end.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "How many copies of a card should I include?", a: "As many as the rules allow for the cards that are central to your plan, and fewer for situational ones. Consistency comes from repeating the cards you want to draw." },
        { q: "Is it bad to use several realms or colours?", a: "It makes the deck less consistent, which is why many games limit it. Keep to what your plan needs." },
        { q: "How do I know when a deck is finished?", a: "When you can describe in one sentence how it wins, and every card helps that sentence come true." },
        { q: "Should I copy a strong deck?", a: "It can be a good way to learn, but you will play it better if you understand why each card is there, so make small changes of your own." },
      ],
    },
  ],

  "naval-tactics-basics": [
    {
      h: "A worked example: hunting a hidden ship",
      p: [
        "Your first shot at open water lands in the middle of the sea and misses. You then fire at a square a couple of squares away, spreading your shots across the grid instead of clustering them. On your fifth shot you hit. You now fire at the four squares beside the hit. A second hit in a line tells you the direction of the ship, and you follow that line until the ship is sunk. Having sunk it, you return to your spread-out search.",
        "The idea is the same for free-movement games: look for the situation where you can bring more guns to bear than your opponent, and avoid fights where you are the one being targeted.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Is it better to fire at the edges or the middle?", a: "Ships can be anywhere, so spread your early shots, and do not spend them on squares that no remaining ship could fit in." },
        { q: "Why do enemy ships seem hard to hit in a free-movement game?", a: "Because their position changes every turn. Aim for where they will have to be, and use the firing arc to your advantage." },
        { q: "How should I use my special abilities?", a: "Save scans and sonar for when you have no leads, and use heavy attacks once you know where a ship is." },
        { q: "What is the best way to place a fleet?", a: "Vary it from game to game, and avoid always using the edges or a tight cluster." },
      ],
    },
  ],

  "play-with-friends-room-codes-quick-match": [
    {
      h: "If your friend cannot find you",
      list: [
        "Make sure you are both in the same game and on the same screen, such as Join Room or Quick Match.",
        "For a room code, check that the code is typed exactly as shown. Codes are short, so type them exactly as shown, because a single wrong character will not work.",
        "For Quick Match, check that you both picked the same mode and rule, and start the search within a short time of each other.",
        "Reload the page if the game says it needs an update, or if you have had the tab open for a long time.",
        "If a room is full, ask the host to make space, or start a new room.",
        "If one of you is on a restricted network, such as a school or workplace network, online play may be blocked. Try a different network.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Do I need an account to play online?", a: "Signing in is optional for playing. Saving achievements and records, and appearing on a leaderboard, need an account." },
        { q: "How many people can join a room?", a: "It depends on the game. Some are one-on-one, others hold several players. The room screen shows how many have joined." },
        { q: "Can I play with someone on a phone?", a: "If the game supports touch, yes. Check the Mobile badge on the game card for both of you." },
        { q: "Why is Quick Match slow?", a: "Because it waits for other players in the same queue. If you want to play now with someone in particular, create a room instead." },
      ],
    },
  ],

  "browser-games-on-phones-and-tablets": [
    {
      h: "If a game feels wrong on touch",
      list: [
        "Check the badge. A game with Mobile* only supports part of its controls with touch.",
        "Rotate to landscape. Many games hide or squash their controls in portrait.",
        "Try full screen. Browser bars can steal space and accidentally respond to your thumbs.",
        "Look for a quality setting. Lowering it can fix stuttering on older phones.",
        "If the game stops responding, reload the page. Achievements and records in a signed-in game are saved to your account.",
      ],
    },
    {
      h: "Common questions",
      faq: [
        { q: "Why are some games dimmed on my phone?", a: "They need a keyboard and mouse, so they are marked Desktop only. We still show them so that you can see everything on the site." },
        { q: "Will playing 3D games drain my battery?", a: "3D graphics use more power than a page of text, so a long session will use noticeably more battery. Keep your device charged for long sessions." },
        { q: "Can I use a controller on a tablet?", a: "Many games support the browser's gamepad feature, which works with controllers your device can pair with. Check the controls on the game page." },
        { q: "What is the easiest kind of game to start with on a phone?", a: "Turn-based board games and puzzles. They ask little of the device and work well with taps." },
      ],
    },
  ],
};

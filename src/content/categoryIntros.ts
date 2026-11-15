// A short, original introduction for each category page, so a category is more
// than a grid of cards. Written from what the games in the category really are.

export type CategoryIntro = { text: string[]; guides?: string[] };

export const CATEGORY_INTROS: Record<string, CategoryIntro> = {
  action: {
    text: [
      "Action games are about reflexes, positioning and nerve. On ForgeFlow Games this category brings together first-person and third-person shooters, arena survival and horde games, sky combat and one-on-one fighters. Most are played with a keyboard and mouse, and several also support a gamepad or touch controls.",
      "Every game page lists its controls and has a short how-to-play section and tips, so you can learn a game in a minute and spend the rest of your time playing it. If you are on a phone, look for the Mobile badge on a card before you start.",
    ],
    guides: ["horde-survival-tips", "play-with-friends-room-codes-quick-match"],
  },
  arcade: {
    text: [
      "Arcade games are quick to pick up and easy to play again. The games here are short, score-driven and built around one clear idea: steering a serpent around a tiny planet, defending your wall of a shrinking polygon, popping bubbles with a harpoon or squishing a soft toy.",
      "Several of them have a way to play with friends, either on one keyboard or online with a room code. Each game's page explains the controls and gives a few tips for your first few minutes.",
    ],
    guides: ["play-with-friends-room-codes-quick-match", "browser-games-on-phones-and-tablets"],
  },
  platformer: {
    text: [
      "Platformers test movement: how well you time a jump, read a gap and keep your momentum. This category includes a first-person parkour course across five worlds, an endless vertical climber and a neon brick-breaking game that rewards steady hands.",
      "If you want to improve at games like these, our guide to momentum, jump height and coyote time explains what the controls are doing for you and how to practise each part.",
    ],
    guides: ["parkour-platformer-tips"],
  },
  strategy: {
    text: [
      "Strategy games ask you to plan. Here you can defend a keep from every direction, build a town by day and fight for it at night, or command a fleet in a naval duel, whether on a hidden grid or open water.",
      "The games are built around decisions, not reflexes, so they reward reading the situation and thinking a step ahead. Our guides to tower defense basics and naval tactics set out the principles that apply to nearly every game of these types.",
    ],
    guides: ["tower-defense-basics", "naval-tactics-basics"],
  },
  board_game: {
    text: [
      "Classic board games, rebuilt in calm 3D with no timers: chess, checkers, backgammon, dominoes, mahjong solitaire and Rummikub, plus a fantasy collectible card game with a full deck builder. Most have computer opponents at several skill levels, so you can start gently, and several can be played against a friend online.",
      "If you are new to any of them, our guides explain the rules in plain English and give you a few habits that win games.",
    ],
    guides: ["chess-for-beginners", "checkers-rules-and-strategy", "backgammon-rules-and-basic-strategy", "deck-building-101"],
  },
  adventure: {
    text: [
      "Adventure games are about exploring. This category has a real-time pirate sandbox, where you sail an open ocean and dock at islands, and a cozy survival adventure with five biomes, crafting and co-op play.",
    ],
  },
  rpg: {
    text: [
      "Role-playing games let you grow a character and a world. This category has a 2D sandbox survival game in which you dig, craft and build a fortress to face the monsters that come out at night.",
    ],
  },
  racing: {
    text: [
      "Racing games are about speed and the perfect line. This category has a neon hover-kart racer with drifting, gadgets and five cyber arenas.",
    ],
  },
};

// Hand-written, per-game guidance shown under each game's description:
// a short "about", numbered how-to-play steps and practical tips.
//
// Rule for every entry: only say what the game actually does (the registry
// description and controls are the source). No comparisons to other games, no
// invented features, and no claims about who the opponents are in online play.
export type GameExtra = {
  /** 1-2 short paragraphs: what the game is and what a first session looks like */
  about: string;
  /** numbered steps, in the order a new player needs them */
  howTo: string[];
  /** practical advice that follows from how the game really works */
  tips: string[];
};

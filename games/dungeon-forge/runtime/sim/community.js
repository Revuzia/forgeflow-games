/**
 * Dungeon Forge — runtime/sim/community.js
 * Five hand-authored "by players" dungeons for the play-menu carousel. Pure sim
 * ops (no three.js/DOM) so the node selftest validates every one: schema-valid,
 * key/lock solvable, and the escape sim boots + ticks clean.
 *
 * Each showcases the new systems: floor textures, fire-jet / javelin / secret-pit
 * traps, explosive barrel clusters, water/lava swimming, NPCs and a finale room.
 */
import * as D from "./dungeon.js";

// tiny op helpers shared by every author below
function helpers(d) {
  return {
    F: (f, x, z, w, h, tex) => D.stampRoom(d, f, x, z, w, h, 1, tex),
    O: (f, kind, x, z, props) => D.applyOp(d, { t: "obj+", f, o: Object.assign({ kind, x, z }, props) }),
    L: (f, x, z, ct) => D.applyOp(d, { t: "cell+", f, x, z, ct }),
  };
}

export const COMMUNITY = [
  {
    key: "drowned-cellars", name: "Cellars of the Drowned King", author: "Mirella", theme: "fantasy",
    difficulty: 1, blurb: "Flooded wine cellars. Mind the tripwire by the vault.",
    build() {
      const d = D.newDungeon({ name: this.name, theme: "fantasy", difficulty: 1, author: this.author, seed: 901001 });
      const { F, O, L } = helpers(d);
      F(0, 20, 20, 7, 5, "cobble");                 // entry cellar
      O(0, "spawn", 21, 22, { rot: 1 });
      O(0, "torch", 20, 20); O(0, "torch", 26, 24);
      O(0, "npc", 25, 21, { ntype: "merchant", stock: D.SHOP_IDS.slice() });
      O(0, "decor", 20, 24, { dtype: "barrel" }); O(0, "decor", 21, 24, { dtype: "barrel" }); // 💥 by the door
      F(0, 27, 21, 4, 2, "wood");                   // plank walkway east
      O(0, "door", 28, 21, { rot: 1 });
      O(0, "trap", 29, 22, { ttype: "spikes" });
      F(0, 31, 18, 7, 8, "cobble");                 // flooded hall
      for (let x = 32; x <= 35; x++) for (let z = 20; z <= 23; z++) L(0, x, z, 3);  // WATER pool — swim it
      O(0, "torch", 31, 18); O(0, "torch", 37, 25);
      O(0, "enemy", 33, 19, { etype: "skeleton" });
      O(0, "enemy", 36, 22, { etype: "slime" });
      O(0, "key", 36, 22);                          // the slime swallowed the vault key
      O(0, "chest", 31, 25, { rot: 1 });
      F(0, 33, 26, 2, 3, "wood");                   // vault corridor south
      O(0, "door", 33, 27, { rot: 0, locked: true });
      O(0, "trap", 34, 28, { ttype: "javelin", rot: 2 }); // tripwire fires back up the corridor
      F(0, 30, 29, 8, 5, "marble");                 // the king's vault
      O(0, "torch", 30, 29); O(0, "torch", 37, 33);
      O(0, "enemy", 34, 31, { etype: "ghost" });
      O(0, "enemy", 31, 32, { etype: "spider" });
      O(0, "chest", 30, 33, { rot: 1 }); O(0, "chest", 37, 29, { rot: 3 });
      O(0, "decor", 36, 33, { dtype: "barrel" });
      O(0, "exit", 36, 31);
      O(0, "light", 33, 31, { color: "#8f6bff" });
      return d;
    },
  },
  {
    key: "ember-foundry", name: "The Ember Foundry", author: "TorchBearer99", theme: "fantasy",
    difficulty: 2, blurb: "Lava channels and fire jets. The blacksmith works late.",
    build() {
      const d = D.newDungeon({ name: this.name, theme: "fantasy", difficulty: 2, author: this.author, seed: 901002 });
      const { F, O, L } = helpers(d);
      F(0, 18, 20, 6, 6, "brick");                  // furnace hall
      O(0, "spawn", 19, 22, { rot: 1 });
      O(0, "torch", 18, 20); O(0, "torch", 23, 25);
      O(0, "npc", 22, 21, { ntype: "blacksmith" });
      O(0, "decor", 18, 25, { dtype: "barrel" });
      F(0, 24, 22, 5, 2, "brick");                  // fire-jet corridor east
      O(0, "trap", 25, 22, { ttype: "firejet", rot: 0 });  // flame washes the corridor
      O(0, "trap", 27, 23, { ttype: "firejet", rot: 2 });
      F(0, 29, 18, 8, 9, "cave");                   // the foundry floor
      for (let z = 19; z <= 25; z++) { L(0, 32, z, 2); L(0, 33, z, 2); }  // LAVA channel down the middle
      O(0, "torch", 29, 18); O(0, "torch", 36, 26);
      O(0, "enemy", 30, 21, { etype: "imp" });
      O(0, "enemy", 30, 24, { etype: "imp" });
      O(0, "enemy", 35, 20, { etype: "orc" });
      O(0, "key", 35, 20);
      O(0, "decor", 35, 24, { dtype: "barrel" }); O(0, "decor", 36, 24, { dtype: "barrel" }); O(0, "decor", 36, 23, { dtype: "barrel" }); // cluster by the orc
      O(0, "chest", 29, 26, { rot: 1 });
      F(0, 37, 21, 3, 2, "brick");                  // vault door east
      O(0, "door", 38, 21, { rot: 1, locked: true });
      F(0, 40, 18, 7, 7, "marble");                 // master smith's vault — boss
      O(0, "torch", 40, 18); O(0, "torch", 46, 24);
      O(0, "enemy", 43, 20, { etype: "cyclops", rot: 3 });
      O(0, "enemy", 41, 23, { etype: "imp" });
      O(0, "chest", 46, 18, { rot: 3 }); O(0, "chest", 40, 24, { rot: 1 });
      O(0, "trap", 44, 23, { ttype: "spikes" });
      O(0, "exit", 45, 21);
      O(0, "light", 43, 22, { color: "#ff9a3c" });
      return d;
    },
  },
  {
    key: "serpents-bathhouse", name: "The Serpent's Bathhouse", author: "Naga", theme: "fantasy",
    difficulty: 2, blurb: "Marble halls, deep pools — and the floor lies.",
    build() {
      const d = D.newDungeon({ name: this.name, theme: "fantasy", difficulty: 2, author: this.author, seed: 901003 });
      const { F, O, L } = helpers(d);
      F(0, 20, 18, 8, 6, "marble");                 // atrium
      O(0, "spawn", 21, 20, { rot: 1 });
      O(0, "torch", 20, 18); O(0, "torch", 27, 23);
      O(0, "npc", 26, 19, { ntype: "sage" });
      F(0, 23, 24, 2, 3, "marble");                 // south corridor — the floor LIES
      O(0, "trap", 23, 25, { ttype: "pit" });       // secret pit on the left tile
      F(0, 19, 27, 10, 7, "marble");                // great bath
      for (let x = 21; x <= 26; x++) for (let z = 29; z <= 32; z++) L(0, x, z, 3);  // the pool
      O(0, "torch", 19, 27); O(0, "torch", 28, 33);
      O(0, "enemy", 23, 30, { etype: "frog" });
      O(0, "enemy", 25, 31, { etype: "slime" });
      O(0, "enemy", 20, 32, { etype: "myconid" });
      O(0, "key", 25, 31);
      O(0, "chest", 19, 33, { rot: 1 });
      O(0, "decor", 28, 27, { dtype: "urn" }); O(0, "decor", 19, 28, { dtype: "pot" });
      F(0, 29, 29, 4, 2, "marble");                 // east passage
      O(0, "door", 30, 29, { rot: 1, locked: true });
      O(0, "trap", 32, 30, { ttype: "javelin", rot: 3 });
      F(0, 33, 26, 7, 8, "flagstone");              // serpent shrine — boss
      O(0, "torch", 33, 26); O(0, "torch", 39, 33);
      O(0, "trap", 35, 28, { ttype: "pit" });       // treasure guarded by a hidden hole
      O(0, "chest", 36, 28, { rot: 2 });
      O(0, "enemy", 36, 30, { etype: "cthulhu", rot: 3 });
      O(0, "enemy", 34, 32, { etype: "frog" });
      O(0, "enemy", 38, 32, { etype: "frog" });
      O(0, "exit", 39, 27);
      O(0, "light", 36, 31, { color: "#59ff9c" });
      return d;
    },
  },
  {
    key: "blackout-sector7", name: "Blackout: Sector 7", author: "VOLTA", theme: "scifi",
    difficulty: 3, blurb: "Power's out. The canisters aren't. Two decks of trouble.",
    build() {
      const d = D.newDungeon({ name: this.name, theme: "scifi", difficulty: 3, author: this.author, seed: 901004 });
      const { F, O, L } = helpers(d);
      // deck 1
      F(0, 20, 20, 6, 5);                           // airlock
      O(0, "spawn", 21, 22, { rot: 1 });
      O(0, "light", 22, 20, { color: "#37e0ff" });
      O(0, "npc", 24, 21, { ntype: "merchant", stock: ["potion", "mana", "charm"] });
      F(0, 26, 21, 4, 2);                           // service corridor
      O(0, "trap", 27, 21, { ttype: "firejet", rot: 0 });  // ruptured gas line
      F(0, 30, 18, 8, 8);                           // reactor bay
      O(0, "light", 33, 19, { color: "#ff3d81" });
      O(0, "enemy", 32, 20, { etype: "drone" });
      O(0, "enemy", 35, 23, { etype: "robot" });
      O(0, "enemy", 31, 24, { etype: "turret" });
      O(0, "key", 35, 23);
      O(0, "decor", 36, 19, { dtype: "canister" }); O(0, "decor", 37, 19, { dtype: "canister" }); O(0, "decor", 37, 20, { dtype: "canister" }); // volatile stack
      O(0, "chest", 30, 25, { rot: 1 });
      O(0, "trap", 33, 24, { ttype: "vent" });
      F(0, 33, 26, 2, 3);                           // stair shaft south
      O(0, "door", 33, 27, { rot: 0, locked: true });
      O(0, "stairs", 33, 28, { rot: 0 });           // up to deck 2 (landing 33,29)
      // deck 2
      D.applyOp(d, { t: "floor+" });
      F(1, 31, 27, 6, 5);                           // landing bay
      O(1, "light", 33, 28, { color: "#59ff9c" });
      O(1, "enemy", 32, 30, { etype: "android" });
      O(1, "decor", 36, 28, { dtype: "canister" });
      F(1, 33, 21, 2, 6);                           // dark spine north — tripwire alley
      O(1, "trap", 33, 24, { ttype: "javelin", rot: 0 });
      O(1, "trap", 34, 22, { ttype: "pit" });       // hull breach under a loose plate
      F(1, 29, 14, 9, 7);                           // command bridge — boss
      O(1, "light", 33, 15, { color: "#ff3d81" }); O(1, "light", 30, 19, { color: "#37e0ff" });
      O(1, "enemy", 33, 16, { etype: "warframe", rot: 0 });
      O(1, "enemy", 30, 18, { etype: "xenosmall" });
      O(1, "enemy", 36, 18, { etype: "xenosmall" });
      O(1, "chest", 29, 14, { rot: 1 }); O(1, "chest", 37, 14, { rot: 3 });
      O(1, "decor", 29, 20, { dtype: "canister" }); O(1, "decor", 30, 20, { dtype: "canister" });
      O(1, "exit", 33, 14);
      return d;
    },
  },
  {
    key: "gauntlet-99", name: "Gauntlet of the 99 Steps", author: "GrimJim", theme: "fantasy",
    difficulty: 3, blurb: "One long road. Everything on it wants you dead.",
    build() {
      const d = D.newDungeon({ name: this.name, theme: "fantasy", difficulty: 3, author: this.author, seed: 901005 });
      const { F, O, L } = helpers(d);
      F(0, 14, 20, 5, 4, "flagstone");              // gate
      O(0, "spawn", 15, 21, { rot: 1 });
      O(0, "torch", 14, 20); O(0, "torch", 18, 23);
      O(0, "npc", 17, 22, { ntype: "sage" });
      F(0, 19, 21, 8, 2, "cobble");                 // leg 1 — fire jets stagger the lane
      O(0, "trap", 20, 21, { ttype: "firejet", rot: 0 });
      O(0, "trap", 23, 22, { ttype: "firejet", rot: 2 });
      O(0, "trap", 25, 21, { ttype: "spikes" });
      F(0, 27, 18, 6, 6, "cave");                   // arena 1
      O(0, "torch", 27, 18); O(0, "torch", 32, 23);
      O(0, "enemy", 29, 20, { etype: "brute" });
      O(0, "enemy", 31, 22, { etype: "bat" });
      O(0, "key", 29, 20);
      O(0, "decor", 32, 18, { dtype: "barrel" }); O(0, "decor", 31, 18, { dtype: "barrel" });
      F(0, 30, 24, 2, 5, "cobble");                 // leg 2 south — javelins + a lying floor
      O(0, "door", 30, 25, { rot: 0, locked: true });
      O(0, "trap", 31, 26, { ttype: "javelin", rot: 0 });
      O(0, "trap", 30, 27, { ttype: "pit" });
      F(0, 27, 29, 8, 6, "flagstone");              // arena 2 — the long hall
      for (let x = 28; x <= 30; x++) { L(0, x, 31, 2); L(0, x, 32, 2); } // lava moat mid-hall
      // interior WOOD partition splits the hall — squeeze through its door under fire
      for (const z of [29, 30, 31, 33, 34]) D.applyOp(d, { t: "wall+", f: 0, x: 31, z, s: 1, wtype: "wood" });
      D.applyOp(d, { t: "wall+", f: 0, x: 31, z: 32, s: 1, wtype: "wood", door: true });
      O(0, "torch", 27, 29); O(0, "torch", 34, 34);
      O(0, "enemy", 29, 30, { etype: "ogre" });
      O(0, "enemy", 33, 32, { etype: "gargoyle" });
      O(0, "enemy", 28, 34, { etype: "ninja" });
      O(0, "chest", 27, 34, { rot: 1 });
      O(0, "npc", 34, 29, { ntype: "blacksmith" });
      F(0, 35, 31, 5, 2, "marble");                 // final approach
      O(0, "trap", 36, 31, { ttype: "firejet", rot: 0 });
      O(0, "trap", 38, 32, { ttype: "javelin", rot: 3 });
      F(0, 40, 28, 8, 8, "marble");                 // the summit — dragon
      O(0, "torch", 40, 28); O(0, "torch", 47, 35); O(0, "torch", 40, 35); O(0, "torch", 47, 28);
      O(0, "enemy", 43, 31, { etype: "dragon", rot: 3 });
      O(0, "enemy", 41, 34, { etype: "skull" });
      O(0, "enemy", 46, 34, { etype: "skull" });
      O(0, "chest", 40, 34, { rot: 1 }); O(0, "chest", 47, 30, { rot: 3 });
      O(0, "decor", 46, 29, { dtype: "barrel" }); O(0, "decor", 46, 28, { dtype: "barrel" });
      O(0, "exit", 45, 31);
      O(0, "light", 43, 33, { color: "#ff5566" });
      return d;
    },
  },
];

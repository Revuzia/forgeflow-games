// Thronedrift — champion controllers. Human input, bot AI, and (later) remote
// players all produce the SAME interface the sim reads, so every champion —
// human or not — plays through the identical data-driven kits.

import { rand, dist2, clamp } from "../core/util.js";

export class ControllerBase {
  moveVec() { return { x: 0, z: 0, mag: 0 }; }
  get basicHeld() { return false; }
  abilityPressed(i) { return false; }          // edge — consumed on read
  get abilityHeld() { return [false, false, false]; }
  togglePressed() { return false; }            // edge — consumed on read
  dashPressed() { return false; }              // edge — consumed on read
  jumpPressed() { return false; }              // edge — consumed on read
  aim() { return null; }                       // {x,z} world point or null
  update(dt, champ, game) {}
}

/** wraps the shared Input instance (only ever drives the local champion) */
export class PlayerController extends ControllerBase {
  constructor(input, game) { super(); this.input = input; this.game = game; }
  moveVec() { return this.input.moveVec(); }
  get basicHeld() { return this.input.basicHeld; }
  abilityPressed(i) { return this.input.abilityPressed(i); }
  get abilityHeld() { return this.input.abilityHeld; }
  togglePressed() { return this.input.togglePressed(); }
  dashPressed() { return this.input.dashPressed(); }
  jumpPressed() { return this.input.jumpPressed(); }
  aim() {
    const g = this.game, inp = this.input;
    if (!inp.pointer.down || ("ontouchstart" in window)) return null;
    g.raycaster.setFromCamera(inp.pointer, g.camera);
    if (g.raycaster.ray.intersectPlane(g.groundPlane, g._v)) return { x: g._v.x, z: g._v.z };
    return null;
  }
}

/**
 * Bot AI (last-circle pattern): a think tick writes an input struct; the
 * champion consumes it exactly like human input. Class-aware kit usage,
 * telegraph dodging, kiting for ranged classes.
 */
export class BotController extends ControllerBase {
  constructor({ skill = 1 } = {}) {
    super();
    this.skill = skill;                        // 0.6 casual … 1.2 sharp
    this._mv = { x: 0, z: 0, mag: 0 };
    this._basic = false;
    this._edges = [false, false, false];
    this._held = [false, false, false];
    this._toggle = false;
    this._dash = false;
    this._aim = null;
    this._thinkT = 0;
    this._strafeDir = Math.random() < 0.5 ? 1 : -1;
    this._strafeT = rand(1, 3);
  }

  moveVec() { return this._mv; }
  get basicHeld() { return this._basic; }
  abilityPressed(i) { const v = this._edges[i]; this._edges[i] = false; return v; }
  get abilityHeld() { return this._held; }
  togglePressed() { const v = this._toggle; this._toggle = false; return v; }
  dashPressed() { const v = this._dash; this._dash = false; return v; }
  aim() { return this._aim; }

  update(dt, c, g) {
    this._thinkT -= dt;
    this._strafeT -= dt;
    if (this._strafeT <= 0) { this._strafeDir *= -1; this._strafeT = rand(1.2, 2.8); }
    if (this._thinkT > 0) return;
    this._thinkT = rand(0.12, 0.22) / this.skill;   // reaction time

    const tgt = g.nearestHostile(c, 60);
    if (!tgt) { this._mv = { x: 0, z: 0, mag: 0 }; this._basic = false; this._aim = null; return; }

    const dx = tgt.x - c.x, dz = tgt.z - c.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const nx = dx / d, nz = dz / d;

    // class-preferred engagement range
    const kit = c.kit();
    const melee = kit.basic.type === "melee";
    const want = melee ? 2.2 : c.classId === "archer" ? 10 : 8.5;

    // steering: approach/back off + strafe; flee a bit when hurt
    let mx = 0, mz = 0;
    const hurt = c.hp / c.maxHp < 0.3;
    if (d > want + 1) { mx = nx; mz = nz; }
    else if (d < want - 1.2 || (hurt && !melee)) { mx = -nx; mz = -nz; }
    // perpendicular strafe keeps bots from being turrets
    mx += -nz * 0.7 * this._strafeDir;
    mz += nx * 0.7 * this._strafeDir;

    // dodge ground telegraphs (boss slams, rains, charge lines)
    for (const dcl of g.decals.items) {
      if (dcl.kind !== "reticle") continue;
      const dd = Math.hypot(c.x - dcl.x, c.z - dcl.z);
      if (dd < dcl.radius + 0.9) {
        const away = dd > 0.001 ? 1 / dd : 1;
        mx += (c.x - dcl.x) * away * 2.2;
        mz += (c.z - dcl.z) * away * 2.2;
      }
    }
    const m = Math.hypot(mx, mz) || 1;
    this._mv = { x: mx / m, z: mz / m, mag: 1 };

    // aim with a little human error
    const err = (1.4 - this.skill) * 0.12;
    const lead = melee ? 0 : d * 0.04;         // rough projectile lead
    this._aim = {
      x: tgt.x + (tgt.knockX || 0) * lead + rand(-err, err) * d,
      z: tgt.z + (tgt.knockZ || 0) * lead + rand(-err, err) * d,
    };

    // basic attack in range (small over-reach for melee)
    this._basic = d < (melee ? kit.basic.range + 0.6 : kit.basic.range || 15);

    // kit usage — data-driven by ability type, so any class works
    const key = c.modeKey();
    const cds = c.cds[key];
    const hostiles = g.allHostiles(c);
    const clustered = hostiles.filter((h) => dist2(h.x, h.z, tgt.x, tgt.z) < 16).length;
    for (let i = 0; i < 3; i++) {
      const def = kit.abilities[i];
      if (!def || cds[i] > 0.05) continue;
      if (Math.random() > 0.85 * this.skill) continue;   // don't machine-gun cooldowns
      let use = false;
      switch (def.type) {
        case "spin": use = clustered >= 2 && d < def.radius + 1; break;
        case "slam": use = d < def.radius * 0.8; break;
        case "rupture": use = d < def.length * 0.8 && d > 2; break;
        case "melee": use = d < def.range + 0.5; break;
        case "bash": use = d < def.range + 0.4; break;
        case "shot": use = clustered >= 2 && d < (def.range || 15); break;   // fan into groups
        case "bomb": use = d > 3 && d < (def.range || 16); break;
        case "rain": use = clustered >= 2 && d < def.range; break;
        case "ward": use = hurt; break;
        case "block": {
          // raise the shield when hurt with a hostile in front, hold briefly
          if (hurt && d < 5) { this._edges[i] = true; this._held[i] = true; setTimeout(() => { this._held[i] = false; }, 900 + Math.random() * 600); }
          break;
        }
      }
      if (use) this._edges[i] = true;
    }

    // SHIFT skill: melee lunges to close range, ranged dashes to escape
    if (c.dashCd <= 0 && Math.random() < 0.5 * this.skill) {
      if (melee && d > 4 && d < 9) this._dash = true;                       // close the gap
      else if (!melee && hurt && d < 4.5) {                                  // escape
        this._aim = { x: c.x - nx * 8, z: c.z - nz * 8 };
        this._dash = true;
      }
    }

    // warriors: prefer 2H vs crowds, sword&board when hurt in a brawl
    if (c.modeKeys.length > 1 && Math.random() < 0.02) {
      const wantMode = hurt ? "sworboard" : "twohand";
      if (c.modeKey() !== wantMode) this._toggle = true;
    }
  }
}

const BOT_NAMES = [
  "Kaelen", "Vyra", "Dorn", "Sableth", "Miriv", "Orsk", "Thessaly", "Brann",
  "Nyxa", "Corvin", "Ashka", "Ferros", "Lunet", "Gorwin", "Zephra", "Haldric",
];
let nameCursor = Math.floor(Math.random() * BOT_NAMES.length);
export function botName() { return BOT_NAMES[nameCursor++ % BOT_NAMES.length]; }
export function botClass() { return ["warrior", "archer", "mage"][Math.floor(Math.random() * 3)]; }

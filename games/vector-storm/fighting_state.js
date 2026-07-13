/**
 * fighting_state.js — Hitbox/hurtbox combat for Street Fighter / Smash-style games.
 * Per-character move lists + frame data. Data-driven, no hardcoded characters.
 *
 * API:
 *   const fighter = new Fighter({moves, hp, walkSpeed, sprite});
 *   fighter.update(delta, input); // input = {h, v, attack, special, block, jump}
 *   fighter.collide(otherFighter); // auto hit detection
 */
class Fighter {
  constructor(cfg) {
    this.x = cfg.x ?? 0; this.y = cfg.y ?? 0; this.vx = 0; this.vy = 0;
    this.hp = cfg.hp ?? 100; this.maxHp = cfg.hp ?? 100;
    this.walkSpeed = cfg.walkSpeed ?? 120;
    this.jumpForce = cfg.jumpForce ?? -420;
    this.facing = 1;
    this.state = "idle"; // idle|walk|jump|attack|block|hitstun
    this.frame = 0; this.moves = cfg.moves || this._defaultMoves();
    this.currentMove = null; this.moveTimer = 0;
    this.hitstun = 0; this.blockstun = 0;
    this.comboMeter = 0;
  }
  _defaultMoves() {
    return {
      jab:   {startup: 3, active: 3,  recovery: 8,  damage: 4,  hitbox: {x: 40, y: 0, w: 35, h: 20}, hitstun: 10, pushback: 4},
      kick:  {startup: 8, active: 4,  recovery: 15, damage: 9,  hitbox: {x: 50, y: 10, w: 45, h: 30}, hitstun: 18, pushback: 8},
      special: {startup:14, active: 6, recovery: 22, damage: 16, hitbox: {x: 60, y: 0, w: 60, h: 40}, hitstun: 25, pushback: 14, stamina_cost: 30},
    };
  }
  inputMove(name) {
    if (this.hitstun > 0 || this.blockstun > 0) return false;
    const m = this.moves[name];
    if (!m) return false;
    this.state = "attack"; this.currentMove = m;
    this.moveTimer = m.startup + m.active + m.recovery; this.frame = 0;
    return true;
  }
  update(dt, input) {
    const fdt = dt * 60;
    if (this.hitstun > 0) { this.hitstun -= fdt; this.state = "hitstun"; }
    else if (this.blockstun > 0) { this.blockstun -= fdt; }
    else if (this.state === "attack") {
      this.frame += fdt;
      if (this.frame >= this.moveTimer) { this.state = "idle"; this.currentMove = null; }
    } else {
      if (input.attack)  this.inputMove("jab");
      else if (input.special) this.inputMove("special");
      else if (Math.abs(input.h) > 0.2 && this._grounded()) { this.vx = input.h * this.walkSpeed; this.state = "walk"; this.facing = Math.sign(input.h); }
      else { this.vx *= 0.8; this.state = input.block ? "block" : "idle"; }
      if (input.jump && this._grounded()) { this.vy = this.jumpForce; this.state = "jump"; }
    }
    this.vy += 900 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.y > 400) { this.y = 400; this.vy = 0; }
  }
  _grounded() { return this.y >= 400; }
  activeHitbox() {
    if (this.state !== "attack" || !this.currentMove) return null;
    const m = this.currentMove;
    if (this.frame < m.startup || this.frame > m.startup + m.active) return null;
    return { x: this.x + m.hitbox.x * this.facing, y: this.y + m.hitbox.y, w: m.hitbox.w, h: m.hitbox.h, move: m };
  }
  hurtbox() { return { x: this.x - 20, y: this.y - 30, w: 40, h: 60 }; }
  collide(other) {
    const hb = this.activeHitbox();
    if (!hb) return null;
    const hurt = other.hurtbox();
    const overlap = !(hb.x > hurt.x + hurt.w || hb.x + hb.w < hurt.x || hb.y > hurt.y + hurt.h || hb.y + hb.h < hurt.y);
    if (!overlap) return null;
    if (other.state === "block") { other.blockstun = 8; other.vx = -hb.move.pushback * this.facing * 0.5; return {event:"blocked"}; }
    other.hp -= hb.move.damage; other.hitstun = hb.move.hitstun;
    other.vx = -hb.move.pushback * this.facing;
    this.comboMeter++;
    return { event: "hit", damage: hb.move.damage, combo: this.comboMeter };
  }
}
if (typeof window !== "undefined") window.Fighter = Fighter;

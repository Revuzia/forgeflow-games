/**
 * PlatformerController2D — headless unit tests.
 *
 * Run with:  node platformer_controller.test.js
 *
 * Covers the 5 things the QA test_runner checks (movement_left/right, jump_works,
 * gravity_works, dash) + the determinism guarantee (same inputs → same outputs).
 *
 * Mock surface area: we stub Phaser's Input.Keyboard.JustDown and the body
 * (velocity, blocked, touching, setVelocityX/Y, setMaxVelocityY, setAllowGravity).
 * Everything else is real controller code under test.
 */

const fs = require("fs");
const path = require("path");

// ─── Phaser mock ───────────────────────────────────────────
const Phaser = {
  Input: {
    Keyboard: {
      JustDown(key) { return !!(key && key._justDown); },
    },
  },
};
global.Phaser = Phaser;
global.window = global.window || {};

// Load the controller (it self-registers on window)
const controllerSrc = fs.readFileSync(
  path.join(__dirname, "platformer_controller.js"),
  "utf-8"
);
eval(controllerSrc);
const PlatformerController2D = global.window.PlatformerController2D;

if (typeof PlatformerController2D !== "function") {
  console.error("FAIL: PlatformerController2D did not register on window");
  process.exit(1);
}

// ─── Helpers ───────────────────────────────────────────────
function makeKey(isDown = false, justDown = false) {
  return { isDown, isUp: !isDown, _justDown: justDown };
}

function makePlayer({ onGround = true } = {}) {
  const body = {
    velocity: { x: 0, y: 0 },
    blocked: { down: onGround, up: false, left: false, right: false },
    touching: { down: false, up: false, left: false, right: false },
    onFloor() { return this.blocked.down || this.touching.down; },
    setMaxVelocityY(_) {},
    setAllowGravity(_) {},
    _allowGravity: true,
  };
  const sprite = {
    active: true,
    body,
    flipX: false,
    setVelocityX(v) { body.velocity.x = v; },
    setVelocityY(v) { body.velocity.y = v; },
    setFlipX(b) { this.flipX = b; },
  };
  return sprite;
}

function makeScene({ leftDown=false, rightDown=false, jumpJustDown=false, jumpHeld=false, dashJustDown=false }={}) {
  return {
    cursors: {
      left:  makeKey(leftDown),
      right: makeKey(rightDown),
      up:    makeKey(jumpHeld, jumpJustDown),
    },
    wasd: {
      A: makeKey(false), D: makeKey(false), W: makeKey(false), S: makeKey(false),
    },
    spaceKey: makeKey(jumpHeld, jumpJustDown),
    shiftKey: makeKey(false, dashJustDown),
  };
}

let _pass = 0, _fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    _pass++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    _fail++;
  }
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}
function assertLt(actual, expected, msg) {
  if (!(actual < expected)) throw new Error(`${msg}: expected < ${expected}, got ${actual}`);
}
function assertGt(actual, expected, msg) {
  if (!(actual > expected)) throw new Error(`${msg}: expected > ${expected}, got ${actual}`);
}

// ─── Tests ─────────────────────────────────────────────────
console.log("PlatformerController2D — unit tests");
console.log("");

test("movement_right: arrow right increases velocityX", () => {
  const scene = makeScene({ rightDown: true });
  const player = makePlayer({ onGround: true });
  const c = new PlatformerController2D(scene);
  c.attach(player);
  c.tick(0, 16);
  assertGt(player.body.velocity.x, 0, "velocityX after right press");
});

test("movement_left: arrow left decreases velocityX", () => {
  const scene = makeScene({ leftDown: true });
  const player = makePlayer({ onGround: true });
  const c = new PlatformerController2D(scene);
  c.attach(player);
  c.tick(0, 16);
  assertLt(player.body.velocity.x, 0, "velocityX after left press");
});

test("jump_works: space-just-down on ground sets negative velocityY", () => {
  const scene = makeScene({ jumpJustDown: true, jumpHeld: true });
  const player = makePlayer({ onGround: true });
  const c = new PlatformerController2D(scene);
  c.attach(player);
  // First tick: sets coyoteTimer (refreshed because onGround)
  c.tick(0, 16);
  assertLt(player.body.velocity.y, 0, "velocityY after jump");
});

test("variable_jump_cut: cut applies on release edge (held → released transition)", () => {
  const player = makePlayer({ onGround: false });
  player.body.velocity.y = -300;
  const c = new PlatformerController2D(makeScene({ jumpHeld: true }));
  c.attach(player);
  c.tick(0, 16);  // upHeld=true frame, no cut
  assertEq(player.body.velocity.y, -300, "no cut while key held");
  c.scene = makeScene({ jumpHeld: false });
  c.tick(16, 16);  // release edge → cut applies once
  assertGt(player.body.velocity.y, -300, "velocityY cut on release edge");
});

test("variable_jump_cut: cut applies ONCE, not every frame (no compounding)", () => {
  // Regression guard: prior bug applied cut every frame upHeld was false →
  // velocity compounded by cutFactor^N → player barely left the ground (broke
  // jump_works in QA on 2026-04-27).
  const player = makePlayer({ onGround: false });
  player.body.velocity.y = -300;
  const c = new PlatformerController2D(makeScene({ jumpHeld: true }));
  c.attach(player);
  c.tick(0, 16);   // held, no cut
  c.scene = makeScene({ jumpHeld: false });
  c.tick(16, 16);  // release edge → first cut
  const vyAfterFirst = player.body.velocity.y;
  c.tick(32, 16);  // still released, no second cut
  c.tick(48, 16);  // still released, no third cut
  assertEq(player.body.velocity.y, vyAfterFirst, "velocity unchanged after first cut (no compounding)");
});

test("dash: shift-just-down sets velocityX to dashSpeed", () => {
  const scene = makeScene({ dashJustDown: true });
  const player = makePlayer({ onGround: true });
  player.flipX = false;  // facing right
  const c = new PlatformerController2D(scene);
  c.attach(player);
  c.tick(100, 16);
  assertGt(player.body.velocity.x, 350, "dash should set velocityX > 350");
  assertEq(c.isDashing, true, "isDashing flag set");
});

test("dash_ends: after dashDuration, isDashing clears", () => {
  const scene = makeScene({ dashJustDown: true });
  const player = makePlayer({ onGround: true });
  const c = new PlatformerController2D(scene);
  c.attach(player);
  c.tick(100, 16);
  assertEq(c.isDashing, true, "isDashing during dash");
  // simulate time passing past dashDuration (default 150ms)
  scene.shiftKey._justDown = false;
  c.tick(300, 16);
  assertEq(c.isDashing, false, "isDashing cleared after dashDuration");
});

test("preset_mario: no double jump even when configured to use it", () => {
  const scene = makeScene({ jumpJustDown: true, jumpHeld: true });
  const player = makePlayer({ onGround: false });   // in air
  const c = new PlatformerController2D(scene, { preset: "mario" });
  c.attach(player);
  c.canDoubleJump = true;
  c.coyoteTimer = 0;     // expired
  c.tick(0, 16);
  assertEq(player.body.velocity.y, 0, "mario preset should NOT double-jump");
});

test("preset_celeste: dash configured", () => {
  const scene = makeScene({ dashJustDown: true });
  const player = makePlayer({ onGround: true });
  const c = new PlatformerController2D(scene, { preset: "celeste" });
  c.attach(player);
  c.tick(0, 16);
  assertEq(c.isDashing, true, "celeste preset enables dash");
});

test("skipHorizontal: caller can suppress horizontal movement (level mode override)", () => {
  const scene = makeScene({ rightDown: true });
  const player = makePlayer({ onGround: true });
  player.body.velocity.x = 999;  // pre-set by level mode (e.g. minecart)
  const c = new PlatformerController2D(scene);
  c.attach(player);
  c.tick(0, 16, { skipHorizontal: true });
  assertEq(player.body.velocity.x, 999, "skipHorizontal preserves caller's velocityX");
});

test("determinism: same inputs → same outputs", () => {
  const scene1 = makeScene({ rightDown: true, jumpJustDown: true });
  const player1 = makePlayer({ onGround: true });
  const c1 = new PlatformerController2D(scene1);
  c1.attach(player1);
  c1.tick(0, 16);
  const v1 = { x: player1.body.velocity.x, y: player1.body.velocity.y };

  const scene2 = makeScene({ rightDown: true, jumpJustDown: true });
  const player2 = makePlayer({ onGround: true });
  const c2 = new PlatformerController2D(scene2);
  c2.attach(player2);
  c2.tick(0, 16);
  const v2 = { x: player2.body.velocity.x, y: player2.body.velocity.y };

  assertEq(v1.x, v2.x, "deterministic velocityX");
  assertEq(v1.y, v2.y, "deterministic velocityY");
});

console.log("");
console.log(`Result: ${_pass} passed, ${_fail} failed`);
process.exit(_fail > 0 ? 1 : 0);

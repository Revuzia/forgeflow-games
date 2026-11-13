/**
 * TopdownController2D — headless unit tests.
 *
 * Run with:  node topdown_controller.test.cjs
 *
 * Covers: 4-direction movement, diagonal normalization, skipMovement override,
 * facing-direction persistence on idle, cardinal-direction picking.
 */

const fs = require("fs");
const path = require("path");

// No Phaser dependency in this controller (it doesn't use Phaser.Input.JustDown).
global.window = global.window || {};

const controllerSrc = fs.readFileSync(
  path.join(__dirname, "topdown_controller.js"),
  "utf-8"
);
eval(controllerSrc);
const TopdownController2D = global.window.TopdownController2D;

if (typeof TopdownController2D !== "function") {
  console.error("FAIL: TopdownController2D did not register on window");
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────
function makeKey(isDown = false) {
  return { isDown, isUp: !isDown };
}

function makePlayer() {
  const body = {
    velocity: { x: 0, y: 0 },
  };
  return {
    active: true,
    body,
    flipX: false,
    setVelocity(x, y) { body.velocity.x = x; body.velocity.y = y; },
    setVelocityX(v) { body.velocity.x = v; },
    setVelocityY(v) { body.velocity.y = v; },
    setFlipX(b) { this.flipX = b; },
  };
}

function makeScene({ left=false, right=false, up=false, down=false }={}) {
  return {
    cursors: {
      left:  makeKey(left),
      right: makeKey(right),
      up:    makeKey(up),
      down:  makeKey(down),
    },
    wasd: {
      A: makeKey(false), D: makeKey(false), W: makeKey(false), S: makeKey(false),
    },
  };
}

let _pass = 0, _fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); _pass++; }
  catch (e) { console.error(`  FAIL  ${name}`); console.error(`        ${e.message}`); _fail++; }
}
const assertEq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };
const assertCloseTo = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(`${m}: expected ~${b} (±${tol}), got ${a}`); };
const assertGt = (a, b, m) => { if (!(a > b)) throw new Error(`${m}: expected > ${b}, got ${a}`); };
const assertLt = (a, b, m) => { if (!(a < b)) throw new Error(`${m}: expected < ${b}, got ${a}`); };

console.log("TopdownController2D — unit tests\n");

// ─── 4-direction movement ────────────────────────────────────
test("right key sets positive velocityX", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ right: true }), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16);
  assertEq(p.body.velocity.x, 100, "velocityX");
  assertEq(p.body.velocity.y, 0, "velocityY");
});

test("left key sets negative velocityX", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ left: true }), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16);
  assertEq(p.body.velocity.x, -100, "velocityX");
});

test("up key sets negative velocityY (Phaser Y inverted)", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ up: true }), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16);
  assertEq(p.body.velocity.y, -100, "velocityY");
});

test("down key sets positive velocityY", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ down: true }), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16);
  assertEq(p.body.velocity.y, 100, "velocityY");
});

// ─── Diagonal normalization ──────────────────────────────────
test("diagonal (right + down) normalized to ~speed/√2 each axis", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ right: true, down: true }), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16);
  assertCloseTo(p.body.velocity.x, 70.7, 0.5, "diagonal vx");
  assertCloseTo(p.body.velocity.y, 70.7, 0.5, "diagonal vy");
  // Magnitude should equal speed (not 1.414× speed)
  const mag = Math.sqrt(p.body.velocity.x ** 2 + p.body.velocity.y ** 2);
  assertCloseTo(mag, 100, 0.5, "magnitude clamped to speed");
});

test("idle: no input → velocity zero", () => {
  const p = makePlayer();
  p.body.velocity.x = 50;  // pre-existing velocity
  p.body.velocity.y = 50;
  const c = new TopdownController2D(makeScene({}), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16);
  assertEq(p.body.velocity.x, 0, "vx zeroed");
  assertEq(p.body.velocity.y, 0, "vy zeroed");
});

// ─── Intent dict ─────────────────────────────────────────────
test("intent.cardinalDir 'right' when moving right", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ right: true }));
  c.attach(p);
  const i = c.tick(0, 16);
  assertEq(i.cardinalDir, "right", "cardinalDir");
  assertEq(i.moving, true, "moving");
});

test("intent.cardinalDir 'down' when moving down", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ down: true }));
  c.attach(p);
  const i = c.tick(0, 16);
  assertEq(i.cardinalDir, "down", "cardinalDir");
});

test("intent.facingDir persists when player stops", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ right: true }));
  c.attach(p);
  c.tick(0, 16);  // facing right
  // Now stop pressing keys
  c.scene = makeScene({});
  const i = c.tick(16, 16);
  assertEq(i.moving, false, "not moving");
  assertGt(i.facingDir.x, 0, "facingDir.x retained > 0");
});

// ─── skipMovement override ───────────────────────────────────
test("skipMovement: caller controls velocity (e.g. attacking)", () => {
  const p = makePlayer();
  p.body.velocity.x = 999;  // attack lunge
  const c = new TopdownController2D(makeScene({ right: true }), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16, { skipMovement: true });
  assertEq(p.body.velocity.x, 999, "velocityX preserved during skipMovement");
});

// ─── Speed override ──────────────────────────────────────────
test("opts.speed overrides cfg.speed for one frame (e.g. bonusSpeed)", () => {
  const p = makePlayer();
  const c = new TopdownController2D(makeScene({ right: true }), { overrides: { speed: 100 } });
  c.attach(p);
  c.tick(0, 16, { speed: 250 });
  assertEq(p.body.velocity.x, 250, "speed override applied");
});

// ─── Determinism ─────────────────────────────────────────────
test("determinism: same inputs → same outputs", () => {
  const p1 = makePlayer();
  const c1 = new TopdownController2D(makeScene({ right: true, up: true }), { overrides: { speed: 200 } });
  c1.attach(p1);
  c1.tick(0, 16);
  const p2 = makePlayer();
  const c2 = new TopdownController2D(makeScene({ right: true, up: true }), { overrides: { speed: 200 } });
  c2.attach(p2);
  c2.tick(0, 16);
  assertEq(p1.body.velocity.x, p2.body.velocity.x, "deterministic vx");
  assertEq(p1.body.velocity.y, p2.body.velocity.y, "deterministic vy");
});

console.log("");
console.log(`Result: ${_pass} passed, ${_fail} failed`);
process.exit(_fail > 0 ? 1 : 0);

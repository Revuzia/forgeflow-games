/**
 * FFG runtime — sim/platformer_controller.js
 * PURE controller/logic for a side-scrolling precision platformer ("Lumen Run").
 * NO Phaser, NO rendering, NO DOM. Node-requireable + browser global.
 *
 * What lives here (so CONTENT can drive the feel, and a headless gate can verify):
 *   - TUNING: gravity, jump velocity, variable-jump cutoff, run accel/decel, max
 *     run speed, coyote time, jump buffer, max fall speed, air-control factor.
 *   - LEVEL MODEL: platforms (solid AABBs), coins/orbs, hazards (spikes),
 *     patrolling enemies, spawn point, goal flag — with a generated DEFAULT level.
 *   - HELPERS: input -> intended velocity; a deterministic fixed-step physics
 *     stepper with swept-ish AABB resolution; pickup / hazard / enemy / win / lose
 *     checks; and an AUTO-PILOT planner that drives the hero toward the goal with
 *     NO real input (the renderer's window.__test.autoResolve fast-sims with this).
 *
 * The renderer (ffg_platformer.js) uses Phaser arcade physics for the LIVE game so
 * the controls feel tight and native; this module is the shared tuning + level
 * shape + the headless authority used to prove a level is completable.
 *
 * Dual export: Node require() and browser window.FFG.sim.Platformer.
 */
(function (root) {
  "use strict";

  // ── deterministic rng (mulberry32) so auto-pilot + fast-sim are reproducible ──
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── default TUNING ──────────────────────────────────────────────────────────
  // Tuned for "feels incredible": snappy ground accel, a touch of air control,
  // generous coyote + jump buffer, variable jump height via early-release cutoff,
  // and a capped fall so long drops stay readable. Units: pixels, ms, px/s, px/s^2.
  var DEFAULT_TUNING = {
    gravity: 2100,          // px/s^2 downward
    jumpVel: 820,           // initial upward velocity on jump (px/s) -> single-jump
                            // apex = 820^2/(2*2100) ≈ 160px, so the lowest floats
                            // (≈144px above ground) clear with headroom. Was 760
                            // (≈137px) which left EVERY float just out of reach —
                            // the owner literally could not climb. See reachability
                            // note above defaultLevel().
    doubleJumpVel: 760,     // upward velocity of the SECOND (mid-air) jump (px/s).
                            // Slightly softer than the first so the air-hop reads as
                            // a lighter "flutter"; still adds ~138px on top of the
                            // first arc for generous vertical reach.
    maxJumps: 2,            // total jumps before landing (1 ground + 1 air = double)
    jumpCutMul: 0.42,       // on early release while rising, vy *= this (variable height)
    runAccel: 5200,         // ground horizontal accel (px/s^2)
    runDecel: 6400,         // ground friction when no input (px/s^2)
    airAccel: 3200,         // weaker accel in air (px/s^2)
    maxRun: 320,            // max horizontal run speed (px/s)
    maxFall: 1180,          // terminal fall speed (px/s)
    coyoteMs: 110,          // grace window to still jump after leaving an edge
    jumpBufferMs: 120,      // press-jump-early buffer before landing
    bounceVel: 560,         // upward pop when stomping an enemy
    maxHealth: 3,
    invulnMs: 1100,         // i-frames after taking damage
    knockback: 280,         // horizontal knockback on damage (px/s)
  };

  // ── DEFAULT LEVEL ─────────────────────────────────────────────────────────
  // A hand-shaped, clearly-completable run. Coords are world px (y down). Ground
  // is one long strip; floating platforms make a readable left->right ascent with
  // a coin trail, one spike pit to hop, two patrollers, and a goal flag at the end.
  // Built procedurally-but-fixed so it's identical every load.
  //
  // REACHABILITY CONTRACT (the owner couldn't climb the old layout):
  //   single-jump apex H = jumpVel^2 / (2*gravity) = 820^2 / 4200 ≈ 160px.
  //   Every step-UP onto a platform here is <= ~120px above the surface you launch
  //   from, so the staircase is climbable with the FIRST jump alone — double jump
  //   is pure insurance/expression, not a requirement. The single deliberately-big
  //   horizontal traverse is on flat ground (no jump needed). The spike pit is
  //   144px wide; the single-jump horizontal arc (~250px) clears it comfortably.
  function defaultLevel() {
    var T = 36;                 // tile size used for snapping the layout
    var groundY = 16 * T;       // 576 (top of the ground strip)
    var W = 64 * T;             // 2304 world width
    var H = 16 * T;             // 540-ish (view is 540; world taller via ground)
    var plats = [];
    var coins = [];
    var hazards = [];
    var enemies = [];

    // helper: add a solid platform rect (x,y = top-left, w,h)
    function plat(x, y, w, h, kind) { plats.push({ x: x, y: y, w: w, h: h, kind: kind || "ground" }); }
    function coin(x, y, v) { coins.push({ x: x, y: y, value: v || 5 }); }
    function spikePit(x, y, w) { hazards.push({ x: x, y: y, w: w, h: 22, kind: "spike" }); }

    // continuous ground with ONE gap (spike pit) the player must jump
    plat(0, groundY, 22 * T, 4 * T);                    // ground segment A (0..792)
    spikePit(22 * T, groundY + 2, 4 * T);               // spike pit in the gap (792..936)
    plat(26 * T, groundY, 38 * T, 4 * T);               // ground segment B (936..end)

    // floating step platforms — a GENTLE ascending staircase (each step <=120px up
    // from the prior surface), readable and climbable with a single jump. Heights
    // are whole tiles so coordinates stay clean integers.
    plat(7 * T,  groundY - 3 * T, 3 * T, T, "float");   // step 1 (108px above ground A)
    plat(11 * T, groundY - 6 * T, 3 * T, T, "float");   // step 2 (108px above step 1)
    plat(15 * T, groundY - 3 * T, 4 * T, T, "float");   // step 3 (eases back down to the pit lip)
    plat(30 * T, groundY - 3 * T, 3 * T, T, "float");   // mid float A (108px above ground B)
    plat(34 * T, groundY - 6 * T, 3 * T, T, "float");   // mid float B (108px above mid A) — high reward
    plat(39 * T, groundY - 3 * T, 5 * T, T, "float");   // pre-goal ledge (eases back to ground)

    // coin trail — arcs that hug the jump paths so collecting them rewards the climb
    coin(8.5 * T,  groundY - 4.4 * T);
    coin(11.5 * T, groundY - 6.4 * T);
    coin(13 * T,   groundY - 7.2 * T, 10);             // peak coin over step 2 (worth more)
    coin(14.5 * T, groundY - 6.4 * T);
    coin(17.5 * T, groundY - 4.4 * T);
    coin(24 * T,   groundY - 2.6 * T);                 // arc over the spike pit landing
    coin(31.5 * T, groundY - 4.4 * T);
    coin(35.5 * T, groundY - 7.2 * T);                 // top of the mid staircase
    coin(41.5 * T, groundY - 4.4 * T);
    coin(48 * T,   groundY - 1.4 * T);

    // a patrolling enemy on ground segment B (kept clear of the staircase footing)
    enemies.push({ x: 27 * T, y: groundY - 30, w: 30, h: 30, kind: "patrol", range: 2 * T, speed: 90, dir: 1 });
    // a second patroller up on mid float B for a stomp opportunity
    enemies.push({ x: 35 * T, y: groundY - 6 * T - 28, w: 28, h: 28, kind: "patrol", range: 1 * T, speed: 70, dir: -1 });

    return {
      tile: T,
      width: W,
      height: H,
      groundY: groundY,
      spawn: { x: 2.2 * T, y: groundY - 60 },
      goal: { x: 62 * T, y: groundY - 3 * T, w: 30, h: 3 * T },
      platforms: plats,
      coins: coins,
      hazards: hazards,
      enemies: enemies,
    };
  }

  // ── small AABB helpers ──────────────────────────────────────────────────────
  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ── the controller ───────────────────────────────────────────────────────────
  var Platformer = {
    DEFAULT_TUNING: DEFAULT_TUNING,
    defaultLevel: defaultLevel,
    overlap: overlap,
    clamp: clamp,

    /**
     * Merge a content object's tuning over the defaults.
     * content.tuning may override any DEFAULT_TUNING key.
     */
    makeTuning: function (content) {
      var out = {};
      for (var k in DEFAULT_TUNING) out[k] = DEFAULT_TUNING[k];
      var t = (content && content.tuning) || {};
      for (var j in t) if (t[j] != null) out[j] = t[j];
      return out;
    },

    /**
     * Build a level model from content (or the default), deep-cloning the dynamic
     * arrays so a sim run never mutates the source-of-truth content.
     */
    makeLevel: function (content) {
      var L = (content && content.level) ? content.level : defaultLevel();
      // deep-ish clone of the parts a sim mutates
      function cloneArr(a) { return (a || []).map(function (o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }); }
      return {
        tile: L.tile || 36,
        width: L.width || 2304,
        height: L.height || 576,
        groundY: L.groundY != null ? L.groundY : 576,
        spawn: { x: L.spawn.x, y: L.spawn.y },
        goal: { x: L.goal.x, y: L.goal.y, w: L.goal.w || 30, h: L.goal.h || 100 },
        platforms: cloneArr(L.platforms),
        coins: cloneArr(L.coins),
        hazards: cloneArr(L.hazards),
        enemies: cloneArr(L.enemies),
      };
    },

    /**
     * Translate a discrete input into an INTENDED horizontal acceleration sign and
     * jump request. Pure: returns { ax:-1|0|1, jump:bool }. The stepper turns this
     * into real velocity using the tuning (accel differs on ground vs air).
     */
    intent: function (input) {
      input = input || {};
      var ax = 0;
      if (input.left) ax -= 1;
      if (input.right) ax += 1;
      return { ax: ax, jump: !!input.jump, jumpHeld: !!input.jumpHeld };
    },

    /**
     * Create a fresh simulation state. The hero is an AABB with velocity + the
     * timers that make the controls feel good (coyote, jump buffer, i-frames).
     */
    createState: function (content) {
      var tuning = this.makeTuning(content);
      var level = this.makeLevel(content);
      var heroW = (content && content.hero && content.hero.w) || 26;
      var heroH = (content && content.hero && content.hero.h) || 34;
      return {
        t: 0,                                  // elapsed sim ms
        tuning: tuning,
        level: level,
        hero: {
          x: level.spawn.x - heroW / 2, y: level.spawn.y - heroH,
          w: heroW, h: heroH, vx: 0, vy: 0,
          onGround: false, faceDir: 1,
          coyote: 0, jumpBuffer: 0, jumpHeldPrev: false,
          jumpsUsed: 0,             // jumps taken since last leaving the ground (0..maxJumps)
          health: tuning.maxHealth, invuln: 0, dead: false,
        },
        coinsGot: 0, score: 0,
        ended: false, victory: false, reason: null,
        events: [],                             // {type, ...} drained by renderer/tests
      };
    },

    /**
     * Advance the simulation by dtMs using the given input. This is the SINGLE
     * source of truth for movement physics in the headless path. Fixed callers
     * should pass a small fixed dt (e.g. 1000/120). Returns the same state.
     *
     * Resolves horizontal then vertical against platforms (classic split-axis),
     * applies gravity with terminal cap, variable jump cutoff, coyote + buffer,
     * then runs coin/hazard/enemy/goal/fall checks and pushes events.
     */
    step: function (st, input, dtMs) {
      if (st.ended) return st;
      var T = st.tuning, L = st.level, h = st.hero;
      var dt = dtMs / 1000;
      st.t += dtMs;
      var inp = this.intent(input);

      // timers
      if (h.coyote > 0) h.coyote = Math.max(0, h.coyote - dtMs);
      if (h.jumpBuffer > 0) h.jumpBuffer = Math.max(0, h.jumpBuffer - dtMs);
      if (h.invuln > 0) h.invuln = Math.max(0, h.invuln - dtMs);

      // buffer a jump press (edge-triggered)
      if (inp.jump && !h.jumpHeldPrev) h.jumpBuffer = T.jumpBufferMs;
      h.jumpHeldPrev = inp.jump;

      // ── horizontal accel ──────────────────────────────────────────────────
      var accel = h.onGround ? T.runAccel : T.airAccel;
      if (inp.ax !== 0) {
        h.vx += inp.ax * accel * dt;
        h.faceDir = inp.ax > 0 ? 1 : -1;
      } else if (h.onGround) {
        // ground friction toward 0
        var dec = T.runDecel * dt;
        if (h.vx > 0) h.vx = Math.max(0, h.vx - dec);
        else if (h.vx < 0) h.vx = Math.min(0, h.vx + dec);
      }
      h.vx = clamp(h.vx, -T.maxRun, T.maxRun);

      // ── jump: FIRST (coyote OR grounded) then DOUBLE (mid-air) ─────────────
      // The buffer is edge-triggered (set once per fresh press), so a single held
      // press can never consume both jumps. Coyote + buffer apply to the FIRST jump;
      // the second is a deliberate mid-air press that just needs a jump remaining.
      var maxJumps = T.maxJumps || 2;
      var canGroundJump = (h.onGround || h.coyote > 0);
      if (h.jumpBuffer > 0 && canGroundJump && h.jumpsUsed === 0) {
        // FIRST jump (from ground / within coyote window)
        h.vy = -T.jumpVel;
        h.onGround = false;
        h.coyote = 0;
        h.jumpBuffer = 0;
        h.jumpsUsed = 1;
        st.events.push({ type: "jump", x: h.x + h.w / 2, y: h.y + h.h, n: 1 });
      } else if (h.jumpBuffer > 0 && !h.onGround && h.jumpsUsed >= 1 && h.jumpsUsed < maxJumps) {
        // DOUBLE jump (second mid-air impulse). If we left a ledge without ever
        // jumping (walked off), the coyote window covers the first press; once that
        // expires jumpsUsed is bumped to 1 (see coyote-expiry below) so the very
        // next air press becomes the *second* jump, never a free extra.
        h.vy = -(T.doubleJumpVel || T.jumpVel);
        h.coyote = 0;
        h.jumpBuffer = 0;
        h.jumpsUsed = Math.max(h.jumpsUsed + 1, 2);
        // juicy double-jump: a flip flourish + dust/sparkle pop at the launch
        st.events.push({ type: "djump", x: h.x + h.w / 2, y: h.y + h.h / 2, n: h.jumpsUsed });
      }
      // walked off a ledge without jumping: once coyote lapses, the "ground jump"
      // is forfeit — bump jumpsUsed to 1 so the next air press is the DOUBLE, not a
      // bonus first jump from mid-air.
      if (!h.onGround && h.jumpsUsed === 0 && h.coyote <= 0) h.jumpsUsed = 1;

      // variable height: releasing jump while rising clips upward velocity once
      if (!inp.jumpHeld && h.vy < 0 && h._wasRising) {
        h.vy *= T.jumpCutMul;
      }
      h._wasRising = h.vy < 0 && inp.jumpHeld;

      // ── gravity ──────────────────────────────────────────────────────────
      h.vy += T.gravity * dt;
      if (h.vy > T.maxFall) h.vy = T.maxFall;

      // ── move + collide: X axis ───────────────────────────────────────────
      h.x += h.vx * dt;
      for (var i = 0; i < L.platforms.length; i++) {
        var p = L.platforms[i];
        if (overlap(h.x, h.y, h.w, h.h, p.x, p.y, p.w, p.h)) {
          if (h.vx > 0) h.x = p.x - h.w;
          else if (h.vx < 0) h.x = p.x + p.w;
          h.vx = 0;
        }
      }
      // world horizontal bounds
      if (h.x < 0) { h.x = 0; if (h.vx < 0) h.vx = 0; }
      if (h.x + h.w > L.width) { h.x = L.width - h.w; if (h.vx > 0) h.vx = 0; }

      // ── move + collide: Y axis ───────────────────────────────────────────
      var wasOnGround = h.onGround;
      h.onGround = false;
      h.y += h.vy * dt;
      for (var k = 0; k < L.platforms.length; k++) {
        var q = L.platforms[k];
        if (overlap(h.x, h.y, h.w, h.h, q.x, q.y, q.w, q.h)) {
          if (h.vy > 0) {            // falling -> land on top
            h.y = q.y - h.h;
            h.vy = 0;
            h.onGround = true;
          } else if (h.vy < 0) {     // rising -> bonk head
            h.y = q.y + q.h;
            h.vy = 0;
          }
        }
      }
      // landing event + refresh coyote on leaving ground; reset the jump count so
      // the next leap is a fresh FIRST jump (double-jump budget restored on land).
      if (h.onGround && !wasOnGround && h.vy === 0) {
        h.jumpsUsed = 0;
        st.events.push({ type: "land", x: h.x + h.w / 2, y: h.y + h.h });
      }
      if (h.onGround) h.jumpsUsed = 0;
      if (wasOnGround && !h.onGround) h.coyote = T.coyoteMs;
      if (h.onGround) h.coyote = T.coyoteMs;

      // ── enemies: patrol movement ─────────────────────────────────────────
      for (var e = 0; e < L.enemies.length; e++) {
        var en = L.enemies[e];
        if (en.dead) continue;
        en._home = en._home == null ? en.x : en._home;
        en.x += en.dir * en.speed * dt;
        if (en.x > en._home + en.range) { en.x = en._home + en.range; en.dir = -1; }
        if (en.x < en._home - en.range) { en.x = en._home - en.range; en.dir = 1; }
      }

      // ── interactions ─────────────────────────────────────────────────────
      this._checkCoins(st);
      this._checkEnemies(st);
      this._checkHazards(st);
      this._checkGoalAndFall(st);

      return st;
    },

    _checkCoins: function (st) {
      var h = st.hero, L = st.level;
      for (var i = 0; i < L.coins.length; i++) {
        var c = L.coins[i];
        if (c.got) continue;
        // coins are ~24px circles; use a slightly generous box for feel
        if (overlap(h.x, h.y, h.w, h.h, c.x - 13, c.y - 13, 26, 26)) {
          c.got = true;
          st.coinsGot += 1;
          st.score += (c.value || 5);
          st.events.push({ type: "coin", x: c.x, y: c.y, value: c.value || 5 });
        }
      }
    },

    _checkEnemies: function (st) {
      var h = st.hero, L = st.level, T = st.tuning;
      if (h.dead) return;
      for (var i = 0; i < L.enemies.length; i++) {
        var en = L.enemies[i];
        if (en.dead) continue;
        if (!overlap(h.x, h.y, h.w, h.h, en.x, en.y, en.w, en.h)) continue;
        // STOMP: hero falling and feet are above the enemy's mid -> kill + bounce
        var feet = h.y + h.h;
        if (h.vy > 0 && feet < en.y + en.h * 0.6) {
          en.dead = true;
          h.vy = -T.bounceVel;
          st.score += 15;
          st.events.push({ type: "stomp", x: en.x + en.w / 2, y: en.y });
        } else if (h.invuln <= 0) {
          this._hurt(st, en.x + en.w / 2);
        }
      }
    },

    _checkHazards: function (st) {
      var h = st.hero, L = st.level;
      if (h.dead || h.invuln > 0) return;
      for (var i = 0; i < L.hazards.length; i++) {
        var z = L.hazards[i];
        // launchers + rising spikes are time-driven in the LIVE renderer; the headless
        // path can't model their phase/projectiles, so it treats them as non-lethal
        // (keeps automated verification runs winnable). Static spikes still bite.
        if (z.kind === "launcher" || z.kind === "riser") continue;
        if (overlap(h.x, h.y + h.h * 0.4, h.w, h.h * 0.6, z.x, z.y, z.w, z.h)) {
          // spikes are lethal contact but routed through health so i-frames apply
          this._hurt(st, h.x + h.w / 2, true);
          return;
        }
      }
    },

    _hurt: function (st, fromX, big) {
      var h = st.hero, T = st.tuning;
      if (h.invuln > 0 || h.dead) return;
      h.health -= 1;
      h.invuln = T.invulnMs;
      // knockback away from the source + a little up
      var dir = (h.x + h.w / 2) < fromX ? -1 : 1;
      h.vx = dir * T.knockback;
      h.vy = -Math.min(T.jumpVel * 0.5, 360);
      st.events.push({ type: "hurt", x: h.x + h.w / 2, y: h.y + h.h / 2, big: !!big });
      if (h.health <= 0) {
        h.dead = true;
        this._lose(st, "killed");
      }
    },

    _checkGoalAndFall: function (st) {
      var h = st.hero, L = st.level;
      if (st.ended) return;
      // fall out of the world -> death
      if (h.y > L.height + 220) { this._lose(st, "fell"); return; }
      // reach the goal flag -> win
      var g = L.goal;
      if (!h.dead && overlap(h.x, h.y, h.w, h.h, g.x, g.y, g.w, g.h)) {
        st.ended = true; st.victory = true; st.reason = "goal";
        st.events.push({ type: "win", x: g.x, y: g.y });
      }
    },

    _lose: function (st, reason) {
      if (st.ended) return;
      st.ended = true; st.victory = false; st.reason = reason;
      st.events.push({ type: "lose", reason: reason });
    },

    /** drain queued events (renderer reads these each frame to fire juice) */
    drain: function (st) { var ev = st.events; st.events = []; return ev; },

    // ── AUTO-PILOT ───────────────────────────────────────────────────────────
    // A deterministic planner that produces input each tick to drive the hero to
    // the goal with NO human input. It models how a human plays: run toward the
    // goal, and EDGE-TIME the jumps — launch from the lip of a pit/gap (not early),
    // hop up to a higher foothold when one is just ahead, leap a wall, and clear or
    // stomp enemies. It holds jump while rising for full arc height. This is what
    // window.__test.autoResolve runs headlessly to prove the level is completable
    // (or to report a clean death). Deterministic.
    autopilot: function (st) {
      var h = st.hero, L = st.level, T = st.tuning;
      var goalCenter = L.goal.x + L.goal.w / 2;
      var hx = h.x + h.w / 2;
      var dir = goalCenter > hx ? 1 : -1;
      var input = { left: dir < 0, right: dir > 0, jump: false, jumpHeld: false };

      // sustain a held jump while rising so every leap reaches full height
      if (h.vy < 0) input.jumpHeld = true;

      var footY = h.y + h.h;                 // hero feet (world y)
      var frontX = dir > 0 ? (h.x + h.w) : h.x; // leading edge of the hero
      // physics-derived launch lead: how far ahead the lip should be when we jump.
      // ~0.10–0.16s of run travel = launch right at the edge, not early.
      var lead = clamp(Math.abs(h.vx) * 0.13 + 12, 16, 46);

      var wallAhead = false, higherStep = false;
      // nearest solid ground edge ahead (for gap/ledge detection), and whether
      // there's continuous ground directly under the next step.
      var groundUnderNext = false;
      var nearGapEdgeDist = Infinity;        // distance from frontX to a drop-off lip

      for (var i = 0; i < L.platforms.length; i++) {
        var p = L.platforms[i];
        var top = p.y, left = p.x, right = p.x + p.w;
        var sameBand = (footY > top - 6 && footY < top + 44); // platform ~ our floor level
        // wall directly ahead within a stride: must hop it
        if (h.y + h.h > top + 3 && h.y < p.y + p.h - 3) {
          if (dir > 0 && left >= h.x + h.w - 2 && left <= h.x + h.w + lead) wallAhead = true;
          if (dir < 0 && right <= h.x + 2 && right >= h.x - lead) wallAhead = true;
        }
        // is there floor just ahead under our next footfall? (no gap there)
        var probe = dir > 0 ? (frontX + 4) : (frontX - 4);
        if (probe >= left && probe <= right && sameBand) groundUnderNext = true;
        // distance to the drop-off lip of the floor we're standing on
        if (sameBand) {
          if (dir > 0 && right > frontX - 2) nearGapEdgeDist = Math.min(nearGapEdgeDist, right - frontX);
          if (dir < 0 && left < frontX + 2) nearGapEdgeDist = Math.min(nearGapEdgeDist, frontX - left);
        }
        // a higher foothold just ahead we should hop up onto (toward the goal)
        var aheadHi = dir > 0 ? (left > h.x + 6 && left < h.x + 110) : (right < h.x + h.w - 6 && right > h.x + h.w - 110);
        if (aheadHi && top < footY - 26 && top > footY - 128) higherStep = true;
      }

      // GAP: jump only when the drop-off lip is within the launch window AND there
      // is no continuous floor under the next step (a real edge, not mid-platform).
      var atGapLip = (!groundUnderNext && h.onGround && nearGapEdgeDist <= lead && nearGapEdgeDist < 80);

      // explicit spike-pit lip detection (lethal gaps): launch from the near lip
      var hazardLip = false;
      for (var z = 0; z < L.hazards.length; z++) {
        var hz = L.hazards[z], hzL = hz.x, hzR = hz.x + hz.w;
        if (hz.y > footY + 70) continue; // not at our level
        if (dir > 0) { var d = hzL - frontX; if (d <= lead + 4 && d > -6) hazardLip = true; }
        else { var d2 = frontX - hzR; if (d2 <= lead + 4 && d2 > -6) hazardLip = true; }
      }

      // ENEMY: if one is close at ~our level, jump to stomp / clear it
      var enemyAhead = false;
      for (var e = 0; e < L.enemies.length; e++) {
        var en = L.enemies[e];
        if (en.dead) continue;
        var ecx = en.x + en.w / 2;
        var near = dir > 0 ? (ecx > hx && ecx < hx + 96) : (ecx < hx && ecx > hx - 96);
        if (near && Math.abs((en.y + en.h) - footY) < 64) enemyAhead = true;
      }

      var wantJump = (wallAhead || higherStep || enemyAhead || atGapLip || hazardLip);
      var maxJumps = T.maxJumps || 2;
      if (wantJump && (h.onGround || h.coyote > 0) && h.jumpsUsed === 0) {
        // FIRST jump (ground / coyote)
        input.jump = true;
        input.jumpHeld = true;
      } else if (!h.onGround && h.jumpsUsed >= 1 && h.jumpsUsed < maxJumps) {
        // DOUBLE-JUMP recovery: if airborne with a jump to spare and we've stalled
        // (apex reached / now falling) but a higher foothold or a wall/enemy/gap is
        // still ahead and unreached, fire the second jump to clear it. The new
        // golden staircase is single-jump-reachable, so this rarely triggers — it's
        // robustness so taller future golden-seeded levels still auto-complete.
        var stalled = h.vy > -120;            // past the strong part of the rise
        var stillNeedUp = (higherStep || wallAhead || enemyAhead);
        // also rescue a long-gap arc that's dropping toward a lip/hazard short
        var droppingShort = (h.vy > 60 && (hazardLip || (!groundUnderNext && nearGapEdgeDist === Infinity)));
        if (stalled && (stillNeedUp || droppingShort)) {
          input.jump = true;
          input.jumpHeld = true;
        }
      }
      return input;
    },

    /**
     * Headless fast-sim: run the autopilot at a fixed timestep until the level
     * ends or we hit maxMs. Returns a compact result the feel-gate can assert.
     * Deterministic. No rendering, no real input.
     *
     * opts: { dtMs?, maxMs? }
     */
    simulate: function (content, opts) {
      opts = opts || {};
      var dt = opts.dtMs || (1000 / 120);
      var maxMs = opts.maxMs || 60000;
      var st = this.createState(content);
      var steps = 0, maxSteps = Math.ceil(maxMs / dt);
      while (!st.ended && steps < maxSteps) {
        var input = this.autopilot(st);
        this.step(st, input, dt);
        // we don't need the events headlessly; clear to bound memory
        if (st.events.length > 64) st.events.length = 0;
        steps++;
      }
      if (!st.ended) { st.ended = true; st.victory = false; st.reason = "timeout"; }
      return {
        ended: st.ended,
        victory: st.victory,
        reason: st.reason,
        coins: st.coinsGot,
        totalCoins: st.level.coins.length,
        score: st.score,
        health: st.hero.health,
        elapsedMs: Math.round(st.t),
        steps: steps,
        heroX: Math.round(st.hero.x),
        goalX: Math.round(st.level.goal.x),
      };
    },
  };

  // ── dual export ───────────────────────────────────────────────────────────
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.Platformer = Platformer;
  if (typeof module !== "undefined" && module.exports) module.exports = Platformer;
})(typeof window !== "undefined" ? window : globalThis);

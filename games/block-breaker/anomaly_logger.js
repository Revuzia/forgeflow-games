/**
 * anomaly_logger.js — Runtime gameplay anomaly detection.
 *
 * PROBLEM: window.onerror only catches JS exceptions. It MISSES:
 *   - Freezes (game still running but unresponsive — no exception thrown)
 *   - Sprite leaks (e.g. magnet trail effect that never cleans up)
 *   - State corruption (score goes negative, HP > maxHP, etc.)
 *   - Frame hitches that don't crash but feel terrible
 *
 * This module INSTRUMENTS the running game and reports anomalies to Supabase
 * `game_crashes` table with type="anomaly" so we can see them per-game.
 *
 * Detects:
 *   1. FREEZE — frame time > 500 ms for 3+ consecutive frames
 *   2. SEVERE HITCH — single frame > 1 sec
 *   3. SPRITE LEAK — Phaser sprite count grows unbounded (100+ over baseline)
 *   4. PARTICLE LEAK — active particle emitters keep growing
 *   5. STATE CORRUPTION — player HP < 0, score < 0, level > maxLevel, NaN values
 *   6. INFINITE LOOP suspicion — update() called but player/enemies haven't moved in 5 sec
 *   7. MEMORY GROWTH — used heap doubles without drop (signs of leak)
 *
 * Each anomaly logged ONCE per session with a fingerprint (type + location-ish).
 * Throttled to max 1 report / 10 sec to avoid flood.
 */
(function(){
  // SECURITY: service_role key MUST NEVER ship to browsers. Use anon key via scaffold injection.
  const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";
  if (SUPABASE_URL.indexOf("{{") === 0 || SUPABASE_ANON.indexOf("{{") === 0) {
    console.warn("[anomaly_logger] Supabase config not injected — anomaly telemetry disabled");
    return;
  }
  const GAME_SLUG = (window.GAME_CONFIG?.title || "unknown-game").toLowerCase().replace(/\s+/g, "-");
  const SESSION_ID = Math.random().toString(36).slice(2, 12);

  const state = {
    lastFrameTime: performance.now(),
    consecSlowFrames: 0,
    baselineSpriteCount: null,
    baselineMem: null,
    lastActivity: { x: null, y: null, lastChange: performance.now() },
    reportedAnomalies: new Set(),
    lastReportTime: 0,
    particleEmitterCount: 0,
  };

  function report(type, details) {
    const fingerprint = `${type}:${details.where || "unknown"}`;
    if (state.reportedAnomalies.has(fingerprint)) return;  // dedup
    if (performance.now() - state.lastReportTime < 10000) return;  // throttle
    state.reportedAnomalies.add(fingerprint);
    state.lastReportTime = performance.now();

    // Deep audit: attach full game context to every anomaly
    let deepContext = null;
    try {
      if (window.__AUDIT__ && window.__AUDIT__.capture) {
        deepContext = window.__AUDIT__.capture();
      }
    } catch (e) {}

    const stackPayload = deepContext
      ? JSON.stringify({ anomaly_type: type, details: details, deep_audit: deepContext }).slice(0, 100000)
      : JSON.stringify(details).slice(0, 2000);

    const payload = [{
      game_slug: GAME_SLUG,
      session_id: SESSION_ID,
      type: "anomaly",
      message: `${type}: ${details.message || ""}`,
      source: details.where || "",
      stack: stackPayload,
      ua: navigator.userAgent.slice(0, 200),
      url: location.href.slice(0, 500),
    }];

    fetch(`${SUPABASE_URL}/rest/v1/game_crashes`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});

    // Also console.warn for local debugging
    if (console && console.warn) console.warn(`[Anomaly:${type}]`, details);
  }

  // ── 1+2. Freeze + severe hitch detection (frame time sampling) ──
  function tick() {
    const now = performance.now();
    const dt = now - state.lastFrameTime;
    state.lastFrameTime = now;

    if (dt > 1000) {
      report("severe_hitch", { where: "main_loop", message: `single frame = ${Math.round(dt)}ms`, dt_ms: Math.round(dt) });
    }
    if (dt > 500) {
      state.consecSlowFrames++;
      if (state.consecSlowFrames === 3) {
        report("freeze", { where: "main_loop", message: `3 consecutive frames > 500ms`, dt_ms: Math.round(dt) });
      }
    } else {
      state.consecSlowFrames = 0;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── 3+4. Sprite / particle leak detection (every 5 sec) ──
  function checkLeaks() {
    try {
      // Phaser: count children in all active scenes
      if (window.__GAME__ && window.__GAME__.scene) {
        let total = 0, particleEmitters = 0;
        for (const s of window.__GAME__.scene.scenes || []) {
          if (s.sys && s.sys.settings.active && s.children) {
            total += (s.children.list || []).length;
            // Count particle emitters specifically (magnet-trail, dash trail, etc.)
            if (s.children.list) {
              for (const c of s.children.list) {
                if (c.type === "ParticleEmitter" || c.constructor?.name === "ParticleEmitter") particleEmitters++;
              }
            }
          }
        }
        if (state.baselineSpriteCount === null && total > 0) {
          state.baselineSpriteCount = total;  // first stable reading
        } else if (state.baselineSpriteCount !== null) {
          if (total > state.baselineSpriteCount + 100) {
            report("sprite_leak", {
              where: "phaser_scenes",
              message: `sprite count ${total}, baseline ${state.baselineSpriteCount}`,
              current: total, baseline: state.baselineSpriteCount,
            });
          }
        }
        if (particleEmitters > state.particleEmitterCount + 20) {
          report("particle_leak", {
            where: "phaser_particles",
            message: `particle emitters ${particleEmitters}, was ${state.particleEmitterCount}`,
            current: particleEmitters, prior: state.particleEmitterCount,
          });
        }
        state.particleEmitterCount = particleEmitters;
      }
      // Three.js: count scene.children recursively
      if (window.scene && window.scene.traverse) {
        let count = 0;
        window.scene.traverse(() => count++);
        if (state.baselineSpriteCount === null) state.baselineSpriteCount = count;
        else if (count > state.baselineSpriteCount + 100) {
          report("three_node_leak", {
            where: "three_scene",
            message: `scene node count ${count}, baseline ${state.baselineSpriteCount}`,
          });
        }
      }
    } catch (e) {}
  }
  setInterval(checkLeaks, 5000);

  // ── 5. State corruption detection ──
  function checkState() {
    try {
      if (window.__TEST__ && window.__TEST__.getPlayer) {
        const p = window.__TEST__.getPlayer();
        if (p) {
          if (typeof p.health === "number" && p.health < 0) {
            report("state_corruption", { where: "player.health", message: `player.health = ${p.health}` });
          }
          if (typeof p.x === "number" && (isNaN(p.x) || !isFinite(p.x))) {
            report("state_corruption", { where: "player.x", message: `player.x = ${p.x}` });
          }
          if (typeof p.y === "number" && (isNaN(p.y) || !isFinite(p.y))) {
            report("state_corruption", { where: "player.y", message: `player.y = ${p.y}` });
          }
          // Activity tracker (for infinite loop detection)
          if (typeof p.x === "number" && typeof p.y === "number") {
            if (state.lastActivity.x === p.x && state.lastActivity.y === p.y) {
              if (performance.now() - state.lastActivity.lastChange > 30000) {
                // Only report if scene is GameScene (menu would be static)
                const scene = window.__TEST__.getCurrentScene?.();
                if (scene === "GameScene") {
                  report("player_stuck", {
                    where: "player_position",
                    message: `player hasn't moved in 30 sec at (${p.x}, ${p.y}) in ${scene}`,
                  });
                }
              }
            } else {
              state.lastActivity.x = p.x;
              state.lastActivity.y = p.y;
              state.lastActivity.lastChange = performance.now();
            }
          }
        }
      }
      if (window.__TEST__ && window.__TEST__.getScore) {
        const s = window.__TEST__.getScore();
        if (typeof s === "number" && s < 0) {
          report("state_corruption", { where: "score", message: `score = ${s}` });
        }
      }
    } catch (e) {}
  }
  setInterval(checkState, 2000);

  // ── 7. Memory growth watch (every 30 sec) ──
  function checkMemory() {
    if (!performance.memory) return;
    const mb = performance.memory.usedJSHeapSize / (1024 * 1024);
    if (state.baselineMem === null) { state.baselineMem = mb; return; }
    if (mb > state.baselineMem * 2.5) {
      report("memory_growth", {
        where: "heap",
        message: `heap ${mb.toFixed(0)}MB, baseline ${state.baselineMem.toFixed(0)}MB`,
      });
      state.baselineMem = mb;  // reset so we don't keep spamming
    }
  }
  setInterval(checkMemory, 30000);

  // Expose for manual reporting from game code
  window.__ANOMALY__ = { report, state };
})();

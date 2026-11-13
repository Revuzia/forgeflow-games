/**
 * deep_audit.js — Full context capture for EVERY bug report.
 *
 * Industry-standard "crash dump" equivalent: when a bug fires, we don't just
 * log "something broke" — we capture everything a developer needs to reproduce:
 *
 *   1. STATE SNAPSHOT — player pos/hp/score, all enemies, current scene, level
 *   2. INPUT TRAIL   — last 30 sec of keyboard/mouse events (exact timings)
 *   3. SCENE GRAPH   — active sprites/children/particles count + top-level types
 *   4. CONSOLE TAIL  — last 100 console.log/warn/error messages
 *   5. PERF TRACE    — last 120 frame times (last ~2 sec at 60 FPS)
 *   6. BROWSER FP    — GPU, screen, language, platform, memory, cores
 *   7. NETWORK       — pending fetch requests, recent 404s
 *   8. ASSETS        — failed asset loads, texture count
 *   9. STORAGE       — localStorage + sessionStorage keys (values omitted for privacy)
 *   10. TIMING       — ms into session, current phase, fps avg
 *
 * API:
 *   window.__AUDIT__.capture()       -> full context object
 *   window.__AUDIT__.reportBug(msg)  -> capture + POST to game_crashes as type="user_bug"
 *
 * Integrates with crash_reporter + anomaly_logger — every auto-report now
 * includes this context via stack/source/data fields.
 */
(function(){
  const START_TIME = Date.now();

  // ── 1. Input trail (circular buffer, last 60 events) ──
  const inputTrail = [];
  const INPUT_MAX = 60;

  function pushInput(ev) {
    inputTrail.push(ev);
    if (inputTrail.length > INPUT_MAX) inputTrail.shift();
  }

  document.addEventListener("keydown", (e) => pushInput({ t: Date.now()-START_TIME, type: "kd", key: e.key.slice(0,10) }), {capture:true});
  document.addEventListener("keyup",   (e) => pushInput({ t: Date.now()-START_TIME, type: "ku", key: e.key.slice(0,10) }), {capture:true});
  document.addEventListener("mousedown",(e) => pushInput({ t: Date.now()-START_TIME, type: "md", x: e.clientX, y: e.clientY, btn: e.button }), {capture:true});
  document.addEventListener("click",   (e) => pushInput({ t: Date.now()-START_TIME, type: "cl", x: e.clientX, y: e.clientY }), {capture:true});

  // ── 2. Console tail (intercept via monkey-patch) ──
  const consoleTail = [];
  const CONSOLE_MAX = 100;
  for (const level of ["log","info","warn","error","debug"]) {
    const orig = console[level];
    console[level] = function(...args) {
      try {
        consoleTail.push({
          t: Date.now() - START_TIME, level,
          msg: args.map(a => {
            try { return typeof a === "object" ? JSON.stringify(a).slice(0,200) : String(a).slice(0,200); }
            catch { return "[unserializable]"; }
          }).join(" ").slice(0, 500),
        });
        if (consoleTail.length > CONSOLE_MAX) consoleTail.shift();
      } catch {}
      return orig.apply(console, args);
    };
  }

  // ── 3. Network watcher (fetch + XHR) ──
  const netErrors = [];
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
    const started = Date.now();
    return origFetch.apply(this, args).then(res => {
      if (!res.ok && netErrors.length < 20) {
        netErrors.push({ t: started-START_TIME, url: url.slice(0,200), status: res.status });
      }
      return res;
    }).catch(err => {
      if (netErrors.length < 20) {
        netErrors.push({ t: started-START_TIME, url: url.slice(0,200), error: String(err).slice(0,100) });
      }
      throw err;
    });
  };

  // ── 4. Asset load failures (listen for Phaser loader errors) ──
  const assetFailures = [];
  window.addEventListener("error", (e) => {
    // <img/audio/script> load failures bubble here
    const target = e.target;
    if (target && target !== window && (target.tagName === "IMG" || target.tagName === "SCRIPT" || target.tagName === "AUDIO")) {
      if (assetFailures.length < 30) {
        assetFailures.push({ t: Date.now()-START_TIME, tag: target.tagName, src: (target.src || "").slice(0,200) });
      }
    }
  }, true);

  // ── 5. Browser fingerprint (captured once) ──
  let browserFp = null;
  function captureBrowserFp() {
    if (browserFp) return browserFp;
    let gpuInfo = "unknown";
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          gpuInfo = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch {}
    browserFp = {
      ua: navigator.userAgent.slice(0, 300),
      platform: navigator.platform,
      language: navigator.language,
      cores: navigator.hardwareConcurrency || 0,
      memory_gb: navigator.deviceMemory || 0,
      screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}x`,
      viewport: `${innerWidth}x${innerHeight}`,
      online: navigator.onLine,
      gpu: String(gpuInfo).slice(0, 120),
      cookie_enabled: navigator.cookieEnabled,
    };
    return browserFp;
  }

  // ── 6. Scene graph snapshot ──
  function captureSceneGraph() {
    const snap = { phaser: null, three: null };
    try {
      if (window.__GAME__ && window.__GAME__.scene) {
        const scenes = window.__GAME__.scene.scenes || [];
        snap.phaser = {
          active_scenes: scenes.filter(s => s.sys?.settings?.active).map(s => s.sys.settings.key),
          total_scenes: scenes.length,
          children_by_scene: {},
        };
        for (const s of scenes) {
          if (s.sys?.settings?.active && s.children?.list) {
            const types = {};
            for (const c of s.children.list) {
              const t = c.type || c.constructor?.name || "Unknown";
              types[t] = (types[t] || 0) + 1;
            }
            snap.phaser.children_by_scene[s.sys.settings.key] = {
              total: s.children.list.length,
              by_type: types,
            };
          }
        }
      }
    } catch {}
    try {
      if (window.scene && window.scene.traverse) {
        let count = 0;
        const types = {};
        window.scene.traverse(obj => {
          count++;
          const t = obj.type || "Object3D";
          types[t] = (types[t] || 0) + 1;
        });
        snap.three = { total_nodes: count, by_type: types };
      }
    } catch {}
    return snap;
  }

  // ── 7. Game state snapshot via __TEST__ hooks ──
  function captureGameState() {
    const s = {};
    try {
      if (!window.__TEST__) return s;
      s.player = window.__TEST__.getPlayer?.() || null;
      s.score = window.__TEST__.getScore?.() ?? null;
      s.lives = window.__TEST__.getLives?.() ?? null;
      s.level = window.__TEST__.getLevel?.() ?? null;
      s.scene = window.__TEST__.getCurrentScene?.() ?? null;
      const enemies = window.__TEST__.getEnemies?.();
      s.enemy_count = Array.isArray(enemies) ? enemies.length : null;
      s.enemies_sample = Array.isArray(enemies) ? enemies.slice(0, 5) : null;
    } catch {}
    return s;
  }

  // ── 8. Performance trace (last 120 frames) ──
  const perfTrace = [];
  const PERF_MAX = 120;
  let lastFrame = performance.now();
  function perfTick() {
    const now = performance.now();
    perfTrace.push({ dt: Math.round(now - lastFrame) });
    if (perfTrace.length > PERF_MAX) perfTrace.shift();
    lastFrame = now;
    requestAnimationFrame(perfTick);
  }
  requestAnimationFrame(perfTick);

  // ── 9. Storage snapshot (keys only, no values for privacy) ──
  function captureStorage() {
    const out = { local_keys: [], session_keys: [] };
    try { out.local_keys = Object.keys(localStorage).slice(0, 30); } catch {}
    try { out.session_keys = Object.keys(sessionStorage).slice(0, 30); } catch {}
    return out;
  }

  // ── 10. Active Juice / power-ups (from shared modules) ──
  function captureActiveEffects() {
    const e = {};
    try { if (window.__TEST__?.getPowerUps) e.active_powerups = window.__TEST__.getPowerUps(); } catch {}
    try { if (window.Accessibility?.get) e.a11y = { colorblind: window.Accessibility.get("colorBlindMode"), reducedMotion: window.Accessibility.get("reducedMotion") }; } catch {}
    try { e.locale = window.i18n?.getCurrentLocale?.() || null; } catch {}
    return e;
  }

  // ── MAIN: capture a full audit snapshot ──
  function capture() {
    const perf = window.__PERF__?.getPerformance?.() || {};
    return {
      ts: new Date().toISOString(),
      elapsed_ms: Date.now() - START_TIME,
      game_slug: (window.GAME_CONFIG?.title || "unknown").toLowerCase().replace(/\s+/g, "-"),
      browser: captureBrowserFp(),
      performance: {
        current_fps: perf.fps, frame_time: perf.frameTime,
        long_frames: perf.longFrames, dropouts: perf.dropoutCount,
        memory_mb: perf.memMB, verdict: perf.verdict,
        trace_last_120: perfTrace.slice(),
      },
      game_state: captureGameState(),
      scene_graph: captureSceneGraph(),
      active_effects: captureActiveEffects(),
      input_trail: inputTrail.slice(),
      console_tail: consoleTail.slice(-50),  // last 50 lines
      network_errors: netErrors.slice(),
      asset_failures: assetFailures.slice(),
      storage: captureStorage(),
      url: location.href.slice(0, 500),
    };
  }

  // ── User-triggered bug report ──
  function reportBug(userMessage, extra = {}) {
    const payload = capture();
    payload.user_message = (userMessage || "").slice(0, 1000);
    payload.user_triggered = true;
    Object.assign(payload, extra);

    // SECURITY: service_role key removed — inject anon key via scaffold.
    const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
    const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";
    if (SUPABASE_URL.indexOf("{{") === 0 || KEY.indexOf("{{") === 0) {
      console.warn("[deep_audit] Supabase config not injected — user bug reports disabled");
      return Promise.resolve({ ok: false, reason: "config_missing" });
    }

    return fetch(`${SUPABASE_URL}/rest/v1/game_crashes`, {
      method: "POST",
      headers: {
        "apikey": KEY, "Authorization": `Bearer ${KEY}`,
        "Content-Type": "application/json", "Prefer": "return=minimal",
      },
      body: JSON.stringify([{
        game_slug: payload.game_slug,
        session_id: (window.GAME_CONFIG?._SESSION_ID) || Math.random().toString(36).slice(2, 12),
        type: "user_bug",
        message: (userMessage || "user reported bug").slice(0, 500),
        source: payload.game_state?.scene || "",
        stack: JSON.stringify(payload).slice(0, 100000),  // full audit in stack column
        ua: payload.browser?.ua?.slice(0, 200),
        url: payload.url,
      }]),
      keepalive: true,
    }).catch(() => {});
  }

  // Expose globally
  window.__AUDIT__ = { capture, reportBug, perfTrace };

  // Bug button moved out of canvas — now rendered by game_controls.js as part of
  // the page-level control bar (top-right, alongside fullscreen + mute + pause).
  // game_controls.js calls window.__AUDIT__.reportBug() directly.
})();

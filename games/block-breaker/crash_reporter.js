/**
 * crash_reporter.js — AAA crash telemetry to Supabase.
 * Captures: window.onerror, unhandledrejection, Phaser loader errors.
 * Batches reports — flushes every 30 sec or 10 events, whichever first.
 */
(function(){
  // Config injected by scaffold at build time (run_game_pipeline.py phase_build).
  // If placeholders are still present, crash reporting is disabled (no-op).
  const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";
  if (SUPABASE_URL.indexOf("{{") === 0 || SUPABASE_ANON.indexOf("{{") === 0) {
    console.warn("[crash_reporter] Supabase config not injected — crash telemetry disabled");
    return;
  }
  const GAME_SLUG = (window.GAME_CONFIG?.title || "unknown-game").toLowerCase().replace(/\s+/g, "-");
  const SESSION_ID = Math.random().toString(36).slice(2, 12);

  const queue = [];
  let flushTimer = null;

  function report(type, payload) {
    // Deep audit: if available, attach full context to stack field
    let deepContext = null;
    try {
      if (window.__AUDIT__ && window.__AUDIT__.capture) {
        deepContext = window.__AUDIT__.capture();
      }
    } catch (e) {}

    const stackField = payload.stack || "";
    const combined = deepContext
      ? JSON.stringify({ original_stack: stackField, deep_audit: deepContext }).slice(0, 100000)
      : stackField;

    queue.push({
      game_slug: GAME_SLUG, session_id: SESSION_ID, type,
      ua: navigator.userAgent.slice(0, 200),
      url: location.href.slice(0, 500),
      ts: new Date().toISOString(),
      ...payload,
      stack: combined,
    });
    if (queue.length >= 10) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 30000);
  }

  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    fetch(`${SUPABASE_URL}/rest/v1/game_crashes`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(batch),
      keepalive: true,
    }).catch(() => { /* swallow — don't cascade crashes */ });
  }

  window.addEventListener("error", (e) => {
    report("runtime_error", {
      message: (e.message || "").slice(0, 500),
      source:  (e.filename || "").slice(0, 300),
      lineno: e.lineno, colno: e.colno,
      stack: (e.error?.stack || "").slice(0, 2000),
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    report("unhandled_rejection", {
      message: String(e.reason || "").slice(0, 500),
      stack: (e.reason?.stack || "").slice(0, 2000),
    });
  });

  // Flush on page hide
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);

  window.__CRASH__ = { report, flush, queueSize: () => queue.length };
})();

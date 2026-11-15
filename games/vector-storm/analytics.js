/**
 * analytics.js — AAA-standard event telemetry to Supabase.
 * Captures session_start, level_start, level_complete, death, powerup_pickup,
 * boss_encounter, boss_defeat, achievement, session_end.
 *
 * API:
 *   Analytics.event("level_start", {level: 3});
 *   Analytics.event("death", {cause: "spike_pit", level: 3, x: 400, y: 300});
 *   Analytics.session();  // auto-fires on load
 */
(function(){
  const SUPABASE_URL = "{{SUPABASE_URL}}";
  const SUPABASE_ANON = "{{SUPABASE_ANON}}";
  // 2026-04-22: guard for BOTH unreplaced placeholder AND empty string.
  // The scaffolder replaces placeholders with "" when creds aren't wired —
  // previously that bypassed the guard and fetch() resolved to file:// URLs.
  if (!SUPABASE_URL || !SUPABASE_ANON ||
      SUPABASE_URL.indexOf("{{") === 0 || SUPABASE_ANON.indexOf("{{") === 0) {
    console.warn("[analytics] Supabase config not injected — events disabled");
    return;
  }
  const GAME_SLUG = (window.GAME_CONFIG?.title || "unknown-game").toLowerCase().replace(/\s+/g, "-");
  const SESSION_ID = Math.random().toString(36).slice(2, 12);
  const START_TIME = Date.now();

  const queue = [];
  let flushTimer = null;
  const BATCH_SIZE = 20;
  const FLUSH_INTERVAL = 15000;

  function event(name, data = {}) {
    queue.push({
      game_slug: GAME_SLUG,
      session_id: SESSION_ID,
      event: name,
      data: data,
      elapsed_ms: Date.now() - START_TIME,
      ts: new Date().toISOString(),
    });
    if (queue.length >= BATCH_SIZE) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL);
  }

  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    fetch(`${SUPABASE_URL}/rest/v1/game_events`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(batch),
      keepalive: true,
    }).catch(() => {});
  }

  // Auto-fire session start + heartbeat
  event("session_start", {
    referrer: document.referrer.slice(0, 200),
    screen: `${screen.width}x${screen.height}`,
    lang: navigator.language,
  });

  // Session-end on unload
  window.addEventListener("beforeunload", () => {
    event("session_end", { duration_ms: Date.now() - START_TIME });
    flush();
  });

  window.Analytics = { event, flush, session: () => SESSION_ID };
})();

/**
 * i18n.js — Auto-localization for shipped games (industry standard).
 *
 * Reads navigator.language → auto-loads appropriate locale JSON from assets/i18n/
 * Fallback chain: exact match (en-US) → language code (en) → default (en)
 *
 * API:
 *   i18n.t("play_button")                 // returns localized string
 *   i18n.t("lives_remaining", {n: 3})     // with interpolation: "3 lives remaining"
 *   i18n.setLocale("es")                  // manually override
 *   i18n.availableLocales                 // list
 *
 * Translations loaded once at boot. Phaser/Three.js code uses i18n.t() everywhere
 * instead of hardcoded English strings.
 */
const i18n = (function () {
  // Baseline English — shipped inline so game runs even if locale load fails
  const DEFAULT_STRINGS = {
    // UI core
    play: "Play",
    pause: "Pause",
    resume: "Resume",
    restart: "Restart",
    quit: "Quit",
    settings: "Settings",
    back: "Back",
    continue: "Continue",
    new_game: "New Game",
    load_game: "Load Game",
    save_game: "Save Game",
    // Game flow
    game_over: "Game Over",
    victory: "Victory!",
    level_complete: "Level Complete",
    stage_clear: "Stage Clear",
    try_again: "Try Again",
    next_level: "Next Level",
    // Stats
    score: "Score",
    lives: "Lives",
    level: "Level",
    time: "Time",
    health: "Health",
    mana: "Mana",
    experience: "XP",
    gold: "Gold",
    // Combat
    attack: "Attack",
    defend: "Defend",
    critical_hit: "Critical!",
    blocked: "Blocked",
    dodge: "Dodge",
    miss: "Miss",
    // Pickups
    collected: "Collected",
    power_up: "Power Up!",
    checkpoint: "Checkpoint",
    secret_found: "Secret Found",
    // Messages
    loading: "Loading...",
    please_wait: "Please Wait...",
    paused: "PAUSED",
    ready: "Ready",
    go: "GO!",
    // Menus
    main_menu: "Main Menu",
    options: "Options",
    credits: "Credits",
    controls: "Controls",
    audio: "Audio",
    display: "Display",
    accessibility: "Accessibility",
    colorblind_mode: "Colorblind Mode",
    reduced_motion: "Reduced Motion",
    high_contrast: "High Contrast",
    music_volume: "Music Volume",
    sfx_volume: "SFX Volume",
    // Story / tutorial
    tutorial: "Tutorial",
    press_any_key: "Press any key to start",
    // Units / counts
    enemies_defeated: "Enemies Defeated: {n}",
    coins_collected: "Coins: {n}",
    lives_remaining: "{n} Lives",
    time_elapsed: "{t}",
  };

  let currentLocale = "en";
  let strings = { ...DEFAULT_STRINGS };
  const loadedLocales = { en: DEFAULT_STRINGS };

  // Detect from browser
  function detectLocale() {
    const nav = navigator.language || "en-US";
    const short = nav.split("-")[0].toLowerCase();
    return { exact: nav.toLowerCase(), short };
  }

  // Load a locale JSON from assets/i18n/
  // 2026-04-23: our locale pack ships LANGUAGE codes (en/fr/es/de/ja/…), not
  // regional variants. We used to fetch "en-us.json" first which always 404'd,
  // polluting the console log. Now we reject regional codes with a "-" unless
  // they are explicitly preloaded — callers get false immediately with no
  // network request, no 404, no console spam.
  async function loadLocale(code) {
    if (loadedLocales[code]) {
      strings = { ...DEFAULT_STRINGS, ...loadedLocales[code] };
      currentLocale = code;
      return true;
    }
    if (code && code.indexOf("-") !== -1) {
      // Regional variant (e.g. "en-us"): don't fetch — our pack is language-only.
      return false;
    }
    // 2026-04-22: Chrome blocks fetch() on file:// protocol → throws
    // "Fetch API cannot load file:///..." and produces a console error.
    // Under file:// (local QA/preview runs) just use DEFAULT_STRINGS.
    if (typeof window !== "undefined" && window.location &&
        window.location.protocol === "file:") {
      return false;  // silently fall back — DEFAULT_STRINGS already loaded
    }
    try {
      // Use URL relative to page location so this works whether the game is served
      // at /games/foo/ or /foo/ or any other path depth.
      const base = (window.location.href.replace(/[^/]*$/, ""));
      const res = await fetch(`${base}assets/i18n/${code}.json`);
      if (!res.ok) return false;
      const data = await res.json();
      loadedLocales[code] = data;
      strings = { ...DEFAULT_STRINGS, ...data };
      currentLocale = code;
      return true;
    } catch (e) {
      return false;
    }
  }

  async function autoInit() {
    const { exact, short } = detectLocale();
    // Try exact match (e.g. pt-br) then language code (pt) then fallback to en
    if (await loadLocale(exact)) return;
    if (await loadLocale(short)) return;
    // Already on en default
  }

  function t(key, vars) {
    let s = strings[key] || DEFAULT_STRINGS[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  }

  // Kick off auto-detection immediately
  if (typeof navigator !== "undefined") {
    autoInit();
  }

  return {
    t,
    setLocale: loadLocale,
    getCurrentLocale: () => currentLocale,
    detectLocale,
    get availableLocales() { return Object.keys(loadedLocales); },
  };
})();

if (typeof window !== "undefined") window.i18n = i18n;

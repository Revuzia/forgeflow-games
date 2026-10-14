// core/meta/achievements.js — BLACKRIDGE -> ForgeFlow portal achievements (2026-10-14).
//
// View-side only: listens to the sim's bridge events (never touches sim state, so
// determinism and the selftests are unaffected) and calls the portal SDK,
// window.ForgeFlow.unlockAchievement(slug). The portal resolves the slug against
// public.achievements for this game and awards the XP server-side, once per user
// (migration 0009 unlock_achievement). Outside the portal iframe the SDK no-ops.
//
// Source of truth for slugs/names/tiers: games/blackridge/achievements.json (also
// read by pipeline/seed_achievements_json.py). core/meta/achievements.selftest.cjs
// fails if DETECTORS below and that file ever disagree.
//
// PERSISTENCE (per device, localStorage "blackridge.achv.v1"): lifetime counters
// (kills, headshots, weapons used for kills, arenas/modes won) and the set of
// achievements this device has EARNED. Every session re-sends the earned set once
// (the server ignores repeats), so a player who earned something while signed
// out still gets it the next time they play signed in.

const KEY = "blackridge.achv.v1";

// slug -> short note on what fires it (read by the selftest; keep in sync with JSON)
export const DETECTORS = {
  first_kill: "any kill by the player",
  first_headshot: "a headshot kill by the player",
  medal_longshot: "medal LONGSHOT",
  medal_revenge: "medal REVENGE",
  medal_firstblood: "medal FIRST BLOOD",
  streak_sweep: "streak earned recon",
  call_in: "streak call mortar|airstrike|orbital",
  ctf_capture: "flag captured by P",
  win_skirmish: "mission:end won, match tdm",
  multi_triple: "medal TRIPLE KILL",
  streak_mortar: "streak earned mortar",
  streak_airstrike: "streak earned airstrike",
  headshots_25: "lifetime headshot kills >= 25",
  kills_100: "lifetime kills >= 100",
  full_kit: "a kill with each of the five weapons",
  win_ctf: "mission:end won, match ctf",
  campaign_clear: "mission:end won, campaign",
  multi_quad: "medal QUAD KILL",
  streak_orbital: "streak earned orbital",
  headshots_100: "lifetime headshot kills >= 100",
  kills_500: "lifetime kills >= 500",
  win_ffa: "mission:end won, match ffa",
  all_arenas: "a win on lanternwalk, switchyard and saltmarket",
  campaign_hard: "mission:end won, campaign on hard",
  grand_tour: "a win in all 9 mode x arena pairs",
};

const WEAPONS = ["warden", "vesper", "breaker", "corvus", "pike"];
const ARENAS = ["lanternwalk", "switchyard", "saltmarket"];
const MODES = ["tdm", "ctf", "ffa"];

function blank() {
  return { kills: 0, heads: 0, weapons: [], arenas: [], combos: [], earned: [] };
}

export function createAchievements(ctx) {
  let st = blank();
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(KEY);
    if (raw) st = Object.assign(blank(), JSON.parse(raw));
  } catch (e) { /* private mode: session-only */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* best effort */ } };

  // names for the in-game toast (optional: the toast just shows the slug if this fails)
  let names = {};
  try {
    fetch(new URL("../../achievements.json", import.meta.url).href)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && Array.isArray(j.achievements)) for (const a of j.achievements) names[a.slug] = a; })
      .catch(() => {});
  } catch (e) { /* no fetch */ }

  const sentThisSession = new Set();
  function send(slug) {
    if (sentThisSession.has(slug)) return;
    sentThisSession.add(slug);
    try {
      if (typeof window !== "undefined" && window.ForgeFlow && window.ForgeFlow.unlockAchievement) {
        window.ForgeFlow.unlockAchievement(slug);
      }
    } catch (e) { /* the portal must never break the game */ }
  }
  function earn(slug) {
    if (!(slug in DETECTORS)) return;
    const fresh = st.earned.indexOf(slug) < 0;
    if (fresh) { st.earned.push(slug); save(); toast(slug); }
    send(slug);
  }

  // ---- toast ----------------------------------------------------------------
  let toastEl = null, toastT = 0;
  const queue = [];
  function toast(slug) {
    if (typeof document === "undefined") return;
    queue.push(slug);
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "br-achv";
      toastEl.style.cssText = "position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);z-index:36;pointer-events:none;" +
        "padding:10px 18px 11px;border:1px solid rgba(217,164,65,.55);background:rgba(10,12,16,.82);color:#e8e8e4;" +
        "font:12px/1.35 'Oswald','Arial Narrow',system-ui,sans-serif;letter-spacing:.16em;text-align:center;" +
        "opacity:0;transition:opacity .25s ease;box-shadow:0 4px 18px rgba(0,0,0,.5);";
      document.body.appendChild(toastEl);
    }
  }
  function pumpToast(dt) {
    if (!toastEl) return;
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0.3) toastEl.style.opacity = "0";
      return;
    }
    const slug = queue.shift();
    if (!slug) return;
    const a = names[slug];
    const tierCol = a && a.tier === "diamond" ? "#9fe8ff" : a && a.tier === "gold" ? "#f0c46a" : a && a.tier === "silver" ? "#d6dbe2" : "#d9a441";
    toastEl.innerHTML = `<div style="font-size:10px;opacity:.75;color:${tierCol}">ACHIEVEMENT UNLOCKED${a ? " · +" + a.points + " XP" : ""}</div>` +
      `<div style="font-size:17px;letter-spacing:.2em;margin-top:2px">${(a ? a.name : slug).toUpperCase()}</div>`;
    toastEl.style.opacity = "1";
    toastT = 3.0;
  }

  // ---- detectors ----------------------------------------------------------------
  let lastShotW = null, lastShotT = -9;
  let arena = null, modeId = null;
  const sim = () => (ctx.sim ? ctx.sim() : null);
  const now = () => { const s = sim(); return s ? s.state.time : 0; };
  function isEnemy(victim) {
    const s = sim();
    // sim.match.sameTeam takes WHO ids ("P" / bot id); the roster's areEnemies takes
    // actor objects — passing ids to it rejected every kill (caught in the live test)
    try {
      if (s && s.match && s.match.sameTeam) return !s.match.sameTeam("P", victim);
    } catch (e) { /* campaign */ }
    return true;
  }
  const counters = () => {
    if (st.kills >= 1) earn("first_kill");
    if (st.heads >= 1) earn("first_headshot");
    if (st.heads >= 25) earn("headshots_25");
    if (st.heads >= 100) earn("headshots_100");
    if (st.kills >= 100) earn("kills_100");
    if (st.kills >= 500) earn("kills_500");
    if (WEAPONS.every((w) => st.weapons.indexOf(w) >= 0)) earn("full_kit");
    if (ARENAS.every((a) => st.arenas.indexOf(a) >= 0)) earn("all_arenas");
    if (MODES.every((m) => ARENAS.every((a) => st.combos.indexOf(m + "@" + a) >= 0))) earn("grand_tour");
  };

  const handlers = {
    shot(d) {
      if (d && d.shooter === "P" && !d.impactOnly && !d.pen && d.weaponId) { lastShotW = d.weaponId; lastShotT = now(); }
    },
    death(d) {
      if (!d || d.attacker !== "P" || d.victim === "P" || d.victim == null) return;
      if (!isEnemy(d.victim)) return;
      st.kills++;
      if (d.headshot) st.heads++;
      // the weapon: the player's last fire-time shot within a second, else the one in hand
      let w = null;
      if (lastShotW && now() - lastShotT <= 1.0) w = lastShotW;
      else { const s = sim(); w = s && s.state.player.weapon ? s.state.player.weapon.id : null; }
      if (w && WEAPONS.indexOf(w) >= 0 && st.weapons.indexOf(w) < 0) st.weapons.push(w);
      save();
      counters();
    },
    medal(d) {
      if (!d || !d.text) return;
      const t = String(d.text).toUpperCase();
      if (t === "LONGSHOT") earn("medal_longshot");
      else if (t === "REVENGE") earn("medal_revenge");
      else if (t === "FIRST BLOOD") earn("medal_firstblood");
      else if (t === "TRIPLE KILL") earn("multi_triple");
      else if (t === "QUAD KILL" || t.indexOf("MULTI KILL") === 0) { earn("multi_triple"); earn("multi_quad"); }
    },
    streak(d) {
      if (!d) return;
      if (d.phase === "earned") {
        if (d.id === "recon") earn("streak_sweep");
        else if (d.id === "mortar") earn("streak_mortar");
        else if (d.id === "airstrike") earn("streak_airstrike");
        else if (d.id === "orbital") earn("streak_orbital");
      } else if (d.phase === "call" && d.id !== "recon") earn("call_in");
    },
    flag(d) {
      if (d && d.state === "captured" && d.byWho === "P") earn("ctf_capture");
    },
    "match:start"(d) {
      arena = d && d.map ? String(d.map) : null;
      modeId = d && d.mode ? String(d.mode) : null;
    },
    "mission:end"(d) {
      if (!d || d.result !== "won") return;
      if (d.match) {
        const m = d.match.modeId || modeId;
        if (m === "tdm") earn("win_skirmish");
        else if (m === "ctf") earn("win_ctf");
        else if (m === "ffa") earn("win_ffa");
        if (arena && ARENAS.indexOf(arena) >= 0) {
          if (st.arenas.indexOf(arena) < 0) st.arenas.push(arena);
          const c = m + "@" + arena;
          if (MODES.indexOf(m) >= 0 && st.combos.indexOf(c) < 0) st.combos.push(c);
          save();
        }
        counters();
      } else {
        earn("campaign_clear");
        const s = sim();
        const diff = (s && s.mission && s.mission.difficulty) ||
          (ctx.content && ctx.content.difficultySelected) || null;
        if (diff === "hard") earn("campaign_hard");
      }
    },
  };

  return {
    attach(bridge) {
      for (const k of Object.keys(handlers)) {
        bridge.register(k, (d) => { try { handlers[k](d); } catch (e) { /* never break the frame */ } });
      }
      // re-send everything this device has earned, once per session (see header)
      for (const slug of st.earned) send(slug);
    },
    update(dt) { pumpToast(dt || 0.016); },
    // test seams
    get state() { return JSON.parse(JSON.stringify(st)); },
    _reset() { st = blank(); save(); sentThisSession.clear(); },
  };
}

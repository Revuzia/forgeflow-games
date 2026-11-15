// core/team_color.js — THE single source for team colours (polish pass v149).
//
// Team 0 is always the player's side in two-team modes (roster.js seats the
// human on AMBER), so friend = team 0, enemy = team 1. With colour-blind mode
// "off" the authored roster tints stand (AMBER #d9a441 / SLATE #7c9fd0); with a
// CVD mode on, settings.js CB_PALETTES win everywhere — score header,
// scoreboard, flags, zone rings, tags, kill feed, callouts, world markers.
//
// Stateless: reads the live settings instance through globalThis.__BR_SETTINGS__
// (never a bare import of settings.js — see its dual-instance note), so any
// number of copies of this module (?v=N or not) agree.
//
// Live updates: onTeamColorChange(fn) fires on every colour-blind change; DOM
// consumers that build HTML per frame need nothing more, cached 3D materials
// (flags, zone rings, tag meshes) re-tint from the callback. The CSS custom
// properties --br-team0 / --br-team1 / --br-friend / --br-enemy on <html> are
// kept current too, so stylesheet rules can follow without JS.

export const DEFAULT_TEAM_HEX = ["#d9a441", "#7c9fd0"];
export const NEUTRAL_HEX = "#e8e8e4";

function handle() { return globalThis.__BR_SETTINGS__ || null; }

/** {friend, enemy} for the CVD mode, or null when colour-blind mode is off. */
export function cbPalette() {
  try { const h = handle(); return h && typeof h.teamColors === "function" ? h.teamColors() : null; } catch (_) { return null; }
}

/** Hex string for team 0/1 (anything else → neutral). `teams` is an optional
 *  roster/match teams array whose authored .tint is used when CB is off. */
export function teamHex(team, teams) {
  if (team !== 0 && team !== 1) return NEUTRAL_HEX;
  const cb = cbPalette();
  if (cb) return team === 0 ? cb.friend : cb.enemy;
  let t = null;
  if (Array.isArray(teams)) t = teams.find ? (teams.find((x) => x && x.id === team) || teams[team]) : teams[team];
  return (t && t.tint) || DEFAULT_TEAM_HEX[team];
}
export const friendHex = (teams) => teamHex(0, teams);
export const enemyHex = (teams) => teamHex(1, teams);

/** Numeric 0xRRGGBB for three.js materials. */
export function teamNum(team, teams) { return parseInt(teamHex(team, teams).slice(1), 16); }

export function hexRgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------- live hook
const G = (typeof globalThis !== "undefined") ? globalThis : {};
// shared across module copies: one settings subscription, one listener list
const bus = G.__BR_TEAMCOL_BUS__ || (G.__BR_TEAMCOL_BUS__ = { fns: [], hooked: false, gen: 0 });

function applyCss() {
  if (typeof document === "undefined" || !document.documentElement) return;
  const s = document.documentElement.style;
  const a = teamHex(0), b = teamHex(1);
  s.setProperty("--br-team0", a); s.setProperty("--br-friend", a);
  s.setProperty("--br-team1", b); s.setProperty("--br-enemy", b);
}

function hook() {
  if (bus.hooked) return;
  const h = handle();
  if (!h || typeof h.onChange !== "function") return; // settings not up yet: retried on next subscribe/get
  bus.hooked = true;
  h.onChange("colorblind", () => {
    bus.gen++;
    applyCss();
    for (const fn of bus.fns.slice()) { try { fn(); } catch (e) { console.warn("[team_color] listener threw:", e && e.message); } }
  });
  applyCss();
}

/** Subscribe to colour-blind palette changes. Returns an unsubscribe fn. */
export function onTeamColorChange(fn) {
  hook();
  bus.fns.push(fn);
  return () => { const i = bus.fns.indexOf(fn); if (i >= 0) bus.fns.splice(i, 1); };
}

/** Monotonic counter bumped on every palette change — cheap "did it change?"
 *  check for per-frame consumers with cached tints. */
export function teamColorGen() { hook(); return bus.gen; }

hook();

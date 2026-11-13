// DYEFIELD — the online screens' glyphs (LOBBY-UI). Inline SVG in the game's toy style: chunky rounded strokes in
// `currentColor` (the button / chip colour), cream fills with the ink outline where a glyph needs a body. All are
// aria-hidden decorations: every control that carries one also carries its words.

const S = (view: string, body: string): string => `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;
const ST = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

export const GLYPH = {
  /** QUICK MATCH: a lightning bolt between two motion streaks */
  quick: S('0 0 64 64', `<path d="M36 6 16 36h14l-4 22 22-32H34z" fill="#fff8ec" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/>`
    + `<path d="M6 24h8M4 34h7M52 40h7M50 50h8" ${ST} stroke-width="4"/>`),
  /** CREATE ROOM: a door with a plus badge */
  create: S('0 0 64 64', `<path d="M14 58V10a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v48z" fill="#fff8ec" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/>`
    + `<circle cx="35" cy="34" r="3" fill="#14203a"/><path d="M8 58h40" stroke="#14203a" stroke-width="4" stroke-linecap="round"/>`
    + `<circle cx="48" cy="18" r="11" fill="currentColor" stroke="#14203a" stroke-width="3.5"/><path d="M48 12v12M42 18h12" stroke="#fff8ec" stroke-width="3.5" stroke-linecap="round"/>`),
  /** JOIN ROOM: a ticket with a code */
  join: S('0 0 64 64', `<path d="M6 18a4 4 0 0 1 4-4h44a4 4 0 0 1 4 4v7a7 7 0 0 0 0 14v7a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-7a7 7 0 0 0 0-14z" fill="#fff8ec" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/>`
    + `<path d="M42 16v32" stroke="#14203a" stroke-width="2.5" stroke-dasharray="3 4"/>`
    + `<g fill="currentColor"><rect x="13" y="26" width="5" height="12" rx="2"/><rect x="21" y="26" width="5" height="12" rx="2"/><rect x="29" y="26" width="5" height="12" rx="2"/></g>`
    + `<path d="M48 26l4 6-4 6" ${ST} stroke-width="3.5"/>`),
  /** the device: keyboard + mouse */
  kbm: S('0 0 24 24', `<rect x="1.5" y="7" width="15" height="10" rx="2.2" ${ST} stroke-width="2"/><path d="M4.5 10.5h1M8 10.5h1M11.5 10.5h1M5 13.8h8" ${ST} stroke-width="1.8"/>`
    + `<rect x="18" y="8.5" width="5" height="8" rx="2.5" ${ST} stroke-width="1.8"/><path d="M20.5 8.8v2.6" ${ST} stroke-width="1.6"/>`),
  /** the device: a phone held sideways */
  touch: S('0 0 24 24', `<rect x="2" y="6.5" width="20" height="11" rx="2.6" ${ST} stroke-width="2"/><circle cx="18.6" cy="12" r="1.2" fill="currentColor"/>`
    + `<path d="M5 9.5v5" ${ST} stroke-width="1.8"/>`),
  /** the room's owner */
  crown: S('0 0 24 24', `<path d="M3 18 4.5 7.5l5 4.5L12 5l2.5 7 5-4.5L21 18z" fill="currentColor" stroke="#14203a" stroke-width="1.6" stroke-linejoin="round"/>`),
  /** the match host (runs the bots and the clock) */
  host: S('0 0 24 24', `<path d="M12 13v8M8.5 21h7" ${ST} stroke-width="2.2"/><circle cx="12" cy="11" r="2.3" fill="currentColor"/>`
    + `<path d="M7.4 6.6a6.4 6.4 0 0 0 0 8.8M16.6 6.6a6.4 6.4 0 0 1 0 8.8M4.6 3.8a10.4 10.4 0 0 0 0 14.4M19.4 3.8a10.4 10.4 0 0 1 0 14.4" ${ST} stroke-width="2"/>`),
  /** ping bars */
  bars: S('0 0 24 24', `<rect x="3" y="15" width="4" height="6" rx="1.2" fill="currentColor"/><rect x="10" y="10" width="4" height="11" rx="1.2" fill="currentColor"/>`
    + `<rect x="17" y="4" width="4" height="17" rx="1.2" fill="currentColor"/>`),
  /** PLAY ONLINE (the title tile) */
  online: S('0 0 24 24', `<circle cx="12" cy="12" r="9.2" ${ST} stroke-width="2.2"/><path d="M2.8 12h18.4M12 2.8c3 3.2 3 15.2 0 18.4M12 2.8c-3 3.2-3 15.2 0 18.4" ${ST} stroke-width="2"/>`),
  copy: S('0 0 24 24', `<rect x="8" y="8" width="12" height="13" rx="2.4" ${ST} stroke-width="2.2"/><path d="M16 5.2V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h.4" ${ST} stroke-width="2.2"/>`),
  link: S('0 0 24 24', `<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.8 5.8M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" ${ST} stroke-width="2.2"/>`),
  share: S('0 0 24 24', `<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" ${ST} stroke-width="2.2"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" ${ST} stroke-width="2.2"/>`),
  back: S('0 0 24 24', `<path d="M15 5 8 12l7 7" ${ST} stroke-width="3"/>`),
  del: S('0 0 24 24', `<path d="M8.5 5H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.5L2 12z" ${ST} stroke-width="2"/><path d="M11 9l6 6M17 9l-6 6" ${ST} stroke-width="2.2"/>`),
  bot: S('0 0 24 24', `<rect x="4" y="8" width="16" height="12" rx="4" ${ST} stroke-width="2.2"/><path d="M12 8V4.5" ${ST} stroke-width="2.2"/><circle cx="12" cy="3.6" r="1.6" fill="currentColor"/>`
    + `<circle cx="9" cy="14" r="1.7" fill="currentColor"/><circle cx="15" cy="14" r="1.7" fill="currentColor"/>`),
  x: S('0 0 24 24', `<path d="M6 6l12 12M18 6 6 18" ${ST} stroke-width="3"/>`),
  /** notice cards */
  warn: S('0 0 64 64', `<path d="M32 6 60 56H4z" fill="#ffd23f" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/><path d="M32 24v14" stroke="#14203a" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="46" r="3.4" fill="#14203a"/>`),
  offline: S('0 0 64 64', `<path d="M8 26a34 34 0 0 1 48 0M16 35a22 22 0 0 1 32 0M24 44a10 10 0 0 1 16 0" fill="none" stroke="#fff8ec" stroke-width="5.5" stroke-linecap="round"/>`
    + `<circle cx="32" cy="52" r="4" fill="#fff8ec"/><path d="M10 8l44 48" stroke="#ff5a5f" stroke-width="6" stroke-linecap="round"/>`),
  full: S('0 0 64 64', `<circle cx="22" cy="22" r="8" fill="#fff8ec" stroke="#14203a" stroke-width="3.5"/><circle cx="42" cy="22" r="8" fill="#fff8ec" stroke="#14203a" stroke-width="3.5"/>`
    + `<path d="M8 50c0-9 6-15 14-15s14 6 14 15zM28 50c0-9 6-15 14-15s14 6 14 15z" fill="#ffa84a" stroke="#14203a" stroke-width="3.5" stroke-linejoin="round"/>`),
  update: S('0 0 64 64', `<path d="M50 30a18 18 0 0 0-33-9M14 34a18 18 0 0 0 33 9" fill="none" stroke="#fff8ec" stroke-width="5.5" stroke-linecap="round"/>`
    + `<path d="M15 9v13h13M49 55V42H36" fill="none" stroke="#fff8ec" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  clock: S('0 0 64 64', `<circle cx="32" cy="34" r="24" fill="#fff8ec" stroke="#14203a" stroke-width="4"/><path d="M32 20v15l10 7" fill="none" stroke="#14203a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M24 5h16" stroke="#14203a" stroke-width="4.5" stroke-linecap="round"/>`),
  door: S('0 0 64 64', `<path d="M16 58V10a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v48" fill="#fff8ec" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/>`
    + `<path d="M10 58h44" stroke="#14203a" stroke-width="4" stroke-linecap="round"/><path d="M26 34h20M38 26l8 8-8 8" fill="none" stroke="#ff5a5f" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`),
} as const;

export type GlyphName = keyof typeof GLYPH;

/** a <span class=cls> holding a glyph */
export function glyph(name: GlyphName, cls = 'dfo-g'): HTMLElement {
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = GLYPH[name];
  return s;
}

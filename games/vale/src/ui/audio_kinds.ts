// VALE UI — the client's sound vocabulary: the roles the UI plays. Content binds each role to a cue or
// music id (content/audio.json `ui`, `screens`, `stings`), so no cue id lives in code; the content build
// (tools/build_content.ts) fails when a role here is unbound or bound to a missing cue. No imports: the
// build tool reads this file too.

export const UI_CUE_KINDS = [
  'hover', 'click', 'confirm', 'back', 'error', 'tab', 'toggle', 'slider',
  'queue_search', 'queue_pop', 'accept', 'lockin', 'ban', 'hover_fighter',
  'currency_tick', 'equip', 'purchase', 'reward_reveal', 'level_account', 'notify',
  'shop_buy', 'shop_sell', 'shop_undo',
] as const;
export type UiCueKind = typeof UI_CUE_KINDS[number];

/** music beds for the client's own screens; match beds come from MapDef.art.music */
export const SCREEN_MUSIC_KINDS = ['menu', 'draft', 'postgame'] as const;
export type MusicKind = typeof SCREEN_MUSIC_KINDS[number];

/** the post-game stings */
export const STING_KINDS = ['victory', 'defeat', 'placement'] as const;
export type StingKind = typeof STING_KINDS[number];

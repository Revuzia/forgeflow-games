// Hidden components (UI.md 1.7, 10): screens and rows that have no feature behind them yet are built but NOT mounted until the feature exists. One flag per component, all
// false today; the pets update flips `voices`. `reset` ("Start over", a hold-to-confirm in Settings > Other) is the owner's call (UI.md 11, R19) and has no component yet.
export const FEATURES = { voices: false, reset: false } as const;
export type FeatureFlags = { readonly [K in keyof typeof FEATURES]: boolean };

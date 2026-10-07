// VALE session — public surface (lane SESSION, CONTRACT §7–§8). Boot creates a LocalSession; the
// UI/render/audio only talk to the `Session` / `MatchClient` interfaces in contracts/session.ts.

export { LocalSession, memorySession, type LocalSessionOptions, type SessionPhase } from './local_session.ts';
export { RemoteSession } from './remote_session.ts';
export { RealClock, ManualClock, type Clock } from './clock.ts';
export { LocalIdentityProvider, sanitizeName } from './identity.ts';
export { LocalProfileStore, MemoryProfileStore, PROFILE_KEY, migrateProfile, newProfile } from './profile_store.ts';
export { defaultSettings, applyPreset, patchSettings, VIDEO_LADDER, DEFAULT_BINDS } from './settings.ts';
export { LocalMatchHost, forfeitResult } from './match_host.ts';
export { checkInvariants } from './economy.ts';
export { tierFor, glicko2 } from './ratings.ts';
export { xpToNext } from './grants.ts';
export { createFallbackDraftBrain, type DraftBrain } from './draft_brain.ts';

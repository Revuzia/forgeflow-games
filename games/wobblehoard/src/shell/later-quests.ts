// PLAYGROUND round 5 (VERDICT_PG C1; PLAYGROUND_BUILD D-92's overflow rule: "over a cap a lane packs, then moves into a lazier named chunk"): the quest
// reducer (core/quests.ts) and the journal store (collection/journal.ts, journal_store.ts) in a lazy chunk of their own, `later-quests`. boot.ts requests
// it IN PARALLEL with the life chunk (Promise.all: no extra wait) and hands `attachJournal` to the LIFE host (LifeHostDeps.parts), so the life chunk
// (shell/later-life.ts) no longer carries them and is back under its 150 KB cap.
export { attachJournal } from '../collection/journal_store.ts';

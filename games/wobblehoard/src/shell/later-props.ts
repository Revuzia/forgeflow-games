// PLAYGROUND round 5 (VERDICT_PG C1; D-92's overflow rule): the prop world builder (physics/props.ts) in a lazy chunk of its own, `later-props`. boot.ts
// requests it in parallel with the life chunk and hands `buildPropWorld` to the LIFE host (LifeHostDeps.parts); see later-quests.ts.
export { buildPropWorld } from '../physics/props.ts';

// PLAYGROUND: the LAZY half of the render lane's LIFE look (PLAYGROUND_BUILD.md 14.3's overflow rule, step 1: "a lane over its first-load cap
// moves code into the life chunk or its own lazy module"): the squishmoji bubble draw (emotes.ts) and Home's things (homekit.ts). The stage
// imports this module on first use (an emote, a Home thing, the keepsakes, a prop binding or the autonomy framing: all only ever come from the
// LIFE host, i.e. after the life chunk landed) and replays what was asked before it arrived. Facade for the size gate (T1): name it with the
// life chunk (its content is the draw half of LIFE). Imports three by the bare specifier, so three stays in the stage chunk.
export { Emotes, EMOTE_SLOTS, EMOTE_COLOURS, EMOTE_ACCENT } from './emotes.ts';
export { HomeKit } from './homekit.ts';
// (round 14, R14_ROOMS) the room camera's director (roomcam.ts): the stage reads its eased view; first-load keeps only the hooks
export { RoomCam, HOME_R } from './roomcam.ts';

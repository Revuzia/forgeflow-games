// VALE audio — the WebAudio engine (CONTRACT §11; tokens.json `audio`). Implements the UI's AudioPort.
//
//   buses       music · sfx · ui · voice · ambience → mix → [soften] → master → trim → limiter → soft clip → out
//               (Settings.audio volumes; `muteInBackground` silences a hidden tab). The trim (MIX_TRIM_DB) is the
//               engine's mix makeup, the same for every bus and the alert path, so the default settings (master 0.8)
//               land the match on the tokens' −18 ± 1.5 LUFS integrated (closing critic 'audio-runtime': two RIFT
//               captures read −21.5 / −21.8 before it; at 3.0 dB −18.75 and −18.07 (245 s), at 3.5 dB −16.07 / −16.59 over the band's
//               top, so most of the spread is the match; _harness/probe_audio_runtime.mjs match; max2 SFX-1b: 3.5, see
//               MIX_TRIM_DB, after round 1's quieter kits and the mix focus). The limiter (a compressor) can
//               overshoot on a fast transient, so a soft clip after it bends the top CLIP_KNEE..CLIP_CEIL and nothing
//               passes −1 dBFS. Accessibility (final parity AUD-m4): `mono` sums the output to one channel (both
//               speakers carry everything: one-sided hearing, a single earbud); `softenLoud` puts a gentle
//               compressor (SOFT_*) and its makeup gain (SOFT_MAKEUP_DB) between the mix and the master volume: the
//               mix's range narrows (the loud moments come down against the quiet ones) at the same average
//               loudness, whatever the master slider says (the compressor sees the mix before the volume).
//               WebAudio's compressor adds its own makeup (about +8 dB at these settings); SOFT_MAKEUP_DB takes
//               back what the compression does not, so the average holds (_harness/probe_audio_soften.mjs measures
//               it in real Chrome over a match-like program: integrated within 0.1 LU, peaks -2.9 dB, the
//               short-term range 13.2 -> 7.6 LU)
//   ducking     voice > sfx > music (CONTRACT §11): while an announcer line plays, music and ambience sit
//               VOICE_DUCK_DB lower and the sfx bus SFX_DUCK_DB lower, except threats to your fighter (the
//               awareness pass below), which are never ducked (r07 §2.2.7). A news line (bands 1-3: a wipe,
//               takedown news, structures, objectives) plays ANN_LIFT_DB over its cue gain and ducks the sfx bus
//               SFX_DUCK_NEWS_DB, so it sits on top of a teamfight (closing AUD-C7, measured by
//               _harness/probe_audio_runtime.mjs: line peak over the sfx bus's short-term p99)
//   alert path  the GATE cues — whatever content binds to the UI roles queue_pop / queue_remind and the event
//               roles countdown / matchStart — skip the master and join at the trim through their own
//               per-bus alert gain: max(ALERT_FLOOR, master × bus). So a match found while the tab is hidden
//               is still heard (a missed ready check costs a re-queue lockout), the UI slider cannot take it
//               below the floor (tokens.audio.motif.queuePop.ownSliderWithFloor), and every other cue stays
//               muted in the background. A master at exactly 0 is the player's explicit full mute and is kept
//   sync        a cue starts the moment its event reaches the engine (the frame loop pumps the sim, then renders, in one rAF);
//               A decoded cue starts synchronously in the event's call (not in a promise's then(), which ran after the
//               frame's render: one or two 256-frame device callbacks late, measured +5.3 / +10.7 ms); a
//               one-shot skips LEAD_SKIP_S of the cue build's silent codec lead under a 1 ms fade-in. A match's
//               combat cues (the event-bound sfx cues, the kits of its fighters) decode while it loads (prewarm),
//               so first hits start in their call too.
//               _harness/probe_audio_runtime.mjs sync measures the hit heard at the output against the impact frame.
//               Nothing is scheduled ahead; the mastering chain's only latency is fixed and known: the limiter's
//               built-in 6 ms look-ahead (WebAudio DynamicsCompressor) and the soft clip's 4x oversampler (4 ms)
//   cues        AudioCue: random variant file, ±pitchVar semitones, gain, maxVoices, cooldown (s), loop; files
//               decode lazily on first use (a match prewarms its combat set, a draft its lock-in calls), UI cues
//               preload; an unknown or missing cue is silently ignored (art
//               may still be rendering)
//   priority    a voice's priority is its cue's, LIFTED +1 when an enemy aims it at you (or it lands on you) and
//               DROPPED −1 when an ally made it (threat > self > ally, content/audio.json). A voice ranks by
//               priority × audibility on a log scale: priority + log10(cue gain × placement × the event's gain), so
//               one priority step outweighs 20 dB and a faint, far voice yields before a loud one of its priority.
//               A cue at its maxVoices, or
//               the whole engine at MAX_VOICES (one global budget over every bus; the gate cues and music beds
//               are outside it), frees its lowest-ranked, oldest voice, never one that outranks the newcomer
//               (then the newcomer is the one dropped)
//   announcer   the voice bus speaks one line at a time (r07 §2.2): a world event becomes at most ONE line, queued
//               by band (0 match flow · 1 a wipe, your elimination · 2 takedown news · 3 structures and
//               objectives · 4 team notices · 5 the rest), merged (a takedown's first / multi / shutdown lines and
//               a later multi by the same player are one line, the best; a structure and the objective it
//               grants in one tick are one line; a wipe swallows that tick's takedown lines), expired after
//               ANN_TTL_S of waiting, and only bands 0-1 cut a playing line short (a short fade). The lines are a
//               bell language bound in content ('announce.<line>'): first takedown one high toll, a multi-takedown
//               n rising tolls, a shutdown falling glass, structures a low hourbell (yours lost over Dsus2,
//               theirs resolving to F#), each named objective its own timbre. The HUD banner carries the words
//   threat      every control status has its own cue (content binds 'status.<kind>'; no catch-all, so an unbound
//               kind is silent), played on fighters only, +3 dB (YOU_CC_GAIN) when an enemy controls YOU. Every enemy
//               fighter's T3+ wind-up adds the shared shade-breath swell at the caster: its ultimate (T4,
//               enemyUltWindup) and every ability with a wind-up (castTime > 0) that is T3 by its effects, read from
//               content (tokens.vfx.tiers.T3 'crowd control, mobility, zones': at any depth a control status on
//               someone else, a displacement, a dash / blink, or a zone; role enemyWindup, else enemyUltWindup)
//   format      every cue / bed ships as Ogg Opus with an AAC .m4a sibling (catalog audio.m4a). The session
//               decodes .ogg; the first .ogg that fails to decode (or canPlayType saying no Ogg Opus, or the
//               dev-build switch ?audio=m4a) switches the whole session to .m4a and that file is retried. While
//               the format is undecided only one .ogg is in flight (others wait for it, at most PROBE_MS), so a
//               browser never fetches both formats of a cue unless its .ogg failed. MP4 edit lists trim the AAC
//               priming, so a .m4a starts sample-aligned with its .ogg and loops / beds decode to its exact
//               length: loop points are format-independent (audio/aac.py; Safari pads a one-shot's end to a
//               whole 1024-sample frame of silence, inaudible). AAC decodes several times slower than Opus in
//               Safari (a 160 s bed ~10-20 s), so a bed's main stem also ships as .m4a PIECES (see `music`)
//   music       MusicDef beds crossfade (1.2 s). The main stem starts as soon as IT decodes (a slow layer never
//               holds the bed back); each layer joins phase-locked to the main stem at the next bar once its own
//               file is in. A layer's id gives its role: 'stem…' loops on its own length, always on (the menu's
//               independent stems, tokens.audio.beds.menu.stemsS); 'phase_<p>' follows musicPhase() (the draft:
//               every phase layer up to and including <p>, in content order, fades in on the next bar);
//               'urgency_…' follows musicUrgency() (your last seconds to pick, fast in and out); draft(s) drives both from
//               the draft screen (s.phase 'ban' | 'pick' | 'finalize' → the 'phase_<p>' layers, s.urgent); until the client
//               calls musicPhase() for a bed, the bed walks its phases itself on the old through-composed arc
//               (AUTO_PHASE_S: the first phase layer from 16 s, the last from 80 s); any other layer is
//               the combat layer, faded by the match's combat intensity (enter above 0.6, leave below 0.35
//               after 8 s, quantised to the bar). duck() pulls the bed −8 dB under a moment (the ready check).
//               'objective…' (closing AUD-C4) loops on its own length, locked to the bed's bars, and fades by the
//               listener's distance from a living epic objective (WorldView.objectives; full within OBJ_INNER_M,
//               silent past OBJ_OUTER_M, OBJ_FADE_S time constant, not quantised), and out when the objective falls.
//   acts        (closing AUD-C4) a match bed (a combat layer, MUSIC_SECTIONS sections of MUSIC_SECTION_BARS on its main
//               stem) is a horizontal score: MUSIC_ACTS names the sections each act of the match plays, in order. No
//               section is a file of its own, so an act costs no decoded audio: at a section's end the main stem and
//               its synced layers carry on into their own next section when the act's order says so, and otherwise a
//               second source of the SAME buffers takes over at the chosen section, an equal-power cross-fade of
//               SECTION_XF_S ending on the downbeat (each section's head carries the tail of a suspension, so
//               the fade passes tails, not onsets; audio/build_music.py renders and QAs every joint). The choice is
//               made SECTION_LOOKAHEAD_S ahead; a timer too late for that (a background tab) leaves the stem running on
//               into its own next section, which is the whole loop as composed. The act only rises within a match:
//               by its clock (ACT_CLOCK x the mode's rules.suddenDeathAt, else rules.end.timeLimit) or by the share
//               of its structures down (ACT_LOST), and a bed that starts mid-match walks there from its head.
//               The .m4a path's pieces play the loop as composed; the acts begin once the stitched stem has taken over.
//               The bed's `pieces` ({ at, file }; older content: 'seg_<at>' layers) are the main stem's .m4a pieces,
//               for the .m4a path only (the .ogg path never fetches one): `at` = where the piece starts on the bed's
//               timeline (audio/build_music.py cuts them
//               from the same master: 16 s first, then doubling to 64 s, each running on SEG_OVERLAP_S into the
//               next). There the main stem plays piece by piece, the first starting the bed and each next one
//               cross-fading in over the run-on of the one before; once all are in they are stitched into one
//               buffer (the run-ons cross-faded) that takes over at the last piece's start and loops; only then
//               do the layers start decoding. The stitched stem is kept, so the bed's next start is immediate
//   listener    spatial cues are heard from the CAMERA's ground focus (CONTRACT §11 'listener at the camera
//               target'; listener(): the renderer's focus, wired in boot/main.ts; without one, your fighter):
//               full volume within LISTEN_INNER_M (the whole screen at default zoom), rolled off to silence
//               at LISTEN_HEAR_M by 2D distance, panned at most ±PAN_MAX (screen x is world x: the camera
//               never yaws), and gently low-passed beyond LPF_FROM_M. So a fight you watch while dead or
//               scouting sounds where you look. The AWARENESS pass keeps a threat to your LIVING fighter
//               audible wherever the camera is: an enemy's cast / attack / wind-up within AWARE_M of you, and
//               what lands on you, never drop below AWARE_GAIN and are not low-passed
//   match       attach(client): SimEvents become cues, placed by the listener above; ability cues come from the
//               catalog (`present.sfx` / `hitSfx` / event `sfx`), the rest from the generic set
//               (c_* combat, m_* match events), so content can re-voice any ability without code.
//               Team-private comms stay private: a ping sounds only when a player of YOUR team made it, and a
//               surrender vote / its outcome only for the team voting (the HUD shows neither for the other
//               team; online play is lockstep, so every client receives every seat's commands). Heals: a
//               lifesteal / omnivamp heal (a unit healing itself in the tick of its own damage) is not voiced, and
//               one target's heals within HEAL_MERGE_S are one chime. Only a fighter's heal chimes, and only a
//               heal of at least HEAL_MIN_FRAC of its max HP that does not follow another heal on it within
//               HEAL_CHAIN_S (closing AUD-C5): a repeat chain (a flask, a regen zone) chimes on its first tick and
//               small item sustain (an on-kill or on-hit heal) is silent; an item active's cast plays its
//               present.sfx (the flask's one drink). A fighter's death is heard team-relative: yours
//               ('selfDown'), an ally's ('allyDown'), an enemy fighter's ('enemyDown', a rising answer; AUD-C6).
//               Vision (AUD-C9): an ability or item active that summons a ward unit plays 'wardSet' on its cast
//               (not the shared summon cue), a ward's end (killed, or its time up) 'wardOut' and a summon's
//               'summonOut', where it stood (fog-gated like every death)
//   dead        while your fighter is down the music bed closes to DEAD_LPF_HZ and DEAD_DB (a muffled world you
//               watch from outside) and opens again on the respawn (closing AUD-C4)
//   kits        a fighter's own sounds (final parity AUD-1): content names them f_<fighter>_<slot>, slots
//               attack_swing · attack_hit · a1 · a2 · a3 · ult_windup · ult_release · passive · death · call · hit ·
//               dash, and
//               the engine resolves them BEFORE the catalog's present.sfx / hitSfx and the generic roles, so a
//               fighter is told apart by ear without touching content/fighters. attack_swing on its 'attack',
//               attack_hit on its basic attack's 'damage' (under the crit cue on a crit), a1-a3 on the slot's
//               'cast' (whatever form the ability is in), ult_windup on the ult's 'cast', ult_release on the
//               cast's first effect (area · projectile · hit · damage of that ultimate, or the caster's dash /
//               blink) at or after its wind-up ends. A release with no effect event (a leap that cannot start)
//               falls back on the sim's own commit, the ult's cooldown starting, at the end of that tick's batch;
//               a wind-up cancelled by CC or death commits nothing and stays silent. An area release sounds where
//               the area lands, the rest at the caster. hit is the fighter's own ability impact (every 'hit' of its
//               abilities on a unit not of its team: an ally's or its own touch by a haste line, a dome or a mend, ticking
//               every 0.5 s, is voiced by its buff / heal / shield and the zone's loop, and as impacts it was up to 41 % of
//               the sfx energy in a match, closing r3; before the ability's present.hitSfx; a hitSfx that content binds to a damage-type or crit
//               role, SEMANTIC_HIT_ROLES, still sounds under it at SEMANTIC_KIT_GAIN, so a true-damage or crit
//               ability keeps that timbre; (max2 SFX-4) a slot's own impact, f_<fighter>_<slot>_hit (the ult's and the
//               heaviest Q/W/E's, when content binds one), voices that slot's 'hit' in its place), dash its own dash (a displacement, the 'dash' the sim
//               emits for a unit in the tick it knocks it airborne, keeps the generic one). death replaces the generic fall, passive is the
//               proc (see `procs`), call is the lock-in motif the draft plays through fighterCall(). A slot content
//               has no cue for falls back to the catalog's present and then the generic set, as before. A cue's
//               round-robin takes are picked at random but never the same take twice in a row.
//               As heard (closing AUD-C1): an area / zone of a kitted fighter's OWN ability (its kit, its passive,
//               its forms; by ability id, whoever the caster entity is) never plays a library cue under the kit:
//               it plays the cue content binds to its vfx ('area.<vfx>', the fighter's own landing, e.g. a zone's
//               delayed topple) or a present.sfx in the fighter's own namespace (f_<fighter>_…), else nothing (the
//               kit's cast cue already carries the gesture, its delayed landing timed from content, and the ult's
//               release lands on that very area). The generic projectile whoosh is skipped under a kitted ult's
//               projectile for the same reason (the release is its sound)
//   epic        an epic objective (closing AUD-C3) has a kit like a fighter's: content names u_<unit>_<slot>,
//               slots attack_swing · attack_hit · cast · a1..a4 (the unit's abilities in order, as the sim slots
//               them) · a1_land..a4_land · hit · roar · death · presence. A unit with any u_<unit>_* cue is KITTED:
//               its autos play at a fighter's multipliers (not the monster's), its casts play a<n> (else cast),
//               its ability areas play a<n>_land (the cue carries the area's delay up to the landing), its
//               ability hits play hit, its death plays death, and nothing of it falls back on a library cue
//               (castMonster, monsterDeath, a present.sfx, the generic projectile whoosh). roar sounds at the unit
//               when its objective (WorldView.objectives) comes alive and when it is struck after ROAR_CALM_S
//               untouched (someone starts it); presence is a loop on the ambience bus at the objective's pit
//               while it lives (an emitter like the map's, built from WorldView.objectives: public knowledge, the
//               HUD shows the timers)
//   memory      (closing PERF-C2, audio half) decoded audio is 48 kHz float PCM, so nothing piles up across a
//               session: a bed change frees the previous bed's decoded files (main stem, layers, the stitched
//               .m4a stem) once the new bed is chosen, and a match change (attach) frees every cue buffer but the
//               UI set and the playing bed's. The fighters' lock-in calls (f_<fighter>_call, ui bus) are not of the
//               UI set: they decode when a draft opens (draft(s)) and are freed when it closes (draft(null)) or at
//               the match change. A voice still sounding keeps its own buffer until it ends
//   procs       every 'proc' (a passive fired) sounds at its subject (dst, else the owner): a fighter's passive
//               plays the per-fighter cue f_<fighter>_passive when content has one, else the passive's own
//               present.sfx / hitSfx; an item / boon / team-buff / unit passive plays its present.sfx / hitSfx,
//               else the role 'proc.<item|boon|team|unit>'. The proc IS the payoff's sound: passive damage dealt
//               without a delivery (no 'hit') is voiced by the proc that follows it in the same tick. A periodic
//               trigger (interval, moveDistance) reminds at most every PROC_PERIODIC_S per owner, the rest at most
//               every PROC_GAP_S per passive and owner (an item's generic 'proc.item' every PROC_ITEM_GAP_S, PROC_ITEM_DB
//               down: the attack it rides already sounds). `procStats` counts what became of every proc (dev / probes)
//   ambience    the map's world: content's audio.ambience[<map id>] lists { source, cue } → a looping cue on the
//               ambience bus (older content: events 'ambient.<map id>.<source>' → cue; the emitter keeps that label).
//               <source> names an art.ambient group of that map (an effect's vfx, a critter id, a prop's fx vfx
//               or its model's file name): the loop sounds from EVERY point of the group, heard from the
//               listener (full within AMB_INNER_M of a point, silent past AMB_HEAR_M; nearby points add up by
//               energy, capped at full; panned toward them), so the sound sits where the look sits and follows
//               any move of the art. <source> 'bed' is the map-wide bed (not spatial). One voice per emitter,
//               started at a random point of its loop when the match attaches, faded out when it detaches;
//               the whole bus is ducked up to AMB_DUCK_DB under a FIGHT (fighter-vs-fighter damage near the
//               listener or your living fighter; a wave being cleared does not duck the world)
//   world       the world's own moments, each an engine role content binds (unbound: silent, as before): a
//               structure's shield (the Dawn Seal setting again on its beat) plays 'shieldStructure' at it, else
//               'shield'; when a mode's Dawn Seal ends (rules.dawnSeal.until) 'sealBreak' sounds at every standing
//               sealed structure; each Gorge Wind step (WorldView.gorgeWind rising) plays 'gorgeWind' once, centred;
//               an announce key bound as 'world.<key>' (the Noon Toll's hour-bell) plays that cue at once instead
//               of an announcer line, so it neither waits in the queue nor ducks the mix; an area with no sfx of its
//               own sounds 'area.<its vfx>' (a passive's area: Vashil's chord); a blow the Ringshade muffled (the
//               damage event's `shaded`, on a structure: too few of the striker's Wicks guard it) plays 'hitShaded'
//               with the hit under it at SHADED_GAIN, an ability's kit 'hit' too (the same tick's shaded damage)
//   stream      (round 5 AUD-4) a match bed's main stem and combat layer (160 s of stereo each: 2 x 59 MB decoded whole) are
//               kept compressed (about 2.5 MB each) and play by SECTION WINDOWS: section k of each, decoded with
//               WebCodecs (src/audio/opus_stream.ts) with STREAM_HANDLE_S either side, one source per stem per section.
//               The next section is chosen SECTION_LOOKAHEAD_S ahead by the act's order, as a whole bed's jumps are,
//               and its window is decoded ahead (the act's next at the section's start; a new act's choice at the
//               decision, about 65 ms a window); a jump is the same equal-power SECTION_XF_S fade ending on the downbeat
//               over the same samples (the window's head is the master's tail before the section), the natural next
//               section a SEG_OVERLAP_S linear fade over identical samples. A window is the whole decode's samples
//               (_harness/fw_r5_aud_stream.mjs: bit-exact or under -115 dB). At most the playing section and the next
//               are held, three windows for a moment when the act changes its choice: 2 x 12.5 MB a window. A window's
//               buffers are decoded into again once no source plays them and no window holds them (STREAM_POOL per stem),
//               so a section change leaves no 25 MB of garbage waiting for the collector (a match's polls read 0-2 windows
//               of it, 156-226 MB, before the pool). The bed's held memory (musicStream.heldMb, decoded()) is every
//               buffer once: windows cached, buffers sources still play, the pool (round 6 AUD-6). Only an .ogg
//               session on a 48 kHz context with an Opus AudioDecoder streams; anything else (and a stem that fails to
//               parse or decode) decodes the bed whole, as before. The objective layer (one section long) is whole.
//               A bed of independent loops (a main stem and 'stem…' layers only: the menu, the post-game) streams the same
//               way, one CHAIN per stem of LOOP_WINDOW_S windows, each always on to its next window (the menu: 64 + 48 + 80 s,
//               74 MB whole, about 38 MB held); a bed with synced phase / urgency layers (the draft, 32 s) stays whole
//   release     (round 5 AUD-3) a source the engine stops (a bed, a voice, an emitter, a jump's old source) lets go of its
//               buffer and leaves the graph once its fade is due by WALL clock: a stalled or switched output device (Bluetooth
//               headphones gone, a sleeping device, a held coreaudiod) freezes the context clock, so a stop scheduled on it is
//               never reached and the source would stay a pending activity holding its decoded file for the session (a
//               bed is 12-61 MB). The engine watches the clock (CLOCK_*): while it stands still (or the context is not
//               running) a stop frees at once and no new one-shot starts; a one-shot is also freed at its natural end by wall
//               clock. When the clock moves again (statechange, devicechange, the watch) the bed the screen wants is the one
//               playing, once: a retired bed's sources have no buffer left to sound. A source still sounding until a
//               successor already scheduled takes over (a section window's hand-over, a whole bed's jump: 'hand') and a
//               bed piece are the music itself, so a stall keeps them until their own time comes, and the music goes
//               on at once when the clock is back (round 6 AUD-5; their bed stopping makes them plain stops)
//   reuse       (round 6 AUD-7) where beds stream, a bed decoded whole (the draft, the objective layer) decodes through
//               OpusStem into a buffer of its loop plus a STREAM_HANDLE_S handle each side (the loop's own head again,
//               never played: the loop ends at the file's length). That is the shape of a section window of the same
//               length, so when such a bed stops for a bed that streams windows of that shape (the draft for a match
//               bed) it fades out over HAND_FADE_S and hands its buffers over: the match bed's first windows decode
//               into them (waiting HAND_WAIT_S at most) instead of the collector freeing 47 MB up to 100 s later. What
//               is not taken is let go at once
// The context starts suspended (browser autoplay rules) and resumes on the first pointer/key gesture.

import type { MatchClient } from '../contracts/session.ts';
import type { SimEvent } from '../contracts/sim.ts';
import type { AudioPort, DraftMusicState } from '../ui/audio_port.ts';
import { OpusStem } from './opus_stream.ts';

type Bus = 'music' | 'sfx' | 'ui' | 'voice' | 'ambience';
interface CueDef { files: string[]; bus: Bus; gain: number; pitchVar: number; maxVoices: number; priority: number; spatial: boolean; loop: boolean; cooldown: number }
interface MusicDefT { file: string; bpm: number; loopStart: number; loopEnd?: number; gain: number; layers: { id: string; file: string }[];
  pieces?: { at: number; file: string }[] }
interface PresentLike { sfx?: string; hitSfx?: string }
/** an ability as the audio reads it: its present, and what makes its wind-up a T3 threat (see `threat` in the header) */
interface AbilityLike { id: string; present?: PresentLike; castTime?: number; effects?: unknown[] }
interface PassiveLike { id: string; present?: PresentLike }
/** a map's art.ambient (render/ambient.ts draws it; the audio reads its points): [x, y, …] per placement */
interface AmbientLike {
  effects?: { vfx: string; at: number[][] }[];
  critters?: { id: string; spots: number[][] }[];
  props?: { model: string; at: number[][]; fx?: { vfx: string } }[];
}
interface CatalogLike {
  audio: { cues: Record<string, CueDef>; music: Record<string, MusicDefT>; events?: Record<string, string>;
    ambience?: Record<string, { source: string; cue: string }[]>; ui?: Record<string, string>; m4a?: Record<string, string> };
  fighters: { id: string; attack?: { present?: PresentLike };
    kit: Record<string, (AbilityLike & { forms?: Record<string, { kit?: Record<string, AbilityLike | undefined> }> }) | undefined> }[];
  units?: { id: string; kind?: string; attack?: { present?: PresentLike }; passive?: PassiveLike; abilities?: { id: string }[] }[];
  items?: { id: string; passives?: PassiveLike[]; active?: AbilityLike }[];
  setup?: { boons?: PassiveLike[] };
  teamBuffs?: { id: string; passives?: PassiveLike[] }[];
  maps?: { id: string; art?: { ambient?: AmbientLike } }[];
  /** the Dawn Seal's end (see `world` in the header): rules.dawnSeal of each mode */
  modes?: { id: string; rules?: { dawnSeal?: { units: string[]; until: number }; suddenDeathAt?: number; end?: { timeLimit?: number } } }[];
}
type PassiveKind = 'fighter' | 'item' | 'boon' | 'team' | 'unit';
/** what became of a proc: played, held back by its owner's window, the cue's own cooldown or its voices, out of
 *  earshot, fogged, or `unbound` (no cue anywhere: the one outcome the probes fail on) */
type ProcOutcome = 'played' | 'throttled' | 'cooldown' | 'voices' | 'culled' | 'unseen' | 'unbound' | 'off';
/** one ambience emitter (see `ambience` in the header) */
interface Emitter {
  role: string; cue: string; def: CueDef; pts: { x: number; y: number }[];
  src: AudioBufferSourceNode | null; gain: GainNode; pan: StereoPannerNode; lpf: BiquadFilterNode;
  att: number; panV: number; lpfV: number; started: boolean;
}
/** Settings.audio; `mono` and `softenLoud` are the accessibility options (absent: off; session/settings.ts) */
interface AudioSettings { master: number; music: number; sfx: number; voice: number; ui: number; ambience: number; muteInBackground: boolean;
  mono?: boolean; softenLoud?: boolean }
/** one announcer line waiting for the voice bus (see `announcer` in the header) */
interface AnnItem { cue: string; band: number; rank: number; key: string; t: number; born: number }
/** a bed layer (see `music` in the header) */
type LayerRole = 'combat' | 'stem' | 'phase' | 'urgency' | 'objective';
interface BedLayer { id: string; role: LayerRole; file: string; gain: GainNode; src: AudioBufferSourceNode | null; srcGain: GainNode | null; buf: AudioBuffer | null }
/** the playing bed: `t0` = when its main stem started at position 0 (ctx time; null until it decodes), `len` its loop
 *  length; `pieces` = the .m4a path's piece sources until the stitched main stem takes over (see `music`) */
interface Bed { id: string; def: MusicDefT; main: AudioBufferSourceNode | null; mainGain: GainNode | null; t0: number | null; len: number; gain: GainNode;
  layers: BedLayer[]; pieces: { src: AudioBufferSourceNode; gain: GainNode }[];
  /** the acts (see `acts` in the header): sections play only from this time on (the .m4a path's take-over), the last
   *  section end decided, a jump scheduled and not reached yet (`t0` = the bed's t0 from `at` on), what was decided */
  actsFrom: number | null; decided: number; jump: { at: number; t0: number } | null; sections: { at: number; from: number; to: number; jump: boolean; act: number }[];
  /** a streamed bed's chains (see `stream` in the header); empty: the bed decodes whole */
  streams: Stream[] }
/** one streamed stem: the compressed file, where its sections sound (the main stem's gain or the combat layer's) */
interface StreamStem { file: string; stem: OpusStem; dest: GainNode; layer: BedLayer | null }
/** one section as it plays: section `k` of every streamed stem from ctx time `T` (its downbeat) */
interface Seg { k: number; T: number; srcs: { st: StreamStem; src: AudioBufferSourceNode; g: GainNode }[] }
/** a window: section k's buffers per stem (null: that stem's window failed), settled or not */
interface Win { p: Promise<(AudioBuffer | null)[]>; v: (AudioBuffer | null)[] | null }
/** a chain: stems on one timeline of `n` windows of `secS` s; `acts`: the windows are a match bed's sections, chosen by
 *  the act; `main`: it carries the main stem (it starts the bed) */
interface Stream { stems: StreamStem[]; secS: number; n: number; acts: boolean; main: boolean; win: Map<number, Win>; cur: Seg | null; next: Seg | null; stopped: boolean;
  /** window buffers no window or source holds any more, per stem, decoded into again (a window's memory is reused, not
   *  left to the collector: STREAM_POOL per stem), and what holds each buffer now (windows cached + sources playing it) */
  pool: AudioBuffer[][]; holds: Map<AudioBuffer, number>;
  /** pool buffers a window is being decoded into (neither pooled nor held until it settles) */
  busy: Set<AudioBuffer>;
  /** dev / probes: windows decoded, their decode times (ms), the most windows held at once, the most MB the chain ever
   *  held at once (windows + buffers sources play + pool: streamBuffers) */
  stats: { decoded: number; ms: number[]; maxHeld: number; late: number; maxHeldMb: number } }
/** a main stem's .m4a piece: `at` = where it starts on the bed's timeline (s) */
interface BedPiece { at: number; file: string }
interface EntityLike { id: number; kind: string; def?: string; team: number; x: number; y: number; visibleMask?: number; alive?: boolean;
  maxHp?: number; shield?: number;
  statuses?: readonly { kind: string; src?: number }[] }
/** a spatial cue's placement around the listener */
interface Place { att: number; pan: number; lpf: number; d?: number }
/** per-play options: `aware` = a threat to your fighter (the awareness pass applies, and the voice-bus duck spares
 *  it); `onVoice` hears the voice once its file is decoded and started (the announcer times its line by it) */
interface CueOpts { aware?: boolean; lift?: number; onVoice?: (v: Voice, buf: AudioBuffer) => void;
  /** (max2 SFX-1b) the source is your own fighter: its kit cues play OWN_KIT_DB over the rest (see `mix focus`) */
  you?: boolean;
  /** (max2 SFX-1b) the source is a camp monster (not an epic unit): its cues play CAMP_DB under (see `mix focus`) */
  camp?: boolean;
  /** a playback-rate multiplier over the cue's own pitchVar (the gold ladder's step-up) */
  rate?: number }

export interface ValeAudioPort extends AudioPort {
  attach(client: MatchClient | null): void;
  /** the fighter's lock-in call (f_<fighter>_call, see `kits` in the header); false when content has none, and the
   *  UI keeps its generic lock-in alone */
  fighterCall(fighter: string): boolean;
  /** where spatial cues are heard from: the camera's ground focus in sim units (x, y), or null to hear from your
   *  fighter (no renderer). boot/main.ts passes the renderer's listenerFocus() */
  listener(focus: (() => { x: number; y: number } | null) | null): void;
  settings(s: AudioSettings): void;
  /** the draft's phase (the bed's 'phase_<p>' layers, see `music` in the header); null: the main stem alone. Reset
   *  when the bed changes, so call it after music() */
  musicPhase(phase: string | null): void;
  /** your own last seconds to act in the draft (tokens.audio.beds.draft.localUrgencyLastS): the 'urgency_…' layer */
  musicUrgency(on: boolean): void;
  /** the draft as the music hears it (AudioPort.draft): phase <p> = the bed's 'phase_<p>' layers (none for the bans),
   *  urgent = the 'urgency_…' layer; kept across bed changes until draft(null), so the order against music() is free */
  draft(s: DraftMusicState | null): void;
  readonly log: string[];
  /** the session's file format: null until the first .ogg decodes (or fails) */
  readonly format: 'ogg' | 'm4a' | null;
}

const BUSES: Bus[] = ['music', 'sfx', 'ui', 'voice', 'ambience'];
const XFADE_S = 1.2;
const LISTEN_INNER_M = 12;   // full volume within this of the camera focus (the screen's half-width at default zoom: 11.7 m)
const LISTEN_HEAR_M = 30;    // silent beyond this (2D distance from the focus), unless the awareness pass keeps it
const PAN_MAX = 0.6;         // moderate panning (r07 §4.4): a cue at the screen edge pans about ±0.58
const PAN_M = 20;            // metres from the focus to PAN_MAX
const LPF_FROM_M = 15;       // beyond this a gentle low-pass: LPF_HI_HZ at LPF_FROM_M falling to LPF_LO_HZ at LISTEN_HEAR_M
const LPF_HI_HZ = 16000;
const LPF_LO_HZ = 3500;
const AWARE_M = 10;          // the awareness pass: threats within this of your living fighter …
const AWARE_GAIN = 0.8;      // … play at least this loud (−2 dB), unfiltered
const NEAR_COMBAT_M = 14;    // fighter damage within this of the listener (or of your living fighter) feeds the combat layer
const MAX_VOICES = 32;       // the global budget (r07 §4.3: 32-48 in a browser): past it the lowest-ranked voice yields
const HEAL_MERGE_S = 0.25;   // one target's heals within this are one chime
const LEAD_SKIP_S = 0.004;   // a one-shot starts this far into its file: audio/build.py pads 5 ms of silence before every
                             // one-shot (LEAD_S, the codec's pre-echo room); skipping 4 ms of it under a LEAD_RAMP_S
const LEAD_RAMP_S = 0.001;   // fade-in brings the hit 4 ms closer to its frame (closing critic 'audio-runtime')
const HEAL_MIN_FRAC = 0.05;  // a heal tick chimes only at this share of the target's max HP or more (closing AUD-C5) …
const HEAL_CHAIN_S = 1.2;    // … and not when the same target was healed this recently (a repeat chain: its first tick)
// the mixer (see `buses` / `ducking` in the header)
// (max2 SFX-1b: 3.0 -> 3.5) round 1's live captures put the master at -19.6 to -20.2 LUFS on 3 of 5 (tokens -18 +/- 1.5):
// in a quiet stretch the master is mostly the ambience bed and the music, so an sfx-only lift moved it 0.4 dB for 2.4 dB
// of sfx (and cost a teamfight seat the announcer's 3 dB margin); the whole mix's makeup moves every seat alike
const MIX_TRIM_DB = 3.5;     // the engine's mix makeup after the master volume, before the limiter (see `buses`)
// mix focus (max2 SFX-1b): the fighters' kits were under half of the heard sfx on a jungle-heavy seat (library camp
// cues: c_cast_big, c_monster_fall, c_hit_magic, c_slam). A MOBA mix leads with the player's own hero: your fighter's
// kit cues play OWN_KIT_DB over everyone else's, and a camp monster's own sounds (its casts, abilities, blows and fall;
// never an epic unit's kit) CAMP_DB under
const OWN_KIT_DB = 1.0;
const CAMP_DB = -3;
const OWN_KIT_GAIN = Math.pow(10, OWN_KIT_DB / 20);
const CAMP_GAIN = Math.pow(10, CAMP_DB / 20);
const CLIP_KNEE = 0.7;       // the soft clip is linear up to −3.1 dBFS …
const CLIP_CEIL = 0.891;     // … and bends everything above into −1 dBFS
const VOICE_DUCK_DB = 6;     // music and ambience under an announcer line …
const SFX_DUCK_DB = 3;       // … and the sfx bus (threats to your fighter excepted) …
const SFX_DUCK_NEWS_DB = 6;  // … this much under a band 1-3 line (a wipe, takedown news, structures, objectives) …
const ANN_LIFT_DB = 8;       // … whose line also plays this much over its cue gain: the line wins a teamfight (closing AUD-C7:
                             // two 7-minute RIFT captures put the sfx short-term p99 at -17.0 / -14.7 LUFS, the lines at +5 dB at -13.3;
                             // 8 since closing r3: a caster's seat sits about 2 LU hotter than a brawler's, and +7 left it 0.01 dB under the bar)
const ANN_LIFT_BANDS = 3;    // bands 1..this are the news lines
const DEAD_LPF_HZ = 900;     // the music while YOUR fighter is down: low-passed here and DEAD_DB quieter (closing AUD-C4) …
const DEAD_DB = -3;
const DEAD_IN_S = 0.35;      // … closing over this time constant, opening again on the respawn
const DUCK_IN_S = 0.01;      // time constants: in fast (r07 §4.2: 10-30 ms attack), out over a few hundred ms
const DUCK_OUT_S = 0.12;
const SOFT_THRESHOLD_DB = -26;   // `soften`: a gentle compressor between the mix and the master volume …
const SOFT_RATIO = 3;
const SOFT_KNEE_DB = 12;
const SOFT_MAKEUP_DB = -1.5;     // … and the gain after it that holds the average loudness (see `buses`)
// the announcer (see `announcer` in the header)
const ANN_TTL_S = [1.5, 4, 4, 3, 3, 3];   // per band: a line that waited longer is dropped (r07 §2.2.4: 2-4 s)
const ANN_PREEMPT = 1;       // bands up to this cut a playing line of a lower band short …
const ANN_CUT_S = 0.15;      // … with this fade
const ANN_TAIL_S = 0.6;      // the next line may start this long before the playing file ends (its ring-out) …
const ANN_MIN_S = 0.6;       // … but never sooner than this after it started
// the acts of a match bed (see `acts` in the header; audio/build_music.py reads these three definitions for its joint QA)
const MUSIC_ACTS = [[0, 1, 4], [0, 1, 2, 4], [1, 2, 3, 4]];
const MUSIC_SECTION_BARS = 16;
const SECTION_XF_S = 0.25;
const MUSIC_SECTIONS = 5;
const SECTION_LOOKAHEAD_S = 3;
const STREAM_SR = 48000;          // a streamed bed decodes at Opus's own rate: only a 48 kHz context streams (see `stream`)
const STREAM_HANDLE_S = 0.3;      // a section window runs on this far either side of its section (>= SECTION_XF_S + margin)
const STREAM_POOL = 2;            // window buffers kept per stem for the next decode (see Stream.pool)
const LOOP_WINDOW_S = 16;         // a bed of independent loops (the menu, the post-game) streams by windows of this (s)
const HAND_FADE_S = 0.6;          // a whole bed handing its buffers to the next bed's windows fades out over this (see `reuse`)
const HAND_WAIT_S = 1.5;          // … and the next bed's first window waits at most this long for them
const SPARE_S = 6;                // buffers handed over and not taken are let go after this (s)
const ACT_CLOCK = [0.2, 0.4];    // the next act's start, as a share of the mode's clock …
const ACT_LOST = [0.15, 0.4];    // … or of its structures down, whichever comes first
const OBJ_INNER_M = 10;          // the objective layer is full within this of a living epic objective …
const OBJ_OUTER_M = 22;          // … and silent past this: a road beside a pit (19-25 m on RIFT) hardly lifts it
const OBJ_FADE_S = 1;            // its time constant
const AUTO_PHASE_S = [16, 80];   // a bed's phases walk themselves (first, last phase layer) until musicPhase() drives them
const SEG_OVERLAP_S = 0.03;  // a main stem's .m4a piece runs on this far into the next (audio/build_music.py PIECE_OVERLAP_S)
const YOU_CC_GAIN = Math.pow(10, 3 / 20);   // +3 dB: a control status landing on YOU
// repetition (max SFX-3): a spatial sfx one-shot with a pitchVar (the combat cues that repeat) also varies its gain by up to
// ±GAIN_VAR_DB per play, and the same cue again within REPEAT_S of its last start plays REPEAT_DB down and up to
// REPEAT_JITTER_S late, so a stack of hits blurs instead of flamming (one random number per play)
const GAIN_VAR_DB = 1.2;
const SHIELD_BREAK_GAP_S = 0.5;   // one target's shield breaks sound at most this often (max SFX-7)
// the map's room (max SFX-9): a spatial sfx voice sends ROOM_NEAR_DB re its own level at half the full-volume radius,
// rising to ROOM_FAR_DB at the edge of hearing (far sounds are wetter); the room returns at ROOM_RETURN_DB
const ROOM_NEAR_DB = -20;
const ROOM_FAR_DB = -11;
const ROOM_RETURN_DB = 10;      // (a normalised ConvolverNode returns about 9 dB of energy under its input: this puts a near
                                // hit's room about 19 dB under it, a far one about 10 dB under: sfx_room_ab.py)
const SHOOTERS_MAX = 256;         // attackers remembered for a shot landing after its shooter died (max SFX-1)
const STRUCK_GAIN = 0.4;          // a structure's own answer under a blow (max SFX-5) …
const STRUCK_GAP_S = 0.15;        // … at most this often per structure
// the Gleam coins (max SFX-8): a last hit's gain, and its combo ladder (+GOLD_STEP_ST a rung within GOLD_CHAIN_S, GOLD_RUNGS high)
const GOLD_GAIN = 0.8;
const GOLD_CHAIN_S = 1.5;
const GOLD_STEP_ST = 2;
const GOLD_RUNGS = 2;
// Wick-on-Wick blows (max SFX-1): at WICK_HIT_GAIN, and at WICK_DENSE_GAIN once WICK_DENSE_N landed within WICK_DENSE_S
const WICK_HIT_GAIN = 0.32;     // (a Wick's blow on a fighter, a structure or a monster stays at the units' 0.45: it is news)
const WICK_DENSE_GAIN = 0.2;
const WICK_SWING_GAIN = 0.22;   // a Wick's own swing / shot (the other units' at 0.3)
const WICK_DENSE_N = 3;
const WICK_DENSE_S = 0.25;
const REPEAT_S = 0.12;
const REPEAT_DB = -1.5;
const REPEAT_JITTER_S = 0.004;
const LOOP_DEFAULT_S = 2.5;  // a looping cue with no stated life stops after this
const PROC_GAP_S = 0.3;      // one passive of one owner sounds at most this often (an on-hit passive on every attack)
const PROC_PERIODIC_S = 6;   // … and a periodic one (an aura's tick, a run-up stack) only reminds this often
// an item's generic proc (an on-hit item with no sound of its own, 'proc.item'): it fires on nearly every attack, whose
// own kit sound already says it landed, so it is a reminder, not a second hit (max SFX fix 1: in a Lisvel capture it was
// 12.5 % of the heard sfx, as many plays as her attacks): at most every PROC_ITEM_GAP_S per item and owner, PROC_ITEM_DB under
const PROC_ITEM_GAP_S = 1.5;
const PROC_ITEM_DB = -4;
const PERIODIC_ON = new Set(['interval', 'moveDistance']);
/** a fighter's kit slots (see `kits` in the header): content's cue f_<fighter>_<slot> */
const KIT_SLOTS = ['attack_swing', 'attack_hit', 'a1', 'a2', 'a3', 'ult_windup', 'ult_release', 'passive', 'death', 'call', 'hit', 'dash',
  'a1_hit', 'a2_hit', 'a3_hit', 'ult_hit'] as const;
type KitSlot = typeof KIT_SLOTS[number];
const CAST_SLOTS = new Set<string>(['a1', 'a2', 'a3']);
/** an epic unit's kit slots (see `epic` in the header): content's cue u_<unit>_<slot>; a1..a4 follow the unit's
 *  abilities in order (the sim slots them a1..ult) */
const UNIT_ABILITY_SLOTS = ['a1', 'a2', 'a3', 'a4'] as const;
const UNIT_SLOTS = ['attack_swing', 'attack_hit', 'cast', ...UNIT_ABILITY_SLOTS, ...UNIT_ABILITY_SLOTS.map((s) => `${s}_land`),
  'hit', 'roar', 'death', 'presence'] as const;
const ROAR_CALM_S = 10;       // a kitted unit struck after this long untouched (sim time) roars: someone started it
const RELEASE_EPS_S = 1.5 / 30;        // the sim counts the wind-up from the cast's own tick: its release lands up to
                                        // one tick before cast.t + castTime (sim time)
const CRIT_KIT_GAIN = 0.6;    // a crit: the fighter's own attack_hit under the crit cue
// an ability hit whose present.hitSfx is the cue content binds to one of these roles keeps it under the fighter's own
// impact (kit 'hit'): the damage type / crit is meaning the kit hit does not carry (a true-damage ult, a crit-shot ult)
const SEMANTIC_HIT_ROLES = ['hitTrue', 'crit'] as const;
const SEMANTIC_KIT_GAIN = 0.6;
// an ability landing on a Wick (-6 dB): a line through a wave voices one impact per Wick, and a farming caster's own
// impacts topped the mix (Lisvel: f_lisvel_hit 21 % of the sfx energy, the integrated 0.4 LU lower with this rule on one
// seeded match; _harness/probe_audio_runtime.mjs match --fighter lisvel --seed 12)
const WAVE_HIT_GAIN = 0.5;
const SHADED_GAIN = 0.55;     // a Ringshade-muffled blow: the hit under the 'hitShaded' thud (see `world`)
// a T3 wind-up (tokens.vfx.tiers.T3 'crowd control, mobility, zones', enemyWindupAudio mandatory): an ability with a
// wind-up whose effects, at any depth, control someone else (a StatusKind below, not applied to the caster), displace,
// move the caster (dash / blink) or lay a zone. StatusKind / effect op names are the contract's (src/contracts/catalog.ts)
const T3_STATUS = new Set(['stun', 'root', 'slow', 'silence', 'disarm', 'airborne', 'taunt', 'fear', 'sleep']);
const T3_OPS = new Set(['displace', 'dash', 'blink', 'zone']);
const AMB_INNER_M = 10;      // an ambience emitter's point is at full level within this of the listener …
const AMB_HEAR_M = 32;       // … and silent past this
const AMB_CALM_LIFT_DB = 3;  // the emitters away from a fight (below AMB_DUCK_FROM): a quiet seat's floor is the world's; a seat that hardly meets
                             // a fight read 0.3 LU under the mix's band with the world at 0 dB, and a loud one barely gains (closing r3;
                             // 2 -> 3 in max2 SFX-1b: a jungle seat read -19.3 / -20.2 LUFS, a brawling one -16.7 on one build) …
const AMB_DUCK_DB = 6;       // … the ambience bus under a fight: full duck at fight heat AMB_DUCK_FULL …
const AMB_DUCK_FROM = 0.2;   // … none below this (a lone poke); the heat counts fighter-vs-fighter damage only
const AMB_DUCK_FULL = 0.6;
const FIGHT_HIT = 0.12;      // fight heat per fighter-vs-fighter hit near the listener (or your living fighter) …
const FIGHT_DECAY = 0.15;    // … cooling per second
const AMB_FADE_S = 1.5;      // emitters fade in on attach, out on detach
const PROBE_MS = 10000;      // the format-deciding .ogg: other loads wait this long for its request (then the
                             // next one probes: a stalled request), and its decode counts as failed if unsettled
                             // this long after the bytes arrived (a hung decoder); neither may mute the game.
                             // Generous: boot can stall the main thread for seconds
/** a volume change's glide (τ 50 ms) from where the gain is now: earlier glides still pending are dropped first, so the
 *  last setting always wins (a stale target left in the timeline could otherwise hold a bus at an old level) */
function glide(p: AudioParam, v: number, t: number, tau = 0.05): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.setTargetAtTime(v, t, tau);
}

/** the gate roles (see `alert path` in the header): UI roles (audio.ui) and engine event roles (audio.events) */
const ALERT_UI_ROLES = ['queue_pop', 'queue_remind'];
const ALERT_EVENT_ROLES = ['countdown', 'matchStart'];
/** the alert path's lowest gain (linear, −8 dB): the queue pop (−14 LUFS momentary, about −3 dBFS sample peak as
 *  shipped) then still peaks above −12 dBFS at the output whatever the UI slider says */
const ALERT_FLOOR = 0.4;
/** the clock watch (see `release` in the header): over at least CLOCK_WINDOW_S of wall time, a context clock that moved
 *  less than CLOCK_MIN_RATE of it is stalled */
const CLOCK_WINDOW_S = 1;
const CLOCK_MIN_RATE = 0.25;
/** a retired source's wall-clock check comes this long after its stop is due (s) */
const RETIRE_SLACK_S = 0.05;

/** a one-shot, from the moment it is admitted (its slot is held while its file decodes: `src` null until it starts;
 *  `dead` when it was freed before starting); `rank` = priority + log10(audibility) (see `priority`); `pooled` false
 *  for the gate cues */
interface Voice { src: AudioBufferSourceNode | null; gain: GainNode | null; cue: string; bus: Bus; priority: number; rank: number; pooled: boolean;
  started: number; dead?: boolean; nodes?: AudioNode[] }
/** what a retired source is waiting for (see `release` in the header): 'stop' a fade-out asked for (freed at once when
 *  the clock stalls), 'voice' a one-shot's natural end (a stale one-shot is freed on a stall too), 'piece' a bed piece's
 *  natural end (kept through a stall: it plays on when the clock comes back), 'hand' a bed source playing on until its
 *  successor, already scheduled, takes over at `at` (a section's window, a whole bed's jump: round 6 AUD-5). A hand-over
 *  is the music still sounding, so a stall keeps it unless its time has come; once its bed stops it is a 'stop' */
type RetireKind = 'stop' | 'voice' | 'piece' | 'hand';
/** a retired source not freed yet (see `retire`): `owner` the bed a hand-over belongs to */
interface Dying { kind: RetireKind; at: number; src: AudioBufferSourceNode | null; owner: Bed | null;
  free(how: 'ended' | 'due' | 'stall'): void;
  /** taken over by a later retire() of the same source: forgets this entry without freeing, returns its `then` */
  cancel(): (() => void) | undefined }
/** a hand-over or a piece the clock has not reached yet is looked at again this often while the clock stands (ms) */
const HELD_RECHECK_MS = 500;

class Engine implements ValeAudioPort {
  readonly log: string[] = [];
  private ctx: AudioContext | null = null;
  /** every bus sums here, before `soften` and the master volume */
  private mix!: GainNode;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  /** dev / probes: per cue, the sum of its started voices' squared gains (what each cue adds to the mix, with its file's energy) */
  readonly heard = new Map<string, number>();
  /** MIX_TRIM_DB, between the master and the limiter (see `buses`) */
  private trim!: GainNode;
  /** `soften`'s compressor and its makeup (wired between the mix and the master while it is on) */
  private soft!: DynamicsCompressorNode;
  private softMakeup!: GainNode;
  private softOn = false;
  /** the output stage after the limiter / soft clip: 2 channels, or 1 (summed) under `mono` */
  private out!: GainNode;
  private readonly bus = new Map<Bus, GainNode>();
  /** the voice-bus duck after a bus (music, ambience, sfx; see `ducking` in the header) */
  private readonly vduck = new Map<Bus, GainNode>();
  /** threats to your fighter: the sfx bus's volume, past its duck */
  private threat!: GainNode;
  /** the alert path, one gain per bus, straight into the limiter (see `alert path` in the header) */
  private readonly alertBus = new Map<Bus, GainNode>();
  /** the cue ids content binds to the gate roles */
  private readonly alertCues: Set<string>;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** what each buffer promise settled to, once it has: a decoded cue starts in the event's own call (see `sync`) */
  private readonly settled = new WeakMap<Promise<AudioBuffer | null>, AudioBuffer | null>();
  private readonly voices: Voice[] = [];
  private readonly lastPlay = new Map<string, number>();
  private readonly wickHits: number[] = [];                    // recent Wick-on-Wick blows near the ear (wickDuck)
  private readonly shieldBroke = new Map<number, number>();     // a target's last shield break (context time)
  private readonly shooters = new Map<number, EntityLike>();    // the last attackers, as they were (SHOOTERS_MAX)
  private readonly struckLast = new Map<number, number>();     // a structure's last struck answer (context time)
  private roomIn: GainNode | null = null;                       // the shared room send (see ROOM_NEAR_DB) …
  private room: ConvolverNode | null = null;
  private roomOn = false;                                       // … live once the map's response is loaded
  private goldRung = 0;                         // the Gleam ladder's rung, and its last last hit (context time)
  private goldLast = -1e9;
  private vol: AudioSettings;
  private readonly cues: Record<string, CueDef>;
  /** engine event role → cue id (content/audio.json `events`) */
  private readonly events: Record<string, string>;
  private readonly beds: Record<string, MusicDefT>;
  /** map id → its ambience emitters (content/audio.json `ambience`; see `ambience` in the header) */
  private readonly ambienceOf: Record<string, { source: string; cue: string }[]>;
  private readonly url: (ref: string) => string;
  /** .ogg ref → its .m4a sibling (catalog audio.m4a, written by the content build) */
  private readonly alt: Record<string, string>;
  private fmt: 'ogg' | 'm4a' | null;
  /** the first .ogg decode while the format is undecided; other loads wait for it */
  private probe: Promise<void> | null = null;
  private bed: Bed | null = null;
  private wantBed: string | null = null;
  /** musicPhase() / musicUrgency() (see `music` in the header) */
  private phase: string | null = null;
  private urgent = false;
  /** musicPhase() was called for this bed (else the bed walks its own phases, AUTO_PHASE_S) */
  private phaseDriven = false;
  /** the match's act and what drives it (see `acts` in the header): structures seen standing at most */
  private act = 0;
  private structuresMax = 0;
  /** the objective layer's level (see `music` in the header) */
  private objNear = 0;
  /** the draft's last state (draft()), null outside the draft */
  private draftS: DraftMusicState | null = null;
  // the announcer (see `announcer` in the header)
  private annQ: AnnItem[] = [];
  private annNow: { item: AnnItem; voice: Voice | null; until: number } | null = null;
  private annT: ReturnType<typeof setTimeout> | undefined;
  /** entity → the sim time of its last damage dealt (a heal in that same tick to itself is vamp) */
  private readonly dealt = new Map<number, number>();
  /** entity → the sim time it was last knocked airborne (its 'dash' in that tick is a displacement, not its own) */
  private readonly knocked = new Map<number, number>();
  /** heal target entity → ctx time of its last voiced heal */
  private readonly healLast = new Map<number, number>();
  /** this tick's ability blows the Ringshade muffled ('src:dst:ability' of a `shaded` damage event): the 'hit' that
   *  comes before its damage in the same batch plays its kit hit at SHADED_GAIN */
  private readonly shadedHits = new Set<string>();
  /** teams whose every fighter is down (a wipe, announced once until one of them is back) */
  private readonly wiped = new Set<number>();
  private duckGain!: GainNode;
  private hidden = false;
  // match
  private client: MatchClient | null = null;
  /** match time at the last update: the pre-game countdown (negative time) ticks the last 3 s, 0 starts */
  private lastT: number | null = null;
  private off: (() => void) | null = null;
  private readonly abilitySfx = new Map<string, { sfx?: string; hitSfx?: string }>();
  private intensity = 0;
  /** fighter-vs-fighter damage near the listener only (the ambience duck; `intensity` also counts wave fights) */
  private fight = 0;
  private combat = false;
  private calmFor = 0;
  private tick: number | null = null;
  /** the camera focus provider (listener()); null: hear from your fighter */
  private focus: (() => { x: number; y: number } | null) | null = null;
  /** passive id → what owns it and the cue its proc plays (undefined: the 'proc.<kind>' role decides) */
  private readonly passives = new Map<string, { kind: PassiveKind; cue?: string }>();
  /** fighter id → the kit slots content has a cue for (see `kits` in the header) */
  private readonly kits = new Map<string, Partial<Record<KitSlot, string>>>();
  /** every fighter's kit cue id (mix focus: your own play OWN_KIT_DB over) */
  private readonly kitCues = new Set<string>();
  /** the kits' lock-in calls' files (see `memory` in the header): draft-only, decoded while a draft runs */
  private readonly callFiles = new Set<string>();
  /** a fighter's own ability id (kit, passive, forms) → its fighter and slot (the as-heard area rule, see `kits`) */
  private readonly ownAb = new Map<string, { fighter: string; slot: string }>();
  /** epic unit id → its kit (see `epic` in the header); only units content gives a u_<unit>_* cue */
  private readonly ukits = new Map<string, Partial<Record<string, string>>>();
  /** a unit ability id → its unit and slot (a1..a4) */
  private readonly unitAb = new Map<string, { unit: string; slot: string }>();
  /** kitted unit entity → the sim time it was last struck (the roar, see `epic`) */
  private readonly hurtLast = new Map<number, number>();
  /** objective id → alive at the last update (its roar on coming alive) */
  private readonly objAlive = new Map<string, boolean>();
  /** objective id → its pit presence emitter while it lives (see `epic`) */
  private readonly pits = new Map<string, Emitter>();
  /** ability ids whose enemy wind-up plays the shade-breath swell (see `threat` in the header; ults always do) */
  private readonly threats = new Set<string>();
  /** ability / item-active ids that set a ward (a summon of a ward unit): their cast plays 'wardSet' (see `match`) */
  private readonly wardSetAb = new Set<string>();
  /** heal target entity → ctx time of its last heal, voiced or not (a repeat chain; see `match`) */
  private readonly healAny = new Map<number, number>();
  /** the music's dead state (see `dead` in the header): its filter, its gain, and whether it is closed */
  private deadLpf: BiquadFilterNode | null = null;
  private deadGain: GainNode | null = null;
  private deadOn = false;
  /** cue id → the index of the file it played last (round-robin never repeats a take back to back) */
  private readonly lastFile = new Map<string, number>();
  /** caster entity → its ultimate waiting for the wind-up's end (see `kits` in the header) */
  private readonly ults = new Map<number, { cue: string; ability: string; due: number; cd0: number }>();
  /** `${passive}:${owner}` → ctx time of its last sounding proc */
  private readonly procLast = new Map<string, number>();
  /** dev / probes: every proc's outcome, counted */
  readonly procStats: Record<ProcOutcome, number> = { played: 0, throttled: 0, cooldown: 0, voices: 0, culled: 0, unseen: 0, unbound: 0, off: 0 };
  private readonly maps = new Map<string, AmbientLike | undefined>();
  /** mode id → its Dawn Seal (rules.dawnSeal: the sealed units, when the seal ends; see `world` in the header) */
  private readonly seals = new Map<string, { units: string[]; until: number }>();
  /** mode id → its clock in seconds (see `acts` in the header) */
  private readonly modeClock = new Map<string, number>();
  /** the Gorge Wind steps already heard (WorldView.gorgeWind; see `world` in the header) */
  private gorgeSeen = 0;
  /** the attached match's ambience emitters (built on attach, voiced once the context runs) */
  private amb: Emitter[] = [];
  /** the attached match's map while its emitters wait for the context */
  private ambMap: string | null = null;
  private ambDuck: GainNode | null = null;
  /** the clock watch (see `release` in the header): the last baseline (wall s, ctx s) and whether the clock stands */
  private clockWall = 0;
  private clockCtx = 0;
  private stalled = false;
  /** the platform can stream a bed (OpusStem.supported, asked once the context exists; see `stream` in the header) */
  private canStream: boolean | null = null;
  private streamCheck: Promise<void> | null = null;
  /** retired sources not freed yet (see `retire`) */
  private readonly dying = new Set<Dying>();
  /** dev / probes: what the release did (freed by kind and by how: ended, due by wall clock, a stall) */
  readonly releaseStats = { retired: 0, ended: 0, due: 0, stall: 0, recovered: 0, stalls: 0, handed: 0, reused: 0 };
  /** reuse (see `reuse` in the header): a whole bed buffer's own length (s) where it runs on past it (bedBuffer); the
   *  buffers a stopped bed handed over, waiting for the next bed's windows; the hand-over the next bed's first windows
   *  wait for */
  private readonly bodyS = new WeakMap<AudioBuffer, number>();
  private spare: AudioBuffer[] = [];
  private spareTimer: ReturnType<typeof setTimeout> | undefined;
  private handing: Promise<void> | null = null;

  constructor(cat: CatalogLike, url: (ref: string) => string, settings: AudioSettings) {
    this.cues = cat.audio.cues;
    this.events = cat.audio.events ?? {};
    this.beds = cat.audio.music;
    this.ambienceOf = cat.audio.ambience ?? {};
    this.url = url;
    this.alt = cat.audio.m4a ?? {};
    this.alertCues = new Set([
      ...ALERT_UI_ROLES.map((r) => cat.audio.ui?.[r]), ...ALERT_EVENT_ROLES.map((r) => this.events[r]),
    ].filter((id): id is string => !!id));
    this.fmt = initialFormat();
    this.vol = { ...settings };
    for (const f of cat.fighters) {
      for (const a of Object.values(f.kit)) if (a?.present) this.abilitySfx.set(a.id, a.present);
      if (f.attack?.present) this.abilitySfx.set(`attack:${f.id}`, f.attack.present);
    }
    for (const u of cat.units ?? []) if (u.attack?.present) this.abilitySfx.set(`attack:${u.id}`, u.attack.present);   // Needles, Wicks, monsters
    // item actives voice their present.sfx on the cast (the flask's drink); a ward-setting one plays 'wardSet' instead
    for (const it of cat.items ?? []) if (it.active?.present) this.abilitySfx.set(it.active.id, it.active.present);
    const wardUnits = new Set((cat.units ?? []).filter((u) => u.kind === 'ward').map((u) => u.id));
    const setsWard = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.some(setsWard);
      if (!node || typeof node !== 'object') return false;
      const o = node as Record<string, unknown>;
      if (o.op === 'summon' && wardUnits.has(o.unit as string)) return true;
      return Object.values(o).some((v) => v && typeof v === 'object' && setsWard(v));
    };
    for (const it of cat.items ?? []) if (it.active && setsWard(it.active.effects)) this.wardSetAb.add(it.active.id);
    for (const f of cat.fighters) for (const a of Object.values(f.kit)) if (a && setsWard(a.effects)) this.wardSetAb.add(a.id);
    for (const f of cat.fighters) {
      const k: Partial<Record<KitSlot, string>> = {};
      for (const s of KIT_SLOTS) if (this.cues[`f_${f.id}_${s}`]) k[s] = `f_${f.id}_${s}`;
      this.kits.set(f.id, k);
      for (const id of Object.values(k)) if (id) this.kitCues.add(id);
      if (k.call) for (const file of this.cues[k.call]?.files ?? []) this.callFiles.add(file);
      // T3 wind-ups: every non-ult ability, a form's overrides included
      const abs: [string, AbilityLike | undefined][] = Object.entries(f.kit);
      for (const fm of Object.values(f.kit.passive?.forms ?? {})) abs.push(...Object.entries(fm.kit ?? {}));
      for (const [slot, a] of abs) if (a && slot !== 'passive' && slot !== 'ult' && (a.castTime ?? 0) > 0 && isT3(a.effects)) this.threats.add(a.id);
      for (const [slot, a] of abs) if (a && !this.ownAb.has(a.id)) this.ownAb.set(a.id, { fighter: f.id, slot });
    }
    // epic units (see `epic` in the header)
    for (const u of cat.units ?? []) {
      const k: Partial<Record<string, string>> = {};
      for (const s of UNIT_SLOTS) if (this.cues[`u_${u.id}_${s}`]) k[s] = `u_${u.id}_${s}`;
      if (!Object.keys(k).length) continue;
      this.ukits.set(u.id, k);
      (u.abilities ?? []).forEach((a, i) => { if (i < UNIT_ABILITY_SLOTS.length) this.unitAb.set(a.id, { unit: u.id, slot: UNIT_ABILITY_SLOTS[i] }); });
    }
    // passives (see `procs` in the header): the per-fighter cue first, then the passive's own present
    const own = (p: PassiveLike | undefined, kind: PassiveKind, fighter?: string): void => {
      if (!p) return;
      this.passives.set(p.id, { kind, cue: (fighter ? this.kits.get(fighter)?.passive : undefined) ?? p.present?.sfx ?? p.present?.hitSfx });
    };
    for (const f of cat.fighters) own(f.kit.passive, 'fighter', f.id);
    for (const it of cat.items ?? []) for (const p of it.passives ?? []) own(p, 'item');
    for (const b of cat.setup?.boons ?? []) own(b, 'boon');
    for (const tb of cat.teamBuffs ?? []) for (const p of tb.passives ?? []) own(p, 'team');
    for (const u of cat.units ?? []) own(u.passive, 'unit');
    for (const m of cat.maps ?? []) this.maps.set(m.id, m.art?.ambient);
    for (const m of cat.modes ?? []) if (m.rules?.dawnSeal) this.seals.set(m.id, m.rules.dawnSeal);
    for (const m of cat.modes ?? []) {
      const clock = m.rules?.suddenDeathAt ?? m.rules?.end?.timeLimit;
      if (clock) this.modeClock.set(m.id, clock);
    }
    const resume = (): void => { this.ensure(); void this.ctx?.resume(); };
    addEventListener('pointerdown', resume, { capture: true });
    addEventListener('keydown', resume, { capture: true });
    document.addEventListener('visibilitychange', () => { this.hidden = document.hidden; this.applyVolumes(); });
  }

  // ── setup ──────────────────────────────────────────────────────────────────────────────────────
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    this.limiter = limiter;
    const soft = ctx.createDynamicsCompressor();
    soft.threshold.value = SOFT_THRESHOLD_DB; soft.knee.value = SOFT_KNEE_DB; soft.ratio.value = SOFT_RATIO; soft.attack.value = 0.003; soft.release.value = 0.25;
    this.soft = soft;
    this.softMakeup = ctx.createGain();
    this.softMakeup.gain.value = Math.pow(10, SOFT_MAKEUP_DB / 20);
    // the output: the limiter, a soft clip where the platform has one (see `buses`), the mono switch, the speakers
    this.out = ctx.createGain();
    this.out.channelCountMode = 'explicit'; this.out.channelInterpretation = 'speakers'; this.out.channelCount = 2;
    let tail: AudioNode = limiter;
    if (typeof ctx.createWaveShaper === 'function') {
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve();
      clip.oversample = '4x';
      tail = tail.connect(clip);
    }
    tail.connect(this.out).connect(ctx.destination);
    const trim = ctx.createGain();
    trim.gain.value = Math.pow(10, MIX_TRIM_DB / 20);
    trim.connect(limiter);
    this.trim = trim;
    this.master = ctx.createGain();
    this.master.connect(trim);
    this.mix = ctx.createGain();
    this.mix.connect(this.master);
    soft.connect(this.softMakeup).connect(this.master);
    this.duckGain = ctx.createGain();
    for (const b of BUSES) {
      const g = ctx.createGain();
      this.bus.set(b, g);
      // music → the ready-check duck → the voice duck; ambience and sfx → their voice duck; ui and voice straight in
      if (b === 'music' || b === 'ambience' || b === 'sfx') {
        const d = ctx.createGain();
        this.vduck.set(b, d);
        d.connect(this.mix);
        if (b === 'music') {
          // the dead state (see `dead` in the header): open (20 kHz, unity) until your fighter is down
          const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 20000; lpf.Q.value = 0.7071;
          const dg = ctx.createGain();
          this.deadLpf = lpf; this.deadGain = dg;
          g.connect(this.duckGain).connect(lpf).connect(dg).connect(d);
        } else g.connect(d);
      } else g.connect(this.mix);
    }
    this.threat = ctx.createGain();
    this.threat.connect(this.mix);
    // the alert path joins after the master (the background mute), at the trim before the limiter
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.connect(trim);
      this.alertBus.set(b, g);
    }
    // the map's room (max SFX-9): one shared convolver the spatial sfx voices send into, returning on the sfx bus (so the
    // sfx volume and the ducks apply to it); its response is the map's 'room.<map>' cue, loaded at the match's start
    if (typeof ctx.createConvolver === 'function') {
      this.roomIn = ctx.createGain();
      this.room = ctx.createConvolver();
      this.room.normalize = true;
      const roomOut = ctx.createGain();
      roomOut.gain.value = Math.pow(10, ROOM_RETURN_DB / 20);
      this.roomIn.connect(this.room).connect(roomOut).connect(this.bus.get('sfx')!);
    }
    // the ambience emitters' combat duck, into the ambience bus
    this.ambDuck = ctx.createGain();
    this.ambDuck.connect(this.bus.get('ambience')!);
    this.applyVolumes();
    // preload the UI set (they must answer the first click)
    for (const c of Object.values(this.cues)) if (c.bus === 'ui') for (const f of c.files) if (!this.callFiles.has(f)) void this.buffer(f);
    if (this.draftS) this.draftCalls(true);
    if (this.wantBed) this.startBed(this.wantBed);
    if (this.tick === null) this.tick = window.setInterval(() => this.update(0.25), 250);
    this.streamCheck = OpusStem.supported(2).then((ok) => { this.canStream = ok; }, () => { this.canStream = false; });
    // the output device going away or coming back (see `release` in the header)
    ctx.onstatechange = () => { if (this.ctx === ctx) this.clockEvent(); };
    try { navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (this.ctx === ctx) this.clockEvent(true); }); } catch { /* no media devices */ }
    return ctx;
  }

  // ── release (see `release` in the header) ──────────────────────────────────────────────────────
  /** a source leaves: stopped at `at` (ctx time) when `kind` is 'stop' or 'hand', else it ends there on its own. Once
   *  that is due it is disconnected with `nodes` and drops its buffer, by whichever comes first: its onended, the wall
   *  clock reaching `at` while the context clock does too, the context clock standing still, or (a stop) a stall. A
   *  piece or a hand-over the clock has not reached is kept while the clock stands: it sounds on when the clock is
   *  back (round 6 AUD-5). A source retired again (a bed piece its bed's stop fades sooner) is the later retirement's,
   *  the earlier one's `then` included */
  private retire(src: AudioBufferSourceNode | null, nodes: readonly (AudioNode | null | undefined)[], at: number, kind: RetireKind, then?: () => void): void {
    const ctx = this.ctx;
    if (src) for (const d of [...this.dying]) if (d.src === src) {
      const t0 = d.cancel();
      if (t0) { const t1 = then; then = () => { t0(); t1?.(); }; }
    }
    let done = false;
    const d: Dying = {
      kind, at, src, owner: kind === 'hand' ? this.bed : null,
      free: (how) => {
        if (done) return;
        done = true;
        this.dying.delete(d);
        this.releaseStats[how]++;
        if (src) {
          src.onended = null;
          try { src.stop(); } catch { /* never started, or already stopped */ }
          try { src.disconnect(); } catch { /* not connected */ }
          try { src.buffer = null; } catch { /* the platform keeps it: the node is unreachable once ended */ }
        }
        for (const n of nodes) if (n) try { n.disconnect(); } catch { /* not connected */ }
        then?.();
      },
      cancel: () => { if (done) return undefined; done = true; this.dying.delete(d); if (src) src.onended = null; return then; },
    };
    this.releaseStats.retired++;
    if (src && (kind === 'stop' || kind === 'hand')) try { src.stop(at); } catch { /* never started */ }
    const standing = !!ctx && (this.stalled || ctx.state !== 'running');
    if (!src || !ctx || ctx.state === 'closed' || (standing && (kind === 'stop' || (kind === 'hand' && at <= ctx.currentTime)))) { d.free('stall'); return; }
    this.dying.add(d);
    src.onended = () => d.free('ended');
    let last = ctx.currentTime;
    const check = (): void => {
      if (done) return;
      const now = ctx.currentTime;
      if (now >= d.at || this.ctx !== ctx) { d.free('due'); return; }
      const still = ctx.state !== 'running' || now - last < 0.01;          // the clock stood still since the last look
      last = now;
      if (still) {
        if (d.kind !== 'piece' && d.kind !== 'hand') { d.free(ctx.state !== 'running' ? 'due' : 'stall'); return; }
        setTimeout(check, HELD_RECHECK_MS);          // it sounds on when the clock is back
        return;
      }
      setTimeout(check, Math.max(50, (d.at - now + RETIRE_SLACK_S) * 1000));
    };
    setTimeout(check, Math.max(50, (at - ctx.currentTime + RETIRE_SLACK_S) * 1000));
  }

  /** the clock watch, every update (see `release` in the header) */
  private watchClock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = performance.now() / 1000, c = ctx.currentTime;
    if (ctx.state !== 'running') { this.setStalled(true); this.clockWall = w; this.clockCtx = c; return; }
    if (!this.clockWall) { this.clockWall = w; this.clockCtx = c; return; }
    const dw = w - this.clockWall;
    if (dw < CLOCK_WINDOW_S) return;
    this.setStalled(c - this.clockCtx < dw * CLOCK_MIN_RATE);
    this.clockWall = w; this.clockCtx = c;
  }

  /** the context's state changed or an output device came or went: look at the clock afresh (a device change: the next
   *  window decides), and ask a context the platform suspended to run again */
  private clockEvent(device = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'closed') { this.dropContext(); return; }
    if (ctx.state !== 'running') {
      this.setStalled(true);
      if (device || (ctx.state as string) === 'interrupted') void ctx.resume().catch(() => {});
    }
    this.clockWall = 0;
    if (ctx.state === 'running' && !device) this.setStalled(false);
  }

  private setStalled(on: boolean): void {
    if (on === this.stalled) return;
    this.stalled = on;
    if (on) {
      this.releaseStats.stalls++;
      // every fade waiting on the clock is freed now, and every one-shot (stale by the time the clock is back); a piece
      // and a hand-over still to come are the music itself and play on when the clock is back (round 6 AUD-5)
      const now = this.ctx?.currentTime ?? Infinity;
      for (const d of [...this.dying]) if (d.kind === 'stop' || d.kind === 'voice' || (d.kind === 'hand' && d.at <= now)) d.free('stall');
      for (const v of [...this.voices]) if (!v.src && v.pooled) v.dead = true;
      return;
    }
    this.releaseStats.recovered++;
    // back: exactly the bed the screen wants (a retired bed has no buffers left to sound)
    if ((this.bed?.id ?? null) !== this.wantBed) { this.stopBed(); if (this.wantBed) this.startBed(this.wantBed); }
  }

  /** the platform closed the context (it never runs again): everything on it is let go, and the next gesture or cue
   *  builds a new one (decoded buffers are not tied to a context and stay cached) */
  private dropContext(): void {
    for (const d of [...this.dying]) d.free('stall');
    this.dropSpare();
    this.voices.length = 0;
    this.bed = null;
    const map = this.client?.setup?.map ?? null;
    this.amb = []; this.pits.clear(); this.ambMap = map;
    this.annNow = null;
    this.ctx = null;
    this.stalled = false; this.clockWall = 0; this.softOn = false;
    this.bus.clear(); this.vduck.clear(); this.alertBus.clear();
  }

  /** dev / probes: the clock watch and what the release holds */
  get releaseState(): { stalled: boolean; dying: number; stats: Engine['releaseStats']; clock: number | null; state: string | null } {
    return { stalled: this.stalled, dying: this.dying.size, stats: { ...this.releaseStats }, clock: this.ctx?.currentTime ?? null, state: this.ctx?.state ?? null };
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mute = this.hidden && this.vol.muteInBackground;
    glide(this.master.gain, mute ? 0 : this.vol.master, t);
    for (const b of BUSES) {
      glide(this.bus.get(b)!.gain, this.vol[b], t);
      // never muted in the background; floored; a master at 0 (the player's full mute) is honoured, at once (an alert
      // can be due the next instant: no glide is left for it to sound through)
      const alert = this.vol.master <= 0 ? 0 : Math.max(ALERT_FLOOR, this.vol.master * this.vol[b]);
      const ag = this.alertBus.get(b)!.gain;
      if (alert > 0) glide(ag, alert, t);
      else { ag.cancelScheduledValues(t); ag.setValueAtTime(0, t); }
    }
    glide(this.threat.gain, this.vol.sfx, t);
    // accessibility (see `buses`): mono sums to one channel the speakers up-mix; soften re-wires its compressor in
    this.out.channelCount = this.vol.mono ? 1 : 2;
    const soften = !!this.vol.softenLoud;
    if (soften !== this.softOn) {
      this.softOn = soften;
      this.mix.disconnect();
      this.mix.connect(soften ? this.soft : this.master);
    }
  }

  /** dev / harness: the accessibility state as wired (mono channels, soften in the chain) */
  get access(): { channels: number; soften: boolean } { return { channels: this.out?.channelCount ?? 2, soften: this.softOn }; }

  /** dev / harness: the output graph (the probes meter `out`: what reaches the speakers, after the soft clip; the
   *  limiter's own output is before it) */
  get graph(): { ctx: AudioContext; limiter: DynamicsCompressorNode; trim: GainNode; out: GainNode; master: GainNode; bus: Record<Bus, GainNode> } | null {
    return this.ctx ? { ctx: this.ctx, limiter: this.limiter, trim: this.trim, out: this.out, master: this.master, bus: Object.fromEntries(this.bus) as Record<Bus, GainNode> } : null;
  }

  /** dev / harness: the cue ids on the alert path */
  get alerts(): string[] { return [...this.alertCues]; }

  get format(): 'ogg' | 'm4a' | null { return this.fmt; }

  private buffer(ref: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(ref);
    if (!p) {
      const ctx = this.ctx;
      p = ctx ? this.load(ctx, ref).catch(() => null) : Promise.resolve(null);   // never a rejected promise
      if (ctx) this.buffers.set(ref, p);
    }
    if (!this.settled.has(p)) { const q = p; void q.then((b) => { this.settled.set(q, b); }); }
    return p;
  }

  /** one file's bytes; null when it could not be fetched (HTTP error, or the network failing before or during
   *  the body). Never rejects */
  private async bytes(ref: string): Promise<ArrayBuffer | null> {
    try {
      const r = await fetch(this.url(ref));
      return r.ok ? await r.arrayBuffer() : null;
    } catch { return null; }
  }

  /** decodeAudioData; undefined when it fails (or is still unsettled after `limitMs`, when given). Never rejects */
  private async decodeBytes(ctx: AudioContext, bytes: ArrayBuffer, limitMs = 0): Promise<AudioBuffer | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const buf = ctx.decodeAudioData(bytes);
      return await (limitMs ? Promise.race([buf, new Promise<undefined>((r) => { timer = setTimeout(r, limitMs, undefined); })]) : buf);
    } catch { return undefined; } finally { clearTimeout(timer); }
  }

  private async decode(ctx: AudioContext, ref: string): Promise<AudioBuffer | null> {
    const b = await this.bytes(ref);
    return b ? (await this.decodeBytes(ctx, b)) ?? null : null;
  }

  /** a cue / bed file in the session's format (see `format` in the header) */
  private async load(ctx: AudioContext, ref: string): Promise<AudioBuffer | null> {
    const alt = this.alt[ref];
    if (!alt) return this.decode(ctx, ref);
    while (this.fmt === null && this.probe) await this.probe;       // undecided: one .ogg at a time decides
    if (this.fmt === 'm4a') return this.decode(ctx, alt);
    const probing = this.fmt === null;
    let free = (): void => {};
    let stalled: ReturnType<typeof setTimeout> | undefined;
    if (probing) {
      // this load decides and the others wait for it; a request that stalls without erroring stops holding
      // them after PROBE_MS (the next waiter probes) and keeps loading for its own cue
      let release = (): void => {};
      const mine = new Promise<void>((r) => { release = r; });
      free = () => { clearTimeout(stalled); if (this.probe === mine) this.probe = null; release(); };
      stalled = setTimeout(free, PROBE_MS);
      this.probe = mine;
    }
    try {
      const bytes = await this.bytes(ref);
      if (!bytes) return null;                       // not fetched (404, offline): the format stays open
      clearTimeout(stalled);                         // the bytes are here: hold the others for the decode
      const buf = await this.decodeBytes(ctx, bytes, probing ? PROBE_MS : 0);
      if (buf) { this.fmt ??= 'ogg'; return buf; }
      this.fmt = 'm4a';                              // this browser cannot decode the .ogg: switch the session
    } finally { free(); }
    return this.decode(ctx, alt);
  }

  // ── AudioPort ─────────────────────────────────────────────────────────────────────────────────
  play(cueId: string): void { this.cue(cueId, null); }

  fighterCall(fighter: string): boolean {
    const c = this.kits.get(fighter)?.call;
    if (c) this.cue(c, null);
    return !!c;
  }

  /** a Wick-on-Wick blow's gain (max SFX-1): WICK_HIT_GAIN, or WICK_DENSE_GAIN once WICK_DENSE_N of them landed near the
   *  ear within WICK_DENSE_S (a wave fight is texture under the fighters, not a machine gun) */
  private wickDuck(p: { x: number; y: number } | null): number {
    const now = this.ctx?.currentTime ?? 0;
    const ear = this.ear();
    if (!p || !ear || Math.hypot(p.x - ear.x, p.y - ear.y) > LISTEN_HEAR_M) return WICK_HIT_GAIN;
    const w = this.wickHits;
    w.push(now);
    while (w.length && now - w[0] > WICK_DENSE_S) w.shift();
    return w.length >= WICK_DENSE_N ? WICK_DENSE_GAIN : WICK_HIT_GAIN;
  }

  /** a fighter's own cue for a kit slot (see `kits` in the header); undefined when `x` is no fighter or content
   *  has no such cue (the catalog's present and the generic roles then decide) */
  private kit(x: EntityLike | undefined, slot: KitSlot): string | undefined {
    return x?.kind === 'fighter' && x.def ? this.kits.get(x.def)?.[slot] : undefined;
  }

  /** an epic unit's kit (see `epic` in the header); undefined for anything else (a fighter, an unkitted unit) */
  private uk(x: EntityLike | undefined): Partial<Record<string, string>> | undefined {
    return x && x.kind !== 'fighter' && x.def ? this.ukits.get(x.def) : undefined;
  }

  /** what an 'area' event sounds as heard (see `kits` / `epic` in the header): a kitted fighter's own ability plays
   *  only its own landing ('area.<vfx>' bound in content, else a present.sfx in its own f_<fighter>_ namespace); a
   *  kitted unit's ability plays its a<n>_land; anything else its present.sfx, else 'area.<vfx>' as before */
  private areaCue(e: Record<string, unknown>, src: EntityLike | undefined): string | undefined {
    const sfx = e.sfx as string | undefined;
    const vfx = e.vfx as string | undefined;
    const bound = vfx ? this.ev(`area.${vfx}`) : undefined;
    const own = this.ownAb.get(e.ability as string);
    if (own && Object.keys(this.kits.get(own.fighter) ?? {}).length) {
      const pre = `f_${own.fighter}_`;
      return bound ?? (sfx?.startsWith(pre) ? sfx : undefined);
    }
    const ua = this.unitAb.get(e.ability as string);
    const uk = ua ? this.ukits.get(ua.unit) : this.uk(src);
    if (uk) return ua ? uk[`${ua.slot}_land`] : undefined;
    return sfx ?? bound;
  }

  settings(s: AudioSettings): void { this.vol = { ...s }; this.applyVolumes(); }

  musicPhase(phase: string | null): void { this.phase = phase; this.phaseDriven = true; this.bedRoles(); }

  musicUrgency(on: boolean): void { this.urgent = on; this.bedRoles(); }

  draft(s: DraftMusicState | null): void {
    if (!!s !== !!this.draftS) this.draftCalls(!!s);
    this.draftS = s;
    this.phase = s ? s.phase : null; this.urgent = !!s?.urgent; this.phaseDriven = !!s;
    this.bedRoles();
  }

  duck(on: boolean): void {
    if (!this.ctx) return;
    this.duckGain.gain.setTargetAtTime(on ? Math.pow(10, -8 / 20) : 1, this.ctx.currentTime, 0.15);
  }

  music(id: string | null): void {
    if (id === this.wantBed) return;
    this.wantBed = id;
    const d = this.draftS;                                  // the draft's state outlives a bed change (see draft())
    this.phase = d ? d.phase : null; this.urgent = !!d?.urgent; this.phaseDriven = !!d;
    if (!this.ctx) return;
    this.dropSpare();
    this.stopBed();
    if (id) this.startBed(id);
  }

  /** a round-robin take: random, never the one this cue played last (so two in a row always differ) */
  private take(cueId: string, n: number): number {
    if (n < 2) return 0;
    const last = this.lastFile.get(cueId) ?? -1;
    let i = Math.floor(Math.random() * (last < 0 ? n : n - 1));
    if (last >= 0 && i >= last) i++;
    this.lastFile.set(cueId, i);
    return i;
  }

  /** the cue bound to an engine event role, if the catalog binds one */
  private ev(role: string): string | undefined { return this.events[role]; }

  /** play a cue; `pos` (world x, y) makes a spatial cue pan/attenuate around the listener (see `listener` in the
   *  header). A looping cue stops after `hold` seconds (a zone's delay + life), else after LOOP_DEFAULT_S.
   *  Returns what became of it ('none': no such cue; 'off': no running context; 'voices': every voice outranks it) */
  private cue(cueId: string | undefined, pos: { x: number; y: number } | null, gainMul = 1, hold = 0, o: CueOpts = {}):
    'played' | 'cooldown' | 'voices' | 'culled' | 'none' | 'off' {
    if (!cueId) return 'none';
    const c = this.cues[cueId];
    if (!c) return 'none';
    // mix focus (see OWN_KIT_DB): your own fighter's kit over the rest, a camp monster's sounds under
    if (o.you && this.kitCues.has(cueId)) gainMul *= OWN_KIT_GAIN;
    if (o.camp) gainMul *= CAMP_GAIN;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running' || this.stalled) return 'off';      // a stalled clock: nothing would sound (see `release`)
    const now = ctx.currentTime;
    if (c.cooldown > 0 && now - (this.lastPlay.get(cueId) ?? -1e9) < c.cooldown) return 'cooldown';
    let pan = 0, att = 1, lpf = 0, dist = -1;
    if (pos && c.spatial) {
      const pl = this.place(pos, !!o.aware);
      if (pl.att <= 0) return 'culled';
      ({ att, pan, lpf } = pl);
      dist = pl.d ?? -1;
    }
    // voice limits (see `priority` in the header): the cue's own maxVoices, then the global budget
    const prio = c.priority + (o.lift ?? 0);
    const alert = this.alertCues.has(cueId);
    const rank = prio + Math.log10(Math.max(1e-3, c.gain * att * gainMul));
    if (!this.makeRoom(this.voices.filter((v) => v.cue === cueId), c.maxVoices, rank)) return 'voices';
    if (!alert && !this.makeRoom(this.voices.filter((v) => v.pooled), MAX_VOICES, rank)) return 'voices';
    // repetition (see GAIN_VAR_DB): a per-play gain spread on the repeating combat cues, and a quick repeat softened
    const repeat = now - (this.lastPlay.get(cueId) ?? -1e9) < REPEAT_S;
    this.lastPlay.set(cueId, now);
    const varies = c.bus === 'sfx' && c.spatial && !c.loop && c.pitchVar > 0;
    const vdb = (varies ? (Math.random() * 2 - 1) * GAIN_VAR_DB : 0) + (varies && repeat ? REPEAT_DB : 0);
    const level = c.gain * att * gainMul;            // the placement level (the voice's own gain node) …
    const humanise = Math.pow(10, vdb / 20);          // … and the per-play variation, a stage of its own after it
    const late = varies && repeat ? Math.random() * REPEAT_JITTER_S : 0;
    // where it joins the mix: the gate cues' alert path; a threat to your fighter past the sfx duck; else its bus
    const into = alert ? this.alertBus.get(c.bus)! : c.bus === 'sfx' && o.aware ? this.threat : this.bus.get(c.bus)!;
    const file = c.files[this.take(cueId, c.files.length)];
    // the slot is held from now (a burst of cues decoding at once must not overrun the budget)
    const v: Voice = { src: null, gain: null, cue: cueId, bus: c.bus, priority: prio, rank, pooled: !alert, started: now };
    this.voices.push(v);
    const drop = (): void => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
    const begin = (buf: AudioBuffer | null): void => {
      if (v.dead) return;
      if (!buf || !this.ctx) { drop(); return; }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = c.loop;
      if (c.pitchVar) src.playbackRate.value = (1 + (Math.random() * 2 - 1) * c.pitchVar) * (o.rate ?? 1);   // a playback-rate fraction
      else if (o.rate) src.playbackRate.value = o.rate;
      const g = this.ctx.createGain();
      g.gain.value = level;
      let node: AudioNode = src;
      const nodes: AudioNode[] = [g];
      if (lpf > 0) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = lpf; f.Q.value = 0.7071;
        node.connect(f); node = f; nodes.push(f);
      }
      if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; nodes.push(p); }
      if (vdb !== 0) {
        const hv = this.ctx.createGain();
        hv.gain.value = humanise;
        node.connect(g).connect(hv).connect(into);
        nodes.push(hv);
      } else node.connect(g).connect(into);
      // the map's room (see ROOM_NEAR_DB): a spatial sfx voice also sends into the shared room, wetter the farther it is
      if (this.roomIn && this.roomOn && c.bus === 'sfx' && dist >= 0 && !alert) {
        const u = Math.max(0, Math.min(1, (dist - LISTEN_INNER_M * 0.5) / (LISTEN_HEAR_M - LISTEN_INNER_M * 0.5)));
        const sg = this.ctx.createGain();
        sg.gain.value = Math.pow(10, (ROOM_NEAR_DB + (ROOM_FAR_DB - ROOM_NEAR_DB) * u) / 20);
        g.connect(sg).connect(this.roomIn);
        nodes.push(sg);
      }
      v.src = src; v.gain = g; v.started = this.ctx.currentTime; v.nodes = nodes;
      // a one-shot of the cue build skips most of its silent codec lead (see LEAD_SKIP_S); loops and the music bus's
      // stings (their own build) start at 0
      let skip = 0;
      if (!c.loop && c.bus !== 'music' && buf.duration > LEAD_SKIP_S * 4) {
        const t = this.ctx.currentTime + late;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + LEAD_RAMP_S);
        src.start(late > 0 ? t : 0, LEAD_SKIP_S);
        skip = LEAD_SKIP_S;
      } else src.start();
      // a one-shot leaves the graph at its end, by the wall clock too (see `release` in the header)
      if (!c.loop) this.retire(src, nodes, v.started + late + (buf.duration - skip) / Math.max(0.01, src.playbackRate.value), 'voice', drop);
      else src.onended = drop;
      if (c.loop) this.stopVoice(v, 0.25, Math.max(0.3, hold > 0 ? hold : LOOP_DEFAULT_S));
      if (this.log.length < 400) this.log.push(cueId);
      this.heard.set(cueId, (this.heard.get(cueId) ?? 0) + (level * humanise) ** 2);
      o.onVoice?.(v, buf);
    };
    // a decoded file starts now, inside the event's call: a promise's then() would wait for the rest of the frame
    // (the render after the pump), a whole device callback or two late (closing critic 'audio-runtime')
    const pb = this.buffer(file);
    const ready = this.settled.get(pb);
    if (ready !== undefined) begin(ready); else void pb.then(begin);
    return 'played';
  }

  /** a full set of voices frees its lowest-ranked, oldest one for a newcomer of rank `rank`; false (the newcomer is
   *  dropped) when every voice outranks it */
  private makeRoom(set: Voice[], max: number, rank: number): boolean {
    if (set.length < max) return true;
    let w: Voice | null = null;
    for (const v of set) if (!w || v.rank < w.rank || (v.rank === w.rank && v.started < w.started)) w = v;
    if (!w || w.rank > rank) return false;
    this.stopVoice(w, 0.03);
    const i = this.voices.indexOf(w);
    if (i >= 0) this.voices.splice(i, 1);           // it fades out on its own; it no longer holds a slot
    return true;
  }

  private stopVoice(v: Voice, fade: number, after = 0): void {
    if (!this.ctx) return;
    if (!v.src || !v.gain) { v.dead = true; return; }        // still decoding: it never starts
    const t = this.ctx.currentTime + after;
    v.gain.gain.setTargetAtTime(0, t, fade / 3);
    const drop = (): void => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
    this.retire(v.src, v.nodes ?? [v.gain], t + fade + 0.02, 'stop', drop);
  }

  // ── music beds ────────────────────────────────────────────────────────────────────────────────
  private startBed(id: string): void {
    const def = this.beds[id];
    const ctx = this.ctx;
    if (!def || !ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.bus.get('music')!);
    let combat = false;
    // the main stem's .m4a pieces: `pieces`, else the old 'seg_<s>' layers (see `music` in the header)
    const pieces: BedPiece[] = (def.pieces?.length ? def.pieces.map((q) => ({ at: q.at, file: q.file }))
      : def.layers.filter((l) => l.id.startsWith('seg_')).map((l) => ({ at: Number(l.id.slice('seg_'.length)), file: l.file })))
      .sort((a, b) => a.at - b.at);
    const layers: BedLayer[] = def.layers.filter((l) => !l.id.startsWith('seg_')).map((l) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(gain);
      const role = layerRole(l.id, combat);
      if (role === 'combat') combat = true;
      return { id: l.id, role, file: l.file, gain: g, src: null, srcGain: null, buf: null };
    });
    const bed: Bed = { id, def, main: null, mainGain: null, t0: null, len: 0, gain, layers, pieces: [], actsFrom: null, decided: 0, jump: null, sections: [], streams: [] };
    this.bed = bed;
    // each layer joins when both it and the main stem are in (a streamed stem's sections are the stream's)
    const loadLayers = (): void => {
      for (const l of layers) {
        if (bed.streams.some((c) => c.stems.some((st) => st.layer === l))) continue;
        void this.bedBuffer(l.file).then((buf) => {
          if (this.bed !== bed || !buf || !this.ctx) return;
          l.buf = buf;
          if (bed.t0 !== null) this.startLayer(bed, l);
        });
      }
    };
    // whether the platform streams is asked once, when the context is made, and the session's format by its first .ogg:
    // a bed chosen before both answers waits for them (the first menu bed, at the first gesture)
    if ((this.canStream === null && this.streamCheck) || (this.fmt === null && this.probe)) {
      void Promise.all([this.streamCheck, this.probe]).then(() => { if (this.bed === bed && this.ctx === ctx) this.bedFrom(bed, pieces, loadLayers); });
      return;
    }
    this.bedFrom(bed, pieces, loadLayers);
  }

  /** a new bed's sources: the .m4a pieces, a stream, or the whole files (see `music` / `stream` in the header) */
  private bedFrom(bed: Bed, pieces: BedPiece[], loadLayers: () => void): void {
    const ctx = this.ctx!;
    const def = bed.def, layers = bed.layers;
    // the .m4a path plays a main stem it has not decoded yet piece by piece; the layers wait for the decoder
    if (this.fmt === 'm4a' && pieces.length > 1 && pieces[0].at === 0 && !this.buffers.has(def.file)) {
      void this.playPieces(bed, pieces).then(loadLayers);
      return;
    }
    const whole = (): void => {
      // the main stem starts as soon as it decodes
      void this.bedBuffer(def.file).then((main) => {
        if (this.bed === bed && main) this.loopMain(bed, main);
      });
      loadLayers();
    };
    // a long bed streams by windows where the platform can (see `stream` in the header)
    const plan = this.canStream && this.fmt === 'ogg' && ctx.sampleRate === STREAM_SR && !this.buffers.has(def.file) ? this.streamPlan(def, layers) : null;
    if (plan) {
      void this.streamBed(bed, plan).then((ok) => { if (this.bed !== bed) return; if (ok) loadLayers(); else { bed.streams = []; whole(); } });
      return;
    }
    whole();
  }

  // ── streamed beds (see `stream` in the header) ─────────────────────────────────────────────────────
  /** the chains a bed streams as, or null (it decodes whole): a match bed's main stem and combat layer on the section
   *  grid (the acts); a bed of independent loops (a main stem and 'stem…' layers only: the menu, the post-game) one chain
   *  per stem of LOOP_WINDOW_S windows. Lengths are checked once the files are parsed */
  private streamPlan<L extends { role: LayerRole; file: string }>(def: MusicDefT, layers: readonly L[]): { acts: boolean; secS: number; stems: { file: string; layer: L | null }[] }[] | null {
    if (def.loopStart !== 0 || def.loopEnd !== undefined) return null;
    const combatL = layers.find((l) => l.role === 'combat');
    if (combatL) {
      if (layers.some((l) => l.role !== 'combat' && l.role !== 'objective')) return null;
      return [{ acts: true, secS: (60 / def.bpm) * 4 * MUSIC_SECTION_BARS, stems: [{ file: def.file, layer: null }, { file: combatL.file, layer: combatL }] }];
    }
    if (layers.some((l) => l.role !== 'stem')) return null;
    return [{ acts: false, secS: LOOP_WINDOW_S, stems: [{ file: def.file, layer: null }] },
      ...layers.map((l) => ({ acts: false, secS: LOOP_WINDOW_S, stems: [{ file: l.file, layer: l }] }))];
  }

  /** fetch every streamed stem compressed, then each chain decodes its window 0 and starts on it (the main stem's
   *  chain starts the bed). false (the bed then decodes whole) when a file is no stem this can stream (or not of the
   *  plan's length) or the main chain's first window fails; a layer chain that fails decodes that layer whole */
  private async streamBed(bed: Bed, plan: { acts: boolean; secS: number; stems: { file: string; layer: BedLayer | null }[] }[]): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    const files = plan.flatMap((c) => c.stems.map((x) => x.file));
    const raw = await Promise.all(files.map((f) => this.bytes(f)));
    if (this.bed !== bed || this.ctx !== ctx) return true;               // superseded: nothing to fall back to
    const parsed = new Map(files.map((f, i) => [f, raw[i] ? OpusStem.parse(raw[i]!) : null]));
    const chains: Stream[] = [];
    for (const c of plan) {
      const w = Math.round(c.secS * STREAM_SR);
      const n = c.acts ? MUSIC_SECTIONS : Math.round((parsed.get(c.stems[0].file)?.length ?? 0) / w);
      const stems: StreamStem[] = [];
      for (const x of c.stems) {
        const stem = parsed.get(x.file);
        if (!stem || n < 2 || stem.length !== n * w) return false;
        let dest: GainNode;
        if (x.layer) dest = x.layer.gain;
        else { dest = ctx.createGain(); dest.connect(bed.gain); }
        stems.push({ file: x.file, stem, dest, layer: x.layer });
      }
      chains.push({ stems, secS: c.secS, n, acts: c.acts, main: c.stems.some((x) => !x.layer), win: new Map(), cur: null, next: null, stopped: false,
        pool: stems.map(() => []), holds: new Map(), busy: new Set(),
        stats: { decoded: 0, ms: [], maxHeld: 0, late: 0, maxHeldMb: 0 } });
    }
    bed.streams = chains;
    // the bed before hands its buffers over (see `reuse` in the header): the first windows decode into them
    const hand = this.handing;
    if (hand) {
      await Promise.race([hand, new Promise<void>((r) => { setTimeout(r, HAND_WAIT_S * 1000); })]);
      if (this.bed !== bed || this.ctx !== ctx) return true;
    }
    const started = await Promise.all(chains.map(async (c) => {
      const w0 = await this.window(c, 0).p;
      if (this.bed !== bed || c.stopped) return true;
      if (!w0[0]) return false;
      const T = ctx.currentTime + 0.05;
      c.cur = this.segment(c, 0, T, null, false);
      this.segNow(bed, c, c.cur);
      if (c.main) {
        bed.mainGain = c.stems.find((x) => !x.layer)!.dest; bed.len = c.n * c.secS; bed.actsFrom = T;
        bed.gain.gain.setTargetAtTime(bed.def.gain, T, XFADE_S / 3);
        for (const l of bed.layers) if (l.buf) this.startLayer(bed, l);
      } else for (const x of c.stems) if (x.layer) x.layer.gain.gain.setTargetAtTime(1, T, XFADE_S / 3);
      this.bedRoles();
      this.prefetch(c);
      return true;
    }));
    if (this.bed !== bed) return true;
    if (hand && this.handing === hand) this.dropSpare();     // what the first windows did not take goes to the collector
    chains.forEach((c, i) => {
      if (started[i] || c.main) return;
      // a layer chain that could not start: that layer decodes whole (see `music`)
      bed.streams = bed.streams.filter((x) => x !== c);
      for (const x of c.stems) if (x.layer) {
        const l = x.layer;
        void this.bedBuffer(l.file).then((buf) => { if (this.bed === bed && buf) { l.buf = buf; if (bed.t0 !== null) this.startLayer(bed, l); } });
      }
    });
    const mainOk = chains.every((c, i) => !c.main || started[i]);
    if (!mainOk) {
      for (const c of chains) { c.stopped = true; for (const x of c.cur?.srcs ?? []) this.retire(x.src, [x.g], ctx.currentTime, 'stop'); }
      for (const c of chains) for (const x of c.stems) if (!x.layer) try { x.dest.disconnect(); } catch { /* */ }
      for (const l of bed.layers) { l.src = null; l.srcGain = null; }
      bed.main = null; bed.mainGain = null; bed.t0 = null;
      bed.streams = [];
    }
    return mainOk;
  }

  /** window k of every stem of a chain (cached on the chain while it is wanted) */
  private window(st: Stream, k: number): Win {
    let w = st.win.get(k);
    if (w) return w;
    const ctx = this.ctx!;
    const a = Math.round((k * st.secS - STREAM_HANDLE_S) * STREAM_SR), b = Math.round(((k + 1) * st.secS + STREAM_HANDLE_S) * STREAM_SR);
    const t = performance.now();
    const into = st.stems.map((x, i) => st.pool[i].pop() ?? this.takeSpare(b - a, x.stem.channels));
    for (const b of into) if (b) st.busy.add(b);
    const p = Promise.all(st.stems.map((x, i) => x.stem.window(ctx, a, b, into[i]).catch(() => null)));
    const nw: Win = { p, v: null };
    w = nw;
    st.win.set(k, nw);
    st.stats.maxHeld = Math.max(st.stats.maxHeld, st.win.size);
    void p.then((v) => {
      for (const b of into) if (b) st.busy.delete(b);
      st.stats.decoded++;
      if (st.stats.ms.length < 64) st.stats.ms.push(Math.round(performance.now() - t));
      v.forEach((x, i) => { if (!x && into[i]) this.unhold(st, into[i]!, i, true); });     // a failed decode hands its buffer back
      if (st.win.get(k) !== nw) { v.forEach((x, i) => { if (x) this.unhold(st, x, i, true); }); return; }   // dropped while decoding
      nw.v = v;
      v.forEach((x) => { if (x) this.hold(st, x); });
      if (v.every((x) => !x)) st.win.delete(k);          // failed: the next ask tries again
    });
    return nw;
  }

  /** a window buffer is held once more (by the window cache, or a source playing it) */
  private hold(st: Stream, buf: AudioBuffer): void {
    const fresh = !st.holds.has(buf);
    st.holds.set(buf, (st.holds.get(buf) ?? 0) + 1);
    if (fresh) { let n = 0; for (const b of streamBuffers(st)) n += pcmBytes(b); st.stats.maxHeldMb = Math.max(st.stats.maxHeldMb, +(n / 1048576).toFixed(1)); }
  }

  /** a holder lets go; with no holder left the buffer goes back to the stem's pool (`fresh`: it was never held) */
  private unhold(st: Stream, buf: AudioBuffer, i: number, fresh = false): void {
    const n = fresh ? 0 : (st.holds.get(buf) ?? 1) - 1;
    if (n > 0) { st.holds.set(buf, n); return; }
    st.holds.delete(buf);
    if (!st.stopped && st.pool[i] && st.pool[i].length < STREAM_POOL && !st.pool[i].includes(buf)) st.pool[i].push(buf);
  }

  /** a window leaves the cache (its buffers stay with the sources still playing them) */
  private dropWin(st: Stream, k: number): void {
    const w = st.win.get(k);
    if (!w) return;
    st.win.delete(k);
    w.v?.forEach((x, i) => { if (x) this.unhold(st, x, i); });
  }

  /** window k from ctx time T (its downbeat): every stem whose window is in starts its source; `prev` (the window
   *  before) hands over: an equal-power fade of SECTION_XF_S ending on T for a jump (see `acts`), a SEG_OVERLAP_S linear
   *  one for the natural next window (the same samples either side). A T already past joins at once where the
   *  timeline is (a decode later than the look-ahead: a background tab) */
  private segment(st: Stream, k: number, T: number, prev: Seg | null, jump: boolean): Seg {
    const ctx = this.ctx!;
    const v = st.win.get(k)?.v ?? [];
    const seg: Seg = { k, T, srcs: [] };
    const X = jump ? SECTION_XF_S : SEG_OVERLAP_S;
    const now = ctx.currentTime;
    const late = T - X < now + 0.02;
    const at = late ? now + 0.05 : T - X;
    const off = STREAM_HANDLE_S + (at - T);
    st.stems.forEach((stem, i) => {
      const buf = v[i];
      if (!buf || off >= buf.duration) return;
      const g = ctx.createGain();
      g.connect(stem.dest);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      const old = prev?.srcs.find((x) => x.st === stem);
      if (!prev) g.gain.value = 1;
      else if (late) { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + 0.03); }
      else if (jump) g.gain.setValueCurveAtTime(XF_CURVES.in, at, X);
      else { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, T); }
      src.start(at, Math.max(0, off));
      this.hold(st, buf);
      seg.srcs.push({ st: stem, src, g });
      if (old) {
        const og = old.g.gain;
        try {
          if (late) { og.cancelScheduledValues(at); og.setValueAtTime(og.value, at); og.linearRampToValueAtTime(0, at + 0.03); }
          else if (jump) og.setValueCurveAtTime(XF_CURVES.out, at, X);
          else { og.setValueAtTime(1, at); og.linearRampToValueAtTime(0, T); }
        } catch { og.setTargetAtTime(0, at, 0.01); }
      }
    });
    // the window before leaves at the downbeat (a stem with no window this time fades with it: it rejoins next time)
    if (prev) for (const o of prev.srcs) {
      if (!seg.srcs.some((x) => x.st === o.st)) { try { o.g.gain.setTargetAtTime(0, at, 0.02); } catch { /* */ } }
      const ob = o.src.buffer, oi = st.stems.indexOf(o.st);
      this.retire(o.src, [o.g], (late ? at + 0.05 : T) + 0.02, 'hand', () => { if (ob) this.unhold(st, ob, oi); });
    }
    if (late && prev) st.stats.late++;
    return seg;
  }

  /** a window has become the playing one: the bed's handles follow it (the probes read bed.main and each layer's src;
   *  the objective layer locks to t0 = the section grid) */
  private segNow(b: Bed, st: Stream, seg: Seg): void {
    if (st.main) b.t0 = seg.T - seg.k * st.secS;
    const m = seg.srcs.find((x) => !x.st.layer);
    if (m) b.main = m.src;
    for (const x of seg.srcs) if (x.st.layer) { x.st.layer.src = x.src; x.st.layer.srcGain = x.g; }
  }

  /** the window a chain plays after k: the act's next section, else the next window */
  private nextWin(st: Stream, k: number): number {
    return st.acts ? nextSection(MUSIC_ACTS[this.act] ?? MUSIC_ACTS[0], k) : (k + 1) % st.n;
  }

  /** decode ahead the window a chain would play next, and drop every window no window needs */
  private prefetch(st: Stream): void {
    if (!st.cur) return;
    const want = new Set([st.cur.k, st.next ? st.next.k : this.nextWin(st, st.cur.k)]);
    for (const k of [...st.win.keys()]) if (!want.has(k)) this.dropWin(st, k);
    for (const k of want) this.window(st, k);
  }

  /** a streamed bed's windows (the streamed form of sectionsNow): each chain's next window is chosen
   *  SECTION_LOOKAHEAD_S ahead (by the act's order on a match bed, as the whole bed's jumps are) and scheduled once its
   *  window is in */
  private streamNow(b: Bed): void {
    for (const st of b.streams) this.chainNow(b, st);
  }

  private chainNow(b: Bed, st: Stream): void {
    const ctx = this.ctx;
    if (!ctx || !st.cur || st.stopped) return;
    const now = ctx.currentTime;
    if (st.next && now >= st.next.T) { st.cur = st.next; st.next = null; this.segNow(b, st, st.cur); this.prefetch(st); }
    if (st.next) return;
    let at = st.cur.T + st.secS;
    if (at - now > SECTION_LOOKAHEAD_S) return;
    let from = st.cur.k;
    // far behind (the timers were held back: a hidden tab): the timeline went on as composed, window after window; it
    // joins the one playing now, where the timeline is (as a whole bed's stem runs on into its own next section)
    const behind = at < now + 0.05;
    while (at + st.secS < now + 0.1) { from = (from + 1) % st.n; at += st.secS; }
    const natural = (from + 1) % st.n;
    const to = behind ? natural : this.nextWin(st, from);
    const w = this.window(st, to);
    this.prefetch(st);
    if (!w.v) { void w.p.then(() => { if (this.bed === b) this.chainNow(b, st); }); return; }
    st.next = this.segment(st, to, at, st.cur, to !== natural);
    if (st.acts && !behind) {
      b.decided = at;
      b.sections.push({ at, from, to, jump: to !== natural, act: this.act });
      if (b.sections.length > 64) b.sections.shift();
    }
    this.prefetch(st);
  }

  /** the main stem starts looping now (position 0), the bed fading in */
  private loopMain(bed: Bed, main: AudioBuffer): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const def = bed.def;
    const t0 = ctx.currentTime + 0.05;
    const s = ctx.createBufferSource();
    s.buffer = main; s.loop = true;
    s.loopStart = def.loopStart; s.loopEnd = def.loopEnd ?? this.body(main);
    const g = ctx.createGain();
    g.connect(bed.gain);
    s.connect(g); s.start(t0);
    bed.main = s; bed.mainGain = g; bed.t0 = t0; bed.len = Math.max(0.001, s.loopEnd - s.loopStart); bed.actsFrom = t0;
    bed.gain.gain.setTargetAtTime(def.gain, t0, XFADE_S / 3);
    for (const l of bed.layers) if (l.buf) this.startLayer(bed, l);
  }

  /** the .m4a path's main stem (see `music` in the header): the pieces decode one after another, each plays from its
   *  place on the bed's timeline as soon as it is in (the first starts the bed), and once all are in they are stitched
   *  into one buffer that takes over at the last piece's start and loops. A piece that fails hands over to the
   *  whole .m4a, wherever the bed has got to */
  private async playPieces(bed: Bed, pieces: BedPiece[]): Promise<void> {
    const bufs: AudioBuffer[] = [];
    let prev: GainNode | null = null;
    for (let i = 0; i < pieces.length; i++) {
      const buf = this.ctx ? await this.decode(this.ctx, pieces[i].file) : null;
      if (this.bed !== bed || !this.ctx) return;
      if (!buf) {
        const whole = await this.buffer(bed.def.file);
        if (this.bed === bed && whole) this.takeOver(bed, whole, prev);
        return;
      }
      bufs.push(buf);
      if (i < pieces.length - 1) prev = this.playPiece(bed, buf, pieces[i].at, prev);
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const whole = this.stitch(ctx, bufs, pieces);
    this.buffers.set(bed.def.file, Promise.resolve(whole));
    this.takeOver(bed, whole, prev, pieces[pieces.length - 1].at);
  }

  /** one piece on the bed's timeline at `at` s: it cross-fades in over the run-on of the piece before (`prev`, faded
   *  out under it); a piece decoded after its time joins at once where the timeline is. Returns its gain */
  private playPiece(bed: Bed, buf: AudioBuffer, at: number, prev: GainNode | null): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(bed.gain);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(g);
    const now = ctx.currentTime;
    if (bed.t0 === null) {                                  // the first piece: the bed starts
      bed.t0 = now + 0.05;
      s.start(bed.t0);
      bed.gain.gain.setTargetAtTime(bed.def.gain, bed.t0, XFADE_S / 3);
    } else this.joinAt(g, s, bed.t0 + at, 0, prev);
    bed.pieces.push({ src: s, gain: g });
    // a piece plays once: it leaves the graph at its end (see `release` in the header)
    this.retire(s, [g], Math.max(bed.t0 + at, now + 0.05) + buf.duration, 'piece');
    return g;
  }

  /** start `s` (gain `g`) at context time `t` from offset `pos` of its buffer, cross-fading in over the run-on of
   *  `prev`; when `t` has passed, at once from where the bed's timeline is (`pos` + the delay; `wrap` folds it into a
   *  loop) with a short fade, `prev` fading out under it */
  private joinAt(g: GainNode, s: AudioBufferSourceNode, t: number, pos: number, prev: GainNode | null, wrap?: (p: number) => number): void {
    const now = this.ctx!.currentTime;
    if (t >= now + 0.02) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + SEG_OVERLAP_S);
      if (prev) { prev.gain.setValueAtTime(1, t); prev.gain.linearRampToValueAtTime(0, t + SEG_OVERLAP_S); }
      s.start(t, pos);
      return;
    }
    const at = now + 0.05;
    const p = pos + (at - t);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + 0.03);
    if (prev) { prev.gain.cancelScheduledValues(at); prev.gain.setValueAtTime(prev.gain.value, at); prev.gain.linearRampToValueAtTime(0, at + 0.03); }
    s.start(at, wrap ? wrap(p) : Math.min(p, Math.max(0, (s.buffer?.duration ?? 0) - 0.001)));
  }

  /** the stitched (or whole) main stem takes over from the pieces and loops: at bed position `at` when that is still
   *  ahead, else at once where the timeline is */
  private takeOver(bed: Bed, buf: AudioBuffer, prev: GainNode | null, at?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (bed.t0 === null) { this.loopMain(bed, buf); return; }        // no piece ever played
    const def = bed.def;
    const g = ctx.createGain();
    g.connect(bed.gain);
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = def.loopStart; s.loopEnd = def.loopEnd ?? this.body(buf);
    s.connect(g);
    const end = s.loopEnd, len = Math.max(0.001, end - s.loopStart);
    const wrap = (p: number): number => (p < end ? p : def.loopStart + ((p - end) % len));
    const now = ctx.currentTime;
    const t = at === undefined ? now : bed.t0 + at;
    const late = t < now + 0.02;
    this.joinAt(g, s, t, t - bed.t0, late ? null : prev, wrap);
    if (late) {                                             // every piece still sounding (or still to come) yields now
      for (const p of bed.pieces) {
        p.gain.gain.cancelScheduledValues(now);
        p.gain.gain.setTargetAtTime(0, now + 0.05, 0.01);
        this.retire(p.src, [p.gain], now + 0.15, 'stop');
      }
      bed.pieces = [];
    }
    bed.main = s; bed.mainGain = g; bed.len = len; bed.actsFrom = Math.max(t, now) + 0.1;
    for (const l of bed.layers) if (l.buf) this.startLayer(bed, l);
  }

  /** the pieces as one loop, the way audio/build_music.py `stitch` QAs them: each piece's run-on cross-fades
   *  (linear) into the head of the next; the last piece ends at the loop's end */
  private stitch(ctx: AudioContext, bufs: AudioBuffer[], pieces: BedPiece[]): AudioBuffer {
    const sr = ctx.sampleRate;
    const ov = Math.max(1, Math.round(SEG_OVERLAP_S * sr));
    const starts = pieces.map((p) => Math.round(p.at * sr));
    const last = bufs.length - 1;
    const n = starts[last] + bufs[last].length;
    const ch = Math.max(...bufs.map((b) => b.numberOfChannels));
    const out = ctx.createBuffer(ch, n, sr);
    for (let c = 0; c < ch; c++) {
      const o = out.getChannelData(c);
      for (let i = 0; i <= last; i++) {
        const d = bufs[i].getChannelData(Math.min(c, bufs[i].numberOfChannels - 1));
        const s0 = starts[i];
        const m = Math.min(d.length, (i < last ? starts[i + 1] + ov : n) - s0, n - s0);    // body (+ run-on)
        const head = i > 0 ? Math.min(ov, m) : 0;
        for (let j = 0; j < head; j++) { const w = (j + 0.5) / ov; o[s0 + j] = o[s0 + j] * (1 - w) + d[j] * w; }
        if (m > head) o.set(d.subarray(head, m), s0 + head);
      }
    }
    return out;
  }

  /** a layer joins its bed (see `music` in the header): a stem loops on its own from now; a synced layer starts on
   *  the main stem's next bar (or with the main stem, when both decoded together) at the main stem's loop position */
  private startLayer(bed: Bed, l: BedLayer): void {
    const ctx = this.ctx;
    if (!ctx || !l.buf || l.src || bed.t0 === null) return;
    const s = ctx.createBufferSource();
    s.buffer = l.buf; s.loop = true;
    const sg = ctx.createGain();
    sg.connect(l.gain);
    s.connect(sg);
    l.srcGain = sg;
    const now = ctx.currentTime;
    if (l.role === 'stem') {
      s.loopStart = 0; s.loopEnd = this.body(l.buf);
      s.start(now + 0.05);
      l.gain.gain.setTargetAtTime(1, now + 0.05, XFADE_S / 3);
    } else {
      const def = bed.def;
      s.loopStart = def.loopStart; s.loopEnd = def.loopEnd ?? this.body(l.buf);
      const bar = (60 / def.bpm) * 4;
      let at = now + 0.05 <= bed.t0 ? bed.t0 : bed.t0 + Math.ceil((now + 0.05 - bed.t0) / bar) * bar;
      // a jump between sections already scheduled (see `acts` in the header): join on its far side
      if (bed.jump) at = Math.max(at, bed.jump.at);
      const p = at - (bed.jump ? bed.jump.t0 : bed.t0);
      const end = s.loopEnd;
      // a layer shorter than the main stem (an objective layer) runs on its own loop, on the same bars
      const pos = l.role === 'objective' ? p % this.body(l.buf) : p < end ? p : def.loopStart + ((p - end) % bed.len);
      s.start(at, Math.min(pos, Math.max(0, this.body(l.buf) - 0.001)));
    }
    l.src = s;
    this.bedRoles();
  }

  /** the phase / urgency / combat layers' gains (see `music` in the header), switched on the main stem's next bar
   *  (urgency at once) */
  private bedRoles(): void {
    const b = this.bed;
    const ctx = this.ctx;
    if (!b || !ctx) return;
    const t = ctx.currentTime;
    const barS = (60 / b.def.bpm) * 4;
    const nextBar = b.t0 !== null && t > b.t0 ? b.t0 + Math.ceil((t - b.t0) / barS) * barS : t;
    const phases = b.layers.filter((l) => l.role === 'phase').map((l) => l.id.slice('phase_'.length));
    const upTo = this.phase === null ? -1 : phases.indexOf(this.phase);
    for (const l of b.layers) {
      if (l.role === 'stem') continue;
      if (l.role === 'objective') {
        l.gain.gain.cancelScheduledValues(t);
        l.gain.gain.setTargetAtTime(this.objNear, t, OBJ_FADE_S);
        continue;
      }
      const on = l.role === 'combat' ? this.combat : l.role === 'urgency' ? this.urgent : phases.indexOf(l.id.slice('phase_'.length)) <= upTo;
      const at = l.role === 'urgency' ? t : nextBar;
      l.gain.gain.cancelScheduledValues(t);
      l.gain.gain.setTargetAtTime(on ? 1 : 0, at, l.role === 'urgency' ? 0.12 : 0.6);
    }
  }

  // ── the acts of a match bed (see `acts` in the header) ───────────────────────────────────────────
  /** the match's act: by its clock or its structures down; it only rises */
  private actNow(view: MatchClient['view']): void {
    const clock = this.modeClock.get(view.mode) ?? 0;
    let standing = 0;
    for (const u of view.entities) if (u.kind === 'structure' && u.alive) standing++;
    this.structuresMax = Math.max(this.structuresMax, standing);
    const lost = this.structuresMax > 0 ? 1 - standing / this.structuresMax : 0;
    const share = clock > 0 ? view.time / clock : 0;
    for (let a = ACT_CLOCK.length; a > this.act; a--) {
      if (share >= ACT_CLOCK[a - 1] || lost >= ACT_LOST[a - 1]) { this.act = a; break; }
    }
  }

  /** how near your ear is to a living epic objective, 0..1 (smoothstep over the distance) */
  private objectiveNear(view: MatchClient['view']): number {
    const ear = this.ear();
    if (!ear) return 0;
    let best = Infinity;
    for (const o of view.objectives ?? []) if (o.alive) best = Math.min(best, Math.hypot(o.at[0] - ear.x, o.at[1] - ear.y));
    const k = Math.min(1, Math.max(0, (OBJ_OUTER_M - best) / (OBJ_OUTER_M - OBJ_INNER_M)));
    return k * k * (3 - 2 * k);
  }

  /** a bed's next section, near its time: nothing to do when the stem's own next one is the act's next, else a jump */
  private sectionsNow(b: Bed): void {
    const ctx = this.ctx;
    if (!ctx || !b.main || !b.mainGain || b.t0 === null || b.actsFrom === null) return;
    const now = ctx.currentTime;
    if (b.jump && now >= b.jump.at) { b.t0 = b.jump.t0; b.jump = null; }
    if (b.jump || now < b.actsFrom) return;
    const barS = (60 / b.def.bpm) * 4, secS = barS * MUSIC_SECTION_BARS;
    if (!b.layers.some((l) => l.role === 'combat') || b.def.loopStart !== 0 || Math.abs(b.len - secS * MUSIC_SECTIONS) > 0.01) return;
    const k = Math.ceil((now + SECTION_XF_S + 0.05 - b.t0) / secS);       // the next section end still in reach
    const at = b.t0 + k * secS;
    if (at - now > SECTION_LOOKAHEAD_S || at <= b.decided + 0.01) return;
    b.decided = at;
    const from = (k - 1 + MUSIC_SECTIONS * 8) % MUSIC_SECTIONS, natural = (from + 1) % MUSIC_SECTIONS;
    const to = nextSection(MUSIC_ACTS[this.act] ?? MUSIC_ACTS[0], from);
    b.sections.push({ at, from, to, jump: to !== natural, act: this.act });
    if (b.sections.length > 64) b.sections.shift();
    if (to === natural) return;
    const pos = to * secS;
    b.main = this.jumpSource(ctx, b.main, b.mainGain, b.gain, at, pos, b.len, (g) => { b.mainGain = g; });
    for (const l of b.layers) {
      // an objective layer has the section's own period, so a jump never moves it; a stem is on no grid
      if (!l.src || !l.srcGain || l.role === 'objective' || l.role === 'stem') continue;
      l.src = this.jumpSource(ctx, l.src, l.srcGain, l.gain, at, pos, b.len, (g) => { l.srcGain = g; });
    }
    b.jump = { at, t0: at - pos };
  }

  /** a second source of the same buffer takes over from `old`: the equal-power fade ends on `at`, where the new source
   *  is at `pos` of its loop (see `acts` in the header) */
  private jumpSource(ctx: AudioContext, old: AudioBufferSourceNode, oldGain: GainNode, dest: AudioNode, at: number, pos: number, len: number,
    setGain: (g: GainNode) => void): AudioBufferSourceNode {
    const start = at - SECTION_XF_S;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(dest);
    const s = ctx.createBufferSource();
    s.buffer = old.buffer; s.loop = true;
    s.loopStart = old.loopStart; s.loopEnd = old.loopEnd;
    s.connect(g);
    s.start(start, (pos - SECTION_XF_S + len) % len);
    g.gain.setValueCurveAtTime(XF_CURVES.in, start, SECTION_XF_S);
    oldGain.gain.setValueCurveAtTime(XF_CURVES.out, start, SECTION_XF_S);
    this.retire(old, [oldGain], at + 0.02, 'hand');
    setGain(g);
    return s;
  }

  /** dev / probes: a streamed bed's state (see `stream` in the header): null when the bed decodes whole. `windows` and
   *  `stats` are the first chain's (a match bed has one), `chains` each chain's */
  get musicStream(): { stems: { file: string; kb: number; seconds: number }[]; windows: number[]; heldMb: number; windowMb: number; pooledMb: number; maxHeldMb: number;
    cur: number | null; next: number | null;
    stats: Stream['stats']; chains: { n: number; secS: number; acts: boolean; windows: number[]; cur: number | null; next: number | null; maxHeld: number; decoded: number; late: number;
      pooled: number; buffers: number }[] } | null {
    const cs = this.bed?.streams ?? [];
    if (!cs.length) return null;
    // round 6 AUD-6: everything the chains hold, each buffer once: the cached windows, the buffers sources still play
    // (a hand-over's window already dropped from the cache) and the pool kept for the next decode
    const mb = (bs: Iterable<AudioBuffer>): number => { let n = 0; for (const b of bs) n += pcmBytes(b); return +(n / 1048576).toFixed(1); };
    const all = new Set<AudioBuffer>(), wins = new Set<AudioBuffer>(), pooled = new Set<AudioBuffer>();
    for (const c of cs) {
      for (const w of c.win.values()) for (const b of w.v ?? []) if (b) wins.add(b);
      for (const p of c.pool) for (const b of p) pooled.add(b);
      for (const b of streamBuffers(c)) all.add(b);
    }
    const c0 = cs[0];
    return { stems: cs.flatMap((c) => c.stems.map((x) => ({ file: x.file, kb: Math.round(x.stem.bytes / 1024), seconds: x.stem.duration }))), windows: [...c0.win.keys()],
      heldMb: mb(all), windowMb: mb(wins), pooledMb: mb(pooled), maxHeldMb: Math.max(...cs.map((c) => c.stats.maxHeldMb)),
      cur: c0.cur?.k ?? null, next: c0.next?.k ?? null, stats: { ...c0.stats, ms: c0.stats.ms.slice() },
      chains: cs.map((c) => ({ n: c.n, secS: c.secS, acts: c.acts, windows: [...c.win.keys()], cur: c.cur?.k ?? null, next: c.next?.k ?? null, maxHeld: c.stats.maxHeld,
        decoded: c.stats.decoded, late: c.stats.late, pooled: c.pool.reduce((t, x) => t + x.length, 0), buffers: c.holds.size })) };
  }

  /** dev / probes: every buffer the playing bed holds (its whole files, its windows): what a live source may hold */
  bedBuffers(): Set<AudioBuffer> {
    const out = new Set<AudioBuffer>();
    const b = this.bed;
    if (!b) return out;
    if (b.main?.buffer) out.add(b.main.buffer);
    for (const l of b.layers) { if (l.buf) out.add(l.buf); if (l.src?.buffer) out.add(l.src.buffer); }
    for (const c of b.streams) {
      for (const w of c.win.values()) for (const x of w.v ?? []) if (x) out.add(x);
      for (const seg of [c.cur, c.next]) for (const x of seg?.srcs ?? []) if (x.src.buffer) out.add(x.src.buffer);
    }
    return out;
  }

  /** dev / probes: the acts as they run (see `acts` in the header) */
  get musicActs(): { act: number; objNear: number; objGain: number | null; structuresMax: number; sections: { at: number; from: number; to: number; jump: boolean; act: number }[] } {
    const b = this.bed;
    return { act: this.act, objNear: this.objNear, structuresMax: this.structuresMax,
      objGain: b?.layers.find((l) => l.role === 'objective')?.gain.gain.value ?? null, sections: b ? b.sections.slice() : [] };
  }

  private stopBed(): void {
    const b = this.bed;
    if (!b || !this.ctx) return;
    this.bed = null;
    const t = this.ctx.currentTime;
    // a whole bed whose buffers have the shape of the next bed's windows hands them over (see `reuse` in the header):
    // a quicker fade, then the next bed's first windows decode into them
    const keepFiles = new Set(this.bedFiles(this.wantBed));
    const frames = this.streamFrames(this.wantBed);
    const handed: AudioBuffer[] = [];
    if (frames.size && !b.streams.length) {
      const whole: [string, AudioBuffer | null | undefined][] = [[b.def.file, b.main?.buffer], ...b.layers.map((l): [string, AudioBuffer | null] => [l.file, l.buf])];
      for (const [f, buf] of whole) if (buf && !keepFiles.has(f) && this.bodyS.has(buf) && frames.has(buf.length) && !handed.includes(buf)) handed.push(buf);
    }
    const fadeS = handed.length ? HAND_FADE_S : XFADE_S * 1.5;
    let handDone = (): void => {};
    if (handed.length) {
      const h = new Promise<void>((r) => { handDone = r; });
      this.handing = h;
      handDone = ((r) => () => { if (this.handing !== h) return; this.offerSpare(handed); r(); })(handDone);
    }
    b.gain.gain.setTargetAtTime(0, t, fadeS / 4.5);
    // its sources fade out and leave the graph when the fade is due, by the wall clock too (see `release` in the header);
    // the bed's own gains go with the last of them
    const srcs: [AudioBufferSourceNode, GainNode | null][] = [];
    if (b.main) srcs.push([b.main, b.mainGain]);
    for (const p of b.pieces) srcs.push([p.src, p.gain]);
    for (const l of b.layers) if (l.src) srcs.push([l.src, l.srcGain]);
    const shared: AudioNode[] = [b.gain, ...b.layers.map((l) => l.gain)];
    // a streamed bed: every section still sounding or scheduled, and no window kept (see `stream` in the header)
    for (const c of b.streams) {
      c.stopped = true;
      for (const seg of [c.cur, c.next]) for (const x of seg?.srcs ?? []) if (!srcs.some(([q]) => q === x.src)) srcs.push([x.src, x.g]);
      for (const x of c.stems) if (!x.layer) shared.push(x.dest);
      c.win.clear(); c.cur = null; c.next = null; c.pool = []; c.holds.clear(); c.busy.clear();
    }
    let left = srcs.length;
    const last = (): void => { if (--left <= 0) { for (const n of shared) try { n.disconnect(); } catch { /* gone */ } handDone(); } };
    if (!left) { left = 1; last(); }
    for (const [s, g] of srcs) this.retire(s, [g], t + fadeS, 'stop', last);
    // its hand-overs still to come leave with it: no successor will take over (freed now on a standing clock)
    const standing = this.stalled || this.ctx.state !== 'running';
    for (const d of [...this.dying]) if (d.owner === b) { d.kind = 'stop'; d.owner = null; d.at = Math.min(d.at, t + fadeS); if (standing) d.free('stall'); }
    // free its decoded files (see `memory` in the header): its sources keep theirs through the fade, then let go
    for (const f of this.bedFiles(b.id)) if (!keepFiles.has(f)) this.buffers.delete(f);
    for (const l of b.layers) { l.buf = null; l.src = null; l.srcGain = null; }
    b.main = null; b.mainGain = null; b.pieces = [];
  }

  // ── reuse (see `reuse` in the header) ──────────────────────────────────────────────────────────────
  /** a bed file decoded whole: where beds stream, through OpusStem into a buffer of its loop plus 2 x STREAM_HANDLE_S
   *  (the loop's head again after its end, never played: the loop ends at the file's own length, `body`), the shape
   *  of a section window of the same length; anywhere else, or when that fails, as any file */
  private bedBuffer(ref: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(ref);
    const ctx = this.ctx;
    if (have || !ctx || !this.canStream || this.fmt !== 'ogg' || ctx.sampleRate !== STREAM_SR) return this.buffer(ref);
    const p = (async (): Promise<AudioBuffer | null> => {
      const raw = await this.bytes(ref);
      if (!raw) return null;
      const stem = OpusStem.parse(raw);
      if (stem) {
        const n = stem.length + 2 * Math.round(STREAM_HANDLE_S * STREAM_SR);
        const buf = await stem.window(ctx, 0, n, this.takeSpare(n, stem.channels)).catch(() => null);
        if (buf) { this.bodyS.set(buf, stem.length / STREAM_SR); return buf; }
      }
      return (await this.decodeBytes(ctx, raw)) ?? null;
    })().catch(() => null);
    this.buffers.set(ref, p);
    void p.then((b) => { this.settled.set(p, b); });
    return p;
  }

  /** a bed buffer's own length (s): a whole bed decoded by bedBuffer runs on past it */
  private body(buf: AudioBuffer): number { return this.bodyS.get(buf) ?? buf.duration; }

  /** the window lengths (frames) bed `id` would stream by on this platform, none when it decodes whole */
  private streamFrames(id: string | null): Set<number> {
    const out = new Set<number>();
    const def = id ? this.beds[id] : undefined;
    const ctx = this.ctx;
    if (!def || !ctx || !this.canStream || this.fmt !== 'ogg' || ctx.sampleRate !== STREAM_SR) return out;
    let combat = false;
    const layers = def.layers.filter((l) => !l.id.startsWith('seg_')).map((l) => {
      const role = layerRole(l.id, combat);
      if (role === 'combat') combat = true;
      return { role, file: l.file };
    });
    for (const c of this.streamPlan(def, layers) ?? []) {
      out.add(Math.round((c.secS + STREAM_HANDLE_S) * STREAM_SR) - Math.round(-STREAM_HANDLE_S * STREAM_SR));
    }
    return out;
  }

  /** a stopped bed's buffers wait for the next bed's windows, SPARE_S at most */
  private offerSpare(bufs: AudioBuffer[]): void {
    this.spare.push(...bufs);
    this.releaseStats.handed += bufs.length;
    clearTimeout(this.spareTimer);
    this.spareTimer = setTimeout(() => { this.spare = []; }, SPARE_S * 1000);
  }

  /** a handed-over buffer of this shape, if one waits */
  private takeSpare(n: number, ch: number): AudioBuffer | null {
    const i = this.spare.findIndex((b) => b.length === n && b.numberOfChannels === ch && b.sampleRate === STREAM_SR);
    if (i < 0) return null;
    this.releaseStats.reused++;
    return this.spare.splice(i, 1)[0];
  }

  /** nothing waits to be handed over any more */
  private dropSpare(): void { this.spare = []; clearTimeout(this.spareTimer); this.handing = null; }

  /** every file of a bed: the main stem, its layers, its .m4a pieces */
  private bedFiles(id: string | null): string[] {
    const d = id ? this.beds[id] : undefined;
    return d ? [d.file, ...d.layers.map((l) => l.file), ...(d.pieces ?? []).map((p) => p.file)] : [];
  }

  /** a match's combat cues decode while it loads (see `sync` in the header): the event-bound sfx cues and the kits of
   *  the fighters in it (their calls aside), so a first hit starts inside its event's call like every later one
   *  (a cue still decoding plays from a promise, a device quantum or two late; closing critic 'audio-runtime') */
  private prewarm(client: MatchClient): void {
    if (!this.ctx) return;
    const ids = new Set<string>();
    for (const id of Object.values(this.events)) if (this.cues[id]?.bus === 'sfx') ids.add(id);
    for (const p of client.view.players) {
      const k = this.kits.get(p.fighter);
      if (k) for (const [slot, id] of Object.entries(k)) if (slot !== 'call' && id) ids.add(id);
    }
    for (const id of ids) for (const f of this.cues[id]?.files ?? []) void this.buffer(f);
  }

  /** the lock-in calls live only while a draft runs (see `memory` in the header): decoded when it opens (a lock-in
   *  answers at once), freed when it closes (a call still sounding keeps its own buffer until it ends) */
  private draftCalls(on: boolean): void {
    if (on) { if (this.ctx) for (const f of this.callFiles) void this.buffer(f); return; }
    for (const f of this.callFiles) this.buffers.delete(f);
  }

  /** a match change frees every cue buffer but the UI set's (the draft's lock-in calls are not of it) and the
   *  playing bed's (see `memory` in the header) */
  private evictCues(): void {
    const keep = new Set(this.bedFiles(this.wantBed));
    for (const c of Object.values(this.cues)) if (c.bus === 'ui') for (const f of c.files) if (!this.callFiles.has(f)) keep.add(f);
    for (const k of [...this.buffers.keys()]) if (!keep.has(k)) this.buffers.delete(k);
  }

  // ── the announcer (see `announcer` in the header) ─────────────────────────────────────────────────
  /** queue the line bound to `role` (else to `fallback`), merged by `key` (rank decides within a key) */
  private announce(role: string, band: number, rank: number, key: string, t: number, fallback?: string): void {
    const cue = this.ev(role) ?? (fallback ? this.ev(fallback) : undefined);
    if (!cue || !this.cues[cue]) return;
    const now = this.ctx?.currentTime ?? 0;
    const cur = this.annNow && now < this.annNow.until ? this.annNow.item : null;
    // a wipe swallows its own tick's takedown lines
    if (key.startsWith('kill:') && (this.annQ.some((q) => q.key === 'wipe' && q.t === t) || (cur?.key === 'wipe' && cur.t === t))) return;
    if (key === 'wipe') this.annQ = this.annQ.filter((q) => !(q.key.startsWith('kill:') && q.t === t));
    if (cur && cur.key === key && cur.rank >= rank) return;          // already saying it (or better)
    const i = this.annQ.findIndex((q) => q.key === key);
    if (i >= 0) {
      if (this.annQ[i].rank > rank) return;
      this.annQ.splice(i, 1);
    }
    this.annQ.push({ cue, band, rank, key, t, born: now });
  }

  /** speak the best waiting line when the voice bus is free (or cut a lower line for a band 0-1 one) */
  private pumpAnn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.annQ.length) return;
    const now = ctx.currentTime;
    this.annQ = this.annQ.filter((q) => now - q.born <= ANN_TTL_S[Math.min(q.band, ANN_TTL_S.length - 1)]);
    if (!this.annQ.length) return;
    this.annQ.sort((a, b) => a.band - b.band || b.rank - a.rank || a.born - b.born);
    const top = this.annQ[0];
    const cur = this.annNow;
    if (cur && now < cur.until) {
      if (!(top.band <= ANN_PREEMPT && top.band < cur.item.band)) { this.annLater(cur.until - now); return; }
      if (cur.voice) this.stopVoice(cur.voice, ANN_CUT_S);
    }
    this.annQ.shift();
    const slot: { item: AnnItem; voice: Voice | null; until: number } = { item: top, voice: null, until: now + 1 };
    this.annNow = slot;
    const news = top.band >= 1 && top.band <= ANN_LIFT_BANDS;
    const r = this.cue(top.cue, null, news ? Math.pow(10, ANN_LIFT_DB / 20) : 1, 0, {
      onVoice: (v, buf) => {
        if (this.annNow !== slot) { this.stopVoice(v, ANN_CUT_S); return; }    // cut before its file was in
        if (!this.ctx) return;
        slot.voice = v;
        slot.until = v.started + Math.max(ANN_MIN_S, buf.duration - ANN_TAIL_S);
        this.voiceDuck(slot.until, news);
        this.annLater(slot.until - this.ctx.currentTime);
      },
    });
    if (r !== 'played') { this.annNow = null; this.pumpAnn(); return; }
    if (slot.voice) return;                    // its file was decoded: onVoice already timed the line
    this.voiceDuck(slot.until, news);
    this.annLater(1);
  }

  private annLater(dt: number): void {
    clearTimeout(this.annT);
    this.annT = setTimeout(() => this.pumpAnn(), Math.max(0, dt) * 1000 + 20);
  }

  /** duck music / ambience / sfx under the voice bus until `until` (see `ducking` in the header) */
  private voiceDuck(until: number, news = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [b, d] of [['music', VOICE_DUCK_DB], ['ambience', VOICE_DUCK_DB], ['sfx', news ? SFX_DUCK_NEWS_DB : SFX_DUCK_DB]] as const) {
      const p = this.vduck.get(b)?.gain;
      if (!p) continue;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(Math.pow(10, -d / 20), now, DUCK_IN_S);
      p.setTargetAtTime(1, Math.max(now, until), DUCK_OUT_S);
    }
  }

  /** dev / probes: the announcer's state */
  get announcer(): { playing: string | null; until: number; queued: string[] } {
    const now = this.ctx?.currentTime ?? 0;
    const cur = this.annNow && now < this.annNow.until ? this.annNow : null;
    return { playing: cur?.item.cue ?? null, until: cur?.until ?? 0, queued: this.annQ.map((q) => q.cue) };
  }

  // ── match ─────────────────────────────────────────────────────────────────────────────────────
  attach(client: MatchClient | null): void {
    if (client === this.client) return;
    this.off?.();
    this.off = null;
    this.client = client;
    this.intensity = 0; this.fight = 0; this.combat = false; this.calmFor = 0;
    this.act = 0; this.structuresMax = 0; this.objNear = 0;
    this.lastT = client ? client.view.time : null;
    this.gorgeSeen = client?.view.gorgeWind ?? 0;
    this.procLast.clear();
    this.ults.clear();
    this.dealt.clear(); this.healLast.clear(); this.healAny.clear(); this.wiped.clear();
    this.hurtLast.clear(); this.objAlive.clear();
    for (const o of client?.view.objectives ?? []) this.objAlive.set(o.id, o.alive);
    this.annQ = [];
    this.rankSum = null;
    this.stopAmbience();
    this.evictCues();
    this.ambMap = client?.setup?.map ?? null;
    if (client) {
      this.prewarm(client);
      this.off = client.onEvents((evs: SimEvent[]) => {
        this.shadedHits.clear();
        for (const e of evs) if (e.e === 'damage' && e.shaded && e.ability) this.shadedHits.add(`${e.src}:${e.dst}:${e.ability}`);
        for (const e of evs) this.onEvent(e as unknown as Record<string, unknown>);
        if (this.ults.size) this.settleUlts();
        this.rankWatch(client);
        // a whole tick's lines are queued (and merged) before the best of them speaks
        if (this.annQ.length) this.pumpAnn();
      });
      this.syncAmbience();
    }
  }

  listener(focus: (() => { x: number; y: number } | null) | null): void { this.focus = focus; }

  /** (max2 SFX-10) a skill point spent: your fighter's ability ranks rose since the last batch → events.rankUp (the sim
   *  emits no event for it; the HUD's click and the auto-level both land here, on the tick the rank lands) */
  private rankSum: number | null = null;
  private rankWatch(client: MatchClient): void {
    const me = client.view.players.find((p) => p.player === client.you);
    if (!me) return;
    let n = 0;
    for (const a of me.abilities) n += a.rank;
    if (this.rankSum !== null && n > this.rankSum) this.cue(this.ev('rankUp'), null);
    this.rankSum = n;
  }

  // ── ambience (see `ambience` in the header) ──────────────────────────────────────────────────────
  /** the emitters content binds for a map: audio.ambience[map] = [{ source, cue }] → a looping ambience cue (the old
   *  'ambient.<map>.<source>' events when content lists none); each is labelled 'ambient.<map>.<source>' */
  private emitters(ctx: AudioContext, map: string): Emitter[] {
    const art = this.maps.get(map);
    const out: Emitter[] = [];
    const pre = `ambient.${map}.`;
    const bound = this.ambienceOf[map]?.length ? this.ambienceOf[map]
      : Object.entries(this.events).filter(([role]) => role.startsWith(pre)).map(([role, cue]) => ({ source: role.slice(pre.length), cue }));
    for (const { source, cue } of bound) {
      const pts = source === 'bed' ? [] : ambientPoints(art, source);
      if (source !== 'bed' && !pts.length) continue;               // a group the map does not have: nothing to place
      const em = this.emitter(ctx, pre + source, cue, pts);
      if (em) out.push(em);
    }
    return out;
  }

  /** one looping ambience-bus emitter (not started); null when `cue` is no looping ambience cue */
  private emitter(ctx: AudioContext, role: string, cue: string, pts: { x: number; y: number }[]): Emitter | null {
    const def = this.cues[cue];
    if (!def || !def.loop || def.bus !== 'ambience') return null;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 20000; lpf.Q.value = 0.7071;
    lpf.connect(pan).connect(gain).connect(this.ambDuck!);
    return { role, cue, def, pts, src: null, gain, pan, lpf, att: 0, panV: 0, lpfV: 0, started: false };
  }

  /** the epic objectives' pit presence (see `epic` in the header): an emitter at each living objective whose unit has
   *  a presence cue, faded out when it falls */
  private syncPits(ctx: AudioContext): void {
    const live = new Set<string>();
    for (const o of this.client?.view.objectives ?? []) {
      const cue = this.ukits.get(o.unit)?.presence;
      if (!cue || !o.alive) continue;
      live.add(o.id);
      if (this.pits.has(o.id)) continue;
      const em = this.emitter(ctx, `objective.${o.unit}`, cue, [{ x: o.at[0], y: o.at[1] }]);
      if (em) this.pits.set(o.id, em);
    }
    for (const [id, em] of this.pits) if (!live.has(id)) { this.fadeEmitter(ctx, em); this.pits.delete(id); }
  }

  private fadeEmitter(ctx: AudioContext, em: Emitter): void {
    em.gain.gain.cancelScheduledValues(ctx.currentTime);
    em.gain.gain.setTargetAtTime(0, ctx.currentTime, AMB_FADE_S / 3);
    // the loop leaves the graph once its fade is due, by the wall clock too (see `release` in the header)
    this.retire(em.src, [em.lpf, em.pan, em.gain], ctx.currentTime + AMB_FADE_S * 1.5, 'stop');
    em.src = null;
    em.started = true;                    // a load still in flight sees it gone (not in amb / pits) and never starts
  }

  /** the map's room (max SFX-9): content binds 'room.<map id>' to a cue whose file is the map's impulse response; no
   *  binding, no room (every voice stays dry) */
  private setRoom(map: string): void {
    const cueId = this.ev(`room.${map}`);
    const file = cueId ? this.cues[cueId]?.files[0] : undefined;
    this.roomOn = false;
    if (!file || !this.room) return;
    void this.buffer(file).then((buf) => {
      if (!buf || !this.room) return;
      try { this.room.buffer = buf; this.roomOn = true; } catch { this.roomOn = false; }
    });
  }

  /** start loops not yet started, place every emitter around the listener, duck the bus under a fight. The
   *  emitters are built once the context exists (a match attached before the first gesture waits for it) */
  private syncAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.client) return;
    if (this.ambMap) { this.setRoom(this.ambMap); this.amb = this.emitters(ctx, this.ambMap); this.ambMap = null; }
    this.syncPits(ctx);
    const t = ctx.currentTime;
    const live = (em: Emitter): boolean => this.amb.includes(em) || [...this.pits.values()].includes(em);
    for (const em of [...this.amb, ...this.pits.values()]) {
      if (!em.started) {
        em.started = true;
        void this.buffer(em.def.files[Math.floor(Math.random() * em.def.files.length)]).then((buf) => {
          if (!buf || !this.ctx || !live(em)) return;
          const src = this.ctx.createBufferSource();
          src.buffer = buf; src.loop = true;
          if (em.def.pitchVar) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * em.def.pitchVar;
          src.connect(em.lpf);
          src.start(this.ctx.currentTime, Math.random() * buf.duration);   // a random point: emitters sharing a file never phase
          em.src = src;
          if (this.log.length < 400) this.log.push(em.cue);
        });
      }
      const pl = em.pts.length ? this.ambPlace(em.pts) : { att: 1, pan: 0, lpf: 0 };
      em.att = pl.att; em.panV = pl.pan; em.lpfV = pl.lpf;
      em.gain.gain.setTargetAtTime(em.def.gain * pl.att, t, em.src ? 0.35 : AMB_FADE_S / 3);
      em.pan.pan.setTargetAtTime(pl.pan, t, 0.35);
      em.lpf.frequency.setTargetAtTime(pl.lpf || 20000, t, 0.35);
    }
    if (this.ambDuck) {
      const k = Math.max(0, Math.min(1, (this.fight - AMB_DUCK_FROM) / (AMB_DUCK_FULL - AMB_DUCK_FROM)));
      this.ambDuck.gain.setTargetAtTime(Math.pow(10, (AMB_CALM_LIFT_DB - (AMB_CALM_LIFT_DB + AMB_DUCK_DB) * k) / 20), t, k > 0 ? 0.4 : 1.5);
    }
  }

  /** an emitter's gain / pan / low-pass from all its points (energy sum, capped at full) */
  private ambPlace(pts: { x: number; y: number }[]): Place {
    const ear = this.ear();
    if (!ear) return { att: 0, pan: 0, lpf: 0 };
    let e2 = 0, panE = 0, near = Infinity;
    for (const p of pts) {
      const dx = p.x - ear.x, d = Math.hypot(dx, p.y - ear.y);
      if (d < near) near = d;
      if (d >= AMB_HEAR_M) continue;
      const a = d <= AMB_INNER_M ? 1 : ((AMB_HEAR_M - d) / (AMB_HEAR_M - AMB_INNER_M)) ** 1.5;
      e2 += a * a;
      panE += a * a * Math.max(-PAN_MAX, Math.min(PAN_MAX, dx / PAN_M));
    }
    const lpf = near <= LPF_FROM_M ? 0 : LPF_HI_HZ * (LPF_LO_HZ / LPF_HI_HZ) ** Math.min(1, (near - LPF_FROM_M) / (AMB_HEAR_M - LPF_FROM_M));
    return { att: Math.min(1, Math.sqrt(e2)), pan: e2 > 0 ? panE / e2 : 0, lpf };
  }

  private stopAmbience(): void {
    const ctx = this.ctx;
    this.ambMap = null;
    if (ctx) for (const em of [...this.amb, ...this.pits.values()]) this.fadeEmitter(ctx, em);
    this.amb = [];
    this.pits.clear();
  }

  /** dev / probes: the ambience emitters and where they are heard from now */
  get ambience(): { role: string; cue: string; points: number; playing: boolean; att: number; pan: number; lpf: number }[] {
    return this.amb.map((e) => ({ role: e.role, cue: e.cue, points: e.pts.length, playing: !!e.src, att: e.att, pan: e.panV, lpf: e.lpfV }));
  }

  /** dev / probes: the epic objectives' pit emitters (see `epic` in the header) */
  get pitEmitters(): { role: string; cue: string; playing: boolean; att: number }[] {
    return [...this.pits.values()].map((e) => ({ role: e.role, cue: e.cue, playing: !!e.src, att: e.att }));
  }

  /** dev / probes: the decoded audio the engine holds (see `memory` in the header): files settled, their PCM bytes */
  async decoded(): Promise<{ files: number; bytes: number }> {
    let files = 0, bytes = 0;
    for (const p of this.buffers.values()) {
      const b = await Promise.race([p, new Promise<null>((r) => { setTimeout(r, 50, null); })]);
      if (b?.length) { files++; bytes += b.length * b.numberOfChannels * 4; }
    }
    // a streamed bed's buffers (see `stream` in the header): its windows, the buffers its sources play, its pool
    // (round 6 AUD-6: the pool is memory the bed holds too)
    for (const c of this.bed?.streams ?? []) for (const b of streamBuffers(c)) { files++; bytes += pcmBytes(b); }
    return { files, bytes };
  }

  /** your fighter's entity (alive or not) */
  private you(): EntityLike | undefined {
    const c = this.client;
    if (!c) return undefined;
    const p = c.view.players.find((x) => x.player === c.you);
    return p ? c.view.entity(p.entity) : undefined;
  }

  /** where cues are heard from: the camera focus, else your fighter (no renderer); null outside a match */
  private ear(): { x: number; y: number } | null {
    if (!this.client) return null;
    let f: { x: number; y: number } | null = null;
    try { f = this.focus?.() ?? null; } catch { f = null; }
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) return f;
    const e = this.you();
    return e ? { x: e.x, y: e.y } : null;
  }

  /** your fighter's position while it is alive (the awareness pass); null when dead or not in a match */
  private aliveAt(): { x: number; y: number } | null {
    const e = this.you();
    return e && e.alive !== false ? { x: e.x, y: e.y } : null;
  }

  /** a spatial cue's gain / pan / low-pass around the listener (see `listener` in the header) */
  private place(pos: { x: number; y: number }, aware: boolean): Place {
    const ear = this.ear();
    if (!ear) return { att: 1, pan: 0, lpf: 0 };
    const dx = pos.x - ear.x, d = Math.hypot(dx, pos.y - ear.y);
    let att = d <= LISTEN_INNER_M ? 1 : d >= LISTEN_HEAR_M ? 0 : ((LISTEN_HEAR_M - d) / (LISTEN_HEAR_M - LISTEN_INNER_M)) ** 1.5;
    let lpf = d <= LPF_FROM_M ? 0 : LPF_HI_HZ * (LPF_LO_HZ / LPF_HI_HZ) ** Math.min(1, (d - LPF_FROM_M) / (LISTEN_HEAR_M - LPF_FROM_M));
    const pan = Math.max(-PAN_MAX, Math.min(PAN_MAX, dx / PAN_M));
    if (aware && att < AWARE_GAIN) {
      const me = this.aliveAt();
      if (me && Math.hypot(pos.x - me.x, pos.y - me.y) <= AWARE_M) { att = AWARE_GAIN; lpf = 0; }
    }
    return { att, pan, lpf, d };
  }

  private ent(id: unknown): EntityLike | undefined {
    return typeof id === 'number' ? this.client?.view.entity(id) : undefined;
  }

  private myTeam(): number {
    const c = this.client;
    return c?.view.players.find((x) => x.player === c.you)?.team ?? -1;
  }

  /** fog: you hear only what your team can see (your own team always), like the renderer draws it */
  private seen(x: EntityLike | undefined): boolean {
    const team = this.myTeam();
    if (!x || team < 0 || x.team === team) return true;
    return (((x.visibleMask ?? 0) >>> team) & 1) === 1;
  }

  private seenAt(x: number, y: number): boolean {
    const team = this.myTeam();
    const v = this.client?.view as unknown as { visionGrid?: (t: number) => { cell: number; width: number; height: number; data: ArrayLike<number> } } | undefined;
    if (team < 0 || !v?.visionGrid) return true;
    try {
      const g = v.visionGrid(team);
      const i = Math.floor(x / g.cell), j = Math.floor(y / g.cell);
      return i >= 0 && j >= 0 && i < g.width && j < g.height && g.data[j * g.width + i] > 0;
    } catch { return true; }
  }

  /** an ultimate's release (see `kits` in the header): the first effect of the cast at or after its wind-up's end
   *  sounds the caster's ult_release (a release with no effect event: settleUlts) */
  private release(kind: string, e: Record<string, unknown>, src: EntityLike | undefined, aw: CueOpts): void {
    const id = e.src;
    const p = typeof id === 'number' ? this.ults.get(id) : undefined;
    if (!p || (e.t as number) + RELEASE_EPS_S < p.due) return;
    if (kind !== 'dash' && kind !== 'blink'
      && !((kind === 'area' || kind === 'projectile' || kind === 'hit' || kind === 'damage') && e.ability === p.ability)) return;
    // a dash in the tick the caster is knocked airborne is the displacement (it cancels the wind-up), not its release
    if (kind === 'dash' && this.knocked.get(id as number) === e.t) return;
    this.ults.delete(id as number);
    this.cue(p.cue, kind === 'area' ? { x: e.x as number, y: e.y as number } : src ? { x: src.x, y: src.y } : null, 1, 0, aw);
  }

  /** after a whole batch of events: a wind-up whose release committed (the ult's cooldown started) without an effect
   *  event in the batch sounds now, at the caster; one past its release tick with no commit was cancelled */
  private settleUlts(): void {
    const now = this.client?.view.time ?? 0;
    for (const [cid, w] of this.ults) {
      const c = this.ent(cid);
      if (c && c.alive !== false && this.ultCooldown(cid) > w.cd0 + 0.5) {
        this.ults.delete(cid);
        if (this.seen(c)) this.cue(w.cue, { x: c.x, y: c.y }, 1, 0, { aware: c.team !== this.myTeam() });
      } else if (!c || c.alive === false || now > w.due + RELEASE_EPS_S) this.ults.delete(cid);
    }
  }

  /** the music's dead state follows your fighter (see `dead` in the header) */
  private deadState(): void {
    const ctx = this.ctx;
    if (!ctx || !this.deadLpf || !this.deadGain) return;
    const me = this.client ? this.you() : undefined;
    const dead = !!me && me.alive === false;
    if (dead === this.deadOn) return;
    this.deadOn = dead;
    const now = ctx.currentTime;
    this.deadLpf.frequency.cancelScheduledValues(now);
    this.deadLpf.frequency.setTargetAtTime(dead ? DEAD_LPF_HZ : 20000, now, DEAD_IN_S);
    this.deadGain.gain.cancelScheduledValues(now);
    this.deadGain.gain.setTargetAtTime(dead ? Math.pow(10, DEAD_DB / 20) : 1, now, DEAD_IN_S);
  }

  /** dev / probes: whether the music is in its dead state */
  get musicDead(): boolean { return this.deadOn; }

  /** the ult cooldown of the fighter `entity` (0 when ready or unknown): the sim starts it on a release */
  private ultCooldown(entity: number): number {
    const p = this.client?.view.players.find((x) => x.entity === entity);
    return p?.abilities.find((a) => a.slot === 'ult')?.cooldown ?? 0;
  }

  private onEvent(e: Record<string, unknown>): void {
    const kind = e.e as string;
    // a shot that lands after its shooter died still sounds as the shooter's (max SFX-1: a dead Wick's bolt was the
    // library's c_hit_phys_light): the attacker as it was when it swung or fired
    const src = this.ent(e.src) ?? (kind === 'damage' && typeof e.src === 'number' ? this.shooters.get(e.src) : undefined), dst = this.ent(e.dst);
    if ((kind === 'attack' || kind === 'projectile') && src) {
      this.shooters.delete(src.id);
      this.shooters.set(src.id, { id: src.id, kind: src.kind, def: src.def, team: src.team, x: src.x, y: src.y });
      if (this.shooters.size > SHOOTERS_MAX) this.shooters.delete(this.shooters.keys().next().value as number);
    }
    // before fog: whose damage this tick was (vamp), and a wipe (the HUD banners both whatever you can see)
    if (kind === 'damage' && typeof e.src === 'number') this.dealt.set(e.src, e.t as number);
    if (kind === 'status' && e.status === 'airborne' && typeof e.dst === 'number') this.knocked.set(e.dst, e.t as number);
    if (kind === 'death' && e.kind === 'fighter' && dst) this.wipeCheck(dst.team, e.t as number);
    if (kind === 'respawn') {
      const p = this.client?.view.players.find((x) => x.player === e.player);
      if (p) this.wiped.delete(p.team);
    }
    // events about a unit your team cannot see stay silent (a panned sound would give the unit away)
    const subject = kind === 'cast' || kind === 'projectile' || kind === 'attack' || kind === 'dash' || kind === 'blink' ? src
      : kind === 'hit' || kind === 'damage' || kind === 'heal' || kind === 'shield' || kind === 'status' || kind === 'death' ? dst
      : kind === 'proc' ? dst ?? src : undefined;
    if (kind === 'proc' && subject && !this.seen(subject)) { this.procStats.unseen++; return; }
    if (subject && !this.seen(subject)) return;
    if (kind === 'area' && !this.seen(src) && !this.seenAt(e.x as number, e.y as number)) return;
    const at = (x: EntityLike | undefined): { x: number; y: number } | null => (x ? { x: x.x, y: x.y } : null);
    const ear = this.ear(), me = this.aliveAt();
    const near = (p: { x: number; y: number } | null): boolean => !!p && (
      (!!ear && Math.hypot(p.x - ear.x, p.y - ear.y) < NEAR_COMBAT_M) || (!!me && Math.hypot(p.x - me.x, p.y - me.y) < AWARE_M));
    // a threat to your fighter (the awareness pass): a non-allied fighter / tower / monster acting, or anything
    // landing on you; Wick swings are not threats worth lifting over the camera's mix
    const youId = this.you()?.id;
    const mine = this.myTeam();
    const onYou = youId !== undefined && (e.dst === youId || e.target === youId);
    // priority: an enemy (or a monster) aiming at you, or anything landing on you, +1; an ally's own action −1
    const lift = src ? (src.team !== mine ? (onYou ? 1 : 0) : src.id !== youId && !onYou ? -1 : 0) : onYou ? 1 : 0;
    const aw: CueOpts = { aware: (!!src && src.team !== mine && src.kind !== 'minion') || onYou, lift,
      you: !!src && youId !== undefined && src.id === youId, camp: src?.kind === 'monster' && !this.uk(src) };
    if (this.ults.size) this.release(kind, e, src, aw);
    switch (kind) {
      case 'cast': {
        const slot = e.slot as string;
        const uk = this.uk(src);
        const ua = this.unitAb.get(e.ability as string);
        const own = slot === 'ult' ? this.kit(src, 'ult_windup') : CAST_SLOTS.has(slot) ? this.kit(src, slot as KitSlot) : undefined;
        const pr = this.abilitySfx.get(e.ability as string);
        // an epic unit's cast: its ability's own wind-up, else its shared one; never castMonster (see `epic`)
        if (uk) this.cue((ua ? uk[ua.slot] : undefined) ?? uk.cast, at(src), 1, 0, aw);
        else if (this.wardSetAb.has(e.ability as string) && this.ev('wardSet')) this.cue(this.ev('wardSet'), at(src), 1, 0, aw);
        else this.cue(own ?? pr?.sfx ?? this.ev(slot === 'ult' ? 'castUlt' : src?.kind === 'monster' ? 'castMonster' : 'cast'), at(src), 1, 0, aw);
        // the shared shade-breath swell for every enemy fighter's T3+ wind-up (STYLE_BIBLE 'enemy T3+ wind-ups share one
        // shade-breath swell'; see `threat` in the header), placed at the caster like any spatial cue
        if (src?.kind === 'fighter' && src.team !== mine) {
          if (slot === 'ult') this.cue(this.ev('enemyUltWindup'), at(src), 1, 0, aw);
          else if (((e.castTime as number) || 0) > 0 && this.threats.has(e.ability as string)) {
            this.cue(this.ev('enemyWindup') ?? this.ev('enemyUltWindup'), at(src), 1, 0, aw);
          }
        }
        // the ult's release waits for the wind-up's end (see `kits`); any new cast ends a wait still open
        if (src) {
          const rel = slot === 'ult' ? this.kit(src, 'ult_release') : undefined;
          if (rel) this.ults.set(src.id, { cue: rel, ability: e.ability as string, due: (e.t as number) + ((e.castTime as number) || 0), cd0: this.ultCooldown(src.id) });
          else this.ults.delete(src.id);
        }
        break;
      }
      case 'projectile': {
        // the generic whoosh, except under a kitted ult (its release is the sound) and an epic unit's shot (its own
        // attack_swing / land carries it; see `kits` / `epic` in the header)
        // (max SFX-1) nor under a kitted fighter's shot (its own swing / cast carries the throw) or a Wick's (its own
        // shot cue carries its whoosh): the generic pass-by is for unkitted sources only (Needles, camps, items)
        const own = this.ownAb.get(e.ability as string);
        if (this.uk(src) || (own?.slot === 'ult' && this.kits.get(own.fighter)?.ult_release)) break;
        if (src?.kind === 'minion' || (src?.kind === 'fighter' && !!src.def && this.kits.has(src.def))) break;
        this.cue(this.ev('projectile'), at(src), 0.7, 0, aw);
        break;
      }
      case 'hit': {
        // a fighter's ability landing: its own impact (kit 'hit') before the ability's present.hitSfx and the role; a
        // hitSfx that means a damage type or a crit (SEMANTIC_HIT_ROLES) still sounds, under the kit hit
        const pr = this.abilitySfx.get(e.ability as string);
        const uk = this.uk(src);
        if (uk) { this.cue(uk.hit, at(dst), 1, 0, aw); break; }     // an epic unit: its own impact or none (see `epic`)
        const lib = (e.sfx as string | undefined) ?? pr?.hitSfx;
        // a delivery touching your own side is no impact (see `kits` in the header): only a hitSfx content wrote for it
        if (src && dst && src.team === dst.team) { if (lib) this.cue(lib, at(dst), 1, 0, aw); break; }
        // (max2 SFX-4) the slot's own impact when content binds one, else the kit's shared ability impact
        const ab = this.ownAb.get(e.ability as string);
        const slotHit = ab && src?.kind === 'fighter' && src.def === ab.fighter ? this.kits.get(ab.fighter)?.[`${ab.slot}_hit` as KitSlot] : undefined;
        const own = slotHit ?? this.kit(src, 'hit');
        // a Ringshade-muffled ability blow (its damage, later in this batch, says `shaded`; the 'damage' case plays the thud)
        const hg = dst?.kind === 'structure' && !!this.ev('hitShaded') && this.shadedHits.has(`${e.src}:${e.dst}:${e.ability}`) ? SHADED_GAIN : 1;
        // a wave clear is texture, a blow on a fighter is the news (see WAVE_HIT_GAIN)
        const wg = hg * (dst?.kind === 'minion' ? WAVE_HIT_GAIN : 1);
        this.cue(own ?? lib ?? this.ev('hitAbility'), at(dst), wg, 0, aw);
        if (own && lib && lib !== own && SEMANTIC_HIT_ROLES.some((r) => this.ev(r) === lib)) this.cue(lib, at(dst), SEMANTIC_KIT_GAIN * wg, 0, aw);
        break;
      }
      case 'area': {
        // as heard (see `kits` / `epic` in the header): a kitted fighter's or epic unit's own landing only; anything
        // else its own sfx, else the cue content binds to its vfx ('area.<vfx>': a passive's area with no sound of its own)
        const sfx = this.areaCue(e, src);
        if (sfx) this.cue(sfx, { x: e.x as number, y: e.y as number }, 1, ((e.delay as number) || 0) + ((e.life as number) || 0), aw);
        break;
      }
      case 'attack': {
        // an epic unit swings at a fighter's level, with its own swing (see `epic` in the header)
        const uk = this.uk(src);
        const swing = this.kit(src, 'attack_swing') ?? (uk ? uk.attack_swing : this.abilitySfx.get(`attack:${src?.def}`)?.sfx ?? this.ev('attack'));
        this.cue(swing, at(src), src?.kind === 'fighter' || uk ? 0.6 : src?.kind === 'structure' ? 0.8 : src?.kind === 'minion' ? WICK_SWING_GAIN : 0.3, 0, aw);
        break;
      }
      case 'damage': {
        const p = at(dst);
        const duel = src?.kind === 'fighter' && dst?.kind === 'fighter';
        if (near(p)) this.intensity = Math.min(1, this.intensity + (duel ? 0.12 : 0.02));
        if (near(p) && duel) this.fight = Math.min(1, this.fight + FIGHT_HIT);
        // a blow the Ringshade took the edge off (the sim's `shaded`: too few of the striker's Wicks guard the structure)
        // is muffled: the role 'hitShaded' under the hit, the hit itself at SHADED_GAIN (see `world` in the header)
        const shaded = !!e.shaded && dst?.kind === 'structure' && !!this.ev('hitShaded');
        if (shaded) this.cue(this.ev('hitShaded'), p, 1, 0, aw);
        // an epic unit struck after a calm roars: someone started it (see `epic` in the header)
        const duk = this.uk(dst);
        if (duk && dst) {
          const t = e.t as number;
          if (t - (this.hurtLast.get(dst.id) ?? -1e9) > ROAR_CALM_S) this.cue(duk.roar, p, 1, 0, aw);
          this.hurtLast.set(dst.id, t);
        }
        // (max SFX-5) a structure answers a blow in its own material ('structureStruck.<unit>', else 'structureStruck'),
        // after and under the attacker's hit, once per STRUCK_GAP_S per structure (a Ringshade-muffled blow does not ring)
        const struck = (): void => {
          if (dst?.kind !== 'structure' || shaded) return;
          const now = this.ctx?.currentTime ?? 0;
          const id = (dst.def ? this.ev(`structureStruck.${dst.def}`) : undefined) ?? this.ev('structureStruck');
          if (id && now - (this.struckLast.get(dst.id) ?? -1e9) > STRUCK_GAP_S
            && this.cue(id, p, STRUCK_GAIN, 0, aw) === 'played') this.struckLast.set(dst.id, now);
        };
        // (max SFX-7) a fighter's ward broken by this blow (it absorbed some and none is left): the pane cracks, an
        // awareness cue when it was yours or a foe's aimed at you (presentation only: the view's shield after the tick)
        if (dst?.kind === 'fighter' && ((e.shielded as number) || 0) > 0 && (dst.shield ?? 1) <= 0) {
          const now = this.ctx?.currentTime ?? 0;
          if (now - (this.shieldBroke.get(dst.id) ?? -1e9) > SHIELD_BREAK_GAP_S) {
            this.shieldBroke.set(dst.id, now);
            this.cue(this.ev('shieldBreak'), p, 1, 0, dst.id === youId ? { aware: true, lift: 1 } : aw);
          }
        }
        // ability hits voice through `hit`; a passive's damage with no delivery through the `proc` that follows it
        if (e.ability) { struck(); break; }
        const uk = this.uk(src);
        const own = this.kit(src, 'attack_hit') ?? uk?.attack_hit;
        if (e.crit) {
          this.cue(this.ev('crit'), p, 1, 0, aw);
          if (own) this.cue(own, p, CRIT_KIT_GAIN, 0, aw);      // whose crit it was
        } else if (uk) this.cue(own, p, 0.8 * (shaded ? SHADED_GAIN : 1), 0, aw);   // an epic unit lands like a fighter
        else this.cue(own ?? this.abilitySfx.get(`attack:${src?.def}`)?.hitSfx ?? this.ev(e.dtype === 'magic' ? 'hitMagic' : e.dtype === 'true' ? 'hitTrue' : 'hitPhysical'), p, (src?.kind === 'fighter' ? 0.8 : src?.kind === 'minion' && dst?.kind === 'minion' ? this.wickDuck(p) : 0.45) * (shaded ? SHADED_GAIN : 1), 0, aw);
        struck();
        break;
      }
      case 'heal': {
        // lifesteal / omnivamp (a self-heal in the tick of its own damage) is not voiced; one target's heals merge
        if (e.src === e.dst && this.dealt.get(e.src as number) === e.t) break;
        const now = this.ctx?.currentTime ?? 0;
        // a fighter's heal of some size, and a repeat chain's first tick only (see `match` in the header)
        if (!dst || dst.kind !== 'fighter') break;
        const chained = now - (this.healAny.get(dst.id) ?? -1e9) < HEAL_CHAIN_S;
        this.healAny.set(dst.id, now);
        if (chained || (dst.maxHp ?? 0) <= 0 || (e.amount as number) < HEAL_MIN_FRAC * (dst.maxHp as number)) break;
        if (now - (this.healLast.get(dst.id) ?? -1e9) < HEAL_MERGE_S) break;
        if (this.cue(this.ev('heal'), at(dst), 0.7, 0, aw) === 'played' && dst) this.healLast.set(dst.id, now);
        break;
      }
      // a structure's shield is the Dawn Seal setting again (the role 'shieldStructure'), not a fighter's ward
      case 'shield': this.cue((dst?.kind === 'structure' ? this.ev('shieldStructure') : undefined) ?? this.ev('shield'), at(dst), 1, 0, aw); break;
      case 'status': {
        // fighters only (a Wick's slow is noise); no catch-all: an unbound kind (a rider on a hit that sounds) is silent
        if (dst?.kind !== 'fighter') break;
        const k = e.status as string;
        const by = dst.statuses?.filter((x) => x.kind === k).map((x) => this.ent(x.src)) ?? [];
        const hostile = by.some((x) => !!x && x.team !== dst.team);
        this.cue(this.ev(`status.${k}`), at(dst), 0.8 * (hostile && e.dst === youId ? YOU_CC_GAIN : 1), 0, aw);
        break;
      }
      case 'proc': {
        // a passive fired (see `procs` in the header): its payoff's sound at the subject, else at the owner
        const id = e.ability as string;
        const pv = this.passives.get(id);
        const cueId = pv ? pv.cue ?? this.ev(`proc.${pv.kind}`) : undefined;
        if (!cueId || !this.cues[cueId]) { this.procStats.unbound++; break; }
        const now = this.ctx?.currentTime ?? 0;
        const key = `${id}:${e.src as number}`;
        const item = !pv?.cue && pv?.kind === 'item';
        const gap = PERIODIC_ON.has(e.on as string) ? PROC_PERIODIC_S : item ? PROC_ITEM_GAP_S : PROC_GAP_S;
        if (now - (this.procLast.get(key) ?? -1e9) < gap) { this.procStats.throttled++; break; }
        const r = this.cue(cueId, at(dst ?? src), item ? Math.pow(10, PROC_ITEM_DB / 20) : 1, 0, aw);
        if (r === 'played') this.procLast.set(key, now);
        this.procStats[r === 'none' ? 'unbound' : r]++;
        break;
      }
      // a fighter's own dash (kit 'dash'); a displacement (the sim knocks a unit airborne, then dashes it, in one tick)
      // stays generic
      case 'dash': this.cue((this.knocked.get(e.src as number) === e.t ? undefined : this.kit(src, 'dash')) ?? this.ev('dash'), at(src), 1, 0, aw); break;
      case 'blink': this.cue(this.ev('blink'), at(src), 1, 0, aw); break;
      case 'death': {
        const k = e.kind as string;
        if (k === 'fighter') {
          this.cue(this.kit(dst, 'death') ?? this.ev('fighterDeath'), at(dst));
          const youEnt = this.client?.view.players.find((x) => x.player === this.client?.you)?.entity;
          if (e.dst === youEnt) this.cue(this.ev('selfDown'), null);
          else if (dst && dst.team === this.myTeam()) this.cue(this.ev('allyDown'), null);
          else if (dst && e.by !== this.client?.you) this.cue(this.ev('enemyDown'), null);   // yours: 'takedown' carries it
        } else if (k === 'minion') this.cue(this.ev('minionDeath'), at(dst), 0.45);
        else if (k === 'ward') this.cue(this.ev('wardOut'), at(dst));
        else if (k === 'summon') this.cue(this.ev('summonOut'), at(dst), 0.8);
        else if (k === 'monster') {
          const uk = this.uk(dst);
          this.cue(uk ? uk.death : this.ev('monsterDeath'), at(dst), 1, 0, { camp: !uk });   // an epic unit's own fall (see `epic`)
          if (dst) this.hurtLast.delete(dst.id);
        }
        break;
      }
      case 'takedown': if (e.killer === this.client?.you) this.cue(this.ev('takedown'), null); break;
      case 'respawn': if (e.player === this.client?.you) this.cue(this.ev('respawn'), null); break;
      case 'levelUp': if (e.player === this.client?.you) this.cue(this.ev('levelUp'), null); break;
      case 'gold': {
        // (max SFX-8) a last hit's coins at GOLD_GAIN, stepping up GOLD_STEP_ST a rung while last hits chain within
        // GOLD_CHAIN_S (a combo ladder, GOLD_RUNGS high); a kill's own spill ('goldKill'), else the last-hit coins
        if (e.player !== this.client?.you) break;
        const now = this.ctx?.currentTime ?? 0;
        if (e.reason === 'cs') {
          this.goldRung = now - this.goldLast < GOLD_CHAIN_S ? Math.min(GOLD_RUNGS, this.goldRung + 1) : 0;
          this.goldLast = now;
          this.cue(this.ev('gold'), null, GOLD_GAIN, 0, { rate: Math.pow(2, (GOLD_STEP_ST * this.goldRung) / 12) });
        } else if (e.reason === 'kill') this.cue(this.ev('goldKill') ?? this.ev('gold'), null, GOLD_GAIN);
        break;
      }
      // the world sound where it fell; the announcer line comes from the 'announce' that follows (one line per event)
      case 'structure': {
        // (max SFX-5) the unit's own fall ('structureFall.<unit>': the Lantern, the Hourbell), else the shared one
        const se = this.ent(e.id), def = (e.def as string | undefined) ?? se?.def;
        this.cue((def ? this.ev(`structureFall.${def}`) : undefined) ?? this.ev('structureFall'), at(se));
        break;
      }
      case 'wave': if ((e.n as number) <= 1) this.cue(this.ev('waveSpawn'), null); break;
      case 'recall': if (e.player === this.client?.you) this.cue(this.ev(e.state === 'done' ? 'recallDone' : e.state === 'start' ? 'recallStart' : 'recallCancel'), null); break;
      case 'ping': {
        // team-private: only a ping made by a player of your team sounds (the HUD draws only those)
        const by = this.client?.view.players.find((x) => x.player === e.player);
        if (!by || by.team !== this.myTeam()) break;
        this.cue(this.ev(`ping.${e.kind as string}`), null);
        break;
      }
      case 'pickup': if (e.player === this.client?.you) this.cue(this.ev('pickup'), null); break;
      case 'announce': this.onAnnounce(e); break;
      case 'eliminated': if (e.player === this.client?.you) this.announce('eliminated', 1, 1, 'you', e.t as number); break;
      case 'suddenDeath': this.announce('suddenDeath', 0, 1, 'flow', e.t as number); break;
      default: break;
    }
  }

  /** an 'announce' event → at most one announcer line (see `announcer` in the header). Line roles: 'announce.first',
   *  'announce.multi.<n>' (2-5), 'announce.shutdown', 'announce.structure.<own|foe>' (WHOSE structure fell: own = your
   *  loss), 'announce.objective[.<unit>].<own|foe>' (WHO took it: own = your gain), 'announce.wipe.<own|foe>' (whose team
   *  is down), 'announce.surrender_vote' / '…_failed', 'announce.structure_respawned', 'announce.eliminated', else
   *  'announce.<key>'; an unbound line falls back to announceMajor / announceMinor */
  private onAnnounce(e: Record<string, unknown>): void {
    const key = e.key as string;
    const t = e.t as number;
    const mine = this.myTeam();
    const you = this.client?.you;
    const pl = e.player as number | undefined;
    const p = (e.params ?? {}) as Record<string, unknown>;
    switch (key) {
      // a personal refusal is a UI error, not the announcer's
      case 'shop_denied': if (pl === you) this.cue(this.ev('shopDenied'), null); break;
      case 'practice_reset': case 'practice': if (pl === undefined || pl === you) this.announce('announce.practice', 5, 1, 'practice', t, 'announceMinor'); break;
      // a team's own business (a surrender vote, its outcome) is only that team's to hear
      case 'surrender_vote': if (e.team === mine) this.announce('announce.surrender_vote', 4, 1, 'vote', t, 'announceMinor'); break;
      case 'surrender_failed': if (e.team === mine) this.announce('announce.surrender_failed', 4, 2, 'vote', t, 'announceMinor'); break;
      // these have their own sound: the end sting, matchStart at time 0, the suddenDeath event
      case 'surrender_passed': case 'match_start': case 'sudden_death': break;
      case 'first_blood': this.announce('announce.first', 2, 6, `kill:${pl}`, t, 'announceMajor'); break;
      case 'multikill': {
        const n = Math.max(2, Math.min(5, Math.round(Number(p.n) || 2)));
        this.announce(`announce.multi.${n}`, 2, 10 + n, `kill:${pl}`, t, 'announceMajor');
        break;
      }
      case 'shutdown': this.announce('announce.shutdown', 2, 5, `kill:${pl}`, t, 'announceMinor'); break;
      case 'structure_destroyed': this.announce(`announce.structure.${e.team === mine ? 'own' : 'foe'}`, 3, 5, `obj:${t}`, t, 'announceMajor'); break;
      case 'objective_taken': {
        const side = e.team === mine ? 'own' : 'foe';
        const named = `announce.objective.${String(p.unit ?? '')}.${side}`;
        this.announce(this.ev(named) ? named : `announce.objective.${side}`, 3, 4, `obj:${t}`, t, 'announceMajor');
        break;
      }
      case 'structure_respawned': this.announce('announce.structure_respawned', 4, 1, `resp:${t}`, t, 'announceMinor'); break;
      case 'eliminated': if (pl !== you) this.announce('announce.eliminated', 4, 1, `elim:${pl}`, t, 'announceMinor'); break;
      // a key content voices as a world sound ('world.<key>': the Noon Toll's hour-bell) is no line: it plays at once,
      // outside the announcer's queue, and ducks nothing
      default: {
        const world = this.ev(`world.${key}`);
        if (world) this.cue(world, null);
        else this.announce(`announce.${key}`, 5, 1, key, t, 'announceMinor');
      }
    }
  }

  /** every fighter of `team` down at once (a team of two or more): the wipe line, once until one of them is back */
  private wipeCheck(team: number, t: number): void {
    const v = this.client?.view;
    if (!v || this.wiped.has(team)) return;
    const ps = v.players.filter((p) => p.team === team);
    if (ps.length < 2 || !ps.every((p) => p.respawnIn > 0 || !(v.entity(p.entity)?.alive ?? false))) return;
    this.wiped.add(team);
    this.announce(`announce.wipe.${team === this.myTeam() ? 'own' : 'foe'}`, 1, 20, 'wipe', t);
  }

  /** combat intensity → the bed's combat layer (bar-quantised enter/leave, tokens.audio.beds.match) */
  private update(dt: number): void {
    this.watchClock();
    const view = this.client?.view;
    if (view && this.lastT !== null) {
      const t0 = this.lastT, t1 = view.time;
      for (const s of [-3, -2, -1]) if (t0 < s && t1 >= s) this.announce('countdown', 0, 1, 'flow', s);
      if (t0 < 0 && t1 >= 0) this.announce('matchStart', 0, 2, 'flow', 0);
      if (this.annQ.length) this.pumpAnn();
      // the world's own moments (see `world` in the header): each Gorge Wind step; the Dawn Seal ending on every
      // standing sealed structure
      const gw = view.gorgeWind ?? 0;
      if (gw > this.gorgeSeen) this.cue(this.ev('gorgeWind'), null);
      this.gorgeSeen = gw;
      // an epic objective coming alive roars in its pit (see `epic` in the header)
      for (const o of view.objectives ?? []) {
        if (o.alive && this.objAlive.get(o.id) === false) this.cue(this.ukits.get(o.unit)?.roar, { x: o.at[0], y: o.at[1] });
        this.objAlive.set(o.id, o.alive);
      }
      const seal = this.seals.get(view.mode);
      const brk = this.ev('sealBreak');
      if (seal && brk && t0 < seal.until && t1 >= seal.until) {
        for (const u of view.entities) if (u.kind === 'structure' && u.alive && seal.units.includes(u.def)) this.cue(brk, { x: u.x, y: u.y });
      }
    }
    this.lastT = view ? view.time : null;
    this.deadState();
    this.intensity = Math.max(0, this.intensity - dt * 0.12);
    this.fight = Math.max(0, this.fight - dt * FIGHT_DECAY);
    this.syncAmbience();
    const b = this.bed;
    if (!b || !this.ctx) return;
    if (view) { this.actNow(view); this.objNear = this.objectiveNear(view); } else this.objNear = 0;
    if (b.streams.length) this.streamNow(b); else this.sectionsNow(b);
    // phases nobody drives walk themselves (see `music` in the header)
    const phases = b.layers.filter((l) => l.role === 'phase');
    if (!this.phaseDriven && phases.length && b.t0 !== null) {
      const at = this.ctx.currentTime - b.t0;
      const auto = at >= AUTO_PHASE_S[1] ? phases[phases.length - 1].id.slice('phase_'.length)
        : at >= AUTO_PHASE_S[0] ? phases[0].id.slice('phase_'.length) : null;
      if (auto !== this.phase) { this.phase = auto; this.bedRoles(); }
    }
    if (!b.layers.some((l) => l.role === 'combat')) return;
    if (!this.combat && this.intensity > 0.6) { this.combat = true; this.calmFor = 0; }
    else if (this.combat) {
      this.calmFor = this.intensity < 0.35 ? this.calmFor + dt : 0;
      if (this.calmFor > 8) this.combat = false;
    }
    this.bedRoles();
  }
}

/** a bed layer's role by its id (see `music` in the header): the first layer with no other role is the combat layer
 *  (`combat`: one came already) */
function layerRole(id: string, combat: boolean): LayerRole {
  return id.startsWith('stem') ? 'stem' : id.startsWith('phase_') ? 'phase' : id.startsWith('urgency_') ? 'urgency'
    : id.startsWith('objective') ? 'objective' : combat ? 'stem' : 'combat';
}

/** an AudioBuffer's PCM bytes (32-bit float per sample per channel) */
function pcmBytes(b: AudioBuffer): number { return b.length * b.numberOfChannels * 4; }

/** every buffer a chain holds (see `stream` in the header), each once: windows cached, buffers its sources play, its pool */
function streamBuffers(c: Stream): Set<AudioBuffer> {
  const out = new Set<AudioBuffer>(c.holds.keys());
  for (const w of c.win.values()) for (const b of w.v ?? []) if (b) out.add(b);
  for (const p of c.pool) for (const b of p) out.add(b);
  for (const b of c.busy) out.add(b);
  return out;
}

/** the section after `from` in an act's order; a section the act does not play goes on to the act's next one above it */
function nextSection(seq: readonly number[], from: number): number {
  const i = seq.indexOf(from);
  if (i >= 0) return seq[(i + 1) % seq.length];
  return seq.find((s) => s > from) ?? seq[0];
}

/** the equal-power cross-fade of a jump between sections, 33 points */
const XF_CURVES = (() => {
  const n = 33, a = new Float32Array(new ArrayBuffer(n * 4)), b = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) { const th = (i / (n - 1)) * Math.PI / 2; a[i] = Math.sin(th); b[i] = Math.cos(th); }
  return { in: a, out: b };
})();

/** an ability's effects make its wind-up T3 (see `threat` in the header): at any depth, a control status (T3_STATUS)
 *  not applied to the caster, a displacement, a dash / blink or a zone */
function isT3(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(isT3);
  if (!node || typeof node !== 'object') return false;
  const o = node as Record<string, unknown>;
  if (typeof o.op === 'string') {
    if (T3_OPS.has(o.op)) return true;
    if (o.op === 'status' && T3_STATUS.has(o.status as string) && o.to !== 'self') return true;
  }
  return Object.values(o).some((v) => v && typeof v === 'object' && isT3(v));
}

/** the points of one art.ambient group (see `ambience` in the header): an effect by its vfx id, a critter by its
 *  id, a prop by its fx's vfx id or its model's file name (without .glb, and without the content build's
 *  content-address prefix: content's assets/props/ambient/bunting.glb ships as assets/<hash>-bunting.glb) */
function ambientPoints(art: AmbientLike | undefined, source: string): { x: number; y: number }[] {
  const at: number[][] = [];
  for (const e of art?.effects ?? []) if (e.vfx === source) at.push(...e.at);
  for (const c of art?.critters ?? []) if (c.id === source) at.push(...c.spots);
  for (const p of art?.props ?? []) {
    const file = p.model.slice(p.model.lastIndexOf('/') + 1).replace(/\.glb$/, '').replace(/^[0-9a-f]{12}-/, '');
    if (p.fx?.vfx === source || file === source) at.push(...p.at);
  }
  return at.filter((a) => Number.isFinite(a[0]) && Number.isFinite(a[1])).map((a) => ({ x: a[0], y: a[1] }));
}

/** the soft clip after the limiter (see `buses` in the header): linear to CLIP_KNEE, then a tanh knee that never
 *  passes CLIP_CEIL (−1 dBFS); odd-symmetric, 4097 points over −1..1 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const room = CLIP_CEIL - CLIP_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= CLIP_KNEE ? a : CLIP_KNEE + room * Math.tanh((a - CLIP_KNEE) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** the dev switch ?audio=m4a forces the fallback (to test it in any browser; dev builds only, like ?dev=1); a
 *  browser whose media stack says it cannot play Ogg Opus starts on .m4a; otherwise the first .ogg decode decides */
function initialFormat(): 'ogg' | 'm4a' | null {
  let devBuild = false;
  try { devBuild = !!import.meta.env?.DEV; } catch { devBuild = false; }
  try {
    if (devBuild && new URLSearchParams(location.search).get('audio') === 'm4a') return 'm4a';
    if (document.createElement('audio').canPlayType('audio/ogg; codecs=opus') === '') return 'm4a';
  } catch { /* no DOM: decide on the first decode */ }
  return null;
}

export function createAudioEngine(o: { catalog: unknown; assetUrl: (ref: string) => string; settings: unknown }): ValeAudioPort {
  const s = (o.settings as { audio?: AudioSettings }).audio ?? { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true };
  return new Engine(o.catalog as CatalogLike, o.assetUrl, s);
}

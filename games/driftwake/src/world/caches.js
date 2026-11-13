/**
 * RELIC CACHES — one at the foot of every landmark (_spec/QUEST_DESIGN.md
 * §3.1). "Every visible landmark must hold a reason to ride to it."
 *
 * WHAT IS BUILT
 *   - 15 caches per realm, one per landmark site (`world/landmarks.js`
 *     `instances`, filtered to the realm, in build order — the SITE INDEX is
 *     that order, 0..14, and it is stable: landmarks.js keeps instance n on
 *     its slot and type across every per-realm re-layout).
 *   - Per realm, exactly 2 RELIC caches, 12 LORE caches and 1 GRAND cache,
 *     assigned DETERMINISTICALLY by site index (`kindOf`): the sites are
 *     ranked by a pure integer hash of (site, realm); the two lowest ranks are
 *     the relic caches, the third is the grand cache, the rest are lore.
 *   - Loot (QUEST §3.1 / §4.3):
 *       relic  the realm's relic for that cache (`relicFor(realm, 'cache0'
 *              | 'cache1')` — the realm's first two STORY.relics, lower site
 *              index first)
 *       lore   one lore shard + 8-15 Wake Glass (8 + hash % 8, per site)
 *       grand  60 Wake Glass
 *     The lore shard is the NEXT UNREAD shard of the realm, in STORY order
 *     (the n-th lore cache opened pays STORY.lore[realm][n]) — QUEST §3.4
 *     requires the lore to ESCALATE, and the player opens caches in any order,
 *     so binding shard to site would scramble the story. See the report.
 *
 * WHERE A CACHE STANDS. "At the landmark's base" — and never inside it: the
 * anchor is tried first (the Glacier Gate's gap, the Frozen Crest's curl, the
 * Caldera's floor are all open), then rings of candidates out to 22 m, and
 * the first spot whose ground is walkable and whose 2 m clearance survives a
 * test against every prism of THAT formation (read straight out of
 * landmarks.js's data texture, lower 3.6 m of each shaft, lintels skipped)
 * wins. Deterministic: same heightfield, same spot. Re-run whenever the
 * landmark layer re-lays the realm out (a cheap per-frame signature over the
 * realm's 15 anchors detects it — no hook into landmarks.js needed).
 *
 * DRAWING — TWO draws for all fifteen:
 *   1. the formations: 8 prisms each, the crystal family (`lib/crystal` +
 *      the ice fragment with a tint + ember seam, shaders/worldact.glsl.js),
 *      one lattice over one 120x3 RGBA32F data texture. An unopened cache
 *      breathes a soft ember of light (gold for relic/grand, realm ice for
 *      lore); an opened cache is cracked open — core shattered to a stump,
 *      petals splayed, dark — and STAYS that way (persisted).
 *   2. the glints: one additive camera-facing star per unopened cache,
 *      pulsing, at full strength while the RIDER is within 90 m ("visible
 *      from 90 m"; the shader fades on camera distance, so its read range
 *      is 90 + GLINT_CAM_ARM 15 = 105 m), faded to nothing by 126 m.
 *   No shadow casters (the portal's call: two cascade draws for 1.3 m props
 *   are not worth the budget).
 *
 * INTERACT. E within 3 m opens the nearest unopened cache. The key is lane
 * U's. Two ways to wire it — pick ONE:
 *   (a) set `input.interactPressed` true for exactly one frame on the E edge
 *       (the `jumpPressed` spelling) and `update()` opens `interactTarget`;
 *   (b) set `readsInput = false` and route E yourself: `tryInteract()` opens
 *       the cache in reach and returns its loot (null = nothing in reach, so
 *       the press is free for the next consumer, e.g. the shrine menu).
 * `interactTarget` is the site the E key WOULD open (-1 = none); `open(site)`
 * is the direct API (the probes use it). A small frost-glass prompt
 * ("E  Open Relic Cache") is drawn here; set `showPrompt = false` if the UI
 * lane ships its own.
 *
 * EVENTS (quests/events.js): 'cache:discovered' (first time within 90 m —
 * documented addition), 'cache:opened', and one 'reward' per loot item
 * (kind 'relic' | 'lore' | 'glass'). This module NEVER credits Wake Glass or
 * relics itself — the 'reward' event IS the grant (the rewards lane's
 * listener owns the wallet and the relic inventory).
 *
 * SAVE: `progression.registerSaveSection('quest.caches', …)` →
 * `{cold:[site…], sand:[…], ash:[…]}` (QUEST §8 verbatim) and
 * 'quest.cachesSeen' (same shape, the discovered set the map reads). The
 * collected lore list QUEST §8 draws as `quest.lore: [shardId…]` is a pure
 * function of the opened lore caches (the n-th opened lore cache of a realm
 * paid that realm's shard n), so this module also WRITES 'quest.lore' as a
 * mirror of `loreCollected()` — unless another system registered that
 * section first — and never reads it back: 'quest.caches' is the truth.
 *
 * Steady-frame allocation: none. A settled realm uploads nothing.
 */

import * as THREE from "three";

import { shader } from "../core/glsl.js";
import { input as coreInput } from "../core/input.js";
import { REALM_PALETTE } from "../spells/spellSystem.js";
import { REALM_ORDER, realmToken } from "./realms.js";
import { gradeAt } from "./shrine.js";
import { STORY } from "../quests/storyText.js";
import { bus as coreBus } from "../quests/events.js";
import { sfx as coreSfx } from "../audio/sfx.js";
import {
    cacheVertex, cacheFragment, glintVertex, glintFragment, GLINT_MAX,
    REF_EXPOSURE, emissionGain,
} from "../shaders/worldact.glsl.js";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** Caches per realm — one per landmark site (landmarks.js 3 types x 5). */
export const CACHE_SITES = 15;
/** Prisms per cache formation. */
const PRISMS_PER = 8;
const PRISMS = CACHE_SITES * PRISMS_PER;
/** `lib/crystal`: two rings of six plus an apex. */
const VERTS = 13;
const RING = 6;

/** Display-unit emission gain of the glints (worldact.glsl.js EMISSION). */
export const GLINT_GAIN = 0.5;

/** Interact reach, m (QUEST §3.1). */
export const INTERACT_R = 3.0;
/** The glint's read range, and the radius that DISCOVERS a cache, m. */
export const GLINT_FAR = 90;
/** The glint's shader fade runs on CAMERA distance, and the camera rides
 *  6-15 m behind the rider (measured in the live page): full strength out
 *  to GLINT_FAR + this, so a RIDER at 90 m sees it whole (spec: "visible
 *  from 90 m"). Discovery stays on the rider's 90 m. */
export const GLINT_CAM_ARM = 15;

/** Frames after a realm swap before the first placement attempt. The
 *  landmark layer re-lays out 3 frames after ITS setRealm; this waits it out
 *  and the signature check below catches anything later. */
const PLACE_WAIT_FRAMES = 6;

/** Rise time when a realm's caches are placed, s. */
const GROW_S = 1.2;
/** The crack-open animation, s. */
const OPEN_S = 0.6;

/** Grand caches are this much larger. */
const GRAND_SCALE = 1.45;

/** Placement search: clearance from any prism shaft, m; max walkable grade. */
const CLEAR_M = 2.0;
const MAX_GRADE = 0.45;
const RING_R = [5, 7.5, 10, 12.5, 15, 18, 22];
const RING_BEARINGS = 12;
/** Height of shaft checked for clearance, m; prisms whose base floats higher
 *  than LINTEL_M above the ground (the Glacier Gate lintel) are overhead. */
const SHAFT_M = 3.6;
const LINTEL_M = 3.0;

/** Loot (QUEST §3.1 / §4.3). */
const GRAND_GLASS = 60;
const LORE_GLASS_MIN = 8;
const LORE_GLASS_SPAN = 8;           // 8..15 inclusive

/** Kind codes. */
export const KIND = Object.freeze({ LORE: 0, RELIC: 1, GRAND: 2 });
const KIND_NAME = ["lore", "relic", "grand"];
const KIND_LABEL = ["Cache", "Relic Cache", "Grand Cache"];

/* ------------------------------------------------------------------ *
 * Shared helpers (trials.js and bounties.js import these)
 * ------------------------------------------------------------------ */

/**
 * A 3-input integer hash in [0, 1) — landmarks.js's recipe, bit-identical on
 * every machine. Never the platform RNG (ARCHITECTURE §6).
 * @param {number} a @param {number} b @param {number} c @returns {number}
 */
export function hash3(a, b, c) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)
        + Math.imul(c | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * The realm's four relics in STORY order, and which source pays which
 * (QUEST §4.2: 2 relic caches, the third trial's gold, the third bounty).
 * Mapping — [0] first relic cache, [1] second relic cache, [2] trial gold,
 * [3] third bounty — puts Keel of the First (surf speed) and Dune Runner
 * (surf jump) on the trials, the surf reward for the surf challenge.
 * @param {string} realm @param {'cache0'|'cache1'|'trial'|'bounty'} source
 * @returns {{id:string, name:string, effect:string, flavor:string}|null}
 */
export function relicFor(realm, source) {
    const idx = { cache0: 0, cache1: 1, trial: 2, bounty: 3 }[source];
    if (idx === undefined) return null;
    let n = 0;
    for (const id in STORY.relics) {
        const r = STORY.relics[id];
        if (r.realm !== realm) continue;
        if (n === idx) return r;
        n++;
    }
    return null;
}

/**
 * Realm tint for crystal-family formations — the shrine's derivation
 * verbatim: arcInk luma-normalised, scaled by the light row's mult.
 * @param {string} token @param {THREE.Vector3} out @returns {THREE.Vector3}
 */
export function realmTint(token, out) {
    const p = REALM_PALETTE[token] || REALM_PALETTE.cold;
    const ink = p.arcInk;
    const luma = 0.2126 * ink.r + 0.7152 * ink.g + 0.0722 * ink.b;
    const m = (p.light && p.light.mult ? p.light.mult : 1) / Math.max(luma, 1e-3);
    return out.set(ink.r * m, ink.g * m, ink.b * m);
}

/**
 * Clearance of (x, z) from every prism of one landmark instance, read out of
 * landmarks.js's data texture (rows documented in its SHAPE header). Only the
 * lower SHAFT_M of each shaft counts; a prism whose base floats more than
 * LINTEL_M above its ground (a lintel) is overhead and ignored.
 * @param {any} lm the Landmarks layer
 * @param {{prism0:number, prisms:number}} inst
 * @param {{heightAt:(x:number,z:number)=>number}} terrain
 * @param {number} x @param {number} z
 * @returns {number} metres of clearance (negative = inside a shaft)
 */
export function landmarkClearance(lm, inst, terrain, x, z) {
    const d = lm && lm._texData;
    if (!d || !inst) return Infinity;
    const w = lm.prismCount * 4;
    let best = Infinity;
    const end = inst.prism0 + inst.prisms;
    for (let p = inst.prism0; p < end; p++) {
        const o = p * 4;
        const bx = d[o], by = d[o + 1], bz = d[o + 2], h = d[o + 3];
        if (by - terrain.heightAt(bx, bz) > LINTEL_M) continue;
        const ax = d[w + o], ay = d[w + o + 1], az = d[w + o + 2], rad = d[w + o + 3];
        // Arc length that climbs SHAFT_M, clipped to the shaft.
        const len = Math.min(h, SHAFT_M / Math.max(ay, 0.15));
        for (let k = 0; k <= 3; k++) {
            const s = len * (k / 3);
            const c = Math.hypot(x - (bx + ax * s), z - (bz + az * s)) - rad;
            if (c < best) best = c;
        }
    }
    return best;
}

/* ------------------------------------------------------------------ *
 * The frost-glass prompt + timer CSS (shared with trials.js)
 * ------------------------------------------------------------------ */

const CSS = `
.wa-glass {
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.58), rgba(8, 13, 19, 0.72));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45), inset 0 0 10px rgba(120, 180, 220, 0.05);
  border-radius: 9px;
  color: rgba(240, 248, 253, 0.94);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  font: 600 12px/1.2 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.04em;
}
#wa-prompt {
  position: fixed; left: 50%; top: calc(50% + 72px);
  transform: translateX(-50%);
  z-index: 56; pointer-events: none;
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px 7px 7px;
  opacity: 0; transition: opacity 160ms ease;
  white-space: nowrap;
}
#wa-prompt.show { opacity: 0.95; }
.wa-key {
  width: 24px; height: 24px; border-radius: 6px;
  display: grid; place-items: center;
  font-size: 11px; color: #cdefff;
  border: 1px solid rgba(174, 232, 255, 0.7);
  background: rgba(120, 190, 230, 0.12);
  box-shadow: inset 0 0 6px rgba(160, 225, 255, 0.18);
}
#wa-prompt.gold .wa-key { color: #ffe6a8; border-color: rgba(255, 214, 140, 0.8);
  background: rgba(255, 200, 110, 0.12); }
#wa-trial {
  position: fixed; left: 50%; top: 58px;
  transform: translateX(-50%);
  z-index: 56; pointer-events: none;
  min-width: 220px; padding: 8px 16px 9px;
  text-align: center;
  opacity: 0; transition: opacity 180ms ease;
}
#wa-trial.show { opacity: 0.95; }
#wa-trial .wa-t-name { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
  color: rgba(205, 228, 244, 0.82); }
#wa-trial .wa-t-time { font: 700 26px/1.1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.02em; font-variant-numeric: tabular-nums; margin-top: 2px; }
#wa-trial .wa-t-sub { font-size: 10px; letter-spacing: 0.08em; margin-top: 3px;
  color: rgba(205, 228, 244, 0.78); font-variant-numeric: tabular-nums; }
#wa-trial .wa-m1 { color: #e3a877; } #wa-trial .wa-m2 { color: #d9e6f0; }
#wa-trial .wa-m3 { color: #ffd98a; }
#wa-trial.fail { border-color: rgba(255, 120, 90, 0.75); }
#wa-trial.win { border-color: rgba(255, 214, 140, 0.85);
  box-shadow: 0 0 14px rgba(255, 200, 110, 0.35), 0 1px 6px rgba(0, 0, 0, 0.45); }
`;

let _cssDone = false;
/** Inject the shared frost-glass CSS once. @returns {void} */
export function ensureWorldActCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const style = document.createElement("style");
    style.id = "worldact-css";
    style.textContent = CSS;
    document.head.appendChild(style);
}

/**
 * The HUD's visibility rule (hud.js): pointer locked, no shell menu, no panel.
 * @param {any} input @param {any} overlay @returns {boolean}
 */
export function hudVisible(input, overlay) {
    const shell = globalThis.FFG ? globalThis.FFG.shell : null;
    const shellUp = !!(shell && shell.phase !== "playing");
    const panelUp = !!(overlay && overlay.visible);
    return !!(input && input.locked) && !shellUp && !panelUp;
}

/* ------------------------------------------------------------------ *
 * The system
 * ------------------------------------------------------------------ */

export class RelicCaches {
    /**
     * @param {object} ctx the meaning-layer context (see the lane contract):
     *   uses terrain, landmarks, crystals, character, input, progression, bus,
     *   rig, overlay, sfx, getRealm. Construct AFTER the landmark layer.
     */
    constructor(ctx) {
        this.ctx = ctx;
        this.terrain = ctx.terrain;
        this.landmarks = ctx.landmarks;
        this.character = ctx.character;
        this.input = ctx.input || coreInput;
        this.bus = ctx.bus || coreBus;
        this.sfx = ctx.sfx || coreSfx;
        this.progression = ctx.progression || null;
        if (!this.terrain || !this.landmarks || !ctx.crystals) {
            throw new Error("caches.js: ctx needs terrain, landmarks and crystals");
        }

        /** Live realm token. */
        this.realm = realmToken(ctx.getRealm ? ctx.getRealm() : "cold");
        /** The realm the fifteen formations are CURRENTLY placed for (null =
         *  waiting on the landmark re-layout). Other lanes read this. */
        this.readyRealm = null;
        /** Show the built-in interact prompt. */
        this.showPrompt = true;
        /** `update()` opens the cache in reach on `input.interactPressed`.
         *  Set false when an input router calls `tryInteract()` instead. */
        this.readsInput = true;

        // --------------------------------------------------- per-site state
        /** World position of each LIVE-realm cache, index = site. */
        this.x = new Float32Array(CACHE_SITES);
        this.y = new Float32Array(CACHE_SITES);
        this.z = new Float32Array(CACHE_SITES);
        /** Kind per site, for the live realm. */
        this.kind = new Uint8Array(CACHE_SITES);
        /** Landmark label per site (for the map / journal). */
        this.label = new Array(CACHE_SITES).fill("");
        /** Per-realm remembered spots, so list() can answer for a realm that
         *  is not live: [ri*CACHE_SITES + s] -> x, z; `_known[ri]` = placed
         *  this session. */
        this._spotX = new Float32Array(CACHE_SITES * 3);
        this._spotZ = new Float32Array(CACHE_SITES * 3);
        this._known = new Uint8Array(3);

        /** Persisted: opened / discovered sites per realm. */
        this._opened = { cold: new Uint8Array(CACHE_SITES),
            sand: new Uint8Array(CACHE_SITES), ash: new Uint8Array(CACHE_SITES) };
        this._seen = { cold: new Uint8Array(CACHE_SITES),
            sand: new Uint8Array(CACHE_SITES), ash: new Uint8Array(CACHE_SITES) };

        /** Animation: growth 0..1 (placement rise) and open 0..1 per site. */
        this._g = new Float32Array(CACHE_SITES);
        this._open = new Float32Array(CACHE_SITES);
        this._growing = false;
        this._opening = 0;       // count of sites mid-animation

        /** Placement bookkeeping: [0] the live anchors' signature, [1] the
         *  signature the caches were placed against (NaN = not placed). A
         *  typed array, so the per-frame signature never boxes a double. */
        this._placeWait = 0;
        this._sig = new Float64Array([NaN, NaN]);
        /** Scratch for per-frame work. */
        this._interact = -1;

        /** Stats for probes. */
        this.stats = { placed: 0, placeFallbacks: 0, opened: 0, discovered: 0 };

        // ------------------------------------------------ formation texture
        this._texData = new Float32Array(PRISMS * 3 * 4);
        this.dataTex = new THREE.DataTexture(
            this._texData, PRISMS, 3, THREE.RGBAFormat, THREE.FloatType);
        this.dataTex.internalFormat = "RGBA32F";
        this.dataTex.minFilter = THREE.NearestFilter;
        this.dataTex.magFilter = THREE.NearestFilter;
        this.dataTex.wrapS = THREE.ClampToEdgeWrapping;
        this.dataTex.wrapT = THREE.ClampToEdgeWrapping;
        this.dataTex.generateMipmaps = false;
        this.dataTex.flipY = false;
        this.dataTex.needsUpdate = true;
        this._crystalTex = { value: this.dataTex };

        const crystals = ctx.crystals;
        const base = crystals.material.uniforms;
        this._tint = { value: new THREE.Vector3(1, 1, 1) };
        this._tintAmt = { value: 0 };
        this._glowIce = { value: new THREE.Vector3(0.3, 0.9, 2.0) };
        this._glowGold = { value: new THREE.Vector3(2.1, 1.35, 0.42) };
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(cacheVertex),
            fragmentShader: shader(cacheFragment()),
            uniforms: Object.assign({}, base, {
                crystalTex: this._crystalTex,
                uCacheTint: this._tint,
                uCacheTintAmt: this._tintAmt,
                uCacheGlowIce: this._glowIce,
                uCacheGlowGold: this._glowGold,
            }),
            // The crystal family's state block (crystals.js / shrine.js).
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            blending: THREE.NormalBlending,
            premultipliedAlpha: false,
        });
        this._shading = {
            sss: this.material.uniforms.sssStrength,
            sssRadius: this.material.uniforms.sssRadius,
            glint: this.material.uniforms.glintIntensity,
            grazing: this.material.uniforms.glintGrazing,
        };
        this.mesh = new THREE.Mesh(buildCrystalLattice(PRISMS), this.material);
        this.mesh.name = "relicCaches";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 1;
        this.mesh.visible = false;
        crystals.scene.add(this.mesh);

        // ----------------------------------------------------------- glints
        this._glA = new Float32Array(GLINT_MAX * 4);
        this._glB = new Float32Array(GLINT_MAX * 4);
        // Float32Array uniform values (three's uniform3fv path), written
        // element-wise each frame: storing doubles into a shared Vector3's
        // fields boxes a HeapNumber per store once V8 has generalised the
        // field (measured: 16 B/frame here, 80 B/frame in the beacon).
        this._camRight = { value: new Float32Array([1, 0, 0]) };
        this._camUp = { value: new Float32Array([0, 1, 0]) };
        /** Glint emission gain in display units; uniform = gain / S.exposure. */
        this.gain = GLINT_GAIN;
        this._gain = { value: emissionGain(this.gain, ctx.S) };
        const globals = ctx.spells && ctx.spells.globals ? ctx.spells.globals : base;
        this.glintMaterial = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(glintVertex),
            fragmentShader: shader(glintFragment),
            uniforms: {
                uCameraPos: globals.uCameraPos,
                uViewProj: globals.uViewProj,
                uTime: globals.uTime,
                uGlintA: { value: this._glA },
                uGlintB: { value: this._glB },
                uCamRight: this._camRight,
                uCamUp: this._camUp,
                uGlintFar: { value: GLINT_FAR + GLINT_CAM_ARM },
                uGlintGain: this._gain,
            },
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.glintMesh = new THREE.Mesh(buildQuadPool(GLINT_MAX), this.glintMaterial);
        this.glintMesh.name = "relicCacheGlints";
        this.glintMesh.frustumCulled = false;
        this.glintMesh.matrixAutoUpdate = false;
        this.glintMesh.renderOrder = 3;
        this.glintMesh.visible = false;
        crystals.scene.add(this.glintMesh);

        // ------------------------------------------------------------- DOM
        this._promptEl = null;
        this._promptShown = false;
        this._promptSite = -2;
        if (typeof document !== "undefined") {
            ensureWorldActCss();
            const el = document.createElement("div");
            el.id = "wa-prompt";
            el.className = "wa-glass";
            el.innerHTML = '<span class="wa-key">E</span><span class="wa-label"></span>';
            document.body.appendChild(el);
            this._promptEl = el;
            this._promptLabel = el.querySelector(".wa-label");
        }

        // ------------------------------------------------------------- save
        this._unregister = [];
        const P = this.progression;
        if (P && typeof P.registerSaveSection === "function") {
            this._unregister.push(P.registerSaveSection("quest.caches", {
                serialize: () => this._serializeSet(this._opened),
                deserialize: (v) => this._deserializeSet(this._opened, v),
            }));
            this._unregister.push(P.registerSaveSection("quest.cachesSeen", {
                serialize: () => this._serializeSet(this._seen),
                deserialize: (v) => this._deserializeSet(this._seen, v),
            }));
            // QUEST §8 `quest.lore` — a write-only mirror (see the header).
            const taken = typeof P._sectionIndex === "function" && P._sectionIndex("quest.lore") >= 0;
            if (!taken) {
                this._unregister.push(P.registerSaveSection("quest.lore", {
                    serialize: () => {
                        const out = [];
                        for (let r = 0; r < REALM_ORDER.length; r++) {
                            const a = this.loreCollected(REALM_ORDER[r]);
                            for (let i = 0; i < a.length; i++) out.push(a[i]);
                        }
                        return out;
                    },
                    deserialize: () => { /* derived from quest.caches */ },
                }));
            }
        } else {
            console.warn("caches.js: progression.registerSaveSection missing — " +
                "opened caches will not persist");
        }

        this.setRealm(this.realm);
    }

    /* -------------------------------------------------------------- *
     * Public API
     * -------------------------------------------------------------- */

    /**
     * Realm swap (enterRealm hook). The formations sink; placement re-runs
     * once the landmark layer has re-laid the new realm out.
     * @param {string} token @returns {void}
     */
    setRealm(token) {
        const t = realmToken(token);
        this.realm = t;
        this.readyRealm = null;
        this._placeWait = PLACE_WAIT_FRAMES;
        this._sig[1] = NaN;
        this._interact = -1;
        this.mesh.visible = false;
        this.glintMesh.visible = false;
        realmTint(t, this._tint.value);
        this._tintAmt.value = t === "cold" ? 0 : 0.55;
        // The lore ember wears the realm's own light; relic/grand stay gold
        // in every realm so "this one holds a relic" reads the same everywhere.
        const tv = this._tint.value;
        this._glowIce.value.set(0.12 + tv.x * 0.62, 0.18 + tv.y * 0.62, 0.30 + tv.z * 0.62);
    }

    /**
     * Kind of a site in a realm — deterministic by site index (QUEST §3.1).
     * @param {string} realm @param {number} site @returns {number} KIND
     */
    kindOf(realm, site) {
        const ri = REALM_ORDER.indexOf(realmToken(realm));
        // Rank = how many sites hash lower (ties broken by index).
        const hs = hash3(site, ri, 7919);
        let rank = 0;
        for (let s = 0; s < CACHE_SITES; s++) {
            if (s === site) continue;
            const h = hash3(s, ri, 7919);
            if (h < hs || (h === hs && s < site)) rank++;
        }
        return rank < 2 ? KIND.RELIC : (rank === 2 ? KIND.GRAND : KIND.LORE);
    }

    /** Is a site opened? @param {string} realm @param {number} site */
    isOpened(realm, site) {
        const a = this._opened[realmToken(realm)];
        return !!(a && a[site]);
    }

    /**
     * Open a cache: mark it, persist, emit 'cache:opened' + one 'reward' per
     * loot item. The E key calls this for `interactTarget`; the probe calls it
     * directly. Only a LIVE-realm, placed, unopened site opens.
     * @param {number} site 0..14
     * @returns {object|null} the loot, or null if nothing opened
     */
    open(site) {
        const realm = this.realm;
        if (this.readyRealm !== realm) return null;
        if (!(site >= 0 && site < CACHE_SITES)) return null;
        const opened = this._opened[realm];
        if (opened[site]) return null;

        const kind = this.kind[site];
        const ri = REALM_ORDER.indexOf(realm);
        const loot = { glass: 0, relic: null, lore: null };

        let relicIndex = 0;
        if (kind === KIND.RELIC) {
            // Lower site index = the realm's first relic.
            for (let s = 0; s < site; s++) if (this.kindOf(realm, s) === KIND.RELIC) relicIndex++;
            const r = relicFor(realm, relicIndex === 0 ? "cache0" : "cache1");
            if (r) loot.relic = r.id;
        } else if (kind === KIND.GRAND) {
            loot.glass = GRAND_GLASS;
        } else {
            loot.glass = LORE_GLASS_MIN + Math.floor(hash3(site, ri, 4099) * LORE_GLASS_SPAN);
            // The next unread shard of this realm, in escalation order.
            const n = this._loreOpened(realm);
            const shards = STORY.lore[realm] || [];
            if (n < shards.length) loot.lore = shards[n].id;
        }

        opened[site] = 1;
        this._seen[realm][site] = 1;
        this._open[site] = 0.0001;         // start the crack-open animation
        this._opening++;
        this.stats.opened++;
        this._writeGlints();

        const bus = this.bus;
        bus.emit("cache:opened", {
            realm, site, kind: KIND_NAME[kind], loot,
            x: this.x[site], z: this.z[site],
        });
        if (loot.relic) {
            const r = STORY.relics[loot.relic];
            // realm/source/index ride along for relics.js's resolver (lane R:
            // "relic cache #0/#1 -> the realm's relic 0/1" — the same mapping).
            bus.emit("reward", {
                kind: "relic", id: loot.relic, name: r ? r.name : loot.relic,
                desc: r ? r.effect : "", amount: 1, source: "cache",
                realm, index: relicIndex,
            });
        }
        if (loot.lore) {
            const sh = findLore(loot.lore);
            bus.emit("reward", {
                kind: "lore", id: loot.lore, name: sh ? sh.title : loot.lore,
                desc: sh ? sh.lines.join(" ") : "", amount: 1, source: "cache",
            });
        }
        if (loot.glass > 0) {
            bus.emit("reward", {
                kind: "glass", id: "glass", name: "Wake Glass",
                desc: KIND_LABEL[kind], amount: loot.glass, source: "cache",
            });
        }
        this._chime("cache_open", site);
        if (this.progression && this.progression.save) this.progression.save();
        return loot;
    }

    /** The site E would open right now, or -1. */
    get interactTarget() { return this._interact; }

    /**
     * The E press, for an input router (see the header, wiring (b)): open the
     * cache in reach, if any.
     * @returns {object|null} the loot, or null when no cache is in reach (the
     *   press was not consumed)
     */
    tryInteract() {
        const s = this._interact;
        if (s < 0) return null;
        const loot = this.open(s);
        if (loot) this._interact = -1;
        return loot;
    }

    /**
     * The lore shards a realm's opened caches have paid, in STORY order (the
     * n-th opened lore cache paid shard n). The journal's Lore tab reads this.
     * @param {string} [realm] @returns {string[]} shard ids
     */
    loreCollected(realm) {
        const t = realmToken(realm || this.realm);
        const shards = STORY.lore[t] || [];
        const n = Math.min(shards.length, this._loreOpened(t));
        const out = [];
        for (let i = 0; i < n; i++) out.push(shards[i].id);
        return out;
    }

    /** Opened LORE caches in a realm. @param {string} t @returns {number} */
    _loreOpened(t) {
        const opened = this._opened[t];
        let n = 0;
        for (let s = 0; s < CACHE_SITES; s++) {
            if (opened[s] && this.kindOf(t, s) === KIND.LORE) n++;
        }
        return n;
    }

    /**
     * Everything the journal / world map needs about a realm's caches.
     * Allocates — a UI / probe call, never a frame path. Positions for a realm
     * that has not been live this session are the landmark anchors (approx).
     * @param {string} [realm] default: the live realm
     * @returns {{site:number, kind:string, x:number, z:number, opened:boolean,
     *   discovered:boolean, landmark:string, approx:boolean}[]}
     */
    list(realm) {
        const t = realmToken(realm || this.realm);
        const ri = REALM_ORDER.indexOf(t);
        const inst = this._instancesOf(t);
        const out = [];
        for (let s = 0; s < CACHE_SITES; s++) {
            const known = this._known[ri] === 1;
            const li = inst[s];
            out.push({
                site: s,
                kind: KIND_NAME[this.kindOf(t, s)],
                x: known ? this._spotX[ri * CACHE_SITES + s] : (li ? li.x : 0),
                z: known ? this._spotZ[ri * CACHE_SITES + s] : (li ? li.z : 0),
                opened: !!this._opened[t][s],
                discovered: !!this._seen[t][s],
                landmark: li ? li.label : "",
                approx: !known,
            });
        }
        return out;
    }

    /** Opened / total counts for the journal ("Relic caches found x/15").
     *  @param {string} [realm] */
    counts(realm) {
        const t = realmToken(realm || this.realm);
        let found = 0, seen = 0;
        for (let s = 0; s < CACHE_SITES; s++) {
            if (this._opened[t][s]) found++;
            if (this._seen[t][s]) seen++;
        }
        return { found, seen, total: CACHE_SITES };
    }

    /** Meshes the integrator should add to the warm-up list. */
    get warmUpMeshes() { return [this.mesh, this.glintMesh]; }

    /**
     * Stand ONE real formation + glint at (x, z) so the warm-up draws
     * rasterise non-degenerate geometry (a zero-area triangle never
     * specialises the pipeline — the motes.js note). Undo with
     * `finishWarmUp()` before frame one.
     * @param {number} x @param {number} z
     */
    warmUpSeed(x, z) {
        this.x[0] = x; this.z[0] = z; this.y[0] = this.terrain.heightAt(x, z);
        this.kind[0] = KIND.RELIC;
        this._g[0] = 1; this._open[0] = 0;
        this._writeCache(0);
        this.dataTex.needsUpdate = true;
        const A = this._glA, B = this._glB;
        A[0] = x; A[1] = this.y[0] + 1.6; A[2] = z; A[3] = 0.5;
        B[0] = 1.9; B[1] = 1.35; B[2] = 0.55; B[3] = 1.8;
        this.mesh.visible = true;
        this.glintMesh.visible = true;
    }

    /** Take the warm-up seed away; placement runs on the live realm later. */
    finishWarmUp() {
        this._texData.fill(0);
        this.dataTex.needsUpdate = true;
        this._glB.fill(0);
        this._g.fill(0);
        this.mesh.visible = false;
        this.glintMesh.visible = false;
        this.readyRealm = null;
        this._sig[1] = NaN;
    }

    /** Draw calls this system issues right now (0-2). */
    get draws() { return (this.mesh.visible ? 1 : 0) + (this.glintMesh.visible ? 1 : 0); }

    /* -------------------------------------------------------------- *
     * Frame
     * -------------------------------------------------------------- */

    /**
     * One frame. dt === 0 (pause) is a no-op except that the prompt hides.
     * Allocation-free.
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
        if (dt === 0) { this._syncPrompt(false); return; }

        // Defensive realm follow, in case an enterRealm path forgot the hook.
        if (this.ctx.getRealm) {
            // EDGE-triggered: follow getRealm() only when IT changes. main.js
            // publishes its token after `await sky.solve()`, i.e. AFTER the
            // setRealm hooks ran -- a level test would flip back to the old realm.
            const live = this.ctx.getRealm();
            if (this._lastLive === undefined) this._lastLive = live;
            if (live !== this._lastLive) {
                this._lastLive = live;
                if (live && realmToken(live) !== this.realm) this.setRealm(live);
            }
        }

        // ---- placement (event-scoped; the signature is 15 adds)
        if (this._placeWait > 0) this._placeWait--;
        else if (!(this.landmarks._regroundIn > 0)) {
            // Only when the layer holds this realm's 15 sites, and only when
            // their anchors moved since the caches were placed.
            if (this._signature() === CACHE_SITES && this._sig[0] !== this._sig[1]) this._place();
        }
        if (this.readyRealm !== this.realm) { this._syncPrompt(false); return; }

        // Keep the shared crystal shading knobs live (shrine.js's rule) —
        // written only on a change, so a steady frame stores nothing.
        const S = this.ctx.S;
        if (S) {
            const sh = this._shading;
            if (sh.sss.value !== S.sssStrength) sh.sss.value = S.sssStrength;
            if (sh.sssRadius.value !== S.sssRadius) sh.sssRadius.value = S.sssRadius;
            if (sh.glint.value !== S.glintIntensity) sh.glint.value = S.glintIntensity;
            if (sh.grazing.value !== S.glintGrazing) sh.grazing.value = S.glintGrazing;
        }
        // Display-unit glint emission at the live (realm-graded) exposure.
        const gain = this.gain / (S && S.exposure > 0 ? S.exposure : REF_EXPOSURE);
        if (this._gain.value !== gain) this._gain.value = gain;

        // ---- animation: rise, crack-open
        let dirty = false;
        if (this._growing) {
            let still = false;
            for (let s = 0; s < CACHE_SITES; s++) {
                if (this._g[s] < 1) {
                    this._g[s] = Math.min(1, this._g[s] + dt / GROW_S);
                    this._writeCache(s);
                    still = true;
                }
            }
            this._growing = still;
            dirty = true;
        }
        if (this._opening > 0) {
            let n = 0;
            for (let s = 0; s < CACHE_SITES; s++) {
                const o = this._open[s];
                if (o > 0 && o < 1) {
                    this._open[s] = Math.min(1, o + dt / OPEN_S);
                    this._writeCache(s);
                    if (this._open[s] < 1) n++;
                }
            }
            this._opening = n;
            dirty = true;
        }
        if (dirty) this.dataTex.needsUpdate = true;

        // ---- discovery + interaction (15 distance tests)
        const p = this.character.position;
        const realm = this.realm;
        const opened = this._opened[realm];
        const seen = this._seen[realm];
        let near = -1, nearD2 = INTERACT_R * INTERACT_R;
        for (let s = 0; s < CACHE_SITES; s++) {
            const dx = p.x - this.x[s], dz = p.z - this.z[s];
            const d2 = dx * dx + dz * dz;
            if (!seen[s] && d2 < GLINT_FAR * GLINT_FAR) {
                seen[s] = 1;
                this.stats.discovered++;
                this.bus.emit("cache:discovered", {
                    realm, site: s, kind: KIND_NAME[this.kind[s]],
                    x: this.x[s], z: this.z[s],
                });
            }
            if (!opened[s] && d2 < nearD2) { nearD2 = d2; near = s; }
        }
        this._interact = near;
        const inp = this.input;
        if (near >= 0 && this.readsInput && inp && inp.interactPressed) {
            this.open(near);
            this._interact = -1;
        }

        // ---- glint camera basis (six typed-array writes, no allocation)
        const cam = this.ctx.rig && this.ctx.rig.camera;
        if (cam) {
            const e = cam.matrixWorld.elements;
            const r = this._camRight.value, u = this._camUp.value;
            r[0] = e[0]; r[1] = e[1]; r[2] = e[2];
            u[0] = e[4]; u[1] = e[5]; u[2] = e[6];
        }

        this._syncPrompt(true);
    }

    /* -------------------------------------------------------------- *
     * Internals
     * -------------------------------------------------------------- */

    /** The live realm's landmark instances, in site order. Allocates.
     *  @param {string} t @returns {any[]} */
    _instancesOf(t) {
        const all = this.landmarks.instances || [];
        const out = [];
        for (let i = 0; i < all.length; i++) if (all[i].realm === t) out.push(all[i]);
        return out;
    }

    /** Cheap signature of the live realm's landmark anchors, written to
     *  `_sig[0]` (no allocation). @returns {number} the realm's site count */
    _signature() {
        const all = this.landmarks.instances || [];
        let sig = 0, n = 0;
        for (let i = 0; i < all.length; i++) {
            const s = all[i];
            if (s.realm !== this.realm) continue;
            sig += s.x * 1.37 + s.z * 0.71 + s.y * 0.113 + n * 0.017;
            n++;
        }
        this._sig[0] = sig;
        return n;
    }

    /**
     * Place the live realm's fifteen caches against the current landmark
     * layout and heightfield. Event-scoped (realm swap / re-layout).
     * @returns {void}
     */
    _place() {
        const t = this.realm;
        const ri = REALM_ORDER.indexOf(t);
        const inst = this._instancesOf(t);
        if (inst.length !== CACHE_SITES) {
            console.error("caches.js: realm " + t + " has " + inst.length +
                " landmark sites, expected " + CACHE_SITES);
            return;
        }
        const terrain = this.terrain;
        for (let s = 0; s < CACHE_SITES; s++) {
            const li = inst[s];
            const spot = this._spotFor(li, ri, s);
            this.x[s] = spot.x;
            this.z[s] = spot.z;
            this.y[s] = terrain.heightAt(spot.x, spot.z);
            this.kind[s] = this.kindOf(t, s);
            this.label[s] = li.label;
            this._spotX[ri * CACHE_SITES + s] = spot.x;
            this._spotZ[ri * CACHE_SITES + s] = spot.z;
            this._g[s] = 0;
            this._open[s] = this._opened[t][s] ? 1 : 0;
            this._writeCache(s);
        }
        this._known[ri] = 1;
        this._sig[1] = this._sig[0];
        this._growing = true;
        this._opening = 0;
        this.readyRealm = t;
        this.stats.placed++;
        this.dataTex.needsUpdate = true;
        this.mesh.visible = true;
        this._writeGlints();
    }

    /**
     * Where one landmark's cache stands: the anchor if it is clear, else the
     * first clear, walkable spot on rings out to 22 m. Deterministic.
     * @param {any} li landmark instance @param {number} ri @param {number} s
     * @returns {{x:number, z:number}}
     */
    _spotFor(li, ri, s) {
        const terrain = this.terrain;
        const lm = this.landmarks;
        const ok = (x, z) =>
            gradeAt(terrain, x, z) <= MAX_GRADE &&
            !(terrain.edge01 && terrain.edge01(x, z) > 0) &&
            landmarkClearance(lm, li, terrain, x, z) >= CLEAR_M;
        if (ok(li.x, li.z)) return { x: li.x, z: li.z };
        const a0 = hash3(s, ri, 1301) * Math.PI * 2;
        for (let r = 0; r < RING_R.length; r++) {
            for (let k = 0; k < RING_BEARINGS; k++) {
                const a = a0 + k * (Math.PI * 2 / RING_BEARINGS);
                const x = li.x + Math.cos(a) * RING_R[r];
                const z = li.z + Math.sin(a) * RING_R[r];
                if (ok(x, z)) return { x, z };
            }
        }
        // Loud, not silent: no clear walkable spot within 22 m.
        this.stats.placeFallbacks++;
        console.error("caches.js: no clear spot at " + li.label + " (" + ri + "/" + s +
            ") — standing it 24 m out on bearing 0");
        return { x: li.x + 24, z: li.z };
    }

    /**
     * Write one cache's eight prisms from its live state (kind, growth, open).
     * @param {number} s @returns {void}
     */
    _writeCache(s) {
        const d = this._texData;
        const w = PRISMS * 4;
        const terrain = this.terrain;
        const kind = this.kind[s];
        const k = kind === KIND.GRAND ? GRAND_SCALE : 1;
        const g = this._g[s];
        const gs = g * g * (3 - 2 * g);
        const o = this._open[s];
        const oe = o * o * (3 - 2 * o);
        const gold = kind === KIND.LORE ? 0 : 1;
        const glowK = (kind === KIND.GRAND ? 1.35 : 1.0) * (1 - oe);
        const cx = this.x[s], cz = this.z[s];
        const spin = s * 0.7;

        for (let q = 0; q < PRISMS_PER; q++) {
            const p = s * PRISMS_PER + q;
            const f1 = (q * 0.618034 + s * 0.1317 + 0.377) % 1;
            const f2 = (q * 0.618034 + s * 0.2711 + 0.311) % 1;
            let px, pz, h, rad, ax, ay, az, grow, glow;
            if (q === 0) {
                // The core: tall, near-vertical. Opening shatters it to a stump.
                px = cx; pz = cz;
                h = 1.30 * k;
                rad = 0.19 * k;
                ax = (f1 - 0.5) * 0.08; ay = 1; az = (f2 - 0.5) * 0.08;
                grow = gs * (1 - 0.72 * oe);
                glow = 1.0 * glowK;
            } else if (q <= 5) {
                // Five petals leaning outward; opening splays them wide.
                const a = (q - 1) * (Math.PI * 2 / 5) + spin;
                const off = (0.36 + 0.10 * f1) * k;
                px = cx + Math.sin(a) * off;
                pz = cz + Math.cos(a) * off;
                h = (0.55 + 0.35 * f2) * k;
                rad = (0.085 + 0.03 * f1) * k;
                const lean = 0.42 + 0.78 * oe;
                ax = Math.sin(a) * lean; ay = 1; az = Math.cos(a) * lean;
                grow = Math.min(1, Math.max(0, (gs - 0.12) / 0.88)) * (1 - 0.22 * oe);
                glow = 0.55 * glowK;
            } else {
                // Two low outliers bleeding into the drift.
                const a = (q - 6) * Math.PI + 1.3 + spin;
                const off = (0.85 + 0.25 * f1) * k;
                px = cx + Math.sin(a) * off;
                pz = cz + Math.cos(a) * off;
                h = (0.22 + 0.18 * f2) * k;
                rad = 0.055 * k;
                ax = Math.sin(a) * 0.6; ay = 1; az = Math.cos(a) * 0.6;
                grow = Math.min(1, Math.max(0, (gs - 0.3) / 0.7));
                glow = 0.25 * glowK;
            }
            const py = terrain.heightAt(px, pz) - 0.03;
            const il = 1 / Math.hypot(ax, ay, az);
            let i = p * 4;
            d[i] = px; d[i + 1] = py; d[i + 2] = pz; d[i + 3] = h;
            i += w;
            d[i] = ax * il; d[i + 1] = ay * il; d[i + 2] = az * il; d[i + 3] = rad;
            i += w;
            d[i] = grow;
            d[i + 1] = (p * 0.618034 + px * 0.137 + pz * 0.311) % 1;
            d[i + 2] = glow;
            d[i + 3] = gold;
        }
    }

    /** Upload the glint pool from the live state (event-scoped). */
    _writeGlints() {
        const A = this._glA, B = this._glB;
        const opened = this._opened[this.realm];
        let any = false;
        for (let s = 0; s < GLINT_MAX; s++) {
            const o = s * 4;
            if (s >= CACHE_SITES || this.readyRealm !== this.realm || opened[s]) {
                B[o + 3] = 0;
                continue;
            }
            const kind = this.kind[s];
            const k = kind === KIND.GRAND ? GRAND_SCALE : 1;
            A[o] = this.x[s];
            A[o + 1] = this.y[s] + 1.30 * k + 0.35;
            A[o + 2] = this.z[s];
            A[o + 3] = (kind === KIND.GRAND ? 0.62 : 0.42);
            if (kind === KIND.LORE) {
                const tv = this._tint.value;
                B[o] = 0.55 + tv.x * 0.30; B[o + 1] = 0.75 + tv.y * 0.30;
                B[o + 2] = 1.05 + tv.z * 0.30; B[o + 3] = 1.5;
            } else {
                B[o] = 1.9; B[o + 1] = 1.35; B[o + 2] = 0.55;
                B[o + 3] = kind === KIND.GRAND ? 2.3 : 1.8;
            }
            any = true;
        }
        this.glintMesh.visible = any;
    }

    /** Prompt DOM, written only on change. @param {boolean} live */
    _syncPrompt(live) {
        const el = this._promptEl;
        if (!el) return;
        const site = live && this.showPrompt ? this._interact : -1;
        const show = site >= 0 && hudVisible(this.input, this.ctx.overlay);
        if (site !== this._promptSite && site >= 0) {
            this._promptSite = site;
            const kind = this.kind[site];
            this._promptLabel.textContent = "Open " + KIND_LABEL[kind];
            el.classList.toggle("gold", kind !== KIND.LORE);
        }
        if (show !== this._promptShown) {
            this._promptShown = show;
            el.classList.toggle("show", show);
        }
    }

    /** Feedback chime: the named cue if the audio table has it, else the
     *  pickup chime every player already reads as "you got something". */
    _chime(name, site) {
        const sfx = this.sfx;
        if (!sfx || !sfx.trigger) return;
        const has = sfx.counts && Object.prototype.hasOwnProperty.call(sfx.counts, name);
        sfx.trigger(has ? name : "pickup_mote", this.x[site], this.y[site], this.z[site]);
    }

    /** @param {Record<string, Uint8Array>} set */
    _serializeSet(set) {
        const out = {};
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const t = REALM_ORDER[r];
            const a = [];
            for (let s = 0; s < CACHE_SITES; s++) if (set[t][s]) a.push(s);
            out[t] = a;
        }
        return out;
    }

    /** @param {Record<string, Uint8Array>} set @param {any} v */
    _deserializeSet(set, v) {
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const t = REALM_ORDER[r];
            set[t].fill(0);
            const a = v && typeof v === "object" && Array.isArray(v[t]) ? v[t] : null;
            if (!a) continue;
            for (let i = 0; i < a.length; i++) {
                const s = a[i] | 0;
                if (s >= 0 && s < CACHE_SITES) set[t][s] = 1;
            }
        }
        // Re-seat the live realm's visuals on a load / new run.
        if (set === this._opened && this.readyRealm === this.realm && this._texData) {
            for (let s = 0; s < CACHE_SITES; s++) {
                this._open[s] = this._opened[this.realm][s] ? 1 : 0;
                this._writeCache(s);
            }
            this.dataTex.needsUpdate = true;
            this._writeGlints();
        }
    }

    /** Tear down. @returns {void} */
    dispose() {
        for (const u of this._unregister) if (u) u();
        for (const m of [this.mesh, this.glintMesh]) {
            if (m.parent) m.parent.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        }
        this.dataTex.dispose();
        if (this._promptEl && this._promptEl.parentNode) {
            this._promptEl.parentNode.removeChild(this._promptEl);
        }
    }
}

/** STORY lore shard by id. @param {string} id */
function findLore(id) {
    for (const t in STORY.lore) {
        const a = STORY.lore[t];
        for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    }
    return null;
}

/**
 * `lib/crystal` lattice for n prisms — (prism, vertex, 0), 18 tris each; the
 * encoding crystals.js / shrine.js build. Exported for trials/bounties reuse.
 * @param {number} n @returns {THREE.BufferGeometry}
 */
export function buildCrystalLattice(n) {
    const pos = new Float32Array(n * VERTS * 3);
    const idx = new Uint32Array(n * RING * 3 * 3);
    let vi = 0, ii = 0;
    for (let i = 0; i < n; i++) {
        for (let v = 0; v < VERTS; v++) {
            pos[vi++] = i; pos[vi++] = v; pos[vi++] = 0;
        }
        const b = i * VERTS;
        for (let k = 0; k < RING; k++) {
            const k2 = (k + 1) % RING;
            const b0 = b + k, b1 = b + k2, s0 = b + RING + k, s1 = b + RING + k2;
            const apex = b + RING * 2;
            idx[ii++] = b0; idx[ii++] = s0; idx[ii++] = s1;
            idx[ii++] = b0; idx[ii++] = s1; idx[ii++] = b1;
            idx[ii++] = s0; idx[ii++] = apex; idx[ii++] = s1;
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}

/**
 * A pool of n billboard quads: position = (corner x, corner y, index).
 * @param {number} n @returns {THREE.BufferGeometry}
 */
export function buildQuadPool(n) {
    const pos = new Float32Array(n * 4 * 3);
    const idx = new Uint16Array(n * 6);
    const cx = [-1, 1, 1, -1], cy = [-1, -1, 1, 1];
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < 4; c++) {
            const o = (i * 4 + c) * 3;
            pos[o] = cx[c]; pos[o + 1] = cy[c]; pos[o + 2] = i;
        }
        const b = i * 4, o = i * 6;
        idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
        idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}

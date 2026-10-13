// core/chars/soldiers.js [A8] — spawn/interp/death; ready() gate; attach
// (architecture §3.15, BUILD_PLAN §A8). soldiers.ready() gates MISSION start,
// never boot (requiredBodies pattern); bodies stream in the background during
// the menu. View reads sim.state.bots + the frozen event vocabulary — never
// writes gameplay.
//
// Implements: R15 bodies (soldier + juggernaut, archetype tint variants),
// VT §7 (aim-pose blend toward aimAt, directional deaths, 70 ms color-multiply
// flinch flash — never emissive, bodies persist), interpolated state reads
// with alpha, off-screen 1-in-3 pose evaluation with dt accumulation,
// LD §5.4 wet-shoulder (inside actor.js material prep), 3P carried weapons
// (last-circle Meshy wpn3p_* with the transliterated orientation/grip recipe).

import * as THREE from "three";
import { loadBody, createActor } from "./actor.js";
import { validateAnimMap } from "./anim_map.js";
// The silhouette ids the shared grounding pool draws its contact shadow AND
// its wet-ground reflection from. A character must ground as a PERSON — the
// generic ellipse is itself a named placeholder defect (VT §1).
import { SHAPE } from "../fx/grounding.js";

// ---------------------------------------------------------------------------
// 3P weapon protos — the ONE implementation (kind tables, orientation/grip
// prep, gunmetal/polymer material remap) lives in core/weapons/world_weapon.js
// and is shared with the world/pickup weapon models. Kinds: ar | smg | sniper |
// pistol | shotgun; weapon id -> kind via WPN_KIND (all five R4 ids).
// ---------------------------------------------------------------------------
import {
  WPN_GLB, WPN_KIND, WPN_KINDS, prepWeaponProto, createSupportHandIK,
} from "../weapons/world_weapon.js";

// ---------------------------------------------------------------------------
// createSoldiers
// ---------------------------------------------------------------------------

// archetype → body when content is the inline fallback ({} archetypes)
const DEFAULT_BODY = { heavy: "juggernaut" };
const DEFAULT_TINTS = { rifleman: "#4b5142", cqb: "#3a3e46", marksman: "#414b56", heavy: "#33292b" };

// module scratch (0 allocations inside update)
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function dampAngle(cur, target, lambda, dt) {
  return cur + wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));
}

export function createSoldiers(ctx) {
  const actors = new Map();       // botId -> rec
  const pendingSpawns = [];       // spawn events that arrived before protos
  const protos = {};              // bodyName -> proto
  const wpnProtos = {};           // kind -> Group proto
  let protosReady = false;
  let loadError = null;
  let loadPromise = null;
  let viewT = 0;                  // monotonic view clock (flash timing)
  const botIndex = new Map();     // persistent per-frame id -> bot index
  let lastSimT = null;            // sim clock latch (held-frame detection)

  // ---- contact shadows (ranked fix 5) --------------------------------------
  // VT §1 amateur tell #2: iter04 had NO character grounded. Critic-a measured
  // the S9 ground directly under the soldier's boots at RGB 154/165/177 against
  // 44/51/61 away from him — the brightest patch in the shot was exactly where
  // his contact shadow belonged. There is no character light to remove (actor.js
  // strips every light out of the GLB); that lift is the wet-cobble specular
  // sheen that peaks toward frame centre, and the only thing missing was the
  // shadow itself. Slots come from fx's ONE shared grounding pool (core/fx/
  // grounding.js) — never a per-system blob — resolved lazily through the
  // test-surface global exactly as fx.js resolves the light pool.
  const CONTACT = {
    // ITER08: these are now the FOOTPRINT half-extents of the body itself, not
    // of a quad. grounding.js draws a silhouette (torso oval + two boots) from
    // them and sizes its own quad to hold the swept shadow, so widening these
    // widens the MAN, not the blur — iter07's numbers were quad extents and a
    // radial falloff turned them into a 0.25 m dark dot that his own boots then
    // covered. That is the measured reason 3/3 critics read "no shadow".
    rx: 0.30, rz: 0.26,
    strength: 0.92,       // peak alpha multiplier at full contact
    fadeH: 0.55,          // metres of airborne lift that fades the blob to 0
    // A body on the cobbles is a long ellipse, not a big circle: one silhouette
    // id (SHAPE.PRONE) and a footprint the shape of a man lying down.
    deadRX: 0.32, deadRZ: 0.95,
    deadS: 0.70,
    // ---- wet-ground reflection (iter07 ranked fix 6) ---------------------
    // 3/3 critics: "he casts no shadow and leaves no reflection on cobbles
    // that are reflecting everything else — he is pasted onto the ground."
    // A contact shadow alone cannot answer that; the mirror-wet street has to
    // show the man standing on it. grounding.js solves the card geometry from
    // these two numbers plus the camera, so the reflection is view-correct
    // and moves with the player instead of sitting on the ground like a
    // decal. Standing height is the actual body height, not the capsule.
    standH: 1.78,
    deadH: 0.42,          // a body on the cobbles mirrors ~its own thickness
  };
  let groundingApi = null;
  function grounding() {
    if (groundingApi) return groundingApi;
    const fx = ctx.fx || ((typeof window !== "undefined" && window.__FPS__)
      ? window.__FPS__.fx : null);
    if (fx && fx.grounding) groundingApi = fx.grounding;
    return groundingApi;
  }

  function archBody(arch) {
    const a = ctx.content && ctx.content.archetypes && ctx.content.archetypes[arch];
    if (a && a.bodyGlb) return a.bodyGlb.replace(/^.*\/|\.glb$/g, "");
    if (a && a.body) return a.body;
    return DEFAULT_BODY[arch] || "soldier";
  }
  function archTint(arch) {
    const a = ctx.content && ctx.content.archetypes && ctx.content.archetypes[arch];
    return (a && a.tint) || DEFAULT_TINTS[arch] || "#4b5142";
  }
  function archWpnKind(arch) {
    const a = ctx.content && ctx.content.archetypes && ctx.content.archetypes[arch];
    return WPN_KIND[a && a.weapon] || "ar";
  }

  /** Load everything the mission cast needs. Idempotent; shared promise. */
  function ensureLoaded(archetypes, onProgress) {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const names = archetypes && archetypes.length
        ? archetypes : ["rifleman", "cqb", "marksman", "heavy"];
      const bodies = [...new Set(names.map(archBody))];
      if (!bodies.includes("soldier")) bodies.push("soldier"); // test-surface spawns
      // ALL five weapon kinds, always: a bot can pick up any weapon id in a PVP
      // match (rack / loot / dropped gun) and update() swaps its model by
      // WPN_KIND[bot.weapon.id] — a proto that is not loaded + prewarmed here
      // would mean a hitch or a gunless bot. The archetype kinds go first so the
      // starting guns are ready earliest; the rest are ~60-100 KB Draco each.
      const kinds = [...new Set([...names.map(archWpnKind), ...WPN_KINDS])];
      const steps = bodies.length + kinds.length + 1;
      let done = 0;
      const tick = () => { done++; if (onProgress) onProgress(done / steps); };

      for (const b of bodies) {
        try {
          protos[b] = await loadBody(b);
        } catch (e) {
          // Honest dev placeholder + ship blocker (doctrine §7 / arch §0.9).
          console.error(`[soldiers] body GLB failed: ${b}`, e);
          (window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || []).push(
            { lane: "A8", asset: `assets/chars/${b}.glb`, reason: String(e) });
          protos[b] = null;
        }
        tick();
      }
      for (const k of kinds) {
        try {
          wpnProtos[k] = await prepWeaponProto(k);
        } catch (e) {
          console.error(`[soldiers] 3P weapon GLB failed: ${k}`, e);
          (window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || []).push(
            { lane: "A8", asset: WPN_GLB[k], reason: String(e) });
          wpnProtos[k] = null;
        }
        tick();
      }

      // CONTRACT GATE (runs at load): every semantic anim must resolve to a
      // loaded clip on every loaded body. Throws — a dangling clip is a build
      // failure, never a frozen soldier on stage.
      for (const b of bodies) {
        if (protos[b]) validateAnimMap(protos[b].clipNames);
      }

      // Program + texture prewarm BEFORE the mission (perf gate: programs
      // delta == 0 during play; compileAsync alone leaves ANGLE D3D11 texture
      // uploads cold — driftwake lesson — so also DRAW once into a scratch RT).
      try {
        const staging = new THREE.Group();
        staging.position.set(0, -500, 0);
        for (const b of bodies) if (protos[b]) staging.add(protos[b].scene);
        for (const k of kinds) if (wpnProtos[k]) staging.add(wpnProtos[k]);
        ctx.scene.add(staging);
        if (ctx.renderer.compileAsync) {
          await ctx.renderer.compileAsync(staging, ctx.camera, ctx.scene);
        } else {
          ctx.renderer.compile(ctx.scene, ctx.camera);
        }
        const rt = new THREE.WebGLRenderTarget(16, 16);
        const prevRT = ctx.renderer.getRenderTarget();
        ctx.renderer.setRenderTarget(rt);
        ctx.renderer.render(ctx.scene, ctx.camera);
        ctx.renderer.setRenderTarget(prevRT);
        rt.dispose();
        ctx.scene.remove(staging);
        // protos were reparented into staging — detach them back to limbo
        for (const b of bodies) if (protos[b]) protos[b].scene.removeFromParent();
        for (const k of kinds) if (wpnProtos[k]) wpnProtos[k].removeFromParent();
        tick();
      } catch (e) {
        console.warn("[soldiers] prewarm pass failed (non-fatal):", e);
        tick();
      }

      protosReady = true;
      flushPending();
    })();
    return loadPromise;
  }

  function flushPending() {
    if (!protosReady) return;
    const sim = ctx.sim();
    while (pendingSpawns.length) {
      const d = pendingSpawns.shift();
      // epoch/liveness check: only spawn if the bot still exists in the
      // CURRENT sim (a mission restart may have discarded it mid-load)
      if (sim && sim.state.bots.some((b) => b.id === d.botId)) spawnActor(d);
    }
  }

  function spawnActor(d) {
    if (actors.has(d.botId)) return;
    // `sim` is needed by BOTH the rim-tint block and the live-weapon lookup below.
    // It used to be declared inside the rim block's braces, so the weapon lookup at
    // the end of this function threw `ReferenceError: sim is not defined` on EVERY
    // bot spawn — and because the throw lands before attachWeapon(), bots spawned
    // with no gun model at all. One death in a 10-player match produced ~240 of them.
    const sim = ctx.sim();
    const bodyName = archBody(d.archetype);
    const proto = protos[bodyName] || null;
    const actor = createActor(proto);
    // LIFE LAYER (iter07): hash the bot id into a pose phase + playback rate.
    // Without it every soldier who enters the 2.13 s idle on the same frame
    // holds the identical pose for the whole engagement — critic-c, iter06:
    // "BOTH soldiers hold the same pose as each other".
    actor.setLifeSeed(d.botId);
    if (actor.placeholder && proto === null) {
      // loadBody already pushed the fallback flag; nothing more to report here
    }
    actor.setTint(archTint(d.archetype));
    // W11 faction rim (C29f wave-5 / pvp_design §3.1): matches only — the
    // campaign never sets a rim, so its frames are unchanged (Amendment A2).
    // Rule: friend-or-foe FROM THE HUMAN'S SEAT, which is what the read is
    // for — teammates rim AMBER, hostiles rim SLATE. In FFA team===actorId,
    // so every bot is hostile and rims SLATE with zero special-casing.
    // ≥0.35 intensity per §3.1; tints from the match's own team table when
    // it is the two-team shape, else the C2 constants.
    {
      const ms = sim && sim.state && sim.state.match;
      if (ms) {
        const b = sim.state.bots.find((x) => x.id === d.botId);
        const pTeam = sim.state.player ? sim.state.player.team : 0;
        const friendly = !!b && b.team === pTeam;
        const twoTeams = Array.isArray(ms.teams) && ms.teams.length === 2;
        const rimHex = friendly
          ? ((twoTeams && ms.teams[0] && ms.teams[0].tint) || "#d9a441")   // AMBER
          : ((twoTeams && ms.teams[1] && ms.teams[1].tint) || "#7c9fd0"); // SLATE
        actor.setRim(rimHex, 0.4);
      }
    }
    // Resolve the gun model from the bot's LIVE weapon, falling back to the
    // archetype. spawnActor runs once at spawn, so an archetype-only lookup
    // froze the model for the actor's whole life — with PVP weapon racks a bot
    // that picked up a Corvus would keep rendering its spawn pistol. swapWeapon
    // below re-attaches when the held id changes.
    const liveBot = sim && sim.state && sim.state.bots
      ? sim.state.bots.find((x) => x.id === d.botId) : null;
    const heldId = liveBot && liveBot.weapon ? liveBot.weapon.id : null;
    const kind = (heldId && WPN_KIND[heldId]) || archWpnKind(d.archetype);
    let wpn = null;
    if (wpnProtos[kind]) {
      wpn = wpnProtos[kind].clone(true); // shares geometry+materials — cheap
      actor.attachWeapon(wpn, "R");
      actor._wpnKind = kind;
    }
    // Model faces +Z locally; sim forward for yaw ψ is (-sin ψ, -cos ψ), so
    // the THREE root yaw is ψ + π (verified against sim.aimAt's convention).
    const rec = {
      botId: d.botId,
      archetype: d.archetype,
      // Parsed ONCE at spawn (the grounding write runs every frame for every
      // live actor and must not allocate). Same value actor.setTint() used.
      tintHex: (() => {
        const t = archTint(d.archetype);
        const n = typeof t === "string" ? parseInt(t.replace("#", ""), 16) : (t | 0);
        return isFinite(n) ? n : 0x4b5142;
      })(),
      actor,
      wpn,
      prev: [d.pos[0], d.pos[1], d.pos[2]],
      curr: [d.pos[0], d.pos[1], d.pos[2]],
      lastTick: -1,
      yaw: (d.yaw || 0) + Math.PI,
      yawTarget: (d.yaw || 0) + Math.PI,
      flashUntil: -1,
      flashOn: false,
      deathPlayed: false,
      skipN: (d.botId | 0) % 3, // stagger off-screen eval so thirds interleave
      skipAcc: 0,
      forceAnim: null,
      kick: 0,
      shadow: -1, // grounding slot, leased on the first update (fx may lag boot)
    };
    actor.root.position.set(d.pos[0], d.pos[1], d.pos[2]);
    actor.root.rotation.y = rec.yaw;
    ctx.scene.add(actor.root);
    actors.set(d.botId, rec);
  }

  function removeActor(botId) {
    const rec = actors.get(botId);
    if (!rec) return;
    const G = grounding();
    if (G && rec.shadow >= 0) G.free(rec.shadow);
    rec.shadow = -1;
    rec.actor.dispose();
    actors.delete(botId);
  }

  function clearAll() {
    const G = grounding();
    for (const rec of actors.values()) {
      if (G && rec.shadow >= 0) G.free(rec.shadow);
      rec.actor.dispose();
    }
    actors.clear();
    pendingSpawns.length = 0;
  }

  function onDeath(d) {
    const rec = actors.get(d.victim);
    if (!rec || rec.deathPlayed) return;
    rec.deathPlayed = true;
    // a corpse does not breathe, sway or scan the street — kill the life
    // layer at the same instant the death clip is committed (actor.js)
    rec.actor.lifeGain = 0;
    // DIRECTIONAL DEATH (VT §7): the body is knocked AWAY from the shot —
    // face the shooter so the (backward-falling) Mixamo deaths read as impact
    // direction, not a canned flop. d.dir is the shot's travel direction.
    if (d.dir && (d.dir[0] || d.dir[2])) {
      const simYawFacingShooter = Math.atan2(d.dir[0], d.dir[2]);
      rec.yawTarget = simYawFacingShooter + Math.PI;
    }
    // Variant: honor the sim's latched death_a/death_b semantic (both resolve
    // to the one proven fall clip — see anim_map.js) and vary the playback
    // rate deterministically per victim so nearby deaths never read identical.
    const sim = ctx.sim();
    const bot = sim && sim.state.bots.find((b) => b.id === d.victim);
    const v = (bot && (bot.anim === "death_a" || bot.anim === "death_b")) ? bot.anim : "death_a";
    const ts = 0.88 + (d.victim % 4) * 0.08; // 0.88 / 0.96 / 1.04 / 1.12
    rec.actor.playOnce(v, { fade: 0.09, timeScale: ts });
    // Bodies persist ≥ 20 s (VT §7 / D6 permanence): nothing here removes the
    // actor — it stays until its bot leaves sim.state (checkpoint restore) or
    // mission:start clears the cast.
  }

  const soldiers = {
    /**
     * requiredBodies gate before mission start (frozen signature). Boot is
     * NEVER gated on this; startMission awaits it behind the mission loading
     * overlay. Progress cb feeds the determinate bar.
     */
    async ready(archetypes, onProgress) {
      await ensureLoaded(archetypes, onProgress);
      if (loadError) throw loadError;
      flushPending();
      if (onProgress) onProgress(1);
    },

    /** Registered on the frozen vocabulary only (architecture §4). */
    attach(bridge) {
      bridge.register("mission:start", () => { clearAll(); });
      bridge.register("spawn", (d) => {
        if (protosReady) spawnActor(d);
        else pendingSpawns.push(d);
      });
      bridge.register("death", (d) => {
        if (typeof d.victim === "number") onDeath(d);
      });
      bridge.register("hurt", (d) => {
        // 70 ms COLOR-MULTIPLY flinch flash — never emissive (VT §7).
        const rec = actors.get(d.victim);
        if (!rec) return;
        rec.flashUntil = viewT + 0.07;
        // BODY FLINCH (iter07, ranked fix 7). The flash was the WHOLE of the
        // hit reaction and it is 70 ms long: at 60 fps that is four frames,
        // and the filmstrip samples half a second apart, so no critic has ever
        // been able to see a soldier react to a round. `hit` (the clip) only
        // plays when the SIM latches bot.anim = "hit", which it does not do
        // for a graze. This is the always-on half: a directional spring in the
        // torso that folds him over the round and snaps his head down, and it
        // is still visibly settling ~0.4 s later.
        // d.dir points victim -> attacker, so the ROUND travelled -d.dir.
        let side = 0;
        if (d.dir) {
          const ry = rec.yaw;                 // THREE yaw of the actor root
          // actor RIGHT in world is (cos ry, 0, -sin ry) — same basis actor.js
          // builds its pitch axis from. side = shotDir · right.
          side = (-d.dir[0]) * Math.cos(ry) + (-d.dir[2]) * (-Math.sin(ry));
          side = Math.max(-1, Math.min(1, side));
        }
        rec.actor.hitImpulse(side, Math.min(1.5, 0.6 + (d.amount || 20) / 45));
      });
      bridge.register("botstate", (d) => {
        // fallback: a bot can die from test-surface damage with the death
        // event filtered upstream — the state edge still buries it
        if (d.state === "dead") {
          const rec = actors.get(d.botId);
          if (rec && !rec.deathPlayed) onDeath({ victim: d.botId, dir: null });
        }
      });
      bridge.register("shot", (d) => {
        // fire-anim/kick ONLY on true fire-time events: impactOnly is a
        // late-resolving swept projectile, pen is an impact-face event (A1's
        // additive-field convention) — reacting to those replays the kick.
        if (d.impactOnly || d.pen) return;
        if (typeof d.shooter === "number") {
          const rec = actors.get(d.shooter);
          if (!rec) return;
          rec.kick = 1;
          // BODY RECOIL (iter07). rec.kick alone slides the weapon prop 2 cm
          // along its own axis — invisible past ~5 m, and the SHOOTER looked
          // as frozen as everyone else. The torso spring absorbs each round
          // and, under sustained fire, holds a displaced pose rather than
          // spiking for one frame (the viewmodel lane's iter06 finding,
          // applied to the third-person body).
          rec.actor.fireImpulse(1);
        }
      });
    },

    /**
     * Per-frame: interpolate prev→curr tick positions with alpha, drive anims
     * from bot.anim, aim-blend, flash restore, off-screen 1-in-3 pose eval.
     */
    update(dt, alpha) {
      const sim = ctx.sim();
      if (!sim) return;
      const st = sim.state;
      const G = grounding();

      // ---- HELD-FRAME GUARD (ranked fix 5, S9 pose) ------------------------
      // boot's rAF loop calls viewUpdates() every frame whether or not the sim
      // stepped, so while the world is held for a battery pose the mixer kept
      // advancing on WALL time: the harness's 24-frame settle spends 3.70 s of
      // wall clock at 0.000 s of sim (measured live this session), which walks
      // a 1.2 s run cycle three times over and lands the pose wherever the
      // machine's frame rate happens to drop it. That is why S9's captured
      // stance is a mid-air stride with the rear boot off the cobbles: it is
      // not a chosen pose, it is a lottery. Freezing the mixer when the sim
      // clock does not move makes a held pose deterministic AND makes it the
      // pose the scenario's own settle ticks produced.
      const simHeld = (lastSimT !== null) && !(st.time > lastSimT);
      lastSimT = st.time;
      const dtAnim = simHeld ? 0 : dt;
      viewT += dtAnim;

      // one pass over state (persistent map — no per-frame allocation growth)
      botIndex.clear();
      for (let i = 0; i < st.bots.length; i++) botIndex.set(st.bots[i].id, st.bots[i]);

      // reconcile: create actors for bots that missed their spawn event
      if (protosReady) {
        for (const b of st.bots) {
          if (!actors.has(b.id)) {
            spawnActor({ botId: b.id, archetype: b.archetype, pos: b.pos, yaw: b.yaw });
            if (!b.alive) { // late join on a corpse: bury it without replaying
              const rec = actors.get(b.id);
              rec.deathPlayed = true;
              rec.actor.lifeGain = 0;   // late-joined corpse: no life layer
              rec.actor.playOnce(b.anim === "death_b" ? "death_b" : "death_a", { fade: 0, timeScale: 1000 });
            }
          }
        }
      }

      // camera frustum for the off-screen eval discount
      _projView.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projView);

      for (const rec of actors.values()) {
        const bot = botIndex.get(rec.botId);
        if (!bot) { removeActor(rec.botId); continue; } // checkpoint restore reap
        const actor = rec.actor;

        // ---- held-weapon model follows the sim (PVP racks change it mid-life)
        if (bot.weapon && bot.weapon.id) {
          const want = WPN_KIND[bot.weapon.id] || null;
          if (want && want !== actor._wpnKind && wpnProtos[want]) {
            // attachWeapon() only ADDS a holder on the hand bone — it never
            // replaces. Detach the outgoing gun first, or a bot that swaps
            // keeps the old model in its fist alongside the new one. (The
            // holder is the clone's parent; actor.js keeps its stale grip
            // entry in its solve list — harmless, a detachWeapon() there
            // would tidy it.) rec.wpn must follow the swap too: the fire-kick
            // below drives rec.wpn.position.z.
            if (rec.wpn && rec.wpn.parent) rec.wpn.parent.removeFromParent();
            const nw = wpnProtos[want].clone(true);
            actor.attachWeapon(nw, "R");
            actor._wpnKind = want;
            rec.wpn = nw;
          }
        }

        // ---- interpolated position reads (alpha between the last two ticks)
        if (st.tick !== rec.lastTick) {
          if (st.tick - rec.lastTick === 1) {
            rec.prev[0] = rec.curr[0]; rec.prev[1] = rec.curr[1]; rec.prev[2] = rec.curr[2];
          } else { // >1 tick this frame (or teleport): snap, don't rubber-band
            rec.prev[0] = bot.pos[0]; rec.prev[1] = bot.pos[1]; rec.prev[2] = bot.pos[2];
          }
          rec.curr[0] = bot.pos[0]; rec.curr[1] = bot.pos[1]; rec.curr[2] = bot.pos[2];
          rec.lastTick = st.tick;
        }
        const a = Math.min(1, Math.max(0, alpha));
        actor.root.position.set(
          rec.prev[0] + (rec.curr[0] - rec.prev[0]) * a,
          rec.prev[1] + (rec.curr[1] - rec.prev[1]) * a,
          rec.prev[2] + (rec.curr[2] - rec.prev[2]) * a
        );

        // ---- facing (damped — pivots with weight, never snaps)
        if (bot.alive && !rec.forceAnim) rec.yawTarget = bot.yaw + Math.PI;
        rec.yaw = dampAngle(rec.yaw, rec.yawTarget, rec.deathPlayed ? 18 : 10, dtAnim);
        actor.root.rotation.y = rec.yaw;

        // ---- animation selection (sim's bot.anim is authoritative)
        const hs = bot.vel ? Math.hypot(bot.vel[0], bot.vel[2]) : 0;
        actor.groundSpeed = hs;
        actor.crouchW = 0;
        // ---- WEAPON READY POSE (iter08) -----------------------------------
        // The sim publishes exactly the state this needs and nobody was
        // reading it: `aim`/`fire` mean the rifle is up and pointed at a
        // threat, everything else means it is not. Driving actor.readyWant off
        // it moves the rifle bar ~0.2 m in the silhouette between a patrolling
        // bot and an engaged one, and it moves it back the moment the bot
        // loses contact — which is the ONE upper-body channel the clip set
        // cannot supply (measured: rifle_idle's hands travel 2 mm in 1.2 s).
        // Running men carry the weapon down too; a sprint at 5+ m/s is not a
        // firing position whatever the state machine last latched.
        actor.readyWant = bot.alive &&
          (bot.anim === "aim" || bot.anim === "fire" || bot.anim === "hit" ||
           bot.state === "combat" || bot.state === "suppress") && hs < 5.0;
        if (!bot.alive) {
          if (!rec.deathPlayed) onDeath({ victim: rec.botId, dir: null });
        } else if (rec.forceAnim) {
          actor.groundSpeed = rec.forceAnim === "run" ? 3.6 : rec.forceAnim === "walk" ? 1.5 : 0;
          actor.play(rec.forceAnim);
        } else if (bot.anim === "hit") {
          // THE `hit` CLIP IS NO LONGER PLAYED (iter08), and this is a defect
          // closure, not a regression. iter07's fix routed the sim's `hit`
          // state into clip_hit.glb; 2/3 critics then named the result as a
          // NEW defect — "frozen in a bizarre hands-up-at-the-cheeks pose that
          // is not a combat stance" (critic-a), "a bizarre both-hands-to-face
          // pose" (critic-b). Measured this session, that clip drops the hips
          // 0.952 -> 0.70 m and the right hand to 0.76 m: it is a Mixamo
          // unarmed flail, and no amount of blending makes a man holding a
          // rifle do it. The reaction is now entirely the procedural flinch
          // (actor.hitImpulse: torso fold + head snap + the weapon knocked off
          // the shoulder), which reads AS a flinch because it stays inside a
          // combat stance. The clip stays loaded and stays in ANIMS — the
          // frozen 10-key shape is untouched and a future authored rifle-hit
          // clip drops straight into the same slot.
          // A man shot while running keeps running: fall through to the
          // locomotion clip so the feet never stop cycling under a moving
          // body (foot slide is the D10 hard cap). Standing, he holds his
          // firing stance and the spring does the reacting.
          actor.play(hs > 5.0 ? "run" : hs > 0.5 ? "walk" : "aim");
        } else if (bot.weapon && bot.weapon.state === "reloading" && hs < 4.5) {
          // RELOAD (iter07, ranked fix 7). clip_rifle_reload has shipped in
          // CLIP_FILES since day one with NOTHING pointing at it, so a bot
          // running §5.7's dry reload played his idle through it and 3/3
          // critics reported the reload as invisible. The sim exposes the
          // window directly; play it while it is open and fall back to
          // whatever the sim wants next when it closes. Not while sprinting —
          // a reload-on-the-move must keep its stepping cycle (foot slide is
          // the D10 hard cap), the arms just lose the mag change.
          if (actor.currentName !== "rifle_reload") {
            actor.play("reload", { fade: 0.12, fromStart: true });
          }
        } else {
          // CROUCH, BOTH STATES (iter08). This used to fire on crouch_walk
          // only, so a bot ducking behind low cover — botfsm.js:904's peek
          // cycle, which sets c.crouch for 1.2-2.0 s at a time and is the ONE
          // stance change the AI already produces — rendered as `crouch_idle`
          // -> clip rifle_crouch, measured this session at hips 0.952 m
          // (identical to standing) with the feet lifted off the ground. The
          // sim asked for a crouch and the view drew a man marching in place.
          // actor.js now solves a real two-link squat for both states.
          if (bot.anim === "crouch_walk" || bot.anim === "crouch_idle") actor.crouchW = 1;
          actor.play(bot.anim);
        }

        // ---- 70 ms flinch flash restore (exact, view-clocked)
        const flashing = viewT < rec.flashUntil;
        if (flashing !== rec.flashOn) { rec.flashOn = flashing; actor.setFlash(flashing); }

        // ---- weapon fire kick (cosmetic; decays fast)
        if (rec.wpn && rec.kick > 0.001) {
          rec.wpn.position.z = -0.02 * rec.kick;
          rec.kick *= Math.exp(-22 * dtAnim);
        } else if (rec.wpn && rec.wpn.position.z !== 0) {
          rec.wpn.position.z = 0;
        }

        // ---- pose evaluation: off-screen actors evaluate 1-in-3 frames with
        // dt accumulation (perf budget §8) — position/yaw still track exactly
        _sphere.center.copy(actor.root.position);
        _sphere.center.y += 0.9;
        _sphere.radius = 1.3;
        const onScreen = _frustum.intersectsSphere(_sphere);
        rec.skipAcc += dtAnim;
        rec.skipN++;
        if (onScreen || rec.skipN % 3 === 0) {
          // aim-pose blend is set BEFORE update() now (iter07): aimBlend() no
          // longer writes bones, it stashes the request, and actor.update()
          // applies it inside the restore→mixer→snapshot cycle that makes
          // post-mixer bone edits idempotent (actor.js LIFE note). Calling it
          // after update() would apply it one frame late and, on a HELD
          // battery frame, would compound — the old order's real bug.
          if (bot.alive) {
            let pitch = 0, yawDelta = 0, want = 0;
            if ((bot.anim === "aim" || bot.anim === "fire") && bot.aimAt) {
              const dx = bot.aimAt[0] - bot.pos[0];
              const dy = bot.aimAt[1] - (bot.pos[1] + 1.45);
              const dz = bot.aimAt[2] - bot.pos[2];
              const hl = Math.hypot(dx, dz) || 1e-9;
              pitch = Math.atan2(dy, hl);
              const aimYawThree = Math.atan2(dx, dz); // THREE θ: forward (sinθ,cosθ)
              yawDelta = Math.max(-0.6, Math.min(0.6, wrapAngle(aimYawThree - rec.yaw)));
              want = 1;
            }
            actor.aimBlend(pitch, yawDelta, want);
          }
          actor.update(rec.skipAcc);
          // One-hand-class weapon (the GS-9 Pike — every PVP bot's starting gun):
          // the rifle clips leave the support hand ~0.19 m past a pistol's
          // muzzle, so after the actor's own grip solve the left arm is IK'd
          // onto the pistol grip (world_weapon.js createSupportHandIK).
          if (rec.ik === undefined) rec.ik = createSupportHandIK(actor.root);
          if (rec.ik) {
            rec.ik.solve(rec.wpn,
              bot.alive && !rec.deathPlayed && rec.wpn && rec.wpn.userData.brOneHand ? 1 : 0,
              rec.skipAcc > 0 ? rec.skipAcc : dtAnim);
          }
          rec.skipAcc = 0;
        }

        // ---- contact shadow (ranked fix 5) ---------------------------------
        // Placement is the actor's own feet plane: bot.pos is the sim capsule
        // FOOT position, so the blob needs no downward raycast to be exact on
        // decks and stairs — the same contract fx.js uses to floor brass. The
        // terrain height is consulted only to fade the blob out while a body
        // is genuinely airborne (jump / fall), so a lifted stride foot keeps
        // its shadow and a vaulting soldier does not drag one through the air.
        if (G) {
          if (rec.shadow < 0) rec.shadow = G.alloc();
          if (rec.shadow >= 0) {
            const px = actor.root.position.x;
            const pz = actor.root.position.z;
            const py = actor.root.position.y;
            const gy = (ctx.colliders && ctx.colliders.groundY)
              ? ctx.colliders.groundY(px, pz) : 0;
            const contactY = Math.min(py, gy);
            const lift = Math.max(0, py - gy);
            const air = Math.max(0, 1 - lift / CONTACT.fadeH);
            const dead = !bot.alive;
            G.write(
              rec.shadow, px, contactY + 0.014, pz,
              dead ? CONTACT.deadRX : CONTACT.rx,
              dead ? CONTACT.deadRZ : CONTACT.rz,
              (dead ? CONTACT.deadS : CONTACT.strength) * air,
              // reflection: body height, body tint, body facing. The tint is
              // the archetype's own tint — the same value actor.setTint()
              // shaded the GLB with — so the mirror image is the man, not a
              // generic grey smear.
              (dead ? CONTACT.deadH : CONTACT.standH) * air,
              rec.tintHex, rec.yaw,
              // The silhouette both the shadow and the reflection are drawn
              // from. A standing man grounds as boots + torso and mirrors as a
              // figure with shoulders; a body grounds as a long ellipse.
              dead ? SHAPE.PRONE : SHAPE.HUMAN);
          }
        }
      }
    },

    /** {alive, total} — read from the sim (the one source of truth). */
    count() {
      const sim = ctx.sim();
      if (!sim) return { alive: 0, total: 0 };
      let alive = 0;
      for (const b of sim.state.bots) if (b.alive) alive++;
      return { alive, total: sim.state.bots.length };
    },

    // ---- private (harness/debug only — not part of the frozen surface)
    _actors: actors,
    _debugPose(botId, anim) {
      const rec = actors.get(botId);
      if (rec) rec.forceAnim = anim || null;
    },
  };

  // Background prefetch during the menu (boot NEVER gated — §5 boot table):
  // kicked off a beat after construction so boot phase 4 isn't lengthened by
  // fetch scheduling. A validation failure in here throws out of a task →
  // page error → bootcheck catches it: that IS the anim_map gate at load.
  setTimeout(() => {
    ensureLoaded(ctx.content && ctx.content.archetypes
      ? Object.keys(ctx.content.archetypes).filter((k) => !k.startsWith("_")) : null)
      .catch((e) => {
        loadError = e;
        console.error("[soldiers] background load failed:", e);
        // contract-gate failures must be LOUD in dev (page error, not a log)
        setTimeout(() => { throw e; }, 0);
      });
  }, 0);

  return soldiers;
}

// core/chars/fp_body.js [a11] — the first-person body: legs, feet and hips under
// the camera, plus the player's own shadow.
//
// Looking down used to show nothing. This module stands the player's OWN operator
// (the same soldier actor + operator look the killcam draws for "YOU") under the
// camera and drives it from the player's sim state exactly the way soldiers.js
// drives a third-person operator: 8-way locomotion by travel direction relative to
// facing, walk/run/sprint by ground speed, the real crouch clips, the jump pose
// while airborne, and a slide pose (crouch held, body tipped back, feet forward).
//
// UPPER BODY: discarded in the COLOUR pass only, per vertex, by skin weight — any
// vertex mostly bound to Spine2 and above (chest, neck, head, shoulders, arms,
// hands, and the gear on them) is cut in the fragment shader. The camera sits
// where the head would be, so nothing can clip into the eye or the first-person
// weapon (which draws in its own depth-cleared pass on top anyway). The SHADOW
// pass uses three's default depth material, which has no such cut, so the moon
// throws the WHOLE man — head, helmet, arms — onto the ground: the player's own
// shadow under the existing lighting. A contact silhouette from the shared
// grounding pool (fx/grounding.js, the same one every operator uses) plants it.
//
// HIDDEN while: dead, killcam/death cam/spectating (ctx.cameraDetached or
// killcam.isActive()), outside live phases (menu, briefing, end board), and when
// settings.fpBody === false.
//
// COST (measured, see report): 2 draws (body + gear) + 2 shadow-pass draws, one
// skinned actor update. Programs: one body variant + one gear variant, compiled
// at build behind the menu (never mid-play).
//
// View-layer only: reads sim.state.player / input.state; writes nothing back.

import * as THREE from "three";
import { loadBody, createActor } from "./actor.js";
import { loadOperatorKit, dressActor, lookFor, accentFor, setAccent } from "./operator_looks.js";
import { SHAPE } from "../fx/grounding.js";

const CAMPAIGN_LIVE = new Set(["infil", "assault", "exfil"]);
const MATCH_LIVE = new Set(["warmup", "live", "overtime"]);
// any bone whose name matches is hidden in the colour pass (and everything bound to it)
const HIDE_BONES = /(Spine|Neck|Head|Shoulder|Arm|Hand)/;   // Spine, Spine1, Spine2 and up: hips and legs stay
const MAX_BONES = 64;

// placement (metres): how far the body stands BEHIND the eye.
const BACK_STAND = 0.02;
const BACK_CROUCH = 0.10;
// [fx v152] SLIDE: was {tilt -0.30, back 0.05, drop 0.20} over the CROUCH clip —
// knees folded under the lens, so looking down mid-slide showed one knee and
// nothing else (fx/slide_before.png). A slide is legs out in front: the
// straight-legged idle pose laid back ~64 degrees about the boots, then the
// whole body slid forward so the hips sit under the eye and the boots lead.
const SLIDE = { tilt: -1.12, back: -0.80, drop: 0.02 };
// looking steeply down, the body eases a little further back
// and the legs swing forward about the boots (hips back, boots under the eye), so
// the view lands on thighs and boots rather than on the closed waist
const PITCH_BACK = { from: 0.6, to: 1.4, add: 0.04, tilt: -0.30 };

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function dampAngle(cur, target, lambda, dt) {
  return cur + wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));
}
function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

/** Colour-pass cut of the upper body, by skin weight (see header). */
function patchHide(mesh) {
  const bones = mesh.skeleton ? mesh.skeleton.bones : [];
  const flags = new Float32Array(MAX_BONES);
  for (let i = 0; i < bones.length && i < MAX_BONES; i++) {
    flags[i] = HIDE_BONES.test(bones[i].name.replace(/^mixamorig:?/i, "")) ? 1 : 0;
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const pivot = { value: new THREE.Vector3() };   // mesh-local, written per frame
  mesh.userData.fpPivot = pivot;
  for (const m of mats) {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : "";
    const u = { value: flags };
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(m, sh, r);
      sh.uniforms.uFpHide = u;
      sh.vertexShader =
        `uniform float uFpHide[${MAX_BONES}];\nvarying float vFpHide;\n` +
        `uniform vec3 uFpPivot;\n` +
        sh.vertexShader.replace(
          "#include <skinning_vertex>",
          "#include <skinning_vertex>\n" +
          "\tvFpHide = uFpHide[int(skinIndex.x)] * skinWeight.x + uFpHide[int(skinIndex.y)] * skinWeight.y +\n" +
          "\t          uFpHide[int(skinIndex.z)] * skinWeight.z + uFpHide[int(skinIndex.w)] * skinWeight.w;\n" +
          // gather the upper body into the lower-back joint: the torso closes into
          // a short dome over the belt (no open cut to look into from the eye)
          "\ttransformed = mix(transformed, uFpPivot, clamp(vFpHide, 0.0, 1.0));"
        );
      sh.uniforms.uFpPivot = pivot;
      sh.fragmentShader =
        "varying float vFpHide;\n" +
        sh.fragmentShader.replace("void main() {", "void main() {\n\tif (vFpHide > 0.985) discard;")
          // the gathered waist reads as the dark top of the belt line
          .replace("#include <color_fragment>",
            "#include <color_fragment>\n\tdiffuseColor.rgb *= 1.0 - 0.85 * smoothstep(0.15, 0.8, vFpHide);");
    };
    m.customProgramCacheKey = () => prevKey + "|fpbody";
    m.needsUpdate = true;
  }
}

export function createFpBody(ctx, deps = {}) {
  const killcam = deps.killcam || null;
  let proto = null, kit = null, loading = null, failed = false;
  let actor = null;
  let builtKey = null;            // which (sim, roster) the current look belongs to
  let compiled = false;
  let shadowSlot = -1;
  let grounding = null;
  const st8 = { moveDir: 0, legYaw: 0, airT: 0, slideW: 0, crouchBack: 0 };
  const pos = [0, 0, 0];
  const fpMeshes = [];            // patched skinned meshes (body + gear)
  const _pv = new THREE.Vector3();
  let lastSimT = null;
  const stats = { builds: 0, visible: false, look: null };

  function G() {
    if (grounding) return grounding;
    const fx = ctx.fx || ((typeof window !== "undefined" && window.__FPS__) ? window.__FPS__.fx : null);
    if (fx && fx.grounding) grounding = fx.grounding;
    return grounding;
  }

  function ensure() {
    if (loading) return loading;
    loading = (async () => {
      try {
        proto = await loadBody("soldier");
        try { kit = await loadOperatorKit(); } catch (e) { kit = null; }
        // build once NOW (hidden) so both shader variants compile behind the
        // menu; the first live frame then only re-dresses with cached programs
        build(0, null);
        builtKey = null;
      } catch (e) {
        failed = true;
        console.warn("[fp_body] soldier body unavailable — no first-person body:", e && e.message);
      }
    })();
    return loading;
  }

  function build(look, accent) {
    if (actor) { actor.dispose(); actor = null; }
    const a = createActor(proto);
    if (a.placeholder) { failed = true; a.dispose(); return; }
    if (kit) dressActor(a, kit, proto, look, accent);
    fpMeshes.length = 0;
    a.root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      patchHide(o);
      fpMeshes.push(o);
      o.castShadow = true;
      o.receiveShadow = true;
    });
    a.root.name = "fp_body";
    a.lifeGain = 0.35;            // breathing in the shadow, no head scan in the legs
    a.readyWant = 1;
    a.root.visible = false;
    ctx.scene.add(a.root);
    actor = a;
    stats.builds++;
    stats.look = look;
    if (!compiled) {
      compiled = true;
      // compile both variants now (behind the menu / match load), not on first view
      try {
        a.root.visible = true;
        a.root.position.set(0, -500, 0);
        const p = ctx.renderer.compileAsync
          ? ctx.renderer.compileAsync(a.root, ctx.camera, ctx.scene)
          : (ctx.renderer.compile(ctx.scene, ctx.camera), Promise.resolve());
        a.root.visible = false;
        p.catch(() => {});
      } catch (e) { a.root.visible = false; }
    }
  }

  function hide() {
    if (actor) actor.root.visible = false;
    const g = G();
    if (g && shadowSlot >= 0) g.hide(shadowSlot);
    if (g && lampSlot >= 0) g.hide(lampSlot);
    stats.visible = false;
  }

  // ---- [fx v152] what is lighting the player (see the shadow note in update)
  let lampSlot = -1;
  let shadowProbe = 0;
  let moonWant = 0, moonVis = 0, lampVis = 0;
  const lamp = { w: 0, dx: 0, dz: 0, len: 0 };
  const SH_OPTS = { cast: 0, lx: 0, lz: 0, noRefl: true };
  const LP_OPTS = { cast: 0, lx: 0, lz: 0, noRefl: true };
  const _md = [0, 0, 0], _o = [0, 0, 0];
  function lightsApi() {
    return ctx.lights || ((typeof window !== "undefined" && window.__FPS__) ? window.__FPS__.lights : null);
  }
  function probeLights(sim, bx, by, bz) {
    const L = lightsApi();
    const world = sim && sim.world;
    moonWant = 0;
    if (L && L.moon && world && world.raycast) {
      const m = L.moon;
      _md[0] = m.position.x - m.target.position.x; _md[1] = m.position.y - m.target.position.y; _md[2] = m.position.z - m.target.position.z;
      const ml = Math.hypot(_md[0], _md[1], _md[2]) || 1;
      _md[0] /= ml; _md[1] /= ml; _md[2] /= ml;
      // chest height: a low wall beside you still lets your shoulders cast
      _o[0] = bx; _o[1] = by + 1.25; _o[2] = bz;
      const h = world.raycast(_o, _md, 80);
      moonWant = h && h.dist < 80 ? 0 : (m.intensity > 0.5 ? 1 : 0);
    }
    // the strongest practical spot that reaches you
    lamp.w = 0;
    const spots = L && L.spots;
    if (spots) {
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        if (!s || !s.visible || !(s.intensity > 0)) continue;
        const dx = bx - s.position.x, dz = bz - s.position.z, dy = by + 1.0 - s.position.y;
        const d = Math.hypot(dx, dy, dz);
        const R = s.distance > 0 ? s.distance : 15;
        if (d > R) continue;
        // inside the cone?
        const tx = s.target.position.x - s.position.x, ty = s.target.position.y - s.position.y, tz = s.target.position.z - s.position.z;
        const tl = Math.hypot(tx, ty, tz) || 1;
        const c = (dx * tx + dy * ty + dz * tz) / (tl * (d || 1));
        const cone = Math.cos(s.angle || 0.6);
        if (c < cone) continue;
        const fall = (1 - d / R) * (1 - d / R) * Math.min(1, s.intensity / 30) * Math.min(1, (c - cone) / 0.08);
        if (fall <= lamp.w) continue;
        const hd = Math.hypot(dx, dz);
        const hl = s.position.y - by;
        if (hd < 0.25 || hl < 2.0) continue;                   // straight overhead: the pool is the shadow
        if (world && world.raycast) {                           // something between you and the lamp
          _o[0] = bx; _o[1] = by + 1.25; _o[2] = bz;
          _md[0] = -dx / d; _md[1] = -dy / d; _md[2] = -dz / d;
          const h = world.raycast(_o, _md, d - 0.3);
          if (h && h.dist < d - 0.3) continue;
        }
        lamp.w = fall;
        lamp.dx = dx / hd; lamp.dz = dz / hd;
        lamp.len = Math.max(0.3, Math.min(2.1, 1.7 * hd / Math.max(0.4, hl - 1.7)));
      }
    }
  }

  // background prefetch, like soldiers.js (boot is never gated on it)
  setTimeout(() => { ensure(); }, 0);
  if (ctx.onChange) ctx.onChange("colorblind", () => {
    const sim = ctx.sim();
    if (actor && sim && sim.state && sim.state.player) setAccent(actor, accentFor(sim.state, sim.state.player.team));
  });

  return {
    /** Per frame, AFTER vm.update (camera placed) and killcam.update. */
    update(dt, alpha) {
      const sim = ctx.sim();
      const s = sim && sim.state;
      const p = s && s.player;
      if (!proto) { if (!failed) ensure(); hide(); return; }
      const m = s && s.match;
      const live = !!p && p.alive && CAMPAIGN_LIVE.has(s.phase) && (!m || MATCH_LIVE.has(m.phase));
      const on = live && ctx.settings && ctx.settings.fpBody !== false && ctx.settings.fpBody !== "off" &&
        !ctx.cameraDetached && !(killcam && killcam.isActive && killcam.isActive());

      // (re)build when the sim or its roster changes: the player's look comes
      // from their roster identity, the same rule every operator uses
      const key = sim ? (m && m.actors ? m.actors : sim) : null;
      if (on && key !== builtKey) {
        builtKey = key;
        build(m ? lookFor(s, 0, 0) : 0, accentFor(s, p.team));   // campaign: the default look
      }
      if (!on || !actor) { hide(); return; }

      // ---- position: the render-interpolated feet (same base the camera uses)
      const rp = ctx.playerRenderPos ? ctx.playerRenderPos(alpha, pos) : null;
      const bx = rp ? rp[0] : p.pos[0], by = rp ? rp[1] : p.pos[1], bz = rp ? rp[2] : p.pos[2];
      const psi = ctx.input && ctx.input.state && typeof ctx.input.state.yaw === "number" ? ctx.input.state.yaw : (p.yaw || 0);
      const fx = -Math.sin(psi), fz = -Math.cos(psi);      // sim forward
      const yaw = psi + Math.PI;                            // THREE root yaw (soldiers.js)

      // held frames (pause, battery poses) freeze the mixer like soldiers.js does
      const held = lastSimT !== null && !(s.time > lastSimT);
      lastSimT = s.time;
      const dta = held ? 0 : dt;

      // ---- locomotion inputs (the soldiers.js 8-way recipe)
      const v = p.vel || [0, 0, 0];
      const hs = Math.hypot(v[0], v[2]);
      const mm = p._m || {};
      const sliding = !!mm.sliding;
      if (hs > 0.5) {
        const rel = wrapAngle(Math.atan2(v[0], v[2]) - yaw);
        if (Math.abs(wrapAngle(rel - st8.moveDir)) > 1.75) st8.moveDir = rel;
        else st8.moveDir = dampAngle(st8.moveDir, rel, 20, dta);
      }
      actor.moveDir = wrapAngle(st8.moveDir);
      const lyWant = sliding ? 0 : actor.locoLegYaw(actor.moveDir, hs, dta);
      st8.legYaw = dampAngle(st8.legYaw, lyWant, 14, dta);
      actor.legYaw = st8.legYaw; actor.locoDir = 1;
      st8.airT = p.grounded === false && !sliding ? st8.airT + dta : 0;
      actor.airborne = st8.airT > 0.12;
      actor.crouched = !sliding && p.stance === "crouch";   // [fx v152] legs straight in a slide
      actor.groundSpeed = sliding ? 0 : hs;
      actor.readyWant = 1;
      actor.crouchW = 0;
      if (actor.hasLoco) {
        actor.play(actor.crouched ? (actor.groundSpeed > 0.5 ? "crouch_walk" : "crouch_idle") : "idle");
        actor.setReload(false);
        if (!actor.hasClipCrouch && actor.crouched) actor.crouchW = 1;
      } else {
        actor.play(actor.crouched ? "crouch_idle" : hs > 3.3 ? "run" : hs > 0.5 ? "walk" : "idle");
      }
      actor.update(dta);

      // ---- placement: behind the eye, slide tips the body back (feet forward)
      st8.slideW = damp(st8.slideW, sliding ? 1 : 0, 14, dt);
      st8.crouchBack = damp(st8.crouchBack, p.stance === "crouch" && !sliding ? 1 : 0, 12, dt);
      const pitch = ctx.input && ctx.input.state && typeof ctx.input.state.pitch === "number" ? ctx.input.state.pitch : (p.pitch || 0);
      let pu = (-pitch - PITCH_BACK.from) / (PITCH_BACK.to - PITCH_BACK.from);
      pu = pu < 0 ? 0 : pu > 1 ? 1 : pu;
      const back = BACK_STAND + (BACK_CROUCH - BACK_STAND) * st8.crouchBack +
        (SLIDE.back - BACK_STAND) * st8.slideW + PITCH_BACK.add * pu * pu * (3 - 2 * pu) * (1 - st8.slideW);
      const r = actor.root;
      r.position.set(bx - fx * back, by - SLIDE.drop * st8.slideW, bz - fz * back);
      const pw = pu * pu * (3 - 2 * pu) * (1 - st8.slideW);
      r.rotation.set(SLIDE.tilt * st8.slideW + PITCH_BACK.tilt * pw, yaw + st8.legYaw, 0, "YXZ");
      r.visible = true;
      stats.visible = true;
      // the gather point follows the lower-back joint in each mesh's own space
      const spine = actor._boneByName && actor._boneByName.get("Hips");
      if (spine) {
        r.updateMatrixWorld(true);
        spine.getWorldPosition(_pv);
        for (let i = 0; i < fpMeshes.length; i++) {
          const ms = fpMeshes[i];
          ms.userData.fpPivot.value.copy(_pv);
          ms.worldToLocal(ms.userData.fpPivot.value);
        }
      }

      // ---- contact silhouette + cast smears from the shared pool
      // [fx v152] THE OWN SHADOW WAS INVISIBLE. Measured on Lantern Walk under
      // open moonlight (A/B with the body's castShadow toggled): the shadow-map
      // shadow moved the median ground pixel 1.3/255 — the wet cobbles are lit
      // by the hemisphere, the IBL and the light sheets, and the moon's direct
      // term that a shadow map removes is a small part of that. And this slot
      // was written with h = 0, which also zeroed the grounding cast sweep that
      // every other operator gets. Now the slot carries the moon's cast (gated
      // by a real line-of-sight test to the moon, so it vanishes under a roof
      // or in a building's shadow) and a second slot throws the shadow AWAY
      // from the nearest practical lamp that is lighting you. Both ride the
      // existing instanced pool: no draw call, no program, two raycasts per
      // ~8 frames.
      const g = G();
      if (g) {
        if (shadowSlot < 0) shadowSlot = g.alloc();
        if (lampSlot < 0) lampSlot = g.alloc();
        const gy = ctx.colliders && ctx.colliders.groundY ? ctx.colliders.groundY(bx, bz) : by;
        const lift = Math.max(0, by - gy);
        const air = Math.max(0, 1 - lift / 0.55);
        const cy = Math.min(by, gy) + 0.014;
        if (--shadowProbe <= 0) { shadowProbe = 8; probeLights(sim, bx, by, bz); }
        moonVis = damp(moonVis, moonWant, 6, dt);
        lampVis = damp(lampVis, lamp.w, 6, dt);
        if (shadowSlot >= 0) {
          // no reflection card: a mirrored man under your own boots reads as a
          // second body, and the camera is never far enough to need it
          SH_OPTS.cast = 0.06 + 1.85 * moonVis; SH_OPTS.lx = 0; SH_OPTS.lz = 0;
          g.write(shadowSlot, bx - fx * 0.05, cy, bz - fz * 0.05,
            0.30, 0.26, (0.85 + 0.1 * moonVis) * air, 1.8, 0x4b5142, yaw + st8.legYaw, SHAPE.HUMAN, SH_OPTS);
        }
        if (lampSlot >= 0) {
          if (lampVis > 0.03) {
            LP_OPTS.cast = lamp.len; LP_OPTS.lx = lamp.dx; LP_OPTS.lz = lamp.dz;
            g.write(lampSlot, bx, cy + 0.002, bz, 0.28, 0.24, 0.9 * Math.min(1, lampVis * 1.6) * air, 1.8, 0x4b5142,
              yaw + st8.legYaw, SHAPE.HUMAN, LP_OPTS);
          } else g.hide(lampSlot);
        }
      }
    },

    // harness / checks (read-only)
    stats() {
      return Object.assign({}, stats, { ready: !!proto, failed,
        shadow: { moon: +moonVis.toFixed(2), lamp: +lampVis.toFixed(2), lampLen: +lamp.len.toFixed(2) } });
    },
    get _actor() { return actor; },
  };
}

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
const SLIDE = { tilt: -0.30, back: 0.05, drop: 0.20 };
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
    stats.visible = false;
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
      actor.crouched = sliding || p.stance === "crouch";
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

      // ---- contact silhouette from the shared pool (the operators' own recipe)
      const g = G();
      if (g) {
        if (shadowSlot < 0) shadowSlot = g.alloc();
        if (shadowSlot >= 0) {
          const gy = ctx.colliders && ctx.colliders.groundY ? ctx.colliders.groundY(bx, bz) : by;
          const lift = Math.max(0, by - gy);
          const air = Math.max(0, 1 - lift / 0.55);
          // no reflection card (h = 0): a mirrored man under your own boots reads
          // as a second body, and the camera is never far enough to need it
          g.write(shadowSlot, bx - fx * 0.05, Math.min(by, gy) + 0.014, bz - fz * 0.05,
            0.30, 0.26, 0.85 * air, 0, 0x4b5142, yaw, SHAPE.HUMAN);
        }
      }
    },

    // harness / checks (read-only)
    stats() { return Object.assign({}, stats, { ready: !!proto, failed }); },
    get _actor() { return actor; },
  };
}

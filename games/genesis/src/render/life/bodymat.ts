// GENESIS — the animated body material (CONTRACT.md §15.6 "GPU vertex animation"): every person and animal is posed
// in the vertex shader from per-instance (animation A, animation B, blend, phase), so thousands of instanced bodies
// animate with no CPU skinning.
//
//   * Each body plan (render/gen/bodygen.ts) has bones with rest pivots and parents (uniform arrays per mesh). A
//     vertex belongs to up to two bones (blended at the joints); its position is rotated about each pivot of its bone
//     chain, child first, then the root pose (bob, crouch, kneel, lie down, swim, tumble) is applied.
//   * Joint angles come from per-plan pose functions of (state, cycle angle) for every AnimState: walk, run, flee,
//     carry (load on the chest, shoulder, head or back), work, build (hammer), chop (overhead swing), dig (hoe), fish,
//     pray (kneeling bow), mourn, sleep (on the side), sit, eat, teach (gesturing), dance, cheer, fight, swim, dead,
//     held, thrown, idle (breathing, weight shift, looking about); quadrupeds walk / trot / gallop, graze, sleep;
//     birds flap and glide; fish undulate (whales pitch); insects whir; rays ripple; drifters pulse.
//   * Two states are posed and their angles blended (a person turning from walking to praying eases over it).
//   * Style bits per instance switch hair, clothing tiers, dresses, hats, beards; a tool id shows one held tool.
// Fragment: per-part albedo (skin / cloth / dyed trim / hair / leather / fur / carapace / coats / bellies / horn /
// wood / metal / loads), woven or hide texture up close, skin wrap-lighting, the planet's sun, shadows and sky.

import { DoubleSide, FrontSide, MeshStandardMaterial, ShaderMaterial, Vector3, type IUniform } from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import { MOON_PARS, moonDirect } from '../shaders/moon.glsl.ts';
import type { Rig } from '../gen/bodygen.ts';

/** the skinning + pose GLSL shared by the colour and depth materials (PLAN is a define) */
export const BODY_ANIM_GLSL = /* glsl */ `
uniform vec3 uPivot[16];
uniform int uParent[16];
uniform float uAnimTime;
uniform float uFreqK;
uniform float uPitchSwim;
attribute vec4 aRig;
attribute vec4 aSel;
attribute vec4 iAnim;
attribute vec4 iStyle;
#define BPI 3.14159265

float animFreq(int a) {
  if (a == 1) return 0.95; if (a == 2) return 1.45; if (a == 3) return 0.9; if (a == 4) return 0.85; if (a == 5) return 0.12;
  if (a == 6) return 0.07; if (a == 7) return 1.6; if (a == 8) return 1.1; if (a == 9) return 0.75; if (a == 10) return 0.55;
  if (a == 11) return 0.0; if (a == 12) return 0.6; if (a == 13) return 1.4; if (a == 14) return 0.45; if (a == 15) return 1.3;
  if (a == 16) return 0.55; if (a == 17) return 0.5; if (a == 18) return 0.18; if (a == 19) return 0.35; if (a == 20) return 0.15;
  if (a == 21) return 1.1; if (a == 22) return 0.3; if (a == 23) return 2.2; if (a == 24) return 0.15; if (a == 25) return 0.2;
  return 0.25;
}

// rotate by euler (x pitch, y yaw, z roll): roll first, then pitch, then yaw
vec3 rotE(vec3 p, vec3 e) {
  float c = cos(e.z), s = sin(e.z);
  p = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  c = cos(e.x); s = sin(e.x);
  p = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  c = cos(e.y); s = sin(e.y);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// a smooth chop / hammer stroke: a slow lift, a fast fall
float strike(float t) { float f = fract(t / (2.0 * BPI)); return f < 0.7 ? smoothstep(0.0, 0.7, f) : 1.0 - smoothstep(0.7, 0.82, f); }

#if PLAN == 0
// ── biped: 0 pelvis 1 chest 2 head 3/4 arm L 5/6 arm R 7/8 leg L 9/10 leg R ──
vec3 carryUpper(float tool, float side, float t) {
  if (tool == 5.0 || tool == 13.0) return vec3(-0.55, 0.0, -0.22 * side);              // a load held in front
  if (tool == 6.0) return side < 0.0 ? vec3(-0.35, 0.0, -0.55) : vec3(0.25 * sin(t), 0.0, 0.08); // logs on the right shoulder
  if (tool == 7.0) return side < 0.0 ? vec3(-2.75, 0.0, -0.25) : vec3(0.25 * sin(t), 0.0, 0.08); // a pot on the head
  if (tool == 12.0) return vec3(-0.1, 0.0, 0.12 * side);                                  // a bundle on the back
  return vec3(0.3 * side * sin(t), 0.0, 0.06 * side);
}
vec3 carryFore(float tool, float side) {
  if (tool == 5.0 || tool == 13.0) return vec3(-1.15, 0.0, 0.0);
  if (tool == 6.0) return side < 0.0 ? vec3(-2.3, 0.0, 0.0) : vec3(-0.3, 0.0, 0.0);
  if (tool == 7.0) return side < 0.0 ? vec3(-0.75, 0.0, 0.0) : vec3(-0.3, 0.0, 0.0);
  if (tool == 12.0) return vec3(-1.5, 0.0, 0.0);
  return vec3(-0.35, 0.0, 0.0);
}
vec3 jointRot(int a, float t, int b, float tool) {
  float s = sin(t), c = cos(t);
  vec3 r = vec3(0.0);
  if (a == 1 || a == 2 || a == 4 || a == 7 || a == 25) {
    bool fast = a == 2 || a == 7;
    // (a walking arm swings ±28°, the elbow bending as it comes forward; at ±18° with a straight elbow arms hung dead)
    float leg = fast ? 0.78 : 0.42, kneeA = fast ? 1.4 : 0.72, arm = fast ? 0.8 : 0.5;
    if (b == 7) r.x = -leg * s;
    if (b == 9) r.x = leg * s;
    if (b == 8) r.x = 0.06 + kneeA * pow(max(0.0, c), 1.5);
    if (b == 10) r.x = 0.06 + kneeA * pow(max(0.0, -c), 1.5);
    if (a == 4) {
      if (b == 3) r = carryUpper(tool, 1.0, t);
      if (b == 5) r = carryUpper(tool, -1.0, t + BPI);
      if (b == 4) r = carryFore(tool, 1.0);
      if (b == 6) r = carryFore(tool, -1.0);
    } else {
      if (b == 3) r = vec3(arm * s, 0.0, 0.07);
      if (b == 5) r = vec3(-arm * s, 0.0, -0.07);
      if (b == 4) r = vec3(-0.2 - (fast ? 1.1 : 0.16) - (fast ? 0.12 : 0.3) * max(0.0, -s) - 0.05 * s, 0.0, 0.0);
      if (b == 6) r = vec3(-0.2 - (fast ? 1.1 : 0.16) - (fast ? 0.12 : 0.3) * max(0.0, s) + 0.05 * s, 0.0, 0.0);
      if (a == 7 && (b == 3 || b == 5)) r.z += (b == 3 ? 0.5 : -0.5) * (0.6 + 0.4 * sin(t * 1.7));
    }
    if (b == 1) r = vec3(fast ? 0.24 : 0.05, 0.1 * s * (fast ? 1.0 : 0.6), 0.0);
    if (b == 2) r = vec3(-0.05 - (fast ? 0.15 : 0.0), -0.06 * s + (a == 7 ? 0.9 * sin(t * 0.37) : 0.0), 0.0);
    return r;
  }
  if (a == 3 || a == 15) {
    // work at a bench / build: hammering (build strikes higher), the other hand steadies
    float k = strike(t);
    float hi = a == 15 ? 1.0 : 0.0;
    if (b == 1) r = vec3(0.32 - 0.25 * hi + 0.06 * k, 0.1, 0.0);
    if (b == 5) r = vec3(-0.6 - 0.9 * hi - 1.2 * k, 0.0, -0.15);
    if (b == 6) r = vec3(-1.0 + 0.5 * k, 0.0, 0.0);
    if (b == 3) r = vec3(-0.75 - 0.6 * hi, 0.0, -0.15);
    if (b == 4) r = vec3(-0.9, 0.0, 0.0);
    if (b == 7 || b == 9) r.x = -0.25;
    if (b == 8 || b == 10) r.x = 0.4;
    if (b == 2) r = vec3(0.3 - 0.4 * hi, 0.0, 0.0);
    return r;
  }
  if (a == 16 || a == 17) {
    // chop (axe overhead) / dig (hoe): both hands on the haft, a raise and a hard fall; the back bends into it
    float k = strike(t);
    float dig = a == 17 ? 1.0 : 0.0;
    float up = mix(-0.35, -2.8 + 0.6 * dig, k);
    if (b == 3) r = vec3(up, 0.0, -0.35);
    if (b == 5) r = vec3(up, 0.0, 0.35);
    if (b == 4) r = vec3(-0.35 - 0.3 * k, 0.0, 0.0);
    if (b == 6) r = vec3(-0.25 - 0.3 * k, 0.0, 0.0);
    if (b == 1) r = vec3(mix(0.5 + 0.2 * dig, 0.0, k), 0.0, 0.0);
    if (b == 2) r = vec3(mix(0.2, -0.25, k), 0.0, 0.0);
    if (b == 7) r.x = -0.35; if (b == 9) r.x = 0.15;
    if (b == 8) r.x = 0.45; if (b == 10) r.x = 0.25;
    return r;
  }
  if (a == 18 || a == 25) {
    // fishing: the rod held up and out, a jerk now and then
    float j = pow(max(0.0, sin(t * 0.5)), 12.0);
    if (b == 5) r = vec3(-0.95 - 0.4 * j, 0.0, -0.1);
    if (b == 6) r = vec3(-0.5, 0.0, 0.0);
    if (b == 3) r = vec3(-0.8, 0.0, -0.4);
    if (b == 4) r = vec3(-0.9, 0.0, 0.0);
    if (b == 1) r = vec3(0.08, 0.0, 0.0);
    return r;
  }
  if (a == 5 || a == 24) {
    // kneeling prayer (a slow bow) / mourning (bowed, hands to the face)
    float bow = a == 5 ? 0.35 + 0.35 * (0.5 + 0.5 * sin(t)) : 0.75;
    if (b == 7 || b == 9) r.x = -0.12;
    if (b == 8 || b == 10) r.x = 1.62;
    if (b == 1) r = vec3(bow, 0.0, 0.0);
    if (b == 2) r = vec3(a == 5 ? 0.25 : 0.55, 0.0, 0.0);
    if (a == 5) {
      if (b == 3) r = vec3(-1.3 - 0.4 * (0.5 + 0.5 * sin(t)), 0.0, -0.32);
      if (b == 5) r = vec3(-1.3 - 0.4 * (0.5 + 0.5 * sin(t)), 0.0, 0.32);
      if (b == 4 || b == 6) r = vec3(-0.5, 0.0, 0.0);
    } else {
      if (b == 3) r = vec3(-0.85, 0.0, -0.3);
      if (b == 5) r = vec3(-0.85, 0.0, 0.3);
      if (b == 4 || b == 6) r = vec3(-2.1, 0.0, 0.0);
    }
    return r;
  }
  if (a == 20 || a == 14) {
    // sitting on the ground, legs forward and a little apart; eating brings a hand to the mouth
    if (b == 7) r = vec3(-1.45, 0.0, 0.22);
    if (b == 9) r = vec3(-1.45, 0.0, -0.22);
    if (b == 8 || b == 10) r.x = 1.0;
    if (b == 1) r = vec3(0.12 + 0.02 * s, 0.0, 0.0);
    if (b == 3) r = vec3(-0.5, 0.0, 0.1);
    if (b == 4) r = vec3(-0.7, 0.0, 0.0);
    if (a == 14) { if (b == 5) r = vec3(-0.6 - 0.25 * s, 0.0, -0.1); if (b == 6) r = vec3(-2.1 - 0.3 * s, 0.0, 0.0); }
    else { if (b == 5) r = vec3(-0.5, 0.0, -0.1); if (b == 6) r = vec3(-0.7, 0.0, 0.0); }
    if (b == 2) r = vec3(0.05, 0.25 * sin(t * 0.31), 0.0);
    return r;
  }
  if (a == 6) {
    // asleep on the side, knees drawn up, an arm under the head
    if (b == 7 || b == 9) r.x = -0.8;
    if (b == 8 || b == 10) r.x = 1.1;
    if (b == 3) r = vec3(-2.6, 0.0, 0.0);
    if (b == 4) r = vec3(-1.2, 0.0, 0.0);
    if (b == 5) r = vec3(-0.6, 0.0, 0.0);
    if (b == 6) r = vec3(-0.8, 0.0, 0.0);
    if (b == 1) r.x = 0.15 + 0.02 * s;
    if (b == 2) r.x = 0.2;
    return r;
  }
  if (a == 19 || a == 0 || a == 8 || a == 12) {
    // idle / teach (gesturing) / fight (stance and thrust) / held (dangling)
    if (a == 12) {
      if (b == 3) r = vec3(-2.9, 0.0, -0.2); if (b == 5) r = vec3(-2.9, 0.0, 0.2);
      if (b == 7) r.x = 0.3 * s; if (b == 9) r.x = -0.3 * s; if (b == 8 || b == 10) r.x = 0.3;
      return r;
    }
    if (a == 8) {
      float k = strike(t * 1.2);
      if (b == 5) r = vec3(-1.4 + 0.9 * k, 0.0, -0.2);
      if (b == 6) r = vec3(-0.9 + 0.8 * k, 0.0, 0.0);
      if (b == 3) r = vec3(-1.1, 0.0, -0.3); if (b == 4) r = vec3(-1.3, 0.0, 0.0);
      if (b == 7) r = vec3(-0.5, 0.0, 0.15); if (b == 9) r = vec3(0.3, 0.0, -0.15);
      if (b == 8) r.x = 0.5; if (b == 10) r.x = 0.3;
      if (b == 1) r = vec3(0.25, -0.3 + 0.2 * k, 0.0);
      return r;
    }
    float br = sin(t);
    float look = sin(t * 0.23) * 0.45 + sin(t * 0.61) * 0.12;
    if (b == 1) r = vec3(0.03 + 0.015 * br, 0.06 * sin(t * 0.17), 0.0);
    if (b == 2) r = vec3(0.04 + 0.05 * sin(t * 0.4), look, 0.0);
    if (b == 3) r = vec3(0.04 * br, 0.0, 0.1);
    if (b == 5) r = vec3(-0.04 * br, 0.0, -0.1);
    if (b == 4 || b == 6) r = vec3(-0.18, 0.0, 0.0);
    if (b == 7) r = vec3(0.02, 0.0, 0.04 + 0.03 * sin(t * 0.21));
    if (b == 9) r = vec3(-0.02, 0.0, -0.04 + 0.03 * sin(t * 0.21));
    if (b == 8 || b == 10) r.x = 0.04;
    if (a == 0) {
      // standers differ: hands clasped behind the back, arms folded, a hand on the hip, or hanging loose with the
      // weight on one leg (a crowd under a market hall stood as one identical wall)
      float v = fract(iAnim.w * 7.31 + 0.17);
      float shift = 0.06 * sin(t * 0.13 + iAnim.w * 9.0);
      if (b == 0 || b == 1) r.z += shift * (b == 0 ? 1.0 : -0.6);
      if (v < 0.28) {
        if (b == 3) r = vec3(0.35, 0.0, 0.18); if (b == 5) r = vec3(0.35, 0.0, -0.18);
        if (b == 4 || b == 6) r = vec3(-1.2, 0.0, 0.0);
      } else if (v < 0.52) {
        if (b == 3) r = vec3(-0.35, -0.35, -0.12); if (b == 5) r = vec3(-0.35, 0.35, 0.12);
        if (b == 4) r = vec3(-1.75, 0.0, 0.0); if (b == 6) r = vec3(-1.65, 0.0, 0.0);
      } else if (v < 0.72) {
        if (b == 3) r = vec3(0.05, 0.0, 0.55); if (b == 4) r = vec3(-1.55, 0.0, 0.0);
        if (b == 7) r.z += 0.06; if (b == 9) r.z += 0.06;
      }
    }
    if (a == 19) {
      // talking with the hands, nodding
      if (b == 5) r = vec3(-0.9 + 0.35 * sin(t * 1.3), 0.0, -0.35 + 0.15 * sin(t * 0.7));
      if (b == 6) r = vec3(-0.9 - 0.3 * sin(t * 1.3 + 1.0), 0.0, 0.0);
      if (b == 3) r = vec3(-0.35 + 0.2 * sin(t * 0.9), 0.0, 0.25);
      if (b == 4) r = vec3(-0.9, 0.0, 0.0);
      if (b == 2) r.x += 0.12 * sin(t * 2.1);
    }
    return r;
  }
  if (a == 9 || a == 21) {
    // dance (arms swaying overhead, hips swinging, stepping) / cheer (both arms up, jumping)
    if (a == 21) {
      float k = 0.5 + 0.5 * sin(t);
      if (b == 3) r = vec3(-2.7 - 0.25 * k, 0.0, -0.35); if (b == 5) r = vec3(-2.7 - 0.25 * k, 0.0, 0.35);
      if (b == 4 || b == 6) r = vec3(-0.3 - 0.4 * k, 0.0, 0.0);
      if (b == 7 || b == 9) r.x = -0.2 * k; if (b == 8 || b == 10) r.x = 0.4 * k;
      if (b == 2) r.x = -0.25;
      return r;
    }
    if (b == 3) r = vec3(-1.6 - 0.6 * sin(t), 0.0, 0.5 + 0.3 * sin(t * 2.0));
    if (b == 5) r = vec3(-1.6 + 0.6 * sin(t), 0.0, -0.5 - 0.3 * sin(t * 2.0));
    if (b == 4 || b == 6) r = vec3(-0.6, 0.0, 0.0);
    if (b == 7) r.x = -0.45 * max(0.0, s); if (b == 9) r.x = -0.45 * max(0.0, -s);
    if (b == 8) r.x = 0.8 * max(0.0, s); if (b == 10) r.x = 0.8 * max(0.0, -s);
    if (b == 1) r = vec3(0.05, 0.2 * s, 0.12 * sin(t * 2.0));
    return r;
  }
  if (a == 10) {
    // swimming: crawl strokes, flutter kick (the root lays the body flat)
    if (b == 3) r = vec3(-t, 0.0, -0.2); if (b == 5) r = vec3(-t - BPI, 0.0, 0.2);
    if (b == 7) r.x = 0.25 * sin(t * 3.0); if (b == 9) r.x = -0.25 * sin(t * 3.0);
    if (b == 2) r.x = -0.6;
    return r;
  }
  if (a == 11) {
    if (b == 3) r = vec3(-1.4, 0.0, 0.6); if (b == 5) r = vec3(-0.4, 0.0, -0.9);
    if (b == 7) r = vec3(-0.2, 0.0, 0.25); if (b == 9) r = vec3(0.1, 0.0, -0.15);
    if (b == 2) r = vec3(0.0, 0.6, 0.0);
    return r;
  }
  if (a == 13) {
    if (b == 3) r = vec3(-2.5 + sin(t * 2.0), 0.0, -0.6); if (b == 5) r = vec3(-2.0 + sin(t * 2.3), 0.0, 0.6);
    if (b == 7) r.x = -0.8 * sin(t * 1.7); if (b == 9) r.x = 0.8 * sin(t * 1.7);
    return r;
  }
  return r;
}
void rootPose(int a, float t, out vec3 off, out vec3 rot) {
  off = vec3(0.0); rot = vec3(0.0);
  float s = sin(t), c = cos(t);
  if (a == 1 || a == 4 || a == 25) { off.y = 0.022 * cos(2.0 * t) - 0.012; off.x = 0.012 * s; }
  else if (a == 2 || a == 7) { off.y = 0.05 * abs(s) - 0.035; }
  else if (a == 3 || a == 15 || a == 16 || a == 17) off.y = -0.05;
  else if (a == 5 || a == 24) { off.y = -0.47; off.z = -0.06; }
  else if (a == 20 || a == 14) off.y = -0.74;
  else if (a == 6) { rot.z = 1.52; off = vec3(0.12, -0.78, 0.0); }
  else if (a == 11) { rot.x = -1.52; off = vec3(0.0, -0.82, 0.0); }
  else if (a == 10) { rot.x = 1.45; off = vec3(0.0, -0.78, 0.0); }
  else if (a == 9) { off.y = 0.045 * abs(s); rot.y = 0.7 * sin(t * 0.5); }
  else if (a == 21) off.y = 0.06 * max(0.0, s);
  else if (a == 13) rot = vec3(t * 2.0, 0.0, t * 1.3);
  else off.x = 0.01 * sin(t * 0.37);
}
#endif

#if PLAN == 1
// ── hexapod (the hive): 0 thorax 1 abdomen 2 head 3/4 arm L 5/6 arm R 7 FL 8 FR 9 BL 10 BR 11 antennae ──
vec3 jointRot(int a, float t, int b, float tool) {
  float s = sin(t);
  vec3 r = vec3(0.0);
  bool moving = a == 1 || a == 2 || a == 4 || a == 7;
  float amp = (a == 2 || a == 7) ? 0.6 : 0.38;
  if (b >= 7 && b <= 10) {
    // alternating pairs (FL+BR, FR+BL): swing about the vertical, lift on the return stroke
    float ph = (b == 7 || b == 10) ? 0.0 : BPI;
    float side = (b == 7 || b == 9) ? 1.0 : -1.0;
    if (moving) { r.y = amp * sin(t + ph); r.z = side * 0.3 * max(0.0, cos(t + ph)); }
    if (a == 6 || a == 11) r.z = side * -0.6;
    return r;
  }
  if (b == 1) r = vec3(0.05 * sin(t * 0.5), 0.12 * sin(t * 0.5 + 1.0), 0.0);
  if (b == 2) r = vec3(0.05, 0.4 * sin(t * 0.21), 0.0);
  if (b == 11) r = vec3(0.25 * sin(t * 3.1), 0.15 * sin(t * 2.3), 0.0);
  if (a == 3 || a == 15 || a == 17 || a == 16) {
    float k = strike(t);
    if (b == 3) r = vec3(-0.6 - 1.0 * k, 0.0, -0.2); if (b == 5) r = vec3(-0.6 - 1.0 * strike(t + 1.6), 0.0, 0.2);
    if (b == 4 || b == 6) r = vec3(-0.8, 0.0, 0.0);
    if (b == 0) r = vec3(0.2, 0.0, 0.0);
  } else if (a == 4) {
    if (b == 3 || b == 5) r = vec3(-0.7, 0.0, 0.0); if (b == 4 || b == 6) r = vec3(-1.2, 0.0, 0.0);
  } else if (a == 5) {
    if (b == 3 || b == 5) r = vec3(-2.4, 0.0, 0.0); if (b == 2) r.x = 0.5;
  } else if (moving) {
    if (b == 3) r = vec3(0.3 * s, 0.0, 0.1); if (b == 5) r = vec3(-0.3 * s, 0.0, -0.1);
    if (b == 4 || b == 6) r = vec3(-0.6, 0.0, 0.0);
  } else {
    if (b == 3 || b == 5) r = vec3(-0.25 + 0.05 * s, 0.0, 0.0); if (b == 4 || b == 6) r = vec3(-0.7, 0.0, 0.0);
  }
  return r;
}
void rootPose(int a, float t, out vec3 off, out vec3 rot) {
  off = vec3(0.0); rot = vec3(0.0);
  if (a == 1 || a == 2 || a == 4 || a == 7) off.y = 0.015 * sin(t * 2.0);
  if (a == 6 || a == 11) off.y = -0.4;
  if (a == 5) rot.x = 0.4;
}
#endif

#if PLAN == 2
// ── drifter: 0 bell, 1..8 tentacles ──
vec3 jointRot(int a, float t, int b, float tool) {
  if (b == 0) return vec3(0.04 * sin(t * 0.5), 0.0, 0.04 * cos(t * 0.37));
  float k = float(b);
  return vec3(0.22 * sin(t + k * 0.8), 0.0, 0.18 * cos(t * 0.7 + k));
}
void rootPose(int a, float t, out vec3 off, out vec3 rot) { off = vec3(0.0, 0.12 * sin(t * 0.5), 0.0); rot = vec3(0.0); }
#endif

#if PLAN == 3
// ── quadruped: 0 body 1 neck 2 head 3 tail 4/5 FL 6/7 FR 8/9 BL 10/11 BR ──
vec3 jointRot(int a, float t, int b, float tool) {
  vec3 r = vec3(0.0);
  float s = sin(t);
  bool walk = a == 1 || a == 4;
  bool run = a == 2 || a == 7;
  if (walk || run) {
    float amp = run ? 0.65 : 0.36;
    // walk: lateral sequence (diagonal pairs offset); run: a gallop with the front and hind pairs out of phase
    float ph = 0.0;
    if (b == 4 || b == 5) ph = 0.0;
    if (b == 6 || b == 7) ph = run ? 0.35 : BPI;
    if (b == 8 || b == 9) ph = run ? BPI : BPI * 1.5;
    if (b == 10 || b == 11) ph = run ? BPI + 0.35 : BPI * 0.5;
    float u = t + ph;
    if (b == 4 || b == 6) r.x = -amp * sin(u);
    if (b == 8 || b == 10) r.x = -amp * sin(u) * 0.9;
    if (b == 5 || b == 7) r.x = (run ? 1.1 : 0.7) * max(0.0, cos(u));
    if (b == 9 || b == 11) r.x = -(run ? 0.9 : 0.55) * max(0.0, cos(u));
    if (b == 1) r.x = 0.06 * sin(2.0 * t) - (run ? 0.25 : 0.0);
    if (b == 3) r = vec3(-0.2, 0.25 * sin(t), 0.0);
    return r;
  }
  if (a == 22 || a == 14) {
    // grazing: the head down at the grass, a chewing nod, the tail swishing, now and then a step
    if (b == 1) r.x = 1.05 + 0.05 * sin(t * 2.0);
    if (b == 2) r.x = 0.45 + 0.1 * sin(t * 3.1);
    if (b == 3) r = vec3(-0.1, 0.35 * sin(t * 0.7), 0.0);
    if (b == 4) r.x = -0.12 * max(0.0, sin(t * 0.2));
    return r;
  }
  if (a == 6 || a == 11) {
    // lying down, legs folded under (asleep) / on its side (dead: the root rolls it over)
    if (b == 4 || b == 6) r.x = -1.3; if (b == 5 || b == 7) r.x = 2.2;
    if (b == 8 || b == 10) r.x = 1.25; if (b == 9 || b == 11) r.x = -2.2;
    if (b == 1) r.x = a == 6 ? 0.6 : 0.2;
    if (b == 2) r = vec3(a == 6 ? 0.4 : 0.0, a == 6 ? 0.9 : 0.0, 0.0);
    return r;
  }
  if (a == 8) {
    float k = strike(t);
    if (b == 1) r.x = 0.4 + 0.5 * k; if (b == 2) r.x = 0.3;
    if (b == 4 || b == 6) r.x = -0.4 * k;
    return r;
  }
  // idle: head up, looking around; tail swish; ears
  if (b == 1) r = vec3(-0.12 + 0.05 * sin(t * 0.5), 0.35 * sin(t * 0.23), 0.0);
  if (b == 2) r = vec3(0.1 * sin(t * 0.7), 0.15 * sin(t * 0.4), 0.0);
  if (b == 3) r = vec3(-0.05, 0.3 * sin(t * 0.9), 0.0);
  return r;
}
void rootPose(int a, float t, out vec3 off, out vec3 rot) {
  off = vec3(0.0); rot = vec3(0.0);
  if (a == 1 || a == 4) off.y = 0.015 * cos(2.0 * t);
  if (a == 2 || a == 7) { off.y = 0.06 * abs(sin(t)); rot.x = 0.07 * sin(t); }
  if (a == 6) off.y = -0.42;
  if (a == 11) { rot.z = 1.45; off = vec3(0.0, -0.28, 0.0); }
}
#endif

#if PLAN == 4
// ── bird: 0 body 1 head 2/3 wing L 4/5 wing R 6 tail ──
vec3 jointRot(int a, float t, int b, float tool) {
  vec3 r = vec3(0.0);
  if (a == 23) {
    // flap-flap-glide: the wingbeat fades in and out over a slow envelope
    float env = 0.35 + 0.65 * smoothstep(-0.3, 0.6, sin(t * 0.17));
    float f = sin(t) * env;
    float g = sin(t - 0.7) * env;
    if (b == 2) r.z = 0.9 * f + 0.1; if (b == 4) r.z = -0.9 * f - 0.1;
    if (b == 3) r.z = 0.5 * g; if (b == 5) r.z = -0.5 * g;
    if (b == 1) r.x = -0.05;
    if (b == 6) r.x = 0.08 * sin(t * 0.3);
    return r;
  }
  // perched / walking: wings folded back along the body, the head bobbing and pecking
  if (b == 2) r = vec3(0.0, 1.45, -1.2); if (b == 4) r = vec3(0.0, -1.45, 1.2);
  if (b == 3) r = vec3(0.0, 1.3, 0.0); if (b == 5) r = vec3(0.0, -1.3, 0.0);
  if (b == 1) r.x = (a == 22 || a == 14) ? 0.9 * max(0.0, sin(t * 2.0)) : 0.1 * sin(t * 0.6);
  if (b == 0) r.x = (a == 1) ? 0.1 * sin(t * 2.0) : 0.0;
  return r;
}
void rootPose(int a, float t, out vec3 off, out vec3 rot) {
  off = vec3(0.0); rot = vec3(0.0);
  if (a == 23) { off.y = 0.04 * sin(t); rot.z = 0.15 * sin(t * 0.13); }
  else off.y = -0.0;
}
#endif

#if PLAN == 5
// ── fish / whale: a travelling wave toward the tail (a yaw wave; whales pitch) ──
vec3 jointRot(int a, float t, int b, float tool) {
  float k = float(b);
  float w = (0.12 + 0.12 * k) * sin(t - k * 0.8);
  return uPitchSwim > 0.5 ? vec3(w * 0.6, 0.0, 0.0) : vec3(0.0, w, 0.0);
}
void rootPose(int a, float t, out vec3 off, out vec3 rot) { off = vec3(0.0); rot = vec3(0.0); }
#endif

#if PLAN == 6
vec3 jointRot(int a, float t, int b, float tool) { return b == 1 ? vec3(0.0, 0.0, 0.7 * sin(t * 13.0)) : vec3(0.0); }
void rootPose(int a, float t, out vec3 off, out vec3 rot) { off = vec3(0.0); rot = vec3(0.0, 0.0, 0.3 * sin(t * 0.7)); }
#endif

#if PLAN == 7
vec3 jointRot(int a, float t, int b, float tool) {
  if (b == 1) return vec3(0.0, 0.0, 0.45 * sin(t));
  if (b == 2) return vec3(0.0, 0.0, -0.45 * sin(t));
  if (b == 3) return vec3(0.1 * sin(t - 1.0), 0.15 * sin(t * 0.5), 0.0);
  return vec3(0.0);
}
void rootPose(int a, float t, out vec3 off, out vec3 rot) { off = vec3(0.0, 0.1 * sin(t - 0.5), 0.0); rot = vec3(0.05 * sin(t - 1.5), 0.0, 0.0); }
#endif

// pose one point / normal through bone b's chain, the two states' joint angles blended per bone (and the root's
// offset and rotation lerped) before posing once. (Mixing two fully posed positions collapsed a body changing between
// upright and lying or sitting: mid-blend a person lay flat a metre above the ground.)
vec3 poseChain(int b, vec3 p, inout vec3 n, int aA, float tA, int aB, float tB, float w, float tool, float childHead) {
  bool both = w < 0.999;
  for (int k = 0; k < 6; k++) {
    if (b < 0) break;
    vec3 piv = uPivot[b];
#if PLAN == 0
    if (b == 2 && childHead > 0.5) p = piv + (p - piv) * 1.22;
#endif
#if PLAN == 2
    if (b == 0) p.xz *= 1.0 + 0.07 * sin(w >= 0.5 ? tA : tB);
#endif
    vec3 e = jointRot(aA, tA, b, tool);
    if (both) e = mix(jointRot(aB, tB, b, tool), e, w);
    p = rotE(p - piv, e) + piv;
    n = rotE(n, e);
    b = uParent[b];
  }
  vec3 off, rot;
  rootPose(aA, tA, off, rot);
  if (both) {
    vec3 offB, rotB;
    rootPose(aB, tB, offB, rotB);
    off = mix(offB, off, w);
    rot = mix(rotB, rot, w);
  }
  vec3 rp = uPivot[0];
  p = rotE(p - rp, rot) + rp + off;
  n = rotE(n, rot);
  return p;
}

// the two states blended (a quarter-second ease on a change)
vec3 posed(int b, vec3 p, inout vec3 n) {
  int aA = int(iAnim.x + 0.5), aB = int(iAnim.y + 0.5);
  float speed = max(iStyle.z, 0.05) * uFreqK;
  float tA = uAnimTime * animFreq(aA) * speed * 6.2831853 + iAnim.w * 6.2831853;
  float tB = uAnimTime * animFreq(aB) * speed * 6.2831853 + iAnim.w * 6.2831853;
  float child = mod(floor(iStyle.x / 512.0), 2.0);
  vec3 q = poseChain(b, p, n, aA, tA, aB, tB, iAnim.z, iStyle.y, child);
  n = normalize(n);
  return q;
}

// selection: hair / clothing / hat / beard / tool per instance (a hidden vertex collapses)
bool bodyVisible() {
  int st = int(iStyle.x + 0.5);
  int req = int(aSel.x + 0.5), forbid = int(aSel.y + 0.5);
  if (req != 0 && (st & req) == 0) return false;
  if ((st & forbid) != 0) return false;
  if (aSel.z > 0.5 && abs(aSel.z - iStyle.y) > 0.5) return false;
  return true;
}
`;

const VERT_BEGIN = /* glsl */ `
  vec3 bodyN = objectNormal;
  vec3 transformed = vec3(0.0, -1000.0, 0.0);
  // hidden parts (other hair styles, clothing tiers, tools) collapse before any posing work
  if (bodyVisible()) {
    int b0 = int(aRig.x + 0.5), b1 = int(aRig.y + 0.5);
    vec3 n0 = objectNormal;
    vec3 p0 = posed(b0, position, n0);
    if (aRig.z < 0.999 && b1 != b0) {
      vec3 n1 = objectNormal;
      vec3 p1 = posed(b1, position, n1);
      transformed = mix(p1, p0, aRig.z);
      bodyN = normalize(mix(n1, n0, aRig.z));
    } else { transformed = p0; bodyN = n0; }
  }
`;

const VERT_PARS = /* glsl */ `
${BODY_ANIM_GLSL}
attribute vec3 iColA;
attribute vec3 iColB;
attribute vec3 iColC;
attribute float iFade;
varying float vFade;
varying vec3 vBodyPos;
varying vec3 vColA;
varying vec3 vColB;
varying vec3 vColC;
varying float vPart;
varying float vAO;
varying vec3 vLocal;
varying float vStyle;
`;

const FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
${MOON_PARS}uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec3 uNightAmbient;
uniform float uTime;
varying vec3 vBodyPos;
varying vec3 vColA;
varying vec3 vColB;
varying vec3 vColC;
varying float vPart;
varying float vAO;
varying vec3 vLocal;
varying float vStyle;
varying float vFade;
float bodyCloudShadow(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  return max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
}
`;

const FRAG_SURFACE = /* glsl */ `
  // LOD cross-fade (crowds.ts / animals.ts): the two LODs share the pixels of a screen-space dither across the band
  if (vFade < 0.999) {
    float hd = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vFade >= 0.0 ? hd >= vFade : hd < 1.0 + vFade) discard;
  }
  int part = int(vPart + 0.5);
  int st = int(vStyle + 0.5);
  float fwL = length(fwidth(vLocal));
  float detail = 1.0 - smoothstep(0.004, 0.02, fwL);
  vec3 alb = vec3(0.5);
  float bRough = 0.8, bMetal = 0.0;
  vec3 bEmit = vec3(0.0);
  float skinK = 0.0;
  if (part == 0) {
    // skin: a little less saturated than the palette (with the grade's saturation it read as flat orange plasticine),
    // matte with a soft sheen, and alive — blood under the cheeks, nose, ears, knuckles and knees, paler palms
    float sl = dot(vColB, vec3(0.2126, 0.7152, 0.0722));
    alb = mix(vec3(sl), vColB, 0.8) * (0.95 + 0.08 * fbm3(vLocal * 45.0) * detail);
#if PLAN == 0
    float face = smoothstep(0.07, 0.0, abs(vLocal.y - 1.6)) * smoothstep(0.03, 0.065, abs(vLocal.x)) * smoothstep(0.04, 0.08, vLocal.z);
    float nose = smoothstep(0.03, 0.0, length(vLocal - vec3(0.0, 1.6, 0.115)));
    float ear = smoothstep(0.03, 0.0, length(vec3(abs(vLocal.x) - 0.088, vLocal.y - 1.625, vLocal.z)));
    float hand = smoothstep(0.06, 0.0, length(vec3(abs(vLocal.x) - 0.233, vLocal.y - 0.79, vLocal.z - 0.022)));
    float knee = smoothstep(0.06, 0.0, length(vec3(abs(vLocal.x) - 0.1, vLocal.y - 0.5, vLocal.z - 0.05)));
    float flush = max(max(face * 0.8, nose), max(ear, max(hand * 0.6, knee * 0.5)));
    alb *= mix(vec3(1.0), vec3(1.1, 0.88, 0.84), flush);
    // palms (the inner side of the hand) paler
    alb = mix(alb, alb * vec3(1.12, 1.05, 1.0), hand * smoothstep(0.0, -0.01, sign(vLocal.x) * (vLocal.x - sign(vLocal.x) * 0.233)) * 0.6);
#endif
    bRough = 0.68; skinK = 1.0;
  }
  else if (part == 1 || part == 13) {
    // cloth: hides are mottled, woven cloth has a weave, tailored coats are darker wool
#if PLAN == 0
    vec3 base = part == 13 ? vColA * 0.55 : vColA;
#else
    vec3 base = part == 13 ? vColB : vColA;
#endif
    float weave = sin(vLocal.x * 900.0) * sin(vLocal.y * 900.0 + vLocal.z * 600.0);
    float mott = fbm3(vLocal * 22.0);
    alb = base * (0.9 + 0.08 * weave * detail + 0.12 * mott);
    bRough = 0.9;
#if PLAN == 0
    if ((st & 4) != 0 && (st & (8 | 16 | 32)) == 0) alb = vec3(0.3, 0.2, 0.12) * (0.75 + 0.4 * mott);
#endif
  }
  else if (part == 2) {
    // the dyed trim / trousers: a darker, less saturated companion of the main colour
    float l = dot(vColA, vec3(0.3, 0.55, 0.15));
    alb = mix(vColA * 0.45, vec3(l) * 0.5, 0.45) * (0.92 + 0.1 * fbm3(vLocal * 30.0));
    bRough = 0.9;
  }
  else if (part == 3) { alb = vColC * (0.85 + 0.3 * abs(snoise(vec3(vLocal.x * 120.0, vLocal.y * 30.0, vLocal.z * 120.0))) * detail); bRough = 0.6; }
  else if (part == 4) { alb = vec3(0.012, 0.01, 0.01); bRough = 0.3; }
  else if (part == 5) { alb = vec3(0.17, 0.1, 0.05) * (0.85 + 0.25 * snoise(vLocal * vec3(8.0, 60.0, 8.0))); bRough = 0.75; }
  else if (part == 6) { alb = vec3(0.32, 0.31, 0.3); bRough = 0.38; bMetal = 0.75; }
  else if (part == 7 || part == 17) { alb = vec3(0.42, 0.32, 0.14) * (0.8 + 0.3 * sin(vLocal.y * 240.0 + sin(vLocal.x * 200.0))); bRough = 0.9; }
  else if (part == 8) { alb = vec3(0.1, 0.06, 0.035); bRough = 0.65; }
  else if (part == 9) {
#if PLAN == 0
    // fur: a hide cape (people) or the cold folk's own pelt
    vec3 fc = (st & 4) != 0 ? vec3(0.32, 0.23, 0.14) : vColC;
#else
    vec3 fc = vColB;
#endif
    alb = fc * (0.7 + 0.45 * fbm3(vLocal * 40.0)); bRough = 0.95;
  }
  else if (part == 10) { alb = vColB * (0.8 + 0.3 * fbm3(vLocal * 8.0)); bRough = 0.32; }
  else if (part == 11) { alb = vec3(0.72, 0.7, 0.66); bRough = 0.25; }
  else if (part == 12) { float f = 0.7 + 0.3 * snoise(vLocal * 30.0 + vec3(0.0, -uTime * 4.0, 0.0)); bEmit = vec3(6.0, 2.2, 0.5) * f; alb = vec3(0.0); }
  else if (part == 14) { alb = vColC; bRough = 0.85; }
  else if (part == 15) { alb = vec3(0.3, 0.26, 0.2); bRough = 0.5; }
  else if (part == 16) { bEmit = mix(vColA, vec3(1.0, 0.8, 0.9), 0.4) * (1.6 + 0.6 * sin(uTime * 1.3)); alb = vColA * 0.2; }
  else if (part == 18) { alb = vec3(0.42, 0.19, 0.08) * (0.9 + 0.1 * snoise(vLocal * 40.0)); bRough = 0.7; }
  else if (part == 19) { alb = vec3(0.3, 0.29, 0.27) * (0.85 + 0.2 * snoise(vLocal * 30.0)); bRough = 0.85; }
#if PLAN == 3 || PLAN == 4 || PLAN == 5 || PLAN == 6 || PLAN == 7
  // animals: the coat is the base colour, with a darker back stripe and lighter flanks
  if (part == 13 || part == 1) { alb = vColB * (0.82 + 0.25 * fbm3(vLocal * 9.0)); bRough = 0.85; }
  if (part == 9) { alb = mix(vColB, vec3(0.75, 0.72, 0.66), 0.55) * (0.75 + 0.35 * fbm3(vLocal * 30.0)); }
  if (part == 3) alb = vColB * 0.45;
#endif
  alb *= vAO;
  diffuseColor.rgb = alb;
`;

const FRAG_LIGHT = /* glsl */ `
  {
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    float sh = sunShadow(-vViewPosition, normal);
    vec3 sunCol = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh * bodyCloudShadow(vBodyPos, uSunDirBody);
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    ${moonDirect('vBodyPos', '1.0')}
    // skin lets light in: a warm wrap term (subsurface approximation) on the terminator
    if (skinK > 0.5) {
      float wrap = max(0.0, dot(geometryNormal, uSunDirView) * 0.5 + 0.5) - max(0.0, dot(geometryNormal, uSunDirView));
      reflectedLight.directDiffuse += sunCol * diffuseColor.rgb * vec3(1.0, 0.45, 0.3) * wrap * 0.35;
    }
  }
`;

const FRAG_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    vec3 nB = normalize(transpose(uBodyToView) * normal);
    iblIrradiance += (skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient) * mix(0.7, 1.0, max(0.0, dot(nB, upB)) * 0.5 + 0.5);
  }
`;

export interface BodyMaterialOpts { plan: number; rig: Rig; freqK?: number; pitchSwim?: boolean }

function rigUniforms(rig: Rig, opts: BodyMaterialOpts): Record<string, IUniform> {
  const piv: Vector3[] = [];
  const par: number[] = [];
  for (let i = 0; i < 16; i++) {
    const p = rig.pivots[i] ?? [0, 0, 0];
    piv.push(new Vector3(p[0], p[1], p[2]));
    par.push(i < rig.parents.length ? rig.parents[i] : -1);
  }
  return { uPivot: { value: piv }, uParent: { value: par }, uFreqK: { value: opts.freqK ?? 1 }, uPitchSwim: { value: opts.pitchSwim ? 1 : 0 } };
}

/** the body material for one mesh (rig uniforms are per mesh; programs are shared per plan) */
export function makeBodyMaterial(shared: Record<string, IUniform>, animTime: IUniform, opts: BodyMaterialOpts): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: opts.plan >= 4 ? DoubleSide : FrontSide });
  const rigU = rigUniforms(opts.rig, opts);
  mat.defines = { PLAN: opts.plan };
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    for (const k of Object.keys(rigU)) shader.uniforms[k] = rigU[k];
    shader.uniforms.uAnimTime = animTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(normal);\n${VERT_BEGIN}\n  objectNormal = bodyN;`)
      .replace('#include <begin_vertex>', '')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vBodyPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  vColA = iColA; vColB = iColB; vColC = iColC;
  vPart = aRig.w; vAO = aSel.w; vLocal = position; vStyle = iStyle.x; vFade = 1.0 - iFade;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bMetal;')
      // a skinned normal can turn away from the eye where a joint bends hard (blended between two bones): reflected
      // back toward the viewer it shades as the surface it is, instead of a pale Fresnel glow on a bent shin or hem
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  { vec3 vv = normalize(vViewPosition); float nv = dot(normal, vv); if (nv < 0.0) normal = normalize(normal - 1.05 * nv * vv); }')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = bEmit;')
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${FRAG_LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_AMBIENT}`);
  };
  mat.customProgramCacheKey = () => `genesis-body-v1-${opts.plan}`;
  return mat;
}

const DEPTH_VERT = /* glsl */ `
#include <common>
${BODY_ANIM_GLSL}
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 objectNormal = vec3(normal);
${VERT_BEGIN}
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const DEPTH_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
  gl_FragColor = vec4(1.0);
}
`;

/** shadow caster with the same pose */
export function makeBodyDepthMaterial(animTime: IUniform, opts: BodyMaterialOpts): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, defines: { PLAN: opts.plan },
    uniforms: { ...rigUniforms(opts.rig, opts), uAnimTime: animTime }, colorWrite: false, side: DoubleSide,
  });
}

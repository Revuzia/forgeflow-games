// GENESIS — photo mode (CONTRACT.md §15.8, §15.2 "Photo mode adds DOF and filters"): a free camera, the lens, depth of
// field, and the picture.
//
//   PhotoCamera  6DoF from wherever the view was (drag looks, W A S D moves, R / F rise and sink, Q / E turn, the wheel
//                dollies; slow and smooth, faster with Shift and with altitude), with roll and focal length from the lens.
//   PHOTO        the lens the interface edits (src/ui/photo.ts through RenderCameraModes.lens): exposure, focal length,
//                focus distance, blur, roll, bloom, vignette, grain (the colour filters and the frame are the panel's).
//   PhotoPost    real depth of field from the depth buffer: a thin-lens circle of confusion (∝ |z − focus| / z, up to a
//                blur-scaled share of the frame), gathered over a 48-tap golden-angle disc on the composited HDR image
//                before bloom (so blurred highlights bloom into soft bokeh); the far field does not bleed over a sharp
//                subject, the near field does bleed over the background (as a lens does); brighter samples weigh more (the
//                bokeh discs read).
//   capturePhoto the picture at up to 4K (3840 × 2160) by render-target supersampling: the canvas is resized to the
//                picture, the internal resolution scaled by the supersample factor, a few frames rendered (the clouds'
//                and reflections' history refill), the canvas read, everything put back.

import { HalfFloatType, LinearFilter, RGBAFormat, Vector2, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three';
import type { WorldView } from '../../client/worldview.ts';
import { qMul, qRotate, qRotateInv, type D3, type DQ } from '../../client/orbits.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import type { CameraPose } from '../frame.ts';
import { nearestPlanet } from '../frame.ts';
import { FullscreenQuad, passMaterial } from '../post/fsquad.ts';
import type { PostSettings } from '../post/pipeline.ts';
import { basisQuat, norm3, surfaceRadius, type CameraController, type InputState } from './common.ts';

/** the lens (degrees, metres, stops, 0..1); mirrors src/ui/host.ts PhotoLens */
export interface Lens {
  exposure: number;
  fov: number;
  focus: number;
  blur: number;
  filter: string;
  frame: string;
  guides: string;
  bloom: number;
  vignette: number;
  grain: number;
  roll: number;
}

export const PHOTO: { on: boolean; lens: Lens } = {
  on: false,
  lens: { exposure: 0, fov: 50, focus: 220, blur: 0, filter: 'none', frame: 'free', guides: 'none', bloom: 1, vignette: 0.22, grain: 0.02, roll: 0 },
};

// ───────────────────────────── the camera ─────────────────────────────

export class PhotoCamera implements CameraController {
  readonly mode = 'photo' as const;
  planet = 0;
  /** body-frame position (m) of `planet` */
  pos: D3 = [0, 3100, 0];
  yaw = 0;
  pitch = 0;
  roll = 0;
  fov = 50;
  private vel: D3 = [0, 0, 0];

  /** start from a pose (keeps exactly what the view was) */
  from(pose: CameraPose, view: WorldView): void {
    const pv = (pose.planet >= 0 ? view.planet(pose.planet) : null) ?? nearestPlanet(view.planets, pose.pos);
    if (!pv) return;
    this.planet = pv.id;
    const rel: D3 = [pose.pos[0] - pv.center[0], pose.pos[1] - pv.center[1], pose.pos[2] - pv.center[2]];
    this.pos = qRotateInv(pv.quat, rel);
    const fwdS = qRotate(pose.quat, [0, 0, -1]);
    const fwd = qRotateInv(pv.quat, fwdS);
    const up = norm3([this.pos[0], this.pos[1], this.pos[2]]);
    const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0];
    tangentBasis(e, n, up);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2])));
    this.yaw = Math.atan2(fwd[0] * e[0] + fwd[1] * e[1] + fwd[2] * e[2], fwd[0] * n[0] + fwd[1] * n[1] + fwd[2] * n[2]);
    this.fov = pose.fov;
    this.vel = [0, 0, 0];
  }

  /** place at a latitude / longitude, height over the ground, heading and pitch (degrees) */
  at(view: WorldView, planet: number, latDeg: number, lonDeg: number, alt: number, yawDeg: number, pitchDeg: number): void {
    const pv = view.planet(planet) ?? view.planets[0];
    if (!pv) return;
    this.planet = pv.id;
    const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
    const d: D3 = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    const g = surfaceRadius(pv, d) + alt;
    this.pos = [d[0] * g, d[1] * g, d[2] * g];
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.vel = [0, 0, 0];
  }

  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void {
    const pv = view.planet(this.planet) ?? view.planets[0];
    if (!pv) return;
    this.planet = pv.id;
    const r = Math.hypot(this.pos[0], this.pos[1], this.pos[2]);
    const up: D3 = [this.pos[0] / r, this.pos[1] / r, this.pos[2] / r];
    const ground = surfaceRadius(pv, up);
    const alt = Math.max(0.3, r - ground);
    // look (slower than the fly camera: framing is fine work)
    this.yaw += (input.dragL[0] + input.dragR[0]) * 0.0022 * (this.fov / 50);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - (input.dragL[1] + input.dragR[1]) * 0.0022 * (this.fov / 50)));
    const k = input.keys;
    if (k.has('KeyQ')) this.yaw -= dt * 0.6;
    if (k.has('KeyE')) this.yaw += dt * 0.6;
    this.fov = PHOTO.lens.fov;
    this.roll = (PHOTO.lens.roll * Math.PI) / 180;
    const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0];
    tangentBasis(e, n, up);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd: D3 = [0, 0, 0], rgt: D3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) { const h = n[i] * cy + e[i] * sy; fwd[i] = h * cp + up[i] * sp; rgt[i] = e[i] * cy - n[i] * sy; }
    // move: smooth (eased velocity), speed ∝ altitude
    const speed = Math.max(1.2, alt * 0.8) * (input.shift ? 4 : 1);
    let mx = 0, my = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyR')) my += 1;
    if (k.has('KeyF')) my -= 1;
    mz -= input.wheel * 0.004;
    const want: D3 = [0, 1, 2].map((i) => (fwd[i] * mz + rgt[i] * mx + up[i] * my) * speed) as D3;
    const kk = 1 - Math.exp(-dt * 6);
    for (let i = 0; i < 3; i++) { this.vel[i] += (want[i] - this.vel[i]) * kk; this.pos[i] += this.vel[i] * dt; }
    const r2 = Math.hypot(this.pos[0], this.pos[1], this.pos[2]);
    const d2: D3 = [this.pos[0] / r2, this.pos[1] / r2, this.pos[2] / r2];
    const g2 = surfaceRadius(pv, d2) + 0.3;
    if (r2 < g2) for (let i = 0; i < 3; i++) this.pos[i] = d2[i] * g2;
    // basis with roll
    const cup: D3 = [rgt[1] * fwd[2] - rgt[2] * fwd[1], rgt[2] * fwd[0] - rgt[0] * fwd[2], rgt[0] * fwd[1] - rgt[1] * fwd[0]];
    norm3(cup);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const rx: D3 = [rgt[0] * cr + cup[0] * sr, rgt[1] * cr + cup[1] * sr, rgt[2] * cr + cup[2] * sr];
    const ux: D3 = [cup[0] * cr - rgt[0] * sr, cup[1] * cr - rgt[1] * sr, cup[2] * cr - rgt[2] * sr];
    const qb: DQ = [0, 0, 0, 1];
    basisQuat(rx[0], rx[1], rx[2], ux[0], ux[1], ux[2], -fwd[0], -fwd[1], -fwd[2], qb);
    const qs = qMul(pv.quat, qb);
    const ps = qRotate(pv.quat, this.pos);
    out.pos[0] = pv.center[0] + ps[0]; out.pos[1] = pv.center[1] + ps[1]; out.pos[2] = pv.center[2] + ps[2];
    out.quat[0] = qs[0]; out.quat[1] = qs[1]; out.quat[2] = qs[2]; out.quat[3] = qs[3];
    out.fov = this.fov;
    out.planet = pv.id;
  }
}

// ───────────────────────────── depth of field ─────────────────────────────

const DOF_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uFocus;
uniform float uMaxPx;
uniform float uNearK;
const int TAPS = 48;
float cocPx(float z) {
  z = min(z, 1e7);
  // thin lens: the blur circle grows with |z - focus| / z (an infinitely far background takes the full circle)
  return clamp(uMaxPx * abs(z - uFocus) / max(z, 0.05) * (z < uFocus ? uNearK : 1.0), 0.0, uMaxPx * 1.6);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec3 c0 = texture(tColor, vUv).rgb;
  float z0 = texture(tDepth, vUv).r;
  float coc0 = cocPx(z0);
  // search as far as the largest circle could reach here
  float radius = max(coc0, uMaxPx * 0.75);
  if (radius < 0.6) { gl_FragColor = vec4(c0, 1.0); return; }
  vec3 acc = c0 * 1.0;
  float wsum = 1.0;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(TAPS)) * radius;
    float a = fi * 2.39996323;
    vec2 off = vec2(cos(a), sin(a)) * r;
    vec2 uv = vUv + off / uRes;
    vec3 c = texture(tColor, uv).rgb;
    float z = texture(tDepth, uv).r;
    float coc = cocPx(z);
    // a sample spreads over this pixel if its own circle reaches here; a sample BEHIND the centre cannot spread over a
    // sharper centre (no background halo round a sharp subject), one in front can (the near field bleeds)
    float reach = z > z0 ? min(coc, coc0) : coc;
    float w = smoothstep(r - 1.0, r + 0.5, reach);
    // bokeh: bright points carry more weight (their discs read)
    w *= 1.0 + 0.6 * smoothstep(1.0, 6.0, luma(c));
    acc += c * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

export class PhotoPost {
  private target: WebGLRenderTarget | null = null;
  private mat = passMaterial(DOF_FRAG, {
    tColor: { value: null }, tDepth: { value: null }, uRes: { value: new Vector2(1, 1) }, uFocus: { value: 200 }, uMaxPx: { value: 8 }, uNearK: { value: 1.2 },
  });

  /** depth of field on the composited HDR image when photo mode wants it; returns the texture to tone map */
  apply(r: WebGLRenderer, fsq: FullscreenQuad, input: Texture, linDepth: Texture, w: number, h: number): Texture {
    const L = PHOTO.lens;
    if (!PHOTO.on || L.blur <= 0.001) return input;
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    }
    const u = this.mat.uniforms;
    u.tColor.value = input;
    u.tDepth.value = linDepth;
    (u.uRes.value as Vector2).set(w, h);
    u.uFocus.value = Math.max(0.3, L.focus);
    // a wide-open lens blurs up to ~2.2 % of the frame's height
    u.uMaxPx.value = L.blur * 0.022 * h;
    fsq.render(r, this.mat, this.target);
    return this.target.texture;
  }

  /** the post settings with the lens on top (exposure added, bloom / vignette / grain from the lens) */
  settings(base: PostSettings, scratch: PostSettings): PostSettings {
    if (!PHOTO.on) return base;
    const L = PHOTO.lens;
    Object.assign(scratch, base);
    scratch.exposureBias = base.exposureBias + L.exposure;
    scratch.bloom = base.bloom * Math.max(0, L.bloom);
    scratch.vignette = L.vignette;
    scratch.grain = L.grain;
    return scratch;
  }

  dispose(): void { this.target?.dispose(); this.mat.dispose(); }
}

// ───────────────────────────── the picture ─────────────────────────────

/** what capturePhoto needs of the renderer (render/renderer.ts) */
export interface PhotoRenderer {
  readonly three: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  quality: { renderScale: number; maxDpr: number };
  resize(cssW: number, cssH: number, dpr: number): void;
  render(view: WorldView, pose: CameraPose, dt: number, time: number): void;
  cut(): void;
}

/**
 * Render the view as a picture of `width` × `height` (≤ 3840 × 2160) with `supersample`× the pixels inside (capped by
 * the GPU's limits and ~33 M internal pixels), `frames` frames to let the temporal passes settle; returns a PNG data URL.
 * The canvas and the renderer's sizes are restored after.
 */
export function capturePhoto(R: PhotoRenderer, view: WorldView, pose: CameraPose, time: number, o: { width?: number; height?: number; supersample?: number; frames?: number } = {}): string {
  const W = Math.max(64, Math.min(3840, Math.round(o.width ?? 3840)));
  const H = Math.max(64, Math.min(2160, Math.round(o.height ?? Math.round(W * 9 / 16))));
  const gl = R.three.getContext() as WebGL2RenderingContext;
  const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
  let ss = Math.max(1, Math.min(2, o.supersample ?? 1.5));
  ss = Math.min(ss, maxTex / W, maxTex / H, Math.sqrt(33e6 / (W * H)));
  ss = Math.max(1, ss);
  const q = R.quality;
  const keep = { scale: q.renderScale, dpr: q.maxDpr };
  const cssW = window.innerWidth, cssH = window.innerHeight, dpr = window.devicePixelRatio || 1;
  let url = '';
  try {
    q.renderScale = ss;
    q.maxDpr = Math.max(1, q.maxDpr);
    R.resize(W, H, 1);
    R.cut();
    const n = Math.max(1, Math.min(8, o.frames ?? 3));
    for (let i = 0; i < n; i++) R.render(view, pose, 1 / 60, time + i / 60);
    url = R.canvas.toDataURL('image/png');
  } finally {
    q.renderScale = keep.scale;
    q.maxDpr = keep.dpr;
    R.resize(cssW, cssH, dpr);
    R.cut();
  }
  return url;
}

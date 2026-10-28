// GENESIS — the rainbow (LIVING §3.4.4: an omen — "a promise" where they trust the god, "a reprieve" where they fear
// it; the sim's `rainbow` weather, painted or after rain with the sun low). Drawn as the real thing: sunlight turned
// back by the falling drops at ~42° round the point opposite the sun — the primary bow red outside and violet inside,
// the sky brighter inside it, Alexander's darker band, and the fainter secondary bow at ~51° with its colours reversed.
// So it stands where physics puts it: centred on the antisolar point (from a low sun a tall arch, from a high sun only
// its top above the horizon, gone with the sun above 42°), and only where the rain of a `rainbow` weather lies along
// the view ray — the shower's column, between the camera and whatever stands behind it (a hill in front cuts it).
// A full-screen pass in the FX layer: per pixel, the ray's angle to the antisolar point picks the colour; a short march
// along the ray through the showers' columns picks how much of the bow is there. Light added over a veil (premultiplied:
// the bow replaces a share of the haze behind it).

import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, ShaderMaterial, Vector3, Vector4, type IUniform } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { ATMO_PARS } from '../shaders/atmosphere.glsl.ts';
import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor, ZeroFactor } from 'three';
import { FX_DEPTH_GLSL, FX_LAYER } from './fxcommon.ts';

const MAX_BOWS = 4;

const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
${ATMO_PARS}
${FX_DEPTH_GLSL}
uniform mat4 uInvProj;
uniform mat3 uViewToBody;
uniform vec3 uCamB;
uniform vec3 uSunDirBody;
uniform float uR;          // the planet's radius (datum)
uniform float uDeck;       // how high the showers stand over the datum (m)
uniform vec4 uBow[${MAX_BOWS}];   // unit position, radius (m)
uniform float uBowK[${MAX_BOWS}]; // strength (intensity × fade)
uniform float uGlobal;     // a rainbow over the whole world (weather.global)
varying vec2 vNdc;

// the colours across a bow, x 0 (violet, inner edge) … 1 (red, outer edge)
vec3 spectral(float x) {
  float r = smoothstep(0.42, 0.82, x) + 0.3 * exp(-pow(x / 0.08, 2.0));
  float g = exp(-pow((x - 0.52) / 0.2, 2.0));
  float b = exp(-pow((x - 0.16) / 0.16, 2.0));
  return vec3(r, g * 0.95, b);
}

float coverAt(vec3 P) {
  float rP = length(P);
  vec3 u = P / rP;
  float h = rP - uR;
  // the rain stands from the ground up into the cloud
  float col = smoothstep(-5.0, 20.0, h) * (1.0 - smoothstep(uDeck * 0.8, uDeck, h));
  float c = uGlobal;
  for (int j = 0; j < ${MAX_BOWS}; j++) {
    if (uBowK[j] <= 0.0) continue;
    float d = acos(clamp(dot(u, uBow[j].xyz), -1.0, 1.0)) * uR;
    c += uBowK[j] * (1.0 - smoothstep(uBow[j].w * 0.55, uBow[j].w, d));
  }
  return c * col;
}

void main() {
  // (the near plane: through the far plane's w, ~1e-7 at 20 000 km, float precision left every ray the same)
  vec4 rv = uInvProj * vec4(vNdc, -1.0, 1.0);
  vec3 rdV = normalize(rv.xyz / rv.w);
  vec3 rd = normalize(uViewToBody * rdV);
  vec3 up = normalize(uCamB);
  // the sun must be up for the drops to shine
  float sunUp = smoothstep(-0.02, 0.06, dot(up, uSunDirBody));
  if (sunUp <= 0.0) discard;
  float ang = degrees(acos(clamp(dot(rd, -uSunDirBody), -1.0, 1.0)));
  if (ang > 56.0) discard;
  // how far the ray runs before it meets the scene (the sky: far)
  float sz = fxSceneZ();
  float tMax = min(sz > 1e6 ? 6000.0 : sz / max(-rdV.z, 1e-3), 6000.0);
  // march the ray through the showers (log-spaced: the near rain matters as much as a far curtain)
  float cov = 0.0;
  float t0 = 40.0;
  if (tMax <= t0) discard;
  float lr = log(tMax / t0);
  float prev = t0;
  for (int i = 1; i <= 14; i++) {
    float t = t0 * exp(lr * float(i) / 14.0);
    cov += coverAt(uCamB + rd * (0.5 * (t + prev))) * (t - prev);
    prev = t;
  }
  // (rain is not opaque: a bow's strength saturates over a few hundred metres of shower)
  float k = 1.0 - exp(-cov / 450.0);
  if (k <= 0.002) discard;
  // the primary bow (40.4°–42.6°), the brighter sky inside it, Alexander's dark band, the secondary (50.2°–53.6°)
  float xp = (ang - 40.4) / 2.2;
  float pri = smoothstep(-0.12, 0.08, xp) * (1.0 - smoothstep(0.88, 1.12, xp));
  vec3 c = spectral(clamp(xp, 0.0, 1.0)) * pri;
  float xs = (53.6 - ang) / 3.4;
  float sec = smoothstep(-0.12, 0.1, xs) * (1.0 - smoothstep(0.86, 1.14, xs));
  c += spectral(clamp(xs, 0.0, 1.0)) * sec * 0.38;
  c += vec3(0.16) * (1.0 - smoothstep(30.0, 40.6, ang)) * smoothstep(10.0, 30.0, ang);
  // lit by the sun through the air at the camera
  vec3 sunL = uSunE * sunTransmittance(length(uCamB), dot(up, uSunDirBody));
  // (a sign must read: over a bright milky haze a bow only ADDED to the sky was a faint arc of near-white. The drops
  // turn the light back out of the haze behind them too: the bow takes the place of a share of it — its own colour,
  // saturated — and Alexander's band between the bows is darker than the sky on either side, as it is in life)
  float alex = smoothstep(42.4, 43.6, ang) * (1.0 - smoothstep(49.4, 50.4, ang));
  float veil = clamp(k * sunUp * (pri * 0.3 + sec * 0.1 + alex * 0.16), 0.0, 0.34);
  gl_FragColor = vec4(sunL * c * k * sunUp * 0.12, veil);
}
`;

const _v4 = new Vector4();

/** the bows of the world's `rainbow` weathers, eased in and out */
export class Rainbow {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private fades = new Map<number, number>();
  private global = 0;
  /** for probes: how many showers carry a bow, and their strength */
  live = 0;

  constructor(fx: Record<string, IUniform>, shared: Record<string, IUniform>) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const uniforms: Record<string, IUniform> = {
      ...fx,
      uInvProj: { value: new Matrix4() }, uViewToBody: { value: new Matrix3() }, uCamB: { value: new Vector3() },
      uR: { value: 3000 }, uDeck: { value: 400 }, uGlobal: { value: 0 },
      uBow: { value: Array.from({ length: MAX_BOWS }, () => new Vector4()) }, uBowK: { value: new Array(MAX_BOWS).fill(0) },
    };
    for (const k of Object.keys(shared)) if (!(k in uniforms)) uniforms[k] = shared[k];
    this.mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(FX_LAYER);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  update(pv: PlanetView, camBody: Vector3, invProj: Matrix4, viewToBody: Matrix3, deck: number, ease: number): void {
    const u = this.mat.uniforms;
    const seen = new Set<number>();
    const bows = u.uBow.value as Vector4[], ks = u.uBowK.value as number[];
    let n = 0;
    for (const w of pv.weather) {
      if (w.kind !== 'rainbow') continue;
      seen.add(w.id);
      const f = Math.min(1, (this.fades.get(w.id) ?? 0) + ease * 0.5);
      this.fades.set(w.id, f);
      if (n < MAX_BOWS) {
        bows[n].copy(_v4.set(w.pos[0], w.pos[1], w.pos[2], 0)).setW(Math.max(80, w.radius));
        const l = Math.hypot(w.pos[0], w.pos[1], w.pos[2]) || 1;
        bows[n].x /= l; bows[n].y /= l; bows[n].z /= l;
        ks[n] = Math.min(1.5, w.intensity) * f;
        n++;
      }
    }
    // showers gone: their bows fade out where they were
    for (const [id, f] of this.fades) {
      if (seen.has(id)) continue;
      const nf = f - ease * 0.4;
      if (nf <= 0) this.fades.delete(id); else this.fades.set(id, nf);
    }
    for (let j = n; j < MAX_BOWS; j++) ks[j] = 0;
    const wantG = pv.params.globalWeather === 'rainbow' ? 1 : 0;
    this.global += (wantG - this.global) * Math.min(1, ease * 0.5);
    u.uGlobal.value = this.global;
    this.live = n + (this.global > 0.01 ? 1 : 0);
    this.mesh.visible = this.live > 0;
    if (!this.mesh.visible) return;
    (u.uInvProj.value as Matrix4).copy(invProj);
    (u.uViewToBody.value as Matrix3).copy(viewToBody);
    (u.uCamB.value as Vector3).copy(camBody);
    u.uR.value = pv.params.radius;
    // (the showers a bow forms in stand well above this small world's low cloud deck: the bow is drawn against them,
    // as from rain falling out of a high cloud)
    u.uDeck.value = Math.max(1200, (deck - pv.params.radius) * 4);
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

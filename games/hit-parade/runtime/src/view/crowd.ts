// HIT PARADE - the studio crowd (CONTRACT §6.4 "Crowd", §7; doctrine §3 / E42: crowds are baked impostors of REAL
// characters on UNLIT cards - BRIEF: cartoon-quality people, never pills).
//
//   * One InstancedMesh of cards = one draw call for the whole audience. Each card is billboarded about its vertical
//     axis in the vertex shader and bobs / sways there (per-card phase), feet on the slot's floor point (atlas anchor).
//   * MOOD from the ratings: every card owns an idle cell (watching) and a cheer cell of the same person at the same
//     angle, plus a threshold; while SHOWTIME intensity (0..1, + event pops) is above its threshold the card shows the
//     cheer pose - so the house visibly gets on its feet as the ratings climb. `popNow()` makes it jump on big
//     moments (super, KO, wall splat, perfect parry). Per-card hue shift (skin band kept) and U mirror add variety.
//   * P2 (verifier D11: "the ~6 people repeat visibly"): every card now varies on five axes - a clothing hue from a wide
//     palette (skin band kept; 80 % of cards), brightness 0.8-1.08, height +-7 %, an idle pose drawn from watch / jeer
//     (a third of the house slowly alternates between the two on its own clock) and a cheer pose that alternates
//     cheer <-> hype while the house is up, so neighbouring copies of one body never move in sync.
//   * The atlas: lane STAGES' `crowd_atlas.webp` + `crowd_atlas.json` (grid rowIs body, colIs pose*3+angle, poses with
//     moods, feet anchor, tint, brightness; stages.json crowd). Without one, bakeCrowdAtlas() renders real skinned
//     characters (posed from their own clips through the toon material + outline) into an sRGB render target.

import * as THREE from 'three';
import type { Assets, FighterAsset } from './assets.ts';
import { PoseDriver } from './anim.ts';
import { profileForBody, toonify } from './toon.ts';

export interface CrowdAtlas {
  texture: THREE.Texture; cols: number; rows: number; cells: number;
  /** card width / height */
  aspect: number;
  /** fraction of the card height BELOW the feet (atlas anchor) */
  feet?: number;
  tint?: THREE.Color;
  brightness?: number;
  /** per person-and-angle: the idle (watching), cheer and jeer cells */
  groups?: Array<{ idle: number[]; cheer: number[]; jeer?: number[]; angle?: string }>;
}

const VERT = /* glsl */`
attribute vec4 aCard;   // idle cell A, phase, hue, height
attribute vec4 aCard2;  // cheer cell A, threshold, mirror (+1/-1), idle cell B
attribute vec4 aCard3;  // cheer cell B, brightness, idle swap rate (Hz, 0 = none), cheer swap rate (Hz)
uniform float uTime; uniform float uIntensity; uniform float uPop; uniform float uCols; uniform float uRows; uniform float uAspect;
uniform float uFeet;
varying vec2 vUv; varying float vHue; varying float vShade;
void main() {
  vec3 base = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
  float h = aCard.w;
  vec3 toCam = cameraPosition - base; toCam.y = 0.0;
  vec3 fwd = length( toCam ) > 1e-4 ? normalize( toCam ) : vec3( 0.0, 0.0, 1.0 );
  vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), fwd ) );
  float ph = aCard.y;
  float t = uTime;
  float excite = clamp( uIntensity + uPop * 0.8, 0.0, 1.5 );
  bool cheer = excite > aCard2.y;
  // idle sway + excited bounce (only the upward half of the sine: people hop, they do not sink)
  float sway = sin( t * 1.3 + ph * 6.28 ) * ( 0.02 + 0.04 * uIntensity );
  float hop = cheer ? max( 0.0, sin( t * ( 5.0 + 3.0 * fract( ph * 7.3 ) ) + ph * 40.0 ) ) * ( 0.03 + 0.1 * uIntensity ) : 0.0;
  hop += uPop * ( 0.14 + 0.1 * fract( ph * 13.1 ) ) * abs( sin( t * 9.0 + ph * 20.0 ) );
  vec2 q = vec2( position.x * uAspect, position.y + 0.5 - uFeet ) * h;
  q.x += max( q.y, 0.0 ) * sway;
  vec3 wp = base + right * q.x + vec3( 0.0, q.y + hop, 0.0 );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
  float idleSw = aCard3.z > 0.0 ? step( 0.5, fract( t * aCard3.z + ph * 3.1 ) ) : 0.0;
  float cheerSw = step( 0.5, fract( t * aCard3.w + ph * 5.7 ) );
  float cell = cheer ? ( cheerSw > 0.5 ? aCard3.x : aCard2.x ) : ( idleSw > 0.5 ? aCard2.w : aCard.x );
  vec2 cuv = vec2( aCard2.z < 0.0 ? 1.0 - uv.x : uv.x, uv.y );
  vUv = ( vec2( mod( cell, uCols ), uRows - 1.0 - floor( cell / uCols ) ) + cuv ) / vec2( uCols, uRows );
  vHue = aCard.z;
  vShade = aCard3.y;
}
`;
const FRAG = /* glsl */`
uniform sampler2D uAtlas; uniform float uLight; uniform vec3 uTint;
varying vec2 vUv; varying float vHue; varying float vShade;
vec3 hpHueRotate( vec3 c, float a ) { const vec3 k = vec3( 0.57735 ); float ca = cos( a ), sa = sin( a ); return c * ca + cross( k, c ) * sa + k * dot( k, c ) * ( 1.0 - ca ); }
float hpSkin( vec3 c ) {
  // skin band by HSV: hue 0..50 deg (a little past red either side), saturation 0.08..0.8; 1 = skin (left alone)
  float mx = max( c.r, max( c.g, c.b ) ), mn = min( c.r, min( c.g, c.b ) );
  float d = mx - mn;
  float sat = mx > 1e-4 ? d / mx : 0.0;
  float h = 0.0;
  if ( d > 1e-5 ) {
    if ( mx == c.r ) h = mod( ( c.g - c.b ) / d, 6.0 );
    else if ( mx == c.g ) h = ( c.b - c.r ) / d + 2.0;
    else h = ( c.r - c.g ) / d + 4.0;
    h /= 6.0;
  }
  float hd = min( abs( h - 0.07 ), abs( h - 1.07 ) );         // distance from ~25 deg, wrapping at red
  float hueOk = 1.0 - smoothstep( 0.08, 0.13, hd );
  float satOk = smoothstep( 0.05, 0.1, sat ) * ( 1.0 - smoothstep( 0.8, 0.9, sat ) );
  return hueOk * satOk;
}
void main() {
  vec4 tx = texture2D( uAtlas, vUv );
  if ( tx.a < 0.5 ) discard;
  vec3 c = tx.rgb;
  c = mix( hpHueRotate( c, vHue ), c, hpSkin( c ) );
  gl_FragColor = vec4( c * uTint * uLight * vShade, 1.0 );
}
`;

export class CrowdView {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  intensityTarget = 0.25;
  private pop = 0;
  readonly count: number;

  constructor(atlas: CrowdAtlas, slots: ReadonlyArray<THREE.Object3D>, seed = 1) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const n = Math.max(1, slots.length);
    this.count = slots.length;
    const card = new Float32Array(n * 4);
    const card2 = new Float32Array(n * 4);
    const card3 = new Float32Array(n * 4);
    const HUES = [0.55, -0.55, 1.1, -1.1, 1.65, -1.65, 2.3, -2.3, 3.0];
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    this.uniforms = {
      uTime: { value: 0 }, uIntensity: { value: 0.25 }, uPop: { value: 0 }, uCols: { value: atlas.cols }, uRows: { value: atlas.rows },
      uAspect: { value: atlas.aspect }, uAtlas: { value: atlas.texture }, uLight: { value: atlas.brightness ?? 0.6 },
      uTint: { value: atlas.tint ?? new THREE.Color(1, 1, 1) }, uFeet: { value: atlas.feet ?? 0 },
    };
    const mat = new THREE.ShaderMaterial({ name: 'crowd', uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.name = 'crowd';
    this.mesh.frustumCulled = false;
    const groups = atlas.groups && atlas.groups.length ? atlas.groups : null;
    const byAngle = new Map<string, Array<{ idle: number[]; cheer: number[]; jeer?: number[]; angle?: string }>>();
    for (const g of groups ?? []) if (g.angle) { const l = byAngle.get(g.angle) ?? []; l.push(g); byAngle.set(g.angle, l); }
    for (let i = 0; i < n; i++) {
      const o = slots[i];
      if (o) { o.updateWorldMatrix(true, false); o.matrixWorld.decompose(p, q, sc); } else { p.set(0, -100, 0); sc.set(1, 1, 1); }
      m.makeTranslation(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, m);
      let idle: number, cheer: number, idleB: number, cheerB: number;
      let mirrorOk = true;
      let swap = 0;
      if (groups) {
        // STAGES §21.3: the node's extras `angle` names the atlas view that suits the spot
        const want = o && typeof o.userData.angle === 'string' ? byAngle.get(o.userData.angle as string) : undefined;
        const pool = want && want.length ? want : groups;
        const g = pool[Math.floor(rnd() * pool.length) % pool.length];
        mirrorOk = !g.angle || g.angle === 'front';
        const pick = (l: number[] | undefined, d: number) => (l && l.length ? l[Math.floor(rnd() * l.length) % l.length] : d);
        const watch = pick(g.idle, 0);
        const jeer = pick(g.jeer, watch);
        cheer = pick(g.cheer, watch);
        cheerB = g.cheer.length > 1 ? g.cheer[(g.cheer.indexOf(cheer) + 1) % g.cheer.length] : cheer;
        // a quarter of the house idles in the jeer pose; a third alternates watch <-> jeer on its own slow clock
        idle = rnd() < 0.25 ? jeer : watch;
        idleB = idle === watch ? jeer : watch;
        swap = rnd() < 0.34 && idleB !== idle ? 0.035 + 0.06 * rnd() : 0;
      } else {
        idle = Math.floor(rnd() * atlas.cells) % atlas.cells;
        cheer = idle; idleB = idle; cheerB = idle;
      }
      card[i * 4] = idle;
      card[i * 4 + 1] = rnd();
      // clothing hue from a wide palette (the skin band is kept by hpSkin), 80 % of the cards
      card[i * 4 + 2] = rnd() < 0.2 ? 0 : HUES[Math.floor(rnd() * HUES.length) % HUES.length] + (rnd() - 0.5) * 0.25;
      card[i * 4 + 3] = Math.max(0.5, Math.abs(sc.y) || 1.7) * (0.93 + 0.14 * rnd());
      card2[i * 4] = cheer;
      card2[i * 4 + 1] = 0.15 + 0.8 * rnd();
      card2[i * 4 + 2] = mirrorOk && rnd() < 0.5 ? -1 : 1;           // U mirror only on front views (§21.4)
      card2[i * 4 + 3] = idleB;
      card3[i * 4] = cheerB;
      card3[i * 4 + 1] = 0.8 + 0.28 * rnd();
      card3[i * 4 + 2] = swap;
      card3[i * 4 + 3] = 0.25 + 0.5 * rnd();
    }
    geo.setAttribute('aCard', new THREE.InstancedBufferAttribute(card, 4));
    geo.setAttribute('aCard2', new THREE.InstancedBufferAttribute(card2, 4));
    geo.setAttribute('aCard3', new THREE.InstancedBufferAttribute(card3, 4));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** big moment: the whole house jumps (0..1, decays) */
  popNow(amount = 1): void { this.pop = Math.min(1.2, this.pop + amount); }

  /** current (smoothed) intensity + pop, for read-back */
  excitement(): number { return (this.uniforms.uIntensity.value as number) + this.pop * 0.8; }

  update(dt: number): void {
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value as number) + dt;
    u.uIntensity.value = (u.uIntensity.value as number) + (this.intensityTarget - (u.uIntensity.value as number)) * (1 - Math.exp(-dt * 2));
    this.pop = Math.max(0, this.pop - dt * 0.9);
    u.uPop.value = this.pop;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** the cheer / jeer poses baked per body: [clip, seconds] (clips missing on a body fall back to idle) */
const POSES: ReadonlyArray<readonly [string, number]> = [
  ['win1', 0.7], ['win1', 1.5], ['win1', 2.3], ['idle', 0.4], ['block_high', 0.6], ['hit_high_l', 0.25], ['jump_up', 0.9], ['idle', 1.2],
];
const ANGLES = [0, 0.6];

/**
 * Bake a crowd atlas from real characters (fallback when the stage ships none). Renders `bodies.length x 8 poses x 2
 * angles` cells of 128 x 256 into an sRGB render target (8 columns). Runs once at load, before warm-up.
 */
export async function bakeCrowdAtlas(renderer: THREE.WebGLRenderer, assets: Assets, bodies: ReadonlyArray<{ asset: FighterAsset; body?: string }>): Promise<CrowdAtlas> {
  const cols = 8;
  const perBody = POSES.length * ANGLES.length;
  const cells = Math.max(1, bodies.length * perBody);
  const rows = Math.ceil(cells / cols);
  const CW = 128, CH = 256;
  const rt = new THREE.WebGLRenderTarget(cols * CW, rows * CH, {
    colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  rt.texture.name = 'crowd-atlas-baked';
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2e2a, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 4, 5);
  scene.add(key);
  const cam = new THREE.OrthographicCamera(-0.55, 0.55, 2.15, -0.05, 0.1, 20);
  cam.position.set(0, 1.05, 6);
  cam.lookAt(0, 1.05, 0);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevScissor = renderer.getScissorTest();
  const prevAuto = renderer.autoClear;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.setScissorTest(false);
  renderer.clear(true, true, true);
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  let cell = 0;
  try {
    for (const b of bodies) {
      const inst = assets.instantiate(b.asset);
      const k = 1.8 / Math.max(0.5, b.asset.heightM);        // every crowd body fills the card the same way
      inst.scale.setScalar(k);
      const handle = toonify(inst, { profile: profileForBody(b.body ?? b.asset.id), outline: true, castShadow: false });
      const pose = new PoseDriver(inst, b.asset.clips);
      scene.add(inst);
      for (const [clip, t] of POSES) {
        for (const ang of ANGLES) {
          const cx = cell % cols, cy = Math.floor(cell / cols);
          inst.rotation.y = ang;
          pose.poseClip(b.asset.clips.has(clip) ? clip : 'idle', t);
          inst.updateMatrixWorld(true);
          // viewport y is from the bottom; the shader's row 0 is the TOP row
          const vy = (rows - 1 - cy) * CH;
          renderer.setViewport(cx * CW, vy, CW, CH);
          renderer.setScissor(cx * CW, vy, CW, CH);
          renderer.clear(true, true, true);
          renderer.render(scene, cam);
          cell++;
        }
      }
      scene.remove(inst);
      pose.dispose();
      handle.dispose();
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    renderer.setScissorTest(prevScissor);
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.setScissor(0, 0, size.x, size.y);
  }
  // mood groups per (body, angle): idle = the idle poses, cheer = the win / jump poses (cell = b*16 + pose*2 + angle)
  const groups: Array<{ idle: number[]; cheer: number[] }> = [];
  for (let b = 0; b < bodies.length; b++) {
    for (let a = 0; a < ANGLES.length; a++) {
      const idle: number[] = [], cheer: number[] = [];
      POSES.forEach(([clip], pi) => {
        const c = b * perBody + pi * ANGLES.length + a;
        if (clip === 'idle' || clip === 'block_high') idle.push(c); else cheer.push(c);
      });
      groups.push({ idle, cheer });
    }
  }
  return { texture: rt.texture, cols, rows, cells: cell, aspect: CW / CH, feet: 0.05 / 2.2, groups };
}

/** STAGES atlas meta (art/gltf/stages/crowd_atlas.json) - the fields the view reads */
interface AtlasMeta {
  grid?: { cols: number; rows: number; rowIs?: string; colIs?: string };
  anchor?: [number, number];
  poses?: Array<{ id: string; mood?: string }>;
  angles?: Array<{ id: string }>;
  metresPerCellWidth?: number; metresPerCellHeight?: number;
}

/**
 * Load lane STAGES' crowd atlas (image + meta json in art/gltf/stages/). Mood groups come from the meta's poses
 * (mood 'idle' = watching, 'cheer' = cheering) laid out per the grid (rowIs body, colIs pose*angles + angle).
 */
export async function loadCrowdAtlas(imageUrl: string, metaUrl: string | null, cols: number, rows: number,
  opts: { count?: number; tint?: string; brightness?: number; anchor?: [number, number] } = {}): Promise<CrowdAtlas> {
  const tex = await new THREE.TextureLoader().loadAsync(imageUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  let meta: AtlasMeta | null = null;
  if (metaUrl && !/\/undefined$/.test(metaUrl)) {
    try { const r = await fetch(metaUrl); if (r.ok) meta = await r.json() as AtlasMeta; } catch { meta = null; }
  }
  const c = meta?.grid?.cols ?? cols, rw = meta?.grid?.rows ?? rows;
  const img = tex.image as { width: number; height: number };
  const anchor = meta?.anchor ?? opts.anchor ?? [0.5, 1];
  const groups: Array<{ idle: number[]; cheer: number[]; jeer: number[]; angle?: string }> = [];
  const poses = meta?.poses ?? [], angles = meta?.angles ?? [];
  if (poses.length && angles.length && (meta?.grid?.rowIs ?? 'body') === 'body') {
    for (let r = 0; r < rw; r++) {
      for (let a = 0; a < angles.length; a++) {
        const idle: number[] = [], cheer: number[] = [], jeer: number[] = [];
        poses.forEach((p, pi) => {
          const cell = r * c + pi * angles.length + a;
          if (p.mood === 'cheer') cheer.push(cell); else if (p.mood === 'idle') idle.push(cell); else if (p.mood === 'jeer') jeer.push(cell);
        });
        if (idle.length || cheer.length) groups.push({ idle: idle.length ? idle : cheer, cheer, jeer, angle: angles[a].id });
      }
    }
  }
  return {
    texture: tex, cols: c, rows: rw, cells: opts.count ?? c * rw, aspect: (img.width / c) / (img.height / rw),
    feet: 1 - anchor[1], tint: opts.tint ? new THREE.Color(opts.tint) : undefined, brightness: opts.brightness, groups,
  };
}

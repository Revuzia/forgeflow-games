// HIT PARADE - the stage view (CONTRACT §6.4, §7 "Stage view", §17.1 stage conventions).
//
//   * Loads art/gltf/stages/<id>.glb (lane STAGES) through Assets; sets keep their lit PBR materials; every stage mesh
//     receives shadows, none casts (fighters cast onto the floor).
//   * FIXED light pool (doctrine §3 / E37: the visible-light COUNT is a shader-permutation key - never add or remove a
//     light after the first render): built ONCE at load from stages.json `lights` (lane STAGES' rig: key / rim /
//     hemisphere fill / torches / spot / marquee, "No lights are embedded in the GLB"), else the view's default rig
//     (hemisphere + warm key + weak front fill). Exactly one directional light casts shadows (PCF, 1024 / 512 on
//     'low'). `flicker: {amp, hz}` lights get view-only intensity modulation. Punctual lights shipped IN a stage GLB
//     would join the pool at load and never change afterwards.
//   * The key light's shadow frustum follows the camera's mid-X (tight 13 x 7.5 m box -> ~1.3 cm/texel at 1024).
//   * `environment.hdr` (stages.json) -> scene.environment (PBR set materials only; the toon fighters ignore it).
//   * Crowd slots: `crowd_*` empties from the GLB (§17.1); the fallback set generates bleacher rows.
//   * Stage dressing hooks: nodes named `anim_spin_*` rotate about their local Y, `anim_flicker_*` flicker their
//     emissive; stage walls "react" through fx.ts dust on splats.
//   * P2 (CHANGED VIEW, CONTRACT §26.6): stages.json `dressing.animated[]` entries with a `kind` drive view-side dressing:
//     spin (wheels), flicker (neon), chase (marquee bulbs), flame, sway (hooks / hanging lamps), blink (tally lights),
//     scroll (tickers), screen (CRT / monitor banks showing a live HUD-like feed of the bout), rain (instanced streaks +
//     floor splashes), steam (vents). Entries without a `kind` (P1 free text) keep working by node name.
//   * P2 marquee glare: emissive sign faces / bulb strips brighter than `GLARE_CAP` are graded down at load (the Rust
//     Theater sign face burned out to white behind the round timer).
//   * FALLBACK (lab, or a stage GLB that is not there yet): a procedural studio set (canvas-textured floor strip, back
//     wall, side walls at x = +-8 m as splat surfaces). `fallback = true` and a console warning - it is a stand-in for
//     the STAGES lane's art, never the shipped look.

import * as THREE from 'three';
import type { Assets, StageAsset } from './assets.ts';
import type { ViewGameData } from './types.ts';

export interface StageDef {
  id: string;
  glb?: string;
  exposure?: number;
  fog?: { color: string | number; near: number; far: number };
  crowd?: { atlas?: string; meta?: string; cols?: number; rows?: number; count?: number; anchor?: [number, number]; tint?: string;
    brightness?: number; cardHeightM?: number };
  lights?: LightSpec[];
  environment?: { hdr?: string; intensity?: number; background?: boolean; backgroundColor?: string };
  dressing?: { animated?: DressingSpec[] };
}

/** CONTRACT §26.6: one animated-dressing entry (stages.json `dressing.animated[]`) */
export interface DressingSpec {
  kind?: 'spin' | 'flicker' | 'chase' | 'flame' | 'sway' | 'blink' | 'scroll' | 'screen' | 'rain' | 'steam';
  /** node-name glob ('wheel_*', 'neon_*' ...) */
  nodes?: string;
  axis?: 'x' | 'y' | 'z';
  rpm?: number; hz?: number; amp?: number; deg?: number; speed?: number; spacing?: number; dropout?: number;
  content?: 'hud' | 'static' | 'bars' | 'logo';
  area?: { x: [number, number]; z: [number, number]; top?: number };
  rate?: number; color?: string; size?: number;
  at?: Array<[number, number, number]>;
  what?: string; how?: string;
}

/** emissive strength a sign / bulb material may keep (anything above is graded down at load: marquee glare) */
export const GLARE_CAP = 1.6;
/** neon tube emissive cap (strength x max channel) */
export const NEON_CAP = 2.2;

export interface StageFrameCtx {
  /** fighter names + hp fractions for monitor feeds */
  hp?: [number, number];
  names?: [string, string];
  timer?: number;
  time?: number;
}

function globRe(glob: string): RegExp {
  return new RegExp('^' + glob.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}

/** tolerant read of data/stages.json: {stages:[{id..}]} | {stages:{id:{..}}} | [{id..}] | {id:{..}} */
export function stageDef(data: ViewGameData | null, id: string): StageDef {
  const s = data?.stages as unknown;
  const pick = (v: unknown): StageDef | null => (v && typeof v === 'object' ? { id, ...(v as object) } as StageDef : null);
  if (Array.isArray(s)) return pick(s.find((x) => x && (x as { id?: string }).id === id)) ?? { id };
  if (s && typeof s === 'object') {
    const o = s as Record<string, unknown>;
    const inner = o.stages;
    if (Array.isArray(inner)) return pick(inner.find((x) => x && (x as { id?: string }).id === id)) ?? { id };
    if (inner && typeof inner === 'object') return pick((inner as Record<string, unknown>)[id]) ?? { id };
    return pick(o[id]) ?? { id };
  }
  return { id };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

/** the procedural stand-in studio set (see header) */
function buildFallbackSet(): { group: THREE.Group; crowd: THREE.Object3D[] } {
  const g = new THREE.Group();
  g.name = 'stage-fallback';
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // floor: worn dark studio boards (z +4 .. -12)
  const floorTex = canvasTex(1024, 1024, (x) => {
    x.fillStyle = '#2b2530'; x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 16; i++) {
      const y = i * 64;
      x.fillStyle = `hsl(${280 + rnd() * 20}, 10%, ${13 + rnd() * 6}%)`; x.fillRect(0, y, 1024, 62);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, y + 62, 1024, 2);
      for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`; x.fillRect(rnd() * 1024, y + rnd() * 60, 30 + rnd() * 120, 1 + rnd() * 2); }
    }
  }, [8, 5]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -4);
  floor.receiveShadow = true;
  floor.name = 'floor';
  g.add(floor);
  // the painted fight strip (x -8..8, z -1.5..1.5): border + centre line, a small show logo
  const stripTex = canvasTex(1024, 256, (x) => {
    x.clearRect(0, 0, 1024, 256);
    x.strokeStyle = 'rgba(255,214,0,0.8)'; x.lineWidth = 8; x.strokeRect(6, 6, 1012, 244);
    x.fillStyle = 'rgba(255,214,0,0.8)'; x.fillRect(508, 6, 8, 244);
    x.font = 'bold 54px Impact, sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(255,45,85,0.35)';
    x.fillText('HIT PARADE', 256, 150); x.fillText('HIT PARADE', 768, 150);
  }, [1, 1]);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), new THREE.MeshStandardMaterial({ map: stripTex, transparent: true, roughness: 0.6, depthWrite: false }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.003, 0);
  strip.receiveShadow = true;
  strip.name = 'fight_strip';
  g.add(strip);
  // painted blue brick (a nod to the brief's arena)
  const brickTex = (rx: number, ry: number) => canvasTex(512, 512, (x) => {
    x.fillStyle = '#16203a'; x.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 8; c++) {
        const off = r % 2 ? 32 : 0;
        x.fillStyle = `hsl(${220 + rnd() * 12}, ${38 + rnd() * 15}%, ${20 + rnd() * 9}%)`;
        x.fillRect(c * 64 + off + 2, r * 32 + 2, 60, 28);
      }
    }
  }, [rx, ry]);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), new THREE.MeshStandardMaterial({ map: brickTex(10, 3), roughness: 0.9 }));
  back.position.set(0, 5, -11);
  back.receiveShadow = true;
  back.name = 'wall_back';
  g.add(back);
  // set walls at x = +-8 m (the corner / wall-splat surfaces), from the barrier to the front
  const sideMat = new THREE.MeshStandardMaterial({ map: brickTex(2, 2), roughness: 0.9 });
  for (const sx of [-8, 8]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), sideMat);
    w.position.set(sx, 3, -0.3);
    w.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
    w.receiveShadow = true;
    w.name = sx < 0 ? 'wall_left' : 'wall_right';
    g.add(w);
  }
  // crowd barrier: a low padded wall between the fight floor and the bleachers
  const barrierTex = canvasTex(512, 64, (x) => {
    x.fillStyle = '#b3122e'; x.fillRect(0, 0, 512, 64);
    x.fillStyle = '#ffd400'; x.fillRect(0, 0, 512, 6); x.fillRect(0, 58, 512, 6);
    x.font = 'bold 34px Impact, sans-serif'; x.fillStyle = 'rgba(255,255,255,0.85)'; x.textAlign = 'center'; x.fillText('KNOCKOUT 13', 256, 45);
  }, [6, 1]);
  const barrier = new THREE.Mesh(new THREE.BoxGeometry(30, 1.0, 0.3), new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.6 }));
  barrier.position.set(0, 0.5, -3.6);
  barrier.receiveShadow = true;
  barrier.name = 'barrier';
  g.add(barrier);
  // bleacher steps behind the barrier
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x1b1624, roughness: 0.95 });
  for (let row = 0; row < 5; row++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5 + row * 0.5, 0.8), stepMat);
    st.position.set(0, (0.5 + row * 0.5) / 2, -4.4 - row * 0.8);
    st.receiveShadow = true;
    st.name = 'bleacher_' + row;
    g.add(st);
  }
  // neon strip on the back wall
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(22, 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.18, 0.45).multiplyScalar(1.6) }));
  neon.position.set(0, 6.4, -10.95);
  neon.name = 'anim_flicker_neon';
  g.add(neon);
  // crowd slots: people standing on the bleacher steps (cards face +Z; node scale = card height in m)
  const crowd: THREE.Object3D[] = [];
  for (let row = 0; row < 5; row++) {
    const n = 34;
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.12) continue;                            // gaps read as a real house
      const o = new THREE.Object3D();
      o.name = `crowd_${row}_${i}`;
      o.position.set(-14 + i * (28 / n) + (row % 2) * 0.35 + (rnd() - 0.5) * 0.25, 0.5 + row * 0.5, -4.4 - row * 0.8 + (rnd() - 0.5) * 0.15);
      o.scale.setScalar(2.1 + rnd() * 0.25);
      crowd.push(o);
      g.add(o);
    }
  }
  return { group: g, crowd };
}

export interface LightSpec {
  id?: string; type: 'directional' | 'hemisphere' | 'point' | 'spot' | 'ambient';
  color?: string; sky?: string; ground?: string; intensity?: number;
  position?: [number, number, number]; target?: [number, number, number];
  castShadow?: boolean; distance?: number; decay?: number; angleDeg?: number; penumbra?: number;
  shadow?: { mapSize?: number; bias?: number; normalBias?: number; camera?: { left: number; right: number; top: number; bottom: number; near: number; far: number } };
  flicker?: { amp: number; hz: number };
}

interface Flicker { light: THREE.Light; base: number; amp: number; hz: number; phase: number }
interface DressNode { o: THREE.Object3D; spec: DressingSpec; phase: number; base?: THREE.Euler; mats?: Array<{ m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; base: number; col?: THREE.Color }> }

/** one live monitor feed texture (shared by every `screen` node of a stage) */
class ScreenFeed {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  readonly content: string;
  /** panels side by side (a bank of monitors mapped by a planar projection shares one canvas) */
  readonly panels: string[];
  private acc = 1;
  private n = 0;
  private content0 = 'hud';
  constructor(content: string, panels = 1) {
    this.content = content;
    const order = [content, content === 'hud' ? 'names' : 'hud', 'static', 'bars', 'logo', 'hud'];
    this.panels = Array.from({ length: Math.max(1, panels) }, (_, i) => order[i % order.length]);
    this.canvas.width = 256 * this.panels.length; this.canvas.height = 160;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.draw({});
  }
  update(dt: number, ctx: StageFrameCtx): void {
    this.acc += dt;
    if (this.acc < 0.1) return;                              // 10 Hz: a CRT feed, not a second renderer
    this.acc = 0;
    this.draw(ctx);
  }
  private draw(ctx: StageFrameCtx): void {
    const g = this.canvas.getContext('2d')!;
    this.n++;
    for (let i = 0; i < this.panels.length; i++) {
      g.save(); g.translate(i * 256, 0); g.beginPath(); g.rect(0, 0, 256, 160); g.clip();
      this.content0 = this.panels[i];
      this.drawPanel(g, ctx, i);
      g.restore();
    }
    this.tex.needsUpdate = true;
  }

  private drawPanel(g: CanvasRenderingContext2D, ctx: StageFrameCtx, idx: number): void {
    const W = 256, H = 160;
    const content = this.content0;
    g.fillStyle = '#06080c'; g.fillRect(0, 0, W, H);
    if (content === 'names') {
      const nm = ctx.names ?? ['', ''];
      g.fillStyle = '#ffd21a'; g.fillRect(0, 22, W, 44); g.fillStyle = '#e8122d'; g.fillRect(0, 94, W, 44);
      g.fillStyle = '#111'; g.font = 'bold 26px Impact, sans-serif'; g.textAlign = 'center'; g.fillText(nm[0].slice(0, 14), W / 2, 54);
      g.fillStyle = '#fff'; g.fillText(nm[1].slice(0, 14), W / 2, 126);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = 'bold 16px Impact, sans-serif'; g.fillText('VS', W / 2, 86);
    } else if (content === 'static') {
      for (let k = 0; k < 900; k++) { const v = (Math.sin(k * 12.9898 + (this.n + idx * 7) * 78.233) * 43758.5453) % 1; g.fillStyle = `rgba(220,230,255,${Math.abs(v) * 0.6})`; g.fillRect((k * 37 + this.n * 13) % W, (k * 11 + this.n * 7) % H, 2, 2); }
    } else if (content === 'bars') {
      const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
      cols.forEach((c, k) => { g.fillStyle = c; g.fillRect((k * W) / 7, 0, W / 7 + 1, H * 0.72); });
      g.fillStyle = '#111'; g.fillRect(0, H * 0.72, W, H * 0.28);
    } else if (content === 'logo') {
      g.fillStyle = '#ffd21a'; g.font = 'bold 44px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('K13', W / 2, H / 2 + 14);
      g.strokeStyle = '#e8122d'; g.lineWidth = 6; g.strokeRect(20, 20, W - 40, H - 40);
    } else {
      // 'hud': a live bout feed - two health bars, the clock, a blinking LIVE dot, a sweeping scan bar
      const hp = ctx.hp ?? [1, 1];
      g.fillStyle = '#10141c'; g.fillRect(8, 8, W - 16, 30);
      g.fillStyle = '#ffd21a'; g.fillRect(12, 14, (W / 2 - 22) * Math.max(0, hp[0]), 18);
      g.fillRect(W - 12 - (W / 2 - 22) * Math.max(0, hp[1]), 14, (W / 2 - 22) * Math.max(0, hp[1]), 18);
      g.fillStyle = '#fff'; g.font = 'bold 20px Impact, sans-serif'; g.textAlign = 'center';
      g.fillText(ctx.timer !== undefined && ctx.timer >= 0 ? String(ctx.timer) : '--', W / 2, 32);
      g.font = 'bold 15px Impact, sans-serif'; g.textAlign = 'left';
      if (ctx.names) { g.fillText(ctx.names[0].slice(0, 12), 12, 56); g.textAlign = 'right'; g.fillText(ctx.names[1].slice(0, 12), W - 12, 56); }
      if (this.n % 10 < 6) { g.fillStyle = '#e8122d'; g.beginPath(); g.arc(22, H - 20, 7, 0, 7); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText('LIVE', 34, H - 14); }
      g.fillStyle = 'rgba(120,200,255,0.18)'; g.fillRect(0, (this.n * 9) % H, W, 14);
    }
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);              // scanlines
  }
  dispose(): void { this.tex.dispose(); }
}

/** instanced rain streaks over an area (one draw call) */
class RainView {
  readonly mesh: THREE.InstancedMesh;
  private readonly u = { uTime: { value: 0 }, uTop: { value: 7 }, uColor: { value: new THREE.Color(0.7, 0.8, 1.0) } };
  constructor(spec: DressingSpec) {
    const n = Math.max(100, Math.min(2400, spec.rate ?? 1200));
    const area = spec.area ?? { x: [-12, 12] as [number, number], z: [-8, 3] as [number, number], top: 7 };
    this.u.uTop.value = area.top ?? 7;
    if (spec.color) this.u.uColor.value.set(spec.color);
    const geo = new THREE.PlaneGeometry(0.012, 0.42);
    const off = new Float32Array(n * 4);
    let sd = 5;
    const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < n; i++) { off[i * 4] = area.x[0] + (area.x[1] - area.x[0]) * r(); off[i * 4 + 1] = area.z[0] + (area.z[1] - area.z[0]) * r(); off[i * 4 + 2] = r(); off[i * 4 + 3] = 7 + 4 * r(); }
    geo.setAttribute('aRain', new THREE.InstancedBufferAttribute(off, 4));
    const mat = new THREE.ShaderMaterial({
      name: 'stage-rain', uniforms: this.u, transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        attribute vec4 aRain; uniform float uTime; uniform float uTop; varying float vA;
        void main() {
          float y = uTop - mod( uTime * aRain.w + aRain.z * uTop, uTop );
          vec3 base = vec3( aRain.x + 0.35 * sin( aRain.z * 40.0 ), y, aRain.y );
          vec4 mv = viewMatrix * vec4( base, 1.0 );
          mv.xy += position.xy;
          vA = 0.35 + 0.35 * aRain.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA;
        void main() { gl_FragColor = vec4( uColor, vA ); }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.name = 'stage-rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }
  update(t: number): void { this.u.uTime.value = t; }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

export class StageView {
  readonly group = new THREE.Group();
  readonly def: StageDef;
  /** the one shadow-casting directional light (follows the action) */
  key: THREE.DirectionalLight | null = null;
  lights: THREE.Light[] = [];
  fallback = false;
  crowd: THREE.Object3D[] = [];
  private keyOffset = new THREE.Vector3(-3.5, 6.7, 6.0);
  private keyTargetY = 0.8;
  private spinners: THREE.Object3D[] = [];
  private flickers: THREE.Mesh[] = [];
  private lightFlicker: Flicker[] = [];
  private flames: THREE.Object3D[] = [];
  /** P2 name hooks: `rain_*` streak-card nodes scroll down and wrap every 10 m (STAGES-B rooftop request) */
  private rainNodes: Array<{ o: THREE.Object3D; y0: number }> = [];
  private dress: DressNode[] = [];
  private screens: ScreenFeed[] = [];
  private rain: RainView | null = null;
  private steam: Array<{ at: [number, number, number]; rate: number; size: number; acc: number; color: THREE.Color }> = [];
  private chaseU: Array<{ value: number }> = [];
  private t = 0;
  private env: THREE.Texture | null = null;
  /** view-only full light-pool flicker (PRIME TIME `lights_flicker` beats), seconds left */
  private flickerAll = 0;
  private lightsDimmed = false;
  /** measured read-back: glare grading + dressing hooks */
  readonly report = { glareGraded: [] as string[], dressing: [] as string[] };

  private constructor(def: StageDef) {
    this.def = def;
    this.group.name = 'stage:' + def.id;
  }

  /** the FIXED light pool: stages.json `lights` when the stage ships them, else the view's default rig */
  private buildLights(shadowSize: number): void {
    const specs: LightSpec[] = Array.isArray(this.def.lights) && this.def.lights.length ? this.def.lights : [
      { id: 'fill', type: 'hemisphere', sky: '#c4d2ff', ground: '#2a1f22', intensity: 1.25 },
      { id: 'key', type: 'directional', color: '#fff0dc', intensity: 2.6, position: [-3.5, 7.5, 6.0], target: [0, 0.8, 0], castShadow: true },
      { id: 'front', type: 'directional', color: '#b8c8ff', intensity: 0.35, position: [2, 2.5, 8], target: [0, 1, 0] },
    ];
    let k = 0;
    for (const s of specs) {
      const col = new THREE.Color(s.color ?? '#ffffff');
      let L: THREE.Light;
      switch (s.type) {
        case 'hemisphere': L = new THREE.HemisphereLight(new THREE.Color(s.sky ?? '#ffffff'), new THREE.Color(s.ground ?? '#444444'), s.intensity ?? 1); break;
        case 'ambient': L = new THREE.AmbientLight(col, s.intensity ?? 1); break;
        case 'point': L = new THREE.PointLight(col, s.intensity ?? 1, s.distance ?? 0, s.decay ?? 2); break;
        case 'spot': L = new THREE.SpotLight(col, s.intensity ?? 1, s.distance ?? 0, (s.angleDeg ?? 30) * Math.PI / 180, s.penumbra ?? 0, s.decay ?? 2); break;
        default: L = new THREE.DirectionalLight(col, s.intensity ?? 1);
      }
      L.name = 'light_' + (s.id ?? s.type + k++);
      if (s.position) L.position.set(s.position[0], s.position[1], s.position[2]);
      const tgt = (L as THREE.DirectionalLight).target;
      if (tgt) {
        const t = s.target ?? [0, 0, 0];
        tgt.position.set(t[0], t[1], t[2]);
        this.group.add(tgt);
      }
      // exactly one shadow caster: the first directional that asks for it (fighters on the floor)
      if (s.castShadow && s.type === 'directional' && !this.key) {
        const d = L as THREE.DirectionalLight;
        d.castShadow = true;
        d.shadow.mapSize.set(shadowSize, shadowSize);
        const c = d.shadow.camera;
        c.left = -6.5; c.right = 6.5; c.top = 4.5; c.bottom = -3.0; c.near = 0.5; c.far = 40;
        d.shadow.bias = s.shadow?.bias ?? -0.0004;
        d.shadow.normalBias = s.shadow?.normalBias ?? 0.025;
        d.shadow.radius = 2;
        this.key = d;
        const p = s.position ?? [-3.5, 7.5, 6.0], t = s.target ?? [0, 0.8, 0];
        this.keyOffset.set(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
        this.keyTargetY = t[1];
      }
      if (s.flicker && s.flicker.amp > 0) this.lightFlicker.push({ light: L, base: L.intensity, amp: s.flicker.amp, hz: s.flicker.hz || 7, phase: k * 1.7 });
      L.userData.base0 = L.intensity;
      this.lights.push(L);
      this.group.add(L);
    }
  }

  static async create(assets: Assets, id: string, data: ViewGameData | null, shadowSize = 1024, allowFallback = true): Promise<StageView> {
    const def = stageDef(data, id);
    const v = new StageView(def);
    v.buildLights(shadowSize);
    try {
      if (def.glb && def.glb !== `${id}.glb`) assets.setUrl('stage', id, assets.url('stage', def.glb.replace(/\.glb$/i, '')));
      const a: StageAsset = await assets.stage(id);
      v.group.add(a.scene);
      v.crowd = a.crowd;
      if (a.lights.length) console.warn(`[view] stage "${id}" GLB carries ${a.lights.length} lights; they join the fixed pool`);
    } catch (e) {
      if (!allowFallback) throw e;
      console.warn(`[view] stage "${id}" GLB unavailable (${e instanceof Error ? e.message : String(e)}); using the stand-in set`);
      const fb = buildFallbackSet();
      v.group.add(fb.group);
      v.crowd = fb.crowd;
      v.fallback = true;
    }
    const envSpec = def.environment;
    if (envSpec?.hdr) {
      try {
        const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
        const url = new URL(`../../../art/gltf/stages/${envSpec.hdr}`, import.meta.url).href;
        if (!/\/undefined$/.test(url)) {
          // fetch + parse (not FileLoader): the dev server sends .hdr without a content type and Chrome aborted the
          // FileLoader request (lookshots: net::ERR_ABORTED) although the texture arrived
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const loader = new HDRLoader() as unknown as { createDataTexture(b: ArrayBuffer): THREE.DataTexture };
          const tex = loader.createDataTexture(await res.arrayBuffer());
          tex.mapping = THREE.EquirectangularReflectionMapping;
          tex.needsUpdate = true;
          v.env = tex;
        }
      } catch (e) { console.warn('[view] stage environment HDR failed:', e); }
    }
    v.gradeGlare();
    v.bindScreensByName();
    // a hook binds the TOP node of a match only: gltf-transform splits a multi-material node into `<name>_1`, `<name>_2`
    // children, and scaling those under an already-scaled parent compounded the flicker (butcher_block had 6 flames / 6
    // steam vents for 2 burners)
    const under = (o: THREE.Object3D, re: RegExp): boolean => { for (let q = o.parent; q; q = q.parent) if (re.test(q.name)) return true; return false; };
    v.group.traverse((o) => {
      if (/^anim_spin_/i.test(o.name) && !under(o, /^anim_spin_/i)) v.spinners.push(o);
      if (/^anim_flicker_/i.test(o.name)) o.traverse((x) => { if ((x as THREE.Mesh).isMesh && !v.flickers.includes(x as THREE.Mesh)) v.flickers.push(x as THREE.Mesh); });
      if (/^flame_/i.test(o.name) && !under(o, /^flame_/i)) v.flames.push(o);
      if (/^rain_/i.test(o.name)) v.rainNodes.push({ o, y0: o.position.y });
    });
    if (v.rainNodes.length) v.report.dressing.push(`rain scroll ${v.rainNodes.map((r) => r.o.name).join(',')}`);
    // the P1 name hooks bind silently above; list them so a harness can see what is animated (the p2c run reported only
    // the P2 kinds, which read as if wheel / beacons / neon / burners were static)
    if (v.spinners.length) v.report.dressing.push(`spin ${v.spinners.map((o) => o.name).join(',')} (by name)`);
    const flickNames = new Set<string>();
    v.group.traverse((o) => { if (/^anim_flicker_/i.test(o.name)) flickNames.add(o.name); });
    if (flickNames.size) v.report.dressing.push(`flicker ${[...flickNames].join(',')} x${v.flickers.length} meshes (by name)`);
    if (v.flames.length) v.report.dressing.push(`flame ${v.flames.map((o) => o.name).join(',')} (by name)`);
    // steam by name: `steam_*` nodes vent at their origin; a gas range burner (`flame_range_*`, BUTCHER BLOCK) steams from
    // the pot level above it (view-side dressing, no stages.json entry needed; a `kind: 'steam'` entry adds more)
    v.group.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    const steamNames: string[] = [];
    v.group.traverse((o) => {
      const vent = /^steam_/i.test(o.name) && !under(o, /^steam_/i), range = /^flame_range_/i.test(o.name) && !under(o, /^flame_range_/i);
      if (!vent && !range) return;
      o.getWorldPosition(wp);
      v.steam.push({ at: [wp.x, wp.y + (range ? 0.45 : 0), wp.z], rate: range ? 0.45 : 1, size: range ? 0.55 : 0.8, acc: 0, color: new THREE.Color(range ? '#e4e2de' : '#d8dde6') });
      steamNames.push(o.name);
    });
    if (steamNames.length) v.report.dressing.push(`steam ${steamNames.join(',')} (by name)`);
    v.buildDressing();
    return v;
  }

  /**
   * P2 monitors by NAME (the brief's "monitor screens with live HUD-like content"): mesh nodes whose name contains crt /
   * monitor / screen get the live feed as an unlit screen. Screens without UVs (control_room's 4-screen bank) get a planar
   * UV over their local X/Y bounds, one feed panel per screen along X (panel count = the mesh's disconnected groups by x).
   */
  private bindScreensByName(): void {
    const hits: THREE.Mesh[] = [];
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && /(^|_)(crt|monitor|screen)s?(_|$)/i.test(o.name)) hits.push(o as THREE.Mesh); });
    for (const m of hits) {
      const geo = m.geometry;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      // count screens along x: gaps in the sorted x of the vertices wider than 4 % of the span
      const xs: number[] = [];
      for (let i = 0; i < pos.count; i++) xs.push(pos.getX(i));
      xs.sort((a, b) => a - b);
      const span = Math.max(1e-6, bb.max.x - bb.min.x);
      const cuts: number[] = [];
      for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > span * 0.04) cuts.push((xs[i] + xs[i - 1]) / 2);
      const panels = cuts.length + 1;
      if (!geo.getAttribute('uv')) {
        const uv = new Float32Array(pos.count * 2);
        const hy = Math.max(1e-6, bb.max.y - bb.min.y);
        const edges = [bb.min.x, ...cuts, bb.max.x];
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i);
          let k = 0;
          while (k < panels - 1 && x > edges[k + 1]) k++;
          const u0 = (x - edges[k]) / Math.max(1e-6, edges[k + 1] - edges[k]);
          uv[i * 2] = (k + Math.max(0, Math.min(1, u0))) / panels;
          uv[i * 2 + 1] = (y - bb.min.y) / hy;
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      const feed = new ScreenFeed('hud', panels);
      this.screens.push(feed);
      const sm = new THREE.MeshBasicMaterial({ map: feed.tex, toneMapped: false, fog: false });
      sm.name = 'stage-screen';
      m.material = sm;
      this.flickers = this.flickers.filter((f) => f !== m);
      this.report.dressing.push(`screen ${m.name} x${panels} (by name)`);
    }
  }

  /** P2: marquee glare - sign faces / bulbs with emissive above GLARE_CAP are graded down (the view's grade, not the art) */
  private gradeGlare(): void {
    const seen = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
        if (!mat || seen.has(mat) || !mat.emissive) continue;
        seen.add(mat);
        const e = mat.emissiveIntensity * Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b);
        // neon tubes (ROOFTOP's HIT PARADE letters ship at strength 7): a big lit area blooms into a haze over the fighters
        // (measured in the real game: the whole upper frame washed pink) - capped a little above the bulbs so they still glow
        const neon = /neon/i.test(mat.name);
        const cap = neon ? NEON_CAP : GLARE_CAP;
        if ((neon || /sign|bulb|marquee|lens/i.test(mat.name)) && e > cap) {
          const k = cap / e;
          mat.emissiveIntensity *= /sign/i.test(mat.name) ? k * 0.8 : k;
          this.report.glareGraded.push(`${mat.name} ${e.toFixed(2)} -> ${(mat.emissiveIntensity * Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b)).toFixed(2)}`);
        }
      }
    });
  }

  /** P2: stages.json dressing.animated[] -> view-side animation hooks (CONTRACT §26.6) */
  private buildDressing(): void {
    const list = this.def.dressing?.animated ?? [];
    let k = 0;
    for (const spec of list) {
      const kind = spec.kind;
      if (!kind) continue;
      if (kind === 'rain') { this.rain = new RainView(spec); this.group.add(this.rain.mesh); this.report.dressing.push('rain'); continue; }
      if (kind === 'steam') {
        for (const at of spec.at ?? []) this.steam.push({ at, rate: spec.rate ?? 1, size: spec.size ?? 0.8, acc: 0, color: new THREE.Color(spec.color ?? '#d8dde6') });
        this.report.dressing.push(`steam x${(spec.at ?? []).length}`);
        continue;
      }
      if (!spec.nodes) continue;
      const re = globRe(spec.nodes);
      const hits: THREE.Object3D[] = [];
      this.group.traverse((o) => { if (o.name && re.test(o.name)) hits.push(o); });
      if (!hits.length) { this.report.dressing.push(`${kind} ${spec.nodes}: no nodes`); continue; }
      let feed: ScreenFeed | null = null;
      if (kind === 'screen') { feed = new ScreenFeed(spec.content ?? 'hud'); this.screens.push(feed); }
      for (const o of hits) {
        const d: DressNode = { o, spec, phase: (k++ * 1.618) % 6.283, base: o.rotation.clone() };
        const mats: NonNullable<DressNode['mats']> = [];
        o.traverse((x) => {
          const mm = x as THREE.Mesh;
          if (!mm.isMesh) return;
          if (feed) {
            const sm = new THREE.MeshBasicMaterial({ map: feed.tex, toneMapped: false, fog: false });
            sm.name = 'stage-screen';
            mm.material = sm;
            return;
          }
          for (const mat of (Array.isArray(mm.material) ? mm.material : [mm.material]) as THREE.MeshStandardMaterial[]) {
            if (kind === 'chase' && mat.emissive) this.chaseMaterial(mat);
            mats.push({ m: mat, base: mat.emissiveIntensity ?? 1, col: (mat as unknown as THREE.MeshBasicMaterial).color?.clone() });
          }
        });
        d.mats = mats;
        this.dress.push(d);
      }
      this.report.dressing.push(`${kind} ${spec.nodes} x${hits.length}`);
    }
    // free-text entries (P1 / STAGES-A / STAGES-B "optional chase pattern"): every `*bulbs` node chases by name
    // (marquee_bulbs on four sets, the rooftop's string_bulbs)
    if (!list.some((s) => s.kind === 'chase')) {
      const named: string[] = [];
      this.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!/bulbs$/i.test(o.name)) return;
        o.traverse((x) => {
          const mm = x as THREE.Mesh;
          if (mm.isMesh) for (const mat of (Array.isArray(mm.material) ? mm.material : [mm.material]) as THREE.MeshStandardMaterial[]) if (mat.emissive && !mat.userData.hpChase) { mat.userData.hpChase = true; this.chaseMaterial(mat); }
        });
        named.push(o.name);
        void m;
      });
      if (named.length) this.report.dressing.push(`chase ${named.join(',')} (by name)`);
    }
  }

  /** a running-light chase on an emissive material: bulbs brighten in waves along world x (one uniform, no new mesh) */
  private chaseMaterial(mat: THREE.MeshStandardMaterial): void {
    const u = { value: 0 };
    this.chaseU.push(u);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uChaseT = u;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vChaseW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvChaseW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vChaseW; uniform float uChaseT;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.45 + 0.75 * smoothstep( 0.2, 0.9, sin( ( vChaseW.x + vChaseW.y ) * 5.0 - uChaseT * 7.0 ) * 0.5 + 0.5 );');
    };
    mat.customProgramCacheKey = () => 'hp-chase';
    mat.needsUpdate = true;
  }

  applyTo(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    scene.add(this.group);
    const f = this.def.fog;
    scene.fog = f ? new THREE.Fog(new THREE.Color(f.color as THREE.ColorRepresentation), f.near, f.far) : null;
    scene.background = new THREE.Color(this.def.environment?.backgroundColor ?? 0x07060a);
    if (this.env) {
      scene.environment = this.env;
      scene.environmentIntensity = this.def.environment?.intensity ?? 0.3;
    }
    renderer.toneMappingExposure = this.def.exposure ?? 1.0;
  }

  /** keep the key light's shadow box on the action (called with the camera's mid-X) */
  followShadow(midX: number): void {
    if (!this.key) return;
    this.key.target.position.set(midX, this.keyTargetY, 0);
    this.key.position.copy(this.key.target.position).add(this.keyOffset);
    this.key.target.updateMatrixWorld();
  }

  /** PRIME TIME `lights_flicker`: the whole light pool stutters for `seconds` (view only) */
  flicker(seconds: number): void { this.flickerAll = Math.max(this.flickerAll, seconds); }

  update(dt: number, ctx: StageFrameCtx = {}, spawnSteam?: (at: THREE.Vector3, size: number, color: THREE.Color) => void): void {
    this.t += dt;
    for (const s of this.spinners) s.rotation.y += dt * 0.8;
    for (let i = 0; i < this.flickers.length; i++) {
      const m = this.flickers[i];
      const ph = i * 1.37;
      const on = Math.sin(this.t * 23.0 + ph) + Math.sin(this.t * 7.3 + ph * 2.1) > -1.6 ? 1 : 0.35;
      const std = m.material as THREE.MeshStandardMaterial;
      if (std && std.emissive && (std.emissiveIntensity > 0 || m.userData.baseE !== undefined)) {
        // lit materials (neon tubes, CRT faces): flicker the emissive strength (P1 only touched unlit colours)
        if (m.userData.baseE === undefined) m.userData.baseE = std.emissiveIntensity;
        std.emissiveIntensity = (m.userData.baseE as number) * (on < 1 ? 0.3 : 0.92 + 0.08 * Math.sin(this.t * 61 + ph));
        continue;
      }
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat && mat.color) { if (m.userData.base === undefined) m.userData.base = mat.color.clone(); mat.color.copy(m.userData.base as THREE.Color).multiplyScalar(on); }
    }
    for (const r of this.rainNodes) r.o.position.y = r.y0 - ((this.t * 9.0) % 10.0);
    const all = this.flickerAll > 0 ? (Math.sin(this.t * 61) + Math.sin(this.t * 23.7) > 0.2 ? 0.25 : 1.0) : 1;
    this.flickerAll = Math.max(0, this.flickerAll - dt);
    for (const f of this.lightFlicker) {
      const n = Math.sin(this.t * f.hz * 6.283 + f.phase) * 0.6 + Math.sin(this.t * f.hz * 2.71 * 6.283 + f.phase * 2.3) * 0.4;
      f.light.intensity = f.base * (1 + f.amp * n) * all;
    }
    if (all !== 1 || this.lightsDimmed) {
      for (const L of this.lights) if (!this.lightFlicker.some((x) => x.light === L)) L.intensity = (L.userData.base0 as number) * all;
      this.lightsDimmed = all !== 1;
    }
    for (let i = 0; i < this.flames.length; i++) {
      const o = this.flames[i];
      if (o.userData.baseScale === undefined) o.userData.baseScale = o.scale.y;
      o.scale.y = (o.userData.baseScale as number) * (1 + 0.12 * Math.sin(this.t * 17 + i * 2.1) + 0.06 * Math.sin(this.t * 41 + i));
    }
    for (const u of this.chaseU) u.value = this.t;
    for (const d of this.dress) {
      const s = d.spec, t = this.t;
      switch (s.kind) {
        case 'spin': {
          const a = (s.rpm ?? 6) / 60 * 6.2832 * dt;
          const ax = s.axis ?? 'z';
          if (ax === 'x') d.o.rotation.x += a; else if (ax === 'y') d.o.rotation.y += a; else d.o.rotation.z += a;
          break;
        }
        case 'sway': {
          const a = (s.deg ?? 5) * Math.PI / 180 * Math.sin(t * (s.hz ?? 0.4) * 6.2832 + d.phase);
          d.o.rotation.z = (d.base?.z ?? 0) + a;
          break;
        }
        case 'flicker': case 'blink': case 'flame': {
          let k: number;
          if (s.kind === 'blink') k = Math.sin(t * (s.hz ?? 1) * 6.2832 + d.phase) > 0 ? 1 : 0.08;
          else if (s.kind === 'flame') k = 1 + 0.18 * Math.sin(t * 17 + d.phase) + 0.08 * Math.sin(t * 41 + d.phase * 2);
          else {
            const n = Math.sin(t * (s.hz ?? 7) * 6.2832 + d.phase) * 0.6 + Math.sin(t * (s.hz ?? 7) * 2.3 * 6.2832 + d.phase * 1.7) * 0.4;
            const drop = Math.sin(t * 3.1 + d.phase * 3) > 1 - 2 * (s.dropout ?? 0.04) ? 0.1 : 1;
            k = drop * (1 + (s.amp ?? 0.25) * n);
          }
          for (const mm of d.mats ?? []) {
            const std = mm.m as THREE.MeshStandardMaterial;
            if (std.emissive) std.emissiveIntensity = mm.base * k;
            else if (mm.col) (mm.m as THREE.MeshBasicMaterial).color.copy(mm.col).multiplyScalar(k);
          }
          if (s.kind === 'flame') d.o.scale.y = (d.base ? 1 : 1) * (0.92 + 0.16 * k);
          break;
        }
        case 'scroll': {
          for (const mm of d.mats ?? []) { const mp = (mm.m as THREE.MeshStandardMaterial).map; if (mp) { mp.wrapS = THREE.RepeatWrapping; mp.offset.x = (t * (s.speed ?? 0.15)) % 1; } }
          break;
        }
        default: break;
      }
    }
    for (const sc of this.screens) sc.update(dt, ctx);
    this.rain?.update(this.t);
    if (spawnSteam) {
      for (const st of this.steam) {
        st.acc += dt * st.rate * 8;
        while (st.acc >= 1) { st.acc -= 1; spawnSteam(new THREE.Vector3(st.at[0], st.at[1], st.at[2]), st.size, st.color); }
      }
    }
  }

  raining(): boolean { return !!this.rain; }

  /** live dressing values (harness read-back: two samples a few frames apart prove the hooks move) */
  live(): Record<string, unknown> {
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const flick = this.flickers.slice(0, 4).map((m) => {
      const std = m.material as THREE.MeshStandardMaterial;
      return r3(std && std.emissive && m.userData.baseE !== undefined ? std.emissiveIntensity : ((m.material as THREE.MeshBasicMaterial).color?.r ?? 0));
    });
    return {
      t: r3(this.t), spin: this.spinners.map((o) => r3(o.rotation.y)), flame: this.flames.map((o) => r3(o.scale.y)), flicker: flick,
      rainY: this.rainNodes.map((x) => r3(x.o.position.y)), steam: this.steam.length, screens: this.screens.length,
      dress: this.dress.slice(0, 6).map((d) => `${d.spec.kind}:${d.o.name}`),
    };
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && this.fallback) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const x of mats) { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); }
      }
    });
    for (const s of this.screens) s.dispose();
    this.rain?.dispose();
    this.key?.shadow.map?.dispose();
    this.env?.dispose();
    this.group.removeFromParent();
  }
}

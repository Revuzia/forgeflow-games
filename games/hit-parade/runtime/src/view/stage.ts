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
  private shadowHalf = { l: -6, r: 6 };
  private spinners: THREE.Object3D[] = [];
  private flickers: THREE.Mesh[] = [];
  private lightFlicker: Flicker[] = [];
  private flames: THREE.Object3D[] = [];
  private t = 0;
  private env: THREE.Texture | null = null;

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
        case 'spot': {
          const sp = new THREE.SpotLight(col, s.intensity ?? 1, s.distance ?? 0, (s.angleDeg ?? 30) * Math.PI / 180, s.penumbra ?? 0, s.decay ?? 2);
          L = sp;
          break;
        }
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
    v.group.traverse((o) => {
      if (/^anim_spin_/i.test(o.name)) v.spinners.push(o);
      if (/^anim_flicker_/i.test(o.name) && (o as THREE.Mesh).isMesh) v.flickers.push(o as THREE.Mesh);
      if (/^flame_/i.test(o.name)) v.flames.push(o);
    });
    return v;
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

  update(dt: number): void {
    this.t += dt;
    for (const s of this.spinners) s.rotation.y += dt * 0.8;
    for (const m of this.flickers) {
      const on = Math.sin(this.t * 23.0) + Math.sin(this.t * 7.3) > -1.6 ? 1 : 0.35;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat && mat.color) { if (m.userData.base === undefined) m.userData.base = mat.color.clone(); mat.color.copy(m.userData.base as THREE.Color).multiplyScalar(on); }
    }
    for (const f of this.lightFlicker) {
      const n = Math.sin(this.t * f.hz * 6.283 + f.phase) * 0.6 + Math.sin(this.t * f.hz * 2.71 * 6.283 + f.phase * 2.3) * 0.4;
      f.light.intensity = f.base * (1 + f.amp * n);
    }
    for (let i = 0; i < this.flames.length; i++) {
      const o = this.flames[i];
      if (o.userData.baseScale === undefined) o.userData.baseScale = o.scale.y;
      o.scale.y = (o.userData.baseScale as number) * (1 + 0.12 * Math.sin(this.t * 17 + i * 2.1) + 0.06 * Math.sin(this.t * 41 + i));
    }
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
    this.key?.shadow.map?.dispose();
    this.env?.dispose();
    this.group.removeFromParent();
  }
}

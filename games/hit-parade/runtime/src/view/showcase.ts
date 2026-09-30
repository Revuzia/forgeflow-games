// HIT PARADE - character-select / VS-screen turntable (CONTRACT §16 Showcase; UI's UiShowcase adds setRect / hide).
//
// Its own scene, camera and light rig, drawn into a REGION of the shared canvas: the model renders into a 4x MSAA
// HalfFloat target the size of the region (the context itself has no MSAA, renderer.ts), then OutputPass (tone
// mapping + sRGB) blits it into the region via viewport + scissor. The pose is free-running (menu time, not the sim):
// 'idle' loops idle, 'intro' plays the fighter's intro clip (else its first win clip), 'win' its first win clip.
// The fighter wears the same toon material + outline as in a bout, with the chosen colour alternate.

import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Renderer } from './renderer.ts';
import type { Assets } from './assets.ts';
import { FighterView } from './fighters.ts';
import { setOutlineViewport } from './toon.ts';
import type { ViewGameData } from './types.ts';

export type ShowPose = 'idle' | 'intro' | 'win';
export interface Rect { x: number; y: number; w: number; h: number }

export class Showcase {
  private readonly r: Renderer;
  private readonly a: Assets;
  private readonly data: ViewGameData | null;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 0.75, 0.1, 50);
  private fv: FighterView | null = null;
  private clip = 'idle';
  private loop = true;
  private t = 0;
  private yaw = 0.35;
  private rect: Rect | null = null;
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly out = new OutputPass();
  private token = 0;
  visible = true;
  /** turntable speed (rad/s); 0 = hold the 3/4 view */
  spin = 0.25;

  constructor(r: Renderer, a: Assets, data?: ViewGameData) {
    this.r = r;
    this.a = a;
    this.data = data ?? null;
    this.scene.name = 'showcase';
    this.scene.background = null;
    this.scene.add(new THREE.HemisphereLight(0xd8e0ff, 0x30262a, 1.3));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(-2.5, 4, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = -1.5; sc.right = 1.5; sc.top = 2.5; sc.bottom = -0.5; sc.near = 0.5; sc.far = 15;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.camera.position.set(0, 1.05, 5.2);
    this.camera.lookAt(0, 0.98, 0);
  }

  /** the canvas region (CSS px, top-left origin); null = the whole canvas */
  setRect(r: Rect | null): void { this.rect = r; }
  hide(): void { this.visible = false; }

  async show(fighterId: string, color: number, pose: ShowPose): Promise<void> {
    const my = ++this.token;
    this.visible = true;
    const asset = await this.a.fighter(fighterId);
    if (my !== this.token) return;                       // a newer show() won the race (epoch guard)
    const def = this.data?.fighters[fighterId];
    if (this.fv && (this.fv.id !== fighterId || this.fv.root.userData.color !== color)) { this.fv.dispose(); this.fv = null; }
    if (!this.fv) {
      this.fv = new FighterView(this.a, asset, [], def, color, true);
      this.fv.root.userData.color = color;
      this.fv.model.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.hpHull) o.castShadow = true; });
      this.scene.add(this.fv.root);
    }
    const has = (c: string | undefined): c is string => !!c && asset.clips.has(c);
    const win = def?.win?.find(has) ?? (asset.clips.has('win1') ? 'win1' : undefined);
    if (pose === 'idle') { this.clip = 'idle'; this.loop = true; }
    else if (pose === 'intro') { this.clip = has(def?.intro) ? def!.intro! : win ?? 'idle'; this.loop = false; }
    else { this.clip = win ?? 'idle'; this.loop = false; }
    this.t = 0;
  }

  frame(dt: number): void {
    if (!this.fv) return;
    this.t += dt;
    this.yaw += this.spin * dt;
    const d = this.fv.pose.dur(this.clip);
    const t = this.loop || d <= 0 ? this.t : Math.min(this.t, d - 1e-3);
    this.fv.pose.poseClip(this.clip, t);
    this.fv.root.rotation.set(0, this.yaw, 0);
    const k = 1.8 / Math.max(1, this.fv.heightM);          // tall bodies framed like the rest
    this.fv.root.scale.setScalar(Math.min(1, k));
  }

  render(): void {
    if (!this.visible || !this.fv) return;
    const three = this.r.three;
    this.r.resize();
    const css = this.r.css, pr = three.getPixelRatio();
    const R = this.rect ?? { x: 0, y: 0, w: css.x, h: css.y };
    const w = Math.max(1, Math.round(R.w * pr)), h = Math.max(1, Math.round(R.h * pr));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      this.rt.texture.name = 'showcase-rt';
    }
    this.camera.aspect = R.w / Math.max(1, R.h);
    this.camera.updateProjectionMatrix();
    setOutlineViewport(w, h);
    const prevTarget = three.getRenderTarget();
    three.setRenderTarget(this.rt);
    three.setClearColor(0x000000, 0);
    three.clear(true, true, true);
    three.render(this.scene, this.camera);
    // blit into the region (y from the bottom in GL)
    const vy = css.y - R.y - R.h;
    three.setViewport(R.x, vy, R.w, R.h);
    three.setScissor(R.x, vy, R.w, R.h);
    three.setScissorTest(true);
    this.out.renderToScreen = true;
    this.out.render(three, null as unknown as THREE.WebGLRenderTarget, this.rt, 0, false);
    three.setScissorTest(false);
    three.setViewport(0, 0, css.x, css.y);
    three.setRenderTarget(prevTarget);
    three.setClearColor(0x0b0a10, 1);
    setOutlineViewport(this.r.buffer.x, this.r.buffer.y);
  }

  dispose(): void {
    this.fv?.dispose();
    this.rt?.dispose();
    this.out.dispose();
  }
}

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
  /** region clear colour (sRGB hex) behind the model */
  backdrop = 0x1d0d1b;

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
    // CHANGED(integrator): an opaque backdrop (the menus' ink purple): the context has alpha:false, so the region's clear
    // colour IS what shows through the character-select mask hole (was transparent black -> a black box)
    three.setClearColor(this.backdrop, 1);
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

  /**
   * CHANGED(integrator): a head-and-shoulders portrait (PNG data URL, transparent background) of the fighter in colour
   * `color`, idle pose, 3/4 view, same toon material + outline as in a bout. UI (CONTRACT §22.3) shows these in the
   * select grid / side cards / HUD / VS / results instead of the initials badge. Renders into its own targets and
   * restores the renderer state; the shared canvas is not touched. null when the asset cannot load.
   */
  async portrait(fighterId: string, color = 0, size = 256): Promise<string | null> {
    let asset;
    try { asset = await this.a.fighter(fighterId); } catch { return null; }
    const def = this.data?.fighters[fighterId];
    const fv = new FighterView(this.a, asset, [], def, color, true);
    // CHANGED(fixer) D5: hair / lash cutouts (alphaTest) are not smoothed by MSAA; alpha-to-coverage turns their edges into
    // MSAA coverage in the 4x target, so the large hero portraits (VS splash / results, ~850 CSS px) have no stair-steps.
    fv.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[]) {
        if (mat && mat.alphaTest > 0) { mat.alphaToCoverage = true; mat.needsUpdate = true; }
      }
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd8e0ff, 0x30262a, 1.5));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.8);
    key.position.set(-1.8, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd21a, 1.2);
    rim.position.set(2.5, 2, -2);
    scene.add(rim);
    scene.add(fv.root);
    const three = this.r.three;
    const rtA = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, samples: 4 });
    const rtB = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType });
    try {
      fv.pose.poseClip('idle', 0.4);
      fv.root.rotation.set(0, 0.42, 0);
      fv.root.updateMatrixWorld(true);
      const head = fv.bone('Head');
      const hp = new THREE.Vector3(0, fv.heightM * 0.9, 0);
      if (head) head.getWorldPosition(hp);
      const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
      // CHANGED(fixer) D5: aim a little higher (was hp.y - 0.1: tall / forward-leaning heads touched the top edge)
      const look = new THREE.Vector3(hp.x * 0.6, hp.y - 0.07, hp.z * 0.6);
      cam.position.set(look.x + 0.18, look.y + 0.06, look.z + 1.45);
      cam.lookAt(look);
      const prevTarget = three.getRenderTarget();
      const prevClear = new THREE.Color();
      three.getClearColor(prevClear);
      const prevAlpha = three.getClearAlpha();
      setOutlineViewport(size, size);
      three.setRenderTarget(rtA);
      three.setClearColor(0x000000, 0);
      three.clear(true, true, true);
      three.render(scene, cam);
      this.out.renderToScreen = false;
      this.out.render(three, rtB, rtA, 0, false);
      const px = new Uint8Array(size * size * 4);
      three.readRenderTargetPixels(rtB, 0, 0, size, size, px);
      three.setRenderTarget(prevTarget);
      three.setClearColor(prevClear, prevAlpha);
      setOutlineViewport(this.r.buffer.x, this.r.buffer.y);
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const g = c.getContext('2d');
      if (!g) return null;
      const img = g.createImageData(size, size);
      for (let y = 0; y < size; y++) {              // GL rows are bottom-up
        img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      }
      g.putImageData(img, 0, 0);
      // CHANGED(fixer) D5: WebP with alpha (~10x smaller than PNG at hero sizes); a browser without a WebP encoder returns
      // PNG from the same call (the data URL's own mime says which)
      return c.toDataURL('image/webp', 0.92);
    } catch (e) {
      console.warn('[hit-parade] portrait', fighterId, e);
      return null;
    } finally {
      fv.dispose();
      rtA.dispose();
      rtB.dispose();
    }
  }

  dispose(): void {
    this.fv?.dispose();
    this.rt?.dispose();
    this.out.dispose();
  }
}

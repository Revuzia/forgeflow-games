// VALE render — the hover rim (r12 B1; tokens.json `hud.unitOutline.hover*`). Overlay pass: after the grade, so
// the rim is the exact relationship hex on screen (HARM for enemies and neutrals, ally azure for allies), with
// the overlay's 1 px dark keyline outside it (the rings' and telegraphs' keyline, STYLE_BIBLE "HUD density").
//
// A clean silhouette, never the inverted hull's interior seams or back-face specks:
//   1. mask   the hovered unit's body (its hull geometry, front and back faces, every pixel, occluded or not)
//             into an R8 target;
//   2. rim    the same hull pushed out by the rim width in screen px (back faces), drawn only OUTSIDE the mask
//             and depth-tested by hand against the scene depth (a unit or wall in front hides it; the feet keep
//             their rim on the ground they stand on). First the keyline at width + 1 px in ink, then the rim.
// The meshes are the actor's prebuilt hull copies (actors.ts buildHull), restyled for the draw and restored:
// hovering never adds a node to the scene graph. One hovered unit at a time, so the cost is a handful of draws
// and one R8 clear per frame while something is hovered, nothing otherwise.

import {
  type Camera, type Color, type Material, type Mesh, type Object3D, RedFormat, type RawShaderMaterial, type Scene,
  UnsignedByteType, WebGLRenderTarget, type WebGLRenderer, NearestFilter, Color as ThreeColor,
} from 'three';
import { overlayUniforms } from './depth.ts';
import { hoverMaterials, inkPathOf, type InkPath, type RimU } from '../ink.ts';

/** camera layers the restyled hull copies render on (the match camera only ever draws layer 0) */
const MASK_LAYER = 29;
const RIM_LAYER = 30;
const KEYLINE_ALPHA = 0.45;

export interface HoverTarget {
  readonly model: Object3D;
  /** the body's silhouette meshes (hull geometry, unexpanded) */
  readonly mask: readonly Mesh[];
  /** the outline hull meshes (expanded by the vertex shader) */
  readonly hull: readonly Mesh[];
  readonly px: number;
  readonly color: Color;
  /** the target's own ink materials (the instanced crowd skins on the GPU from baked rows: its `crowd` path, with
   *  hoverRimUniforms()); default: the rigid / skinned ink path of each mesh */
  readonly maskMat?: Material;
  readonly rimMat?: RawShaderMaterial;
}

/** the rim pass' uniforms (uPx, uColor, uAlpha, uMask + the overlay's scene-depth test) */
export function hoverRimUniforms(): Record<string, { value: unknown }> {
  return {
    uPx: { value: 2.5 }, uMask: { value: null }, uColor: { value: new ThreeColor() }, uAlpha: { value: 1 },
    uSceneDepth: overlayUniforms.uSceneDepth, uHasDepth: overlayUniforms.uHasDepth, uResolution: overlayUniforms.uResolution,
    uNear: overlayUniforms.uNear, uFar: overlayUniforms.uFar,
  };
}

interface Saved { mesh: Mesh; material: Material | Material[]; visible: boolean; layers: number }

export class HoverOutline {
  private target: WebGLRenderTarget | null = null;
  /** the mask and rim of each vertex path (ink.ts: the very programs the outline and flash draw with), one rim
   *  uniform set for both */
  private readonly rimU: RimU;
  private readonly mats: Record<'rigid' | 'skin', { mask: RawShaderMaterial; rim: RawShaderMaterial }>;
  private readonly ink = new ThreeColor(0, 0, 0);
  private readonly saved: Saved[] = [];

  constructor(inkHex: string) {
    this.ink.setStyle(inkHex);
    const { uPx, uMask, uColor, uAlpha, ...depth } = hoverRimUniforms();
    this.rimU = { uPx, uMask, uColor, uAlpha } as RimU;
    this.mats = { rigid: hoverMaterials('rigid', this.rimU, depth), skin: hoverMaterials('skin', this.rimU, depth) };
  }

  /** draw the rim of `t` into `out` (the overlay pass' graded buffer); call inside OverlayContext.draw */
  draw(r: WebGLRenderer, cam: Camera, out: ReturnType<WebGLRenderer['getRenderTarget']>, t: HoverTarget): void {
    if (t.px <= 0 || !t.mask.length || !t.hull.length) return;
    const res = overlayUniforms.uResolution.value;
    const w = Math.max(1, Math.round(res.x)), h = Math.max(1, Math.round(res.y));
    if (!this.target) {
      this.target = new WebGLRenderTarget(w, h, { format: RedFormat, type: UnsignedByteType, depthBuffer: false, stencilBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false });
    } else if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const layers = cam.layers.mask;
    const clear = r.getClearColor(new ThreeColor()), clearA = r.getClearAlpha(), autoClear = r.autoClear;
    r.autoClear = false;
    // 1) silhouette mask
    const own = t.maskMat && t.rimMat ? { mask: t.maskMat, rim: t.rimMat } : null;
    this.restyle(t.mask, (m) => own?.mask ?? this.mats[inkPathOf(m) as 'rigid' | 'skin'].mask, MASK_LAYER);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    cam.layers.set(MASK_LAYER);
    r.render(t.model, cam);
    this.restore();
    // 2) keyline (width + 1 px, ink) then the rim, outside the mask
    const u = (own?.rim.uniforms ?? this.rimU) as unknown as RimU;
    u.uMask.value = this.target.texture;
    this.restyle(t.hull, (m) => own?.rim ?? this.mats[inkPathOf(m) as 'rigid' | 'skin'].rim, RIM_LAYER);
    r.setRenderTarget(out);
    cam.layers.set(RIM_LAYER);
    u.uPx.value = t.px + 1; u.uColor.value.copy(this.ink); u.uAlpha.value = KEYLINE_ALPHA;
    r.render(t.model, cam);
    u.uPx.value = t.px; u.uColor.value.copy(t.color); u.uAlpha.value = 1;
    r.render(t.model, cam);
    this.restore();
    cam.layers.mask = layers;
    r.setClearColor(clear, clearA);
    r.autoClear = autoClear;
  }

  /** the hover's programs are the ink programs the actor's outline, flash and shadow already compiled (ink.ts):
   *  nothing of its own to warm (kept for the renderer's attach hook) */
  prewarm(_r: WebGLRenderer, _cam: Camera, _scene: Scene, _t: Pick<HoverTarget, 'mask' | 'hull'>): void {}

  private restyle(meshes: readonly Mesh[], mat: (m: Mesh) => Material, layer: number): void {
    for (const m of meshes) {
      this.saved.push({ mesh: m, material: m.material, visible: m.visible, layers: m.layers.mask });
      m.material = mat(m); m.visible = true; m.layers.set(layer);
    }
  }

  private restore(): void {
    for (const s of this.saved) { s.mesh.material = s.material; s.mesh.visible = s.visible; s.mesh.layers.mask = s.layers; }
    this.saved.length = 0;
  }

  dispose(): void { this.target?.dispose(); for (const p of Object.values(this.mats)) { p.mask.dispose(); p.rim.dispose(); } }
}

// BLOCKTOOTH — titan select portraits (lane titan-view; CONTRACT §6).
//
// renderPortraits(renderer, size) renders every titan in a 3/4 hero pose into an offscreen,
// multisampled FLOAT render target on the caller's renderer (transparent background, key +
// fill + a coloured rim light + a stepped fresnel rim on a portrait-only material, ink outlines),
// then tone-maps (the renderer's NeutralToneMapping + exposure) and sRGB-encodes the pixels on
// the CPU — three r186 writes linear, un-tonemapped colour into render targets — un-premultiplies
// the MSAA edges and returns PNG data URLs. Renderer state (target, clear colour/alpha,
// autoClear, viewport/scissor) is restored before it resolves.

import * as THREE from 'three';
import type { TitanId, TitanPalette } from '../core/types.ts';
import { TITAN_IDS } from '../core/types.ts';
import { applyGlow, buildTitanModel, setTitanRim } from './models.ts';
import type { TitanModel } from './models.ts';
import { TitanAnimator } from './anim.ts';
import type { AnimState } from './anim.ts';

interface Framing {
  /** model heading (rad): the titan turns toward the viewer's left/right */
  heading: number;
  /** camera elevation (deg) above the look target */
  el: number;
  /** fraction of the frame the silhouette's longer side fills */
  fill: number;
  /** rim colour */
  rim: string;
}

const FRAMING: Record<TitanId, Framing> = {
  molo: { heading: -0.72, el: 16, fill: 0.9, rim: '#bfffe2' },
  voltkite: { heading: -0.62, el: 11, fill: 0.88, rim: '#8ff6ff' },
  hearthback: { heading: -0.55, el: 27, fill: 0.86, rim: '#ffb46b' },
  briarwick: { heading: -0.6, el: 21, fill: 0.88, rim: '#f3ffb0' },
};

// scratch (portrait framing)
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();

/** Posed, skinned vertex sample of the model in world space (every `step`-th vertex of every mesh). */
function samplePoints(model: TitanModel, step: number, out: THREE.Vector3[]): THREE.Vector3[] {
  out.length = 0;
  for (const m of model.meshes) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += step) {
      m.getVertexPosition(i, _v);                 // applies the bone transforms (current pose)
      out.push(_v.clone().applyMatrix4(m.matrixWorld));
    }
  }
  return out;
}

/**
 * Aim + dolly the camera so the posed silhouette is centred and its larger screen extent fills
 * `fill` of the frame (a few fixed-point iterations: perspective makes the fit slightly non-linear).
 */
function frameCamera(cam: THREE.PerspectiveCamera, pts: THREE.Vector3[], elDeg: number, fill: number): void {
  _c.set(0, 0, 0);
  for (const p of pts) _c.add(p);
  _c.multiplyScalar(1 / Math.max(1, pts.length));
  const el = (elDeg * Math.PI) / 180;
  _dir.set(0, Math.sin(el), Math.cos(el));        // camera sits in front (+Z) and above
  let d = 4;
  const tanH = Math.tan((cam.fov * Math.PI) / 360);
  for (let it = 0; it < 4; it++) {
    cam.position.copy(_c).addScaledVector(_dir, d);
    cam.lookAt(_c);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      _v.copy(p).project(cam);
      if (_v.x < x0) x0 = _v.x; if (_v.x > x1) x1 = _v.x;
      if (_v.y < y0) y0 = _v.y; if (_v.y > y1) y1 = _v.y;
    }
    // re-centre: shift the look point by the NDC centre offset at the current distance
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    _c.addScaledVector(_right, ((x0 + x1) / 2) * d * tanH * cam.aspect);
    _c.addScaledVector(_up, ((y0 + y1) / 2) * d * tanH);
    const ext = Math.max((x1 - x0) / 2, (y1 - y0) / 2);
    d *= ext / Math.max(0.05, fill);
  }
  cam.position.copy(_c).addScaledVector(_dir, d);
  cam.lookAt(_c);
  cam.near = Math.max(0.01, d * 0.05);
  cam.far = d * 4 + 4;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

/** Khronos PBR Neutral, identical to three's NeutralToneMapping (incl. exposure) */
function neutral(rgb: [number, number, number], exposure: number): void {
  let r = rgb[0] * exposure, g = rgb[1] * exposure, b = rgb[2] * exposure;
  const start = 0.8 - 0.04, desat = 0.15;
  const x = Math.min(r, g, b);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= off; g -= off; b -= off;
  const peak = Math.max(r, g, b);
  if (peak >= start) {
    const d = 1 - start;
    const np = 1 - (d * d) / (peak + d - start);
    const s = np / peak;
    r *= s; g *= s; b *= s;
    const k = 1 - 1 / (desat * (peak - np) + 1);
    r += (np - r) * k; g += (np - g) * k; b += (np - b) * k;
  }
  rgb[0] = r; rgb[1] = g; rgb[2] = b;
}
const toSrgb = (c: number) => {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

/** portrait hero rim: the model's own stepped fresnel rim (models.ts setTitanRim), full band */
function addRim(model: TitanModel, rim: string): void {
  setTitanRim(model, rim, 0.45, 0.58, 0.66);
}

function heroState(): AnimState {
  return {
    speed01: 0, moving: false, turn: 0, attack: null, attackT: -1, dashT: -1, hurtT: -1, abilityT: -1, growT: -1,
    t: 1.1, kit: { stored: 0.8, cap: 1, wires: 3, turrets: 2 }, speedH: 0, hero: 1, noFlash: true, deadT: -1, aim: 0.2,
  };
}

/**
 * v2 (FEATURES_V2 §8.6, RenderPortraitFn): one titan's portrait in a palette (null = canonical colours).
 * ── L0 SKELETON STUB ── returns the CANONICAL portrait for any palette; lane L10 renders the palette.
 * game.ts caches the result per titan × palette (palette 0 never calls this).
 */
export async function renderPortrait(renderer: THREE.WebGLRenderer, id: TitanId, size: number, _palette: TitanPalette | null): Promise<string> {
  const all = await renderPortraits(renderer, size);
  return all[id] ?? '';
}

export async function renderPortraits(renderer: THREE.WebGLRenderer, size = 256): Promise<Record<TitanId, string>> {
  const S = Math.max(32, Math.min(1024, Math.round(size)));
  const out = {} as Record<TitanId, string>;

  // ── save renderer state ──
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevScissorTest = renderer.getScissorTest();
  const exposure = renderer.toneMappingExposure;
  const neutralTM = renderer.toneMapping === THREE.NeutralToneMapping;

  // ── private stage ──
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight('#fff3e2', 1.7);
  key.position.set(2.2, 3.2, 3.4);
  const rimL = new THREE.DirectionalLight('#ffffff', 1.1);
  rimL.position.set(-3, 2.2, -2.6);
  const hemi = new THREE.HemisphereLight('#e2f4ff', '#40384f', 1.2);
  const amb = new THREE.AmbientLight('#ffffff', 0.3);
  scene.add(key, rimL, hemi, amb);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 60);
  // FLOAT target when the GPU can render + read it (linear HDR → exact CPU tone map); otherwise
  // an 8-bit linear target (slight banding in deep shadow, same framing/colours).
  const floatOk = renderer.extensions.has('EXT_color_buffer_float');
  const rt = new THREE.WebGLRenderTarget(S, S, {
    type: floatOk ? THREE.FloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, samples: 4, depthBuffer: true,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  const px = new Float32Array(S * S * 4);
  const px8 = floatOk ? null : new Uint8Array(S * S * 4);
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx2d = canvas.getContext('2d');
  const img = ctx2d ? ctx2d.createImageData(S, S) : null;
  const rgb: [number, number, number] = [0, 0, 0];
  const pts: THREE.Vector3[] = [];

  try {
    for (const id of TITAN_IDS) {
      const fr = FRAMING[id];
      const model = buildTitanModel(id, { outlinePx: Math.max(3, S / 90) });
      addRim(model, fr.rim);
      rimL.color.set(fr.rim);
      model.root.rotation.y = fr.heading;
      scene.add(model.root);
      const anim = new TitanAnimator(model, id);
      const st = heroState();
      for (let i = 0; i < 24; i++) { st.t += 1 / 30; anim.update(st, 1 / 30); }
      applyGlow(model, 0.85);
      model.root.updateMatrixWorld(true);

      frameCamera(cam, samplePoints(model, 3, pts), fr.el, fr.fill);

      try { await renderer.compileAsync(scene, cam); } catch { /* compile on first render instead */ }
      renderer.setRenderTarget(rt);
      renderer.setScissorTest(false);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
      if (px8) {
        renderer.readRenderTargetPixels(rt, 0, 0, S, S, px8);
        for (let i = 0; i < px8.length; i++) px[i] = px8[i] / 255;
      } else {
        renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
      }
      renderer.setRenderTarget(prevTarget);

      if (img && ctx2d) {
        const d = img.data;
        for (let y = 0; y < S; y++) {
          const src = (S - 1 - y) * S * 4;      // GL rows are bottom-up
          const dst = y * S * 4;
          for (let x = 0; x < S; x++) {
            const i = src + x * 4, o = dst + x * 4;
            const a = px[i + 3];
            if (!(a > 0.002)) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; continue; }
            const ia = 1 / Math.min(1, a);         // MSAA edges are premultiplied against the clear
            rgb[0] = px[i] * ia; rgb[1] = px[i + 1] * ia; rgb[2] = px[i + 2] * ia;
            if (neutralTM) neutral(rgb, exposure);
            d[o] = Math.round(toSrgb(rgb[0]) * 255);
            d[o + 1] = Math.round(toSrgb(rgb[1]) * 255);
            d[o + 2] = Math.round(toSrgb(rgb[2]) * 255);
            d[o + 3] = Math.round(Math.min(1, a) * 255);
          }
        }
        ctx2d.putImageData(img, 0, 0);
        out[id] = canvas.toDataURL('image/png');
      } else {
        out[id] = '';
      }
      scene.remove(model.root);
      model.dispose();
      await Promise.resolve();
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.setScissorTest(prevScissorTest);
    rt.dispose();
    key.dispose(); rimL.dispose(); hemi.dispose(); amb.dispose();
  }
  return out;
}

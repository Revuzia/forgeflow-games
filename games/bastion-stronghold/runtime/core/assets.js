// Asset manager: GLTF/GLB models (cached, cloneable), canvas-texture helpers.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const gltfLoader = new GLTFLoader();
const modelCache = new Map();
const pending = new Map();

export function loadModel(url, name) {
  if (modelCache.has(name)) return Promise.resolve(modelCache.get(name));
  if (pending.has(name)) return pending.get(name);
  const p = new Promise((resolve, reject) => {
    gltfLoader.load(url, (g) => {
      const entry = { scene: g.scene, animations: g.animations || [] };
      modelCache.set(name, entry);
      pending.delete(name);
      resolve(entry);
    }, undefined, (err) => { pending.delete(name); reject(err); });
  });
  pending.set(name, p);
  return p;
}
export function getModel(name) { return modelCache.get(name) || null; }

// Clone with skeleton support. Materials are ALWAYS cloned per instance so
// status flashes never leak across clones; native emissive is remembered.
export function instantiate(name, { tint = null, castShadow = true } = {}) {
  const entry = modelCache.get(name);
  if (!entry) return null;
  const obj = skeletonClone(entry.scene);
  obj.traverse((n) => {
    if (n.isMesh || n.isSkinnedMesh) {
      n.castShadow = castShadow;
      n.receiveShadow = false;
      n.frustumCulled = false;
      n.material = Array.isArray(n.material) ? n.material.map((m) => m.clone()) : n.material.clone();
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        m.userData._origEmissive = m.emissiveIntensity ?? 1;
        m.userData._origEmissiveHex = m.emissive ? m.emissive.getHex() : 0;
        if (tint != null && m.color) m.color.lerp(new THREE.Color(tint), 0.45);
      }
    }
  });
  return { obj, animations: entry.animations };
}

const CLIP_FALLBACKS = {
  move: ['walk', 'run', 'gallop', 'swim_fast', 'swim', 'flying', 'fast_flying', 'crawl', 'jump'],
  death: ['death', 'dead', 'die'],
  idle: ['idle', 'flying_idle', 'swim'],
};
export function resolveClip(animations, hint, role = 'move') {
  if (!animations || !animations.length) return null;
  const names = animations.map((a) => a.name);
  const lower = names.map((n) => n.toLowerCase());
  const h = hint ? hint.toLowerCase() : '';
  if (h) {
    for (let i = 0; i < lower.length; i++) {
      const parts = lower[i].split('|');
      if (parts[parts.length - 1] === h) return animations[i];
    }
    for (let i = 0; i < lower.length; i++) if (lower[i].includes(h)) return animations[i];
  }
  for (const fb of CLIP_FALLBACKS[role] || []) {
    for (let i = 0; i < lower.length; i++) {
      const parts = lower[i].split('|');
      if (parts[parts.length - 1] === fb) return animations[i];
    }
    for (let i = 0; i < lower.length; i++) if (lower[i].includes(fb)) return animations[i];
  }
  return animations[0];
}

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function spriteTexture(color = '#ffffff', inner = 0.0, size = 64) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, inner * w / 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.4, color + 'cc');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

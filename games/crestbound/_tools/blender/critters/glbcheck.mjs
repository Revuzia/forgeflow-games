/**
 * Load every kit GLB through the SAME three.js + GLTFLoader the game ships (assets/vendor/three), headless,
 * and report what the runtime will actually see: skinned meshes, bones, clips (+ durations), materials
 * (textures / transparency / emissive), rest-pose bounds, the loader's naturalHeight scale, and which clip
 * the runtime's CLIP_MAP substring rule would pick for each state it requests.
 *
 *   node _tools/blender/critters/glbcheck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = path.resolve(here, '..', '..', '..');
const vendor = path.join(game, 'assets', 'vendor', 'three');
const THREE = await import(pathToFileURL(path.join(vendor, 'build', 'three.module.js')).href);
// GLTFLoader imports 'three' bare: resolve it through a tiny loader hook-free trick — the vendored addons
// import from '../../../build/three.module.js' relatively, so this just works.
const { GLTFLoader } = await import(pathToFileURL(path.join(vendor, 'examples', 'jsm', 'loaders', 'GLTFLoader.js')).href);

// Headless texture stub: every texture resolves immediately with a 2x2 fake image (we only inspect wiring).
THREE.TextureLoader.prototype.load = function (url, onLoad) {
  const t = new THREE.Texture({ width: 2, height: 2, src: String(url).slice(0, 40) });
  setTimeout(() => onLoad && onLoad(t), 0);
  return t;
};
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const CLIP_MAP = {   // copied verbatim from runtime/entities/critters.js (2026-09-07)
  idle: ['idle', 'breath', 'stand'],
  walk: ['walk', 'run', 'move', 'fly'],
  telegraph: ['charge', 'windup', 'prepare', 'idle'],
  attack: ['attack', 'bite', 'jump', 'lunge', 'stomp'],
  hit: ['hitreact', 'hit', 'damage', 'stun'],
  dizzy: ['dizzy', 'stun', 'idle'],
  squish: ['death', 'die', 'flat'],
  death: ['death', 'die', 'fall'],
  roar: ['roar', 'yell', 'taunt', 'attack'],
};
const RUNTIME_STATES = {   // states each class actually passes to _playClip (grep of critters.js)
  gnasher: ['idle', 'telegraph', 'attack'],
  bumbler: ['walk', 'squish'],
  skitter: ['walk', 'attack'],
  warden: ['idle', 'roar', 'telegraph', 'walk', 'dizzy', 'hit', 'death'],
  fen: ['idle'],
};
const NATURAL = { gnasher: 1.1, bumbler: 0.924, skitter: 0.6, warden: 2.7, fen: 1.7 };

function resolve(clips, state) {
  const names = CLIP_MAP[state] || CLIP_MAP.idle;
  for (const n of names) for (const c of clips) if (c.name.toLowerCase().indexOf(n) >= 0) return { clip: c.name, via: n };
  return { clip: clips[0].name, via: 'FALLBACK clips[0]' };
}

const dir = path.join(game, 'assets', 'models', 'critters');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
const report = {};
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  const root = gltf.scene;
  const info = { skinned: 0, meshes: 0, bones: [], materials: [], lights: 0 };
  root.traverse((o) => {
    if (o.isLight) info.lights++;
    if (o.isBone) info.bones.push(o.name);
    if (o.isMesh) {
      info.meshes++;
      if (o.isSkinnedMesh) info.skinned++;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (!info.materials.some((x) => x.name === m.name)) info.materials.push({
        name: m.name, type: m.type, map: !!m.map, normalMap: !!m.normalMap, roughnessMap: !!m.roughnessMap, metalnessMap: !!m.metalnessMap,
        aoMap: !!m.aoMap, transparent: m.transparent, opacity: +m.opacity.toFixed(2), side: m.side,
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null, emissiveIntensity: m.emissiveIntensity,
        metalness: m.metalness, roughness: m.roughness, mapColorSpace: m.map ? m.map.colorSpace : null,
      });
      const tris = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      info.tris = (info.tris || 0) + tris;
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  const h = box.max.y - box.min.y;
  const name = f.replace('.glb', '');
  info.bounds = { min: box.min.toArray().map((v) => +v.toFixed(3)), max: box.max.toArray().map((v) => +v.toFixed(3)), height: +h.toFixed(3) };
  if (NATURAL[name]) info.runtime_scale = +(NATURAL[name] / h).toFixed(3);
  info.clips = gltf.animations.map((c) => ({ name: c.name, duration: +c.duration.toFixed(3), tracks: c.tracks.length }));
  if (gltf.animations.length) {
    // drive one clip and confirm bones actually move
    const mixer = new THREE.AnimationMixer(root);
    const clip = gltf.animations[Math.min(1, gltf.animations.length - 1)];
    const a = mixer.clipAction(clip); a.play();
    root.updateMatrixWorld(true);
    const bone = info.bones.length > 2 ? root.getObjectByName(info.bones[2]) : null;
    const before = bone ? bone.matrixWorld.clone() : null;
    mixer.update(clip.duration * 0.45);
    root.updateMatrixWorld(true);
    const moved = bone ? !bone.matrixWorld.equals(before) : null;
    info.clip_drives_bones = { clip: clip.name, bone: bone ? bone.name : null, moved };
    if (RUNTIME_STATES[name]) info.runtime_state_resolution = Object.fromEntries(RUNTIME_STATES[name].map((s) => [s, resolve(gltf.animations, s)]));
  }
  report[name] = info;
}
console.log(JSON.stringify(report, null, 1));

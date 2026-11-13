/**
 * Dungeon Forge — runtime/3d/thumbs.js
 * Offscreen thumbnail renderer. Renders a 3D model (enemy / NPC / prop) once to
 * a cached PNG data URL so the builder's picker palettes can show an IMAGE of
 * each option instead of a text name. One dedicated WebGL context, reused for
 * the life of the session; results cached by key (theme:kind:id).
 */
import * as THREE from "three";

export class Thumbnailer {
  constructor(size = 128) {
    this.size = size;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = size;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4056, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 6, 5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x99aaff, 0.5); fill.position.set(-4, 2, -4); this.scene.add(fill);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.02, 500);
    this.cache = new Map();
  }

  /** Render `obj` (added then removed; recentred + framed) to a PNG data URL. */
  render(obj) {
    const holder = new THREE.Group();
    holder.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return null;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);                 // recentre model at the holder origin
    holder.rotation.y = -0.5;                 // 3/4 view
    this.scene.add(holder);
    const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.5;
    const dist = (radius / Math.sin((this.cam.fov * Math.PI / 180) / 2)) * 1.18;
    this.cam.position.set(dist * 0.42, dist * 0.46, dist * 0.9);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld(true);
    let url = null;
    try { this.renderer.render(this.scene, this.cam); url = this.canvas.toDataURL("image/png"); }
    catch (e) { url = null; }
    this.scene.remove(holder);
    return url;
  }

  /** Cached lookup: `make()` builds the model only on first request for `key`. */
  get(key, make) {
    if (this.cache.has(key)) return this.cache.get(key);
    let url = null;
    try { const obj = make(); if (obj) url = this.render(obj); } catch (e) { url = null; }
    this.cache.set(key, url);
    return url;
  }

  dispose() { try { this.renderer.forceContextLoss(); this.renderer.dispose(); } catch (e) {} this.cache.clear(); }
}

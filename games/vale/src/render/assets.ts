// VALE render — asset cache (GLB, equirect HDR, .cube LUT). One load per URL, shared promises.
//
// Asset refs are catalog AssetRefs (`assets/...`); `assetUrl` (from boot: resolves against the
// manifest directory) turns them into fetchable URLs. A failed or EMPTY asset (a GLB with no mesh,
// e.g. a placeholder written before the art lands) resolves to null: callers then skip the visual
// (or draw the ?dev=1 debug placeholder) — never a crash, never a primitive shipped as art.
//
// perf PERF-C2 (a session held ~4.7 GB across Chrome's renderer and GPU processes after one pass over the maps):
//   release(inUse, keep)  at Home (Renderer.setScene('menu')): every landed model / tiling texture / sky that nothing
//                         on screen draws (inUse: the menu scene's geometries, materials and textures) and that was
//                         not asked for since mark() is disposed on the GPU and dropped from the cache, so its
//                         decoded images and buffers can be collected. The next match loads what it needs again
//                         behind its loading screen.
//   closed bitmaps        a GLB's ImageBitmap is closed once three has uploaded it (texture.onUpdate) when its
//                         Source feeds one texture only; the GPU copy is all that stays. Such a texture cannot
//                         upload twice: a GPU context loss first gives every closed source a 1×1 stand-in
//                         (contextLost(): frames drawn while the view restores upload that, never a detached
//                         bitmap), then restoreImages() fetches and decodes every such GLB again and swaps each
//                         texture's source in place (GLTFLoader's parser.associations gives each texture its glTF
//                         index), disposing the stand-in's GL texture so the real size is allocated.

import {
  type BufferGeometry, type DataTexture, type Material, type Mesh, type SkinnedMesh, FloatType, HalfFloatType, LinearMipmapLinearFilter, type Object3D, RepeatWrapping, SRGBColorSpace, type Texture,
  TextureLoader, type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LUTCubeLoader, type LookupTexture } from 'postprocessing';

export type AssetUrlFn = (ref: string) => string;

export interface LoadedModel {
  gltf: GLTF;
  /** true when the GLB contains at least one mesh */
  renderable: boolean;
  skinned: boolean;
}

/** every GPU resource reachable from a value (an Object3D tree, a geometry / texture / material, or plain objects,
 *  arrays and maps of them up to a few levels: a template with its hull, LOD and crowd bake) into `out` */
export function collectGpu(v: unknown, out: Set<object>, depth = 0): void {
  if (!v || typeof v !== 'object' || depth > 5) return;
  const o = v as Record<string, unknown> & { isObject3D?: boolean; isBufferGeometry?: boolean; isTexture?: boolean; isMaterial?: boolean };
  if (o.isObject3D) {
    (v as Object3D).traverse((n) => {
      const m = n as Mesh & SkinnedMesh & { customDepthMaterial?: Material; customDistanceMaterial?: Material };
      if (m.geometry) out.add(m.geometry as BufferGeometry);
      for (const mat of [m.material, m.customDepthMaterial, m.customDistanceMaterial].flat()) if (mat) collectGpu(mat, out, 5);
      if (m.isSkinnedMesh && m.skeleton?.boneTexture) out.add(m.skeleton.boneTexture);
    });
    return;
  }
  if (o.isBufferGeometry || o.isTexture) { out.add(o); return; }
  if (o.isMaterial) {
    if (out.has(o)) return;
    out.add(o);
    for (const x of Object.values(o)) if (x && typeof x === 'object' && (x as { isTexture?: boolean }).isTexture) out.add(x);
    const u = (o as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
    if (u) for (const k in u) { const x = u[k]?.value; if (x && typeof x === 'object' && (x as { isTexture?: boolean }).isTexture) out.add(x); }
    return;
  }
  if (Array.isArray(v)) { for (const x of v) collectGpu(x, out, depth + 1); return; }
  if (v instanceof Map) { for (const x of v.values()) collectGpu(x, out, depth + 1); return; }
  const proto = Object.getPrototypeOf(v);
  if (proto === Object.prototype || proto === null) for (const x of Object.values(o)) collectGpu(x, out, depth + 1);
}

/**
 * round 4 MEM-1 refix: a landed GLB's parser kept the file's whole binary chunk (GLTFBinaryExtension.body, a copy of the
 * BIN: the meshopt-compressed geometry and every embedded image's encoded bytes) and its dependency cache ('buffer:0'
 * resolves to that same body) for as long as the model stays landed: about the size of the GLB again, per model, for the
 * whole match. Once loadAsync has resolved, every mesh, image and clip is built (geometry views are decoded into their own
 * buffers, images into ImageBitmaps), and nothing here asks the parser for a dependency again (restoreImages /
 * restoreModel load the file afresh; only parser.associations is read, and it stays).
 */
function dropParserData(gltf: GLTF): void {
  const p = gltf.parser as unknown as { extensions?: Record<string, { body?: ArrayBuffer | null } | undefined>; cache?: { removeAll?: () => void } };
  const bin = p.extensions?.KHR_binary_glTF;
  if (bin) bin.body = null;
  p.cache?.removeAll?.();
}

/** dispose every GPU resource in `res` that `inUse` does not hold (three uploads a disposed one again on its next
 *  use, so a stale reference elsewhere still draws) */
export function disposeGpu(res: Iterable<object>, inUse: Set<object>): number {
  let n = 0;
  for (const r of res) {
    if (inUse.has(r)) continue;
    const d = r as { dispose?: () => void };
    if (typeof d.dispose === 'function') { d.dispose(); n++; }
  }
  return n;
}

/** a built catalog rewrites every asset it found to `assets/<sha12>-<name>`; an unrewritten ref is known
 *  missing (--allow-missing-assets) and is never requested (no 404 per menu visit) — CatalogView.isBuilt's rule */
function built(ref: string): boolean { return /^assets\/[0-9a-f]{12}-/.test(ref) || /^(https?:|data:|blob:|\/)/.test(ref); }

export class Assets {
  private readonly gltfLoader: GLTFLoader;
  private readonly hdrLoader: HDRLoader;
  private readonly lutLoader = new LUTCubeLoader();
  private readonly models = new Map<string, Promise<LoadedModel | null>>();
  private readonly hdrs = new Map<string, Promise<DataTexture | null>>();
  private readonly luts = new Map<string, Promise<LookupTexture | null>>();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  /** what has landed (release() can only judge a resolved entry; a pending one is always kept) */
  private readonly landedModels = new Map<string, { url: string; m: LoadedModel | null }>();
  private readonly landedHdrs = new Map<string, DataTexture | null>();
  private readonly landedTextures = new Map<string, Texture | null>();
  /** keys asked for since mark() (always kept by release()) */
  private readonly touched = new Set<string>();
  /** perf PERF-C2: close a GLB's ImageBitmaps once uploaded (see the header) */
  closeBitmaps = true;
  /** bitmaps closed so far (perf_1080's memory step reads it) */
  closedBitmaps = 0;
  private readonly texLoader = new TextureLoader();
  readonly failed = new Set<string>();
  /** silence per-asset warnings (missing art is expected while the art lane works) */
  quiet = false;
  private pending = 0;
  private done = 0;
  onProgress: ((done: number, total: number) => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly url: AssetUrlFn;

  constructor(renderer: WebGLRenderer, url: AssetUrlFn) {
    this.renderer = renderer;
    this.url = url;
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.hdrLoader = new HDRLoader();
    this.hdrLoader.setDataType(renderer.capabilities.isWebGL2 ? HalfFloatType : FloatType);
  }

  resolve(ref: string): string { return this.url(ref); }

  /**
   * round 5 MEM-4: at most LOAD_SLOTS GLBs are fetched, parsed and decoded at once. A loading screen asked for every
   * model of the match together (Promise.all), so every file's bytes, its parse garbage and every decoded image were
   * alive at the same moment before the first one could upload and close; in slots, each lands, uploads and frees in
   * turn and the peak is a few files deep. A slot frees when its load settles (the model is then built, so the next
   * file starts while this one uploads)
   */
  private static readonly LOAD_SLOTS = 4;
  private inFlight = 0;
  private readonly slotQueue: (() => void)[] = [];
  private gate<T>(job: () => Promise<T>): Promise<T> {
    // a settled load hands its slot straight to the next queued one (the count never overshoots)
    const run = (): Promise<T> => job().finally(() => { const next = this.slotQueue.shift(); if (next) next(); else this.inFlight--; });
    if (this.inFlight < Assets.LOAD_SLOTS) { this.inFlight++; return run(); }
    return new Promise<void>((res) => this.slotQueue.push(res)).then(run);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending++;
    this.onProgress?.(this.done, this.pending);
    return p.finally(() => { this.done++; this.onProgress?.(this.done, this.pending); });
  }

  /** `warmOnly`: the caller only warms the cache (Renderer.preload), so an evicted model is not restored for it */
  model(ref: string | undefined | null, warmOnly = false): Promise<LoadedModel | null> {
    if (!ref || !built(ref)) return Promise.resolve(null);
    return this.loadModel(ref, this.url(ref), warmOnly);
  }

  /** a model by absolute URL (dev-only stand-ins that are not catalog assets) */
  modelUrl(url: string): Promise<LoadedModel | null> { return this.loadModel(`url:${url}`, url); }

  /** true when a model ref is known to have failed or to be empty */
  missing(ref: string): boolean { return this.failed.has(ref); }

  private loadModel(key: string, url: string, warmOnly = false): Promise<LoadedModel | null> {
    this.touched.add(key);
    let p = this.models.get(key);
    // round 4 MEM-1: an evicted model's images come back before anyone who may draw it gets it (see evictUnused)
    const ev = this.landedModels.get(key);
    if (p && ev?.m && !warmOnly && this.evicted.has(key)) {
      this.evicted.delete(key);
      const m = ev.m;
      p = this.track(this.restoreModel(ev.url, m).then(() => m));
      this.models.set(key, p);
      // the closed bitmaps of a restored model close again once uploaded
      if (this.closeBitmaps) void p.then((x) => { if (x) this.closeAfterUpload(x.gltf); });
      return p;
    }
    if (!p) {
      p = this.track(this.gate(() => this.gltfLoader.loadAsync(url)).then((gltf) => {
        let renderable = false, skinned = false;
        gltf.scene.traverse((o: Object3D) => {
          const m = o as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean };
          if (m.isMesh) renderable = true;
          if (m.isSkinnedMesh) skinned = true;
        });
        if (!renderable) this.failed.add(key);
        if (this.closeBitmaps) this.closeAfterUpload(gltf);
        dropParserData(gltf);
        return { gltf, renderable, skinned };
      }).catch((err: unknown) => {
        this.failed.add(key);
        if (!this.quiet) console.warn(`[vale/render] model ${key} unavailable: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
        return null;
      }).then((m) => { if (this.models.get(key) === p) this.landedModels.set(key, { url, m }); return m; }));
      this.models.set(key, p);
    }
    return p;
  }

  /** the GLB's textures whose Source feeds exactly one texture: close the bitmap once three has uploaded it */
  private closeAfterUpload(gltf: GLTF): void {
    const tex = new Set<object>();
    collectGpu(gltf.scene, tex);
    const bySource = new Map<object, Texture[]>();
    for (const t of tex) {
      const x = t as Texture;
      if (!x.isTexture || !x.source) continue;
      const l = bySource.get(x.source) ?? [];
      l.push(x); bySource.set(x.source, l);
    }
    for (const [src, l] of bySource) {
      const img = (src as { data?: unknown }).data as { close?: () => void } | undefined;
      if (l.length !== 1 || typeof ImageBitmap === 'undefined' || !(img instanceof ImageBitmap)) continue;
      const t = l[0];
      t.onUpdate = () => {
        const cur = t.source.data as { close?: () => void } | null;
        if (cur instanceof ImageBitmap) { cur.close(); this.closedBitmaps++; (t.source as { closed?: boolean }).closed = true; }
      };
    }
  }

  /**
   * perf PERF-C2: after a GPU context loss, every landed GLB whose bitmaps were closed is fetched and decoded again
   * and each texture's Source gets the new image (matched by glTF texture index), so three can upload it on the new
   * context. Resolves when every swap is done (textures already re-uploaded meanwhile simply upload once more).
   */
  contextLost(): void {
    if (typeof ImageData === 'undefined') return;
    const stand = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    for (const { m } of this.landedModels.values()) {
      if (!m) continue;
      const res = new Set<object>();
      collectGpu(m.gltf.scene, res);
      for (const t of res) {
        const x = t as Texture;
        if (x.isTexture && (x.source as { closed?: boolean }).closed) x.source.data = stand;
      }
    }
  }

  async restoreImages(): Promise<number> {
    const jobs: Promise<number>[] = [];
    for (const { url, m } of this.landedModels.values()) {
      if (!m) continue;
      const res = new Set<object>();
      collectGpu(m.gltf.scene, res);
      const closed = [...res].filter((t) => (t as Texture).isTexture && ((t as Texture).source as { closed?: boolean }).closed) as Texture[];
      if (!closed.length) continue;
      jobs.push(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then((fresh) => {
        const byIndex = new Map<number, Texture>();
        const fr = new Set<object>();
        collectGpu(fresh.scene, fr);
        for (const t of fr) {
          const a = (fresh.parser.associations.get(t as Texture) as { textures?: number } | undefined)?.textures;
          if ((t as Texture).isTexture && a !== undefined) byIndex.set(a, t as Texture);
        }
        let n = 0;
        for (const t of closed) {
          const a = (m.gltf.parser.associations.get(t) as { textures?: number } | undefined)?.textures;
          const f = a === undefined ? undefined : byIndex.get(a);
          if (!f) continue;
          t.source.data = f.source.data;
          (t.source as { closed?: boolean }).closed = false;
          t.dispose();                                                     // the stand-in's 1×1 storage goes
          t.needsUpdate = true;
          n++;
        }
        // the fresh copy's own GPU side was never uploaded; its other objects are dropped with it
        return n;
      }).catch(() => 0));
    }
    return (await Promise.all(jobs)).reduce((s, x) => s + x, 0);
  }

  /**
   * round 4 MEM-1: a skinned seat's template reads only the clips of its fighter's base model (ModelLibrary.fighterTemplate
   * marks it), so the base model's own images are decoded for nothing: a 2048² base map, the normal and ORM maps, about
   * 18 MB of ImageBitmap per fighter for the whole match (the open bitmaps in a match were such textures, never uploaded).
   * evictUnused() closes them when nothing in `inUse` draws that model (no default-skin template, no menu showcase) and
   * none of them was ever uploaded; each closed source holds a 1×1 stand-in (as contextLost() does). The model is marked,
   * and the next model() asking for it fetches and decodes its images again first (restoreModel), so whatever draws it
   * later draws the real images. Returns the bitmaps closed.
   */
  markClipOnly(ref: string): void { this.clipOnly.add(ref); }
  private readonly clipOnly = new Set<string>();
  private readonly evicted = new Set<string>();
  evictedBitmaps = 0;
  evictUnused(inUse: Set<object>): number {
    if (typeof ImageBitmap === 'undefined' || typeof ImageData === 'undefined') return 0;
    if (this.done < this.pending) return 0;                                 // a model still landing may be about to draw one
    const P = this.renderer.properties as unknown as { get(o: object): { __webglTexture?: unknown } };
    let n = 0;
    for (const key of this.clipOnly) {
      const e = this.landedModels.get(key);
      if (!e?.m || this.evicted.has(key)) continue;
      const res = new Set<object>();
      collectGpu(e.m.gltf.scene, res);
      let drawn = false;
      for (const x of res) if (inUse.has(x) || ((x as Texture).isTexture && P.get(x).__webglTexture !== undefined)) { drawn = true; break; }
      if (drawn) continue;
      let k = 0;
      for (const x of res) {
        const t = x as Texture;
        const img = t.isTexture ? (t.source.data as unknown) : null;
        if (!(img instanceof ImageBitmap) || img.width === 0) continue;
        img.close();
        t.source.data = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
        (t.source as { closed?: boolean }).closed = true;
        k++;
      }
      if (k) { this.evicted.add(key); n += k; }
    }
    this.evictedBitmaps += n;
    return n;
  }

  /** an evicted model's images, fetched and decoded again (restoreImages for one model) */
  private restoreModel(url: string, m: LoadedModel): Promise<number> {
    const res = new Set<object>();
    collectGpu(m.gltf.scene, res);
    const closed = [...res].filter((t) => (t as Texture).isTexture && ((t as Texture).source as { closed?: boolean }).closed) as Texture[];
    if (!closed.length) return Promise.resolve(0);
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then((fresh) => {
      const byIndex = new Map<number, Texture>();
      const fr = new Set<object>();
      collectGpu(fresh.scene, fr);
      for (const t of fr) {
        const a = (fresh.parser.associations.get(t as Texture) as { textures?: number } | undefined)?.textures;
        if ((t as Texture).isTexture && a !== undefined) byIndex.set(a, t as Texture);
      }
      let n = 0;
      for (const t of closed) {
        const a = (m.gltf.parser.associations.get(t) as { textures?: number } | undefined)?.textures;
        const f = a === undefined ? undefined : byIndex.get(a);
        if (!f) continue;
        t.source.data = f.source.data;
        (t.source as { closed?: boolean }).closed = false;
        t.dispose();
        t.needsUpdate = true;
        n++;
      }
      return n;
    }).catch(() => 0);
  }

  /** start a release scope: whatever is asked for from now on is kept by the next release() */
  mark(): void { this.touched.clear(); }

  /**
   * perf PERF-C2: drop and dispose every landed model, tiling texture and sky that nothing in `inUse` draws, that was
   * not asked for since mark() and whose ref is not in `keep` (see the header). Returns what went.
   */
  release(inUse: Set<object>, keep: Set<string> = new Set()): { models: number; textures: number; skies: number; disposed: number } {
    const r = { models: 0, textures: 0, skies: 0, disposed: 0 };
    const held = (key: string): boolean => this.touched.has(key) || keep.has(key) || keep.has(key.replace(/^url:/, ''));
    for (const [key, { m }] of [...this.landedModels]) {
      if (held(key)) continue;
      const res = new Set<object>();
      if (m) collectGpu(m.gltf.scene, res);
      let used = false;
      for (const x of res) if (inUse.has(x)) { used = true; break; }
      if (used) continue;
      r.disposed += disposeGpu(res, inUse);
      this.landedModels.delete(key); this.models.delete(key); this.evicted.delete(key); this.clipOnly.delete(key);
      r.models++;
    }
    for (const [key, t] of [...this.landedTextures]) {
      if (held(key) || (t && inUse.has(t))) continue;
      if (t) { t.dispose(); r.disposed++; }
      this.landedTextures.delete(key); this.textures.delete(key);
      r.textures++;
    }
    for (const [key, t] of [...this.landedHdrs]) {
      if (held(key) || (t && inUse.has(t))) continue;
      if (t) { t.dispose(); r.disposed++; }
      this.landedHdrs.delete(key); this.hdrs.delete(key);
      r.skies++;
    }
    return r;
  }

  hdr(ref: string | undefined | null): Promise<DataTexture | null> {
    if (!ref || !built(ref)) return Promise.resolve(null);
    this.touched.add(ref);
    let p = this.hdrs.get(ref);
    if (!p) {
      p = this.track(this.hdrLoader.loadAsync(this.url(ref)).then((t) => (t.image && (t.image as { width: number }).width > 2 ? t : null))
        .catch((err: unknown) => {
          this.failed.add(ref);
          console.warn(`[vale/render] sky ${ref} failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }).then((t) => { if (this.hdrs.get(ref) === p) this.landedHdrs.set(ref, t); return t; }));
      this.hdrs.set(ref, p);
    }
    return p;
  }

  /** a tiling colour texture (sRGB, repeat, trilinear + anisotropic); null when missing */
  texture(ref: string | undefined | null): Promise<Texture | null> {
    if (!ref || !built(ref)) return Promise.resolve(null);
    this.touched.add(ref);
    let p = this.textures.get(ref);
    if (!p) {
      p = this.track(this.texLoader.loadAsync(this.url(ref)).then((t) => {
        t.colorSpace = SRGBColorSpace;
        t.wrapS = t.wrapT = RepeatWrapping;
        t.minFilter = LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        return t as Texture | null;
      }).catch(() => { this.failed.add(ref); if (!this.quiet) console.warn(`[vale] texture missing: ${ref}`); return null; })
        .then((t) => { if (this.textures.get(ref) === p) this.landedTextures.set(ref, t); return t; }));
      this.textures.set(ref, p);
    }
    return p;
  }

  lut(ref: string | undefined | null): Promise<LookupTexture | null> {
    if (!ref || !built(ref)) return Promise.resolve(null);
    let p = this.luts.get(ref);
    if (!p) {
      p = this.track(this.lutLoader.loadAsync(this.url(ref)).then((t) => t as LookupTexture)
        .catch((err: unknown) => {
          this.failed.add(ref);
          console.warn(`[vale/render] grade ${ref} unavailable (identity LUT used): ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }));
      this.luts.set(ref, p);
    }
    return p;
  }
}

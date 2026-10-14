// VALE render — asset cache (GLB, equirect HDR, .cube LUT). One load per URL, shared promises.
//
// Asset refs are catalog AssetRefs (`assets/...`); `assetUrl` (from boot: resolves against the
// manifest directory) turns them into fetchable URLs. A failed or EMPTY asset (a GLB with no mesh,
// e.g. a placeholder written before the art lands) resolves to null: callers then skip the visual
// (or draw the ?dev=1 debug placeholder) — never a crash, never a primitive shipped as art.

import {
  type DataTexture, FloatType, HalfFloatType, LinearMipmapLinearFilter, type Object3D, RepeatWrapping, SRGBColorSpace, type Texture,
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

export class Assets {
  private readonly gltfLoader: GLTFLoader;
  private readonly hdrLoader: HDRLoader;
  private readonly lutLoader = new LUTCubeLoader();
  private readonly models = new Map<string, Promise<LoadedModel | null>>();
  private readonly hdrs = new Map<string, Promise<DataTexture | null>>();
  private readonly luts = new Map<string, Promise<LookupTexture | null>>();
  private readonly textures = new Map<string, Promise<Texture | null>>();
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

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending++;
    this.onProgress?.(this.done, this.pending);
    return p.finally(() => { this.done++; this.onProgress?.(this.done, this.pending); });
  }

  model(ref: string | undefined | null): Promise<LoadedModel | null> {
    if (!ref) return Promise.resolve(null);
    return this.loadModel(ref, this.url(ref));
  }

  /** a model by absolute URL (dev-only stand-ins that are not catalog assets) */
  modelUrl(url: string): Promise<LoadedModel | null> { return this.loadModel(`url:${url}`, url); }

  /** true when a model ref is known to have failed or to be empty */
  missing(ref: string): boolean { return this.failed.has(ref); }

  private loadModel(key: string, url: string): Promise<LoadedModel | null> {
    let p = this.models.get(key);
    if (!p) {
      p = this.track(this.gltfLoader.loadAsync(url).then((gltf) => {
        let renderable = false, skinned = false;
        gltf.scene.traverse((o: Object3D) => {
          const m = o as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean };
          if (m.isMesh) renderable = true;
          if (m.isSkinnedMesh) skinned = true;
        });
        if (!renderable) this.failed.add(key);
        return { gltf, renderable, skinned };
      }).catch((err: unknown) => {
        this.failed.add(key);
        if (!this.quiet) console.warn(`[vale/render] model ${key} unavailable: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
        return null;
      }));
      this.models.set(key, p);
    }
    return p;
  }

  hdr(ref: string | undefined | null): Promise<DataTexture | null> {
    if (!ref) return Promise.resolve(null);
    let p = this.hdrs.get(ref);
    if (!p) {
      p = this.track(this.hdrLoader.loadAsync(this.url(ref)).then((t) => (t.image && (t.image as { width: number }).width > 2 ? t : null))
        .catch((err: unknown) => {
          this.failed.add(ref);
          console.warn(`[vale/render] sky ${ref} failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }));
      this.hdrs.set(ref, p);
    }
    return p;
  }

  /** a tiling colour texture (sRGB, repeat, trilinear + anisotropic); null when missing */
  texture(ref: string | undefined | null): Promise<Texture | null> {
    if (!ref) return Promise.resolve(null);
    let p = this.textures.get(ref);
    if (!p) {
      p = this.track(this.texLoader.loadAsync(this.url(ref)).then((t) => {
        t.colorSpace = SRGBColorSpace;
        t.wrapS = t.wrapT = RepeatWrapping;
        t.minFilter = LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        return t as Texture | null;
      }).catch(() => { this.failed.add(ref); if (!this.quiet) console.warn(`[vale] texture missing: ${ref}`); return null; }));
      this.textures.set(ref, p);
    }
    return p;
  }

  lut(ref: string | undefined | null): Promise<LookupTexture | null> {
    if (!ref) return Promise.resolve(null);
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

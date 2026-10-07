// VALE render — asset cache (GLB, equirect HDR, .cube LUT). One load per URL, shared promises.
//
// Asset refs are catalog AssetRefs (`assets/...`); `assetUrl` (from boot: resolves against the
// manifest directory) turns them into fetchable URLs. A failed or EMPTY asset (a GLB with no mesh,
// e.g. a placeholder written before the art lands) resolves to null: callers then skip the visual
// (or draw the ?dev=1 debug placeholder) — never a crash, never a primitive shipped as art.

import { type DataTexture, FloatType, HalfFloatType, type Object3D, type WebGLRenderer } from 'three';
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
  readonly failed = new Set<string>();
  private pending = 0;
  private done = 0;
  onProgress: ((done: number, total: number) => void) | null = null;

  constructor(private readonly renderer: WebGLRenderer, private readonly url: AssetUrlFn) {
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
    let p = this.models.get(ref);
    if (!p) {
      const url = this.url(ref);
      p = this.track(this.gltfLoader.loadAsync(url).then((gltf) => {
        let renderable = false, skinned = false;
        gltf.scene.traverse((o: Object3D) => {
          const m = o as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean };
          if (m.isMesh) renderable = true;
          if (m.isSkinnedMesh) skinned = true;
        });
        if (!renderable) this.failed.add(ref);
        return { gltf, renderable, skinned };
      }).catch((err: unknown) => {
        this.failed.add(ref);
        console.warn(`[vale/render] model ${ref} failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }));
      this.models.set(ref, p);
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

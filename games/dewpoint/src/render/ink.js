// The ink pass: every outline in the game is drawn here, in one full-screen pass.
//
// How a frame is drawn
//   1. everything opaque (layer 0)  ->  an off-screen buffer: colour, an "ink id" in alpha (geo.js), depth
//   2. one full-screen triangle     ->  the screen: the colour, plus a dark line wherever the ids of
//                                       neighbouring pixels differ (a crease) or depth jumps (a
//                                       silhouette); it also writes the depth back
//   3. everything see-through (layer 1: water, glass, flames, particles, light) -> the screen, on top,
//                                       depth-tested against the restored depth, never inked
//
// Why this and not an inverted hull or a shader rim. Measured on l01 "The Plate Gallery" and on f03
// (RTX A2000 laptop GPU, medians of 5-7 runs of 20-30 frames; re-run with Renderer.outlineMode =
// 'post' | 'hull' | 'none' and forceTaps / forceSamples). At 3840x2160, where the GPU is the limit:
//                                        l01                      f03
//   no outline, straight to screen       5.7 ms  32 calls 27.6k   3.9 ms  28 calls 19.4k tris
//   inverted hull                        4.8     39       39.2k   4.3     34       25.6k
//   buffer + copy, no ink                6.8     33       27.6k   5.6     29       19.4k
//   ink pass, 4 / 8 / 12 taps            6.6 / 7.5 / 8.2          6.0 / 5.7 / 6.8
//   ink pass 8 / 12 taps, 4x MSAA        9.3 / 10.2               8.2 / 8.9
// (at 1280x720 every row is 2-4 ms and the differences are inside the noise.) So, per megapixel
// on that GPU: ~0.12 ms for the buffer and the copy, ~0.1 ms for eight taps, ~0.2 for twelve,
// ~0.3 for multisampling the buffer; the hull costs no fill to speak of but +21% draw calls and
// +32-42% triangles here, and both grow with the level.
//   - the hull is the cheapest in fill, and loses on everything else: it draws silhouettes only,
//     never the inner lines (where a wall meets a floor, where a box turns a corner - most of the
//     lines in a world built of boxes), it cannot outline the cut-away window, and it adds a draw
//     call and a second copy of the vertices for every mesh it outlines, against a 48-call budget;
//   - a fresnel rim only exists on round things and changes weight with curvature: it can ink a
//     hero, not a level, so it was not a candidate for the whole picture;
//   - the pass costs one extra draw and one triangle whatever the level holds, the line is the same
//     number of pixels wide near and far, and its cost is a fixed price per pixel that the quality
//     tiers scale (4 taps at 1x, 8 at 1.5x, 12 with a multisampled buffer at 2x).
//
// What keeps the line steady: depth is compared as a second difference of the raw depth buffer,
// which is exactly zero across any flat surface whatever its slope (raw depth is linear in screen
// space on a plane), so floors seen at a grazing angle never grow hatching; ids are flat per face,
// so creases never crawl; the taps sit on a fixed pattern in pixels, so the weight never changes
// with distance; and the slight hand-drawn swelling of the line is tied to world position, so it
// does not boil when the camera moves. Far away the line thins into the haze instead of piling up.
//
// Quality tiers only change the buffer (multisampled or not) and the number of taps (4 / 8 / 12).

import * as THREE from '../../vendor/three.module.min.js';
import { INK } from './geo.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;          // one pixel, in uv
  uniform float uRadius;        // half line width, pixels
  uniform vec3 uInk;            // line colour (linear)
  uniform float uInkK;          // line strength
  uniform vec3 uNFB;            // near, far, far*near/(far-near)
  uniform vec2 uFogNF;
  uniform mat4 uInvVP;
  uniform float uTime;
  uniform vec4 uShim[3];        // heat shimmer: centre (uv), radius (uv of height), strength
  uniform float uAspect;
  varying vec2 vUv;

  float viewZ(float d) { return uNFB.x * uNFB.y / (uNFB.y - d * (uNFB.y - uNFB.x)); }

  void main() {
    vec2 uv = vUv;
    #ifdef SHIMMER
      for (int i = 0; i < 3; i++) {
        vec4 s = uShim[i];
        if (s.w > 0.0) {
          vec2 q = (uv - s.xy) * vec2(uAspect, 1.0) / s.z;
          // a column of rising ripples above the source, widening as it climbs
          float col = exp(-q.x * q.x * 2.4 / (1.0 + max(q.y, 0.0))) * smoothstep(-0.25, 0.1, q.y) * (1.0 - smoothstep(0.9, 2.2, q.y));
          uv += vec2(sin(uv.y * 150.0 - uTime * 9.0 + q.x * 6.0), cos(uv.y * 110.0 - uTime * 7.0)) * uTexel.y * 2.2 * s.w * col;
        }
      }
    #endif
    vec4 c0 = texture2D(tColor, uv);
    float d0 = texture2D(tDepth, uv).x;
    vec3 col = c0.rgb;
    #if TAPS > 0
      float z0 = viewZ(d0);
      // hand-inked: the line swells and thins a little, anchored to the world so it does not boil
      vec4 wp = uInvVP * vec4(uv * 2.0 - 1.0, d0 * 2.0 - 1.0, 1.0);
      wp.xyz /= wp.w;
      float near = 1.0 - smoothstep(30.0, 70.0, z0);
      float swell = 1.0 + 0.24 * near * sin(wp.x * 2.3 + wp.y * 3.1 + sin(wp.z * 1.7) * 1.5) * sin(wp.z * 2.9 - wp.y * 1.3 + wp.x * 0.7);
      vec2 r = uTexel * uRadius * swell;
      float dmin = d0;
      float eD = 0.0, eI = 0.0, eD2 = 0.0, eI2 = 0.0;
      #define PAIR(ox, oy, ED, EI) { \\
        vec2 o = vec2(ox, oy) * r; \\
        vec4 ca = texture2D(tColor, uv + o), cb = texture2D(tColor, uv - o); \\
        float da = texture2D(tDepth, uv + o).x, db = texture2D(tDepth, uv - o).x; \\
        ED = max(ED, abs(da + db - 2.0 * d0)); \\
        EI = max(EI, max(abs(ca.a - c0.a) * step(0.006, ca.a), abs(cb.a - c0.a) * step(0.006, cb.a))); \\
        dmin = min(dmin, min(da, db)); }
      #if TAPS == 4
        PAIR(0.92, 0.38, eD, eI)
        PAIR(-0.38, 0.92, eD, eI)
      #else
        PAIR(1.0, 0.0, eD, eI)
        PAIR(0.0, 1.0, eD, eI)
        PAIR(0.707, 0.707, eD, eI)
        PAIR(-0.707, 0.707, eD, eI)
      #endif
      #if TAPS == 12
        // an inner ring: where it also sees the edge the line is full strength, outside it the line
        // is a half tone - a soft shoulder that hides the stair-steps of the edge itself
        PAIR(0.46, 0.19, eD2, eI2)
        PAIR(-0.19, 0.46, eD2, eI2)
      #endif
      float zmin = viewZ(dmin);
      // depth: the second difference as a fraction of the distance (0.012 = a 10 cm step at 8 m)
      float kD = z0 / uNFB.z;
      float inkD = smoothstep(0.011, 0.026, eD * kD);
      // ids: any real difference is an edge; creases fade out in the distance, silhouettes stay
      float idFade = step(0.006, c0.a) * (1.0 - smoothstep(26.0, 64.0, zmin));
      float inkI = smoothstep(0.022, 0.05, eI) * idFade;
      float ink = max(inkD, inkI);
      #if TAPS == 12
        float core = max(smoothstep(0.011, 0.026, eD2 * kD), smoothstep(0.022, 0.05, eI2) * idFade);
        ink = ink * 0.62 + core * 0.38;
      #endif
      // glowing things (id 0) are never drawn over
      ink *= step(0.006, c0.a);
      // thinner with distance, gone in the haze
      ink *= uInkK * mix(1.0, 0.5, smoothstep(14.0, 60.0, zmin)) * (1.0 - 0.9 * smoothstep(uFogNF.x, uFogNF.y, zmin));
      col = mix(col, uInk, ink);
    #endif
    gl_FragColor = vec4(col, 1.0);
    gl_FragDepth = d0;
    #include <colorspace_fragment>
  }`;

export class InkPass {
  constructor(gl) {
    this.gl = gl;
    this.rt = null; this.w = 0; this.h = 0; this.samples = -1;
    this.taps = 8; this.shimmerOn = false;
    this.uniforms = {
      tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 1.2 },
      uInk: { value: new THREE.Color(0x143244) }, uInkK: { value: 0.92 }, uNFB: { value: new THREE.Vector3(0.1, 900, 0.1) },
      uFogNF: { value: new THREE.Vector2(30, 96) }, uInvVP: { value: new THREE.Matrix4() }, uTime: { value: 0 },
      uShim: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uAspect: { value: 1 },
    };
    this.mats = new Map();
    // one triangle that covers the screen
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.tri = new THREE.Mesh(g, null);
    this.tri.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.tri);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._vp = new THREE.Matrix4();
    this.shim = [];           // [{ x, y, z (world), r (metres), k }] set by the renderer every frame
    this._v = new THREE.Vector3();
  }

  _material(taps, shimmer) {
    const key = `${taps}:${shimmer ? 1 : 0}`;
    if (!this.mats.has(key)) {
      this.mats.set(key, new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
        defines: Object.assign({ TAPS: taps }, shimmer ? { SHIMMER: 1 } : {}),
        depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, fog: false, toneMapped: false,
      }));
    }
    return this.mats.get(key);
  }

  /** Size in drawing-buffer pixels; samples: 0 or 4 (multisampled buffer); taps: 0 (no ink) | 4 | 8 | 12. */
  configure(w, h, samples, taps) {
    this.taps = taps;
    if (w === this.w && h === this.h && samples === this.samples) return;
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    this.w = w; this.h = h; this.samples = samples;
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      samples, depthTexture: depth, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
    });
    this.uniforms.tColor.value = this.rt.texture; this.uniforms.tDepth.value = depth;
    this.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.uniforms.uAspect.value = w / h;
    // the line is about 1/300 of the picture's height: 2.4 px at 720p, 5.4 px on a 1624-high phone
    this.uniforms.uRadius.value = Math.max(1, Math.min(w, h) * 0.00185 + 0.2);
  }

  setTheme(theme) {
    this.uniforms.uInk.value.set(theme.ink);
    this.uniforms.uFogNF.value.set(theme.fogNear, theme.fogFar);
  }

  /** Draw the scene through the pass. `clearAlphaId`: the ink id of empty space (the sky's). */
  render(scene, camera, time) {
    const gl = this.gl, u = this.uniforms;
    u.uNFB.value.set(camera.near, camera.far, camera.far * camera.near / (camera.far - camera.near));
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInvVP.value.copy(this._vp).invert();
    u.uTime.value = time;
    let shimmer = false;
    for (let i = 0; i < 3; i++) {
      const s = this.shim[i], t = u.uShim.value[i];
      if (!s || !(s.k > 0)) { t.w = 0; continue; }
      this._v.set(s.x, s.y, s.z).applyMatrix4(this._vp);
      const w = this._v.z;                         // after the divide: NDC depth; behind the camera when > 1
      if (w > 1 || Math.abs(this._v.x) > 1.3 || Math.abs(this._v.y) > 1.6) { t.w = 0; continue; }
      // radius in uv of the screen's height at that distance
      const dist = Math.max(1, camera.position.distanceTo(this._v.set(s.x, s.y, s.z)));
      const rad = s.r / (dist * Math.tan(camera.fov * Math.PI / 360) * 2);
      this._v.set(s.x, s.y, s.z).applyMatrix4(this._vp);
      t.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5, rad, s.k);
      shimmer = true;
    }
    this.tri.material = this._material(this.taps, shimmer);

    gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true;
    camera.layers.set(0);
    gl.setRenderTarget(this.rt);
    gl.setClearAlpha(INK.sky);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.setClearAlpha(1);
    gl.render(this.quadScene, this.quadCam);
    camera.layers.set(1);
    gl.autoClear = false;
    gl.render(scene, camera);
    gl.autoClear = true;
    camera.layers.set(0);
  }

  /** No ink, no buffer: straight to the screen (the 'none' and 'hull' comparison modes). */
  renderDirect(scene, camera) {
    const gl = this.gl;
    gl.shadowMap.autoUpdate = true;
    camera.layers.enableAll();
    gl.setRenderTarget(null);
    gl.render(scene, camera);
    camera.layers.set(0);
  }

  dispose() { if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); this.rt = null; } for (const m of this.mats.values()) m.dispose(); }
}

/** Opaque things draw into the inked buffer (layer 0), see-through things on top of it (layer 1). Lights reach both. */
export function assignLayers(root) {
  root.traverse((o) => {
    if (o.isLight) { o.layers.enableAll(); return; }
    if (!(o.isMesh || o.isPoints || o.isLine)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    o.layers.set(m && m.transparent ? 1 : 0);
  });
}

// Colosseum — sky, sun and atmosphere.
//
// The single most important lighting fact about this building: it is an open
// bowl with a 48 m wall around it, so at any hour except noon a hard diagonal
// of shadow cuts across the sand. Fighters cross from glare into shade and back.
// That moving edge is most of the drama, so the sun is a real directional light
// with a tight shadow frustum around the arena floor (not the whole building —
// a 200 m shadow camera would waste all its texels on empty seating).

import * as THREE from "three";
import { ARENA } from "../data/arena_spec.js";
import { TAU, lerp } from "../core/util.js";

/** Procedural sky dome: a vertical gradient plus a sun disc and haze. */
const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uHaze;

  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

    // Gradient: horizon haze -> zenith. pow() keeps the band tight near the
    // horizon the way a real hazy Mediterranean sky sits.
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));

    // Sun disc + broad glow. The glow is what sells low-angle light.
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 900.0) * 3.0;            // disc
    col += uSunColor * pow(sd, 12.0) * 0.28 * uHaze;    // glow
    col += uSunColor * pow(sd, 3.0) * 0.06 * uHaze;     // wide bloom into haze

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(scene, { radius = 900, timeOfDay = "afternoon" } = {}) {
    this.scene = scene;

    const geo = new THREE.SphereGeometry(radius, 32, 16);
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x3f74c4) },
      uHorizon: { value: new THREE.Color(0xd8cbb0) },
      uSunColor: { value: new THREE.Color(0xffd9a0) },
      uSunDir: { value: new THREE.Vector3(1, 0.5, 0).normalize() },
      uHaze: { value: 1.0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    // --- sun ---------------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.castShadow = true;
    this.sun.name = "sun";
    // Tight ortho frustum over the arena floor only. 87x55 m of sand needs
    // ~110 m of coverage with a margin for the podium's cast shadow.
    const S = 62;
    this.sun.shadow.camera.left = -S;
    this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S;
    this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // --- fill --------------------------------------------------------------
    // Hemisphere light does the sky-bounce that makes stone read as stone.
    this.hemi = new THREE.HemisphereLight(0x9fb4d4, 0xb59a72, 1.0);
    scene.add(this.hemi);

    this.setShadowQuality("high");
    this.setTimeOfDay(timeOfDay);
  }

  /**
   * Bake the procedural sky into a PMREM environment map.
   *
   * Without this, every metal in the scene (the bronze shields, iron fittings,
   * weapon blades) renders BLACK — a metallic surface has no diffuse response,
   * so with nothing to reflect it returns nothing. It also gives all the stone
   * a correct sky-bounce that no amount of hemisphere light reproduces.
   *
   * Cost is one render of a 256px cube at load, then nothing per frame. Must be
   * re-run when the time of day changes, since the sky is the light source.
   */
  bakeEnvironment(renderer) {
    if (!this._pmrem) {
      // Imported lazily so the module still parses in a headless probe where
      // there is no WebGL context to build a PMREM generator against.
      this._pmrem = new THREE.PMREMGenerator(renderer);
      this._pmrem.compileEquirectangularShader();
    }
    if (this._envRT) this._envRT.dispose();

    // Render the existing sky dome from the centre of the arena.
    const cubeRT = new THREE.WebGLCubeRenderTarget(256);
    const cubeCam = new THREE.CubeCamera(1, 2000, cubeRT);
    const prevFog = this.scene.fog;
    this.scene.fog = null;                 // fog would grey out the whole probe
    const hidden = [];
    this.scene.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o !== this.mesh && o.visible) {
        hidden.push(o); o.visible = false;  // sky only — no self-reflection
      }
    });
    cubeCam.position.set(0, 12, 0);
    cubeCam.update(renderer, this.scene);
    hidden.forEach((o) => { o.visible = true; });
    this.scene.fog = prevFog;

    this._envRT = this._pmrem.fromCubemap(cubeRT.texture);
    cubeRT.dispose();
    this.scene.environment = this._envRT.texture;
    // Keep it subtle: this is a fill, the sun is still the key light.
    this.scene.environmentIntensity = 0.55;
    return this._envRT.texture;
  }

  setShadowQuality(q) {
    const size = { low: 0, medium: 1024, high: 2048, ultra: 2048 }[q] ?? 2048;
    if (size === 0) {
      this.sun.castShadow = false;
    } else {
      this.sun.castShadow = true;
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
      this.sun.shadow.mapSize.set(size, size);
    }
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /**
   * @param {string|object} tod  key into ARENA.timeOfDay, or a raw preset
   */
  setTimeOfDay(tod) {
    const p = typeof tod === "string" ? ARENA.timeOfDay[tod] : tod;
    if (!p) return;
    this.preset = p;
    this.todKey = typeof tod === "string" ? tod : "custom";

    // Sun direction from azimuth/elevation.
    const ce = Math.cos(p.elevation);
    const dir = new THREE.Vector3(
      Math.cos(p.azimuth) * ce,
      Math.sin(p.elevation),
      Math.sin(p.azimuth) * ce
    ).normalize();

    this.sunDir = dir;
    this.sun.position.copy(dir).multiplyScalar(220);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
    this.sun.color.set(p.sun);
    this.sun.intensity = p.intensity;

    this.hemi.color.set(p.ambient);
    this.hemi.intensity = lerp(0.55, 1.25, Math.min(1, p.elevation / 1.2));

    this.uniforms.uSunDir.value.copy(dir);
    this.uniforms.uSunColor.value.set(p.sun);
    this.uniforms.uHorizon.value.set(p.fog);
    // Zenith deepens as the sun drops.
    const zen = new THREE.Color(0x3f74c4).lerp(new THREE.Color(0x1b2a52), 1 - Math.min(1, p.elevation / 1.2));
    this.uniforms.uZenith.value.copy(zen);
    this.uniforms.uHaze.value = lerp(1.6, 0.7, Math.min(1, p.elevation / 1.2));

    // Scene fog keeps the far side of the cavea from reading as a cutout.
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(p.fog, 120, 620);
    this.scene.fog.color.set(p.fog);

    return p;
  }

  /** Exposure the renderer should use for this time of day. */
  exposure() {
    return this.preset ? this.preset.exposure : 1.0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.scene.remove(this.mesh, this.sun, this.sun.target, this.hemi);
  }
}

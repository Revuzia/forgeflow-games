/**
 * FFG runtime - 3d/lc_output_pass.js  (ES module)
 *
 * A custom copy of three r172's OutputPass + OutputShader (MIT, three.js authors,
 * assets/vendor/three/examples/jsm/postprocessing/OutputPass.js and shaders/OutputShader.js)
 * with ONE addition: a storm grade (desaturate + light lavender tint) driven by a
 * single uniform, `stormAmt` (0..1).
 *
 * WHY it lives in the output pass and not in a CSS overlay or a fog tweak: the grade must
 * touch EVERY pixel (sky, water, characters, loot beams) the same way, in the same pass
 * that already tone-maps and sRGB-encodes, so it adds 0 passes and 0 draw calls (the
 * plan's bench: an ALU grade folded into the copy costs about nothing, 0.39-0.73 ms
 * against 0.47-0.66 ms for a plain copy on the shared UHD at 720p).
 *
 * WHY a runtime `if (stormAmt > 0.0)` and not a #define: a define would key a NEW
 * program, and that program would first compile on the frame the player first steps into
 * the storm (a visible hitch on a browser GPU). One program, one branch, warmed by the
 * ordinary composer warm-up. The branch is uniform-coherent (every fragment takes it the
 * same way), so a neutral frame skips the grade math entirely.
 *
 * NEUTRAL means exactly neutral: with stormAmt == 0 the output is bit-identical to the
 * stock OutputPass (same tone-mapping and OETF code, the grade block is skipped).
 */
import {
  ColorManagement,
  RawShaderMaterial,
  UniformsUtils,
  LinearToneMapping,
  ReinhardToneMapping,
  CineonToneMapping,
  AgXToneMapping,
  ACESFilmicToneMapping,
  NeutralToneMapping,
  SRGBTransfer,
  Vector3,
} from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

export const LCOutputShader = {
  name: "LCOutputShader",

  uniforms: {
    tDiffuse: { value: null },
    toneMappingExposure: { value: 1 },
    // storm grade
    stormAmt: { value: 0 },                 // 0 = neutral (skipped), 1 = full grade
    stormDesat: { value: 0.45 },            // fraction of colour removed at stormAmt 1 (plan: 40-50%)
    stormTint: { value: new Vector3(1.0, 0.96, 1.16) },// lavender multiplier, ~luma-neutral (0.2126*1.0 + 0.7152*0.96 + 0.0722*1.16 = 0.983)
    stormTintMix: { value: 0.55 },          // how much of that multiplier is applied at stormAmt 1
  },

  vertexShader: /* glsl */`
    precision highp float;

    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;

    attribute vec3 position;
    attribute vec2 uv;

    varying vec2 vUv;

    void main() {

      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

    }`,

  fragmentShader: /* glsl */`

    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float stormAmt;
    uniform float stormDesat;
    uniform vec3 stormTint;
    uniform float stormTintMix;

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    varying vec2 vUv;

    void main() {

      gl_FragColor = texture2D( tDiffuse, vUv );

      // tone mapping

      #ifdef LINEAR_TONE_MAPPING

        gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

      #elif defined( REINHARD_TONE_MAPPING )

        gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

      #elif defined( CINEON_TONE_MAPPING )

        gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

      #elif defined( ACES_FILMIC_TONE_MAPPING )

        gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

      #elif defined( AGX_TONE_MAPPING )

        gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

      #elif defined( NEUTRAL_TONE_MAPPING )

        gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

      #endif

      // storm grade: after tone mapping (display-referred linear), before the OETF.
      // Desaturate toward the pixel's own luminance, then pull the result toward a
      // luma-neutral lavender. Uniform-coherent branch: skipped entirely when neutral.
      if ( stormAmt > 0.0 ) {

        float l = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( l ), stormDesat * stormAmt );
        gl_FragColor.rgb *= mix( vec3( 1.0 ), stormTint, stormTintMix * stormAmt );

      }

      // color space

      #ifdef SRGB_TRANSFER

        gl_FragColor = sRGBTransferOETF( gl_FragColor );

      #endif

    }`,
};

export class LCOutputPass extends Pass {

  constructor() {

    super();

    const shader = LCOutputShader;

    this.uniforms = UniformsUtils.clone(shader.uniforms);

    this.material = new RawShaderMaterial({
      name: shader.name,
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
    });

    this.fsQuad = new FullScreenQuad(this.material);

    // internal cache
    this._outputColorSpace = null;
    this._toneMapping = null;

    this.isLCOutputPass = true;

  }

  /** 0 = neutral, 1 = full storm grade. Clamped; a NaN becomes 0. */
  setStormGrade(amt) {

    const a = amt > 0 ? (amt < 1 ? amt : 1) : 0;
    this.uniforms.stormAmt.value = a;
    return a;

  }

  get stormGrade() { return this.uniforms.stormAmt.value; }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {

    this.uniforms["tDiffuse"].value = readBuffer.texture;
    this.uniforms["toneMappingExposure"].value = renderer.toneMappingExposure;

    // rebuild defines if required

    if (this._outputColorSpace !== renderer.outputColorSpace || this._toneMapping !== renderer.toneMapping) {

      this._outputColorSpace = renderer.outputColorSpace;
      this._toneMapping = renderer.toneMapping;

      this.material.defines = {};

      if (ColorManagement.getTransfer(this._outputColorSpace) === SRGBTransfer) this.material.defines.SRGB_TRANSFER = "";

      if (this._toneMapping === LinearToneMapping) this.material.defines.LINEAR_TONE_MAPPING = "";
      else if (this._toneMapping === ReinhardToneMapping) this.material.defines.REINHARD_TONE_MAPPING = "";
      else if (this._toneMapping === CineonToneMapping) this.material.defines.CINEON_TONE_MAPPING = "";
      else if (this._toneMapping === ACESFilmicToneMapping) this.material.defines.ACES_FILMIC_TONE_MAPPING = "";
      else if (this._toneMapping === AgXToneMapping) this.material.defines.AGX_TONE_MAPPING = "";
      else if (this._toneMapping === NeutralToneMapping) this.material.defines.NEUTRAL_TONE_MAPPING = "";

      this.material.needsUpdate = true;

    }

    //

    if (this.renderToScreen === true) {

      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);

    } else {

      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      this.fsQuad.render(renderer);

    }

  }

  dispose() {

    this.material.dispose();
    this.fsQuad.dispose();

  }

}

export default LCOutputPass;

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
 *
 * Two more uniform-driven blocks follow the same rule (off = skipped = bit-identical, one program):
 *  - FXAA folded into this pass (Last Circle parity LC-03, medium tier). A separate FXAA pass
 *    measured 3.1-3.6 ms on the UHD iGPU at 1920x1080 (it makes this pass write a half-float
 *    target and reads it back), against a 0.8 ms budget. Here the anti-aliasing reads the same
 *    HDR input this pass already reads: edge test on 5 taps (centre + 4 diagonals), and only on
 *    an edge pixel the 4 directional taps of the classic FXAA (Timothy Lottes, NVIDIA FXAA white
 *    paper), each tone-mapped before blending (blending HDR values would let a bright sky
 *    sample swamp the edge), with a continuous response (no pixel flips on a tiny change).
 *    No extra pass, no extra target.
 *  - colour-vision correction (daltonize, LC-43 hook), after the storm grade.
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
  Vector2,
  Vector3,
  Matrix3,
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
    // folded FXAA (LC-03): 0 = off (skipped), 1 = on; texel = 1 / the input's size (set every render)
    aaOn: { value: 0 },
    aaTexel: { value: new Vector2(1 / 1024, 1 / 1024) },
    // colour-vision correction (LC-43 hook, driven by the Video/Accessibility settings): 0 = off (skipped)
    cbAmt: { value: 0 },
    cbSim: { value: new Matrix3() },        // linear RGB -> the same colour as seen with the deficiency
    cbShift: { value: new Matrix3() },      // where the lost (error) signal is moved to
    // folded bloom composite (C-GFX perf): UnrealBloomPass's half-res result, added before tone mapping exactly where
    // three's own additive blend pass put it. 0 = no bloom this frame (skipped: bit-identical to the stock pass)
    bloomOn: { value: 0 },
    tBloom: { value: null },
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
    uniform float cbAmt;
    uniform mat3 cbSim;
    uniform mat3 cbShift;
    uniform float aaOn;
    uniform vec2 aaTexel;
    uniform float bloomOn;
    uniform sampler2D tBloom;

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    varying vec2 vUv;

    // the same tone mapping as main()'s inline block, as a function (used by the FXAA taps only)
    vec3 lcToneMap( vec3 c ) {
      #ifdef LINEAR_TONE_MAPPING
        return LinearToneMapping( c );
      #elif defined( REINHARD_TONE_MAPPING )
        return ReinhardToneMapping( c );
      #elif defined( CINEON_TONE_MAPPING )
        return CineonToneMapping( c );
      #elif defined( ACES_FILMIC_TONE_MAPPING )
        return ACESFilmicToneMapping( c );
      #elif defined( AGX_TONE_MAPPING )
        return AgXToneMapping( c );
      #elif defined( NEUTRAL_TONE_MAPPING )
        return NeutralToneMapping( c );
      #else
        return c;
      #endif
    }

    // three's blend pass wrote the scene + bloom sum INTO the half-float read buffer, i.e. rounded to binary16 (round to
    // nearest, ties to even); the folded sum is rounded the same way, so the fold reproduces the stored value exactly
    // (bit-identical output, not just within 1/255). Normal range: spacing 2^(e-10); below 2^-14 the subnormal step 2^-24.
    float lcRne( float x ) {
      float f = floor( x ); float d = x - f;
      if ( d > 0.5 ) return f + 1.0;
      if ( d < 0.5 ) return f;
      return mod( f, 2.0 ) == 0.0 ? f : f + 1.0;
    }
    float lcHalf1( float v ) {
      float a = abs( v );
      if ( a < 6.103515625e-05 ) return sign( v ) * lcRne( a * 16777216.0 ) * 5.9604644775390625e-08;
      float e = floor( log2( a ) );
      float p = exp2( e );
      if ( p > a ) p *= 0.5; else if ( p * 2.0 <= a ) p *= 2.0;      // log2 / exp2 off by one ulp at a power of two
      float q = p * 0.0009765625;                                      // the binary16 spacing at a (2^-10 of the binade)
      return sign( v ) * min( lcRne( a / q ) * q, 65504.0 );
    }
    vec3 lcHalf( vec3 v ) { return vec3( lcHalf1( v.r ), lcHalf1( v.g ), lcHalf1( v.b ) ); }

    // the HDR input at uv: the scene plus, when the bloom composite is folded in, the bloom exactly as three's additive
    // blend pass laid it over the scene (blendFunc SRC_ALPHA, ONE: rgb += bloom.rgb * bloom.a, stored as binary16)
    vec3 lcSrc( vec2 uv ) {
      vec3 c = texture2D( tDiffuse, uv ).rgb;
      if ( bloomOn > 0.5 ) { vec4 b = texture2D( tBloom, uv ); c = lcHalf( c + b.rgb * b.a ); }
      return c;
    }

    // perceptual luma of an HDR input sample: exposure-scaled, clipped at display white, gamma ~2
    float lcLumaIn( vec3 c ) {
      float l = dot( c, vec3( 0.299, 0.587, 0.114 ) ) * toneMappingExposure;
      return sqrt( clamp( l, 0.0, 1.0 ) );
    }

    // FXAA (classic Lottes formulation). mT = the centre, already tone-mapped. Returns the
    // anti-aliased tone-mapped colour; flat pixels return mT untouched after 4 extra taps.
    vec3 lcFxaa( vec3 mIn, vec3 mT ) {
      vec2 px = aaTexel;
      float lNW = lcLumaIn( lcSrc( vUv + vec2( -1.0, -1.0 ) * px ) );
      float lNE = lcLumaIn( lcSrc( vUv + vec2( 1.0, -1.0 ) * px ) );
      float lSW = lcLumaIn( lcSrc( vUv + vec2( -1.0, 1.0 ) * px ) );
      float lSE = lcLumaIn( lcSrc( vUv + vec2( 1.0, 1.0 ) * px ) );
      float lM = lcLumaIn( mIn );
      float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
      float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
      // FXAA_EDGE_THRESHOLD 1/8, FXAA_EDGE_THRESHOLD_MIN 1/24. CONTINUOUS response: the classic hard cut (and the
      // a-or-b pick below) flips whole edge pixels on a 1/255 change of a neighbour (a flash's faint bloom, a slow light
      // change), which reads as shimmer; here the effect fades in over 1x..1.5x the threshold and the pick is a blend.
      float thr = max( 0.0416667, lMax * 0.125 );
      float range = lMax - lMin;
      if ( range <= thr ) return mT;
      float edge = smoothstep( thr, thr * 1.5, range );
      vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( lNW + lSW ) - ( lNE + lSE ) );
      float dirReduce = max( ( lNW + lNE + lSW + lSE ) * 0.03125, 0.0078125 );   // REDUCE_MUL 1/8, REDUCE_MIN 1/128
      float rcpDirMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );
      dir = clamp( dir * rcpDirMin, vec2( -8.0 ), vec2( 8.0 ) ) * px;               // SPAN_MAX 8
      vec3 a = 0.5 * ( lcToneMap( lcSrc( vUv + dir * ( 1.0 / 3.0 - 0.5 ) ) ) +
                       lcToneMap( lcSrc( vUv + dir * ( 2.0 / 3.0 - 0.5 ) ) ) );
      vec3 b = a * 0.5 + 0.25 * ( lcToneMap( lcSrc( vUv - dir * 0.5 ) ) +
                                  lcToneMap( lcSrc( vUv + dir * 0.5 ) ) );
      float lB = sqrt( clamp( dot( b, vec3( 0.299, 0.587, 0.114 ) ), 0.0, 1.0 ) );
      float wB = 1.0 - smoothstep( 0.0, 0.03, max( lMin - lB, lB - lMax ) );   // b outside the local range -> a
      return mix( mT, mix( a, b, wB ), edge );
    }

    void main() {

      gl_FragColor = texture2D( tDiffuse, vUv );
      // folded bloom composite (uniform-coherent; off = skipped)
      if ( bloomOn > 0.5 ) { vec4 lcB = texture2D( tBloom, vUv ); gl_FragColor.rgb = lcHalf( gl_FragColor.rgb + lcB.rgb * lcB.a ); }
      vec3 lcIn = gl_FragColor.rgb;

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

      // folded FXAA (LC-03): uniform-coherent like the grade below; off it is skipped entirely
      if ( aaOn > 0.5 ) gl_FragColor.rgb = lcFxaa( lcIn, gl_FragColor.rgb );

      // storm grade: after tone mapping (display-referred linear), before the OETF.
      // Desaturate toward the pixel's own luminance, then pull the result toward a
      // luma-neutral lavender. Uniform-coherent branch: skipped entirely when neutral.
      if ( stormAmt > 0.0 ) {

        float l = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( l ), stormDesat * stormAmt );
        gl_FragColor.rgb *= mix( vec3( 1.0 ), stormTint, stormTintMix * stormAmt );

      }

      // colour-vision correction (daltonize): what the deficiency loses (colour minus its simulation)
      // is moved into channels that are still seen. Same uniform-coherent branch as the grade above:
      // off (cbAmt 0) it is skipped and the output stays bit-identical.
      if ( cbAmt > 0.0 ) {

        vec3 c = clamp( gl_FragColor.rgb, 0.0, 1.0 );
        vec3 corr = c + cbShift * ( c - cbSim * c );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, clamp( corr, 0.0, 1.0 ), cbAmt );

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

  /** Folded FXAA on (true) / off (false). Returns the state. */
  setFXAA(on) {

    this.uniforms.aaOn.value = on ? 1 : 0;
    return !!on;

  }

  get fxaa() { return this.uniforms.aaOn.value > 0.5; }

  /** The bloom pass's composite texture for THIS frame (the kernel's folded UnrealBloomPass calls it right before this
   *  pass renders); null = none. Consumed by the next render(). */
  setBloomTexture(tex) {

    this._bloomTex = tex || null;

  }

  /** Colour-vision correction: mode 0 off | 1 protan | 2 deutan | 3 tritan (or the names), amt 0..1
   *  (default 1). Simulation matrices: Machado, Oliveira & Fernandes 2009, severity 1.0, linear RGB;
   *  error shift: the classic daltonize redistribution (Fidaner, Lin & Ozguven 2005). Returns
   *  { mode, amt } in force. */
  setDaltonize(mode, amt) {

    const M = LCOutputPass.CB_MODES;
    const m = typeof mode === "string" ? Math.max(0, M.indexOf(mode)) : Math.max(0, Math.min(3, Math.round(+mode || 0)));
    const a = m === 0 ? 0 : (amt == null ? 1 : (amt > 0 ? (amt < 1 ? +amt : 1) : 0));
    const sim = LCOutputPass.CB_SIM[m], sh = LCOutputPass.CB_SHIFT[m];
    if (sim) this.uniforms.cbSim.value.set(...sim);
    if (sh) this.uniforms.cbShift.value.set(...sh);
    this.uniforms.cbAmt.value = a;
    this._cbMode = a > 0 ? m : 0;
    return { mode: M[this._cbMode], amt: a };

  }

  get daltonize() { return { mode: LCOutputPass.CB_MODES[this._cbMode || 0], amt: this.uniforms.cbAmt.value }; }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {

    this.uniforms["tDiffuse"].value = readBuffer.texture;
    // the folded bloom composite: only on a frame whose bloom pass handed its texture over (setBloomTexture); a frame
    // without one (bloom disabled, the pass skipped) adds nothing
    const bt = this._bloomTex;
    this._bloomTex = null;
    this.uniforms.bloomOn.value = bt ? 1 : 0;
    this.uniforms.tBloom.value = bt || null;
    this.uniforms["toneMappingExposure"].value = renderer.toneMappingExposure;
    this.uniforms.aaTexel.value.set(1 / Math.max(1, readBuffer.width), 1 / Math.max(1, readBuffer.height));

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

// row-major 3x3 (Matrix3.set order)
LCOutputPass.CB_MODES = ["off", "protan", "deutan", "tritan"];
LCOutputPass.CB_SIM = [
  null,
  [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
];
LCOutputPass.CB_SHIFT = [
  null,
  [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],          // protan: red loss shown as green + blue
  [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],          // deutan: same redistribution
  [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0],          // tritan: blue loss shown as red + green
];

export default LCOutputPass;

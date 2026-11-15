/*! VALE bundles third-party code: meshoptimizer (MIT). Licenses in full: THIRD_PARTY_NOTICES.txt */
import{g as e}from"./index-F4AWHnNK.js";import{$ as t,A as n,At as r,B as i,Bt as a,C as o,Ct as s,D as c,Dt as l,Et as u,F as d,Ft as f,G as p,H as m,I as h,K as g,L as _,Lt as v,Mt as y,N as b,Nt as x,O as S,Ot as C,P as w,Pt as T,Q as E,R as D,Rt as O,St as ee,T as k,Tt as te,U as A,V as j,Vt as ne,W as re,X as ie,Y as ae,_ as oe,_t as se,a as ce,at as le,b as ue,bt as de,c as fe,ct as pe,dt as me,et as M,f as he,ft as ge,g as _e,gt as ve,h as ye,ht as be,i as xe,it as Se,jt as Ce,k as N,kt as we,l as P,lt as Te,m as Ee,mt as De,n as Oe,nt as ke,o as Ae,ot as je,p as F,pt as Me,r as Ne,rt as Pe,s as Fe,st as Ie,t as Le,tt as I,u as Re,ut as ze,v as Be,vt as Ve,w as He,wt as Ue,x as We,xt as L,y as R,yt as z,z as Ge,zt as B}from"./vendor-three-D3oU4niC.js";import{_ as Ke,a as qe,c as V,d as Je,f as Ye,g as Xe,h as Ze,i as Qe,l as $e,m as et,n as tt,o as nt,p as rt,r as it,s as at,t as ot,u as st}from"./vendor-post-BiB9Yz_H.js";function H(e,t,n=0){if(!e||typeof e!=`object`||n>5)return;let r=e;if(r.isObject3D){e.traverse(e=>{let n=e;n.geometry&&t.add(n.geometry);for(let e of[n.material,n.customDepthMaterial,n.customDistanceMaterial].flat())e&&H(e,t,5);n.isSkinnedMesh&&n.skeleton?.boneTexture&&t.add(n.skeleton.boneTexture)});return}if(r.isBufferGeometry||r.isTexture){t.add(r);return}if(r.isMaterial){if(t.has(r))return;t.add(r);for(let e of Object.values(r))e&&typeof e==`object`&&e.isTexture&&t.add(e);let e=r.uniforms;if(e)for(let n in e){let r=e[n]?.value;r&&typeof r==`object`&&r.isTexture&&t.add(r)}return}if(Array.isArray(e)){for(let r of e)H(r,t,n+1);return}if(e instanceof Map){for(let r of e.values())H(r,t,n+1);return}let i=Object.getPrototypeOf(e);if(i===Object.prototype||i===null)for(let e of Object.values(r))H(e,t,n+1)}function ct(e){let t=e.parser,n=t.extensions?.KHR_binary_glTF;n&&(n.body=null),t.cache?.removeAll?.()}function lt(e,t){let n=0;for(let r of e){if(t.has(r))continue;let e=r;typeof e.dispose==`function`&&(e.dispose(),n++)}return n}function ut(e){return/^assets\/[0-9a-f]{12}-/.test(e)||/^(https?:|data:|blob:|\/)/.test(e)}var dt=class e{gltfLoader;hdrLoader;lutLoader=new $e;models=new Map;hdrs=new Map;luts=new Map;textures=new Map;landedModels=new Map;landedHdrs=new Map;landedTextures=new Map;touched=new Set;closeBitmaps=!0;closedBitmaps=0;texLoader=new r;failed=new Set;quiet=!1;pending=0;done=0;onProgress=null;renderer;url;constructor(e,t){this.renderer=e,this.url=t,this.gltfLoader=new xe,this.gltfLoader.setMeshoptDecoder(Oe),this.hdrLoader=new Ne,this.hdrLoader.setDataType(e.capabilities.isWebGL2?D:w)}resolve(e){return this.url(e)}static LOAD_SLOTS=4;inFlight=0;slotQueue=[];gate(t){let n=()=>t().finally(()=>{let e=this.slotQueue.shift();e?e():this.inFlight--});return this.inFlight<e.LOAD_SLOTS?(this.inFlight++,n()):new Promise(e=>this.slotQueue.push(e)).then(n)}track(e){return this.pending++,this.onProgress?.(this.done,this.pending),e.finally(()=>{this.done++,this.onProgress?.(this.done,this.pending)})}model(e,t=!1){return!e||!ut(e)?Promise.resolve(null):this.loadModel(e,this.url(e),t)}modelUrl(e){return this.loadModel(`url:${e}`,e)}missing(e){return this.failed.has(e)}loadModel(e,t,n=!1){this.touched.add(e);let r=this.models.get(e),i=this.landedModels.get(e);if(r&&i?.m&&!n&&this.evicted.has(e)){this.evicted.delete(e);let t=i.m;return r=this.track(this.restoreModel(i.url,t).then(()=>t)),this.models.set(e,r),this.closeBitmaps&&r.then(e=>{e&&this.closeAfterUpload(e.gltf)}),r}return r||(r=this.track(this.gate(()=>this.gltfLoader.loadAsync(t)).then(t=>{let n=!1,r=!1;return t.scene.traverse(e=>{let t=e;t.isMesh&&(n=!0),t.isSkinnedMesh&&(r=!0)}),n||this.failed.add(e),this.closeBitmaps&&this.closeAfterUpload(t),ct(t),{gltf:t,renderable:n,skinned:r}}).catch(t=>(this.failed.add(e),this.quiet||console.warn(`[vale/render] model ${e} unavailable: ${t instanceof Error?t.message.slice(0,120):String(t)}`),null)).then(n=>(this.models.get(e)===r&&this.landedModels.set(e,{url:t,m:n}),n))),this.models.set(e,r)),r}closeAfterUpload(e){let t=new Set;H(e.scene,t);let n=new Map;for(let e of t){let t=e;if(!t.isTexture||!t.source)continue;let r=n.get(t.source)??[];r.push(t),n.set(t.source,r)}for(let[e,t]of n){let n=e.data;if(t.length!==1||typeof ImageBitmap>`u`||!(n instanceof ImageBitmap))continue;let r=t[0];r.onUpdate=()=>{let e=r.source.data;e instanceof ImageBitmap&&(e.close(),this.closedBitmaps++,r.source.closed=!0)}}}contextLost(){if(typeof ImageData>`u`)return;let e=new ImageData(new Uint8ClampedArray([128,128,128,255]),1,1);for(let{m:t}of this.landedModels.values()){if(!t)continue;let n=new Set;H(t.gltf.scene,n);for(let t of n){let n=t;n.isTexture&&n.source.closed&&(n.source.data=e)}}}async restoreImages(){let e=[];for(let{url:t,m:n}of this.landedModels.values()){if(!n)continue;let r=new Set;H(n.gltf.scene,r);let i=[...r].filter(e=>e.isTexture&&e.source.closed);i.length&&e.push(new xe().setMeshoptDecoder(Oe).loadAsync(t).then(e=>{let t=new Map,r=new Set;H(e.scene,r);for(let n of r){let r=e.parser.associations.get(n)?.textures;n.isTexture&&r!==void 0&&t.set(r,n)}let a=0;for(let e of i){let r=n.gltf.parser.associations.get(e)?.textures,i=r===void 0?void 0:t.get(r);i&&(e.source.data=i.source.data,e.source.closed=!1,e.dispose(),e.needsUpdate=!0,a++)}return a}).catch(()=>0))}return(await Promise.all(e)).reduce((e,t)=>e+t,0)}markClipOnly(e){this.clipOnly.add(e)}clipOnly=new Set;evicted=new Set;evictedBitmaps=0;evictUnused(e){if(typeof ImageBitmap>`u`||typeof ImageData>`u`||this.done<this.pending)return 0;let t=this.renderer.properties,n=0;for(let r of this.clipOnly){let i=this.landedModels.get(r);if(!i?.m||this.evicted.has(r))continue;let a=new Set;H(i.m.gltf.scene,a);let o=!1;for(let n of a)if(e.has(n)||n.isTexture&&t.get(n).__webglTexture!==void 0){o=!0;break}if(o)continue;let s=0;for(let e of a){let t=e,n=t.isTexture?t.source.data:null;n instanceof ImageBitmap&&n.width!==0&&(n.close(),t.source.data=new ImageData(new Uint8ClampedArray([128,128,128,255]),1,1),t.source.closed=!0,s++)}s&&(this.evicted.add(r),n+=s)}return this.evictedBitmaps+=n,n}restoreModel(e,t){let n=new Set;H(t.gltf.scene,n);let r=[...n].filter(e=>e.isTexture&&e.source.closed);return r.length?new xe().setMeshoptDecoder(Oe).loadAsync(e).then(e=>{let n=new Map,i=new Set;H(e.scene,i);for(let t of i){let r=e.parser.associations.get(t)?.textures;t.isTexture&&r!==void 0&&n.set(r,t)}let a=0;for(let e of r){let r=t.gltf.parser.associations.get(e)?.textures,i=r===void 0?void 0:n.get(r);i&&(e.source.data=i.source.data,e.source.closed=!1,e.dispose(),e.needsUpdate=!0,a++)}return a}).catch(()=>0):Promise.resolve(0)}mark(){this.touched.clear()}release(e,t=new Set){let n={models:0,textures:0,skies:0,disposed:0},r=e=>this.touched.has(e)||t.has(e)||t.has(e.replace(/^url:/,``));for(let[t,{m:i}]of[...this.landedModels]){if(r(t))continue;let a=new Set;i&&H(i.gltf.scene,a);let o=!1;for(let t of a)if(e.has(t)){o=!0;break}o||(n.disposed+=lt(a,e),this.landedModels.delete(t),this.models.delete(t),this.evicted.delete(t),this.clipOnly.delete(t),n.models++)}for(let[t,i]of[...this.landedTextures])r(t)||i&&e.has(i)||(i&&(i.dispose(),n.disposed++),this.landedTextures.delete(t),this.textures.delete(t),n.textures++);for(let[t,i]of[...this.landedHdrs])r(t)||i&&e.has(i)||(i&&(i.dispose(),n.disposed++),this.landedHdrs.delete(t),this.hdrs.delete(t),n.skies++);return n}hdr(e){if(!e||!ut(e))return Promise.resolve(null);this.touched.add(e);let t=this.hdrs.get(e);return t||(t=this.track(this.hdrLoader.loadAsync(this.url(e)).then(e=>e.image&&e.image.width>2?e:null).catch(t=>(this.failed.add(e),console.warn(`[vale/render] sky ${e} failed: ${t instanceof Error?t.message:String(t)}`),null)).then(n=>(this.hdrs.get(e)===t&&this.landedHdrs.set(e,n),n))),this.hdrs.set(e,t)),t}texture(e){if(!e||!ut(e))return Promise.resolve(null);this.touched.add(e);let t=this.textures.get(e);return t||(t=this.track(this.texLoader.loadAsync(this.url(e)).then(e=>(e.colorSpace=de,e.wrapS=e.wrapT=z,e.minFilter=p,e.generateMipmaps=!0,e.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy()),e)).catch(()=>(this.failed.add(e),this.quiet||console.warn(`[vale] texture missing: ${e}`),null)).then(n=>(this.textures.get(e)===t&&this.landedTextures.set(e,n),n))),this.textures.set(e,t)),t}lut(e){if(!e||!ut(e))return Promise.resolve(null);let t=this.luts.get(e);return t||(t=this.track(this.lutLoader.loadAsync(this.url(e)).then(e=>e).catch(t=>(this.failed.add(e),console.warn(`[vale/render] grade ${e} unavailable (identity LUT used): ${t instanceof Error?t.message:String(t)}`),null))),this.luts.set(e,t)),t}},ft={off:{self:`#F4EFE2`,ally:`#3F9CFF`,enemy:`#FF9A1F`,neutral:`#A9A49A`,a:`#3F9CFF`,b:`#FF9A1F`},deutan:{self:`#FBF8F0`,ally:`#2FA8FF`,enemy:`#FFC21F`,neutral:`#A9A49A`,a:`#2FA8FF`,b:`#FFC21F`},protan:{self:`#FBF8F0`,ally:`#3F9CFF`,enemy:`#FFC21F`,neutral:`#A9A49A`,a:`#3F9CFF`,b:`#FFC21F`},tritan:{self:`#FBF8F0`,ally:`#2FA8FF`,enemy:`#FF3D6E`,neutral:`#A9A49A`,a:`#2FA8FF`,b:`#FF3D6E`}},pt=[{color:`#B2354A`,glyph:`●`,keyline:`chalk`},{color:`#767305`,glyph:`▲`,keyline:`chalk`},{color:`#D9FF17`,glyph:`○`,keyline:`ink`},{color:`#20A04E`,glyph:`✚`,keyline:`none`},{color:`#26F3FF`,glyph:`■`,keyline:`ink`},{color:`#19AFFE`,glyph:`⧗`,keyline:`none`},{color:`#7273F5`,glyph:`☾`,keyline:`none`},{color:`#8121FC`,glyph:`✖`,keyline:`chalk`},{color:`#993F94`,glyph:`▬`,keyline:`chalk`},{color:`#DC6294`,glyph:`◆`,keyline:`none`}],mt={ink0:`#0B0D11`,ink1:`#11141A`,ink2:`#171B22`,chalk:`#EDE6D6`,chalkHi:`#FFF8EA`,noonwhite:`#F4EFE2`,shield:`#DCE8EE`,heal:`#63D88B`,physical:`#F1E2C6`,magic:`#FF7BD5`,trueDmg:`#101216`,fogTint:`#2A3140`};function ht(e){return new R().setStyle(e)}function gt(e){return e?e.rules.end.kind===`last_standing_or_score`||e.pick===`ffa_pick`||e.teams>2&&e.perTeam===1:!1}var _t=class{viewer;cvd=`off`;seatHex;teamOfSeat=new Map;seatOfPlayer=new Map;cache=new Map;constructor(e,t,n,r=`off`){let i=t?e.modes.find(e=>e.id===t.mode):void 0,a=gt(i),o=t?.seats.find(e=>e.player===n);this.viewer={you:o?n:-1,team:o?o.team:-1,ffa:a},this.seatHex=(i?.playerColors&&i.playerColors.length>0?i.playerColors:pt.map(e=>e.color)).slice();for(let e of t?.seats??[])this.teamOfSeat.set(e.player,e.team),this.seatOfPlayer.set(e.player,e.colorIndex);this.cvd=r}setColorblind(e){e!==this.cvd&&(this.cvd=e,this.cache.clear())}get colorblind(){return this.cvd}relation(e,t,n){return e<0?`neutral`:n&&t>=0&&t===this.viewer.you?`self`:this.viewer.team<0?e===0?`ally`:`enemy`:(this.viewer.ffa,e===this.viewer.team?`ally`:`enemy`)}relationHex(e){return ft[this.cvd][e]}relationColor(e){return this.get(ft[this.cvd][e])}unitHex(e,t,n){let r=this.relation(e,t,n);return r===`self`||r===`neutral`?this.relationHex(r):this.viewer.ffa&&t>=0?this.seatHexOf(t):this.viewer.team<0?ft[this.cvd][e===0?`a`:`b`]:this.relationHex(r)}unitColor(e,t,n){return this.get(this.unitHex(e,t,n))}seatHexOf(e){let t=this.seatOfPlayer.get(e)??e;return this.seatHex[(t%this.seatHex.length+this.seatHex.length)%this.seatHex.length]}seatGlyph(e){return pt[((this.seatOfPlayer.get(e)??e)%pt.length+pt.length)%pt.length].glyph}get ffa(){return this.viewer.ffa}get(e){let t=this.cache.get(e);return t||(t=ht(e),this.cache.set(e,t)),t}},U={uSceneDepth:{value:null},uHasDepth:{value:0},uResolution:{value:new O(1920,1080)},uPxRatio:{value:1},uBarScale:{value:1},uNear:{value:1},uFar:{value:400},uTime:{value:0}},vt=`
uniform sampler2D uSceneDepth;
uniform float uHasDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
float valeLinDepth( float d ) {
  float z = d * 2.0 - 1.0;
  return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
}
// 1 when this fragment is in front of the scene (or within bias metres behind it)
float valeVisible( float biasM ) {
  if ( uHasDepth < 0.5 ) return 1.0;
  float sd = texture( uSceneDepth, gl_FragCoord.xy / uResolution ).r;
  float s = valeLinDepth( sd ), f = valeLinDepth( gl_FragCoord.z );
  return 1.0 - smoothstep( biasM, biasM + 0.12, f - s );
}
`,yt={reach:.8,fadeIn:1.2,fadeOut:1.6,fadeAlpha:.35,easeIn:.12,easeOut:.4,bend:.7,wakeStep:.45,maxWakes:32},bt=e=>e*e*(3-2*e),xt=class{uniforms={uBrush:{value:Array.from({length:16},()=>new a)},uBrushFade:{value:Array.from({length:4},()=>new a)},uBrushN:{value:0}};tracks=new Map;wakes=[];near;constructor(e){this.near=e}begin(){for(let e of this.tracks.values())e.on=!1}push(e,t,n,r,i){if(!this.near(t,n,r+yt.fadeOut))return;let a=this.tracks.get(e);a||(a={x:t,y:n,r,prio:i,s:0,on:!0,wx:t,wy:n},this.tracks.set(e,a)),a.on=!0,a.r=r,a.prio=i,Math.hypot(t-a.wx,n-a.wy)>yt.wakeStep&&(a.s>.05&&this.wakes.push({x:a.wx,y:a.wy,r:a.r,s:a.s}),a.wx=t,a.wy=n),a.x=t,a.y=n}end(e){let t=e/yt.easeIn,n=e/yt.easeOut;for(let[e,r]of this.tracks)r.s=r.on?Math.min(1,r.s+t):Math.max(0,r.s-n),!r.on&&r.s<=0&&this.tracks.delete(e);if(this.wakes.length){for(let e of this.wakes)e.s-=n;this.wakes=this.wakes.filter(e=>e.s>0),this.wakes.length>yt.maxWakes&&this.wakes.splice(0,this.wakes.length-yt.maxWakes)}let r=[...this.tracks.values()].filter(e=>e.s>0).sort((e,t)=>t.prio-e.prio||t.s-e.s),i=this.wakes.length>16?this.wakes.slice().sort((e,t)=>t.s-e.s):this.wakes,a=this.uniforms.uBrush.value,o=this.uniforms.uBrushFade.value;for(let e of o)e.set(0,0,0,0);let s=0;for(let e of r){if(s>=16)break;let t=bt(e.s);a[s].set(e.x,e.y,e.r,t),e.prio>0&&o[s>>2].setComponent(s&3,t),s++}for(let e of i){if(s>=16)break;a[s].set(e.x,e.y,e.r,bt(Math.min(1,e.s))),s++}this.uniforms.uBrushN.value=s}snapshot(){let e=this.uniforms.uBrush.value,t=this.uniforms.uBrushFade.value,n=[];for(let r=0;r<this.uniforms.uBrushN.value;r++)n.push({x:+e[r].x.toFixed(2),y:+e[r].y.toFixed(2),r:+e[r].z.toFixed(2),bend:+e[r].w.toFixed(3),fade:+t[r>>2].getComponent(r&3).toFixed(3)});return n}clear(){this.tracks.clear(),this.wakes=[],this.uniforms.uBrushN.value=0}},W=e=>e.toFixed(4),St=[.55,.8],Ct=`
uniform float uWindT;
uniform float uGrassAO;
uniform vec4 uBrush[ 16 ];
uniform vec4 uBrushFade[ 4 ];
uniform int uBrushN;
varying float vBrushA;`,wt=`
{
  #ifdef USE_INSTANCING
  vec2 base = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
  vec3 wp0 = ( instanceMatrix * vec4( position, 1.0 ) ).xyz;
  float ksx = max( length( instanceMatrix[0].xyz ), 1e-3 ), ksy = max( length( instanceMatrix[1].xyz ), 1e-3 );
  #else
  vec2 base = vec2( 0.0 );
  vec3 wp0 = position;
  float ksx = 1.0, ksy = 1.0;
  #endif
  float hf = clamp( position.y / 1.25, 0.0, 1.0 );
  #ifdef USE_COLOR
  // no screen-space AO on this tier (Low): the clump's own occlusion, deepest at the foot, so the brush keeps the
  // dark band it has with AO on (r12 M11)
  vColor.rgb *= mix( mix( ${W(St[0])}, ${W(St[1])}, hf ), 1.0, uGrassAO );
  #endif
  float ph = base.x * 0.37 + base.y * 0.53;
  // T0 ambient: slow sway, at most 0.5 Hz
  float sway = sin( uWindT * 2.2 + ph ) * 0.05 + sin( uWindT * 1.3 + ph * 1.7 ) * 0.03;
  transformed.x += sway * hf * hf;
  transformed.z += sway * 0.6 * hf * hf;
  // r12 M11: lean away from the units the viewer sees, fade round your own and allied fighters
  vec2 push = vec2( 0.0 );
  float fade = 0.0;
  for ( int i = 0; i < 16; i ++ ) {
    if ( i >= uBrushN ) break;
    vec4 u = uBrush[ i ];
    vec2 d = wp0.xz - u.xy;
    float l = length( d ) + 1e-4;
    push += d / l * ( ( 1.0 - smoothstep( u.z * 0.5, u.z + ${W(yt.reach)}, l ) ) * u.w );
    vec4 fq = uBrushFade[ i / 4 ];
    int c = i - ( i / 4 ) * 4;
    float fa = c == 0 ? fq.x : c == 1 ? fq.y : c == 2 ? fq.z : fq.w;
    fade = max( fade, fa * ( 1.0 - smoothstep( ${W(yt.fadeIn)}, ${W(yt.fadeOut)}, l ) ) );
  }
  float pl = length( push );
  if ( pl > 1.0 ) { push /= pl; pl = 1.0; }
  float lean = ${W(yt.bend)} * pl * pow( hf, 1.4 );
  vec2 off = pl > 1e-4 ? push / pl * lean : vec2( 0.0 );
  #ifdef USE_INSTANCING
  // world offset → the instance's frame (turned about the vertical, scaled ksx across, ksy up)
  vec3 lo = ( vec3( off.x, 0.0, off.y ) * mat3( instanceMatrix ) ) / ( ksx * ksx );
  #else
  vec3 lo = vec3( off.x, 0.0, off.y );
  #endif
  transformed.xz += lo.xz;
  // the blade keeps its length as it leans: the tip comes down
  transformed.y -= min( lean * lean / ( 2.0 * max( wp0.y, 0.25 ) ), wp0.y * 0.6 ) / ksy;
  vBrushA = mix( 1.0, ${W(yt.fadeAlpha)}, fade );
}`,Tt={tip:.046,hz:[.21,.29,.37],w:[.6,.15,.25],wind:[.86,.51],h0:.3,h1:3},Et=`uniform float uSwayT;`,Dt=`
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float isc = max( length( instanceMatrix[0].xyz ), 1e-3 );
  float ph = 6.2831853 * fract( sin( dot( ip.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float hw = smoothstep( ${W(Tt.h0)}, ${W(Tt.h1)}, position.y );
  float t = uSwayT * 6.2831853;
  float a = ${W(Tt.w[0])} * sin( ${W(Tt.hz[0])} * t + ph ) + ${W(Tt.w[2])} * sin( ${W(Tt.hz[2])} * t + ph * 1.9 + 1.3 );
  float b = ${W(Tt.w[1])} * sin( ${W(Tt.hz[1])} * t + ph * 2.7 + 0.4 );
  vec2 wd = vec2( ${W(Tt.wind[0])}, ${W(Tt.wind[1])} );
  vec2 off = ( wd * a + vec2( -wd.y, wd.x ) * b ) * ( ${W(Tt.tip)} * hw );
  // a world offset (the tip moves the same few centimetres on a sapling and a giant)
  transformed += ( vec3( off.x, 0.0, off.y ) * mat3( instanceMatrix ) ) / ( isc * isc );
}
#endif`,Ot={hz:[.23,.41],w:[.75,.25],lag:2.1,across:.3},kt=`
attribute float _sway;
uniform float uAmbT;
uniform float uSwayAmp;`,At=`
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float ph = 6.2831853 * fract( sin( dot( ip.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float w = _sway;
  float t = uAmbT * 6.2831853;
  float a = ${W(Ot.w[0])} * sin( ${W(Ot.hz[0])} * t + ph - ${W(Ot.lag)} * w ) + ${W(Ot.w[1])} * sin( ${W(Ot.hz[1])} * t + ph * 1.7 - ${W(Ot.lag*1.6)} * w );
  float b = sin( ${W(Ot.hz[1])} * t + ph * 2.3 - ${W(Ot.lag)} * w );
  float amp = uSwayAmp * w;
  // the cloth swings out of its plane (local z), a little across it, and lifts as it swings
  transformed += vec3( ${W(Ot.across)} * b * amp, -0.35 * a * a * amp * w, a * amp );
}
#endif`,jt={depth:0,outline:1,flash:2,mask:3,rim:4,glaze:5,foot:6,xray:7},Mt={none:0,tree:1,grass:2,cloth:3},Nt={uOutlineRes:{value:new O(1920,1080)}},Pt=.45,Ft=`
uniform highp sampler2D uCrowdBake;
uniform mat4 uCrowdBind;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 aCrowdM0;
attribute vec4 aCrowdM1;
attribute vec4 aCrowdM2;
attribute vec4 aCrowdAnim;   // rowA, rowB, weight of A, accent glow
attribute vec4 aCrowdStyle;  // outline px, flash k, flash ink, -
mat4 valeCrowdBone( float row, float bone ) {
  ivec2 c = ivec2( int( bone ) * 3, int( row ) );
  vec4 r0 = texelFetch( uCrowdBake, c, 0 );
  vec4 r1 = texelFetch( uCrowdBake, c + ivec2( 1, 0 ), 0 );
  vec4 r2 = texelFetch( uCrowdBake, c + ivec2( 2, 0 ), 0 );
  return transpose( mat4( r0, r1, r2, vec4( 0.0, 0.0, 0.0, 1.0 ) ) );
}
mat4 valeCrowdSkin( float row ) {
  return skinWeight.x * valeCrowdBone( row, skinIndex.x ) + skinWeight.y * valeCrowdBone( row, skinIndex.y )
       + skinWeight.z * valeCrowdBone( row, skinIndex.z ) + skinWeight.w * valeCrowdBone( row, skinIndex.w );
}
mat4 valeCrowdMatrix() {
  mat4 s = valeCrowdSkin( aCrowdAnim.x );
  if ( aCrowdAnim.z < 0.999 ) s = s * aCrowdAnim.z + valeCrowdSkin( aCrowdAnim.y ) * ( 1.0 - aCrowdAnim.z );
  mat4 inst = transpose( mat4( aCrowdM0, aCrowdM1, aCrowdM2, vec4( 0.0, 0.0, 0.0, 1.0 ) ) );
  return inst * s * uCrowdBind;
}
`,It=`
vec4 valeVictimFlash( vec3 n, vec3 v, vec3 color, vec3 rimColor, float k, float ink ) {
  float ndv = abs( dot( normalize( n ), normalize( v ) ) );
  float rim = pow( 1.0 - ndv, 2.0 );
  if ( ink < 0.5 ) {
    // light: added (premultiplied, alpha 0), rim-weighted so the silhouette lights first
    return vec4( color * k * ( 0.25 + 0.75 * rim ), 0.0 );
  }
  // Shade (true damage, value-inverted): the body drops to ink, the rim rings noonwhite
  float halo = smoothstep( 0.3, 0.75, rim );
  float a = clamp( k * mix( 1.6, 2.0, halo ), 0.0, mix( 0.85, 0.95, halo ) );
  return vec4( mix( color, rimColor, halo ) * a, a );
}
`,Lt=.5,Rt=`
#define attribute in
#define varying out
precision highp float;
precision highp int;
precision highp sampler2D;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform int uInkMode;
uniform float uPx;
uniform float uBias;
uniform vec2 uOutlineRes;
in vec3 position;
in vec3 normal;
out vec3 vN;
out vec3 vV;
out vec3 vW;
out vec3 vP;
#ifdef VALE_INK_SKIN
#define USE_SKINNING
in vec4 skinIndex;
in vec4 skinWeight;
#include <skinning_pars_vertex>
#endif
#ifdef VALE_INK_CROWD
${Ft}
in vec3 aCrowdFlash;
in vec3 aCrowdFlashRim;
out vec3 vC;
out vec3 vR;
out vec2 vK;
#endif
#ifdef VALE_INK_RIGID
#define USE_INSTANCING
uniform float uInst;
uniform int uSway;
uniform float uInflate;
in mat4 instanceMatrix;
in vec3 aSmooth;
${Et}
${Ct}
${kt}
#endif
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
#ifdef VALE_INK_RIGID
  if ( uInkMode == 5 ) {
    // glaze: the tower's own surface pushed out along smoothed normals (no seams at hard edges)
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vec3 sn = normalize( mat3( modelMatrix ) * aSmooth );
    wp.xyz += sn * uInflate;
    vW = wp.xyz;
    vN = sn;
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    return;
  }
  if ( uInkMode == 6 ) {
    // the foot ring
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vP = position;
    vN = normalize( mat3( modelMatrix ) * normal );
    vV = normalize( cameraPosition - wp.xyz );
    gl_Position = projectionMatrix * viewMatrix * wp;
    return;
  }
  if ( uSway == 1 ) {
${Dt}
  } else if ( uSway == 2 ) {
${wt}
  } else if ( uSway == 3 ) {
${At}
  }
#endif
#ifdef VALE_INK_SKIN
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
#endif
#ifdef VALE_INK_CROWD
  if ( uInkMode == 1 && aCrowdStyle.x <= 0.0 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  if ( uInkMode == 2 && aCrowdStyle.y <= 0.002 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  mat4 valeK = valeCrowdMatrix();
  vec4 mv = viewMatrix * valeK * vec4( transformed, 1.0 );
  gl_Position = projectionMatrix * mv;
  vec3 vn = mat3( viewMatrix ) * mat3( valeK ) * objectNormal;
  float px = uInkMode == 1 ? aCrowdStyle.x : uPx;
  if ( uInkMode == 2 ) { vN = vn; vV = -mv.xyz; vC = aCrowdFlash; vR = aCrowdFlashRim; vK = aCrowdStyle.yz; }
#else
  vec4 mv = vec4( transformed, 1.0 );
  #ifdef VALE_INK_RIGID
  if ( uInst > 0.5 ) { mv = instanceMatrix * mv; objectNormal = mat3( instanceMatrix ) * objectNormal; }
  #endif
  mv = modelViewMatrix * mv;
  // xray (and a match flash drawn over the hull's LOD, perf PERF-m5): slid toward the camera along its own view ray (same
  // pixel, nearer depth), so a coarser shell than the body still wins the depth test wherever the body shows
  if ( uInkMode == 7 || uInkMode == 2 ) mv.xyz *= max( 0.0, 1.0 - uBias / max( length( mv.xyz ), 1e-3 ) );
  gl_Position = projectionMatrix * mv;
  vec3 vn = normalMatrix * objectNormal;
  float px = uPx;
  if ( uInkMode == 2 || uInkMode == 7 ) { vN = vn; vV = -mv.xyz; }
#endif
  if ( uInkMode == 1 || uInkMode == 4 ) {
    // screen-space push along the view normal (never flipped for the back faces drawn)
    vec2 dir = normalize( ( projectionMatrix * vec4( normalize( vn ), 0.0 ) ).xy + 1e-5 );
    gl_Position.xy += dir * px * 2.0 / uOutlineRes * gl_Position.w;
  }
}
`,zt=`
precision highp float;
precision highp int;
precision highp sampler2D;
uniform int uInkMode;
uniform float uPx;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uFlashColor;
uniform vec3 uFlashRim;
uniform float uFlashK;
uniform float uFlashInk;
uniform sampler2D uMask;
${vt}
uniform float uK;
uniform float uFlash;
uniform float uTime;
uniform vec3 uCenter;
uniform float uH;
uniform float uSfY0;
uniform float uSfY1;
uniform float uSfA;
in vec3 vN;
in vec3 vV;
in vec3 vW;
in vec3 vP;
#ifdef VALE_INK_CROWD
in vec3 vC;
in vec3 vR;
in vec2 vK;
#endif
layout( location = 0 ) out highp vec4 pc_fragColor;
${It}
vec4 valeGlaze() {
  // max env ENV-2 (the hour-ward): the stone stays opaque and readable; the ward is a ~1.5 px rim on the silhouette
  // only (n.v over its own screen derivative, as the x-ray edge), a hairline of fresnel just inside it, and one thin
  // shimmer band sweeping up the body every 3 s. No fill, no hatch: the glaze used to wash the whole tower to glass
  float ndv = abs( dot( normalize( vN ), normalize( vV ) ) );
  float edgePx = ndv / max( fwidth( ndv ), 1e-4 );
  float rim = 1.0 - smoothstep( 0.9, 2.2, edgePx );
  float soft = 1.0 - smoothstep( 0.0, 0.2, ndv );
  vec3 q = vW - uCenter;
  float ph = fract( uTime / 3.0 );
  float band = exp( -pow( ( q.y / max( uH, 0.5 ) - ( ph * 1.3 - 0.15 ) ) * 14.0, 2.0 ) ) * ( 1.0 - smoothstep( 0.8, 1.0, ph ) );
  float a = 0.4 * rim + 0.1 * soft + 0.1 * band * ( 0.5 + soft );
  a = a * uK + uFlash * ( 0.2 + 0.4 * max( rim, soft ) );
  // the occlusion fade thins the glaze with the tower
  a *= mix( 1.0, uSfA, smoothstep( uSfY0, uSfY1, vW.y ) );
  return vec4( uColor * ( 0.85 + 0.25 * rim + 0.3 * band + uFlash ), clamp( a, 0.0, 0.6 ) );
}
vec4 valeFoot() {
  float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
  float rim = pow( f, 2.0 );
  float ang = atan( vP.z, vP.x );
  // the ward's twelve hour-ticks turn slowly round the plinth (one turn a minute)
  float tk = ang / 6.2831853 * 12.0 + 0.5 + uTime * 0.2;
  float k = fract( tk );
  float q = step( 0.5, fract( ( floor( tk ) + 0.5 ) / 3.0 + 0.17 ) );
  float tick = ( 1.0 - smoothstep( 0.035, 0.06, abs( k - 0.5 ) ) ) * ( 1.0 - smoothstep( mix( 0.26, 0.4, q ), mix( 0.34, 0.48, q ), vP.y ) );
  float foot = 1.0 - smoothstep( 0.0, 0.06, vP.y );
  float top = 1.0 - smoothstep( 0.0, 0.18, ${Lt.toFixed(2)} - vP.y );
  float pulse = 0.85 + 0.15 * sin( uTime * 2.1 - ang * 2.0 );
  float a = ( 0.05 + 0.18 * rim ) * ( 1.0 - 0.8 * top ) + 0.5 * tick * pulse + 0.42 * foot;
  a = clamp( a * uK + uFlash * ( 0.2 + 0.4 * rim ), 0.0, 0.7 );
  return vec4( uColor * ( 0.8 + 0.3 * rim + 0.4 * tick + uFlash ), a );
}
void main() {
  vec4 c = vec4( 1.0 );
  if ( uInkMode == 1 ) c = vec4( uColor, uAlpha );
  else if ( uInkMode == 2 ) {
#ifdef VALE_INK_CROWD
    c = valeVictimFlash( vN, vV, vC, vR, vK.x, vK.y );
#else
    c = uFlashK <= 0.002 ? vec4( 0.0 ) : valeVictimFlash( vN, vV, uFlashColor, uFlashRim, uFlashK, uFlashInk );
#endif
  } else if ( uInkMode == 4 ) {
    // outside the body's mask only, a unit or wall in front hides it (the feet keep their rim on the ground)
    float a = texture( uMask, gl_FragCoord.xy / uResolution ).r > 0.5 ? 0.0 : uAlpha * valeVisible( ${Pt.toFixed(2)} );
    c = a <= 0.003 ? vec4( 0.0 ) : vec4( uColor, a );
  } else if ( uInkMode == 5 ) c = valeGlaze();
  else if ( uInkMode == 6 ) c = valeFoot();
  else if ( uInkMode == 7 ) {
    // the occluded silhouette: fill at uAlpha, and an edge ~uPx screen px wide where the surface turns away
    // (n.v reaches 0 on the silhouette: its screen-space distance is n.v over its own derivative)
    float ndv = abs( dot( normalize( vN ), normalize( vV ) ) );
    float edgePx = ndv / max( fwidth( ndv ), 1e-4 );
    float edge = max( 1.0 - smoothstep( uPx * 0.5, uPx + 0.75, edgePx ), 0.55 * ( 1.0 - smoothstep( 0.05, 0.32, ndv ) ) );
    c = vec4( uColor * ( 1.0 + 0.45 * edge ), mix( uAlpha, 0.92, edge ) );
  }
  pc_fragColor = c;
}
`,Bt={rigid:{VALE_INK_RIGID:``},skin:{VALE_INK_SKIN:``},crowd:{VALE_INK_CROWD:``}};function Vt(e,t){let n={uInkMode:{value:t},uPx:{value:0},uOutlineRes:Nt.uOutlineRes,uColor:{value:new R(0,0,0)},uAlpha:{value:1},uMask:{value:null},uSceneDepth:{value:null},uHasDepth:{value:0}};return e===`rigid`&&(n.uInst={value:0},n.uSway={value:Mt.none}),e===`crowd`&&(n.uCrowdBake={value:null},n.uCrowdBind={value:new M}),n}function Ht(e,t,n={}){let r=n.blend??`none`,i=new ve({glslVersion:h,vertexShader:Rt,fragmentShader:zt,defines:{...Bt[e]},uniforms:{...Vt(e,t),...n.uniforms??{}},side:n.side??0,transparent:r!==`none`,depthTest:n.depthTest??!0,depthWrite:n.depthWrite??r===`none`,colorWrite:n.colorWrite??!0});return r===`normal`?i.blending=1:r===`premul`&&(i.blending=5,i.blendSrc=201,i.blendDst=205,i.blendSrcAlpha=201,i.blendDstAlpha=205),n.offset&&(i.polygonOffset=!0,i.polygonOffsetFactor=n.offset[0],i.polygonOffsetUnits=n.offset[1]),i.name=n.name??`vale_ink_${e}`,i}var Ut=e=>e.isSkinnedMesh?`skin`:`rigid`,Wt=()=>({uPx:{value:1},uColor:{value:new R(0,0,0)},uAlpha:{value:.6}});function Gt(e,t){return Ht(e,jt.outline,{side:1,blend:`normal`,depthWrite:!1,offset:[1,2],uniforms:{...t}})}var Kt=()=>({uFlashColor:{value:new R},uFlashRim:{value:new R},uFlashK:{value:0},uFlashInk:{value:0},uBias:{value:0}});function qt(e,t){return Ht(e,jt.flash,{side:0,blend:`premul`,depthWrite:!1,offset:[-1,-2],uniforms:{...t}})}var Jt=()=>({uColor:{value:new R},uAlpha:{value:.42},uPx:{value:1.5},uBias:{value:.3}});function Yt(e,t){let n=Ht(e,jt.xray,{side:0,depthWrite:!1,uniforms:{...t},name:`vale_ink_xray_${e}`});return n.depthFunc=6,n.blending=5,n.blendEquation=100,n.blendSrc=204,n.blendDst=205,n.blendEquationAlpha=100,n.blendSrcAlpha=200,n.blendDstAlpha=201,n}function Xt(e){return Ht(e,jt.depth,{colorWrite:!1,offset:[1,1],name:`vale_ink_prepass_${e}`})}function Zt(e,t,n,r={}){return{mask:Ht(e,jt.mask,{side:2,depthTest:!1,depthWrite:!1,uniforms:{...r}}),rim:Ht(e,jt.rim,{side:1,blend:`normal`,depthTest:!1,depthWrite:!1,uniforms:{...n,...t,...r}})}}var Qt=null,$t=null,en=null;function tn(e,t=!1){return e===`skin`?en??=Ht(`skin`,jt.depth,{name:`vale_ink_shadow_skin`}):t?$t??=Ht(`rigid`,jt.depth,{name:`vale_ink_shadow_inst`,uniforms:{uInst:{value:1}}}):Qt??=Ht(`rigid`,jt.depth,{name:`vale_ink_shadow`})}function nn(){for(let e of[Qt,$t,en])e&&(e.map=null,e.alphaMap=null,e.displacementMap=null)}function rn(e,t,n){return Ht(`rigid`,jt.depth,{name:n,uniforms:{...t,uInst:{value:1},uSway:{value:e}}})}function an(e,t){return Ht(`crowd`,jt.depth,{name:`vale_ink_shadow_crowd`,uniforms:{uCrowdBake:{value:e},uCrowdBind:{value:t}}})}function on(e){e.traverse(e=>{let t=e;t.isMesh&&t.castShadow&&!t.customDepthMaterial&&(t.customDepthMaterial=t.isSkinnedMesh?tn(`skin`):tn(`rigid`,t.isInstancedMesh===!0))})}function sn(e){return Ht(`rigid`,jt.glaze,{blend:`normal`,depthWrite:!1,name:`vale_struct_skin`,uniforms:e})}function cn(e){return Ht(`rigid`,jt.foot,{side:2,blend:`normal`,depthWrite:!1,name:`vale_struct_shell`,uniforms:e})}function ln(e={}){let t={uColor:{value:new R},uK:{value:0},uFlash:{value:0},uTime:{value:0}};return e.center&&(t.uCenter={value:new B},t.uH={value:e.h??1},t.uInflate={value:e.inflate??0}),e.fade&&Object.assign(t,e.fade),t}var un=33,dn=[.2126,.7152,.0722],fn=(()=>{let e=new o(new Uint16Array(132),un,1,be,D);return e.magFilter=re,e.minFilter=re,e.wrapS=e.wrapT=Be,e.generateMipmaps=!1,e.name=`vale_fog_grade`,e})();function pn(e){let t=un,n=e?.image??null,r=n?.width??0,i=n?.data,a=e,o=!!i&&r>=2&&n?.height===r&&(n?.depth??r)===r&&i.length>=r*r*r*3,s=o?Math.round(i.length/(r*r*r)):4,c=o&&i instanceof Uint8Array?1/255:1,l=a?.domainMin?.x??0,u=a?.domainMax?.x??1,d=(e,t)=>{if(!o)return e;let n=Math.min(1,Math.max(0,(e-l)/Math.max(1e-6,u-l)))*(r-1),a=Math.min(r-2,Math.floor(n)),d=n-a,f=e=>Number(i[((e*r+e)*r+e)*s+t])*c;return f(a)*(1-d)+f(a+1)*d},f=e=>dn[0]*d(e,0)+dn[1]*d(e,1)+dn[2]*d(e,2),p=1024,m=[],h=[];for(let e=0;e<=p;e++){let t=e/p,n=f(t);(!h.length||n>h[h.length-1]+1e-7)&&(m.push(t),h.push(n))}let g=e=>{if(e<=h[0])return m[0]*(h[0]>0?e/h[0]:0);if(e>=h[h.length-1])return m[m.length-1];let t=0,n=h.length-1;for(;n-t>1;){let r=t+n>>1;h[r]<=e?t=r:n=r}return m[t]+(e-h[t])/(h[n]-h[t])*(m[n]-m[t])},_=fn.image.data;for(let e=0;e<t;e++){let t=e/32;_[e*4]=He.toHalfFloat(d(t,0)),_[e*4+1]=He.toHalfFloat(d(t,1)),_[e*4+2]=He.toHalfFloat(d(t,2)),_[e*4+3]=He.toHalfFloat(g(t))}fn.needsUpdate=!0}pn(null);var mn={valeFogTex:{value:new we},valeFogScale:{value:new O(.01,.01)},valeFogTexel:{value:new O(.02,.02)},valeFogOn:{value:0},valeFogTint:{value:new R().setStyle(`#2A3140`)},valeFogValue:{value:.55},valeFogGrade:{value:fn},valeBounds:{value:new a(0,0,100,100)},valeEdgeColor:{value:new R().setStyle(`#8E9AA6`)},valeEdgeRange:{value:new O(4,18)},valeEdgeOn:{value:1},valeTime:{value:0},valeKeyDir:{value:new B(-.5,.7071,.5).normalize()},valeCharKey:{value:.9},valeCharRimDir:{value:new B(0,.8,-.6).normalize()},valeCharRim:{value:new a(0,0,0,3)},valeCharFill:{value:new R(0,0,0)},valeCharShape:{value:new a(.3,.35,.25,.75)},valeCharMonster:{value:1},valeCharMat:{value:1},valeCharChroma:{value:new a(2.4,.38,.06,.72)},valeCloud:{value:new a(0,1/24,.46,.38)}},hn=`
uniform sampler2D valeFogTex;
uniform vec2 valeFogScale;
uniform vec2 valeFogTexel;
uniform float valeFogOn;
uniform vec3 valeFogTint;
uniform float valeFogValue;
uniform sampler2D valeFogGrade;
uniform vec4 valeBounds;
uniform vec3 valeEdgeColor;
uniform vec2 valeEdgeRange;
uniform float valeEdgeOn;
// a material's own display multiplier for its unseen fragments (>= 0 replaces valeFogValue; set before the fog runs)
float valeFogLocal = -1.0;
float valeVision( vec2 xz ) {
  if ( valeFogOn < 0.5 ) return 1.0;
  vec2 uv = xz * valeFogScale;
  vec2 o = valeFogTexel * 0.45;
  float v = texture( valeFogTex, uv ).r * 0.36
    + ( texture( valeFogTex, uv + vec2( o.x, o.y ) ).r + texture( valeFogTex, uv + vec2( -o.x, o.y ) ).r
      + texture( valeFogTex, uv + vec2( o.x, -o.y ) ).r + texture( valeFogTex, uv + vec2( -o.x, -o.y ) ).r ) * 0.16;
  // crisp, but not blocky: the grid is 2 m; the edge resolves over ~0.6 m
  return smoothstep( 0.38, 0.62, v );
}
// the post chain's tone map (post.ts: ToneMappingEffect NEUTRAL, Khronos PBR Neutral, exposure 1), mirrored
vec3 valeToneNeutral( vec3 c ) {
  float x = min( c.r, min( c.g, c.b ) );
  c -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float peak = max( c.r, max( c.g, c.b ) );
  if ( peak < 0.76 ) return c;
  float np = 1.0 - 0.0576 / ( peak - 0.52 );
  c *= np / peak;
  return mix( c, vec3( np ), 1.0 - 1.0 / ( 0.15 * ( peak - np ) + 1.0 ) );
}
vec4 valeGradeAt( float e ) { return texture( valeFogGrade, vec2( clamp( e, 0.0, 1.0 ) * ( 32.0 / 33.0 ) + 0.5 / 33.0, 0.5 ) ); }
// the scale k with tone-mapped luma( ( 1 - ta ) k g + ta tint ) = Lf, (gj, tj) the darkest channel: below the Neutral's
// compression the tone map subtracts that channel's toe offset (x - 6.25 x^2 under 0.08, else 0.04) from every
// channel, so the luma is a quadratic in k (a linear one above the toe)
float valeFogSolve( float lum, float gj, float tj, float ta, float lt, float Lf ) {
  float A = ( 1.0 - ta ) * gj, B = ta * tj;
  float a = 6.25 * A * A, b = ( 1.0 - ta ) * lum - A + 12.5 * A * B, c0 = lt - B + 6.25 * B * B - Lf;
  float kt = a > 1e-10 ? ( -b + sqrt( max( b * b - 4.0 * a * c0, 0.0 ) ) ) / ( 2.0 * a ) : -c0 / max( b, 1e-8 );
  float kl = ( Lf - lt + 0.04 ) / max( ( 1.0 - ta ) * lum, 1e-8 );
  return A * kt + B < 0.08 ? kt : kl;
}
// the unseen colour of a lit linear colour c: saturation x sat, ta of the way toward the fog tint, its scale solved so
// the DISPLAY luma (after tone map, sRGB and the grade) is mul x the lit one's (env F3; the header)
vec3 valeFogShade( vec3 c, float mul, float sat, float ta ) {
  const vec3 W = vec3( 0.2126, 0.7152, 0.0722 );
  c = max( c, vec3( 0.0 ) );
  float lum = dot( c, W );
  vec3 g = mix( vec3( lum ), c, sat );
  vec3 t = clamp( valeToneNeutral( c ), 0.0, 1.0 );
  vec3 e = mix( t * 12.92, 1.055 * pow( t, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, t ) );
  float dC = dot( vec3( valeGradeAt( e.r ).r, valeGradeAt( e.g ).g, valeGradeAt( e.b ).b ), W );
  float ef = valeGradeAt( mul * dC ).a;
  float Lf = ef <= 0.04045 ? ef / 12.92 : pow( ( ef + 0.055 ) / 1.055, 2.4 );
  float lt = ta * dot( valeFogTint, W );
  // the darkest channel: the lit colour's first, then the tinted result's own (the tint is bluest, it can reorder them)
  int j = c.r <= c.g && c.r <= c.b ? 0 : ( c.g <= c.b ? 1 : 2 );
  float k = valeFogSolve( lum, g[ j ], valeFogTint[ j ], ta, lt, Lf );
  vec3 h = ( 1.0 - ta ) * max( k, 0.0 ) * g + ta * valeFogTint;
  int j2 = h.r <= h.g && h.r <= h.b ? 0 : ( h.g <= h.b ? 1 : 2 );
  if ( j2 != j ) k = valeFogSolve( lum, g[ j2 ], valeFogTint[ j2 ], ta, lt, Lf );
  // never brighter than lit
  return ( 1.0 - ta ) * clamp( k, 0.0, 1.0 ) * g + ta * valeFogTint;
}
vec3 valeApplyWorldFog( vec3 c, vec3 wp ) {
  float vis = valeVision( wp.xz );
  if ( vis < 0.999 ) {
    float mul = valeFogLocal >= 0.0 ? valeFogLocal : valeFogValue;
    #ifdef VALE_KEEP_COLOR
    vec3 fogged = valeFogShade( c, mul, 1.0, 0.0 );
    #else
    // saturation x0.4, 15 % toward the fog tint (absolute, so the darkest stone keeps a readable floor)
    vec3 fogged = valeFogShade( c, mul, 0.4, 0.15 );
    #endif
    c = mix( fogged, c, vis );
  }
  if ( valeEdgeOn > 0.5 ) {
    vec2 d2 = max( valeBounds.xy - wp.xz, wp.xz - valeBounds.zw );
    float d = max( max( d2.x, d2.y ), 0.0 );
    float f = smoothstep( valeEdgeRange.x, valeEdgeRange.y, d );
    c = mix( c, valeEdgeColor, f );
  }
  return c;
}
`,gn=`
varying vec3 vValeWorld;
`,_n=`
{
  vec4 valeWP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    valeWP = batchingMatrix * valeWP;
  #endif
  #ifdef USE_INSTANCING
    valeWP = instanceMatrix * valeWP;
  #endif
  valeWP = modelMatrix * valeWP;
  vValeWorld = valeWP.xyz;
}
`,vn=`
uniform float valeCharMode;
uniform vec3 valeKeyDir;
uniform float valeCharKey;
uniform vec3 valeCharRimDir;
uniform vec4 valeCharRim;
uniform vec3 valeCharFill;
uniform vec4 valeCharShape;
uniform float valeCharMonster;
uniform float valeCharMat;
uniform vec4 valeCharChroma;
// MAX U1 fix round: the albedo hue lift (header of worldUniforms.valeCharChroma). The bakes paint fighters at CIELAB
// chroma 5-18 (mean), so at 28.5 m under the grade they read as hue-less clay; this lifts the display-space chroma about
// the texel's own Rec.709 luma, never past valeCharChroma.y HSV saturation and never below black, and pulls the palest
// texels down a few percent toward the knee so a chalk or linen part keeps a hue instead of clipping to paper.
vec3 valeCharHue( vec3 c ) {
  float g = 1.0 + ( valeCharChroma.x - 1.0 ) * valeCharMat;
  if ( g <= 1.001 ) return c;
  vec3 s = pow( max( c, vec3( 1e-5 ) ), vec3( 1.0 / 2.2 ) );
  float L = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );
  float mx = max( s.r, max( s.g, s.b ) ), mn = min( s.r, min( s.g, s.b ) );
  float den = ( mx - mn ) - valeCharChroma.y * ( mx - L );
  float k = den > 1e-5 ? valeCharChroma.y * L / den : g;
  k = min( g, max( 1.0, k ) );
  if ( L - mn > 1e-5 ) k = min( k, max( 1.0, L / ( L - mn ) ) );
  vec3 o = L + ( s - L ) * k;
  o *= 1.0 - valeCharChroma.z * valeCharMat * smoothstep( valeCharChroma.w, 1.0, L );
  return pow( clamp( o, 0.0, 1.0 ), vec3( 2.2 ) );
}
`,yn=`
#if defined( RE_Direct )
{
  float valeNdV = saturate( dot( geometryNormal, geometryViewDir ) );
  float valeUp = saturate( dot( geometryNormal, valeCharRimDir ) * 0.5 + 0.5 );
  float valeRim = pow( 1.0 - valeNdV, valeCharRim.a ) * valeUp * valeUp;
  float valeLa = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 valeAlb = min( diffuseColor.rgb * ( max( valeLa, valeCharShape.x ) / max( valeLa, 0.02 ) ), vec3( 1.0 ) );
  vec3 valeAdd;
  if ( valeCharMode < 1.5 ) {
    // wicks and monsters keep the sun as their key: a share of the crown, on their darker cloth only (a pale hood takes none)
    valeAdd = valeCharShape.y * ( 1.0 - smoothstep( 0.05, 0.16, valeLa ) ) * valeCharRim.rgb * valeRim * valeAlb;
  } else {
    valeAdd = valeCharRim.rgb * valeRim * valeAlb + valeCharFill * ( 0.4 + 0.6 * valeNdV ) * material.diffuseColor;
  }
  // the knee: the character light fades where the world's light (key, sky, specular) already lights the surface
  // brightly, so a pale kit never blows out and the lift goes to the mid-tones and the shadow side
  float valeLit = dot( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) );
  reflectedLight.directDiffuse += valeAdd * ( 1.0 - smoothstep( valeCharShape.z, valeCharShape.w, valeLit ) );
  // MAX U1 / U6, the material response (fighters and jungle monsters, valeCharMat): one shading model read four ways
  // through the ORM roughness the bake already zones per part (cloth 0.85-0.95, leather and skin 0.5-0.7, chalk and
  // lacquer 0.55-0.7, glass and bells 0.14-0.2; art/tools/part_pairs.json). A runtime branch on the texel, not a
  // define: no program is added.
  //   cloth (r > 0.82): a soft grazing sheen on the key side, the albedo's own colour lifted (woven cloth catches
  //     light along its folds), so a robe no longer reads as the same plaster as a chalk pauldron;
  //   glass (r < 0.25, VALE dawnglass): dark-centred and bright-edged: a tight glint from the character key, a Fresnel
  //     edge in the glass's own hue and 14 % less diffuse in the middle; at rest it stays under the bloom threshold.
  //     MAX2 r2 (U6, Ilsheta's chimney glass and every fighter's dawnglass): glass reads by reflection, never emission
  //     (glow is the game's warning cue, ilsheta.py GLASS_MAT); the edge 0.5 -> 0.85 and the glint 0.26 -> 0.4 so the
  //     rim shows at the 28.5 m camera, the middle 22 % darker (was 14 %) so the edge reads against it.
  if ( valeCharMat > 0.5 && valeCharMode > 1.1 ) {
    float valeR = roughnessFactor;
    vec3 valeK = normalize( valeKeyDir );
    float valeNdL = dot( geometryNormal, valeK );
    float valeF = 1.0 - valeNdV;
    float valeCloth = smoothstep( 0.8, 0.88, valeR );
    float valeGlass = 1.0 - smoothstep( 0.18, 0.28, valeR );
    float valeShare = ( valeCharMode > 1.5 ? 1.0 : valeCharShape.y ) * valeCharMat;
    if ( valeCloth > 0.0 ) {
      // strongest on mid and dark cloth (a sheen is how dark wool reads as cloth); a pale robe takes a third, so the
      // lower body never lifts out of its value band
      float valeSide = saturate( valeNdL * 0.5 + 0.5 );
      float valeDark = 1.0 - 0.65 * smoothstep( 0.2, 0.55, valeLa );
      reflectedLight.directDiffuse += valeShare * valeCloth * valeDark * 0.3 * valeF * valeF * valeSide * valeSide * valeCharRim.rgb * valeAlb;
    }
    if ( valeGlass > 0.0 ) {
      vec3 valeH = normalize( valeK + geometryViewDir );
      float valeGlint = pow( saturate( dot( geometryNormal, valeH ) ), 64.0 ) * saturate( valeNdL * 4.0 );
      float valeEdge = valeF * valeF * valeF;
      vec3 valeHue = diffuseColor.rgb / max( max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) ), 0.02 );
      reflectedLight.directDiffuse *= 1.0 - min( 0.22 * valeCharMat, 0.9 ) * valeGlass * ( 1.0 - valeEdge );
      reflectedLight.directSpecular += valeShare * valeGlass * valeCharRim.rgb * ( 0.4 * valeGlint + 0.85 * valeEdge * mix( vec3( 1.0 ), valeHue, 0.6 ) );
    }
  }
  // a jungle monster takes the world's light (sun, sky, its crown share) and shows its own glow (a gloamoth's wing,
  // a glasshorn's dawnglass) at its own share: its whole value scales, its painted contrast kept
  if ( valeCharMode > 1.1 && valeCharMode < 1.5 ) {
    reflectedLight.directDiffuse *= valeCharMonster; reflectedLight.indirectDiffuse *= valeCharMonster;
    reflectedLight.directSpecular *= valeCharMonster; reflectedLight.indirectSpecular *= valeCharMonster;
    totalEmissiveRadiance *= valeCharMonster;
  }
}
#endif
`,bn=Symbol(`valePatched`),xn=.355,Sn={tier:1,map:0};function Cn(e){e.tier!==void 0&&(Sn.tier=e.tier),e.map!==void 0&&(Sn.map=e.map),mn.valeCloud.value.x=Sn.tier*Sn.map}var wn=`
uniform vec4 valeCloud;
uniform float valeTime;
float valeCloudHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float valeCloudNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( valeCloudHash( i ), valeCloudHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( valeCloudHash( i + vec2( 0.0, 1.0 ) ), valeCloudHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float valeCloudShade( vec2 xz ) {
  if ( valeCloud.x <= 0.0 ) return 1.0;
  vec2 p = ( xz - valeCloud.zw * valeTime ) * valeCloud.y;
  float n = valeCloudNoise( p ) * 0.62 + valeCloudNoise( p * 2.27 + vec2( 7.1, 3.3 ) ) * 0.38;
  return 1.0 + valeCloud.x * ( ${xn} - smoothstep( 0.45, 0.68, n ) );
}
`,Tn=fe.lights_fragment_begin.split(`getDirectionalLightInfo( directionalLight, directLight );`).join(`getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= valeCloudShade( vValeWorld.xz );`),En=fe.lights_fragment_begin.split(`getDirectionalLightInfo( directionalLight, directLight );`).join(`getDirectionalLightInfo( directionalLight, directLight );
		if ( valeCharMode > 1.5 ) { directLight.direction = normalize( valeKeyDir ); directLight.color *= valeCharKey; }`).split(`directionalLightShadow.shadowIntensity`).join(`( directionalLightShadow.shadowIntensity * ( valeCharMode > 1.5 ? 0.25 : 1.0 ) )`);function Dn(e){!e.transparent&&e.blending===1&&(e.blending=0)}function On(e,t,n){e.blending===0&&(e.blending=1,e.forceSinglePass=!0),e.transparent=!0,e.opacity=t,e.depthWrite=n}function kn(e){e.forceSinglePass&&e.blending===1&&(e.blending=0),e.transparent=!1,e.opacity=1,e.depthWrite=!0}function G(e,t={}){let n=e,r=t.fog!==!1,i=t.fighter===!0,a=!i&&(t.unit===!0||t.monster===!0),o=a&&t.monster===!0,s=t.keepColor===!0,c=`${r?`f`:``}${i?`k`:``}${a?`u`:``}${o?`m`:``}${s?`c`:``}`;if(n[bn]===c||(n[bn]=c,!r&&!i&&!a))return;let l={value:i?2:o?1.25:+!!a},u=e.onBeforeCompile;e.onBeforeCompile=(t,n)=>{u.call(e,t,n),Object.assign(t.uniforms,mn),t.uniforms.valeCharMode=l,r&&(t.vertexShader=t.vertexShader.replace(`#include <common>`,`#include <common>\n${gn}`).replace(`#include <project_vertex>`,`#include <project_vertex>\n${_n}`),t.fragmentShader=t.fragmentShader.replace(`#include <common>`,`#include <common>\n${s?`#define VALE_KEEP_COLOR
`:``}varying vec3 vValeWorld;\n${hn}`).replace(`#include <opaque_fragment>`,`outgoingLight = valeApplyWorldFog( outgoingLight, vValeWorld );
#include <opaque_fragment>`),!i&&!a&&(t.fragmentShader=t.fragmentShader.replace(`#include <common>`,`#include <common>\n${wn}`).replace(`#include <lights_fragment_begin>`,Tn))),(i||a)&&(t.fragmentShader=t.fragmentShader.replace(`#include <common>`,`#include <common>\n${vn}`).replace(`#include <lights_fragment_begin>`,En).replace(`#include <color_fragment>`,`#include <color_fragment>
if ( valeCharMode > 1.5 ) diffuseColor.rgb = valeCharHue( diffuseColor.rgb );`).replace(`#include <lights_fragment_end>`,`#include <lights_fragment_end>\n${yn}`))};let d=e.customProgramCacheKey,f=`${r?`f`:``}${i||a?`x`:``}${s?`c`:``}`;e.customProgramCacheKey=()=>`${d.call(e)}|vale:${f}`,e.needsUpdate=!0}var An=(function(){var e=`b9H79Tebbbe;veC9Geueu9Geub9Gbb9Gsuuuuuuuuuuuu99uueu9Gvuuuuub9Gruuuuuuub9Gouuuuuue999Gvuuuuueu9Gzuuuuuuuuuuu99uuuub9Gquuuuuuu99uueu9GPuuuuuuuuuuu99uueu9Gquuuuuuuu99ueu9Gruuuuuu99eu9Gwuuuuuu99ueu9Giuuue999GDuuuuuuuuueu9Gkuuuuuuuu99uub9Gluuuueu9Gluuuub9Giuuueui3EdilvorlwDiqkrxmPszdHObAAbeAlve9Weiiviebeoweuecj:Gdkr:Sdmo9TW9T9VV95dbH9F9F939H79T9F9J9H229F9Jt9VV7bbz9TW79O9V9Wt9F79P9T9W29P9M95bw8E9TW79O9V9Wt9F79P9T9W29P9M959x9Pt9OcttV9P9I91tW7bD8A9TW79O9V9Wt9F79P9T9W29P9M959x9Pt9O9v9W9K9HtWbqQ9TW79O9V9Wt9F79P9T9W29P9M959t29V9W9W95bkX9TW79O9V9Wt9F79P9T9W29P9M959qV919UWbmQ9TW79O9V9Wt9F79P9T9W29P9M959q9V9P9Ut7bPX9TW79O9V9Wt9F79P9T9W29P9M959t9J9H2WbsP9TW79O9V9Wt9FVW9TW79Obza9TW79O9V9Wt9F9V9Wt9P9T9P96W9wWVtW94SWt9J9O9sW9T9H9WbA59TW79O9V9Wt9F9NW9UWV9HtW9q9V79Pt9P9V9U9sW9T9H9WbCl79IV9RbXDwebcekdKYq:p:1dElbzOk:Q:tekYue99iuQ99eui99Due99xue9:w998Jjjjjbcj;sb9Rgs8Kjjjjbcbhzasc:Cefcbc;Kbz:xjjjb8AdnabaeSmbabaeadcdtz:wjjjb8AkdnamcdGTmbalcrfci4cbyd;y:L:cjbHjjjjbbhHasc:Cefasyd;8egecdtfaHBdbasaecefBd;8ecbhlcbhednadTmbabheadhOinaHaeydbci4fcb86bbaeclfheaOcufgOmbkcbhlabheadhOinaHaeydbgAci4fgCaCRbbgCceaAcrGgAtV86bbaCcu7aA4ceGalfhlaeclfheaOcufgOmbkcualcdtalcFFFFi0Ehekaecbyd;y:L:cjbHjjjjbbhzasc:Cefasyd;8egecdtfazBdbasaecefBd;8ealcd4alfhOcehHinaHgecethHaeaO6mbkcbhXcuaecdtgOaecFFFFi0Ecbyd;y:L:cjbHjjjjbbhHasc:Cefasyd;8egAcdtfaHBdbasaAcefBd;8eaHcFeaOz:xjjjbhQdnadTmbaecufhLcbhKindndnaQabaKcdtfgYydbgAc:v;t;h;Ev2aLGgOcdtfgCydbgHcuSmbceheinazaHcdtfydbaASmdaOaefhHaecefheaQaHaLGgOcdtfgCydbgHcu9hmbkkazaXcdtfaABdbaCaXBdbaXhHaXcefhXkaYaHBdbaKcefgKad9hmbkkaQcbyd;C:L:cjbH:bjjjbbasasyd;8ecufBd;8ekcbh8AcualcefgecdtaecFFFFi0Ecbyd;y:L:cjbHjjjjbbhKasc:Cefasyd;8egecdtfaKBdbasaKBdNeasaecefBd;8ecuadcitadcFFFFe0Ecbyd;y:L:cjbHjjjjbbhEasc:Cefasyd;8egecdtfaEBdbasaEBd:yeasaecefBd;8eascNefabadalcbz:cjjjbcualcdtgealcFFFFi0Eg3cbyd;y:L:cjbHjjjjbbhHasc:Cefasyd;8egOcdtfaHBdbasaOcefBd;8ea3cbyd;y:L:cjbHjjjjbbhXasc:Cefasyd;8egOcdtfaXBdbasaOcefBd;8eaHaXaialavazasc:Cefz:djjjbalcbyd;y:L:cjbHjjjjbbh5asc:Cefasyd;8egOcdtfa5BdbasaOcefBd;8ea3cbyd;y:L:cjbHjjjjbbhOasc:Cefasyd;8egAcdtfaOBdbasaAcefBd;8ea3cbyd;y:L:cjbHjjjjbbhAasc:Cefasyd;8egCcdtfaABdbasaCcefBd;8eaOcFeaez:xjjjbh8EaAcFeaez:xjjjbh8FdnalTmbindnaKa8AgAcefg8AcdtfydbgCaKaAcdtgefydbgOSmbaCaO9RhYaEaOcitfhaa8Faefhha8EaefhLcbhCindndnaaaCcitfydbgQaA9hmbaLaABdbahaABdbxekdnaKaQcdtggfgeclfydbgOaeydbgeSmbaOae9RhOaEaecitfheinaeydbaASmdaecwfheaOcufgOmbkka8FagfgeaAaQaeydbcuSEBdbaLaQaAaLydbcuSEBdbkaCcefgCaY9hmbkka8Aal9hmbkaHhOaXhAa8EhQa8FhCcbheindndnaeaOydbgL9hmbdnaeaAydbgL9hmbaQydbhLdnaCydbgYcu9hmbaLcu9hmba5aefcb86bbxikdnaYcuSmbaLcuSmbaeaYSmbaHaYcdtfydbaHaLcdtfydb9hmba5aefcd86bbxika5aefhadnaeaYSmbaeaLSmbaace86bbxikaacv86bbxdkdnaeaXaLcdtgYfydb9hmbdnaCydbgacuSmbaeaaSmbaQydbggcuSmbaeagSmba8FaYfydbghcuSmbahaLSmba8EaYfydbgYcuSmbaYaLSmbaHaacdtfydbgLaHaYcdtfydb9hmbaLaHagcdtfydbgYSmbaYaHahcdtfydb9hmba5aefcd86bbxika5aefcv86bbxdka5aefcv86bbxeka5aefa5aLfRbb86bbkaOclfhOaAclfhAaQclfhQaCclfhCalaecefge9hmbkdnamcaGTmbcbh8Jindndna5a8Jfg8KRbbg8Lc9:fPlbeebekdndndnaHa8Jcdtfydbgea8J9hmbcbhYcbh8MaqTmednazTmbcbh8Ma8JheinaqazaecdtgefydbfRbbce4a8MVceGh8MaXaefydbgea8J9hmbxikkcbh8Ma8JheinaqaefRbbce4a8MVceGh8MaXaecdtfydbgea8J9hmbxdkka5aefRbbhexeka8JheindnaKaecdtg8AfgeclfydbgOaeydbgeSmbaOae9RhgaEaecitfhhaHa8AfhacbhLinahaLcitfydbgQhednindnaKaecdtgCfgeclfydbgOaeydbgeSmbaOae9RhOaEaecitfheaaydbhAdninaHaeydbcdtfydbaASmeaecwfheaOcufgOTmdxbkkcbhexdkaXaCfydbgeaQ9hmbkcehekaYaeVhYaLcefgLag9hmbkkaXa8Afydbgea8J9hmbka8LclciaYceGEa8MEheka8Kae86bbka8Jcefg8Jal9hmbkkdnaqTmbdndnazTmbazheaHhOalhAindnaqaeydbfRbbceGTmba5aOydbfcv86bbkaeclfheaOclfhOaAcufgAmbxdkkaqheaHhOalhAindnaeRbbceGTmba5aOydbfcv86bbkaecefheaOclfhOaAcufgAmbkkaHhealhAa5hOindna5aeydbfRbbcv9hmbaOcv86bbkaeclfheaOcefhOaAcufgAmbkkamceGTmba5healhOindndnaeRbbcufPlbeebekaecv86bbkaecefheaOcufgOmbkkcbh8Ncualcx2alc;v:Q;v:Qe0Ecbyd;y:L:cjbHjjjjbbh8Kasc:Cefasyd;8egecdtfa8KBdbasaecefBd;8eascbBd:qeas9cb83i1ea8Kaialavazasc1efz:ejjjbhydndnaDmbcbh8PcbhaxekcbhaawhecbhOindnaeIdbJbbbb9ETmbasaacdtfaOBdbaacefhakaeclfheaDaOcefgO9hmbkcuaaal2gecdtaecFFFFi0Ecbyd;y:L:cjbHjjjjbbh8Pasc:Cefasyd;8egecdtfa8PBdbasaecefBd;8ealTmbdnaambcbhaxekarcd4hgdnazTmbaacdthhcbhLa8PhYinaoazaLcdtfydbag2cdtfhQasheaYhOaahAinaOaQaeydbcdtgCfIdbawaCfIdbNUdbaeclfheaOclfhOaAcufgAmbkaYahfhYaLcefgLal9hmbxdkkaacdthhcbhLa8PhYinaoaLag2cdtfhQasheaYhOaahAinaOaQaeydbcdtgCfIdbawaCfIdbNUdbaeclfheaOclfhOaAcufgAmbkaYahfhYaLcefgLal9hmbkkcualc8S2gOalc;D;O;f8U0EgCcbyd;y:L:cjbHjjjjbbheasc:Cefasyd;8egAcdtfaeBdbasaAcefBd;8eaecbaOz:xjjjbhIcbh8RcbhgdnaaTmbcbh8NaCcbyd;y:L:cjbHjjjjbbhgasc:Cefasyd;8egecdtfagBdbasaecefBd;8eagcbaOz:xjjjb8Acuaaal2gecltgOaecFFFFb0Ecbyd;y:L:cjbHjjjjbbh8Rasc:Cefasyd;8egecdtfa8RBdbasaecefBd;8ea8RcbaOz:xjjjb8AamcjjjjdGTmbcualcltgealcFFFFb0Ecbyd;y:L:cjbHjjjjbbh8Nasc:Cefasyd;8egOcdtfa8NBdbasaOcefBd;8ea8Ncbaez:xjjjb8AkdnadTmbcbhQabhOina8KaOclfydbgLcx2fgeIdba8KaOydbgYcx2fgAIdbg8S:tgRa8KaOcwfydbghcx2fgCIdlaAIdlg8U:tg8VNaeIdla8U:tg8WaCIdba8S:tg8XN:tg8Ya8YNa8WaCIdwaAIdwg8Z:tg80NaeIdwa8Z:tg8Wa8VN:tg81a81Na8Wa8XNaRa80N:tg80a80NMMg8V:rhBa8Yh8Xa80h8Wa81hRdna8VJbbbb9EgATmba8YaB:vh8Xa80aB:vh8Wa81aB:vhRkaIaHaYcdtfydbgCc8S2fgeaRaB:rg8VaRNNg83aeIdbMUdbaea8Wa8Va8WNgUNg85aeIdlMUdlaea8Xa8Va8XNg86Ng87aeIdwMUdwaeaRaUNgUaeIdxMUdxaea86aRNg88aeIdzMUdzaea8Wa86Ng89aeIdCMUdCaeaRa8Va8Xa8ZNaRa8SNa8Ua8WNMM:mg8:Ng86NgRaeIdKMUdKaea8Wa86Ng8WaeId3MUd3aea8Xa86Ng8XaeIdaMUdaaea86a8:Ng86aeId8KMUd8Kaea8VaeIdyMUdyaIaHaLcdtfydbgLc8S2fgea83aeIdbMUdbaea85aeIdlMUdlaea87aeIdwMUdwaeaUaeIdxMUdxaea88aeIdzMUdzaea89aeIdCMUdCaeaRaeIdKMUdKaea8WaeId3MUd3aea8XaeIdaMUdaaea86aeId8KMUd8Kaea8VaeIdyMUdyaIaHahcdtfydbgYc8S2fgea83aeIdbMUdbaea85aeIdlMUdlaea87aeIdwMUdwaeaUaeIdxMUdxaea88aeIdzMUdzaea89aeIdCMUdCaeaRaeIdKMUdKaea8WaeId3MUd3aea8XaeIdaMUdaaea86aeId8KMUd8Kaea8VaeIdyMUdydna8NTmbdnaATmba8YaB:vh8Ya80aB:vh80a81aB:vh81ka8NaCcltfgeaBJbbbZNgRa80Ng8VaeIdlMUdlaeaRa8YNg8WaeIdwMUdwaeaRa81Ng8XaeIdbMUdbaeaRa8S:ma81Na8Ua80N:ta8Za8YN:tNgRaeIdxMUdxa8NaLcltfgea8VaeIdlMUdlaea8WaeIdwMUdwaea8XaeIdbMUdbaeaRaeIdxMUdxa8NaYcltfgea8VaeIdlMUdlaea8WaeIdwMUdwaea8XaeIdbMUdbaeaRaeIdxMUdxkaOcxfhOaQcifgQad6mbkkdnalTmbJq;x8J88J;n;m;m89J:v:;;w8ZamczGEamc;abGEh80cbhOaHhCazhQaIhea8KhAindnaOaCydb9hmbaOhLdnazTmbaQydbhLka80hRdnaqTmbJbbjZa80aqaLfRbbclGEhRkaecxfgLaLIdbJbbbbMUdbaeczfgLaLIdbJbbbbMUdbaecCfgLaLIdbJbbbbMUdbaeaRaecyfgLIdbg8YNgRaeIdbMUdbaeclfgYaRaYIdbMUdbaecwfgYaRaYIdbMUdbaecKfgYaYIdbaAIdbg8WaRN:tUdbaAcwfIdbh8Vaec3fgYaYIdbaRaAclfIdbg8XN:tUdbaecafgYaYIdbaRa8VN:tUdbaec8KfgYIdbh81aLa8YaRMUdbaYa81aRa8Va8VNa8Wa8WNa8Xa8XNMMNMUdbkaCclfhCaQclfhQaec8SfheaAcxfhAalaOcefgO9hmbkkdnadTmbcbh8AabhLinaba8AcdtfhYcbheindna5aLaefydbgCfRbbgOTmba5aYaec:G:G:cjbfydbcdtfydbgQfRbbcFeGgATmbdnaOclSghmbaOci6mbaAclSmbaAcd0mekdnaOcd0mba8EaCcdtfydbaQ9hmekdnaAcd0mba8FaQcdtfydbaC9hmekdndnahmbaAcl9hmekaOciSmeaAciSmekJbbbZJbbbZJbbacaAcdSEaOcdSEhUdna8KaYaec:K:G:cjbfydbcdtfydbcx2fgOIdwa8KaCcx2fgAIdwg86:tg8Sa8KaQcx2fghIdwa86:tg8Xa8XNahIdbaAIdbg8U:tg80a80NahIdlaAIdlg8Z:tg8Va8VNMMg81Na8Xa8Sa8XNaOIdba8U:tg83a80Na8VaOIdla8Z:tg85NMMg8WN:tg8Ya8YNa83a81Na80a8WN:tgRaRNa85a81Na8Va8WN:tg8Wa8WNMMgBJbbbb9ETmba8YaB:rgB:vh8Ya8WaB:vh8WaRaB:vhRkaUa81:rNgBa8Ya86NaRa8UNa8Za8WNMM:mg81Ng87a81Nh88a80a85Na8Va83N:tg81a81Na8Va8SNa8Xa85N:tg8Va8VNa8Xa83Na80a8SN:tg8Xa8XNMMg83:rh80a8Ya87Nh85a8Wa87Nh89aRa87Nh87a8WaBa8YNg8SNh8:a8SaRNhZaRaBa8WNgnNhca8Ya8SNh8Ya8WanNh8WaRaBaRNNh8Sdna83Jbbbb9ETmba81a80:vh81a8Xa80:vh8Xa8Va80:vh8VkaIaHaCcdtfydbc8S2fgOaOIdba8Sa8VaUa80:rNgRa8VNNMg80MUdbaOa8Wa8XaRa8XNg8SNMg83aOIdlMUdlaOa8Ya81aRa81Ng8WNMg8YaOIdwMUdwaOaca8Va8SNMg8SaOIdxMUdxaOaZa8Wa8VNMgUaOIdzMUdzaOa8:a8Xa8WNMg8WaOIdCMUdCaOa87a8VaRa81a86Na8Va8UNa8Za8XNMMg86:mNgRNMg8VaOIdKMUdKaOa89a8XaRNMg8XaOId3MUd3aOa85a81aRNMg81aOIdaMUdaaOa88a86aRN:tgRaOId8KMUd8KaOaBaOIdyMUdyaIaHaQcdtfydbc8S2fgOa80aOIdbMUdbaOa83aOIdlMUdlaOa8YaOIdwMUdwaOa8SaOIdxMUdxaOaUaOIdzMUdzaOa8WaOIdCMUdCaOa8VaOIdKMUdKaOa8XaOId3MUd3aOa81aOIdaMUdaaOaRaOId8KMUd8KaOaBaOIdyMUdykaeclfgecx9hmbkaLcxfhLa8Acifg8Aad6mbkkdnamcjeGTmbalTmbcbh9cindnaKa9cgecdtgOfydbghaKaecefg9ccdtfydbg8M9pmba8Kaecx2fhDaIaHaOfydbgCc8S2fh8AindnaHaEahcitfgeydbgLcdtfydbg8JaC0mbaeydlh8LcuhAaLheindnaKaecdtgYfgeclfydbgOaeydbgeSmbaOae9RhOaEaecitfheindnaHaeydbcdtfydbaC9hmbaAcu9hhQaLhAaQmbaeclfydbhAkaecwfheaOcufgOmbkkaXaYfydbgeaL9hmbkaAaLSmbaAcuSmba8KaLcx2fgeIdbaDIdbg81:tgRa8Ka8Lcx2fgOIdlaDIdlg80:tg8XNaeIdla80:tg8VaOIdba81:tg8YN:tg86a8KaAcx2fgAIdba81:tg8Za8VNaAIdla80:tg83aRN:tg8SNa8VaOIdwaDIdwgB:tg8UNaeIdwaB:tg8Wa8XN:tg85a83a8WNaAIdwaB:tg87a8VN:tgUNa8Wa8YNaRa8UN:tg88a87aRNa8Za8WN:tg89NMMa86a86Na85a85Na88a88NMM:rJ:A:z9z:;Na8Sa8SNaUaUNa89a89NMM:rN9Gmbdna8Ua8Wa8WNaRaRNa8Va8VNMMg8SNa8Wa8Ua8WNa8YaRNa8Va8XNMMg86N:tg8Ua8UNa8Ya8SNaRa86N:tg8Ya8YNa8Xa8SNa8Va86N:tg86a86NMMg8XJbbbb9ETmba8Ua8X:rg8X:vh8Ua86a8X:vh86a8Ya8X:vh8Yka8S:rg8Xa8UaBNa8Ya81Na80a86NMM:mgUNg85aUNhUa8Ua85Nh88a86a85Nh89a8Ya85Nh8:a86a8Xa8UNg85NhZa85a8YNhna8Ya8Xa86NgcNhJa8Ua85Nh8Ua86acNh86a8Ya8Xa8YNNh85dna87a8SNa8Wa87a8WNa8ZaRNa8Va83NMMg8YN:tg8Wa8WNa8Za8SNaRa8YN:tgRaRNa83a8SNa8Va8YN:tg8Va8VNMMg8YJbbbb9ETmba8Wa8Y:rg8Y:vh8Wa8Va8Y:vh8VaRa8Y:vhRka8Aa8AIdba85aRa8XaRNNMg8SMUdba8Aa86a8Va8Xa8VNg8ZNMg86a8AIdlMUdla8Aa8Ua8Wa8Xa8WNg8YNMg8Ua8AIdwMUdwa8AaJaRa8ZNMg8Za8AIdxMUdxa8Aana8YaRNMg83a8AIdzMUdza8AaZa8Va8YNMg85a8AIdCMUdCa8Aa8:aRa8Xa8WaBNaRa81Na80a8VNMMg81:mNg8YNMgRa8AIdKMUdKa8Aa89a8Va8YNMg8Va8AId3MUd3a8Aa88a8Wa8YNMg8Wa8AIdaMUdaa8AaUa81a8YN:tg8Ya8AId8KMUd8Ka8Aa8Xa8XMg8Xa8AIdyMUdyaIa8Jc8S2fgea8SaeIdbMUdbaea86aeIdlMUdlaea8UaeIdwMUdwaea8ZaeIdxMUdxaea83aeIdzMUdzaea85aeIdCMUdCaeaRaeIdKMUdKaea8VaeId3MUd3aea8WaeIdaMUdaaea8YaeId8KMUd8Kaea8XaeIdyMUdykahcefgha8M9hmbkka9cal9hmbkkdnadTmbaaTmbcbhYinJbbbbh80a8KabaYcdtfgeclfydbgLcx2fgOIdwa8Kaeydbghcx2fgAIdwg8Z:tg8Va8VNaOIdbaAIdbg83:tg8Wa8WNaOIdlaAIdlg85:tg8Xa8XNMMg8Sa8Kaecwfydbg8Acx2fgeIdwa8Z:tg8YNa8Va8YNa8WaeIdba83:tg81Na8XaeIdla85:tgBNMMgRa8VN:tJbbbbJbbjZa8Sa8Ya8YNa81a81NaBaBNMMg8UNaRaRN:tg86:va86Jbbbb9BEg86Nh88a8Ua8VNaRa8YN:ta86Nh89a8SaBNaRa8XN:ta86Nh8:a8Ua8XNaRaBN:ta86NhZa8Sa81NaRa8WN:ta86Nhna8Ua8WNaRa81N:ta86Nhca8WaBNa8Xa81N:tgRaRNa8Xa8YNa8VaBN:tgRaRNa8Va81Na8Wa8YN:tgRaRNMM:rJbbbZNhRa8Pahaa2g8JcdtfhOa8Pa8Aaa2g8McdtfhAa8PaLaa2gDcdtfhCa8Z:mhJa85:mh9ea83:mhTascjdfheaahQJbbbbhBJbbbbh86Jbbbbh8SJbbbbh8UJbbbbh8ZJbbbbh83Jbbbbh85Jbbbbh87JbbbbhUinaecwfaRa89aCIdbaOIdbg8Y:tg8XNa88aAIdba8Y:tg81NMg8VNUdbaeclfaRaZa8XNa8:a81NMg8WNUdbaeaRaca8XNana81NMg8XNUdbaecxfaRaJa8VNa9ea8WNa8YaTa8XNMMMg8YNUdbaRa8Va8WNNa8ZMh8ZaRa8Va8XNNa8UMh8UaRa8Wa8XNNa8SMh8SaRa8Ya8YNNaUMhUaRa8Va8YNNa87Mh87aRa8Wa8YNNa85Mh85aRa8Xa8YNNa83Mh83aRa8Va8VNNa86Mh86aRa8Wa8WNNaBMhBaRa8Xa8XNNa80Mh80aOclfhOaCclfhCaAclfhAaeczfheaQcufgQmbkagahc8S2fgea80aeIdbMUdbaeaBaeIdlMUdlaea86aeIdwMUdwaea8SaeIdxMUdxaea8UaeIdzMUdzaea8ZaeIdCMUdCaea83aeIdKMUdKaea85aeId3MUd3aea87aeIdaMUdaaeaUaeId8KMUd8KaeaRaeIdyMUdyagaLc8S2fgea80aeIdbMUdbaeaBaeIdlMUdlaea86aeIdwMUdwaea8SaeIdxMUdxaea8UaeIdzMUdzaea8ZaeIdCMUdCaea83aeIdKMUdKaea85aeId3MUd3aea87aeIdaMUdaaeaUaeId8KMUd8KaeaRaeIdyMUdyaga8Ac8S2fgea80aeIdbMUdbaeaBaeIdlMUdlaea86aeIdwMUdwaea8SaeIdxMUdxaea8UaeIdzMUdzaea8ZaeIdCMUdCaea83aeIdKMUdKaea85aeId3MUd3aea87aeIdaMUdaaeaUaeId8KMUd8KaeaRaeIdyMUdya8Ra8JcltfhLcbhOaahCinaLaOfgeascjdfaOfgAIdbaeIdbMUdbaeclfgQaAclfIdbaQIdbMUdbaecwfgQaAcwfIdbaQIdbMUdbaecxfgeaAcxfIdbaeIdbMUdbaOczfhOaCcufgCmbka8RaDcltfhLcbhOaahCinaLaOfgeascjdfaOfgAIdbaeIdbMUdbaeclfgQaAclfIdbaQIdbMUdbaecwfgQaAcwfIdbaQIdbMUdbaecxfgeaAcxfIdbaeIdbMUdbaOczfhOaCcufgCmbka8Ra8McltfhLcbhOaahCinaLaOfgeascjdfaOfgAIdbaeIdbMUdbaeclfgQaAclfIdbaQIdbMUdbaecwfgQaAcwfIdbaQIdbMUdbaecxfgeaAcxfIdbaeIdbMUdbaOczfhOaCcufgCmbkaYcifgYad6mbkkcbhAdndnamcwGgSmbJbbbbh86cbh9hcbh9icbh6xekcbh9ha3cbyd;y:L:cjbHjjjjbbh6asc:Cefasyd;8egecdtfa6BdbasaecefBd;8ecua6alabadaHz:fjjjbgCcltaCcjjjjiGEcbyd;y:L:cjbHjjjjbbh9iasc:Cefasyd;8egecdtfa9iBdbasaecefBd;8ea9iaCa6a8Kalz:gjjjbJFFuuh86aCTmba9iheaChOinaeIdbgRa86a86aR9EEh86aeclfheaOcufgOmbkaCh9hkdnalTmbaKclfheaKydbhCa5hOalhQcbhAincbaeydbgLaC9RaORbbcpeGEaAfhAaOcefhOaeclfheaLhCaQcufgQmbkaAce4hAkcuadaA9Rcifg9kcx2a9kc;v:Q;v:Qe0Ecbyd;y:L:cjbHjjjjbbh0asc:Cefasyd;8egecdtfa0BdbasaecefBd;8ecua9kcdta9kcFFFFi0Ecbyd;y:L:cjbHjjjjbbh9masc:Cefasyd;8egecdtfa9mBdbasaecefBd;8ea3cbyd;y:L:cjbHjjjjbbh9nasc:Cefasyd;8egecdtfa9nBdbasaecefBd;8ealcbyd;y:L:cjbHjjjjbbh9oasc:Cefasyd;8egecdtfa9oBdbasaecefBd;8eaxaxNayJbbjZamclGEg9pa9pN:vh87JbbbbhUdnadak9nmbdna9kci6mbamcjdGh9qaaclth9ra0cwfh9sJbbbbh85JbbbbhUinascNefabadalaHz:cjjjbabh8Acbh3cbh9tinaba9tcdtfh8McbheindnaHa8AaefydbgAcdtghfydbgCaHa8Maec:W:G:cjbfydbcdtfydbgOcdtg8JfydbgQSmba5aOfRbbgYco2a5aAfRbbgLfRb;a:G:cjbg8LaLco2aYfgDRb;a:G:cjbg9cVcFeGTmbdnaQaC9nmbaDRb;W:G:cjbcFeGmekdnaLcufcFeGce0mbaYTmba8EahfydbaO9hmekdnaLTmbaYcufcFeGce0mba8Fa8JfydbaA9hmeka0a3cx2fgCaOaAa9ccFeGgQEBdlaCaAaOaQEBdbaCaQa8LGcb9hBdwa3cefh3kaeclfgecx9hmbkdna9tcifg9tad9pmba8Acxfh8Aa3cifa9k9nmekka3TmdcbhDinaIaHa0aDcx2fghydbgLcdtgCfydbg8Jc8S2fgeIdwa8KahydlgYcx2fgOIdwg8WNaeIdzaOIdbg8XNaeIdaMgRaRMMa8WNaeIdlaOIdlg8YNaeIdCa8WNaeId3MgRaRMMa8YNaeIdba8XNaeIdxa8YNaeIdKMgRaRMMa8XNaeId8KMMM:lhRJbbbbJbbjZaeIdyg8V:va8VJbbbb9BEh8Vdndnahydwg8MmbJFFuuhBxekJbbbbJbbjZaIaHaYcdtfydbc8S2fgeIdyg81:va81Jbbbb9BEaeIdwa8KaLcx2fgOIdwg81NaeIdzaOIdbg80NaeIdaMgBaBMMa81NaeIdlaOIdlgBNaeIdCa81NaeId3Mg81a81MMaBNaeIdba80NaeIdxaBNaeIdKMg81a81MMa80NaeId8KMMM:lNhBka8VaRNh80dnaaTmbagaLc8S2fgAIdwa8WNaAIdza8XNaAIdaMgRaRMMa8WNaAIdla8YNaAIdCa8WNaAId3MgRaRMMa8YNaAIdba8XNaAIdxa8YNaAIdKMgRaRMMa8XNaAId8KMMMhRa8PaYaa2gQcdtfhOa8RaLaa2g8AcltfheaAIdyh81aahAinaOIdbg8Va8Va81NaecxfIdba8WaecwfIdbNa8XaeIdbNa8YaeclfIdbNMMMg8Va8VM:tNaRMhRaOclfhOaeczfheaAcufgAmbkaR:lgRa81aRa819DEaRa9qEh8Sdndna8MmbJbbbbhRxekagaYc8S2fgAIdwa8KaLcx2fgeIdwg8WNaAIdzaeIdbg8XNaAIdaMgRaRMMa8WNaAIdlaeIdlg8YNaAIdCa8WNaAId3MgRaRMMa8YNaAIdba8XNaAIdxa8YNaAIdKMgRaRMMa8XNaAId8KMMMhRa8Pa8AcdtfhOa8RaQcltfheaAIdyh81aahAinaOIdbg8Va8Va81NaecxfIdba8WaecwfIdbNa8XaeIdbNa8YaeclfIdbNMMMg8Va8VM:tNaRMhRaOclfhOaeczfheaAcufgAmbkaR:lgRa81aRa819DEaRa9qEhRka80a8SMh80aBaRMhBdndndna5aLfRbbc9:fPibeedkdna8Fa8Ea8EaCfydbaYSEaXaCfydbgQcdtfydbgCcu9hmbaXaYcdtfydbhCkagaQc8S2fgAIdwa8KaCcx2fgeIdwg8WNaAIdzaeIdbg8XNaAIdaMgRaRMMa8WNaAIdlaeIdlg8YNaAIdCa8WNaAId3MgRaRMMa8YNaAIdba8XNaAIdxa8YNaAIdKMgRaRMMa8XNaAId8KMMMhRa8PaCaa2g8AcdtfhOa8RaQaa2g8JcltfheaAIdyh81aahAinaOIdbg8Va8Va81NaecxfIdba8WaecwfIdbNa8XaeIdbNa8YaeclfIdbNMMMg8Va8VM:tNaRMhRaOclfhOaeczfheaAcufgAmbkaR:lgRa81aRa819DEaRa9qEh8Sdndna8MmbJbbbbhRxekagaCc8S2fgAIdwa8KaQcx2fgeIdwg8WNaAIdzaeIdbg8XNaAIdaMgRaRMMa8WNaAIdlaeIdlg8YNaAIdCa8WNaAId3MgRaRMMa8YNaAIdba8XNaAIdxa8YNaAIdKMgRaRMMa8XNaAId8KMMMhRa8Pa8JcdtfhOa8Ra8AcltfheaAIdyh81aahAinaOIdbg8Va8Va81NaecxfIdba8WaecwfIdbNa8XaeIdbNa8YaeclfIdbNMMMg8Va8VM:tNaRMhRaOclfhOaeczfheaAcufgAmbkaR:lgRa81aRa819DEaRa9qEhRka80a8SMh80aBaRMhBxdkaXaCfydbgCaLSmbaHaYcdtfydbh8Aindndna8EaCcdtgQfydbgecuSmbaHaecdtfydba8ASmekdna8FaQfydbgecuSmbaHaecdtfydba8ASmekaYhekagaCc8S2fgAIdwa8Kaecx2fgOIdwg8WNaAIdzaOIdbg8XNaAIdaMgRaRMMa8WNaAIdlaOIdlg8YNaAIdCa8WNaAId3MgRaRMMa8YNaAIdba8XNaAIdxa8YNaAIdKMgRaRMMa8XNaAId8KMMMhRa8Paeaa2cdtfhOa8RaCaa2cltfheaAIdyh81aahAinaOIdbg8Va8Va81NaecxfIdba8WaecwfIdbNa8XaeIdbNa8YaeclfIdbNMMMg8Va8VM:tNaRMhRaOclfhOaeczfheaAcufgAmbka80aR:lgRa81aRa819DEaRa9qEMh80aXaQfydbgCaL9hmbkkdna5aYfRbbgeciSmbaecl9hmeka8MTmbaXaYcdtfydbgCaYSmbindndna8EaCcdtgQfydbgecuSmbaHaecdtfydba8JSmekdna8FaQfydbgecuSmbaHaecdtfydba8JSmekaLhekagaCc8S2fgAIdwa8Kaecx2fgOIdwg8WNaAIdzaOIdbg8XNaAIdaMgRaRMMa8WNaAIdlaOIdlg8YNaAIdCa8WNaAId3MgRaRMMa8YNaAIdba8XNaAIdxa8YNaAIdKMgRaRMMa8XNaAId8KMMMhRa8Paeaa2cdtfhOa8RaCaa2cltfheaAIdyh81aahAinaOIdbg8Va8Va81NaecxfIdba8WaecwfIdbNa8XaeIdbNa8YaeclfIdbNMMMg8Va8VM:tNaRMhRaOclfhOaeczfheaAcufgAmbkaBaR:lgRa81aRa819DEaRa9qEMhBaXaQfydbgCaY9hmbkkahaBa80aBa809DgeEUdwahaLaYaea8Mcb9hGgeEBdlahaYaLaeEBdbaDcefgDa39hmbkascjdfcbcj;qbz:xjjjb8Aa9shea3hOinascjdfaeydbcA4cF8FGgAcFAaAcFA6EcdtfgAaAydbcefBdbaecxfheaOcufgOmbkcbhecbhOinascjdfaefgAydbhCaAaOBdbaCaOfhOaeclfgecj;qb9hmbkcbhea9shOinascjdfaOydbcA4cF8FGgAcFAaAcFA6EcdtfgAaAydbgAcefBdba9maAcdtfaeBdbaOcxfhOa3aecefge9hmbkadak9RgAci9Uh9udnalTmbcbhea9nhOinaOaeBdbaOclfhOalaecefge9hmbkkcbh9va9ocbalz:xjjjbh9caAcO9Uh9wa9uce4h9tcbh8Lcbh8Mdnina0a9ma8Mcdtfydbcx2fg8JIdwgRa879Emea8La9u9pmeJFFuuh8Vdna9ta39pmba0a9ma9tcdtfydbcx2fIdwJbb;aZNh8VkdnaRa8V9ETmbaRaU9ETmba8La9w0mdkdna9caHa8JydlgDcdtg9xfg8AydbgAfg9yRbba9caHa8Jydbghcdtg9zfydbgefg9ARbbVmba5ahfRbbh9BdndnaKaecdtfgOclfydbgCaOydbgOSmbaCaO9RhCa8KaAcx2fhLa8Kaecx2fhYaEaOcitfheindna9naeydbcdtfydbgOaASmba9naeclfydbcdtfydbgQaASmbaOaQSmba8KaQcx2fgQIdba8KaOcx2fgOIdbg8W:tgRaYIdlaOIdlg8X:tg80NaQIdla8X:tg8VaYIdba8W:tgBN:tg8YaRaLIdla8X:tg8SNa8VaLIdba8W:tg8UN:tg8XNa8VaYIdwaOIdwg81:tg8ZNaQIdwa81:tg8Wa80N:tg80a8VaLIdwa81:tg83Na8Wa8SN:tg8VNa8WaBNaRa8ZN:tg81a8Wa8UNaRa83N:tgRNMMa8Ya8YNa80a80Na81a81NMMa8Xa8XNa8Va8VNaRaRNMMN:rJbbj8:N9FmikaecwfheaCcufgCmbkkdndna9Bc99fcFeGce0mba9na9zfaDBdbaXa9zfydbgeahSmeina8AydbhAdndna8EaecdtgOfydbgecuSmbaHaecdtfydbaASmekdna8FaOfydbgecuSmbaHaecdtfydbaASmekaDheka9naOfaeBdbaXaOfydbgeah9hmbxdkkdndna9BcFeGcdSmbaDhexekdna8Fa8Ea8Ea9zfydbaDSEaXa9zfydbghcdtfydbgecu9hmbaXa9xfydbheka9na9zfaDBdbka9nahcdtfaeBdbka9Ace86bba9yce86bba8JIdwgRaUaUaR9DEhUa9vcefh9vcecda9BcFeGceSEa8Lfh8Lxeka9tcefh9tka8Mcefg8Ma39hmbkka9vTmddnalTmbcbhLcbhhindna9nahcdtgefydbgAahSmbaHaAcdtfydbh8AdnahaHaefydb9hg8JmbaIa8Ac8S2fgeaIahc8S2fgOIdbaeIdbMUdbaeaOIdlaeIdlMUdlaeaOIdwaeIdwMUdwaeaOIdxaeIdxMUdxaeaOIdzaeIdzMUdzaeaOIdCaeIdCMUdCaeaOIdKaeIdKMUdKaeaOId3aeId3MUd3aeaOIdaaeIdaMUdaaeaOId8KaeId8KMUd8KaeaOIdyaeIdyMUdya8NTmba8Na8Acltfgea8NahcltfgOIdbaeIdbMUdbaeaOIdlaeIdlMUdlaeaOIdwaeIdwMUdwaeaOIdxaeIdxMUdxkaaTmbagaAc8S2fgeagahc8S2g8MfgOIdbaeIdbMUdbaeaOIdlaeIdlMUdlaeaOIdwaeIdwMUdwaeaOIdxaeIdxMUdxaeaOIdzaeIdzMUdzaeaOIdCaeIdCMUdCaeaOIdKaeIdKMUdKaeaOId3aeId3MUd3aeaOIdaaeIdaMUdaaeaOId8KaeId8KMUd8KaeaOIdyaeIdyMUdya9raA2hYa8RhOaahCinaOaYfgeaOaLfgAIdbaeIdbMUdbaeclfgQaAclfIdbaQIdbMUdbaecwfgQaAcwfIdbaQIdbMUdbaecxfgeaAcxfIdbaeIdbMUdbaOczfhOaCcufgCmbka8JmbJbbbbJbbjZaIa8MfgeIdygR:vaRJbbbb9BEaeIdwa8Ka8Acx2fgOIdwgRNaeIdzaOIdbg8VNaeIdaMg8Wa8WMMaRNaeIdlaOIdlg8WNaeIdCaRNaeId3MgRaRMMa8WNaeIdba8VNaeIdxa8WNaeIdKMgRaRMMa8VNaeId8KMMM:lNgRa85a85aR9DEh85kaLa9rfhLahcefghal9hmbkcbhOa8EheindnaeydbgAcuSmbdnaOa9naAcdtgCfydbgA9hmbcuhAa8EaCfydbgCcuSmba9naCcdtfydbhAkaeaABdbkaeclfhealaOcefgO9hmbkcbhOa8FheindnaeydbgAcuSmbdnaOa9naAcdtgCfydbgA9hmbcuhAa8FaCfydbgCcuSmba9naCcdtfydbhAkaeaABdbkaeclfhealaOcefgO9hmbkka85aUaaEh85cbhOabhecbhAindnaHa9naeydbcdtfydbgLcdtfydbgCaHa9naeclfydbcdtfydbgYcdtfydbgQSmbaCaHa9naecwfydbcdtfydbg8AcdtfydbghSmbaQahSmbabaOcdtfgCaLBdbaCcwfa8ABdbaCclfaYBdbaOcifhOkaecxfheaAcifgAad6mbkdndnaSmbaOhdxekdnaOak0mbaOhdxekdna86a859FmbaOhdxekJFFuuh86cbhdabhecbhAindna9ia6aeydbgCcdtfydbcdtfIdbgRa859ETmbaeclf8Pdbh9CabadcdtfgQaCBdbaQclfa9C83dbaRa86a86aR9EEh86adcifhdkaecxfheaAcifgAaO6mbkkadak0mbxdkkascNefabadalaHz:cjjjbkdndnadak0mbadhYxekdnaSmbadhYxekdna86a879FmbadhYxekcehQina86Jbb;aZNgRa87aRa879DEh8WJbbbbhRdna9hTmba9ihea9hhOinaeIdbg8VaRa8Va8W9FEaRa8VaR9EEhRaeclfheaOcufgOmbkkJFFuuh86cbhYabhecbhOindna9ia6aeydbgAcdtfydbcdtfIdbg8Va8W9ETmbaeclf8Pdbh9CabaYcdtfgCaABdbaCclfa9C83dba8Va86a86a8V9EEh86aYcifhYkaecxfheaOcifgOad6mbkdnaQaYad9hVceGmbadhYxdkaRaUaUaR9DEhUaYak9nmecbhQaYhda86a879FmbkkdnamcjjjjdGTmba9ocbalz:xjjjbh8AdnaYTmbabheaYhOina8AaeydbgAfce86bba8AaHaAcdtfydbfce86bbaeclfheaOcufgOmbkkascNefabaYalaHz:cjjjbdndnalTmbcbhCindna8AaCfRbbTmbdna5aCfRbbPlbeebekdnaHaCcdtgLfydbgeaCSmba8KaCcx2fgOa8Kaecx2fgeydwBdwaOae8Pdb83dbxekaIaCc8S2fgQIdygnanJL:3;rUNgRMh87aQIdwgxaRMh8SaQIdlg9DaRMh8UaQIdbg9EaRMh81aQIdag9FaRa8KaCcx2fg8JIdwg88N:th8ZaQId3g9GaRa8JIdlg89N:th83aQIdKg9Ha8JIdbg8:aRN:th80JbbbbhZaQIdCg9IJbbbbMh85aQIdzg9JJbbbbMhBaQIdxg9KJbbbbMh86dndnaaTmbaChAinJbbbba87agaAc8S2fgOIdygR:vaRJbbbb9BEhRa8RaAaa2cltfheaOIdaa87Na8ZMh8ZaOId3a87Na83Mh83aOIdKa87Na80Mh80aOIdCa87Na85Mh85aOIdza87NaBMhBaOIdxa87Na86Mh86aOIdwa87Na8SMh8SaOIdla87Na8UMh8UaOIdba87Na81Mh81aahOina8ZaecwfIdbg8VaecxfIdbg8YNaRN:th8Za83aeclfIdbg8Wa8YNaRN:th83a85a8Wa8VNaRN:th85a81aeIdbg8Xa8XNaRN:th81a80a8Xa8YNaRN:th80aBa8Xa8VNaRN:thBa86a8Xa8WNaRN:th86a8Sa8Va8VNaRN:th8Sa8Ua8Wa8WNaRN:th8UaeczfheaOcufgOmbkaXaAcdtfydbgAaC9hmbka8NTmba8NaCcltfgeIdxhTaeIdwhcaeIdlhJaeIdbhRxekJbbbbhTJbbbbhcJbbbbhJJbbbbhRkaBa81:vg8Wa80Na8Z:ta85aBa86a81:vg8VN:tg8Za8Ua86a8VN:tg8Y:vg8Xa8Va80Na83:tg8UN:th83acaRa8WN:taJaRa8VN:tg86a8XN:tg85a8SaBa8WN:ta8Za8XN:tgB:vg8S:mh8Za86a8Y:vgc:mhJdnJbbbbaRaRa81:vg9eN:ta86acN:ta85a8SN:tg86:la87J:983:g81NgR9ETmba8Za83NaJa8UNa9ea80NaT:tMMa86:vhZka81:laR9ETmba8Y:laR9ETmbaB:laR9ETmba9e:maZNa8W:ma8ZaZNa83aB:vMgBNa8V:maJaZNa8X:maBNa8Ua8Y:vMMg85Na80:ma81:vMMMh87aKaLfgeclfydbgOaeydbge9RhhaEaecitfhLJbbbbhRdnaOaeSg8MmbJbbbbhRaLheahhAina8Kaeclfydbcx2fgOIdwa88:tg8Va8VNaOIdba8::tg8Va8VNaOIdla89:tg8Va8VNMMg8Va8Kaeydbcx2fgOIdwa88:tg8Wa8WNaOIdba8::tg8Wa8WNaOIdla89:tg8Wa8WNMMg8WaRaRa8W9DEgRaRa8V9DEhRaecwfheaAcufgAmbkaR:rgRaRNhRkaBa88:tg8Va8VNa87a8::tg8Va8VNa85a89:tg8Va8VNMMaR9EmbaQId8KhZdna8Mmbina8KaLclfydbcx2fgeIdba8KaLydbcx2fgOIdbg8W:tgRa89aOIdlg8X:tg80NaeIdla8X:tg8Va8:a8W:tg86N:tg8YaRa85a8X:tg8SNa8Va87a8W:tg8UN:tg8XNa8Va88aOIdwg81:tg8ZNaeIdwa81:tg8Wa80N:tg80a8VaBa81:tg83Na8Wa8SN:tg8VNa8Wa86NaRa8ZN:tg81a8Wa8UNaRa83N:tgRNMMa8Ya8YNa80a80Na81a81NMMa8Xa8XNa8Va8VNaRaRNMMN:rJbbj8:N9FmdaLcwfhLahcufghmbkkJbbbbJbbjZan:vanJbbbb9BEgRaxaBNa9Ja87Na9FMg8Va8VMMaBNa9Da85Na9IaBNa9GMg8Va8VMMa85Na9Ea87Na9Ka85Na9HMg8Va8VMMa87NaZMMM:lNaRaxa88Na9Ja8:Na9FMg8Va8VMMa88Na9Da89Na9Ia88Na9GMg8Va8VMMa89Na9Ea8:Na9Ka89Na9HMg8Va8VMMa8:NaZMMM:lNJbb;aZNJ:983:g81M9Emba8JaBUdwa8Ja85Udla8Ja87UdbkaCcefgCal9hmbkdnaambcbhaxdkcbhQindna8AaQfRbbTmbaHaQcdtgefydbaQ9hmba5aQfhhaXaefh8Ja8KaQcx2fhAa8PaQaa2cdtfh8McbhEincuhCdnahRbbc99fcFeGce0mbaQhCa8JydbgeaQSmba8PaEcdtgOfhLa8MaOfIdbhRaQhCinaChOcuhCdnaLaeaa2cdtfIdbaR9CmbaOcuSmbaOhCagaec8S2fIdyagaOc8S2fIdy9ETmbaehCkaXaecdtfydbgeaQ9hmbkka8PaEcdtfhLa8RaEcltfhKaQheinaLaeaa2cdtfJbbbbJbbjZagaeaCaCcuSEgOc8S2fIdygR:vaRJbbbb9BEaKaOaa2cltfgOIdwaAIdwNaOIdbaAIdbNaOIdlaAIdlNMMaOIdxMNUdbaXaecdtfydbgeaQ9hmbkaEcefgEaa9hmbkkaQcefgQal9hmbxdkkaambcbhakaiavaoarawaaala8Ka8Pazasayasc1efa5a8Aaqz:hjjjbkdnamcjjjjlGTmbazmbaYTmbabhecbhLina5aeydbgAfRbbc3thQaecwfgXydbhHcjjjj94hCdna8EaAcdtgEfydbaeclfgKydbgOSmbcjjjj94cba8FaOcdtfydbaASEhCkaeaQaCVaAVBdba5aOfRbbc3thacjjjj94hCcjjjj94hQdna8EaOcdtfydbaHSmbcjjjj94cba8FaHcdtfydbaOSEhQkaKaaaQVaOVBdba5aHfRbbc3thOdna8EaHcdtfydbaASmbcjjjj94cba8FaEfydbaHSEhCkaXaOaCVaHVBdbaecxfheaLcifgLaY6mbkkdnazTmbaYTmbaYheinabazabydbcdtfydbBdbabclfhbaecufgembkkdnaPTmbaPa9paU:rNUdbkdnasyd;8egHTmbaHcdtasc:Ceffc98fheinaeydbcbyd;C:L:cjbH:bjjjbbaec98fheaHcufgHmbkkascj;sbf8KjjjjbaYk;Yieouabydlhvabydbclfcbaicdtz:xjjjbhoadci9UhrdnadTmbdnalTmbaehwadhDinaoalawydbcdtfydbcdtfgqaqydbcefBdbawclfhwaDcufgDmbxdkkaehwadhDinaoawydbcdtfgqaqydbcefBdbawclfhwaDcufgDmbkkdnaiTmbcbhDaohwinawydbhqawaDBdbawclfhwaqaDfhDaicufgimbkkdnadci6mbinaecwfydbhwaeclfydbhDaeydbhidnalTmbalawcdtfydbhwalaDcdtfydbhDalaicdtfydbhikavaoaicdtfgqydbcitfaDBdbavaqydbcitfawBdlaqaqydbcefBdbavaoaDcdtfgqydbcitfawBdbavaqydbcitfaiBdlaqaqydbcefBdbavaoawcdtfgwydbcitfaiBdbavawydbcitfaDBdlawawydbcefBdbaecxfhearcufgrmbkkabydbcbBdbk:todDue99aicd4aifhrcehwinawgDcethwaDar6mbkcuaDcdtgraDcFFFFi0Ecbyd;y:L:cjbHjjjjbbhwaoaoyd9GgqcefBd9GaoaqcdtfawBdbawcFearz:xjjjbhkdnaiTmbalcd4hlaDcufhxcbhminamhDdnavTmbavamcdtfydbhDkcbadaDal2cdtfgDydlgwawcjjjj94SEgwcH4aw7c:F:b:DD2cbaDydbgwawcjjjj94SEgwcH4aw7c;D;O:B8J27cbaDydwgDaDcjjjj94SEgDcH4aD7c:3F;N8N27axGhwamcdthPdndndnavTmbakawcdtfgrydbgDcuSmeadavaPfydbal2cdtfgsIdbhzcehqinaqhrdnadavaDcdtfydbal2cdtfgqIdbaz9CmbaqIdlasIdl9CmbaqIdwasIdw9BmlkarcefhqakawarfaxGgwcdtfgrydbgDcu9hmbxdkkakawcdtfgrydbgDcuSmbadamal2cdtfgsIdbhzcehqinaqhrdnadaDal2cdtfgqIdbaz9CmbaqIdlasIdl9CmbaqIdwasIdw9BmikarcefhqakawarfaxGgwcdtfgrydbgDcu9hmbkkaramBdbamhDkabaPfaDBdbamcefgmai9hmbkkakcbyd;C:L:cjbH:bjjjbbaoaoyd9GcufBd9GdnaeTmbaiTmbcbhDaehwinawaDBdbawclfhwaiaDcefgD9hmbkcbhDaehwindnaDabydbgrSmbawaearcdtfgrydbBdbaraDBdbkabclfhbawclfhwaiaDcefgD9hmbkkk;:odvuv998Jjjjjbca9Rgocbyd1:G:cjbBdKaocb8Pdj:G:cjb83izaocbydN:G:cjbBdwaocb8Pd:m:G:cjb83ibdnadTmbaicd4hrdnabmbdnalTmbcbhwinaealawcdtfydbar2cdtfhDcbhiinaoczfaifgqaDaifIdbgkaqIdbgxaxak9EEUdbaoaifgqakaqIdbgxaxak9DEUdbaiclfgicx9hmbkawcefgwad9hmbxikkarcdthwcbhDincbhiinaoczfaifgqaeaifIdbgkaqIdbgxaxak9EEUdbaoaifgqakaqIdbgxaxak9DEUdbaiclfgicx9hmbkaeawfheaDcefgDad9hmbxdkkdnalTmbcbhwinabawcx2fgiaealawcdtfydbar2cdtfgDIdbUdbaiaDIdlUdlaiaDIdwUdwcbhiinaoczfaifgqaDaifIdbgkaqIdbgxaxak9EEUdbaoaifgqakaqIdbgxaxak9DEUdbaiclfgicx9hmbkawcefgwad9hmbxdkkarcdthlcbhwaehDinabawcx2fgiaeawar2cdtfgqIdbUdbaiaqIdlUdlaiaqIdwUdwcbhiinaoczfaifgqaDaifIdbgkaqIdbgxaxak9EEUdbaoaifgqakaqIdbgxaxak9DEUdbaiclfgicx9hmbkaDalfhDawcefgwad9hmbkkJbbbbaoIdbaoIdzgx:tgkakJbbbb9DEgkaoIdlaoIdCgm:tgPaPak9DEgkaoIdwaoIdKgP:tgsasak9DEhsdnabTmbadTmbJbbbbJbbjZas:vasJbbbb9BEhkinabakabIdbax:tNUdbabclfgoakaoIdbam:tNUdbabcwfgoakaoIdbaP:tNUdbabcxfhbadcufgdmbkkdnavTmbavaPUdwavamUdlavaxUdbkask:WlewudnaeTmbcbhvabhoinaoavBdbaoclfhoaeavcefgv9hmbkkdnaiTmbcbhrinadarcdtfhwcbhDinalawaDcdtgvyd:G:G:cjbcdtfydbcdtfydbhodnalawavfydbcdtfydbgqabaqcdtfgkydbgvSmbinakabavgqcdtfgxydbgvBdbaxhkaqav9hmbkkdnaoabaocdtfgkydbgvSmbinakabavgocdtfgxydbgvBdbaxhkaoav9hmbkkdnaqaoSmbabaqaoaqao0Ecdtfaqaoaqao6EBdbkaDcefgDci9hmbkarcifgrai6mbkkdnaembcbskcbhxindnalaxcdtgvfydbax9hmbaxhodnaxabavfgDydbgvSmbaDhqinaqabavgocdtfgkydbgvBdbakhqaoav9hmbkkaDaoBdbkaxcefgxae9hmbkcbhkabhvcbhoindndnaoalydbgq9hmbdnaoavydbgq9hmbavakBdbakcefhkxdkavabaqcdtfydbBdbxekavabaqcdtfydbBdbkalclfhlavclfhvaeaocefgo9hmbkakk;jiilud99euabcbaecltz:xjjjbhvdnalTmbadhoaihralhwinarcwfIdbhDarclfIdbhqavaoydbcltfgkarIdbakIdbMUdbakaqakIdlMUdlakaDakIdwMUdwakakIdxJbbjZMUdxaoclfhoarcxfhrawcufgwmbkkdnaeTmbavhkaehrinakcxfgoIdbhDaocbBdbakakIdbJbbbbJbbjZaD:vaDJbbbb9BEgDNUdbakclfgoaDaoIdbNUdbakcwfgoaDaoIdbNUdbakczfhkarcufgrmbkkdnalTmbinavadydbcltfgkaicwfIdbakIdw:tgDaDNaiIdbakIdb:tgDaDNaiclfIdbakIdl:tgDaDNMMgDakIdxgqaqaD9DEUdxadclfhdaicxfhialcufglmbkkdnaeTmbavcxfhkinabakIdbUdbakczfhkabclfhbaecufgembkkk:moerudnaoTmbaecd4hzdnavTmbaicd4hHavcdthOcbhAindnaPaAfRbbTmbaAhednaDTmbaDaAcdtfydbhekdnasTmbasaefRbbceGmekdnamaAfRbbcvSmbabaeaz2cdtfgiaraAcx2fgCIdbakNaxIdbMUdbaiaCIdlakNaxIdlMUdlaiaCIdwakNaxIdwMUdwkadaeaH2cdtfhXaqheawhiavhCinaXaeydbcdtgQfaiIdbalaQfIdb:vUdbaeclfheaiclfhiaCcufgCmbkkawaOfhwaAcefgAao9hmbxdkkdnasmbcbheaDhiindnaPaefRbbTmbaehCdnaDTmbaiydbhCkamaefRbbcvSmbabaCaz2cdtfgCarIdbakNaxIdbMUdbaCarclfIdbakNaxIdlMUdlaCarcwfIdbakNaxIdwMUdwkaiclfhiarcxfhraoaecefge9hmbxdkkdnaDTmbindnaPRbbTmbasaDydbgefRbbceGmbamRbbcvSmbabaeaz2cdtfgearIdbakNaxIdbMUdbaearclfIdbakNaxIdlMUdlaearcwfIdbakNaxIdwMUdwkaPcefhPaDclfhDamcefhmarcxfhraocufgombxdkkazcdthicbheindnaPaefRbbTmbasaefRbbceGmbamaefRbbcvSmbabarIdbakNaxIdbMUdbabclfarclfIdbakNaxIdlMUdbabcwfarcwfIdbakNaxIdwMUdbkarcxfhrabaifhbaoaecefge9hmbkkk8MbabaeadaialavcbcbcbcbcbaoarawaDz:bjjjbk8MbabaeadaialavaoarawaDaqakaxamaPz:bjjjbkRbababaeadaialavaoarawaDaqakaxcjjjjdVamz:bjjjbk:vgoque99due99duq998Jjjjjbc;Wb9Rgq8Kjjjjbcbhkaqcxfcbc;Kbz:xjjjb8Aaqcualcx2alc;v:Q;v:Qe0Ecbyd;y:L:cjbHjjjjbbgxBdxaqceBd2axaialavcbcbz:ejjjb8AaqcualcdtalcFFFFi0Egmcbyd;y:L:cjbHjjjjbbgiBdzaqcdBd2dndnJFF959eJbbjZawJbbjZawJbbjZ9DE:vawJ9VO:d869DEgw:lJbbb9p9DTmbaw:OhPxekcjjjj94hPkadci9Uhsarco9UhzdndnaombaPcd9imekdnalTmbaPcuf:YhwdnaoTmbcbhvaihHaxhOindndnaoavfRbbceGTmbavcjjjjlVhAxekdndnaOclfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhAxekcjjjj94hAkaAcqthAdndnaOcwfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaAaXVhAdndnaOIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaAaXcCtVhAkaHaABdbaHclfhHaOcxfhOalavcefgv9hmbxdkkaxhvaihOalhHindndnavIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhAxekcjjjj94hAkaAcCthAdndnavclfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaXcqtaAVhAdndnavcwfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaOaAaXVBdbavcxfhvaOclfhOaHcufgHmbkkadTmbcbhkaehvcbhOinakaiavclfydbcdtfydbgHaiavcwfydbcdtfydbgA9haiavydbcdtfydbgXaH9haXaA9hGGfhkavcxfhvaOcifgOad6mbkkarci9UhQdndnaz:Z:rJbbbZMgw:lJbbb9p9DTmbaw:Ohvxekcjjjj94hvkaQ:ZhLcbhKc:bwhzdninakaQ9pmeazaP9Rcd9imeavazcufgOavaO9iEaPcefavaP9kEhYdnalTmbaYcuf:YhwdnaoTmbcbhOaihHaxhvindndnaoaOfRbbceGTmbaOcjjjjlVhAxekdndnavclfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhAxekcjjjj94hAkaAcqthAdndnavcwfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaAaXVhAdndnavIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaAaXcCtVhAkaHaABdbaHclfhHavcxfhvalaOcefgO9hmbxdkkaxhvaihOalhHindndnavIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhAxekcjjjj94hAkaAcCthAdndnavclfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaXcqtaAVhAdndnavcwfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaOaAaXVBdbavcxfhvaOclfhOaHcufgHmbkkcbhOdnadTmbaehvcbhHinaOaiavclfydbcdtfydbgAaiavcwfydbcdtfydbgX9haiavydbcdtfydbgraA9haraX9hGGfhOavcxfhvaHcifgHad6mbkkdnas:ZgCaL:taY:Ygwaz:Y:tg8ANak:ZgEaO:Zg3:tNaEaL:tawaP:Y:tg5Na3aC:tNMg8EJbbbb9BmbaCaE:ta5a8Aa3aL:tNNNa8E:vawMhwkdndnaOaQ0mbaOhkaYhPxekaOhsaYhzkdndnaKcl0mbdnawJbbbZMgw:lJbbb9p9DTmbaw:Ohvxdkcjjjj94hvxekaPazfcd9ThvkaKcefgKcs9hmbkkdndndnakmbJbbjZhwcbhOcdhvaDmexdkalcd4alfhHcehOinaOgvcethOavaH6mbkaqcuavcdtavcFFFFi0Ecbyd;y:L:cjbHjjjjbbgYBdCaqciBd2aqamcbyd;y:L:cjbHjjjjbbgzBdKaqclBd2dnalTmbaPcuf:YhwdnaoTmbcbhOaihAaxhHindndnaoaOfRbbceGTmbaOcjjjjlVhXxekdndnaHclfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaXcqthXdndnaHcwfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:Ohrxekcjjjj94hrkaXarVhXdndnaHIdbawNJbbbZMgC:lJbbb9p9DTmbaC:Ohrxekcjjjj94hrkaXarcCtVhXkaAaXBdbaAclfhAaHcxfhHalaOcefgO9hmbxdkkaxhOaihHalhAindndnaOIdbawNJbbbZMgC:lJbbb9p9DTmbaC:OhXxekcjjjj94hXkaXcCthXdndnaOclfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:Ohrxekcjjjj94hrkarcqtaXVhXdndnaOcwfIdbawNJbbbZMgC:lJbbb9p9DTmbaC:Ohrxekcjjjj94hrkaHaXarVBdbaOcxfhOaHclfhHaAcufgAmbkkaqcuaYavazaialz:mjjjbgXc8S2gvaXc;D;O;f8U0Ecbyd;y:L:cjbHjjjjbbgiBd3aqcvBd2aicbavz:xjjjbhOdnadTmbcbhraehiinaxaiclfydbgocx2fgvIdbaxaiydbgPcx2fgHIdbg3:tgCaxaicwfydbgYcx2fgAIdlaHIdlg8A:tgwNavIdla8A:tgEaAIdba3:tg8EN:tgLaLNaEaAIdwaHIdwg5:tg8FNavIdwa5:tgEawN:tgwawNaEa8ENaCa8FN:tgCaCNMMg8E:rhEJbbnnJbbjZazaPcdtfydbgvazaocdtfydbgASavazaYcdtfydbgoSGgHEh8Fdna8EJbbbb9ETmbaLaE:vhLaCaE:vhCawaE:vhwkaOavc8S2fgvavIdbawa8FaE:rNgEawNNg8FMUdbavaCaEaCNgaNghavIdlMUdlavaLaEaLNg8ENggavIdwMUdwavawaaNgaavIdxMUdxava8EawNg8JavIdzMUdzavaCa8ENg8EavIdCMUdCavawaEaLa5Nawa3Na8AaCNMM:mg8ANg3NgwavIdKMUdKavaCa3NgCavId3MUd3avaLa3NgLavIdaMUdaava3a8ANg3avId8KMUd8KavaEavIdyMUdydnaHmbaOaAc8S2fgva8FavIdbMUdbavahavIdlMUdlavagavIdwMUdwavaaavIdxMUdxava8JavIdzMUdzava8EavIdCMUdCavawavIdKMUdKavaCavId3MUd3avaLavIdaMUdaava3avId8KMUd8KavaEavIdyMUdyaOaoc8S2fgva8FavIdbMUdbavahavIdlMUdlavagavIdwMUdwavaaavIdxMUdxava8JavIdzMUdzava8EavIdCMUdCavawavIdKMUdKavaCavId3MUd3avaLavIdaMUdaava3avId8KMUd8KavaEavIdyMUdykaicxfhiarcifgrad6mbkkcbhAaqcuaXcdtgvaXcFFFFi0Egicbyd;y:L:cjbHjjjjbbgHBdaaqcoBd2aqaicbyd;y:L:cjbHjjjjbbgiBd8KaqcrBd2aHcFeavz:xjjjbhPdnalTmbazhHinJbbbbJbbjZaOaHydbgrc8S2fgvIdygw:vawJbbbb9BEavIdwaxcwfIdbgwNavIdzaxIdbgCNavIdaMgLaLMMawNavIdlaxclfIdbgLNavIdCawNavId3MgwawMMaLNavIdbaCNavIdxaLNavIdKMgwawMMaCNavId8KMMM:lNhwdndnaParcdtgvfgrydbcuSmbaiavfIdbaw9ETmekaraABdbaiavfawUdbkaHclfhHaxcxfhxalaAcefgA9hmbkkdndnaXmbJbbbbhwxekJbbbbhwinaiIdbgCawawaC9DEhwaiclfhiaXcufgXmbkaw:rhwkakcd4akfhOcehiinaigvcethiavaO6mbkcbhOaqcuavcdtgiavcFFFFi0Ecbyd;y:L:cjbHjjjjbbgHBdyaHcFeaiz:xjjjbhXdnadTmbavcufhrcbhkcbhxindnazaeaxcdtfgvydbcdtfydbgiazavclfydbcdtfydbgOSmbaiazavcwfydbcdtfydbgvSmbaOavSmbaPavcdtfydbhAdndnaPaOcdtfydbgvaPaicdtfydbgi9pmbavaA9pmbaAhlaihoavhAxekdnaAai9pmbaAav9pmbaihlavhoxekavhlaAhoaihAkabakcx2fgvaABdbavcwfaoBdbavclfalBdbdnaXaoc:3F;N8N2alc:F:b:DD27aAc;D;O:B8J27arGgOcdtfgvydbgicuSmbcehHinaHhvdnabaicx2fgiydbaA9hmbaiydlal9hmbaiydwaoSmikavcefhHaXaOavfarGgOcdtfgvydbgicu9hmbkkavakBdbakcefhkkaxcifgxad6mbkakci2hOkcwhvaDTmekaDawUdbkavcdthvaqcxfc98fhiinaiavfydbcbyd;C:L:cjbH:bjjjbbavc98fgvmbkaqc;Wbf8KjjjjbaOk:0iewuabcFeaecdtz:xjjjbhbdnalmbcbskaecufhvdndnaiTmbcbhocbhrindndndnabaiarcdtgwfydbgDcm4aD7c:v;t;h;Ev2gecs4ae7avGgqcdtfgkydbgxcuSmbceheinaiaxcdtgxfydbaDSmdaqaefhxaecefheabaxavGgqcdtfgkydbgxcu9hmbkkakarBdbaoheaocefhoxekadaxfydbhekadawfaeBdbarcefgral9hmbxdkkcbhocbhDindnabaDcm4aD7c:v;t;h;Ev2gecs4ae7avGgqcdtfgkydbgxcuSmbaxaDSmbceheinabaqaefavGgqcdtfgkydbgxcuSmeaecefheaxaD9hmbkkdndnaxcu9hmbakaDBdbaoheaocefhoxekadaxcdtfydbhekadaDcdtfaeBdbaDcefgDal9hmbkkaok:3ldrue9:8Jjjjjbc;Wb9Rgr8Kjjjjbcbhwarcxfcbc;Kbz:xjjjb8AdnabaeSmbabaeadcdtz:wjjjb8AkarcualcdtalcFFFFi0EgDcbyd;y:L:cjbHjjjjbbgqBdxarceBd2aqcbaialavcbarcxfz:djjjbcualcx2alc;v:Q;v:Qe0Ecbyd;y:L:cjbHjjjjbbhkarcxfaryd2gxcdtfakBdbaraxcefgmBd2akaialavcbcbz:ejjjb8AarcxfamcdtfaDcbyd;y:L:cjbHjjjjbbgiBdbaraxcdfgvBd2arcxfavcdtfcuaialaeadaqz:fjjjbgecltaecjjjjiGEcbyd;y:L:cjbHjjjjbbgqBdbaqaeaiakalz:gjjjbaxcifhkdnadTmbaoaoNhocbhwabhlcbheindnaqaialydbgvcdtfydbcdtfIdbao9ETmbalclf8PdbhPabawcdtfgDavBdbaDclfaP83dbawcifhwkalcxfhlaecifgead6mbkkdnakTmbaxcdtarcxffcwfhlinalydbcbyd;C:L:cjbH:bjjjbbalc98fhlakcufgkmbkkarc;Wbf8Kjjjjbawk;lOoDud99oue99vuv998Jjjjjbc;Wb9Rgw8KjjjjbdndnarmbcbhDxekawcxfcbc;Kbz:xjjjb8Aawcuadcx2adc;v:Q;v:Qe0Ecbyd;y:L:cjbHjjjjbbgqBdxawceBd2aqaeadaicbcbz:ejjjb8AawcuadcdtadcFFFFi0Egkcbyd;y:L:cjbHjjjjbbgxBdzawcdBd2adcd4adfhecehiinaigmcethiamae6mbkcbhPawcuamcdtgsamcFFFFi0Ecbyd;y:L:cjbHjjjjbbgzBdCawciBd2dndnar:ZgH:rJbbbZMgO:lJbbb9p9DTmbaO:Ohixekcjjjj94hikamcufhAc:bwhCcbhXadhQcbhLinaiaCcufgeaiae9iEaPcefaiaP9kEhDdndnadTmbaDcuf:YhOaqhiaxheadhKindndnaiIdbaONJbbbZMgY:lJbbb9p9DTmbaY:Oh8Axekcjjjj94h8Aka8AcCth8AdndnaiclfIdbaONJbbbZMgY:lJbbb9p9DTmbaY:OhExekcjjjj94hEkaEcqta8AVh8AdndnaicwfIdbaONJbbbZMgY:lJbbb9p9DTmbaY:OhExekcjjjj94hEkaea8AaEVBdbaicxfhiaeclfheaKcufgKmbkazcFeasz:xjjjbh3cbh5cbh8Eindna3axa8Ecdtfydbg8Acm4a8A7c:v;t;h;Ev2gics4ai7aAGgKcdtfgEydbgecuSmbaea8ASmbcehiina3aKaifaAGgKcdtfgEydbgecuSmeaicefhiaea8A9hmbkkaEa8ABdba5aecuSfh5a8Ecefg8Ead9hmbxdkkazcFeasz:xjjjb8Acbh5kdnaQ:ZgYaH:taD:YgOaC:Y:tg8FNaX:Zgaa5:Zgh:tNaaaH:taOaP:Y:tggNahaY:tNMg8JJbbbb9BmbaYaa:taga8FahaH:tNNNa8J:vaOMhOkaPaDa5ar0geEhPaXa5aeEhXdna5arSmbaDaCaeEgCaP9Rcd9imbdndnaLcl0mbdnaOJbbbZMgO:lJbbb9p9DTmbaO:Ohixdkcjjjj94hixekaPaCfcd9Thika5aQaeEhQaLcefgLcs9hmekkdndnaXmbcihicbhDxekawakcbyd;y:L:cjbHjjjjbbg8ABdKawclBd2aPcuf:YhYdnadTmbaqhiaxheadhKindndnaiIdbaYNJbbbZMgO:lJbbb9p9DTmbaO:OhExekcjjjj94hEkaEcCthEdndnaiclfIdbaYNJbbbZMgO:lJbbb9p9DTmbaO:Oh3xekcjjjj94h3ka3cqtaEVhEdndnaicwfIdbaYNJbbbZMgO:lJbbb9p9DTmbaO:Oh3xekcjjjj94h3kaeaEa3VBdbaicxfhiaeclfheaKcufgKmbkkawcuazama8Aaxadz:mjjjbgDc32giaDc;j:KM;jb0Ecbyd;y:L:cjbHjjjjbbgeBd3awcvBd2aecbaiz:xjjjbh3avcd4hxdnadTmbdnalTmbaxcdth8Ea8AhEaqhealhKadhAina3aEydbc32fgiaeIdbaiIdbMUdbaiaeclfIdbaiIdlMUdlaiaecwfIdbaiIdwMUdwaiaKIdbaiIdxMUdxaiaKclfIdbaiIdzMUdzaiaKcwfIdbaiIdCMUdCaiaiIdKJbbjZMUdKaEclfhEaecxfheaKa8EfhKaAcufgAmbxdkka8AhKaqheadhEina3aKydbc32fgiaeIdbaiIdbMUdbaiaeclfIdbaiIdlMUdlaiaecwfIdbaiIdwMUdwaiaiIdxJbbbbMUdxaiaiIdzJbbbbMUdzaiaiIdCJbbbbMUdCaiaiIdKJbbjZMUdKaKclfhKaecxfheaEcufgEmbkkdnaDTmba3hiaDheinaiaiIdbJbbbbJbbjZaicKfIdbgO:vaOJbbbb9BEgONUdbaiclfgKaOaKIdbNUdbaicwfgKaOaKIdbNUdbaicxfgKaOaKIdbNUdbaiczfgKaOaKIdbNUdbaicCfgKaOaKIdbNUdbaic3fhiaecufgembkkcbhEawcuaDcdtgCaDcFFFFi0Egicbyd;y:L:cjbHjjjjbbgeBdaawcoBd2awaicbyd;y:L:cjbHjjjjbbg8EBd8KaecFeaCz:xjjjbh5dnadTmbaoJbbjZJbbjZaY:vaPceSENgOaONhYaxcdthxalheinaYaecN:H:cjbalEgKIdwa3a8AydbgAc32fgiIdC:tgOaONaKIdbaiIdx:tgOaONaKIdlaiIdz:tgOaONMMNaqcwfIdbaiIdw:tgOaONaqIdbaiIdb:tgOaONaqclfIdbaiIdl:tgOaONMMMhOdndna5aAcdtgifgKydbcuSmba8EaifIdbaO9ETmekaKaEBdba8EaifaOUdbka8Aclfh8AaqcxfhqaeaxfheadaEcefgE9hmbkkaba5aCz:wjjjb8Acrhikaicdthiawcxfc98fheinaeaifydbcbyd;C:L:cjbH:bjjjbbaic98fgimbkkawc;Wbf8KjjjjbaDk:Pdidui99ducbhi8Jjjjjbca9Rglcbyd1:G:cjbBdKalcb8Pdj:G:cjb83izalcbydN:G:cjbBdwalcb8Pd:m:G:cjb83ibdndnaembJbbjFhvJbbjFhoJbbjFhrxekadcd4cdthwincbhdinalczfadfgDabadfIdbgvaDIdbgoaoav9EEUdbaladfgDavaDIdbgoaoav9DEUdbadclfgdcx9hmbkabawfhbaicefgiae9hmbkalIdwalIdK:thralIdlalIdC:thoalIdbalIdz:thvkJbbbbavavJbbbb9DEgvaoaoav9DEgvararav9DEk:H8Modui99lud99Aus998Jjjjjbcji9RgD8KjjjjbcbhqaDcxfcbc;Kbz:xjjjb8AaDcbBdwaD9cb83ibaDcbyd;i:L:cjbBd1eaDcb8Pd;a:L:cjb83ijeaDcbyd;u:L:cjbBd94aDcb8Pd;m:L:cjb83i9WdndnavmbJbbjFhkJbbjFhxJbbjFhmxekaocd4cdthPalhsincbhzinaDcjefazfgHasazfIdbgkaHIdbgxaxak9EEUdbaDc;WbfazfgHakaHIdbgxaxak9DEUdbazclfgzcx9hmbkasaPfhsaqcefgqav9hmbkaDId94aDId1e:thmaDIdtaDId:ee:thxaDId9WaDIdje:thkkJbbbbhOdnar:YgAJq;x8J88MaA:vJbbbbakakJbbbb9DEgkaxaxak9DEgkamamak9DENgxJbbbb9Bmbarc9:f:Yax:vhOkaDcCfhCaDcxfcxfhXcbhzinaDazfaDcjefazfIdbgkaxaDc;WbfazfIdbak:t:tJbbb:;NMUdbazclfgzcx9hmbkcbhQaDarar2gLar2gzcbyd;y:L:cjbHjjjjbbgHBdxaDceBd2aHcbazz:xjjjbgKcbcbadaialaoaraOaDawz:rjjjbcdhYaDcuaLcdtaLcFFFFi0Eg8Acbyd;y:L:cjbHjjjjbbgEBdzaDcdBd2aDcjefcbarz:xjjjb8Acbh3dnaLTmbdnarcb9kmbaKhzaEhHaLhsincbh3aHcbcuazaDcjefarz:AjjjbEBdbazarfhzaHclfhHascufgsmbxdkkaKhPcbh3cbhvindndnaKavar2faDcjefarz:AjjjbTmbcbhHaPhzarhsinazaHazRbbgqfgHcbaqE86bbazcefhzascufgsmbkaEavcdtfa3BdbaHa3fh3xekaEavcdtfcuBdbkaParfhPavcefgvaL9hmbkkdnabTmbaDcua3cotgza3cFFF8F0Ecbyd;y:L:cjbHjjjjbbgQBdCcihYaDciBd2aQcbazz:xjjjb8AaXhCkdnawceGmbaCa8Acbyd;y:L:cjbHjjjjbbg5BdbaDaYcefgzBd2aDcxfazcdtfaLcbyd;y:L:cjbHjjjjbbgzBdbaDaYcdfgYBd2azcbaLz:xjjjbh8EarcufhXdnarci9imbarc9:fhCararcef2aKfcefh8Aceh8Fina8Far2hPa8AhvcehqindnaEaqaPfcdtfydbcuSmbavhzaChHinazazRbbgscuasE86bbazcefhzaHcufgHmbkkavarfhvaqcefgqaX9hmbka8AaLfh8Aa8Fcefg8FaX9hmbkkarce9imbcbh8Acbhqcbhvina8EaqfhscbhzindnasazfgHRbbmbaHce86bba5a8AcdtfaqazfBdba8Acefh8Akarazcefgz9hmbkaqarfhqavcefgvar9hmbka8ATmbaKcefhaaKc9:fhharc9:fhgarci9ih8Jina8Ea5a8Acufg8Acdtfydbgvfcb86bbavar2hPdna8JmbaEavcdtfydbcuSmbaKaPfhHaghqindnaHcefgzRbbgscFe9hmbaHRbbmbcbhskazas86bbazhHaqcufgqmbkaharavcef2fhzaXhsindnazRbbgHcFe9hmbazcefRbbmbcbhHkazaH86bbazcufhzascufgsce9kmbkkaaaPfh8Kavavar9Ug8Lar29Rh8FcbhCindnaCceScuaCEa8Ffgzce9imbazaX9ombcuaCciSaCcdSEa8LfgHce9imbaHaX9ombaEaHar2azfg8McdtfydbcuSmba8Jmbaaa8Mar2fhzcbhqa8KhsaghvinazazRbbgHcbaHaHcFeSEasRbbEgP86bbascefhsazcefhzaPaH7aqVhqavcufgvmbkaqcFeGTmba8Ea8MfgzRbbmbazce86bba5a8Acdtfa8MBdba8Acefh8AkaCcefgCcl9hmbka8AmbkkdnaQTmbaKaEaQadaialaoaraOaDawz:rjjjba3TmbJbbjZaO:vhkawcjjjjlGhPdnawcdGTmbJbbnnaOaON:vh8NakJbbbZNhyaQhzinazczfgsIdbg8PazcCfIdbgx:vhmazcxfgqIdbgIax:vhAazcwfgvIdbg8Rax:vh8SakazydbgHcFrG:ZNhRakaHcq4cFrG:ZNh8UakaHcC4cFrG:ZNh8VdnaxJ:p;c;188Ng8WazcKfIdbMg8X:laxJ:983:g81Ngx9ETmba8Wazc3fIdbMazc8KfIdbg8Ya8Ya8X:vg8YN:tg8Z:lax9ETmba8WazcafIdbMazcyfIdbg8Wa8Wa8X:vg80N:tazc8SfIdba8Wa8YN:tg8Wa8Wa8Z:vg8WN:tg81:lax9ETmba8PJ:p;c;188NazcUfIdb:ta80a8RJ:p;c;188Nazc8WfIdb:tg8PN:ta8WaIJ:p;c;188Nazc80fIdb:ta8Ya8PN:tgIN:ta81:vgxam:tg8Ra8RNa8Pa8X:va8YaIa8Z:va8WaxN:tg8XN:ta80axN:tg8Wa8S:tg8Ya8YNa8XaA:tg8Ya8YNMMa8N9DTmbaxaRaxaR9EEgxakaRMgmaxam9DEhma8Xa8Ua8Xa8U9EEgxaka8UMgAaxaA9DEhAa8Wa8Va8Wa8V9EEgxaka8VMg8Saxa8S9DEh8SkdnaPTmbayaRMhmaya8UMhAaya8VMh8SkasamUdbaqaAUdbava8SUdbazc;abfhza3cufg3mbxdkkdnaPTmbakJbbbZNhxaQhzinazczfaxakazydbgHcFrG:ZNMUdbazcxfaxakaHcq4cFrG:ZNMUdbazcwfaxakaHcC4cFrG:ZNMUdbazc;abfhza3cufg3mbxdkkaQcCfhzinazc98fgHaHIdbazIdbgk:vUdbazc94fgHaHIdbak:vUdbazctfgHaHIdbak:vUdbazc;abfhza3cufg3mbkkcbhsdndnarcd9imbarcufh3aEarcdtfhadnabmbaKcefg8Mararcefgz2fh8JaKazfhba8MaLfh8Ecbhscbh8Kina8Kar2h8La8Mheabh8Aa8Eh8Fa8Jh5cbhXindnaEaXa8LfgqcdtgzfgHclfydbaHydbGaaazfgzydbGazclfydbGcuSmbclcbaKaqar2fgzarfRbbEazRbbcb9hVczcbazaLfgzRbbEVc;abcbazarfRbbEVhPaehza8AhHa8Fhqa5hva3hQindnaPclcbaHRbbEazRbbcb9hVczcbaqRbbEVc;abcbavRbbEVgPcetVgCTmbaCcFeSmbasaCRb;W;p:cjbfhskazcefhzaHcefhHaqcefhqavcefhvaQcufgQmbkkaearfhea8Aarfh8Aa8Farfh8Fa5arfh5aXcefgXa39hmbka8MaLfh8MabaLfhba8EaLfh8Ea8JaLfh8Ja8Kcefg8Ka39hmbxdkkJbbjZaO:vgkakJk;x8J88NNh8RawcdGh8EaDIdwhkaDIdlhxaDIdbhmcbhscbhPinaPar2h8KcbhvindnaEava8KfgqcdtgzfgHclfydbaHydbGaaazfgzydbGazclfydbGcuSmbcbh8AclcbaKaqar2fgYarfRbbEaYRbbcb9hVczcbaYaLfg8JRbbEVc;abcba8JarfRbbEVh8Lindna8LclcbaYa8Ag8Mcefg8AfgzarfRbbEazRbbcb9hVczcba8Ja8AfgzRbbEVc;abcbazarfRbbEVg8LcetVgCTmbaCcFeSmbcbhqdndndnaCRb;W;n:cjbcufPdebdka8ETmeaCcC2gz8Ve;W:L:cjbcltaz8Ve;Y:L:cjbcsGVh8FaKa8Mfh5cxhzaDcjefhHinaHaQaEa8Faz4gqce4ceGavfaqcd4ceGaPfar2fgXcdtfydbcotfa5aqceGfaXar2fRbbcotfcnfBdbaHclfhHazc98fgzc989hmbkaDydjegzIdyaDyd:megHIdyMaDyd:eegqIdyaDyd1egXIdyMMg8XaqIdwaXIdwMJbbbZNgANazIdUaHIdUMaqIdUaXIdUMMg8WMg8Sa8SMazIdaaHIdaMaqIdaaXIdaMMg8YaqIdzaXIdzMJbbbZNg8SNMa8SNazId8SaHId8SMaqId8SaXId8SMMgRa8SNazId80aHId80MaqId80aXId80MMg8UMg8Sa8SMazId3aHId3MaqId3aXId3MMg8VaqIdxaXIdxMJbbbZNg8SNMa8SNazId8KaHId8KMaqId8KaXId8KMMg8Za8SNazId8WaHId8WMaqId8WaXId8WMMg80Mg8Sa8SMazIdKaHIdKMaqIdKaXIdKMMgyaANMaANazId88aHId88MaqId88aXId88MMg8PMMM:lgIa8RazIdCaHIdCMaqIdCaXIdCMMN9Ea8XazIdwaHIdwMJbbbZNgANa8WMg8Sa8SMa8YazIdzaHIdzMJbbbZNg8SNMa8SNaRa8SNa8UMg8Sa8SMa8VazIdxaHIdxMJbbbZNg8SNMa8SNa8Za8SNa80Mg8Sa8SMayaANMaANa8PMMM:laIJ;d;1UZN9DGhqxekaKa8Mfh8FcbhzcrhHindnaCaz4ceGTmba8FazceGfazce4ceGavfazcd4aPfar2fgqar2fRbbgXcFeSmbaQaEaqcdtfydbcotfaXcotfc9efRbbaH4ceGTmbcbhqxdkaHcufhHcehqazcefgzcw9hmbkkaCcC2aqcq2fgH8Ve;W:L:cjbgzTmbaHc;Y:L:cjbfhqaKa8MfhCabasc8K2fhHindnasae9pmbaHaQaEazcD4ceGavfazcq4ceGaPfar2fgXcdtfydbcotfaCazcw4ceGfaXar2fRbbcotfgXc9ifIdbamMUdbaHclfaXc9mfIdbaxMUdbaHcwfaXc9qfIdbakMUdbaHcxfamaQaEazcv4ceGavfazco4ceGaPfar2fgXcdtfydbcotfaCazcl4ceGfaXar2fRbbcotfgXc9ifIdbMUdbaHczfaxaXc9mfIdbMUdbaHcCfakaXc9qfIdbMUdbaHcKfamaQaEazce4ceGavfazcd4ceGaPfar2fgXcdtfydbcotfaCazceGfaXar2fRbbcotfgzc9ifIdbMUdbaHc3faxazc9mfIdbMUdbaHcafakazc9qfIdbMUdbkaHc8KfhHascefhsaq8Vebhzaqcdfhqazmbkka8Aa39hmbkkavcefgva39hmbkaPcefgPa39hmbkaDyd2gYTmekaYcdtaDcxffc98fhzinazydbcbyd;C:L:cjbH:bjjjbbazc98fhzaYcufgYmbkkaDcjif8Kjjjjbask;Kxmiue99due99euz99eui99eud99dud99oudnalTmbaocd4hkaqcdGhxarc99fhqarcethmawawMhPcbhsindndnawavaiascdtfgoclfydbak2cdtfgzIdwgHavaoydbak2cdtfgOIdwgA:tgCaCNazIdbgXaOIdbgQ:tgLaLNazIdlgKaOIdlgY:tg8Aa8ANMMgEavaocwfydbak2cdtfgoIdwg3aA:tg5a5NaoIdbg8EaQ:tg8Fa8FNaoIdlgaaY:tghahNMMggaEag9EEgEa3aH:tgHaHNa8EaX:tgHaHNaaaK:tgHaHNMMgHaEaH9EE:rNgHaHMgH:lJbbb9p9DTmbaH:Ohoxekcjjjj94hokdnaLahNa8Aa8FN:tgHaHNa8Aa5NaCahN:tgXaXNaCa8FNaLa5N:tgKaKNMMg3Jbbbb9BmbJbbjZhEdnaoceaoce9kEgoamaoam9iEg8Jcd9imbJbbjZa8J:Z:vhEkarcb9imbaAaDIdw:th8KaYaDIdl:th8LaQaDIdb:th8Ma8Jcba8Jcb9kEh8NdnadTmbaHJbbjZa3:rgA:vgQNg3aAa8Jcefa8Jcdf2:Y:vgANh8EaKaQNgKaANhyaXaQNgXaXaANNh8PcbhIina8Jcba8Jcb9kEcefh8RaEaI:ZNgQaCNa8KMhgaQa8ANa8LMh8SaQaLNa8MMhRcbhzindndnaPaEaz:ZNgQahNa8SMgYNgH:lJbbb9p9DTmbaH:OhOxekcjjjj94hOkaOce91goaqaoaq6Eh8UdndnaPaQa5NagMgHNga:lJbbb9p9DTmbaa:Oh8Vxekcjjjj94h8Vka8Ua8Vce91goaqaoaq6Eg8Wcefar2fcefgoar2h8XdndnaPaQa8FNaRMgQNga:lJbbb9p9DTmbaa:Oh8Yxekcjjjj94h8Ykadaeaocdtfydbcotfaba8Yce91goaqaoaq6Eg8Zfa8XfcefRbbcotfgocnfa8Ucqta8ZcCtVa8WVBdbaoc9efg8Ua8URbbcea8YceGaOcetcdGVa8VcdtclGVtV86bbaoc9ifgOaQaANaOIdbMUdbaoc9mfgOaYaANaOIdbMUdbaoc9qfgOaHaANaOIdbMUdbaoc9ufgOaAaOIdbMUdbdnaxTmbaoc9yfgOa8PaOIdbMUdbaoc9CfgOaKayNaOIdbMUdbaoc9GfgOa3a8ENaOIdbMUdbaoc9KfgOaXayNaOIdbMUdbaoc9OfgOaXa8ENaOIdbMUdbaoc2fgOaKa8ENaOIdbMUdbaoc9WfgOaXaAa3aHNaXaQNaKaYNMMgY:mNgQNaOIdbMUdbaoctfgOaKaQNaOIdbMUdbaoc94fgOa3aQNaOIdbMUdbaoc98fgoaoIdbaYaQN:tUdbka8Razcefgz9hmbka8Jcufh8JaIa8NShoaIcefhIaoTmbxdkkcbh8Vina8Jcba8Jcb9kEcefh8UaEa8V:ZNgAaCNa8KMhYaAa8ANa8LMhHaAaLNa8MMhXcbhoindndnaPaEao:ZNgAahNaHMNgQ:lJbbb9p9DTmbaQ:Ohzxekcjjjj94hzkazce91gzaqazaq6EhzdndnaPaAa5NaYMNgQ:lJbbb9p9DTmbaQ:OhOxekcjjjj94hOkazaOce91gOaqaOaq6Ecefar2fcefar2hzdndnaPaAa8FNaXMNgA:lJbbb9p9DTmbaA:OhOxekcjjjj94hOkabaOce91gOaqaOaq6Efazfcefce86bba8Uaocefgo9hmbka8Jcufh8Ja8Va8NShoa8Vcefh8VaoTmbkkascifgsal6mbkkk:Nvezu8Jjjjjbcjd9Rgb8Kjjjjbcbheabcbcjdz:xjjjbhdc:W:H:cjbhbinabRbbgicC2glabcqf8Veb87e;4:L:cjbalabcdfgv8Peb83e;W:L:cjbaiabcefRbb86b;W;n:cjbadaifce86bbalavabcxfceaetc:F:d;avGEgi8Peb83e;6:L:cjbalai8Vew87e:c:M:cjbabcQfhbaecefgecK9hmbkcbhoinc;Y:L:cjbhrcbhvindnadavfgwRbbce9hmbavcC2c;W:L:cjbfhDcbhbcehqavc;W;n:cjbfhkinabcitc:G:H:cjbfhlcbhbcbheinaeavab4ceGalabfRbbtVheabcefgbcw9hmbkdnadaecFeGgxfgmRbbmbaxcC2c;W:L:cjbfhPcbhbcehsindnaDabcq2gif8VebgbTmbaraifheaPaifhiinaialabcl4csGfRbbcltalabcw4csGfRbbcwtValabcsGfRbbV87ebaicdfhiae8VebhbaecdfheabmbkkcehbasceGhecbhsaembkamce86bbaxakRbb86b;W;n:cjbkcehbaqceGhlcbhqalmbkawcd86bbkarcCfhravcefgvcjd9hmbkaocefgoci9hmbkcbhic;W:L:cjbhvincuhlavhbinalcefhlab8Vebheabcdfhbaembkaial86b;W;p:cjbavcCfhvaicefgicjd9hmbkadcjdf8Kjjjjbk9DeeuabcFeaicdtz:xjjjbhlcbhbdnadTmbindnalaeydbcdtfgiydbcu9hmbaiabBdbabcefhbkaeclfheadcufgdmbkkabk;Bidqui998Jjjjjbc;Wb9Rgl8Kjjjjbalcxfcbc;Kbz:xjjjb8Aadcd4adfhvcehoinaogrcethoarav6mbkalcuarcdtgoarcFFFFi0Ecbyd;y:L:cjbHjjjjbbgvBdxavcFeaoz:xjjjbhwdnadTmbaicd4hDarcufhqcbhkindndnawcbaeakaD2cdtfgrydlgiaicjjjj94SEgocH4ao7c:F:b:DD2cbarydbgxaxcjjjj94SEgocH4ao7c;D;O:B8J27cbarydwgmamcjjjj94SEgrcH4ar7c:3F;N8N27aqGgvcdtfgrydbgocuSmbam::hPai::hsax::hzcehiinaihrdnaeaoaD2cdtfgiIdbaz9CmbaiIdlas9CmbaiIdwaP9BmikarcefhiawavarfaqGgvcdtfgrydbgocu9hmbkkarakBdbakhokabakcdtfaoBdbakcefgkad9hmbkkalydxcbyd;C:L:cjbH:bjjjbbalc;Wbf8Kjjjjbk9teiucbcbyd;G:L:cjbgeabcifc98GfgbBd;G:L:cjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaik;LeeeudndnaeabVciGTmbabhixekdndnadcz9pmbabhixekabhiinaiaeydbBdbaiclfaeclfydbBdbaicwfaecwfydbBdbaicxfaecxfydbBdbaeczfheaiczfhiadc9Wfgdcs0mbkkadcl6mbinaiaeydbBdbaeclfheaiclfhiadc98fgdci0mbkkdnadTmbinaiaeRbb86bbaicefhiaecefheadcufgdmbkkabk;aeedudndnabciGTmbabhixekaecFeGc:b:c:ew2hldndnadcz9pmbabhixekabhiinaialBdbaicxfalBdbaicwfalBdbaiclfalBdbaiczfhiadc9Wfgdcs0mbkkadcl6mbinaialBdbaiclfhiadc98fgdci0mbkkdnadTmbinaiae86bbaicefhiadcufgdmbkkabk9teiucbcbyd;G:L:cjbgeabcrfc94GfgbBd;G:L:cjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaikTeeucbabcbyd;G:L:cjbge9Rcifc98GaefgbBd;G:L:cjbdnabZbcztge9nmbabae9RcFFifcz4nb8Akk6eiucbhidnadTmbdninabRbbglaeRbbgv9hmeaecefheabcefhbadcufgdmbxdkkalav9Rhikaikk;0vdbcj:Gdk;yvFFuuFFuuFFuuFFuFFFuFFFuFbbbbbbbbebbbdbbbbbbbebbbebbbdbbbbbbbbbbbeeeeeebebbeebbebbebbbeeebbbbebbbbbbbbbbbbbbbbbbbeeeeeeebebbbeeebbeebbbbbebbbbbebebbbbbbbbbbbbbbbdiorbelvlbodveribbbbbbbbbbbbbbbbbbbbbbebbbbbbbbbbbbbbbbbbbbbibbbbbbbbbbbbbbbbbbbbbobbbbbbbbbbbbbbbbbbbbbrbaebbbbbbbbbbbbbbbbbbsd8We8YbbbbbbbhiaebbbbbbQe8Ke9cebbbbbbbbbbbbbbbbLb8KebbbbbbbbbbbbbbbbbbKbbbbbbbbbbbbbbbbbbbbbYeJbilbbbbbbbbbbbbbbbbEe80e8WlbbbbbbzlAbbbbbbb5eJdnibbbbbbai8Kbbbbbbb8Ee9ce8Ylcibbbb8Yebbbbbbbb8FdOlAdbbbbbb80e8Ylbbbbbb88eTi8KiJv8Jlbbbbbbbbbbbb89e9td8Kv9qibbbbndlvaibbbbZd8Li8KvbbbbbbJdTibbbbbb9Pe81b9GvoiBvbbbbbbbbbbbb9Re9JbvoWibbbbvibbbbbbbb9VeWi9Gvbbbbbb8WvBbbbbbbb9:b9ceBvbbbbbbbbbbbbbbbbubWibbbbbbbbbbbbbbbbbb;Wd9hvSrbbbbbbWl9NvbbbbbbFbbbbbbbbbbbbbbbbbbbbbFFuuFFuuFFuuFFuFFFuFFFuFbc;y:Ldkxebbbdbbb;W:Obb`,t=new Uint8Array([32,0,65,2,1,106,34,33,3,128,11,4,13,64,6,253,10,7,15,116,127,5,8,12,40,16,19,54,20,9,27,255,113,17,42,67,24,23,146,148,18,14,22,45,70,69,56,114,101,21,25,63,75,136,108,28,118,29,73,115]);if(typeof WebAssembly!=`object`)return{supported:!1};var n,r=WebAssembly.instantiate(i(e),{}).then(function(e){n=e.instance,n.exports.__wasm_call_ctors()});function i(e){for(var n=new Uint8Array(e.length),r=0;r<e.length;++r){var i=e.charCodeAt(r);n[r]=i>96?i-97:i>64?i-39:i+4}for(var a=0,r=0;r<e.length;++r)n[a++]=n[r]<60?t[n[r]]:(n[r]-60)*64+n[++r];return n.buffer.slice(0,a)}function a(e){if(!e)throw Error(`Assertion failed`)}function o(e){return new Uint8Array(e.buffer,e.byteOffset,e.byteLength)}function s(e,t,r,i){var a=n.exports.sbrk,s=a(r*4),c=a(r*i*4),l=new Uint8Array(n.exports.memory.buffer);l.set(o(t),c),e(s,c,r,i*4),l=new Uint8Array(n.exports.memory.buffer);var u=new Uint32Array(r);return new Uint8Array(u.buffer).set(l.subarray(s,s+r*4)),a(s-a(0)),u}function c(e,t,r){var i=n.exports.sbrk,a=i(t.length*4),s=i(r*4),c=new Uint8Array(n.exports.memory.buffer),l=o(t);c.set(l,a);var u=e(s,a,t.length,r);c=new Uint8Array(n.exports.memory.buffer);var d=new Uint32Array(r);new Uint8Array(d.buffer).set(c.subarray(s,s+r*4)),i(a-i(0));for(var f=0;f<t.length;++f)t[f]=d[t[f]];return[d,u]}function l(e){for(var t=0,n=0;n<e.length;++n){var r=e[n];t=t<r?r:t}return t}function u(e,t,r,i,a,s,c,l,u){var d=n.exports.sbrk,f=d(4),p=d(r*4),m=d(a*s),h=d(r*4),g=new Uint8Array(n.exports.memory.buffer);g.set(o(i),m),g.set(o(t),h);var _=e(p,h,r,m,a,s,c,l,u,f);g=new Uint8Array(n.exports.memory.buffer);var v=new Uint32Array(_);o(v).set(g.subarray(p,p+_*4));var y=new Float32Array(1);return o(y).set(g.subarray(f,f+4)),d(f-d(0)),[v,y[0]]}function d(e,t,r,i,a,s,c,l,u,d,f,p,m){var h=n.exports.sbrk,g=h(4),_=h(r*4),v=h(a*s),y=h(a*l),b=h(u.length*4),x=h(r*4),S=d?h(a):0,C=new Uint8Array(n.exports.memory.buffer);C.set(o(i),v),C.set(o(c),y),C.set(o(u),b),C.set(o(t),x),d&&C.set(o(d),S);var w=e(_,x,r,v,a,s,y,l,b,u.length,S,f,p,m,g);C=new Uint8Array(n.exports.memory.buffer);var T=new Uint32Array(w);o(T).set(C.subarray(_,_+w*4));var E=new Float32Array(1);return o(E).set(C.subarray(g,g+4)),h(g-h(0)),[T,E[0]]}function f(e,t,r,i,a,s,c,l,u,d,f,p,m){var h=n.exports.sbrk,g=h(4),_=h(a*s),v=h(a*l),y=h(u.length*4),b=h(r*4),x=d?h(a):0,S=new Uint8Array(n.exports.memory.buffer);S.set(o(i),_),S.set(o(c),v),S.set(o(u),y),S.set(o(t),b),d&&S.set(o(d),x);var C=e(b,r,_,a,s,v,l,y,u.length,x,f,p,m,g);S=new Uint8Array(n.exports.memory.buffer),o(t).set(S.subarray(b,b+C*4)),o(i).set(S.subarray(_,_+a*s)),o(c).set(S.subarray(v,v+a*l));var w=new Float32Array(1);return o(w).set(S.subarray(g,g+4)),h(g-h(0)),[C,w[0]]}function p(e,t,r,i){var a=n.exports.sbrk,s=a(r*i);new Uint8Array(n.exports.memory.buffer).set(o(t),s);var c=e(s,r,i);return a(s-a(0)),c}function m(e,t,r,i,a,s,c,l){var u=n.exports.sbrk,d=u(l*4),f=u(r*i),p=a?u(r*s):0,m=new Uint8Array(n.exports.memory.buffer);m.set(o(t),f),a&&m.set(o(a),p);var h=e(d,f,r,i,p,s,c,l);m=new Uint8Array(n.exports.memory.buffer);var g=new Uint32Array(h);return o(g).set(m.subarray(d,d+h*4)),u(d-u(0)),g}function h(e,t,r,i,a,s,c,l,u){var d=n.exports.sbrk,f=d(4),p=d(r*4),m=d(a*s),h=d(r*4),g=c?d(a):0,_=new Uint8Array(n.exports.memory.buffer);_.set(o(i),m),_.set(o(t),h),c&&_.set(o(c),g);var v=e(p,h,r,m,a,s,g,l,u,f);_=new Uint8Array(n.exports.memory.buffer);var y=new Uint32Array(v);o(y).set(_.subarray(p,p+v*4));var b=new Float32Array(1);return o(b).set(_.subarray(f,f+4)),d(f-d(0)),[y,b[0]]}function g(e,t,r,i,a,s,c){var l=n.exports.sbrk,u=l(r*4),d=l(a*s),f=l(r*4),p=new Uint8Array(n.exports.memory.buffer);p.set(o(i),d),p.set(o(t),f);var m=e(u,f,r,d,a,s,c);p=new Uint8Array(n.exports.memory.buffer);var h=new Uint32Array(m);return o(h).set(p.subarray(u,u+m*4)),l(u-l(0)),h}function _(e,t,r,i,s,c){var l=n.exports.sbrk,u=l(r.byteLength),d=l(t.byteLength),f=new Uint8Array(n.exports.memory.buffer);f.set(o(r),u),f.set(o(t),d);var p=r.byteLength/i,m=e(0,0,d,t.length,u,p,i,s,c),h=l(m*9*4),g=e(h,m,d,t.length,u,p,i,s,c);a(g<=m),f=new Uint8Array(n.exports.memory.buffer);var _=new Float32Array(g*9);return o(_).set(f.subarray(h,h+_.byteLength)),l(u-l(0)),_}var v={LockBorder:1,Sparse:2,ErrorAbsolute:4,Prune:8,Regularize:16,Permissive:32,RegularizeLight:64,PreserveFolds:128,ErrorClamped:256,_InternalDebug:1<<30},y={Shell:1,Solve:2,Thicken:0,_InternalDebug:1<<30};return{ready:r,supported:!0,compactMesh:function(e){a(e instanceof Uint32Array||e instanceof Int32Array||e instanceof Uint16Array||e instanceof Int16Array),a(e.length%3==0);var t=e.BYTES_PER_ELEMENT==4?e:new Uint32Array(e),r=c(n.exports.meshopt_optimizeVertexFetchRemap,t,l(e)+1);if(e!==t)for(var i=0;i<t.length;++i)e[i]=t[i];return r},generatePositionRemap:function(e,t){return a(e instanceof Float32Array),a(e.length%t==0),a(t>=3),s(n.exports.meshopt_generatePositionRemap,e,e.length/t,t)},simplify:function(e,t,r,i,o,s){a(e instanceof Uint32Array||e instanceof Int32Array||e instanceof Uint16Array||e instanceof Int16Array),a(e.length%3==0),a(t instanceof Float32Array),a(t.length%r==0),a(r>=3),a(i>=0&&i<=e.length),a(i%3==0),a(o>=0);for(var c=0,l=0;l<(s?s.length:0);++l)a(s[l]in v),c|=v[s[l]];var d=e.BYTES_PER_ELEMENT==4?e:new Uint32Array(e),f=u(n.exports.meshopt_simplify,d,e.length,t,t.length/r,r*4,i,o,c);return f[0]=e instanceof Uint32Array?f[0]:new e.constructor(f[0]),f},simplifyWithAttributes:function(e,t,r,i,o,s,c,l,u,f){a(e instanceof Uint32Array||e instanceof Int32Array||e instanceof Uint16Array||e instanceof Int16Array),a(e.length%3==0),a(t instanceof Float32Array),a(t.length%r==0),a(r>=3),a(i instanceof Float32Array),a(i.length==o*(t.length/r)),a(o>=0),a(c==null||c instanceof Uint8Array),a(c==null||c.length==t.length/r),a(l>=0&&l<=e.length),a(l%3==0),a(u>=0),a(Array.isArray(s)),a(o>=s.length),a(s.length<=32);for(var p=0;p<s.length;++p)a(s[p]>=0);for(var m=0,p=0;p<(f?f.length:0);++p)a(f[p]in v),m|=v[f[p]];var h=e.BYTES_PER_ELEMENT==4?e:new Uint32Array(e),g=d(n.exports.meshopt_simplifyWithAttributes,h,e.length,t,t.length/r,r*4,i,o*4,new Float32Array(s),c,l,u,m);return g[0]=e instanceof Uint32Array?g[0]:new e.constructor(g[0]),g},simplifyWithUpdate:function(e,t,r,i,o,s,c,l,u,d){a(e instanceof Uint32Array||e instanceof Int32Array||e instanceof Uint16Array||e instanceof Int16Array),a(e.length%3==0),a(t instanceof Float32Array),a(t.length%r==0),a(r>=3),a(i instanceof Float32Array),a(i.length==o*(t.length/r)),a(o>=0),a(c==null||c instanceof Uint8Array),a(c==null||c.length==t.length/r),a(l>=0&&l<=e.length),a(l%3==0),a(u>=0),a(Array.isArray(s)),a(o>=s.length),a(s.length<=32);for(var p=0;p<s.length;++p)a(s[p]>=0);for(var m=0,p=0;p<(d?d.length:0);++p)a(d[p]in v),m|=v[d[p]];var h=e.BYTES_PER_ELEMENT==4?e:new Uint32Array(e),g=f(n.exports.meshopt_simplifyWithUpdate,h,e.length,t,t.length/r,r*4,i,o*4,new Float32Array(s),c,l,u,m);if(e!==h)for(var p=0;p<g[0];++p)e[p]=h[p];return g},getScale:function(e,t){return a(e instanceof Float32Array),a(e.length%t==0),a(t>=3),p(n.exports.meshopt_simplifyScale,e,e.length/t,t*4)},simplifyPoints:function(e,t,r,i,o,s){return a(e instanceof Float32Array),a(e.length%t==0),a(t>=3),a(r>=0&&r<=e.length/t),i?(a(i instanceof Float32Array),a(i.length%o==0),a(o>=3),a(e.length/t==i.length/o),m(n.exports.meshopt_simplifyPoints,e,e.length/t,t*4,i,o*4,s||0,r)):m(n.exports.meshopt_simplifyPoints,e,e.length/t,t*4,void 0,0,0,r)},simplifySloppy:function(e,t,r,i,o,s){a(e instanceof Uint32Array||e instanceof Int32Array||e instanceof Uint16Array||e instanceof Int16Array),a(e.length%3==0),a(t instanceof Float32Array),a(t.length%r==0),a(r>=3),a(i==null||i instanceof Uint8Array),a(i==null||i.length==t.length/r),a(o>=0&&o<=e.length),a(o%3==0),a(s>=0);var c=e.BYTES_PER_ELEMENT==4?e:new Uint32Array(e),l=h(n.exports.meshopt_simplifySloppy,c,e.length,t,t.length/r,r*4,i,o,s);return l[0]=e instanceof Uint32Array?l[0]:new e.constructor(l[0]),l},simplifyPrune:function(e,t,r,i){a(e instanceof Uint32Array||e instanceof Int32Array||e instanceof Uint16Array||e instanceof Int16Array),a(e.length%3==0),a(t instanceof Float32Array),a(t.length%r==0),a(r>=3),a(i>=0);var o=e.BYTES_PER_ELEMENT==4?e:new Uint32Array(e),s=g(n.exports.meshopt_simplifyPrune,o,e.length,t,t.length/r,r*4,i);return s=e instanceof Uint32Array?s:new e.constructor(s),s},remesh:function(e,t,r,i,o){a(e instanceof Uint32Array||e instanceof Int32Array||e instanceof Uint16Array||e instanceof Int16Array),a(e.length%3==0),a(t instanceof Float32Array),a(t.length%r==0),a(r>=3),a(i>=4&&i<=256);for(var s=0,c=0;c<(o?o.length:0);++c)a(o[c]in y),s|=y[o[c]];var l=e.BYTES_PER_ELEMENT==4?e:new Uint32Array(e);return _(n.exports.meshopt_remesh,l,t,r*4,i,s)}}})(),jn={shadow:{ratio:.2,errorM:.03,weld:!0},hull:{ratio:.5,errorM:.006,weld:!0},crowd:{ratio:.25,errorM:.012,weld:!1},crowdHard:{ratio:.1,errorM:.03,weld:!1},crowdAccentLockM:.035,body:{ratio:.4,errorM:.012,normalW:.5,uvW:60,lockBone:`head`,lockW:.5},ink:{ratio:.4,errorM:.008,weld:!0},minTris:600,minTrisInstanced:120,minTrisCrowd:96},Mn=!1,Nn=An.ready.then(()=>{Mn=!0},()=>{Mn=!1}),Pn=new WeakMap;function Fn(e){let t=e.getAttribute(`position`);if(!t||t.itemSize<3)return null;let n=t.count;if(!t.isInterleavedBufferAttribute&&t.array instanceof Float32Array&&t.itemSize===3)return t.array.subarray(0,n*3);let r=new Float32Array(n*3);for(let e=0;e<n;e++)r[e*3]=t.getX(e),r[e*3+1]=t.getY(e),r[e*3+2]=t.getZ(e);return r}function In(e,t,n=jn.minTris,r=1,i=null){if(!Mn)return null;let a=e.getAttribute(`position`);if(!a)return null;let o=e.index??a,s=Pn.get(o);if(s&&t in s)return s[t]??null;let c=s??{};if(Pn.set(o,c),c[t]=null,e.groups.length>1)return null;let l=jn[t],u=e.index?e.index.count:a.count;if(u/3<n||u%3!=0)return null;let d=Fn(e);if(!d)return null;let f;if(e.index)f=e.index.array instanceof Uint32Array?e.index.array:Uint32Array.from(e.index.array);else{f=new Uint32Array(u);for(let e=0;e<u;e++)f[e]=e}f.length!==u&&(f=f.subarray(0,u));try{if(l.weld){let e=An.generatePositionRemap(d,3),t=new Uint32Array(u);for(let n=0;n<u;n++)t[n]=e[f[n]];f=t}let e=An.getScale(d,3);if(!(e>0)||!(r>0))return null;let n=Math.max(3,Math.floor(u*l.ratio/3)*3),o=l.errorM/(r*e),[s]=i&&!l.weld&&i.length===a.count?An.simplifyWithAttributes(f,d,3,new Float32Array,0,[],i,n,o,[]):An.simplify(f,d,3,n,o,l.weld?[`Permissive`]:[]);if(!s.length||s.length>u*.85)return null;let p=a.count<65536?Uint16Array.from(s):s,m=new F(p,1);return m.name=`vale_lod_${t}`,c[t]=m,m}catch{return null}}var Ln={shadow:!0,outline:!1,body:!1},Rn=new WeakMap,zn=null;function Bn(e){return Rn.get(e)}function Vn(e,t,n,r,i,a,o){let s=Ln.shadow?Rn.get(i):void 0;s&&(zn={g:i,index:i.index},i.index=s)}function Hn(e,t,n,r,i,a,o){zn&&zn.g===i&&(i.index=zn.index,zn=null)}function Un(e){let t=t=>Object.prototype.hasOwnProperty.call(e,t)?e[t]:null,n=t(`onBeforeShadow`),r=t(`onAfterShadow`);e.onBeforeShadow=n?function(...e){n.apply(this,e),Vn(...e)}:Vn,e.onAfterShadow=r?function(...e){Hn(...e),r.apply(this,e)}:Hn}function Wn(e,t=jn.minTris,n=1){if(!Mn||Rn.has(e))return;let r=In(e,`shadow`,t,n);r&&Rn.set(e,r)}var Gn=new WeakSet;function Kn(e,t=1/0){if(!Mn)return;let n=performance.now();e.traverse(e=>{let r=e;if(!r.isMesh||!r.castShadow||Gn.has(r)||performance.now()-n>t)return;Gn.add(r);let i=r.geometry;if(i){if(!Rn.has(i)){let e=In(i,`shadow`,r.isInstancedMesh?jn.minTrisInstanced:i.isInstancedBufferGeometry?jn.minTrisCrowd:jn.minTris,r.userData.valeLodUnit??1);if(!e)return;Rn.set(i,e)}Un(r)}})}var qn=new M,Jn=new B;function Yn(e){let t=e.skeleton;return!t||!t.bones.length?1:(qn.copy(e.matrixWorld).invert().multiply(t.bones[0].matrixWorld).multiply(t.boneInverses[0]).multiply(e.bindMatrix),Jn.setFromMatrixColumn(qn,0).length())}function Xn(e){if(!Mn)return null;let t=jn.body,n=e.geometry,r=n.getAttribute(`position`),i=n.getAttribute(`normal`),a=n.getAttribute(`skinIndex`),o=n.getAttribute(`skinWeight`);if(!e.isSkinnedMesh||!n.index||!r||!i||!a||!o||n.groups.length>1)return null;let s=e.skeleton.bones.findIndex(e=>e.name===t.lockBone);if(s<0)return null;let c=r.count,l=new Float32Array(c*3),u=new Float32Array(c*3),d=new Uint8Array(c);for(let e=0;e<c;e++){l[e*3]=r.getX(e),l[e*3+1]=r.getY(e),l[e*3+2]=r.getZ(e),u[e*3]=i.getX(e),u[e*3+1]=i.getY(e),u[e*3+2]=i.getZ(e);let n=0;for(let t=0;t<4;t++)a.getComponent(e,t)===s&&(n+=o.getComponent(e,t));n>=t.lockW&&(d[e]=1)}let f=n.index.array instanceof Uint32Array?n.index.array:Uint32Array.from(n.index.array),p=f.length/3;try{let r=Yn(e),i=An.getScale(l,3);if(!(r>0)||!(i>0))return null;let a=Math.max(3,Math.floor(p*t.ratio)*3),o=t.normalW,s=t.uvW,m=s>0?n.getAttribute(`uv`):null,h=u,g=3,_=[o,o,o];if(m){h=new Float32Array(c*5),g=5,_=[o,o,o,s,s];for(let e=0;e<c;e++)h.set(u.subarray(e*3,e*3+3),e*5),h[e*5+3]=m.getX(e),h[e*5+4]=m.getY(e)}let[v]=An.simplifyWithAttributes(f,l,3,h,g,_,d,a,t.errorM/(r*i),[]);if(!v.length||v.length>=f.length)return null;let y=new F(c<65536?Uint16Array.from(v):v,1);return y.name=`vale_lod_body`,{index:y,tris:p,lodTris:v.length/3}}catch{return null}}function Zn(e,t,n){let r=new Ee;for(let[t,n]of Object.entries(e.attributes))r.setAttribute(t,n);for(let t of Object.keys(e.morphAttributes))r.morphAttributes[t]=e.morphAttributes[t];return r.morphTargetsRelative=e.morphTargetsRelative,r.setIndex(t),e.boundingSphere||e.computeBoundingSphere(),r.boundingSphere=e.boundingSphere,e.boundingBox&&(r.boundingBox=e.boundingBox),r.name=n,e.addEventListener(`dispose`,()=>r.dispose()),r}function Qn(e,t,n){let r=e.index;if(!r)return null;let i=0,a=!1;for(let e of t){let t=n(e.mesh);t&&(a=!0),i+=t?t.length:e.n}if(!a)return null;let o=e.getAttribute(`position`).count>65535?new Uint32Array(i):new Uint16Array(i),s=0;for(let e of t){let t=n(e.mesh);if(t)for(let n=0;n<t.length;n++)o[s++]=t[n]+e.vo;else for(let t=0;t<e.n;t++)o[s++]=r.getX(e.io+t)}let c=new F(o,1);return c.name=`vale_lod_composed`,c}var $n=/^form_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:[._]\d+)?$/i,er=0,tr=new M,nr=new M;function rr(e,t){let n=t.skeleton;if(n.bones.length!==e.bones.length)return null;let r=new M;for(let i=0;i<n.bones.length;i++){if(n.bones[i].name!==e.bones[i].name)return null;if(tr.copy(e.boneInverses[i]).invert().multiply(n.boneInverses[i]).multiply(t.bindMatrix),i===0){r.copy(tr);continue}for(let e=0;e<16;e++)if(Math.abs(tr.elements[e]-r.elements[e])>1e-4)return null}return r}var ir=new B;function ar(e,t,n){if(!t.length||!(n>0))return null;let r=[],i=[1/0,1/0,1/0],a=[-1/0,-1/0,-1/0];for(let e of t){let t=e.geometry.getAttribute(`position`)?.count??0;for(let n=0;n<t;n++)e.getVertexPosition(n,ir).applyMatrix4(e.matrixWorld),r.push(ir.x,ir.y,ir.z),i[0]=Math.min(i[0],ir.x),i[1]=Math.min(i[1],ir.y),i[2]=Math.min(i[2],ir.z),a[0]=Math.max(a[0],ir.x),a[1]=Math.max(a[1],ir.y),a[2]=Math.max(a[2],ir.z)}if(!r.length)return null;let o=n*ir.setFromMatrixColumn(e.matrixWorld,0).length(),s=o*o,c=e.geometry.getAttribute(`position`)?.count??0,l=new Uint8Array(c),u=!1;for(let t=0;t<c;t++){e.getVertexPosition(t,ir).applyMatrix4(e.matrixWorld);let n=ir.x,c=ir.y,d=ir.z;if(!(n<i[0]-o||n>a[0]+o||c<i[1]-o||c>a[1]+o||d<i[2]-o||d>a[2]+o))for(let e=0;e<r.length;e+=3){let i=r[e]-n,a=r[e+1]-c,o=r[e+2]-d;if(i*i+a*a+o*o<=s){l[t]=1,u=!0;break}}}return u?l:null}function or(e,t,n,r,i,a=!1){let s=[],c=t.size>0;if(e.traverse(e=>{$n.test(e.name)&&(c=!1);let t=e;t.isMesh&&(!t.isSkinnedMesh||Array.isArray(t.material)||!t.material.isMeshStandardMaterial?c=!1:s.push(t))}),!c||!s.length||n.some(e=>!e.skinned))return null;let l=s[0].skeleton,u=[];for(let e of s){let t=rr(l,e);if(!t)return null;u.push(t)}let d=s.map(e=>Yn(e)),f=s.filter(e=>e.material.name===r),p=s.map((e,t)=>e.material.name===r?null:In(e.geometry,`crowd`,jn.minTrisCrowd,d[t],ar(e,f,jn.crowdAccentLockM))),m=s.map((e,t)=>e.material.name===r?null:In(e.geometry,`crowdHard`,jn.minTrisCrowd,d[t],ar(e,f,jn.crowdAccentLockM))),h=Ae(e);h.scale.set(1,1,1),h.updateMatrixWorld(!0);let g=new M().copy(h.matrixWorld).invert(),_=[];h.traverse(e=>{e.isSkinnedMesh&&!_.length&&(_=e.skeleton.bones)});let v=[...new Set(t.values())],y=new Map,b=0;for(let e of v){let t=Math.max(1,Math.ceil(e.duration*60)+1);y.set(e,{row0:b,frames:t}),b+=t}let x=l.bones.length*3;if(b>i||x>i)return null;let S=new Float32Array(x*b*4),C=new Re(h);for(let e of v){C.stopAllAction();let t=C.clipAction(e);t.reset(),t.setLoop(ae,1),t.clampWhenFinished=!0,t.setEffectiveWeight(1),t.play();let{row0:n,frames:r}=y.get(e);for(let i=0;i<r;i++){t.time=Math.min(e.duration,i/60),C.update(0),h.updateMatrixWorld(!0);for(let e=0;e<_.length;e++){nr.multiplyMatrices(g,_[e].matrixWorld).multiply(l.boneInverses[e]);let t=nr.elements,r=((n+i)*x+e*3)*4;for(let e=0;e<3;e++)S[r+e*4]=t[e],S[r+e*4+1]=t[e+4],S[r+e*4+2]=t[e+8],S[r+e*4+3]=t[e+12]}}t.stop()}C.stopAllAction(),C.uncacheRoot(h);let T=new o(S,x,b,be,w);return T.minFilter=T.magFilter=Se,T.generateMipmaps=!1,T.needsUpdate=!0,{id:++er,texture:T,bones:l.bones.length,clips:y,parts:s.map((e,t)=>({geometry:e.geometry,material:e.material,bind:u[t],accent:e.material.name===r,lod:p[t],lodHard:m[t],unit:d[t]})),hull:n.map(e=>({geometry:e.geometry,bind:u[e.lead]??u[0],lod:e.members?Qn(e.geometry,e.members,e=>p[e]?.array??null):null,unit:d[e.lead]??1})),rootPos:e.position.clone(),rootQuat:e.quaternion.clone(),monster:a}}var sr=class{time=0;timeScale=1;enabled=!0;clampWhenFinished=!1;loop=ie;weight=0;fadeFrom=0;fadeTo=1;fadeT=0;fadeDur=0;active=!1;order=0;mixer;clip;row0;frames;constructor(e,t,n,r){this.mixer=e,this.clip=t,this.row0=n,this.frames=r}getClip(){return this.clip}setLoop(e,t){return this.loop=e,this}reset(){return this.time=0,this.enabled=!0,this.fadeDur=0,this}setEffectiveWeight(e){return this.weight=e,this.fadeDur=0,this}fadeIn(e){return this.fade(0,1,e)}fadeOut(e){return this.fade(1,0,e)}crossFadeFrom(e,t,n){return e.fadeOut(t),this.fadeIn(t)}play(){return this.mixer.activate(this),this}stop(){return this.active=!1,this.weight=0,this}fade(e,t,n){return n<=0?(this.weight=t,this.fadeDur=0,this):(this.fadeFrom=e,this.fadeTo=t,this.fadeT=0,this.fadeDur=n,this.weight=e,this)}tick(e){if(this.fadeDur>0){this.fadeT+=e;let t=Math.min(1,this.fadeT/this.fadeDur);if(this.weight=this.fadeFrom+(this.fadeTo-this.fadeFrom)*t,t>=1&&(this.fadeDur=0,this.fadeTo<=0)){this.stop();return}}if(!this.enabled||this.timeScale===0)return;let t=this.clip.duration||.001;this.time+=e*this.timeScale,this.loop===2200?this.time>=t?(this.time=t,this.clampWhenFinished||this.stop()):this.time<0&&(this.time=0):(this.time>=t||this.time<0)&&(this.time=(this.time%t+t)%t)}row(){let e=this.clip.duration||.001,t=this.loop===2200?Math.max(0,Math.min(e,this.time)):(this.time%e+e)%e;return this.row0+Math.min(this.frames-1,Math.max(0,Math.round(t*60)))}},cr=class{bake;actions=new Map;playing=[];seq=0;constructor(e){this.bake=e}clipAction(e){let t=this.actions.get(e);if(!t){let n=this.bake.clips.get(e)??{row0:0,frames:1};t=new sr(this,e,n.row0,n.frames),this.actions.set(e,t)}return t}activate(e){e.active=!0,e.order=++this.seq,this.playing.includes(e)||this.playing.push(e)}update(e){for(let t=this.playing.length-1;t>=0;t--){let n=this.playing[t];n.active&&n.tick(e),n.active||this.playing.splice(t,1)}}stopAllAction(){for(let e of this.playing)e.stop();this.playing.length=0}uncacheRoot(e){this.actions.clear()}pose(e){let t=null,n=null;for(let e of this.playing)e.weight<=1e-4||(!t||e.order>t.order?(n=t,t=e):(!n||e.order>n.order)&&(n=e));if(!t){e.a=e.b=0,e.w=1;return}if(e.a=t.row(),!n){e.b=e.a,e.w=1;return}e.b=n.row(),e.w=t.weight/Math.max(1e-4,t.weight+n.weight)}};function lr(e,t,n,r){let i=e.onBeforeCompile;e.onBeforeCompile=(a,o)=>{i.call(e,a,o),a.uniforms.uCrowdBake={value:t.texture},a.uniforms.uCrowdBind={value:n},a.vertexShader=a.vertexShader.replace(`#include <common>`,`#include <common>\n${Ft}\nvarying float vCrowdGlow;`).replace(`void main() {`,`void main() {
	mat4 valeK = valeCrowdMatrix();
	vCrowdGlow = aCrowdAnim.w;`).replace(`#include <defaultnormal_vertex>`,`objectNormal = normalize( mat3( valeK ) * objectNormal );
#include <defaultnormal_vertex>`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
	transformed = ( valeK * vec4( transformed, 1.0 ) ).xyz;`),r&&(a.fragmentShader=a.fragmentShader.replace(`#include <common>`,`#include <common>
varying float vCrowdGlow;`).replace(`vec3 totalEmissiveRadiance = emissive;`,`vec3 totalEmissiveRadiance = emissive * vCrowdGlow;`))};let a=e.customProgramCacheKey;e.customProgramCacheKey=()=>`${a.call(e)}|vale_crowd${r?`g`:``}`,e.needsUpdate=!0}var ur=6,dr=120,fr=5e4,pr=class{on=!1;from=0;crowdAt=1;saving=0;age=0;update(e,t,n=e){if(!this.on)return n>45e4&&(this.on=!0,this.from=n,this.crowdAt=Math.max(1,t),this.saving=0,this.age=0),this.on;this.age++,this.age<=ur&&(this.saving=Math.max(this.saving,this.from-e));let r=e+Math.max(fr,this.saving*t/this.crowdAt);return this.age>=dr&&r<43e4&&(this.on=!1),this.on}},mr=[`aCrowdM0`,`aCrowdM1`,`aCrowdM2`,`aCrowdAnim`,`aCrowdStyle`,`aCrowdFlash`,`aCrowdFlashRim`],hr={aCrowdM0:4,aCrowdM1:4,aCrowdM2:4,aCrowdAnim:4,aCrowdStyle:4,aCrowdFlash:3,aCrowdFlashRim:3},gr=class{cap=0;count=0;attrs={};geos=[];constructor(e){this.grow(e)}grow(e){let t=this.attrs;this.cap=e;let n={};for(let r of mr){let a=new i(new Float32Array(e*hr[r]),hr[r]);a.setUsage(N),t[r]&&a.array.set(t[r].array),n[r]=a}this.attrs=n;for(let e of this.geos)for(let t of mr)e.setAttribute(t,n[t])}view(e){let t=new j;t.index=e.index;for(let[n,r]of Object.entries(e.attributes))t.setAttribute(n,r);for(let e of mr)t.setAttribute(e,this.attrs[e]);return t.instanceCount=0,e.boundingSphere||e.computeBoundingSphere(),t.boundingSphere=e.boundingSphere,this.geos.push(t),t}commit(){for(let e of mr){let t=this.attrs[e];t.clearUpdateRanges(),t.addUpdateRange(0,Math.max(1,this.count)*hr[e]),t.needsUpdate=!0}for(let e of this.geos)e.instanceCount=this.count}dispose(){for(let e of this.geos){for(let t of Object.keys(e.attributes))mr.includes(t)||e.deleteAttribute(t);e.setIndex(null),e.dispose()}this.geos.length=0}},_r=new M,vr=new M,yr=new B,br={a:0,b:0,w:1};function xr(e,t,n,r,i,a){let o=e.attrs,s=n.root,c=n.model;_r.compose(s.position,s.quaternion,s.scale),vr.compose(r.rootPos,r.rootQuat,yr.copy(c.scale)),_r.multiply(vr);let l=_r.elements;o.aCrowdM0.setXYZW(t,l[0],l[4],l[8],l[12]),o.aCrowdM1.setXYZW(t,l[1],l[5],l[9],l[13]),o.aCrowdM2.setXYZW(t,l[2],l[6],l[10],l[14]),n.crowdPose(br),o.aCrowdAnim.setXYZW(t,br.a,br.b,br.w,n.glowLevel);let u=n.flashState;o.aCrowdStyle.setXYZW(t,i,a?u.k:0,+!!u.rim,0),o.aCrowdFlash.setXYZ(t,u.color.r,u.color.g,u.color.b);let d=u.rim??u.color;o.aCrowdFlashRim.setXYZ(t,d.r,d.g,d.b)}var Sr=class{group=new _;bake;buf=new gr(32);outlineU={uColor:{value:new R},uAlpha:{value:.6}};flashMeshes=[];accentMats=[];accentMeshes=[];bodyMeshes=[];hardNow=!1;colorSet=!1;units=[];flashing=[];constructor(e,t,n){this.bake=e,this.group.name=`crowd_${e.id}`;for(let n of e.parts){let r=n.material.clone();n.accent?(r.color.copy(t).multiplyScalar(.3),r.emissive.copy(t),r.emissiveIntensity=1,G(r,{unit:!0,monster:e.monster}),this.accentMats.push(r)):(r.onBeforeCompile=n.material.onBeforeCompile,r.customProgramCacheKey=n.material.customProgramCacheKey),lr(r,e,n.bind,n.accent);let i=this.buf.view(n.geometry);n.lod&&(i.userData.fullIndex=n.geometry.index,i.setIndex(n.lod));let a=new I(i,r);a.userData.valeLodUnit=n.unit,Wn(i,jn.minTrisCrowd,n.unit),a.customDepthMaterial=an(e.texture,n.bind),a.castShadow=!0,a.receiveShadow=!0,a.frustumCulled=!1,a.matrixAutoUpdate=!1,a.name=`crowd_part_${n.accent?`accent`:`body`}`,n.accent?this.accentMeshes.push(a):this.bodyMeshes.push({mesh:a,lod:n.lod,hard:n.lodHard}),Kn(a),this.group.add(a)}for(let t of e.hull){let r={uCrowdBake:{value:e.texture},uCrowdBind:{value:t.bind}},i=Ht(`crowd`,jt.outline,{side:1,blend:`normal`,depthWrite:!1,offset:[1,2],uniforms:{...r,...this.outlineU,uOutlineRes:n}}),a=t.lod,o=a??t.geometry.index,s=o?In(Zn(t.geometry,o,`crowd_ink`),`ink`,jn.minTrisCrowd,t.unit):null,c=this.buf.view(t.geometry),l=s??a;l&&(c.userData.fullIndex=t.geometry.index,c.setIndex(l));let u=new I(c,i);c.userData.outlineOnly=!0,u.frustumCulled=!1,u.matrixAutoUpdate=!1,u.renderOrder=1,u.name=`crowd_outline`,this.group.add(u);let d=Ht(`crowd`,jt.flash,{side:0,blend:`premul`,depthWrite:!1,offset:[-1,-2],uniforms:{...r,...Kt()}}),f=this.buf.view(t.geometry);a&&(f.userData.fullIndex=t.geometry.index,f.setIndex(a)),f.userData.flashOnly=!0;let p=new I(f,d);p.frustumCulled=!1,p.matrixAutoUpdate=!1,p.renderOrder=2,p.name=`crowd_flash`,this.flashMeshes.push(p),this.group.add(p)}}ranked=[];begin(){this.buf.count=0,this.colorSet=!1,this.units.length=0,this.flashing.length=0}push(e){let t=e.restOutline;!this.colorSet&&t.px>0&&(this.outlineU.uColor.value.copy(t.color),this.outlineU.uAlpha.value=t.opacity,this.colorSet=!0),(e.flashState.k>.002?this.flashing:this.units).push(e)}get pending(){return this.units.length+this.flashing.length}estimate(e,t){let n=this.pending;if(!n)return 0;let r=this.unitCosts(),i=t?Math.min(this.flashing.length,2):this.flashing.length,a=n*((t?r.bodyHard:r.body)+r.accent)+i*r.flash;return t||(a+=Math.min(n-i,e)*r.ink+i*r.ink+n*r.bodyShadow),e>=16&&(a+=n*r.accentShadow),a}costs=null;unitCosts(){if(this.costs)return this.costs;let e=e=>e?e.count/3:0,t={body:0,bodyHard:0,accent:0,flash:0,ink:0,bodyShadow:0,accentShadow:0};for(let n of this.bodyMeshes){let r=n.mesh.geometry,i=e(n.lod??r.index);t.body+=i,t.bodyHard+=n.hard?e(n.hard):i,t.bodyShadow+=e(Bn(r))||i}for(let n of this.accentMeshes){let r=e(n.geometry.index);t.accent+=r,t.accentShadow+=e(Bn(n.geometry))||r}for(let n of this.flashMeshes)t.flash+=e(n.geometry.index);return this.group.traverse(n=>{n.name===`crowd_outline`&&(t.ink+=e(n.geometry.index))}),this.costs=t}end(e=0,t=0,n=16,r=!1){if(r&&this.flashing.length>2){let n=n=>{let r=n.root.position;return(r.x-e)*(r.x-e)+(r.z-t)*(r.z-t)};this.flashing.sort((e,t)=>n(e)-n(t));for(let e=2;e<this.flashing.length;e++)this.units.push(this.flashing[e]);this.flashing.length=2}let i=this.buf,a=this.flashing.length,o=a+this.units.length;if(o>i.cap){let e=i.cap;for(;e<o;)e*=2;i.grow(e)}for(let e of this.flashing)xr(i,i.count++,e,this.bake,e.restOutline.px,!0);let s=this.ranked,c=this.units.length;for(;s.length<c;)s.push({a:null,d2:0});for(let n=0;n<c;n++){let r=this.units[n],i=r.root.position,a=(i.x-e)*(i.x-e)+(i.z-t)*(i.z-t);s[n].a=r,s[n].d2=r.restOutline.px>0&&a<=576?a:1/0}for(let e=c;e<s.length;e++)s[e].a=null,s[e].d2=1/0;s.sort((e,t)=>+!e.a-!t.a||e.d2-t.d2);let l=0;for(let e=0;e<c;e++){let t=s[e],r=t.a,a=l<n&&t.d2!==1/0;a&&l++,xr(i,i.count++,r,this.bake,a?r.restOutline.px:0,!1)}i.commit();for(let e of i.geos)e.userData.flashOnly?e.instanceCount=a:e.userData.outlineOnly&&(e.instanceCount=r?0:a+l);let u=n>=16;for(let e of this.accentMeshes)e.castShadow=u;for(let e of this.bodyMeshes)e.mesh.castShadow=!r;if(r!==this.hardNow){this.hardNow=r;for(let e of this.bodyMeshes)e.hard&&e.lod&&e.mesh.geometry.setIndex(r?e.hard:e.lod)}this.group.visible=i.count>0;for(let e of this.flashMeshes)e.visible=a>0}dispose(){this.group.traverse(e=>{let t=e;t.isMesh&&(t.material.dispose(),t.customDepthMaterial?.dispose())}),this.buf.dispose(),this.group.removeFromParent()}},Cr=class{group=new _;buf=new gr(1);mask=[];hull=[];maskMat;rimMat;constructor(e,t){let{uPx:n,uMask:r,uColor:i,uAlpha:a,...o}=t,s=Zt(`crowd`,{uPx:n,uMask:r,uColor:i,uAlpha:a},o,{uCrowdBake:{value:e.texture},uCrowdBind:{value:e.hull[0].bind}});this.maskMat=s.mask,this.rimMat=s.rim;for(let t of e.hull){let e=()=>{let e=this.buf.view(t.geometry);return t.lod&&(e.userData.fullIndex=t.geometry.index,e.setIndex(t.lod)),e},n=new I(e(),this.maskMat);n.frustumCulled=!1,n.matrixAutoUpdate=!1,n.visible=!1;let r=new I(e(),this.rimMat);r.frustumCulled=!1,r.matrixAutoUpdate=!1,r.visible=!1,this.mask.push(n),this.hull.push(r),this.group.add(n,r)}}dispose(){this.maskMat.dispose(),this.rimMat.dispose(),this.buf.dispose(),this.group.removeFromParent()}},wr=class{group=new _;sets=new Map;solos=new Map;warmSets=new Map;outlineRes;hover;constructor(e,t){this.outlineRes=e,this.hover=t,this.group.name=`vale_crowd`,this.group.matrixAutoUpdate=!1}begin(){for(let e of this.sets.values())e.begin()}push(e){let t=e.crowdBake;if(!t||!e.model)return;let n=`${t.id}|${e.accentKey}`,r=this.sets.get(n);r||(r=new Sr(t,e.accentTint,this.outlineRes),this.sets.set(n,r),this.group.add(r.group)),r.push(e)}end(e=0,t=0,n=16,r=!1){for(let i of this.sets.values())i.end(e,t,n,r)}get pending(){let e=0;for(let t of this.sets.values())e+=t.pending;return e}estimate(e,t){let n=0;for(let r of this.sets.values())n+=r.estimate(e,t);return n}get instances(){let e=0;for(let t of this.sets.values())e+=t.buf.count;return e}get setCount(){return this.sets.size}solo(e){let t=this.solos.get(e.id);return t||(t=new Cr(e,this.hover.rimUniforms()),this.solos.set(e.id,t)),t}warm(e,t,n,r,i,a=!1){let o=this.warmSets.get(e.id);(!o||a)&&(o||(o=new Sr(e,new R(1,1,1),this.outlineRes),this.warmSets.set(e.id,o)),t.compileAsync(o.group,n,r).catch(()=>void 0),t.compileAsync(this.solo(e).group,n,i).catch(()=>void 0))}hoverTarget(e,t,n){let r=e.crowdBake;if(!r||!e.model||t<=0||!r.hull.length)return null;let i=this.solo(r);return i.buf.count=0,xr(i.buf,0,e,r,0,!1),i.buf.count=1,i.buf.commit(),{model:i.group,mask:i.mask,hull:i.hull,px:t,color:n,maskMat:i.maskMat,rimMat:i.rimMat}}clear(){for(let e of this.sets.values())e.dispose();this.sets.clear()}releaseBakes(){this.clear();for(let e of this.solos.values())e.dispose();this.solos.clear();for(let e of this.warmSets.values())e.dispose();this.warmSets.clear()}dispose(){this.releaseBakes(),this.group.removeFromParent()}},Tr={alpha:.35,from:.5,band:.7,inS:.15,outS:.35,on:.25,keep:.12},Er=.06,Dr=.9,Or=.45,kr=new R().setStyle(`#BFD3E6`),Ar=.03,jr=80*Math.PI/180,Mr=.5,Nr=.12,Pr={k:1.25,s:.066},Fr=.5,Ir=.2,Lr=.3,Rr=[.25,.5,.72,.92],zr=[-1,0,1],Br=new ke({visible:!1});Br.name=`vale_struct_gone`;var Vr=/_(glow_base|base|upper|chip1|chip2|dmg1|dmg2|glow|core|ruin)$/,Hr=new M,Ur=new M,Wr=new he,Gr=new he,Kr=new De,qr=new B,Jr=new B,Yr=new B,Xr=new B,Zr=new B,Qr=new B,$r=new B,ei=new M,ti=new Map,ni=new WeakMap,ri=new WeakMap;function ii(e,t,n){n.identity();for(let r=e;r&&r!==t;r=r.parent)r.updateMatrix(),n.premultiply(r.matrix);return n}function ai(e,t,n){return n.makeEmpty(),e.traverse(e=>{let r=e;r.isMesh&&!r.userData.valeOutline&&(r.geometry.boundingBox||r.geometry.computeBoundingBox(),Gr.copy(r.geometry.boundingBox).applyMatrix4(ii(r,t,Hr)),n.union(Gr))}),n}function oi(e){let t=[];return e.traverse(e=>{let n=e;n.isMesh&&!n.userData.valeOutline&&t.push(n)}),t}var si={uSfY0:{value:1e4},uSfY1:{value:10001},uSfA:{value:1},uSfAlpha:{value:1},uSfClip:{value:-1e4},uSoot:{value:0}},ci={stage:[0,.8,1],ruin:.9,rubble:.75},li=new WeakSet;function ui(e){e.isMeshStandardMaterial&&di(e,si)}function di(e,t){if(li.has(e))return;li.add(e);let n=e.onBeforeCompile;e.onBeforeCompile=(r,i)=>{n.call(e,r,i),Object.assign(r.uniforms,t),r.fragmentShader=r.fragmentShader.replace(`#include <common>`,`#include <common>
uniform float uSfY0;
uniform float uSfY1;
uniform float uSfA;
uniform float uSfAlpha;
uniform float uSfClip;
uniform float uSoot;
float valeSootN( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  vec4 h = fract( sin( vec4( dot( i, vec2( 127.1, 311.7 ) ), dot( i + vec2( 1.0, 0.0 ), vec2( 127.1, 311.7 ) ),
    dot( i + vec2( 0.0, 1.0 ), vec2( 127.1, 311.7 ) ), dot( i + 1.0, vec2( 127.1, 311.7 ) ) ) ) * 43758.5453 );
  return mix( mix( h.x, h.y, f.x ), mix( h.z, h.w, f.x ), f.y );
}`).replace(`#include <opaque_fragment>`,`if ( vValeWorld.y < uSfClip ) discard;
diffuseColor.a *= mix( 1.0, uSfA, smoothstep( uSfY0, uSfY1, vValeWorld.y ) ) * uSfAlpha;
// max2 ENV-6: soot. Warm umber smoke-black in patches and in streaks running up the stone from the cracks (world space,
// so a tower's sides and its ruin agree); the darkest soot keeps 40 % of the stone's light, never a hole in the frame
if ( uSoot > 0.0 ) {
  vec3 sp = vValeWorld;
  float n1 = valeSootN( sp.xz * 2.3 + sp.y * vec2( 0.7, -0.5 ) );
  float st = valeSootN( vec2( ( sp.x - sp.z ) * 3.1, sp.y * 0.45 ) );
  // (max2 fix: the soot climbs from the foot: heavier low on the stone, where the fire sat, and a warm grime under it)
  float foot = 1.0 - smoothstep( 0.4, 3.2, sp.y );
  float sm = smoothstep( 0.38, 0.74, n1 * 0.55 + st * 0.5 + uSoot * 0.4 + foot * 0.18 - 0.14 ) * uSoot;
  outgoingLight *= mix( vec3( 1.0 ), vec3( 0.88, 0.8, 0.7 ), min( 1.0, uSoot * 1.2 ) );
  outgoingLight *= mix( vec3( 1.0 ), vec3( 0.42, 0.36, 0.3 ), sm );
}
#include <opaque_fragment>`)};let r=e.customProgramCacheKey;e.customProgramCacheKey=()=>`${r.call(e)}|vsf`,e.needsUpdate=!0}var fi=Lt,pi=class{host;list=new Map;killers=new Map;gone=[];time=0;view=null;constructor(e){this.host=e}attach(e,t){let n=e.model;if(!n||e.disposed)return;let r=new Map;n.traverse(e=>{if(e.userData.valeOutline)return;let t=Vr.exec(e.name);t&&!r.has(t[1])&&r.set(t[1],e)});let i=r.get(`upper`)??null,a=r.get(`ruin`)??null;a&&(a.visible=!1);let o=[r.get(`dmg1`)??null,r.get(`dmg2`)??null];for(let e of o)e&&(e.visible=!1);let s={uSfY0:{value:1e4},uSfY1:{value:10001},uSfA:{value:1},uSfAlpha:{value:1},uSfClip:{value:-1e4},uSoot:{value:0}},c={a:e,def:t,upper:i,ruin:a,chips:[r.get(`chip1`)??null,r.get(`chip2`)??null],dmg:o,accents:[],u:s,clones:[],upperMats:[],depth:[],depthMat:null,trans:!1,upRest:new M,plinth:.4,top:t.art.height,radius:1,stage:0,seen:!1,dieT:-1,fallDir:new B(1,0,0),broke:!1,landed:!1,dead:!1,riseT:-1,fade:0,occ:null,occWant:!1,shell:null,skins:[],skinMat:null,noSkin:new Set,shellK:0,shellBreak:-1,seed:e.id*.6180339%1*100,dipUntil:0,nextDip:0,flareT:-1,falling:[],rubble:null,baseNode:r.get(`base`)??null,warmed:!1};for(let e of[...o,r.get(`core`)??null])if(e)for(let t of oi(e))c.noSkin.add(t);let l=r.get(`base`);if(l&&(c.plinth=ai(l,e.root,Wr).max.y),i&&(ii(i,e.root,c.upRest),ai(i,e.root,Wr),c.top=Wr.max.y,c.radius=Math.max(.4,Math.abs(Wr.min.x),Math.abs(Wr.max.x),Math.abs(Wr.min.z),Math.abs(Wr.max.z)),c.occ=gi(i,e.root,c.plinth,c.top,c.radius)),n.traverse(e=>{let t=e;if(!t.isMesh||t.userData.valeOutline)return;let n=Array.isArray(t.material)?t.material:[t.material];for(let e of n)e.name===`accent`&&c.accents.push(e)}),i){let e=new Map,t=Xt(`rigid`);t.name=`vale_struct_depth`,c.depthMat=t;for(let n of oi(i)){let r=t=>{let n=e.get(t);return n||(t.name===`accent`?n=t:(n=t.clone(),G(n),c.clones.push(n)),di(n,s),e.set(t,n),c.upperMats.push(n)),n};n.material=Array.isArray(n.material)?n.material.map(r):r(n.material);let i=new I(n.geometry,t);i.name=`vale_struct_depth`,i.userData.valeOutline=!0,i.castShadow=!1,i.receiveShadow=!1,i.renderOrder=50,i.matrixAutoUpdate=!1,i.visible=!1,n.add(i),c.depth.push(i)}}if(a){let e={...si,uSoot:{value:ci.ruin}},t=new Map;for(let n of oi(a)){let r=n=>{if(!n.isMeshStandardMaterial||n.name===`accent`)return n;let r=t.get(n);return r||(r=n.clone(),G(r),di(r,e),c.clones.push(r),t.set(n,r)),r};n.material=Array.isArray(n.material)?n.material.map(r):r(n.material)}let n=c.baseNode?oi(c.baseNode)[0]:void 0,r=n&&!Array.isArray(n.material)?n.material:void 0;if(r&&r.isMeshStandardMaterial){let e=r.clone();G(e),di(e,{...si,uSoot:{value:ci.rubble}}),c.clones.push(e),c.rubbleMat=e}}n.traverse(e=>{let t=e;if(t.isMesh&&!t.userData.valeOutline)for(let e of Array.isArray(t.material)?t.material:[t.material])e.isMeshStandardMaterial&&di(e,si)});let u=e.view;if(u){let e=this.gone.findIndex(e=>Math.hypot(e.x-u.x,e.y-u.y)<.5&&this.time-e.t<2);e>=0&&u.alive&&(this.gone.splice(e,1),c.riseT=0)}this.list.set(e.id,c),this.warm(e)}forget(e){let t=this.list.get(e.id);t&&(this.gone.push({x:e.x,y:e.y,t:this.time}),this.gone.length>8&&this.gone.shift(),this.dispose(t),this.list.delete(e.id))}clear(){for(let e of this.list.values())this.dispose(e);this.list.clear(),this.killers.clear(),this.gone.length=0}dispose(e){for(let t of e.clones)t.dispose();e.depthMat?.dispose(),e.shell&&=(e.shell.geometry.dispose(),e.shell.material.dispose(),e.shell.removeFromParent(),null);for(let t of e.skins)t.removeFromParent();e.skins.length=0,e.skinMat?.dispose(),e.skinMat=null;for(let t of e.falling)t.g.removeFromParent();e.falling.length=0,e.rubble&&=(e.rubble.geometry.dispose(),e.rubble.removeFromParent(),null)}warmedKeys=new Set;warm(e){let t=this.list.get(e.id);if(!t||t.warmed||e.disposed)return;let n=`${t.def.id}:${e.team}`;if(this.warmedKeys.has(n)){t.warmed=!0;return}this.ensureShell(t);let r=t.shell.visible,i=t.skins.map(e=>e.visible),a=t.dmg.map(e=>e?.visible??!1),o=t.ruin?.visible??!1;t.ruin&&(t.ruin.visible=!0),t.shell.visible=!0;for(let e of t.skins)e.visible=!0;for(let e of t.dmg)e&&(e.visible=!0);let s=t.trans;this.setTransparent(t,!0);for(let e of t.depth)e.visible=!0;let c=this.host.compile(e.root);this.setTransparent(t,s);for(let e of t.depth)e.visible=t.trans&&!e.parent?.userData.sfGone;t.dmg.forEach((e,t)=>{e&&(e.visible=a[t])}),t.ruin&&(t.ruin.visible=o),t.shell.visible=r,t.skins.forEach((e,t)=>{e.visible=i[t]}),c&&(this.warmedKeys.add(n),t.warmed=!0)}warmAll(e){for(let t of e)t.kind===`structure`&&this.warm(t)}handle(e){for(let t of e)t.e===`death`&&t.kind===`structure`&&t.killer>=0&&this.killers.set(t.dst,t.killer)}update(e,t,n,r,i,a){this.time=t,this.view=n,r.updateMatrixWorld(),r.getWorldDirection(Xr),Zr.setFromMatrixColumn(r.matrixWorld,0).setY(0),Zr.lengthSq()<1e-8&&Zr.set(1,0,0),Zr.normalize();for(let t of this.list.values()){let n=t.a,o=n.view;if(!o||n.disposed)continue;(!o.alive||o.state===`dead`)&&(t.dead||this.die(t,o,a)),t.dieT>=0?this.collapse(t,e,o):t.dead||(this.damage(t,o),t.riseT>=0&&this.rise(t,e)),t.seen=!0,this.light(t,e),this.shellUpdate(t,e,o),t.falling.length&&this.fallUpdate(t,e);let s=0,c=t.dieT>=0;if((!t.dead||c)&&n.root.visible&&t.upper&&t.occ){let e=t.occWant?Tr.keep:Tr.on;for(let o of i){if(o<0||o===n.id)continue;let i=a.get(o);if(i&&i.visible&&i.root.visible&&i.view?.alive&&this.blocked(t,i,r,c)>=e){s=1;break}}}t.occWant=s>0;let l=s>t.fade?1/Tr.inS:1/Tr.outS;t.fade=s>t.fade?Math.min(s,t.fade+e*l):Math.max(s,t.fade-e*l),this.applyFade(t)}for(let e of[...this.killers.keys()])this.list.has(e)||this.killers.delete(e)}damage(e,t){let n=e.def.art.damage?.at;if(!n?.length)return;let r=Math.max(0,t.hp)/Math.max(1,t.maxHp),i=0;for(let e of n)r<=e&&i++;let a=e.stage;if(i>a){if(e.seen){for(let n=a;n<i;n++)this.crackVfx(e,t,n,this.dropChip(e,n));e.flareT=this.time}a=i}else for(;a>0&&r>n[a-1]+Er;)a--;(a!==e.stage||!e.seen)&&(e.stage=a,this.showStage(e,a)),e.u.uSoot.value=ci.stage[Math.min(a,ci.stage.length-1)]}showStage(e,t){e.chips.forEach((e,n)=>{e&&mi(e,t<=n)}),e.dmg.forEach((e,n)=>{e&&(e.visible=t>n)})}crackVfx(e,t,n,r){let i=e.def.art.damage?.vfx;if(!i)return;let a=e.a,o;if(r)o=r.clone();else{let t=e.plinth+(e.top-e.plinth)*(n===0?.62:.45),r=e.seed+n*2.1;o=new B(a.x+Math.cos(r)*e.radius*.7,a.h+t,a.y+Math.sin(r)*e.radius*.7)}this.host.vfx.spawn(i,{tier:2,team:this.host.tint(t),element:null,ally:!1,origin:o,ground:new B(o.x,a.h,o.z),scale:1,anchor:`origin`,world:!0})}dropChip(e,t){let n=e.chips[t],r=e.a;if(!n||!r.root.visible)return null;let i=null,a=-1;for(let o of oi(n)){if(o.userData.sfGone)continue;let n=Array.isArray(o.material)?o.material[0]:o.material,s=ii(o,r.root,new M);for(let c of vi(o.geometry)){if(e.falling.length>=24)break;let o=c.c.clone().applyMatrix4(s),l=new I(c.geo,n);l.name=`vale_struct_chip`,l.userData.valeOutline=!0,l.castShadow=!0,l.receiveShadow=!1,l.customDepthMaterial=tn(`rigid`),l.matrixAutoUpdate=!1,l.matrix.makeTranslation(-o.x,-o.y,-o.z).multiply(s);let u=new _;u.name=`vale_struct_chip`,u.userData.valeOutline=!0,u.position.copy(o),u.add(l),r.root.add(u);let d=bi(Math.sin((o.x*12.9898+o.z*78.233+t)*43758.5453)),f=qr.set(o.x,0,o.z);f.lengthSq()<1e-4&&f.set(Math.cos(e.seed+t),0,Math.sin(e.seed+t)),f.normalize();let p=new B(f.x*(1.3+1.1*d),.8+.8*d,f.z*(1.3+1.1*d)),m=.12,h=Mr*(.85+.3*d),g=Math.max(9.8,2*(o.y-m+p.y*h)/(h*h)),v=new B(-f.z,.35*(d-.5),f.x).normalize();e.falling.push({g:u,t:0,p0:o,v:p,acc:g,land:m,axis:v,spin:(5+6*d)*(d>.5?1:-1),landed:-1});let y=c.geo.boundingSphere?.radius??0;y>a&&(a=y,i=o)}}return i?(Yr.copy(i),r.root.updateMatrix(),Yr.applyMatrix4(r.root.matrix).clone()):null}fallUpdate(e,t){for(let n=e.falling.length-1;n>=0;n--){let r=e.falling[n];if(r.t+=t,r.landed<0){let e=r.t,t=r.p0.y+r.v.y*e-.5*r.acc*e*e;r.g.position.set(r.p0.x+r.v.x*e,Math.max(r.land,t),r.p0.z+r.v.z*e),r.g.quaternion.setFromAxisAngle(r.axis,r.spin*e),t<=r.land&&(r.landed=r.t)}else{let t=(r.t-r.landed)/Nr;r.g.scale.setScalar(Math.max(.001,1-t)),t>=1&&(r.g.removeFromParent(),e.falling.splice(n,1))}}}die(e,t,n){if(e.dead=!0,e.riseT=-1,e.chips.forEach(e=>{e&&mi(e,!1)}),e.dmg.forEach(e=>{e&&(e.visible=!0)}),!e.seen||!e.upper||!e.def.art.ruin){this.toRuin(e);return}let r=e.a,i=n.get(this.killers.get(r.id)??-1),a=Math.cos(e.seed),o=Math.sin(e.seed);i&&Math.hypot(r.x-i.x,r.y-i.y)>.5&&(a=r.x-i.x,o=r.y-i.y);let s=Math.hypot(a,o)||1;e.fallDir.set(a/s,0,o/s),e.dieT=0,e.broke=!1,e.landed=!1}collapse(e,t,n){let r=e.a,i=e.def.art.ruin?.collapse??1.8;e.dieT+=t;let a=e.dieT,o=e.upper,s=.2,c=s+i*.55,l=o.parent;ii(l,r.root,Ur),Hr.copy(Ur).invert(),Kr.copy(r.root.quaternion).invert();let u=qr.copy(e.fallDir).applyQuaternion(Kr),d=Yr.set(u.x*e.radius*.55,e.plinth,u.z*e.radius*.55).applyMatrix4(Hr),f=Jr.set(0,1,0).cross(u).transformDirection(Hr).normalize(),p=0,m=0,h=0;if(a<s)h=.035*Math.sin(a*95)*(1-a/s*.4);else if(a<c){let e=(a-s)/(c-s);p=jr*e*e}else{let e=Math.min(1,(a-c)/Math.max(.1,i-c));p=jr+.12*e,m=2.4*e**1.4}if(Kr.setFromAxisAngle(f,p),o.quaternion.copy(Kr),o.position.copy(d).sub(Jr.copy(d).applyQuaternion(Kr)),o.position.y-=m/Math.max(.001,l.getWorldScale(Jr).y),o.position.x+=h,!e.broke&&a>=s){e.broke=!0,e.ruin&&(e.ruin.visible=!0);let t=e.def.art.ruin?.breakVfx;if(t){let i=new B(r.x+e.fallDir.x*e.radius*.6,r.h+Math.min(1.3,e.plinth+.8),r.y+e.fallDir.z*e.radius*.6);this.host.vfx.spawn(t,{tier:3,team:this.host.tint(n),element:null,ally:!1,origin:i,ground:new B(i.x,r.h,i.z),scale:1,anchor:`origin`,world:!0})}}if(!e.landed&&a>=c){e.landed=!0,this.rubble(e);let t=e.def.art.ruin?.landVfx,i=e.radius*.55+(e.top-e.plinth)*.62;if(t){let a=new B(r.x+e.fallDir.x*i,r.h,r.y+e.fallDir.z*i);this.host.vfx.spawn(t,{tier:3,team:this.host.tint(n),element:null,ally:!1,origin:a.clone().setY(r.h+.4),ground:a,scale:Math.max(1,(e.top-e.plinth)/4.5),anchor:`ground`,dir:Math.atan2(e.fallDir.z,e.fallDir.x),world:!0})}}e.u.uSfClip.value=r.h+.02,e.u.uSfAlpha.value=a<c?1:1-yi(.25,1,(a-c)/Math.max(.1,i-c)),a>=i&&this.toRuin(e)}toRuin(e){e.dieT=-1,e.dead=!0,e.upper&&(e.upper.visible=!1,e.upper.position.set(0,0,0),e.upper.quaternion.identity()),e.ruin&&(e.ruin.visible=!0),e.u.uSfAlpha.value=1,e.u.uSfClip.value=-1e4,this.rubble(e)}rubble(e){if(e.rubble)return;let t=(e.baseNode?oi(e.baseNode)[0]:void 0)??(e.ruin?oi(e.ruin)[0]:void 0);if(!t)return;let n=e.a,r=qr.copy(e.fallDir).applyQuaternion(Kr.copy(n.root.quaternion).invert());r.y=0,r.lengthSq()<1e-6&&r.set(Math.cos(e.seed),0,Math.sin(e.seed)),r.normalize();let i=new B(-r.z,0,r.x),a=e.radius*.55+(e.top-e.plinth)*.62,o=t.geometry,s=o.getAttribute(`position`),c=o.index,l=Math.floor((c?c.count:s.count)/3),u=Object.keys(o.attributes).filter(e=>e!==`position`&&e!==`normal`),d=new Ge(1,0),f=[xi(),d.index?d.toNonIndexed():d],p=e=>f[e%2].getAttribute(`position`).count,m=0;for(let e=0;e<12;e++)m+=p(e);let h=new Float32Array(m*3),g=u.map(e=>{let t=o.getAttribute(e);return{n:e,at:t,arr:new Float32Array(m*t.itemSize)}}),_=(e.seed*9301+49297)%233280,v=()=>(_=(_*9301+49297)%233280,_/233280),y=new De,b=new B,x=new B,S=(e,t)=>c?c.getX(e*3+t):e*3+t,C=(e,t)=>t.set(s.getX(e),s.getY(e),s.getZ(e)),w=new B,T=new B,E=new B,D=e=>(C(S(e,0),w),C(S(e,1),T),C(S(e,2),E),T.sub(w).cross(E.sub(w)).length()),O=o.getAttribute(`color`),ee=0;if(O){let e=[];for(let t=0;t<64;t++){let t=S(Math.floor(v()*l),0);e.push(.2126*O.getX(t)+.7152*O.getY(t)+.0722*O.getZ(t))}e.sort((e,t)=>e-t),ee=.8*e[e.length>>1]}let k=o.getAttribute(`uv`),te=o.getAttribute(`normal`),A=0;for(let e=0;e<s.count;e++)A=Math.max(A,Math.hypot(s.getX(e),s.getZ(e)));let j=e=>{let t=S(e,0),n=S(e,1),r=S(e,2);if(te&&(te.getY(t)+te.getY(n)+te.getY(r))/3<.7)return!1;let i=(s.getX(t)+s.getX(n)+s.getX(r))/3,a=(s.getZ(t)+s.getZ(n)+s.getZ(r))/3;return Math.hypot(i,a)>.6*A},ne=Ci(t.material),re=0;if(ne&&k){let e=[];for(let t=0;t<96;t++){let t=S(Math.floor(v()*l),0);e.push(ne(k.getX(t),k.getY(t)))}e.sort((e,t)=>e-t),re=e[Math.floor(e.length*.7)]}let ie=null;if(k){let e=[],t=[];for(let n=0;n<400&&e.length<64;n++){let n=Math.floor(v()*l);if(!j(n))continue;let r=S(n,0);e.push(k.getX(r)),t.push(k.getY(r))}e.length>8&&(e.sort((e,t)=>e-t),t.sort((e,t)=>e-t),ie=[e[e.length>>1],t[t.length>>1]])}let ae=new B,oe=new B,se=new B,ce=new B,le=0;for(let t=0;t<12;t++){let n=f[t%2].getAttribute(`position`),o=n.count,s=t<8,c=s?.8+.24*v():.32+.4*((t-8)/3)+.06*(v()-.5),u=(.13+.2*v())*(t<3?1.3:1),d=(v()-.5)*2*(s?.75:.35+.6*c),p=s?u*.55*(t/8):0,m=r.x*(e.radius*.7+a*c)+i.x*d,_=r.z*(e.radius*.7+a*c)+i.z*d;y.setFromAxisAngle(b.set((v()-.5)*.5,1,(v()-.5)*.5).normalize(),v()*Math.PI*2);let C=.55+.3*v(),w=.75+.35*v(),T=0,E=-1/0;for(let e=0,t=0;e<64&&t<10;e++){let n=Math.floor(v()*l),r=D(n);if(!(ne&&k)&&e<56&&!j(n))continue;t++;let i=r;if(!ne&&k&&ie){let e=S(n,0),t=S(n,1),a=S(n,2);i=-Math.hypot((k.getX(e)+k.getX(t)+k.getX(a))/3-ie[0],(k.getY(e)+k.getY(t)+k.getY(a))/3-ie[1])+Math.min(r,.02)}if(ne&&k){let e=S(n,0),t=S(n,1),a=S(n,2),o=ne((k.getX(e)+k.getX(t)+k.getX(a))/3,(k.getY(e)+k.getY(t)+k.getY(a))/3);i=-Math.abs(o-re)*10+Math.min(r,.05)}i>E&&(E=i,T=n)}let O=S(T,0),te=S(T,1),A=S(T,2),ue=v(),de=.55+.35*v();for(let e=0;e<o;e+=3){oe.set(n.getX(e),n.getY(e),n.getZ(e)),se.set(n.getX(e+1),n.getY(e+1),n.getZ(e+1)),ce.set(n.getX(e+2),n.getY(e+2),n.getZ(e+2)),ae.subVectors(se,oe).cross(Jr.subVectors(ce,oe));let r=Math.abs(ae.x),i=Math.abs(ae.y),a=Math.abs(ae.z);for(let o=0;o<3;o++){let s=e+o,c=n.getX(s),l=n.getY(s),d=n.getZ(s),f=e=>bi(Math.sin((c*12.99+l*78.23+d*37.71+t*4.1+e)*43758.5453))-.5;x.set(c+.2*f(1),(l+.2*f(2))*C,(d+.2*f(3))*w).multiplyScalar(u).applyQuaternion(y);let v=(le+s)*3;h[v]=m+x.x,h[v+1]=Math.max(-.04,x.y+u*C*.3+p),h[v+2]=_+x.z;let b=r>=i&&r>=a?d:c,S=r>=i&&r>=a?l:i>=a?d:l;b=bi(.5+b*.5*de+ue),S=bi(.5+S*.5*de+ue*1.7),b+S>1&&(b=1-b,S=1-S);let T=1/3+.45*(b-1/3),E=1/3+.45*(S-1/3),D=1-T-E;for(let e of g){let t=e.at.itemSize,n=(le+s)*t,r=(t,n)=>n===0?e.at.getX(t):n===1?e.at.getY(t):n===2?e.at.getZ(t):e.at.getW(t);for(let i=0;i<t;i++)e.arr[n+i]=r(O,i)*D+r(te,i)*T+r(A,i)*E;if(e.n===`color`){let r=.2126*e.arr[n]+.7152*e.arr[n+1]+.0722*e.arr[n+2],i=.9*Math.max(1,ee/Math.max(1e-4,.9*r));for(let r=0;r<Math.min(3,t);r++)e.arr[n+r]*=i}}}}le+=o}for(let e of f)e.dispose();let ue=new Ee;ue.setAttribute(`position`,new F(h,3));for(let e of g)ue.setAttribute(e.n,new F(e.arr,e.at.itemSize));ue.computeVertexNormals();let de=ue.getAttribute(`normal`);for(let e=0;e<de.count;e++){let t=de.getX(e)*.8,n=de.getY(e)*.8+.2,r=de.getZ(e)*.8,i=Math.hypot(t,n,r)||1;de.setXYZ(e,t/i,n/i,r/i)}ue.computeBoundingSphere();let fe=new I(ue,e.rubbleMat??t.material);fe.name=`vale_struct_rubble`,fe.castShadow=!0,fe.receiveShadow=!0,fe.customDepthMaterial=tn(`rigid`),n.root.add(fe),e.rubble=fe}rise(e,t){let n=e.upper;if(!n){e.riseT=-1;return}e.riseT+=t;let r=Math.min(1,e.riseT/Dr),i=1-(1-r)**3,a=n.parent;n.position.set(0,-(1-i)*(e.top-e.plinth)/Math.max(.001,a.getWorldScale(Jr).y),0),e.u.uSfClip.value=r<1?e.a.h+e.plinth-.02:-1e4,r>=1&&(e.riseT=-1,n.position.set(0,0,0))}light(e,t){let n=this.time,r=1;if(e.dead){let t=e.def.art.ruin?.collapse??1.8;r=e.dieT>=0?1-.88*yi(0,.7,e.dieT/t):.12,e.dieT>=0&&e.dieT<.2&&(r=1+.25*Math.sin(e.dieT*60))}else if(e.stage>0){let t=e.stage>=2,i=.5+.5*Math.sin(n*(t?9.1:6.3)+e.seed)*Math.sin(n*(t?3.7:2.3)+e.seed*1.7);if(r=t?.68+.27*i:.84+.14*i,n>=e.nextDip){let r=bi(Math.sin((n+e.seed)*12.9898)*43758.5453);e.dipUntil=n+(t?.06+.1*r:.05+.05*r),e.nextDip=n+(t?.7+1.5*r:2.4+2.8*r)}n<e.dipUntil&&(r*=t?.18:.4),e.flareT>=0&&n-e.flareT<Pr.s&&(r=Pr.k)}if(r!==1&&e.a.visible){let t=e.a.glowLevel*r;for(let n of e.accents)n.emissiveIntensity=t}}ensureShell(e){if(e.shell)return;let t=e.a,n=(e.occ?.foot??e.radius)+.12,r=[new O(n,0),new O(n,fi*.5),new O(n,fi)],i=new A(r,48),a=cn(ln()),o=new I(i,a);if(o.name=`vale_struct_shell`,o.userData.valeOutline=!0,o.castShadow=!1,o.receiveShadow=!1,o.position.y=e.plinth,o.renderOrder=5,o.visible=!1,t.root.add(o),e.shell=o,!e.upper)return;let s=sn(ln({center:!0,h:Math.max(1,e.top-e.plinth),inflate:Ar,fade:{uSfY0:e.u.uSfY0,uSfY1:e.u.uSfY1,uSfA:e.u.uSfA}}));e.skinMat=s;for(let t of oi(e.upper)){if(e.noSkin.has(t))continue;let n=new I(_i(t.geometry),s);n.name=`vale_struct_skin`,n.userData.valeOutline=!0,n.castShadow=!1,n.receiveShadow=!1,n.renderOrder=6,n.visible=!1,t.add(n),e.skins.push(n)}}shellUpdate(e,t,n){let r=n.alive&&!n.targetable&&!e.dead;if(!r&&!e.shell)return;this.ensureShell(e);let i=e.shell,a=i.material.uniforms,o=e.skinMat?.uniforms,s=0;if(r?(e.shellBreak=-1,e.shellK=Math.min(1,e.shellK+t/.4),a.uFlash.value=0):e.shellK>0&&e.shellBreak<0&&(e.shellBreak=0),e.shellBreak>=0){e.shellBreak+=t;let n=Math.min(1,e.shellBreak/Or);e.shellK=1-n,s=1-(1-n)*(1-n),a.uFlash.value=.6*(1-n)*(1-n),n>=1&&(e.shellBreak=-1,e.shellK=0,s=0)}i.scale.setScalar(1+.14*s);let c=e.shellK>.001&&e.a.root.visible;i.visible=c;for(let t of e.skins)t.visible=c&&!t.parent?.userData.sfGone;if(!c)return;let l=a.uColor.value.copy(kr).lerp(this.host.tint(n),.2);a.uK.value=e.shellK,a.uTime.value=this.time,o&&(o.uColor.value.copy(l),o.uK.value=e.shellK,o.uFlash.value=a.uFlash.value,o.uTime.value=this.time,o.uInflate.value=Ar+.52*s,o.uCenter.value.set(e.a.x,e.a.h+e.plinth,e.a.y))}blocked(e,t,n,r=!1){let i=e.a,a=e.occ,o=t.x-i.x,s=t.y-i.y;if(r){if(o*o+s*s>(e.radius+e.top+1)**2)return 0}else{if(o*o+s*s>(e.radius+8)**2)return 0;let t=Math.hypot(Xr.x,Xr.z)||1;if((o*Xr.x+s*Xr.z)/t<-(e.radius+.6))return 0}ei.compose(i.root.position,i.root.quaternion,i.root.scale).invert(),r&&e.upper&&ei.premultiply(ii(e.upper,i.root,Ur).invert().premultiply(e.upRest)),Qr.copy(n.position).applyMatrix4(ei);let c=Math.max(.6,t.artHeight),l=Math.min(.3,Math.max(.15,t.radius*.55)),u=0,d=0;for(let e of Rr)for(let n of zr)d++,$r.set(t.x+Zr.x*n*l,t.h+e*c,t.y+Zr.z*n*l).applyMatrix4(ei),hi(Qr,$r,a.vols,!r)&&u++;return u/d}applyFade(e){let t=e.a,n=e.fade>.001;e.u.uSfY0.value=e.dieT>=0?t.h-100:t.h+e.plinth+Tr.from,e.u.uSfY1.value=e.u.uSfY0.value+Tr.band,e.u.uSfA.value=1-(1-Tr.alpha)*yi(0,1,e.fade);let r=n||e.dieT>=0&&e.u.uSfAlpha.value<.999;r!==e.trans&&this.setTransparent(e,r);for(let t of e.depth)t.visible=r&&!t.parent?.userData.sfGone}setTransparent(e,t){e.trans=t;for(let n of e.upperMats)t?On(n,n.opacity,!1):kn(n)}info(){return[...this.list.values()].map(e=>({id:e.a.id,def:e.def.id,team:e.a.team,stage:e.stage,dead:e.dead,collapsing:e.dieT>=0,rising:e.riseT>=0,ruin:!!e.ruin?.visible,fade:+e.fade.toFixed(3),shell:+e.shellK.toFixed(3),plinth:+e.plinth.toFixed(3),top:+e.top.toFixed(3),radius:+e.radius.toFixed(3),falling:e.falling.length,occVols:e.occ?.vols.length??0,foot:+(e.occ?.foot??0).toFixed(3)}))}blockedShare(e,t,n){let r=this.list.get(e);return!r||!r.occ?0:(n.updateMatrixWorld(),n.getWorldDirection(Xr),Zr.setFromMatrixColumn(n.matrixWorld,0).setY(0).normalize(),this.blocked(r,t,n))}};function mi(e,t){for(let n of oi(e))t&&n.userData.sfGone?(n.material=n.userData.sfMat,n.userData.sfGone=!1):!t&&!n.userData.sfGone&&(n.userData.sfMat=n.material,n.material=Br,n.userData.sfGone=!0)}function hi(e,t,n,r){let i=t.x-e.x,a=t.y-e.y,o=t.z-e.z,s=Math.hypot(i,a,o);if(s<.3)return!1;let c=1-Lr/s,l=i*i+o*o;for(let t of n){let n=0,s=r?1/0:c;if(Math.abs(a)<1e-9){if(e.y<t.y0||e.y>t.y1)continue}else{let r=(t.y0-e.y)/a,i=(t.y1-e.y)/a;if(r>i){let e=r;r=i,i=e}if(n=Math.max(n,r),s=Math.min(s,i),n>s)continue}if(Math.abs(i)<1e-9){if(e.x<t.x0||e.x>t.x1)continue}else{let r=(t.x0-e.x)/i,a=(t.x1-e.x)/i;if(r>a){let e=r;r=a,a=e}if(n=Math.max(n,r),s=Math.min(s,a),n>s)continue}if(Math.abs(o)<1e-9){if(e.z<t.z0||e.z>t.z1)continue}else{let r=(t.z0-e.z)/o,i=(t.z1-e.z)/o;if(r>i){let e=r;r=i,i=e}if(n=Math.max(n,r),s=Math.min(s,i),n>s)continue}let u=e.x-t.cx,d=e.z-t.cz;if(l<1e-12){if(u*u+d*d>t.r2)continue}else{let e=2*(u*i+d*o),r=u*u+d*d-t.r2,a=e*e-4*l*r;if(a<0)continue;let c=Math.sqrt(a);if(n=Math.max(n,(-e-c)/(2*l)),s=Math.min(s,(-e+c)/(2*l)),n>s)continue}if(s<=c)return!0}return!1}function gi(e,t,n,r,i){let a=oi(e),o=new M,s=a.length?`${a[0].geometry.uuid}|${ii(a[0],t,o).elements.map(e=>e.toFixed(3)).join(`,`)}`:e.uuid,c=ti.get(s);if(c)return c;let l=n+Tr.from,u=Math.max(1,Math.ceil((r-l)/Fr)),d=(r-l)/u,f=i+Ir,p=Math.ceil(2*f/Ir),m=Array.from({length:u},()=>new Uint8Array(p*p)),h=Array.from({length:u},()=>[]),g=Array.from({length:u},()=>[]),_=0,v=new B,y=new B,b=new B,x=[],S=(e,t,n,r,i)=>{let a=Math.max(0,Math.floor((t+f)/Ir)),o=Math.min(p-1,Math.floor((n+f)/Ir)),s=Math.max(0,Math.floor((r+f)/Ir)),c=Math.min(p-1,Math.floor((i+f)/Ir));for(let t=s;t<=c;t++)for(let n=a;n<=o;n++)e[t*p+n]=1},C=(e,t)=>{x.length=0;let n=[v,y,b];for(let r=0;r<3;r++){let i=n[r],a=n[(r+1)%3];i.y>=e&&i.y<=t&&x.push(i.x,i.z);for(let n of[e,t])if((i.y-n)*(a.y-n)<0){let e=(n-i.y)/(a.y-i.y);x.push(i.x+(a.x-i.x)*e,i.z+(a.z-i.z)*e)}}};for(let e of a){ii(e,t,o);let i=e.geometry.getAttribute(`position`),a=e.geometry.index,s=a?a.count/3:i.count/3,c=new Float32Array(i.count*3);for(let e=0;e<i.count;e++)v.fromBufferAttribute(i,e).applyMatrix4(o),c[e*3]=v.x,c[e*3+1]=v.y,c[e*3+2]=v.z;for(let e=0;e<s;e++){let t=a?a.getX(e*3):e*3,i=a?a.getX(e*3+1):e*3+1,o=a?a.getX(e*3+2):e*3+2;v.fromArray(c,t*3),y.fromArray(c,i*3),b.fromArray(c,o*3);let s=Math.min(v.y,y.y,b.y),w=Math.max(v.y,y.y,b.y);if(s<=n+.6&&w>=n){C(n,n+.6);for(let e=0;e<x.length;e+=2)_=Math.max(_,Math.hypot(x[e],x[e+1]))}if(w<l||s>r)continue;let T=Math.max(0,Math.floor((s-l)/d)),E=Math.min(u-1,Math.floor((w-l)/d));for(let e=T;e<=E;e++){if(C(l+e*d,l+(e+1)*d),!x.length)continue;let t=1/0,n=-1/0,r=1/0,i=-1/0;for(let e=0;e<x.length;e+=2)t=Math.min(t,x[e]),n=Math.max(n,x[e]),r=Math.min(r,x[e+1]),i=Math.max(i,x[e+1]);S(m[e],t,n,r,i);let a=Math.min(p-1,Math.max(0,Math.floor(((t+n)/2+f)/Ir))),o=Math.min(p-1,Math.max(0,Math.floor(((r+i)/2+f)/Ir)));g[e].push(o*p+a,h[e].length,h[e].length+x.length);for(let t of x)h[e].push(t)}}}let w=[],T=new Uint8Array(p*p),E=new Int32Array(p*p),D=[];m.forEach((e,t)=>{T.fill(0);let n=w.length;for(let n=0;n<p*p;n++){if(!e[n]||T[n])continue;let r=[];for(D.push(n),T[n]=1;D.length;){let t=D.pop();r.push(t);let n=t%p,i=t/p|0;for(let t=-1;t<=1;t++)for(let r=-1;r<=1;r++){let a=n+r,o=i+t;if(a<0||o<0||a>=p||o>=p)continue;let s=o*p+a;e[s]&&!T[s]&&(T[s]=1,D.push(s))}}for(let e of r)E[e]=w.length;w.push({y0:l+t*d,y1:l+(t+1)*d,x0:1/0,x1:-1/0,z0:1/0,z1:-1/0,cx:0,cz:0,r2:0})}let r=h[t],i=g[t];for(let e=0;e<i.length;e+=3){let t=w[E[i[e]]];for(let n=i[e+1];n<i[e+2];n+=2)t.x0=Math.min(t.x0,r[n]),t.x1=Math.max(t.x1,r[n]),t.z0=Math.min(t.z0,r[n+1]),t.z1=Math.max(t.z1,r[n+1])}for(let e=n;e<w.length;e++){let t=w[e];t.x0-=.01,t.x1+=.01,t.z0-=.01,t.z1+=.01,t.cx=(t.x0+t.x1)/2,t.cz=(t.z0+t.z1)/2}for(let e=0;e<i.length;e+=3){let t=w[E[i[e]]];for(let n=i[e+1];n<i[e+2];n+=2)t.r2=Math.max(t.r2,(r[n]-t.cx)**2+(r[n+1]-t.cz)**2)}for(let e=n;e<w.length;e++)w[e].r2=(Math.sqrt(w[e].r2)+.01)**2});let O={vols:w,foot:_||i};return ti.set(s,O),O}function _i(e){let t=ni.get(e);if(t)return t;let n=e.getAttribute(`position`),r=e.getAttribute(`normal`),i=new Float32Array(n.count*3),a=new Map,o=Array(n.count);for(let e=0;e<n.count;e++){let t=`${Math.round(n.getX(e)*1e4)},${Math.round(n.getY(e)*1e4)},${Math.round(n.getZ(e)*1e4)}`;o[e]=t;let i=r?r.getX(e):0,s=r?r.getY(e):1,c=r?r.getZ(e):0,l=a.get(t);l?(l[0]+=i,l[1]+=s,l[2]+=c):a.set(t,[i,s,c])}for(let e=0;e<n.count;e++){let t=a.get(o[e]),n=Math.hypot(t[0],t[1],t[2])||1;i[e*3]=t[0]/n,i[e*3+1]=t[1]/n,i[e*3+2]=t[2]/n}let s=new Ee;return e.index&&s.setIndex(e.index),s.setAttribute(`position`,n),r&&s.setAttribute(`normal`,r),s.setAttribute(`aSmooth`,new F(i,3)),s.boundingSphere=e.boundingSphere?.clone()??null,s.boundingSphere&&(s.boundingSphere.radius+=1),ni.set(e,s),s}function vi(e){let t=ri.get(e);if(t)return t;let n=e.getAttribute(`position`),r=e.index,i=r?r.count/3:n.count/3,a=new Int32Array(n.count);for(let e=0;e<n.count;e++)a[e]=e;let o=e=>{for(;a[e]!==e;)a[e]=a[a[e]],e=a[e];return e},s=(e,t)=>{let n=o(e),r=o(t);n!==r&&(a[n]=r)},c=new Map;for(let e=0;e<n.count;e++){let t=`${Math.round(n.getX(e)*1e4)},${Math.round(n.getY(e)*1e4)},${Math.round(n.getZ(e)*1e4)}`,r=c.get(t);r===void 0?c.set(t,e):s(e,r)}let l=(e,t)=>r?r.getX(e*3+t):e*3+t;for(let e=0;e<i;e++)s(l(e,0),l(e,1)),s(l(e,1),l(e,2));let u=new Map;for(let e=0;e<i;e++){let t=o(l(e,0)),n=u.get(t);n||u.set(t,n=[]),n.push(l(e,0),l(e,1),l(e,2))}let d=[],f=new B;for(let t of u.values()){let r=new he;for(let e of t)r.expandByPoint(f.fromBufferAttribute(n,e));let i=new Ee;i.setIndex(n.count>65535?new F(new Uint32Array(t),1):new F(new Uint16Array(t),1));for(let[t,n]of Object.entries(e.attributes))i.setAttribute(t,n);i.computeBoundingSphere(),d.push({geo:i,c:r.getCenter(new B)})}return d.sort((e,t)=>(t.geo.boundingSphere?.radius??0)-(e.geo.boundingSphere?.radius??0)),ri.set(e,d),d}function yi(e,t,n){let r=Math.max(0,Math.min(1,(n-e)/(t-e)));return r*r*(3-2*r)}function bi(e){return e-Math.floor(e)}function xi(){let e=.8,t=.5,n=.6,r=[],i=0;for(let a of[-1,1])for(let o of[-1,1])for(let s of[-1,1]){let c=.16+.12*bi(Math.sin(++i*91.7)*4375.85);r.push(new B(a*e*(1-c),o*t,s*n),new B(a*e,o*t*(1-c*1.3),s*n),new B(a*e,o*t,s*n*(1-c)))}return new Le(r)}var Si=new WeakMap;function Ci(e){let t=(Array.isArray(e)?e[0]:e)?.map;if(!t)return null;if(Si.has(t))return Si.get(t)??null;let n=null;try{let e=t.image;if(e&&(e.width??0)>0&&typeof OffscreenCanvas<`u`){let r=new OffscreenCanvas(64,64).getContext(`2d`,{willReadFrequently:!0});if(r){r.drawImage(e,0,0,64,64);let i=r.getImageData(0,0,64,64).data,a=t.flipY;n=(e,t)=>{let n=Math.min(63,Math.max(0,Math.floor(bi(e)*64))),r=(Math.min(63,Math.max(0,Math.floor(bi(a?1-t:t)*64)))*64+n)*4;return .2126*i[r]+.7152*i[r+1]+.0722*i[r+2]}}}}catch{n=null}return Si.set(t,n),n}var wi={left:-80,right:56,below:13,above:12},Ti={gap:.35,marginPx:2,target:.08,half:.35,step:.02,maxLift:.6,facings:8,samples:12,minPart:12,partRadius:.25,meanTarget:.02,meanExtra:.2};function Ei(e){return e.viewH/2/Math.tan(E.degToRad(e.fovDeg/2))/e.distance}var Di=new Set([`origin`,`chest`,`head`,`hand_r`,`hand_l`,`weapon_r`,`weapon_l`,`foot_r`,`foot_l`,`weapon`]);function Oi(e){return[...new Set(Object.entries(e).filter(([e])=>!Di.has(e)).map(([,e])=>e))]}function ki(e,t,n,r={}){let i=Ae(e),a=r.scale??1;i.scale.setScalar(a),i.updateMatrixWorld(!0);let o=[];for(let e of n){let t=i.getObjectByName(Me.sanitizeNodeName(e))??i.getObjectByName(e);t&&o.push(t)}let s=o.map(e=>e.getWorldPosition(new B)),c=Ti.partRadius*a,l=o.map(()=>[]),u=o.map(()=>[]),d=new B;i.traverse(e=>{let t=e;if(!t.isMesh||!t.geometry?.attributes.position||o.length===0)return;let n=t.geometry.attributes.position,r=t.isSkinnedMesh?t.geometry.attributes.skinIndex:void 0,i=t.isSkinnedMesh?t.geometry.attributes.skinWeight:void 0;for(let e=0;e<n.count;e++){let n=t;if(r&&i){let a=0,o=-1;for(let t=0;t<4;t++){let n=i.getComponent(e,t);n>o&&(o=n,a=r.getComponent(e,t))}n=t.skeleton.bones[a]??t}t.getVertexPosition(e,d).applyMatrix4(t.matrixWorld);for(let r=0;r<o.length;r++){let i=!1;for(let e=n;e;e=e.parent)if(e===o[r]){i=!0;break}i?l[r].push({m:t,i:e}):d.distanceToSquared(s[r])<=c*c&&u[r].push({m:t,i:e})}}});let f=o.map((e,t)=>l[t].length>=Ti.minPart?l[t]:u[t]),p=r.maxPerPart??200,m=[],h=[],g=0;for(let e of f){if(e.length<Ti.minPart)continue;let t=Math.max(1,Math.ceil(e.length/p));for(let n=0;n<e.length;n+=t)m.push(e[n]),h.push(g);g++}let _=new Re(i),v=r.samples??Ti.samples,y=[];for(let e of t){_.stopAllAction();let t=_.clipAction(e);t.reset(),t.play();let n=[];for(let r=0;r<v;r++){t.time=e.duration*r/v,_.update(0),i.updateMatrixWorld(!0);let a=new Float32Array(m.length*3),o=0;for(let e of m)e.m.getVertexPosition(e.i,d).applyMatrix4(e.m.matrixWorld),a[o++]=d.x,a[o++]=d.y,a[o++]=d.z;n.push(a)}y.push(n),_.uncacheAction(e)}return _.uncacheRoot(i),{rows:y,part:Int32Array.from(h),parts:g}}function Ai(e,t,n){let r=Ei(n),i=E.degToRad(n.pitchDeg),a=Math.cos(i),o=Math.tan(i),s=(wi.below+Ti.marginPx)/(r*a),c=(wi.above+Ti.marginPx)/(r*a),l=wi.left/r,u=wi.right/r,d=Ti.facings,f=Array.from({length:e.parts},()=>[]);for(let t=0;t<e.part.length;t++)f[e.part[t]].push(t);let p=[];for(let t of e.rows){let e=[];p.push(e);for(let n of t)for(let t=0;t<d;t++){let r=2*Math.PI*t/d,i=Math.cos(r),a=Math.sin(r),s=[];for(let e of f){if(!e.length)continue;let t=[];for(let r of e){let e=r*3,s=i*n[e]+a*n[e+2];if(s<l||s>u)continue;let c=-a*n[e]+i*n[e+2];t.push(n[e+1]-c*o)}s.push({h:Float64Array.from(t).sort(),n:e.length})}e.push(s)}}let m=(e,t)=>{let n=0,r=e.length;for(;n<r;){let i=n+r>>1;e[i]<t?n=i+1:r=i}return n},h=e=>{let t=0;for(let n of p){if(!n.length)continue;let r=0;for(let t of n)for(let n of t)if(m(n.h,e+c)-m(n.h,e-s)>=Ti.half*n.n){r++;break}t=Math.max(t,r/n.length)}return t},g=e=>{let t=0;for(let n of p){if(!n.length)continue;let r=0;for(let t of n){let n=0;for(let r of t)n=Math.max(n,(m(r.h,e+c)-m(r.h,e-s))/r.n);r+=n}t=Math.max(t,r/n.length)}return t},_=h(t),v=t+Ti.maxLift+1e-9,y=t,b=_;if(b>Ti.target)for(let e=t+Ti.step;e<=v;e+=Ti.step){let t=h(e);if(t<b-1e-9&&(y=e,b=t),t<=Ti.target)break}if(b<=Ti.target){let e=Math.min(v,y+Ti.meanExtra+1e-9);for(let t=y;t<=e&&g(t)>Ti.meanTarget;t+=Ti.step)y=Math.min(t+Ti.step,e)}return{anchor:y,covered:h(y),coveredAtFloor:_}}function ji(e,t,n,r,i,a){let o=Oi(n);return!t.length||!o.length?r:Ai(ki(e,t,o,{scale:i}),r,a).anchor}var K={pitchDeg:52,fovDeg:26,distance:31,minDistance:24.5,maxDistance:36,spectatorMin:20,spectatorMax:44,zoomEaseMs:200,leash:6,edgePx:18,peekDwell:.15,peekReturn:9,peekReturnMaxS:.4,boundsInset:4},Mi=class{camera;focus=new B;mode=`locked`;spectator=!1;edgePan=!0;panSpeed=.5;shakeScale=1;reduceMotion=!1;distance=K.distance;zoomTarget=K.distance;pitch=E.degToRad(K.pitchDeg);bounds={minX:0,minZ:0,maxX:100,maxZ:100};self=null;scouting=!1;peeking=!1;returnLeft=0;edgeDwell=0;pointer={x:0,y:0,inside:!1};keyPan={x:0,z:0};shakeT=0;shakeDur=0;shakePx=0;seeded=!1;viewW=1920;viewH=1080;constructor(e=16/9){this.camera=new Te(K.fovDeg,e,1,400),this.camera.rotation.order=`YXZ`}setBounds(e,t,n=K.boundsInset){let r=Math.max(0,Math.min(n,e/4)),i=Math.max(0,Math.min(n,t/4));this.bounds={minX:r,minZ:i,maxX:e-r,maxZ:t-i}}setViewport(e,t){this.viewW=Math.max(1,e),this.viewH=Math.max(1,t),this.camera.aspect=this.viewW/this.viewH,this.camera.updateProjectionMatrix()}setSelf(e,t){if(e===null||t===null){this.self=null;return}let n=this.self===null;this.self={x:e,z:t},this.seeded?n&&!this.scouting&&(this.peeking=!1,this.focusOn(e,t)):(this.focus.set(e,0,t),this.seeded=!0)}focusOn(e,t){this.focus.set(e,0,t),this.seeded=!0,this.clamp()}centerOnSelf(){this.peeking=!1,this.self&&this.focusOn(this.self.x,this.self.z)}setMode(e){this.mode=e,e===`locked`&&this.centerOnSelf()}scout(e){this.scouting&&!e&&this.centerOnSelf(),this.scouting=e}get isScouting(){return this.scouting}setPointer(e,t,n){this.pointer.x=e,this.pointer.y=t,this.pointer.inside=n}setKeyPan(e,t){this.keyPan.x=e,this.keyPan.z=t}zoomBy(e){let t=this.spectator?K.spectatorMin:K.minDistance,n=this.spectator?K.spectatorMax:K.maxDistance;this.zoomTarget=E.clamp(this.zoomTarget+e*1.5,t,n)}setZoom(e){let t=this.spectator?K.spectatorMin:K.minDistance,n=this.spectator?K.spectatorMax:K.maxDistance;this.zoomTarget=this.distance=E.clamp(e,t,n)}get zoom(){return this.distance}shake(e,t){this.reduceMotion||this.shakeScale<=0||(this.shakePx=Math.min(4,e)*this.shakeScale,this.shakeDur=Math.min(120,t)/1e3,this.shakeT=this.shakeDur)}update(e){let t=Math.min(.1,Math.max(0,e));this.distance+=(this.zoomTarget-this.distance)*(1-Math.exp(-t/(K.zoomEaseMs/1e3/3)));let n=this.mode===`free`||this.scouting||!this.self,r=this.mode===`locked`&&!this.scouting&&this.self,i=this.keyPan.x,a=this.keyPan.z,o=0,s=0;if(this.edgePan&&this.pointer.inside){let e=K.edgePx;this.pointer.x<=e?o=-1:this.pointer.x>=this.viewW-1-e&&(o=1),this.pointer.y<=e?s=-1:this.pointer.y>=this.viewH-1-e&&(s=1)}this.edgeDwell=o!==0||s!==0?this.edgeDwell+t:0,(!r||this.edgeDwell>=K.peekDwell)&&(i+=o,a+=s);let c=i!==0||a!==0;if(c){let e=18+36*E.clamp(this.panSpeed,0,1),n=Math.hypot(i,a);this.focus.x+=i/n*e*t,this.focus.z+=a/n*e*t}if(r&&this.self){if(c)this.peeking=!0,this.returnLeft=K.peekReturnMaxS;else if(this.peeking){let e=Math.max(1-Math.exp(-t*K.peekReturn),Math.min(1,t/Math.max(this.returnLeft,.001)));this.returnLeft-=t,this.focus.x+=(this.self.x-this.focus.x)*e,this.focus.z+=(this.self.z-this.focus.z)*e,(e>=1||this.returnLeft<=0)&&(this.peeking=!1)}else this.focus.x=this.self.x,this.focus.z=this.self.z}else if(!n&&this.mode===`semi`&&this.self){let e=this.focus.x-this.self.x,t=this.focus.z-this.self.z,n=Math.hypot(e,t);n>K.leash&&(this.focus.x=this.self.x+e/n*K.leash,this.focus.z=this.self.z+t/n*K.leash)}this.clamp();let l=Math.sin(this.pitch),u=Math.cos(this.pitch),d=this.focus.x,f=this.focus.z;if(this.shakeT>0){this.shakeT=Math.max(0,this.shakeT-t);let e=this.shakePx*(this.shakeT/this.shakeDur)/82,n=this.shakeT*90;d+=Math.sin(n*1.7)*e,f+=Math.cos(n*2.3)*e}this.camera.position.set(d,this.distance*l,f+this.distance*u),this.camera.rotation.set(-this.pitch,0,0),this.camera.updateMatrixWorld()}clamp(){let e=this.bounds;this.focus.x=E.clamp(this.focus.x,e.minX,e.maxX),this.focus.z=E.clamp(this.focus.z,e.minZ,e.maxZ)}},Ni={k:30,minRate:4*Math.PI};function Pi(e,t){let n=(t-e)%(Math.PI*2);return n>Math.PI?n-=Math.PI*2:n<-Math.PI&&(n+=Math.PI*2),n}function Fi(e,t,n){let r=Pi(e,t),i=Math.abs(r);if(i<1e-4||n<=0)return n<=0?e:t;let a=Math.max(Ni.minRate*n,i*(1-Math.exp(-Ni.k*n)));return a>=i?t:e+Math.sign(r)*a}var Ii={samples:120,stanceBand:.03,minStance:6,refRange:[1.5,6]};function Li(e,t,n,r=1,i=!0){let a=i?Ae(e):e;a.scale.setScalar(r);let o=n.map(e=>a.getObjectByName(Me.sanitizeNodeName(e))??a.getObjectByName(e));if(!o.length||o.some(e=>!e))return null;let s=new Re(a),c=s.clipAction(t);c.play();let l=Ii.samples,u=o.map(()=>[]);for(let e=0;e<=l;e++)c.time=t.duration*e/l,s.update(0),a.updateMatrixWorld(!0),o.forEach((e,t)=>u[t].push(e.getWorldPosition(new B)));return c.stop(),s.uncacheRoot(a),u}function Ri(e,t){let n=t/Ii.samples,r=[];for(let t of e){let e=1/0;for(let n of t)e=Math.min(e,n.y);for(let i=0;i+1<t.length;i++)t[i].y>e+Ii.stanceBand||t[i+1].y>e+Ii.stanceBand||r.push({vx:(t[i+1].x-t[i].x)/n,vz:(t[i+1].z-t[i].z)/n})}return r}function zi(e,t,n,r=1){if(!t||n.length===0)return null;let i=Li(e,t,n,r);if(!i)return null;let a=Ri(i,t.duration);if(a.length<Ii.minStance)return null;let o=new Float64Array(a.length),s=-1,c=1/0;for(let e=Ii.refRange[0];e<=Ii.refRange[1]+1e-9;e+=.01){for(let t=0;t<a.length;t++)o[t]=Math.hypot(a[t].vx/e,1+a[t].vz/e);o.sort();let t=o[Math.floor(o.length/2)];t<c-1e-9&&(c=t,s=e)}return s>0?s:null}var Bi=1.95,Vi=4096,Hi=.4,Ui=.25,Wi=.8,Gi=.35,Ki=.6,qi=.55,Ji=.68,Yi=2,Xi=.9,Zi=new R().setStyle(`#BFD3E6`),Qi=1.5,$i=3,ea={rest:{px:1,color:mt.ink0,alpha:.6,relationTint:.18},hoverEnemy:{px:2.5,alpha:1},hoverAlly:{px:1.5,alpha:1}},ta={fill:.42,edgePx:1.5,biasM:.3},na={k:{T1:.45,T2:.7,T4:1},critMult:1.3,tauMs:70,endMs:150},ra=na.tauMs/1e3,ia=na.endMs/1e3,aa=.14,oa={crit:[`crit`,`attack2`,`attack1`],attack2:[`attack2`,`attack1`],attack1:[`attack1`,`attack2`],cast_a1:[`cast_a1`,`cast_a2`,`attack1`],cast_a2:[`cast_a2`,`cast_a1`,`attack1`],cast_a3:[`cast_a3`,`cast_a1`,`attack1`],cast_ult:[`cast_ult`,`cast_a1`,`attack1`],channel:[`channel`,`cast_a1`,`idle`],dash:[`dash`,`run`],stunned:[`stunned`,`idle`],recall:[`recall`,`channel`,`idle`],death:[`death`],run:[`run`,`idle`],idle:[`idle`],idle_lobby:[`idle_lobby`,`idle`],victory:[`victory`,`idle_lobby`,`idle`],spawn:[`spawn`,`idle`],taunt:[`taunt`,`idle`]},sa=e=>e===`structure`||e===`ward`,ca=e=>({fighter:e===`fighter`,unit:e===`minion`||e===`monster`,monster:e===`monster`}),la=new Set([`idle`,`run`,`recall`,`channel`,`stunned`,`idle_lobby`,`victory`,`taunt`]),ua=new WeakMap;function da(e){let t=ua.get(e);if(t)return t;let n=In(e,`hull`);if(!n)return e;let r=new Ee;for(let[t,n]of Object.entries(e.attributes))r.setAttribute(t,n);return r.setIndex(n),e.boundingSphere||e.computeBoundingSphere(),r.boundingSphere=e.boundingSphere,r.name=`vale_outline_lod`,ua.set(e,r),e.addEventListener(`dispose`,()=>{r.dispose(),ua.delete(e)}),r}var fa=.025,pa=/^form_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:[._]\d+)?$/i,ma=new WeakMap,ha=new M,ga=new M,_a=new t,va=new B;function ya(e){let t=[];return e.traverse(e=>{e.isMesh&&t.push(e)}),t}function ba(e){for(let t=e;t;t=t.parent)if(pa.test(t.name))return t.uuid;return``}function xa(e){return(Array.isArray(e.material)?e.material:[e.material]).some(e=>!e.transparent&&(e.blending===1||e.blending===0)&&e.depthWrite!==!1)&&!!e.geometry.getAttribute(`position`)}var Sa=new M;function Ca(e,t){let n=new Map(e.skeleton.bones.map((e,t)=>[e,t])),r=!0;for(let i=0;i<t.skeleton.bones.length;i++){let a=n.get(t.skeleton.bones[i]);if(a===void 0)return null;if(ha.multiplyMatrices(e.skeleton.boneInverses[a],e.bindMatrix).invert(),ga.multiplyMatrices(t.skeleton.boneInverses[i],t.bindMatrix),ha.multiply(ga),r){Sa.copy(ha),r=!1;continue}for(let e=0;e<16;e++)if(Math.abs(ha.elements[e]-Sa.elements[e])>.001)return null}return Sa.clone()}function wa(e,t){let n=e.length/3,r=new Int32Array(n),i=new Map,a=[];for(let o=0;o<n;o++){let n=`${Math.round(e[o*3]*1e4)},${Math.round(e[o*3+1]*1e4)},${Math.round(e[o*3+2]*1e4)}`,s=i.get(n);s===void 0&&(s=a.length/3,i.set(n,s),a.push(0,0,0)),a[s*3]+=t[o*3],a[s*3+1]+=t[o*3+1],a[s*3+2]+=t[o*3+2],r[o]=s}for(let e=0;e<n;e++){let n=r[e],i=a[n*3],o=a[n*3+1],s=a[n*3+2],c=Math.hypot(i,o,s);c>.001&&(t[e*3]=i/c,t[e*3+1]=o/c,t[e*3+2]=s/c)}}function Ta(e,t,n,r){let i=0,a=0;for(let t of e){let e=t.geometry,n=e.getAttribute(`position`).count;i+=n,a+=e.index?e.index.count:n}let o=new Float32Array(i*3),s=new Float32Array(i*3),c=n?new Uint16Array(i*4):null,l=n?new Float32Array(i*4):null,u=i>65535?new Uint32Array(a):new Uint16Array(a),d=n?new Map(t.skeleton.bones.map((e,t)=>[e,t])):null;ha.copy(t.matrix).invert();let f=0,p=0,m=!1;e.forEach((e,i)=>{let a=e.geometry,h=a.getAttribute(`position`),g=a.getAttribute(`normal`),_=n?r[i]:e===t?null:ga.multiplyMatrices(ha,e.matrix);_&&_a.getNormalMatrix(_);for(let e=0;e<h.count;e++)va.fromBufferAttribute(h,e),_&&va.applyMatrix4(_),o[(f+e)*3]=va.x,o[(f+e)*3+1]=va.y,o[(f+e)*3+2]=va.z,g?(va.fromBufferAttribute(g,e),_&&va.applyMatrix3(_a).normalize(),s[(f+e)*3]=va.x,s[(f+e)*3+1]=va.y,s[(f+e)*3+2]=va.z):m=!0;if(c&&l&&d){let t=a.getAttribute(`skinIndex`),n=a.getAttribute(`skinWeight`),r=e.skeleton.bones;for(let e=0;e<h.count;e++)for(let i=0;i<4;i++){let a=t?t.getComponent(e,i):0;c[(f+e)*4+i]=d.get(r[a])??0,l[(f+e)*4+i]=n?n.getComponent(e,i):+(i===0)}}if(a.index)for(let e=0;e<a.index.count;e++)u[p+e]=a.index.getX(e)+f;else for(let e=0;e<h.count;e++)u[p+e]=e+f;f+=h.count,p+=a.index?a.index.count:h.count});let h=new Ee;return h.setAttribute(`position`,new b(o,3)),h.setIndex(u instanceof Uint32Array?new x(u,1):new y(u,1)),m&&(h.computeVertexNormals(),s.set(h.getAttribute(`normal`).array)),wa(o,s),h.setAttribute(`normal`,new b(s,3)),c&&l&&(h.setAttribute(`skinIndex`,new y(c,4)),h.setAttribute(`skinWeight`,new b(l,4))),h.computeBoundingSphere(),h}function Ea(e){let t=ma.get(e);if(t)return t;e.updateMatrixWorld(!0);let n=ya(e),r=[];n.forEach((e,t)=>{if(!xa(e))return;let i=e.isSkinnedMesh===!0,a=i?`s|${ba(e)}`:`r|${e.parent?.uuid??``}|${pa.test(e.name)?e.uuid:ba(e)}`;for(let o of r){if(o.key!==a)continue;if(!i){o.members.push(t),o.xf.push(null);return}let r=Ca(n[o.lead],e);if(r){o.members.push(t),o.xf.push(r);return}}r.push({lead:t,members:[t],xf:[null],skinned:i,key:a})});let i=r.map(e=>{let t=0,r=0,i=e.members.map(e=>{let i=n[e].geometry,a=i.getAttribute(`position`).count,o=i.index?i.index.count:a,s={mesh:e,vo:t,io:r,n:o};return t+=a,r+=o,s});return{lead:e.lead,skinned:e.skinned,members:i,geometry:Ta(e.members.map(e=>n[e]),n[e.lead],e.skinned,e.xf)}});return ma.set(e,i),i}var Da=new WeakMap;function Oa(e,t){if(Da.has(e))return Da.get(e)??null;let n=ya(e),r=-1;n.forEach((e,t)=>{let i=e.geometry;e.isSkinnedMesh&&i.index&&i.getAttribute(`uv`)&&(r<0||i.index.count>n[r].geometry.index.count)&&(r=t)});let i=r>=0?Xn(n[r]):null;if(!i)return Da.set(e,null),null;let a=Zn(n[r].geometry,i.index,`vale_body_lod1`);Wn(a);let o=i.index.array,s=t.map(e=>{let t=Qn(e.geometry,e.members,e=>e===r?o:null),i=t?Zn(e.geometry,t,`vale_hull_lod1`):e.geometry,a=n[e.lead],s=In(i,`ink`,jn.minTris,a?.isSkinnedMesh?Yn(a):1);return{...e,geometry:i,ink:s?Zn(i,s,`vale_hull_ink`):void 0}}),c={mesh:r,geometry:a,hull:s,tris:i.tris,lodTris:i.lodTris};return Da.set(e,c),c}var ka=class{fighters=new Map;units=new Map;skins=new Map;templates=new Map;landed=new Map;patched=new WeakSet;assets;opts;onReady=null;built=[];constructor(e,t,n){this.assets=t,this.opts=n;for(let t of e.fighters)this.fighters.set(t.id,t);for(let t of e.units)this.units.set(t.id,t);for(let t of e.skins)this.skins.set(t.id,t.model)}fighter(e){return this.fighters.get(e)}unit(e){return this.units.get(e)}refsFor(e,t,n=null){let r=new Set;for(let t of e){let e=this.fighters.get(t.fighter);e&&r.add(e.art.model);let n=this.skins.get(t.skin);n&&r.add(n)}let i=n?[...new Set(n)]:[];for(let e of t){let t=this.units.get(e);if(t){if(!t.art.teamModels?.length||i.length===0)r.add(t.art.model);else for(let e of i)r.add(this.unitModelRef(t,e))}}return[...r]}unitModelRef(e,t){let n=e.art.teamModels;return t!==null&&t>=0&&n&&t<n.length?n[t]:e.art.model}patchMaterials(e,t,n){e.traverse(e=>{let r=e;if(!r.isMesh)return;r.castShadow=!0,r.receiveShadow=!0;let i=Array.isArray(r.material)?r.material:[r.material];for(let e of i)this.patched.has(e)||(this.patched.add(e),Dn(e),e.transparent&&e.side===2&&(e.forceSinglePass=!0),e.name!==n&&G(e,t))})}fighterTemplate(e,t){let n=`f:${e}:${t??``}`,r=this.templates.get(n);if(r)return r;let i=this.fighters.get(e);if(!i)return Promise.resolve(null);let a=t?this.skins.get(t):void 0;return r=(async()=>{let e=await this.assets.model(i.art.model),t=a&&a!==i.art.model?await this.assets.model(a):null,n=t?.renderable?t:e?.renderable?e:null;if(n&&e&&n!==e&&this.assets.markClipOnly(i.art.model),n){let t=new Map;for(let n of e?.gltf.animations??[])t.set(n.name,n);for(let e of n.gltf.animations)t.has(e.name)||t.set(e.name,e);this.patchMaterials(n.gltf.scene,ca(`fighter`),i.art.accentMaterial);let r=Ea(n.gltf.scene);await Nn;let a=i.art.clips,o=i.art.height*i.art.scale+Ti.gap,s=o;try{let e=[a.idle,a.run].map(e=>e?t.get(e):void 0).filter(e=>!!e);s=ji(n.gltf.scene,e,i.art.sockets,o,i.art.scale,{pitchDeg:K.pitchDeg,fovDeg:K.fovDeg,distance:K.distance,viewH:1080})}catch(e){console.warn(`[vale] bar clearance`,i.id,e)}let c;try{let e=[i.art.sockets.foot_l,i.art.sockets.foot_r].filter(e=>!!e),r=zi(n.gltf.scene,a.run?t.get(a.run):void 0,e,i.art.scale);r!==null&&r>i.art.runRefSpeed*.6&&r<i.art.runRefSpeed*1.6&&(c=r)}catch(e){console.warn(`[vale] stride`,i.id,e)}return{scene:n.gltf.scene,clips:t,roles:a,fit:1,dev:!1,hull:r,bodyLod:Oa(n.gltf.scene,r),barAnchor:s,runRef:c}}if(this.opts.dev&&this.opts.devModelUrl){let e=await this.assets.modelUrl(this.opts.devModelUrl);if(e?.renderable){let t=new Map;for(let n of e.gltf.animations)t.set(n.name,n);this.patchMaterials(e.gltf.scene,ca(`fighter`),i.art.accentMaterial);let n={};for(let e of t.keys())n[e]=e;return{scene:e.gltf.scene,clips:t,roles:n,fit:i.art.height/Bi,dev:!0,hull:Ea(e.gltf.scene)}}}return null})().then(e=>this.ready(e,i.art.accentMaterial,ca(`fighter`))).then(e=>this.land(n,r,e)),this.templates.set(n,r),r}ready(e,t,n,r=!1){if(e&&!this.built.some(t=>t.t===e)){e.scene.traverse(e=>{let t=e;t.isSkinnedMesh&&!t.geometry.boundingSphere&&t.geometry.computeBoundingSphere()});let i={t:e,accentName:t,char:n,structure:r};r&&e.scene.traverse(e=>{let n=e;if(n.isMesh)for(let e of Array.isArray(n.material)?n.material:[n.material])e.name!==t&&ui(e)}),this.built.push(i),this.warm(i,!1)}return e}land(e,t,n){return this.templates.get(e)===t&&this.landed.set(e,n),n}release(e){let t=0;for(let[n,r]of[...this.landed]){let i=new Set;r&&H(r,i);let a=!1;for(let t of i)if(e.has(t)){a=!0;break}if(!a){if(lt(i,e),this.landed.delete(n),this.templates.delete(n),r){let e=this.built.findIndex(e=>e.t===r);e>=0&&this.built.splice(e,1)}t++}}return t}collectInUse(e){for(let t of this.landed.values())t&&H(t,e)}get pending(){return this.templates.size-this.landed.size}warmAll(){for(let e of this.built)this.warm(e,!0)}warm(e,t){let n=e.t,r=[];n.scene.traverse(t=>{let i=t;if(i.isMesh&&!Array.isArray(i.material)&&i.material.name===e.accentName){if(!n.warmAccent){let t=i.material.clone();G(t,e.char),e.structure&&ui(t),n.warmAccent=t}r.push([i,i.material]),i.material=n.warmAccent}});try{this.onReady?.(n.scene,n.crowd??null,t)}finally{for(let[e,t]of r)e.material=t}}unitTemplate(e,t=null){let n=this.units.get(e);if(!n)return Promise.resolve(null);let r=this.unitModelRef(n,t),i=`u:${e}:${r}`,a=this.templates.get(i);return a||(a=(async()=>{let t=await this.assets.model(r);if(!t?.renderable&&r!==n.art.model)return this.unitTemplate(e,null);if(t?.renderable){let e=new Map;for(let n of t.gltf.animations)e.set(n.name,n);this.patchMaterials(t.gltf.scene,ca(n.kind),`accent`);let r={...n.art.clips};for(let t of e.keys())t in r||(r[t]=t);let i=Ea(t.gltf.scene);n.art.instanced&&await Nn;let a=n.art.instanced&&this.opts.crowd!==!1?or(t.gltf.scene,e,i,`accent`,Vi,n.kind===`monster`):null;return{scene:t.gltf.scene,clips:e,roles:r,fit:1,dev:!1,hull:i,crowd:a}}return this.opts.dev?ja(n):null})().then(e=>this.ready(e,`accent`,ca(n.kind),sa(n.kind))).then(e=>this.land(i,a,e)),this.templates.set(i,a),a)}},Aa=null;function ja(e){Aa??=(()=>{let e=new Pe({color:new R().setStyle(`#8C877C`),roughness:.8});return e.name=`dev_clay`,G(e),e})();let t=new Pe({color:2236962,roughness:.6});t.name=`accent`;let n=new _;n.name=`dev_placeholder`;let r=Math.max(.4,e.art.height),i=Math.max(.2,e.collisionRadius||.4);if(e.kind===`structure`){let e=[new O(i*1.05,0),new O(i*1.05,.5),new O(i*.8,.7),new O(i*.55,r*.75),new O(i*.38,r*.92),new O(.02,r)],a=new I(new A(e,10),Aa),o=new I(new We(i*.6,i*.62,.3,10,1,!0),t);o.position.y=r*.62,n.add(a,o)}else if(e.kind===`pickup`||e.kind===`ward`){let e=new I(new je(Math.min(.35,r*.35),0),t);e.position.y=r*.6,n.add(e)}else{let e=new I(new _e(i*.75,Math.max(.05,r-i*1.5),3,8),Aa);e.position.y=r/2;let a=new I(new We(i*.78,i*.78,.12,8,1,!0),t);a.position.y=r*.78,n.add(e,a)}return n.traverse(e=>{e.isMesh&&(e.castShadow=!0,e.receiveShadow=!0)}),{scene:n,clips:new Map,roles:{},fit:1,dev:!0,hull:Ea(n)}}function Ma(e,t,n){let r=t-e;for(;r>Math.PI;)r-=Math.PI*2;for(;r<-Math.PI;)r+=Math.PI*2;return e+r*n}function Na(e){return .2126*e.r+.7152*e.g+.0722*e.b}var Pa={on:!0,chains:!0},Fa={breath:{period:2.8,chest:.028,shoulder:.03,neck:.012},shift:{period:6.2,spine:.052,head:-.034},look:{period:9.3,yaw:.06,nod:.018},arms:{upper:.04,fore:.045},stun:{spine:.075,chest:.055,head:.09},recoil:{perM:2,max:.2,rise:.05,settle:.11},chain:{tau:.04,hangTau:.075,maxStep:.21,maxDev:.52},still:{eps:.0015,after:.15,gain:1.8,rise:4,fall:.8,tau:.25,hold:2.8},fade:5},Ia=new De,La=new B,Ra=new De,za=class{bones=new Map;chains=[];applied=!1;t;wIdle=0;wHold=0;wStun=0;recT=-1;recA=0;recAxis=new B;hands=[];handPrev=[new B,new B];handInit=!1;stillT=0;fid=0;mvAvg=0;constructor(e,t,n){this.t=n*1.6180339%97,e.updateMatrixWorld(!0);let r=e.getWorldQuaternion(new De).invert(),i=new De;for(let e of[`spine`,`chest`,`neck`,`head`,`shoulder.L`,`shoulder.R`,`upper_arm.L`,`upper_arm.R`,`forearm.L`,`forearm.R`]){let n=t.getObjectByName(Me.sanitizeNodeName(e))??t.getObjectByName(e);n&&n.parent&&(n.parent.getWorldQuaternion(i),i.premultiply(r).invert(),this.bones.set(e,{o:n,saved:n.quaternion.clone(),x:new B(1,0,0).applyQuaternion(i),y:new B(0,1,0).applyQuaternion(i),z:new B(0,0,1).applyQuaternion(i)}))}for(let e of[`hand.L`,`hand.R`]){let n=t.getObjectByName(Me.sanitizeNodeName(e))??t.getObjectByName(e);n&&this.hands.push(n)}t.traverse(e=>{let t=/^x_[a-z]+[a-z0-9]*(?:_[a-z0-9]+)*_(\d+)$/i.exec(e.name);t?this.chains.push({o:e,shown:new De,tau:Fa.chain.tau*(1+.6*(Number(t[1])-1)),init:!1}):/^x_(?:hang_[lr]|cord|cord_swing|mantle_[lr]|lantern)$/i.test(e.name)&&this.chains.push({o:e,shown:new De,tau:Fa.chain.hangTau,init:!1})})}get ok(){return this.bones.has(`spine`)&&this.bones.has(`head`)}restore(){if(this.applied){for(let e of this.bones.values())e.o.quaternion.copy(e.saved);this.applied=!1}}recoil(e,t,n){let r=Math.hypot(e,t);r<1e-4||n<=0||(this.recAxis.set(t/r,0,-e/r),this.recA=Math.min(Fa.recoil.max,n*Fa.recoil.perM),this.recT=0)}rot(e,t,n,r){let i=this.bones.get(e);if(!i)return;La.set(0,0,0).addScaledVector(i.x,t).addScaledVector(i.y,n).addScaledVector(i.z,r);let a=La.length();a<1e-6||(Ia.setFromAxisAngle(La.multiplyScalar(1/a),a),i.o.quaternion.premultiply(Ia))}apply(e,t){let n=Fa.chain,r=n.maxStep*Math.max(1,t*60);if(Pa.chains)for(let e of this.chains){let i=e.o.parent;if(i.updateWorldMatrix(!0,!1),i.getWorldQuaternion(Ra),Ia.copy(Ra).multiply(e.o.quaternion),!e.init||t<=0||t>.25){e.shown.copy(Ia),e.init=!0;continue}let a=e.shown.angleTo(Ia);if(a<1e-5)continue;e.shown.slerp(Ia,Math.min(1-Math.exp(-t/e.tau),r/a));let o=e.shown.angleTo(Ia);o>n.maxDev&&e.shown.slerp(Ia,Math.min(o-n.maxDev,r)/o),e.o.quaternion.copy(Ra.invert()).multiply(e.shown)}else for(let e of this.chains)e.init=!1;if(!Pa.on){this.recT=-1,this.fid=0,this.mvAvg=0,this.handInit=!1;return}if(this.t+=t,this.hands.length===2&&t>0&&t<.25){let e=Fa.still,n=0;for(let e=0;e<2;e++)this.hands[e].updateWorldMatrix(!0,!1),La.setFromMatrixPosition(this.hands[e].matrixWorld),this.handInit&&(n=Math.max(n,La.distanceTo(this.handPrev[e])/Math.max(1,t*60))),this.handPrev[e].copy(La);this.handInit&&(this.mvAvg+=(n-this.mvAvg)*Math.min(1,t/e.tau),this.stillT=Math.min(n,this.mvAvg)<e.eps?this.stillT+t:0),this.handInit=!0,this.fid=this.stillT>e.after?Math.min(1,this.fid+t*e.rise):Math.max(0,this.fid-t*e.fall)}let i=Math.min(1,t*Fa.fade),a=+(e===`idle`),o=+(e===`channel`||e===`recall`),s=+(e===`stunned`);this.wIdle+=(a-this.wIdle)*i,this.wHold+=(o-this.wHold)*i,this.wStun+=(s-this.wStun)*i;let c=0;if(this.recT>=0){this.recT+=t;let e=Fa.recoil;c=this.recT<e.rise?this.recT/e.rise:Math.exp(-(this.recT-e.rise)/e.settle)*Math.cos((this.recT-e.rise)*9),this.recT>e.rise+e.settle*4&&(this.recT=-1,c=0),c*=this.recA}let l=this.wIdle,u=this.wHold,d=this.wStun;if(l+u+d<.001&&c===0)return;for(let e of this.bones.values())e.saved.copy(e.o.quaternion);this.applied=!0;let f=Math.PI*2,p=this.t,m=Fa.breath,h=Fa.shift,g=Fa.look,_=Fa.arms,v=Fa.stun,y=Math.sin(f*p/m.period),b=Math.sin(f*p/m.period-.5),x=l+1.35*u,S=l+.5*u,C=l+.5*u,w=Math.sin(f*p/h.period)+.25*Math.sin(f*p/(h.period*.43)+1.3),T=Math.sin(f*p/1.3),E=Math.sin(f*p/1.7+.5),D=Math.sin(f*p/1.1+1),O=this.recAxis.x*c,ee=this.recAxis.z*c;this.rot(`spine`,.6*O+d*v.chest*.5*E,0,S*h.spine*w+d*v.spine*T+.6*ee),this.rot(`chest`,-x*m.chest*y+d*v.chest*E+.45*O,0,.45*ee),this.rot(`neck`,x*m.neck*b+C*g.nod*Math.sin(f*p/(g.period*.47)),C*g.yaw*Math.sin(f*p/g.period+1),0),this.rot(`head`,-.35*O,d*v.head*.6*E,S*h.head*w+d*v.head*D-.35*ee),this.rot(`shoulder.L`,0,0,x*m.shoulder*Math.max(0,b)),this.rot(`shoulder.R`,0,0,-x*m.shoulder*Math.max(0,b));let k=(l+.6*u)*(1+Fa.still.gain*this.fid);this.rot(`upper_arm.L`,k*_.upper*Math.sin(f*p/m.period+.6),0,0),this.rot(`upper_arm.R`,k*_.upper*Math.sin(f*p/m.period+2.2),0,0),this.rot(`forearm.L`,k*_.fore*Math.sin(f*p/m.period+1.1),0,0),this.rot(`forearm.R`,k*_.fore*Math.sin(f*p/m.period+2.9),0,0);let te=u*this.fid*Fa.still.hold;if(te>.001){let e=te*_.upper*Math.sin(f*p/m.period+.3),t=te*_.fore*Math.sin(f*p/(m.period*.57)+1.3);this.rot(`upper_arm.L`,e,0,0),this.rot(`upper_arm.R`,e,0,0),this.rot(`forearm.L`,t,0,0),this.rot(`forearm.R`,t,0,0)}}},Ba=class{id;kind;def;team;owner;root=new _;model=null;dev=!1;barHeight=2.2;artHeight=1.9;radius=.5;runRef=3.6;attackWindup=.3;px=0;py=0;ph=0;pf=0;cx=0;cy=0;ch=0;cf=0;x=0;y=0;h=0;facing=0;turnSnap=!0;seenTick=-1;view=null;visible=!0;leaving=-1;trail=1;trailFrom=1;trailHoldUntil=-1;lastHpFrac=1;mixer=null;template=null;actions=new Map;current=null;currentKey=``;lastStateTime=0;accent=[];accentColor=new R;accentHex=``;glow=Wi;sockets=new Map;socketNames={};outlineU=null;flashU=null;inkMats=[];hullMeshes=[];flashMeshes=[];hullParts=[];xrayU=null;xrayMeshes=[];xrayOn=!1;outlinePx=-1;outlineColor=new R;outlineOpacity=-1;warm=0;flashT=-1;flashK0=0;wobT=-1;wobK=0;wobSquash=0;wobDir=new O;baseScale=1;life=null;animAcc=0;disposed=!1;constructor(e){this.id=e.id,this.kind=e.kind,this.def=e.def,this.team=e.team,this.owner=e.owner,this.root.name=`actor_${e.kind}_${e.id}`,this.px=this.cx=this.x=e.x,this.py=this.cy=this.y=e.y,this.ph=this.ch=this.h=e.height,this.pf=this.cf=this.facing=e.facing,this.radius=e.radius;let t=this.root;t.updateMatrixWorld=e=>{this.culled||_.prototype.updateMatrixWorld.call(t,e)}}culled=!1;configureFighter(e){this.artHeight=e.art.height*e.art.scale,this.barHeight=this.artHeight+.35,this.runRef=e.art.runRefSpeed,this.attackWindup=e.attack.windup,this.socketNames=e.art.sockets}configureUnit(e){this.artHeight=e.art.height*e.art.scale,this.barHeight=this.artHeight+.35,this.runRef=Math.max(.5,e.base.moveSpeed??3),this.attackWindup=e.attack?.windup??.3,this.castHold.clear(),e.abilities.forEach((e,t)=>{let n=e.effects?.find(e=>e.op===`area`&&(e.delay??0)>0);n&&this.castHold.set(`cast_a${t+1}`,n.delay??0)})}attach(e,t,n){if(this.disposed||!e)return;if(this.template=e,this.dev=e.dev,this.kind===`fighter`&&e.barAnchor!==void 0&&(this.barHeight=e.barAnchor),this.kind===`fighter`&&e.runRef!==void 0&&(this.runRef=e.runRef),e.crowd){let n=new _;n.name=`crowd_body`,n.position.copy(e.crowd.rootPos),n.quaternion.copy(e.crowd.rootQuat),n.scale.setScalar(t*e.fit),this.crowdBake=e.crowd,this.accent=[],this.formNodes=new Map,this.shownForm=void 0,this.model=n,this.baseScale=t*e.fit,this.root.add(n),this.mixer=new cr(e.crowd),this.accentHex=``;return}let r=e.clips.size>0||Va(e.scene)?Ae(e.scene):e.scene.clone(!0),i=this.kind===`fighter`&&Ln.body?e.bodyLod??null:null;if(this.hullParts=i?i.hull:e.hull,i){let e=ya(r)[i.mesh];e&&(e.geometry=i.geometry)}let a=t*e.fit;if(r.scale.setScalar(a),this.accent=[],r.traverse(e=>{let t=e;if(!t.isMesh)return;if(t.isSkinnedMesh){t.frustumCulled=!1;let e=t.geometry.boundingSphere;e&&(t.boundingSphere=e.clone())}let r=(Array.isArray(t.material)?t.material:[t.material]).map(e=>{if(e.name!==n)return e;let t=e.clone();return G(t,ca(this.kind)),this.kind!==`structure`&&sa(this.kind)&&ui(t),this.accent.push(t),t});t.material=Array.isArray(t.material)?r:r[0]}),this.formNodes=new Map,r.traverse(e=>{let t=/^form_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:[._]\d+)?$/i.exec(e.name);if(!t)return;let n=t[1].toLowerCase();(this.formNodes.get(n)??this.formNodes.set(n,[]).get(n)).push(e)}),this.shownForm=void 0,Ha(r),this.model=r,this.baseScale=a,this.buildHull(r,e),on(r),Kn(r),this.root.add(r),e.clips.size>0&&(this.mixer=new Re(r)),this.kind===`fighter`&&e.clips.size>0){let e=new za(this.root,r,this.id);this.life=e.ok?e:null}for(let[e,t]of Object.entries(this.socketNames)){let n=r.getObjectByName(Me.sanitizeNodeName(t))??r.getObjectByName(t);n&&this.sockets.set(e,n)}this.accentHex=``}formNodes=new Map;shownForm=void 0;applyForm(e){if(e===this.shownForm||this.formNodes.size===0)return;this.shownForm=e;let t=e&&this.formNodes.has(e)?e:`base`;for(let[e,n]of this.formNodes)for(let r of n)r.visible=e===t}socket(e,t){let n=this.sockets.get(e);return n?(n.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(n.matrixWorld)):t.set(this.x,this.h+this.artHeight*.55,this.y)}pushTick(e,t){if(this.view=e,this.applyForm(e.form??null),this.team=e.team,this.owner=e.owner,this.radius=e.radius,this.seenTick<0)this.px=this.cx=e.x,this.py=this.cy=e.y,this.ph=this.ch=e.height,this.pf=this.cf=e.facing,this.turnSnap=!0;else{let t=Math.hypot(e.x-this.cx,e.y-this.cy)>$i;t&&(this.turnSnap=!0),t?(this.px=e.x,this.py=e.y,this.ph=e.height,this.pf=e.facing):(this.px=this.cx,this.py=this.cy,this.ph=this.ch,this.pf=this.cf),this.cx=e.x,this.cy=e.y,this.ch=e.height,this.cf=e.facing}this.seenTick=t}setAccentColor(e,t){if(e!==this.accentHex){this.accentHex=e,this.accentColor.copy(t);for(let e of this.accent)e.color.copy(t).multiplyScalar(.3),e.emissive.copy(t),e.emissiveIntensity=this.glow}}update(t,n,r=0){let i=Math.max(0,Math.min(1,n));this.x=this.px+(this.cx-this.px)*i,this.y=this.py+(this.cy-this.py)*i,this.h=this.ph+(this.ch-this.ph)*i;let a=Ma(this.pf,this.cf,i);if(this.facing=this.turnSnap||this.kind===`structure`?a:Fi(this.facing,a,t),this.turnSnap=!1,this.root.position.set(this.x,this.h,this.y),this.root.rotation.y=Math.PI/2-this.facing,this.leaving>=0){this.leaving+=t;let e=Math.min(1,this.leaving/.6);this.root.position.y-=e*e*.5}let o=this.view;if(!o)return;let s=o.state===`cast`&&o.stateDuration>0?Math.min(1,(o.stateTime+i*e)/Math.max(.05,o.stateDuration)):0,c=Math.max(Qi,1.35/Math.max(.05,Na(this.accentColor))),l=o.alive&&s>0?Wi+(c-Wi)*Math.min(1,s*1.6):Wi;this.glow+=(l-this.glow)*Math.min(1,t*18);for(let e of this.accent)e.emissiveIntensity=this.veilMode===3?this.glow*Ji:this.glow;if(this.tickReactions(t),this.mixer&&this.template){if(this.animAcc=Math.min(1,this.animAcc+t),r===2||r===1&&this.animAcc<.06656666666666666)return;let e=this.animAcc;this.animAcc=0,this.animate(o,e,i)}}clipFor(e){let t=this.template,n=e=>{let n=t.roles[e];return n&&t.clips.get(n)||t.clips.get(e)||null};for(let t of oa[e]??[e,`idle`]){let e=n(t);if(e)return e}return null}ownClip(e){let t=this.template;if(!t)return!1;let n=t.roles[e];return!!(n&&t.clips.get(n)||t.clips.get(e))}action(e){let t=this.actions.get(e);if(t)return t;let n=this.clipFor(e);return!n||!this.mixer?null:(t=this.mixer.clipAction(n),la.has(e)||e===`run`||e===`idle`?t.setLoop(ie,1/0):(t.setLoop(ae,1),t.clampWhenFinished=!0),this.actions.set(e,t),t)}roleOf(e){switch(e.state){case`idle`:return`idle`;case`move`:return`run`;case`attack`:return e.anim===`crit`||e.anim===`attack2`?e.anim:`attack1`;case`cast`:return e.anim&&e.anim!==`cast`?e.anim:`cast_a1`;case`channel`:return`channel`;case`dash`:return e.anim===`stunned`?`stunned`:e.anim||`dash`;case`stunned`:return`stunned`;case`dead`:return`death`;case`recall`:return`recall`;default:return`idle`}}castHold=new Map;hold=null;castTrack=null;instantCast(e){this.mixer&&this.action(e)&&(this.hold={role:e,t:.13,impact:Ui,still:!0},this.castTrack=null)}animate(t,n,r){this.life?.restore();let i=this.roleOf(t),a=this.castHold.get(i);if(t.state===`cast`&&a!==void 0)!this.hold||this.hold.role!==i||t.stateTime<this.hold.t-.25?this.hold={role:i,t:t.stateTime,impact:Math.max(.05,t.stateDuration)+a}:this.hold.t=t.stateTime,this.castTrack=null;else if(t.state===`cast`&&i.startsWith(`cast_`))this.castTrack={role:i,t:t.stateTime,impact:t.stateDuration>.02?t.stateDuration:.25},this.hold=null;else if(t.state===`attack`)this.castTrack={role:i,t:t.stateTime,impact:Math.max(.05,this.attackWindup*(t.stateDuration||1))},this.hold=null;else if(this.castTrack&&!this.hold&&t.state===`idle`&&(this.hold={...this.castTrack,still:!0}),this.castTrack=null,this.hold){this.hold.t+=n;let e=this.action(this.hold.role)?.getClip(),r=this.hold.impact/Hi*+!!e;(t.state===`idle`||!this.hold.still&&t.state===`move`)&&this.hold.t<r?i=this.hold.role:this.hold=null}let o=t.stateTime+1e-6<this.lastStateTime;this.lastStateTime=t.stateTime;let s=i,c=this.current,l=!!this.hold&&t.state!==`cast`&&i===this.hold.role;if(s!==this.currentKey||o&&!l&&!la.has(i)&&i!==`run`&&i!==`death`){let e=this.action(i);if(e){let t=i.startsWith(`attack`)||i===`crit`?.06:.1;e.reset(),e.enabled=!0,e.setEffectiveWeight(1),this.current&&this.current!==e?e.crossFadeFrom(this.current,t,!1):e.fadeIn(t),e.play(),c=e}this.current=c,this.currentKey=s}if(c){let n=c.getClip().duration||1,a=Math.max(0,t.stateTime+(t.state===`dead`?0:r*e));if(i===`run`){let e=Math.hypot(t.vx,t.vy);c.timeScale=Math.max(.35,Math.min(2.2,e/Math.max(.1,this.runRef)))}else if((i.startsWith(`attack`)||i===`crit`)&&t.state===`attack`){let e=Math.max(.05,this.attackWindup*(t.stateDuration||1));c.timeScale=0,c.time=Math.min(n-.001,Hi*n*a/e)}else if(this.hold&&i===this.hold.role)c.timeScale=0,c.time=Math.min(n-.001,this.hold.t*(Hi*n)/this.hold.impact);else if(i.startsWith(`cast_`)&&t.state===`cast`){let e=t.stateDuration>.02?t.stateDuration:.25;c.timeScale=0,c.time=Math.min(n-.001,Hi*n*a/e)}else t.state===`dash`&&i!==`stunned`&&t.stateDuration>0||i===`recall`&&t.state===`recall`&&t.stateDuration>0&&this.ownClip(`recall`)?(c.timeScale=0,c.time=Math.min(n-.001,a/t.stateDuration*n)):c.timeScale=1}this.mixer.update(n),this.life?.apply(t.alive?i:`death`,n)}pose(e,t){if(this.mixer&&this.template){if(this.currentKey!==e){let t=this.action(e);t&&(t.reset(),t.setLoop(ie,1/0),t.enabled=!0,t.setEffectiveWeight(1),this.current&&this.current!==t?t.crossFadeFrom(this.current,.2,!1):t.fadeIn(.2),t.play(),this.current=t),this.currentKey=e}this.tickReactions(t),this.life?.restore(),this.mixer.update(t),this.life?.apply(e,t)}}buildHull(e,t){if(!this.hullParts.length)return;let n=ya(e),r=this.outlineU=Wt(),i=this.flashU=Kt();Ln.outline&&(i.uBias.value=fa);let a={},o=e=>{let t=a[e];return t||(t=a[e]=[Gt(e,r),qt(e,i)],this.inkMats.push(...t)),t};for(let e of this.hullParts){let t=n[e.lead];if(!t)continue;let r=o(e.skinned&&t.isSkinnedMesh?`skin`:`rigid`);for(let n of[!1,!0]){let i=n?r[1]:r[0],a=e.ink??(Ln.outline?da(e.geometry):e.geometry),o;if(e.skinned&&t.isSkinnedMesh){let n=t,r=new u(a,i);r.bind(n.skeleton,n.bindMatrix),r.frustumCulled=!1,e.geometry.boundingSphere||e.geometry.computeBoundingSphere(),r.boundingSphere=e.geometry.boundingSphere.clone(),o=r}else o=new I(a,i);o.name=n?`vale_flash`:`vale_outline`,o.userData.valeOutline=!0,o.castShadow=!1,o.receiveShadow=!1,o.renderOrder=n?2:1,o.matrixAutoUpdate=!1,t.add(o),(n?this.flashMeshes:this.hullMeshes).push(o)}}this.warm=2,this.outlinePx=-1,this.applyOutline();for(let e of this.flashMeshes)e.visible=!0;this.kind===`fighter`&&this.buildXray(n)}buildXray(e){let t=this.xrayU=Jt();t.uAlpha.value=ta.fill,t.uPx.value=ta.edgePx,t.uBias.value=ta.biasM;let n={};for(let r of this.hullParts){let i=e[r.lead];if(!i)continue;let a=r.skinned&&i.isSkinnedMesh?`skin`:`rigid`,o=n[a];o||(o=n[a]=Yt(a,t),this.inkMats.push(o));let s=r.ink??(Ln.outline?da(r.geometry):r.geometry),c;if(a===`skin`){let e=i,t=new u(s,o);t.bind(e.skeleton,e.bindMatrix),t.frustumCulled=!1,r.geometry.boundingSphere||r.geometry.computeBoundingSphere(),t.boundingSphere=r.geometry.boundingSphere.clone(),c=t}else c=new I(s,o);c.name=`vale_xray`,c.userData.valeOutline=!0,c.userData.valeXray=!0,c.castShadow=!1,c.receiveShadow=!1,c.renderOrder=-2,c.matrixAutoUpdate=!1,c.visible=!1,i.add(c),this.xrayMeshes.push(c)}}setXray(e,t=null){let n=e&&this.xrayMeshes.length>0;if(n&&t&&this.xrayU.uColor.value.copy(t),n!==this.xrayOn){this.xrayOn=n;for(let e of this.xrayMeshes)e.visible=n}}get xray(){return this.xrayOn}crowdBake=null;get accentKey(){return this.accentHex}get accentTint(){return this.accentColor}get glowLevel(){return this.glow}get restOutline(){return this.restOut.px=Math.max(0,this.outlinePx),this.restOut.opacity=this.outlineOpacity,this.restOut}restOut={px:0,color:this.outlineColor,opacity:0};get flashState(){return this.flashOut.k=this.flashK,this.flashOut.rim=this.flashInk?this.flashRim:null,this.flashOut}flashOut={k:0,color:new R,rim:null};crowdPose(e){this.mixer instanceof cr?this.mixer.pose(e):(e.a=e.b=0,e.w=1)}setOutline(e,t,n=1){(this.outlineU||this.crowdBake)&&(e===this.outlinePx&&n===this.outlineOpacity&&t.equals(this.outlineColor)||(this.outlinePx=e,this.outlineOpacity=n,this.outlineColor.copy(t),this.applyOutline()))}hideOutline(){this.setOutline(0,this.outlineColor,0)}veilMode=0;veilMats=new Map;veilBase=new Map;veilDepth=[];veilDepthMats=[];get veil(){return this.veilMode}setVeil(e){if(e===this.veilMode||!this.model||this.crowdBake)return;this.veilMode=e;let t=e!==0,n=e===1?Gi:e===3?qi:Ki;t&&!this.veilDepth.length&&this.hullParts.length&&this.buildVeilDepth(this.model);let r=this.veilDepth.length>0;for(let e of this.veilDepth)e.visible=t;let i=new Set(this.accent),a=(e,t)=>On(e,t*n,!r);this.model.traverse(n=>{let r=n;if(!r.isMesh||r.userData.valeOutline)return;if(!t){let e=this.veilBase.get(r);e&&(r.material=e,r.castShadow=!0);return}let o=this.veilBase.get(r)??r.material;this.veilBase.set(r,o),r.castShadow=!1;let s=t=>{if(i.has(t))return t;let n=this.veilMats.get(t);return n||(n=t.clone(),G(n,ca(this.kind)),this.veilMats.set(t,n)),n.color.copy(t.color).multiplyScalar(e===3?Ji:1),a(n,t.transparent?t.opacity:1),n};r.material=Array.isArray(o)?o.map(s):s(o)});for(let e of this.accent)t?a(e,1):kn(e);this.applyOutline()}buildVeilDepth(e){let t=ya(e).filter(e=>!e.userData.valeOutline),n={};for(let e of this.hullParts){let r=t[e.lead];if(!r)continue;let i=e.skinned&&r.isSkinnedMesh?`skin`:`rigid`,a=n[i];a||(a=n[i]=Xt(i),this.veilDepthMats.push(a));let o;if(i===`skin`){let t=r,n=new u(e.geometry,a);n.bind(t.skeleton,t.bindMatrix),n.frustumCulled=!1,e.geometry.boundingSphere||e.geometry.computeBoundingSphere(),n.boundingSphere=e.geometry.boundingSphere.clone(),o=n}else o=new I(e.geometry,a);o.name=`vale_veil_depth`,o.userData.valeOutline=!0,o.castShadow=!1,o.receiveShadow=!1,o.renderOrder=50,o.matrixAutoUpdate=!1,r.add(o),this.veilDepth.push(o)}}get outlineWidth(){return this.hoverPx>0?this.hoverPx:Math.max(0,this.outlinePx)}setHover(e,t){this.hoverPx=this.outlineU||this.crowdBake?Math.max(0,e):0,t&&this.hoverColor.copy(t)}hoverPx=0;hoverColor=new R;hoverTarget(){return this.hoverPx<=0||!this.model||!this.root.visible||this.disposed||this.crowdBake?null:{model:this.model,mask:this.flashMeshes,hull:this.hullMeshes,px:this.hoverPx,color:this.hoverColor}}get hoverWidth(){return this.hoverPx}get hoverTint(){return this.hoverColor}applyOutline(){let e=this.outlineU;if(!e)return;let t=this.veilMode,n=t===1?0:t===2&&this.outlinePx>0?Math.max(Yi,this.outlinePx):this.outlinePx,r=n>0;e.uPx.value=Math.max(0,n),t===2?e.uColor.value.copy(Zi):e.uColor.value.copy(this.outlineColor),e.uAlpha.value=r?t===2?Xi:this.outlineOpacity:0;let i=r||this.warm>0;for(let e of this.hullMeshes)e.visible=i}flash(e,t,n=null){let r=this.flashU;if((r||this.crowdBake)&&e>0&&!(e<(this.flashT>=0?this.flashK0*Math.exp(-this.flashT/ra):0))&&(this.flashT=0,this.flashFresh=!0,this.flashK0=e,this.flashOut.color.copy(t),this.flashInk=!!n,n&&this.flashRim.copy(n),this.setFlashK(e),r)){r.uFlashColor.value.copy(t),r.uFlashInk.value=+!!n,n&&r.uFlashRim.value.copy(n);for(let e of this.flashMeshes)e.visible=!0}}flashFresh=!1;flashK=0;flashInk=!1;flashRim=new R;setFlashK(e){this.flashK=e,this.flashU&&(this.flashU.uFlashK.value=e)}boostFlash(e){return this.flashT<0||this.flashT>.05||!this.flashU&&!this.crowdBake?!1:(this.flashK0=Math.min(1.2,this.flashK0*e),this.setFlashK(this.flashK0*Math.exp(-this.flashT/ra)),!0)}get flashLevel(){return this.flashK}flinch(e,t,n,r){let i=Math.hypot(e,t);if(i>1e-4?this.wobDir.set(e/i,t/i):this.wobDir.set(0,0),this.wobT=0,this.wobK=Math.min(.15,n),this.wobSquash=Math.min(.3,r),this.life&&i>1e-4&&n>0){let r=-this.root.rotation.y,i=Math.cos(r),a=Math.sin(r);this.life.recoil(e*i+t*a,-e*a+t*i,n)}}hidden(){if(this.flashT>=0&&(this.flashT=-1,this.setFlashK(0),this.warm<=0))for(let e of this.flashMeshes)e.visible=!1;this.wobT>=0&&(this.wobT=-1,this.model?.scale.setScalar(this.baseScale))}tickReactions(e){if(this.warm>0&&--this.warm===0&&(this.applyOutline(),this.flashT<0))for(let e of this.flashMeshes)e.visible=!1;if(this.flashT>=0){if(this.flashFresh?this.flashFresh=!1:this.flashT+=e,this.flashT>ia){if(this.flashT=-1,this.setFlashK(0),this.warm<=0)for(let e of this.flashMeshes)e.visible=!1}else this.setFlashK(this.flashK0*Math.exp(-this.flashT/ra))}if(this.wobT>=0){this.wobT+=e;let t=this.wobT/aa,n=t>=1?0:Math.sin(Math.PI*Math.sqrt(t));if(t>=1&&(this.wobT=-1),this.root.position.x+=this.wobDir.x*this.wobK*n,this.root.position.z+=this.wobDir.y*this.wobK*n,this.model){let e=this.wobSquash*n,t=this.baseScale;this.model.scale.set(t*(1+e*.5),t*(1-e),t*(1+e*.5))}}}dispose(){this.disposed=!0,this.mixer?.stopAllAction(),this.mixer&&this.model&&this.mixer.uncacheRoot(this.model),this.mixer=null,this.model?.traverse(e=>{let t=e;t.isSkinnedMesh&&t.skeleton.dispose()});for(let e of this.accent)e.dispose();for(let e of this.veilMats.values())e.dispose();for(let e of this.veilDepthMats)e.dispose();for(let e of this.inkMats)e.dispose();this.root.removeFromParent()}};function Va(e){let t=!1;return e.traverse(e=>{e.isSkinnedMesh&&(t=!0)}),t}function Ha(e){let t=[];e.traverse(e=>{let n=e;if(!n.isSkinnedMesh)return;let r=n.skeleton;for(let e of t){let t=e.skeleton;if(t===r)return;if(t.bones.length!==r.bones.length||!t.bones.every((e,t)=>e===r.bones[t]))continue;let i=!0;for(let e=0;e<r.bones.length&&i;e++)if(ha.copy(t.boneInverses[e]).invert().multiply(r.boneInverses[e]).multiply(n.bindMatrix),e===0)ga.copy(ha);else for(let e=0;e<16&&i;e++)i=Math.abs(ha.elements[e]-ga.elements[e])<1e-4;if(i){r.dispose(),n.skeleton=t,n.bindMatrix.copy(ga),n.bindMatrixInverse.copy(ga).invert();return}}t.push(n)})}function Ua(e,t){return e.unitHex(t.team,t.owner,t.kind===`fighter`)}var Wa={1:na.k.T1,2:na.k.T2,4:na.k.T4},Ga=new Set([`fighter`,`minion`,`monster`,`summon`]),Ka=.25,qa=class{tier=new Map;reduceMotion=!1;cPhysical=new R().setStyle(mt.physical);cMagic=new R().setStyle(mt.magic);cShade=new R().setStyle(mt.trueDmg);cShadeRim=new R().setStyle(mt.noonwhite);cShield=new R().setStyle(mt.shield);hits=new Map;struck=new Map;now=0;instantRole=new Map;constructor(e){for(let t of e.fighters){let e=[t.kit,...Object.values(t.kit.passive.forms??{}).map(e=>e.kit??{})];for(let t of e)for(let e of[`a1`,`a2`,`a3`,`ult`]){let n=t[e];if(!n)continue;let r=e===`ult`?4:2;this.tier.set(n.id,r),n.recast&&this.tier.set(n.recast.ability.id,r);let i=e===`ult`?`cast_ult`:`cast_${e}`;for(let e of n.recast?[n,n.recast.ability]:[n]){if((e.castTime??0)>.02)continue;let t=e.present?.anim;(!t||t.startsWith(`cast_`))&&this.instantRole.set(e.id,t??i)}}this.tier.set(t.kit.passive.id,1)}}handle(e,t,n=this.now){this.now=n;let r=this.hits;r.clear();for(let n of e){if(n.e===`cast`&&n.castTime<=.02){let e=this.instantRole.get(n.ability),r=e?t.get(n.src):void 0;r&&e&&r.visible&&r.leaving<0&&r.instantCast(e);continue}if(n.e!==`damage`)continue;let e=t.get(n.dst);if(!e||!e.visible||e.leaving>=0||!e.model)continue;let i=n.ability?this.tier.get(n.ability)??2:1,a=Wa[i]*(n.crit?na.critMult:1),o=e.view?.maxHp??0;n.ability&&o>0&&n.amount<o*.02&&(a*=.7);let s=n.src>=0?t.get(n.src):void 0;e.kind===`minion`&&s?.kind===`minion`&&(a*=.75);let c=r.get(n.dst);if(c&&c.k>=a)continue;let l=n.shielded>0&&n.amount-n.shielded<=1e-6,u=l?this.cShield:n.dtype===`true`?this.cShade:n.dtype===`magic`?this.cMagic:this.cPhysical;r.set(n.dst,{k:a,color:u,rim:!l&&n.dtype===`true`?this.cShadeRim:null,src:n.src,cls:i,crit:n.crit})}for(let[e,i]of r){let r=t.get(e);r.flash(Math.min(1.2,i.k),i.color,i.rim),this.struck.set(e,{t:n,color:i.color,rim:i.rim});let a=i.src>=0?t.get(i.src):void 0;if(!this.reduceMotion&&Ga.has(r.kind)){let e=a?r.x-a.x:0,t=a?r.y-a.y:0;r.flinch(e,t,.03+.05*i.k,.02+.04*i.k)}}}feel(e,t,n=this.now){if(this.now=Math.max(this.now,n),!(e.hitFlash>0||e.squash>0))return;let r=null,i=null,a=2.25;for(let[n,o]of this.struck){if(this.now-o.t>Ka){this.struck.delete(n);continue}let s=t.get(n);if(!s||!s.visible||s.leaving>=0||!s.model)continue;let c=(s.x-e.at.x)**2+(s.y-e.at.z)**2;c<a&&(a=c,r=s,i=o)}r&&i&&(e.hitFlash>0&&!r.boostFlash(e.hitFlash)&&r.flash(Math.min(1.2,Wa[2]*e.hitFlash),i.color,i.rim),e.squash>0&&!this.reduceMotion&&Ga.has(r.kind)&&r.flinch(0,0,0,e.squash))}};new B;var Ja=1.3,Ya=.9,Xa=Ja,Za={uLiftA:new T(Array.from({length:4},()=>new a)),uLiftB:new T(Array.from({length:4},()=>new a)),uExpo:new T(1),uBreath:new T(0),uAspect:new T(16/9),uSat:new T(1),uVal:new T(1),uDistort:new T(null),uDistortOn:new T(0)},Qa=.066,$a=.05,eo=.06,to=1.45,no=new B,ro=new B,io=new B;function ao(e,t,n){if(n.lift=0,n.global=1,n.desat=0,t<0)return!0;let r=Math.min(e.peak,to)-1,i=e.peak-1;if(t<Qa)return n.global=e.dip,!0;let a=t-Qa;if(a<$a)return n.lift=i,n.desat=e.desat,!0;if(a-=$a,a<eo){let t=a/eo,o=t*t*(3-2*t);return n.lift=i+(r-i)*o,n.desat=e.desat*(1-o),!0}return a-=eo,a<e.hold?(n.lift=r,!0):(a-=e.hold,n.lift=r*.5**(a/Math.max(.03,e.half)),n.lift>.01)}var oo=new class{reduceMotion=!1;distortAllowed=!0;pulses=[];dead=!1;grade=0;env={lift:0,global:1,desat:0};pulse(e,t,n={}){let r=Math.max(1,n.peak??2.4),i={pos:e.clone(),radius:Math.max(.5,t),t:-(n.delay??0),peak:this.reduceMotion?1+(r-1)*.5:r,hold:n.hold??.28,half:n.fade??.12,dip:this.reduceMotion?1:n.dip??.92,desat:n.desat??.35};this.pulses.push(i),this.pulses.length>4&&this.pulses.shift()}setDead(e){this.dead=e}get active(){return this.pulses.length}update(e,t,n){let r=Za;r.uAspect.value=n;let i=+!!this.dead,a=this.reduceMotion?1/.12:this.dead?1/.4:1/.3;this.grade=i>this.grade?Math.min(i,this.grade+e*a):Math.max(i,this.grade-e*a);let o=this.grade*this.grade*(3-2*this.grade);r.uSat.value=1-o,r.uVal.value=1-.15*o;let s=1,c=0;for(let t=this.pulses.length-1;t>=0;t--){let n=this.pulses[t];n.t+=e,ao(n,n.t,this.env)||this.pulses.splice(t,1)}for(let e=0;e<4;e++){let i=r.uLiftA.value[e],a=r.uLiftB.value[e],o=this.pulses[e];if(!o||!t){i.set(0,0,0,0),a.set(0,0,0,0);continue}ao(o,o.t,this.env),no.copy(o.pos).project(t),io.set(1,0,0).applyQuaternion(t.quaternion).multiplyScalar(o.radius),ro.copy(o.pos).add(io).project(t);let l=no.z>1||no.z<-1,u=no.x*.5+.5,d=no.y*.5+.5,f=Math.hypot((ro.x-no.x)*.5*n,(ro.y-no.y)*.5),p=!l&&u>-f/n&&u<1+f/n&&d>-f&&d<1+f;i.set(u,d,Math.max(.02,f),p?this.env.lift:0),a.set(p?this.env.desat:0,0,0,0),p&&(s*=this.env.global,c=Math.max(c,this.env.lift))}r.uExpo.value=s,r.uBreath.value=c>0&&!this.reduceMotion?.05:0}reset(){this.pulses.length=0,this.dead=!1,this.grade=0;let e=Za;for(let t of e.uLiftA.value)t.set(0,0,0,0);for(let t of e.uLiftB.value)t.set(0,0,0,0);e.uExpo.value=1,e.uBreath.value=0,e.uSat.value=1,e.uVal.value=1,e.uDistortOn.value=0}},so=(t,n)=>t+Math.max(0,Math.ceil(n/e-1e-6)-1)*e,co=(t,n)=>t+Math.max(1,Math.ceil(n/e-1e-6))*e,lo=new Set([`heal`,`shield`]),uo=/"op":"(damage|status|displace|pull)"/,fo=[`stun`,`root`,`slow`,`silence`,`disarm`,`airborne`,`taunt`,`fear`,`sleep`,`haste`,`invisible`,`untargetable`,`unstoppable`,`reveal`,`grievous`,`armor_shred`,`resist_shred`],po={stun:3,root:3,silence:3,disarm:3,airborne:3,taunt:3,fear:3,sleep:3,slow:2,invisible:2,untargetable:2,unstoppable:2,reveal:2,haste:1,grievous:1,armor_shred:1,resist_shred:1},mo=(e,t)=>e*32+Math.max(0,fo.indexOf(t));function ho(e,t,n,r,i){let a=r?.kind===`cone`?(r.radius??0)*.6:r?.kind===`rect`?(r.length??0)*.5:0;return i.set(e+Math.cos(n)*a,0,t+Math.sin(n)*a)}var go=.12,_o={peak:2.4,hold:.28,fade:.12,dip:.92,desat:.35},vo={peak:1.7,hold:.2,fade:.14,dip:.95,desat:.2},yo=3.5,bo=8,xo=.12;function So(e){if(!e)return null;switch(e.kind){case`circle`:return{kind:`circle`,radius:e.radius};case`ring`:return{kind:`ring`,radius:e.radius,inner:e.inner};case`cone`:return{kind:`cone`,radius:e.radius,angle:e.angleDeg*Math.PI/180};case`rect`:return{kind:`rect`,length:e.length,width:e.width};default:return null}}var Co=e=>e.filter?.enemies!==!1&&uo.test(JSON.stringify(e)),wo=(e,t,n=.001)=>{if(!e||!t||e.kind!==t.kind)return!1;let r=(e,t)=>Math.abs((e??0)-(t??0))<=n*Math.max(1,Math.abs(e??0));return r(e.radius,t.radius)&&r(e.length,t.length)&&r(e.width,t.width)&&r(e.inner,t.inner)&&r(e.angle,t.angle)};function To(e){let t=e.targeting?.kind??`none`;if(t!==`point`&&t!==`self`&&t!==`direction`&&t!==`none`&&t!==`unit`)return[];let n=e.effects??[],r=[],i=null,a=e=>(e.op===`area`||e.op===`zone`)&&(e.at===`point`||e.at===`self`||t===`unit`&&e.at===`target`);for(let e of n)if(a(e))r.push(e);else if(e.op===`repeat`)for(let t of e.effects??[])a(t)&&r.push(t);else!i&&e.op===`dash`&&(e.mode===`toPoint`||e.mode===`direction`||t===`unit`&&e.mode===`toTarget`)&&(i=e);let o=[];if(i)for(let e of i.onArrive??[])(e.op===`area`||e.op===`zone`)&&e.at!==`hit`&&(e.at!==`target`||t===`unit`)&&o.push(e);let s=e.present?.telegraph,c=e=>e.present?.telegraph??s??((e.delay??0)>0?`everyone`:`none`),l=(e,t)=>{let n=c(e);return n===`none`||n===`ally_only`&&!((e.delay??0)>0)?!1:Co(e)||e.present?.telegraph===`everyone`||!t&&(e.delay??0)>0},u=So(e.targeting?.indicator),d=[],f=i?{toPoint:i.mode===`toPoint`,toTarget:i.mode===`toTarget`,distance:Math.max(0,i.distance??0),speed:Math.max(.1,i.speed??10)}:null;if(i&&f){let e=o.filter(e=>l(e,!1));for(let t of e){let e=So(t.shape),n=u&&(u.kind===`circle`||u.kind===`ring`)&&e&&u.kind===e.kind?u:e;n&&d.push({shape:n,anchor:t.at===`target`?`target`:`land`,delay:Math.max(0,t.delay??0),dash:f,vis:c(t)===`ally_only`?`ally_only`:`everyone`,match:e})}if(!e.length&&!f.toTarget&&(s===`everyone`||s===`ally_only`)){let e=u&&u.kind===`rect`?u:{kind:`rect`,length:f.distance,width:Math.max(.6,(i.passWidth??.5)*2)};d.push({shape:e,anchor:`aim`,delay:0,dash:f,vis:s===`ally_only`?`ally_only`:`everyone`,match:null})}}let p=r.filter(e=>l(e,!0));p.length||(p=r.filter(e=>l(e,!1)));for(let e of p){let n=So(e.shape),r=u&&n&&u.kind===n.kind&&Math.abs((u.radius??u.length??0)-(n.radius??n.length??0))<=.2*Math.max(.001,n.radius??n.length??1)||!n?u??n:n;if(!r)continue;let i=e.at===`self`||t===`self`||t===`none`,a=e.at===`target`?`target`:r.kind===`cone`||r.kind===`rect`?i?`aim`:`point`:i?`caster`:`point`,o=Math.max(0,e.delay??0);d.some(e=>e.anchor===a&&e.delay===o&&wo(e.shape,r))||d.push({shape:r,anchor:a,delay:o,dash:null,vis:c(e)===`ally_only`?`ally_only`:`everyone`,match:n})}return!d.length&&u&&s===`everyone`&&!i&&t!==`unit`&&d.push({shape:u,anchor:u.kind===`cone`||u.kind===`rect`?`aim`:t===`self`||t===`none`?`caster`:`point`,delay:0,dash:null,vis:`everyone`,match:null}),d}var Eo=class{abilities=new Map;attackHit=new Map;element=new Map;signature=new Map;clipRoles=new Map;vfx;host;telegraphs=[];lastCast=new Map;eventVfx={};statusVfx={};tmpA=new B;tmpB=new B;tmpC=new B;zonesSeen=new Set;passives=new Set;passiveLast=new Map;windups=[];statusFx=new Map;statusSrc=new Map;lastHit=new Map;lastPulse=new Map;castAt=new Map;beats=new Map;recallFx=new Map;zoneTele=new Map;noonReveal=new Map;seals=new Map;momentView=null;momentT=0;gorgeSeen=0;constructor(e,t,n){this.vfx=t,this.host=n;for(let t of e.modes)t.rules.noonToll&&this.noonReveal.set(t.id,t.rules.noonToll.reveal);for(let t of e.modes)t.rules.dawnSeal&&this.seals.set(t.id,{units:new Set(t.rules.dawnSeal.units),until:t.rules.dawnSeal.until});let r=(e,t)=>{if(this.abilities.has(e.id))return;let n=Array.isArray(e.effects)&&e.effects.some(e=>lo.has(e.op??``))&&!e.effects.some(e=>e.op===`damage`),r=(e.castTime??0)>0&&Array.isArray(e.effects)&&(uo.test(JSON.stringify(e.effects))||e.present?.telegraph===`everyone`)?To(e):[];this.abilities.set(e.id,{vfx:e.present?.vfx,hitVfx:e.present?.hitVfx,windupVfx:e.present?.windupVfx,telegraph:e.present?.telegraph,tier:t,heal:n,cast:r}),this.collectZones(e.effects,e.present?.telegraph)};for(let t of e.fighters){this.element.set(t.id,new R().setStyle(t.palette.primary)),t.vfx&&this.signature.set(t.id,{sig:new R().setStyle(t.vfx.signature),sec:new R().setStyle(t.vfx.secondary)}),this.attackHit.set(t.id,{vfx:t.attack.present?.vfx,hitVfx:t.attack.present?.hitVfx,windupVfx:t.attack.present?.windupVfx}),this.clipRoles.set(t.id,new Set(Object.entries(t.art.clips??{}).filter(([,e])=>!!e).map(([e])=>e)));let e=[t.kit,...Object.values(t.kit.passive.forms??{}).map(e=>e.kit??{})];for(let t of e)for(let e of[`a1`,`a2`,`a3`,`ult`]){let n=t[e];n&&(r(n,e===`ult`?4:2),n.recast&&r(n.recast.ability,e===`ult`?4:2))}r({id:t.kit.passive.id,present:t.kit.passive.present},1),this.passives.add(t.kit.passive.id)}for(let t of e.items)t.active&&r(t.active,2);for(let t of e.setup.spells)r(t,2);for(let t of e.units){this.attackHit.set(t.id,{vfx:t.attack?.present?.vfx,hitVfx:t.attack?.present?.hitVfx,windupVfx:t.attack?.present?.windupVfx});for(let e of t.abilities)r(e,t.kind===`monster`?3:2)}}collectZones(e,t){if(Array.isArray(e))for(let n of e){if(!n||typeof n!=`object`)continue;let e=n;e.op===`zone`&&e.id&&!this.zoneTele.has(e.id)&&this.zoneTele.set(e.id,e.present?.telegraph??t??(Co(e)?`everyone`:`ally_only`));for(let e of Object.values(n))Array.isArray(e)&&e.length&&typeof e[0]==`object`&&this.collectZones(e,t)}}colorFor(e,t,n){let r=this.host.palette(),i=e?e.kind===`fighter`:!1,a=r.relation(t,n,i);return{c:r.unitColor(t,n,i||n>=0&&e?.kind!==`minion`),rel:a}}elementOf(e){return e&&e.kind===`fighter`?this.host.skinTint(e)??this.element.get(e.def)??null:null}signatureOf(e){if(!e)return null;let t=e;if(e.kind!==`fighter`){if(e.owner<0||e.kind!==`summon`&&e.kind!==`projectile`&&e.kind!==`zone`)return null;let n=this.host.view(),r=n?.players.find(t=>t.player===e.owner);if(t=r&&n?n.entity(r.entity):void 0,!t||t.kind!==`fighter`)return null}let n=this.signature.get(t.def)??null,r=this.host.skinSignature?.(t)??null;return r?{sig:r.sig,sec:r.sec,base:n?.sig}:n}swingClip(e,t){let n=t?`crit`:e.anim===`attack2`?`attack2`:`attack1`,r=this.clipRoles.get(e.def);return r?(oa[n]??[n]).find(e=>r.has(e))??n:n}fire(e,t,n,r){if(!e||!this.vfx.has(e))return 0;let i=this.host.view()?.entity(t),a=i?i.team:-1,o=i?i.owner:-1,{c:s,rel:c}=this.colorFor(i,a,o),l=this.signatureOf(i);return this.vfx.spawnHandle(e,{tier:n,team:s,element:this.elementOf(i),signature:l?.sig??null,secondary:l?.sec??null,hueFrom:l?.base??null,ally:c===`ally`,ownT1:c===`self`&&n<=1,origin:r.origin??null,target:r.target??null,ground:r.ground??null,scale:r.scale,dir:r.dir,follow:r.follow,followFor:r.followFor,targetId:r.targetId,sourceId:t,anchor:r.anchor,loopWhile:r.loopWhile,sustain:r.sustain,timeScale:r.timeScale,phase:r.phase,world:r.world,clip:r.clip})}worldMoments(e){let t=e.gorgeWind??0;if(e!==this.momentView){this.momentView=e,this.momentT=e.time,this.gorgeSeen=t;return}let n=this.momentT,r=e.time;this.momentT=r;let i=this.seals.get(e.mode),a=this.eventVfx.sealBreak;if(i&&a&&n<i.until&&r>=i.until){let t=this.tmpB;for(let n of e.entities)n.kind===`structure`&&n.alive&&i.units.has(n.def)&&(this.host.bodyPos(n.id,t)||t.set(n.x,1,n.y),this.fire(a,n.id,2,{origin:t,ground:this.tmpC.set(n.x,0,n.y),anchor:`origin`}))}t>this.gorgeSeen&&this.eventVfx.gorgeGust&&(this.host.viewFocus?.(this.tmpC)||this.host.plateAt?.(this.tmpC))&&this.fire(this.eventVfx.gorgeGust,-1,2,{origin:this.tmpC,ground:this.tmpC,anchor:`origin`,world:!0}),this.gorgeSeen=t}srcVisible(e,t){let n=e.entity(t);return!!n&&this.host.entityVisible(n)}pulse(e,t,n,r=_o,i=0){let a=this.host.now();return a+i-(this.lastPulse.get(e)??-1e9)<.6?!1:(this.lastPulse.set(e,a+i),this.vfx.exposurePulse(t,n,{...r,delay:i}),!0)}handle(e){let t=this.host.view();if(!t)return;this.worldMoments(t);let n=this.host.palette(),r=this.tmpA,i=this.tmpB,a=this.tmpC;this.lastHit.clear();for(let o of e)switch(o.e){case`cast`:{let e=t.entity(o.src);e&&this.lastCast.set(o.src,{x:o.x,y:o.y,t:this.host.now(),slot:o.slot,ability:o.ability});let n=this.abilities.get(o.ability);if((o.slot===`ult`?4:n?.tier??0)>=4&&this.castAt.set(`${o.src}|${o.ability}`,o.t),e&&n&&n.cast.length&&o.castTime>0&&this.windupTelegraph(t,e,o,n.cast,n.heal),!e||!this.host.entityVisible(e))break;let i=o.slot===`ult`?4:n?.tier??2;if(!this.host.bodyPos(o.src,r))break;let a=Math.atan2(o.y-e.y,o.x-e.x);n?.vfx&&this.fire(n.vfx,o.src,i,{origin:r,ground:r,dir:a,anchor:`origin`}),this.windupVfx(e,o,n,i,a);break}case`attack`:{let e=t.entity(o.src);if(!e||!this.host.entityVisible(e))break;let n=this.attackHit.get(e.def)?.windupVfx,i=n?this.vfx.def(n):void 0;if(!n||!i||!this.host.bodyPos(o.src,r))break;let a=t.entity(o.dst),s=a?Math.atan2(a.y-e.y,a.x-e.x):e.facing,c=co(o.t,o.windup),l=this.fire(n,o.src,o.crit?2:1,{origin:r,ground:r,dir:s,anchor:`origin`,targetId:o.dst,scale:o.crit?2:1,timeScale:i.duration/Math.max(.05,c-o.t),clip:this.swingClip(e,o.crit)});l>0&&this.windups.push({h:l,src:o.src,castEnd:o.t+o.windup,rel:c,attack:!0});break}case`projectile`:{let e=t.entity(o.src),n=t.entity(o.id);if(!(e&&this.host.entityVisible(e)||n&&this.host.entityVisible(n)))break;let i=o.ability===`attack`?e?.kind===`structure`?3:1:this.abilities.get(o.ability)?.tier??2;this.host.bodyPos(o.src,r)||r.set(n?n.x:0,1,n?n.y:0);let a=o.vfx??(o.ability===`attack`&&e?this.attackHit.get(e.def)?.vfx:void 0);a&&this.vfx.has(a)&&this.fire(a,o.src,i,{origin:r,follow:o.id,anchor:`path`,dir:n?Math.atan2(n.vy,n.vx):0});break}case`hit`:{if(this.lastHit.set(o.dst,o.src),!o.vfx)break;let e=t.entity(o.dst);if(!e||!this.host.entityVisible(e))break;let n=o.ability?this.abilities.get(o.ability):void 0;this.host.bodyPos(o.dst,i),this.host.bodyPos(o.src,r)||r.copy(i),this.fire(o.vfx,o.src,n?.tier??2,{origin:r,target:i,ground:i,targetId:o.dst,anchor:`target`,dir:Math.atan2(i.z-r.z,i.x-r.x)}),(n?.tier??0)>=4&&!this.vfx.def(o.vfx)?.hasExposure&&this.queuePulse(o.src,o.ability,o.vfx,a.set(i.x,.5,i.z),1.8,0,!1);break}case`proc`:{let e=this.passives.has(o.ability)?this.abilities.get(o.ability):void 0,n=o.vfx&&this.vfx.has(o.vfx)?o.vfx:e?.vfx;if(!n)break;let a=o.on===`interval`||o.on===`moveDistance`,s=o.dst??o.src,c=a?`${o.ability}:${o.src}`:`${o.ability}:${s}`,l=this.host.now(),u=t.entity(s);if(!u||!this.host.entityVisible(u)||l-(this.passiveLast.get(c)??-1e9)<(a?6:.4))break;this.passiveLast.set(c,l),this.host.bodyPos(s,i),this.host.bodyPos(o.src,r)||r.copy(i),this.fire(n,o.src,1,{origin:r,target:i,ground:i,targetId:s,anchor:`target`,dir:Math.atan2(i.z-r.z,i.x-r.x)});break}case`damage`:{if(this.lastHit.set(o.dst,o.src),o.ability)break;let e=t.entity(o.src),n=t.entity(o.dst);if(!e||!n||!this.host.entityVisible(n))break;let a=this.attackHit.get(e.def);this.host.bodyPos(o.dst,i),this.host.bodyPos(o.src,r)||r.copy(i),a?.hitVfx&&this.fire(a.hitVfx,o.src,1,{origin:r,target:i,ground:i,targetId:o.dst,anchor:`target`,dir:Math.atan2(i.z-r.z,i.x-r.x)}),o.crit&&this.eventVfx.crit&&this.fire(this.eventVfx.crit,o.src,2,{origin:r,target:i,ground:i,anchor:`target`});break}case`area`:{let e=t.entity(o.src),i=e?e.team:-1,s=e?e.owner:-1,c=this.host.visibleAt(o.x,o.y)||!!e&&this.host.entityVisible(e),l=this.abilities.get(o.ability),u=this.lastCast.get(o.src),d=u&&Math.hypot(u.x-o.x,u.y-o.y)>.05&&e?Math.atan2(u.y-e.y,u.x-e.x):e?e.facing:0,f=!(e&&Math.hypot(o.x-e.x,o.y-e.y)>.3&&o.shape&&(o.shape.kind===`cone`||o.shape.kind===`rect`))||!e?d:u&&Math.hypot(u.x-o.x,u.y-o.y)>.05?Math.atan2(u.y-o.y,u.x-o.x):Math.atan2(o.y-e.y,o.x-e.x),p=o.telegraph,m=n.relation(i,s,e?.kind===`fighter`),h=p===`everyone`||p===`ally_only`&&(m===`ally`||m===`self`||n.viewer.team<0),g=this.host.now(),_=h?this.telegraphs.find(e=>e.stage!==void 0&&e.src===o.src&&e.ability===o.ability&&(!e.tele?.match||wo(e.tele.match,o.shape))):void 0;if(_?(_.stage=void 0,_.follow=void 0,o.shape&&(_.x=o.x,_.y=o.y,_.dir=f,_.shape=o.shape),_.land=Math.max(_.start,g+Math.max(0,o.delay)),_.end=_.land+.15):c&&h&&o.shape&&this.telegraphs.push({x:o.x,y:o.y,dir:f,shape:o.shape,start:g,land:g+Math.max(0,o.delay),end:g+Math.max(0,o.delay)+.15,src:o.src,team:i,owner:s,zone:-1,heal:!!l?.heal}),!c||!o.vfx)break;let v=o.shape?o.shape.radius??(o.shape.length??2)*.5:1,y=(l?.tier??2)>=4?4:o.delay>0||p===`everyone`?3:l?.tier??2;if(this.matchZone(t,o)>=0){y>=4&&!this.vfx.def(o.vfx)?.hasExposure&&this.queuePulse(o.src,o.ability,o.vfx,ho(o.x,o.y,f,o.shape,a).setY(.4),Math.max(1.5,v),Math.max(0,o.delay),!0);break}a.set(o.x,0,o.y),o.shape?.kind===`rect`&&o.shape.length&&a.set(o.x+Math.cos(f)*o.shape.length*.5,0,o.y+Math.sin(f)*o.shape.length*.5),this.host.bodyPos(o.src,r)||r.copy(a);let b=o.vfx,x=r.clone(),S=a.clone(),C=()=>{this.fire(b,o.src,y,{origin:x,ground:S,scale:v,dir:f,anchor:`ground`})};o.delay>0?this.delayed.push({at:this.host.now()+o.delay,run:C}):C(),y>=4&&!this.vfx.def(b)?.hasExposure&&this.queuePulse(o.src,o.ability,b,ho(o.x,o.y,f,o.shape,new B).setY(.4),Math.max(1.5,v),Math.max(0,o.delay),!0);break}case`dash`:{let e=t.entity(o.src);if(this.dashTelegraph(t,o),!e||!this.host.entityVisible(e)||!o.vfx)break;r.set(o.fromX,1,o.fromY),this.fire(o.vfx,o.src,3,{origin:r,ground:r,follow:o.src,followFor:o.duration+.05,anchor:`path`,dir:Math.atan2(o.toY-o.fromY,o.toX-o.fromX)});break}case`blink`:{let e=t.entity(o.src);if(!e||!this.host.entityVisible(e)||!this.eventVfx.blink)break;r.set(o.fromX,1,o.fromY),i.set(o.toX,1,o.toY),this.fire(this.eventVfx.blink,o.src,3,{origin:r,ground:r,anchor:`origin`}),this.fire(this.eventVfx.blink,o.src,3,{origin:i,ground:i,anchor:`origin`});break}case`status`:{let e=this.lastHit.get(o.dst);e!==void 0&&e!==o.dst&&this.statusSrc.set(mo(o.dst,o.status),e);break}case`heal`:{let e=t.entity(o.dst);if(!this.eventVfx.heal||!e||!this.host.entityVisible(e)||o.amount<e.maxHp*.05)break;this.host.bodyPos(o.dst,i),this.fire(this.eventVfx.heal,o.src,2,{origin:i,target:i,ground:i,targetId:o.dst,anchor:`target`});break}case`shield`:{let e=t.entity(o.dst);if(!this.eventVfx.shield||!e||!this.host.entityVisible(e))break;this.host.bodyPos(o.dst,i),this.fire(this.eventVfx.shield,o.dst,2,{origin:i,target:i,ground:i,targetId:o.dst,anchor:`target`});break}case`death`:{let e=t.entity(o.dst);if(!e||!this.host.entityVisible(e))break;if(this.host.bodyPos(o.dst,i),o.kind===`structure`)this.eventVfx.structureFall&&this.fire(this.eventVfx.structureFall,o.dst,4,{origin:i.setY(.5),ground:i,scale:1.5,anchor:`origin`,world:!0}),this.host.shake(4,120),this.pulse(o.dst,a.set(i.x,.5,i.z),4,vo);else{let n=o.kind===`fighter`?this.eventVfx.death:o.kind===`monster`?this.eventVfx.monsterDeath??this.eventVfx.unitDeath:this.eventVfx.unitDeath;this.fire(n,o.dst,o.kind===`fighter`?3:1,{origin:i,target:i,ground:i,anchor:`origin`});let r=o.kind===`fighter`?this.eventVfx.bounty:this.eventVfx.lastHit,a=r&&o.killer>=0?t.entity(o.killer):void 0;r&&a&&a.kind===`fighter`&&this.colorFor(a,a.team,a.owner).rel===`self`&&this.fire(r,a.id,2,{origin:i,target:i,ground:i,anchor:`origin`,dir:Math.atan2(a.y-e.y,a.x-e.x)})}break}case`respawn`:case`levelUp`:{let e=t.players.find(e=>e.player===o.player);if(!e)break;let n=t.entity(o.e===`respawn`?o.entity:e.entity);if(!n||!this.host.entityVisible(n))break;let r=o.e===`respawn`?this.eventVfx.respawn:this.eventVfx.levelUp;this.host.bodyPos(n.id,i),o.e===`respawn`&&i.set(n.x,1,n.y),this.fire(r,n.id,2,{origin:i,ground:i,target:i,anchor:`origin`});break}case`recall`:{let e=t.players.find(e=>e.player===o.player);if(!e)break;if(o.state===`start`){this.startRecall(t,e.entity);break}let n=this.recallFx.get(e.entity);n!==void 0&&(this.recallFx.delete(e.entity),this.vfx.release(n,o.state===`cancel`));let r=t.entity(e.entity);if(o.state!==`done`||!this.eventVfx.recall||!r||!this.host.entityVisible(r))break;i.set(r.x,xo,r.y),this.fire(this.eventVfx.recall,r.id,2,{origin:i,ground:i,anchor:`origin`,phase:`release`});break}case`announce`:{if(o.key!==`noon_toll`)break;let e=this.noonReveal.get(t.mode)??5,n=this.eventVfx.noonToll;if(n&&this.vfx.has(n)){let r=(this.vfx.def(n)?.duration??e)/e;for(let a of t.players){let o=t.entity(a.entity);o&&o.alive&&(i.set(o.x,0,o.y),this.fire(n,o.id,2,{origin:i,ground:i,follow:o.id,followFor:e,anchor:`origin`,timeScale:r}))}}this.eventVfx.noonTollPlate&&this.host.plateAt?.(a)&&this.fire(this.eventVfx.noonTollPlate,-1,2,{origin:a,ground:a,anchor:`origin`,world:!0});break}case`pickup`:{if(!this.eventVfx.pickup||!this.host.visibleAt(o.x,o.y))break;let e=t.players.find(e=>e.player===o.player);i.set(o.x,.6,o.y),this.fire(this.eventVfx.pickup,e?e.entity:-1,2,{origin:i,ground:i,anchor:`origin`});break}}for(let e of this.pulseQ.values())this.beat(e);this.pulseQ.clear()}pulseQ=new Map;queuePulse(e,t,n,r,i,a,o){let s=this.pulseQ.get(e);s&&(s.area&&!o||s.area===o&&s.delay>=a)||this.pulseQ.set(e,{src:e,ability:t??``,repeat:n?this.vfx.def(n)?.beatRepeat??0:0,at:r.clone(),radius:i,delay:a,area:o})}beat(e){let t=Math.min(yo,e.radius);if(!e.ability){this.pulse(e.src,e.at,t,_o,e.delay);return}let n=`${e.src}|${e.ability}`,r=this.castAt.get(n),i=`${n}|${r??`unseen`}`,a=this.host.now(),o=this.beats.get(i);if(o===void 0||r===void 0&&a-o>bo){this.pulse(e.src,e.at,t,_o,e.delay)&&this.beats.set(i,a);return}if(!(e.repeat>0))return;let s=e.repeat,c=_o;this.pulse(e.src,e.at,t,{peak:1+(c.peak-1)*s,hold:c.hold*s,fade:c.fade,dip:1-(1-c.dip)*s,desat:c.desat*s},e.delay)}windupTelegraph(e,t,n,r,i){let a=this.host.palette(),o=a.relation(t.team,t.owner,t.kind===`fighter`),s=o===`ally`||o===`self`||a.viewer.team<0;for(let e=this.telegraphs.length-1;e>=0;e--)this.telegraphs[e].stage===`windup`&&this.telegraphs[e].src===t.id&&this.telegraphs.splice(e,1);let c=n.x-t.x,l=n.y-t.y,u=Math.hypot(c,l),d=n.target!==void 0&&n.target>=0?e.entity(n.target):void 0,f=this.host.now();for(let e of r){if(e.vis===`ally_only`&&!s)continue;let r=u>.001?Math.atan2(l,c):t.facing,a=n.x,o=n.y,p=0,m=e.shape;if(e.anchor===`target`){if(!d)continue;a=d.x,o=d.y;let n=Math.hypot(d.x-t.x,d.y-t.y);n>.001&&(r=Math.atan2(d.y-t.y,d.x-t.x)),e.dash&&(p=Math.min(e.dash.distance>0?e.dash.distance:n,Math.max(0,n-t.radius-d.radius))/e.dash.speed)}else if(e.dash){let n=e.dash.toPoint?Math.min(e.dash.distance,u):e.dash.distance;p=n/e.dash.speed,e.anchor===`land`?(a=t.x+Math.cos(r)*n,o=t.y+Math.sin(r)*n):m.kind===`rect`&&(m={...m,length:Math.max(.5,n)})}if((e.anchor===`caster`||e.anchor===`aim`)&&(a=t.x,o=t.y),!(this.host.entityVisible(t)||this.host.visibleAt(a,o)))continue;let h=f+n.castTime+e.delay+p;this.telegraphs.push({x:a,y:o,dir:r,shape:m,start:f,land:h,end:h+.15,src:t.id,team:t.team,owner:t.owner,zone:-1,heal:i,stage:`windup`,ability:n.ability,castEnd:n.t+n.castTime,castRel:so(n.t,n.castTime),follow:e.anchor===`caster`?`caster`:e.anchor===`aim`?`aim`:e.anchor===`target`?`target`:void 0,followId:e.anchor===`target`?d?.id:void 0,aimX:n.x,aimY:n.y,tele:e})}}dashTelegraph(e,t){let n=this.host.now(),r=Math.hypot(t.toX-t.fromX,t.toY-t.fromY),i=r>.001?Math.atan2(t.toY-t.fromY,t.toX-t.fromX):0,a=!1;for(let o of this.telegraphs){if(o.stage!==`windup`||o.src!==t.src||e.time<(o.castEnd??0)-.05)continue;let s=o.tele;s?.dash&&(a=!0,o.stage=`travel`,s.anchor===`target`?o.land=Math.max(o.start,n+t.duration+s.delay):s.anchor===`land`?(o.follow=void 0,o.x=t.toX,o.y=t.toY,o.land=Math.max(o.start,n+t.duration+s.delay)):(o.follow=void 0,o.x=t.fromX,o.y=t.fromY,o.dir=i,o.shape.kind===`rect`&&(o.shape={...o.shape,length:Math.max(.5,r)}),o.land=Math.max(o.start,n+t.duration)),o.end=o.land+.15)}if(a)return;let o=this.lastCast.get(t.src);if(!o||n-o.t>.08||r<.5||this.abilities.get(o.ability)?.telegraph!==`everyone`)return;let s=e.entity(t.src);s&&(this.host.entityVisible(s)||this.host.visibleAt(t.toX,t.toY))&&this.telegraphs.push({x:t.fromX,y:t.fromY,dir:i,shape:{kind:`rect`,length:r,width:Math.max(.8,s.radius*2)},start:n,land:n+t.duration,end:n+t.duration+.15,src:t.src,team:s.team,owner:s.owner,zone:-1,heal:!1})}windupVfx(e,t,n,r,i){let a=this.tmpA,o=t.castTime,s=e.kind===`fighter`,c=t.t+o,l=so(t.t,o),u=()=>this.casting(t.src,l),d=(e,n,r,o)=>{let s=e?this.vfx.def(e):void 0;if(!e||!s)return;let d=this.fire(e,t.src,o,{origin:a,ground:a,dir:i,anchor:`origin`,phase:n,sustain:u,targetId:t.target,timeScale:r?s.duration/Math.max(.05,l-t.t):1});d>0&&this.windups.push({h:d,src:t.src,castEnd:c,rel:l,attack:!1})};o>=go?(n?.windupVfx?d(n.windupVfx,`main`,!0,r):n?.vfx&&this.vfx.def(n.vfx)?.hasWindup?d(n.vfx,`windup`,!1,r):s&&d(t.slot===`ult`?this.eventVfx.ultCharge:this.eventVfx.windup,`main`,!0,r),t.slot===`ult`&&d(this.eventVfx.ultWindup,`main`,!0,4)):s&&this.eventVfx.castFlash&&this.fire(this.eventVfx.castFlash,t.src,r,{origin:a,ground:a,dir:i,anchor:`origin`})}casting(e,t){let n=this.host.view(),r=n?.entity(e);return!n||!r||!r.alive?!1:n.time<t-.016666666666666666&&(r.state===`cast`||r.state===`channel`)}startRecall(e,t){let n=this.eventVfx.recall,r=n?this.vfx.def(n):void 0;if(!n||!r||this.recallFx.has(t))return;let i=e.entity(t);if(!i||!i.alive||i.state!==`recall`||!this.host.entityVisible(i))return;let a=i.stateDuration>0?Math.max(.25,i.stateDuration-i.stateTime):r.duration,o=this.tmpB;this.host.bodyPos(t,o)?o.y=xo:o.set(i.x,xo,i.y);let s={h:0};s.h=this.fire(n,t,2,{origin:o,ground:o,anchor:`origin`,dir:0,timeScale:r.duration/a,sustain:()=>this.recallFx.get(t)===s.h}),s.h>0&&this.recallFx.set(t,s.h)}syncRecalls(e){for(let[t,n]of this.recallFx){let r=e.entity(t);this.vfx.isAlive(n)&&r&&r.alive&&r.state===`recall`&&this.host.entityVisible(r)||(this.recallFx.delete(t),this.vfx.release(n,!0))}if(this.eventVfx.recall)for(let t of e.players){if(this.recallFx.has(t.entity))continue;let n=e.entity(t.entity);n&&n.state===`recall`&&this.startRecall(e,t.entity)}}statusLive(e,t){let n=this.host.view()?.entity(e);if(!n||!n.alive||!this.host.entityVisible(n))return!1;for(let e of n.statuses)if(e.kind===t&&e.remaining>0)return!0;return!1}statusShare(e,t){let n=this.host.view()?.entity(e),r=0;if(n)for(let e of n.statuses)e.kind===t&&e.remaining>0&&e.duration>0&&(r=Math.max(r,e.remaining/e.duration));return r}syncStatuses(e){for(let[e,t]of this.statusFx)this.vfx.isHeld(t)||(this.statusFx.delete(e),this.statusSrc.delete(e));if(this.statusSrc.size>this.statusFx.size+64)for(let t of this.statusSrc.keys()){if(this.statusFx.has(t))continue;let n=e.entity(Math.floor(t/32)),r=fo[t%32];(!n||!n.alive||!n.statuses.some(e=>e.kind===r&&e.remaining>0))&&this.statusSrc.delete(t)}let t=this.tmpB;for(let n of e.entities){if(!n.statuses.length||!n.alive||n.kind===`projectile`||n.kind===`zone`||n.kind===`ward`||n.kind===`pickup`||n.kind===`structure`)continue;let r=null;for(let i of n.statuses){if(!(i.remaining>0)||!Number.isFinite(i.remaining)||!Number.isFinite(i.duration))continue;let a=this.statusVfx[i.kind];if(!a)continue;let o=mo(n.id,i.kind);if(this.statusFx.has(o))continue;if(r===null&&(r=this.host.entityVisible(n)),!r||!this.host.bodyPos(n.id,t))break;let s=i.kind,c=this.statusSrc.get(o),{c:l}=this.colorFor(n,n.team,n.owner),u=c===void 0?void 0:e.entity(c),d=u?this.colorFor(u,u.team,u.owner).c:null,f=this.vfx.spawnHandle(a,{tier:po[s]??2,team:l,element:d,ally:!1,origin:t,target:t,ground:this.tmpC.set(t.x,0,t.z),targetId:n.id,sourceId:c??-1,anchor:`target`,dir:n.facing,sustain:()=>this.statusLive(n.id,s),remaining:()=>this.statusShare(n.id,s)});f>0&&this.statusFx.set(o,f)}}}delayed=[];matchZone(e,t){for(let n of e.entities)if(!(n.kind!==`zone`||this.zonesSeen.has(n.id))&&n.vfx===t.vfx&&Math.abs(n.x-t.x)<.2&&Math.abs(n.y-t.y)<.2)return n.id;return-1}update(e){let t=this.host.now();for(let e=this.delayed.length-1;e>=0;e--)if(t>=this.delayed[e].at){let t=this.delayed[e];this.delayed.splice(e,1),t.run()}for(let n=this.telegraphs.length-1;n>=0;n--){let r=this.telegraphs[n];if(r.zone>=0){let t=e?.entity(r.zone);t?(r.x=t.x,r.y=t.y):this.telegraphs.splice(n,1);continue}if(r.stage===`windup`&&e){let i=e.entity(r.src),a=r.castEnd??0,o=!!i&&i.alive&&(i.state===`cast`||i.state===`channel`),s=!i||!i.alive||e.time<(r.castRel??a)-.016666666666666666&&!o,c=e.time>a+.2&&!(i&&i.state===`channel`);if(s||c){this.telegraphs.splice(n,1);continue}r.follow===`target`?this.trackTarget(e,r):r.follow&&i&&e.time<a&&(r.x=i.x,r.y=i.y,r.follow===`aim`&&r.aimX!==void 0&&r.aimY!==void 0&&Math.hypot(r.aimX-i.x,r.aimY-i.y)>.05&&(r.dir=Math.atan2(r.aimY-i.y,r.aimX-i.x))),i&&i.state===`channel`&&t>r.end-.15&&(r.land=t,r.end=t+.15)}else if(r.stage===`travel`){if(t>r.end){this.telegraphs.splice(n,1);continue}r.follow===`target`&&e&&this.trackTarget(e,r)}t>r.end&&this.telegraphs.splice(n,1)}for(let t=this.windups.length-1;t>=0;t--){let n=this.windups[t];if(!this.vfx.isAlive(n.h)){this.windups.splice(t,1);continue}if(!e)continue;if(e.time>=n.rel-.016666666666666666){this.windups.splice(t,1);continue}let r=e.entity(n.src);r&&r.alive&&(n.attack?r.state===`attack`:r.state===`cast`||r.state===`channel`)||(this.vfx.release(n.h,!0),this.windups.splice(t,1))}if(!e)return;let n=this.host.palette(),r=n.viewer.you>=0?e.players.find(e=>e.player===n.viewer.you):void 0,i=r?e.entity(r.entity):void 0;oo.setDead(!!r&&e.phase!==`ended`&&r.respawnIn>0&&(!i||!i.alive)),this.syncStatuses(e),this.syncRecalls(e);for(let r of e.entities){if(r.kind!==`zone`||this.zonesSeen.has(r.id))continue;this.zonesSeen.add(r.id);let i=this.findOwnerEntity(e,r);if(!(this.host.visibleAt(r.x,r.y)||this.host.entityVisible(r)))continue;let{c:a,rel:o}=this.colorFor(i,r.team,r.owner),s=this.zoneTele.get(r.def)??`everyone`,c=o===`ally`||o===`self`||n.viewer.team<0;if(r.shape&&(s===`everyone`||s===`ally_only`&&c)){let e=i?i.id:-1,n=t=>t.src===e&&wo(t.shape,r.shape)&&Math.hypot(t.x-r.x,t.y-r.y)<.3,a=this.telegraphs.find(e=>e.zone<0&&t<=e.end&&n(e)),o=!a&&this.telegraphs.some(e=>e.zone>=0&&n(e));a?(a.zone=r.id,a.end=1/0,a.stage=void 0,a.follow=void 0,a.dir=r.facing):o||this.telegraphs.push({x:r.x,y:r.y,dir:r.facing,shape:r.shape,start:t,land:t,end:1/0,src:e,team:r.team,owner:r.owner,zone:r.id,heal:!1})}if(r.vfx&&this.vfx.has(r.vfx)){let e=r.shape?r.shape.radius??(r.shape.length??2)*.5:Math.max(1,r.radius),t=new B(r.x,0,r.y),n=this.signatureOf(i);this.vfx.spawn(r.vfx,{tier:3,team:a,element:this.elementOf(i),signature:n?.sig??null,secondary:n?.sec??null,hueFrom:n?.base??null,ally:o===`ally`,origin:t,ground:t,scale:e,dir:r.facing,anchor:`ground`,loopWhile:r.id,sourceId:i?i.id:-1})}}if(this.zonesSeen.size>4096){let t=new Set(e.entities.filter(e=>e.kind===`zone`).map(e=>e.id));for(let e of this.zonesSeen)t.has(e)||this.zonesSeen.delete(e)}}trackTarget(e,t){let n=t.followId===void 0?void 0:e.entity(t.followId);n&&n.alive&&(this.host.bodyPos(n.id,this.tmpB)?(t.x=this.tmpB.x,t.y=this.tmpB.z):(t.x=n.x,t.y=n.y))}findOwnerEntity(e,t){if(t.owner<0)return;let n=e.players.find(e=>e.player===t.owner);return n?e.entity(n.entity):void 0}clear(){this.telegraphs.length=0,this.lastCast.clear(),this.delayed.length=0,this.zonesSeen.clear(),this.windups.length=0,this.statusFx.clear(),this.statusSrc.clear(),this.lastHit.clear(),this.lastPulse.clear(),this.pulseQ.clear(),this.castAt.clear(),this.beats.clear(),this.recallFx.clear(),oo.reset()}},Do=5.5,Oo=2.8,ko=class{tex=null;cur=new Float32Array;bytes=new Uint8Array;w=0;h=0;first=!0;enabled=!0;update(e,t,n){if(!this.enabled||t<0){mn.valeFogOn.value=0;return}let r;try{r=e.visionGrid(t)}catch{mn.valeFogOn.value=0;return}(r.width!==this.w||r.height!==this.h||!this.tex)&&this.allocate(r.width,r.height,r.cell);let i=this.w*this.h,a=r.data,o=this.cur,s=this.bytes,c=this.first?1:Math.min(1,n*Do),l=this.first?1:Math.min(1,n*Oo),u=this.first;for(let e=0;e<i;e++){let t=+(a[e]>0),n=o[e];if(n===t)continue;let r=t>n?n+c:n-l;(t>n&&r>t||t<n&&r<t)&&(r=t),o[e]=r;let i=r*255+.5|0;s[e]!==i&&(s[e]=i,u=!0)}this.first=!1,u&&this.tex&&(this.tex.needsUpdate=!0),mn.valeFogOn.value=1}allocate(e,t,n){this.w=e,this.h=t,this.cur=new Float32Array(e*t),this.bytes=new Uint8Array(e*t),this.tex?.dispose();let r=new o(this.bytes,e,t,Ve,f);r.magFilter=re,r.minFilter=re,r.wrapS=r.wrapT=Be,r.unpackAlignment=1,r.generateMipmaps=!1,r.needsUpdate=!0,this.tex=r,this.first=!0,mn.valeFogTex.value=r,mn.valeFogScale.value.set(1/(e*n),1/(t*n)),mn.valeFogTexel.value.set(1/e,1/t)}dispose(){this.tex?.dispose(),this.tex=null,this.w=this.h=0,mn.valeFogOn.value=0}},Ao={keyOfSun:.9,crown:{viewDir:[0,.8,-.6],power:2.5,luminance:3.4,sunHue:.5,albedoFloor:.3},fill:{luminance:.7},knee:[.25,.75],unitShare:.35,monsterLight:.8},jo=new R().setStyle(`#F4EFE2`),Mo=new R,No=new R,Po=e=>Math.max(1e-4,.2126*e.r+.7152*e.g+.0722*e.b),Fo=6,Io=2,Lo=3,Ro=class{light;target=new le;dir=new B(0,1,0);basis=new M;basisInv=new M;mapSize=2048;corners=[new B,new B,new B,new B,new B,new B,new B,new B];tmp=new B;tmp2=new B;ndc=[[-1,-1],[1,-1],[1,1],[-1,1]];shadowsOn=!0;constructor(){this.light=new S(16777215,3),this.light.target=this.target,this.light.castShadow=!0,this.light.shadow.bias=-4e-4,this.light.shadow.normalBias=.035,this.light.shadow.radius=2}configure(e){let[t,n,r]=e.sunDir;this.dir.set(t,n,r).normalize(),this.light.color.setStyle(e.sunColor),this.light.intensity=e.sunIntensity;let i=Math.abs(this.dir.y)>.999?new B(0,0,-1):new B(0,1,0);this.basis.lookAt(this.dir,new B(0,0,0),i),this.basisInv.copy(this.basis).invert();let a=mn,o=Ao;a.valeCharKey.value=o.keyOfSun;let s=Mo.copy(jo).lerp(No.setStyle(e.sunColor),o.crown.sunHue);s.multiplyScalar(o.crown.luminance/Po(s)),a.valeCharRim.value.set(s.r,s.g,s.b,o.crown.power),a.valeCharRimDir.value.set(o.crown.viewDir[0],o.crown.viewDir[1],o.crown.viewDir[2]).normalize(),a.valeCharFill.value.copy(jo).multiplyScalar(o.fill.luminance/Po(jo)),a.valeCharShape.value.set(o.crown.albedoFloor,o.unitShare,o.knee[0],o.knee[1]),a.valeCharMonster.value=o.monsterLight}releaseMap(){this.light.shadow.map?.dispose(),this.light.shadow.map=null}ensureMap(){let e=this.light.shadow;if(!this.shadowsOn||e.map||!this.gl)return;let t=this.mapSize,n=new ne(t,t,{format:Ve,type:f,generateMipmaps:!1,depthBuffer:!0});n.texture.name=`${this.light.name}.shadowColour`;let r=new c(t,t,v);r.name=`${this.light.name}.shadowMap`,r.format=k,this.pcf?(r.compareFunction=this.gl.state.buffers.depth.getReversed()?518:515,r.minFilter=re,r.magFilter=re):(r.compareFunction=null,r.minFilter=Se,r.magFilter=Se),n.depthTexture=r,e.map=n,e.camera.updateProjectionMatrix()}gl=null;pcf=!0;setQuality(e,t){this.gl=e,this.pcf=t!==1,this.shadowsOn=t>0,e.shadowMap.enabled=this.shadowsOn,e.shadowMap.type=t===1?0:1,this.light.castShadow=this.shadowsOn;let n=t===3?4096:t===2?2048:1024;(n!==this.mapSize||!this.light.shadow.map)&&(this.mapSize=n,this.light.shadow.mapSize.set(n,n),this.light.shadow.map?.dispose(),this.light.shadow.map=null),this.light.shadow.radius=t>=2?2.2:1,e.shadowMap.needsUpdate=!0}fit(e){this.ensureMap();let t=e.position;for(let n=0;n<4;n++){let[r,i]=this.ndc[n];this.tmp.set(r,i,.5).unproject(e).sub(t).normalize();for(let e=0;e<2;e++){let r=e===0?0:Fo,i=this.tmp.y<-1e-4?(r-t.y)/this.tmp.y:200;this.corners[n*2+e].copy(t).addScaledVector(this.tmp,Math.min(Math.max(i,0),200))}}let n=1/0,r=1/0,i=-1/0,a=-1/0,o=1/0,s=-1/0;for(let e of this.corners)this.tmp2.copy(e).applyMatrix4(this.basisInv),n=Math.min(n,this.tmp2.x),i=Math.max(i,this.tmp2.x),r=Math.min(r,this.tmp2.y),a=Math.max(a,this.tmp2.y),o=Math.min(o,this.tmp2.z),s=Math.max(s,this.tmp2.z);let c=Math.ceil((Math.max(i-n,a-r)/2+Lo)/Io)*Io,l=c*2/this.mapSize,u=(n+i)/2,d=(r+a)/2;u=Math.round(u/l)*l,d=Math.round(d/l)*l;let f=(o+s)/2;this.tmp.set(u,d,f).applyMatrix4(this.basis),this.target.position.copy(this.tmp),this.light.position.copy(this.tmp).addScaledVector(this.dir,80),this.target.updateMatrixWorld(),this.light.updateMatrixWorld();let p=this.light.shadow.camera,m=Math.ceil((80+(s-o)/2+30)/10)*10;(p.right!==c||p.near!==1||p.far!==m)&&(p.left=-c,p.right=c,p.top=c,p.bottom=-c,p.near=1,p.far=m,p.updateProjectionMatrix())}},zo=class{renderer;envRT=null;background=null;fallback=null;solid=null;last=null;onRestored=()=>{let e=this.last;this.envRT=null,e&&this.apply(e.scene,e.hdr,e.env,e.bg)};constructor(e){this.renderer=e,e.domElement.addEventListener(`webglcontextrestored`,this.onRestored,!1)}makeFallback(e,t,n,r){let i=new Float32Array(32768),a=new B(e[0],e[1],e[2]).normalize(),s=new B;for(let e=0;e<64;e++){let o=(1-(e+.5)/64)*Math.PI;for(let c=0;c<128;c++){let l=(c+.5)/128*Math.PI*2-Math.PI;s.set(Math.sin(o)*Math.sin(l),Math.cos(o),-Math.sin(o)*Math.cos(l));let u=(1-Math.max(0,s.y))**3,d=n.r+(r.r-n.r)*u,f=n.g+(r.g-n.g)*u,p=n.b+(r.b-n.b)*u;if(s.y<0){let e=.55+.45*(1+s.y);d*=e*.8,f*=e*.8,p*=e*.78}let m=Math.max(0,s.dot(a)),h=m**24*2+m**4*.35;d+=t.r*h,f+=t.g*h,p+=t.b*h;let g=(e*128+c)*4;i[g]=d,i[g+1]=f,i[g+2]=p,i[g+3]=1}}let c=new o(i,128,64,be,w);return c.colorSpace=g,c.mapping=303,c.magFilter=re,c.minFilter=re,c.generateMipmaps=!1,c.needsUpdate=!0,this.fallback?.dispose(),this.fallback=c,c}apply(e,t,n,r=1){let i=t??this.fallback;if(!i)return;this.last={scene:e,hdr:t,env:n,bg:r},i.mapping=303;let a=new Fe(this.renderer),o=a.fromEquirectangular(i);a.dispose(),this.envRT?.dispose(),this.envRT=o,this.background=i,e.environment=o.texture,e.environmentIntensity=n,e.background=this.solid??i,e.backgroundIntensity=r,e.backgroundBlurriness=0}release(e){this.last?.scene===e&&(this.last=null),this.envRT&&e.environment===this.envRT.texture&&(e.environment=null),this.background&&e.background===this.background&&(e.background=null),this.envRT?.dispose(),this.fallback?.dispose(),this.envRT=null,this.background=null,this.fallback=null}dispose(){this.renderer.domElement.removeEventListener(`webglcontextrestored`,this.onRestored,!1),this.last=null,this.envRT?.dispose(),this.fallback?.dispose(),this.envRT=null,this.background=null,this.fallback=null}},Bo=`
float valeHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
vec2 valeHash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
float valeNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( valeHash12( i ), valeHash12( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( valeHash12( i + vec2( 0.0, 1.0 ) ), valeHash12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float valeFbm( vec2 p ) {
  float a = 0.5, s = 0.0;
  for ( int i = 0; i < 4; i ++ ) { s += a * valeNoise( p ); p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p; a *= 0.5; }
  return s;
}
// irregular honed pavers (Voronoi with exact border distance): x = cell hash, y = distance to the
// nearest joint in metres, zw = cell id
vec4 valePavers( vec2 p, float size ) {
  vec2 q = p / size;
  vec2 i = floor( q ), f = fract( q );
  float d1 = 8.0;
  vec2 mr = vec2( 0.0 ), mg = vec2( 0.0 );
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 r = g + valeHash22( i + g ) * 0.76 + 0.12 - f;
    float d = dot( r, r );
    if ( d < d1 ) { d1 = d; mr = r; mg = g; }
  }
  float md = 8.0;
  for ( int y = -2; y <= 2; y ++ ) for ( int x = -2; x <= 2; x ++ ) {
    vec2 g = mg + vec2( float( x ), float( y ) );
    vec2 r = g + valeHash22( i + g ) * 0.76 + 0.12 - f;
    vec2 dr = r - mr;
    if ( dot( dr, dr ) > 1e-5 ) md = min( md, dot( 0.5 * ( mr + r ), normalize( dr ) ) );
  }
  vec2 id = i + mg;
  return vec4( valeHash12( id * 1.37 + 0.5 ), md * size, id );
}
// Mikkelsen-style derivative bump: perturb a view-space normal by a scalar height field
vec3 valeBump( vec3 surfPos, vec3 surfNorm, float h, float scale ) {
  vec3 sx = dFdx( surfPos ), sy = dFdy( surfPos );
  vec3 r1 = cross( sy, surfNorm ), r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 );
  vec2 dh = vec2( dFdx( h ), dFdy( h ) ) * scale;
  vec3 grad = sign( det ) * ( dh.x * r1 + dh.y * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`,Vo=`
vec3 valeTexMean( sampler2D t ) { return max( textureLod( t, vec2( 0.5 ), 16.0 ).rgb, vec3( 0.02 ) ); }
// organic paintings: two rotated copies switched by a noise mask (hard-ish switch: no ghosted leaves)
vec4 valeTex2( sampler2D t, vec2 uv, float m ) {
  vec4 a = texture( t, uv );
  vec2 r = vec2( 0.8 * uv.x - 0.6 * uv.y, 0.6 * uv.x + 0.8 * uv.y ) * 0.93 + vec2( 0.37, 0.71 );
  vec4 b = texture( t, r );
  return mix( a, b, smoothstep( 0.44, 0.56, m ) );
}
// organic paintings (litter, moss): keep the painting's own hues, land its mean VALUE on the band, lean
// the hue toward the band by k (a ratio map would turn brown soil purple under a green mean)
vec3 valeOrganic( vec3 t, vec3 mean, vec3 band, float k ) {
  const vec3 LW = vec3( 0.2126, 0.7152, 0.0722 );
  float lm = max( dot( mean, LW ), 1e-3 );
  float lt = dot( t, LW ) / lm;
  return mix( t * ( dot( band, LW ) / lm ), band * lt, k );
}
// the site (centre) of a valePavers cell, in metres
vec2 valePaverSite( vec4 f, float size ) { return ( f.zw + valeHash22( f.zw ) * 0.76 + 0.12 ) * size; }
// closing env m-3: painted strokes that follow rings round a centre (r = radius, a = atan angle): long round the ring
// (~3 m), short across it (~0.4 m), 0..1; the two ends of the angle blend into each other, so no seam at ±pi
float valeRingStroke( float r, float a, float seed ) {
  float t = a / 6.2831853 + 0.5;
  float n = 6.2831853 * max( r, 1.0 ) * 0.33;
  float rq = r * 2.4 + seed;
  float g0 = valeNoise( vec2( t * n, rq ) ), g1 = valeNoise( vec2( ( t - 1.0 ) * n, rq ) );
  float h0 = valeNoise( vec2( t * n * 2.7, rq * 2.1 + 5.0 ) ), h1 = valeNoise( vec2( ( t - 1.0 ) * n * 2.7, rq * 2.1 + 5.0 ) );
  return mix( g0, g1, t ) * 0.7 + mix( h0, h1, t ) * 0.3;
}
// flags laid in rings round a centre (plazas, camp rooms, the Seat, the Noonplate): x = flag hash, y = distance
// to the nearest joint (m), zw = (ring, segment); ring −7 is the centre disc
vec4 valeRingFlags( vec2 p, vec2 c, float r0, float ringW, float segLen ) {
  vec2 d = p - c;
  float r = length( d );
  float rr = max( r - r0, 0.0 );
  float ri = floor( rr / ringW );
  float rl = rr - ri * ringW;
  float rc = r0 + ( ri + 0.5 ) * ringW;
  float nseg = max( 6.0, floor( 6.2831853 * rc / segLen ) );
  float t = ( atan( d.y, d.x ) / 6.2831853 + 0.5 ) * nseg + floor( valeHash12( vec2( ri, 7.13 ) ) * 97.0 ) + valeHash12( vec2( ri, 3.7 ) );
  float si = mod( floor( t ), nseg );
  float sl = fract( t );
  float arc = 6.2831853 * max( r, 0.01 ) / nseg;
  float e = min( min( rl, ringW - rl ), min( sl, 1.0 - sl ) * arc );
  if ( r < r0 ) e = r0 - r;
  vec2 id = vec2( r < r0 ? -7.0 : ri, r < r0 ? 0.0 : si );
  return vec4( valeHash12( id * 1.37 + 0.5 ), e, id );
}
// long courses of stone along x (the deck, the shadow's slabs, the shaft's fragments): x = hash, y = joint
// distance, zw = id
vec4 valeCourses( vec2 p, float cw, float baseL ) {
  float row = floor( p.y / cw );
  float rl = p.y - row * cw;
  float L = baseL * ( 0.7 + 0.6 * valeHash12( vec2( row, 1.31 ) ) );
  float x = p.x / L + floor( valeHash12( vec2( row, 9.17 ) ) * 7.0 ) + 0.5 * valeHash12( vec2( row, 2.2 ) );
  float k = floor( x );
  float b0 = k + ( valeHash12( vec2( row, k ) ) - 0.5 ) * 0.5;
  float b1 = k + 1.0 + ( valeHash12( vec2( row, k + 1.0 ) ) - 0.5 ) * 0.5;
  float ci = k;
  if ( x < b0 ) { b1 = b0; ci = k - 1.0; b0 = k - 1.0 + ( valeHash12( vec2( row, k - 1.0 ) ) - 0.5 ) * 0.5; }
  else if ( x > b1 ) { b0 = b1; ci = k + 1.0; b1 = k + 2.0 + ( valeHash12( vec2( row, k + 2.0 ) ) - 0.5 ) * 0.5; }
  float e = min( min( rl, cw - rl ), min( x - b0, b1 - x ) * L );
  vec2 id = vec2( row, ci );
  return vec4( valeHash12( id * 1.37 + 3.1 ), e, id );
}
// the gorge's rim plateau (Needlespan, beyond the far walls): bare bedrock in great weathered slabs, grey with
// lichen, turf and moss in the cracks and hollows (never the Dialwood's leaf litter); hh = bump height (m)
vec3 valeRockPlateau( vec2 p, sampler2D tg, sampler2D tm, vec3 rock, vec3 moss, out float hh ) {
  vec2 w = p + vec2( valeNoise( p * 0.21 ) - 0.5, valeNoise( p * 0.21 + 5.0 ) - 0.5 ) * 2.4;
  vec4 f = valePavers( w, 5.6 );
  vec4 g = texture( tg, p / 4.0 );
  vec3 gN = mix( vec3( 1.0 ), g.rgb / valeTexMean( tg ), 0.85 );
  float big = valeFbm( p * 0.045 + 1.3 );
  // weathered bedrock: warm grey, broad tonal drifts, each slab a little different
  vec3 c = rock * vec3( 1.1, 1.04, 0.93 ) * ( 0.86 + 0.22 * f.x ) * ( 0.8 + 0.4 * big ) * gN;
  // only some joints are open cracks (bedrock, not paving); they wander and pinch out
  float open_ = smoothstep( 0.35, 0.6, valeNoise( w * 0.35 + f.zw * 0.7 ) );
  float e = f.y + ( g.a - 0.6 ) * 0.15 + ( valeNoise( p * 1.7 ) - 0.5 ) * 0.12;
  float crack = ( 1.0 - smoothstep( 0.03, 0.11, e ) ) * open_;
  c *= 1.0 - 0.35 * crack;
  c *= mix( 0.86, 1.0, smoothstep( 0.0, 0.45, e ) * open_ + ( 1.0 - open_ ) );
  vec4 m = texture( tm, p / 4.0 );
  vec3 mm = valeTexMean( tm );
  vec3 mc = valeOrganic( mix( mm, m.rgb, 0.7 ), mm, moss * 0.8, 0.5 );
  // moss and turf only in the hollows and along open cracks; lichen rosettes on the dry stone
  float hollow = smoothstep( 0.7, 0.86, valeNoise( p * 0.11 + 2.0 ) * 0.7 + ( 1.0 - big ) * 0.3 + ( m.a - 0.6 ) * 0.5 );
  float mossA = max( crack * smoothstep( 0.3, 0.6, valeNoise( p * 0.6 ) ) * 0.75, hollow * 0.8 );
  c = mix( c, mix( mc, c * vec3( 0.8, 0.9, 0.7 ), 0.3 ), mossA );
  float li = smoothstep( 0.74, 0.82, valeNoise( p * 2.3 + f.zw * 3.1 ) ) * ( 1.0 - mossA );
  c = mix( c, c * vec3( 1.16, 1.12, 0.9 ) + 0.012, li * 0.5 );
  hh = smoothstep( 0.0, 0.3, e ) * 0.05 * open_ + ( g.a - 0.6 ) * 0.06 + ( m.a - 0.6 ) * 0.03 * mossA;
  return c;
}
// one flag: per-flag value and a slight warm/cool drift, a worn (paler) face, painted edge darkening, joint
// fill; h = bevel height (m)
vec3 valeFlag( vec3 band, vec4 f, vec3 grainN, float chip, float jointW, vec3 jointC, float varK, out float h, out float jw ) {
  float e = f.y + chip;
  jw = 1.0 - smoothstep( jointW * 0.35, jointW, e );
  float hue = fract( f.x * 13.7 ) - 0.5;
  vec3 c = band * ( 1.0 + ( f.x - 0.5 ) * varK ) * vec3( 1.0 + 0.08 * hue, 1.0, 1.0 - 0.09 * hue ) * grainN;
  // a soft painted edge and a worn, paler face (r12 B5: low-contrast joints, so the walked stone stays one quiet band)
  c *= mix( 0.86, 1.0, smoothstep( 0.0, 0.16, e ) ) * ( 1.0 + 0.05 * smoothstep( 0.18, 0.5, e ) );
  c = mix( c, jointC, jw );
  h = smoothstep( 0.0, 0.085, e ) * 0.032 + ( f.x - 0.5 ) * 0.006;
  return c;
}
`,Ho=`
uniform vec3 uQuadNW, uQuadNE, uQuadSW, uQuadSE;
uniform vec3 uQuadC;
vec3 valeQuadTint( vec2 p ) {
  float e = smoothstep( -uQuadC.z, uQuadC.z, p.x - uQuadC.x );
  float s = smoothstep( -uQuadC.z, uQuadC.z, p.y - uQuadC.y );
  return mix( mix( uQuadNW, uQuadNE, e ), mix( uQuadSW, uQuadSE, e ), s );
}
`,Uo=`
#if defined( USE_COLOR ) && defined( USE_INSTANCING )
vColor.rgb *= valeQuadTint( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz );
#elif defined( USE_COLOR_ALPHA ) && defined( USE_INSTANCING )
vColor.rgb *= valeQuadTint( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz );
#endif
`,Wo=`
varying vec3 vGroundW;
uniform sampler2D uSplat; uniform sampler2D uSplat2;
uniform vec2 uSplatScale; uniform vec2 uMapSize; uniform float uLaneHalf;
uniform sampler2D uTexLitter, uTexGrain, uTexMoss;
uniform vec3 uLane, uGrout, uVerge, uJungle, uMoss, uEarth, uClearing, uInscription, uThicketFloor, uShaftFloor, uSeatC, uMidInlay, uLitC;
uniform vec3 uPlazaA, uPlazaS, uInlayA, uInlayS, uSheenC, uRockC;
uniform vec4 uPlaza0, uPlaza1, uFount0, uFount1;
uniform vec3 uSeat; uniform vec3 uPlate;
uniform vec4 uRooms[ 16 ]; uniform int uRoomN;
uniform vec4 uShaftAx;
uniform vec3 uTempW, uTempE; uniform float uTempK; uniform float uWaterT;
uniform vec3 uSeatCol[ 10 ];
uniform float uGeStone; uniform sampler2D uGeTile;   // GE-1: the dressed-stone micro layer (0 off; terrain.ts GE_STONE_MICRO, Low always 0)
float gHeight; float gRough; vec3 gEmit; float gSheen;
float geK; float geA; float geS;   // GE-1: how much dressed stone this pixel is, the flag's tool-mark angle, the flag's seed
// env F1: the spawn dais's drawn step (m): its height and the riser's width on the ground
#define DAIS_H 0.14
#define DAIS_RW 0.22
`,Go=`
{
  vec2 p = vGroundW.xz;
  vec2 su = p * uSplatScale;
  vec4 s1 = texture( uSplat, su );
  vec4 s2 = texture( uSplat2, su );
  bool inMap = p.x >= 0.0 && p.y >= 0.0 && p.x <= uMapSize.x && p.y <= uMapSize.y;
  float laneD = s1.r * 16.0, clearD = s1.g * 24.0 - 8.0, wallD = s1.b * 8.0, thickD = s1.a * 8.0 - 4.0;
  float shaftSD = s2.g * 8.0 - 4.0;
#ifdef VALE_GORGE
  float chasmSD = s2.a * 8.0 - 4.0;
  if ( inMap && chasmSD > 0.0 ) discard;
  float edgeD = inMap ? -chasmSD : 4.0;
#endif
  vec4 inl = valeInlay( p );
  float aa = clamp( length( fwidth( p ) ) * 0.75, 0.004, 0.25 );
  float nBig = valeFbm( p * 0.045 + 3.7 );
  float nMid = valeNoise( p * 0.31 ) * 0.65 + valeNoise( p * 0.83 + 5.1 ) * 0.35;
  float n2 = valeNoise( p * 2.3 );
  float wob = ( nMid - 0.5 ) * 1.3 + ( n2 - 0.5 ) * 0.35;
  vec4 tG = texture( uTexGrain, p / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.65 );
  float gh = tG.a - 0.6;
  vec4 tM = valeTex2( uTexMoss, p / 4.0, valeNoise( p * 0.13 + 2.0 ) );
  vec3 mossN = mix( vec3( 1.0 ), tM.rgb / valeTexMean( uTexMoss ), 0.75 );
  float chip = ( valeNoise( p * 9.0 ) - 0.5 ) * 0.045 + gh * 0.1;
  vec3 col = uJungle; float h = 0.0; float rough = 0.95; vec3 emit = vec3( 0.0 );
  gSheen = 0.0;
  geK = 0.0; geA = 0.0; geS = 0.0;
  float brush = 1.0 - smoothstep( -0.25, 0.2, thickD );
#ifdef VALE_STYLE_DIAL
  // ── the Dialwood floor: moss and fan-leaf litter over old dial-stone, broad hue and value drifts ──
  vec4 tL = valeTex2( uTexLitter, p / 6.0, valeNoise( p * 0.11 + 7.0 ) );
  vec3 fband = uJungle;
  fband = mix( fband, uMoss, smoothstep( 0.42, 0.68, nBig ) * 0.6 );
  fband = mix( fband, uEarth, smoothstep( 0.5, 0.75, valeNoise( p * 0.06 + 11.0 ) ) * 0.55 );
  fband *= 0.86 + 0.28 * nMid;
  vec3 meanL = valeTexMean( uTexLitter );
  col = valeOrganic( mix( meanL, tL.rgb, 0.78 ), meanL, fband, 0.5 );
  h = ( tL.a - 0.6 ) * 0.05;
  vec3 meanM = valeTexMean( uTexMoss );
  vec3 mossC = valeOrganic( mix( meanM, tM.rgb, 0.72 ), meanM, uMoss, 0.5 );
  // moss banks at the wall feet
  float foot = 1.0 - smoothstep( 0.1, 1.5, wallD + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.7 );
  col = mix( col, mossC * 0.9, foot * 0.75 );
  h = mix( h, ( tM.a - 0.6 ) * 0.06, foot );
  col = mix( col, valeOrganic( tM.rgb, valeTexMean( uTexMoss ), uThicketFloor, 0.5 ), brush * 0.9 );
  // the hour-line groove along every Dialwood path (a chalky 0.3 m channel, ≤ 6 L*)
  float gr = 1.0 - smoothstep( -aa, aa, inl.g );
  float grCore = 1.0 - smoothstep( -aa, aa, inl.g + 0.1 );
  float grLip = ( 1.0 - smoothstep( -aa, aa, inl.g - 0.04 ) ) - gr;
  float grK = 1.0 - brush;
  col *= 1.0 - 0.2 * ( gr - grCore ) * grK;
  col = mix( col, col * 1.3 + uInscription * 0.012, grCore * grK );
  col *= 1.0 + 0.08 * grLip * grK;
  h -= gr * 0.008;
  // stone: roads, their broken verges, camp rooms
  if ( laneD < uLaneHalf + 2.4 || clearD < 2.4 ) {
    // hand-laid, not stamped: the flag layout is gently warped, so the stones run in irregular sizes and soft-cornered
    // shapes (never one even Voronoi web down the whole road)
    vec2 pq = p + ( vec2( valeNoise( p * 0.27 + 3.1 ), valeNoise( p * 0.27 + 8.7 ) ) - 0.5 ) * 0.85;
    vec4 fl = valePavers( pq, 1.3 );
    // whole flags are lost to the wood: decide per flag from the fields at its centre
    vec2 site = valePaverSite( fl, 1.3 );
    vec4 ss = texture( uSplat, site * uSplatScale );
    float sLane = ss.r * 16.0;
    float sv = valeNoise( site * 0.37 + 1.3 );
    float road = 1.0 - smoothstep( uLaneHalf - aa, uLaneHalf + aa, laneD );
    float vergeT = clamp( ( laneD - uLaneHalf ) / 1.6, 0.0, 1.0 );
    float keepV = ( 1.0 - clamp( ( sLane - uLaneHalf ) / 1.7, 0.0, 1.0 ) ) * 1.15 + ( fl.x - 0.5 ) * 0.7 + ( sv - 0.5 ) * 0.4 - 0.12;
    float vergeW = step( 0.5, keepV ) * ( 1.0 - road ) * step( uLaneHalf - 0.4, laneD );
    float fh, jw, fv, jv, fr, jr;
    // ── the painted road (lane polish): every flag its own stone, a worn walked path, the verge breaking over the
    //    edge, sparse decals. The variation is painted into the albedo (mostly hue, the value held to the walked
    //    band: r12 B5 lane p50 85-100, walkable p95 - p5 <= 45) and the relief stays soft, so the stone is quiet at
    //    the scale a telegraph's edge reads at ──
    const vec3 LWr = vec3( 0.2126, 0.7152, 0.0722 );
    // the long tone: the road drifts warm and cool, and a little in value, over tens of metres (no stretch repeats)
    float lfA = valeFbm( p * 0.017 + 41.0 );
    float lfB = valeNoise( p * 0.06 + 13.0 );
    vec3 longT = mix( vec3( 1.04, 1.0, 0.93 ), vec3( 0.96, 1.0, 1.06 ), smoothstep( 0.3, 0.7, lfA ) ) * ( 0.97 + 0.06 * lfB );
    // every flag its own stone: a family (warm sandstone, cool slate, ochre, pale lime) leaning with the long field,
    // its own value, and a painted volume (the face rolls toward the sun's side: map −x, +y, behind-left of the camera)
    float fA = valeHash12( fl.zw + 3.17 ), fB = valeHash12( fl.zw * 1.31 + 8.4 ), fC = valeHash12( fl.zw * 0.71 + 5.9 );
    float famK = fract( fA + ( lfA - 0.5 ) * 0.6 + 1.0 );
    vec3 fam = famK < 0.3 ? vec3( 1.06, 1.0, 0.91 ) : famK < 0.56 ? vec3( 0.95, 0.995, 1.09 ) : famK < 0.8 ? vec3( 1.09, 1.0, 0.84 ) : vec3( 0.99, 1.005, 1.0 );
    vec2 toS = clamp( ( pq - site ) / 0.62, -1.0, 1.0 );
    float vol = dot( toS, vec2( -0.55, 0.83 ) );
    // the walked path: a polished, paler track down the middle, wandering in width, fading in and out along the road
    float trackW = 1.15 + 0.95 * valeNoise( p * 0.05 + 21.0 );
    float trackP = ( 1.0 - smoothstep( trackW - 0.8, trackW + 0.6, laneD + ( nMid - 0.5 ) * 1.1 + ( n2 - 0.5 ) * 0.3 ) )
      * ( 0.7 + 0.3 * smoothstep( 0.2, 0.6, valeNoise( p * 0.08 + 4.0 ) ) );
    // broad drifts of pale dial-dust where few feet go (value-neutral: the dust keeps the stone's luminance)
    float wearN = valeFbm( p * 0.07 + 17.3 );
    float dustP = smoothstep( 0.5, 0.72, wearN + ( nMid - 0.5 ) * 0.35 ) * smoothstep( 0.6, uLaneHalf - 0.4, laneD + ( n2 - 0.5 ) * 0.8 );
    vec3 dustTone = mix( uLane, uClearing * ( dot( uLane, LWr ) / max( dot( uClearing, LWr ), 1e-4 ) ), 0.6 );
    // (lane polish r2) the value is the flag's own too: 0.845-1.065, and about one flag in nine an outlier (a dark
    // weathered stone or a pale fresh-cut one), so the road never reads as one even web at a single value
    float fD = valeHash12( fl.zw * 0.53 + 2.3 );
    float fVal = ( 0.845 + 0.22 * fB ) * ( fD < 0.06 ? 0.86 : fD > 0.945 ? 1.06 : 1.0 );
    // under the track the stones are walked paler and warmer: the families fade but survive (hue 40 %), the values
    // are walked toward one (half way), the grain polishes out
    vec3 stone = mix( fam, vec3( 1.05, 1.04, 0.99 ), trackP * 0.4 ) * mix( fVal, 0.96, trackP * 0.5 ) * ( 1.0 + 0.035 * vol );
    vec3 roadBand = uLane * longT * stone * ( 1.0 + 0.03 * ( nMid - 0.5 ) );
    roadBand = mix( roadBand, dustTone * longT * mix( 1.0, fVal, 0.5 ) * ( 1.0 + 0.03 * ( n2 - 0.5 ) ), dustP * 0.7 );
    // the walked path reads: +2-3 L* over the stone either side
    roadBand *= 1.0 + 0.22 * trackP;
    vec3 grainR = mix( grainN, vec3( 1.0 ), max( dustP * 0.55, trackP * 0.6 ) );
    float chipR = chip * ( 1.0 + 2.4 * smoothstep( uLaneHalf - 2.0, uLaneHalf - 0.3, laneD + wob * 0.5 ) );
    // joints: some laid tight (the web breaks: no even mortar net), dust-filled and paler on the track and under the
    // drifts, a warm earth elsewhere
    float jTight = smoothstep( 0.5, 0.78, valeNoise( p * 0.55 + 19.0 ) * 0.7 + valeHash12( fl.zw + 0.7 ) * 0.3 );
    // (r2: the fill takes a little of its own stones' tone, so a joint is a soft seam, not the road's darkest value)
    vec3 jointC = mix( mix( mix( uGrout * vec3( 1.0, 0.96, 0.9 ), uEarth * 1.25, 0.4 ), roadBand * 0.8, 0.3 ), dustTone * 0.9, max( trackP * 0.85, dustP * 0.4 ) );
    float jW = ( 0.04 - 0.016 * trackP ) * ( 1.0 - 0.55 * jTight );
    // the flag, painted: a lit rim on the sun's side and a shaded rim on the far side (a painted bevel, never an
    // embossed ring round every stone), a worn paler face, the joint between; soft relief, the track walked near flat
    float eR = fl.y + chipR;
    jw = 1.0 - smoothstep( jW * 0.35, jW, eR );
    float rimB = ( 1.0 - smoothstep( 0.0, 0.15, eR ) ) * ( 1.0 - 0.5 * trackP );   // (r2) walked edges rounded off
    float litR = dot( normalize( pq - site + vec2( 1e-4 ) ), vec2( -0.55, 0.83 ) );
    vec3 roadC = roadBand * grainR * ( 1.0 + rimB * ( litR > 0.0 ? 0.05 : 0.11 ) * litR ) * ( 1.0 + 0.04 * smoothstep( 0.18, 0.5, eR ) );
    roadC = mix( roadC, jointC, jw );
    fh = ( smoothstep( 0.0, 0.085, eR ) * 0.02 + ( fB - 0.5 ) * 0.004 ) * ( 1.0 - 0.5 * trackP );
    // the dust drifts into the joints and softens the bevels: under a drift the flag pattern fades (painted, not stamped)
    float dustJ = smoothstep( 0.2, 0.8, dustP + ( valeNoise( p * 1.7 ) - 0.5 ) * 0.5 );
    roadC = mix( roadC, dustTone * 0.94 * mix( vec3( 1.0 ), grainN, 0.3 ), jw * dustJ * 0.85 );
    fh *= 1.0 - 0.75 * dustJ;
    // moss in the joints: along the outer flags, and in sparse patches across the road where few feet go
    float edgeMoss = smoothstep( uLaneHalf - 1.6, uLaneHalf - 0.3, laneD + wob * 0.6 );
    float mossPatch = smoothstep( 0.74, 0.9, valeNoise( p * 0.21 + 31.0 ) + ( tM.a - 0.6 ) * 0.5 + ( n2 - 0.5 ) * 0.2 ) * ( 1.0 - trackP );
    roadC = mix( roadC, mossC * 1.12, jw * max( edgeMoss, mossPatch ) * 0.8 );
    // the decals (terrain_inlay.ts laneDecals; DIAL keeps them in the free lit / mid channels): hairline cracks, dark
    // with a lit broken lip, and a walker's chalk marks, rubbed and broken by the grain
    float dk = 1.0 - smoothstep( -aa, aa, inl.b );
    float dkL = ( 1.0 - smoothstep( -aa, aa, inl.b - 0.022 ) ) - dk;
    roadC *= ( 1.0 - 0.3 * dk ) * ( 1.0 + 0.06 * dkL );
    fh -= dk * 0.005;
    float dc = ( 1.0 - smoothstep( -aa, aa, inl.a ) ) * smoothstep( 0.38, 0.7, valeNoise( p * 11.0 + 3.0 ) * 0.5 + tG.a * 0.6 + valeNoise( p * 2.7 ) * 0.25 );
    roadC = mix( roadC, uInscription * 1.06 * mix( vec3( 1.0 ), grainN, 0.4 ), dc * 0.85 );
    // the inscription band (0.3 m) on each outer edge, a carved strip with chalk hour-ticks
    float bandW = smoothstep( uLaneHalf - 0.3 - aa, uLaneHalf - 0.3 + aa, laneD );
    float bEdge = 1.0 - smoothstep( 0.0, 0.03 + aa, min( abs( laneD - ( uLaneHalf - 0.3 ) ), abs( laneD - uLaneHalf ) ) );
    vec3 bandC = uLane * 0.84 * grainN * ( 0.96 + 0.08 * n2 ) * ( 1.0 - 0.18 * bEdge );
    float tick = 1.0 - smoothstep( -aa, aa, inl.r );
    float tickC = ( 1.0 - smoothstep( -aa, aa, inl.r - 0.025 ) ) - tick;
    bandC *= 1.0 - 0.35 * tickC;
    bandC = mix( bandC, uInscription * 1.08, tick * 0.9 );
    // moss in the band's own pores (never shaped by the road's flags under it: that read as a ghosted film)
    bandC = mix( bandC, mossC * 0.85, smoothstep( 0.7, 0.86, gh * 2.0 + ( n2 - 0.5 ) * 0.7 + ( valeNoise( p * 0.9 + 3.3 ) - 0.5 ) * 0.6 + 0.3 ) * 0.6 * ( 1.0 - tick ) );
    roadC = mix( roadC, bandC, bandW );
    // (the cut edges' relief is broad and soft: a 3 cm step in the bump height breaks up into dots, since the
    // derivative bump sees it per 2×2 pixel quad)
    float bEdgeH = 1.0 - smoothstep( 0.0, 0.05 + 3.0 * aa, min( abs( laneD - ( uLaneHalf - 0.3 ) ), abs( laneD - uLaneHalf ) ) );
    fh = mix( fh, -0.004 - bEdgeH * 0.006 - tickC * 0.002, bandW );
    // verge: worn darker flags, moss in every joint and creeping over them toward the wood
    vec3 vergeC = valeFlag( uVerge * ( 0.93 + 0.14 * nMid ), fl, grainN, chip * 1.5, 0.075, mossC * 0.75, 0.2, fv, jv );
    float creep = smoothstep( 0.55, 0.8, vergeT * 0.8 + ( tM.a - 0.6 ) * 0.9 + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.5 + ( 1.0 - fl.x ) * 0.25 );
    vergeC = mix( vergeC, mossC * 0.85, creep * 0.9 );
    fv = mix( fv, ( tM.a - 0.6 ) * 0.05, creep );
    // camp rooms: dusty pale stone laid in rings round the camp (never the roads' irregular flags), dust in the
    // joints, moss creeping in from the rim; whole rings of flags lost to the wood at the edge
    vec3 roomC = col; float roomW = 0.0; fr = h;
    if ( clearD < 2.4 && uRoomN > 0 ) {
      vec4 rc = uRooms[ 0 ]; float rb = 1e9;
      for ( int k = 0; k < 16; k ++ ) {
        if ( k >= uRoomN ) break;
        vec4 R = uRooms[ k ];
        float dd = length( p - R.xy ) - R.z;
        if ( dd < rb ) { rb = dd; rc = R; }
      }
      vec4 rf = valeRingFlags( p, rc.xy, 1.3, 1.15, 1.55 );
      float rr = rf.z < -1.0 ? 0.6 : 1.3 + ( rf.z + 0.5 ) * 1.15;
      float rsv = valeNoise( rf.zw * vec2( 0.9, 0.37 ) + rc.xy * 0.1 );
      float keepR = ( 1.0 - clamp( ( rr - rc.z + 0.7 ) / 2.2, 0.0, 1.0 ) ) * 1.15 + ( rf.x - 0.5 ) * 0.6 + ( rsv - 0.5 ) * 0.45 - 0.12;
      roomW = step( 0.5, keepR ) * ( 1.0 - road );
      float roomT = clamp( ( clearD + 0.8 ) / 2.4, 0.0, 1.0 );
      vec3 dust = uClearing * vec3( 1.03, 1.0, 0.95 );
      roomC = valeFlag( mix( uClearing, dust, smoothstep( 0.4, 0.7, nMid ) ) * ( 0.95 + 0.1 * nMid ), rf, grainN, chip * 1.3, 0.06, uClearing * vec3( 0.7, 0.67, 0.62 ), 0.16, fr, jr );
      // the room's centre disc: one worn hearth stone with a carved ring
      float cr = length( p - rc.xy );
      float ring = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( cr - 1.0 ) - 0.03 );
      roomC *= 1.0 - 0.25 * ring;
      float creepR = smoothstep( 0.55, 0.8, roomT * 0.8 + ( tM.a - 0.6 ) * 0.9 + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.5 + ( 1.0 - rf.x ) * 0.2 );
      roomC = mix( roomC, mossC * 0.85, max( jr * smoothstep( 0.2, 0.8, roomT ), creepR * 0.9 ) );
      fr = mix( fr - ring * 0.004, ( tM.a - 0.6 ) * 0.05, creepR );
    }
    col = mix( col, roomC, roomW ); h = mix( h, fr, roomW );
    col = mix( col, vergeC, vergeW ); h = mix( h, fv, vergeW );
    col = mix( col, roadC, road ); h = mix( h, fh, road );
    rough = mix( rough, 0.82, max( vergeW, roomW ) ); rough = mix( rough, 0.66, road );
    // the verge breaking over the road's edge: turf and earth creep in over the carved band and the outer flags in
    // ragged tongues and lie in a ragged strip along it (bare for long stretches, so the kerb still reads), and here
    // and there an outer flag is gone to earth. Lifted above the wood's own moss, so the walked band keeps its floor
    float tongue = smoothstep( 0.4, 0.78, valeNoise( p * 0.34 + 5.0 ) * 0.65 + valeNoise( p * 1.2 + 2.0 ) * 0.35 );
    float coverE = laneD - uLaneHalf + ( -0.3 + 1.35 * tongue ) + ( tM.a - 0.6 ) * 0.6 + ( n2 - 0.5 ) * 0.3;
    float outC = 0.05 + 0.65 * smoothstep( 0.4, 0.8, valeNoise( p * 0.27 + 8.0 ) );
    float coverA = smoothstep( -0.03, 0.09, coverE ) * ( 1.0 - smoothstep( -0.06, 0.1, laneD - uLaneHalf - outC + ( tM.a - 0.6 ) * 0.5 ) );
    float lost = step( fC, 0.2 ) * smoothstep( uLaneHalf - 1.6, uLaneHalf - 0.7, sLane ) * step( sLane, uLaneHalf ) * smoothstep( -0.01, 0.05, fl.y - 0.025 + chip );
    coverA = max( coverA, lost * road ) * ( 1.0 - roomW );
    // the cover's rim: a thin damp contact line on the stone where the turf lies over it
    col *= 1.0 - 0.07 * ( 1.0 - smoothstep( 0.0, 0.07, abs( coverE + 0.02 ) ) ) * road * ( 1.0 - lost ) * ( 1.0 - roomW );
    if ( coverA > 0.0 ) {
      vec3 soilC = mix( uEarth, uClearing, 0.55 ) * ( 0.98 + 0.18 * nMid ) * mix( vec3( 1.0 ), grainN, 0.7 );
      float peb = smoothstep( 0.62, 0.72, valeNoise( p * 6.0 + 1.7 ) );
      soilC = mix( soilC, uLane * 0.9 * grainN, peb * 0.55 );
      // turf: an olive, earth-leaning band (never lime), the painting's cushions calmed toward it
      vec3 turfB = mix( uMoss, uEarth, 0.35 ) * vec3( 1.12, 1.08, 0.86 ) * 1.76;
      turfB = mix( vec3( dot( turfB, LWr ) ), turfB, 0.75 );
      vec3 turfC = valeOrganic( mix( meanM, tM.rgb, 0.45 ), meanM, turfB, 0.75 );
      float turfK = smoothstep( 0.42, 0.64, tM.a + ( valeNoise( p * 0.9 + 9.0 ) - 0.5 ) * 0.5 - lost * 0.12 );
      vec3 coverC = mix( soilC, turfC, turfK );
      col = mix( col, coverC, coverA );
      h = mix( h, ( tM.a - 0.6 ) * 0.045 * turfK + peb * 0.006, coverA );
      rough = mix( rough, 0.92, coverA );
    }
    // GE-1: the road's and the rooms' own stone (never the joints, the carved band, the turf; polished down on the walked track)
    geK = max( road * ( 1.0 - jw ) * ( 1.0 - bandW ) * ( 1.0 - 0.45 * trackP ) * ( 1.0 - dustP * 0.4 ), max( vergeW * 0.55 * ( 1.0 - creep ), roomW * 0.7 ) ) * ( 1.0 - coverA );
    geA = fA * 3.14159; geS = fC;
  }
  // Fallen Shaft floor: pale cool fragments of the shaft lying along its fall, under the water film; a wet bank
  if ( shaftSD < 1.0 ) {
    float shw = 1.0 - smoothstep( -aa, aa, shaftSD );
    float hs, js;
    vec2 sa = p - uShaftAx.xy;
    vec2 sq = vec2( dot( sa, uShaftAx.zw ), dot( sa, vec2( -uShaftAx.w, uShaftAx.z ) ) );
    // env m2: stone seen through water, never a tiled floor: the depth (0 at the bank, 1 from 2.6 m in) bends the
    // courses with a slow refraction wobble that grows with it, and the joints under the film run narrower and close to
    // the stone's own value
    float depthK = smoothstep( 0.0, 2.6, -shaftSD );
    float ct = uWaterT;
    vec2 wob = vec2( valeNoise( p * 0.9 + vec2( ct * 0.33, ct * 0.19 ) ), valeNoise( p * 0.9 + vec2( 3.7 - ct * 0.21, 1.3 + ct * 0.29 ) ) ) - 0.5;
    sq += wob * ( 0.08 + 0.14 * depthK ) * shw;
    vec4 sf = valeCourses( sq + vec2( 31.0, 0.4 ), 1.05, 2.1 );
    vec3 sfc = valeFlag( uShaftFloor * ( 0.95 + 0.1 * nMid ), sf, grainN, chip, mix( 0.06, 0.035, shw ), uShaftFloor * mix( 0.5, 0.8, shw ), mix( 0.18, 0.1, shw ), hs, js );
    sfc *= mix( 0.78, 1.0, smoothstep( -0.9, -0.15, shaftSD ) );
    // depth darkening: the deeper water drinks the warm light first (≈ −12 % value in the middle). Closing env m-1:
    // a hue drift, not a blue wash: green-ochre over the shallow stone at the banks, a quiet cool in the middle, both
    // at a stone's chroma (the pit read as a saturated blue pool at HSV 0.58)
    vec3 bankT = vec3( 1.03, 1.0, 0.86 ), midT = vec3( 0.84, 0.88, 0.9 );
    sfc *= mix( vec3( 1.0 ), mix( bankT, midT, depthK ), shw );
    // light through the ripples: drifting caustic threads on the stone
    float ca = abs( valeNoise( p * 1.25 + vec2( ct * 0.21, ct * 0.13 ) ) * 2.0 - 1.0 );
    float cb = abs( valeNoise( p * 1.9 - vec2( ct * 0.17, -ct * 0.11 ) + 4.0 ) * 2.0 - 1.0 );
    float caust = pow( 1.0 - min( ca, cb ), 7.0 );
    sfc *= vec3( 0.92, 0.96, 0.97 );
    emit += uShaftFloor * caust * 0.09 * shw;
    sfc *= 1.0 + caust * 0.35;
    col = mix( col, sfc, shw ); h = mix( h, hs * mix( 0.5, 0.3, depthK ), shw ); rough = mix( rough, 0.6, shw );
    geK *= 1.0 - shw;
    col *= 1.0 - 0.3 * ( 1.0 - smoothstep( 0.0, 0.7, shaftSD ) ) * ( 1.0 - shw );
  }
#endif
#ifdef VALE_STYLE_SPAN
  // ── the fallen shaft's deck: honed needle stone in long courses along the shaft ──
  vec4 fl = valeCourses( p, 1.18, 2.9 );
  float fh, jw;
  // (lane polish) the long tone (warm and cool drifts over tens of metres), each course stone its own (cool needle
  // grey, warm, plain, ochre-stained), and the walked path down the road: paler, polished, its joints dust-filled
  float lfA = valeFbm( p * 0.017 + 41.0 );
  vec3 longT = mix( vec3( 1.03, 1.0, 0.95 ), vec3( 0.965, 1.0, 1.055 ), smoothstep( 0.3, 0.7, lfA ) ) * ( 0.97 + 0.06 * valeNoise( p * 0.06 + 13.0 ) );
  float fA = valeHash12( fl.zw + 3.17 ), fB = valeHash12( fl.zw * 1.31 + 8.4 );
  float famK = fract( fA + ( lfA - 0.5 ) * 0.6 + 1.0 );
  vec3 fam = famK < 0.35 ? vec3( 0.955, 1.0, 1.08 ) : famK < 0.62 ? vec3( 1.05, 1.0, 0.92 ) : famK < 0.86 ? vec3( 0.99, 1.0, 1.02 ) : vec3( 1.07, 1.01, 0.87 );
  float trackP = ( 1.0 - smoothstep( 1.2, 2.6, laneD + ( nMid - 0.5 ) * 1.2 + ( n2 - 0.5 ) * 0.3 ) ) * ( 0.45 + 0.55 * smoothstep( 0.2, 0.6, valeNoise( p * 0.08 + 4.0 ) ) );
  // (lane polish r2) each course stone its own value too (0.86-1.10, about one in nine a dark or pale outlier); the
  // walked path keeps the families and most of the value, and reads paler by +2-3 L*
  float fD = valeHash12( fl.zw * 0.53 + 2.3 );
  float fVal = ( 0.86 + 0.24 * fB ) * ( fD < 0.06 ? 0.86 : fD > 0.945 ? 1.1 : 1.0 );
  vec3 stoneS = mix( fam * fVal, vec3( 1.04, 1.03, 0.99 ) * mix( 1.0, fVal, 0.7 ), trackP * 0.35 );
  // (held to the deck's own chroma: the families shift the hue, never the saturation band, spec 0.22-0.35)
  vec3 deckB = uLane * longT * stoneS * ( 0.99 + 0.04 * nMid ) * ( 1.0 + 0.12 * trackP );
  deckB = mix( vec3( dot( deckB, vec3( 0.2126, 0.7152, 0.0722 ) ) ), deckB, 0.88 );
  col = valeFlag( deckB, fl, mix( grainN, vec3( 1.0 ), trackP * 0.55 ), chip,
    0.035 - 0.012 * trackP, mix( uGrout, uLane * 0.95, trackP * 0.7 ), 0.04, fh, jw );
  fh *= 0.75 - 0.3 * trackP;
  // moss in the joints in sparse patches where few feet go
  float mossPS = smoothstep( 0.76, 0.9, valeNoise( p * 0.21 + 31.0 ) + ( tM.a - 0.6 ) * 0.5 + ( n2 - 0.5 ) * 0.2 ) * ( 1.0 - trackP );
  col = mix( col, uMoss * mossN * 0.85, jw * mossPS * 0.85 );
  // max2 ENV-11 deck bays: the span was one even run of courses. Every 9 m a cross course of the shaft's paler drum
  // stone (0.84 m) lies across the deck between two joints, a chalk-inlaid hour tick every 1.2 m along its middle, and
  // each bay between takes its own tone (±2.5 %): the deck reads as the fallen needle's drums, bay by bay. Quiet at
  // telegraph scale (hue and ≤ 3 L* on the band, joints a soft ×0.78)
  {
    float bx = p.x / 9.0 + 0.5, bi = floor( bx ), bl = ( fract( bx ) - 0.5 ) * 9.0 + ( valeNoise( p * 1.9 ) - 0.5 ) * 0.04;
    float bayB = 1.0 - smoothstep( 0.42 - aa, 0.42 + aa, abs( bl ) );
    float bayJ = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( abs( bl ) - 0.42 ) );
    col *= mix( 1.0 + 0.09 * ( valeHash12( vec2( bi, 5.3 ) ) - 0.5 ), 1.0, bayB );
    vec3 bandC2 = uLane * longT * vec3( 0.95, 1.0, 1.08 ) * mix( vec3( 1.0 ), grainN, 0.45 ) * ( 1.07 + 0.03 * n2 );
    float tq = abs( fract( p.y / 1.2 ) - 0.5 ) * 1.2;
    float tick = ( 1.0 - smoothstep( 0.045 - aa, 0.045 + aa, tq ) ) * ( 1.0 - smoothstep( 0.15, 0.19, abs( bl ) ) );
    col = mix( col, bandC2, bayB * 0.85 );
    col = mix( col, mix( bandC2, uInscription, 0.55 ), tick * bayB * 0.7 );
    col *= 1.0 - 0.34 * bayJ;
    fh -= bayJ * 0.006;
  }
  // the walked course: the deck is honed palest along the road and weathers darker, stone by stone, toward the drop
  // (r12 B5: the road owns the top of the terrain's value range; the outer courses sit a band lower)
  col *= mix( 1.0, 0.35, smoothstep( uLaneHalf - 0.8, uLaneHalf + 1.8, laneD + ( fl.x - 0.5 ) * 0.9 ) );
  h = fh; rough = 0.7;
  float offLane = smoothstep( uLaneHalf + 1.2, uLaneHalf + 3.5, laneD );
  col = mix( col, uMoss * mossN * 0.8, jw * max( offLane, brush ) * 0.9 );
  float keepL = 0.85 - offLane * 0.45 + ( fl.x - 0.5 ) * 0.8 + gh * 0.6 + wob * 0.15;
  float mossF = ( 1.0 - smoothstep( 0.44, 0.5, keepL ) ) * offLane;
  col = mix( col, uMoss * mossN * 0.78, mossF ); h = mix( h, ( tM.a - 0.6 ) * 0.05, mossF );
  col = mix( col, uThicketFloor * mossN, brush * 0.9 );
  // GE-1: the deck's needle stone, tooled across the course (each course stone a little off square)
  geK = ( 1.0 - jw ) * ( 1.0 - 0.45 * trackP ) * ( 1.0 - max( mossF, brush ) );
  geA = 1.5708 + ( fA - 0.5 ) * 0.7; geS = fB;
  // the Snap: fine crazing (grooves) and the lit fracture
  float cz = 1.0 - smoothstep( -aa, aa, inl.g );
  float czL = ( 1.0 - smoothstep( -aa, aa, inl.g - 0.02 ) ) - cz;
  float lit = 1.0 - smoothstep( -aa, aa, inl.b );
  float litE = ( 1.0 - smoothstep( -aa, aa, inl.b - 0.03 ) ) - lit;
  float litGlow = 1.0 - smoothstep( -aa, 0.3, inl.b );
  // the drop: a pale chalk band of carved hour-script on every walkable edge (0.4 m); never under the brush
  float bandS = ( 1.0 - smoothstep( 0.4 - aa, 0.4 + aa, edgeD ) ) * ( 1.0 - brush );
  vec3 bandC = uInscription * grainN * ( 0.95 + 0.1 * n2 );
  bandC = mix( bandC, bandC * 0.62, cz );
  bandC *= 1.0 + 0.06 * czL;
  float bEdge = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( edgeD - 0.4 ) );
  bandC *= 1.0 - 0.4 * bEdge;
  col = mix( col, col * 0.72, cz * ( 1.0 - bandS ) );
  col *= 1.0 + 0.05 * czL * ( 1.0 - bandS );
  col = mix( col, bandC, bandS ); h = mix( h, -cz * 0.006, bandS ); h -= cz * 0.006 * ( 1.0 - bandS );
  rough = mix( rough, 0.75, bandS );
  // (lane polish) a walker's chalk marks on the deck (terrain_inlay.ts laneDecals, the free chalk channel), rubbed and
  // broken by the grain; the hairline cracks share the crazing's groove channel above
  float dcS = ( 1.0 - smoothstep( -aa, aa, inl.r ) ) * smoothstep( 0.5, 0.85, valeNoise( p * 11.0 + 3.0 ) * 0.5 + tG.a * 0.6 + valeNoise( p * 2.7 ) * 0.25 ) * ( 1.0 - bandS );
  col = mix( col, uInscription * 1.02 * mix( vec3( 1.0 ), grainN, 0.4 ), dcS * 0.7 );
  // the fracture: dark broken lips, a lit seam deep inside. Its core is capped at ~luma 160 (L* 65, r12 B5): the
  // fracture reads by contrast against its dark lips, never as a near-white line where telegraphs and skill shots draw
  geK *= ( 1.0 - bandS ) * ( 1.0 - cz ) * ( 1.0 - litE ) * ( 1.0 - lit );
  col = mix( col, col * 0.45, litE );
  col = mix( col, uLitC * 0.24, lit );
  col = mix( col, col * 1.1, litGlow * ( 1.0 - lit - litE ) );
  emit = uLitC * ( lit * 0.13 + litGlow * 0.04 * ( 1.0 - litE ) );
  h -= lit * 0.012 + litE * 0.01;
#endif
#ifdef VALE_STYLE_PLATE
  // ── the Noonplate at the Shadowless Noon: honed dial-stone in rings of great slabs under the overhead sun
  //    (L* 34-40 in vision, r12 B5; fog of war still darkens it), faint grey veins, a satin sheen. The ten
  //    hour-lines and the numerals are inlaid DARK (basalt in the pale stone, like a sundial's cut lines), the
  //    shop ring a mid inlay, the hour-ring and half-hour ticks cut as grooves with a sunlit lip ──
  vec4 pf = valeRingFlags( p, uPlate.xy, 4.15, 3.3, 3.9 );
  float fh, jw;
  // honed, not cast: each slab one even tone of its own (no cloudy mottle across it), a fine grain, crisp joints
  vec3 basN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.22 );
  float sv = valeHash12( pf.zw + 7.7 );
  vec3 slabC = uLane * ( 0.94 + 0.1 * valeHash12( pf.zw + 1.9 ) + 0.025 * ( nMid - 0.5 ) ) * mix( vec3( 1.02, 1.0, 0.97 ), vec3( 0.98, 1.0, 1.025 ), sv );
  // (lane polish) honed, but quarried: a slab now and then from a warmer or a cooler bed, the long tone drifting across
  // the plate, and worn scuffs of chalk-dust where the fair's feet turn (value held: the plate stays one quiet band)
  float pfam = valeHash12( pf.zw + 6.1 );
  slabC *= pfam < 0.18 ? vec3( 1.05, 1.0, 0.9 ) : pfam < 0.34 ? vec3( 0.96, 1.0, 1.07 ) : vec3( 1.0 );
  float lfP = valeFbm( p * 0.04 + 41.0 );
  slabC *= mix( vec3( 1.025, 1.0, 0.95 ), vec3( 0.975, 1.0, 1.04 ), smoothstep( 0.3, 0.7, lfP ) );
  float scuff = smoothstep( 0.55, 0.8, valeFbm( p * 0.16 + 9.0 ) + ( valeNoise( p * 1.3 ) - 0.5 ) * 0.25 );
  // (r2) the dust is the plate's own stone ground fine: its colour a third desaturated, leaned warm-pale at the same
  // luminance (the tint's own luminance is 1) and a touch lifted, never toward grey (on the warm plate grey read as a
  // cool stain)
  float slL = dot( slabC, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 chalkD = mix( vec3( slL ), slabC, 0.7 ) * vec3( 1.02, 1.0, 0.94 ) * 1.03;
  slabC = mix( slabC, chalkD, scuff * 0.45 );
  col = valeFlag( slabC, pf, basN, chip * 0.6, 0.03, uLane * 0.62, 0.1, fh, jw );
  // veins: thin grey mineral threads wandering across some slabs
  vec2 vq = p * 0.55 + pf.zw * 3.1;
  float vn = abs( valeNoise( vq ) + 0.5 * valeNoise( vq * 2.3 + 1.7 ) - 0.75 );
  float vein = ( 1.0 - smoothstep( 0.0, 0.03, vn ) ) * smoothstep( 0.5, 0.8, valeHash12( pf.zw + 4.0 ) );
  col = mix( col, uLane * 0.72, vein * 0.3 );
  h = fh * 0.7; rough = 0.52 + 0.08 * valeHash12( pf.zw + 9.0 );
  gSheen = 0.6 + 0.4 * valeHash12( pf.zw + 2.0 );
  // a worn, paler course of stone at the foot of the rim wall and round the hour-stones (where every walker turns),
  // so their contact shadow never sinks the walked stone below its band (r12 B5: walkable p95 - p5 <= 45 in every
  // seat's spawn view)
  col *= 1.0 + 0.14 * ( 1.0 - smoothstep( 0.05, 1.0, wallD ) );
  col = mix( col, uThicketFloor * mossN, brush * 0.9 );
  float ch = 1.0 - smoothstep( -aa, aa, inl.r );
  float md = 1.0 - smoothstep( -aa, aa, inl.a );
  // the inlays sit in a cut: a thin shadowed lip on the inlay's edge
  float chE = ( 1.0 - smoothstep( -aa, aa, min( inl.r, inl.a ) - 0.03 ) ) - max( ch, md );
  col *= 1.0 - 0.18 * chE;
  col = mix( col, uInscription * mix( vec3( 1.0 ), grainN, 0.5 ), ch );
  col = mix( col, uMidInlay * grainN, md );
  h -= ( ch + md ) * 0.003 + chE * 0.004;
  rough = mix( rough, 0.6, max( ch, md ) );
  gSheen *= 1.0 - max( ch, md );
  // carved grooves (the hour-ring, the half-hour ticks): a dark channel, its far wall catching the sun
  float cg = 1.0 - smoothstep( -aa, aa, inl.g );
  float cgL = ( 1.0 - smoothstep( -aa, aa, inl.g - 0.035 ) ) - cg;
  col = mix( col, col * 0.52, cg );
  col *= 1.0 + 0.1 * cgL;
  h -= cg * 0.012;
  gSheen *= 1.0 - cg;
  // GE-1: the plate's honed slabs carry a lighter dressing (never the inlays, the grooves, the brush)
  geK = 0.7 * ( 1.0 - jw ) * ( 1.0 - max( max( ch, md ), max( cg, brush ) ) );
  geA = valeHash12( pf.zw + 3.3 ) * 3.14159; geS = sv;
  // each hour-mark's groove, lit in its seat colour (fixed per seat, identical for every viewer; below bloom)
  float sg = 1.0 - smoothstep( -aa, aa, inl.b );
  if ( sg > 0.0 ) {
    vec2 sd = p - uPlate.xy;
    float bear = mod( degrees( atan( sd.x, -sd.y ) ) + 360.0, 360.0 );
    int si = int( mod( floor( bear / 36.0 + 0.5 ), 10.0 ) );
    vec3 sc = uSeatCol[ 0 ];
    for ( int k = 1; k < 10; k ++ ) if ( k == si ) sc = uSeatCol[ k ];
    col = mix( col, sc * 0.35, sg );
    geK *= 1.0 - sg;
    emit += sc * 0.32 * sg;
    h -= sg * 0.006;
  }
#endif
  // ── base plazas: Aubade chalk flags with dawnglass rings, Serenade ochre sandstone with lampresin; a kerbed
  //    border course rings each plaza, so the plaza and the road never read as stamped over each other ──
  for ( int k = 0; k < 2; k ++ ) {
    vec4 PZ = k == 0 ? uPlaza0 : uPlaza1;
    vec4 FT = k == 0 ? uFount0 : uFount1;
    if ( PZ.z <= 0.0 ) continue;
    float pd = length( p - PZ.xy );
    if ( pd > PZ.z + 0.5 ) continue;
    float pw = 1.0 - smoothstep( PZ.z - aa, PZ.z + aa, pd );
    vec4 pf = valeRingFlags( p, FT.xy, FT.z + 0.4, 1.35, 1.75 );
    vec3 pband = PZ.w < 0.5 ? uPlazaA : uPlazaS;
    vec3 ic = PZ.w < 0.5 ? uInlayA : uInlayS;
    float ph, pj;
    // closing env m-3: the breakup runs as strokes along the rings (a long stretch round the fountain, short across
    // it), at <= 4 L*: never the cloud blotch the low-frequency nMid left on the flags
    vec2 prq = p - FT.xy;
    float prr = length( prq );
    float pstk = valeRingStroke( prr, atan( prq.y, prq.x ), PZ.w * 7.0 + float( k ) * 3.1 );
    // max2 ENV-5 plaza dressing: every flag its own stone (hue at its value, as the road's are: a warm, a cool and a
    // pale family per side, ±3 % value, one flag in eleven a replaced one a step darker); a walked track paler from
    // the fountain out toward the map's middle (where the lanes leave); wind-drift of litter and dust against the kerb
    float pA = valeHash12( pf.zw * 1.17 + 4.3 ), pB = valeHash12( pf.zw * 0.61 + 9.1 );
    vec3 pfam = pA < 0.34 ? vec3( 1.07, 1.0, 0.89 ) : pA < 0.67 ? vec3( 0.95, 0.99, 1.09 ) : vec3( 1.0, 1.0, 0.98 );
    float pval = ( 0.95 + 0.08 * pB ) * ( valeHash12( pf.zw * 2.03 + 1.7 ) < 0.09 ? 0.86 : 1.0 );
    vec2 toMid = normalize( uMapSize * 0.5 - FT.xy + vec2( 1e-3 ) );
    float along = dot( p - FT.xy, toMid ), across = abs( dot( p - FT.xy, vec2( -toMid.y, toMid.x ) ) );
    float ptrack = ( 1.0 - smoothstep( 1.6, 3.4, across + ( nMid - 0.5 ) * 1.2 ) ) * smoothstep( FT.z + 2.6, FT.z + 4.5, along );
    vec3 pfl = pband * mix( pfam * pval, vec3( 1.035, 1.03, 1.0 ), ptrack * 0.6 );
    vec3 pc = valeFlag( pfl * ( 0.975 + 0.05 * pstk ), pf, grainN, chip, 0.04, pband * 0.68, 0.1, ph, pj );
    pc = mix( pc, uMoss * mossN * 0.85, pj * smoothstep( PZ.z - 3.0, PZ.z - 0.6, pd + wob ) * ( 1.0 - ptrack ) );
    float pdrift = smoothstep( PZ.z - 3.4, PZ.z - 0.7, pd + ( valeNoise( p * 0.7 + 5.0 ) - 0.5 ) * 1.6 )
                 * smoothstep( 0.45, 0.75, valeNoise( p * 0.33 + float( k ) * 9.0 ) ) * ( 1.0 - ptrack );
    float pleaf = smoothstep( 0.62, 0.8, valeNoise( p * 3.1 + 2.0 ) * 0.6 + valeNoise( p * 7.3 ) * 0.4 );
    vec3 driftC = mix( pband * vec3( 0.9, 0.86, 0.76 ) * grainN, uEarth * 1.6 * vec3( 1.1, 0.95, 0.7 ), pleaf );
    pc = mix( pc, driftC, pdrift * 0.55 );
    float fr = length( p - FT.xy );
    // the fountain floor: one honed disc engraved with the twelve hours
    float ang = atan( p.y - FT.y, p.x - FT.x );
    float seg = 6.2831853 / 12.0;
    float al = abs( mod( ang + seg * 0.5, seg ) - seg * 0.5 ) * fr;
    float inner = 1.0 - smoothstep( FT.z + 0.4 - aa, FT.z + 0.4 + aa, fr );
    // env m-3: the honed disc keeps a third of the grain painting (at full strength its 3 m tiles read as cloud
    // stains across the floor) and takes the ring strokes instead
    pc = mix( pc, pband * 1.03 * mix( vec3( 1.0 ), grainN, 0.3 ) * ( 0.98 + 0.04 * pstk ), inner );
    float hourL = ( 1.0 - smoothstep( -aa, aa, al - 0.04 ) ) * step( 1.0, fr ) * inner;
    // inlay: the fountain's rim ring and the twelve hour-ticks round it, each set in a carved channel; the ticks are
    // cut into the dais top (a faint inlay, never a stamped stripe)
    float ringD = abs( fr - FT.z ) - 0.085;
    float tickD = max( al - 0.05, max( FT.z + 0.55 - fr, fr - ( FT.z + 2.4 ) ) );
    float inD = min( ringD, tickD );
    float iw = 1.0 - smoothstep( -aa, aa, inD );
    float tw = ( 1.0 - smoothstep( -aa, aa, tickD ) ) * step( tickD, ringD );
    float chn = ( 1.0 - smoothstep( -aa, aa, inD - 0.045 ) ) - iw;
    pc *= 1.0 - 0.32 * chn - 0.1 * hourL;
    vec3 icm = mix( vec3( dot( ic, vec3( 0.2126, 0.7152, 0.0722 ) ) ), ic, 0.7 );
    pc = mix( pc, mix( pband, icm, 0.7 - 0.4 * tw ) * grainN * ( 0.96 + 0.08 * n2 ) * ( 1.0 - 0.12 * tw ), iw );
    float pH = ph * ( 1.0 - inner ) - chn * 0.006 - hourL * 0.004;
    // env F1: the spawn dais, one low step of honed stone (DAIS_H) round the fountain floor out to the hour-ring. The
    // ground stays flush (fighters walk on and off it), so the step is drawn: the riser is a steep height ramp
    // (DAIS_RW wide) the bumped normal lights from the real sun, a chalk arris runs along the top edge, a dark
    // joint and a soft contact shade lie at its foot, and the top reads a shade lighter than the flags round it
    float dR = FT.z + 2.95, dRise = fr - dR;
    float dTop = 1.0 - smoothstep( -aa, aa, dRise );
    float dRamp = clamp( dRise / DAIS_RW, 0.0, 1.0 );
    float dH = DAIS_H * ( 1.0 - dRamp * dRamp * ( 3.0 - 2.0 * dRamp ) );
    float arris = ( 1.0 - smoothstep( 0.0, 0.035 + aa, abs( dRise + 0.03 ) ) ) * ( 0.92 + 0.08 * n2 );
    float riser = step( 0.0, dRise ) * ( 1.0 - smoothstep( DAIS_RW - aa, DAIS_RW + aa, dRise ) );
    float foot = 1.0 - smoothstep( 0.0, 0.05 + aa, abs( dRise - DAIS_RW ) );
    float contact = ( 1.0 - smoothstep( DAIS_RW, DAIS_RW + 0.45, dRise ) ) * step( DAIS_RW, dRise );
    pc *= mix( 1.0, 1.035, dTop * ( 1.0 - inner ) );
    pc = mix( pc, pband * 0.8 * grainN * ( 0.94 + 0.12 * n2 ), riser );
    pc *= 1.0 - 0.38 * foot - 0.16 * contact;
    pc = mix( pc, mix( pband, uLitC, 0.25 ) * 1.12 * grainN, arris * 0.55 );
    pH = mix( pH, 0.0, riser ) + dH;
    // the border course: long dressed kerb stones on the rim (0.6 m), a dark joint either side
    float kIn = PZ.z - 0.6;
    float kerb = smoothstep( kIn - aa, kIn + aa, pd );
    float kang = atan( p.y - PZ.y, p.x - PZ.x );
    float kn = floor( 6.2831853 * ( PZ.z - 0.3 ) / 1.6 );
    float kt = ( kang / 6.2831853 + 0.5 ) * kn;
    float kl = fract( kt );
    float ke = min( min( kl, 1.0 - kl ) * 1.6, min( pd - kIn, PZ.z - pd ) ) + chip * 0.4;
    float kr = valeHash12( vec2( floor( kt ), PZ.w + 3.0 ) );
    vec3 kc = pband * ( 0.86 + 0.1 * kr ) * grainN * ( 0.95 + 0.1 * n2 );
    kc *= mix( 0.62, 1.0, smoothstep( 0.0, 0.06, ke ) );
    kc = mix( kc, uMoss * mossN * 0.7, ( 1.0 - smoothstep( 0.0, 0.025, ke ) ) * smoothstep( 0.4, 0.7, nMid ) * 0.6 );
    // closing env m-2: the flush dial hand from the fountain ring to the shop (terrain.ts): its shaft and tip in the ring's
    // own inlay, the grooves and hour ticks cut dark; the plaza is painted over the ground's inlay pass, so it reads them here
    float hhG = 1.0 - smoothstep( -aa, aa, inl.g );
    float hhC = 1.0 - smoothstep( -aa, aa, inl.r );
    pc *= 1.0 - 0.34 * hhG;
    pc = mix( pc, mix( pband, icm, 0.7 ) * grainN * ( 0.96 + 0.08 * n2 ), hhC );
    pH -= hhG * 0.004;
    pc = mix( pc, kc, kerb );
    pH = mix( pH, 0.012 + smoothstep( 0.0, 0.06, ke ) * 0.02, kerb );
    col = mix( col, pc, pw );
    h = mix( h, pH, pw );
    // GE-1: the plaza's flags (the honed disc, its inlays, the step and the kerb's joints stay clean)
    geK = mix( geK, 0.65 * ( 1.0 - pj ) * ( 1.0 - inner * 0.5 ) * ( 1.0 - max( iw, max( riser, foot ) ) ) * ( 1.0 - hhG ) * ( 1.0 - hhC ), pw );
    if ( pw > 0.5 ) { geA = pf.x * 3.14159; geS = fract( pf.x * 7.3 ); }
    rough = mix( rough, mix( mix( 0.64, 0.5, iw ), 0.72, kerb ), pw );
  }
  // ── the Seat: the needle's base-stone, flush; rim step, socket scar, twelve hour-ticks ──
  if ( uSeat.z > 0.0 ) {
    float sd = length( p - uSeat.xy );
    if ( sd < uSeat.z + 0.5 ) {
      vec4 sf = valeRingFlags( p, uSeat.xy, 3.45, 1.52, 2.2 );
      float shh, sj;
      vec2 srq = p - uSeat.xy;
      float sstk = valeRingStroke( sd, atan( srq.y, srq.x ), 11.0 );   // env m-3: ring strokes, never cloud blotches
      vec3 sc = valeFlag( uSeatC * ( 0.98 + 0.045 * sstk ), sf, grainN, chip * 0.5, 0.025, uSeatC * 0.8, 0.06, shh, sj );
      float sock = 1.0 - smoothstep( 0.0, 0.06 + aa, abs( sd - 3.05 ) - 0.38 );
      sc = mix( sc, uSeatC * 0.84 * grainN * ( 0.85 + 0.3 * valeNoise( p * 6.0 ) ), sock );
      float inner = 1.0 - smoothstep( 2.6 - aa, 2.6 + aa, sd );
      sc = mix( sc, uSeatC * 1.03 * mix( vec3( 1.0 ), grainN, 0.3 ) * ( 0.98 + 0.04 * sstk ), inner );   // env m-3
      float ang = atan( p.y - uSeat.y, p.x - uSeat.x );
      float seg = 6.2831853 / 12.0;
      float al = abs( mod( ang + seg * 0.5, seg ) - seg * 0.5 ) * sd;
      float tk = 1.0 - smoothstep( -aa, aa, max( al - 0.055, abs( sd - 6.9 ) - 0.55 ) );
      sc *= 1.0 - 0.13 * tk;
      float rimD = sd - uSeat.z;
      float stepL = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( rimD + 0.05 ) - 0.03 );
      float lip = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( rimD + 0.15 ) - 0.05 );
      sc *= 1.0 - 0.4 * stepL; sc *= 1.0 + 0.1 * lip;
      float sw = 1.0 - smoothstep( uSeat.z - aa, uSeat.z + aa, sd );
      col = mix( col, sc, sw ); h = mix( h, shh * 0.6 - tk * 0.005 - stepL * 0.02 + lip * 0.006, sw ); rough = mix( rough, 0.55, sw );
      geK = mix( geK, 0.65 * ( 1.0 - sj ) * ( 1.0 - sock ) * ( 1.0 - tk ) * ( 1.0 - stepL ), sw );
      if ( sw > 0.5 ) { geA = sf.x * 3.14159; geS = fract( sf.x * 7.3 ); }
    }
  }
  // GE-1: dressed stone at the scale the game camera actually shows (3-12 px): the mason's tool marks, running one way
  // on each flag and coming and going across it, fine pits, and rubbed chalk flecks. Centred on 1, so the band's value
  // holds (B5); it fades before it would alias (a zoomed-out or Low view). Off (0) costs one branch
  if ( uGeStone > 0.0 && geK > 0.004 && inMap ) {
    float fpK = uGeStone * geK * ( 1.0 - smoothstep( 0.024, 0.042, aa ) );
    vec2 gd = vec2( cos( geA ), sin( geA ) );
    vec2 gq = vec2( dot( p, gd ), dot( p, vec2( -gd.y, gd.x ) ) );
    // (three fetches of a small tile of value noise, no noise calls: the layer has to pay for itself on the most-covered
    // surface. The grain painting is too soft to carry this scale. Tile: terrain.ts geStoneTile, 32 cells across)
    // the pits and flecks rotated off the map axes and warped by the grit, so the noise's lattice never shows as rows of dots
    float gGrit = texture( uGeTile, ( p * 26.0 + 3.7 ) / 32.0 ).g - 0.5;
    float gStroke = texture( uGeTile, vec2( gq.x * 0.7 + geS * 61.0, gq.y * 12.0 + geS * 17.0 + gGrit * 1.6 ) / 32.0 ).r - 0.5;
    float gPatch = smoothstep( 0.34, 0.68, nMid + ( geS - 0.5 ) * 0.4 );
    vec2 gR = vec2( 0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y ) * 13.0 + 7.3 + gGrit * 2.6;
    vec4 gF = texture( uGeTile, gR / 32.0 );
    float gPit = smoothstep( 0.76, 0.9, gF.g );
    float gFleck = smoothstep( 0.8, 0.9, gF.b );
    col *= 1.0 + fpK * ( gStroke * gPatch * 0.18 + gGrit * 0.16 - gPit * 0.17 + gFleck * 0.1 + 0.018 );
    h += fpK * ( gStroke * gPatch * 0.005 - gPit * 0.002 );
  }
  // wall-foot occlusion (never on the gorge's own edges: the splat's wall field skips chasms)
  col *= mix( 0.5, 1.0, smoothstep( 0.0, 1.9, wallD + ( n2 - 0.5 ) * 0.35 ) );
  // outside the map: rough plateau ground (gorge maps show it beyond the far walls): moss, litter, bare rock
  if ( !inMap ) {
#ifdef VALE_GORGE
    float hP;
    col = valeRockPlateau( p, uTexGrain, uTexMoss, uRockC * 1.55, uMoss, hP );
    h = hP; rough = 0.9; emit = vec3( 0.0 ); gSheen = 0.0;
#else
    vec4 tO = valeTex2( uTexLitter, p / 6.0, valeNoise( p * 0.11 ) );
    vec3 mO = valeTexMean( uTexLitter );
    vec3 og = valeOrganic( mix( mO, tO.rgb, 0.8 ), mO, mix( uMoss, uEarth, smoothstep( 0.4, 0.7, nBig ) ), 0.5 );
    og = mix( og, uEarth * 1.2 * grainN, smoothstep( 0.62, 0.7, valeNoise( p * 0.21 ) + gh ) );
    col = og; h = ( tO.a - 0.6 ) * 0.05; rough = 0.95; emit = vec3( 0.0 ); gSheen = 0.0;
#endif
  }
  // the temperature field: a cool cast west, a warm cast east (never a team hue)
  vec3 tmp = mix( uTempW, uTempE, smoothstep( 0.12, 0.88, p.x / uMapSize.x ) );
  col *= mix( vec3( 1.0 ), tmp, uTempK );
  // r12 M14: the quadrant tint, off the roads
  col *= mix( vec3( 1.0 ), valeQuadTint( p ), smoothstep( uLaneHalf, uLaneHalf + 3.0, laneD ) );
  diffuseColor.rgb *= col;
  gHeight = h; gRough = rough; gEmit = emit;
}
`,Ko=`
if ( gSheen > 0.0 ) {
  vec3 Vv = normalize( vViewPosition );
  float nv = clamp( dot( normal, Vv ), 0.0, 1.0 );
  totalEmissiveRadiance += uSheenC * gSheen * smoothstep( 0.97, 0.6, nv );
#if NUM_DIR_LIGHTS > 0
  // honed stone's satin: a broad, soft lobe of the overhead sun drifting across the plate as the camera moves,
  // a little stronger on some slabs than others (a mirror would be a hot spot; this is a sheen)
  vec3 Hs = normalize( directionalLights[ 0 ].direction + Vv );
  float satin = pow( clamp( dot( normal, Hs ), 0.0, 1.0 ), 6.0 );
  totalEmissiveRadiance += directionalLights[ 0 ].color * diffuseColor.rgb * satin * 0.14 * gSheen;
#endif
}
`,qo=`
attribute vec4 aWallA; attribute vec4 aWallB;
varying vec4 vWA; varying vec4 vWB; varying vec3 vCliffW; varying vec3 vCliffN;
`,Jo=`
vWA = aWallA; vWB = aWallB;
vCliffW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vCliffN = normalize( mat3( modelMatrix ) * objectNormal );
`,Yo=`
varying vec4 vWA; varying vec4 vWB; varying vec3 vCliffW; varying vec3 vCliffN;
uniform vec3 uFace, uLip, uEdgeLight, uTop, uMossC, uFlank, uRock, uEarthC, uCanopy;
uniform sampler2D uTexGrain, uTexMoss, uTexLitter;
uniform sampler2D uSplat2; uniform vec2 uSplatScale;
uniform vec3 uTempW, uTempE; uniform float uTempK; uniform vec2 uMapSize;
uniform float uStoneTop;   // 1: a clean stone stage (no moss, pale glare tops); 2: the gorge's bare rim plateau
uniform vec3 uPlateW;      // the Noonplate's centre (x, z) and radius: the fair's court beyond its rim
uniform vec3 uGlareNear;   // the court's stone by the rim wall (the plate's own value); it hazes out to uTop
float cH; float cRough;
`,Xo=`
{
  float u = vWA.x, vl = vWA.y, course = vWA.z;
  int kind = int( vWA.w + 0.5 );
  float sh = vWB.x, seed = vWB.y, wallH = vWB.w;
  vec3 P = vCliffW;
  // texture space: world xz on flat-ish strips (lip tops, chamfers, caps), arc length × height on the faces.
  // (u, height) on a flat strip would read one row of every painting: streaks like brushed metal.
  bool flatS = abs( vCliffN.y ) > 0.6;
  vec2 fuv = flatS ? P.xz : vec2( u, P.y );
  vec4 tG = texture( uTexGrain, fuv / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.7 );
  float gh = tG.a - 0.6;
  float n2 = valeNoise( fuv * 2.1 + seed );
  float nm = valeNoise( vec2( fuv.x * 0.23, fuv.y * 0.5 ) + seed * 3.0 );
  float chip = ( valeNoise( fuv * 8.0 + seed ) - 0.5 ) * 0.05 + gh * 0.12;
  vec3 c = uFace; float h = 0.0; float rough = 0.86;
  float stoneK = step( 0.5, uStoneTop ) * ( 1.0 - step( 1.5, uStoneTop ) );   // the Noonplate's clean stone
  if ( kind <= 1 ) {
    // cut-stone courses: rock-faced blocks, per-course length, tint and set-back; chunky chisel facets
    float L = 1.15 + 1.25 * valeHash12( vec2( course, seed ) );
    float bu = u / L + floor( valeHash12( vec2( course + 3.1, seed ) ) * 9.0 ) + 0.5 * valeHash12( vec2( course, seed + 1.0 ) );
    float bi = floor( bu ), bl = fract( bu );
    float ew = min( bl, 1.0 - bl ) * L;
    float eh = kind == 0 ? min( vl, 1.0 - vl ) * sh : 0.3;
    float e = min( ew, eh ) + chip;
    float jt = 1.0 - smoothstep( 0.008, 0.032, e );
    vec2 bid = vec2( bi, course + seed * 17.0 );
    float r1 = valeHash12( bid ), r2 = valeHash12( bid * 1.71 + 4.2 ), r3 = valeHash12( bid * 2.3 + 9.1 );
    vec2 lc = vec2( bl - 0.5, vl - 0.5 ) * vec2( L, sh );
    float facet = dot( lc, vec2( r2 - 0.5, r3 - 0.5 ) ) * 0.16 + ( 0.2 - dot( lc, lc ) * 0.35 ) * 0.07 * r1;
    // knapped faces: a few broad chisel scallops per block
    float sc = valeNoise( vec2( u * 2.2, P.y * 2.6 ) + bid * 3.1 );
    h = smoothstep( 0.0, 0.12, e ) * ( 0.05 + facet + ( sc - 0.5 ) * 0.035 ) + gh * 0.03 + ( n2 - 0.5 ) * 0.01;
    float ct = valeHash12( vec2( course, seed * 2.0 + 1.0 ) );
    c = uFace * ( 0.76 + 0.4 * r1 ) * ( 0.86 + 0.28 * ct ) * grainN * ( 0.92 + 0.16 * sc );
    c *= vec3( 1.0 + 0.08 * ( r2 - 0.5 ), 1.0, 1.0 - 0.09 * ( r2 - 0.5 ) );
    c *= mix( 0.66, 1.0, smoothstep( 0.0, 0.16, e ) );
    c = mix( c, uFace * 0.32, jt );
    // broad weathering along the wall, damp foot, moss from the ground and in the joints, streaks under the lip
    c *= 0.84 + 0.3 * valeNoise( vec2( u * 0.09, P.y * 0.2 ) + seed * 7.0 );
    c *= mix( 0.6, 1.0, smoothstep( -0.1, 1.3, P.y ) );
    vec3 mM = valeTexMean( uTexMoss );
    vec3 mossC = valeOrganic( mix( mM, texture( uTexMoss, fuv / 4.0 ).rgb, 0.7 ), mM, uMossC, 0.5 );
    float foot = 1.0 - smoothstep( 0.0, 0.8, P.y + ( nm - 0.5 ) * 0.7 );
    float mossAmt = max( foot * smoothstep( 0.3, 0.6, nm ), jt * smoothstep( 0.5, 0.75, nm ) ) * 0.85 * ( 1.0 - stoneK );
    float streak = smoothstep( 0.6, 0.85, valeNoise( vec2( u * 1.9, P.y * 0.12 ) + seed ) ) * smoothstep( wallH - 1.8, wallH - 0.4, P.y ) * ( 1.0 - stoneK );
    c = mix( c, mossC * 0.8, max( mossAmt, streak * 0.55 ) );
    rough = 0.88;
  } else if ( kind <= 5 ) {
    // the carved lip: dressed cap stones with joints, a painted edge light on the chamfer; clean stone, so the
    // edge of every block reads crisp (moss only in the inner bevel, where the top's moss meets it)
    float L = 1.15 + 0.5 * valeHash12( vec2( seed, 5.0 ) );
    float bu = u / L;
    float bi = floor( bu ), bl = fract( bu );
    float e = min( bl, 1.0 - bl ) * L + chip;
    float jt = 1.0 - smoothstep( 0.008, 0.03, e );
    float r1 = valeHash12( vec2( bi, seed ) );
    c = uLip * ( 0.9 + 0.16 * r1 ) * grainN * ( 0.95 + 0.1 * n2 );
    c *= mix( 0.78, 1.0, smoothstep( 0.0, 0.12, e ) );
    c = mix( c, uLip * 0.45, jt );
    h = smoothstep( 0.0, 0.08, e ) * 0.02 + gh * 0.02;
    if ( kind == 2 ) c *= mix( 0.8, 1.0, vl );
    // the painted edge light: uEdgeLight is capped (terrain.ts) at L* 48 on screen; no block lifts above it
    if ( kind == 3 ) c = mix( c, uEdgeLight * ( 0.9 + 0.1 * r1 ), 0.7 * ( 1.0 - jt ) * smoothstep( 0.15, 0.6, vl ) );
    if ( kind == 4 ) c *= 1.0 - 0.1 * smoothstep( 0.55, 1.0, vl );
    if ( kind == 5 ) {
      // the inner bevel: the wood's dark floor creeping over the cap's inner edge in a ragged line — opaque moss
      // (no joint runs through it), never a tinted film over the stone
      vec4 tM5 = texture( uTexMoss, P.xz / 3.0 );
      vec3 mM5 = valeTexMean( uTexMoss );
      vec3 mossF = valeOrganic( mix( mM5, tM5.rgb, 0.6 ), mM5, mix( uCanopy, uEarthC, 0.45 ) * 0.3, 0.6 );
      float cover = smoothstep( 0.4, 0.6, vl + ( valeNoise( vec2( u * 1.7, seed ) ) - 0.5 ) * 0.8 + ( tM5.a - 0.6 ) * 0.6 ) * ( 1.0 - stoneK ) * ( 1.0 - step( 1.5, uStoneTop ) );
      c = mix( c * 0.78, mossF, cover );
    }
    rough = 0.8;
  } else if ( kind == 6 && uStoneTop > 1.5 ) {
    // Needlespan's terrace-end blocks: the same bare rim plateau as beyond the far walls
    float hP;
    c = valeRockPlateau( vec2( u, vl ), uTexGrain, uTexMoss, uRock * 1.55, uMossC, hP );
    h = hP; rough = 0.9;
  } else if ( kind == 6 && uStoneTop > 0.5 ) {
    // a carved block's top (the Noonplate's hour-stones): the cap stone itself
    vec2 q = vec2( u, vl );
    vec4 tq = texture( uTexGrain, q / 3.0 );
    if ( wallH < 2.0 ) {
      // a low carved block (an hour-stone): basalt cap, chalk-lit by the lip around it
      c = uLip * 0.62 * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.6 );
      h = ( tq.a - 0.6 ) * 0.03;
      rough = 0.7;
    } else {
      // beyond the rim: the fair's court at the Shadowless Noon (r12 B5). Worn chalk-stone setts (cobbled, never the
      // plate's honed rings) start at the plate's own value by the rim wall (uGlareNear) and dissolve outward into the
      // noon haze (uTop, a hazier mid-tone, L* <= 52 on screen): still the bright boundary the plate sits in, never
      // the top of the value range (tokens grade.maps.fray.fog.rimGlare)
      vec2 pq = P.xz;
      float dr = length( pq - uPlateW.xy ) - uPlateW.z;
      float hz = smoothstep( 0.8, 9.0, dr + ( valeNoise( pq * 0.07 ) - 0.5 ) * 3.0 );
      vec4 rf = valePavers( pq + vec2( valeNoise( pq * 0.3 ), valeNoise( pq * 0.3 + 5.0 ) ) * 0.5, 1.7 );
      vec3 gN = mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.45 );
      float fh, fj;
      vec3 court = valeFlag( uGlareNear * ( 0.92 + 0.14 * valeNoise( pq * 0.11 + 3.0 ) ), rf, gN, chip * 0.6, 0.04, mix( uGlareNear * 0.76, uTop * 0.85, hz ), 0.14, fh, fj );
      // chalk dust drifted over the joints and the worn slabs, thicker further out
      float dust = smoothstep( 0.45, 0.8, valeNoise( pq * 0.21 + 7.0 ) * 0.75 + hz * 0.45 );
      court = mix( court, uTop * 0.82 * gN, dust * 0.45 );
      c = mix( court, uTop * ( 0.95 + 0.1 * valeNoise( pq * 0.05 ) ) * mix( vec3( 1.0 ), gN, 0.25 ), hz );
      h = fh * ( 1.0 - hz ) * 0.8;
      rough = 0.86;
    }
  } else if ( kind == 6 ) {
    // the block's top: the Dialwood's own floor in the shade of its canopy — dark moss and drifts of fallen fan
    // leaves, a step DARKER than the walkable Dialwood floor below (dark wall, light floor: the value law), so a
    // gap between the crowns reads as depth in the wood, never as an inviting lawn (never lime, never paved)
    vec2 q = vec2( u, vl );
    bool inM = q.x >= 0.0 && q.y >= 0.0 && q.x <= uMapSize.x && q.y <= uMapSize.y;
    float wi = inM ? texture( uSplat2, q * uSplatScale ).b * 4.0 : 4.0;
    vec4 tM = valeTex2( uTexMoss, q / 5.0, valeNoise( q * 0.13 ) );
    vec4 tL = valeTex2( uTexLitter, q / 7.0, valeNoise( q * 0.11 + 3.0 ) );
    vec3 mM = valeTexMean( uTexMoss ), mL = valeTexMean( uTexLitter );
    float big = valeFbm( q * 0.06 + seed );
    float med = valeNoise( q * 0.27 + 4.0 );
    vec3 under = mix( uCanopy, uEarthC, 0.45 ) * 0.28 * ( 0.82 + 0.34 * big );
    under = mix( vec3( dot( under, vec3( 0.2126, 0.7152, 0.0722 ) ) ), under, 0.75 );
    vec3 a = valeOrganic( mix( mM, tM.rgb, 0.6 ), mM, under * vec3( 0.94, 1.03, 0.9 ), 0.6 );
    vec3 b = valeOrganic( mix( mL, tL.rgb, 0.7 ), mL, under * vec3( 1.14, 0.95, 0.72 ), 0.5 );
    float m = smoothstep( 0.4, 0.62, med * 0.55 + big * 0.5 + ( tM.a - 0.6 ) * 0.5 );
    c = mix( b, a, m );
    // max2 ENV-1 floor break-up: the gaps between the crowns read as one even dark moss. Three painted breaks, the mean
    // held (each lifts some patches and sinks others, all inside the block top's dark band):
    //  · dapple: sun through the canopy in soft warm pools (×1.0-1.75), never a hard spot
    //  · drifts of the wood's fallen plates in the species' hues: amber in the Serenade half, silvered sage in the
    //    Aubade half (the temperature field), each a patch a few metres across
    //  · old dial-stone breaking through the moss in sparse slabs, a cool mid-grey with a dark seam round them
    float dap = smoothstep( 0.5, 0.76, valeFbm( q * 0.62 + seed * 0.7 ) + ( med - 0.5 ) * 0.25 );
    float hol = smoothstep( 0.5, 0.2, valeNoise( q * 0.5 + 77.0 ) * 0.6 + big * 0.4 );
    vec3 sideT = mix( vec3( 0.86, 1.02, 1.04 ), vec3( 1.2, 0.98, 0.7 ), smoothstep( 0.3, 0.7, q.x / uMapSize.x ) );
    float drift = smoothstep( 0.62, 0.8, valeNoise( q * 0.34 + 23.0 ) + ( tL.a - 0.6 ) * 0.6 ) * ( 1.0 - m * 0.6 );
    c *= mix( vec3( 1.0 ), sideT * 1.45, drift * 0.85 );
    float slabN = valeNoise( q * 0.41 + 51.0 ) + ( med - 0.5 ) * 0.2;
    float slabW = max( fwidth( slabN ), 1e-4 );
    float slab = smoothstep( 0.755 - slabW, 0.755 + slabW, slabN );
    float seam = smoothstep( 0.725, 0.755 - slabW, slabN ) * ( 1.0 - slab );
    vec3 slabC = uTop * 0.66 * ( 0.86 + 0.28 * valeNoise( q * 1.3 ) ) * mix( vec3( 1.0 ), tM.rgb / mM, 0.35 );
    c = mix( c, slabC, slab * 0.85 );
    c *= 1.0 - 0.45 * seam;
    c *= ( 1.0 + 0.75 * dap * vec3( 1.05, 1.0, 0.84 ) ) * ( 1.0 - 0.22 * hol );
    // just inside the lip a little more light reaches the floor (still darker than the walkable floor)
    float rimZ = 1.0 - smoothstep( 0.05, 1.4, wi + ( n2 - 0.5 ) * 0.4 );
    c *= 1.0 + 0.15 * rimZ;
    h = mix( tL.a, tM.a, m ) * 0.05;
    rough = 0.9;
  } else if ( kind == 7 ) {
    // the shaft's flank: needle stone in long courses
    float cw = 1.05;
    float row = floor( P.y / cw );
    float rl = P.y - row * cw;
    float L = 2.6 + 1.6 * valeHash12( vec2( row, seed ) );
    float bu = u / L + valeHash12( vec2( row, 4.4 ) ) * 5.0;
    float e = min( min( fract( bu ), 1.0 - fract( bu ) ) * L, min( rl, cw - rl ) ) + chip;
    float jt = 1.0 - smoothstep( 0.01, 0.04, e );
    float r1 = valeHash12( vec2( floor( bu ), row + seed ) );
    c = uFlank * ( 0.86 + 0.24 * r1 ) * grainN;
    c = mix( c, uFlank * 0.4, jt );
    // lichen and damp streaks lower down
    c = mix( c, uMossC * 0.7, smoothstep( 0.55, 0.8, valeNoise( vec2( u * 0.7, P.y * 0.25 ) + seed ) ) * smoothstep( -0.6, -3.5, P.y ) * 0.6 );
    h = smoothstep( 0.0, 0.08, e ) * 0.03 + gh * 0.03;
    rough = 0.82;
  } else if ( kind == 9 ) {
    // a carved hour-band: a ring of paler needle stone round the shaft, standing proud of the deck edge and
    // rolling over it into the gorge. u runs across the ring (0..wallH = its width): rounded shoulders at both
    // ends, two grooves following the ring round, a chalk hour-tick on the crown
    float W = max( wallH, 0.5 );
    float eu = min( u, W - u );
    c = uLip * 0.9 * grainN * ( 0.93 + 0.12 * nm );
    c *= mix( 0.62, 1.0, smoothstep( 0.0, 0.42, eu ) );
    float gd = abs( eu - 0.36 ) - 0.035;
    float groove = 1.0 - smoothstep( 0.0, 0.02, gd );
    float gl = 1.0 - smoothstep( 0.0, 0.02, abs( eu - 0.43 ) - 0.012 );
    c = mix( c, c * 0.42, groove );
    c *= 1.0 + 0.12 * gl;
    // the crown's hour-tick: one chalk bar across the ring between the grooves, on its highest course
    float tk = ( 1.0 - smoothstep( 0.0, 0.02, abs( u - W * 0.5 ) - 0.05 ) ) * step( 0.46, eu ) * smoothstep( wallH * 0.0 + 0.55, 0.85, P.y );
    c = mix( c, uEdgeLight * 0.95, tk * 0.9 );
    // darker and damper as it rolls down into the gorge
    c *= mix( 0.5, 1.0, smoothstep( -4.5, 0.4, P.y ) );
    c = mix( c, uMossC * 0.6, smoothstep( 0.6, 0.85, valeNoise( fuv * 0.8 + seed ) ) * smoothstep( -0.8, -3.5, P.y ) * 0.5 );
    h = -groove * 0.012 + gh * 0.02 + smoothstep( 0.0, 0.2, eu ) * 0.01;
    rough = 0.8;
  } else {
    // raw rock in strata (the gorge's walls below the needle stone): fine warped laminations, sparse leaning
    // joints that split the beds into great blocks, damp streaks running down from every ledge; the lip
    // and the ledges catch the sun and the sky, and the stone cools and darkens with depth so the drop reads
    // deep before the mist takes it
    // strata follow the profile's own height (vWB.z), so they dip and rise with the terraces along the wall
    float yy = vWB.z + ( valeNoise( vec2( u * 0.045, seed * 1.3 ) ) - 0.5 ) * 3.0 + ( valeNoise( vec2( u * 0.31, seed ) ) - 0.5 ) * 0.5;
    float bigB = floor( yy / 4.6 );
    float colW = 2.2 + 3.6 * valeHash12( vec2( bigB, seed + 7.0 ) );
    float lean = ( valeHash12( vec2( bigB, seed + 3.3 ) ) - 0.5 ) * 0.7;
    float uu = ( u + yy * lean ) / colW + valeHash12( vec2( bigB, seed + 1.0 ) ) * 10.0;
    float ci = floor( uu ), cl = fract( uu );
    // faulted: each joint block's beds stepped against its neighbour's; beds of uneven thickness (0.6-1.8 m)
    float yb = yy + ( valeHash12( vec2( ci, bigB + seed * 3.0 ) ) - 0.5 ) * 0.9;
    float bw = yb / 1.15 + 0.3 * sin( yb * 0.83 + seed ) + 0.25 * valeNoise( vec2( u * 0.08, yb * 0.3 ) );
    float bed = 1.15;
    float bi = floor( bw ), bl = fract( bw );
    float wob2 = ( valeNoise( fuv * vec2( 1.4, 2.6 ) + seed ) - 0.5 ) * 0.16;
    float eU = min( cl, 1.0 - cl ) * colW + wob2;
    float eV = min( bl, 1.0 - bl ) * bed + wob2 * 0.5;
    // anti-aliased: each line is at least ~1.5 px wide and fades out before it would shimmer
    float fU = fwidth( uu ) * colW, fV = fwidth( bw ) * bed;
    // joints: only some open (a closed joint is a faint seam), each its own width; laminations come and go
    float open_ = step( 0.35, valeHash12( vec2( ci, bigB + seed ) ) );
    float jtU = ( 1.0 - smoothstep( 0.02, 0.05 + 0.09 * valeHash12( vec2( ci + 3.0, bigB ) ) + fU * 1.5, eU ) ) * mix( 0.35, 1.0, open_ ) * ( 1.0 - smoothstep( 0.12, 0.35, fU ) );
    float jtV = ( 1.0 - smoothstep( 0.015, 0.06 + fV * 1.5, eV ) ) * smoothstep( 0.45, 0.7, valeNoise( vec2( u * 0.21, bi * 0.7 ) ) ) * ( 1.0 - smoothstep( 0.08, 0.25, fV ) );
    vec2 bid = vec2( ci, bigB + seed * 11.0 );
    float r1 = valeHash12( bid ), r2 = valeHash12( bid * 1.7 + 3.0 ), r3 = valeHash12( vec2( bi, seed + 2.0 ) );
    vec4 tq = texture( uTexGrain, fuv / 5.0 );
    // broad patches across the whole face (iron-stained, pale, damp) so no two blocks repeat
    float patchN = valeFbm( vec2( u * 0.045, P.y * 0.07 ) + seed );
    c = uRock * ( 0.78 + 0.3 * r1 ) * ( 0.92 + 0.16 * r3 ) * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.8 ) * ( 0.86 + 0.28 * nm );
    c *= mix( vec3( 1.08, 1.0, 0.9 ), vec3( 0.86, 0.94, 1.06 ), smoothstep( 0.3, 0.7, patchN ) ) * ( 0.85 + 0.3 * patchN );
    c *= vec3( 1.0 + 0.07 * ( r2 - 0.5 ), 1.0, 1.0 - 0.06 * ( r2 - 0.5 ) );
    c = mix( c, uRock * 0.22, jtU );
    c *= 1.0 - 0.35 * jtV;
    // damp streaks run down the faces (stretched noise), lichen on the drier stone
    float streak = smoothstep( 0.62, 0.9, valeNoise( vec2( u * 1.6, P.y * 0.09 ) + seed * 2.0 ) );
    c *= 1.0 - 0.32 * streak * ( 1.0 - smoothstep( 0.5, 0.9, vCliffN.y ) );
    c = mix( c, uMossC * 0.55, smoothstep( 0.66, 0.86, valeNoise( fuv * vec2( 0.25, 0.6 ) + seed ) ) * 0.35 * ( 1.0 - jtU ) );
    // benches and ledges: real ledges of scree and moss, textured in plan (the face's joints never run across
    // them), occluded where they meet the face above, so each reads as a step in the rock, not a pale film
    float up = smoothstep( 0.35, 0.8, vCliffN.y );
    if ( up > 0.0 ) {
      vec4 tMb = texture( uTexMoss, P.xz / 3.5 );
      vec3 mMb = valeTexMean( uTexMoss );
      vec3 benchC = valeOrganic( mix( mMb, tMb.rgb, 0.7 ), mMb, uMossC * 0.6, 0.55 );
      float scree = smoothstep( 0.42, 0.68, valeNoise( P.xz * 0.55 + seed ) + ( tq.a - 0.6 ) * 0.8 + ( tMb.a - 0.6 ) * 0.4 );
      benchC = mix( benchC, uRock * 1.05 * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.85 ), scree * 0.7 );
      benchC *= mix( 0.5, 1.0, smoothstep( 0.0, 0.55, vl ) ) * ( 0.85 + 0.3 * valeNoise( P.xz * 0.21 + seed ) );
      c = mix( c, benchC, up );
    }
    // the far lip: a pale sunlit edge rolling over from the plateau (the gorge's lit outline)
    float lip = smoothstep( -1.2, -0.1, P.y ) * smoothstep( -0.2, 0.5, vCliffN.y );
    c = mix( c, uEdgeLight * 0.62 * grainN, lip * 0.75 );
    // depth: the light falls off down the drop (warm lit rim → cool shadowed depths)
    float dep = smoothstep( -1.0, -22.0, P.y );
    c *= mix( vec3( 1.12, 1.08, 1.0 ), vec3( 0.5, 0.56, 0.7 ), dep );
    h = smoothstep( 0.0, 0.25 + max( fU, fV ) * 2.0, min( eU, eV + 0.1 ) ) * 0.1 * ( 1.0 - smoothstep( 0.1, 0.3, max( fU, fV ) ) ) + ( tq.a - 0.6 ) * 0.05 - streak * 0.01;
    rough = 0.92;
  }
  vec3 tmp = mix( uTempW, uTempE, smoothstep( 0.12, 0.88, P.x / uMapSize.x ) );
  c *= mix( vec3( 1.0 ), tmp, uTempK );
  diffuseColor.rgb *= c;
  cH = h; cRough = rough;
}
`,Zo=`
uniform vec3 uMistHi, uMistLo; uniform float uMistK;
vec3 valeGorgeMist( vec3 c, vec3 wp ) {
  float dm = max( 0.0, -wp.y - 1.2 );
  float m = 1.0 - exp( -uMistK * dm * ( 1.0 + dm * 0.04 ) );
  vec3 mc = mix( uMistHi, uMistLo, smoothstep( 2.0, 22.0, dm ) );
  mc *= mix( 0.75, 1.0, valeVision( wp.xz ) );
  return mix( c, mc, m );
}
`,Qo=e=>`
if ( uMistK > 0.0 ) valeFogLocal = mix( valeFogValue, 0.75, smoothstep( -0.2, -2.5, ${e}.y ) );
`,$o=e=>`
if ( uMistK > 0.0 ) gl_FragColor.rgb = valeGorgeMist( gl_FragColor.rgb, ${e} );
`,es=`
uniform sampler2D uMistSD; uniform vec4 uMistBox; uniform vec3 uSheetSel; uniform float uWaterT;
uniform vec4 uSheet;   // x = opacity, y = drift speed, z = river glint (0/1), w = noise scale
uniform vec3 uSheetC; uniform vec2 uRiverY;
`,ts=`
{
  vec2 p = vValeWorld.xz;
  float rd = dot( texture( uMistSD, ( p - uMistBox.xy ) / uMistBox.zw ).rgb, uSheetSel ) * 4.0;
  // a soft, uneven fade (the mist thins in wisps toward the stone, never along a line)
  float edge = smoothstep( 0.25, 3.6, rd + ( valeNoise( p * 0.45 ) - 0.5 ) * 0.9 );
  edge *= edge;
  float t = uWaterT * uSheet.y;
  vec2 q = p * uSheet.w;
  float n = valeNoise( q + vec2( t, t * 0.37 ) ) * 0.6 + valeNoise( q * 2.3 - vec2( t * 1.3, -t * 0.5 ) + 7.1 ) * 0.4;
  float wisps = smoothstep( 0.36, 0.8, n );
  float a = uSheet.x * edge * ( 0.12 + 0.88 * wisps );
  vec3 col = uSheetC * ( 0.7 + 0.6 * n );
  if ( uSheet.z > 0.5 ) {
    // the river below: a soft winding band of light with sparkles drifting along it (cool, below bloom)
    float ry = abs( p.y - uRiverY.x ) < abs( p.y - uRiverY.y ) ? uRiverY.x : uRiverY.y;
    float wind = ry + sin( p.x * 0.09 + ry ) * 2.2 + sin( p.x * 0.23 + 1.3 ) * 0.7;
    float d = abs( p.y - wind );
    float band = exp( -d * d * 0.3 );
    float sp = valeNoise( vec2( p.x * 1.6 - uWaterT * 0.9, p.y * 3.0 ) );
    float spark = smoothstep( 0.78, 0.95, sp ) * exp( -d * d * 2.5 );
    col += vec3( 0.55, 0.66, 0.78 ) * ( band * 0.16 + spark * 0.5 ) * edge;
    a = max( a, ( band * 0.25 + spark * 0.5 ) * edge * uSheet.x );
  }
  diffuseColor = vec4( col, a );
}
`,ns=`
varying vec3 vShW;
uniform sampler2D uSplat; uniform sampler2D uSplat2; uniform vec2 uSplatScale;
uniform sampler2D uTexGrain; uniform vec3 uShadowC; uniform vec3 uShadowLine;
uniform vec4 uShAx; uniform vec2 uShWedge;
float sHeight;
`,rs=`
{
  vec2 p = vShW.xz;
  vec4 s1 = texture( uSplat, p * uSplatScale );
  vec4 s2 = texture( uSplat2, p * uSplatScale );
  float sd = s2.r * 8.0 - 4.0;                     // < 0 inside
  float wallD = s1.b * 8.0;
  float aa = clamp( length( fwidth( p ) ) * 0.75, 0.004, 0.25 );
  vec4 tG = texture( uTexGrain, p / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.8 );
  float gh = tG.a - 0.6;
  float chip = ( valeNoise( p * 9.0 ) - 0.5 ) * 0.05 + gh * 0.12;
  // the shadow's frame: along = from the tip toward the needle, across
  vec2 sa = p - uShAx.xy;
  float al = dot( sa, uShAx.zw ), ac = dot( sa, vec2( -uShAx.w, uShAx.z ) );
  // courses of uneven width (0.7-1.6 m: the across coordinate warped) and length, so the floor never reads as
  // a tiled grid from the camera
  float acW = ac + 0.42 * sin( ac * 0.61 + 1.3 ) + 0.25 * sin( ac * 1.37 );
  vec4 fl = valeCourses( vec2( al, acW ) + vec2( 17.0, 0.55 ), 1.1, 3.1 );
  float fh, jw;
  // violet-cool STONE, not a painted sheet: the tint's hue at a stone's chroma (C* ~10-13 on screen, so
  // it still reads violet under fog of war, which keeps its colour), each slab its own: some greyer slate,
  // some cooler, some a warmer plum; value mottled by damp and dust
  const vec3 LW = vec3( 0.2126, 0.7152, 0.0722 );
  float lum = dot( uShadowC, LW );
  float r1 = valeHash12( fl.zw + 5.3 ), r2 = valeHash12( fl.zw * 1.7 + 2.1 ), r3 = valeHash12( fl.zw * 0.37 + 8.8 );
  // (the sky's blue ambient adds chroma of its own: the albedo leans a touch warmer, toward violet)
  vec3 slab = mix( vec3( lum ), uShadowC * vec3( 1.05, 0.99, 0.93 ), 0.2 + 0.16 * r1 );
  slab *= mix( vec3( 0.97, 1.0, 1.04 ), vec3( 1.05, 0.98, 0.98 ), r2 );
  float mott = valeFbm( p * 0.35 + 3.0 );
  // closing env m-3: the damp / dust breakup is drawn as strokes along the courses (long down the shadow, short across
  // it), <= 4 L*; the old fbm mottle (0.9-1.1 over 3 m clouds) read as staining. mott still settles dust in the joints
  float stk = valeNoise( vec2( al * 0.32, acW * 2.2 ) + 3.0 ) * 0.7 + valeNoise( vec2( al * 0.9, acW * 5.3 ) + 9.0 ) * 0.3;
  slab *= ( 0.95 + 0.1 * stk ) * ( 0.9 + 0.2 * r3 );
  vec3 sc0 = mix( vec3( lum ), uShadowC * vec3( 1.05, 0.99, 0.93 ), 0.3 );
  vec3 c = valeFlag( slab, fl, grainN, chip, 0.04, sc0 * 0.58, 0.16, fh, jw );
  // worn arrises: each slab's edge rubbed paler just inside its joint, chipped by the grain
  float wear = smoothstep( 0.04, 0.07, fl.y + chip ) * ( 1.0 - smoothstep( 0.07, 0.16, fl.y + chip * 1.5 ) );
  c *= 1.0 + 0.16 * wear * smoothstep( 0.3, 0.7, valeNoise( p * 3.1 + fl.zw ) );
  // pale dust settled in the joints toward the pit's rim, dark damp along the cliff feet
  c = mix( c, mix( c, sc0 * 1.25, 0.5 ), jw * smoothstep( 0.55, 0.8, mott ) );
  // the shadow's own point: a darker core wedge, the needle's shadow, narrowing to the tip; its edge engraved
  float hw = uShWedge.y * clamp( al / max( uShWedge.x, 1e-3 ), 0.0, 1.0 );
  float wd = al < 0.0 ? length( sa ) : ( abs( ac ) - hw ) * 0.995;
  float core = 1.0 - smoothstep( -aa, aa, wd );
  float coreE = 1.0 - smoothstep( 0.0, 0.02 + aa, abs( wd ) - 0.035 );
  c = mix( c, c * 0.8, core * step( 0.001, uShWedge.x ) );
  c = mix( c, sc0 * 0.38, coreE * step( 0.001, uShWedge.x ) );
  // the engraved hard edge: a groove 0.1 m inside the outline, a lit arris beyond it
  float groove = 1.0 - smoothstep( 0.0, 0.025 + aa, abs( sd + 0.16 ) - 0.05 );
  float arris = 1.0 - smoothstep( 0.0, 0.02 + aa, abs( sd + 0.27 ) - 0.025 );
  float rim = 1.0 - smoothstep( -0.32, -0.05, sd );
  c = mix( c, sc0 * 0.82 * grainN, rim * 0.6 );
  c = mix( c, sc0 * 0.35, groove );
  c = mix( c, mix( vec3( dot( uShadowLine, LW ) ), uShadowLine, 0.6 ), arris * 0.8 );
  c *= mix( 0.55, 1.0, smoothstep( 0.0, 1.9, wallD ) );
  diffuseColor.rgb *= c;
  sHeight = fh - groove * 0.02 + arris * 0.004 - coreE * 0.008;
}
`,is={face:0,step:1,lipFace:2,chamfer:3,lipTop:4,lipIn:5,top:6,flank:7,rock:8,band:9};function as(e,t){let n=Math.sin(e*127.1+t*311.7)*43758.5453;return n-Math.floor(n)}function os(e,t){let n=Math.floor(e),r=Math.floor(t),i=e-n,a=t-r,o=i*i*(3-2*i),s=a*a*(3-2*a),c=as(n,r),l=as(n+1,r),u=as(n,r+1),d=as(n+1,r+1);return c+(l-c)*o+(u-c)*s+(c-l-u+d)*o*s}var ss=class{pos=[];nor=[];a=[];b=[];vert(e,t,n,r){this.pos.push(e[0],e[1],e[2]),this.nor.push(t[0],t[1],t[2]),this.a.push(n[0],n[1],n[2],n[3]),this.b.push(r[0],r[1],r[2],r[3])}quad(e,t,n,r){let[i,a,o]=e,s=a[0]-i[0],c=a[1]-i[1],l=a[2]-i[2],u=o[0]-i[0],d=o[1]-i[1],f=o[2]-i[2],p=c*f-l*d,m=l*u-s*f,h=s*d-c*u,g=t[0][0]+t[1][0]+t[2][0]+t[3][0],_=t[0][1]+t[1][1]+t[2][1]+t[3][1],v=t[0][2]+t[1][2]+t[2][2]+t[3][2],y=p*g+m*_+h*v>=0?[0,1,2,0,2,3]:[0,2,1,0,3,2];for(let i of y)this.vert(e[i],t[i],n[i],r[i])}cap(e,t,n,r,i=[]){let a=e.map(([e,t])=>new O(e,-t));te.isClockWise(a)&&(a=a.reverse());let o=new s(a);for(let e of i){let t=e.map(([e,t])=>new O(e,-t));te.isClockWise(t)||(t=t.reverse()),o.holes.push(new pe(t))}let c=new Ue(o,1),l=c.getAttribute(`position`),u=c.index,d=u?u.count:l.count;for(let e=0;e<d;e+=3){let i=[0,1,2].map(t=>u?u.getX(e+t):e+t).map(e=>[l.getX(e),t,-l.getY(e)]),a=i[1][0]-i[0][0],o=i[1][2]-i[0][2],s=i[2][0]-i[0][0],c=i[2][2]-i[0][2],d=o*s-a*c>=0?[0,1,2]:[0,2,1];for(let e of d)this.vert(i[e],[0,1,0],[i[e][0],i[e][2],n[2],n[3]],r)}c.dispose()}planar(e,t,n,r,i){let a=te.triangulateShape(e.map(([e,t])=>new O(e,t)),[]);for(let o of a){let a=o.map(n=>t(e[n])),s=a[1][0]-a[0][0],c=a[1][1]-a[0][1],l=a[1][2]-a[0][2],u=a[2][0]-a[0][0],d=a[2][1]-a[0][1],f=a[2][2]-a[0][2],p=c*f-l*d,m=l*u-s*f,h=s*d-c*u,g=p*n[0]+m*n[1]+h*n[2]>=0?[0,1,2]:[0,2,1];for(let t of g)this.vert(a[t],n,r(e[o[t]]),i(e[o[t]]))}}geometry(){let e=new Ee;return e.setAttribute(`position`,new F(new Float32Array(this.pos),3)),e.setAttribute(`normal`,new F(new Float32Array(this.nor),3)),e.setAttribute(`aWallA`,new F(new Float32Array(this.a),4)),e.setAttribute(`aWallB`,new F(new Float32Array(this.b),4)),e.computeBoundingSphere(),e}get triangles(){return this.pos.length/9}};function cs(e,t,n,r,i){let a=t.length;if(a<2)return;let o=r.closed?a:a-1,s=[];for(let e=0;e<o;e++){let n=t[e],i=t[(e+1)%a],o=i[0]-n[0],c=i[1]-n[1],l=Math.hypot(o,c)||1;s.push(r.ccw?[c/l,-o/l]:[-c/l,o/l])}let c=[];for(let e=0;e<a;e++){let t=r.closed?s[(e-1+o)%o]:s[Math.max(0,e-1)],n=r.closed?s[e%o]:s[Math.min(o-1,e)],i=t[0]+n[0],a=t[1]+n[1],l=Math.hypot(i,a);l<1e-4?(i=n[0],a=n[1]):(i/=l,a/=l),c.push([i,a])}let l=[0];for(let e=1;e<=o;e++){let n=t[e-1],r=t[e%a];l.push(l[e-1]+Math.hypot(r[0]-n[0],r[1]-n[1]))}let u=(e,n)=>{let i=t[e%a],o=c[e%a],s=n.off,u=r.pinned?.(i[0],i[1])??!1;if(u)n.off>0&&(s=0);else{if(r.chisel>0){let e=r.chisel*(r.taper?Math.min(1,Math.max(0,-n.y/r.taper)):1);s+=(os(i[0]*.9+n.y*1.3+r.seed,i[1]*.9)-.5)*e+(os(i[0]*2.7-n.y*2.1,i[1]*2.7+r.seed)-.5)*e*.45}r.extra&&(s+=r.extra(i[0],i[1],n.y,l[e],n.lk??0))}let d=!u&&r.yExtra?r.yExtra(i[0],i[1],n.y,l[e]):0;return[i[0]+o[0]*s,n.y+d,i[1]+o[1]*s]};for(let s of n){let n=s.to.off-s.from.off,d=s.to.y-s.from.y,f=Math.hypot(n,d)||1,p=[d/f,-n/f],m=Math.abs(d)>1e-4?Math.abs(d):f;for(let n=0;n<o;n++){let d=n+1,f=[u(n,s.from),u(d,s.from),u(d,s.to),u(n,s.to)],h=e=>{let n=c[e%a],i=n[0]*p[0],s=n[1]*p[0],u=p[1];if(r.roundEnds&&!r.closed){let n=t[0],c=t[a-1],u=Math.hypot(c[0]-n[0],c[1]-n[1])||1,d=(c[0]-n[0])/u,f=(c[1]-n[1])/u,p=Math.max(0,1-l[e]/r.roundEnds),m=(Math.max(0,1-(l[o]-l[e])/r.roundEnds)-p)*1.1;i+=d*m,s+=f*m}let d=Math.hypot(i,u,s)||1;return[i/d,u/d,s/d]},g=[h(n),h(d),h(d),h(n)],_=[[l[n],0,s.course,s.kind],[l[d],0,s.course,s.kind],[l[d],1,s.course,s.kind],[l[n],1,s.course,s.kind]],v=[[m,r.seed,s.from.y,i],[m,r.seed,s.from.y,i],[m,r.seed,s.to.y,i],[m,r.seed,s.to.y,i]];e.quad(f,g,_,v)}}}function ls(e,t,n){let r=[],i=Math.max(.3,e-(n?.22:.3)),a=[],o=0,s=0;for(;o<i-.05;){let e=(n?.4:.55)+as(t*1.7,s*3.1)*(n?.18:.35);i-o-e<.3&&(e=i-o),a.push(e),o+=e,s++}let c=-.12,l=0;a.forEach((e,i)=>{let o=(a.length-1-i)*(n?.025:.035)+(as(t+i*7.3,2.9)-.5)*.04,s=c;i>0&&Math.abs(o-l)>1e-4&&r.push({from:{off:l,y:s},to:{off:o,y:s},kind:is.step,course:i}),r.push({from:{off:o,y:s},to:{off:o,y:s+e+(i===0?.12:0)},kind:is.face,course:i}),c=s+e+(i===0?.12:0),l=o});let u=n?.05:.08,d=n?.035:.045,f=n?.22:.3;return r.push({from:{off:l,y:c},to:{off:u,y:c},kind:is.step,course:a.length}),r.push({from:{off:u,y:c},to:{off:u,y:e-d},kind:is.lipFace,course:a.length}),r.push({from:{off:u,y:e-d},to:{off:u-d,y:e},kind:is.chamfer,course:a.length}),r.push({from:{off:u-d,y:e},to:{off:-f,y:e},kind:is.lipTop,course:a.length}),r.push({from:{off:-f,y:e},to:{off:-f-.1,y:e-.07},kind:is.lipIn,course:a.length}),{strips:r,topY:e-.07,topOff:0}}function us(e,t,n=1){let r=[],i=4.6*n;r.push({off:.12,y:0,kind:is.flank});for(let e=0;e<=8;e++){let t=e/8*Math.PI*.62;r.push({off:-Math.sin(t)*i*.42,y:-(1-Math.cos(t))*i*.9-.02-0,kind:is.flank})}let a=r[r.length-1],o=a.y-.8,s=a.off+.9;r.push({off:s,y:o,kind:is.rock});let c=0;for(;o>-e;){let e=1.6+as(t+c,4.1)*2.6,n=(as(t*3.1+c,1.3)-.45)*1.6;r.push({off:s,y:o-e*.85,kind:is.rock}),s+=n,o-=e,r.push({off:s,y:o,kind:is.rock}),c++}let l=[];for(let e=1;e<r.length;e++)l.push({from:r[e-1],to:r[e],kind:r[e].kind,course:e});return l}function ds(e,t){let n=[];for(let e=0;e<=4;e++){let t=e/4*(Math.PI/2);n.push({off:.55*(1-Math.sin(t)),y:-.55*(1-Math.cos(t))-.03})}let r=n[n.length-1].y,i=n[n.length-1].off,a=0;for(;r>-e;){let e=2.6+as(t+a*1.7,3.3)*2.8,o=a>0&&as(t*1.9+a,8.2)<.2,s=o?-.55:.18+as(t+a,5.5)*.4;n.push({off:i-s*.45-(o?0:.12),y:r-e*.4,lk:a}),n.push({off:i-s*.85,y:r-e*.85,lk:a}),i-=s,r-=e,n.push({off:i,y:r,lk:a});let c=i<-8?0:(o?1:.4)+as(t*2.7+a,1.1)*.9;n.push({off:i-c*.7,y:r-.04,lk:a+.7}),i-=c,n.push({off:i,y:r-.22,lk:a+1}),r-=.22,a++}let o=[];for(let e=1;e<n.length;e++)o.push({from:n[e-1],to:n[e],kind:is.rock,course:e});return o}function fs(e,t){let n=[{off:e,y:-.15},{off:e,y:.32*t},{off:e-.12,y:.42*t},{off:e-.3,y:.47*t},{off:e*.62,y:.64*t},{off:e*.32,y:.84*t},{off:.35,y:.96*t},{off:.05,y:t}],r=Math.min(.9,t*.9);for(let e=1;e<=6;e++){let i=e/6*(Math.PI/2);n.push({off:.05-r*Math.sin(i),y:t-r+r*Math.cos(i)})}let i=4.6,a=.4;for(let e=1;e<=8;e++){let t=e/8*Math.PI*.62,r=-(1-Math.cos(t))*i*.9;r>n[n.length-1].y-.05||n.push({off:-Math.sin(t)*i*.42-a,y:r})}let o=n[n.length-1];n.push({off:o.off+a+.9,y:o.y-.6});let s=[];for(let e=1;e<n.length;e++)s.push({from:n[e-1],to:n[e],kind:is.band,course:e});return{strips:s,section:n.map(e=>[e.off,e.y])}}var q={chalk:0,groove:1,lit:2,mid:3},ps=class{list=[];seg(e,t,n,r){this.list.push({ax:e[0],ay:e[1],bx:t[0],by:t[1],w:n,ch:r})}poly(e,t,n,r=!1){for(let r=1;r<e.length;r++)this.seg(e[r-1],e[r],t,n);r&&e.length>2&&this.seg(e[e.length-1],e[0],t,n)}circle(e,t,n,r,i=.35){let a=Math.max(12,Math.ceil(Math.PI*2*t/i)),o=[];for(let n=0;n<a;n++){let r=n/a*Math.PI*2;o.push([e[0]+Math.cos(r)*t,e[1]+Math.sin(r)*t])}this.poly(o,n,r,!0)}},ms=-.15,hs=.6,gs=.44999999999999996;function _s(e,t,n,r,i,a,o){for(let s of e){let e=s.w/2,c=Math.max(0,Math.floor((Math.min(s.ax,s.bx)-e-gs-i)/o)),l=Math.min(n-1,Math.ceil((Math.max(s.ax,s.bx)+e+gs-i)/o)),u=Math.max(0,Math.floor((Math.min(s.ay,s.by)-e-gs-a)/o)),d=Math.min(r-1,Math.ceil((Math.max(s.ay,s.by)+e+gs-a)/o));if(l<c||d<u)continue;let f=s.bx-s.ax,p=s.by-s.ay,m=f*f+p*p;for(let r=u;r<=d;r++){let u=a+r*o;for(let a=c;a<=l;a++){let c=i+a*o,l=m>0?((c-s.ax)*f+(u-s.ay)*p)/m:0;l=l<0?0:l>1?1:l;let d=s.ax+l*f-c,h=s.ay+l*p-u,g=Math.sqrt(d*d+h*h)-e,_=(r*n+a)*4+s.ch;g<t[_]&&(t[_]=g)}}}}var vs=(e,t,n=0)=>{for(let r=0;r<e.length;r++)t[n+r]=Math.max(0,Math.min(255,Math.round((e[r]-ms)/hs*255)))};function ys(e,t,n=.125,r=.24){let i=Math.ceil(t[0]/n)+1,a=Math.ceil(t[1]/n)+1,s=new Float32Array(i*a*4).fill(gs);_s(e.list,s,i,a,0,0,n);let c=new Uint8Array(i*a*4);vs(s,c);let l=new o(c,i,a,be,f);l.magFilter=re,l.minFilter=re,l.generateMipmaps=!1,l.needsUpdate=!0;let u=2/64,d=Math.ceil(t[0]/2),p=Math.ceil(t[1]/2),m=new Map,h=new Set;for(let t of e.list){let e=t.w/2+.49999999999999994,n=Math.max(0,Math.floor((Math.min(t.ax,t.bx)-e)/2)),i=Math.min(d-1,Math.floor((Math.max(t.ax,t.bx)+e)/2)),a=Math.max(0,Math.floor((Math.min(t.ay,t.by)-e)/2)),o=Math.min(p-1,Math.floor((Math.max(t.ay,t.by)+e)/2)),s=t.w<r;for(let e=a;e<=o;e++)for(let r=n;r<=i;r++){let n=e*d+r,i=m.get(n);if(i||(i=[],m.set(n,i)),i.push(t),s){let i=(r+.5)*2,a=(e+.5)*2,o=t.bx-t.ax,s=t.by-t.ay,c=o*o+s*s,l=c>0?((i-t.ax)*o+(a-t.ay)*s)/c:0;l=l<0?0:l>1?1:l,Math.hypot(t.ax+l*o-i,t.ay+l*s-a)<1.4144+t.w+.12&&h.add(n)}}}let g=[...h].sort((e,t)=>e-t),_=Math.max(1,Math.min(62,g.length)),v=Math.max(1,Math.ceil(g.length/_)),y=_*66,b=v*66,x=new Uint8Array(y*b*4),S=new Uint8Array(d*p*4),C=new Float32Array(17424),w=new Uint8Array(17424);g.forEach((e,t)=>{let n=e%d,r=Math.floor(e/d),i=t%_,a=Math.floor(t/_);C.fill(gs),_s(m.get(e)??[],C,66,66,n*2-.5*u,r*2-.5*u,u),vs(C,w);for(let e=0;e<66;e++)x.set(w.subarray(e*66*4,(e+1)*66*4),((a*66+e)*y+i*66)*4);let o=e*4;S[o]=i,S[o+1]=a,S[o+2]=255,S[o+3]=255});let T=new o(x,y,b,be,f);T.magFilter=re,T.minFilter=re,T.generateMipmaps=!1,T.needsUpdate=!0;let E=new o(S,d,p,be,f);return E.magFilter=Se,E.minFilter=Se,E.generateMipmaps=!1,E.needsUpdate=!0,{tex:l,scale:[1/(i*n),1/(a*n)],fine:T,index:E,fineP:[1/2,66,64,g.length],atlas:[y,b]}}var bs=`
uniform sampler2D uInlay; uniform sampler2D uInlayFine; uniform sampler2D uInlayIdx;
uniform vec2 uInlayScale; uniform vec4 uInlayFineP; uniform vec2 uInlayAtlas;
vec4 valeInlay( vec2 p ) {
  vec2 cp = p * uInlayFineP.x;
  ivec2 ci = ivec2( floor( cp ) );
  ivec2 isz = textureSize( uInlayIdx, 0 );
  vec4 raw;
  bool ok = uInlayFineP.w > 0.5 && ci.x >= 0 && ci.y >= 0 && ci.x < isz.x && ci.y < isz.y;
  vec4 ix = ok ? texelFetch( uInlayIdx, ci, 0 ) : vec4( 0.0 );
  if ( ix.b > 0.5 ) {
    vec2 tl = floor( ix.rg * 255.0 + 0.5 );
    raw = textureLod( uInlayFine, ( tl * uInlayFineP.y + 1.0 + fract( cp ) * uInlayFineP.z ) / uInlayAtlas, 0.0 );
  } else {
    raw = textureLod( uInlay, p * uInlayScale, 0.0 );
  }
  return raw * 0.6 - 0.15;
}
`;function xs(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function Ss(e,t,n=0){let r=[],i=0,a=n;for(let n=1;n<e.length;n++){let o=e[n-1],s=e[n],c=s[0]-o[0],l=s[1]-o[1],u=Math.hypot(c,l);if(!(u<1e-6)){for(;a<=i+u;){let e=(a-i)/u;r.push({p:[o[0]+c*e,o[1]+l*e],t:[c/u,l/u],s:a}),a+=t}i+=u}}return r}function Cs(e,t,n,r,i,a){for(let{p:o,t:s}of Ss(t,i,i*.5)){let t=-s[1],i=s[0];for(let s of[-1,1]){let c=[o[0]+t*s*(n-r+.04),o[1]+i*s*(n-r+.04)],l=[o[0]+t*s*(n-.04),o[1]+i*s*(n-.04)];a((c[0]+l[0])/2,(c[1]+l[1])/2)&&e.seg(c,l,.07,q.chalk)}}}function ws(e,t,n,r,i,a){let o=xs(i),s=r*.95;for(let{p:i,t:c}of Ss(t,s,s*.5)){if(!a(i[0],i[1]))continue;let t=n(i,c),s=[i[0]+t[0]*r*.5,i[1]+t[1]*r*.5],l=r*.32,u=Math.floor(o()*6),d=(e,n)=>[s[0]+c[0]*e*l+t[0]*n*l,s[1]+c[1]*e*l+t[1]*n*l],f=.045;u===0?(e.seg(d(-.5,-1),d(-.5,1),f,q.groove),e.seg(d(.5,-1),d(.5,1),f,q.groove)):u===1?(e.seg(d(-.7,-1),d(0,1),f,q.groove),e.seg(d(0,1),d(.7,-1),f,q.groove)):u===2?(e.seg(d(-.7,-1),d(.7,1),f,q.groove),e.seg(d(-.7,1),d(.7,-1),f,q.groove)):u===3?(e.seg(d(0,-1),d(0,1),f,q.groove),e.seg(d(-.6,0),d(.6,0),f,q.groove)):u===4?(e.seg(d(-.6,-1),d(-.6,1),f,q.groove),e.seg(d(-.6,0),d(.6,1),f,q.groove),e.seg(d(-.6,0),d(.6,-1),f,q.groove)):e.seg(d(0,-1),d(0,1),f,q.groove)}}function Ts(e,t,n,r,i,a){let o=[],s=[[10,`X`],[9,`IX`],[5,`V`],[4,`IV`],[1,`I`]],c=n;for(let[e,t]of s)for(;c>=e;)o.push(...t.split(``)),c-=e;let l=e=>(e===`I`?.22:.62)*r,u=.12*r,d=o.reduce((e,t)=>e+l(t),0)+u*(o.length-1),f=t[0]-d/2,p=t[1]-r/2,m=t[1]+r/2;for(let t of o){let n=l(t);t===`I`?e.seg([f+n/2,p],[f+n/2,m],i,a):t===`V`?(e.seg([f,p],[f+n/2,m],i,a),e.seg([f+n/2,m],[f+n,p],i,a)):(e.seg([f,p],[f+n,m],i,a),e.seg([f+n,p],[f,m],i,a)),t===`I`&&(e.seg([f-.04*r,p],[f+n+.04*r,p],i*.8,a),e.seg([f-.04*r,m],[f+n+.04*r,m],i*.8,a)),f+=n+u}}function Es(e,t,n){let r=xs(n.seed),i=Ss(t,.5,0);if(i.length<2)return;let a=e=>e.every(e=>n.keep(e[0],e[1])),o=(t,n,r,i)=>{for(let a=1;a<t.length;a++){let o=(a-.5)/(t.length-1);e.seg(t[a-1],t[a],n+(r-n)*o,i)}},s=(t,n,i,a)=>{let s=Math.hypot(n[0]-t[0],n[1]-t[1]);if(s<.18){e.seg(t,n,i,a);return}o(Ds(t,n,s*.035,2,r),i,i*.8,a)},c=n.every[0]*(.3+r()),l=i[i.length-1].s;for(;c<l;){let{p:t,t:l}=i[Math.min(i.length-1,Math.round(c/.5))];c+=n.every[0]+r()*(n.every[1]-n.every[0]);let u=[-l[1],l[0]],d=(r()*2-1)*n.half,f=[t[0]+u[0]*d,t[1]+u[1]*d],p=r();if(p<n.pCrack){let t=r()*Math.PI,i=.7+r()*1.6,s=[Math.cos(t),Math.sin(t)],c=Ds([f[0]-s[0]*i*.5,f[1]-s[1]*i*.5],[f[0]+s[0]*i*.5,f[1]+s[1]*i*.5],i*.11,4,r);if(!a(c))continue;for(let t=1;t<c.length;t++){let r=(t-.5)/(c.length-1);e.seg(c[t-1],c[t],.018+.026*Math.sin(Math.PI*r)**.8,n.crack)}if(r()<.55){let e=c[1+Math.floor(r()*(c.length-2))],s=t+(r()<.5?-1:1)*(.45+r()*.6),l=i*(.25+r()*.25),u=Ds(e,[e[0]+Math.cos(s)*l,e[1]+Math.sin(s)*l],l*.12,3,r);a(u)&&o(u,.026,.014,n.crack)}}else if(p<n.pCrack+n.pChalk&&n.chalk!==null){let t=n.chalk,i=.04+r()*.012;if(!a([f,[f[0]-.55,f[1]],[f[0]+.55,f[1]],[f[0],f[1]-.55],[f[0],f[1]+.55]]))continue;let c=Math.floor(r()*5);if(c===0){let n=.17+r()*.09,a=1+Math.floor(r()*2),c=[],l=r()*Math.PI*2;for(let e=0;e<=13-a;e++){let t=l+e/13*Math.PI*2,i=n*(1+(r()-.5)*.1);c.push([f[0]+Math.cos(t)*i,f[1]+Math.sin(t)*i])}o(c,i,i*.85,t);let u=r()*Math.PI*2;s(f,[f[0]+Math.cos(u)*n*2.1,f[1]+Math.sin(u)*n*2.1],i,t);for(let r=-2;r<=2;r++){let a=u+Math.PI/6*r;e.seg([f[0]+Math.cos(a)*n*1.3,f[1]+Math.sin(a)*n*1.3],[f[0]+Math.cos(a)*n*1.55,f[1]+Math.sin(a)*n*1.55],i*.85,t)}}else if(c===1){let e=3+Math.floor(r()*2),n=.075,a=.15,o=(r()-.5)*.25,c=f[0]-n*(e-1)/2;for(let l=0;l<e;l++){let e=c+l*n+(r()-.5)*.015;s([e+o*a,f[1]-a],[e-o*a,f[1]+a],i,t)}s([c-.07,f[1]+a*.55],[c+n*(e-1)+.07,f[1]-a*.6],i,t)}else if(c===2){let e=.19+r()*.05,n=e*.86,a=e*.5,s=r()*Math.PI*2,c=[Math.cos(s),Math.sin(s)],l=(e*e-n*n+a*a)/(2*a),u=Math.sqrt(Math.max(0,e*e-l*l)),d=(e,t,n)=>{let i=[];for(let a=0;a<=9;a++){let o=s+n+a/9*(Math.PI*2-2*n),c=t*(1+(r()-.5)*.06);i.push([e[0]+Math.cos(o)*c,e[1]+Math.sin(o)*c])}return i};o(d(f,e,Math.atan2(u,l)),i,i*.85,t),o(d([f[0]+c[0]*a,f[1]+c[1]*a],n,Math.atan2(u,l-a)),i*.85,i*.8,t)}else if(c===3)Ts(e,f,1+Math.floor(r()*12),.26+r()*.06,i,t);else{let e=.24+r()*.08,n=r()*Math.PI*2,a=[];for(let t=0;t<=12;t++){let i=n+t/14*Math.PI*2,o=e*(1+(r()-.5)*.12);a.push([f[0]+Math.cos(i)*o,f[1]+Math.sin(i)*o])}o(a,i,i*.8,t);let c=e*.5;s([f[0]-c,f[1]-c],[f[0]+c,f[1]+c],i,t),s([f[0]-c,f[1]+c],[f[0]+c,f[1]-c],i,t)}}}}function Ds(e,t,n,r,i){let a=[e,t],o=n;for(let e=0;e<r;e++){let e=[a[0]];for(let t=1;t<a.length;t++){let n=a[t-1],r=a[t],s=r[0]-n[0],c=r[1]-n[1],l=Math.hypot(s,c)||1,u=(i()-.5)*2*o;e.push([(n[0]+r[0])/2-c/l*u,(n[1]+r[1])/2+s/l*u],r)}a=e,o*=.55}return a}function Os(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function ks(e,t){let n=e.getAttribute(`position`),r=new Float32Array(n.count*3);for(let e=0;e<n.count;e++){let i=t(n.getX(e),n.getY(e),n.getZ(e));r[e*3]=i[0],r[e*3+1]=i[1],r[e*3+2]=i[2]}e.setAttribute(`color`,new F(r,3))}function As(e,t){let n=e.getAttribute(`normal`);for(let e=0;e<n.count;e++){let r=n.getX(e)*(1-t),i=n.getY(e)*(1-t)+t,a=n.getZ(e)*(1-t),o=Math.hypot(r,i,a)||1;n.setXYZ(e,r/o,i/o,a/o)}}function js(e,t){let n=Os(91),r=[];for(let e=0;e<3;e++){let t=e===0?.5:.26+n()*.14,i=e===0?0:(n()-.5)*.75,a=e===0?0:(n()-.5)*.75,o=t*(.42+n()*.12),s=[i,o,a],c=[],l=[],u=n()*6.283;for(let e=0;e<6;e++){let r=u+e/6*Math.PI*2,s=.85+n()*.3;c.push([i+Math.cos(r+.26)*t*.62*s,o*(.72+n()*.12),a+Math.sin(r+.26)*t*.62*s]),l.push([i+Math.cos(r)*t*s,-.01,a+Math.sin(r)*t*s])}for(let e=0;e<6;e++){let t=(e+1)%6;r.push(...s,...c[t],...c[e]),r.push(...c[e],...c[t],...l[t],...c[e],...l[t],...l[e])}}let i=new Ee;return i.setAttribute(`position`,new F(new Float32Array(r),3)),i.computeVertexNormals(),As(i,.4),ks(i,(n,r)=>{let i=Math.min(1,Math.max(0,(r+.01)/.2));return[e.r+(t.r-e.r)*i,e.g+(t.g-e.g)*i,e.b+(t.b-e.b)*i]}),i}function Ms(e){let t=[],n=[],r=[],i=.5,a=.95,o=[-.42,0,0];for(let s=0;s<5;s++){let c=-.95+2*a*s/5,l=-.95+2*a*(s+1)/5,u=e=>1-.18*Math.exp(-((e/.14)**2)),d=[o[0]+Math.cos(c)*i*2*u(c),.02+.05*Math.abs(Math.sin(c*2)),Math.sin(c)*i*2*u(c)],f=[o[0]+Math.cos(l)*i*2*u(l),.02+.05*Math.abs(Math.sin(l*2)),Math.sin(l)*i*2*u(l)];for(let[i,a]of[[o,.8],[d,1],[f,1]]){t.push(i[0],i[1],i[2]),n.push(0,1,0);let o=a*(.94+.06*Math.cos(s*1.7));r.push(e.r*o,e.g*o,e.b*o)}}t.push(o[0],.01,-.03,o[0]-.3,.01,0,o[0],.01,.03),n.push(0,1,0,0,1,0,0,1,0);for(let t=0;t<3;t++)r.push(e.r*.6,e.g*.6,e.b*.6);let s=new Ee;return s.setAttribute(`position`,new F(new Float32Array(t),3)),s.setAttribute(`normal`,new F(new Float32Array(n),3)),s.setAttribute(`color`,new F(new Float32Array(r),3)),s}function Ns(e){let t=new Ge(.5,0),n=t.getAttribute(`position`),r=Os(17);for(let e=0;e<n.count;e++){let t=.8+r()*.35;n.setXYZ(e,n.getX(e)*t*1.15,Math.max(-.05,n.getY(e)*t*.6),n.getZ(e)*t)}let i=t.index?t.toNonIndexed():t;return i!==t&&t.dispose(),i.deleteAttribute(`uv`),i.computeVertexNormals(),As(i,.2),ks(i,(t,n)=>{let r=.72+.5*Math.min(1,Math.max(0,(n+.05)/.35));return[e.r*r,e.g*r,e.b*r]}),i}function Ps(e,t){let n=Os(29),r=[],i=[],a=[];for(let o=0;o<6;o++){let s=o/6*Math.PI*2+n()*.8,c=.04+n()*.14,l=Math.cos(s)*c,u=Math.sin(s)*c,d=.6+n()*.4,f=.25+n()*.35,p=.07+n()*.03,m=Math.cos(s),h=Math.sin(s),g=-h,_=m,v=[l+m*f*d,d,u+h*f*d],y=[l+m*f*d*.35,d*.55,u+h*f*d*.35],b=[l-g*p,0,u-_*p],x=[l+g*p,0,u+_*p],S=[y[0]-g*p*.6,y[1],y[2]-_*p*.6],C=[y[0]+g*p*.6,y[1],y[2]+_*p*.6],w=[b,x,C,b,C,S,S,C,v],T=[0,0,.55,0,.55,.55,.55,.55,1];for(let n=0;n<w.length;n++){r.push(w[n][0],w[n][1],w[n][2]);let o=T[n]**.8;i.push(e.r+(t.r-e.r)*o,e.g+(t.g-e.g)*o,e.b+(t.b-e.b)*o);let s=m*.4,c=.85,l=h*.4,u=Math.hypot(s,c,l);a.push(s/u,c/u,l/u)}}let o=new Ee;return o.setAttribute(`position`,new F(new Float32Array(r),3)),o.setAttribute(`normal`,new F(new Float32Array(a),3)),o.setAttribute(`color`,new F(new Float32Array(i),3)),o}function Fs(e,t,n,r,i,a,o,s){let c=Os(s),l=(t,i,a,o,s,c)=>{let l=e.length/3;for(let l=0;l<11;l++){let u=o+l/11*Math.PI*2;e.push(n+s+Math.cos(u)*i*a[l],t,r+c+Math.sin(u)*i*a[l])}return l},u=(e,n)=>{for(let r=0;r<11;r++){let i=e+r,a=e+(r+1)%11,o=n+(r+1)%11,s=n+r;t.push(i,a,o,i,o,s)}},d=()=>{let e=[];for(let t=0;t<11;t++)e.push(.78+c()*.42);return e.map((t,n)=>(t*2+e[(n+1)%11]+e[(n+11-1)%11])/4)},f=i,p=-1,m=c()*6.283,h=0,g=0,_=0;for(;f>a;){let a=Math.min(1,(i-f)/22),s=(1.2+c()*1.4)*(1+a*1.6),v=o*.5*(1+a*.35)*(.88+c()*.24),y=d();m+=(c()-.5)*.5,h+=(c()-.5)*.18*o,g+=(c()-.5)*.18*o;let b=.9+c()*.12,x=l(f,v*b,y,m,h,g),S=l(f-s,v,y,m,h,g);if(p<0){let i=e.length/3;e.push(n+h+(c()-.5)*.3*o,f+.05*o+c()*.06*o,r+g+(c()-.5)*.3*o);let a=l(f+.04*o,v*b*.72,y,m,h,g);for(let e=0;e<11;e++)t.push(i,a+(e+1)%11,a+e);u(l(f+.04*o,v*b*.72,y,m,h,g),l(f,v*b,y,m,h,g))}else{let e=l(f,v*b,y,m,h,g);u(p,e)}if(u(x,S),p=l(f-s,v,y,m,h,g),f-=s,_++,_>60)break}}function Is(e,t,n){let r=Os(311),i=[],a=[],o=[],s=r=>{let i=r<.5?e:t,a=r<.5?t:n,o=r<.5?r*2:(r-.5)*2;return[i.r+(a.r-i.r)*o,i.g+(a.g-i.g)*o,i.b+(a.b-i.b)*o]},c=(e,t,n,r)=>{i.push(e[0],e[1],e[2]);let c=s(t);a.push(c[0],c[1],c[2]);let l=n*.35,u=.9,d=r*.35,f=Math.hypot(l,u,d);o.push(l/f,u/f,d/f)};for(let e=0;e<7;e++){let t=e/7*Math.PI*2+(r()-.5)*.6,n=.38+r()*.16,i=.34+r()*.18,a=.07+r()*.025,o=Math.cos(t),s=Math.sin(t),l=-s,u=o,d=e=>{let t=.03+n*e,r=i*Math.sin(Math.min(1,e*1.25)*Math.PI*.62)-i*.35*Math.max(0,e-.75)*4*Math.max(0,e-.75);return[o*t,Math.max(.02,r),s*t]},f=e=>a*Math.sin(Math.min(1,e*1.15+.08)*Math.PI)*+(e<1);for(let e=0;e<4;e++){let t=e/4,n=(e+1)/4,i=d(t),a=d(n),p=f(t),m=e===3?0:f(n),h=[i[0]-l*p,i[1],i[2]-u*p],g=[i[0]+l*p,i[1],i[2]+u*p],_=[a[0]-l*m,a[1],a[2]-u*m],v=[a[0]+l*m,a[1],a[2]+u*m];if(c(h,t,o,s),c(g,t,o,s),c(v,n,o,s),e<3&&(c(h,t,o,s),c(v,n,o,s),c(_,n,o,s)),e===1||e===2){let i=(t+n)/2,a=d(i),p=(e===1?.13:.16)*(.9+r()*.2);for(let e of[-1,1]){let t=[a[0]+e*l*f(i)*.8-o*.035,a[1],a[2]+e*u*f(i)*.8-s*.035],n=[a[0]+e*l*f(i)*.8+o*.035,a[1],a[2]+e*u*f(i)*.8+s*.035],r=[a[0]+e*l*(f(i)+p)+o*p*.55,a[1]-p*.35,a[2]+e*u*(f(i)+p)+s*p*.55];c(t,i,o,s),c(n,i,o,s),c(r,Math.min(1,i+.3),o,s)}}}}let l=new Ee;return l.setAttribute(`position`,new F(new Float32Array(i),3)),l.setAttribute(`normal`,new F(new Float32Array(o),3)),l.setAttribute(`color`,new F(new Float32Array(a),3)),l}var Ls=8,Rs=new l,zs=new Float64Array(24);function Bs(e){for(let t=0;t<6;t++){let n=e.planes[t];zs[t*4]=n.normal.x,zs[t*4+1]=n.normal.y,zs[t*4+2]=n.normal.z,zs[t*4+3]=n.constant}return zs}function Vs(e,t,n,r,i){for(let a=0;a<24;a+=4)if(e[a]*t+e[a+1]*n+e[a+2]*r+e[a+3]<-i)return!1;return!0}var Hs=class{mesh;lodMesh;cells=[];blocks=[];mats;cols;margin;shadows;lodDist;last=[];next=[];near=[];shade=[];far=[];farShade=[];constructor(e,t,n,r){let a=r.cell??4;this.margin=r.margin??4,this.shadows=r.shadows??!0,this.lodDist=r.lod?.dist??1/0;let o=new Map;n.forEach((e,t)=>{let n=Math.floor(e.m.elements[12]/a),r=Math.floor(e.m.elements[14]/a),i=`${Math.floor(n/Ls)}:${Math.floor(r/Ls)}`,s=`${n}:${r}`,c=o.get(i);c||(c=new Map,o.set(i,c));let l=c.get(s);l||(l=[],c.set(s,l)),l.push(t)});let s=n.length,c=n.some(e=>!!e.c);this.mats=new Float32Array(s*16),this.cols=c?new Float32Array(s*3):null,e.boundingSphere||e.computeBoundingSphere();let u=e.boundingSphere,d=0;for(let e of o.values()){let t={s:new l,top:0,c0:this.cells.length,c1:this.cells.length};for(let r of e.values()){let e={s:new l,top:0,start:d,n:r.length};r.forEach((t,r)=>{let i=n[t];if(i.m.toArray(this.mats,d*16),this.cols){let e=i.c;this.cols[d*3]=e?e.r:1,this.cols[d*3+1]=e?e.g:1,this.cols[d*3+2]=e?e.b:1}Rs.copy(u).applyMatrix4(i.m),r===0?e.s.copy(Rs):e.s.union(Rs),e.top=Math.max(e.top,Rs.center.y+Rs.radius),d++}),t.c1===t.c0?t.s.copy(e.s):t.s.union(e.s),t.top=Math.max(t.top,e.top),this.cells.push(e),t.c1=this.cells.length}this.blocks.push(t)}let f=(e,n)=>{let a=new m(e,t,Math.max(1,s));a.name=n,a.instanceMatrix.setUsage(N),this.cols&&(a.instanceColor=new i(new Float32Array(Math.max(1,s)*3),3),a.instanceColor.setUsage(N)),a.count=0,a.visible=!1,a.frustumCulled=!1,a.castShadow=this.shadows,a.receiveShadow=!0,a.customDepthMaterial=r.depth??tn(`rigid`,!0),a.renderOrder=r.renderOrder??0;let o={main:0,all:0};return a.userData.split=o,a.onBeforeRender=()=>{a.count=o.main},a.onBeforeShadow=()=>{a.count=o.all},a};this.mesh=f(e,r.name),this.lodMesh=r.lod?f(r.lod.geometry,`${r.name}_lod`):null}get size(){return this.mats.length/16}cull(e){let{near:t,shade:n,far:r,farShade:i}=this;t.length=n.length=r.length=i.length=0;let a=!!this.lodMesh,o=e?Math.hypot(e.sdx,e.sdz):0,s=this.margin,c=this.shadows&&o>0,l=e?Bs(e.frustum):zs,u=e?e.sdx:0,d=e?e.sdz:0,f=(e,t)=>{let n=e.center;if(Vs(l,n.x,n.y,n.z,e.radius+s))return 2;if(!c)return 0;let r=t*.5;return+!!Vs(l,n.x+u*r,Math.min(n.y,r),n.z+d*r,e.radius+o*r+s)};for(let o of this.blocks)if(!(e&&f(o.s,o.top)===0))for(let s=o.c0;s<o.c1;s++){let o=this.cells[s];if(!e){t.push(s);continue}let c=f(o.s,o.top);c===2?(a&&Math.hypot(o.s.center.x-e.fx,o.s.center.z-e.fz)>this.lodDist?r:t).push(s):c===1&&(a?i:n).push(s)}let p=this.next;p.length=0,p.push(...t,-1,...n,-2,...r,-3,...i);let m=this.last,h=m.length===p.length;for(let e=0;h&&e<p.length;e++)h=m[e]===p[e];h||(this.last=p.slice(),this.fill(this.mesh,t,n),this.lodMesh&&this.fill(this.lodMesh,r,i))}fill(e,t,n){let r=e.instanceMatrix.array,i=e.instanceColor?e.instanceColor.array:null,a=0,o=e=>{for(let t of e){let e=this.cells[t];r.set(this.mats.subarray(e.start*16,(e.start+e.n)*16),a*16),i&&this.cols&&i.set(this.cols.subarray(e.start*3,(e.start+e.n)*3),a*3),a+=e.n}};o(t);let s=e.userData.split;s.main=a,o(n),s.all=a,e.count=a,e.visible=a>0,e.instanceMatrix.clearUpdateRanges(),e.instanceMatrix.addUpdateRange(0,Math.max(1,a)*16),e.instanceMatrix.needsUpdate=!0,e.instanceColor&&(e.instanceColor.clearUpdateRanges(),e.instanceColor.addUpdateRange(0,Math.max(1,a)*3),e.instanceColor.needsUpdate=!0)}dispose(){this.mesh.dispose(),this.lodMesh?.dispose()}};function Us(e,t){let n=e.index?e.toNonIndexed():e,r=n.getAttribute(`position`),i=n.getAttribute(`color`),a=Math.floor(r.count/3);if(a<=t)return n!==e&&n.dispose(),e.clone();n.computeBoundingBox();let o=n.boundingBox,s=Math.max(o.max.x-o.min.x,o.max.y-o.min.y,o.max.z-o.min.z,.001),c=i?i.itemSize:0,l=e=>{let t=new Map,n=[],s=[],l=[],u=new Int32Array(r.count);for(let a=0;a<r.count;a++){let d=r.getX(a),f=r.getY(a),p=r.getZ(a),m=`${Math.floor((d-o.min.x)/e)},${Math.floor((f-o.min.y)/e)},${Math.floor((p-o.min.z)/e)}`,h=t.get(m);if(h===void 0){h=l.length,t.set(m,h),l.push(0),n.push(0,0,0);for(let e=0;e<c;e++)s.push(0)}l[h]++,n[h*3]+=d,n[h*3+1]+=f,n[h*3+2]+=p;for(let e=0;e<c;e++)s[h*c+e]+=i.getComponent(a,e);u[a]=h}let d=new Set,f=[];for(let e=0;e<a;e++){let t=u[e*3],n=u[e*3+1],r=u[e*3+2];if(t===n||n===r||t===r)continue;let i=[t,n,r].sort((e,t)=>e-t).join(`,`);d.has(i)||(d.add(i),f.push([t,n,r]))}let p=new Float32Array(l.length*3),m=c?new Float32Array(l.length*c):null;for(let e=0;e<l.length;e++){for(let t=0;t<3;t++)p[e*3+t]=n[e*3+t]/l[e];if(m)for(let t=0;t<c;t++)m[e*c+t]=s[e*c+t]/l[e]}return{tris:f,cp:p,cc:m}},u=s/256,d=s/2,f=l(d);for(let e=0;e<18;e++){let e=(u+d)/2,n=l(e);n.tris.length<=t?(f=n,d=e):u=e}let p=f.tris.length,m=new Float32Array(p*9),h=c?new Float32Array(p*3*c):null;f.tris.forEach((e,t)=>{for(let n=0;n<3;n++)m.set(f.cp.subarray(e[n]*3,e[n]*3+3),(t*3+n)*3),h&&f.cc&&h.set(f.cc.subarray(e[n]*c,e[n]*c+c),(t*3+n)*c)});let g=new Ee;return g.setAttribute(`position`,new F(m,3)),h&&g.setAttribute(`color`,new F(h,c)),g.computeVertexNormals(),n!==e&&n.dispose(),g}function Ws(e,t){let n=e.index?e.toNonIndexed():e,r=n.getAttribute(`position`),i=Math.floor(r.count/3),a=new Map,o=(e,t)=>Math.hypot(r.getX(e)-r.getX(t),r.getY(e)-r.getY(t),r.getZ(e)-r.getZ(t));for(let e=0;e<i;e++){let n=(r.getX(e*3)+r.getX(e*3+1)+r.getX(e*3+2))/3,i=(r.getZ(e*3)+r.getZ(e*3+1)+r.getZ(e*3+2))/3,s=Math.max(o(e*3,e*3+1),o(e*3+1,e*3+2),o(e*3+2,e*3))>t?`long`:`${Math.floor(n/t)}:${Math.floor(i/t)}`,c=a.get(s);c||(c=[],a.set(s,c)),c.push(e)}let s=[];for(let e of a.values()){let t=new Ee;for(let[r,i]of Object.entries(n.attributes)){let n=i.itemSize,a=i.array,o=new a.constructor(e.length*3*n);e.forEach((e,t)=>o.set(a.subarray(e*3*n,(e+1)*3*n),t*3*n)),t.setAttribute(r,new F(o,n,i.normalized))}t.computeBoundingSphere(),s.push(t)}return n!==e&&n.dispose(),s}var Gs=.5,Ks=4.5,qs=.9,Js=3.6,Ys=60;function Xs(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function Zs(e,t){let n=Math.sin(e*127.1+t*311.7)*43758.5453;return n-Math.floor(n)}function Qs(e,t){let n=Math.floor(e),r=Math.floor(t),i=e-n,a=t-r,o=i*i*(3-2*i),s=a*a*(3-2*a),c=Zs(n,r),l=Zs(n+1,r),u=Zs(n,r+1),d=Zs(n+1,r+1);return c+(l-c)*o+(u-c)*s+(c-l-u+d)*o*s}function $s(e,t,n){let r=!1;for(let i=0,a=n.length-1;i<n.length;a=i++){let o=n[i][0],s=n[i][1],c=n[a][0],l=n[a][1];s>t!=l>t&&e<(c-o)*(t-s)/(l-s)+o&&(r=!r)}return r}function ec(e,t,n,r,i,a){let o=i-n,s=a-r,c=o*o+s*s,l=c>0?((e-n)*o+(t-r)*s)/c:0;l=l<0?0:l>1?1:l;let u=n+l*o-e,d=r+l*s-t;return Math.sqrt(u*u+d*d)}function tc(e,t,n){let r=1/0;for(let i=0,a=n.length-1;i<n.length;a=i++)r=Math.min(r,ec(e,t,n[a][0],n[a][1],n[i][0],n[i][1]));return r}function nc(e){let t={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let[n,r]of e)t.minX=Math.min(t.minX,n),t.minY=Math.min(t.minY,r),t.maxX=Math.max(t.maxX,n),t.maxY=Math.max(t.maxY,r);return t}function rc(e,t,n){let r=Math.max(n.minX-e,0,e-n.maxX),i=Math.max(n.minY-t,0,t-n.maxY);return Math.sqrt(r*r+i*i)}function ic(e){let t=0;for(let n=0,r=e.length-1;n<e.length;r=n++)t+=e[r][0]*e[n][1]-e[n][0]*e[r][1];return t/2}function ac(e,t,n,r,i){let a=i,o=!1;for(let i=0;i<n.length;i++)rc(e,t,r[i])>=a&&!o||($s(e,t,n[i])&&(o=!0),a=Math.min(a,tc(e,t,n[i])));return o?-Math.min(a,i):Math.min(a,i)}function oc(e){let t=(e,t)=>Math.abs(e[0]-t[0])<.001&&Math.abs(e[1]-t[1])<.001,n=e.map(e=>ic(e)<0?[...e].reverse():[...e]);for(let e=0;e<32;e++){let e=!1;search:for(let r=0;r<n.length;r++)for(let i=r+1;i<n.length;i++){let a=n[r],o=n[i];for(let s=0;s<a.length;s++){let c=a[s],l=a[(s+1)%a.length];for(let u=0;u<o.length;u++){if(!t(o[u],l)||!t(o[(u+1)%o.length],c))continue;let d=[];for(let e=1;e<=a.length;e++)d.push(a[(s+e)%a.length]);for(let e=2;e<o.length;e++)d.push(o[(u+e)%o.length]);n[r]=d,n.splice(i,1),e=!0;break search}}}if(!e)break}return n}function sc(e,t,n,r){let i=t?t.length:e.length/3,a=[];for(let o=0;o+2<i;o+=3){let i=(t?t[o]:o)*3,s=(t?t[o+1]:o+1)*3,c=(t?t[o+2]:o+2)*3,l=e[i+1]-n,u=e[s+1]-n,d=e[c+1]-n;if(!(l>=0&&u>=0&&d>=0||l<0&&u<0&&d<0)){a.length=0;for(let[t,n,r,o]of[[i,s,l,u],[s,c,u,d],[c,i,d,l]]){if(r>=0==o>=0)continue;let i=r/(r-o);a.push(e[t]+(e[n]-e[t])*i,e[t+2]+(e[n+2]-e[t+2])*i)}a.length>=4&&r.push(a[0],a[1],a[2],a[3])}}}function cc(e,t,n,r,i){let a=[],o=ic(e)>0,s=e=>Math.abs(e[0])<.01||Math.abs(e[1])<.01||Math.abs(e[0]-r[0])<.01||Math.abs(e[1]-r[1])<.01;for(let r=0;r<e.length;r++){let c=e[r],l=e[(r+1)%e.length],u=l[0]-c[0],d=l[1]-c[1],f=Math.hypot(u,d);if(f<1e-4)continue;let p=s(c)&&s(l)&&(Math.abs(c[0]-l[0])<.01||Math.abs(c[1]-l[1])<.01),m=p?1:Math.max(1,Math.ceil(f/t)),h=(o?d:-d)/f,g=(o?-u:u)/f;for(let e=0;e<m;e++){let t=e/m,r=c[0]+u*t,o=c[1]+d*t,s=0;!p&&e>0&&(s=((Qs(r*.55+i,o*.55)-.5)*2*.7+(Qs(r*1.7,o*1.7+i)-.5)*2*.3)*n),a.push([r+h*s,o+g*s])}}return a}function lc(e,t){let n=[e[0]];for(let r=1;r<e.length;r++){let i=e[r-1],a=e[r],o=Math.max(1,Math.ceil(Math.hypot(a[0]-i[0],a[1]-i[1])/t));for(let e=1;e<=o;e++)n.push([i[0]+(a[0]-i[0])*e/o,i[1]+(a[1]-i[1])*e/o])}return n}function uc(e){let t=e.map(([e,t])=>new O(e,-t));return te.isClockWise(t)&&(t=t.reverse()),new s(t)}var dc={lane:`#9A927F`,laneGrout:`#6F685A`,verge:`#7C7666`,jungle:`#4E5547`,moss:`#475A43`,earth:`#5C5446`,clearing:`#8A8576`,inscription:`#B7B0A0`,cliffTop:`#5E6450`,cliffFace:`#45423C`,cliffLip:`#8E8979`,edgeLight:`#D8D0BC`,curb:`#8A8476`,grassRoot:`#2F3B30`,grassTip:`#9AA478`,leaf:`#3F5A45`,trunk:`#4A3F36`,stone:`#77726A`,chasm:`#2A2D33`,mist:`#5E6C93`,flank:`#5D5A55`,rock:`#4A4C52`,shaftFloor:`#A4A69E`,seat:`#B4AE9E`,plazaAubade:`#B3B1A8`,plazaSerenade:`#AF9A78`,inlayAubade:`#BFD3E6`,inlaySerenade:`#C99A5E`,midInlay:`#5F5D58`,lit:`#FFE2B8`,shadowLine:`#7A7396`,water:`#4F6B70`,litter:`#6A5434`,pebble:`#7A766D`,canopy:`#8E9A60`,glare:`#E9E6DF`},fc=e=>e.r*.2126+e.g*.7152+e.b*.0722;function pc(e,t){let n=fc(e);return n>t&&n>0?e.multiplyScalar(t/n):e}var mc=1.2;function hc(e){let t=e?.propValue&&typeof e.propValue==`object`?e.propValue:{},n=e=>typeof t[e]==`number`&&Number.isFinite(t[e])&&t[e]>0?t[e]:1;return{tree:n(`tree`),rock:n(`rock`),stone:n(`stone`),clutter:n(`clutter`),landmark:n(`landmark`)}}function gc(e){let t={...dc},n=e?.colors&&typeof e.colors==`object`?e.colors:void 0;if(n)for(let e of Object.keys(t)){let r=n[e];typeof r==`string`&&/^#[0-9a-fA-F]{6}$/.test(r)&&(t[e]=r)}return t}function _c(e){let t=[],n=e=>Array.isArray(e)&&e.length>=2&&typeof e[0]==`number`&&typeof e[1]==`number`,r=e=>{if(Array.isArray(e)){if(e.length>=3&&e.every(n)){t.push(e.map(e=>[e[0],e[1]]));return}for(let t of e)r(t)}};return r(e),t}function vc(e){if(!Array.isArray(e))return[];let t=[];for(let n of e){if(!Array.isArray(n))continue;let e=n.filter(e=>Array.isArray(e)&&typeof e[0]==`number`&&typeof e[1]==`number`).map(e=>[e[0],e[1]]);e.length>=2&&t.push(e)}return t}var yc=e=>typeof e==`number`&&Number.isFinite(e)&&e>0?e:void 0,bc=e=>Array.isArray(e)&&typeof e[0]==`number`&&typeof e[1]==`number`?[e[0],e[1]]:void 0,xc=[`tree`,`rock`,`stone`],Sc=[`litter`,`grain`,`moss`];async function Cc(e,t){let n=(e.art.terrain??{}).props??{},r={},i=!1;for(let e of xc){if(Array.isArray(n[e])&&n[e].length===0){r[e]=[],i=!0;continue}let a=Array.isArray(n[e])?n[e].filter(e=>typeof e==`string`):[],o=(await Promise.all(a.map(t))).map(e=>{if(!e?.renderable)return null;let t=[];if(e.gltf.scene.updateMatrixWorld(!0),e.gltf.scene.traverse(e=>{let n=e;if(!n.isMesh)return;let r=n.geometry.clone().applyMatrix4(n.matrixWorld);for(let e of Object.keys(r.attributes))[`position`,`normal`,`color`].includes(e)||r.deleteAttribute(e);t.push(r)}),!t.length)return null;let n=t.some(e=>{let t=e.getAttribute(`color`);if(!t||t.itemSize!==4)return!1;for(let e=0;e<t.count;e++)if(t.getW(e)<.999)return!0;return!1});for(let e of t){let t=e.getAttribute(`color`);if(!t||t.itemSize===4&&n)continue;let r=new Float32Array(t.count*(n?4:3));for(let e=0;e<t.count;e++){let i=e*(n?4:3);r[i]=t.getX(e),r[i+1]=t.getY(e),r[i+2]=t.getZ(e),n&&(r[i+3]=0)}e.setAttribute(`color`,new F(r,n?4:3))}return t.length===1?t[0]:ce(t,!1)}).filter(e=>!!e);o.length&&(r[e]=o,i=!0)}return i?r:null}function wc(){let e=new Uint8Array(262144),t=Xs(7741),n=e=>Float32Array.from({length:e*e},()=>t()),r=(t,r)=>{let i=n(r);for(let n=0;n<256;n++)for(let a=0;a<256;a++){let o=a*r/256,s=n*r/256,c=Math.floor(o),l=Math.floor(s),u=(o-c)*(o-c)*(3-2*(o-c)),d=(s-l)*(s-l)*(3-2*(s-l)),f=i[l*r+c],p=i[l*r+(c+1)%r],m=i[(l+1)%r*r+c],h=i[(l+1)%r*r+(c+1)%r];e[(n*256+a)*4+t]=Math.round(255*(f+(p-f)*u+(m-f+(f-p+h-m)*u)*d))}};r(0,32),r(1,32),r(2,48);for(let t=3;t<e.length;t+=4)e[t]=255;let i=new o(e,256,256,be,f);return i.wrapS=i.wrapT=z,i.magFilter=re,i.minFilter=p,i.generateMipmaps=!0,i.needsUpdate=!0,i}var Tc=.6;function Ec(e=!1,t=null){let n=new Pe({vertexColors:!0,roughness:.86,metalness:0}),r={uSwayT:mn.valeTime,uSwayOn:{value:+!!e},...t??Nc};return n.onBeforeCompile=e=>{Object.assign(e.uniforms,r),e.fragmentShader=e.fragmentShader.replace(`#include <roughnessmap_fragment>`,`#include <roughnessmap_fragment>
#ifdef USE_COLOR_ALPHA
  roughnessFactor = mix( roughnessFactor, 0.75, clamp( vColor.a, 0.0, 1.0 ) );
#endif`),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>\n${Et}\nuniform float uSwayOn;\n${Ho}`).replace(`#include <begin_vertex>`,`#include <begin_vertex>\nif ( uSwayOn > 0.5 ) {\n${Dt}\n}`).replace(`#include <color_vertex>`,`#include <color_vertex>\n${Uo}`)},n.customProgramCacheKey=()=>`vale_prop_matte_v4`,n}var Dc={box:!0};function Oc(e){e.updateMatrixWorld(!0),e.geometry.boundingBox||e.geometry.computeBoundingBox();let t=e.geometry.boundingBox,n=e.matrixWorld.elements,r=new Float32Array(24);for(let e=0;e<8;e++){let i=e&1?t.max.x:t.min.x,a=e&2?t.max.y:t.min.y,o=e&4?t.max.z:t.min.z;r[e*3]=n[0]*i+n[4]*a+n[8]*o+n[12],r[e*3+1]=n[1]*i+n[5]*a+n[9]*o+n[13],r[e*3+2]=n[2]*i+n[6]*a+n[10]*o+n[14]}return r}function kc(e,t,n,r){for(let i of e.planes){let e=i.normal.x,a=i.normal.y,o=i.normal.z,s=i.constant+r,c=!0;for(let r=0;r<n&&c;r++)c=e*t[r*3]+a*t[r*3+1]+o*t[r*3+2]+s<0;if(c)return!0}return!1}var Ac=null;function jc(){return Ac||(Ac=new o(new Uint8Array([255,255,255,255]),1,1,be,f),Ac.colorSpace=de,Ac.name=`vale_landmark_white`,Ac.needsUpdate=!0),Ac}async function Mc(e,t,n=()=>0){let r=(e.art.terrain??{}).landmarks;if(!Array.isArray(r))return[];let i=hc(e.art.terrain),a=[];return await Promise.all(r.map(async e=>{let r=e;if(typeof r.model!=`string`||!Array.isArray(r.at))return;let o=await t(r.model);if(!o?.renderable)return;let s=o.gltf.scene.clone(),c=Number(r.at[0]),l=Number(r.at[1]);s.position.set(c,n(c,l),l),s.rotation.y=typeof r.rot==`number`?r.rot*Math.PI/180:0;let u=i.landmark*(typeof r.value==`number`&&Number.isFinite(r.value)&&r.value>0?r.value:1),d=new Map,f=e=>{if(u===1||!e.color)return e;let t=d.get(e);return t||(t=e.clone(),t.color.multiplyScalar(u),d.set(e,t)),t};s.traverse(e=>{let t=e;if(t.isMesh){t.castShadow=!0,t.receiveShadow=!0,t.material=Array.isArray(t.material)?t.material.map(f):f(t.material);for(let e of Array.isArray(t.material)?t.material:[t.material]){let t=e;t.isMeshStandardMaterial&&!t.map&&(t.map=jc(),t.needsUpdate=!0),G(e)}}}),d.size&&(s.userData.valeOwnMaterials=[...d.values()]),a.push(s)})),a}var Nc={uQuadNW:{value:new R(1,1,1)},uQuadNE:{value:new R(1,1,1)},uQuadSW:{value:new R(1,1,1)},uQuadSE:{value:new R(1,1,1)},uQuadC:{value:new B(-1e6,-1e6,1)}};function Pc(e){let t=e&&typeof e==`object`?e:{},n=typeof t.strength==`number`&&Number.isFinite(t.strength)?Math.max(0,Math.min(.1,t.strength)):.04,r=e=>{if(typeof e!=`string`||!/^#[0-9a-fA-F]{6}$/.test(e))return new R(1,1,1);let t=new R().setStyle(e),r=t.r*.2126+t.g*.7152+t.b*.0722,i=[t.r/r-1,t.g/r-1,t.b/r-1],a=Math.max(1e-6,...i.map(Math.abs));return new R(1+n*i[0]/a,1+n*i[1]/a,1+n*i[2]/a)},i=Array.isArray(t.centre)?t.centre:[0,0];return{uQuadNW:{value:r(t.nw)},uQuadNE:{value:r(t.ne)},uQuadSW:{value:r(t.sw)},uQuadSE:{value:r(t.se)},uQuadC:{value:new B(Number(i[0])||0,Number(i[1])||0,typeof t.blendM==`number`?t.blendM:8)}}}function Fc(){let e=new o(new Uint8Array([160,160,160,153]),1,1,be,f);return e.needsUpdate=!0,e}function Ic(e){let t=new _;t.name=`vale_terrain`;let[n,r]=e.size,i=e.art.terrain??{},s=gc(i);Cn({map:yc(i.cloudShadow)??0});let c=i.wallStyle===`gorge`,u=i.surface===`span`||i.surface===`plate`||i.surface===`dial`?i.surface:c?`span`:e.lanes.length===0?`plate`:`dial`,d=Xs(24301^Math.round(n*131+r*17)),p=e.walls.map(e=>e.map(e=>[e[0],e[1]])),m=(e.thickets??[]).map(e=>e.map(e=>[e[0],e[1]])),h=p.map(nc),g=p.map(e=>c&&Math.abs(ic(e))>60),v=m.map(nc),y=e.lanes.map(e=>e.path.map(e=>[e[0],e[1]])),b=[],x=new Set,S=-2,C=!0,w=(e,t,n,r,i=!0,a,o=0,s={})=>{let c=new _;if(c.name=r,!n.length)return c;let l=new Hs(e,t,n,{name:r,shadows:i,depth:a,renderOrder:o,lod:s.lod??null,margin:s.margin});return c.add(l.mesh),l.lodMesh&&c.add(l.lodMesh),c.userData.cull=l,x.add(l),C=!0,c},T=[],E=e=>{if(!e.castShadow)return;e.updateMatrixWorld(!0),e.geometry.boundingSphere||e.geometry.computeBoundingSphere();let t=e.geometry.boundingSphere.clone().applyMatrix4(e.matrixWorld),n=Oc(e),r=new Float32Array(48);r.set(n);let i=-1/0,a=1/0;for(let e=0;e<8;e++)i=Math.max(i,n[e*3+1]),a=Math.min(a,n[e*3+1]);T.push({o:e,s:t,top:i,floor:a,pts:r}),C=!0},D=new l,ee=e=>{let t=e?Math.hypot(e.sdx,e.sdz):0;for(let n of T){if(!e){n.o.castShadow=!0;continue}let r;if(Dc.box){let i=n.pts,a=Math.min(0,n.floor);if(t>0)for(let t=0;t<8;t++){let n=Math.max(0,i[t*3+1]-a);i[24+t*3]=i[t*3]+e.sdx*n,i[24+t*3+1]=a,i[24+t*3+2]=i[t*3+2]+e.sdz*n}r=!kc(e.frustum,i,t>0?16:8,1)}else r=!0;if(r&&(D.copy(n.s),D.radius+=1,r=e.frustum.intersectsSphere(D),!r&&t>0)){let i=n.s.center.y+n.s.radius,a=Math.max(0,i)*.5;D.center.set(n.s.center.x+e.sdx*a,Math.min(n.s.center.y,a),n.s.center.z+e.sdz*a),D.radius=n.s.radius+t*a+1,r=e.frustum.intersectsSphere(D)}n.o.castShadow=r}},k=e=>{let t=Oc(e),n=e.intersectsFrustum.bind(e);e.intersectsFrustum=e=>(!Dc.box||!kc(e,t,8,.5))&&n(e)};t.addEventListener(`childadded`,e=>{let t=e.child;t.name===`vale_scatter`||t.name.startsWith(`vale_`)||(t.updateMatrixWorld(!0),t.traverse(e=>{!e.isMesh||e.isInstancedMesh||e.isSkinnedMesh||(E(e),k(e))}),t.traverse(e=>{let t=e;t.isMesh&&(Array.isArray(t.material)?t.material:[t.material]).every(e=>!e.transparent)&&(t.renderOrder=-3)}))});let te=e=>{let t=e.userData.cull;t&&(x.delete(t),t.dispose())},A=e=>new R().setStyle(e),j=hc(i),ne=pc(A(s.edgeLight),fc(A(s.lane))*mc),ie=(e,t)=>Math.abs(e)<.01||Math.abs(t)<.01||Math.abs(e-n)<.01||Math.abs(t-r)<.01,ae=[];for(let t of e.bases)ae.push({x:t.fountain.at[0],y:t.fountain.at[1],r:t.fountain.radius+3.5}),ae.push({x:t.shop.at[0],y:t.shop.at[1],r:t.shop.radius+1.5}),ae.push({x:t.spawn[0],y:t.spawn[1],r:3});for(let t of e.structures??[])ae.push({x:t.at[0],y:t.at[1],r:4.5});for(let t of e.camps??[]){let e=0,n=0;for(let r of t.units)e+=r.at[0],n+=r.at[1];e/=Math.max(1,t.units.length),n/=Math.max(1,t.units.length);let r=0;for(let i of t.units)r=Math.max(r,Math.hypot(i.at[0]-e,i.at[1]-n));ae.push({x:e,y:n,r:r+(t.objective?6:4.5),camp:!0,room:!t.objective})}for(let t of e.pickups??[])ae.push({x:t.at[0],y:t.at[1],r:2.2});for(let t of e.spawns??[])ae.push({x:t[0],y:t[1],r:2.6});for(let t of e.shops??[])ae.push({x:t.at[0],y:t.at[1],r:t.radius+1.5});let oe=ae.filter(e=>e.room),ce=i.noonline,le=ce?.standingShadow,ue=ce?.fallenShaft,de=_c(le?.floor),fe=_c(ue?.floor),pe=de.map(nc),he=fe.map(nc),ge=oc(p.filter((e,t)=>g[t])),_e=ge.map(nc),ve=p.map((e,t)=>({w:e,b:h[t]})).filter((e,t)=>!g[t]),ye=[];{let t=Array.isArray(i.plazas)?i.plazas:[],n=t.length?t.map(e=>({at:bc(e.at),r:yc(e.radius),side:typeof e.side==`number`?e.side:0})):e.bases.map(e=>({at:[(e.fountain.at[0]+e.spawn[0])/2+(e.team===0?3:-3),e.fountain.at[1]],r:13,side:e.team}));for(let t of n){if(!t.at||!t.r)continue;let n=e.bases[0];for(let r of e.bases)Math.hypot(r.fountain.at[0]-t.at[0],r.fountain.at[1]-t.at[1])<Math.hypot(n.fountain.at[0]-t.at[0],n.fountain.at[1]-t.at[1])&&(n=r);let r=n?n.fountain:{at:t.at,radius:4};ye.push({x:t.at[0],y:t.at[1],r:t.r,side:t.side,fx:r.at[0],fy:r.at[1],fr:r.radius})}}let xe=(e,t,n)=>ye.some(r=>Math.hypot(e-r.x,t-r.y)<r.r+n),Se=i.seat,Ce=bc(Se?.at),N=Ce?new B(Ce[0],Ce[1],yc(Se?.radius)??0):new B(0,0,0),we=i.plate,P=bc(we?.at)??(e.shops[0]?e.shops[0].at:[n/2,r/2]),Te=yc(we?.radius)??Math.min(n,r)/2-2,Oe=i.gorge??{},Ae=typeof Oe.axisY==`number`?Oe.axisY:y[0]?y[0].reduce((e,t)=>e+t[1],0)/y[0].length:r/2,je=yc(Oe.deckHalf)??7,Me=yc(Oe.depth)??36,Ne=yc(Oe.bandHeight)??1,Fe=i.snap,Ie=bc(Fe?.at),Le=yc(Fe?.radius)??0,Re=Math.max(.5,Math.max(n,r)/384),ze=Math.ceil(n/Re)+1,Be=Math.ceil(r/Re)+1,Ve=new Uint8Array(ze*Be*4),He=new Uint8Array(ze*Be*4),L={ld:new Float32Array(ze*Be),cd:new Float32Array(ze*Be),wd:new Float32Array(ze*Be),td:new Float32Array(ze*Be),sh:new Float32Array(ze*Be),sf:new Float32Array(ze*Be),ch:new Float32Array(ze*Be)};for(let e=0;e<Be;e++){let t=e*Re;for(let n=0;n<ze;n++){let r=n*Re,i=16;for(let e of y)for(let n=1;n<e.length;n++)i=Math.min(i,ec(r,t,e[n-1][0],e[n-1][1],e[n][0],e[n][1]));let a=16;for(let e of oe)a=Math.min(a,Math.hypot(r-e.x,t-e.y)-e.r);let o=8,s=0;for(let{w:e,b:n}of ve)if(!(rc(r,t,n)>=o)){if($s(r,t,e)){o=0,s=Math.min(4,tc(r,t,e));break}o=Math.min(o,tc(r,t,e))}let c=4;for(let e=0;e<m.length;e++){if(rc(r,t,v[e])>=Math.abs(c))continue;let n=tc(r,t,m[e]);c=Math.min(c,$s(r,t,m[e])?-n:n)}let l=de.length?ac(r,t,de,pe,4):4,u=fe.length?ac(r,t,fe,he,4):4,d=ge.length?-ac(r,t,ge,_e,4):-4,f=e*ze+n,p=f*4;L.ld[f]=i,L.cd[f]=a,L.wd[f]=o,L.td[f]=c,L.sh[f]=l,L.sf[f]=u,L.ch[f]=d,Ve[p]=Math.round(Math.min(1,i/16)*255),Ve[p+1]=Math.round(Math.min(1,Math.max(0,(a+8)/24))*255),Ve[p+2]=Math.round(Math.min(1,o/8)*255),Ve[p+3]=Math.round(Math.min(1,Math.max(0,(c+4)/8))*255),He[p]=Math.round((l+4)/8*255),He[p+1]=Math.round((u+4)/8*255),He[p+2]=Math.round(s/4*255),He[p+3]=Math.round((d+4)/8*255)}}let z=(e,t,n)=>{let r=Math.min(ze-1,Math.max(0,Math.round(t/Re)));return e[Math.min(Be-1,Math.max(0,Math.round(n/Re)))*ze+r]},Ge=(e,t=ze,n=Be)=>{let r=new o(e,t,n,be,f);return r.magFilter=re,r.minFilter=re,r.generateMipmaps=!1,r.needsUpdate=!0,b.push(r),r},Ke=Ge(Ve),qe=Ge(He),V=new ps,Je=(e,t)=>z(L.wd,e,t)<=.01;if(u===`dial`){for(let e of y)Cs(V,e,Js,.3,9,(e,t)=>!Je(e,t)&&!xe(e,t,.5)&&!(N.z>0&&Math.hypot(e-N.x,t-N.y)<N.z+1));let e=i.hourLines??{},t=bc(e.centre)??[n/2,r/2],a=yc(e.ring);a&&V.circle(t,a,.3,q.groove,.5);for(let t of vc(e.paths))V.poly(t,.3,q.groove);let o=(e,t)=>e>.5&&t>.5&&e<n-.5&&t<r-.5&&z(L.ld,e,t)<3.18&&!Je(e,t)&&z(L.wd,e,t)>.5&&z(L.td,e,t)>.35&&z(L.cd,e,t)>.5&&!xe(e,t,1.2)&&!(N.z>0&&Math.hypot(e-N.x,t-N.y)<N.z+1.5);y.forEach((e,t)=>Es(V,e,{half:3,every:[2.6,6.2],seed:7100+t*131,crack:q.lit,chalk:q.mid,pCrack:.45,pChalk:.3,keep:o}))}else if(u===`span`){if(ge.forEach((e,t)=>{let r=ic(e)>0;for(let i=0;i<e.length;i++){let a=e[i],o=e[(i+1)%e.length];ie(a[0],a[1])&&ie(o[0],o[1])||ws(V,[a,o],(e,t)=>r?[t[1],-t[0]]:[-t[1],t[0]],.4,300+t*31+i,(e,t)=>e>.3&&e<n-.3&&z(L.ch,e,t)<.05)}}),Ie&&Le>0){let e=xs(4242),t=Ds([Ie[0]-.6,Ie[1]-Le-2],[Ie[0]+.6,Ie[1]+Le+2],2.4,7,e),n=t.length-1;for(let r=1;r<=n;r++){let i=(r-.5)/n,a=.05+.1*Math.sin(Math.PI*i)**.7*(.75+.5*e());V.seg(t[r-1],t[r],a,q.lit)}let r=e=>Math.hypot(e[0]-Ie[0],e[1]-Ie[1])<Le-.3;for(let n=0;n<30;n++){let n=t[Math.floor(e()*t.length)],i=(e()<.5?0:Math.PI)+(e()-.5)*1.7,a=1.4+e()*4.8,o=Ds(n,[n[0]+Math.cos(i)*a,n[1]+Math.sin(i)*a],a*.2,5,e);for(let e=1;e<o.length;e++)r(o[e])&&r(o[e-1])&&V.seg(o[e-1],o[e],.06-.025*(e/o.length),q.groove);if(e()<.6){let t=o[Math.floor(o.length/2)],n=i+(e()-.5)*1.8,s=a*.45,c=Ds(t,[t[0]+Math.cos(n)*s,t[1]+Math.sin(n)*s],s*.22,4,e);for(let e=1;e<c.length;e++)r(c[e])&&r(c[e-1])&&V.seg(c[e-1],c[e],.04,q.groove)}}}for(let t of e.pickups??[])V.circle(t.at,.85,.06,q.groove,.2),V.circle(t.at,.55,.04,q.groove,.2);let t=(t,r)=>t>1&&t<n-1&&z(L.ch,t,r)<-1&&z(L.td,t,r)>.35&&!Je(t,r)&&!xe(t,r,1.2)&&!(Ie&&Math.hypot(t-Ie[0],r-Ie[1])<Le+1.5)&&!(e.pickups??[]).some(e=>Math.hypot(t-e.at[0],r-e.at[1])<1.6);y.forEach((e,n)=>Es(V,e,{half:4.2,every:[2.6,6],seed:8300+n*131,crack:q.groove,chalk:q.chalk,pCrack:.45,pChalk:.32,keep:t}))}else{(e.spawns??[]).forEach((e,t)=>{let n=e[0]-P[0],r=e[1]-P[1],i=Math.hypot(n,r)||1,a=n/i,o=r/i;V.seg([P[0]+a*4.35,P[1]+o*4.35],[P[0]+a*(i-2.75),P[1]+o*(i-2.75)],.15,q.chalk),Ts(V,[e[0]-a*.35,e[1]-o*.35],t+1,1.8,.16,q.chalk),V.circle([e[0]-a*.35,e[1]-o*.35],1.62,.14,q.lit,.3)}),V.circle(P,4,.22,q.mid,.3),V.circle(P,Te-.75,.18,q.mid,.4);let t=(e.spawns??[])[0],n=t?Math.hypot(t[0]-P[0],t[1]-P[1])-.35:Te*.855;V.circle(P,n-2.25,.07,q.groove,.3),V.circle(P,n-1.95,.07,q.groove,.3),V.circle(P,n+2.05,.08,q.groove,.3);let r=(e.spawns??[]).length;for(let t=0;t<r;t++){let i=e.spawns[t],a=e.spawns[(t+1)%r],o=Math.atan2(i[1]-P[1],i[0]-P[0]),s=Math.atan2(a[1]-P[1],a[0]-P[0])-o;for(;s>Math.PI;)s-=2*Math.PI;for(;s<-Math.PI;)s+=2*Math.PI;let c=o+s/2,l=Math.cos(c),u=Math.sin(c);V.seg([P[0]+l*(n-1.95),P[1]+u*(n-1.95)],[P[0]+l*(n+2.05),P[1]+u*(n+2.05)],.07,q.groove);for(let e of[.25,.75]){let t=o+s*e,r=Math.cos(t),i=Math.sin(t);V.seg([P[0]+r*(n+1.35),P[1]+i*(n+1.35)],[P[0]+r*(n+2.05),P[1]+i*(n+2.05)],.06,q.groove)}}for(let t of e.pickups??[])V.circle(t.at,.85,.2,q.mid,.15),V.circle(t.at,.45,.14,q.chalk,.12);let i=(t,n)=>{let r=Math.hypot(t-P[0],n-P[1]);return r>5.2&&r<Te-1.6&&!Je(t,n)&&z(L.wd,t,n)>.4&&z(L.td,t,n)>.35&&!(e.spawns??[]).some(e=>Math.hypot(t-e[0],n-e[1])<2.6)&&!(e.pickups??[]).some(e=>Math.hypot(t-e.at[0],n-e.at[1])<1.4)};[7.6,12.4,17.6,22.4].forEach((e,t)=>{let n=[];for(let r=0;r<=96;r++){let i=r/96*Math.PI*2+t*.7;n.push([P[0]+Math.cos(i)*e,P[1]+Math.sin(i)*e])}Es(V,n,{half:2,every:[2.8,6.5],seed:9100+t*37,crack:q.groove,chalk:null,pCrack:.5,pChalk:0,keep:i})})}if(u===`dial`||u===`span`)for(let t of e.bases??[]){let e=t.fountain.at,n=t.shop.at,r=Math.hypot(n[0]-e[0],n[1]-e[1])||1,i=(n[0]-e[0])/r,a=(n[1]-e[1])/r,o=-a,s=i,c=(t,n=0)=>[e[0]+i*t+o*n,e[1]+a*t+s*n],l=t.fountain.radius+.4,u=l;for(;u<l+12&&z(L.wd,...c(u+1.2))>1&&xe(...c(u+1.2),-1);)u+=.25;if(!(u-l<2)){V.seg(c(l),c(u-.5),.1,q.chalk);for(let e of[-.26,.26])V.seg(c(l,e),c(u-.7,e),.05,q.groove);V.poly([c(u-.7),c(u,-.32),c(u+.7),c(u,.32)],.08,q.chalk,!0)}}let Ye=ys(V,[n,r],.125);b.push(Ye.tex,Ye.fine,Ye.index);let Xe={uInlay:{value:Ye.tex},uInlayFine:{value:Ye.fine},uInlayIdx:{value:Ye.index},uInlayScale:{value:new O(Ye.scale[0],Ye.scale[1])},uInlayFineP:{value:new a(...Ye.fineP)},uInlayAtlas:{value:new O(Ye.atlas[0],Ye.atlas[1])}},Ze=Fc();b.push(Ze);let Qe=i.temperatureField??{},$e=(e,t)=>{let n=A(typeof e==`string`?e:t),r=n.r*.2126+n.g*.7152+n.b*.0722;return n.multiplyScalar(1/Math.max(.001,r))},et=typeof Qe.strength==`number`?Math.min(1,Qe.strength*3):0,tt=Pc(i.quadrantTint),nt={litter:{value:Ze},grain:{value:Ze},moss:{value:Ze}},rt={uTempW:{value:$e(Qe.west,`#B8C6D9`)},uTempE:{value:$e(Qe.east,`#D9C2A0`)},uTempK:{value:et},uMapSize:{value:new O(n,r)}},it=r+Ys,at=new me(n+120,it- -60,1,1);at.rotateX(-Math.PI/2),at.translate(n/2,0,(-60+it)/2);let ot=new Pe({color:16777215,roughness:.9,metalness:0}),st=ye[0],H=ye[1],ct=e=>{let t=0,n=0,r=0;for(let i of e)for(let[e,a]of i)n+=e,r+=a,t++;if(!t)return new a(0,0,0,1);n/=t,r/=t;let i=0,o=0,s=0;for(let t of e)for(let[e,a]of t)i+=(e-n)**2,o+=(a-r)**2,s+=(e-n)*(a-r);let c=.5*Math.atan2(2*s,i-o);return new a(n,r,Math.cos(c),Math.sin(c))},lt=Array.from({length:16},(e,t)=>oe[t]?new a(oe[t].x,oe[t].y,oe[t].r,0):new a),ut=wc();b.push(ut);let dt={...rt,...Xe,...tt,uSplat:{value:Ke},uSplat2:{value:qe},uSplatScale:{value:new O(1/(ze*Re),1/(Be*Re))},uLaneHalf:{value:Js},uRooms:{value:lt},uRoomN:{value:Math.min(16,oe.length)},uShaftAx:{value:ct(fe)},uSheenC:{value:(e=>e.multiplyScalar(.1*fc(A(s.lane))/Math.max(1e-4,fc(e))))(A(`#9FB0C4`))},uRockC:{value:A(s.rock)},uTexLitter:nt.litter,uTexGrain:nt.grain,uTexMoss:nt.moss,uLane:{value:A(s.lane)},uGrout:{value:A(s.laneGrout)},uVerge:{value:A(s.verge)},uJungle:{value:A(s.jungle)},uMoss:{value:A(s.moss)},uEarth:{value:A(s.earth)},uClearing:{value:A(s.clearing)},uInscription:{value:A(s.inscription)},uThicketFloor:{value:A(s.grassRoot)},uShaftFloor:{value:A(s.shaftFloor)},uSeatC:{value:A(s.seat)},uMidInlay:{value:A(s.midInlay)},uLitC:{value:A(s.lit)},uPlazaA:{value:A(s.plazaAubade)},uPlazaS:{value:A(s.plazaSerenade)},uInlayA:{value:A(s.inlayAubade)},uInlayS:{value:A(s.inlaySerenade)},uPlaza0:{value:st?new a(st.x,st.y,st.r,st.side):new a},uPlaza1:{value:H?new a(H.x,H.y,H.r,H.side):new a},uFount0:{value:st?new a(st.fx,st.fy,st.fr,0):new a},uFount1:{value:H?new a(H.fx,H.fy,H.fr,0):new a},uSeat:{value:N},uPlate:{value:new B(P[0],P[1],Te)},uWaterT:mn.valeTime,uGeStone:{value:1},uGeTile:{value:ut},uSeatCol:{value:Array.from({length:10},(e,t)=>A(pt[t%pt.length].color))}},ft=u===`span`?`VALE_STYLE_SPAN`:u===`plate`?`VALE_STYLE_PLATE`:`VALE_STYLE_DIAL`;ot.onBeforeCompile=e=>{Object.assign(e.uniforms,dt),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec3 vGroundW;`).replace(`#include <project_vertex>`,`#include <project_vertex>
vGroundW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\n#define ${ft}\n${c?`#define VALE_GORGE
`:``}${Wo}\n${Ho}\n${Bo}\n${bs}\n${Vo}`).replace(`#include <map_fragment>`,Go).replace(`#include <roughnessmap_fragment>`,`#include <roughnessmap_fragment>
roughnessFactor = gRough;`).replace(`#include <emissivemap_fragment>`,`#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;\n${Ko}`).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
normal = valeBump( -vViewPosition, normal, gHeight, 1.0 );`)},ot.customProgramCacheKey=()=>`vale_ground_v10_${u}${c?`_g`:``}`,G(ot);let mt=new I(at,ot);mt.receiveShadow=!0,mt.name=`vale_ground`,t.add(mt),b.push(at,ot);let ht=(Array.isArray(i.landmarks)?i.landmarks:[]).filter(e=>typeof e.model==`string`&&Array.isArray(e.at)).map(e=>{let t=e.at,n=Array.isArray(e.size)?e.size:[2,2];if(e.footprint===`oriented`){let r=typeof e.rot==`number`?e.rot*Math.PI/180:0,i=Math.cos(r),a=Math.sin(r),o=n[0]/2,s=n[1]/2;return{x:t[0],y:t[1],sx:Math.abs(i)*o+Math.abs(a)*s,sy:Math.abs(a)*o+Math.abs(i)*s,h:yc(e.height)??3,ob:{c:i,s:a,hx:o,hy:s}}}return{x:t[0],y:t[1],sx:n[0]/2,sy:n[1]/2,h:yc(e.height)??3}}).concat((e.art.ambient?.props??[]).flatMap(e=>e.at.map(e=>({x:e[0],y:e[1],sx:.6,sy:.6,h:3.6})))),gt=(e,t)=>ht.some(n=>Math.abs(e-n.x)<n.sx+1&&t>n.y-n.sy-1&&t<n.y+n.sy+2),_t=p.map((e,t)=>ht.some(e=>{if(e.ob){let n=e.ob;return p[t].every(t=>{let r=t[0]-e.x,i=t[1]-e.y;return Math.abs(r*n.c-i*n.s)<=n.hx+.3&&Math.abs(r*n.s+i*n.c)<=n.hy+.3})}let n=h[t];return n.minX>=e.x-e.sx-.3&&n.maxX<=e.x+e.sx+.3&&n.minY>=e.y-e.sy-.3&&n.maxY<=e.y+e.sy+.3})),U=i.wallHeights??{},vt=yc(U.small)??yc(U.hourStones),yt=yc(U.large)??yc(U.rim),bt=yc(U.frame)??yc(U.rim)??3.4,W=[],St=new ss,Tt=p.map((e,t)=>u===`plate`&&!g[t]&&Math.abs(ic(e))>=25);if(p.forEach((e,t)=>{if(g[t]||_t[t]){W.push(0);return}let i=Math.abs(ic(e)),a=i<25,o=Tt[t]?bt:a?vt??1.6+.6*Zs(t,i):yt??2.6+.8*Zs(t*3.1,i);if(W.push(o),Tt[t])return;let s=1+t*.618034%1*9,c=cc(e,.9,a?.06:.28,[n,r],t*7.3);if(c.length<3)return;let l=ls(o,t*7.3+1,a);cs(St,c,l.strips,{closed:!0,ccw:ic(c)>0,seed:s,chisel:a?.05:.16,pinned:ie},o),St.cap(c,l.topY,[0,0,0,is.top],[1,s,l.topY,o])}),u===`plate`){if(Tt.some(Boolean)){let e=Math.max(96,Math.ceil(2*Math.PI*Te/.6)),t=[];for(let n=0;n<e;n++){let r=n/e*Math.PI*2;t.push([P[0]+Math.cos(r)*Te,P[1]+Math.sin(r)*Te])}let i=ls(bt,101,!1);cs(St,t,i.strips,{closed:!0,ccw:!1,seed:3,chisel:0},bt);let a=Te+.3,o=t.map(([e,t])=>[P[0]+(e-P[0])*a/Te,P[1]+(t-P[1])*a/Te]);St.cap([[-14,-14],[n+14,-14],[n+14,r+14],[-14,r+14]],i.topY,[0,0,0,is.top],[1,3,i.topY,bt],[o])}}else(c?[[[-14,0],[0,0],[0,r],[-14,r]],[[n,0],[n+14,0],[n+14,r],[n,r]]]:[[[-14,-14],[n+14,-14],[n+14,0],[-14,0]],[[-14,r],[n+14,r],[n+14,r+14],[-14,r+14]],[[-14,0],[0,0],[0,r],[-14,r]],[[n,0],[n+14,0],[n+14,r],[n,r]]]).forEach((e,t)=>{let n=3+t,r=ls(bt,100+t,!1);cs(St,e,r.strips,{closed:!0,ccw:ic(e)>0,seed:n,chisel:0,pinned:ie},bt),St.cap(e,r.topY,[0,0,0,is.top],[1,n,r.topY,bt])});m.forEach((e,t)=>{let n=ic(e)>0,r=[{from:{off:.1,y:-.03},to:{off:.1,y:.1},kind:is.lipFace,course:0},{from:{off:.1,y:.1},to:{off:.05,y:.15},kind:is.chamfer,course:0},{from:{off:.05,y:.15},to:{off:-.1,y:.15},kind:is.lipTop,course:0},{from:{off:-.1,y:.15},to:{off:-.14,y:.03},kind:is.lipIn,course:0}];cs(St,lc([...e,e[0]],.6).slice(0,-1),r,{closed:!0,ccw:n,seed:50+t,chisel:.012},.15)});let Et=[],Dt=[],Ot=[],kt=St.pos.length,At=kt;if(c){let e=us(Me,7),t=(e,t,n)=>n<-5.5?((Qs(e*.16,n*.09+t*.1)-.5)*3.2+(Qs(e*.5+3,n*.3)-.5)*1)*Math.min(1,(-n-5.5)/6):0,i=(e,n,r,i,a)=>{let o=Math.min(1,Math.max(0,(-r-.6)/4.5)),s=(Qs(i*.19+3.3,1.7)-.5)*4.2+(Qs(i*.55+9.1,r*.05+2)-.5)*1.6+(Qs(i*1.3,r*.2)-.5)*.5,c=0;for(let e=0;e<a;e++)c+=(Qs(i*.085+e*7.31,e*1.7+.5)-.3)*1.3*Math.min(1,a-e);return-(s*o)-c+t(e,n,r)*.5},a=(e,t,n,r)=>{let i=Math.min(1,Math.max(0,(-n-1)/4));return((Qs(r*.045+7.7,3.1)-.5)*3.6+(Qs(r*.13+1.9,8.3)-.5)*1.2)*i};ge.forEach((n,r)=>{let o=ic(n)>0,s=e=>Math.abs(e[1]-Ae)<je-.05,c=[];for(let e=0,t=n.length;e<t;e++){if(s(n[e])||!s(n[(e+1)%t]))continue;let r=[n[e]],i=(e+1)%t;for(;s(n[i])&&r.length<t;)r.push(n[i]),i=(i+1)%t;r.push(n[i]),r.length>=4&&c.push(r)}let l=n.filter(e=>!s(e)),u=l.length,d=e=>{let t=l[e],n=l[(e+1)%u];return ie(t[0],t[1])&&ie(n[0],n[1])&&(Math.abs(t[0]-n[0])<.01||Math.abs(t[1]-n[1])<.01)},f=0;for(let e=0;e<u;e++)if(d(e)!==d((e-1+u)%u)){f=e;break}let p=[],m=null,h=()=>{if(p.length>=2){if(m){let e=lc(p,1);cs(St,e,ds(Me,11+r),{closed:!1,ccw:o,seed:20+r,chisel:.5,extra:i,yExtra:a,taper:1.5},0)}else{let n=lc(p,.9);cs(St,n,e,{closed:!1,ccw:o,seed:30+r,chisel:.05,extra:t},0)}}p=[]};for(let e=0;e<u;e++){let t=(f+e)%u,n=d(t);m!==n&&(h(),m=n,p=[l[t]]),p.push(l[(t+1)%u])}h(),c.forEach((e,t)=>{Ot.push(e);let n=e[0],i=e[e.length-1],a=i[0]-n[0],s=i[1]-n[1],c=Math.hypot(a,s)||1,l=a/c,u=s/c,d=o?s/c:-s/c,f=o?-a/c:a/c,p=0;for(let t of e)p=Math.max(p,(t[0]-n[0])*d+(t[1]-n[1])*f);let m=.08,h=[n[0]-l*m,n[1]-u*m],g=[i[0]+l*m,i[1]+u*m],_=c+2*m,v=fs(p+.06,Ne);cs(St,lc([h,g],.3),v.strips,{closed:!1,ccw:o,seed:60+r*7+t,chisel:0,roundEnds:.45},_);for(let[e,n,i]of[[h,-1,0],[g,1,_]])St.planar(v.section,t=>[e[0]+d*t[0],t[1],e[1]+f*t[0]],[l*n,0,u*n],()=>[i,0,0,is.band],e=>[1,60+r*7+t,e[1],_])})}),At=St.pos.length;let o=Xs(777);for(let e=0;e<Math.round(n*r*.008);e++){let t=o()*n,i=o()*r,a=o(),s=o(),c=o();z(L.ch,t,i)<2.8||i<2||i>r-2||Fs(Et,Dt,t,i,-3-a*a*8,-30,2+s*2.8,900+e*13+Math.floor(c*7))}}let jt=St.geometry(),Nt=new Pe({color:16777215,roughness:.86,metalness:0}),Pt={...rt,uFace:{value:A(s.cliffFace)},uLip:{value:A(s.cliffLip)},uEdgeLight:{value:ne},uTop:{value:A(s.cliffTop)},uMossC:{value:A(s.moss)},uFlank:{value:A(s.flank)},uRock:{value:A(s.rock)},uMistHi:{value:A(s.mist).multiplyScalar(.5)},uMistLo:{value:A(s.mist).multiplyScalar(.17)},uMistK:{value:c?.06:0},uEarthC:{value:A(s.earth)},uStoneTop:{value:u===`plate`?1:c?2:0},uCanopy:{value:A(s.canopy)},uPlateW:{value:new B(P[0],P[1],Te)},uGlareNear:{value:(e=>e.lerp(new R(fc(e),fc(e),fc(e)),.5).multiplyScalar(.98))(A(s.lane))},uSplat2:{value:qe},uSplatScale:dt.uSplatScale,uTexGrain:nt.grain,uTexMoss:nt.moss,uTexLitter:nt.litter};Nt.onBeforeCompile=e=>{Object.assign(e.uniforms,Pt),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>\n${qo}`).replace(`#include <project_vertex>`,`#include <project_vertex>\n${Jo}`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\n${Yo}\n${Zo}\n${Bo}\n${Vo}`).replace(`#include <map_fragment>`,Xo).replace(`#include <roughnessmap_fragment>`,`#include <roughnessmap_fragment>
roughnessFactor = cRough;`).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
normal = valeBump( -vViewPosition, normal, cH, 1.0 );`).replace(`#include <opaque_fragment>`,`${Qo(`vCliffW`)}\n#include <opaque_fragment>\n${$o(`vCliffW`)}`)},Nt.customProgramCacheKey=()=>`vale_walls_v10`,G(Nt);let Ft=Ws(jt,16);jt.dispose();for(let e of Ft){let n=new I(e,Nt);n.castShadow=!0,n.receiveShadow=!0,n.name=`vale_cliffs`,n.renderOrder=-3,t.add(n),E(n)}if(b.push(...Ft,Nt),c){let e=new Ee;e.setAttribute(`position`,new F(new Float32Array(Et),3)),e.setIndex(Dt),e.computeVertexNormals(),e.computeBoundingSphere();let i=new Pe({color:A(s.rock),roughness:.92}),o={uMistHi:Pt.uMistHi,uMistLo:Pt.uMistLo,uMistK:Pt.uMistK,uMossC:Pt.uMossC,uTexGrain:nt.grain};if(i.onBeforeCompile=e=>{Object.assign(e.uniforms,o),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\nuniform vec3 uMossC; uniform sampler2D uTexGrain;\n${Zo}\n${Bo}\n${Vo}`).replace(`#include <map_fragment>`,`#include <map_fragment>
{
  vec3 wq = vValeWorld;
  vec2 fq = vec2( wq.x + wq.z, wq.y );
  vec4 tq = texture( uTexGrain, fq / 4.0 );
  float lam = fract( wq.y / 0.55 + valeNoise( wq.xz * 0.5 ) * 0.6 );
  float fwl = fwidth( wq.y / 0.55 );
  float lamL = ( 1.0 - smoothstep( 0.0, 0.1 + fwl, min( lam, 1.0 - lam ) ) ) * ( 1.0 - smoothstep( 0.08, 0.25, fwl ) );
  diffuseColor.rgb *= ( 0.8 + 0.3 * valeNoise( vec2( wq.y * 0.45, wq.x * 0.3 + wq.z * 0.3 ) ) ) * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.7 );
  diffuseColor.rgb *= 1.0 - 0.18 * lamL;
  diffuseColor.rgb *= 1.0 - 0.25 * smoothstep( 0.62, 0.9, valeNoise( vec2( fq.x * 1.3, wq.y * 0.12 ) ) );
  vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float cap = smoothstep( 0.55, 0.9, dot( normalize( vNormal ), upV ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb * 1.5, uMossC * 0.75, 0.45 ), cap );
}`).replace(`#include <opaque_fragment>`,`${Qo(`vValeWorld`)}\n#include <opaque_fragment>\n${$o(`vValeWorld`)}`)},i.customProgramCacheKey=()=>`vale_stack_v1`,G(i),Dt.length){let n=new I(e,i);n.name=`vale_rock_stacks`,n.receiveShadow=!0,n.renderOrder=-3,t.add(n)}b.push(e,i);let c=A(s.mist),l=[{y:-5.5,a:.26,drift:.05,river:0,scale:.16,c:c.clone().multiplyScalar(.62).lerp(A(`#8A7F96`).multiplyScalar(.62),.35)},{y:-10,a:.42,drift:.035,river:0,scale:.11,c:c.clone().multiplyScalar(.38)},{y:-14.5,a:.62,drift:.025,river:1,scale:.08,c:c.clone().multiplyScalar(.22)}],u=new O((Ae-je)*.47,Ae+je+(r-Ae-je)*.4),d=new me(n+40,r+24,1,1);d.rotateX(-Math.PI/2),d.translate(n/2,0,r/2),b.push(d);let f={x0:-20,z0:-12,w:n+40,h:r+24,t:.5,cap:4},p=Math.ceil(f.w/f.t)+1,m=Math.ceil(f.h/f.t)+1,h=new Uint8Array(p*m*4).fill(255),g=St.pos.slice(kt,At);l.forEach((e,t)=>{let n=[];sc(g,null,e.y,n),sc(Et,Dt,e.y,n);let r=new Float32Array(p*m).fill(f.cap);for(let e=0;e<n.length;e+=4){let t=n[e],i=n[e+1],a=n[e+2],o=n[e+3],s=Math.max(0,Math.floor((Math.min(t,a)-f.cap-f.x0)/f.t)),c=Math.min(p-1,Math.ceil((Math.max(t,a)+f.cap-f.x0)/f.t)),l=Math.max(0,Math.floor((Math.min(i,o)-f.cap-f.z0)/f.t)),u=Math.min(m-1,Math.ceil((Math.max(i,o)+f.cap-f.z0)/f.t));for(let e=l;e<=u;e++)for(let n=s;n<=c;n++){let s=ec(f.x0+n*f.t,f.z0+e*f.t,t,i,a,o);s<r[e*p+n]&&(r[e*p+n]=s)}}for(let e=0;e<p*m;e++)h[e*4+t]=Math.round(r[e]/f.cap*255)});let _=Ge(h,p,m),v=new a(f.x0,f.z0,(p-1)*f.t,(m-1)*f.t);l.forEach((e,n)=>{let r=new ke({color:16777215,transparent:!0,depthWrite:!1}),i={uMistSD:{value:_},uMistBox:{value:v},uSheetSel:{value:new B(+(n===0),+(n===1),+(n===2))},uWaterT:mn.valeTime,uSheet:{value:new a(e.a,e.drift,e.river,e.scale)},uSheetC:{value:e.c},uRiverY:{value:u}};r.onBeforeCompile=e=>{Object.assign(e.uniforms,i),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\n${es}\n${Bo}`).replace(`#include <map_fragment>`,ts).replace(`#include <opaque_fragment>`,`#include <opaque_fragment>
gl_FragColor.rgb = diffuseColor.rgb * mix( 0.75, 1.0, valeVision( vValeWorld.xz ) );`)},r.customProgramCacheKey=()=>`vale_mist_sheet_v2`,G(r);let o=new I(d,r);o.position.y=e.y,o.renderOrder=-1-n,o.name=`vale_mist_${n}`,t.add(o),b.push(r)})}let It=Lc(A(s.grassRoot),A(s.grassTip)),Lt=m.length?new xt((e,t,n)=>{for(let r=0;r<m.length;r++)if(!(rc(e,t,v[r])>n)&&($s(e,t,m[r])||tc(e,t,m[r])<=n))return!0;return!1}):null,Rt=new Pe({vertexColors:!0,roughness:.78,metalness:0,side:2,transparent:!0,depthWrite:!0});Rt.forceSinglePass=!0;let zt={value:1},Bt={uWindT:mn.valeTime,uGrassAO:zt,...Lt?Lt.uniforms:{uBrush:{value:[]},uBrushFade:{value:[]},uBrushN:{value:0}}};Rt.onBeforeCompile=e=>{Object.assign(e.uniforms,Bt,tt),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>\n${Ct}\n${Ho}`).replace(`#include <begin_vertex>`,`#include <begin_vertex>\n${wt}`).replace(`#include <color_vertex>`,`#include <color_vertex>\n${Uo}`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
varying float vBrushA;`).replace(`#include <color_fragment>`,`#include <color_fragment>
diffuseColor.a *= vBrushA;`)},Rt.customProgramCacheKey=()=>`vale_grass_v4`,G(Rt);let Vt=rn(Mt.grass,Bt,`vale_grass_depth`),Ht=[];{let e=new De,t=new B,n=new B,r=new B(0,1,0);m.forEach((i,a)=>{let o=v[a],s=.48;for(let a=o.minY+s/2;a<o.maxY;a+=s)for(let c=o.minX+s/2;c<o.maxX;c+=s){let o=c+(d()-.5)*s*.9,l=a+(d()-.5)*s*.9;if(!$s(o,l,i))continue;let u=tc(o,l,i);if(u<.22)continue;e.setFromAxisAngle(r,d()*Math.PI*2);let f=.8+d()*.45,p=(.85+d()*.35)*(u<.6?.8:1);t.set(f,p,f),n.set(o,0,l);let m=.88+.24*Qs(o*.7,l*.7)+(d()-.5)*.08;Ht.push({m:new M().compose(n,e,t),c:new R(m*(1+(d()-.5)*.06),m,m*(.96+(d()-.5)*.06))})}})}let Ut=null,Wt=0,Gt=e=>{if(e===Wt||!Ht.length)return;Wt=e,Ut&&(t.remove(Ut),te(Ut));let n=e>=1?Ht:Ht.filter((t,n)=>n*.618034%1<e);Ut=w(It,Rt,n,`vale_needlegrass`,!0,Vt,2),t.add(Ut)};Gt(1),b.push(It,Rt,Vt);let Kt=bc(le?.tip),qt=new a(0,0,0,1),Jt=new O(0,0);if(Kt){let e=Ce?Ce[0]:Kt[0],t=Ce?Ce[1]:Kt[1]+20,n=Math.hypot(e-Kt[0],t-Kt[1])||1;qt.set(Kt[0],Kt[1],(e-Kt[0])/n,(t-Kt[1])/n),Jt.set(n,Math.min(4,n*.11))}let Yt={uSplat:{value:Ke},uSplat2:{value:qe},uSplatScale:dt.uSplatScale,uTexGrain:nt.grain,uShAx:{value:qt},uShWedge:{value:Jt},uShadowC:{value:A(typeof le?.tint==`string`?le.tint:`#4A4560`).multiplyScalar(1.62)},uShadowLine:{value:A(s.shadowLine)}};for(let e of de){let n=new Ue(uc(e),1);n.rotateX(-Math.PI/2),n.translate(0,.012,0);let r=new Pe({color:16777215,roughness:.8,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1});r.onBeforeCompile=e=>{Object.assign(e.uniforms,Yt),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec3 vShW;`).replace(`#include <project_vertex>`,`#include <project_vertex>
vShW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\n${ns}\n${Bo}\n${Vo}`).replace(`#include <map_fragment>`,rs).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
normal = valeBump( -vViewPosition, normal, sHeight, 1.0 );`).replace(`#include <opaque_fragment>`,`valeFogLocal = 0.9;
#include <opaque_fragment>`)},r.customProgramCacheKey=()=>`vale_shadow_v5`,G(r,{keepColor:!0});let i=new I(n,r);i.receiveShadow=!0,i.name=`vale_standing_shadow`,t.add(i),b.push(n,r)}let Xt=Array.isArray(ue?.mouth)?bc(ue.mouth[0]):void 0,Zt=Array.isArray(ue?.mouth)?bc(ue.mouth[1]):void 0,Qt=new a(0,0,1,0),$t=new B(0,1,0),en=1.1;if(Xt&&Zt&&fe.length){let e=fe[0],t=0,n=0;for(let r of e)t+=r[0],n+=r[1];t/=e.length,n/=e.length;let r=Zt[0]-Xt[0],i=Zt[1]-Xt[1],a=Math.hypot(r,i)||1,o=-i/a,s=r/a;(Xt[0]+r/2-t)*o+(Xt[1]+i/2-n)*s<0&&(o=-o,s=-s),Qt.set(Xt[0],Xt[1],Zt[0],Zt[1]),$t.set(o,s,1)}for(let e of fe){let n=new Ue(uc(e),1);n.rotateX(-Math.PI/2),n.translate(0,.03,0);let r=new Pe({color:A(s.water),roughness:.5,metalness:0,transparent:!0,opacity:.5,depthWrite:!1,envMapIntensity:1.2,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),i=fc(A(s.shaftFloor)),a={uWaterT:mn.valeTime,uSplat2:{value:qe},uSplatScale:dt.uSplatScale,uWaterSheen:{value:new B(.55,.69,.83).multiplyScalar(i)},uWaterLap:{value:.07*i},uMouth:{value:Qt},uMouthN:{value:$t}};r.onBeforeCompile=e=>{Object.assign(e.uniforms,a),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\nuniform float uWaterT; uniform sampler2D uSplat2; uniform vec2 uSplatScale; uniform vec3 uWaterSheen; uniform float uWaterLap;
uniform vec4 uMouth; uniform vec3 uMouthN;
${Bo}
// max env ENV-4 fix: the frame of the shaft's mouth: returns the distance past its lip (< 0 in the shaft, > 0 out on the
// road), u = the distance along it, span = 1 across it (eased at its two ends; 0 on a map without a mouth)
float valeMouth( vec2 p, out float u, out float span ) {
  vec2 d = uMouth.zw - uMouth.xy; float L = max( length( d ), 1e-4 );
  u = dot( p - uMouth.xy, d / L );
  span = smoothstep( -0.15, 0.45, u ) * smoothstep( -0.15, 0.45, L - u ) * uMouthN.z;
  return dot( p - uMouth.xy, uMouthN.xy );
}
// max2 ENV-4: the mouth's span, wide (1 m past both ends, eased): the banks beside the mouth fade with it, so the
// channel's side edges feather into the spill the way its lip does
float valeMouthWide( vec2 p ) {
  vec2 d = uMouth.zw - uMouth.xy; float L = max( length( d ), 1e-4 );
  float u = dot( p - uMouth.xy, d / L );
  return smoothstep( -1.3, 0.2, u ) * smoothstep( -1.3, 0.2, L - u ) * uMouthN.z;
}`).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
  {
    vec2 wp = vValeWorld.xz;
    // max env ENV-4: two ripple sets at different scale, stretch and heading (the shaft's slow cross-draft and a finer
    // counter-chop), strong enough at 28.5 m that the film catches the sky in moving streaks
    vec2 r1 = mat2( 0.8, -0.6, 0.6, 0.8 ) * wp, r2 = mat2( 0.28, 0.96, -0.96, 0.28 ) * wp;
    float h = valeNoise( r1 * vec2( 0.8, 2.0 ) + vec2( uWaterT * 0.26, uWaterT * 0.04 ) )
            + 0.5 * valeNoise( r2 * vec2( 2.2, 3.8 ) - vec2( uWaterT * 0.17, uWaterT * 0.34 ) );
    // max env ENV-4 fix: toward the mouth the ripples give way to the draw: streaks along the flow, quickening at the lip
    float mu, ms; float mt = valeMouth( wp, mu, ms );
    float flow = ms * smoothstep( -2.4, -0.6, mt );
    h = mix( h, 1.2 * valeNoise( vec2( mu * 4.5, mt * 0.9 - uWaterT * ( 1.0 + 1.4 * smoothstep( -2.0, 0.0, mt ) ) ) ), flow * 0.75 );
    normal = valeBump( -vViewPosition, normal, h, 0.15 );
  }`).replace(`#include <opaque_fragment>`,`{
  float sd = texture( uSplat2, vValeWorld.xz * uSplatScale ).g * 8.0 - 4.0;
  // max env ENV-4 fix: no bank at the mouth (it is open water running out): the lap, the wet lip and the bank lace fade
  float mu, ms; float mt = valeMouth( vValeWorld.xz, mu, ms );
  float mband = max( ms * smoothstep( -1.0, -0.15, mt ), valeMouthWide( vValeWorld.xz ) * smoothstep( -3.2, -0.4, mt ) );
  float lap = ( 1.0 - smoothstep( 0.0, 0.35, -sd ) ) * ( 1.0 - mband );
  diffuseColor.a = mix( diffuseColor.a, 0.75, lap );
  outgoingLight = mix( outgoingLight, outgoingLight * 1.25 + vec3( uWaterLap ), lap * ( 0.6 + 0.4 * sin( uWaterT * 0.9 + vValeWorld.x * 2.0 + vValeWorld.z ) ) );
  // closing env m-1: the film's hue drifts green-ochre over the shallow banks to a quiet cool in the middle, at a stone's
  // chroma (the luminance kept), and a 0.15 m bright wet lip runs where it meets the stone
  {
    float dk = smoothstep( 0.0, 2.6, -sd );
    vec3 hd = mix( vec3( 1.06, 1.02, 0.82 ), vec3( 0.94, 0.99, 1.02 ), dk );
    float ol = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 tinted = outgoingLight * hd;
    outgoingLight = mix( vec3( ol ), tinted * ( ol / max( dot( tinted, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 ) ), 0.8 );
    float lipW = ( 1.0 - smoothstep( 0.0, 0.15, -sd ) ) * step( sd, 0.0 ) * ( 1.0 - mband );
    outgoingLight = mix( outgoingLight, vec3( ol * 1.45 + uWaterLap * 1.4 ) * vec3( 1.02, 1.0, 0.94 ), lipW * 0.6 );
    diffuseColor.a = max( diffuseColor.a, lipW * 0.8 );
  }
  // env m2: foam along the banks: a broken pale line lapping 0.12-0.2 m out from the stone and a fainter one ~0.45 m
  // out, breathing in and out with the swell; pale from the film's own light (never a painted white)
  {
    vec2 wp = vValeWorld.xz;
    float fd = -sd + ( valeNoise( wp * 2.3 + vec2( uWaterT * 0.4, -uWaterT * 0.25 ) ) - 0.5 ) * 0.14;
    float swell = 0.5 + 0.5 * sin( uWaterT * 1.1 + wp.x * 0.7 - wp.y * 0.4 );
    float l1 = 1.0 - smoothstep( 0.015, 0.055, abs( fd - ( 0.12 + 0.08 * swell ) ) );
    float l2 = 1.0 - smoothstep( 0.01, 0.04, abs( fd - ( 0.42 + 0.1 * swell ) ) );
    float brk = smoothstep( 0.32, 0.62, valeNoise( wp * 1.6 + vec2( uWaterT * 0.12, uWaterT * 0.07 ) ) );
    float brk2 = smoothstep( 0.45, 0.7, valeNoise( wp * 1.1 + vec2( 9.0 - uWaterT * 0.09, 4.0 ) ) );
    float foam = clamp( l1 * ( 0.35 + 0.65 * brk ) + 0.55 * l2 * brk2, 0.0, 1.0 ) * step( sd, 0.0 ) * ( 1.0 - mband );
    float fl = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
    // the lace is capped at display L* ~46 (linear luminance 0.155 before the grade): pale, never a white line
    outgoingLight = mix( outgoingLight, vec3( min( fl * 1.55 + uWaterLap, 0.155 ) ) * vec3( 1.0, 0.99, 0.95 ), foam * 0.75 );
    diffuseColor.a = max( diffuseColor.a, foam * 0.85 );
  }
  // max env ENV-4: depth reads from the bank SDF: clear amber over the shallow stone, tea-dark teal toward the middle
  // (hue moves, the value eases down ≤ 18 % so the Fallen Shaft stays inside its B5 band)
  {
    float dk = smoothstep( 0.2, 3.2, -sd );
    vec3 tint = mix( vec3( 1.1, 1.0, 0.78 ), vec3( 0.84, 1.0, 0.92 ), dk );
    outgoingLight *= tint * mix( 1.0, 0.82, dk ) / max( dot( tint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 );
  }
  // the sky in the film (roughness stays ≥ 0.5 on walkable ground, so the reflection is ours, not the BRDF's): the map's
  // own PMREM sky, sampled sharp along the rippled normal, comes in streaks where the ripples tilt toward the camera's
  // grazing angle (an exaggerated fresnel: the gameplay camera never sees true grazing); its luminance is capped on the
  // floor's own value band (uWaterSheen), so the pale sky shows as streaks and never as a white sheet
  float nv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float fres = smoothstep( 0.97, 0.6, nv );
#ifdef USE_ENVMAP
  vec3 sky = getIBLRadiance( normalize( vViewPosition ), normal, 0.06 );
  float skyL = max( dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  float cap = dot( uWaterSheen, vec3( 0.2126, 0.7152, 0.0722 ) );
  outgoingLight += sky / skyL * min( skyL * 0.22, cap * 1.2 ) * ( 0.05 + 0.95 * fres );
#else
  outgoingLight += uWaterSheen * fres;
#endif
  // max env ENV-4 fix: the mouth. A churning foam crest rolls just above the lip, thin pale streaks fall over it and run
  // out down the spill, a mist breath swells and fades over the lip, the lip's face is a darker curl of water, and past
  // it the film thins to a wet sheen on the road stone, feathered out over SPILL_M (no hard edge anywhere). Pale values
  // capped as the bank lace is (display L* ~46), never a white line.
  if ( ms > 0.0 ) {
    float ol = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
    // (max2 ENV-4: the crest broken into churning clots along the lip and wandering in height, never a ruled line)
    float crest = ( 1.0 - smoothstep( 0.0, 0.24, abs( mt + 0.3 + 0.05 * sin( uWaterT * 2.1 + mu * 3.0 ) + 0.12 * ( valeNoise( vec2( mu * 1.7, 4.0 ) ) - 0.5 ) ) ) )
                * smoothstep( 0.3, 0.72, valeNoise( vec2( mu * 3.2 + uWaterT * 0.6, uWaterT * 0.9 ) ) );
    // max2 ENV-4: the fall reads at game zoom: denser streaks (a lower threshold), running further down the spill
    // (each streak starts at its own height over the lip and runs out its own length: never a comb of equal bars)
    float colN = valeNoise( vec2( mu * 6.3, 2.7 ) ), colM = valeNoise( vec2( mu * 4.1, 8.3 ) );
    float st = smoothstep( 0.45, 0.76, valeNoise( vec2( mu * 11.0 + 0.5 * sin( mt * 3.0 + mu * 1.3 ), mt * 0.7 - uWaterT * 2.4 ) ) )
             * smoothstep( -0.5 + 0.4 * colN, -0.12 + 0.12 * colN, mt ) * ( 1.0 - smoothstep( 0.15 + 0.4 * colM, 0.7 + 0.45 * colM, mt ) );
    float mist = ( 1.0 - smoothstep( 0.0, 0.7, abs( mt - 0.12 ) ) ) * ( 0.55 + 0.45 * sin( uWaterT * 0.7 + mu * 1.3 ) )
               * valeNoise( vec2( mu * 1.2 - uWaterT * 0.2, mt * 1.5 + uWaterT * 0.3 ) );
    float curl = smoothstep( -0.12, 0.0, mt ) * ( 1.0 - smoothstep( 0.0, 0.22, mt ) );
    outgoingLight *= 1.0 - 0.3 * curl * ms;
    float pale = clamp( crest * 1.15 + st * 0.95, 0.0, 1.0 ) * ms;
    outgoingLight = mix( outgoingLight, vec3( min( ol * 2.4 + uWaterLap * 1.9, 0.2 ) ) * vec3( 1.0, 0.99, 0.95 ), pale * 0.95 );
    outgoingLight += vec3( uWaterLap * 0.8 ) * mist * ms;
    float spill = step( 0.0, mt );
    diffuseColor.a = max( diffuseColor.a, ( pale * 0.7 + mist * 0.25 ) * ( 1.0 - spill ) );
  }
  // the spill strip owns no bank: past the lip its alpha is the spill's alone (0 beyond the mouth's span, so the strip's
  // own edges never show)
  if ( uMouthN.z > 0.5 && mt > 0.0 ) {
    float colM2 = valeNoise( vec2( mu * 4.1, 8.3 ) );
    float pale2 = ms * smoothstep( 0.45, 0.76, valeNoise( vec2( mu * 9.0, mt * 0.7 - uWaterT * 2.4 ) ) ) * ( 1.0 - smoothstep( 0.15 + 0.4 * colM2, 0.7 + 0.45 * colM2, mt ) );
    diffuseColor.a = ms * max( 0.55 * ( 1.0 - smoothstep( 0.05, ${en.toFixed(2)}, mt ) ), pale2 * 0.9 );
  }
}
#include <opaque_fragment>`)},r.customProgramCacheKey=()=>`vale_water_v8`,G(r);let o=new I(n,r);if(o.receiveShadow=!0,o.name=`vale_fallen_shaft`,t.add(o),b.push(n,r),$t.z>0&&e===fe[0]){let e=Qt.x,n=Qt.y,i=Qt.z,a=Qt.w,o=Math.hypot(i-e,a-n)||1,s=(i-e)/o*.3,c=(a-n)/o*.3,l=$t.x*en,u=$t.y*en,d=[e-s,n-c],f=[i+s,a+c],p=new Ee;p.setAttribute(`position`,new F(new Float32Array([d[0],.03,d[1],f[0],.03,f[1],f[0]+l,.03,f[1]+u,d[0],.03,d[1],f[0]+l,.03,f[1]+u,d[0]+l,.03,d[1]+u]),3)),p.setAttribute(`normal`,new F(new Float32Array([0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0]),3)),p.setAttribute(`uv`,new F(new Float32Array(12),2));let m=p.getAttribute(`position`),h=m.getX(1)-m.getX(0),g=m.getZ(1)-m.getZ(0),_=m.getX(2)-m.getX(0),v=m.getZ(2)-m.getZ(0);g*_-h*v<0&&p.setIndex([0,2,1,3,5,4]);let y=new I(p,r);y.receiveShadow=!0,y.name=`vale_fallen_shaft_spill`,t.add(y),b.push(p)}}let tn=new _;tn.name=`vale_scatter`,t.add(tn);let nn=[],an=(e,t,n,r,i=1)=>{let a=1-i,o=i===1?e:t,s=i===1?t:e,c=1/0;for(let e=0,t=n.length-1;e<n.length;t=e++){let l=n[t],u=n[e];if((l[a]-o)*(u[a]-o)>0||l[a]===u[a])continue;let d=(l[i]+(o-l[a])/(u[a]-l[a])*(u[i]-l[i])-s)*r;d>0&&d<c&&(c=d)}return c};p.forEach((e,t)=>{if(g[t]||_t[t]||W[t]<2.2||u===`plate`)return;let i=W[t],a=ic(e)>0,o=(t,o,s,c,l,u)=>{if(!$s(t,o,e))return;let d=tc(t,o,e);if(d<u||t<-3||o<-3||t>n+3||o>r+3)return;let f=1/0,p=1/0;for(let n of[-1.2,0,1.2])(n===0||$s(t+n,o,e))&&(f=Math.min(f,an(t+n,o,e,-1)),p=Math.min(p,an(t+n,o,e,1)));let m=1/0;for(let n=0,r=e.length-1;n<e.length;r=n++){let i=e[r],s=e[n],c=s[0]-i[0],l=s[1]-i[1],u=Math.hypot(c,l);if(u<1e-6)continue;let d=(a?-c:c)/u;d<-.35||(m=Math.min(m,ec(t,o,i[0],i[1],s[0],s[1])+(d>.35?.8:.5)))}let h=[];for(let e of ht){if(Math.abs(t-e.x)>e.sx+4||o<e.y-e.sy-4||o>e.y+e.sy+9)continue;let n=Math.abs(t-e.x)<e.sx+.4&&Math.abs(o-e.y)<e.sy+.4,r=o-(e.y+e.sy);h.push({gap:Math.abs(t-e.x)<e.sx+1.5?r:-99,inFoot:n,hide:Math.min(1,.2*e.h)})}h.some(e=>e.inFoot)||nn.push({x:t,y:o,h:i,s,r:c,tint:l,e:d,dN:f,dS:p,cr:m,mk:h})};for(let t=0,n=e.length-1;t<e.length;n=t++){let r=e[n],i=e[t],a=i[0]-r[0],s=i[1]-r[1],c=Math.hypot(a,s);if(c<.5)continue;let l=ic(e)>0,u=(l?s:-s)/c,f=(l?-a:a)/c;if(f<-.35)continue;let p=f>.35?.85:1,m=Math.max(1,Math.round(c/1.7));for(let e=0;e<m;e++){let t=(e+.25+d()*.5)/m,n=p+(d()-.5)*.35;o(r[0]+a*t-u*n,r[1]+s*t-f*n,.7+d()*.16,d()*Math.PI*2,d(),.45)}}let s=h[t];for(let t=s.minY+1;t<s.maxY;t+=2)for(let n=s.minX+1;n<s.maxX;n+=2){let r=n+(d()-.5)*2*.9,i=t+(d()-.5)*2*.9,a=d(),s=d(),c=d(),l=d(),u=$s(r,i,e)?tc(r,i,e):0;u>6&&a<.45||u>2.4&&Zs(r*.913+5.3,i*1.371-2.1)<.2||o(r,i,u<3?.82+s*.14:u<6?.95+s*.22:1.12+s*.38,c*Math.PI*2,l,1.5)}});let on=[];{let e=Xs(6151),t=new Map;for(let e of nn){let n=`${Math.floor(e.x/3)},${Math.floor(e.y/3)}`;(t.get(n)??t.set(n,[]).get(n)).push(e)}let n=(e,n)=>{let r=1/0,i=Math.floor(e/3),a=Math.floor(n/3);for(let o=-1;o<=1;o++)for(let s=-1;s<=1;s++)for(let c of t.get(`${i+s},${a+o}`)??[])r=Math.min(r,Math.hypot(c.x-e,c.y-n));return r};p.forEach((t,r)=>{if(g[r]||_t[r]||W[r]<2.2||u===`plate`)return;let i=h[r],a=1.35;for(let o=i.minY+a/2;o<i.maxY;o+=a)for(let s=i.minX+a/2;s<i.maxX;s+=a){let i=s+(e()-.5)*a*.9,c=o+(e()-.5)*a*.9,l=e(),u=e(),d=e(),f=e();if(!$s(i,c,t)||tc(i,c,t)<.45||an(i,c,t,-1)<1||ht.some(e=>Math.abs(i-e.x)<e.sx+.6&&Math.abs(c-e.y)<e.sy+.6))continue;let p=n(i,c);p<.55||l>(p>1.6?.92:.36)||on.push({x:i,y:c,h:W[r],s:(p>1.6?1.25:.9)+u*.5,r:d*Math.PI*2,c:f})}})}let sn=(e,t,n)=>{let r=e.s;r=Math.min(r,e.cr/n,(e.dN+.3)/Math.max(.78*t,.51*t+n)),e.dS<3&&(r=Math.min(r,4/t)),r=Math.min(r,9/t);for(let i of e.mk)i.gap>-98&&i.gap>-.5&&(r=Math.min(r,(1.28*i.gap+i.hide)/t,(1.28*i.gap+i.hide)/(.65*t+1.28*n)));return r>=(e.mk.some(e=>e.gap>-98)?.5:.6)?r:0},cn=(e,t)=>N.z>0&&Math.hypot(e-N.x,t-N.y)<N.z+1.2,ln=[];p.forEach((e,t)=>{if(g[t]||_t[t])return;let i=cc(e,2.4,0,[n,r],t),a=ic(e)>0;for(let e=0;e<i.length;e++){if(d()>.45)continue;let t=i[e],o=i[(e+1)%i.length],s=o[0]-t[0],c=o[1]-t[1],l=Math.hypot(s,c)||1,f=(a?c:-c)/l,p=(a?-s:s)/l,m=.35+d()*.6,h=d(),g=t[0]+f*m+s*h,_=t[1]+p*m+c*h;if(g<.5||_<.5||g>n-.5||_>r-.5||u!==`dial`)continue;let v=z(L.ld,g,_)>4.2;for(let e of ae)v&&Math.hypot(g-e.x,_-e.y)<e.r&&(v=!1);v&&(gt(g,_)||xe(g,_,1)||cn(g,_)||z(L.sh,g,_)<.5||z(L.sf,g,_)<.5)&&(v=!1),v&&ln.push({x:g,y:_,s:.35+d()**1.6*.75,r:d()*Math.PI*2})}});let un=[],dn=u===`dial`?Math.round(n*r*.02):0;for(let e=0;e<dn;e++){let e=d()*n,t=d()*r,i=z(L.ld,e,t)>4.8&&z(L.wd,e,t)>.6&&z(L.td,e,t)>.2;for(let n of ae)i&&Math.hypot(e-n.x,t-n.y)<n.r+.8&&(i=!1);i&&(gt(e,t)||xe(e,t,1)||cn(e,t)||z(L.sh,e,t)<.5||z(L.sf,e,t)<.5)&&(i=!1),i&&un.push({x:e,y:t,s:.1+d()**2.2*.32,r:d()*Math.PI*2})}if(c){let e=Xs(4711);for(let t of[-1,1])for(let i=1.5;i<n-1.5;i+=2){let n=e(),a=e(),o=e(),s=e(),c=e(),l=t<0?-(.7+a*1.6):r+.7+a*1.6,u=i+(o-.5)*1.6;n<.5?ln.push({x:u,y:l,s:.8+s**1.4*.85,r:c*Math.PI*2}):n<.9&&un.push({x:u,y:l+t*.6*s,s:.2+s*.22,r:c*Math.PI*2})}if(Ie&&Le>0){let e=Xs(4713);ge.forEach(t=>{let n=ic(t)>0;for(let r=0;r<t.length;r++){let i=t[r],a=t[(r+1)%t.length];if(ie(i[0],i[1])&&ie(a[0],a[1]))continue;let o=a[0]-i[0],s=a[1]-i[1],c=Math.hypot(o,s);if(c<.3)continue;let l=(n?s:-s)/c,u=(n?-o:o)/c;for(let t=.3;t<c;t+=.55){let n=e(),r=e(),a=e(),d=e(),f=i[0]+o/c*t,p=i[1]+s/c*t;if(Math.hypot(f-Ie[0],p-Ie[1])>Le+.5||n>.42)continue;let m=.12+r*.26;un.push({x:f+l*m,y:p+u*m,s:.15+a*a*.24,r:d*Math.PI*2})}}})}}let fn={moss:[],leaf:[],pebble:[],tuft:[]};if(u===`dial`){let e=Xs(9001),t=[s.litter,`#7A5A2E`,`#6E4A2A`,`#5E5530`,`#4E5A2E`,`#806538`,`#62402A`].map(A),i=.55;for(let a=i/2;a<r;a+=i)for(let r=i/2;r<n;r+=i){let n=r+(e()-.5)*i,o=a+(e()-.5)*i,s=z(L.ld,n,o),c=z(L.wd,n,o),l=z(L.td,n,o),u=z(L.cd,n,o);if(c<=.05||l<.35||s<4.3||u<.3){e(),e(),e();continue}if(z(L.sh,n,o)<.5||z(L.sf,n,o)<.7||xe(n,o,.5)||N.z>0&&Math.hypot(n-N.x,o-N.y)<N.z+.8){e(),e(),e();continue}if(ae.some(e=>!e.camp&&Math.hypot(n-e.x,o-e.y)<e.r-1)){e(),e(),e();continue}c<.85&&Zs(n*1.91+.7,o*2.37+9.1)<.17&&on.push({x:n,y:o,h:0,s:.62+.3*Zs(o*3.1,n*1.7),r:Zs(n*7.7,o*5.3)*Math.PI*2,c:Zs(n*2.9,o*4.4)});let d=Qs(n*.05+3.7,o*.05),f=Math.max(0,1-c/1.3),p=+(s<5.800000000000001),m=e(),h=e(),g=e(),_=.85+.3*Qs(n*.4,o*.4);if(m<.45*f+.08*p)fn.tuft.push({x:n,y:o,s:.22+h*.2,r:g*6.283,c:new R(_,_*(.98+h*.06),_*.92)});else if(m<.45*f+.08*p+.07+.12*d)fn.moss.push({x:n,y:o,s:.16+h*.24,r:g*6.283,c:new R(_*(.95+g*.12),_,_*(.85+h*.1))});else if(m<.45*f+.08*p+.07+.12*d+.36){let e=t[Math.floor(h*t.length)%t.length].clone().multiplyScalar(.8+g*.35);fn.leaf.push({x:n,y:o,s:.09+g*.07,r:h*6.283+m*40,c:e})}else m>.985-.08*f&&fn.pebble.push({x:n,y:o,s:.07+h*h*.16,r:g*6.283,c:new R(_*.95,_*.95,_*.92)})}}let pn=new We(.1,.2,1,5,1);pn.translate(0,.5,0);let hn=zc(A(s.leaf)),gn=Bc(11),_n=new Pe({vertexColors:!0,roughness:.85,metalness:0,flatShading:!0}),vn=new Pe({color:A(s.trunk),roughness:.85}),yn=new Pe({color:A(s.stone),roughness:.88,flatShading:!0});for(let e of[_n,vn,yn])G(e);b.push(pn,hn,gn,_n,vn,yn);let bn={moss:js(new R(.05,.065,.028),new R(.15,.18,.065)),leaf:Ms(new R(1,1,1)),pebble:Ns(A(s.pebble)),tuft:Ps(A(s.grassRoot),A(s.grassTip).multiplyScalar(.92)),fern:Is(A(s.leaf).multiplyScalar(.45),A(s.leaf).lerp(A(s.grassTip),.25),A(s.grassTip).lerp(A(s.leaf),.35).multiplyScalar(1.05))},xn=new Pe({vertexColors:!0,roughness:.92,metalness:0,side:2});G(xn),b.push(bn.moss,bn.leaf,bn.pebble,bn.tuft,bn.fern,xn);let Sn=[],wn={},Tn=e=>{for(let t of Object.values(e))for(let e of t??[])e.dispose()},En=i.props??{},Dn=new Set(xc.filter(e=>Array.isArray(En[e])&&En[e].some(e=>typeof e==`string`))),On=2,kn=Ec();G(kn);let An=Ec(!0,tt);G(An);let jn=rn(Mt.tree,{uSwayT:mn.valeTime},`vale_tree_sway_depth`);b.push(kn,An,jn);let Mn=(e,t,n)=>Math.floor(Zs(e*1.7,t*2.3)*n)%n,Nn=i.treeGroves??null,Pn=Array.isArray(Nn?.families)?Nn.families.map(e=>Array.isArray(e)?e.filter(e=>Number.isInteger(e)&&e>=0):[]):[],Fn=e=>Array.isArray(e)&&e.length===Pn.length?e.map(e=>typeof e==`number`&&e>=0?e:0):[],In=Fn(Nn?.west),Ln=Fn(Nn?.east),Rn=yc(Nn?.cell)??9,zn=(e,t,r)=>{if(!Pn.length||!In.length||!Ln.length||Pn.some(e=>!e.length||e.some(e=>e>=r)))return Mn(e,t,r);let i=Math.min(1,Math.max(0,(e/n-1/3)*3)),a=In.map((e,t)=>e+(Ln[t]-e)*i),o=a.reduce((e,t)=>e+t,0)||1,s=e+2.6*Math.sin(t*.21+1.3)+1.4*Math.sin(t*.53-.4),c=t+2.6*Math.sin(e*.19-.7)+1.4*Math.sin(e*.47+2.1),l=Zs(Math.floor(s/Rn)*1.131+7.1,Math.floor(c/Rn)*.877-3.3)*o,u=0;for(;u<a.length-1&&l>=a[u];)l-=a[u],u++;u>0&&Zs(e*2.11+.7,t*1.73-1.9)<.2&&(u=0);let d=Pn[u];return d[Math.floor(Zs(e*1.7,t*2.3)*d.length)%d.length]},Bn=(e,t,n,r=!0,i=!1)=>{let a=e.map(()=>[]),o=i?zn:Mn;for(let n of t)a[o(n.x,n.y,e.length)].push(n);return e.map((e,t)=>w(e,i?An:kn,a[t],`${n}_${t}`,r,i?jn:void 0,-3,{margin:1,lod:i&&r?{geometry:Hn(e),dist:1/0}:void 0})).filter(e=>e.children.length>0)},Vn=new WeakMap,Hn=e=>{let t=Vn.get(e);return t||(t=Us(e,250),Vn.set(e,t),b.push(t)),t},Un=e=>{let t=e.getAttribute(`position`),n=.5,r=.3;for(let e=0;e<t.count;e++)n=Math.max(n,t.getY(e)),r=Math.max(r,Math.hypot(t.getX(e),t.getZ(e)));return{H:n,R:r}},Wn=e=>e===1?void 0:new R(e,e,e),Gn=(e,t)=>{dt.uGeStone.value=e===0?0:1,On=e,t!==void 0&&(zt.value=+!!t),Gt(e===0?Tc:1);for(let e of Sn)tn.remove(e),te(e);Sn=[];let n=e===0?.35:e===1?.7:1,r=e===0?0:e===1?.5:1,i=(e,t)=>e.filter((e,n)=>n*.618034%1<t),a=i(nn,n),o=i(ln,e===0?.5:1),s=i(un,r),c=new De,l=new B,u=new B,d=new B(0,1,0);if(!(wn.tree&&!wn.tree.length||Dn.has(`tree`))){if(a.length&&wn.tree?.length){let e=wn.tree,t=e.map(Un),n=[];for(let r of a){let i=t[zn(r.x,r.y,e.length)],a=sn(r,i.H,i.R);if(a<=0)continue;c.setFromAxisAngle(d,r.r),l.setScalar(a),u.set(r.x,r.h-.12,r.y);let o=Math.min(1,Math.max(0,(r.e-2)/6)),s=1+.12*(Zs(r.x*3.7+11.3,r.y*2.9-4.1)-.5),f=.08*(Zs(r.x*1.3-7.7,r.y*4.1+2.2)-.5),p=(1-.1*o)*s;n.push({x:r.x,y:r.y,m:new M().compose(u,c,l),c:new R((.86+r.tint*.22)*p*(1+f),(.9+r.tint*.14)*p,(.86+r.tint*.12)*(p+.04*o)*(1-f)).multiplyScalar(j.tree)})}Sn.push(...Bn(e,n,`vale_trees`,!0,!0))}else if(a.length){let e=[],t=[];for(let n of a){if(sn(n,2.6,1.3)<=0)continue;let r=1+n.s*.8;c.setFromAxisAngle(d,n.r),l.set(n.s,r,n.s),u.set(n.x,n.h-.1,n.y),e.push({m:new M().compose(u,c,l),c:Wn(j.tree)}),l.set(n.s*1.25,n.s*1.15,n.s*1.25),u.set(n.x,n.h+r*.82,n.y),t.push({m:new M().compose(u,c,l),c:new R(.82+n.tint*.3,.86+n.tint*.24,.84+n.tint*.2).multiplyScalar(j.tree)})}Sn.push(w(pn,vn,e,`vale_trunks`,!0,void 0,-3),w(hn,_n,t,`vale_canopies`,!0,void 0,-3))}}wn.rock&&!wn.rock.length||Dn.has(`rock`)||(o.length&&wn.rock?.length?Sn.push(...Bn(wn.rock,o.map(e=>(c.setFromAxisAngle(d,e.r),l.set(e.s*1.25,e.s*1.1,e.s*1.25),u.set(e.x,(e.h??0)-.04,e.y),{x:e.x,y:e.y,m:new M().compose(u,c,l),c:Wn(j.rock)})),`vale_boulders`)):o.length&&Sn.push(w(gn,yn,o.map(e=>(c.setFromAxisAngle(d,e.r),l.set(e.s*1.2,e.s*.8,e.s),u.set(e.x,e.s*.15,e.y),{m:new M().compose(u,c,l),c:Wn(j.rock)})),`vale_boulders`,!0,void 0,-3)));let f=wn.stone??wn.rock;f&&!f.length||Dn.has(`stone`)||!En.stone&&Dn.has(`rock`)||(s.length&&f?.length?Sn.push(...Bn(f,s.map(e=>(c.setFromAxisAngle(d,e.r),l.set(e.s*1.1,e.s*.9,e.s),u.set(e.x,(e.h??0)-.02,e.y),{x:e.x,y:e.y,m:new M().compose(u,c,l),c:Wn(j.stone)})),`vale_stones`,!1)):s.length&&Sn.push(w(gn,yn,s.map(e=>(c.setFromAxisAngle(d,e.r),l.set(e.s,e.s*.6,e.s*.85),u.set(e.x,e.s*.1,e.y),{m:new M().compose(u,c,l),c:Wn(j.stone)})),`vale_stones`,!1,void 0,-3)));let p=e===0?0:e===1?.5:1,m=(e,t,n,r,a)=>{let o=i(e,p).map(e=>(c.setFromAxisAngle(d,e.r),l.set(e.s,e.s*r,e.s),u.set(e.x,a,e.y),{m:new M().compose(u,c,l),c:j.clutter===1?e.c:e.c.clone().multiplyScalar(j.clutter)}));o.length&&Sn.push(w(t,xn,o,n,!1))};m(fn.moss,bn.moss,`vale_clutter_moss`,1,-.01),m(fn.leaf,bn.leaf,`vale_clutter_leaf`,1,.004),m(fn.pebble,bn.pebble,`vale_clutter_pebble`,1,0),m(fn.tuft,bn.tuft,`vale_clutter_tuft`,1.1,0);{let e=i(on,p).map(e=>{c.setFromAxisAngle(d,e.r),l.set(e.s,e.s*(.85+.3*e.c),e.s),u.set(e.x,e.h-.02,e.y);let t=(1.05+.3*e.c)*j.tree;return{m:new M().compose(u,c,l),c:new R(t*(1.02+.06*e.c),t,t*(.94-.04*e.c))}});e.length&&Sn.push(w(bn.fern,xn,e,`vale_understory_fern`,!1))}for(let e of Sn)tn.add(e)};if(Gn(2),c){let e=new se,n=new B(0,-1,0),r=new B;t.addEventListener(`childadded`,t=>{let i=t.child,a=p.findIndex((e,t)=>_t[t]&&$s(i.position.x,i.position.z,p[t]));if(a<0||i.name===`vale_scatter`)return;i.updateMatrixWorld(!0);let o=h[a],s=Xs(5150+a*31),c=[];for(let t=o.minY+.3;t<o.maxY-.2;t+=.32)for(let a=o.minX+.3;a<o.maxX-.2;a+=.32){e.set(new B(a,12,t),n);let o=e.intersectObject(i,!0)[0];!o?.face||o.point.y<.9||(r.copy(o.face.normal).transformDirection(o.object.matrixWorld),r.y>.8&&c.push({x:a,y:t,h:o.point.y}))}let l=[];for(let e=0;e<40&&l.length<5&&c.length;e++){let e=c[Math.floor(s()*c.length)],t=s(),n=s();l.some(t=>Math.hypot(t.x-e.x,t.y-e.y)<.6)||(l.push(e),l.length<=2?ln.push({x:e.x,y:e.y,h:e.h,s:.55+t*.4,r:n*Math.PI*2}):un.push({x:e.x,y:e.y,h:e.h,s:.2+t*.16,r:n*Math.PI*2}))}l.length&&Gn(On)})}let Kn=null,qn=()=>{let e=Math.ceil((n+8)/Gs),t=Math.ceil((r+8)/Gs),i=new Uint8Array(e*t),a=.8,o=(n,r,o,s,c)=>{let l=Math.max(0,Math.floor((n-a- -4)/Gs)),u=Math.min(e-1,Math.floor((o+a- -4)/Gs)),d=Math.max(0,Math.floor((r-a- -4)/Gs)),f=Math.min(t-1,Math.floor((s+a- -4)/Gs));for(let t=d;t<=f;t++)for(let n=l;n<=u;n++)i[t*e+n]||c(-4+(n+.5)*Gs,-4+(t+.5)*Gs)&&(i[t*e+n]=1)};p.forEach((e,t)=>{if(g[t]||_t[t]||!(W[t]>qs))return;let n=h[t];o(n.minX,n.minY,n.maxX,n.maxY,(t,n)=>$s(t,n,e)||tc(t,n,e)<=a)});for(let e of ht)e.h>qs&&o(e.x-e.sx,e.y-e.sy,e.x+e.sx,e.y+e.sy,(t,n)=>Math.abs(t-e.x)<=e.sx+a&&Math.abs(n-e.y)<=e.sy+a);if(bt>qs)for(let a=0;a<t;a++)for(let t=0;t<e;t++){let o=-4+(t+.5)*Gs,s=-4+(a+.5)*Gs;(c?o<0||o>n:o<0||o>n||s<0||s>r)&&(i[a*e+t]=1)}return{x0:-4,y0:-4,w:e,h:t,cells:i}};return{group:t,wallHeights:W,setScatter:Gn,brush:Lt,setTextures(e){for(let t of Sc){let n=e[t];n&&(nt[t].value=n)}},setProps(e){e!==wn&&Tn(wn),wn=e;for(let t of e.tree??[])Rc(t);Dn.clear(),Gn(On)},groundAt(e,t){for(let n=0;n<p.length;n++){if(g[n]||_t[n])continue;let r=h[n];if(!(e<r.minX||e>r.maxX||t<r.minY||t>r.maxY)&&$s(e,t,p[n]))return W[n]}for(let n of Ot)if($s(e,t,n))return Ne;return(c?e<0||e>n:e<0||e>n||t<0||t>r)?bt:0},coverToward(e,t,n,r,i,a=Ks){let o=Kn??=qn(),s=n-e,c=r-t,l=Math.hypot(s,c);if(l<.5||!(i>0))return!1;let u=s/l,d=c/l,f=Math.min(a,l);for(let n=0;n<=f;n+=Gs*.5){let r=Math.floor((e+u*n-o.x0)/Gs),i=Math.floor((t+d*n-o.y0)/Gs);if(!(r<0||i<0||r>=o.w||i>=o.h)&&o.cells[i*o.w+r])return!0}return!1},cull(e){let t=e?e.version:-1;if(t!==S||C){S=t,C=!1;for(let t of x)t.cull(e);ee(e)}},update(e){mn.valeTime.value=e},dispose(){for(let e of x)e.dispose();x.clear(),t.traverse(e=>{e.isInstancedMesh&&e.dispose();let t=e.userData.valeOwnMaterials;if(t){for(let e of t)e.dispose();t.length=0}}),Tn(wn),wn={};for(let e of b)e.dispose()}}}function Lc(e,t){let n=[],r=[],i=[],a=Xs(77);for(let o=0;o<7;o++){let s=o/7*Math.PI*2+a()*.6,c=o===0?0:.05+a()*.12,l=Math.cos(s)*c,u=Math.sin(s)*c,d=.18+a()*.3,f=.85+a()*.45,p=.06+a()*.03,m=Math.cos(s+.3),h=Math.sin(s+.3),g=-h,_=m,v=o===0?.82:.9+c/.17*.1+(a()-.5)*.08,y=e.clone().multiplyScalar(.6*v),b=e.clone().lerp(t,.58).multiplyScalar(v),x=t.clone().multiplyScalar(.64*(.94+.06*v));x.r*=1.05,x.b*=.86;let S=[];for(let e=0;e<=2;e++){let t=e/2,n=l+m*d*t*t*f,r=u+h*d*t*t*f,i=f*t,a=p*(1-t*.92);S.push([[n-g*a,i,r-_*a],[n+m*a*.35,i,r+h*a*.35],[n+g*a,i,r+_*a]])}for(let e=0;e<2;e++){let t=e/2,a=(e+1)/2;for(let o=0;o<2;o++){let s=S[e][o],c=S[e][o+1],l=S[e+1][o],u=S[e+1][o+1],d=[s,c,u,s,u,l],f=[t,t,a,t,a,a];for(let e=0;e<6;e++){n.push(...d[e]);let t=f[e]<=.5?y.clone().lerp(b,f[e]*2):b.clone().lerp(x,(f[e]-.5)*2);r.push(t.r,t.g,t.b),i.push(m*.35*(o?1:-1)+g*.2,.9,h*.35+_*.2)}}}}let o=new Ee;o.setAttribute(`position`,new F(new Float32Array(n),3)),o.setAttribute(`color`,new F(new Float32Array(r),3));let s=new Float32Array(i);for(let e=0;e<s.length;e+=3){let t=Math.hypot(s[e],s[e+1],s[e+2]);s[e]/=t,s[e+1]/=t,s[e+2]/=t}return o.setAttribute(`normal`,new F(s,3)),o}function Rc(e){if(e.userData.valeCrownLit)return;e.userData.valeCrownLit=!0;let t=e.getAttribute(`position`),n=e.getAttribute(`color`);if(!n)return;e.getAttribute(`normal`)||e.computeVertexNormals();let r=e.getAttribute(`normal`),i=.5;for(let e=0;e<t.count;e++)i=Math.max(i,t.getY(e));let a=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)};for(let e=0;e<t.count;e++){let o=t.getY(e)/i,s=r.getY(e),c=Math.max(0,s)*a(.55,1,o),l=(.84+.16*a(.15,.6,o))*(1+.26*c)*(1-.14*Math.max(0,-s));n.setXYZ(e,n.getX(e)*l*(1+.05*c),n.getY(e)*l,n.getZ(e)*l*(1-.08*c))}n.needsUpdate=!0}function zc(e){let t=[];for(let[e,n,r,i]of[[0,.35,0,1],[.55,.05,.25,.72],[-.45,.1,-.35,.78],[.05,.75,-.1,.62]]){let a=new Ge(i,1),o=a.getAttribute(`position`);for(let t=0;t<o.count;t++){let n=1+(Zs(o.getX(t)*3.1+e,o.getZ(t)*2.7+o.getY(t))-.5)*.28;o.setXYZ(t,o.getX(t)*n,o.getY(t)*n*.82,o.getZ(t)*n)}a.translate(e,n,r);let s=a.index?a.toNonIndexed():a;s!==a&&a.dispose(),s.deleteAttribute(`uv`),t.push(s)}let n=ce(t,!1);for(let e of t)e.dispose();let r=n.getAttribute(`position`),i=new Float32Array(r.count*3),a=new R;for(let t=0;t<r.count;t++){let n=Math.min(1,Math.max(0,(r.getY(t)+.6)/2));a.copy(e).multiplyScalar(.55+.75*n),a.r+=.02*n,i[t*3]=a.r,i[t*3+1]=a.g,i[t*3+2]=a.b}return n.setAttribute(`color`,new F(i,3)),n.computeVertexNormals(),n}function Bc(e){let t=new Ge(1,1),n=t.getAttribute(`position`);for(let t=0;t<n.count;t++){let r=n.getX(t),i=n.getY(t),a=n.getZ(t),o=.78+Zs(r*5.1+e,a*4.3+i*3.7)*.4;n.setXYZ(t,r*o,Math.max(-.3,i*o),a*o)}let r=t.index?t.toNonIndexed():t;return r!==t&&t.dispose(),r.deleteAttribute(`uv`),r.computeVertexNormals(),r}var Vc={dir:[-.8937,.309,.3253],color:`#FFC27E`,intensity:2.4,env:.8},Hc=720,Uc=.5;function Wc(e,t,n,r){let i=3*e,a=3*(n-e)-i,o=1-i-a,s=3*t,c=3*(r-t)-s,l=1-s-c,u=e=>((o*e+a)*e+i)*e,d=e=>((l*e+c)*e+s)*e;return e=>{let t=e;for(let n=0;n<8;n++){let n=u(t)-e,r=(3*o*t+2*a)*t+i;if(Math.abs(n)<1e-5||Math.abs(r)<1e-6)break;t-=n/r}return d(Math.max(0,Math.min(1,t)))}}var Gc=Wc(.16,1,.3,1),Kc=class{scene=new L;camera=new Te(32,16/9,.5,3e3);sun=new Ro;sky;terrain=null;model=null;stations=new Map;from={pos:new B,target:new B};to={pos:new B,target:new B};target=new B;moveT=1;elapsed=0;station=`home`;reduceMotion=!1;idle=0;showcase=null;showcaseKey=``;showcaseH=0;showcaseAt=``;showcaseModel=null;showcaseRoot=new _;map=null;backdrop=null;bdUniforms={uTex:{value:null},uScreen:{value:new O(16,9)},uImg:{value:new O(16,9)},uTime:{value:0},uPan:{value:new O(0,0)}};panTo=new O;plinth=null;lut=null;built=!1;constructor(e){this.sky=new zo(e),this.scene.add(this.sun.light,this.sun.target,this.showcaseRoot),this.scene.name=`vale_menu`;let t=!1;try{t=!1}catch{t=!1}t&&(globalThis.__valeMenuSubject=e=>this.subjectRect(innerWidth,innerHeight,e))}build(e,t){if(this.built)return;this.built=!0;let n=e.client.menuScene;this.lut=n.lut,this.sun.configure({sunDir:Vc.dir,sunColor:Vc.color,sunIntensity:Vc.intensity});let r=new R().setStyle(Vc.color);this.sky.makeFallback(Vc.dir,r,new R(.18,.26,.42),new R(.75,.62,.5)),this.sky.apply(this.scene,null,Vc.env),t.hdr(n.sky).then(e=>{e&&this.sky.apply(this.scene,e,Vc.env)});let i=e.maps.find(e=>e.lanes.length>=3)??e.maps.find(e=>e.lanes.length>0)??e.maps[0];if(this.map=i??null,n.backdrop)this.buildPaintedSet(),t.texture(n.backdrop).then(e=>{if(!e)return;this.bdUniforms.uTex.value=e;let t=e.image;t?.width&&t.height&&this.bdUniforms.uImg.value.set(t.width,t.height),this.backdrop&&(this.backdrop.visible=!0)});else if(i){this.terrain=Ic(i);let e=(i.art.terrain??{}).textures??{},n=Sc.filter(t=>typeof e[t]==`string`),r=this.terrain;Promise.all(n.map(n=>t.texture(e[n]).then(e=>[n,e]))).then(e=>{if(this.terrain!==r)return;let t={};for(let[n,r]of e)r&&(t[n]=r);r.setTextures(t)}),Cc(i,e=>t.model(e)).catch(()=>null).then(e=>{if(this.terrain!==r){for(let t of Object.values(e??{}).flat())t?.dispose();return}r.setProps(e??{})}),Mc(i,e=>t.model(e),r.groundAt).then(e=>{if(this.terrain===r)for(let t of e)r.group.add(t)}),this.scene.add(this.terrain.group),this.generateStations(i)}t.model(n.model).then(e=>{if(!e?.renderable)return;let t=e.gltf.scene;t.traverse(e=>{let t=e;if(t.isMesh){t.castShadow=!0,t.receiveShadow=!0;for(let e of Array.isArray(t.material)?t.material:[t.material])G(e,{fog:!1})}});let n=new Map;if(t.updateMatrixWorld(!0),t.traverse(e=>{let t=e.name,r=/^(cam|tgt)_(.+)$/.exec(t);if(!r)return;let i=n.get(r[2])??{},a=new B().setFromMatrixPosition(e.matrixWorld);r[1]===`cam`?i.pos=a:i.target=a,n.set(r[2],i)}),this.terrain&&=(this.scene.remove(this.terrain.group),this.terrain.dispose(),null),this.backdrop&&=(this.scene.remove(this.backdrop),null),this.model=t,this.scene.add(t),n.size){this.stations.clear();for(let[e,t]of n)t.pos&&t.target&&this.stations.set(e,{pos:t.pos,target:t.target})}this.setStation(this.station,!0)}),this.setStation(this.station,!0)}buildPaintedSet(){let e=new ee({uniforms:this.bdUniforms,depthWrite:!1,depthTest:!1,toneMapped:!1,vertexShader:`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.99999, 1.0 ); }`,fragmentShader:`uniform sampler2D uTex; uniform vec2 uScreen, uImg, uPan; uniform float uTime; varying vec2 vUv;
        void main() {
          // cover fit with 6 % headroom for the drift and the per-screen pan
          float sa = uScreen.x / uScreen.y, ia = uImg.x / uImg.y;
          vec2 sc = sa > ia ? vec2( 1.0, ia / sa ) : vec2( sa / ia, 1.0 );
          sc *= 0.94 - 0.012 * sin( uTime * 0.05 );
          vec2 drift = vec2( sin( uTime * 0.031 ), cos( uTime * 0.023 ) ) * 0.008;
          vec2 uv = ( vUv - 0.5 ) * sc + 0.5 + uPan + drift;
          gl_FragColor = vec4( texture2D( uTex, uv ).rgb, 1.0 );
          #include <colorspace_fragment>
        }`}),t=new I(new me(2,2),e);t.frustumCulled=!1,t.renderOrder=-100,t.visible=!1,this.backdrop=t,this.scene.add(t);let n=new Pe({color:new R().setStyle(`#6B6459`),roughness:.9,metalness:0}),r=new I(new We(.82,.92,.2,48),n);r.position.y=-.11,r.receiveShadow=!0,r.visible=!1,this.plinth=r,this.scene.add(r);let i=(e,t)=>({pos:new B(...e),target:new B(...t)});for(let e of[`home`,`play`,`queue`,`lobby`,`draft`,`loading`,`postgame`,`profile`,`settings`,`practice`,`custom`])this.stations.set(e,i([-2.2,2,7.8],[-2.2,1.2,0]));for(let e of[`collection`,`shop`,`loadout`])this.stations.set(e,i([-1.2,2.1,9],[-1.2,1.15,0]))}generateStations(e){let[t,n]=e.size,r=t/2,i=n/2,a=[`home`,`play`,`queue`,`lobby`,`draft`,`loadout`,`loading`,`postgame`,`collection`,`shop`,`profile`,`settings`,`practice`,`custom`];a.forEach((e,o)=>{let s=-Math.PI*.62+o/a.length*Math.PI*.9,c=Math.max(t,n)*.5+6,l=new B(r+Math.cos(s)*c*.62,7+o%3*1.2,i+Math.sin(s)*c*.62+n*.42),u=new B(r+Math.cos(s)*c*.05,1.5,i-n*.05);this.stations.set(e,{pos:l,target:u})})}stationOf(e){return(this.stations.get(e)??this.stations.get(`home`)??this.stations.values().next().value??null)||(this.map?{pos:new B(this.map.size[0]/2,12,this.map.size[1]+10),target:new B(this.map.size[0]/2,0,this.map.size[1]/2)}:null)}setStation(e,t=!1){this.station=e,this.idle=0;let n=0;for(let t=0;t<e.length;t++)n=n*31+e.charCodeAt(t)>>>0;this.panTo.set((n%97/97-.5)*.04,((n>>7)%89/89-.5)*.02),t&&this.bdUniforms.uPan.value.copy(this.panTo);let r=this.stationOf(e);r&&(this.from.pos.copy(this.camera.position),this.from.target.copy(this.target),this.to.pos.copy(r.pos),this.to.target.copy(r.target),t||this.reduceMotion||this.camera.position.lengthSq()===0?(this.camera.position.copy(r.pos),this.target.copy(r.target),this.moveT=1,this.camera.lookAt(this.target)):this.moveT=0)}setShowcase(e,t,n){let r=`${t??``}:${n??``}`;if(r===this.showcaseKey||(this.showcaseKey=r,this.showcase&&=(this.showcase.dispose(),null),this.showcaseH=0,this.showcaseModel=null,!e||!t))return;let i=e.fighter(t);if(!i)return;let a=new Ba({id:-1,kind:`fighter`,def:t,team:0,owner:-1,x:0,y:0,facing:Math.PI/2,radius:.5,height:0});a.configureFighter(i),this.showcase=a,this.showcaseRoot.add(a.root),e.fighterTemplate(t,n??void 0).then(e=>{this.showcase===a&&a.attach(e,i.art.scale,i.art.accentMaterial)})}subjectRect(e,t,n){if(!this.showcase)return null;let r=1/0,i=1/0,a=-1/0,o=-1/0,s=0,c=new B;return this.showcase.root.updateMatrixWorld(!0),this.showcase.root.traverseVisible(l=>{let u=l;if(!u.isMesh)return;let d=u.geometry.getAttribute(`position`);if(d)for(let l=0;l<d.count;l++){u.getVertexPosition(l,c),c.applyMatrix4(u.matrixWorld).project(this.camera);let d=(c.x*.5+.5)*e,f=(1-(c.y*.5+.5))*t;d<r&&(r=d),d>a&&(a=d),f<i&&(i=f),f>o&&(o=f),n&&d>=n.x&&d<=n.x+n.w&&f>=n.y&&f<=n.y+n.h&&s++}}),Number.isFinite(r)?{x:Math.round(r),y:Math.round(i),w:Math.round(a-r),h:Math.round(o-i),hits:s,h0:(o-i)/t,fitH:Math.round(this.showcaseH*100)/100,scale:Math.round(this.showcase.root.scale.x*1e3)/1e3}:null}setAspect(e){this.camera.aspect=e,this.camera.updateProjectionMatrix(),this.bdUniforms.uScreen.value.set(e*1e3,1e3)}update(e){if(this.elapsed+=e,this.idle+=e,this.moveT<1){this.moveT=Math.min(1,this.moveT+e*1e3/Hc);let t=Gc(this.moveT);this.camera.position.lerpVectors(this.from.pos,this.to.pos,t),this.target.lerpVectors(this.from.target,this.to.target,t),this.idle=0}this.camera.lookAt(this.target),this.camera.updateMatrixWorld();let t=this.elapsed/60*(Math.PI/180),[n,r,i]=Vc.dir,a=Math.cos(t),o=Math.sin(t);if(this.sun.configure({sunDir:[n*a-i*o,r,n*o+i*a],sunColor:Vc.color,sunIntensity:Vc.intensity}),this.sun.fit(this.camera),this.terrain?.update(this.elapsed),this.terrain?.cull(null),this.bdUniforms.uTime.value=this.elapsed,this.bdUniforms.uPan.value.lerp(this.panTo,1-Math.exp(-e*3)),this.plinth&&(this.plinth.visible=!!this.showcase&&!this.model),this.showcase&&this.backdrop&&!this.model){let t=this.target,n=t.x+1.9,r=t.z+1.8;this.plinth.position.set(n,-.11,r),this.showcase.root.position.set(n,0,r);let i=new B(this.camera.position.x-n,0,this.camera.position.z-r).normalize();this.showcase.root.rotation.y=Math.atan2(i.x,i.z)-.35,this.showcase.pose(`idle_lobby`,e),this.showcase.model&&this.moveT>=1&&(this.showcase.model!==this.showcaseModel||!this.showcaseH||this.showcaseAt!==this.station)&&(this.showcase.root.scale.setScalar(1),this.showcaseH=this.subjectRect(1,1)?.h0??0,this.showcaseModel=this.showcase.model,this.showcaseAt=this.station),this.showcase.root.scale.setScalar(this.showcaseH>0?Math.min(1,Uc/this.showcaseH):1)}else if(this.showcase){let t=this.target,n=new B().subVectors(this.camera.position,t).setY(0).normalize();this.showcase.root.position.set(t.x+n.x*2,0,t.z+n.z*2),this.showcase.root.rotation.y=Math.atan2(n.x,n.z),this.showcase.pose(`idle_lobby`,e)}}setScatter(e){this.terrain?.setScatter(e)}dispose(){this.showcase?.dispose(),this.terrain?.dispose(),this.terrain=null,this.sky.dispose()}},qc={position:`vec3`,normal:`vec3`,uv:`vec2`,instanceMatrix:`mat4`},Jc=`
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
`,Yc=/\b(attribute|varying|uniform)\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g,Xc={float:1,vec2:2,vec3:3,vec4:4},Zc=[`x`,`y`,`z`,`w`];function Qc(e,t){let n=e;for(let e of t)n=n.split(e).join(`
`);let r=n.indexOf(`void main()`);if(r<0)throw Error(`uber: no main()`);let i=n.indexOf(`{`,r),a=n.lastIndexOf(`}`),o=n.slice(i+1,a),s=[];return{decls:s,helpers:n.slice(0,r).replace(Yc,(e,t,n,r)=>{for(let e of r.split(`,`)){let r=e.trim();r&&s.push({kind:t,type:n,name:r})}return``}),body:o}}function $c(e){let t=e.replace(/\/\*[\s\S]*?\*\//g,``).replace(/\/\/[^\n]*/g,``),n=[],r=``,i=0;for(let e of t.split(`
`)){if(i===0&&e.trim().startsWith(`#`)){r.trim()&&n.push(r.trim()),r=``,n.push(e.trim());continue}for(let t of e+`
`)r+=t,t===`{`?i++:t===`}`?(i--,i===0&&(n.push(r.trim()),r=``)):t===`;`&&i===0&&(n.push(r.trim()),r=``)}return r.trim()&&n.push(r.trim()),n.filter(e=>e.length>0)}var el=e=>/^(?:const\s+)?\w+\s+(\w+)/.exec(e)?.[1]??e;function tl(e,t){let n=e=>e.replace(/\s+/g,` `);for(let r of $c(t)){let t=el(r),i=e.get(t);if(i===void 0)e.set(t,r);else if(n(i)!==n(r))throw Error(`uber: ${t} is defined twice differently`)}}function nl(e){let t=[],n=new Map;for(let r of e){let e=Xc[r.type];if(!e)throw Error(`uber: varying type ${r.type}`);let i=t.findIndex(t=>4-t>=e);i<0&&(i=t.length,t.push(0)),n.set(r.name,[i,t[i]]),t[i]+=e}return n}var rl=(e,t)=>Zc.slice(e,e+t).join(``);function il(e,t=[]){let n=new Map,r=(e,t)=>{let r=n.get(t);if(r&&r!==e)throw Error(`uber: uniform ${t} is ${r} and ${e}`);n.set(t,e)},i=new Map,a=new Map,o=[],s=[],c=new Set,l=0,u=0;e.forEach((e,n)=>{let d=Qc(e.vert,t),f=Qc(e.frag,t),p=d.decls.filter(e=>e.kind===`varying`),m=nl(p);u=Math.max(u,...[...m.values()].map(([e])=>e+1),0);for(let e of[...d.decls,...f.decls])e.kind===`uniform`&&r(e.type,e.name);tl(i,d.helpers),tl(a,f.helpers);let h=[];for(let t of d.decls){if(t.kind!==`attribute`)continue;if(qc[t.name]){c.add(t.name);continue}let n=e.attrs.indexOf(t.name);if(n<0)throw Error(`uber: attribute ${t.name} has no slot`);l=Math.max(l,n+1);let r=Xc[t.type];h.push(`  ${t.type} ${t.name} = ua${n}${r===4?``:`.`+rl(0,r)};`)}for(let e of p)h.push(`  ${e.type} ${e.name} = ${e.type}( 0.0 );`);let g=p.map(e=>{let[t,n]=m.get(e.name);return`  ux${t}.${rl(n,Xc[e.type])} = ${e.name};`});o.push(`void uber${n}() {\n${h.join(`
`)}\n${d.body}\n${g.join(`
`)}\n}`);let _=[];for(let e of f.decls){if(e.kind!==`varying`)continue;let t=m.get(e.name);if(!t)throw Error(`uber: fragment varying ${e.name} not written by the vertex`);_.push(`  ${e.type} ${e.name} = ux${t[0]}.${rl(t[1],Xc[e.type])};`)}s.push(`void uber${n}() {\n${_.join(`
`)}\n${f.body}\n}`)});for(let n of e)for(let e of Object.keys(qc))RegExp(`\\b${e}\\b`).test(Qc(n.vert,t).body)&&c.add(e);let d=t.map(e=>(e.match(/uniform\s+[^;]+;/g)??[]).join(`
`)).join(`
`),f=[...n].filter(([e])=>!RegExp(`uniform\\s+\\w+\\s+${e}\\s*;`).test(d)).map(([e,t])=>`uniform ${t} ${e};`).join(`
`),p=`precision highp float;
precision highp int;
precision highp sampler2D;
#define texture2D texture
`,m=e.map((e,t)=>`${t?`else `:``}if ( uUberKind == ${t} ) uber${t}();`).join(`
  `),h=e=>Array.from({length:u},(t,n)=>`${e} vec4 ux${n};`).join(`
`);return{vert:`${p}${Jc}uniform int uUberKind;
${[...c].map(e=>`in ${qc[e]} ${e};`).join(`
`)}
${Array.from({length:l},(e,t)=>`in vec4 ua${t};`).join(`
`)}
${h(`out`)}
${d}
${f}
${[...i.values()].join(`
`)}
${o.join(`
`)}
void main() {
  gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
  ${m}
}
`,frag:`${p}${Jc}uniform int uUberKind;
${h(`in`)}
layout( location = 0 ) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
${t.join(`
`)}
${f}
${[...a.values()].join(`
`)}
${s.join(`
`)}
void main() {
  pc_fragColor = vec4( 0.0 );
  ${m}
}
`,slots:l}}function al(e,t,n){t.attrs.forEach((t,r)=>{let i=n[t];if(!i)throw Error(`uber: no attribute ${t}`);e.setAttribute(`ua${r}`,i)})}var ol={self:0,ally:1,enemy:2,neutral:3,range:4},sl=256,cl=`
attribute vec4 aRing;     // x, z, radius, facing (radians, sim convention)
attribute vec4 aStyle;    // code, alpha, emphasis, y
attribute vec3 aColor;
varying vec2 vLocal; varying float vR; varying vec4 vStyle; varying vec3 vColor; varying float vFacing;
void main() {
  float ext = aRing.z + 0.6;
  vec3 wp = vec3( aRing.x + position.x * ext * 2.0, aStyle.w, aRing.y - position.y * ext * 2.0 );
  vLocal = vec2( wp.x - aRing.x, wp.z - aRing.y );
  vR = aRing.z; vStyle = aStyle; vColor = aColor; vFacing = aRing.w;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`,ll=`
${vt}
varying vec2 vLocal; varying float vR; varying vec4 vStyle; varying vec3 vColor; varying float vFacing;
void main() {
  float code = vStyle.x;
  float d = length( vLocal );
  float px = max( fwidth( d ), 1e-4 );           // metres per pixel here
  float hw = ( 1.25 + vStyle.z * 0.5 ) * px;  // 2.5 px band (3.5 when emphasised)
  float band = d - vR;
  float ring = 1.0 - smoothstep( hw - 0.6 * px, hw + 0.6 * px, abs( band ) );
  float ang = atan( vLocal.x, -vLocal.y );       // 0 at screen-up (−Z), clockwise
  float a01 = ang / 6.2831853 + 0.5;
  float mask = 1.0;
  if ( code > 0.5 && code < 1.5 ) {              // ally: 12 dashes
    float s = fract( a01 * 12.0 );
    mask = smoothstep( 0.0, 0.04, s ) * ( 1.0 - smoothstep( 0.62, 0.66, s ) );
  } else if ( code > 3.5 ) {                     // range: 36 short dashes
    float s = fract( a01 * 36.0 );
    mask = smoothstep( 0.0, 0.06, s ) * ( 1.0 - smoothstep( 0.5, 0.56, s ) );
  }
  float fill = ring * mask;
  // enemy: 4 inward notches (cardinal points), a 0.18 m wedge cut into the inner side
  if ( code > 1.5 && code < 2.5 ) {
    float t4 = fract( a01 * 4.0 );
    float q = min( t4, 1.0 - t4 ) * 6.2831853 / 4.0 * d;                       // arc distance to the nearest cardinal
    float depth = 0.2 - q * 1.4;                                                 // wedge profile
    float notch = ( 1.0 - smoothstep( -0.5 * px, 0.5 * px, -band - depth ) ) * step( band, 0.0 ) * step( 0.0, depth );
    fill = max( fill, notch );
  }
  // self: gnomon wedge at the facing (outside the ring)
  if ( code < 0.5 ) {
    vec2 f = vec2( cos( vFacing ), sin( vFacing ) );
    vec2 sd = vec2( -f.y, f.x );
    float along = dot( vLocal, f ) - vR;
    float across = abs( dot( vLocal, sd ) );
    float len = 0.42, wid = 0.2;
    float inW = step( -hw, along ) * ( 1.0 - smoothstep( len - px, len + px, along ) );
    float edge = across - wid * ( 1.0 - clamp( along / len, 0.0, 1.0 ) );
    fill = max( fill, inW * ( 1.0 - smoothstep( -0.6 * px, 0.6 * px, edge ) ) );
  }
  // 1 px dark keyline outside the band
  float key = ( 1.0 - smoothstep( hw + 0.4 * px, hw + 1.6 * px, abs( band ) ) ) * ( 1.0 - ring ) * mask;
  float vis = valeVisible( 0.18 );
  float a = ( fill + key * 0.35 * ( 1.0 - fill ) ) * vStyle.y * vis;
  if ( a <= 0.003 ) discard;
  vec3 c = mix( vec3( 0.0 ), vColor, fill / max( fill + key * 0.35 * ( 1.0 - fill ), 1e-4 ) );
  gl_FragColor = vec4( c, a );
}`,ul=class{mesh;geo;aRing;aStyle;aColor;count=0;constructor(){let e=new me(1,1);this.geo=new j,this.geo.index=e.index,this.geo.setAttribute(`position`,e.getAttribute(`position`));let t=e=>{let t=new i(new Float32Array(sl*e),e);return t.setUsage(N),t};this.aRing=t(4),this.aStyle=t(4),this.aColor=t(3),Tl(this.geo,`ring`,{aRing:this.aRing,aStyle:this.aStyle,aColor:this.aColor}),this.geo.instanceCount=0;let n=wl(`ring`,{},{transparent:!0,depthTest:!1,depthWrite:!1,blending:1});this.mesh=new I(this.geo,n),this.mesh.frustumCulled=!1,this.mesh.renderOrder=5}begin(){this.count=0}push(e,t,n,r,i,a,o,s=0,c=.03){if(this.count>=sl)return;let l=this.count++;this.aRing.setXYZW(l,e,t,n,r),this.aStyle.setXYZW(l,i,o,s,c),this.aColor.setXYZ(l,a.r,a.g,a.b)}end(){this.geo.instanceCount=this.count;for(let e of[this.aRing,this.aStyle,this.aColor])e.clearUpdateRanges(),e.addUpdateRange(0,this.count*e.itemSize),e.needsUpdate=!0;this.mesh.visible=this.count>0}dispose(){this.geo.dispose(),this.mesh.material.dispose()}},dl={circle:0,ring:1,cone:2,rect:3};function fl(e,t,n,r,i){if(e===dl.circle)return t*.5;if(e===dl.ring)return Math.max(.1,(t-n)*.5);if(e===dl.cone){let e=Math.sin(Math.min(Math.PI/2,r));return t*e/(1+e)*.5}return i*.25}var pl=128,ml=`
attribute vec4 aA;      // x, z, dir, shape
attribute vec4 aB;      // radius, inner, halfAngle, length
attribute vec4 aC;      // width, fill, edge, edgePx
attribute vec4 aD;      // sweep, dashed, tick on, keyline alpha
attribute vec4 aColor;     // rgb, landing ring flash alpha (combat m-3)
attribute vec4 aTick;      // FRAY tick rgb, inner contour depth (m)
varying vec2 vLocal; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vColor; varying vec4 vTick;
void main() {
  float shape = aA.w;
  // bounds in the shape's local frame (u along dir, v across)
  vec2 lo, hi;
  if ( shape < 1.5 ) { lo = vec2( -aB.x ); hi = vec2( aB.x ); }
  else if ( shape < 2.5 ) { lo = vec2( -0.2, -aB.x ); hi = vec2( aB.x, aB.x ); }
  else { lo = vec2( -0.2, -aC.x * 0.5 ); hi = vec2( aB.w, aC.x * 0.5 ); }
  lo -= 0.5; hi += 0.5;
  vec2 uv = mix( lo, hi, position.xy + 0.5 );
  vec2 f = vec2( cos( aA.z ), sin( aA.z ) );
  vec2 s = vec2( -f.y, f.x );
  vec2 w = aA.xy + f * uv.x + s * uv.y;
  vLocal = uv;
  vA = aA; vB = aB; vC = aC; vD = aD; vColor = aColor; vTick = aTick;
  gl_Position = projectionMatrix * viewMatrix * vec4( w.x, 0.04, w.y, 1.0 );
}`,hl=`
${vt}
varying vec2 vLocal; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vColor; varying vec4 vTick;
float sdBox( vec2 p, vec2 b ) { vec2 d = abs( p ) - b; return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ); }
// signed distance to a circular sector (apex at the origin, axis +x, half-angle ha); < 0 inside. The side
// test is the 2D cross c × p: negative while p lies between the axis and the edge ray c = (cos ha, sin ha),
// positive beside or behind the apex (combat F1: the old operand order painted the cone inside-out)
float sdSector( vec2 p, float r, float ha ) {
  p.y = abs( p.y );
  vec2 c = vec2( cos( ha ), sin( ha ) );
  float l = length( p ) - r;
  float m = length( p - c * clamp( dot( p, c ), 0.0, r ) );
  return max( l, m * sign( c.x * p.y - c.y * p.x ) );
}
void main() {
  float shape = vA.w;
  vec2 p = vLocal;
  float d;            // signed distance to the edge (m), < 0 inside
  float prog;         // 0..1 position along the sweep
  if ( shape < 0.5 ) {
    d = length( p ) - vB.x;
    // clockwise from 12 o'clock on SCREEN: rebuild the world offset from the local frame
    vec2 f = vec2( cos( vA.z ), sin( vA.z ) ); vec2 s = vec2( -f.y, f.x );
    vec2 wo = f * p.x + s * p.y;
    prog = atan( wo.x, -wo.y ) / 6.2831853 + 0.5;
    prog = fract( prog + 0.5 );
  } else if ( shape < 1.5 ) {
    float l = length( p );
    d = max( l - vB.x, vB.y - l );
    vec2 f = vec2( cos( vA.z ), sin( vA.z ) ); vec2 s = vec2( -f.y, f.x );
    vec2 wo = f * p.x + s * p.y;
    prog = fract( atan( wo.x, -wo.y ) / 6.2831853 + 1.0 );
  } else if ( shape < 2.5 ) {
    d = sdSector( p, vB.x, vB.z );
    prog = length( p ) / max( vB.x, 1e-3 );
  } else {
    d = sdBox( p - vec2( vB.w * 0.5, 0.0 ), vec2( vB.w * 0.5, vC.x * 0.5 ) );
    prog = p.x / max( vB.w, 1e-3 );
  }
  float px = max( fwidth( d ), 1e-4 );
  float edgeW = vC.w * px;
  // edge band just inside the boundary, keyline 1 px just outside
  float inside = 1.0 - smoothstep( -0.75 * px, 0.75 * px, d );
  float edge = ( 1.0 - smoothstep( edgeW - 0.75 * px, edgeW + 0.75 * px, -d ) ) * inside;
  float key = ( 1.0 - smoothstep( 0.75 * px, 1.75 * px, d ) ) * ( 1.0 - inside );
  if ( vD.y > 0.5 ) {
    vec2 f = vec2( cos( vA.z ), sin( vA.z ) ); vec2 s = vec2( -f.y, f.x );
    vec2 wo = f * p.x + s * p.y;
    float a01 = atan( wo.x, -wo.y ) / 6.2831853 + 0.5;
    float k = fract( a01 * max( 24.0, floor( vB.x * 5.0 ) ) );
    float dash = smoothstep( 0.0, 0.05, k ) * ( 1.0 - smoothstep( 0.5, 0.55, k ) );
    edge *= dash; key *= dash;
  }
  float sweep = vD.x;
  float swept = sweep >= 1.0 ? 1.0 : 1.0 - smoothstep( sweep - 0.004, sweep + 0.004, prog );
  float fillA = vC.y * inside * ( 1.0 - edge ) * swept;
  float edgeA = vC.z * edge;
  float a = max( fillA, edgeA );
  // combat m-3: a large area lands as its edge band (0.35 m) and one inner contour, never a whole-shape wash
  if ( vColor.w > 0.001 ) {
    float depth = -d;
    float band = inside * ( 1.0 - smoothstep( 0.35 - px, 0.35 + px, depth ) );
    float rw = max( 1.5 * px, 0.08 );
    float ring = inside * ( 1.0 - smoothstep( rw - px, rw + px, abs( depth - vTick.w ) ) );
    a = max( a, vColor.w * max( band, ring ) );
  }
  vec3 col = vColor.rgb;
  // the sweep's leading hand: a slim brighter spoke on circles (still the relationship colour)
  if ( sweep < 1.0 && shape < 1.5 ) {
    float lead = ( 1.0 - smoothstep( 0.0, 0.012, abs( prog - sweep ) ) ) * inside;
    a = max( a, lead * min( 1.0, vC.z * 0.7 ) );
  }
  // FRAY: caster seat tick at the origin (6 px)
  if ( vD.z > 0.5 ) {
    float t = 1.0 - smoothstep( 3.0 * px - 0.75 * px, 3.0 * px + 0.75 * px, length( p ) );
    if ( t > 0.0 ) { col = mix( col, vTick.rgb, t ); a = max( a, t ); }
  }
  float k35 = key * vD.w;
  float vis = valeVisible( 0.2 );
  // premultiplied; the keyline is black (rgb 0)
  float outA = max( a, k35 ) * vis;
  if ( outA <= 0.002 ) discard;
  gl_FragColor = vec4( col * a * vis, outA );
}`,gl=class{mesh;geo;attrs;aA;aB;aC;aD;aColor;aTick;count=0;constructor(){let e=new me(1,1);this.geo=new j,this.geo.index=e.index,this.geo.setAttribute(`position`,e.getAttribute(`position`));let t=e=>{let t=new i(new Float32Array(pl*e),e);return t.setUsage(N),t};this.aA=t(4),this.aB=t(4),this.aC=t(4),this.aD=t(4),this.aColor=t(4),this.aTick=t(4),this.attrs=[this.aA,this.aB,this.aC,this.aD,this.aColor,this.aTick],Tl(this.geo,`tele`,{aA:this.aA,aB:this.aB,aC:this.aC,aD:this.aD,aColor:this.aColor,aTick:this.aTick}),this.geo.instanceCount=0;let n=wl(`tele`,{},{side:2,transparent:!0,depthTest:!1,depthWrite:!1,blending:5,blendEquation:104,blendSrc:201,blendDst:201,blendEquationAlpha:104,blendSrcAlpha:201,blendDstAlpha:201});this.mesh=new I(this.geo,n),this.mesh.frustumCulled=!1}begin(){this.count=0}push(e){if(this.count>=pl)return;let t=this.count++;this.aA.setXYZW(t,e.x,e.z,e.dir,e.shape),this.aB.setXYZW(t,e.radius,e.inner,e.halfAngle,e.length),this.aC.setXYZW(t,e.width,e.fill,e.edge,e.edgePx),this.aD.setXYZW(t,e.sweep,+!!e.dashed,+!!e.tick,e.key??.35),this.aColor.setXYZW(t,e.color.r,e.color.g,e.color.b,e.ringFlash??0),e.tick?this.aTick.setXYZW(t,e.tick.r,e.tick.g,e.tick.b,e.ringDepth??0):this.aTick.setW(t,e.ringDepth??0)}end(){this.geo.instanceCount=this.count;for(let e of this.attrs)e.clearUpdateRanges(),e.addUpdateRange(0,this.count*e.itemSize),e.needsUpdate=!0;this.mesh.visible=this.count>0}get size(){return this.count}dispose(){this.geo.dispose(),this.mesh.material.dispose()}},_l=`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,vl=`uniform sampler2D tTele; varying vec2 vUv; void main(){ gl_FragColor = texture2D( tTele, vUv ); }`,yl={composite:0,ring:1,bar:2,label:3,tele:4},bl=null,xl=null;function Sl(){return bl??={composite:{vert:_l,frag:vl,attrs:[]},ring:{vert:cl,frag:ll,attrs:[`aRing`,`aStyle`,`aColor`]},bar:{vert:Kl,frag:ql,attrs:[`aAnchor`,`aBox`,`aHp`,`aRes`,`aCol`,`aResCol`,`aSeat`,`aMisc`]},label:{vert:Jl,frag:Yl,attrs:[`aAnchor`,`aRect`,`aUv`,`aTint`]},tele:{vert:ml,frag:hl,attrs:[`aA`,`aB`,`aC`,`aD`,`aColor`,`aTick`]}}}function Cl(){if(!xl){let e=Sl();xl=il(Object.keys(yl).map(t=>e[t]),[vt])}return xl}function wl(e,t,n){let r=Cl();return new ve({glslVersion:h,vertexShader:r.vert,fragmentShader:r.frag,uniforms:{uSceneDepth:U.uSceneDepth,uHasDepth:U.uHasDepth,uResolution:U.uResolution,uNear:U.uNear,uFar:U.uFar,uAtlas:{value:null},tTele:{value:null},...t,uUberKind:{value:yl[e]}},...n})}function Tl(e,t,n){al(e,Sl()[t],n)}var El={fighter:0,minion:1,structure:2,monster:3},Dl={self:0,ally:1,enemy:2,neutral:3},Ol={none:0,spire:1,dome:2,chip:3},kl={fighter:{w:104,hp:10,res:4},minion:{w:58,hp:5},structure:{w:220,hp:16},monster:{w:104,hp:8},levelChip:22,nameFontPx:14,nameLinePx:15},Al=320,jl=24,Ml=1024,Nl=1024,Pl=36,Fl=864,Il=28,Ll=36,Rl=940,zl=204,Bl=40,Vl=5,Hl=10,Ul={hPx:20,glyphPx:14,textPx:12,fadeInMs:70},Wl={stun:[{p:`M12 3.5v4.5M12 16v4.5M3.5 12H8M16 12h4.5`},{p:`M9.5 6.5L12 9l2.5-2.5M9.5 17.5L12 15l2.5 2.5M6.5 9.5L9 12l-2.5 2.5M17.5 9.5L15 12l2.5 2.5`},{c:[12,12,1.3],f:!0}],airborne:[{p:`M6 13l6-6 6 6`},{p:`M6 19l6-6 6 6`,o:.6},{p:`M8 4h8`}],sleep:[{p:`M15.5 4.5a7.5 7.5 0 1 0 4 12.5 6 6 0 0 1-4-12.5z`},{p:`M5 5h3l-3 3h3`,o:.7}],fear:[{c:[12,12,2.2]},{p:`M12 6.5V3M12 17.5V21M6.5 12H3M17.5 12H21`},{p:`M7.5 7.5L5.5 5.5M16.5 16.5l2 2M16.5 7.5l2-2M7.5 16.5l-2 2`,o:.6}],taunt:[{c:[18,12,2.6]},{p:`M3.5 12h10`},{p:`M10 7.5l4.5 4.5-4.5 4.5`}],silence:[{p:`M3.5 12c1.6-3 3.4-3 5 0s3.4 3 5 0 3.4-3 5 0`,o:.75},{p:`M5 19.5L19 4.5`,w:2.2}],root:[{c:[12,6.5,3]},{p:`M12 9.5v11`},{p:`M11.2 11.5C9 13.5 7 15 4.5 19.5`},{p:`M12.8 11.5c2.2 2 4.2 3.5 6.7 8`},{p:`M6.6 16.6L4 15.5M17.4 16.6l2.6-1.1M12 16l-2 2.2`,o:.6}],disarm:[{p:`M4.5 19.5l5-5`,w:2.2},{p:`M13 11l6.5-6.5`,w:2.2},{p:`M10.5 10.5l3 3`,o:.6},{p:`M16 4.5h3.5V8`}]},Gl=[{p:`M5 19L12 5l7 14z`}],Kl=`
attribute vec3 aAnchor;
attribute vec4 aBox;      // quad w, quad h (ref px), y offset (ref px), kind
attribute vec4 aHp;       // hp, trail, shieldEnd, total hp (for ticks)
attribute vec4 aRes;      // res, cc, showRes, resHatch
attribute vec4 aCol;      // rgb, shape
attribute vec4 aResCol;   // rgb, alpha
attribute vec4 aSeat;     // rgb, seat line on
attribute vec4 aMisc;     // glyph, keyline, lost-HP flash, -
uniform vec2 uResolution;
uniform float uPxScale;
varying vec2 vP;
varying vec4 vBox; varying vec4 vHp; varying vec4 vRes; varying vec4 vCol; varying vec4 vResCol; varying vec4 vSeat; varying vec4 vMisc;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4( aAnchor, 1.0 );
  if ( clip.w <= 0.0 || aResCol.a <= 0.001 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  vec2 ndc = clip.xy / clip.w;
  vec2 px = floor( ( ndc * 0.5 + 0.5 ) * uResolution ) + 0.5 * mod( vec2( floor( aBox.x * uPxScale + 0.5 ), floor( aBox.y * uPxScale + 0.5 ) ), 2.0 );
  vec2 local = position.xy * aBox.xy;
  vec2 p = px + ( local + vec2( 0.0, aBox.z ) ) * uPxScale;
  gl_Position = vec4( p / uResolution * 2.0 - 1.0, 0.0, 1.0 );
  vP = local;
  vBox = aBox; vHp = aHp; vRes = aRes; vCol = aCol; vResCol = aResCol; vSeat = aSeat; vMisc = aMisc;
}`,ql=`
uniform float uPxScale;
varying vec2 vP;
varying vec4 vBox; varying vec4 vHp; varying vec4 vRes; varying vec4 vCol; varying vec4 vResCol; varying vec4 vSeat; varying vec4 vMisc;
const vec3 INK1 = vec3( 0.005605, 0.006995, 0.010330 );   // #11141A linear
const vec3 NOON = vec3( 0.904661, 0.863157, 0.760525 );   // #F4EFE2
const vec3 GLASS = vec3( 0.715694, 0.799103, 0.854993 );  // #DCE8EE
const vec3 CHALK = vec3( 0.846873, 0.791298, 0.672443 );  // #EDE6D6
const vec3 INK0 = vec3( 0.003347, 0.004025, 0.005605 );   // #0B0D11
const vec3 SAP = vec3( 0.124772, 0.686685, 0.258216 );    // #63D88B (your own fill)
float sdBox( vec2 p, vec2 b ) { vec2 d = abs( p ) - b; return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ); }
// bar silhouette with the relationship end shape; c = centre, hb = half size
float sdBar( vec2 p, vec2 c, vec2 hb, float shape ) {
  vec2 q = p - c;
  if ( shape > 0.5 && shape < 1.5 ) { float r = hb.y; return sdBox( q, vec2( max( hb.x - r, 0.0 ), 0.0 ) ) - r; }        // ally: rounded
  if ( shape > 1.5 && shape < 2.5 ) {                                                                                    // enemy: chevron
    float k = hb.y * 0.9;
    float d1 = abs( q.y ) - hb.y;
    float d2 = ( abs( q.x ) - ( hb.x - k ) - k * ( 1.0 - abs( q.y ) / hb.y ) ) * hb.y / length( vec2( hb.y, k ) );
    return max( d1, d2 );
  }
  return sdBox( q, hb );
}
float cover( float d ) { float aa = 0.5 / uPxScale; return 1.0 - smoothstep( -aa, aa, d ); }
void over( inout vec4 acc, vec3 c, float a ) { acc.rgb = mix( acc.rgb, c, a ); acc.a = a + acc.a * ( 1.0 - a ); }
void main() {
  float kind = vBox.w, shape = vCol.w;
  float barW = kind < 0.5 ? 104.0 : kind < 1.5 ? 58.0 : kind < 2.5 ? 220.0 : 104.0;
  float hpH = kind < 0.5 ? 10.0 : kind < 1.5 ? 5.0 : kind < 2.5 ? 16.0 : 8.0;
  float showRes = vRes.z;
  float resH = showRes > 0.5 ? 4.0 : 0.0, gap = showRes > 0.5 ? 1.0 : 0.0;
  float pad = kind > 0.5 && kind < 1.5 ? 1.0 : 2.0;
  float bodyH = hpH + gap + resH;
  float hpTop = bodyH * 0.5, hpBot = hpTop - hpH;
  float resTop = hpBot - gap, resBot = resTop - resH;
  vec2 plateC = vec2( 0.0, 0.0 );
  vec2 plateHB = vec2( barW * 0.5 + pad, bodyH * 0.5 + pad );
  vec4 acc = vec4( 0.0 );
  float sh = shape > 2.5 ? 3.0 : shape;               // neutral: square ends
  float plateShape = sh < 0.5 ? 3.0 : sh;              // self: square plate inside a double frame
  float dPlate = sdBar( vP, plateC, plateHB, plateShape );
  // self: double frame (outer 1 px Noonwhite line 2 px outside the plate)
  if ( sh < 0.5 ) {
    float dOuter = sdBox( vP - plateC, plateHB + 2.0 );
    float frame = cover( abs( dOuter + 0.5 ) - 0.5 );
    over( acc, INK0, cover( dOuter ) * ( 1.0 - cover( dPlate ) ) * 0.55 );
    over( acc, NOON, frame );
  }
  over( acc, INK1, cover( dPlate ) * 0.8 );
  // FRAY: your seat colour lines the top of your plate
  if ( vSeat.w > 0.5 ) {
    float top = plateHB.y;
    float line = cover( sdBox( vP - vec2( 0.0, top - 1.0 ), vec2( plateHB.x, 1.0 ) ) );
    over( acc, vSeat.rgb, line );
  }
  // HP row
  vec2 hpC = vec2( 0.0, ( hpTop + hpBot ) * 0.5 );
  vec2 hpHB = vec2( barW * 0.5, hpH * 0.5 );
  float dRow = sdBar( vP, hpC, hpHB, sh < 0.5 ? 3.0 : sh );
  float inRow = cover( dRow );
  float u = ( vP.x + barW * 0.5 ) / barW;             // 0..1 across the bar
  float aa = 0.5 / ( uPxScale * barW );
  float hp = clamp( vHp.x, 0.0, 1.0 ), trail = clamp( vHp.y, 0.0, 1.0 ), shEnd = clamp( vHp.z, 0.0, 1.0 );
  float fHp = 1.0 - smoothstep( hp - aa, hp + aa, u );
  float fTrail = ( 1.0 - smoothstep( trail - aa, trail + aa, u ) ) * ( 1.0 - fHp );
  float fShield = ( 1.0 - smoothstep( shEnd - aa, shEnd + aa, u ) ) * smoothstep( hp - aa, hp + aa, u );
  over( acc, sh < 0.5 ? SAP : vCol.rgb, inRow * fHp );
  // lost HP: a white flash that stands 1 px proud for ~4 frames, then the Noonwhite trail
  float fl = clamp( vMisc.z, 0.0, 1.0 );
  float inPop = fl > 0.001 ? cover( sdBox( vP - hpC, hpHB + vec2( 0.0, 1.0 ) ) ) : inRow;
  over( acc, mix( NOON, vec3( 1.0 ), fl ), inPop * fTrail );
  if ( shEnd > hp + 0.001 ) {
    float hatch = mod( ( vP.x + vP.y ) / 1.41421, 4.0 / 1.41421 * 1.41421 );
    float line = 1.0 - smoothstep( 0.5, 1.0 + 0.5 / uPxScale, abs( hatch - 0.5 ) );
    over( acc, GLASS, inRow * fShield * ( 0.38 + 0.62 * line ) );
  }
  // FRAY keyline around the HP fill (1 px chalk or ink)
  if ( vMisc.y > 0.5 ) {
    vec3 kc = vMisc.y < 1.5 ? CHALK : INK0;
    float edge = cover( abs( dRow + 0.5 ) - 0.5 ) * ( 1.0 - smoothstep( hp, hp + aa * 2.0, u ) );
    over( acc, kc, edge );
  }
  // ticks: light every 100, heavy every 1000 (HP row only); structures: every 25 %
  float total = max( vHp.w, 1.0 );
  if ( kind > 1.5 && kind < 2.5 ) {
    float q = u * 4.0;
    float dq = abs( q - floor( q + 0.5 ) ) * barW * 0.25;
    float notEdgeQ = step( 2.0, vP.x + barW * 0.5 ) * step( 2.0, barW * 0.5 - vP.x );
    over( acc, INK0, inRow * ( 1.0 - smoothstep( 1.0 - 0.25 / uPxScale, 1.0 + 0.25 / uPxScale, dq ) ) * 0.75 * notEdgeQ );
  } else if ( kind < 0.5 || kind > 2.5 ) {
    float spacing = barW * 100.0 / total;
    float t100 = u * total / 100.0;
    float dl = abs( t100 - floor( t100 + 0.5 ) ) * spacing;
    float t1k = u * total / 1000.0;
    float dh = abs( t1k - floor( t1k + 0.5 ) ) * spacing * 10.0;
    float notEdge = step( 0.6, vP.x + barW * 0.5 ) * step( 0.6, barW * 0.5 - vP.x );
    float light = spacing >= 4.0 ? ( 1.0 - smoothstep( 0.5 - 0.25 / uPxScale, 0.5 + 0.25 / uPxScale, dl ) ) * 0.35 : 0.0;
    float heavy = ( 1.0 - smoothstep( 1.0 - 0.25 / uPxScale, 1.0 + 0.25 / uPxScale, dh ) ) * 0.7;
    over( acc, INK0, inRow * max( light, heavy ) * notEdge );
  }
  // resource row
  if ( showRes > 0.5 ) {
    vec2 rC = vec2( 0.0, ( resTop + resBot ) * 0.5 );
    float inRes = cover( sdBox( vP - rC, vec2( barW * 0.5, resH * 0.5 ) ) );
    float fRes = 1.0 - smoothstep( vRes.x - aa, vRes.x + aa, u );
    float a = inRes * fRes;
    if ( vRes.w > 0.5 ) { float hh = mod( vP.x - vP.y, 3.0 ); a *= 0.55 + 0.45 * step( 1.5, hh ); }
    over( acc, vResCol.rgb, a );
  }
  // CC bar: 2 px under the plate
  if ( vRes.y > 0.001 ) {
    float y0 = -plateHB.y - 2.0;
    float ccW = barW * clamp( vRes.y, 0.0, 1.0 );
    float a = cover( sdBox( vP - vec2( -barW * 0.5 + ccW * 0.5, y0 ), vec2( ccW * 0.5, 1.0 ) ) );
    over( acc, INK0, cover( sdBox( vP - vec2( 0.0, y0 ), vec2( barW * 0.5 + 1.0, 2.0 ) ) ) * 0.6 );
    over( acc, CHALK, a );
  }
  // left marks: level chip (fighters) or the side glyph (structures)
  float g = vMisc.x;
  if ( g > 0.5 ) {
    vec2 cc = vec2( -plateHB.x - 3.0 - 11.0, 0.0 );
    if ( g > 2.5 ) {
      float dc = sdBox( vP - cc, vec2( 11.0 ) );
      over( acc, INK1, cover( dc ) * 0.9 );
      over( acc, vCol.rgb, cover( abs( dc + 0.5 ) - 0.5 ) );
    } else if ( g < 1.5 ) {
      // ▲ spire
      vec2 q = vP - cc; q.y += 1.0;
      float k = 1.7320508;
      q.x = abs( q.x ) - 8.0; q.y = q.y + 8.0 / k;
      if ( q.x + k * q.y > 0.0 ) q = vec2( q.x - k * q.y, -k * q.x - q.y ) / 2.0;
      q.x -= clamp( q.x, -16.0, 0.0 );
      float dt = -length( q ) * sign( q.y );
      over( acc, INK1, cover( dt - 1.5 ) * 0.8 );
      over( acc, vCol.rgb, cover( dt ) );
    } else {
      // ◠ dome
      vec2 q = vP - cc + vec2( 0.0, 4.0 );
      float dd = max( length( q ) - 9.0, -q.y );
      over( acc, INK1, cover( dd - 1.5 ) * 0.8 );
      over( acc, vCol.rgb, cover( dd ) );
    }
  }
  if ( acc.a <= 0.002 ) discard;
  gl_FragColor = vec4( acc.rgb, acc.a * vResCol.a );
}`,Jl=`
attribute vec3 aAnchor;
attribute vec4 aRect;     // offset x, offset y (ref px, centre), w, h (ref px)
attribute vec4 aUv;       // u0, v0, u1, v1
attribute vec4 aTint;     // rgb, alpha
uniform vec2 uResolution;
uniform float uPxScale;
varying vec2 vUv; varying vec4 vTint;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4( aAnchor, 1.0 );
  if ( clip.w <= 0.0 || aTint.a <= 0.001 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  vec2 px = floor( ( clip.xy / clip.w * 0.5 + 0.5 ) * uResolution );
  vec2 p = px + ( aRect.xy + position.xy * aRect.zw ) * uPxScale;
  gl_Position = vec4( p / uResolution * 2.0 - 1.0, 0.0, 1.0 );
  vUv = mix( aUv.xy, aUv.zw, position.xy + 0.5 );
  vTint = aTint;
}`,Yl=`
uniform sampler2D uAtlas;
varying vec2 vUv; varying vec4 vTint;
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  if ( t.a < 0.01 ) discard;
  gl_FragColor = vec4( t.rgb * vTint.rgb, t.a * vTint.a );
}`;function Xl(e,t){let n=new i(new Float32Array(e*t),t);return n.setUsage(N),n}var Zl=class{mesh;labels;geo;lgeo;a;la;count=0;lcount=0;canvas;ctx;atlas;slots=new Map;slotWidth=[];nextSlot=0;ccCells=new Map;ccWidth=[];ccText=[];ccKind=[];fontsReady=!1;uniforms={uPxScale:{value:1},uResolution:U.uResolution};constructor(){let e=new me(1,1);this.geo=new j,this.geo.index=e.index,this.geo.setAttribute(`position`,e.getAttribute(`position`)),this.a={aAnchor:Xl(Al,3),aBox:Xl(Al,4),aHp:Xl(Al,4),aRes:Xl(Al,4),aCol:Xl(Al,4),aResCol:Xl(Al,4),aSeat:Xl(Al,4),aMisc:Xl(Al,4)},Tl(this.geo,`bar`,this.a),this.geo.instanceCount=0;let t=wl(`bar`,this.uniforms,{transparent:!0,depthTest:!1,depthWrite:!1,blending:1});this.mesh=new I(this.geo,t),this.mesh.frustumCulled=!1,this.mesh.renderOrder=20,this.canvas=document.createElement(`canvas`),this.canvas.width=Ml,this.canvas.height=Nl,this.ctx=this.canvas.getContext(`2d`),this.atlas=new ye(this.canvas),this.atlas.colorSpace=de,this.atlas.minFilter=p,this.atlas.magFilter=re,this.atlas.generateMipmaps=!0,this.atlas.premultiplyAlpha=!1,this.drawDigits(),this.lgeo=new j,this.lgeo.index=e.index,this.lgeo.setAttribute(`position`,e.getAttribute(`position`)),this.la={aAnchor:Xl(Al,3),aRect:Xl(Al,4),aUv:Xl(Al,4),aTint:Xl(Al,4)},Tl(this.lgeo,`label`,this.la),this.lgeo.instanceCount=0;let n=wl(`label`,{uPxScale:this.uniforms.uPxScale,uAtlas:{value:this.atlas}},{transparent:!0,depthTest:!1,depthWrite:!1,blending:1});this.labels=new I(this.lgeo,n),this.labels.frustumCulled=!1,this.labels.renderOrder=21;let r=document.fonts;r&&Promise.all([r.load(`600 28px "Atkinson Hyperlegible Next"`).catch(()=>[]),r.load(`700 26px "Atkinson Hyperlegible Mono"`).catch(()=>[]),r.load(`700 24px "Atkinson Hyperlegible Next"`).catch(()=>[])]).then(()=>{this.fontsReady=!0,this.redrawAll()})}nameFont(){return`600 28px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif`}drawDigits(){let e=this.ctx;e.clearRect(0,Fl,Ml,160),e.font=`700 25px "Atkinson Hyperlegible Mono", ui-monospace, monospace`,e.textAlign=`center`,e.textBaseline=`middle`;for(let t=1;t<=60;t++){let n=(t-1)%36,r=Math.floor((t-1)/36),i=n*Il+Il/2,a=Fl+r*Ll+Ll/2+1;e.fillStyle=`#EDE6D6`,e.save(),t>=10?(e.translate(i,a),e.scale(.78,1),e.fillText(String(t),0,0)):e.fillText(String(t),i,a),e.restore()}this.atlas.needsUpdate=!0}drawName(e,t){let n=this.ctx,r=e*Pl;n.clearRect(0,r,Ml,Pl),n.font=this.nameFont(),n.textAlign=`center`,n.textBaseline=`middle`,n.lineJoin=`round`,n.lineWidth=4,n.strokeStyle=`rgba(11,13,17,0.92)`;let i=Math.min(1016,Math.ceil(n.measureText(t).width)+8);n.strokeText(t,Ml/2,r+Pl/2+1,1012),n.fillStyle=`#EDE6D6`,n.fillText(t,Ml/2,r+Pl/2+1,1012),this.slotWidth[e]=i,this.atlas.needsUpdate=!0}redrawAll(){for(let[e,t]of this.slots)this.drawName(t,e);this.drawDigits();for(let e=0;e<this.ccKind.length;e++)this.drawCc(e)}drawCc(e){let t=this.ctx,n=e%Vl*zl,r=Rl+Math.floor(e/Vl)*Bl;t.clearRect(n,r,zl,Bl);let i=this.ccText[e];t.font=`700 24px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif`;let a=Ul.glyphPx*2,o=Math.min(zl-a-6-10,Math.ceil(t.measureText(i).width)),s=a+6+o,c=n+Math.round((zl-s)/2),l=r+Bl/2,u=a/24,d=Wl[this.ccKind[e]]??Gl;t.save(),t.translate(c,l-a/2),t.scale(u,u),t.lineCap=`round`,t.lineJoin=`round`;for(let e of[0,1])for(let n of d){let r=new Path2D;n.p&&r.addPath(new Path2D(n.p)),n.c&&(r.moveTo(n.c[0]+n.c[2],n.c[1]),r.arc(n.c[0],n.c[1],n.c[2],0,Math.PI*2));let i=n.w??1.7;e===0?(t.globalAlpha=.92,t.strokeStyle=`rgb(11,13,17)`,t.lineWidth=i+4/u,t.stroke(r),n.f&&(t.fillStyle=`rgb(11,13,17)`,t.fill(r))):(t.globalAlpha=n.o??1,t.strokeStyle=`#EDE6D6`,t.lineWidth=i,t.stroke(r),n.f&&(t.fillStyle=`#EDE6D6`,t.fill(r)))}t.restore(),t.textAlign=`left`,t.textBaseline=`middle`,t.lineJoin=`round`,t.lineWidth=4,t.strokeStyle=`rgba(11,13,17,0.92)`;let f=c+a+6;t.strokeText(i,f,l+1,o),t.fillStyle=`#EDE6D6`,t.fillText(i,f,l+1,o),this.ccWidth[e]=s+8,this.atlas.needsUpdate=!0}ccSlot(e,t){let n=this.ccCells.get(e);return n===void 0?this.ccKind.length>=Hl?-1:(n=this.ccKind.length,this.ccKind.push(e),this.ccText.push(t.toUpperCase()),this.ccCells.set(e,n),this.drawCc(n),n):n}nameSlot(e){if(!e)return-1;let t=this.slots.get(e);return t===void 0?this.nextSlot>=jl?-1:(t=this.nextSlot++,this.slots.set(e,t),this.drawName(t,e),t):t}get ready(){return this.fontsReady}begin(e){this.count=0,this.lcount=0,this.uniforms.uPxScale.value=e}push(e){if(this.count>=Al)return;let t=this.count++,n=e.kind===El.fighter,r=n?kl.fighter.w:e.kind===El.minion?kl.minion.w:e.kind===El.structure?kl.structure.w:kl.monster.w,i=r+2*(5+kl.levelChip+4)+8,a=this.a;if(a.aAnchor.setXYZ(t,e.x,e.y,e.z),a.aBox.setXYZW(t,i,44,0,e.kind),a.aHp.setXYZW(t,e.hp,e.trail,e.shieldEnd,e.total),a.aRes.setXYZW(t,e.res,e.cc,+!!e.showRes,+!!e.resHatch),a.aCol.setXYZW(t,e.color.r,e.color.g,e.color.b,e.shape),a.aResCol.setXYZW(t,e.resColor.r,e.resColor.g,e.resColor.b,e.alpha),e.seatLine?a.aSeat.setXYZW(t,e.seatLine.r,e.seatLine.g,e.seatLine.b,1):a.aSeat.setXYZW(t,0,0,0,0),a.aMisc.setXYZW(t,e.glyph,e.keyline,e.flash??0,0),n){let t=(kl.fighter.hp+(e.showRes?kl.fighter.res+1:0))/2+2+(e.shape===Dl.self?2:0);if(e.nameSlot>=0&&this.pushLabel(e,0,t+2+kl.nameLinePx/2,(this.slotWidth[e.nameSlot]??200)/2,Pl/2,(Ml/2-(this.slotWidth[e.nameSlot]??200)/2)/Ml,1-(e.nameSlot*Pl+Pl)/Nl,(Ml/2+(this.slotWidth[e.nameSlot]??200)/2)/Ml,1-e.nameSlot*Pl/Nl,1,1,1),e.level>0){let t=Math.min(60,Math.max(1,Math.round(e.level))),n=(t-1)%36,i=Math.floor((t-1)/36),a=n*Il/Ml,o=(n+1)*Il/Ml,s=1-(Fl+i*Ll)/Nl,c=1-(Fl+(i+1)*Ll)/Nl,l=-(r/2+2)-3-kl.levelChip/2;this.pushLabel(e,l,.5,Il*.58,Ll*.58,a,c,o,s,1,1,1)}let n=e.ccPlate??-1;if(n>=0&&n<this.ccKind.length&&(e.ccAlpha??1)>.001){let r=t+2+(e.nameSlot>=0?kl.nameLinePx+1:0),i=this.ccWidth[n]??zl,a=n%Vl*zl+(zl-i)/2,o=Rl+Math.floor(n/Vl)*Bl;this.pushLabel(e,0,r+Ul.hPx/2,i/2,Bl/2,a/Ml,1-(o+Bl)/Nl,(a+i)/Ml,1-o/Nl,1,1,1,e.ccAlpha??1)}}}pushLabel(e,t,n,r,i,a,o,s,c,l,u,d,f=1){if(this.lcount>=Al)return;let p=this.lcount++,m=this.la;m.aAnchor.setXYZ(p,e.x,e.y,e.z),m.aRect.setXYZW(p,t,n,r,i),m.aUv.setXYZW(p,a,o,s,c),m.aTint.setXYZW(p,l,u,d,e.alpha*f)}end(){this.geo.instanceCount=this.count;for(let e of Object.values(this.a))e.clearUpdateRanges(),e.addUpdateRange(0,this.count*e.itemSize),e.needsUpdate=!0;this.lgeo.instanceCount=this.lcount;for(let e of Object.values(this.la))e.clearUpdateRanges(),e.addUpdateRange(0,this.lcount*e.itemSize),e.needsUpdate=!0;this.mesh.visible=this.count>0,this.labels.visible=this.lcount>0}dispose(){this.geo.dispose(),this.lgeo.dispose(),this.atlas.dispose(),this.mesh.material.dispose(),this.labels.material.dispose()}},Ql=class{scene=new L;teleScene=new L;teleTarget;compositeCam=new Ie(-1,1,1,-1,0,1);composite;clear=new R(0,0,0);camera=null;constructor(){this.scene.matrixWorldAutoUpdate=!0,this.teleTarget=new ne(4,4,{type:D,depthBuffer:!1,stencilBuffer:!1,magFilter:re,minFilter:re});let e=wl(`composite`,{tTele:{value:this.teleTarget.texture}},{depthTest:!1,depthWrite:!1,transparent:!0,blending:5,blendEquation:100,blendSrc:201,blendDst:205,blendEquationAlpha:100,blendSrcAlpha:201,blendDstAlpha:205});this.composite=new I(new me(2,2),e),this.composite.frustumCulled=!1,this.composite.renderOrder=-100,this.scene.add(this.composite)}draw(e,t,n,r){let i=this.camera;if(!i)return;let a=t?t.width:e.domElement.width,o=t?t.height:e.domElement.height;U.uResolution.value.set(a,o),U.uSceneDepth.value=n,U.uHasDepth.value=+!!n,U.uNear.value=i.near,U.uFar.value=i.far,(this.teleTarget.width!==a||this.teleTarget.height!==o)&&this.teleTarget.setSize(a,o);let s=e.autoClear,c=e.getClearColor(new R),l=e.getClearAlpha();e.setRenderTarget(this.teleTarget),e.setClearColor(this.clear,0),e.clear(!0,!1,!1),e.autoClear=!1,e.render(this.teleScene,i),e.setRenderTarget(t),e.render(this.scene,i),r?.(i),e.autoClear=s,e.setClearColor(c,l)}dispose(){this.teleTarget.dispose(),this.composite.geometry.dispose(),this.composite.material.dispose()}},$l=29,eu=30,tu=.45;function nu(){return{uPx:{value:2.5},uMask:{value:null},uColor:{value:new R},uAlpha:{value:1},uSceneDepth:U.uSceneDepth,uHasDepth:U.uHasDepth,uResolution:U.uResolution,uNear:U.uNear,uFar:U.uFar}}var ru=class{target=null;rimU;mats;ink=new R(0,0,0);saved=[];constructor(e){this.ink.setStyle(e);let{uPx:t,uMask:n,uColor:r,uAlpha:i,...a}=nu();this.rimU={uPx:t,uMask:n,uColor:r,uAlpha:i},this.mats={rigid:Zt(`rigid`,this.rimU,a),skin:Zt(`skin`,this.rimU,a)}}draw(e,t,n,r){if(r.px<=0||!r.mask.length||!r.hull.length)return;let i=U.uResolution.value,a=Math.max(1,Math.round(i.x)),o=Math.max(1,Math.round(i.y));this.target?(this.target.width!==a||this.target.height!==o)&&this.target.setSize(a,o):this.target=new ne(a,o,{format:Ve,type:f,depthBuffer:!1,stencilBuffer:!1,minFilter:Se,magFilter:Se,generateMipmaps:!1});let s=t.layers.mask,c=e.getClearColor(new R),l=e.getClearAlpha(),u=e.autoClear;e.autoClear=!1;let d=r.maskMat&&r.rimMat?{mask:r.maskMat,rim:r.rimMat}:null;this.restyle(r.mask,e=>d?.mask??this.mats[Ut(e)].mask,$l),e.setRenderTarget(this.target),e.setClearColor(0,0),e.clear(!0,!1,!1),t.layers.set($l),e.render(r.model,t),this.restore();let p=d?.rim.uniforms??this.rimU;p.uMask.value=this.target.texture,this.restyle(r.hull,e=>d?.rim??this.mats[Ut(e)].rim,eu),e.setRenderTarget(n),t.layers.set(eu),p.uPx.value=r.px+1,p.uColor.value.copy(this.ink),p.uAlpha.value=tu,e.render(r.model,t),p.uPx.value=r.px,p.uColor.value.copy(r.color),p.uAlpha.value=1,e.render(r.model,t),this.restore(),t.layers.mask=s,e.setClearColor(c,l),e.autoClear=u}restyle(e,t,n){for(let r of e)this.saved.push({mesh:r,material:r.material,visible:r.visible,layers:r.layers.mask}),r.material=t(r),r.visible=!0,r.layers.set(n)}restore(){for(let e of this.saved)e.mesh.material=e.material,e.mesh.visible=e.visible,e.mesh.layers.mask=e.layers;this.saved.length=0}releaseTarget(){this.target?.dispose(),this.target=null}dispose(){this.target?.dispose();for(let e of Object.values(this.mats))e.mask.dispose(),e.rim.dispose()}},iu=class extends Je{depth=null;draw;constructor(e){super(`OverlayPass`),this.draw=e,this.needsSwap=!1,this.needsDepthTexture=!0}setDepthTexture(e){this.depth=e,au.uLiftDepth.value=e}render(e,t){this.draw(e,this.renderToScreen?null:t,this.depth)}},au={uLiftDepth:new T(null),uLiftPre:new T(null),uLiftPreOn:new T(0),uLiftGain:new T(1),uLiftFxGain:new T(1),uLiftInvProj:new T(new M),uLiftCamWorld:new T(new M)},ou=Za,su=1.2,cu=2,lu=e=>new Map(Object.entries(e)),uu=class extends qe{cam;constructor(e){super(`ValeExposure`,`
uniform vec4 uLiftA[4];
uniform vec4 uLiftB[4];
uniform float uExpo;
uniform float uBreath;
uniform float uAspect;
uniform highp sampler2D uLiftDepth;
uniform float uLiftDepthOn;
uniform mat4 uLiftInvProj;
uniform mat4 uLiftCamWorld;
uniform highp sampler2D uLiftPre;
uniform float uLiftPreOn;
uniform float uLiftGain;
uniform float uLiftFxGain;
// the display luma the NEUTRAL tone map (three's NeutralToneMapping, exposure 1) makes of a linear colour
float liftDispLuma( vec3 col ) {
  float x = min( col.r, min( col.g, col.b ) );
  col -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float peak = max( col.r, max( col.g, col.b ) );
  if ( peak >= 0.76 ) {
    float np = 1.0 - 0.0576 / ( peak + 0.24 - 0.76 );
    col *= np / peak;
    col = mix( col, vec3( np ), 1.0 - 1.0 / ( 0.15 * ( peak - np ) + 1.0 ) );
  }
  return pow( max( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 ), 1.0 / 2.2 );
}
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = inputColor.rgb * pow( max( uExpo, 0.0 ), 2.2 );
  float lift = 0.0, desat = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    vec4 a = uLiftA[ i ];
    if ( a.w <= 0.0 ) continue;
    vec2 d = ( uv - a.xy ) * vec2( uAspect, 1.0 );
    float k = 1.0 - smoothstep( a.z * 0.55, a.z * 1.35, length( d ) );
    lift += a.w * ( k * uLiftGain + uBreath * ( 1.0 - k ) );
    desat = max( desat, uLiftB[ i ].x * k );
  }
  float body = 0.0;
  if ( lift > 0.02 && uLiftDepthOn > 0.5 ) {
    float z = texture2D( uLiftDepth, uv ).r;
    vec4 v = uLiftInvProj * vec4( vec3( uv, z ) * 2.0 - 1.0, 1.0 );
    vec3 w = ( uLiftCamWorld * vec4( v.xyz / v.w, 1.0 ) ).xyz;
    body = smoothstep( 0.05, 0.2, w.y ) * step( z, 0.99999 );
    // a pale body part takes less: its display value stops at 0.86 (never the stopped-sun white), a dark one up to the cap
    float bodyV = pow( max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 ), 1.0 / 2.2 );
    float capB = clamp( 0.86 / bodyV, 1.0, ${Ja.toFixed(3)} );
    lift = mix( lift, min( lift, capB - 1.0 ), body );
    desat *= 1.0 - body;
  }
  float m = pow( 1.0 + lift, 2.2 );
  // CW1 refix (combat C1): the light the effects ADD (the VFX drawn over the world, plus the bloom it throws: per
  // channel, what rose over the pre-VFX world) is split off and takes the plain capped multiplier (the VFX shaders'
  // vfxLift already holds it to the body cap) and no saturation drop. What stays (the world, and whatever an ink, dust
  // or stone layer darkened it to) is solved through the tone curve and eased toward white as the ground. So an effect
  // inside the beat keeps its kit hue (the solve on ground + light pushed a violet ult toward blue: the ground's own
  // multiplier fell where the light was, and the on - off difference lost the ground's warm channels)
  vec3 fx = vec3( 0.0 );
  if ( lift > 0.02 && uLiftPreOn > 0.5 ) {
    vec3 g = texture2D( uLiftPre, uv ).rgb * pow( max( uExpo, 0.0 ), 2.2 );
    fx = max( c - g, 0.0 );
    c = min( c, g );
  }
  // combat C2: on the GROUND the envelope's ratio is a display ratio through the tone curve too. The NEUTRAL tone map
  // that follows compresses everything over ~0.76 linear, so a plain ×2.4^2.2 read ×1.9-2.2 on a mid-value ground
  // (closing review: Hesmi ×1.93, Marund ×1.58). The ground's multiplier is solved so the TONE-MAPPED display luma is
  // ×(1 + lift), stopping short of white (display ${Ya}); bodies keep the capped multiplier above.
  if ( lift > 0.05 && body < 0.5 ) {
    float d0 = liftDispLuma( c );
    float target = min( d0 * ( 1.0 + lift ), ${Ya.toFixed(3)} );
    if ( liftDispLuma( c * m ) < target ) {
      float lo = log2( m ), hi = log2( m ) + 6.0;
      for ( int j = 0; j < 9; j ++ ) {
        float mid = 0.5 * ( lo + hi );
        if ( liftDispLuma( c * exp2( mid ) ) < target ) lo = mid; else hi = mid;
      }
      m = mix( exp2( lo ), m, body * 2.0 );
    }
    // near the top the ground keeps its own tint (the saturation drop eases off): warm light, never a white-out around
    // the struck unit (the victim box stays under the white gate)
    desat *= 1.0 - smoothstep( 0.7, ${Ya.toFixed(3)}, target );
  }
  c *= m;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  outputColor = vec4( mix( c, vec3( l ), desat ) + fx * uLiftFxGain * pow( 1.0 + lift, 2.2 ), inputColor.a );
}`,{blendFunction:tt.SET,uniforms:lu({uLiftA:ou.uLiftA,uLiftB:ou.uLiftB,uExpo:ou.uExpo,uBreath:ou.uBreath,uAspect:ou.uAspect,uLiftDepth:au.uLiftDepth,uLiftDepthOn:new T(0),uLiftPre:au.uLiftPre,uLiftPreOn:au.uLiftPreOn,uLiftGain:au.uLiftGain,uLiftFxGain:au.uLiftFxGain,uLiftInvProj:au.uLiftInvProj,uLiftCamWorld:au.uLiftCamWorld})}),this.cam=e}update(){let e=this.cam();au.uLiftInvProj.value.copy(e.projectionMatrixInverse),au.uLiftCamWorld.value.copy(e.matrixWorld),this.uniforms.get(`uLiftDepthOn`).value=+!!au.uLiftDepth.value}},du=class extends qe{constructor(){super(`ValeGrade`,`
uniform float uSat;
uniform float uVal;
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = inputColor.rgb;
  if ( uSat < 0.999 || uVal < 0.999 ) {
    float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    c = mix( vec3( l ), c, uSat ) * uVal;
  }
  outputColor = vec4( c, inputColor.a );
}`,{blendFunction:tt.SET,uniforms:lu({uSat:ou.uSat,uVal:ou.uVal})})}},fu=class extends qe{constructor(){super(`ValeDistort`,`
uniform sampler2D uDistort;
uniform float uDistortOn;
void mainUv( inout vec2 uv ) {
  if ( uDistortOn > 0.5 ) uv += clamp( texture2D( uDistort, uv ).rg, vec2( -0.015 ), vec2( 0.015 ) );
}`,{uniforms:lu({uDistort:ou.uDistort,uDistortOn:ou.uDistortOn})})}},pu={low:0,medium:0,high:.3,ultra:.3},mu=class extends rt{constructor(e,t){super({preset:e});let n=this.getFragmentShader();if(!n.trimEnd().endsWith(`outputColor=color;}`)){console.warn(`[post] SMAA shader changed: sharpen skipped`);return}this.setFragmentShader(`uniform float uSharp;
${n.trimEnd().slice(0,-19)}
  if ( uSharp > 0.0 ) {
    vec3 pc = sqrt( max( color.rgb, 0.0 ) );
    vec3 pn = sqrt( max( texture2D( inputBuffer, uv + vec2( 0.0, texelSize.y ) ).rgb, 0.0 ) );
    vec3 ps = sqrt( max( texture2D( inputBuffer, uv - vec2( 0.0, texelSize.y ) ).rgb, 0.0 ) );
    vec3 pe = sqrt( max( texture2D( inputBuffer, uv + vec2( texelSize.x, 0.0 ) ).rgb, 0.0 ) );
    vec3 pw = sqrt( max( texture2D( inputBuffer, uv - vec2( texelSize.x, 0.0 ) ).rgb, 0.0 ) );
    vec3 mn = min( pc, min( min( pn, ps ), min( pe, pw ) ) );
    vec3 mx = max( pc, max( max( pn, ps ), max( pe, pw ) ) );
    const vec3 Y = vec3( 0.2126, 0.7152, 0.0722 );
    float range = dot( mx - mn, Y );
    vec3 amp = sqrt( clamp( min( mn, 1.0 - mx ) / max( mx, vec3( 1e-4 ) ), 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.10, 0.22, range ) );
    float wgt = -dot( amp, Y ) / mix( 8.0, 5.0, uSharp ) * uSharp * 2.0;
    // luma only (no chroma fringes): the sharpened luma's change, carried back to linear on the pixel's own colour
    float lc = dot( pc, Y );
    float lo = clamp( ( lc + wgt * dot( pn + ps + pe + pw, Y ) ) / ( 1.0 + 4.0 * wgt ), 0.0, 1.0 );
    float gain = ( lo * lo ) / max( lc * lc, 1e-5 );
    if ( max( color.r, max( color.g, color.b ) ) <= 1.0 && lc > 0.01 ) color.rgb *= clamp( gain, 0.7, 1.3 );
  }
  outputColor = color;
}`),this.uniforms.set(`uSharp`,new T(t))}set sharp(e){let t=this.uniforms.get(`uSharp`);t&&(t.value=e)}},hu=class extends Je{depth=null;draw;cam;constructor(e,t){super(`VfxPass`),this.draw=e,this.cam=t,this.needsSwap=!1,this.needsDepthTexture=!0}setDepthTexture(e){this.depth=e}pre=null;render(e,t){let n=!1;for(let e of ou.uLiftA.value)if(e.w>0){n=!0;break}if(au.uLiftPreOn.value=0,n){let n=t.width,r=t.height;this.pre?(this.pre.width!==n||this.pre.height!==r)&&this.pre.setSize(n,r):this.pre=new ne(n,r,{type:D,depthBuffer:!1,minFilter:Se,magFilter:Se}),e.initRenderTarget(this.pre),e.initRenderTarget(t);let i=e.getContext(),a=e.properties,o=a.get(t).__webglFramebuffer,s=a.get(this.pre).__webglFramebuffer;o&&s&&typeof i.blitFramebuffer==`function`&&(e.state.bindFramebuffer(i.READ_FRAMEBUFFER,o),e.state.bindFramebuffer(i.DRAW_FRAMEBUFFER,s),i.blitFramebuffer(0,0,n,r,0,0,n,r,i.COLOR_BUFFER_BIT,i.NEAREST),e.state.bindFramebuffer(i.READ_FRAMEBUFFER,null),e.state.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),au.uLiftPre.value=this.pre.texture,au.uLiftPreOn.value=1)}this.draw(e,t,this.depth,this.cam())}dispose(){this.releaseTargets(),super.dispose()}releaseTargets(){this.pre?.dispose(),this.pre=null,au.uLiftPre.value=null}},gu=class{composer;scene;camera;overlay;vfx;lutTex;identity;lutEffect=null;quality={ao:1,bloom:!0,aa:`smaa`,tier:`high`};aoPass=null;renderPass=null;gradePass=null;aaPass=null;aaEffect=null;sharpOverride=null;setCloud(e){Cn({tier:e??(this.quality.tier===`low`?0:1)})}setSharpen(e){this.sharpOverride=e,this.aaEffect&&(this.aaEffect.sharp=e??pu[this.quality.tier])}builtOrtho=!1;aoLow=!1;width=1;height=1;renderer;constructor(e,t,n,r,i){this.renderer=e,this.scene=t,this.camera=n,this.composer=new nt(e,{frameBufferType:D,depthBuffer:!0,stencilBuffer:!1,multisampling:0}),this.overlay=new iu(r),this.vfx=i?new hu(i,()=>this.camera):null,this.identity=st.createNeutral(33),this.lutTex=this.identity,pn(this.identity),this.build()}releaseMatchTargets(){this.vfx?.releaseTargets()}setScene(e,t){this.scene=e,this.camera=t;let n=t.isOrthographicCamera===!0;if(!this.renderPass||n!==this.builtOrtho){this.build();return}if(this.renderPass.mainScene=e,this.renderPass.mainCamera=t,this.aoPass){let n=this.aoPass;n.scene=e,n.camera=t,n.firstFrame?.()}this.gradePass&&(this.gradePass.mainCamera=t),this.aaPass&&(this.aaPass.mainCamera=t)}setLUT(e){let t=e??this.identity;t!==this.lutTex&&pn(t),this.lutTex=t,this.lutEffect&&(this.lutEffect.lut=this.lutTex)}bloomStandIn=null;setBloomStandIn(e){this.bloomStandIn=e,this.applyStandIn()}applyStandIn(){let e=!this.quality.bloom;au.uLiftGain.value=this.bloomStandIn?.lift??(e?su:1),au.uLiftFxGain.value=this.bloomStandIn?.fx??(e?cu:1)}setQuality(e){let t=e.ao===this.quality.ao&&e.bloom===this.quality.bloom&&e.aa===this.quality.aa&&e.tier===this.quality.tier;this.quality={...e},t||this.build()}setAoLow(e){e!==this.aoLow&&(this.aoLow=e,this.aoPass&&(this.aoPass.configuration.denoiseIterations=e?1:2))}setSize(e,t){this.width=e,this.height=t,this.composer.setSize(e,t,!1)}render(e){this.composer.render(e)}disposeBuilt(){for(let e of this.composer.passes)e!==this.overlay&&e!==this.vfx&&_u(e);this.renderPass=null,this.gradePass=null,this.aaPass=null,this.aaEffect=null,this.aoPass=null,this.lutEffect=null}build(){let e=this.composer;this.disposeBuilt(),e.removeAllPasses();let t=this.quality;if(Cn({tier:t.tier===`low`?0:1}),this.builtOrtho=this.camera.isOrthographicCamera===!0,this.renderPass=new Ye(this.scene,this.camera),e.addPass(this.renderPass),t.ao>0){let n=new ot(this.scene,this.camera,this.width,this.height);n.autoDetectTransparency=!1,n.configuration.transparencyAware=!1,n.setQualityMode(t.ao===2?`High`:`Medium`),n.configuration.denoiseIterations=this.aoLow?1:2,n.configuration.halfRes=!0,n.configuration.aoRadius=1.4,n.configuration.distanceFalloff=1,n.configuration.intensity=2.5,n.configuration.color=new R().setStyle(`#1A1C22`),n.configuration.gammaCorrection=!1,e.addPass(n),this.aoPass=n}this.vfx&&e.addPass(this.vfx);let n=[];if(oo.distortAllowed=t.tier!==`low`,oo.distortAllowed&&n.push(new fu),t.bloom&&n.push(new it({mipmapBlur:!0,luminanceThreshold:1,luminanceSmoothing:.05,intensity:.6,radius:.7,levels:t.tier===`medium`?6:8})),this.applyStandIn(),n.push(new uu(()=>this.camera)),n.push(new Ze({mode:Xe.NEUTRAL})),this.lutEffect=new V(this.lutTex,{tetrahedralInterpolation:t.tier===`ultra`||t.tier===`high`}),n.push(this.lutEffect),n.push(new du),n.push(new Ke({offset:.35,darkness:.25})),this.gradePass=new at(this.camera,...n),e.addPass(this.gradePass),e.addPass(this.overlay),t.aa===`off`)e.addPass(new Qe);else{let n=t.tier===`ultra`?et.ULTRA:t.tier===`high`?et.HIGH:et.MEDIUM;this.aaEffect=new mu(n,this.sharpOverride??pu[t.tier]),this.aaPass=new at(this.camera,this.aaEffect),e.addPass(this.aaPass)}}dispose(){this.composer.dispose(),this.identity.dispose()}};function _u(e){e.dispose();for(let t of Object.values(e)){let e=t;e&&typeof e==`object`&&e._mesh&&typeof e.dispose==`function`&&e.dispose()}}var vu=new B,yu=.5,bu=3;function xu(e,t,n,r,i,a,o){let s=o?.filter,c=Math.max(0,o?.slop??0),l=()=>(vu.x*.5+.5)*t,u=()=>(-vu.y*.5+.5)*n,d=null,f=1/0,p=-1/0,m=null,h=1/0,g=-1/0,_=null,v=1/0,y=-1/0;for(let t of r){let n=t.view;if(s&&!s(n)||(vu.set(t.x,t.h,t.y).project(e),vu.z>1))continue;let r=l(),o=u();vu.set(t.x,t.h+t.artHeight,t.y).project(e);let b=l(),x=u(),S=n.radius+.15,C=n.radius+.22;vu.set(t.x+S,t.h,t.y).project(e);let w=Math.max(16,Math.abs(l()-r));vu.set(t.x+n.radius*yu,t.h,t.y).project(e);let T=Math.abs(l()-r);vu.set(t.x,t.h,t.y+C).project(e);let E=u();vu.set(t.x,t.h,t.y-C).project(e);let D=u(),O=Math.min(x,o-24)-6,ee=Math.max(o+w*.6,E,D),k=o-x,te=k>1e-6?Math.min(1,Math.max(0,(o-a)/k)):0,A=Math.abs(i-(r+(b-r)*te)),j=Math.max(0,A-w),ne=a<O?O-a:a>ee?a-ee:0;if(j===0&&ne===0){let e=A+(a<x?x-a:a>o?a-o:0)*.5;if((e<f-1e-6||Math.abs(e-f)<=1e-6&&(o>p||o===p&&d!==null&&t.id<d))&&(f=e,d=t.id,p=o),A<=T&&a>=x-4&&a<=o){let n=o>g+bu,r=Math.abs(o-g)<=bu;(n||r&&(e<h-1e-6||Math.abs(e-h)<=1e-6&&m!==null&&t.id<m))&&(m=t.id,h=e,g=o)}}else if(c>0&&d===null){let e=Math.hypot(j,ne);e<=c&&(e<v-1e-6||Math.abs(e-v)<=1e-6&&(o>y||o===y&&_!==null&&t.id<_))&&(v=e,_=t.id,y=o)}}return m??d??_}var Su=1e7;function Cu(e){let t=e.slice().sort((e,t)=>e-t),n=e=>t.length?t[Math.min(t.length-1,Math.floor(t.length*e))]:0,r=t.reduce((e,t)=>e+t,0);return{frames:t.length,meanMs:t.length?r/t.length:0,p50Ms:n(.5),p95Ms:n(.95),slowShare:t.length?t.filter(e=>e>25).length/t.length:0}}function wu(e){return e.p95Ms<=18||e.p95Ms<=20&&e.meanMs<=17.2&&e.slowShare<=.01}function Tu(e){let t=e[e.length-1];return!t||e.length>=3||t.frames<30?!1:!e.some(wu)&&t.p50Ms<=17.5}function Eu(e,t){let n=e.filter(e=>e.frames>=30),r=t>Su;if(!n.length)return{preset:r?`medium`:`high`,best:e[0]??null,capped:r};let i=n.find(wu)??n.reduce((e,t)=>t.p95Ms<e.p95Ms?t:e),a=wu(i)?`high`:i.p95Ms<=26?`medium`:`low`;return a===`high`&&r?{preset:`medium`,best:i,capped:!0}:{preset:a,best:i,capped:!1}}var Du={low:{renderScale:.75,shadows:1,ao:0,bloom:!1,antialias:`off`,particles:0,scatter:0,maxDpr:1},medium:{renderScale:.9,shadows:2,ao:1,bloom:!0,antialias:`smaa`,particles:1,scatter:1,maxDpr:1},high:{renderScale:1,shadows:2,ao:1,bloom:!0,antialias:`smaa`,particles:2,scatter:2,maxDpr:1},ultra:{renderScale:1,shadows:3,ao:2,bloom:!0,antialias:`smaa`,particles:2,scatter:2,maxDpr:2}};function Ou(e,t){return{fpsCap:0,fullscreen:!1,ambientEffects:!0,...t,...Du[e],preset:e}}function ku(e){return e.preset===`custom`?e.shadows>=3||e.ao>=2?`ultra`:e.ao===0&&!e.bloom?`low`:e.particles>=2?`high`:`medium`:e.preset}var Au=(e,t,n)=>Math.max(t,Math.min(n,Math.round(Number.isFinite(e)?e:t)));function ju(e){let t=ku(e),n=Au(e.particles,0,2);return{tier:t,renderScale:Math.max(.5,Math.min(2,Number.isFinite(e.renderScale)?e.renderScale:1)),maxDpr:Math.max(1,Math.min(3,Number.isFinite(e.maxDpr)?e.maxDpr:1)),shadows:Au(e.shadows,0,3),ao:Au(e.ao,0,2),bloom:!!e.bloom,aa:e.antialias===`msaa`?`smaa`:e.antialias,particles:n,scatter:Au(e.scatter,0,2),fpsCap:e.fpsCap||0,particleBudget:t===`ultra`?3e3:t===`high`?2e3:t===`medium`?900:450,particleDensity:n===2?1:n===1?.6:.35,flashLights:t===`low`?0:t===`medium`?2:t===`ultra`?6:4,secondaryDensity:t===`ultra`&&n===2?1.3:1}}var Mu=3,Nu=32,Pu=2,Fu=4,Iu=1.033,Lu=3,Ru=class{enabled=!0;base=1;floor=.8;current=1;acc=0;frames=0;sum=0;cpuSum=0;gpuSum=0;gpuN=0;gpuDropped=0;slow=0;drift=0;onTarget=0;probeFrom=-1;probeLeft=0;probeWait=Mu;targetMs=1e3/60;bound=``;timerBad=0;timerGood=0;get timerTrusted(){return!(this.timerBad>=2&&this.timerBad>this.timerGood)}configure(e,t){this.base=e,this.floor=Math.min(e,.8),this.current=e,this.targetMs=1e3/(t>0?Math.min(t,144):60),this.reset(),this.slow=this.drift=this.onTarget=this.probeLeft=0,this.probeFrom=-1,this.probeWait=Mu,this.bound=``}reset(){this.acc=this.frames=this.sum=this.cpuSum=this.gpuSum=this.gpuN=this.gpuDropped=0}get scale(){return this.enabled?this.current:this.base}sample(e,t=0,n=null){if(!this.enabled||!(e>0)||e>250||(this.acc+=e,this.frames++,this.sum+=e,this.cpuSum+=Math.max(0,t),n!==null&&n>=0&&(n<=e?(this.gpuSum+=n,this.gpuN++):this.gpuDropped++),this.acc<1e3))return!1;let r=this.sum/this.frames,i=this.cpuSum/this.frames,a=this.gpuN>0?this.gpuSum/this.gpuN:null,o=this.gpuN+this.gpuDropped>0;o&&(this.gpuDropped>this.gpuN?this.timerBad++:this.timerGood++);let s=this.timerTrusted;this.reset();let c=this.targetMs,l=s&&o?a!==null&&a>=c*.85:i<c*.6,u=r>c*1.12,d=!u&&l&&r>c*Iu,f=!u&&!d||!l&&s&&a!==null&&a<c*.6;if(this.bound=u?l?`gpu`:`cpu`:d?`gpu`:``,this.probeFrom>=0)return u&&l||d?(this.current=this.probeFrom,this.probeFrom=-1,this.probeLeft=0,this.probeWait=Math.min(Nu,this.probeWait*Fu),this.slow=this.drift=this.onTarget=0,!0):!f||--this.probeLeft>0?!1:(this.probeFrom=-1,this.probeWait=Mu,this.probeUp());if(u&&l||d){this.onTarget=0,this.drift++,u?this.slow++:this.slow=0;let e=u&&(this.slow>=2||r>c*1.4);return(e||this.drift>=Lu)&&this.current>this.floor+.001?(e||(this.probeWait=Math.min(Nu,this.probeWait*Fu)),this.current=Math.max(this.floor,Math.round((this.current-.05)*100)/100),this.slow=this.drift=0,!0):!1}return this.slow=this.drift=0,f?this.current<this.base-.001&&++this.onTarget>=this.probeWait&&this.probeUp():!1}probeUp(){return this.onTarget=0,this.current>=this.base-.001?!1:(this.probeFrom=this.current,this.probeLeft=Pu,this.current=Math.min(this.base,Math.round((this.current+.05)*100)/100),!0)}},zu=class{gl;ext;pool=[];pending=[];active=null;discard=0;last=null;constructor(e){this.gl=e,this.ext=e.getExtension(`EXT_disjoint_timer_query_webgl2`)??null}get available(){return this.ext!==null}begin(){if(!this.ext||this.dead||this.active||this.pending.length>=4)return;let e=this.pool.pop()??this.gl.createQuery();e&&(this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,e),this.active=e)}end(){this.ext&&!this.dead&&this.active&&(this.gl.endQuery(this.ext.TIME_ELAPSED_EXT),this.pending.push(this.active),this.active=null)}poll(){let e=this.gl,t=this.ext;if(!t||this.dead)return null;for(;this.pending.length;){let n=this.pending[0];if(!e.getQueryParameter(n,e.QUERY_RESULT_AVAILABLE))break;let r=e.getQueryParameter(n,e.QUERY_RESULT),i=!!e.getParameter(t.GPU_DISJOINT_EXT);if(this.pending.shift(),this.pool.push(n),this.discard>0){this.discard--;continue}this.last=i?null:r/1e6}return this.last}clear(){this.last=null,this.discard=this.pending.length}abandon(){this.pool.length=0,this.pending.length=0,this.active=null,this.last=null,this.discard=0,this.dead=!0}dead=!1;dispose(){if(!this.dead){for(let e of[...this.pool,...this.pending])this.gl.deleteQuery(e);this.active&&this.gl.deleteQuery(this.active),this.pool.length=0,this.pending.length=0,this.active=null}}},Bu={weapon:[`weapon`,`weapon_r`,`hand_r`],weapon_r:[`weapon_r`,`weapon`,`hand_r`],weapon_l:[`weapon_l`,`hand_l`,`weapon`],weapon_tip:[`weapon_tip`,`blade_tip`,`weapon`,`weapon_r`,`hand_r`],blade_tip:[`blade_tip`,`weapon_tip`,`weapon`,`weapon_r`,`hand_r`],hand_r:[`hand_r`,`weapon_r`,`weapon`],hand_l:[`hand_l`,`weapon_l`]},Vu=class{bones=new Map;cache=new Map;actor;clock;constructor(e,t,n){for(let t of e.fighters)this.bones.set(t.id,t.art.sockets??{});this.actor=t,this.clock=n}socketPos(e,t,n){let r=this.actor(e);if(!r||r.leaving>=0)return!1;switch(t){case`top`:return n.set(r.x,r.h+r.artHeight,r.y),!0;case`base`:return n.set(r.x,r.h+.04,r.y),!0;case`ground`:return n.set(r.x,.02,r.y),!0;case`origin`:return n.set(r.x,r.h,r.y),!0}let i=this.bones.get(r.def),a=i?(Bu[t]??[t]).find(e=>e in i):void 0;if(!a)return n.set(r.x,r.h+r.artHeight*(t===`head`?.88:.6),r.y),!0;let o=`${e}:${a}`,s=this.clock(),c=this.cache.get(o);return c&&c.t===s?(n.set(c.x,c.y,c.z),!0):(r.socket(a,n),c?(c.t=s,c.x=n.x,c.y=n.y,c.z=n.z):this.cache.set(o,{t:s,x:n.x,y:n.y,z:n.z}),this.cache.size>2048&&this.cache.clear(),!0)}},Hu=2048,Uu=256,J=(e,t=1,n=!1,r=!1)=>({cell:e,frames:t,variants:n,stretch:r}),Wu={ink_puff:J(0,8),light_puff:J(8,8),dust_puff:J(16,8),splash:J(24,8),spark:J(32,1,!1,!0),glow:J(33),shard:J(34,4,!0),ring:J(38),streak:J(39,1,!1,!0),petal:J(40),ember:J(41),drop:J(42),rune:J(43),crack:J(44,2,!0),mote:J(46),flare:J(47),wisp:J(48,2,!0),chip:J(50,4,!0),glint:J(54),ring_thin:J(55),frost:J(56),caustic:J(57),scorch:J(58),splat:J(59),smoke:J(0,8),dust:J(16,8),shard_set:J(34,4,!0)};Object.keys(Wu);function Gu(e){return typeof e==`string`&&Wu[e]||Wu.glow}var Ku=`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,qu=`
precision highp float;
uniform float uMode;
uniform vec2 uSize;
varying vec2 vUv;
#define PI 3.14159265
#define TAU 6.2831853

float hash11( float p ) { p = fract( p * 0.1031 ); p *= p + 33.33; p *= p + p; return fract( p ); }
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec2 hash22( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.xx + p3.yz ) * p3.zy ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1, 0 ) ), u.x ), mix( hash12( i + vec2( 0, 1 ) ), hash12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float fbm( vec2 p ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 5; i ++ ) { s += a * vnoise( p ); p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p + 7.1; a *= 0.5; } return s / 0.96875; }
// periodic (tileable) value noise / fbm with period P
float pnoise( vec2 p, vec2 P ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( mod( i, P ) ), b = hash12( mod( i + vec2( 1, 0 ), P ) ), c = hash12( mod( i + vec2( 0, 1 ), P ) ), d = hash12( mod( i + vec2( 1, 1 ), P ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float pfbm( vec2 p, vec2 P ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 5; i ++ ) { s += a * pnoise( p, P ); p *= 2.0; P *= 2.0; a *= 0.5; } return s / 0.96875; }
vec2 voronoi( vec2 p, vec2 P, bool periodic ) {
  vec2 i = floor( p ), f = fract( p ); float d1 = 8.0, d2 = 8.0;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 id = periodic ? mod( i + g, P ) : i + g;
    vec2 r = g + hash22( id ) * 0.85 + 0.075 - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
  }
  return vec2( sqrt( d1 ), sqrt( d2 ) );
}
vec3 vorCell( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); float d1 = 8.0; vec2 best = vec2( 0.0 );
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 r = g + hash22( i + g ) * 0.85 + 0.075 - f;
    float d = dot( r, r );
    if ( d < d1 ) { d1 = d; best = i + g; }
  }
  return vec3( sqrt( d1 ), hash12( best * 1.37 ), hash12( best * 3.11 + 0.5 ) );
}
float cellFade( vec2 q ) { return 1.0 - smoothstep( 0.86, 0.985, max( abs( q.x ), abs( q.y ) ) ); }

// ── billowing puff density (ink / dust): lobes + domain-warped fbm, evolving with p ─────────────
float puffDensity( vec2 q, float p, float seed ) {
  float d = -1.0;
  for ( int i = 0; i < 7; i ++ ) {
    float fi = float( i );
    float a = fi * 2.39996 + seed * TAU;
    float rr = i == 0 ? 0.0 : ( 0.2 + 0.2 * hash11( seed * 13.0 + fi ) ) * ( 0.8 + 0.6 * p );
    vec2 c = vec2( cos( a ), sin( a ) ) * rr;
    float rad = ( i == 0 ? 0.4 : 0.22 + 0.16 * hash11( seed * 7.0 + fi * 3.1 ) ) * ( 0.78 + 0.4 * p );
    float l = 1.0 - length( q - c ) / rad;
    // smooth union of the lobes
    float h = clamp( 0.5 + 0.5 * ( l - d ) / 0.25, 0.0, 1.0 );
    d = mix( d, l, h ) + 0.25 * h * ( 1.0 - h );
  }
  vec2 w = q * 1.7 + vec2( fbm( q * 2.3 + seed * 11.0 + p * 0.7 ), fbm( q * 2.3 + seed * 17.0 - p * 0.7 ) ) * ( 0.7 + 0.7 * p );
  float n = fbm( w * 2.0 + seed * 3.0 );
  d += ( n - 0.5 ) * ( 0.95 + 0.5 * p );
  d -= p * p * 0.45 * fbm( q * 4.5 + seed * 23.0 );
  return d;
}

vec4 inkPuff( vec2 q, float f ) {
  float p = f / 7.0, seed = 0.37;
  float d = puffDensity( q, p, seed );
  vec2 L = normalize( vec2( -0.55, 0.85 ) );
  float dl = puffDensity( q + L * 0.08, p, seed );
  float lit = smoothstep( 0.0, 1.0, 0.5 + ( d - dl ) * 2.8 );
  float streak = fbm( vec2( q.x * 1.6 + q.y * 3.2, q.y * 8.5 - q.x ) + seed * 5.0 );
  float shade = ( 0.42 + 0.58 * lit ) * ( 0.82 + 0.36 * streak );
  float cov = smoothstep( 0.0, 0.26, d );
  float edge = smoothstep( 0.0, 0.07, d ) * ( 1.0 - smoothstep( 0.07, 0.24, d ) );
  float rim = edge * ( 0.3 + 0.7 * smoothstep( -0.3, 0.7, dot( normalize( q + 1e-4 ), L ) ) ) + edge * lit * 0.4;
  float erode = clamp( 0.2 + 0.8 * smoothstep( 0.0, 0.85, d ) * ( 0.55 + 0.45 * fbm( q * 5.0 + 9.0 ) ), 0.0, 1.0 );
  return vec4( clamp( shade, 0.0, 1.0 ), clamp( rim, 0.0, 1.0 ), erode, cov * cellFade( q ) );
}

vec4 dustPuff( vec2 q, float f ) {
  float p = f / 7.0;
  float d = puffDensity( q * 1.08, p, 0.71 );
  float cov = smoothstep( -0.08, 0.5, d ) * 0.8;
  float grain = vnoise( q * 38.0 ) * 0.5 + fbm( q * 7.0 + 3.0 ) * 0.5;
  float shade = 0.72 + 0.28 * fbm( q * 5.0 + p );
  float erode = clamp( 0.2 + 0.8 * smoothstep( -0.05, 0.7, d ) * ( 0.5 + 0.5 * grain ), 0.0, 1.0 );
  return vec4( shade, 0.0, erode, cov * ( 0.75 + 0.25 * grain ) * cellFade( q ) );
}

vec4 lightPuff( vec2 q, float f ) {
  float p = f / 7.0;
  float r = length( q ), a = atan( q.y, q.x );
  float core = exp( -r * r * ( 10.0 - 6.0 * p ) );
  float s = vnoise( vec2( a * 2.8649 + 3.0, p * 0.5 ) ) * 0.6 + vnoise( vec2( a * 6.3662 + 11.0, p ) ) * 0.4;
  float rays = pow( max( s, 0.0 ), 3.0 ) * exp( -r * ( 3.4 - 1.4 * p ) ) * 1.6;
  vec2 w = q * 2.4 + vec2( fbm( q * 3.0 + p ), fbm( q * 3.0 + 5.0 - p ) ) * 0.8;
  float wisp = fbm( w * 1.7 ) * exp( -r * r * ( 3.2 - 1.6 * p ) );
  float cov = clamp( core + rays * 0.8 + wisp * ( 0.35 + 0.6 * p ), 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.72, 0.97, r ) );
  float bright = clamp( core * 1.3 + rays * 0.7 + wisp * 0.45, 0.0, 1.0 );
  float r0 = 0.22 + 0.6 * p;
  float ring = exp( -( ( r - r0 ) / 0.045 ) * ( ( r - r0 ) / 0.045 ) ) * ( 1.0 - p * 0.7 ) * ( 0.6 + 0.4 * vnoise( vec2( a * 4.0, 1.0 ) ) );
  float erode = clamp( 0.2 + 0.8 * clamp( core + wisp * 0.6 + rays * 0.3, 0.0, 1.0 ), 0.0, 1.0 );
  return vec4( bright, ring, erode, clamp( cov + ring * 0.5, 0.0, 1.0 ) * cellFade( q ) );
}

vec4 splash( vec2 q, float f ) {
  float p = clamp( f / 7.0, 0.0, 1.0 );
  float r = length( q ), a = atan( q.y, q.x );
  float N = 13.0;
  float sector = floor( ( a + PI ) / TAU * N );
  float h = hash11( sector * 7.13 + 1.3 );
  float centre = ( sector + 0.5 ) / N * TAU - PI;
  float da = clamp( abs( a - centre ) * N / TAU * 2.0, 0.0, 1.0 );
  float grow = smoothstep( 0.0, 0.55, p );
  float blobR = 0.16 + 0.2 * sqrt( p );
  float spike = ( 0.1 + 0.55 * h * h ) * grow;
  float allowed = blobR + spike * pow( clamp( 1.0 - da, 0.0, 1.0 ), 2.2 ) + ( fbm( q * 6.0 + 2.0 ) - 0.5 ) * 0.09;
  float sd = r - allowed;
  float m = 1.0 - smoothstep( -0.012, 0.012, sd );
  float rimBand = smoothstep( -0.06, -0.01, sd ) * m;
  for ( int i = 0; i < 14; i ++ ) {
    float fi = float( i );
    float an = hash11( fi * 3.7 + 0.2 ) * TAU;
    float dist = blobR + 0.12 + ( 0.2 + 0.45 * hash11( fi * 5.3 + 0.9 ) ) * grow;
    float rad = ( 0.018 + 0.045 * hash11( fi * 9.1 + 0.4 ) ) * ( 1.0 - 0.35 * p );
    float dd = length( q - vec2( cos( an ), sin( an ) ) * dist ) - rad;
    float dm = 1.0 - smoothstep( -0.01, 0.01, dd );
    m = max( m, dm );
    rimBand = max( rimBand, smoothstep( -0.03, -0.005, dd ) * dm );
  }
  float shade = 0.55 + 0.45 * ( 1.0 - clamp( r * 1.2, 0.0, 1.0 ) ) * ( 0.8 + 0.2 * fbm( q * 9.0 ) );
  float erode = clamp( 0.2 + 0.8 * ( 1.0 - clamp( r, 0.0, 1.0 ) ) * ( 0.6 + 0.4 * fbm( q * 5.0 + 4.0 ) ), 0.0, 1.0 );
  return vec4( shade, rimBand, erode, m * cellFade( q ) );
}

// faceted convex polygon (glass shards, stone chips): R facet value, G edges/ridges, A hard coverage
vec4 facetPoly( vec2 q, float seed, float sx, float sy, float rot ) {
  float c = cos( rot ), s = sin( rot );
  q = mat2( c, -s, s, c ) * q;
  const int K = 7;
  vec2 v[ 7 ];
  for ( int i = 0; i < K; i ++ ) {
    float fi = float( i );
    float th = ( fi + 0.15 + 0.55 * hash11( seed * 17.0 + fi ) ) / float( K ) * TAU;
    float rr = 0.72 + 0.28 * hash11( seed * 29.0 + fi * 1.7 );
    v[ i ] = vec2( cos( th ) * sx, sin( th ) * sy ) * rr;
  }
  float inside = 1.0, dmin = 8.0;
  for ( int i = 0; i < K; i ++ ) {
    vec2 a = v[ i ], b = v[ i == K - 1 ? 0 : i + 1 ];
    vec2 e = b - a;
    float cr = e.x * ( q.y - a.y ) - e.y * ( q.x - a.x );
    float dd = cr / length( e );
    dmin = min( dmin, dd );
  }
  float cov = smoothstep( -0.006, 0.006, dmin );
  vec2 ridge = vec2( ( hash11( seed * 3.0 ) - 0.5 ) * sx * 0.5, ( hash11( seed * 5.0 ) - 0.5 ) * sy * 0.4 );
  vec2 rq = q - ridge;
  float ang = atan( rq.y, rq.x );
  float facet = 0.0, ridgeLine = 8.0;
  for ( int i = 0; i < K; i ++ ) {
    vec2 rv = v[ i ] - ridge;
    float va = atan( rv.y, rv.x );
    float da = abs( mod( ang - va + PI, TAU ) - PI );
    ridgeLine = min( ridgeLine, da * length( rq ) );
  }
  float sector = floor( ( ang + PI ) / TAU * float( K ) + hash11( seed ) );
  facet = 0.45 + 0.55 * hash11( sector * 3.3 + seed * 11.0 );
  facet *= 0.85 + 0.15 * smoothstep( -0.6, 0.8, dot( normalize( rq + 1e-4 ), normalize( vec2( -0.5, 0.86 ) ) ) );
  float edges = max( 1.0 - smoothstep( 0.0, 0.045, dmin ), 1.0 - smoothstep( 0.0, 0.018, ridgeLine ) ) ;
  return vec4( facet, edges * cov, 1.0, cov );
}

vec4 crack( vec2 q, float seed ) {
  float r = length( q );
  vec2 vv = voronoi( q * 3.4 + seed * 7.0, vec2( 0.0 ), false );
  float web = 1.0 - smoothstep( 0.0, 0.06, vv.y - vv.x );
  float radial = 1.0 - smoothstep( 0.25, 0.92, r + ( fbm( q * 3.0 + seed ) - 0.5 ) * 0.3 );
  float br = 0.0;
  for ( int k = 0; k < 6; k ++ ) {
    float fk = float( k );
    float an = ( fk + hash11( seed * 9.0 + fk ) * 0.6 ) / 6.0 * TAU;
    vec2 dir = vec2( cos( an ), sin( an ) );
    float along = dot( q, dir );
    vec2 perp = vec2( -dir.y, dir.x );
    float wob = ( fbm( vec2( along * 4.0, fk * 3.0 + seed ) ) - 0.5 ) * 0.22 * along;
    float across = abs( dot( q, perp ) - wob );
    float len = 0.55 + 0.35 * hash11( seed * 4.0 + fk * 2.0 );
    float w = 0.022 * ( 1.0 - clamp( along / len, 0.0, 1.0 ) ) + 0.004;
    br = max( br, ( 1.0 - smoothstep( w * 0.4, w, across ) ) * step( 0.0, along ) * ( 1.0 - smoothstep( len * 0.85, len, along ) ) );
  }
  float a = clamp( max( web * radial * 0.85, br ), 0.0, 1.0 );
  float centre = exp( -r * r * 30.0 ) * 0.6;
  return vec4( 1.0, a, clamp( 1.0 - r, 0.2, 1.0 ), clamp( a + centre, 0.0, 1.0 ) * cellFade( q ) );
}

vec4 wisp( vec2 q, float seed ) {
  float x = q.x;
  float k = 1.4 + seed * 0.8;
  float y0 = 0.42 * sin( x * k + seed * 3.0 ) * ( 0.6 + 0.4 * x );
  float dy = 0.42 * k * cos( x * k + seed * 3.0 );
  float d = abs( q.y - y0 ) / sqrt( 1.0 + dy * dy );
  float t = clamp( ( x + 0.92 ) / 1.84, 0.0, 1.0 );
  float w = 0.13 * pow( max( sin( t * PI ), 0.0 ), 0.7 ) * ( 0.55 + 0.45 * t );
  float n = fbm( vec2( x * 6.0, q.y * 6.0 ) + seed * 9.0 );
  float m = 1.0 - smoothstep( w * 0.55, w, d + ( n - 0.5 ) * 0.05 );
  float rim = smoothstep( w * 0.35, w * 0.8, d ) * m;
  return vec4( 0.75 + 0.25 * n, rim, 0.2 + 0.8 * t, m * step( abs( x ), 0.95 ) );
}

vec4 cellFn( float cell, vec2 q ) {
  float r = length( q ), a = atan( q.y, q.x );
  if ( cell < 8.0 ) return inkPuff( q, cell );
  if ( cell < 16.0 ) return lightPuff( q, cell - 8.0 );
  if ( cell < 24.0 ) return dustPuff( q, cell - 16.0 );
  if ( cell < 32.0 ) return splash( q, cell - 24.0 );
  if ( cell < 33.0 ) { // spark: a hot needle
    float ax = abs( q.x );
    float w = 0.09 * ( 1.0 - ax ) + 0.006;
    float m = exp( -q.y * q.y / ( w * w ) ) * ( 1.0 - smoothstep( 0.8, 0.97, ax ) );
    float core = exp( -( q.x * q.x * 6.0 + q.y * q.y * 260.0 ) );
    return vec4( clamp( 0.6 + core, 0.0, 1.0 ), 0.0, 0.2 + 0.8 * ( 1.0 - ax ), clamp( m + core, 0.0, 1.0 ) );
  }
  if ( cell < 34.0 ) { float g = exp( -r * r * 5.5 ) * ( 1.0 - smoothstep( 0.8, 0.98, r ) ); return vec4( 1.0, 0.0, 0.2 + 0.8 * g, g ); }
  if ( cell < 38.0 ) { float v = cell - 34.0; return facetPoly( q * 1.08, 0.31 + v * 0.17, 0.32 + 0.06 * v, 0.88, v * 0.4 - 0.3 ); }
  if ( cell < 39.0 ) {
    float band = exp( -( ( r - 0.76 ) / 0.075 ) * ( ( r - 0.76 ) / 0.075 ) );
    float inner = exp( -( ( r - 0.7 ) / 0.22 ) * ( ( r - 0.7 ) / 0.22 ) ) * 0.25;
    float n = 0.7 + 0.3 * fbm( vec2( a * 2.0, r * 6.0 ) + 3.0 );
    return vec4( 1.0, band, 0.2 + 0.8 * n, clamp( ( band + inner ) * n, 0.0, 1.0 ) * cellFade( q ) );
  }
  if ( cell < 40.0 ) { // streak: brighter toward +x (the head)
    float m = exp( -q.y * q.y * 70.0 ) * smoothstep( -0.98, -0.1, q.x ) * ( 1.0 - smoothstep( 0.72, 0.98, q.x ) );
    return vec4( 0.6 + 0.4 * smoothstep( -0.6, 0.8, q.x ), 0.0, 0.2 + 0.8 * smoothstep( -1.0, 0.8, q.x ), m );
  }
  if ( cell < 41.0 ) { // sun-petal
    float y = q.y;
    float halfW = 0.42 * pow( max( 0.0, 1.0 - y * y ), 0.9 ) * ( 1.0 - 0.25 * y );
    float m = 1.0 - smoothstep( halfW - 0.02, halfW + 0.01, abs( q.x ) );
    m *= 1.0 - smoothstep( 0.9, 0.95, abs( y ) );
    float vein = 1.0 - smoothstep( 0.0, 0.03, abs( q.x ) );
    return vec4( 0.75 + 0.25 * ( 1.0 - abs( q.x ) / max( halfW, 0.01 ) ) - vein * 0.2, smoothstep( halfW - 0.08, halfW, abs( q.x ) ) * m, 0.2 + 0.8 * ( 1.0 - abs( y ) ), m );
  }
  if ( cell < 42.0 ) { // ember: a hot ragged coal
    float rr = r + ( fbm( q * 5.0 + 2.0 ) - 0.5 ) * 0.35;
    float m = 1.0 - smoothstep( 0.32, 0.5, rr );
    float core = exp( -r * r * 14.0 );
    return vec4( clamp( 0.55 + core, 0.0, 1.0 ), 0.0, 0.2 + 0.8 * ( 1.0 - clamp( rr * 1.6, 0.0, 1.0 ) ), clamp( m * 0.9 + core * 0.4, 0.0, 1.0 ) );
  }
  if ( cell < 43.0 ) { // drop
    vec2 p = q - vec2( 0.0, -0.25 );
    float body = length( p ) - 0.45;
    float tip = max( abs( q.x ) - 0.45 * ( 1.0 - ( q.y + 0.25 ) / 1.17 ), q.y - 0.92 );
    float sd = min( body, q.y > -0.25 ? tip : 8.0 );
    float m = 1.0 - smoothstep( -0.01, 0.01, sd );
    return vec4( 0.65 + 0.35 * ( 1.0 - length( p - vec2( -0.15, 0.15 ) ) ), smoothstep( -0.06, -0.01, sd ) * m, 0.2 + 0.8 * ( 1.0 - r ), m );
  }
  if ( cell < 44.0 ) { // rune → carved hour ticks on a dial ring
    float ringM = 1.0 - smoothstep( 0.02, 0.035, abs( r - 0.86 ) );
    float sec = mod( a + TAU, TAU / 12.0 ) - TAU / 24.0;
    float idx = floor( ( a + PI ) / ( TAU / 12.0 ) );
    float big = mod( idx, 3.0 ) < 0.5 ? 1.0 : 0.0;
    float len = big > 0.5 ? 0.3 : 0.16;
    float tick = ( 1.0 - smoothstep( 0.012, 0.022 + big * 0.012, abs( sec ) * r ) ) * step( 0.84 - len, r ) * step( r, 0.86 );
    float m = max( ringM, tick );
    return vec4( 1.0, m, 0.6, m );
  }
  if ( cell < 46.0 ) return crack( q, 0.23 + ( cell - 44.0 ) * 0.41 );
  if ( cell < 47.0 ) { float core = exp( -r * r * 60.0 ), halo = exp( -r * r * 7.0 ) * 0.45; float m = clamp( core + halo, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.85, 0.98, r ) ); return vec4( 1.0, 0.0, 0.2 + 0.8 * core, m ); }
  if ( cell < 48.0 ) { // flare: a dawnglass glint, 4 long points + a soft core
    float sx = exp( -abs( q.y ) * 28.0 ) * exp( -abs( q.x ) * 2.6 );
    float sy = exp( -abs( q.x ) * 28.0 ) * exp( -abs( q.y ) * 2.6 );
    vec2 d = mat2( 0.7071, -0.7071, 0.7071, 0.7071 ) * q;
    float sd = ( exp( -abs( d.y ) * 40.0 ) * exp( -abs( d.x ) * 5.0 ) + exp( -abs( d.x ) * 40.0 ) * exp( -abs( d.y ) * 5.0 ) ) * 0.4;
    float core = exp( -r * r * 22.0 );
    float m = clamp( sx + sy + sd + core, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.86, 0.98, r ) );
    return vec4( 1.0, 0.0, 0.2 + 0.8 * clamp( core * 2.0, 0.0, 1.0 ), m );
  }
  if ( cell < 50.0 ) return wisp( q, 0.2 + ( cell - 48.0 ) * 0.55 );
  if ( cell < 54.0 ) { float v = cell - 50.0; vec4 c = facetPoly( q * 1.1, 0.77 + v * 0.13, 0.62, 0.7, v * 0.9 ); c.r = c.r * 0.8 + 0.1; return c; }
  if ( cell < 55.0 ) { // glint: small six-point star
    float st = pow( abs( cos( a * 3.0 ) ), 24.0 ) * exp( -r * 4.0 );
    float core = exp( -r * r * 40.0 );
    float m = clamp( st + core, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.8, 0.95, r ) );
    return vec4( 1.0, 0.0, 0.2 + 0.8 * core, m );
  }
  if ( cell < 56.0 ) { float m = 1.0 - smoothstep( 0.012, 0.03, abs( r - 0.88 ) ); return vec4( 1.0, m, 0.6, m ); }
  if ( cell < 57.0 ) { // frost: glass crystal facets
    vec3 vc = vorCell( q * 4.2 + 1.7 );
    vec2 vv = voronoi( q * 4.2 + 1.7, vec2( 0.0 ), false );
    float edge = 1.0 - smoothstep( 0.0, 0.07, vv.y - vv.x );
    float rad = 1.0 - smoothstep( 0.45, 0.95, r + ( fbm( q * 4.0 ) - 0.5 ) * 0.25 );
    float sparkle = step( 0.93, vc.z ) * exp( -vc.x * vc.x * 30.0 );
    return vec4( 0.55 + 0.45 * vc.y, clamp( edge + sparkle, 0.0, 1.0 ), clamp( 1.0 - r, 0.2, 1.0 ), clamp( ( 0.28 + 0.72 * edge ) * rad, 0.0, 1.0 ) * cellFade( q ) );
  }
  if ( cell < 58.0 ) { // caustic light pool
    vec2 w = q * 3.0 + vec2( fbm( q * 2.0 ), fbm( q * 2.0 + 4.0 ) ) * 0.8;
    vec2 vv = voronoi( w, vec2( 0.0 ), false );
    float web = pow( 1.0 - clamp( vv.y - vv.x, 0.0, 1.0 ), 6.0 );
    float fall = exp( -r * r * 2.2 ) * ( 1.0 - smoothstep( 0.8, 0.98, r ) );
    return vec4( 0.45 + 0.55 * web, web, 0.2 + 0.8 * fall, fall * ( 0.55 + 0.45 * web ) );
  }
  if ( cell < 59.0 ) { // scorch: char with an ember edge
    float d = 1.0 - r + ( fbm( q * 4.0 + 6.0 ) - 0.5 ) * 0.45;
    float m = smoothstep( 0.15, 0.42, d );
    float char = 0.35 + 0.65 * fbm( vec2( a * 3.0, r * 9.0 ) + 1.0 );
    float edge = smoothstep( 0.12, 0.2, d ) * ( 1.0 - smoothstep( 0.24, 0.42, d ) );
    return vec4( char, edge, clamp( d, 0.2, 1.0 ), m * cellFade( q ) );
  }
  if ( cell < 60.0 ) return splash( q, 5.5 );
  return vec4( 0.0 );
}

void main() {
  if ( uMode < 0.5 ) {
    vec2 px = vUv * uSize;
    vec2 cxy = floor( px / ( uSize / 8.0 ) );
    float cell = cxy.x + cxy.y * 8.0;
    vec2 q = fract( px / ( uSize / 8.0 ) ) * 2.0 - 1.0;
    gl_FragColor = clamp( cellFn( cell, q ), 0.0, 1.0 );
  } else {
    vec2 uv = vUv;
    float r = pfbm( uv * 8.0, vec2( 8.0 ) );
    vec2 vv = voronoi( uv * 6.0, vec2( 6.0 ), true );
    float g = clamp( ( vv.y - vv.x ) * 1.6, 0.0, 1.0 );
    float b = pfbm( vec2( uv.x * 4.0, uv.y * 24.0 ), vec2( 4.0, 24.0 ) );
    float a = pfbm( uv * 16.0 + 17.0, vec2( 16.0 ) );
    gl_FragColor = vec4( r, g, b, a );
  }
}`,Ju=class{atlasTarget;noiseTarget;ready=!1;constructor(){this.atlasTarget=new ne(Hu,Hu,{depthBuffer:!1,stencilBuffer:!1,generateMipmaps:!0,minFilter:p,magFilter:re}),this.noiseTarget=new ne(Uu,Uu,{depthBuffer:!1,stencilBuffer:!1,generateMipmaps:!0,minFilter:p,magFilter:re,wrapS:z,wrapT:z}),this.atlasTarget.texture.name=`vale_vfx_atlas`,this.noiseTarget.texture.name=`vale_vfx_noise`}get atlas(){return this.atlasTarget.texture}get noise(){return this.noiseTarget.texture}generate(e){if(this.ready)return;this.ready=!0;let t=new ee({vertexShader:Ku,fragmentShader:qu,uniforms:{uMode:{value:0},uSize:{value:[Hu,Hu]}},depthTest:!1,depthWrite:!1}),n=new I(new me(2,2),t);n.frustumCulled=!1;let r=new L;r.add(n);let i=new Ie(-1,1,1,-1,0,1),a=e.getRenderTarget(),o=e.autoClear;e.autoClear=!0,e.setRenderTarget(this.atlasTarget),e.render(r,i),t.uniforms.uMode.value=1,t.uniforms.uSize.value=[Uu,Uu],e.setRenderTarget(this.noiseTarget),e.render(r,i),e.setRenderTarget(a),e.autoClear=o,t.dispose(),n.geometry.dispose()}dispose(){this.atlasTarget.dispose(),this.noiseTarget.dispose()}},Yu=e=>typeof e==`number`&&Number.isFinite(e);function Xu(e,t){let n=Zu(e)??Zu(t)??{t:[0],v:[0]},r=new Float32Array(32);for(let e=0;e<32;e++)r[e]=Qu(n.t,n.v,e/31);return r}function Zu(e){if(Yu(e))return{t:[0],v:[e]};if(!Array.isArray(e)||e.length===0)return null;if(e.every(e=>Array.isArray(e)&&e.length===2&&Yu(e[0])&&Yu(e[1]))){let t=e.slice().sort((e,t)=>e[0]-t[0]);return{t:t.map(e=>Math.max(0,Math.min(1,e[0]))),v:t.map(e=>e[1])}}if(e.every(Yu)){let t=e.length;return{t:e.map((e,n)=>t===1?0:n/(t-1)),v:e}}return null}function Qu(e,t,n){if(e.length===1||n<=e[0])return t[0];for(let r=1;r<e.length;r++)if(n<=e[r]){let i=e[r]-e[r-1],a=i>1e-6?(n-e[r-1])/i:1;return t[r-1]+(t[r]-t[r-1])*a}return t[t.length-1]}function Y(e,t){let n=(t<=0?0:t>=1?1:t)*31,r=n|0,i=n-r;return r>=31?e[31]:e[r]+(e[r+1]-e[r])*i}function $u(e){return e===`team`?{k:1}:e===`element`?{k:2}:e===`signature`?{k:3}:e===`secondary`?{k:4}:typeof e==`string`&&/^element:#[0-9a-fA-F]{6}$/.test(e)?{k:5,c:new R().setStyle(e.slice(8))}:typeof e==`string`&&/^#[0-9a-fA-F]{6}$/.test(e)?{k:0,c:new R().setStyle(e)}:null}function ed(e,t=`team`){return td(e)??td(t)??{t:[0],c:[{k:1}]}}function td(e){let t=$u(e);if(t)return{t:[0],c:[t]};if(!Array.isArray(e)||e.length===0)return null;if(e.every(e=>Array.isArray(e)&&e.length===2&&Yu(e[0])&&$u(e[1]))){let t=e.slice().sort((e,t)=>e[0]-t[0]);return{t:t.map(e=>Math.max(0,Math.min(1,e[0]))),c:t.map(e=>$u(e[1]))}}let n=e.map($u);if(n.every(e=>e)){let e=n.length;return{t:n.map((t,n)=>e===1?0:n/(e-1)),c:n}}return null}var nd=class e{static SLOTS=1024;data=new Float32Array(e.SLOTS*32*3);next=0;tmp=[];bake(t,n,r=1){let i=this.next;for(this.next=(this.next+1)%e.SLOTS;this.tmp.length<t.c.length;)this.tmp.push(new R);for(let e=0;e<t.c.length;e++)n(t.c[e],this.tmp[e]);let a=i*32*3,o=this.data;for(let e=0;e<32;e++){let n=e/31,i=this.tmp[0].r,s=this.tmp[0].g,c=this.tmp[0].b;if(t.t.length>1&&n>t.t[0]){let e=!1;for(let r=1;r<t.t.length;r++)if(n<=t.t[r]){let a=t.t[r]-t.t[r-1],o=a>1e-6?(n-t.t[r-1])/a:1,l=this.tmp[r-1],u=this.tmp[r];i=l.r+(u.r-l.r)*o,s=l.g+(u.g-l.g)*o,c=l.b+(u.b-l.b)*o,e=!0;break}if(!e){let e=this.tmp[t.t.length-1];i=e.r,s=e.g,c=e.b}}o[a+e*3]=i*r,o[a+e*3+1]=s*r,o[a+e*3+2]=c*r}return i}sample(e,t,n,r){let i=(t<=0?0:t>=1?1:t)*31,a=i|0,o=i-a,s=e*32*3+a*3,c=this.data;if(a>=31){n[r]=c[s],n[r+1]=c[s+1],n[r+2]=c[s+2];return}n[r]=c[s]+(c[s+3]-c[s])*o,n[r+1]=c[s+1]+(c[s+4]-c[s+1])*o,n[r+2]=c[s+2]+(c[s+5]-c[s+2])*o}},rd=[`orb`,`blade`,`shard`,`cone`,`pillar`,`disc`,`spiral`,`crescent`,`spike`,`dome`,`ringwave`,`wall`,`column`,`tornado`,`fan`,`shaft`,`stair`],id={fan:1,column:2,shaft:2,stair:2};function ad(e){let t=rd.indexOf(e);return t<0?0:t}function od(e,t,n){let r=[],i=[],a=[],o=[],s=new B,c=new B;for(let o=0;o<=t;o++)for(let l=0;l<=e;l++){let u=l/e,d=o/t;n(u,d,s,c),r.push(s.x,s.y,s.z),i.push(c.x,c.y,c.z),a.push(u,d)}for(let n=0;n<t;n++)for(let t=0;t<e;t++){let r=n*(e+1)+t,i=r+1,a=r+e+1,s=a+1;o.push(r,a,i,i,a,s)}let l=new Ee;return l.setAttribute(`position`,new F(new Float32Array(r),3)),l.setAttribute(`normal`,new F(new Float32Array(i),3)),l.setAttribute(`uv`,new F(new Float32Array(a),2)),l.setIndex(o),l}function sd(){let e=[],t=[],n=[],r=[];for(let[i,a]of[[.04,.5],[.3,.42],[.56,.34],[.82,.26]]){let o=e.length/3;for(let r=0;r<=1;r++)for(let o=0;o<=48;o++){let s=o/48*Math.PI*2,c=i+r*.09,l=a*(1-.06*r);e.push(Math.cos(s)*l,c,Math.sin(s)*l),t.push(Math.cos(s),.2,Math.sin(s)),n.push(o/48,c)}for(let e=0;e<48;e++){let t=o+e,n=t+1,i=t+48+1,a=i+1;r.push(t,i,n,n,i,a)}}let i=new Ee;return i.setAttribute(`position`,new F(new Float32Array(e),3)),i.setAttribute(`normal`,new F(new Float32Array(t),3)),i.setAttribute(`uv`,new F(new Float32Array(n),2)),i.setIndex(r),i}var cd=1.4,ld=new Set([`orb`,`dome`]);function ud(e,t=!1){switch(e){case`orb`:return t?new C(.5,20,10):new C(.5,32,16);case`dome`:return t?new C(.5,24,6,0,Math.PI*2,0,Math.PI/2):new C(.5,40,10,0,Math.PI*2,0,Math.PI/2);case`blade`:return od(24,2,(e,t,n,r)=>{let i=e-.5,a=.14*Math.sin(e*Math.PI)-.04,o=.13*Math.sin(Math.min(1,e*1.08)*Math.PI)**.55*(1-e*.35)+.004;n.set(a+(t-.5)*2*o,0,i),r.set(0,1,0)});case`shard`:return od(6,6,(e,t,n,r)=>{let i=e*Math.PI*2,a=Math.sin(t*Math.PI)*(t<.35?1:1-(t-.35)*.4),o=Math.round(i/(Math.PI/3))*(Math.PI/3);n.set(Math.cos(o)*.16*a,Math.sin(o)*.12*a,t-.5),r.set(Math.cos(o),Math.sin(o),0)});case`cone`:{let e=new ue(.5,1,32,4,!0);return e.translate(0,.5,0),e}case`pillar`:case`wall`:{let e=new We(.5,.5,1,40,4,!0);return e.translate(0,.5,0),e}case`column`:return od(48,10,(e,t,n,r)=>{let i=e*Math.PI*2,a=.018*Math.cos(i*8),o=.46+.07*t*t+a;n.set(Math.cos(i)*o,t,Math.sin(i)*o),r.set(Math.cos(i)-.14*Math.sin(i*8)*Math.sin(i),-.14*t,Math.sin(i)+.14*Math.sin(i*8)*Math.cos(i)).normalize()});case`shaft`:return od(48,6,(e,t,n,r)=>{let i=e*Math.PI*2,a=.5*(.32+.68*Math.abs(Math.cos(i*3))**4)*(1-.82*t);n.set(Math.cos(i)*a,t,Math.sin(i)*a),r.set(Math.cos(i),.3,Math.sin(i)).normalize()});case`stair`:return sd();case`tornado`:return od(40,12,(e,t,n,r)=>{let i=e*Math.PI*2,a=.1+.4*t**1.3;n.set(Math.cos(i)*a,t,Math.sin(i)*a),r.set(Math.cos(i),-.4,Math.sin(i)).normalize()});case`disc`:return od(40,4,(e,t,n,r)=>{let i=e*Math.PI*2,a=t*.5;n.set(Math.cos(i)*a,0,Math.sin(i)*a),r.set(0,1,0)});case`ringwave`:return od(64,2,(e,t,n,r)=>{let i=e*Math.PI*2,a=.32+.18*t;n.set(Math.cos(i)*a,0,Math.sin(i)*a),r.set(0,1,0)});case`fan`:return od(32,6,(e,t,n,r)=>{n.set(e,0,t),r.set(0,1,0)});case`crescent`:return od(40,3,(e,t,n,r)=>{let i=(e-.5)*Math.PI*.84,a=.17*Math.sin(e*Math.PI)**.8+.004,o=.5-a+t*a;n.set(Math.sin(i)*o,0,Math.cos(i)*o-.25),r.set(0,1,0)});case`spike`:{let e=new ue(.16,1,8,2);return e.translate(0,.5,0),e}case`spiral`:{let e=[];for(let t=0;t<=64;t++){let n=t/64,r=n*Math.PI*4;e.push(new B(Math.cos(r)*.45*(1-n*.4),n,Math.sin(r)*.45*(1-n*.4)))}return new Ce(new oe(e),64,.035,6,!1)}}}var dd=[`origin`,`caster`,`target`,`path`,`ground`],fd={point:0,sphere:1,ring:2,disc:3,cone:4,line:5,path:6,aura:7},pd={up:0,out:1,in:2,forward:3,back:4,down:5,normal:6,random:7,none:8},X=(e,t)=>typeof e==`number`&&Number.isFinite(e)?e:t,md=(e,t)=>Array.isArray(e)&&e.length>=2&&typeof e[0]==`number`&&typeof e[1]==`number`?[e[0],e[1]]:typeof e==`number`&&Number.isFinite(e)?[e,e]:t,hd=(e,t)=>Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))?[e[0],e[1],e[2]]:t,gd=(e,t)=>typeof e==`boolean`?e:t,_d=(e,t)=>X(e,t)*Math.PI/180,vd=e=>dd.includes(e)?e:null,yd=(e,t,n)=>typeof t==`string`&&t in e?e[t]:n,bd=(e,t)=>e===`add`?0:e===`alpha`?1:e===`ink`?2:e===`chip`?3:t,xd=(e,t)=>Xu([0,.25,.5,.75,1].map(n=>[n,e+(t-e)*(1-(1-n)*(1-n))]),e),Sd={dir:0,flat:1,velocity:2,camera:3,up:4},Cd={none:0,band:1,top:2,sweep:3,ends:4,edge:5},wd=[`circle`,`ring`,`cone`,`rect`,`line`],Td={plain:0,scorch:1,crack:2,ink:3,frost:4,light:5},Ed={ring:0,haze:1,bulge:2},Dd={camera:0,velocity:1,ground:2,axis:3};function Od(e){return{type:String(e.type),delay:Math.max(0,X(e.delay,0)),at:vd(e.at),windup:e.phase===`windup`,release:e.phase===`release`,socket:typeof e.socket==`string`?e.socket:null,offset:hd(e.offset,null),follow:gd(e.follow,!1),fit:typeof e.fit==`boolean`?e.fit:null,secondary:gd(e.secondary,!1),chance:Math.max(0,Math.min(1,X(e.chance,1))),repeat:Math.max(0,X(e.repeat,0)),fitTime:gd(e.fitTime,!1),clip:typeof e.clip==`string`?[e.clip]:Array.isArray(e.clip)&&e.clip.length&&e.clip.every(e=>typeof e==`string`)?e.clip:null}}function kd(e,t,n){let r=Gu(e.texture??(n?`spark`:`glow`)),i=bd(e.blend,0),a=Math.max(0,Math.round(X(e.count,n?8:0))),o=Array.isArray(e.bursts)?e.bursts.filter(e=>Array.isArray(e)&&e.length===2).map(e=>[X(e[0],0),Math.round(X(e[1],0))]):[],s=r.frames>1&&!r.variants;return{...t,type:`emitter`,count:a,rate:Math.max(0,X(e.rate,0)),perMeter:Math.max(0,X(e.perMeter,0)),bursts:o,duration:X(e.duration,-1),shape:yd(fd,e.shape,n&&t.at===`ground`?fd.disc:fd.point),radius:X(e.radius,n&&t.at===`ground`?.15:.2),radiusInner:X(e.radiusInner,0),angle:_d(e.angleDeg,60),length:X(e.length,2),width:X(e.width,0),surface:gd(e.surface,!1),height:X(e.height,0),dir:yd(pd,e.dir,pd.up),spread:_d(e.spreadDeg,n?60:30),speed:md(e.speed,n?[1,2]:[0,0]),velocity:hd(e.velocity,[0,0,0]),inherit:X(e.inherit,n?.15:0),life:md(e.life,[.2,.4]),gravity:X(e.gravity,0),drag:X(e.drag,0),turb:X(e.turbulence,0),turbScale:X(e.turbulenceScale,1.2),orbit:_d(e.orbitDeg,0),radial:X(e.radial,0),bounce:X(e.bounce,.25),collide:gd(e.collide,!0),size:Xu(e.size,[.1,.05]),sizeVar:md(e.sizeVar,[1,1]),stretch:X(e.stretch,n&&r.stretch?.035:0),rot:md(e.rotDeg,[0,360]).map(e=>e*Math.PI/180),spin:md(e.spinDeg,n?[-170,170]:[0,0]).map(e=>e*Math.PI/180),color:ed(e.color,`team`),alpha:Xu(e.alpha,[1,0]),emissive:Xu(e.emissive,1),erode:Xu(e.erode,s&&i!==0?[0,0,.15,.55]:0),tex:r,frame:Math.round(X(e.frame,-1)),fps:X(e.fps,0),blend:i,soft:X(e.soft,r.cell<32?.35:.08),rim:$u(e.rim),rimAmt:X(e.rimAlpha,$u(e.rim)?.6:0),align:yd(Dd,e.align,0),aspect:X(e.aspect,1),local:e.space===`local`,hold:X(e.hold,0),max:Math.max(0,Math.round(X(e.max,400))),legacy:n}}function Ad(e,t,n){let r=Od(e);switch(e.type){case`bind`:return typeof e.event==`string`&&n.push(e.event),[];case`emitter`:return[kd(e,r,!1)];case`burst`:{let t=Array.isArray(e.color)?e.color:[e.color,e.color],n=kd({...e,color:[t[0],t[1]??t[0]],dir:r.at===`path`?`back`:`up`},r,!0);return n.secondary=n.blend!==0,[n]}case`sprite`:{let n=kd({...e,count:1,speed:[0,0],spreadDeg:0,life:[X(e.life,t.duration),X(e.life,t.duration)],spinDeg:e.spinDeg??[0,0],rotDeg:e.rotDeg??[0,0]},r,!1);return n.local=e.space!==`world`,n.hold=X(e.hold,.5),n.collide=!1,n.soft=X(e.soft,.05),[n]}case`flash`:{let t=X(e.radius,.5),n=Math.max(.03,X(e.life,.06)),i=X(e.intensity,1.5),a=[],o=kd({count:1,texture:e.texture??`glow`,size:[t*2.2,t*2.7],alpha:[1,0],color:e.color??`team`,emissive:i,life:[n+.04,n+.04],spinDeg:[0,0],rotDeg:[0,360],soft:.25},{...r,secondary:!1},!1);if(o.collide=!1,a.push(o),e.core!==void 0){let o=kd({count:1,texture:`glow`,size:[t*.9,t*1.1],alpha:[1,0],color:e.core,emissive:Math.max(i,10),life:[n*.8+.02,n*.8+.02],rotDeg:[0,0],soft:.25},{...r,secondary:!1},!1);o.collide=!1,a.push(o)}return e.light!==!1&&i>=1.2&&a.push({...r,type:`light`,color:$u(e.color)??{k:1},intensity:i*4,radius:Math.max(2,t*6),life:n*1.6+.04,attack:0,flicker:0}),a}case`trail`:case`ribbon`:{let t=e.type===`trail`,n=X(e.width,.2),i=X(Array.isArray(e.alpha)?e.alpha[0]:e.alpha,.6);return[{...r,type:`ribbon`,at:r.at??`path`,width:Xu(t?[n*.35,n]:e.width,n),life:Math.max(.04,X(e.life,.2)),color:ed(e.color,`team`),alpha:t?Xu([i*.25,i],i):Xu(e.alpha,[0,1]),emissive:X(e.emissive,1),noise:X(e.noise,t?.25:.4),scroll:X(e.scroll,1.5),tile:X(e.tile,.6),blend:bd(e.blend,0),rim:$u(e.rim),rimAmt:X(e.rimAlpha,$u(e.rim)?.6:0),minDist:X(e.minDist,.12),flat:e.face===`ground`,span:Math.max(0,X(e.span,0)),arc:typeof e.arcRadius==`number`&&e.arcRadius>0?{r:e.arcRadius,a0:md(e.arcDeg,[70,-70])[0]*Math.PI/180,a1:md(e.arcDeg,[70,-70])[1]*Math.PI/180,tilt:_d(e.arcTiltDeg,0),h:X(e.arcHeight,1),ease:Math.max(.2,X(e.arcEase,1.4))}:null}]}case`ring`:case`shockwave`:{let t=e.type===`ring`,n=md(e.radius,[.3,1]),i=Math.max(.04,X(e.life,.3));return[{...r,type:`shockwave`,vertical:e.mode===`vertical`,radius:t?xd(n[0],n[1]):Xu(e.radius,[.3,1]),width:Xu(e.width,.1),life:i,color:ed(e.color,`team`),alpha:Xu(e.alpha,[1,0]),emissive:Xu(e.emissive,1),sharp:X(e.sharp,t?.6:1.5),noise:X(e.noise,t?0:.35),inner:X(e.inner,0),blend:bd(e.blend,0),distort:X(e.distort,0)}]}case`beam`:return[{...r,type:`beam`,width:X(e.width,.2),life:Math.max(.04,X(e.life,.2)),color:ed(e.color,`team`),alpha:Xu(e.alpha,[1,0]),emissive:X(e.emissive,1.5),noise:X(e.noise,0),freq:X(e.freq,1.2),scroll:X(e.scroll,2),flare:X(e.flare,0),flareTex:Gu(e.flareTexture??`flare`),taper:md(e.taper,[.6,1]),core:X(e.core,1.2),blend:bd(e.blend,0),from:vd(e.from)??`origin`,to:vd(e.to),hold:Math.max(0,Math.min(1,X(e.hold,.5)))}];case`mesh`:{let t=Array.isArray(e.scale)&&(e.scale.length>2||Array.isArray(e.scale[0])),n=!t&&[`rim`,`rimPow`,`dissolve`,`noise`,`mask`,`emissive`,`edge`,`wobble`,`twist`,`stretch`,`align`,`rotateDeg`,`angleDeg`].every(t=>e[t]===void 0),i=md(e.scale,[.5,.5]);return[{...r,type:`mesh`,shape:ad(e.shape),scale:t?Xu(e.scale,.5):xd(i[0],i[1]),stretch:hd(e.stretch,[1,1,1]),life:Math.max(.04,X(e.life,.3)),color:ed(e.color,`team`),alpha:Xu(e.alpha,[1,0]),emissive:Xu(e.emissive,1),rim:$u(e.rim),rimPow:X(e.rimPow,2.5),rimEmissive:X(e.rimEmissive,1.5),noiseScale:X(e.noiseScale,1.5),scroll:md(e.scroll,[0,.4]),noise:X(e.noise,n?0:.5),dissolve:Xu(e.dissolve,0),edge:$u(e.edge),edgeWidth:X(e.edgeWidth,.08),edgeEmissive:X(e.edgeEmissive,2),mask:yd(Cd,e.mask,0),maskParam:Xu(e.maskParam,.2),blend:bd(e.blend,0),spin:_d(e.spinDeg,0),rotate:hd(e.rotateDeg,[0,0,0]).map(e=>e*Math.PI/180),align:yd(Sd,e.align,Sd.dir),wobble:X(e.wobble,0),twist:X(e.twist,0),angle:_d(e.angleDeg,90)/2,hold:X(e.hold,.5),legacy:n}]}case`decal`:{let t=typeof e.style==`string`&&e.style in Td,n=e.style===`light`?e.shape===`ring`?`ring_thin`:`caustic`:e.style===`ink`?`splat`:e.style===`scorch`?`scorch`:e.style===`frost`?`frost`:`crack`,i=typeof e.texture==`string`?e.texture:t?n:`crack`,a=t?Td[e.style]:i===`crack`?Td.crack:i===`smoke`?Td.ink:i===`glow`?Td.light:Td.plain;return[{...r,type:`decal`,shape:Math.max(0,wd.indexOf(String(e.shape??`circle`))),style:a,radius:Xu(e.radius,1),life:Math.max(.05,X(e.life,.8)),color:ed(e.color,`team`),alpha:Xu(e.alpha,[.5,0]),emissive:Xu(e.emissive,a===Td.light?1.5:0),rim:$u(e.rim),tex:Gu(i),angle:_d(e.angleDeg,60)/2,length:X(e.length,0),width:X(e.width,0),spinRandom:e.rotateDeg===void 0&&(e.shape===void 0||e.shape===`circle`||e.shape===`ring`),rotate:_d(e.rotateDeg,0),hold:Math.max(0,Math.min(1,X(e.hold,.5))),countdown:e.countdown===!0}]}case`light`:return[{...r,type:`light`,color:$u(e.color)??{k:1},intensity:X(e.intensity,4),radius:X(e.radius,4),life:Math.max(.03,X(e.life,.3)),attack:Math.max(0,X(e.attack,0)),flicker:Math.max(0,Math.min(1,X(e.flicker,0)))}];case`distort`:return[{...r,type:`distort`,mode:yd(Ed,e.mode,0),size:Xu(e.size,[.5,2]),strength:Xu(e.strength,[.02,0]),life:Math.max(.04,X(e.life,.4)),ground:e.align===`ground`}];case`feel`:return[{...r,type:`feel`,shake:Math.max(0,Math.min(1,X(e.shake,0))),who:+(e.who===`all`),hitFlash:Math.max(0,X(e.hitFlash,0)),hitStop:Math.max(0,Math.min(.12,X(e.hitStop,0))),squash:Math.max(0,Math.min(.3,X(e.squash,0))),exposure:Math.max(0,Math.min(4,X(e.exposure,0))),exposureRadius:Math.max(0,X(e.exposureRadius,1)),exposureHold:Math.max(0,Math.min(.6,X(e.exposureHold,.28))),exposureFade:Math.max(.03,Math.min(.4,X(e.exposureFade,.12))),exposureDip:Math.max(.5,Math.min(1,X(e.exposureDip,.92))),exposureDesat:Math.max(0,Math.min(1,X(e.exposureDesat,.35))),exposureRepeat:Math.max(0,Math.min(1,X(e.exposureRepeat,0)))}];default:return[]}}function jd(e,t){switch(e.type){case`emitter`:{let n=e.rate>0||e.perMeter>0?e.duration>=0?e.duration:t:0,r=e.bursts.reduce((e,t)=>Math.max(e,t[0]),0);return Math.max(n,r)+e.life[1]}case`ribbon`:return e.span>0?e.span+e.life:e.life;case`distort`:case`beam`:case`mesh`:case`shockwave`:case`decal`:case`light`:return e.life;default:return 0}}function Md(e){let t=[],n=[];for(let r of e.layers)for(let i of Ad(r,e,n))t.push(i);let r=e.duration,i=0;for(let n of t)r=Math.max(r,n.delay+jd(n,e.duration)),n.release&&(i=Math.max(i,n.delay+jd(n,0)));return{id:e.id,duration:e.duration,teamTint:e.teamTint,layers:t,span:r,hasWindup:t.some(e=>e.windup),binds:n,hasExposure:t.some(e=>e.type===`feel`&&e.exposure>0),beatRepeat:t.reduce((e,t)=>t.type===`feel`?Math.max(e,t.exposureRepeat):e,0),relSpan:i}}var Nd={uDepth:{value:null},uHasDepth:{value:0},uRes:{value:new O(1920,1080)},uNear:{value:1},uFar:{value:400},uTime:{value:0},uAtlas:{value:null},uNoise:{value:null},uGrid:{value:8},uLiftA:Za.uLiftA,uBreath:Za.uBreath,uAspect:Za.uAspect,uLiftOn:{value:0},uLiftCap:{value:Xa-1},uLiftInvProj:{value:new M},uLiftCamWorld:{value:new M}},Pd={transparent:!0,depthWrite:!1,depthTest:!1,blending:5,blendEquation:100,blendSrc:201,blendDst:205,blendEquationAlpha:100,blendSrcAlpha:201,blendDstAlpha:205},Fd=`
uniform sampler2D uDepth;
uniform float uHasDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
float vfxLin( float d ) { float z = d * 2.0 - 1.0; return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) ); }
// 0 behind the scene, fading to 1 over 'soft' metres in front of it
float vfxSoft( float soft ) {
  if ( uHasDepth < 0.5 ) return 1.0;
  float sd = vfxLin( texture2D( uDepth, gl_FragCoord.xy / uRes ).r );
  float fd = vfxLin( gl_FragCoord.z );
  float diff = sd - fd;
  return soft > 0.001 ? clamp( diff / soft, 0.0, 1.0 ) : step( -0.03, diff );
}
uniform vec4 uLiftA[ 4 ];
uniform float uLiftOn;
uniform float uLiftCap;
uniform float uBreath;
uniform float uAspect;
uniform mat4 uLiftInvProj;
uniform mat4 uLiftCamWorld;
// combat F4 (W1 verify): the ultimate envelope (post.ts ExposureEffect) lifts the frame AFTER this pass: the ground
// ×(1 + lift) in display, a body at most LIFT_BODY_CAP. An effect is no ground: an impact flare, a status look, a proc or
// a pale frost decal in the light went ×(1 + lift)^2.2 linear and white over the struck unit. Every effect takes the
// body's cap wherever it lands (light and ink alike; a chip, opaque stone, is lit like the ground): its colour is
// divided here by what the envelope will add past the cap at this pixel (the same lift sum and the same ground test
// from the scene depth as the envelope's). A light-only variant (ink lifted) left Rishal's frost track at 0.31 white
float vfxLift() {
  if ( uLiftOn < 0.5 ) return 1.0;
  vec2 uv = gl_FragCoord.xy / uRes;
  float lift = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    vec4 q = uLiftA[ i ];
    if ( q.w <= 0.0 ) continue;
    vec2 d = ( uv - q.xy ) * vec2( uAspect, 1.0 );
    float k = 1.0 - smoothstep( q.z * 0.55, q.z * 1.35, length( d ) );
    lift += q.w * ( k + uBreath * ( 1.0 - k ) );
  }
  if ( lift <= uLiftCap ) return 1.0;
  float post = lift;
  if ( uHasDepth > 0.5 ) {
    // over a body the envelope itself stops at LIFT_BODY_CAP
    float z = texture2D( uDepth, uv ).r;
    vec4 v = uLiftInvProj * vec4( vec3( uv, z ) * 2.0 - 1.0, 1.0 );
    vec3 w = ( uLiftCamWorld * vec4( v.xyz / v.w, 1.0 ) ).xyz;
    post = mix( lift, min( lift, ${(Ja-1).toFixed(3)} ), smoothstep( 0.05, 0.2, w.y ) * step( z, 0.99999 ) );
  }
  return pow( ( 1.0 + min( post, uLiftCap ) ) / ( 1.0 + post ), 2.2 );
}
`,Id=`
attribute vec4 aPos;   // xyz, size
attribute vec4 aCol;   // rgb (HDR), alpha
attribute vec4 aVel;   // velocity xyz, stretch (s)
attribute vec4 aTex;   // cell (+frame), frame blend, rotation, erode
attribute vec4 aPar;   // soft (m), rim amount, mode (0 add 1 alpha 2 ink 3 chip), align (0 camera 1 velocity 2 ground 3 axis)
attribute vec4 aRim;   // rim rgb, aspect (width / height)
uniform float uGrid;
varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying vec4 vCol; varying vec4 vPar; varying vec3 vRim; varying float vErode;
vec2 cellUv( float c, vec2 local ) { vec2 cell = vec2( mod( c, uGrid ), floor( c / uGrid ) ); return ( cell + 0.006 + local * 0.988 ) / uGrid; }
void main() {
  vec2 corner = position.xy;
  float size = aPos.w;
  float rot = aTex.z;
  float align = aPar.w;
  vec4 mv;
  if ( align > 1.5 && align < 2.5 ) {
    float c = cos( rot ), s = sin( rot );
    vec2 q = vec2( c * corner.x - s * corner.y, s * corner.x + c * corner.y ) * size;
    q.x *= aRim.w;
    mv = viewMatrix * vec4( aPos.xyz + vec3( q.x, 0.0, -q.y ), 1.0 );
  } else if ( align > 2.5 ) {
    vec3 toCam = cameraPosition - aPos.xyz; toCam.y = 0.0;
    vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCam ) + vec3( 1e-5, 0.0, 0.0 ) );
    mv = viewMatrix * vec4( aPos.xyz + right * corner.x * size * aRim.w + vec3( 0.0, corner.y * size, 0.0 ), 1.0 );
  } else {
    mv = viewMatrix * vec4( aPos.xyz, 1.0 );
    vec3 vv = ( viewMatrix * vec4( aVel.xyz, 0.0 ) ).xyz;
    float l = length( vv.xy );
    if ( aVel.w > 0.0 && l > 1e-3 ) {
      vec2 ax = vv.xy / l, ay = vec2( -ax.y, ax.x );
      float len = min( size + l * aVel.w, size * 9.0 );
      mv.xy += ax * corner.x * len + ay * corner.y * size * 0.42;
    } else {
      float c = cos( rot ), s = sin( rot );
      mv.xy += mat2( c, s, -s, c ) * ( corner * vec2( aRim.w, 1.0 ) ) * size;
    }
  }
  gl_Position = projectionMatrix * mv;
  vec2 local = corner + 0.5;
  float cell = floor( aTex.x + 0.001 );
  vUvA = cellUv( cell, local );
  vUvB = cellUv( cell + 1.0, local );
  vBlend = aTex.y;
  vCol = aCol; vPar = aPar; vRim = aRim.rgb; vErode = aTex.w;
}`,Ld=`
uniform sampler2D uAtlas;
${Fd}
varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying vec4 vCol; varying vec4 vPar; varying vec3 vRim; varying float vErode;
void main() {
  vec4 t = texture2D( uAtlas, vUvA );
  if ( vBlend > 0.001 ) t = mix( t, texture2D( uAtlas, vUvB ), vBlend );
  float mode = vPar.z;
  float cov = t.a;
  float er = vErode;
  float keep = er > 0.001 ? smoothstep( er, er + 0.14, t.b ) : 1.0;
  float soft = vfxSoft( vPar.x );
  if ( mode > 2.5 ) {
    // opaque chip: hard coverage, faceted value, catch-light edge
    float a = smoothstep( 0.4, 0.6, cov * keep ) * vCol.a * step( 0.001, soft );
    if ( a < 0.01 ) discard;
    vec3 rgb = vCol.rgb * ( 0.42 + 0.78 * t.r ) + vRim * t.g * vPar.y;
    gl_FragColor = vec4( rgb * a, a );
    return;
  }
  float a = cov * keep * vCol.a * soft;
  if ( a < 0.002 ) discard;
  if ( mode < 0.5 ) {
    gl_FragColor = vec4( vCol.rgb * ( 0.3 + 0.7 * t.r ) * a, 0.0 );
  } else if ( mode < 1.5 ) {
    gl_FragColor = vec4( vCol.rgb * ( 0.72 + 0.28 * t.r ) * a, a );
  } else {
    float rim = clamp( t.g * vPar.y * 1.6, 0.0, 1.0 );
    vec3 body = vCol.rgb * ( 0.5 + 0.5 * t.r );
    gl_FragColor = vec4( ( body * ( 1.0 - rim ) + vRim * rim ) * a, a * ( 1.0 - rim * 0.35 ) );
  }
  gl_FragColor.rgb *= vfxLift();   // combat F4: the envelope never lifts an effect past the body cap
}`,Rd=`
attribute vec4 aCol;   // rgb (HDR), alpha
attribute vec4 aUv;    // u (0 tail → 1 head), v (0..1 across), distance along (m), seed
attribute vec4 aPrm;   // mode, noise, scroll (m/s), tile (1/m)
attribute vec4 aRimC;  // rim rgb, rim amount
varying vec4 vCol; varying vec4 vUv; varying vec4 vPrm; varying vec4 vRim;
void main() { vCol = aCol; vUv = aUv; vPrm = aPrm; vRim = aRimC; gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 ); }`,zd=`
uniform sampler2D uNoise;
uniform float uTime;
${Fd}
varying vec4 vCol; varying vec4 vUv; varying vec4 vPrm; varying vec4 vRim;
void main() {
  float v = vUv.y;
  float across = 1.0 - abs( v * 2.0 - 1.0 );
  float prof = smoothstep( 0.0, 0.6, across );
  float core = pow( max( across, 0.0 ), 5.0 );
  vec2 nuv = vec2( vUv.z * vPrm.w - uTime * vPrm.z, v * 0.55 + vUv.w );
  float n = texture2D( uNoise, nuv ).b * 0.65 + texture2D( uNoise, nuv * vec2( 0.5, 1.4 ) + 0.37 ).r * 0.55;
  float nm = mix( 1.0, smoothstep( 0.22, 0.78, n ), vPrm.y );
  float a = vCol.a * prof * nm * vfxSoft( 0.12 );
  if ( a < 0.002 ) discard;
  float mode = vPrm.x;
  if ( mode < 0.5 ) gl_FragColor = vec4( vCol.rgb * ( 0.75 + 1.4 * core ) * a, 0.0 );
  else if ( mode < 1.5 ) gl_FragColor = vec4( vCol.rgb * a, a );
  else {
    float rim = ( 1.0 - smoothstep( 0.0, 0.32, across ) ) * vRim.w * smoothstep( 0.0, 0.08, across );
    gl_FragColor = vec4( mix( vCol.rgb * ( 0.6 + 0.4 * n ), vRim.rgb, rim ) * a, a );
  }
  gl_FragColor.rgb *= vfxLift();   // combat F4: the envelope never lifts an effect past the body cap
}`,Bd=`
attribute vec4 aA;   // start xyz, width
attribute vec4 aB;   // end xyz, noise amplitude (m)
attribute vec4 aC;   // rgb (HDR), alpha
attribute vec4 aD;   // scroll, freq (1/m), seed, mode
attribute vec4 aE;   // core boost, taper start, taper end, age01
uniform float uTime;
varying vec2 vUv; varying vec4 vC; varying vec4 vD; varying vec4 vE; varying float vS;
void main() {
  vec3 a = aA.xyz, b = aB.xyz;
  float s = position.x;
  vec3 mid = mix( a, b, s );
  float L = length( b - a );
  vec3 dir = ( b - a ) / max( L, 1e-4 );
  vec3 toCam = normalize( cameraPosition - mid );
  vec3 side = normalize( cross( dir, toCam ) + vec3( 0.0, 1e-5, 0.0 ) );
  vec3 up2 = normalize( cross( side, dir ) );
  float pin = sin( s * 3.14159 );
  float ph = s * L * aD.y + aD.z * 17.0;
  float disp = ( sin( ph * 2.1 + uTime * 6.0 ) * 0.55 + sin( ph * 4.7 - uTime * 9.0 + 1.3 ) * 0.3 + sin( ph * 9.3 + uTime * 4.0 ) * 0.15 ) * aB.w * pin;
  float disp2 = ( sin( ph * 1.7 - uTime * 5.0 + 2.0 ) * 0.6 + sin( ph * 5.1 + uTime * 8.0 ) * 0.4 ) * aB.w * pin;
  float w = aA.w * mix( aE.y, 1.0, smoothstep( 0.0, 0.12, s ) ) * mix( 1.0, aE.z, smoothstep( 0.88, 1.0, s ) );
  vec3 wp = mid + side * ( position.y * w + disp ) + up2 * disp2;
  vUv = vec2( s * L, position.y + 0.5 ); vS = s;
  vC = aC; vD = aD; vE = aE;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`,Vd=`
uniform sampler2D uNoise;
uniform float uTime;
${Fd}
varying vec2 vUv; varying vec4 vC; varying vec4 vD; varying vec4 vE; varying float vS;
void main() {
  float across = 1.0 - abs( vUv.y * 2.0 - 1.0 );
  float prof = smoothstep( 0.0, 0.7, across );
  float core = pow( max( across, 0.0 ), 7.0 );
  vec2 nuv = vec2( vUv.x * 0.32 - uTime * vD.x, vUv.y * 0.45 + vD.z );
  float n = texture2D( uNoise, nuv ).b * 0.6 + texture2D( uNoise, nuv * vec2( 1.9, 0.7 ) + 0.5 ).r * 0.5;
  float ends = smoothstep( 0.0, 0.04, vS ) * ( 1.0 - smoothstep( 0.96, 1.0, vS ) );
  float a = vC.a * prof * mix( 0.45, 1.0, smoothstep( 0.2, 0.8, n ) ) * ends * vfxSoft( 0.1 );
  if ( a < 0.002 ) discard;
  vec3 rgb = vC.rgb * ( 0.55 + 0.6 * n ) + vC.rgb * core * vE.x;
  if ( vD.w < 0.5 ) gl_FragColor = vec4( rgb * a, 0.0 );
  else gl_FragColor = vec4( rgb * a, a );
  gl_FragColor.rgb *= vfxLift();   // combat F4: the envelope never lifts an effect past the body cap
}`,Hd=`
attribute vec4 aPos;   // centre xyz, radius
attribute vec4 aSty;   // width, alpha, sharpness, noise
attribute vec4 aCol;   // rgb (HDR), mode
attribute vec4 aMisc;  // vertical (0/1), seed, inner fill, age01
varying vec2 vL; varying vec4 vSty; varying vec4 vCol; varying vec4 vMisc; varying float vR;
void main() {
  float ext = aPos.w + aSty.x * 0.6 + 0.05;
  vec2 q = position.xy * 2.0 * ext;
  vec4 mv;
  if ( aMisc.x > 0.5 ) { mv = viewMatrix * vec4( aPos.xyz, 1.0 ); mv.xy += q; }
  else mv = viewMatrix * vec4( aPos.xyz + vec3( q.x, 0.0, -q.y ), 1.0 );
  vL = q; vSty = aSty; vCol = aCol; vMisc = aMisc; vR = aPos.w;
  gl_Position = projectionMatrix * mv;
}`,Ud=`
uniform sampler2D uNoise;
${Fd}
varying vec2 vL; varying vec4 vSty; varying vec4 vCol; varying vec4 vMisc; varying float vR;
void main() {
  float d = length( vL );
  float W = max( vSty.x, 1e-3 );
  float x = ( d - ( vR - W ) ) / W;                       // 0 trailing edge → 1 leading edge
  float band = smoothstep( 0.0, 1.0, clamp( x, 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.9, 1.06, x ) );
  float lead = pow( max( band, 0.0 ), max( 0.3, vSty.z ) );           // the danger (leading) edge is brightest
  float fill = vMisc.z * smoothstep( 0.0, 1.0, clamp( d / max( vR, 1e-3 ), 0.0, 1.0 ) ) * ( 1.0 - step( 1.0, x ) ) * 0.35;
  float ang = atan( vL.y, vL.x );
  float n = texture2D( uNoise, vec2( ang * 0.6366 + vMisc.y, d * 0.12 - vMisc.w * 0.6 ) ).r;
  float nm = mix( 1.0, smoothstep( 0.18, 0.72, n ) * 1.25, vSty.w );
  float a = ( lead + fill ) * nm * vSty.y * vfxSoft( 0.08 );
  if ( a < 0.002 ) discard;
  float mode = vCol.w;
  vec3 rgb = vCol.rgb * ( 0.7 + 0.5 * lead );
  if ( mode < 0.5 ) gl_FragColor = vec4( rgb * a, 0.0 );
  else gl_FragColor = vec4( rgb * a, a );
  gl_FragColor.rgb *= vfxLift();   // combat F4: the envelope never lifts an effect past the body cap
}`,Wd=`
attribute vec4 aPos;   // x, y, z, radius
attribute vec4 aRot;   // rotation, shape, style, alpha
attribute vec4 aCol;   // rgb, emissive
attribute vec4 aMisc;  // age01, seed, shape param (cone half-angle | width / length), cell
attribute vec4 aRimC;  // rim rgb, rx/ry aspect (rect, line)
varying vec2 vL; varying vec4 vRot; varying vec4 vCol; varying vec4 vMisc; varying vec4 vRim; varying vec2 vW;
void main() {
  float r = aPos.w;
  vec2 q = position.xy * 2.0;
  vec2 s = q * r;
  float c = cos( aRot.x ), sn = sin( aRot.x );
  vec2 w = vec2( c * s.x - sn * s.y, sn * s.x + c * s.y );
  vec3 wp = vec3( aPos.x + w.x, aPos.y, aPos.z + w.y );
  vL = q; vRot = aRot; vCol = aCol; vMisc = aMisc; vRim = aRimC; vW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`,Gd=`
uniform sampler2D uAtlas;
uniform sampler2D uNoise;
uniform float uGrid;
uniform float uTime;
${Fd}
varying vec2 vL; varying vec4 vRot; varying vec4 vCol; varying vec4 vMisc; varying vec4 vRim; varying vec2 vW;
vec4 atlasAt( float cell, vec2 q ) {
  vec2 local = clamp( q * 0.5 + 0.5, 0.0, 1.0 );
  vec2 c = vec2( mod( cell, uGrid ), floor( cell / uGrid ) );
  return texture2D( uAtlas, ( c + 0.006 + local * 0.988 ) / uGrid );
}
void main() {
  float shape = vRot.y, style = vRot.z;
  vec2 l = vL;
  float d = length( l );
  float n = texture2D( uNoise, vW * 0.21 + vMisc.y ).r;
  float edgeN = ( n - 0.5 ) * 0.12;
  float m;
  if ( shape < 0.5 ) m = 1.0 - smoothstep( 0.82, 1.0, d + edgeN );
  else if ( shape < 1.5 ) m = ( 1.0 - smoothstep( 0.86, 1.0, d + edgeN ) ) * smoothstep( 0.52, 0.7, d + edgeN );
  else if ( shape < 2.5 ) { float an = abs( atan( l.y, l.x ) ); m = ( 1.0 - smoothstep( 0.85, 1.0, d + edgeN ) ) * ( 1.0 - smoothstep( vMisc.z - 0.06, vMisc.z, an ) ); }
  else if ( shape < 3.5 ) m = ( 1.0 - smoothstep( 0.9, 1.0, abs( l.x ) + edgeN ) ) * ( 1.0 - smoothstep( vMisc.z - 0.08, vMisc.z, abs( l.y ) + edgeN * 0.5 ) );
  else m = ( 1.0 - smoothstep( 0.92, 1.0, abs( l.x ) + edgeN * 0.5 ) ) * ( 1.0 - smoothstep( vMisc.z * 0.6, vMisc.z, abs( l.y ) + edgeN * 0.3 ) );
  float age = vMisc.x;
  // texture coordinates: rect/line stretch the pattern along their length
  vec2 tq = shape > 2.5 ? vec2( l.x, l.y / max( vMisc.z, 0.05 ) ) : l;
  vec4 t = atlasAt( vMisc.w, tq * 0.98 );
  float alpha = vRot.w * m * vfxSoft( 0.0 );
  vec3 rgb; float a; float addOnly = 0.0;
  if ( style < 0.5 ) { // plain: tinted, textured
    a = alpha * mix( 0.35, 1.0, t.a );
    rgb = vCol.rgb * ( 1.0 + vCol.w );
  } else if ( style < 1.5 ) { // scorch: char + an ember edge that cools
    float keep = smoothstep( age * 0.9, age * 0.9 + 0.15, t.b );
    a = alpha * t.a * keep;
    float ember = t.g * pow( clamp( 1.0 - age, 0.0, 1.0 ), 2.0 ) * vCol.w;
    rgb = vCol.rgb * ( 0.5 + 0.5 * t.r ) + vRim.rgb * ember * 3.0;
  } else if ( style < 2.5 ) { // crack: dark fracture lines with light cooling in them
    float keep = smoothstep( age, age + 0.12, t.b );
    float line = t.g;
    a = alpha * clamp( line * 1.3 + t.a * 0.15, 0.0, 1.0 ) * keep;
    float glow = line * pow( clamp( 1.0 - age, 0.0, 1.0 ), 1.6 ) * vCol.w;
    rgb = vCol.rgb + vRim.rgb * glow;
  } else if ( style < 3.5 ) { // ink splat with a light rim
    float keep = smoothstep( age, age + 0.14, t.b );
    a = alpha * t.a * keep;
    float rim = t.g * vRim.w;
    rgb = mix( vCol.rgb * ( 0.6 + 0.4 * t.r ), vRim.rgb, clamp( rim, 0.0, 1.0 ) );
  } else if ( style < 4.5 ) { // frost: glassy facets with sparkles
    float keep = smoothstep( age * 0.9, age * 0.9 + 0.15, t.b );
    a = alpha * t.a * keep;
    float tw = 0.5 + 0.5 * sin( uTime * 2.4 + n * 40.0 );
    rgb = vCol.rgb * ( 0.65 + 0.35 * t.r ) + vRim.rgb * t.g * ( 0.6 + 0.6 * tw ) * max( vCol.w, 0.5 );
  } else { // light pool (additive caustics)
    a = alpha * t.a;
    rgb = vCol.rgb * ( 0.4 + 0.9 * t.r ) * max( vCol.w, 0.3 );
    addOnly = 1.0;
  }
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( rgb * a, addOnly > 0.5 ? 0.0 : a );
  gl_FragColor.rgb *= vfxLift();   // combat F4: the envelope never lifts an effect past the body cap
}`,Kd=`
attribute vec4 aColor;  // rgb (HDR), alpha
attribute vec4 aRimC;   // rim rgb (HDR), fresnel power
attribute vec4 aEdge;   // dissolve-edge rgb (HDR), edge width
attribute vec4 aNoise;  // scale, scroll u, scroll v, noise amount
attribute vec4 aDiss;   // dissolve, mask kind, mask param, mode
attribute vec4 aMisc;   // wobble (m), twist (rad/m), fan half-angle, seed
uniform float uTime;
uniform float uShapeKind;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
varying vec4 vColor; varying vec4 vRim; varying vec4 vEdge; varying vec4 vNoise; varying vec4 vDiss; varying float vSeed;
void main() {
  vec3 p = position;
  vec3 n = normal;
  if ( uShapeKind > 0.5 && uShapeKind < 1.5 ) {
    float ang = ( uv.x - 0.5 ) * 2.0 * aMisc.z;
    float rr = uv.y * 0.5;
    p = vec3( sin( ang ) * rr, 0.0, cos( ang ) * rr );
    n = vec3( 0.0, 1.0, 0.0 );
  }
  if ( abs( aMisc.y ) > 1e-4 ) {
    float a = aMisc.y * p.y + uTime * sign( aMisc.y ) * 2.0;
    float c = cos( a ), s = sin( a );
    p.xz = mat2( c, -s, s, c ) * p.xz;
    n.xz = mat2( c, -s, s, c ) * n.xz;
  }
  if ( aMisc.x > 0.0 ) {
    float w = sin( uTime * 4.4 + p.y * 7.0 + aMisc.w * 10.0 ) * 0.6 + sin( uTime * 3.1 + p.x * 9.0 + p.z * 6.0 ) * 0.4;
    p += n * w * aMisc.x;
  }
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4( p, 1.0 );
  vec4 mv = viewMatrix * wp;
  vN = normalize( mat3( viewMatrix ) * mat3( m ) * n );
  vV = normalize( -mv.xyz );
  vUv = uv;
  vColor = aColor; vRim = aRimC; vEdge = aEdge; vNoise = aNoise; vDiss = aDiss; vSeed = aMisc.w;
  gl_Position = projectionMatrix * mv;
}`,qd=`
uniform sampler2D uNoise;
uniform float uTime;
uniform float uShapeKind;
${Fd}
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
varying vec4 vColor; varying vec4 vRim; varying vec4 vEdge; varying vec4 vNoise; varying vec4 vDiss; varying float vSeed;
void main() {
  vec3 N = normalize( vN );
  float ndv = abs( dot( N, normalize( vV ) ) );
  // GLSL pow is undefined below 0: ndv can round past 1 where a face looks straight at the camera, and one NaN
  // fragment, spread by the bloom, blacks out the whole frame (r12 wave A fix)
  float fres = pow( clamp( 1.0 - ndv, 0.0, 1.0 ), max( 0.5, vRim.w ) );
  vec2 sc = vec2( vNoise.y, vNoise.z ) * uTime;
  vec2 uv = vUv * vec2( 1.0, 1.0 ) * vNoise.x;
  float n1 = texture2D( uNoise, uv + sc + vSeed ).r;
  float n2 = texture2D( uNoise, uv * 2.3 - sc * 1.37 + 0.31 + vSeed ).a;
  float nz = clamp( n1 * 0.7 + n2 * 0.5 - 0.1, 0.0, 1.0 );
  float kind = vDiss.y, mp = vDiss.z;
  float mask = 1.0, boost = 0.0;
  if ( kind > 0.5 && kind < 1.5 ) mask = smoothstep( 0.0, mp, vUv.y ) * ( 1.0 - smoothstep( 1.0 - mp, 1.0, vUv.y ) );
  else if ( kind > 1.5 && kind < 2.5 ) mask = smoothstep( 0.0, 0.08, vUv.y ) * ( 1.0 - smoothstep( 1.0 - mp, 1.0, vUv.y ) );
  else if ( kind > 2.5 && kind < 3.5 ) {
    // sweep: a bright head travels u 0 → 1 with a fading tail ("danger edge brightest")
    float head = mp;
    mask = smoothstep( head - 0.55, head - 0.02, vUv.x ) * ( 1.0 - smoothstep( head, head + 0.03, vUv.x ) );
    boost = smoothstep( head - 0.12, head, vUv.x ) * ( 1.0 - smoothstep( head, head + 0.03, vUv.x ) );
  }
  else if ( kind > 3.5 && kind < 4.5 ) mask = smoothstep( 0.0, mp, vUv.y ) * ( 1.0 - smoothstep( 1.0 - mp, 1.0, vUv.y ) ) * 1.0;
  else if ( kind > 4.5 ) { mask = smoothstep( mp - 0.25, mp, vUv.y ) * ( 1.0 - smoothstep( mp, mp + 0.04, vUv.y ) ); boost = mask; }
  float diss = vDiss.x;
  float keep = nz + 0.02 - diss;
  if ( keep < 0.0 ) discard;
  float edge = diss > 0.002 ? 1.0 - smoothstep( 0.0, max( vEdge.w, 0.005 ), keep ) : 0.0;
  float body = mix( 1.0, smoothstep( 0.1, 0.9, nz ), vNoise.w );
  float a = vColor.a * mask * vfxSoft( 0.18 );
  if ( uShapeKind > 1.5 && uShapeKind < 2.5 ) {
    // max VFX-3 erode sleeve (column, shaft, stair): the upper third eats away into rising noise, the alpha sits on the
    // fresnel rim (an inside of 0.3), so the sleeve reads as a sheath of light round the body, open at the top
    float top = smoothstep( 0.45, 1.0, vUv.y );
    if ( nz < top * 1.15 - 0.08 ) discard;
    a *= ( 0.3 + 0.7 * clamp( fres * 1.6, 0.0, 1.0 ) ) * ( 1.0 - top * 0.55 );
  }
  if ( a < 0.002 ) discard;
  float mode = vDiss.w;
  vec3 rgb;
  if ( mode < 0.5 ) {
    rgb = vColor.rgb * body * ( 1.0 + boost * 1.5 ) + vRim.rgb * fres + vEdge.rgb * edge;
    gl_FragColor = vec4( rgb * a, 0.0 );
  } else if ( mode < 1.5 ) {
    float aa = a * mix( 1.0, body, 0.4 );
    rgb = vColor.rgb * ( 0.7 + 0.3 * body ) + vRim.rgb * fres + vEdge.rgb * edge;
    gl_FragColor = vec4( rgb * aa, aa );
  } else {
    float aa = a * clamp( body * 1.25, 0.0, 1.0 );
    float rim = clamp( fres * 1.3, 0.0, 1.0 );
    rgb = vColor.rgb * ( 0.65 + 0.35 * nz ) * ( 1.0 - rim ) + vRim.rgb * rim + vEdge.rgb * edge;
    gl_FragColor = vec4( rgb * aa, aa * ( 1.0 - rim * 0.3 ) );
  }
  gl_FragColor.rgb *= vfxLift();   // combat F4: the envelope never lifts an effect past the body cap
}`,Jd=`
attribute vec4 aPos;   // centre xyz, radius
attribute vec4 aPar;   // mode, strength, age01, seed
attribute vec4 aAx;    // ground (0/1)
varying vec2 vL; varying vec4 vPar; varying vec2 vCentre;
void main() {
  vec2 q = position.xy * 2.0;
  vec4 mv;
  if ( aAx.x > 0.5 ) mv = viewMatrix * vec4( aPos.xyz + vec3( q.x, 0.0, -q.y ) * aPos.w, 1.0 );
  else { mv = viewMatrix * vec4( aPos.xyz, 1.0 ); mv.xy += q * aPos.w; }
  vec4 cc = projectionMatrix * viewMatrix * vec4( aPos.xyz, 1.0 );
  vCentre = cc.xy / cc.w * 0.5 + 0.5;
  vL = q; vPar = aPar;
  gl_Position = projectionMatrix * mv;
}`,Yd=`
uniform sampler2D uNoise;
uniform float uTime;
${Fd}
varying vec2 vL; varying vec4 vPar; varying vec2 vCentre;
void main() {
  float d = length( vL );
  if ( d > 1.0 ) discard;
  vec2 sp = gl_FragCoord.xy / uRes;
  vec2 dir = sp - vCentre;
  float dl = length( dir );
  dir = dl > 1e-5 ? dir / dl : vec2( 0.0 );
  float mode = vPar.x, k = vPar.y;
  vec2 off;
  if ( mode < 0.5 ) {
    float bq = ( d - 0.82 ) / 0.11;
    float band = exp( -bq * bq );
    off = dir * band * k;
  } else if ( mode < 1.5 ) {
    vec2 nuv = vL * 0.6 + vec2( vPar.w, vPar.w * 1.7 ) + vec2( 0.0, -uTime * 0.35 );
    vec2 g = vec2( texture2D( uNoise, nuv ).r - 0.5, texture2D( uNoise, nuv + 0.43 ).a - 0.5 );
    off = g * 2.0 * k * ( 1.0 - smoothstep( 0.4, 1.0, d ) );
  } else {
    off = -dir * sin( d * 3.14159 ) * ( 1.0 - d ) * k * 2.0;
  }
  off *= vfxSoft( 0.0 );
  gl_FragColor = vec4( off, 0.0, 0.0 );
}`,Xd={particle:0,ribbon:1,beam:2,ring:3,decal:4,mesh:5,distort:6},Zd={particle:{vert:Id,frag:Ld,attrs:[`aPos`,`aCol`,`aVel`,`aTex`,`aPar`,`aRim`]},ribbon:{vert:Rd,frag:zd,attrs:[`aCol`,`aUv`,`aPrm`,`aRimC`]},beam:{vert:Bd,frag:Vd,attrs:[`aA`,`aB`,`aC`,`aD`,`aE`]},ring:{vert:Hd,frag:Ud,attrs:[`aPos`,`aSty`,`aCol`,`aMisc`]},decal:{vert:Wd,frag:Gd,attrs:[`aPos`,`aRot`,`aCol`,`aMisc`,`aRimC`]},mesh:{vert:Kd,frag:qd,attrs:[`aColor`,`aRimC`,`aEdge`,`aNoise`,`aDiss`,`aMisc`]},distort:{vert:Jd,frag:Yd,attrs:[`aPos`,`aPar`,`aAx`]}},Qd=il(Object.keys(Xd).map(e=>Zd[e]),[Fd]),$d=[.8,2,3,6,10],ef=new R().setStyle(`#BFD3E6`),tf=[0,0,0,0,0],Z=8e3,nf=96,rf=48,af=64,of=192,sf=160,cf=32,lf=48,uf=48,df=.015,ff=1,pf=4*Math.PI/180,mf=1,hf=class{def;uid=0;t=0;rate=1;sustained=!1;held=!1;sustain=null;remaining=null;rem=1;relT=-1;cancelled=!1;world=!1;prevTarget=new B;tier=2;opacity=1;density=1;secondary=1;team=new R;element=new R;sig=new R;sec=new R;hueFrom=-1;hueBy=0;origin=new B;target=new B;ground=new B;head=new B;prevHead=new B;vel=new B;scale=1;dir=0;follow=-1;following=!1;followFor=-1;targetId=-1;sourceId=-1;loopWhile=-1;anchor=`origin`;phase=`main`;clip=`attack1`;active=!1;fired=new Uint8Array;acc=new Float32Array;last=new Float32Array;el=new Int32Array;grad=new Int32Array;rep=new Float32Array},gf=e=>!!e&&(!e.sustained||e.held),Q=new B,_f=new B,vf=new B,yf=new De,bf=new n,xf=new M,Sf=new B,Cf=new R,wf=new Float32Array(3),Tf=new B(0,1,0),Ef=new B(0,0,1),Df=(e,t)=>e+Math.random()*(t-e),Of={h:0,s:0,l:0},kf={h:0,s:0,l:0},Af={h:0,s:0,l:0};function jf(e,t,n){if(e.getHSL(Af,de),Af.s<.25||Af.l<.08||Af.l>.94)return;let r=Af.h-t;r-=Math.round(r),!(Math.abs(r)>45/360)&&(Af.h>=125/360&&Af.h<=150/360||e.setHSL(((Af.h+n)%1+1)%1,Af.s,Af.l,de))}var Mf=e=>.2126*e.r+.7152*e.g+.0722*e.b,Nf=.13;function Pf(e,t,n){let r=Mf(e);if(r>=Nf)return;let i=Mf(n)>Mf(t)?n:t,a=Mf(i);a<=r+1e-4||e.lerp(i,Math.min(1,(Nf-r)/(a-r)))}function $(e,t){let n=new i(new Float32Array(e*t),t);return n.setUsage(N),n}function Ff(e,t){for(let n of e)n.clearUpdateRanges(),n.addUpdateRange(0,Math.max(1,t)*n.itemSize),n.needsUpdate=!0}function If(e,t={},n=0,r=Pd){return new ve({glslVersion:h,vertexShader:Qd.vert,fragmentShader:Qd.frag,uniforms:{...Nd,uShapeKind:{value:0},...t,uUberKind:{value:Xd[e]}},...r,side:n})}function Lf(e,t,n,r,i){i[0]=Math.sin(t*1.7+r*1.3)+Math.sin(n*2.3-r*.7)*.6,i[1]=Math.sin(n*1.9+r*1.1)*.5+Math.sin(e*2.1+r*.9)*.4,i[2]=Math.sin(e*1.5-r*1.2)+Math.sin(t*2.7+r*.6)*.6}var Rf=new Float32Array(3),zf=class{group=new _;scene=new L;textures=new Ju;liftCap=Xa;budget=4e3;secondaryDensity=1;density=1;onFeel=null;defs=new Map;world;camera=null;insts=[];free=[];grads=new nd;now=0;pn=0;P={x:new Float32Array(Z),y:new Float32Array(Z),z:new Float32Array(Z),vx:new Float32Array(Z),vy:new Float32Array(Z),vz:new Float32Array(Z),age:new Float32Array(Z),life:new Float32Array(Z),sv:new Float32Array(Z),rot:new Float32Array(Z),spin:new Float32Array(Z),seed:new Float32Array(Z),slot:new Int32Array(Z),layer:new Int32Array(Z),op:new Float32Array(Z),cap:new Float32Array(Z),cx:new Float32Array(Z),cy:new Float32Array(Z),cz:new Float32Array(Z),cell:new Float32Array(Z),rim:new Int32Array(Z)};pInst=Array(Z).fill(null);emitters=[];emitterIndex=new Map;rimPool=new Float32Array(3072);rimNext=0;pDraw;ribbons=[];ribDraw;beams=[];beamDraw;rings=[];ringDraw;decals=[];decalDraw;meshEls=[];shapeDraws=new Map;lights=[];distorts=[];distortScene=new L;distortDraw;distortRT=null;distortN=0;byUid=new Map;_res=new O;redefine(e){for(let t of e){let e=Md(t);this.defs.set(t.id,e);for(let t of e.layers)t.type===`emitter`&&!this.emitterIndex.has(t)&&(this.emitterIndex.set(t,this.emitters.length),this.emitters.push(t))}}set reduceMotion(e){oo.reduceMotion=e}get reduceMotion(){return oo.reduceMotion}get screen(){return{fx:oo,uniforms:Za}}constructor(e,t){this.world=t,this.redefine(e),this.group.name=`vale_vfx_lights`,this.scene.name=`vale_vfx`,Nd.uAtlas.value=this.textures.atlas,Nd.uNoise.value=this.textures.noise;let n=new me(1,1),r=()=>{let e=new j;return e.index=n.index,e.setAttribute(`position`,n.getAttribute(`position`)),e.instanceCount=0,e};{let e=r(),t=$(Z,4),n=$(Z,4),i=$(Z,4),a=$(Z,4),o=$(Z,4),s=$(Z,4);al(e,Zd.particle,{aPos:t,aCol:n,aVel:i,aTex:a,aPar:o,aRim:s});let c=new I(e,If(`particle`));c.frustumCulled=!1,c.renderOrder=12,c.name=`vfx_particles`,this.scene.add(c),this.pDraw={geo:e,mesh:c,aPos:t,aCol:n,aVel:i,aTex:a,aPar:o,aRim:s}}{let e=new Ee,t=e=>{let t=new F(new Float32Array(9216*e),e);return t.setUsage(N),t},n=t(3),r=t(4),i=t(4),a=t(4),o=t(4);e.setAttribute(`position`,n),al(e,Zd.ribbon,{aCol:r,aUv:i,aPrm:a,aRimC:o});let s=[];for(let e=0;e<nf;e++)for(let t=0;t<47;t++){let n=(e*rf+t)*2;s.push(n,n+1,n+2,n+1,n+3,n+2)}e.setIndex(s),e.setDrawRange(0,0);let c=new I(e,If(`ribbon`,{},2));c.frustumCulled=!1,c.renderOrder=10,c.name=`vfx_ribbons`,this.scene.add(c),this.ribDraw={mesh:c,geo:e,pos:n,col:r,uv:i,prm:a,rim:o};for(let e=0;e<nf;e++)this.ribbons.push({on:!1,inst:null,layer:null,n:0,xs:new Float32Array(rf),ys:new Float32Array(rf),zs:new Float32Array(rf),ts:new Float32Array(rf),ds:new Float32Array(rf),slot:0,opacity:1,cap:1,seed:0,rim:new R,born:0,rate:1,s:1,arcF:-1,arcT:0})}{let e=[],t=[];for(let t=0;t<=32;t++)e.push(t/32,-.5,0,t/32,.5,0);for(let e=0;e<32;e++){let n=e*2;t.push(n,n+1,n+2,n+1,n+3,n+2)}let n=new j;n.setAttribute(`position`,new F(new Float32Array(e),3)),n.setIndex(t),n.instanceCount=0;let r=$(af,4),i=$(af,4),a=$(af,4),o=$(af,4),s=$(af,4);al(n,Zd.beam,{aA:r,aB:i,aC:a,aD:o,aE:s});let c=new I(n,If(`beam`,{},2));c.frustumCulled=!1,c.renderOrder=12,c.name=`vfx_beams`,this.scene.add(c),this.beamDraw={mesh:c,geo:n,aA:r,aB:i,aC:a,aD:o,aE:s};for(let e=0;e<af;e++)this.beams.push({on:!1,inst:null,l:null,a:new B,b:new B,age:0,slot:0,opacity:1,cap:1,seed:0,rate:1})}{let e=r(),t=$(of,4),n=$(of,4),i=$(of,4),a=$(of,4);al(e,Zd.ring,{aPos:t,aSty:n,aCol:i,aMisc:a});let o=new I(e,If(`ring`,{},2));o.frustumCulled=!1,o.renderOrder=9,o.name=`vfx_rings`,this.scene.add(o),this.ringDraw={mesh:o,geo:e,aPos:t,aSty:n,aCol:i,aMisc:a};for(let e=0;e<of;e++)this.rings.push({on:!1,l:null,x:0,y:0,z:0,age:0,s:1,slot:0,opacity:1,cap:1,seed:0,rate:1})}{let e=r(),t=$(sf,4),n=$(sf,4),i=$(sf,4),a=$(sf,4),o=$(sf,4);al(e,Zd.decal,{aPos:t,aRot:n,aCol:i,aMisc:a,aRimC:o});let s=new I(e,If(`decal`,{},2));s.frustumCulled=!1,s.renderOrder=8,s.name=`vfx_decals`,this.scene.add(s),this.decalDraw={mesh:s,geo:e,aPos:t,aRot:n,aCol:i,aMisc:a,aRimC:o};for(let e=0;e<sf;e++)this.decals.push({on:!1,l:null,x:0,z:0,rot:0,age:0,s:1,slot:0,opacity:1,cap:1,seed:0,rim:new R,rate:1,inst:null,sus:!1,path:!1,rem:1})}for(let e=0;e<192;e++)this.meshEls.push({on:!1,l:null,inst:null,pos:new B,q:new De,age:0,s:1,slot:0,opacity:1,cap:1,spinA:0,seed:0,rim:new R,edge:new R,follow:!1,rate:1});{let e=r(),t=$(uf,4),n=$(uf,4),i=$(uf,4);al(e,Zd.distort,{aPos:t,aPar:n,aAx:i});let a=If(`distort`,{},2,{transparent:!0,depthWrite:!1,depthTest:!1,blending:5,blendEquation:100,blendSrc:201,blendDst:201}),o=new I(e,a);o.frustumCulled=!1,this.distortScene.add(o),this.distortDraw={mesh:o,geo:e,aPos:t,aPar:n,aAx:i};for(let e=0;e<uf;e++)this.distorts.push({on:!1,l:null,inst:null,pos:new B,age:0,s:1,rate:1,seed:0,opacity:1})}}has(e){return!!e&&this.defs.has(e)}def(e){return this.defs.get(e)}get ids(){return[...this.defs.keys()]}setCamera(e){this.camera=e}setLightCount(e){for(let e of this.lights)this.group.remove(e.light),e.light.dispose();this.lights=[];for(let t=0;t<e;t++){let e=new ge(16777215,0,6,2);e.castShadow=!1,this.group.add(e),this.lights.push({light:e,age:1,life:0,attack:0,peak:0,flicker:0})}}get particleCount(){return this.pn}get instanceCount(){return this.insts.length}spawn(e,t){return this.spawnHandle(e,t)>0}spawnHandle(e,t){if(!e)return 0;let n=this.defs.get(e);if(!n)return 0;let r=this.free.pop()??new hf;if(r.def=n,r.uid=mf++,r.t=0,r.rate=t.timeScale&&t.timeScale>0&&Number.isFinite(t.timeScale)?Math.min(20,t.timeScale):1,r.sustain=t.sustain??null,r.remaining=t.remaining??null,r.rem=1,r.sustained=!!t.sustain,r.held=!!t.sustain,r.relT=-1,r.cancelled=!1,r.world=!!t.world,r.tier=t.tier,r.opacity=t.ally?.65:t.ownT1?.85:1,r.secondary=t.ally?.5:1,r.density=this.density*(t.ally?.75:1),r.team.copy(t.team),r.element.copy(t.element??t.team),r.sig.copy(t.signature??t.team),r.sec.copy(t.secondary??t.signature??t.team),r.hueFrom=-1,r.hueBy=0,t.hueFrom&&t.signature){let e=t.hueFrom.getHSL(Of,de).h,n=t.signature.getHSL(kf,de).h-e;n-=Math.round(n),Math.abs(n)>1/360&&(r.hueFrom=e,r.hueBy=n)}let i=t.ground??t.origin??t.target??Q.set(0,0,0);r.origin.copy(t.origin??i),r.target.copy(t.target??i),r.ground.copy(t.ground??i),r.ground.y=0,r.scale=t.scale&&t.scale>0?t.scale:1,r.dir=t.dir??0,r.follow=t.follow??-1,r.following=r.follow!==-1,r.followFor=t.followFor??-1,r.targetId=t.targetId??-1,r.sourceId=t.sourceId??-1,r.loopWhile=t.loopWhile??-1,r.anchor=t.anchor??`origin`,r.phase=t.phase??`main`,r.clip=t.clip??`attack1`,r.phase===`release`&&(r.sustain=null,r.sustained=!0,r.held=!1,r.relT=0),r.following&&this.world.entityPos(r.follow,r.head)?r.prevHead.copy(r.head):(r.head.copy(r.origin),r.prevHead.copy(r.origin)),r.vel.set(0,0,0);let a=n.layers.length;return r.fired.length<a&&(r.fired=new Uint8Array(a),r.acc=new Float32Array(a),r.last=new Float32Array(a*3),r.el=new Int32Array(a),r.grad=new Int32Array(a),r.rep=new Float32Array(a)),r.fired.fill(0),r.acc.fill(0),r.el.fill(-1),r.grad.fill(-1),r.rep.fill(0),r.prevTarget.copy(r.target),r.active=!0,this.insts.push(r),this.byUid.set(r.uid,r),r.uid}isHeld(e){let t=this.byUid.get(e);return!!t&&t.active&&t.held}isAlive(e){let t=this.byUid.get(e);return!!t&&t.active}release(e,t=!1){let n=this.byUid.get(e);n&&n.active&&this.releaseInst(n,t)}releaseInst(e,t){if(e.sustain=null,e.held=!1,e.relT<0&&(e.relT=e.t),!t||e.cancelled)return;e.cancelled=!0;for(let t of this.meshEls)t.on&&t.inst===e&&t.l&&(t.inst=null,t.follow=!1,t.age=Math.max(t.age,t.l.life-.1*t.rate));for(let t of this.decals)t.on&&t.inst===e&&t.l&&(t.inst=null,t.age=Math.max(t.age,t.l.life-.1*t.rate));for(let t of this.beams)t.on&&t.inst===e&&t.l&&(t.inst=null,t.age=Math.max(t.age,t.l.life-.1*t.rate));for(let t of this.ribbons)t.inst===e&&(t.inst=null);for(let t of this.distorts)t.on&&t.inst===e&&t.l&&(t.inst=null,t.age=Math.max(t.age,t.l.life-.1*t.rate));let n=this.P;for(let t=0;t<this.pn;t++)this.pInst[t]===e&&(n.life[t]=Math.min(n.life[t],n.age[t]+.1))}resolve(e,t,n){return!e||e.k===1?n.copy(t.team):e.k===0?(n.copy(e.c),t.hueFrom>=0&&jf(n,t.hueFrom,t.hueBy)):e.k===3?n.copy(t.sig):e.k===4?n.copy(t.sec):e.k===5?n.copy(t.hueFrom>=0?t.element:e.c):n.copy(t.element),t.tier<4&&n.r>.88&&n.g>.88&&n.b>.88&&n.copy(ef),n}bake(e,t,n,r=!1){if(e.grad[t]>=0)return e.grad[t];let i=this.grads.bake(n,(t,n)=>(this.resolve(t,e,n),r&&t&&(t.k===3||t.k===4)&&Pf(n,e.sig,e.sec),n));return e.grad[t]=i,i}rimSlot(e){let t=this.rimNext;return this.rimNext=(this.rimNext+1)%1024,this.rimPool[t*3]=e.r,this.rimPool[t*3+1]=e.g,this.rimPool[t*3+2]=e.b,t}cap(e){return $d[e.tier]}capE(e,t){return e.tier>=4?Math.max(t,0):Math.min($d[e.tier],t)}anchorPos(e,t,n){let r=t.at??(t.type===`ribbon`?`path`:e.anchor);switch(r){case`target`:n.copy(e.target);break;case`path`:n.copy(e.head);break;case`ground`:n.copy(e.ground);break;case`caster`:e.sourceId>=0&&this.world.entityPos(e.sourceId,n)||n.copy(e.origin);break;default:n.copy(e.origin)}if(t.socket&&this.world.socketPos){let i=r===`target`?e.targetId:e.sourceId>=0?e.sourceId:e.follow;i>=0&&this.world.socketPos(i,t.socket,n)}if(t.offset){let r=t.offset[0],i=t.offset[1],a=t.offset[2],o=Math.cos(e.dir),s=Math.sin(e.dir);n.x+=o*r-s*a,n.y+=i,n.z+=s*r+o*a}return n}atOf(e,t){return t.at??(t.type===`ribbon`?`path`:e.anchor)}fitOf(e,t){let n=this.atOf(e,t);return t.fit??n===`ground`?e.scale:1}emit(e,t,n,r){if(r<=0)return;let i=this.P,a=this.atOf(e,n),o=this.anchorPos(e,n,vf);a===`ground`&&(o.y=Math.max(o.y,.06));let s=this.fitOf(e,n),c=this.bake(e,t,n.color,n.blend===1||n.blend===3),l=n.rim?this.rimSlot(this.resolve(n.rim,e,Cf)):-1,u=this.emitterIndex.get(n)??0,d=Math.cos(e.dir),f=Math.sin(e.dir),p=0,m=0,h=0;e.vel.lengthSq()>1e-4&&(_f.copy(e.vel).normalize(),p=_f.x,m=_f.y,h=_f.z);let g=n.legacy&&a===`ground`?Math.min(2.5,Math.max(1,e.scale*.5)):1;for(let t=0;t<r;t++){if(this.pn>=Math.min(Z,this.budget))return;let t=this.pn++,r=0,_=0,v=0,y=0,b=1,x=0,S=n.radius*s;switch(n.shape){case fd.sphere:{let e=Math.random()*2-1,t=Math.random()*Math.PI*2,i=Math.sqrt(1-e*e);y=i*Math.cos(t),b=e,x=i*Math.sin(t);let a=n.surface?S:S*Math.cbrt(Math.random());r=y*a,_=b*a,v=x*a;break}case fd.ring:case fd.disc:case fd.aura:{let e=Math.random()*Math.PI*2,t=n.shape===fd.ring?Math.max(n.radiusInner*s,S*.92):n.radiusInner*s,i=n.shape===fd.ring||n.surface?Df(t,S):Math.sqrt(Df((t/Math.max(S,1e-4))**2,1))*S;y=Math.cos(e),x=Math.sin(e),b=0,r=y*i,v=x*i,_=n.shape===fd.aura?Math.random()*(n.height||1.6):0;break}case fd.cone:{let e=n.angle*.5,t=Df(-e,e),i=Math.random()*n.length*s,a=Math.sin(t),o=Math.cos(t);r=o*i*d-a*i*f,v=o*i*f+a*i*d,y=r,x=v,b=0;let c=Math.hypot(y,x)||1;y/=c,x/=c;break}case fd.line:{let e=Math.random()*n.length*s,t=(Math.random()-.5)*n.width*s;r=d*e-f*t,v=f*e+d*t,y=d,x=f,b=0;break}case fd.path:{let t=Math.random();r=(e.prevHead.x-e.head.x)*t,_=(e.prevHead.y-e.head.y)*t,v=(e.prevHead.z-e.head.z)*t;break}default:n.legacy&&a===`ground`&&(r=(Math.random()-.5)*.3*e.scale,v=(Math.random()-.5)*.3*e.scale)}i.x[t]=o.x+r,i.y[t]=o.y+_,i.z[t]=o.z+v,i.cx[t]=o.x,i.cy[t]=o.y,i.cz[t]=o.z;let C=0,w=1,T=0;switch(n.dir){case pd.out:{let e=Math.hypot(y,b,x);e>1e-4&&(C=y/e,w=b/e,T=x/e);break}case pd.in:{let e=Math.hypot(y,b,x);e>1e-4&&(C=-y/e,w=-b/e,T=-x/e);break}case pd.forward:C=d,w=0,T=f;break;case pd.back:p||m||h?(C=-p,w=-m*.5+.2,T=-h):(C=-d,w=0,T=-f);break;case pd.down:w=-1;break;case pd.normal:C=y,w=b,T=x;break;case pd.random:{let e=Math.random()*2-1,t=Math.random()*Math.PI*2,n=Math.sqrt(1-e*e);C=n*Math.cos(t),w=e,T=n*Math.sin(t);break}case pd.none:C=0,w=0,T=0}let E=C,D=w,O=T,ee=Math.hypot(C,w,T);if(ee>1e-4&&n.spread>0){C/=ee,w/=ee,T/=ee;let e=Math.cos(Math.random()*n.spread*.5),t=Math.sqrt(Math.max(0,1-e*e)),r=Math.random()*Math.PI*2,i=1,a=0;Math.abs(C)>.9&&(i=0,a=1);let o=w*0-T*a,s=T*i-C*0,c=C*a-w*i,l=Math.hypot(o,s,c)||1;o/=l,s/=l,c/=l;let u=w*c-T*s,d=T*o-C*c,f=C*s-w*o;E=C*e+(o*Math.cos(r)+u*Math.sin(r))*t,D=w*e+(s*Math.cos(r)+d*Math.sin(r))*t,O=T*e+(c*Math.cos(r)+f*Math.sin(r))*t}let k=Df(n.speed[0],n.speed[1])*g*(n.legacy?1:Math.max(1,Math.sqrt(s))),te=n.velocity[0],A=n.velocity[1],j=n.velocity[2];i.vx[t]=E*k+d*te-f*j+e.vel.x*n.inherit,i.vy[t]=D*k+A+e.vel.y*n.inherit,i.vz[t]=O*k+f*te+d*j+e.vel.z*n.inherit,i.age[t]=0,i.life[t]=Df(n.life[0],n.life[1])/(n.fitTime?e.rate:1),i.sv[t]=Df(n.sizeVar[0],n.sizeVar[1])*(n.legacy?1:Math.min(2.5,Math.sqrt(s))),i.rot[t]=Df(n.rot[0],n.rot[1]),i.spin[t]=Df(n.spin[0],n.spin[1]),i.seed[t]=Math.random(),i.slot[t]=c,i.layer[t]=u,i.op[t]=e.opacity,i.cap[t]=e.tier>=4?1e3:this.cap(e),i.cell[t]=n.tex.cell+(n.tex.variants?Math.floor(Math.random()*n.tex.frames):0)+(n.frame>=0&&!n.tex.variants?Math.min(n.frame,n.tex.frames-1):0),i.rim[t]=l,this.pInst[t]=n.local||n.follow?e:null}}fireEmitter(e,t,n,r,i){let a=e.density*(n.secondary?e.secondary*this.secondaryDensity:1),o=this.atOf(e,n);if(!e.fired[t]){if(e.fired[t]=1,Math.random()>n.chance){e.acc[t]=-1;return}let r=this.anchorPos(e,n,Q);e.last[t*3]=r.x,e.last[t*3+1]=r.y,e.last[t*3+2]=r.z,n.legacy&&o===`path`&&e.following||this.emit(e,t,n,Math.max(+(n.count>0),Math.round(n.count*a)))}if(e.acc[t]<0)return;let s=i;for(let[i,o]of n.bursts)s-r<i&&s>=i&&this.emit(e,t,n,Math.max(1,Math.round(o*a)));let c=n.duration>=0?n.duration:e.def.duration,l=n.duration>=0?s<=c:e.sustained?e.held:s<=c,u=n.rate;if(n.legacy&&o===`path`&&e.following&&(u=Math.max(1,Math.round(n.count*a))/Math.max(.2,e.def.duration)),u>0&&(l||o===`path`&&e.following||e.loopWhile>=0)){e.acc[t]+=u*(n.legacy?1:a)*r;let i=Math.floor(e.acc[t]);i>0&&(e.acc[t]-=i,this.emit(e,t,n,i))}if(n.perMeter>0){let r=this.anchorPos(e,n,Q),i=e.last[t*3],o=e.last[t*3+1],s=e.last[t*3+2],c=Math.hypot(r.x-i,r.y-o,r.z-s);e.acc[t]+=c*n.perMeter*a,e.last[t*3]=r.x,e.last[t*3+1]=r.y,e.last[t*3+2]=r.z;let l=Math.floor(e.acc[t]);l>0&&(e.acc[t]-=l,this.emit(e,t,n,Math.min(l,64)))}}fireLayer(e,t,n){let r=e.def.layers[t];if(r.clip&&!r.clip.includes(e.clip))return;let i;if(r.release){if(e.relT<0||e.cancelled||(i=e.t-e.relT-r.delay,i<0))return}else{if(e.phase===`release`||r.windup!==(e.phase===`windup`)||e.cancelled)return;i=e.t-r.delay}if(r.repeat>0&&(e.fired[t]&&i>=e.rep[t]&&(e.sustained?e.held:e.t<e.def.duration)&&(e.fired[t]=0,e.acc[t]=0),e.fired[t]||(e.rep[t]=i+r.repeat)),r.type===`emitter`){this.fireEmitter(e,t,r,n,i);return}let a=this.atOf(e,r);if(r.type===`ribbon`||r.type===`mesh`&&(a===`path`||r.follow)||(r.type===`decal`||r.type===`distort`)&&r.follow){if(e.fired[t]){this.trackElement(e,t,r);return}}else if(e.fired[t])return;if(e.fired[t]=1,Math.random()>r.chance)return;let o=this.fitOf(e,r);switch(r.type){case`ribbon`:{let n=this.ribbons.find(e=>!e.on);if(!n)return;if(n.on=!0,n.inst=e,n.layer=r,n.n=0,n.slot=this.bake(e,t,r.color,r.blend===1||r.blend===3),n.opacity=e.opacity,n.cap=this.cap(e),n.seed=Math.random(),n.born=this.now,n.rate=r.fitTime?e.rate:1,n.s=r.fit?e.scale:1,r.rim&&this.resolve(r.rim,e,n.rim),e.el[t]=this.ribbons.indexOf(n),r.arc){n.arcF=0,n.arcT=this.now,this.ribPush(n,this.arcPoint(e,r,0,Q));return}n.arcF=-1,this.ribPush(n,this.anchorPos(e,r,Q));return}case`beam`:{if((r.from===`caster`||r.to===`caster`)&&e.sourceId<0&&e.targetId>=0)return;let n=this.beams.find(e=>!e.on);if(!n)return;n.on=!0,n.inst=e,n.l=r,n.age=0,n.slot=this.bake(e,t,r.color,r.blend===1||r.blend===3),n.opacity=e.opacity,n.cap=this.cap(e),n.seed=Math.random(),n.rate=r.fitTime?e.rate:1,this.beamEnds(e,n);return}case`shockwave`:{let n=this.rings.find(e=>!e.on);if(!n)return;let i=this.anchorPos(e,r,Q);n.on=!0,n.l=r,n.x=i.x,n.y=r.vertical||a===`path`?i.y:.06,n.z=i.z,n.age=0,n.s=o,n.slot=this.bake(e,t,r.color,r.blend===1||r.blend===3),n.opacity=e.opacity,n.cap=this.cap(e),n.seed=Math.random(),n.rate=r.fitTime?e.rate:1;return}case`decal`:{let n=a===`path`&&r.follow&&r.style===Td.light;if(e.tier<=1&&!n)return;if(n){let e=0;for(let t of this.decals)if(!t.on&&++e>cf)break;if(e<=cf)return}let i=this.decals.find(e=>!e.on);if(!i)return;let s=this.anchorPos(e,r,Q);i.on=!0,i.l=r,i.x=s.x,i.z=s.z,i.rot=e.dir+(r.spinRandom?Math.random()*Math.PI*2:r.rotate),i.age=0,i.s=o,i.slot=this.bake(e,t,r.color),i.opacity=e.opacity,i.cap=this.cap(e),i.seed=Math.random(),i.rate=r.fitTime?e.rate:1,i.inst=e.sustained||r.follow?e:null,i.sus=e.sustained&&r.hold>0,i.path=n,i.rem=e.rem,this.resolve(r.rim??null,e,i.rim),r.rim||i.rim.copy(e.team),e.el[t]=this.decals.indexOf(i);return}case`mesh`:{let n=this.meshEls.find(e=>!e.on);if(!n)return;let i=this.anchorPos(e,r,Q);n.on=!0,n.l=r,n.follow=a===`path`||r.follow,n.inst=n.follow||e.sustained?e:null,n.rate=r.fitTime?e.rate:1,n.pos.copy(i),a===`ground`&&(n.pos.y=.02),n.age=0,n.s=o,n.slot=this.bake(e,t,r.color,r.blend===1||r.blend===3),n.opacity=e.opacity,n.cap=this.cap(e),n.spinA=0,n.seed=Math.random(),r.rim?this.resolve(r.rim,e,n.rim):n.rim.setRGB(0,0,0),r.edge?this.resolve(r.edge,e,n.edge):n.edge.copy(e.team),this.orientMesh(n,e,r),e.el[t]=this.meshEls.indexOf(n);return}case`light`:this.fireLight(e,r);return;case`feel`:this.fireFeel(e,r);return;case`distort`:{if(!oo.distortAllowed||e.tier<3)return;let n=this.distorts.find(e=>!e.on);if(!n)return;n.on=!0,n.l=r,n.age=0,n.s=o,n.rate=r.fitTime?e.rate:1,n.seed=Math.random(),n.opacity=e.opacity,n.inst=e.sustained||r.follow?e:null,this.anchorPos(e,r,n.pos),r.ground&&(n.pos.y=.05),e.el[t]=this.distorts.indexOf(n);return}default:return}}trackElement(e,t,n){let r=e.el[t];if(!(r<0||!e.following&&this.atOf(e,n)===`path`)){if(n.type===`ribbon`){let t=this.ribbons[r];if(!t.on||t.inst!==e)return;if(n.arc){this.arcTrack(e,n,t);return}if(n.span>0&&e.t-n.delay>n.span){t.inst=null;return}this.ribPush(t,this.anchorPos(e,n,Q))}else if(n.type===`mesh`){let t=this.meshEls[r];t.on&&t.inst===e&&t.follow&&(this.anchorPos(e,n,t.pos),this.orientMesh(t,e,n))}else if(n.type===`decal`){let t=this.decals[r];t.on&&t.inst===e&&(this.anchorPos(e,n,Q),t.x=Q.x,t.z=Q.z)}else if(n.type===`distort`){let t=this.distorts[r];t.on&&t.inst===e&&(this.anchorPos(e,n,t.pos),n.ground&&(t.pos.y=.05))}}}arcPoint(e,t,n,r){let i=t.arc,a=e.sourceId;a>=0&&this.world.socketPos?.(a,`origin`,r)||(a>=0&&this.world.entityPos(a,r)||r.copy(e.origin),r.y=0);let o=i.a0+(i.a1-i.a0)*n,s=Math.cos(e.dir),c=Math.sin(e.dir),l=Math.cos(i.tilt),u=Math.sin(i.tilt),d=Math.cos(o)*i.r,f=Math.sin(o)*i.r;return r.x+=d*s-f*c*l,r.y=Math.max(.08,r.y+i.h+f*u),r.z+=d*c+f*s*l,r}arcTrack(e,t,n){let r=t.arc,i=Math.min(1,Math.max(0,(e.t-t.delay)/(t.span>0?t.span:.3))),a=i**+r.ease,o=Math.min(24,Math.max(1,Math.ceil(Math.abs(a-n.arcF)*Math.abs(r.a1-r.a0)/pf))),s=n.arcF,c=n.arcT;if(a>s)for(let r=1;r<=o;r++)this.ribPush(n,this.arcPoint(e,t,s+(a-s)*r/o,Q)),n.ts[n.n-1]=c+(this.now-c)*r/o;n.arcF=a,n.arcT=this.now,i>=1&&(n.inst=null)}orientMesh(e,t,n){n.align===Sd.velocity||this.atOf(t,n)===`path`&&t.vel.lengthSq()>1e-4?(_f.copy(t.vel),_f.lengthSq()<1e-6&&_f.set(Math.cos(t.dir),0,Math.sin(t.dir)),e.q.setFromUnitVectors(Ef,_f.normalize())):n.align===Sd.up?e.q.identity():e.q.setFromAxisAngle(Tf,Math.PI/2-t.dir),(n.rotate[0]||n.rotate[1]||n.rotate[2])&&e.q.multiply(yf.setFromEuler(bf.set(n.rotate[0],n.rotate[1],n.rotate[2])))}beamEnds(e,t){let n=t.l,r={...n,at:n.from};this.anchorPos(e,r,t.a),n.to?this.anchorPos(e,{...n,at:n.to,offset:null},t.b):t.b.copy(e.targetId>=0||e.anchor===`target`?e.target:e.head),t.b.distanceToSquared(t.a)<1e-4&&t.b.copy(t.a).add(_f.set(Math.cos(e.dir),0,Math.sin(e.dir)).multiplyScalar(4))}fireLight(e,t){if(!this.lights.length)return;let n=Math.min(t.intensity,e.tier>=4?40:$d[e.tier]*5)*e.opacity,r=this.lights.find(e=>e.age>=e.life)??this.lights.reduce((e,t)=>!e||t.light.intensity<e.light.intensity?t:e,null);if(!r||r.age<r.life&&r.light.intensity>n)return;let i=this.anchorPos(e,t,Q);r.light.position.copy(i).y+=this.atOf(e,t)===`ground`?.6:.3,this.resolve(t.color,e,r.light.color),r.light.distance=t.radius*Math.max(1,Math.sqrt(this.fitOf(e,t)));let a=t.fitTime?e.rate:1;r.age=0,r.life=t.life/a,r.attack=t.attack/a,r.flicker=t.flicker,r.peak=n}fireFeel(e,t){let n=this.anchorPos(e,t,new B);if(t.exposure>1&&oo.pulse(n.setY(Math.max(0,n.y*.5)),t.exposureRadius*this.fitOf(e,t),{peak:t.exposure,hold:t.exposureHold,fade:t.exposureFade,dip:t.exposureDip,desat:t.exposureDesat}),!this.onFeel)return;let r=e.world?t.shake:t.shake*tf[e.tier];this.onFeel({shake:r,all:t.who===1,hitFlash:t.hitFlash,hitStop:t.hitStop,squash:t.squash,at:n})}exposurePulse(e,t,n){oo.pulse(e,t,n)}ribPush(e,t){let n=e.layer;if(e.n>0){let r=e.n-1;if(Math.hypot(t.x-e.xs[r],t.y-e.ys[r],t.z-e.zs[r])<(n.arc?.015:n.minDist)&&e.n>1){e.xs[r]=t.x,e.ys[r]=t.y,e.zs[r]=t.z,e.ts[r]=this.now,e.ds[r]=e.ds[r-1]+Math.hypot(t.x-e.xs[r-1],t.y-e.ys[r-1],t.z-e.zs[r-1]);return}}if(e.n>=rf){for(let t of[e.xs,e.ys,e.zs,e.ts,e.ds])t.copyWithin(0,1);e.n=47}let r=e.n;e.xs[r]=t.x,e.ys[r]=n.flat?.05:t.y,e.zs[r]=t.z,e.ts[r]=this.now,e.ds[r]=r>0?e.ds[r-1]+Math.hypot(t.x-e.xs[r-1],e.ys[r]-e.ys[r-1],t.z-e.zs[r-1]):0,e.n++}update(e){let t=Math.min(.1,Math.max(0,e));this.now+=t,Nd.uTime.value=this.now;for(let e=this.insts.length-1;e>=0;e--){let n=this.insts[e];if(n.sustain){let e=!1;try{e=n.sustain()}catch{e=!1}e||this.releaseInst(n,!1)}if(n.t+=t*n.rate,n.remaining){let e=0;try{e=n.remaining()}catch{e=0}n.rem=Number.isFinite(e)?Math.max(0,Math.min(1,e)):0,!n.held&&n.sustained&&(n.rem=0)}else n.rem=Math.max(0,1-n.t/Math.max(.05,n.def.duration));if(n.following&&n.followFor>=0&&n.t>n.followFor){n.following=!1;for(let e of this.meshEls)e.inst===n&&(e.inst=null,e.follow=!1);for(let e of this.ribbons)e.inst===n&&(e.inst=null)}if(n.following){if(n.prevHead.copy(n.head),this.world.entityPos(n.follow,n.head))t>0&&n.vel.copy(n.head).sub(n.prevHead).divideScalar(t);else{n.following=!1,n.head.copy(n.prevHead);for(let e=0;e<n.def.layers.length;e++){let t=n.el[e],r=n.def.layers[e];if(t>=0&&r.type===`mesh`){let e=this.meshEls[t];e.inst===n&&(e.inst=null,e.follow=!1,e.age=Math.max(e.age,r.life-.1))}}}}n.targetId>=0&&(n.prevTarget.copy(n.target),this.world.entityPos(n.targetId,n.target)&&!n.following&&t>0&&(Q.copy(n.target).sub(n.prevTarget).divideScalar(t),Q.lengthSq()<400&&n.vel.lerp(Q,.35)));let r=n.def.layers;for(let e=0;e<r.length;e++)(r[e].release||n.t>=r[e].delay)&&this.fireLayer(n,e,t);for(let e of this.beams)e.on&&e.inst===n&&this.beamEnds(n,e);if(n.loopWhile>=0&&n.t>=n.def.duration){if(this.world.entityPos(n.loopWhile,Q)){n.t=0,n.fired.fill(0),n.acc.fill(0),n.grad.fill(-1),n.ground.set(Q.x,0,Q.z);continue}n.loopWhile=-1}if(n.cancelled||n.phase===`release`&&n.t>=n.def.relSpan+.05||!n.following&&n.loopWhile<0&&!n.held&&n.t>=n.def.span+.05&&(!n.sustained||n.t>=n.relT+ff*n.rate)){for(let e of this.ribbons)e.inst===n&&(e.inst=null);for(let e of this.meshEls)e.inst===n&&(e.inst=null,e.follow=!1);for(let e of this.beams)e.inst===n&&(e.inst=null);for(let e of this.decals)e.inst===n&&(e.inst=null);for(let e of this.distorts)e.inst===n&&(e.inst=null);n.active=!1,n.sustain=null,this.byUid.delete(n.uid),this.insts.splice(e,1),this.free.push(n)}}this.updateParticles(t),this.updateRibbons(),this.updateElements(t),this.updateDistorts(t),oo.update(t,this.camera,this.camera?this.camera.aspect:16/9);for(let e of this.lights){if(e.age>=e.life){e.light.intensity=0;continue}e.age+=t;let n=e.age/Math.max(.001,e.life),r=e.attack>0?Math.min(1,e.age/e.attack):1,i=e.flicker>0?1-e.flicker*(.5+.5*Math.sin(this.now*37+e.peak)):1;e.light.intensity=e.peak*r*(1-n)*(1-n)*i}}updateParticles(e){let t=this.P,n=this.pn;for(let r=0;r<n;r++){t.age[r]+=e;let i=this.pInst[r];if(i&&i.sustained&&i.held){let e=this.emitters[t.layer[r]];e.hold>0&&!e.repeat&&t.age[r]>t.life[r]*e.hold&&(t.age[r]=t.life[r]*e.hold)}if(t.age[r]>=t.life[r]){n--,r!==n&&this.moveParticle(n,r),r--;continue}let a=this.emitters[t.layer[r]],o=this.pInst[r];if(o){if(o.active&&o.def.layers.includes(a)){let e=this.anchorPos(o,a,Q);this.atOf(o,a)===`ground`&&(e.y=Math.max(e.y,.06)),t.x[r]+=e.x-t.cx[r],t.y[r]+=e.y-t.cy[r],t.z[r]+=e.z-t.cz[r],t.cx[r]=e.x,t.cy[r]=e.y,t.cz[r]=e.z}else this.pInst[r]=null}let s=a.drag>0?Math.exp(-a.drag*e):1;if(t.vx[r]*=s,t.vy[r]*=s,t.vz[r]*=s,t.vy[r]-=a.gravity*e,a.turb>0&&(Lf(t.x[r]*a.turbScale,t.y[r]*a.turbScale,t.z[r]*a.turbScale,this.now+t.seed[r]*10,Rf),t.vx[r]+=Rf[0]*a.turb*e,t.vy[r]+=Rf[1]*a.turb*e,t.vz[r]+=Rf[2]*a.turb*e),a.orbit!==0||a.radial!==0){let n=t.x[r]-t.cx[r],i=t.z[r]-t.cz[r],o=Math.hypot(n,i);if(o>1e-4){if(a.orbit!==0){let o=a.orbit*e,s=Math.cos(o),c=Math.sin(o);t.x[r]=t.cx[r]+n*s-i*c,t.z[r]=t.cz[r]+n*c+i*s}a.radial!==0&&(t.vx[r]+=n/o*a.radial*e,t.vz[r]+=i/o*a.radial*e)}}t.x[r]+=t.vx[r]*e,t.y[r]+=t.vy[r]*e,t.z[r]+=t.vz[r]*e,a.collide&&t.y[r]<.02&&(t.y[r]=.02,t.vy[r]*=-a.bounce,t.vx[r]*=.6,t.vz[r]*=.6),t.rot[r]+=t.spin[r]*e}this.pn=n;let r=this.pDraw,i=0;for(let e=0;e<n;e++){let n=this.emitters[t.layer[e]],a=Math.min(1,t.age[e]/t.life[e]),o=Y(n.size,a)*t.sv[e],s=Math.max(0,Y(n.alpha,a))*t.op[e];if(s<.003||o<=0)continue;let c=Math.min(t.cap[e],Math.max(0,Y(n.emissive,a)));this.grads.sample(t.slot[e],a,wf,0);let l=t.cell[e],u=0;if(n.tex.frames>1&&!n.tex.variants&&n.frame<0){let r=n.fps>0?t.age[e]*n.fps%n.tex.frames:a*(n.tex.frames-1);l=n.tex.cell+Math.floor(r),u=r-Math.floor(r),l>=n.tex.cell+n.tex.frames-1&&(u=0)}r.aPos.setXYZW(i,t.x[e],t.y[e],t.z[e],o),r.aCol.setXYZW(i,wf[0]*c,wf[1]*c,wf[2]*c,s),r.aVel.setXYZW(i,t.vx[e],t.vy[e],t.vz[e],n.stretch),r.aTex.setXYZW(i,l,u,t.rot[e],Math.max(0,Y(n.erode,a))),r.aPar.setXYZW(i,n.soft,n.rimAmt,n.blend,n.align);let d=t.rim[e];d>=0?r.aRim.setXYZW(i,this.rimPool[d*3]*1.5,this.rimPool[d*3+1]*1.5,this.rimPool[d*3+2]*1.5,n.aspect):r.aRim.setXYZW(i,1,1,1,n.aspect),i++}r.geo.instanceCount=i,Ff([r.aPos,r.aCol,r.aVel,r.aTex,r.aPar,r.aRim],i),r.mesh.visible=i>0}moveParticle(e,t){let n=this.P;for(let r of Object.keys(n))n[r][t]=n[r][e];this.pInst[t]=this.pInst[e],this.pInst[e]=null}updateRibbons(){let e=this.ribDraw,t=this.camera,n=0;for(let r of this.ribbons){if(!r.on)continue;let i=r.layer,a=0;for(;a<r.n&&(this.now-r.ts[a])*r.rate>i.life;)a++;if(a>0){for(let e of[r.xs,r.ys,r.zs,r.ts,r.ds])e.copyWithin(0,a);r.n-=a}if(r.n===0&&!r.inst){r.on=!1;continue}if(r.n<2||!t||n>=nf)continue;let o=n*rf*2,s=r.ds[r.n-1];for(let n=0;n<rf;n++){let a=Math.min(n,r.n-1),c=r.xs[a],l=r.ys[a],u=r.zs[a],d=Math.max(0,a-1),f=Math.min(r.n-1,a+1);Q.set(r.xs[f]-r.xs[d],r.ys[f]-r.ys[d],r.zs[f]-r.zs[d]),i.flat?_f.set(0,1,0):_f.set(t.position.x-c,t.position.y-l,t.position.z-u),Q.cross(_f),Q.lengthSq()<1e-8?Q.set(1,0,0):Q.normalize();let p=Math.min(1,(this.now-r.ts[a])*r.rate/i.life),m=a/Math.max(1,r.n-1),h=Y(i.width,m)*.5*(1-p*.5)*r.s,g=Math.max(0,Y(i.alpha,m))*(1-p)*r.opacity;this.grads.sample(r.slot,1-m,wf,0);let _=Math.min(r.cap,i.emissive),v=o+n*2;e.pos.setXYZ(v,c+Q.x*h,l+Q.y*h,u+Q.z*h),e.pos.setXYZ(v+1,c-Q.x*h,l-Q.y*h,u-Q.z*h);for(let t of[v,v+1])e.col.setXYZW(t,wf[0]*_,wf[1]*_,wf[2]*_,g),e.prm.setXYZW(t,i.blend,i.noise,i.scroll,i.tile),e.rim.setXYZW(t,r.rim.r*1.4,r.rim.g*1.4,r.rim.b*1.4,i.rimAmt);e.uv.setXYZW(v,m,0,s-r.ds[a],r.seed),e.uv.setXYZW(v+1,m,1,s-r.ds[a],r.seed)}n++}e.geo.setDrawRange(0,n*47*6),Ff([e.pos,e.col,e.uv,e.prm,e.rim],n*rf*2),e.mesh.visible=n>0}updateElements(e){let t=0,n=this.beamDraw;for(let r of this.beams){if(!r.on)continue;let i=r.l;if(r.age+=e*r.rate,r.inst&&r.inst.sustained&&r.inst.held&&!i.repeat&&(r.age=Math.min(r.age,i.life*i.hold)),r.age>=i.life){r.on=!1,r.inst=null;continue}let a=r.age/i.life;this.grads.sample(r.slot,a,wf,0);let o=Math.min(r.cap,i.emissive),s=Math.max(0,Y(i.alpha,a))*r.opacity;n.aA.setXYZW(t,r.a.x,r.a.y,r.a.z,i.width),n.aB.setXYZW(t,r.b.x,r.b.y,r.b.z,i.noise),n.aC.setXYZW(t,wf[0]*o,wf[1]*o,wf[2]*o,s),n.aD.setXYZW(t,i.scroll,i.freq,r.seed,i.blend),n.aE.setXYZW(t,i.core,i.taper[0],i.taper[1],a),t++}n.geo.instanceCount=t,Ff([n.aA,n.aB,n.aC,n.aD,n.aE],t),n.mesh.visible=t>0;let r=0,i=this.ringDraw;for(let t of this.rings){if(!t.on)continue;let n=t.l;if(t.age+=e*t.rate,t.age>=n.life){t.on=!1;continue}let a=t.age/n.life;this.grads.sample(t.slot,a,wf,0);let o=Math.min(t.cap,Math.max(0,Y(n.emissive,a)));i.aPos.setXYZW(r,t.x,t.y,t.z,Math.max(.01,Y(n.radius,a)*t.s)),i.aSty.setXYZW(r,Math.max(.01,Y(n.width,a)*Math.max(1,Math.sqrt(t.s)*.8)),Math.max(0,Y(n.alpha,a))*t.opacity,n.sharp,n.noise),i.aCol.setXYZW(r,wf[0]*o,wf[1]*o,wf[2]*o,n.blend),i.aMisc.setXYZW(r,+!!n.vertical,t.seed,n.inner,a),r++}i.geo.instanceCount=r,Ff([i.aPos,i.aSty,i.aCol,i.aMisc],r),i.mesh.visible=r>0;let a=0,o=this.decalDraw;for(let t of this.decals){if(!t.on)continue;let n=t.l;if(t.age+=e*t.rate,t.inst&&(t.inst.sustained&&t.inst.held||t.path&&t.inst.following)&&!n.repeat&&(t.age=Math.min(t.age,n.life*n.hold)),t.age>=n.life){t.on=!1,t.inst=null;continue}let r=t.age/n.life;this.grads.sample(t.slot,r,wf,0);let i=Math.min(t.cap,Math.max(0,Y(n.emissive,r))),s=Math.max(.01,(n.shape>=3?Math.max(n.length*.5,Y(n.radius,r)):Y(n.radius,r))*t.s);t.inst&&n.countdown&&(t.rem=t.inst.rem);let c=n.shape===2?n.countdown?Math.max(.03,Math.PI*t.rem):n.angle:n.shape>=3?Math.max(.05,(n.width||s*.3)/Math.max(.001,s*2)):0;o.aPos.setXYZW(a,t.x,.035,t.z,s),o.aRot.setXYZW(a,t.rot,n.shape,n.style,Math.max(0,Y(n.alpha,r))*t.opacity),o.aCol.setXYZW(a,wf[0],wf[1],wf[2],i);let l=t.sus?Math.max(0,(r-n.hold)/Math.max(.05,1-n.hold)):r;o.aMisc.setXYZW(a,l,t.seed,c,n.tex.cell+(n.tex.variants?Math.floor(t.seed*n.tex.frames):0)),o.aRimC.setXYZW(a,t.rim.r,t.rim.g,t.rim.b,.8),a++}o.geo.instanceCount=a,Ff([o.aPos,o.aRot,o.aCol,o.aMisc,o.aRimC],a),o.mesh.visible=a>0;for(let e of this.shapeDraws.values())e.n=0;let s=this.camera;for(let t of this.meshEls){if(!t.on)continue;let n=t.l;if(gf(t.inst)&&!n.repeat?t.age=Math.min(t.age+e*t.rate,n.life*n.hold):t.age+=e*t.rate,t.age>=n.life&&(!t.inst||t.inst.sustained&&!t.inst.held||n.repeat>0)){t.on=!1,t.inst=null;continue}let r=Math.min(1,t.age/n.life),i=Math.max(.001,Y(n.scale,r)*t.s),a=this.shapeDraw(n.shape,i*Math.max(n.stretch[0],n.stretch[1],n.stretch[2])<cd);if(a.n>=lf)continue;t.spinA+=n.spin*e,n.align===Sd.camera&&s?yf.copy(s.quaternion):yf.setFromAxisAngle(Tf,t.spinA).premultiply(t.q),Sf.set(i*n.stretch[0],i*n.stretch[1],i*n.stretch[2]),xf.compose(t.pos,yf,Sf),a.mesh.setMatrixAt(a.n,xf),this.grads.sample(t.slot,r,wf,0);let o=Math.min(t.cap,Math.max(0,Y(n.emissive,r))),c=n.legacy&&n.blend===0?Math.min(t.cap,1.6):o,l=Math.max(0,Y(n.alpha,r))*t.opacity;a.aColor.setXYZW(a.n,wf[0]*c,wf[1]*c,wf[2]*c,l);let u=Math.min(t.cap,n.rimEmissive);a.aRimC.setXYZW(a.n,t.rim.r*u,t.rim.g*u,t.rim.b*u,n.rimPow);let d=Math.min(t.cap,n.edgeEmissive);a.aEdge.setXYZW(a.n,t.edge.r*d,t.edge.g*d,t.edge.b*d,n.edgeWidth),a.aNoise.setXYZW(a.n,n.noiseScale,n.scroll[0],n.scroll[1],n.noise),a.aDiss.setXYZW(a.n,Math.max(0,Y(n.dissolve,r)),n.mask,Y(n.maskParam,r),n.blend),a.aMisc.setXYZW(a.n,n.wobble,n.twist,n.angle,t.seed),a.n++}for(let e of this.shapeDraws.values())e.mesh.count=e.n,e.mesh.visible=e.n>0,e.mesh.instanceMatrix.clearUpdateRanges(),e.mesh.instanceMatrix.addUpdateRange(0,Math.max(1,e.n)*16),e.mesh.instanceMatrix.needsUpdate=!0,Ff([e.aColor,e.aRimC,e.aEdge,e.aNoise,e.aDiss,e.aMisc],e.n)}updateDistorts(e){let t=this.distortDraw,n=0;for(let r of this.distorts){if(!r.on)continue;let i=r.l;if(r.age+=e*r.rate,r.inst&&r.inst.sustained&&r.inst.held&&!i.repeat&&(r.age=Math.min(r.age,i.life*.5)),r.age>=i.life||!oo.distortAllowed){r.on=!1,r.inst=null;continue}let a=r.age/i.life,o=Math.max(.05,Y(i.size,a)*r.s),s=Math.min(df,Math.max(0,Y(i.strength,a)))*r.opacity;t.aPos.setXYZW(n,r.pos.x,r.pos.y,r.pos.z,o),t.aPar.setXYZW(n,i.mode,s,a,r.seed),t.aAx.setXYZW(n,+!!i.ground,0,0,0),n++}t.geo.instanceCount=n,Ff([t.aPos,t.aPar,t.aAx],n),t.mesh.visible=n>0,this.distortN=n}shapeDraw(e,t=!1){let n=rd[e],r=t&&ld.has(n),i=r?e+rd.length:e,a=this.shapeDraws.get(i);if(a)return a;let o=ud(n,r),s=$(lf,4),c=$(lf,4),l=$(lf,4),u=$(lf,4),d=$(lf,4),f=$(lf,4);al(o,Zd.mesh,{aColor:s,aRimC:c,aEdge:l,aNoise:u,aDiss:d,aMisc:f});let p=If(`mesh`,{uShapeKind:{value:id[n]??0}},2),h=new m(o,p,lf);return h.name=`vfx_${n}${r?`_lo`:``}`,h.instanceMatrix.setUsage(N),h.frustumCulled=!1,h.count=0,h.renderOrder=11,this.scene.add(h),a={mesh:h,n:0,aColor:s,aRimC:c,aEdge:l,aNoise:u,aDiss:d,aMisc:f},this.shapeDraws.set(i,a),a}prewarm(e,t){for(let e=0;e<rd.length;e++)this.shapeDraw(e),this.shapeDraw(e,!0);let n=[];for(let e of[this.scene,this.distortScene])e.traverse(e=>{n.push([e,e.visible]),e.visible=!0});try{e.compile(this.scene,t),e.compile(this.distortScene,t)}finally{for(let[e,t]of n)e.visible=t}}draw(e,t,n){let r=this.camera;if(!r)return;this.textures.generate(e),Nd.uDepth.value=n,Nd.uHasDepth.value=+!!n,t?Nd.uRes.value.set(t.width,t.height):e.getDrawingBufferSize(Nd.uRes.value),Nd.uNear.value=r.near,Nd.uFar.value=r.far,Nd.uLiftOn.value=this.liftCap!==null&&Za.uLiftA.value.some(e=>e.w>0)?1:0,Nd.uLiftCap.value=(this.liftCap??1.3)-1,Nd.uLiftOn.value&&(Nd.uLiftInvProj.value.copy(r.projectionMatrixInverse),Nd.uLiftCamWorld.value.copy(r.matrixWorld));let i=e.autoClear;if(e.autoClear=!1,e.setRenderTarget(t),e.render(this.scene,r),this.distortN>0&&oo.distortAllowed){let n=t?this._res.set(t.width,t.height):e.getDrawingBufferSize(this._res),i=Math.max(1,n.x>>1),a=Math.max(1,n.y>>1);this.distortRT?(this.distortRT.width!==i||this.distortRT.height!==a)&&this.distortRT.setSize(i,a):this.distortRT=new ne(i,a,{type:D,depthBuffer:!1}),Nd.uRes.value.set(i,a),e.setRenderTarget(this.distortRT);let o=e.getClearColor(Cf),s=e.getClearAlpha(),c=o.r,l=o.g,u=o.b;e.setClearColor(0,0),e.clear(!0,!1,!1),e.render(this.distortScene,r),e.setClearColor(Cf.setRGB(c,l,u),s),Nd.uRes.value.copy(n),Za.uDistort.value=this.distortRT.texture,Za.uDistortOn.value=1,e.setRenderTarget(t)}else Za.uDistortOn.value=0;e.autoClear=i}clear(){for(let e of this.insts)e.active=!1,e.sustain=null,e.held=!1,this.free.push(e);this.insts.length=0,this.pn=0,this.pInst.fill(null);for(let e of this.ribbons)e.on=!1,e.inst=null,e.n=0;for(let e of this.beams)e.on=!1,e.inst=null;for(let e of this.rings)e.on=!1;for(let e of this.decals)e.on=!1;for(let e of this.meshEls)e.on=!1,e.inst=null;for(let e of this.distorts)e.on=!1,e.inst=null;for(let e of this.decals)e.inst=null;for(let e of this.lights)e.age=e.life=1,e.light.intensity=0;this.byUid.clear(),this.distortN=0,this.distortRT?.dispose(),this.distortRT=null,oo.reset()}dispose(){this.clear(),this.scene.traverse(e=>{let t=e;t.isMesh&&(t.geometry.dispose(),t.material.dispose())});for(let e of this.lights)e.light.dispose();this.distortDraw.geo.dispose(),this.distortDraw.mesh.material.dispose(),this.distortRT?.dispose(),this.textures.dispose(),this.group.removeFromParent()}},Bf={maxEmissive:.8,loopHzMax:.5},Vf={low:.4,medium:.7,high:1,ultra:1},Hf=3,Uf=(e,t)=>typeof e==`number`&&Number.isFinite(e)?e:t,Wf=(e,t)=>Array.isArray(e)?e.filter(e=>Array.isArray(e)&&e.length>=2&&e.every(e=>typeof e==`number`)).map(e=>Array.from({length:t},(t,n)=>e[n]??0)):[];function Gf(e){let t=e.art.ambient??{},n=e=>Array.isArray(t[e])?t[e].filter(e=>!!e&&typeof e==`object`):[];return{seed:Math.round(Uf(t.seed,1)),effects:n(`effects`).filter(e=>typeof e.vfx==`string`).map(e=>({vfx:e.vfx,at:Wf(e.at,3),scale:Uf(e.scale,1)})),critters:n(`critters`).filter(e=>typeof e.model==`string`&&typeof e.id==`string`).map(e=>({id:e.id,model:e.model,kind:e.kind===`runner`?`runner`:e.kind===`circler`?`circler`:`flier`,scale:Uf(e.scale,1),count:Math.max(0,Math.round(Uf(e.count,1))),flee:Uf(e.flee,Hf),height:Uf(e.height,0),spots:Wf(e.spots,3).map(e=>[e[0],e[1],e[2]||1.5])})),props:n(`props`).filter(e=>typeof e.model==`string`).map(e=>{let t=e.fx&&typeof e.fx==`object`?e.fx:null,n=t?Wf([t.offset],3)[0]:null;return{model:e.model,at:Wf(e.at,3),scale:Uf(e.scale,1),value:Uf(e.value,1),sway:Uf(e.sway,0),fill:Math.min(.6,Math.max(0,Uf(e.fill,0))),fx:t&&typeof t.vfx==`string`&&n?{vfx:t.vfx,offset:n}:null}})}}function Kf(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}var qf=8,Jf=qf+64,Yf=`
uniform sampler2D uLayers;
uniform float uAmbT;
uniform float uGrid;
attribute vec4 aA;   // anchor x, y, z, seed
attribute vec4 aB;   // layer row, anchor yaw, scale, -
varying vec2 vUv; varying vec4 vCol; varying float vMode; varying vec3 vWorld;
vec4 L( int c ) { return texelFetch( uLayers, ivec2( c, int( aB.x + 0.5 ) ), 0 ); }
float H( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }
vec2 cellUv( float c, vec2 local ) { vec2 cell = vec2( mod( c, uGrid ), floor( c / uGrid ) ); return ( cell + 0.006 + local * 0.988 ) / uGrid; }
void main() {
  vec4 p0 = L( 0 ), p1 = L( 1 ), p2 = L( 2 ), p3 = L( 3 ), p4 = L( 4 ), p5 = L( 5 ), p6 = L( 6 );
  float seed = aA.w;
  float sc = aB.z;
  float life = mix( p0.x, p0.y, H( seed * 3.17 ) );
  float x = uAmbT / life + H( seed * 5.71 );
  float cyc = floor( x ), ph = fract( x );
  float s2 = seed * 1.618 + cyc * 7.31;
  float age = ph * life;
  // the spawn point in the layer's shape (re-hashed every cycle)
  float r1 = H( s2 + 0.11 ), r2 = H( s2 + 0.37 ), r3 = H( s2 + 0.73 );
  float shape = p0.w;
  float R = p1.x * sc, Ri = p1.y * sc, Hh = p1.z * sc, Ln = p1.w * sc;
  vec3 off = vec3( 0.0 );
  float ang = r1 * 6.2831853;
  if ( shape > 0.5 && shape < 1.5 ) {                       // sphere
    float u = r2 * 2.0 - 1.0; float rr = sqrt( max( 0.0, 1.0 - u * u ) );
    off = vec3( rr * cos( ang ), u, rr * sin( ang ) ) * R * pow( r3, 0.3333 );
  } else if ( shape > 1.5 && shape < 2.5 ) {                // ring
    off = vec3( cos( ang ), 0.0, sin( ang ) ) * R;
  } else if ( shape > 2.5 && shape < 3.5 ) {                // disc
    off = vec3( cos( ang ), 0.0, sin( ang ) ) * mix( Ri, R, sqrt( r2 ) );
  } else if ( shape > 4.5 && shape < 5.5 ) {                // line (along the anchor's yaw)
    float yw = aB.y;
    off = vec3( cos( yw ), 0.0, sin( yw ) ) * ( r2 - 0.5 ) * Ln + vec3( -sin( yw ), 0.0, cos( yw ) ) * ( r3 - 0.5 ) * R;
  } else if ( shape > 6.5 ) {                                // aura: a column of radius R, height H
    off = vec3( cos( ang ), 0.0, sin( ang ) ) * R * sqrt( r2 );
  }
  if ( Hh > 0.0 ) off.y += r3 * Hh;
  // motion: drift, a slow wander (two partials, <= 0.5 Hz), an orbit about the anchor's axis
  vec3 pos = off + p2.xyz * age * sc;
  float w = p2.w * sc;
  float f1 = 0.13 + 0.12 * H( s2 + 1.9 ), f2 = 0.27 + 0.2 * H( s2 + 2.3 );
  float q1 = H( s2 + 3.1 ) * 6.2831853, q2 = H( s2 + 4.7 ) * 6.2831853;
  pos += w * vec3( sin( 6.2831853 * f1 * uAmbT + q1 ) + 0.5 * sin( 6.2831853 * f2 * uAmbT + q2 ),
                   0.45 * sin( 6.2831853 * f2 * uAmbT + q1 * 1.7 ),
                   cos( 6.2831853 * f1 * uAmbT + q2 ) + 0.5 * cos( 6.2831853 * f2 * uAmbT + q1 ) );
  float orb = p3.x * age;
  if ( abs( orb ) > 0.0 ) { float c = cos( orb ), s = sin( orb ); pos.xz = mat2( c, s, -s, c ) * pos.xz; }
  pos += aA.xyz;
  vWorld = pos;
  // curves over life
  float tc = ph * float( 31 );
  int i0 = int( floor( tc ) ); int i1 = min( i0 + 1, 31 ); float fr = fract( tc );
  vec4 cv = mix( L( ${qf} + i0 ), L( ${qf} + i1 ), fr );
  vec4 cc = mix( L( ${qf+32} + i0 ), L( ${qf} + 32 + i1 ), fr );
  float size = cv.x * mix( p4.x, p4.y, H( s2 + 5.3 ) ) * sc;
  float e = min( cv.z, p6.y );
  vCol = vec4( cc.rgb * e, max( 0.0, cv.y ) );
  vMode = p6.x;
  float rot = mix( p4.z, p4.w, H( s2 + 6.1 ) ) + mix( p3.y, p3.z, H( s2 + 6.9 ) ) * age;
  vec2 corner = position.xy;
  float c = cos( rot ), s = sin( rot );
  vec2 q = mat2( c, s, -s, c ) * corner * size;
  vec4 mv;
  if ( p3.w > 1.5 ) mv = viewMatrix * vec4( pos + vec3( q.x, 0.0, -q.y ), 1.0 );   // flat on the ground
  else { mv = viewMatrix * vec4( pos, 1.0 ); mv.xy += q; }
  gl_Position = size > 0.0 && vCol.a > 0.002 ? projectionMatrix * mv : vec4( 2.0, 2.0, 2.0, 1.0 );
  // flipbook (fps > 0: by age; else over life) or a variant picked per cycle
  float cell = p5.x;
  if ( p5.y > 1.5 ) {
    if ( p5.w > 0.5 ) cell += floor( H( s2 + 7.7 ) * p5.y );
    else cell += min( p5.y - 1.0, floor( p5.z > 0.0 ? mod( age * p5.z, p5.y ) : ph * ( p5.y - 1.0 ) ) );
  }
  vUv = cellUv( cell, corner + 0.5 );
}`,Xf=`
uniform sampler2D uAtlas;
${hn}
varying vec2 vUv; varying vec4 vCol; varying float vMode; varying vec3 vWorld;
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.002 ) discard;
  // the world's fog of war dims the ambient like the ground under it: the world's own function (valeFogShade, the
  // display value x0.55 and saturation x0.4; no tint shift: these are light over the ground, not a surface); below
  // the ground (a gorge) it thins into the drop's own mist (~0.06 / m, the gorge's density)
  float vis = valeVision( vWorld.xz );
  float drop = exp( 0.06 * min( vWorld.y + 1.0, 0.0 ) );
  vec3 col = vCol.rgb * ( vMode < 0.5 ? 0.3 + 0.7 * t.r : 0.72 + 0.28 * t.r );
  if ( vis < 0.999 ) col = mix( valeFogShade( col, valeFogValue, 0.4, 0.0 ), col, vis );
  if ( vMode < 0.5 ) gl_FragColor = vec4( col * a * drop, 0.0 );
  else gl_FragColor = vec4( col * a * drop, a );
}`,Zf=class{mesh;geo;aA;aB;layers;emitters;master;visKey=``;density=1;drawn=0;onScreen=new Map;uniforms;constructor(e,t,n,r){this.emitters=t;let a=new Float32Array(Jf*Math.max(1,e.length)*4);e.forEach((e,t)=>{let n=t*Jf*4,r=(e,t,r,i,o)=>{a.set([t,r,i,o],n+e*4)},i=Math.max(2,e.life[0]);r(0,i,Math.max(i,e.life[1]),e.count,e.shape),r(1,e.radius,e.radiusInner,e.height,e.length),r(2,e.velocity[0],e.velocity[1],e.velocity[2],e.turb);let o=e=>Math.max(-Math.PI,Math.min(Math.PI,e));r(3,o(e.orbit),o(e.spin[0]),o(e.spin[1]),e.align),r(4,e.sizeVar[0],e.sizeVar[1],e.rot[0],e.rot[1]),r(5,e.tex.cell,e.tex.frames,e.fps,+!!e.tex.variants),r(6,e.blend===0?0:1,Bf.maxEmissive,0,0);for(let t=0;t<32;t++){let n=t/31;r(qf+t,Y(e.size,n),Y(e.alpha,n),Y(e.emissive,n),0);let i=$f(e.color,n);r(qf+32+t,i.r,i.g,i.b,1)}}),this.layers=new o(a,Jf,Math.max(1,e.length),be,w),this.layers.minFilter=this.layers.magFilter=Se,this.layers.needsUpdate=!0;let s=0;for(let e of t)e.first=s,s+=e.count;let c=new Float32Array(s*4),l=new Float32Array(s*4);for(let e of t)for(let t=0;t<e.count;t++){let n=(e.first+t)*4,r=(e.x*7.13+e.z*3.71+e.y*1.37)%97+t*1.618+e.row*.37;c.set([e.x,e.y,e.z,r],n),l.set([e.row,e.yaw,e.scale,0],n)}this.master={a:c,b:l};let u=new me(1,1);this.geo=new j,this.geo.index=u.index,this.geo.setAttribute(`position`,u.getAttribute(`position`)),this.aA=new i(new Float32Array(Math.max(1,s)*4),4),this.aB=new i(new Float32Array(Math.max(1,s)*4),4),this.aA.setUsage(N),this.aB.setUsage(N),this.geo.setAttribute(`aA`,this.aA),this.geo.setAttribute(`aB`,this.aB),this.geo.instanceCount=0,this.uniforms={uLayers:{value:this.layers},uAmbT:{value:0},uAtlas:{value:n},uGrid:{value:r},...mn};let d=new ee({vertexShader:Yf,fragmentShader:Xf,uniforms:this.uniforms,transparent:!0,depthWrite:!1,depthTest:!0,side:2,blending:5,blendEquation:100,blendSrc:201,blendDst:205});this.mesh=new I(this.geo,d),this.mesh.name=`vale_ambient_particles`,this.mesh.frustumCulled=!1,this.mesh.renderOrder=6,this.mesh.visible=!1}update(e,t){this.uniforms.uAmbT.value=e;let n=``,r=[];for(let e=0;e<this.emitters.length;e++){let i=this.emitters[e];tp.center.set(i.x,i.y,i.z),tp.radius=i.reach,(!t||t.intersectsSphere(tp))&&(r.push(i),n+=e.toString(36)+`,`)}if(n+=this.density,n===this.visKey)return;this.visKey=n;let i=this.aA.array,a=this.aB.array,o=0;this.onScreen.clear();for(let e of r){let t=Math.max(1,Math.round(e.count*this.density));i.set(this.master.a.subarray(e.first*4,(e.first+t)*4),o*4),a.set(this.master.b.subarray(e.first*4,(e.first+t)*4),o*4),o+=t,this.onScreen.set(e.def,(this.onScreen.get(e.def)??0)+t)}this.geo.instanceCount=o,this.drawn=o,this.aA.clearUpdateRanges(),this.aB.clearUpdateRanges(),this.aA.addUpdateRange(0,o*4),this.aB.addUpdateRange(0,o*4),this.aA.needsUpdate=!0,this.aB.needsUpdate=!0,this.mesh.visible=o>0}invalidate(){this.visKey=``}dispose(){this.geo.dispose(),this.layers.dispose(),this.mesh.material.dispose()}},Qf=new R;function $f(e,t){let n=t=>{let n=e.c[t];return n&&n.k===0?n.c:ep};if(!e.t.length)return Qf.copy(ep);if(t<=e.t[0])return Qf.copy(n(0));for(let r=1;r<e.t.length;r++)if(t<=e.t[r]){let i=(t-e.t[r-1])/Math.max(1e-6,e.t[r]-e.t[r-1]);return Qf.copy(n(r-1)).lerp(n(r),i)}return Qf.copy(n(e.t.length-1))}var ep=new R(.5,.48,.44),tp=new l,np=class{root;mixer;act;spec;rnd;groundAt;x;y;h;heading;state=`idle`;cur=null;nextIdle;mv=null;settleT=0;flights=0;clock=0;circ=null;constructor(e,t,n,r,i,a){this.spec=e,this.rnd=r,this.groundAt=i,this.root=Ae(t),this.root.scale.setScalar(e.scale),this.root.traverse(e=>{let t=e;t.isMesh&&(t.castShadow=!0,t.receiveShadow=!0)}),on(this.root),this.mixer=new Re(this.root),this.act={};for(let e of[`idle`,`flee`,`settle`]){let t=n.find(t=>t.name===e);if(!t)continue;let r=this.mixer.clipAction(t);e===`settle`?(r.setLoop(ae,1),r.clampWhenFinished=!0):r.setLoop(ie,1/0),this.act[e]=r}if(this.x=a[0],this.y=a[1],this.h=i(this.x,this.y),this.heading=r()*Math.PI*2,this.nextIdle=1+r()*3,this.root.rotation.order=`YXZ`,e.kind===`circler`){let t=e.spots.reduce((e,t)=>Math.hypot(t[0]-a[0],t[1]-a[1])<Math.hypot(e[0]-a[0],e[1]-a[1])?t:e,e.spots[0]),n=Math.max(2,t[2]*(.6+.4*r()));this.circ={cx:t[0],cy:t[1],r:n,w:3.6/n*(r()<.5?-1:1),ph:r()*Math.PI*2},this.clock=r()*20,this.state=`flee`,this.play(`flee`,0)}else{this.play(`idle`,0);let e=this.act.idle;e&&(e.time=r()*e.getClip().duration)}this.place()}wheel(e,t){let n=this.circ;this.clock+=e;let r=n.ph+n.w*this.clock;this.x=n.cx+Math.cos(r)*n.r,this.y=n.cy+Math.sin(r)*n.r,this.h=this.groundAt(n.cx,n.cy)+this.spec.height+.7*Math.sin(.21*this.clock+n.ph);let i=-Math.sin(r)*n.w,a=Math.cos(r)*n.w;this.heading=Math.atan2(i,a),this.place(),this.root.rotation.z=Math.sign(n.w)*.32;let o=this.act.flee;o&&((this.clock+n.ph)%3.5>1.2?(o.timeScale=0,o.time=.27*o.getClip().duration):o.timeScale=1),t&&this.mixer.update(e)}play(e,t){let n=this.act[e];n&&n!==this.cur&&(n.reset(),n.enabled=!0,n.setEffectiveWeight(1),n.play(),this.cur&&t>0?n.crossFadeFrom(this.cur,t,!1):this.cur&&this.cur.stop(),this.cur=n)}place(){this.root.position.set(this.x,this.h,this.y),this.root.rotation.y=this.heading}threat(e){let t=null,n=1/0;for(let r of e){let e=Math.hypot(r.x-this.x,r.y-this.y)-r.r;e<this.spec.flee&&e<n&&(n=e,t=r)}return t}clearOf(e,t,n,r){for(let i of n)if(Math.hypot(i.x-e,i.y-t)<r+i.r)return!1;return!0}startFlight(e,t){let n=this.spec.spots,r=null;for(let t=0;t<16&&!r;t++){let t=n[Math.floor(this.rnd()*n.length)],i=this.rnd()*Math.PI*2,a=Math.sqrt(this.rnd())*t[2],o=t[0]+Math.cos(i)*a,s=t[1]+Math.sin(i)*a,c=Math.hypot(o-this.x,s-this.y);c<7||c>26||this.clearOf(o,s,e,this.spec.flee+2)&&(r=[o,s])}if(!r){let e=Math.atan2(this.y-t.y,this.x-t.x)+(this.rnd()-.5)*.8;r=[this.x+Math.cos(e)*9,this.y+Math.sin(e)*9]}let i=Math.hypot(r[0]-this.x,r[1]-this.y),a=this.groundAt(r[0],r[1]);this.mv={x0:this.x,y0:this.y,h0:this.h,x1:r[0],y1:r[1],h1:a,arc:Math.min(8,Math.max(5,i*.3)),t:0,dur:Math.max(1.3,i/6.5),kind:`fly`,yaw0:this.heading,yaw1:Math.atan2(r[0]-this.x,r[1]-this.y)},this.state=`flee`,this.flights++,this.play(`flee`,.08)}startRun(e,t){let n=Math.atan2(this.y-t.y,this.x-t.x),r=this.h,i=null;for(let e=0;e<10&&!i;e++){let e=n+(this.rnd()-.5)*1.4,t=2.5+this.rnd()*1.5,a=this.x+Math.cos(e)*t,o=this.y+Math.sin(e)*t;Math.abs(this.groundAt(a,o)-r)>.05||this.spec.spots.some(e=>Math.hypot(a-e[0],o-e[1])<e[2]*1.6+1)&&(i=[a,o])}for(let e of[1.5,1,.6]){if(i)break;let t=this.x+Math.cos(n)*e,a=this.y+Math.sin(n)*e;Math.abs(this.groundAt(t,a)-r)<=.05&&(i=[t,a])}i||=[this.x,this.y];let a=Math.hypot(i[0]-this.x,i[1]-this.y),o=a>.01?Math.atan2(i[0]-this.x,i[1]-this.y):Math.atan2(Math.cos(n),Math.sin(n));this.mv={x0:this.x,y0:this.y,h0:r,x1:i[0],y1:i[1],h1:r,arc:0,t:0,dur:Math.max(.45,a/3.4),kind:`run`,yaw0:this.heading,yaw1:o},this.state=`flee`,this.flights++,this.play(`flee`,.06)}update(e,t,n){if(this.circ){this.wheel(e,n);return}let r=this.spec.kind===`flier`;if(this.state!==`flee`){let e=this.threat(t);e&&(r?this.startFlight(t,e):this.startRun(t,e))}let i=this.mv;if(i){i.t+=e;let t=Math.min(1,i.t/i.dur);if(i.kind===`fly`){let n=t<.5?2*t*t:1-2*(1-t)*(1-t),r=.15*t+.85*n;this.x=i.x0+(i.x1-i.x0)*r,this.y=i.y0+(i.y1-i.y0)*r,this.h=i.h0+(i.h1-i.h0)*r+i.arc*Math.sin(Math.PI*Math.min(1,t*1.08))**.8,this.heading=rp(this.heading,i.yaw1,e*9),t>.82&&this.state===`flee`&&(this.state=`settle`,this.settleT=0,this.play(`settle`,.12))}else if(i.kind===`run`){let n=1-(1-t)*(1-t);this.x=i.x0+(i.x1-i.x0)*n,this.y=i.y0+(i.y1-i.y0)*n,this.heading=rp(this.heading,i.yaw1,e*14),t>=1&&this.state===`flee`&&(this.state=`settle`,this.settleT=0,this.play(`settle`,.1))}else i.kind===`hop`?(this.x=i.x0+(i.x1-i.x0)*t,this.y=i.y0+(i.y1-i.y0)*t,this.h=i.h0+i.arc*Math.sin(Math.PI*t)):this.heading=i.yaw0+(i.yaw1-i.yaw0)*(t*t*(3-2*t));t>=1&&((i.kind===`fly`||i.kind===`hop`)&&(this.h=i.h1),this.mv=null)}if(this.state===`settle`){this.settleT+=e;let t=this.act.settle?.getClip().duration??.8;!this.mv&&this.settleT>=t&&(this.state=`idle`,this.play(`idle`,.15),this.nextIdle=1+this.rnd()*3)}else if(this.state===`idle`&&!this.mv&&(this.nextIdle-=e,this.nextIdle<=0)){this.nextIdle=1.5+this.rnd()*3.5;let e=this.rnd();if(r&&e<.55){let e=this.heading+(this.rnd()-.5)*1.2,t=.12+this.rnd()*.16,n=this.x+Math.sin(e)*t,r=this.y+Math.cos(e)*t;Math.abs(this.groundAt(n,r)-this.h)<.05&&(this.mv={x0:this.x,y0:this.y,h0:this.h,x1:n,y1:r,h1:this.h,arc:.05,t:0,dur:.2,kind:`hop`,yaw0:this.heading,yaw1:this.heading})}else{let e=(this.rnd()-.5)*(r?2:1.2);this.mv={x0:this.x,y0:this.y,h0:this.h,x1:this.x,y1:this.y,h1:this.h,arc:0,t:0,dur:r?.25:.5,kind:`turn`,yaw0:this.heading,yaw1:this.heading+e}}}this.place(),n&&this.mixer.update(e)}dispose(){this.mixer.stopAllAction(),this.mixer.uncacheRoot(this.root),this.root.traverse(e=>{let t=e;t.isSkinnedMesh&&t.skeleton.dispose()})}};function rp(e,t,n){let r=t-e;for(;r>Math.PI;)r-=Math.PI*2;for(;r<-Math.PI;)r+=Math.PI*2;return e+r*Math.min(1,n)}function ip(e,t,n=0){let r=new Pe({vertexColors:!0,roughness:.88,metalness:0,side:2});r.color.setScalar(t);let i={uAmbT:mn.valeTime,uSwayAmp:{value:e},uClothFill:{value:n}};return r.onBeforeCompile=e=>{Object.assign(e.uniforms,i),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>\n${kt}`).replace(`#include <begin_vertex>`,`#include <begin_vertex>\n${At}`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform float uClothFill;`).replace(`#include <emissivemap_fragment>`,`#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * uClothFill;`)},r.customProgramCacheKey=()=>`vale_amb_cloth_v3`,G(r),e>0?{mat:r,depth:rn(Mt.cloth,i,`vale_amb_cloth_depth`),own:!0}:{mat:r,depth:tn(`rigid`,!0),own:!1}}var ap=class{group=new _;spec;particles=null;critters=[];propMeshes=[];propMats=[];on=!0;density=1;ms=0;frustum=new d;m4=new M;disposed=!1;crittersDrawn=0;onPart=null;constructor(e,t,n,r,i,a){this.group.name=`vale_ambient`,this.spec=Gf(e);let o=new Map(t.map(e=>[e.id,e])),s=new Map,c=(e,t,n,r,i,a)=>{if(!o.has(e))return;let c=s.get(e)??[];c.push({x:t,y:n,z:r,yaw:i,scale:a}),s.set(e,c)};for(let e of this.spec.effects)for(let[t,n,r]of e.at)c(e.vfx,t,a(t,n)+r,n,0,e.scale);for(let e of this.spec.props)if(e.fx)for(let[t,n,r]of e.at){let i=r*Math.PI/180,[o,s,l]=e.fx.offset,u=t+(Math.cos(i)*o+Math.sin(i)*l)*e.scale,d=n+(-Math.sin(i)*o+Math.cos(i)*l)*e.scale;c(e.fx.vfx,u,a(t,n)+s*e.scale,d,i,1)}let l=[],u=[];for(let[e,t]of s){let n=Md(o.get(e));for(let r of n.layers){if(r.type!==`emitter`)continue;let n=l.length;l.push(r);let i=Math.max(2,r.life[1]),a=Math.hypot(r.velocity[0],r.velocity[1],r.velocity[2])*i;for(let o of t){let t=(Math.max(r.radius,r.length/2)+r.height+a+r.turb*1.5)*o.scale+op(r)*o.scale+.5,s=r.count>0?r.count:Math.max(1,Math.round(r.rate*i));u.push({row:n,x:o.x,y:o.y,z:o.z,yaw:o.yaw,scale:o.scale,count:s,reach:t,first:0,def:e})}}}u.length&&(this.particles=new Zf(l,u,n,r),this.group.add(this.particles.mesh)),Promise.resolve().then(()=>{this.particles&&!this.disposed&&this.onPart?.(this.particles.mesh)}),this.loadCritters(i,a),this.loadProps(i,a)}static refs(e){let t=Gf(e);return[...new Set([...t.critters.map(e=>e.model),...t.props.map(e=>e.model)])]}async loadCritters(e,t){let n=0;for(let r of this.spec.critters){let i=await e(r.model);if(this.disposed||!i?.renderable||!r.spots.length){n++;continue}let a=new Set;i.gltf.scene.traverse(e=>{let t=e;if(t.isMesh)for(let e of Array.isArray(t.material)?t.material:[t.material])a.add(e)});for(let e of a)e.side=2,G(e);let o=Kf(this.spec.seed*7919+n*104729);for(let e=0;e<r.count;e++){let a=r.spots[e%r.spots.length],s=o()*Math.PI*2,c=Math.sqrt(o())*a[2],l=new np(r,i.gltf.scene,i.gltf.animations,Kf(this.spec.seed*31+n*1009+e*7),t,[a[0]+Math.cos(s)*c,a[1]+Math.sin(s)*c]);l.root.userData.ambIndex=e,this.critters.push(l),this.group.add(l.root),e===0&&this.onPart?.(l.root)}n++}this.applyOn()}async loadProps(e,t){for(let n of this.spec.props){if(!n.at.length)continue;let r=await e(n.model);if(this.disposed||!r?.renderable)continue;let i=null;if(r.gltf.scene.updateMatrixWorld(!0),r.gltf.scene.traverse(e=>{let t=e;t.isMesh&&!i&&(i=t.geometry.clone(),i.applyMatrix4(t.matrixWorld))}),!i)continue;let a=i;a.getAttribute(`_sway`)||a.setAttribute(`_sway`,new F(new Float32Array(a.getAttribute(`position`).count),1));let{mat:o,depth:s,own:c}=ip(n.sway,n.value,n.fill);this.propMats.push(o),c&&this.propMats.push(s);let l=new m(a,o,n.at.length);l.name=`vale_ambient_props`,l.customDepthMaterial=s,l.castShadow=!0,l.receiveShadow=!0;let u=new M,d=new B(n.scale,n.scale,n.scale);n.at.forEach(([e,n,r],i)=>{u.makeRotationY(r*Math.PI/180).scale(d).setPosition(e,t(e,n),n),l.setMatrixAt(i,u)}),l.instanceMatrix.needsUpdate=!0,l.computeBoundingSphere(),this.propMeshes.push(l),this.group.add(l),this.onPart?.(l)}}configure(e,t){this.on=e,this.density=Vf[t]??1,this.particles&&(this.particles.density=this.density,this.particles.invalidate()),this.applyOn()}applyOn(){this.particles&&(this.particles.mesh.visible=this.on&&this.particles.drawn>0);let e=(e,t)=>e<Math.max(1,Math.round(t*this.density));for(let t of this.critters)t.root.visible=this.on&&e(t.root.userData.ambIndex,t.spec.count)}update(e,t,n,r){let i=performance.now();this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse)),this.on&&this.particles&&(this.particles.update(e,this.frustum),this.particles.mesh.visible=this.particles.drawn>0);let a=0;if(this.on)for(let e of this.critters){if(e.root.userData.ambIndex>=Math.max(1,Math.round(e.spec.count*this.density))){e.root.visible=!1;continue}tp.center.set(e.x,e.h+.2,e.y),tp.radius=1;let n=this.frustum.intersectsSphere(tp);e.update(Math.min(t,.1),r,n),e.root.visible=n,n&&a++}this.crittersDrawn=a;let o=performance.now()-i;this.ms=this.ms?this.ms*.9+o*.1:o}stats(){let e=this.particles;return{on:this.on,density:this.density,ms:Math.round(this.ms*1e3)/1e3,emitters:e?e.emitters.length:0,particles:this.on&&e?e.drawn:0,onScreen:this.on&&e?Object.fromEntries(e.onScreen):{},critters:this.critters.length,crittersDrawn:this.on?this.crittersDrawn:0,flights:this.critters.reduce((e,t)=>e+t.flights,0),props:this.propMeshes.reduce((e,t)=>e+t.count,0)}}critterStates(){return this.critters.map(e=>({id:e.spec.id,x:e.x,y:e.y,h:e.h,state:e.state,visible:e.root.visible}))}dispose(){this.disposed=!0,this.particles?.dispose();for(let e of this.critters)e.dispose();for(let e of this.propMeshes)e.geometry.dispose(),e.dispose();for(let e of this.propMats)e.dispose();this.group.clear()}};function op(e){let t=0;for(let n=0;n<32;n++)t=Math.max(t,e.size[n]);return t*Math.max(e.sizeVar[0],e.sizeVar[1])}var sp=[`onBeforeRender`,`onAfterRender`,`onBeforeShadow`,`onAfterShadow`],cp=()=>({calls:0,tris:0,shadowCalls:0,shadowTris:0}),lp=class{hooked=new Map;bound=new Set;unbind=null;groups={};detail={};begin(e,t){this.end(),this.groups={},this.detail={};let n=e.getContext(),r=n.useProgram;this.bound.clear(),n.useProgram=e=>{e&&this.bound.add(e),r.call(n,e)},this.unbind=()=>{n.useProgram=r};let i=e.info.render,a=0,o=0;for(let e of t){let t=(n,r)=>{let s=n;if(s.isMesh||s.isPoints||s.isLine||s.isSprite){let t=typeof e.group==`string`?e.group:e.group(n,r),s=`${t}:${e.part?e.part(n,r):r.name||r.type}`,c=this.groups[t]??=cp(),l=this.detail[s]??=cp(),u=n,d=this.hooked.get(u),f=d??{};if(!d)for(let e of sp)Object.prototype.hasOwnProperty.call(u,e)&&(f[e]=u[e]);let p=f.onBeforeRender,m=f.onBeforeShadow,h=f.onAfterRender,g=f.onAfterShadow;u.onBeforeRender=(...e)=>{p?.apply(u,e),a=i.calls,o=i.triangles},u.onAfterRender=(...e)=>{h?.apply(u,e);let t=i.calls-a,n=i.triangles-o;c.calls+=t,c.tris+=n,l.calls+=t,l.tris+=n},u.onBeforeShadow=(...e)=>{m?.apply(u,e),a=i.calls,o=i.triangles},u.onAfterShadow=(...e)=>{g?.apply(u,e);let t=i.calls-a,n=i.triangles-o;c.shadowCalls+=t,c.shadowTris+=n,l.shadowCalls+=t,l.shadowTris+=n},d||this.hooked.set(u,f)}for(let i of n.children)t(i,n===e.root?i:r)};t(e.root,e.root)}}end(e){for(let[e,t]of this.hooked)for(let n of sp)t[n]?e[n]=t[n]:delete e[n];if(this.hooked.clear(),this.unbind?.(),this.unbind=null,!e)return null;let t=e.info.render,n=Object.values(this.groups).reduce((e,t)=>({calls:e.calls+t.calls+t.shadowCalls,tris:e.tris+t.tris+t.shadowTris}),{calls:0,tris:0}),r={...this.groups,post:{calls:t.calls-n.calls,tris:t.triangles-n.tris,shadowCalls:0,shadowTris:0}},i=Object.fromEntries(Object.entries(this.detail).filter(([,e])=>e.calls+e.shadowCalls>0).sort((e,t)=>t[1].tris+t[1].shadowTris-(e[1].tris+e[1].shadowTris))),a=(e.info.programs??[]).map(e=>{let t=e;return{type:t.type,name:t.name,used:t.usedTimes,key:t.cacheKey}});return{total:{calls:t.calls,tris:t.triangles},groups:r,detail:i,programs:a,programsDrawn:this.bound.size}}},up=500,dp=new Set([`stun`,`root`,`airborne`,`taunt`,`fear`,`sleep`,`silence`]),fp=3e3,pp=8e3,mp=[`airborne`,`stun`,`sleep`,`taunt`,`fear`,`root`,`silence`],hp=new B,gp=new O,_p=new d,vp=new d,yp=new M,bp=new l,xp={self:new R,ally:new R,enemy:new R,neutral:new R},Sp=new R(0,0,0),Cp=new Set([`fighter`,`minion`,`monster`,`summon`]);function wp(){try{return!1}catch{return!1}}function Tp(){let e=!1;try{e=!1}catch{e=!1}if(!e)return!1;try{return new URLSearchParams(location.search).get(`dev`)===`1`}catch{return!1}}function Ep(e){let t=e.kind===`fighter`&&e.thicket>=0?3:0;for(let n of e.statuses)if(n.remaining>0&&Number.isFinite(n.remaining)){if(n.kind===`invisible`)return 1;n.kind===`untargetable`&&(t=2)}return t}var Dp=class{canvas;gl;catalog;settings;assets;lib;opts;q;dyn=new Ru;lodSwitch=Ln;landmarkCull=Dc;gpuTimer;view=`ok`;viewFns=new Set;dynHoldUntil=0;restoreGen=0;scene=new L;rig=new Mi;sun=new Ro;sky;fog=new ko;terrain=null;mapScene=null;vfx;director;reactions;structs;ambient=null;ambientOn=!0;ambientPending=[];warmAmbient(e){this.asIfComposer(()=>void this.gl.compileAsync(e,this.rig.camera,this.scene).catch(()=>void 0))}actors=new Map;client=null;offEvents=null;pending=[];lastTick=-1;palette;map=null;matchGen=0;menu;mode=`none`;overlay=new Ql;bars=new Zl;rings=new ul;teles=new gl;hoverRim=new ru(mt.ink0);crowd=new wr(Nt.uOutlineRes,{rimUniforms:nu});aim=null;hover=null;target=null;post;cssW=1;cssH=1;time=0;lastFrameAt=0;displayMs=1e3/60;fpsEma=0;frameMs=0;sceneCalls=0;sceneTris=0;crowdInkCap=16;crowdHard=!1;crowdEstimate=0;crowdHardLatch=new pr;skipAcc=0;resources=new Map;tmpColor=new R;ccShown=new Map;shadowDir=new O;raycaster=new se;ground=new ze(new B(0,1,0),0);hudScale=1;ticks=!0;camera;constructor(e,t,n,r,i){this.canvas=e,this.catalog=t,this.settings=n,this.opts=i,this.gl=new P({canvas:e,antialias:!1,alpha:!1,stencil:!1,depth:!0,powerPreference:`high-performance`,preserveDrawingBuffer:!!i.preserveDrawingBuffer}),this.gl.outputColorSpace=de,this.gl.toneMapping=0,this.gl.shadowMap.enabled=!0,this.gl.shadowMap.type=1,this.gl.info.autoReset=!1,this.gpuTimer=new zu(this.gl.getContext()),e.addEventListener(`webglcontextlost`,this.onContextLost,!1),e.addEventListener(`webglcontextrestored`,this.onContextRestored,!1),this.gl.debug.checkShaderErrors=wp(),this.assets=new dt(this.gl,r),this.assets.quiet=!!i.quiet;let a=i.dev??Tp(),o=i.devModelUrl??(a?new URL(`art/out/_proof/_proof_mannequin.glb`,document.baseURI).href:null);this.lib=new ka(t,this.assets,{dev:a,devModelUrl:o,crowd:i.crowd!==!1}),this.lib.onReady=(e,t,n)=>{this.warmTemplate(e,!t,n),t&&this.envReady&&this.asIfComposer(()=>this.crowd.warm(t,this.gl,this.rig.camera,this.scene,this.warmScene,n))},this.sky=new zo(this.gl),this.palette=new _t(t,null,-1,n.access.colorblind);for(let e of t.resources)this.resources.set(e.id,{color:new R().setStyle(e.color),model:e.model});this.scene.name=`vale_match`,this.scene.add(this.sun.light,this.sun.target);let s=new Vu(t,e=>this.actors.get(e),()=>this.time);this.vfx=new zf(t.vfx,{entityPos:(e,t)=>this.bodyPos(e,t),socketPos:(e,t,n)=>s.socketPos(e,t,n)}),this.vfx.setCamera(this.rig.camera),this.scene.add(this.vfx.group),this.scene.add(this.crowd.group),this.reactions=new qa(t),this.structs=new pi({vfx:this.vfx,tint:e=>this.palette.get(Ua(this.palette,e)).clone(),compile:e=>this.envReady?(this.asIfComposer(()=>void this.gl.compileAsync(e,this.rig.camera,this.scene).catch(()=>void 0)),!0):!1}),this.vfx.onFeel=e=>{e.shake>0&&this.rig.shake(e.shake*4,90+e.shake*60),this.reactions.feel(e,this.actors,this.time)},this.director=new Eo(t,this.vfx,{view:()=>this.client?.view??null,palette:()=>this.palette,bodyPos:(e,t)=>this.bodyPos(e,t),visibleAt:(e,t)=>this.visibleAt(e,t),entityVisible:e=>this.entityVisible(e),skinTint:e=>this.skinTint(e),skinSignature:e=>this.skinSignature(e),now:()=>this.time,shake:(e,t)=>this.rig.shake(e,t),plateAt:e=>{let t=this.map;if(!t)return!1;let n=t.art?.terrain?.plate?.at,r=Array.isArray(n)&&typeof n[0]==`number`&&typeof n[1]==`number`;return e.set(r?n[0]:t.size[0]/2,.05,r?n[1]:t.size[1]/2),!0},viewFocus:e=>(e.set(this.rig.focus.x,.05,this.rig.focus.z),!0)}),this.director.eventVfx=i.eventVfx??{},this.director.statusVfx=i.statusVfx??{},this.menu=new Kc(this.gl),this.overlay.teleScene.add(this.teles.mesh),this.overlay.scene.add(this.rings.mesh,this.bars.mesh,this.bars.labels),this.post=new gu(this.gl,this.scene,this.rig.camera,(e,t,n)=>this.overlay.draw(e,t,n,t=>this.drawHover(e,t)),(e,t,n,r)=>{this.vfx.setCamera(r),this.vfx.draw(e,t,n)}),this.q=ju(n.video);let c=this.rig;this.camera={setMode:e=>c.setMode(e),get mode(){return c.mode},scout:e=>c.scout(e),setPointer:(e,t,n)=>c.setPointer(e,t,n),setKeyPan:(e,t)=>c.setKeyPan(e,t),zoomBy:e=>c.zoomBy(e),setZoom:e=>c.setZoom(e),focusOn:(e,t)=>c.focusOn(e,t),centerOnSelf:()=>c.centerOnSelf(),setSpectator:e=>{c.spectator=e}},this.applySettings(n),this.setQuality(n.video),this.resize()}setSettings(e){this.settings={...this.settings,...e},this.applySettings(this.settings),e.video&&this.setQuality(e.video)}applySettings(e){this.palette.setColorblind(e.access.colorblind);for(let e of this.actors.values())e.setAccentColor(``,this.tmpColor.set(0,0,0));this.rig.edgePan=e.controls.edgePan,this.rig.panSpeed=e.controls.panSpeed,this.rig.reduceMotion=e.access.reduceMotion,this.rig.shakeScale=e.access.reduceMotion?0:e.access.screenShake,e.controls.cameraLock&&this.rig.mode!==`locked`&&this.rig.setMode(`locked`),!e.controls.cameraLock&&this.rig.mode===`locked`&&this.rig.setMode(`semi`),this.menu.reduceMotion=e.access.reduceMotion,this.reactions.reduceMotion=e.access.reduceMotion,this.vfx.reduceMotion=e.access.reduceMotion,this.hudScale=Math.max(.75,Math.min(1.25,e.access.hudScale||1)),this.ticks=e.gameplay.healthBarTicks}video;setQuality(e){this.video=e,this.q=ju(e),this.dyn.enabled=this.opts.dynamicResolution!==!1&&e.dynamicResolution!==!1,this.dyn.configure(this.q.renderScale,this.q.fpsCap),this.sun.setQuality(this.gl,this.q.shadows),this.menu.sun.setQuality(this.gl,this.q.shadows),this.post.setQuality({ao:this.q.ao,bloom:this.q.bloom,aa:this.q.aa,tier:this.q.tier}),this.vfx.budget=this.q.particleBudget,this.vfx.density=this.q.particleDensity,this.vfx.secondaryDensity=this.q.secondaryDensity,this.vfx.setLightCount(this.q.flashLights),this.terrain?.setScatter(this.q.scatter,this.q.ao>0),this.ambientOn=e.ambientEffects!==!1,this.ambient?.configure(this.ambientOn,this.q.tier),this.menu.setScatter(this.q.scatter),this.applySize()}resize(e,t){let n=Math.max(1,Math.round(e??(this.canvas.clientWidth||this.canvas.width||1))),r=Math.max(1,Math.round(t??(this.canvas.clientHeight||this.canvas.height||1)));this.cssW=n,this.cssH=r,Nt.uOutlineRes.value.set(n,r),this.rig.setViewport(n,r),this.menu.setAspect(n/r),this.applySize()}aoEased=!1;applySize(){let e=Math.min(typeof devicePixelRatio==`number`?devicePixelRatio:1,this.q.maxDpr),t=Math.max(.25,e*this.dyn.scale);this.gl.setPixelRatio(t);let n=this.dyn.scale;n<.879?this.aoEased=!0:n>.949&&(this.aoEased=!1),this.post.setAoLow(this.aoEased),this.post.setSize(this.cssW,this.cssH)}setScene(e){if(e===`menu`){this.teardownMatch(),Ln.outline=Ln.body=!1,this.assets.mark(),this.menu.build(this.catalog,this.assets),this.releaseMatchContent(),this.mode=`menu`,this.post.setScene(this.menu.scene,this.menu.camera),this.overlay.camera=this.menu.camera,this.assets.lut(this.menu.lut).then(e=>{this.mode===`menu`&&this.post.setLUT(e)});return}this.teardownMatch(),this.setupMatch(e)}setupMatch(e){let t=++this.matchGen;this.client=e,this.mode=`match`,this.menu.sun.releaseMap(),Ln.outline=!0,Ln.body=this.opts.bodyLod!==!1,this.dyn.configure(this.q.renderScale,this.q.fpsCap),this.lastFrameAt=0,this.applySize();let n=e.view,r=this.catalog.maps.find(t=>t.id===(n.map||e.setup.map))??this.catalog.maps[0];if(this.map=r??null,this.palette=new _t(this.catalog,e.setup,e.you,this.settings.access.colorblind),this.post.setScene(this.scene,this.rig.camera),this.overlay.camera=this.rig.camera,!r)return;let i=r.camera;this.rig.camera.fov=i.fovDeg,this.rig.camera.updateProjectionMatrix(),this.rig.setBounds(r.size[0],r.size[1]),mn.valeBounds.value.set(0,0,r.size[0],r.size[1]);let a=r.art.terrain.edgeFog??null;mn.valeEdgeColor.value.setStyle(a?.color??r.art.lighting.fogColor),mn.valeEdgeRange.value.set(a?.startOutsideM??4,a?.fullOutsideM??18);let o=r.art.lighting;this.sun.configure({sunDir:o.sunDir,sunColor:o.sunColor,sunIntensity:o.sunIntensity});{let[e,t,n]=o.sunDir,r=1/Math.max(.05,Math.abs(t));this.shadowDir.set(-e*r,-n*r),this.shadowDir.length()>3&&this.shadowDir.setLength(3)}let s=new R().setStyle(o.sunColor);this.sky.makeFallback(o.sunDir,s,new R(.16,.25,.42),new R().setStyle(o.fogColor).multiplyScalar(.9)),this.sky.solid=new R().setStyle(o.fogColor),this.sky.apply(this.scene,null,o.ambient),this.envReady=!1,this.assets.hdr(r.art.sky).then(e=>{if(t===this.matchGen){e&&this.sky.apply(this.scene,e,o.ambient),this.envReady=!0;for(let e of this.ambientPending.splice(0))this.warmAmbient(e);if(this.lib.warmAll(),this.structs.warmAll(this.actors.values()),this.terrain){let e=this.terrain.group;this.asIfComposer(()=>void this.gl.compileAsync(e,this.rig.camera,this.scene).catch(()=>void 0))}Kn(this.scene)}}),this.assets.lut(r.art.lut).then(e=>{t===this.matchGen&&this.post.setLUT(e)}),this.terrain=Ic(r),this.terrain.setScatter(this.q.scatter,this.q.ao>0),this.ambient=new ap(r,this.catalog.vfx,this.vfx.textures.atlas,8,e=>this.assets.model(e),this.terrain.groundAt),this.ambient.onPart=e=>{t===this.matchGen&&(this.envReady?this.warmAmbient(e):this.ambientPending.push(e))},this.ambient.configure(this.ambientOn,this.q.tier),this.scene.add(this.ambient.group),this.scene.add(this.terrain.group),on(this.terrain.group),this.loadTerrainTextures(r,t),Cc(r,e=>this.assets.model(e)).catch(()=>null).then(e=>{t===this.matchGen&&this.terrain&&(this.terrain.setProps(e??{}),on(this.terrain.group),Kn(this.terrain.group))}),Mc(r,e=>this.assets.model(e),this.terrain.groundAt).then(e=>{if(t===this.matchGen&&this.terrain)for(let t of e)on(t),Kn(t),this.terrain.group.add(t),this.queueUploads(t)}),this.assets.model(r.art.scene).then(e=>{if(t!==this.matchGen||!e?.renderable)return;let n=e.gltf.scene;n.traverse(e=>{let t=e;if(t.isMesh){t.castShadow=!0,t.receiveShadow=!0;for(let e of Array.isArray(t.material)?t.material:[t.material])G(e)}}),this.terrain&&=(this.scene.remove(this.terrain.group),this.terrain.dispose(),null),this.mapScene=n,on(n),this.scene.add(n)}),this.fog.enabled=this.palette.viewer.team>=0;let c=n.players.find(t=>t.player===e.you),l=c?n.entity(c.entity):void 0;l?this.rig.focusOn(l.x,l.y):this.rig.focusOn(r.size[0]/2,r.size[1]/2),this.rig.spectator=this.palette.viewer.team<0,this.rig.setZoom(i.distance),this.offEvents=e.onEvents(e=>{for(let t of e)this.pending.push(t)}),this.lastTick=-1}evictUnusedImages(){if(this.lib.pending>0)return;let e=new Set;H(this.menu.scene,e),H(this.scene,e),this.lib.collectInUse(e),this.assets.evictUnused(e)}lastRelease=null;releaseMatchContent(){let e=new Set;H(this.menu.scene,e);let t=this.catalog.client.menuScene,n=new Set([t.sky,t.model,t.backdrop].filter(e=>typeof e==`string`)),r=this.lib.release(e);this.crowd.releaseBakes(),this.lastRelease={templates:r,...this.assets.release(e,n)}}teardownMatch(){this.matchGen++,this.offEvents?.(),this.offEvents=null,this.pending.length=0;for(let e of this.actors.values())e.dispose();this.crowd.clear(),this.actors.clear(),this.director.clear(),this.structs.clear(),this.ccShown.clear(),this.ambient&&=(this.scene.remove(this.ambient.group),this.ambient.dispose(),null),this.ambientPending.length=0,this.vfx.clear(),this.terrain&&=(this.scene.remove(this.terrain.group),this.terrain.dispose(),null),this.mapScene&&=(this.scene.remove(this.mapScene),null),this.fog.dispose(),nn(),this.gl.renderLists.dispose(),this.sun.releaseMap(),this.sky.release(this.scene),this.uploadQueue.length=0,this.post.releaseMatchTargets(),this.hoverRim.releaseTarget(),this.gpuTimer.clear(),this.envReady=!1,this.client=null,this.map=null,this.mode=`none`}loadTerrainTextures(e,t){let n=(e.art.terrain??{}).textures??{},r=Sc.filter(e=>typeof n[e]==`string`);r.length&&Promise.all(r.map(e=>this.assets.texture(n[e]).then(t=>[e,t]))).then(e=>{if(t!==this.matchGen||!this.terrain)return;let n={};for(let[t,r]of e)r&&(n[t]=r);this.terrain.setTextures(n)})}movers=new Map;moverSeq=-1e3;vfxTest(e,t,n,r={}){let i=new R().setStyle(r.color??`#3F9CFF`),a=r.to??[t+Math.cos(r.dir??0)*6,n+Math.sin(r.dir??0)*6],o;return r.travel&&r.travel>0&&(o=this.moverSeq--,this.movers.set(o,{x0:t,y0:n,x1:a[0],y1:a[1],t0:this.time,dur:r.travel})),this.vfx.spawn(e,{tier:r.tier??3,team:i,element:i,ally:!1,origin:new B(t,1.1,n),target:new B(a[0],1.1,a[1]),ground:new B(t,0,n),scale:r.scale??2.5,dir:r.dir??Math.atan2(a[1]-n,a[0]-t),follow:o,anchor:r.anchor??(o===void 0?`origin`:`path`),phase:r.phase})}vfxIds(){return this.vfx.ids}vfxInfo(e){let t=this.vfx.def(e);return t?{duration:t.duration,span:t.span,path:t.layers.some(e=>e.at===`path`||e.type===`ribbon`),layers:t.layers.map(e=>e.type)}:null}bodyPos(t,n){if(t<=-1e3){let e=this.movers.get(t);if(!e)return!1;let r=(this.time-e.t0)/e.dur;return r>1?(this.movers.delete(t),!1):(n.set(e.x0+(e.x1-e.x0)*r,1.1,e.y0+(e.y1-e.y0)*r),!0)}let r=this.actors.get(t);if(r&&r.leaving<0)return n.set(r.x,r.h+Math.min(1.3,r.artHeight*.55),r.y),!0;let i=this.client?.view.entity(t);if(!i||!i.alive&&i.kind!==`fighter`)return!1;let a=(this.client?.alpha??0)*e,o=i.kind===`projectile`?1.05+i.height:1+i.height;return n.set(i.x-i.vx*(e-a),o,i.y-i.vy*(e-a)),!0}visibleAt(e,t){let n=this.palette.viewer.team;if(n<0||!this.client)return!0;try{let r=this.client.view.visionGrid(n),i=Math.floor(e/r.cell),a=Math.floor(t/r.cell);return i<0||a<0||i>=r.width||a>=r.height?!1:r.data[a*r.width+i]>0}catch{return!0}}feedBrush(e){let t=this.terrain?.brush;if(t){t.begin();for(let e of this.actors.values()){let n=e.view;if(!n||!e.visible||!n.alive||e.leaving>=0||n.kind!==`fighter`&&n.kind!==`minion`&&n.kind!==`monster`&&n.kind!==`summon`)continue;let r=n.kind===`fighter`?this.palette.relation(n.team,n.owner,!0):`neutral`;t.push(e.id,e.x,e.y,n.radius,r===`self`?2:+(r===`ally`))}t.end(e)}}threats=[];feedAmbient(e){let t=this.ambient;if(!t)return;let n=this.threats;n.length=0;for(let e of this.actors.values()){let t=e.view;!t||!e.visible||!t.alive||e.leaving>=0||(t.kind===`fighter`||t.kind===`minion`||t.kind===`monster`||t.kind===`summon`)&&n.push({x:e.x,y:e.y,r:t.radius})}t.update(this.time,e,this.rig.camera,n)}entityVisible(e){let t=this.palette.viewer.team;return t<0||e.team===t||(e.visibleMask>>>t&1)==1}skinTint(e){if(!e.skin)return null;let t=this.catalog.skins.find(t=>t.id===e.skin);return t?.vfxTint?new R().setStyle(t.vfxTint):null}skinSig=new Map;skinSignature(e){if(!e.skin)return null;let t=this.catalog.skins.find(t=>t.id===e.skin)?.vfx;if(!t)return null;let n=t.signature+t.secondary+(t.gain??1),r=this.skinSig.get(e.skin);return(!r||r.key!==n)&&this.skinSig.set(e.skin,r={key:n,sig:new R().setStyle(t.signature).multiplyScalar(t.gain??1),sec:new R().setStyle(t.secondary)}),r}syncActors(e){let t=e.tick,n=t!==this.lastTick;this.lastTick=t;let r=new Set;for(let i of e.entities){if(i.kind===`projectile`||i.kind===`zone`)continue;r.add(i.id);let e=this.actors.get(i.id);if(e)(n||e.view!==i)&&e.pushTick(i,t);else{e=new Ba(i),this.actors.set(i.id,e),this.scene.add(e.root);let n=e;if(i.kind===`fighter`){let t=this.lib.fighter(i.def);t&&(e.configureFighter(t),this.lib.fighterTemplate(i.def,i.skin).then(e=>{n.attach(e,t.art.scale,t.art.accentMaterial)}))}else{let t=this.lib.unit(i.def);t&&(e.configureUnit(t),this.lib.unitTemplate(i.def,this.palette.ffa?null:i.team).then(e=>{n.attach(e,t.art.scale,`accent`),t.kind===`structure`&&n.model&&this.structs.attach(n,t)}))}e.pushTick(i,t)}}for(let[e,t]of this.actors)if(!r.has(e)){if(t.leaving<0&&(t.leaving=0),t.kind===`structure`){this.structs.forget(t),t.dispose(),this.actors.delete(e);continue}t.leaving>.6&&(t.dispose(),this.actors.delete(e))}}culledVis=[];recullActors(e){if(!this.culledVis.length)return;let t=this.rig.camera;_p.setFromProjectionMatrix(yp.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse));let n=this.culledVis.filter(e=>this.actorLod(e)!==2);this.culledVis.length=0;for(let t of n)this.updateActor(t,0,e,!0)}actorLod(e){let t=this.shadowDir.x,n=this.shadowDir.y,r=Math.hypot(t,n),i=e.artHeight;return bp.center.set(e.x+t*i*.5,e.h+i*.5,e.y+n*i*.5),bp.radius=i*.5+e.radius+2+r*i*.5,_p.intersectsSphere(bp)?+(e.view?.kind===`minion`&&Math.hypot(e.x-this.rig.focus.x,e.y-this.rig.focus.z)>12):2}updateActors(e,t){let n=this.rig.camera;_p.setFromProjectionMatrix(yp.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse)),this.culledVis.length=0;for(let n of this.actors.values())this.updateActor(n,e,t,!1)}updateActor(e,t,n,r){let i=this.hover,a=this.palette,o=this.rig.camera,s=ea,c=a.get(s.rest.color);for(let e of[`self`,`ally`,`enemy`,`neutral`])xp[e].copy(c).convertLinearToSRGB().lerp(this.tmpColor.copy(a.relationColor(e)).convertLinearToSRGB(),s.rest.relationTint).convertSRGBToLinear();let l=a.relationColor(`enemy`),u=a.relationColor(`ally`);{let c=e.view;if(!c)return;let d=this.entityVisible(c)&&(c.alive||c.kind===`fighter`||e.leaving>=0||c.state===`dead`);if(e.visible=d,!d){e.root.visible=!1,e.culled=!0,e.hidden();return}let f=Ua(a,c);e.setAccentColor(f,a.get(f));let p=r?0:this.actorLod(e);if(e.culled=p===2,e.root.visible=!e.culled,e.culled&&this.culledVis.push(e),e.update(t,n,p),e.model){let t=a.relation(c.team,c.owner,c.kind===`fighter`),n=c.alive&&e.leaving<0&&p!==2,r=n&&i===e.id&&t!==`self`;if(e.setHover(r?t===`ally`?s.hoverAlly.px:s.hoverEnemy.px:0,r?t===`ally`?u:l:null),n&&Cp.has(c.kind)?e.setOutline(s.rest.px,xp[t],s.rest.alpha):e.hideOutline(),e.setVeil(c.alive&&c.kind!==`structure`?Ep(c):0),c.kind===`fighter`){let r=o.position;e.setXray(n&&e.veil!==1&&e.veil!==3&&(!this.crowdHard||t!==`enemy`)&&!!this.terrain?.coverToward(e.x,e.y,r.x,r.z,r.y-e.h),a.get(f))}}}}buildOverlay(e){let t=this.palette,n=this.bars,r=this.rings,i=this.gl.getDrawingBufferSize(gp).y,a=Math.max(.8,this.cssH/1080)*this.hudScale*(i/this.cssH);n.begin(a),r.begin();let o=t.viewer.you,s=new Map(e.players.map(e=>[e.player,e])),c=o>=0?s.get(o)?.entity:void 0,l=c===void 0?void 0:e.entity(c),u=[],d=null;for(let e of this.actors.values()){let i=e.view;if(!i||!e.visible||e.leaving>=0)continue;let a=i.kind===`fighter`,o=t.relation(i.team,i.owner,a),c=t.unitHex(i.team,i.owner,a||i.kind===`summon`),f=t.get(c),p=Math.max(i.maxHp,i.hp+i.shield,1),m=Math.max(0,i.hp)/p;m<e.lastHpFrac-1e-4&&(e.trail<e.lastHpFrac&&(e.trail=e.lastHpFrac),(this.time>=e.trailHoldUntil+.45||e.trail<=m)&&(e.trailFrom=e.trail),e.trailFrom=Math.max(e.trailFrom,e.trail),e.trailHoldUntil=this.time+.15),e.lastHpFrac=m,this.time>e.trailHoldUntil&&(e.trail=e.trailFrom+(m-e.trailFrom)*Math.min(1,(this.time-e.trailHoldUntil)/.45)),e.trail<m&&(e.trail=m,e.trailFrom=m);let h=i.alive&&i.state!==`dead`;if(h){if(a){let t=o===`self`?ol.self:o===`ally`?ol.ally:o===`enemy`?ol.enemy:ol.neutral;r.push(e.x,e.y,i.radius+.22,e.facing,t,f,1,+(e.id===this.hover))}else if(i.kind===`monster`)(i.state!==`idle`&&i.state!==`move`||i.hp<i.maxHp-.001||e.id===this.hover)&&r.push(e.x,e.y,i.radius+.18,e.facing,ol.neutral,f,.9,+(e.id===this.hover));else if(e.id===this.hover||e.id===this.target){let t=o===`ally`?ol.ally:o===`enemy`?ol.enemy:ol.neutral;r.push(e.x,e.y,i.radius+.15,e.facing,t,f,.9,1)}if(i.kind===`structure`&&l&&l.alive&&o===`enemy`){let t=(this.lib.unit(i.def)?.attack?.range??0)+i.radius;t>0&&Math.hypot(l.x-i.x,l.y-i.y)<t+l.radius+4&&r.push(e.x,e.y,t,0,ol.range,f,.85,0)}}if(!h){this.ccShown.delete(i.id);continue}let g=El.fighter,_=!0;if(i.kind===`minion`||i.kind===`summon`?(g=El.minion,_=o===`enemy`||i.hp<i.maxHp-.001||e.id===this.hover||e.id===this.target):i.kind===`structure`?g=El.structure:i.kind===`monster`?(g=El.monster,_=i.hp<i.maxHp-.001||i.state!==`idle`||e.id===this.hover):(i.kind===`ward`||i.kind===`pickup`)&&(_=!1),!_)continue;let v=o===`self`?Dl.self:o===`ally`?Dl.ally:o===`enemy`?Dl.enemy:Dl.neutral,y=this.tmpColor.set(0,0,0),b=!1,x=!1,S=0,C=-1,w=null,T=0;if(a){let e=this.lib.fighter(i.def),r=e?this.resources.get(e.resource):void 0;r&&r.model!==`none`&&i.maxRes>0&&(y=r.color,b=!0,x=r.model===`heat`),S=i.level;let a=s.get(i.owner);if(a&&(C=n.nameSlot(a.name)),t.ffa){if(o===`self`)w=t.get(t.seatHexOf(i.owner));else{let e=pt.find(e=>e.color.toLowerCase()===c.toLowerCase());T=e?.keyline===`chalk`?1:e?.keyline===`ink`?2:0}}}let E=0,D=``,O=99,ee=0;for(let e of i.statuses){if(!dp.has(e.kind)||!(e.duration>0))continue;E=Math.max(E,e.remaining/e.duration);let t=mp.indexOf(e.kind);t>=0&&(t<O||t===O&&e.remaining>ee)&&(O=t,D=e.kind,ee=e.remaining)}let k=-1,te=0;if(a&&D){let e=this.ccShown.get(i.id);(!e||e.kind!==D)&&this.ccShown.set(i.id,{kind:D,t:this.time});let t=this.time-(this.ccShown.get(i.id)?.t??this.time);k=n.ccSlot(D,this.catalog.strings[`status.${D}.name`]??D.replace(/_/g,` `)),te=Math.min(1,Math.max(0,t/(Ul.fadeInMs/1e3)))}else a&&this.ccShown.delete(i.id);let A={x:e.x,y:e.h+e.barHeight,z:e.y,kind:g,shape:v,hp:m,trail:e.trail,shieldEnd:Math.min(1,(Math.max(0,i.hp)+i.shield)/p),total:this.ticks?p:1e9,res:i.maxRes>0?i.res/i.maxRes:0,showRes:b,resHatch:x,cc:E,color:f,resColor:y,glyph:g===El.structure?i.team===0?Ol.spire:Ol.dome:a?Ol.chip:Ol.none,keyline:T,seatLine:w,alpha:1,nameSlot:C,level:S,flash:e.trailHoldUntil>0?Math.max(0,1-(this.time-(e.trailHoldUntil-.15))/.066):0,ccPlate:k,ccAlpha:te};a?(A.resColor===this.tmpColor&&(A.resColor=Sp),o===`self`?d=A:u.push(A)):n.push(A)}for(let e of u)n.push(e);d&&n.push(d),n.end(),r.end(),this.buildTelegraphs()}buildTelegraphs(){let e=this.palette,t=this.teles;t.begin();let n=this.time,r={x:0,z:0,dir:0,shape:0,radius:1,inner:0,halfAngle:.5,length:1,width:1,color:this.tmpColor,fill:0,edge:0,edgePx:2,sweep:1,dashed:!1,tick:null,ringFlash:0,ringDepth:0};for(let i of this.director.telegraphs){if(n<i.start)continue;let a=e.relation(i.team,i.owner,!0),o=i.shape;r.x=i.x,r.z=i.y,r.dir=i.dir,r.shape=o.kind===`circle`?dl.circle:o.kind===`ring`?dl.ring:o.kind===`cone`?dl.cone:dl.rect,r.radius=o.radius??1,r.inner=o.inner??0,r.halfAngle=(o.angle??Math.PI/3)/2,r.length=o.length??1,r.width=o.width??1,r.dashed=!1,r.ringFlash=0;let s=Math.max(.001,i.land-i.start),c=i.zone<0&&i.land>i.start,l=c?Math.min(1,(n-i.start)/s):1,u=n>=i.land&&i.zone<0;if(r.sweep=c&&!u?l:1,r.tick=e.ffa&&i.owner>=0&&a!==`self`?e.get(e.seatHexOf(i.owner)):null,a===`enemy`||e.viewer.team<0){r.color=e.get(e.viewer.team<0?e.unitHex(i.team,i.owner,!0):e.relationHex(`enemy`)),r.fill=u?.4:i.zone>=0?.16:.16+.14*l,r.edge=.9,r.edgePx=3;let t=r.shape===dl.rect?Math.max(r.length,r.width)*.5:r.radius;u&&t>4&&(r.fill=.2,r.ringFlash=.5,r.ringDepth=fl(r.shape,r.radius,r.inner,r.halfAngle,r.width))}else a===`neutral`?(r.color=e.relationColor(`neutral`),r.fill=.12,r.edge=.8,r.edgePx=2):(r.color=i.heal?e.get(`#63D88B`):e.relationColor(a===`self`?`self`:`ally`),r.fill=a===`self`?.08:0,r.edge=i.heal?.5:a===`self`?.6:.45,r.edgePx=2,u&&(r.fill=Math.max(r.fill,.12)));t.push(r)}let i=this.aim;if(i){let n=e.relationColor(`self`);i.range&&i.range>0&&t.push({...r,x:i.casterX??i.x,z:i.casterY??i.y,dir:0,shape:dl.circle,radius:i.range,inner:0,color:n,fill:0,edge:.45,edgePx:2,sweep:1,dashed:!0,tick:null,key:.45,ringFlash:0});let a=i.shape===`circle`?dl.circle:i.shape===`ring`?dl.ring:i.shape===`cone`?dl.cone:dl.rect;t.push({...r,x:i.x,z:i.y,dir:i.dir??0,shape:a,radius:i.radius??1,inner:i.inner??0,halfAngle:(i.angleDeg??60)*Math.PI/360,length:i.length??6,width:i.shape===`line`?Math.min(i.width??.4,.6):i.width??1.2,color:i.heal?e.get(`#63D88B`):n,fill:.12,edge:.9,edgePx:2.5,sweep:1,dashed:!1,tick:null,key:.55,ringFlash:0})}t.end()}render(e){if(typeof document<`u`&&document.hidden)return;let t=Math.max(0,Math.min(.25,Number.isFinite(e)?e:0));t>.002&&t<.1&&(this.displayMs=this.displayMs>0?this.displayMs*.95+t*50:t*1e3);let n=this.calib?0:this.mode===`menu`&&this.menu.idle>4?30:this.q.fpsCap;if(n>0){if(this.skipAcc+=t,this.skipAcc<1/n-.002)return;this.skipAcc=0}let r=performance.now();if(this.calib&&this.calibSample(r),this.lastFrameAt>0){let e=r-this.lastFrameAt;this.fpsEma=this.fpsEma>0?this.fpsEma*.9+1e3/Math.max(1,e)*.1:1e3/Math.max(1,e);let t=n>0&&1e3/n>this.displayMs*1.1,i=this.view!==`ok`||r<this.dynHoldUntil;if(this.mode===`match`&&this.dyn.enabled&&!t){let t=this.gpuTimer.poll();i?this.dyn.reset():this.dyn.sample(e,this.frameMs,t)&&this.applySize()}else this.dyn.reset()}this.lastFrameAt=r,this.time+=t,mn.valeTime.value=this.time,U.uTime.value=this.time,this.mode===`match`&&this.client?this.frameMatch(t):this.mode===`menu`&&(this.menu.update(t),this.vfx.update(t));let i=this.gl.info;i.reset();let a=this.dyn.enabled&&this.mode===`match`&&this.view!==`lost`;a&&this.gpuTimer.begin();let o=this.profileWaiters.length>0&&this.mode===`match`;if(o&&this.profiler.begin(this.gl,this.profileRoots()),this.post.render(t),o){let e=this.profiler.end(this.gl);for(let t of this.profileWaiters.splice(0))t(e)}a&&this.gpuTimer.end(),this.sceneCalls=i.render.calls,this.sceneTris=i.render.triangles,this.frameMs=performance.now()-r}frameMatch(e){let t=this.client,n=t.view,r=t.alpha;if(this.syncActors(n),this.pending.length){let e=this.pending.splice(0,this.pending.length);this.reactions.handle(e,this.actors,this.time),this.director.handle(e),this.structs.handle(e)}this.director.update(n),this.updateActors(e,r);let i=n.players.find(e=>e.player===t.you),a=i?this.actors.get(i.entity):void 0;a&&a.view?.alive?this.rig.setSelf(a.x,a.y):this.rig.setSelf(null,null),this.rig.update(e),this.recullActors(r),this.crowd.begin();for(let e of this.actors.values())e.crowdBake&&e.model&&e.root.visible&&this.crowd.push(e);let o=this.sceneTris+Math.max(0,this.crowd.estimate(this.crowdInkCap,this.crowdHard)-this.crowdEstimate);o>44e4?this.crowdInkCap=1:this.sceneTris<38e4&&!this.crowdHard&&(this.crowdInkCap=16),this.crowdHard=this.crowdHardLatch.update(this.sceneTris,this.crowd.pending,o),this.crowdEstimate=this.crowd.estimate(this.crowdInkCap,this.crowdHard),this.crowd.end(this.rig.focus.x,this.rig.focus.z,this.crowdInkCap,this.crowdHard),this.structs.update(e,this.time,n,this.rig.camera,[i?i.entity:-1,this.hover??-1,this.target??-1],this.actors),this.fog.update(n,this.palette.viewer.team,e),this.sun.fit(this.rig.camera);{let e=this.uploadQueue.shift();e&&this.gl.initTexture(e)}this.cullScatter(),this.feedBrush(e),this.feedAmbient(e),this.terrain?.update(this.time),this.vfx.update(e),this.buildOverlay(n),--this.shadowSweep<=0&&(this.shadowSweep=30,on(this.scene),Kn(this.scene,4))}shadowSweep=0;cullView={frustum:vp,fx:0,fz:0,sdx:0,sdz:0,version:0};cullKey=new Float32Array(18);cullScatter(){if(!this.terrain)return;let e=this.rig.camera,t=this.cullView;yp.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse);let n=this.sun.shadowsOn&&!this.crowdHard,r=n?this.shadowDir.x:0,i=n?this.shadowDir.y:0,a=this.cullKey,o=yp.elements,s=t.version>0&&a[16]===Math.fround(r)&&a[17]===Math.fround(i);for(let e=0;s&&e<16;e++)s=a[e]===Math.fround(o[e]);if(!s){for(let e=0;e<16;e++)a[e]=o[e];a[16]=r,a[17]=i,vp.setFromProjectionMatrix(yp),t.fx=this.rig.focus.x,t.fz=this.rig.focus.z,t.sdx=r,t.sdz=i,t.version++}this.terrain.cull(t)}activeCamera(){return this.mode===`menu`?this.menu.camera:this.rig.camera}pickGround(e,t){let n=this.activeCamera();gp.set(e/this.cssW*2-1,-(t/this.cssH)*2+1),this.raycaster.setFromCamera(gp,n);let r=this.raycaster.ray.intersectPlane(this.ground,hp);return r?{x:r.x,y:r.z}:null}pickEntity(e,t,n){return this.mode===`match`?xu(this.rig.camera,this.cssW,this.cssH,this.pickables(),e,t,n):null}unitPos(e){let t=this.actors.get(e);return t?{x:t.x,y:t.y}:null}*pickables(){for(let e of this.actors.values()){let t=e.view;!t||!e.visible||!t.alive||!t.targetable||e.leaving>=0||t.kind===`pickup`||(yield{id:e.id,x:e.x,y:e.y,h:e.h,artHeight:e.artHeight,view:t})}}worldToScreen(e,t,n=0){let r=this.activeCamera();hp.set(e,n,t).project(r);let i=(hp.x*.5+.5)*this.cssW,a=(-hp.y*.5+.5)*this.cssH;return{x:i,y:a,visible:hp.z<1&&hp.z>-1&&i>=0&&a>=0&&i<=this.cssW&&a<=this.cssH}}warmed=new WeakSet;warmTemplate(e,t=!0,n=!1){let r=this.gl;if(Kn(e),!n){if(this.warmed.has(e))return;this.warmed.add(e),this.uploadTextures(e)}t&&this.envReady&&this.asIfComposer(()=>void r.compileAsync(e,this.rig.camera,this.scene).catch(()=>void 0))}envReady=!1;uploadQueue=[];queueUploads(e){let t=new Set(this.uploadQueue);e.traverse(e=>{let n=e;if(n.isMesh)for(let e of Array.isArray(n.material)?n.material:[n.material])for(let n of Object.values(e)){let e=n;e&&e.isTexture&&!t.has(e)&&(t.add(e),this.uploadQueue.push(e))}})}uploadTextures(e){let t=this.gl;e.traverse(e=>{let n=e;if(n.isMesh)for(let e of Array.isArray(n.material)?n.material:[n.material])for(let n of Object.values(e))n&&n.isTexture&&t.initTexture(n)})}warmRT=null;warmScene=new L;asIfComposer(e){this.warmRT??=new ne(1,1);let t=this.gl.getRenderTarget();this.gl.setRenderTarget(this.warmRT);try{e()}finally{this.gl.setRenderTarget(t)}}drawHover(e,t){if(this.mode!==`match`||this.hover===null)return;let n=this.actors.get(this.hover),r=n?.crowdBake?n.root.visible?this.crowd.hoverTarget(n,n.hoverWidth,n.hoverTint):null:n?.hoverTarget();r&&this.hoverRim.draw(e,t,e.getRenderTarget(),r)}get viewState(){return this.view}onViewState(e){return this.viewFns.add(e),()=>{this.viewFns.delete(e)}}setView(e){if(this.view!==e){this.view=e;for(let t of[...this.viewFns])try{t(e)}catch{}}}onContextLost=()=>{this.restoreGen++,this.gpuTimer.abandon(),this.dyn.reset(),this.assets.contextLost(),this.setView(`lost`)};onContextRestored=()=>{let e=++this.restoreGen;this.gpuTimer=new zu(this.gl.getContext()),this.dyn.reset(),this.lastFrameAt=0,this.setView(`restoring`),this.vfx.textures.ready=!1,this.vfx.textures.generate(this.gl),this.warmed=new WeakSet;let t=[];t.push(this.assets.restoreImages().catch(()=>0)),this.asIfComposer(()=>{let e=this.rig.camera;this.mode===`match`&&t.push(this.gl.compileAsync(this.scene,e).catch(()=>void 0)),this.vfx.prewarm(this.gl,e)}),this.mode===`match`&&this.envReady&&(this.lib.warmAll(),this.structs.warmAll(this.actors.values())),Promise.race([Promise.all(t),new Promise(e=>setTimeout(e,pp))]).then(()=>{e===this.restoreGen&&(this.dynHoldUntil=performance.now()+fp,this.setView(`ok`))})};listenerFocus(){return{x:this.rig.focus.x,y:this.rig.focus.z}}setAim(e){this.aim=e}setHover(e){this.hover=e}setTarget(e){this.target=e}setStation(e){this.menu.setStation(e)}setMenuView(e){this.menu.build(this.catalog,this.assets),this.menu.setStation(e.screen),this.menu.setShowcase(e.fighter?this.lib:null,e.fighter??null,e.skin??null)}mapExtras(e){let t=e.art.terrain??{},n=[],r=new Set;if(Array.isArray(t.landmarks))for(let e of t.landmarks){let t=e?.model;typeof t==`string`&&r.add(t)}for(let e of r)n.push(this.assets.model(e).then(e=>{e?.renderable&&this.uploadTextures(e.gltf.scene)}));for(let e of Object.values(t.props??{}))if(Array.isArray(e))for(let t of e)typeof t==`string`&&n.push(this.assets.model(t));for(let e of Sc){let r=t.textures?.[e];typeof r==`string`&&n.push(this.assets.texture(r).then(e=>{e&&this.gl.initTexture(e)}))}return n}async preload(e,t){let n=this.catalog.maps.find(t=>t.id===e.map),r=new Set;if(n){for(let e of n.structures)r.add(e.unit);for(let e of n.camps)for(let t of e.units)r.add(t.unit);for(let e of n.pickups)r.add(e.unit)}let i=this.catalog.modes.find(t=>t.id===e.mode);for(let e of i?.rules.minionWaves?.composition??[])r.add(e.unit);let a=e=>{if(Array.isArray(e)){for(let t of e)a(t);return}if(e&&typeof e==`object`)for(let[t,n]of Object.entries(e))t===`unit`&&typeof n==`string`?r.add(n):a(n)};a(this.catalog.items);let o=gt(i)?null:[...e.seats.map(e=>e.team),...n?.structures.map(e=>e.team)??[]],s=this.lib.refsFor(e.seats.map(e=>({fighter:e.fighter,skin:e.skin})),r,o).map(e=>this.assets.model(e,!0));if(s.push(Nn),n){s.push(this.assets.hdr(n.art.sky),this.assets.lut(n.art.lut),this.assets.model(n.art.scene));for(let e of ap.refs(n))s.push(this.assets.model(e))}n&&s.push(...this.mapExtras(n));for(let t of e.seats)s.push(this.lib.fighterTemplate(t.fighter,t.skin));for(let e of r)for(let t of o?[...new Set(o)]:[null])s.push(this.lib.unitTemplate(e,t));let c=0;t?.(0),await Promise.all(s.map(e=>e.then(()=>{c++,t?.(c/s.length)}))),this.evictUnusedImages(),this.asIfComposer(()=>this.vfx.prewarm(this.gl,this.rig.camera)),t?.(1)}calib=null;calibrate(e=3){return this.calib?Promise.resolve({preset:`high`,frames:0,p50Ms:0,p95Ms:0}):new Promise(t=>{let n=this.video;this.setQuality({...n,...Du.high,preset:`high`,fpsCap:0}),this.dyn.enabled=!1,this.applySize();let r=performance.now(),i=e=>{clearTimeout(a),this.calib=null,this.setQuality(n),t(e)},a=setTimeout(()=>{this.calib&&this.calibFinish(!0)},(e*4+1)*1e3);this.calib={start:r+up,end:r+up+e*1e3,last:0,iv:[],windows:[],seconds:e,video:n,done:i}})}calibSample(e){let t=this.calib;e>=t.start&&t.last>0&&t.iv.push(e-t.last),t.last=e,e>=t.end&&this.calibFinish()}calibFinish(e=!1){let t=this.calib;if(t.windows.push(Cu(t.iv)),!e&&Tu(t.windows)){let e=performance.now();t.iv=[],t.start=e,t.end=e+t.seconds*1e3,t.last=0;return}let n=this.gl.getDrawingBufferSize(new O),r=Eu(t.windows,n.x*n.y),i=e=>Math.round((e??0)*100)/100;t.done({preset:r.preset,frames:r.best?.frames??0,p50Ms:i(r.best?.p50Ms),p95Ms:i(r.best?.p95Ms),windows:t.windows.length,capped:r.capped})}stats(){let e=this.gl.info,t=this.gl.getDrawingBufferSize(new O);return{fps:Math.round(this.fpsEma*10)/10,frameMs:Math.round(this.frameMs*100)/100,calls:e.render.calls,triangles:e.render.triangles,sceneCalls:this.sceneCalls,sceneTriangles:this.sceneTris,programs:e.programs?.length??0,geometries:e.memory.geometries,textures:e.memory.textures,renderScale:this.dyn.scale,pixelRatio:this.gl.getPixelRatio(),tier:this.q.tier,width:t.x,height:t.y,particles:this.vfx.particleCount,vfx:this.vfx.instanceCount,actors:this.actors.size,telegraphs:this.teles.size,mode:this.mode,gpuMs:this.dyn.enabled?this.gpuTimer.last:null,bound:this.dyn.bound,gpuTimer:this.gpuTimer.available?this.dyn.timerTrusted?`trusted`:`untrusted`:`none`,ambient:this.ambient?.stats()??null,crowd:this.crowd.instances}}injectEvents(e){for(let t of e)this.pending.push(t)}profiler=new lp;profileWaiters=[];profile(){return new Promise(e=>this.profileWaiters.push(e))}profileRoots(){let e=(e,t)=>{let n=e;for(;n.parent&&n.parent!==t;)n=n.parent;return n},t=`vale_scatter`,n=e=>e.startsWith(`vale_trees`)||e===`vale_trunks`||e===`vale_canopies`?`canopy`:e.startsWith(`vale_clutter`)?`clutter`:`rocks`,r=[{root:this.scene,group:`other`}];this.terrain&&r.push({root:this.terrain.group,group:(r,i)=>i.name===`vale_needlegrass`?`grass`:i.name===t?n(e(r,i).name):i.name.startsWith(`vale_`)?`terrain`:`landmarks`,part:(n,r)=>r.name===t?e(n,r).name:r.name||r.type}),this.mapScene&&r.push({root:this.mapScene,group:`terrain`}),this.ambient&&r.push({root:this.ambient.group,group:`ambient`});let i=e=>{let t=e.name;return e.userData.valeXray?`.xray`:t===`vale_flash`||t===`crowd_flash`?`.flash`:t===`vale_outline`||t===`crowd_outline`?`.outline`:t===`vale_veil_depth`?`.veil`:t===`crowd_part_accent`?`.accent`:``};r.push({root:this.crowd.group,group:`actors`,part:e=>`crowd${i(e)}`});for(let e of this.actors.values())r.push({root:e.root,group:`actors`,part:t=>`${e.kind}${i(t)}`});return r.push({root:this.vfx.scene,group:`vfx`}),r.push({root:this.overlay.scene,group:`overlay`},{root:this.overlay.teleScene,group:`overlay`}),r}dispose(){this.canvas.removeEventListener(`webglcontextlost`,this.onContextLost,!1),this.canvas.removeEventListener(`webglcontextrestored`,this.onContextRestored,!1),this.viewFns.clear(),this.teardownMatch(),this.menu.dispose(),this.vfx.dispose(),this.bars.dispose(),this.rings.dispose(),this.teles.dispose(),this.hoverRim.dispose(),this.crowd.dispose(),this.overlay.dispose(),this.post.dispose(),this.sky.dispose(),this.gpuTimer.dispose(),this.warmRT?.dispose(),this.gl.dispose()}};function Op(e,t,n,r,i={}){return new Dp(e,t,n,r,i)}export{K as CAMERA,Op as createRenderer,Ou as presetVideo,ju as resolveQuality};
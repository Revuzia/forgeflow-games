import * as THREE from 'three';

/**
 * NULL SPIRE — high-altitude / orbital sky scenery module for Grid Rush.
 *
 * Theme: racing among the stars, high above the world, around a dead antenna.
 *   - Deep procedural STARFIELD (THREE.Points, thousands) + brighter hero stars.
 *   - Gradient sky dome with a subtle drifting nebula (violet #aa66ff / magenta #ff2bd6).
 *   - A huge PLANET LIMB rising on the horizon (crescent-lit, atmosphere rim, thin ring).
 *   - An AURORA curtain band wrapping the horizon.
 *   - Slow-orbiting SATELLITES on two tilted instanced orbital shells.
 *   - Drifting DEBRIS field + floating RING STATIONS + a ring of broken antenna PYLONS
 *     rising off the energy floor to echo the central spire (built by track.js _buildSpire).
 *   - A faint reflective ENERGY-GRID floor far below (we are up in the sky).
 *   - Near-field light MOTES drifting past the track for foreground depth.
 *
 * Performance: every repeated prop is an InstancedMesh; every star/mote layer is one
 * THREE.Points; sky/planet/aurora/floor are single shader meshes. ~17 draw calls total.
 *
 * Animation: the interface exposes no per-frame update hook, so this module drives its
 * own guarded requestAnimationFrame loop. The loop self-terminates the moment the group
 * is detached from the scene (game disposal), so nothing leaks past race end.
 *
 * Determinism: uses ONLY ctx.rnd (seeded). Self-contained: imports only 'three'.
 */
export function buildScene(ctx) {
  const { group, samples, def, rnd } = ctx;
  const R = def.radius;
  const HALF = ctx.HALF;
  const N = samples.length;

  // sRGB component extraction — custom ShaderMaterials write straight to the sRGB
  // framebuffer with no tone-mapping/colorspace pass, so feed them raw sRGB (not the
  // linear values THREE.Color would produce). Lit/basic materials keep hex as usual.
  const sRGB = (hex) =>
    new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  const PR = Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 1.75);

  const RAIL = def.rail;     // violet
  const ACCENT = def.accent; // magenta
  const railV = sRGB(RAIL);
  const accentV = sRGB(ACCENT);

  const timeUniforms = []; // {value} refs updated each frame
  const spinners = [];     // { obj, rate } slow rotators

  // Shared GLSL value-noise / fbm used by dome + aurora.
  const NOISE_GLSL = `
    float h31(vec3 p){ return fract(sin(dot(p, vec3(17.13,113.51,71.79)))*43758.5453); }
    float vnoise(vec3 p){
      vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      float n=mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x),
                      mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
                  mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),
                      mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);
      return n;
    }
    float fbm(vec3 p){ float a=0.5,s=0.0; for(int k=0;k<4;k++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
  `;

  // ------------------------------------------------------------------ SKY DOME
  {
    const uni = {
      uTop: { value: sRGB(def.skyTop) },
      uBot: { value: sRGB(def.skyBot) },
      uNebA: { value: railV.clone() },
      uNebB: { value: accentV.clone() },
      uTime: { value: 0 },
    };
    timeUniforms.push(uni.uTime);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `
        precision highp float;
        varying vec3 vDir;
        uniform vec3 uTop,uBot,uNebA,uNebB; uniform float uTime;
        ${NOISE_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
          vec3 base = mix(uBot, uTop, pow(h,0.75));
          // drifting nebula, strongest in a mid-altitude band
          float n1 = fbm(d*3.0 + vec3(0.0, uTime*0.006, 0.0));
          float n2 = fbm(d*6.0 + vec3(11.3) + vec3(uTime*0.004,0.0,0.0));
          float band = 1.0 - abs(d.y);
          float neb = smoothstep(0.52, 1.0, n1) * band * band;
          vec3 nebCol = mix(uNebA, uNebB, smoothstep(0.25,0.85,n2));
          base += nebCol * neb * 0.55;
          // faint horizon lift
          base += uNebB * smoothstep(0.22,0.0,abs(d.y)) * 0.05;
          gl_FragColor = vec4(base, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 5.0, 40, 24), mat);
    dome.renderOrder = -20;
    dome.frustumCulled = false;
    group.add(dome);
  }

  // ------------------------------------------------------------- STARFIELD (far)
  {
    const count = 5200;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const shell = R * 4.6;
    // Weighted star palette: mostly white/blue-white, dusted with theme violet/magenta.
    const palette = [0xffffff, 0xffffff, 0xdfe8ff, 0xb9ccff, 0x9fb6ff, RAIL, ACCENT, 0xffe1c0];
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // uniform on sphere
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      v.set(rr * Math.cos(th), u, rr * Math.sin(th)).multiplyScalar(shell * (0.9 + rnd() * 0.2));
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      const c = sRGB(palette[(rnd() * palette.length) | 0]);
      const b = 0.5 + rnd() * 0.5;
      col[i * 3] = c.x * b; col[i * 3 + 1] = c.y * b; col[i * 3 + 2] = c.z * b;
      size[i] = 1.0 + rnd() * rnd() * 3.2;
      phase[i] = rnd() * 6.283;
    }
    addStarPoints(pos, col, size, phase, -18, 1.7, false);
  }

  // ------------------------------------------------------------ HERO stars (glow)
  {
    const count = 340;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const shell = R * 4.2;
    const palette = [0xffffff, 0xcfe0ff, RAIL, ACCENT, 0xa8ffe6];
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      v.set(rr * Math.cos(th), u * 0.9 + 0.15, rr * Math.sin(th)).normalize().multiplyScalar(shell);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      const c = sRGB(palette[(rnd() * palette.length) | 0]);
      col[i * 3] = c.x; col[i * 3 + 1] = c.y; col[i * 3 + 2] = c.z;
      size[i] = 6 + rnd() * 10;
      phase[i] = rnd() * 6.283;
    }
    addStarPoints(pos, col, size, phase, -17, 2.6, true);
  }

  // Points helper (far stars + hero share it; hero=true adds a bright core).
  function addStarPoints(pos, col, size, phase, order, twAmp, hero) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const uni = { uPR: { value: PR }, uTime: { value: 0 }, uTw: { value: twAmp } };
    timeUniforms.push(uni.uTime);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uPR, uTime;
        attribute float aSize; attribute vec3 aColor; attribute float aPhase;
        varying vec3 vColor; varying float vTw;
        void main(){
          vColor = aColor;
          vTw = 0.55 + 0.45*sin(uTime*1.5 + aPhase);
          vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_Position = projectionMatrix*mv;
          gl_PointSize = aSize*uPR;
        }`,
      fragmentShader: `
        precision highp float;
        varying vec3 vColor; varying float vTw;
        void main(){
          vec2 c = gl_PointCoord-0.5; float d = length(c);
          float halo = smoothstep(0.5,0.03,d);
          ${hero ? 'float core = smoothstep(0.16,0.0,d); halo += core*1.4;' : ''}
          float a = halo*vTw;
          gl_FragColor = vec4(vColor*a, a);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = order;
    pts.frustumCulled = false;
    group.add(pts);
  }

  // --------------------------------------------------------------- PLANET LIMB
  {
    const planet = new THREE.Group();
    const pr = R * 1.25;
    const ang = rnd() * Math.PI * 2;
    const dist = R * 3.4;
    planet.position.set(Math.cos(ang) * dist, -R * 0.72, Math.sin(ang) * dist);
    // crescent light coming from just above the horizon toward the viewer's left
    const lightDir = new THREE.Vector3(-0.55, 0.28, -0.6).normalize();

    // body
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: sRGB(0x4a2270) },
        uNight: { value: sRGB(0x0b0518) },
        uRim: { value: accentV.clone() },
        uBand: { value: railV.clone() },
        uLight: { value: lightDir.clone() },
      },
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vWN; varying vec3 vWpos;
        void main(){
          vWN = normalize(mat3(modelMatrix)*normal);
          vec4 wp = modelMatrix*vec4(position,1.0);
          vWpos = wp.xyz;
          gl_Position = projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: `
        precision highp float;
        varying vec3 vWN; varying vec3 vWpos;
        uniform vec3 uDay,uNight,uRim,uBand,uLight;
        void main(){
          vec3 Nn = normalize(vWN);
          vec3 V = normalize(cameraPosition - vWpos);
          float diff = dot(Nn, normalize(uLight));
          float term = smoothstep(-0.05, 0.35, diff);
          vec3 col = mix(uNight, uDay, term);
          float band = 0.5+0.5*sin(Nn.y*16.0 + 1.7);
          col = mix(col, col*vec3(1.15,0.95,1.25), band*0.35*term);
          col += uBand * 0.05 * term;
          float fres = pow(1.0-max(dot(Nn,V),0.0), 2.4);
          col += uRim * fres * 1.15 * (0.35+0.65*term);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(pr, 48, 32), bodyMat);
    body.renderOrder = -15;
    body.frustumCulled = false;
    planet.add(body);

    // atmosphere halo (larger backside additive rim)
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: accentV.clone() }, uCol2: { value: railV.clone() } },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec3 vWN; varying vec3 vWpos;
        void main(){
          vWN = normalize(mat3(modelMatrix)*normal);
          vec4 wp = modelMatrix*vec4(position,1.0);
          vWpos = wp.xyz;
          gl_Position = projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: `
        precision highp float;
        varying vec3 vWN; varying vec3 vWpos;
        uniform vec3 uCol,uCol2;
        void main(){
          vec3 Nn = normalize(vWN);
          vec3 V = normalize(cameraPosition - vWpos);
          float rim = pow(1.0-max(dot(-Nn,V),0.0), 3.0);
          vec3 c = mix(uCol, uCol2, clamp(Nn.y*0.5+0.5,0.0,1.0));
          gl_FragColor = vec4(c*rim, rim*0.9);
        }`,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(pr * 1.16, 40, 24), haloMat);
    halo.renderOrder = -16;
    halo.frustumCulled = false;
    planet.add(halo);

    // thin planetary ring (silhouette signature). RingGeometry UVs are planar, so
    // derive the true inner->outer radial fraction from the local vertex radius.
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uCol: { value: railV.clone() },
        uCol2: { value: accentV.clone() },
        uInner: { value: pr * 1.4 },
        uOuter: { value: pr * 2.15 },
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying float vR;
        uniform float uInner, uOuter;
        void main(){
          vR = clamp((length(position.xy) - uInner) / max(uOuter - uInner, 0.001), 0.0, 1.0);
          gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        }`,
      fragmentShader: `
        precision highp float;
        varying float vR;
        uniform vec3 uCol,uCol2;
        void main(){
          float edge = smoothstep(0.0,0.12,vR)*smoothstep(1.0,0.72,vR);
          float gap = 0.6+0.4*sin(vR*46.0); // ringlet striations
          float a = edge*gap*0.5;
          vec3 c = mix(uCol,uCol2,vR);
          gl_FragColor = vec4(c*a, a);
        }`,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(pr * 1.4, pr * 2.15, 96, 1), ringMat);
    ring.rotation.x = -Math.PI / 2 + 0.42;
    ring.rotation.z = 0.3;
    ring.renderOrder = -15;
    ring.frustumCulled = false;
    planet.add(ring);

    group.add(planet);
  }

  // --------------------------------------------------------------- AURORA BAND
  {
    const uni = {
      uCol1: { value: railV.clone() },
      uCol2: { value: accentV.clone() },
      uTime: { value: 0 },
    };
    timeUniforms.push(uni.uTime);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uCol1,uCol2; uniform float uTime;
        ${NOISE_GLSL}
        void main(){
          // vertical curtains that shimmer sideways
          float x = vUv.x;
          float curt = sin(x*70.0 + sin(vUv.y*4.0 + uTime*0.25)*2.2 + uTime*0.12);
          curt = smoothstep(0.35, 1.0, curt);
          float fine = fbm(vec3(x*22.0, vUv.y*4.0, uTime*0.05));
          curt *= 0.6 + 0.6*fine;
          float vFade = smoothstep(0.42, 0.72, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
          vec3 col = mix(uCol1, uCol2, vUv.y + 0.15*sin(x*18.0));
          float a = curt * vFade * 0.5;
          gl_FragColor = vec4(col*a, a);
        }`,
    });
    const cyl = new THREE.CylinderGeometry(R * 3.1, R * 3.1, R * 2.3, 96, 1, true);
    const aurora = new THREE.Mesh(cyl, mat);
    aurora.position.y = R * 0.4;
    aurora.renderOrder = -14;
    aurora.frustumCulled = false;
    group.add(aurora);
  }

  // ------------------------------------------------------------ ENERGY-GRID FLOOR
  {
    const floorY = -60;
    const rad = R * 2.85;
    const uni = {
      uBase: { value: sRGB(0x0a0618) },
      uGrid: { value: railV.clone() },
      uGlow: { value: accentV.clone() },
      uSky: { value: sRGB(def.skyBot) },
      uRadius: { value: rad },
      uTime: { value: 0 },
    };
    timeUniforms.push(uni.uTime);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: `
        varying vec3 vWpos;
        void main(){
          vec4 wp = modelMatrix*vec4(position,1.0);
          vWpos = wp.xyz;
          gl_Position = projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: `
        precision highp float;
        varying vec3 vWpos;
        uniform vec3 uBase,uGrid,uGlow,uSky; uniform float uTime,uRadius;
        void main(){
          vec2 p = vWpos.xz;
          float dist = length(p);
          float r = dist/uRadius;
          // concentric rings
          float ring = abs(fract(dist/78.0 - uTime*0.02) - 0.5);
          float rings = smoothstep(0.055, 0.0, ring);
          // radial spokes
          float a = atan(p.y, p.x);
          float spokes = smoothstep(0.92, 1.0, abs(sin(a*20.0)));
          // fine square grid
          vec2 g = abs(fract(p/104.0) - 0.5);
          float grid = smoothstep(0.028, 0.0, min(g.x,g.y));
          float lines = max(max(rings, spokes*0.5), grid*0.45);
          // energy pulse traveling outward
          float pulse = smoothstep(0.5, 0.0, abs(fract(r*3.0 - uTime*0.12) - 0.5));
          // fake reflective sheen: grazing view brightens (fresnel), + sky tint
          vec3 V = normalize(cameraPosition - vWpos);
          float fres = pow(1.0 - clamp(abs(V.y),0.0,1.0), 3.0);
          vec3 col = uBase + uSky*fres*0.35 + uGrid*lines + uGlow*pulse*0.4;
          float edge = smoothstep(1.0, 0.5, r);
          float hole = smoothstep(0.015, 0.05, r);
          float alpha = clamp((0.08 + lines*0.85 + pulse*0.45 + fres*0.15) * edge * hole, 0.0, 0.92);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(rad, 120), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.renderOrder = -4;
    floor.frustumCulled = false;
    group.add(floor);
  }

  // ---------------------------------------------------------- SATELLITE geometry
  const satStructGeo = mergeGeos([
    new THREE.BoxGeometry(14, 10, 20),
    translated(new THREE.BoxGeometry(12, 9, 7), 0, 0, -13),
    translated(new THREE.BoxGeometry(2, 2, 8), 0, 0, 15),
    translated(rotatedX(new THREE.CylinderGeometry(6, 6, 1.6, 16), Math.PI / 2), 0, 3, 22),
    translated(new THREE.BoxGeometry(1, 1, 22), 0, 0, 24),
  ]);
  const satPanelGeo = mergeGeos([
    new THREE.BoxGeometry(66, 1.6, 2),
    translated(new THREE.BoxGeometry(26, 0.8, 15), -24, 0, 0),
    translated(new THREE.BoxGeometry(26, 0.8, 15), 24, 0, 0),
  ]);
  const satStructMat = new THREE.MeshStandardMaterial({
    color: 0x1a1524, metalness: 0.7, roughness: 0.42, emissive: RAIL, emissiveIntensity: 0.3, fog: false,
  });
  const satPanelMat = new THREE.MeshStandardMaterial({
    color: 0x0a1230, metalness: 0.25, roughness: 0.5, emissive: 0x3a6bff, emissiveIntensity: 0.6, fog: false,
  });

  // Two tilted orbital shells; each is tilt(fixed) -> spin(animated) so satellites
  // sweep across the sky. structure + glowing panels share the same per-instance
  // matrix so they stay assembled.
  const dummy = new THREE.Object3D();
  const shellDefs = [
    { count: 26, rMin: 1.15, rMax: 1.9, yMin: 40, yMax: 320, tiltX: 0.35, tiltZ: -0.2, rate: 0.028 },
    { count: 24, rMin: 1.7, rMax: 2.6, yMin: 120, yMax: 520, tiltX: -0.28, tiltZ: 0.33, rate: -0.018 },
  ];
  for (const sd of shellDefs) {
    const tilt = new THREE.Group();
    tilt.rotation.set(sd.tiltX, 0, sd.tiltZ);
    const spin = new THREE.Group();
    tilt.add(spin);
    group.add(tilt);
    spinners.push({ obj: spin, rate: sd.rate });

    const struct = new THREE.InstancedMesh(satStructGeo, satStructMat, sd.count);
    const panels = new THREE.InstancedMesh(satPanelGeo, satPanelMat, sd.count);
    struct.frustumCulled = false;
    panels.frustumCulled = false;
    for (let i = 0; i < sd.count; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = R * (sd.rMin + rnd() * (sd.rMax - sd.rMin));
      const y = sd.yMin + rnd() * (sd.yMax - sd.yMin);
      const s = 0.8 + rnd() * 1.4;
      dummy.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      dummy.rotation.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      struct.setMatrixAt(i, dummy.matrix);
      panels.setMatrixAt(i, dummy.matrix);
    }
    struct.instanceMatrix.needsUpdate = true;
    panels.instanceMatrix.needsUpdate = true;
    spin.add(struct);
    spin.add(panels);
  }

  // ---------------------------------------------------------------- DEBRIS field
  {
    const count = 150;
    const geo = new THREE.IcosahedronGeometry(3, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x15111c, metalness: 0.62, roughness: 0.6, emissive: ACCENT, emissiveIntensity: 0.16, fog: false,
    });
    const spin = new THREE.Group();
    group.add(spin);
    spinners.push({ obj: spin, rate: 0.006 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = R * (1.2 + rnd() * 1.5);
      const y = -20 + rnd() * 520;
      dummy.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      dummy.rotation.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
      dummy.scale.set(0.6 + rnd() * 2.6, 0.6 + rnd() * 1.6, 0.6 + rnd() * 2.6);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    spin.add(inst);
  }

  // Far-field backdrop (ring stations + antenna pylons) drifts almost imperceptibly.
  const farField = new THREE.Group();
  group.add(farField);
  spinners.push({ obj: farField, rate: 0.0016 });

  // -------------------------------------------------------------- RING STATIONS
  {
    const count = 9;
    const ringGeo = mergeGeos([
      new THREE.TorusGeometry(1.0, 0.05, 8, 40),
      new THREE.TorusGeometry(0.72, 0.03, 6, 32),
    ]);
    const mat = new THREE.MeshBasicMaterial({
      color: RAIL, transparent: true, opacity: 0.55, toneMapped: false, fog: false, depthWrite: false,
    });
    const inst = new THREE.InstancedMesh(ringGeo, mat, count);
    inst.frustumCulled = false;
    inst.renderOrder = -2;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = R * (1.3 + rnd() * 0.9);
      const y = 60 + rnd() * 380;
      const sc = 30 + rnd() * 70;
      dummy.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      dummy.rotation.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    farField.add(inst);
  }

  // ------------------------------------------------ BROKEN ANTENNA PYLONS + beacons
  {
    const count = 30;
    const floorY = -60;
    const pylonGeo = new THREE.CylinderGeometry(0.6, 2.6, 1, 8); // unit height, tapered
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x0b0714, metalness: 0.65, roughness: 0.4, emissive: RAIL, emissiveIntensity: 0.2, fog: false,
    });
    const beaconGeo = new THREE.OctahedronGeometry(2.4, 0);
    const beaconMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, fog: false });
    const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, count);
    const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, count);
    pylons.frustumCulled = false;
    beacons.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = R * (1.5 + rnd() * 1.2);
      const h = 90 + rnd() * 190;
      const w = 1.4 + rnd() * 2.6;
      const cx = Math.cos(a) * rr;
      const cz = Math.sin(a) * rr;
      // cylinder is centered — lift by h/2 so its base sits on the floor
      dummy.position.set(cx, floorY + h * 0.5, cz);
      dummy.rotation.set((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.12);
      dummy.scale.set(w, h, w);
      dummy.updateMatrix();
      pylons.setMatrixAt(i, dummy.matrix);
      // beacon at the tip
      dummy.position.set(cx, floorY + h + 3, cz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1 + rnd() * 0.8);
      dummy.updateMatrix();
      beacons.setMatrixAt(i, dummy.matrix);
    }
    pylons.instanceMatrix.needsUpdate = true;
    beacons.instanceMatrix.needsUpdate = true;
    beacons.renderOrder = -1;
    farField.add(pylons);
    farField.add(beacons);
  }

  // ----------------------------------------------------------- NEAR-FIELD MOTES
  {
    const count = 300;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const palette = [0xffffff, RAIL, ACCENT, 0xbfe0ff];
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s = samples[(rnd() * N) | 0];
      tmp.copy(s.pos)
        .addScaledVector(s.side, (rnd() * 2 - 1) * HALF * 2.4)
        .addScaledVector(s.tangent, (rnd() * 2 - 1) * 18);
      tmp.y += 3 + rnd() * 46;
      pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z;
      const c = sRGB(palette[(rnd() * palette.length) | 0]);
      col[i * 3] = c.x; col[i * 3 + 1] = c.y; col[i * 3 + 2] = c.z;
      size[i] = 1.5 + rnd() * 3.5;
      phase[i] = rnd() * 6.283;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const uni = { uPR: { value: PR }, uTime: { value: 0 } };
    timeUniforms.push(uni.uTime);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uPR, uTime;
        attribute float aSize; attribute vec3 aColor; attribute float aPhase;
        varying vec3 vColor; varying float vA;
        void main(){
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime*0.6 + aPhase)*4.5;
          p.y += sin(uTime*0.8 + aPhase*1.7)*7.0;
          p.z += cos(uTime*0.5 + aPhase*1.3)*4.5;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          gl_Position = projectionMatrix*mv;
          gl_PointSize = aSize*uPR*(300.0/max(-mv.z,1.0));
          vA = 0.4 + 0.6*sin(uTime*2.2 + aPhase);
        }`,
      fragmentShader: `
        precision highp float;
        varying vec3 vColor; varying float vA;
        void main(){
          vec2 c = gl_PointCoord-0.5; float d = length(c);
          float a = smoothstep(0.5,0.0,d)*max(vA,0.0);
          gl_FragColor = vec4(vColor*a, a);
        }`,
    });
    const motes = new THREE.Points(geo, mat);
    motes.renderOrder = 3;
    motes.frustumCulled = false;
    group.add(motes);
  }

  // ------------------------------------------------------------------- helpers
  function translated(geo, x, y, z) { geo.translate(x, y, z); return geo; }
  function rotatedX(geo, r) { geo.rotateX(r); return geo; }
  // Merge position+normal of several geometries into one non-indexed BufferGeometry
  // (import map exposes only "three", so no BufferGeometryUtils). Sources disposed.
  function mergeGeos(geos) {
    const parts = geos.map((g) => {
      if (!g.attributes.normal) g.computeVertexNormals();
      const ng = g.index ? g.toNonIndexed() : g;
      if (ng !== g) g.dispose();
      return ng;
    });
    let total = 0;
    for (const g of parts) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o);
      nor.set(g.attributes.normal.array, o);
      o += g.attributes.position.array.length;
      g.dispose();
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return m;
  }

  // ------------------------------------------------- self-driven, guarded anim loop
  // No scenery update hook exists in the interface, so drive uniforms + orbital spins
  // here. The loop stops the instant the group leaves the scene graph (game disposal),
  // so nothing keeps ticking after the race ends.
  let everAttached = false;
  const attachedToScene = (o) => {
    let p = o;
    while (p) { if (p.isScene) return true; p = p.parent; }
    return false;
  };
  let last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const tick = (now) => {
    const t = now == null ? last : now;
    if (attachedToScene(group)) everAttached = true;
    else if (everAttached) return; // detached after being live → stop for good
    const dt = Math.min(Math.max((t - last) / 1000, 0), 0.05);
    last = t;
    const sec = t * 0.001;
    for (const u of timeUniforms) u.value = sec;
    for (const s of spinners) s.obj.rotation.y += s.rate * dt;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

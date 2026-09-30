// HIT PARADE - STAGES lab (lane STAGES, dev only; never linked from index.html so never in the build).
// Loads a stage exactly as data/stages.json describes it (GLB + fixed light pool + fog + IBL + crowd cards from the
// GLB's crowd_* empties and the crowd atlas) and renders ONE frame from a proof camera, so the stage can be checked in
// three.js itself: draw calls / triangles / bytes are measured here, not estimated.
//   /lab/stages.html?stage=rust_theater&shot=near_center[&fighter=johnny][&post=1]
// post=1 POSTs the canvas to /__shot/stages_<stage>_<shot> (vite harness endpoint -> _shots/*.png) and the numbers to
// /__report/stages_lab_<stage>_<shot>. Rendering is on demand (no rAF) so a hidden browser pane still produces pixels.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import stagesJson from '../../../data/stages.json' with { type: 'json' };

interface LightDef {
  id: string; type: 'directional' | 'hemisphere' | 'point' | 'spot'; color?: string; sky?: string; ground?: string;
  intensity: number; position?: number[]; target?: number[]; castShadow?: boolean; distance?: number; decay?: number;
  angleDeg?: number; penumbra?: number;
  shadow?: { mapSize: number; bias: number; normalBias: number; camera: { left: number; right: number; top: number; bottom: number; near: number; far: number } };
}
interface Shot { id: string; pos: number[]; look: number[]; aspect?: number }
interface StageDef {
  id: string; glb?: string; exposure?: number; fog?: { color: string; near: number; far: number };
  environment?: { hdr: string; intensity: number; backgroundColor?: string };
  lights?: LightDef[]; camera?: { vFovDeg: number; proofShots: Shot[] };
  crowd?: { atlas: string; meta: string; tint: string; brightness: number; cardHeightM: number; cardWidthM: number; anchor: number[] };
  spawn?: { p1: number[]; p2: number[] };
}
interface AtlasCell { body: string; pose: string; angle: string; uv: [number, number, number, number] }
interface AtlasMeta { cells: AtlasCell[]; bodies: Record<string, string> }

const hud = document.getElementById('hud') as HTMLDivElement;
const errBox = document.getElementById('err') as HTMLDivElement;
const q = new URLSearchParams(location.search);
const stageId = q.get('stage') ?? 'rust_theater';
const shotId = q.get('shot') ?? 'near_center';
const fighterId = q.get('fighter');
const post = q.get('post') === '1';

function fail(e: unknown): void {
  errBox.style.display = 'block';
  errBox.textContent = 'STAGES lab error: ' + (e instanceof Error ? e.stack ?? e.message : String(e));
  (window as unknown as Record<string, unknown>).__STAGES_LAB__ = { ok: false, error: String(e) };
}

const stageUrl = (file: string): string => new URL(`../../../art/gltf/stages/${file}`, import.meta.url).href;

async function main(): Promise<void> {
  const all = (stagesJson as unknown as { stages: StageDef[] }).stages;
  const S = all.find((s) => s.id === stageId);
  if (!S) throw new Error('no stage ' + stageId + ' in data/stages.json');
  const shots = S.camera?.proofShots ?? [];
  const shot = shots.find((s) => s.id === shotId) ?? shots[0];
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const aspect = shot.aspect ?? 16 / 9;
  const H = 720;
  const W = Math.round(H * aspect);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = S.exposure ?? 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(S.environment?.backgroundColor ?? '#000000');
  if (S.fog) scene.fog = new THREE.Fog(new THREE.Color(S.fog.color), S.fog.near, S.fog.far);

  const t0 = performance.now();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const glbUrl = stageUrl(S.glb ?? `${S.id}.glb`);
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB ${glbUrl}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const gltf = await loader.parseAsync(buf, glbUrl.slice(0, glbUrl.lastIndexOf('/') + 1));
  scene.add(gltf.scene);
  const crowdNodes: THREE.Object3D[] = [];
  let lightsInGlb = 0;
  gltf.scene.traverse((o) => {
    if (/^crowd_/i.test(o.name) && !(o as THREE.Mesh).isMesh) crowdNodes.push(o);
    if ((o as THREE.Light).isLight) lightsInGlb++;
    if ((o as THREE.Mesh).isMesh) { o.receiveShadow = true; o.castShadow = false; }
  });
  gltf.scene.updateMatrixWorld(true);

  // environment (IBL only, not the background)
  let envBytes = 0;
  if (S.environment?.hdr) {
    const hdrUrl = stageUrl(S.environment.hdr);
    const hr = await fetch(hdrUrl);
    envBytes = Number(hr.headers.get('content-length') ?? 0);
    const tex = new HDRLoader().parse(await hr.arrayBuffer()) as unknown as { data: Uint16Array | Float32Array; width: number; height: number; type: THREE.TextureDataType };
    const dt = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat, tex.type);
    dt.mapping = THREE.EquirectangularReflectionMapping;
    dt.colorSpace = THREE.LinearSRGBColorSpace;
    dt.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromEquirectangular(dt).texture;
    scene.environmentIntensity = S.environment.intensity;
    dt.dispose();
    pm.dispose();
  }

  // the FIXED light pool
  for (const L of S.lights ?? []) {
    let light: THREE.Light;
    if (L.type === 'directional') {
      const d = new THREE.DirectionalLight(new THREE.Color(L.color), L.intensity);
      d.position.fromArray(L.position ?? [0, 10, 0]);
      d.target.position.fromArray(L.target ?? [0, 0, 0]);
      scene.add(d.target);
      if (L.castShadow && L.shadow) {
        d.castShadow = true;
        d.shadow.mapSize.set(L.shadow.mapSize, L.shadow.mapSize);
        d.shadow.bias = L.shadow.bias;
        d.shadow.normalBias = L.shadow.normalBias;
        Object.assign(d.shadow.camera, L.shadow.camera);
        d.shadow.camera.updateProjectionMatrix();
      }
      light = d;
    } else if (L.type === 'hemisphere') {
      light = new THREE.HemisphereLight(new THREE.Color(L.sky), new THREE.Color(L.ground), L.intensity);
    } else if (L.type === 'point') {
      const p = new THREE.PointLight(new THREE.Color(L.color), L.intensity, L.distance ?? 0, L.decay ?? 2);
      p.position.fromArray(L.position ?? [0, 0, 0]);
      light = p;
    } else {
      const s = new THREE.SpotLight(new THREE.Color(L.color), L.intensity, L.distance ?? 0,
        THREE.MathUtils.degToRad(L.angleDeg ?? 30), L.penumbra ?? 0, L.decay ?? 2);
      s.position.fromArray(L.position ?? [0, 0, 0]);
      s.target.position.fromArray(L.target ?? [0, 0, 0]);
      scene.add(s.target);
      light = s;
    }
    light.name = 'light_' + L.id;
    scene.add(light);
  }

  // crowd: one InstancedMesh of cards, cell picked per node (unlit, alpha-tested)
  let crowdCards = 0;
  if (S.crowd && crowdNodes.length) {
    const meta = (await (await fetch(stageUrl(S.crowd.meta))).json()) as AtlasMeta;
    const atlas = await new THREE.TextureLoader().loadAsync(stageUrl(S.crowd.atlas));
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    const cw = S.crowd.cardWidthM;
    const ch = S.crowd.cardHeightM;
    const ay = S.crowd.anchor[1];
    const geo = new THREE.PlaneGeometry(cw, ch);
    geo.translate(0, ch / 2 - (1 - ay) * ch, 0);
    const cellAttr = new Float32Array(crowdNodes.length * 4);
    const cells = new Map(meta.cells.map((c) => [`${c.body}|${c.pose}|${c.angle}`, c]));
    const bodies = Object.keys(meta.bodies);
    const poses = ['cheer', 'cheer', 'hype', 'jeer', 'watch', 'cheer', 'hype', 'jeer'];
    const mat = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, toneMapped: false, fog: true,
      color: new THREE.Color(S.crowd.tint).multiplyScalar(S.crowd.brightness) });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = mix(aCell.xy, aCell.zw, uv);');
    };
    const im = new THREE.InstancedMesh(geo, mat, crowdNodes.length);
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    crowdNodes.forEach((n, i) => {
      n.matrixWorld.decompose(pos, quat, scl);
      m4.compose(pos, quat, new THREE.Vector3(1, 1, 1));   // node scale = card height; the geometry is already in metres
      im.setMatrixAt(i, m4);
      const r = Number((n.userData as { rand?: number }).rand ?? 0.5);
      const ang = String((n.userData as { angle?: string }).angle ?? 'front');
      const body = bodies[Math.floor(r * 997) % bodies.length];
      const pose = poses[Math.floor(r * 7919) % poses.length];
      const c = cells.get(`${body}|${pose}|${ang}`) ?? meta.cells[0];
      const mirror = ang === 'front' && Math.floor(r * 104729) % 2 === 1;
      const [u0, v0, u1, v1] = c.uv;
      cellAttr.set(mirror ? [u1, v0, u0, v1] : [u0, v0, u1, v1], i * 4);
    });
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cellAttr, 4));
    im.name = 'crowd_cards';
    scene.add(im);
    crowdCards = crowdNodes.length;
  }

  // optional real fighter GLB for scale (ASSETS lane output), idle pose at the spawn points
  let fighterNote = 'none';
  if (fighterId) {
    try {
      const fr = await loader.loadAsync(new URL(`../../../art/gltf/fighters/${fighterId}.glb`, import.meta.url).href);
      const idle = fr.animations.find((a) => a.name === 'idle') ?? fr.animations[0];
      for (const [i, p] of [S.spawn?.p1 ?? [-1.2, 0, 0], S.spawn?.p2 ?? [1.2, 0, 0]].entries()) {
        const o = i === 0 ? fr.scene : (await import('three/addons/utils/SkeletonUtils.js')).clone(fr.scene);
        o.position.fromArray(p);
        o.rotation.y = i === 0 ? Math.PI / 2 : -Math.PI / 2;
        o.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; x.frustumCulled = false; } });
        scene.add(o);
        if (idle) {
          const mx = new THREE.AnimationMixer(o);
          mx.clipAction(idle).play();
          mx.setTime(0.5);
        }
      }
      fighterNote = `${fighterId} (${fr.animations.length} clips)`;
    } catch (e) {
      fighterNote = 'load failed: ' + String(e);
    }
  }

  const cam = new THREE.PerspectiveCamera(S.camera?.vFovDeg ?? 35, aspect, 0.1, 200);
  cam.position.fromArray(shot.pos);
  cam.lookAt(new THREE.Vector3().fromArray(shot.look));
  renderer.info.reset();
  renderer.render(scene, cam);
  const ms = performance.now() - t0;
  const info = {
    ok: true, stage: S.id, shot: shot.id, size: [W, H], glbBytes: buf.byteLength, envBytes,
    calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries, crowdNodes: crowdNodes.length, crowdCards, lightsInGlb,
    fighter: fighterNote, loadAndFirstFrameMs: Math.round(ms),
  };
  hud.textContent = Object.entries(info).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('x') : v}`).join('\n');
  (window as unknown as Record<string, unknown>).__STAGES_LAB__ = info;
  if (post) {
    const name = `stages_${S.id}_${shot.id}`;
    await fetch(`/__shot/${name}`, { method: 'POST', body: canvas.toDataURL('image/png') });
    await fetch(`/__report/stages_lab_${S.id}_${shot.id}`, { method: 'POST', body: JSON.stringify(info) });
  }
}

main().catch(fail);

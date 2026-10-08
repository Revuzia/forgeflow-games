// GENESIS — tree lookdev page (dev tool): every procedural tree kind × LOD from render/gen/treegen.ts on a lawn under
// a sun, so tree shapes can be judged without booting a world. Open /_harness/treeview.html?lod=0&kinds=broadleaf,...
// window.__TREES_READY__ is set after the first frames (for headless screenshots).

import {
  AmbientLight, Color, DirectionalLight, DoubleSide, HemisphereLight, Mesh, MeshStandardMaterial, PCFSoftShadowMap,
  PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer, ACESFilmicToneMapping,
} from 'three';
import { TREE_KINDS, treeGeometry, type TreeKind } from '../src/render/gen/treegen.ts';
import { leafClusterTexture } from '../src/render/gen/leaftex.ts';

const q = new URLSearchParams(location.search);
const kinds = (q.get('kinds')?.split(',') ?? TREE_KINDS) as TreeKind[];
const lods = (q.get('lods') ?? '0,1,2').split(',').map(Number);
const variants = Number(q.get('variants') ?? 1);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new WebGLRenderer({ canvas, antialias: true });
r.setSize(innerWidth, innerHeight);
r.outputColorSpace = SRGBColorSpace;
r.toneMapping = ACESFilmicToneMapping;
r.shadowMap.enabled = true;
r.shadowMap.type = PCFSoftShadowMap;
const scene = new Scene();
scene.background = new Color(0x9ec0e0);
const cam = new PerspectiveCamera(32, innerWidth / innerHeight, 0.5, 2000);
const tex = leafClusterTexture();
const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide });
mat.onBeforeCompile = (sh) => {
  sh.uniforms.uLeaf = { value: tex };
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aLeafUv; attribute float aCard; varying vec2 vLUv; varying float vCard;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLUv = aLeafUv; vCard = aCard;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uLeaf; varying vec2 vLUv; varying float vCard;')
    .replace('#include <color_fragment>', '#include <color_fragment>\nif (vCard > 0.75) { vec4 t = texture2D(uLeaf, vLUv); if (t.a < 0.45) discard; diffuseColor.rgb *= t.rgb * 1.7; }');
};
const depthMat = mat.clone();
const ground = new Mesh(new PlaneGeometry(800, 800), new MeshStandardMaterial({ color: 0x3d5228, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const H = 16;
let x = 0;
const cols: number[] = [];
// one group per kind and variant, its LODs side by side (LOD0 on the left)
const gap = Number(q.get('gap') ?? 13);
for (const k of kinds) {
  for (let v = 0; v < variants; v++) {
    for (const l of lods) {
      const m = new Mesh(treeGeometry(k, l, v), mat);
      m.scale.setScalar(k === 'shrub' ? 3 : H);
      m.position.set(x, 0, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      m.customDepthMaterial = depthMat;
      scene.add(m);
      cols.push(x);
      x += gap;
    }
    x += gap * 0.4;
  }
}
const sun = new DirectionalLight(0xfff1dc, 3.2);
sun.position.set(-40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 80, bottom: -80, near: 1, far: 300 });
sun.target.position.set(x / 2, 0, 0);
scene.add(sun, sun.target, new HemisphereLight(0xbfd8ff, 0x3a3020, 0.9), new AmbientLight(0xffffff, 0.15));
const cx = (cols[0] + cols[cols.length - 1]) / 2;
const dist = Number(q.get('dist') ?? Math.max(40, x * 1.25));
cam.position.set(cx, Number(q.get('camY') ?? 9), dist);
cam.lookAt(cx, Number(q.get('lookY') ?? 8), 0);
let frames = 0;
const loop = () => { r.render(scene, cam); if (++frames === 3) (window as unknown as { __TREES_READY__: boolean }).__TREES_READY__ = true; requestAnimationFrame(loop); };
loop();

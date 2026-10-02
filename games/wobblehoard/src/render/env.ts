// Procedural studio environment: a handful of emissive softbox panels in a dark indigo room, baked once with
// PMREMGenerator.fromScene so the glossy jelly, the eyes and the felt pick up soft rectangular highlights like a toy
// photographed in a studio. No textures, no HDRIs: the panels are tiny shaders with HDR output (values > 1).
import * as THREE from 'three';

/** World-space directions TOWARD the lights (unit vectors). The camera starts at +Z looking at the origin. */
export const KEY_DIR = new THREE.Vector3(-0.52, 0.74, 0.58).normalize();      // sodium amber softbox, front-left-up
export const RIM_DIR = new THREE.Vector3(0.6, 0.42, -0.74).normalize();       // cold lagoon strip, behind-right
export const FILL_DIR = new THREE.Vector3(0.78, 0.18, 0.6).normalize();       // dim violet fill, front-right

export interface Environment {
  texture: THREE.Texture;
  dispose(): void;
}

const PANEL_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const PANEL_FRAG = /* glsl */`
varying vec2 vUv;
uniform vec3 uColor;
uniform vec2 uSize;
uniform float uSoft;
uniform float uRadius;
void main() {
  vec2 q = abs(vUv - 0.5) * uSize - (uSize * 0.5 - uRadius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = smoothstep(0.0, -uSoft, d);
  float core = 0.7 + 0.3 * smoothstep(-uSoft * 3.0, -uSoft * 0.2, d);
  gl_FragColor = vec4(uColor * a * core, 1.0);
}
`;
const ROOM_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const ROOM_FRAG = /* glsl */`
varying vec3 vDir;
void main() {
  float e = vDir.y;
  vec3 floorC = vec3(0.012, 0.008, 0.03);
  vec3 hor = vec3(0.07, 0.035, 0.12);
  vec3 top = vec3(0.03, 0.02, 0.07);
  vec3 c = e < 0.0 ? mix(hor, floorC, smoothstep(0.0, -0.5, e)) : mix(hor, top, smoothstep(0.0, 0.8, e));
  // faint warm wash behind the key side, faint cool wash on the rim side
  c += vec3(0.16, 0.08, 0.03) * pow(max(dot(vDir, normalize(vec3(-0.5, 0.35, 0.8))), 0.0), 6.0);
  c += vec3(0.02, 0.09, 0.11) * pow(max(dot(vDir, normalize(vec3(0.6, 0.2, -0.75))), 0.0), 5.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

interface PanelDef { dir: THREE.Vector3; dist: number; w: number; h: number; color: [number, number, number]; k: number; soft: number; radius: number; roll?: number }

const PANELS: PanelDef[] = [
  // key: big amber-white softbox, front-left-up
  { dir: KEY_DIR, dist: 4.5, w: 3.0, h: 2.2, color: [1.0, 0.74, 0.42], k: 10, soft: 0.22, radius: 0.25, roll: 0.25 },
  // overhead long strip: gives the long highlight across the dome
  { dir: new THREE.Vector3(0.12, 1, 0.2).normalize(), dist: 4.5, w: 4.2, h: 0.7, color: [1.0, 0.86, 0.66], k: 5.5, soft: 0.2, radius: 0.3 },
  // rim: tall cold lagoon strip, behind-right
  { dir: RIM_DIR, dist: 4.5, w: 0.8, h: 3.6, color: [0.28, 0.82, 0.95], k: 12, soft: 0.16, radius: 0.35, roll: -0.18 },
  // fill: dim violet card, front-right
  { dir: FILL_DIR, dist: 4.5, w: 2.4, h: 2.4, color: [0.5, 0.36, 0.92], k: 1.6, soft: 0.5, radius: 0.6 },
  // small low kicker, cool, behind-left: a little pinprick of reflection low on the body
  { dir: new THREE.Vector3(-0.8, -0.05, -0.55).normalize(), dist: 4.5, w: 1.6, h: 0.5, color: [0.3, 0.7, 0.9], k: 2.2, soft: 0.2, radius: 0.2 },
];

export function createEnvironment(renderer: THREE.WebGLRenderer, size = 256): Environment {
  const scene = new THREE.Scene();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.ShaderMaterial[] = [];

  const roomGeo = new THREE.SphereGeometry(30, 24, 16);
  const roomMat = new THREE.ShaderMaterial({ vertexShader: ROOM_VERT, fragmentShader: ROOM_FRAG, side: THREE.BackSide, depthWrite: false, toneMapped: false });
  geos.push(roomGeo); mats.push(roomMat);
  scene.add(new THREE.Mesh(roomGeo, roomMat));

  const up = new THREE.Vector3(0, 1, 0);
  for (const p of PANELS) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PANEL_VERT, fragmentShader: PANEL_FRAG, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Vector3(p.color[0] * p.k, p.color[1] * p.k, p.color[2] * p.k) },
        uSize: { value: new THREE.Vector2(p.w, p.h) },
        uSoft: { value: p.soft },
        uRadius: { value: p.radius },
      },
    });
    geos.push(geo); mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(p.w, p.h, 1);
    m.position.copy(p.dir).multiplyScalar(p.dist);
    m.up.copy(Math.abs(p.dir.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : up);
    m.lookAt(0, 0, 0);
    if (p.roll) m.rotateZ(p.roll);
    scene.add(m);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.035, 0.1, 100, { size });
  pmrem.dispose();
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  return { texture: rt.texture, dispose: () => rt.dispose() };
}

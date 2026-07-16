import * as THREE from 'three';
import type { MapId } from '../core/types';
import { MAPS } from '../core/config';

export interface PortalDef {
  id: string;
  label: string;
  target: MapId;
  position: THREE.Vector3;
  color: number;
  radius: number;
}

/** Glowing ring gates that teleport the pilot to another biome. */
export class PortalSystem {
  group = new THREE.Group();
  portals: PortalDef[] = [];
  private rings: THREE.Mesh[] = [];
  private labels: THREE.Sprite[] = [];
  private spin = 0;

  buildForMap(current: MapId, bounds: number) {
    this.clear();
    const targets = this.pickTargets(current);
    const n = targets.length;
    if (n === 0) return;

    const ringGeo = new THREE.TorusGeometry(10, 0.55, 10, 40);
    const innerGeo = new THREE.CircleGeometry(9, 32);
    const pillarGeo = new THREE.CylinderGeometry(0.35, 0.5, 18, 6);

    for (let i = 0; i < n; i++) {
      const t = targets[i];
      const def = MAPS[t];
      const a = (i / n) * Math.PI * 2 + 0.4;
      const r = bounds * 0.38 + (i % 2) * bounds * 0.08;
      const y = 28 + (i % 3) * 12;
      const pos = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const color = portalColor(t);

      const portal: PortalDef = {
        id: `portal-${t}`,
        label: def?.name ?? t,
        target: t,
        position: pos,
        color,
        radius: 11,
      };
      this.portals.push(portal);

      const root = new THREE.Group();
      root.position.copy(pos);
      // Face toward origin so pilots see the ring opening
      root.lookAt(0, y, 0);

      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
      this.rings.push(ring);

      const swirl = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.35,
          toneMapped: false,
        })
      );
      swirl.rotation.x = Math.PI / 2;
      swirl.scale.setScalar(0.88);
      root.add(swirl);
      this.rings.push(swirl);

      const gate = new THREE.Mesh(
        innerGeo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          toneMapped: false,
          depthWrite: false,
        })
      );
      gate.rotation.x = Math.PI / 2;
      root.add(gate);

      // Side pillars
      const pMat = new THREE.MeshStandardMaterial({
        color: 0x1a1030,
        emissive: color,
        emissiveIntensity: 0.55,
        metalness: 0.4,
        roughness: 0.5,
      });
      for (const sx of [-11, 11]) {
        const pillar = new THREE.Mesh(pillarGeo, pMat);
        pillar.position.set(sx, 0, 0);
        root.add(pillar);
      }

      // Label sprite
      const sprite = makeLabelSprite(portal.label, color);
      sprite.position.set(0, 14, 0);
      root.add(sprite);
      this.labels.push(sprite);

      // Soft point light
      const light = new THREE.PointLight(color, 1.4, 60, 2);
      light.position.set(0, 0, 0);
      root.add(light);

      this.group.add(root);
    }
  }

  private pickTargets(current: MapId): MapId[] {
    const all: MapId[] = ['sky-city', 'cloud-sea', 'upper-atmo', 'deep-space', 'the-pit'];
    return all.filter((id) => id !== current);
  }

  update(dt: number) {
    this.spin += dt;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.rotation.z = this.spin * (i % 2 === 0 ? 0.7 : -1.1);
    }
  }

  /** If player is inside a portal gate, return that portal. */
  checkEnter(pos: THREE.Vector3): PortalDef | null {
    for (const p of this.portals) {
      if (pos.distanceTo(p.position) < p.radius) return p;
    }
    return null;
  }

  /** Radar blips for portals */
  blips(): Array<{ x: number; z: number }> {
    return this.portals.map((p) => ({ x: p.position.x, z: p.position.z }));
  }

  clear() {
    while (this.group.children.length) {
      const o = this.group.children.pop()!;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat.dispose();
        }
      });
    }
    this.portals = [];
    this.rings = [];
    this.labels = [];
  }
}

function portalColor(id: MapId): number {
  switch (id) {
    case 'sky-city':
      return 0xff2bd6;
    case 'cloud-sea':
      return 0x66ddff;
    case 'upper-atmo':
      return 0x88aaff;
    case 'deep-space':
      return 0xaa66ff;
    case 'the-pit':
      return 0xff6b2b;
    default:
      return 0x00f0ff;
  }
}

function makeLabelSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(8, 12, 240, 40);
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(18, 4.5, 1);
  return sprite;
}

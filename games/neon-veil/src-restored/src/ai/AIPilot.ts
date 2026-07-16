import * as THREE from 'three';
import type { PlayerState, WeaponId } from '../core/types';
import { VehiclePawn } from '../vehicle/VehiclePawn';

export type AIPersonality = 'hunter' | 'skirmisher' | 'sniper' | 'guardian' | 'berserker';
export type AIMood = 'hunt' | 'engage' | 'flee' | 'hide' | 'defend';

interface Persona {
  type: AIPersonality;
  aggression: number; // 0–1
  accuracy: number;
  courage: number; // lower = flees sooner
  preferredRange: number;
  speedMul: number;
}

const PERSONAS: Persona[] = [
  // Mid–high accuracy, snappy flight — should feel like good pilots.
  { type: 'hunter', aggression: 0.85, accuracy: 0.74, courage: 0.55, preferredRange: 70, speedMul: 1.08 },
  { type: 'skirmisher', aggression: 0.55, accuracy: 0.68, courage: 0.45, preferredRange: 95, speedMul: 1.18 },
  { type: 'sniper', aggression: 0.4, accuracy: 0.86, courage: 0.35, preferredRange: 140, speedMul: 0.95 },
  { type: 'guardian', aggression: 0.5, accuracy: 0.72, courage: 0.7, preferredRange: 55, speedMul: 1.0 },
  { type: 'berserker', aggression: 1, accuracy: 0.62, courage: 0.9, preferredRange: 35, speedMul: 1.22 },
];

/**
 * Rival pilot AI — full 3D dogfight: hunt through city, flee when hurt,
 * hide behind structures, defend anchors, varied aggression.
 */
export class AIPilot {
  state: PlayerState;
  pawn: VehiclePawn;
  marker: THREE.Group;
  persona: Persona;
  mood: AIMood = 'hunt';

  private velocity = new THREE.Vector3();
  /** Current chase / attack focus (for AI rocket latch). */
  targetId: string | null = null;
  private fireCd = 0;
  private thinkTimer = 0;
  private moodTimer = 0;
  private hidePoint = new THREE.Vector3();
  private orbitAngle = 0;
  private strafeSign = 1;
  private jukeTimer = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private lastDamaged = 0;

  constructor(state: PlayerState, color = 0xff2bd6, personaIndex = 0) {
    this.state = state;
    this.pawn = new VehiclePawn(color, false);
    this.marker = this.makeMarker(color);
    this.pawn.group.add(this.marker);
    this.persona = PERSONAS[personaIndex % PERSONAS.length];
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this.syncFromState();
  }

  private makeMarker(color: number) {
    // Hostile diamond + chevron — clearly a pilot target, not a crate
    const g = new THREE.Group();
    const hostile = 0xff2a4a;
    const mat = new THREE.MeshBasicMaterial({
      color: hostile,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const accent = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });

    // Flat diamond under ship
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), mat);
    diamond.position.y = -0.9;
    diamond.scale.set(1.4, 0.25, 1.4);
    g.add(diamond);

    // Vertical chevron above (points at hostile)
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 3), mat);
    chev.position.y = 2.8;
    chev.rotation.x = Math.PI;
    g.add(chev);

    // Thin team-color ring for ID (not crate-like torus)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.06, 6, 20), accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);

    // "!" sprite bar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), mat);
    bar.position.y = 2.0;
    g.add(bar);
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), mat);
    dot.position.y = 1.45;
    g.add(dot);

    g.position.y = 0.2;
    return g;
  }

  /** Hide ring when occluded / dead. */
  setTrackerVisible(on: boolean) {
    this.marker.visible = on && this.state.alive;
  }

  /** Bounce off a solid (building). Cancels into-wall velocity. */
  deflect(normal: THREE.Vector3) {
    const vn = this.velocity.dot(normal);
    if (vn < 0) this.velocity.addScaledVector(normal, -vn * 1.35);
    this.velocity.addScaledVector(normal, 6);
    this.pawn.group.position.addScaledVector(normal, 0.4);
    const sp = this.velocity.length();
    if (sp > 90) this.velocity.multiplyScalar(90 / sp);
  }

  syncFromState() {
    this.pawn.group.position.fromArray(this.state.position);
    this.quat.fromArray(this.state.rotation);
    this.pawn.group.quaternion.copy(this.quat);
    this.velocity.fromArray(this.state.velocity);
  }

  writeState() {
    this.pawn.group.position.toArray(this.state.position);
    this.pawn.group.quaternion.toArray(this.state.rotation);
    this.velocity.toArray(this.state.velocity);
  }

  update(
    dt: number,
    others: PlayerState[],
    bounds: number,
    minAlt: number,
    maxAlt: number,
    onFire: (origin: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId) => void
  ) {
    if (!this.state.alive) {
      this.pawn.group.visible = false;
      return;
    }
    this.pawn.group.visible = true;
    this.marker.rotation.y += dt * 1.5;
    this.lastDamaged = Math.max(0, this.lastDamaged - dt);
    this.jukeTimer = Math.max(0, this.jukeTimer - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.moodTimer -= dt;
    this.thinkTimer -= dt;

    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.25 + Math.random() * 0.35;
      this.pickTarget(others);
      this.reassessMood(bounds, minAlt, maxAlt);
    }

    const pos = this.pawn.group.position;
    const target = this.targetId
      ? others.find((o) => o.id === this.targetId && o.alive)
      : null;
    const targetPos = target ? this.tmp2.fromArray(target.position) : null;
    const dist = targetPos ? pos.distanceTo(targetPos) : Infinity;

    // Desired steering point in 3D
    const aim = this.tmp3;
    switch (this.mood) {
      case 'flee':
        this.computeFlee(aim, targetPos, pos, bounds, minAlt, maxAlt);
        break;
      case 'hide':
        aim.copy(this.hidePoint);
        // If we reached hide pocket, drift slowly
        if (pos.distanceTo(this.hidePoint) < 18) {
          aim.x += Math.sin(performance.now() * 0.001 + this.orbitAngle) * 12;
          aim.z += Math.cos(performance.now() * 0.001 + this.orbitAngle) * 12;
          aim.y += Math.sin(performance.now() * 0.0015) * 8;
        }
        break;
      case 'defend':
        this.computeDefend(aim, targetPos, pos);
        break;
      case 'engage':
        this.computeEngage(aim, targetPos, pos, dist);
        break;
      case 'hunt':
      default:
        this.computeHunt(aim, targetPos, pos, bounds, minAlt, maxAlt);
        break;
    }

    // Steer
    this.tmp.copy(aim).sub(pos);
    const toAim = this.tmp.length();
    if (toAim > 0.5) this.tmp.normalize();

    const targetYaw = Math.atan2(-this.tmp.x, -this.tmp.z);
    const targetPitch = Math.asin(THREE.MathUtils.clamp(this.tmp.y, -0.85, 0.85));
    this.euler.setFromQuaternion(this.pawn.group.quaternion, 'YXZ');
    // Snappy turns — should feel like skilled human pilots
    const turnRate = this.mood === 'flee' ? 3.4 : this.mood === 'engage' ? 2.85 : 2.2;
    this.euler.y = THREE.MathUtils.lerp(this.euler.y, targetYaw, 1 - Math.exp(-turnRate * dt));
    this.euler.x = THREE.MathUtils.lerp(this.euler.x, -targetPitch * 0.75, 1 - Math.exp(-2.4 * dt));
    // Bank into turns
    const yawDelta = THREE.MathUtils.euclideanModulo(targetYaw - this.euler.y + Math.PI, Math.PI * 2) - Math.PI;
    this.euler.z = THREE.MathUtils.lerp(this.euler.z, THREE.MathUtils.clamp(-yawDelta * 0.85, -0.6, 0.6), 1 - Math.exp(-3.5 * dt));
    this.quat.setFromEuler(this.euler);
    this.pawn.group.quaternion.copy(this.quat);

    // Speed by mood
    let speed = 44 * this.persona.speedMul;
    if (this.mood === 'flee') speed = 100 * this.persona.speedMul;
    else if (this.mood === 'engage') speed = 74 * this.persona.speedMul;
    else if (this.mood === 'hunt') speed = 60 * this.persona.speedMul;
    else if (this.mood === 'hide') speed = 38;
    else if (this.mood === 'defend') speed = 52;

    const forward = this.tmp.set(0, 0, -1).applyQuaternion(this.quat);
    // Sharp lateral juke in a fight
    if (this.mood === 'engage' || this.mood === 'defend') {
      const right = this.tmp2.set(1, 0, 0).applyQuaternion(this.quat);
      forward.addScaledVector(right, this.strafeSign * 0.38 * this.persona.aggression);
      if (this.jukeTimer <= 0) {
        this.strafeSign *= -1;
        this.jukeTimer = 0.55 + Math.random() * 0.95;
      }
      forward.normalize();
    }

    const accel = this.mood === 'flee' ? 2.6 : 1.75;
    this.velocity.lerp(forward.multiplyScalar(speed), 1 - Math.exp(-accel * dt));

    // Aggressive vertical weave through city canyons
    if (this.mood === 'hunt' || this.mood === 'engage') {
      this.velocity.y += Math.sin(performance.now() * 0.0022 + this.orbitAngle * 3) * 14 * dt;
    }

    pos.addScaledVector(this.velocity, dt);
    pos.y = THREE.MathUtils.clamp(pos.y, minAlt + 4, maxAlt - 8);
    const lim = bounds * 0.88;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);

    // Soft shield when defending / low
    if ((this.mood === 'defend' || this.mood === 'hide') && this.state.shield > 20 && this.state.health < 55) {
      this.state.shieldDeployed = true;
    } else if (this.state.health > 70) {
      this.state.shieldDeployed = false;
    }

    this.pawn.setBoost(this.mood === 'flee' || this.mood === 'engage' ? 0.85 : 0.35);
    this.pawn.setShield(this.state.shieldDeployed);

    // Combat fire
    if (targetPos && (this.mood === 'engage' || this.mood === 'defend' || this.mood === 'hunt')) {
      const maxFireDist = this.persona.type === 'sniper' ? 200 : 150;
      if (dist < maxFireDist && this.fireCd <= 0 && this.hasRoughLos(pos, targetPos)) {
        this.tryShot(pos, targetPos, dist, onFire);
      }
    }
    // Ambush peek while hiding
    if (this.mood === 'hide' && targetPos && dist < 100 && this.fireCd <= 0 && Math.random() < 0.15) {
      this.tryShot(pos, targetPos, dist, onFire);
    }

    this.writeState();
  }

  private reassessMood(bounds: number, minAlt: number, maxAlt: number) {
    const hp = this.state.health / 100;
    const threat = this.targetId ? 1 : 0;
    const fleeThreshold = 0.28 + (1 - this.persona.courage) * 0.35;

    if (hp < fleeThreshold || (hp < 0.4 && this.lastDamaged > 0)) {
      // Low: hide or flee
      if (this.persona.type === 'guardian' || Math.random() < 0.55) {
        this.mood = 'hide';
        this.pickHidePoint(bounds, minAlt, maxAlt);
      } else {
        this.mood = 'flee';
      }
      this.moodTimer = 2.5 + Math.random() * 2;
      return;
    }

    if (this.moodTimer > 0 && (this.mood === 'flee' || this.mood === 'hide')) {
      if (hp > fleeThreshold + 0.15) {
        /* recovered enough to leave mood after timer */
      } else {
        return;
      }
    }

    if (!this.targetId) {
      this.mood = 'hunt';
      return;
    }

    // High aggression → engage hard; low → defend / snipe
    if (this.persona.aggression > 0.75 && hp > 0.45) {
      this.mood = 'engage';
    } else if (this.persona.type === 'guardian' || this.persona.type === 'sniper') {
      this.mood = Math.random() < 0.4 ? 'defend' : 'engage';
    } else if (this.persona.aggression < 0.5 && hp < 0.6) {
      this.mood = Math.random() < 0.5 ? 'defend' : 'engage';
    } else {
      this.mood = threat ? 'engage' : 'hunt';
    }
    this.moodTimer = 1.2 + Math.random() * 1.5;
  }

  private pickHidePoint(bounds: number, minAlt: number, maxAlt: number) {
    // Tuck into a city cell (near avenue grid / random canyon)
    const cell = 30;
    const gx = Math.floor((Math.random() - 0.5) * (bounds / cell) * 0.7);
    const gz = Math.floor((Math.random() - 0.5) * (bounds / cell) * 0.7);
    this.hidePoint.set(
      gx * cell + 8,
      minAlt + 12 + Math.random() * (maxAlt - minAlt) * 0.35,
      gz * cell + 8
    );
  }

  private computeFlee(
    out: THREE.Vector3,
    target: THREE.Vector3 | null,
    pos: THREE.Vector3,
    bounds: number,
    minAlt: number,
    maxAlt: number
  ) {
    if (target) {
      out.copy(pos).sub(target).normalize();
    } else {
      out.set(Math.sin(this.orbitAngle), 0.3, Math.cos(this.orbitAngle));
    }
    // Escape in full 3D — climb hard or dive into canyons
    const climb = this.persona.type === 'skirmisher' ? 1 : Math.random() < 0.5 ? 1 : -0.6;
    out.y = climb;
    out.normalize();
    out.multiplyScalar(80).add(pos);
    // Bias toward map edge
    out.x += Math.sign(pos.x || 1) * 40;
    out.z += Math.sign(pos.z || 1) * 40;
    out.y = THREE.MathUtils.clamp(out.y, minAlt + 10, maxAlt - 15);
    out.x = THREE.MathUtils.clamp(out.x, -bounds * 0.8, bounds * 0.8);
    out.z = THREE.MathUtils.clamp(out.z, -bounds * 0.8, bounds * 0.8);
  }

  private computeDefend(out: THREE.Vector3, target: THREE.Vector3 | null, pos: THREE.Vector3) {
    this.orbitAngle += 0.02;
    const anchor = target ? target : this.tmp.set(0, pos.y, 0);
    const r = this.persona.preferredRange * 0.7;
    out.set(
      anchor.x + Math.cos(this.orbitAngle) * r,
      (target ? target.y : pos.y) + Math.sin(this.orbitAngle * 2) * 18,
      anchor.z + Math.sin(this.orbitAngle) * r
    );
  }

  private computeEngage(out: THREE.Vector3, target: THREE.Vector3 | null, pos: THREE.Vector3, dist: number) {
    if (!target) {
      out.copy(pos);
      return;
    }
    const pref = this.persona.preferredRange;
    const dir = this.tmp.copy(pos).sub(target);
    if (dir.lengthSq() < 1) dir.set(1, 0, 0);
    dir.normalize();

    if (dist > pref + 25) {
      // Close in with vertical offset (attack from above/below)
      out.copy(target);
      out.y += (Math.random() - 0.4) * 30;
      out.addScaledVector(dir, -12);
    } else if (dist < pref - 20) {
      // Too close — break off in 3D
      out.copy(pos).addScaledVector(dir, 40);
      out.y += this.strafeSign * 25;
    } else {
      // Circle-strafe at preferred range
      const right = this.tmp.set(dir.z, 0, -dir.x).normalize();
      out.copy(target).addScaledVector(right, this.strafeSign * pref * 0.5);
      out.y = target.y + Math.sin(performance.now() * 0.0015 + this.orbitAngle) * 20;
    }
  }

  private computeHunt(
    out: THREE.Vector3,
    target: THREE.Vector3 | null,
    pos: THREE.Vector3,
    bounds: number,
    minAlt: number,
    maxAlt: number
  ) {
    if (target) {
      // Intercept through city — aim ahead of target path-ish
      out.copy(target);
      out.y += 10;
      // Weave between buildings by offsetting laterally
      out.x += Math.sin(performance.now() * 0.0008 + this.orbitAngle) * 25;
      out.z += Math.cos(performance.now() * 0.0008 + this.orbitAngle) * 25;
      return;
    }
    // Patrol 3D volume
    this.orbitAngle += 0.01;
    out.set(
      Math.sin(this.orbitAngle * 0.7) * bounds * 0.45,
      minAlt + 30 + Math.abs(Math.sin(this.orbitAngle)) * (maxAlt - minAlt) * 0.4,
      Math.cos(this.orbitAngle * 0.55) * bounds * 0.45
    );
  }

  private hasRoughLos(from: THREE.Vector3, to: THREE.Vector3): boolean {
    // Cheap LOS: if very far horizontally through dense core, slight miss chance handled in accuracy
    void from;
    void to;
    return true;
  }

  private tryShot(
    pos: THREE.Vector3,
    targetPos: THREE.Vector3,
    dist: number,
    onFire: (origin: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId) => void
  ) {
    const dir = this.tmp.copy(targetPos).sub(pos).normalize();
    // Mid–high accuracy: still human error, not spray
    const lead = dist / 155;
    const miss = (1 - this.persona.accuracy) * 0.2;
    dir.x += (Math.random() - 0.5) * miss;
    dir.y += (Math.random() - 0.5) * miss * 0.7 + lead * 0.025;
    dir.z += (Math.random() - 0.5) * miss;
    dir.normalize();

    let weapon: WeaponId = 'plasma';
    if (this.persona.type === 'sniper' && dist > 80) weapon = Math.random() < 0.5 ? 'rail' : 'laser';
    else if (this.persona.type === 'berserker' && dist < 50) weapon = Math.random() < 0.4 ? 'scatter' : 'plasma';
    else if (dist > 100) weapon = Math.random() < 0.45 ? 'rail' : 'laser';
    else if (dist > 55) weapon = Math.random() < 0.35 ? 'rocket' : dist > 70 ? 'torpedo' : 'plasma';
    else weapon = Math.random() < 0.3 ? 'scatter' : 'plasma';

    const origin = pos.clone().addScaledVector(dir, 2.5);
    onFire(origin, dir, weapon);

    this.fireCd =
      weapon === 'plasma'
        ? 0.24
        : weapon === 'laser'
          ? 0.11
          : weapon === 'scatter'
            ? 0.48
            : weapon === 'rocket'
              ? 1.15
              : weapon === 'torpedo'
                ? 1.85
                : 1.55;
  }

  private pickTarget(others: PlayerState[]) {
    let best: PlayerState | null = null;
    let bestScore = -Infinity;
    const pos = this.pawn.group.position;
    for (const o of others) {
      if (o.id === this.state.id || !o.alive) continue;
      if (this.state.team !== 0 && o.team === this.state.team) continue;
      const d = Math.sqrt(pos.distanceToSquared(this.tmp.fromArray(o.position)));
      // Equal aggro on every pilot (human or NPC) — range + mild health, no player bias.
      let score = 1000 - d;
      score += (100 - o.health) * 0.35;
      if (o.shieldDeployed) score -= 40;
      // Stick to current target so packs don't thrash focus every think tick
      if (o.id === this.targetId) score += 90;
      // Small random so multiple AIs don't all lock the same nearest ship
      score += (Math.random() - 0.5) * 55;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    this.targetId = best?.id ?? null;
  }

  takeDamage(amount: number): boolean {
    if (!this.state.alive) return false;
    this.lastDamaged = 1.5;
    if (this.state.shieldDeployed) amount *= 0.2;
    else if (this.state.shield > 0) {
      const ab = Math.min(this.state.shield, amount);
      this.state.shield -= ab;
      amount -= ab;
    }
    this.state.health -= amount;
    // Panic reassess
    if (this.state.health < 40 * (1.2 - this.persona.courage)) {
      this.mood = Math.random() < 0.5 ? 'flee' : 'hide';
      this.moodTimer = 2;
      this.thinkTimer = 0;
    }
    if (this.state.health <= 0) {
      this.state.health = 0;
      this.state.alive = false;
      this.state.deaths++;
      return true;
    }
    return false;
  }

  respawn(pos: THREE.Vector3) {
    this.state.alive = true;
    this.state.health = 100;
    this.state.shield = 100;
    this.state.shieldDeployed = false;
    pos.toArray(this.state.position);
    this.velocity.set(0, 0, 0);
    this.mood = 'hunt';
    this.targetId = null;
    this.syncFromState();
    this.pawn.group.visible = true;
  }

  dispose() {
    this.pawn.dispose();
  }
}

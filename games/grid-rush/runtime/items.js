import * as THREE from 'three';
import { ITEMS } from './config.js';
import { clamp } from './math.js';

/** Roll an item — trailing racers get slightly better offense odds */
export function rollItem(place, totalRacers, rnd = Math.random) {
  const trail = place / Math.max(1, totalRacers); // 0 first … ~1 last
  const bag = [];
  for (const it of Object.values(ITEMS)) {
    let w = it.rarity;
    if (it.offense) w *= 0.65 + trail * 0.9;
    else w *= 1.15 - trail * 0.4;
    // first place: fewer warps
    if (it.id === 'warp_anchor') w *= 0.35 + trail * 1.2;
    bag.push({ id: it.id, w });
  }
  let sum = bag.reduce((a, b) => a + b.w, 0);
  let r = rnd() * sum;
  for (const b of bag) {
    r -= b.w;
    if (r <= 0) return b.id;
  }
  return bag[bag.length - 1].id;
}

/**
 * Active world gadgets (mines, wells, etc.)
 */
export class ItemWorld {
  constructor(scene) {
    this.scene = scene;
    this.entities = [];
  }

  clear() {
    for (const e of this.entities) this.removeEntity(e);
    this.entities = [];
  }

  removeEntity(e) {
    if (e.mesh) {
      this.scene.remove(e.mesh);
      e.mesh.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
  }

  spawnMine(pos, ownerId) {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7, 0),
      new THREE.MeshStandardMaterial({
        color: 0x1a0810,
        emissive: 0xff6b2b,
        emissiveIntensity: 0.8,
        metalness: 0.4,
        roughness: 0.3,
      })
    );
    mesh.position.copy(pos);
    mesh.position.y += 0.4;
    this.scene.add(mesh);
    this.entities.push({
      type: 'pulse_mine',
      mesh,
      pos: pos.clone(),
      ownerId,
      radius: 2.2,
      life: 22,
      armed: 0.4,
    });
  }

  spawnWell(pos, ownerId) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(3.5, 0.15, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.7, toneMapped: false })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y += 0.5;
    this.scene.add(mesh);
    this.entities.push({
      type: 'gravity_well',
      mesh,
      pos: pos.clone(),
      ownerId,
      radius: 14,
      life: 5.5,
      pull: 38,
    });
  }

  update(dt, racers, onHit) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.life -= dt;
      if (e.armed != null) e.armed = Math.max(0, e.armed - dt);
      if (e.mesh && e.type === 'pulse_mine') e.mesh.rotation.y += dt * 3;
      if (e.mesh && e.type === 'gravity_well') {
        e.mesh.rotation.z += dt * 2;
        e.mesh.scale.setScalar(1 + Math.sin(performance.now() * 0.008) * 0.08);
      }
      if (e.life <= 0) {
        this.removeEntity(e);
        this.entities.splice(i, 1);
        continue;
      }

      for (const r of racers) {
        if (!r.alive || r.finished) continue;
        if (r.phasing) continue;
        const d = r.position.distanceTo(e.pos);
        if (e.type === 'pulse_mine') {
          if (e.armed > 0) continue;
          if (r.id === e.ownerId && e.life > 20) continue;
          if (d < e.radius + 1.1) {
            onHit(r, 'pulse_mine', e.ownerId, 0.55);
            this.removeEntity(e);
            this.entities.splice(i, 1);
            break;
          }
        } else if (e.type === 'gravity_well') {
          if (d < e.radius && d > 0.2) {
            const pull = e.pos.clone().sub(r.position).normalize().multiplyScalar(e.pull * dt * (1 - d / e.radius));
            r.velocity.add(pull);
          }
        }
      }
    }
  }
}

/**
 * Apply held item for a racer. Mutates racer / world / others.
 */
export function useItem(racer, racers, world, track, placeOf) {
  const id = racer.item;
  if (!id) return null;
  const def = ITEMS[id];
  racer.item = null;
  racer.itemCooldown = 0.35;

  const events = [];

  switch (id) {
    case 'pulse_mine': {
      const drop = racer.position.clone().addScaledVector(racer.forward, -3.2);
      world.spawnMine(drop, racer.id);
      events.push({ kind: 'toast', text: 'PULSE MINE DROPPED', who: racer.id });
      break;
    }
    case 'phase_skate': {
      racer.phasing = true;
      racer.phaseTimer = 2.4;
      racer.speedMul = Math.max(racer.speedMul, 1.25);
      events.push({ kind: 'toast', text: 'PHASE SKATE', who: racer.id });
      break;
    }
    case 'volt_lash': {
      // hit racer ahead in place
      const sorted = [...racers].filter((x) => x.alive && !x.finished).sort((a, b) => placeOf(a) - placeOf(b));
      const myPlace = placeOf(racer);
      const target = sorted.find((x) => placeOf(x) === myPlace - 1) || sorted.find((x) => placeOf(x) < myPlace);
      if (target && target.id !== racer.id) {
        applyStun(target, 1.1, 0.35);
        events.push({ kind: 'lash', from: racer.id, to: target.id });
        events.push({ kind: 'toast', text: `VOLT LASH → ${target.callsign}`, who: racer.id });
      } else {
        events.push({ kind: 'toast', text: 'VOLT LASH — NO TARGET', who: racer.id });
      }
      break;
    }
    case 'gravity_well': {
      world.spawnWell(racer.position.clone().addScaledVector(racer.forward, 10), racer.id);
      events.push({ kind: 'toast', text: 'GRAVITY WELL', who: racer.id });
      break;
    }
    case 'mirror_fog': {
      const sorted = [...racers].filter((x) => x.alive && !x.finished);
      const myP = placeOf(racer);
      const ahead = sorted.find((x) => placeOf(x) === myP - 1) || sorted.filter((x) => placeOf(x) < myP).sort((a, b) => placeOf(b) - placeOf(a))[0];
      if (ahead && ahead.id !== racer.id) {
        ahead.steerInvert = Math.max(ahead.steerInvert, 3.5);
        events.push({ kind: 'toast', text: `MIRROR FOG → ${ahead.callsign}`, who: racer.id });
      } else {
        events.push({ kind: 'toast', text: 'MIRROR FOG — NO TARGET', who: racer.id });
      }
      break;
    }
    case 'overclock': {
      racer.turbine = 100;
      racer.overclockTimer = 3.2;
      events.push({ kind: 'toast', text: 'OVERCLOCK ONLINE', who: racer.id });
      break;
    }
    case 'emp_bloom': {
      for (const o of racers) {
        if (o.id === racer.id || !o.alive || o.finished) continue;
        if (o.position.distanceTo(racer.position) < 22) {
          if (o.veil) {
            o.veil = false;
            applyStun(racer, 0.4, 0.15);
            events.push({ kind: 'toast', text: `${o.callsign} VEIL REFLECT`, who: o.id });
          } else {
            applyStun(o, 1.35, 0.5);
          }
        }
      }
      events.push({ kind: 'emp', at: racer.position.clone() });
      events.push({ kind: 'toast', text: 'EMP BLOOM', who: racer.id });
      break;
    }
    case 'data_siphon': {
      let best = null;
      let bestD = 28;
      for (const o of racers) {
        if (o.id === racer.id || !o.item) continue;
        const d = o.position.distanceTo(racer.position);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        racer.item = best.item;
        best.item = null;
        events.push({ kind: 'toast', text: `SIPHONED ${ITEMS[racer.item]?.name || 'GADGET'}`, who: racer.id });
      } else {
        events.push({ kind: 'toast', text: 'SIPHON — EMPTY', who: racer.id });
      }
      break;
    }
    case 'warp_anchor': {
      const hop = 38;
      racer.trackS += hop;
      const samp = track.sampleAt(racer.trackS);
      racer.position.copy(samp.pos).addScaledVector(samp.side, clamp(racer.lateral, -7, 7));
      racer.position.y += 1.15;
      racer.velocity.copy(samp.tangent).multiplyScalar(Math.max(racer.speed, 30));
      racer.yaw = Math.atan2(samp.tangent.x, samp.tangent.z);
      events.push({ kind: 'toast', text: 'WARP ANCHOR', who: racer.id });
      break;
    }
    case 'static_veil': {
      racer.veil = true;
      racer.veilTimer = 8;
      events.push({ kind: 'toast', text: 'STATIC VEIL UP', who: racer.id });
      break;
    }
    default:
      break;
  }

  return { def, events };
}

export function applyStun(racer, time, speedKill) {
  if (racer.veil) {
    racer.veil = false;
    racer.veilTimer = 0;
    return 'blocked';
  }
  if (racer.phasing) return 'phased';
  racer.stun = Math.max(racer.stun, time);
  racer.velocity.multiplyScalar(1 - speedKill);
  racer.speed = racer.velocity.length();
  return 'hit';
}

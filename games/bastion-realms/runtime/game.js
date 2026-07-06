// Game controller: level lifecycle, input, fixed-step loop, event->FX/audio wiring.
import * as THREE from 'three';
import { createSim, DT } from './sim/sim.js';
import { levelDef } from './data/levels.js';
import { GRID_W, GRID_H, CELL, cellToWorld, worldToCell, posAlong } from './sim/path.js';
import { TOWERS, TOWER_ORDER, isTowerUnlocked } from './data/towers.js';
import { buildWorld } from './view/world.js';
import { createEnemyLayer } from './view/enemies3d.js';
import { createCritters } from './view/critters.js';
import { enemyDef } from './data/enemies.js';
import { buildTowerMesh, animateTower, aimTower } from './view/towers3d.js';
import { createFx } from './view/fx.js';
import { lightRig } from './core/engine3d.js';
import { loadProfile, saveProfile, recordResult, recordEndless } from './core/save.js';
import { evaluateAchievements } from './data/achievements.js';

const SHOT_SFX = {
  bolt: ['wood_light', 0.5], sniper: ['knife', 0.55], ember: null, frost: null,
  venom: null, cannon: ['hit_punch', 0.5], storm: null,
};

export function createGame(env) {
  const { engine, ui, audio } = env;
  const { scene, camera, renderer } = engine;

  const g = {
    sim: null, level: null, bi: 0, li: 0, endless: false,
    speed: 1, paused: false, running: false,
    selection: { buildType: null, towerId: null },
    towerMeshes: new Map(), projMeshes: new Map(),
    enemyLayer: null, fx: null, world: null, lights: null,
    ghost: null, rangeRing: null, hoverCell: null,
    ventMarkers: [], fogSprites: [],
    onExit: null, resultShown: false,
    timeAcc: 0, viewT: 0, usedSpeeds: new Set([1]),
  };

  // ---------- scene lifecycle ----------
  function clearScene() {
    for (const m of g.towerMeshes.values()) scene.remove(m);
    g.towerMeshes.clear();
    for (const m of g.projMeshes.values()) scene.remove(m.mesh);
    g.projMeshes.clear();
    g.enemyLayer?.clear();
    if (g.enemyLayer) scene.remove(g.enemyLayer.group);
    g.critters?.dispose();
    g.critters = null;
    if (g.world) scene.remove(g.world.group);
    if (g.lights) scene.remove(g.lights);
    for (const v of g.ventMarkers) scene.remove(v.mesh);
    g.ventMarkers = [];
    for (const f of g.fogSprites) scene.remove(f);
    g.fogSprites = [];
    if (g.ghost) { scene.remove(g.ghost.group); g.ghost = null; }
    if (g.rangeRing) { scene.remove(g.rangeRing); g.rangeRing = null; }
    if (g.fx) { /* fx pools attach to scene; removed with children below */ }
    // brute-force leftover fx layers
    const leftovers = scene.children.filter((c) => c.type === 'Points' || c.type === 'Line' || c.type === 'Sprite' || c.type === 'Mesh');
    for (const c of leftovers) scene.remove(c);
    g.fx = null;
  }

  g.loadLevel = (bi, li, endless = false) => {
    env.onSceneBusy?.();
    clearScene();
    g.bi = bi; g.li = li; g.endless = endless;
    g.level = levelDef(bi, li);
    g.sim = createSim(bi, li, { endless });
    g.selection = { buildType: null, towerId: null };
    g.speed = 1; g.paused = false; g.resultShown = false;
    g.timeAcc = 0; g.usedSpeeds = new Set([1]);

    engine.resetView();
    g.lights = lightRig(scene, g.level.biome);
    g.world = buildWorld(scene, g.level);
    g.enemyLayer = createEnemyLayer(scene);
    g.critters = createCritters(scene, g.level);
    g.fx = createFx(scene, g.level.biome);

    // hazard visuals
    if (g.sim.ventCells.length) {
      for (const [cx, cy] of g.sim.ventCells) {
        const w = cellToWorld(cx, cy);
        const mesh = new THREE.Mesh(
          new THREE.CircleGeometry(0.85, 20),
          new THREE.MeshBasicMaterial({ color: 0xff4a14, transparent: true, opacity: 0.35 })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(w.x, 0.06, w.z);
        scene.add(mesh);
        g.ventMarkers.push({ mesh, warn: 0 });
      }
    }
    for (const z of g.sim.fogZones) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fogTexture(), transparent: true, opacity: 0.4, depthWrite: false, color: 0x9fe8b8,
      }));
      spr.position.set(z.x, 1.2, z.z);
      spr.scale.set(z.r * 2.6, z.r * 1.3, 1);
      scene.add(spr);
      g.fogSprites.push(spr);
    }

    // ghost + range ring
    g.rangeRing = makeRing();
    scene.add(g.rangeRing);

    ui.showHud({ bi, li, endless, level: g.level });
    ui.updateHud(g.sim, g.selection);
    ui.banner(endless ? 'ENDLESS MODE' : `${g.level.biome.name}`, endless ? g.level.biome.name : g.level.name, 2.6);
    audio.playMusic(g.level.biome.music);
    if (g.level.hazard) {
      setTimeout(() => ui.hazardNotice(`⚠ ${g.level.hazard.name}: ${g.level.hazard.desc}`, g.level.hazard.id === 'manaSurge', 5), 2400);
    }
    g.running = true;
  };

  function fogTexture() {
    if (fogTexture.cached) return fogTexture.cached;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 5; i++) {
      const grd = ctx.createRadialGradient(30 + i * 18, 32, 2, 30 + i * 18, 32, 30);
      grd.addColorStop(0, 'rgba(255,255,255,0.5)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 64);
    }
    fogTexture.cached = new THREE.CanvasTexture(c);
    return fogTexture.cached;
  }

  function makeRing() {
    const geo = new THREE.RingGeometry(0.97, 1, 48);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8b04a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.1;
    m.visible = false;
    m.renderOrder = 12;
    return m;
  }

  // ---------- towers view ----------
  function syncTowers() {
    for (const tw of g.sim.towers) {
      if (!g.towerMeshes.has(tw.id)) {
        const mesh = buildTowerMesh(tw.type, tw.level);
        mesh.position.set(tw.x, 0, tw.z);
        mesh.userData.towerId = tw.id;
        mesh.userData.level = tw.level;
        scene.add(mesh);
        g.towerMeshes.set(tw.id, mesh);
      } else {
        const mesh = g.towerMeshes.get(tw.id);
        if (mesh.userData.level !== tw.level) {
          scene.remove(mesh);
          const m2 = buildTowerMesh(tw.type, tw.level);
          m2.position.set(tw.x, 0, tw.z);
          m2.userData.towerId = tw.id;
          m2.userData.level = tw.level;
          scene.add(m2);
          g.towerMeshes.set(tw.id, m2);
        }
      }
    }
    for (const [id, mesh] of g.towerMeshes) {
      if (!g.sim.towers.some((t) => t.id === id)) {
        scene.remove(mesh);
        g.towerMeshes.delete(id);
      }
    }
  }

  // ---------- projectiles view ----------
  const projGeo = {
    bolt: new THREE.BoxGeometry(0.07, 0.07, 0.5),
    ember: new THREE.SphereGeometry(0.14, 8, 6),
    shard: new THREE.OctahedronGeometry(0.14),
    vial: new THREE.SphereGeometry(0.15, 8, 6),
    shell: new THREE.SphereGeometry(0.19, 10, 8),
  };
  const projMat = {
    bolt: new THREE.MeshBasicMaterial({ color: 0xffe9a0 }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff8c3a }),
    shard: new THREE.MeshBasicMaterial({ color: 0xa8e4ff }),
    vial: new THREE.MeshBasicMaterial({ color: 0x8fd435 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.5, metalness: 0.4 }),
  };
  function syncProjectiles() {
    const seen = new Set();
    for (const pr of g.sim.projectiles) {
      seen.add(pr.id);
      let pv = g.projMeshes.get(pr.id);
      if (!pv) {
        const mesh = new THREE.Mesh(projGeo[pr.kind] || projGeo.bolt, projMat[pr.kind] || projMat.bolt);
        mesh.castShadow = false;
        scene.add(mesh);
        pv = { mesh, kind: pr.kind, sx: pr.x, sz: pr.z };
        g.projMeshes.set(pr.id, pv);
      }
      if (pr.arc) {
        const t = Math.max(0, Math.min(1, pr.t / pr.flight));
        const x = pv.sx + (pr.aim.x - pv.sx) * t;
        const z = pv.sz + (pr.aim.z - pv.sz) * t;
        const d = Math.hypot(pr.aim.x - pv.sx, pr.aim.z - pv.sz);
        const y = 1.4 + Math.sin(Math.PI * t) * Math.min(4.5, d * 0.3);
        pv.mesh.position.set(x, y, z);
      } else {
        pv.mesh.position.set(pr.x, pr.y || 1.5, pr.z);
        const target = g.sim.enemies.find((e) => e.id === pr.targetId);
        if (target && pr.kind === 'bolt') {
          const p = g.sim.enemyPos(target);
          pv.mesh.lookAt(p.x, 1.0, p.z);
        }
      }
      // elemental trails — every projectile leaves its signature behind
      const mp = pv.mesh.position;
      if (pr.kind === 'ember') g.fx.burst('ember', mp.x, mp.y, mp.z, 1, { vel: 0.3, up: 0.4, life: 0.3, spread: 0.1 });
      else if (pr.kind === 'shard') g.fx.burst('ice', mp.x, mp.y, mp.z, 1, { vel: 0.25, up: 0.2, life: 0.35, spread: 0.12 });
      else if (pr.kind === 'vial') g.fx.burst('poison', mp.x, mp.y, mp.z, 1, { vel: 0.2, up: -0.3, life: 0.4, spread: 0.1 });
      else if (pr.kind === 'shell') g.fx.burst('smoke', mp.x, mp.y, mp.z, 1, { vel: 0.15, up: 0.5, life: 0.55, spread: 0.12 });
      else if (pr.kind === 'bolt' && Math.random() < 0.5) g.fx.burst('gold', mp.x, mp.y, mp.z, 1, { vel: 0.1, up: 0, life: 0.18, spread: 0.06 });
    }
    for (const [id, pv] of g.projMeshes) {
      if (!seen.has(id)) { scene.remove(pv.mesh); g.projMeshes.delete(id); }
    }
  }

  // ---------- event handling ----------
  function towerMuzzle(towerId) {
    const mesh = g.towerMeshes.get(towerId);
    if (!mesh) return null;
    const mz = mesh.userData?.muzzle || mesh.children.find((c) => c.userData?.muzzle);
    const u = mesh.userData;
    const node = u.muzzle;
    if (!node) return { x: mesh.position.x, y: 2, z: mesh.position.z };
    const v = new THREE.Vector3();
    node.getWorldPosition(v);
    return v;
  }

  function handleEvents(events) {
    for (const ev of events) {
      switch (ev.kind) {
        case 'shot': {
          const mesh = g.towerMeshes.get(ev.towerId);
          if (mesh) aimTower(mesh, ev.tx, ev.tz);
          const m = towerMuzzle(ev.towerId);
          if (m) {
            const style = ev.type === 'ember' ? 'flame' : ev.type === 'frost' ? 'ice' : ev.type === 'venom' ? 'poison' : 'spark';
            g.fx.burst(style, m.x, m.y, m.z, 3, { vel: 0.8, up: 0.6, life: 0.25, spread: 0.15 });
          }
          const s = SHOT_SFX[ev.type];
          if (s) audio.play(s[0], { vol: s[1], throttle: 90 });
          else if (ev.type === 'ember') audio.synth.whoosh(0.22);
          else if (ev.type === 'frost') audio.synth.freezePing(0.13);
          else if (ev.type === 'venom') audio.synth.bubble(0.25);
          break;
        }
        case 'snipe': {
          const m = towerMuzzle(ev.towerId);
          if (m) g.fx.lightning([{ x: m.x, y: m.y, z: m.z }, { x: ev.tx, y: 1.1, z: ev.tz }], ev.crit ? 0xffd76a : 0xffffff);
          g.fx.burst('spark', ev.tx, 1.2, ev.tz, ev.crit ? 10 : 5, { vel: 2, life: 0.3 });
          audio.play('knife', { vol: 0.6 });
          break;
        }
        case 'chain': {
          const pts = ev.points.map((p, i) => ({ x: p.x, y: i === 0 ? 2.6 : 1.2, z: p.z }));
          g.fx.lightning(pts, 0x78d8ff);
          for (let i = 1; i < pts.length; i++) g.fx.burst('spark', pts[i].x, 1.2, pts[i].z, 4, { vel: 1.6, life: 0.3 });
          audio.synth.zap(0.4);
          break;
        }
        case 'explode': {
          g.fx.ring(ev.x, ev.z, ev.r, 0xffb24a, 0.5);
          g.fx.burst('flame', ev.x, 0.6, ev.z, 16, { vel: 3.2, up: 3, life: 0.55, spread: 0.7 });
          g.fx.burst('smoke', ev.x, 0.8, ev.z, 8, { vel: 1.2, up: 1.6, life: 1.0, spread: 0.8 });
          g.fx.burst('spark', ev.x, 0.7, ev.z, 8, { vel: 4, life: 0.4 });
          audio.play('cannon', { vol: 0.65 });
          break;
        }
        case 'vialLand':
          g.fx.burst('poison', ev.x, 0.5, ev.z, 8, { vel: 1.4, up: 1.4, life: 0.5, spread: 0.4 });
          audio.synth.bubble(0.3);
          break;
        case 'poisonBurst':
          g.fx.ring(ev.x, ev.z, ev.r, 0x8fd435, 0.55);
          g.fx.burst('poison', ev.x, 0.6, ev.z, 18, { vel: 2.2, up: 2, life: 0.8, spread: 0.6 });
          break;
        case 'ignite': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e) { const p = g.sim.enemyPos(e); g.fx.burst('flame', p.x, 1, p.z, 6, { vel: 1, up: 1.6, life: 0.4 }); }
          break;
        }
        case 'freeze': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e) { const p = g.sim.enemyPos(e); g.fx.burst('ice', p.x, 1, p.z, 10, { vel: 1.6, up: 1.2, life: 0.5 }); }
          audio.synth.freezePing(0.35);
          break;
        }
        case 'hit': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e && ev.amount >= 1) {
            const p = g.sim.enemyPos(e);
            const col = ev.crit ? '#ffd76a' : ev.dmgType === 'magic' ? '#9adcff' : ev.dmgType === 'true' ? '#9ade3a' : '#ffe9b0';
            g.fx.number(p.x, 2.1, p.z, String(Math.round(ev.amount)), col, !!ev.crit);
            const impact = ev.dmgType === 'true' ? 'poison' : ev.dmgType === 'magic' ? 'spark' : 'gold';
            g.fx.burst(impact, p.x, 1.1, p.z, 2, { vel: 1.2, up: 1, life: 0.3, spread: 0.25 });
          }
          if (ev.dmgType === 'phys') audio.play('hit_soft', { vol: 0.3, throttle: 120 });
          break;
        }
        case 'shieldHit': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e) { const p = g.sim.enemyPos(e); g.fx.burst('spark', p.x, 1.4, p.z, 5, { vel: 1.8, life: 0.3 }); }
          audio.play('hit_metal', { vol: 0.4 });
          break;
        }
        case 'shieldBreak': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e) { const p = g.sim.enemyPos(e); g.fx.burst('spark', p.x, 1.4, p.z, 16, { vel: 3, life: 0.5 }); }
          audio.play('glass_shatter', { vol: 0.55 });
          break;
        }
        case 'death': {
          g.enemyLayer.kill(ev.enemyId, false);
          const style = ['blood', 'ember', 'ice', 'smoke', 'star'][g.bi];
          g.fx.burst(style, ev.x, 0.9, ev.z, ev.boss ? 30 : 8, { vel: ev.boss ? 3.4 : 1.8, life: 0.6 });
          g.fx.burst('gold', ev.x, 1.2, ev.z, 3, { vel: 1, up: 2, life: 0.5 });
          g.fx.number(ev.x, 1.6, ev.z, '+' + ev.bounty, '#ffd76a');
          // proper creature death: pitch drops with size
          const dhp = enemyDef(ev.type).hp;
          const pitch = dhp >= 500 ? 0.6 : dhp >= 150 ? 0.85 : 1.2;
          audio.synth.deathGrunt(pitch * (0.94 + Math.random() * 0.12), 0.45);
          audio.play('coins', { vol: 0.2, throttle: 300 });
          if (ev.boss) { audio.synth.roar(0.5); g.fx.ring(ev.x, ev.z, 4, 0xffd76a, 0.8); }
          break;
        }
        case 'leak': {
          g.enemyLayer.kill(ev.enemyId, true);
          ui.damageFlash();
          audio.play('bong', { vol: 0.5 });
          break;
        }
        case 'spawn': {
          if (ev.boss) {
            const bd = g.sim.enemies.find((x) => x.id === ev.enemyId)?.def;
            ui.banner('☠ ' + (bd?.name || 'BOSS'), g.level.biome.bossIntro, 4);
            audio.synth.roar(0.6);
          }
          break;
        }
        case 'wave': {
          ui.banner(`WAVE ${ev.idx + 1}`, ev.label || '', 1.6);
          audio.synth.horn(0.4);
          break;
        }
        case 'waveEnd':
          ui.toast(`Wave ${ev.idx + 1} cleared <b>+🪙${ev.bonus}</b>`);
          audio.play('coins2', { vol: 0.4 });
          break;
        case 'build': {
          const w = cellToWorld(ev.cx, ev.cy);
          g.fx.burst('smoke', w.x, 0.4, w.z, 8, { vel: 1.4, up: 1, life: 0.5, spread: 0.6 });
          g.fx.ring(w.x, w.z, 1.2, 0xd8b04a, 0.4);
          audio.play('build', { vol: 0.6 });
          break;
        }
        case 'upgrade': {
          const tw = g.sim.towers.find((t) => t.id === ev.towerId);
          if (tw) { g.fx.ring(tw.x, tw.z, 1.4, 0xffd76a, 0.5); g.fx.burst('gold', tw.x, 1.4, tw.z, 10, { vel: 1.6, up: 2, life: 0.6 }); }
          audio.play('upgrade', { vol: 0.6 });
          break;
        }
        case 'sell': {
          const w = cellToWorld(ev.cx, ev.cy);
          g.fx.burst('gold', w.x, 1, w.z, 8, { vel: 1.6, up: 2.2, life: 0.5 });
          audio.play('coins2', { vol: 0.55 });
          break;
        }
        case 'ability': handleAbilityFx(ev); break;
        case 'ventWarn': {
          for (const v of g.ventMarkers) v.warn = 1;
          ui.hazardNotice('⚠ Lava vents rumbling…');
          break;
        }
        case 'vent': {
          for (const [cx, cy] of ev.cells) {
            const w = cellToWorld(cx, cy);
            g.fx.burst('flame', w.x, 0.3, w.z, 22, { vel: 1.6, up: 5.5, life: 0.8, spread: 0.4 });
            g.fx.burst('smoke', w.x, 0.6, w.z, 8, { vel: 1, up: 2.4, life: 1.1 });
            g.fx.ring(w.x, w.z, 1.6, 0xff4a14, 0.6);
          }
          for (const v of g.ventMarkers) v.warn = 0;
          audio.synth.roar(0.35);
          ui.hazardNotice('🌋 Eruption! Towers on vents are stunned');
          break;
        }
        case 'blizzard':
          ui.hazardNotice(`❄ Blizzard! All towers -${Math.round((g.level.hazard?.ratePenalty ?? 0.25) * 100)}% fire rate for ${ev.duration || 10}s`);
          break;
        case 'surge': {
          const tw = g.sim.towers.find((t) => t.id === ev.towerId);
          if (tw) { g.fx.ring(tw.x, tw.z, 1.6, 0xb89aff, 0.7); g.fx.burst('star', tw.x, 1.6, tw.z, 14, { vel: 1.6, up: 2, life: 0.8 }); }
          ui.hazardNotice('✨ Mana surge! A tower fires 50% faster', true);
          break;
        }
        case 'win': onWin(ev); break;
        case 'lose': onLose(); break;
      }
    }
  }

  function handleAbilityFx(ev) {
    switch (ev.name) {
      case 'sporeHeal':
        g.fx.ring(ev.x, ev.z, 5, 0x7dec6a, 0.7);
        g.fx.burst('heal', ev.x, 1.2, ev.z, 12, { vel: 1.8, up: 1.4, life: 0.7 });
        break;
      case 'summonMushnubs': case 'summonSkeletons': case 'summonGlubs':
        g.fx.burst('star', ev.x, 0.8, ev.z, 14, { vel: 2.2, life: 0.6 });
        ui.hazardNotice('☠ The boss summons reinforcements!');
        break;
      case 'wingGust':
        ui.hazardNotice('💨 Wing gust! Enemies surge forward');
        g.fx.ring(ev.x, ev.z, 6, 0xff8c3a, 0.8);
        break;
      case 'emberRain': {
        if (ev.towerId != null) {
          const tw = g.sim.towers.find((t) => t.id === ev.towerId);
          if (tw) { g.fx.burst('ember', tw.x, 2.2, tw.z, 18, { vel: 1.6, up: -0.5, life: 0.8 }); g.fx.ring(tw.x, tw.z, 1.5, 0xff4a14, 0.6); }
        }
        ui.hazardNotice('🔥 Ember rain stuns a tower!');
        break;
      }
      case 'iceShield': case 'starShield':
        ui.hazardNotice('🛡 The boss raises a shield — lightning shreds it fastest!');
        audio.play('bell', { vol: 0.4 });
        break;
      case 'blizzard':
        ui.hazardNotice('❄ Boss blizzard! Tower fire rate reduced');
        break;
      case 'etherealPhase':
        ui.hazardNotice('👻 The Lich phases — physical damage useless!');
        break;
      case 'riftHop':
        g.fx.burst('star', ev.x, 1.2, ev.z, 20, { vel: 2.6, life: 0.6 });
        ui.hazardNotice('🌀 The Wyrm rifts forward!');
        break;
      case 'bonewall':
        ui.hazardNotice('🦴 The Necromancer shields nearby enemies');
        break;
    }
  }

  // ---------- win/lose ----------
  function onWin() {
    if (g.resultShown) return;
    g.resultShown = true;
    const stars = g.sim.stars();
    recordResult(g.bi, g.li, stars);
    mergeCounters();
    const fresh = evaluateAchievements();
    saveProfile();
    audio.playMusic('victory');
    setTimeout(() => {
      ui.showResults({
        won: true, stars, sim: g.sim, endless: false,
        onNext: nextLevelTarget() ? () => { const [b, l] = nextLevelTarget(); g.loadLevel(b, l); } : null,
        onReplay: () => g.loadLevel(g.bi, g.li, g.endless),
        onMap: () => quitToMap(),
      });
      for (const a of fresh) ui.toast(`🏅 <b>${a.name}</b><br>${a.desc}`, true);
    }, 1400);
  }

  function onLose() {
    if (g.resultShown) return;
    g.resultShown = true;
    let bestWave = 0;
    if (g.endless) {
      recordEndless(g.bi, g.sim.waveIdx + 1);
      bestWave = loadProfile().endlessBest[g.bi];
    }
    mergeCounters();
    const fresh = evaluateAchievements();
    saveProfile();
    audio.playMusic('defeat');
    setTimeout(() => {
      ui.showResults({
        won: false, stars: 0, sim: g.sim, endless: g.endless, bestWave,
        onReplay: () => g.loadLevel(g.bi, g.li, g.endless),
        onMap: () => quitToMap(),
      });
      for (const a of fresh) ui.toast(`🏅 <b>${a.name}</b><br>${a.desc}`, true);
    }, 1400);
  }

  function mergeCounters() {
    const p = loadProfile();
    const s = g.sim.stats;
    const c = p.counters;
    c.kills += s.kills; c.burns += s.burnsApplied; c.freezes += s.freezeProcs;
    c.chains += s.chainHits; c.poisonTicks += Math.round(s.poisonTicks); c.sold += s.sold;
    if (g.sim.phase === 'won') {
      c.wins += 1;
      if (g.sim.stars() >= 3) c.flawlessWins += 1;
    }
    const types = new Set(c.typesBuilt);
    const maxed = new Set(c.maxedTypes);
    for (const tw of g.sim.towers) {
      types.add(tw.type);
      if (tw.level === 2) maxed.add(tw.type);
    }
    // also count sold/dead towers via stats events — towers list is fine for most
    c.typesBuilt = [...types]; c.maxedTypes = [...maxed];
  }

  function nextLevelTarget() {
    if (g.endless) return null;
    if (g.li < 8) return [g.bi, g.li + 1];
    if (g.bi < 4) return [g.bi + 1, 0];
    return null;
  }

  function quitToMap() {
    g.running = false;
    clearScene();
    scene.fog = null;
    scene.background = new THREE.Color(0x0a1220);
    ui.hideHud();
    env.onSceneIdle?.();
    ui.showLevels(g.bi);
  }
  g.quitToMap = quitToMap;

  // ---------- input ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function pointerCell(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!ray.ray.intersectPlane(groundPlane, pt)) return null;
    const { cx, cy } = worldToCell(pt.x, pt.z);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return null;
    return { cx, cy, x: pt.x, z: pt.z };
  }

  function updateGhost() {
    if (!g.selection.buildType || !g.hoverCell) {
      if (g.ghost) { scene.remove(g.ghost.group); g.ghost = null; }
      if (!g.selection.towerId) g.rangeRing.visible = false;
      return;
    }
    const { cx, cy } = g.hoverCell;
    const w = cellToWorld(cx, cy);
    if (!g.ghost || g.ghost.type !== g.selection.buildType) {
      if (g.ghost) scene.remove(g.ghost.group);
      const group = buildTowerMesh(g.selection.buildType, 0);
      group.traverse((n) => {
        if (n.isMesh) {
          n.material = n.material.clone();
          n.material.transparent = true;
          n.material.opacity = 0.55;
          n.castShadow = false;
        }
      });
      scene.add(group);
      g.ghost = { group, type: g.selection.buildType };
    }
    g.ghost.group.position.set(w.x, 0, w.z);
    const ok = g.sim.canBuild(cx, cy).ok && g.sim.gold >= TOWERS[g.selection.buildType].cost;
    g.ghost.group.traverse((n) => {
      if (n.isMesh && n.material.color) {
        if (!n.userData._baseCol) n.userData._baseCol = n.material.color.getHex();
        n.material.color.setHex(ok ? n.userData._baseCol : 0xdd3333);
      }
    });
    const def = TOWERS[g.selection.buildType];
    g.rangeRing.visible = true;
    g.rangeRing.position.set(w.x, 0.1, w.z);
    g.rangeRing.scale.setScalar(def.range[0]);
    g.rangeRing.material.color.setHex(ok ? 0xd8b04a : 0xcc4433);
  }

  function pickTower(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const meshes = [...g.towerMeshes.values()];
    const hits = ray.intersectObjects(meshes, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.towerId == null) o = o.parent;
      if (o) return o.userData.towerId;
    }
    return null;
  }

  let downPos = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    downPos = [ev.clientX, ev.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    audio.unlock();
    if (ev.button !== 0 || !g.running || g.paused) return;
    if (downPos && Math.hypot(ev.clientX - downPos[0], ev.clientY - downPos[1]) > 7) return; // drag = camera
    if (g.selection.buildType) {
      const cell = pointerCell(ev);
      if (cell) {
        const res = g.sim.placeTower(g.selection.buildType, cell.cx, cell.cy);
        if (!res.ok) {
          audio.play('ui_error', { vol: 0.5 });
          ui.toast(`Cannot build: <b>${res.reason}</b>`);
        } else if (!ev.shiftKey) {
          g.selection.buildType = null;
        }
      }
      return;
    }
    const towerId = pickTower(ev);
    if (towerId != null) {
      g.selection.towerId = towerId;
      audio.play('ui_select', { vol: 0.4 });
    } else {
      g.selection.towerId = null;
    }
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    g.hoverCell = pointerCell(ev);
  });
  renderer.domElement.addEventListener('contextmenu', (ev) => {
    if (g.selection.buildType) { ev.preventDefault(); g.selection.buildType = null; }
  });

  window.addEventListener('keydown', (ev) => {
    if (!g.running) return;
    if (ev.key === 'Escape') {
      if (g.selection.buildType) g.selection.buildType = null;
      else if (g.selection.towerId) g.selection.towerId = null;
      else handlers.pause();
    }
    const n = parseInt(ev.key, 10);
    if (n >= 1 && n <= 8) {
      const tid = TOWER_ORDER[n - 1];
      if (g.endless || isTowerUnlocked(tid, g.bi, g.li)) handlers.selectBuild(tid);
    }
    if (ev.key === ' ') {
      ev.preventDefault();
      if (g.sim && (g.sim.phase === 'idle' || g.sim.phase === 'prep')) handlers.startWave();
    }
    if (ev.key === 'u' && g.selection.towerId) handlers.upgrade(g.selection.towerId);
    if (ev.key === 'x' && g.selection.towerId) handlers.sell(g.selection.towerId);
    if (ev.key === 'r' || ev.key === 'R') engine.resetView();
  });

  // ---------- UI handlers ----------
  const handlers = {
    startLevel: (bi, li, endless) => g.loadLevel(bi, li, endless),
    selectBuild(tid) {
      if (g.selection.buildType === tid) { g.selection.buildType = null; return; }
      g.selection.buildType = tid;
      g.selection.towerId = null;
      audio.play('ui_click', { vol: 0.4 });
    },
    startWave() {
      const r = g.sim?.startWave();
      if (r?.ok) audio.play('ui_confirm', { vol: 0.5 });
    },
    setSpeed(n) { g.speed = n; g.usedSpeeds.add(n); },
    pause() {
      if (!g.running || g.resultShown) return;
      g.paused = true;
      ui.showPause(() => { g.paused = false; });
    },
    restart() { g.loadLevel(g.bi, g.li, g.endless); },
    quitToMap,
    upgrade(id) {
      const r = g.sim.upgradeTower(id);
      if (!r.ok) { audio.play('ui_error', { vol: 0.4 }); }
    },
    sell(id) {
      g.sim.sellTower(id);
      g.selection.towerId = null;
    },
    setTargetMode(id, mode) { g.sim.setTargetMode(id, mode); audio.play('ui_select', { vol: 0.4 }); },
    sfx: (name) => audio.play(name, { vol: 0.5 }),
    music: (track) => audio.playMusic(track),
    setMusicVol: (v) => { audio.setMusicVolume(v); loadProfile().settings.music = v; },
    setSfxVol: (v) => { audio.setSfxVolume(v); loadProfile().settings.sfx = v; },
    setQuality: (q) => { engine.setQuality(q); loadProfile().settings.quality = q; },
    saveSettings: () => saveProfile(),
    resetProgress: () => { env.resetProfile(); },
  };
  g.handlers = handlers;

  // ---------- frame loop ----------
  g.frame = (rdt) => {
    g.viewT += rdt;
    if (g.running && g.sim && !g.paused && !g.resultShown) {
      g.timeAcc += Math.min(rdt, 0.25) * g.speed;
      let steps = 0;
      while (g.timeAcc >= DT && steps < 40) {
        g.sim.step(DT);
        g.timeAcc -= DT;
        steps++;
      }
      handleEvents(g.sim.drainEvents());
      syncTowers();
      syncProjectiles();
      g.enemyLayer?.sync(g.sim, rdt * g.speed, g.viewT);
      updateGhost();
      // tower idle anims + selection ring
      for (const [id, mesh] of g.towerMeshes) animateTower(mesh, g.viewT, rdt);
      if (g.selection.towerId && !g.selection.buildType) {
        const tw = g.sim.towers.find((t) => t.id === g.selection.towerId);
        if (tw) {
          g.rangeRing.visible = true;
          g.rangeRing.position.set(tw.x, 0.1, tw.z);
          g.rangeRing.scale.setScalar(g.sim.effRange(tw));
          g.rangeRing.material.color.setHex(tw.type === 'banner' ? 0xe0b64f : 0x8fd4ff);
        } else {
          g.selection.towerId = null;
          g.rangeRing.visible = false;
        }
      } else if (!g.selection.buildType) {
        g.rangeRing.visible = false;
      }
      // vent warn pulse
      for (const v of g.ventMarkers) {
        v.mesh.material.opacity = v.warn ? 0.45 + Math.sin(g.viewT * 10) * 0.3 : 0.3;
      }
      // portal spin + gate shimmer + marching path chevrons
      if (g.world) {
        g.world.portal.userData.spin.rotation.z = g.viewT * 1.2;
        const barrier = g.world.gate.userData.spin;
        if (barrier?.material) barrier.material.opacity = 0.22 + Math.sin(g.viewT * 2.4) * 0.09;
        if (g.world.arrows) {
          const total = g.world.routeTotal;
          for (const a of g.world.arrows) {
            a.offset = (a.offset + rdt * 2.2) % total;
            const p = posAlong(g.level.route, a.offset);
            a.mesh.position.set(p.x, 0.08, p.z);
            a.mesh.rotation.z = -Math.atan2(p.dz, p.dx);
            const k = (a.offset % 9) / 9;
            a.mesh.material.opacity = 0.28 + 0.3 * Math.sin(k * Math.PI);
          }
        }
      }
      g.critters?.update(rdt, g.viewT);
      g.fx?.update(rdt * Math.min(g.speed, 2), g.viewT);
      ui.updateHud(g.sim, g.selection);
    } else {
      // results screen: keep burying corpses + finishing FX (paused stays frozen)
      if (g.resultShown && g.sim && g.enemyLayer) g.enemyLayer.sync(g.sim, rdt, g.viewT);
      if (!g.paused) g.fx?.update(rdt, g.viewT);
    }
  };

  return g;
}

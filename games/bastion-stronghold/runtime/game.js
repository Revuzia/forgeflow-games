// Stronghold game controller: level lifecycle, input, fixed-step loop,
// bastion damage states, event -> FX/audio wiring.
import * as THREE from 'three';
import { createSim, DT } from './sim/sim.js';
import { levelDef } from './data/levels.js';
import { GRID_W, GRID_H, CELL, cellToWorld, worldToCell, posAlong } from './sim/map.js';
import { TOWERS, TOWER_ORDER, isTowerUnlocked } from './data/towers.js';
import { enemyDef } from './data/enemies.js';
import { buildWorld } from './view/world3d.js';
import { createEnemyLayer } from './view/enemies3d.js';
import { buildTowerMesh, animateTower, aimTower, buildBastion, M } from './view/models.js';
import { createFx } from './view/fx.js';
import { lightRig } from './core/engine3d.js';
import { loadProfile, saveProfile, recordResult, recordEndless } from './core/save.js';
import { evaluateAchievements } from './data/achievements.js';

export function createGame(env) {
  const { engine, ui, audio } = env;
  const { scene, camera, renderer } = engine;

  const g = {
    sim: null, level: null, wi: 0, li: 0, endless: false,
    speed: 1, paused: false, running: false, resultShown: false,
    selection: { buildType: null, towerId: null },
    towerMeshes: new Map(), projMeshes: new Map(), zoneMeshes: new Map(), cartMeshes: new Map(),
    enemyLayer: null, fx: null, world: null, lights: null, bastion: null,
    bastionFires: [],
    ghost: null, rangeRing: null, hoverCell: null,
    timeAcc: 0, viewT: 0,
  };

  // ---------- scene lifecycle ----------
  function clearScene() {
    for (const m of g.towerMeshes.values()) scene.remove(m);
    g.towerMeshes.clear();
    for (const m of g.projMeshes.values()) scene.remove(m.mesh);
    g.projMeshes.clear();
    for (const m of g.zoneMeshes.values()) scene.remove(m);
    g.zoneMeshes.clear();
    for (const m of g.cartMeshes.values()) scene.remove(m);
    g.cartMeshes.clear();
    g.enemyLayer?.clear();
    if (g.enemyLayer) scene.remove(g.enemyLayer.group);
    if (g.world) scene.remove(g.world.group);
    if (g.bastion) scene.remove(g.bastion.group);
    if (g.lights) scene.remove(g.lights);
    if (g.ghost) { scene.remove(g.ghost.group); g.ghost = null; }
    if (g.rangeRing) { scene.remove(g.rangeRing); g.rangeRing = null; }
    g.bastionFires = [];
    const leftovers = scene.children.filter((c) => c.type === 'Points' || c.type === 'Line' || c.type === 'Sprite' || c.type === 'Mesh');
    for (const c of leftovers) scene.remove(c);
    g.fx = null;
  }

  g.loadLevel = (wi, li, endless = false) => {
    env.onSceneBusy?.();
    clearScene();
    g.wi = wi; g.li = li; g.endless = endless;
    g.level = levelDef(wi, li);
    g.sim = createSim(wi, li, { endless });
    g.selection = { buildType: null, towerId: null };
    g.speed = 1; g.paused = false; g.resultShown = false;
    g.timeAcc = 0;

    engine.resetView();
    g.lights = lightRig(scene, {
      ambient: g.level.world.palette.ambient, sky: g.level.world.palette.sky,
      ground: { dark: g.level.world.palette.roadEdge },
      sun: g.level.world.palette.sun, sunIntensity: g.level.world.palette.sunIntensity,
    });
    g.world = buildWorld(scene, g.level);
    g.bastion = buildBastion(g.level.world.bastion);
    scene.add(g.bastion.group);
    g.enemyLayer = createEnemyLayer(scene);
    g.fx = createFx(scene, { particles: g.level.world.particles });

    g.rangeRing = makeRing();
    scene.add(g.rangeRing);

    ui.showHud({ wi, li, endless, level: g.level });
    ui.updateHud(g.sim, g.selection);
    ui.banner(endless ? 'ENDLESS SIEGE' : g.level.world.name, endless ? g.level.world.name : g.level.name, 2.6);
    audio.playMusic(g.level.world.music);
    if (g.level.hazard) {
      setTimeout(() => ui.hazardNotice(`⚠ ${g.level.hazard.name}: ${g.level.hazard.desc}`, g.level.hazard.id === 'minecarts', 5), 2400);
    }
    g.running = true;
  };

  function makeRing() {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xd8a850, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.1;
    m.visible = false;
    m.renderOrder = 12;
    return m;
  }

  // ---------- views sync ----------
  function syncTowers() {
    for (const tw of g.sim.towers) {
      let mesh = g.towerMeshes.get(tw.id);
      if (!mesh || mesh.userData.level !== tw.level) {
        if (mesh) scene.remove(mesh);
        mesh = buildTowerMesh(tw.type, tw.level);
        mesh.position.set(tw.x, 0, tw.z);
        mesh.userData.towerId = tw.id;
        mesh.userData.level = tw.level;
        scene.add(mesh);
        g.towerMeshes.set(tw.id, mesh);
      }
    }
    for (const [id, mesh] of g.towerMeshes) {
      if (!g.sim.towers.some((t) => t.id === id)) { scene.remove(mesh); g.towerMeshes.delete(id); }
    }
  }

  const projGeo = {
    missile: new THREE.OctahedronGeometry(0.14),
    oilpot: new THREE.SphereGeometry(0.17, 8, 6),
  };
  const projMat = {
    missile: new THREE.MeshBasicMaterial({ color: 0xc89aff }),
    oilpot: new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 0.6 }),
  };
  function syncProjectiles() {
    const seen = new Set();
    for (const pr of g.sim.projectiles) {
      seen.add(pr.id);
      let pv = g.projMeshes.get(pr.id);
      if (!pv) {
        const mesh = new THREE.Mesh(projGeo[pr.kind], projMat[pr.kind]);
        scene.add(mesh);
        pv = { mesh, sx: pr.x, sz: pr.z, kind: pr.kind, curve: pr.curve || 0 };
        g.projMeshes.set(pr.id, pv);
      }
      const t = Math.max(0, Math.min(1, pr.t / pr.flight));
      let tx, tz;
      if (pr.kind === 'missile') {
        const target = g.sim.enemies.find((e) => e.id === pr.targetId);
        if (target) { const p = g.sim.enemyPos(target); tx = p.x; tz = p.z; pv.lx = tx; pv.lz = tz; }
        else { tx = pv.lx ?? pv.sx; tz = pv.lz ?? pv.sz; }
      } else { tx = pr.aim.x; tz = pr.aim.z; }
      const x = pv.sx + (tx - pv.sx) * t;
      const z = pv.sz + (tz - pv.sz) * t;
      // curl for missiles, arc for pots
      const perp = pv.curve * Math.sin(Math.PI * t);
      const dx = tz - pv.sz, dz = -(tx - pv.sx);
      const dl = Math.hypot(dx, dz) || 1;
      const y = pr.kind === 'oilpot'
        ? 1.5 + Math.sin(Math.PI * t) * Math.min(4, Math.hypot(tx - pv.sx, tz - pv.sz) * 0.3)
        : 2.0 + Math.sin(Math.PI * t) * 0.6;
      pv.mesh.position.set(x + (dx / dl) * perp, y, z + (dz / dl) * perp);
      if (pr.kind === 'missile') g.fx.burst('arcane', pv.mesh.position.x, pv.mesh.position.y, pv.mesh.position.z, 1, { vel: 0.2, up: 0, life: 0.3, spread: 0.08 });
      else g.fx.burst('smoke', pv.mesh.position.x, pv.mesh.position.y, pv.mesh.position.z, 1, { vel: 0.1, up: 0.3, life: 0.4, spread: 0.08 });
    }
    for (const [id, pv] of g.projMeshes) {
      if (!seen.has(id)) { scene.remove(pv.mesh); g.projMeshes.delete(id); }
    }
  }

  function syncZones() {
    const seen = new Set();
    for (const z of g.sim.zones) {
      seen.add(z.id);
      if (!g.zoneMeshes.has(z.id)) {
        const m = new THREE.Mesh(
          new THREE.CircleGeometry(z.r, 20),
          new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.4, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(z.x, 0.05, z.z);
        m.renderOrder = 8;
        scene.add(m);
        g.zoneMeshes.set(z.id, m);
      }
      const m = g.zoneMeshes.get(z.id);
      const left = z.until - g.sim.time;
      m.material.opacity = Math.min(0.42, left * 0.3);
      if (Math.random() < 0.3) g.fx.burst('flame', z.x + (Math.random() - 0.5) * z.r * 1.4, 0.2, z.z + (Math.random() - 0.5) * z.r * 1.4, 1, { vel: 0.3, up: 1.4, life: 0.5 });
    }
    for (const [id, m] of g.zoneMeshes) {
      if (!seen.has(id)) { scene.remove(m); g.zoneMeshes.delete(id); }
    }
  }

  function syncCarts() {
    const seen = new Set();
    for (const c of g.sim.carts) {
      seen.add(c.id);
      if (!g.cartMeshes.has(c.id)) {
        const cart = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.0), M(0x5a4636));
        body.position.y = 0.5;
        cart.add(body);
        const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), M(0xff8028, { emissive: 0xff6a14, ei: 1 }));
        ore.position.y = 0.8;
        cart.add(ore);
        for (const sz of [-0.3, 0.3]) for (const sx of [-0.38, 0.38]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), M(0x2e2a26));
          w.rotation.z = Math.PI / 2;
          w.position.set(sx, 0.16, sz);
          cart.add(w);
        }
        scene.add(cart);
        g.cartMeshes.set(c.id, cart);
      }
      const cart = g.cartMeshes.get(c.id);
      const route = g.level.map.routes[c.roadIdx];
      const p = posAlong(route, c.dist);
      cart.position.set(p.x, 0, p.z);
      cart.rotation.y = Math.atan2(p.dx, p.dz);
      g.fx.burst('scrap', p.x, 0.5, p.z, 1, { vel: 0.6, up: 0.5, life: 0.3 });
    }
    for (const [id, m] of g.cartMeshes) {
      if (!seen.has(id)) { scene.remove(m); g.cartMeshes.delete(id); }
    }
  }

  // bastion damage-tier fire emitters
  function syncBastionTier() {
    const tier = g.sim.bastionTier();
    if (g.bastion.tier !== tier) g.bastion.setTier(tier);
    const wantFires = tier >= 2 ? (tier >= 3 ? 4 : 2) : 0;
    g.bastionFires = g.bastion.fireAnchors.slice(0, wantFires);
  }

  // ---------- events ----------
  function towerMuzzle(towerId) {
    const mesh = g.towerMeshes.get(towerId);
    if (!mesh) return null;
    const node = mesh.userData?.muzzle;
    if (!node) return new THREE.Vector3(mesh.position.x, 1.8, mesh.position.z);
    const v = new THREE.Vector3();
    node.getWorldPosition(v);
    return v;
  }

  function handleEvents(events) {
    for (const ev of events) {
      switch (ev.kind) {
        case 'pierce': {
          const mesh = g.towerMeshes.get(ev.towerId);
          if (mesh) aimTower(mesh, ev.x + ev.nx * 4, ev.z + ev.nz * 4);
          g.fx.lightning([
            { x: ev.x, y: 1.6, z: ev.z },
            { x: ev.x + ev.nx * ev.dist, y: 1.0, z: ev.z + ev.nz * ev.dist },
          ], 0xe0b070);
          g.fx.burst('scrap', ev.x + ev.nx * ev.dist * 0.6, 1, ev.z + ev.nz * ev.dist * 0.6, 3, { vel: 1.4, life: 0.3 });
          audio.play('ballista', { throttle: 90 });
          break;
        }
        case 'shot': {
          const mesh = g.towerMeshes.get(ev.towerId);
          if (mesh) aimTower(mesh, ev.tx, ev.tz);
          const m = towerMuzzle(ev.towerId);
          if (m) g.fx.burst(ev.type === 'cauldron' ? 'oil' : 'arcane', m.x, m.y, m.z, 3, { vel: 0.8, up: 0.5, life: 0.25, spread: 0.14 });
          audio.play(ev.type === 'cauldron' ? 'oilThrow' : 'arcane', { throttle: 110 });
          break;
        }
        case 'snipe': {
          const m = towerMuzzle(ev.towerId);
          if (m) g.fx.lightning([{ x: m.x, y: m.y, z: m.z }, { x: ev.tx, y: 1.1, z: ev.tz }], ev.crit ? 0xffd76a : 0xffffff);
          g.fx.burst('spark', ev.tx, 1.2, ev.tz, ev.crit ? 9 : 5, { vel: 2, life: 0.3 });
          audio.play('crossbow');
          break;
        }
        case 'chain': {
          const pts = ev.points.map((p, i) => ({ x: p.x, y: i === 0 ? 2.4 : 1.2, z: p.z }));
          g.fx.lightning(pts, 0x78d8ff);
          for (let i = 1; i < pts.length; i++) g.fx.burst('spark', pts[i].x, 1.2, pts[i].z, 4, { vel: 1.6, life: 0.3 });
          audio.play('stormZap', { throttle: 120 });
          break;
        }
        case 'missileHit':
          g.fx.burst('arcane', ev.x, 1.1, ev.z, 7, { vel: 1.8, life: 0.35 });
          audio.play('missileHit', { throttle: 100 });
          break;
        case 'oilSplash':
          g.fx.ring(ev.x, ev.z, ev.r, 0xff7a20, 0.5);
          g.fx.burst('flame', ev.x, 0.5, ev.z, 14, { vel: 2.4, up: 2, life: 0.5, spread: 0.6 });
          audio.play('oilSplash');
          break;
        case 'runeBlast':
          g.fx.ring(ev.x, ev.z, ev.r, 0x5ad8e8, 0.55);
          g.fx.burst('runic', ev.x, 0.6, ev.z, 18, { vel: 3, up: 2.4, life: 0.5 });
          audio.play('runeBlast');
          break;
        case 'hit': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e && ev.amount >= 1) {
            const p = g.sim.enemyPos(e);
            const col = ev.crit ? '#ffd76a' : ev.dmgType === 'magic' ? '#c89aff' : ev.dmgType === 'fire' ? '#ff9a3a'
              : ev.dmgType === 'holy' ? '#ffe9a0' : ev.dmgType === 'nature' ? '#8fd435' : '#e8dcc0';
            g.fx.number(p.x, 2.1, p.z, String(Math.round(ev.amount)), col, !!ev.crit);
            g.fx.burst(ev.dmgType === 'magic' ? 'arcane' : 'scrap', p.x, 1.1, p.z, 2, { vel: 1.2, life: 0.28, spread: 0.25 });
          }
          break;
        }
        case 'immune': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e) { const p = g.sim.enemyPos(e); g.fx.number(p.x, 2.3, p.z, 'IMMUNE', '#a0a8b8'); }
          break;
        }
        case 'shieldHit': audio.play('missileHit', { throttle: 150 }); break;
        case 'shieldBreak': {
          const e = g.sim.enemies.find((x) => x.id === ev.enemyId);
          if (e) { const p = g.sim.enemyPos(e); g.fx.burst('spark', p.x, 1.3, p.z, 14, { vel: 3, life: 0.5 }); }
          audio.play('runeBlast', { throttle: 200 });
          break;
        }
        case 'death': {
          g.enemyLayer.kill(ev.enemyId, false);
          g.fx.burst('scrap', ev.x, 0.9, ev.z, ev.boss ? 26 : 8, { vel: ev.boss ? 3.2 : 1.8, life: 0.6 });
          g.fx.burst('gold', ev.x, 1.2, ev.z, 3, { vel: 1, up: 2, life: 0.5 });
          g.fx.number(ev.x, 1.6, ev.z, '+' + ev.bounty, '#ffd76a');
          if (ev.boss) { audio.play('bossDeath'); g.fx.ring(ev.x, ev.z, 4, 0xffd76a, 0.8); }
          else audio.play('deathClank', { pitch: ev.big ? 0.65 : 1.1, throttle: 130 });
          audio.play('coin', { throttle: 280 });
          break;
        }
        case 'split':
          g.fx.burst('arcane', ev.x, 0.8, ev.z, 12, { vel: 2.2, life: 0.5 });
          break;
        case 'breach': {
          g.enemyLayer.kill(ev.enemyId, true);
          ui.damageFlash();
          g.fx.burst('flame', 0, 1.5, 0, ev.detonator ? 30 : 12, { vel: 3, up: 2.5, life: 0.6, spread: 1.4 });
          g.fx.ring(0, 0, ev.detonator ? 5 : 3, 0xc03040, 0.6);
          audio.play('bastionHit');
          break;
        }
        case 'bastionTier':
          audio.play('bastionCrack');
          ui.hazardNotice(['', '🏰 The Bastion is scorched!', '🏰 The Bastion is battered — fires spread!', '🏰 THE BASTION IS CRUMBLING!'][ev.tier] || '', false, 3.5);
          break;
        case 'wave':
          ui.banner(`WAVE ${ev.idx + 1}`, ev.label || '', 1.6);
          audio.play('waveHorn');
          break;
        case 'waveEnd':
          ui.toast(`Wave ${ev.idx + 1} repelled <b>+🪙${ev.bonus}</b>`);
          audio.play('coin');
          break;
        case 'build': {
          const w = cellToWorld(ev.cx, ev.cy);
          g.fx.burst('smoke', w.x, 0.4, w.z, 8, { vel: 1.4, up: 1, life: 0.5, spread: 0.6 });
          g.fx.ring(w.x, w.z, 1.2, 0xd8a850, 0.4);
          audio.play('build');
          break;
        }
        case 'upgrade': {
          const tw = g.sim.towers.find((t) => t.id === ev.towerId);
          if (tw) { g.fx.ring(tw.x, tw.z, 1.4, 0xffd76a, 0.5); g.fx.burst('gold', tw.x, 1.4, tw.z, 10, { vel: 1.6, up: 2, life: 0.6 }); }
          audio.play('upgrade');
          break;
        }
        case 'sell': {
          const w = cellToWorld(ev.cx, ev.cy);
          g.fx.burst('gold', w.x, 1, w.z, 8, { vel: 1.6, up: 2.2, life: 0.5 });
          audio.play('sell');
          break;
        }
        case 'ability': handleAbilityFx(ev); break;
        case 'hazard': handleHazardFx(ev); break;
        case 'win': onWin(); break;
        case 'lose': onLose(); break;
      }
    }
  }

  function handleAbilityFx(ev) {
    const notices = {
      rallyCry: '📯 Rally cry! The horde surges forward',
      shieldWall: '🛡 The boss raises a shield wall',
      ironPlates: '🛡 Iron plates bolt into place',
      windShield: '🛡 A wind shield swirls around the Leviathan',
      platingShield: '🛡 The Engine bolts on plating',
      summonRams: '⚠ Battering rams roll out!',
      summonRays: '⚠ Cloud rays dive from above!',
      summonSkitterers: '⚠ Shards skitter loose!',
      deployKegs: '💣 POWDER KEGS DEPLOYED!',
      prismPhase: ev.phase === 'magic' ? '⬜ The Prism is IMMUNE TO PHYSICAL — use magic!' : '⬛ The Prism is IMMUNE TO MAGIC — use steel!',
      overdrive: '🔥 The Engine overdrives!',
    };
    if (notices[ev.name]) ui.hazardNotice(notices[ev.name]);
    g.fx.burst('arcane', ev.x, 1.4, ev.z, 14, { vel: 2.2, life: 0.5 });
  }

  function handleHazardFx(ev) {
    switch (ev.id) {
      case 'gateRelease': {
        const gate = g.world.gates[ev.roadIdx];
        if (gate) g.fx.ring(gate.position.x, gate.position.z, 2.4, 0xd03030, 0.7);
        ui.hazardNotice('⚔ The arena gates release a bonus squad!');
        audio.play('waveHorn');
        break;
      }
      case 'lightning': {
        g.fx.lightning([{ x: ev.x, y: 14, z: ev.z }, { x: ev.x, y: 1, z: ev.z }], 0xbfe8ff);
        g.fx.burst('spark', ev.x, 1.5, ev.z, 16, { vel: 3, life: 0.5 });
        ui.hazardNotice('⚡ Lightning stuns a tower!');
        audio.play('lightning');
        break;
      }
      case 'tailwind':
        ui.hazardNotice('💨 Tailwind! Enemies surge forward');
        break;
      case 'minecarts':
        ui.hazardNotice('🛒 Runaway cart! It crushes everything on its road', true);
        audio.play('cartRumble');
        break;
    }
  }

  // ---------- win/lose ----------
  function onWin() {
    if (g.resultShown) return;
    g.resultShown = true;
    const stars = g.sim.stars();
    recordResult(g.wi, g.li, stars);
    mergeCounters();
    const fresh = evaluateAchievements();
    saveProfile();
    audio.playMusic('victory');
    setTimeout(() => {
      ui.showResults({
        won: true, stars, sim: g.sim, endless: false,
        onNext: nextTarget() ? () => { const [w2, l2] = nextTarget(); g.loadLevel(w2, l2); } : null,
        onReplay: () => g.loadLevel(g.wi, g.li, g.endless),
        onMap: () => quitToMap(),
      });
      for (const a of fresh) ui.toast(`🎖️ <b>${a.name}</b><br>${a.desc}`, true);
    }, 1400);
  }
  function onLose() {
    if (g.resultShown) return;
    g.resultShown = true;
    let bestWave = 0;
    if (g.endless) { recordEndless(g.wi, g.sim.waveIdx + 1); bestWave = loadProfile().endlessBest[g.wi]; }
    mergeCounters();
    const fresh = evaluateAchievements();
    saveProfile();
    audio.playMusic('defeat');
    setTimeout(() => {
      ui.showResults({
        won: false, stars: 0, sim: g.sim, endless: g.endless, bestWave,
        onReplay: () => g.loadLevel(g.wi, g.li, g.endless),
        onMap: () => quitToMap(),
      });
      for (const a of fresh) ui.toast(`🎖️ <b>${a.name}</b><br>${a.desc}`, true);
    }, 1400);
  }
  function mergeCounters() {
    const p = loadProfile();
    const s = g.sim.stats;
    const c = p.counters;
    c.kills += s.kills; c.pierces += s.pierceHits; c.runeBlasts += s.runeBlasts;
    c.chains += s.chainHits; c.repairs += Math.round(s.repairs); c.sold += s.sold;
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
    c.typesBuilt = [...types]; c.maxedTypes = [...maxed];
  }
  function nextTarget() {
    if (g.endless) return null;
    if (g.li < 8) return [g.wi, g.li + 1];
    if (g.wi < 4) return [g.wi + 1, 0];
    return null;
  }
  function quitToMap() {
    g.running = false;
    clearScene();
    scene.fog = null;
    scene.background = new THREE.Color(0x14100c);
    ui.hideHud();
    env.onSceneIdle?.();
    ui.showLevels(g.wi);
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
    return { cx, cy };
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
    const ok = g.sim.canBuild(g.selection.buildType, cx, cy).ok && g.sim.gold >= TOWERS[g.selection.buildType].cost;
    g.ghost.group.traverse((n) => {
      if (n.isMesh && n.material.color) {
        if (!n.userData._bc) n.userData._bc = n.material.color.getHex();
        n.material.color.setHex(ok ? n.userData._bc : 0xdd3333);
      }
    });
    const def = TOWERS[g.selection.buildType];
    g.rangeRing.visible = true;
    g.rangeRing.position.set(w.x, 0.1, w.z);
    g.rangeRing.scale.setScalar(Math.max(1.2, def.range[0]));
    g.rangeRing.material.color.setHex(ok ? 0xd8a850 : 0xcc4433);
  }

  function pickTower(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...g.towerMeshes.values()], true);
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
    if (downPos && Math.hypot(ev.clientX - downPos[0], ev.clientY - downPos[1]) > 7) return;
    if (g.selection.buildType) {
      const cell = pointerCell(ev);
      if (cell) {
        const res = g.sim.placeTower(g.selection.buildType, cell.cx, cell.cy);
        if (!res.ok) {
          audio.play('uiError');
          ui.toast(`Cannot build: <b>${res.reason}</b>`);
        } else if (!ev.shiftKey) g.selection.buildType = null;
      }
      return;
    }
    const towerId = pickTower(ev);
    g.selection.towerId = towerId;
    if (towerId != null) audio.play('uiTap');
  });
  renderer.domElement.addEventListener('pointermove', (ev) => { g.hoverCell = pointerCell(ev); });

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
      if (g.endless || isTowerUnlocked(tid, g.wi, g.li)) handlers.selectBuild(tid);
    }
    if (ev.key === ' ') {
      ev.preventDefault();
      if (g.sim && (g.sim.phase === 'idle' || g.sim.phase === 'prep')) handlers.startWave();
    }
    if (ev.key === 'u' && g.selection.towerId) handlers.upgrade(g.selection.towerId);
    if (ev.key === 'x' && g.selection.towerId) handlers.sell(g.selection.towerId);
    if (ev.key === 'r' || ev.key === 'R') engine.resetView();
  });

  // ---------- handlers ----------
  const handlers = {
    startLevel: (wi, li, endless) => g.loadLevel(wi, li, endless),
    selectBuild(tid) {
      if (g.selection.buildType === tid) { g.selection.buildType = null; return; }
      g.selection.buildType = tid;
      g.selection.towerId = null;
      audio.play('uiTap');
    },
    startWave() {
      const r = g.sim?.startWave();
      if (r?.ok) audio.play('uiTap');
    },
    setSpeed(n) { g.speed = n; },
    pause() {
      if (!g.running || g.resultShown) return;
      g.paused = true;
      ui.showPause(() => { g.paused = false; });
    },
    restart() { g.loadLevel(g.wi, g.li, g.endless); },
    quitToMap,
    upgrade(id) { if (!g.sim.upgradeTower(id).ok) audio.play('uiError'); },
    sell(id) { g.sim.sellTower(id); g.selection.towerId = null; },
    setTargetMode(id, mode) { g.sim.setTargetMode(id, mode); audio.play('uiTap'); },
    sfx: (name) => audio.play(name),
    music: (track) => audio.playMusic(track),
    setMusicVol: (v) => { audio.setMusicVolume(v); loadProfile().settings.music = v; },
    setSfxVol: (v) => { audio.setSfxVolume(v); loadProfile().settings.sfx = v; },
    setQuality: (q) => { engine.setQuality(q); loadProfile().settings.quality = q; },
    saveSettings: () => saveProfile(),
    resetProgress: () => env.resetProfile(),
  };
  g.handlers = handlers;

  // ---------- frame ----------
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
      syncZones();
      syncCarts();
      syncBastionTier();
      g.enemyLayer?.sync(g.sim, rdt * g.speed, g.viewT);
      updateGhost();
      for (const mesh of g.towerMeshes.values()) animateTower(mesh, g.viewT);
      g.bastion?.animate(g.viewT);
      // burning bastion
      for (const a of g.bastionFires) {
        if (Math.random() < 0.35) g.fx.burst('flame', a.x, a.y, a.z, 1, { vel: 0.4, up: 1.6, life: 0.5 });
        if (Math.random() < 0.2) g.fx.burst('smoke', a.x, a.y + 0.4, a.z, 1, { vel: 0.3, up: 1.2, life: 1.1 });
      }
      // selection ring
      if (g.selection.towerId && !g.selection.buildType) {
        const tw = g.sim.towers.find((t) => t.id === g.selection.towerId);
        if (tw) {
          g.rangeRing.visible = true;
          g.rangeRing.position.set(tw.x, 0.1, tw.z);
          g.rangeRing.scale.setScalar(Math.max(1.2, g.sim.effRange(tw)));
          g.rangeRing.material.color.setHex(0x8fd4ff);
        } else { g.selection.towerId = null; g.rangeRing.visible = false; }
      } else if (!g.selection.buildType) g.rangeRing.visible = false;
      // gates + arrows
      if (g.world) {
        for (const gate of g.world.gates) gate.userData.ring.rotation.z = g.viewT * 1.3;
        for (const a of g.world.arrows) {
          const route = g.level.map.routes[a.routeIdx];
          a.offset = (a.offset + rdt * 2.2) % route.total;
          const p = posAlong(route, a.offset);
          a.mesh.position.set(p.x, 0.06, p.z);
          a.mesh.rotation.z = -Math.atan2(p.dz, p.dx);
          a.mesh.material.opacity = 0.24 + 0.26 * Math.sin((a.offset % 9) / 9 * Math.PI);
        }
        // bobbing sky isles
        g.world.group.traverse((n) => {
          if (n.name === 'skyisle') n.position.y += Math.sin(g.viewT * 0.7 + n.userData.bobPhase) * 0.004;
        });
      }
      g.fx?.update(rdt * Math.min(g.speed, 2), g.viewT);
      ui.updateHud(g.sim, g.selection);
    } else {
      if (g.resultShown && g.sim && g.enemyLayer) g.enemyLayer.sync(g.sim, rdt, g.viewT);
      if (!g.paused) g.fx?.update(rdt, g.viewT);
    }
  };

  return g;
}

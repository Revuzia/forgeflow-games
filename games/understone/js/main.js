// Understone — boot + fixed-timestep game loop.
// Physics runs at 60 ticks/sec (Terraria-accurate); rendering is decoupled with interpolation.

export const TPS = 60;
export const TICK_MS = 1000 / TPS;
const MAX_CATCHUP_TICKS = 5; // spiral-of-death guard when tab was backgrounded

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

const bootFill = document.getElementById('boot-fill');
const bootMsg = document.getElementById('boot-msg');
export function bootProgress(frac, msg) {
  if (bootFill) bootFill.style.width = `${Math.round(frac * 100)}%`;
  if (bootMsg && msg) bootMsg.textContent = msg;
}
export function bootDone() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 450);
}

// --- game state registry (filled in by systems as they come online) ---
export const game = {
  canvas, ctx,
  tick: 0,           // world ticks elapsed
  updaters: [],      // fn(game) called once per tick, in order
  renderers: [],     // fn(game, alpha) called once per frame, in order
  paused: false,
};

let acc = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  acc += now - last;
  last = now;
  let ticks = 0;
  while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
    if (!game.paused) {
      for (const u of game.updaters) u(game);
      game.tick++;
    }
    acc -= TICK_MS;
    ticks++;
  }
  if (ticks === MAX_CATCHUP_TICKS) acc = 0; // drop backlog rather than freeze
  const alpha = acc / TICK_MS; // interpolation factor for renderers
  for (const r of game.renderers) r(game, alpha);
}

async function boot() {
  bootProgress(0.05, 'Waking the world…');
  const [{ initInput, consumeTick }, { World, TILES, T, W_ }, { generateWorld }, { Camera }, { Background }, { TileRenderer }, { Player }] =
    await Promise.all([
      import('./core/input.js'),
      import('./world/world.js'),
      import('./world/worldgen.js'),
      import('./render/camera.js'),
      import('./render/background.js'),
      import('./render/renderer.js'),
      import('./entities/player.js'),
    ]);
  const { Lighting } = await import('./world/lighting.js');
  const { Liquids } = await import('./world/liquids.js');
  const [{ ITEMS, STARTER_ITEMS }, { Inventory }, { Drops }, { HUD }, inputMod] = await Promise.all([
    import('./items/items.js'),
    import('./items/inventory.js'),
    import('./entities/drops.js'),
    import('./ui/hud.js'),
    import('./core/input.js'),
  ]);
  const [{ Spawner }, { Projectiles }, { Combat }, { summonBossFactory }, { loadAssets, makeTileDrawer, makeWallDrawer }] = await Promise.all([
    import('./entities/spawner.js'),
    import('./entities/projectile.js'),
    import('./entities/combat.js'),
    import('./entities/bosses.js'),
    import('./core/assets.js'),
  ]);

  const [{ Chests }, { FallingTiles }, saveMod] = await Promise.all([
    import('./items/chests.js'),
    import('./world/falling.js'),
    import('./core/save.js'),
  ]);
  game.save = saveMod;

  initInput(canvas);
  const world = new World();
  game.world = world;

  bootProgress(0.5, 'Painting the world…');
  const assets = await loadAssets();
  game.assets = assets;

  const camera = new Camera(world, canvas);
  game.camera = camera;
  const background = new Background(world, camera);
  const tileRenderer = new TileRenderer(world);
  tileRenderer.drawTileHook = makeTileDrawer(world, assets);
  tileRenderer.drawWallHook = makeWallDrawer(assets);
  game.tileRenderer = tileRenderer;

  const player = new Player(world);
  game.player = player;
  game.T = T; game.TILES = TILES;
  camera.follow(player);
  window.__US__ = game; // debug/verification handle (same convention as __FFG_GAME__)

  const chests = new Chests(world);
  world.chests = chests;
  const falling = new FallingTiles(world);
  game.falling = falling;

  // inventory / drops / HUD must exist before loadGame can restore into them
  const inventory = new Inventory();
  game.inventory = inventory;
  const drops = new Drops(world);
  game.drops = drops;
  const hud = new HUD(game, player, inventory);
  game.hud = hud;
  game.openChest = (tx, ty) => hud.openChest(tx, ty);

  // ---- title menu: New World / Continue -------------------------------------------
  bootProgress(1, 'Ready');
  bootDone();
  const choice = await showTitle(saveMod.hasSave());
  const bootEl2 = document.createElement('div');   // re-show a mini progress line
  bootEl2.id = 'genmsg';
  bootEl2.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,10,18,0.85);color:#cfd6e6;font:16px Segoe UI;z-index:90;';
  bootEl2.textContent = 'Shaping the world…';
  document.body.appendChild(bootEl2);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const liquids = new Liquids(world);
  game.liquids = liquids;

  if (choice === 'continue' && saveMod.loadGame(game)) {
    // world restored from save
  } else {
    generateWorld(world, () => {});
    chests.seedWorldLoot();
    player.respawn();
    for (const [id, n] of STARTER_ITEMS) inventory.add(id, n);
  }
  liquids.settleAll();
  camera.x = player.x; camera.y = player.y; camera.px = camera.x; camera.py = camera.y;
  bootEl2.remove();

  // dug tiles → world drops
  player.onDig.push((tx, ty, info, extra) => {
    if (extra?.wall) return;
    if (extra?.wood) {
      drops.spawnFromTile(tx, ty, 'wood', extra.wood);
      if (Math.random() < 0.5) drops.spawnFromTile(tx, ty, 'acorn', 1 + (Math.random() < 0.3 ? 1 : 0));
      return;
    }
    if (info.name === 'pot') {
      const roll = Math.random();
      if (roll < 0.45) inventory.money += 30 + (Math.random() * 120) | 0;
      else if (roll < 0.75) drops.spawnFromTile(tx, ty, 'torch', 3 + (Math.random() * 5) | 0);
      else drops.spawnFromTile(tx, ty, 'woodenArrow', 8 + (Math.random() * 12) | 0);
      return;
    }
    if (info.drops && ITEMS[info.drops]) drops.spawnFromTile(tx, ty, info.drops, 1);
  });

  // held item adapter: inventory slot → the shape player.updateTool expects
  const syncHeld = () => {
    const def = inventory.heldDef();
    if (!def) { player.heldItem = null; return; }
    player.heldItem = {
      name: def.name,
      type: def.tool ?? def.type,
      pickPower: def.pickPower, axePower: def.axePower, hammerPower: def.hammerPower,
      useTime: def.useTime ?? 20,
      damage: def.damage, knockback: def.knockback,
      placeTile: def.placeTile != null ? T[def.placeTile] : null,
      placeWall: def.placeWall != null ? W_[def.placeWall] : null,
      use: def.use, boss: def.boss, weapon: def.weapon, ammo: def.ammo,
      consume: (def.type === 'block' || def.type === 'wall' || def.type === 'consumable' || def.type === 'summon')
        ? () => inventory.consumeHeld(1) : null,
    };
  };

  game.updaters.push(() => {
    // hotbar selection: number keys + wheel
    const hb = inputMod.hotbarPressed();
    if (hb >= 0) { inventory.selected = hb; inventory.changed(); }
    if (inputMod.mouse.wheel !== 0 && !hud.open) {
      inventory.selected = (inventory.selected + inputMod.mouse.wheel + 10) % 10;
      inventory.changed();
    }
    if (inputMod.wasPressed('inventory')) hud.toggle();
    syncHeld();
  });
  // ---- combat: enemies, spawner, projectiles, bosses ----------------------------
  game.enemies = [];
  game.ITEMS = ITEMS;
  game.bloodMoon = false;
  const spawner = new Spawner(world, game.enemies);
  const projectiles = new Projectiles(world);
  game.projectiles = projectiles;
  const combat = new Combat(game);
  game.combat = combat;
  game.summonBoss = summonBossFactory(game);
  player.getDefense = () => inventory.defense();

  // ---- audio ---------------------------------------------------------------------
  const { AudioEngine } = await import('./core/audio.js');
  const audio = new AudioEngine();
  game.audio = audio;
  player.onDig.push((tx, ty, info, extra) => {
    if (extra?.wood) audio.play('chop', { volume: 0.9 });
    else audio.play(`dig${(Math.random() * 3) | 0}`, { volume: 0.8 });
  });
  player.onHurt.push(() => audio.play('hurt'));
  drops.onPickup.push(() => audio.play('pickup', { volume: 0.55, throttleMs: 90 }));
  inventory.onChange.push(() => { /* craft sound handled in HUD */ });
  {
    // music selection by context (checked every 2s of ticks)
    const { LAYERS, WORLD_H } = await import('./config.js');
    const { isDay } = await import('./render/background.js');
    game.updaters.push(() => {
      if (game.tick % 120 !== 0 || !audio.ctx) return;
      let track;
      if (game.enemies.some(e => e.boss)) track = 'boss';
      else if ((player.py / 16) > WORLD_H * LAYERS.underground) track = 'underground';
      else track = isDay(game.tick) ? 'day' : 'night';
      audio.music(track);
    });
  }

  // announcement banner (top center, fades)
  const announceEl = document.createElement('div');
  announceEl.style.cssText = `position:fixed;top:70px;left:50%;transform:translateX(-50%);
    font:600 18px 'Segoe UI',sans-serif;color:#f0d8a0;text-shadow:0 2px 6px #000;
    opacity:0;transition:opacity .4s;pointer-events:none;z-index:60;`;
  document.getElementById('hud').appendChild(announceEl);
  let announceTimer = null;
  game.announce = (msg) => {
    announceEl.textContent = msg;
    announceEl.style.opacity = '1';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { announceEl.style.opacity = '0'; }, 3500);
  };

  game.updaters.push(() => player.tick(game));
  game.updaters.push(() => combat.tick());
  game.updaters.push(() => spawner.tick(game));
  game.updaters.push(() => projectiles.tick(game));
  game.updaters.push(() => drops.tick(player, inventory));
  game.updaters.push(() => liquids.tick());
  game.updaters.push(() => falling.tick());
  game.updaters.push(() => camera.tick());
  game.updaters.push(() => hud.tick());
  game.updaters.push(() => consumeTick()); // must stay LAST updater

  // death jingle on the tick the player dies
  let wasDead = false;
  game.updaters.push(() => {
    if (player.dead && !wasDead) audio.play('death', { volume: 0.9 });
    wasDead = player.dead;
  });

  // sapling growth: every ~5s one random sapling tries to become a tree
  const saplings = new Set();
  world.onTileChanged.push((tx, ty) => {
    const k = ty * world.w + tx;
    if (world.tiles[k] === T.sapling) saplings.add(k); else saplings.delete(k);
  });
  game.updaters.push(() => {
    if (game.tick % 300 !== 0 || saplings.size === 0) return;
    const arr = [...saplings];
    const k = arr[(Math.random() * arr.length) | 0];
    const tx = k % world.w, ty = (k / world.w) | 0;
    if (world.tiles[k] !== T.sapling) { saplings.delete(k); return; }
    if (Math.random() > 0.3) return;
    const height = 6 + (Math.random() * 7 | 0);
    for (let t = 0; t <= height + 2; t++) {
      if (ty - t < 0 || (t > 0 && world.tileAt(tx, ty - t) !== T.air)) return; // no room
    }
    const ground = world.tileAt(tx, ty + 1);
    if (ground !== T.grass && ground !== T.dirt && ground !== T.snow && ground !== T.jungleGrass) return;
    saplings.delete(k);
    for (let t = 0; t <= height; t++) world.setTile(tx, ty - t, T.treeTrunk);
    for (let ly = -2; ly <= 1; ly++) for (let lx = -2; lx <= 2; lx++) {
      const yy = ty - height - 1 + ly, xx = tx + lx;
      if (Math.abs(lx) + Math.abs(ly) <= 3 && world.tileAt(xx, yy) === T.air) world.setTile(xx, yy, T.treeLeaves);
    }
  });

  // ---- pause menu (Esc) + autosave ------------------------------------------------
  const pauseEl = document.createElement('div');
  pauseEl.style.cssText = `position:fixed;inset:0;display:none;align-items:center;justify-content:center;
    background:rgba(8,10,18,0.72);z-index:80;font-family:'Segoe UI',sans-serif;`;
  pauseEl.innerHTML = `<div style="text-align:center">
    <h2 style="color:#e8d9a0;letter-spacing:6px;margin-bottom:24px">PAUSED</h2>
    <div id="us-resume" class="us-menu-btn">Resume</div>
    <div id="us-save" class="us-menu-btn">Save World</div>
    <div id="us-savequit" class="us-menu-btn">Save &amp; Quit to Title</div>
    <div id="us-savemsg" style="color:#8ac88a;font-size:13px;margin-top:10px;height:16px"></div>
  </div>`;
  document.body.appendChild(pauseEl);
  const setPaused = (on) => {
    game.paused = on;
    pauseEl.style.display = on ? 'flex' : 'none';
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (hud.open) { hud.toggle(false); return; }
    setPaused(!game.paused);
  });
  pauseEl.querySelector('#us-resume').onclick = () => setPaused(false);
  pauseEl.querySelector('#us-save').onclick = () => {
    const ok = saveMod.saveGame(game);
    pauseEl.querySelector('#us-savemsg').textContent = ok ? 'World saved.' : 'Save failed (storage full?)';
  };
  pauseEl.querySelector('#us-savequit').onclick = () => {
    saveMod.saveGame(game);
    location.reload();
  };
  setInterval(() => {
    if (!game.paused && !player.dead && game.tick > 600) saveMod.saveGame(game);
  }, 120000); // autosave every 2 min
  window.addEventListener('beforeunload', () => { if (game.tick > 600) saveMod.saveGame(game); });

  game.renderers.push((g, alpha) => background.draw(g.ctx, g, alpha));
  game.renderers.push((g, alpha) => tileRenderer.draw(g.ctx, camera, alpha));

  // player sprite (Grok-generated; block fallback while art is missing)
  game.renderers.push((g, alpha) => {
    const c = g.ctx;
    const [ox, oy] = camera.frameOrigin(alpha);
    const [px, py] = player.renderPos(alpha);
    const z = camera.zoom;
    if (player.dead) return;
    const sx = (px - ox) * z, sy = (py - oy) * z;
    if (player.iFrames > 0 && (g.tick & 4)) c.globalAlpha = 0.4;
    const spr = game.assets?.sprites?.player;
    if (spr) {
      const walking = Math.abs(player.vx) > 0.3 && player.vy === 0;
      const bob = walking ? Math.sin(g.tick * 0.35) * 1.2 * z : 0;
      const lean = walking ? Math.sin(g.tick * 0.35) * 0.05 : 0;
      const dw = spr.width * (player.h / spr.height) * z, dh = player.h * z;
      const cx = sx + (player.w * z) / 2, cy = sy + dh / 2 + bob;
      c.save();
      c.translate(cx, cy);
      c.scale(player.facing > 0 ? 1 : -1, 1);
      c.rotate(lean * (player.facing > 0 ? 1 : -1));
      // swing: tilt forward while using an item
      if (player.swinging > 0) c.rotate(0.18);
      c.drawImage(spr, -dw / 2, -dh / 2, dw, dh);
      c.restore();
    } else {
      c.fillStyle = '#c8956c'; c.fillRect(sx + 4 * z, sy, 12 * z, 10 * z);
      c.fillStyle = '#3a6ea5'; c.fillRect(sx + 2 * z, sy + 10 * z, 16 * z, 20 * z);
      c.fillStyle = '#2d4739';
      c.fillRect(sx + 3 * z, sy + 30 * z, 6 * z, 12 * z);
      c.fillRect(sx + 11 * z, sy + 30 * z, 6 * z, 12 * z);
    }
    c.globalAlpha = 1;
  });

  // enemies + projectiles + falling tiles + world item drops
  game.renderers.push((g, alpha) => { for (const e of g.enemies) e.draw(g.ctx, camera, alpha, g.assets); });
  game.renderers.push((g, alpha) => projectiles.draw(g.ctx, camera, alpha));
  game.renderers.push((g, alpha) => falling.draw(g.ctx, camera, alpha, g.assets));
  game.renderers.push((g, alpha) => drops.draw(g.ctx, camera, alpha));

  // lighting (multiply overlay) — after entities, before cursor/HUD
  const lighting = new Lighting(world);
  game.lighting = lighting;
  game.renderers.push((g, alpha) => {
    lighting.compute(camera, g.tick, alpha);
    lighting.draw(g.ctx, camera, alpha);
  });

  // floating damage numbers (above lighting so they stay readable)
  game.renderers.push((g, alpha) => combat.draw(g.ctx, camera, alpha));

  // death overlay
  game.renderers.push((g) => {
    if (!player.dead) return;
    const c = g.ctx;
    c.fillStyle = 'rgba(60,0,0,0.35)';
    c.fillRect(0, 0, g.canvas.width, g.canvas.height);
    c.fillStyle = '#f0d0d0';
    c.font = `bold ${28 * (window.devicePixelRatio || 1)}px 'Segoe UI', sans-serif`;
    c.textAlign = 'center';
    c.fillText('You were slain…', g.canvas.width / 2, g.canvas.height / 2 - 20);
    c.font = `${16 * (window.devicePixelRatio || 1)}px 'Segoe UI', sans-serif`;
    c.fillText(`Respawning in ${Math.ceil(player.respawnTimer / 60)}…`, g.canvas.width / 2, g.canvas.height / 2 + 16);
    c.textAlign = 'left';
  });

  // cursor target tile outline + mining cracks — DEV
  game.renderers.push((g, alpha) => {
    const c = g.ctx;
    const { tx, ty, inReach } = player.targetTile(g);
    if (!world.inBounds(tx, ty)) return;
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const sx = (tx * 16 - ox) * z, sy = (ty * 16 - oy) * z;
    c.strokeStyle = inReach ? 'rgba(255,255,180,0.85)' : 'rgba(255,80,80,0.4)';
    c.lineWidth = Math.max(1, z);
    c.strokeRect(sx + 0.5, sy + 0.5, 16 * z, 16 * z);
    if (player.miningTile === ty * world.w + tx && player.miningDamage > 0) {
      c.fillStyle = `rgba(0,0,0,${0.15 + 0.35 * (player.miningDamage / 100)})`;
      c.fillRect(sx, sy, 16 * z, 16 * z);
    }
  });

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
}

// ---------------------------------------------------------------------------
// Title screen: New World / Continue. Resolves with the choice.
// ---------------------------------------------------------------------------
function showTitle(canContinue) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
      justify-content:center;background:linear-gradient(#0e1526,#1c2c22);z-index:95;font-family:'Segoe UI',sans-serif;`;
    el.innerHTML = `
      <style>
        .us-menu-btn { padding:10px 34px;margin:7px;border:2px solid #3a415c;border-radius:8px;color:#e8e8f0;
          font-size:17px;cursor:pointer;background:rgba(20,24,40,0.75);min-width:220px;text-align:center;
          transition: all .15s; user-select:none; }
        .us-menu-btn:hover { border-color:#e8d9a0;color:#e8d9a0;box-shadow:0 0 12px rgba(232,217,160,.3); }
        .us-menu-btn.disabled { opacity:.35;cursor:default;pointer-events:none; }
      </style>
      <h1 style="font-size:52px;letter-spacing:12px;color:#e8d9a0;margin:0 0 6px;text-shadow:0 0 28px rgba(232,217,160,.4)">UNDERSTONE</h1>
      <div style="color:#8a93b0;margin-bottom:34px;font-size:14px">dig · build · craft · survive</div>
      <div class="us-menu-btn" id="us-new">New World</div>
      <div class="us-menu-btn ${canContinue ? '' : 'disabled'}" id="us-continue">Continue</div>
      <div style="color:#5a6280;font-size:12px;margin-top:30px;max-width:420px;text-align:center;line-height:1.7">
        A/D move · Space jump (hold for height) · Mouse aim + Left-click use · Right-click interact<br>
        E inventory · 1-0 hotbar · Esc pause · Craft near stations · Beware the night.
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#us-new').onclick = () => { el.remove(); resolve('new'); };
    el.querySelector('#us-continue').onclick = () => { el.remove(); resolve('continue'); };
  });
}

boot();

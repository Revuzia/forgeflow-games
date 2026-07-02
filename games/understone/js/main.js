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

  initInput(canvas);
  const world = new World();
  game.world = world;
  await new Promise(requestAnimationFrame); // let boot UI paint
  generateWorld(world, (f, msg) => bootProgress(0.05 + f * 0.85, msg));

  bootProgress(0.9, 'Painting the world…');
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

  bootProgress(0.92, 'Settling the waters…');
  const liquids = new Liquids(world);
  game.liquids = liquids;
  await new Promise(requestAnimationFrame);
  liquids.settleAll();

  // ---- inventory / drops / HUD ------------------------------------------------
  const inventory = new Inventory();
  game.inventory = inventory;
  for (const [id, n] of STARTER_ITEMS) inventory.add(id, n);
  const drops = new Drops(world);
  game.drops = drops;
  const hud = new HUD(game, player, inventory);
  game.hud = hud;

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
  game.updaters.push(() => camera.tick());
  game.updaters.push(() => hud.tick());
  game.updaters.push(() => consumeTick()); // must stay LAST updater

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

  // enemies + projectiles + world item drops
  game.renderers.push((g, alpha) => { for (const e of g.enemies) e.draw(g.ctx, camera, alpha, g.assets); });
  game.renderers.push((g, alpha) => projectiles.draw(g.ctx, camera, alpha));
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

  bootProgress(1, 'Ready');
  bootDone();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
}

boot();

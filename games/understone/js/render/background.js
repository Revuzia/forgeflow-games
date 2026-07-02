// Sky, sun/moon, stars, and depth-based backdrop. Drawn before tiles each frame.

import { TILE, DAY_TICKS, CYCLE_TICKS, LAYERS } from '../config.js';

// time helpers ---------------------------------------------------------------
export function cycleTick(tick) { return tick % CYCLE_TICKS; }
export function isDay(tick) { return cycleTick(tick) < DAY_TICKS; }
// 0..1 across current day or night segment
export function segFrac(tick) {
  const c = cycleTick(tick);
  return isDay(tick) ? c / DAY_TICKS : (c - DAY_TICKS) / (CYCLE_TICKS - DAY_TICKS);
}
// surface sunlight intensity 0..1 (dawn/dusk ramps)
export function sunlight(tick) {
  if (!isDay(tick)) {
    // faint moonlight
    return 0.08;
  }
  const f = segFrac(tick);
  const ramp = 0.12; // fraction of day spent ramping at each end
  if (f < ramp) return 0.08 + 0.92 * (f / ramp);
  if (f > 1 - ramp) return 0.08 + 0.92 * ((1 - f) / ramp);
  return 1;
}

function lerpColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const SKY_DAY_TOP = [88, 156, 226], SKY_DAY_BOT = [176, 216, 245];
const SKY_NIGHT_TOP = [8, 10, 26], SKY_NIGHT_BOT = [24, 30, 56];
const SKY_DUSK = [226, 130, 74];

export class Background {
  constructor(world, camera, assets = null) {
    this.world = world;
    this.camera = camera;
    this.assets = assets;
    // deterministic star field
    this.stars = [];
    let s = 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 140; i++) this.stars.push([rnd(), rnd() * 0.6, 0.5 + rnd() * 1.5]);
  }

  draw(ctx, game, alpha) {
    const { canvas } = ctx;
    const w = canvas.width, h = canvas.height;
    const tick = game.tick;
    const day = isDay(tick);
    const f = segFrac(tick);
    const sun = sunlight(tick);

    // depth factor: how far below surface the camera is (0 surface, 1 deep)
    const camTy = this.camera.y / TILE;
    const surfaceY = this.world.h * LAYERS.underground;
    const depth = Math.min(1, Math.max(0, (camTy - surfaceY) / (this.world.h * 0.12)));

    // sky gradient
    let top = day ? lerpColor(SKY_NIGHT_TOP, SKY_DAY_TOP, sun) : SKY_NIGHT_TOP;
    let bot = day ? lerpColor(SKY_NIGHT_BOT, SKY_DAY_BOT, sun) : SKY_NIGHT_BOT;
    // dusk/dawn tint near segment edges of day
    if (day && (f < 0.12 || f > 0.88)) {
      const t = f < 0.12 ? 1 - f / 0.12 : (f - 0.88) / 0.12;
      bot = lerpColor(bot, SKY_DUSK, t * 0.6);
    }
    // underground fades sky to cave black
    top = lerpColor(top, [6, 6, 10], depth);
    bot = lerpColor(bot, [10, 9, 14], depth);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgb(${top.map(Math.round)})`);
    grad.addColorStop(1, `rgb(${bot.map(Math.round)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (depth > 0.95) return; // fully underground: no celestial bodies or hills

    // parallax hills (research 07 P0-1): two layers, far 0.07x / near 0.18x scroll
    const hills = this.assets?.bg?.hills;
    if (hills && depth < 0.6) {
      const [ox] = this.camera.frameOrigin(1);
      const horizonY = h * (0.62 - depth * 0.5);
      ctx.globalAlpha = (1 - depth) * 0.9;
      for (const [ratio, scale, tint] of [[0.07, 0.55, 0.35], [0.18, 0.8, 0]]) {
        const dw = w * 1.3 * scale + w * 0.7;
        const dh = dw * (hills.height / hills.width) * 0.5;
        let sx = -((ox * ratio) % dw);
        if (sx > 0) sx -= dw;
        for (let x = sx; x < w; x += dw) {
          ctx.drawImage(hills, x, horizonY - dh * (0.9 - ratio), dw, dh);
        }
        if (tint > 0) {
          // atmospheric haze on the far layer: repaint with sky color at low alpha
          ctx.fillStyle = `rgba(${bot.map(Math.round)},${tint})`;
          ctx.fillRect(0, horizonY - dh, w, dh * 1.2);
        }
      }
      ctx.globalAlpha = 1;
    }

    // stars at night
    if (!day) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const [sx, sy, r] of this.stars) {
        const tw = 0.55 + 0.45 * Math.sin(tick * 0.02 + sx * 40);
        ctx.globalAlpha = tw * (1 - depth);
        ctx.fillRect(sx * w, sy * h, r, r);
      }
      ctx.globalAlpha = 1;
    }

    // sun / moon arc
    const bodyF = f; // 0..1 across segment
    const bx = w * bodyF;
    const by = h * 0.16 + Math.pow(bodyF * 2 - 1, 2) * h * 0.35;
    ctx.globalAlpha = 1 - depth;
    if (day) {
      const sunGrad = ctx.createRadialGradient(bx, by, 4, bx, by, 42);
      sunGrad.addColorStop(0, '#fff6cf');
      sunGrad.addColorStop(0.4, '#ffd75e');
      sunGrad.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath(); ctx.arc(bx, by, 42, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#e8e8dc';
      ctx.beginPath(); ctx.arc(bx, by, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${SKY_NIGHT_TOP.map(Math.round)})`;
      ctx.beginPath(); ctx.arc(bx - 6, by - 4, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

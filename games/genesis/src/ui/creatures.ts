// GENESIS — the creatures as the interface shows them (CONTRACT.md §11.5, §1.4 "a creature that learns"), until the
// render lane's procedural creature body (gen/creaturegen.ts) stands in the world: each creature on the world under
// the camera is drawn as a SILHOUETTE standing on its ground point at its true height (projected), facing the way it
// walks, with a name card over it — what it is doing, kind or cruel. The silhouette is built from its body template
// (ape, ox, great cat, tortoise, wolf, bear) and its morph: fat rounds it, strong broadens it, spiky raises spines
// along its back, glow lights a halo; good creatures are drawn in warm ivory and gold, cruel ones in charred red with a
// red eye. A click on it selects it (the inspector: reward, punish, leash, mode); a press on it is the hand's (the App
// forwards it), so it can be grabbed, stroked or slapped like anything in the world.

import type { CreatureView } from '../sim/types.ts';
import type { UiHost } from './host.ts';
import { h } from './dom.ts';

/** a body as primitives in a 120 × 72 box, feet on y = 70, facing right */
interface Body { parts: string; eye: [number, number]; back: [number, number][] }

const E = (cx: number, cy: number, rx: number, ry: number, rot = 0) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;
const R = (x: number, y: number, w: number, hh: number, r = 3, rot = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${r}"${rot ? ` transform="rotate(${rot} ${x + w / 2} ${y})"` : ''}/>`;
const P = (d: string) => `<path d="${d}"/>`;

/** fat (0..1) widens the trunk, strong (0..1) thickens limbs and shoulders */
function bodyOf(kind: string, fat: number, strong: number): Body {
  const f = 1 + fat * 0.28, s = 1 + strong * 0.35;
  switch (kind) {
    case 'ape': return {
      parts: E(54, 36, 20 * f, 19 * f, -12) + E(73, 18, 11, 10) + E(80, 22, 6, 5) + R(36, 44, 9 * s, 26, 4, 8) + R(52, 46, 9 * s, 24, 4, -6)
        + R(64, 24, 8 * s, 44, 4, -14) + R(42, 26, 8 * s, 42, 4, 12) + E(70, 10, 4, 3),
      eye: [77, 16], back: [[40, 22], [48, 18], [56, 16], [64, 14]],
    };
    case 'ox': return {
      parts: E(54, 36, 34 * f, 17 * f) + E(36, 30, 14 * s, 13 * s) + E(92, 38, 12, 10, 20) + E(101, 44, 7, 6) + R(26, 44, 9 * s, 26, 3) + R(40, 46, 9 * s, 24, 3)
        + R(68, 46, 9 * s, 24, 3) + R(80, 44, 9 * s, 26, 3) + P('M86 30 C84 22 90 18 96 20 C92 22 90 26 90 30 Z') + P('M96 31 C98 24 106 22 110 26 C104 26 101 29 100 32 Z')
        + P('M20 32 C14 36 13 46 15 54 L18 54 C17 46 18 38 23 35 Z'),
      eye: [97, 36], back: [[30, 18], [42, 18], [56, 19], [70, 20]],
    };
    case 'cat': return {
      parts: E(52, 40, 30 * f, 11 * f) + E(88, 30, 11, 10) + P('M80 22 L82 12 L87 21 Z') + P('M89 21 L95 12 L96 23 Z') + E(96, 33, 5, 4)
        + R(28, 44, 7 * s, 26, 3, 10) + R(38, 46, 7 * s, 24, 3, -4) + R(66, 46, 7 * s, 24, 3, 4) + R(75, 42, 7 * s, 28, 3, -8)
        + P('M24 40 C12 38 6 28 10 16 C12 10 18 8 20 12 C16 16 14 26 22 34 Z'),
      eye: [91, 28], back: [[34, 29], [46, 28], [58, 28], [70, 30]],
    };
    case 'tortoise': return {
      parts: P(`M14 56 C16 ${30 - fat * 6} 34 ${18 - fat * 6} 58 ${18 - fat * 6} C82 ${18 - fat * 6} 100 ${30 - fat * 6} 102 56 Z`) + R(12, 54, 92, 6, 3)
        + E(108, 50, 9, 7, -10) + E(115, 47, 5, 4) + R(22, 58, 12 * s, 12, 4) + R(40, 60, 11 * s, 10, 4) + R(70, 60, 11 * s, 10, 4) + R(86, 58, 12 * s, 12, 4)
        + P('M12 56 L4 60 L12 60 Z'),
      eye: [112, 46], back: [[30, 30 - fat * 4], [46, 22 - fat * 5], [62, 21 - fat * 5], [80, 26 - fat * 4]],
    };
    case 'bear': return {
      parts: E(54, 38, 34 * f, 20 * f) + E(42, 28, 18 * s, 14 * s) + E(90, 32, 13, 12) + E(102, 36, 7, 6) + E(84, 21, 4.5, 4.5) + E(94, 21, 4.5, 4.5)
        + R(24, 46, 12 * s, 24, 5) + R(40, 48, 11 * s, 22, 5) + R(66, 48, 11 * s, 22, 5) + R(80, 46, 12 * s, 24, 5) + E(20, 34, 5, 4),
      eye: [96, 30], back: [[30, 20], [42, 15], [56, 18], [70, 20]],
    };
    default: // wolf
      return {
        parts: E(52, 38, 28 * f, 11 * f) + E(80, 30, 9 * s, 10 * s, -30) + E(92, 25, 10, 8) + P('M98 22 L112 27 L110 31 L98 31 Z') + P('M86 19 L88 8 L93 18 Z')
          + R(30, 42, 6 * s, 28, 3, 8) + R(38, 44, 6 * s, 26, 3, -4) + R(64, 44, 6 * s, 26, 3, 6) + R(72, 42, 6 * s, 28, 3, -6)
          + P('M26 36 C16 38 10 46 8 56 C12 56 16 50 20 46 C22 42 26 40 30 40 Z'),
        eye: [95, 23], back: [[34, 28], [46, 27], [58, 27], [70, 27]],
      };
  }
}

/** the body template's shape family */
function shapeOf(body: string): string {
  if (/ape|monkey|primate/.test(body)) return 'ape';
  if (/ox|bull|cow|bison/.test(body)) return 'ox';
  if (/cat|lion|tiger/.test(body)) return 'cat';
  if (/tortoise|turtle/.test(body)) return 'tortoise';
  if (/bear/.test(body)) return 'bear';
  return 'wolf';
}

function svgOf(c: CreatureView): string {
  const [fat, strong, spiky, glow] = c.morph ?? [0, 0, 0, 0];
  const b = bodyOf(shapeOf(c.body), fat, strong);
  // spines along the back for a cruel, spiky body
  let spines = '';
  if (spiky > 0.12) for (const [x, y] of b.back) { const hh = 4 + spiky * 10; spines += P(`M${x - 4} ${y + 3} L${x} ${y - hh} L${x + 4} ${y + 3} Z`); }
  const al = Math.max(-1, Math.min(1, c.alignment));
  const eye = al < -0.3 ? '#ff4a3a' : '#20160c';
  const halo = glow > 0.15 ? `<ellipse cx="60" cy="38" rx="${56 + glow * 10}" ry="${34 + glow * 6}" fill="url(#gch)" opacity="${(0.25 + glow * 0.45).toFixed(2)}"/>` : '';
  return `<svg viewBox="-6 -6 132 80" aria-hidden="true"><defs><radialGradient id="gch" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff3c8" stop-opacity=".9"/><stop offset="1" stop-color="#fff3c8" stop-opacity="0"/></radialGradient></defs>${halo}<g class="gn-crea-body">${b.parts}${spines}</g><ellipse cx="60" cy="70.5" rx="44" ry="2.4" class="gn-crea-shadow"/><circle cx="${b.eye[0]}" cy="${b.eye[1]}" r="1.8" fill="${eye}"/></svg>`;
}

interface Mark { root: HTMLDivElement; fig: HTMLDivElement; card: HTMLDivElement; name: HTMLDivElement; sub: HTMLDivElement; key: string; lastX: number; facing: 1 | -1 }

export class CreatureMarks {
  private host: UiHost;
  private layer: HTMLDivElement;
  private marks = new Map<number, Mark>();

  constructor(worldLayer: HTMLElement, host: UiHost) {
    this.host = host;
    this.layer = h('div', { class: 'gn-creas' });
    worldLayer.appendChild(this.layer);
  }

  /** follow every creature on the world under the camera (hidden while the radial / palette / a gesture is up) */
  frame(hush: boolean): void {
    const host = this.host;
    const v = host.view;
    const primary = host.primary();
    const seen = new Set<number>();
    // the HUD's top band (the time panel, the worlds and worship) at the interface's scale
    const band = 132 * (Number(document.documentElement.style.getPropertyValue('--gn-ui-scale')) || 1);
    for (const c of v.creatures) {
      if (c.planet !== primary || hush) continue;
      const feet = host.screenOf(c.planet, c.pos, 0);
      const top = host.screenOf(c.planet, c.pos, Math.max(1, c.height));
      if (!feet || !top) continue;
      // its feet on screen (the card and the figure stand above them): off screen, nothing is drawn
      if (feet[0] < 0 || feet[0] > window.innerWidth || feet[1] < 40 || feet[1] > window.innerHeight + 120) continue;
      seen.add(c.id);
      let m = this.marks.get(c.id);
      if (!m) {
        const fig = h('div', { class: 'gn-crea-fig' });
        const name = h('div', { class: 'gn-crea-name' });
        const sub = h('div', { class: 'gn-crea-sub' });
        const card = h('div', { class: 'gn-crea-card' }, name, sub);
        const root = h('div', { class: 'gn-crea', role: 'button', aria: { label: c.name }, data: { cid: String(c.id), planet: String(c.planet) } }, card, fig);
        const id = c.id, planet = c.planet;
        // a keyboard / gamepad press selects; the mouse's presses are forwarded to the world by the App
        root.addEventListener('click', (e) => { if (e.detail === 0) host.select({ kind: 'creature', id, planet }); });
        this.layer.appendChild(root);
        m = { root, fig, card, name, sub, key: '', lastX: feet[0], facing: 1 };
        this.marks.set(c.id, m);
      }
      // the figure's height on screen is the creature's own (at least a readable size)
      const px = Math.max(30, Math.min(300, Math.abs(feet[1] - top[1]) * 1.15));
      // facing: the way it moves across the screen
      const dx = feet[0] - m.lastX;
      if (Math.abs(dx) > 0.6) m.facing = dx < 0 ? -1 : 1;
      m.lastX = feet[0];
      const al = c.alignment;
      const key = `${c.body}|${c.morph?.map((x) => x.toFixed(1)).join(',')}|${al > 0.3 ? 'g' : al < -0.3 ? 'e' : 'n'}`;
      if (key !== m.key) {
        m.key = key;
        m.fig.innerHTML = svgOf(c);
        m.root.classList.toggle('gn-crea-good', al > 0.3);
        m.root.classList.toggle('gn-crea-evil', al < -0.3);
      }
      const nameT = c.name;
      if (m.name.textContent !== nameT) m.name.textContent = nameT;
      const act = c.activity ? (c.activity.length > 44 ? `${c.activity.slice(0, 42)}…` : c.activity) : '';
      const subT = `${act}${act ? ' · ' : ''}${al > 0.35 ? 'kind' : al < -0.35 ? 'cruel' : 'unsure'}`;
      if (m.sub.textContent !== subT) m.sub.textContent = subT;
      // a card that would stand among the HUD's top panels is left out (the figure stays, and a click still selects)
      const noCard = feet[1] - px - 48 < band;
      if (m.card.hidden !== noCard) m.card.hidden = noCard;
      m.fig.style.height = `${px.toFixed(0)}px`;
      m.fig.style.width = `${(px * 132 / 80).toFixed(0)}px`;
      m.fig.style.transform = `scaleX(${m.facing})`;
      m.root.style.transform = `translate(${feet[0].toFixed(1)}px, ${feet[1].toFixed(1)}px)`;
      m.root.classList.toggle('gn-crea-held', !!v.hand?.held && v.hand.held.kind === 'creature' && v.hand.held.id === c.id);
    }
    for (const [id, m] of this.marks) if (!seen.has(id)) { m.root.remove(); this.marks.delete(id); }
  }
}

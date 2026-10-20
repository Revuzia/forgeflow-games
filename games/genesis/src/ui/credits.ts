// GENESIS — credits and licences (the title's "Credits & licences", the game menu's): who made the game, and every
// third-party work shipped inside it with its notice and licence text, as the licences require — three.js (MIT), the
// Cormorant Garamond and Inter fonts (SIL Open Font License 1.1, packaged by Fontsource), and Vite's small runtime
// helper (MIT). The licence texts are the packages' own files, read at build time and loaded only when this window opens.

import { Panel } from './panel.ts';
import { h, clear } from './dom.ts';

interface Work { name: string; what: string; licence: string; notice: string; url: string; text: () => Promise<string> }

const raw = (m: Promise<{ default: string }>): Promise<string> => m.then((x) => x.default).catch(() => '');

const WORKS: Work[] = [
  {
    name: 'three.js', what: 'the 3D engine every world is drawn with', licence: 'MIT License', notice: 'Copyright © 2010–2026 three.js authors',
    url: 'https://threejs.org', text: () => raw(import('../../node_modules/three/LICENSE?raw')),
  },
  {
    name: 'Cormorant Garamond', what: 'the serif of titles and names (via Fontsource)', licence: 'SIL Open Font License 1.1',
    notice: 'Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant)', url: 'https://github.com/CatharsisFonts/Cormorant',
    text: () => raw(import('../../node_modules/@fontsource/cormorant-garamond/LICENSE?raw')),
  },
  {
    name: 'Inter', what: 'the sans of the interface (via Fontsource)', licence: 'SIL Open Font License 1.1',
    notice: 'Copyright 2016 The Inter Project Authors (github.com/rsms/inter)', url: 'https://rsms.me/inter/',
    text: () => raw(import('../../node_modules/@fontsource/inter/LICENSE?raw')),
  },
  {
    name: 'Vite', what: 'the build: a small module-preload helper ships inside the game', licence: 'MIT License',
    notice: 'Copyright (c) 2019-present, VoidZero Inc. and Vite contributors', url: 'https://vite.dev',
    text: () => raw(import('../../node_modules/vite/LICENSE.md?raw')).then((t) => t.split(/\n#{1,2} /)[0].replace(/^# Vite core license\s*/, '').trim()),
  },
];

export class Credits {
  readonly panel: Panel;
  private body: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.panel = new Panel(parent, { name: 'credits', title: 'Credits & licences', subtitle: 'who made it, and what it is made with', icon: 'credits', place: 'center', veil: true });
    this.body = h('div', { class: 'gn-credits' });
    this.panel.body.append(this.body);
    this.panel.onOpen = () => { this.render(); this.panel.body.scrollTop = 0; };
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(): void { this.panel.open(); }
  close(): void { this.panel.close(); }

  private render(): void {
    clear(this.body);
    this.body.append(
      h('div', { class: 'gn-cr-game' },
        h('div', { class: 'gn-cr-mark', text: 'GENESIS' }),
        h('p', { text: 'A ForgeFlow game. Light a star, breathe air onto a dead world, pour seas, seed life — and watch a people find their own way.' }),
        h('p', { class: 'gn-cr-dim', text: 'Everything you see and hear is made in code as you play: the worlds and their weather, their peoples and animals, the light, the sound and the music. No art, sound or music by others is used.' })),
      h('div', { class: 'gn-set-h', text: 'Third-party software and fonts' }));
    for (const w of WORKS) {
      const pre = h('pre', { class: 'gn-cr-text', text: 'Reading the licence…' });
      const details = h('details', { class: 'gn-cr-work' },
        h('summary', {},
          h('span', { class: 'gn-cr-name', text: w.name }),
          h('span', { class: 'gn-cr-lic', text: w.licence }),
          h('small', { text: `${w.what} · ${w.notice}` })),
        pre);
      let loaded = false;
      details.addEventListener('toggle', () => {
        if (!details.open || loaded) return;
        loaded = true;
        void w.text().then((t) => { pre.textContent = t || `${w.notice}. ${w.licence}: ${w.url}`; });
      });
      this.body.append(details);
    }
    this.body.append(h('p', { class: 'gn-cr-dim', text: 'The fonts are used under the SIL Open Font License 1.1 and may be used, studied, modified and redistributed with their notices; they are not sold by themselves. Open each entry for its full licence.' }));
  }
}

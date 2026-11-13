# Memory — neon-veil

## Facts
- Dogfight game is Vite-bundled in `assets/index-*.js`; original TS restored under `src-restored/src/` (from sourcemap).
- **Grid Rush** is the kart/circuit mode: `race.html` + `race/race.js` + `race/race.css` (Three r170 importmap CDN). Menu button **GRID RUSH** on `index.html` → `./race.html`.
- Grid Rush: hover karts (6 original rigs), 3 laps, 5 AI, drift mini-turbo, Pulse Caches, original arsenal (Static Spike, Wraith Seeker, Arc Lance, Null Cloak, Turbine Burst, Grav Well, Siphon Node, Blink Gate, Riot Pane, Blackout Pulse). Not Mario Kart clones; not dogfight ships.
- Old **Sky Race** (gate/flight circuit) was removed/replaced by Grid Rush.
- Courses map to biomes (sky-city, the-pit, cloud-sea, upper-atmo, deep-space).

## Decisions
- Grid Rush kept as standalone page (not patched into minified dogfight bundle) so it ships without a full TypeScript rebuild.
- Verify: `node _verify_race.mjs` and `node --check race/race.js`.

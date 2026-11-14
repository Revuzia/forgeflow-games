# sanctum-assault

## What this is
Top-down isometric **Three.js** arena wave-survival: three champions, five mystical realm boards, combos, Shock/Burn/Frost, radial ability CDs.

## Stack
- Vanilla ES modules + Three.js **0.172** (CDN import map)
- No build step

```bash
npx --yes serve -p 5179 .
# or: python -m http.server 5179
```

Open `http://localhost:5179/`

## Conventions
- Prefer smallest correct change; don't drive-by refactor.
- After edits: serve folder + smoke play (move, attack, wave spawn).
- Runtime lives in `runtime/*.js`; HUD shell in `index.html`.

## Do not
- Invent paths or claim files exist without checking.
- Deploy / push / spend without explicit ask.
- Clone commercial game names, UI, or assets.
- Touch secrets or production credentials.

## Done means
- Paths changed listed; how to verify locally (serve + play).

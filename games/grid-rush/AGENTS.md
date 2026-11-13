# grid-rush

Standalone neon hover-kart racer (NOT part of neon-veil).

## Stack
- `index.html` + `runtime/*.js` (ES modules) + Three.js via importmap CDN.
- Serve this folder over HTTP. Example: `python -m http.server 8788`
- Verify: `node selftest.mjs`

## Conventions
- Original vehicles + gadgets only (no bananas/shells/stars clones by name or silhouette).
- Smallest correct change; no drive-by refactors.

## Do not
- Merge this back into neon-veil.
- Deploy without explicit ask.

## Done means
- Paths listed; selftest pass; PREVIEW_URL when playable.

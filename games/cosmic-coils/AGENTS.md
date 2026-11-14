# cosmic-coils

## What this is
Browser 3D slither-style snake battle on miniature planets (solo AI or Supabase realtime multiplayer).

## Stack
- Vanilla ES modules + three.js r172 (CDN importmap) + procedural Web Audio + pure sim (`runtime/sim/serpent.js`)
- **Source preview (unbundled):** `npm run dev` → http://127.0.0.1:4173/
- **Production-like local build:** `npm run build` then `npm run preview` → serves minified `dist/` at http://127.0.0.1:4173/
- **Selftest:** `npm test` (or `node runtime/sim/serpent.selftest.cjs`)

## Conventions
- Prefer smallest correct change; don't drive-by refactor.
- After edits: `npm test`; for visuals `npm run preview`.
- Cache-bust source modules via `?v=N` on `index.html` boot entry; dist omits query (single bundle).

## Do not
- Invent paths or claim files exist without checking.
- Deploy / push / spend without explicit ask.
- Touch secrets or production credentials.

## Done means
- Paths changed listed; how to verify locally.

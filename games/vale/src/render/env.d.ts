// VALE render — the one Vite build-time flag the renderer reads (dev-only fallbacks behind ?dev=1).
// Matches vite/client's declaration, so either can be present.
interface ImportMetaEnv { readonly DEV: boolean }
interface ImportMeta { readonly env: ImportMetaEnv }

// VALE UI — ambient module types for Vite features the client uses (the project tsconfig loads only
// node types, not vite/client).
declare module '*.css' {}
declare module '*?url' {
  const url: string;
  export default url;
}
/** Vite: the public base path the app is served from ('/' in dev; the deploy base in a build) */
interface ImportMetaEnv { readonly BASE_URL: string }
interface ImportMeta {
  /** Vite: lazy module map for a glob; {} when nothing matches (optional lanes: HUD, audio, render) */
  glob<T = Record<string, unknown>>(pattern: string | string[], opts?: { eager?: false; import?: string }): Record<string, () => Promise<T>>;
}

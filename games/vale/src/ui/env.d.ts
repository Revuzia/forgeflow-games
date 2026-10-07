// VALE UI — ambient module types for Vite asset imports (the project tsconfig loads only node types).
declare module '*.css' {}
declare module '*?url' {
  const url: string;
  export default url;
}

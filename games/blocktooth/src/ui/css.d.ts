// ui lane: TypeScript 7 checks side-effect imports by default (TS2882). This lets
// `import './styles.css'` typecheck; Vite handles the actual CSS bundling.
declare module '*.css';

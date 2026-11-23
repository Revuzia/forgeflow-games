// R15 FACING: the dev server for browser_facing.mjs with no HMR and no file watching: another engineer edits the same tree, and a full reload in the middle of a
// measurement (vite's answer to a changed file) destroyed the page. The project's own config, unchanged otherwise.
import { mergeConfig, type UserConfig } from 'vite';
import base from '../../vite.config.ts';

const b = (typeof base === 'function' ? (base as (e: { command: 'serve'; mode: string }) => UserConfig)({ command: 'serve', mode: 'development' }) : base) as UserConfig;
export default mergeConfig(b, { server: { hmr: false, watch: null } });

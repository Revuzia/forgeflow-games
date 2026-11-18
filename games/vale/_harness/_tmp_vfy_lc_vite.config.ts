// verifier-only (look close r1): project vite config with a private dep cache
import base from '../vite.config.ts';
export default async (env: any) => {
  const c = typeof base === 'function' ? await (base as any)(env) : base;
  return { ...c, cacheDir: '/private/tmp/claude-501/-Users-sitskovich-Developer-forgeflow-games/03f17c1d-60ba-4393-8820-fb1c6015dccd/scratchpad/vitecache_lc', server: { ...(c.server ?? {}), hmr: false } };
};

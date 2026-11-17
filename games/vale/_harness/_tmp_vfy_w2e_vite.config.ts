// verifier-only: the project's vite config with a private dep cache, so other lanes' vites do not re-optimise under this one
import base from '../vite.config.ts';
export default async (env: any) => {
  const c = typeof base === 'function' ? await (base as any)(env) : base;
  return { ...c, cacheDir: '/private/tmp/claude-501/-Users-sitskovich-Developer-forgeflow-games/03f17c1d-60ba-4393-8820-fb1c6015dccd/scratchpad/vitecache' };
};

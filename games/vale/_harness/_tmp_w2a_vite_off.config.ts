// W2-A scratch: the W2-A config with every W2-A switch served OFF (env value re-key, fighter tone, LOD2, neutral maps),
// so an unmodified harness (value_probe, perf_1080) measures the pre-lane look on the same tree. Never shipped.
import on from './_tmp_w2a_vite.config.ts';

const OFF: [RegExp, string, string][] = [
  [/src\/render\/lighting\.ts$/, 'export const envKeySwitch = { on: true }', 'export const envKeySwitch = { on: false }'],
  [/src\/render\/lighting\.ts$/, 'export const charToneSwitch = { on: true }', 'export const charToneSwitch = { on: false }'],
  [/src\/render\/renderer\.ts$/, 'readonly lod2Switch = { on: true, drawn: 0 }', 'readonly lod2Switch = { on: false, drawn: 0 }'],
  [/src\/render\/world_material\.ts$/, 'export const neutralMapSwitch = { on: true }', 'export const neutralMapSwitch = { on: false }'],
];

export default {
  ...on,
  cacheDir: new URL('../node_modules/.vite_w2a_off', import.meta.url).pathname,
  plugins: [
    ...(on.plugins ?? []),
    {
      name: 'w2a-off',
      enforce: 'pre' as const,
      transform(code: string, id: string) {
        let out = code, hit = false;
        for (const [re, a, b] of OFF) if (re.test(id.split('?')[0]) && out.includes(a)) { out = out.replace(a, b); hit = true; }
        return hit ? { code: out, map: null } : null;
      },
    },
  ],
};

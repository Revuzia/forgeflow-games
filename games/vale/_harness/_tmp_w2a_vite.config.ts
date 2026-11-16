// W2-A scratch: the project's vite config with a private dep cache (other lanes' dev servers never invalidate ours) and
// every dep pre-bundled up front (no mid-run re-optimise reload).
import base from '../vite.config.ts';
export default {
  ...base,
  cacheDir: new URL('../node_modules/.vite_w2a', import.meta.url).pathname,
  optimizeDeps: { include: [...(base.optimizeDeps?.include ?? []), 'meshoptimizer/simplifier', 'three/addons/geometries/ConvexGeometry.js', 'three/addons/libs/meshopt_decoder.module.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/loaders/HDRLoader.js', 'three/addons/utils/BufferGeometryUtils.js', 'three/addons/utils/SkeletonUtils.js'] },
};

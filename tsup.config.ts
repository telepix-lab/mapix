import { defineConfig } from 'tsup';

import * as pkg from './package.json';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['mapbox-gl', '@mapbox/mapbox-gl-draw'],
  // Inject the package.json version so VERSION has a single source of truth.
  define: {
    __MAPIX_VERSION__: JSON.stringify(pkg.version),
  },
});

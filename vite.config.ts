import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { collectLicenses, thirdPartyLicenses } from './scripts/third-party-licenses.mjs';

// The extension page (index.html) is built into dist/ together with everything in public/
// (manifest.json, background.js, _locales, icons) and THIRD_PARTY_LICENSES.txt.
// Load dist/ as an unpacked extension.
export default defineConfig({
  base: './',
  plugins: [react(), thirdPartyLicenses()],
  worker: { format: 'es', plugins: () => [collectLicenses()] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    // @dbml/core bundles every SQL dialect parser; it lives in the worker chunk and is large by nature.
    chunkSizeWarningLimit: 12000,
    sourcemap: false,
  },
  test: {
    environment: 'node',
  },
} as never);

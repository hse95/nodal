import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';

// `base: './'` keeps every asset URL relative so the static build works
// unchanged under any GitHub Pages sub-path (https://user.github.io/repo/).
export default defineConfig({
  base: './',
  plugins: [solid()],
  worker: { format: 'es' },
  // rhino3dm's loader contains a Node-only `require("ws")`; point it at an empty module for the browser build.
  resolve: { alias: [{ find: /^ws$/, replacement: fileURLToPath(new URL('./src/io/empty.ts', import.meta.url)) }] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1100 },
});

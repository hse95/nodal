import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// `base: './'` keeps every asset URL relative so the static build works
// unchanged under any GitHub Pages sub-path (https://user.github.io/repo/).
export default defineConfig({
  base: './',
  plugins: [solid()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});

import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';

// `base: './'` keeps every asset URL relative so the static build works
// unchanged under any GitHub Pages sub-path (https://user.github.io/repo/).
/**
 * Writes the service worker that makes the app work offline. It is generated at build time so that it
 * carries the list of built files and changes whenever they do, which is what makes browsers update it.
 */
function offline(): import('vite').Plugin {
  return {
    name: 'nodal-offline', apply: 'build',
    generateBundle(_o, bundle) {
      const files = Object.keys(bundle).filter(f => !f.endsWith('.map')).sort();
      let h = 5381; for (const ch of files.join('|')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
      const sw = `// Generated at build time. Offline support for Nodal: everything the app needs is kept in a cache.
const CACHE = 'nodal-${h.toString(36)}';
const FILES = ${JSON.stringify(['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...files])};
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => undefined)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nodal-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;          // other sites (and every POST) go straight to the network
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true }).then(r => r || Response.error()))); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}
export default defineConfig({
  base: './',
  plugins: [solid(), offline()],
  worker: { format: 'es' },
  // rhino3dm's loader contains a Node-only `require("ws")`; point it at an empty module for the browser build.
  resolve: { alias: [{ find: /^ws$/, replacement: fileURLToPath(new URL('./src/io/empty.ts', import.meta.url)) }] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1100 },
});

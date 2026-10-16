import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const listPublic = (dir: string, root = dir): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listPublic(p, root) : [relative(root, p).split('\\').join('/')];
  });

// Emits sw.js with a precache list of every built file, so the game works offline after the first visit.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['./', ...Object.keys(bundle), ...listPublic('public')].filter((f) => !f.endsWith('.map'));
      const hash = createHash('sha1').update(files.join('\n'));
      for (const f of listPublic('public')) hash.update(readFileSync(join('public', f)));
      const version = hash.digest('hex').slice(0, 10);
      const source = SW.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files.map((f) => (f === './' ? f : './' + f))));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

const SW = `const CACHE = 'av-__VERSION__';
const FILES = __FILES__;
const FONTS = 'av-fonts';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // re-issued as a plain CORS request: passing the page's request through fails for the font CSS
    const net = caches.open(FONTS).then((c) => fetch(url.href, { mode: 'cors', credentials: 'omit' }).then(async (r) => { if (r.ok) await c.put(url.href, r.clone()); return r; }));
    e.waitUntil(net.catch(() => {}));
    e.respondWith(caches.match(url.href, { cacheName: FONTS }).then((hit) => hit || net));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./', { cacheName: CACHE })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
`;

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
});

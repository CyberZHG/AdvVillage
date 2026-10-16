/// <reference types="vite/client" />

export function registerSW() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  navigator.serviceWorker.addEventListener('controllerchange', warmFonts, { once: true });
}

// On the first visit the font loads before the worker controls the page, so fetch it again through the worker.
async function warmFonts() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
  if (!link) return;
  try {
    const css = await (await fetch(link.href)).text();
    await Promise.all([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => fetch(m[1], { mode: 'cors' })));
  } catch { /* offline */ }
}

// iOS Safari ignores user-scalable=no, so double-tap and pinch zoom have to be blocked by hand.
export function blockZoom() {
  const stop = (e: Event) => e.preventDefault();
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, stop, { passive: false });
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (now - last < 350 && e.cancelable && !(e.target as HTMLElement).closest('input,textarea,select')) e.preventDefault();
    last = now;
  }, { passive: false });
}

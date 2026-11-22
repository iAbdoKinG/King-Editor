/**
 * Registers the app-shell service worker in production builds only.
 * The worker caches application files — never user media.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
  });
}

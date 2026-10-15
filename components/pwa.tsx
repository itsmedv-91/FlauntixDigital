'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker. A component rather than an inline script so it
 * is typed and can be dropped from the tree in one place.
 *
 * Registration is skipped in development: a worker caching a dev build's
 * chunks produces mystifying stale-module errors on the next edit.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    // After load, so it never competes with the first render for bandwidth.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}

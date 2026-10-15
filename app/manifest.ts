import type { MetadataRoute } from 'next';

/**
 * Served at /manifest.webmanifest. Written as a route rather than a static file
 * so the name and theme colour cannot drift from the rest of the app.
 *
 * `start_url` is /dashboard, not /: an installed app that opens on the marketing
 * redirect and then bounces is a worse first impression than one that lands on
 * the sign-in page when the session has gone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Flauntix HQ',
    short_name: 'Flauntix',
    description: 'Clients, content, time, invoices and team chat for Flauntix Digital.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f5f9',
    theme_color: '#6D4AFF',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My tasks', url: '/tasks' },
      { name: 'Log time', url: '/time' },
      { name: 'Content calendar', url: '/content' },
    ],
  };
}

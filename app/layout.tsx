import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ServiceWorker } from '@/components/pwa';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Flauntix HQ', template: '%s · Flauntix HQ' },
  description: 'Clients, CRM, projects, tasks, time and team chat for Flauntix Digital.',
  robots: { index: false, follow: false },
  // Installable as an app on a phone. The manifest is app/manifest.ts.
  applicationName: 'Flauntix HQ',
  appleWebApp: { capable: true, title: 'Flauntix', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#6D4AFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Flauntix HQ', template: '%s · Flauntix HQ' },
  description: 'Clients, CRM, projects, tasks, time and team chat for Flauntix Digital.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#6D4AFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}

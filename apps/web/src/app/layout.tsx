import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

// One family throughout; its width axis does the work of a display face (see `font-stretch-*`).
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo' });

export const metadata: Metadata = {
  title: { default: 'Bookmark Captain', template: '%s · Bookmark Captain' },
  description: 'Every post you saved, on every platform, in one inbox.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1822' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

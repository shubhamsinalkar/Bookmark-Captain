import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';
import { themeScript } from '@/lib/theme';
import { Providers } from './providers';
import './globals.css';

// Instrument Sans for the interface; its serif sibling only for display headlines.
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-instrument-sans',
});
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
});

export const metadata: Metadata = {
  title: { default: 'Bookmark Captain', template: '%s · Bookmark Captain' },
  description: 'Every post you saved, on every platform, in one inbox.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e13' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets `data-theme` on <html> before React hydrates.
    <html
      lang="en"
      className={`${instrumentSans.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

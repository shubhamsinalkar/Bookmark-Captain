import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// All apps share the monorepo-root `.env`. Next.js has already loaded (and cached) env files
// from apps/web by the time this runs, so `forceReload` is required for the root file to apply.
loadEnvConfig(
  path.resolve(process.cwd(), '../..'),
  process.env.NODE_ENV !== 'production',
  { info: () => undefined, error: console.error },
  true,
);

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Lets the end-to-end suite build a separate copy (pointed at its own API) without
  // overwriting the regular build output.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // Dev only: lets a phone on the same Wi-Fi load the dev server by this computer's local IP
  // (see "Open it on your phone" in docs/USER_GUIDE.md). Private network ranges only.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@bc/shared'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }],
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;

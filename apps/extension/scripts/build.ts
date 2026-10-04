import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type BuildOptions, build, context } from 'esbuild';
import { z } from 'zod';
import { ADAPTERS } from '../src/platforms/registry';
import { SITE_SCRIPTS } from '../src/platforms/sites/constants';
import { renderIcon } from './icons';
import { buildManifest, ICON_SIZES } from './manifest';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src');
// EXTENSION_OUT_DIR lets the end-to-end suite build a copy pointed at its own servers.
const outdir = path.resolve(root, process.env.EXTENSION_OUT_DIR || 'dist');
const watch = process.argv.includes('--watch');

try {
  process.loadEnvFile(path.resolve(root, '../../.env'));
} catch {
  // No .env: use the real environment (CI, release builds).
}

// The extension talks to the same public URLs as the browser does.
const config = z.object({ apiUrl: z.url(), webUrl: z.url() }).parse({
  apiUrl: process.env.EXTENSION_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
  webUrl: process.env.EXTENSION_WEB_URL ?? process.env.WEB_URL,
});
const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')));

const common: BuildOptions = {
  bundle: true,
  platform: 'browser',
  target: 'chrome116',
  outdir,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  define: {
    __API_URL__: JSON.stringify(config.apiUrl),
    __WEB_URL__: JSON.stringify(config.webUrl),
    __VERSION__: JSON.stringify(version),
  },
};

/**
 * Content scripts come in pairs, a main-world tap and an isolated reader: one pair per
 * built-in adapter, plus the generic pair every learned site runs.
 */
const entry = (file: string) => file.replace(/\.js$/, '');
const scriptPairs: [string, string][] = [
  ...ADAPTERS.flatMap((adapter): [string, string][] => [
    [entry(adapter.scripts.main), path.join(src, `platforms/${adapter.platform}/main.ts`)],
    [entry(adapter.scripts.content), path.join(src, `platforms/${adapter.platform}/content.ts`)],
  ]),
  [entry(SITE_SCRIPTS.main), path.join(src, 'platforms/sites/main.ts')],
  [entry(SITE_SCRIPTS.content), path.join(src, 'platforms/sites/content.ts')],
];
const platformEntries: Record<string, string> = Object.fromEntries(scriptPairs);

/** Test builds: sites to grant up front (comma-separated URLs). */
const grantHosts = (process.env.EXTENSION_GRANT_HOSTS ?? '').split(',').filter(Boolean);

const bundles: BuildOptions[] = [
  // The service worker is declared as an ES module in the manifest.
  { ...common, entryPoints: { background: path.join(src, 'background/index.ts') }, format: 'esm' },
  // Content scripts and classic <script> tags must be plain scripts.
  { ...common, entryPoints: { bridge: path.join(src, 'content/bridge.ts') }, format: 'iife' },
  { ...common, entryPoints: { popup: path.join(src, 'popup/popup.ts') }, format: 'iife' },
  { ...common, entryPoints: platformEntries, format: 'iife' },
];

async function writeStaticFiles() {
  await mkdir(path.join(outdir, 'icons'), { recursive: true });
  const manifest = buildManifest({ version, ...config, grantHosts });
  await writeFile(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await copyFile(path.join(src, 'popup/popup.html'), path.join(outdir, 'popup.html'));
  await copyFile(path.join(src, 'popup/popup.css'), path.join(outdir, 'popup.css'));
  await Promise.all(
    ICON_SIZES.map((size) =>
      writeFile(path.join(outdir, `icons/icon-${size}.png`), renderIcon(size)),
    ),
  );
}

await rm(outdir, { recursive: true, force: true });
await writeStaticFiles();

if (watch) {
  const contexts = await Promise.all(bundles.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`Watching… load ${outdir} as an unpacked extension (API ${config.apiUrl}).`);
} else {
  await Promise.all(bundles.map((options) => build(options)));
  console.log(`Built extension into ${outdir} (API ${config.apiUrl}, web ${config.webUrl}).`);
}

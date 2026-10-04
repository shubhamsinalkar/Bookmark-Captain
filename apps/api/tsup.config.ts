import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they must be bundled into the output.
  // Everything in this app's `dependencies` stays external and is installed at deploy time.
  noExternal: [/^@bc\//],
});

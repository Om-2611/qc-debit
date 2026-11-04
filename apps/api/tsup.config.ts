import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  splitting: false,
  // Workspace packages ship as TypeScript source, so they are bundled; npm dependencies stay external.
  noExternal: [/^@dalmia\//],
});

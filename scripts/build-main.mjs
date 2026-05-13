import * as esbuild from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('dist/main', { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
};

await esbuild.build({
  ...shared,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
});

await esbuild.build({
  ...shared,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/main/preload.js',
});

console.log('Main + preload built.');

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStyles } from '../scripts/build-css.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const generated = resolve(here, '.generated/styles.css');

/** Compiles the library stylesheet from source, and again whenever a source file changes. */
function libraryStyles(): Plugin {
  const write = async () => {
    mkdirSync(dirname(generated), { recursive: true });
    writeFileSync(generated, await buildStyles());
  };
  return {
    name: 'crfmt-library-styles',
    async buildStart() {
      await write();
    },
    configureServer(server) {
      // src/styles/*.css is read by the build script, not imported, so watch it explicitly.
      const src = resolve(root, 'src');
      server.watcher.add(src);
      server.watcher.on('change', (file) => {
        if (file.startsWith(src) && !/\.test\.tsx?$/.test(file)) void write();
      });
    },
  };
}

// The demo imports the package by name, exactly as a consumer would; the
// aliases point those imports at the sources.
export default defineConfig({
  root: here,
  plugins: [libraryStyles(), react()],
  resolve: {
    alias: [
      { find: '@pepperhorn/react-music-tools/styles.css', replacement: generated },
      { find: '@pepperhorn/react-music-tools/fonts.css', replacement: resolve(root, 'src/styles/fonts.css') },
      { find: /^@pepperhorn\/react-music-tools$/, replacement: resolve(root, 'src/index.ts') },
    ],
  },
  server: { host: '0.0.0.0', port: 5180 },
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true },
});

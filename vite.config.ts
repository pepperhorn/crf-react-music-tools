import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Library build: ESM only, React left to the host, class names kept readable
// (not minified) so a host's own Tailwind can scan dist/ (see README).
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    target: 'es2020',
    minify: false,
    sourcemap: false,
    copyPublicDir: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        // Next to their .d.ts files: dist/metronome/index.js + index.d.ts.
        'metronome/index': resolve(import.meta.dirname, 'src/metronome/index.ts'),
        'tuner/index': resolve(import.meta.dirname, 'src/tuner/index.ts'),
        'toolbar/index': resolve(import.meta.dirname, 'src/toolbar/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});

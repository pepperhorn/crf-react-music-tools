import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: `node` (no DOM) for pure logic in *.test.ts, and `dom`
// (jsdom + Testing Library) for components and hooks in *.test.tsx.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.dom.ts'],
        },
      },
    ],
  },
});

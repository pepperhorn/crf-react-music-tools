import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library does not auto-cleanup outside its own globals setup.
afterEach(() => {
  cleanup();
});

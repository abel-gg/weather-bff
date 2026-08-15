import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library only auto-registers its cleanup when Vitest globals are on.
 * Globals are off here (explicit imports keep test files honest about what they
 * use), so unmounting is wired up by hand.
 *
 * Without this, every render accumulates in the same document — queries start
 * finding duplicate elements, and timers from unmounted components keep firing
 * after the environment is gone.
 */
afterEach(() => {
  cleanup();
});

import { afterEach } from 'vitest';

// Component tests unmount after each test; Node tests have no DOM to clean.
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});

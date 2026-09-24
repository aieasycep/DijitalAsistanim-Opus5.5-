import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  if (typeof window !== 'undefined') cleanup();
});

/** Installs `value` as `target[key]` unless the environment already provides it. */
function polyfill(target: object, key: string, value: unknown): void {
  if (!(key in target))
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

if (typeof window !== 'undefined') {
  // jsdom lacks these browser APIs used by Radix, cmdk and Recharts.
  class ResizeObserverStub {
    observe(): void {
      /* jsdom has no layout; nothing to observe */
    }
    unobserve(): void {
      /* see observe */
    }
    disconnect(): void {
      /* see observe */
    }
  }
  polyfill(globalThis, 'ResizeObserver', ResizeObserverStub);
  polyfill(window, 'matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  polyfill(Element.prototype, 'scrollIntoView', function scrollIntoView() {
    /* jsdom has no scrolling */
  });
  polyfill(Element.prototype, 'hasPointerCapture', () => false);
  polyfill(Element.prototype, 'releasePointerCapture', () => undefined);
}

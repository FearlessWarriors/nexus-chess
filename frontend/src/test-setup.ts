/**
 * test-setup.ts — Vitest global setup for jsdom + MUI React testing
 */
import '@testing-library/jest-dom';

// ─── jsdom polyfills for MUI (Emotion/CSS-in-JS) ──────────────────────────

// matchMedia polyfill
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// ResizeObserver polyfill
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).ResizeObserver = ResizeObserverStub;

// CSS.supports polyfill
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (window as any).CSS === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).CSS = {};
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
((window as any).CSS as any).supports = () => true;

// scrollTo polyfill
window.scrollTo = () => {};

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia; Radix Accordion probes it.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom lacks ResizeObserver / PointerEvent bits used by Radix primitives.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error test shim
globalThis.ResizeObserver = globalThis.ResizeObserver || RO;
// @ts-expect-error test shim
HTMLElement.prototype.scrollIntoView = HTMLElement.prototype.scrollIntoView || (() => {});
// @ts-expect-error test shim
HTMLElement.prototype.hasPointerCapture = HTMLElement.prototype.hasPointerCapture || (() => false);
// @ts-expect-error test shim
HTMLElement.prototype.releasePointerCapture =
  HTMLElement.prototype.releasePointerCapture || (() => {});

// Silence toast noise; individual tests can override.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));
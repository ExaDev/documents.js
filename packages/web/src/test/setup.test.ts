import { describe, expect, it, vi } from "vitest";

// setup.ts itself runs as this project's setupFiles entry (vite.config.ts), so by the time this test file runs, window.matchMedia, ResizeObserver, and document.fonts are already installed -- this file tests that installation directly, since nothing else in the suite exercises matchMedia's listener bookkeeping or ResizeObserver's own no-op contract.

describe("window.matchMedia stub", () => {
  it("reports no match for any query, and echoes the query back on .media", () => {
    const list = window.matchMedia("(prefers-color-scheme: dark)");
    expect(list.matches).toBe(false);
    expect(list.media).toBe("(prefers-color-scheme: dark)");
  });

  it("invokes a listener added via addEventListener when an event is dispatched, and stops once removed", () => {
    const list = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = vi.fn();
    list.addEventListener("change", listener);
    // dispatchEvent's own return value follows the real EventTarget contract: true means the event was not cancelled.
    expect(list.dispatchEvent({} as MediaQueryListEvent)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    list.removeEventListener("change", listener);
    list.dispatchEvent({} as MediaQueryListEvent);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-function EventListenerObject passed to addEventListener/removeEventListener rather than throwing", () => {
    const list = window.matchMedia("(prefers-color-scheme: dark)");
    const listenerObject: EventListenerObject = { handleEvent: vi.fn() };
    expect(() => {
      list.addEventListener("change", listenerObject);
      list.removeEventListener("change", listenerObject);
    }).not.toThrow();
  });

  it("exposes the legacy addListener/removeListener members as callable no-ops", () => {
    const list = window.matchMedia("(prefers-color-scheme: dark)");
    expect(() => {
      list.addListener(null);
      list.removeListener(null);
    }).not.toThrow();
  });
});

describe("ResizeObserver stub", () => {
  it("constructs and exposes observe/unobserve/disconnect as callable no-ops", () => {
    const observer = new ResizeObserver(() => {});
    expect(() => {
      observer.observe(document.body);
      observer.unobserve(document.body);
      observer.disconnect();
    }).not.toThrow();
  });
});

describe("document.fonts stub", () => {
  it("exposes addEventListener/removeEventListener as callable no-ops", () => {
    expect(() => {
      document.fonts.addEventListener("loadingdone", () => {});
      document.fonts.removeEventListener("loadingdone", () => {});
    }).not.toThrow();
  });
});

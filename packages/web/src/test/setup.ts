/// <reference lib="dom" />

// jsdom implements no IndexedDB of its own, and src/db/dexie.ts constructs its Dexie instance at module scope -- every test that imports it (directly, or transitively via a hook) needs a real IndexedDB implementation already installed globally before that import runs, not just within the one test file that happens to exercise it.
import "fake-indexeddb/auto";

declare global {
  // React's own opt-in flag (no ambient type ships for it) -- see the assignment below for what it does. eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// React's act() (imported from "react" itself since React 19) only wraps state updates/effects synchronously when it knows it's running inside a test harness -- without this flag it warns "not configured to support act(...)" on every render and the flush act() exists to guarantee is no longer guaranteed. Set once, here, rather than per test file, since every jsdom-environment test that mounts a real component (contentBlocks.test.tsx today, any future one) needs it.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships neither API. MantineProvider's color-scheme hook calls window.matchMedia unconditionally on mount (to detect the OS "prefers-color-scheme: dark" query), and several Mantine components (Spoiler among them) measure their own content box via ResizeObserver -- both run the moment any Mantine component mounts, not only in a test that exercises colour-scheme switching or resizing itself, so every jsdom-environment test that mounts one needs both stubbed up front rather than per test file. Guarded on `typeof window`: this setup file loads for every unit test regardless of environment, and router.procedures.test.ts's own `@vitest-environment node` pragma (see that file's own top-of-file comment for why) means `window` genuinely does not exist while this file runs there.
if (typeof window !== "undefined") {
  class StubResizeObserver implements ResizeObserver {
    // No-op stubs, not placeholders for missing logic: nothing under test measures a real resize, so there is genuinely nothing for any of the three to do beyond satisfying the interface Mantine's hooks construct against.
    observe(): void {
      return;
    }
    unobserve(): void {
      return;
    }
    disconnect(): void {
      return;
    }
  }
  globalThis.ResizeObserver = StubResizeObserver;

  type ChangeListener = (event: MediaQueryListEvent) => void;

  const asChangeListener = (
    listener: EventListenerOrEventListenerObject | null,
  ): ChangeListener | undefined => {
    if (typeof listener === "function") return listener;
    return undefined;
  };

  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<ChangeListener>();
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        const changeListener = asChangeListener(listener);
        if (changeListener !== undefined) listeners.add(changeListener);
      },
      removeEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        const changeListener = asChangeListener(listener);
        if (changeListener !== undefined) listeners.delete(changeListener);
      },
      // The legacy pre-EventTarget MediaQueryList API: still the type's own required members even though nothing in this package's dependency tree calls them today.
      addListener: () => {
        return;
      },
      removeListener: () => {
        return;
      },
      dispatchEvent: (event) => {
        for (const listener of listeners) {
          listener(event as MediaQueryListEvent);
        }
        return true;
      },
    };
  };
}

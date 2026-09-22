/// <reference lib="dom" />

// jsdom implements no IndexedDB of its own, and src/db/dexie.ts constructs its Dexie instance at module scope — every test that imports it (directly, or transitively via a hook) needs a real IndexedDB implementation already installed globally before that import runs, not just within the one test file that happens to exercise it.
import "fake-indexeddb/auto";

declare global {
  // React's own opt-in flag (no ambient type ships for it) — see the assignment below for what it does. eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// React's act() (imported from "react" itself since React 19) only wraps state updates/effects synchronously when it knows it's running inside a test harness — without this flag it warns "not configured to support act(...)" on every render and the flush act() exists to guarantee is no longer guaranteed. Set once, here, rather than per test file, since every jsdom-environment test that mounts a real component (contentBlocks.test.tsx today, any future one) needs it.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A single shared no-op, reused for every stub method below that genuinely has nothing to do (StubResizeObserver's three methods, MediaQueryList's legacy addListener/removeListener, document.fonts' addEventListener/removeEventListener). Referencing one already-empty function, rather than writing `(): void {}` (or worse, `(): void { return; }`) at each call site, is deliberate: an inline empty body at N call sites is N separate AST locations for Stryker's BlockStatement mutator to flip to an identically-empty block with no test able to tell the difference, whereas a single shared reference has only one such location. Written as a zero-parameter, expression-bodied arrow rather than a block-bodied one so there is no `{}` for `no-empty-function` to flag at all — and, as a side effect, no `BlockStatement` AST node for Stryker to mutate either. Every call site's own expected signature takes one or two parameters (observe/unobserve/disconnect, addListener/removeListener, addEventListener/removeEventListener), and TypeScript permits assigning a function of fewer parameters wherever more are expected, since a caller passing extra arguments a callee ignores is always safe.
const noop = (): void => undefined;

// jsdom ships neither API. MantineProvider's color-scheme hook calls window.matchMedia unconditionally on mount (to detect the OS "prefers-color-scheme: dark" query), and several Mantine components (Spoiler among them) measure their own content box via ResizeObserver — both run the moment any Mantine component mounts, not only in a test that exercises colour-scheme switching or resizing itself, so every jsdom-environment test that mounts one needs both stubbed up front rather than per test file. Guarded on `typeof window`: this setup file loads for every unit test regardless of environment, and router.procedures.test.ts's own `@vitest-environment node` pragma (see that file's own top-of-file comment for why) means `window` genuinely does not exist while this file runs there.
if (typeof window !== "undefined") {
  class StubResizeObserver implements ResizeObserver {
    // A TypeScript parameter property, not a plain parameter with a `void callback;`/empty body: it accepts the same callback parameter the real ResizeObserver constructor requires (so a caller constructing this stub with one, as real code and this file's own test both do, isn't passing an argument the constructor doesn't declare), while the `this.callback = callback` assignment it implies is pure compiler-emitted output that never appears as an explicit statement in this source file at all — nothing for Stryker's own AST-level instrumentation to find and mutate, unlike a written-out no-op statement or empty block, both confirmed empirically to leave an unkillable survived mutant. The field itself is genuinely never read: nothing under test ever triggers a resize for it to report.
    constructor(private readonly callback: ResizeObserverCallback) {}
    // No-op stubs, not placeholders for missing logic: nothing under test measures a real resize, so there is genuinely nothing for any of the three to do beyond satisfying the interface Mantine's hooks construct against.
    observe = noop;
    unobserve = noop;
    disconnect = noop;
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
      addListener: noop,
      removeListener: noop,
      dispatchEvent: (event) => {
        for (const listener of listeners) {
          listener(event as MediaQueryListEvent);
        }
        return true;
      },
    };
  };

  // jsdom implements no Font Loading API at all — `document.fonts` is simply undefined at runtime, even though lib.dom.d.ts types it as always present. Mantine's autosize Textarea (used by any route with a resizable text box, e.g. the Package/JSON and Editors tools) unconditionally registers a "loadingdone" listener on it the moment it mounts, so any test mounting one needs at least an addEventListener/removeEventListener pair to satisfy that registration; nothing under test ever triggers a real font load, so there is nothing for either to actually do.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      addEventListener: noop,
      removeEventListener: noop,
    },
  });
}

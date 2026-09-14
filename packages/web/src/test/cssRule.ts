/// <reference lib="dom" />

// A vanilla-extract *.css.ts module's `style()` call compiles down to a generated class name string plus a real stylesheet, injected into the document by Vite's own CSS-handling client during a test run (vite.config.ts's `css: true` on the unit project is what makes that injection reach jsdom's `document.styleSheets` at all -- Vitest stubs CSS out to an empty module by default). *.css.ts files are excluded from Stryker's own mutate glob (see stryker.config.ts's own comment on why -- vanilla-extract's build-time evaluation of `style()` sits outside Stryker's mutant-switching instrumentation, so a mutated style value is provably unobservable no matter how the test reads it back), but the styles this package ships are still real, testable behaviour worth covering in the ordinary test suite; this helper is what makes that possible.

// Mounts a bare element carrying the given generated class name, appended to `document.body` so `getComputedStyle` resolves it against the real cascade. Callers own removing it (via the returned cleanup) once done.
export function mountWithClassName(className: string): {
  element: HTMLDivElement;
  cleanup: () => void;
} {
  const element = document.createElement("div");
  element.className = className;
  document.body.appendChild(element);
  return {
    element,
    cleanup: () => {
      element.remove();
    },
  };
}

/// <reference lib="dom" />

// A vanilla-extract *.css.ts module's `style()` call compiles down to a generated class name string plus a real stylesheet, injected into the document by Vite's own CSS-handling client during a test run (vitest.config.ts's `css: true` is what makes that injection reach jsdom's `document.styleSheets` at all -- Vitest stubs CSS out to an empty module by default). That real stylesheet is what these helpers read back from, which is the only way to kill a Stryker mutant that changes one of the literal values passed to `style()`: mounting an element with the generated class name and asserting on `getComputedStyle` (or, for a pseudo-element, the raw `CSSStyleRule` itself, since jsdom's `getComputedStyle` throws "Not implemented" for a pseudo-element argument).

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

// Finds the CSSOM rule for `.<className>` (or `.<className><pseudo>` when a pseudo-element selector suffix, e.g. "::before", is given) across every stylesheet vanilla-extract has injected. Throws rather than returning undefined: a missing rule means the class name itself is wrong, which every caller wants surfaced immediately rather than as a confusing downstream "cannot read property of undefined".
export function findClassRule(className: string, pseudo = ""): CSSStyleRule {
  const selector = `.${className}${pseudo}`;
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
        return rule;
      }
    }
  }
  throw new Error(`no stylesheet rule found for selector "${selector}"`);
}

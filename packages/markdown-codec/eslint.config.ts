import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established -- a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
  nonNullAssertion: "off",
  isomorphic: true,
  // scripts/ holds a standalone build step importing from ../dist, the same reason test/ is ignored.
  additionalIgnores: ["scripts"],
  // Passed to the shared config rather than declared here, because flat config replaces a same-key rule instead of merging it: a second no-restricted-imports over runtime src would silently drop the Worker-isomorphism Node-builtin ban while still reporting these.
  //
  // This package hand-writes its own CommonMark+GFM scanner, parser, and renderer, the same bet pdf-codec makes against pdf-lib and pdfjs-dist. Depending on any existing markdown library would defeat the entire reason it exists, so each one is banned by name rather than by guessing at specifiers -- every module of every library, not just its main entry point.
  additionalRestrictedImportPatterns: [
    {
      group: ["micromark*", "micromark*/**"],
      message:
        "Hand-write the scanner/parser instead of depending on micromark -- see README Architecture.",
    },
    {
      group: ["remark*", "remark*/**"],
      message:
        "Hand-write the AST/transform instead of depending on remark -- see README Architecture.",
    },
    {
      group: ["marked", "marked/**"],
      message:
        "Hand-write the parser/renderer instead of depending on marked -- see README Architecture.",
    },
    {
      group: ["markdown-it*", "markdown-it*/**"],
      message:
        "Hand-write the parser/renderer instead of depending on markdown-it -- see README Architecture.",
    },
    {
      group: ["commonmark", "commonmark/**"],
      message:
        "Hand-write the CommonMark parser instead of depending on the commonmark.js reference implementation -- see README Architecture.",
    },
    {
      group: ["mdast*", "mdast*/**"],
      message:
        "Define this package's own AST types instead of depending on mdast -- see README Architecture.",
    },
    {
      group: ["unified", "unified/**"],
      message:
        "Hand-write the pipeline instead of depending on unified -- see README Architecture.",
    },
    {
      group: ["turndown", "turndown/**"],
      message:
        "Hand-write the HTML-to-markdown conversion instead of depending on turndown -- see README Architecture.",
    },
    {
      group: ["showdown", "showdown/**"],
      message:
        "Hand-write the parser/renderer instead of depending on showdown -- see README Architecture.",
    },
  ],
});

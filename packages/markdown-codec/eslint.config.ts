import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off, deliberately, not merely unaddressed, but for ONE reason rather than the two this comment used to give. src/image/image.test.ts's JPEG marker-walking fixtures carry literals that are each test's own deliberately exact payload: the marker, length, precision, width and height bytes are the point of each case, adjacent tests differ by a single byte to exercise one state-machine transition, and a parameterised builder covering every truncation and corruption edge risks silently changing what a test asserts. Naming them would hide the difference that gives each case its meaning, so they stay literal by judgement.
  //
  // The second reason this comment previously gave was wrong and is withdrawn. It claimed src/html/html.ts's HTML_BLOCK_TYPES, which enumerates the HtmlBlockType union as a runtime array, could not be satisfied without an unwanted `as HtmlBlockType` assertion. It can: a named `const` infers its own literal type, so per-value constants satisfy the union with no assertion at all, exactly as epub-codec's zip.ts already does for its PKWARE signature bytes while running with this rule enforced. That array is ordinary naming work and is not the reason this flag is off.
  magicNumbers: "off",
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [],
  // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established — a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
  nonNullAssertion: "off",
  isomorphic: true,
  // scripts/ holds a standalone build step importing from ../dist, the same reason test/ is ignored.
  additionalIgnores: ["scripts"],
  // Passed to the shared config rather than declared here, because flat config replaces a same-key rule instead of merging it: a second no-restricted-imports over runtime src would silently drop the Worker-isomorphism Node-builtin ban while still reporting these.
  //
  // This package hand-writes its own CommonMark+GFM scanner, parser, and renderer, the same bet pdf-codec makes against pdf-lib and pdfjs-dist. Depending on any existing markdown library would defeat the entire reason it exists, so each one is banned by name rather than by guessing at specifiers — every module of every library, not just its main entry point.
  additionalRestrictedImportPatterns: [
    {
      group: ["micromark*", "micromark*/**"],
      message:
        "Hand-write the scanner/parser instead of depending on micromark — see README Architecture.",
    },
    {
      group: ["remark*", "remark*/**"],
      message:
        "Hand-write the AST/transform instead of depending on remark — see README Architecture.",
    },
    {
      group: ["marked", "marked/**"],
      message:
        "Hand-write the parser/renderer instead of depending on marked — see README Architecture.",
    },
    {
      group: ["markdown-it*", "markdown-it*/**"],
      message:
        "Hand-write the parser/renderer instead of depending on markdown-it — see README Architecture.",
    },
    {
      group: ["commonmark", "commonmark/**"],
      message:
        "Hand-write the CommonMark parser instead of depending on the commonmark.js reference implementation — see README Architecture.",
    },
    {
      group: ["mdast*", "mdast*/**"],
      message:
        "Define this package's own AST types instead of depending on mdast — see README Architecture.",
    },
    {
      group: ["unified", "unified/**"],
      message:
        "Hand-write the pipeline instead of depending on unified — see README Architecture.",
    },
    {
      group: ["turndown", "turndown/**"],
      message:
        "Hand-write the HTML-to-markdown conversion instead of depending on turndown — see README Architecture.",
    },
    {
      group: ["showdown", "showdown/**"],
      message:
        "Hand-write the parser/renderer instead of depending on showdown — see README Architecture.",
    },
  ],
});

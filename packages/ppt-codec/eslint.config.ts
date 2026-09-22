import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [
    "@typescript-eslint/consistent-return",
    "@typescript-eslint/no-use-before-define",
    "@typescript-eslint/strict-boolean-expressions",
    "@typescript-eslint/strict-void-return",
    "@typescript-eslint/switch-exhaustiveness-check",
    "exadev/no-mutable-union-array-param",
    "tsdoc/syntax",
  ],
  isomorphic: true,
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why — this package's own [MS-PPT] record-tree reader/writer genuinely mutates several array/object parameters in place. Tracked for burn-down.
  preferReadonlyParams: "off",
  // Passed to the shared config rather than declared in a second block, because flat config replaces a same-key rule instead of merging it: a second no-restricted-imports over runtime src would silently drop the Worker-isomorphism Node-builtin ban while still reporting these.
  //
  // This package hand-writes its own [MS-PPT] record-tree reader, the same bet every sibling codec here makes against a heavyweight format library. The compound-file container below it is the one piece deliberately not hand-written again: archive-codec already owns bounded [MS-CFB] reading for the family, so a second implementation of it here would be the duplication that package's own extraction exists to prevent.
  additionalRestrictedImportPatterns: [
    {
      group: ["cfb", "cfb/**"],
      message:
        "Use archive-codec's readCompoundFile for [MS-CFB] container reading instead of a second compound-file implementation — see README Architecture.",
    },
    {
      group: ["officeparser", "officeparser/**"],
      message:
        "Hand-write the [MS-PPT] record-tree read instead of depending on officeparser — see README Architecture.",
    },
    {
      group: ["node-pptx", "node-pptx/**", "pptxgenjs", "pptxgenjs/**"],
      message:
        "These target the OOXML pptx format, which is ooxml.js's territory — this package reads the PowerPoint 97-2003 binary format instead. See README Architecture.",
    },
  ],
});

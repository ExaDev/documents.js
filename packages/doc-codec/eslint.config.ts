import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [
    "@typescript-eslint/method-signature-style",
    "@typescript-eslint/no-shadow",
    "@typescript-eslint/strict-boolean-expressions",
    "@typescript-eslint/strict-void-return",
    "tsdoc/syntax",
  ],
  isomorphic: true,
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why — this package's own hand-rolled [MS-DOC] readers/writers genuinely mutate several array/object parameters in place. Tracked for burn-down.
  preferReadonlyParams: "off",
  // Passed to the shared config rather than declared as a second rule block: flat config replaces a same-key rule instead of merging it, so a second no-restricted-imports here would silently switch the Worker-isomorphism Node-builtin ban back off while still reporting these.
  //
  // This package hand-parses [MS-DOC]'s binary structures against the published specification, the same bet markdown-codec makes against every markdown library and pdf-codec against pdf-lib. Depending on an existing .doc reader would defeat the reason it exists, so each one is banned by name — every module of every library, not just its main entry point.
  additionalRestrictedImportPatterns: [
    {
      group: ["word-extractor", "word-extractor/**"],
      message:
        "Hand-parse [MS-DOC] instead of depending on word-extractor — see README Architecture.",
    },
    {
      group: ["mammoth", "mammoth/**"],
      message:
        "Hand-parse [MS-DOC] instead of depending on mammoth — see README Architecture.",
    },
    {
      group: ["cfb", "cfb/**"],
      message:
        "Read the compound-file container through archive-codec's own [MS-CFB] reader instead of depending on the cfb package — see README Architecture.",
    },
    {
      group: ["textract", "textract/**"],
      message:
        "Hand-parse [MS-DOC] instead of depending on textract — see README Architecture.",
    },
    {
      group: ["antiword*", "antiword*/**"],
      message:
        "Hand-parse [MS-DOC] instead of shelling out to antiword — see README Architecture.",
    },
  ],
});

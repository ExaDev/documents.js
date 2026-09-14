import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [
    "@typescript-eslint/consistent-return",
    "@typescript-eslint/method-signature-style",
    "@typescript-eslint/no-shadow",
    "@typescript-eslint/no-use-before-define",
    "@typescript-eslint/strict-boolean-expressions",
    "@typescript-eslint/switch-exhaustiveness-check",
    "tsdoc/syntax",
  ],
  isomorphic: true,
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why -- this package's own BIFF8 record readers/writers genuinely mutate a large number of array/object parameters in place. Tracked for burn-down.
  preferReadonlyParams: "off",
  additionalRestrictedImportPatterns: [
    {
      group: ["xlsx", "xlsx/**", "node-xlsx", "exceljs", "cfb", "cfb/**"],
      message:
        "Hand-write the BIFF8 record parsing against [MS-XLS] instead of depending on a spreadsheet library -- see README Architecture. The compound-file layer comes from archive-codec.",
    },
  ],
});

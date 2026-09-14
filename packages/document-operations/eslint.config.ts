import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [
    "@typescript-eslint/consistent-return",
    "@typescript-eslint/method-signature-style",
    "@typescript-eslint/promise-function-async",
    "@typescript-eslint/strict-void-return",
    "tsdoc/syntax",
  ],
  // One program covering src and the config files alike, so there is no second tsconfig to route anything to.
  projects: ["./tsconfig.json"],
  // Resolves document input by filesystem path via node:fs/promises (see src/io/document-input.ts) -- the same reason document-mcp, its one current consumer, is not held to Worker isomorphism either.
  isomorphic: false,
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why -- this package's own diagnostic/report builders genuinely mutate a handful of array/object parameters in place. Tracked for burn-down.
  preferReadonlyParams: "off",
});

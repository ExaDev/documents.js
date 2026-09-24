import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [
    "@typescript-eslint/no-shadow",
    "@typescript-eslint/strict-boolean-expressions",
  ],
  isomorphic: true,
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why — this package's own hand-rolled binary readers/writers genuinely mutate several array/object parameters in place. Tracked for burn-down.
  preferReadonlyParams: "off",
});

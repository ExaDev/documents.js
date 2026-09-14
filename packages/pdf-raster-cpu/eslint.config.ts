import { packageLintConfig } from "../../eslint.shared.ts";

// The shared library-package config as-is: Worker-isomorphic (no node:* builtins in runtime src, proved at runtime by the workerd suite), the default single-barrel policy, and no-non-null-assertion enforced -- this package is new, so it starts with none of the indexed-access debt the older packages carry a burn-down exemption for.
export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [
    "@typescript-eslint/no-use-before-define",
    "@typescript-eslint/strict-void-return",
  ],
  isomorphic: true,
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why -- src/stroke.ts's emitJoinWedge takes the caller's own output-polygon accumulator and pushes the join geometry it computes directly into it. Tracked for burn-down.
  preferReadonlyParams: "off",
});

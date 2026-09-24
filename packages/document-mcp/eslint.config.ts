import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [],
  // One program covering src and the config files alike, so there is no second tsconfig to route anything to.
  projects: ["./tsconfig.json"],
  // Runs under Node as a published binary, so Worker isomorphism does not apply.
  isomorphic: false,
  // dist-sea/ is this package's own SEA (single-executable application) bundle output — a multi-megabyte, fully-dependency-inlined .cjs file (see tsdown.sea.shared.ts), not source.
  additionalIgnores: ["dist-sea"],
  maxLines: "error",
});

import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: ["@typescript-eslint/strict-void-return"],
  projects: ["./tsconfig.json"],
  // Binds a plain node:http listener (src/server.ts), the same reason document-mcp's own HTTP transport is not held to Worker isomorphism either.
  isomorphic: false,
  // dist-sea/ is this package's own SEA (single-executable application) bundle output — a multi-megabyte, fully-dependency-inlined .cjs file (see tsdown.sea.shared.ts), not source, and linting it took over three minutes before this was added.
  additionalIgnores: ["dist-sea"],
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why — this package's own request-handling helpers genuinely mutate a couple of array/object parameters in place. Tracked for burn-down.
  preferReadonlyParams: "off",
});

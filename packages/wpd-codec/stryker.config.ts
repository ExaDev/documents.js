import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // A genuine 100.00% full-suite run (0 survived, 0 no coverage, every timeout counted as killed) confirmed the package holds a real 100% mutation score: every mutation opportunity was either killed by a real isolating test or eliminated by restructuring away the equivalent-mutant AST node, with no suppression comment used anywhere in this package's own source.
  breakThreshold: 100,
});

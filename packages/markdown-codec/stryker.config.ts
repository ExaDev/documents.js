import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Every mutant is genuinely killed by a real test, or the code it would have mutated has been restructured so the mutation opportunity no longer exists as an AST node, with no per-mutant ignore comments anywhere in this package. So the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

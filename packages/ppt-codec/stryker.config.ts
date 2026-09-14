import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Every mutant is genuinely killed by a real test, or the code it would have mutated has been restructured so the mutation opportunity no longer exists as an AST node (a redundant sort deleted once every consumer proved order-independent, an unreachable fallback branch removed once its guarantee was proved from its own inputs) -- no per-mutant ignore comments anywhere in this package. So the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

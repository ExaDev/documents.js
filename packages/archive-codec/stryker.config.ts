import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Every valid mutant is genuinely killed by a real test, or the code has been restructured so the mutation opportunity no longer exists as an AST node (a redundant guard removed, a manually bounds-checked loop replaced by one relying on the language's own out-of-range-is-undefined semantics, an algebraic-identity comparison restated as an explicit named branch) -- no Stryker-suppression comments anywhere in this package. So the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

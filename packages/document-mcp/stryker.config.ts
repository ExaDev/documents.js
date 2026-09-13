import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Every valid mutant is genuinely killed by a real test, or the code has been restructured so the mutation opportunity no longer exists as an AST node (a redundant type-narrowing guard removed once the value it defended against was actually unreachable, an inline builder split into a directly-testable pure function) -- no Stryker disable comments anywhere in this package. So the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

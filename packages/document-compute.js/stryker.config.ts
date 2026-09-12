import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // Every valid mutant is killed by a test, with no suppression anywhere in this package: where a mutation opportunity was genuinely equivalent (a comparison whose two spellings pick different branches that compute the same answer, an operator identity that holds for every value that can reach it, a guard nothing can trip), the code was restated so that opportunity does not exist in the AST at all rather than being excluded by name. The gate is therefore the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

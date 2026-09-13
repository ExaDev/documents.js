import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // Every mutant is genuinely killed by a real test, or the code it would have mutated has been restructured so the mutation opportunity no longer exists as an AST node (a redundant guard deleted, a manual bounds-checked loop replaced by one relying on the language's own out-of-range-is-undefined semantics, an algebraic-identity comparison restated so a boundary a real test can actually reach becomes reachable) -- no Stryker disable comments anywhere in this package. So the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

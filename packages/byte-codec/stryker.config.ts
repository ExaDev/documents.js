import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // Every mutant this package produces is killed by a real test, and nothing is suppressed by name: where a mutation was genuinely unobservable, the source states the same behaviour in a form that has no such mutation to make -- a loop bounded by the data it consumes rather than by a count kept in step with it, an exact iteration count rather than an inclusive-versus-exclusive comparison, a packed-bitfield key rather than a sum of scaled terms, the smallest of three distances rather than a chain of pairwise ties. So the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

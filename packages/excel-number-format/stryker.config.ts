import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // Every mutant is genuinely killed by a real test, or the code was restructured so that specific mutation opportunity no longer exists at all (a redundant guard removed, a manual bounds-checked loop replaced with a library call) -- never suppressed by name, so the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

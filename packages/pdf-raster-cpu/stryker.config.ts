import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // Every valid mutant is either killed or excluded via a justified Stryker disable comment (see coverage.ts, geometry.ts, rasteriser.ts, and stroke.ts for each one's equivalence proof), so the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});

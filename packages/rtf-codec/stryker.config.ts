import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // A genuine, non-incremental full run reached 100.00% across every valid mutant (0 survived, 0 no-coverage), so the break sits at the ceiling itself rather than floor-minus-timeout-margin: there is no headroom left for a timeout to flap into, and any future survivor is a real regression.
  breakThreshold: 100,
});

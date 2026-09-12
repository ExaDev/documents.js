import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Every mutant Stryker can find is either genuinely killed by a real, isolating test or the mutation opportunity itself was restructured out of existence (a static module-scope registry rebuilt per call, a regex whose anchor could never change its own output) -- none suppressed. Verified by a clean, from-scratch run (no incremental cache) with 0 survived and 0 no-coverage.
  breakThreshold: 100,
});

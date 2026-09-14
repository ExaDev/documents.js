import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Genuine 100% mutation score across every valid mutant, confirmed by a forced (non-incremental) full run: 0 survived, 0 no-coverage. Every mutant is either killed by a real isolating test or the code was restructured so the mutation opportunity no longer exists as an AST node — no per-mutant ignore comments anywhere in src/.
  breakThreshold: 100,
});

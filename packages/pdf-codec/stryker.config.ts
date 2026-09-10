import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // 15 minutes, not Stryker's default 5: the instrumented unit suite's single heaviest test (math-stretch.test.ts's whole-Unicode-range glyphId enumeration) alone measures ~28s instrumented on a fast local machine and has exceeded 90s on a GitHub runner -- the same instrumented suite that finishes the plain unit run in seconds needs several minutes of dry-run budget under mutation instrumentation, and the default left no room for the rest of the suite on top of it.
  dryRunTimeoutMinutes: 15,
});

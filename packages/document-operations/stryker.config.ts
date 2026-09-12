import { packageStrykerConfig } from "../../stryker.shared.ts";

// Genuinely 100%: every mutant Stryker can generate against this package's src is either killed by a real, isolating test or was eliminated outright by restructuring code that could never be reached by any test in the first place (the two odb_render_report diagnostic callbacks documents.js's own render pass can never invoke, and several test-support fixtures' own decorative-but-unread XML attributes) -- never suppressed with a Stryker disable comment, of which this package has zero. Confirmed with 0 timeouts on the run this threshold was set from, so no noise margin is subtracted per stryker.shared.ts's own derivation rule for that case.
export default packageStrykerConfig({ breakThreshold: 100 });

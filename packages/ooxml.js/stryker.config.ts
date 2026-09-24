import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  vitestConfigFile: "vitest.mutation.config.ts",
  // Derived by the rule documented on PackageStrykerOptions.breakThreshold. A complete CI run against main (github.com/ExaDev/documents.js/actions/runs/35969409361) measured 99.97% of 6718 valid mutants with 2 survived, which floors to 99, less a one-point margin for the 0.42% classified Timeout, giving 98. That run predates the fix in #1496, which closed one of the two survivors; the other, shared/drawingml.ts's own accepted equivalent, is unaffected, so the derivation still lands on 98 after it. https://github.com/ExaDev/documents.js/issues/1296 tracked closing this package's own survivors down from an original 96.91%/211-survivor measurement; every one of them was either killed by a real test or removed by restructuring the code so the mutation had no node to apply to, never suppressed.
  //
  // shared/drawingml.ts:351 (canonicalizeGroupRotation's `rotationDeg + 180`) is the one remaining survivor, and it stays: 180 is the unique fixed point where `+x` and `-x` coincide modulo 360, so no restructuring of "add exactly half a period" can distinguish the two spellings through this function's own observable contract. The reasoning is recorded in full on that function's own doc comment.
  breakThreshold: 98,
});

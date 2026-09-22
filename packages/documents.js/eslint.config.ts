import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [
    "@typescript-eslint/consistent-return",
    "@typescript-eslint/method-signature-style",
    "@typescript-eslint/no-shadow",
    "@typescript-eslint/no-use-before-define",
    "@typescript-eslint/promise-function-async",
    "@typescript-eslint/strict-boolean-expressions",
    "@typescript-eslint/strict-void-return",
    "@typescript-eslint/switch-exhaustiveness-check",
  ],
  // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established — a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
  nonNullAssertion: "off",
  isomorphic: true,
  // src/bin.ts is the launcher entry point: it spawns npx/pnpm/yarn/bunx, so it is Node-only by definition. It is executed, never imported into the isomorphic runtime, so exempting it leaves the importable surface pure — and tsconfig.node.json already routes it to the Node program, so lint and typecheck agree.
  isomorphicExemptions: ["src/bin.ts"],
  // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why — this package is the conversion engine's own orchestration layer, and its edit/convert/layout passes genuinely mutate a large number of array/object parameters in place; the single largest count of any package (327 sites). Tracked for burn-down.
  preferReadonlyParams: "off",
});

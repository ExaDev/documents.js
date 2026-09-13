import tseslint from "typescript-eslint";
import { packageLintConfig } from "../../eslint.shared.ts";

export default tseslint.config(
  ...packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
    newRuleDebt: [
      "@typescript-eslint/consistent-return",
      "@typescript-eslint/method-signature-style",
      "@typescript-eslint/no-shadow",
      "@typescript-eslint/strict-boolean-expressions",
      "@typescript-eslint/switch-exhaustiveness-check",
      "exadev/no-object-assign",
      "jsdoc/escape-inline-tags",
      "tsdoc/syntax",
    ],
    // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established -- a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
    nonNullAssertion: "off",
    isomorphic: true,
    // Off: see PackageLintOptions.preferReadonlyParams in eslint.shared.ts for why -- this package's own ODF readers/writers genuinely mutate a large number of array/object parameters in place. Tracked for burn-down.
    preferReadonlyParams: "off",
  }),
  {
    // fast-xml-parser@5 deprecates the whole XMLBuilder class, not one of its options, and ships no replacement of its own — it points at a separate `fast-xml-builder` package that is not a declared dependency here. Swapping it is a real dependency decision with round-trip fidelity to re-verify (this builder is what keeps XML byte-faithful), so it is tracked rather than guessed at inside a tooling change. Scoped to the one module that constructs the builder, plus its own test file, which necessarily references the identical deprecated class to reach BUILDER's shared prototype.
    files: ["src/xml/build.ts", "src/xml/build.test.ts"],
    rules: { "@typescript-eslint/no-deprecated": "off" },
  },
);

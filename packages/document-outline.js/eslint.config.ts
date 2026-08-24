import tseslint from "typescript-eslint";
import { packageLintConfig } from "../../eslint.shared.ts";

export default tseslint.config(
  ...packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established -- a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
    nonNullAssertion: "off",
    isomorphic: true,
  }),
  {
    // TEMPORARY, pending a decision. no-pointless-reassignment reports `export const contentHashV1 = stableContentHash` in outline/graph.ts, and it is right that the two are identical today. Collapsing it is not a local cleanup though: contentHashV1 reaches consumers through this package's root barrel and is named in the README's exports table, while stableContentHash is deliberately kept off that barrel (outline/hash is reachable only by subpath). Removing it is therefore a breaking change to a published surface, and it would leave the root with no way to compute a graph node id at all.
    //
    // Scoped to the one declaration rather than the package, and to be deleted either way once the call is made: collapse it and re-export stableContentHash from the barrel, or keep the binding and drop only the speculative "must be forked later" rationale from its comment.
    files: ["src/outline/graph.ts"],
    rules: { "exadev/no-pointless-reassignment": "off" },
  },
);

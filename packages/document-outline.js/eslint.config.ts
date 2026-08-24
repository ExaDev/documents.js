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
    // no-pointless-reassignment reports `export const contentHashV1 = stableContentHash` in outline/graph.ts, and it is right that the two are the same function today. It is kept anyway: contentHashV1 is what this package publishes from its root barrel, named in the README's exports table, while stableContentHash is deliberately absent from that barrel (outline/hash is reachable only by subpath). Collapsing it would remove a public export and leave the root with no way to compute a graph node id, which is a deliberate API decision rather than a formatting cleanup.
    files: ["src/outline/graph.ts"],
    rules: { "exadev/no-pointless-reassignment": "off" },
  },
);

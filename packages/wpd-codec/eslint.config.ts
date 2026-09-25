import tseslint from "typescript-eslint";
import { packageLintConfig } from "../../eslint.shared.ts";

export default tseslint.config(
  ...packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    maxLines: "error",
    magicNumbers: "error",
    isomorphic: true,
    // Passed to the shared config rather than declared here, because flat config replaces a same-key rule instead of merging it: a second no-restricted-imports over runtime src would silently drop the Worker-isomorphism Node-builtin ban while still reporting these.
    //
    // This package hand-writes the WordPerfect prefix/function-code parser against Corel's own published File Format SDK, the same bet markdown-codec makes against micromark and pdf-codec makes against pdf-lib. The only existing readers for this family are native or another-language libraries (libwpd is LGPL C++, WP_Reader is C#), so depending on one would defeat both the reason this package exists and the family's MIT licensing.
    additionalRestrictedImportPatterns: [
      {
        group: ["libwpd*", "libwpd*/**", "node-libwpd*", "wpd2*"],
        message:
          "Hand-write the WordPerfect parser against Corel's published File Format SDK instead of binding libwpd — see README Architecture.",
      },
    ],
  }),
  {
    // These five modules are direct, position-indexed transcriptions of an external, cited character-set specification (libwpd's own WP6-to-Unicode tables; see character-sets.ts's own top-of-file sourcing and cross-check notes), cross-checked against multiple independent sources. Each entry's meaning is its array position (a WordPerfect character number within that set), not its own numeric identity, and the position is already stated by the source's own comment on every row. Naming each code point individually would not describe anything the position comment and the cited source do not already state, and it would break the byte-for-byte fidelity to the cited transcription that is the whole point of these tables, the same reason a test's own byte-fixture literal stays a literal.
    files: [
      "src/stream/character-sets-1-4.ts",
      "src/stream/character-sets-5-7.ts",
      "src/stream/character-sets-8-11.ts",
      "src/stream/character-sets-12.ts",
      "src/stream/character-sets-13-14.ts",
    ],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },
);

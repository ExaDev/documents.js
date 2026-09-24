import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: 781 sites across every package are debt from this same @exadev/eslint-config 2.1.2->2.12.1 bump (see PackageLintOptions.newRuleDebt in eslint.shared.ts), not something this bump's own PR fixes. This package's own measured subset:
  newRuleDebt: [],
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
});

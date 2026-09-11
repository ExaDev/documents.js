import { packageLintConfig } from "../../eslint.shared.ts";

// The shared library-package config as-is: Worker-isomorphic (no node:* builtins in runtime src, proved at runtime by the workerd suite), the default single-barrel policy, and no-non-null-assertion enforced -- this package is new, so it starts with none of the indexed-access debt the older packages carry a burn-down exemption for.
export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  isomorphic: true,
});

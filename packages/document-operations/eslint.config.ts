import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // One program covering src and the config files alike, so there is no second tsconfig to route anything to.
  projects: ["./tsconfig.json"],
  // Resolves document input by filesystem path via node:fs/promises (see src/io/document-input.ts) -- the same reason document-mcp, its one current consumer, is not held to Worker isomorphism either.
  isomorphic: false,
});

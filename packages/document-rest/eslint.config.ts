import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  projects: ["./tsconfig.json"],
  // Binds a plain node:http listener (src/server.ts), the same reason document-mcp's own HTTP transport is not held to Worker isomorphism either.
  isomorphic: false,
  // dist-sea/ is this package's own SEA (single-executable application) bundle output -- a multi-megabyte, fully-dependency-inlined .cjs file (see tsdown.sea.shared.ts), not source, and linting it took over three minutes before this was added.
  additionalIgnores: ["dist-sea"],
});

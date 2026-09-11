import { packageLintConfig } from "../../eslint.shared.ts";

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  projects: ["./tsconfig.json"],
  // Binds a plain node:http listener (src/server.ts), the same reason document-mcp's own HTTP transport is not held to Worker isomorphism either.
  isomorphic: false,
});

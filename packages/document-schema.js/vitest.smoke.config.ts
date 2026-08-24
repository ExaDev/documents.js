import { defineConfig } from "vitest/config";

// test/smoke.test.mjs imports from the already-built dist/ (via pnpm test:smoke, which rebuilds it first via tsdown) -- no `define` needed here, since dist/ already has __PACKAGE_VERSION__ baked in as a real literal by tsdown.config.ts.
export default defineConfig({
  test: {
    name: "smoke",
    include: ["test/smoke.test.mjs"],
  },
});

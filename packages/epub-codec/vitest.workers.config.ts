import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin. epub-codec's surface (ZIP container read/write, XML parse/build, OPF/nav/XHTML mapping) is designed to carry zero Node-API usage; this config turns that design property into a runtime-checked fact rather than an assertion -- if any code path (or its fflate/fast-xml-parser/byte-codec dependency) touched a Node-only API, the workerd isolate would throw instead of the test passing. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.test.ts"] },
});

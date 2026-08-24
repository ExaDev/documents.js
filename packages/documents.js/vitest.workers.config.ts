import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers suite under the real Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers' cloudflareTest plugin (the current vitest-4 API -- a plugin, not the older defineWorkersProject/config helper). documents.js is a large package whose PDF pivot (readPdf/writePdf and every docx/pptx/odt/odp/ods/odg-to-PDF conversion) depends on the heavy pdf-codec, so this suite deliberately exercises only PDF-bypassing paths (markdownToDocx and the docx content reader/decoder) -- proving those code paths execute inside a workerd isolate with no Node-only API usage, without pulling PDF reading/writing into the actual test calls. Kept in a separate config from the default node `vitest run` so the existing node suite is unchanged; run explicitly via `pnpm test:workers`.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.test.ts"] },
});

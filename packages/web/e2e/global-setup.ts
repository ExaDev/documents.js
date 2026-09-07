import { chromium, type FullConfig } from "@playwright/test";

// Vite's dev server compiles each route's module graph on demand rather than serving a pre-built bundle -- the webServer option above only waits for the URL to answer at all (index.html, served instantly), not for a route's real module graph to finish transforming. Without this, the FIRST navigation any parallel worker makes pays that cold-compile cost mid-test, racing the test's own assertions rather than Playwright's explicit webServer wait -- reproduced directly running e2e/convert.spec.ts against a genuinely cold server (a fresh checkout, matching CI, has no node_modules/.vite cache yet): the "From" Select's value stayed empty for the whole assertion window because the route's own component tree, and the FileUpload/Dropzone chunk it renders, were still being transformed when the drop fired. Warming the one route every spec touches here, serially, before the parallel workers start, moves that one-time cost out of the timed test run entirely.
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/convert`);
  await page.getByRole("heading", { name: "Convert a document" }).waitFor();
  await page.getByRole("combobox", { name: "From" }).waitFor();
  await browser.close();
}

export default globalSetup;

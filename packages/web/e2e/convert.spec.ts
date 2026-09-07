import { expect, test } from "@playwright/test";

// The flagship, real conversion flow -- exercises the one thing unit tests genuinely can't: a real file dropped through the browser's own drag-and-drop event, the worker boundary the RPC client crosses, and the resulting "Done" panel actually rendering. locator.drop() dispatches native drag events with a synthetic DataTransfer, the same shape a real OS drag-and-drop produces -- FileUpload.tsx's own Dropzone.onClick path calls the native File System Access picker directly when the browser supports it (Chromium does), which Playwright cannot drive at all, so drop is the only route that reaches Dropzone.onDrop regardless of that branch.
test("converts a dropped markdown file to pdf and shows a real Done panel with a Download button", async ({
  page,
}) => {
  await page.goto("/convert");

  await page.locator('[role="presentation"].mantine-Dropzone-root').drop({
    files: {
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hello\n\nA real paragraph of text.\n"),
    },
  });

  // Format auto-detected from the .md extension (inferFormatFromFilename) -- confirms the drop genuinely reached FileUpload's own onDrop handler rather than silently no-op'ing. getByRole("combobox", ...), not getByLabel: Mantine's Select also renders an options listbox sharing the same aria-labelledby, which getByLabel resolves as a second, ambiguous match for the identical label text.
  await expect(page.getByRole("combobox", { name: "From" })).toHaveValue(
    "markdown",
  );

  await page.getByRole("combobox", { name: "To" }).click();
  await page.getByRole("option", { name: "pdf", exact: true }).click();

  await page.getByRole("button", { name: "Convert" }).click();

  await expect(page.getByText("Done")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
});

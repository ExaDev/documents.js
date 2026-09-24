import { expect, test } from "@playwright/test";

// Every real tool (Sidebar.tsx's own NAV_GROUPS) and the heading its route renders once loaded. Proves the whole route tree actually mounts a real page for every link, not just that the link exists.
const REAL_TOOLS: readonly { label: string; heading: string }[] = [
  { label: "Convert", heading: "Convert a document" },
  { label: "Metadata", heading: "Document metadata" },
  { label: "Inspect", heading: "Inspect" },
  { label: "Fonts", heading: "Embedded fonts" },
  { label: "Recent", heading: "Recent files" },
  { label: "Package / JSON", heading: "Package / JSON" },
  { label: ".odb", heading: "Browse an .odb database" },
  { label: "Editors", heading: "Edit a document" },
  { label: ".odm", heading: "Render an .odm master document" },
];

test("the root route redirects straight into the Convert tool, the flagship page (no separate marketing landing)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/convert$/);
  await expect(
    page.getByRole("heading", { name: "Convert a document" }),
  ).toBeVisible();
});

for (const { label, heading } of REAL_TOOLS) {
  test(`sidebar link "${label}" navigates to a real page with a real "${heading}" heading`, async ({
    page,
  }) => {
    await page.goto("/");
    // Scoped to the sidebar <nav>, not a bare page-wide lookup: the sidebar is the app's one navigation, and a page's own body can carry the same words as a link's label (Recent's "Recent files" heading, for one), which would otherwise make a page-wide locator ambiguous.
    await page
      .getByRole("navigation")
      .getByRole("link", { name: label })
      .click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  });
}

// The point of one shared open document: a file opened once stays open across every tool, including Editors and Recent, which sat outside the shared-document layout until this change and silently discarded it on the way past.
test("a document opened once stays open across every tool, including Editors and Recent", async ({
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
  await expect(page.getByText("Detected format: markdown")).toBeVisible();

  const nav = page.getByRole("navigation");
  await nav.getByRole("link", { name: "Recent" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent files" }),
  ).toBeVisible();

  await nav.getByRole("link", { name: "Editors" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit a document" }),
  ).toBeVisible();
  // Editors reads the already-open markdown document rather than asking for it again.
  await expect(page.getByText("Open a document above to edit it.")).toHaveCount(
    0,
  );

  await nav.getByRole("link", { name: "Metadata" }).click();
  await expect(page.getByText("Detected format: markdown")).toBeVisible();
});

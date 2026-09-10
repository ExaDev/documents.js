import { expect, test } from "@playwright/test";

// The five real tools (Sidebar.tsx's own NAV_ITEMS) and the heading each one's route renders once loaded -- proves the whole route tree actually mounts a real page for every link, not just that the link exists.
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

// The former PLANNED_ITEMS (Editors, .odm) are real tools since #1096 -- they sit in REAL_TOOLS above with their routes' own headings.

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
    await page.getByRole("link", { name: label }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  });
}

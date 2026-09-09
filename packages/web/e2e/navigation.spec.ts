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
];

// Sidebar.tsx's own PLANNED_ITEMS -- tracked as their own follow-up (ExaDev/documents.js#1096), deliberately still disabled nav stubs here.
const PLANNED_TOOLS: readonly string[] = ["Editors", ".odb", ".odm"];

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

for (const label of PLANNED_TOOLS) {
  test(`sidebar item "${label}" is visible but not a working link -- clicking it leaves the URL unchanged`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/convert$/);
    // PLANNED_ITEMS render as a disabled Mantine NavLink (component="div", disabled), not an <a> -- no link role and no real navigation to query, so the actual user-facing contract this checks is the disabled state plus a click going nowhere, not a transient tooltip's own hover animation.
    const item = page.getByText(label, { exact: true });
    await expect(item).toBeVisible();
    await expect(item.locator("..").locator("..")).toHaveAttribute(
      "data-disabled",
      "true",
    );
    await item.click({ force: true });
    await expect(page).toHaveURL(/\/convert$/);
  });
}

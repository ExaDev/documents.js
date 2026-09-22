import { describe, expect, it, vi } from "vitest";

import { mountWithMantine } from "../test/mountComponent";

// Stands in for the real RecentFilesPanel (already covered by its own dedicated test suite): RecentPage's own logic — the page heading and layout wrapper around the panel — is what this file exercises.
vi.mock("../ui/RecentFilesPanel", () => ({
  RecentFilesPanel: () => <div data-testid="recent-files-panel" />,
}));

const { Route } = await import("./recent");

describe("RecentPage", () => {
  it("renders the page heading and the recent files panel", () => {
    const RecentPage = Route.options.component;
    if (RecentPage === undefined) throw new Error("route has no component");
    const mounted = mountWithMantine(<RecentPage />);
    expect(mounted.container.textContent).toContain("Recent files");
    expect(
      mounted.container.querySelector('[data-testid="recent-files-panel"]'),
    ).not.toBeNull();
    mounted.unmount();
  });
});

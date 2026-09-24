import type * as TanstackRouter from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { computeVersionInfo, computeVersionTooltip, Sidebar } from "./-Sidebar";

let currentIsActive = false;
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof TanstackRouter>();
  return {
    ...actual,
    Link: (
      props: Readonly<{
        to: string;
        className: string;
        children: (state: Readonly<{ isActive: boolean }>) => React.ReactNode;
      }>,
    ) => (
      <a href={props.to} className={props.className}>
        {props.children({ isActive: currentIsActive })}
      </a>
    ),
  };
});

describe("computeVersionInfo", () => {
  it("links to the release tag, labelled with the tag itself, when one exists", () => {
    const info = computeVersionInfo("v1.2.3", "abcdef0123456789", "https://x");
    expect(info.label).toBe("v1.2.3");
    expect(info.href).toBe("https://x/releases/tag/v1.2.3");
  });

  it("links to the commit, labelled with its short sha, when there is no release tag", () => {
    const info = computeVersionInfo(null, "abcdef0123456789", "https://x");
    expect(info.label).toBe("abcdef0");
    expect(info.href).toBe("https://x/commit/abcdef0123456789");
  });
});

describe("computeVersionTooltip", () => {
  it("reads 'Released ...' when a release tag exists", () => {
    const tooltip = computeVersionTooltip(
      "v1.2.3",
      "abcdef0",
      Date.now() - 1000,
    );
    expect(tooltip).toBe("Released just now");
  });

  it("reads 'Commit <sha> · ...' when there is no release tag", () => {
    const tooltip = computeVersionTooltip(null, "abcdef0", Date.now() - 1000);
    expect(tooltip).toBe("Commit abcdef0 · just now");
  });
});

describe("Sidebar", () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    currentIsActive = false;
  });

  it("renders every nav item's label and links to its route", () => {
    const mounted = mountWithMantine(<Sidebar />);
    unmount = mounted.unmount;
    const html = mounted.container.innerHTML;
    expect(html).toContain("Convert");
    expect(html).toContain('href="/odm"');
    expect(html).toContain('href="/editors"');
    expect(html).toContain('href="/recent"');
  });

  it("separates the document tools from the library under real headings", () => {
    const mounted = mountWithMantine(<Sidebar />);
    unmount = mounted.unmount;
    const headings = [...mounted.container.querySelectorAll("h2")].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(["Document", "Library"]);
  });

  it("groups Recent apart from the tools that share the open document", () => {
    const mounted = mountWithMantine(<Sidebar />);
    unmount = mounted.unmount;
    const groups = [...mounted.container.querySelectorAll("h2")].map(
      (heading) => heading.parentElement?.textContent ?? "",
    );
    const [documentGroup, libraryGroup] = groups;
    expect(documentGroup).toContain("Editors");
    expect(documentGroup).not.toContain("Recent");
    expect(libraryGroup).toContain("Recent");
  });

  it("marks the active nav item's NavLink active", () => {
    currentIsActive = true;
    const mounted = mountWithMantine(<Sidebar />);
    unmount = mounted.unmount;
    expect(
      mounted.container.querySelector(".mantine-NavLink-root"),
    ).not.toBeNull();
    expect(
      mounted.container
        .querySelectorAll(".mantine-NavLink-root")[0]
        ?.getAttribute("data-active"),
    ).toBe("true");
  });

  it("leaves nav items inactive when no route matches", () => {
    currentIsActive = false;
    const mounted = mountWithMantine(<Sidebar />);
    unmount = mounted.unmount;
    expect(
      mounted.container
        .querySelectorAll(".mantine-NavLink-root")[0]
        ?.getAttribute("data-active"),
    ).toBeNull();
  });

  it("renders a version anchor pointing at the current build's commit or release", () => {
    const mounted = mountWithMantine(<Sidebar />);
    unmount = mounted.unmount;
    const anchor = mounted.container.querySelector('a[target="_blank"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

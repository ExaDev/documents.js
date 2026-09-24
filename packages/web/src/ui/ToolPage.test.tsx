/// <reference lib="dom" />
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { mountWithClassName } from "../test/cssRule";
import { mountWithMantine } from "../test/mountComponent";
import { ToolPage } from "./ToolPage";
import { header, HEADER_MEASURE, PANEL_MEASURE, width } from "./ToolPage.css";

// MantineProvider emits its own <style> element as the first child of the mount container, so the page's own root is the last one, not the first.
function mountPage(node: ReactNode) {
  const mounted = mountWithMantine(node);
  return { ...mounted, root: mounted.container.lastElementChild };
}

// getComputedStyle resolves a rem length against the root font size before handing it back, so a test comparing against the stylesheet's own declared value has to resolve it the same way rather than restating the number in pixels.
function resolveRem(length: string): string {
  const rootFontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return `${Number.parseFloat(length) * rootFontSize}px`;
}

describe("ToolPage", () => {
  it("renders the title as the page's own h2, so a page contributes exactly one heading at that level", () => {
    const mounted = mountPage(<ToolPage title="Embedded fonts">body</ToolPage>);
    const headings = [...mounted.container.querySelectorAll("h2")].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(["Embedded fonts"]);
    mounted.unmount();
  });

  it("renders its children after the heading", () => {
    const mounted = mountPage(
      <ToolPage title="Inspect">
        <span>the tool itself</span>
      </ToolPage>,
    );
    expect(mounted.root?.textContent).toBe("Inspectthe tool itself");
    mounted.unmount();
  });

  it("renders a description when given one", () => {
    const mounted = mountPage(
      <ToolPage title="Edit a document" description="Opens four formats.">
        body
      </ToolPage>,
    );
    expect(mounted.root?.textContent).toContain("Opens four formats.");
    mounted.unmount();
  });

  it("renders no description element at all when none is given, rather than an empty one", () => {
    const mounted = mountPage(
      <ToolPage title="Edit a document">body</ToolPage>,
    );
    expect(mounted.root?.querySelectorAll("p")).toHaveLength(0);
    mounted.unmount();
  });

  it("sets the description in the muted, smaller style a supporting line takes throughout the app", () => {
    const mounted = mountPage(
      <ToolPage title="Edit a document" description="Opens four formats.">
        body
      </ToolPage>,
    );
    const description = mounted.root?.querySelector("p");
    expect(description?.textContent).toBe("Opens four formats.");
    const inlineStyle = description?.getAttribute("style") ?? "";
    expect(inlineStyle).toContain("var(--mantine-color-dimmed)");
    expect(inlineStyle).toContain("var(--mantine-font-size-sm)");
    mounted.unmount();
  });

  it("lays a page out in the panel measure unless it asks for the canvas one", () => {
    const mounted = mountPage(<ToolPage title="Inspect">body</ToolPage>);
    expect(mounted.root?.classList.contains(width.panel)).toBe(true);
    expect(mounted.root?.classList.contains(width.canvas)).toBe(false);
    mounted.unmount();
  });

  it("lays a page out in the canvas measure when it asks for one", () => {
    const mounted = mountPage(
      <ToolPage title="Convert a document" width="canvas">
        body
      </ToolPage>,
    );
    expect(mounted.root?.classList.contains(width.canvas)).toBe(true);
    expect(mounted.root?.classList.contains(width.panel)).toBe(false);
    mounted.unmount();
  });

  it("separates the heading block from the tool below it by a wider step than the title from its own description", () => {
    const mounted = mountPage(
      <ToolPage title="Edit a document" description="Opens four formats.">
        body
      </ToolPage>,
    );
    expect(mounted.root?.getAttribute("style")).toContain(
      "--stack-gap: var(--mantine-spacing-lg)",
    );
    const headingBlock = mounted.root?.firstElementChild;
    expect(headingBlock?.classList.contains(header)).toBe(true);
    expect(headingBlock?.getAttribute("style")).toContain(
      "--stack-gap: var(--mantine-spacing-xs)",
    );
    mounted.unmount();
  });
});

describe("ToolPage.css", () => {
  it("caps the panel measure, left-aligned rather than centred", () => {
    const mounted = mountWithClassName(width.panel);
    const computed = getComputedStyle(mounted.element);
    expect(computed.maxWidth).toBe(resolveRem(PANEL_MEASURE));
    expect(computed.marginLeft).not.toBe("auto");
    mounted.cleanup();
  });

  it("leaves the canvas measure uncapped, so a wide table keeps the whole region", () => {
    const mounted = mountWithClassName(width.canvas);
    const computed = getComputedStyle(mounted.element);
    expect(computed.maxWidth).not.toBe(resolveRem(PANEL_MEASURE));
    expect(computed.width).toBe("100%");
    mounted.cleanup();
  });

  it("holds a page's heading block to a narrower measure than the page itself, so a description reads as prose", () => {
    const mounted = mountWithClassName(header);
    expect(getComputedStyle(mounted.element).maxWidth).toBe(
      resolveRem(HEADER_MEASURE),
    );
    expect(Number.parseFloat(HEADER_MEASURE)).toBeLessThan(
      Number.parseFloat(PANEL_MEASURE),
    );
    mounted.cleanup();
  });
});

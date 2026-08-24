import { describe, expect, it } from "vitest";
import { readPdf } from "./read";
import { navigationClusterPdf } from "./test-support/pdf";

// The navigation cluster (#721's core): named destinations (old-style /Dests dictionary AND /Names /Dests name tree), the /Outlines bookmark tree, and internal link annotations (/Dest direct and named, /A /GoTo actions) -- all read into the LayoutDocument's destinations/outline surfaces and the internalLink item kind. A direct destination array names no destination, so the reader mints one (dest1, dest2, ...) so every internal link and outline entry targets a destinations-table name.

function destinationNamed(doc: ReturnType<typeof readPdf>, name: string) {
  return doc.destinations?.find((d) => d.name === name);
}

describe("readPdf: named destinations", () => {
  it("reads the old-style /Dests dictionary with its view parameters", () => {
    const doc = readPdf(navigationClusterPdf());
    expect(destinationNamed(doc, "firstpage")).toEqual({
      name: "firstpage",
      pageIndex: 0,
      target: { kind: "xyz", leftPt: 10, topPt: 80, zoom: 1.5 },
    });
  });

  it("reads the /Names /Dests name tree through its /Kids split", () => {
    const doc = readPdf(navigationClusterPdf());
    expect(destinationNamed(doc, "second")).toEqual({
      name: "second",
      pageIndex: 1,
      target: { kind: "fit" },
    });
  });

  it("mints a destination for a direct destination array", () => {
    const doc = readPdf(navigationClusterPdf());
    // The outline is read before the pages, so its own direct destination array mints dest1 and this link's mints dest2 -- encounter order is the minting order, deterministic per file.
    const minted = doc.destinations?.find((d) => d.name === "dest2");
    expect(minted).toEqual({
      name: "dest2",
      pageIndex: 1,
      target: { kind: "xyz", leftPt: 20, topPt: 60 },
    });
    // A null zoom (and null coordinates generally) surface as absent fields, not as NaN or 0.
    expect(minted?.target.zoom).toBeUndefined();
  });

  it("collects every destination source into one table", () => {
    const doc = readPdf(navigationClusterPdf());
    expect(doc.destinations).toHaveLength(4);
  });
});

describe("readPdf: document outline", () => {
  it("reads the /Outlines tree as nested items with resolved destination names", () => {
    const doc = readPdf(navigationClusterPdf());
    expect(doc.outline).toEqual([
      { title: "First heading", destination: "firstpage", children: [] },
      {
        title: "Second page",
        destination: "dest1",
        children: [
          { title: "Nested child", destination: "second", children: [] },
        ],
      },
    ]);
    expect(destinationNamed(doc, "dest1")).toEqual({
      name: "dest1",
      pageIndex: 1,
      target: { kind: "xyz" },
    });
  });
});

describe("readPdf: internal link annotations", () => {
  it("reads /Dest (named), /Dest (direct array), and /A /GoTo links as internalLink items targeting destination names", () => {
    const doc = readPdf(navigationClusterPdf());
    const links = doc.pages[0]!.items.filter(
      (item) => item.kind === "internalLink",
    );
    expect(links).toEqual([
      {
        kind: "internalLink",
        destination: "second",
        xPt: 10,
        yPt: 10,
        widthPt: 50,
        heightPt: 14,
      },
      {
        kind: "internalLink",
        destination: "dest2",
        xPt: 70,
        yPt: 10,
        widthPt: 50,
        heightPt: 14,
      },
      {
        kind: "internalLink",
        destination: "firstpage",
        xPt: 10,
        yPt: 30,
        widthPt: 50,
        heightPt: 14,
        title: "Internal note",
      },
    ]);
  });

  it("does not misread an internal link as a URI link item", () => {
    const doc = readPdf(navigationClusterPdf());
    expect(doc.pages[0]!.items.some((item) => item.kind === "link")).toBe(
      false,
    );
  });
});

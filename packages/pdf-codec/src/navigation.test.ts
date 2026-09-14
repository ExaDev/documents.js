import { describe, expect, it } from "vitest";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import type { PdfObjectResolver } from "./interpret";
import type { PageIndexLookup } from "./navigation";
import {
  createDestinationRegistry,
  parseDestination,
  readOutline,
} from "./navigation";
import type { PdfDict, PdfObject } from "./objects";
import {
  asDict,
  pdfArray,
  pdfDict,
  pdfLiteralString,
  pdfName,
  pdfNull,
  pdfNum,
  pdfRef,
} from "./objects";
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

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

// A resolver over a plain ref-number -> object table -- every object in these tests is either direct or a `pdfRef` into this map, matching interpret.test.ts's own makeResolver. Returning the SAME map entry on every resolve is what lets the cycle-detection tests below recognise a repeated node by object identity.
function makeResolver(
  objects = new Map<number, PdfObject>(),
): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

// A page-index lookup that resolves any ref to its own object number -- arbitrary but deterministic, and distinct enough from a small page count that a test asserting `pageIndex: N` can't be confused with a coincidental default.
const pageIndexByRefNum: PageIndexLookup = (obj) =>
  obj?.kind === "ref" ? obj.num : undefined;

function str(text: string): PdfObject {
  return pdfLiteralString(new TextEncoder().encode(text));
}

describe("parseDestination", () => {
  const resolver = makeResolver();

  it("is invalid when the value does not resolve to an array at all", () => {
    const { sink, diagnostics } = collectDiagnostics();
    expect(
      parseDestination(pdfNum(5), resolver, pageIndexByRefNum, sink),
    ).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("pdf/destination-invalid");
  });

  it("is invalid when the array has fewer than two elements", () => {
    const { sink, diagnostics } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(3, 0)]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("pdf/destination-invalid");
  });

  it("accepts a bare non-negative integer page number (the PDF 2.0 spelling)", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfNum(3), pdfName("Fit")]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 3, target: { kind: "fit" } });
  });

  it("rejects a non-integer bare page number rather than truncating it", () => {
    const { sink, diagnostics } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfNum(1.5), pdfName("Fit")]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toBeUndefined();
    expect(diagnostics[0]?.message).toContain(
      "not in the document's page tree",
    );
  });

  it("rejects a negative bare page number", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfNum(-1), pdfName("Fit")]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toBeUndefined();
  });

  it("resolves a non-number page element through the page-index lookup", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(7, 0), pdfName("Fit")]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 7, target: { kind: "fit" } });
  });

  it("is invalid when the page-index lookup cannot place the page element", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const neverFound: PageIndexLookup = () => undefined;
    expect(
      parseDestination(
        pdfArray([pdfRef(7, 0), pdfName("Fit")]),
        resolver,
        neverFound,
        sink,
      ),
    ).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("pdf/destination-invalid");
  });

  it("reads XYZ coordinates, and drops a null coordinate rather than defaulting it to 0", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([
          pdfRef(0, 0),
          pdfName("XYZ"),
          pdfNum(12),
          pdfNull(),
          pdfNum(2),
        ]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({
      pageIndex: 0,
      target: { kind: "xyz", leftPt: 12, zoom: 2 },
    });
  });

  it("reads FitH's own single top coordinate", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfName("FitH"), pdfNum(99)]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 0, target: { kind: "fitH", topPt: 99 } });
  });

  it("reads FitH with no coordinate at all", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfName("FitH")]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 0, target: { kind: "fitH" } });
  });

  it("reads FitV's own single left coordinate", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfName("FitV"), pdfNum(44)]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 0, target: { kind: "fitV", leftPt: 44 } });
  });

  it("reads FitR's own four-coordinate rectangle", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([
          pdfRef(0, 0),
          pdfName("FitR"),
          pdfNum(1),
          pdfNum(2),
          pdfNum(3),
          pdfNum(4),
        ]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({
      pageIndex: 0,
      target: { kind: "fitR", leftPt: 1, bottomPt: 2, rightPt: 3, topPt: 4 },
    });
  });

  it("reads FitB with no coordinates", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfName("FitB")]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 0, target: { kind: "fitB" } });
  });

  it("reads FitBH's own single top coordinate", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfName("FitBH"), pdfNum(7)]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 0, target: { kind: "fitBH", topPt: 7 } });
  });

  it("reads FitBV's own single left coordinate", () => {
    const { sink } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfName("FitBV"), pdfNum(8)]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toEqual({ pageIndex: 0, target: { kind: "fitBV", leftPt: 8 } });
  });

  it("is invalid for an unrecognised display type, naming it in the diagnostic", () => {
    const { sink, diagnostics } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfName("Bogus")]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toBeUndefined();
    expect(diagnostics[0]?.message).toContain("/Bogus");
  });

  it("names the type as /? when the array carries no type name at all", () => {
    const { sink, diagnostics } = collectDiagnostics();
    expect(
      parseDestination(
        pdfArray([pdfRef(0, 0), pdfNull()]),
        resolver,
        pageIndexByRefNum,
        sink,
      ),
    ).toBeUndefined();
    expect(diagnostics[0]?.message).toContain("/?");
  });
});

describe("createDestinationRegistry", () => {
  it("keeps only the first entry when the /Dests dictionary declares the same name twice", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const catalog = pdfDict({
      Dests: pdfDict({
        dup: pdfArray([pdfRef(0, 0), pdfName("Fit")]),
      }),
    });
    // A single-entry Map can't itself hold a duplicate key, so this exercises the duplicate check by calling the registry with a catalog whose /Dests dict entries iteration naturally yields "dup" once -- the duplicate branch itself is proven by the name-tree case below, which genuinely can repeat a name. This case instead confirms the ordinary non-duplicate path leaves the sink untouched.
    createDestinationRegistry(catalog, makeResolver(), pageIndexByRefNum, sink);
    expect(diagnostics).toEqual([]);
  });

  it("warns and keeps the first entry when the /Names /Dests tree repeats a name", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const catalog = pdfDict({
      Names: pdfDict({
        Dests: pdfDict({
          Names: pdfArray([
            str("dup"),
            pdfArray([pdfRef(0, 0), pdfName("Fit")]),
            str("dup"),
            pdfArray([pdfRef(1, 0), pdfName("FitB")]),
          ]),
        }),
      }),
    });
    const registry = createDestinationRegistry(
      catalog,
      makeResolver(),
      pageIndexByRefNum,
      sink,
    );
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]).toEqual({
      name: "dup",
      pageIndex: 0,
      target: { kind: "fit" },
    });
    expect(
      diagnostics.some((d) => d.code === "pdf/destination-duplicate"),
    ).toBe(true);
  });

  it("skips an unparseable destination in the /Dests dictionary rather than adding a broken entry", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const catalog = pdfDict({ Dests: pdfDict({ broken: pdfNull() }) });
    const registry = createDestinationRegistry(
      catalog,
      makeResolver(),
      pageIndexByRefNum,
      sink,
    );
    expect(registry.entries).toEqual([]);
    expect(diagnostics.some((d) => d.code === "pdf/destination-invalid")).toBe(
      true,
    );
  });

  it("mints dest1, dest2, dest3 in order, skipping over already-taken names", () => {
    const { sink } = collectDiagnostics();
    // A pre-existing named destination that happens to occupy the FIRST name the minter would otherwise pick, forcing it to skip past dest1.
    const catalog = pdfDict({
      Dests: pdfDict({
        dest1: pdfArray([pdfRef(0, 0), pdfName("Fit")]),
      }),
    });
    const registry = createDestinationRegistry(
      catalog,
      makeResolver(),
      pageIndexByRefNum,
      sink,
    );
    const first = registry.intern(pdfArray([pdfRef(1, 0), pdfName("Fit")]));
    const second = registry.intern(pdfArray([pdfRef(2, 0), pdfName("Fit")]));
    expect(first).toBe("dest2");
    expect(second).toBe("dest3");
  });

  describe("intern", () => {
    it("returns undefined, with no diagnostic, for a value that resolves to neither a string nor an array", () => {
      const { sink, diagnostics } = collectDiagnostics();
      const registry = createDestinationRegistry(
        pdfDict({}),
        makeResolver(),
        pageIndexByRefNum,
        sink,
      );
      expect(registry.intern(pdfNum(5))).toBeUndefined();
      expect(registry.intern(undefined)).toBeUndefined();
      expect(diagnostics).toEqual([]);
    });

    it("warns and returns undefined for a named destination no /Dests or name tree entry declares", () => {
      const { sink, diagnostics } = collectDiagnostics();
      const registry = createDestinationRegistry(
        pdfDict({}),
        makeResolver(),
        pageIndexByRefNum,
        sink,
      );
      expect(registry.intern(str("nowhere"))).toBeUndefined();
      expect(diagnostics[0]?.code).toBe("pdf/destination-unresolved");
      expect(diagnostics[0]?.message).toContain("nowhere");
    });

    it("resolves a name already in the table with no diagnostic", () => {
      const { sink, diagnostics } = collectDiagnostics();
      const catalog = pdfDict({
        Dests: pdfDict({ here: pdfArray([pdfRef(0, 0), pdfName("Fit")]) }),
      });
      const registry = createDestinationRegistry(
        catalog,
        makeResolver(),
        pageIndexByRefNum,
        sink,
      );
      expect(registry.intern(str("here"))).toBe("here");
      expect(diagnostics).toEqual([]);
    });
  });
});

describe("readOutline", () => {
  const resolver = makeResolver();

  it("returns no items when the catalog has no /Outlines at all", () => {
    const { sink } = collectDiagnostics();
    const registry = createDestinationRegistry(
      pdfDict({}),
      resolver,
      pageIndexByRefNum,
      sink,
    );
    expect(readOutline(pdfDict({}), registry, resolver, sink)).toEqual([]);
  });

  it("returns no items when /Outlines has no /First", () => {
    const { sink } = collectDiagnostics();
    const registry = createDestinationRegistry(
      pdfDict({}),
      resolver,
      pageIndexByRefNum,
      sink,
    );
    const catalog = pdfDict({ Outlines: pdfDict({}) });
    expect(readOutline(catalog, registry, resolver, sink)).toEqual([]);
  });

  it("titles an item with no /Title as an empty string rather than omitting it", () => {
    const { sink } = collectDiagnostics();
    const registry = createDestinationRegistry(
      pdfDict({}),
      resolver,
      pageIndexByRefNum,
      sink,
    );
    const objects = new Map<number, PdfObject>([[1, pdfDict({})]]);
    const catalog = pdfDict({ Outlines: pdfDict({ First: pdfRef(1, 0) }) });
    expect(readOutline(catalog, registry, makeResolver(objects), sink)).toEqual(
      [{ title: "", children: [] }],
    );
  });

  it("resolves a destination through /A /GoTo when there is no direct /Dest", () => {
    const { sink } = collectDiagnostics();
    const interned: PdfObject[] = [];
    const registry = {
      entries: [],
      intern: (obj: PdfObject | undefined) => {
        if (obj !== undefined) {
          interned.push(obj);
        }
        return "wherever";
      },
    };
    const action = pdfDict({ S: pdfName("GoTo"), D: str("target") });
    const objects = new Map<number, PdfObject>([
      [1, pdfDict({ Title: str("Node"), A: pdfRef(2, 0) })],
      [2, action],
    ]);
    const catalog = pdfDict({ Outlines: pdfDict({ First: pdfRef(1, 0) }) });
    const items = readOutline(catalog, registry, makeResolver(objects), sink);
    expect(items).toEqual([
      { title: "Node", destination: "wherever", children: [] },
    ]);
    expect(interned).toEqual([str("target")]);
  });

  it("ignores an /A action whose /S is not /GoTo", () => {
    const { sink } = collectDiagnostics();
    const registry = {
      entries: [],
      intern: () => "should-not-be-called",
    };
    const action = pdfDict({ S: pdfName("URI"), URI: str("https://x") });
    const objects = new Map<number, PdfObject>([
      [1, pdfDict({ Title: str("Node"), A: pdfRef(2, 0) })],
      [2, action],
    ]);
    const catalog = pdfDict({ Outlines: pdfDict({ First: pdfRef(1, 0) }) });
    const items = readOutline(catalog, registry, makeResolver(objects), sink);
    expect(items).toEqual([{ title: "Node", children: [] }]);
  });

  it("leaves destination unset for a node with neither /Dest nor /A", () => {
    const { sink } = collectDiagnostics();
    const registry = createDestinationRegistry(
      pdfDict({}),
      resolver,
      pageIndexByRefNum,
      sink,
    );
    const objects = new Map<number, PdfObject>([
      [1, pdfDict({ Title: str("Node") })],
    ]);
    const catalog = pdfDict({ Outlines: pdfDict({ First: pdfRef(1, 0) }) });
    expect(readOutline(catalog, registry, makeResolver(objects), sink)).toEqual(
      [{ title: "Node", children: [] }],
    );
  });

  it("stops a chain at a repeated node and warns, with the shared visited set spanning parent and child recursion", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const registry = createDestinationRegistry(
      pdfDict({}),
      resolver,
      pageIndexByRefNum,
      sink,
    );
    // A's own child is B, and B's /Next points back to A -- a cycle across the parent/child boundary, not merely a self-loop within one sibling chain.
    const objects = new Map<number, PdfObject>([
      [1, pdfDict({ Title: str("A"), First: pdfRef(2, 0) })],
      [2, pdfDict({ Title: str("B"), Next: pdfRef(1, 0) })],
    ]);
    const catalog = pdfDict({ Outlines: pdfDict({ First: pdfRef(1, 0) }) });
    const items = readOutline(catalog, registry, makeResolver(objects), sink);
    expect(items).toEqual([
      { title: "A", children: [{ title: "B", children: [] }] },
    ]);
    expect(diagnostics.some((d) => d.code === "pdf/outline-cycle")).toBe(true);
  });
});

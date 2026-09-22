import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import {
  normaliseObjectHref,
  readDrawObjectReference,
  readEmbeddedObjectDocument,
  type EmbeddedDrawObject,
} from "./embedded";

// The real shape this reader targets is proven end to end against genuine LibreOffice output in typed/ods/read.test.ts (src/typed/ods/fixtures/sheet-anchors.ods, a real Calc sheet with a real embedded Draw document anchored to a cell, and src/typed/ods/fixtures/sheet-formula.ods, the same with a real Math object). This suite covers the reference-resolution edges those files cannot: a linked (not embedded) object, a broken href, and each representable/unrepresentable body kind.

function subDocumentPart(bodyChild: XmlElement): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [el("office:body", {}, [bodyChild])]),
    ],
  };
}

function packageWithObject(prefix: string, bodyChild: XmlElement): Package {
  return { parts: { [`${prefix}/content.xml`]: subDocumentPart(bodyChild) } };
}

// Copied element-for-element from the REAL "Object 1/content.xml" inside src/typed/ods/fixtures/sheet-formula.ods (a genuine LibreOffice 26.2 Calc sheet with a Math object anchored to a cell, never hand-edited) — the same bare "math" root with a DEFAULT MathML xmlns, the same <semantics>/<annotation encoding="StarMath 5.0"> shape, deliberately not simplified, matching typed/formula/read.test.ts's own convention for the standalone .odf case.
function realEmbeddedFormulaRoot(): XmlElement {
  return el(
    "math",
    { xmlns: "http://www.w3.org/1998/Math/MathML", display: "block" },
    [
      el("semantics", {}, [
        el("mrow", {}, [
          el("mi", {}, [txt("f")]),
          el("mo", { stretchy: "false" }, [txt("=")]),
          el("mn", {}, [txt("1")]),
        ]),
        el("annotation", { encoding: "StarMath 5.0" }, [txt("f = 1")]),
      ]),
    ],
  );
}

function objectFrame(href: string): XmlElement {
  return el(
    "draw:frame",
    {
      "svg:x": "0pt",
      "svg:y": "0pt",
      "svg:width": "10pt",
      "svg:height": "10pt",
    },
    [el("draw:object", { "xlink:href": href })],
  );
}

describe("readDrawObjectReference", () => {
  it('resolves the "./Object 1" href real LibreOffice writes into that directory\'s own re-keyed sub-Package', () => {
    const pkg = packageWithObject(
      "Object 1",
      el("office:drawing", {}, [el("draw:page", { "draw:name": "page1" })]),
    );
    const reference = readDrawObjectReference(objectFrame("./Object 1"), pkg);
    expect(reference?.href).toBe("Object 1");
    expect(reference?.objectKind).toBe("drawing");
    expect(Object.keys(reference?.package.parts ?? {})).toEqual([
      "content.xml",
    ]);
  });

  it("resolves each ContentDocument-representable office:body content child to its own objectKind", () => {
    const cases = [
      { bodyChild: el("office:text"), objectKind: "wordprocessing" },
      { bodyChild: el("office:spreadsheet"), objectKind: "spreadsheet" },
      { bodyChild: el("office:presentation"), objectKind: "presentation" },
      { bodyChild: el("office:drawing"), objectKind: "drawing" },
    ];
    for (const { bodyChild, objectKind } of cases) {
      const reference = readDrawObjectReference(
        objectFrame("Object 1"),
        packageWithObject("Object 1", bodyChild),
      );
      expect(reference?.objectKind).toBe(objectKind);
    }
  });

  it("returns undefined for an office:database sub-document — a .odb front-end is not a ContentDocument at all", () => {
    expect(
      readDrawObjectReference(
        objectFrame("Object 1"),
        packageWithObject("Object 1", el("office:database")),
      ),
    ).toBeUndefined();
  });

  it('resolves an office:chart sub-document to objectKind "chart" — the member whose document is the frame-sized data projection readOdfChartContent builds, not a same-named ContentDocument', () => {
    const reference = readDrawObjectReference(
      objectFrame("Object 1"),
      packageWithObject("Object 1", el("office:chart")),
    );
    expect(reference?.objectKind).toBe("chart");
    expect(reference?.href).toBe("Object 1");
  });

  it('resolves an embedded FORMULA sub-document, whose content.xml root is a bare <math> element with no office:body at all, to objectKind "formula"', () => {
    const pkg: Package = {
      parts: {
        "Object 1/content.xml": {
          kind: "xml",
          nodes: [realEmbeddedFormulaRoot()],
        },
      },
    };
    const reference = readDrawObjectReference(objectFrame("./Object 1"), pkg);
    expect(reference?.objectKind).toBe("formula");
    expect(reference?.href).toBe("Object 1");
  });

  it('also resolves a "math:math"-prefixed root, the defensive alternative typed/formula/read.ts matches alongside the bare tag real LibreOffice writes', () => {
    const pkg: Package = {
      parts: {
        "Object 1/content.xml": {
          kind: "xml",
          nodes: [
            el("math:math", {}, [
              el("math:semantics", {}, [el("mi", {}, [txt("x")])]),
            ]),
          ],
        },
      },
    };
    expect(
      readDrawObjectReference(objectFrame("./Object 1"), pkg)?.objectKind,
    ).toBe("formula");
  });

  it("returns undefined for a sub-document that is neither an office:body document nor a MathML root", () => {
    const pkg: Package = {
      parts: {
        "Object 1/content.xml": {
          kind: "xml",
          nodes: [el("office:document-content", {}, [el("office:scripts")])],
        },
      },
    };
    expect(
      readDrawObjectReference(objectFrame("./Object 1"), pkg),
    ).toBeUndefined();
  });

  it("returns undefined for a frame carrying no draw:object at all", () => {
    const frame = el(
      "draw:frame",
      {
        "svg:x": "0pt",
        "svg:y": "0pt",
        "svg:width": "10pt",
        "svg:height": "10pt",
      },
      [el("draw:image", { "xlink:href": "Pictures/img.png" })],
    );
    expect(readDrawObjectReference(frame, { parts: {} })).toBeUndefined();
  });

  it("returns undefined for a LINKED object — an absolute URL, or a path escaping the package root, is content this package genuinely does not hold", () => {
    const pkg = packageWithObject("Object 1", el("office:drawing"));
    expect(
      readDrawObjectReference(
        objectFrame("http://example.invalid/chart.odg"),
        pkg,
      ),
    ).toBeUndefined();
    expect(
      readDrawObjectReference(objectFrame("../sibling.odg"), pkg),
    ).toBeUndefined();
    expect(
      readDrawObjectReference(objectFrame("/absolute.odg"), pkg),
    ).toBeUndefined();
  });

  it("returns undefined (never throws) for an href naming a directory the package holds no content.xml for", () => {
    expect(
      readDrawObjectReference(
        objectFrame("./Object 7"),
        packageWithObject("Object 1", el("office:drawing")),
      ),
    ).toBeUndefined();
  });

  it("tolerates a trailing slash on the href, resolving the same directory", () => {
    const reference = readDrawObjectReference(
      objectFrame("./Object 1/"),
      packageWithObject("Object 1", el("office:text")),
    );
    expect(reference?.href).toBe("Object 1");
    expect(reference?.objectKind).toBe("wordprocessing");
  });
});

describe("normaliseObjectHref", () => {
  it("accepts a plain relative directory name unchanged", () => {
    expect(normaliseObjectHref("Object 1")).toBe("Object 1");
  });

  it("strips a leading './' and a trailing '/'", () => {
    expect(normaliseObjectHref("./Object 1/")).toBe("Object 1");
  });

  it("rejects an empty href, once the './' prefix and trailing '/' are stripped away", () => {
    expect(normaliseObjectHref("./")).toBeUndefined();
    expect(normaliseObjectHref("")).toBeUndefined();
  });

  it('rejects a href starting with ".." after stripping, even when it is not otherwise empty, absolute, or a URL', () => {
    expect(normaliseObjectHref("../sibling")).toBeUndefined();
    expect(normaliseObjectHref("..")).toBeUndefined();
  });

  it("rejects an absolute path (leading '/'), even when it is not otherwise empty, '..'-prefixed, or a URL", () => {
    expect(normaliseObjectHref("/Object 1")).toBeUndefined();
  });

  it('rejects any href containing "://", even a relative-looking one with no leading "..", "/", or emptiness', () => {
    expect(normaliseObjectHref("weird://Object 1")).toBeUndefined();
  });

  it("checks the START of the string for '..' and '/', not the end, so a name merely ending with either is accepted unchanged", () => {
    expect(normaliseObjectHref("Object 1/..")).toBe("Object 1/.."); // ends with ".." but does not START with it
    expect(normaliseObjectHref("folder..")).toBe("folder.."); // ditto
    // "a//" has only ONE trailing slash stripped by the earlier, separate trailing-slash removal above, leaving "a/" — which still itself ends with "/" without starting with it, isolating startsWith("/") from a wrongly-substituted endsWith("/") the way the first two cases isolate startsWith("..") from endsWith("..").
    expect(normaliseObjectHref("a//")).toBe("a/");
  });
});

const EMBED_FRAME = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 };

function embeddedReferenceOf(
  objectKind: EmbeddedDrawObject["objectKind"],
  bodyChild: XmlElement,
): EmbeddedDrawObject {
  return {
    objectKind,
    href: "Object 1",
    package: { parts: { "content.xml": subDocumentPart(bodyChild) } },
  };
}

describe("readEmbeddedObjectDocument", () => {
  it('dispatches "wordprocessing" to readOdtContent', () => {
    const reference = embeddedReferenceOf("wordprocessing", el("office:text"));
    const { document, residue } = readEmbeddedObjectDocument(
      reference,
      EMBED_FRAME,
      "odt",
    );
    expect(document.kind).toBe("wordprocessing");
    expect(residue).toBeUndefined();
  });

  it('dispatches "presentation" to readOdpContent', () => {
    const reference = embeddedReferenceOf(
      "presentation",
      el("office:presentation"),
    );
    const { document, residue } = readEmbeddedObjectDocument(
      reference,
      EMBED_FRAME,
      "odt",
    );
    expect(document.kind).toBe("presentation");
    expect(residue).toBeUndefined();
  });

  it('dispatches "drawing" to readOdgContent', () => {
    const reference = embeddedReferenceOf("drawing", el("office:drawing"));
    const { document, residue } = readEmbeddedObjectDocument(
      reference,
      EMBED_FRAME,
      "odt",
    );
    expect(document.kind).toBe("drawing");
    expect(residue).toBeUndefined();
  });

  it('dispatches "spreadsheet" to readOdsContent', () => {
    const reference = embeddedReferenceOf(
      "spreadsheet",
      el("office:spreadsheet"),
    );
    const { document, residue } = readEmbeddedObjectDocument(
      reference,
      EMBED_FRAME,
      "odt",
    );
    expect(document.kind).toBe("spreadsheet");
    expect(residue).toBeUndefined();
  });

  it('dispatches "formula" to readOdfFormulaContent, whose own reader already returns a finished ContentDocument', () => {
    const reference: EmbeddedDrawObject = {
      objectKind: "formula",
      href: "Object 1",
      package: {
        parts: {
          "content.xml": { kind: "xml", nodes: [realEmbeddedFormulaRoot()] },
        },
      },
    };
    const { document, residue } = readEmbeddedObjectDocument(
      reference,
      EMBED_FRAME,
      "odt",
    );
    expect(document.kind).toBe("formula");
    expect(residue).toBeUndefined();
  });

  it('dispatches "chart" to readOdfChartContent, which alone of every kind carries residue', () => {
    const chartElement = el("chart:chart", {}, [
      el("table:table", {}, [el("table:table-row")]),
    ]);
    const reference: EmbeddedDrawObject = {
      objectKind: "chart",
      href: "Object 1",
      package: {
        parts: {
          "content.xml": {
            kind: "xml",
            nodes: [
              el("office:document-content", {}, [
                el("office:body", {}, [chartElement]),
              ]),
            ],
          },
        },
      },
    };
    const { document, residue } = readEmbeddedObjectDocument(
      reference,
      EMBED_FRAME,
      "odt",
    );
    expect(document.kind).toBe("drawing");
    expect(residue).not.toBeUndefined();
  });
});

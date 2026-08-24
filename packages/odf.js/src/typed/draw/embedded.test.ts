import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readDrawObjectReference } from "./embedded";

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

// Copied element-for-element from the REAL "Object 1/content.xml" inside src/typed/ods/fixtures/sheet-formula.ods (a genuine LibreOffice 26.2 Calc sheet with a Math object anchored to a cell, never hand-edited) -- the same bare "math" root with a DEFAULT MathML xmlns, the same <semantics>/<annotation encoding="StarMath 5.0"> shape, deliberately not simplified, matching typed/formula/read.test.ts's own convention for the standalone .odf case.
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

  it("returns undefined for an office:database sub-document -- a .odb front-end is not a ContentDocument at all", () => {
    expect(
      readDrawObjectReference(
        objectFrame("Object 1"),
        packageWithObject("Object 1", el("office:database")),
      ),
    ).toBeUndefined();
  });

  it('resolves an office:chart sub-document to objectKind "chart" -- the member whose document is the frame-sized data projection readOdfChartContent builds, not a same-named ContentDocument', () => {
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

  it("returns undefined for a LINKED object -- an absolute URL, or a path escaping the package root, is content this package genuinely does not hold", () => {
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

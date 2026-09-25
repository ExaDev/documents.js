import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readOdtContent } from "./read";

// The block-scope construct rows of the fidelity vocabulary (ExaDev/documents.js#719): text:section as a division, the TOC/index wrappers as index content controls, tracked changes as provenance, and the definitions-table tenants. Every fixture here is a programmatic package built with el/txt — the fixture gate the issue itself states: real-producer verification for these constructs is outstanding, and the shapes below follow the OASIS ODF 1.2 element/attribute grammar rather than any single producer's output.

function odtPackage(
  textChildren: readonly XmlElement[],
  automaticStyles: readonly XmlElement[] = [],
): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:automatic-styles", {}, automaticStyles),
            el("office:body", {}, [el("office:text", {}, textChildren)]),
          ]),
        ],
      },
    },
  };
}

function paragraph(text: string): XmlElement {
  return el("text:p", {}, [txt(text)]);
}

function firstSectionBlocks(pkg: Package) {
  const { sections } = readOdtContent(pkg);
  const section = sections[0];
  if (section === undefined) {
    throw new Error("expected at least one section");
  }
  return section.blocks;
}

describe("readOdtContent: cross-paragraph bookmark pairing at block scope", () => {
  it("brackets the blocks a leading bookmark-start and a trailing bookmark-end span", () => {
    const pkg = odtPackage([
      el("text:p", {}, [
        el("text:bookmark-start", { "text:name": "range" }),
        txt("first"),
      ]),
      paragraph("middle"),
      el("text:p", {}, [
        txt("last"),
        el("text:bookmark-end", { "text:name": "range" }),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
    if (blocks[0]?.kind !== "constructStart") {
      throw new Error("expected a constructStart marker");
    }
    expect(blocks[0].descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "range",
    });
  });

  it("drops the later-opening extent of a genuinely crossing pair (bookmark opened before a section, closed inside it), keeping the earlier one — the deterministic rule the docx reader applies to the identical shape", () => {
    const pkg = odtPackage([
      el("text:p", {}, [
        el("text:bookmark-start", { "text:name": "straddler" }),
        txt("before"),
      ]),
      el("text:section", { "text:name": "S" }, [
        el("text:p", {}, [
          txt("inside"),
          el("text:bookmark-end", { "text:name": "straddler" }),
        ]),
        paragraph("still inside"),
      ]),
      paragraph("after"),
    ]);
    const blocks = firstSectionBlocks(pkg);
    // The bookmark opens at block 0 and closes at 2; the division spans 1..3. The pair crosses, so exactly one survives: the bookmark, whose start precedes the division's — the same outermost/earliest-start resolution acceptProperlyNested applies in the docx reader, and the drop document-schema.js ratifies for block-scoped crossings. The section's own blocks still read; only its wrapper marker is lost.
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
      "paragraph",
      "paragraph",
    ]);
    if (blocks[0]?.kind !== "constructStart") {
      throw new Error("expected a constructStart marker");
    }
    expect(blocks[0].descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "straddler",
    });
  });
});

describe("readOdtContent: cross-paragraph reference-mark pairing at block scope", () => {
  it("brackets the blocks a leading reference-mark-start and a trailing reference-mark-end span", () => {
    const pkg = odtPackage([
      el("text:p", {}, [
        el("text:reference-mark-start", { "text:name": "range" }),
        txt("first"),
      ]),
      paragraph("middle"),
      el("text:p", {}, [
        txt("last"),
        el("text:reference-mark-end", { "text:name": "range" }),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
    if (blocks[0]?.kind !== "constructStart") {
      throw new Error("expected a constructStart marker");
    }
    expect(blocks[0].descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "range",
    });
  });

  it("pairs a reference-mark across paragraphs independently of a same-named bookmark spanning the same blocks", () => {
    // Two families under one name, both block-scoped over the same range: each pairs with its own spelling, producing two marker pairs rather than one — the same-name separation the paragraph-level pairing applies, at block scope.
    const pkg = odtPackage([
      el("text:p", {}, [
        el("text:bookmark-start", { "text:name": "shared" }),
        el("text:reference-mark-start", { "text:name": "shared" }),
        txt("first"),
      ]),
      paragraph("middle"),
      el("text:p", {}, [
        txt("last"),
        el("text:reference-mark-end", { "text:name": "shared" }),
        el("text:bookmark-end", { "text:name": "shared" }),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "constructStart",
      "paragraph",
      "paragraph",
      "paragraph",
      "constructEnd",
      "constructEnd",
    ]);
    const descriptors = blocks
      .filter((block) => block.kind === "constructStart")
      .map((block) => block.descriptor);
    expect(descriptors).toEqual([
      { kind: "anchor", anchorType: "bookmark", name: "shared" },
      { kind: "anchor", anchorType: "bookmark", name: "shared" },
    ]);
  });
});

describe("readOdtContent: anchored draw:frames in text flow", () => {
  // A 1x1 transparent PNG — the smallest bytes sniffImageFormat accepts as a real image part.
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  function imagePackage(): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [
                el("office:text", {}, [
                  el("text:p", {}, [
                    txt("Text before the frame "),
                    el(
                      "draw:frame",
                      {
                        "text:anchor-type": "as-char",
                        "svg:width": "2cm",
                        "svg:height": "1cm",
                      },
                      [
                        el("draw:image", {
                          "xlink:href": "Pictures/image1.png",
                        }),
                      ],
                    ),
                  ]),
                ]),
              ]),
            ]),
          ],
        },
        "Pictures/image1.png": { kind: "binary", base64: PNG_BASE64 },
      },
    };
  }

  it("lifts an as-char image frame to a ContentImageBlock following its paragraph, sized by the frame", () => {
    const blocks = firstSectionBlocks(imagePackage());
    expect(blocks).toHaveLength(2);
    if (blocks[0]?.kind !== "paragraph" || blocks[1]?.kind !== "image") {
      throw new Error("expected a paragraph followed by a lifted image block");
    }
    const expectedWidthPt = 56.7;
    const expectedHeightPt = 28.35;
    const precisionDigits = 0;
    expect(blocks[1].format).toBe("png");
    expect(blocks[1].widthPt).toBeCloseTo(expectedWidthPt, precisionDigits);
    expect(blocks[1].heightPt).toBeCloseTo(expectedHeightPt, precisionDigits);
  });

  it("contributes nothing for frames at all under frames: 'none' — the opt-out a consumer with its own frame-detection passes takes", () => {
    const { sections } = readOdtContent(imagePackage(), { frames: "none" });
    expect(sections[0]?.blocks).toHaveLength(1);
    expect(sections[0]?.blocks[0]?.kind).toBe("paragraph");
  });

  it("splices a text-box frame's own blocks after its paragraph, in document order", () => {
    const pkg = odtPackage([
      el("text:p", {}, [
        txt("Body "),
        el(
          "draw:frame",
          {
            "svg:x": "1cm",
            "svg:y": "2cm",
            "svg:width": "4cm",
            "svg:height": "2cm",
          },
          [
            el("draw:text-box", {}, [
              el("text:p", {}, [txt("Box paragraph.")]),
            ]),
          ],
        ),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    if (blocks[1]?.kind !== "paragraph") {
      throw new Error(
        "expected the text-box paragraph spliced after its anchor",
      );
    }
    expect(blocks[1].runs[0]?.text).toBe("Box paragraph.");
  });

  it("extends a block-scoped bookmark ending after a paragraph's anchored frame over that frame's lifted block", () => {
    // The bookmark-end physically follows the frame in the paragraph's own child order, so the bookmark's block extent covers the paragraph AND the frame's lifted block — the lifted encoding places those blocks after the paragraph precisely because they sat inside the bookmark's physical range.
    const pkg = odtPackage([
      el("text:p", {}, [
        el("text:bookmark-start", { "text:name": "around-frame" }),
        txt("Anchoring text "),
        el(
          "draw:frame",
          {
            "text:anchor-type": "as-char",
            "svg:width": "2cm",
            "svg:height": "1cm",
          },
          [el("draw:image", { "xlink:href": "Pictures/image1.png" })],
        ),
        el("text:bookmark-end", { "text:name": "around-frame" }),
      ]),
      paragraph("after"),
    ]);
    pkg.parts["Pictures/image1.png"] = { kind: "binary", base64: PNG_BASE64 };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "image",
      "constructEnd",
      "paragraph",
    ]);
    if (blocks[0]?.kind !== "constructStart") {
      throw new Error("expected the bookmark's constructStart marker");
    }
    expect(blocks[0].descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "around-frame",
    });
  });

  it("excludes a paragraph's lifted frame from a bookmark whose end physically precedes the frame", () => {
    // The frame follows the bookmark-end in child order, so it sits outside the bookmark's physical range even though a draw:frame is not "content" for the paragraph-edge test — the trailing half's extent stops before the lifted block.
    const pkg = odtPackage([
      el("text:p", {}, [
        el("text:bookmark-start", { "text:name": "before-frame" }),
        txt("Anchoring text "),
        el("text:bookmark-end", { "text:name": "before-frame" }),
        el(
          "draw:frame",
          {
            "text:anchor-type": "as-char",
            "svg:width": "2cm",
            "svg:height": "1cm",
          },
          [el("draw:image", { "xlink:href": "Pictures/image1.png" })],
        ),
      ]),
      paragraph("after"),
    ]);
    pkg.parts["Pictures/image1.png"] = { kind: "binary", base64: PNG_BASE64 };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "constructEnd",
      "image",
      "paragraph",
    ]);
  });

  it("reads an embedded formula frame as a ContentEmbeddedObjectBlock carrying the formula document", () => {
    const mathml = el("math", {}, [el("mrow", {}, [el("mi", {}, [txt("x")])])]);
    const pkg = odtPackage([
      el("text:p", {}, [
        el(
          "draw:frame",
          {
            "svg:x": "1cm",
            "svg:y": "1cm",
            "svg:width": "3cm",
            "svg:height": "1cm",
          },
          [el("draw:object", { "xlink:href": "./Object 1" })],
        ),
      ]),
    ]);
    pkg.parts["Object 1/content.xml"] = { kind: "xml", nodes: [mathml] };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    if (blocks[1]?.kind !== "embeddedObject") {
      throw new Error("expected an embedded object block");
    }
    expect(blocks[1].objectKind).toBe("formula");
    expect(blocks[1].document.kind).toBe("formula");
  });

  it("reads an embedded chart as a chart-kind object whose document is a frame-sized drawing page carrying the chart's cached data table, with the chart element quarantined in residue", () => {
    const pkg = odtPackage([
      el("text:p", {}, [
        el(
          "draw:frame",
          {
            "svg:x": "1cm",
            "svg:y": "1cm",
            "svg:width": "8cm",
            "svg:height": "5cm",
          },
          [el("draw:object", { "xlink:href": "./Object 2" })],
        ),
      ]),
    ]);
    pkg.parts["Object 2/content.xml"] = {
      kind: "xml",
      nodes: [
        el("office:document-content", {}, [
          el("office:body", {}, [
            el("office:chart", {}, [
              el("chart:chart", { "chart:class": "bar" }, [
                el("chart:plot-area", {}, [
                  el("table:table", { "table:name": "local-table" }, [
                    el("table:table-row", {}, [
                      el(
                        "table:table-cell",
                        { "office:value-type": "string" },
                        [el("text:p", {}, [txt("Q1")])],
                      ),
                      el(
                        "table:table-cell",
                        { "office:value-type": "float", "office:value": "3" },
                        [el("text:p", {}, [txt("3")])],
                      ),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    const blocks = firstSectionBlocks(pkg);
    if (blocks[1]?.kind !== "embeddedObject") {
      throw new Error("expected an embedded object block");
    }
    const embedded = blocks[1];
    expect(embedded.objectKind).toBe("chart");
    expect(embedded.document.kind).toBe("drawing");
    if (embedded.document.kind !== "drawing") {
      throw new Error("expected a drawing document");
    }
    const page = embedded.document.pages[0];
    const expectedWidthPt = 226.8;
    const expectedHeightPt = 141.75;
    const precisionDigits = 0;
    expect(page?.size.widthPt).toBeCloseTo(expectedWidthPt, precisionDigits);
    expect(page?.size.heightPt).toBeCloseTo(expectedHeightPt, precisionDigits);
    expect(page?.shapes[0]?.blocks[0]?.kind).toBe("table");
    expect(embedded.source?.format).toBe("odt");
    expect(embedded.source?.xml).toContain('<chart:chart chart:class="bar">');
  });

  it("reads an embedded spreadsheet (a Calc OLE object) as a ContentEmbeddedObjectBlock carrying the live sheet, not the frame's ObjectReplacements preview", () => {
    // Insert > Object > OLE Object > Spreadsheet in Writer: the frame carries BOTH a draw:object pointing at the sub-document directory and the usual ObjectReplacements preview draw:image beside it (typed/draw/embedded.ts's own confirmed real-output note), so the object must be checked first — the block below is the sub-sheet read by ods's own reader, the odt->ods dispatch edge whose absence used to degrade this frame to its preview image.
    const pkg = odtPackage([
      el("text:p", {}, [
        txt("Quarterly figures "),
        el(
          "draw:frame",
          {
            "svg:x": "1cm",
            "svg:y": "1cm",
            "svg:width": "6cm",
            "svg:height": "3cm",
          },
          [
            el("draw:object", { "xlink:href": "./Object 3" }),
            el("draw:image", { "xlink:href": "ObjectReplacements/Object 3" }),
          ],
        ),
      ]),
    ]);
    pkg.parts["Object 3/content.xml"] = {
      kind: "xml",
      nodes: [
        el("office:document-content", {}, [
          el("office:body", {}, [
            el("office:spreadsheet", {}, [
              el("table:table", { "table:name": "Sheet1" }, [
                el("table:table-row", {}, [
                  el(
                    "table:table-cell",
                    { "office:value-type": "float", "office:value": "4" },
                    [el("text:p", {}, [txt("4")])],
                  ),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    pkg.parts["ObjectReplacements/Object 3"] = {
      kind: "binary",
      base64: PNG_BASE64,
    };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    if (blocks[1]?.kind !== "embeddedObject") {
      throw new Error("expected an embedded object block");
    }
    expect(blocks[1].objectKind).toBe("spreadsheet");
    expect(blocks[1].document.kind).toBe("spreadsheet");
    if (blocks[1].document.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet document");
    }
    expect(blocks[1].document.sheets).toHaveLength(1);
    expect(blocks[1].document.sheets[0]?.name).toBe("Sheet1");
    expect(blocks[1].document.sheets[0]?.cells[0]?.value).toEqual({
      kind: "number",
      value: 4,
    });
    const expectedFrameWidthPt = 170.1;
    const precisionDigits = 0;
    expect(blocks[1].frame.widthPt).toBeCloseTo(
      expectedFrameWidthPt,
      precisionDigits,
    );
  });
});

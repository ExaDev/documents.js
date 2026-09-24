import { describe, expect, it } from "vitest";
import type { ContentBlock } from "document-schema.js";
import type { Package, XmlNode } from "ooxml.js";
import {
  childrenWithTag,
  readDocxContent as readDocxFlat,
  rootElement,
} from "ooxml.js";
import { writeXlsContent } from "xls-codec";
import type { OmmlDiagnostic } from "../../omml/shared";
import { docxPackageOfBodyXml } from "../../test-support/docx";
import { spliceDocxEmbeddedObjects } from "./embedded-objects";
import { docxMainPartPath } from "./parts";
import { readDocxContent } from "./read";

// spliceDocxEmbeddedObjects' own coverage: the degrade tiers a w:object resolution walks through,
// the run/paragraph classification rules that decide whether a carrying paragraph is consumed, and
// the OMML diagnostic channel's own sourcePath contract. Everything goes through readDocxContent
// so the splice runs against a real upstream read's blocks, exactly as production does.

const EQUATION = "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>";

function xlsPayload(): Uint8Array<ArrayBuffer> {
  return writeXlsContent({
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "cell" },
            displayText: "cell",
          },
        ],
        columns: [],
        rows: [],
        images: [],
        printSettings: {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
          gridlines: false,
          headers: false,
          pageOrder: "downThenOver",
        },
      },
    ],
  });
}

const OLE_BIN_CONTENT_TYPE =
  '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>';

function oleRelsXml(target: string, targetMode?: string): string {
  const mode = targetMode === undefined ? "" : ` TargetMode="${targetMode}"`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="${target}"${mode}/></Relationships>`;
}

// One w:object whose o:OLEObject resolves through rIdOle — every tier test varies only what the
// builder is handed around it, since the resolution chain is the thing under test.
function oleObjectXml(
  sizeAttrs = ' w:dxaOrig="1920" w:dyaOrig="1200"',
): string {
  return `<w:object${sizeAttrs}><o:OLEObject Type="Embed" ProgID="Excel.Sheet.8" r:id="rIdOle"/></w:object>`;
}

function oleDoc(
  bodyXml: string,
  relsTarget: string,
  targetMode?: string,
): Package {
  return docxPackageOfBodyXml(bodyXml, {
    documentRelsXml: oleRelsXml(relsTarget, targetMode),
    extraContentTypesXml: OLE_BIN_CONTENT_TYPE,
    parts: { "word/embeddings/oleObject1.bin": xlsPayload() },
  });
}

function firstSectionBlocks(pkg: Package): readonly ContentBlock[] {
  const doc = readDocxContent(pkg);
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections[0]?.blocks ?? [];
}

// The w:body's own children, for driving spliceDocxEmbeddedObjects directly the way readDocxContent does — the section-level pass's own contract (unchanged sections come back as the very same objects) is only observable against its own input.
function bodyChildren(pkg: Package): readonly XmlNode[] {
  const root = rootElement(pkg.parts[docxMainPartPath(pkg)]);
  const body =
    root === undefined ? undefined : childrenWithTag(root, "w:body")[0];
  if (body === undefined) {
    throw new Error("expected a w:body");
  }
  return body.children;
}

function tableAt(
  blocks: readonly ContentBlock[],
  index: number,
): Extract<ContentBlock, { kind: "table" }> {
  const block = blocks[index];
  if (block?.kind !== "table") {
    throw new Error(`expected a table at blocks[${index}]`);
  }
  return block;
}

describe("spliceDocxEmbeddedObjects: legacy OLE resolution tiers", () => {
  it("recovers nothing and keeps the paragraph when the payload part is absent because no relationship carries the r:id", () => {
    const pkg = docxPackageOfBodyXml(
      `<w:p><w:r>${oleObjectXml()}</w:r></w:p>`,
      {
        documentRelsXml: oleRelsXml("embeddings/oleObject1.bin").replace(
          'Id="rIdOle"',
          'Id="rIdOther"',
        ),
        extraContentTypesXml: OLE_BIN_CONTENT_TYPE,
        parts: { "word/embeddings/oleObject1.bin": xlsPayload() },
      },
    );
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("recovers nothing when the resolved relationship targets an XML part rather than a binary payload", () => {
    // rIdOle -> styles.xml: the part exists and resolves, but its kind is xml, so the payload tier declines it.
    const blocks = firstSectionBlocks(
      oleDoc(`<w:p><w:r>${oleObjectXml()}</w:r></w:p>`, "styles.xml"),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("recovers nothing when the relationship is an external link, whose target names no part of this package", () => {
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>${oleObjectXml()}</w:r></w:p>`,
        "https://example.com/embedded.xls",
        "External",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("recovers nothing when the payload bytes are not a classic OLE compound file at all", () => {
    const pkg = docxPackageOfBodyXml(
      `<w:p><w:r>${oleObjectXml()}</w:r></w:p>`,
      {
        documentRelsXml: oleRelsXml("embeddings/oleObject1.bin"),
        extraContentTypesXml: OLE_BIN_CONTENT_TYPE,
        parts: {
          "word/embeddings/oleObject1.bin": new TextEncoder().encode(
            "plainly not a compound file",
          ),
        },
      },
    );
    expect(firstSectionBlocks(pkg).map((block) => block.kind)).toEqual([
      "paragraph",
    ]);
  });

  it("recovers nothing when the w:object carries no o:OLEObject to name a relationship at all", () => {
    const pkg = docxPackageOfBodyXml("<w:p><w:r><w:object/></w:r></w:p>", {
      documentRelsXml: oleRelsXml("embeddings/oleObject1.bin"),
      extraContentTypesXml: OLE_BIN_CONTENT_TYPE,
      parts: { "word/embeddings/oleObject1.bin": xlsPayload() },
    });
    expect(firstSectionBlocks(pkg).map((block) => block.kind)).toEqual([
      "paragraph",
    ]);
  });

  it("recovers nothing and keeps the paragraph when w:dyaOrig is missing, even though the payload itself resolves", () => {
    // The geometry tier sits after the payload tier, so this fixture needs a genuinely decodable payload: one without the other must still degrade to no block rather than emit one no schema accepts.
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>${oleObjectXml(' w:dxaOrig="1920"')}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("recovers nothing when the recorded size attributes are not numbers", () => {
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>${oleObjectXml(
          ' w:dxaOrig="wide" w:dyaOrig="1200"',
        )}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("recovers nothing when only one of the two size attributes is a number", () => {
    // One finite and one NaN dimension: a frame no geometry schema accepts is emitted never, not partially — the finite check has to reject the pair, not rescue it.
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>${oleObjectXml(
          ' w:dxaOrig="1920" w:dyaOrig="narrow"',
        )}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("keeps the paragraph that carries real text alongside the object, splicing the block in after it", () => {
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r><w:t>see </w:t></w:r><w:r>${oleObjectXml()}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    const embedded = blocks[1];
    expect(
      embedded?.kind === "embeddedObject" ? embedded.sourcePath : undefined,
    ).toBe("sections[0].blocks[1]");
  });
});

describe("spliceDocxEmbeddedObjects: object-only run classification", () => {
  it("consumes a paragraph whose one run carries whitespace text around the object and nothing else", () => {
    // The whitespace-only text nodes a pretty-printed producer leaves inside w:r must not disqualify the run: only non-whitespace text means the paragraph says something of its own.
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>  ${oleObjectXml()}  </w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["embeddedObject"]);
  });

  it("keeps a paragraph whose single run carries non-whitespace text before the object", () => {
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>x${oleObjectXml()}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
  });

  it("recovers both objects of a one-run, two-object paragraph while keeping the paragraph itself", () => {
    // Two element children in one run disqualify the object-only classification (the run is not JUST the object), but both payloads are still recovered, after the paragraph, in document order.
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>${oleObjectXml()}${oleObjectXml()}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "embeddedObject",
    ]);
  });

  it("consumes a paragraph whose every run carries exactly one object, splicing both in document order", () => {
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r>${oleObjectXml()}</w:r><w:r>${oleObjectXml()}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "embeddedObject",
      "embeddedObject",
    ]);
    const frames = blocks.flatMap((block) =>
      block.kind === "embeddedObject" ? [block.frame] : [],
    );
    expect(frames).toEqual([
      { xPt: 0, yPt: 0, widthPt: 96, heightPt: 60 },
      { xPt: 0, yPt: 0, widthPt: 96, heightPt: 60 },
    ]);
  });

  it("recovers an object embedded in a table cell into that cell's own blocks", () => {
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r>${oleObjectXml()}</w:r></w:p></w:tc></w:tr></w:tbl>`,
        "embeddings/oleObject1.bin",
      ),
    );
    const table = blocks[0];
    if (table?.kind !== "table") {
      throw new Error("expected a table");
    }
    expect(table.rows[0]?.cells[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
    ]);
    expect(table.rows[0]?.cells[1]?.blocks.map((block) => block.kind)).toEqual([
      "embeddedObject",
    ]);
  });

  it("pairs each backed cell position with its own w:tc when a row leads with a vertical-merge continuation", () => {
    // A vMerge continuation w:tc still has a grid position of its own (the anchor's column), so it
    // consumes one slot of the row's w:tc enumeration. The dense model carries no blocks for the
    // covered position, so the continuation's own object has no block to splice around and stays
    // unrecovered — but it must also never leak into a sibling column by shifting the pairing, and
    // the sibling column's own equation must still reach the cell its w:tc occupies.
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r>${oleObjectXml()}</w:r></w:p></w:tc><w:tc><w:p>${EQUATION}</w:p></w:tc></w:tr></w:tbl>`,
        "embeddings/oleObject1.bin",
      ),
    );
    const table = blocks[0];
    if (table?.kind !== "table") {
      throw new Error("expected a table");
    }
    expect(table.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(table.rows[1]?.cells[1]?.blocks.map((block) => block.kind)).toEqual([
      "embeddedObject",
    ]);
    const equation = table.rows[1]?.cells[1]?.blocks[0];
    expect(
      equation?.kind === "embeddedObject" ? equation.objectKind : undefined,
    ).toBe("formula");
  });
});

describe("spliceDocxEmbeddedObjects: equation-only paragraph consumption", () => {
  it("consumes a paragraph whose non-content markers sit alongside the equation", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(
        `<w:p><w:pPr/><w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/><w:proofErr/>${EQUATION}</w:p>`,
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["embeddedObject"]);
  });

  it("consumes a paragraph holding an m:oMathPara display wrapper around the equation", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`<w:p><m:oMathPara>${EQUATION}</m:oMathPara></w:p>`),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["embeddedObject"]);
  });

  it("keeps the paragraph of an equation that produced no MathML at all, splicing nothing in", () => {
    // An empty m:oMath is not a formula to carry, but it is also not a reason to drop the paragraph that held it.
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml("<w:p><m:oMath/></w:p>"),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("reports a degraded equation's diagnostics against the final position its recovered block occupies", () => {
    const received: { diagnostic: OmmlDiagnostic; sourcePath?: string }[] = [];
    const doc = readDocxContent(
      docxPackageOfBodyXml(
        `<w:p>${EQUATION.replace("<m:r><m:t>x</m:t></m:r>", "<m:box><m:e><m:r><m:t>x</m:t></m:r></m:e></m:box>")}</w:p>`,
      ),
      {
        onMathDiagnostic: (diagnostic, context) => {
          received.push({ diagnostic, sourcePath: context.sourcePath });
        },
      },
    );
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    // The paragraph was consumed, so the recovered formula block lands at position 0 and its own path is what the diagnostic carries.
    expect(doc.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "embeddedObject",
    ]);
    expect(received).toEqual([
      {
        diagnostic: { kind: "approximated-element", detail: "box" },
        sourcePath: "sections[0].blocks[0]",
      },
    ]);
  });

  it("reports an inline equation's diagnostics against the spliced-in block's own position, not its paragraph's", () => {
    const received: { sourcePath?: string }[] = [];
    const doc = readDocxContent(
      docxPackageOfBodyXml(
        `<w:p><w:r><w:t>t</w:t></w:r>${EQUATION.replace("<m:r><m:t>x</m:t></m:r>", "<m:box><m:e><m:r><m:t>x</m:t></m:r></m:e></m:box>")}</w:p>`,
      ),
      {
        onMathDiagnostic: (_diagnostic, context) => {
          received.push({ sourcePath: context.sourcePath });
        },
      },
    );
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(doc.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    expect(received).toEqual([{ sourcePath: "sections[0].blocks[1]" }]);
  });
});

describe("spliceDocxEmbeddedObjects: vector-only run classification", () => {
  // One page-anchored rect in the one spelling src/ooxml/docx/vector.ts recognises: a wp:anchor
  // page-relative on both axes with an explicit extent, wrapping a wordprocessingShape graphic
  // whose spPr carries a plain rect preset. 127000 EMU is 10pt and 254000 is 20pt, so the anchor
  // places the shape at (10, 20) sized 20 by 10 — every number here is an exact EMU/12700
  // conversion, not a value read back out of the code under test.
  function vectorDrawingXml(offsetYEmu = "254000"): string {
    return `<w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>127000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${offsetYEmu}</wp:posOffset></wp:positionV><wp:extent cx="254000" cy="127000"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="254000" cy="127000"/></a:xfrm><a:noFill/><a:ln><a:noFill/></a:ln><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  }

  function drawingOf(
    block: ContentBlock | undefined,
  ): Extract<ContentBlock, { kind: "embeddedObject" }> | undefined {
    return block?.kind === "embeddedObject" && block.objectKind === "drawing"
      ? block
      : undefined;
  }

  it("consumes a paragraph whose one run carries only a page-anchored vector shape, recovering one drawing block", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`<w:p><w:r>${vectorDrawingXml()}</w:r></w:p>`),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["embeddedObject"]);
    const drawing = drawingOf(blocks[0]);
    if (drawing === undefined) {
      throw new Error("expected a drawing embeddedObject block");
    }
    // The recovered block carries no geometry of its own: the vectors inside the nested one-page drawing document hold it, in the page-relative coordinates they were recovered in.
    expect(drawing.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 0,
      heightPt: 0,
    });
    expect(drawing.document.kind).toBe("drawing");
    const page =
      drawing.document.kind === "drawing"
        ? drawing.document.pages[0]
        : undefined;
    expect(page?.vectors).toEqual([
      {
        kind: "rect",
        frame: { xPt: 10, yPt: 20, widthPt: 20, heightPt: 10 },
        fill: undefined,
        stroke: undefined,
        paintOrder: 0,
      },
    ]);
  });

  it("keeps a paragraph whose run carries text before the vector shape, splicing the drawing in after it", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`<w:p><w:r>v${vectorDrawingXml()}</w:r></w:p>`),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    expect(drawingOf(blocks[1])?.document.kind).toBe("drawing");
  });

  it("consumes a paragraph whose run carries whitespace around the vector shape and nothing else", () => {
    // Pretty-printed producers leave whitespace text nodes inside w:r; only non-whitespace text means the run says something of its own.
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`<w:p><w:r>  ${vectorDrawingXml()}  </w:r></w:p>`),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["embeddedObject"]);
  });

  it("keeps a paragraph whose one run carries TWO vector shapes, recovering both in one drawing block", () => {
    // Two element children in one run disqualify the vector-only classification, but both shapes are still recovered — as ONE drawing block, since a paragraph's vectors share it.
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(
        `<w:p><w:r>${vectorDrawingXml()}${vectorDrawingXml("381000")}</w:r></w:p>`,
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    const drawing = drawingOf(blocks[1]);
    const page =
      drawing?.document.kind === "drawing"
        ? drawing.document.pages[0]
        : undefined;
    // Both shapes keep their own anchor's y offset (20pt and 30pt), numbered in document order.
    expect(
      page?.vectors.map((vector) =>
        vector.kind === "rect" ? vector.frame.yPt : undefined,
      ),
    ).toEqual([20, 30]);
    expect(page?.vectors.map((vector) => vector.paintOrder)).toEqual([0, 1]);
  });

  it("keeps a paragraph whose second run carries a bare line break, which is not a vector shape however empty its text is", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(
        `<w:p><w:r>${vectorDrawingXml()}</w:r><w:r><w:br/></w:r></w:p>`,
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
  });

  it("splices a paragraph carrying an equation, a vector run, and a legacy embedding in that fixed order, keeping the paragraph", () => {
    // One placement per KIND, pushed equations-first, then the paragraph's whole vector group as one drawing, then each legacy embedding in document order.
    const blocks = firstSectionBlocks(
      oleDoc(
        `<w:p><w:r><w:t>mix</w:t></w:r><w:r>${vectorDrawingXml()}</w:r>${EQUATION}<w:r>${oleObjectXml()}</w:r></w:p>`,
        "embeddings/oleObject1.bin",
      ),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "embeddedObject",
      "embeddedObject",
    ]);
    expect(
      blocks.flatMap((block) =>
        block.kind === "embeddedObject" ? [block.objectKind] : [],
      ),
    ).toEqual(["formula", "drawing", "spreadsheet"]);
  });
});

describe("spliceDocxEmbeddedObjects: equations that produce no MathML", () => {
  // <m:box/> with no argument slots yields NO MathML and one unsupported-element diagnostic —
  // the one input shape whose diagnostics have to be reported even though nothing is spliced in.
  const BOX_ONLY = "<m:oMath><m:box/></m:oMath>";

  it("keeps the paragraph and reports its diagnostics against the paragraph's own position when no equation produced MathML", () => {
    const received: { diagnostic: OmmlDiagnostic; sourcePath?: string }[] = [];
    const doc = readDocxContent(
      docxPackageOfBodyXml(`<w:p>${BOX_ONLY}</w:p>`),
      {
        onMathDiagnostic: (diagnostic, context) => {
          received.push({ diagnostic, sourcePath: context.sourcePath });
        },
      },
    );
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(doc.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
    ]);
    expect(received).toEqual([
      {
        diagnostic: { kind: "unsupported-element", detail: "box" },
        sourcePath: "sections[0].blocks[0]",
      },
    ]);
  });

  it("reports a non-rendering equation's diagnostics against the paragraph while a sibling equation's formula is spliced in", () => {
    const received: { detail: string; sourcePath?: string }[] = [];
    const doc = readDocxContent(
      docxPackageOfBodyXml(
        `<w:p><w:r><w:t>t</w:t></w:r>${EQUATION}${BOX_ONLY}</w:p>`,
      ),
      {
        onMathDiagnostic: (diagnostic, context) => {
          received.push({
            detail: diagnostic.detail,
            sourcePath: context.sourcePath,
          });
        },
      },
    );
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    // The rendered equation's block is spliced after the kept paragraph; the box contributed nothing to splice, so its diagnostic is reported eagerly against the paragraph's own path — exactly one diagnostic, from the box.
    expect(doc.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
    expect(received).toEqual([
      { detail: "box", sourcePath: "sections[0].blocks[0]" },
    ]);
  });

  it("consumes a paragraph holding an empty display wrapper beside the equation it already collected", () => {
    // An m:oMathPara with no m:oMath inside carries nothing of its own: every equation it COULD wrap is already collected as a direct detection, so an empty one must not disqualify the paragraph.
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`<w:p>${EQUATION}<m:oMathPara/></w:p>`),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["embeddedObject"]);
  });

  it("keeps a paragraph carrying bare non-whitespace text beside the equation", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`<w:p>${EQUATION} stray words</w:p>`),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
    ]);
  });

  it("consumes a paragraph whose only bare text is whitespace around its non-content markers", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`<w:p><w:pPr/>  ${EQUATION}  </w:p>`),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["embeddedObject"]);
  });
});

describe("spliceDocxEmbeddedObjects: section-level pass", () => {
  const PLAIN_TABLE =
    '<w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const TABLE_WITH_EQUATION_CELL = `<w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p>${EQUATION}</w:p></w:tc></w:tr></w:tbl>`;

  it("returns the very same section objects when the document carried nothing to recover", () => {
    const pkg = docxPackageOfBodyXml(
      `<w:p><w:r><w:t>t</w:t></w:r></w:p>${PLAIN_TABLE}`,
    );
    const upstream = readDocxFlat(pkg);
    const spliced = spliceDocxEmbeddedObjects(
      upstream.sections,
      bodyChildren(pkg),
      pkg,
    );
    expect(spliced).toHaveLength(1);
    expect(spliced[0]).toBe(upstream.sections[0]);
  });

  it("pairs the second table of a two-table body with its own w:tbl, recovering the equation from the second table's cell", () => {
    const blocks = firstSectionBlocks(
      docxPackageOfBodyXml(`${PLAIN_TABLE}${TABLE_WITH_EQUATION_CELL}`),
    );
    const second = tableAt(blocks, 1);
    expect(second.rows[0]?.cells[1]?.blocks.map((block) => block.kind)).toEqual(
      ["embeddedObject"],
    );
    // The first table, matched to the first w:tbl, stays plain.
    expect(
      tableAt(blocks, 0).rows[0]?.cells[1]?.blocks.map((block) => block.kind),
    ).toEqual(["paragraph"]);
  });

  it("rebuilds a cell whose only change is a nested table, keeping a sibling cell of the same row untouched by identity", () => {
    // The cell's own blocks are [paragraph, nested table, empty paragraph]: no placement and no consumption at the cell's own level, so the rebuild is visible only as the changed table element — and a sibling cell with nothing to change must stay the very same object.
    const pkg = docxPackageOfBodyXml(
      `<w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p>${TABLE_WITH_EQUATION_CELL}<w:p/></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    );
    const upstream = readDocxFlat(pkg);
    const spliced = spliceDocxEmbeddedObjects(
      upstream.sections,
      bodyChildren(pkg),
      pkg,
    );
    const outer =
      spliced[0]?.blocks[0]?.kind === "table"
        ? spliced[0].blocks[0]
        : undefined;
    if (outer === undefined) {
      throw new Error("expected the outer table");
    }
    const before =
      upstream.sections[0]?.blocks[0]?.kind === "table"
        ? upstream.sections[0].blocks[0]
        : undefined;
    const cell = outer.rows[0]?.cells[0];
    if (cell === undefined) {
      throw new Error("expected the first cell");
    }
    const nested = cell.blocks[1];
    if (nested?.kind !== "table") {
      throw new Error("expected the nested table as the cell's second block");
    }
    expect(nested.rows[0]?.cells[1]?.blocks.map((block) => block.kind)).toEqual(
      ["embeddedObject"],
    );
    // The cell itself was rebuilt (its table element changed), but the plain sibling cell is the very same object the upstream reader produced.
    const siblingBefore = before?.rows[0]?.cells[1];
    expect(outer.rows[0]?.cells[1]).toBe(siblingBefore);
  });
});

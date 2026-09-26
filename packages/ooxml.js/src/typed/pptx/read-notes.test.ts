import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { PNG_SIGNATURE } from "../../image/sniff";
import { readPptxContent } from "./read";
function asTable(block: ContentBlock | undefined): ContentTable {
  if (block?.kind !== "table") {
    throw new Error("expected a table block");
  }
  return block;
}

const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
function rels(
  entries: readonly {
    id: string;
    type: string;
    target: string;
    external?: boolean;
  }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el(
        "Relationship",
        e.external === true
          ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: "External" }
          : { Id: e.id, Type: e.type, Target: e.target },
      ),
    ),
  );
}

// Only the PNG magic-byte signature matters to sniffImageFormat — the rest is arbitrary filler, not a real encoded image.
function tinyPngBase64(): string {
  const bytes = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 0]);
  return bytesToBase64(bytes);
}

function minimalSlidePackage(
  shapes: readonly ReturnType<typeof el>[],
): Package {
  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, shapes)]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rIdSlide1" })]),
    el("p:sldSz", { cx: "9144000", cy: "6858000" }),
  ]);
  const presentationRels = rels([
    { id: "rIdSlide1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": {
        kind: "xml",
        nodes: [rels([])],
      },
    },
  };
}

function minimalTableGraphicFrame(
  gridCols: readonly ReturnType<typeof el>[],
  rows: readonly ReturnType<typeof el>[],
  xfrmAttrs: Readonly<Record<string, string>> = {},
): ReturnType<typeof el> {
  return el("p:graphicFrame", {}, [
    el("p:nvGraphicFramePr", {}, [el("p:cNvPr", { id: "2", name: "Table 1" })]),
    el("p:xfrm", xfrmAttrs, [
      el("a:off", { x: "914400", y: "914400" }),
      el("a:ext", { cx: "1828800", cy: "914400" }),
    ]),
    el("a:graphic", {}, [
      el(
        "a:graphicData",
        { uri: "http://schemas.openxmlformats.org/drawingml/2006/table" },
        [el("a:tbl", {}, [el("a:tblGrid", {}, gridCols), ...rows])],
      ),
    ]),
  ]);
}

function readOnlyTableCell(frame: ReturnType<typeof el>): ContentTableCell {
  const doc = readPptxContent(minimalSlidePackage([frame]));
  const shape = doc.slides[0]?.shapes.find((s) => s.name === "Table 1");
  const table = asTable(shape?.blocks[0]);
  const cell = table.rows[0]?.cells[0];
  if (cell === undefined) {
    throw new Error("expected a cell");
  }
  return cell;
}

describe("readPptxContent: graphic frame kind dispatch checks its own uri, not merely whichever child element happens to be present", () => {
  it("keeps the frame's geometry with empty content for a chart-uri frame with no c:chart — a spurious a:tbl child is not mistaken for real table content", () => {
    const frame = el("p:graphicFrame", {}, [
      el("p:nvGraphicFramePr", {}, [
        el("p:cNvPr", { id: "2", name: "Chart 1" }),
      ]),
      el("p:xfrm", {}, [
        el("a:off", { x: "914400", y: "914400" }),
        el("a:ext", { cx: "1828800", cy: "914400" }),
      ]),
      el("a:graphic", {}, [
        el(
          "a:graphicData",
          { uri: "http://schemas.openxmlformats.org/drawingml/2006/chart" },
          [
            // No c:chart at all — genuinely chart-typed content that happens to also carry an a:tbl the table branch must never reach, since this frame's own uri isn't the table uri.
            el("a:tbl", {}, [
              el("a:tblGrid", {}, [el("a:gridCol", { w: "914400" })]),
              el("a:tr", {}, [
                el("a:tc", {}, [el("a:txBody", {}, [el("a:p")])]),
              ]),
            ]),
          ],
        ),
      ]),
    ]);
    const doc = readPptxContent(minimalSlidePackage([frame]));
    const shape = doc.slides[0]?.shapes.find((s) => s.name === "Chart 1");
    expect(shape?.blocks).toEqual([]);
  });

  it("keeps the frame's geometry with empty content for an unrecognised uri, even one whose graphicData carries an a:blip an OLE frame would otherwise read", () => {
    const frame = el("p:graphicFrame", {}, [
      el("p:nvGraphicFramePr", {}, [
        el("p:cNvPr", { id: "2", name: "Unknown 1" }),
      ]),
      el("p:xfrm", {}, [
        el("a:off", { x: "914400", y: "914400" }),
        el("a:ext", { cx: "1828800", cy: "914400" }),
      ]),
      el("a:graphic", {}, [
        el(
          "a:graphicData",
          {
            uri: "http://schemas.openxmlformats.org/drawingml/2006/unknownKind",
          },
          [el("a:blip", { "r:embed": "rIdImage" })],
        ),
      ]),
    ]);
    const pkg = minimalSlidePackage([frame]);
    pkg.parts["ppt/slides/_rels/slide1.xml.rels"] = {
      kind: "xml",
      nodes: [
        rels([
          { id: "rIdImage", type: IMAGE_REL, target: "../media/image1.png" },
        ]),
      ],
    };
    pkg.parts["ppt/media/image1.png"] = {
      kind: "binary",
      base64: tinyPngBase64(),
    };
    const doc = readPptxContent(pkg);
    const shape = doc.slides[0]?.shapes.find((s) => s.name === "Unknown 1");
    expect(shape?.blocks).toEqual([]);
  });
});

describe("readPptxContent: a:pattFill with no @prst at all", () => {
  it("reads no background fill when a:pattFill carries no prst attribute", () => {
    const cell = readOnlyTableCell(
      minimalTableGraphicFrame(
        [el("a:gridCol", { w: "914400" })],
        [
          el("a:tr", {}, [
            el("a:tc", {}, [
              el("a:tcPr", {}, [
                el("a:pattFill", {}, [
                  el("a:fgClr", {}, [el("a:srgbClr", { val: "00FF00" })]),
                  el("a:bgClr", {}, [el("a:srgbClr", { val: "0000FF" })]),
                ]),
              ]),
              el("a:txBody", {}, [
                el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("x")])])]),
              ]),
            ]),
          ]),
        ],
      ),
    );
    expect(cell.background).toBeUndefined();
  });
});

describe("readPptxContent: a table column with no @w at all", () => {
  it("reads widthPt: 0 for an a:gridCol carrying no w attribute", () => {
    const frame = minimalTableGraphicFrame(
      [el("a:gridCol", {})],
      [el("a:tr", {}, [el("a:tc", {}, [el("a:txBody", {}, [el("a:p")])])])],
    );
    const doc = readPptxContent(minimalSlidePackage([frame]));
    const shape = doc.slides[0]?.shapes.find((s) => s.name === "Table 1");
    const table = asTable(shape?.blocks[0]);
    expect(table.columns[0]?.widthPt).toBe(0);
  });
});

describe("readPptxContent: a graphic frame's own rotation, composed the same way a shape's is", () => {
  function tableFrameWith(
    xfrmAttrs: Readonly<Record<string, string>>,
  ): ReturnType<typeof el> {
    return minimalTableGraphicFrame(
      [el("a:gridCol", { w: "914400" })],
      [el("a:tr", {}, [el("a:tc", {}, [el("a:txBody", {}, [el("a:p")])])])],
      xfrmAttrs,
    );
  }

  it("reads a table frame's own non-zero p:xfrm@rot as rotationDeg", () => {
    const doc = readPptxContent(
      minimalSlidePackage([tableFrameWith({ rot: "2700000" })]),
    );
    const shape = doc.slides[0]?.shapes.find((s) => s.name === "Table 1");
    const ROTATION_DEG = 45; // 2700000 sixtieths-of-a-degree (p:xfrm@rot's own unit) converted to whole degrees
    expect(shape?.rotationDeg).toBe(ROTATION_DEG);
  });

  it("leaves rotationDeg undefined for an unrotated table frame", () => {
    const doc = readPptxContent(minimalSlidePackage([tableFrameWith({})]));
    const shape = doc.slides[0]?.shapes.find((s) => s.name === "Table 1");
    expect(shape?.rotationDeg).toBeUndefined();
  });
});

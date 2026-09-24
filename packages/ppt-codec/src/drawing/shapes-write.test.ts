import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { PptDiagnostic } from "../diagnostics";
import { PptDiagnosticCodes } from "../diagnostics";
import { childRecords, findChild } from "../record/tree";
import {
  OfficeArtClientTextbox,
  OfficeArtFOPT,
  OfficeArtFSP,
  OfficeArtFSPGR,
} from "../record/types";
import {
  PROPERTY_DX_TEXT_LEFT,
  PROPERTY_DX_TEXT_RIGHT,
  PROPERTY_DY_TEXT_BOTTOM,
  PROPERTY_DY_TEXT_TOP,
  PROPERTY_PIB,
  PROPERTY_ROTATION,
} from "./properties";
import {
  type DrawingShape,
  type DrawingWriteContext,
  writeSlideDrawing,
} from "./shapes-write";
import {
  CONTEXT,
  firstContentShapeRecord,
  firstShapeProperties,
  spgrChildren,
  textShape,
} from "../test-support/drawing-write";

describe("writeSlideDrawing: insets", () => {
  it("writes no inset property at all when every inset matches the plain-text default", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_DX_TEXT_LEFT)).toBeUndefined();
    expect(properties.get(PROPERTY_DY_TEXT_TOP)).toBeUndefined();
    expect(properties.get(PROPERTY_DX_TEXT_RIGHT)).toBeUndefined();
    expect(properties.get(PROPERTY_DY_TEXT_BOTTOM)).toBeUndefined();
  });

  it.each([
    ["insetLeftPt", PROPERTY_DX_TEXT_LEFT],
    ["insetTopPt", PROPERTY_DY_TEXT_TOP],
    ["insetRightPt", PROPERTY_DX_TEXT_RIGHT],
    ["insetBottomPt", PROPERTY_DY_TEXT_BOTTOM],
  ] as const)(
    "writes only %s when it alone differs from the default",
    (field, opid) => {
      const shapes: DrawingShape[] = [
        { shape: textShape({ [field]: 20 }), clientData: undefined },
      ];
      const properties = firstShapeProperties(
        writeSlideDrawing(shapes, CONTEXT),
      );
      const others = [
        PROPERTY_DX_TEXT_LEFT,
        PROPERTY_DY_TEXT_TOP,
        PROPERTY_DX_TEXT_RIGHT,
        PROPERTY_DY_TEXT_BOTTOM,
      ].filter((o) => o !== opid);
      expect(properties.get(opid)).toBeDefined();
      for (const other of others) {
        expect(properties.get(other)).toBeUndefined();
      }
    },
  );

  it("uses zero, not the text default, as a picture shape's own inset default", () => {
    const shapes: DrawingShape[] = [
      {
        shape: textShape({
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: "AA==",
              widthPt: 10,
              heightPt: 10,
            },
          ],
        }),
        clientData: undefined,
      },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_DX_TEXT_LEFT)).toBeUndefined();
    expect(properties.get(PROPERTY_PIB)?.value).toBe(1);
  });
});

describe("writeSlideDrawing: rotation and pib", () => {
  it("writes rotation as a fixed-point degrees value", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape({ rotationDeg: 90 }), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_ROTATION)?.value).toBe(90 * 0x10000);
  });

  it("writes no property table at all for a shape stating nothing beyond the plain-text defaults", () => {
    // A parsed properties map of size 0 is also what an empty-but-present OfficeArtFOPT record would parse as, so this checks for the record's own absence directly rather than merely an empty read-back.
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const shapeRecord = firstContentShapeRecord(written);
    expect(findChild(childRecords(shapeRecord), OfficeArtFOPT)).toBeUndefined();
  });

  it("sets fBid on the pib property, distinctly from rotation's own plain value", () => {
    const shapes: DrawingShape[] = [
      {
        // Insets matching the picture's own zero default (as the sibling "uses zero..." test above relies on too) so pib is the property table's only entry — otherwise insetProperties would add entries of its own, and sorting by opid could put one ahead of pib.
        shape: textShape({
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: "AA==",
              widthPt: 10,
              heightPt: 10,
            },
          ],
        }),
        clientData: undefined,
      },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const shapeRecord = firstContentShapeRecord(written);
    const fopt = findChild(childRecords(shapeRecord), OfficeArtFOPT);
    if (fopt === undefined) {
      throw new Error("expected an OfficeArtFOPT property table");
    }
    // 6-byte entry per property (opid word then a 4-byte value); pib is the only entry, so its own opid word sits right after the 8-byte record header.
    const opidWord = new DataView(
      fopt.data.buffer,
      fopt.data.byteOffset,
    ).getUint16(0, true);
    expect(opidWord & (1 << 15)).not.toBe(0);
  });

  it("stamps recVer 0x2 on a content shape's own OfficeArtFSP", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const shapeRecord = firstContentShapeRecord(written);
    const fsp = findChild(childRecords(shapeRecord), OfficeArtFSP);
    expect(fsp?.header.recVer).toBe(0x2);
  });
});

describe("writeSlideDrawing: block planning", () => {
  function collectDiagnostics(
    shapes: readonly DrawingShape[],
  ): PptDiagnostic[] {
    const diagnostics: PptDiagnostic[] = [];
    const context: DrawingWriteContext = {
      ...CONTEXT,
      sink: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    };
    writeSlideDrawing(shapes, context);
    return diagnostics;
  }

  const embeddedObjectBlock: ContentBlock = {
    kind: "embeddedObject",
    objectKind: "spreadsheet",
    document: { kind: "spreadsheet", metadata: {}, sheets: [] },
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
  };

  it("drops an embeddedObject block outright when the shape carries no OLE client data", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: textShape({ blocks: [embeddedObjectBlock] }),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) =>
          d.code === PptDiagnosticCodes.BLOCK_DROPPED &&
          d.message.includes(
            "a 'embeddedObject' block is dropped; this writer produces no [MS-PPT] spelling for it",
          ),
      ),
    ).toBe(true);
  });

  it("does not silently skip a paragraph block merely because the shape carries OLE client data", () => {
    // hasOleClientData only ever silently skips an embeddedObject block specifically — a shape that also carries real text must keep it regardless.
    const written = writeSlideDrawing(
      [
        {
          shape: textShape({
            blocks: [{ kind: "paragraph", runs: [{ text: "kept" }] }],
          }),
          clientData: new Uint8Array(0),
        },
      ],
      CONTEXT,
    );
    const shapeRecord = firstContentShapeRecord(written);
    const clientTextbox = findChild(
      childRecords(shapeRecord),
      OfficeArtClientTextbox,
    );
    expect(clientTextbox).toBeDefined();
  });

  it("keeps an embeddedObject block silently when the shape does carry OLE client data", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: textShape({ blocks: [embeddedObjectBlock] }),
        clientData: new Uint8Array(0),
      },
    ]);
    expect(
      diagnostics.some((d) => d.code === PptDiagnosticCodes.BLOCK_DROPPED),
    ).toBe(false);
  });

  it("drops a pib-consuming image alongside a table, naming the table-group reason rather than a plain second-image one", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: textShape({
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: "AA==",
              widthPt: 10,
              heightPt: 10,
            },
            { kind: "table", rows: [], columns: [] },
          ],
        }),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) =>
          d.code === PptDiagnosticCodes.IMAGE_DROPPED &&
          d.message.includes(
            "a shape carrying a table becomes a table group, which has no blip reference of its own",
          ),
      ),
    ).toBe(true);
  });
});

describe("writeSlideDrawing: patriarch framing", () => {
  it("stamps recVer 0x1 on the patriarch's own degenerate OfficeArtFSPGR", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const [patriarch] = spgrChildren(written);
    if (patriarch === undefined) {
      throw new Error("expected the patriarch shape container first");
    }
    const fspgr = findChild(childRecords(patriarch), OfficeArtFSPGR);
    expect(fspgr?.header.recVer).toBe(0x1);
  });

  it("counts the patriarch plus every content shape in shapeCount", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    expect(written.shapeCount).toBe(3);
  });
});

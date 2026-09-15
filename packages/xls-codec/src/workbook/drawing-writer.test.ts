import { describe, expect, it } from "vitest";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import type {
  ContentEmbeddedObject,
  ContentSheet,
  ContentSheetCell,
  ContentSheetImage,
  ContentSheetPrintSettings,
} from "document-schema.js";

import { readRecords } from "../biff/records";
import { writeXLUnicodeStringNoCch } from "../biff/string-writer";
import { ESCHER_BSE, ESCHER_SP } from "../drawing/escher-constants";
import { readEscherRecords, type EscherRecord } from "../drawing/escher";
import {
  bytesFromBase64,
  buildDrawingWritePlan,
  placementOfEmbedded,
  placementOfImage,
  writeEmbeddedObjRecord,
  writeFtCf,
  writeFtCmo,
  writeFtPictFmla,
  writeFtPioGrbit,
  writePictureObjRecord,
  WriterGridGeometry,
} from "./drawing-writer";

const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_LETTER,
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function sheet(
  cells: readonly ContentSheetCell[],
  overrides: Partial<Omit<ContentSheet, "name" | "cells">> = {},
): ContentSheet {
  return {
    name: "Sheet1",
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

const PNG_IMAGE: ContentSheetImage = {
  kind: "image",
  format: "png",
  base64: "AAAA",
  widthPt: 10,
  heightPt: 10,
  anchorRow: 0,
  anchorColumn: 0,
  offsetXPt: 0,
  offsetYPt: 0,
};

function embeddedDrawing(
  overrides: Partial<ContentEmbeddedObject> = {},
): ContentEmbeddedObject {
  return {
    objectKind: "drawing",
    document: {
      kind: "drawing",
      metadata: {},
      pages: [{ size: { widthPt: 10, heightPt: 10 }, shapes: [], vectors: [] }],
    },
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    anchorRow: 0,
    anchorColumn: 0,
    offsetXPt: 0,
    offsetYPt: 0,
    ...overrides,
  };
}

/** Concatenates a sheet's own MsoDrawing record chain back into one raw Escher byte stream -- the exact inverse of what drawing.ts's own readSheetDrawing does with the records it reads, but starting from buildDrawingWritePlan's output directly rather than a full read-side round trip. */
function escherBytesFromMsoDrawingRecords(
  records: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const chunks = records.flatMap((record) =>
    readRecords(record).map((r) => r.data),
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Recursively collects every Escher record of a given recType anywhere in the tree, container or atom, in document order. */
function findEscherRecords(
  records: readonly EscherRecord[],
  recType: number,
): EscherRecord[] {
  const found: EscherRecord[] = [];
  for (const record of records) {
    if (record.recType === recType) {
      found.push(record);
    }
    if (record.kind === "container") {
      found.push(...findEscherRecords(record.children, recType));
    }
  }
  return found;
}

/** The first Escher record of a given recType, for a tree this test knows carries exactly one (or where only the first match matters). */
function findEscherRecord(
  records: readonly EscherRecord[],
  recType: number,
): EscherRecord | undefined {
  return findEscherRecords(records, recType)[0];
}

describe("WriterGridGeometry", () => {
  it("sums only the columns strictly before the one asked for, using each column's own declared width rather than the default", () => {
    const geometry = new WriterGridGeometry(
      sheet([], {
        columns: [
          { index: 0, widthPt: 100 },
          { index: 1, widthPt: 50 },
        ],
      }),
    );

    expect(geometry.columnWidthPt(0)).toBe(100);
    expect(geometry.xPt(1)).toBe(100);
    expect(geometry.xPt(2)).toBe(150);
  });

  it("sums only the rows strictly before the one asked for, using each row's own declared height rather than the default", () => {
    const geometry = new WriterGridGeometry(
      sheet([], {
        rows: [
          { index: 0, heightPt: 20 },
          { index: 1, heightPt: 10 },
        ],
      }),
    );

    expect(geometry.rowHeightPt(0)).toBe(20);
    expect(geometry.yPt(1)).toBe(20);
    expect(geometry.yPt(2)).toBe(30);
  });

  it("locates a point exactly at a column's own right edge in the NEXT column, at fraction zero, not the same column at fraction 1023", () => {
    const geometry = new WriterGridGeometry(sheet([]));
    const width = geometry.columnWidthPt(0);

    expect(geometry.locateX(width)).toStrictEqual({ column: 1, fraction: 0 });
  });

  it("locates a point exactly at a row's own bottom edge in the NEXT row, at fraction zero, not the same row at fraction 255", () => {
    const geometry = new WriterGridGeometry(sheet([]));
    const height = geometry.rowHeightPt(0);

    expect(geometry.locateY(height)).toStrictEqual({ row: 1, fraction: 0 });
  });

  it("computes a fraction genuinely proportional to the offset within the column, not the offset scaled by the column's own width a second time", () => {
    const geometry = new WriterGridGeometry(sheet([]));
    const width = geometry.columnWidthPt(0);

    expect(geometry.locateX(width / 2)).toStrictEqual({
      column: 0,
      fraction: 512,
    });
  });

  it("computes a fraction genuinely proportional to the offset within the row, not the offset scaled by the row's own height a second time", () => {
    const geometry = new WriterGridGeometry(sheet([]));
    const height = geometry.rowHeightPt(0);

    expect(geometry.locateY(height / 2)).toStrictEqual({
      row: 0,
      fraction: 128,
    });
  });

  it("clamps a point past BIFF8's own last column to that column's own far edge, rather than continuing to count columns past the grid's own width", () => {
    const geometry = new WriterGridGeometry(sheet([]));
    const width = geometry.columnWidthPt(0);

    expect(geometry.locateX(0xff * width + 0.001)).toStrictEqual({
      column: 0xff,
      fraction: 1023,
    });
  });

  it("clamps a point past BIFF8's own last row to that row's own far edge, rather than continuing to count rows past the grid's own height", () => {
    const geometry = new WriterGridGeometry(sheet([]));
    const height = geometry.rowHeightPt(0);

    expect(geometry.locateY(0xffff * height + 0.001)).toStrictEqual({
      row: 0xffff,
      fraction: 255,
    });
  });
});

describe("placementOfImage", () => {
  const geometry = new WriterGridGeometry(sheet([]));

  it("refuses an image anchored outside BIFF8's own grid, at each of its two edges, naming the exact row and column", () => {
    expect(() =>
      placementOfImage({ ...PNG_IMAGE, anchorRow: 0x10000 }, geometry),
    ).toThrow(/outside BIFF8's own grid/);
    expect(() =>
      placementOfImage({ ...PNG_IMAGE, anchorColumn: 0x100 }, geometry),
    ).toThrow(/outside BIFF8's own grid/);
  });

  it("accepts an image anchored exactly at BIFF8's own grid edges, not one past it", () => {
    expect(() =>
      placementOfImage({ ...PNG_IMAGE, anchorRow: 0xffff }, geometry),
    ).not.toThrow();
    expect(() =>
      placementOfImage({ ...PNG_IMAGE, anchorColumn: 0xff }, geometry),
    ).not.toThrow();
  });
});

describe("placementOfEmbedded", () => {
  const geometry = new WriterGridGeometry(sheet([]));

  it("adds the anchor cell's own offset to its origin, rather than subtracting it", () => {
    const width = geometry.columnWidthPt(0);
    const height = geometry.rowHeightPt(0);
    const placement = placementOfEmbedded(
      embeddedDrawing({
        anchorRow: 1,
        anchorColumn: 1,
        offsetXPt: 3,
        offsetYPt: 4,
      }),
      geometry,
    );

    expect(placement.startXPt).toBe(width + 3);
    expect(placement.startYPt).toBe(height + 4);
  });

  it("uses the frame's own absolute corner when no anchor is stated", () => {
    const placement = placementOfEmbedded(
      embeddedDrawing({
        anchorRow: undefined,
        anchorColumn: undefined,
        offsetXPt: undefined,
        offsetYPt: undefined,
        frame: { xPt: 12, yPt: 34, widthPt: 10, heightPt: 10 },
      }),
      geometry,
    );

    expect(placement.startXPt).toBe(12);
    expect(placement.startYPt).toBe(34);
  });
});

describe("writeFtPioGrbit", () => {
  it("states fAutoPict set for a plain picture and clear for an OLE embedding", () => {
    const autoPict = writeFtPioGrbit(true);
    const storageBased = writeFtPioGrbit(false);
    const autoPictView = new DataView(
      autoPict.buffer,
      autoPict.byteOffset,
      autoPict.byteLength,
    );
    const storageBasedView = new DataView(
      storageBased.buffer,
      storageBased.byteOffset,
      storageBased.byteLength,
    );

    expect(autoPictView.getUint16(4, true)).toBe(0x0001);
    expect(storageBasedView.getUint16(4, true)).toBe(0x0000);
  });
});

describe("writeFtCmo", () => {
  it("carries the object type and id in the fields the reader itself parses them from", () => {
    const bytes = writeFtCmo(0x0008, 42);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint16(4, true)).toBe(0x0008); // ot
    expect(view.getUint16(6, true)).toBe(42); // id
  });
});

describe("writeFtCf", () => {
  it("states the unspecified-format clipboard marker", () => {
    const bytes = writeFtCf();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint16(4, true)).toBe(0xffff);
  });
});

describe("writeFtPictFmla", () => {
  it("states the class name's own character count, not one more or fewer, in cbClass", () => {
    const bytes = writeFtPictFmla(7);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const className = writeXLUnicodeStringNoCch("Package");
    // ft(2) + cb(2) + cbFmla(2) + ObjectParsedFormula(cce 2 + unused 4 + PtgTbl 1 + 4 reserved = 11) + ttb(1) -- cbClass sits right after.
    const cbClassOffset = 2 + 2 + 2 + 11 + 1;

    expect(view.getUint8(cbClassOffset)).toBe(className.length - 1);
  });

  it("states the storage id lPosInCtlStm names, at the record's own trailing four bytes", () => {
    const bytes = writeFtPictFmla(0x2a);

    expect(bytes.length).toBeGreaterThanOrEqual(4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(bytes.length - 4, true)).toBe(0x2a);
  });
});

describe("writePictureObjRecord", () => {
  it("states fAutoPict set, so a plain picture's own aspect ratio tracks the view", () => {
    const bytes = writePictureObjRecord(5);
    const record = readRecords(bytes)[0];
    if (record === undefined) {
      throw new Error("expected a record");
    }
    const view = new DataView(
      record.data.buffer,
      record.data.byteOffset,
      record.data.byteLength,
    );
    // FtCmo(22) + FtCf(6) = 28 bytes before FtPioGrbit; its own ft(2) + cb(2) precede the grbit word itself.
    expect(view.getUint16(28 + 4, true)).toBe(0x0001);
  });
});

describe("writeEmbeddedObjRecord", () => {
  it("states fAutoPict clear, the storage-based pair the Embedding Storage page requires", () => {
    const bytes = writeEmbeddedObjRecord(5, 7);
    const record = readRecords(bytes)[0];
    if (record === undefined) {
      throw new Error("expected a record");
    }
    const view = new DataView(
      record.data.buffer,
      record.data.byteOffset,
      record.data.byteLength,
    );
    expect(view.getUint16(28 + 4, true)).toBe(0x0000);
  });
});

describe("bytesFromBase64", () => {
  it("decodes a base64 string whose length forces two padding characters, without treating either as real data", () => {
    // "f" alone (length 1) encodes to "Zg==" -- two padding characters, and the ONLY way to exercise the padding-character skip at all, since every other fixture in this package's own test suite happens to use base64 with no padding at all.
    expect(bytesFromBase64("Zg==")).toStrictEqual(new Uint8Array([0x66]));
  });

  it("refuses a character that is not part of the base64 alphabet, naming it exactly, rather than silently skipping it", () => {
    // "=" is only ever valid as genuine trailing padding, sliced off before this loop even runs -- one sitting anywhere else in the string is exactly as invalid as any other non-alphabet character.
    expect(() => bytesFromBase64("AB=C")).toThrow(
      'a sheet image\'s own base64 payload contains "=", which is not part of the base64 alphabet',
    );
  });

  it("decodes a base64 string whose length forces exactly one padding character", () => {
    // "fo" (length 2) encodes to "Zm8=" -- one padding character.
    expect(bytesFromBase64("Zm8=")).toStrictEqual(new Uint8Array([0x66, 0x6f]));
  });

  it("decodes a base64 string needing no padding at all, isolating the zero-padding arithmetic from both padded cases above", () => {
    // "foo" (length 3) encodes to "Zm9v" -- no padding.
    expect(bytesFromBase64("Zm9v")).toStrictEqual(
      new Uint8Array([0x66, 0x6f, 0x6f]),
    );
  });
});

describe("buildDrawingWritePlan", () => {
  it("writes no MsoDrawing/Obj records and no drawing-group bytes at all for a workbook with no images or embedded objects on any sheet", () => {
    const plan = buildDrawingWritePlan([sheet([])]);

    expect(plan.drawingGroupBytes).toBeUndefined();
    expect(plan.sheetDrawings).toStrictEqual([
      { msoDrawingRecords: [], objRecords: [] },
    ]);
    expect(plan.embeddingStreams).toStrictEqual([]);
  });

  it("refuses a sheet image of a format [MS-ODRAW]'s own MSOBLIPTYPE enumeration has no member for, naming the exact format", () => {
    expect(() =>
      buildDrawingWritePlan([
        sheet([], { images: [{ ...PNG_IMAGE, format: "gif" }] }),
      ]),
    ).toThrow(
      'xls-codec cannot write a sheet image of format "gif": [MS-ODRAW]\'s own MSOBLIPTYPE enumeration has no member for it, so no Blip Store entry can carry it',
    );
  });

  it("accepts a jpeg image, the second of the two formats this writer actually supports", () => {
    expect(() =>
      buildDrawingWritePlan([
        sheet([], { images: [{ ...PNG_IMAGE, format: "jpeg" }] }),
      ]),
    ).not.toThrow();
  });

  it("refuses a 'chart' embedded object by name", () => {
    const chart: ContentEmbeddedObject = {
      objectKind: "chart",
      document: {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Chart",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: PRINT_SETTINGS,
          },
        ],
      },
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    };
    expect(() =>
      buildDrawingWritePlan([sheet([], { embeddedObjects: [chart] })]),
    ).toThrow(/cannot write a 'chart' embedded object/);
  });

  it("grows a repeated image's own Blip Store reference count, rather than shrinking it or minting a second entry", () => {
    const plan = buildDrawingWritePlan([
      sheet([], { images: [PNG_IMAGE, PNG_IMAGE] }),
    ]);
    const records = readEscherRecords(
      plan.drawingGroupBytes ?? new Uint8Array(),
    );
    const bse = findEscherRecord(records, ESCHER_BSE);
    expect(bse?.kind).toBe("atom");
    if (bse?.kind !== "atom") {
      throw new Error("expected a BSE atom");
    }
    const view = new DataView(
      bse.data.buffer,
      bse.data.byteOffset,
      bse.data.byteLength,
    );
    // btWin32(1) + btMacOS(1) + rgbUid(16) + tag(2) + size(4) = 24 bytes before cRef.
    expect(view.getUint32(24, true)).toBe(2);
  });

  it("sets a plain image's shape as a picture, clearing fOleShape, and an embedded OLE object's shape with fOleShape set, never the other way round", () => {
    const imagePlan = buildDrawingWritePlan([
      sheet([], { images: [PNG_IMAGE] }),
    ]);
    const embeddedPlan = buildDrawingWritePlan([
      sheet([], { embeddedObjects: [embeddedDrawing()] }),
    ]);
    const imageEscher = escherBytesFromMsoDrawingRecords(
      imagePlan.sheetDrawings[0]?.msoDrawingRecords ?? [],
    );
    const embeddedEscher = escherBytesFromMsoDrawingRecords(
      embeddedPlan.sheetDrawings[0]?.msoDrawingRecords ?? [],
    );
    // Index 1, not 0: the patriarch (whose own Sp atom is always the tree's first) never carries fOleShape either way, so the real shape under test is the SECOND Sp atom in document order.
    const imageSp = findEscherRecords(
      readEscherRecords(imageEscher),
      ESCHER_SP,
    )[1];
    const embeddedSp = findEscherRecords(
      readEscherRecords(embeddedEscher),
      ESCHER_SP,
    )[1];
    if (imageSp?.kind !== "atom" || embeddedSp?.kind !== "atom") {
      throw new Error("expected Sp atoms");
    }
    const FSP_FLAG_OLE_SHAPE = 0x1 << 4;
    const imageFlags = new DataView(
      imageSp.data.buffer,
      imageSp.data.byteOffset,
      imageSp.data.byteLength,
    ).getUint32(4, true);
    const embeddedFlags = new DataView(
      embeddedSp.data.buffer,
      embeddedSp.data.byteOffset,
      embeddedSp.data.byteLength,
    ).getUint32(4, true);

    expect(imageFlags & FSP_FLAG_OLE_SHAPE).toBe(0);
    expect(embeddedFlags & FSP_FLAG_OLE_SHAPE).toBe(FSP_FLAG_OLE_SHAPE);
  });

  it("continues a sheet's own Obj object ids past its commented cells' ids, rather than starting at 1 and colliding with them, counting only the cells that actually carry a comment", () => {
    const plan = buildDrawingWritePlan([
      sheet(
        [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
            comment: { text: "note" },
          },
          {
            row: 0,
            column: 1,
            value: { kind: "string", value: "y" },
            displayText: "y",
          },
          {
            row: 0,
            column: 2,
            value: { kind: "string", value: "z" },
            displayText: "z",
            comment: { text: "another" },
          },
        ],
        { images: [PNG_IMAGE, PNG_IMAGE] },
      ),
    ]);
    const objectIds = plan.sheetDrawings[0]?.objRecords.map((objRecord) => {
      const record = readRecords(objRecord)[0];
      if (record === undefined) {
        throw new Error("expected a parsed Obj record");
      }
      const view = new DataView(
        record.data.buffer,
        record.data.byteOffset,
        record.data.byteLength,
      );
      return view.getUint16(6, true);
    });

    // 3 cells, 2 of which carry a comment -- ids start at 3 (2 comments + 1) and continue sequentially, not starting at 1 (which would collide with the comments' own ids) and not counting the third, comment-free cell.
    expect(objectIds).toStrictEqual([3, 4]);
  });

  it("continues each embedded object's own Obj object id sequentially, not just the first", () => {
    const plan = buildDrawingWritePlan([
      sheet([], {
        embeddedObjects: [embeddedDrawing(), embeddedDrawing()],
      }),
    ]);
    const objectIds = plan.sheetDrawings[0]?.objRecords.map((objRecord) => {
      const record = readRecords(objRecord)[0];
      if (record === undefined) {
        throw new Error("expected a parsed Obj record");
      }
      const view = new DataView(
        record.data.buffer,
        record.data.byteOffset,
        record.data.byteLength,
      );
      return view.getUint16(6, true);
    });

    expect(objectIds).toStrictEqual([1, 2]);
  });

  it("assigns each embedded object its own sequential storage id, reaching past single digits into the hex alphabet's own letters, spelled uppercase", () => {
    const plan = buildDrawingWritePlan([
      sheet([], {
        embeddedObjects: Array.from({ length: 11 }, () => embeddedDrawing()),
      }),
    ]);

    expect(plan.embeddingStreams.map((stream) => stream.path)).toStrictEqual([
      "MBD00000001/Package",
      "MBD00000002/Package",
      "MBD00000003/Package",
      "MBD00000004/Package",
      "MBD00000005/Package",
      "MBD00000006/Package",
      "MBD00000007/Package",
      "MBD00000008/Package",
      "MBD00000009/Package",
      "MBD0000000A/Package",
      "MBD0000000B/Package",
    ]);
  });

  it("reports the largest shape id, total shape count, and each drawing's own sequential id across every sheet's own drawing, not just the last one written", () => {
    const plan = buildDrawingWritePlan([
      sheet([], { images: [PNG_IMAGE] }),
      sheet([], { images: [PNG_IMAGE, PNG_IMAGE] }),
    ]);
    const records = readEscherRecords(
      plan.drawingGroupBytes ?? new Uint8Array(),
    );
    const fdgg = findEscherRecord(records, 0xf006);
    if (fdgg?.kind !== "atom") {
      throw new Error("expected an FDGG atom");
    }
    const view = new DataView(
      fdgg.data.buffer,
      fdgg.data.byteOffset,
      fdgg.data.byteLength,
    );
    // Sheet A allocates spids 1024 (patriarch) and 1025 (its one image); sheet B continues from 1026 (patriarch) through 1028 (its two images) -- spidMax is B's own last spid, and cspSaved is every shape (patriarch included) across both sheets: 2 + 3 = 5.
    expect(view.getUint32(0, true)).toBe(1028); // spidMax
    expect(view.getUint32(8, true)).toBe(5); // cspSaved
    expect(view.getUint32(12, true)).toBe(2); // cdgSaved
    // One OfficeArtIDCL per drawing, right after the four header fields: drawingId(4) + lastSpid(4) each, in drawing order -- sheet A's own drawing is id 1, sheet B's is id 2, not the reverse and not both landing on the same id.
    expect(view.getUint32(16, true)).toBe(1); // sheet A's own drawingId
    expect(view.getUint32(24, true)).toBe(2); // sheet B's own drawingId
  });

  it("gives each sheet's own real shapes distinct, non-overlapping spids across the workbook, continuing from the previous sheet's own last one rather than restarting", () => {
    const plan = buildDrawingWritePlan([
      sheet([], { images: [PNG_IMAGE] }),
      sheet([], { images: [PNG_IMAGE] }),
    ]);
    const sheetAEscher = escherBytesFromMsoDrawingRecords(
      plan.sheetDrawings[0]?.msoDrawingRecords ?? [],
    );
    const sheetBEscher = escherBytesFromMsoDrawingRecords(
      plan.sheetDrawings[1]?.msoDrawingRecords ?? [],
    );
    // Index 1: the patriarch's own Sp atom is always first, the real shape second.
    const sheetAShape = findEscherRecords(
      readEscherRecords(sheetAEscher),
      ESCHER_SP,
    )[1];
    const sheetBShape = findEscherRecords(
      readEscherRecords(sheetBEscher),
      ESCHER_SP,
    )[1];
    if (sheetAShape?.kind !== "atom" || sheetBShape?.kind !== "atom") {
      throw new Error("expected Sp atoms");
    }
    const sheetASpid = new DataView(
      sheetAShape.data.buffer,
      sheetAShape.data.byteOffset,
      sheetAShape.data.byteLength,
    ).getUint32(0, true);
    const sheetBSpid = new DataView(
      sheetBShape.data.buffer,
      sheetBShape.data.byteOffset,
      sheetBShape.data.byteLength,
    ).getUint32(0, true);

    expect(sheetBSpid).toBeGreaterThan(sheetASpid);
  });
});

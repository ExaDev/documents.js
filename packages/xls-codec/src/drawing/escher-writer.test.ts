import { afterEach, describe, expect, it, vi } from "vitest";

import { BiffWriteError } from "../biff/write-errors";
import {
  childrenOfType,
  findDescendant,
  readEscherRecords,
  type EscherAtom,
  type EscherContainer,
} from "./escher";
import * as md4Module from "./md4";
import { md4 } from "./md4";
import {
  ESCHER_BSE,
  ESCHER_BSTORE_CONTAINER,
  ESCHER_DGG_CONTAINER,
  ESCHER_SP,
  ESCHER_SP_CONTAINER,
  ESCHER_SPGR_CONTAINER,
} from "./escher-constants";
import {
  writeDrawingGroupBytes,
  writeSheetDrawingBytes,
  type DrawingIdBlock,
  type SheetShapeEntry,
} from "./escher-writer";

function u32At(data: Uint8Array<ArrayBuffer>, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    offset,
    true,
  );
}

function readOneRoot(bytes: Uint8Array<ArrayBuffer>): EscherContainer {
  const [root] = readEscherRecords(bytes);
  if (root?.kind !== "container") {
    throw new Error("expected a single container root");
  }
  return root;
}

const NO_ANCHOR = {
  colL: 0,
  dxL: 0,
  rwT: 0,
  dyT: 0,
  colR: 0,
  dxR: 0,
  rwB: 0,
  dyB: 0,
};

function shapeEntry(overrides: Partial<SheetShapeEntry> = {}): SheetShapeEntry {
  return {
    anchor: NO_ANCHOR,
    blipIndex: undefined,
    oleShape: false,
    ...overrides,
  };
}

describe("writeDrawingGroupBytes", () => {
  it("states spidMax as zero, cidcl as one, and no blip store, for no drawings and no blips at all", () => {
    const dgg = readOneRoot(writeDrawingGroupBytes([], []));
    expect(dgg.recType).toBe(ESCHER_DGG_CONTAINER);
    const [fdggBlock] = dgg.children;
    if (fdggBlock?.kind !== "atom") {
      throw new Error("expected the FDGG atom");
    }
    expect(u32At(fdggBlock.data, 0)).toBe(0); // spidMax
    expect(u32At(fdggBlock.data, 4)).toBe(1); // cidcl = 0 drawings + 1
    expect(u32At(fdggBlock.data, 8)).toBe(0); // cspSaved
    expect(u32At(fdggBlock.data, 12)).toBe(0); // cdgSaved
    expect(childrenOfType(dgg, ESCHER_BSTORE_CONTAINER)).toHaveLength(0);
  });

  it("states spidMax as the largest lastSpid, not the smallest, across several drawings", () => {
    const drawings: readonly DrawingIdBlock[] = [
      { drawingId: 1, lastSpid: 5, shapeCount: 2 },
      { drawingId: 2, lastSpid: 20, shapeCount: 7 },
    ];
    const dgg = readOneRoot(writeDrawingGroupBytes([], drawings));
    const [fdggBlock] = dgg.children;
    if (fdggBlock?.kind !== "atom") {
      throw new Error("expected the FDGG atom");
    }
    expect(u32At(fdggBlock.data, 0)).toBe(20); // spidMax: max(5, 20), not min
    expect(u32At(fdggBlock.data, 4)).toBe(3); // cidcl = 2 drawings + 1
    expect(u32At(fdggBlock.data, 8)).toBe(9); // cspSaved: 2 + 7 summed, not subtracted
    expect(u32At(fdggBlock.data, 12)).toBe(2); // cdgSaved
    // One OfficeArtIDCL per drawing, in order: dgid then that drawing's own lastSpid.
    expect(u32At(fdggBlock.data, 16)).toBe(1);
    expect(u32At(fdggBlock.data, 20)).toBe(5);
    expect(u32At(fdggBlock.data, 24)).toBe(2);
    expect(u32At(fdggBlock.data, 28)).toBe(20);
  });

  it("writes no Blip Store at all when there are no blips", () => {
    const dgg = readOneRoot(writeDrawingGroupBytes([], []));
    expect(childrenOfType(dgg, ESCHER_BSTORE_CONTAINER)).toHaveLength(0);
  });

  it("writes a JPEG blip's own recType/recInstance, not PNG's", () => {
    const dgg = readOneRoot(
      writeDrawingGroupBytes(
        [
          {
            format: "jpeg",
            fileBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
            referenceCount: 1,
          },
        ],
        [],
      ),
    );
    const bstore = findDescendant(dgg, ESCHER_BSTORE_CONTAINER);
    if (bstore?.kind !== "container") {
      throw new Error("expected the Blip Store container");
    }
    const [bse] = childrenOfType(bstore, ESCHER_BSE);
    if (bse?.kind !== "atom") {
      throw new Error("expected a BSE atom");
    }
    // btWin32/btMacOS sit at the very start of the FBSE's own fixed fields; MSOBLIP_JPEG is 0x05, MSOBLIP_PNG 0x06.
    expect(bse.data[0]).toBe(0x05);
    expect(bse.data[1]).toBe(0x05);
  });

  it("writes a Blip Store whose own recInstance states the exact BSE count", () => {
    const dgg = readOneRoot(
      writeDrawingGroupBytes(
        [
          {
            format: "png",
            fileBytes: new Uint8Array([1, 2, 3]),
            referenceCount: 1,
          },
        ],
        [],
      ),
    );
    const [bstore] = childrenOfType(dgg, ESCHER_BSTORE_CONTAINER);
    if (bstore?.kind !== "container") {
      throw new Error("expected the Blip Store container");
    }
    expect(bstore.recInstance).toBe(1);
    expect(childrenOfType(bstore, ESCHER_BSE)).toHaveLength(1);
  });

  it("derives every BSE's own rgbUid from md4 of its exact file bytes, byte for byte", () => {
    const fileBytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const dgg = readOneRoot(
      writeDrawingGroupBytes(
        [{ format: "png", fileBytes, referenceCount: 1 }],
        [],
      ),
    );
    const bstore = findDescendant(dgg, ESCHER_BSTORE_CONTAINER);
    if (bstore?.kind !== "container") {
      throw new Error("expected the Blip Store container");
    }
    const [bse] = childrenOfType(bstore, ESCHER_BSE);
    if (bse?.kind !== "atom") {
      throw new Error("expected a BSE atom");
    }
    // rgbUid sits right after btWin32/btMacOS, 2 bytes into the FBSE's own fixed fields.
    const rgbUid = bse.data.slice(2, 18);
    const digestHex = md4(fileBytes);
    const expectedUid = Uint8Array.from({ length: 16 }, (_, index) => {
      const byteHex = digestHex.slice(index * 2, index * 2 + 2);
      return Number.parseInt(byteHex, 16);
    });
    expect(rgbUid).toStrictEqual(expectedUid);
  });

  describe("errors that are not malformed-input degrades", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("refuses to write a BSE whose own md4 digest is not exactly 16 bytes", () => {
      vi.spyOn(md4Module, "md4").mockReturnValue("aabb"); // 2 bytes, not 16
      expect(() =>
        writeDrawingGroupBytes(
          [
            {
              format: "png",
              fileBytes: new Uint8Array([1]),
              referenceCount: 1,
            },
          ],
          [],
        ),
      ).toThrow(BiffWriteError);
      expect(() =>
        writeDrawingGroupBytes(
          [
            {
              format: "png",
              fileBytes: new Uint8Array([1]),
              referenceCount: 1,
            },
          ],
          [],
        ),
      ).toThrow(/2-byte digest/);
    });
  });
});

describe("writeSheetDrawingBytes", () => {
  it("allocates the patriarch at spidBase and each real shape at the following ids, in order", () => {
    const entries: readonly SheetShapeEntry[] = [
      shapeEntry(),
      shapeEntry(),
      shapeEntry(),
    ];
    const dg = readOneRoot(writeSheetDrawingBytes(1, 1024, entries));
    const [fdg] = dg.children;
    if (fdg?.kind !== "atom") {
      throw new Error("expected the FDG atom");
    }
    expect(u32At(fdg.data, 0)).toBe(4); // csp: 3 shapes + the patriarch
    expect(u32At(fdg.data, 4)).toBe(1027); // spidCur: spidBase + entries.length

    const [spgr] = childrenOfType(dg, ESCHER_SPGR_CONTAINER);
    if (spgr?.kind !== "container") {
      throw new Error("expected the SpgrContainer");
    }
    const spContainers = childrenOfType(spgr, ESCHER_SP_CONTAINER);
    expect(spContainers).toHaveLength(4); // patriarch + 3 shapes

    function spidOf(spContainer: EscherContainer | EscherAtom): number {
      if (spContainer.kind !== "container") {
        throw new Error("expected an SpContainer");
      }
      const [fsp] = childrenOfType(spContainer, ESCHER_SP);
      if (fsp?.kind !== "atom") {
        throw new Error("expected an FSP atom");
      }
      return u32At(fsp.data, 0);
    }

    expect(spContainers.map((sp) => spidOf(sp))).toStrictEqual([
      1024, // patriarch
      1025,
      1026,
      1027,
    ]);
  });

  it("continues allocating from a nonzero spidBase, not from zero", () => {
    const entries: readonly SheetShapeEntry[] = [shapeEntry(), shapeEntry()];
    const dg = readOneRoot(writeSheetDrawingBytes(2, 500, entries));
    const [fdg] = dg.children;
    if (fdg?.kind !== "atom") {
      throw new Error("expected the FDG atom");
    }
    expect(u32At(fdg.data, 4)).toBe(502); // spidCur: 500 + 2
  });
});

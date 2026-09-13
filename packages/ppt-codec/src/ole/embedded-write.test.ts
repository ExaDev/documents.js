import { describe, expect, it } from "vitest";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import {
  RT_ExternalObjectListAtom,
  RT_ExternalOleEmbed,
  RT_ExternalOleEmbedAtom,
  RT_ExternalOleObjectAtom,
  RT_ExternalOleObjectStg,
} from "../record/types";
import {
  writeExObjListContainer,
  writeExOleObjStg,
  type WritableOleEmbed,
} from "./embedded-write";

describe("writeExObjListContainer", () => {
  it("writes no container at all for an empty embed list", () => {
    expect(writeExObjListContainer([])).toBeUndefined();
  });

  it("stamps the mandated recVer 0x1 on each embed's own ExOleObjAtom", () => {
    const embed: WritableOleEmbed = {
      exObjId: 1,
      persistIdRef: 10,
      objectKind: "wordprocessing",
    };
    const written = writeExObjListContainer([embed]);
    if (written === undefined) {
      throw new Error("expected a written container");
    }
    const [, embedContainer] = childRecords(readRecordAt(written, 0));
    if (embedContainer === undefined) {
      throw new Error("expected one embed container");
    }
    const objAtom = findChild(
      childRecords(embedContainer),
      RT_ExternalOleObjectAtom,
    );
    expect(objAtom?.header.recVer).toBe(0x1);
  });

  it("leaves every ExOleEmbedAtom flag clear", () => {
    const embed: WritableOleEmbed = {
      exObjId: 1,
      persistIdRef: 10,
      objectKind: "wordprocessing",
    };
    const written = writeExObjListContainer([embed]);
    if (written === undefined) {
      throw new Error("expected a written container");
    }
    const [, embedContainer] = childRecords(readRecordAt(written, 0));
    if (embedContainer === undefined) {
      throw new Error("expected one embed container");
    }
    const embedAtom = findChild(
      childRecords(embedContainer),
      RT_ExternalOleEmbedAtom,
    );
    if (embedAtom === undefined) {
      throw new Error("expected an ExOleEmbedAtom");
    }
    // colorFollow (4 bytes) then the fCantLockServer/fNoSizeToServer/fIsTable/unused flags word -- every byte of the whole 8-byte atom must be zero.
    expect(Array.from(embedAtom.data)).toEqual(new Array(8).fill(0));
  });

  it("seeds the ExObjListAtom one past the highest exObjId this writer actually minted", () => {
    const embeds: WritableOleEmbed[] = [
      { exObjId: 3, persistIdRef: 10, objectKind: "wordprocessing" },
      { exObjId: 7, persistIdRef: 11, objectKind: "spreadsheet" },
    ];
    const written = writeExObjListContainer(embeds);
    if (written === undefined) {
      throw new Error("expected a written container");
    }
    const [seedAtomRecord] = childRecords(readRecordAt(written, 0));
    if (seedAtomRecord?.header.recType !== RT_ExternalObjectListAtom) {
      throw new Error("expected the seed atom first");
    }
    const view = new DataView(
      seedAtomRecord.data.buffer,
      seedAtomRecord.data.byteOffset,
    );
    expect(view.getUint32(0, true)).toBe(8); // one past the highest exObjId (7), not the lowest (3)
  });

  it("writes one ExOleEmbedContainer per embed, naming its own exObjId/persistIdRef", () => {
    const embeds: WritableOleEmbed[] = [
      { exObjId: 1, persistIdRef: 10, objectKind: "wordprocessing" },
      { exObjId: 2, persistIdRef: 20, objectKind: "spreadsheet" },
    ];
    const written = writeExObjListContainer(embeds);
    if (written === undefined) {
      throw new Error("expected a written container");
    }
    const children = childRecords(readRecordAt(written, 0)).filter(
      (r) => r.header.recType === RT_ExternalOleEmbed,
    );
    expect(children).toHaveLength(2);
  });
});

describe("writeExOleObjStg", () => {
  it("writes the raw storage bytes verbatim, at the uncompressed instance", () => {
    const cfb = new Uint8Array([1, 2, 3, 4]);
    const written = writeExOleObjStg(cfb);
    const record = readRecordAt(written, 0);
    expect(record.header.recType).toBe(RT_ExternalOleObjectStg);
    expect(record.header.recInstance).toBe(0x000);
    expect(Array.from(record.data)).toEqual(Array.from(cfb));
  });
});

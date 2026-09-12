import { deflate } from "byte-codec";
import { describe, expect, it } from "vitest";
import { childRecords, readRecordAt } from "../record/tree";
import {
  OfficeArtClientData,
  RT_CString,
  RT_Document,
  RT_ExternalObjectList,
  RT_ExternalObjectRefAtom,
  RT_ExternalOleEmbed,
  RT_ExternalOleObjectAtom,
  RT_ExternalOleObjectStg,
} from "../record/types";
import {
  concatBytes,
  u32le,
  utf16le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import {
  writeExObjListContainer,
  writeOleClientData,
  writeExOleObjStg,
  type WritableOleEmbed,
} from "./embedded-write";
import {
  readExObjIdRef,
  readExternalOleEmbeds,
  resolveOleObjectStorage,
} from "./embedded";

describe("readExternalOleEmbeds", () => {
  it("resolves a real embed's exObjId, persistIdRef and progId, keyed by exObjId", () => {
    const embed: WritableOleEmbed = {
      exObjId: 1,
      persistIdRef: 10,
      objectKind: "wordprocessing",
    };
    const documentChildren = childRecords(
      readRecordAt(
        container(RT_Document, [
          writeExObjListContainer([embed]) ?? new Uint8Array(0),
        ]),
        0,
      ),
    );
    const embeds = readExternalOleEmbeds(documentChildren);
    expect(embeds.get(1)).toEqual({
      exObjId: 1,
      persistIdRef: 10,
      progId: "Word.Document.8",
    });
  });

  it("resolves a kind with no real-world ProgID as progId undefined", () => {
    const embed: WritableOleEmbed = {
      exObjId: 1,
      persistIdRef: 10,
      objectKind: "chart",
    };
    const documentChildren = childRecords(
      readRecordAt(
        container(RT_Document, [
          writeExObjListContainer([embed]) ?? new Uint8Array(0),
        ]),
        0,
      ),
    );
    expect(
      readExternalOleEmbeds(documentChildren).get(1)?.progId,
    ).toBeUndefined();
  });

  it("reads several embeds, each keyed by its own exObjId", () => {
    const embeds: WritableOleEmbed[] = [
      { exObjId: 1, persistIdRef: 10, objectKind: "wordprocessing" },
      { exObjId: 2, persistIdRef: 11, objectKind: "spreadsheet" },
    ];
    const documentChildren = childRecords(
      readRecordAt(
        container(RT_Document, [
          writeExObjListContainer(embeds) ?? new Uint8Array(0),
        ]),
        0,
      ),
    );
    const result = readExternalOleEmbeds(documentChildren);
    expect(result.get(1)?.persistIdRef).toBe(10);
    expect(result.get(2)?.persistIdRef).toBe(11);
  });

  it("returns an empty map when the document carries no ExObjListContainer at all", () => {
    const documentChildren = childRecords(
      readRecordAt(container(RT_Document, []), 0),
    );
    expect(readExternalOleEmbeds(documentChildren).size).toBe(0);
  });

  it("omits a real container whose own ExOleObjAtom is missing, rather than throwing", () => {
    const documentChildren = childRecords(
      readRecordAt(
        container(RT_Document, [
          container(RT_ExternalObjectList, [
            container(RT_ExternalOleEmbed, []),
          ]),
        ]),
        0,
      ),
    );
    expect(readExternalOleEmbeds(documentChildren).size).toBe(0);
  });

  it("skips a sibling record of some other type inside the ExObjListContainer", () => {
    const embed: WritableOleEmbed = {
      exObjId: 1,
      persistIdRef: 10,
      objectKind: "wordprocessing",
    };
    const written = writeExObjListContainer([embed]);
    if (written === undefined) {
      throw new Error("expected a written ExObjListContainer");
    }
    // Splice an unrelated sibling record between the seed atom and the real embed container.
    const record = readRecordAt(written, 0);
    const [seedAtom, embedContainer] = childRecords(record);
    if (seedAtom === undefined || embedContainer === undefined) {
      throw new Error("expected the seed atom and one embed container");
    }
    const withSibling = container(RT_ExternalObjectList, [
      seedAtom.stream.subarray(
        seedAtom.offset,
        seedAtom.dataOffset + seedAtom.header.recLen,
      ),
      atom(RT_Document, u32le(0)), // an unrelated sibling record type, never RT_ExternalOleEmbed
      embedContainer.stream.subarray(
        embedContainer.offset,
        embedContainer.dataOffset + embedContainer.header.recLen,
      ),
    ]);
    const documentChildren = childRecords(
      readRecordAt(container(RT_Document, [withSibling]), 0),
    );
    expect(readExternalOleEmbeds(documentChildren).get(1)?.persistIdRef).toBe(
      10,
    );
  });

  it("finds the ProgIDAtom by its own recInstance among an embed's CString siblings, not merely by record type", () => {
    // menuNameAtom and clipboardNameAtom are also RT_CString, distinguished only by recInstance -- a lookup keyed on type alone could pick either up instead of the real ProgIDAtom (recInstance 0x002).
    const objAtom = atom(
      RT_ExternalOleObjectAtom,
      concatBytes(u32le(1), u32le(0), u32le(1), u32le(0), u32le(10), u32le(0)),
      { recVer: 0x1 },
    );
    const menuNameAtom = atom(RT_CString, utf16le("Menu Name"), {
      recInstance: 0x000,
    });
    const progIdAtom = atom(RT_CString, utf16le("Word.Document.8"), {
      recInstance: 0x002,
    });
    const embedContainer = container(RT_ExternalOleEmbed, [
      objAtom,
      menuNameAtom,
      progIdAtom,
    ]);
    const documentChildren = childRecords(
      readRecordAt(
        container(RT_Document, [
          container(RT_ExternalObjectList, [embedContainer]),
        ]),
        0,
      ),
    );
    expect(readExternalOleEmbeds(documentChildren).get(1)?.progId).toBe(
      "Word.Document.8",
    );
  });
});

describe("readExObjIdRef", () => {
  it("reads the exObjId a shape's own OfficeArtClientData names", () => {
    const clientData = readRecordAt(writeOleClientData(3), 0);
    expect(readExObjIdRef(clientData)).toBe(3);
  });

  it("returns undefined for a client data record with no ExObjRefAtom at all", () => {
    const clientData = readRecordAt(container(OfficeArtClientData, []), 0);
    expect(readExObjIdRef(clientData)).toBeUndefined();
  });

  it("returns undefined for an ExObjRefAtom too short for its own exObjId field", () => {
    const clientData = readRecordAt(
      container(OfficeArtClientData, [
        atom(RT_ExternalObjectRefAtom, new Uint8Array(2)),
      ]),
      0,
    );
    expect(readExObjIdRef(clientData)).toBeUndefined();
  });
});

describe("resolveOleObjectStorage", () => {
  const CFB_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it("resolves an uncompressed storage's raw bytes", () => {
    const stg = writeExOleObjStg(CFB_BYTES);
    const directory = new Map([[10, 0]]);
    expect(resolveOleObjectStorage(stg, directory, 10)).toEqual(CFB_BYTES);
  });

  it("inflates a compressed storage behind its own decompressedSize prefix", () => {
    const compressed = deflate(CFB_BYTES);
    const stg = atom(
      RT_ExternalOleObjectStg,
      concatBytes(u32le(CFB_BYTES.length), compressed),
      { recInstance: 0x001 },
    );
    const directory = new Map([[10, 0]]);
    expect(resolveOleObjectStorage(stg, directory, 10)).toEqual(CFB_BYTES);
  });

  it("returns undefined for a persistIdRef the directory does not contain", () => {
    expect(
      resolveOleObjectStorage(new Uint8Array(0), new Map(), 99),
    ).toBeUndefined();
  });

  it("returns undefined for a record whose type is not RT_ExternalOleObjectStg", () => {
    const stream = atom(RT_Document, new Uint8Array(4));
    expect(
      resolveOleObjectStorage(stream, new Map([[10, 0]]), 10),
    ).toBeUndefined();
  });

  it("returns undefined for an offset that does not even resolve to a readable record", () => {
    expect(
      resolveOleObjectStorage(new Uint8Array(4), new Map([[10, 0]]), 10),
    ).toBeUndefined();
  });

  it("returns undefined for a compressed storage too short for its own decompressedSize field", () => {
    const stg = atom(RT_ExternalOleObjectStg, new Uint8Array(2), {
      recInstance: 0x001,
    });
    expect(
      resolveOleObjectStorage(stg, new Map([[10, 0]]), 10),
    ).toBeUndefined();
  });

  it("returns undefined for compressed data that fails to inflate", () => {
    const stg = atom(
      RT_ExternalOleObjectStg,
      concatBytes(u32le(100), new Uint8Array([0xff, 0xff, 0xff, 0xff])),
      { recInstance: 0x001 },
    );
    expect(
      resolveOleObjectStorage(stg, new Map([[10, 0]]), 10),
    ).toBeUndefined();
  });
});

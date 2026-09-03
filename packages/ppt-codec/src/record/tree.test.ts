import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { atom, concatBytes, container, u32le } from "../test-support/records";
import { RECORD_HEADER_SIZE } from "./header";
import {
  childRecords,
  findChild,
  findChildren,
  findDescendants,
  readRecordAt,
  readRecordSequence,
} from "./tree";
import {
  RT_Document,
  RT_DocumentAtom,
  RT_Slide,
  RT_TextHeaderAtom,
} from "./types";

describe("readRecordAt", () => {
  it("returns the header, the record's own offset, and a data slice of exactly recLen bytes", () => {
    const bytes = atom(RT_DocumentAtom, u32le(0x0000002a), { recVer: 0x1 });
    const record = readRecordAt(bytes, 0);
    expect(record.header.recType).toBe(RT_DocumentAtom);
    expect(record.offset).toBe(0);
    expect(record.dataOffset).toBe(RECORD_HEADER_SIZE);
    expect(record.data).toEqual(u32le(0x0000002a));
  });

  it("rejects a record whose declared recLen runs past the end of the buffer", () => {
    // An 8-byte header declaring 16 bytes of data, with only 4 actually present.
    const truncated = atom(RT_DocumentAtom, u32le(1)).subarray(0, 12);
    const bytes = new Uint8Array(truncated.length);
    bytes.set(truncated);
    new DataView(bytes.buffer).setUint32(4, 16, true);
    expect(() => readRecordAt(bytes, 0)).toThrow(PptFormatError);
  });
});

describe("readRecordSequence", () => {
  it("reads consecutive sibling records until the end of the range", () => {
    const bytes = concatBytes(
      atom(RT_DocumentAtom, u32le(1), { recVer: 0x1 }),
      atom(RT_TextHeaderAtom, u32le(2)),
    );
    expect(
      readRecordSequence(bytes, 0, bytes.length).map((r) => r.header.recType),
    ).toEqual([RT_DocumentAtom, RT_TextHeaderAtom]);
  });

  it("returns nothing for an empty range rather than throwing", () => {
    expect(readRecordSequence(new Uint8Array(0), 0, 0)).toEqual([]);
  });

  it("rejects a trailing fragment too short to hold a header", () => {
    const bytes = concatBytes(
      atom(RT_DocumentAtom, u32le(1)),
      new Uint8Array(3),
    );
    expect(() => readRecordSequence(bytes, 0, bytes.length)).toThrow(
      PptFormatError,
    );
  });

  it("rejects a child whose recLen overruns the range its parent gave it", () => {
    const bytes = atom(RT_DocumentAtom, u32le(1));
    // The record is 12 bytes; confining the sequence to 10 must fail rather than silently truncating the child.
    expect(() => readRecordSequence(bytes, 0, 10)).toThrow(PptFormatError);
  });
});

describe("childRecords", () => {
  it("reads a container's children from within its own data range", () => {
    const bytes = container(RT_Document, [
      atom(RT_DocumentAtom, u32le(1), { recVer: 0x1 }),
      atom(RT_TextHeaderAtom, u32le(2)),
    ]);
    const children = childRecords(readRecordAt(bytes, 0));
    expect(children.map((c) => c.header.recType)).toEqual([
      RT_DocumentAtom,
      RT_TextHeaderAtom,
    ]);
    // A child's offset is stated relative to the same buffer the parent was read from, so a later seek by offset stays meaningful.
    expect(children[0]?.offset).toBe(RECORD_HEADER_SIZE);
  });

  it("returns nothing for an atom, which has no children by definition", () => {
    expect(
      childRecords(readRecordAt(atom(RT_DocumentAtom, u32le(1)), 0)),
    ).toEqual([]);
  });
});

describe("findChild / findChildren", () => {
  const bytes = container(RT_Document, [
    atom(RT_DocumentAtom, u32le(1), { recVer: 0x1 }),
    atom(RT_TextHeaderAtom, u32le(2)),
    atom(RT_TextHeaderAtom, u32le(3)),
  ]);
  const children = childRecords(readRecordAt(bytes, 0));

  it("finds the first child of a type", () => {
    expect(findChild(children, RT_TextHeaderAtom)?.data).toEqual(u32le(2));
  });

  it("returns undefined when no child has that type, rather than a placeholder", () => {
    expect(findChild(children, RT_Slide)).toBeUndefined();
  });

  it("finds every child of a type, in order", () => {
    expect(
      findChildren(children, RT_TextHeaderAtom).map((r) => r.data),
    ).toEqual([u32le(2), u32le(3)]);
  });
});

describe("findDescendants", () => {
  it("finds records of a type at any depth, in document order", () => {
    const bytes = container(RT_Document, [
      atom(RT_TextHeaderAtom, u32le(1)),
      container(RT_Slide, [
        atom(RT_TextHeaderAtom, u32le(2)),
        container(RT_Slide, [atom(RT_TextHeaderAtom, u32le(3))]),
      ]),
    ]);
    expect(
      findDescendants(readRecordAt(bytes, 0), RT_TextHeaderAtom).map(
        (r) => r.data,
      ),
    ).toEqual([u32le(1), u32le(2), u32le(3)]);
  });

  it("does not descend into an atom's data, which is fields rather than records", () => {
    // An atom whose payload happens to look like a nested record must not be mined for one: recVer, not content, decides what is a container.
    const nested = atom(RT_TextHeaderAtom, u32le(9));
    const bytes = container(RT_Document, [atom(RT_DocumentAtom, nested)]);
    expect(findDescendants(readRecordAt(bytes, 0), RT_TextHeaderAtom)).toEqual(
      [],
    );
  });
});

import { describe, expect, it } from "vitest";
import type { FirebirdField, FirebirdRelation } from "./schema";
import { FirebirdBackupReader } from "./reader";
import { readRelationData } from "./data";

// The record-level walk (readRelationData and the row-group loop under it), driven over hand-built backup byte streams: the tag/attribute wire shapes, blob records spliced into the row they follow across several raw segments, the flat record kinds walked past, the generic attribute skipping, and every refusal message along the way. The payload-level decoder has its own suite in data.test.ts; this one covers the grammar above it.

const REC_DATA = 6;
const REC_BLOB = 7;
const REC_RELATION_END = 9;
const REC_GEN_ID = 18;
const REC_INDEX = 5;
const REC_TRIGGER = 13;
const ATT_RELATION_NAME = 1;
const ATT_DATA_LENGTH = 1;
const ATT_XDR_LENGTH = 17;
const ATT_DATA_DATA = 2;
const ATT_END = 0;

function concat(
  ...parts: readonly (number | Uint8Array)[]
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce(
    (sum: number, part) => sum + (typeof part === "number" ? 1 : part.length),
    0,
  );
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) {
    if (typeof part === "number") {
      out[offset] = part;
      offset += 1;
    } else {
      out.set(part, offset);
      offset += part.length;
    }
  }
  return out;
}

function int32Attr(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(5));
  out[0] = 4;
  out[1] = value & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = (value >>> 16) & 0xff;
  out[4] = (value >>> 24) & 0xff;
  return out;
}

function textAttr(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  return concat(encoded.length, encoded);
}

function segment(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  return concat(encoded.length & 0xff, (encoded.length >> 8) & 0xff, encoded);
}

function int64Field(name: string, fieldNumber: number): FirebirdField {
  return {
    name,
    physicalType: "int64",
    lengthBytes: 8,
    scale: 0,
    characterLength: undefined,
    subType: 0,
    fieldNumber,
    typeLabel: "BIGINT",
    computed: false,
  };
}

function blobField(
  name: string,
  fieldNumber: number,
  subType: number,
): FirebirdField {
  return {
    name,
    physicalType: "blob",
    lengthBytes: 8,
    scale: 0,
    characterLength: undefined,
    subType,
    fieldNumber,
    typeLabel: "BLOB",
    computed: false,
  };
}

function relationOf(fields: readonly FirebirdField[]): FirebirdRelation {
  return { name: "R", fields };
}

function int64BlobPayload(value: bigint): Uint8Array<ArrayBuffer> {
  // One 8-byte big-endian int64, then the blob field's own alignment quad (two int32s), then the null-flag pass: one XDR short per stored field, each wire-widened to a full 4-byte int32, all zero.
  const buffer = new ArrayBuffer(24);
  const view = new DataView(buffer);
  view.setBigInt64(0, value, false);
  return new Uint8Array(buffer);
}

function read(
  stream: Uint8Array<ArrayBuffer>,
  relation: FirebirdRelation,
): ReturnType<typeof readRelationData> {
  return readRelationData(
    new FirebirdBackupReader(stream),
    new Map([[relation.name, relation]]),
    false,
  );
}

const HEAD = concat(ATT_RELATION_NAME, textAttr("R"), ATT_END);

describe("readRelationData: rows, blobs, and flat records", () => {
  it("a row followed by its blob record splices the blob's segments in as one value", () => {
    const relation = relationOf([int64Field("ID", 1), blobField("NOTE", 2, 1)]);
    const payload = int64BlobPayload(42n);
    const stream = concat(
      HEAD,
      REC_DATA,
      ATT_DATA_LENGTH,
      int32Attr(payload.length),
      ATT_DATA_DATA,
      payload,
      REC_BLOB,
      3,
      int32Attr(2),
      5,
      int32Attr(2),
      7,
      segment("ab"),
      segment("cd"),
      REC_RELATION_END,
    );
    const { relationName, rows } = read(stream, relation);
    expect(relationName).toBe("R");
    expect(rows).toEqual([
      [
        { kind: "number", value: 42 },
        { kind: "string", value: "abcd" },
      ],
    ]);
  });

  it("a binary blob arrives as a base64 data URI, text as decoded text", () => {
    const relation = relationOf([int64Field("ID", 1), blobField("DATA", 2, 0)]);
    const payload = int64BlobPayload(7n);
    const stream = concat(
      HEAD,
      REC_DATA,
      ATT_DATA_LENGTH,
      int32Attr(payload.length),
      ATT_DATA_DATA,
      payload,
      REC_BLOB,
      3,
      int32Attr(2),
      5,
      int32Attr(1),
      7,
      segment("hi"),
      REC_RELATION_END,
    );
    const { rows } = read(stream, relation);
    expect(rows[0]?.[1]).toEqual({
      kind: "string",
      value: "data:application/octet-stream;base64,aGk=",
    });
  });

  it("att_xdr_length overrides att_data_length for the payload size", () => {
    const relation = relationOf([int64Field("ID", 1)]);
    const payload = int64BlobPayload(3n).slice(0, 12);
    const stream = concat(
      HEAD,
      REC_DATA,
      ATT_DATA_LENGTH,
      int32Attr(99),
      ATT_XDR_LENGTH,
      int32Attr(payload.length),
      ATT_DATA_DATA,
      payload,
      REC_RELATION_END,
    );
    expect(read(stream, relation).rows).toEqual([
      [{ kind: "number", value: 3 }],
    ]);
  });

  it("gen_id, index, and trigger records between rows are walked past", () => {
    const relation = relationOf([int64Field("ID", 1)]);
    const payload = int64BlobPayload(1n);
    const stream = concat(
      HEAD,
      REC_DATA,
      ATT_DATA_LENGTH,
      int32Attr(payload.length),
      ATT_DATA_DATA,
      payload,
      REC_GEN_ID,
      int32Attr(123),
      REC_INDEX,
      40,
      textAttr("PK"),
      ATT_END,
      REC_TRIGGER,
      ATT_END,
      REC_RELATION_END,
    );
    expect(read(stream, relation).rows).toEqual([
      [{ kind: "number", value: 1 }],
    ]);
  });

  it("an unknown attribute before the relation name is skipped, and computed fields never take a slot", () => {
    const relation = relationOf([
      int64Field("VIRTUAL", 3),
      int64Field("ID", 1),
    ]);
    const relationComputed = {
      ...relation,
      fields: [
        { ...int64Field("VIRTUAL", 3), computed: true },
        int64Field("ID", 1),
      ],
    };
    const payload = int64BlobPayload(5n).slice(0, 12);
    const stream = concat(
      40,
      textAttr("ignored"),
      ATT_RELATION_NAME,
      textAttr("R"),
      ATT_END,
      REC_DATA,
      ATT_DATA_LENGTH,
      int32Attr(payload.length),
      ATT_DATA_DATA,
      payload,
      REC_RELATION_END,
    );
    expect(read(stream, relationComputed).rows).toEqual([
      [{ kind: "number", value: 5 }],
    ]);
  });
});

describe("readRelationData: refusals", () => {
  it("a record with no att_relation_name refuses", () => {
    const stream = concat(40, textAttr("x"), ATT_END, REC_RELATION_END);
    expect(() => read(stream, relationOf([int64Field("ID", 1)]))).toThrow(
      "a rec_relation_data record had no att_relation_name attribute",
    );
  });

  it("a relation no earlier rec_relation declared refuses", () => {
    const stream = concat(
      ATT_RELATION_NAME,
      textAttr("OTHER"),
      ATT_END,
      REC_RELATION_END,
    );
    expect(() => read(stream, relationOf([int64Field("ID", 1)]))).toThrow(
      'references relation "OTHER", which no earlier rec_relation declared',
    );
  });

  it("a row group not starting at att_data_length refuses, naming the tags", () => {
    const stream = concat(HEAD, REC_DATA, 40, REC_RELATION_END);
    expect(() => read(stream, relationOf([int64Field("ID", 1)]))).toThrow(
      "expected att_data_length (tag 1), found tag 40",
    );
  });

  it("a third tag that is neither xdr length nor data refuses", () => {
    const stream = concat(HEAD, REC_DATA, ATT_DATA_LENGTH, int32Attr(4), 40);
    expect(() => read(stream, relationOf([int64Field("ID", 1)]))).toThrow(
      "expected att_xdr_length or att_data_data, found tag 40",
    );
  });

  it("a missing att_data_data after an xdr length refuses", () => {
    const stream = concat(
      HEAD,
      REC_DATA,
      ATT_DATA_LENGTH,
      int32Attr(4),
      ATT_XDR_LENGTH,
      int32Attr(4),
      40,
    );
    expect(() => read(stream, relationOf([int64Field("ID", 1)]))).toThrow(
      "expected att_data_data (tag 2), found tag 40",
    );
  });

  it("a blob naming a field this relation does not have refuses", () => {
    const relation = relationOf([int64Field("ID", 1)]);
    const payload = int64BlobPayload(1n);
    const stream = concat(
      HEAD,
      REC_DATA,
      ATT_DATA_LENGTH,
      int32Attr(payload.length),
      ATT_DATA_DATA,
      payload,
      REC_BLOB,
      3,
      int32Attr(9),
      5,
      int32Attr(0),
      7,
      REC_RELATION_END,
    );
    expect(() => read(stream, relation)).toThrow(
      "matches no field's own att_field_number in this relation",
    );
  });

  it("an unknown record kind names itself and the context", () => {
    const stream = concat(HEAD, 99);
    expect(() => read(stream, relationOf([int64Field("ID", 1)]))).toThrow(
      'encountered record type 99 while reading relation data for "R"',
    );
  });
});

import { readOlePackage } from "archive-codec";
import type {
  ContentDocument,
  ContentEmbeddedObject,
} from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  readEmbeddedObjectPackage,
  writeEmbeddedObjectPackage,
} from "./embedded-object";

const FRAME = { xPt: 0, yPt: 0, widthPt: 50, heightPt: 40 };

const DRAWING_DOCUMENT: ContentDocument = {
  kind: "drawing",
  metadata: {},
  pages: [{ size: { widthPt: 50, heightPt: 40 }, shapes: [], vectors: [] }],
};

function embeddedObject(
  overrides: Partial<ContentEmbeddedObject> = {},
): ContentEmbeddedObject {
  return {
    objectKind: "drawing",
    document: DRAWING_DOCUMENT,
    frame: FRAME,
    ...overrides,
  };
}

describe("writeEmbeddedObjectPackage / readEmbeddedObjectPackage", () => {
  it("round-trips an embedded object's kind and document through the Package stream", () => {
    const embedded = embeddedObject();
    const packageBytes = writeEmbeddedObjectPackage(embedded);

    const result = readEmbeddedObjectPackage(packageBytes, FRAME);

    expect(result?.objectKind).toBe("drawing");
    expect(result?.document).toStrictEqual(DRAWING_DOCUMENT);
    expect(result?.frame).toStrictEqual(FRAME);
  });

  it("merges the caller's own frame in, overriding whatever the payload itself carried", () => {
    const embedded = embeddedObject();
    const packageBytes = writeEmbeddedObjectPackage(embedded);
    const otherFrame = { xPt: 9, yPt: 9, widthPt: 1, heightPt: 1 };

    const result = readEmbeddedObjectPackage(packageBytes, otherFrame);

    expect(result?.frame).toStrictEqual(otherFrame);
  });

  it("does not round-trip the placement fields -- they come only from the caller's frame argument", () => {
    const embedded = embeddedObject({
      anchorRow: 3,
      anchorColumn: 2,
      offsetXPt: 4,
      offsetYPt: 5,
    });
    const packageBytes = writeEmbeddedObjectPackage(embedded);

    const result = readEmbeddedObjectPackage(packageBytes, FRAME);

    expect(result?.anchorRow).toBeUndefined();
    expect(result?.anchorColumn).toBeUndefined();
    expect(result?.offsetXPt).toBeUndefined();
    expect(result?.offsetYPt).toBeUndefined();
  });

  it("round-trips the source residue field", () => {
    const embedded = embeddedObject({
      source: { format: "xlsx", xml: "<a/>" },
    });
    const packageBytes = writeEmbeddedObjectPackage(embedded);

    const result = readEmbeddedObjectPackage(packageBytes, FRAME);

    expect(result?.source).toStrictEqual({ format: "xlsx", xml: "<a/>" });
  });

  it("returns undefined for a Package stream carrying a foreign label", () => {
    const foreign = writeForeignPackage("not-this-package.json", "{}");

    expect(readEmbeddedObjectPackage(foreign, FRAME)).toBeUndefined();
  });

  it("returns undefined for a foreign label even when its payload is otherwise a fully valid embedding", () => {
    // "{}" (the case above) also fails the objectKind/document presence check on its own, so it cannot prove the label check itself did anything -- a reader that skipped the label entirely would reach the same undefined result via that other guard. A payload valid enough to parse and pass schema validation isolates the label check.
    const foreign = writeForeignPackage(
      "not-this-package.json",
      JSON.stringify({ objectKind: "drawing", document: DRAWING_DOCUMENT }),
    );

    expect(readEmbeddedObjectPackage(foreign, FRAME)).toBeUndefined();
  });

  it("writes an empty sourcePath and tempPath, never a placeholder", () => {
    const packageBytes = writeEmbeddedObjectPackage(embeddedObject());
    const olePackage = readOlePackage(packageBytes);

    expect(olePackage.sourcePath).toBe("");
    expect(olePackage.tempPath).toBe("");
  });

  it("returns undefined for a payload that is not a JSON object", () => {
    const foreign = writeForeignPackage(
      "xls-codec-embedded-object.json",
      "[1,2,3]",
    );

    expect(readEmbeddedObjectPackage(foreign, FRAME)).toBeUndefined();
  });

  it("returns undefined for a JSON object missing objectKind", () => {
    const foreign = writeForeignPackage(
      "xls-codec-embedded-object.json",
      JSON.stringify({ document: DRAWING_DOCUMENT }),
    );

    expect(readEmbeddedObjectPackage(foreign, FRAME)).toBeUndefined();
  });

  it("returns undefined for a JSON object missing document", () => {
    const foreign = writeForeignPackage(
      "xls-codec-embedded-object.json",
      JSON.stringify({ objectKind: "drawing" }),
    );

    expect(readEmbeddedObjectPackage(foreign, FRAME)).toBeUndefined();
  });

  it("returns undefined for a payload whose fields fail schema validation", () => {
    const foreign = writeForeignPackage(
      "xls-codec-embedded-object.json",
      JSON.stringify({
        objectKind: "not-a-real-kind",
        document: DRAWING_DOCUMENT,
      }),
    );

    expect(readEmbeddedObjectPackage(foreign, FRAME)).toBeUndefined();
  });

  it("returns undefined for bytes that are not a Package stream at all", () => {
    expect(
      readEmbeddedObjectPackage(new Uint8Array([1, 2, 3]), FRAME),
    ).toBeUndefined();
  });
});

/** Builds a Package stream carrying an arbitrary label and JSON text, using the identical [MS-OLEDS] layout writeEmbeddedObjectPackage itself produces (a uint16 header, three null-terminated strings, then a little-endian byte count and the file bytes) -- so a test can construct a Package stream this module did not itself write. */
function writeForeignPackage(
  label: string,
  json: string,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const labelBytes = encoder.encode(label);
  const sourcePathBytes = encoder.encode("");
  const tempPathBytes = encoder.encode("");
  const fileBytes = encoder.encode(json);
  const parts = [
    new Uint8Array([0x02, 0x00]),
    labelBytes,
    new Uint8Array([0]),
    sourcePathBytes,
    new Uint8Array([0]),
    new Uint8Array(8),
    tempPathBytes,
    new Uint8Array([0]),
    (() => {
      const size = new Uint8Array(4);
      new DataView(size.buffer).setUint32(0, fileBytes.length, true);
      return size;
    })(),
    fileBytes,
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

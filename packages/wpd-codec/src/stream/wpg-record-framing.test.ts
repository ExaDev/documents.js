import { describe, expect, it } from "vitest";
import { decodeWpgGraphic } from "./wpg";
import {
  dword,
  NO_TEXT,
  record,
  startWpgData,
  word,
  wpg,
} from "../test-support/wpg";

describe("readCountField's 1/3/5-byte spellings", () => {
  it("reads a record whose own Length field uses the 3-byte count spelling", () => {
    const filler = new Array<number>(300).fill(0);
    const oversizedRecord = [0x0f, 0x99, 0, 0xff, ...word(300), ...filler];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      oversizedRecord,
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
    expect(decoded.sizePt).toEqual({ widthPt: 288, heightPt: 144 });
  });

  it("reads a record whose own Length field uses the 5-byte count spelling", () => {
    const filler = new Array<number>(40).fill(0);
    // shortValue = 0x8000 (top bit set, low 15 bits zero) then lowHalf = 40 -> value = ((0x8000 & 0x7fff) << 16) + 40 = 40.
    const oversizedRecord = [
      0x0f,
      0x99,
      0,
      0xff,
      ...word(0x8000),
      ...word(40),
      ...filler,
    ];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      oversizedRecord,
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("reads a zero-length record at the exact 3-byte spelling boundary rather than treating it as truncated", () => {
    // The 3-byte marker plus a zero value: cursor + 3 lands exactly on the buffer's own end, with no data bytes following.
    const raw = [0x0f, 0x99, 0, 0xff, ...word(0)];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("reads a zero-length record at the exact 5-byte spelling boundary rather than treating it as truncated", () => {
    const raw = [0x0f, 0x99, 0, 0xff, ...word(0x8000), ...word(0)];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("reads a Length field of exactly 0xFE as the plain single-byte spelling, not the extended one", () => {
    // 0xFE is the top of the single-byte range ("a byte 0-0xFE is the value"); only 0xFF introduces the extended spelling.
    const filler = new Array<number>(0xfe).fill(0);
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x99, filler),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("stops the walk rather than reading past the buffer when a Length field's 3-byte marker has no room for its own short value", () => {
    // 0xff with nothing after it: cursor + 3 runs past the buffer's own end.
    const raw = [0x0f, 0x99, 0, 0xff];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual([]);
    expect(decoded.vectors).toEqual([]);
  });

  it("stops the walk rather than reading past the buffer when a Length field's 5-byte marker has no room for its low half", () => {
    const raw = [0x0f, 0x99, 0, 0xff, ...word(0x8000)];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual([]);
    expect(decoded.vectors).toEqual([]);
  });
});

describe("readCharacterization's edit-lock and Object ID walks", () => {
  it("steps past a 4-byte edit-lock descriptor to reach the geometry", () => {
    const flags = 0x0080; // FLAG_EDIT_LOCK only
    const data = [
      ...word(flags),
      0xaa,
      0xbb,
      0xcc,
      0xdd, // the edit-lock descriptor, never read as coordinates
      ...word(0), // xll
      ...word(0), // yll
      ...word(10), // xur
      ...word(10), // yur
      ...word(0), // rx
      ...word(0), // ry
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.frame).toEqual({ xPt: 0, yPt: 134, widthPt: 10, heightPt: 10 });
  });

  it("steps past a short-spelling Object ID (high bit clear) to reach the geometry", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID only
    const data = [
      ...word(flags),
      ...word(0x1234), // Object ID, short spelling
      ...word(0), // xll
      ...word(0), // yll
      ...word(10), // xur
      ...word(10), // yur
      ...word(0), // rx
      ...word(0), // ry
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.frame).toEqual({ xPt: 0, yPt: 134, widthPt: 10, heightPt: 10 });
  });

  it("reads the characterization flags from a record whose data is exactly the 2-byte flags word, with nothing to spare", () => {
    const flags = 0; // no special bits
    const data = [...word(flags)]; // exactly 2 bytes: cursor + 2 lands exactly on the record's own end
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    // Characterization itself succeeds exactly at this boundary; the geometry read that follows it has nothing left to read and refuses on its own account.
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("refuses a record whose Object ID field itself has no room before the record ends", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID
    const data = [...word(flags), 0xaa]; // only one byte where the 2-byte id needs to fit
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("refuses a record whose long-spelling Object ID (high bit set) pushes the geometry past the record's own end", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID
    // The id field itself has exactly the 2 bytes readCharacterization checked for, but its high bit forces the long, 4-byte spelling, which runs 2 bytes past the record.
    const data = [...word(flags), ...word(0x8000)];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  // Unlike Object ID's own overflow (guarded by its own room check before the +2/+4 step is ever taken), the edit-lock descriptor's blind +4 step has no such guard of its own, readCharacterization's own final `geometryAt > recordEnd` check is the ONLY thing standing between a too-short record and treating the very next record's own bytes as this one's geometry.
  it("refuses a Rectangle whose edit-lock descriptor alone pushes geometryAt past the record, rather than reading the next record's own bytes as geometry", () => {
    const flags = 0x0080; // FLAG_EDIT_LOCK only
    const data = [...word(flags)]; // no room at all for the 4-byte edit-lock descriptor, let alone any geometry
    // Exactly the bytes geometryAt would land on and misread as xll/yll/xur/yur/rx/ry if the overrun were allowed through.
    const siblingBytes = [
      ...word(100),
      ...word(200),
      ...word(300),
      ...word(400),
      ...word(0),
      ...word(0),
    ];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, data),
      record(0x99, siblingBytes),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle", "record type 0x99"]);
  });
});

describe("readSingleColor and readDoubleColor arithmetic", () => {
  it("divides every single-precision colour channel by 255, not multiplies", () => {
    // Every channel a distinct, non-zero, non-255 value so a /255 vs *255 flip anywhere shows up.
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [51, 102, 153, 204]), // Pen Fore Color: r=51,g=102,b=153,a=204
      record(0x2b, [...word(1), ...word(1)]),
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.stroke?.color.r).toBeCloseTo(51 / 255);
    expect(rect.stroke?.color.g).toBeCloseTo(102 / 255);
    expect(rect.stroke?.color.b).toBeCloseTo(153 / 255);
    expect(rect.stroke?.opacity).toBeCloseTo(1 - 204 / 255);
  });

  it("divides every double-precision colour channel by 65535, not multiplies", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x26, [
        ...word(4096),
        ...word(8192),
        ...word(16384),
        ...word(32768),
      ]), // DP Pen Fore Color
      record(0x2b, [...word(1), ...word(1)]),
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.stroke?.color.r).toBeCloseTo(4096 / 65535);
    expect(rect.stroke?.color.g).toBeCloseTo(8192 / 65535);
    expect(rect.stroke?.color.b).toBeCloseTo(16384 / 65535);
    expect(rect.stroke?.opacity).toBeCloseTo(1 - 32768 / 65535);
  });

  it("leaves the pen colour unchanged when a DP Pen Fore Color record is one byte short of its own 8 bytes", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [10, 20, 30, 0]), // Pen Fore Color: a real colour first
      record(0x2b, [...word(1), ...word(1)]),
      record(0x26, [...word(1), ...word(1), ...word(1), 0]), // DP Pen Fore Color, 7 bytes: one short
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.stroke?.color).toEqual({
      r: 10 / 255,
      g: 20 / 255,
      b: 30 / 255,
    });
  });
});

describe("the WPG signature scan", () => {
  it("advances past leading garbage bytes one at a time to find the real signature", () => {
    // The record-start bounds check (recordStart < start + WPG_PREFIX_HEAD_SIZE) is measured from wherever the signature is actually found, so a signature embedded 3 bytes in needs its own {start of document} field large enough to clear that offset too, 3 padding bytes between the prefix and the real records supply exactly that room.
    const garbageLength = 3;
    const recordsStart = garbageLength + 26 + garbageLength;
    const records = [record(0x01, startWpgData({})), record(0x02, [])].flat();
    const head = [
      0xff,
      0x57,
      0x50,
      0x43,
      ...dword(recordsStart - garbageLength), // {start of document}, relative to the signature itself
      1,
      0x16,
      2, // major version 2
      0,
      ...word(0),
      ...word(26),
      0,
      0,
      ...word(0),
      ...dword(recordsStart + records.length),
      ...word(0),
    ];
    const withGarbage = new Uint8Array([
      ...new Array<number>(garbageLength).fill(9),
      ...head,
      ...new Array<number>(garbageLength).fill(0), // padding so recordStart clears start + WPG_PREFIX_HEAD_SIZE
      ...records,
    ]);
    const decoded = decodeWpgGraphic(withGarbage, NO_TEXT);
    expect(decoded?.status).toBe("decoded");
  });

  it.each([
    [0, 0x00], // byte 0 of the file ID wrong
    [1, 0x00], // byte 1
    [2, 0x00], // byte 2
    [3, 0x00], // byte 3
  ])(
    "does not match a signature with file-ID byte %i corrupted",
    (offset, value) => {
      const graphic = wpg([record(0x01, startWpgData({})), record(0x02, [])]);
      graphic[offset] = value;
      expect(decodeWpgGraphic(graphic, NO_TEXT)).toBeUndefined();
    },
  );

  it("does not match a signature with the right file ID but the wrong product type", () => {
    const graphic = wpg([record(0x01, startWpgData({})), record(0x02, [])]);
    graphic[8] = 2; // product type: not 1
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toBeUndefined();
  });

  it("does not match a signature with the right file ID but the wrong file type", () => {
    const graphic = wpg([record(0x01, startWpgData({})), record(0x02, [])]);
    graphic[9] = 0x0a; // file type: not 0x16
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toBeUndefined();
  });
});

describe("major version and record-start validation", () => {
  it("refuses a major version that is neither 1 nor 2", () => {
    const graphic = wpg([record(0x01, startWpgData({}))], 3);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a record start pointing back inside the prefix itself", () => {
    const graphic = wpg([record(0x01, startWpgData({}))]);
    // {start of document} sits at prefix offset 4; point it at byte 4, well inside the 26-byte prefix.
    graphic[4] = 4;
    graphic[5] = 0;
    graphic[6] = 0;
    graphic[7] = 0;
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a record start at or past the buffer's own end", () => {
    const graphic = wpg([record(0x01, startWpgData({}))]);
    const bytesLength = graphic.length;
    graphic[4] = bytesLength & 0xff;
    graphic[5] = (bytesLength >>> 8) & 0xff;
    graphic[6] = (bytesLength >>> 16) & 0xff;
    graphic[7] = (bytesLength >>> 24) & 0xff;
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });
});

describe("the record-walk loop's own boundaries", () => {
  it("discards a single stray trailing byte, one short of a full record header, rather than reading past the buffer", () => {
    const base = wpg([record(0x01, startWpgData({}))]);
    const withStray = new Uint8Array([...base, 0xaa]);
    const decoded = decodeWpgGraphic(withStray, NO_TEXT);
    expect(decoded?.status).toBe("decoded");
  });

  it("stops the walk, keeping the geometry already decoded, when a record declares a Length running past the buffer", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    // The Rectangle record's own Length byte sits right after Class/Type/Extension (indices 0,1,2 of that record); patch it to claim far more data than the buffer actually holds. The record starts right after the Start WPG record: 26 (prefix) + 4 (Start WPG header) + 21 (Start WPG data) = 51.
    const rectangleRecordStart = 26 + 4 + 21;
    graphic[rectangleRecordStart + 3] = 200; // Length byte: claims 200 bytes of data
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    // The lying Rectangle itself never decodes, the walk stopped before reaching it.
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual([]);
    expect(decoded.sizePt).toEqual({ widthPt: 288, heightPt: 144 });
  });

  it("skips (rather than misreading) an undersized Start WPG record, without producing a spurious refusal from its truncated fields", () => {
    // ppi and precision look valid, but the record is 10 bytes, under the 13 the fixed fields need, so decoding it further would misread the (absent) extent, not just the (present) ppi/precision.
    const undersized = [...word(72), ...word(72), 0, 0, 0, 0];
    const graphic = wpg([
      record(0x01, undersized),
      record(0x01, startWpgData({})),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Start WPG"]);
    expect(decoded.sizePt).toEqual({ widthPt: 288, heightPt: 144 });
  });

  // Exactly 13 bytes: room for ppi/ppi/precision/viewport (the fixed fields this check exists to protect), but genuinely nothing left for the extent that follows, proving the skip-vs-refuse boundary sits at < 13, not <= 13. A record this size is NOT skipped (data.length < 13 is false): it proceeds to read ppi/precision, then refuses the WHOLE graphic outright once the separate, later extent-room check finds nothing left, a categorically different outcome (refused vs skipped-and-continue) than an off-by-one here would produce.
  it("proceeds past a Start WPG record of exactly 13 bytes rather than skipping it, then refuses for its missing extent", () => {
    // A genuinely valid Start WPG follows the 13-byte one: the correct code returns refused immediately from inside the first record's own extent check (a whole-function return, not merely a skip), so the second, valid one is never reached at all, proving that directly needs a record after the boundary one that would, wrongly, produce a real decoded result if the first were skipped instead of refused.
    const exactlyThirteen = [
      ...word(72),
      ...word(72),
      0,
      ...new Array<number>(8).fill(0),
    ];
    const graphic = wpg([
      record(0x01, exactlyThirteen),
      record(0x01, startWpgData({})),
      record(0x02, []),
    ]);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });
});

describe("readCharacterization's callers converge on refusal past their own boundary", () => {
  // readCharacterization's only two callers (readTextBlockFrame, readPrimitiveVector) always need a positive number of further bytes after a successful characterization, so whenever geometryAt runs past recordEnd, the caller's own downstream boundary check refuses identically, there is no primitive this decoder reads that needs zero further bytes.
  it("still refuses a Rectangle whose Object ID pushes geometryAt past the record, via the primitive's own downstream check", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID
    const data = [...word(flags), ...word(0x8000)];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("resolves the long-spelling Object ID's own +4 step, not the short spelling's +2, even though both fit the record's own initial bounds", () => {
    // With the long (+4) step, the coordinates correctly start 2 bytes later than the short (+2) step would put them, reading the wrong offset would misread the id's own trailing bytes as the first coordinate instead.
    const flags = 0x8020; // FLAG_OBJECT_ID | FLAG_FRAME
    const data = [
      ...word(flags),
      ...word(0x8000), // Object ID, long spelling (high bit set)
      ...word(0x1234), // the long spelling's own extra 2 bytes, must be skipped, not read as a coordinate
      ...word(0), // xll
      ...word(0), // yll
      ...word(10), // xur
      ...word(10), // yur
      ...word(0), // rx
      ...word(0), // ry
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.frame).toEqual({ xPt: 0, yPt: 134, widthPt: 10, heightPt: 10 });
  });
});

describe("readTextBlockFrame's own boundary", () => {
  it("refuses a Text Block one byte short of its own four coordinates", () => {
    const data = [
      ...word(0), // flags
      ...word(0),
      ...word(0),
      ...word(30),
      // yur's own second byte is missing
    ];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x1d, data, 1),
      record(0x0f, [0x41, 0xcc]),
    ]);
    const decoded = decodeWpgGraphic(graphic, {
      foldTextData: () => [{ kind: "paragraph", runs: [{ text: "A" }] }],
    });
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.shapes).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Text Block"]);
  });
});

describe("a swallowed group's second-of-two members stays swallowed", () => {
  it("swallows both members of a two-member Compound Polygon, not just the first", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x1a, [...word(0x2000)], 2), // Compound Polygon, swallowed, declares 2 members
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(20),
        ...word(20),
        ...word(30),
        ...word(30),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Compound Polygon"]);
  });
});

describe("a Text Block whose own frame failed to resolve swallows its declared members too", () => {
  it("swallows a Polyline declared as a failed Text Block's own member, not walking it as real content", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      // A Text Block with no data at all: readTextBlockFrame fails (readCharacterization can't even read its own flags word), leaving pendingTextBlockFrame undefined, but it still declares one member.
      record(0x1d, [], 1),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Text Block"]);
  });
});

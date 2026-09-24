import { describe, expect, it } from "vitest";
import {
  brokenStartxrefPdf,
  incrementalUpdatePdf,
  minimalClassicXrefPdf,
  xrefStreamWithObjectStreamPdf,
} from "./test-support/pdf";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import { dictGet } from "./objects";
import { readXref } from "./xref";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

// Replaces the digit run after the last "startxref\n" with a bogus offset, entirely at the byte level — the fixture's compressed streams are binary and a UTF-8 text round-trip (decode/replace/re-encode) would silently mangle every byte >=0x80 in them.
function corruptTrailingStartxrefOffset(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const marker = new TextEncoder().encode("startxref\n");
  let markerStart = -1;
  outer: for (let i = bytes.length - marker.length; i >= 0; i--) {
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) {
        continue outer;
      }
    }
    markerStart = i;
    break;
  }
  if (markerStart === -1) {
    throw new Error('fixture has no "startxref" marker');
  }
  const digitsStart = markerStart + marker.length;
  let digitsEnd = digitsStart;
  while (
    digitsEnd < bytes.length &&
    (bytes[digitsEnd] ?? 0) >= 0x30 &&
    (bytes[digitsEnd] ?? 0) <= 0x39
  ) {
    digitsEnd++;
  }
  const replacement = new TextEncoder().encode("999999");
  const out = new Uint8Array(
    digitsStart + replacement.length + (bytes.length - digitsEnd),
  );
  out.set(bytes.subarray(0, digitsStart), 0);
  out.set(replacement, digitsStart);
  out.set(bytes.subarray(digitsEnd), digitsStart + replacement.length);
  return out;
}

describe("readXref: classic table", () => {
  it("reads every object offset from a minimal classic xref table", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(minimalClassicXrefPdf(), sink);
    for (let num = 1; num <= 5; num++) {
      const entry = table.entries.get(num);
      expect(entry?.type).toBe("offset");
    }
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 1,
      gen: 0,
    });
    expect(diagnostics).toEqual([]);
  });
});

describe("readXref: xref stream + object stream", () => {
  it("resolves compressed entries for objects packed in an ObjStm and direct entries for the rest", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(xrefStreamWithObjectStreamPdf(), sink);
    for (const num of [1, 2, 3]) {
      const entry = table.entries.get(num);
      expect(entry).toEqual({
        type: "compressed",
        streamObjNum: 4,
        indexInStream: num - 1,
      });
    }
    expect(table.entries.get(5)?.type).toBe("offset"); // the content stream, a direct top-level object
    expect(table.entries.get(6)?.type).toBe("offset"); // the xref stream itself
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 1,
      gen: 0,
    });
    expect(diagnostics).toEqual([]);
  });
});

describe("readXref: incremental update", () => {
  it("takes the newest revision for an overridden object and keeps untouched objects from the original section", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(incrementalUpdatePdf(), sink);
    for (const num of [1, 2, 3, 4, 5]) {
      expect(table.entries.get(num)?.type).toBe("offset");
    }
    expect(diagnostics).toEqual([]);
  });

  it("chains through /Prev to the first section's trailer for keys the second section does not redefine", () => {
    const { sink } = collectDiagnostics();
    const table = readXref(incrementalUpdatePdf(), sink);
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 1,
      gen: 0,
    });
  });
});

describe("readXref: recovery", () => {
  it("recovers every object via a linear scan when startxref points nowhere useful, with a diagnostic", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(brokenStartxrefPdf(), sink);
    for (let num = 1; num <= 5; num++) {
      expect(table.entries.get(num)?.type).toBe("offset");
    }
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 1,
      gen: 0,
    });
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });

  it("recovers compressed entries from a scanned /Type /ObjStm when the whole table needed rebuilding", () => {
    const { sink, diagnostics } = collectDiagnostics();
    // Force recovery on an otherwise-valid xref-stream file by corrupting startxref's target — purely at the byte level, since the file's compressed streams are binary and would be mangled by any UTF-8 text round-trip.
    const corrupted = corruptTrailingStartxrefOffset(
      xrefStreamWithObjectStreamPdf(),
    );
    const table = readXref(corrupted, sink);
    for (const num of [1, 2, 3]) {
      expect(table.entries.get(num)).toEqual({
        type: "compressed",
        streamObjNum: 4,
        indexInStream: num - 1,
      });
    }
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 1,
      gen: 0,
    });
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });
});

// --- Direct drives of the resolution machinery's own branches, through hand-built bytes rather than only the four whole-file fixtures above. Every variant below pins a behaviour the happy-path fixtures never reach: a classic section's malformed shapes, an xref stream's /W, /Index and row-type handling, the /Prev chain's own guards, the fitness check on /Root's recorded offset, and the linear-scan recovery's boundary rules. ---

import { FixtureBuilder } from "./test-support/pdf";

function pad10(offset: number): string {
  return offset.toString().padStart(10, "0");
}

// A two-object document (1 = Catalog, 2 = Pages) whose classic xref section is written verbatim from `subsection`, with the trailer's extra entries given by `trailerExtra` and the keyword ahead of the trailer dict given by `trailerKeyword`.
function classicXrefVariant(
  buildSubsection: (offsets: {
    readonly objectOne: number;
    readonly objectTwo: number;
  }) => string,
  trailerExtra: string,
  trailerKeyword = "trailer",
): { bytes: Uint8Array<ArrayBuffer>; objectOne: number; objectTwo: number } {
  const b = new FixtureBuilder().header("1.4");
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
  const objectOne = b.offsetOf(1);
  const objectTwo = b.offsetOf(2);
  const xrefOffset = b.length;
  const subsection = buildSubsection({ objectOne, objectTwo });
  b.raw(
    `xref\n${subsection}\n${trailerKeyword}\n<< /Size 3 ${trailerExtra} >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );
  return { bytes: b.bytes(), objectOne, objectTwo };
}

// A filterless cross-reference stream PDF: object 1 = Catalog, object 2 = the xref stream itself, one packed row per entry of `rows` in order.
function xrefStreamVariant(options: {
  rows: (objectOne: number) => readonly {
    readonly type: number;
    readonly field2: number;
    readonly field3: number;
  }[];
  widths: readonly number[] | undefined; // undefined omits /W entirely
  size: number;
  index?: readonly number[]; // undefined omits /Index entirely
}): { bytes: Uint8Array<ArrayBuffer>; objectOne: number } {
  const b = new FixtureBuilder().header("1.5");
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const objectOne = b.offsetOf(1);
  const width = (value: number, w: number): number[] =>
    Array.from({ length: w }, (_, i) => (value >>> (8 * (w - 1 - i))) & 0xff);
  // /W names one width per field and every row repeats the field layout, so a zero-width field simply contributes no bytes.
  const packed: number[] = [];
  for (const row of options.rows(objectOne)) {
    for (const [field, w] of [
      [row.type, options.widths?.[0] ?? 1],
      [row.field2, options.widths?.[1] ?? 1],
      [row.field3, options.widths?.[2] ?? 1],
    ] as const) {
      packed.push(...width(field, w));
    }
  }
  const xrefOffset = b.length;
  b.stream(
    2,
    `<< /Type /XRef /Size ${options.size} ` +
      (options.widths === undefined
        ? ""
        : `/W [${options.widths.join(" ")}] `) +
      (options.index === undefined
        ? ""
        : `/Index [${options.index.join(" ")}] `) +
      `/Root 1 0 R >>`,
    new Uint8Array(packed),
  );
  b.raw(`startxref\n${xrefOffset}\n%%EOF`);
  return { bytes: b.bytes(), objectOne };
}

describe("readXref: classic section malformed shapes", () => {
  it("warns on a subsection header whose count is not a number, and on the trailer that mismatch leaves unread", () => {
    const { bytes } = classicXrefVariant(
      (offsets) =>
        `0 3\n0000000000 65535 f \n${pad10(offsets.objectOne)} 00000 n \n${pad10(offsets.objectTwo)} 00000 n \n4 x`,
      "/Root 1 0 R",
    );
    const { sink, diagnostics } = collectDiagnostics();
    readXref(bytes, sink);
    // The unreadable count resets the reader to the subsection start, so the "4" is read again as the would-be trailer keyword and fails that check too; neither object is lost, because recovery then rebuilds them by scan.
    expect(diagnostics.map((d) => d.message)).toEqual([
      'classic xref subsection header was not "start count"',
      'classic xref section was not followed by a "trailer" keyword',
      expect.stringMatching(/rebuilt the table by scanning/),
    ]);
    expect(diagnostics[0]?.code).toBe("pdf/xref-entry-invalid");
    expect(diagnostics[1]?.code).toBe("pdf/xref-entry-invalid");
    for (const num of [1, 2]) {
      expect(readXref(bytes, sink).entries.get(num)?.type).toBe("offset");
    }
  });

  it("warns on a malformed classic entry, naming the object it belongs to, and keeps the entries before it", () => {
    const { bytes, objectOne } = classicXrefVariant(
      (offsets) =>
        `0 4\n0000000000 65535 f \n${pad10(offsets.objectOne)} 00000 n \nzzz 00000 n \n`,
      "/Root 1 0 R",
    );
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("pdf/xref-entry-invalid");
    expect(diagnostics[0]?.message).toMatch(
      /malformed classic xref entry for object 2/,
    );
    expect(table.entries.get(1)).toMatchObject({
      type: "offset",
      offset: objectOne,
    });
    // The subsection break leaves the subsection's remaining object numbers unread: with the entry for 2 malformed, 3 never gets one either.
    expect(table.entries.get(2)).toBeUndefined();
    expect(table.entries.get(3)).toBeUndefined();
  });

  it("records neither a free entry nor an entry with an unrecognised type keyword", () => {
    const { bytes } = classicXrefVariant(
      (offsets) =>
        `0 4\n0000000000 65535 f \n${pad10(offsets.objectOne)} 00000 n \n${pad10(offsets.objectTwo)} 00000 f \n${pad10(offsets.objectTwo)} 00000 x \n`,
      "/Root 1 0 R",
    );
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toMatchObject({ type: "offset" });
    expect(table.entries.get(2)).toBeUndefined();
    expect(table.entries.get(3)).toBeUndefined();
  });
});

describe("readXref: cross-reference stream variants", () => {
  it("applies a default /W of one byte per field when /W is absent", () => {
    const { bytes, objectOne } = xrefStreamVariant({
      rows: (objectOne) => [
        { type: 0, field2: 0, field3: 0 },
        { type: 1, field2: objectOne, field3: 0 },
      ],
      widths: undefined,
      size: 2,
    });
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toEqual({
      type: "offset",
      offset: objectOne,
      gen: 0,
    });
  });

  it("reads a type-1 row through a /W whose first field is zero width", () => {
    // /W [0 2 1]: no type byte at all, which the spec's own rule reads as type 1 (an ordinary offset entry).
    const { bytes, objectOne } = xrefStreamVariant({
      rows: (objectOne) => [
        { type: 0, field2: objectOne, field3: 0 },
        { type: 0, field2: objectOne, field3: 7 },
      ],
      widths: [0, 2, 1],
      size: 2,
      index: [0, 2],
    });
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toEqual({
      type: "offset",
      offset: objectOne,
      gen: 7,
    });
  });

  it("skips a type-0 row silently rather than warning about it", () => {
    const { bytes } = xrefStreamVariant({
      rows: (objectOne) => [
        { type: 0, field2: 0, field3: 0 },
        { type: 1, field2: objectOne, field3: 0 },
        { type: 0, field2: 5, field3: 5 },
      ],
      widths: [1, 1, 1],
      size: 3,
      index: [0, 3],
    });
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toMatchObject({ type: "offset" });
    expect(table.entries.get(2)).toBeUndefined();
  });

  it("warns on and drops a row of unrecognised type", () => {
    const { bytes } = xrefStreamVariant({
      rows: (objectOne) => [
        { type: 0, field2: 0, field3: 0 },
        { type: 1, field2: objectOne, field3: 0 },
        { type: 3, field2: 9, field3: 9 },
      ],
      widths: [1, 1, 1],
      size: 3,
      index: [0, 3],
    });
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("pdf/xref-entry-invalid");
    expect(diagnostics[0]?.message).toMatch(
      /row for object 2 has unrecognised type 3/,
    );
    expect(table.entries.get(1)).toMatchObject({ type: "offset" });
    expect(table.entries.get(2)).toBeUndefined();
  });

  it("reads several /Index ranges and ignores a trailing odd element", () => {
    const { bytes } = xrefStreamVariant({
      rows: (objectOne) => [
        { type: 0, field2: 0, field3: 0 },
        { type: 1, field2: objectOne, field3: 0 },
        { type: 1, field2: objectOne, field3: 3 },
      ],
      widths: [1, 2, 1],
      size: 6,
      index: [0, 2, 5, 1, 9],
    });
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toMatchObject({ gen: 0 });
    expect(table.entries.get(5)).toMatchObject({ type: "offset", gen: 3 });
    expect(table.entries.get(2)).toBeUndefined();
  });

  it("warns on running out of row data, naming the first object that no longer fits", () => {
    const { bytes } = xrefStreamVariant({
      rows: (objectOne) => [
        { type: 1, field2: objectOne, field3: 0 },
        { type: 1, field2: objectOne, field3: 1 },
        { type: 1, field2: objectOne, field3: 2 },
        { type: 1, field2: objectOne, field3: 3 },
      ],
      widths: [1, 2, 1],
      size: 12,
      index: [1, 1, 7, 4],
    });
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("pdf/xref-entry-invalid");
    expect(diagnostics[0]?.message).toMatch(/ran out of data before object 10/);
    expect(table.entries.get(1)).toMatchObject({ type: "offset" });
    expect(table.entries.get(9)).toMatchObject({ type: "offset" });
    expect(table.entries.get(10)).toBeUndefined();
  });

  it("covers 0..Size by default when /Index is absent", () => {
    const { bytes, objectOne } = xrefStreamVariant({
      rows: (objectOne) => [
        { type: 0, field2: 0, field3: 0 },
        { type: 1, field2: objectOne, field3: 0 },
      ],
      widths: [1, 2, 1],
      size: 2,
    });
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toMatchObject({
      type: "offset",
      offset: objectOne,
    });
  });
});

describe("readXref: /Prev chain guards", () => {
  it("stops the chain at its own section cap, leaving the oldest section's entries unread", () => {
    // 65 single-entry sections chained oldest-to-newest: the cap walks the newest 64, so the oldest section's own entry for object 2 (which no newer section redefines) must be missing.
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    const objectOne = b.offsetOf(1);
    const objectTwo = b.offsetOf(2);
    const sectionOffsets: number[] = [];
    for (let i = 0; i < 65; i++) {
      sectionOffsets.push(b.length);
      if (i === 0) {
        // The oldest: the one section the cap should never reach.
        b.raw(
          `xref\n2 1\n${pad10(objectTwo)} 00000 n \ntrailer\n<< /Size 3 >>\n`,
        );
      } else if (i === 64) {
        // The newest: carries /Root and the entry object 1 resolves through.
        b.raw(
          `xref\n1 1\n${pad10(objectOne)} 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R /Prev ${sectionOffsets[63]} >>\n`,
        );
      } else {
        b.raw(
          `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 3 /Prev ${sectionOffsets[i - 1]!} >>\n`,
        );
      }
    }
    b.raw(`startxref\n${sectionOffsets[64]!}\n%%EOF`);
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toMatchObject({ type: "offset" });
    expect(table.entries.get(2)).toBeUndefined();
  });

  it("keeps the newest section's trailer keys over the oldest section's", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Catalog /Pages 3 0 R >>");
    const objectOne = b.offsetOf(1);
    const objectTwo = b.offsetOf(2);
    const olderOffset = b.length;
    b.raw(
      `xref\n1 1\n${pad10(objectOne)} 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\n`,
    );
    const newerOffset = b.length;
    b.raw(
      `xref\n2 1\n${pad10(objectTwo)} 00000 n \ntrailer\n<< /Size 3 /Root 2 0 R /Prev ${olderOffset} >>\n`,
    );
    b.raw(`startxref\n${newerOffset}\n%%EOF`);
    const { sink } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 2,
      gen: 0,
    });
  });
});

describe("readXref: the /Root fitness check", () => {
  it("rejects a table whose Root entry points at another object's header, and recovers", () => {
    const { bytes, objectOne } = classicXrefVariant(
      (offsets) =>
        `0 3\n0000000000 65535 f \n${pad10(offsets.objectTwo)} 00000 n \n${pad10(offsets.objectTwo)} 00000 n \n`,
      "/Root 1 0 R",
    );
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
    // Recovery rebuilds object 1's entry at its true offset.
    expect(table.entries.get(1)).toMatchObject({
      type: "offset",
      offset: objectOne,
    });
  });

  it("rejects a Root entry pointing at bytes that are not an object header at all", () => {
    // A marker line whose tokens pass the number checks but spell the keyword wrong, placed ahead of the xref, with the Root entry aimed at it.
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    const notAHeader = b.length;
    b.raw("1 0 obx\n");
    const xrefOffset = b.length;
    b.raw(
      `xref\n0 3\n0000000000 65535 f \n${pad10(notAHeader)} 00000 n \n${pad10(b.offsetOf(2))} 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    );
    const { sink, diagnostics } = collectDiagnostics();
    readXref(b.bytes(), sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });

  it("accepts a Root entry whose offset 0 leads, through the header comment, to object 1's own header", () => {
    const { bytes, objectOne } = classicXrefVariant(
      () =>
        "0 3\n0000000000 65535 f \n0000000000 00000 n \n0000000000 00000 n \n",
      "/Root 1 0 R",
    );
    expect(objectOne).toBeGreaterThan(0);
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(bytes, sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(1)).toMatchObject({ type: "offset", offset: 0 });
  });
});

describe("readXref: linear-scan recovery's own rules", () => {
  it("builds the trailer from the recovered Catalog when no trailer keyword or XRef stream exists", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    b.raw("startxref\n999999\n%%EOF");
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 1,
      gen: 0,
    });
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });

  it("recovers the trailer from the last trailer keyword, keeping the Root it names", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    b.raw(
      "1234567trailer\n<< /Size 9 /Root 2 0 R >>\nstartxref\n999999\n%%EOF",
    );
    const { sink } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(dictGet(table.trailer, "Root")).toEqual({
      kind: "ref",
      num: 2,
      gen: 0,
    });
  });

  it("ignores obj-keyword occurrences without token boundaries on either side", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(
      2,
      "<< /Type /Pages /Kids [] /Count 0 /Note (99 0 xxobj and 98 0 objx and 8 obj) >>",
    );
    b.raw("startxref\n999999\n%%EOF");
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
    for (const num of [8, 98, 99]) {
      expect(table.entries.get(num)).toBeUndefined();
    }
    expect(table.entries.get(0)).toBeUndefined();
  });

  it("recovers an object header that ends the file exactly, with a digit-9 object number", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    b.raw("startxref\n999999\n%%EOF\n79 0 obj");
    const { sink } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(table.entries.get(79)).toMatchObject({ type: "offset", gen: 0 });
    expect(table.entries.get(7)).toBeUndefined();
  });

  it("keeps a top-level object over the same object number packed inside a recovered object stream", () => {
    const b = new FixtureBuilder().header("1.5");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    // A filterless object stream whose header names object 5 — which also exists as a real top-level object below it.
    const objStmBody = new TextEncoder().encode("5 0 << /X 1 >>");
    b.stream(4, "<< /Type /ObjStm /N 1 /First 4 >>", objStmBody);
    b.object(5, "<< /Y 2 >>");
    b.raw("startxref\n999999\n%%EOF");
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
    expect(table.entries.get(5)).toMatchObject({
      type: "offset",
      offset: b.offsetOf(5),
    });
  });

  it("warns when a recovered object stream's own header runs out of pairs", () => {
    const b = new FixtureBuilder().header("1.5");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    // /N 2 but only one "num offset" pair, then a lone digit where the second pair's offset should be.
    const objStmBody = new TextEncoder().encode("5 0 9");
    b.stream(4, "<< /Type /ObjStm /N 2 /First 4 >>", objStmBody);
    b.raw("startxref\n999999\n%%EOF");
    const { sink, diagnostics } = collectDiagnostics();
    readXref(b.bytes(), sink);
    expect(
      diagnostics.some((d) =>
        /object stream 4 header is truncated at entry 1/.exec(d.message),
      ),
    ).toBe(true);
  });
});

describe("readXref: round two of the resolution machinery's own branches", () => {
  it("names the unreadable offset when startxref points at the trailer rather than an xref", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    const trailerAt = b.length;
    b.raw("trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n");
    b.raw(`${trailerAt}\n%%EOF`);
    const { sink, diagnostics } = collectDiagnostics();
    readXref(b.bytes(), sink);
    const unreadable = diagnostics.find((d) =>
      /no readable cross-reference section at offset/.exec(d.message),
    );
    expect(unreadable?.code).toBe("pdf/xref-entry-invalid");
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });

  it("rejects a Root entry pointing at tokens whose second field is not a number", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    const notAHeader = b.length;
    b.raw("1 x obj\n");
    const xrefOffset = b.length;
    b.raw(
      `xref\n0 3\n0000000000 65535 f \n${pad10(notAHeader)} 00000 n \n${pad10(b.offsetOf(2))} 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    );
    const { sink, diagnostics } = collectDiagnostics();
    readXref(b.bytes(), sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });

  it("refuses a zero-width /W, whose rows would then be infinitely many zero-byte reads", () => {
    const { bytes, objectOne } = xrefStreamVariant({
      rows: () => [{ type: 0, field2: 0, field3: 0 }],
      widths: [0, 0, 0],
      size: 2,
      index: [1, 1],
    });
    expect(objectOne).toBeGreaterThan(0);
    const { sink, diagnostics } = collectDiagnostics();
    readXref(bytes, sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });

  it("chains two cross-reference streams through /Prev, keeping the older stream's own entries", () => {
    const b = new FixtureBuilder().header("1.5");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    b.object(4, "<< /Type /Pages /Kids [] /Count 0 >>");
    const width = (value: number, w: number): number[] =>
      Array.from({ length: w }, (_, i) => (value >>> (8 * (w - 1 - i))) & 0xff);
    const row = (type: number, field2: number): number[] => [
      ...width(type, 1),
      ...width(field2, 2),
      ...width(0, 1),
    ];
    // The older xref stream (object 5) is the only section carrying object 4's entry.
    const olderOffset = b.length;
    b.stream(
      5,
      `<< /Type /XRef /Size 5 /W [1 2 1] /Index [1 1 4 1] >>`,
      new Uint8Array([...row(1, b.offsetOf(1)), ...row(1, b.offsetOf(4))]),
    );
    const newerOffset = b.length;
    b.stream(
      6,
      `<< /Type /XRef /Size 5 /W [1 2 1] /Index [1 1] /Root 1 0 R /Prev ${olderOffset} >>`,
      new Uint8Array([...row(1, b.offsetOf(1))]),
    );
    b.raw(`startxref\n${newerOffset}\n%%EOF`);
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(diagnostics).toEqual([]);
    expect(table.entries.get(4)).toMatchObject({
      type: "offset",
      offset: b.offsetOf(4),
    });
  });

  it("does not warn about a clean recovered object stream's header", () => {
    const b = new FixtureBuilder().header("1.5");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 >>");
    b.stream(
      4,
      "<< /Type /ObjStm /N 1 /First 4 >>",
      new TextEncoder().encode("5 0 << /X 1 >>"),
    );
    b.raw("startxref\n999999\n%%EOF");
    const { sink, diagnostics } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
    expect(table.entries.get(5)).toMatchObject({ type: "compressed" });
    expect(diagnostics.some((d) => /truncated/.exec(d.message))).toBe(false);
  });

  it("ignores an obj-keyword occurrence glued to a digit, which no backward header scan could precede", () => {
    const b = new FixtureBuilder().header("1.4");
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [] /Count 0 /Note (77 9obj here) >>");
    b.raw("startxref\n999999\n%%EOF");
    const { sink } = collectDiagnostics();
    const table = readXref(b.bytes(), sink);
    expect(table.entries.get(77)).toBeUndefined();
  });

  it("rejects a Root entry whose offset lies past the end of the file, and recovers", () => {
    const { bytes } = classicXrefVariant(
      () =>
        "0 3\n0000000000 65535 f \n999999999 00000 n \n0000000009 00000 n \n",
      "/Root 1 0 R",
    );
    const { sink, diagnostics } = collectDiagnostics();
    readXref(bytes, sink);
    expect(diagnostics.some((d) => d.code === "pdf/xref-recovered")).toBe(true);
  });
});

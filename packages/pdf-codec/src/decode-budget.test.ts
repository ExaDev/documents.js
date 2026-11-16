import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inflateTolerant, inflateTolerantBounded } from "./bytes/flate";
import { OutputLimitExceededError } from "./bytes/output-limit";
import { PdfDecodeBudget } from "./decode-budget";
import { NOOP_DIAGNOSTIC_SINK, PdfParseError } from "./diagnostics";
import { openPdfDocument } from "./document";
import { decodeStream } from "./filters";
import { pdfArray, pdfDict, pdfName, pdfNum, pdfRef } from "./objects";
import { readPdf } from "./read";
import {
  ascii85Zeros,
  asciiHexZeros,
  BIG,
  BUDGET,
  expectBudgetError,
  flateZeros,
  LARGE,
  lzwEncode,
  runLengthZeros,
  sitePdf,
} from "./test-support/decode-budget";
import * as encryptedFixtures from "./test-support/encrypted-pdfs";
import { enc } from "./test-support/pdf";
import * as pdfFixtures from "./test-support/pdf";
import { randomBytes, seededRandom } from "./test-support/seeded-random";

// The decode budget's mechanics: each filter's bounded decode, the bounded inflate ladder, a document's running total, the unchanged default, and the one decode path every reader goes through. Each site a document decodes at is tested in decode-budget-sites.test.ts.

describe("decodeStream with a budget", () => {
  const filters: readonly {
    readonly name: string;
    readonly encode: (size: number) => Uint8Array<ArrayBuffer>;
  }[] = [
    { name: "FlateDecode", encode: flateZeros },
    { name: "LZWDecode", encode: (size) => lzwEncode(new Uint8Array(size)) },
    { name: "RunLengthDecode", encode: runLengthZeros },
    { name: "ASCII85Decode", encode: ascii85Zeros },
    { name: "ASCIIHexDecode", encode: asciiHexZeros },
  ];

  for (const { name, encode } of filters) {
    describe(name, () => {
      const dict = pdfDict({ Filter: pdfName(name) });

      it("refuses a stream that would expand past the budget, naming it", () => {
        const budget = new PdfDecodeBudget(BUDGET);
        const error = expectBudgetError(
          () =>
            decodeStream(encode(LARGE), dict, NOOP_DIAGNOSTIC_SINK, {
              budget,
              objectNumber: 7,
            }),
          7,
          [name],
        );
        expect(error).toBeInstanceOf(PdfParseError);
        expect(error.maxDecodedBytes).toBe(BUDGET);
        expect(error.decodedBytes).toBe(0);
        expect(budget.remainingBytes).toBe(0);
      });

      it("decodes what fits exactly as without a budget, and charges its length", () => {
        const random = seededRandom(name.length);
        for (let trial = 0; trial < 8; trial++) {
          const size = Math.floor(random() * 4096) + 1;
          const encoded = encode(size);
          const unbounded = decodeStream(encoded, dict, NOOP_DIAGNOSTIC_SINK);
          expect(unbounded.bytes.length).toBe(size);
          const exact = new PdfDecodeBudget(size);
          expect(
            decodeStream(encoded, dict, NOOP_DIAGNOSTIC_SINK, {
              budget: exact,
            }).bytes,
          ).toEqual(unbounded.bytes);
          expect(exact.decodedBytes).toBe(size);
          expectBudgetError(
            () =>
              decodeStream(encoded, dict, NOOP_DIAGNOSTIC_SINK, {
                budget: new PdfDecodeBudget(size - 1),
              }),
            undefined,
          );
        }
      });
    });
  }

  it("charges every stage of a filter chain", () => {
    const dict = pdfDict({
      Filter: pdfArray([pdfName("ASCIIHexDecode"), pdfName("FlateDecode")]),
    });
    const flate = flateZeros(1000);
    const hex = enc(
      `${Array.from(flate, (byte) => byte.toString(16).padStart(2, "0")).join("")}>`,
    );
    const budget = new PdfDecodeBudget(LARGE);
    decodeStream(hex, dict, NOOP_DIAGNOSTIC_SINK, { budget });
    expect(budget.decodedBytes).toBe(flate.length + 1000);
  });

  it("refuses every later decode once one has been refused", () => {
    const budget = new PdfDecodeBudget(BUDGET);
    const dict = pdfDict({ Filter: pdfName("FlateDecode") });
    expectBudgetError(
      () =>
        decodeStream(flateZeros(LARGE), dict, NOOP_DIAGNOSTIC_SINK, { budget }),
      undefined,
    );
    expectBudgetError(
      () => decodeStream(flateZeros(1), dict, NOOP_DIAGNOSTIC_SINK, { budget }),
      undefined,
    );
  });

  it("charges nothing for an unfiltered stream, or the undecoded DCT and JPX stages", () => {
    const budget = new PdfDecodeBudget(0);
    for (const dict of [
      pdfDict({}),
      pdfDict({ Filter: pdfName("DCTDecode") }),
      pdfDict({ Filter: pdfName("JPXDecode") }),
    ]) {
      decodeStream(new Uint8Array(LARGE), dict, NOOP_DIAGNOSTIC_SINK, {
        budget,
      });
    }
    expect(budget.decodedBytes).toBe(0);
  });

  it("refuses a CCITTFax stream from its declared rows before decoding, and bounds one with none by its input", () => {
    const declared = pdfDict({
      Filter: pdfName("CCITTFaxDecode"),
      DecodeParms: pdfDict({
        K: pdfNum(-1),
        Columns: pdfNum(8192),
        Rows: pdfNum(8192),
      }),
    });
    expectBudgetError(
      () =>
        decodeStream(new Uint8Array(1), declared, NOOP_DIAGNOSTIC_SINK, {
          budget: new PdfDecodeBudget(BUDGET),
        }),
      undefined,
      ["CCITTFaxDecode"],
    );
    // No /Rows: every row costs at least one input bit, so a 1-byte input bounds the output at 8 rows of 1024 bytes.
    const undeclared = pdfDict({
      Filter: pdfName("CCITTFaxDecode"),
      DecodeParms: pdfDict({ K: pdfNum(-1), Columns: pdfNum(8192) }),
    });
    expectBudgetError(
      () =>
        decodeStream(new Uint8Array(1), undeclared, NOOP_DIAGNOSTIC_SINK, {
          budget: new PdfDecodeBudget(8 * 1024 - 1),
        }),
      undefined,
    );
    const fits = new PdfDecodeBudget(8 * 1024);
    decodeStream(new Uint8Array(1), undeclared, NOOP_DIAGNOSTIC_SINK, {
      budget: fits,
    });
  });

  it("charges a JBIG2 image its declared size before decoding, and refuses one with no declared size", () => {
    const sized = pdfDict({
      Filter: pdfName("JBIG2Decode"),
      Width: pdfNum(8192),
      Height: pdfNum(8192),
    });
    expectBudgetError(
      () =>
        decodeStream(new Uint8Array(0), sized, NOOP_DIAGNOSTIC_SINK, {
          budget: new PdfDecodeBudget(BUDGET),
        }),
      undefined,
      ["JBIG2Decode"],
    );
    expectBudgetError(
      () =>
        decodeStream(
          new Uint8Array(0),
          pdfDict({ Filter: pdfName("JBIG2Decode") }),
          NOOP_DIAGNOSTIC_SINK,
          { budget: new PdfDecodeBudget(LARGE) },
        ),
      undefined,
    );
  });

  it("rejects a budget that is not a non-negative safe integer", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new PdfDecodeBudget(bad)).toThrow(RangeError);
    }
  });
});

describe("inflateTolerantBounded", () => {
  // Valid, truncated and corrupted zlib streams, against limits either side of what inflateTolerant produces: the bounded ladder must refuse whenever the unbounded output does not fit, and otherwise agree with it.
  it("refuses every input whose output would not fit, and otherwise agrees with inflateTolerant", () => {
    const random = seededRandom(1814);
    for (let trial = 0; trial < 200; trial++) {
      const plain = randomBytes(random, Math.floor(random() * 20_000));
      const repeated = new Uint8Array(Math.floor(random() * 50_000));
      const source = random() < 0.5 ? plain : repeated;
      let data = zlibSync(source);
      const mangle = random();
      if (mangle < 0.25) {
        data = data.slice(0, Math.floor(random() * data.length));
      } else if (mangle < 0.4) {
        data = Uint8Array.from([0x0a, ...data]);
      } else if (mangle < 0.5) {
        data = data.slice(2); // raw DEFLATE under a zlib label
      }
      let unbounded: Uint8Array;
      let recovered: boolean;
      try {
        ({ bytes: unbounded, recovered } = inflateTolerant(data));
      } catch {
        continue;
      }
      const limit = Math.floor(random() * 2 * (unbounded.length + 1));
      if (unbounded.length > limit) {
        expect(() => inflateTolerantBounded(data, limit)).toThrow(
          OutputLimitExceededError,
        );
        continue;
      }
      if (!recovered) {
        expect(inflateTolerantBounded(data, limit).bytes).toEqual(unbounded);
        continue;
      }
      // A recovered output may differ: an earlier tier that passes the limit before failing is refused as it happens (whether it would have succeeded is only known by finishing it), and the last tier, fed in slices, can recover a longer prefix than a single push. Whatever it returns is still a prefix of the stream's own decoding, within the limit.
      let bounded: Uint8Array;
      try {
        bounded = inflateTolerantBounded(data, limit).bytes;
      } catch (error) {
        expect(error).toBeInstanceOf(OutputLimitExceededError);
        continue;
      }
      expect(bounded.length).toBeLessThanOrEqual(limit);
      if (mangle >= 0.25) {
        expect(bounded).toEqual(unbounded);
      } else {
        expect(bounded).toEqual(source.subarray(0, bounded.length));
      }
    }
  });
});

describe("a document opened with a budget", () => {
  it("charges a stream each time it is decoded", () => {
    const document = sitePdf({
      objects: (b) => {
        b.stream(6, BIG, flateZeros(1000));
      },
      maxObj: 6,
    });
    const doc = openPdfDocument(document, NOOP_DIAGNOSTIC_SINK, {
      maxDecodedBytes: LARGE,
    });
    const stream = doc.resolve(pdfRef(6, 0));
    if (stream?.kind !== "stream") {
      throw new Error("fixture object 6 is a stream");
    }
    doc.decodeStream(stream, NOOP_DIAGNOSTIC_SINK);
    doc.decodeStream(stream, NOOP_DIAGNOSTIC_SINK);
    expect(doc.decodeBudget?.decodedBytes).toBe(2000);
  });

  it("has no budget, and charges nothing, without maxDecodedBytes", () => {
    const doc = openPdfDocument(
      pdfFixtures.minimalClassicXrefPdf(),
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(doc.decodeBudget).toBeUndefined();
  });
});

describe("without a budget", () => {
  // Every zero-argument document fixture the read tests use: a read with the largest budget must equal a read with none, error for error.
  const fixtures = Object.entries({ ...pdfFixtures, ...encryptedFixtures })
    .filter(
      (entry): entry is [string, () => Uint8Array<ArrayBuffer>] =>
        typeof entry[1] === "function" && entry[1].length === 0,
    )
    .flatMap(([name, build]) => {
      try {
        const bytes = build();
        return bytes instanceof Uint8Array ? [{ name, bytes }] : [];
      } catch {
        return [];
      }
    });

  it("finds the fixtures it compares", () => {
    expect(fixtures.length).toBeGreaterThan(10);
  });

  for (const { name, bytes } of fixtures) {
    it(`reads ${name} the same with an unlimited budget as with none`, () => {
      const outcome = (maxDecodedBytes?: number): unknown => {
        try {
          return readPdf(
            bytes,
            maxDecodedBytes === undefined ? {} : { maxDecodedBytes },
          );
        } catch (error) {
          return error;
        }
      };
      expect(outcome(Number.MAX_SAFE_INTEGER)).toEqual(outcome());
    });
  }
});

// Every decode a document reaches goes through its resolver's decodeStream, which is what charges the budget; a module calling filters.ts's decodeStream itself would decode outside it. Only the modules that build that path (the document, cross-reference reading, and the filters themselves) may.
describe("the decodeStream boundary", () => {
  it("is imported only by the modules that charge the budget themselves", () => {
    const src = dirname(fileURLToPath(import.meta.url));
    const importers = readdirSync(src)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) =>
        /import\s*\{[^}]*\bdecodeStream\b[^}]*\}\s*from\s*"\.\/filters"/u.test(
          readFileSync(join(src, file), "utf8"),
        ),
      )
      .sort();
    expect(importers).toEqual(["document.ts", "xref.ts"]);
  });
});

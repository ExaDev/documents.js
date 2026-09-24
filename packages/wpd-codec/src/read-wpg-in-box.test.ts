import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpdContent } from "./read";
import { buildWpdFile, text, variableFunction } from "./test-support/build-wpd";

describe("WPG vector graphics embedded in an image box", () => {
  const BOX_GROUP = 0xdf;
  const PAGE_ANCHORED_BOX = 0x02;
  const BOX_CONTENT_TYPE_IMAGE = 3;
  const PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA = 0x6f;

  // Threaded by reference rather than passed as a bare array parameter: bytes is a local accumulator every call site owns and mutates in place, and wrapping it in a one-field sink keeps exadev/prefer-readonly-array-param out of scope for it the same way byte-codec's CodeUnitSink does for its own hot-loop accumulator.
  interface ByteSink {
    readonly bytes: number[];
  }
  function putUint16(sink: ByteSink, offset: number, value: number): void {
    sink.bytes[offset] = value & 0xff;
    sink.bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function contentBlock(contentType: number): number[] {
    const flags: number[] = [0, 0];
    putUint16({ bytes: flags }, 0, 0x4000);
    return [...flags, contentType];
  }

  function positionBlock(widthWpu: number, heightWpu: number): number[] {
    const flags: number[] = [0, 0];
    putUint16({ bytes: flags }, 0, 0x0c00);
    const width = [0, 0, 0];
    putUint16({ bytes: width }, 1, widthWpu);
    const height = [0, 0, 0];
    putUint16({ bytes: height }, 1, heightWpu);
    return [...flags, ...width, ...height];
  }

  function boxNonDeletable(
    overrideFlags: number,
    blocks: ReadonlyMap<number, readonly number[]>,
  ): number[] {
    const bytes = new Array<number>(18).fill(0);
    putUint16({ bytes }, 18, overrideFlags);
    for (let bit = 15; bit >= 5; bit -= 1) {
      const data = blocks.get(bit);
      if (data === undefined) {
        continue;
      }
      putUint16({ bytes }, bytes.length, data.length);
      bytes.push(...data);
    }
    return bytes;
  }

  // An image box naming a Graphics Filename packet at prefix ID 2, itself naming one Graphics Cached File Data child at prefix ID 3 — the one path stream/wpg.ts's own decoder is reached through. `withFrame` false omits the position override entirely, for the "no trustworthy frame" branch.
  function imageBoxFunction(withFrame = true): number[] {
    const blocks = new Map<number, readonly number[]>([
      [13, contentBlock(BOX_CONTENT_TYPE_IMAGE)],
    ]);
    if (withFrame) {
      blocks.set(14, positionBlock(1440, 720));
    }
    return variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(withFrame ? 0x6000 : 0x2000, blocks),
    });
  }

  function graphicsFilenamePacket() {
    return {
      packetType: 0x40,
      flags: 0x01,
      bytes: new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
    };
  }

  function graphicsCachedFileDataPacket(wpgBytes: Uint8Array) {
    return {
      packetType: PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA,
      bytes: wpgBytes,
    };
  }

  function word(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff];
  }

  function dword(value: number): number[] {
    return [...word(value & 0xffff), ...word((value >>> 16) & 0xffff)];
  }

  function wpgRecord(type: number, data: readonly number[]): number[] {
    return [0x0f, type, 0, data.length, ...data];
  }

  // A minimal, well-formed WPG 2.x stream: the 26-byte prefix, a Start WPG stating a 288x144pt extent at 72ppi, one framed Rectangle vector, and End WPG.
  function wpgFile(options: {
    readonly majorVersion?: number;
    readonly encrypted?: boolean;
    readonly withRecordStream?: boolean;
    readonly withVector?: boolean;
  }): Uint8Array {
    const majorVersion = options.majorVersion ?? 2;
    const startWpgData = [
      ...word(72),
      ...word(72),
      0,
      ...word(0),
      ...word(0),
      ...word(0x7fff),
      ...word(0x7fff),
      ...word(0),
      ...word(0),
      ...word(288),
      ...word(144),
    ];
    const records =
      options.withRecordStream === false
        ? []
        : [
            ...wpgRecord(0x01, startWpgData),
            ...(options.withVector === false
              ? []
              : wpgRecord(0x18, [
                  ...word(0x8000),
                  ...word(0),
                  ...word(0),
                  ...word(10),
                  ...word(10),
                  ...word(0),
                  ...word(0),
                ])),
            ...wpgRecord(0x02, []),
          ];
    const head = [
      0xff,
      0x57,
      0x50,
      0x43,
      ...dword(26),
      1,
      0x16,
      majorVersion,
      0,
      ...word(options.encrypted === true ? 1 : 0),
      ...word(26),
      0,
      0,
      ...word(0),
      ...dword(26 + records.length),
      ...word(0),
    ];
    return new Uint8Array([...head, ...records]);
  }

  it("lifts a decoded WPG graphic as a nested drawing embeddedObject, naming its one skipped record", () => {
    // A Polyspline record (0x16, unrecognised by this reader) rides alongside the framed rectangle, so the decode both succeeds and reports a skipped record.
    const wpg = wpgFile({});
    const withSkip = new Uint8Array([
      ...wpg.subarray(0, wpg.length - 4), // drop the trailing End WPG record
      ...wpgRecord(0x16, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(5),
        ...word(5),
      ]),
      ...wpgRecord(0x02, []),
    ]);
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(withSkip),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (block?.kind !== "embeddedObject") {
      throw new Error("expected an embeddedObject block");
    }
    expect(block.objectKind).toBe("drawing");
    expect(block.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 86.4,
      heightPt: 43.2,
    });
    if (block.document.kind !== "drawing") {
      throw new Error("expected a drawing document");
    }
    expect(block.document.pages).toHaveLength(1);
    expect(block.document.pages[0]?.size).toEqual({
      widthPt: 288,
      heightPt: 144,
    });
    expect(block.document.pages[0]?.vectors).toHaveLength(1);
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds a WPG vector graphic that partially decoded; the following record types were skipped: Polyspline.",
    );
  });

  it("flushes preceding text into its own paragraph before a decoded WPG's own drawing block", () => {
    const wpg = wpgFile({});
    const document = readWpdContent(
      buildWpdFile(
        [...text("before"), ...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(
      blocks.map((b) =>
        b.kind === "paragraph"
          ? "paragraph"
          : b.kind === "embeddedObject"
            ? "embeddedObject"
            : b.kind,
      ),
    ).toEqual(["paragraph", "embeddedObject"]);
    const paragraph = blocks.find((b) => b.kind === "paragraph");
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("before");
  });

  it("carries a decoded WPG graphic's own text shapes alongside its vectors", () => {
    const wpg = wpgFile({});
    // A Text Block (with one extension, its Text Data) inserted before the trailing End WPG record, alongside the rectangle wpgFile({}) already carries as a vector.
    const withShape = new Uint8Array([
      ...wpg.subarray(0, wpg.length - 4),
      0x0f,
      0x1d,
      1,
      10, // extension count 1, [flags word, x, y, width, height]
      ...word(0),
      ...word(10),
      ...word(10),
      ...word(60),
      ...word(50),
      ...wpgRecord(0x0f, [...text("Hi"), 0xcc]),
      ...wpgRecord(0x02, []),
    ]);
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(withShape),
        ],
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (block?.kind !== "embeddedObject" || block.document.kind !== "drawing") {
      throw new Error("expected a drawing embeddedObject");
    }
    expect(block.document.pages[0]?.vectors).toHaveLength(1);
    expect(block.document.pages[0]?.shapes).toHaveLength(1);
  });

  it("tries every Graphics Cached File Data child until one decodes as WPG, not just the first", () => {
    const wpg = wpgFile({});
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          {
            packetType: 0x40,
            flags: 0x01,
            // Two children (prefix IDs 3 and 4), not the usual one.
            bytes: new Uint8Array([2, 0, 3, 0, 4, 0]),
          },
          {
            packetType: PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA,
            bytes: new Uint8Array([1, 2, 3, 4]), // not a WPG signature at all
          },
          graphicsCachedFileDataPacket(wpg), // the real one, at the second child
        ],
      ),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    expect(block?.kind).toBe("embeddedObject");
  });

  it("names more than one skipped WPG record type, joined by a comma and a space", () => {
    // Polyspline (0x16) and Polycurve (0x17), both unrecognised by this reader, alongside the framed rectangle.
    const wpg = wpgFile({});
    const withSkips = new Uint8Array([
      ...wpg.subarray(0, wpg.length - 4), // drop the trailing End WPG record
      ...wpgRecord(0x16, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(5),
        ...word(5),
      ]),
      ...wpgRecord(0x17, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(5),
        ...word(5),
      ]),
      ...wpgRecord(0x02, []),
    ]);
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(withSkips),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds a WPG vector graphic that partially decoded; the following record types were skipped: Polyspline, Polycurve.",
    );
  });

  it("lifts a decoded WPG graphic with no skipped records, reporting nothing", () => {
    const wpg = wpgFile({});
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    expect(block?.kind).toBe("embeddedObject");
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
      ),
    ).toBe(false);
  });

  it("reports a decoded WPG graphic with no trustworthy frame, lifting nothing", () => {
    const wpg = wpgFile({});
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction(false)],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    expect(
      document.sections[0]?.blocks.some((b) => b.kind === "embeddedObject"),
    ).toBe(false);
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.BoxFrameUnresolved,
    );
    expect(found?.message).toBe(
      "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
    );
  });

  it("reports a WPG 1.0 graphic through the diagnostic sink with its own exact message", () => {
    const wpg = wpgFile({ majorVersion: 1 });
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds a WPG 1.0 vector graphic, whose type-and-length record vocabulary predates the framed WPG 2.x stream this reader decodes, so it was not lifted.",
    );
  });

  it("reports an encrypted WPG graphic through the diagnostic sink with its own exact message", () => {
    const wpg = wpgFile({ encrypted: true });
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds an encrypted WPG vector graphic, which this reader does not decrypt, so it was not lifted.",
    );
  });

  it("reports a malformed WPG graphic (no walkable Start WPG record) with its own exact message", () => {
    const wpg = wpgFile({ withRecordStream: false });
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds a WPG graphic whose record stream this reader could not walk (no well-formed Start WPG record), so it was not lifted.",
    );
  });
});

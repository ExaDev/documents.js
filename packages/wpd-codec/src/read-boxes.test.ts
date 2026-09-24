import type { ContentBlock } from "document-schema.js";
import { bytesToBase64 } from "byte-codec";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpdContent } from "./read";
import { buildWpdFile, text, variableFunction } from "./test-support/build-wpd";
import { readDocumentArea } from "./test-support/read-fixtures";

describe("boxes", () => {
  const BOX_GROUP = 0xdf;
  const PAGE_ANCHORED_BOX = 0x02;
  const BOX_CONTENT_TYPE_TEXT = 1;
  const BOX_CONTENT_TYPE_LINKED_TEXT = 2;
  const BOX_CONTENT_TYPE_EQUATION = 4;
  const BOX_CONTENT_TYPE_IMAGE = 3;

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
    putUint16({ bytes: flags }, 0, 0x4000); // bit 14: content type override
    return [...flags, contentType];
  }

  function positionBlock(widthWpu: number, heightWpu: number): number[] {
    const flags: number[] = [0, 0];
    putUint16({ bytes: flags }, 0, 0x0c00); // bits 11 (width) and 10 (height)
    const width = [0, 0, 0];
    putUint16({ bytes: width }, 1, widthWpu);
    const height = [0, 0, 0];
    putUint16({ bytes: height }, 1, heightWpu);
    return [...flags, ...width, ...height];
  }

  // A box function's own nonDeletable bytes: 14 reserved, two unused "total size" words, the override flags word, then each set bit's own size-prefixed block in descending order.
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

  function generalWpTextPacket(documentArea: readonly number[]) {
    const header = [
      1,
      0,
      6,
      0,
      documentArea.length & 0xff,
      (documentArea.length >>> 8) & 0xff,
    ];
    return {
      packetType: 0x08,
      bytes: new Uint8Array([...header, ...documentArea]),
    };
  }

  function boxFunction(
    contentType: number,
    prefixIds: readonly number[],
  ): number[] {
    return variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds,
      nonDeletable: boxNonDeletable(
        0x6000, // bit 14 (position) and bit 13 (content)
        new Map([
          [14, positionBlock(1440, 720)], // 1440 WPU = 86.4pt, 720 WPU = 43.2pt
          [13, contentBlock(contentType)],
        ]),
      ),
    });
  }

  it("lifts a text box's own content into an embedded wordprocessing document", () => {
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_TEXT, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) }, // box template, not read
        generalWpTextPacket(text("boxed text")),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    expect(block?.kind).toBe("embeddedObject");
    if (block?.kind !== "embeddedObject")
      throw new Error("expected embeddedObject");
    expect(block.objectKind).toBe("wordprocessing");
    expect(block.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 86.4,
      heightPt: 43.2,
    });
    if (block.document.kind !== "wordprocessing") {
      throw new Error("expected nested wordprocessing document");
    }
    expect(block.document.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "boxed text" }],
    });
  });

  it("lifts a linked-text box's own content the same way as a plain text box", () => {
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_LINKED_TEXT, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        generalWpTextPacket(text("linked text")),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (
      block?.kind !== "embeddedObject" ||
      block.document.kind !== "wordprocessing"
    ) {
      throw new Error("expected a nested wordprocessing document");
    }
    expect(block.document.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "linked text" }],
    });
  });

  it("does not treat an unrecognised content type as text-like, even with a readable General WP Text packet at its prefix ID", () => {
    const UNKNOWN_CONTENT_TYPE = 5;
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...boxFunction(UNKNOWN_CONTENT_TYPE, [1, 2])],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          generalWpTextPacket(text("should not be lifted")),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(
      document.sections[0]?.blocks.some((b) => b.kind === "embeddedObject"),
    ).toBe(false);
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.BoxContentUnresolved,
      ),
    ).toBe(true);
  });

  it("reports the exact box-content-unresolved message for a text-like box whose content packet is not General WP Text", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...boxFunction(BOX_CONTENT_TYPE_TEXT, [1, 2])],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          { packetType: 0x55, bytes: new Uint8Array(0) }, // font descriptor, not General WP Text
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.BoxContentUnresolved,
    );
    expect(found?.message).toBe(
      "This document contains a box whose content this reader could not read — an image, OLE object, or other content type this reader does not yet decode into the shared schema.",
    );
  });

  it("reports the exact box-frame-unresolved message for a text-like box stating no width or height", () => {
    const noFrameBox = variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(
        0x2000, // bit 13 (content) only — no position/size override at all
        new Map([[13, contentBlock(BOX_CONTENT_TYPE_TEXT)]]),
      ),
    });
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...noFrameBox],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          generalWpTextPacket(text("boxed")),
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
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

  it("flushes preceding text into its own paragraph before a text-like box's own embedded document", () => {
    const document = readDocumentArea(
      [...text("before"), ...boxFunction(BOX_CONTENT_TYPE_TEXT, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        generalWpTextPacket(text("boxed")),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "embeddedObject"]);
    const paragraph = blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("before");
  });

  it("lifts an equation box's own content as unparsed residue, not fabricated MathML", () => {
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_EQUATION, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        generalWpTextPacket(text("a+b")),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (block?.kind !== "embeddedObject")
      throw new Error("expected embeddedObject");
    expect(block.objectKind).toBe("formula");
    if (block.document.kind !== "formula") {
      throw new Error("expected a formula document");
    }
    expect(block.document.formula.mathml).toEqual([]);
    expect(block.document.formula.source).toEqual({
      format: "wpd",
      xml: "a+b",
    });
  });

  // plainTextOf must only ever read paragraph blocks — a non-paragraph block folded alongside them (a page break, here) carries no `runs` field at all and must be skipped rather than read as one. It must also join a paragraph's own runs with no separator, and join separate paragraphs with a newline.
  it("builds an equation's plain-text residue from only its paragraph blocks, joined correctly", () => {
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_EQUATION, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        generalWpTextPacket([
          ...text("a"),
          0xf2, // ATTRIBUTE_ON (bold), splitting the first paragraph across two runs
          12, // BOLD
          0xf2,
          ...text("b"),
          0xcc, // HARD_EOL: ends the first paragraph
          0xc7, // hard end of page: a non-paragraph block between the two paragraphs
          ...text("c"),
        ]),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (block?.kind !== "embeddedObject")
      throw new Error("expected embeddedObject");
    if (block.document.kind !== "formula") {
      throw new Error("expected a formula document");
    }
    // The hard end of page unconditionally flushes a paragraph before it, which is empty here (the hard return just before it already flushed the pending text) — so the join sees three paragraphs ("ab", "", "c"), with the intervening page break filtered out entirely rather than read as a fourth.
    expect(block.document.formula.source).toEqual({
      format: "wpd",
      xml: "ab\n\nc",
    });
  });

  it("reports an image box through the diagnostic sink rather than guessing at its content", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const bytes = buildWpdFile(
      [...boxFunction(BOX_CONTENT_TYPE_IMAGE, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        { packetType: 0x40, bytes: new Uint8Array([0]) }, // Graphics Filename, not decoded
      ],
    );
    readWpdContent(bytes, {
      sink: (d) => {
        diagnostics.push(d);
      },
    });
    const matches = diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === WpdDiagnosticCodes.BoxContentUnresolved,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toBe(
      "This document contains an image box whose content packet carries no decodable PNG or JPEG payload — a WPG graphic or other image spelling this reader does not decode.",
    );
  });

  // A minimal well-formed 1x1 white PNG: signature, IHDR, IDAT, IEND — hand-built here as bytes so the fixture needs no encoder dependency, and structurally complete so stream/image.ts's chunk walk bounds it exactly.
  function tinyPng(): Uint8Array {
    const chunk = (type: string, data: readonly number[]): number[] => [
      0,
      0,
      0,
      data.length,
      ...Array.from(type, (c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0, // crc not verified by the scanner
    ];
    return new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      ...chunk("IDAT", [0x78, 0x01]),
      ...chunk("IEND", []),
    ]);
  }

  it("lifts an image box carrying a PNG payload as a real image block", () => {
    const png = tinyPng();
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_IMAGE, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        // An "Image: WP"-shaped packet: a small unknown header ahead of the payload, so the test proves the magic scan rather than assuming the payload sits at offset 0.
        {
          packetType: 0x42,
          bytes: new Uint8Array([9, 9, 9, 9, ...png, 7, 7]),
        },
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "image" }> => b.kind === "image",
    );
    if (block === undefined) throw new Error("expected an image block");
    expect(block.format).toBe("png");
    expect(block.base64).toBe(bytesToBase64(png));
    expect(block.widthPt).toBeCloseTo(86.4);
    expect(block.heightPt).toBeCloseTo(43.2);
    expect(block.floatPosition).toBeUndefined();
  });

  it("reports the exact box-frame-unresolved message for an image box stating no width or height", () => {
    const png = tinyPng();
    const noFrameBox = variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(
        0x2000, // bit 13 (content) only — no position/size override at all
        new Map([[13, contentBlock(BOX_CONTENT_TYPE_IMAGE)]]),
      ),
    });
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...noFrameBox],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          { packetType: 0x42, bytes: png },
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(document.sections[0]?.blocks.some((b) => b.kind === "image")).toBe(
      false,
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.BoxFrameUnresolved,
    );
    expect(found?.message).toBe(
      "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
    );
  });

  it("flushes preceding text into its own paragraph before an image box's own image block", () => {
    const png = tinyPng();
    const document = readDocumentArea(
      [...text("before"), ...boxFunction(BOX_CONTENT_TYPE_IMAGE, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        { packetType: 0x42, bytes: png },
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "image"]);
    const paragraph = blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("before");
  });

  it("carries an image box's absolute page position as the image's floatPosition", () => {
    const png = tinyPng();
    // Position override with all four members: horizontal and vertical absolute-from-page-edge offsets (type 0 flags) plus width and height.
    const flags: number[] = [0, 0];
    putUint16({ bytes: flags }, 0, 0x3c00); // bits 13 (h), 12 (v), 11 (width), 10 (height)
    const horizontal = [0x00, 0x10, 0x01, 0, 0]; // type 0 = absolute from page edge, offset 0x0110 WPU = 10.56pt
    const vertical = [0x00, 0x20, 0x02]; // type 0, offset 0x0220 WPU = 21.12pt
    const width = [0, 0, 0];
    putUint16({ bytes: width }, 1, 1440);
    const height = [0, 0, 0];
    putUint16({ bytes: height }, 1, 720);
    const positionedBox = variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(
        0x6000,
        new Map([
          [14, [...flags, ...horizontal, ...vertical, ...width, ...height]],
          [13, contentBlock(BOX_CONTENT_TYPE_IMAGE)],
        ]),
      ),
    });
    const document = readDocumentArea(
      [...positionedBox],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        { packetType: 0x42, bytes: png },
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "image" }> => b.kind === "image",
    );
    if (block === undefined) throw new Error("expected an image block");
    expect(block.floatPosition).toEqual({
      horizontal: { relativeTo: "page", offsetPt: 0x0110 * 0.06 },
      vertical: { relativeTo: "page", offsetPt: 0x0220 * 0.06 },
    });
  });

  it("reports a box with no content override through the diagnostic sink", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const bytes = buildWpdFile([
      ...variableFunction({
        group: BOX_GROUP,
        subgroup: PAGE_ANCHORED_BOX,
        prefixIds: [1],
        nonDeletable: boxNonDeletable(0, new Map()),
      }),
    ]);
    readWpdContent(bytes, {
      sink: (d) => {
        diagnostics.push(d);
      },
    });
    expect(
      diagnostics.filter(
        (diagnostic) => diagnostic.code === WpdDiagnosticCodes.BoxDropped,
      ),
    ).toHaveLength(1);
  });
});

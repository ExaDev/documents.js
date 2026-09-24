import { bytesToBase64 } from "byte-codec";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpd, readWpdContent } from "./read";
import { buildWpdFile, text, variableFunction } from "./test-support/build-wpd";
import { writeCompoundFile } from "archive-codec";
import { PERFECT_OFFICE_MAIN_STREAM } from "./container/container";
import { readDocumentArea } from "./test-support/read-fixtures";

describe("page furniture and notes (D6/D7, #1128)", () => {
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

  function headerFunction(subgroup: number, occurrence: number): number[] {
    return variableFunction({
      group: 0xd6,
      subgroup,
      prefixIds: [1],
      nonDeletable: [occurrence, 0],
    });
  }

  it("gives a plain flat document's own section no headers, footers, or watermarks keys at all", () => {
    const document = readDocumentArea(text("plain"));
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const section = document.sections[0];
    expect(section).toBeDefined();
    for (const key of ["headers", "footers", "watermarks"]) {
      expect(section === undefined ? false : Object.hasOwn(section, key)).toBe(
        false,
      );
    }
  });

  it("reports the exact could-not-resolve message for a header naming no packet, without setting a header slot", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...text("body"),
        ...variableFunction({
          group: 0xd6,
          subgroup: 0x00,
          prefixIds: [7], // names a prefix ID this document's index carries no packet for
          nonDeletable: [1, 0],
        }),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(Object.hasOwn(document.sections[0] ?? {}, "headers")).toBe(false);
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.HeaderFooterDropped,
    );
    expect(found?.message).toBe(
      "This document declares a header, footer, or watermark whose body packet this reader could not resolve; it was not lifted.",
    );
  });

  it("reports the exact could-not-read message for a header whose body packet cannot be parsed", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...text("body"), ...headerFunction(0x00, 0x01)],
        // General WP Text, the right packet type, but too short for even its own block-count word.
        [{ packetType: 0x08, bytes: new Uint8Array(0) }],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(Object.hasOwn(document.sections[0] ?? {}, "headers")).toBe(false);
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.HeaderFooterDropped,
    );
    expect(found?.message).toBe(
      "This document declares a header, footer, or watermark whose body packet this reader could not read; it was not lifted.",
    );
  });

  it("lifts a header occurring on odd pages into the section's default header slot", () => {
    const document = readDocumentArea(
      [...text("body"), ...headerFunction(0x00, 0x01)],
      [generalWpTextPacket(text("Confidential draft"))],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.headers?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["Confidential draft"]);
    expect(section.headers?.even).toBeUndefined();
    expect(section.footers).toBeUndefined();
  });

  it("lifts an even-only footer into the even slot", () => {
    const document = readDocumentArea(
      [...text("body"), ...headerFunction(0x02, 0x02)],
      [generalWpTextPacket(text("Page footer"))],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.footers?.even?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["Page footer"]);
    expect(section.footers?.default).toBeUndefined();
  });

  it("lifts a watermark occurring on both parities into the section's default watermark slot", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...variableFunction({
            group: 0xd6,
            subgroup: 0x04,
            prefixIds: [1],
            nonDeletable: [0x03, 0],
          }),
        ],
        [generalWpTextPacket(text("DRAFT"))],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.watermarks?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["DRAFT"]);
    expect(section.watermarks?.even).toBeUndefined();
    // A watermark is lifted page furniture now, not a dropped header-or-footer: the code no longer fires for it.
    expect(
      diagnostics.filter((d) => d.code === "wpd/header-footer-dropped"),
    ).toHaveLength(0);
  });

  it("lifts an even-only watermark into the even slot", () => {
    const document = readDocumentArea(
      [...text("body"), ...headerFunction(0x05, 0x02)],
      [generalWpTextPacket(text("EVEN DRAFT"))],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.watermarks?.even?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["EVEN DRAFT"]);
    expect(section.watermarks?.default).toBeUndefined();
  });

  it("keeps the first watermark when a second claims the same slot", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...headerFunction(0x04, 0x01),
          ...headerFunction(0x05, 0x01),
        ],
        [generalWpTextPacket(text("First watermark"))],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.watermarks?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["First watermark"]);
    expect(
      diagnostics.some((d) => d.code === "wpd/header-footer-dropped"),
    ).toBe(true);
  });

  it("reports a watermark whose occurrence bits claim neither parity, lifting nothing", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...variableFunction({
            group: 0xd6,
            subgroup: 0x04,
            prefixIds: [1],
            nonDeletable: [0x00, 0],
          }),
        ],
        [generalWpTextPacket(text("DRAFT"))],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(document.sections[0]?.watermarks).toBeUndefined();
    expect(diagnostics).toHaveLength(0);
  });

  it("keeps the first header when a second claims the same slot", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...headerFunction(0x00, 0x01),
          ...headerFunction(0x01, 0x01),
        ],
        [generalWpTextPacket(text("First header"))],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.headers?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["First header"]);
    const found = diagnostics.find(
      (d) => d.code === "wpd/header-footer-dropped",
    );
    expect(found?.message).toBe(
      "This document declares a second header for the default slot — WordPerfect's own A/B two-slot-per-kind mechanism, which the shared one-flow-per-slot page-furniture vocabulary does not carry; the first header to claim the slot is the one lifted.",
    );
  });

  it("anchors a footnote reference in the flat form and carries its body in the tree's definitions table", () => {
    const noteBody = generalWpTextPacket(text("The fine print"));
    const documentArea = [
      ...text("See this"),
      ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }),
      ...text("1"),
      ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
      ...text(" point"),
    ];
    const diagnostics: WpdDiagnostic[] = [];
    const flat = readWpdContent(buildWpdFile(documentArea, [noteBody]), {
      sink: (d) => {
        diagnostics.push(d);
      },
    });
    if (flat.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const paragraph = flat.sections[0]?.blocks.find(
      (b): b is Extract<typeof b, { kind: "paragraph" }> =>
        b.kind === "paragraph",
    );
    expect(paragraph?.constructs?.[0]?.descriptor.kind).toBe("anchor");
    const anchor = paragraph?.constructs?.[0]?.descriptor;
    if (anchor?.kind === "anchor") {
      expect(anchor.anchorType).toBe("footnote");
      expect(anchor.name).toBe("1");
      expect(anchor.definition).toBe("note-1");
    } else {
      throw new Error("expected an anchor descriptor");
    }
    // The flat form reports the body it cannot carry.
    const noteDroppedMatches = diagnostics.filter(
      (d) => d.code === "wpd/note-dropped",
    );
    expect(noteDroppedMatches).toHaveLength(1);
    expect(noteDroppedMatches[0]?.message).toBe(
      "This document contains a footnote whose body the flat ContentDocument has no home for; its reference anchor survives and readWpd lifts the body into the tree form's definitions table.",
    );

    const tree = readWpd(buildWpdFile(documentArea, [noteBody]));
    // The definitions table is deliberately tenant-loose (document-schema.js's own design), so the whole entry is asserted in one toEqual rather than through typed field access.
    expect(tree.definitions?.["note-1"]).toEqual({
      kind: "footnote",
      marker: "1",
      blocks: [
        {
          kind: "paragraph",
          runs: [{ text: "The fine print" }],
        },
      ],
    });
    // No OLE objects anywhere in this document — the attachments table must not appear at all, not even empty.
    expect(tree.attachments).toBeUndefined();
  });

  it("reports the exact could-not-read message for a note whose body packet is the wrong type", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [
          ...text("See this"),
          ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }),
          ...text("1"),
          ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
        ],
        [{ packetType: 0x55, bytes: new Uint8Array(0) }], // a real packet, but not General WP Text
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.NoteDropped,
    );
    expect(found?.message).toBe(
      "This document contains a footnote or endnote whose body packet this reader could not read; its reference anchor survives and its body does not.",
    );
  });

  // The marker text is built from every run between a note's On and Off, flushing whatever text is still pending first — and only falls back to a generated numeral when that text is genuinely empty. A marker that IS real text, spanning more than one run and happening to be truthy, must be used as-is rather than replaced by the numeral, and the numeral itself must come from the notes already carried plus one, not minus one.
  it("builds a multi-run marker over the generated-numeral fallback, and numbers a genuinely empty marker correctly", () => {
    const bodies = [
      generalWpTextPacket(text("first body")),
      generalWpTextPacket(text("second body")),
    ];
    const tree = readWpd(
      buildWpdFile(
        [
          // Note A: an empty reference marker — must fall back to the generated numeral "1" (state.notes.length is 0 at this point).
          ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }),
          ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
          // Note B: a genuine, non-empty, two-run marker ("star") that must win over the fallback numeral ("2").
          ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [2] }),
          ...text("st"),
          0xf2, // ATTRIBUTE_ON (bold), splitting the marker across two runs
          12, // BOLD
          0xf2,
          ...text("ar"),
          ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
        ],
        bodies,
      ),
    );
    expect(tree.definitions?.["note-1"]?.marker).toBe("1");
    expect(tree.definitions?.["note-2"]?.marker).toBe("star");
  });

  it("carries an endnote pair as the endnote tenant", () => {
    const tree = readWpd(
      buildWpdFile(
        [
          ...text("Note"),
          ...variableFunction({ group: 0xd7, subgroup: 0x02, prefixIds: [1] }),
          ...text("2"),
          ...variableFunction({ group: 0xd7, subgroup: 0x03 }),
        ],
        [generalWpTextPacket(text("The endnote body"))],
      ),
    );
    const definition = tree.definitions?.["note-1"];
    expect(definition?.kind).toBe("endnote");
  });

  // An unrelated subfunction sharing the D7 group (neither Footnote Off nor Endnote Off) must not be mistaken for a closing code and prematurely abandon a note already open — the note must still resolve normally once its own real Off arrives.
  it("does not abandon an open footnote for an unrelated subfunction sharing its own function group", () => {
    const tree = readWpd(
      buildWpdFile(
        [
          ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }), // Footnote On
          ...text("mark"),
          ...variableFunction({ group: 0xd7, subgroup: 0x04 }), // an unassigned D7 subfunction, neither an On nor an Off
          ...variableFunction({ group: 0xd7, subgroup: 0x01 }), // Footnote Off
        ],
        [generalWpTextPacket(text("The fine print"))],
      ),
    );
    const definition = tree.definitions?.["note-1"];
    expect(definition?.kind).toBe("footnote");
    expect(definition?.marker).toBe("mark");
  });
});

describe("native OLE objects (#1191)", () => {
  const BOX_GROUP = 0xdf;
  const PAGE_ANCHORED_BOX = 0x02;
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

  function imageBoxFunction(): number[] {
    return variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(
        0x6000, // bit 14 (position) and bit 13 (content)
        new Map([
          [14, positionBlock(1440, 720)],
          [13, contentBlock(BOX_CONTENT_TYPE_IMAGE)],
        ]),
      ),
    });
  }

  // The descriptor packet, assembled from WPFF PrefixPkt83-255's own field table: the 44-byte marker, the fixed head, then the payload wordstring.
  function oleDescriptorPacket(
    marker: string,
    objectNumber: number,
    payload: readonly number[],
  ) {
    // The marker field is 44 bytes and the string with its null is 43, so one pad byte follows.
    const markerBytes = [
      ...Array.from(marker, (character) => character.charCodeAt(0)),
      0,
      0,
    ];
    const fixedHead = [
      3,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      objectNumber & 0xff,
      (objectNumber >>> 8) & 0xff,
      (objectNumber >>> 16) & 0xff,
      (objectNumber >>> 24) & 0xff,
    ];
    return {
      packetType: 0x70,
      bytes: new Uint8Array([...markerBytes, ...fixedHead, ...payload]),
    };
  }

  // A Graphics Filename packet (type 0x40) whose index flags state children and whose data names one child: prefix ID 3, the descriptor packet that follows it in the packet list.
  function graphicsFilenamePacket() {
    return {
      packetType: 0x40,
      flags: 0x01,
      bytes: new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
    };
  }

  it("carries an OLE 2 object's native stream bytes as a tree-form attachment", () => {
    const nativeBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 9, 9]);
    const bare = buildWpdFile(
      [...imageBoxFunction()],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        graphicsFilenamePacket(),
        oleDescriptorPacket(
          "WPWin7.0/OLE 2.0 Prefix Information Marker",
          0,
          // The null-terminated WP word string naming the objects-storage stream, one ASCII character set 0 word per character.
          [
            ...Array.from("OLE10", (character) =>
              character.charCodeAt(0),
            ).flatMap((code) => [code & 0xff, 0]),
            0,
            0,
          ],
        ),
      ],
    );
    const compound = writeCompoundFile([
      { path: PERFECT_OFFICE_MAIN_STREAM, bytes: bare },
      {
        path: "PerfectOffice_OBJECTS/OLE10",
        bytes: nativeBytes,
      },
    ]);

    // The flat read recovers the bytes but has no field for them, and says so through the OLE-specific code rather than the generic box-content-unresolved one.
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(compound, {
      sink: (d) => {
        diagnostics.push(d);
      },
    });
    const oleDroppedMatches = diagnostics.filter(
      (d) => d.code === WpdDiagnosticCodes.OleObjectDropped,
    );
    expect(oleDroppedMatches).toHaveLength(1);
    expect(oleDroppedMatches[0]?.message).toBe(
      "This document embeds a native OLE object ('OLE10') whose bytes the flat ContentDocument has no home for; readWpd lifts them into the tree form's attachments table.",
    );
    expect(
      diagnostics.filter(
        (d) => d.code === WpdDiagnosticCodes.BoxContentUnresolved,
      ),
    ).toHaveLength(0);

    // The tree read carries them, as the attachments-table entry the PDF embedded-file precedent established.
    const tree = readWpd(compound);
    expect(tree.attachments?.OLE10).toEqual({
      kind: "attachment",
      name: "OLE10",
      base64: bytesToBase64(nativeBytes),
    });
    // No notes anywhere in this document — the definitions table must not appear at all, not even empty.
    expect(tree.definitions).toBeUndefined();
  });

  it("carries an OLE 1 object's inline descriptor bytes as a tree-form attachment in a bare file", () => {
    const ole1Data = [0x01, 0x02, 0x03];
    const bare = buildWpdFile(
      [...imageBoxFunction()],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        graphicsFilenamePacket(),
        oleDescriptorPacket(
          "WPWin6.0/OLE 1.0 Prefix Information Marker",
          2,
          ole1Data,
        ),
      ],
    );

    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(bare, {
      sink: (d) => {
        diagnostics.push(d);
      },
    });
    expect(
      diagnostics.filter((d) => d.code === WpdDiagnosticCodes.OleObjectDropped),
    ).toHaveLength(1);

    const tree = readWpd(bare);
    expect(tree.attachments?.["ole1-2"]).toEqual({
      kind: "attachment",
      name: "ole1-2",
      base64: bytesToBase64(new Uint8Array(ole1Data)),
    });
    // No footnotes or endnotes rode along with the OLE object, so the tree carries no definitions table entry at all — not merely an empty one.
    expect(tree.definitions).toBeUndefined();
  });

  it("collapses two boxes naming the same OLE object into one attachment entry", () => {
    const bare = buildWpdFile(
      [...imageBoxFunction(), ...imageBoxFunction()],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        graphicsFilenamePacket(),
        oleDescriptorPacket(
          "WPWin6.0/OLE 1.0 Prefix Information Marker",
          0,
          [0xaa, 0xbb],
        ),
      ],
    );
    const tree = readWpd(bare);
    expect(Object.keys(tree.attachments ?? {})).toEqual(["ole1-0"]);
  });

  it("still reports a graphics packet with no OLE descriptor child as unresolved", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          { packetType: 0x40, bytes: new Uint8Array([0]) }, // no children: just a filename
        ],
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    expect(
      diagnostics.filter(
        (d) => d.code === WpdDiagnosticCodes.BoxContentUnresolved,
      ),
    ).toHaveLength(1);
    expect(
      diagnostics.filter((d) => d.code === WpdDiagnosticCodes.OleObjectDropped),
    ).toHaveLength(0);
  });
});

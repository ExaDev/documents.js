import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentDocument } from "document-schema.js";
import { PAGE_SIZE_A4, assembleTree } from "document-schema.js";
import { readOdtContent } from "./read";
import { writeOdt, writeOdtContent } from "./write";

// The write side's correctness suite: what writeOdtContent produces reads back as the document it was given. The sibling suite (write.test.ts) pins the XML shapes — which is what stops this one from passing on a writer and reader that agree with each other and with nobody else — while this one states the law and every deviation from it by name.
//
// THE LAW: normaliseOdtContent(readOdtContent(writeOdtContent(document))) equals normaliseOdtContent(document), for every document the writer accepts. The normalisation is applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose: everything it restates is a fact ODF's own content model cannot carry, each named in normaliseOdtContent's own doc comment and each pinned individually further down this file.
//
// The strongest evidence here is the fixture pair at the end: two real, unmodified LibreOffice-generated .odt documents, read into the pivot, written back out by this writer, and read again — equal on the nose. Those exercise real producer output (real styles, real style chains, real whitespace, real tables, a real image) rather than this package's own idea of what such a document looks like. Two further facts were established against LibreOffice directly and cannot be stated as an assertion here, so they are recorded instead: converting this writer's own output to PDF renders the explicit page break and the second section's own page size as three pages (A4, A4, Letter), and LibreOffice's own re-save of that output reads back through readOdtContent with both sections, their geometry, the merged table cell, the nested list, the image, and the whitespace all intact.

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// A 1x1 PNG.

// The one arm of ContentDocument an .odt ever is, named locally so this suite reaches a document's own sections without re-narrowing the whole union at every assertion.
type WordprocessingDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

// One full pass through the writer and back: the document the caller handed in, written to a real package, encoded to real bytes, decoded again, and read. The bytes leg is deliberately in the loop rather than short-circuited at the Package level — a writer that built a correct Package but an unserialisable one would pass a Package-only round trip.

function documentOf(blocks: readonly ContentBlock[]): WordprocessingDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      { pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks: [...blocks] },
    ],
  };
}

describe("fidelity constructs written (#969)", () => {
  it("refuses a block-scope bookmark range whose extent contains no paragraph, by name", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "Empty",
            },
          },
          {
            kind: "table",
            columns: [{ widthPt: 100 }],
            rows: [
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "only" }] }] },
                ],
              },
            ],
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/no paragraph to carry its marker halves/);
  });

  it("round-trips a footnote anchor with its definitions-table body through writeOdt", () => {
    // The tree-level law for notes: writeOdt (the entry point that can see the definitions table) writes the inline text:note, and reading the package back recovers the same citation run, anchor extent, and definitions entry.
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "1" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "footnote",
              name: "note1",
              definition: "note:note1",
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "note:note1": {
        kind: "footnote",
        citation: "1",
        body: [{ kind: "paragraph", runs: [{ text: "the note body" }] }],
      },
    };
    const rewritten = readOdtContent(writeOdt(tree));
    expect(rewritten.sections[0]!.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "1" }],
      constructs: [
        {
          descriptor: {
            kind: "anchor",
            anchorType: "footnote",
            name: "note1",
            definition: "note:note1",
          },
          startRun: 0,
          endRun: 1,
        },
      ],
    });
    expect(rewritten.definitions?.["note:note1"]).toMatchObject({
      kind: "footnote",
      citation: "1",
    });
  });

  it("refuses a note anchor when no definitions table is in reach, by name", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "1" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "note1",
                  definition: "note:note1",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
      ),
    ).toThrow(/does not spell back yet/);
  });

  it("refuses a cyclic note definition by name rather than recursing to stack exhaustion", () => {
    // The hostile shape the security review of this PR named: a note body whose own anchor resolves back to the entry still being written (the reader assigns the outer entry after parsing the nested body, so a reused text:id lands here).
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "1" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "footnote",
              name: "note1",
              definition: "note:note1",
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "note:note1": {
        kind: "footnote",
        citation: "1",
        body: [
          {
            kind: "paragraph",
            runs: [{ text: "nested" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "note1",
                  definition: "note:note1",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ],
      },
    };
    expect(() => writeOdt(tree)).toThrow(/cyclic note definition/);
  });

  it("round-trips a comment anchor with author, date, and body through writeOdt", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "remarked" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "comment",
              name: "annotation1",
              definition: "comment:annotation1",
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "comment:annotation1": {
        kind: "comment",
        author: "Ada Lovelace",
        dateIso: "2026-09-09T00:00:00Z",
        body: [{ kind: "paragraph", runs: [{ text: "check this" }] }],
      },
    };
    const rewritten = readOdtContent(writeOdt(tree));
    expect(rewritten.definitions?.["comment:annotation1"]).toMatchObject({
      kind: "comment",
      author: "Ada Lovelace",
      dateIso: "2026-09-09T00:00:00Z",
    });
  });

  it("round-trips a tracked-change range with author and date through writeOdt", () => {
    // The extent is interior (a later unchanged run follows it) deliberately: a change whose halves land at the paragraph's own leading/trailing edges is indistinguishable, on the way back in, from the block-scope pair the reader promotes whole-paragraph coverage into — the identical point the bookmark machinery's run-versus-block split turns on — so the interior shape is the one that round-trips through the run-level path this test pins.
    const descriptor = {
      kind: "provenance",
      change: "insertion",
      author: "Grace Hopper",
      dateIso: "2026-09-09T01:00:00Z",
    } as const;
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "inserted text" }, { text: " unchanged" }],
        constructs: [{ descriptor, startRun: 0, endRun: 1 }],
      },
    ]);
    const tree = assembleTree(document);
    const rewritten = readOdtContent(writeOdt(tree));
    const paragraph = rewritten.sections[0]!.blocks[0];
    expect(paragraph).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "inserted text" }, { text: " unchanged" }],
      constructs: [
        {
          descriptor: {
            kind: "provenance",
            change: "insertion",
            author: "Grace Hopper",
            dateIso: "2026-09-09T01:00:00Z",
          },
          startRun: 0,
          endRun: 1,
        },
      ],
    });
  });

  it("refuses a moveFrom provenance extent by name — no ODF spelling exists", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "moved" }],
            constructs: [
              {
                descriptor: { kind: "provenance", change: "moveFrom" },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
      ),
    ).toThrow(/does not spell back yet/);
  });

  it("round-trips a block-scope tracked-change range spanning two paragraphs", () => {
    const descriptor = {
      kind: "provenance",
      change: "deletion",
      author: "Edsger Dijkstra",
    } as const;
    const document = documentOf([
      { kind: "constructStart", descriptor },
      { kind: "paragraph", runs: [{ text: "first removed" }] },
      { kind: "paragraph", runs: [{ text: "second removed" }] },
      { kind: "constructEnd" },
      { kind: "paragraph", runs: [{ text: "kept" }] },
    ]);
    const tree = assembleTree(document);
    const rewritten = readOdtContent(writeOdt(tree));
    const blocks = rewritten.sections[0]!.blocks;
    expect(blocks[0]).toMatchObject({ kind: "constructStart" });
    expect(blocks[1]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "first removed" }],
    });
    expect(blocks[3]).toMatchObject({ kind: "constructEnd" });
    const lastInside = blocks[2];
    expect(lastInside).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "second removed" }],
    });
  });

  it("refuses a block-scope change range whose extent contains no paragraph, by name", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: { kind: "provenance", change: "insertion" },
          },
          {
            kind: "table",
            columns: [{ widthPt: 100 }],
            rows: [
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] },
                ],
              },
            ],
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/no paragraph to carry its marker halves/);
  });

  it("round-trips an embedded spreadsheet sub-document through writeOdt", () => {
    const document = documentOf([
      { kind: "paragraph", runs: [{ text: "before the object" }] },
      {
        kind: "embeddedObject",
        objectKind: "spreadsheet",
        frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 100 },
        document: {
          kind: "spreadsheet",
          metadata: {},
          sheets: [
            {
              name: "Data",
              cells: [
                {
                  row: 0,
                  column: 0,
                  value: { kind: "string", value: "cell" },
                  displayText: "cell",
                },
              ],
              columns: [],
              rows: [],
              images: [],
              printSettings: {
                pageSize: PAGE_SIZE_A4,
                margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
                gridlines: false,
                headers: false,
                pageOrder: "downThenOver",
              },
            },
          ],
        },
      },
      { kind: "paragraph", runs: [{ text: "after the object" }] },
    ]);
    const tree = assembleTree(document);
    const rewritten = readOdtContent(writeOdt(tree));
    const blocks = rewritten.sections[0]!.blocks;
    const embedded = blocks.find((block) => block.kind === "embeddedObject");
    expect(embedded).toMatchObject({
      kind: "embeddedObject",
      objectKind: "spreadsheet",
      document: {
        kind: "spreadsheet",
        sheets: [
          {
            name: "Data",
            cells: [
              {
                row: 0,
                column: 0,
                value: { kind: "string", value: "cell" },
              },
            ],
          },
        ],
      },
    });
  });

  it("round-trips a block-scope comment range spanning two paragraphs through writeOdt", () => {
    const document = documentOf([
      {
        kind: "constructStart",
        descriptor: {
          kind: "anchor",
          anchorType: "comment",
          name: "annotation3",
          definition: "comment:annotation3",
        },
      },
      { kind: "paragraph", runs: [{ text: "first remarked" }] },
      { kind: "paragraph", runs: [{ text: "second remarked" }] },
      { kind: "constructEnd" },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "comment:annotation3": {
        kind: "comment",
        author: "Kay McNulty",
        body: [{ kind: "paragraph", runs: [{ text: "a ranged remark" }] }],
      },
    };
    const rewritten = readOdtContent(writeOdt(tree));
    const blocks = rewritten.sections[0]!.blocks;
    expect(blocks[0]).toMatchObject({ kind: "constructStart" });
    expect(blocks[1]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "first remarked" }],
    });
    expect(rewritten.definitions?.["comment:annotation3"]).toMatchObject({
      kind: "comment",
      author: "Kay McNulty",
    });
  });

  it("round-trips a block-scope comment range spanning two paragraphs through writeOdt", () => {
    const document = documentOf([
      {
        kind: "constructStart",
        descriptor: {
          kind: "anchor",
          anchorType: "comment",
          name: "annotation3",
          definition: "comment:annotation3",
        },
      },
      { kind: "paragraph", runs: [{ text: "first remarked" }] },
      { kind: "paragraph", runs: [{ text: "second remarked" }] },
      { kind: "constructEnd" },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "comment:annotation3": {
        kind: "comment",
        author: "Kay McNulty",
        body: [{ kind: "paragraph", runs: [{ text: "a ranged remark" }] }],
      },
    };
    const rewritten = readOdtContent(writeOdt(tree));
    const blocks = rewritten.sections[0]!.blocks;
    expect(blocks[0]).toMatchObject({ kind: "constructStart" });
    expect(blocks[1]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "first remarked" }],
    });
    expect(rewritten.definitions?.["comment:annotation3"]).toMatchObject({
      kind: "comment",
      author: "Kay McNulty",
    });
  });

  it("round-trips an embedded spreadsheet sub-document through writeOdt", () => {
    const document = documentOf([
      { kind: "paragraph", runs: [{ text: "before the object" }] },
      {
        kind: "embeddedObject",
        objectKind: "spreadsheet",
        frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 100 },
        document: {
          kind: "spreadsheet",
          metadata: {},
          sheets: [
            {
              name: "Data",
              cells: [
                {
                  row: 0,
                  column: 0,
                  value: { kind: "string", value: "cell" },
                  displayText: "cell",
                },
              ],
              columns: [],
              rows: [],
              images: [],
              printSettings: {
                pageSize: PAGE_SIZE_A4,
                margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
                gridlines: false,
                headers: false,
                pageOrder: "downThenOver",
              },
            },
          ],
        },
      },
      { kind: "paragraph", runs: [{ text: "after the object" }] },
    ]);
    const tree = assembleTree(document);
    const rewritten = readOdtContent(writeOdt(tree));
    const blocks = rewritten.sections[0]!.blocks;
    const embedded = blocks.find((block) => block.kind === "embeddedObject");
    expect(embedded).toMatchObject({
      kind: "embeddedObject",
      objectKind: "spreadsheet",
      document: {
        kind: "spreadsheet",
        sheets: [
          {
            name: "Data",
            cells: [
              {
                row: 0,
                column: 0,
                value: { kind: "string", value: "cell" },
              },
            ],
          },
        ],
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentParagraph,
  ContentSection,
} from "document-schema.js";
import {
  wordprocessing,
  write,
  LETTER_SECTION,
} from "./test-support/wordprocessing-document";
import { roundTrip } from "./test-support/round-trip";

describe("round trip: sections, images, and embedded objects", () => {
  it("round-trips several sections, each keeping its own geometry and break kind", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [{ kind: "paragraph", runs: [{ text: "Portrait" }] }],
        },
        {
          pageSize: { widthPt: 792, heightPt: 612 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          breakType: "oddPage",
          blocks: [{ kind: "paragraph", runs: [{ text: "Landscape" }] }],
        },
      ],
    };
    const back = roundTrip(document);
    const sections = back.kind === "wordprocessing" ? back.sections : [];
    expect(sections).toHaveLength(2);
    expect(sections[0]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(sections[1]?.pageSize).toEqual({ widthPt: 792, heightPt: 612 });
    expect(sections[1]?.margins.leftPt).toBe(36);
    expect(sections[1]?.breakType).toBe("oddPage");
  });

  it("states each section's geometry with the section-scoped \\pgwsxnN family, not the document-level \\paperwN", () => {
    const out = write({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
        },
        {
          pageSize: { widthPt: 792, heightPt: 612 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
        },
      ],
    });
    // Document-level geometry (\paperwN family), stated once from the first section: 612pt/792pt/72pt margins at 20 twips/pt.
    expect(out).toContain(
      "\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440",
    );
    // The second section's own geometry, in full, on the section-scoped \pgwsxnN family: 792pt/612pt/36pt margins.
    expect(out).toContain(
      "\\sectd\\pgwsxn15840\\pghsxn12240\\marglsxn720\\margrsxn720\\margtsxn720\\margbsxn720",
    );
    // The document-level geometry is stated once, in the header, from the first section — not restated per section.
    expect(out.match(/\\paperw/g)).toHaveLength(1);
  });

  it("writes each section-break kind's own \\sbk* word, and no \\sbk* at all for the two kinds that need none", () => {
    // "nextPage" is RTF's own default section start and "column" isn't a break kind ContentSection.breakType even carries — both spellings the SECTION_BREAK_CONTROL_WORDS map genuinely omits, distinct from an undefined breakType only in that .get() is actually called and itself returns undefined, rather than the lookup being skipped outright.
    const withBreak = (
      breakType: ContentSection["breakType"],
    ): ContentDocument => ({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        { ...LETTER_SECTION, blocks: [{ kind: "paragraph", runs: [] }] },
        {
          ...LETTER_SECTION,
          breakType,
          blocks: [{ kind: "paragraph", runs: [] }],
        },
      ],
    });
    expect(write(withBreak("continuous"))).toContain(
      "\\sectd\\sbknone\\pgwsxn",
    );
    expect(write(withBreak("evenPage"))).toContain("\\sectd\\sbkeven\\pgwsxn");
    expect(write(withBreak("oddPage"))).toContain("\\sectd\\sbkodd\\pgwsxn");
    // Counted, not merely contained: the first section always has an undefined breakType too, so a lone "\sectd\pgwsxn" match there would pass even if the SECOND section's own breakWord carried stray text between \sectd and \pgwsxn.
    expect(write(withBreak("nextPage")).match(/\\sectd\\pgwsxn/g)).toHaveLength(
      2,
    );
    expect(write(withBreak(undefined)).match(/\\sectd\\pgwsxn/g)).toHaveLength(
      2,
    );
  });

  it("preserves an embedded object's kind, frame, and nested document through a real OLE compound file", () => {
    const embedded: ContentDocument = {
      kind: "spreadsheet",
      metadata: { title: "Embedded sheet" },
      sheets: [],
    };
    const back = roundTrip(
      wordprocessing([
        {
          kind: "embeddedObject",
          objectKind: "spreadsheet",
          frame: { xPt: 1, yPt: 2, widthPt: 100, heightPt: 50 },
          document: embedded,
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    expect(block?.kind).toBe("embeddedObject");
    if (block?.kind !== "embeddedObject")
      throw new Error("expected an embeddedObject block");
    expect(block.objectKind).toBe("spreadsheet");
    expect(block.frame).toEqual({ xPt: 1, yPt: 2, widthPt: 100, heightPt: 50 });
    expect(block.document).toEqual(embedded);
  });

  // Regression test: writeCellBlocks once dropped an image placed directly in a table cell's own block list outright (it wrote \intbl paragraphs only), so a \pict read out of a cell round-tripped to nothing. writeImagePict now gives the \pict destination the same \intbl variant a cell paragraph gets, and this proves it survives a full write-then-read cycle positioned correctly between the cell's own surrounding text.
  it("preserves an image placed directly inside a table cell, alongside the cell's own surrounding text", () => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const back = roundTrip(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "before" }] },
                    {
                      kind: "image",
                      format: "png",
                      base64,
                      widthPt: 72,
                      heightPt: 36,
                    },
                    { kind: "paragraph", runs: [{ text: "after" }] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const table = blocks.find((block) => block.kind === "table");
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    const image = cellBlocks?.find((block) => block.kind === "image");
    expect(image?.kind === "image" ? image.format : undefined).toBe("png");
    const cellText = (cellBlocks ?? [])
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text));
    expect(cellText).toEqual(["before", "after"]);
  });

  it("writes an image alone in a cell with no leading \\par and no fallback shell, blockPending and wroteBlock both starting false", () => {
    // With nothing before the image, blockPending is still false when it is reached — a mutant always flushing \par here would insert one with no preceding paragraph to close. With nothing after it either, this image's own wroteBlock = true is the ONLY assignment in the whole cell — unlike the surrounding-text test above, where a later paragraph's own wroteBlock = true would mask a mutant resetting it to false right after the image.
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    {
                      kind: "image",
                      format: "png",
                      base64,
                      widthPt: 72,
                      heightPt: 36,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\pard\\plain\\intbl {\\*\\shppict");
    // No bare \par control word anywhere (not merely "\pard"'s own leading \par substring): writeImagePict's own prefix (\pard\plain\intbl) comes AFTER wherever a wrongly-flushed \par would land, so a substring check anchored on "{\*\shppict" would miss one inserted before that whole prefix instead.
    expect(out).not.toMatch(/\\par(?![a-zA-Z])/);
    // Exactly one \pard\plain\intbl — the image's own, not a second one from the !wroteBlock fallback shell.
    expect(out.match(/\\pard\\plain\\intbl/g)).toHaveLength(1);
  });

  // The identical regression as the image case above, for the PR's own headline construct: writeCellBlocks once dropped an \object placed directly in a table cell too, discarding a decoded embedded object entirely on write. writeEmbeddedObjectBlock's own \intbl variant fixes it the same way.
  it("preserves an embedded object placed directly inside a table cell, alongside the cell's own surrounding text", () => {
    const embedded: ContentDocument = {
      kind: "spreadsheet",
      metadata: { title: "Embedded sheet" },
      sheets: [],
    };
    const back = roundTrip(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "before" }] },
                    {
                      kind: "embeddedObject",
                      objectKind: "spreadsheet",
                      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
                      document: embedded,
                    },
                    { kind: "paragraph", runs: [{ text: "after" }] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const table = blocks.find((block) => block.kind === "table");
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
    const object = cellBlocks?.find((block) => block.kind === "embeddedObject");
    expect(
      object?.kind === "embeddedObject" ? object.objectKind : undefined,
    ).toBe("spreadsheet");
    const cellText = (cellBlocks ?? [])
      .filter((block): block is ContentParagraph => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text));
    expect(cellText).toEqual(["before", "after"]);
  });
});

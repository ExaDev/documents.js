import { describe, expect, it } from "vitest";
import type { ContentDocument } from "document-schema.js";
import {
  wordprocessing,
  LETTER_SECTION,
} from "./test-support/wordprocessing-document";
import { roundTrip } from "./test-support/round-trip";

describe("round trip: core scalar and geometry properties", () => {
  it("preserves verticalAlign through the \\super/\\sub on-spellings", () => {
    // sizePt stated explicitly because the written form always states font size (RTF has no sizeless run), so the read-back carries it.
    const document = wordprocessing([
      {
        kind: "paragraph",
        runs: [
          { text: "x", sizePt: 12 },
          { text: "2", verticalAlign: "superscript", sizePt: 12 },
          { text: " and H", sizePt: 12 },
          { text: "2", verticalAlign: "subscript", sizePt: 12 },
          { text: "O", sizePt: 12 },
        ],
      },
    ]);
    const back = roundTrip(document);
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(paragraph?.kind === "paragraph" ? paragraph.runs : []).toEqual(
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks[0]?.kind === "paragraph"
          ? document.sections[0].blocks[0].runs
          : []
        : [],
    );
  });

  it("preserves direction at all four scopes RTF states it", () => {
    // sizePt stated explicitly on the runs because the written form always states font size, so the read-back carries it.
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: { direction: "rtl" },
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [
            {
              kind: "paragraph",
              direction: "rtl",
              runs: [
                { text: "a", direction: "rtl", sizePt: 12 },
                { text: "b", direction: "ltr", sizePt: 12 },
              ],
            },
            {
              kind: "table",
              columns: [{ widthPt: 72 }],
              rows: [
                {
                  direction: "rtl",
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "A", sizePt: 12 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const back = roundTrip(document);
    if (back.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(back.metadata.direction).toBe("rtl");
    const blocks = back.sections[0]?.blocks ?? [];
    const paragraph = blocks[0]?.kind === "paragraph" ? blocks[0] : undefined;
    expect(paragraph?.direction).toBe("rtl");
    expect(paragraph?.runs.map((run) => run.direction)).toEqual(["rtl", "ltr"]);
    const table = blocks[1]?.kind === "table" ? blocks[1] : undefined;
    expect(table?.rows[0]?.direction).toBe("rtl");
  });

  it("preserves cell verticalAlign, with an explicit 'top' collapsing into the absence that already means it", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [
            {
              kind: "table",
              columns: [{ widthPt: 72 }, { widthPt: 72 }, { widthPt: 72 }],
              rows: [
                {
                  cells: [
                    {
                      verticalAlign: "center",
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "A", sizePt: 12 }],
                        },
                      ],
                    },
                    {
                      verticalAlign: "bottom",
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "B", sizePt: 12 }],
                        },
                      ],
                    },
                    {
                      verticalAlign: "top",
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "C", sizePt: 12 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const back = roundTrip(document);
    const blocks =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : undefined;
    const table = blocks?.[0]?.kind === "table" ? blocks[0] : undefined;
    expect(table?.rows[0]?.cells.map((cell) => cell.verticalAlign)).toEqual([
      "center",
      "bottom",
      undefined,
    ]);
  });

  it("preserves paragraph text and character formatting", () => {
    const document = wordprocessing([
      {
        kind: "paragraph",
        runs: [
          { text: "plain ", sizePt: 12 },
          { text: "bold", bold: true, sizePt: 12 },
          { text: " and ", sizePt: 12 },
          { text: "italic", italic: true, sizePt: 12 },
        ],
      },
    ]);
    const back = roundTrip(document);
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(paragraph?.kind === "paragraph" ? paragraph.runs : []).toEqual(
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks[0]?.kind === "paragraph"
          ? document.sections[0].blocks[0].runs
          : []
        : [],
    );
  });

  it("preserves non-ASCII text through the \\uN escape", () => {
    const back = roundTrip(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "naïve Ω 日本語", sizePt: 12 }] },
      ]),
    );
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("naïve Ω 日本語");
  });

  it("preserves a heading's level and a list's marker type", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Head", sizePt: 12 }],
          headingLevel: 2,
        },
        {
          kind: "paragraph",
          runs: [{ text: "Item", sizePt: 12 }],
          list: { numId: "rtf1:bullet", level: 0 },
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const heading = blocks[0];
    const item = blocks[1];
    expect(
      heading?.kind === "paragraph" ? heading.headingLevel : undefined,
    ).toBe(2);
    expect(item?.kind === "paragraph" ? item.list : undefined).toEqual({
      numId: "rtf1:bullet",
      level: 0,
    });
  });

  it("preserves a table's shape and cell text", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }, { widthPt: 144 }],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "A", sizePt: 12 }] },
                  ],
                },
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "B", sizePt: 12 }] },
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
    expect(
      table?.kind === "table" ? table.columns.map((c) => c.widthPt) : undefined,
    ).toEqual([72, 144]);
    expect(
      table?.kind === "table" ? table.rows[0]?.cells.length : undefined,
    ).toBe(2);
  });

  it("preserves a hyperlink's target", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            {
              text: "link",
              hyperlink: "https://example.com/a?b=1",
              sizePt: 12,
            },
          ],
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const paragraph = blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.find((run) => run.hyperlink !== undefined)?.hyperlink
        : undefined,
    ).toBe("https://example.com/a?b=1");
  });

  it("preserves the section's page geometry and the document's metadata", () => {
    const back = roundTrip(
      wordprocessing(
        [{ kind: "paragraph", runs: [{ text: "x", sizePt: 12 }] }],
        {
          title: "T",
          author: "A",
        },
      ),
    );
    expect(back.metadata).toEqual({ title: "T", author: "A" });
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    expect(section?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section?.margins).toEqual(LETTER_SECTION.margins);
  });
});

import { describe, expect, it } from "vitest";
import { readDocContent } from "./read";
import { buildDoc } from "./test-support/doc";

describe("readNoteBodies", () => {
  it("round-trips footnotes, comments, and endnotes with correctly ordered subdocument boundaries", () => {
    // A non-empty headerFooterStories document (Plcfhdd, between the footnote and comment documents in [MS-DOC] 2.4.1's own concatenation order) gives ccpHdd a genuinely non-zero value, so commentStartCp's own headerStartCp + ccpHdd actually depends on the sign of that addition rather than adding zero either way.
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      sectionGrpprl: [],
      footnotes: [[{ runs: [{ text: "Footnote text" }] }]],
      headerFooterStories: [
        [],
        [],
        [],
        [],
        [],
        [],
        [{ runs: [{ text: "Header text" }] }],
        [],
        [],
        [],
        [],
        [],
      ],
      comments: [[{ runs: [{ text: "Comment text" }] }]],
      endnotes: [[{ runs: [{ text: "Endnote text" }] }]],
    });
    const doc = readDocContent(bytes);
    expect(doc.footnotes).toEqual([{ id: "1", text: "Footnote text" }]);
    expect(doc.comments).toEqual([{ id: "1", text: "Comment text" }]);
    expect(doc.endnotes).toEqual([{ id: "1", text: "Endnote text" }]);
    const header = doc.headerFooterStories.find(
      (story) => story.slot === "evenHeader",
    );
    expect(header).toBeDefined();
  });

  it("assigns sequential one-based ids to multiple stories of the same kind, in document order", () => {
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      footnotes: [
        [{ runs: [{ text: "First" }] }],
        [{ runs: [{ text: "Second" }] }],
        [{ runs: [{ text: "Third" }] }],
      ],
    });
    const doc = readDocContent(bytes);
    expect(doc.footnotes.map((footnote) => footnote.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(doc.footnotes.map((footnote) => footnote.text)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("reports no footnotes/comments/endnotes at all when the document carries none", () => {
    const doc = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "Plain" }] }] }),
    );
    expect(doc.footnotes).toEqual([]);
    expect(doc.comments).toEqual([]);
    expect(doc.endnotes).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { readMarkdownContent } from "../markdown/read";
import { richMarkdownText, richMarkdownTextWithFrontMatter } from "./markdown";

// richMarkdownText/richMarkdownTextWithFrontMatter are hand-authored literal markdown source text (see their own top-of-file comment), joined from an array of lines including several deliberately blank ("") separator lines between blocks. A blank line is a genuine CommonMark block boundary, so these assert the fixture actually parses into DISTINCT top-level blocks rather than merging into fewer, larger ones -- the only way a corrupted separator (anything other than a real blank line) would show up.

describe("richMarkdownText", () => {
  it("parses into four distinct top-level blocks: heading, paragraph, list, table", () => {
    const content = readMarkdownContent(richMarkdownText());
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = content.sections[0]?.blocks ?? [];
    // The heading, the second paragraph, then one paragraph per list item (markdown-codec's own flat block model has no dedicated "list" block kind -- each item is its own paragraph, with list membership carried on the paragraph itself), then the table.
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "table",
    ]);
    expect(blocks[0]).toMatchObject({ styleId: "Heading1" });
    // Exact per-block text -- proof each blank-line separator genuinely separated two blocks rather than merging stray text into one of them (CommonMark merges consecutive non-blank lines of plain text into a single paragraph, so a corrupted separator would silently widen one paragraph's own text rather than changing the block kind sequence above at all).
    function text(block: (typeof blocks)[number]): string {
      return block.kind === "paragraph"
        ? block.runs.map((run) => run.text).join("")
        : "";
    }
    expect(text(blocks[0]!)).toBe("Report Title");
    expect(text(blocks[1]!)).toBe(
      "Second paragraph with bold and italic text.",
    );
    expect(text(blocks[2]!)).toBe("First item");
  });
});

describe("richMarkdownTextWithFrontMatter", () => {
  it("separates the closing --- from the body, parsing metadata and richMarkdownText's own four blocks separately", () => {
    const content = readMarkdownContent(richMarkdownTextWithFrontMatter(), {
      frontMatter: true,
    });
    expect(content.metadata.title).toBe("Sample Report");
    expect(content.metadata.author).toBe("Ada Lovelace");
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = content.sections[0]?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "table",
    ]);
  });
});

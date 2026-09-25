// The raw-HTML, front-matter, diagnostic-gap and assertNever suites split from lower.test.ts, sharing its blocks/paragraph harness.

import { assertNeverMarkdownBlock, lowerMarkdown } from "./lower";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { createDiagnosticCollector } from "../test-support/diagnostics";

function blocks(
  source: string,
  options: Parameters<typeof lowerMarkdown>[1] = {},
): ContentBlock[] {
  const doc = lowerMarkdown(source, options);
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing ContentDocument");
  }
  return doc.sections[0]?.blocks ?? [];
}

function paragraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error(`expected a paragraph block, got ${block?.kind}`);
  }
  return block;
}

describe("raw HTML", () => {
  it("preserves block-level HTML as literal text by default, styled HTMLPreformatted, with the verbatim source quarantined as markdown residue on the paragraph", () => {
    const block = paragraph(blocks("<div>\nfoo\n</div>\n\nafter")[0]);
    expect(block.styleId).toBe("HTMLPreformatted");
    expect(block.runs[0]?.text).toContain("<div>");
    expect(block.source).toEqual({
      format: "markdown",
      xml: "<div>\nfoo\n</div>",
    });
  });

  it("keeps the whole block as one run of its own verbatim text, internal line endings included, matching the residue exactly", () => {
    const block = paragraph(blocks("<div>\nfoo\n</div>\n\nafter")[0]);
    expect(block.runs).toEqual([{ text: "<div>\nfoo\n</div>" }]);
    expect(block.source).toEqual({
      format: "markdown",
      xml: "<div>\nfoo\n</div>",
    });
  });

  it("names the preserved-as-text gap, and where the verbatim original went, in the RAW_HTML_PRESERVED_AS_TEXT message", () => {
    const collector = createDiagnosticCollector();
    blocks("<div>\nfoo\n</div>", { sink: collector.sink });
    const diagnostic = collector.diagnostics.find(
      (entry) =>
        entry.code === MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT,
    );
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.message).toContain(
      "block-level raw HTML was preserved as literal text",
    );
    expect(diagnostic?.message).toContain("markdown residue");
  });

  it("names the option that discarded the block in the RAW_HTML_DROPPED message", () => {
    const collector = createDiagnosticCollector();
    blocks("<div>\nfoo\n</div>", { sink: collector.sink, rawHtml: "drop" });
    const diagnostic = collector.diagnostics.find(
      (entry) => entry.code === MarkdownDiagnosticCodes.RAW_HTML_DROPPED,
    );
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.message).toContain(
      'block-level raw HTML was dropped per the rawHtml: "drop" option',
    );
  });

  it("reports LIST_ITEM_BLOCK_UNLISTED for a recognised HTML table directly inside a list item, naming that gap in the message", () => {
    const collector = createDiagnosticCollector();
    const result = blocks("- <table>\n  <tr><td>x</td></tr>\n  </table>", {
      sink: collector.sink,
    });
    expect(result.map((block) => block.kind)).toEqual(["table"]);
    const diagnostic = collector.diagnostics.find(
      (entry) =>
        entry.code === MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED,
    );
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.message).toContain(
      "an HTML-table block directly inside a list item",
    );
  });

  it("reports nothing of the sort for a recognised HTML table outside any list", () => {
    const collector = createDiagnosticCollector();
    const result = blocks("<table>\n<tr><td>x</td></tr>\n</table>", {
      sink: collector.sink,
    });
    expect(result.map((block) => block.kind)).toEqual(["table"]);
    expect(
      collector.has(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED),
    ).toBe(false);
  });

  it("quarantines inline raw HTML verbatim as markdown residue on each tag's own run — the parser emits one rawHtml node per tag, so the residue is per tag", () => {
    const runs = paragraph(blocks("before <em>raw</em> after")[0]).runs;
    expect(runs[1]?.source).toEqual({ format: "markdown", xml: "<em>" });
    expect(runs[3]?.source).toEqual({ format: "markdown", xml: "</em>" });
    expect(runs[0]?.source).toBeUndefined();
  });

  it('carries no residue when rawHtml: "drop" discards the HTML entirely', () => {
    const block = paragraph(
      blocks("<div>\nfoo\n</div>\n\nafter", { rawHtml: "drop" })[0],
    );
    expect(block.source).toBeUndefined();
  });

  it("recognises a raw HTML <table> block as a real ContentTable (ExaDev/documents.js#1089), ahead of both rawHtml options and opaque preservation", () => {
    const source =
      '<table>\n<tr><th>a</th><th>b</th></tr>\n<tr><td colspan="2">merged</td></tr>\n</table>';
    const block = blocks(source, { rawHtml: "drop" })[0];
    if (block?.kind !== "table") {
      throw new Error(`expected a table block, got '${block?.kind}'`);
    }
    expect(block.rows[1]?.cells[0]?.colSpan).toBe(2);
  });

  it("does not recognise an HTML table when gfmTables is disabled, matching plain GFM pipe-table promotion's own gate — it stays opaque preserved text instead", () => {
    const source = "<table>\n<tr><td>x</td></tr>\n</table>";
    const collector = createDiagnosticCollector();
    const result = blocks(source, {
      gfmTables: false,
      sink: collector.sink,
    });
    expect(result.every((block) => block.kind !== "table")).toBe(true);
    expect(
      collector.has(MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT),
    ).toBe(true);
  });

  it("falls through to opaque preservation for an HTML block that merely starts with <table> but is not, in full, one well-formed table", () => {
    const source = "<table>\nnot really a table\n</table>";
    const collector = createDiagnosticCollector();
    const result = blocks(source, { sink: collector.sink });
    expect(result.every((block) => block.kind !== "table")).toBe(true);
    expect(
      collector.has(MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT),
    ).toBe(true);
  });
});

describe("front matter", () => {
  it("maps a flat-scalar-only subset into LayoutMetadata when frontMatter: true", () => {
    const doc = lowerMarkdown(
      "---\ntitle: Hello\nauthor: Jo\ndate: 2024-01-01\nkeywords: [a, b]\n---\n\nbody",
      { frontMatter: true },
    );
    expect(doc.metadata).toEqual({
      title: "Hello",
      author: "Jo",
      createdIso: "2024-01-01",
      keywords: ["a", "b"],
    });
  });

  it("never sets producer, which has no front matter equivalent", () => {
    const doc = lowerMarkdown("---\ntitle: x\n---\n\nbody", {
      frontMatter: true,
    });
    expect(doc.metadata.producer).toBeUndefined();
  });

  it("maps every other LayoutMetadata string/enum field a front matter line can carry", () => {
    const doc = lowerMarkdown(
      [
        "---",
        "title: Hello",
        "author: Jo",
        "subject: A subject",
        "creator: Producer Co",
        "date: 2024-01-01",
        "modified: 2024-02-02",
        "lastPrinted: 2024-03-03",
        "language: en-GB",
        "direction: rtl",
        "publisher: A Publisher",
        "contributor: A Contributor",
        "rights: All rights reserved",
        "identifier: urn:isbn:0-000-00000-0",
        "comments: A comment",
        "company: A Company",
        "manager: A Manager",
        "keywords: [a, b]",
        "---",
        "",
        "body",
      ].join("\n"),
      { frontMatter: true },
    );
    expect(doc.metadata).toEqual({
      title: "Hello",
      author: "Jo",
      subject: "A subject",
      creator: "Producer Co",
      createdIso: "2024-01-01",
      modifiedIso: "2024-02-02",
      lastPrintedIso: "2024-03-03",
      language: "en-GB",
      direction: "rtl",
      publisher: "A Publisher",
      contributor: "A Contributor",
      rights: "All rights reserved",
      identifier: "urn:isbn:0-000-00000-0",
      comments: "A comment",
      company: "A Company",
      manager: "A Manager",
      keywords: ["a", "b"],
    });
  });

  it("silently skips a direction value outside TextDirectionSchema's own ltr/rtl enum", () => {
    const doc = lowerMarkdown("---\ndirection: sideways\n---\n\nbody", {
      frontMatter: true,
    });
    expect(doc.metadata.direction).toBeUndefined();
  });
});

describe("gaps (MarkdownDiagnosticCodes)", () => {
  it("INVENTED_PAGE_GEOMETRY always fires, once per lowered document", () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown("foo", { sink: collector.sink });
    expect(
      collector
        .codes()
        .filter(
          (code) => code === MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY,
        ),
    ).toHaveLength(1);
  });

  it("NESTED_EMPHASIS_FLATTENED fires for emphasis nested inside emphasis (of either marker)", () => {
    const collector = createDiagnosticCollector();
    const runs = paragraph(
      blocks("_a *b* c_", { sink: collector.sink })[0],
    ).runs;
    expect(
      collector.has(MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED),
    ).toBe(true);
    expect(runs.find((run) => run.text === "b")).toMatchObject({
      italic: true,
    });
  });

  it("LINK_TITLE_DROPPED fires for the one titled shape left with nowhere to ride — a nested image inside a link", () => {
    const collector = createDiagnosticCollector();
    blocks('[![alt](/img.png "t")](/page)', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LINK_TITLE_DROPPED)).toBe(
      true,
    );
  });

  it("MATH_INLINE_PRESERVED_AS_TEXT fires for an inline \\( \\) math span", () => {
    const collector = createDiagnosticCollector();
    blocks("\\(x^2\\)", { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT),
    ).toBe(true);
  });

  it("BLOCKQUOTE_NESTED_DEPTH is retired: nesting beyond level 1 is now exact through nested division pairs, firing nothing beyond the always-on page-geometry note", () => {
    const collector = createDiagnosticCollector();
    blocks("> > nested", { sink: collector.sink });
    expect(
      collector
        .codes()
        .filter(
          (code) => code !== MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY,
        ),
    ).toEqual([]);
  });

  it("LIST_ITEM_BLOCK_UNLISTED fires for a table directly inside a list item", () => {
    const collector = createDiagnosticCollector();
    const result = blocks("- | a | b |\n  | - | - |\n  | 1 | 2 |", {
      sink: collector.sink,
    });
    expect(
      collector.has(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED),
    ).toBe(true);
    expect(result.some((block) => block.kind === "table")).toBe(true);
  });

  it("LIST_MARKER_TYPE_CONFLICT fires when a nested list disagrees with its enclosing list's own minted type", () => {
    const collector = createDiagnosticCollector();
    blocks("- top\n  1. nested\n- top2", { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT),
    ).toBe(true);
  });

  it("LIST_MARKER_TYPE_CONFLICT fires the other way round too, for a nested bullet list under an ordered mint, naming both marker types", () => {
    const collector = createDiagnosticCollector();
    blocks("1. top\n   - nested", { sink: collector.sink });
    const diagnostic = collector.diagnostics.find(
      (entry) =>
        entry.code === MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT,
    );
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain(
      "a nested bullet list sits under a list minted as ordered",
    );
  });

  it("LIST_MARKER_TYPE_CONFLICT stays silent when a nested list's own marker type agrees with the mint, of either type", () => {
    const bullet = createDiagnosticCollector();
    blocks("- top\n  - nested", { sink: bullet.sink });
    expect(bullet.has(MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT)).toBe(
      false,
    );
    const ordered = createDiagnosticCollector();
    blocks("1. top\n   1. nested", { sink: ordered.sink });
    expect(ordered.has(MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT)).toBe(
      false,
    );
  });

  it("LIST_ITEM_BLOCK_UNLISTED names the table gap in its message, and stays silent for a table outside any list", () => {
    const inItem = createDiagnosticCollector();
    blocks("- | a | b |\n  | - | - |\n  | 1 | 2 |", { sink: inItem.sink });
    const diagnostic = inItem.diagnostics.find(
      (entry) =>
        entry.code === MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED,
    );
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.message).toContain(
      "a table directly inside a list item",
    );
    const topLevel = createDiagnosticCollector();
    blocks("| a | b |\n| - | - |\n| 1 | 2 |", { sink: topLevel.sink });
    expect(topLevel.has(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED)).toBe(
      false,
    );
  });

  it("INVENTED_PAGE_GEOMETRY explains the synthesised geometry, and where it came from, in its message", () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown("foo", { sink: collector.sink });
    const diagnostic = collector.diagnostics.find(
      (entry) => entry.code === MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY,
    );
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.message).toContain(
      "markdown carries no page geometry of its own",
    );
    expect(diagnostic?.message).toContain("ReadMarkdownOptions.pageSize");
  });

  it("IMAGE_UNRESOLVED fires for an image with no resolver and degrades to a text run of alt text + hyperlink", () => {
    const collector = createDiagnosticCollector();
    const result = blocks("![alt text](http://example.com/x.png)", {
      sink: collector.sink,
    });
    expect(collector.has(MarkdownDiagnosticCodes.IMAGE_UNRESOLVED)).toBe(true);
    expect(paragraph(result[0]).runs).toEqual([
      { text: "alt text", hyperlink: "http://example.com/x.png" },
    ]);
  });

  it("a resolver-supplied remote image resolves via the MarkdownImageResolver port", () => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (char) => char.codePointAt(0)!,
    );
    const result = blocks("![alt](http://example.com/x.png)", {
      images: () => ({ bytes: png }),
    });
    expect(result.some((block) => block.kind === "image")).toBe(true);
  });

  it("RAW_HTML_PRESERVED_AS_TEXT fires by default", () => {
    const collector = createDiagnosticCollector();
    blocks("<div>\nfoo\n</div>", { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT),
    ).toBe(true);
  });

  it('RAW_HTML_DROPPED fires with rawHtml: "drop"', () => {
    const collector = createDiagnosticCollector();
    blocks("<div>\nfoo\n</div>", { sink: collector.sink, rawHtml: "drop" });
    expect(collector.has(MarkdownDiagnosticCodes.RAW_HTML_DROPPED)).toBe(true);
  });

  it("FRONT_MATTER_KEY_UNMAPPED fires for an unrecognised front matter key", () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown("---\ndraft: true\n---\n\nbody", {
      frontMatter: true,
      sink: collector.sink,
    });
    expect(
      collector.has(MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED),
    ).toBe(true);
  });
});

describe("assertNeverMarkdownBlock", () => {
  it("throws naming the unhandled markdown block, proving lowerBlock's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverMarkdownBlock({ type: "bogus" } as never);
    }).toThrow('markdown-codec: unhandled markdown block {"type":"bogus"}');
  });
});

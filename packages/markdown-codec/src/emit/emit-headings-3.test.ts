// The second half of the setext-promotion heading suites split from emit-headings.test.ts.

// The setext-promotion heading suite split from emit.test.ts: every #940 case lives here, sharing the doc/diagnostics harness that suite restates.

import type { ContentBlock, ContentDocument } from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARGINS } from "../defaults/defaults";
import { lowerMarkdown } from "../lower/lower";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import { emitMarkdown } from "./emit";

function doc(blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      { pageSize: PAGE_SIZE_A4, margins: DEFAULT_MARGINS, blocks: [...blocks] },
    ],
  };
}

describe("headings (continued further)", () => {
  describe("a level-1/2 heading whose own text STARTS with an embedded break stays eligible for setext (ExaDev/documents.js#940)", () => {
    // Unlike a TRAILING break, a LEADING one never leaves a blank line for setext to trip over: it sits BEFORE the heading's own run of text-then-underline lines even begins, so a reparse treats it as ordinary inter-block whitespace ahead of the heading — exactly as a blank line ahead of any other block already works. Refusing setext here would be a strict regression for the escaped-hard-break spelling specifically: escapeMarkdownText always keeps a non-blank backslash on that first line, so the break survives losslessly through setext today, and collapsing to ATX would destroy it (ATX has no representation for a break at all).
    it("still promotes to setext when the leading blank line is a genuinely bare one (a soft-break markdown-residue newline, not the escaped hard-break spelling above) — but, unlike the escaped spelling, absorbs the leading break itself as ordinary space ahead of the heading rather than reproducing it inside the heading (ExaDev/documents.js#940)", () => {
      // Every OTHER test in this describe block uses runs: [{ text: '\n' }, ...] — a HARD break, which escapeMarkdownText always spells with a non-blank leading backslash ('\\\n'), so line 0 of the rendered text is never actually blank and never exercises embedsUnsafeBreakForSetext's own leading-run exemption at all. This one instead uses the bare soft-break residue spelling (src/emit/inline.ts's renderLeaf re-emitting run.source.xml verbatim, unescaped) — the one input shape whose line 0 really is empty, and the only one the leading-run exemption is actually needed for.
      const collector = createDiagnosticCollector();
      const written = emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              { text: " ", source: { format: "markdown", xml: "\n" } },
              { text: "foo" },
            ],
            styleId: "Heading1",
          },
        ]),
        { sink: collector.sink },
      );
      expect(written).toBe("\nfoo\n=");
      const diagnostic = collector.diagnostics.find(
        (d) =>
          d.code ===
          MarkdownDiagnosticCodes.HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK,
      );
      // The diagnostic must not claim the break "survives" for this input — it does not: reparsing below recovers "foo", not "\nfoo".
      expect(diagnostic?.message).toContain("absorbed");
      expect(diagnostic?.message).not.toContain("so the break survives");

      const reparsed = lowerMarkdown(written);
      if (reparsed.kind !== "wordprocessing") {
        throw new Error("expected a wordprocessing ContentDocument");
      }
      const blocks = reparsed.sections[0]?.blocks ?? [];
      // Still exactly one block, still a heading — no corruption — but its own text comes back as plain "foo": the leading blank line is genuinely lost, not merely reformatted, which is why the diagnostic above may not claim it survives.
      expect(blocks).toHaveLength(1);
      const [headingBlock] = blocks;
      if (headingBlock?.kind !== "paragraph") {
        throw new Error("expected a paragraph block");
      }
      expect(headingBlock.styleId).toBe("Heading1");
      expect(headingBlock.runs.map((run) => run.text).join("")).toBe("foo");
    });

    it("refuses to promote a break-free heading whose ENTIRE text is an ordered-list marker not starting at 1 — interruptsSetextParagraph's first-line call must use the genuine block-start sense (any start number counts), not the paragraph-continuation sense (only start-at-1 counts)", () => {
      const collector = createDiagnosticCollector();
      const written = emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              {
                text: "2. foo",
                source: { format: "markdown", xml: "2. foo" },
              },
            ],
            styleId: "Heading1",
          },
        ]),
        { headingStyle: "setext", sink: collector.sink },
      );
      expect(written).toBe("# 2. foo");
      expect(
        collector.has(
          MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        ),
      ).toBe(true);
    });

    it("still safely promotes to setext when a NON-FIRST line is an ordered-list marker not starting at 1 — interruptsSetextParagraph's non-first-line call must use the paragraph-continuation sense (CommonMark's own exception absorbs it as continuation text), not the block-start sense", () => {
      const written = emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              { text: "foo" },
              { text: "\n" },
              {
                text: "2. bar",
                source: { format: "markdown", xml: "2. bar" },
              },
            ],
            styleId: "Heading1",
          },
        ]),
      );
      expect(written).toBe("foo\\\n2. bar\n====");
    });

    it.each([
      { level: "Heading1" as const, underline: "=" },
      { level: "Heading2" as const, underline: "-" },
    ])(
      "still promotes $level to setext and round-trips the leading break losslessly",
      ({ level, underline }) => {
        const collector = createDiagnosticCollector();
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [{ text: "\n" }, { text: "foo" }],
              styleId: level,
            },
          ]),
          { sink: collector.sink },
        );
        expect(written).toBe(`\\\nfoo\n${underline}`);
        const diagnostic = collector.diagnostics.find(
          (d) =>
            d.code ===
            MarkdownDiagnosticCodes.HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK,
        );
        // Unlike the genuinely-absorbed leading-break case above, this break survives losslessly — the diagnostic must say so, not claim it was absorbed.
        expect(diagnostic?.message).toContain("so the break survives");
        expect(diagnostic?.message).not.toContain("absorbed");

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        expect(blocks).toHaveLength(1);
        const [headingBlock] = blocks;
        if (headingBlock?.kind !== "paragraph") {
          throw new Error("expected a paragraph block");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(headingBlock.runs.map((run) => run.text).join("")).toBe("\nfoo");
      },
    );

    it.each([
      { level: "Heading1" as const, underline: "=" },
      { level: "Heading2" as const, underline: "-" },
    ])(
      "still promotes $level to setext and round-trips the leading break losslessly as a list item's own marker line",
      ({ level, underline }) => {
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [{ text: "\n" }, { text: "foo" }],
              styleId: level,
              list: { numId: "md1:bullet", level: 0, itemId: "i1" },
            },
          ]),
        );
        expect(written).toBe(`- \\\n  foo\n  ${underline}`);

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        expect(blocks).toHaveLength(1);
        const [headingBlock] = blocks;
        if (headingBlock?.kind !== "paragraph") {
          throw new Error("expected a paragraph block");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(headingBlock.list).toBeDefined();
        expect(headingBlock.runs.map((run) => run.text).join("")).toBe("\nfoo");
      },
    );

    it.each([
      { level: "Heading1" as const, underline: "=" },
      { level: "Heading2" as const, underline: "-" },
    ])(
      "still promotes $level to setext and round-trips a genuinely bare leading newline (soft-break residue, not the escaped hard-break spelling above) as a list item's own marker line, retaining the item's own list membership",
      ({ level, underline }) => {
        // Every OTHER list-item test in this describe block uses runs: [{ text: '\n' }, ...] — a HARD break, whose escaped '\\\n' spelling never leaves line 0 of the rendered text genuinely blank (see this file's own top-level bare-newline test above for why that never exercises the leading-run exemption at all). This one uses the bare soft-break residue spelling instead, the one shape whose line 0 really is empty and genuinely exercises the exemption inside a list item specifically.
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [
                {
                  text: " ",
                  source: { format: "markdown" as const, xml: "\n" },
                },
                { text: "foo" },
              ],
              styleId: level,
              list: { numId: "md1:bullet", level: 0, itemId: "i1" },
            },
          ]),
        );
        expect(written).toBe(`- \n  foo\n  ${underline}`);

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        // Exactly one block, still carrying its own list membership — a single leading blank line is CommonMark's own documented "a list item can begin with at most one blank line" allowance (spec 0.31.2, section 5.2), so the item's marker line legitimately starts blank without closing the item.
        expect(blocks).toHaveLength(1);
        const [headingBlock] = blocks;
        if (headingBlock?.kind !== "paragraph") {
          throw new Error("expected a paragraph block");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(headingBlock.list).toBeDefined();
        expect(headingBlock.runs.map((run) => run.text).join("")).toBe("foo");
      },
    );

    it.each([{ level: "Heading1" as const }, { level: "Heading2" as const }])(
      "collapses $level to ATX rather than promoting to setext when the heading's own text carries TWO consecutive leading bare newlines as a list item's own marker line, since a second leading blank line would close the item as empty and spill the heading out with its list membership lost (ExaDev/documents.js#940)",
      ({ level }) => {
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [
                {
                  text: " ",
                  source: { format: "markdown" as const, xml: "\n" },
                },
                {
                  text: " ",
                  source: { format: "markdown" as const, xml: "\n" },
                },
                { text: "foo" },
              ],
              styleId: level,
              list: { numId: "md1:bullet", level: 0, itemId: "i1" },
            },
          ]),
        );
        // Never a setext promotion: two leading blank lines in a row inside a list item's own marker line is the exact shape CommonMark's own "at most one blank line" list-item rule (spec 0.31.2, section 5.2) closes the item on — pre-fix, this wrote a setext heading here, and reparsing it split into an EMPTY list item plus a stray top-level Heading1 that had lost its own list membership entirely.
        expect(written).toBe(`- ${level === "Heading1" ? "#" : "##"}   foo`);

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        expect(blocks).toHaveLength(1);
        const [headingBlock] = blocks;
        if (headingBlock?.kind !== "paragraph") {
          throw new Error("expected a paragraph block");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(headingBlock.list).toBeDefined();
        expect(headingBlock.runs.map((run) => run.text).join("")).toBe("foo");
      },
    );

    it.each([
      { level: "Heading1" as const, underline: "=" },
      { level: "Heading2" as const, underline: "-" },
    ])(
      "still promotes $level to setext and round-trips the leading break losslessly inside a blockquote",
      ({ level, underline }) => {
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [{ text: "\n" }, { text: "foo" }],
              styleId: level,
              indentLeftPt: 36,
            },
          ]),
        );
        expect(written).toBe(`> \\\n> foo\n> ${underline}`);

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        // The reparse now carries a real division pair around the quoted heading (ExaDev/document-schema.js#1122) rather than degrading to indent-only structure — a heading inside a construct's extent groups fine, so the quote's own container fidelity survives alongside the heading's.
        const blockCountWithQuotedHeading = 3;
        expect(blocks).toHaveLength(blockCountWithQuotedHeading);
        const [open, headingBlock, close] = blocks;
        expect(open).toEqual({
          kind: "constructStart",
          descriptor: { kind: "division" },
        });
        expect(close).toEqual({ kind: "constructEnd" });
        if (headingBlock?.kind !== "paragraph") {
          throw new Error("expected a paragraph block");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(headingBlock.indentLeftPt).toBeGreaterThan(0);
        expect(headingBlock.runs.map((run) => run.text).join("")).toBe("\nfoo");
      },
    );
  });

  describe("a level-1/2 heading whose own rendered text is entirely blank never promotes to setext, even when explicitly requested (ExaDev/documents.js#940)", () => {
    // The leading-run exemption two describe blocks above only ever exempts a run of blank lines that is followed by later, genuinely non-blank heading content — when EVERY line renderSetextHeading would treat as the heading's own text is blank (a single whitespace-only run, a single tab, or no runs at all), there is no text left for the underline to attach to, and forcing setext regardless of headingStyle leaves the underline immediately following what a reparse reads as an ordinary blank line ahead of the NEXT block, not a heading of any kind — the heading itself is silently dropped, not merely reformatted. None of these three inputs embeds an actual CommonMark line ending, so ATX's own single-physical-line limit was never the problem; falling through to a normal (blank-bodied) ATX heading is exactly as safe as any other zero-content heading.
    it.each([
      { name: "a single whitespace-only run", runs: [{ text: "   " }] },
      { name: "a single tab run", runs: [{ text: "\t" }] },
      { name: "zero runs", runs: [] },
    ])(
      "keeps $name as an ATX heading rather than losing it entirely, even with headingStyle: 'setext'",
      ({ runs }) => {
        const written = emitMarkdown(
          doc([
            { kind: "paragraph", runs, styleId: "Heading1" },
            { kind: "paragraph", runs: [{ text: "tail" }] },
          ]),
          { headingStyle: "setext" },
        );
        // Never a setext promotion: renderSetextHeading would otherwise produce a blank (or whitespace-only) text line immediately followed by its own underline — pre-fix, this wrote e.g. "   \n===\n\ntail", which a reparse reads as two plain paragraphs with the Heading1 gone entirely.
        expect(written).not.toMatch(/^[ \t]*\n=+\n/);

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        expect(blocks).toHaveLength(2);
        const [headingBlock, tailBlock] = blocks;
        if (
          headingBlock?.kind !== "paragraph" ||
          tailBlock?.kind !== "paragraph"
        ) {
          throw new Error("expected two paragraph blocks");
        }
        expect(headingBlock.styleId).toBe("Heading1");
        expect(tailBlock.runs.map((run) => run.text).join("")).toBe("tail");
      },
    );
  });

  describe("a level-1/2 heading whose own embedded break is a bare CR line ending, not merely LF (ExaDev/documents.js#940)", () => {
    // CommonMark's own line-ending grammar (spec 0.31.2, "Lines") is LF, CRLF, or a lone CR — not LF alone. A run's own plain text, or a foreign producer's own markdown residue (src/emit/inline.ts's renderLeaf, the run.source.xml case) can carry a bare CR just as legitimately as an LF, and embedsUnsafeBreakForSetext/the embedsLineBreak detection/the ATX-collapse fallback all have to treat it as a genuine line ending too — an LF-only check lets a bare CR slip through unescaped and un-collapsed into what is meant to be a single ATX physical line, which the READ side's own line-ending-aware splitter (src/block/block.ts) then reads back as more than one line, fracturing the heading on reparse exactly as an un-caught blank line does.
    it("collapses a CR-delimited interior blank stretch to ordinary ATX heading text instead of leaking a raw CR into a single physical line", () => {
      const written = emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "head\r\rfoo" }],
            styleId: "Heading1",
          },
          { kind: "paragraph", runs: [{ text: "tail" }] },
        ]),
      );
      expect(written).not.toContain("\r");

      const reparsed = lowerMarkdown(written);
      if (reparsed.kind !== "wordprocessing") {
        throw new Error("expected a wordprocessing ContentDocument");
      }
      const blocks = reparsed.sections[0]?.blocks ?? [];
      // Exactly two blocks, matching the original document — pre-fix, the raw CR pair reached the reparse as a genuine interior blank line the write side never accounted for, fracturing the heading into a bare "head" paragraph, a spurious "foo" paragraph carrying none of the heading's own styling, and the trailing "tail" paragraph (three blocks, not two).
      expect(blocks).toHaveLength(2);
      const [headingBlock, tailBlock] = blocks;
      if (
        headingBlock?.kind !== "paragraph" ||
        tailBlock?.kind !== "paragraph"
      ) {
        throw new Error("expected two paragraph blocks");
      }
      expect(headingBlock.styleId).toBe("Heading1");
      expect(tailBlock.runs.map((run) => run.text).join("")).toBe("tail");
    });
  });

  describe("a level 3-6 heading's own escaped hard break is spelled with a CRLF or bare CR, not merely LF (ExaDev/documents.js#940)", () => {
    // This package's own escapeMarkdownText always spells an escaped hard break with a trailing LF ('\\\n'), but a foreign producer's own markdown residue (re-emitted verbatim, unescaped, by src/emit/inline.ts's renderLeaf) can carry the identical backslash-escape spelling against a CRLF or lone CR just as legitimately. Stripping only the LF-spelled escape ahead of the LINE_ENDING_PATTERN-based collapse leaves this backslash behind as a stray literal character once that wider split removes the CRLF/CR line ending out from under it — the collapse consumes the line ending but not the escape that preceded it.
    it.each([
      { name: "a bare CR", xml: "\\\r" },
      { name: "a CRLF", xml: "\\\r\n" },
    ])(
      "collapses to a plain space, not a space plus a leftover literal backslash, for $name",
      ({ xml }) => {
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [
                { text: "foo" },
                { text: "\n", source: { format: "markdown", xml } },
                { text: "bar" },
              ],
              styleId: "Heading3",
            },
          ]),
        );
        expect(written).toBe("### foo bar");
        expect(written).not.toContain("\\");
      },
    );
  });

  it("keys canInterruptOpenParagraph off the ACTUAL (ATX-collapsed) rendering of a level-1/2 heading whose own trailing break makes setext unsafe, not just its level — an unsafe-break heading interrupts an open list-item paragraph cleanly, needing no forced blank line, since it never actually renders as setext (ExaDev/documents.js#940)", () => {
    const source = doc([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
      {
        kind: "paragraph",
        styleId: "Heading1",
        runs: [{ text: "h" }, { text: "\n" }],
        list: { numId: "md1:bullet", level: 0, itemId: "i1" },
      },
    ]);
    const written = emitMarkdown(source);
    // No forced blank line between "a" and the heading's own ATX line: an ATX heading always interrupts an open paragraph cleanly, and this one really is ATX now (its trailing break made setext unsafe), so requiresBlankLineBefore correctly sees no hazard — only the list's own loose/tight spacing (not loose here) decides whether a blank line appears at all.
    expect(written).toBe("- a\n  # h ");

    const reparsed = lowerMarkdown(written);
    if (reparsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const blocks = reparsed.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [paragraphBlock, headingBlock] = blocks;
    if (
      paragraphBlock?.kind !== "paragraph" ||
      headingBlock?.kind !== "paragraph"
    ) {
      throw new Error("expected two paragraph blocks");
    }
    expect(paragraphBlock.runs.map((run) => run.text).join("")).toBe("a");
    expect(headingBlock.styleId).toBe("Heading1");
  });

  it("does not treat a heading's own SECOND line, indented 4+ columns, as an interrupting ATX heading, since an indented line is absorbed as ordinary paragraph continuation, so the promotion still stands", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              { text: "foo" },
              { text: "\n" },
              {
                text: "    # bar",
                source: { format: "markdown", xml: "    # bar" },
              },
            ],
            styleId: "Heading1",
          },
        ]),
      ),
    ).toBe("foo\\\n    # bar\n====");
  });

  it("refuses setext when a heading's own second line opens an HTML BLOCK of a kind that genuinely interrupts a paragraph, collapsing to ATX instead", () => {
    const collector = createDiagnosticCollector();
    const written = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "foo" },
            { text: "\n" },
            { text: "<div>", source: { format: "markdown", xml: "<div>" } },
          ],
          styleId: "Heading1",
        },
      ]),
      { sink: collector.sink },
    );
    expect(written).toBe("# foo <div>");
    expect(
      collector.has(
        MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
      ),
    ).toBe(true);
  });

  it("still promotes a heading whose own SECOND line is a lone generic tag, since CommonMark's HTML-block condition 7 is barred from interrupting a paragraph, so the line is absorbed as more of the heading's text", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              { text: "foo" },
              { text: "\n" },
              { text: "<a>", source: { format: "markdown", xml: "<a>" } },
            ],
            styleId: "Heading1",
          },
        ]),
      ),
    ).toBe("foo\\\n<a>\n====");
  });

  it("refuses setext when that same lone generic tag is the heading's own FIRST line instead, where genuine block-start position lets condition 7 open an HTML block after all", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              { text: "<a>", source: { format: "markdown", xml: "<a>" } },
              { text: " ", source: { format: "markdown", xml: "\n" } },
              { text: "foo" },
            ],
            styleId: "Heading1",
          },
        ]),
      ),
    ).toBe("# <a> foo");
  });

  it("refuses setext for a heading whose own second line is a GFM table delimiter row matching the line before it, but not when that same row is indented 4+ columns", () => {
    const heading = (delimiterRow: string): string =>
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              { text: "h", source: { format: "markdown", xml: "a | b" } },
              { text: " ", source: { format: "markdown", xml: "\n" } },
              {
                text: "d",
                source: { format: "markdown", xml: delimiterRow },
              },
            ],
            styleId: "Heading1",
          },
        ]),
      );
    expect(heading("---|---")).toBe("# a | b ---|---");
    expect(heading("    ---|---")).toBe("a | b\n    ---|---\n=====");
  });

  it("does NOT report HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK when setext was the caller's own explicit request, since the break overrode nothing", () => {
    const collector = createDiagnosticCollector();
    const written = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "foo" },
            { text: " ", source: { format: "markdown", xml: "\n" } },
            { text: "bar" },
          ],
          styleId: "Heading2",
        },
      ]),
      { headingStyle: "setext", sink: collector.sink },
    );
    expect(written).toBe("foo\nbar\n---");
    expect(
      collector.has(
        MarkdownDiagnosticCodes.HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK,
      ),
    ).toBe(false);
  });

  it("does NOT report HEADING_LINE_BREAK_COLLAPSED for a heading whose own rendered text carries no line break at all", () => {
    const collector = createDiagnosticCollector();
    const written = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading3" },
      ]),
      { sink: collector.sink },
    );
    expect(written).toBe("### foo");
    expect(
      collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
    ).toBe(false);
  });
});

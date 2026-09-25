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

describe("headings", () => {
  it("emits a Heading{N} styleId as ATX by default", () => {
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading3" },
        ]),
      ),
    ).toBe("### foo");
  });

  it("does NOT fire HEADING_LEVEL_CLAMPED for a heading whose own level needs no clamping at all", () => {
    const collector = createDiagnosticCollector();
    emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading3" },
      ]),
      { sink: collector.sink },
    );
    expect(collector.has(MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED)).toBe(
      false,
    );
  });

  it('emits level 1/2 as setext when headingStyle: "setext" is requested, and falls back to ATX beyond level 2', () => {
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading1" },
        ]),
        { headingStyle: "setext" },
      ),
    ).toBe("foo\n===");
    expect(
      emitMarkdown(
        doc([
          { kind: "paragraph", runs: [{ text: "foo" }], styleId: "Heading3" },
        ]),
        { headingStyle: "setext" },
      ),
    ).toBe("### foo");
  });

  it("promotes a level-1/2 heading whose own runs embed a soft-break line break to setext, overriding the configured ATX style, since ATX has no way to hold one (ExaDev/documents.js#940)", () => {
    const collector = createDiagnosticCollector();
    const softBreakRuns = [
      { text: "foo" },
      { text: " ", source: { format: "markdown" as const, xml: "\n" } },
      { text: "bar" },
    ];
    expect(
      emitMarkdown(
        doc([{ kind: "paragraph", runs: softBreakRuns, styleId: "Heading2" }]),
        { sink: collector.sink },
      ),
    ).toBe("foo\nbar\n---");
    expect(
      collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
    ).toBe(false);
  });

  it("collapses an embedded soft-break line break to a space with a diagnostic for a level 3-6 heading, which has no setext fallback", () => {
    const collector = createDiagnosticCollector();
    const softBreakRuns = [
      { text: "foo" },
      { text: " ", source: { format: "markdown" as const, xml: "\n" } },
      { text: "bar" },
    ];
    expect(
      emitMarkdown(
        doc([{ kind: "paragraph", runs: softBreakRuns, styleId: "Heading3" }]),
        { sink: collector.sink },
      ),
    ).toBe("### foo bar");
    expect(
      collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
    ).toBe(true);
    const diagnostic = collector.diagnostics.find(
      (d) => d.code === MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED,
    );
    expect(diagnostic?.message).toContain("3");
    expect(diagnostic?.message).toContain("line break");
  });

  it("measures the setext underline's length against the CommonMark first line even when its own embedded break is a bare CR, not an LF", () => {
    // renderSetextHeading's own underline length tracks the heading's rendered FIRST LINE, per LINE_ENDING_PATTERN (LF, CRLF, or a lone CR) — the same line-ending grammar every other check in this module already agrees on. A bare `text.split("\n")[0]` instead treats a CR-delimited break as ordinary text absent any LF at all, measuring the WHOLE multi-line string as "line one" rather than just its first line — cosmetically wrong (a setext underline's own length carries no semantic meaning beyond "one or more", so the heading is still valid either way), but inconsistent with how every other line-ending decision in this file is made. The bare CR has to arrive via a markdown-residue soft break (re-emitted verbatim, unescaped) rather than a run's own plain text field: escapeMarkdownText now normalises a bare CR carried there to the same backslash-LF hard-break spelling an ordinary embedded '\n' gets (see the plain-text-run hard-break coverage in the tables describe block below), so a plain-text run can no longer land a raw, un-escaped CR in the assembled text for this check to measure against.
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [
              { text: "ab" },
              { text: " ", source: { format: "markdown" as const, xml: "\r" } },
              { text: "cd" },
            ],
            styleId: "Heading1",
          },
        ]),
      ),
    ).toBe("ab\rcd\n==");
  });

  it("promotes a level-1/2 heading whose own runs embed a hard-break literal newline to setext too, with the backslash-escape spelling reflected in the underline length", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "foo" }, { text: "\n" }, { text: "bar" }],
            styleId: "Heading1",
          },
        ]),
      ),
    ).toBe("foo\\\nbar\n====");
  });

  describe("a level-1/2 heading whose own text ends in an embedded break (ExaDev/documents.js#940)", () => {
    // A TRAILING break — reachable from an ordinary Word heading ending in a manual line break or page break, both of which ooxml.js's docx reader maps to a literal trailing '\n' — must NOT promote to setext: renderSetextHeading appends its own '\n' plus the underline directly after `text`, so a `text` that already ends in '\n' leaves a genuinely BLANK line between the heading's real last line and the underline. Setext's own grammar (spec 0.31.2) is "one or more lines of text, NOT INTERRUPTED BY A BLANK LINE", so this is unrepresentable — collapsing to ATX (exactly the existing level-3-6 fallback) is the only safe rendering, not a stylistic choice.
    it.each([
      { level: "Heading1", underlineChar: "=" },
      { level: "Heading2", underlineChar: "-" },
    ])(
      "collapses to ATX with a diagnostic instead of promoting to $level setext, since the underline would otherwise land after a blank line",
      ({ level }) => {
        const collector = createDiagnosticCollector();
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [{ text: "foo" }, { text: "\n" }],
              styleId: level,
            },
          ]),
          { sink: collector.sink },
        );
        expect(written).toBe(`${level === "Heading1" ? "#" : "##"} foo `);
        expect(
          collector.has(
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
          ),
        ).toBe(true);
        const diagnostic = collector.diagnostics.find(
          (d) =>
            d.code ===
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        );
        expect(diagnostic?.message).toContain("no heading text");
        expect(diagnostic?.message).toContain("attach to");
        expect(
          collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
        ).toBe(false);
      },
    );

    it.each([
      { level: "Heading1" as const, underlineChar: "=" },
      { level: "Heading2" as const, underlineChar: "-" },
    ])(
      "survives a full write-then-reread round trip as one intact $level heading, rather than fracturing into a plain paragraph plus a spurious block once the underline character is $underlineChar",
      ({ level }) => {
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [{ text: "foo" }, { text: "\n" }],
              styleId: level,
            },
            { kind: "paragraph", runs: [{ text: "next para" }] },
          ]),
        );
        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        // Exactly two blocks: the heading (still recognised as one, carrying its own styleId) and the trailing paragraph — pre-fix, this fractured into THREE (the heading text as a bare paragraph, a spurious "===="/"----" paragraph or thematic break invented from the stray underline, and the trailing paragraph).
        expect(blocks).toHaveLength(2);
        const [headingBlock, nextBlock] = blocks;
        if (
          headingBlock?.kind !== "paragraph" ||
          nextBlock?.kind !== "paragraph"
        ) {
          throw new Error("expected two paragraph blocks");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(headingBlock.runs.map((run) => run.text).join("")).toBe("foo");
        expect(nextBlock.styleId).toBeUndefined();
        expect(nextBlock.runs.map((run) => run.text).join("")).toBe(
          "next para",
        );
      },
    );
  });

  describe("a level-1/2 heading whose own break is followed by a whitespace-only line, not a literally empty one (ExaDev/documents.js#940)", () => {
    // CommonMark's own blank-line definition (spec 0.31.2, "Blank lines") is "a line containing no characters, or only spaces or tabs" — a residual line of pure whitespace is just as unsafe for setext as a literally empty one, whether that whitespace comes from a hard break's own escape spelling (the backslash lands on the line the break TERMINATES, never on the line that follows) or from an un-escaped soft-break residue newline.
    it.each([
      {
        level: "Heading1" as const,
        spelling: "hard-break",
        runs: [{ text: "foo" }, { text: "\n" }, { text: " " }],
      },
      {
        level: "Heading2" as const,
        spelling: "hard-break",
        runs: [{ text: "foo" }, { text: "\n" }, { text: " " }],
      },
      {
        level: "Heading1" as const,
        spelling: "soft-break",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: " " },
        ],
      },
      {
        level: "Heading2" as const,
        spelling: "soft-break",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: " " },
        ],
      },
    ])(
      "collapses to ATX with a diagnostic instead of promoting $level to setext for a $spelling break followed by a trailing space",
      ({ level, runs }) => {
        const collector = createDiagnosticCollector();
        emitMarkdown(doc([{ kind: "paragraph", runs, styleId: level }]), {
          sink: collector.sink,
        });
        expect(
          collector.has(
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
          ),
        ).toBe(true);
      },
    );

    it.each([
      {
        level: "Heading1" as const,
        spelling: "hard-break",
        runs: [{ text: "foo" }, { text: "\n" }, { text: " " }],
      },
      {
        level: "Heading2" as const,
        spelling: "hard-break",
        runs: [{ text: "foo" }, { text: "\n" }, { text: " " }],
      },
      {
        level: "Heading1" as const,
        spelling: "soft-break",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: " " },
        ],
      },
      {
        level: "Heading2" as const,
        spelling: "soft-break",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: " " },
        ],
      },
    ])(
      "survives a full write-then-reread round trip as one intact $level heading for a $spelling break followed by a trailing space, rather than fracturing into a plain paragraph plus a spurious block or thematic break",
      ({ level, runs }) => {
        const written = emitMarkdown(
          doc([
            { kind: "paragraph", runs, styleId: level },
            { kind: "paragraph", runs: [{ text: "next para" }] },
          ]),
        );
        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        // Exactly two blocks: the heading (still recognised as one, carrying its own styleId) and the trailing paragraph — pre-fix, a whitespace-only (as opposed to literally empty) residual line slipped past the zero-length-only guard and fractured this into THREE (the heading text as a bare paragraph, a spurious "===="/"----" paragraph or thematic break invented from the stray underline, and the trailing paragraph).
        expect(blocks).toHaveLength(2);
        const [headingBlock, nextBlock] = blocks;
        if (
          headingBlock?.kind !== "paragraph" ||
          nextBlock?.kind !== "paragraph"
        ) {
          throw new Error("expected two paragraph blocks");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(nextBlock.styleId).toBeUndefined();
        expect(nextBlock.runs.map((run) => run.text).join("")).toBe(
          "next para",
        );
      },
    );
  });

  describe("a level-1/2 heading whose own first content line is indented 4 or more columns never promotes to setext (ExaDev/documents.js#940)", () => {
    // CommonMark's own setext grammar (spec 0.31.2, "Setext headings") is "one or more lines of text, not interrupted by a blank line, of which the FIRST LINE DOES NOT HAVE MORE THAN 3 SPACES OF INDENTATION, followed by a setext heading underline" — a wholly separate clause from the blank-line one every other describe block in this file exercises. The spec's own worked example ("Four spaces of indentation is too many") shows exactly this: a would-be setext heading's own first line, indented 4 spaces, reparses as an indented code block instead, with the underline surviving as a stray paragraph or thematic break of its own — the identical corrupt-reparse shape a blank line produces, via a different CommonMark construct.
    it.each([{ level: "Heading1" as const }, { level: "Heading2" as const }])(
      "collapses to ATX with a diagnostic instead of promoting $level to setext when the heading's own first content line is indented 4 spaces",
      ({ level }) => {
        const collector = createDiagnosticCollector();
        const softBreakRuns = [
          { text: "    foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: "bar" },
        ];
        const written = emitMarkdown(
          doc([{ kind: "paragraph", runs: softBreakRuns, styleId: level }]),
          { sink: collector.sink },
        );
        expect(written).toBe(
          `${level === "Heading1" ? "#" : "##"}     foo bar`,
        );
        const diagnostic = collector.diagnostics.find(
          (d) =>
            d.code ===
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        );
        expect(diagnostic?.message).toContain("indentation");
        expect(diagnostic?.message).toContain("indented code block");
        expect(
          collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
        ).toBe(false);
      },
    );

    it.each([{ level: "Heading1" as const }, { level: "Heading2" as const }])(
      "survives a full write-then-reread round trip as one intact $level heading, rather than being read back as an indented code block once the first content line is indented 4 spaces",
      ({ level }) => {
        const softBreakRuns = [
          { text: "    foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: "bar" },
        ];
        const written = emitMarkdown(
          doc([
            { kind: "paragraph", runs: softBreakRuns, styleId: level },
            { kind: "paragraph", runs: [{ text: "next para" }] },
          ]),
        );
        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        // Exactly two blocks: the heading (still recognised as one, carrying its own styleId) and the trailing paragraph — pre-fix, the 4-space-indented first line promoted into setext read back as an indented code block, a stray heading carrying only "bar", and the trailing paragraph, splitting the original heading's own content across two blocks.
        expect(blocks).toHaveLength(2);
        const [headingBlock, nextBlock] = blocks;
        if (
          headingBlock?.kind !== "paragraph" ||
          nextBlock?.kind !== "paragraph"
        ) {
          throw new Error("expected two paragraph blocks");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(nextBlock.styleId).toBeUndefined();
        expect(nextBlock.runs.map((run) => run.text).join("")).toBe(
          "next para",
        );
      },
    );

    it("still promotes to setext when the first content line is indented exactly 3 spaces — the boundary CommonMark's own grammar actually draws", () => {
      const softBreakRuns = [
        { text: "   foo" },
        { text: " ", source: { format: "markdown" as const, xml: "\n" } },
        { text: "bar" },
      ];
      expect(
        emitMarkdown(
          doc([
            { kind: "paragraph", runs: softBreakRuns, styleId: "Heading1" },
          ]),
        ),
      ).toBe("   foo\nbar\n======");
    });

    it("treats a leading tab as 4 columns of indentation (CommonMark's own tab-stop rule, spec 0.31.2 'Tabs'), collapsing to ATX exactly as 4 leading spaces would", () => {
      const softBreakRuns = [
        { text: "\tfoo" },
        { text: " ", source: { format: "markdown" as const, xml: "\n" } },
        { text: "bar" },
      ];
      const collector = createDiagnosticCollector();
      const written = emitMarkdown(
        doc([{ kind: "paragraph", runs: softBreakRuns, styleId: "Heading1" }]),
        { sink: collector.sink },
      );
      expect(written).toBe("# \tfoo bar");
      expect(
        collector.has(
          MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        ),
      ).toBe(true);
    });
  });

  describe("a level-1/2 heading whose own break-following line would itself start an interrupting block construct never promotes to setext (ExaDev/documents.js#940)", () => {
    // CommonMark's own setext grammar (spec 0.31.2, "Setext headings") has a third clause beyond the blank-line and first-line-indentation ones exercised above, in the same sentence: "The lines of text must be such that, were they not followed by the setext heading underline, they would be interpreted as a paragraph: they cannot be interpretable as a code fence, ATX heading, block quote, thematic break, list item, or HTML block." A bold or strikethrough run that becomes EMPTY immediately after a break lowers to a bare pair of emphasis markers with nothing between them — "____" (a thematic break, the default '_' emphasisMarker doubled for bold) or "~~~~" (a code-fence opener, GFM's own fixed strikethrough marker) — and reparsing either one back as its own construct destroys the heading rather than merely losing fidelity: pre-fix, "foo\n____\n===" read back as a plain paragraph "foo" plus TWO thematic breaks (the invented "____" one and the "===" underline, which is itself a valid thematic break once no open paragraph remains for it to become a setext underline of), and "foo\n~~~~\n===" read back as a plain paragraph "foo" plus a fenced code block swallowing the "===" underline whole — both confirmed directly against the reference CommonMark implementation, and both WORSE than the merge-base's own pre-existing gap for the identical input (which lost fidelity but at least kept the heading level).
    it.each([
      {
        level: "Heading1" as const,
        shape: "bold run emptied by a soft break",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: "", bold: true },
        ],
      },
      {
        level: "Heading2" as const,
        shape: "bold run emptied by a hard break",
        runs: [{ text: "foo" }, { text: "\n" }, { text: "", bold: true }],
      },
      {
        level: "Heading1" as const,
        shape: "strikethrough run emptied by a soft break",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: "", strike: true },
        ],
      },
    ])(
      "collapses to ATX with a diagnostic instead of promoting $level to setext for a $shape",
      ({ level, runs }) => {
        const collector = createDiagnosticCollector();
        const written = emitMarkdown(
          doc([{ kind: "paragraph", runs, styleId: level }]),
          {
            sink: collector.sink,
          },
        );
        expect(written).not.toContain("\n");
        const diagnostic = collector.diagnostics.find(
          (d) =>
            d.code ===
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        );
        expect(diagnostic?.message).toContain("code fence");
        expect(diagnostic?.message).toContain("thematic break");
        expect(
          collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
        ).toBe(false);
      },
    );

    it.each([
      {
        level: "Heading1" as const,
        shape: "bold run emptied by a soft break, thematic-break-shaped",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: "", bold: true },
        ],
      },
      {
        level: "Heading1" as const,
        shape: "strikethrough run emptied by a soft break, code-fence-shaped",
        runs: [
          { text: "foo" },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: "", strike: true },
        ],
      },
    ])(
      "survives a full write-then-reread round trip as one intact $level heading for a $shape, rather than fracturing into a paragraph plus a stray thematic break or code block that swallows the trailing paragraph",
      ({ level, runs }) => {
        const written = emitMarkdown(
          doc([
            { kind: "paragraph", runs, styleId: level },
            { kind: "paragraph", runs: [{ text: "next para" }] },
          ]),
        );
        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        // Exactly two blocks: the heading (still recognised as one, carrying its own styleId and level) and the trailing paragraph — pre-fix, the heading fractured into a bare paragraph plus either two thematic breaks (bold) or a code block that swallowed the trailing paragraph entirely (strikethrough), losing the heading level and the trailing paragraph both.
        expect(blocks).toHaveLength(2);
        const [headingBlock, nextBlock] = blocks;
        if (
          headingBlock?.kind !== "paragraph" ||
          nextBlock?.kind !== "paragraph"
        ) {
          throw new Error("expected two paragraph blocks");
        }
        expect(headingBlock.styleId).toBe(level);
        expect(nextBlock.styleId).toBeUndefined();
        expect(nextBlock.runs.map((run) => run.text).join("")).toBe(
          "next para",
        );
      },
    );

    it("still promotes a break-following line to setext when it is ordinary text that would merely be absorbed as paragraph continuation, not one of the six interrupting constructs", () => {
      const softBreakRuns = [
        { text: "foo" },
        { text: " ", source: { format: "markdown" as const, xml: "\n" } },
        { text: "bar" },
      ];
      expect(
        emitMarkdown(
          doc([
            { kind: "paragraph", runs: softBreakRuns, styleId: "Heading1" },
          ]),
        ),
      ).toBe("foo\nbar\n===");
    });

    it.each([
      {
        name: "a $$ math-block opener promoted from a residue run",
        secondLineRuns: [
          { text: "$$", source: { format: "markdown" as const, xml: "$$" } },
        ],
      },
      {
        name: "a GFM table delimiter row promoted from a residue run, matching the preceding line's own single cell",
        secondLineRuns: [
          {
            text: "| --- |",
            source: { format: "markdown" as const, xml: "| --- |" },
          },
        ],
      },
    ])(
      "collapses to ATX with a diagnostic instead of promoting to setext for $name (ExaDev/documents.js#940)",
      ({ secondLineRuns }) => {
        // Beyond CommonMark's own six named interrupting constructs, this package's own reader treats two more shapes as paragraph-interrupting/-converting: a $$ math-block opener (a genuine block start, exactly like a code fence) and a GFM table delimiter row (a paragraph PROMOTION converting the line before it, src/block/table.ts's own top-of-file note). Both are reachable only via a run carrying markdown residue, since escapeMarkdownText always backslash-escapes a literal '$' and '|'/':' never survive a table-delimiter shape through ordinary escaped text either.
        const collector = createDiagnosticCollector();
        const written = emitMarkdown(
          doc([
            {
              kind: "paragraph",
              runs: [{ text: "foo" }, { text: "\n" }, ...secondLineRuns],
              styleId: "Heading1",
            },
          ]),
          { sink: collector.sink },
        );
        expect(written).not.toContain("\n");
        expect(
          collector.has(
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
          ),
        ).toBe(true);

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const blocks = reparsed.sections[0]?.blocks ?? [];
        // Exactly one block, still the heading — pre-fix, the second line converted the paragraph into a math block or a table, leaving the "===" underline as a stray, unrelated block of its own with the heading gone entirely.
        expect(blocks).toHaveLength(1);
        const [headingBlock] = blocks;
        if (headingBlock?.kind !== "paragraph") {
          throw new Error("expected a paragraph block");
        }
        expect(headingBlock.styleId).toBe("Heading1");
      },
    );
  });
});

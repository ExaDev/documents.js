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

  describe("a level-1/2 heading whose own FIRST line would itself start an interrupting block construct never promotes to setext (ExaDev/documents.js#940)", () => {
    // The same third clause of the setext grammar exercised by the "break-following line" describe block above applies just as much to the run's own FIRST line, not merely to lines after it: a bold or strikethrough run that becomes EMPTY immediately BEFORE a break (rather than after) lowers to the identical bare "____"/"~~~~" emphasis-marker shape, but now as the heading's own opening line, with real heading text only arriving once the break is past. An earlier version of this check skipped the first line entirely on the (read-side) reasoning that a line matching one of these constructs would never have opened as a paragraph to begin with — backwards for this write-side promotion decision, and pre-fix this exact shape reparsed as a single CodeBlock/HorizontalRule swallowing the heading, its underline, AND the following paragraph — strictly worse than merely losing the heading level, since a real, unrelated trailing paragraph is consumed too.
    it.each([
      {
        level: "Heading1" as const,
        shape:
          "strikethrough run emptied before a hard break, code-fence-shaped",
        runs: [{ text: "", strike: true }, { text: "\n" }, { text: "foo" }],
      },
      {
        level: "Heading2" as const,
        shape: "bold run emptied before a soft break, thematic-break-shaped",
        runs: [
          { text: "", bold: true },
          { text: " ", source: { format: "markdown" as const, xml: "\n" } },
          { text: "foo" },
        ],
      },
    ])(
      "collapses to ATX with a diagnostic instead of promoting $level to setext for a $shape",
      ({ level, runs }) => {
        const collector = createDiagnosticCollector();
        const written = emitMarkdown(
          doc([{ kind: "paragraph", runs, styleId: level }]),
          { sink: collector.sink },
        );
        expect(written).not.toContain("\n");
        expect(
          collector.has(
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
          ),
        ).toBe(true);
      },
    );

    it("survives a full write-then-reread round trip as one intact Heading1, rather than fracturing into a single CodeBlock that swallows the heading, its underline, AND the following paragraph (the HIGH-severity regression this describe block guards against)", () => {
      const runs = [
        { text: "", strike: true },
        { text: "\n" },
        { text: "foo" },
      ];
      const written = emitMarkdown(
        doc([
          { kind: "paragraph", runs, styleId: "Heading1" },
          { kind: "paragraph", runs: [{ text: "next para" }] },
        ]),
      );
      const reparsed = lowerMarkdown(written);
      if (reparsed.kind !== "wordprocessing") {
        throw new Error("expected a wordprocessing ContentDocument");
      }
      const blocks = reparsed.sections[0]?.blocks ?? [];
      expect(blocks).toHaveLength(2);
      const [headingBlock, nextBlock] = blocks;
      if (
        headingBlock?.kind !== "paragraph" ||
        nextBlock?.kind !== "paragraph"
      ) {
        throw new Error("expected two paragraph blocks");
      }
      expect(headingBlock.styleId).toBe("Heading1");
      expect(nextBlock.styleId).toBeUndefined();
      expect(nextBlock.runs.map((run) => run.text).join("")).toBe("next para");
    });
  });

  describe("an explicit headingStyle: 'setext' request against a break-free heading that is unsafe on its own terms is still refused, with a diagnostic (ExaDev/documents.js#940)", () => {
    // Every OTHER unsafe-for-setext test in this file exercises a heading whose text embeds an actual line break — the break itself is what makes setext a candidate rendering at all when headingStyle is left at its 'atx' default. This heading has NO embedded break anywhere: headingStyle: 'setext' is the ONLY reason setext is even attempted, and unsafeSetextBreakReason's own first-line-indentation check applies exactly as much to a single-line heading as to a multi-line one. Pre-fix, every heading-related diagnostic sat behind an `embedsLineBreak` guard, so this exact shape silently fell through to a bare, unmarked ATX heading — an explicit caller preference honoured in appearance (setext was refused, correctly) but with zero signal that it happened.
    it("does NOT fire HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT for a break-free, 4+-column-indented level-3 heading even with headingStyle: 'setext' requested — level <= MAX_SETEXT_LEVEL is its own genuine gate, not implied by setextRequested and unsafeForSetext alone", () => {
      const collector = createDiagnosticCollector();
      const written = emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "    foo" }],
            styleId: "Heading3",
          },
        ]),
        { headingStyle: "setext", sink: collector.sink },
      );
      expect(written).toBe("###     foo");
      expect(
        collector.has(
          MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        ),
      ).toBe(false);
      expect(
        collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
      ).toBe(false);
      expect(
        collector.has(
          MarkdownDiagnosticCodes.HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK,
        ),
      ).toBe(false);
    });

    it("does NOT fire HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT for a break-free, 4+-column-indented level-1 heading when setext was never requested at all — unsafeForSetext alone, with setextRequested false, must not enter the unsafe-diagnostic branch", () => {
      const collector = createDiagnosticCollector();
      const written = emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "    foo" }],
            styleId: "Heading1",
          },
        ]),
        { sink: collector.sink },
      );
      expect(written).toBe("#     foo");
      expect(
        collector.has(
          MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        ),
      ).toBe(false);
      expect(
        collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
      ).toBe(false);
      expect(
        collector.has(
          MarkdownDiagnosticCodes.HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK,
        ),
      ).toBe(false);
    });

    it("collapses to ATX with HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT when the heading's own (break-free) text is indented 4 or more columns", () => {
      const collector = createDiagnosticCollector();
      const written = emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "    foo" }],
            styleId: "Heading1",
          },
        ]),
        { headingStyle: "setext", sink: collector.sink },
      );
      expect(written).toBe("#     foo");
      expect(written).not.toContain("\n");
      const diagnostic = collector.diagnostics.find(
        (d) =>
          d.code ===
          MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
      );
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.message).toContain("indentation");
      expect(
        collector.has(MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED),
      ).toBe(false);
      expect(
        collector.has(
          MarkdownDiagnosticCodes.HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK,
        ),
      ).toBe(false);

      const reparsed = lowerMarkdown(written);
      if (reparsed.kind !== "wordprocessing") {
        throw new Error("expected a wordprocessing ContentDocument");
      }
      const [headingBlock] = reparsed.sections[0]?.blocks ?? [];
      if (headingBlock?.kind !== "paragraph") {
        throw new Error("expected a paragraph block");
      }
      // Round-trips as one intact Heading1 — not, as the setext promotion this test refuses would have produced, an indented code block ("    foo") followed by a stray "====" paragraph with the heading gone entirely.
      expect(headingBlock.styleId).toBe("Heading1");
    });

    it.each([
      {
        level: "Heading1" as const,
        shape: "code-fence-shaped ('~~~~')",
        runs: [{ text: "", strike: true }],
      },
      {
        level: "Heading1" as const,
        shape: "thematic-break-shaped ('____')",
        runs: [{ text: "", bold: true }],
      },
      {
        level: "Heading2" as const,
        shape: "blockquote-shaped",
        runs: [
          { text: "> q", source: { format: "markdown" as const, xml: "> q" } },
        ],
      },
      {
        level: "Heading1" as const,
        shape: "ATX-heading-shaped ('# x')",
        runs: [
          { text: "# x", source: { format: "markdown" as const, xml: "# x" } },
        ],
      },
      {
        level: "Heading2" as const,
        shape: "math-block-shaped ('$$')",
        runs: [
          { text: "$$", source: { format: "markdown" as const, xml: "$$" } },
        ],
      },
      {
        level: "Heading1" as const,
        shape: "list-marker-shaped ('- item')",
        runs: [
          {
            text: "- item",
            source: { format: "markdown" as const, xml: "- item" },
          },
        ],
      },
    ])(
      "collapses to ATX with HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT when the heading's own single (break-free) line is itself $shape (ExaDev/documents.js#940)",
      ({ level, runs }) => {
        // A single-run, break-free heading has only ONE line, which is simultaneously its first and its only line — unsafeSetextBreakReason's own interrupting-construct check must therefore see it via the genuine block-start variant (as the run's first line), not merely rely on a following line ever being reached, since there is no following line at all here. Pre-fix, this exact shape (a heading whose ENTIRE text renders as one of the six interrupting constructs, with headingStyle: 'setext' as the sole reason setext was even attempted) reparsed as a CodeBlock/HorizontalRule/blockquote in place of the heading, with nothing reported to the diagnostic sink at all.
        const collector = createDiagnosticCollector();
        const written = emitMarkdown(
          doc([{ kind: "paragraph", runs, styleId: level }]),
          { headingStyle: "setext", sink: collector.sink },
        );
        expect(written).not.toContain("\n");
        const diagnostic = collector.diagnostics.find(
          (d) =>
            d.code ===
            MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        );
        expect(diagnostic).toBeDefined();

        const reparsed = lowerMarkdown(written);
        if (reparsed.kind !== "wordprocessing") {
          throw new Error("expected a wordprocessing ContentDocument");
        }
        const [headingBlock] = reparsed.sections[0]?.blocks ?? [];
        if (headingBlock?.kind !== "paragraph") {
          throw new Error("expected a paragraph block");
        }
        expect(headingBlock.styleId).toBe(level);
      },
    );
  });

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

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

describe("headings (continued)", () => {
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
});

// The write-back and round-trip footnote suites split from footnote.test.ts, carrying the minimalDocument and roundTrip harness it rests on.

import type { ContentBlock, ContentDocument } from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./block/block";
import { emitMarkdown } from "./emit/emit";
import { writeMarkdownContent } from "./write";

function blocksOf(document: ContentDocument): ContentBlock[] {
  if (document.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing document, got '${document.kind}'`,
    );
  }
  return document.sections.flatMap((section) => section.blocks);
}

import { readMarkdownContent } from "./read";
import {
  MarkdownDiagnosticCodes,
  MarkdownUnbalancedConstructMarkersError,
} from "./diagnostics/diagnostics";
import { createDiagnosticCollector } from "./test-support/diagnostics";

function minimalDocument(blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: PAGE_SIZE_A4,
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [...blocks],
      },
    ],
  };
}

function roundTrip(source: string): {
  readonly written: string;
  readonly rewritten: string;
  readonly document: ContentDocument;
  readonly reread: ContentDocument;
} {
  const document = readMarkdownContent(source).document;
  const written = writeMarkdownContent(document);
  const reread = readMarkdownContent(written).document;
  return { written, rewritten: writeMarkdownContent(reread), document, reread };
}

describe("writing footnotes back out", () => {
  it("renders an anchor construct as a definition, and a footnote-anchor extent as its reference", () => {
    expect(
      emitMarkdown(
        minimalDocument([
          {
            kind: "paragraph",
            runs: [{ text: "see" }, { text: "[^1]" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "1",
                },
                startRun: 1,
                endRun: 1,
              },
            ],
          },
          {
            kind: "constructStart",
            descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
          },
          { kind: "paragraph", runs: [{ text: "note" }] },
          { kind: "constructEnd" },
        ]),
      ),
    ).toBe("see[^1]\n\n[^1]: note");
  });

  it("spells the reference from the extent's own name, the same authority the definition marker takes its label from", () => {
    expect(
      emitMarkdown(
        minimalDocument([
          {
            kind: "paragraph",
            runs: [{ text: "see" }, { text: "" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "2",
                },
                startRun: 1,
                endRun: 1,
              },
            ],
          },
        ]),
      ),
    ).toBe("see[^2]");
  });

  it("indents a multi-block body to the continuation column a reader measures against", () => {
    expect(
      emitMarkdown(
        minimalDocument([
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "footnote",
              name: "long",
            },
          },
          { kind: "paragraph", runs: [{ text: "one" }] },
          { kind: "paragraph", runs: [{ text: "two" }] },
          { kind: "constructEnd" },
        ]),
      ),
    ).toBe("[^long]: one\n\n    two");
  });

  it("renders an empty extent as the bare marker, with no trailing space", () => {
    expect(
      emitMarkdown(
        minimalDocument([
          {
            kind: "constructStart",
            descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toBe("[^1]:");
  });

  it("escapes an ordinary run that merely looks like a reference, so it reparses as text", () => {
    const written = emitMarkdown(
      minimalDocument([
        { kind: "paragraph", runs: [{ text: "literal [^1] here" }] },
      ]),
    );
    expect(written).toBe("literal \\[\\^1\\] here");
    expect(
      parseMarkdown(`${written}\n\n[^1]: real`).document.children[0],
    ).toEqual({
      type: "paragraph",
      children: [{ type: "text", value: "literal [^1] here" }],
    });
  });

  it('degrades a footnote-anchor extent whose own name cannot be spelled as a "[^label]" marker, rather than emitting markdown its own reader cannot parse back', () => {
    // The same gate the definition half applies (isValidFootnoteLabel, src/inline/footnote.ts) and for the same reason: AnchorDescriptorSchema.name is a bare z.string(), so a name arriving from another codec may carry whitespace or a "]" this package's own [^label] grammar cannot represent. Spelling it straight into running text would emit a marker that reparses as something else (a link, or literal prose), losing the construct with no diagnostic — so the run's own materialised text renders escaped in the reference's place and the extent reports itself unrepresented.
    const whitespaceCollector = createDiagnosticCollector();
    const whitespaceWritten = emitMarkdown(
      minimalDocument([
        {
          kind: "paragraph",
          runs: [{ text: "see" }, { text: "[^My Note]" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "footnote",
                name: "My Note",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
      { sink: whitespaceCollector.sink },
    );
    expect(whitespaceWritten).toBe("see\\[\\^My Note\\]");
    expect(
      whitespaceCollector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED),
    ).toBe(true);

    const bracketCollector = createDiagnosticCollector();
    const bracketWritten = emitMarkdown(
      minimalDocument([
        {
          kind: "paragraph",
          runs: [{ text: "see" }, { text: "[^a]b]" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "footnote",
                name: "a]b",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
      { sink: bracketCollector.sink },
    );
    expect(bracketWritten).toBe("see\\[\\^a\\]b\\]");
    expect(
      bracketCollector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED),
    ).toBe(true);
  });

  it("leaves a run covered only by a RANGED footnote anchor to its own escaped text: a markdown reference is a point, and a range over several runs has no spelling", () => {
    // A foreign producer may name a footnote anchor over a sub-sequence of runs rather than at a point (odf.js's reader spells its text:note reference that way); this package's own read side never does. Only the point form is a markdown reference site, so the range renders transparently — its runs keep their own text, the same silent construct loss every other run-level extent markdown cannot spell already takes (a bookmark, a comment reference).
    const written = emitMarkdown(
      minimalDocument([
        {
          kind: "paragraph",
          runs: [{ text: "see " }, { text: "note " }, { text: "mark" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "footnote",
                name: "1",
                definition: "n1",
              },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
      ]),
    );
    expect(written).toBe("see note mark");
  });

  it("renders a construct markdown has no syntax for transparently, keeping its extent", () => {
    const collector = createDiagnosticCollector();
    const written = emitMarkdown(
      minimalDocument([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "chapter-one" },
        },
        { kind: "paragraph", runs: [{ text: "content inside a division" }] },
        { kind: "constructEnd" },
      ]),
      { sink: collector.sink },
    );
    expect(written).toBe("content inside a division");
    expect(collector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED)).toBe(
      true,
    );
  });

  it('degrades a footnote anchor whose own name cannot be spelled as a "[^label]:" marker, rather than emitting markdown its own reader cannot parse back', () => {
    // AnchorDescriptorSchema.name is a bare z.string() — document-schema.js places no grammar constraint of its own on it, so a name from another codec sharing the same ContentDocument pivot may carry whitespace or a "]" this package's own [^label] grammar (src/inline/footnote.ts) cannot represent. Spelling either straight into a marker would emit text this package's own reader reparses as something else entirely (a link reference definition, or a plain paragraph), losing the construct with no diagnostic — so both fall back to the same transparent degrade an unrepresentable construct kind already gets.
    const whitespaceCollector = createDiagnosticCollector();
    const whitespaceWritten = emitMarkdown(
      minimalDocument([
        {
          kind: "constructStart",
          descriptor: {
            kind: "anchor",
            anchorType: "footnote",
            name: "My Note",
          },
        },
        { kind: "paragraph", runs: [{ text: "body" }] },
        { kind: "constructEnd" },
      ]),
      { sink: whitespaceCollector.sink },
    );
    expect(whitespaceWritten).toBe("body");
    expect(
      whitespaceCollector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED),
    ).toBe(true);
    expect(parseMarkdown(whitespaceWritten).document.children).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "body" }] },
    ]);

    const bracketCollector = createDiagnosticCollector();
    const bracketWritten = emitMarkdown(
      minimalDocument([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "footnote", name: "a]b" },
        },
        { kind: "paragraph", runs: [{ text: "body" }] },
        { kind: "constructEnd" },
      ]),
      { sink: bracketCollector.sink },
    );
    expect(bracketWritten).toBe("body");
    expect(
      bracketCollector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED),
    ).toBe(true);
  });

  it("renders a nested construct inside a footnote body", () => {
    expect(
      emitMarkdown(
        minimalDocument([
          {
            kind: "constructStart",
            descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
          },
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "mark",
            },
          },
          { kind: "paragraph", runs: [{ text: "bookmarked note" }] },
          { kind: "constructEnd" },
          { kind: "constructEnd" },
        ]),
      ),
    ).toBe("[^1]: bookmarked note");
  });

  it("throws rather than guessing when the markers do not pair up", () => {
    let unmatchedEnd: unknown;
    try {
      emitMarkdown(minimalDocument([{ kind: "constructEnd" }]));
    } catch (error) {
      unmatchedEnd = error;
    }
    expect(unmatchedEnd).toBeInstanceOf(
      MarkdownUnbalancedConstructMarkersError,
    );
    const unmatchedEndTyped =
      unmatchedEnd as MarkdownUnbalancedConstructMarkersError;
    expect(unmatchedEndTyped.name).toBe(
      "MarkdownUnbalancedConstructMarkersError",
    );
    expect(unmatchedEndTyped.imbalanceKind).toBe("unmatchedEnd");
    expect(unmatchedEndTyped.blockIndex).toBe(0);
    expect(unmatchedEndTyped.code).toBe("md/unbalanced-construct-markers");
    expect(unmatchedEndTyped.message).toBe(
      "a constructEnd marker closes no open construct at block index 0; a block list's construct boundary markers must pair as balanced brackets",
    );

    let unclosedStart: unknown;
    try {
      emitMarkdown(
        minimalDocument([
          {
            kind: "constructStart",
            descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
          },
        ]),
      );
    } catch (error) {
      unclosedStart = error;
    }
    expect(unclosedStart).toBeInstanceOf(
      MarkdownUnbalancedConstructMarkersError,
    );
    const unclosedStartTyped =
      unclosedStart as MarkdownUnbalancedConstructMarkersError;
    expect(unclosedStartTyped.imbalanceKind).toBe("unclosedStart");
    expect(unclosedStartTyped.blockIndex).toBe(0);
    expect(unclosedStartTyped.message).toBe(
      "a constructStart marker is never closed at block index 0; a block list's construct boundary markers must pair as balanced brackets",
    );
  });
});

describe("round trip", () => {
  const sources = [
    "Text with a note[^1] here.\n\n[^1]: The note body.",
    "A[^a] and B[^b].\n\n[^a]: First.\n\n[^b]: Second.",
    "See[^long].\n\n[^long]: First paragraph.\n\n    Second paragraph.\n\n    ```\n    code\n    ```",
    "[^1]:",
    "# Heading\n\nBody[^n].\n\n[^n]: note with *emphasis*, `code`, and a [link](/u).",
    "[^1]: body\n\n    - a\n    - b",
    "Escaped \\[^1\\] stays literal.\n\n[^1]: while this one is real.",
    "Unmatched [^nope] stays literal text.",
    "Body[^1].\n\n- a\n- b\n\n[^1]: note",
    "| cell[^1] |\n| - |\n\n[^1]: a reference inside a table cell, whose extent rides the cell's own paragraph",
    // A definition directly inside a block quote or a list item (ExaDev/markdown-codec#957).
    "> Quoted[^1].\n>\n> [^1]: The note, quoted too.",
    "- Item[^1].\n\n  [^1]: The note, indented into the item.",
    "> Multi-paragraph[^1].\n>\n> [^1]: First.\n>\n>     Second.",
    "- Nested item[^1].\n\n  [^1]: One.\n\n      Two.",
    "> - Quoted list item[^1].\n>\n>   [^1]: A definition nested two containers deep.",
  ];

  it.each(sources)("reaches a fixed point for %j", (source) => {
    const { written, rewritten, document, reread } = roundTrip(source);
    expect(rewritten).toBe(written);
    expect(reread).toEqual(document);
  });

  it("keeps a definition body that a plain reparse would otherwise flatten into the surrounding flow", () => {
    const { written } = roundTrip(
      "intro[^1]\n\n[^1]: first\n\n    second\n\nafter the note",
    );
    expect(written).toBe(
      "intro[^1]\n\n[^1]: first\n\n    second\n\nafter the note",
    );
    expect(
      blocksOf(readMarkdownContent(written).document).map(
        (block) => block.kind,
      ),
    ).toEqual([
      "paragraph",
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
      "paragraph",
    ]);
  });
});

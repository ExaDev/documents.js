// Direct unit tests for lowerInlineNodes' own leaf-by-leaf construction, isolated from the parser — the round-trip suites in lower.test.ts exercise this module only through whatever shapes the real CommonMark parser happens to produce, which never reaches several of its own branches (an empty inline rawHtml literal, the rawHtml: "drop" branch for an INLINE tag specifically, an empty text/entity node, a nested bold-in-bold or strike-in-strike pair, an untitled image). Building MarkdownInlineNode trees by hand here reaches those directly and pins the exact diagnostic message text lower.test.ts's own `collector.has(code)` checks never inspect.

import { describe, expect, it } from "vitest";
import type { MarkdownInlineNode } from "../ast/ast";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import {
  MATH_INLINE_FONT_MARKER,
  MONOSPACE_FONT_FAMILY,
} from "../shared/style-constants";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import { lowerCodeBlockRun, lowerInlineNodes } from "./inline";

function lower(
  nodes: readonly MarkdownInlineNode[],
  rawHtml: "preserve" | "drop" = "preserve",
) {
  const collector = createDiagnosticCollector();
  const result = lowerInlineNodes(nodes, { sink: collector.sink, rawHtml });
  return { ...result, diagnostics: collector.diagnostics };
}

describe("lowerInlineNodes: buildRun's own conditional fields", () => {
  it("a run with no active style carries only its own text — no bold/italic/strike/hyperlink/fontFamily key at all, not even set to undefined", () => {
    const { runs } = lower([{ type: "text", value: "plain" }]);
    expect(runs).toHaveLength(1);
    expect(Object.keys(runs[0]!).sort()).toStrictEqual(["text"]);
  });
});

describe("lowerInlineNodes: text and entity leaves drop entirely when empty", () => {
  it("an empty text node produces no run at all", () => {
    const { runs } = lower([{ type: "text", value: "" }]);
    expect(runs).toHaveLength(0);
  });

  it("a non-empty text node produces exactly one run", () => {
    const { runs } = lower([{ type: "text", value: "x" }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe("x");
  });

  it("an empty entity node produces no run at all", () => {
    const { runs } = lower([{ type: "entity", raw: "&#0;", value: "" }]);
    expect(runs).toHaveLength(0);
  });

  it("a non-empty entity node produces exactly one run carrying its resolved value", () => {
    const { runs } = lower([{ type: "entity", raw: "&amp;", value: "&" }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe("&");
  });
});

describe("lowerInlineNodes: NESTED_EMPHASIS_FLATTENED fires per kind with its own precise message, only when genuinely nested", () => {
  it("a single (non-nested) emphasis span fires no diagnostic", () => {
    const { diagnostics } = lower([
      {
        type: "emphasis",
        marker: "_",
        children: [{ type: "text", value: "a" }],
      },
    ]);
    expect(diagnostics).toHaveLength(0);
  });

  it("a single (non-nested) strong span fires no diagnostic", () => {
    const { diagnostics } = lower([
      { type: "strong", marker: "*", children: [{ type: "text", value: "a" }] },
    ]);
    expect(diagnostics).toHaveLength(0);
  });

  it("a single (non-nested) strikethrough span fires no diagnostic", () => {
    const { diagnostics } = lower([
      { type: "strikethrough", children: [{ type: "text", value: "a" }] },
    ]);
    expect(diagnostics).toHaveLength(0);
  });

  it("emphasis nested inside emphasis fires with the 'emphasis' wording", () => {
    const { diagnostics, runs } = lower([
      {
        type: "emphasis",
        marker: "_",
        children: [
          {
            type: "emphasis",
            marker: "*",
            children: [{ type: "text", value: "a" }],
          },
        ],
      },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED,
      message:
        "a emphasis span is nested inside another span of the same kind; ContentRun has no nesting depth of its own, so both collapse to one flat run",
    });
    expect(runs[0]).toMatchObject({ italic: true });
  });

  it("strong nested inside strong fires with the 'strong emphasis' wording", () => {
    const { diagnostics, runs } = lower([
      {
        type: "strong",
        marker: "*",
        children: [
          {
            type: "strong",
            marker: "_",
            children: [{ type: "text", value: "a" }],
          },
        ],
      },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED,
      message:
        "a strong emphasis span is nested inside another span of the same kind; ContentRun has no nesting depth of its own, so both collapse to one flat run",
    });
    expect(runs[0]).toMatchObject({ bold: true });
  });

  it("strikethrough nested inside strikethrough fires with the 'strikethrough' wording", () => {
    const { diagnostics, runs } = lower([
      {
        type: "strikethrough",
        children: [
          {
            type: "strikethrough",
            children: [{ type: "text", value: "a" }],
          },
        ],
      },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED,
      message:
        "a strikethrough span is nested inside another span of the same kind; ContentRun has no nesting depth of its own, so both collapse to one flat run",
    });
    expect(runs[0]).toMatchObject({ strike: true });
  });
});

describe("lowerInlineNodes: inline rawHtml, both modes, both an empty and a non-empty literal", () => {
  it('rawHtml: "drop" fires RAW_HTML_DROPPED with its own exact message and produces no run', () => {
    const { runs, diagnostics } = lower(
      [{ type: "rawHtml", literal: "<span>" }],
      "drop",
    );
    expect(runs).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.RAW_HTML_DROPPED,
      message: 'inline raw HTML was dropped per the rawHtml: "drop" option',
    });
  });

  it('rawHtml: "preserve" fires RAW_HTML_PRESERVED_AS_TEXT with its own exact message even for an empty literal, and produces no run since there is no text to carry', () => {
    const { runs, diagnostics } = lower(
      [{ type: "rawHtml", literal: "" }],
      "preserve",
    );
    expect(runs).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT,
      message:
        "inline raw HTML was preserved as literal text; it will not be rendered as HTML by any consumer of the resulting ContentDocument, and its verbatim original rides the run's own markdown residue for this package's writer to re-emit as-is",
    });
  });

  it('rawHtml: "preserve" with a non-empty literal produces one run carrying the literal as both text and markdown residue', () => {
    const { runs, diagnostics } = lower(
      [{ type: "rawHtml", literal: '<span class="x">' }],
      "preserve",
    );
    expect(diagnostics).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      text: '<span class="x">',
      source: { format: "markdown", xml: '<span class="x">' },
    });
  });
});

describe("lowerInlineNodes: mathInline preserves its own exact diagnostic message and marks the run", () => {
  it("fires MATH_INLINE_PRESERVED_AS_TEXT with its own exact message and marks the run with MATH_INLINE_FONT_MARKER", () => {
    const { runs, diagnostics } = lower([
      { type: "mathInline", literal: "x^2" },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT,
      message:
        "inline math (\\( \\)) was preserved as literal raw LaTeX text; it is not parsed as LaTeX or converted to MathML by this package",
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      text: "x^2",
      fontFamily: MATH_INLINE_FONT_MARKER,
    });
  });
});

describe("lowerInlineNodes: a nested image's title drops with its own exact message, only when a title is present", () => {
  it("an untitled nested image fires no diagnostic at all", () => {
    const { diagnostics, runs } = lower([
      { type: "image", destination: "/x.png", alt: "alt text" },
    ]);
    expect(diagnostics).toHaveLength(0);
    expect(runs[0]).toMatchObject({ text: "alt text", hyperlink: "/x.png" });
  });

  it("a titled nested image fires LINK_TITLE_DROPPED with its own exact message naming the dropped title", () => {
    const { diagnostics, runs } = lower([
      {
        type: "image",
        destination: "/x.png",
        title: "a title",
        alt: "alt text",
      },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED,
      message:
        'image title "a title" has no ContentRun equivalent and was dropped',
    });
    expect(runs[0]).toMatchObject({ text: "alt text", hyperlink: "/x.png" });
  });
});

describe("lowerCodeBlockRun", () => {
  it("wraps a code block's literal text in a single monospace run", () => {
    expect(lowerCodeBlockRun("console.log(1);")).toStrictEqual({
      text: "console.log(1);",
      fontFamily: MONOSPACE_FONT_FAMILY,
    });
  });
});

// Direct unit tests for the ContentRun[] -> markdown inline writer (src/emit/inline.ts). src/emit/emit.test.ts already exercises this module through whole-document emission, which is the right level for "does a paragraph come out right"; this file instead builds the exact run sequence and construct extents each individual writing rule turns on, and asserts the exact string it produces, so a rule's own boundary (which delimiter character is chosen, where a code span's padding is added, which of two overlapping title extents wins) has a test naming it rather than only being covered incidentally by some larger document's rendering.

import type { ContentRun, RunConstructExtent } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_EMPHASIS_MARKER } from "../defaults/defaults";
import {
  MarkdownDiagnosticCodes,
  NOOP_MARKDOWN_DIAGNOSTIC_SINK,
} from "../diagnostics/diagnostics";
import {
  MATH_INLINE_FONT_MARKER,
  MONOSPACE_FONT_FAMILY,
} from "../shared/style-constants";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import type { InlineEmitContext } from "./inline";
import {
  emitRuns,
  escapeLinkDestination,
  escapeMarkdownText,
  renderLinkTitle,
} from "./inline";

function context(
  emphasisMarker: string = DEFAULT_EMPHASIS_MARKER,
): InlineEmitContext {
  return { sink: NOOP_MARKDOWN_DIAGNOSTIC_SINK, emphasisMarker };
}

function render(
  runs: readonly ContentRun[],
  emphasisMarker?: string,
  constructs?: readonly RunConstructExtent[],
): string {
  return emitRuns(runs, context(emphasisMarker), constructs);
}

function codeSpan(text: string): string {
  return render([{ text, fontFamily: MONOSPACE_FONT_FAMILY }]);
}

// The one titled-link shape every ordering test below varies: four runs whose middle two share a hyperlink, so the group the title is resolved for (runs 1 and 2) is a proper subset of the paragraph and an extent can genuinely be wider than it on either side.
function titledLinkGroup(constructs: readonly RunConstructExtent[]): string {
  return render(
    [
      { text: "p" },
      { text: "a", hyperlink: "/u" },
      { text: "b", hyperlink: "/u" },
      { text: "q" },
    ],
    undefined,
    constructs,
  );
}

function linkExtent(
  startRun: number,
  endRun: number,
  title?: string,
): RunConstructExtent {
  return {
    descriptor: {
      kind: "link",
      target: { kind: "external", uri: "/u" },
      ...(title === undefined ? {} : { title }),
    },
    startRun,
    endRun,
  };
}

describe("escapeMarkdownText", () => {
  it("normalises each of CommonMark's three line-ending spellings to one backslash-escaped LF, consuming a CRLF's own pair in a single step rather than leaving the text after it behind", () => {
    expect(escapeMarkdownText("a\nb")).toBe("a\\\nb");
    expect(escapeMarkdownText("a\r\nb")).toBe("a\\\nb");
    expect(escapeMarkdownText("a\rb")).toBe("a\\\nb");
  });

  it("consumes the SECOND half of a CRLF pair only behind a genuine CR, so two consecutive LFs stay two separate escaped breaks rather than being read as one pair", () => {
    expect(escapeMarkdownText("a\n\nb")).toBe("a\\\n\\\nb");
    expect(escapeMarkdownText("a\r\rb")).toBe("a\\\n\\\nb");
  });

  it("leaves parentheses bare while escaping the ASCII punctuation around them, and escapes every character of a run of them", () => {
    expect(escapeMarkdownText("(a)*_")).toBe("(a)\\*\\_");
  });
});

describe("code spans (a Courier New run)", () => {
  it("sizes the fence against the longest CONTIGUOUS run of backticks, resetting the count at every non-backtick character", () => {
    expect(codeSpan("a`b`c")).toBe("``a`b`c``");
    expect(codeSpan("a``b")).toBe("```a``b```");
  });

  it("pads a span whose content touches a backtick at either end, so the content cannot fuse with its own fence", () => {
    expect(codeSpan("`a")).toBe("`` `a ``");
    expect(codeSpan("a`")).toBe("`` a` ``");
  });

  it("pads only when the content begins AND ends with a space, which is the exact shape a reparse strips a space off each end of", () => {
    expect(codeSpan("a ")).toBe("`a `");
    expect(codeSpan(" a")).toBe("` a`");
    expect(codeSpan("  a  ")).toBe("`   a   `");
  });

  it("leaves a content string of nothing but spaces unpadded, the stripping rule's own explicit exemption", () => {
    expect(codeSpan("   ")).toBe("`   `");
  });

  it("reports CODE_SPAN_AS_MONOSPACE_RUN, naming why a monospace run and a real code span are indistinguishable on the way back out", () => {
    const collector = createDiagnosticCollector();
    emitRuns([{ text: "x", fontFamily: MONOSPACE_FONT_FAMILY }], {
      sink: collector.sink,
      emphasisMarker: DEFAULT_EMPHASIS_MARKER,
    });
    expect(
      collector.diagnostics.find(
        (diagnostic) =>
          diagnostic.code ===
          MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN,
      )?.message,
    ).toBe(
      "a run styled with the Courier New font family is rendered as a code span; a genuinely monospace run from another format is indistinguishable from a real markdown code span on the way back out",
    );
  });
});

describe("footnote reference anchors", () => {
  const footnoteExtent = (
    name: string,
    startRun: number,
    endRun: number,
  ): RunConstructExtent => ({
    descriptor: { kind: "anchor", anchorType: "footnote", name },
    startRun,
    endRun,
  });

  it("spells a POINT footnote anchor's own run as its [^label] marker, taking the label from the extent rather than from the run's text", () => {
    expect(
      render([{ text: "[^1]" }], undefined, [footnoteExtent("1", 0, 0)]),
    ).toBe("[^1]");
  });

  it("leaves a RANGED footnote anchor's runs as ordinary escaped text, since a markdown reference is a point and a range over several runs has no single-run spelling", () => {
    expect(
      render([{ text: "a" }, { text: "b" }], undefined, [
        footnoteExtent("1", 0, 1),
      ]),
    ).toBe("ab");
  });

  it("leaves a non-footnote anchor's own point extent alone, however exactly it names the run", () => {
    expect(
      render([{ text: "a" }], undefined, [
        {
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "b" },
          startRun: 0,
          endRun: 0,
        },
      ]),
    ).toBe("a");
  });

  it("reports CONSTRUCT_UNREPRESENTED, naming the label, for a reference anchor whose name cannot be spelled as a [^label] marker", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitRuns(
      [{ text: "x" }],
      { sink: collector.sink, emphasisMarker: DEFAULT_EMPHASIS_MARKER },
      [footnoteExtent("a b", 0, 0)],
    );
    expect(markdown).toBe("x");
    expect(
      collector.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      )?.message,
    ).toBe(
      'a footnote reference anchor\'s own name "a b" cannot be spelled as a "[^label]" marker (whitespace or "]" would reparse as something else); the run\'s own text renders escaped in its place, but the reference itself is not represented',
    );
  });

  it("looks a run's own construct extents up at its position in the PARAGRAPH, not at its offset inside whichever style group it landed in", () => {
    expect(
      render(
        [{ text: "a" }, { text: "b", bold: true }, { text: "x" }],
        undefined,
        [footnoteExtent("n", 2, 2)],
      ),
    ).toBe("a**b**[^n]");
  });
});

describe("emphasis delimiter choice", () => {
  it("falls back to '*' when the configured '_' would sit intraword against either end of the body", () => {
    expect(render([{ text: "a", italic: true }])).toBe("*a*");
    expect(render([{ text: "a)", italic: true }])).toBe("*a)*");
    expect(render([{ text: "(a", italic: true }])).toBe("*(a*");
  });

  it("keeps the configured '_' when NEITHER end of the body is a word character, since the intraword restriction is about adjacency, not about the body's contents", () => {
    expect(render([{ text: "(a)", italic: true }])).toBe("_(a)_");
  });

  it("falls back to the other delimiter when the configured one already sits at the body's own leading or trailing edge", () => {
    expect(
      render(
        [
          { text: "a", bold: true, italic: true },
          { text: "(b)", bold: true },
        ],
        "*",
      ),
    ).toBe("__*a*(b)__");
    expect(
      render(
        [
          { text: "(a)", bold: true },
          { text: "b", bold: true, italic: true },
        ],
        "*",
      ),
    ).toBe("__(a)*b*__");
  });

  it("falls back to the other delimiter when the immediately preceding sibling's own rendering ENDS with the configured one, which would otherwise fuse the two delimiter runs into one", () => {
    expect(
      render([
        { text: "x" },
        { text: "(a)", italic: true },
        { text: "(b)", bold: true },
      ]),
    ).toBe("x_(a)_**(b)**");
  });

  it("returns to the configured delimiter when NEITHER of the only two CommonMark offers is collision-free", () => {
    expect(
      render([
        { text: "x" },
        { text: "(a)", italic: true },
        { text: "b", bold: true },
      ]),
    ).toBe("x_(a)_**b**");
  });

  it("wraps an empty styled run in a bare delimiter pair, with no intraword risk to steer the choice either way", () => {
    expect(render([{ text: "", bold: true }])).toBe("____");
  });
});

describe("nested style ordering", () => {
  it("resolves the least-fragmented key outermost, breaking a tie by STYLE_KEYS' own bold-then-italic-then-strike order", () => {
    expect(render([{ text: "a", bold: true, italic: true }])).toBe("__*a*__");
    expect(render([{ text: "a", bold: true, italic: true }], "*")).toBe(
      "__*a*__",
    );
  });

  it("renders one continuous stretch of hyperlink-free runs as a single nested wrap, not as one independently-wrapped fragment per run", () => {
    expect(
      render([
        { text: "a", bold: true },
        { text: "b", bold: true },
      ]),
    ).toBe("**ab**");
  });
});

describe("autolinks", () => {
  it("uses the bare <dest> form for a run whose own text equals its own destination, and for the mailto: spelling of the same", () => {
    expect(render([{ text: "foo", hyperlink: "foo" }])).toBe("<foo>");
    expect(render([{ text: "a@b.test", hyperlink: "mailto:a@b.test" }])).toBe(
      "<a@b.test>",
    );
  });

  it("refuses the bare form for a run carrying any styling of its own, each of which needs its own rendering inside the link text instead", () => {
    expect(render([{ text: "foo", hyperlink: "foo", bold: true }])).toBe(
      "[**foo**](foo)",
    );
    expect(render([{ text: "foo", hyperlink: "foo", italic: true }])).toBe(
      "[*foo*](foo)",
    );
    expect(render([{ text: "foo", hyperlink: "foo", strike: true }])).toBe(
      "[~~foo~~](foo)",
    );
    expect(
      render([
        { text: "foo", hyperlink: "foo", fontFamily: MONOSPACE_FONT_FAMILY },
      ]),
    ).toBe("[`foo`](foo)");
    expect(
      render([
        { text: "foo", hyperlink: "foo", fontFamily: MATH_INLINE_FONT_MARKER },
      ]),
    ).toBe("[\\(foo\\)](foo)");
  });

  it("refuses the bare form for a run that is also a footnote reference site, which needs its own [^label] spelling", () => {
    expect(
      render([{ text: "foo", hyperlink: "foo" }], undefined, [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "n" },
          startRun: 0,
          endRun: 0,
        },
      ]),
    ).toBe("[[^n]](foo)");
  });

  it("refuses the bare form for an empty destination, which <> cannot spell at all", () => {
    expect(render([{ text: "", hyperlink: "" }])).toBe("[]()");
  });

  it("refuses the bare form when the run's own text merely resembles, rather than equals, its destination", () => {
    expect(render([{ text: "foo", hyperlink: "foot" }])).toBe("[foo](foot)");
  });
});

describe("hyperlink grouping", () => {
  it("merges two adjacent runs sharing one hyperlink into a single link, reporting ADJACENT_LINKS_MERGED with the count and destination named", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitRuns(
      [
        { text: "a", hyperlink: "/u" },
        { text: "b", hyperlink: "/u" },
      ],
      { sink: collector.sink, emphasisMarker: DEFAULT_EMPHASIS_MARKER },
    );
    expect(markdown).toBe("[ab](/u)");
    expect(
      collector.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED,
      )?.message,
    ).toBe(
      '2 adjacent runs share the hyperlink "/u"; markdown has no way to place two link boundaries back to back, so they render as one link spanning their combined text',
    );
  });

  it("does NOT report ADJACENT_LINKS_MERGED for a link of exactly one run, which merged nothing", () => {
    const collector = createDiagnosticCollector();
    emitRuns([{ text: "a", hyperlink: "/u" }], {
      sink: collector.sink,
      emphasisMarker: DEFAULT_EMPHASIS_MARKER,
    });
    expect(collector.has(MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED)).toBe(
      false,
    );
  });

  it("refuses the bare autolink form for a MERGED group even when its own first run is autolink-shaped, since the bare form has no room for the runs after it", () => {
    expect(
      render([
        { text: "foo", hyperlink: "foo" },
        { text: "bar", hyperlink: "foo" },
      ]),
    ).toBe("[foobar](foo)");
  });
});

describe("escapeLinkDestination", () => {
  it("leaves a destination needing no angle brackets exactly as it stands", () => {
    expect(escapeLinkDestination("/a/b")).toBe("/a/b");
  });

  it("wraps a destination carrying whitespace or a parenthesis in angle brackets, escaping any angle bracket of its own inside them", () => {
    expect(escapeLinkDestination("a b<c>")).toBe("<a b\\<c\\>>");
    expect(escapeLinkDestination("a(b)")).toBe("<a(b)>");
  });
});

describe("renderLinkTitle", () => {
  it("collapses a whole run of line endings to ONE space, rather than one space per line ending", () => {
    expect(renderLinkTitle("a\n\nb")).toBe("a b");
    expect(renderLinkTitle("a\r\nb")).toBe("a b");
  });

  it("escapes the two characters a double-quoted title grammar gives meaning to, and nothing else", () => {
    expect(renderLinkTitle('say "hi" \\ done')).toBe('say \\"hi\\" \\\\ done');
  });
});

describe("the link title a covering run-level extent supplies", () => {
  it("renders the title of the one extent covering the group, whichever side of the group the extent extends past", () => {
    expect(titledLinkGroup([linkExtent(0, 4, "t")])).toBe('p[ab](/u "t")q');
  });

  it("ignores an extent that does not cover the whole group", () => {
    expect(titledLinkGroup([linkExtent(2, 4, "t")])).toBe("p[ab](/u)q");
    expect(titledLinkGroup([linkExtent(0, 2, "t")])).toBe("p[ab](/u)q");
  });

  it("takes the innermost covering extent by LARGEST startRun, whichever order the two extents are listed in", () => {
    expect(
      titledLinkGroup([linkExtent(0, 4, "outer"), linkExtent(1, 3, "inner")]),
    ).toBe('p[ab](/u "inner")q');
    expect(
      titledLinkGroup([linkExtent(1, 3, "inner"), linkExtent(0, 4, "outer")]),
    ).toBe('p[ab](/u "inner")q');
  });

  it("breaks a startRun tie by SMALLEST endRun, whichever order the two extents are listed in", () => {
    expect(
      titledLinkGroup([linkExtent(0, 4, "outer"), linkExtent(0, 3, "inner")]),
    ).toBe('p[ab](/u "inner")q');
    expect(
      titledLinkGroup([linkExtent(0, 3, "inner"), linkExtent(0, 4, "outer")]),
    ).toBe('p[ab](/u "inner")q');
  });

  it("keeps the FIRST of two extents whose ranges are identical, since neither is tighter than the other", () => {
    expect(
      titledLinkGroup([linkExtent(0, 4, "first"), linkExtent(0, 4, "second")]),
    ).toBe('p[ab](/u "first")q');
  });

  it("prefers the larger startRun over the smaller endRun when two covering extents CROSS rather than nest", () => {
    expect(
      titledLinkGroup([linkExtent(1, 4, "inner"), linkExtent(0, 3, "wider")]),
    ).toBe('p[ab](/u "inner")q');
  });

  it("skips an untitled link extent entirely rather than letting it win as the tightest and carry no title", () => {
    expect(titledLinkGroup([linkExtent(0, 4, "outer"), linkExtent(1, 3)])).toBe(
      'p[ab](/u "outer")q',
    );
  });

  it("skips an extent of any other descriptor kind, which annotates nothing about this link", () => {
    expect(
      titledLinkGroup([
        linkExtent(0, 4, "outer"),
        {
          descriptor: { kind: "division" },
          startRun: 1,
          endRun: 3,
        },
      ]),
    ).toBe('p[ab](/u "outer")q');
  });
});

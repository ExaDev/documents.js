// Direct unit tests for extractFrontMatter's own scalar/keyword-list parsing and block-boundary scanning — lower.test.ts (round-tripped through readMarkdown) only exercises whichever quoting/whitespace/malformed shapes its own fixtures happen to contain, never the exact quote-length boundary (a lone quote character, an empty quoted value), a mismatched-bracket keywords list, a blank line inside the block, or a document with no front matter at all.

import { describe, expect, it } from "vitest";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import { extractFrontMatter } from "./front-matter";

describe("extractFrontMatter: no front matter present at all", () => {
  it("leaves an ordinary document entirely unchanged", () => {
    const result = extractFrontMatter("# Title\n\nbody\n");
    expect(result).toStrictEqual({
      metadata: {},
      rest: "# Title\n\nbody\n",
      source: undefined,
    });
  });

  it("leaves a document with an unclosed leading '---' unchanged — CommonMark's own thematic-break-then-paragraph reading", () => {
    const source = "---\ntitle: x\nno closing delimiter\n";
    const result = extractFrontMatter(source);
    expect(result).toStrictEqual({
      metadata: {},
      rest: source,
      source: undefined,
    });
  });

  it("leaves a document unchanged even when a later line happens to look like a closing delimiter, since the first line never opened a block at all", () => {
    // The first line's own check must genuinely gate the whole function: without it, a body that merely contains a bare "---" or "..." later on could be misread as if it closed a front-matter block that was never opened.
    const source = "not front matter\n---\nbody\n";
    const result = extractFrontMatter(source);
    expect(result).toStrictEqual({
      metadata: {},
      rest: source,
      source: undefined,
    });
  });
});

describe("extractFrontMatter: closing delimiter shapes", () => {
  it("accepts '...' as a closing delimiter, not just a second '---'", () => {
    const result = extractFrontMatter("---\ntitle: x\n...\nbody\n");
    expect(result.metadata).toStrictEqual({ title: "x" });
    expect(result.rest).toBe("body\n");
  });

  it("skips a blank line inside the block without ending it", () => {
    const result = extractFrontMatter(
      "---\ntitle: x\n\nauthor: y\n---\nbody\n",
    );
    expect(result.metadata).toStrictEqual({ title: "x", author: "y" });
  });

  it("silently skips a line that is not key: value shaped, with no diagnostic", () => {
    const collector = createDiagnosticCollector();
    const result = extractFrontMatter(
      "---\ntitle: x\nnot a key value line\n---\nbody\n",
      collector.sink,
    );
    expect(result.metadata).toStrictEqual({ title: "x" });
    expect(collector.diagnostics).toHaveLength(0);
  });
});

describe("extractFrontMatter: scalar quote stripping, at the exact length-2 boundary", () => {
  it("strips a genuinely double-quoted value", () => {
    expect(
      extractFrontMatter('---\ntitle: "abc"\n---\n').metadata,
    ).toStrictEqual({
      title: "abc",
    });
  });

  it("strips a genuinely single-quoted value", () => {
    expect(
      extractFrontMatter("---\ntitle: 'abc'\n---\n").metadata,
    ).toStrictEqual({
      title: "abc",
    });
  });

  it("strips an empty double-quoted value (length exactly 2)", () => {
    expect(extractFrontMatter('---\ntitle: ""\n---\n').metadata).toStrictEqual({
      title: "",
    });
  });

  it("does not strip a lone quote character (length 1, below the boundary)", () => {
    expect(extractFrontMatter('---\ntitle: "\n---\n').metadata).toStrictEqual({
      title: '"',
    });
  });

  it("does not strip when only the opening quote matches — no closing quote at all", () => {
    expect(
      extractFrontMatter('---\ntitle: "abc\n---\n').metadata,
    ).toStrictEqual({
      title: '"abc',
    });
  });

  it("does not strip when only the closing quote matches — no opening quote at all", () => {
    expect(
      extractFrontMatter('---\ntitle: abc"\n---\n').metadata,
    ).toStrictEqual({
      title: 'abc"',
    });
  });

  it("does not strip mismatched quote kinds (opens single, closes double)", () => {
    expect(
      extractFrontMatter(`---\ntitle: 'abc"\n---\n`).metadata,
    ).toStrictEqual({
      title: `'abc"`,
    });
  });

  it("leaves an unquoted value untouched", () => {
    expect(extractFrontMatter("---\ntitle: abc\n---\n").metadata).toStrictEqual(
      {
        title: "abc",
      },
    );
  });

  // The single-quote checks mirror the double-quote ones above exactly — isDoubleQuoted short-circuits on startsWith('"') before ever reaching endsWith for a single-quoted value, so only a value that itself exercises isSingleQuoted's own length/startsWith/endsWith checks at each boundary can kill a mutant in it.
  it("does not strip a lone single-quote character (length 1, below the boundary)", () => {
    expect(extractFrontMatter("---\ntitle: '\n---\n").metadata).toStrictEqual({
      title: "'",
    });
  });

  it("strips an empty single-quoted value (length exactly 2)", () => {
    expect(extractFrontMatter("---\ntitle: ''\n---\n").metadata).toStrictEqual({
      title: "",
    });
  });

  it("does not strip when only the opening single quote matches — no closing quote at all", () => {
    expect(
      extractFrontMatter("---\ntitle: 'abc\n---\n").metadata,
    ).toStrictEqual({
      title: "'abc",
    });
  });

  it("does not strip when only the closing single quote matches — no opening quote at all", () => {
    expect(
      extractFrontMatter("---\ntitle: abc'\n---\n").metadata,
    ).toStrictEqual({
      title: "abc'",
    });
  });
});

describe("extractFrontMatter: keywords, both the bracketed and the bare comma-separated shape", () => {
  it("parses a bracketed flow-sequence list", () => {
    expect(
      extractFrontMatter("---\nkeywords: [a, b, c]\n---\n").metadata.keywords,
    ).toStrictEqual(["a", "b", "c"]);
  });

  it("parses a bare comma-separated fallback with no brackets at all", () => {
    expect(
      extractFrontMatter("---\nkeywords: a, b, c\n---\n").metadata.keywords,
    ).toStrictEqual(["a", "b", "c"]);
  });

  it("trims outer whitespace around a bracketed list before checking for the brackets", () => {
    expect(
      extractFrontMatter("---\nkeywords:   [a, b]   \n---\n").metadata.keywords,
    ).toStrictEqual(["a", "b"]);
  });

  it("does not treat a value as bracketed when only the opening bracket is present", () => {
    // Malformed: starts with "[" but never closes — read as one bare comma-separated line instead, exactly as this module's own "not a real YAML parser" scope promises. The unstripped leading "[" survives on the first item.
    expect(
      extractFrontMatter("---\nkeywords: [a, b\n---\n").metadata.keywords,
    ).toStrictEqual(["[a", "b"]);
  });

  it("filters out an empty item from a trailing comma", () => {
    expect(
      extractFrontMatter("---\nkeywords: a, b,\n---\n").metadata.keywords,
    ).toStrictEqual(["a", "b"]);
  });

  it("keeps a genuinely single-character item, right at the length-0 filter boundary", () => {
    expect(
      extractFrontMatter("---\nkeywords: a,,b\n---\n").metadata.keywords,
    ).toStrictEqual(["a", "b"]);
  });

  it("does not treat a value as bracketed when only the closing bracket is present", () => {
    // Malformed the other way round: ends with "]" but never opens — still read as one bare comma-separated line, since both the opening AND closing bracket are required together. The unstripped trailing "]" survives on the last item.
    expect(
      extractFrontMatter("---\nkeywords: a, b]\n---\n").metadata.keywords,
    ).toStrictEqual(["a", "b]"]);
  });
});

describe("extractFrontMatter: direction, a two-member enum that silently drops any other value", () => {
  it("maps both recognised direction values", () => {
    expect(
      extractFrontMatter("---\ndirection: rtl\n---\n").metadata,
    ).toStrictEqual({
      direction: "rtl",
    });
    expect(
      extractFrontMatter("---\ndirection: ltr\n---\n").metadata,
    ).toStrictEqual({
      direction: "ltr",
    });
  });

  it("silently drops an unrecognised direction value — no FRONT_MATTER_KEY_UNMAPPED, since the key itself is recognised", () => {
    const collector = createDiagnosticCollector();
    const result = extractFrontMatter(
      "---\ndirection: sideways\n---\n",
      collector.sink,
    );
    expect(result.metadata).toStrictEqual({});
    expect(collector.diagnostics).toHaveLength(0);
  });
});

describe("extractFrontMatter: an unrecognised key reports FRONT_MATTER_KEY_UNMAPPED with its own exact message and 1-based line number", () => {
  it("fires with the key name and the line it appeared on", () => {
    const collector = createDiagnosticCollector();
    const result = extractFrontMatter(
      "---\ntitle: x\ncustomField: y\n---\n",
      collector.sink,
    );
    expect(result.metadata).toStrictEqual({ title: "x" });
    expect(collector.diagnostics).toHaveLength(1);
    expect(collector.diagnostics[0]).toMatchObject({
      code: MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED,
      message:
        'front matter key "customField" has no LayoutMetadata equivalent and was dropped from the metadata; its original spelling survives in the verbatim front-matter block this package\'s own writer can re-emit',
      line: 3,
    });
  });
});

describe("extractFrontMatter: rest and source split exactly at the closing delimiter", () => {
  it("carries the verbatim block (delimiters included) as source and everything after as rest", () => {
    const result = extractFrontMatter("---\ntitle: x\n---\nbody\nmore\n");
    expect(result.source).toBe("---\ntitle: x\n---");
    expect(result.rest).toBe("body\nmore\n");
  });
});

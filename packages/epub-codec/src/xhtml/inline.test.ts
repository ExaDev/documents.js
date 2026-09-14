import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic } from "../diagnostics";
import type { XhtmlReadContext } from "./context";
import { buildInlineRuns } from "./inline";
import { readXhtmlBody } from "./read";

const CONTENT_WIDTH_PT = 451.28; // A4 minus 1in margins each side, matching src/read.ts's own default section geometry

function body(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>${inner}</body></html>`;
}

function read(
  xml: string,
  sink: (d: EpubDiagnostic) => void = () => undefined,
) {
  return readXhtmlBody(xml, {
    resolveImage: () => undefined,
    sink,
    sourceHref: "chapter1.xhtml",
    contentWidthPt: CONTENT_WIDTH_PT,
  }).blocks;
}

describe("styledRun: a plain run carries none of the optional formatting keys", () => {
  it("produces exactly {text} for a run with no bold/italic/underline/strike/fontFamily/verticalAlign/direction/hyperlink applying", () => {
    const blocks = read(body("<p>plain text</p>"));
    expect(blocks).toStrictEqual([
      { kind: "paragraph", runs: [{ text: "plain text" }] },
    ]);
  });
});

describe("styledRun: each optional key is carried only when its own style applies", () => {
  it("carries fontFamily for <code>/<kbd>/<samp> (the monospace style), and not otherwise", () => {
    const blocks = read(
      body("<p><code>c</code> <kbd>k</kbd> <samp>s</samp></p>"),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "c", fontFamily: "Courier New" },
        { text: " " },
        { text: "k", fontFamily: "Courier New" },
        { text: " " },
        { text: "s", fontFamily: "Courier New" },
      ],
    });
  });

  it("carries verticalAlign for <sub>/<sup>, and not otherwise", () => {
    const blocks = read(body("<p>H<sub>2</sub>O<sup>+</sup></p>"));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "H" },
        { text: "2", verticalAlign: "subscript" },
        { text: "O" },
        { text: "+", verticalAlign: "superscript" },
      ],
    });
  });

  it('carries direction for a dir="rtl" element, and not otherwise', () => {
    const blocks = read(body('<p>plain <span dir="rtl">rtl text</span></p>'));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "plain " }, { text: "rtl text", direction: "rtl" }],
    });
  });

  it('carries direction for a dir="ltr" element too, not only "rtl"', () => {
    const blocks = read(body('<p>plain <span dir="ltr">ltr text</span></p>'));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "plain " }, { text: "ltr text", direction: "ltr" }],
    });
  });
});

describe("appendElement: each tag alias is matched individually, not only its sibling", () => {
  it("<b> applies bold, the same as <strong>", () => {
    const blocks = read(body("<p><b>bold</b></p>"));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "bold", bold: true }],
    });
  });

  it("<i> applies italic, the same as <em>", () => {
    const blocks = read(body("<p><i>italic</i></p>"));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "italic", italic: true }],
    });
  });

  it("<strike> applies strike, the same as <s>/<del>", () => {
    const blocks = read(body("<p><strike>gone</strike></p>"));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "gone", strike: true }],
    });
  });

  it("<del> applies strike, the same as <s>/<strike>", () => {
    const blocks = read(body("<p><del>gone</del></p>"));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "gone", strike: true }],
    });
  });
});

describe("buildInlineRuns: an empty text-like node produces no run", () => {
  it("skips an empty CDATA section between two real text nodes, rather than inserting a blank run", () => {
    const blocks = read(body("<p>before<![CDATA[]]>after</p>"));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "before" }, { text: "after" }],
    });
  });
});

describe("appendImageFallback: an <img> reached while building a flat run sequence", () => {
  it("names the real src attribute in its own diagnostic message, not a bare <img>", () => {
    const sink = vi.fn<(d: EpubDiagnostic) => void>();
    read(
      body(
        '<p><a href="unresolved.xhtml"><img src="pic.png" alt="a pic"/></a></p>',
      ),
      sink,
    );
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-inline-unsupported" }),
    );
    const call = sink.mock.calls.find(
      ([d]) => d.code === "epub/image-inline-unsupported",
    );
    expect(call?.[0].message).toContain('<img src="pic.png">');
  });

  it("degrades to a run carrying the alt text when alt is present", () => {
    const blocks = read(
      body('<p><span><img src="pic.png" alt="a pic"/></span></p>'),
    );
    const paragraph = blocks[0];
    expect(paragraph?.kind).toBe("paragraph");
    if (paragraph?.kind === "paragraph") {
      expect(paragraph.runs).toContainEqual({ text: "a pic" });
    }
  });

  it("adds no run at all when alt is absent", () => {
    const blocks = read(
      body(
        '<p>before <a href="unresolved.xhtml"><img src="pic.png"/></a> after</p>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "before " }, { text: " after" }],
    });
  });

  it("adds no run at all when alt is present but empty", () => {
    const blocks = read(
      body(
        '<p>before <a href="unresolved.xhtml"><img src="pic.png" alt=""/></a> after</p>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "before " }, { text: " after" }],
    });
  });
});

describe("appendAnchor: an href resolving to no target", () => {
  it("degrades an empty href (defined, zero-length) to plain nested content with no hyperlink at all", () => {
    const blocks = read(body('<p><a href="">plain</a></p>'));
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "plain" }],
    });
  });

  it("fires no LINK_TARGET_EXTERNAL_ONLY diagnostic for a genuine external URI (a real scheme present)", () => {
    const sink = vi.fn();
    read(body('<p><a href="https://example.com">site</a></p>'), sink);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/link-target-external-only" }),
    );
  });

  it("fires no LINK_TARGET_EXTERNAL_ONLY diagnostic for an unresolved same-document fragment", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<p><a href="#nonexistent-fragment">ghost link</a></p>'),
      sink,
    );
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/link-target-external-only" }),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "ghost link", hyperlink: "#nonexistent-fragment" }],
    });
  });

  it("fires LINK_TARGET_EXTERNAL_ONLY for a relative href with no scheme at its own start, even when a colon appears later in the string, naming the real href in its own message", () => {
    const sink = vi.fn<(d: EpubDiagnostic) => void>();
    read(body('<p><a href="images/note:1.xhtml">later chapter</a></p>'), sink);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/link-target-external-only" }),
    );
    const call = sink.mock.calls.find(
      ([d]) => d.code === "epub/link-target-external-only",
    );
    expect(call?.[0].message).toBe(
      'href "images/note:1.xhtml" carries no URI scheme and is not a same-document fragment; it is stored verbatim on ContentRun.hyperlink without resolution against the package\'s own manifest',
    );
  });
});

describe("appendAnchor: nested constructs inside a resolved anchor are rebased, not dropped", () => {
  it("keeps an inner resolved anchor's own construct, shifted by the outer anchor's own already-pushed run count", () => {
    const idElements = new Map();
    const targets = new Map([
      ["outer", { anchorType: "footnote" as const, name: "outer" }],
      ["inner", { anchorType: "bookmark" as const, name: "inner" }],
    ]);
    const context: XhtmlReadContext = {
      resolveImage: () => undefined,
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      idElements,
      anchorTargets: targets,
      resolveAnchorHref: (href) => targets.get(href.replace("#", "")),
      quoteDepth: 0,
    };
    const innerAnchor = {
      type: "element" as const,
      tag: "a",
      attributes: [{ name: "href", value: "#inner" }],
      children: [{ type: "text" as const, value: "Y" }],
    };
    const outerAnchor = {
      type: "element" as const,
      tag: "a",
      attributes: [{ name: "href", value: "#outer" }],
      children: [{ type: "text" as const, value: "X" }, innerAnchor],
    };
    const result = buildInlineRuns([outerAnchor], {}, context);
    expect(result.runs).toEqual([{ text: "X" }, { text: "Y" }]);
    expect(result.constructs).toContainEqual({
      descriptor: {
        kind: "link",
        target: { kind: "internal", anchor: "inner" },
      },
      startRun: 1,
      endRun: 2,
    });
    expect(result.constructs).toContainEqual({
      descriptor: { kind: "anchor", anchorType: "footnote", name: "outer" },
      startRun: 0,
      endRun: 2,
    });
  });
});

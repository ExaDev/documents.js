// Direct unit tests for this module's own conformance-oracle rendering, isolated from the parser -- src/conformance.test.ts and src/gfm-conformance.test.ts only exercise renderDocumentToHtml through whatever the real CommonMark/GFM corpora happen to contain, which never reaches several of this renderer's own branches: math (a Pandoc/GFM extension outside both corpora), footnote definitions/references (a GitHub extension outside both), an apostrophe or a single-hex-digit byte in an href, and a table column with no alignment. Building MarkdownBlockNode/MarkdownDocumentNode trees by hand here reaches those directly.

import { describe, expect, it } from "vitest";
import type { MarkdownBlockNode, MarkdownDocumentNode } from "../ast/ast";
import { escapeHref, renderDocumentToHtml, renderInlines } from "./render";

function render(children: MarkdownBlockNode[]): string {
  const document: MarkdownDocumentNode = { type: "document", children };
  return renderDocumentToHtml(document);
}

describe("escapeHref", () => {
  it("passes an apostrophe through as the &#x27; entity, not a percent escape", () => {
    expect(escapeHref("'")).toBe("&#x27;");
  });

  it("pads a single hex digit's percent escape to two digits", () => {
    // U+0007 (BEL) is ASCII, not alphanumeric, not in the safe-punctuation set -- its own byte value is 7, whose hex digit "7" needs a leading zero. Built via fromCharCode rather than a literal escape so the source never carries a raw, invisible control byte.
    expect(escapeHref(String.fromCharCode(7))).toBe("%07");
  });

  it("leaves a two-hex-digit byte unpadded", () => {
    // '<' is byte 0x3C -- already two hex digits, nothing to pad.
    expect(escapeHref("<")).toBe("%3C");
  });
});

describe("renderInlines: footnote reference and inline math, neither in the corpora this renderer otherwise checks against", () => {
  it("renders a footnote reference as its own escaped source spelling", () => {
    expect(renderInlines([{ type: "footnoteReference", label: "1" }])).toBe(
      "[^1]",
    );
  });

  it("renders inline math wrapped back in its own \\( \\) delimiters", () => {
    expect(renderInlines([{ type: "mathInline", literal: "x^2" }])).toBe(
      "\\(x^2\\)",
    );
  });

  it("renders an empty inline math span as bare delimiters, not nothing", () => {
    expect(renderInlines([{ type: "mathInline", literal: "" }])).toBe("\\(\\)");
  });
});

describe("renderDocumentToHtml: display math and footnote definitions, neither in the corpora this renderer otherwise checks against", () => {
  it("renders a math block wrapped in its own $$ delimiters, escaped", () => {
    expect(render([{ type: "mathBlock", literal: "a < b" }])).toBe(
      "$$\na &lt; b\n$$\n",
    );
  });

  it("renders a footnote definition as its own escaped label line followed by its body's ordinary blocks", () => {
    expect(
      render([
        {
          type: "footnoteDefinition",
          label: "note",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "body" }],
            },
          ],
        },
      ]),
    ).toBe("[^note]:\n<p>body</p>\n");
  });

  it("separates two consecutive footnote definitions on their own lines", () => {
    const html = render([
      { type: "footnoteDefinition", label: "a", children: [] },
      { type: "footnoteDefinition", label: "b", children: [] },
    ]);
    expect(html).toBe("[^a]:\n[^b]:\n");
  });
});

describe("renderDocumentToHtml: table column alignment, only rendered when genuinely aligned", () => {
  it("omits the align attribute entirely for an unaligned ('none') column", () => {
    const html = render([
      {
        type: "table",
        alignments: ["none"],
        children: [
          {
            type: "tableRow",
            header: true,
            children: [
              { type: "tableCell", children: [{ type: "text", value: "h" }] },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain("<th>h</th>");
    expect(html).not.toContain("align=");
  });

  it("renders the align attribute for a genuinely aligned column", () => {
    const html = render([
      {
        type: "table",
        alignments: ["right"],
        children: [
          {
            type: "tableRow",
            header: true,
            children: [
              { type: "tableCell", children: [{ type: "text", value: "h" }] },
            ],
          },
          {
            type: "tableRow",
            header: false,
            children: [
              { type: "tableCell", children: [{ type: "text", value: "b" }] },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('<th align="right">h</th>');
    expect(html).toContain('<td align="right">b</td>');
  });
});

describe("renderDocumentToHtml: cr() only inserts a newline when the buffer genuinely lacks one", () => {
  it("inserts a newline between a tight list item's bare paragraph text and a nested list that follows it in the same item", () => {
    const html = render([
      {
        type: "list",
        markerType: "bullet",
        bulletMarker: "-",
        tight: true,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "a" }] },
              {
                type: "list",
                markerType: "bullet",
                bulletMarker: "-",
                tight: true,
                children: [
                  {
                    type: "listItem",
                    children: [
                      {
                        type: "paragraph",
                        children: [{ type: "text", value: "b" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    // A bare tight-paragraph "a" carries no trailing newline of its own -- the nested list's own leading cr() is what supplies the line break before its "<ul>".
    expect(html).toBe("<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>\n");
  });
});

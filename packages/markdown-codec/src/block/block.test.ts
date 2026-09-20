// AST-level tests for the block phase. The conformance suites (src/conformance.test.ts, src/gfm-conformance.test.ts) compare rendered HTML and are therefore blind to everything the AST records for the write side's benefit but HTML discards -- which bullet character a list was written with, which of `.`/`)` an ordered list used, whether a heading was written ATX or setext, whether a code block was fenced. Those are exactly what this file pins.
//
// It also covers the precedence decisions this phase had to make, where "the corpus passes" is not on its own evidence that the right rule produced the right answer.

import { describe, expect, it } from "vitest";
import type { MarkdownBlockNode } from "../ast/ast";
import {
  MarkdownDiagnosticCodes,
  MarkdownNestingLimitExceededError,
} from "../diagnostics/diagnostics";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import { parseMarkdown } from "./block";

function parse(source: string): MarkdownBlockNode[] {
  return parseMarkdown(source).document.children;
}

describe("line endings", () => {
  it("reads a carriage return ending the last line as that line's own ending, not as a blank line after it", () => {
    expect(parse("```\na\r")).toEqual([
      {
        type: "codeBlock",
        fenced: true,
        fenceChar: "`",
        infoString: "",
        literal: "a\n",
      },
    ]);
  });
});

describe("headings", () => {
  it("records an ATX heading's own style and level", () => {
    expect(parse("### foo")).toEqual([
      {
        type: "heading",
        level: 3,
        style: "atx",
        children: [{ type: "text", value: "foo" }],
      },
    ]);
  });

  it("records a setext heading separately from an ATX one of the same level", () => {
    expect(parse("foo\n===")).toEqual([
      {
        type: "heading",
        level: 1,
        style: "setext",
        children: [{ type: "text", value: "foo" }],
      },
    ]);
    expect(parse("foo\n---")).toEqual([
      {
        type: "heading",
        level: 2,
        style: "setext",
        children: [{ type: "text", value: "foo" }],
      },
    ]);
  });

  it("takes a setext level from the underline's own leading character, not from where the line ends", () => {
    // The match covers the trailing spaces the spec allows after the underline, so what the underline ENDS with is not the same question as which character it is made of.
    expect(parse("foo\n===  ")).toMatchObject([{ level: 1, style: "setext" }]);
  });

  it("promotes only the paragraph it directly follows, never a lazily continued one", () => {
    // The `---` cannot reach the paragraph inside the block quote, so it is a thematic break in the document itself.
    expect(parse("> foo\n---")).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "foo" }] },
        ],
      },
      { type: "thematicBreak" },
    ]);
  });
});

describe("code blocks", () => {
  it("records a fenced block's own fence character and info string", () => {
    expect(parse("~~~ruby extra\nfoo\n~~~")).toEqual([
      {
        type: "codeBlock",
        fenced: true,
        fenceChar: "~",
        infoString: "ruby extra",
        literal: "foo\n",
      },
    ]);
  });

  it("records an indented block as unfenced, with no fence character or info string", () => {
    expect(parse("    foo")).toEqual([
      { type: "codeBlock", fenced: false, literal: "foo\n" },
    ]);
  });

  it("closes on a closing fence that carries trailing spaces, which the spec allows after it", () => {
    expect(parse("```\nx\n```   \nafter")).toEqual([
      {
        type: "codeBlock",
        fenced: true,
        fenceChar: "`",
        infoString: "",
        literal: "x\n",
      },
      { type: "paragraph", children: [{ type: "text", value: "after" }] },
    ]);
  });
});

describe("math blocks (ExaDev/markdown-codec#53)", () => {
  it("records the content between two $$ lines, delimiters excluded", () => {
    expect(parse("$$\nx^2\n$$")).toEqual([
      { type: "mathBlock", literal: "x^2\n" },
    ]);
  });

  it("interrupts an open paragraph, like a code fence", () => {
    expect(parse("foo\n$$\nx^2\n$$")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "foo" }] },
      { type: "mathBlock", literal: "x^2\n" },
    ]);
  });

  it("records an empty block when the closing $$ follows immediately", () => {
    expect(parse("$$\n$$")).toEqual([{ type: "mathBlock", literal: "" }]);
  });

  it("does not close on a line that is $$ plus other content -- only a bare $$ line closes", () => {
    expect(parse("$$\nx^2 $$ y\n$$")).toEqual([
      { type: "mathBlock", literal: "x^2 $$ y\n" },
    ]);
  });

  it("keeps trailing whitespace on the opening $$ line out of the content", () => {
    expect(parse("$$  \nx^2\n$$")).toEqual([
      { type: "mathBlock", literal: "x^2\n" },
    ]);
  });

  it("ends at its closing $$ rather than carrying on over what follows", () => {
    expect(parse("$$\nx^2\n$$\nafter")).toEqual([
      { type: "mathBlock", literal: "x^2\n" },
      { type: "paragraph", children: [{ type: "text", value: "after" }] },
    ]);
  });

  it("reads an indented $$ line as indented code, since a block may not open there", () => {
    expect(parse("    $$")).toEqual([
      { type: "codeBlock", fenced: false, literal: "$$\n" },
    ]);
  });

  it("opens at the level of the deepest block the line matched, closing whatever it did not", () => {
    expect(parse("> a\n$$\nx\n$$")).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "a" }] },
        ],
      },
      { type: "mathBlock", literal: "x\n" },
    ]);
  });
});

describe("footnote definitions (ExaDev/markdown-codec#66)", () => {
  it("ends a definition with no content at a blank line rather than taking what follows as its body", () => {
    expect(parse("[^1]:\n\n    b")).toEqual([
      { type: "footnoteDefinition", label: "1", children: [] },
      { type: "codeBlock", fenced: false, literal: "b\n" },
    ]);
  });

  it("continues a definition that already has content across a blank line", () => {
    expect(parse("[^1]: a\n\n    b")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "a" }] },
          { type: "paragraph", children: [{ type: "text", value: "b" }] },
        ],
      },
    ]);
  });

  it("consumes a whitespace-only line whole, so a code block in the body sees a genuinely blank line", () => {
    expect(parse("[^1]: a\n\n        code\n      \n        more")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "a" }] },
          { type: "codeBlock", fenced: false, literal: "code\n\nmore\n" },
        ],
      },
    ]);
  });

  it("takes the body from just after the marker when the marker itself is indented", () => {
    expect(parse("  [^1]: body")).toEqual([
      {
        type: "footnoteDefinition",
        label: "1",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "body" }] },
        ],
      },
    ]);
  });
});

describe("the nesting limit", () => {
  it("counts how deep the open chain goes, not how many blocks the document has in total", () => {
    expect(() =>
      parseMarkdown("a\n\nb\n\nc\n\nd", { maxNesting: 3 }),
    ).not.toThrow();
  });

  it("refuses the block that would sit at the limit and allows the one just below it", () => {
    expect(() => parseMarkdown("> a", { maxNesting: 2 })).not.toThrow();
    expect(() => parseMarkdown("> > a", { maxNesting: 2 })).toThrow(
      MarkdownNestingLimitExceededError,
    );
  });
});

describe("lists", () => {
  it("records the bullet character a list was written with", () => {
    expect(parse("+ foo")).toEqual([
      {
        type: "list",
        markerType: "bullet",
        bulletMarker: "+",
        tight: true,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "foo" }] },
            ],
          },
        ],
      },
    ]);
  });

  it("records an ordered list's own delimiter and start number", () => {
    const [list] = parse("3) foo");
    expect(list).toMatchObject({
      type: "list",
      markerType: "ordered",
      orderedDelimiter: ")",
      start: 3,
    });
  });

  it("starts a new list when the marker type changes, with no blank line between", () => {
    const blocks = parse("- foo\n* bar");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "list", bulletMarker: "-" });
    expect(blocks[1]).toMatchObject({ type: "list", bulletMarker: "*" });
  });

  it("marks a list loose when a blank line separates its items and tight when none does", () => {
    expect(parse("- a\n- b")[0]).toMatchObject({ tight: true });
    expect(parse("- a\n\n- b")[0]).toMatchObject({ tight: false });
  });

  it("marks a list loose when one item holds two blocks separated by a blank line", () => {
    expect(parse("- a\n\n  b\n- c")[0]).toMatchObject({ tight: false });
  });

  it("reads a marker followed by a blank line as an item whose content starts on a later line", () => {
    expect(parse("-\n  foo")).toEqual([
      {
        type: "list",
        markerType: "bullet",
        bulletMarker: "-",
        tight: true,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "foo" }] },
            ],
          },
        ],
      },
    ]);
  });

  it("treats five or more spaces after the marker as indented code, not as the item's content indent", () => {
    expect(parse("-     foo")).toEqual([
      {
        type: "list",
        markerType: "bullet",
        bulletMarker: "-",
        tight: true,
        children: [
          {
            type: "listItem",
            children: [{ type: "codeBlock", fenced: false, literal: "foo\n" }],
          },
        ],
      },
    ]);
  });

  it("takes the content indent from where the content actually starts, up to four spaces", () => {
    // Content at four columns, so a continuation line indented four columns belongs to the item rather than starting a code block.
    expect(parse("-   foo\n    bar")).toEqual([
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
                children: [
                  { type: "text", value: "foo" },
                  { type: "softBreak" },
                  { type: "text", value: "bar" },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("reads three bullet markers with nothing after them as a thematic break, not as three empty items", () => {
    expect(parse("- - -")).toEqual([{ type: "thematicBreak" }]);
    expect(parse("* * *")).toEqual([{ type: "thematicBreak" }]);
  });

  it("marks a list loose when the blank line between its items is one an indented code block continues", () => {
    // The code block, not the item, is the deepest block the blank line matched, so nothing below the item records it: the separation is only visible on the chain of blocks the line sat inside.
    expect(parse("-     b\n\n- a")[0]).toMatchObject({ tight: false });
  });

  it("keeps a list tight when the only blank line is a block quote's own marker-only line", () => {
    expect(parse("- > a\n  >\n- b")[0]).toMatchObject({ tight: true });
  });

  it("keeps a list tight when the only blank line is content inside a fenced code block", () => {
    expect(parse("- ```\n\n  ```\n- b")[0]).toMatchObject({ tight: true });
  });

  it("keeps a list tight when an item is nothing but its own marker", () => {
    // spec 0.31.2: "A list item can begin with at most one blank line". That first blank line is the item itself, not a separator between items.
    expect(parse("- foo\n-\n- bar")[0]).toMatchObject({ tight: true });
  });
});

describe("containers and lazy continuation", () => {
  it("continues a paragraph inside a block quote across a line with no marker", () => {
    expect(parse("> foo\nbar")).toEqual([
      {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "foo" },
              { type: "softBreak" },
              { type: "text", value: "bar" },
            ],
          },
        ],
      },
    ]);
  });

  it("closes the block quote when the unmarked line starts a block of its own", () => {
    expect(parse("> foo\n# bar")).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "foo" }] },
        ],
      },
      {
        type: "heading",
        level: 1,
        style: "atx",
        children: [{ type: "text", value: "bar" }],
      },
    ]);
  });

  it("nests a list inside a block quote inside a list item", () => {
    expect(parse("- > - foo")).toMatchObject([
      {
        type: "list",
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "blockquote",
                children: [{ type: "list", children: [{ type: "listItem" }] }],
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("link reference definitions", () => {
  it("resolves a reference against a definition that appears later in the document", () => {
    const { document, references } = parseMarkdown('[foo]\n\n[foo]: /url "t"');
    expect(references.get("FOO")).toEqual({ destination: "/url", title: "t" });
    expect(document.children).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            destination: "/url",
            title: "t",
            children: [{ type: "text", value: "foo" }],
          },
        ],
      },
    ]);
  });

  it("resolves a reference against a definition nested inside a block quote", () => {
    expect(
      parseMarkdown("[foo]\n\n> [foo]: /url").document.children[0],
    ).toEqual({
      type: "paragraph",
      children: [
        {
          type: "link",
          destination: "/url",
          children: [{ type: "text", value: "foo" }],
        },
      ],
    });
  });

  it("keeps the first of two definitions sharing a label", () => {
    expect(
      parseMarkdown("[foo]: /first\n[foo]: /second").references.get("FOO"),
    ).toEqual({ destination: "/first" });
  });

  it("leaves no block behind for a paragraph that held nothing but definitions", () => {
    expect(parse("[foo]: /url")).toEqual([]);
  });
});

describe("HTML blocks", () => {
  it("ends a type-6 block at a blank line and keeps its literal source verbatim", () => {
    expect(parse("<div>\n*foo*\n\nbar")).toEqual([
      { type: "htmlBlock", literal: "<div>\n*foo*" },
      { type: "paragraph", children: [{ type: "text", value: "bar" }] },
    ]);
  });

  it("does not let a type-7 block interrupt a paragraph", () => {
    expect(parse('foo\n<a href="x">')).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "foo" },
          { type: "softBreak" },
          { type: "rawHtml", literal: '<a href="x">' },
        ],
      },
    ]);
  });

  it("opens a type-7 block when there is no open paragraph for it to interrupt", () => {
    expect(parse('<a href="x">')).toEqual([
      { type: "htmlBlock", literal: '<a href="x">' },
    ]);
  });

  it("does not let a type-7 block interrupt a paragraph it could instead continue lazily", () => {
    expect(parse('> foo\n<a href="x">')).toEqual([
      {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "foo" },
              { type: "softBreak" },
              { type: "rawHtml", literal: '<a href="x">' },
            ],
          },
        ],
      },
    ]);
  });

  it("opens a type-7 block after a line that left a container unmatched but no paragraph open", () => {
    expect(parse('> # h\n<a href="x">')).toEqual([
      {
        type: "blockquote",
        children: [
          {
            type: "heading",
            level: 1,
            style: "atx",
            children: [{ type: "text", value: "h" }],
          },
        ],
      },
      { type: "htmlBlock", literal: '<a href="x">' },
    ]);
  });

  it("tests an end condition only against an open HTML block, never against a fenced code block", () => {
    // A code block's content is literal, so a line that would end an HTML block of type 1 is just one more line of it.
    expect(parse("```\n</pre>\nstill code\n```")).toEqual([
      {
        type: "codeBlock",
        fenced: true,
        fenceChar: "`",
        infoString: "",
        literal: "</pre>\nstill code\n",
      },
    ]);
  });

  it("tests an end condition only against an open HTML block, never against a paragraph", () => {
    expect(parse("foo\nbar </pre> baz\nqux")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "foo" },
          { type: "softBreak" },
          { type: "text", value: "bar " },
          { type: "rawHtml", literal: "</pre>" },
          { type: "text", value: " baz" },
          { type: "softBreak" },
          { type: "text", value: "qux" },
        ],
      },
    ]);
  });
});

describe("GFM extension toggles", () => {
  it("reads a delimiter row as ordinary paragraph text when tables are disabled", () => {
    expect(
      parseMarkdown("| a |\n| - |", { gfmTables: false }).document.children,
    ).toMatchObject([{ type: "paragraph" }]);
  });
});

describe("GFM tables", () => {
  it("leaves the paragraph's earlier lines behind as a paragraph, still separated as they were written", () => {
    const blocks = parse("a\nb\n| h |\n| - |");
    expect(blocks[0]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "a" },
        { type: "softBreak" },
        { type: "text", value: "b" },
      ],
    });
    expect(blocks[1]).toMatchObject({ type: "table" });
  });

  it("is not itself promoted by a following underline, which only an open paragraph answers to", () => {
    // A table accepts lines and still lets block starts be tried, so the promotion hook is offered it as a container and has to decline, or the accumulated rows would be read as a setext heading's own text.
    const blocks = parse("| a |\n| - |\n| 1 |\n---");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "table" });
    expect(blocks[1]).toEqual({ type: "thematicBreak" });
  });

  it("builds one row per body line, with the delimiter row's own consumed line contributing none", () => {
    const [table] = parse("| a |\n| - |\n| 1 |");
    expect(table).toMatchObject({
      type: "table",
      children: [
        { type: "tableRow", header: true },
        { type: "tableRow", header: false },
      ],
    });
  });
});

describe("GFM task list items", () => {
  it("reads [ ] and [x] as an unchecked/checked task list item, stripping the marker from the item's own text", () => {
    expect(parse("- [ ] todo\n- [x] done")).toEqual([
      {
        type: "list",
        markerType: "bullet",
        bulletMarker: "-",
        tight: true,
        children: [
          {
            type: "listItem",
            checked: false,
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "todo" }],
              },
            ],
          },
          {
            type: "listItem",
            checked: true,
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "done" }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("leaves an ordinary item with no checked field at all, not false", () => {
    const [list] = parse("- foo");
    expect(list).toMatchObject({ children: [{ type: "listItem" }] });
    if (list?.type !== "list") throw new Error("expected a list node");
    expect(list.children[0]?.checked).toBeUndefined();
    const [item] = list.children;
    if (item === undefined) throw new Error("expected a list item");
    // Absent, not present and undefined: a structural equality check reads the two the same way, so the key itself has to be asked for.
    expect(Object.hasOwn(item, "checked")).toBe(false);
  });

  it("reads a leading [ ]/[x] as ordinary text when task lists are disabled", () => {
    const [list] = parseMarkdown("- [ ] foo", { gfmTaskLists: false }).document
      .children;
    expect(list).toMatchObject({
      type: "list",
      children: [
        {
          type: "listItem",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "[ ] foo" }],
            },
          ],
        },
      ],
    });
    if (list?.type !== "list") throw new Error("expected a list node");
    expect(list.children[0]?.checked).toBeUndefined();
  });
});

describe("recover-tier diagnostics", () => {
  it("reports an unclosed fenced code block reaching end-of-input", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("```js\ncode", { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.UNCLOSED_FENCE)).toBe(true);
  });

  it('reports an HTML comment block that never meets its own closing "-->" before end-of-input', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("<!-- comment\nmore text", { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK)).toBe(
      true,
    );
  });

  it("reports a table row whose cell count does not match the header row", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 | 3 |", {
      sink: collector.sink,
    });
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_CELL_COUNT_MISMATCH),
    ).toBe(true);
  });

  it("reports a second link reference definition sharing an already-defined label", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("[foo]: /first\n[foo]: /second", { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE),
    ).toBe(true);
  });

  it("reports each duplicate definition's own line, counted from how many newlines precede it within the paragraph", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("[a]: /1\n[a]: /2\n[a]: /3", { sink: collector.sink });
    const duplicates = collector.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE,
    );
    expect(duplicates.map((diagnostic) => diagnostic.line)).toEqual([2, 3]);
  });

  it("reports a math block never closed by a matching $$ before end-of-input", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("$$\nx^2", { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.UNCLOSED_MATH_BLOCK)).toBe(
      true,
    );
  });

  it("reports nothing for an indented code block left open at end-of-input, which has no closing condition to miss", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("    code", { sink: collector.sink });
    expect(collector.codes()).toEqual([]);
  });

  it("names the opening line of the fenced code block that was never closed", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("text\n\n```js\ncode", { sink: collector.sink });
    const [diagnostic] = collector.diagnostics;
    expect(diagnostic?.code).toBe(MarkdownDiagnosticCodes.UNCLOSED_FENCE);
    expect(diagnostic?.line).toBe(3);
    expect(diagnostic?.message).toContain("line 3");
    expect(diagnostic?.message).toContain("never closed");
  });

  it("names the type and the opening line of the HTML block that never met its end condition", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("text\n\n<!-- comment\nmore text", { sink: collector.sink });
    const [diagnostic] = collector.diagnostics;
    expect(diagnostic?.code).toBe(
      MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK,
    );
    expect(diagnostic?.line).toBe(3);
    expect(diagnostic?.message).toContain("type 2");
    expect(diagnostic?.message).toContain("line 3");
  });

  it("names the opening line of the math block that was never closed", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("text\n\n$$\nx^2", { sink: collector.sink });
    const [diagnostic] = collector.diagnostics;
    expect(diagnostic?.code).toBe(MarkdownDiagnosticCodes.UNCLOSED_MATH_BLOCK);
    expect(diagnostic?.line).toBe(3);
    expect(diagnostic?.message).toContain("line 3");
    expect(diagnostic?.message).toContain("$$");
  });

  it("reports both cell counts when a table row does not match its header", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 | 3 |", {
      sink: collector.sink,
    });
    const [diagnostic] = collector.diagnostics;
    expect(diagnostic?.message).toContain("3 cell(s)");
    expect(diagnostic?.message).toContain("declares 2");
  });

  it("reports nothing for a table whose every row matches its header", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 |", { sink: collector.sink });
    expect(collector.codes()).toEqual([]);
  });

  it("reports the second footnote definition sharing a label, naming the label and its own line", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("[^a]: one\n\n[^a]: two", { sink: collector.sink });
    const duplicates = collector.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code ===
        MarkdownDiagnosticCodes.DUPLICATE_FOOTNOTE_DEFINITION,
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.line).toBe(3);
    expect(duplicates[0]?.message).toContain('"a"');
    expect(duplicates[0]?.message).toContain("already defined");
  });

  it("reports nothing for a single footnote definition", () => {
    const collector = createDiagnosticCollector();
    parseMarkdown("[^a]: one", { sink: collector.sink });
    expect(collector.codes()).toEqual([]);
  });
});

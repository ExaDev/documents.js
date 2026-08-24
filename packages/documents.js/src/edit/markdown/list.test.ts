import { MarkdownDiagnosticCodes } from "markdown-codec";
// TASK_CHECKBOX_UNCHECKED/CHECKED are not re-exported from markdown-codec's own top-level entry point (only QUOTE_STYLE_ID/CODE_BLOCK_STYLE_ID/etc are) -- reached via that package's own "./*" deep-import wildcard instead, the identical mechanism this package's own README documents for its own src/ modules.
import { TASK_CHECKBOX_UNCHECKED } from "markdown-codec/shared/style-constants";
import { describe, expect, it } from "vitest";
import { openMarkdown } from "./editor";

describe("MarkdownList.appendItem", () => {
  // A task-list checkbox is not a per-item flag on ContentListMembership -- markdown-codec's own dist/lower/lower.js only ever produces one by prepending a literal "TASK_CHECKBOX_UNCHECKED "/"TASK_CHECKBOX_CHECKED " glyph to the item's own first run text when lowering real "- [ ] "/"- [x] " markdown, and its own dist/emit/emit.js checkboxPrefixFor sniffs that identical glyph back out on write. Building a real task item through this editor therefore means constructing that same glyph-prefixed text directly, exactly as a caller reading a real task list from markdown-codec would see it arrive.
  it('startList({type: "ordered", task: true}) then appendItem twice produces real markdown task-list output', () => {
    const editor = openMarkdown("");
    const list = editor.body.startList({ type: "ordered", task: true });
    list.appendItem(0, { text: `${TASK_CHECKBOX_UNCHECKED} First item` });
    list.appendItem(0, { text: `${TASK_CHECKBOX_UNCHECKED} Second item` });

    const output = editor.toMarkdownText();
    expect(output).toBe("1. [ ] First item\n2. [ ] Second item");
  });

  it("a hand-set .list pointing at a numId this editor never minted falls back to a plain bullet on write, reported via LIST_NUMID_FALLBACK", () => {
    const editor = openMarkdown("");
    const paragraph = editor.body.appendParagraph({ text: "Item" });
    paragraph.list = { numId: "not-ours", level: 0 };

    const diagnosticCodes: string[] = [];
    const output = editor.toMarkdownText({
      sink: (diagnostic) => diagnosticCodes.push(diagnostic.code),
    });
    expect(output).toBe("- Item");
    expect(diagnosticCodes).toContain(
      MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
    );
  });

  it("numId is stable per list and distinct across two lists from the same editor", () => {
    const editor = openMarkdown("");
    const first = editor.body.startList({ type: "bullet" });
    const second = editor.body.startList({ type: "bullet" });
    expect(first.numId).not.toBe(second.numId);
    const itemA = first.appendItem(0, { text: "A" });
    const itemB = first.appendItem(0, { text: "B" });
    expect(itemA.list?.numId).toBe(first.numId);
    expect(itemB.list?.numId).toBe(first.numId);
  });
});

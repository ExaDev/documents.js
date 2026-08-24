import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "../../odf/odt/read";
import { createOdt, openOdt } from "./editor";

function isParagraph(block: ContentBlock): block is ContentParagraph {
  return block.kind === "paragraph";
}

function paragraphsOf(
  pkg: Parameters<typeof readOdtContent>[0],
): ContentParagraph[] {
  const content = readOdtContent(pkg);
  if (content.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing ContentDocument");
  }
  return content.sections[0]!.blocks.filter(isParagraph);
}

describe("OdtList / OdtListItem: structural nesting", () => {
  it("a 2-level nested list reads back through readOdtContent with the correct ContentParagraph.list.level values", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    const topItem = list.addItem();
    topItem.appendParagraph({ text: "Top level item" });
    const nestedList = topItem.addNestedList();
    nestedList.addItem().appendParagraph({ text: "Nested item" });

    const paragraphs = paragraphsOf(editor.toPackage());
    const top = paragraphs.find(
      (p) => p.runs.map((r) => r.text).join("") === "Top level item",
    );
    const nested = paragraphs.find(
      (p) => p.runs.map((r) => r.text).join("") === "Nested item",
    );

    expect(top?.list?.level).toBe(0);
    expect(nested?.list?.level).toBe(1);
    // Both paragraphs belong to the same top-level list, even though the nested one is one level deeper -- odf.js's own readOdtContent assigns one synthetic numId per top-level text:list and threads it through every nested text:list beneath it.
    expect(nested?.list?.numId).toBe(top?.list?.numId);
  });

  it("a 3-level nested list increments the level once per nesting", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    const level0 = list.addItem();
    level0.appendParagraph({ text: "Level 0" });
    const level1List = level0.addNestedList();
    const level1 = level1List.addItem();
    level1.appendParagraph({ text: "Level 1" });
    const level2List = level1.addNestedList();
    level2List.addItem().appendParagraph({ text: "Level 2" });

    const paragraphs = paragraphsOf(editor.toPackage());
    const levels = new Map(
      paragraphs.map((p) => [
        p.runs.map((r) => r.text).join(""),
        p.list?.level,
      ]),
    );
    expect(levels.get("Level 0")).toBe(0);
    expect(levels.get("Level 1")).toBe(1);
    expect(levels.get("Level 2")).toBe(2);
  });

  it("multiple sibling items at the same level all report list.level 0", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: "One" });
    list.addItem().appendParagraph({ text: "Two" });
    expect(list.items()).toHaveLength(2);

    const paragraphs = paragraphsOf(editor.toPackage());
    expect(paragraphs.filter((p) => p.list?.level === 0)).toHaveLength(2);
  });

  it("remove() removes the list and throws on any further use", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: "One" });
    expect(editor.lists()).toHaveLength(1);
    list.remove();
    expect(editor.lists()).toHaveLength(0);
    expect(() => list.items()).toThrow(/removed/);
  });
});

describe("OdtListItem: reading back its own content", () => {
  it("text reads back exactly what appendParagraph set", () => {
    const editor = createOdt();
    const item = editor.body.appendList().addItem();
    item.appendParagraph({ text: "First bullet" });

    expect(item.text).toBe("First bullet");
  });

  it("several paragraphs in one item read back newline-joined, matching OdtTableCell/OdpShape's own text convention", () => {
    const editor = createOdt();
    const item = editor.body.appendList().addItem();
    item.appendParagraph({ text: "Line one" });
    item.appendParagraph({ text: "Line two" });

    expect(item.paragraphs()).toHaveLength(2);
    expect(item.text).toBe("Line one\nLine two");
  });

  it("preserves ODF's own whitespace-run elements, which a plain text-node read would silently drop", () => {
    const editor = createOdt();
    const item = editor.body.appendList().addItem();
    // Two or more literal spaces become a text:s ELEMENT, not text-node characters -- see src/xml/odf-text.ts.
    item.appendParagraph({ text: "spaced   out" });

    expect(item.text).toBe("spaced   out");
  });

  it("paragraphs() returns live views: editing one through the getter changes the real document", () => {
    const editor = createOdt();
    const item = editor.body.appendList().addItem();
    item.appendParagraph({ text: "Original" });

    const paragraph = item.paragraphs()[0];
    if (paragraph === undefined) {
      throw new Error("expected the item to have a paragraph");
    }
    paragraph.appendRun({ text: " plus more" });

    expect(item.text).toBe("Original plus more");
    const texts = paragraphsOf(editor.toPackage()).map((p) =>
      p.runs.map((r) => r.text).join(""),
    );
    expect(texts).toContain("Original plus more");
  });

  it("an item re-obtained through items() after a reopen reads back its own text, not a nested item's", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    const topItem = list.addItem();
    topItem.appendParagraph({ text: "Top level item" });
    topItem.addNestedList().addItem().appendParagraph({ text: "Nested item" });

    const reopened = openOdt(editor.toBytes());
    const reopenedItem = reopened.lists()[0]?.items()[0];
    if (reopenedItem === undefined) {
      throw new Error("expected the reopened document to have a list item");
    }
    expect(reopenedItem.text).toBe("Top level item");
  });

  it("nestedLists() returns live views on the item's own nested text:list elements", () => {
    const editor = createOdt();
    const item = editor.body.appendList().addItem();
    item.appendParagraph({ text: "Top level item" });
    item.addNestedList().addItem().appendParagraph({ text: "Nested item" });

    const nested = item.nestedLists();
    expect(nested).toHaveLength(1);
    expect(nested[0]?.items().map((i) => i.text)).toEqual(["Nested item"]);

    // Genuinely live: appending through the re-obtained nested list reaches the real document.
    nested[0]?.addItem().appendParagraph({ text: "Second nested item" });
    expect(
      item
        .nestedLists()[0]
        ?.items()
        .map((i) => i.text),
    ).toEqual(["Nested item", "Second nested item"]);
    const texts = paragraphsOf(editor.toPackage()).map((p) =>
      p.runs.map((r) => r.text).join(""),
    );
    expect(texts).toContain("Second nested item");
  });

  it("an item with no nested list reports an empty nestedLists()", () => {
    const editor = createOdt();
    const item = editor.body.appendList().addItem();
    item.appendParagraph({ text: "Plain" });

    expect(item.nestedLists()).toEqual([]);
  });
});

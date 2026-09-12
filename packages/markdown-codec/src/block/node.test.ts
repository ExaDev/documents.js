import { describe, expect, it } from "vitest";
import { BlockNode, canContain } from "./node";

describe("BlockNode field defaults", () => {
  it("defaults infoString/literal/headerLine/footnoteLabel to the empty string", () => {
    const node = new BlockNode("paragraph", 1);
    expect(node.infoString).toBe("");
    expect(node.literal).toBe("");
    expect(node.headerLine).toBe("");
    expect(node.footnoteLabel).toBe("");
  });
});

describe("BlockNode.replaceWith", () => {
  it("replaces the node in its parent's own children array, in place", () => {
    const parent = new BlockNode("document", 1);
    const original = new BlockNode("paragraph", 1);
    const sibling = new BlockNode("paragraph", 2);
    parent.appendChild(original);
    parent.appendChild(sibling);

    const replacement = new BlockNode("heading", 1);
    original.replaceWith(replacement);

    expect(parent.children).toEqual([replacement, sibling]);
    expect(replacement.parent).toBe(parent);
    expect(original.parent).toBeUndefined();
  });

  it("does nothing when this node is not actually present in its own parent's children array", () => {
    const parent = new BlockNode("document", 1);
    const onlyChild = new BlockNode("paragraph", 1);
    parent.appendChild(onlyChild);

    // A node whose own `.parent` points here, but that was never itself pushed into parent.children -- an inconsistent state replaceWith must not act on.
    const detached = new BlockNode("paragraph", 2);
    detached.parent = parent;

    const replacement = new BlockNode("heading", 1);
    detached.replaceWith(replacement);

    expect(parent.children).toEqual([onlyChild]);
  });
});

describe("BlockNode.unlink", () => {
  it("removes the node from its parent's own children array", () => {
    const parent = new BlockNode("document", 1);
    const a = new BlockNode("paragraph", 1);
    const b = new BlockNode("paragraph", 2);
    parent.appendChild(a);
    parent.appendChild(b);

    a.unlink();

    expect(parent.children).toEqual([b]);
    expect(a.parent).toBeUndefined();
  });

  it("does nothing to the parent's children when this node is not actually present there", () => {
    const parent = new BlockNode("document", 1);
    const onlyChild = new BlockNode("paragraph", 1);
    parent.appendChild(onlyChild);

    const detached = new BlockNode("paragraph", 2);
    detached.parent = parent;

    detached.unlink();

    // A wrong `index !== -1` check (forced true) would splice(-1, 1) here, which deletes the LAST element of the array -- exactly the bug this pins against.
    expect(parent.children).toEqual([onlyChild]);
  });
});

describe("canContain", () => {
  it("lets a footnote definition hold an ordinary block", () => {
    expect(canContain("footnoteDefinition", "paragraph")).toBe(true);
  });

  it("never lets a footnote definition hold a bare list item", () => {
    expect(canContain("footnoteDefinition", "listItem")).toBe(false);
  });

  it("never lets a footnote definition nest another footnote definition", () => {
    expect(canContain("footnoteDefinition", "footnoteDefinition")).toBe(false);
  });

  it("lets a document/blockquote/listItem hold an ordinary block", () => {
    expect(canContain("document", "paragraph")).toBe(true);
    expect(canContain("blockquote", "paragraph")).toBe(true);
    expect(canContain("listItem", "paragraph")).toBe(true);
  });

  it("never lets a document/blockquote/listItem hold a bare list item directly", () => {
    expect(canContain("document", "listItem")).toBe(false);
    expect(canContain("blockquote", "listItem")).toBe(false);
    expect(canContain("listItem", "listItem")).toBe(false);
  });

  it("lets a list hold only list items", () => {
    expect(canContain("list", "listItem")).toBe(true);
    expect(canContain("list", "paragraph")).toBe(false);
  });

  it("lets no leaf block hold any children", () => {
    expect(canContain("paragraph", "paragraph")).toBe(false);
    expect(canContain("codeBlock", "paragraph")).toBe(false);
  });
});

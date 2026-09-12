import { describe, expect, it } from "vitest";
import { InlineNode, createTextNode } from "./node";

describe("InlineNode field defaults", () => {
  it("defaults literal/destination/raw/label to the empty string for a node kind that never sets them", () => {
    const node = new InlineNode("link");
    expect(node.literal).toBe("");
    expect(node.destination).toBe("");
    expect(node.raw).toBe("");
    expect(node.label).toBe("");
  });
});

describe("InlineNode.appendChild / unlink", () => {
  it("links three children in order under one parent", () => {
    const parent = new InlineNode("container");
    const a = createTextNode("a");
    const b = createTextNode("b");
    const c = createTextNode("c");
    parent.appendChild(a);
    parent.appendChild(b);
    parent.appendChild(c);

    expect(parent.firstChild).toBe(a);
    expect(parent.lastChild).toBe(c);
    expect(a.next).toBe(b);
    expect(b.previous).toBe(a);
    expect(b.next).toBe(c);
    expect(c.previous).toBe(b);
  });

  it("unlink() removes a middle node and re-links its former neighbours to each other", () => {
    const parent = new InlineNode("container");
    const a = createTextNode("a");
    const b = createTextNode("b");
    const c = createTextNode("c");
    parent.appendChild(a);
    parent.appendChild(b);
    parent.appendChild(c);

    b.unlink();

    expect(a.next).toBe(c);
    expect(c.previous).toBe(a);
    expect(parent.firstChild).toBe(a);
    expect(parent.lastChild).toBe(c);
  });

  it("unlink() fixes up the parent's firstChild/lastChild when the removed node was an end", () => {
    const parent = new InlineNode("container");
    const a = createTextNode("a");
    const b = createTextNode("b");
    parent.appendChild(a);
    parent.appendChild(b);

    a.unlink();
    expect(parent.firstChild).toBe(b);
    expect(b.previous).toBeUndefined();

    b.unlink();
    expect(parent.lastChild).toBeUndefined();
  });
});

describe("InlineNode.insertAfter", () => {
  it("inserts a brand-new node right after this one", () => {
    const parent = new InlineNode("container");
    const a = createTextNode("a");
    const c = createTextNode("c");
    parent.appendChild(a);
    parent.appendChild(c);
    const b = createTextNode("b");

    a.insertAfter(b);

    expect(a.next).toBe(b);
    expect(b.previous).toBe(a);
    expect(b.next).toBe(c);
    expect(c.previous).toBe(b);
  });

  it("detaches a node from its OLD location before splicing it into its new one", () => {
    // b starts out linked between a and c under `oldParent`; inserting it after x under a different parent must first unlink it from the old chain, or a/c are left with stale pointers to a node that no longer belongs there.
    const oldParent = new InlineNode("container");
    const a = createTextNode("a");
    const b = createTextNode("b");
    const c = createTextNode("c");
    oldParent.appendChild(a);
    oldParent.appendChild(b);
    oldParent.appendChild(c);

    const newParent = new InlineNode("container");
    const x = createTextNode("x");
    newParent.appendChild(x);

    x.insertAfter(b);

    expect(a.next).toBe(c);
    expect(c.previous).toBe(a);
    expect(oldParent.lastChild).toBe(c);
    expect(x.next).toBe(b);
    expect(b.parent).toBe(newParent);
  });

  it("updates the parent's own lastChild when the sibling is inserted at the end", () => {
    const parent = new InlineNode("container");
    const a = createTextNode("a");
    parent.appendChild(a);
    const b = createTextNode("b");

    a.insertAfter(b);

    expect(parent.lastChild).toBe(b);
  });

  it("leaves the parent's own lastChild unchanged when the sibling is inserted before an existing later node", () => {
    const parent = new InlineNode("container");
    const a = createTextNode("a");
    const c = createTextNode("c");
    parent.appendChild(a);
    parent.appendChild(c);
    const b = createTextNode("b");

    a.insertAfter(b);

    expect(parent.lastChild).toBe(c);
  });
});

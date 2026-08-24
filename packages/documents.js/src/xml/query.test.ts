import type { XmlNode } from "ooxml.js";
import { describe, expect, it } from "vitest";
import {
  findChildElement,
  findChildElements,
  findDescendantElement,
  walkElements,
} from "./query";

function el(tag: string, children: XmlNode[] = []): XmlNode {
  return { type: "element", tag, attributes: [], children };
}

describe("xml/query", () => {
  it("findChildElement returns a cursor whose container is the array the node lives in", () => {
    const run = el("w:r");
    const paragraph = el("w:p", [run]);
    const container: XmlNode[] = [paragraph];
    const cursor = findChildElement(container, "w:p");
    expect(cursor?.node).toBe(paragraph);
    expect(cursor?.container).toBe(container);
  });

  it("findChildElements returns only direct children, in document order", () => {
    const runA = el("w:r");
    const runB = el("w:r");
    const nested = el("w:p", [el("w:r")]); // a w:r nested inside a child w:p must not be returned
    const container: XmlNode[] = [runA, nested, runB];
    const cursors = findChildElements(container, "w:r");
    expect(cursors.map((c) => c.node)).toEqual([runA, runB]);
  });

  it("walkElements descends into children and each cursor carries its true containing array", () => {
    const innerRun = el("w:r");
    const paragraph = el("w:p", [innerRun]);
    const container: XmlNode[] = [paragraph];
    const cursors = [...walkElements(container)];
    expect(cursors).toHaveLength(2);
    expect(cursors[0]?.node).toBe(paragraph);
    expect(cursors[0]?.container).toBe(container);
    expect(cursors[1]?.node).toBe(innerRun);
    expect(cursors[1]?.container).toBe(
      paragraph.type === "element" ? paragraph.children : [],
    );
  });

  it("findDescendantElement finds a nested element depth-first", () => {
    const target = el("w:t");
    const run = el("w:r", [target]);
    const paragraph = el("w:p", [run]);
    const cursor = findDescendantElement([paragraph], "w:t");
    expect(cursor?.node).toBe(target);
  });

  it("returns undefined when nothing matches", () => {
    expect(findChildElement([], "w:p")).toBeUndefined();
    expect(findDescendantElement([], "w:p")).toBeUndefined();
  });
});

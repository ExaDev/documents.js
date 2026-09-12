import { describe, expect, it } from "vitest";
import { finalizeListTightness, listsMatch } from "./list";
import { BlockNode } from "./node";
import type { ListMarkerData } from "./node";

const bullet = (bulletChar: "-" | "*" | "+"): ListMarkerData => ({
  type: "bullet",
  bulletChar,
  padding: 2,
  markerOffset: 0,
});

const ordered = (delimiter: "." | ")"): ListMarkerData => ({
  type: "ordered",
  delimiter,
  padding: 3,
  markerOffset: 0,
});

describe("listsMatch", () => {
  it("matches two bullet markers with the same bullet character", () => {
    expect(listsMatch(bullet("-"), bullet("-"))).toBe(true);
  });

  it("never matches a bullet marker against an ordered one, even if every other field happened to line up", () => {
    expect(listsMatch(bullet("-"), ordered("."))).toBe(false);
  });

  it("does not match two ordered markers with different delimiters", () => {
    expect(listsMatch(ordered("."), ordered(")"))).toBe(false);
  });

  it("does not match two bullet markers with different bullet characters", () => {
    expect(listsMatch(bullet("-"), bullet("*"))).toBe(false);
  });
});

describe("finalizeListTightness's own lastLineChecked memoisation", () => {
  it("marks a descended list/listItem node's own lastLineChecked, so a later finalisation over the same chain does not re-walk it", () => {
    const list = new BlockNode("list", 1);
    // item1 is the one endsWithBlankLine is actually called on: finalizeListTightness only checks an item that has a FOLLOWING sibling (item1, since item2 follows it), never the last item in the list on its own account.
    const item1 = new BlockNode("listItem", 1);
    const leaf = new BlockNode("paragraph", 1);
    item1.appendChild(leaf);
    const item2 = new BlockNode("listItem", 2);
    list.appendChild(item1);
    list.appendChild(item2);

    expect(item1.lastLineChecked).toBe(false);
    expect(leaf.lastLineChecked).toBe(false);

    finalizeListTightness(list);

    // item1 is a listItem, so descending into it (to check its own lastChild for a trailing blank line) must have marked it checked; leaf is not list/listItem-kinded, so it is marked checked at the point the descent stops on it rather than being descended into.
    expect(item1.lastLineChecked).toBe(true);
    expect(leaf.lastLineChecked).toBe(true);
  });

  it("keeps a list tight when nothing is blank", () => {
    const list = new BlockNode("list", 1);
    const item1 = new BlockNode("listItem", 1);
    const item2 = new BlockNode("listItem", 2);
    list.appendChild(item1);
    list.appendChild(item2);

    finalizeListTightness(list);

    expect(list.tight).toBe(true);
  });

  it("marks a list loose when an earlier item ends with a blank line before a following item", () => {
    const list = new BlockNode("list", 1);
    const item1 = new BlockNode("listItem", 1);
    item1.lastLineBlank = true;
    const item2 = new BlockNode("listItem", 2);
    list.appendChild(item1);
    list.appendChild(item2);

    finalizeListTightness(list);

    expect(list.tight).toBe(false);
  });
});

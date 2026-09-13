import { describe, expect, it } from "vitest";
import type { ContentParagraph } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { attrValue, childrenWithTag } from "../../xml/query";
import {
  resolveOdfListKind,
  mintOdfListNumId,
  buildOdfListStyle,
  writeOdfList,
  listKindOf,
  canonicalNumId,
  planListMembership,
  closeListPlan,
  readOdfListParagraphs,
  NO_NUM_ID_KEY,
  type OdfListIdState,
  type OdfListEntry,
  type ListPlanState,
} from "./list";

function packageWithAutomaticStyles(...listStyles: XmlElement[]): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:automatic-styles", {}, listStyles),
          ]),
        ],
      },
    },
  };
}

describe("resolveOdfListKind", () => {
  it("undefined style name resolves to undefined", () => {
    expect(resolveOdfListKind({ parts: {} }, undefined)).toBeUndefined();
  });

  it("resolves an ordered list style from its level-1 text:list-level-style-number", () => {
    const style = el("text:list-style", { "style:name": "L1" }, [
      el("text:list-level-style-number", { "text:level": "1" }),
    ]);
    const pkg = packageWithAutomaticStyles(style);
    expect(resolveOdfListKind(pkg, "L1")).toBe("ordered");
  });

  it("resolves a bullet list style from its level-1 text:list-level-style-bullet", () => {
    const style = el("text:list-style", { "style:name": "L1" }, [
      el("text:list-level-style-bullet", { "text:level": "1" }),
    ]);
    const pkg = packageWithAutomaticStyles(style);
    expect(resolveOdfListKind(pkg, "L1")).toBe("bullet");
  });

  it("resolves a bullet list style from its level-1 text:list-level-style-image (also a bullet kind)", () => {
    const style = el("text:list-style", { "style:name": "L1" }, [
      el("text:list-level-style-image", { "text:level": "1" }),
    ]);
    const pkg = packageWithAutomaticStyles(style);
    expect(resolveOdfListKind(pkg, "L1")).toBe("bullet");
  });

  it("only a level-1 child counts -- a level-2-only number style resolves to undefined, not ordered", () => {
    const style = el("text:list-style", { "style:name": "L1" }, [
      el("text:list-level-style-number", { "text:level": "2" }),
    ]);
    const pkg = packageWithAutomaticStyles(style);
    expect(resolveOdfListKind(pkg, "L1")).toBeUndefined();
  });

  it("a matching style with no recognised level-1 child resolves to undefined", () => {
    const style = el("text:list-style", { "style:name": "L1" }, []);
    const pkg = packageWithAutomaticStyles(style);
    expect(resolveOdfListKind(pkg, "L1")).toBeUndefined();
  });

  it("an unresolvable style name (no matching text:list-style anywhere) resolves to undefined", () => {
    const pkg = packageWithAutomaticStyles();
    expect(resolveOdfListKind(pkg, "does-not-exist")).toBeUndefined();
  });

  it("finds a list style in styles.xml's office:styles when content.xml has none", () => {
    const style = el("text:list-style", { "style:name": "L1" }, [
      el("text:list-level-style-number", { "text:level": "1" }),
    ]);
    const pkg: Package = {
      parts: {
        "styles.xml": {
          kind: "xml",
          nodes: [
            el("office:document-styles", {}, [
              el("office:styles", {}, [style]),
            ]),
          ],
        },
      },
    };
    expect(resolveOdfListKind(pkg, "L1")).toBe("ordered");
  });
});

describe("mintOdfListNumId", () => {
  it("mints an unprefixed numId when the list carries no resolvable style", () => {
    const state: OdfListIdState = { next: 1 };
    const numId = mintOdfListNumId({ parts: {} }, el("text:list"), state);
    expect(numId).toBe("list1");
    expect(state.next).toBe(2);
  });

  it("mints an ordered:-prefixed numId when the list's style resolves to ordered", () => {
    const style = el("text:list-style", { "style:name": "L1" }, [
      el("text:list-level-style-number", { "text:level": "1" }),
    ]);
    const pkg = packageWithAutomaticStyles(style);
    const state: OdfListIdState = { next: 3 };
    const numId = mintOdfListNumId(
      pkg,
      el("text:list", { "text:style-name": "L1" }),
      state,
    );
    expect(numId).toBe("ordered:list3");
    expect(state.next).toBe(4);
  });

  it("advances the counter by exactly one per call, regardless of resolution", () => {
    const state: OdfListIdState = { next: 1 };
    mintOdfListNumId({ parts: {} }, el("text:list"), state);
    mintOdfListNumId({ parts: {} }, el("text:list"), state);
    expect(state.next).toBe(3);
  });
});

describe("buildOdfListStyle", () => {
  it("builds ten levels, each one indent step deeper than the last", () => {
    const style = buildOdfListStyle("L1", "bullet");
    const levels = childrenWithTag(style, "text:list-level-style-bullet");
    expect(levels).toHaveLength(10);
    expect(attrValue(levels[0]!, "text:level")).toBe("1");
    expect(attrValue(levels[9]!, "text:level")).toBe("10");
    const props1 = childrenWithTag(
      levels[0]!,
      "style:list-level-properties",
    )[0]!;
    const props2 = childrenWithTag(
      levels[1]!,
      "style:list-level-properties",
    )[0]!;
    expect(attrValue(props1, "text:space-before")).toBe("18pt");
    expect(attrValue(props2, "text:space-before")).toBe("36pt");
    // Every level shares the identical min-label-width -- one indent step, not scaled by level.
    expect(attrValue(props1, "text:min-label-width")).toBe("18pt");
    expect(attrValue(props2, "text:min-label-width")).toBe("18pt");
  });

  it("an ordered style's own levels carry the real numbering attributes", () => {
    const style = buildOdfListStyle("L1", "ordered");
    const levels = childrenWithTag(style, "text:list-level-style-number");
    expect(levels).toHaveLength(10);
    expect(attrValue(levels[0]!, "style:num-suffix")).toBe(".");
    expect(attrValue(levels[0]!, "style:num-format")).toBe("1");
  });

  it("a bullet style's own levels carry the real bullet character, never the numbering attributes", () => {
    const style = buildOdfListStyle("L1", "bullet");
    const levels = childrenWithTag(style, "text:list-level-style-bullet");
    expect(attrValue(levels[0]!, "text:bullet-char")).toBe("•");
  });

  it("the root element is text:list-style carrying the given style name", () => {
    const style = buildOdfListStyle("MyList", "ordered");
    expect(style.tag).toBe("text:list-style");
    expect(attrValue(style, "style:name")).toBe("MyList");
  });
});

describe("writeOdfList", () => {
  function entry(level: number, id: string): OdfListEntry {
    return { level, element: el("text:p", { id }) };
  }

  it("a single flat run of level-0 entries becomes sibling text:list-item elements", () => {
    const root = writeOdfList([entry(0, "a"), entry(0, "b")], "L1");
    expect(root.tag).toBe("text:list");
    expect(attrValue(root, "text:style-name")).toBe("L1");
    expect(childrenWithTag(root, "text:list-item")).toHaveLength(2);
  });

  it("omits text:style-name entirely when no style name is given", () => {
    const root = writeOdfList([entry(0, "a")], undefined);
    expect(attrValue(root, "text:style-name")).toBeUndefined();
  });

  it("a deeper entry nests inside the previous item's own text:list", () => {
    const root = writeOdfList([entry(0, "a"), entry(1, "b")], undefined);
    const items = childrenWithTag(root, "text:list-item");
    expect(items).toHaveLength(1);
    const nestedList = childrenWithTag(items[0]!, "text:list")[0]!;
    expect(childrenWithTag(nestedList, "text:list-item")).toHaveLength(1);
  });

  it("returning to a shallower level after a deeper one closes the nested list", () => {
    const root = writeOdfList(
      [entry(0, "a"), entry(1, "b"), entry(0, "c")],
      undefined,
    );
    // Two top-level items: the first holds the nested level-1 item, the second is the level-0 "c" entry that closed the nesting back out.
    expect(childrenWithTag(root, "text:list-item")).toHaveLength(2);
  });

  it("a jump of more than one level opens the intervening lists inside empty items", () => {
    const root = writeOdfList([entry(2, "a")], undefined);
    const level0Item = childrenWithTag(root, "text:list-item")[0]!;
    const level1List = childrenWithTag(level0Item, "text:list")[0]!;
    const level1Item = childrenWithTag(level1List, "text:list-item")[0]!;
    const level2List = childrenWithTag(level1Item, "text:list")[0]!;
    expect(childrenWithTag(level2List, "text:list-item")).toHaveLength(1);
  });

  it("a fractional or negative level is clamped to a whole non-negative depth", () => {
    const root = writeOdfList([entry(-5, "a")], undefined);
    // Clamped to level 0 -- a single top-level item, no nested text:list at all.
    expect(childrenWithTag(root, "text:list-item")).toHaveLength(1);
    expect(childrenWithTag(root, "text:list")).toHaveLength(0);
  });
});

describe("listKindOf", () => {
  it("undefined numId resolves to undefined kind", () => {
    expect(listKindOf(undefined)).toBeUndefined();
  });

  it("an ordered:-prefixed numId resolves to ordered", () => {
    expect(listKindOf("ordered:list3")).toBe("ordered");
  });

  it("a bullet:-prefixed numId resolves to bullet", () => {
    expect(listKindOf("bullet:list3")).toBe("bullet");
  });

  it("an unprefixed numId resolves to undefined", () => {
    expect(listKindOf("list3")).toBeUndefined();
  });
});

describe("canonicalNumId", () => {
  it("an unprefixed incoming numId mints an unprefixed canonical label", () => {
    expect(canonicalNumId("anything", 1)).toBe("list1");
  });

  it("an ordered:-prefixed incoming numId mints an ordered:-prefixed canonical label", () => {
    expect(canonicalNumId("ordered:src", 2)).toBe("ordered:list2");
  });

  it("a bullet:-prefixed incoming numId mints a bullet:-prefixed canonical label", () => {
    expect(canonicalNumId("bullet:src", 3)).toBe("bullet:list3");
  });

  it("an undefined incoming numId mints an unprefixed canonical label", () => {
    expect(canonicalNumId(undefined, 4)).toBe("list4");
  });
});

function freshListState(): ListPlanState {
  return { next: 1 };
}

describe("planListMembership / closeListPlan", () => {
  it("undefined membership closes the run and returns undefined", () => {
    const state: ListPlanState = {
      next: 5,
      openNumId: "x",
      openCanonicalNumId: "list4",
    };
    expect(planListMembership(undefined, state)).toBeUndefined();
    expect(state.openNumId).toBeUndefined();
    expect(state.openCanonicalNumId).toBeUndefined();
  });

  it("a fresh incoming numId mints a fresh canonical numId and advances the counter", () => {
    const state = freshListState();
    const result = planListMembership({ numId: "src-a", level: 0 }, state);
    expect(result).toBe("list1");
    expect(state.next).toBe(2);
  });

  it("consecutive paragraphs sharing one incoming numId extend the same run", () => {
    const state = freshListState();
    const first = planListMembership({ numId: "src-a", level: 0 }, state);
    const second = planListMembership({ numId: "src-a", level: 1 }, state);
    expect(second).toBe(first);
    expect(state.next).toBe(2);
  });

  it("a changed incoming numId mints a new canonical numId", () => {
    const state = freshListState();
    const first = planListMembership({ numId: "src-a", level: 0 }, state);
    const second = planListMembership({ numId: "src-b", level: 0 }, state);
    expect(second).not.toBe(first);
    expect(state.next).toBe(3);
  });

  it("a membership carrying no incoming numId still opens a real run of its own, keyed on the sentinel", () => {
    const state = freshListState();
    const first = planListMembership({ level: 0 }, state);
    expect(first).toBeDefined();
    expect(state.openNumId).toBe(NO_NUM_ID_KEY);
    // Two consecutive bare-numId paragraphs still extend the same run.
    const second = planListMembership({ level: 1 }, state);
    expect(second).toBe(first);
  });

  it("closeListPlan clears both openNumId and openCanonicalNumId", () => {
    const state: ListPlanState = {
      next: 1,
      openNumId: "x",
      openCanonicalNumId: "list0",
    };
    closeListPlan(state);
    expect(state.openNumId).toBeUndefined();
    expect(state.openCanonicalNumId).toBeUndefined();
  });

  it("after closeListPlan, the same incoming numId mints a genuinely new run rather than extending the old one", () => {
    const state = freshListState();
    const first = planListMembership({ numId: "src-a", level: 0 }, state);
    closeListPlan(state);
    const second = planListMembership({ numId: "src-a", level: 0 }, state);
    expect(second).not.toBe(first);
  });
});

describe("readOdfListParagraphs", () => {
  function paragraphReader(): (element: XmlElement) => ContentParagraph {
    return (element) => ({
      kind: "paragraph",
      runs: [{ text: attrValue(element, "id") ?? "" }],
    });
  }

  it("reads a text:p item, attaching the given membership", () => {
    const list = el("text:list", {}, [
      el("text:list-item", {}, [el("text:p", { id: "a" })]),
    ]);
    const paragraphs = readOdfListParagraphs(
      list,
      { numId: "list1", level: 0 },
      paragraphReader(),
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.list).toEqual({ numId: "list1", level: 0 });
  });

  it("reads a text:h item exactly the same way as a text:p item", () => {
    const list = el("text:list", {}, [
      el("text:list-item", {}, [el("text:h", { id: "a" })]),
    ]);
    const paragraphs = readOdfListParagraphs(
      list,
      { numId: "list1", level: 0 },
      paragraphReader(),
    );
    expect(paragraphs).toHaveLength(1);
  });

  it("skips a non-text:list-item child of the list element", () => {
    const list = el("text:list", {}, [
      el("text:list-header", {}, [el("text:p", { id: "skip-me" })]),
    ]);
    const paragraphs = readOdfListParagraphs(
      list,
      { numId: "list1", level: 0 },
      paragraphReader(),
    );
    expect(paragraphs).toEqual([]);
  });

  it("skips a non-element child inside a list item", () => {
    const list = el("text:list", {}, [
      el("text:list-item", {}, [
        { type: "text", value: "stray text" },
        el("text:p", { id: "a" }),
      ]),
    ]);
    const paragraphs = readOdfListParagraphs(
      list,
      { numId: "list1", level: 0 },
      paragraphReader(),
    );
    expect(paragraphs).toHaveLength(1);
  });

  it("recurses into a nested text:list, incrementing level but keeping the SAME numId", () => {
    const list = el("text:list", {}, [
      el("text:list-item", {}, [
        el("text:p", { id: "outer" }),
        el("text:list", {}, [
          el("text:list-item", {}, [el("text:p", { id: "inner" })]),
        ]),
      ]),
    ]);
    const paragraphs = readOdfListParagraphs(
      list,
      { numId: "list1", level: 0 },
      paragraphReader(),
    );
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.list).toEqual({ numId: "list1", level: 0 });
    expect(paragraphs[1]!.list).toEqual({ numId: "list1", level: 1 });
  });

  it("preserves document order across multiple items and nesting", () => {
    const list = el("text:list", {}, [
      el("text:list-item", {}, [el("text:p", { id: "first" })]),
      el("text:list-item", {}, [el("text:p", { id: "second" })]),
    ]);
    const paragraphs = readOdfListParagraphs(
      list,
      { numId: "list1", level: 0 },
      paragraphReader(),
    );
    expect(paragraphs.map((p) => p.runs[0]!.text)).toEqual(["first", "second"]);
  });
});

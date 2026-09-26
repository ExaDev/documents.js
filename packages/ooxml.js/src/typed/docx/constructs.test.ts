import { describe, expect, it } from "vitest";
import type { ConstructDescriptor, ContentBlock } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readDocxContent } from "./read";
import {
  bookmarkAnchorDescriptor,
  indexParagraphContent,
  readContentControlDescriptor,
  readFormControlDescriptor,
  runRangeMarkerExtents,
  type ParagraphContentIndex,
  type ParagraphRangeMarkerHalf,
} from "./constructs";
function docxPackage(bodyChildren: readonly XmlNode[]): Package {
  const body = el("w:body", {}, [
    ...bodyChildren,
    el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
    },
  };
}

function para(text: string, ...extra: readonly XmlNode[]): XmlNode {
  return el("w:p", {}, [...extra, el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

function blocksOf(bodyChildren: readonly XmlNode[]): ContentBlock[] {
  return readDocxContent(docxPackage(bodyChildren)).sections[0]?.blocks ?? [];
}

// A compact, order-preserving projection of a block list: each construct marker as its descriptor (or a bare close), each paragraph as its text, everything else as its kind — so a test asserts the whole shape at once rather than probing indices one at a time.
function outline(
  blocks: readonly ContentBlock[],
): (string | ConstructDescriptor)[] {
  return blocks.map((block) => {
    if (block.kind === "constructStart") {
      return block.descriptor;
    }
    if (block.kind === "constructEnd") {
      return ")";
    }
    if (block.kind === "paragraph") {
      return block.runs.map((run) => run.text).join("");
    }
    return block.kind;
  });
}

describe("indexParagraphContent", () => {
  it("indexes a non-run element as content-bearing unconditionally, and a run only when it carries non-inert content", () => {
    // The hyperlink has no children at all, so it only counts as content-bearing via the "not a w:r" branch itself, never by inspecting children the way a run is inspected — if that branch were skipped, an empty non-run element would wrongly fall through to the run-only children check and read as empty. The run mixes an inert w:rPr with a real w:t, which only reads as content-bearing under "some child is non-inert" (true here); "every child is non-inert" would read it as false, since w:rPr alone already fails that.
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, []),
      el("w:hyperlink", {}, []),
      el("w:r", {}, [el("w:rPr", {}, []), el("w:t", {}, [txt("x")])]),
    ]);
    const index = indexParagraphContent(paragraph);
    expect(index.firstContentIndex).toBe(1);
    expect(index.lastContentIndex).toBe(2);
  });

  it("leaves both indices at -1 when a paragraph has no content-bearing children at all", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, []),
      el("w:bookmarkStart", { "w:id": "1" }, []),
    ]);
    const index = indexParagraphContent(paragraph);
    expect(index.firstContentIndex).toBe(-1);
    expect(index.lastContentIndex).toBe(-1);
  });
});

describe("runRangeMarkerExtents: isBlockScopedHalf", () => {
  const half = (
    element: ParagraphRangeMarkerHalf["element"],
    kind: "start" | "end",
    runPosition: number,
  ): ParagraphRangeMarkerHalf => ({
    element,
    family: "bookmark",
    id: "z",
    name: kind === "start" ? "bm" : undefined,
    kind,
    runPosition,
  });

  it("treats a half nested inside a container — not a direct paragraph child — as run-scoped, not block-scoped", () => {
    // Both halves sit inside the hyperlink rather than directly on the paragraph, so index.elements.indexOf never finds either: this is the "not found among the direct children" case the container comment describes, and it must resolve to run-scoped (kept) rather than silently falling through to the leading/trailing position math with a stray -1.
    const startEl = el("w:bookmarkStart", { "w:id": "z", "w:name": "bm" }, []);
    const endEl = el("w:bookmarkEnd", { "w:id": "z" }, []);
    const paragraph = el("w:p", {}, [
      el("w:hyperlink", {}, [
        startEl,
        el("w:r", {}, [el("w:t", {}, [txt("x")])]),
        endEl,
      ]),
    ]);
    const index = indexParagraphContent(paragraph);
    const extents = runRangeMarkerExtents(
      [half(startEl, "start", 0), half(endEl, "end", 1)],
      index,
    );
    expect(extents).toEqual([
      { descriptor: bookmarkAnchorDescriptor("bm"), startRun: 0, endRun: 1 },
    ]);
  });

  it("treats a found half with no content at all as leading regardless of its own position", () => {
    // A synthetic index whose firstContentIndex is -1 (no content-bearing children) while lastContentIndex is a real, larger value: leading's own "-1 means everything is leading" shortcut must fire for ANY position here, not just one smaller than some real firstContentIndex, and trailing must stay false since neither half's position exceeds lastContentIndex. Both halves land on the block-scoped path only through that shortcut, so the pair is dropped.
    const startEl = el("w:bookmarkStart", { "w:id": "z", "w:name": "bm" }, []);
    const endEl = el("w:bookmarkEnd", { "w:id": "z" }, []);
    const index: ParagraphContentIndex = {
      elements: [startEl, endEl],
      firstContentIndex: -1,
      lastContentIndex: 100,
    };
    // Arbitrary: the -1 shortcut this test exercises fires regardless of the end half's own array position.
    const END_HALF_POSITION = 5;
    const extents = runRangeMarkerExtents(
      [half(startEl, "start", 0), half(endEl, "end", END_HALF_POSITION)],
      index,
    );
    expect(extents).toEqual([]);
  });

  // A run of dummy filler elements, purely to occupy array slots: isBlockScopedHalf's "position" is index.elements.indexOf(half.element), not a half's own runPosition, so pinning a half to a specific array position means padding the array out to it.
  const filler = (): XmlElement => el("w:r", {}, []);

  it("treats a found half sitting exactly at the first content-bearing position as NOT leading", () => {
    // The start half sits at array position 0, exactly firstContentIndex (0): leading must be false there (strictly less than, not less-than-or-equal), or the pair would be wrongly dropped. The end half sits at array position 5, past a lastContentIndex of 2 by a wide margin, pinning IT as block-scoped (via trailing) regardless of either boundary mutant here or in the sibling test below — so the pair's own "both block-scoped" AND hinges entirely on the start half's own leading value.
    const startEl = el("w:bookmarkStart", { "w:id": "z", "w:name": "bm" }, []);
    const endEl = el("w:bookmarkEnd", { "w:id": "z" }, []);
    // endEl's own actual array position below: startEl (0), four fillers (1-4), endEl (5).
    const END_HALF_ARRAY_POSITION = 5;
    const index: ParagraphContentIndex = {
      elements: [startEl, filler(), filler(), filler(), filler(), endEl],
      firstContentIndex: 0,
      lastContentIndex: 2,
    };
    const extents = runRangeMarkerExtents(
      [half(startEl, "start", 0), half(endEl, "end", END_HALF_ARRAY_POSITION)],
      index,
    );
    expect(extents).toEqual([
      { descriptor: bookmarkAnchorDescriptor("bm"), startRun: 0, endRun: 5 },
    ]);
  });

  it("treats a found half sitting exactly at the last content-bearing position as NOT trailing", () => {
    // The end half sits at array position 15, exactly lastContentIndex (15): trailing must be false there (strictly greater than, not greater-than-or-equal), or the pair would be wrongly dropped. The start half sits at array position 0, clearly below a firstContentIndex of 10, pinning IT as block-scoped (via leading) regardless of either boundary mutant — so the AND hinges entirely on the end half's own trailing value.
    const startEl = el("w:bookmarkStart", { "w:id": "z", "w:name": "bm" }, []);
    const endEl = el("w:bookmarkEnd", { "w:id": "z" }, []);
    const elements = [startEl, ...Array.from({ length: 14 }, filler), endEl];
    // endEl's own actual array position: startEl (0), fourteen fillers (1-14), endEl (15).
    const END_HALF_ARRAY_POSITION = 15;
    const index: ParagraphContentIndex = {
      elements,
      firstContentIndex: 10,
      lastContentIndex: END_HALF_ARRAY_POSITION,
    };
    const extents = runRangeMarkerExtents(
      [half(startEl, "start", 0), half(endEl, "end", END_HALF_ARRAY_POSITION)],
      index,
    );
    expect(extents).toEqual([
      { descriptor: bookmarkAnchorDescriptor("bm"), startRun: 0, endRun: 15 },
    ]);
  });
});

describe("runRangeMarkerExtents: malformed pairings", () => {
  const flatIndex = (
    elements: readonly XmlElement[],
  ): ParagraphContentIndex => ({
    elements,
    firstContentIndex: 0,
    lastContentIndex: elements.length - 1,
  });

  it("drops an id with two starts and one end, rather than pairing the end with an arbitrary start", () => {
    const startA = el("w:bookmarkStart", { "w:id": "z", "w:name": "a" }, []);
    const startB = el("w:bookmarkStart", { "w:id": "z", "w:name": "b" }, []);
    const end = el("w:bookmarkEnd", { "w:id": "z" }, []);
    const halves: ParagraphRangeMarkerHalf[] = [
      {
        element: startA,
        family: "bookmark",
        id: "z",
        name: "a",
        kind: "start",
        runPosition: 0,
      },
      {
        element: startB,
        family: "bookmark",
        id: "z",
        name: "b",
        kind: "start",
        runPosition: 1,
      },
      {
        element: end,
        family: "bookmark",
        id: "z",
        name: undefined,
        kind: "end",
        runPosition: 2,
      },
    ];
    expect(
      runRangeMarkerExtents(halves, flatIndex([startA, startB, end])),
    ).toEqual([]);
  });

  it("drops an id with one start and two ends, rather than pairing the start with an arbitrary end", () => {
    const start = el("w:bookmarkStart", { "w:id": "z", "w:name": "a" }, []);
    const endA = el("w:bookmarkEnd", { "w:id": "z" }, []);
    const endB = el("w:bookmarkEnd", { "w:id": "z" }, []);
    const halves: ParagraphRangeMarkerHalf[] = [
      {
        element: start,
        family: "bookmark",
        id: "z",
        name: "a",
        kind: "start",
        runPosition: 0,
      },
      {
        element: endA,
        family: "bookmark",
        id: "z",
        name: undefined,
        kind: "end",
        runPosition: 1,
      },
      {
        element: endB,
        family: "bookmark",
        id: "z",
        name: undefined,
        kind: "end",
        runPosition: 2,
      },
    ];
    expect(
      runRangeMarkerExtents(halves, flatIndex([start, endA, endB])),
    ).toEqual([]);
  });

  it("drops a pair whose end precedes its own start rather than emitting a negative-length extent", () => {
    const start = el("w:bookmarkStart", { "w:id": "z", "w:name": "a" }, []);
    const end = el("w:bookmarkEnd", { "w:id": "z" }, []);
    const halves: ParagraphRangeMarkerHalf[] = [
      {
        element: start,
        family: "bookmark",
        id: "z",
        name: "a",
        kind: "start",
        runPosition: 5,
      },
      {
        element: end,
        family: "bookmark",
        id: "z",
        name: undefined,
        kind: "end",
        runPosition: 2,
      },
    ];
    expect(runRangeMarkerExtents(halves, flatIndex([start, end]))).toEqual([]);
  });
});

describe("docx constructs: structured document tags", () => {
  it("reads a block-level w:sdt as a contentControl construct bracketing its own content", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:alias", { "w:val": "Author name" }),
        el("w:tag", { "w:val": "author" }),
        el("w:lock", { "w:val": "sdtContentLocked" }),
        el("w:text"),
      ]),
      el("w:sdtContent", {}, [para("Ada Lovelace")]),
    ]);
    expect(outline(blocksOf([sdt]))).toEqual([
      {
        kind: "contentControl",
        controlType: "plainText",
        tag: "author",
        alias: "Author name",
        lock: "both",
      },
      "Ada Lovelace",
      ")",
    ]);
  });

  it("reads a dropdown control's own w:listItem entries as the descriptor options", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:dropDownList", {}, [
          el("w:listItem", { "w:displayText": "Draft", "w:value": "D" }),
          el("w:listItem", { "w:displayText": "Final", "w:value": "F" }),
        ]),
      ]),
      el("w:sdtContent", {}, [para("Draft")]),
    ]);
    expect(outline(blocksOf([sdt]))[0]).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Draft", "Final"],
    });
  });

  it("reads a dropdown control with no w:listItem entries as options: [], distinct from a control that is not a list field at all", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [el("w:dropDownList", {}, [])]),
      el("w:sdtContent", {}, [para("")]),
    ]);
    expect(outline(blocksOf([sdt]))[0]).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: [],
    });
  });

  it("reads a w14 checkbox control's checked state as a boolean rather than through the scalar value field", () => {
    const checked = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w14:checkbox", {}, [el("w14:checked", { "w14:val": "1" })]),
      ]),
      el("w:sdtContent", {}, [para("X")]),
    ]);
    const unchecked = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w14:checkbox", {}, [el("w14:checked", { "w14:val": "0" })]),
      ]),
      el("w:sdtContent", {}, [para("")]),
    ]);
    expect(outline(blocksOf([checked]))[0]).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
    });
    expect(outline(blocksOf([unchecked]))[0]).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: false,
    });
  });

  it("reads a date control's w:fullDate as the control's scalar value", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:date", { "w:fullDate": "2026-08-18T00:00:00Z" }),
      ]),
      el("w:sdtContent", {}, [para("18 August 2026")]),
    ]);
    expect(outline(blocksOf([sdt]))[0]).toEqual({
      kind: "contentControl",
      controlType: "date",
      value: "2026-08-18T00:00:00Z",
    });
  });

  it("reads a Table of Contents docPartObj gallery as an index control, and any other gallery as a plain rich-text container with its docPartObj quarantined in residue", () => {
    const toc = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:docPartObj", {}, [
          el("w:docPartGallery", { "w:val": "Table of Contents" }),
          el("w:docPartUnique"),
        ]),
      ]),
      el("w:sdtContent", {}, [para("Chapter 1")]),
    ]);
    const coverPage = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:docPartObj", {}, [
          el("w:docPartGallery", { "w:val": "Cover Pages" }),
        ]),
      ]),
      el("w:sdtContent", {}, [para("Title page")]),
    ]);
    // The TOC gallery is the one the semantic vocabulary names, so it needs no residue; every other gallery degrades to richText with the whole w:docPartObj element carried verbatim — the serialisation the lossless layer's own builder produces for that subtree, the same equivalence class it round-trips within.
    expect(outline(blocksOf([toc]))[0]).toEqual({
      kind: "contentControl",
      controlType: "index",
    });
    expect(outline(blocksOf([coverPage]))[0]).toEqual({
      kind: "contentControl",
      controlType: "richText",
      source: {
        format: "docx",
        xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"></w:docPartGallery></w:docPartObj>',
      },
    });
  });

  it("nests a content control inside a tracked insertion as nested marker pairs, innermost closing first", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [el("w:richText")]),
      el("w:sdtContent", {}, [para("Nested")]),
    ]);
    const ins = el("w:ins", { "w:id": "1", "w:author": "Ada" }, [sdt]);
    expect(outline(blocksOf([ins]))).toEqual([
      { kind: "provenance", change: "insertion", author: "Ada" },
      { kind: "contentControl", controlType: "richText" },
      "Nested",
      ")",
      ")",
    ]);
  });

  it("reads an inline w:sdt's content as ordinary runs, with no construct marker for a run-level extent", () => {
    const inlineSdt = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("before ")])]),
      el("w:sdt", {}, [
        el("w:sdtPr", {}, [el("w:text")]),
        el("w:sdtContent", {}, [
          el("w:r", {}, [el("w:t", {}, [txt("inside")])]),
        ]),
      ]),
      el("w:r", {}, [el("w:t", {}, [txt(" after")])]),
    ]);
    expect(outline(blocksOf([inlineSdt]))).toEqual(["before inside after"]);
  });
});

describe("readContentControlDescriptor: internals", () => {
  it("omits every optional field entirely, rather than setting it to undefined, when none of them apply", () => {
    // toStrictEqual (unlike toEqual) fails on an extra key holding undefined, which is exactly what each of the four optional-field guards below would produce if its own "!== undefined" check were forced true regardless of the actual value.
    const sdt = el("w:sdt", {}, [el("w:sdtPr", {}, [el("w:text")])]);
    expect(readContentControlDescriptor(sdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  it("accepts a Table of Contents gallery spelled as w:docPartList, not only w:docPartObj", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:docPartList", {}, [
          el("w:docPartGallery", { "w:val": "Table of Contents" }),
        ]),
      ]),
    ]);
    expect(readContentControlDescriptor(sdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "index",
    });
  });

  it("reads a comboBox's own listItem entries the same way a dropDownList's are read", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:comboBox", {}, [
          el("w:listItem", { "w:displayText": "One", "w:value": "1" }),
        ]),
      ]),
    ]);
    expect(readContentControlDescriptor(sdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "comboBox",
      options: ["One"],
    });
  });

  it("falls back to a listItem's own w:value when it carries no w:displayText", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:dropDownList", {}, [el("w:listItem", { "w:value": "raw" })]),
      ]),
    ]);
    expect(readContentControlDescriptor(sdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["raw"],
    });
  });

  it("reads a checkbox control from its plain w: spelling, not only the w14: forms", () => {
    // w:checkbox (not w14:checkbox) and w:checked (not w14:checked): both fallbacks must actually be reachable, not merely declared. w14:val is used directly here so this stays independent of the w:val fallback, which gets its own test below.
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:checkbox", {}, [el("w:checked", { "w14:val": "1" })]),
      ]),
    ]);
    expect(readContentControlDescriptor(sdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
    });
  });

  it("reads a checkbox's own checked value from its plain w:val, not only w14:val", () => {
    // "0" rather than some other value: a checked state read via a broken w:val fallback would come back undefined, which this toggle's own convention reads as checked (true) — indistinguishable from a genuine "1" unless the real answer is false.
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w14:checkbox", {}, [el("w14:checked", { "w:val": "0" })]),
      ]),
    ]);
    expect(readContentControlDescriptor(sdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: false,
    });
  });

  it("treats a checkbox with no w:checked child at all as unchecked, not absent", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [el("w14:checkbox", {}, [])]),
    ]);
    expect(readContentControlDescriptor(sdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: false,
    });
  });

  it("reads a checkbox's 'false' and 'off' values as unchecked, alongside '0'", () => {
    const falseSdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w14:checkbox", {}, [el("w14:checked", { "w14:val": "false" })]),
      ]),
    ]);
    const offSdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w14:checkbox", {}, [el("w14:checked", { "w14:val": "off" })]),
      ]),
    ]);
    expect(readContentControlDescriptor(falseSdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: false,
    });
    expect(readContentControlDescriptor(offSdt)).toStrictEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: false,
    });
  });
});

describe("readFormControlDescriptor: internals", () => {
  it("reads a legacy checkbox field's own checked value across '0', 'false', and 'off'", () => {
    const beginRun = (val: string): XmlElement =>
      el("w:r", {}, [
        el("w:ffData", {}, [
          el("w:checkBox", {}, [el("w:checked", { "w:val": val })]),
        ]),
      ]);
    expect(readFormControlDescriptor(beginRun("0"))?.checked).toBe(false);
    expect(readFormControlDescriptor(beginRun("false"))?.checked).toBe(false);
    expect(readFormControlDescriptor(beginRun("off"))?.checked).toBe(false);
  });

  it("falls back to w:default when a legacy checkbox field carries no w:checked", () => {
    const beginRun = el("w:r", {}, [
      el("w:ffData", {}, [
        el("w:checkBox", {}, [el("w:default", { "w:val": "0" })]),
      ]),
    ]);
    expect(readFormControlDescriptor(beginRun)?.checked).toBe(false);
  });

  it("defaults a legacy checkbox field's checked state to false when neither w:checked nor w:default is present", () => {
    const beginRun = el("w:r", {}, [
      el("w:ffData", {}, [el("w:checkBox", {}, [])]),
    ]);
    expect(readFormControlDescriptor(beginRun)?.checked).toBe(false);
  });

  it("never mistakes a legacy text field for a drop-down list", () => {
    const beginRun = el("w:r", {}, [
      el("w:ffData", {}, [el("w:textInput", {}, [])]),
    ]);
    const descriptor = readFormControlDescriptor(beginRun);
    expect(descriptor?.controlType).toBe("plainText");
    expect(descriptor?.source?.format).toBe("docx");
    expect(descriptor).not.toHaveProperty("options");
  });
});

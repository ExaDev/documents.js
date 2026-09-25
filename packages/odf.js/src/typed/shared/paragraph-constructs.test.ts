import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readOdfParagraph } from "./paragraph";
import { assertNeverOdfBookmarkMarkerSide } from "./paragraph-segmentation";
import type { ContentParagraph, DefinitionEntry } from "document-schema.js";
import type { OdfDefinitionsSink } from "./constructs-definitions";

// DefinitionEntry's body is deliberately tenant-open (document-schema.js's definitions.ts), so a test reading an entry's body as block content narrows it itself rather than asserting.
function bodyParagraphs(
  entry: DefinitionEntry | undefined,
): ContentParagraph[] {
  const body = entry?.body;
  if (
    !Array.isArray(body) ||
    !body.every(
      (block: unknown): block is ContentParagraph =>
        typeof block === "object" &&
        block !== null &&
        "kind" in block &&
        "runs" in block &&
        block.kind === "paragraph",
    )
  ) {
    throw new Error("expected a paragraph-only definitions body");
  }
  return body;
}

function contentPackage(
  automaticStyleChildren: readonly XmlElement[] = [],
): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, automaticStyleChildren),
      ]),
    ],
  };
}

function styleStyle(
  name: string,
  family: string,
  extra: Readonly<Record<string, string>>,
  children: readonly XmlElement[] = [],
): XmlElement {
  return el(
    "style:style",
    { "style:name": name, "style:family": family, ...extra },
    children,
  );
}

function textProps(attrs: Readonly<Record<string, string>>): XmlElement {
  return el("style:text-properties", attrs);
}

function paragraphProps(attrs: Readonly<Record<string, string>>): XmlElement {
  return el("style:paragraph-properties", attrs);
}

describe("readOdfParagraph: run-level construct extents (fields, bookmarks)", () => {
  it("reads a simple field as a run carrying its cached text plus a field extent covering exactly that run", () => {
    const p = el("text:p", {}, [
      txt("Page "),
      el("text:page-number", { "style:num-format": "arabic" }, [txt("3")]),
      txt(" of 10"),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "Page ",
      "3",
      " of 10",
    ]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "field",
          instruction:
            '<text:page-number style:num-format="arabic"></text:page-number>',
          cachedResult: "3",
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("reads a variable-set field instance the same way as an everyday simple field", () => {
    const p = el("text:p", {}, [
      el(
        "text:variable-set",
        {
          "text:name": "total",
          "office:value-type": "float",
          "office:value": "42",
          "text:formula": "oooc:=6*7",
        },
        [txt("42")],
      ),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual(["42"]);
    expect(paragraph.constructs?.[0]?.descriptor).toEqual({
      kind: "field",
      instruction:
        '<text:variable-set text:name="total" office:value-type="float" office:value="42" text:formula="oooc:=6*7"></text:variable-set>',
      cachedResult: "42",
    });
  });

  it("reads a field with no cached text as a point extent and emits no run for it", () => {
    const p = el("text:p", {}, [txt("A"), el("text:title"), txt("B")]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual(["A", "B"]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: { kind: "field", instruction: "<text:title></text:title>" },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it("reads a text:reference-ref cross-reference display as a field extent: a run with its cached text, instruction naming the referenced mark and the display format", () => {
    const p = el("text:p", {}, [
      txt("see figure on page "),
      el(
        "text:reference-ref",
        { "text:ref-name": "figure", "text:reference-format": "page" },
        [txt("12")],
      ),
      txt("."),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "see figure on page ",
      "12",
      ".",
    ]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "field",
          instruction:
            '<text:reference-ref text:ref-name="figure" text:reference-format="page"></text:reference-ref>',
          cachedResult: "12",
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("reads text:bookmark-ref and text:note-ref displays the same way — one *-ref display family, every member a field", () => {
    const p = el("text:p", {}, [
      el(
        "text:bookmark-ref",
        { "text:ref-name": "target", "text:reference-format": "chapter" },
        [txt("2.3")],
      ),
      txt(" and note "),
      el(
        "text:note-ref",
        { "text:ref-name": "ftn1", "text:reference-format": "page" },
        [txt("4")],
      ),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "2.3",
      " and note ",
      "4",
    ]);
    expect(
      paragraph.constructs?.map((extent) =>
        extent.descriptor.kind === "field"
          ? extent.descriptor.instruction
          : undefined,
      ),
    ).toEqual([
      '<text:bookmark-ref text:ref-name="target" text:reference-format="chapter"></text:bookmark-ref>',
      '<text:note-ref text:ref-name="ftn1" text:reference-format="page"></text:note-ref>',
    ]);
    const firstConstructStartRun = 0;
    const firstConstructEndRun = 1;
    const secondConstructStartRun = 2;
    const secondConstructEndRun = 3;
    expect(
      paragraph.constructs?.map((extent) => [extent.startRun, extent.endRun]),
    ).toEqual([
      [firstConstructStartRun, firstConstructEndRun],
      [secondConstructStartRun, secondConstructEndRun],
    ]);
  });

  it("leaves constructs absent when the paragraph carries no field, bookmark, or marker at all", () => {
    const p = el("text:p", {}, [txt("plain")]);
    expect(readOdfParagraph(p, { parts: {} }).constructs).toBeUndefined();
  });

  it("reads a point text:bookmark as a zero-width bookmark anchor at its run position", () => {
    const p = el("text:p", {}, [
      txt("before "),
      el("text:bookmark", { "text:name": "target" }),
      txt("after"),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "target" },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it("reads a point text:reference-mark as a zero-width bookmark anchor at its run position, exactly as a text:bookmark", () => {
    const p = el("text:p", {}, [
      txt("see "),
      el("text:reference-mark", { "text:name": "target" }),
      txt("below"),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual(["see ", "below"]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "target" },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it("pairs text:bookmark-start/-end inside one paragraph into a run extent over the runs between them", () => {
    const p = el("text:p", {}, [
      txt("outside "),
      el("text:bookmark-start", { "text:name": "span" }),
      txt("inside"),
      el("text:bookmark-end", { "text:name": "span" }),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "span" },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("pairs text:reference-mark-start/-end inside one paragraph into a run extent, as a family distinct from bookmarks", () => {
    const p = el("text:p", {}, [
      txt("growth of "),
      el("text:reference-mark-start", { "text:name": "figure" }),
      txt("figure 3"),
      el("text:reference-mark-end", { "text:name": "figure" }),
      txt(" over time"),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "growth of ",
      "figure 3",
      " over time",
    ]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "figure" },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("pairs a same-named bookmark and reference-mark independently, since ODF keeps the two name spaces separate", () => {
    // A bookmark 'x' and a reference-mark 'x' in one paragraph are two legal constructs that must never pair across families — grouping halves by key alone would see four halves and drop both. Both pairs sit interior (text on both sides) so this pins family discrimination, not the edge scope split.
    const p = el("text:p", {}, [
      txt("a "),
      el("text:bookmark-start", { "text:name": "x" }),
      txt("marked "),
      el("text:reference-mark-start", { "text:name": "x" }),
      txt("referenced"),
      el("text:bookmark-end", { "text:name": "x" }),
      el("text:reference-mark-end", { "text:name": "x" }),
      txt(" b"),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    const sharedEndRun = 3;
    expect(
      paragraph.constructs?.map((extent) => [
        extent.descriptor,
        extent.startRun,
        extent.endRun,
      ]),
    ).toEqual([
      [{ kind: "anchor", anchorType: "bookmark", name: "x" }, 1, sharedEndRun],
      [{ kind: "anchor", anchorType: "bookmark", name: "x" }, 2, sharedEndRun],
    ]);
  });

  it("keeps crossing in-paragraph bookmark extents as two entries, since run ranges are data rather than brackets", () => {
    const p = el("text:p", {}, [
      txt("a "),
      el("text:bookmark-start", { "text:name": "outer" }),
      txt("one "),
      el("text:bookmark-start", { "text:name": "inner" }),
      txt("two "),
      el("text:bookmark-end", { "text:name": "outer" }),
      txt("three"),
      el("text:bookmark-end", { "text:name": "inner" }),
      txt(" b"),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs?.map((extent) => extent.descriptor)).toEqual([
      { kind: "anchor", anchorType: "bookmark", name: "outer" },
      { kind: "anchor", anchorType: "bookmark", name: "inner" },
    ]);
    const outerEndRun = 3;
    const innerEndRun = 4;
    expect(
      paragraph.constructs?.map((extent) => [extent.startRun, extent.endRun]),
    ).toEqual([
      [1, outerEndRun],
      [2, innerEndRun],
    ]);
  });

  it("does not pair a bookmark whose halves both sit at paragraph edges — that pair brackets whole blocks and belongs to the block-scope reader, never to both encodings", () => {
    const p = el("text:p", {}, [
      el("text:bookmark-start", { "text:name": "whole" }),
      txt("whole paragraph is marked"),
      el("text:bookmark-end", { "text:name": "whole" }),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs).toBeUndefined();
  });

  it("does not emit a run extent for a bookmark half pair missing its partner or its name", () => {
    const p = el("text:p", {}, [
      el("text:bookmark-start", { "text:name": "lonely" }),
      txt("text"),
      el("text:bookmark-end", { "text:name": "other" }),
    ]);
    expect(readOdfParagraph(p, { parts: {} }).constructs).toBeUndefined();
  });

  it("resolves a field inside a text:span with the span formatting on its cached run, extent still indexed against the paragraph flat run list", () => {
    const t1 = styleStyle("T1", "text", {}, [
      textProps({ "fo:font-weight": "bold" }),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([t1]) } };
    const p = el("text:p", {}, [
      el("text:span", { "text:style-name": "T1" }, [
        el("text:date", { "style:data-style-name": "N80" }, [
          txt("2026-08-21"),
        ]),
      ]),
    ]);
    const paragraph = readOdfParagraph(p, pkg);
    expect(paragraph.runs[0]).toMatchObject({ text: "2026-08-21", bold: true });
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "field",
          instruction: '<text:date style:data-style-name="N80"></text:date>',
          cachedResult: "2026-08-21",
        },
        startRun: 0,
        endRun: 1,
      },
    ]);
  });

  it("reads a text:note as a citation run plus a footnote anchor extent, and reports the body to the definitions sink", () => {
    const note = el(
      "text:note",
      { "text:note-class": "footnote", "text:id": "ftn1" },
      [
        el("text:note-citation", {}, [txt("1")]),
        el("text:note-body", {}, [el("text:p", {}, [txt("The note body.")])]),
      ],
    );
    const p = el("text:p", {}, [txt("Claim"), note, txt(" continues.")]);
    const entries: Record<string, DefinitionEntry> = {};
    const sink: OdfDefinitionsSink = {
      entries,
      nextNoteOrdinal: 1,
      nextAnnotationOrdinal: 1,
    };
    const paragraph = readOdfParagraph(p, { parts: {} }, { definitions: sink });
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "Claim",
      "1",
      " continues.",
    ]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "anchor",
          anchorType: "footnote",
          name: "ftn1",
          definition: "note:ftn1",
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
    expect(entries["note:ftn1"]).toEqual({
      kind: "footnote",
      citation: "1",
      body: [
        {
          kind: "paragraph",
          runs: [
            {
              text: "The note body.",
              bold: undefined,
              italic: undefined,
              underline: undefined,
              strike: undefined,
              fontFamily: undefined,
              sizePt: undefined,
              color: undefined,
            },
          ],
          styleId: undefined,
          alignment: undefined,
          spacingBeforePt: undefined,
          spacingAfterPt: undefined,
          lineSpacing: undefined,
          indentLeftPt: undefined,
          indentFirstLinePt: undefined,
        },
      ],
    });
  });

  it("reads an endnote-class note with the endnote anchor type and a minted name when text:id is absent", () => {
    const note = el("text:note", { "text:note-class": "endnote" }, [
      el("text:note-citation", {}, [txt("i")]),
      el("text:note-body", {}, [el("text:p", {}, [txt("Endnote body.")])]),
    ]);
    const p = el("text:p", {}, [note]);
    const sink: OdfDefinitionsSink = {
      entries: {},
      nextNoteOrdinal: 1,
      nextAnnotationOrdinal: 1,
    };
    const paragraph = readOdfParagraph(p, { parts: {} }, { definitions: sink });
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "anchor",
          anchorType: "endnote",
          name: "note1",
          definition: "note:note1",
        },
        startRun: 0,
        endRun: 1,
      },
    ]);
    expect(sink.entries["note:note1"]).toMatchObject({
      kind: "endnote",
      citation: "i",
    });
  });

  it("mints sequentially INCREASING names across multiple unnamed notes, not the same name reused or a decreasing counter", () => {
    const note = (text: string) =>
      el("text:note", { "text:note-class": "footnote" }, [
        el("text:note-citation", {}, [txt(text)]),
      ]);
    const p = el("text:p", {}, [note("1"), note("2")]);
    const sink: OdfDefinitionsSink = {
      entries: {},
      nextNoteOrdinal: 1,
      nextAnnotationOrdinal: 1,
    };
    const paragraph = readOdfParagraph(p, { parts: {} }, { definitions: sink });
    expect(
      paragraph.constructs?.map((c) =>
        c.descriptor.kind === "anchor" ? c.descriptor.name : undefined,
      ),
    ).toEqual(["note1", "note2"]);
    expect(Object.keys(sink.entries)).toEqual(["note:note1", "note:note2"]);
  });

  it("reads an unnamed office:annotation as a point comment anchor at its run position, with its body and author in the definitions sink", () => {
    const annotation = el("office:annotation", {}, [
      el("dc:creator", {}, [txt("C. Reviewer")]),
      el("dc:date", {}, [txt("2026-08-20T14:00:00")]),
      el("text:p", {}, [txt("Comment body.")]),
    ]);
    const p = el("text:p", {}, [txt("Anchored "), annotation, txt("text")]);
    const sink: OdfDefinitionsSink = {
      entries: {},
      nextNoteOrdinal: 1,
      nextAnnotationOrdinal: 1,
    };
    const paragraph = readOdfParagraph(p, { parts: {} }, { definitions: sink });
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "Anchored ",
      "text",
    ]);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "anchor",
          anchorType: "comment",
          name: "annotation1",
          definition: "comment:annotation1",
        },
        startRun: 1,
        endRun: 1,
      },
    ]);
    expect(sink.entries["comment:annotation1"]).toMatchObject({
      kind: "comment",
      author: "C. Reviewer",
      dateIso: "2026-08-20T14:00:00",
    });
  });

  it("mints sequentially INCREASING names across multiple unnamed annotations, not the same name reused or a decreasing counter", () => {
    const annotation = (text: string) =>
      el("office:annotation", {}, [el("text:p", {}, [txt(text)])]);
    const p = el("text:p", {}, [annotation("first"), annotation("second")]);
    const sink: OdfDefinitionsSink = {
      entries: {},
      nextNoteOrdinal: 1,
      nextAnnotationOrdinal: 1,
    };
    readOdfParagraph(p, { parts: {} }, { definitions: sink });
    expect(Object.keys(sink.entries)).toEqual([
      "comment:annotation1",
      "comment:annotation2",
    ]);
  });

  it("assembles an annotation body's paragraphs and list items in document order, not paragraphs-then-lists", () => {
    const annotation = el("office:annotation", {}, [
      el("dc:creator", {}, [txt("C. Reviewer")]),
      el("text:p", {}, [txt("First paragraph.")]),
      el("text:list", {}, [
        el("text:list-item", {}, [el("text:p", {}, [txt("List item.")])]),
      ]),
      el("text:p", {}, [txt("Second paragraph.")]),
    ]);
    const p = el("text:p", {}, [txt("Anchored "), annotation, txt("text")]);
    const sink: OdfDefinitionsSink = {
      entries: {},
      nextNoteOrdinal: 1,
      nextAnnotationOrdinal: 1,
    };
    readOdfParagraph(p, { parts: {} }, { definitions: sink });
    expect(
      bodyParagraphs(sink.entries["comment:annotation1"]).map(
        (block) => block.runs[0]?.text,
      ),
    ).toEqual(["First paragraph.", "List item.", "Second paragraph."]);
  });

  it("quarantines the unmodellable half of the paragraph's own style chain as per-node residue when the context names the reading format", () => {
    const p1 = styleStyle("P1", "paragraph", {}, [
      paragraphProps({
        "fo:text-align": "center",
        "fo:keep-with-next": "always",
      }),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([p1]) } };
    const p = el("text:p", { "text:style-name": "P1" }, [txt("Kept")]);
    const paragraph = readOdfParagraph(p, pkg, { format: "odt" });
    expect(paragraph.alignment).toBe("center");
    expect(paragraph.source).toEqual({
      format: "odt",
      xml: '<style:paragraph-properties fo:text-align="center" fo:keep-with-next="always"></style:paragraph-properties>',
    });
  });

  it("leaves source absent when every property in the chain models cleanly, and when no reading format was supplied", () => {
    const p1 = styleStyle("P1", "paragraph", {}, [
      paragraphProps({ "fo:text-align": "center" }),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([p1]) } };
    const p = el("text:p", { "text:style-name": "P1" }, [txt("Kept")]);
    expect(readOdfParagraph(p, pkg, { format: "odt" }).source).toBeUndefined();
    const unknown = styleStyle("P2", "paragraph", {}, [
      paragraphProps({ "fo:keep-with-next": "always" }),
    ]);
    const pkg2: Package = {
      parts: { "content.xml": contentPackage([unknown]) },
    };
    const p2 = el("text:p", { "text:style-name": "P2" }, [txt("Kept")]);
    expect(readOdfParagraph(p2, pkg2).source).toBeUndefined();
  });

  it("pairs a named office:annotation with its office:annotation-end over the runs between them", () => {
    const annotation = el("office:annotation", { "office:name": "c1" }, [
      el("text:p", {}, [txt("Range comment.")]),
    ]);
    const p = el("text:p", {}, [
      txt("a "),
      annotation,
      txt("marked"),
      el("office:annotation-end", { "office:name": "c1" }),
      txt(" b"),
    ]);
    const sink: OdfDefinitionsSink = {
      entries: {},
      nextNoteOrdinal: 1,
      nextAnnotationOrdinal: 1,
    };
    const paragraph = readOdfParagraph(p, { parts: {} }, { definitions: sink });
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: "anchor",
          anchorType: "comment",
          name: "c1",
          definition: "comment:c1",
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
    expect(sink.entries["comment:c1"]).toMatchObject({ kind: "comment" });
  });
});

describe("assertNeverOdfBookmarkMarkerSide", () => {
  it("throws naming the unhandled side, proving writeOdfBookmarkMarker's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverOdfBookmarkMarkerSide("bogus" as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'writeOdfBookmarkMarker: unhandled OdfBookmarkMarker side "bogus"',
    );
  });
});

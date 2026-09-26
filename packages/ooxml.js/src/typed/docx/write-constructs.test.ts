import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentSection } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { elementsWithTag, rootElement } from "../util";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";
function docxPackage(
  bodyChildren: readonly XmlNode[],
  extraParts: Package["parts"] = {},
): Package {
  const body = el("w:body", {}, [
    ...bodyChildren,
    el("w:sectPr", {}, [
      el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
      el("w:pgMar", {
        "w:top": "1440",
        "w:right": "1440",
        "w:bottom": "1440",
        "w:left": "1440",
      }),
    ]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      ...extraParts,
    },
  };
}

function para(text: string, ...extra: readonly XmlNode[]): XmlNode {
  return el("w:p", {}, [...extra, el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

// Read, write, read: the second read's sections are what every assertion compares against the first's.
function roundTrip(source: Package): {
  before: ContentSection[];
  after: ContentSection[];
  written: Package;
} {
  const before = readDocxContent(source);
  const written = buildDocxPackageFromContent(before);
  return {
    before: before.sections,
    after: readDocxContent(written).sections,
    written,
  };
}

function expectStableRoundTrip(source: Package): ContentSection[] {
  const { before, after } = roundTrip(source);
  expect(after).toEqual(before);
  return after;
}

// The extras round trip: unlike `roundTrip` above, this carries the WHOLE DocxDocument — comments, footnotes, endnotes, header/footer parts, and numbering, not only sections — through buildDocxPackageFromContent, since DocxContent's own optional fields are a superset of what `roundTrip` exercises.
function writtenBookmarkOrder(
  paragraphElement: XmlNode | undefined,
): string[] | undefined {
  if (paragraphElement?.type !== "element") {
    return undefined;
  }
  const nameById = new Map<string, string>();
  for (const child of paragraphElement.children) {
    if (child.type === "element" && child.tag === "w:bookmarkStart") {
      const id = child.attributes.find(
        (attribute) => attribute.name === "w:id",
      )?.value;
      const name = child.attributes.find(
        (attribute) => attribute.name === "w:name",
      )?.value;
      if (id !== undefined && name !== undefined) {
        nameById.set(id, name);
      }
    }
  }
  const described: string[] = [];
  for (const child of paragraphElement.children) {
    if (
      child.type !== "element" ||
      (child.tag !== "w:r" &&
        child.tag !== "w:bookmarkStart" &&
        child.tag !== "w:bookmarkEnd")
    ) {
      continue;
    }
    if (child.tag === "w:r") {
      described.push("run");
      continue;
    }
    const id =
      child.attributes.find((attribute) => attribute.name === "w:id")?.value ??
      "";
    described.push(
      `${child.tag === "w:bookmarkStart" ? "start" : "end"}(${nameById.get(id) ?? id})`,
    );
  }
  return described;
}

describe("buildDocxPackageFromContent: construct round trip", () => {
  it("round-trips a content control with its type, tag, alias, lock, and options", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:alias", { "w:val": "Status" }),
        el("w:tag", { "w:val": "status" }),
        el("w:lock", { "w:val": "sdtLocked" }),
        el("w:dropDownList", {}, [
          el("w:listItem", { "w:displayText": "Draft" }),
          el("w:listItem", { "w:displayText": "Final" }),
        ]),
      ]),
      el("w:sdtContent", {}, [para("Draft")]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([sdt]));
    const start = sections[0]?.blocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      tag: "status",
      alias: "Status",
      lock: "container",
      options: ["Draft", "Final"],
    });
  });

  it("round-trips a checkbox, a date, and a table-of-contents control through their own docx spellings", () => {
    const control = (properties: readonly XmlNode[], text: string): XmlNode =>
      el("w:sdt", {}, [
        el("w:sdtPr", {}, properties),
        el("w:sdtContent", {}, [para(text)]),
      ]);
    const source = docxPackage([
      control(
        [el("w14:checkbox", {}, [el("w14:checked", { "w14:val": "1" })])],
        "X",
      ),
      control(
        [el("w:date", { "w:fullDate": "2026-08-18T00:00:00Z" })],
        "18 August 2026",
      ),
      control(
        [
          el("w:docPartObj", {}, [
            el("w:docPartGallery", { "w:val": "Table of Contents" }),
          ]),
        ],
        "Chapter 1",
      ),
    ]);
    const sections = expectStableRoundTrip(source);
    const descriptors = (sections[0]?.blocks ?? []).flatMap((block) =>
      block.kind === "constructStart" ? [block.descriptor] : [],
    );
    expect(descriptors).toEqual([
      { kind: "contentControl", controlType: "checkbox", checked: true },
      {
        kind: "contentControl",
        controlType: "date",
        value: "2026-08-18T00:00:00Z",
      },
      { kind: "contentControl", controlType: "index" },
    ]);
  });

  it("round-trips a non-TOC gallery through the residue channel: the docPartObj degrades to richText on read and is restored on write", () => {
    // The restorable tier's first consumer (document-schema.js's residue channel): a Cover Pages SDT reads back as a richText control carrying its w:docPartObj verbatim in descriptor.source, and the writer re-emits the element from that residue in place of the default w:richText type element — so the same-format pair loses the gallery name no longer.
    const coverPage = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:alias", { "w:val": "Title" }),
        el("w:docPartObj", {}, [
          el("w:docPartGallery", { "w:val": "Cover Pages" }),
        ]),
      ]),
      el("w:sdtContent", {}, [para("Title page")]),
    ]);
    const { before, after, written } = roundTrip(docxPackage([coverPage]));
    expect(after).toEqual(before);
    const descriptor = before[0]?.blocks[0];
    expect(
      descriptor?.kind === "constructStart" ? descriptor.descriptor : undefined,
    ).toEqual({
      kind: "contentControl",
      controlType: "richText",
      alias: "Title",
      source: {
        format: "docx",
        xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"></w:docPartGallery></w:docPartObj>',
      },
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const galleries =
      document === undefined
        ? []
        : elementsWithTag([document], "w:docPartGallery");
    expect(
      galleries.map(
        (gallery) =>
          gallery.attributes.find((attribute) => attribute.name === "w:val")
            ?.value,
      ),
    ).toEqual(["Cover Pages"]);
  });

  it("does not restore gallery residue on a controlType the reader never mints it on: a hand-built plainText control keeps its w:text element", () => {
    // Restoration is gated on the controlType the reader mints the residue on (richText, constructs.ts's degradation verdict), not on residue shape alone: a hand-built descriptor of any other controlType carrying docPartObj-shaped docx residue keeps its own semantic type element rather than having it silently replaced, and the residue stays quarantined for the same-format consumer that owns it.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                source: {
                  format: "docx",
                  xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"></w:docPartGallery></w:docPartObj>',
                },
              },
            },
            { kind: "paragraph", runs: [{ text: "plain" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const root = document === undefined ? [] : [document];
    expect(elementsWithTag(root, "w:text")).toHaveLength(1);
    expect(elementsWithTag(root, "w:docPartObj")).toHaveLength(0);
  });

  it("round-trips a tracked insertion and a tracked deletion, keeping the deleted text as deleted text, and wraps each paragraph's own runs rather than the paragraph itself", () => {
    const ins = el(
      "w:ins",
      { "w:id": "1", "w:author": "Ada", "w:date": "2026-08-18T09:00:00Z" },
      [para("added")],
    );
    const del = el("w:del", { "w:id": "2", "w:author": "Grace" }, [
      el("w:p", {}, [el("w:r", {}, [el("w:delText", {}, [txt("removed")])])]),
    ]);
    const { before, after, written } = roundTrip(docxPackage([ins, del]));
    expect(after).toEqual(before);
    const document = rootElement(written.parts["word/document.xml"]);
    const root = document === undefined ? [] : [document];
    expect(elementsWithTag(root, "w:delText")).toHaveLength(1);
    // CT_RunTrackChange (reached through EG_RunLevelElts) has no w:p in its content model: w:ins/w:del must wrap the paragraph's own runs, never the w:p element itself, and CT_TrackChange's own w:author is required on every one of them.
    for (const element of [
      ...elementsWithTag(root, "w:ins"),
      ...elementsWithTag(root, "w:del"),
    ]) {
      expect(
        element.children.some(
          (child) => child.type === "element" && child.tag === "w:p",
        ),
      ).toBe(false);
      expect(element.attributes.some((a) => a.name === "w:author")).toBe(true);
    }
  });

  it("mints its own author for a tracked change whose descriptor carries none, rather than omitting the required attribute", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: { kind: "provenance", change: "insertion" },
      },
      { kind: "paragraph", runs: [{ text: "anonymous" }] },
      { kind: "constructEnd" },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const insEls = elementsWithTag(
      document === undefined ? [] : [document],
      "w:ins",
    );
    expect(insEls.length).toBeGreaterThan(0);
    for (const element of insEls) {
      const author = element.attributes.find(
        (a) => a.name === "w:author",
      )?.value;
      expect(author).toBeTruthy();
    }
  });

  it("threads a tracked change through a nested bookmark down to the paragraph it wraps, rather than dropping it", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: { kind: "provenance", change: "insertion", author: "Ada" },
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "intro" },
      },
      { kind: "paragraph", runs: [{ text: "nested" }] },
      { kind: "constructEnd" },
      { kind: "constructEnd" },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    expect(
      body?.type === "element"
        ? body.children.map((child) =>
            child.type === "element" ? child.tag : child.type,
          )
        : undefined,
    ).toEqual(["w:bookmarkStart", "w:p", "w:bookmarkEnd", "w:sectPr"]);
    const descriptors =
      readDocxContent(written).sections[0]?.blocks.flatMap((block) =>
        block.kind === "constructStart" ? [block.descriptor] : [],
      ) ?? [];
    expect(descriptors).toContainEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "intro",
    });
    expect(descriptors).toContainEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ada",
    });
  });

  it("round-trips a move pair as its own two provenance changes", () => {
    const moveFrom = el("w:p", {}, [
      el("w:moveFrom", { "w:id": "1", "w:author": "Ada" }, [
        el("w:r", {}, [el("w:delText", {}, [txt("moved")])]),
      ]),
    ]);
    const moveTo = el("w:p", {}, [
      el("w:moveTo", { "w:id": "2", "w:author": "Ada" }, [
        el("w:r", {}, [el("w:t", {}, [txt("moved")])]),
      ]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([moveFrom, moveTo]));
    const descriptors = (sections[0]?.blocks ?? []).flatMap((block) =>
      block.kind === "constructStart" ? [block.descriptor] : [],
    );
    expect(descriptors).toEqual([
      { kind: "provenance", change: "moveFrom", author: "Ada" },
      { kind: "provenance", change: "moveTo", author: "Ada" },
    ]);
  });

  it("round-trips a bookmark spanning several paragraphs", () => {
    const source = docxPackage([
      el("w:bookmarkStart", { "w:id": "1", "w:name": "intro" }),
      para("one"),
      para("two"),
      el("w:bookmarkEnd", { "w:id": "1" }),
      para("outside"),
    ]);
    const sections = expectStableRoundTrip(source);
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
      "paragraph",
    ]);
  });

  it("round-trips a bookmark Word wrote inside a heading paragraph as a block-level pair around it", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:bookmarkStart", { "w:id": "3", "w:name": "_Toc9" }),
        el("w:r", {}, [el("w:t", {}, [txt("Chapter")])]),
        el("w:bookmarkEnd", { "w:id": "3" }),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    expect(
      body?.type === "element"
        ? body.children.map((child) =>
            child.type === "element" ? child.tag : child.type,
          )
        : undefined,
    ).toEqual(["w:bookmarkStart", "w:p", "w:bookmarkEnd", "w:sectPr"]);
  });

  it("round-trips a bookmark whose extent is a sub-sequence of one paragraph's runs, as a run-level construct extent", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("before ")])]),
        el("w:bookmarkStart", { "w:id": "4", "w:name": "midway" }),
        el("w:r", {}, [el("w:t", {}, [txt("marked")])]),
        el("w:bookmarkEnd", { "w:id": "4" }),
        el("w:r", {}, [el("w:t", {}, [txt(" after")])]),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "midway" },
        startRun: 1,
        endRun: 2,
      },
    ]);
    // The writer puts the halves back between the runs the range names — inside the paragraph, never around it.
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement =
      body?.type === "element"
        ? body.children.find(
            (child) => child.type === "element" && child.tag === "w:p",
          )
        : undefined;
    const tags =
      paragraphElement?.type === "element"
        ? paragraphElement.children.map((child) =>
            child.type === "element" ? child.tag : child.type,
          )
        : undefined;
    expect(tags).toEqual([
      "w:r",
      "w:bookmarkStart",
      "w:r",
      "w:bookmarkEnd",
      "w:r",
    ]);
  });

  it("round-trips two bookmarks whose run-level extents cross, keeping both", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("one ")])]),
        el("w:bookmarkStart", { "w:id": "1", "w:name": "first" }),
        el("w:r", {}, [el("w:t", {}, [txt("two ")])]),
        el("w:bookmarkStart", { "w:id": "2", "w:name": "second" }),
        el("w:r", {}, [el("w:t", {}, [txt("three ")])]),
        el("w:bookmarkEnd", { "w:id": "1" }),
        el("w:r", {}, [el("w:t", {}, [txt(" four")])]),
        el("w:bookmarkEnd", { "w:id": "2" }),
      ]),
    ]);
    const sections = expectStableRoundTrip(source);
    const paragraph = sections[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "first" },
        startRun: 1,
        endRun: 3,
      },
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "second" },
        startRun: 2,
        endRun: 4,
      },
    ]);
  });

  it("round-trips a point run extent and one reaching the paragraph's tail", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("unmarked ")])]),
        el("w:bookmarkStart", { "w:id": "5", "w:name": "tail" }),
        el("w:r", {}, [el("w:t", {}, [txt("marked")])]),
        el("w:bookmarkStart", { "w:id": "6", "w:name": "point" }),
        el("w:bookmarkEnd", { "w:id": "6" }),
        el("w:r", {}, [el("w:t", {}, [txt(" also")])]),
        el("w:bookmarkEnd", { "w:id": "5" }),
      ]),
    ]);
    const sections = expectStableRoundTrip(source);
    const paragraph = sections[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "tail" },
        startRun: 1,
        endRun: 3,
      },
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "point" },
        startRun: 2,
        endRun: 2,
      },
    ]);
  });

  it("writes a point run extent's own halves as a start-then-end pair, not an inverted one", () => {
    // WordprocessingML pairs w:bookmarkStart/End by w:id with start-before-end ordering, so the ORDER of a point extent's own two halves is load-bearing for every consumer that pairs by id and order (Word included): the boundary convention of emitting closes before opens exists for two DIFFERENT extents meeting at one boundary, and applied to a point's own halves it would put the bookmarkEnd first. The written order of the neighbouring range extent is pinned too — its close lands after the last run it covers, the point pair between the runs its position names.
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("unmarked ")])]),
        el("w:bookmarkStart", { "w:id": "5", "w:name": "tail" }),
        el("w:r", {}, [el("w:t", {}, [txt("marked")])]),
        el("w:bookmarkStart", { "w:id": "6", "w:name": "point" }),
        el("w:bookmarkEnd", { "w:id": "6" }),
        el("w:r", {}, [el("w:t", {}, [txt(" also")])]),
        el("w:bookmarkEnd", { "w:id": "5" }),
      ]),
    ]);
    const { written } = roundTrip(source);
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement =
      body?.type === "element"
        ? body.children.find(
            (child) => child.type === "element" && child.tag === "w:p",
          )
        : undefined;
    expect(writtenBookmarkOrder(paragraphElement)).toEqual([
      "run",
      "start(tail)",
      "run",
      "start(point)",
      "end(point)",
      "run",
      "end(tail)",
    ]);
  });

  it("writes two point run extents sharing one run position with each start before its own end", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("one ")])]),
        el("w:bookmarkStart", { "w:id": "1", "w:name": "first" }),
        el("w:bookmarkEnd", { "w:id": "1" }),
        el("w:bookmarkStart", { "w:id": "2", "w:name": "second" }),
        el("w:bookmarkEnd", { "w:id": "2" }),
        el("w:r", {}, [el("w:t", {}, [txt("two")])]),
      ]),
    ]);
    const { written } = roundTrip(source);
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement =
      body?.type === "element"
        ? body.children.find(
            (child) => child.type === "element" && child.tag === "w:p",
          )
        : undefined;
    expect(writtenBookmarkOrder(paragraphElement)).toEqual([
      "run",
      "start(first)",
      "end(first)",
      "start(second)",
      "end(second)",
      "run",
    ]);
  });
});

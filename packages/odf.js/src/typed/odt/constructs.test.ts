import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { flattenTree } from "document-schema.js";
import { readOdt, readOdtContent } from "./read";

// The block-scope construct rows of the fidelity vocabulary (ExaDev/documents.js#719): text:section as a division, the TOC/index wrappers as index content controls, tracked changes as provenance, and the definitions-table tenants. Every fixture here is a programmatic package built with el/txt — the fixture gate the issue itself states: real-producer verification for these constructs is outstanding, and the shapes below follow the OASIS ODF 1.2 element/attribute grammar rather than any single producer's output.

function odtPackage(
  textChildren: readonly XmlElement[],
  automaticStyles: readonly XmlElement[] = [],
): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:automatic-styles", {}, automaticStyles),
            el("office:body", {}, [el("office:text", {}, textChildren)]),
          ]),
        ],
      },
    },
  };
}

function paragraph(text: string): XmlElement {
  return el("text:p", {}, [txt(text)]);
}

function firstSectionBlocks(pkg: Package) {
  const { sections } = readOdtContent(pkg);
  const section = sections[0];
  if (section === undefined) {
    throw new Error("expected at least one section");
  }
  return section.blocks;
}

describe("readOdtContent: text:section as a division construct", () => {
  it("brackets a section's blocks with a division constructStart/constructEnd pair carrying name and protected", () => {
    const pkg = odtPackage([
      paragraph("before"),
      el(
        "text:section",
        { "text:name": "Chapter1", "text:protected": "true" },
        [paragraph("inside")],
      ),
      paragraph("after"),
    ]);
    expect(firstSectionBlocks(pkg)).toEqual([
      {
        kind: "paragraph",
        runs: [
          {
            text: "before",
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
      {
        kind: "constructStart",
        descriptor: { kind: "division", name: "Chapter1", protected: true },
      },
      {
        kind: "paragraph",
        runs: [
          {
            text: "inside",
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
      { kind: "constructEnd" },
      {
        kind: "paragraph",
        runs: [
          {
            text: "after",
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
    ]);
  });

  it("carries a text:section-source as division.linked with its href and section-name, and its text:filter-name as division.source residue", () => {
    const pkg = odtPackage([
      el("text:section", { "text:name": "LinkedChapter" }, [
        el("text:section-source", {
          "xlink:href": "../chapter1.odt",
          "text:section-name": "InnerSection",
          "text:filter-name": "writer8",
        }),
        paragraph("cached"),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks[0]).toEqual({
      kind: "constructStart",
      descriptor: {
        kind: "division",
        name: "LinkedChapter",
        linked: { href: "../chapter1.odt", sectionName: "InnerSection" },
        source: {
          format: "odt",
          xml: '<text:section-source text:filter-name="writer8"></text:section-source>',
        },
      },
    });
  });

  it("reads the column count a section's own section-family style sets over its flow", () => {
    const sectionStyle = el(
      "style:style",
      { "style:name": "Sect1", "style:family": "section" },
      [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "3" }),
        ]),
      ],
    );
    const pkg = odtPackage(
      [
        el(
          "text:section",
          { "text:name": "Columns", "text:style-name": "Sect1" },
          [paragraph("columnar")],
        ),
      ],
      [sectionStyle],
    );
    const blocks = firstSectionBlocks(pkg);
    expect(blocks[0]).toEqual({
      kind: "constructStart",
      descriptor: { kind: "division", name: "Columns", columnCount: 3 },
    });
  });

  it("nests a section inside a section as nested marker pairs", () => {
    const pkg = odtPackage([
      el("text:section", { "text:name": "Outer" }, [
        paragraph("outer text"),
        el("text:section", { "text:name": "Inner" }, [paragraph("inner text")]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "constructStart",
      "paragraph",
      "constructEnd",
      "constructEnd",
    ]);
  });

  it("places a nested section's marker pair over the nested section's own blocks when a paragraph precedes the outer wrapper", () => {
    // The nested wrapper's extent must be indexed against the ONE flat block list, not the recursive call's own local array: with 'before' occupying block 0, Inner's pair belongs around 'inner text' (inside Outer), and Outer's around everything of its own — never around 'before'.
    const pkg = odtPackage([
      paragraph("before"),
      el("text:section", { "text:name": "Outer" }, [
        el("text:section", { "text:name": "Inner" }, [paragraph("inner text")]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "constructStart",
      "paragraph",
      "constructEnd",
      "constructEnd",
    ]);
    const descriptors = blocks
      .filter((block) => block.kind === "constructStart")
      .map((block) => block.descriptor);
    expect(descriptors).toEqual([
      { kind: "division", name: "Outer" },
      { kind: "division", name: "Inner" },
    ]);
  });

  it("places a nested index wrapper's marker pair over its cached body blocks when a paragraph precedes the enclosing section", () => {
    const pkg = odtPackage([
      paragraph("before"),
      el("text:section", { "text:name": "S" }, [
        el("text:table-of-content", { "text:name": "TOC" }, [
          el("text:index-body", {}, [paragraph("entry")]),
        ]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "constructStart",
      "paragraph",
      "constructEnd",
      "constructEnd",
    ]);
    const descriptors = blocks
      .filter((block) => block.kind === "constructStart")
      .map((block) => block.descriptor);
    expect(descriptors).toEqual([
      { kind: "division", name: "S" },
      { kind: "contentControl", controlType: "index", tag: "TOC" },
    ]);
  });

  it("survives the package boundary: flattenTree(readOdt(pkg)) reproduces the flat reader's blocks with markers intact", () => {
    const pkg = odtPackage([
      el("text:section", { "text:name": "S1" }, [
        paragraph("first"),
        el("text:section", { "text:name": "S2" }, [paragraph("second")]),
      ]),
    ]);
    const flat = flattenTree(readOdt(pkg));
    if (flat.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(flat.sections[0]?.blocks).toEqual(firstSectionBlocks(pkg));
  });
});

describe("readOdtContent: TOC and index wrappers as index content controls", () => {
  it("reads a text:table-of-content as an index contentControl bracketing its cached index-body blocks", () => {
    const pkg = odtPackage([
      el("text:table-of-content", { "text:name": "Table of Contents1" }, [
        el("text:table-of-content-source", { "text:outline-level": "3" }),
        el("text:index-body", {}, [paragraph("Chapter One..........1")]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "constructEnd",
    ]);
    if (blocks[0]?.kind !== "constructStart") {
      throw new Error("expected a constructStart marker");
    }
    expect(blocks[0].descriptor).toEqual({
      kind: "contentControl",
      controlType: "index",
      tag: "Table of Contents1",
      source: {
        format: "odt",
        xml: '<text:table-of-content-source text:outline-level="3"></text:table-of-content-source>',
      },
    });
  });

  it("reads every index wrapper kind as the same index controlType, with the cached body and no wrapper-name fabrication", () => {
    for (const tag of [
      "text:alphabetical-index",
      "text:bibliography",
      "text:illustration-index",
      "text:table-index",
      "text:user-index",
      "text:object-index",
    ]) {
      const pkg = odtPackage([
        el(tag, {}, [el("text:index-body", {}, [paragraph("entry")])]),
      ]);
      const blocks = firstSectionBlocks(pkg);
      expect(
        blocks.map((block) => block.kind),
        tag,
      ).toEqual(["constructStart", "paragraph", "constructEnd"]);
      if (blocks[0]?.kind !== "constructStart") {
        throw new Error("expected a constructStart marker");
      }
      const descriptor = blocks[0].descriptor;
      expect(descriptor.kind, tag).toBe("contentControl");
      if (descriptor.kind !== "contentControl") {
        throw new Error("expected a content control descriptor");
      }
      expect(descriptor.controlType, tag).toBe("index");
    }
  });

  it("reads an index-body's text:index-title blocks as ordinary cached body content", () => {
    const pkg = odtPackage([
      el("text:table-of-content", {}, [
        el("text:index-body", {}, [
          el("text:index-title", {}, [paragraph("Contents")]),
          paragraph("Chapter One..........1"),
        ]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(
      blocks
        .filter((block) => block.kind === "paragraph")
        .map((block) => block.runs[0]?.text),
    ).toEqual(["Contents", "Chapter One..........1"]);
  });
});

describe("readOdtContent: tracked changes as provenance constructs", () => {
  const REGIONS: XmlElement[] = [
    el("text:tracked-changes", {}, [
      el("text:changed-region", { "xml:id": "ins1" }, [
        el("text:insertion", {}, [
          el("office:change-info", {}, [
            el("dc:creator", {}, [txt("A. Reviewer")]),
            el("dc:date", {}, [txt("2026-08-19T09:30:00")]),
          ]),
        ]),
      ]),
      el("text:changed-region", { "xml:id": "del1" }, [
        el("text:deletion", {}, [
          el("office:change-info", {}, [
            el("dc:creator", {}, [txt("D. Editor")]),
            el("dc:date", {}, [txt("2026-08-19T10:00:00")]),
          ]),
        ]),
      ]),
    ]),
  ];

  it("reads a point text:change as a run-level provenance extent resolved from its changed-region", () => {
    const pkg = odtPackage([
      ...REGIONS,
      el("text:p", {}, [
        txt("inserted "),
        el("text:change", { "text:change-id": "ins1" }),
        txt("words"),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(blocks[0].constructs).toEqual([
      {
        descriptor: {
          kind: "provenance",
          change: "insertion",
          author: "A. Reviewer",
          dateIso: "2026-08-19T09:30:00",
        },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it("pairs interior change-start/-end in one paragraph into a run-level provenance extent", () => {
    const pkg = odtPackage([
      ...REGIONS,
      el("text:p", {}, [
        txt("kept "),
        el("text:change-start", { "text:change-id": "del1" }),
        txt("deleted"),
        el("text:change-end", { "text:change-id": "del1" }),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(blocks[0].constructs).toEqual([
      {
        descriptor: {
          kind: "provenance",
          change: "deletion",
          author: "D. Editor",
          dateIso: "2026-08-19T10:00:00",
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("brackets whole blocks with provenance markers when change-start leads one paragraph and change-end trails a later one", () => {
    const pkg = odtPackage([
      ...REGIONS,
      el("text:p", {}, [
        el("text:change-start", { "text:change-id": "ins1" }),
        txt("first inserted"),
      ]),
      el("text:p", {}, [
        txt("second inserted"),
        el("text:change-end", { "text:change-id": "ins1" }),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
    if (blocks[0]?.kind !== "constructStart") {
      throw new Error("expected a constructStart marker");
    }
    expect(blocks[0].descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "A. Reviewer",
      dateIso: "2026-08-19T09:30:00",
    });
  });

  it("reads the region id spelled text:id (the ODF 1.0 form) as readily as xml:id", () => {
    const legacyRegions = [
      el("text:tracked-changes", {}, [
        el("text:changed-region", { "text:id": "fmt1" }, [
          el("text:format-change", {}, [
            el("office:change-info", {}, [
              el("dc:creator", {}, [txt("F. Stylist")]),
            ]),
          ]),
        ]),
      ]),
    ];
    const pkg = odtPackage([
      ...legacyRegions,
      el("text:p", {}, [
        txt("restyled "),
        el("text:change", { "text:change-id": "fmt1" }),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(blocks[0].constructs).toEqual([
      {
        descriptor: {
          kind: "provenance",
          change: "formatChange",
          author: "F. Stylist",
        },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it("drops a change marker whose region id resolves to nothing, and contributes no blocks for the text:tracked-changes container itself", () => {
    const pkg = odtPackage([
      ...REGIONS,
      el("text:p", {}, [
        txt("orphan marker "),
        el("text:change", { "text:change-id": "nosuch" }),
        txt("here"),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(blocks[0].constructs).toBeUndefined();
  });

  it("survives the package boundary with provenance markers intact", () => {
    const pkg = odtPackage([
      ...REGIONS,
      el("text:p", {}, [
        el("text:change-start", { "text:change-id": "del1" }),
        txt("gone"),
      ]),
      el("text:p", {}, [
        txt("also gone"),
        el("text:change-end", { "text:change-id": "del1" }),
      ]),
    ]);
    const flat = flattenTree(readOdt(pkg));
    if (flat.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(flat.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });
});

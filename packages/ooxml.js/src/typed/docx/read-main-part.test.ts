import { describe, expect, it } from "vitest";
import type { Package, Part } from "../../model/package";
import type { ContentParagraph } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readDocxContent } from "./read";

// A docx whose body does NOT sit at word/document.xml. OPC names the main part through the package root's officeDocument relationship and everything hanging off it through that part's own relationships, so a producer is free to call the body anything; Word opens such a file without complaint (ExaDev/documents.js#1314). Every package here is built in code -- no real-world file is committed as a fixture.

const RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface RelationshipSpec {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

function relsPart(relationships: readonly RelationshipSpec[]): Part {
  return {
    kind: "xml",
    nodes: [
      el(
        "Relationships",
        { xmlns: RELATIONSHIPS_NS },
        relationships.map((rel) =>
          el("Relationship", {
            Id: rel.id,
            Type: rel.type,
            Target: rel.target,
          }),
        ),
      ),
    ],
  };
}

function paragraph(text: string, styleId?: string) {
  return el("w:p", {}, [
    ...(styleId === undefined
      ? []
      : [el("w:pPr", {}, [el("w:pStyle", { "w:val": styleId })])]),
    el("w:r", {}, [el("w:t", {}, [txt(text)])]),
  ]);
}

function documentPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("w:document", {}, [
        el("w:body", {}, [
          paragraph("Renamed body", "Emphatic"),
          el("w:sectPr", {}, [
            el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
            el("w:headerReference", { "w:type": "default", "r:id": "rId10" }),
            el("w:footerReference", { "w:type": "default", "r:id": "rId11" }),
          ]),
        ]),
      ]),
    ],
  };
}

function stylesPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("w:styles", {}, [
        el("w:style", { "w:type": "paragraph", "w:styleId": "Emphatic" }, [
          el("w:rPr", {}, [el("w:b", {})]),
        ]),
      ]),
    ],
  };
}

function headerPart(text: string): Part {
  return { kind: "xml", nodes: [el("w:hdr", {}, [paragraph(text)])] };
}

function footerPart(text: string): Part {
  return { kind: "xml", nodes: [el("w:ftr", {}, [paragraph(text)])] };
}

function commentsPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("w:comments", {}, [
        el("w:comment", { "w:id": "1", "w:author": "Reviewer" }, [
          el("w:p", {}, [
            el("w:r", {}, [el("w:t", {}, [txt("Renamed note")])]),
          ]),
        ]),
      ]),
    ],
  };
}

function notesPart(containerTag: string, noteTag: string, text: string): Part {
  return {
    kind: "xml",
    nodes: [
      el(containerTag, {}, [
        el(noteTag, { "w:id": "2" }, [
          el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt(text)])])]),
        ]),
      ]),
    ],
  };
}

function numberingPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("w:numbering", {}, [
        el("w:abstractNum", { "w:abstractNumId": "0" }, [
          el("w:lvl", { "w:ilvl": "0" }, [
            el("w:numFmt", { "w:val": "lowerRoman" }),
            el("w:lvlText", { "w:val": "%1." }),
          ]),
        ]),
        el("w:num", { "w:numId": "7" }, [
          el("w:abstractNumId", { "w:val": "0" }),
        ]),
      ]),
    ],
  };
}

// The body at word/document2.xml, with every companion part renamed alongside it and reached only through the main part's own relationships. The footer Target is package-rooted on purpose: resolved against the main part's directory instead it would become word/word/footer2.xml and the footer would silently vanish.
function renamedMainPartPackage(): Package {
  return {
    parts: {
      "_rels/.rels": relsPart([
        {
          id: "rId1",
          type: `${REL_BASE}/officeDocument`,
          target: "word/document2.xml",
        },
      ]),
      "word/document2.xml": documentPart(),
      "word/_rels/document2.xml.rels": relsPart([
        { id: "rId2", type: `${REL_BASE}/styles`, target: "styles2.xml" },
        { id: "rId3", type: `${REL_BASE}/comments`, target: "comments2.xml" },
        { id: "rId4", type: `${REL_BASE}/footnotes`, target: "footnotes2.xml" },
        { id: "rId5", type: `${REL_BASE}/endnotes`, target: "endnotes2.xml" },
        { id: "rId6", type: `${REL_BASE}/numbering`, target: "numbering2.xml" },
        { id: "rId10", type: `${REL_BASE}/header`, target: "header2.xml" },
        {
          id: "rId11",
          type: `${REL_BASE}/footer`,
          target: "/word/footer2.xml",
        },
      ]),
      "word/styles2.xml": stylesPart(),
      "word/comments2.xml": commentsPart(),
      "word/footnotes2.xml": notesPart(
        "w:footnotes",
        "w:footnote",
        "Renamed footnote",
      ),
      "word/endnotes2.xml": notesPart(
        "w:endnotes",
        "w:endnote",
        "Renamed endnote",
      ),
      "word/numbering2.xml": numberingPart(),
      "word/header2.xml": headerPart("Renamed header"),
      "word/footer2.xml": footerPart("Renamed footer"),
    },
  };
}

function firstParagraph(pkg: Package): ContentParagraph {
  const block = readDocxContent(pkg).sections[0]?.blocks[0];
  if (block?.kind !== "paragraph") {
    throw new Error("expected the first block to be a paragraph");
  }
  return block;
}

describe("readDocxContent: main part named by the officeDocument relationship", () => {
  it("reads a body the package puts at word/document2.xml", () => {
    expect(firstParagraph(renamedMainPartPackage()).runs[0]?.text).toBe(
      "Renamed body",
    );
  });

  it("reads a body sitting directly at the package root, whose rels live in _rels beside it", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${REL_BASE}/officeDocument`,
            target: "document2.xml",
          },
        ]),
        "document2.xml": documentPart(),
        "_rels/document2.xml.rels": relsPart([
          {
            id: "rId2",
            type: `${REL_BASE}/styles`,
            target: "word/styles2.xml",
          },
        ]),
        "word/styles2.xml": stylesPart(),
      },
    };
    expect(firstParagraph(pkg).runs[0]?.text).toBe("Renamed body");
    expect(firstParagraph(pkg).runs[0]?.bold).toBe(true);
  });

  it("resolves the style cascade through the renamed part's own styles relationship", () => {
    expect(firstParagraph(renamedMainPartPackage()).runs[0]?.bold).toBe(true);
  });

  it("reads the header the renamed part's own relationship names", () => {
    const doc = readDocxContent(renamedMainPartPackage());
    expect(doc.sectionHeaderFooters[0]?.header?.default).toBe(
      "word/header2.xml",
    );
    expect(doc.headerFooterParts.map((part) => part.path)).toContain(
      "word/header2.xml",
    );
  });

  it("resolves a package-rooted footer Target from the package root, not from the main part's directory", () => {
    const doc = readDocxContent(renamedMainPartPackage());
    expect(doc.sectionHeaderFooters[0]?.footer?.default).toBe(
      "word/footer2.xml",
    );
    expect(doc.headerFooterParts.map((part) => part.path)).toContain(
      "word/footer2.xml",
    );
  });

  it("reads comments, footnotes and endnotes through the renamed part's own relationships", () => {
    const doc = readDocxContent(renamedMainPartPackage());
    expect(doc.comments.map((comment) => comment.text)).toEqual([
      "Renamed note",
    ]);
    expect(doc.footnotes.map((note) => note.text)).toEqual([
      "Renamed footnote",
    ]);
    expect(doc.endnotes.map((note) => note.text)).toEqual(["Renamed endnote"]);
  });

  it("reads numbering definitions through the renamed part's own relationship", () => {
    expect(
      readDocxContent(renamedMainPartPackage()).numbering["7"]?.levels["0"],
    ).toEqual({ format: "lowerRoman", text: "%1.", startAt: 1 });
  });

  it("takes the first officeDocument relationship whose target the package holds", () => {
    const pkg = renamedMainPartPackage();
    pkg.parts["_rels/.rels"] = relsPart([
      {
        id: "rId1",
        type: `${REL_BASE}/officeDocument`,
        target: "word/deleted.xml",
      },
      {
        id: "rId2",
        type: `${REL_BASE}/officeDocument`,
        target: "word/document2.xml",
      },
    ]);
    expect(firstParagraph(pkg).runs[0]?.text).toBe("Renamed body");
  });

  it("names the resolved part, not the conventional one, when it carries no w:body", () => {
    const pkg = renamedMainPartPackage();
    pkg.parts["word/document2.xml"] = {
      kind: "xml",
      nodes: [el("w:document", {})],
    };
    expect(() => readDocxContent(pkg)).toThrow(
      /word\/document2\.xml has no w:body/,
    );
  });

  // The conventional word/header*/word/footer* scan cannot see these parts: they are reachable only through the main part's own header/footer relationships. Without that half of headerFooterPartPaths the reference side still resolves (sectionHeaderFooters names the target), but the parts themselves are never walked, so their block flow is silently missing.
  it("walks header and footer parts the conventional path scan cannot match, found only through the main part's relationships", () => {
    const pkg = renamedMainPartPackage();
    pkg.parts["word/_rels/document2.xml.rels"] = relsPart([
      { id: "rId2", type: `${REL_BASE}/styles`, target: "styles2.xml" },
      { id: "rId10", type: `${REL_BASE}/header`, target: "parts/hdr-a.xml" },
      {
        id: "rId11",
        type: `${REL_BASE}/footer`,
        target: "/word/parts/ftr-a.xml",
      },
    ]);
    delete pkg.parts["word/header2.xml"];
    delete pkg.parts["word/footer2.xml"];
    pkg.parts["word/parts/hdr-a.xml"] = headerPart("Unconventional header");
    pkg.parts["word/parts/ftr-a.xml"] = footerPart("Unconventional footer");

    const doc = readDocxContent(pkg);
    expect(doc.headerFooterParts.map((part) => part.path)).toEqual([
      "word/parts/ftr-a.xml",
      "word/parts/hdr-a.xml",
    ]);
    expect(doc.headerFooterParts.map((part) => part.kind)).toEqual([
      "footer",
      "header",
    ]);
    const headerText = doc.headerFooterParts
      .flatMap((part) => part.blocks)
      .flatMap((block) => (block.kind === "paragraph" ? block.runs : []))
      .map((run) => run.text);
    expect(headerText).toEqual([
      "Unconventional footer",
      "Unconventional header",
    ]);
  });

  it("ignores an external header relationship, which names no part to walk", () => {
    const pkg = renamedMainPartPackage();
    pkg.parts["word/_rels/document2.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", { xmlns: RELATIONSHIPS_NS }, [
          el("Relationship", {
            Id: "rId10",
            Type: `${REL_BASE}/header`,
            Target: "word/styles2.xml",
            TargetMode: "External",
          }),
        ]),
      ],
    };
    delete pkg.parts["word/header2.xml"];
    delete pkg.parts["word/footer2.xml"];
    expect(readDocxContent(pkg).headerFooterParts).toEqual([]);
  });

  it("still reads a package that declares no root relationships at all, from the conventional path", () => {
    const pkg: Package = {
      parts: {
        "word/document.xml": documentPart(),
        "word/styles.xml": stylesPart(),
        "word/header1.xml": headerPart("Conventional header"),
      },
    };
    expect(firstParagraph(pkg).runs[0]?.text).toBe("Renamed body");
    expect(firstParagraph(pkg).runs[0]?.bold).toBe(true);
    expect(
      readDocxContent(pkg).headerFooterParts.map((part) => part.path),
    ).toEqual(["word/header1.xml"]);
  });

  it("still walks a conventionally named header part nothing references", () => {
    const pkg = renamedMainPartPackage();
    pkg.parts["word/header9.xml"] = headerPart("Orphaned header");
    expect(
      readDocxContent(pkg).headerFooterParts.map((part) => part.path),
    ).toEqual(["word/footer2.xml", "word/header2.xml", "word/header9.xml"]);
  });
});

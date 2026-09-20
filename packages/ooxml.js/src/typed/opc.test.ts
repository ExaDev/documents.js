import { describe, expect, it } from "vitest";
import type { Package } from "../model/package";
import { el } from "../xml/fragment";
import { findMainPartPath, findRelatedPartPath, hasPart } from "./opc";

const RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const TRANSITIONAL_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STRICT_BASE = "http://purl.oclc.org/ooxml/officeDocument/relationships";

interface RelationshipSpec {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode?: string;
}

function relsPart(relationships: readonly RelationshipSpec[]) {
  return {
    kind: "xml" as const,
    nodes: [
      el(
        "Relationships",
        { xmlns: RELATIONSHIPS_NS },
        relationships.map((rel) =>
          el("Relationship", {
            Id: rel.id,
            Type: rel.type,
            Target: rel.target,
            ...(rel.targetMode === undefined
              ? {}
              : { TargetMode: rel.targetMode }),
          }),
        ),
      ),
    ],
  };
}

function emptyXmlPart() {
  return { kind: "xml" as const, nodes: [el("w:document", {})] };
}

describe("hasPart", () => {
  it("reports a part the package genuinely holds", () => {
    const pkg: Package = { parts: { "word/document.xml": emptyXmlPart() } };
    expect(hasPart(pkg, "word/document.xml")).toBe(true);
  });

  it("does not report an inherited Object.prototype member as a part", () => {
    expect(hasPart({ parts: {} }, "constructor")).toBe(false);
    expect(hasPart({ parts: {} }, "toString")).toBe(false);
  });
});

describe("findMainPartPath", () => {
  it("returns the part the root officeDocument relationship names, whatever it is called", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/officeDocument`,
            target: "word/document2.xml",
          },
        ]),
        "word/document2.xml": emptyXmlPart(),
      },
    };
    expect(findMainPartPath(pkg)).toBe("word/document2.xml");
  });

  it("resolves a package-rooted Target against the package root rather than nesting it", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/officeDocument`,
            target: "/word/document.xml",
          },
        ]),
        "word/document.xml": emptyXmlPart(),
      },
    };
    expect(findMainPartPath(pkg)).toBe("word/document.xml");
  });

  it("resolves a main part sitting directly at the package root", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/officeDocument`,
            target: "document2.xml",
          },
        ]),
        "document2.xml": emptyXmlPart(),
      },
    };
    expect(findMainPartPath(pkg)).toBe("document2.xml");
  });

  it("recognises the strict-namespace spelling of the officeDocument relationship", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${STRICT_BASE}/officeDocument`,
            target: "word/document.xml",
          },
        ]),
        "word/document.xml": emptyXmlPart(),
      },
    };
    expect(findMainPartPath(pkg)).toBe("word/document.xml");
  });

  it("takes the first officeDocument relationship whose target the package actually holds", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/officeDocument`,
            target: "word/missing.xml",
          },
          {
            id: "rId2",
            type: `${TRANSITIONAL_BASE}/officeDocument`,
            target: "word/document.xml",
          },
        ]),
        "word/document.xml": emptyXmlPart(),
      },
    };
    expect(findMainPartPath(pkg)).toBe("word/document.xml");
  });

  it("ignores an external officeDocument relationship, which names no part at all", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/officeDocument`,
            target: "https://example.com/word/document.xml",
            targetMode: "External",
          },
        ]),
      },
    };
    expect(findMainPartPath(pkg)).toBeUndefined();
  });

  it("does not mistake an inherited Object.prototype member for the part a Target names", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/officeDocument`,
            target: "constructor",
          },
        ]),
      },
    };
    expect(findMainPartPath(pkg)).toBeUndefined();
  });

  it("returns undefined when the package declares no root relationships at all", () => {
    expect(findMainPartPath({ parts: {} })).toBeUndefined();
  });

  it("ignores a root relationship of some other type", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/metadata/core-properties`,
            target: "docProps/core.xml",
          },
        ]),
        "docProps/core.xml": emptyXmlPart(),
      },
    };
    expect(findMainPartPath(pkg)).toBeUndefined();
  });
});

describe("findRelatedPartPath", () => {
  it("resolves a relationship Target against the source part's own directory", () => {
    const pkg: Package = {
      parts: {
        "word/_rels/document.xml.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/footnotes`,
            target: "footnotes2.xml",
          },
        ]),
        "word/footnotes2.xml": emptyXmlPart(),
      },
    };
    expect(findRelatedPartPath(pkg, "word/document.xml", "/footnotes")).toBe(
      "word/footnotes2.xml",
    );
  });

  it("resolves a package-rooted Target from the package root, not from the source part's directory", () => {
    const pkg: Package = {
      parts: {
        "word/_rels/document.xml.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/header`,
            target: "/word/header1.xml",
          },
        ]),
        "word/header1.xml": emptyXmlPart(),
      },
    };
    expect(findRelatedPartPath(pkg, "word/document.xml", "/header")).toBe(
      "word/header1.xml",
    );
  });

  it("reads the relationships of a root-level source part from _rels beside it", () => {
    const pkg: Package = {
      parts: {
        "_rels/document2.xml.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/styles`,
            target: "word/styles.xml",
          },
        ]),
        "word/styles.xml": emptyXmlPart(),
      },
    };
    expect(findRelatedPartPath(pkg, "document2.xml", "/styles")).toBe(
      "word/styles.xml",
    );
  });

  it("returns undefined when the source part declares no relationship of that type", () => {
    const pkg: Package = {
      parts: {
        "word/_rels/document.xml.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/styles`,
            target: "styles.xml",
          },
        ]),
        "word/styles.xml": emptyXmlPart(),
      },
    };
    expect(
      findRelatedPartPath(pkg, "word/document.xml", "/numbering"),
    ).toBeUndefined();
  });

  it("skips a relationship of the right type whose target part is missing", () => {
    const pkg: Package = {
      parts: {
        "word/_rels/document.xml.rels": relsPart([
          {
            id: "rId1",
            type: `${TRANSITIONAL_BASE}/comments`,
            target: "comments.xml",
          },
        ]),
      },
    };
    expect(
      findRelatedPartPath(pkg, "word/document.xml", "/comments"),
    ).toBeUndefined();
  });
});

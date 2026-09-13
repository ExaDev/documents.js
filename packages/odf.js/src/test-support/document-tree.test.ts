import type { ContentDocument, DocumentTree } from "document-schema.js";
import { assembleTree } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  assertPackageRoundTrip,
  drawingPackage,
  formulaPackage,
  presentationPackage,
  spreadsheetPackage,
  wordprocessingPackage,
} from "./document-tree";

const wordprocessingContent: ContentDocument = {
  kind: "wordprocessing",
  metadata: {},
  sections: [],
};
const presentationContent: ContentDocument = {
  kind: "presentation",
  metadata: {},
  slides: [],
};
const spreadsheetContent: ContentDocument = {
  kind: "spreadsheet",
  metadata: {},
  sheets: [],
};
const drawingContent: ContentDocument = {
  kind: "drawing",
  metadata: {},
  pages: [],
};
const formulaContent: ContentDocument = {
  kind: "formula",
  metadata: {},
  formula: { mathml: [] },
};

const wordprocessingTree = assembleTree(wordprocessingContent);
const presentationTree = assembleTree(presentationContent);
const spreadsheetTree = assembleTree(spreadsheetContent);
const drawingTree = assembleTree(drawingContent);
const formulaTree = assembleTree(formulaContent);

describe("wordprocessingPackage", () => {
  it("returns a wordprocessing package unchanged", () => {
    expect(wordprocessingPackage(wordprocessingTree)).toBe(wordprocessingTree);
  });

  it("rejects a package of a different kind", () => {
    expect(() => wordprocessingPackage(presentationTree)).toThrow(
      "expected a wordprocessing package, got presentation",
    );
  });
});

describe("presentationPackage", () => {
  it("returns a presentation package unchanged", () => {
    expect(presentationPackage(presentationTree)).toBe(presentationTree);
  });

  it("rejects a package of a different kind", () => {
    expect(() => presentationPackage(wordprocessingTree)).toThrow(
      "expected a presentation package, got wordprocessing",
    );
  });
});

describe("spreadsheetPackage", () => {
  it("returns a spreadsheet package unchanged", () => {
    expect(spreadsheetPackage(spreadsheetTree)).toBe(spreadsheetTree);
  });

  it("rejects a package of a different kind", () => {
    expect(() => spreadsheetPackage(wordprocessingTree)).toThrow(
      "expected a spreadsheet package, got wordprocessing",
    );
  });
});

describe("drawingPackage", () => {
  it("returns a drawing package unchanged", () => {
    expect(drawingPackage(drawingTree)).toBe(drawingTree);
  });

  it("rejects a package of a different kind", () => {
    expect(() => drawingPackage(wordprocessingTree)).toThrow(
      "expected a drawing package, got wordprocessing",
    );
  });
});

describe("formulaPackage", () => {
  it("returns a formula package unchanged", () => {
    expect(formulaPackage(formulaTree)).toBe(formulaTree);
  });

  it("rejects a package of a different kind", () => {
    expect(() => formulaPackage(wordprocessingTree)).toThrow(
      "expected a formula package, got wordprocessing",
    );
  });
});

describe("assertPackageRoundTrip", () => {
  it("passes when the tree, its flattened form, and its re-minted form all agree", () => {
    expect(() => {
      assertPackageRoundTrip(wordprocessingTree, wordprocessingContent);
    }).not.toThrow();
  });

  it("throws when the tree fails schema validation", () => {
    // "fonts" is schema-typed as TreeEmbeddedFont[] | undefined but read by
    // neither flattenTree (it has no ContentDocument spelling at all) nor factorStyles (which carries an existing value through verbatim rather than recomputing it, per factor-styles.ts's own comment on the three package-level fields it re-carries untouched). A malformed value here is therefore invisible to the other two checks and trips only
    // DocumentTreeSchema.parse -- isolating that one call. The cast is
    // deliberate: this is exactly a value the type system exists to rule out, constructed so the runtime check has something real to catch.
    const invalidTree = {
      ...wordprocessingTree,
      fonts: "not an array",
    } as unknown as DocumentTree;
    expect(() => {
      assertPackageRoundTrip(invalidTree, wordprocessingContent);
    }).toThrow();
  });

  it("throws when the flattened tree doesn't match the given content", () => {
    const mismatchedContent: ContentDocument = {
      ...wordprocessingContent,
      metadata: { title: "not what this tree flattens to" },
    };
    expect(() => {
      assertPackageRoundTrip(wordprocessingTree, mismatchedContent);
    }).toThrow();
  });

  it("throws when re-minting the tree doesn't reproduce it", () => {
    // Two paragraphs sharing one run-level tuple (bold, differing only in text, which factor-styles.ts's own header notes is not a mintable property) cross the plan's repeat-count-of-two threshold, so a fresh mint of this content genuinely extracts a shared style entry. Tacking an extra, unreferenced entry onto the tree's own already-minted table makes the tree schema-valid and still flatten to the same content (flattenTree resolves refs the tree's nodes actually carry; an unused table entry is invisible to it) while no longer matching what re-minting that same content produces -- isolating the third check.
    const styledContent: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            { kind: "paragraph", runs: [{ text: "one", bold: true }] },
            { kind: "paragraph", runs: [{ text: "two", bold: true }] },
          ],
        },
      ],
    };
    const styledTree = assembleTree(styledContent);
    if (styledTree.kind !== "wordprocessing") {
      throw new Error("expected assembleTree to preserve the document kind");
    }
    if (styledTree.styles?.s1 === undefined) {
      throw new Error(
        "expected the repeated bold run to mint a shared styles entry",
      );
    }
    const treeWithUnusedEntry: DocumentTree = {
      ...styledTree,
      styles: { ...styledTree.styles, "unused-copy": styledTree.styles.s1 },
    };
    expect(() => {
      assertPackageRoundTrip(treeWithUnusedEntry, styledContent);
    }).toThrow();
  });
});

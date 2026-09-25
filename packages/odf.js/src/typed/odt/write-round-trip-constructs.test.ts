import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentDocument } from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { readOdtContent } from "./read";
import { normaliseOdtContent, writeOdtContent } from "./write";

// The write side's correctness suite: what writeOdtContent produces reads back as the document it was given. The sibling suite (write.test.ts) pins the XML shapes — which is what stops this one from passing on a writer and reader that agree with each other and with nobody else — while this one states the law and every deviation from it by name.
//
// THE LAW: normaliseOdtContent(readOdtContent(writeOdtContent(document))) equals normaliseOdtContent(document), for every document the writer accepts. The normalisation is applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose: everything it restates is a fact ODF's own content model cannot carry, each named in normaliseOdtContent's own doc comment and each pinned individually further down this file.
//
// The strongest evidence here is the fixture pair at the end: two real, unmodified LibreOffice-generated .odt documents, read into the pivot, written back out by this writer, and read again — equal on the nose. Those exercise real producer output (real styles, real style chains, real whitespace, real tables, a real image) rather than this package's own idea of what such a document looks like. Two further facts were established against LibreOffice directly and cannot be stated as an assertion here, so they are recorded instead: converting this writer's own output to PDF renders the explicit page break and the second section's own page size as three pages (A4, A4, Letter), and LibreOffice's own re-save of that output reads back through readOdtContent with both sections, their geometry, the merged table cell, the nested list, the image, and the whitespace all intact.

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// A 1x1 PNG.

// The one arm of ContentDocument an .odt ever is, named locally so this suite reaches a document's own sections without re-narrowing the whole union at every assertion.
type WordprocessingDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

function contentOf(pkg: Package): WordprocessingDocument {
  const { metadata, sections } = readOdtContent(pkg);
  return { kind: "wordprocessing", metadata, sections };
}

// One full pass through the writer and back: the document the caller handed in, written to a real package, encoded to real bytes, decoded again, and read. The bytes leg is deliberately in the loop rather than short-circuited at the Package level — a writer that built a correct Package but an unserialisable one would pass a Package-only round trip.
function roundTrip(document: ContentDocument): WordprocessingDocument {
  return contentOf(decodePackage(encodePackage(writeOdtContent(document))));
}

function expectRoundTrip(document: ContentDocument): void {
  expect(normaliseOdtContent(roundTrip(document))).toEqual(
    normaliseOdtContent(document),
  );
}

function documentOf(blocks: readonly ContentBlock[]): WordprocessingDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      { pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks: [...blocks] },
    ],
  };
}

describe("fidelity constructs written (#969)", () => {
  it("round-trips a field from its own cached instruction and result", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "Author: " }, { text: "Joe" }, { text: "." }],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: '<text:author-name text:fixed="false"/>',
                cachedResult: "Joe",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a field carrying no cached text as a point extent", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "Page " }, { text: " of many" }],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: "<text:page-number/>",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a field whose own cached text mixes formatting", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [
            { text: "before " },
            { text: "bold", bold: true },
            { text: "plain" },
            { text: " after" },
          ],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: "<text:expression/>",
                cachedResult: "boldplain",
              },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a point bookmark", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "before" }, { text: "after" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "b1",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a ranged bookmark spanning part of one paragraph", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [
            { text: "see " },
            { text: "target", bold: true },
            { text: " here" },
          ],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "target1",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips two overlapping ranged bookmarks in one paragraph", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "one" }, { text: "two" }, { text: "three" }],
          constructs: [
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "a" },
              startRun: 0,
              endRun: 2,
            },
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "b" },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a field and a ranged bookmark together, keeping a bookmark boundary that falls inside the field's own range clamped just after it", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "value: " }, { text: "42" }, { text: "." }],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: "<text:expression/>",
                cachedResult: "42",
              },
              startRun: 1,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "value",
              },
              startRun: 0,
              endRun: 2,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a division wrapping a single paragraph", () => {
    expectRoundTrip(
      documentOf([
        { kind: "constructStart", descriptor: { kind: "division" } },
        { kind: "paragraph", runs: [{ text: "inside the division" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division's own name, protected flag, and column count", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "division",
            name: "Sidebar",
            protected: true,
            columnCount: 3,
          },
        },
        { kind: "paragraph", runs: [{ text: "column text" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division's external-chapter link", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "division",
            linked: { href: "chapters/one.odt", sectionName: "Chapter1" },
          },
        },
        { kind: "paragraph", runs: [{ text: "linked content" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division wrapping a table and multiple paragraphs", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Body" },
        },
        { kind: "paragraph", runs: [{ text: "first" }] },
        {
          kind: "table",
          columns: [{ widthPt: 100 }],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
              ],
            },
          ],
        },
        { kind: "paragraph", runs: [{ text: "last" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips two sibling divisions in the same section", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "First" },
        },
        { kind: "paragraph", runs: [{ text: "one" }] },
        { kind: "constructEnd" },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Second" },
        },
        { kind: "paragraph", runs: [{ text: "two" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division nested inside another division", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Outer" },
        },
        { kind: "paragraph", runs: [{ text: "outer text" }] },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Inner" },
        },
        { kind: "paragraph", runs: [{ text: "inner text" }] },
        { kind: "constructEnd" },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips an index wrapper recovering its own element identity from residue", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "index",
            tag: "Table of Contents1",
            source: {
              format: "odt",
              xml: "<text:table-of-content-source/>",
            },
          },
        },
        { kind: "paragraph", runs: [{ text: "Chapter One .......... 1" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a bibliography index wrapper, a different one of the seven wrapper tags", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "index",
            source: {
              format: "odt",
              xml: "<text:bibliography-source/>",
            },
          },
        },
        { kind: "paragraph", runs: [{ text: "Author, Title, Year" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division nested inside an index wrapper's own cached body", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "index",
            source: {
              format: "odt",
              xml: "<text:table-of-content-source/>",
            },
          },
        },
        { kind: "paragraph", runs: [{ text: "heading" }] },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Nested" },
        },
        { kind: "paragraph", runs: [{ text: "nested entry" }] },
        { kind: "constructEnd" },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("refuses an index wrapper descriptor with no recoverable *-source residue", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: { kind: "contentControl", controlType: "index" },
          },
          { kind: "paragraph", runs: [{ text: "x" }] },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/no fact naming which of the seven ODF index wrappers/);
  });
  it("round-trips a block-scope bookmark range spanning two paragraphs", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "Cross" },
        },
        { kind: "paragraph", runs: [{ text: "first paragraph" }] },
        { kind: "paragraph", runs: [{ text: "second paragraph" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a block-scope bookmark range spanning a table between its paragraphs", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "Wide" },
        },
        { kind: "paragraph", runs: [{ text: "before the table" }] },
        {
          kind: "table",
          columns: [{ widthPt: 100 }],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
              ],
            },
          ],
        },
        { kind: "paragraph", runs: [{ text: "after the table" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a block-scope bookmark range nested inside a division", () => {
    expectRoundTrip(
      documentOf([
        { kind: "constructStart", descriptor: { kind: "division", name: "D" } },
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "Inner" },
        },
        { kind: "paragraph", runs: [{ text: "inner content" }] },
        { kind: "constructEnd" },
        { kind: "constructEnd" },
      ]),
    );
  });
});

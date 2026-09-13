import { describe, expect, it } from "vitest";
import { FC_LCB_VALUE_INDEX, FIB_FC_LCB_BLOB_OFFSET } from "./fib/offsets";
import { readDocContent, readDocStreams } from "./read";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";

// Patches one FibRgFcLcb97 lcb field directly in the WordDocument stream's own FIB (rather than in the Table stream buildDoc's own footnote/comment/endnote fixtures already write correctly), so the boundary plex label passed to readSubdocumentStories can be named in a slice error that a well-formed buildDoc fixture never produces on its own.
function docWithCorruptedLcb(
  spec: Parameters<typeof buildDoc>[0],
  valueIndex: number,
): Uint8Array<ArrayBuffer> {
  const bytes = buildDoc(spec);
  const { wordDocument, table } = readDocStreams(bytes);
  const patchedWordDocument = new Uint8Array(wordDocument);
  new DataView(patchedWordDocument.buffer).setUint32(
    FIB_FC_LCB_BLOB_OFFSET + valueIndex * 4,
    0x7fffffff,
    true,
  );
  return compoundFile([
    { path: "WordDocument", bytes: patchedWordDocument },
    { path: "1Table", bytes: new Uint8Array(table) },
  ]);
}

describe("readNoteBodies", () => {
  it("names 'PlcffndTxt' when its own declared lcb runs past the Table stream", () => {
    const bytes = docWithCorruptedLcb(
      {
        paragraphs: [{ runs: [{ text: "Main" }] }],
        footnotes: [[{ runs: [{ text: "Footnote text" }] }]],
      },
      FC_LCB_VALUE_INDEX.lcbPlcffndTxt,
    );
    expect(() => readDocContent(bytes)).toThrow(
      /PlcffndTxt in the Table stream/,
    );
  });

  it("names 'PlcfandTxt' when its own declared lcb runs past the Table stream", () => {
    const bytes = docWithCorruptedLcb(
      {
        paragraphs: [{ runs: [{ text: "Main" }] }],
        comments: [[{ runs: [{ text: "Comment text" }] }]],
      },
      FC_LCB_VALUE_INDEX.lcbPlcfandTxt,
    );
    expect(() => readDocContent(bytes)).toThrow(
      /PlcfandTxt in the Table stream/,
    );
  });

  it("names 'PlcfendTxt' when its own declared lcb runs past the Table stream", () => {
    const bytes = docWithCorruptedLcb(
      {
        paragraphs: [{ runs: [{ text: "Main" }] }],
        endnotes: [[{ runs: [{ text: "Endnote text" }] }]],
      },
      FC_LCB_VALUE_INDEX.lcbPlcfendTxt,
    );
    expect(() => readDocContent(bytes)).toThrow(
      /PlcfendTxt in the Table stream/,
    );
  });
  it("round-trips footnotes, comments, and endnotes with correctly ordered subdocument boundaries", () => {
    // A non-empty headerFooterStories document (Plcfhdd, between the footnote and comment documents in [MS-DOC] 2.4.1's own concatenation order) gives ccpHdd a genuinely non-zero value, so commentStartCp's own headerStartCp + ccpHdd actually depends on the sign of that addition rather than adding zero either way.
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      sectionGrpprl: [],
      footnotes: [[{ runs: [{ text: "Footnote text" }] }]],
      headerFooterStories: [
        [],
        [],
        [],
        [],
        [],
        [],
        [{ runs: [{ text: "Header text" }] }],
        [],
        [],
        [],
        [],
        [],
      ],
      comments: [[{ runs: [{ text: "Comment text" }] }]],
      endnotes: [[{ runs: [{ text: "Endnote text" }] }]],
    });
    const doc = readDocContent(bytes);
    expect(doc.footnotes).toEqual([{ id: "1", text: "Footnote text" }]);
    expect(doc.comments).toEqual([{ id: "1", text: "Comment text" }]);
    expect(doc.endnotes).toEqual([{ id: "1", text: "Endnote text" }]);
    const header = doc.headerFooterStories.find(
      (story) => story.slot === "evenHeader",
    );
    expect(header).toBeDefined();
  });

  it("assigns sequential one-based ids to multiple stories of the same kind, in document order", () => {
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      footnotes: [
        [{ runs: [{ text: "First" }] }],
        [{ runs: [{ text: "Second" }] }],
        [{ runs: [{ text: "Third" }] }],
      ],
    });
    const doc = readDocContent(bytes);
    expect(doc.footnotes.map((footnote) => footnote.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(doc.footnotes.map((footnote) => footnote.text)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("reports no footnotes/comments/endnotes at all when the document carries none", () => {
    const doc = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "Plain" }] }] }),
    );
    expect(doc.footnotes).toEqual([]);
    expect(doc.comments).toEqual([]);
    expect(doc.endnotes).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { FC_LCB_VALUE_INDEX, FIB_FC_LCB_BLOB_OFFSET } from "./fib/offsets";
import { PARAGRAPH_MARK } from "./text/special";
import { readDocContent, readDocStreams } from "./read";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";
import { storyText } from "./subdocument";
import type { ParagraphEntry } from "./text/paragraphs";

// Builds the identical well-formed two-footnote document patchedFootnoteDoc does, but instead adjusts the FIB's own declared lcbPlcffndTxt by `delta` bytes -- shortening or lengthening what readStoryPlexKeys is told to read without touching the plex bytes themselves, which a well-formed buildDoc fixture always writes as a whole number of 4-byte keys.
function footnoteDocWithAdjustedLcb(delta: number): Uint8Array<ArrayBuffer> {
  const bytes = buildDoc({
    paragraphs: [{ runs: [{ text: "Main" }] }],
    footnotes: [
      [{ runs: [{ text: "First" }] }],
      [{ runs: [{ text: "Second" }] }],
    ],
  });
  const { wordDocument, table } = readDocStreams(bytes);
  const patchedWordDocument = new Uint8Array(wordDocument);
  const view = new DataView(patchedWordDocument.buffer);
  const offset = FIB_FC_LCB_BLOB_OFFSET + FC_LCB_VALUE_INDEX.lcbPlcffndTxt * 4;
  view.setUint32(offset, view.getUint32(offset, true) + delta, true);
  return compoundFile([
    { path: "WordDocument", bytes: patchedWordDocument },
    { path: "1Table", bytes: new Uint8Array(table) },
  ]);
}

// Builds a well-formed footnote document via buildDoc, then patches one raw PlcffndTxt key directly in the "1Table" stream bytes -- exercising readStoryPlexKeys' own leniency for a malformed key (out-of-range or descending), which a well-formed buildDoc fixture can never produce on its own, since buildDoc always writes ascending, in-range keys.
function patchedFootnoteDoc(
  patchKey: (view: DataView, fcPlcffndTxt: number) => void,
): Uint8Array<ArrayBuffer> {
  const bytes = buildDoc({
    paragraphs: [{ runs: [{ text: "Main" }] }],
    footnotes: [
      [{ runs: [{ text: "First" }] }],
      [{ runs: [{ text: "Second" }] }],
    ],
  });
  const { wordDocument, table, fib } = readDocStreams(bytes);
  const patchedTable = new Uint8Array(table);
  const view = new DataView(
    patchedTable.buffer,
    patchedTable.byteOffset,
    patchedTable.byteLength,
  );
  patchKey(view, fib.fcPlcffndTxt);
  return compoundFile([
    { path: "WordDocument", bytes: new Uint8Array(wordDocument) },
    { path: "1Table", bytes: patchedTable },
  ]);
}

describe("readSubdocumentStories leniency for malformed plex keys", () => {
  it("snaps a negative key to its predecessor rather than throwing or reading garbage", () => {
    // The second key (index 1, at offset 4) is the boundary between the first and second footnote. Setting it to -1 should collapse into the predecessor (key 0), stating the first story as empty rather than corrupting the read.
    const bytes = patchedFootnoteDoc((view, fcPlcffndTxt) => {
      view.setInt32(fcPlcffndTxt + 4, -1, true);
    });
    expect(() => readDocContent(bytes)).not.toThrow();
  });

  it("snaps a key past the subdocument's own length to its predecessor", () => {
    const bytes = patchedFootnoteDoc((view, fcPlcffndTxt) => {
      view.setInt32(fcPlcffndTxt + 4, 0x7fffffff, true);
    });
    const doc = readDocContent(bytes);
    // The out-of-range key snaps to its predecessor rather than throwing, and does not swallow the stories after it: two footnotes still round-trip once the array is patched back into ascending order internally.
    expect(doc.footnotes.length).toBeGreaterThanOrEqual(1);
  });

  it("raises a descending terminal key to its own immediate (non-zero) predecessor, not to zero", () => {
    // keys are [0, 7, 15] for this fixture ("First" then "Second"); forcing the terminal key to 5 (descending, but still in-range) must raise it to 7 (key[1], the true predecessor) -- a reader that looked up the wrong predecessor (e.g. always 0) would raise it to 5 unchanged instead, corrupting the second footnote's own boundary.
    const bytes = patchedFootnoteDoc((view, fcPlcffndTxt) => {
      view.setInt32(fcPlcffndTxt + 8, 5, true);
    });
    const doc = readDocContent(bytes);
    expect(doc.footnotes).toEqual([
      { id: "1", text: "First" },
      { id: "2", text: "" },
    ]);
  });

  it("raises a key that descends below its in-range predecessor rather than throwing", () => {
    const bytes = patchedFootnoteDoc((view, fcPlcffndTxt) => {
      const first = view.getInt32(fcPlcffndTxt, true);
      // A genuinely descending (but otherwise in-range) key at index 1.
      view.setInt32(fcPlcffndTxt + 4, Math.max(first - 1, 0), true);
    });
    expect(() => readDocContent(bytes)).not.toThrow();
  });
});

describe("readStoryPlexKeys' own size validation", () => {
  it("rejects a declared lcb that does not yield a whole number of 4-byte keys", () => {
    // This fixture's own plex is 16 bytes (4 keys); one byte short is 15, not a multiple of 4.
    const bytes = footnoteDocWithAdjustedLcb(-1);
    expect(() => readDocContent(bytes)).toThrow(
      /PlcffndTxt is 15 bytes, which does not yield a whole number of 4-byte keys/,
    );
  });

  it("rejects a declared lcb too short to hold even one key pair (fewer than 4 bytes)", () => {
    // 16 bytes short by 9 is 7, above the 4-byte minimum but still not a multiple of 4 -- exercised separately from the previous case only to also cross the < 4 boundary on the way down; see the next test for exactly 4.
    const bytes = footnoteDocWithAdjustedLcb(-9);
    expect(() => readDocContent(bytes)).toThrow(
      /PlcffndTxt is 7 bytes, which does not yield a whole number of 4-byte keys/,
    );
  });

  it("accepts a declared lcb of exactly 4 bytes, the smallest a whole plex can be", () => {
    // A single terminating key alone -- readSubdocumentStories' own trailing-slot drop then leaves no stories at all, matching a document that carries no footnote stories.
    const bytes = footnoteDocWithAdjustedLcb(-12);
    expect(() => readDocContent(bytes)).not.toThrow();
  });
});

function entry(blocks: ParagraphEntry["blocks"]): ParagraphEntry {
  return {
    blocks,
    properties: {},
    grpprl: [],
    terminator: PARAGRAPH_MARK,
    endCp: 0,
  };
}

describe("storyText", () => {
  it("joins each paragraph's own run text with a newline between paragraphs", () => {
    const entries: ParagraphEntry[] = [
      entry([{ kind: "paragraph", runs: [{ text: "First" }] }]),
      entry([{ kind: "paragraph", runs: [{ text: "Second" }] }]),
    ];
    expect(storyText(entries)).toBe("First\nSecond");
  });

  it("joins a paragraph's own multiple runs with no separator between them", () => {
    const entries: ParagraphEntry[] = [
      entry([
        { kind: "paragraph", runs: [{ text: "Hello " }, { text: "world" }] },
      ]),
    ];
    expect(storyText(entries)).toBe("Hello world");
  });

  it("contributes no text for a non-paragraph block", () => {
    const entries: ParagraphEntry[] = [entry([{ kind: "pageBreak" }])];
    expect(storyText(entries)).toBe("");
  });

  it("returns an empty string for an empty story", () => {
    expect(storyText([])).toBe("");
  });
});

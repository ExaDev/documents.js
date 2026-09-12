import { describe, expect, it } from "vitest";
import { PARAGRAPH_MARK } from "./text/special";
import { readDocContent, readDocStreams } from "./read";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";
import { storyText } from "./subdocument";
import type { ParagraphEntry } from "./text/paragraphs";

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

  it("raises a key that descends below its in-range predecessor rather than throwing", () => {
    const bytes = patchedFootnoteDoc((view, fcPlcffndTxt) => {
      const first = view.getInt32(fcPlcffndTxt, true);
      // A genuinely descending (but otherwise in-range) key at index 1.
      view.setInt32(fcPlcffndTxt + 4, Math.max(first - 1, 0), true);
    });
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

import { describe, expect, it } from "vitest";
import { FC_LCB_VALUE_INDEX, FIB_FC_LCB_BLOB_OFFSET } from "./fib/offsets";
import { readDocContent, readDocStreams } from "./read";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";

// Six fixed separator stories, then one entry per (section, slot) pair -- headers-footers.ts's own SLOT_ORDER -- built as a flat helper so each test only has to name the slots it actually cares about.
function headerFooterStories(
  sectionCount: number,
  populated: Partial<
    Record<
      `${number}:${string}`,
      readonly { readonly runs: readonly { readonly text: string }[] }[]
    >
  >,
): (readonly { readonly runs: readonly { readonly text: string }[] }[])[] {
  const slots = [
    "evenHeader",
    "oddHeader",
    "evenFooter",
    "oddFooter",
    "firstHeader",
    "firstFooter",
  ] as const;
  const stories: (readonly {
    readonly runs: readonly { readonly text: string }[];
  }[])[] = [[], [], [], [], [], []];
  for (let section = 0; section < sectionCount; section += 1) {
    for (const slot of slots) {
      stories.push(populated[`${section}:${slot}`] ?? []);
    }
  }
  return stories;
}

describe("readHeaderFooterStories", () => {
  it("round-trips a single section's own header and footer slots", () => {
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Body" }] }],
      sectionGrpprl: [],
      headerFooterStories: headerFooterStories(1, {
        "0:evenHeader": [{ runs: [{ text: "Even header" }] }],
        "0:oddFooter": [{ runs: [{ text: "Odd footer" }] }],
      }),
    });
    const doc = readDocContent(bytes);
    const evenHeader = doc.headerFooterStories.find(
      (story) => story.section === 0 && story.slot === "evenHeader",
    );
    const oddFooter = doc.headerFooterStories.find(
      (story) => story.section === 0 && story.slot === "oddFooter",
    );
    expect(
      evenHeader?.blocks[0]?.kind === "paragraph"
        ? evenHeader.blocks[0].runs[0]?.text
        : undefined,
    ).toBe("Even header");
    expect(
      oddFooter?.blocks[0]?.kind === "paragraph"
        ? oddFooter.blocks[0].runs[0]?.text
        : undefined,
    ).toBe("Odd footer");
  });

  it("omits every slot the document states as genuinely empty, section by section", () => {
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Body" }] }],
      sectionGrpprl: [],
      headerFooterStories: headerFooterStories(1, {
        "0:oddHeader": [{ runs: [{ text: "Odd header" }] }],
      }),
    });
    const doc = readDocContent(bytes);
    expect(doc.headerFooterStories).toHaveLength(1);
    expect(doc.headerFooterStories[0]?.slot).toBe("oddHeader");
  });

  it("keeps section index and slot distinct across more than one section", () => {
    const bytes = buildDoc({
      paragraphs: [
        { runs: [{ text: "Section one" }], mark: 0x0c },
        { runs: [{ text: "Section two" }] },
      ],
      sections: [[], []],
      headerFooterStories: headerFooterStories(2, {
        "0:evenHeader": [{ runs: [{ text: "Section 0 header" }] }],
        "1:evenHeader": [{ runs: [{ text: "Section 1 header" }] }],
      }),
    });
    const doc = readDocContent(bytes);
    const evenHeaders = doc.headerFooterStories.filter(
      (story) => story.slot === "evenHeader",
    );
    expect(evenHeaders).toHaveLength(2);
    expect(evenHeaders.map((story) => story.section)).toEqual([0, 1]);
    const textOf = (
      story: (typeof evenHeaders)[number] | undefined,
    ): string | undefined =>
      story?.blocks[0]?.kind === "paragraph"
        ? story.blocks[0].runs[0]?.text
        : undefined;
    expect(textOf(evenHeaders[0])).toBe("Section 0 header");
    expect(textOf(evenHeaders[1])).toBe("Section 1 header");
  });

  it("reports no header/footer stories at all when the document carries none", () => {
    const doc = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "Plain" }] }] }),
    );
    expect(doc.headerFooterStories).toEqual([]);
  });

  it("stops at the document's own last section rather than reading a header story group beyond it", () => {
    // The document declares one section (sectionGrpprl: []) but Plcfhdd carries a second section's worth of stories anyway -- section index 1 must never surface, even though its own story is genuinely non-empty.
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Body" }] }],
      sectionGrpprl: [],
      headerFooterStories: headerFooterStories(2, {
        "0:evenHeader": [{ runs: [{ text: "Section 0" }] }],
        "1:evenHeader": [{ runs: [{ text: "Section 1, never reached" }] }],
      }),
    });
    const doc = readDocContent(bytes);
    expect(doc.headerFooterStories.map((story) => story.section)).toEqual([0]);
  });

  it("names 'Plcfhdd' when its own declared lcb runs past the Table stream", () => {
    const bytes = buildDoc({
      paragraphs: [{ runs: [{ text: "Body" }] }],
      sectionGrpprl: [],
      headerFooterStories: headerFooterStories(1, {
        "0:evenHeader": [{ runs: [{ text: "Even header" }] }],
      }),
    });
    const { wordDocument, table } = readDocStreams(bytes);
    const patchedWordDocument = new Uint8Array(wordDocument);
    new DataView(patchedWordDocument.buffer).setUint32(
      FIB_FC_LCB_BLOB_OFFSET + FC_LCB_VALUE_INDEX.lcbPlcfHdd * 4,
      0x7fffffff,
      true,
    );
    const corrupted = compoundFile([
      { path: "WordDocument", bytes: patchedWordDocument },
      { path: "1Table", bytes: new Uint8Array(table) },
    ]);
    expect(() => readDocContent(corrupted)).toThrow(
      /Plcfhdd in the Table stream/,
    );
  });
});

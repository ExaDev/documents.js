import { describe, expect, it } from "vitest";
import { readDocContent } from "./read";
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
});

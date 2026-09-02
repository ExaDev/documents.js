import type { ContentSection } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readNav3TocHrefs } from "./nav3";
import { writeNav3Document } from "./write";

function section(blocks: ContentSection["blocks"]): ContentSection {
  return {
    pageSize: { widthPt: 595.28, heightPt: 841.89 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks,
  };
}

describe("writeNav3Document", () => {
  it("writes one toc entry per section, titled from its first heading", () => {
    const xml = writeNav3Document([
      {
        href: "section1.xhtml",
        section: section([
          {
            kind: "paragraph",
            headingLevel: 1,
            runs: [{ text: "Chapter One" }],
          },
        ]),
      },
      {
        href: "section2.xhtml",
        section: section([
          { kind: "paragraph", runs: [{ text: "no heading" }] },
        ]),
      },
    ]);
    expect(xml).toContain(">Chapter One<");
    expect(xml).toContain(">Section 2<");
    expect(readNav3TocHrefs(xml)).toEqual(["section1.xhtml", "section2.xhtml"]);
  });

  it('produces a well-formed EPUB 3 nav document with epub:type="toc"', () => {
    const xml = writeNav3Document([{ href: "s1.xhtml", section: section([]) }]);
    expect(xml).toContain('epub:type="toc"');
    expect(xml).toContain('xmlns:epub="http://www.idpf.org/2007/ops"');
  });
});

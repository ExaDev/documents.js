import { describe, expect, it } from "vitest";
import { readNcxHrefs } from "./ncx";

const NCX_XML = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="chapter1.xhtml"/>
      <navPoint id="np2" playOrder="2">
        <navLabel><text>Section 1.1</text></navLabel>
        <content src="chapter1.xhtml#s1"/>
      </navPoint>
    </navPoint>
    <navPoint id="np3" playOrder="3">
      <navLabel><text>Chapter 2</text></navLabel>
      <content src="chapter2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

describe("readNcxHrefs", () => {
  it("reads every navPoint's own content src, fragment-stripped, in document order", () => {
    expect(readNcxHrefs(NCX_XML)).toEqual([
      "chapter1.xhtml",
      "chapter1.xhtml",
      "chapter2.xhtml",
    ]);
  });

  it("returns undefined when there is no navMap", () => {
    expect(readNcxHrefs("<ncx/>")).toBeUndefined();
  });
});

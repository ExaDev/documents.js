import { describe, expect, it } from "vitest";
import { readNav3TocHrefs } from "./nav3";

const NAV_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter1.xhtml">Chapter 1</a></li>
        <li><a href="chapter2.xhtml#section1">Chapter 2</a></li>
      </ol>
    </nav>
    <nav epub:type="landmarks">
      <ol><li><a href="chapter1.xhtml" epub:type="bodymatter">Start</a></li></ol>
    </nav>
  </body>
</html>`;

describe("readNav3TocHrefs", () => {
  it("reads only the toc nav's own hrefs, fragment-stripped, in order", () => {
    expect(readNav3TocHrefs(NAV_XHTML)).toEqual([
      "chapter1.xhtml",
      "chapter2.xhtml",
    ]);
  });

  it("returns undefined when there is no toc nav", () => {
    expect(
      readNav3TocHrefs(
        '<html xmlns:epub="urn"><body><nav epub:type="landmarks"><ol/></nav></body></html>',
      ),
    ).toBeUndefined();
  });
});

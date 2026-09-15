import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import { resolveDrawPageSize } from "./masterpage";

function stylesXmlPart(
  pageLayoutName: string,
  widthPt: string,
  heightPt: string,
  masterPageName = "Default",
): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-styles", {}, [
        el("office:automatic-styles", {}, [
          el("style:page-layout", { "style:name": pageLayoutName }, [
            el("style:page-layout-properties", {
              "fo:page-width": widthPt,
              "fo:page-height": heightPt,
            }),
          ]),
        ]),
        el("office:master-styles", {}, [
          el("style:master-page", {
            "style:name": masterPageName,
            "style:page-layout-name": pageLayoutName,
          }),
        ]),
      ]),
    ],
  };
}

describe("resolveDrawPageSize", () => {
  it("resolves draw:page -> draw:master-page-name -> style:master-page -> style:page-layout-name -> style:page-layout-properties (real LibreOffice output shape)", () => {
    const pkg: Package = {
      parts: { "styles.xml": stylesXmlPart("PM1", "720pt", "540pt") },
    };
    const page = el("draw:page", { "draw:master-page-name": "Default" });
    expect(resolveDrawPageSize(page, pkg)).toEqual({
      widthPt: 720,
      heightPt: 540,
    });
  });

  it("also finds the style:page-layout when it lives in content.xml's own office:automatic-styles, not just styles.xml", () => {
    const contentXml: Package["parts"][string] = {
      kind: "xml",
      nodes: [
        el("office:document-content", {}, [
          el("office:automatic-styles", {}, [
            el("style:page-layout", { "style:name": "PM1" }, [
              el("style:page-layout-properties", {
                "fo:page-width": "100pt",
                "fo:page-height": "200pt",
              }),
            ]),
          ]),
        ]),
      ],
    };
    const stylesXml: Package["parts"][string] = {
      kind: "xml",
      nodes: [
        el("office:document-styles", {}, [
          el("office:master-styles", {}, [
            el("style:master-page", {
              "style:name": "Default",
              "style:page-layout-name": "PM1",
            }),
          ]),
        ]),
      ],
    };
    const pkg: Package = {
      parts: { "content.xml": contentXml, "styles.xml": stylesXml },
    };
    const page = el("draw:page", { "draw:master-page-name": "Default" });
    expect(resolveDrawPageSize(page, pkg)).toEqual({
      widthPt: 100,
      heightPt: 200,
    });
  });

  it("returns undefined when the page carries no draw:master-page-name at all", () => {
    const pkg: Package = {
      parts: { "styles.xml": stylesXmlPart("PM1", "720pt", "540pt") },
    };
    expect(resolveDrawPageSize(el("draw:page"), pkg)).toBeUndefined();
  });

  it("returns undefined when the referenced master page does not exist", () => {
    const pkg: Package = {
      parts: { "styles.xml": stylesXmlPart("PM1", "720pt", "540pt") },
    };
    const page = el("draw:page", { "draw:master-page-name": "NoSuchMaster" });
    expect(resolveDrawPageSize(page, pkg)).toBeUndefined();
  });

  it("does not resolve a nameless style:master-page when the page itself has no draw:master-page-name", () => {
    // A style:master-page with no style:name at all would make attrValue(element, "style:name") itself resolve to undefined -- coincidentally equal to an undefined masterPageName -- if findMasterPageElement didn't short-circuit before ever reaching the search.
    const pkg: Package = {
      parts: {
        "styles.xml": {
          kind: "xml",
          nodes: [
            el("office:document-styles", {}, [
              el("office:automatic-styles", {}, [
                el("style:page-layout", { "style:name": "PM1" }, [
                  el("style:page-layout-properties", {
                    "fo:page-width": "720pt",
                    "fo:page-height": "540pt",
                  }),
                ]),
              ]),
              el("office:master-styles", {}, [
                el("style:master-page", { "style:page-layout-name": "PM1" }),
              ]),
            ]),
          ],
        },
      },
    };
    expect(resolveDrawPageSize(el("draw:page"), pkg)).toBeUndefined();
  });

  it("does not resolve a nameless style:page-layout when the master page itself has no style:page-layout-name", () => {
    // Mirrors the case above one link further down the chain: a style:page-layout with no style:name at all would coincidentally match an undefined pageLayoutName if findPageLayoutElement didn't short-circuit first.
    const pkg: Package = {
      parts: {
        "styles.xml": {
          kind: "xml",
          nodes: [
            el("office:document-styles", {}, [
              el("office:automatic-styles", {}, [
                el("style:page-layout", {}, [
                  el("style:page-layout-properties", {
                    "fo:page-width": "720pt",
                    "fo:page-height": "540pt",
                  }),
                ]),
              ]),
              el("office:master-styles", {}, [
                el("style:master-page", { "style:name": "Default" }),
              ]),
            ]),
          ],
        },
      },
    };
    const page = el("draw:page", { "draw:master-page-name": "Default" });
    expect(resolveDrawPageSize(page, pkg)).toBeUndefined();
  });

  it("returns undefined when there is no styles.xml part at all", () => {
    const page = el("draw:page", { "draw:master-page-name": "Default" });
    expect(resolveDrawPageSize(page, { parts: {} })).toBeUndefined();
  });

  it("returns undefined when the referenced page-layout has no style:page-layout-properties", () => {
    const stylesXml: Package["parts"][string] = {
      kind: "xml",
      nodes: [
        el("office:document-styles", {}, [
          el("office:automatic-styles", {}, [
            el("style:page-layout", { "style:name": "PM1" }),
          ]),
          el("office:master-styles", {}, [
            el("style:master-page", {
              "style:name": "Default",
              "style:page-layout-name": "PM1",
            }),
          ]),
        ]),
      ],
    };
    const pkg: Package = { parts: { "styles.xml": stylesXml } };
    const page = el("draw:page", { "draw:master-page-name": "Default" });
    expect(resolveDrawPageSize(page, pkg)).toBeUndefined();
  });
});

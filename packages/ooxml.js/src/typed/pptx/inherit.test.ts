import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import {
  findMatchingPlaceholder,
  readPlaceholderKey,
  resolveDefaultRunProperties,
  resolvePlaceholderXfrm,
  resolveSlideInheritance,
} from "./inherit";

// Ported verbatim from documents.js's src/ooxml/pptx/inherit.test.ts.

const SLIDE_LAYOUT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const SLIDE_MASTER_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
const THEME_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";

function rels(
  entries: { id: string; type: string; target: string }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el("Relationship", { Id: e.id, Type: e.type, Target: e.target }),
    ),
  );
}

interface XfrmSpec {
  readonly x: string;
  readonly y: string;
  readonly cx: string;
  readonly cy: string;
}

function placeholderShape(
  ph: { type?: string; idx?: string },
  xfrm?: XfrmSpec,
): XmlElement {
  const phAttrs: Record<string, string> = {};
  if (ph.type !== undefined) {
    phAttrs.type = ph.type;
  }
  if (ph.idx !== undefined) {
    phAttrs.idx = ph.idx;
  }
  const spPrChildren =
    xfrm === undefined
      ? []
      : [
          el("a:xfrm", {}, [
            el("a:off", { x: xfrm.x, y: xfrm.y }),
            el("a:ext", { cx: xfrm.cx, cy: xfrm.cy }),
          ]),
        ];
  return el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Placeholder" }),
      el("p:cNvSpPr"),
      el("p:nvPr", {}, [el("p:ph", phAttrs)]),
    ]),
    el("p:spPr", {}, spPrChildren),
  ]);
}

function buildFixturePackage(
  options: { slideType?: string; layoutHasXfrm?: boolean } = {},
): Package {
  const slideType = options.slideType ?? "title";
  const layoutHasXfrm = options.layoutHasXfrm ?? true;

  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [
      el("p:spTree", {}, [placeholderShape({ type: slideType })]),
    ]),
  ]);
  const layoutXfrm: XfrmSpec | undefined = layoutHasXfrm
    ? { x: "914400", y: "457200", cx: "1828800", cy: "914400" }
    : undefined;
  const layout = el("p:sldLayout", {}, [
    el("p:cSld", {}, [
      el("p:spTree", {}, [placeholderShape({ type: "title" }, layoutXfrm)]),
    ]),
  ]);
  const master = el("p:sldMaster", {}, [
    el("p:cSld", {}, [
      el("p:spTree", {}, [
        placeholderShape(
          { type: "title" },
          { x: "0", y: "0", cx: "9144000", cy: "1143000" },
        ),
      ]),
    ]),
    el("p:clrMap", {
      bg1: "lt1",
      tx1: "dk1",
      bg2: "lt2",
      tx2: "dk2",
      accent1: "accent1",
      accent2: "accent2",
      accent3: "accent3",
      accent4: "accent4",
      accent5: "accent5",
      accent6: "accent6",
      hlink: "hlink",
      folHlink: "folHlink",
    }),
    el("p:txStyles", {}, [
      el("p:titleStyle", {}, [
        el("a:lvl1pPr", {}, [
          el("a:defRPr", { sz: "4400", b: "1" }, [
            el("a:latin", { typeface: "+mj-lt" }),
            el("a:solidFill", {}, [el("a:schemeClr", { val: "tx1" })]),
          ]),
        ]),
      ]),
      el("p:bodyStyle", {}, [
        el("a:lvl1pPr", {}, [el("a:defRPr", { sz: "1800" })]),
      ]),
      el("p:otherStyle", {}, [
        el("a:lvl1pPr", {}, [el("a:defRPr", { sz: "1200" })]),
      ]),
    ]),
  ]);
  const theme = el("a:theme", {}, [
    el("a:themeElements", {}, [
      el("a:clrScheme", {}, [
        el("a:dk1", {}, [
          el("a:sysClr", { val: "windowText", lastClr: "000000" }),
        ]),
        el("a:lt1", {}, [el("a:sysClr", { val: "window", lastClr: "FFFFFF" })]),
      ]),
      el("a:fontScheme", {}, [
        el("a:majorFont", {}, [el("a:latin", { typeface: "Aptos Display" })]),
        el("a:minorFont", {}, [el("a:latin", { typeface: "Aptos" })]),
      ]),
    ]),
  ]);

  return {
    parts: {
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": {
        kind: "xml",
        nodes: [
          rels([
            {
              id: "rId1",
              type: SLIDE_LAYOUT_REL,
              target: "../slideLayouts/slideLayout1.xml",
            },
          ]),
        ],
      },
      "ppt/slideLayouts/slideLayout1.xml": { kind: "xml", nodes: [layout] },
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": {
        kind: "xml",
        nodes: [
          rels([
            {
              id: "rId1",
              type: SLIDE_MASTER_REL,
              target: "../slideMasters/slideMaster1.xml",
            },
          ]),
        ],
      },
      "ppt/slideMasters/slideMaster1.xml": { kind: "xml", nodes: [master] },
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": {
        kind: "xml",
        nodes: [
          rels([
            { id: "rId1", type: THEME_REL, target: "../theme/theme1.xml" },
          ]),
        ],
      },
      "ppt/theme/theme1.xml": { kind: "xml", nodes: [theme] },
    },
  };
}

describe("resolveSlideInheritance", () => {
  it("resolves layout, master, theme, and colour map via each part's own relationships", () => {
    const pkg = buildFixturePackage();
    const context = resolveSlideInheritance(pkg, "ppt/slides/slide1.xml");
    expect(context.layoutRoot?.tag).toBe("p:sldLayout");
    expect(context.masterRoot?.tag).toBe("p:sldMaster");
    expect(context.theme.majorFont).toBe("Aptos Display");
    expect(context.colorMap.get("tx1")).toBe("dk1");
  });

  it("degrades to undefined roots and an empty theme when the slide has no layout relationship", () => {
    const pkg: Package = {
      parts: { "ppt/slides/slide1.xml": { kind: "xml", nodes: [el("p:sld")] } },
    };
    const context = resolveSlideInheritance(pkg, "ppt/slides/slide1.xml");
    expect(context.layoutRoot).toBeUndefined();
    expect(context.masterRoot).toBeUndefined();
    expect(context.theme.majorFont).toBe("Calibri");
    expect(context.colorMap.size).toBe(0);
  });
});

describe("readPlaceholderKey", () => {
  it("reads type and idx from p:ph", () => {
    const shape = placeholderShape({ type: "body", idx: "3" });
    expect(readPlaceholderKey(shape)).toEqual({ type: "body", idx: "3" });
  });

  it("returns undefined for a non-placeholder shape", () => {
    const shape = el("p:sp", {}, [
      el("p:nvSpPr", {}, [
        el("p:cNvPr", { id: "2", name: "TextBox" }),
        el("p:cNvSpPr"),
        el("p:nvPr"),
      ]),
    ]);
    expect(readPlaceholderKey(shape)).toBeUndefined();
  });
});

describe("findMatchingPlaceholder", () => {
  it("matches by idx over type when both are available", () => {
    const root = el("p:sldLayout", {}, [
      el("p:cSld", {}, [
        el("p:spTree", {}, [
          placeholderShape({ type: "body", idx: "1" }),
          placeholderShape({ type: "body", idx: "2" }),
        ]),
      ]),
    ]);
    const match = findMatchingPlaceholder(root, { type: "body", idx: "2" });
    if (match === undefined) {
      throw new Error("expected a match");
    }
    expect(readPlaceholderKey(match)).toEqual({ type: "body", idx: "2" });
  });

  it("normalizes ctrTitle/subTitle to title/body when matching against a layout/master", () => {
    const root = el("p:sldLayout", {}, [
      el("p:cSld", {}, [
        el("p:spTree", {}, [placeholderShape({ type: "title" })]),
      ]),
    ]);
    const match = findMatchingPlaceholder(root, {
      type: "ctrTitle",
      idx: undefined,
    });
    expect(match).toBeDefined();
  });

  it("returns undefined when root is undefined or no shape matches", () => {
    expect(
      findMatchingPlaceholder(undefined, { type: "title", idx: undefined }),
    ).toBeUndefined();
    const root = el("p:sldLayout", {}, [
      el("p:cSld", {}, [
        el("p:spTree", {}, [placeholderShape({ type: "body" })]),
      ]),
    ]);
    expect(
      findMatchingPlaceholder(root, { type: "title", idx: undefined }),
    ).toBeUndefined();
  });
});

describe("resolvePlaceholderXfrm", () => {
  it("inherits geometry from the layout when the layout defines it", () => {
    const pkg = buildFixturePackage({ layoutHasXfrm: true });
    const context = resolveSlideInheritance(pkg, "ppt/slides/slide1.xml");
    const xfrm = resolvePlaceholderXfrm(
      { type: "title", idx: undefined },
      context,
    );
    expect(xfrm).toEqual({
      xPt: 72,
      yPt: 36,
      widthPt: 144,
      heightPt: 72,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
    });
  });

  it("falls back to the master when the layout has no xfrm for the matching placeholder", () => {
    const pkg = buildFixturePackage({ layoutHasXfrm: false });
    const context = resolveSlideInheritance(pkg, "ppt/slides/slide1.xml");
    const xfrm = resolvePlaceholderXfrm(
      { type: "title", idx: undefined },
      context,
    );
    expect(xfrm).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 720,
      heightPt: 90,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
    });
  });

  it("returns undefined when neither layout nor master define geometry for the placeholder", () => {
    const context = {
      layoutRoot: undefined,
      masterRoot: undefined,
      theme: {
        colorScheme: new Map(),
        majorFont: "Calibri",
        minorFont: "Calibri",
      },
      colorMap: new Map(),
    };
    expect(
      resolvePlaceholderXfrm({ type: "title", idx: undefined }, context),
    ).toBeUndefined();
  });
});

describe("resolveDefaultRunProperties", () => {
  it("resolves size, bold, theme font, and theme colour from the title style", () => {
    const pkg = buildFixturePackage();
    const context = resolveSlideInheritance(pkg, "ppt/slides/slide1.xml");
    const props = resolveDefaultRunProperties("title", 0, context);
    expect(props.sizePt).toBe(44);
    expect(props.bold).toBe(true);
    expect(props.fontFamily).toBe("Aptos Display");
    expect(props.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("resolves the body style independently of the title style", () => {
    const pkg = buildFixturePackage();
    const context = resolveSlideInheritance(pkg, "ppt/slides/slide1.xml");
    const props = resolveDefaultRunProperties("body", 0, context);
    expect(props.sizePt).toBe(18);
    expect(props.bold).toBeUndefined();
    expect(props.fontFamily).toBeUndefined();
  });

  it("normalizes ctrTitle/subTitle to the title/body style", () => {
    const pkg = buildFixturePackage();
    const context = resolveSlideInheritance(pkg, "ppt/slides/slide1.xml");
    expect(resolveDefaultRunProperties("ctrTitle", 0, context).sizePt).toBe(44);
    expect(resolveDefaultRunProperties("subTitle", 0, context).sizePt).toBe(18);
  });

  it("returns an empty object when there is no master to resolve against", () => {
    const context = {
      layoutRoot: undefined,
      masterRoot: undefined,
      theme: {
        colorScheme: new Map(),
        majorFont: "Calibri",
        minorFont: "Calibri",
      },
      colorMap: new Map(),
    };
    expect(resolveDefaultRunProperties("title", 0, context)).toEqual({});
  });
});

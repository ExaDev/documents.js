import { describe, expect, it } from "vitest";
import { el, txt } from "../../xml/fragment";
import type { GroupChildTransform } from "./drawingml";
import {
  applyGroupTransform,
  composeGroupTransform,
  composeShapeRotationDeg,
  EMPTY_THEME,
  readColorMap,
  readGroupXfrm,
  readSchemeColor,
  readSolidFillColor,
  readSrgbColor,
  readTheme,
  readXfrm,
  resolveSchemeColorSlot,
  resolveThemeFontReference,
} from "./drawingml";

// Ported verbatim from documents.js's src/ooxml/drawingml.test.ts.

describe("readXfrm", () => {
  it("reads position, size, rotation, and flip flags, converting EMU to points", () => {
    const xfrm = el("a:xfrm", { rot: "2700000", flipH: "1", flipV: "1" }, [
      el("a:off", { x: "914400", y: "457200" }),
      el("a:ext", { cx: "1828800", cy: "914400" }),
    ]);
    expect(readXfrm(xfrm)).toEqual({
      xPt: 72,
      yPt: 36,
      widthPt: 144,
      heightPt: 72,
      rotationDeg: 45,
      flipH: true,
      flipV: true,
    });
  });

  it("defaults rotationDeg to 0 and flip flags to false when absent", () => {
    const xfrm = el("a:xfrm", {}, [
      el("a:off", { x: "0", y: "0" }),
      el("a:ext", { cx: "914400", cy: "914400" }),
    ]);
    const result = readXfrm(xfrm);
    expect(result?.rotationDeg).toBe(0);
    expect(result?.flipH).toBe(false);
    expect(result?.flipV).toBe(false);
  });

  it("returns undefined when xfrm itself is undefined", () => {
    expect(readXfrm(undefined)).toBeUndefined();
  });

  it("returns undefined when a:off or a:ext is missing", () => {
    expect(
      readXfrm(el("a:xfrm", {}, [el("a:off", { x: "0", y: "0" })])),
    ).toBeUndefined();
    expect(
      readXfrm(el("a:xfrm", {}, [el("a:ext", { cx: "1", cy: "1" })])),
    ).toBeUndefined();
    expect(readXfrm(el("a:xfrm"))).toBeUndefined();
  });

  // a:off/a:ext are present in every case below -- only one of the four required ATTRIBUTES they carry is missing, isolating each clause of the x/y/cx/cy undefined check from the other tests above, which only ever exercise the earlier "a:off or a:ext element itself is missing" guard.
  it("returns undefined when a:off is missing its x attribute", () => {
    const xfrm = el("a:xfrm", {}, [
      el("a:off", { y: "0" }),
      el("a:ext", { cx: "1", cy: "1" }),
    ]);
    expect(readXfrm(xfrm)).toBeUndefined();
  });

  it("returns undefined when a:off is missing its y attribute", () => {
    const xfrm = el("a:xfrm", {}, [
      el("a:off", { x: "0" }),
      el("a:ext", { cx: "1", cy: "1" }),
    ]);
    expect(readXfrm(xfrm)).toBeUndefined();
  });

  it("returns undefined when a:ext is missing its cx attribute", () => {
    const xfrm = el("a:xfrm", {}, [
      el("a:off", { x: "0", y: "0" }),
      el("a:ext", { cy: "1" }),
    ]);
    expect(readXfrm(xfrm)).toBeUndefined();
  });

  it("returns undefined when a:ext is missing its cy attribute", () => {
    const xfrm = el("a:xfrm", {}, [
      el("a:off", { x: "0", y: "0" }),
      el("a:ext", { cx: "1" }),
    ]);
    expect(readXfrm(xfrm)).toBeUndefined();
  });
});

function clrScheme(): ReturnType<typeof el> {
  return el("a:clrScheme", {}, [
    el("a:dk1", {}, [el("a:sysClr", { val: "windowText", lastClr: "000000" })]),
    el("a:lt1", {}, [el("a:sysClr", { val: "window", lastClr: "FFFFFF" })]),
    el("a:dk2", {}, [el("a:srgbClr", { val: "44546A" })]),
    el("a:lt2", {}, [el("a:srgbClr", { val: "E7E6E6" })]),
    el("a:accent1", {}, [el("a:srgbClr", { val: "4472C4" })]),
    el("a:accent2", {}, [el("a:srgbClr", { val: "ED7D31" })]),
    el("a:hlink", {}, [el("a:srgbClr", { val: "0563C1" })]),
    el("a:folHlink", {}, [el("a:srgbClr", { val: "954F72" })]),
  ]);
}

function fontScheme(): ReturnType<typeof el> {
  return el("a:fontScheme", {}, [
    el("a:majorFont", {}, [el("a:latin", { typeface: "Aptos Display" })]),
    el("a:minorFont", {}, [el("a:latin", { typeface: "Aptos" })]),
  ]);
}

function themeRoot(): ReturnType<typeof el> {
  return el("a:theme", {}, [
    el("a:themeElements", {}, [clrScheme(), fontScheme()]),
  ]);
}

describe("readTheme", () => {
  it("reads every present colour-scheme slot, resolving sysClr via lastClr and srgbClr via val", () => {
    const theme = readTheme(themeRoot());
    expect(theme.colorScheme.get("dk1")).toEqual({ r: 0, g: 0, b: 0 });
    expect(theme.colorScheme.get("lt1")).toEqual({ r: 1, g: 1, b: 1 });
    expect(theme.colorScheme.get("accent1")).toEqual({
      r: 0x44 / 255,
      g: 0x72 / 255,
      b: 0xc4 / 255,
    });
    expect(theme.colorScheme.get("hlink")).toEqual({
      r: 0x05 / 255,
      g: 0x63 / 255,
      b: 0xc1 / 255,
    });
  });

  it("reads the major/minor Latin theme fonts", () => {
    const theme = readTheme(themeRoot());
    expect(theme.majorFont).toBe("Aptos Display");
    expect(theme.minorFont).toBe("Aptos");
  });

  it("falls back to sysClr's conventional windowText/window default when lastClr is absent", () => {
    const root = el("a:theme", {}, [
      el("a:themeElements", {}, [
        el("a:clrScheme", {}, [
          el("a:dk1", {}, [el("a:sysClr", { val: "windowText" })]),
          el("a:lt1", {}, [el("a:sysClr", { val: "window" })]),
        ]),
      ]),
    ]);
    const theme = readTheme(root);
    expect(theme.colorScheme.get("dk1")).toEqual({ r: 0, g: 0, b: 0 });
    expect(theme.colorScheme.get("lt1")).toEqual({ r: 1, g: 1, b: 1 });
  });

  it("falls back to the default theme font when a:fontScheme is absent", () => {
    const root = el("a:theme", {}, [el("a:themeElements", {}, [clrScheme()])]);
    const theme = readTheme(root);
    expect(theme.majorFont).toBe("Calibri");
    expect(theme.minorFont).toBe("Calibri");
  });

  it("uses lastClr over the windowText/window fallback, even when val is 'window'", () => {
    // val="window" would fall back to white if lastClr were ignored -- a distinct lastClr here proves the real cached value is read, not merely coinciding with what the fallback happens to also produce (every other fixture's own lastClr is black or white, indistinguishable from its own fallback).
    const root = el("a:theme", {}, [
      el("a:themeElements", {}, [
        el("a:clrScheme", {}, [
          el("a:lt1", {}, [
            el("a:sysClr", { val: "window", lastClr: "123456" }),
          ]),
        ]),
      ]),
    ]);
    const theme = readTheme(root);
    expect(theme.colorScheme.get("lt1")).toEqual({
      r: 0x12 / 255,
      g: 0x34 / 255,
      b: 0x56 / 255,
    });
  });

  it("resolves no colour at all for a colour-scheme slot whose child is neither a:srgbClr nor a:sysClr", () => {
    const root = el("a:theme", {}, [
      el("a:themeElements", {}, [
        el("a:clrScheme", {}, [
          el("a:dk1", {}, [el("a:someOtherColorType", { val: "000000" })]),
        ]),
      ]),
    ]);
    const theme = readTheme(root);
    expect(theme.colorScheme.has("dk1")).toBe(false);
  });

  it("skips a non-element child (e.g. whitespace text) to find a slot's real colour element", () => {
    const root = el("a:theme", {}, [
      el("a:themeElements", {}, [
        el("a:clrScheme", {}, [
          el("a:dk1", {}, [txt("\n  "), el("a:srgbClr", { val: "44546A" })]),
        ]),
      ]),
    ]);
    const theme = readTheme(root);
    expect(theme.colorScheme.get("dk1")).toEqual({
      r: 0x44 / 255,
      g: 0x54 / 255,
      b: 0x6a / 255,
    });
  });
});

describe("resolveThemeFontReference", () => {
  it("resolves +mj-lt and +mn-lt to the theme fonts, and passes any other string through unchanged", () => {
    const theme = readTheme(themeRoot());
    expect(resolveThemeFontReference("+mj-lt", theme)).toBe("Aptos Display");
    expect(resolveThemeFontReference("+mn-lt", theme)).toBe("Aptos");
    expect(resolveThemeFontReference("Arial", theme)).toBe("Arial");
  });
});

describe("readColorMap", () => {
  it("reads every attribute of a p:clrMap element as a mapping entry", () => {
    const clrMap = el("p:clrMap", {
      bg1: "lt1",
      tx1: "dk1",
      bg2: "lt2",
      tx2: "dk2",
      accent1: "accent1",
    });
    const map = readColorMap(clrMap);
    expect(map.get("bg1")).toBe("lt1");
    expect(map.get("tx1")).toBe("dk1");
    expect(map.get("accent1")).toBe("accent1");
  });

  it("returns an empty map for an undefined element", () => {
    expect(readColorMap(undefined).size).toBe(0);
  });
});

describe("resolveSchemeColorSlot", () => {
  it("maps a logical name (bg1/tx1/...) via the colour map", () => {
    const colorMap = readColorMap(el("p:clrMap", { tx1: "dk1" }));
    expect(resolveSchemeColorSlot("tx1", colorMap)).toBe("dk1");
  });

  it("passes a raw theme slot name (dk1/lt1/...) through unchanged when not a colour-map key", () => {
    const colorMap = readColorMap(el("p:clrMap", { tx1: "dk1" }));
    expect(resolveSchemeColorSlot("accent2", colorMap)).toBe("accent2");
  });
});

describe("readSchemeColor", () => {
  it("resolves val through the colour map into the theme colour scheme", () => {
    const theme = readTheme(themeRoot());
    const colorMap = readColorMap(el("p:clrMap", { tx1: "dk1" }));
    const schemeClr = el("a:schemeClr", { val: "tx1" });
    expect(readSchemeColor(schemeClr, colorMap, theme)).toEqual({
      r: 0,
      g: 0,
      b: 0,
    });
  });

  it("applies child colour transforms on top of the resolved base colour", () => {
    const theme = readTheme(themeRoot());
    const colorMap = readColorMap(undefined);
    const schemeClr = el("a:schemeClr", { val: "lt1" }, [
      el("a:lumMod", { val: "50000" }),
    ]);
    expect(readSchemeColor(schemeClr, colorMap, theme)).toEqual({
      r: 0.5,
      g: 0.5,
      b: 0.5,
    });
  });

  it("returns undefined when val is missing or the slot has no theme entry", () => {
    const theme = readTheme(themeRoot());
    const colorMap = readColorMap(undefined);
    expect(readSchemeColor(el("a:schemeClr"), colorMap, theme)).toBeUndefined();
    expect(
      readSchemeColor(
        el("a:schemeClr", { val: "accent5" }),
        colorMap,
        EMPTY_THEME,
      ),
    ).toBeUndefined();
  });

  it("skips a recognised transform child that carries no val attribute, applying only the one that does", () => {
    const theme = readTheme(themeRoot());
    const colorMap = readColorMap(undefined);
    const schemeClr = el("a:schemeClr", { val: "lt1" }, [
      el("a:lumMod"),
      el("a:lumOff", { val: "-50000" }),
    ]);
    // If the val-less lumMod were included as a NaN-valued transform, the result would be NaN throughout rather than the clean 0.5 a single, real 50% lumOff on white produces.
    expect(readSchemeColor(schemeClr, colorMap, theme)).toEqual({
      r: 0.5,
      g: 0.5,
      b: 0.5,
    });
  });
});

describe("readSrgbColor", () => {
  it("parses val and applies any child colour transforms", () => {
    expect(readSrgbColor(el("a:srgbClr", { val: "FF0000" }))).toEqual({
      r: 1,
      g: 0,
      b: 0,
    });
    const withShade = readSrgbColor(
      el("a:srgbClr", { val: "FFFFFF" }, [el("a:shade", { val: "50000" })]),
    );
    expect(withShade?.r).toBeCloseTo(0.7353569830524495, 12);
  });

  it("returns undefined when val is missing", () => {
    expect(readSrgbColor(el("a:srgbClr"))).toBeUndefined();
  });
});

describe("readSolidFillColor", () => {
  it("resolves a solidFill wrapping a schemeClr", () => {
    const theme = readTheme(themeRoot());
    const colorMap = readColorMap(undefined);
    const solidFill = el("a:solidFill", {}, [
      el("a:schemeClr", { val: "accent1" }),
    ]);
    expect(readSolidFillColor(solidFill, colorMap, theme)).toEqual({
      r: 0x44 / 255,
      g: 0x72 / 255,
      b: 0xc4 / 255,
    });
  });

  it("resolves a solidFill wrapping a srgbClr", () => {
    const solidFill = el("a:solidFill", {}, [
      el("a:srgbClr", { val: "00FF00" }),
    ]);
    expect(
      readSolidFillColor(solidFill, readColorMap(undefined), EMPTY_THEME),
    ).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("returns undefined when the wrapper is undefined or has no recognised colour child", () => {
    expect(
      readSolidFillColor(undefined, readColorMap(undefined), EMPTY_THEME),
    ).toBeUndefined();
    expect(
      readSolidFillColor(
        el("a:solidFill"),
        readColorMap(undefined),
        EMPTY_THEME,
      ),
    ).toBeUndefined();
  });
});

describe("readGroupXfrm", () => {
  it("reads off/ext/chOff/chExt/rot/flipH/flipV, all converted to points/degrees", () => {
    const xfrm = el("a:xfrm", { rot: "5400000", flipH: "1" }, [
      el("a:off", { x: "914400", y: "457200" }),
      el("a:ext", { cx: "1828800", cy: "914400" }),
      el("a:chOff", { x: "0", y: "0" }),
      el("a:chExt", { cx: "914400", cy: "457200" }),
    ]);
    expect(readGroupXfrm(xfrm)).toEqual({
      offXPt: 72,
      offYPt: 36,
      extWidthPt: 144,
      extHeightPt: 72,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 72,
      childExtHeightPt: 36,
      rotationDeg: 90,
      flipH: true,
      flipV: false,
    });
  });

  it("returns undefined for a regular (non-group) xfrm with no chOff/chExt", () => {
    const xfrm = el("a:xfrm", {}, [
      el("a:off", { x: "0", y: "0" }),
      el("a:ext", { cx: "914400", cy: "914400" }),
    ]);
    expect(readGroupXfrm(xfrm)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(readGroupXfrm(undefined)).toBeUndefined();
  });

  // a:chOff/a:chExt are present in every case below -- only one of the four required ATTRIBUTES they carry is missing, isolating each clause of the cx/cy/ccx/ccy undefined check from the earlier "no chOff/chExt element at all" test above.
  function groupXfrm(
    chOff: ReturnType<typeof el>,
    chExt: ReturnType<typeof el>,
  ): ReturnType<typeof el> {
    return el("a:xfrm", {}, [
      el("a:off", { x: "0", y: "0" }),
      el("a:ext", { cx: "1828800", cy: "914400" }),
      chOff,
      chExt,
    ]);
  }

  it("returns undefined when a:chOff is missing its x attribute", () => {
    const xfrm = groupXfrm(
      el("a:chOff", { y: "0" }),
      el("a:chExt", { cx: "914400", cy: "457200" }),
    );
    expect(readGroupXfrm(xfrm)).toBeUndefined();
  });

  it("returns undefined when a:chOff is missing its y attribute", () => {
    const xfrm = groupXfrm(
      el("a:chOff", { x: "0" }),
      el("a:chExt", { cx: "914400", cy: "457200" }),
    );
    expect(readGroupXfrm(xfrm)).toBeUndefined();
  });

  it("returns undefined when a:chExt is missing its cx attribute", () => {
    const xfrm = groupXfrm(
      el("a:chOff", { x: "0", y: "0" }),
      el("a:chExt", { cy: "457200" }),
    );
    expect(readGroupXfrm(xfrm)).toBeUndefined();
  });

  it("returns undefined when a:chExt is missing its cy attribute", () => {
    const xfrm = groupXfrm(
      el("a:chOff", { x: "0", y: "0" }),
      el("a:chExt", { cx: "914400" }),
    );
    expect(readGroupXfrm(xfrm)).toBeUndefined();
  });
});

function unrotatedGroup(fields: {
  offXPt: number;
  offYPt: number;
  extWidthPt: number;
  extHeightPt: number;
  childOffXPt: number;
  childOffYPt: number;
  childExtWidthPt: number;
  childExtHeightPt: number;
}): GroupChildTransform {
  return { ...fields, compositeRotationDeg: 0, compositeMirrored: false };
}

describe("applyGroupTransform", () => {
  it("is the identity when the group and child coordinate spaces coincide", () => {
    const group = unrotatedGroup({
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 100,
      extHeightPt: 100,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 100,
      childExtHeightPt: 100,
    });
    const child = { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 };
    expect(applyGroupTransform(group, child)).toEqual(child);
  });

  it("scales and translates a child frame into the parent space (verified against Apache POI's DrawGroupShape)", () => {
    const group = unrotatedGroup({
      offXPt: 100,
      offYPt: 100,
      extWidthPt: 200,
      extHeightPt: 200,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 100,
      childExtHeightPt: 100,
    });
    const child = { xPt: 10, yPt: 10, widthPt: 20, heightPt: 20 };
    // scaleX = scaleY = 200/100 = 2; absolute = 100 + (10-0)*2 = 120, size = 20*2 = 40.
    expect(applyGroupTransform(group, child)).toEqual({
      xPt: 120,
      yPt: 120,
      widthPt: 40,
      heightPt: 40,
    });
  });

  it("falls back to a scale of 1 when a child extent is zero, rather than dividing by zero", () => {
    const group = unrotatedGroup({
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 200,
      extHeightPt: 200,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 0,
      childExtHeightPt: 0,
    });
    const child = { xPt: 10, yPt: 10, widthPt: 20, heightPt: 20 };
    expect(applyGroupTransform(group, child)).toEqual({
      xPt: 10,
      yPt: 10,
      widthPt: 20,
      heightPt: 20,
    });
  });

  it("rotates the mapped box's centre about the group's own centre when the group carries a composite rotation", () => {
    // group centre = (100,100)+(200,200)/2 = (200,200); child (150,50,20,20)pt -> canonical box centre (260,160), i.e. (60,-40) from the group centre; rotating 90deg clockwise (east->south) sends (60,-40) to (40,60); final centre (240,260), top-left (230,250).
    const group: GroupChildTransform = {
      offXPt: 100,
      offYPt: 100,
      extWidthPt: 200,
      extHeightPt: 200,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 200,
      childExtHeightPt: 200,
      compositeRotationDeg: 90,
      compositeMirrored: false,
    };
    const child = { xPt: 150, yPt: 50, widthPt: 20, heightPt: 20 };
    const result = applyGroupTransform(group, child);
    expect(result.xPt).toBeCloseTo(230, 9);
    expect(result.yPt).toBeCloseTo(250, 9);
    expect(result.widthPt).toBe(20);
    expect(result.heightPt).toBe(20);
  });

  it("mirrors the box centre across the vertical axis before rotating when the group is composite-mirrored", () => {
    // Same group/child as above but compositeMirrored: dx negates from 60 to -60 before the 90deg rotation, giving (40,-60) instead of (40,60); final centre (240,140), top-left (230,130).
    const group: GroupChildTransform = {
      offXPt: 100,
      offYPt: 100,
      extWidthPt: 200,
      extHeightPt: 200,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 200,
      childExtHeightPt: 200,
      compositeRotationDeg: 90,
      compositeMirrored: true,
    };
    const child = { xPt: 150, yPt: 50, widthPt: 20, heightPt: 20 };
    const result = applyGroupTransform(group, child);
    expect(result.xPt).toBeCloseTo(230, 9);
    expect(result.yPt).toBeCloseTo(130, 9);
  });

  it("subtracts, rather than adds, the group's own child-space offset when mapping into the parent space", () => {
    // A non-zero childOffXPt/childOffYPt (every other test above zeroes both, which cannot distinguish addition from subtraction): child at (10,10) in a space whose own origin sits at (5,5), one scale unit wide, so the child's own offset from that origin -- (10-5, 10-5) = (5,5) -- is what should be added onto the group's own placement (50,50), giving (55,55).
    const group = unrotatedGroup({
      offXPt: 50,
      offYPt: 50,
      extWidthPt: 100,
      extHeightPt: 100,
      childOffXPt: 5,
      childOffYPt: 5,
      childExtWidthPt: 100,
      childExtHeightPt: 100,
    });
    const child = { xPt: 10, yPt: 10, widthPt: 20, heightPt: 20 };
    expect(applyGroupTransform(group, child)).toEqual({
      xPt: 55,
      yPt: 55,
      widthPt: 20,
      heightPt: 20,
    });
  });

  it("still rotates about the group's own centre when the composite is mirrored but its rotation is exactly 0", () => {
    // The identity shortcut requires BOTH compositeRotationDeg === 0 AND !compositeMirrored -- a mirrored group with no rotation must still go through the centre-mirroring path (a 0deg rotation is a no-op once there, but a mirror is not), rather than short-circuiting straight to the unrotated canonical box.
    const group: GroupChildTransform = {
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 200,
      extHeightPt: 100,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 200,
      childExtHeightPt: 100,
      compositeRotationDeg: 0,
      compositeMirrored: true,
    };
    // Group centre (100,50); child box centre (60,50) is 40 to the left of it -- mirroring flips that to 40 to the right, i.e. a final box centre of (140,50), top-left (120,40).
    const child = { xPt: 40, yPt: 40, widthPt: 40, heightPt: 20 };
    const result = applyGroupTransform(group, child);
    expect(result.xPt).toBeCloseTo(120, 9);
    expect(result.yPt).toBeCloseTo(40, 9);
  });
});

describe("composeGroupTransform", () => {
  it("carries a top-level group's own rot/flip straight into compositeRotationDeg/compositeMirrored", () => {
    const own = {
      offXPt: 100,
      offYPt: 100,
      extWidthPt: 200,
      extHeightPt: 200,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 200,
      childExtHeightPt: 200,
      rotationDeg: 90,
      flipH: true,
      flipV: false,
    };
    const composed = composeGroupTransform(own, undefined);
    expect(composed?.compositeRotationDeg).toBe(90);
    expect(composed?.compositeMirrored).toBe(true);
  });

  it("adds a nested group's own rotation to its (unmirrored) parent's composite rotation", () => {
    const parent: GroupChildTransform = {
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 400,
      extHeightPt: 400,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 400,
      childExtHeightPt: 400,
      compositeRotationDeg: 90,
      compositeMirrored: false,
    };
    const own = {
      offXPt: 200,
      offYPt: 0,
      extWidthPt: 200,
      extHeightPt: 200,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 200,
      childExtHeightPt: 200,
      rotationDeg: 90,
      flipH: false,
      flipV: false,
    };
    const composed = composeGroupTransform(own, parent);
    expect(composed?.compositeRotationDeg).toBe(180);
    expect(composed?.compositeMirrored).toBe(false);
  });

  it("subtracts a nested group's own rotation, and toggles mirrored, when the parent is already composite-mirrored", () => {
    const parent: GroupChildTransform = {
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 400,
      extHeightPt: 400,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 400,
      childExtHeightPt: 400,
      compositeRotationDeg: 90,
      compositeMirrored: true,
    };
    const own = {
      offXPt: 200,
      offYPt: 0,
      extWidthPt: 200,
      extHeightPt: 200,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 200,
      childExtHeightPt: 200,
      rotationDeg: 30,
      flipH: false,
      flipV: false,
    };
    const composed = composeGroupTransform(own, parent);
    expect(composed?.compositeRotationDeg).toBe(60);
    expect(composed?.compositeMirrored).toBe(true);
  });

  it("returns undefined when own is undefined", () => {
    expect(composeGroupTransform(undefined, undefined)).toBeUndefined();
  });

  it("cancels flipH and flipV into a pure 180deg-shifted rotation, not a mirror", () => {
    const own = {
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 100,
      extHeightPt: 100,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 100,
      childExtHeightPt: 100,
      rotationDeg: 30,
      flipH: true,
      flipV: true,
    };
    const composed = composeGroupTransform(own, undefined);
    expect(composed?.compositeRotationDeg).toBe(210);
    expect(composed?.compositeMirrored).toBe(false);
  });

  it("restates a lone flipV as a 180deg-shifted mirror about the canonical flipH axis", () => {
    const own = {
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 100,
      extHeightPt: 100,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 100,
      childExtHeightPt: 100,
      rotationDeg: 30,
      flipH: false,
      flipV: true,
    };
    const composed = composeGroupTransform(own, undefined);
    expect(composed?.compositeRotationDeg).toBe(210);
    expect(composed?.compositeMirrored).toBe(true);
  });
});

describe("composeShapeRotationDeg", () => {
  it("returns the shape's own rotation unchanged when there is no enclosing group", () => {
    expect(composeShapeRotationDeg(undefined, 45)).toBe(45);
  });

  it("adds the shape's own rotation to an unmirrored enclosing composite", () => {
    const parent: GroupChildTransform = {
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 100,
      extHeightPt: 100,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 100,
      childExtHeightPt: 100,
      compositeRotationDeg: 90,
      compositeMirrored: false,
    };
    expect(composeShapeRotationDeg(parent, 30)).toBe(120);
  });

  it("subtracts the shape's own rotation from a mirrored enclosing composite -- the flip negates the sense of the shape's own rotation", () => {
    const parent: GroupChildTransform = {
      offXPt: 0,
      offYPt: 0,
      extWidthPt: 100,
      extHeightPt: 100,
      childOffXPt: 0,
      childOffYPt: 0,
      childExtWidthPt: 100,
      childExtHeightPt: 100,
      compositeRotationDeg: 90,
      compositeMirrored: true,
    };
    expect(composeShapeRotationDeg(parent, 30)).toBe(60);
  });
});

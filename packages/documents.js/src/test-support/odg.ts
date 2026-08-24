import type { Package } from "odf.js";
import {
  bytesToBase64,
  decodePackage,
  el,
  encodePackage,
  ODF_MEDIA_TYPES,
  txt,
} from "odf.js";

// Never imported by src/index.ts and never reaches dist/. Mirrors src/test-support/odp.ts's own reasoning: hand-authored ODF XML assembled via odf.js's own el/txt fragment builders and serialized via odf.js's own encodePackage, never via this package's own createEmptyOdgPackage (src/edit/odg/scaffold.ts) or createOdg, so a bug in that scaffold/editor cannot hide behind a fixture built with the same code -- this stays true even now that src/edit/odg/ has a full live-view editor (OdgEditor/OdgPage/OdgBoxVector/OdgLineVector/OdgPathVector), the same reason src/test-support/odp.ts and src/test-support/pptx.ts hand-build their own XML too despite openOdp/openPptx/createOdp/createPptx existing. The curved path's own svg:d/svg:viewBox ("M0 4000h3000c1000 0 1000-4000-1000-4000z" / "0 0 3657 4000") is not a guess -- it is odf.js's own typed/shared/path.ts ground-truth-verified real LibreOffice 26.2 output (see that file's own top-of-file note), reused here verbatim so this fixture exercises writePath against a genuine curve shape, not an invented one.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

function stylesXmlPart(): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-styles", {}, [
        el("office:automatic-styles", {}, [
          el("style:page-layout", { "style:name": "PM1" }, [
            el("style:page-layout-properties", {
              "fo:page-width": "400pt",
              "fo:page-height": "300pt",
            }),
          ]),
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
}

function graphicStyle(
  name: string,
  attrs: Record<string, string>,
): ReturnType<typeof el> {
  return el("style:style", { "style:name": name, "style:family": "graphic" }, [
    el("style:graphic-properties", attrs),
  ]);
}

// Page 1: two overlapping rectangles (BACK painted first, FRONT painted second -- document order is z-order, matching odf.js's own established real-LibreOffice-output convention, see typed/draw/shapes.ts's own paintOrderKey note), an ellipse, a stroked line, the ground-truth-verified curved path, and a text frame overlapping the curve -- exercising every LayoutItem kind convertDrawingToLayout emits (rect/ellipse/line/path via vectors, text via a ContentShape) on one page, plus the vectors-paint-before-shapes convention.
function buildFixturePackage(): Package {
  const rectBack = el(
    "draw:rect",
    {
      "draw:name": "Back",
      "draw:style-name": "grBack",
      "svg:width": "120pt",
      "svg:height": "80pt",
      "svg:x": "20pt",
      "svg:y": "120pt",
    },
    [el("text:p")],
  );
  const rectFront = el(
    "draw:rect",
    {
      "draw:name": "Front",
      "draw:style-name": "grFront",
      "svg:width": "120pt",
      "svg:height": "80pt",
      "svg:x": "60pt",
      "svg:y": "140pt",
    },
    [el("text:p")],
  );
  const rect = el(
    "draw:rect",
    {
      "draw:name": "Rect1",
      "draw:style-name": "grRect",
      "svg:width": "100pt",
      "svg:height": "70pt",
      "svg:x": "20pt",
      "svg:y": "20pt",
    },
    [el("text:p")],
  );
  const ellipse = el(
    "draw:ellipse",
    {
      "draw:name": "Ellipse1",
      "draw:style-name": "grEllipse",
      "svg:width": "100pt",
      "svg:height": "70pt",
      "svg:x": "160pt",
      "svg:y": "20pt",
    },
    [el("text:p")],
  );
  const line = el(
    "draw:line",
    {
      "draw:name": "Line1",
      "draw:style-name": "grLine",
      "svg:x1": "300pt",
      "svg:y1": "20pt",
      "svg:x2": "380pt",
      "svg:y2": "90pt",
    },
    [el("text:p")],
  );
  const curvePath = el(
    "draw:path",
    {
      "draw:name": "CurvePath1",
      "draw:style-name": "grCurve",
      "svg:width": "3.656cm",
      "svg:height": "3.999cm",
      "svg:x": "300pt",
      "svg:y": "140pt",
      "svg:viewBox": "0 0 3657 4000",
      "svg:d": "M0 4000h3000c1000 0 1000-4000-1000-4000z",
    },
    [el("text:p")],
  );
  const frame = el(
    "draw:frame",
    {
      "draw:name": "TextFrame",
      "svg:x": "305pt",
      "svg:y": "160pt",
      "svg:width": "80pt",
      "svg:height": "30pt",
    },
    [el("draw:text-box", {}, [el("text:p", {}, [txt("Label")])])],
  );
  const page1 = el(
    "draw:page",
    { "draw:name": "page1", "draw:master-page-name": "Default" },
    [rectBack, rectFront, rect, ellipse, line, curvePath, frame],
  );

  const contentXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, [
          graphicStyle("grBack", {
            "draw:fill-color": "#ff8000",
            "draw:stroke": "none",
          }),
          graphicStyle("grFront", {
            "draw:fill-color": "#8000ff",
            "draw:stroke": "none",
          }),
          graphicStyle("grRect", {
            "draw:fill-color": "#ff0000",
            "svg:stroke-color": "#000000",
            "svg:stroke-width": "0.05cm",
          }),
          graphicStyle("grEllipse", {
            "draw:fill-color": "#00c800",
            "svg:stroke-color": "#000000",
            "svg:stroke-width": "0.03cm",
          }),
          graphicStyle("grLine", {
            "svg:stroke-color": "#0000ff",
            "svg:stroke-width": "0.06cm",
          }),
          graphicStyle("grCurve", {
            "draw:fill-color": "#ffff00",
            "svg:stroke-color": "#000000",
            "svg:stroke-width": "0.05cm",
          }),
        ]),
        el("office:body", {}, [el("office:drawing", {}, [page1])]),
      ]),
    ],
  };

  const metaXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-meta", {}, [
        el("office:meta", {}, [el("dc:title", {}, [txt("My Drawing")])]),
      ]),
    ],
  };

  return {
    parts: {
      mimetype: {
        kind: "binary",
        base64: bytesToBase64(enc(ODF_MEDIA_TYPES.odg)),
      },
      "content.xml": contentXml,
      "styles.xml": stylesXmlPart(),
      "meta.xml": metaXml,
    },
  };
}

// A minimal but structurally authentic odg package (mimetype part first and stored, a real office:document-content with two overlapping rects, an ellipse, a line, a genuinely curved path, and a text frame) -- enough to round-trip through decodePackage and readOdgContent without needing a real LibreOffice-exported binary.
export function minimalOdgBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildFixturePackage());
}

export function minimalOdgPackage(): Package {
  return decodePackage(minimalOdgBytes());
}

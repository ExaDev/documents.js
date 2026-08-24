import type { LayoutMetadata } from "document-schema.js";
import type { Package, XmlElement, XmlNode } from "odf.js";
import {
  ODF_MEDIA_TYPES,
  setDocumentMediaType,
  syncManifest,
  xmlnsAttributes,
} from "odf.js";
import { SLIDE_SIZE_WIDESCREEN } from "document-schema.js";
import { encodeXmlText } from "../../xml/entities";
import { el, txt } from "../../xml/fragment";
import { HEADING_STYLES } from "../../layout/shared";

// The namespace prefixes odp's own content.xml/styles.xml actually use: office/style/text/table for the document structure and text/table content odt's own scaffold already needed; draw/svg for draw:page/draw:frame geometry and draw:image/draw:text-box content; presentation for presentation:notes; fo for style:page-layout-properties' fo:page-width/height; xlink for draw:image's own xlink:href. Mirrors odt/scaffold.ts's own CONTENT_NS_PREFIXES/STYLES_NS_PREFIXES reasoning exactly -- declared once at the root rather than piecemeal.
const CONTENT_NS_PREFIXES = [
  "office",
  "style",
  "text",
  "table",
  "draw",
  "presentation",
  "fo",
  "svg",
  "xlink",
] as const;
const STYLES_NS_PREFIXES = [
  "office",
  "style",
  "text",
  "table",
  "draw",
  "presentation",
  "fo",
  "svg",
  "xlink",
] as const;
const META_NS_PREFIXES = ["office", "meta", "dc"] as const;

const ODF_VERSION = "1.3";

// style:page-layout/@style:name and style:master-page/@style:name for the one shared page geometry every slide this editor creates references via draw:page/@draw:master-page-name -- mirroring odt/scaffold.ts's own single PAGE_LAYOUT_NAME/MASTER_PAGE_NAME pair, except exported here: unlike odt (whose page geometry is only ever read, never re-targeted after creation), OdpEditor.slideSize (editor.ts) needs to find this exact style:page-layout back by name to update it, and OdpEditor.addSlide needs this exact master-page name to reference on every new draw:page.
export const PAGE_LAYOUT_NAME = "PM1";
export const MASTER_PAGE_NAME = "Standard";

function declaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

// style:page-layout-properties carries the actual slide geometry; style:master-page merely names it -- the exact same page-layout -> master-page chain odt/scaffold.ts's own buildPageLayout uses, and the exact chain odf.js's own resolveDrawPageSize (src/typed/shared/masterpage.ts) reads back via draw:page/@draw:master-page-name -> style:master-page -> style:page-layout-name -> style:page-layout -> style:page-layout-properties. Defaults to PowerPoint's own 16:9 widescreen size (960 x 540pt), matching pptx/scaffold.ts's own DEFAULT_SLIDE_WIDTH/HEIGHT_EMU (12192000/6858000 EMU = 960/540pt) -- the same real-world default, expressed directly in points since ODF has no EMU concept at all.
function buildPageLayout(): XmlElement {
  return el("style:page-layout", { "style:name": PAGE_LAYOUT_NAME }, [
    el("style:page-layout-properties", {
      "fo:page-width": `${SLIDE_SIZE_WIDESCREEN.widthPt}pt`,
      "fo:page-height": `${SLIDE_SIZE_WIDESCREEN.heightPt}pt`,
    }),
  ]);
}

// One Heading_20_N common style per level of the heading visual convention (layout/shared.ts's HEADING_STYLES -- the same family-wide table odt's own scaffold defines these from). A draw:text-box's content model is (text:p | text:list)* with no text:h anywhere in it, so a heading paragraph crossing into a slide text box (odtToOdp's variant bridge carries them straight in) can never carry its depth as markup -- buildOdpPackage instead points the text:p's text:style-name at these definitions, the one carryable fact left: ODF has no built-in styles, so without a definition in this package's own office:styles the reference would resolve to nothing and the heading would lose its visual weight as well as its depth.
function buildHeadingStyles(): XmlElement[] {
  return Object.entries(HEADING_STYLES).map(([level, style]) =>
    el(
      "style:style",
      {
        "style:name": `Heading_20_${level}`,
        "style:display-name": `Heading ${level}`,
        "style:family": "paragraph",
      },
      [
        el("style:text-properties", {
          "fo:font-size": `${String(style.sizePt)}pt`,
          "fo:font-weight": style.bold ? "bold" : "normal",
        }),
      ],
    ),
  );
}

function buildStylesXml(): XmlElement {
  return el(
    "office:document-styles",
    {
      ...xmlnsAttributes([...STYLES_NS_PREFIXES]),
      "office:version": ODF_VERSION,
    },
    [
      el("office:styles", {}, buildHeadingStyles()),
      el("office:automatic-styles", {}, [buildPageLayout()]),
      el("office:master-styles", {}, [
        el("style:master-page", {
          "style:name": MASTER_PAGE_NAME,
          "style:page-layout-name": PAGE_LAYOUT_NAME,
        }),
      ]),
    ],
  );
}

// office:presentation starts empty -- OdpEditor.addSlide (editor.ts) appends draw:page elements into it one at a time, mirroring pptx/scaffold.ts's own empty p:sldIdLst.
function buildContentXml(): XmlElement {
  return el(
    "office:document-content",
    {
      ...xmlnsAttributes([...CONTENT_NS_PREFIXES]),
      "office:version": ODF_VERSION,
    },
    [
      el("office:automatic-styles"),
      el("office:body", {}, [el("office:presentation")]),
    ],
  );
}

// The office:meta children a LayoutMetadata value maps onto -- identical mapping to odt/scaffold.ts's own buildOfficeMeta (see that file's top-of-function comment for the full field-by-field rationale); duplicated here rather than shared, matching this directory's own existing convention of each format scaffold declaring its own small XML-building helpers.
function buildOfficeMeta(metadata: LayoutMetadata | undefined): XmlElement[] {
  if (metadata === undefined) {
    return [];
  }
  const children: XmlElement[] = [];
  if (metadata.title !== undefined) {
    children.push(el("dc:title", {}, [txt(encodeXmlText(metadata.title))]));
  }
  if (metadata.author !== undefined) {
    children.push(
      el("meta:initial-creator", {}, [txt(encodeXmlText(metadata.author))]),
    );
  }
  if (metadata.subject !== undefined) {
    children.push(el("dc:subject", {}, [txt(encodeXmlText(metadata.subject))]));
  }
  for (const keyword of metadata.keywords ?? []) {
    children.push(el("meta:keyword", {}, [txt(encodeXmlText(keyword))]));
  }
  if (metadata.creator !== undefined) {
    children.push(
      el("meta:generator", {}, [txt(encodeXmlText(metadata.creator))]),
    );
  }
  if (metadata.createdIso !== undefined) {
    children.push(
      el("meta:creation-date", {}, [txt(encodeXmlText(metadata.createdIso))]),
    );
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(
      el("dc:date", {}, [txt(encodeXmlText(metadata.modifiedIso))]),
    );
  }
  return children;
}

function buildMetaXml(metadata?: LayoutMetadata): XmlElement {
  return el(
    "office:document-meta",
    {
      ...xmlnsAttributes([...META_NS_PREFIXES]),
      "office:version": ODF_VERSION,
    },
    [el("office:meta", {}, buildOfficeMeta(metadata))],
  );
}

export interface CreateEmptyOdpPackageOptions {
  readonly metadata?: LayoutMetadata;
}

// Builds a minimal but genuinely valid, openable odp package from nothing: the mandatory mimetype part (via setDocumentMediaType), a content.xml with an empty office:automatic-styles and an empty office:body/office:presentation, a styles.xml with the page-layout -> master-page chain resolveDrawPageSize itself resolves for slide geometry, a minimal meta.xml, and a manifest listing every part (via syncManifest) -- the same shape odt/scaffold.ts's own createEmptyOdtPackage uses, and the same shape odf.js's own typed/odp/read.test.ts fixture (and this package's src/test-support/odp.ts fixture) independently verified against genuine LibreOffice 26.2 output. A caller passing no options gets byte-for-byte the same package as before office:meta population existed.
export function createEmptyOdpPackage(
  options?: CreateEmptyOdpPackageOptions,
): Package {
  const pkg: Package = {
    parts: {
      "content.xml": { kind: "xml", nodes: [declaration(), buildContentXml()] },
      "styles.xml": { kind: "xml", nodes: [declaration(), buildStylesXml()] },
      "meta.xml": {
        kind: "xml",
        nodes: [declaration(), buildMetaXml(options?.metadata)],
      },
    },
  };
  setDocumentMediaType(pkg, ODF_MEDIA_TYPES.odp);
  syncManifest(pkg);
  return pkg;
}

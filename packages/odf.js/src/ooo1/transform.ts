import type { Attribute, XmlElement, XmlNode } from "../model/node";
import type { Package, Part } from "../model/package";
import { rootElement, findChildElement, attrValue } from "../xml/query";
import { bytesToBase64 } from "../util/base64";
import { readMimetype } from "../mimetype";
import { ODF_NAMESPACES } from "../ns";
import { resolveOdfListKind } from "../typed/shared/list";
import {
  OOO1_NAMESPACES,
  isOoo1Package,
  isOoo1NamespacePrefix,
  odfMediaTypeForOoo1MediaType,
  ooo1MediaTypeForOdfMediaType,
} from "./ns";
import {
  propertyTypesForContainer,
  splitStyleProperties,
  mergeStyleProperties,
  type Ooo1PropertyType,
} from "./properties";

// Rewrites an OpenOffice.org 1.x package into the ODF shape this package's own typed readers already understand -- the whole of this codec's OpenOffice.org 1.x support, and the reason readSxw/readSxc/readSxi/readSxd are three lines each rather than a second set of readers.
//
// This mirrors what LibreOffice itself does with a .sxw: it does not have a second importer, it runs the document through a transformer (xmloff/source/transform/, the "xof" filter) that turns OpenOffice.org 1.x XML into ODF XML and feeds the result to the ordinary ODF importer. The transformation is genuinely a variant mapping and not a new parse: the two vocabularies share their document model, their element names for almost everything, and their attribute names for most things -- what differs is the namespace URIs, a list of renames, and a handful of real structural changes ODF made when OASIS standardised the format.
//
// The differences implemented below, each verified against a genuine OpenOffice.org 1.x document (.sxw/.sxc/.sxi/.sxd written by OpenOffice.org 1.1 and 1.9) and cross-checked against LibreOffice's own OOo-to-OASIS action tables (xmloff/source/transform/OOo2Oasis.cxx and StyleOOoTContext.cxx):
//   - Namespaces: every openoffice.org-minted URI becomes its OASIS successor, and fo:/svg: flip from the real W3C namespaces to OASIS's own "-compatible" mintings. See ./ns.ts.
//   - The document's genre: OpenOffice.org 1.x names it with an office:class attribute on the root and puts the content directly inside office:body; ODF removed the attribute and wraps the content in an office:text/office:spreadsheet/office:presentation/office:drawing/office:chart element instead.
//   - Styles: one style:properties per style becomes ODF's family of typed style:*-properties elements. See ./properties.ts, which owns that split entirely.
//   - Frames: draw:image/draw:text-box/draw:object and their siblings are bare shapes in OpenOffice.org 1.x; ODF wraps each in a draw:frame that carries the position, size and anchoring.
//   - Lists, notes, tabs and a list of individual renames (text:ordered-list/text:unordered-list to text:list, the footnote/endnote pair to the text:note family, text:tab-stop to text:tab, office:font-decls to office:font-face-decls, style:page-master to style:page-layout, ...).
//   - Values: lengths written in "inch" become "in", a cell's table:value-* attributes become office:value-*, a style's own style:family="graphics" becomes ODF's singular "graphic", and the compound style:text-underline/style:text-crossing-out attributes become ODF's style/type/width triples.
//   - The package itself: the manifest's namespace and its root media type become the OASIS ones, and the "mimetype" part ODF requires -- which OpenOffice.org 1.x packages do not have at all -- is synthesised.
//
// What this deliberately does NOT do is claim to be a general OpenOffice.org-to-ODF converter. It targets the shape this package's readers consume; a construct no reader looks at (chart plot-area geometry, the presentation animation elements, form control implementation names) is carried through with its names updated where the rename is known and otherwise left alone, which costs nothing and quarantines as residue exactly as an unknown ODF element would.

const CANONICAL_PREFIX_BY_URI: ReadonlyMap<string, string> = new Map([
  ...Object.entries(OOO1_NAMESPACES).map(
    ([prefix, uri]) => [uri, prefix] as const,
  ),
  ...Object.entries(ODF_NAMESPACES).map(
    ([prefix, uri]) => [uri, prefix] as const,
  ),
]);

function isOdfNamespacePrefix(
  prefix: string,
): prefix is keyof typeof ODF_NAMESPACES {
  return Object.hasOwn(ODF_NAMESPACES, prefix);
}

// The genre element ODF's office:body takes for each office:class value OpenOffice.org 1.x could write. A master document ("text-global") is still an office:text body in ODF -- what makes it a master document is its media type and its text:section-source links, not a different genre element.
const GENRE_ELEMENT_BY_CLASS: ReadonlyMap<string, string> = new Map([
  ["text", "office:text"],
  ["text-global", "office:text"],
  ["spreadsheet", "office:spreadsheet"],
  ["presentation", "office:presentation"],
  ["drawing", "office:drawing"],
  ["chart", "office:chart"],
]);

// Elements renamed outright between the two vocabularies, with no attribute or structural change of their own.
const RENAMED_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ["office:font-decls", "office:font-face-decls"],
  ["office:script", "office:scripts"],
  ["office:script-data", "office:script"],
  ["office:events", "office:event-listeners"],
  ["style:page-master", "style:page-layout"],
  ["text:ordered-list", "text:list"],
  ["text:unordered-list", "text:list"],
  ["text:tab-stop", "text:tab"],
  ["text:footnote-body", "text:note-body"],
  ["text:endnote-body", "text:note-body"],
  ["text:footnote-citation", "text:note-citation"],
  ["text:endnote-citation", "text:note-citation"],
  ["text:database-select", "text:database-row-select"],
  ["text:index-entry-chapter-number", "text:index-entry-chapter"],
  ["table:dependences", "table:dependencies"],
  ["table:dependence", "table:dependency"],
]);

// The footnote/endnote elements ODF folded into one text:note family, keeping the distinction in a text:note-class attribute.
const NOTE_ELEMENTS: ReadonlyMap<
  string,
  { readonly tag: string; readonly noteClass: string }
> = new Map([
  ["text:footnote", { tag: "text:note", noteClass: "footnote" }],
  ["text:endnote", { tag: "text:note", noteClass: "endnote" }],
  ["text:footnote-ref", { tag: "text:note-ref", noteClass: "footnote" }],
  ["text:endnote-ref", { tag: "text:note-ref", noteClass: "endnote" }],
  [
    "text:footnotes-configuration",
    { tag: "text:notes-configuration", noteClass: "footnote" },
  ],
  [
    "text:endnotes-configuration",
    { tag: "text:notes-configuration", noteClass: "endnote" },
  ],
]);

// Attributes ODF simply renamed, applied wherever they appear: each name below occurs on exactly one element family in either vocabulary, so no element-scoped guard is needed.
const RENAMED_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["style:page-master-name", "style:page-layout-name"],
  ["style:leader-char", "style:leader-text"],
  ["text:count-in-floating-frames", "text:count-in-text-boxes"],
  ["form:service-name", "form:control-implementation"],
  ["form:column-style-name", "form:text-style-name"],
  ["form:property-type", "office:value-type"],
]);

// The value-carrying attributes ODF moved into the office namespace so one vocabulary could serve a table cell, a text field and a form property alike. Element-scoped, because the source names live in the table and text namespaces where plenty of unrelated attributes also live.
const VALUE_ATTRIBUTE_LOCAL_NAMES = [
  "value-type",
  "value",
  "currency",
  "date-value",
  "time-value",
  "boolean-value",
  "string-value",
] as const;

const CELL_ELEMENTS: ReadonlySet<string> = new Set([
  "table:table-cell",
  "table:covered-table-cell",
  "table:change-track-table-cell",
]);

const TEXT_VALUE_ELEMENTS: ReadonlySet<string> = new Set([
  "text:variable-decl",
  "text:variable-set",
  "text:variable-input",
  "text:variable-get",
  "text:user-field-decl",
  "text:user-field-get",
  "text:user-field-input",
  "text:expression",
]);

// The shapes ODF replaced with a draw:frame wrapping the same element, and the attributes that move from the shape onto the frame. Transcribed from LibreOffice's own frame element and attribute action tables; everything not listed stays on the inner element (an image's xlink:href and its xlink:type/show/actuate companions, an applet's code, a plugin's mime type).
const FRAME_SHAPES: ReadonlySet<string> = new Set([
  "draw:text-box",
  "draw:image",
  "draw:object",
  "draw:object-ole",
  "draw:applet",
  "draw:plugin",
  "draw:floating-frame",
]);

const FRAME_ATTRIBUTES: ReadonlySet<string> = new Set([
  "draw:z-index",
  "draw:id",
  "draw:layer",
  "draw:style-name",
  "presentation:style-name",
  "draw:transform",
  "draw:name",
  "table:end-cell-address",
  "table:end-x",
  "table:end-y",
  "table:table-background",
  "text:anchor-type",
  "text:anchor-page-number",
  "draw:text-style-name",
  "svg:x",
  "svg:y",
  "svg:width",
  "svg:height",
  "style:rel-width",
  "style:rel-height",
  "presentation:class",
  "presentation:placeholder",
  "presentation:user-transformed",
]);

const FRAME_CHILD_ELEMENTS: ReadonlySet<string> = new Set([
  "office:event-listeners",
  "draw:glue-point",
  "draw:image-map",
  "svg:desc",
  "svg:title",
  "draw:contour-polygon",
  "draw:contour-path",
]);

// Elements whose xlink:href addresses a part of the package rather than a document location. OpenOffice.org 1.x wrote those as a fragment ("#Pictures/10000.png"); ODF writes the bare part path. A hyperlink's own href is not in this set, so a genuine "#bookmark" fragment survives untouched.
const PACKAGE_HREF_ELEMENTS: ReadonlySet<string> = new Set([
  "draw:image",
  "draw:object",
  "draw:object-ole",
  "draw:applet",
  "draw:plugin",
  "draw:floating-frame",
  "draw:fill-image",
  "style:background-image",
  "text:list-level-style-image",
]);

// A length written with OpenOffice.org 1.x's "inch" unit, which ODF spells "in". Matched only as a whole whitespace-delimited token so a compound value keeps its structure (fo:border-left="0.0139inch solid #000080" becomes "0.0139in solid #000080").
const INCH_TOKEN = /(^|\s)(-?(?:\d+(?:\.\d+)?|\.\d+))inch(?=\s|$)/g;

// Attributes that never hold a measurement, so an "inch"-shaped token in one is a user's own text (a style called "2 inch indent", a file called "2inch.png") rather than a length to rewrite. No ODF length attribute's local name ends in "name", and none is a URI, so excluding those two costs nothing and closes the only way the substitution above could corrupt real content.
function carriesNoLength(attributeName: string): boolean {
  return attributeName.endsWith("name") || attributeName === "xlink:href";
}

// OpenOffice.org 1.x names the drawing style family "graphics"; ODF renamed it to the singular "graphic". Taken from LibreOffice's own transformer (xmloff/source/transform/StyleOOoTContext.cxx maps XML_GRAPHICS onto XML_FAMILY_TYPE_GRAPHIC on the way in and writes XML_GRAPHIC back out), and confirmed against LibreOffice 26.2 directly: a package whose graphic automatic styles say "graphic" imports with every one of them silently unbound, so each shape falls back to the consumer's own default fill and stroke -- the same silent-inherit failure mode a missing draw:style-name causes. Scoped by attribute name alone, which is exact: style:family appears on style:style and style:default-style and nowhere else in either vocabulary. Every other family name -- including "presentation", the drawing family's sibling on a slide -- is spelled identically on both sides.
const OOO1_GRAPHIC_STYLE_FAMILY = "graphics";
const ODF_GRAPHIC_STYLE_FAMILY = "graphic";

function normaliseAttributeValue(name: string, value: string): string {
  if (name === "style:family") {
    return value === OOO1_GRAPHIC_STYLE_FAMILY
      ? ODF_GRAPHIC_STYLE_FAMILY
      : value;
  }
  if (carriesNoLength(name)) {
    return value;
  }
  return value.replace(INCH_TOKEN, "$1$2in");
}

interface TransformContext {
  // Declared prefix to canonical prefix, for a document that bound the vocabularies to prefixes other than the conventional ones.
  readonly prefixes: ReadonlyMap<string, string>;
  // The office:class the part's root element declared, if any -- what office:body's genre element is built from.
  readonly documentClass: string | undefined;
  // Set only while transforming the children of a style container, naming the property families its style:properties splits into.
  readonly propertyTypes?: readonly Ooo1PropertyType[];
}

function renameQName(
  qname: string,
  prefixes: ReadonlyMap<string, string>,
): string {
  const colon = qname.indexOf(":");
  if (colon < 0) {
    return qname;
  }
  const canonical = prefixes.get(qname.slice(0, colon));
  return canonical === undefined
    ? qname
    : `${canonical}:${qname.slice(colon + 1)}`;
}

// Rewrites one xmlns declaration: the prefix it binds becomes the canonical one, and an OpenOffice.org URI becomes its OASIS successor. A declaration binding something neither vocabulary owns (the ooo:/ooow:/oooc: extension namespaces OpenOffice.org 1.1 already wrote, xforms:, xsd:, xsi:) is left exactly as it is -- those URIs are identical in ODF.
function transformNamespaceDeclaration(attribute: Attribute): Attribute {
  const canonical = CANONICAL_PREFIX_BY_URI.get(attribute.value);
  if (canonical === undefined || !isOdfNamespacePrefix(canonical)) {
    return attribute;
  }
  return {
    name: attribute.name === "xmlns" ? "xmlns" : `xmlns:${canonical}`,
    value: ODF_NAMESPACES[canonical],
  };
}

// The document roots that carry office:class. ODF has no attribute for the genre at all -- office:body's own child element names it instead (see buildBody) -- so the attribute is dropped here rather than carried through to quarantine as residue that means nothing on the ODF side.
const DOCUMENT_ROOT_ELEMENTS: ReadonlySet<string> = new Set([
  "office:document",
  "office:document-content",
  "office:document-styles",
  "office:document-meta",
  "office:document-settings",
]);

function transformAttributes(
  element: XmlElement,
  tag: string,
  prefixes: ReadonlyMap<string, string>,
): Attribute[] {
  const out: Attribute[] = [];
  for (const attribute of element.attributes) {
    if (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) {
      out.push(transformNamespaceDeclaration(attribute));
      continue;
    }
    const name = renameQName(attribute.name, prefixes);
    if (name === "office:class" && DOCUMENT_ROOT_ELEMENTS.has(tag)) {
      continue;
    }
    const value = normaliseAttributeValue(name, attribute.value);
    out.push({
      name: renameAttributeFor(tag, name),
      value: rewriteHref(tag, name, value),
    });
  }
  return out;
}

function renameAttributeFor(tag: string, name: string): string {
  const renamed = RENAMED_ATTRIBUTES.get(name);
  if (renamed !== undefined) {
    return renamed;
  }
  // A heading's (and, in OpenOffice.org 1.x, a paragraph's) nesting depth became text:outline-level. text:level itself survived into ODF on the list-level and outline-level style elements, so the rename is scoped to the two elements that changed.
  if (name === "text:level" && (tag === "text:h" || tag === "text:p")) {
    return "text:outline-level";
  }
  if (CELL_ELEMENTS.has(tag)) {
    if (name === "table:validation-name") {
      return "table:content-validation-name";
    }
    for (const local of VALUE_ATTRIBUTE_LOCAL_NAMES) {
      if (name === `table:${local}`) {
        return `office:${local}`;
      }
    }
  }
  if (TEXT_VALUE_ELEMENTS.has(tag)) {
    for (const local of VALUE_ATTRIBUTE_LOCAL_NAMES) {
      if (name === `text:${local}`) {
        return `office:${local}`;
      }
    }
  }
  // A multi-column layout's per-column spacing became the indent pair, because ODF gives style:column its own property vocabulary rather than reusing the paragraph margins.
  if (tag === "style:column") {
    if (name === "fo:margin-left") {
      return "fo:start-indent";
    }
    if (name === "fo:margin-right") {
      return "fo:end-indent";
    }
  }
  return name;
}

function rewriteHref(tag: string, name: string, value: string): string {
  if (
    name === "xlink:href" &&
    value.startsWith("#") &&
    PACKAGE_HREF_ELEMENTS.has(tag)
  ) {
    return value.slice(1);
  }
  return value;
}

function withoutAttributes(
  attributes: readonly Attribute[],
  drop: ReadonlySet<string>,
): Attribute[] {
  return attributes.filter((attribute) => !drop.has(attribute.name));
}

function element(
  tag: string,
  attributes: Attribute[],
  children: XmlNode[],
): XmlElement {
  return { type: "element", tag, attributes, children };
}

function textElement(tag: string, value: string): XmlElement {
  return element(tag, [], [{ type: "text", value }]);
}

// Attributes ODF moved out of office:annotation and office:change-info into child elements of their own, in the order ODF's own schema puts them.
const MOVED_TO_CHILD_ELEMENT: ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> = new Map([
  [
    "office:annotation",
    new Map([
      ["office:author", "dc:creator"],
      ["office:create-date", "dc:date"],
      ["office:create-date-string", "meta:date-string"],
    ]),
  ],
  [
    "office:change-info",
    new Map([
      ["office:chg-author", "dc:creator"],
      ["office:chg-date-time", "dc:date"],
    ]),
  ],
]);

function transformNodes(
  nodes: readonly XmlNode[],
  context: TransformContext,
): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    if (node.type !== "element") {
      out.push(node);
      continue;
    }
    out.push(...transformElement(node, context));
  }
  return out;
}

function transformElement(
  source: XmlElement,
  context: TransformContext,
): XmlNode[] {
  const renamedTag = renameQName(source.tag, context.prefixes);

  // A style:properties is the one element whose transformation depends on where it sits: its container's family decides which typed properties elements it becomes.
  if (renamedTag === "style:properties") {
    const staged = element(
      renamedTag,
      transformAttributes(source, renamedTag, context.prefixes),
      transformNodes(source.children, { ...context, propertyTypes: undefined }),
    );
    if (context.propertyTypes === undefined) {
      // A container this codec does not classify: leaving the element unsplit keeps the formatting in the tree (where it quarantines as residue) rather than filing it under a guessed family.
      return [staged];
    }
    return splitStyleProperties(staged, context.propertyTypes);
  }

  // meta:keywords was a wrapper ODF removed, promoting each meta:keyword to a direct child of office:meta.
  if (renamedTag === "meta:keywords") {
    return transformNodes(source.children, {
      ...context,
      propertyTypes: undefined,
    });
  }

  const attributes = transformAttributes(source, renamedTag, context.prefixes);
  const childContext: TransformContext = {
    ...context,
    // Whether this element classifies a style:properties directly inside it, and into which property families -- resolved from the already-transformed tag and attributes so the classification sees the same style:family value the output carries.
    propertyTypes: propertyTypesForContainer({
      ...source,
      tag: renamedTag,
      attributes,
    }),
  };
  const children = transformNodes(source.children, childContext);

  if (renamedTag === "office:body") {
    return [buildBody(attributes, children, context.documentClass)];
  }

  const note = NOTE_ELEMENTS.get(renamedTag);
  if (note !== undefined) {
    return [
      element(
        note.tag,
        [...attributes, { name: "text:note-class", value: note.noteClass }],
        children,
      ),
    ];
  }

  if (renamedTag === "table:sub-table") {
    return [
      element(
        "table:table",
        [...attributes, { name: "table:is-sub-table", value: "true" }],
        children,
      ),
    ];
  }

  if (renamedTag === "style:font-decl") {
    return [
      element(
        "style:font-face",
        attributes.map((attribute) => {
          if (attribute.name === "fo:font-family") {
            return { name: "svg:font-family", value: attribute.value };
          }
          if (attribute.name === "style:font-style-name") {
            return { name: "style:font-adornments", value: attribute.value };
          }
          return attribute;
        }),
        children,
      ),
    ];
  }

  const moved = MOVED_TO_CHILD_ELEMENT.get(renamedTag);
  if (moved !== undefined) {
    const promoted: XmlNode[] = [];
    for (const [from, to] of moved) {
      const value = attributes.find(
        (attribute) => attribute.name === from,
      )?.value;
      if (value !== undefined) {
        promoted.push(textElement(to, value));
      }
    }
    return [
      element(
        renamedTag,
        withoutAttributes(attributes, new Set(moved.keys())),
        [...promoted, ...children],
      ),
    ];
  }

  if (FRAME_SHAPES.has(renamedTag)) {
    return [buildFrame(renamedTag, attributes, children)];
  }

  if (renamedTag === "form:property") {
    // ODF replaced the boolean form:property-is-list with a separate form:list-property element; the flag itself has no ODF spelling, and the readers that consume a property bag look at office:value-type instead.
    return [
      element(
        renamedTag,
        withoutAttributes(attributes, new Set(["form:property-is-list"])),
        children,
      ),
    ];
  }

  const renamed = RENAMED_ELEMENTS.get(renamedTag);
  if (renamed !== undefined) {
    return [element(renamed, attributes, children)];
  }

  return [element(renamedTag, attributes, children)];
}

// office:body's children move inside the genre element ODF introduced. Without an office:class to name the genre there is nothing to build, so the body is left as it was rather than being wrapped in a guessed one.
function buildBody(
  attributes: Attribute[],
  children: XmlNode[],
  documentClass: string | undefined,
): XmlElement {
  const genre =
    documentClass === undefined
      ? undefined
      : GENRE_ELEMENT_BY_CLASS.get(documentClass);
  if (genre === undefined) {
    return element("office:body", attributes, children);
  }
  return element("office:body", attributes, [element(genre, [], children)]);
}

// A bare OpenOffice.org 1.x shape becomes ODF's draw:frame wrapping the same element: the frame takes the placement, size, anchoring and style, and the shape keeps whatever identifies its content. The frame-level child elements (an image map, a contour, a description) belong to the frame in ODF too.
function buildFrame(
  tag: string,
  attributes: Attribute[],
  children: XmlNode[],
): XmlElement {
  const frameAttributes = attributes.filter((attribute) =>
    FRAME_ATTRIBUTES.has(attribute.name),
  );
  const shapeAttributes = attributes.filter(
    (attribute) => !FRAME_ATTRIBUTES.has(attribute.name),
  );
  const frameChildren: XmlNode[] = [];
  const shapeChildren: XmlNode[] = [];
  for (const child of children) {
    if (child.type === "element" && FRAME_CHILD_ELEMENTS.has(child.tag)) {
      frameChildren.push(child);
    } else {
      shapeChildren.push(child);
    }
  }
  return element("draw:frame", frameAttributes, [
    element(tag, shapeAttributes, shapeChildren),
    ...frameChildren,
  ]);
}

// The prefix renames a part needs: every xmlns declaration on its root element whose URI either vocabulary owns, mapped from the prefix the document chose to the canonical one this package's readers match on.
function prefixRenames(root: XmlElement): Map<string, string> {
  const renames = new Map<string, string>();
  for (const attribute of root.attributes) {
    if (!attribute.name.startsWith("xmlns:")) {
      continue;
    }
    const declared = attribute.name.slice("xmlns:".length);
    const canonical = CANONICAL_PREFIX_BY_URI.get(attribute.value);
    if (canonical !== undefined && canonical !== declared) {
      renames.set(declared, canonical);
    }
  }
  return renames;
}

function transformXmlPart(nodes: readonly XmlNode[]): XmlNode[] {
  const root = rootElement(nodes);
  if (root === undefined) {
    return [...nodes];
  }
  const prefixes = prefixRenames(root);
  const classAttributeName = [...prefixes.entries()].find(
    ([, canonical]) => canonical === "office",
  )?.[0];
  const documentClass = root.attributes.find(
    (attribute) =>
      attribute.name === "office:class" ||
      (classAttributeName !== undefined &&
        attribute.name === `${classAttributeName}:class`),
  )?.value;
  const context: TransformContext = { prefixes, documentClass };
  return transformNodes(nodes, context);
}

const MANIFEST_PATH = "META-INF/manifest.xml";
const MIMETYPE_PATH = "mimetype";

// The media type the package's own manifest declares for its root entry, translated to the OASIS successor -- the one place an OpenOffice.org 1.x package records what kind of document it is.
function odfMediaTypeOf(pkg: Package): string | undefined {
  const manifest = pkg.parts[MANIFEST_PATH];
  if (manifest?.kind !== "xml") {
    return undefined;
  }
  const root = rootElement(manifest.nodes);
  if (root === undefined) {
    return undefined;
  }
  for (const entry of root.children) {
    if (entry.type !== "element" || !entry.tag.endsWith(":file-entry")) {
      continue;
    }
    const path = entry.attributes.find((attribute) =>
      attribute.name.endsWith(":full-path"),
    )?.value;
    if (path !== "/") {
      continue;
    }
    const mediaType = entry.attributes.find((attribute) =>
      attribute.name.endsWith(":media-type"),
    )?.value;
    return mediaType === undefined
      ? undefined
      : odfMediaTypeForOoo1MediaType(mediaType);
  }
  return undefined;
}

function rewriteManifestMediaType(
  nodes: readonly XmlNode[],
  odfMediaType: string,
): XmlNode[] {
  return nodes.map((node) => {
    if (node.type !== "element") {
      return node;
    }
    return {
      ...node,
      children: node.children.map((entry) => {
        if (entry.type !== "element" || entry.tag !== "manifest:file-entry") {
          return entry;
        }
        if (
          entry.attributes.find(
            (attribute) => attribute.name === "manifest:full-path",
          )?.value !== "/"
        ) {
          return entry;
        }
        return {
          ...entry,
          attributes: entry.attributes.map((attribute) =>
            attribute.name === "manifest:media-type"
              ? { name: attribute.name, value: odfMediaType }
              : attribute,
          ),
        };
      }),
    };
  });
}

// An OpenOffice.org 1.x package into the ODF-shaped one this package's readers consume. A package that is not OpenOffice.org 1.x is returned exactly as given, so a caller may run this unconditionally over anything it is handed.
export function transformOoo1Package(pkg: Package): Package {
  if (!isOoo1Package(pkg)) {
    return pkg;
  }
  const odfMediaType = odfMediaTypeOf(pkg);
  const parts: Record<string, Part> = {};
  for (const [path, part] of Object.entries(pkg.parts)) {
    if (part.kind !== "xml") {
      parts[path] = part;
      continue;
    }
    const nodes = transformXmlPart(part.nodes);
    parts[path] =
      path === MANIFEST_PATH && odfMediaType !== undefined
        ? { kind: "xml", nodes: rewriteManifestMediaType(nodes, odfMediaType) }
        : { kind: "xml", nodes };
  }
  if (odfMediaType !== undefined && parts[MIMETYPE_PATH] === undefined) {
    // ODF's own package-identity part, which OpenOffice.org 1.x never wrote. Synthesised so the result is a coherent ODF package rather than one whose manifest and mimetype disagree by omission.
    parts[MIMETYPE_PATH] = {
      kind: "binary",
      base64: bytesToBase64(new TextEncoder().encode(odfMediaType)),
    };
  }
  return { parts };
}

// =====================================================================================================================
// THE REVERSE DIRECTION: an ODF-shaped Package -> genuine OpenOffice.org 1.x XML.
//
// The exact inverse of every rule above, reversing each rename/restructure by name against the same LibreOffice transformer source (xmloff/source/transform/OOo2Oasis.cxx, StyleOOoTContext.cxx) and OpenOffice.org DTD the forward direction is grounded against -- transformToOoo1Package is what typed/odt/write.ts's writeOdt or typed/ods/write.ts's writeOds produces run backwards through this module, and ../write.ts's writeSxw/writeSxc are what actually call it, one per ODF-native writer this package has. As with the forward direction's own module comment, this deliberately does NOT claim to be a general ODF-to-OpenOffice.org converter: it targets the shape this package's own typed writers (writeOdt, writeOds today) produce, not arbitrary real-world ODF. Every rule below is still a genuine, unconditional structural inverse of its forward counterpart, not a special case carved out for one writer's own output alone -- the narrowing is in what a real writer here can ever HAND it (no fidelity constructs, no embedded objects, no chart/presentation-only constructs), not in how faithfully each rule itself is reversed, and nothing in this module is odt- or ods-specific -- it is media-type-agnostic, which is exactly what let writeSxc reuse it with no changes of its own.
//
// Three rules need something the forward direction never did: PACKAGE-WIDE context.
//   - The document's own office:class (buildBody's inverse) is derivable only from content.xml's own office:body --
// styles.xml and meta.xml carry no genre information of their own, so their own office:class is filled in from content.xml's, exactly mirroring how a real OpenOffice.org 1.x package stamps the identical office:class on every one of a document's own parts.
//   - A text:list's ordered-vs-bullet split (RENAMED_ELEMENTS' one many-to-one collapse this reverses) requires
// resolving the list's own referenced text:list-style, which may live in EITHER content.xml or styles.xml -- typed/shared/list.ts's own resolveOdfListKind already does exactly this resolution for the read direction, so it is reused verbatim here rather than re-implemented, run against the ORIGINAL (pre-reverse-transform) package, since none of the elements/attributes that resolution inspects (text:list-style, text:level, text:list-level-style-number/-bullet, style:name) are renamed by this module in either direction.
//   - The package's own ODF media type (read off the "mimetype" part this reverse direction is about to delete)
//     decides which OpenOffice.org 1.x media type the manifest's root entry gets rewritten to.
// =====================================================================================================================

// The genre element ODF's office:body takes for each office:class value, inverted: office:text -> "text" (never "text-global" -- the OTHER office:class value the forward direction's own GENRE_ELEMENT_BY_CLASS collapses onto office:text, naming a master document, which no writer in this package produces yet, so "text" is the only direction this inversion can honestly resolve).
const CLASS_BY_GENRE_ELEMENT: ReadonlyMap<string, string> = new Map([
  ["office:text", "text"],
  ["office:spreadsheet", "spreadsheet"],
  ["office:presentation", "presentation"],
  ["office:drawing", "drawing"],
  ["office:chart", "chart"],
]);

// Simple, unambiguous element renames reversed by a straight lookup -- every RENAMED_ELEMENTS target EXCEPT the three whose forward mapping is many-to-one (text:list, from text:ordered-list AND text:unordered-list; text:note-body and text:note-citation, each from a footnote/endnote pair), which cannot be inverted by name alone and are handled below through the same context (a resolved list kind, an enclosing note's own class) their forward siblings in NOTE_ELEMENTS already need for the identical reason.
const REVERSE_RENAMED_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ["office:font-face-decls", "office:font-decls"],
  ["office:scripts", "office:script"],
  ["office:script", "office:script-data"],
  ["office:event-listeners", "office:events"],
  ["style:page-layout", "style:page-master"],
  ["text:tab", "text:tab-stop"],
  ["text:database-row-select", "text:database-select"],
  ["text:index-entry-chapter", "text:index-entry-chapter-number"],
  ["table:dependencies", "table:dependences"],
  ["table:dependency", "table:dependence"],
]);

// The text:note/text:note-ref/text:notes-configuration family's own reverse: each carries its own text:note-class attribute (added by the forward NOTE_ELEMENTS mapping), so -- unlike text:note-body/text:note-citation below -- this one needs no threaded context at all, just the element's own attribute. Defaults to "footnote" for a malformed/absent class, matching this package's general degrade-gracefully reading posture applied to writing.
function reverseNoteTag(
  tag: string,
  noteClass: string | undefined,
): string | undefined {
  const isEndnote = noteClass === "endnote";
  if (tag === "text:note") {
    return isEndnote ? "text:endnote" : "text:footnote";
  }
  if (tag === "text:note-ref") {
    return isEndnote ? "text:endnote-ref" : "text:footnote-ref";
  }
  if (tag === "text:notes-configuration") {
    return isEndnote
      ? "text:endnotes-configuration"
      : "text:footnotes-configuration";
  }
  return undefined;
}

// text:note-body and text:note-citation carry no note-class of their own in ODF -- only their ENCLOSING text:note does -- so reversing them needs the class threaded down through the recursion from the text:note that contains them (ReverseTransformContext.noteClass, set exactly once, the moment a text:note element is entered).
function reverseNoteBodyOrCitation(
  tag: string,
  noteClass: "footnote" | "endnote" | undefined,
): string | undefined {
  const isEndnote = noteClass === "endnote";
  if (tag === "text:note-body") {
    return isEndnote ? "text:endnote-body" : "text:footnote-body";
  }
  if (tag === "text:note-citation") {
    return isEndnote ? "text:endnote-citation" : "text:footnote-citation";
  }
  return undefined;
}

// A length written in ODF's "in" unit, reversed to OpenOffice.org 1.x's own "inch" spelling -- the exact inverse of INCH_TOKEN above, matched the same way (a whole whitespace-delimited token, so a compound value like a border shorthand keeps its structure).
const PT_IN_TOKEN = /(^|\s)(-?(?:\d+(?:\.\d+)?|\.\d+))in(?=\s|$)/g;

function reverseAttributeValue(name: string, value: string): string {
  if (name === "style:family") {
    // normaliseAttributeValue's own inverse -- see its note for why the drawing family alone needs one, and what a real consumer does with a package that skips it.
    return value === ODF_GRAPHIC_STYLE_FAMILY
      ? OOO1_GRAPHIC_STYLE_FAMILY
      : value;
  }
  if (name === "fo:keep-with-next") {
    // ODF's keyword enumeration, reversed to OpenOffice.org 1.x's own boolean; any other value (a genuinely different producer's own writing, outside what this direction's forward half ever emits) passes through unchanged rather than being guessed at.
    if (value === "always") {
      return "true";
    }
    if (value === "auto") {
      return "false";
    }
    return value;
  }
  if (carriesNoLength(name)) {
    return value;
  }
  return value.replace(PT_IN_TOKEN, "$1$2inch");
}

// The reverse of rewriteHref: a package-internal xlink:href on one of PACKAGE_HREF_ELEMENTS is a bare part path in ODF (no scheme, no leading "#") and gets the "#" OpenOffice.org 1.x prefixed it with back. A genuine external URL (carrying "://") or a value that already starts with "#" is left exactly as it is.
function reverseRewriteHref(tag: string, name: string, value: string): string {
  if (
    name === "xlink:href" &&
    PACKAGE_HREF_ELEMENTS.has(tag) &&
    !value.startsWith("#") &&
    !value.includes("://")
  ) {
    return `#${value}`;
  }
  return value;
}

// RENAMED_ATTRIBUTES reversed by explicit name -- not an auto-inverted map, because one of its six entries (office:value-type) is ALSO independently produced by the element-scoped VALUE_ATTRIBUTE_LOCAL_NAMES rewrite below (from table:value-type/text:value-type), so a blind inversion would be ambiguous; the tag-scoped checks below resolve that ambiguity, mirroring renameAttributeFor's own tag-then-name dispatch structure exactly, just in the opposite order (the scoped checks run first here because they are the ones that can fire on a name the blanket reversal below would otherwise mis-resolve).
function reverseRenamedAttributeName(
  tag: string,
  name: string,
): string | undefined {
  switch (name) {
    case "style:page-layout-name":
      return "style:page-master-name";
    case "style:leader-text":
      return "style:leader-char";
    case "text:count-in-text-boxes":
      return "text:count-in-floating-frames";
    case "form:control-implementation":
      return "form:service-name";
    case "form:text-style-name":
      return "form:column-style-name";
    case "office:value-type":
      return tag === "form:property" ? "form:property-type" : undefined;
    default:
      return undefined;
  }
}

function reverseAttributeNameFor(tag: string, name: string): string {
  if (tag === "text:h" && name === "text:outline-level") {
    return "text:level";
  }
  if (CELL_ELEMENTS.has(tag)) {
    if (name === "table:content-validation-name") {
      return "table:validation-name";
    }
    for (const local of VALUE_ATTRIBUTE_LOCAL_NAMES) {
      if (name === `office:${local}`) {
        return `table:${local}`;
      }
    }
  }
  if (TEXT_VALUE_ELEMENTS.has(tag)) {
    for (const local of VALUE_ATTRIBUTE_LOCAL_NAMES) {
      if (name === `office:${local}`) {
        return `text:${local}`;
      }
    }
  }
  if (tag === "style:column") {
    if (name === "fo:start-indent") {
      return "fo:margin-left";
    }
    if (name === "fo:end-indent") {
      return "fo:margin-right";
    }
  }
  return reverseRenamedAttributeName(tag, name) ?? name;
}

// The reverse of transformNamespaceDeclaration: an ODF (or already-OpenOffice.org) URI's canonical prefix decides the OpenOffice.org 1.x URI to bind it to. A prefix with no OpenOffice.org 1.x counterpart at all (smil:/anim:/xforms:/ db:/rpt:, ODF namespaces this format predates) is left exactly as it is -- the same "neither vocabulary owns this" case the forward direction's own comment describes, just approached from the other side.
function transformNamespaceDeclarationToOoo1(attribute: Attribute): Attribute {
  const canonical = CANONICAL_PREFIX_BY_URI.get(attribute.value);
  if (canonical === undefined || !isOoo1NamespacePrefix(canonical)) {
    return attribute;
  }
  return {
    name: attribute.name === "xmlns" ? "xmlns" : `xmlns:${canonical}`,
    value: OOO1_NAMESPACES[canonical],
  };
}

function reverseTransformAttributes(
  element: XmlElement,
  tag: string,
  prefixes: ReadonlyMap<string, string>,
): Attribute[] {
  const out: Attribute[] = [];
  for (const attribute of element.attributes) {
    if (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) {
      out.push(transformNamespaceDeclarationToOoo1(attribute));
      continue;
    }
    const name = renameQName(attribute.name, prefixes);
    const value = reverseRewriteHref(
      tag,
      name,
      reverseAttributeValue(name, attribute.value),
    );
    out.push({ name: reverseAttributeNameFor(tag, name), value });
  }
  return out;
}

// Rewrites one <office:frame>'s draw:frame wrapper back to the bare shape OpenOffice.org 1.x wrote: buildFrame's exact inverse. Only fires when the frame's own children include one of FRAME_SHAPES -- a draw:frame wrapping anything else (a custom shape, a connector, any construct OpenOffice.org 1.x never wrapped this way at all) has no OpenOffice.org 1.x un-wrapped spelling and is left exactly as ODF wrote it. The frame's own attributes (all of which, on a well-formed draw:frame, are FRAME_ATTRIBUTES by construction -- that is the set's own definition) move onto the shape; the frame's other children (svg:title/svg:desc and the rest of FRAME_CHILD_ELEMENTS) become the shape's own trailing children, exactly where buildFrame took them from.
function unwrapFrame(
  frameAttributes: readonly Attribute[],
  frameChildren: readonly XmlNode[],
): XmlElement | undefined {
  let shape: XmlElement | undefined;
  const otherChildren: XmlNode[] = [];
  for (const child of frameChildren) {
    if (
      shape === undefined &&
      child.type === "element" &&
      FRAME_SHAPES.has(child.tag)
    ) {
      shape = child;
      continue;
    }
    otherChildren.push(child);
  }
  if (shape === undefined) {
    return undefined;
  }
  return element(
    shape.tag,
    [...shape.attributes, ...frameAttributes],
    [...shape.children, ...otherChildren],
  );
}

// Raw (still XML-entity-encoded, per this package's processEntities:false model) text content of an element with only text-node children -- exactly what MOVED_TO_CHILD_ELEMENT's dc:creator/dc:date/meta:date-string children carry, and copied verbatim into an attribute value below since both sides of that move use the identical raw encoding convention (see xml/entities.ts's own top-of-file note).
function elementRawText(el: XmlElement): string {
  let text = "";
  for (const child of el.children) {
    if (child.type === "text") {
      text += child.value;
    }
  }
  return text;
}

// The reverse of MOVED_TO_CHILD_ELEMENT: pulls office:annotation's/office:change-info's own dc:creator/dc:date/ meta:date-string children back out as attributes, in the order the forward direction's own promoted-child construction used (irrelevant to a reader either way, but matched for tidiness). A container tag with no MOVED_TO_CHILD_ELEMENT entry returns undefined, so the caller keeps every child untouched.
function reverseMovedChildren(
  tag: string,
  children: readonly XmlNode[],
): { readonly attributes: Attribute[]; readonly rest: XmlNode[] } | undefined {
  const moved = MOVED_TO_CHILD_ELEMENT.get(tag);
  if (moved === undefined) {
    return undefined;
  }
  const childTagToAttribute = new Map(
    [...moved.entries()].map(
      ([attributeName, childTag]) => [childTag, attributeName] as const,
    ),
  );
  const attributes: Attribute[] = [];
  const rest: XmlNode[] = [];
  for (const child of children) {
    const attributeName =
      child.type === "element" ? childTagToAttribute.get(child.tag) : undefined;
    if (attributeName !== undefined && child.type === "element") {
      attributes.push({ name: attributeName, value: elementRawText(child) });
      continue;
    }
    rest.push(child);
  }
  return { attributes, rest };
}

// meta:keywords was a wrapper ODF removed (see transformElement's own meta:keywords case); reversed here by re-wrapping every meta:keyword sibling office:meta carries into one meta:keywords element, positioned at the first keyword's own place among its siblings -- exactly the shape the forward direction unwraps. Safe to run unconditionally over any element's children (not scoped to office:meta specifically): meta:keyword has no legitimate ODF appearance anywhere else, so the check costs nothing when there is nothing to wrap.
function wrapMetaKeywords(nodes: readonly XmlNode[]): XmlNode[] {
  const keywords = nodes.filter(
    (node): node is XmlElement =>
      node.type === "element" && node.tag === "meta:keyword",
  );
  if (keywords.length === 0) {
    return [...nodes];
  }
  const out: XmlNode[] = [];
  let inserted = false;
  for (const node of nodes) {
    if (node.type === "element" && node.tag === "meta:keyword") {
      if (!inserted) {
        out.push({
          type: "element",
          tag: "meta:keywords",
          attributes: [],
          children: keywords,
        });
        inserted = true;
      }
      continue;
    }
    out.push(node);
  }
  return out;
}

// The two children-level cleanups every element's already-reverse-transformed children pass through, regardless of what element they sit inside: ODF's typed style:*-properties family collapses back to one style:properties (mergeStyleProperties, properties.ts), and any meta:keyword run re-wraps into meta:keywords. Both are context-free membership tests over a closed, ODF-only tag set (see each function's own note), so applying them unconditionally to every element's children costs nothing on an element that has neither.
function finaliseReversedChildren(nodes: readonly XmlNode[]): XmlNode[] {
  const { merged, rest } = mergeStyleProperties(nodes);
  const withMergedProperties = merged === undefined ? rest : [merged, ...rest];
  return wrapMetaKeywords(withMergedProperties);
}

interface ReverseTransformContext {
  // Declared-prefix -> canonical-prefix, computed once per part exactly as the forward direction's own transformXmlPart does (prefixRenames is direction-agnostic: it canonicalises whichever prefix a document bound a known URI to, regardless of which vocabulary that URI belongs to).
  readonly prefixes: ReadonlyMap<string, string>;
  // The office:class value every DOCUMENT_ROOT_ELEMENTS root in this package gets stamped with, resolved once from content.xml's own genre element (see documentClassOf) and threaded into every part's own transform -- styles.xml and meta.xml carry no genre information of their own to derive it from.
  readonly documentClass: string | undefined;
  // The ORIGINAL, pre-reverse-transform package, threaded through for resolveOdfListKind's own cross-part style lookup alone (see this section's own top-of-file note on why list-kind resolution needs package-wide context).
  readonly pkg: Package;
  // Set only while transforming a text:note's own children, naming which note family text:note-body/text:note-citation (which carry no class of their own) belong to.
  readonly noteClass?: "footnote" | "endnote";
  // The ordered/bullet kind resolved for the nearest enclosing text:list that DID carry a resolvable text:style-name, inherited by a nested text:list that -- like every nested list this package's own writeOdfList produces -- has no text:style-name of its own to resolve.
  readonly listKind?: "ordered" | "bullet";
}

function reverseTransformNodes(
  nodes: readonly XmlNode[],
  context: ReverseTransformContext,
): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    if (node.type !== "element") {
      out.push(node);
      continue;
    }
    out.push(...reverseTransformElement(node, context));
  }
  return out;
}

function reverseListKind(
  source: XmlElement,
  context: ReverseTransformContext,
): "ordered" | "bullet" | undefined {
  return (
    resolveOdfListKind(context.pkg, attrValue(source, "text:style-name")) ??
    context.listKind
  );
}

function reverseTransformElement(
  source: XmlElement,
  context: ReverseTransformContext,
): XmlNode[] {
  const renamedTag = renameQName(source.tag, context.prefixes);
  const attributes = reverseTransformAttributes(
    source,
    renamedTag,
    context.prefixes,
  );

  // office:body's genre child (buildBody's own construction) unwraps: recursing into the GENRE element's children rather than office:body's own single child reproduces the flat body OpenOffice.org 1.x wrote.
  const genreChild =
    renamedTag === "office:body"
      ? source.children.find(
          (child): child is XmlElement => child.type === "element",
        )
      : undefined;
  const recurseInto =
    genreChild !== undefined && CLASS_BY_GENRE_ELEMENT.has(genreChild.tag)
      ? genreChild.children
      : source.children;

  let childContext = context;
  if (renamedTag === "text:note") {
    childContext = {
      ...context,
      noteClass:
        attrValue(source, "text:note-class") === "endnote"
          ? "endnote"
          : "footnote",
    };
  } else if (renamedTag === "text:list") {
    childContext = { ...context, listKind: reverseListKind(source, context) };
  }

  const children = finaliseReversedChildren(
    reverseTransformNodes(recurseInto, childContext),
  );

  if (renamedTag === "office:body") {
    return [element("office:body", attributes, children)];
  }

  if (renamedTag === "draw:frame") {
    return [
      unwrapFrame(attributes, children) ??
        element(renamedTag, attributes, children),
    ];
  }

  if (
    renamedTag === "text:note" ||
    renamedTag === "text:note-ref" ||
    renamedTag === "text:notes-configuration"
  ) {
    const noteClassRaw = attrValue(source, "text:note-class");
    const withoutClass = attributes.filter(
      (attribute) => attribute.name !== "text:note-class",
    );
    const tag = reverseNoteTag(renamedTag, noteClassRaw) ?? renamedTag;
    return [element(tag, withoutClass, children)];
  }

  if (renamedTag === "text:note-body" || renamedTag === "text:note-citation") {
    const tag =
      reverseNoteBodyOrCitation(renamedTag, context.noteClass) ?? renamedTag;
    return [element(tag, attributes, children)];
  }

  if (
    renamedTag === "table:table" &&
    attrValue(source, "table:is-sub-table") === "true"
  ) {
    const withoutFlag = attributes.filter(
      (attribute) => attribute.name !== "table:is-sub-table",
    );
    return [element("table:sub-table", withoutFlag, children)];
  }

  if (renamedTag === "style:font-face") {
    const reversed = attributes.map((attribute) => {
      if (attribute.name === "svg:font-family") {
        return { name: "fo:font-family", value: attribute.value };
      }
      if (attribute.name === "style:font-adornments") {
        return { name: "style:font-style-name", value: attribute.value };
      }
      return attribute;
    });
    return [element("style:font-decl", reversed, children)];
  }

  const movedBack = reverseMovedChildren(renamedTag, children);
  if (movedBack !== undefined) {
    return [
      element(
        renamedTag,
        [...attributes, ...movedBack.attributes],
        movedBack.rest,
      ),
    ];
  }

  if (renamedTag === "text:list") {
    const kind = reverseListKind(source, context);
    const tag =
      kind === "ordered"
        ? "text:ordered-list"
        : kind === "bullet"
          ? "text:unordered-list"
          : renamedTag;
    return [element(tag, attributes, children)];
  }

  const tag = REVERSE_RENAMED_ELEMENTS.get(renamedTag) ?? renamedTag;
  const finalAttributes =
    DOCUMENT_ROOT_ELEMENTS.has(tag) && context.documentClass !== undefined
      ? [...attributes, { name: "office:class", value: context.documentClass }]
      : attributes;
  return [element(tag, finalAttributes, children)];
}

const CONTENT_XML_PATH = "content.xml";

// The office:class every part of this package will be stamped with, resolved from content.xml's own office:body: the genre element (office:text and its siblings) office:body's single child is, per buildBody's own construction. undefined when content.xml is missing or carries no recognisable genre -- a caller that hands this function something other than a genuine writeOdt/writeOds/writeOdp/writeOdg package gets an honestly undecorated result rather than a guessed office:class.
function documentClassOf(pkg: Package): string | undefined {
  const content = pkg.parts[CONTENT_XML_PATH];
  if (content?.kind !== "xml") {
    return undefined;
  }
  const root = rootElement(content.nodes);
  const body =
    root === undefined
      ? undefined
      : findChildElement(root.children, "office:body");
  const genre = body?.children.find(
    (child): child is XmlElement => child.type === "element",
  );
  return genre === undefined
    ? undefined
    : CLASS_BY_GENRE_ELEMENT.get(genre.tag);
}

function reverseTransformXmlPart(
  nodes: readonly XmlNode[],
  context: {
    readonly pkg: Package;
    readonly documentClass: string | undefined;
  },
): XmlNode[] {
  const root = rootElement(nodes);
  if (root === undefined) {
    return [...nodes];
  }
  const prefixes = prefixRenames(root);
  return reverseTransformNodes(nodes, { prefixes, ...context });
}

// The reverse of rewriteManifestMediaType: the manifest's root ("/") entry's media type becomes the OpenOffice.org 1.x media type this package's own ODF media type came from.
function rewriteManifestToOoo1(
  nodes: readonly XmlNode[],
  ooo1MediaType: string,
): XmlNode[] {
  return nodes.map((node) => {
    if (node.type !== "element") {
      return node;
    }
    return {
      ...node,
      children: node.children.map((entry) => {
        if (entry.type !== "element" || entry.tag !== "manifest:file-entry") {
          return entry;
        }
        if (
          entry.attributes.find(
            (attribute) => attribute.name === "manifest:full-path",
          )?.value !== "/"
        ) {
          return entry;
        }
        return {
          ...entry,
          attributes: entry.attributes.map((attribute) =>
            attribute.name === "manifest:media-type"
              ? { name: attribute.name, value: ooo1MediaType }
              : attribute,
          ),
        };
      }),
    };
  });
}

// An ODF-shaped Package (the output of writeOdt/writeOdtContent, writeOds/writeOdsContent, writeOdp/writeOdpContent, or writeOdg/writeOdgContent) into genuine OpenOffice.org 1.x XML: the whole of this direction's own support for a real .sxw/.sxc/.sxi/.sxd writer, and the counterpart ../write.ts's writeSxw/writeSxc/writeSxi/writeSxd all call. A package whose "mimetype" part names an ODF media type with no OpenOffice.org 1.x predecessor (or one with no "mimetype" part at all -- already OpenOffice.org 1.x-shaped, or not a document this module can identify) is returned exactly as given, mirroring transformOoo1Package's own "not applicable, leave alone" stance on the read side.
export function transformToOoo1Package(pkg: Package): Package {
  const odfMediaType = readMimetype(pkg);
  if (odfMediaType === undefined) {
    return pkg;
  }
  const ooo1MediaType = ooo1MediaTypeForOdfMediaType(odfMediaType);
  if (ooo1MediaType === undefined) {
    return pkg;
  }

  const documentClass = documentClassOf(pkg);
  const parts: Record<string, Part> = {};
  for (const [path, part] of Object.entries(pkg.parts)) {
    if (path === MIMETYPE_PATH) {
      // OpenOffice.org 1.x packages have no "mimetype" part at all -- the manifest's own root entry, rewritten below, is the only record of the document's type (see ../ns.ts's own note on this asymmetry).
      continue;
    }
    if (part.kind !== "xml") {
      parts[path] = part;
      continue;
    }
    const nodes = reverseTransformXmlPart(part.nodes, { pkg, documentClass });
    parts[path] =
      path === MANIFEST_PATH
        ? { kind: "xml", nodes: rewriteManifestToOoo1(nodes, ooo1MediaType) }
        : { kind: "xml", nodes };
  }
  return { parts };
}

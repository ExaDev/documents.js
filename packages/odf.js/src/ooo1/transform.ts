import type { Attribute, XmlElement, XmlNode } from "../model/node";
import type { Package, Part } from "../model/package";
import { rootElement } from "../xml/query";
import { bytesToBase64 } from "../util/base64";
import { ODF_NAMESPACES } from "../ns";
import {
  OOO1_NAMESPACES,
  isOoo1Package,
  odfMediaTypeForOoo1MediaType,
} from "./ns";
import {
  propertyTypesForContainer,
  splitStyleProperties,
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
//   - Values: lengths written in "inch" become "in", a cell's table:value-* attributes become office:value-*, and the compound style:text-underline/style:text-crossing-out attributes become ODF's style/type/width triples.
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

// Attributes whose value is a name the user chose, where an "inch"-shaped token would be text rather than a measurement. No ODF length attribute's local name ends in "name", so this guard costs nothing and removes the only way the substitution above could corrupt real content.
function isNameValuedAttribute(name: string): boolean {
  return name.endsWith("name") || name === "xlink:href";
}

function normaliseAttributeValue(name: string, value: string): string {
  if (isNameValuedAttribute(name)) {
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

  const childContext: TransformContext = {
    ...context,
    propertyTypes: propertyTypesForContainer({
      ...source,
      tag: renamedTag,
      attributes: transformAttributes(source, renamedTag, context.prefixes),
    }),
  };
  const children = transformNodes(source.children, childContext);
  const attributes = transformAttributes(source, renamedTag, context.prefixes);

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
  return transformNodes(nodes, context).map((node) => {
    if (node.type !== "element") {
      return node;
    }
    // office:class named the genre, which office:body now carries as an element; ODF has no attribute for it.
    return {
      ...node,
      attributes: withoutAttributes(node.attributes, new Set(["office:class"])),
    };
  });
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

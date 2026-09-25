// The reverse direction of the OpenOffice.org 1.x transform, split from transform.ts: an ODF-shaped Package produced by this package's own typed writers, rewritten into genuine OpenOffice.org 1.x XML. The forward direction (transform.ts) keeps the rename tables and the ooo1-to-ODF walk; this module inverts each of those rules by name, importing the shared tables back from it (safe in ESM: every cross-binding use sits inside a hoisted function declaration).
//
import type { Attribute, XmlElement, XmlNode } from "../model/node";
import type { Package, Part } from "../model/package";
import { rootElement, attrValue } from "../xml/query";
import { readMimetype } from "../mimetype";
import { resolveOdfListKind } from "../typed/shared/list";
// The forward direction's rename tables and helpers live in transform.ts; importing them back is safe because every cross-binding use sits inside a hoisted function declaration.
import {
  CANONICAL_PREFIX_BY_URI,
  CELL_ELEMENTS,
  DOCUMENT_ROOT_ELEMENTS,
  FRAME_SHAPES,
  MANIFEST_PATH,
  MIMETYPE_PATH,
  MOVED_TO_CHILD_ELEMENT,
  ODF_GRAPHIC_STYLE_FAMILY,
  OOO1_GRAPHIC_STYLE_FAMILY,
  PACKAGE_HREF_ELEMENTS,
  TEXT_VALUE_ELEMENTS,
  VALUE_ATTRIBUTE_LOCAL_NAMES,
  carriesNoLength,
  element,
  prefixRenames,
  renameQName,
} from "./transform";
import {
  OOO1_NAMESPACES,
  isOoo1NamespacePrefix,
  ooo1MediaTypeForOdfMediaType,
} from "./ns";
import { findChildElement } from "../xml/query";
import { mergeStyleProperties } from "./properties";

// =====================================================================================================================
// THE REVERSE DIRECTION: an ODF-shaped Package -> genuine OpenOffice.org 1.x XML.
//
// The exact inverse of every rule above, reversing each rename/restructure by name against the same LibreOffice transformer source (xmloff/source/transform/OOo2Oasis.cxx, StyleOOoTContext.cxx) and OpenOffice.org DTD the forward direction is grounded against — transformToOoo1Package is what typed/odt/write.ts's writeOdt or typed/ods/write.ts's writeOds produces run backwards through this module, and ../write.ts's writeSxw/writeSxc are what actually call it, one per ODF-native writer this package has. As with the forward direction's own module comment, this deliberately does NOT claim to be a general ODF-to-OpenOffice.org converter: it targets the shape this package's own typed writers (writeOdt, writeOds today) produce, not arbitrary real-world ODF. Every rule below is still a genuine, unconditional structural inverse of its forward counterpart, not a special case carved out for one writer's own output alone — the narrowing is in what a real writer here can ever HAND it (no fidelity constructs, no embedded objects, no chart/presentation-only constructs), not in how faithfully each rule itself is reversed, and nothing in this module is odt- or ods-specific — it is media-type-agnostic, which is exactly what let writeSxc reuse it with no changes of its own.
//
// Three rules need something the forward direction never did: PACKAGE-WIDE context.
//   - The document's own office:class (buildBody's inverse) is derivable only from content.xml's own office:body --
// styles.xml and meta.xml carry no genre information of their own, so their own office:class is filled in from content.xml's, exactly mirroring how a real OpenOffice.org 1.x package stamps the identical office:class on every one of a document's own parts.
//   - A text:list's ordered-vs-bullet split (RENAMED_ELEMENTS' one many-to-one collapse this reverses) requires
// resolving the list's own referenced text:list-style, which may live in EITHER content.xml or styles.xml — typed/shared/list.ts's own resolveOdfListKind already does exactly this resolution for the read direction, so it is reused verbatim here rather than re-implemented, run against the ORIGINAL (pre-reverse-transform) package, since none of the elements/attributes that resolution inspects (text:list-style, text:level, text:list-level-style-number/-bullet, style:name) are renamed by this module in either direction.
//   - The package's own ODF media type (read off the "mimetype" part this reverse direction is about to delete)
//     decides which OpenOffice.org 1.x media type the manifest's root entry gets rewritten to.
// =====================================================================================================================

// The genre element ODF's office:body takes for each office:class value, inverted: office:text -> "text" (never "text-global" — the OTHER office:class value the forward direction's own GENRE_ELEMENT_BY_CLASS collapses onto office:text, naming a master document, which no writer in this package produces yet, so "text" is the only direction this inversion can honestly resolve).
const CLASS_BY_GENRE_ELEMENT: ReadonlyMap<string, string> = new Map([
  ["office:text", "text"],
  ["office:spreadsheet", "spreadsheet"],
  ["office:presentation", "presentation"],
  ["office:drawing", "drawing"],
  ["office:chart", "chart"],
]);

// The first child that is both an element and a recognised genre tag — shared by reverseTransformElement's own office:body unwrap and documentClassOf below, the two places this package looks for office:body's genre child. A non-element child is never returned: CLASS_BY_GENRE_ELEMENT has no key for a non-element node's undefined tag, so the type check inside this one shared find() only ever needs proving once rather than twice.
function firstGenreElement(
  children: readonly XmlNode[],
): XmlElement | undefined {
  return children.find(
    (child): child is XmlElement =>
      child.type === "element" && CLASS_BY_GENRE_ELEMENT.has(child.tag),
  );
}

// Simple, unambiguous element renames reversed by a straight lookup — every RENAMED_ELEMENTS target EXCEPT the three whose forward mapping is many-to-one (text:list, from text:ordered-list AND text:unordered-list; text:note-body and text:note-citation, each from a footnote/endnote pair), which cannot be inverted by name alone and are handled below through the same context (a resolved list kind, an enclosing note's own class) their forward siblings in NOTE_ELEMENTS already need for the identical reason.
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

// The text:note/text:note-ref/text:notes-configuration family's own reverse: each carries its own text:note-class attribute (added by the forward NOTE_ELEMENTS mapping), so — unlike text:note-body/text:note-citation below — this one needs no threaded context at all, just the element's own attribute. Defaults to "footnote" for a malformed/absent class, matching this package's general degrade-gracefully reading posture applied to writing. Only ever called (see reverseTransformElement below) with tag already narrowed to one of the three checked below, so the last of them needs no guard of its own — by the time text:note and text:note-ref have both failed, tag can only be text:notes-configuration.
function reverseNoteTag(tag: string, noteClass: string | undefined): string {
  const isEndnote = noteClass === "endnote";
  if (tag === "text:note") {
    return isEndnote ? "text:endnote" : "text:footnote";
  }
  if (tag === "text:note-ref") {
    return isEndnote ? "text:endnote-ref" : "text:footnote-ref";
  }
  return isEndnote
    ? "text:endnotes-configuration"
    : "text:footnotes-configuration";
}

// text:note-body and text:note-citation carry no note-class of their own in ODF — only their ENCLOSING text:note does — so reversing them needs the class threaded down through the recursion from the text:note that contains them (ReverseTransformContext.noteClass, set exactly once, the moment a text:note element is entered). Only ever called (see reverseTransformElement below) with tag already narrowed to one of the two checked below, so the second needs no guard of its own — once text:note-body has failed, tag can only be text:note-citation.
function reverseNoteBodyOrCitation(
  tag: string,
  noteClass: "footnote" | "endnote" | undefined,
): string {
  const isEndnote = noteClass === "endnote";
  if (tag === "text:note-body") {
    return isEndnote ? "text:endnote-body" : "text:footnote-body";
  }
  return isEndnote ? "text:endnote-citation" : "text:footnote-citation";
}

// A length written in ODF's "in" unit, reversed to OpenOffice.org 1.x's own "inch" spelling — the exact inverse of INCH_TOKEN above, matched the same way (a whole whitespace-delimited token, so a compound value like a border shorthand keeps its structure).
const PT_IN_TOKEN = /(^|\s)(-?(?:\d+(?:\.\d+)?|\.\d+))in(?=\s|$)/g;

function reverseAttributeValue(name: string, value: string): string {
  if (name === "style:family") {
    // normaliseAttributeValue's own inverse — see its note for why the drawing family alone needs one, and what a real consumer does with a package that skips it.
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

// RENAMED_ATTRIBUTES reversed by explicit name — not an auto-inverted map, because one of its six entries (office:value-type) is ALSO independently produced by the element-scoped VALUE_ATTRIBUTE_LOCAL_NAMES rewrite below (from table:value-type/text:value-type), so a blind inversion would be ambiguous; the tag-scoped checks below resolve that ambiguity, mirroring renameAttributeFor's own tag-then-name dispatch structure exactly, just in the opposite order (the scoped checks run first here because they are the ones that can fire on a name the blanket reversal below would otherwise mis-resolve).
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

// The reverse of transformNamespaceDeclaration: an ODF (or already-OpenOffice.org) URI's canonical prefix decides the OpenOffice.org 1.x URI to bind it to. A prefix with no OpenOffice.org 1.x counterpart at all (smil:/anim:/xforms:/ db:/rpt:, ODF namespaces this format predates) is left exactly as it is — the same "neither vocabulary owns this" case the forward direction's own comment describes, just approached from the other side.
function transformNamespaceDeclarationToOoo1(
  attribute: Readonly<Attribute>,
): Attribute {
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
  source: XmlElement,
  tag: string,
  prefixes: ReadonlyMap<string, string>,
): Attribute[] {
  const out: Attribute[] = [];
  for (const attribute of source.attributes) {
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

// Rewrites one <office:frame>'s draw:frame wrapper back to the bare shape OpenOffice.org 1.x wrote: buildFrame's exact inverse. Only fires when the frame's own children include one of FRAME_SHAPES — a draw:frame wrapping anything else (a custom shape, a connector, any construct OpenOffice.org 1.x never wrapped this way at all) has no OpenOffice.org 1.x un-wrapped spelling and is left exactly as ODF wrote it. The frame's own attributes (all of which, on a well-formed draw:frame, are FRAME_ATTRIBUTES by construction — that is the set's own definition) move onto the shape; the frame's other children (svg:title/svg:desc and the rest of FRAME_CHILD_ELEMENTS) become the shape's own trailing children, exactly where buildFrame took them from.
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

// Raw (still XML-entity-encoded, per this package's processEntities:false model) text content of an element with only text-node children — exactly what MOVED_TO_CHILD_ELEMENT's dc:creator/dc:date/meta:date-string children carry, and copied verbatim into an attribute value below since both sides of that move use the identical raw encoding convention (see xml/entities.ts's own top-of-file note).
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

// meta:keywords was a wrapper ODF removed (see transformElement's own meta:keywords case); reversed here by re-wrapping every meta:keyword sibling office:meta carries into one meta:keywords element, positioned at the first keyword's own place among its siblings — exactly the shape the forward direction unwraps. Safe to run unconditionally over any element's children (not scoped to office:meta specifically): meta:keyword has no legitimate ODF appearance anywhere else, so the check costs nothing when there is nothing to wrap.
function wrapMetaKeywords(nodes: readonly XmlNode[]): XmlNode[] {
  // No early return for an empty keywords list: the loop below already reproduces `nodes` unchanged in that case (every node fails the meta:keyword check below and is pushed through as-is), so a length-0 guard would only save the loop's own allocation, never change the result.
  const keywords = nodes.filter(
    (node): node is XmlElement =>
      node.type === "element" && node.tag === "meta:keyword",
  );
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
  // The office:class value every DOCUMENT_ROOT_ELEMENTS root in this package gets stamped with, resolved once from content.xml's own genre element (see documentClassOf) and threaded into every part's own transform — styles.xml and meta.xml carry no genre information of their own to derive it from.
  readonly documentClass: string | undefined;
  // The ORIGINAL, pre-reverse-transform package, threaded through for resolveOdfListKind's own cross-part style lookup alone (see this section's own top-of-file note on why list-kind resolution needs package-wide context).
  readonly pkg: Package;
  // Set only while transforming a text:note's own children, naming which note family text:note-body/text:note-citation (which carry no class of their own) belong to.
  readonly noteClass?: "footnote" | "endnote";
  // The ordered/bullet kind resolved for the nearest enclosing text:list that DID carry a resolvable text:style-name, inherited by a nested text:list that — like every nested list this package's own writeOdfList produces — has no text:style-name of its own to resolve.
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

  // office:body's genre child (buildBody's own construction) unwraps: recursing into the GENRE element's children rather than office:body's own single child reproduces the flat body OpenOffice.org 1.x wrote. office:body itself needs no special-cased return below (unlike draw:frame, the note family, and the rest) — REVERSE_RENAMED_ELEMENTS has no entry for it and it is not a DOCUMENT_ROOT_ELEMENTS member, so the generic tag/attribute handling at the bottom of this function already reproduces element("office:body", attributes, children) exactly.
  const genreChild =
    renamedTag === "office:body"
      ? firstGenreElement(source.children)
      : undefined;
  const recurseInto =
    genreChild === undefined ? source.children : genreChild.children;

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
    const tag = reverseNoteTag(renamedTag, noteClassRaw);
    return [element(tag, withoutClass, children)];
  }

  if (renamedTag === "text:note-body" || renamedTag === "text:note-citation") {
    const tag = reverseNoteBodyOrCitation(renamedTag, context.noteClass);
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

// The office:class every part of this package will be stamped with, resolved from content.xml's own office:body: the genre element (office:text and its siblings) office:body's single child is, per buildBody's own construction. undefined when content.xml is missing or carries no recognisable genre — a caller that hands this function something other than a genuine writeOdt/writeOds/writeOdp/writeOdg package gets an honestly undecorated result rather than a guessed office:class.
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
  const genre =
    body === undefined ? undefined : firstGenreElement(body.children);
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

// An ODF-shaped Package (the output of writeOdt/writeOdtContent, writeOds/writeOdsContent, writeOdp/writeOdpContent, or writeOdg/writeOdgContent) into genuine OpenOffice.org 1.x XML: the whole of this direction's own support for a real .sxw/.sxc/.sxi/.sxd writer, and the counterpart ../write.ts's writeSxw/writeSxc/writeSxi/writeSxd all call. A package whose "mimetype" part names an ODF media type with no OpenOffice.org 1.x predecessor (or one with no "mimetype" part at all — already OpenOffice.org 1.x-shaped, or not a document this module can identify) is returned exactly as given, mirroring transformOoo1Package's own "not applicable, leave alone" stance on the read side.
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
      // OpenOffice.org 1.x packages have no "mimetype" part at all — the manifest's own root entry, rewritten below, is the only record of the document's type (see ../ns.ts's own note on this asymmetry).
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

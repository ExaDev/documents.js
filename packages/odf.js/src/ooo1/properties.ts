import type { Attribute, XmlElement, XmlNode } from "../model/node";

// Splitting OpenOffice.org 1.x's single <style:properties> into ODF's family of typed <style:*-properties> elements -- the one genuinely structural difference between the two style models, and the reason a namespace rename alone cannot make an .sxw readable by an ODF reader.
//
// In OpenOffice.org 1.x every style carries exactly one <style:properties>, holding paragraph, character, table, page and drawing formatting side by side with no separation at all. ODF replaced it with one element per property family (style:text-properties, style:paragraph-properties, style:table-cell-properties, ...), which is what every reader in this package looks for. Splitting is not a matter of prefix: the SAME attribute name is valid in several of those elements with a different meaning in each (fo:background-color is a character highlight in style:text-properties, paragraph shading in style:paragraph-properties, and a cell fill in style:table-cell-properties), so duplicating the whole attribute set into every element would silently invent formatting the document never carried.
//
// The algorithm is LibreOffice's own, from its OOo-to-OASIS transformer (xmloff/source/transform/StyleOOoTContext.cxx): each style family has an ORDERED list of candidate property families; each attribute goes to the first candidate whose vocabulary contains it; anything unrecognised goes to the first candidate in the list. That ordering is what resolves the ambiguous names -- a table-cell style tries table-cell before paragraph, so fo:background-color lands on the cell, while a paragraph style tries paragraph before text, so the same attribute lands on the paragraph.
//
// A consequence of the "unrecognised goes to the first candidate" rule is that only the LAST candidate in each list needs an exhaustive vocabulary, plus whatever names an earlier candidate must claim before a later one can steal them. That is why the tables below are not full copies of ODF's property vocabulary: TEXT_ATTRIBUTES is exhaustive because style:text-properties is last in every list it appears in, while TABLE_CELL_ATTRIBUTES and GRAPHIC_ATTRIBUTES list only the names they must win from PARAGRAPH_ATTRIBUTES. Everything else falls through to the correct element on its own.

export type Ooo1PropertyType =
  | "graphic"
  | "drawing-page"
  | "page-layout"
  | "header-footer"
  | "text"
  | "paragraph"
  | "ruby"
  | "section"
  | "table"
  | "table-column"
  | "table-row"
  | "table-cell"
  | "list-level"
  | "chart";

const PROPERTIES_ELEMENT_TAG: Readonly<Record<Ooo1PropertyType, string>> = {
  graphic: "style:graphic-properties",
  "drawing-page": "style:drawing-page-properties",
  "page-layout": "style:page-layout-properties",
  "header-footer": "style:header-footer-properties",
  text: "style:text-properties",
  paragraph: "style:paragraph-properties",
  ruby: "style:ruby-properties",
  section: "style:section-properties",
  table: "style:table-properties",
  "table-column": "style:table-column-properties",
  "table-row": "style:table-row-properties",
  "table-cell": "style:table-cell-properties",
  "list-level": "style:list-level-properties",
  chart: "style:chart-properties",
};

// Every element name style:properties can split INTO -- computed once from PROPERTIES_ELEMENT_TAG's own values rather than restated, so a fifteenth property family added there is recognised here for free. This is also the WRITE direction's own recognition set (see mergeStyleProperties below): no legitimate ODF element other than these fourteen carries this tag family, so testing membership in this set is a safe, context-free way to find "the typed properties children of a style container" without needing to know which container family produced them.
const ALL_PROPERTIES_ELEMENT_TAGS: ReadonlySet<string> = new Set(
  Object.values(PROPERTIES_ELEMENT_TAG),
);

// Which property families a style's own style:family value splits into, in the order they are tried. Transcribed from LibreOffice's aPropTypes table (StyleOOoTContext.cxx), including its own choice to give a list-level style only style:list-level-properties and a data (number) style only style:text-properties.
const PROPERTY_TYPES_BY_FAMILY: ReadonlyMap<
  string,
  readonly Ooo1PropertyType[]
> = new Map([
  ["graphic", ["graphic", "paragraph", "text"]],
  ["presentation", ["graphic", "paragraph", "text"]],
  ["drawing-page", ["drawing-page"]],
  ["text", ["text"]],
  ["paragraph", ["paragraph", "text"]],
  ["ruby", ["ruby"]],
  ["section", ["section"]],
  ["table", ["table"]],
  ["table-column", ["table-column"]],
  ["table-row", ["table-row"]],
  ["table-cell", ["table-cell", "paragraph", "text"]],
  ["chart", ["chart", "graphic", "paragraph", "text"]],
]);

// The style containers that carry a style:properties without having a style:family attribute to classify it: their own element name is the classification.
const PROPERTY_TYPES_BY_CONTAINER_TAG: ReadonlyMap<
  string,
  readonly Ooo1PropertyType[]
> = new Map([
  ["style:page-master", ["page-layout"]],
  ["style:header-style", ["header-footer"]],
  ["style:footer-style", ["header-footer"]],
  ["text:list-level-style-number", ["list-level"]],
  ["text:list-level-style-bullet", ["list-level"]],
  ["text:list-level-style-image", ["list-level"]],
  ["text:outline-level-style", ["list-level"]],
  ["number:number-style", ["text"]],
  ["number:currency-style", ["text"]],
  ["number:percentage-style", ["text"]],
  ["number:date-style", ["text"]],
  ["number:time-style", ["text"]],
  ["number:boolean-style", ["text"]],
  ["number:text-style", ["text"]],
]);

// style:text-properties' own attribute vocabulary. Exhaustive by necessity: "text" is the LAST candidate in every family that has more than one, so an attribute missing from this set is silently filed as a paragraph (or graphic, or cell) property and lost to every reader that looks for it. Taken from ODF's style:text-properties attribute list, including the -asian/-complex script variants OpenOffice.org 1.x already wrote.
const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "fo:color",
  "fo:country",
  "fo:font-family",
  "fo:font-size",
  "fo:font-style",
  "fo:font-variant",
  "fo:font-weight",
  "fo:hyphenate",
  "fo:hyphenation-push-char-count",
  "fo:hyphenation-remain-char-count",
  "fo:language",
  "fo:letter-spacing",
  "fo:script",
  "fo:text-shadow",
  "fo:text-transform",
  "style:country-asian",
  "style:country-complex",
  "style:font-charset",
  "style:font-charset-asian",
  "style:font-charset-complex",
  "style:font-family-asian",
  "style:font-family-complex",
  "style:font-family-generic",
  "style:font-family-generic-asian",
  "style:font-family-generic-complex",
  "style:font-name",
  "style:font-name-asian",
  "style:font-name-complex",
  "style:font-pitch",
  "style:font-pitch-asian",
  "style:font-pitch-complex",
  "style:font-relief",
  "style:font-size-asian",
  "style:font-size-complex",
  "style:font-size-rel",
  "style:font-size-rel-asian",
  "style:font-size-rel-complex",
  "style:font-style-asian",
  "style:font-style-complex",
  "style:font-style-name",
  "style:font-style-name-asian",
  "style:font-style-name-complex",
  "style:font-weight-asian",
  "style:font-weight-complex",
  "style:language-asian",
  "style:language-complex",
  "style:letter-kerning",
  "style:script-type",
  "style:text-background-color",
  "style:text-blinking",
  "style:text-combine",
  "style:text-combine-end-char",
  "style:text-combine-start-char",
  "style:text-emphasize",
  "style:text-line-through-color",
  "style:text-line-through-mode",
  "style:text-line-through-style",
  "style:text-line-through-text",
  "style:text-line-through-text-style",
  "style:text-line-through-type",
  "style:text-line-through-width",
  "style:text-outline",
  "style:text-position",
  "style:text-rotation-angle",
  "style:text-rotation-scale",
  "style:text-scale",
  "style:text-underline-color",
  "style:text-underline-mode",
  "style:text-underline-style",
  "style:text-underline-type",
  "style:text-underline-width",
  "style:use-window-font-color",
  "text:condition",
  "text:display",
  // The two OpenOffice.org-only compound spellings, expanded into their ODF triples below rather than copied through -- listed here so the routing step files them under "text" before the expansion runs.
  "style:text-underline",
  "style:text-crossing-out",
]);

// style:paragraph-properties' vocabulary, needed so a table-cell, graphic or chart style routes its genuine paragraph formatting to the right element rather than keeping it on the cell/frame. A paragraph style needs no entry here to work (paragraph is that family's fallback), but the set is kept complete enough that the multi-candidate families behave.
const PARAGRAPH_ATTRIBUTES: ReadonlySet<string> = new Set([
  "fo:background-color",
  "fo:border",
  "fo:border-bottom",
  "fo:border-left",
  "fo:border-right",
  "fo:border-top",
  "fo:break-after",
  "fo:break-before",
  "fo:hyphenation-keep",
  "fo:hyphenation-ladder-count",
  "fo:keep-together",
  "fo:keep-with-next",
  "fo:line-height",
  "fo:margin",
  "fo:margin-bottom",
  "fo:margin-left",
  "fo:margin-right",
  "fo:margin-top",
  "fo:orphans",
  "fo:padding",
  "fo:padding-bottom",
  "fo:padding-left",
  "fo:padding-right",
  "fo:padding-top",
  "fo:text-align",
  "fo:text-align-last",
  "fo:text-indent",
  "fo:widows",
  "style:auto-text-indent",
  "style:background-transparency",
  "style:border-line-width",
  "style:border-line-width-bottom",
  "style:border-line-width-left",
  "style:border-line-width-right",
  "style:border-line-width-top",
  "style:contextual-spacing",
  "style:font-independent-line-spacing",
  "style:justify-single-word",
  "style:line-break",
  "style:line-height-at-least",
  "style:line-spacing",
  "style:master-page-name",
  "style:page-number",
  "style:punctuation-wrap",
  "style:register-true",
  "style:shadow",
  "style:snap-to-layout-grid",
  "style:tab-stop-distance",
  "style:text-autospace",
  "style:vertical-align",
  "style:writing-mode",
  "style:writing-mode-automatic",
  "text:line-number",
  "text:number-lines",
]);

// Only the names style:table-cell-properties must WIN from style:paragraph-properties. Everything else a cell style carries (style:cell-protect, style:decimal-places, style:diagonal-*, style:direction, style:glyph-orientation-vertical, style:repeat-content, style:rotation-*, style:text-align-source, ...) appears in no other family's vocabulary and therefore falls through to the cell on its own.
const TABLE_CELL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "fo:background-color",
  "fo:border",
  "fo:border-bottom",
  "fo:border-left",
  "fo:border-right",
  "fo:border-top",
  "fo:padding",
  "fo:padding-bottom",
  "fo:padding-left",
  "fo:padding-right",
  "fo:padding-top",
  "style:border-line-width",
  "style:border-line-width-bottom",
  "style:border-line-width-left",
  "style:border-line-width-right",
  "style:border-line-width-top",
  "style:shadow",
  "style:vertical-align",
  "style:writing-mode",
]);

// Only the names style:graphic-properties must win from style:paragraph-properties. Every draw:*/svg:* attribute a frame or shape style carries is absent from the paragraph and text vocabularies, so it falls through to the graphic element without an entry here.
const GRAPHIC_ATTRIBUTES: ReadonlySet<string> = new Set([
  "fo:background-color",
  "fo:border",
  "fo:border-bottom",
  "fo:border-left",
  "fo:border-right",
  "fo:border-top",
  "fo:margin",
  "fo:margin-bottom",
  "fo:margin-left",
  "fo:margin-right",
  "fo:margin-top",
  "fo:padding",
  "fo:padding-bottom",
  "fo:padding-left",
  "fo:padding-right",
  "fo:padding-top",
  "style:background-transparency",
  "style:border-line-width",
  "style:border-line-width-bottom",
  "style:border-line-width-left",
  "style:border-line-width-right",
  "style:border-line-width-top",
  "style:shadow",
  "style:vertical-align",
  "style:writing-mode",
]);

const ATTRIBUTES_BY_PROPERTY_TYPE: ReadonlyMap<
  Ooo1PropertyType,
  ReadonlySet<string>
> = new Map([
  ["text", TEXT_ATTRIBUTES],
  ["paragraph", PARAGRAPH_ATTRIBUTES],
  ["table-cell", TABLE_CELL_ATTRIBUTES],
  ["graphic", GRAPHIC_ATTRIBUTES],
]);

// A style:properties child element's own family. style:background-image is claimed by all three families that can carry a background, so the candidate ordering decides it exactly as it decides fo:background-color.
const ELEMENTS_BY_PROPERTY_TYPE: ReadonlyMap<
  Ooo1PropertyType,
  ReadonlySet<string>
> = new Map([
  [
    "paragraph",
    new Set(["style:tab-stops", "style:drop-cap", "style:background-image"]),
  ],
  ["table-cell", new Set(["style:background-image"])],
  ["graphic", new Set(["style:background-image"])],
]);

// The property families a <style:properties> inside this container splits into, or undefined if the container is not one this module recognises -- in which case the caller leaves the element unsplit rather than guessing a family and filing real formatting under the wrong one.
export function propertyTypesForContainer(
  container: XmlElement,
): readonly Ooo1PropertyType[] | undefined {
  const byTag = PROPERTY_TYPES_BY_CONTAINER_TAG.get(container.tag);
  if (byTag !== undefined) {
    return byTag;
  }
  if (
    container.tag !== "style:style" &&
    container.tag !== "style:default-style"
  ) {
    return undefined;
  }
  const family = container.attributes.find(
    (attribute) => attribute.name === "style:family",
  )?.value;
  return family === undefined
    ? undefined
    : PROPERTY_TYPES_BY_FAMILY.get(family);
}

function routeTo(
  name: string,
  candidates: readonly Ooo1PropertyType[],
  membership: ReadonlyMap<Ooo1PropertyType, ReadonlySet<string>>,
): Ooo1PropertyType {
  for (const candidate of candidates) {
    if (membership.get(candidate)?.has(name) === true) {
      return candidate;
    }
  }
  // LibreOffice's own fallback: an attribute or element belonging to no candidate's vocabulary goes to the family's first property element.
  const first = candidates[0];
  if (first === undefined) {
    throw new Error("a style family must have at least one property type");
  }
  return first;
}

// OpenOffice.org 1.x wrote one style:text-underline attribute where ODF writes up to three (style, type and width); the value itself encodes double-ness and boldness. Value mapping transcribed from LibreOffice's XML_PTACTION_UNDERLINE case (StyleOOoTContext.cxx); a value not listed here is a plain line style ODF kept unchanged (dotted, dash, long-dash, dot-dash, dot-dot-dash, wave, ...) and passes straight through as the style.
const UNDERLINE_EXPANSIONS: ReadonlyMap<
  string,
  { readonly style: string; readonly type?: string; readonly width?: string }
> = new Map([
  ["single", { style: "solid" }],
  ["double", { style: "solid", type: "double" }],
  ["bold", { style: "solid", width: "bold" }],
  ["bold-dotted", { style: "dotted", width: "bold" }],
  ["bold-dash", { style: "dash", width: "bold" }],
  ["bold-long-dash", { style: "long-dash", width: "bold" }],
  ["bold-dot-dash", { style: "dot-dash", width: "bold" }],
  ["bold-dot-dot-dash", { style: "dot-dot-dash", width: "bold" }],
  ["bold-wave", { style: "wave", width: "bold" }],
  ["double-wave", { style: "wave", type: "double" }],
]);

// The strike-through counterpart, from the same source's XML_PTACTION_LINETHROUGH case. The slash and X values become a solid line whose "text" is the character drawn over the run, which is how ODF spells them.
const LINE_THROUGH_EXPANSIONS: ReadonlyMap<
  string,
  {
    readonly style: string;
    readonly type?: string;
    readonly width?: string;
    readonly text?: string;
  }
> = new Map([
  ["single-line", { style: "solid" }],
  ["double-line", { style: "solid", type: "double" }],
  ["thick-line", { style: "solid", width: "bold" }],
  ["slash", { style: "solid", text: "/" }],
  ["X", { style: "solid", text: "X" }],
]);

// Rewrites one OpenOffice.org 1.x property attribute into the ODF attribute(s) that carry the same formatting. Most are unchanged; the three that are not are the compound line decorations and the boolean fo:keep-with-next, all of which ODF respelled rather than renamed.
function expandPropertyAttribute(attribute: Attribute): Attribute[] {
  if (attribute.name === "style:text-underline") {
    const expansion = UNDERLINE_EXPANSIONS.get(attribute.value);
    const style = expansion?.style ?? attribute.value;
    const out: Attribute[] = [
      { name: "style:text-underline-style", value: style },
    ];
    if (expansion?.width !== undefined) {
      out.push({
        name: "style:text-underline-width",
        value: expansion.width,
      });
    }
    if (expansion?.type !== undefined) {
      out.push({ name: "style:text-underline-type", value: expansion.type });
    }
    return out;
  }
  if (attribute.name === "style:text-crossing-out") {
    const expansion = LINE_THROUGH_EXPANSIONS.get(attribute.value);
    const style = expansion?.style ?? attribute.value;
    const out: Attribute[] = [
      { name: "style:text-line-through-style", value: style },
    ];
    if (expansion?.width !== undefined) {
      out.push({
        name: "style:text-line-through-width",
        value: expansion.width,
      });
    }
    if (expansion?.type !== undefined) {
      out.push({ name: "style:text-line-through-type", value: expansion.type });
    }
    if (expansion?.text !== undefined) {
      out.push({ name: "style:text-line-through-text", value: expansion.text });
    }
    return out;
  }
  if (attribute.name === "fo:keep-with-next") {
    // OpenOffice.org 1.x wrote a boolean; ODF writes a keyword.
    return [
      {
        name: "fo:keep-with-next",
        value: attribute.value === "true" ? "always" : "auto",
      },
    ];
  }
  return [attribute];
}

// Splits one <style:properties> into the typed <style:*-properties> elements its container's family implies, in candidate order, emitting only those that received something. The caller has already normalised prefixes and attribute values (inch to in) on the element.
export function splitStyleProperties(
  properties: XmlElement,
  candidates: readonly Ooo1PropertyType[],
): XmlElement[] {
  const attributesByType = new Map<Ooo1PropertyType, Attribute[]>();
  const childrenByType = new Map<Ooo1PropertyType, XmlNode[]>();

  for (const attribute of properties.attributes) {
    const target = routeTo(
      attribute.name,
      candidates,
      ATTRIBUTES_BY_PROPERTY_TYPE,
    );
    const bucket = attributesByType.get(target) ?? [];
    bucket.push(...expandPropertyAttribute(attribute));
    attributesByType.set(target, bucket);
  }

  for (const child of properties.children) {
    if (child.type !== "element") {
      // Whitespace and comments between property elements carry no formatting; they belong to no family and are dropped rather than duplicated into an arbitrary one.
      continue;
    }
    const target = routeTo(child.tag, candidates, ELEMENTS_BY_PROPERTY_TYPE);
    const bucket = childrenByType.get(target) ?? [];
    bucket.push(child);
    childrenByType.set(target, bucket);
  }

  const out: XmlElement[] = [];
  for (const type of candidates) {
    const attributes = attributesByType.get(type) ?? [];
    const children = childrenByType.get(type) ?? [];
    if (attributes.length === 0 && children.length === 0) {
      continue;
    }
    out.push({
      type: "element",
      tag: PROPERTIES_ELEMENT_TAG[type],
      attributes,
      children,
    });
  }
  return out;
}

// --- the write direction: ODF's family of typed style:*-properties elements -> one style:properties -----------------
//
// The exact inverse of splitStyleProperties above, and simpler than it in one genuine way: the split needs a container's own candidate family list to decide WHICH typed element an attribute becomes, but the merge needs no such list at all. ALL_PROPERTIES_ELEMENT_TAGS is a closed, unambiguous set -- no legitimate ODF element other than these fourteen ever carries this tag family, in any container -- so recognising "these are a style's typed properties children" is a context-free membership test, and merging them back into one style:properties needs nothing more than concatenating their attributes and children in encounter order. Order carries no ODF semantics (neither this package's own readers nor any real producer's own reader depends on attribute or child order), so it is not reconstructed to match whatever an original OpenOffice.org 1.x document might once have had.
export function mergeStyleProperties(children: readonly XmlNode[]): {
  readonly merged: XmlElement | undefined;
  readonly rest: XmlNode[];
} {
  const attributes: Attribute[] = [];
  const propertyChildren: XmlNode[] = [];
  const rest: XmlNode[] = [];
  let found = false;
  for (const child of children) {
    if (
      child.type === "element" &&
      ALL_PROPERTIES_ELEMENT_TAGS.has(child.tag)
    ) {
      found = true;
      attributes.push(...child.attributes);
      propertyChildren.push(...child.children);
      continue;
    }
    rest.push(child);
  }
  if (!found) {
    return { merged: undefined, rest: [...children] };
  }
  return {
    merged: {
      type: "element",
      tag: "style:properties",
      attributes,
      children: propertyChildren,
    },
    rest,
  };
}

// The definitions-collection family, split from constructs.ts: the document-level sink and the per-family collectors that harvest field masters, data styles, font faces and named expressions into it during a read. The residue and marker machinery stays in constructs.ts and constructs-markers.ts.
//
import type { DefinitionEntry } from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import { attrValue, elementsWithTag } from "../../xml/query";
import { buildXml } from "../../xml/build";

// --- field master declarations (text:*-decls) ------------------------------------------------------------------------

const ODF_FIELD_MASTER_CONTAINERS: ReadonlyMap<string, string> = new Map([
  ["text:variable-decls", "variable"],
  ["text:user-field-decls", "user-field"],
  ["text:sequence-decls", "sequence"],
]);

// The declaration attributes a definitions entry carries, keyed as the entry spells them. Values stay verbatim strings — office:value-type names the interpretation, and coercing it here would freeze a typing the entry vocabulary has not settled. text:display-outline-level is the one integer (a sequence's outline association), parsed when it is one and carried as nothing when it is not.
function readOdfFieldMasterEntry(
  family: string,
  decl: XmlElement,
): { key: string; entry: DefinitionEntry } | undefined {
  const name = attrValue(decl, "text:name");
  if (name === undefined) {
    return undefined;
  }
  const entry: DefinitionEntry = { kind: "fieldMaster", family, name };
  const valueType = attrValue(decl, "office:value-type");
  if (valueType !== undefined) {
    entry.valueType = valueType;
  }
  const value = attrValue(decl, "office:value");
  if (value !== undefined) {
    entry.value = value;
  }
  const stringValue = attrValue(decl, "office:string-value");
  if (stringValue !== undefined) {
    entry.stringValue = stringValue;
  }
  const formula = attrValue(decl, "text:formula");
  if (formula !== undefined) {
    entry.formula = formula;
  }
  const displayOutlineLevel = attrValue(decl, "text:display-outline-level");
  if (displayOutlineLevel !== undefined) {
    const parsed = Number.parseInt(displayOutlineLevel, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      entry.displayOutlineLevel = parsed;
    }
  }
  return { key: `${family}:${name}`, entry };
}

// Collects every field-master declaration container, anywhere in the node tree, into the definitions table the package root carries: the declaration side of ODF's field system, the sibling of the run-level field instances paragraph.ts reads. Keys are namespaced per family (variable:total, user-field:rate, sequence:Table) because ODF style-like name uniqueness does not hold across the three families — the same bare name may legally be declared twice in different families, and one definitions table is one key namespace.
export function collectOdfFieldMasterDefinitions(
  nodes: readonly XmlNode[],
  out: Record<string, DefinitionEntry>,
): void {
  for (const [containerTag, family] of ODF_FIELD_MASTER_CONTAINERS) {
    for (const container of elementsWithTag(nodes, containerTag)) {
      for (const decl of container.children) {
        if (decl.type !== "element") {
          continue;
        }
        const read = readOdfFieldMasterEntry(family, decl);
        if (read !== undefined) {
          out[read.key] = read.entry;
        }
      }
    }
  }
}

// --- data styles and font declarations ------------------------------------------------------------------------------

// The number:* data-style family ODF attaches to cell and field styles: number formats are styles in ODF (office:automatic-styles residents referenced by style:data-style-name), and no harmonised number-format vocabulary exists yet, so each declared style reads as a definitions entry carrying its name and its element VERBATIM — consumable by name, restorable by a same-format writer, and honest about carrying no interpretation of the format code.
const ODF_DATA_STYLE_TAGS: ReadonlySet<string> = new Set([
  "number:boolean-style",
  "number:currency-style",
  "number:date-style",
  "number:number-style",
  "number:percentage-style",
  "number:text-style",
  "number:time-style",
]);

export function collectOdfDataStyleDefinitions(
  nodes: readonly XmlNode[],
  out: Record<string, DefinitionEntry>,
): void {
  for (const tag of ODF_DATA_STYLE_TAGS) {
    for (const element of elementsWithTag(nodes, tag)) {
      const name = attrValue(element, "style:name");
      if (name === undefined) {
        continue;
      }
      out[`dataStyle:${name}`] = {
        kind: "dataStyle",
        name,
        xml: buildXml([element]),
      };
    }
  }
}

// office:font-face-decls/style:font-face — font declarations are style definitions in ODF's own model, declared in EITHER part (content.xml and styles.xml each carry their own office:font-face-decls). The declaration's own name and family are structured; the generic and pitch classify for substitution and ride as plain strings.
export function collectOdfFontFaceDefinitions(
  nodes: readonly XmlNode[],
  out: Record<string, DefinitionEntry>,
): void {
  for (const face of elementsWithTag(nodes, "style:font-face")) {
    const name = attrValue(face, "style:name");
    const family = attrValue(face, "svg:font-family");
    if (name === undefined || family === undefined) {
      continue;
    }
    const entry: DefinitionEntry = {
      kind: "fontFace",
      name,
      fontFamily: family,
    };
    const generic = attrValue(face, "style:font-family-generic");
    if (generic !== undefined) {
      entry.familyGeneric = generic;
    }
    const pitch = attrValue(face, "style:font-pitch");
    if (pitch !== undefined) {
      entry.pitch = pitch;
    }
    out[`fontFace:${name}`] = entry;
  }
}

// --- named expressions (ods) ----------------------------------------------------------------------------------------

// A spreadsheet's table:named-expressions declarations into the definitions table: the spreadsheet sibling of field masters, and the natural shared target with xlsx's defined names. table:named-range carries a cell-range-address; table:named-expression carries an OpenFormula expression string — both verbatim, with the base cell each declaration also states. Keys are namespaced per kind because a range and an expression may legally share a bare name.
export function collectOdfNamedExpressions(
  nodes: readonly XmlNode[],
  out: Record<string, DefinitionEntry>,
): void {
  for (const container of elementsWithTag(nodes, "table:named-expressions")) {
    for (const child of container.children) {
      if (child.type !== "element") {
        continue;
      }
      const name = attrValue(child, "table:name");
      if (name === undefined) {
        continue;
      }
      const baseCellAddress = attrValue(child, "table:base-cell-address");
      if (child.tag === "table:named-range") {
        const cellRangeAddress = attrValue(child, "table:cell-range-address");
        if (cellRangeAddress === undefined) {
          continue;
        }
        const entry: DefinitionEntry = {
          kind: "namedRange",
          name,
          cellRangeAddress,
        };
        if (baseCellAddress !== undefined) {
          entry.baseCellAddress = baseCellAddress;
        }
        out[`named-range:${name}`] = entry;
      } else if (child.tag === "table:named-expression") {
        const expression = attrValue(child, "table:expression");
        if (expression === undefined) {
          continue;
        }
        const entry: DefinitionEntry = {
          kind: "namedExpression",
          name,
          expression,
        };
        if (baseCellAddress !== undefined) {
          entry.baseCellAddress = baseCellAddress;
        }
        out[`named-expression:${name}`] = entry;
      }
    }
  }
}

// The document-level sink a paragraph's note and annotation reading reports definitions entries into, carrying the two deterministic ordinal counters that mint names for the constructs ODF leaves nameless (a note without text:id, an annotation without office:name — both optional attributes in the schema even though every real producer writes them). One sink per document, threaded by reference, so minted names are unique across the whole body exactly the way list numIds are.
export interface OdfDefinitionsSink {
  readonly entries: Record<string, DefinitionEntry>;
  nextNoteOrdinal: number;
  nextAnnotationOrdinal: number;
}

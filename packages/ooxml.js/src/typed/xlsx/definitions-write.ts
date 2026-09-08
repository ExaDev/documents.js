import type { DefinitionEntry, DefinitionsTable } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";

// The write-side inverse of typed/xlsx/definitions.ts: a workbook's own DefinitionsTable (the tree reader's namedRange/table entries, ExaDev/documents.js#973) back into xl/workbook.xml's general <definedNames> and xl/tables/tableN.xml parts. definitions.ts's own header states the shape decisions this mirrors; this module owns only the entry validation and element construction, never part/relationship wiring, which stays in build.ts alongside every other part this writer assembles.
//
// SECURITY BOUNDARY: a namedRange's refersTo is only ever written when it matches INTERNAL_RANGE_PATTERN below -- a sheet-qualified internal A1 reference and nothing else. A defined name is live formula context in every real spreadsheet application, so writing an attacker-shaped refersTo verbatim (a WEBSERVICE call, an external-workbook reference, a formula) would restore executable content the moment a recipient opens or recalculates the output, the exfiltration shape SECURITY.md's formula paragraph names. Refused values throw by name rather than degrading.

const SML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function asString(value: unknown, field: string, kind: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `buildXlsxPackageFromContent: a "${kind}" definitions entry's "${field}" field must be a string`,
    );
  }
  return value;
}

function asOptionalNumber(
  value: unknown,
  field: string,
  kind: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(
      `buildXlsxPackageFromContent: a "${kind}" definitions entry's "${field}" field must be a number`,
    );
  }
  return value;
}

function asStringArray(value: unknown, field: string, kind: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(
      `buildXlsxPackageFromContent: a "${kind}" definitions entry's "${field}" field must be a string array`,
    );
  }
  return value;
}

export interface NamedRangeEntry {
  readonly name: string;
  readonly refersTo: string;
  readonly localSheetId: number | undefined;
}

// The one shape of refersTo this writer will place into an ACTIVE workbook defined-name context: a sheet-qualified internal A1 reference (a cell, a cell range, a column range, or a row range), optionally a comma-separated union of them, every area carrying its own sheet qualifier. Everything else is refused -- and "everything else" is exactly the executable-formula surface: parentheses carry function calls (a preserved WEBSERVICE(...&A1) name restores network exfiltration the moment a recipient recalculates), square brackets carry external-workbook references, and a bare unqualified range depends on whatever sheet context the opening application happens to resolve it in. XML escaping protects markup, not formula semantics; this boundary protects formula semantics.
const SHEET_QUALIFIER_SOURCE = "(?:'[^']*'|[A-Za-z0-9_.]+)!";
const AREA_SOURCE =
  "(?:\\$?[A-Za-z]{1,3}\\$?[0-9]+(?::\\$?[A-Za-z]{1,3}\\$?[0-9]+)?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?[0-9]+:\\$?[0-9]+)";
const INTERNAL_RANGE_PATTERN = new RegExp(
  `^${SHEET_QUALIFIER_SOURCE}${AREA_SOURCE}(?:,${SHEET_QUALIFIER_SOURCE}${AREA_SOURCE})*$`,
);

function asInternalRangeRefersTo(
  value: unknown,
  field: string,
  kind: string,
  name: string,
): string {
  const refersTo = asString(value, field, kind);
  if (!INTERNAL_RANGE_PATTERN.test(refersTo)) {
    throw new Error(
      `buildXlsxPackageFromContent: the named range "${name}"'s refersTo must be a sheet-qualified internal A1 reference (a cell, cell range, column range, or row range, optionally a comma-separated union) -- '${refersTo}' carries formula or external-reference content this writer refuses to place into an active defined-name context`,
    );
  }
  return refersTo;
}

export interface TableEntry {
  readonly name: string;
  readonly ref: string;
  readonly sheet: string;
  readonly columns: readonly string[];
}

function definitionEntries(
  definitions: DefinitionsTable | undefined,
): readonly DefinitionEntry[] {
  return definitions === undefined ? [] : Object.values(definitions);
}

// Every 'namedRange' definitions entry (typed/xlsx/definitions.ts's own readNamedRanges), validated field-by-field rather than trusted -- a caller-constructed DefinitionsTable is only schema-checked down to DefinitionEntry's own loose `{kind: string}` shape, so a malformed per-tenant field fails loudly here instead of writing a workbook that silently drops or mis-types the range.
export function collectNamedRangeEntries(
  definitions: DefinitionsTable | undefined,
): NamedRangeEntry[] {
  const entries: NamedRangeEntry[] = [];
  for (const entry of definitionEntries(definitions)) {
    if (entry.kind !== "namedRange") {
      continue;
    }
    entries.push({
      name: asString(entry.name, "name", "namedRange"),
      refersTo: asInternalRangeRefersTo(
        entry.refersTo,
        "refersTo",
        "namedRange",
        typeof entry.name === "string" ? entry.name : String(entry.name),
      ),
      localSheetId: asOptionalNumber(
        entry.localSheetId,
        "localSheetId",
        "namedRange",
      ),
    });
  }
  return entries;
}

// Every 'table' definitions entry (typed/xlsx/definitions.ts's own readTableEntries), same validation discipline as collectNamedRangeEntries above.
export function collectTableEntries(
  definitions: DefinitionsTable | undefined,
): TableEntry[] {
  const entries: TableEntry[] = [];
  for (const entry of definitionEntries(definitions)) {
    if (entry.kind !== "table") {
      continue;
    }
    entries.push({
      name: asString(entry.name, "name", "table"),
      ref: asString(entry.ref, "ref", "table"),
      sheet: asString(entry.sheet, "sheet", "table"),
      columns: asStringArray(entry.columns, "columns", "table"),
    });
  }
  return entries;
}

// xl/workbook.xml <definedName> elements for the workbook's general named ranges -- alongside, never replacing, buildDefinedNameElements' own two reserved _xlnm.Print_Area/_xlnm.Print_Titles names (build.ts merges both lists into one <definedNames> container).
export function buildGeneralDefinedNameElements(
  entries: readonly NamedRangeEntry[],
): XmlElement[] {
  return entries.map((entry) => {
    const attrs: Record<string, string> = { name: encodeXmlText(entry.name) };
    if (entry.localSheetId !== undefined) {
      attrs.localSheetId = String(entry.localSheetId);
    }
    return el("definedName", attrs, [txt(encodeXmlText(entry.refersTo))]);
  });
}

// One xl/tables/tableN.xml part for one TableEntry: CT_Table's own required id/name/displayName/ref quartet, an <autoFilter> spanning the same ref (every real producer emits one, even for a table that filters nothing), and <tableColumns> in the entry's own column order -- the exact inverse of definitions.ts's readTableEntries, which reads name/ref/columns back through this identical wrapper shape. id is workbook-scoped (build.ts assigns it as the table's own 1-based position across every table entry, matching CT_Table/@id's own "unique within the workbook" rule); displayName mirrors name verbatim, since DefinitionEntry carries only the one producer-facing name.
export function buildTablePart(entry: TableEntry, id: number): XmlElement {
  const columnElements = entry.columns.map((name, index) =>
    el("tableColumn", { id: String(index + 1), name: encodeXmlText(name) }),
  );
  return el(
    "table",
    {
      xmlns: SML_NS,
      id: String(id),
      name: encodeXmlText(entry.name),
      displayName: encodeXmlText(entry.name),
      ref: entry.ref,
      totalsRowShown: "0",
    },
    [
      el("autoFilter", { ref: entry.ref }),
      el(
        "tableColumns",
        { count: String(columnElements.length) },
        columnElements,
      ),
    ],
  );
}

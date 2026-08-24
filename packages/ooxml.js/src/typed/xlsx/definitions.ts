import type { DefinitionsTable } from "document-schema.js";
import type { Package } from "../../model/package";
import {
  attr,
  childrenWithTag,
  resolveRelationships,
  rootElement,
  textContent,
} from "../util";
import { resolveSheetEntries } from "./content";
import { XLNM_PRINT_AREA, XLNM_PRINT_TITLES } from "./defined-names";

// A workbook's sheet-scoped named expressions: general defined names (xl/workbook.xml's <definedNames> beyond the two _xlnm print names the print-settings reader already consumes) and table/List objects (xl/tables/*.xml, reached through each worksheet's own relationships). document-schema.js's own verdict for this construct family is that a named range has no block-flow extent to wrap, so it rides a definitions-table entry naming its range -- and the definitions table is a tree-root facility the flat ContentDocument structurally cannot carry, which is why readXlsx (the tree reader) attaches these and readXlsxContent (the flat reader) cannot. Entries are keyed by family-prefixed producer name (namedRange:TaxRate, table:SalesTable), so a range and a table may share a bare name without colliding; per-tenant fields are the producer's own vocabulary, exactly as the definitions facility specifies.

const WORKBOOK_PATH = "xl/workbook.xml";
const TABLE_REL_SUFFIX = "/table";

function readNamedRanges(pkg: Package, out: DefinitionsTable): void {
  const workbook = rootElement(pkg.parts[WORKBOOK_PATH]);
  const container =
    workbook === undefined
      ? undefined
      : childrenWithTag(workbook, "definedNames")[0];
  if (container === undefined) {
    return;
  }
  for (const definedName of childrenWithTag(container, "definedName")) {
    const name = attr(definedName, "name");
    if (
      name === undefined ||
      name === XLNM_PRINT_AREA ||
      name === XLNM_PRINT_TITLES
    ) {
      continue;
    }
    const localSheetIdRaw = attr(definedName, "localSheetId");
    const localSheetId =
      localSheetIdRaw === undefined
        ? undefined
        : Number.parseInt(localSheetIdRaw, 10);
    out[`namedRange:${name}`] = {
      kind: "namedRange",
      name,
      refersTo: textContent(definedName),
      ...(Number.isInteger(localSheetId) ? { localSheetId } : {}),
    };
  }
}

function readTableEntries(pkg: Package, out: DefinitionsTable): void {
  for (const entry of resolveSheetEntries(pkg)) {
    for (const rel of resolveRelationships(pkg, entry.path).values()) {
      if (!rel.type.endsWith(TABLE_REL_SUFFIX)) {
        continue;
      }
      const table = rootElement(pkg.parts[rel.target]);
      const name = table === undefined ? undefined : attr(table, "name");
      const ref = table === undefined ? undefined : attr(table, "ref");
      if (table === undefined || name === undefined || ref === undefined) {
        continue;
      }
      // CT_Table's columns sit inside a tableColumns container (beside autoFilter/sortState/tableStyleInfo), never as direct children of table itself -- read through the wrapper the grammar every real producer emits.
      const columns: string[] = [];
      const tableColumns = childrenWithTag(table, "tableColumns")[0];
      for (const column of tableColumns === undefined
        ? []
        : childrenWithTag(tableColumns, "tableColumn")) {
        const columnName = attr(column, "name");
        if (columnName !== undefined) {
          columns.push(columnName);
        }
      }
      out[`table:${name}`] = {
        kind: "table",
        name,
        ref,
        sheet: entry.name,
        columns,
      };
    }
  }
}

// The workbook's definitions table, or undefined when it carries no general defined name and no table object -- absent rather than empty, so a plain workbook's tree is field-for-field what it was.
export function readWorkbookDefinitions(
  pkg: Package,
): DefinitionsTable | undefined {
  const out: DefinitionsTable = {};
  readNamedRanges(pkg, out);
  readTableEntries(pkg, out);
  return Object.keys(out).length === 0 ? undefined : out;
}

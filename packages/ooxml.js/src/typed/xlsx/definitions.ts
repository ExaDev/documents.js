import type { DefinitionsTable } from "document-schema.js";
import type { Package } from "../../model/package";
import {
  attr,
  childrenWithTag,
  resolveRelationships,
  rootElement,
} from "../util";
import { resolveSheetEntries } from "./content";

// A workbook's table/List objects (xl/tables/*.xml, reached through each worksheet's own relationships), read into the tree root's definitions table -- keyed table:SalesTable by producer name, per-tenant fields the producer's own vocabulary, exactly as the definitions facility specifies. This table is tree-only because its other half moved out: the workbook's general defined names now ride the ContentDocument's own names field (typed/xlsx/defined-names.ts's readWorkbookNames, ExaDev/documents.js's per-cell-fonts-and-names schema widening), which crosses the flat/tree boundary natively where a definitions entry cannot -- so a named range needs no definitions entry of its own here, and duplicating it in both channels would double-write every general definedName on a tree round trip.

const TABLE_REL_SUFFIX = "/table";

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

// The workbook's definitions table, or undefined when it carries no table object -- absent rather than empty, so a plain workbook's tree is field-for-field what it was.
export function readWorkbookDefinitions(
  pkg: Package,
): DefinitionsTable | undefined {
  const out: DefinitionsTable = {};
  readTableEntries(pkg, out);
  return Object.keys(out).length === 0 ? undefined : out;
}

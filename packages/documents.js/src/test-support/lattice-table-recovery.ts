import type { LayoutPage } from "pdf-codec";
import { detectGridLattice } from "../layout/lattice";
import type { RecoveredTable } from "../layout/reconstruct-presentations-prod";
import { recoverTable } from "../layout/reconstruct-tables";

/**
 * Untagged table recovery as it stood before a table ruled only between its rows was read (ruled-rows.ts): the page's gridline lattice, when it has one, read as its one table, and nothing else. The reference a differential test holds recoverTables to on every page that has a lattice, since reading a ruled-row table is meant to add tables beside a lattice, never to change the lattice's own.
 * @param page - the page to read
 * @param pageIndex - the page's index, stamped on every frame
 * @returns the lattice's table, or no table when the page has no lattice or the lattice holds no text
 */
export function latticeOnlyTables(
  page: LayoutPage,
  pageIndex: number,
): RecoveredTable[] {
  const lattice = detectGridLattice(page.items);
  const table =
    lattice === undefined ? undefined : recoverTable(page, pageIndex, lattice);
  return table === undefined ? [] : [table];
}

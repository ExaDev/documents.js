import { readPdf } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { odsToPdf } from "../convert/convert";
import { latticeOnlyTables } from "../test-support/lattice-table-recovery";
import { gridOdsBytes } from "../test-support/ods";
import {
  characterSpacedTablePdf,
  fullyRuledTwoLineHeaderTablePdf,
} from "../test-support/pdf";
import { detectGridLattice } from "./lattice";
import { recoverTables } from "./reconstruct-tables";

// Reading a table ruled only between its rows adds a path beside the gridline lattice; on a page whose table is fully ruled, the tables recovered must be exactly those the lattice alone gave before that path existed. Every PDF fixture in test-support whose pages draw a full lattice is held to that, and so is the grid the spreadsheet writer draws.
const LATTICE_FIXTURES: readonly (readonly [
  string,
  () => Uint8Array<ArrayBuffer>,
])[] = [
  ["a table of character-spaced rows", characterSpacedTablePdf],
  [
    "a fully ruled table with a two-line header",
    () => fullyRuledTwoLineHeaderTablePdf("upright"),
  ],
  [
    "a fully ruled table with a two-line header on a page turned a quarter",
    () => fullyRuledTwoLineHeaderTablePdf("sideways"),
  ],
  ["a spreadsheet grid rendered to PDF", () => odsToPdf(gridOdsBytes())],
];

describe("recoverTables on a page with a full lattice", () => {
  it.each(LATTICE_FIXTURES)(
    "recovers what the lattice alone recovers, for %s",
    (_, fixture) => {
      const pages = readPdf(fixture()).pages;
      const latticePages = pages.flatMap((page, pageIndex) =>
        detectGridLattice(page.items) === undefined
          ? []
          : [{ page, pageIndex }],
      );
      // A fixture with no lattice would make the comparison hold vacuously.
      expect(latticePages.length).toBeGreaterThan(0);
      for (const { page, pageIndex } of latticePages) {
        expect(recoverTables(page, pageIndex, undefined)).toEqual(
          latticeOnlyTables(page, pageIndex),
        );
      }
    },
  );
});

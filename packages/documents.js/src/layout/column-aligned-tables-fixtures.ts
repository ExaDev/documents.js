/**
 * Page fixtures shared by `column-aligned-tables.test.ts` and `column-aligned-tables-sparse-rows.test.ts`, its own module so neither test file imports the other, matching this repo's own `*-test-fixtures.ts` convention.
 */
import type { ColumnAlignedTable } from "./column-aligned-tables";
import type { LayoutDocument } from "pdf-codec";

/** The type size every fixture run is set in. */
export const FIXTURE_SIZE_PT = 12;

/** A one-page `LayoutDocument` whose only items are the given positioned text runs: every field `LayoutDocumentSchema` requires but these tests don't vary is filled with a fixed value. A run states its advance (`widthPt`) only when the test gives one, as a PDF writer does not always report it. */
export function page(
  items: { text: string; xPt: number; yPt: number; widthPt?: number }[],
): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages: [
      {
        widthPt: 612,
        heightPt: 792,
        items: items.map(({ text, xPt, yPt, widthPt }) => ({
          kind: "text" as const,
          text,
          xPt,
          yPt,
          font: {
            family: "Helvetica",
            weight: "normal" as const,
            style: "normal" as const,
          },
          sizePt: FIXTURE_SIZE_PT,
          color: { r: 0, g: 0, b: 0 },
          ...(widthPt === undefined ? {} : { widthPt }),
        })),
      },
    ],
    images: {},
  };
}

/** Every row of a recovered table as its cells' text, top to bottom; no rows for a table that is absent. */
export const cellsOf = (recovered: ColumnAlignedTable | undefined) =>
  (recovered?.table.rows ?? []).map((row) =>
    row.cells.map((cell) =>
      cell.blocks
        .flatMap((block) =>
          block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
        )
        .join(""),
    ),
  );

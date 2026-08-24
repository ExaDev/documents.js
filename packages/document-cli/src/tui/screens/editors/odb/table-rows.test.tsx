import type { ContentCellValue, HsqldbTable } from "documents.js";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { settle, waitForFrame } from "../../../test-support.js";
import { OdbHarness } from "./test-support.js";

const BIG_TABLE_ROW_COUNT = 60;
const ESCAPE_CHAR_CODE = 27;
// PageDown -- Escape, then [, 6, ~ -- the xterm/rxvt sequence ink's own parse-keypress.js maps to key.pageDown (see node_modules/ink/build/parse-keypress.js). Built via String.fromCharCode with the plain numeric escape code, not a literal or backslash-escaped control character in this source file's own text, since a raw control byte written directly into this file has proven not to survive edits to it reliably.
const PAGE_DOWN = String.fromCharCode(ESCAPE_CHAR_CODE) + "[6~";
// 8 presses moving the foundation's own PAGE_JUMP_ROWS (10, see keybindings/use-navigation-input.ts) each is comfortably past BIG_TABLE_ROW_COUNT - 1 (59), so the selection is guaranteed to have clamped at the very last row by the end of the loop regardless of the exact per-press jump size.
const PAGE_DOWN_PRESSES = 8;
// Real wall-clock settle delays between each of this test's several keypresses (see test-support.ts's own settle()) make this a genuinely slower test than a typical unit test, especially once the rest of the suite's own Ink renders are competing for the same worker thread -- give it real headroom rather than let it flake under load.
const PAGE_DOWN_TEST_TIMEOUT_MS = 15_000;

function buildBigTable(): HsqldbTable {
  const rows: ContentCellValue[][] = [];
  for (let index = 0; index < BIG_TABLE_ROW_COUNT; index += 1) {
    rows.push([
      { kind: "string", value: `Row${String(index).padStart(3, "0")}` },
    ]);
  }
  return {
    tableName: "BIG",
    columns: [{ name: "LABEL", type: "VARCHAR" }],
    rows,
  };
}

describe("OdbTableRowsScreen", () => {
  it("renders the table name, its own column headers with their types, and every cell via hsqldbCellDisplayText", async () => {
    const table: HsqldbTable = {
      tableName: "CUSTOMERS",
      columns: [
        { name: "ID", type: "INTEGER" },
        { name: "NAME", type: "VARCHAR" },
      ],
      rows: [
        [
          { kind: "number", value: 1 },
          { kind: "string", value: "Ada Lovelace" },
        ],
      ],
    };
    const { lastFrame, stdin } = render(<OdbHarness tables={[table]} />);
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("CUSTOMERS"),
    );
    await settle();

    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Ada Lovelace"),
    );
    expect(frame).toContain("ID (INTEGER)");
    expect(frame).toContain("NAME (VARCHAR)");
    expect(frame).toContain("1");
    expect(frame).toContain("Ada Lovelace");
  });

  it(
    "scrolls its viewport with PageDown, since the row array is already fully materialised and paging is purely a rendering concern",
    async () => {
      const table = buildBigTable();
      const { lastFrame, stdin } = render(<OdbHarness tables={[table]} />);
      await waitForFrame(lastFrame, (candidate) => candidate.includes("BIG"));
      await settle();
      stdin.write("\r");

      const initialFrame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Row000"),
      );
      expect(initialFrame).toContain("Row000");
      await settle();

      for (let press = 0; press < PAGE_DOWN_PRESSES; press += 1) {
        stdin.write(PAGE_DOWN);
        await settle();
      }

      const lastRowLabel = `Row${String(BIG_TABLE_ROW_COUNT - 1).padStart(3, "0")}`;
      const scrolledFrame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes(lastRowLabel),
      );
      expect(scrolledFrame).toContain(lastRowLabel);
      expect(scrolledFrame).not.toContain("Row000");
    },
    PAGE_DOWN_TEST_TIMEOUT_MS,
  );
});

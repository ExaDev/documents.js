import type {} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpdContent } from "./read";
import {
  buildWpdFile,
  embeddedSubfunction,
  eolFunction,
  text,
  variableFunction,
  word,
} from "./test-support/build-wpd";
import {
  CELL_FILL_COLORS,
  CHARACTER_GROUP,
  DISPLAY_NUMBER_GROUP,
  EOL_TABLE_OFF,
  EOL_TABLE_ROW,
  HARD_EOL,
  STYLE_GROUP,
  paragraphsOf,
  readDocumentArea,
  tableDefinition,
  tablesOf,
} from "./test-support/structure-fixtures";

describe("table cell attribute gaps", () => {
  const CELL_FORMULA = 0x81;

  it("reports a truncated embedded subfunction list with the exact message", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("cell"),
        ...variableFunction({
          group: 0xd0,
          subgroup: EOL_TABLE_ROW,
          // deletableSize word claims 50 bytes of deletable data, but none follow — overruns the function's own nonDeletable region.
          nonDeletable: [...word(50)],
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    void document;
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.TableAttributesTruncated,
    );
    expect(found?.message).toBe(
      "A cell's embedded attribute list held a record of undocumented length, so the attributes after it were not read.",
    );
  });

  it("reports an unresolved table formula with the exact message, keeping the cell's own text", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("42"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          // A formula subfunction whose own token bytes readTableFormula cannot decode with confidence.
          embedded: embeddedSubfunction(CELL_FORMULA, [
            ...word(1),
            0xff, // not a recognised formula token code
            0,
            0,
          ]),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    void document;
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.TableFormulaUnresolved,
    );
    expect(found?.message).toBe(
      "A table cell carries a formula this reader could not decode with confidence, so the cell keeps its displayed text but not the formula that produced it.",
    );
  });

  it("carries a resolved table formula onto the cell, reporting nothing", () => {
    // A1+B1: a cell reference (code 64, absolute-flag word, row word, column word) for A1, the binary "+" token (1), then the same cell-reference shape for B1 — the identical byte pattern stream/formula.test.ts proves readTableFormula resolves to "A1+B1" on its own, here wrapped in the embedded subfunction's own leading and trailing length-word framing.
    const cellA1 = [64, ...word(0), ...word(0)];
    const cellB1 = [64, ...word(0), ...word(1)];
    const formulaTokens = [...cellA1, 1, ...cellB1];
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("5"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          embedded: embeddedSubfunction(CELL_FORMULA, [
            ...word(formulaTokens.length),
            ...formulaTokens,
            ...word(formulaTokens.length),
          ]),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(cell?.formula).toBe("A1+B1");
    // A formula that DID resolve must not also trigger the "could not decode with confidence" diagnostic — the two are mutually exclusive outcomes of the same read.
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.TableFormulaUnresolved,
      ),
    ).toBe(false);
  });

  it("resolves a blended (pattern) cell fill and reports it", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("shaded"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          // foreground (10,20,30) shade 200 (unused), background (0,255,0), background shade 128 — not FULL_SHADE (255), so the fill blends.
          embedded: embeddedSubfunction(
            CELL_FILL_COLORS,
            [10, 20, 30, 200, 0, 255, 0, 128],
          ),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(cell?.background?.kind).toBe("pattern");
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.CellFillBlended,
    );
    expect(found?.message).toBe(
      "A cell is filled with a shaded blend of two colours, resolved to a 'pattern' fill whose density is this reader's own best-effort derivation, not a value confirmed against a specification.",
    );
  });

  it("does not report an unresolved formula for a cell that carries no formula subfunction at all", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("plain"),
        ...eolFunction({ subgroup: EOL_TABLE_ROW }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.TableFormulaUnresolved,
      ),
    ).toBe(false);
  });

  it("does not report a blended fill for a cell with a full-shade (solid) fill", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...tableDefinition([1200]),
        ...text("solid"),
        ...eolFunction({
          subgroup: EOL_TABLE_ROW,
          // foreground unused (shade 0), background (0,0,255) at FULL_SHADE (255) — a plain solid fill, not a blend.
          embedded: embeddedSubfunction(
            CELL_FILL_COLORS,
            [0, 0, 0, 0, 0, 0, 255, 255],
          ),
        }),
        ...eolFunction({ subgroup: EOL_TABLE_OFF }),
      ]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    const cell = tablesOf(document)[0]?.rows[0]?.cells[0];
    expect(cell?.background?.kind).toBe("solid");
    expect(
      diagnostics.some((d) => d.code === WpdDiagnosticCodes.CellFillBlended),
    ).toBe(false);
  });
});

describe("style resolution depth and scope handling", () => {
  const GLOBAL_ON = 0x0a;
  const GLOBAL_OFF = 0x0b;
  const NORMAL_STYLE_PACKET_TYPE = 0x30;
  const NO_SYSTEM_STYLE = 0xff;

  function normalStylePacket(
    prefixIdOfNextStyle: number | undefined,
    beginBytes: readonly number[],
  ) {
    const headerSize = 2 + 2 + 16;
    const bytes = new Uint8Array(headerSize + beginBytes.length);
    bytes[2] = 4;
    const putUint32 = (offset: number, value: number) => {
      bytes[offset] = value & 0xff;
      bytes[offset + 1] = (value >>> 8) & 0xff;
      bytes[offset + 2] = (value >>> 16) & 0xff;
      bytes[offset + 3] = (value >>> 24) & 0xff;
    };
    putUint32(4, headerSize);
    putUint32(8, 0);
    putUint32(12, beginBytes.length);
    bytes.set(beginBytes, headerSize);
    void prefixIdOfNextStyle;
    return { packetType: NORMAL_STYLE_PACKET_TYPE, bytes };
  }

  // A style whose own begin block opens ANOTHER style scope (naming the same packet again, at a fresh prefix ID) recurses through applyStylePacketBegin; repeating that packet at every depth walks past MAX_STYLE_RESOLUTION_DEPTH (16) on genuinely self-referential input.
  it("stops resolving a style chain deeper than MAX_STYLE_RESOLUTION_DEPTH and reports it", () => {
    const prefixIds = Array.from({ length: 20 }, (_, i) => i + 1);
    const packets = prefixIds.map((id) =>
      normalStylePacket(
        id,
        variableFunction({
          group: STYLE_GROUP,
          subgroup: GLOBAL_ON,
          prefixIds: [id + 1],
          nonDeletable: [0, 0, NO_SYSTEM_STYLE],
        }),
      ),
    );
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...variableFunction({
            group: STYLE_GROUP,
            subgroup: GLOBAL_ON,
            prefixIds: [1],
            nonDeletable: [0, 0, NO_SYSTEM_STYLE],
          }),
          ...text("deep"),
        ],
        packets,
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    void document;
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.StyleResolutionDepthExceeded,
    );
    expect(found?.message).toBe(
      "A chain of styles resolving one another's own packets ran deeper than this reader will follow, so the deepest style's own direct formatting was not applied.",
    );
  });

  // Exactly MAX_STYLE_RESOLUTION_DEPTH (16) successful recursions must leave the 17th attempt refused: a chain one level too shallow to force a refusal under `>` (which would only trigger once depth genuinely exceeds 16) must trigger the guard under the real `>=` boundary. With a chain of exactly 17 style packets and nothing left to recurse into after the 17th, an off-by-one guard would let the whole chain resolve and never report anything at all.
  it("refuses exactly the chain's 17th style recursion, not the 18th", () => {
    const depth = 17;
    const prefixIds = Array.from({ length: depth }, (_, i) => i + 1);
    const packets = prefixIds.map((id) =>
      normalStylePacket(
        id,
        id === depth
          ? variableFunction({
              group: CHARACTER_GROUP,
              subgroup: 0x1b, // a font size change: a real, non-empty begin block that opens no further style — nothing left to over-recurse into
              nonDeletable: [0x58, 0x02, 0, 0, 0, 0, 0, 0],
            })
          : variableFunction({
              group: STYLE_GROUP,
              subgroup: GLOBAL_ON,
              prefixIds: [id + 1],
              nonDeletable: [0, 0, NO_SYSTEM_STYLE],
            }),
      ),
    );
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [
          ...variableFunction({
            group: STYLE_GROUP,
            subgroup: GLOBAL_ON,
            prefixIds: [1],
            nonDeletable: [0, 0, NO_SYSTEM_STYLE],
          }),
          ...text("deep"),
        ],
        packets,
      ),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    expect(
      diagnostics.filter(
        (d) => d.code === WpdDiagnosticCodes.StyleResolutionDepthExceeded,
      ),
    ).toHaveLength(1);
  });

  // The resolution depth counter must return to its starting value once a style's own begin block finishes resolving, not keep climbing — otherwise a long enough run of entirely separate, non-nested style scopes would eventually (and wrongly) trip the same depth guard a genuinely self-referential chain trips.
  it("never accumulates resolution depth across sibling, non-nested style scopes", () => {
    const siblingCount = 9; // enough that a counter incrementing instead of decrementing after each one would cross MAX_STYLE_RESOLUTION_DEPTH (16)
    const prefixIds = Array.from({ length: siblingCount }, (_, i) => i + 1);
    const packets = prefixIds.map((id) =>
      normalStylePacket(
        id,
        variableFunction({
          group: CHARACTER_GROUP,
          subgroup: 0x1b, // a font size change: real, harmless direct formatting that opens no further style
          nonDeletable: [0x58, 0x02, 0, 0, 0, 0, 0, 0],
        }),
      ),
    );
    const documentArea = prefixIds.flatMap((id) => [
      ...variableFunction({
        group: STYLE_GROUP,
        subgroup: GLOBAL_ON,
        prefixIds: [id],
        nonDeletable: [0, 0, NO_SYSTEM_STYLE],
      }),
      ...variableFunction({ group: STYLE_GROUP, subgroup: GLOBAL_OFF }),
    ]);
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(buildWpdFile([...documentArea, ...text("done")], packets), {
      sink: (d) => {
        diagnostics.push(d);
      },
    });
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.StyleResolutionDepthExceeded,
      ),
    ).toBe(false);
  });

  // The four intermediate style subfunctions (per style.test.ts: 1, 2, 5, 6, 7, 8) delimit the style's own before/after codes but neither open nor close a scope — one arriving mid-scope must not be mistaken for the scope's own closer.
  it("does not close a style scope on an intermediate subfunction", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: STYLE_GROUP,
        subgroup: GLOBAL_ON,
        prefixIds: [1],
        nonDeletable: [0, 0, 68], // heading level 1
      }),
      ...variableFunction({ group: STYLE_GROUP, subgroup: 1 }), // intermediate, neither opener nor closer
      ...text("Title"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.headingLevel).toBe(1);
  });

  // restoreFormattingSnapshot's own for-of loop must carry every attribute the snapshot held, not just the first: bold AND italic both open before the style scope, the style's own begin block changes neither, and both must survive the scope's close.
  it("restores every active attribute the snapshot held, not only one", () => {
    const document = readDocumentArea(
      [
        0xf2,
        12,
        0xf2, // bold on (ATTRIBUTE_ON, BOLD, ATTRIBUTE_ON)
        0xf2,
        8,
        0xf2, // italic on (ATTRIBUTE_ON, ITALICS, ATTRIBUTE_ON)
        ...variableFunction({
          group: STYLE_GROUP,
          subgroup: GLOBAL_ON,
          prefixIds: [1],
          nonDeletable: [0, 0, NO_SYSTEM_STYLE],
        }),
        ...text("styled"),
        ...variableFunction({ group: STYLE_GROUP, subgroup: GLOBAL_OFF }),
        ...text("after"),
      ],
      [normalStylePacket(undefined, [0xf2, 14, 0xf2])], // begin block turns on underline too
    );
    const runs = paragraphsOf(document)[0]?.runs;
    expect(runs?.[0]).toEqual({
      text: "styled",
      bold: true,
      italic: true,
      underline: true,
    });
    expect(runs?.[1]).toEqual({ text: "after", bold: true, italic: true });
  });
});

describe("outline numbering gaps", () => {
  it("keeps the first paragraph number display's level when a second one arrives before it closes", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [1],
      }),
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [5], // a second On, nested — must not overwrite the first level
      }),
      ...text("Item"),
      HARD_EOL,
    ]);
    expect(paragraphsOf(document)[0]?.list).toEqual({ level: 1 });
  });

  it("does not let numberDisplayDepth go negative, which would wrongly suppress later text", () => {
    const document = readDocumentArea([
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }), // Off with no matching On
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }), // a second stray Off
      ...variableFunction({
        group: DISPLAY_NUMBER_GROUP,
        subgroup: 0x0c,
        nonDeletable: [0],
      }), // On: depth must become exactly 1, not climb out of a negative hole
      ...text("hidden"),
      ...variableFunction({ group: DISPLAY_NUMBER_GROUP, subgroup: 0x0d }),
      ...text("shown"),
    ]);
    expect(
      paragraphsOf(document)[0]
        ?.runs.map((r) => r.text)
        .join(""),
    ).toBe("shown");
  });
});

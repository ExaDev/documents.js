import {
  OfficeArtClientTextbox,
  OfficeArtFOPT,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  OfficeArtTertiaryFOPT,
  RT_TextHeaderAtom,
} from "../record/types";
import {
  concatBytes,
  i32le,
  u32le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import {
  PROPERTY_ROTATION,
  PROPERTY_TABLE_PROPERTIES,
  PROPERTY_TABLE_ROW_PROPERTIES,
  TABLE_FLAG_IS_TABLE,
  degreesToFixedPoint,
  writeIMsoArray,
  writeShapePropertyTable,
} from "../drawing/properties";
import { TEXT_TYPE_BODY } from "../text/atoms";
import { clientAnchor, fsp, textBytesAtom } from "./presentation-atoms";

// The table's own rectangle and per-row height, in master units — fixed here so every table fixture's geometry is derivable by hand. TABLE_ROW_HEIGHT is exported for the byte-level fidelity tests, which decode the fixture's own tableRowProperties IMsoArray and need the same value to compare against.
const TABLE_TOP = 2000;
const TABLE_LEFT = 1440;
const TABLE_RIGHT = 4896;
export const TABLE_ROW_HEIGHT = 480;

// PowerPoint's own default light scheme — an arbitrary but fixed and realistic 8-entry colour scheme, independently chosen from color-scheme-write.ts's own defaults (see slideSchemeColorSchemeAtom's own comment). Module scope and exported, like TABLE_ROW_HEIGHT above, because the byte-level fidelity tests parse the master's own SlideSchemeColorSchemeAtom bytes directly and need the same values to compare against — read.ts itself only ever resolves one slot of this scheme (whichever a run's own ColorIndexStruct names), so nothing but a direct byte comparison exercises the other seven.
// Each slot's own red/green/blue named separately from its tuple, since @typescript-eslint/no-magic-numbers checks an array literal's own elements independently of the array they compose.
const MASTER_BACKGROUND_RGB = 0xff;
const MASTER_SHADOW_RGB = 0x80;
const MASTER_FILL_RED = 0xe6;
const MASTER_FILL_GREEN = 0xf2;
const MASTER_FILL_BLUE = 0xff;
const MASTER_ACCENT_1_RED = 0x1a;
const MASTER_ACCENT_1_GREEN = 0x4b;
const MASTER_ACCENT_1_BLUE = 0x8c;
const MASTER_ACCENT_2_BLUE = 0x4b;
const MASTER_ACCENT_3_RED = 0x4b;
const MASTER_ACCENT_3_GREEN = 0x8c;
export const MASTER_COLOR_SCHEME: readonly (readonly [
  number,
  number,
  number,
])[] = [
  [MASTER_BACKGROUND_RGB, MASTER_BACKGROUND_RGB, MASTER_BACKGROUND_RGB], // background
  [0x00, 0x00, 0x00], // text
  [MASTER_SHADOW_RGB, MASTER_SHADOW_RGB, MASTER_SHADOW_RGB], // shadow
  [0x00, 0x00, 0x00], // title text
  [MASTER_FILL_RED, MASTER_FILL_GREEN, MASTER_FILL_BLUE], // fill
  [MASTER_ACCENT_1_RED, MASTER_ACCENT_1_GREEN, MASTER_ACCENT_1_BLUE], // Accent 1
  [MASTER_ACCENT_1_BLUE, MASTER_ACCENT_1_RED, MASTER_ACCENT_2_BLUE], // Accent 2
  [MASTER_ACCENT_3_RED, MASTER_ACCENT_3_GREEN, MASTER_ACCENT_1_RED], // Accent 3
];

// tableRowProperties_complex is one 4-byte signed integer per row, its own minimum height in master units.
const ROW_HEIGHT_ELEMENT_BYTES = 4;

// Arbitrary shape-id offsets clear of every real cell's own spid range (spid+1 through spid+rowCount*columnCount), so the two gridline shapes never collide with a genuine cell.
const GRIDLINE_ZERO_WIDTH_SPID_OFFSET = 900;
const GRIDLINE_ZERO_HEIGHT_SPID_OFFSET = 901;

// A native table group: the group shape opens with the FSPGR child coordinate system ([MS-ODRAW] 2.2.14 puts shapeGroup first), carries fGroup, states tableProperties fIsTable and tableRowProperties as a complex IMsoArray of row minimum heights in the tertiary property table where a real producer puts them, and anchors the whole table with a client anchor; then one plain text-box shape per cell, each carrying its own client anchor — the grid itself lives nowhere but in those anchors.
export function tableShape(
  spid: number,
  table: {
    readonly rows: readonly (readonly string[])[];
    readonly rotationDeg?: number;
    readonly reverseCellOrder?: boolean;
    readonly includeGridlineShapes?: boolean;
  },
): Uint8Array<ArrayBuffer> {
  const columnCount = Math.max(...table.rows.map((row) => row.length), 1);
  const rowCount = table.rows.length;
  const bottom = TABLE_TOP + rowCount * TABLE_ROW_HEIGHT;
  const columnWidth = Math.floor((TABLE_RIGHT - TABLE_LEFT) / columnCount);
  const rowHeights = writeIMsoArray(
    table.rows.map(() => TABLE_ROW_HEIGHT),
    ROW_HEIGHT_ELEMENT_BYTES,
  );
  const groupShape = container(OfficeArtSpContainer, [
    atom(
      OfficeArtFSPGR,
      concatBytes(
        i32le(TABLE_LEFT),
        i32le(TABLE_TOP),
        i32le(TABLE_RIGHT),
        i32le(bottom),
      ),
      { recVer: 0x1 },
    ),
    fsp(spid, 1 << 0),
    ...(table.rotationDeg === undefined
      ? []
      : [
          writeShapePropertyTable(OfficeArtFOPT, [
            {
              opid: PROPERTY_ROTATION,
              op: degreesToFixedPoint(table.rotationDeg),
            },
          ]),
        ]),
    writeShapePropertyTable(OfficeArtTertiaryFOPT, [
      { opid: PROPERTY_TABLE_PROPERTIES, op: TABLE_FLAG_IS_TABLE },
      {
        opid: PROPERTY_TABLE_ROW_PROPERTIES,
        op: rowHeights.length,
        complex: rowHeights,
      },
    ]),
    clientAnchor(TABLE_TOP, TABLE_LEFT, TABLE_RIGHT, bottom),
  ]);
  const cells = table.rows.flatMap((row, rowIndex) =>
    row.map((text, columnIndex) => {
      const cellTop = TABLE_TOP + rowIndex * TABLE_ROW_HEIGHT;
      const cellLeft = TABLE_LEFT + columnIndex * columnWidth;
      return container(OfficeArtSpContainer, [
        fsp(spid + 1 + rowIndex * columnCount + columnIndex, 0),
        clientAnchor(
          cellTop,
          cellLeft,
          cellLeft + columnWidth,
          cellTop + TABLE_ROW_HEIGHT,
        ),
        container(OfficeArtClientTextbox, [
          atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_BODY)),
          textBytesAtom(text),
        ]),
      ]);
    }),
  );
  // Two degenerate shapes sharing the group's own coordinate system — one zero-width (left equals right), one zero-height (top equals bottom) — placed well clear of every real cell's own anchor, spelling the gridline shapes a genuine PowerPoint-authored table carries alongside its actual cells.
  const gridlineShapes =
    table.includeGridlineShapes === true
      ? [
          container(OfficeArtSpContainer, [
            fsp(spid + GRIDLINE_ZERO_WIDTH_SPID_OFFSET, 0),
            clientAnchor(TABLE_TOP, TABLE_RIGHT, TABLE_RIGHT, bottom),
          ]),
          container(OfficeArtSpContainer, [
            fsp(spid + GRIDLINE_ZERO_HEIGHT_SPID_OFFSET, 0),
            clientAnchor(bottom, TABLE_LEFT, TABLE_RIGHT, bottom),
          ]),
        ]
      : [];
  const orderedCells =
    table.reverseCellOrder === true ? [...cells].reverse() : cells;
  return container(OfficeArtSpgrContainer, [
    groupShape,
    ...gridlineShapes,
    ...orderedCells,
  ]);
}

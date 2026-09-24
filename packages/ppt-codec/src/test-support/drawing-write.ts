// Shared fixtures and record-walking helpers for the writeSlideDrawing suites. They live here rather than in one of the test files because the drawing-write tests are split across shapes-write.test.ts and shapes-write-tables.test.ts, and both need the same way of reaching into a written drawing's record tree. Excluded from the published build by tsdown.config.ts's own entry list, like every other src/test-support module.

import type {
  ContentShape,
  ContentTable,
  ContentTableRow,
} from "document-schema.js";
import { NOOP_PPT_DIAGNOSTIC_SINK } from "../diagnostics";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import {
  OfficeArtDgContainer,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
} from "../record/types";
import { readShapeProperties } from "../drawing/properties";
import {
  type DrawingWriteContext,
  type writeSlideDrawing,
} from "../drawing/shapes-write";

export const CONTEXT: DrawingWriteContext = {
  fontIndexOf: () => 0,
  blipIndexOf: () => 1,
  describeMessage: (reason) => reason,
  sink: NOOP_PPT_DIAGNOSTIC_SINK,
  strict: false,
};

export const DEFAULT_TEXT_INSETS = {
  insetLeftPt: 0.1 * 72,
  insetTopPt: 0.05 * 72,
  insetRightPt: 0.1 * 72,
  insetBottomPt: 0.05 * 72,
};

export function textShape(overrides: Partial<ContentShape> = {}): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    ...DEFAULT_TEXT_INSETS,
    blocks: [],
    ...overrides,
  };
}

// RT_Drawing -> OfficeArtDgContainer -> OfficeArtSpgrContainer -> [patriarch, ...content shapes].
export function spgrChildren(written: ReturnType<typeof writeSlideDrawing>) {
  const record = readRecordAt(written.bytes, 0);
  const dgContainer = findChild(childRecords(record), OfficeArtDgContainer);
  if (dgContainer === undefined) {
    throw new Error("expected an OfficeArtDgContainer");
  }
  const spgrContainer = findChild(
    childRecords(dgContainer),
    OfficeArtSpgrContainer,
  );
  if (spgrContainer === undefined) {
    throw new Error("expected an OfficeArtSpgrContainer");
  }
  return childRecords(spgrContainer);
}

export function firstContentShapeRecord(
  written: ReturnType<typeof writeSlideDrawing>,
) {
  const [, shapeRecord] = spgrChildren(written).filter(
    (r) => r.header.recType === OfficeArtSpContainer,
  );
  if (shapeRecord === undefined) {
    throw new Error("expected the patriarch plus one content shape");
  }
  return shapeRecord;
}

export function firstShapeProperties(
  written: ReturnType<typeof writeSlideDrawing>,
) {
  return readShapeProperties(firstContentShapeRecord(written));
}

// A table group is its own nested OfficeArtSpgrContainer sitting alongside the patriarch, whose own first child is the group shape (the table's own OfficeArtSpContainer) carrying the property table this reads.
export function firstTableGroupProperties(
  written: ReturnType<typeof writeSlideDrawing>,
) {
  const tableSpgr = spgrChildren(written).find(
    (r) => r.header.recType === OfficeArtSpgrContainer,
  );
  if (tableSpgr === undefined) {
    throw new Error("expected a nested table OfficeArtSpgrContainer");
  }
  const [groupShape] = childRecords(tableSpgr);
  if (groupShape === undefined) {
    throw new Error("expected the table group's own shape first");
  }
  return readShapeProperties(groupShape);
}

export function tableShape(
  rows: readonly ContentTableRow[],
  columnWidthsPt: readonly number[] = [],
  overrides: Partial<ContentShape> = {},
): ContentShape {
  const table: ContentTable = {
    kind: "table",
    rows: [...rows],
    columns: columnWidthsPt.map((widthPt) => ({ widthPt })),
  };
  return textShape({ blocks: [table], ...overrides });
}

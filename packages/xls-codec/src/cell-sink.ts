// The accumulating cell builder the sheet mappers share: rows, columns and cells all land in one list as the mapper walks the raw sheet.
import type { ContentSheetCell } from "document-schema.js";

export interface CellSink {
  readonly cells: ContentSheetCell[];
}

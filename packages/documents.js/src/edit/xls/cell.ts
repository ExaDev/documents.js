import type {
  Alignment,
  ContentCellFill,
  ContentCellBorders,
  ContentSheetCell,
  ContentSheetCellComment,
  ContentCellValue,
} from "document-schema.js";

// The mechanical plain rendering of a value: what the value setter derives displayText from, so a cell created or re-valued through this editor always satisfies the schema's own displayText-is-required rule without the caller supplying a rendered string. Deliberately not a number-format engine -- a cell whose display needs a producer format or locale symbols gets its displayText set explicitly afterwards, and the numberFormatCode setter carries the pattern alongside.
export function displayTextOfValue(value: ContentCellValue): string {
  switch (value.kind) {
    case "empty":
      return "";
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "number":
    case "percentage":
    case "currency":
      return String(value.value);
    default:
      return value.value;
  }
}

// A live view over one ContentSheetCell object inside a sheet's own sparse cells array -- the same plain-ContentDocument live-view contract DocEditor/MarkdownEditor apply (there is no XmlElement tree under a .xls: xls-codec reads and writes the ContentDocument directly). Setting value re-derives displayText through displayTextOfValue unless the caller overrides displayText afterwards -- the schema requires a display string on every cell that exists, and a value whose rendering was left stale would be a silent lie to every consumer that renders from displayText.
//
// formula is deliberately getter-only: xls-codec's writer has no formula write path at all (see that package's own README scope -- formulas are a read-only gap), so a formula setter here would build content the very next toBytes() drops.
export class XlsCell {
  private readonly container: ContentSheetCell[];
  private readonly node: ContentSheetCell;
  private removed = false;

  constructor(container: ContentSheetCell[], node: ContentSheetCell) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentSheetCell {
    if (this.removed) {
      throw new Error(
        "this XlsCell has been removed from its sheet and can no longer be used",
      );
    }
    return this.node;
  }

  get row(): number {
    return this.live().row;
  }

  get column(): number {
    return this.live().column;
  }

  get value(): ContentCellValue {
    return this.live().value;
  }

  set value(value: ContentCellValue) {
    const node = this.live();
    node.value = value;
    node.displayText = displayTextOfValue(value);
  }

  get displayText(): string {
    return this.live().displayText;
  }

  // The explicit rendering override -- set this AFTER value when a cell's display needs more than the mechanical plain rendering (a currency symbol, a locale grouping, a producer number format).
  set displayText(text: string) {
    this.live().displayText = text;
  }

  get numberFormatCode(): string | undefined {
    return this.live().numberFormatCode;
  }

  set numberFormatCode(code: string | undefined) {
    const node = this.live();
    if (code === undefined) {
      delete node.numberFormatCode;
    } else {
      node.numberFormatCode = code;
    }
  }

  get formula(): string | undefined {
    return this.live().formula;
  }

  get colSpan(): number | undefined {
    return this.live().colSpan;
  }

  set colSpan(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.colSpan;
    } else {
      node.colSpan = value;
    }
  }

  get rowSpan(): number | undefined {
    return this.live().rowSpan;
  }

  set rowSpan(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.rowSpan;
    } else {
      node.rowSpan = value;
    }
  }

  get background(): ContentCellFill | undefined {
    return this.live().background;
  }

  set background(fill: ContentCellFill | undefined) {
    const node = this.live();
    if (fill === undefined) {
      delete node.background;
    } else {
      node.background = fill;
    }
  }

  get borders(): ContentCellBorders | undefined {
    return this.live().borders;
  }

  set borders(value: ContentCellBorders | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.borders;
    } else {
      node.borders = value;
    }
  }

  get alignment(): Alignment | undefined {
    return this.live().alignment;
  }

  set alignment(value: Alignment | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.alignment;
    } else {
      node.alignment = value;
    }
  }

  get comment(): ContentSheetCellComment | undefined {
    return this.live().comment;
  }

  set comment(value: ContentSheetCellComment | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.comment;
    } else {
      node.comment = value;
    }
  }

  remove(): void {
    const node = this.live();
    const index = this.container.indexOf(node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}

import type { Package, XmlElement, XmlNode } from 'odf.js';
import { parseCellReference } from 'document-schema.js';
import { attr } from 'ooxml.js';
import type { ContentEmbeddedObject, ContentSheetImage, ContentSheetPrintSettings } from 'document-schema.js';
import { removeChild, setAttr } from '../../xml/edit';
import { COVERED_CELL_TAG, resolveCellNode } from './address';
import { OdsCell } from './cell';
import { ensureColumnDefaultWidth, ensureRowDefaultHeight, writeColumnHidden, writeColumnWidth, writeRowHeight, writeRowHidden } from './column-row';
import { insertSheetEmbeddedObject, insertSheetImage } from './floating';
import { readSheetPrintSettings, writeSheetPrintSettings } from './print-settings';

const NAME_ATTR = 'table:name';

// A live view over a table:table element -- see odt/table.ts's own top-of-file rationale for the same live-view pattern. cell/cellAt are the ONLY way this editor ever reaches a table:table-cell: both route through address.ts's resolveCellNode, which individuates (splitting a repeated run, or gap-filling with a placeholder run, per address.ts's own top-of-file note) rather than ever materializing every position between a sheet's current content and the address a caller actually asked for.
export class OdsSheet {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this OdsSheet has been removed from the spreadsheet and can no longer be used');
    }
    return this.node;
  }

  get name(): string {
    const value = attr(this.live(), NAME_ATTR);
    if (value === undefined) {
      throw new Error('this table:table element has no table:name attribute');
    }
    return value;
  }

  set name(value: string) {
    setAttr(this.live(), NAME_ATTR, value);
  }

  // Reads pageSize/margins/gridlines/headers/pageOrder from this sheet's own table:style-name -> style:master-page-name -> style:page-layout chain; the setter mints a fresh page-layout/master-page/table-style triple and repoints this table:table's own table:style-name to it, rather than mutating whatever it was pointing at before -- see print-settings.ts's own top-of-file note for why. printRange/scale/fitToPages/repeatRows/repeatColumns/manualBreaks are a documented, bounded gap on both sides: the getter never reads them and the setter never writes them (see print-settings.ts).
  get printSettings(): ContentSheetPrintSettings {
    return readSheetPrintSettings(this.pkg, this.live());
  }

  set printSettings(value: ContentSheetPrintSettings) {
    writeSheetPrintSettings(this.pkg, this.live(), value);
  }

  // Mints a fresh style:style[family="table-column"] carrying the given width and repoints the column at `index`'s own table:style-name at it -- see column-row.ts's own top-of-file note for why this exists (an explicit-but-unstyled column reads back at widthPt 0, which src/layout/sheets.ts's own resolveAxis treats as a genuine zero-width reading, not a missing entry). Individuates (or gap-fills) the column the same way cell()/mergeCells already do, so calling this for a column no cell has touched yet is just as safe as calling it after.
  setColumnWidth(index: number, widthPt: number): void {
    writeColumnWidth(this.pkg, this.live(), index, widthPt);
  }

  // The row-height counterpart to setColumnWidth above, mirroring it exactly for style:family="table-row"/style:row-height.
  setRowHeight(index: number, heightPt: number): void {
    writeRowHeight(this.pkg, this.live(), index, heightPt);
  }

  // Sets or clears table:visibility="collapse" on the column at `index` -- a plain attribute directly on the element, independent of setColumnWidth's own style-based sizing (see column-row.ts's own top-of-file note). Safe to call in either order relative to setColumnWidth, and safe to call more than once (unhiding by passing false again removes the attribute rather than leaving a stale "collapse").
  setColumnHidden(index: number, hidden: boolean): void {
    writeColumnHidden(this.pkg, this.live(), index, hidden);
  }

  // The row counterpart to setColumnHidden above.
  setRowHidden(index: number, hidden: boolean): void {
    writeRowHidden(this.pkg, this.live(), index, hidden);
  }

  // Adds a floating raster image, anchored at image.anchorRow/anchorColumn plus image.offsetXPt/offsetYPt -- see floating.ts's own top-of-file note for why a spreadsheet's own draw:frame needs this resolved to an absolute position rather than accepting an already-absolute Box the way OdpSlide.addImage does. Call this AFTER any setColumnWidth/setColumnHidden/setRowHeight/setRowHidden calls this sheet needs, so the anchor resolves against the real column/row sizing rather than whatever this sheet's columns/rows happened to declare beforehand.
  addImage(image: ContentSheetImage): void {
    insertSheetImage(this.pkg, this.live(), image);
  }

  // Adds an embedded object (currently only a real formula sub-object; every other objectKind is a documented, bounded gap -- see floating.ts's own insertSheetEmbeddedObject comment) at object.frame's own already-absolute position.
  addEmbeddedObject(object: ContentEmbeddedObject): void {
    insertSheetEmbeddedObject(this.pkg, this.live(), object);
  }

  // Resolves (individuating/gap-filling as needed) the cell at 0-based (row, column) and wraps it as an OdsCell -- rejecting a position covered by another cell's own merged range outright (see OdsCell's own class doc: a table:covered-table-cell is never wrapped), rather than silently handing back something whose value/formula/displayText setters would corrupt the merge.
  cell(row: number, column: number): OdsCell {
    const tableElement = this.live();
    const node = resolveCellNode(tableElement, row, column);
    if (node.tag === COVERED_CELL_TAG) {
      throw new Error(`cell (${row}, ${column}) is covered by a merged range -- address the merge's own anchor cell instead`);
    }
    ensureColumnDefaultWidth(this.pkg, tableElement, column);
    ensureRowDefaultHeight(this.pkg, tableElement, row);
    return new OdsCell(node, this.pkg);
  }

  // The A1-style equivalent of cell(row, column) -- reuses document-schema.js's canonical parseCellReference for the A1<->index conversion rather than reimplementing spreadsheet column-letter arithmetic.
  cellAt(reference: string): OdsCell {
    const parsed = parseCellReference(reference);
    if (parsed === undefined) {
      throw new Error(`cellAt: "${reference}" is not a valid A1-style cell reference`);
    }
    return this.cell(parsed.row, parsed.column);
  }

  // Merges the rowSpan x colSpan rectangle anchored at (startRow, startColumn): the anchor cell gets table:number-rows-spanned/table:number-columns-spanned (only written when >1, matching how an unmerged cell carries neither attribute at all), and every OTHER covered position in the rectangle is stamped as a table:covered-table-cell -- ODF's own required marker for "this position's content lives at the anchor", never a real table:table-cell of its own (see odf.js's own readOdsContent comment: "the anchor cell's own colSpan/rowSpan already communicates the merge; nothing to emit" for a covered cell it reads back). Returns the anchor as an OdsCell so a caller can set its value/formula/displayText via the same chain. Each covered position is resolved (and, if it fell inside a repeated run, individuated) via the exact same resolveCellNode every ordinary cell() call uses, so REACHING a huge sparse rectangle is exactly as cheap as writing to its own anchor cell alone -- but stamping it is genuinely O(rowSpan x colSpan), not O(1): unlike a single cell write, every covered position needs its own real table:covered-table-cell marker (this does not compress the covered run itself via table:number-columns-repeated), so a very large merge (a hundred rows by a hundred columns, say) does real, proportional work, just never work proportional to how far from the sheet's origin that rectangle sits.
  mergeCells(startRow: number, startColumn: number, rowSpan: number, colSpan: number): OdsCell {
    if (!Number.isInteger(rowSpan) || rowSpan < 1 || !Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(`mergeCells: rowSpan and colSpan must be positive integers, got rowSpan=${rowSpan}, colSpan=${colSpan}`);
    }
    const tableElement = this.live();
    const anchorNode = resolveCellNode(tableElement, startRow, startColumn);
    if (anchorNode.tag === COVERED_CELL_TAG) {
      throw new Error(`mergeCells: (${startRow}, ${startColumn}) is already covered by another merged range`);
    }
    // mergeCells never routes through cell() itself, so every distinct row/column the merge's own rectangle covers needs the same default-width/height stamping cell() applies -- once per distinct index, not once per cell.
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
      ensureRowDefaultHeight(this.pkg, tableElement, startRow + rowOffset);
    }
    for (let columnOffset = 0; columnOffset < colSpan; columnOffset++) {
      ensureColumnDefaultWidth(this.pkg, tableElement, startColumn + columnOffset);
    }
    if (rowSpan > 1) {
      setAttr(anchorNode, 'table:number-rows-spanned', String(rowSpan));
    }
    if (colSpan > 1) {
      setAttr(anchorNode, 'table:number-columns-spanned', String(colSpan));
    }
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
      for (let columnOffset = 0; columnOffset < colSpan; columnOffset++) {
        if (rowOffset === 0 && columnOffset === 0) {
          continue;
        }
        const coveredNode = resolveCellNode(tableElement, startRow + rowOffset, startColumn + columnOffset);
        coveredNode.tag = COVERED_CELL_TAG;
        coveredNode.attributes = [];
        coveredNode.children = [];
      }
    }
    return new OdsCell(anchorNode, this.pkg);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

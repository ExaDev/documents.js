import type { XmlElement, XmlNode } from 'odf.js';
import { el } from '../../xml/fragment';

// The write-side mirror of odf.js's own read-side repeat-count hazard (see its typed/shared/a1.ts and typed/ods/read.ts top-of-file notes): table:number-rows-repeated/table:number-columns-repeated routinely compress a run of thousands or millions of identical rows/columns/cells into ONE XML element. Reading already has to walk past a huge run in O(1) without materializing it (odf.js's own TableCursor); writing into a SPECIFIC position -- e.g. a caller setting row 500's column 50 on an otherwise-empty sheet, or editing row 500,000 of a real spreadsheet whose trailing area is one giant repeated placeholder -- has the mirror-image obligation: never materialize every position between the sheet's current content and the target, either by expanding an existing repeated run element-by-element or by padding the gap with one throwaway element per skipped position. This module is that obligation's entire implementation, shared identically by row addressing (within a table:table) and cell/column addressing (within a table:table-row) -- the algorithm doesn't care whether it's rows-in-a-table or cells-in-a-row, only the tag/repeat-attribute names differ, so replaceRun below is written once and reused for both axes (see sheet.ts).

export const ROW_TAG = 'table:table-row';
export const COLUMN_TAG = 'table:table-column';
export const CELL_TAG = 'table:table-cell';
export const COVERED_CELL_TAG = 'table:covered-table-cell';
export const ROW_REPEAT_ATTR = 'table:number-rows-repeated';
export const COLUMN_REPEAT_ATTR = 'table:number-columns-repeated';

export function isElementWithTag(tag: string): (node: XmlNode) => node is XmlElement {
  return (node: XmlNode): node is XmlElement => node.type === 'element' && node.tag === tag;
}

export function isCellOrCoveredCell(node: XmlNode): node is XmlElement {
  return node.type === 'element' && (node.tag === CELL_TAG || node.tag === COVERED_CELL_TAG);
}

function validateIndex(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${value}`);
  }
}

// The repeat count a run of `node` (and every position it stands in for) represents -- 1 when the attribute is absent or unparseable, mirroring odf.js's own private readRepeatCount in typed/ods/read.ts exactly (a malformed count degrades to "just this one element", never a crash and never a silent zero-width run).
function readRepeatCount(node: XmlElement, attrName: string): number {
  const raw = node.attributes.find((attribute) => attribute.name === attrName)?.value;
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// A structural clone of `node` (structuredClone -- node is plain, serializable XmlElement data, no methods or non-cloneable values) with `attrName` set to `count`, or removed entirely when count is 1 -- an un-repeated element always OMITS the repeat attribute rather than writing an explicit "1", matching every real ODF producer and odf.js's own reader (readRepeatCount above treats "absent" and "1" identically, but only ever emitting "absent" for count 1 keeps our own output indistinguishable from a genuine producer's).
function withRepeatCount(node: XmlElement, attrName: string, count: number): XmlElement {
  const clone = structuredClone(node);
  clone.attributes = clone.attributes.filter((attribute) => attribute.name !== attrName);
  if (count > 1) {
    clone.attributes.push({ name: attrName, value: String(count) });
  }
  return clone;
}

// Finds or creates the single, individually-addressable element at `targetIndex` among `children`'s own members matching `isMember` (a table's table:table-row children, or a row's table:table-cell/table:covered-table-cell children), honouring `repeatAttr`-compressed runs the whole way -- this is the one function every row/cell/column write in this package's ods editor ultimately goes through.
//
// Three cases, all bounded by the number of EXISTING distinct elements (never by targetIndex or by however many positions a run represents):
// 1. targetIndex falls within a run whose own repeat count is already 1 -- that element IS the individuated target; return it unchanged, nothing is mutated.
// 2. targetIndex falls within a run whose repeat count is >1 -- split it in place (children.splice at that ONE element's own position, replacing it with up to three clones: an optional shortened "before" run, the individuated target, an optional shortened "after" run). Every real ODF repeat run represents N IDENTICAL positions by definition, so cloning the original element for all three parts is exactly correct, not an approximation -- content that existed anywhere in the run (a formatted-but-empty placeholder, or even genuine cell content in a repeated real row) survives identically in whichever part still covers it.
// 3. targetIndex falls beyond every existing run's own coverage -- append ONE placeholder run (built via `buildEmpty`, repeat count = however many positions are being skipped) covering the gap, immediately followed by the freshly individuated target (also from `buildEmpty`, no repeat attribute). This is the case that matters most for the "don't materialize 500x50 empty cells" guarantee: setting row 500 on an empty sheet produces exactly two new XML elements (a rows-0-through-499 placeholder, and row 500 itself), never 500 separate row objects.
export function replaceRun(
  children: XmlNode[],
  isMember: (node: XmlNode) => node is XmlElement,
  targetIndex: number,
  repeatAttr: string,
  buildEmpty: () => XmlElement,
): XmlElement {
  validateIndex(targetIndex, 'targetIndex');

  const members: { node: XmlElement; position: number }[] = [];
  children.forEach((node, position) => {
    if (isMember(node)) {
      members.push({ node, position });
    }
  });

  let cursor = 0;
  for (const member of members) {
    const count = readRepeatCount(member.node, repeatAttr);
    if (targetIndex < cursor + count) {
      const offset = targetIndex - cursor;
      if (count === 1) {
        return member.node;
      }
      const before = offset > 0 ? withRepeatCount(member.node, repeatAttr, offset) : undefined;
      const target = withRepeatCount(member.node, repeatAttr, 1);
      const after = count - offset - 1 > 0 ? withRepeatCount(member.node, repeatAttr, count - offset - 1) : undefined;
      const replacement = [before, target, after].filter((candidate): candidate is XmlElement => candidate !== undefined);
      children.splice(member.position, 1, ...replacement);
      return target;
    }
    cursor += count;
  }

  const gap = targetIndex - cursor;
  const lastMember = members[members.length - 1];
  const insertAt = lastMember === undefined ? children.length : lastMember.position + 1;
  const toInsert: XmlElement[] = [];
  if (gap > 0) {
    toInsert.push(withRepeatCount(buildEmpty(), repeatAttr, gap));
  }
  const target = buildEmpty();
  toInsert.push(target);
  children.splice(insertAt, 0, ...toInsert);
  return target;
}

// Extends `tableElement`'s own declared table:table-column coverage to at least `minCount` columns, WITHOUT individuating any specific one -- unlike rows/cells, a column is never itself addressed by this editor (there is no per-column getter on OdsSheet), so there is nothing to return and no reason to split an existing run; only the LAST declared column run needs its own repeat count extended (or, if no columns exist yet, a single new one appended before the first row). Called on every cell write so a sheet's declared column count always covers the widest cell address any caller has actually used -- keeping the file genuinely well-formed for a real consumer (LibreOffice renders a grid sized off the declared columns, not off the highest cell address it happens to encounter) without ever growing the element count proportionally to how sparse or wide the addressed cells are.
export function ensureColumnCoverage(tableElement: XmlElement, minCount: number): void {
  if (minCount <= 0) {
    return;
  }
  const columnMembers: { node: XmlElement; position: number }[] = [];
  tableElement.children.forEach((node, position) => {
    if (isElementWithTag(COLUMN_TAG)(node)) {
      columnMembers.push({ node, position });
    }
  });
  const covered = columnMembers.reduce((sum, member) => sum + readRepeatCount(member.node, COLUMN_REPEAT_ATTR), 0);
  if (covered >= minCount) {
    return;
  }
  const additional = minCount - covered;
  const newColumn = withRepeatCount(el(COLUMN_TAG), COLUMN_REPEAT_ATTR, additional);
  const lastColumn = columnMembers[columnMembers.length - 1];
  if (lastColumn === undefined) {
    const firstRowPosition = tableElement.children.findIndex(isElementWithTag(ROW_TAG));
    const insertAt = firstRowPosition === -1 ? tableElement.children.length : firstRowPosition;
    tableElement.children.splice(insertAt, 0, newColumn);
  } else {
    tableElement.children.splice(lastColumn.position + 1, 0, newColumn);
  }
}

// Resolves (individuating and gap-filling as needed, per replaceRun above) the table:table-cell/table:covered-table-cell element at (row, column) within `tableElement`, first ensuring the table's own declared columns cover at least column + 1 (ensureColumnCoverage above). This is the single entry point every cell-level operation in this editor goes through -- OdsSheet.cell/cellAt route ordinary access through it (and reject a resolved table:covered-table-cell, since that position belongs to another cell's merge), OdsSheet.mergeCells routes both the anchor lookup and every covered position it stamps through it too.
export function resolveCellNode(tableElement: XmlElement, row: number, column: number): XmlElement {
  validateIndex(row, 'row');
  validateIndex(column, 'column');
  ensureColumnCoverage(tableElement, column + 1);
  const rowElement = replaceRun(tableElement.children, isElementWithTag(ROW_TAG), row, ROW_REPEAT_ATTR, () => el(ROW_TAG));
  return replaceRun(rowElement.children, isCellOrCoveredCell, column, COLUMN_REPEAT_ATTR, () => el(CELL_TAG));
}

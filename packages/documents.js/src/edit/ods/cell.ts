import type { Package, XmlElement } from 'odf.js';
import { attr } from 'ooxml.js';
import type { ContentCellValue, ContentRun } from 'document-schema.js';
import { removeAttr, setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { decodeOdfText, encodeOdfText } from '../../xml/odf-text';
import { populateParagraph } from '../odt/content';
import { OdtParagraph } from '../odt/paragraph';

const VALUE_TYPE_ATTR = 'office:value-type';
const VALUE_ATTR = 'office:value';
const BOOLEAN_VALUE_ATTR = 'office:boolean-value';
const DATE_VALUE_ATTR = 'office:date-value';
const TIME_VALUE_ATTR = 'office:time-value';
const STRING_VALUE_ATTR = 'office:string-value';
const CURRENCY_ATTR = 'office:currency';
const FORMULA_ATTR = 'table:formula';

const VALUE_ATTRS = [VALUE_TYPE_ATTR, VALUE_ATTR, BOOLEAN_VALUE_ATTR, DATE_VALUE_ATTR, TIME_VALUE_ATTR, STRING_VALUE_ATTR, CURRENCY_ATTR];

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

// A live view over a table:table-cell element -- see odt/run.ts's own top-of-file note for the same live-view rationale (every getter/setter reads or mutates the actual node inside the decoded Package). Constructed exclusively via address.ts's resolveCellNode (through OdsSheet.cell/cellAt/mergeCells), which guarantees `node` is never a table:covered-table-cell -- a position covered by another cell's merge is rejected before an OdsCell is ever built over it, so every method here can assume it owns a genuine, independent table:table-cell.
export class OdsCell {
  private readonly node: XmlElement;
  private readonly pkg: Package;

  constructor(node: XmlElement, pkg: Package) {
    this.node = node;
    this.pkg = pkg;
  }

  // Mirrors odf.js's own private readCellValue (typed/ods/read.ts) exactly -- the two MUST agree, since this getter's whole purpose is "what would readOdsContent itself see here", not an independent interpretation. "float" (not "number") is the real ODF wire value-type for a plain number -- confirmed there against real LibreOffice output; every other kind matches its own wire value-type string directly. string/date/time fall back to displayText when their own specific value attribute is absent, matching the same real-producer convention (an ordinary text cell typically carries no office:string-value at all, the text:p content IS the value) -- but OdsCell's own `value` setter below never relies on that fallback for a cell IT wrote (see its own comment), so this fallback only matters for cells this editor is reading back from a file some other producer wrote.
  get value(): ContentCellValue {
    const valueType = attr(this.node, VALUE_TYPE_ATTR);
    const displayText = this.displayText;
    switch (valueType) {
      case 'float': {
        const value = parseNumber(attr(this.node, VALUE_ATTR));
        return value === undefined ? { kind: 'string', value: displayText } : { kind: 'number', value };
      }
      case 'percentage': {
        const value = parseNumber(attr(this.node, VALUE_ATTR));
        return value === undefined ? { kind: 'string', value: displayText } : { kind: 'percentage', value };
      }
      case 'currency': {
        const value = parseNumber(attr(this.node, VALUE_ATTR));
        if (value === undefined) {
          return { kind: 'string', value: displayText };
        }
        const currency = attr(this.node, CURRENCY_ATTR);
        return currency === undefined ? { kind: 'currency', value } : { kind: 'currency', value, currency };
      }
      case 'boolean': {
        const raw = attr(this.node, BOOLEAN_VALUE_ATTR);
        return raw === undefined ? { kind: 'string', value: displayText } : { kind: 'boolean', value: raw === 'true' };
      }
      case 'date':
        return { kind: 'date', value: attr(this.node, DATE_VALUE_ATTR) ?? displayText };
      case 'time':
        return { kind: 'time', value: attr(this.node, TIME_VALUE_ATTR) ?? displayText };
      case 'string':
        return { kind: 'string', value: attr(this.node, STRING_VALUE_ATTR) ?? displayText };
      default:
        return { kind: 'empty' };
    }
  }

  // Writes BOTH office:value-type and its matching value attribute for every ContentCellValueSchema variant, clearing every OTHER value-related attribute first -- switching a cell from, say, a number to a string must never leave a stale office:value behind for a reader to misinterpret. Deliberately self-sufficient: unlike a typical real producer (which usually omits office:string-value for an ordinary text cell, relying on text:p as the value's own source), this setter always writes the explicit attribute for every kind, so `value`'s own round-trip through get()/readOdsContent is correct regardless of whether -- or in what order -- displayText is ever set afterward. It also writes a plain-text default into displayText (see setDisplayTextNodes) so a cell this editor creates always has SOME sensible rendered content even if the caller never calls the displayText setter directly; call displayText afterward to override this default with custom formatting.
  //
  // 'error' has no ODF wire representation at all (confirmed by odf.js's own readOdsContent: a genuine formula error serializes as office:value-type="string" with an EMPTY office:string-value, its message surviving only in the cell's own text:p/displayText -- ODF's office:value-type enumeration simply has no "error" member). This setter's own choice deliberately differs from that real-producer convention: rather than emptying the string value the way Calc does for its own cached, now-invalid formula result, it writes the error's own text as a genuine, non-empty string value -- the most faithful translation available within ODF's own vocabulary for a caller setting an error value directly (as opposed to a formula engine invalidating a cache), so `value` round-trips to {kind:'string', value: <the error text>} rather than losing the text from the value entirely. Reading it back can never reproduce kind:'error' -- no writer, this one included, can put that value-type on the wire -- and that is a property of the format, not a gap in this editor.
  set value(value: ContentCellValue) {
    for (const name of VALUE_ATTRS) {
      removeAttr(this.node, name);
    }
    switch (value.kind) {
      case 'number':
        setAttr(this.node, VALUE_TYPE_ATTR, 'float');
        setAttr(this.node, VALUE_ATTR, String(value.value));
        this.displayText = String(value.value);
        break;
      case 'percentage':
        setAttr(this.node, VALUE_TYPE_ATTR, 'percentage');
        setAttr(this.node, VALUE_ATTR, String(value.value));
        this.displayText = `${value.value * 100}%`;
        break;
      // Confirmed via a genuine soffice --headless open/save round trip (not just this package's own readOdsContent): a currency cell written this way -- office:value-type="currency" plus office:currency, with no accompanying number:currency-style/style:data-style-name (this editor writes no number-format styles at all, a documented, bounded gap, see content.ts's own module doc) -- round-trips correctly through THIS package's own readOdsContent, but real Calc itself silently downgrades it to a plain float cell on its own next save, since Calc ties the "currency" semantic to having a real currency-formatted style, not just the bare value-type/currency attributes. Not a defect in this setter -- writing a currency number-format style is out of scope here, same as every other number-format concern -- but worth knowing before assuming a currency cell survives a REAL Calc round trip, as distinct from this package's own.
      case 'currency':
        setAttr(this.node, VALUE_TYPE_ATTR, 'currency');
        setAttr(this.node, VALUE_ATTR, String(value.value));
        if (value.currency !== undefined) {
          setAttr(this.node, CURRENCY_ATTR, value.currency);
        }
        this.displayText = value.currency === undefined ? String(value.value) : `${value.value} ${value.currency}`;
        break;
      case 'boolean':
        setAttr(this.node, VALUE_TYPE_ATTR, 'boolean');
        setAttr(this.node, BOOLEAN_VALUE_ATTR, value.value ? 'true' : 'false');
        this.displayText = value.value ? 'TRUE' : 'FALSE';
        break;
      case 'date':
        setAttr(this.node, VALUE_TYPE_ATTR, 'date');
        setAttr(this.node, DATE_VALUE_ATTR, value.value);
        this.displayText = value.value;
        break;
      // ODF's own office:value-type enumeration has no separate "dateTime" wire member -- a combined date-and-time value is still office:value-type="date", with office:date-value carrying the full ISO-8601 datetime string rather than a bare date (the same wire type the 'date' case above writes, per the ODF spec's own office:date-value definition). Written identically to 'date' for exactly that reason -- not a downgrade the way 'error' folding into 'string' below is, since ODF genuinely has no distinct wire representation to lose. odf.js's own reader (readOdsContent) does not yet disambiguate a full-datetime "date"-typed cell back into this kind on the way in (it always reads a "date" wire value-type back as ContentCellValue kind 'date') -- a real, tracked read-side gap in odf.js itself, not this setter: this write path is still correct regardless, since the actual wire bytes are the ODF-standard ones a genuine LibreOffice-written combined date-time cell already uses.
      case 'dateTime':
        setAttr(this.node, VALUE_TYPE_ATTR, 'date');
        setAttr(this.node, DATE_VALUE_ATTR, value.value);
        this.displayText = value.value;
        break;
      case 'time':
        setAttr(this.node, VALUE_TYPE_ATTR, 'time');
        setAttr(this.node, TIME_VALUE_ATTR, value.value);
        this.displayText = value.value;
        break;
      case 'string':
        setAttr(this.node, VALUE_TYPE_ATTR, 'string');
        setAttr(this.node, STRING_VALUE_ATTR, value.value);
        this.displayText = value.value;
        break;
      case 'error':
        setAttr(this.node, VALUE_TYPE_ATTR, 'string');
        setAttr(this.node, STRING_VALUE_ATTR, value.value);
        this.displayText = value.value;
        break;
      case 'empty':
        this.displayText = '';
        break;
    }
  }

  // table:formula, verbatim -- no OpenFormula parsing, validation, or namespace-prefix handling of any kind; whatever string the caller supplies is exactly the string get() returns and exactly the string a reader (this package's own or any other) sees on the wire, matching how odf.js's own readOdsContent carries it through unexamined too.
  get formula(): string | undefined {
    return attr(this.node, FORMULA_ATTR);
  }

  set formula(value: string | undefined) {
    if (value === undefined) {
      removeAttr(this.node, FORMULA_ATTR);
      return;
    }
    setAttr(this.node, FORMULA_ATTR, value);
  }

  // *** decodeOdfText, NEVER ooxml.js's textContent() -- see src/xml/odf-text.ts's own top-of-file warning: textContent() silently drops text:s/text:tab/text:line-break, producing silently-wrong, silently-shorter text with no error at all. ***
  //
  // Reads across every text:p child and joins them with '\n', mirroring odf.js's own readCellText (typed/ods/read.ts) -- a cell with multiple text:p children (a real Calc Alt+Enter line break) reads back as a single multi-line string here exactly as it does through readOdsContent itself.
  get displayText(): string {
    const paragraphs = this.node.children.filter((child): child is XmlElement => child.type === 'element' && child.tag === 'text:p');
    return paragraphs.map((paragraph) => decodeOdfText(paragraph.children)).join('\n');
  }

  // Replaces this cell's ENTIRE children with a single text:p wrapping `value` (via encodeOdfText, which represents an embedded '\n' as a text:line-break element within that one paragraph). This deliberately does not reproduce Calc's own convention of multiple text:p elements for a manually line-broken cell -- both shapes decode back to the identical string through decodeOdfText/readCellText (text:line-break is decoded exactly like a paragraph boundary is), so the round-tripped STRING is correct either way; only the exact XML shape differs from what Calc itself would have written, which this editor is not obliged to replicate bit-for-bit.
  set displayText(value: string) {
    this.node.children = [el('text:p', {}, encodeOdfText(value))];
  }

  // Replaces this cell's own text:p with one built from STYLED runs (bold/italic/colour/etc per run), reusing odt's own OdtRun/buildRun/StyleRegistry machinery wholesale via populateParagraph -- a table:table-cell's text:p/text:span content model is structurally identical to a paragraph's, so wrapping this cell's own fresh text:p in an OdtParagraph and driving it through the SAME populateParagraph a docx/odt/odp paragraph already uses is genuine reuse, not a parallel reimplementation. This is a narrow escape hatch beyond value/formula/displayText's own plain-string contract, for a caller (buildOdsPackage's own cell population, content.ts) that has ContentSheetCell.runs -- the schema's own "rare, genuinely mixed inline formatting" case -- and wants it preserved rather than flattened to displayText's plain string. Calling this after value/displayText has already populated a plain text:p REPLACES it outright; the two are alternative representations of the same underlying content, never additive.
  setStyledRuns(runs: readonly ContentRun[]): void {
    const textParagraph = el('text:p');
    this.node.children = [textParagraph];
    const paragraph = new OdtParagraph(this.node.children, textParagraph, this.pkg);
    // headings: false -- this is a table:table-cell's text:p, the same cell-scope container whose heading promote populateParagraph itself refuses (see PopulateParagraphOptions).
    populateParagraph(paragraph, { kind: 'paragraph', runs: [...runs] }, { headings: false });
  }
}

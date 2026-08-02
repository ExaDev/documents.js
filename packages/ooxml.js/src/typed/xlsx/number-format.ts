// A tokenizing classifier for Excel's number-format mini-language (the string carried by xl/styles.xml's own <numFmt formatCode="...">, and by ECMA-376 Part 1 SS18.8.30's own implied built-in table below), plus -- at the bottom of this file -- the small set of formats this package's own writer emits, which are the classifier's own inverse. It answers exactly one question: what KIND of value does a numeric cell carrying this format actually hold -- a percentage, an amount of money, a date, a time of day, an elapsed duration, or a plain number? It is deliberately NOT a formatter: nothing here renders a value THROUGH a format code (that needs locale data, fill/alignment placeholder geometry, conditional-section evaluation, and colour handling none of this package's consumers have asked for), only classifies one. typed/xlsx/content.ts's readCellValue is the classifier's sole caller and typed/xlsx/build.ts the writer's; typed/xlsx/styles.ts sits on both sides, resolving a cell's own style index to the format code fed in here and interning the ones written back out.
//
// Tokenizing rather than pattern-matching is load-bearing, not a stylistic preference -- every meaningful signal in this language is context-sensitive, and a regex over the raw string gets each of them wrong:
//   * a 'd' inside "dollars" is literal text, not a day code, and so is every character inside a \-escape or an _x/*x placeholder;
//   * '$' immediately followed by '-' inside a bracket is a LOCALE tag ([$-809], "English (United Kingdom)") carrying no currency meaning at all, while the same bracket with text before the dash ([$GBP-809], [$£-809]) genuinely is a currency marker -- one character apart, opposite meanings;
//   * '[h]' is an elapsed-hours bucket (a duration that may exceed 24h) while a bare 'h' is an hour-of-day;
//   * 'm' is minutes or months depending purely on the code runs around it;
//   * and a ';' inside a quoted literal does not start a new section.

// A single lexical unit of a format code. 'literal' covers every construct whose payload is TEXT rather than format codes -- a "..." quoted run, a \x escape, and the payload character of an _x (reserve the width of x) or *x (repeat x to fill the cell) placeholder -- so nothing inside one is ever read as a date/time/numeric code. Its text is still SCANNED for a currency symbol, because a literal currency symbol is exactly how ECMA-376's own built-in accounting formats (42/44, `_("$"* #,##0_)`) mark money.
export type NumberFormatToken = { kind: 'literal'; text: string } | { kind: 'bracket'; body: string } | { kind: 'separator' } | { kind: 'code'; char: string };

// Excel honours at most four sections (positive; negative; zero; text). A fifth would be malformed, and since this classifier reads only the first section it is dropped rather than guessed at.
export const MAX_NUMBER_FORMAT_SECTIONS = 4;

// Mirrors String.prototype.charAt's own past-the-end contract (the empty string, not undefined) but over a CODE POINT array rather than UTF-16 units, so a rare astral currency symbol stays one token instead of splitting into two lone surrogates.
function at(chars: readonly string[], index: number): string {
  const char = chars[index];
  return char ?? '';
}

export function tokenizeNumberFormat(formatCode: string): NumberFormatToken[] {
  const chars = [...formatCode];
  const tokens: NumberFormatToken[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = at(chars, index);
    if (char === '"') {
      // An unterminated quote runs to the end of the format code rather than throwing -- real producers never write one, but a malformed code must still tokenize into something classifiable.
      let text = '';
      index += 1;
      while (index < chars.length && at(chars, index) !== '"') {
        text += at(chars, index);
        index += 1;
      }
      index += 1;
      tokens.push({ kind: 'literal', text });
      continue;
    }
    if (char === '\\' || char === '_' || char === '*') {
      // \x renders x literally; _x reserves x's width without printing it; *x repeats x to fill the cell. All three consume the FOLLOWING character as a non-code payload, which is why `_(` never reads as an opening parenthesis code and `\-` (real LibreOffice output, see this package's own kitchen-sink fixture's numFmtId 166) never reads as a minus sign.
      tokens.push({ kind: 'literal', text: at(chars, index + 1) });
      index += 2;
      continue;
    }
    if (char === '[') {
      let body = '';
      index += 1;
      while (index < chars.length && at(chars, index) !== ']') {
        body += at(chars, index);
        index += 1;
      }
      index += 1;
      tokens.push({ kind: 'bracket', body });
      continue;
    }
    if (char === ';') {
      tokens.push({ kind: 'separator' });
      index += 1;
      continue;
    }
    tokens.push({ kind: 'code', char });
    index += 1;
  }
  return tokens;
}

// Splits on separator tokens only -- a ';' inside a quoted literal or a bracket was already consumed as part of that token above, so it can never split a section here. Always returns at least one section (an empty one for an empty format code).
export function splitNumberFormatSections(tokens: readonly NumberFormatToken[]): NumberFormatToken[][] {
  const sections: NumberFormatToken[][] = [];
  let current: NumberFormatToken[] = [];
  for (const token of tokens) {
    if (token.kind === 'separator') {
      sections.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  sections.push(current);
  return sections.slice(0, MAX_NUMBER_FORMAT_SECTIONS);
}

// The Unicode Currency_Symbol general category (Sc) IS the definition of "this character means money" -- $ £ € ¥ ₹ ฿ and every other one -- so it is tested directly rather than against a hand-listed subset that would silently omit whichever symbol a real file happens to use.
const CURRENCY_SYMBOL = /\p{Sc}/u;

function containsCurrencySymbol(text: string): boolean {
  return CURRENCY_SYMBOL.test(text);
}

// [$GBP-809] carries an ISO 4217 alphabetic code; [$£-809] and [$R$-416] carry a display SYMBOL instead. Only the three-ASCII-letter shape is treated as a code -- ContentCellValue's own `currency` field is documented as the ISO 4217 code, so a symbol must leave it absent rather than have a code invented for it (there is no faithful symbol-to-code mapping: '$' alone is USD, CAD, AUD, and a dozen others).
function isIsoCurrencyCodeShape(marker: string): boolean {
  if (marker.length !== 3) {
    return false;
  }
  for (const char of marker) {
    const upper = char.toUpperCase();
    if (upper < 'A' || upper > 'Z') {
      return false;
    }
  }
  return true;
}

type BracketMeaning = { kind: 'elapsed' } | { kind: 'currency'; code?: string } | { kind: 'none' };

// An elapsed-time bucket is a bracket holding one repeated h/m/s and nothing else ([h], [hh], [mm], [ss]) -- the marker that the value is a DURATION, which may legitimately exceed 24 hours, rather than a time of day.
function isElapsedBracketBody(body: string): boolean {
  let letter: string | undefined;
  for (const char of body) {
    const lower = char.toLowerCase();
    if (letter === undefined) {
      if (lower !== 'h' && lower !== 'm' && lower !== 's') {
        return false;
      }
      letter = lower;
    } else if (lower !== letter) {
      return false;
    }
  }
  return letter !== undefined;
}

function classifyBracket(body: string): BracketMeaning {
  if (body.startsWith('$')) {
    const rest = body.slice(1);
    // The single most error-prone distinction in this whole language: '$' immediately followed by '-' is a locale-only tag, NOT currency. Real LibreOffice output writes [$-809] on date, time, and percentage formats alike (see this package's own kitchen-sink fixture) -- reading those as currency would misclassify three of its five styled cells.
    const dashIndex = rest.indexOf('-');
    const marker = dashIndex === -1 ? rest : rest.slice(0, dashIndex);
    if (marker === '') {
      return { kind: 'none' };
    }
    return isIsoCurrencyCodeShape(marker) ? { kind: 'currency', code: marker.toUpperCase() } : { kind: 'currency' };
  }
  // Everything else a bracket can hold -- a colour ([Red]), a condition ([<=100]), a locale/calendar modifier ([ENG], [DBNum1]) -- carries no value-kind information at all.
  return isElapsedBracketBody(body) ? { kind: 'elapsed' } : { kind: 'none' };
}

// A run of consecutive identical code characters ('yyyy', 'mm', ':'), plus the one multi-character code that is not a repeated letter: an AM/PM (or A/P) marker, recorded under the synthetic letter 'ampm'. Grouping into runs is what makes 'mmm' (always a month name) distinguishable from 'mm' (ambiguous), and what the minutes-vs-months resolution below scans over.
interface CodeRun {
  letter: string;
  length: number;
}

const AMPM_MARKERS: readonly string[] = ['am/pm', 'a/p'];
const AMPM_LETTER = 'ampm';

function matchesAt(chars: readonly string[], index: number, marker: string): boolean {
  return [...marker].every((char, offset) => at(chars, index + offset).toLowerCase() === char);
}

function codeRunsOf(section: readonly NumberFormatToken[]): CodeRun[] {
  const chars: string[] = [];
  for (const token of section) {
    if (token.kind === 'code') {
      chars.push(token.char);
    }
  }
  const runs: CodeRun[] = [];
  let index = 0;
  while (index < chars.length) {
    const marker = AMPM_MARKERS.find((candidate) => matchesAt(chars, index, candidate));
    if (marker !== undefined) {
      runs.push({ letter: AMPM_LETTER, length: marker.length });
      index += marker.length;
      continue;
    }
    const char = at(chars, index).toLowerCase();
    let length = 0;
    while (index + length < chars.length && at(chars, index + length).toLowerCase() === char) {
      length += 1;
    }
    runs.push({ letter: char, length });
    index += length;
  }
  return runs;
}

// The date/time letters an ambiguous 'm' looks past its neighbours for. 'm' itself is excluded: an unresolved 'm' carries no information for resolving another one, so `hh:mm:mm` resolves both against the 'hh', not against each other.
const RESOLVING_LETTERS: readonly string[] = ['y', 'd', 'h', 's'];

function nearestResolvingLetter(runs: readonly CodeRun[], from: number, step: number): string | undefined {
  for (let index = from + step; index >= 0 && index < runs.length; index += step) {
    const run = runs[index];
    if (run !== undefined && RESOLVING_LETTERS.includes(run.letter)) {
      return run.letter;
    }
  }
  return undefined;
}

// Excel's own minutes-vs-months rule, the language's other genuinely ambiguous code: 'm'/'mm' is minutes when the nearest preceding date/time code is an hour or the nearest following one is a second, and a month otherwise. 'mmm' and longer are always month names (January/Jan/J), never minutes, so only runs of one or two are ever ambiguous. This is what makes `yyyy-mm-dd hh:mm:ss` resolve its two identical 'mm' runs oppositely -- month for the first (between 'yyyy' and 'dd'), minutes for the second (after 'hh').
function monthRunIsMinutes(runs: readonly CodeRun[], index: number): boolean {
  return nearestResolvingLetter(runs, index, -1) === 'h' || nearestResolvingLetter(runs, index, 1) === 's';
}

export type NumberFormatClass =
  | { kind: 'number' }
  | { kind: 'text' }
  | { kind: 'percentage' }
  | { kind: 'currency'; code?: string }
  | { kind: 'date' }
  | { kind: 'time' }
  | { kind: 'dateTime' }
  | { kind: 'elapsedTime' };

const PLAIN_NUMBER: NumberFormatClass = { kind: 'number' };

// The numeric-placeholder codes: digit placeholders ('0' required, '#' suppressed, '?' space-padded), the decimal separator, the thousands separator, and scientific notation's own exponent introducer (handled at its 'e' run below, since a bare 'e' also occurs inside the literal word "General").
const NUMERIC_CODES: readonly string[] = ['0', '#', '?', '.', ','];

interface SectionSignals {
  hasDate: boolean;
  hasTime: boolean;
  hasElapsed: boolean;
  hasPercent: boolean;
  hasNumeric: boolean;
  hasText: boolean;
  hasCurrency: boolean;
  currencyCode?: string;
}

function collectSignals(section: readonly NumberFormatToken[]): SectionSignals {
  const signals: SectionSignals = { hasDate: false, hasTime: false, hasElapsed: false, hasPercent: false, hasNumeric: false, hasText: false, hasCurrency: false };
  for (const token of section) {
    if (token.kind === 'literal' && containsCurrencySymbol(token.text)) {
      signals.hasCurrency = true;
    }
    if (token.kind === 'bracket') {
      const meaning = classifyBracket(token.body);
      if (meaning.kind === 'elapsed') {
        signals.hasElapsed = true;
      }
      if (meaning.kind === 'currency') {
        signals.hasCurrency = true;
        // The first currency bracket carrying a real ISO code wins; a format with two of them is malformed, and the leading one is the one a reader would see.
        if (signals.currencyCode === undefined && meaning.code !== undefined) {
          signals.currencyCode = meaning.code;
        }
      }
    }
  }
  const runs = codeRunsOf(section);
  runs.forEach((run, index) => {
    if (run.letter === 'y' || run.letter === 'd') {
      signals.hasDate = true;
      return;
    }
    if (run.letter === 'h' || run.letter === 's' || run.letter === AMPM_LETTER) {
      signals.hasTime = true;
      return;
    }
    if (run.letter === 'm') {
      if (run.length <= 2 && monthRunIsMinutes(runs, index)) {
        signals.hasTime = true;
      } else {
        signals.hasDate = true;
      }
      return;
    }
    if (run.letter === 'e') {
      // 'E+'/'E-' is scientific notation; a bare 'e' with no sign after it is just a letter of the literal word "General" (numFmtId 0, and whatever a producer redefines a custom id as -- this package's own kitchen-sink fixture redefines 164 exactly that way).
      const next = runs[index + 1];
      signals.hasNumeric = signals.hasNumeric || next?.letter === '+' || next?.letter === '-';
      return;
    }
    if (run.letter === '%') {
      signals.hasPercent = true;
      return;
    }
    if (run.letter === '@') {
      signals.hasText = true;
      return;
    }
    if (NUMERIC_CODES.includes(run.letter)) {
      signals.hasNumeric = true;
      return;
    }
    if (containsCurrencySymbol(run.letter)) {
      // A bare, unbracketed, unquoted currency symbol -- ECMA-376's own built-in ids 5-8 (`$#,##0_);($#,##0)`) are exactly this shape.
      signals.hasCurrency = true;
    }
  });
  return signals;
}

// Precedence when a format carries several signals at once, most specific first: an elapsed-time bracket beats everything (it is the only marker distinguishing a duration from a time of day); any date code beats any time code (a format with both is a genuine combined date-and-time, which ContentCellValue models as its own 'dateTime' kind rather than collapsing onto 'date'); a percent sign beats a currency marker (`[$GBP-809]0.00%` is a percentage of an amount, still a percentage); and a text placeholder only wins when the section has no numeric placeholder to be a number with.
function classifySection(section: readonly NumberFormatToken[]): NumberFormatClass {
  const signals = collectSignals(section);
  if (signals.hasElapsed) {
    return { kind: 'elapsedTime' };
  }
  if (signals.hasDate) {
    return signals.hasTime ? { kind: 'dateTime' } : { kind: 'date' };
  }
  if (signals.hasTime) {
    return { kind: 'time' };
  }
  if (signals.hasPercent) {
    return { kind: 'percentage' };
  }
  if (signals.hasCurrency) {
    const code = signals.currencyCode;
    return code === undefined ? { kind: 'currency' } : { kind: 'currency', code };
  }
  if (signals.hasText && !signals.hasNumeric) {
    return { kind: 'text' };
  }
  return PLAIN_NUMBER;
}

// Classification reads the FIRST section only. Sections two through four are the negative/zero/text renderings of the same underlying value -- they can differ in colour, parentheses, and literal text, but never in what kind of thing the cell holds, and a cell whose value happens to be negative must not classify differently from the identical cell holding a positive one.
export function classifyNumberFormat(formatCode: string): NumberFormatClass {
  const first = splitNumberFormatSections(tokenizeNumberFormat(formatCode))[0];
  return first === undefined ? PLAIN_NUMBER : classifySection(first);
}

// ECMA-376 Part 1 SS18.8.30's own table of built-in (implied, never written into a file's own <numFmts>) format codes. Ids 23-36 are deliberately absent: that table leaves them reserved, and inventing codes for them would be fabricating a mapping the spec does not define -- an xf pointing at one resolves to no code at all, which typed/xlsx/styles.ts reports as undefined rather than silently substituting General. These strings are fed through the SAME classifyNumberFormat above as a producer-declared code, never a second lookup table of pre-decided kinds, so the two feeds can never drift apart. Two spellings of ids 5-8 circulate in reproductions of that table (bare `$#,##0` and quoted `"$"#,##0`); both classify identically here, since a currency symbol is recognised as a bare code character and inside a literal alike.
export const BUILTIN_NUMBER_FORMATS: ReadonlyMap<number, string> = new Map<number, string>([
  [0, 'General'],
  [1, '0'],
  [2, '0.00'],
  [3, '#,##0'],
  [4, '#,##0.00'],
  [5, '$#,##0_);($#,##0)'],
  [6, '$#,##0_);[Red]($#,##0)'],
  [7, '$#,##0.00_);($#,##0.00)'],
  [8, '$#,##0.00_);[Red]($#,##0.00)'],
  [9, '0%'],
  [10, '0.00%'],
  [11, '0.00E+00'],
  [12, '# ?/?'],
  [13, '# ??/??'],
  [14, 'mm-dd-yy'],
  [15, 'd-mmm-yy'],
  [16, 'd-mmm'],
  [17, 'mmm-yy'],
  [18, 'h:mm AM/PM'],
  [19, 'h:mm:ss AM/PM'],
  [20, 'h:mm'],
  [21, 'h:mm:ss'],
  [22, 'm/d/yy h:mm'],
  [37, '#,##0 ;(#,##0)'],
  [38, '#,##0 ;[Red](#,##0)'],
  [39, '#,##0.00;(#,##0.00)'],
  [40, '#,##0.00;[Red](#,##0.00)'],
  [41, '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)'],
  [42, '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)'],
  [43, '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'],
  [44, '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'],
  [45, 'mm:ss'],
  [46, '[h]:mm:ss'],
  [47, 'mmss.0'],
  [48, '##0.0E+0'],
  [49, '@'],
]);

// --- the write side: the formats typed/xlsx/build.ts gives a cell ---------------------------------------------------
//
// One entry per ContentCellValue kind that xlsx cannot express as a cell TYPE and must express as a number format instead. Every code below is real markup modelled on actual LibreOffice output -- this directory's own kitchen-sink.xlsx fixture declares numFmtIds 165-169 as the boolean, date, time, percentage, and currency formats these mirror -- rather than markup invented to satisfy this package's own classifier. Two deliberate differences from that fixture: the fixture's own leading locale tag ([$-809], "English (United Kingdom)") is dropped, since this writer has no locale to claim and would otherwise stamp one producer's region onto every file it writes; and where a fixture format has an exact ECMA-376 built-in equivalent (its '[$-809]0.00%' and '[$-809]hh:mm:ss' are numFmtId 10 and 21 without that tag), the built-in id is referenced instead of redeclaring the code.
//
// Each is checked twice over: fed back through classifyNumberFormat in this module's own test suite, so the writer's vocabulary and the reader's classification cannot drift apart; and rendered by real LibreOffice 26.2 from a genuinely built .xlsx, which displays each one as intended (TRUE/FALSE, 42.56%, GBP99.99, 2026-07-31, 14:30:00) and, converting that file to ODF, recovers office:value-type boolean/percentage/currency+office:currency="GBP"/date/time for them.

// A number format a written cell is displayed through: either one of ECMA-376's own implied built-ins (referenced by id, needing no <numFmt> declaration at all) or a code this writer must declare in the file's own <numFmts>.
export type CellNumberFormat = { kind: 'builtin'; id: number } | { kind: 'custom'; code: string };

// numFmtId 10, '0.00%' -- the built-in percentage format. The cell's own stored value stays the raw fraction (0.4256), which is both what ContentCellValue's 'percentage' variant carries and what a percent-formatted cell holds in every real file; the x100 lives purely in the rendering.
export const PERCENTAGE_NUMBER_FORMAT: CellNumberFormat = { kind: 'builtin', id: 10 };

// numFmtId 21, 'h:mm:ss' -- the built-in time-of-day format, over a serial that is a pure fraction of a day.
export const TIME_NUMBER_FORMAT: CellNumberFormat = { kind: 'builtin', id: 21 };

// numFmtId 4, '#,##0.00' -- the built-in two-decimal number format, and what a 'currency' cell carrying no ISO code at all is written as. This is a REAL, documented semantic loss on the way back: nothing in '#,##0.00' says money, so such a cell reads back as a plain number. The alternative -- writing a generic currency sign to keep the kind -- would put a '¤' in front of every amount in a file whose author never asked for one, so the kind is dropped rather than the value's own appearance changed.
export const AMOUNT_NUMBER_FORMAT: CellNumberFormat = { kind: 'builtin', id: 4 };

// ISO order rather than one of the built-in date formats, every one of which fixes a different regional field order (numFmtId 14 is US 'mm-dd-yy'): ContentCellValue's own 'date' spelling is ISO, so an ISO-ordered format is the one that displays what the value actually says. The '\-' escapes are LibreOffice's own spelling of a literal separator, kept verbatim.
export const DATE_NUMBER_FORMAT: CellNumberFormat = { kind: 'custom', code: 'yyyy\\-mm\\-dd' };

// The combined form, for ContentCellValue's own 'dateTime' kind -- the date format above plus a seconds-precision time of day, matching that kind's own 'YYYY-MM-DDTHH:MM:SS' spelling. No built-in covers it: numFmtId 22 ('m/d/yy h:mm') is US-ordered and drops seconds.
export const DATE_TIME_NUMBER_FORMAT: CellNumberFormat = { kind: 'custom', code: 'yyyy\\-mm\\-dd hh:mm:ss' };

// A boolean cell is written as t="b" with a 1/0 value (which is how ECMA-376 spells one and how this package's reader reads it back), and this format is what makes real Excel and Calc DISPLAY that 1/0 as TRUE/FALSE instead of as a bare digit -- the positive/negative/zero sections of a three-section format, with the non-zero sections both reading TRUE. Verified LibreOffice markup: the kitchen-sink fixture's own numFmtId 165 is this exact string.
export const BOOLEAN_NUMBER_FORMAT: CellNumberFormat = { kind: 'custom', code: '"TRUE";"TRUE";"FALSE"' };

// The money format for a currency cell that names its ISO 4217 code: '[$GBP]#,##0.00'. The bracket is what carries the code THROUGH the file -- writing the symbol instead ('£'#,##0.00) would render identically and lose the code permanently, since no faithful symbol-to-code mapping exists on the way back ('$' alone is USD, CAD, AUD and a dozen others). A currency string that is not an ISO-code shape cannot go in that bracket without producing a malformed format code, so it falls back to the plain amount format above rather than being interpolated blindly.
export function currencyNumberFormat(code: string | undefined): CellNumberFormat {
  if (code === undefined || !isIsoCurrencyCodeShape(code)) {
    return AMOUNT_NUMBER_FORMAT;
  }
  return { kind: 'custom', code: `[$${code.toUpperCase()}]#,##0.00` };
}

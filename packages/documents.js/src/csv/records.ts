// The shared RFC 4180 record layer for csv: one parser (parseCsvRecords) and one quoting writer (quoteCsvField), used by the read path (src/csv/read.ts), the write path (src/csv/write.ts), and src/odb/csv.ts's odbToCsv alike. Before this module existed the quoting lived privately in odb/csv.ts as csvField/CSV_QUOTE_NEEDED_RE; generalising it to also carry the active delimiter (a tab, for TSV) and moving it here means every csv emitter in the package writes the identical dialect by construction -- one implementation, no drift.
//
// The dialect, RFC 4180 (https://www.rfc-editor.org/rfc/rfc4180) with two deliberate tolerances: a field containing the delimiter, a double quote, CR, or LF is wrapped in double quotes with embedded double quotes doubled; records are joined with CRLF. Tolerance one: RFC 4180 mandates CRLF record breaks, but real-world files arrive LF-only (and classic Mac exports arrive CR-only), so the parser accepts all three as a break while the writer always emits CRLF -- accepting a lone break never mis-parses a conforming file. Tolerance two: RFC 4180 allows a quote only immediately after a record break or delimiter; a quote appearing mid-field is taken as a literal character rather than a parse error, matching what spreadsheet exporters actually emit for text like {5" drive}.

export const DEFAULT_CSV_DELIMITER = ',';
export const TSV_DELIMITER = '\t';

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

// A delimiter other than exactly one character can never match the scanner's per-character comparison, so a multi-character or empty delimiter would silently parse the whole file as one giant field per line -- rejected here, at the boundary, instead.
function requireSingleCharacterDelimiter(delimiter: string): void {
  if (delimiter.length !== 1) {
    throw new CsvParseError(`delimiter must be exactly one character, got ${JSON.stringify(delimiter)}`);
  }
}

// A record consisting of exactly one empty field is a blank line -- RFC 4180 gives it no meaning, and every spreadsheet importer drops it. Filtered after parsing so the reader never sees phantom rows.
function isBlankRecord(record: readonly string[]): boolean {
  return record.length === 1 && record[0] === '';
}

export function parseCsvRecords(text: string, delimiter: string = DEFAULT_CSV_DELIMITER): string[][] {
  requireSingleCharacterDelimiter(delimiter);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotedField = false;
  let fieldStarted = false;

  const endField = (): void => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  let index = 0;
  while (index < text.length) {
    const ch = text.charAt(index);
    if (inQuotedField) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote (RFC 4180 2.7); a lone quote closes the field.
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotedField = false;
        index += 1;
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotedField = true;
      fieldStarted = true;
      index += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[index + 1] === '\n') {
        index += 2;
      } else {
        index += 1;
      }
      endRecord();
      continue;
    }
    field += ch;
    fieldStarted = true;
    index += 1;
  }

  if (inQuotedField) {
    throw new CsvParseError(`unterminated quoted field: no closing double quote before end of input (field so far: ${field.slice(0, 40)})`);
  }
  // A trailing record break already ended the final record above; input not ending in a break leaves a partial field (or a field-only record) to end here.
  if (fieldStarted || field !== '' || record.length > 0) {
    endRecord();
  }
  return records.filter((candidate) => !isBlankRecord(candidate));
}

// The writer's half of the dialect: quote exactly when a bare field would re-parse as more than one field or a truncated one, otherwise write it bare. Delimiter-parameterised so TSV output quotes on tab rather than comma.
export function quoteCsvField(field: string, delimiter: string = DEFAULT_CSV_DELIMITER): string {
  return field.includes(delimiter) || field.includes('"') || field.includes('\r') || field.includes('\n') ? `"${field.replaceAll('"', '""')}"` : field;
}

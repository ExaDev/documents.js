// PDF scalar-text decoding: the two boundary decoders that turn a PdfObject's raw bytes into a JavaScript value where the interpretation is fixed by the format rather than by context -- PDF strings (BOM-marked UTF-16BE vs the byte-per-character PDFDocEncoding approximation) and PDF dates (ISO 32000-1 7.9.4's "D:YYYYMMDDHHmmSSOHH'mm'" profile). Split out of read.ts so the other read-side modules (names-tree keys, outline titles, annotation contents, form-field values) share one definition instead of each re-deriving it; read.ts re-exports both to keep the pdf-codec/read entry's surface unchanged.

// Our own writer always emits UTF-16BE-with-BOM (write.ts's textToPdfString); a third-party producer's plain-ASCII PDFDocEncoding is approximated as a direct byte-per-character (Latin-1-ish) decode, correct for the overwhelming common ASCII-only case.
export function decodePdfString(bytes: Uint8Array<ArrayBuffer>): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    }
    return out;
  }
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

// ISO 32000-1 7.9.4: "D:YYYYMMDDHHmmSSOHH'mm'" with every field after the year optional and O one of +/-/Z.
const PDF_DATE_PATTERN = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?'?$/;

export function parsePdfDate(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = PDF_DATE_PATTERN.exec(raw);
  if (match === null) {
    return undefined;
  }
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', tzSign, tzHour = '00', tzMinute = '00'] = match;
  const offset = tzSign === undefined || tzSign === 'Z' ? 'Z' : `${tzSign}${tzHour}:${tzMinute}`;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

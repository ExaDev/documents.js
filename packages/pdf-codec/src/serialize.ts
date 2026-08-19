import { ByteWriter } from './bytes/writer';
import type { PdfObject } from './objects';
import { pdfNum } from './objects';

// PDF numbers must never use exponential notation -- Number.prototype.toString() can produce '1e-7', which is not valid PDF syntax, and this is a genuine bug class, not a hypothetical one. Rounds to 4 decimal places (0.0001pt is far below any real output device's resolution), strips trailing zeros and a bare trailing '.', and normalises '-0' to '0'.
const NUMBER_DECIMAL_PLACES = 4;
const NUMBER_EPSILON = 10 ** -NUMBER_DECIMAL_PLACES;

export function formatNumber(n: number): string {
  if (Math.abs(n) < NUMBER_EPSILON) {
    return '0';
  }
  let formatted = n.toFixed(NUMBER_DECIMAL_PLACES);
  if (formatted.includes('.')) {
    formatted = formatted.replace(/0+$/, '').replace(/\.$/, '');
  }
  return formatted === '-0' ? '0' : formatted;
}

const NAME_ESCAPE_PATTERN = /[^!-~]|[#()<>[\]{}/%]/;

// PDF names encode any character outside the safe printable-ASCII set (or one of the delimiter/ special characters) with a #XX hex escape. Every name this writer emits is a plain ASCII identifier we chose ourselves (Type, Catalog, F1, Im3, ...), so this is a defensive general implementation rather than one tuned to a specific known-safe input set.
function escapeName(name: string): string {
  if (!NAME_ESCAPE_PATTERN.test(name)) {
    return name;
  }
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0)!;
    if (code < 0x21 || code > 0x7e || '#()<>[]{}/%'.includes(ch)) {
      out += `#${code.toString(16).padStart(2, '0')}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function bytesToHex(bytes: Uint8Array<ArrayBuffer>): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

function writeDictBody(writer: ByteWriter, entries: ReadonlyMap<string, PdfObject>): void {
  writer.writeAscii('<<');
  for (const [key, value] of entries) {
    writer.writeAscii(`/${escapeName(key)} `);
    writeObject(writer, value);
    writer.writeAscii(' ');
  }
  writer.writeAscii('>>');
}

// Serializes a single PdfObject's own syntax into `writer`. Composing multiple objects into a full indirect-object body ("N G obj ... endobj") and tracking byte offsets for the xref table is write.ts's job, not this module's -- this is purely "PdfObject -> its PDF syntax".
export function writeObject(writer: ByteWriter, obj: PdfObject): void {
  if (obj.kind === 'null') {
    writer.writeAscii('null');
  } else if (obj.kind === 'bool') {
    writer.writeAscii(obj.value ? 'true' : 'false');
  } else if (obj.kind === 'number') {
    writer.writeAscii(formatNumber(obj.value));
  } else if (obj.kind === 'name') {
    writer.writeAscii(`/${escapeName(obj.name)}`);
  } else if (obj.kind === 'string') {
    // Always emitted as a hex string regardless of obj.hex -- this sidesteps literal-string escaping ('(', ')', '\', control bytes, octal runs) entirely. See write.ts's module doc.
    writer.writeAscii(`<${bytesToHex(obj.bytes)}>`);
  } else if (obj.kind === 'array') {
    writer.writeAscii('[');
    obj.items.forEach((item, i) => {
      if (i > 0) {
        writer.writeAscii(' ');
      }
      writeObject(writer, item);
    });
    writer.writeAscii(']');
  } else if (obj.kind === 'dict') {
    writeDictBody(writer, obj.entries);
  } else if (obj.kind === 'stream') {
    // /Length is always derived from the actual raw byte length here, overriding whatever (if anything) is already in obj.dict.entries -- this guarantees the declared length can never drift from the bytes that actually follow.
    const entries = new Map(obj.dict.entries);
    entries.set('Length', pdfNum(obj.raw.length));
    writeDictBody(writer, entries);
    writer.writeAscii('\nstream\n');
    writer.writeBytes(obj.raw);
    writer.writeAscii('\nendstream');
  } else {
    writer.writeAscii(`${obj.num} ${obj.gen} R`);
  }
}

export function serializeObject(obj: PdfObject): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writeObject(writer, obj);
  return writer.toBytes();
}

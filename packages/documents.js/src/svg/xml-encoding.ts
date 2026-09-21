// Reads the encoding SVG's own XML prolog declares, ahead of any real decoding, per XML 1.0's own external-encoding-detection algorithm (https://www.w3.org/TR/xml/#sec-guessing). Detection is two steps, tried in order: a byte order mark (which needs no further reading, since it identifies the encoding outright), then the <?xml ... encoding="..."?> declaration itself. Both steps only ever read bytes, never decode text, which is what lets the declaration be found before the encoding it declares is even known: the declaration's own grammar (VersionInfo/EncodingDecl/SDDecl) restricts every character in it to ASCII in every encoding this module can see, so a byte-level scan for the literal ASCII bytes "<?xml" and "encoding=" is safe ahead of any decode. A mark-less multi-byte document (UTF-16/UTF-32 with no byte order mark) is the one case that scan cannot see, since its own bytes are not ASCII-compatible without a mark to say which byte order they are in; that case is out of scope here for the identical reason detectByteOrderMark's own five marks are the only multi-byte case this module recognises at all: XML's own recommendation treats such a document as needing external encoding information it has no channel to carry here.
import type { TextEncodingLabel } from "byte-codec";
import { detectByteOrderMark } from "byte-codec";

// Label aliases for byte-codec's own bounded TextEncodingLabel set, restricted to the labels the WHATWG Encoding Standard (https://encoding.spec.whatwg.org/#names-and-labels, https://web.archive.org/web/2026/https://encoding.spec.whatwg.org/#names-and-labels) maps onto those same six encodings, plus UTF-32LE/UTF-32BE's own IANA charset names, since the Encoding Standard has no UTF-32 at all, the identical gap byte-codec's own decodeText documents. Keys are lowercase; lookup lowercases whatever an <?xml ...?> declaration names before matching, since real-world documents write the label in whatever mixed case their own producer favoured (Excel-authored SVG, browser-exported SVG, and hand-written SVG all disagree) even though none of that case-variation changes which encoding is meant.
const XML_ENCODING_ALIASES: Readonly<Record<string, TextEncodingLabel>> = {
  "utf-8": "utf-8",
  utf8: "utf-8",
  "unicode-1-1-utf-8": "utf-8",
  unicode11utf8: "utf-8",
  unicode20utf8: "utf-8",
  "x-unicode20utf8": "utf-8",

  "utf-16le": "utf-16le",
  "utf-16": "utf-16le",
  "ucs-2": "utf-16le",
  unicode: "utf-16le",
  unicodefeff: "utf-16le",
  csunicode: "utf-16le",
  "iso-10646-ucs-2": "utf-16le",

  "utf-16be": "utf-16be",
  unicodefffe: "utf-16be",

  "utf-32le": "utf-32le",
  "utf-32be": "utf-32be",

  "windows-1252": "windows-1252",
  cp1252: "windows-1252",
  "x-cp1252": "windows-1252",
  "iso-8859-1": "windows-1252",
  "iso8859-1": "windows-1252",
  "iso_8859-1": "windows-1252",
  "iso_8859-1:1987": "windows-1252",
  "iso-ir-100": "windows-1252",
  csisolatin1: "windows-1252",
  l1: "windows-1252",
  latin1: "windows-1252",
  cp819: "windows-1252",
  ibm819: "windows-1252",
  "us-ascii": "windows-1252",
  ascii: "windows-1252",
  "ansi_x3.4-1968": "windows-1252",
};

/**
 * Maps a name from an XML encoding declaration onto the encoding byte-codec's decodeText would decode it under, matched case-insensitively against the WHATWG Encoding Standard's own label table (restricted to the six encodings decodeText supports).
 * @param label - The declaration's raw `encoding` value, exactly as written.
 * @returns The matching {@link TextEncodingLabel}, or `undefined` when the name is outside decodeText's own bounded set (ExaDev/documents.js#1361).
 */
export function mapXmlEncodingLabel(
  label: string,
): TextEncodingLabel | undefined {
  return XML_ENCODING_ALIASES[label.toLowerCase()];
}

// More than enough headroom above any real <?xml ...?> declaration: XML's own VersionInfo/EncodingDecl/SDDecl grammar keeps a real declaration on one short line, so this only ever bounds the scan against a document that opens with the literal bytes "<?xml" but never actually closes its own declaration, which is malformed input parseXml would refuse anyway, not a real declaration this module needs to find.
const XML_DECLARATION_SEARCH_WINDOW = 512;

const XML_DECLARATION_START = "<?xml";

// Matches the encoding declaration inside an already-confirmed "<?xml ...?>" prolog: "encoding", "=", and a quoted EncName (https://www.w3.org/TR/xml/#NT-EncName: a letter followed by letters, digits, ".", "_", or "-"), with any amount of whitespace around the "=". Applied only to the bytes up to the declaration's own "?>" close, so it can never match something inside the document body that merely looks like an encoding declaration.
const XML_ENCODING_DECL_PATTERN =
  /\bencoding\s*=\s*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/;

/**
 * Reads the raw encoding label out of an `<?xml ...?>` declaration's own leading bytes, without decoding anything.
 *
 * Safe ahead of any real decode because the declaration's own grammar restricts every character in it to ASCII: XML mandates that a declaration, if present, start at the very first byte (a byte order mark aside), so bytes not beginning with the literal ASCII sequence `<?xml` carry no declaration to read, and bytes that do keep writing ASCII up to and including the encoding name itself, whatever that name turns out to be.
 * @param bytes - The document's own leading bytes.
 * @returns The declaration's raw `encoding` value, exactly as written, or `undefined` when the leading bytes carry no `<?xml ...?>` declaration, or that declaration names no encoding.
 */
export function readXmlEncodingDeclarationLabel(
  bytes: Uint8Array,
): string | undefined {
  const windowLength = Math.min(bytes.length, XML_DECLARATION_SEARCH_WINDOW);
  let window = "";
  for (let index = 0; index < windowLength; index += 1) {
    window += String.fromCharCode(bytes[index]!);
  }
  if (!window.startsWith(XML_DECLARATION_START)) {
    return undefined;
  }
  const declarationEnd = window.indexOf("?>");
  const declaration =
    declarationEnd === -1 ? window : window.slice(0, declarationEnd);
  return XML_ENCODING_DECL_PATTERN.exec(declaration)?.[2];
}

/** How {@link detectSvgEncoding} settled the encoding: `resolved` when a byte order mark or a declaration named one decodeText can decode, `unsupported` when a declaration named something outside decodeText's own bounded set. */
export type SvgEncodingDetection =
  | { readonly kind: "resolved"; readonly encoding: TextEncodingLabel }
  | { readonly kind: "unsupported"; readonly label: string };

/**
 * Detects the encoding SVG's own XML prolog declares, per XML 1.0's own external-encoding-detection algorithm: a byte order mark first, since it needs no decoding to trust, then the `<?xml ... encoding="..."?>` declaration.
 * @param bytes - The document's own leading bytes.
 * @returns How the encoding was settled, or `undefined` when the leading bytes carry neither a byte order mark nor a declared encoding. XML's own default of UTF-8 applies in that case, left for the caller to decode strictly rather than through decodeText's own guessing.
 */
export function detectSvgEncoding(
  bytes: Uint8Array,
): SvgEncodingDetection | undefined {
  const bom = detectByteOrderMark(bytes);
  if (bom !== undefined) {
    return { kind: "resolved", encoding: bom.encoding };
  }
  const label = readXmlEncodingDeclarationLabel(bytes);
  if (label === undefined) {
    return undefined;
  }
  const encoding = mapXmlEncodingLabel(label);
  return encoding === undefined
    ? { kind: "unsupported", label }
    : { kind: "resolved", encoding };
}

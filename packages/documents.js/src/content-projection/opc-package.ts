import { unzipSync } from "fflate";
import { canonicalizeXml } from "./xml-canonical";
import { scanXml } from "./xml-scan";
import {
  BINARY_DIGEST_FACTORS,
  CANONICALISATION_FACTORS,
  MemoryBudget,
  type MemoryFactors,
} from "./memory-budget";

/** One entry of a package's zip directory, read without inflating anything. */
export interface OpcPartEntry {
  readonly name: string;
  /** Uncompressed size in bytes, as the zip directory declares it. */
  readonly size: number;
}

/** Lists the parts of an OPC package from its zip directory. Nothing is inflated, so the cost is the directory's. Directory entries are left out. */
export function listOpcParts(bytes: Uint8Array): OpcPartEntry[] {
  const entries: OpcPartEntry[] = [];
  unzipSync(bytes, {
    filter(file) {
      if (!file.name.endsWith("/")) {
        entries.push({ name: file.name, size: file.originalSize });
      }
      return false;
    },
  });
  return entries.sort((left, right) => compareNames(left.name, right.name));
}

function compareNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** Inflates exactly one part, so a caller walking a large package holds one part at a time. Throws when the part does not exist. */
export function readOpcPart(bytes: Uint8Array, name: string): Uint8Array {
  const unzipped = unzipSync(bytes, { filter: (file) => file.name === name });
  const part = unzipped[name];
  if (part === undefined) {
    throw new Error(`package has no part "${name}"`);
  }
  return part;
}

// The byte order marks: UTF-8 is EF BB BF, UTF-16 little-endian FF FE and big-endian FE FF.
const BOM_BYTE_EF = 0xef;
const BOM_BYTE_BB = 0xbb;
const BOM_BYTE_BF = 0xbf;
const BOM_BYTE_FF = 0xff;
const BOM_BYTE_FE = 0xfe;
const UTF8_BOM: readonly number[] = [BOM_BYTE_EF, BOM_BYTE_BB, BOM_BYTE_BF];
const UTF16_LE_BOM: readonly number[] = [BOM_BYTE_FF, BOM_BYTE_FE];
const UTF16_BE_BOM: readonly number[] = [BOM_BYTE_FE, BOM_BYTE_FF];

function startsWithBytes(
  bytes: Uint8Array,
  prefix: readonly number[],
): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

/** Decodes an XML part as UTF-8 or, by its byte order mark, UTF-16 (the two encodings OPC allows). Invalid UTF-8 throws instead of becoming replacement characters. */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (startsWithBytes(bytes, UTF16_LE_BOM)) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  }
  if (startsWithBytes(bytes, UTF16_BE_BOM)) {
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return decoder.decode(
    startsWithBytes(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes,
  );
}

const HEX_BYTE_WIDTH = 2;
const HEX_RADIX = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"),
  ).join("");
}

/** SHA-256 as lower-case hex, through the Web Crypto API every runtime this package targets provides. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // A copy into a fresh ArrayBuffer-backed view: digest() does not accept a SharedArrayBuffer-backed one, and a part's bytes may be a view into a larger buffer.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)));
}

/** The content type of every part a package declares, from `[Content_Types].xml`. */
export interface ContentTypes {
  /** The content type of a part by its zip entry name, or undefined when the package declares none for it. */
  readonly typeOf: (partName: string) => string | undefined;
}

const OPC_CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const CONTENT_TYPES_PART = "[Content_Types].xml";

/** Reads `[Content_Types].xml`. A package with no such part, or one that is not well-formed, declares no types. */
export function readContentTypes(bytes: Uint8Array): ContentTypes {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  try {
    scanXml(decodeXmlBytes(readOpcPart(bytes, CONTENT_TYPES_PART)), {
      startElement(element) {
        if (element.uri !== OPC_CONTENT_TYPES_NAMESPACE) {
          return;
        }
        const attribute = (name: string): string | undefined =>
          element.attributes.find((candidate) => candidate.local === name)
            ?.value;
        const contentType = attribute("ContentType");
        if (contentType === undefined) {
          return;
        }
        const extension = attribute("Extension");
        const partName = attribute("PartName");
        if (element.local === "Default" && extension !== undefined) {
          defaults.set(extension.toLowerCase(), contentType);
        } else if (element.local === "Override" && partName !== undefined) {
          overrides.set(partName.replace(/^\//, ""), contentType);
        }
      },
    });
  } catch {
    defaults.clear();
    overrides.clear();
  }
  return {
    typeOf(partName) {
      const override = overrides.get(partName);
      if (override !== undefined) {
        return override;
      }
      const dot = partName.lastIndexOf(".");
      return dot < 0
        ? undefined
        : defaults.get(partName.slice(dot + 1).toLowerCase());
    },
  };
}

const XML_CONTENT_TYPE = /(\+xml|^application\/xml|^text\/xml)$/;
const XML_EXTENSION = /\.(xml|rels|vml)$/i;

/** Whether a part is XML: by its declared content type, else by extension. */
export function isXmlPart(
  partName: string,
  contentType: string | undefined,
): boolean {
  return contentType === undefined
    ? XML_EXTENSION.test(partName)
    : XML_CONTENT_TYPE.test(contentType) || XML_EXTENSION.test(partName);
}

/** What `canonicalizeOpcPackage` records for one part. */
export type CanonicalPart =
  | {
      readonly kind: "xml";
      readonly size: number;
      /** SHA-256 of the canonical serialisation. */
      readonly digest: string;
      /** SHA-256 of the canonical serialisation with identifier and revision-stamp attributes left out. */
      readonly identifierFreeDigest: string;
    }
  | {
      readonly kind: "binary";
      readonly size: number;
      /** SHA-256 of the part's bytes. */
      readonly digest: string;
    }
  | {
      /** An XML part the scanner refused (malformed, or carrying a document type declaration). Its digest is of the raw bytes, so equality still means byte equality. */
      readonly kind: "unparsed";
      readonly size: number;
      readonly digest: string;
      /** The error's class name, never its message, since a message can quote the text it was given. */
      readonly reason: string;
    }
  | {
      /** A part not read because the memory budget did not cover it. Nothing is known of its content. */
      readonly kind: "skipped";
      readonly size: number;
      readonly reason: "exceeds-memory-budget";
    };

/** A package reduced to a form where lexical difference is gone: container details (entry order, timestamps, compression, extra fields) are not recorded at all, and each XML part is digested in canonical form. */
export interface OpcCanonicalForm {
  /** Every part by zip entry name, in name order. */
  readonly parts: ReadonlyMap<string, CanonicalPart>;
}

export interface CanonicalizeOptions {
  /** The memory, in bytes, the caller allows this pass to use. Parts are skipped, and recorded as skipped, rather than risk exceeding it. */
  readonly memoryBudgetBytes: number;
  /** Memory cost factors; supplied by the caller only to substitute other values in tests. */
  readonly memoryFactors?: MemoryFactors;
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Reduces an OPC package to digests that ignore everything lexical. Container normalisation: only each part's inflated bytes are read, so entry order, timestamps, compression method and extra fields cannot matter. Each XML part is digested after `canonicalizeXml`, together with an identifier-free digest; every other part is digested as bytes. Parts are processed one at a time.
 *
 * A part the scanner refuses is recorded as `unparsed` with the error class and digested as raw bytes. A part the memory budget does not cover is recorded as `skipped`. Neither throws, so one bad part never hides the rest.
 */
export async function canonicalizeOpcPackage(
  bytes: Uint8Array,
  options: CanonicalizeOptions,
): Promise<OpcCanonicalForm> {
  const xmlFactors = options.memoryFactors ?? CANONICALISATION_FACTORS;
  const budget = new MemoryBudget(options.memoryBudgetBytes);
  const contentTypes = readContentTypes(bytes);
  const parts = new Map<string, CanonicalPart>();
  for (const entry of listOpcParts(bytes)) {
    const xml = isXmlPart(entry.name, contentTypes.typeOf(entry.name));
    if (!budget.admit(entry.size, xml ? xmlFactors : BINARY_DIGEST_FACTORS)) {
      parts.set(entry.name, {
        kind: "skipped",
        size: entry.size,
        reason: "exceeds-memory-budget",
      });
      continue;
    }
    const content = readOpcPart(bytes, entry.name);
    if (!xml) {
      parts.set(entry.name, {
        kind: "binary",
        size: entry.size,
        digest: await sha256Hex(content),
      });
      continue;
    }
    try {
      const form = canonicalizeXml(decodeXmlBytes(content));
      parts.set(entry.name, {
        kind: "xml",
        size: entry.size,
        digest: await sha256Hex(new TextEncoder().encode(form.canonical)),
        identifierFreeDigest: await sha256Hex(
          new TextEncoder().encode(form.identifierFree),
        ),
      });
    } catch (error) {
      parts.set(entry.name, {
        kind: "unparsed",
        size: entry.size,
        digest: await sha256Hex(content),
        reason: errorClass(error),
      });
    }
  }
  return { parts };
}

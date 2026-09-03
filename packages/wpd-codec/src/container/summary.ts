import type { LayoutMetadata } from "document-schema.js";
import { uint16At } from "../bytes/view";
import { decodeWordString } from "../stream/characters";

// -- Document metadata, per WPFF "Prefix Packets 0-32", Packet Type 18 (0x12), Extended Document Summary --
//
// WordPerfect keeps a document's metadata in a prefix packet rather than in the document area, as a flat list of tagged fields: "The extended summary data group occurs for up to 100 times, one for each field defined in the extended summary", each group being "[size] (byte length of data group.) [tag] (field ID of the extended summary field.) [type] (field data type) [name] x ? (null-terminated word string, optional.) [data] x ? (null-terminated word string or 10-byte date field.)".
//
// The tag is the identity; the name is a display label the SDK explicitly says not to rely on ("Predefined fields have tag numbers in the range of 1 to 100 and may have a name, but for multilingual purposes, the name displayed in all interfaces comes from a translatable resource file"). So this module keys on the tag and reads the name only to know how many bytes to step over.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_PrefixPkt0-32.htm

// "Packet Type 18 (0x12) Extended Document Summary".
export const PACKET_TYPE_EXTENDED_DOCUMENT_SUMMARY = 0x12;

// The predefined tags from the SDK's own "Valid predefined extended summary fields" table that the shared LayoutMetadata has a field for. WordPerfect's summary has no field called Title; "Descriptive Name" is the one it offers for the same purpose -- the name a user gives the document as distinct from its filename -- so that is what lands on `title`.
const TAG_AUTHOR = 5; // "5 | Author | Single line"
const TAG_CREATION_DATE = 14; // "14 | Creation Date | Date"
const TAG_DESCRIPTIVE_NAME = 17; // "17 | Descriptive Name | Single line"
const TAG_KEYWORDS = 26; // "26 | Keywords | Single line"
const TAG_REVISION_DATE = 39; // "39 | Revision Date | Date and read only"
const TAG_SUBJECT = 46; // "46 | Subject | Single line"

// "[type] (field data type) ... bit 2: 1 = date, see 10-byte date structure below."
const TYPE_DATE = 0x04;

// "[size] [tag] [type]", three shorts, before the name and data of every group.
const GROUP_HEADER_SIZE = 6;

// "10-Byte Date Structure: [year] <month> <day> <hour> <minute> <second> <day of week> (not implemented) <time zone> (not implemented) <unused>" -- a year short then eight bytes.
const DATE_FIELD_SIZE = 10;

// "The extended summary data group occurs for up to 100 times". A packet claiming more groups than that is either malformed or not a summary packet at all, and the bound keeps a corrupted size field from turning the walk into an unbounded loop.
const MAX_SUMMARY_GROUPS = 100;

function pad(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

// Renders the 10-byte date field as an ISO-8601 local date-time. Deliberately without a trailing Z or offset: the structure's own time-zone byte is documented as "not implemented", so the file states no zone and stamping one would invent an instant it never claimed.
function readDateField(bytes: Uint8Array, offset: number): string | undefined {
  if (offset + DATE_FIELD_SIZE > bytes.length) {
    return undefined;
  }
  const year = uint16At(bytes, offset);
  const month = bytes[offset + 2];
  const day = bytes[offset + 3];
  const hour = bytes[offset + 4];
  const minute = bytes[offset + 5];
  const second = bytes[offset + 6];
  if (
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return undefined;
  }
  if (year === 0 || month === 0 || day === 0) {
    // An unset date, which the summary carries as a zeroed field rather than by omitting the group.
    return undefined;
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}`;
}

// A single-line Keywords field split into the shared schema's keyword array. The SDK gives the field one line and no separator vocabulary, so the comma every interface that shows this field uses is the reading -- and an entry that is only whitespace is dropped rather than kept as an empty keyword.
function splitKeywords(value: string): string[] {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

// Reads an Extended Document Summary packet into the shared LayoutMetadata. Fields the packet does not carry are absent rather than empty, and a group whose own size runs past the packet ends the walk: the rest of a summary whose framing has gone out of step is guesswork.
export function readDocumentSummary(packet: Uint8Array): LayoutMetadata {
  const metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    createdIso?: string;
    modifiedIso?: string;
  } = {};

  let cursor = 0;
  for (let group = 0; group < MAX_SUMMARY_GROUPS; group += 1) {
    if (cursor + GROUP_HEADER_SIZE > packet.length) {
      break;
    }
    const size = uint16At(packet, cursor);
    const tag = uint16At(packet, cursor + 2);
    const type = uint16At(packet, cursor + 4);
    if (size < GROUP_HEADER_SIZE || cursor + size > packet.length) {
      break;
    }

    // The name is optional but always framed: an absent one is the bare null terminator, so reading it as a word string is what locates the data that follows it either way.
    const availableWords = Math.floor((size - GROUP_HEADER_SIZE) / 2);
    const name = decodeWordString(
      packet,
      cursor + GROUP_HEADER_SIZE,
      availableWords,
    );
    const dataOffset = cursor + GROUP_HEADER_SIZE + name.wordsRead * 2;

    if ((type & TYPE_DATE) !== 0) {
      const iso = readDateField(packet, dataOffset);
      if (iso !== undefined) {
        if (tag === TAG_CREATION_DATE) {
          metadata.createdIso = iso;
        } else if (tag === TAG_REVISION_DATE) {
          metadata.modifiedIso = iso;
        }
      }
      cursor += size;
      continue;
    }

    const { text } = decodeWordString(
      packet,
      dataOffset,
      availableWords - name.wordsRead,
    );
    if (text.length > 0) {
      switch (tag) {
        case TAG_DESCRIPTIVE_NAME:
          metadata.title = text;
          break;
        case TAG_AUTHOR:
          metadata.author = text;
          break;
        case TAG_SUBJECT:
          metadata.subject = text;
          break;
        case TAG_KEYWORDS: {
          const keywords = splitKeywords(text);
          if (keywords.length > 0) {
            metadata.keywords = keywords;
          }
          break;
        }
        default:
          break;
      }
    }
    cursor += size;
  }

  return metadata;
}

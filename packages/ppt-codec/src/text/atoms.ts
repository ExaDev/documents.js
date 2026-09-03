import { PptFormatError } from "../errors";
import { type PptRecord, findChild } from "../record/tree";
import {
  RT_TextBytesAtom,
  RT_TextCharsAtom,
  RT_TextHeaderAtom,
} from "../record/types";

// The two spellings of a text body and the character conventions inside it. A text body is one shape's entire text -- every paragraph of it -- stored either as UTF-16 (TextCharsAtom) or, when every character fits in a byte, as that byte alone (TextBytesAtom); which spelling a producer chose carries no meaning beyond size. [MS-PPT] 2.9.1 TextHeaderAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/08d31a66-0750-4009-b416-49f2871cd178 [MS-PPT] TextCharsAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a3c5c8d5-e530-4167-a242-7743bc99aeac [MS-PPT] TextBytesAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/80aae34b-2699-43fa-9e6a-c560ae790cd7

// TextTypeEnum ([MS-PPT] 2.13.33), which says what a text body is for. Read to tell a slide's title apart from its body text; there is deliberately no 0x00000003. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/50118cd3-48c2-4329-9a40-6a0281e960b6
export const TEXT_TYPE_TITLE = 0x00000000;
export const TEXT_TYPE_BODY = 0x00000001;
export const TEXT_TYPE_NOTES = 0x00000002;
export const TEXT_TYPE_OTHER = 0x00000004;
export const TEXT_TYPE_CENTER_BODY = 0x00000005;
export const TEXT_TYPE_CENTER_TITLE = 0x00000006;
export const TEXT_TYPE_HALF_BODY = 0x00000007;
export const TEXT_TYPE_QUARTER_BODY = 0x00000008;

// The character that separates one paragraph from the next inside a stored text body. Confirmed by [MS-PPT]'s own Outline Text example, whose textBytes is "a sunny day\rthe blue sky\rsome green grass" with the note that "each line break in the text, shown as '\r', is displayed as a separate outline item". https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/0d75c317-91f7-4795-8e69-41dde73f9690
export const PARAGRAPH_SEPARATOR = "\r";

// A soft line break: a break within one paragraph rather than between two. The spec's own Outline Text page lists '\v' among the escapes it uses when rendering non-printable text content, but publishes no table stating which codepoint means what, so treating U+000B this way is an inference from that listing and from what real producers emit -- not a rule quoted from the specification. It is deliberately not treated as a paragraph separator: doing so would split one paragraph's formatting runs across two paragraphs, which is the visible failure.
export const LINE_BREAK = "\u000B";

export function readTextHeaderAtom(record: PptRecord): number {
  if (record.header.recType !== RT_TextHeaderAtom) {
    throw new PptFormatError(
      `expected RT_TextHeaderAtom (0x${RT_TextHeaderAtom.toString(16)}), found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  if (record.data.length < 4) {
    throw new PptFormatError(
      `TextHeaderAtom carries ${record.data.length} bytes, fewer than the 4 its textType field needs`,
    );
  }
  const view = new DataView(
    record.data.buffer,
    record.data.byteOffset,
    record.data.byteLength,
  );
  return view.getUint32(0, true);
}

function decodeTextBytes(bytes: Uint8Array<ArrayBuffer>): string {
  // Each byte is the low byte of a UTF-16 character whose high byte is 0x00, so the byte value is the code unit.
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function decodeTextChars(bytes: Uint8Array<ArrayBuffer>): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text = "";
  for (let at = 0; at + 1 < bytes.length; at += 2) {
    text += String.fromCharCode(view.getUint16(at, true));
  }
  return text;
}

// The text body carried by one sequence of sibling records -- an OfficeArtClientTextbox's children, or the run of records following a SlidePersistAtom. Undefined rather than "" when neither atom is present: a shape with no text records at all is a different thing from one whose text is empty, and only the caller knows which of the two to represent.
export function readTextBody(
  records: readonly PptRecord[],
): string | undefined {
  const chars = findChild(records, RT_TextCharsAtom);
  if (chars !== undefined) {
    return decodeTextChars(chars.data);
  }
  const bytes = findChild(records, RT_TextBytesAtom);
  if (bytes !== undefined) {
    return decodeTextBytes(bytes.data);
  }
  return undefined;
}

// The character count every StyleTextPropAtom run count is measured against. It is one more than the stored text's length, because the text body's final paragraph mark is counted by the formatting runs but never written into the atom -- stated directly in the spec's Character Formatting example, whose 0x15-byte textBytes has "a text body length of 22 because of the terminating line break character", matched by TextCFRun counts summing to 22. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/d88c020e-6702-4be6-9f54-220106a971d6
export function characterCountOf(text: string): number {
  return text.length + 1;
}

export interface TextParagraph {
  readonly text: string;
  // This paragraph's first character's index within the whole text body, which is the coordinate every formatting run is expressed in.
  readonly start: number;
}

// Splits a text body into its paragraphs, keeping each one's offset within the body so a formatting run's character range can be intersected with it. The separator is counted in the offsets but dropped from the text, since it marks the boundary rather than belonging to either side.
export function splitParagraphs(text: string): TextParagraph[] {
  const paragraphs: TextParagraph[] = [];
  let start = 0;
  while (start <= text.length) {
    const separatorAt = text.indexOf(PARAGRAPH_SEPARATOR, start);
    const end = separatorAt === -1 ? text.length : separatorAt;
    paragraphs.push({
      text: text.slice(start, end).split(LINE_BREAK).join("\n"),
      start,
    });
    if (separatorAt === -1) {
      break;
    }
    start = separatorAt + 1;
  }
  return paragraphs;
}

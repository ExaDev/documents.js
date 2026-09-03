// The opaque numId string the reader mints and the writer parses for RTF list encoding, following markdown-codec's own src/shared/list-id.ts precedent exactly, and for the identical reason: document-schema.js's ContentListMembership carries only {numId, level, checked?, itemId?} -- no marker-type field -- so a list property the format itself round-trips has to be packed into the one opaque string the schema does give it.
//
// What RTF actually needs to carry across is the level's own number format, which lives in the list table rather than on the paragraph: "\levelnfcN Specifies the number type for the level", where 23 is "Bullet (no number at all)" and every other value in that table is some numbering scheme (RTF 1.9.1, "List Levels"). A paragraph itself only says which list it is in (\lsN, "should exactly match the \lsN for one of the list overrides in the List Override table") and how deep (\ilvlN). Nothing in ContentDocument holds a list table, so a reader that carried only \lsN forward would leave every consumer unable to tell a bulleted list from a numbered one -- including this package's own writer, round-tripping its own output.
//
// Grammar: `rtf{N}:{bullet|ordered}[@{start}]`, where N is the document's own \lsN value, so two paragraphs in the same RTF list mint the identical numId and a consumer's grouping matches the source's. The start suffix carries \levelstartatN when it is not 1.
//
// A numId that does not match this grammar is a cross-format value this package never minted (odf.js's "list1", markdown-codec's "md1:bullet", ooxml.js's bare w:numId digits). The writer renders such a list as a bulleted one and reports rtf/construct-unrepresented rather than guessing a numbering scheme, matching markdown-codec's own documented cross-format fallback.

const NUMID_PATTERN = /^rtf(\d+):(bullet|ordered)(?:@(\d+))?$/;
const DEFAULT_ORDERED_START = 1;

// The one \levelnfcN value that is not a numbering scheme: "23 Bullet (no number at all)".
export const LEVEL_NUMBER_FORMAT_BULLET = 23;

export type RtfListType = "bullet" | "ordered";

export interface RtfListNumIdInfo {
  readonly listOverrideIndex: number;
  readonly type: RtfListType;
  // Present only when type is 'ordered' and the level's \levelstartatN differs from 1.
  readonly start?: number;
}

export function mintRtfListNumId(options: {
  readonly listOverrideIndex: number;
  readonly type: RtfListType;
  readonly start?: number;
}): string {
  const startSuffix =
    options.type === "ordered" &&
    options.start !== undefined &&
    options.start !== DEFAULT_ORDERED_START
      ? `@${String(options.start)}`
      : "";
  return `rtf${String(options.listOverrideIndex)}:${options.type}${startSuffix}`;
}

export function parseRtfListNumId(numId: string): RtfListNumIdInfo | undefined {
  const match = NUMID_PATTERN.exec(numId);
  if (match === null) {
    return undefined;
  }
  const index = match[1];
  const type = match[2];
  if (index === undefined) {
    return undefined;
  }
  if (type !== "bullet" && type !== "ordered") {
    return undefined;
  }
  const start = match[3];
  return start === undefined
    ? { listOverrideIndex: Number(index), type }
    : { listOverrideIndex: Number(index), type, start: Number(start) };
}

// The opaque numId string src/xhtml/read.ts (mint) and src/xhtml/write.ts (parse) share for XHTML list encoding -- document-schema.js's own ContentListMembership carries only {numId, level, checked?, itemId?}, no marker-type field of its own, so whether a list was <ul> or <ol> (and an <ol>'s own non-default start number) has to ride inside this one opaque string instead. The identical mechanism markdown-codec's own src/shared/list-id.ts uses for its GFM bullet/ordered distinction -- not imported from there (a cross-format-codec dependency would be the wrong direction, see README Architecture), hand-mirrored with this package's own "epub" prefix and grammar in place of markdown's richer task/loose flags, which have no XHTML <ul>/<ol> analogue at all.
//
// Grammar: `epub{N}:{bullet|ordered}[@{start}]`, e.g. "epub1:bullet", "epub2:ordered@3". Nesting mints NO new numId -- a nested <ul>/<ol> reuses its ENCLOSING list's own numId, incrementing only `level` (src/xhtml/read.ts's own readList), matching markdown-codec's and odf.js's identical nesting rule.
//
// A numId that does not match this grammar at all (a cross-format value this package never minted -- odf.js's bare "list1", or markdown-codec's own "md1:bullet") is read by src/xhtml/write.ts as an ordinary bullet list with no declared start, per the identical cross-format fallback contract every codec here already documents for the identical gap.

const NUMID_PATTERN = /^epub(\d+):(bullet|ordered)(?:@(\d+))?$/u;

export interface ListNumIdInfo {
  readonly type: "bullet" | "ordered";
  // Present only when type is 'ordered' and the start differs from the default (1).
  readonly start?: number;
}

export interface MintListNumIdOptions {
  readonly type: "bullet" | "ordered";
  readonly start?: number;
}

export function mintListNumId(
  nextId: number,
  options: MintListNumIdOptions,
): string {
  const suffix =
    options.type === "ordered" &&
    options.start !== undefined &&
    options.start !== 1
      ? `ordered@${String(options.start)}`
      : options.type;
  return `epub${String(nextId)}:${suffix}`;
}

export function parseListNumId(numId: string): ListNumIdInfo | undefined {
  const match = NUMID_PATTERN.exec(numId);
  if (match === null) {
    return undefined;
  }
  const type = match[2];
  if (type !== "bullet" && type !== "ordered") {
    return undefined;
  }
  const startText = match[3];
  if (type === "ordered" && startText !== undefined) {
    return { type, start: Number.parseInt(startText, 10) };
  }
  return { type };
}

// The characters that carry structure rather than glyphs in a .doc's logical text stream. Every value here is drawn from [MS-DOC]'s own text: the glossary defines the paragraph mark, end-of-cell mark and end-of-row mark; 2.6.2's sprmCFSpec entry enumerates the characters "that have a meaning that differs or displays differently than the underlying character"; 2.8.25's Fld defines the three field characters; and 2.4.4's section example states that a section's last character has the value 0x0C.
//
// Values that circulate as common knowledge but that this reader could not find stated in [MS-DOC] itself are deliberately absent -- 0x1E (non-breaking hyphen), 0x1F (optional hyphen) and 0xA0 (non-breaking space) among them. They pass through as ordinary characters rather than being given a meaning on the strength of a secondary source.

/** "An entity in a document that is used to denote the end of a paragraph and has a Unicode character code of 13." */
export const PARAGRAPH_MARK = 0x0d;
/** "A character with a hexadecimal value of 0x07 that is used to indicate the end of a cell in a table." With sprmPFTtp applied it is instead an end-of-row mark. */
export const CELL_MARK = 0x07;
/** The last character of every section but the last, per [MS-DOC] 2.4.4's worked example. */
export const SECTION_MARK = 0x0c;
/** "This Sprm MUST NOT be applied to any character other than a line break character (Unicode 0x000B)." */
export const LINE_BREAK = 0x0b;

/** "U+0013 - A field begin character. See Plcfld." */
export const FIELD_BEGIN = 0x13;
/** "U+0014 - A field separator character." Everything between the begin and the separator is the field's instruction, not its displayed result. */
export const FIELD_SEPARATOR = 0x14;
/** "U+0015 - A field end character." */
export const FIELD_END = 0x15;

/** "U+0001 - A picture location that is used in conjunction with sprmCPicLocation." */
export const INLINE_PICTURE = 0x01;
/** "U+0002 - An auto-numbered footnote reference. See plcffndRef." */
export const FOOTNOTE_REFERENCE = 0x02;
/** "U+0005 - An annotation reference character. See PlcfandRef." */
export const ANNOTATION_REFERENCE = 0x05;
/** "U+0008 - A drawn object. See plcfSpa." */
export const DRAWN_OBJECT = 0x08;
/** "U+0028 - A symbol. See sprmCSymbol." Only special when sprmCFSpec is applied; an ordinary '(' otherwise, so it is never treated as structural here. */
export const SYMBOL_ANCHOR = 0x28;

/** Ends a paragraph. [MS-DOC] 2.4.2: "The character at the end character position of a paragraph MUST be a paragraph mark, an end-of-section character, a cell mark, or a TTP mark." */
export function endsParagraph(code: number): boolean {
  return code === PARAGRAPH_MARK || code === CELL_MARK || code === SECTION_MARK;
}

// Anchor characters that stand in for content this reader does not yet convert -- a picture, a drawn object, a footnote or annotation reference. They are dropped from a run's text rather than emitted, because emitting them would put a U+0001 or U+0002 control character into the converted document's visible text, where every downstream format would render it as a replacement glyph or drop it silently. Dropping is the honest choice for a reader that does not yet carry the referenced object: the anchor conveys nothing on its own.
export function isAnchorOnly(code: number): boolean {
  return (
    code === INLINE_PICTURE ||
    code === FOOTNOTE_REFERENCE ||
    code === ANNOTATION_REFERENCE ||
    code === DRAWN_OBJECT
  );
}

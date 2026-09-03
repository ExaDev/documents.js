import type { Alignment } from "document-schema.js";

// -- The Tab group, per WPFF "E0 Tab Functions" --
//
// This group is shaped unlike every other: it has no subfunction catalogue. "<224 (0xE0)> <tab definition shown below>" -- the byte that sits where every other group puts a subfunction number is the tab definition itself, a bitfield whose top five bits name the tab type. So there is one function in this group, parameterised, rather than a list of them.
//
// It matters more than its size suggests. It is the second most common variable-length function in real WordPerfect documents, because a tab is how the format spells nearly every horizontal placement a typist reaches for: columns of names against countries, a reference number against a date, a numbered clause against its text. Reading the group as nothing runs those together ("Ref. T2/6.01COMSAR/Circ.15", "Naba Raj AdhikariNepal"), which is a text-fidelity loss rather than a formatting one.
//
// Three of the tab types are not tabs at all. Centre-on-margins, centre-on-current-position and flush-right start a line-scoped alignment rather than advancing to a tab stop -- and they are the missing half of a construct this reader already handles the end of, since the single-byte Soft and Hard End of Center Align functions (0x88, 0x89) are what terminate the centring these begin.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_E0-Tab.htm

export const TAB_GROUP = 0xe0;

// "bits 3-7: tab type" -- so the type is the definition byte shifted down past the three flag bits (soft type, dot leader, generic search), none of which changes what the code does to the text.
const TAB_TYPE_SHIFT = 3;

// The SDK's own tab-type enumeration, transcribed. The values are not contiguous: "bits 4-5 are not 00 if the tab type uses the tab table to get the next tab position" and "bits 6-7 are the alignment bits", so the number encodes structure rather than counting.
const BACK_TAB = 0b00000;
const TABLE_TAB = 0b00001;
const LEFT_TAB = 0b00010;
const BAR_TAB = 0b00100;
const LEFT_INDENT = 0b00110;
const LEFT_RIGHT_INDENT = 0b00111;
const CENTER_ON_MARGINS = 0b01000;
const CENTER_ON_CURRENT_POSITION = 0b01001;
const CENTER_TAB = 0b01010;
const FLUSH_RIGHT = 0b10000;
const RIGHT_TAB = 0b10010;
const DECIMAL_TAB = 0b11010;

// What one Tab group function does to the document being built.
export type WpdTabEffect =
  // Advances to the next tab stop. The shared content model has no tab-stop table and no tab node, so the horizontal advance survives as the tab character itself inside the run's text -- the one spelling every consumer of a plain string already understands, and the same thing ODF's own text:tab and WordprocessingML's w:tab render back to.
  | { readonly kind: "tab" }
  // Begins a line-scoped alignment, ending at the End of Center Align function or the end of the paragraph, whichever comes first.
  | { readonly kind: "align"; readonly alignment: Alignment };

const TAB_EFFECTS: ReadonlyMap<number, WpdTabEffect> = new Map<
  number,
  WpdTabEffect
>([
  [BACK_TAB, { kind: "tab" }],
  [TABLE_TAB, { kind: "tab" }],
  [LEFT_TAB, { kind: "tab" }],
  [BAR_TAB, { kind: "tab" }],
  // An indent holds the left margin at the tab stop it moves to, which the shared model states as a paragraph indent in points -- a measurement this reader cannot make, because the position comes from the document's own tab-stop table. The horizontal advance itself is exactly a tab's, so that is what survives.
  [LEFT_INDENT, { kind: "tab" }],
  [LEFT_RIGHT_INDENT, { kind: "tab" }],
  [CENTER_TAB, { kind: "tab" }],
  [RIGHT_TAB, { kind: "tab" }],
  [DECIMAL_TAB, { kind: "tab" }],
  [CENTER_ON_MARGINS, { kind: "align", alignment: "center" }],
  [CENTER_ON_CURRENT_POSITION, { kind: "align", alignment: "center" }],
  [FLUSH_RIGHT, { kind: "align", alignment: "right" }],
]);

// Reads one Tab group function's own definition byte. Returns undefined for a tab type the SDK's enumeration does not name, which contributes nothing rather than being guessed at as one of the types it does.
export function tabEffectFor(tabDefinition: number): WpdTabEffect | undefined {
  return TAB_EFFECTS.get(tabDefinition >> TAB_TYPE_SHIFT);
}

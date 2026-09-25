import { RT_ColorSchemeAtom, RT_TextMasterStyleAtom } from "../record/types";
import { concatBytes, u16le, u32le, writeAtom as atom } from "../record/write";
import { CF_BOLD, CF_COLOR, STYLE_BOLD } from "../text/style";

// The colour-scheme and master-text-style records syntheticPresentation composes: the slide-shaped scheme every SlideContainer/MainMasterContainer/NotesContainer carries, a producer-artefact extra scheme placed ahead of the real one, and a TextMasterStyleAtom stating one real bold/Accent-1 level for the master's own TITLE placeholder.

// [MS-PPT] 2.9.51 SlideSchemeColorSchemeAtom: 8 ColorStruct entries (red, green, blue, unused), independently fixed here rather than reused from color-scheme-write.ts's own DEFAULT_SCHEME_COLORS — a read-path fixture should not depend on what the write path happens to choose.
export function slideSchemeColorSchemeAtom(
  colors: readonly (readonly [number, number, number])[],
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_ColorSchemeAtom,
    concatBytes(
      ...colors.map(
        ([red, green, blue]) => new Uint8Array([red, green, blue, 0]),
      ),
    ),
    { recInstance: 0x001 },
  );
}

// A recInstance 0x006 RT_ColorSchemeAtom ahead of the real one in the master — the "extra colour scheme" spelling a real producer opens its main master with (LibreOffice 26.2.5.2 writes a run of these, confirmed by inspecting its raw bytes), placed in this fixture so the master's scheme lookup is exercised against a sibling sharing its record type rather than only against an empty container.
// [MS-PPT] 2.9.51: 8 ColorStruct entries of 4 bytes each (red, green, blue, unused), all zero for this placeholder scheme.
const EMPTY_COLOR_SCHEME_BYTES = 32;

export function extraColorSchemeAtom(): Uint8Array<ArrayBuffer> {
  return atom(RT_ColorSchemeAtom, new Uint8Array(EMPTY_COLOR_SCHEME_BYTES), {
    recInstance: 0x006,
  });
}

// [MS-PPT] 2.12.2 ColorIndexStruct.index: slot 0x05 is Accent 1 in the slide colour scheme's own order (see text/style.ts's own COLOR_SCHEME_SLOT_COUNT comment).
const ACCENT_1_COLOR_INDEX = 0x05;

// A TextMasterStyleAtom for TITLE stating one real level (level 0): bold, and a colour-scheme reference to Accent 1 (slot 0x05) rather than a literal RGB value — built directly from the mask-bit layout text/style.ts's own readTextPFException/readTextCFException expect (the same low-level construction style.test.ts's own fixtures already use), independently of those readers, so this fixture proves the wiring rather than merely reflecting it. Used only when a test asks for it (masterTitleBold): every other master-related test keeps the empty-levels master every other test already relies on.
export function titleMasterStyleAtomWithBoldAccent1(): Uint8Array<ArrayBuffer> {
  const pfLevel = u32le(0); // masks: no paragraph-level fields stated
  const cfMasks = CF_BOLD | CF_COLOR;
  const cfLevel = concatBytes(
    u32le(cfMasks),
    u16le(STYLE_BOLD), // fontStyle
    new Uint8Array([0, 0, 0, ACCENT_1_COLOR_INDEX]), // ColorIndexStruct: rgb bytes unused for a scheme reference
  );
  // No explicit recInstance: TEXT_TYPE_TITLE is 0x0, the same value atom() already defaults an unstated recInstance to, so stating it would be a redundant assignment rather than a real choice between two different bytes.
  return atom(RT_TextMasterStyleAtom, concatBytes(u16le(1), pfLevel, cfLevel));
}

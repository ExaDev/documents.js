import { deriveRc4CryptoApiBlockKey, rc4, sha1 } from "archive-codec";
import {
  OfficeArtClientAnchor,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_ColorSchemeAtom,
  RT_CryptSession10Container,
  RT_CurrentUserAtom,
  RT_Document,
  RT_DocumentAtom,
  RT_Drawing,
  RT_Environment,
  RT_FontCollection,
  RT_FontEntityAtom,
  RT_MainMaster,
  RT_Notes,
  RT_NotesAtom,
  RT_OutlineTextRefAtom,
  RT_PersistDirectoryAtom,
  RT_Slide,
  RT_SlideAtom,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextBytesAtom,
  RT_TextHeaderAtom,
  RT_TextMasterStyleAtom,
  RT_UserEditAtom,
  SLIDE_LIST_INSTANCE_MASTERS,
  SLIDE_LIST_INSTANCE_NOTES,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "../record/types";
import {
  asciiBytes,
  concatBytes,
  i16le,
  i32le,
  u8,
  u16le,
  u32le,
  utf16le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import { CURRENT_USER_HEADER_TOKEN_PLAIN } from "../stream/current-user";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_NOTES,
  TEXT_TYPE_OTHER,
  TEXT_TYPE_TITLE,
} from "../text/atoms";
import { CF_BOLD, CF_COLOR, STYLE_BOLD } from "../text/style";

// A whole synthetic presentation: the two [MS-PPT] streams of a one-slide document carrying a title placeholder (whose text lives in the document's slide list, reached by an OutlineTextRefAtom), a plain text box (whose text lives on the shape), and -- when asked for -- a notes slide of its own in a separate persist object reached through the document's notes list. Assembled from the same record builders the per-record suites use, so the end-to-end test exercises the real offset arithmetic -- the persist directory, the edit chain, and every cross-stream reference -- rather than a stubbed one.

// [MS-PPT] 2.4.2 DocumentAtom's 40-byte body: slideSize and notesSize as PointStructs, serverZoom as a RatioStruct, two persist references, firstSlideNumber, slideSizeType, four bool1 bytes.
function documentAtom(
  slideWidth: number,
  slideHeight: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_DocumentAtom,
    concatBytes(
      i32le(slideWidth),
      i32le(slideHeight),
      i32le(slideWidth),
      i32le(slideHeight),
      i32le(1),
      i32le(2),
      u32le(0),
      u32le(0),
      u16le(1),
      u16le(0),
      new Uint8Array(4),
    ),
    { recVer: 0x1 },
  );
}

function fontEntityAtom(faceName: string): Uint8Array<ArrayBuffer> {
  const name = new Uint8Array(64);
  name.set(utf16le(faceName).subarray(0, 62));
  return atom(RT_FontEntityAtom, concatBytes(name, new Uint8Array(4)));
}

function slidePersistAtom(
  persistIdRef: number,
  cTexts: number,
  slideId: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_SlidePersistAtom,
    concatBytes(
      u32le(persistIdRef),
      u32le(0),
      i32le(cTexts),
      u32le(slideId),
      u32le(0),
    ),
  );
}

function textBytesAtom(text: string): Uint8Array<ArrayBuffer> {
  return atom(RT_TextBytesAtom, asciiBytes(text));
}

function fsp(spid: number, flags: number): Uint8Array<ArrayBuffer> {
  return atom(OfficeArtFSP, concatBytes(u32le(spid), u32le(flags)), {
    recVer: 0x2,
  });
}

// [MS-PPT] 2.5.2's 0x18-byte SlideAtom, recVer 0x2 -- geom and placeholderTypes are irrelevant to this reader (shapes come from the drawing tree, not this array) and are left zero; only masterIdRef/notesIdRef, the two fields readSlideAtom actually surfaces, carry real values.
function slideAtom(
  masterIdRef: number,
  notesIdRef: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_SlideAtom,
    concatBytes(
      i32le(0), // geom
      new Uint8Array(8), // placeholderTypes
      u32le(masterIdRef),
      u32le(notesIdRef),
      u16le(0), // slideFlags
      u16le(0), // unused
    ),
    { recVer: 0x2 },
  );
}

// [MS-PPT] 2.9.51 SlideSchemeColorSchemeAtom: 8 ColorStruct entries (red, green, blue, unused), independently fixed here rather than reused from color-scheme-write.ts's own DEFAULT_SCHEME_COLORS -- a read-path fixture should not depend on what the write path happens to choose.
function slideSchemeColorSchemeAtom(
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

// A TextMasterStyleAtom for TITLE stating one real level (level 0): bold, and a colour-scheme reference to Accent 1 (slot 0x05) rather than a literal RGB value -- built directly from the mask-bit layout text/style.ts's own readTextPFException/readTextCFException expect (the same low-level construction style.test.ts's own fixtures already use), independently of those readers, so this fixture proves the wiring rather than merely reflecting it. Used only when a test asks for it (masterTitleBold): every other master-related test keeps the empty-levels master every other test already relies on.
function titleMasterStyleAtomWithBoldAccent1(): Uint8Array<ArrayBuffer> {
  const pfLevel = u32le(0); // masks: no paragraph-level fields stated
  const cfMasks = CF_BOLD | CF_COLOR;
  const cfLevel = concatBytes(
    u32le(cfMasks),
    u16le(STYLE_BOLD), // fontStyle
    new Uint8Array([0, 0, 0, 0x05]), // ColorIndexStruct: rgb bytes unused for a scheme reference, index 0x05 = Accent 1
  );
  return atom(
    RT_TextMasterStyleAtom,
    concatBytes(u16le(1), pfLevel, cfLevel), // cLevels = 1
    { recInstance: TEXT_TYPE_TITLE },
  );
}

function clientAnchor(
  top: number,
  left: number,
  right: number,
  bottom: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    OfficeArtClientAnchor,
    concatBytes(i16le(top), i16le(left), i16le(right), i16le(bottom)),
  );
}

export interface SyntheticPresentation {
  readonly currentUserStream: Uint8Array<ArrayBuffer>;
  readonly powerPointDocumentStream: Uint8Array<ArrayBuffer>;
}

export interface SyntheticPresentationOptions {
  readonly slideWidth?: number;
  readonly slideHeight?: number;
  readonly titleText?: string;
  readonly bodyText?: string;
  readonly fontName?: string;
  // Flips the CurrentUserAtom's own headerToken to the encrypted marker. With `password` unset this produces a file that LOOKS encrypted but carries no real DocumentEncryptionAtom or ciphertext, which is all readPptStreams's own missing-password check needs to see before it throws; it never reaches for the atom this stub never wrote. Set `password` (below) for a genuinely encrypted fixture.
  readonly encrypted?: boolean;
  // When set, builds a genuinely RC4 CryptoAPI-encrypted ([MS-OFFCRYPTO] 2.3.5) presentation under this password: every persist object except the DocumentEncryptionAtom itself is really RC4-encrypted, keyed by its own persist ID, with a real EncryptionHeader/EncryptionVerifier a caller's own password must actually match. Implies `encrypted: true`.
  readonly password?: string;
  // Speaker notes for the one slide. Absent means the document carries no notes list and no NotesContainer at all, which is how a real presentation with no notes is stored.
  readonly notesText?: string;
  // When set, the master's own TITLE TextMasterStyleAtom states one real level (bold, Accent 1 scheme colour) instead of the usual empty one -- an end-to-end proof that a title run stating neither directly resolves both through document/master.ts's own cascade and through the slide's colour scheme, rather than only through the pure-function unit tests document/master.test.ts/document/color-scheme.test.ts already cover in isolation.
  readonly masterTitleBold?: boolean;
}

// [MS-OFFCRYPTO] 2.3.5.1's own RC4 CryptoAPI EncryptionInfo/EncryptionHeader/EncryptionVerifier layout, built independently of encryption.ts's own reader (readDocumentEncryptionAtom) rather than by calling it in reverse -- the two are cross-checked against each other only by the read.test.ts round trip that decrypts what this function encrypts, not by sharing this byte-layout logic. keySizeBits is fixed at 128 here: this package's own decryptor supports any RC4 key size the header states, so a fixture testing the 40-bit special case belongs in encryption.test.ts, which exercises deriveRc4CryptoApiBlockKey directly rather than through a whole synthetic presentation.
const CRYPTOAPI_KEY_SIZE_BITS = 128;

function encryptionAtomBytes(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const blockZeroKey = deriveRc4CryptoApiBlockKey(
    password,
    salt,
    0,
    CRYPTOAPI_KEY_SIZE_BITS,
  );
  // An arbitrary 16-byte "random" verifier -- [MS-OFFCRYPTO] 2.3.4.9 never constrains its value, only that SHA-1 of it must match what decrypting encryptedVerifierHash recovers.
  const verifier = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    verifier[i] = i * 7 + 3;
  }
  const verifierHash = sha1(verifier);
  const encryptedCombined = rc4(
    blockZeroKey,
    concatBytes(verifier, verifierHash),
  );
  const encryptedVerifier = encryptedCombined.subarray(0, 16);
  const encryptedVerifierHash = encryptedCombined.subarray(16, 36);

  const header = concatBytes(
    u32le(0x04), // flags: fCryptoAPI
    u32le(0), // sizeExtra
    u32le(0x6801), // algId: RC4
    u32le(0x8004), // algIdHash: SHA-1
    u32le(CRYPTOAPI_KEY_SIZE_BITS),
    u32le(0x01), // providerType: PROV_RSA_FULL, unread by this package's own reader
    u32le(0), // reserved1
    u32le(0), // reserved2 -- no CSPName follows, so the header ends here
  );
  const verifierFields = concatBytes(
    u32le(16), // saltSize
    salt,
    encryptedVerifier,
    u32le(20), // verifierHashSize
    encryptedVerifierHash,
  );

  return concatBytes(
    u16le(2), // versionMajor
    u16le(2), // versionMinor
    u32le(0x04), // encryptionFlags: fCryptoAPI
    u32le(header.length),
    header,
    verifierFields,
  );
}

export function syntheticPresentation(
  options: SyntheticPresentationOptions = {},
): SyntheticPresentation {
  const {
    slideWidth = 5760,
    slideHeight = 4320,
    titleText = "Quarterly review",
    bodyText = "First point\rSecond point",
    fontName = "Arial",
    encrypted = false,
    password,
    notesText,
    masterTitleBold = false,
  } = options;

  const USER_NAME = "Ada";

  const DOCUMENT_PERSIST_ID = 1;
  const MASTER_PERSIST_ID = 2;
  const SLIDE_PERSIST_ID = 3;
  const NOTES_PERSIST_ID = 4;
  const ENCRYPTION_PERSIST_ID = 5;
  // [MS-PPT] 2.2.13: a MasterId MUST be at or above 0x80000000, which is also what keeps it out of the SlideId range -- matching master-write.ts's own MASTER_SLIDE_ID.
  const MASTER_ID = 0x80000000;
  const SLIDE_ID = 256;
  const NOTES_ID = 512;
  // Fixed rather than random: a reproducible fixture is easier to debug than one that only fails intermittently, and RC4 CryptoAPI's own security properties are not what this fixture is testing.
  const ENCRYPTION_SALT = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    ENCRYPTION_SALT[i] = i * 11 + 5;
  }
  // PowerPoint's own default light scheme -- an arbitrary but fixed and realistic 8-entry colour scheme, independently chosen from color-scheme-write.ts's own defaults (see slideSchemeColorSchemeAtom's own comment).
  const MASTER_COLOR_SCHEME: readonly (readonly [number, number, number])[] = [
    [0xff, 0xff, 0xff], // background
    [0x00, 0x00, 0x00], // text
    [0x80, 0x80, 0x80], // shadow
    [0x00, 0x00, 0x00], // title text
    [0xe6, 0xf2, 0xff], // fill
    [0x1a, 0x4b, 0x8c], // Accent 1
    [0x8c, 0x1a, 0x4b], // Accent 2
    [0x4b, 0x8c, 0x1a], // Accent 3
  ];

  const documentChildren = [
    documentAtom(slideWidth, slideHeight),
    container(RT_Environment, [
      container(RT_FontCollection, [fontEntityAtom(fontName)]),
    ]),
    // [MS-PPT] 2.4.14.1 MasterListWithTextContainer: the same RT_SlidePersistAtom shape the slide list itself uses, its own identifier naming a master rather than a slide.
    container(
      RT_SlideListWithText,
      [slidePersistAtom(MASTER_PERSIST_ID, 0, MASTER_ID)],
      { recInstance: SLIDE_LIST_INSTANCE_MASTERS },
    ),
    container(
      RT_SlideListWithText,
      [
        slidePersistAtom(SLIDE_PERSIST_ID, 1, SLIDE_ID),
        atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_TITLE)),
        textBytesAtom(titleText),
      ],
      { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
    ),
  ];
  if (notesText !== undefined) {
    // [MS-PPT] 2.4.14.6: the notes list holds NotesPersistAtom records alone, distinguished from the slide and master lists by rh.recInstance. [MS-PPT] 2.4.14.7's own field order puts a reserved word where a SlidePersistAtom states cTexts, and the notes identifier -- not a slide identifier -- at offset 12.
    documentChildren.push(
      container(
        RT_SlideListWithText,
        [
          atom(
            RT_SlidePersistAtom,
            concatBytes(
              u32le(NOTES_PERSIST_ID),
              u32le(0),
              i32le(0),
              u32le(NOTES_ID),
              u32le(0),
            ),
          ),
        ],
        { recInstance: SLIDE_LIST_INSTANCE_NOTES },
      ),
    );
  }
  const documentContainer = container(RT_Document, documentChildren);

  const slideContainer = container(RT_Slide, [
    slideAtom(MASTER_ID, notesText === undefined ? 0 : NOTES_ID),
    container(RT_Drawing, [
      container(OfficeArtDgContainer, [
        container(OfficeArtSpgrContainer, [
          container(OfficeArtSpContainer, [
            atom(OfficeArtFSPGR, new Uint8Array(16), { recVer: 0x1 }),
            // fGroup | fPatriarch, the outermost group every drawing carries.
            fsp(1, (1 << 0) | (1 << 2)),
          ]),
          // The title placeholder: its text is not here, only a reference to the first text of this slide's entry in the document's slide list.
          container(OfficeArtSpContainer, [
            fsp(2, 0),
            clientAnchor(360, 480, 5280, 1080),
            container(OfficeArtClientTextbox, [
              atom(RT_OutlineTextRefAtom, i32le(0)),
            ]),
          ]),
          // An ordinary text box, whose text is stored on the shape itself.
          container(OfficeArtSpContainer, [
            fsp(3, 0),
            clientAnchor(1440, 480, 5280, 3960),
            container(OfficeArtClientTextbox, [
              atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_BODY)),
              textBytesAtom(bodyText),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);

  // [MS-PPT] 2.5.6 NotesContainer: a NotesAtom naming the presentation slide these notes belong to, then a DrawingContainer holding the notes text on a plain text box's own client textbox -- the spelling a real producer writes (verified against LibreOffice's own `--convert-to ppt` output), rather than a placeholder reached through the notes list, which [MS-PPT] 2.4.14.6 gives no texts to reach into.
  const notesContainer =
    notesText === undefined
      ? undefined
      : container(RT_Notes, [
          atom(RT_NotesAtom, concatBytes(u32le(SLIDE_ID), u16le(0), u16le(0)), {
            recVer: 0x1,
          }),
          container(RT_Drawing, [
            container(OfficeArtDgContainer, [
              container(OfficeArtSpgrContainer, [
                container(OfficeArtSpContainer, [
                  atom(OfficeArtFSPGR, new Uint8Array(16), { recVer: 0x1 }),
                  fsp(1, (1 << 0) | (1 << 2)),
                ]),
                container(OfficeArtSpContainer, [
                  fsp(2, 0),
                  clientAnchor(2160, 288, 5472, 4104),
                  container(OfficeArtClientTextbox, [
                    atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_OTHER)),
                    textBytesAtom(notesText),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]);

  // [MS-PPT] 2.5.3 MainMasterContainer: this master's own SlideAtom (masterIdRef/notesIdRef both 0, since a master follows no master and has no notes of its own), one TextMasterStyleAtom per placeholder type it carries -- each stating no levels of its own (cLevels 0x0000), matching this package's own writer (master-write.ts) exactly, so a fixture whose runs never state formatting either resolves to the identical "everything absent" every existing test already asserts -- and this master's own colour scheme.
  const masterContainer = container(RT_MainMaster, [
    slideAtom(0, 0),
    masterTitleBold
      ? titleMasterStyleAtomWithBoldAccent1()
      : atom(RT_TextMasterStyleAtom, u16le(0), {
          recInstance: TEXT_TYPE_TITLE,
        }),
    atom(RT_TextMasterStyleAtom, u16le(0), { recInstance: TEXT_TYPE_BODY }),
    atom(RT_TextMasterStyleAtom, u16le(0), { recInstance: TEXT_TYPE_NOTES }),
    slideSchemeColorSchemeAtom(MASTER_COLOR_SCHEME),
  ]);

  const persistObjects = [
    { persistId: DOCUMENT_PERSIST_ID, bytes: documentContainer },
    { persistId: MASTER_PERSIST_ID, bytes: masterContainer },
    { persistId: SLIDE_PERSIST_ID, bytes: slideContainer },
  ];
  if (notesContainer !== undefined) {
    persistObjects.push({
      persistId: NOTES_PERSIST_ID,
      bytes: notesContainer,
    });
  }
  if (password !== undefined) {
    // Every existing persist object gets RC4-encrypted in place, keyed by its own persist ID -- the DocumentEncryptionAtom itself never does, since a decryptor has to read it before it knows any key at all.
    for (const object of persistObjects) {
      const key = deriveRc4CryptoApiBlockKey(
        password,
        ENCRYPTION_SALT,
        object.persistId,
        CRYPTOAPI_KEY_SIZE_BITS,
      );
      object.bytes = rc4(key, object.bytes);
    }
    persistObjects.push({
      persistId: ENCRYPTION_PERSIST_ID,
      bytes: atom(
        RT_CryptSession10Container,
        encryptionAtomBytes(password, ENCRYPTION_SALT),
        // [MS-PPT] real producers (confirmed against Apache POI's own DocumentEncryptionAtom.writeOut) stamp recVer 0xF on this atom despite its data being fields, not child records -- harmless to this package's own reader, which never calls childRecords on it.
        { recVer: 0xf },
      ),
    });
  }
  const persistEntries: Uint8Array<ArrayBuffer>[] = [];
  let persistOffset = 0;
  for (const object of persistObjects) {
    // One PersistDirectoryEntry per object (cPersist 0x001), the same one-run-per-entry form stream/persist-write.ts emits.
    persistEntries.push(
      concatBytes(u32le(object.persistId | (1 << 20)), u32le(persistOffset)),
    );
    persistOffset += object.bytes.length;
  }

  const persistDirectoryOffset = persistOffset;
  const persistDirectory = atom(
    RT_PersistDirectoryAtom,
    concatBytes(...persistEntries),
  );
  const userEditOffset = persistDirectoryOffset + persistDirectory.length;
  const userEdit = atom(
    RT_UserEditAtom,
    concatBytes(
      u32le(SLIDE_ID),
      u16le(0),
      u8(0x00),
      u8(0x03),
      u32le(0),
      u32le(persistDirectoryOffset),
      u32le(DOCUMENT_PERSIST_ID),
      u32le(persistObjects.length + 1),
      u16le(0),
      u16le(0),
      // [MS-PPT] 2.3.3: this trailing field only exists at all when the record's own recLen says so (0x20 bytes rather than 0x1c) -- there is no separate flag bit, so its presence here is exactly what marks the document as carrying a real encryption session for buildPersistDirectory's own reader to find.
      ...(password === undefined ? [] : [u32le(ENCRYPTION_PERSIST_ID)]),
    ),
  );

  const ansiUserName = asciiBytes(USER_NAME);
  const currentUserAtom = atom(
    RT_CurrentUserAtom,
    concatBytes(
      u32le(0x00000014),
      u32le(
        encrypted || password !== undefined
          ? 0xf3d1c4df
          : CURRENT_USER_HEADER_TOKEN_PLAIN,
      ),
      u32le(userEditOffset),
      u16le(ansiUserName.length),
      u16le(0x03f4),
      u8(0x03),
      u8(0x00),
      u16le(0),
      ansiUserName,
      u32le(0x00000008),
      utf16le(USER_NAME),
    ),
  );

  return {
    // Padded past the compound-file writer's own minimum stream size; every byte after the atom is outside its recLen and is therefore never read.
    currentUserStream: concatBytes(currentUserAtom, new Uint8Array(64)),
    powerPointDocumentStream: concatBytes(
      ...persistObjects.map((object) => object.bytes),
      persistDirectory,
      userEdit,
    ),
  };
}

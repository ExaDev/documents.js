// The [MS-ODRAW] recType/recInstance/enum values this package's Escher reading actually acts on, each cited to the specific page it comes from -- the same "only the values this package uses, not the whole enumeration" discipline biff/record-types.ts already follows for BIFF8's own record ids.

// --- Container recType values ([MS-ODRAW] 2.2.x, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/) ---

/** The workbook-wide drawing group's own root container, from the MsoDrawingGroup stream: holds the Blip Store and the drawing document's shared shape-id state ([MS-ODRAW] OfficeArtDggContainer, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/dd7133b6-ed10-4bcb-be29-67b0544f884f). */
export const ESCHER_DGG_CONTAINER = 0xf000;
/** The Blip Store: one BSE atom per distinct embedded/linked image the drawing group references ([MS-ODRAW] OfficeArtBstoreContainer, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/561cb6d4-d38b-4666-b2b4-10abc1dce44c). */
export const ESCHER_BSTORE_CONTAINER = 0xf001;
/** One worksheet's own drawing container, from that sheet's MsoDrawing records: wraps the Dg atom and the sheet's own shape tree. */
export const ESCHER_DG_CONTAINER = 0xf002;
/** A group of shapes -- the sheet's own root shape group (the "patriarch", holding every top-level shape as a child) and any nested shape group a real drawing groups shapes into. */
export const ESCHER_SPGR_CONTAINER = 0xf003;
/** One shape: wraps its Sp atom (type/id/flags), its Opt property table, and its anchor/text/client-data atoms ([MS-ODRAW] OfficeArtSpContainer, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/16194cb9-b4b0-476c-9678-a6ac1f06b034). */
export const ESCHER_SP_CONTAINER = 0xf004;

// --- Atom recType values ---

/** A single Blip Store Entry: one embedded or linked image's own metadata plus, when embedded, the image bytes themselves nested inside its own body ([MS-ODRAW] OfficeArtFBSE, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/2f2d7f5e-d5c4-4cb7-b230-59b3fe8f10d6). */
export const ESCHER_BSE = 0xf007;
/** A shape's own fixed fields: its shape-type ID (carried in the record header's own `recInstance`, an MSOSPT value -- see the SHAPE_TYPE_* constants below) plus its own group/flip/anchor flags ([MS-ODRAW] OfficeArtFSP, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/8a7e7be3-0582-4461-9400-29d7eda8497d). */
export const ESCHER_SP = 0xf00a;
/** A shape's own property table (fopt): a run of fixed-size property entries this reader consults for exactly one property, `pib` -- see FOPT_PROPERTY_PIB below ([MS-ODRAW] OfficeArtFOPT, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/10dc2fe1-9e69-48dc-a1d1-2921dfb9c28e). */
export const ESCHER_OPT = 0xf00b;
/** A group shape's own coordinate system ([MS-ODRAW] OfficeArtFSPGR, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/82d2d6a1-3a7a-4d15-9803-33145a76545a): four i32 coordinates, written as the all-zero rectangle a patriarch group whose children are all anchored in the sheet's own cell grid states. */
export const ESCHER_FSPGR = 0xf009;
/** The marker every shape whose following BIFF record is an Obj carries: [MS-XLS]'s own MsoDrawing prose ("If the rgChildRec has a shape structure in it ... and that shape has a clientData record in it ..., then the next record following this record MUST be an Obj") makes this empty atom the join between one Escher shape and its Obj record. [MS-ODRAW] OfficeArtClientData. */
export const ESCHER_CLIENT_DATA = 0xf011;
/** A shape's cell-anchor placement in a worksheet, macro sheet, or dialog sheet substream -- [MS-ODRAW]'s own generic ClientAnchor atom carries a host-defined payload, and [MS-XLS] 2.5.163 OfficeArtClientAnchorSheet (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/fd656a2c-d5ee-4171-8f65-17a08b9f2262) is what that payload actually is here (a chart-sheet substream uses the distinct OfficeArtClientAnchorChart instead, not read by this package). */
export const ESCHER_CLIENT_ANCHOR = 0xf010;

// --- Blip recType values ([MS-ODRAW] OfficeArtBlip family, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/c67b883b-8136-4e91-a1a3-2981d16e934f) ---

export const ESCHER_BLIP_JPEG_A = 0xf01d;
export const ESCHER_BLIP_JPEG_B = 0xf02a;
export const ESCHER_BLIP_PNG = 0xf01e;
export const ESCHER_BLIP_DIB = 0xf01f;

// --- MSOSPT ([MS-ODRAW] https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/9c0c5c01-9e90-41aa-ba15-477dacb4cc8e): the Sp atom's own recInstance. Only the handful this reader branches on are named -- every other value is still a real, recognised shape, just one this reader treats as a generic drawing shape rather than routing specially. ---

/** A custom/freeform shape with no named geometry preset -- MS-ODRAW's own escape value, not a shape type this reader has anything special to say about. */
export const SHAPE_TYPE_NOT_PRIMITIVE = 0x00;
/** A picture frame: the shape carries an image via its own `pib` property rather than vector geometry. */
export const SHAPE_TYPE_PICTURE_FRAME = 0x4b;
/** A text box shape. */
export const SHAPE_TYPE_TEXT_BOX = 0xca;

// --- FOPTE opid ([MS-ODRAW] OfficeArtFOPTE, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/2841bed9-1ff1-4981-807e-ffb9592c046d): each property entry's own 16-bit `opid` packs a 14-bit property id plus fBid/fComplex flags, and the constant below is that whole 16-bit value, exactly as the `pib` property's own page states it ("opid.opid MUST be 0x0104") rather than as a bare property id needing the flag bits added back in. ---

/** The `pib` property ([MS-ODRAW] https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a12e8c5e-a764-49d5-b407-c27bf933920d): a picture shape's own 1-based index into the Blip Store's BSE array, carried in the FOPTE's plain `op` field when `fComplex` (the opid's own top bit) is clear. */
export const FOPT_OPID_PIB = 0x0104;
export const FOPT_FCOMPLEX_MASK = 0x8000;

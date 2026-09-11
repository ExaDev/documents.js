// The subset of [MS-PPT] 2.13.24's RecordType enumeration this reader actually dispatches on, plus the [MS-ODRAW] OfficeArt record types the drawing walk crosses into. Only types the code names are listed: the enumeration itself runs from 0x03E8 to 0xF145, and transcribing the rest would be a table nothing reads, going stale against a spec revision no one would notice. [MS-PPT] 2.13.24 RecordType: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/38fb1fa5-0a62-477a-8b14-178df22de812

export const RT_Document = 0x03e8;
export const RT_DocumentAtom = 0x03e9;
export const RT_Slide = 0x03ee;
export const RT_SlideAtom = 0x03ef;
export const RT_Notes = 0x03f0;
export const RT_NotesAtom = 0x03f1;
export const RT_Environment = 0x03f2;
// One value shared by SlidePersistAtom, MasterPersistAtom and NotesPersistAtom -- which of the three a record is, is decided by the list container holding it, not by its own type.
export const RT_SlidePersistAtom = 0x03f3;
export const RT_MainMaster = 0x03f8;
export const RT_ExternalObjectList = 0x0409;
// ExObjListContainer's own mandatory first child, naming the seed a next edit would mint an ExObjId from. ExObjListAtom 2.10.3: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/ebd9be5b-3df4-4c2c-99ba-84923f01a322
export const RT_ExternalObjectListAtom = 0x040a;
export const RT_DrawingGroup = 0x040b;
export const RT_Drawing = 0x040c;
export const RT_List = 0x07d0;
export const RT_FontCollection = 0x07d5;
// One value shared by SlideSchemeColorSchemeAtom and SchemeListElementColorSchemeAtom, told apart by recInstance.
export const RT_ColorSchemeAtom = 0x07f0;
// One value shared by ExHyperlinkRefAtom and ExObjRefAtom -- which of the two a record is, is decided by its containing container, not by its own type. ExObjRefAtom 2.7.7: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/d6e17fee-7d53-453f-962b-b671a4f8869f
export const RT_ExternalObjectRefAtom = 0x0bc1;
export const RT_PlaceholderAtom = 0x0bc3;
export const RT_OutlineTextRefAtom = 0x0f9e;
export const RT_TextHeaderAtom = 0x0f9f;
export const RT_TextCharsAtom = 0x0fa0;
export const RT_StyleTextPropAtom = 0x0fa1;
export const RT_MasterTextPropAtom = 0x0fa2;
export const RT_TextMasterStyleAtom = 0x0fa3;
export const RT_TextRulerAtom = 0x0fa6;
export const RT_TextBytesAtom = 0x0fa8;
export const RT_TextSpecialInfoDefaultAtom = 0x0fa9;
export const RT_TextSpecialInfoAtom = 0x0faa;
export const RT_FontEntityAtom = 0x0fb7;
export const RT_CString = 0x0fba;
// ExOleObjAtom 2.10.12, the per-object record inside an ExOleEmbedContainer naming the persist object that holds the OLE storage: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a3517016-8e32-4585-9a42-adae02eea798
export const RT_ExternalOleObjectAtom = 0x0fc3;
// ExOleEmbedContainer 2.10.27, one entry of the document's ExObjListContainer per embedded OLE object: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c687090c-a35e-4ffc-918e-415117e10229
export const RT_ExternalOleEmbed = 0x0fcc;
export const RT_ExternalOleEmbedAtom = 0x0fcd;
// One value shared by MasterListWithTextContainer, SlideListWithTextContainer and NotesListWithTextContainer; only rh.recInstance distinguishes them, and it does not run in the order the names suggest -- see the instance constants below.
export const RT_SlideListWithText = 0x0ff0;
export const RT_UserEditAtom = 0x0ff5;
export const RT_CurrentUserAtom = 0x0ff6;
// One value shared by the compressed and uncompressed OLE-storage spellings (ExOleObjStg 2.10.34), told apart by rh.recInstance: 0x000 uncompressed, 0x001 a zlib stream behind a 4-byte decompressed size. ExOleObjStgUncompressedAtom 2.10.35: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/23491dff-f269-4a52-8512-9d7244d43cc8 ExOleObjStgCompressedAtom 2.10.36: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/305e541f-2c91-49c5-a742-4955330fd2b9
export const RT_ExternalOleObjectStg = 0x1011;
export const RT_PersistDirectoryAtom = 0x1772;
export const RT_CryptSession10Container = 0x2f14;

// The three list-with-text containers share RT_SlideListWithText and are told apart by rh.recInstance alone. The values are not in the order the container names suggest -- the slide list is 0x000 and the master list 0x001 -- so each is taken from its own specification page rather than inferred from the trio.
// SlideListWithTextContainer 2.4.14.3, "rh.recInstance MUST be 0x000": https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/307e6d12-7304-47a8-acbd-3e7b8041ad3c
export const SLIDE_LIST_INSTANCE_SLIDES = 0x000;
// MasterListWithTextContainer 2.4.14.1, "rh.recInstance MUST be 0x001": https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/18a9bc04-3307-440e-bbc2-efcb75ee923d
export const SLIDE_LIST_INSTANCE_MASTERS = 0x001;
// NotesListWithTextContainer 2.4.14.6, "rh.recInstance MUST be 0x002": https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/55453e37-0674-4703-bd8d-fcaba335f840
export const SLIDE_LIST_INSTANCE_NOTES = 0x002;

// [MS-ODRAW] record types, which share [MS-PPT]'s own 8-byte header layout and so are walked by the same reader. Every one confirmed against its own specification page rather than assumed from the numbering. OfficeArtDggContainer 2.2.12, the document-wide drawing group a slide's own OfficeArtDgContainer hangs beneath: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/dd7133b6-ed10-4bcb-be29-67b0544f884f
export const OfficeArtDggContainer = 0xf000;
// OfficeArtBStoreContainer 2.2.20, the document's whole blip store: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/561cb6d4-d38b-4666-b2b4-10abc1dce44c
export const OfficeArtBStoreContainer = 0xf001;
// OfficeArtDgContainer 2.2.13: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/68976475-fcfd-4483-8fc4-75adc635130d
export const OfficeArtDgContainer = 0xf002;
// OfficeArtSpgrContainer 2.2.16: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/e42f26e5-c0eb-4d10-a708-eef5958af44d
export const OfficeArtSpgrContainer = 0xf003;
// OfficeArtSpContainer 2.2.14: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/16194cb9-b4b0-476c-9678-a6ac1f06b034
export const OfficeArtSpContainer = 0xf004;
// OfficeArtFDGGBlock 2.2.48, the mandatory first child of an OfficeArtDggContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a9ff4320-4fa3-4408-8ea4-85c3cec0b501
export const OfficeArtFDGGBlock = 0xf006;
// OfficeArtFBSE 2.2.32, one File Blip Store Entry per picture in the blip store: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/2f2d7f5e-d5c4-4cb7-b230-59b3fe8f10d6
export const OfficeArtFBSE = 0xf007;
// OfficeArtFSPGR 2.2.38, the coordinate system a group's child anchors are expressed in: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/82d2d6a1-3a7a-4d15-9803-33145a76545a
export const OfficeArtFSPGR = 0xf009;
// OfficeArtFSP 2.2.40: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/8a7e7be3-0582-4461-9400-29d7eda8497d
export const OfficeArtFSP = 0xf00a;
// OfficeArtFOPT 2.2.9, a shape's primary property table: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/10dc2fe1-9e69-48dc-a1d1-2921dfb9c28e
export const OfficeArtFOPT = 0xf00b;
// OfficeArtClientTextbox, whose contents are host-defined -- [MS-PPT] 2.9.76 defines PowerPoint's: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/f50070dd-a4dc-4edd-a446-c4fcc5c80ace
export const OfficeArtClientTextbox = 0xf00d;
// OfficeArtChildAnchor, a grouped shape's anchor in its group's coordinate system: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/33a44593-02df-4684-ab35-5a7c4a9bcaac
export const OfficeArtChildAnchor = 0xf00f;
// OfficeArtClientAnchor, host-defined -- [MS-PPT] 2.7.1 defines PowerPoint's: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/37ee18c7-3c7c-4adc-91fb-cb3b01789d72
export const OfficeArtClientAnchor = 0xf010;
// OfficeArtClientData, host-defined -- [MS-PPT] 2.9.72 defines PowerPoint's, whose one field this package writes is the PlaceholderAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/ac3b454d-b5ea-4da8-a57c-32fc08ed332a
export const OfficeArtClientData = 0xf011;
// OfficeArtSecondaryFOPT 2.2.10, a shape's second property table: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a7b26490-a8c7-4087-904e-417b10839f77
export const OfficeArtSecondaryFOPT = 0xf121;
// OfficeArtTertiaryFOPT 2.2.11, a shape's third property table -- where a real producer states a table group's own tableProperties/tableRowProperties: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a687e90c-1748-4f57-8758-be31cfb36185
export const OfficeArtTertiaryFOPT = 0xf122;
// OfficeArtBlipJPEG 2.2.27: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/704b3ec5-3e3f-425f-b2f7-a090cc68e624
export const OfficeArtBlipJPEG = 0xf01d;
// OfficeArtBlipPNG 2.2.28: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/7af7d17e-6ae1-4c43-a3d6-691e6b3b4a45
export const OfficeArtBlipPNG = 0xf01e;

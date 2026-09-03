// The subset of [MS-PPT] 2.13.24's RecordType enumeration this reader actually dispatches on, plus the [MS-ODRAW] OfficeArt record types the drawing walk crosses into. Only types the code names are listed: the enumeration itself runs from 0x03E8 to 0xF145, and transcribing the rest would be a table nothing reads, going stale against a spec revision no one would notice. [MS-PPT] 2.13.24 RecordType: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/38fb1fa5-0a62-477a-8b14-178df22de812

export const RT_Document = 0x03e8;
export const RT_DocumentAtom = 0x03e9;
export const RT_Slide = 0x03ee;
export const RT_SlideAtom = 0x03ef;
export const RT_Notes = 0x03f0;
export const RT_Environment = 0x03f2;
// One value shared by SlidePersistAtom, MasterPersistAtom and NotesPersistAtom -- which of the three a record is, is decided by the list container holding it, not by its own type.
export const RT_SlidePersistAtom = 0x03f3;
export const RT_MainMaster = 0x03f8;
export const RT_ExternalObjectList = 0x0409;
export const RT_DrawingGroup = 0x040b;
export const RT_Drawing = 0x040c;
export const RT_List = 0x07d0;
export const RT_FontCollection = 0x07d5;
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
// One value shared by MasterListWithTextContainer, SlideListWithTextContainer and NotesListWithTextContainer; only rh.recInstance distinguishes them, and it does not run in the order the names suggest -- see the instance constants below.
export const RT_SlideListWithText = 0x0ff0;
export const RT_UserEditAtom = 0x0ff5;
export const RT_CurrentUserAtom = 0x0ff6;
export const RT_PersistDirectoryAtom = 0x1772;
export const RT_CryptSession10Container = 0x2f14;

// The three list-with-text containers share RT_SlideListWithText and are told apart by rh.recInstance alone. The values are not in the order the container names suggest -- the slide list is 0x000 and the master list 0x001 -- so each is taken from its own specification page rather than inferred from the trio.
// SlideListWithTextContainer 2.4.14.3, "rh.recInstance MUST be 0x000": https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/307e6d12-7304-47a8-acbd-3e7b8041ad3c
export const SLIDE_LIST_INSTANCE_SLIDES = 0x000;
// MasterListWithTextContainer 2.4.14.1, "rh.recInstance MUST be 0x001": https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/18a9bc04-3307-440e-bbc2-efcb75ee923d
export const SLIDE_LIST_INSTANCE_MASTERS = 0x001;
// NotesListWithTextContainer 2.4.14.6, "rh.recInstance MUST be 0x002": https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/55453e37-0674-4703-bd8d-fcaba335f840
export const SLIDE_LIST_INSTANCE_NOTES = 0x002;

// [MS-ODRAW] record types, which share [MS-PPT]'s own 8-byte header layout and so are walked by the same reader. Every one confirmed against its own specification page rather than assumed from the numbering. OfficeArtDgContainer 2.2.13: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/68976475-fcfd-4483-8fc4-75adc635130d
export const OfficeArtDgContainer = 0xf002;
// OfficeArtSpgrContainer 2.2.16: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/e42f26e5-c0eb-4d10-a708-eef5958af44d
export const OfficeArtSpgrContainer = 0xf003;
// OfficeArtSpContainer 2.2.14: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/16194cb9-b4b0-476c-9678-a6ac1f06b034
export const OfficeArtSpContainer = 0xf004;
// OfficeArtFSPGR 2.2.38, the coordinate system a group's child anchors are expressed in: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/82d2d6a1-3a7a-4d15-9803-33145a76545a
export const OfficeArtFSPGR = 0xf009;
// OfficeArtFSP 2.2.40: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/8a7e7be3-0582-4461-9400-29d7eda8497d
export const OfficeArtFSP = 0xf00a;
// OfficeArtFOPT 2.2.9: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/10dc2fe1-9e69-48dc-a1d1-2921dfb9c28e
export const OfficeArtFOPT = 0xf00b;
// OfficeArtClientTextbox, whose contents are host-defined -- [MS-PPT] 2.9.76 defines PowerPoint's: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/f50070dd-a4dc-4edd-a446-c4fcc5c80ace
export const OfficeArtClientTextbox = 0xf00d;
// OfficeArtChildAnchor, a grouped shape's anchor in its group's coordinate system: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/33a44593-02df-4684-ab35-5a7c4a9bcaac
export const OfficeArtChildAnchor = 0xf00f;
// OfficeArtClientAnchor, host-defined -- [MS-PPT] 2.7.1 defines PowerPoint's: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/37ee18c7-3c7c-4adc-91fb-cb3b01789d72
export const OfficeArtClientAnchor = 0xf010;

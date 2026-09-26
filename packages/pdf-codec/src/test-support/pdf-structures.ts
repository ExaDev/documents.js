import {
  catalogPagesPageFontObjects,
  CONTENT_OBJ,
  EMC,
  EMPTY_DICT,
  enc,
  FixtureBuilder,
  FONT_OBJ,
  HELLO_CONTENT,
  HELVETICA_FONT_DICT,
  PAGE_OBJ,
} from "./pdf";
import { zlibSync } from "fflate";

// The document-structure fixture builders, split from pdf.ts: embedded files, optional-content groups, annotations, AcroForm, metadata residue, crop boxes, print boxes, and the tagged-structure family, each a complete synthetic PDF exercising one read path.

// The embedded-files cluster (#721 phase 2): a /Names /EmbeddedFiles name-tree entry whose stream carries /Subtype and whose filespec carries /Desc; a /FileAttachment annotation on the page with its own filespec plus a SECOND annotation whose filespec duplicates the name-tree entry's name (the dedup case); and a catalog /AF associated-files entry (ISO 32000-2). One of the streams is Flate-compressed so decoding goes through the ordinary filter path, and one is raw binary bytes with no /Subtype, pinning that mimeType is absent rather than guessed.
export function embeddedFilesPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const NAME_TREE_ROOT_OBJ = 6;
  const NAME_TREE_LEAF_OBJ = 7;
  const FILESPEC_NOTES_OBJ = 8;
  const EMBEDDED_FILE_NOTES_OBJ = 9;
  const ANNOT_ATTACHMENT_1_OBJ = 10;
  const ANNOT_ATTACHMENT_2_OBJ = 11;
  const FILESPEC_LOGO_OBJ = 12;
  const FILESPEC_MANIFEST_OBJ = 13;
  const EMBEDDED_FILE_LOGO_OBJ = 14;
  const EMBEDDED_FILE_MANIFEST_OBJ = 15;
  const FILESPEC_BROKEN_OBJ = 16;
  b.object(
    1,
    "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 6 0 R >> /AF [13 0 R 16 0 R] >>",
  );
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [10 0 R 11 0 R] >>",
  );
  b.object(FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(CONTENT_OBJ, EMPTY_DICT, enc(HELLO_CONTENT));
  // The name tree root, split through a /Kids node so the walker's recursion is exercised here too.
  b.object(NAME_TREE_ROOT_OBJ, "<< /Kids [7 0 R] >>");
  b.object(NAME_TREE_LEAF_OBJ, "<< /Names [(notes.txt) 8 0 R] >>");
  b.object(
    FILESPEC_NOTES_OBJ,
    "<< /Type /Filespec /F (notes.txt) /UF (notes.txt) /Desc (Meeting notes) /EF << /F 9 0 R >> >>",
  );
  b.stream(
    EMBEDDED_FILE_NOTES_OBJ,
    "<< /Type /EmbeddedFile /Subtype /text#2Fplain >>",
    enc("Attached file body"),
  );
  // A /FileAttachment annotation with a distinct filespec, and a second whose filespec repeats the name-tree entry's name — the second must collapse into the first-Seen entry, not duplicate it.
  b.object(
    ANNOT_ATTACHMENT_1_OBJ,
    "<< /Type /Annot /Subtype /FileAttachment /Rect [150 80 170 96] /FS 12 0 R >>",
  );
  b.object(
    ANNOT_ATTACHMENT_2_OBJ,
    "<< /Type /Annot /Subtype /FileAttachment /Rect [150 60 170 76] /FS 8 0 R >>",
  );
  b.object(
    FILESPEC_LOGO_OBJ,
    "<< /Type /Filespec /F (logo.bin) /EF << /F 14 0 R >> >>",
  );
  b.object(
    FILESPEC_MANIFEST_OBJ,
    "<< /Type /Filespec /F (manifest.json) /UF (manifest.json) /EF << /F 15 0 R >> >>",
  );
  b.stream(
    EMBEDDED_FILE_LOGO_OBJ,
    "<< /Type /EmbeddedFile /Params << /Size 3 >> >>",
    new Uint8Array([0, 1, 2]),
  );
  // Flate-compressed so the bytes recover through the ordinary filter path, not just raw passthrough.
  b.stream(
    EMBEDDED_FILE_MANIFEST_OBJ,
    "<< /Type /EmbeddedFile /Filter /FlateDecode >>",
    zlibSync(enc("{}")),
  );
  // A catalog /AF entry whose /EF resolves but carries neither an /F nor a /UF stream reference — the one shape readAttachments contributes nothing for, and warns about, rather than an external/referenced filespec that never declares /EF at all.
  b.object(
    FILESPEC_BROKEN_OBJ,
    "<< /Type /Filespec /F (broken.bin) /EF << >> >>",
  );
  b.classicXrefAndTrailer(FILESPEC_BROKEN_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// The optional-content cluster (#721 phase 3): two OCGs with the default configuration switching one OFF, a /OC BDC span in the named-property-list form, one in the inline-dict form carrying /ActualText, and two form XObjects — one inheriting the outer span's layer, one declaring its own /OC (which wins for its items).
export function ocgPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const OCG_BACKGROUND_OBJ = 6;
  const OCG_NOTES_OBJ = 7;
  const FORM_1_OBJ = 8;
  const FORM_2_OBJ = 9;
  b.object(
    1,
    "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R 7 0 R] /D << /BaseState /ON /OFF [6 0 R] >> >> >>",
  );
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> /Properties << /L1 << /OC 6 0 R >> >> /XObject << /Fm1 8 0 R /Fm2 9 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(
    CONTENT_OBJ,
    EMPTY_DICT,
    enc(
      [
        "BT /F1 12 Tf 10 180 Td (Visible text) Tj ET",
        "/OC /L1 BDC",
        "BT /F1 12 Tf 10 150 Td (Hidden layer text) Tj ET",
        "/Fm1 Do",
        EMC,
        "/Span << /OC 7 0 R /ActualText (Replacement reading) >> BDC",
        "BT /F1 12 Tf 10 120 Td (Annotated text) Tj ET",
        EMC,
        "/Fm2 Do",
      ].join("\n"),
    ),
  );
  b.object(OCG_BACKGROUND_OBJ, "<< /Type /OCG /Name (Background) >>");
  b.object(OCG_NOTES_OBJ, "<< /Type /OCG /Name (Notes) >>");
  b.stream(
    FORM_1_OBJ,
    "<< /Type /XObject /Subtype /Form /BBox [0 0 200 40] /Resources << /Font << /F1 4 0 R >> >> >>",
    enc("BT /F1 12 Tf 10 20 Td (Form text) Tj ET"),
  );
  b.stream(
    FORM_2_OBJ,
    "<< /Type /XObject /Subtype /Form /OC 7 0 R /BBox [0 0 200 40] /Resources << /Font << /F1 4 0 R >> >> >>",
    enc("BT /F1 12 Tf 10 20 Td (Owned form text) Tj ET"),
  );
  b.classicXrefAndTrailer(FORM_2_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// The annotation cluster (#721 phase 4): a genuine third-party sticky note (a /T that is not this package's own presenter-notes marker), a FreeText, a Highlight carrying /QuadPoints, and a Stamp — the opaque kind whose facts ride the quarantined residue channel. Page 2 carries no annotations at all, pinning that the page field is absent rather than an empty array.
export function annotationsPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const PAGE_1_OBJ = 3;
  const PAGE_2_OBJ = 4;
  const SHARED_FONT_OBJ = 5;
  const CONTENT_STREAM_OBJ = 6;
  const ANNOT_TEXT_OBJ = 7;
  const ANNOT_FREETEXT_OBJ = 8;
  const ANNOT_HIGHLIGHT_OBJ = 9;
  const ANNOT_STAMP_OBJ = 10;
  const ANNOT_UNDERLINE_OBJ = 11;
  const ANNOT_STRIKEOUT_OBJ = 12;
  const ANNOT_SQUIGGLY_OBJ = 13;
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>");
  b.object(
    PAGE_1_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [7 0 R 8 0 R 9 0 R 10 0 R 11 0 R 12 0 R 13 0 R] >>",
  );
  b.object(
    PAGE_2_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
  );
  b.object(SHARED_FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(CONTENT_STREAM_OBJ, EMPTY_DICT, enc(HELLO_CONTENT));
  b.object(
    ANNOT_TEXT_OBJ,
    "<< /Type /Annot /Subtype /Text /Rect [10 60 26 76] /Contents (A real reviewer note) /T (Reviewer) /M (D:20260819140300Z) >>",
  );
  b.object(
    ANNOT_FREETEXT_OBJ,
    "<< /Type /Annot /Subtype /FreeText /Rect [40 60 140 80] /Contents (Typed remark) /T (Reviewer) >>",
  );
  b.object(
    ANNOT_HIGHLIGHT_OBJ,
    "<< /Type /Annot /Subtype /Highlight /Rect [12 30 60 42] /Contents (Marked passage) /T (Second reviewer) /QuadPoints [12 42 60 42 60 30 12 30] >>",
  );
  b.object(
    ANNOT_STAMP_OBJ,
    "<< /Type /Annot /Subtype /Stamp /Rect [100 20 140 40] /Contents (Approved) /T (Reviewer) /Name /Approved >>",
  );
  b.object(
    ANNOT_UNDERLINE_OBJ,
    "<< /Type /Annot /Subtype /Underline /Rect [20 70 80 82] /Contents (Underlined text) /T (Third reviewer) /QuadPoints [20 82 80 82 80 70 20 70] >>",
  );
  b.object(
    ANNOT_STRIKEOUT_OBJ,
    "<< /Type /Annot /Subtype /StrikeOut /Rect [90 70 150 82] /Contents (Struck text) /T (Third reviewer) /QuadPoints [90 82 150 82 150 70 90 70] >>",
  );
  b.object(
    ANNOT_SQUIGGLY_OBJ,
    "<< /Type /Annot /Subtype /Squiggly /Rect [20 85 80 97] /Contents (Squiggly text) /T (Third reviewer) /QuadPoints [20 97 80 97 80 85 20 85] >>",
  );
  b.classicXrefAndTrailer(ANNOT_SQUIGGLY_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// The AcroForm cluster (#721 phase 5): a merged text field (its own /Rect, no widget kids) with /V, /TU, and the ReadOnly /Ff bit; a non-terminal group field whose two children exercise the combo flag on /FT /Ch (with /Opt and a /V) and a checkbox whose /V names an export value other than Off; and a signature field. The widget kids appear in the page's /Annots too, pinning that the Widget walk is owned by the field tree rather than duplicating as an annotation record.
export function acroFormPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const WIDGET_FULLNAME_OBJ = 6;
  const FIELD_CONTACT_GROUP_OBJ = 7;
  const FIELD_COUNTRY_OBJ = 8;
  const FIELD_SUBSCRIBE_OBJ = 9;
  const WIDGET_COUNTRY_OBJ = 10;
  const WIDGET_SUBSCRIBE_OBJ = 11;
  const FIELD_SIGNATURE_OBJ = 12;
  const WIDGET_SIGNATURE_OBJ = 13;
  b.object(
    1,
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R 7 0 R 12 0 R] >> >>",
  );
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R 10 0 R 11 0 R 13 0 R] >>",
  );
  b.object(FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(CONTENT_OBJ, EMPTY_DICT, enc(HELLO_CONTENT));
  b.object(
    WIDGET_FULLNAME_OBJ,
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (fullname) /V (Jane Doe) /TU (Full name) /Ff 1 /Rect [10 80 110 96] /P 3 0 R >>",
  );
  b.object(FIELD_CONTACT_GROUP_OBJ, "<< /T (contact) /Kids [8 0 R 9 0 R] >>");
  b.object(
    FIELD_COUNTRY_OBJ,
    "<< /FT /Ch /Ff 131072 /T (country) /Opt [(UK) (US)] /V (UK) /Kids [10 0 R] >>",
  );
  b.object(
    FIELD_SUBSCRIBE_OBJ,
    "<< /FT /Btn /T (subscribe) /V /Yes /Kids [11 0 R] >>",
  );
  b.object(
    WIDGET_COUNTRY_OBJ,
    "<< /Type /Annot /Subtype /Widget /Rect [10 60 110 74] /P 3 0 R /Parent 8 0 R >>",
  );
  b.object(
    WIDGET_SUBSCRIBE_OBJ,
    "<< /Type /Annot /Subtype /Widget /Rect [10 40 22 52] /P 3 0 R /Parent 9 0 R >>",
  );
  b.object(
    FIELD_SIGNATURE_OBJ,
    "<< /FT /Sig /T (sig) /TU (Approver signature) /Kids [13 0 R] >>",
  );
  b.object(
    WIDGET_SIGNATURE_OBJ,
    "<< /Type /Annot /Subtype /Widget /Rect [150 20 190 40] /P 3 0 R /Parent 12 0 R >>",
  );
  b.classicXrefAndTrailer(WIDGET_SIGNATURE_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// The metadata/residue cluster (#721 phase 6): catalog /Lang, an XMP /Metadata stream whose Dublin Core fields partially overlap an /Info dict (pinning that /Info wins and XMP fills only the gaps, the PDF/A shape), and the residue rows — /ViewerPreferences, /PageMode, /OutputIntents, and the trailer /ID.
export function metadataResiduePdf(): Uint8Array<ArrayBuffer> {
  const xmp = [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">From XMP</rdf:li></rdf:Alt></dc:title>',
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">The XMP description</rdf:li></rdf:Alt></dc:description>',
    "<dc:subject><rdf:Bag><rdf:li>xmp</rdf:li><rdf:li>metadata</rdf:li></rdf:Bag></dc:subject>",
    "<dc:creator><rdf:Seq><rdf:li>XMP Author</rdf:li></rdf:Seq></dc:creator>",
    "<pdf:Producer>XMP Producer 9.9</pdf:Producer>",
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
  const b = new FixtureBuilder().header();
  const METADATA_OBJ = 6;
  const OUTPUT_INTENT_OBJ = 7;
  const INFO_OBJ = 8;
  b.object(
    1,
    "<< /Type /Catalog /Pages 2 0 R /Lang (en-GB) /Metadata 6 0 R /ViewerPreferences << /HideToolbar true >> /PageMode /UseOutlines /OutputIntents [7 0 R] >>",
  );
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(CONTENT_OBJ, EMPTY_DICT, enc(HELLO_CONTENT));
  b.stream(METADATA_OBJ, "<< /Type /Metadata /Subtype /XML >>", enc(xmp));
  b.object(
    OUTPUT_INTENT_OBJ,
    "<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) >>",
  );
  b.object(INFO_OBJ, "<< /Title (From Info) >>");
  b.classicXrefAndTrailer(
    INFO_OBJ,
    "/Root 1 0 R /Info 8 0 R /ID [<0a1b2c3d4e5f60718293a4b5c6d7e8f9> <0a1b2c3d4e5f60718293a4b5c6d7e8f9>]",
  );
  return b.bytes();
}

// --- Page boundaries (#759): /CropBox as the visible region, and the print-production boxes with no model home. ---

// MediaBox [0 0 200 100] with CropBox [100 0 200 50] — the right half's lower band is the only visible region. Three paint operations: text wholly inside the crop, text wholly in the cropped-away left half, and a rect straddling the crop's right edge (x 190..210 against the boundary at 200). A viewer shows the inside text in full, the straddling rect clipped at x=200, and nothing of the outside text. A URI link annotation in the cropped-away half rides along: an annotation is an anchored construct, not painted stream content, so the visibility filter must not claim it.
export function cropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const ANNOT_OBJ = 6;
  catalogPagesPageFontObjects(
    b,
    CONTENT_OBJ,
    "[0 0 200 100]",
    "/CropBox [100 0 200 50] /Annots [6 0 R] ",
  );
  b.stream(
    CONTENT_OBJ,
    EMPTY_DICT,
    enc(
      "BT /F1 12 Tf 120 20 Td (inside) Tj ET BT /F1 12 Tf 10 80 Td (outside) Tj ET 190 20 20 10 re f",
    ),
  );
  b.object(
    ANNOT_OBJ,
    "<< /Type /Annot /Subtype /Link /Rect [10 70 60 84] /A << /S /URI /URI (https://example.com/marks) >> >>",
  );
  b.classicXrefAndTrailer(ANNOT_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// The same geometry with /Rotate 90 — the crop rect must land origin-normalised in the rotated frame too (the rotated crop spans x 0..50, y 0..100, so the page reports 50x100, the inside text at (120, 20) lands at (20, 80), and the straddling rect crosses the rotated boundary at y=0).
export function rotatedCropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  catalogPagesPageFontObjects(
    b,
    CONTENT_OBJ,
    "[0 0 200 100]",
    "/CropBox [100 0 200 50] /Rotate 90 ",
  );
  b.stream(
    CONTENT_OBJ,
    EMPTY_DICT,
    enc(
      "BT /F1 12 Tf 120 20 Td (inside) Tj ET BT /F1 12 Tf 10 80 Td (outside) Tj ET 190 20 20 10 re f",
    ),
  );
  b.classicXrefAndTrailer(CONTENT_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// CropBox declared on the PARENT Pages node — it is one of the four page-tree-inheritable attributes (ISO 32000-1 7.7.3.4), so a page with no /CropBox of its own inherits the bottom band [0 0 200 50].
export function inheritedCropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(
    2,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 /CropBox [0 0 200 50] >>",
  );
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(
    CONTENT_OBJ,
    EMPTY_DICT,
    enc(
      "BT /F1 12 Tf 10 20 Td (inside) Tj ET BT /F1 12 Tf 10 80 Td (outside) Tj ET",
    ),
  );
  b.classicXrefAndTrailer(CONTENT_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// MediaBox with an EQUAL CropBox plus the three print-production boxes declared page-direct (ISO 32000-1 Table 30 lists /BleedBox /TrimBox /ArtBox as ordinary per-page entries, not inheritable ones): nothing is cropped away, but the declared boxes are facts beyond the visible box that the model has no field for.
export function printBoxesPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  catalogPagesPageFontObjects(
    b,
    CONTENT_OBJ,
    "[0 0 200 100]",
    "/CropBox [0 0 200 100] /BleedBox [0 0 210 110] /TrimBox [5 5 195 95] /ArtBox [10 10 190 90] ",
  );
  b.stream(CONTENT_OBJ, EMPTY_DICT, enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(CONTENT_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// MediaBox with an EQUAL CropBox and nothing else — the degenerate declaration a producer sometimes writes. Nothing is cropped away, and a crop box that IS the media box carries no fact beyond the visible one, so this page contributes no residue row.
export function equalCropBoxPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  catalogPagesPageFontObjects(
    b,
    CONTENT_OBJ,
    "[0 0 200 100]",
    "/CropBox [0 0 200 100] ",
  );
  b.stream(CONTENT_OBJ, EMPTY_DICT, enc(HELLO_CONTENT));
  b.classicXrefAndTrailer(CONTENT_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// The tagged-structure cluster (#760): a /StructTreeRoot whose /K walk covers a role-mapped heading (/S /Chapter that /RoleMap maps to /H1, set at the SAME 12pt as the body so a heading test can pin structure-over-geometry), a /P resolving its /Lang through /ClassMap, a Table/TR/TH/TD subtree, and a second page whose /Sect carries its own /T and /Lang. The parent tree's per-page entries use the shape real producers write (14.7.4.4): each page's key is that page's OWN /StructParents value and the entry is an ARRAY of owning elements indexed by MCID, so MCID 0 appears on BOTH pages owned by different elements — pinning that association is keyed (page, mcid), never mcid alone. Page 2 also carries unmarked text, pinning that an item with no association simply omits the field, and key 5 holds a single element reference no page claims — the OBJR channel's shape, which the (page, MCID) walk must recognise and skip.
export function taggedStructurePdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const PAGE_2_OBJ = 4;
  const SHARED_FONT_OBJ = 5;
  const CONTENT_PAGE_1_OBJ = 6;
  const CONTENT_PAGE_2_OBJ = 7;
  const STRUCT_TREE_ROOT_OBJ = 8;
  const STRUCT_CHAPTER_OBJ = 9;
  const STRUCT_BODY_PARA_OBJ = 10;
  const STRUCT_TABLE_OBJ = 11;
  const STRUCT_ROW_1_OBJ = 12;
  const STRUCT_ROW_2_OBJ = 13;
  const STRUCT_HEADER_CELL_1_OBJ = 14;
  const STRUCT_HEADER_CELL_2_OBJ = 15;
  const STRUCT_DATA_CELL_1_OBJ = 16;
  const STRUCT_DATA_CELL_2_OBJ = 17;
  const STRUCT_SECT_OBJ = 18;
  const STRUCT_SECT_PARA_OBJ = 19;
  const PARENT_TREE_OBJ = 20;
  const STRUCT_ASIDE_OBJ = 21;
  b.object(1, "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 8 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /StructParents 0 >>",
  );
  b.object(
    PAGE_2_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R /StructParents 1 >>",
  );
  b.object(SHARED_FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(
    CONTENT_PAGE_1_OBJ,
    EMPTY_DICT,
    enc(
      [
        "/H1 << /MCID 0 >> BDC",
        "BT /F1 12 Tf 10 180 Td (Chapter title) Tj ET",
        EMC,
        "/P << /MCID 1 >> BDC",
        "BT /F1 12 Tf 10 150 Td (Body paragraph) Tj ET",
        EMC,
        "/TH << /MCID 2 >> BDC",
        "BT /F1 12 Tf 10 120 Td (Name) Tj ET",
        EMC,
        "/TH << /MCID 3 >> BDC",
        "BT /F1 12 Tf 100 120 Td (Value) Tj ET",
        EMC,
        "/TD << /MCID 4 >> BDC",
        "BT /F1 12 Tf 10 90 Td (Alpha) Tj ET",
        EMC,
        "/TD << /MCID 5 >> BDC",
        "BT /F1 12 Tf 100 90 Td (One) Tj ET",
        EMC,
      ].join("\n"),
    ),
  );
  b.stream(
    CONTENT_PAGE_2_OBJ,
    EMPTY_DICT,
    enc(
      [
        "/P << /MCID 0 >> BDC",
        "BT /F1 12 Tf 10 180 Td (Paragraphe francais) Tj ET",
        EMC,
        "BT /F1 12 Tf 10 150 Td (Untagged) Tj ET",
      ].join("\n"),
    ),
  );
  b.object(
    STRUCT_TREE_ROOT_OBJ,
    "<< /Type /StructTreeRoot /K [9 0 R 10 0 R 11 0 R 18 0 R 21 0 R] /RoleMap << /Chapter /H1 >> /ClassMap << /BodyText << /Lang (en) >> >> /ParentTree 20 0 R >>",
  );
  b.object(
    STRUCT_CHAPTER_OBJ,
    "<< /Type /StructElem /S /Chapter /P 8 0 R /T (Opening) /K [0] >>",
  );
  b.object(
    STRUCT_BODY_PARA_OBJ,
    "<< /Type /StructElem /S /P /P 8 0 R /C [/BodyText] /K [1] >>",
  );
  b.object(
    STRUCT_TABLE_OBJ,
    "<< /Type /StructElem /S /Table /P 8 0 R /Alt (Quarterly figures) /K [12 0 R 13 0 R] >>",
  );
  b.object(
    STRUCT_ROW_1_OBJ,
    "<< /Type /StructElem /S /TR /P 11 0 R /K [14 0 R 15 0 R] >>",
  );
  b.object(
    STRUCT_ROW_2_OBJ,
    "<< /Type /StructElem /S /TR /P 11 0 R /K [16 0 R 17 0 R] >>",
  );
  b.object(
    STRUCT_HEADER_CELL_1_OBJ,
    "<< /Type /StructElem /S /TH /P 12 0 R /K [2] >>",
  );
  b.object(
    STRUCT_HEADER_CELL_2_OBJ,
    "<< /Type /StructElem /S /TH /P 12 0 R /K [3] >>",
  );
  b.object(
    STRUCT_DATA_CELL_1_OBJ,
    "<< /Type /StructElem /S /TD /P 13 0 R /K [4] >>",
  );
  b.object(
    STRUCT_DATA_CELL_2_OBJ,
    "<< /Type /StructElem /S /TD /P 13 0 R /ActualText (Quatre) /K [5] >>",
  );
  b.object(
    STRUCT_SECT_OBJ,
    "<< /Type /StructElem /S /Sect /P 8 0 R /T (Section deux) /Lang (fr) /K [19 0 R] >>",
  );
  b.object(
    STRUCT_SECT_PARA_OBJ,
    "<< /Type /StructElem /S /P /P 18 0 R /K [0] >>",
  );
  // The per-page values are arrays indexed by MCID (14.7.4.4), keyed by each page's /StructParents; key 5's single reference is the OBJR channel's shape.
  b.object(
    PARENT_TREE_OBJ,
    "<< /Nums [0 [9 0 R 10 0 R 14 0 R 15 0 R 16 0 R 17 0 R] 1 [19 0 R] 5 21 0 R] >>",
  );
  // /Aside names no /RoleMap entry, pinning that an unmapped custom type passes through verbatim rather than being forced onto the nearest standard name.
  b.object(STRUCT_ASIDE_OBJ, "<< /Type /StructElem /S /Aside /P 8 0 R >>");
  b.classicXrefAndTrailer(STRUCT_ASIDE_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// A parent tree whose keys do NOT match page positions (#760): page 1 (index 0) declares /StructParents 7 and page 2 (index 1) declares /StructParents 0, inverting both against their indices — a reader that treats the key as a page index hands each page the other page's element. Page 2's array also opens with a null (an MCID no element owns), pinning that array entries naming no element are skipped rather than misread, and its stream therefore marks MCID 1.
export function taggedStructureInvertedParentsPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const PAGE_2_OBJ = 4;
  const SHARED_FONT_OBJ = 5;
  const CONTENT_PAGE_1_OBJ = 6;
  const CONTENT_PAGE_2_OBJ = 7;
  const STRUCT_TREE_ROOT_OBJ = 8;
  const STRUCT_HEADING_OBJ = 9;
  const STRUCT_PARA_OBJ = 10;
  const PARENT_TREE_OBJ = 11;
  b.object(1, "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 8 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /StructParents 7 >>",
  );
  b.object(
    PAGE_2_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R /StructParents 0 >>",
  );
  b.object(SHARED_FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(
    CONTENT_PAGE_1_OBJ,
    EMPTY_DICT,
    enc(
      [
        "/P << /MCID 0 >> BDC",
        "BT /F1 12 Tf 10 180 Td (First page) Tj ET",
        EMC,
      ].join("\n"),
    ),
  );
  b.stream(
    CONTENT_PAGE_2_OBJ,
    EMPTY_DICT,
    enc(
      [
        "/P << /MCID 1 >> BDC",
        "BT /F1 12 Tf 10 180 Td (Second page) Tj ET",
        EMC,
      ].join("\n"),
    ),
  );
  b.object(
    STRUCT_TREE_ROOT_OBJ,
    "<< /Type /StructTreeRoot /K [9 0 R 10 0 R] /ParentTree 11 0 R >>",
  );
  b.object(
    STRUCT_HEADING_OBJ,
    "<< /Type /StructElem /S /H1 /P 8 0 R /T (First heading) /K [0] >>",
  );
  b.object(
    STRUCT_PARA_OBJ,
    "<< /Type /StructElem /S /P /P 8 0 R /T (Second paragraph) /K [1] >>",
  );
  b.object(PARENT_TREE_OBJ, "<< /Nums [7 [9 0 R] 0 [null 10 0 R]] >>");
  b.classicXrefAndTrailer(PARENT_TREE_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// Marked content painted through a form XObject (#760): a form invoked inside a page MCID span paints that span's content (the enclosing page MCID carries onto what it paints), while a form whose own dict declares /StructParents numbers its own MCIDs in its own parent-tree key, so neither its marked nor its unmarked content may inherit the invoking span. The second form's own MCID 0 DOES have an owner under key 3, pinning that the /Stm-qualified channel is left alone rather than looked up against the page's numbering.
export function taggedFormPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const STRUCT_TREE_ROOT_OBJ = 6;
  const STRUCT_CARRIED_SPAN_OBJ = 7;
  const FORM_INHERITED_OBJ = 8;
  const FORM_SELF_MARKED_OBJ = 9;
  const STRUCT_OWN_NUMBERING_OBJ = 10;
  const PARENT_TREE_OBJ = 11;
  b.object(1, "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> /XObject << /FmA 8 0 R /FmB 9 0 R >> >> /Contents 5 0 R /StructParents 0 >>",
  );
  b.object(FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(
    CONTENT_OBJ,
    EMPTY_DICT,
    enc(
      [
        "/P << /MCID 0 >> BDC",
        "/FmA Do",
        EMC,
        "/P << /MCID 1 >> BDC",
        "/FmB Do",
        EMC,
      ].join("\n"),
    ),
  );
  b.object(
    STRUCT_TREE_ROOT_OBJ,
    "<< /Type /StructTreeRoot /K [7 0 R 10 0 R] /ParentTree 11 0 R >>",
  );
  b.object(
    STRUCT_CARRIED_SPAN_OBJ,
    "<< /Type /StructElem /S /P /P 6 0 R /T (Carried span) /K [0] >>",
  );
  b.stream(
    FORM_INHERITED_OBJ,
    "<< /Type /XObject /Subtype /Form /BBox [0 0 200 30] /Resources << /Font << /F1 4 0 R >> >> >>",
    enc("BT /F1 12 Tf 10 10 Td (Inherited form text) Tj ET"),
  );
  b.stream(
    FORM_SELF_MARKED_OBJ,
    "<< /Type /XObject /Subtype /Form /StructParents 3 /BBox [0 0 200 30] /Resources << /Font << /F1 4 0 R >> >> >>",
    enc(
      [
        "/Span << /MCID 0 >> BDC",
        "BT /F1 12 Tf 10 10 Td (Self-marked form text) Tj ET",
        EMC,
      ].join("\n"),
    ),
  );
  b.object(
    STRUCT_OWN_NUMBERING_OBJ,
    "<< /Type /StructElem /S /P /P 6 0 R /T (Own numbering) /K [1] >>",
  );
  b.object(PARENT_TREE_OBJ, "<< /Nums [0 [7 0 R 10 0 R] 3 [10 0 R]] >>");
  b.classicXrefAndTrailer(PARENT_TREE_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// A page whose /StructParents names a key the parent tree does not carry (#760) — the inconsistent-mapping malformation real producers do create. The tree itself is healthy (key 0 names an owner for MCID 0) but the page declares 4, so its marked content resolves to no owner and the inconsistency surfaces as a diagnostic rather than silence.
export function parentTreeMissingEntryPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const STRUCT_TREE_ROOT_OBJ = 6;
  const STRUCT_PARA_OBJ = 7;
  const PARENT_TREE_OBJ = 8;
  b.object(1, "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /StructParents 4 >>",
  );
  b.object(FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(
    CONTENT_OBJ,
    EMPTY_DICT,
    enc(
      [
        "/P << /MCID 0 >> BDC",
        "BT /F1 12 Tf 10 100 Td (Owned by nothing) Tj ET",
        EMC,
      ].join("\n"),
    ),
  );
  b.object(
    STRUCT_TREE_ROOT_OBJ,
    "<< /Type /StructTreeRoot /K [7 0 R] /ParentTree 8 0 R >>",
  );
  b.object(STRUCT_PARA_OBJ, "<< /Type /StructElem /S /P /P 6 0 R /K [0] >>");
  b.object(PARENT_TREE_OBJ, "<< /Nums [0 [7 0 R]] >>");
  b.classicXrefAndTrailer(PARENT_TREE_OBJ, "/Root 1 0 R");
  return b.bytes();
}

// A page showing two CIDs from a composite (Type0) font, with the caller choosing the /Encoding CMap and whatever vertical-metric entries the descendant CIDFont carries. One fixture covers the whole writing-mode surface: Identity-H as the horizontal control, Identity-V, a predefined vertical CMap named only by its own "-V" suffix, and an embedded CMap stream whose own /WMode is the only thing that says which way the text runs. Both CIDs are 1000/1000 em wide horizontally, so every expected position below is exact rather than font-dependent, and the /ToUnicode CMap maps them to two kana so the recovered text is real rather than a pair of replacement characters.
export function compositeFontWritingModePdf(options: {
  readonly encoding: string; // the Type0 font's own /Encoding value, a name or an indirect reference
  readonly encodingStream?: string; // an embedded CMap stream's dict, written as object 9 when present
  readonly verticalMetrics?: string; // the descendant CIDFont's own /DW2 and /W2 entries, if any
  readonly content?: string; // the page's own content stream, for a caller that needs text state the default does not set
}): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const TYPE0_FONT_OBJ = 4;
  const CID_FONT_OBJ = 5;
  const CONTENT_STREAM_OBJ = 6;
  const TO_UNICODE_OBJ = 7;
  const FONT_DESCRIPTOR_OBJ = 8;
  const ENCODING_STREAM_OBJ = 9;
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    PAGE_OBJ,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
  );
  b.object(
    TYPE0_FONT_OBJ,
    `<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding ${options.encoding} /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>`,
  );
  b.object(
    CID_FONT_OBJ,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /DW 1000 /W [65 [1000] 66 [1000]] ${options.verticalMetrics ?? ""} /FontDescriptor 8 0 R >>`,
  );
  b.stream(
    CONTENT_STREAM_OBJ,
    EMPTY_DICT,
    enc(options.content ?? "BT /F1 20 Tf 100 700 Td <00410042> Tj ET"),
  );
  b.stream(
    TO_UNICODE_OBJ,
    EMPTY_DICT,
    enc(
      [
        "begincmap",
        "2 beginbfchar",
        "<0041> <3042>",
        "<0042> <3044>",
        "endbfchar",
        "endcmap",
      ].join("\n"),
    ),
  );
  b.object(
    FONT_DESCRIPTOR_OBJ,
    "<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 4 >>",
  );
  if (options.encodingStream !== undefined) {
    b.stream(
      ENCODING_STREAM_OBJ,
      options.encodingStream,
      enc("begincmap\nendcmap"),
    );
    b.classicXrefAndTrailer(ENCODING_STREAM_OBJ, "/Root 1 0 R");
    return b.bytes();
  }
  b.classicXrefAndTrailer(FONT_DESCRIPTOR_OBJ, "/Root 1 0 R");
  return b.bytes();
}

import {
  EMC,
  EMPTY_DICT,
  enc,
  FixtureBuilder,
  HELVETICA_FONT_DICT,
  PAGE_OBJ,
} from "./pdf";

// A two-page document carrying every document-level surface ReadPdfOptions.surfaces can leave out, each with a trap: one reference to an object number the cross-reference table does not hold (DOCUMENT_SURFACE_TRAP_OBJECTS), reached only by that surface's own reader, so resolving it reports pdf/object-missing-value naming that number exactly when the surface was parsed. The traps sit in the outline's /Next chain, the old-style /Dests dictionary, the AcroForm /Fields array, the /OCGs array, the structure root's /K array and the catalog /OutputIntents (residue). Page 0 also carries what page items take from those surfaces: a structure-owned marked-content span (MCID 0), a span in the "Hidden" layer (off in the default configuration), an internal link naming a name-tree destination, an internal link stating a direct destination array, a URI link, and a /TrimBox for the page-boxes residue row. Page 1 exists so destinations resolve to a real second page.
export const DOCUMENT_SURFACE_TRAP_OBJECTS = {
  outline: 901,
  form: 902,
  layers: 903,
  structure: 904,
  destinations: 905,
  residue: 906,
} as const;
export function documentSurfacesPdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  const PAGE_1_OBJ = 4;
  const SHARED_FONT_OBJ = 5;
  const CONTENT_PAGE_0_OBJ = 6;
  const LINK_NAMED_OBJ = 7;
  const LINK_DIRECT_OBJ = 8;
  const LINK_URI_OBJ = 9;
  const OUTLINES_ROOT_OBJ = 10;
  const OLD_STYLE_DESTS_OBJ = 11;
  const NAME_TREE_OBJ = 12;
  const FIELD_OBJ = 13;
  const OCG_HIDDEN_OBJ = 14;
  const STRUCT_TREE_ROOT_OBJ = 15;
  const STRUCT_PARA_OBJ = 16;
  const CONTENT_PAGE_1_OBJ = 17;
  const OUTLINE_ITEM_OBJ = 18;
  const PARENT_TREE_OBJ = 19;
  b.object(
    1,
    `<< /Type /Catalog /Pages 2 0 R /Outlines ${OUTLINES_ROOT_OBJ} 0 R /Dests ${OLD_STYLE_DESTS_OBJ} 0 R /Names << /Dests ${NAME_TREE_OBJ} 0 R >> /AcroForm << /Fields [${FIELD_OBJ} 0 R ${DOCUMENT_SURFACE_TRAP_OBJECTS.form} 0 R] >> /OCProperties << /OCGs [${OCG_HIDDEN_OBJ} 0 R ${DOCUMENT_SURFACE_TRAP_OBJECTS.layers} 0 R] /D << /OFF [${OCG_HIDDEN_OBJ} 0 R] >> >> /StructTreeRoot ${STRUCT_TREE_ROOT_OBJ} 0 R /PageMode /UseOutlines /OutputIntents [${DOCUMENT_SURFACE_TRAP_OBJECTS.residue} 0 R] >>`,
  );
  b.object(2, `<< /Type /Pages /Kids [3 0 R ${PAGE_1_OBJ} 0 R] /Count 2 >>`);
  b.object(
    PAGE_OBJ,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /TrimBox [10 10 190 190] /Resources << /Font << /F1 ${SHARED_FONT_OBJ} 0 R >> /Properties << /L1 << /OC ${OCG_HIDDEN_OBJ} 0 R >> >> >> /Contents ${CONTENT_PAGE_0_OBJ} 0 R /StructParents 0 /Annots [${LINK_NAMED_OBJ} 0 R ${LINK_DIRECT_OBJ} 0 R ${LINK_URI_OBJ} 0 R] >>`,
  );
  b.object(
    PAGE_1_OBJ,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${SHARED_FONT_OBJ} 0 R >> >> /Contents ${CONTENT_PAGE_1_OBJ} 0 R >>`,
  );
  b.object(SHARED_FONT_OBJ, HELVETICA_FONT_DICT);
  b.stream(
    CONTENT_PAGE_0_OBJ,
    EMPTY_DICT,
    enc(
      [
        "/P << /MCID 0 >> BDC",
        "BT /F1 12 Tf 10 180 Td (Owned paragraph) Tj ET",
        EMC,
        "/OC /L1 BDC",
        "BT /F1 12 Tf 10 150 Td (Hidden layer text) Tj ET",
        EMC,
        "BT /F1 12 Tf 10 120 Td (Plain text) Tj ET",
      ].join("\n"),
    ),
  );
  b.object(
    LINK_NAMED_OBJ,
    "<< /Type /Annot /Subtype /Link /Rect [10 10 60 24] /Dest (second) >>",
  );
  b.object(
    LINK_DIRECT_OBJ,
    `<< /Type /Annot /Subtype /Link /Rect [70 10 120 24] /Dest [${PAGE_1_OBJ} 0 R /Fit] >>`,
  );
  b.object(
    LINK_URI_OBJ,
    "<< /Type /Annot /Subtype /Link /Rect [130 10 180 24] /A << /S /URI /URI (https://example.com/) >> >>",
  );
  b.object(
    OUTLINES_ROOT_OBJ,
    `<< /Type /Outlines /First ${OUTLINE_ITEM_OBJ} 0 R /Last ${OUTLINE_ITEM_OBJ} 0 R /Count 1 >>`,
  );
  b.object(
    OLD_STYLE_DESTS_OBJ,
    `<< /first [3 0 R /Fit] /broken ${DOCUMENT_SURFACE_TRAP_OBJECTS.destinations} 0 R >>`,
  );
  b.object(
    NAME_TREE_OBJ,
    `<< /Names [(second) [${PAGE_1_OBJ} 0 R /XYZ 0 100 null]] >>`,
  );
  b.object(
    FIELD_OBJ,
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (fullname) /V (Jane Doe) /Rect [10 40 110 56] /P 3 0 R >>",
  );
  b.object(OCG_HIDDEN_OBJ, "<< /Type /OCG /Name (Hidden) >>");
  b.object(
    STRUCT_TREE_ROOT_OBJ,
    `<< /Type /StructTreeRoot /K [${STRUCT_PARA_OBJ} 0 R ${DOCUMENT_SURFACE_TRAP_OBJECTS.structure} 0 R] /ParentTree ${PARENT_TREE_OBJ} 0 R >>`,
  );
  b.object(
    STRUCT_PARA_OBJ,
    `<< /Type /StructElem /S /P /P ${STRUCT_TREE_ROOT_OBJ} 0 R /K [0] >>`,
  );
  b.stream(
    CONTENT_PAGE_1_OBJ,
    EMPTY_DICT,
    enc("BT /F1 12 Tf 10 180 Td (Second page) Tj ET"),
  );
  b.object(
    OUTLINE_ITEM_OBJ,
    `<< /Title (Introduction) /Parent ${OUTLINES_ROOT_OBJ} 0 R /Dest (second) /Next ${DOCUMENT_SURFACE_TRAP_OBJECTS.outline} 0 R >>`,
  );
  b.object(PARENT_TREE_OBJ, `<< /Nums [0 [${STRUCT_PARA_OBJ} 0 R]] >>`);
  b.classicXrefAndTrailer(PARENT_TREE_OBJ, "/Root 1 0 R");
  return b.bytes();
}

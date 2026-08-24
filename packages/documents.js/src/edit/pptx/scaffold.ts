import type { LayoutMetadata } from "document-schema.js";
import type { Package, XmlElement, XmlNode } from "ooxml.js";
import { addCoreProperties } from "../../opc/core-properties";
import { ensureContentTypeOverride } from "../../opc/content-types";
import { buildRelativeTarget } from "../../opc/paths";
import { addRelationship } from "../../opc/rels";
import { el } from "../../xml/fragment";

const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const PML_NS =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
export const DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// PowerPoint's default 16:9 widescreen size: 12192000 x 6858000 EMU (960 x 540 pt).
const DEFAULT_SLIDE_WIDTH_EMU = "12192000";
const DEFAULT_SLIDE_HEIGHT_EMU = "6858000";

// PowerPoint's default notes-page size: 6858000 x 9144000 EMU (7.5 x 10 in, US Letter portrait) -- CT_Presentation's own p:notesSz, required alongside p:sldSz even when no slide ever has notes.
const DEFAULT_NOTES_WIDTH_EMU = "6858000";
const DEFAULT_NOTES_HEIGHT_EMU = "9144000";

const SLIDE_MASTER_PART_PATH = "ppt/slideMasters/slideMaster1.xml";
export const SLIDE_LAYOUT_PART_PATH = "ppt/slideLayouts/slideLayout1.xml";
const THEME_PART_PATH = "ppt/theme/theme1.xml";
const PRESENTATION_PART_PATH = "ppt/presentation.xml";
const NOTES_MASTER_PART_PATH = "ppt/notesMasters/notesMaster1.xml";

const SLIDE_MASTER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";
const SLIDE_LAYOUT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const THEME_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.theme+xml";
const NOTES_MASTER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml";

const SLIDE_MASTER_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
export const SLIDE_LAYOUT_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const THEME_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
// Used both from presentation.xml (pointing at the one notesMaster) and from each notesSlideN.xml (CT_NotesSlide's own required relationship to it, mirroring a slide's required relationship to its slideLayout).
export const NOTES_MASTER_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";

// ECMA-376 Part 1, 13.3.9: p:sldMasterId/@id and p:sldLayoutId/@id both draw from a reserved high range starting at 2147483648 (0x80000000), distinct from the 256+ range ordinary slide ids use (see editor.ts's own MIN_SLIDE_ID) -- both are the spec's own minimums, not arbitrary.
const MIN_MASTER_OR_LAYOUT_ID = 2147483648;

function declaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

// A minimal but schema-complete p:spTree (CT_GroupShape): the leading p:nvGrpSpPr + p:grpSpPr pair is mandatory even when the group has no shapes -- omitting it (as this scaffold and editor.ts's own buildEmptySlideRoot used to) produces a part a schema-validating reader rejects outright. Confirmed against real Keynote: it opened in this package's own (non-validating) reader regardless, but Keynote rejected the file. Exported so editor.ts's per-slide p:spTree uses the identical pair rather than a second, drifting copy.
export function buildEmptyGroupSpTree(): XmlElement {
  return el("p:spTree", {}, [
    el("p:nvGrpSpPr", {}, [
      el("p:cNvPr", { id: "1", name: "" }),
      el("p:cNvGrpSpPr"),
      el("p:nvPr"),
    ]),
    el("p:grpSpPr"),
  ]);
}

// a:fillStyleLst/a:lnStyleLst/a:effectStyleLst/a:bgFillStyleLst each carry exactly three entries (subtle/moderate/intense) in every real PowerPoint-authored theme -- matched here rather than guessing a schema-minimum count.
function buildFormatScheme(): XmlElement {
  const solidPhClr = (): XmlElement =>
    el("a:solidFill", {}, [el("a:schemeClr", { val: "phClr" })]);
  return el("a:fmtScheme", { name: "Office" }, [
    el("a:fillStyleLst", {}, [solidPhClr(), solidPhClr(), solidPhClr()]),
    el("a:lnStyleLst", {}, [
      el("a:ln", {}, [solidPhClr()]),
      el("a:ln", {}, [solidPhClr()]),
      el("a:ln", {}, [solidPhClr()]),
    ]),
    el("a:effectStyleLst", {}, [
      el("a:effectStyle", {}, [el("a:effectLst")]),
      el("a:effectStyle", {}, [el("a:effectLst")]),
      el("a:effectStyle", {}, [el("a:effectLst")]),
    ]),
    el("a:bgFillStyleLst", {}, [solidPhClr(), solidPhClr(), solidPhClr()]),
  ]);
}

// The minimal a:theme (CT_OfficeStyleSheet) every slide master must reference: PowerPoint's own default "Office" colour scheme and Calibri Light/Calibri font pair, so a caller who never styles anything still gets a real, schema-complete theme rather than an empty stub.
function buildTheme(): XmlElement {
  const clrScheme = el("a:clrScheme", { name: "Office" }, [
    el("a:dk1", {}, [el("a:sysClr", { val: "windowText", lastClr: "000000" })]),
    el("a:lt1", {}, [el("a:sysClr", { val: "window", lastClr: "FFFFFF" })]),
    el("a:dk2", {}, [el("a:srgbClr", { val: "1F497D" })]),
    el("a:lt2", {}, [el("a:srgbClr", { val: "EEECE1" })]),
    el("a:accent1", {}, [el("a:srgbClr", { val: "4F81BD" })]),
    el("a:accent2", {}, [el("a:srgbClr", { val: "C0504D" })]),
    el("a:accent3", {}, [el("a:srgbClr", { val: "9BBB59" })]),
    el("a:accent4", {}, [el("a:srgbClr", { val: "8064A2" })]),
    el("a:accent5", {}, [el("a:srgbClr", { val: "4BACC6" })]),
    el("a:accent6", {}, [el("a:srgbClr", { val: "F79646" })]),
    el("a:hlink", {}, [el("a:srgbClr", { val: "0000FF" })]),
    el("a:folHlink", {}, [el("a:srgbClr", { val: "800080" })]),
  ]);
  const fontScheme = el("a:fontScheme", { name: "Office" }, [
    el("a:majorFont", {}, [
      el("a:latin", { typeface: "Calibri Light" }),
      el("a:ea", { typeface: "" }),
      el("a:cs", { typeface: "" }),
    ]),
    el("a:minorFont", {}, [
      el("a:latin", { typeface: "Calibri" }),
      el("a:ea", { typeface: "" }),
      el("a:cs", { typeface: "" }),
    ]),
  ]);
  return el("a:theme", { "xmlns:a": DML_NS, name: "Office Theme" }, [
    el("a:themeElements", {}, [clrScheme, fontScheme, buildFormatScheme()]),
  ]);
}

// p:clrMap (CT_ColorMapping): the identity mapping from a slide's logical colour slots (bg1/tx1/...) to the theme's own twelve named slots -- every real slide master carries exactly this, and this package's own pptx reader (via ooxml.js's readColorMap) expects to find it.
function buildIdentityColorMap(): XmlElement {
  return el("p:clrMap", {
    bg1: "lt1",
    tx1: "dk1",
    bg2: "lt2",
    tx2: "dk2",
    accent1: "accent1",
    accent2: "accent2",
    accent3: "accent3",
    accent4: "accent4",
    accent5: "accent5",
    accent6: "accent6",
    hlink: "hlink",
    folHlink: "folHlink",
  });
}

// An explicit solid-white p:bg (CT_BackgroundProperties): p:bg must precede p:spTree within p:cSld (CT_CommonSlideData's own element order). Without an explicit background, a slide/layout/master has none at all to inherit -- confirmed against real Keynote, which rendered the background solid black rather than falling back to anything resembling white when this was left unset.
function buildWhiteBackground(): XmlElement {
  return el("p:bg", {}, [
    el("p:bgPr", {}, [
      el("a:solidFill", {}, [el("a:srgbClr", { val: "FFFFFF" })]),
      el("a:effectLst"),
    ]),
  ]);
}

// The minimal p:sldMaster (CT_SlideMaster): an explicit white background, an empty shape tree, the identity colour map, and a single-entry p:sldLayoutIdLst pointing at the one blank layout this scaffold creates. layoutRelationshipId is the master's own relationship (in slideMaster1.xml.rels) to that layout, allocated by the caller before this element is built.
function buildSlideMaster(layoutRelationshipId: string): XmlElement {
  return el(
    "p:sldMaster",
    { "xmlns:p": PML_NS, "xmlns:a": DML_NS, "xmlns:r": R_NS },
    [
      el("p:cSld", {}, [buildWhiteBackground(), buildEmptyGroupSpTree()]),
      buildIdentityColorMap(),
      el("p:sldLayoutIdLst", {}, [
        el("p:sldLayoutId", {
          id: String(MIN_MASTER_OR_LAYOUT_ID),
          "r:id": layoutRelationshipId,
        }),
      ]),
    ],
  );
}

// The minimal p:sldLayout (CT_SlideLayout): type="blank" (ECMA-376's own designation for a layout with no placeholders), an empty shape tree, and p:clrMapOvr deferring entirely to the master's own colour map (a:masterClrMapping) -- CT_SlideLayout requires clrMapOvr to be present even when there is nothing to override.
function buildSlideLayout(): XmlElement {
  return el(
    "p:sldLayout",
    {
      "xmlns:p": PML_NS,
      "xmlns:a": DML_NS,
      "xmlns:r": R_NS,
      type: "blank",
      preserve: "1",
    },
    [
      el("p:cSld", { name: "Blank" }, [buildEmptyGroupSpTree()]),
      el("p:clrMapOvr", {}, [el("a:masterClrMapping")]),
    ],
  );
}

// The minimal p:notesMaster (CT_NotesMaster): an explicit white background, an empty shape tree, and the identity colour map -- CT_NotesSlide requires every notesSlide to relate to exactly this kind of part (mirroring a slide's own required relationship to a slideLayout), so a notesSlide created without one is rejected by a real reader even though this package's own reader has no such requirement.
function buildNotesMaster(): XmlElement {
  return el("p:notesMaster", { "xmlns:p": PML_NS, "xmlns:a": DML_NS }, [
    el("p:cSld", {}, [buildWhiteBackground(), buildEmptyGroupSpTree()]),
    buildIdentityColorMap(),
  ]);
}

// Lazily creates the single ppt/notesMasters/notesMaster1.xml part and wires it into presentation.xml's own p:notesMasterIdLst, the first time any slide's notes are set -- most presentations never use speaker notes, so this isn't part of createEmptyPptxPackage's own upfront scaffold. Idempotent: a second call is a no-op and returns the same part path. The caller (PptxSlide's notes setter) still has to add the specific notesSlideN.xml's own relationship to the returned path -- CT_NotesSlide's chain is per-notes-slide, the same way each ordinary slide relates individually to the one shared slideLayout.
export function ensureNotesMaster(pkg: Package): string {
  if (pkg.parts[NOTES_MASTER_PART_PATH] !== undefined) {
    return NOTES_MASTER_PART_PATH;
  }

  const masterToThemeTarget = buildRelativeTarget(
    NOTES_MASTER_PART_PATH,
    THEME_PART_PATH,
  );
  addRelationship(pkg, NOTES_MASTER_PART_PATH, {
    type: THEME_REL_TYPE,
    target: masterToThemeTarget,
  });
  pkg.parts[NOTES_MASTER_PART_PATH] = {
    kind: "xml",
    nodes: [declaration(), buildNotesMaster()],
  };
  ensureContentTypeOverride(
    pkg,
    NOTES_MASTER_PART_PATH,
    NOTES_MASTER_CONTENT_TYPE,
  );

  const presentationToNotesMasterTarget = buildRelativeTarget(
    PRESENTATION_PART_PATH,
    NOTES_MASTER_PART_PATH,
  );
  const relId = addRelationship(pkg, PRESENTATION_PART_PATH, {
    type: NOTES_MASTER_REL_TYPE,
    target: presentationToNotesMasterTarget,
  });

  const presentationPart = pkg.parts[PRESENTATION_PART_PATH];
  const presentationElement =
    presentationPart?.kind === "xml"
      ? presentationPart.nodes.find(
          (n): n is XmlElement => n.type === "element",
        )
      : undefined;
  if (presentationElement === undefined) {
    throw new Error(
      "ensureNotesMaster: package has no ppt/presentation.xml element",
    );
  }
  // p:notesMasterIdLst must directly follow p:sldMasterIdLst in CT_Presentation's own element sequence -- inserted here rather than appended, since this runs after createEmptyPptxPackage already built sldMasterIdLst/sldIdLst/sldSz in their own required order.
  const sldMasterIdLstIndex = presentationElement.children.findIndex(
    (c) => c.type === "element" && c.tag === "p:sldMasterIdLst",
  );
  const notesMasterIdLst = el("p:notesMasterIdLst", {}, [
    el("p:notesMasterId", { "r:id": relId }),
  ]);
  presentationElement.children.splice(
    sldMasterIdLstIndex === -1 ? 0 : sldMasterIdLstIndex + 1,
    0,
    notesMasterIdLst,
  );

  return NOTES_MASTER_PART_PATH;
}

export interface CreateEmptyPptxPackageOptions {
  readonly metadata?: LayoutMetadata;
}

// Builds a minimal but genuinely valid, openable pptx package from nothing: [Content_Types].xml, the root relationship to ppt/presentation.xml, a widescreen presentation with an empty p:sldIdLst, and the slideMaster -> slideLayout -> theme chain ECMA-376 requires every presentation to have. (An earlier, chain-free version of this scaffold opened fine in this package's own reader, which tolerates a missing chain by design, but Keynote rejected it outright -- confirmed by testing.) A caller passing no options gets byte-for-byte the same package as before docProps/core.xml support existed -- options.metadata is purely additive, mirroring createEmptyDocxPackage's own identical convention (src/edit/docx/scaffold.ts).
export function createEmptyPptxPackage(
  options?: CreateEmptyPptxPackageOptions,
): Package {
  const contentTypes = el("Types", { xmlns: CONTENT_TYPES_NS }, [
    el("Default", {
      Extension: "rels",
      ContentType: "application/vnd.openxmlformats-package.relationships+xml",
    }),
    el("Default", { Extension: "xml", ContentType: "application/xml" }),
    el("Override", {
      PartName: `/${PRESENTATION_PART_PATH}`,
      ContentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    }),
  ]);

  const rootRels = el("Relationships", { xmlns: RELS_NS }, [
    el("Relationship", {
      Id: "rId1",
      Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
      Target: PRESENTATION_PART_PATH,
    }),
  ]);

  const pkg: Package = {
    parts: {
      "[Content_Types].xml": {
        kind: "xml",
        nodes: [declaration(), contentTypes],
      },
      "_rels/.rels": { kind: "xml", nodes: [declaration(), rootRels] },
      [PRESENTATION_PART_PATH]: {
        kind: "xml",
        nodes: [
          declaration(),
          el("p:presentation", { "xmlns:p": PML_NS, "xmlns:r": R_NS }),
        ],
      },
    },
  };

  const layoutToMasterTarget = buildRelativeTarget(
    SLIDE_LAYOUT_PART_PATH,
    SLIDE_MASTER_PART_PATH,
  );
  addRelationship(pkg, SLIDE_LAYOUT_PART_PATH, {
    type: SLIDE_MASTER_REL_TYPE,
    target: layoutToMasterTarget,
  });
  pkg.parts[SLIDE_LAYOUT_PART_PATH] = {
    kind: "xml",
    nodes: [declaration(), buildSlideLayout()],
  };
  ensureContentTypeOverride(
    pkg,
    SLIDE_LAYOUT_PART_PATH,
    SLIDE_LAYOUT_CONTENT_TYPE,
  );

  const masterToLayoutTarget = buildRelativeTarget(
    SLIDE_MASTER_PART_PATH,
    SLIDE_LAYOUT_PART_PATH,
  );
  const masterToLayoutRelId = addRelationship(pkg, SLIDE_MASTER_PART_PATH, {
    type: SLIDE_LAYOUT_REL_TYPE,
    target: masterToLayoutTarget,
  });
  const masterToThemeTarget = buildRelativeTarget(
    SLIDE_MASTER_PART_PATH,
    THEME_PART_PATH,
  );
  addRelationship(pkg, SLIDE_MASTER_PART_PATH, {
    type: THEME_REL_TYPE,
    target: masterToThemeTarget,
  });
  pkg.parts[SLIDE_MASTER_PART_PATH] = {
    kind: "xml",
    nodes: [declaration(), buildSlideMaster(masterToLayoutRelId)],
  };
  ensureContentTypeOverride(
    pkg,
    SLIDE_MASTER_PART_PATH,
    SLIDE_MASTER_CONTENT_TYPE,
  );

  pkg.parts[THEME_PART_PATH] = {
    kind: "xml",
    nodes: [declaration(), buildTheme()],
  };
  ensureContentTypeOverride(pkg, THEME_PART_PATH, THEME_CONTENT_TYPE);

  const presentationToMasterTarget = buildRelativeTarget(
    PRESENTATION_PART_PATH,
    SLIDE_MASTER_PART_PATH,
  );
  const presentationToMasterRelId = addRelationship(
    pkg,
    PRESENTATION_PART_PATH,
    { type: SLIDE_MASTER_REL_TYPE, target: presentationToMasterTarget },
  );

  // p:sldMasterIdLst must precede p:sldIdLst in CT_Presentation's own element sequence (ECMA-376 Part 1, 13.2.4.1).
  const presentationPart = pkg.parts[PRESENTATION_PART_PATH];
  const presentationElement =
    presentationPart?.kind === "xml"
      ? presentationPart.nodes.find(
          (n): n is XmlElement => n.type === "element",
        )
      : undefined;
  if (presentationElement === undefined) {
    throw new Error(
      "createEmptyPptxPackage: failed to build ppt/presentation.xml",
    );
  }
  presentationElement.children.push(
    el("p:sldMasterIdLst", {}, [
      el("p:sldMasterId", {
        id: String(MIN_MASTER_OR_LAYOUT_ID),
        "r:id": presentationToMasterRelId,
      }),
    ]),
    el("p:sldIdLst"),
    el("p:sldSz", {
      cx: DEFAULT_SLIDE_WIDTH_EMU,
      cy: DEFAULT_SLIDE_HEIGHT_EMU,
    }),
    el("p:notesSz", {
      cx: DEFAULT_NOTES_WIDTH_EMU,
      cy: DEFAULT_NOTES_HEIGHT_EMU,
    }),
  );

  if (options?.metadata !== undefined) {
    addCoreProperties(pkg, options.metadata);
  }

  return pkg;
}

import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentConstructStart,
  ContentImageBlock,
  ContentParagraph,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { POINTS_PER_INCH } from "../shared/units";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";
const HYPERLINK_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const THEME_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const PICTURE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";

// A genuine, minimal 1x1 transparent PNG — real magic bytes, so sniffImageFormat actually recognises it, not a placeholder string.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// wp:inline and wp:anchor share the identical wp:extent/wp:docPr/a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip shape — only the outer container tag differs (and, for wp:anchor, the wp:positionH/wp:positionV elements this fixture doesn't set — see the dedicated "wp:anchor floating image position" describe block below for those).
function drawingElement(
  containerTag: "wp:inline" | "wp:anchor",
  rId: string,
  altText: string,
  extent: Readonly<{ cx: string; cy: string }> = { cx: "914400", cy: "457200" },
): XmlElement {
  return el("w:drawing", {}, [
    el(containerTag, {}, [
      el("wp:extent", extent), // default 1in x 0.5in -> 72pt x 36pt
      el("wp:docPr", { id: "1", name: "Picture 1", descr: altText }),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
          el("pic:pic", {}, [
            el("pic:blipFill", {}, [el("a:blip", { "r:embed": rId })]),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function rels(
  entries: readonly {
    id: string;
    type: string;
    target: string;
    external?: boolean;
  }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el(
        "Relationship",
        e.external === true
          ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: "External" }
          : { Id: e.id, Type: e.type, Target: e.target },
      ),
    ),
  );
}

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

// The two construct-boundary markers have no sourcePath field at all (a boundary is not content), so reading one off an unnarrowed ContentBlock no longer type-checks — this narrows past them for the assertions below, which only ever look at real content blocks.
function sourcePathOf(block: ContentBlock | undefined): string | undefined {
  if (
    block === undefined ||
    block.kind === "constructStart" ||
    block.kind === "constructEnd"
  ) {
    return undefined;
  }
  return block.sourcePath;
}

function asConstructStart(
  block: ContentBlock | undefined,
): ContentConstructStart {
  if (block?.kind !== "constructStart") {
    throw new Error("expected a constructStart marker");
  }
  return block;
}

function buildFixturePackage(): Package {
  const docDefaultsRPr = el("w:rPr", {}, [el("w:sz", { "w:val": "20" })]);
  const normalStyle = el(
    "w:style",
    { "w:type": "paragraph", "w:styleId": "Normal", "w:default": "1" },
    [el("w:rPr", {}, [el("w:rFonts", { "w:asciiTheme": "minorHAnsi" })])],
  );
  const heading1Style = el(
    "w:style",
    { "w:type": "paragraph", "w:styleId": "Heading1" },
    [
      el("w:basedOn", { "w:val": "Normal" }),
      el("w:rPr", {}, [el("w:b"), el("w:sz", { "w:val": "36" })]),
    ],
  );
  const styles = el("w:styles", {}, [
    el("w:docDefaults", {}, [el("w:rPrDefault", {}, [docDefaultsRPr])]),
    normalStyle,
    heading1Style,
  ]);

  const titlePara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:pStyle", { "w:val": "Heading1" })]),
    el("w:r", {}, [el("w:t", {}, [txt("Title")])]),
  ]);

  const pageBreakPara = el("w:p", {}, [
    el("w:pPr", {}, [el("w:pageBreakBefore")]),
    el("w:r", {}, [el("w:t", {}, [txt("After a page break")])]),
  ]);

  const hyperlinkPara = el("w:p", {}, [
    el("w:hyperlink", { "r:id": "rIdHlink" }, [
      el("w:r", {}, [el("w:t", {}, [txt("link text")])]),
    ]),
  ]);

  const fieldPara = el("w:p", {}, [
    el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
    el("w:r", {}, [el("w:instrText", {}, [txt(" PAGE ")])]),
    el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
    el("w:r", {}, [el("w:t", {}, [txt("1")])]),
    el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
  ]);

  const insertedPara = el("w:ins", { "w:id": "1" }, [
    el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Inserted")])])]),
  ]);
  const deletedPara = el("w:del", { "w:id": "2" }, [
    el("w:p", {}, [el("w:r", {}, [el("w:delText", {}, [txt("Deleted")])])]),
  ]);

  const sdtPara = el("w:sdt", {}, [
    el("w:sdtContent", {}, [
      el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Content control")])])]),
    ]),
  ]);

  const altContent = el("mc:AlternateContent", {}, [
    el("mc:Choice", { Requires: "wps" }, [
      el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Choice")])])]),
    ]),
    el("mc:Fallback", {}, [
      el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Fallback")])])]),
    ]),
  ]);

  const listPara = el("w:p", {}, [
    el("w:pPr", {}, [
      el("w:numPr", {}, [
        el("w:ilvl", { "w:val": "1" }),
        el("w:numId", { "w:val": "5" }),
      ]),
    ]),
    el("w:r", {}, [el("w:t", {}, [txt("List item")])]),
  ]);

  const tabBreakPara = el("w:p", {}, [
    el("w:r", {}, [
      el("w:t", {}, [txt("a")]),
      el("w:tab"),
      el("w:t", {}, [txt("b")]),
      el("w:br"),
      el("w:t", {}, [txt("c")]),
    ]),
  ]);

  const mergedCellBorders = el("w:tcBorders", {}, [
    el("w:top", { "w:val": "single", "w:sz": "8", "w:color": "00FF00" }),
    el("w:left", { "w:val": "nil" }),
    el("w:bottom", { "w:val": "dashed", "w:color": "auto" }),
  ]);
  const mergedCell = el("w:tc", {}, [
    el("w:tcPr", {}, [
      el("w:gridSpan", { "w:val": "2" }),
      el("w:shd", { "w:fill": "FF0000" }),
      mergedCellBorders,
    ]),
    el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Merged")])])]),
  ]);
  const vMergeAnchor = el("w:tc", {}, [
    el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
    el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Top")])])]),
  ]);
  const vMergeContinuation1 = el("w:tc", {}, [
    el("w:tcPr", {}, [el("w:vMerge")]),
    el("w:p"),
  ]);
  const vMergeContinuation2 = el("w:tc", {}, [
    el("w:tcPr", {}, [el("w:vMerge")]),
    el("w:p"),
  ]);
  const table = el("w:tbl", {}, [
    el("w:tblGrid", {}, [
      el("w:gridCol", { "w:w": "2880" }),
      el("w:gridCol", { "w:w": "2880" }),
    ]),
    el("w:tr", {}, [mergedCell]),
    el("w:tr", {}, [
      vMergeAnchor,
      el("w:tc", {}, [
        el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Right1")])])]),
      ]),
    ]),
    el("w:tr", {}, [
      vMergeContinuation1,
      el("w:tc", {}, [
        el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Right2")])])]),
      ]),
    ]),
    el("w:tr", {}, [
      vMergeContinuation2,
      el("w:tc", {}, [
        el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("Right3")])])]),
      ]),
    ]),
  ]);

  const sectionBreakPara = el("w:p", {}, [
    el("w:pPr", {}, [
      el("w:sectPr", {}, [
        el("w:type", { "w:val": "continuous" }),
        el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
        el("w:pgMar", {
          "w:top": "1440",
          "w:right": "1440",
          "w:bottom": "1440",
          "w:left": "1440",
        }),
      ]),
    ]),
  ]);
  const secondSectionPara = el("w:p", {}, [
    el("w:r", {}, [el("w:t", {}, [txt("Second section")])]),
  ]);
  const inlineImagePara = el("w:p", {}, [
    el("w:r", {}, [
      drawingElement("wp:inline", "rIdInlineImage", "Inline alt text"),
    ]),
  ]);
  const floatingImagePara = el("w:p", {}, [
    el("w:r", {}, [
      drawingElement("wp:anchor", "rIdFloatingImage", "Floating alt text"),
    ]),
  ]);
  const finalSectPr = el("w:sectPr", {}, [
    el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
    el("w:pgMar", {
      "w:top": "720",
      "w:right": "720",
      "w:bottom": "720",
      "w:left": "720",
    }),
  ]);

  const body = el("w:body", {}, [
    titlePara,
    pageBreakPara,
    hyperlinkPara,
    fieldPara,
    insertedPara,
    deletedPara,
    sdtPara,
    altContent,
    listPara,
    tabBreakPara,
    table,
    sectionBreakPara,
    secondSectionPara,
    inlineImagePara,
    floatingImagePara,
    finalSectPr,
  ]);
  const document = el("w:document", {}, [body]);

  const theme = el("a:theme", {}, [
    el("a:themeElements", {}, [
      el("a:fontScheme", {}, [
        el("a:majorFont", {}, [el("a:latin", { typeface: "Major Font" })]),
        el("a:minorFont", {}, [el("a:latin", { typeface: "Minor Font" })]),
      ]),
    ]),
  ]);

  const documentRels = rels([
    {
      id: "rIdHlink",
      type: HYPERLINK_REL,
      target: "https://example.com",
      external: true,
    },
    { id: "rIdTheme", type: THEME_REL, target: "theme/theme1.xml" },
    { id: "rIdInlineImage", type: IMAGE_REL, target: "media/image1.png" },
    { id: "rIdFloatingImage", type: IMAGE_REL, target: "media/image2.png" },
  ]);

  const core = el("cp:coreProperties", {}, [
    el("dc:title", {}, [txt("Fixture Document")]),
  ]);

  const numbering = el("w:numbering", {}, [
    el("w:abstractNum", { "w:abstractNumId": "0" }, [
      el("w:lvl", { "w:ilvl": "0" }, [
        el("w:start", { "w:val": "1" }),
        el("w:numFmt", { "w:val": "decimal" }),
        el("w:lvlText", { "w:val": "%1." }),
      ]),
      el("w:lvl", { "w:ilvl": "1" }, [
        el("w:start", { "w:val": "1" }),
        el("w:numFmt", { "w:val": "lowerRoman" }),
        el("w:lvlText", { "w:val": "%2)" }),
      ]),
    ]),
    el("w:num", { "w:numId": "5" }, [el("w:abstractNumId", { "w:val": "0" })]),
  ]);

  return {
    parts: {
      "word/document.xml": { kind: "xml", nodes: [document] },
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [documentRels] },
      "word/styles.xml": { kind: "xml", nodes: [styles] },
      "word/theme/theme1.xml": { kind: "xml", nodes: [theme] },
      "word/numbering.xml": { kind: "xml", nodes: [numbering] },
      "docProps/core.xml": { kind: "xml", nodes: [core] },
      "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      "word/media/image2.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    },
  };
}

function paragraphPackage(
  paragraph: XmlElement,
  extraParts: Package["parts"] = {},
): Package {
  const body = el("w:body", {}, [
    paragraph,
    el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [rels([])] },
      ...extraParts,
    },
  };
}

function textRun(text: string): XmlElement {
  return el("w:r", {}, [el("w:t", { "xml:space": "preserve" }, [txt(text)])]);
}

function firstParagraph(
  doc: ReturnType<typeof readDocxContent>,
): ContentParagraph {
  return asParagraph(doc.sections[0]?.blocks[0]);
}

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== "image") {
    throw new Error("expected an image block");
  }
  return block;
}

describe("readDocxContent: legacy w:ffData form fields", () => {
  function formFieldPackage(
    ffData: XmlElement,
    instruction: string,
    result: string,
  ): Package {
    const paragraph = el("w:p", {}, [
      textRun("Answer: "),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" }), ffData]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(instruction)]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      textRun(result),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    return paragraphPackage(paragraph);
  }

  it("reads a checkbox form field as a contentControl run extent carrying its checked state, with the ffData quarantined verbatim in the residue", () => {
    const ffData = el("w:ffData", {}, [
      el("w:name", { "w:val": "consentBox" }),
      el("w:checkBox", {}, [
        el("w:default", { "w:val": "0" }),
        el("w:checked", { "w:val": "1" }),
      ]),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMCHECKBOX ", "Yes")),
    );
    // The form field is ONE construct — a contentControl — never a field construct beside it: the FORMCHECKBOX instruction is mechanically derivable from the control type, so emitting both would encode one occurrence twice.
    expect(paragraphRead.constructs).toEqual([
      {
        descriptor: {
          kind: "contentControl",
          controlType: "checkbox",
          tag: "consentBox",
          checked: true,
          source: {
            format: "docx",
            xml: '<w:ffData><w:name w:val="consentBox"></w:name><w:checkBox><w:default w:val="0"></w:default><w:checked w:val="1"></w:checked></w:checkBox></w:ffData>',
          },
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
    expect(paragraphRead.runs.map((run) => run.text)).toEqual([
      "Answer: ",
      "Yes",
    ]);
  });

  it("reads a drop-down form field as a contentControl carrying its list options", () => {
    const ffData = el("w:ffData", {}, [
      el("w:ddList", {}, [
        el("w:listItem", { "w:val": "red" }),
        el("w:listItem", { "w:displayText": "Green", "w:val": "green" }),
      ]),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMDROPDOWN ", "green")),
    );
    expect(paragraphRead.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["red", "Green"],
      source: {
        format: "docx",
        xml: '<w:ffData><w:ddList><w:listItem w:val="red"></w:listItem><w:listItem w:displayText="Green" w:val="green"></w:listItem></w:ddList></w:ffData>',
      },
    });
  });

  it("reads a drop-down form field with no listItem entries as options: [], not an absent options field", () => {
    const ffData = el("w:ffData", {}, [el("w:ddList", {}, [])]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMDROPDOWN ", "")),
    );
    expect(paragraphRead.constructs?.[0]?.descriptor).toMatchObject({
      kind: "contentControl",
      controlType: "dropDown",
      options: [],
    });
  });

  it("reads a text-input form field as a plainText contentControl", () => {
    const ffData = el("w:ffData", {}, [
      el("w:textInput", {}, [el("w:default", { "w:val": "typed" })]),
    ]);
    const paragraphRead = firstParagraph(
      readDocxContent(formFieldPackage(ffData, " FORMTEXT ", "typed")),
    );
    expect(paragraphRead.constructs?.[0]?.descriptor).toMatchObject({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  it("reads a whole-paragraph form field as a block-scoped contentControl marker pair, not a run extent", () => {
    const ffData = el("w:ffData", {}, [
      el("w:checkBox", {}, [el("w:default", { "w:val": "1" })]),
    ]);
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" }), ffData]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" FORMCHECKBOX ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      textRun("Yes"),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(
      asConstructStart(doc.sections[0]?.blocks[0]).descriptor,
    ).toMatchObject({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
    });
    expect(asParagraph(doc.sections[0]?.blocks[1]).constructs).toBeUndefined();
  });
});

describe("readDocxContent: images", () => {
  it("reads an inline (wp:inline) w:drawing as a real ContentImageBlock, sized from wp:extent EMU converted to points", () => {
    const doc = readDocxContent(buildFixturePackage());
    // section 1 blocks: [0] secondSectionPara, [1] inlineImagePara (empty text), [2] its image, [3] floatingImagePara, [4] its image.
    const image = asImage(doc.sections[1]?.blocks[2]);
    expect(image.format).toBe("png");
    // 914400 EMU is exactly 1 inch.
    expect(image.widthPt).toBe(POINTS_PER_INCH);
    // 457200 EMU is exactly half an inch, half of POINTS_PER_INCH.
    const HALF_INCH_IMAGE_HEIGHT_PT = 36;
    expect(image.heightPt).toBe(HALF_INCH_IMAGE_HEIGHT_PT);
    expect(image.altText).toBe("Inline alt text");
    expect(image.base64).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    );
  });

  it("reads a floating/anchored (wp:anchor) w:drawing as a real ContentImageBlock too, still placed in block flow at the point the w:drawing was encountered (floatPosition records the source's own anchored position separately — see the dedicated describe block below; this fixture's own wp:anchor carries neither wp:positionH nor wp:positionV, so floatPosition stays absent here)", () => {
    const doc = readDocxContent(buildFixturePackage());
    const image = asImage(doc.sections[1]?.blocks[4]);
    expect(image.format).toBe("png");
    expect(image.altText).toBe("Floating alt text");
    expect(image.floatPosition).toBeUndefined();
  });

  it("assigns the image its own sourcePath alongside its containing paragraph", () => {
    const doc = readDocxContent(buildFixturePackage());
    expect(sourcePathOf(doc.sections[1]?.blocks[2])).toBe(
      "sections[1].blocks[2]",
    );
  });
});

describe("readDocxContent: lifted-image anchors (anchorRunIndex/anchorOffset)", () => {
  function imageParts(): Package["parts"] {
    return {
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          rels([{ id: "rIdImg", type: IMAGE_REL, target: "media/image1.png" }]),
        ],
      },
      "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    };
  }

  function imageRun(): XmlElement {
    return el("w:r", {}, [
      drawingElement("wp:inline", "rIdImg", "Anchored alt text"),
    ]);
  }

  it("anchors an image in its own run to the previous run at that run's full length", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("Hello ")])]),
      imageRun(),
      el("w:r", {}, [el("w:t", {}, [txt("World")])]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, imageParts()));
    // The image sits between two runs: anchor names the run whose text it followed (index 0, "Hello ") and the position after that run's whole text.
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    // "Hello " (including its trailing space) is 6 characters.
    const ANCHOR_OFFSET_AFTER_HELLO_SPACE = 6;
    expect(image.anchorOffset).toBe(ANCHOR_OFFSET_AFTER_HELLO_SPACE);
  });

  it("anchors an image at the paragraph's very start to (0, 0)", () => {
    const paragraph = el("w:p", {}, [
      imageRun(),
      el("w:r", {}, [el("w:t", {}, [txt("Trailing text")])]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph, imageParts()));
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    expect(image.anchorOffset).toBe(0);
  });

  it("anchors an image sharing a run with text to that run at the length of the text preceding it", () => {
    const sharedRun = el("w:r", {}, [
      el("w:t", {}, [txt("foo")]),
      drawingElement("wp:inline", "rIdImg", "Mid-run alt text"),
      el("w:t", {}, [txt("bar")]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(el("w:p", {}, [sharedRun]), imageParts()),
    );
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    // "foo" is 3 characters.
    const ANCHOR_OFFSET_AFTER_FOO = 3;
    expect(image.anchorOffset).toBe(ANCHOR_OFFSET_AFTER_FOO);
  });

  it("anchors an image inside a hyperlink through the run the walk emitted for it", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("See ")])]),
      el("w:hyperlink", { "r:id": "rIdLink" }, [
        el("w:r", {}, [el("w:t", {}, [txt("the proof")])]),
        imageRun(),
      ]),
    ]);
    const parts = imageParts();
    const relsPart = parts["word/_rels/document.xml.rels"];
    if (relsPart?.kind !== "xml") {
      throw new Error("expected document rels");
    }
    relsPart.nodes = [
      rels([
        { id: "rIdImg", type: IMAGE_REL, target: "media/image1.png" },
        {
          id: "rIdLink",
          type: HYPERLINK_REL,
          target: "https://example.invalid/",
          external: true,
        },
      ]),
    ];
    const doc = readDocxContent(paragraphPackage(paragraph, parts));
    // Runs as walked: [0] "See ", [1] "the proof" (hyperlink-wrapped), [2] the image's own empty run — the anchor names run 1 at its full length.
    const image = asImage(doc.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(1);
    // "the proof" is 9 characters.
    const ANCHOR_OFFSET_AT_HYPERLINK_RUN_END = 9;
    expect(image.anchorOffset).toBe(ANCHOR_OFFSET_AT_HYPERLINK_RUN_END);
  });

  it("round-trips an end-of-paragraph image's anchor through buildDocxPackageFromContent", () => {
    // The writer re-inlines a lifted image as the last run of its containing paragraph, so an image that already sat at the paragraph's end keeps its anchor through a round trip: (last run, that run's full length) is exactly where the written run lands.
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("Signed: ")])]),
      imageRun(),
    ]);
    const before = readDocxContent(paragraphPackage(paragraph, imageParts()));
    const after = readDocxContent(buildDocxPackageFromContent(before));
    const image = asImage(after.sections[0]?.blocks[1]);
    expect(image.anchorRunIndex).toBe(0);
    // "Signed: " (including its trailing space) is 8 characters.
    const ANCHOR_OFFSET_AFTER_SIGNED_COLON_SPACE = 8;
    expect(image.anchorOffset).toBe(ANCHOR_OFFSET_AFTER_SIGNED_COLON_SPACE);
  });
});

// An inline OLE object's real-world spelling: a w:r carries a w:object whose w:dxaOrig/w:dyaOrig (twips) size it, whose v:shape > v:imagedata names the raster preview picture rendered in its place (a VML spelling this reader has no path for, so the preview contributes no image block), and whose o:OLEObject names the payload part through its own relationship. The payload relationship is parameterised so a test can point rIdOle at whatever part shape it needs (the ZIP-payload case targets the default embeddings/oleObject1.xlsx; the classic-OLE case retargets to a .bin; the linked case goes external) — the fixture itself ships no embeddings part, so each test adds exactly the payload bytes it wants. extraRuns splices additional runs after the object run inside the same paragraph.

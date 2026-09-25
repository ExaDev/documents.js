import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import type { ContentParagraph } from "document-schema.js";
import { readOdt, readOdtContent } from "./read";

// DefinitionEntry's body is deliberately tenant-open (document-schema.js's definitions.ts), so a test reading an entry's body as block content narrows it itself rather than asserting.
function entryParagraphs(
  key: string,
  definitions: ReturnType<typeof readOdtContent>["definitions"],
): ContentParagraph[] {
  const body = definitions?.[key]?.body;
  if (
    !Array.isArray(body) ||
    !body.every(
      (block: unknown): block is ContentParagraph =>
        typeof block === "object" &&
        block !== null &&
        "kind" in block &&
        "runs" in block &&
        block.kind === "paragraph",
    )
  ) {
    throw new Error(`expected a paragraph-only definitions body for ${key}`);
  }
  return body;
}

// The block-scope construct rows of the fidelity vocabulary (ExaDev/documents.js#719): text:section as a division, the TOC/index wrappers as index content controls, tracked changes as provenance, and the definitions-table tenants. Every fixture here is a programmatic package built with el/txt — the fixture gate the issue itself states: real-producer verification for these constructs is outstanding, and the shapes below follow the OASIS ODF 1.2 element/attribute grammar rather than any single producer's output.

function odtPackage(
  textChildren: readonly XmlElement[],
  automaticStyles: readonly XmlElement[] = [],
): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:automatic-styles", {}, automaticStyles),
            el("office:body", {}, [el("office:text", {}, textChildren)]),
          ]),
        ],
      },
    },
  };
}

function paragraph(text: string): XmlElement {
  return el("text:p", {}, [txt(text)]);
}

function firstSectionBlocks(pkg: Package) {
  const { sections } = readOdtContent(pkg);
  const section = sections[0];
  if (section === undefined) {
    throw new Error("expected at least one section");
  }
  return section.blocks;
}

describe("readOdtContent: office:forms in an ordinary text document", () => {
  it("reads the form tree as a pre-order sequence of point contentControl constructs, control kinds mapped from their form: tags and names as tags", () => {
    const pkg = odtPackage([
      paragraph("Text around the form."),
      el("office:forms", {}, [
        el(
          "form:form",
          {
            "form:name": "MainForm",
            "form:command": '"customers"',
            "form:command-type": "table",
          },
          [
            el("form:properties", {}, [
              el("form:property", {
                "form:property-name": "ObjIDinMSO",
                "office:value": "1",
              }),
            ]),
            el("form:text", {
              "form:name": "firstName",
              "form:data-field": "first_name",
              "form:current-value": "Ada",
            }),
            el("form:checkbox", {
              "form:name": "active",
              "form:current-state": "checked",
            }),
            el("form:listbox", { "form:name": "tier" }),
            el("form:unknown-kind", { "form:name": "mystery" }),
          ],
        ),
      ]),
      paragraph("Text after the form."),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "constructEnd",
      "constructStart",
      "constructEnd",
      "constructStart",
      "constructEnd",
      "constructStart",
      "constructEnd",
      "constructStart",
      "constructEnd",
      "paragraph",
    ]);
    const descriptors = blocks
      .filter((block) => block.kind === "constructStart")
      .map((block) => block.descriptor);
    expect(descriptors[0]).toMatchObject({
      kind: "contentControl",
      controlType: "group",
      tag: "MainForm",
    });
    expect(descriptors[1]).toMatchObject({
      kind: "contentControl",
      controlType: "plainText",
      tag: "firstName",
      value: "Ada",
    });
    expect(descriptors[2]).toMatchObject({
      kind: "contentControl",
      controlType: "checkbox",
      tag: "active",
      checked: true,
    });
    expect(descriptors[3]).toMatchObject({
      kind: "contentControl",
      controlType: "dropDown",
      tag: "tier",
    });
    expect(descriptors[4]).toMatchObject({
      kind: "contentControl",
      controlType: "richText",
      tag: "mystery",
    });
    // The form:properties bag quarantines into residue, and an unrecognised control kind quarantines its whole element.
    expect(descriptors[0]?.source).toMatchObject({ format: "odt" });
    expect(descriptors[4]?.source).toMatchObject({ format: "odt" });
    expect(descriptors[1]?.source).toBeUndefined();
  });

  it("reads a form:listbox's own form:option children as the descriptor's options, and an empty listbox as options: []", () => {
    const pkg = odtPackage([
      el("office:forms", {}, [
        el("form:form", { "form:name": "MainForm" }, [
          el("form:listbox", { "form:name": "tier" }, [
            el("form:option", { "form:label": "Bronze", "form:value": "1" }),
            el("form:option", { "form:label": "Silver", "form:value": "2" }),
            // No form:label at all — falls back to form:value, matching ooxml.js's own displayText-then-value convention for the identical docx w:listItem concept.
            el("form:option", { "form:value": "3" }),
          ]),
          el("form:listbox", { "form:name": "empty" }),
        ]),
      ]),
    ]);
    const descriptors = firstSectionBlocks(pkg)
      .filter((block) => block.kind === "constructStart")
      .map((block) => block.descriptor);
    expect(descriptors[1]).toMatchObject({
      kind: "contentControl",
      controlType: "dropDown",
      tag: "tier",
      options: ["Bronze", "Silver", "3"],
    });
    expect(descriptors[2]).toMatchObject({
      kind: "contentControl",
      controlType: "dropDown",
      tag: "empty",
      options: [],
    });
  });
});

describe("readOdtContent: field master declarations as a definitions table", () => {
  it("reads variable, user-field, and sequence declarations into keyed definitions entries", () => {
    const pkg = odtPackage([
      el("text:variable-decls", {}, [
        el("text:variable-decl", {
          "text:name": "total",
          "office:value-type": "float",
        }),
      ]),
      el("text:user-field-decls", {}, [
        el("text:user-field-decl", {
          "text:name": "rate",
          "office:value-type": "percentage",
          "office:value": "0.2",
          "text:formula": "oooc:=1/5",
        }),
      ]),
      el("text:sequence-decls", {}, [
        el("text:sequence-decl", {
          "text:name": "Illustration",
          "text:display-outline-level": "0",
        }),
      ]),
      paragraph("body"),
    ]);
    const document = readOdtContent(pkg);
    expect(document.definitions).toEqual({
      "variable:total": {
        kind: "fieldMaster",
        family: "variable",
        name: "total",
        valueType: "float",
      },
      "user-field:rate": {
        kind: "fieldMaster",
        family: "user-field",
        name: "rate",
        valueType: "percentage",
        value: "0.2",
        formula: "oooc:=1/5",
      },
      "sequence:Illustration": {
        kind: "fieldMaster",
        family: "sequence",
        name: "Illustration",
        displayOutlineLevel: 0,
      },
    });
    expect(firstSectionBlocks(pkg)).toHaveLength(1);
  });

  it("carries the definitions table onto the assembled package root", () => {
    const pkg = odtPackage([
      el("text:sequence-decls", {}, [
        el("text:sequence-decl", { "text:name": "Table" }),
      ]),
      paragraph("body"),
    ]);
    expect(readOdt(pkg).definitions).toEqual({
      "sequence:Table": {
        kind: "fieldMaster",
        family: "sequence",
        name: "Table",
      },
    });
  });

  it("reads number:* data styles and office:font-face-decls from both parts into the same definitions table", () => {
    const pkg = odtPackage([paragraph("body")]);
    // content.xml's own automatic styles gain a data style; styles.xml declares the font faces.
    const contentRoot = pkg.parts["content.xml"];
    if (contentRoot?.kind !== "xml") {
      throw new Error("expected an xml content part");
    }
    const documentContent = contentRoot.nodes[0];
    if (documentContent?.type !== "element") {
      throw new Error("expected a document-content root");
    }
    documentContent.children.unshift(
      el("office:automatic-styles", {}, [
        el("number:currency-style", { "style:name": "GBP" }, [
          el(
            "number:currency-symbol",
            { "number:language": "en", "number:country": "GB" },
            [txt("\u00a3")],
          ),
          el("number:number", { "number:decimal-places": "2" }),
        ]),
      ]),
    );
    pkg.parts["styles.xml"] = {
      kind: "xml",
      nodes: [
        el("office:document-styles", {}, [
          el("office:font-face-decls", {}, [
            el("style:font-face", {
              "style:name": "Liberation Serif",
              "svg:font-family": "\u201cLiberation Serif\u201d",
              "style:font-family-generic": "roman",
              "style:font-pitch": "variable",
            }),
          ]),
        ]),
      ],
    };
    const document = readOdtContent(pkg);
    expect(document.definitions?.["dataStyle:GBP"]).toMatchObject({
      kind: "dataStyle",
      name: "GBP",
    });
    expect(
      (document.definitions?.["dataStyle:GBP"] as { xml?: string }).xml,
    ).toContain("<number:currency-style");
    expect(document.definitions?.["fontFace:Liberation Serif"]).toEqual({
      kind: "fontFace",
      name: "Liberation Serif",
      fontFamily: "\u201cLiberation Serif\u201d",
      familyGeneric: "roman",
      pitch: "variable",
    });
  });

  it("mints note and annotation definitions alongside the field masters in one table, threaded from the block walk", () => {
    const pkg = odtPackage([
      el("text:p", {}, [
        txt("Claim"),
        el("text:note", { "text:note-class": "footnote", "text:id": "ftn1" }, [
          el("text:note-citation", {}, [txt("1")]),
          el("text:note-body", {}, [el("text:p", {}, [txt("The body.")])]),
        ]),
        el("office:annotation", { "office:name": "c1" }, [
          el("dc:creator", {}, [txt("R.")]),
        ]),
      ]),
      el("text:sequence-decls", {}, [
        el("text:sequence-decl", { "text:name": "Table" }),
      ]),
    ]);
    const document = readOdtContent(pkg);
    expect(Object.keys(document.definitions ?? {}).sort()).toEqual([
      "comment:c1",
      "note:ftn1",
      "sequence:Table",
    ]);
    expect(readOdt(pkg).definitions).toEqual(document.definitions);
  });

  it("mints every note-body list's numId from one document-wide counter, so no two lists in the document share an identity", () => {
    const noteWithList = (id: string, citation: string): XmlElement =>
      el("text:note", { "text:note-class": "footnote", "text:id": id }, [
        el("text:note-citation", {}, [txt(citation)]),
        el("text:note-body", {}, [
          el("text:list", {}, [
            el("text:list-item", {}, [
              el("text:p", {}, [txt("note list item")]),
            ]),
          ]),
        ]),
      ]);
    const pkg = odtPackage([
      el("text:p", {}, [txt("one"), noteWithList("ftn1", "1")]),
      el("text:p", {}, [txt("two"), noteWithList("ftn2", "2")]),
      el("text:list", {}, [
        el("text:list-item", {}, [el("text:p", {}, [txt("body list item")])]),
      ]),
    ]);
    const { sections, definitions } = readOdtContent(pkg);
    const noteBodyNumId = (key: string): string =>
      entryParagraphs(key, definitions)[0]?.list?.numId ?? "missing";
    const bodyListNumId = sections[0]?.blocks
      .map((block) =>
        block.kind === "paragraph" ? block.list?.numId : undefined,
      )
      .find((numId) => numId !== undefined);
    if (bodyListNumId === undefined) {
      throw new Error("expected the body list item paragraph");
    }
    const numIds = [
      noteBodyNumId("note:ftn1"),
      noteBodyNumId("note:ftn2"),
      bodyListNumId,
    ];
    // numId is an identity (list.ts's own header invariant: different text:list elements get different numIds), so all three must be pairwise distinct — two notes' bodies are different lists exactly as a note body and the main body are.
    const expectedUniqueCount = 3;
    expect(new Set(numIds).size).toBe(expectedUniqueCount);
  });
});

// The quarantined residue rows that landed outside #764's slice (ExaDev/documents.js#769): inline constructs with no cross-format analogue (ruby, meta, the is-list-header flag) quarantine on their own paragraph; document-level tenants nothing else owns (xforms models, DDE declarations and links, vendor-extension elements) quarantine at the package tier; and the non-content parts quarantine at the package tier keyed by part path. Every fixture is programmatic, built to the OASIS grammar.
describe("readOdtContent: residue rows", () => {
  it("quarantines an xforms:model inside office:forms at the package tier, keyed xforms", () => {
    const pkg = odtPackage([
      el("office:forms", {}, [
        el("xforms:model", { id: "Model1" }, [el("xforms:instance")]),
      ]),
    ]);
    const { source } = readOdtContent(pkg);
    expect(source?.xforms).toMatchObject({ format: "odt" });
    expect(source?.xforms?.xml).toContain('<xforms:model id="Model1">');
  });

  it("quarantines a vendor-extension-namespace element at the package tier, keyed by its own tag", () => {
    const pkg = odtPackage([
      el("loext:content", {}, [txt("extension content")]),
    ]);
    const { source } = readOdtContent(pkg);
    expect(source?.["loext:content"]?.format).toBe("odt");
    expect(source?.["loext:content"]?.xml).toContain("<loext:content>");
  });

  it("quarantines DDE connection declarations and a section's text:dde-source at the package tier under their own keys", () => {
    const pkg = odtPackage([
      el("text:dde-connection-decls", {}, [
        el("text:dde-connection-decl", {
          "text:name": "conn1",
          "office:dde-application": "soffice",
          "office:dde-topic": "./tmp/topic",
          "office:dde-item": "item",
        }),
      ]),
      el("text:section", { "text:name": "Linked" }, [
        el("text:dde-source", {
          "text:connection-name": "conn1",
          "text:dde-application": "soffice",
        }),
        el("text:p", {}, [txt("cached")]),
      ]),
    ]);
    const { source } = readOdtContent(pkg);
    expect(source?.["dde-connections"]?.xml).toContain(
      "text:dde-connection-decl",
    );
    expect(source?.["dde-links"]?.xml).toContain("text:dde-source");
  });

  it("quarantines text:ruby and text:meta inline elements on their own paragraph, reading only the ruby-base as flow text", () => {
    const pkg = odtPackage([
      el("text:p", {}, [
        txt("annotated "),
        el("text:ruby", {}, [
          el("text:ruby-base", {}, [txt("base")]),
          el("text:ruby-text", {}, [txt("gloss")]),
        ]),
        el("text:meta", { "text:xml-id": "meta1" }, [txt(" after")]),
      ]),
    ]);
    const paragraphBlock = firstSectionBlocks(pkg)[0];
    if (paragraphBlock?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    // The ruby-BASE renders as flow text and the meta's wrapped content stays in the flow; the ruby-TEXT gloss is annotation, not body text, so it appears in the residue alone.
    expect(paragraphBlock.runs.map((run) => run.text).join("")).toBe(
      "annotated base after",
    );
    expect(paragraphBlock.source?.format).toBe("odt");
    expect(paragraphBlock.source?.xml).toContain("<text:ruby>");
    expect(paragraphBlock.source?.xml).toContain("<text:ruby-text");
    expect(paragraphBlock.source?.xml).toContain("<text:meta");
  });

  it("quarantines a heading's text:is-list-header attribute as the heading paragraph's own residue", () => {
    const pkg = odtPackage([
      el(
        "text:h",
        { "text:outline-level": "1", "text:is-list-header": "true" },
        [txt("List header heading")],
      ),
    ]);
    const heading = firstSectionBlocks(pkg)[0];
    if (heading?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    expect(heading.source?.xml).toContain(
      '<text:h text:is-list-header="true"></text:h>',
    );
  });

  it("quarantines a non-content XML part at the package tier keyed by its part path, and never the parts the reader consumes", () => {
    const pkg = odtPackage([el("text:p", {}, [txt("body")])]);
    pkg.parts["settings.xml"] = {
      kind: "xml",
      nodes: [
        el("office:document-settings", {}, [
          el("config:config-item-set", { "config:name": "view-settings" }),
        ]),
      ],
    };
    pkg.parts["meta.xml"] = {
      kind: "xml",
      nodes: [
        el("office:document-meta", {}, [
          el("meta:generator", {}, [txt("LibreOffice")]),
        ]),
      ],
    };
    pkg.parts["Thumbnails/thumbnail.png"] = { kind: "binary", base64: "iFA=" };
    const { source } = readOdtContent(pkg);
    expect(Object.keys(source ?? {}).sort()).toEqual(["settings.xml"]);
    expect(source?.["settings.xml"]?.xml).toContain(
      "<office:document-settings",
    );
  });

  it("splices the package-tier residue table onto readOdt's assembled package root", () => {
    const pkg = odtPackage([el("loext:content")]);
    const assembled = readOdt(pkg);
    expect(assembled.source?.["loext:content"]?.format).toBe("odt");
  });
});

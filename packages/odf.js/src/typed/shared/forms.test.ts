import type {
  ContentBlock,
  ContentControlDescriptor,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { el, txt } from "../../xml/fragment";
import { readOdfFormControlConstructs, readOdfFormDefinitions } from "./forms";

// readOdfFormControlConstructs always emits a "contentControl"-kind descriptor (never field/anchor/link/provenance/division, the other members of ConstructDescriptor), but its own return type is the general ContentBlock, so every assertion below needs this narrowing to reach a control's own controlType/tag/value/checked/options fields. A single helper rather than repeating `block?.kind === "constructStart" ? block.descriptor... : undefined` inline: TypeScript does not carry a narrowing from one array-index expression (e.g. `blocks[2]`) to a second, separate access of the same index, so the inline form type-errors the moment the true branch re-reads the array.
function contentControlDescriptor(
  block: ContentBlock | undefined,
): ContentControlDescriptor | undefined {
  if (
    block?.kind !== "constructStart" ||
    block.descriptor.kind !== "contentControl"
  ) {
    return undefined;
  }
  return block.descriptor;
}

describe("readOdfFormDefinitions", () => {
  it("an office:forms element with no form:form children reads as an empty list", () => {
    expect(readOdfFormDefinitions(el("office:forms"))).toStrictEqual([]);
  });

  it("a bare form:form with none of its optional attributes reads with every optional field absent", () => {
    const [definition] = readOdfFormDefinitions(
      el("office:forms", {}, [el("form:form")]),
    );
    expect(definition).toStrictEqual({ controls: [], subForms: [] });
    expect(definition).not.toHaveProperty("name");
    expect(definition).not.toHaveProperty("command");
    expect(definition).not.toHaveProperty("commandType");
    expect(definition).not.toHaveProperty("datasource");
    expect(definition).not.toHaveProperty("filter");
    expect(definition).not.toHaveProperty("order");
  });

  it("reads every one of form:form's own attributes when all are present", () => {
    const [definition] = readOdfFormDefinitions(
      el("office:forms", {}, [
        el("form:form", {
          "form:name": "SalesForm",
          "form:command": "SALES",
          "form:command-type": "table",
          "form:datasource": "Bibliography",
          "form:filter": "ID > 0",
          "form:order": "ID ASC",
        }),
      ]),
    );
    expect(definition).toMatchObject({
      name: "SalesForm",
      command: "SALES",
      commandType: "table",
      datasource: "Bibliography",
      filter: "ID > 0",
      order: "ID ASC",
    });
  });

  it("a nested form:form becomes a subForm, not a control, and is read recursively", () => {
    const [definition] = readOdfFormDefinitions(
      el("office:forms", {}, [
        el("form:form", { "form:name": "Outer" }, [
          el("form:form", { "form:name": "Inner" }),
        ]),
      ]),
    );
    expect(definition?.controls).toStrictEqual([]);
    expect(definition?.subForms).toHaveLength(1);
    expect(definition?.subForms[0]?.name).toBe("Inner");
  });

  it("form:properties is neither a control nor a subForm", () => {
    const [definition] = readOdfFormDefinitions(
      el("office:forms", {}, [el("form:form", {}, [el("form:properties")])]),
    );
    expect(definition?.controls).toStrictEqual([]);
    expect(definition?.subForms).toStrictEqual([]);
  });

  it("a text node child of office:forms or form:form is skipped, not treated as a form:form or control", () => {
    const [definition] = readOdfFormDefinitions(
      el("office:forms", {}, [
        txt("stray text"),
        el("form:form", {}, [txt("more stray text")]),
      ]),
    );
    expect(definition?.controls).toStrictEqual([]);
    expect(definition?.subForms).toStrictEqual([]);
  });

  it("a non-form:* child of office:forms is not read as a form definition", () => {
    expect(
      readOdfFormDefinitions(el("office:forms", {}, [el("draw:frame")])),
    ).toStrictEqual([]);
  });

  it("reads every one of a control's own optional attributes when present, on a control with children of its own", () => {
    const [definition] = readOdfFormDefinitions(
      el("office:forms", {}, [
        el("form:form", {}, [
          el(
            "form:grid",
            {
              "form:name": "grid1",
              "form:control-implementation":
                "ooo:com.sun.star.form.component.GridControl",
              "form:data-field": "ITEMS",
              "form:id": "control9",
              "form:label": "Items",
            },
            [el("form:column", { "form:name": "col1" })],
          ),
        ]),
      ]),
    );
    expect(definition?.controls).toStrictEqual([
      {
        tag: "form:grid",
        name: "grid1",
        controlImplementation: "ooo:com.sun.star.form.component.GridControl",
        dataField: "ITEMS",
        id: "control9",
        label: "Items",
        controls: [{ tag: "form:column", name: "col1", controls: [] }],
      },
    ]);
  });

  it("a control with none of its optional attributes reads with every optional field absent", () => {
    const [definition] = readOdfFormDefinitions(
      el("office:forms", {}, [el("form:form", {}, [el("form:text")])]),
    );
    expect(definition?.controls).toStrictEqual([
      { tag: "form:text", controls: [] },
    ]);
  });
});

describe("readOdfFormControlConstructs", () => {
  it("an office:forms element with no form:form children emits nothing, including for a non-form:* child", () => {
    expect(
      readOdfFormControlConstructs(el("office:forms"), "odt"),
    ).toStrictEqual([]);
    expect(
      readOdfFormControlConstructs(
        el("office:forms", {}, [el("draw:frame")]),
        "odt",
      ),
    ).toStrictEqual([]);
  });

  it("a bare form:form with no name and no properties emits a group construct pair with no tag or source", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [el("form:form")]),
      "odt",
    );
    expect(blocks).toStrictEqual([
      {
        kind: "constructStart",
        descriptor: { kind: "contentControl", controlType: "group" },
      },
      { kind: "constructEnd" },
    ]);
  });

  it("a named form:form with form:properties emits a group construct carrying the name as tag and the properties as source, in the reader's own format", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", { "form:name": "SalesForm" }, [
          el("form:properties", {}, [el("form:property")]),
        ]),
      ]),
      "odb",
    );
    expect(blocks[0]).toStrictEqual({
      kind: "constructStart",
      descriptor: {
        kind: "contentControl",
        controlType: "group",
        tag: "SalesForm",
        source: {
          format: "odb",
          xml: "<form:properties><form:property></form:property></form:properties>",
        },
      },
    });
    expect(blocks[1]).toStrictEqual({ kind: "constructEnd" });
  });

  it("a nested form:form is emitted recursively, in document order after its own parent's own start/end pair", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", { "form:name": "Outer" }, [
          el("form:form", { "form:name": "Inner" }),
        ]),
      ]),
      "odt",
    );
    expect(
      blocks.map((b) => contentControlDescriptor(b)?.tag ?? b.kind),
    ).toStrictEqual(["Outer", "constructEnd", "Inner", "constructEnd"]);
  });

  it("a text node child of a form:form is skipped, and form:properties is not itself emitted as a control", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [txt("stray text"), el("form:properties")]),
      ]),
      "odt",
    );
    expect(blocks).toHaveLength(2);
  });

  it.each([
    ["form:text", "plainText", {}],
    ["form:textarea", "plainText", {}],
    ["form:formatted-text", "plainText", {}],
    ["form:password", "plainText", {}],
    ["form:file", "plainText", {}],
    ["form:listbox", "dropDown", { options: [] }],
    ["form:combobox", "comboBox", {}],
    ["form:checkbox", "checkbox", { checked: false }],
    ["form:radio", "checkbox", { checked: false }],
    ["form:button", "button", {}],
    ["form:image-frame", "picture", {}],
    ["form:fixed-text", "richText", {}],
    ["form:frame", "richText", {}],
    ["form:grid", "group", {}],
    ["form:hidden", "richText", {}],
  ] as const)(
    "maps a bare %s control to controlType %s",
    (tag, controlType, extra) => {
      const blocks = readOdfFormControlConstructs(
        el("office:forms", {}, [el("form:form", {}, [el(tag)])]),
        "odt",
      );
      expect(blocks[2]).toStrictEqual({
        kind: "constructStart",
        descriptor: { kind: "contentControl", controlType, ...extra },
      });
    },
  );

  it("an unrecognised form:* tag degrades to richText with the whole element quarantined as residue, not just its properties", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:unknown-kind", { "form:name": "mystery" }, [
            el("form:properties"),
          ]),
        ]),
      ]),
      "odp",
    );
    expect(blocks[2]).toStrictEqual({
      kind: "constructStart",
      descriptor: {
        kind: "contentControl",
        controlType: "richText",
        tag: "mystery",
        source: {
          format: "odp",
          xml: '<form:unknown-kind form:name="mystery"><form:properties></form:properties></form:unknown-kind>',
        },
      },
    });
  });

  it("a mapped control's value prefers form:current-value over form:value, and falls back to form:value alone", () => {
    const withCurrentValue = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:text", {
            "form:current-value": "live",
            "form:value": "stale",
          }),
        ]),
      ]),
      "odt",
    );
    expect(contentControlDescriptor(withCurrentValue[2])?.value).toBe("live");

    const withValueOnly = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [el("form:text", { "form:value": "stale" })]),
      ]),
      "odt",
    );
    expect(contentControlDescriptor(withValueOnly[2])?.value).toBe("stale");
  });

  it("a mapped control with neither form:current-value nor form:value carries no value field", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [el("form:form", {}, [el("form:text")])]),
      "odt",
    );
    expect(blocks[2]).toStrictEqual({
      kind: "constructStart",
      descriptor: { kind: "contentControl", controlType: "plainText" },
    });
  });

  it("form:checkbox and form:radio carry a checked field derived from form:current-state, both true and false", () => {
    const checked = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:checkbox", { "form:current-state": "checked" }),
        ]),
      ]),
      "odt",
    );
    expect(contentControlDescriptor(checked[2])?.checked).toBe(true);

    const uncheckedRadio = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:radio", { "form:current-state": "unchecked" }),
        ]),
      ]),
      "odt",
    );
    expect(contentControlDescriptor(uncheckedRadio[2])?.checked).toBe(false);

    const missingState = readOdfFormControlConstructs(
      el("office:forms", {}, [el("form:form", {}, [el("form:checkbox")])]),
      "odt",
    );
    expect(contentControlDescriptor(missingState[2])?.checked).toBe(false);
  });

  it("a control that is neither checkbox nor radio never carries a checked field", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:button", { "form:current-state": "checked" }),
        ]),
      ]),
      "odt",
    );
    expect(blocks[2]).toStrictEqual({
      kind: "constructStart",
      descriptor: { kind: "contentControl", controlType: "button" },
    });
  });

  it("form:listbox reads its form:option children as label-preferring-over-value pairs, in order, skipping an option with neither", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:listbox", {}, [
            el("form:option", { "form:label": "One", "form:value": "1" }),
            el("form:option", { "form:value": "2" }),
            el("form:option", {}),
          ]),
        ]),
      ]),
      "odt",
    );
    expect(contentControlDescriptor(blocks[2])?.options).toStrictEqual([
      "One",
      "2",
    ]);
  });

  it("a control that is not a listbox never carries an options field, even with form:option-shaped children", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:combobox", {}, [el("form:option", { "form:label": "One" })]),
        ]),
      ]),
      "odt",
    );
    expect(blocks[2]).toStrictEqual({
      kind: "constructStart",
      descriptor: { kind: "contentControl", controlType: "comboBox" },
    });
  });

  it("a mapped control's own form:properties becomes its source residue, in the reader's own format", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [
        el("form:form", {}, [
          el("form:button", {}, [
            el("form:properties", {}, [el("form:property")]),
          ]),
        ]),
      ]),
      "odm",
    );
    expect(contentControlDescriptor(blocks[2])?.source).toStrictEqual({
      format: "odm",
      xml: "<form:properties><form:property></form:property></form:properties>",
    });
  });

  it("a mapped control with no form:properties child carries no source field", () => {
    const blocks = readOdfFormControlConstructs(
      el("office:forms", {}, [el("form:form", {}, [el("form:button")])]),
      "odt",
    );
    expect(blocks[2]).toStrictEqual({
      kind: "constructStart",
      descriptor: { kind: "contentControl", controlType: "button" },
    });
  });
});

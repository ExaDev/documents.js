import {
  attrValue,
  decodePackage,
  elementsWithTag,
  readManifest,
  rootElement,
} from "odf.js";
import { describe, expect, it } from "vitest";
import { charSubstitutionOdbBytes } from "./odb-char-substitution-fixture";

// odf.js's own odb reader locates office:database by walking content.xml's root element's CHILDREN for "office:body" -- it never inspects the root element's own tag, and db:connection-resource's xlink:type is never read at all (only xlink:href, to tell an embedded HSQLDB connection from a Firebird one). readManifest itself only checks that manifest:version is PRESENT, never what it says. None of the three is observable through odb_render_report/odb_query, so these tests pin them directly against the fixture's own decoded XML instead -- the one place this fixture's claim to be a genuinely representative ODF package shape (rather than an arbitrary one) is actually checkable.
describe("charSubstitutionOdbBytes", () => {
  it("wraps content.xml in a genuine office:document-content root", () => {
    const pkg = decodePackage(charSubstitutionOdbBytes());
    const contentPart = pkg.parts["content.xml"];
    if (contentPart?.kind !== "xml") {
      throw new Error("expected an xml content.xml part");
    }

    expect(rootElement(contentPart.nodes)?.tag).toBe("office:document-content");
  });

  it("declares its embedded HSQLDB connection with a real xlink:type=simple attribute", () => {
    const pkg = decodePackage(charSubstitutionOdbBytes());
    const contentPart = pkg.parts["content.xml"];
    if (contentPart?.kind !== "xml") {
      throw new Error("expected an xml content.xml part");
    }

    const [connectionResource] = elementsWithTag(
      contentPart.nodes,
      "db:connection-resource",
    );
    if (connectionResource === undefined) {
      throw new Error("expected a db:connection-resource element");
    }
    expect(attrValue(connectionResource, "xlink:type")).toBe("simple");
  });

  it("declares a real OASIS ODF 1.3 manifest with no listed parts", () => {
    const pkg = decodePackage(charSubstitutionOdbBytes());

    const manifest = readManifest(pkg);

    expect(manifest.version).toBe("1.3");
    expect(manifest.entries).toEqual([]);
  });
});

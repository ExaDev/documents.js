import { describe, expect, it } from "vitest";
import { readXmpMetadata } from "./xmp";

// A minimal XMP packet wrapper: each field element the standard defines, given plain string content — readXmpMetadata itself has no test file at all, only indirect exercise through a full PDF's own /Metadata stream, which never distinguishes which element name maps to which output field.
function packet(elements: string): string {
  return `<x:xmpmeta><rdf:RDF><rdf:Description>${elements}</rdf:Description></rdf:RDF></x:xmpmeta>`;
}

describe("readXmpMetadata: plain-value fields", () => {
  it("maps each standard element to its own distinct output field", () => {
    const p = packet(
      "<dc:title>My Title</dc:title>" +
        "<dc:creator>My Creator</dc:creator>" +
        "<dc:description>My Description</dc:description>" +
        "<xmp:CreatorTool>My Tool</xmp:CreatorTool>" +
        "<pdf:Producer>My Producer</pdf:Producer>" +
        "<xmp:CreateDate>2026-01-01T00:00:00Z</xmp:CreateDate>" +
        "<xmp:ModifyDate>2026-02-02T00:00:00Z</xmp:ModifyDate>",
    );
    expect(readXmpMetadata(p)).toEqual({
      title: "My Title",
      author: "My Creator",
      subject: "My Description",
      creator: "My Tool",
      producer: "My Producer",
      createdIso: "2026-01-01T00:00:00Z",
      modifiedIso: "2026-02-02T00:00:00Z",
    });
  });

  it("returns an empty metadata object for a packet with none of the standard elements", () => {
    expect(readXmpMetadata(packet(""))).toEqual({});
  });

  it("omits a field whose element is present but empty (whitespace only)", () => {
    expect(readXmpMetadata(packet("<dc:title>   </dc:title>"))).toEqual({});
  });

  it("trims surrounding whitespace from a plain value", () => {
    expect(
      readXmpMetadata(packet("<dc:title>\n  Padded  \n</dc:title>")),
    ).toEqual({ title: "Padded" });
  });
});

describe("readXmpMetadata: rdf:Alt/Bag/Seq array-form fields", () => {
  it("joins multiple rdf:li items with a comma for a scalar field", () => {
    const p = packet(
      "<dc:creator><rdf:Seq><rdf:li>First</rdf:li><rdf:li>Second</rdf:li></rdf:Seq></dc:creator>",
    );
    expect(readXmpMetadata(p)).toEqual({ author: "First, Second" });
  });

  it("reads dc:subject's own rdf:Bag as the keywords array, not joined into one string", () => {
    const p = packet(
      "<dc:subject><rdf:Bag><rdf:li>alpha</rdf:li><rdf:li>beta</rdf:li></rdf:Bag></dc:subject>",
    );
    expect(readXmpMetadata(p)).toEqual({ keywords: ["alpha", "beta"] });
  });

  it("skips a blank rdf:li item rather than including an empty string", () => {
    const p = packet(
      "<dc:subject><rdf:Bag><rdf:li>alpha</rdf:li><rdf:li>   </rdf:li></rdf:Bag></dc:subject>",
    );
    expect(readXmpMetadata(p)).toEqual({ keywords: ["alpha"] });
  });

  it("omits keywords entirely when dc:subject carries no non-blank items", () => {
    const p = packet("<dc:subject><rdf:Bag></rdf:Bag></dc:subject>");
    expect(readXmpMetadata(p)).toEqual({});
  });
});

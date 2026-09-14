import { describe, expect, it, vi } from "vitest";
import * as odfJs from "odf.js";
import { ODF_MEDIA_TYPES } from "odf.js";
import { createOdt } from "../edit/odt/editor";
import { syncOdfManifest } from "./manifest";

// syncOdfManifest walks every package part path, deriving a mediaTypeOverrides entry for each genuine embedded sub-document directory ("<dir>/content.xml") and handing the whole map to odf.js's own syncManifest. Spying on that call is what makes the guard against the package's own ROOT content.xml (which also happens to have a real office:body -- there is nothing about its shape alone that would exclude it) directly observable: odf.js's real syncManifest silently tolerates a bogus override key, so nothing downstream of it would otherwise notice one leaking in.
describe("syncOdfManifest", () => {
  it("never derives a mediaTypeOverrides entry for the package's own root content.xml", () => {
    const spy = vi.spyOn(odfJs, "syncManifest");
    const pkg = createOdt().toPackage();
    syncOdfManifest(pkg);
    const options = spy.mock.calls.at(-1)?.[1];
    expect(options?.mediaTypeOverrides).toEqual({});
    spy.mockRestore();
  });

  it("derives the correct media type override for a real embedded sub-document directory", () => {
    const pkg = createOdt().toPackage();
    pkg.parts["Object 1/content.xml"] = {
      kind: "xml",
      nodes: [
        {
          type: "element",
          tag: "office:document-content",
          attributes: [],
          children: [
            {
              type: "element",
              tag: "office:body",
              attributes: [],
              children: [
                {
                  type: "element",
                  tag: "office:spreadsheet",
                  attributes: [],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const spy = vi.spyOn(odfJs, "syncManifest");
    syncOdfManifest(pkg);
    const options = spy.mock.calls.at(-1)?.[1];
    expect(options?.mediaTypeOverrides).toEqual({
      "Object 1/": ODF_MEDIA_TYPES.ods,
    });
    spy.mockRestore();
  });
});

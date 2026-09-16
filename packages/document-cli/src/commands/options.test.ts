import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  addConversionFlags,
  addDelimiterOption,
  addDumpPackageOption,
  addFontOptions,
  addJsonOption,
  addOutOption,
  addPageOption,
  addQuietOption,
  addSheetOption,
  addTimeoutOption,
  addVerboseOption,
} from "./options";

function commandWith(register: (command: Command) => Command): Command {
  const command = new Command("t").action(() => undefined);
  register(command);
  return command;
}

describe("addOutOption", () => {
  it("registers -o/--out and reads its value", () => {
    const command = commandWith(addOutOption);
    command.parse(["node", "t", "--out", "result.pdf"]);
    expect(command.opts().out).toBe("result.pdf");
    const short = commandWith(addOutOption);
    short.parse(["node", "t", "-o", "a.pdf"]);
    expect(short.opts().out).toBe("a.pdf");
  });

  it("leaves out undefined when not given", () => {
    const command = commandWith(addOutOption);
    command.parse(["node", "t"]);
    expect(command.opts().out).toBeUndefined();
  });
});

describe("addTimeoutOption", () => {
  it("parses --timeout as an integer", () => {
    const command = commandWith(addTimeoutOption);
    command.parse(["node", "t", "--timeout", "5000"]);
    expect(command.opts().timeout).toBe(5000);
  });

  it("leaves timeout undefined when not given", () => {
    const command = commandWith(addTimeoutOption);
    command.parse(["node", "t"]);
    expect(command.opts().timeout).toBeUndefined();
  });
});

describe("addJsonOption", () => {
  it("defaults --json to false", () => {
    const command = commandWith(addJsonOption);
    command.parse(["node", "t"]);
    expect(command.opts().json).toBe(false);
  });

  it("sets --json to true when given", () => {
    const command = commandWith(addJsonOption);
    command.parse(["node", "t", "--json"]);
    expect(command.opts().json).toBe(true);
  });
});

describe("addQuietOption", () => {
  it("defaults -q/--quiet to false and can be set via either spelling", () => {
    const command = commandWith(addQuietOption);
    command.parse(["node", "t"]);
    expect(command.opts().quiet).toBe(false);
    const long = commandWith(addQuietOption);
    long.parse(["node", "t", "--quiet"]);
    expect(long.opts().quiet).toBe(true);
    const short = commandWith(addQuietOption);
    short.parse(["node", "t", "-q"]);
    expect(short.opts().quiet).toBe(true);
  });
});

describe("addVerboseOption", () => {
  it("defaults --verbose to false and can be set", () => {
    const command = commandWith(addVerboseOption);
    command.parse(["node", "t"]);
    expect(command.opts().verbose).toBe(false);
    const set = commandWith(addVerboseOption);
    set.parse(["node", "t", "--verbose"]);
    expect(set.opts().verbose).toBe(true);
  });
});

describe("addDumpPackageOption", () => {
  it("registers --dump-package and reads its value", () => {
    const command = commandWith(addDumpPackageOption);
    command.parse(["node", "t", "--dump-package", "tree.json"]);
    expect(command.opts().dumpPackage).toBe("tree.json");
  });
});

describe("addFontOptions", () => {
  it("accumulates repeated --font-file flags in the given order", () => {
    const command = commandWith(addFontOptions);
    command.parse([
      "node",
      "t",
      "--font-file",
      "a.ttf",
      "--font-file",
      "b.ttf",
    ]);
    expect(command.opts().fontFile).toEqual(["a.ttf", "b.ttf"]);
  });

  it("defaults --font-file to an empty array", () => {
    const command = commandWith(addFontOptions);
    command.parse(["node", "t"]);
    expect(command.opts().fontFile).toEqual([]);
  });

  it("defaults --report-font-substitutions to false and can be set", () => {
    const command = commandWith(addFontOptions);
    command.parse(["node", "t"]);
    expect(command.opts().reportFontSubstitutions).toBe(false);
    const set = commandWith(addFontOptions);
    set.parse(["node", "t", "--report-font-substitutions"]);
    expect(set.opts().reportFontSubstitutions).toBe(true);
  });
});

describe("addConversionFlags", () => {
  it("registers all five conversion flags at once", () => {
    const command = commandWith(addConversionFlags);
    command.parse([
      "node",
      "t",
      "--out",
      "o.pdf",
      "--timeout",
      "10",
      "--json",
      "--quiet",
      "--verbose",
    ]);
    expect(command.opts()).toEqual({
      out: "o.pdf",
      timeout: 10,
      json: true,
      quiet: true,
      verbose: true,
    });
  });
});

describe("addDelimiterOption", () => {
  it("registers --delimiter and reads its value", () => {
    const command = commandWith(addDelimiterOption);
    command.parse(["node", "t", "--delimiter", ";"]);
    expect(command.opts().delimiter).toBe(";");
  });
});

describe("addSheetOption", () => {
  it("registers --sheet and reads its value", () => {
    const command = commandWith(addSheetOption);
    command.parse(["node", "t", "--sheet", "Sheet2"]);
    expect(command.opts().sheet).toBe("Sheet2");
  });
});

describe("addPageOption", () => {
  it("parses --page as an integer", () => {
    const command = commandWith(addPageOption);
    command.parse(["node", "t", "--page", "3"]);
    expect(command.opts().page).toBe(3);
  });
});

describe("option help text", () => {
  function descriptionOf(
    register: (command: Command) => Command,
    long: string,
  ): string | undefined {
    const command = commandWith(register);
    return command.options.find((option) => option.long === long)?.description;
  }

  it("describes each registered flag with its own exact help text", () => {
    expect(descriptionOf(addOutOption, "--out")).toBe(
      "output file path (defaults to the input path with the target format's extension); use - for stdout",
    );
    expect(descriptionOf(addTimeoutOption, "--timeout")).toBe(
      "abort the run after this many milliseconds",
    );
    expect(descriptionOf(addJsonOption, "--json")).toBe(
      "emit diagnostics and the result summary as newline-delimited JSON on stderr",
    );
    expect(descriptionOf(addQuietOption, "--quiet")).toBe(
      "suppress diagnostic and summary output",
    );
    expect(descriptionOf(addVerboseOption, "--verbose")).toBe(
      "include a full stack trace when the run fails",
    );
    expect(descriptionOf(addDumpPackageOption, "--dump-package")).toBe(
      "write the intermediate DocumentTree (the tree form: container-grouped content carrying per-node rendered frames, plus page sizes) this conversion built to a JSON file",
    );
    expect(descriptionOf(addFontOptions, "--font-file")).toBe(
      "embed this font file (.ttf/.otf) when the document asks for the family it declares; repeatable. The family, weight, and slope are read from the font's own 'name'/'OS/2' tables, so no accompanying family flag is needed",
    );
    expect(descriptionOf(addFontOptions, "--report-font-substitutions")).toBe(
      "print each font face that resolved to something other than what the document asked for to stderr, as it happens",
    );
    expect(descriptionOf(addDelimiterOption, "--delimiter")).toBe(
      "field delimiter a csv source reads with, or a csv target writes with (default ',')",
    );
    expect(descriptionOf(addSheetOption, "--sheet")).toBe(
      "the sheet a csv target writes, when the source document has more than one",
    );
    expect(descriptionOf(addPageOption, "--page")).toBe(
      "the 0-based page an svg target draws, when the source document has more than one",
    );
  });
});

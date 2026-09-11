// Builds a Node single-executable application (SEA) binary from a package's own tsdown-bundled dist-sea/sea-entry.cjs (see tsdown.sea.shared.ts) for whichever platform this script runs on -- one call per (package, platform) cell of the CI matrix, never cross-compiled: Node's own --build-sea copies the CURRENT running node binary, so the platform this script runs under is the platform the resulting binary targets. Uses the single `node --build-sea` flag (Node 25.5.0+, see https://nodejs.org/api/single-executable-applications.html), not the older two-step --experimental-sea-config-then-postject workflow that flag replaced: --build-sea generates the preparation blob and injects it into a copy of the running binary in one internal step, writing the finished executable straight to sea-config.json's own "output" path, so this script has no separate blob file, no external injector dependency, and no manual "copy the node binary first" step of its own.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type SeaPlatform = "darwin" | "linux" | "win32";

export interface SeaBuildPaths {
  readonly packageDir: string;
  readonly bundlePath: string;
  readonly outputDir: string;
  readonly binaryName: string;
}

/** Node's SEA `mainFormat`, derived from the bundle's own file extension rather than passed separately -- tsdown.sea.shared.ts's `seaEntryBuildConfig` always writes `.cjs` for a `format: "cjs"` build and `.mjs` for `format: "esm"` (`fixedExtension: true`), so the extension is already an unambiguous, single source of truth for which one this bundle is. */
export function mainFormatFor(bundlePath: string): "commonjs" | "module" {
  return bundlePath.endsWith(".mjs") ? "module" : "commonjs";
}

/** The bare (unsuffixed) binary name and its platform-appropriate on-disk file name -- only win32 gets a suffix, and Node's own --build-sea requires it: its own documentation states the .exe extension is necessary for the "output" path on Windows, not merely conventional. */
export function binaryFileName(
  binaryName: string,
  platform: SeaPlatform,
): string {
  return platform === "win32" ? `${binaryName}.exe` : binaryName;
}

/** Every step this platform needs after --build-sea produces the executable -- macOS refuses to run an unsigned binary at all, so an ad-hoc signature (`codesign --sign -`, no certificate, no Apple Developer account) is required for the binary to launch. `--force` is load-bearing, not optional: --build-sea copies whichever Node binary built it, and every officially distributed Node build (and every macos-latest GitHub Actions runner's own preinstalled one) already carries a real code signature -- confirmed directly, `codesign --sign -` alone against such a binary exits 1 ("is already signed") without `--force`, which Node's own quick-start doesn't surface because it's written against a plain unsigned build. Linux needs no signing step; Windows signing needs a real certificate this pipeline does not hold, so an unsigned .exe ships as-is (it still runs, per Node's own SEA documentation -- Windows SmartScreen may warn on an unsigned download, exactly as it does for any other unsigned .exe). */
export function postBuildCommandsFor(
  platform: SeaPlatform,
  binaryPath: string,
): readonly (readonly [string, readonly string[]])[] {
  if (platform === "darwin") {
    return [["codesign", ["--sign", "-", "--force", binaryPath]]];
  }
  return [];
}

function run(command: string, args: readonly string[]): void {
  execFileSync(command, args, { stdio: "inherit" });
}

/** Builds the SEA binary for `paths.packageDir`, targeting whichever platform this process is currently running under. sea-config.json lives beside the final binary in `paths.outputDir`, which the caller is responsible for pointing at a package's own gitignored dist-sea/ (see tsdown.sea.shared.ts's own comment on why that directory is never published). */
export function buildSeaBinary(
  paths: SeaBuildPaths,
  platform: SeaPlatform,
): string {
  mkdirSync(paths.outputDir, { recursive: true });

  const fileName = binaryFileName(paths.binaryName, platform);
  const binaryPath = join(paths.outputDir, fileName);
  const configPath = join(paths.outputDir, "sea-config.json");

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        main: paths.bundlePath,
        output: binaryPath,
        mainFormat: mainFormatFor(paths.bundlePath),
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    ),
  );

  run(process.execPath, ["--build-sea", configPath]);

  for (const [command, args] of postBuildCommandsFor(platform, binaryPath)) {
    run(command, args);
  }

  return binaryPath;
}

function currentPlatform(): SeaPlatform {
  const { platform } = process;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(
    `No Node SEA binary target is defined for platform "${platform}".`,
  );
}

const BUNDLE_BASENAME = "sea-entry";
const BUNDLE_EXTENSIONS = [".cjs", ".mjs"] as const;

/** Locates the tsdown-produced bundle inside a package's own dist-sea/ without the caller having to know whether that package builds CJS or ESM (document-cli's Ink-driven ESM build vs. document-mcp/document-rest's CJS default -- see each package's own tsdown.config.ts) -- the bundle's extension is itself the single source of truth for that choice, per mainFormatFor's own reasoning above. */
function findBundlePath(outputDir: string): string {
  const candidates = BUNDLE_EXTENSIONS.map((extension) =>
    join(outputDir, `${BUNDLE_BASENAME}${extension}`),
  );
  const [bundlePath, ...extraMatches] = candidates.filter((candidate) =>
    existsSync(candidate),
  );
  if (bundlePath === undefined || extraMatches.length > 0) {
    throw new Error(
      `Expected exactly one of ${candidates.join(", ")} to exist -- run this package's own build (which produces dist-sea/) first. Found: ${[bundlePath, ...extraMatches].filter((path) => path !== undefined).join(", ") || "none"}.`,
    );
  }
  return bundlePath;
}

function parseArgs(argv: readonly string[]): SeaBuildPaths {
  const [packageDir, outputDir, binaryName] = argv;
  if (
    packageDir === undefined ||
    outputDir === undefined ||
    binaryName === undefined
  ) {
    throw new Error(
      "Usage: build-sea-binary.ts <packageDir> <outputDir> <binaryName>",
    );
  }
  const resolvedOutputDir = join(packageDir, outputDir);
  return {
    packageDir,
    bundlePath: findBundlePath(resolvedOutputDir),
    outputDir: resolvedOutputDir,
    binaryName,
  };
}

function main(): void {
  const paths = parseArgs(process.argv.slice(2));
  const binaryPath = buildSeaBinary(paths, currentPlatform());
  console.log(binaryPath);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}

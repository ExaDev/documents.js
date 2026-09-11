// Builds a Node single-executable application (SEA) binary from a package's own tsdown-bundled dist-sea/sea-entry.cjs (see tsdown.sea.shared.ts) for whichever platform this script runs on -- one call per (package, platform) cell of the CI matrix, never cross-compiled: Node's own SEA injection copies the CURRENT running node binary, so the platform this script runs under is the platform the resulting binary targets. Mirrors the exact sequence https://nodejs.org/api/single-executable-applications.html documents (sea-config -> node --experimental-sea-config -> postject injection -> platform-specific signing), packaged as one script so CI's per-OS steps stay identical shell invocations rather than three near-duplicate workflow step lists.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Fixed per Node's own documentation -- identifies an injected blob to the runtime at startup; not a secret, and never changes between builds.
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
// Required specifically for the macOS Mach-O injection step; postject's own default segment name collides with a reserved one on that platform.
const MACHO_SEGMENT_NAME = "NODE_SEA";

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

/** The bare (unsuffixed) binary name and its platform-appropriate on-disk file name -- only win32 gets a suffix, matching how Windows itself resolves an executable by extension rather than a permission bit. */
export function binaryFileName(
  binaryName: string,
  platform: SeaPlatform,
): string {
  return platform === "win32" ? `${binaryName}.exe` : binaryName;
}

/** The postject invocation's own platform-specific argv tail -- only macOS's Mach-O format needs a named segment; ELF (Linux) and PE (Windows) postject targets need no equivalent. */
export function postjectArgsFor(platform: SeaPlatform): readonly string[] {
  return platform === "darwin"
    ? ["--macho-segment-name", MACHO_SEGMENT_NAME]
    : [];
}

/** Every step this platform needs before postject injection can safely run -- Windows' own stock node.exe download ships pre-signed, and Node's own SEA documentation removes that signature before injecting (an unmodified signature covering different bytes would otherwise make the binary appear tampered); macOS and Linux have no equivalent pre-injection step. Returns the argv for each command to run, in order. */
export function preInjectionCommandsFor(
  platform: SeaPlatform,
  binaryPath: string,
): readonly (readonly [string, readonly string[]])[] {
  if (platform === "win32") {
    return [["signtool", ["remove", "/s", binaryPath]]];
  }
  return [];
}

/** Every step this platform needs after postject injection -- macOS refuses to run an unsigned (or injection-invalidated) binary at all, so an ad-hoc signature (`codesign --sign -`, no certificate, no Apple Developer account) is required for the binary to launch; Linux needs no signing step; Windows signing needs a real certificate this pipeline does not hold, so an unsigned .exe ships as-is (it still runs, per Node's own SEA documentation -- Windows SmartScreen may warn on an unsigned download, exactly as it does for any other unsigned .exe). */
export function postInjectionCommandsFor(
  platform: SeaPlatform,
  binaryPath: string,
): readonly (readonly [string, readonly string[]])[] {
  if (platform === "darwin") {
    return [
      ["codesign", ["--remove-signature", binaryPath]],
      ["codesign", ["--sign", "-", binaryPath]],
    ];
  }
  return [];
}

function run(command: string, args: readonly string[]): void {
  execFileSync(command, args, { stdio: "inherit" });
}

/** Builds the SEA binary for `paths.packageDir`, targeting whichever platform this process is currently running under. Every intermediate file (sea-config.json, the prep blob) lives beside the final binary in `paths.outputDir`, which the caller is responsible for pointing at a package's own gitignored dist-sea/ (see tsdown.sea.shared.ts's own comment on why that directory is never published). */
export function buildSeaBinary(
  paths: SeaBuildPaths,
  platform: SeaPlatform,
): string {
  mkdirSync(paths.outputDir, { recursive: true });

  const fileName = binaryFileName(paths.binaryName, platform);
  const binaryPath = join(paths.outputDir, fileName);
  const blobPath = join(paths.outputDir, "sea-prep.blob");
  const configPath = join(paths.outputDir, "sea-config.json");

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        main: paths.bundlePath,
        output: blobPath,
        mainFormat: mainFormatFor(paths.bundlePath),
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    ),
  );

  run(process.execPath, ["--experimental-sea-config", configPath]);

  copyFileSync(process.execPath, binaryPath);

  for (const [command, args] of preInjectionCommandsFor(platform, binaryPath)) {
    run(command, args);
  }

  run("npx", [
    "--yes",
    "postject",
    binaryPath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    SENTINEL_FUSE,
    ...postjectArgsFor(platform),
  ]);

  for (const [command, args] of postInjectionCommandsFor(
    platform,
    binaryPath,
  )) {
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

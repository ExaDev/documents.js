import { relative, sep } from "node:path";
import type { Configuration } from "lint-staged";

/**
 * ESLint's flat config resolves from the working directory, not from each linted file's own directory, so running `eslint --fix` at the workspace root over staged files in packages/<name>/ would apply the root config -- which ignores packages/** -- and report every one of them as ignored rather than linting it. Each package owns its own eslint.config.ts (file scoping, tsconfig wiring, runtime-isomorphism import bans are genuinely per-package), so the fix has to run once per package, in that package's directory.
 *
 * Files outside packages/ (this file, commitlint.config.ts, eslint.config.ts) are linted by the root config in one final invocation.
 */

const PACKAGES_DIR = "packages";

function packageDirectoryOf(repoRelativePath: string): string | undefined {
  const segments = repoRelativePath.split(sep);
  const [first, second] = segments;
  if (first !== PACKAGES_DIR || second === undefined || segments.length < 3) {
    return undefined;
  }
  return `${PACKAGES_DIR}${sep}${second}`;
}

function groupByDirectory(
  absolutePaths: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const absolutePath of absolutePaths) {
    const repoRelativePath = relative(process.cwd(), absolutePath);
    const directory = packageDirectoryOf(repoRelativePath) ?? ".";
    const existing = grouped.get(directory);
    if (existing === undefined) {
      grouped.set(directory, [repoRelativePath]);
    } else {
      existing.push(repoRelativePath);
    }
  }
  return grouped;
}

const config: Configuration = {
  // Every extension the lint gate now checks, not just TypeScript. JSON, Markdown, and YAML became lintable when the shared config gained those languages, and a glob that stops at ts/tsx means a staged README or workflow file is committed unformatted and then fails CI -- the one thing this hook exists to prevent.
  "*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,md,yml,yaml}": (files) =>
    [...groupByDirectory(files)].map(([directory, paths]) => {
      const pathsRelativeToDirectory = paths.map(
        (path) => `"${directory === "." ? path : relative(directory, path)}"`,
      );
      return `pnpm --dir ${directory} exec eslint --fix ${pathsRelativeToDirectory.join(" ")}`;
    }),
};

export default config;

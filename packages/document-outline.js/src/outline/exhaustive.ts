// Reached only if DocumentTree ever gains a kind that buildOutline's or effectivePackage's own switch does not match: every current kind has a case in both, so `pkg` narrows to `never` at each call, and adding an uncovered kind makes that narrowing fail and the call stop compiling — the real safety net. Exists so each switch's exhaustiveness, proven by the type checker rather than by a catch-all default that would silently project a genuinely new package kind as an empty outline, still gives consistent-return an explicit statement to see past the switch. Shared rather than duplicated per module because both switches discriminate the same union on the same field.
export function assertNeverPackage(pkg: never): never {
  throw new Error(
    `document-outline.js: unhandled DocumentTree package ${JSON.stringify(pkg)}`,
  );
}

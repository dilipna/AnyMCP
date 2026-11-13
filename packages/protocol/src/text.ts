// Parameter references and text templating. Dependency-free (no zod) so the content script can use it.

export type ValueRef = { param: string } | { literal: string };
/** Fixed text, text with {param} placeholders, or exactly a parameter. Never page content. */
export type TextRef = string | { param: string };

export function isParamRef(v: unknown): v is { param: string } {
  return !!v && typeof v === "object" && typeof (v as { param?: unknown }).param === "string";
}

/**
 * Resolve a TextRef/ValueRef against run arguments. Returns undefined if a referenced param is missing.
 * Strings in a TextRef may contain {param} placeholders; ValueRef literals are used verbatim.
 */
export function resolveText(ref: TextRef | ValueRef, args: Record<string, unknown>): string | undefined {
  if (typeof ref === "string") {
    let missing = false;
    const out = ref.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, name: string) => {
      const v = args[name];
      if (v === undefined || v === null) {
        missing = true;
        return "";
      }
      return String(v);
    });
    return missing ? undefined : out;
  }
  if ("literal" in ref) return ref.literal;
  const v = args[ref.param];
  if (v === undefined || v === null) return undefined;
  return String(v);
}

// Parameter references and text templating. Dependency-free (no zod) so the content script can use it.

export type ValueRef = { param: string } | { literal: string };
/** Fixed text, text with {param} placeholders, or exactly a parameter. Never page content. */
export type TextRef = string | { param: string };

/** The argument named `name`, or undefined. Own fields only: a missing `constructor` argument must not be read as
 *  Object.prototype.constructor (found by the fuzz tests). */
export function argValue(args: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(args, name) ? args[name] : undefined;
}

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
      const v = argValue(args, name);
      if (v === undefined || v === null) {
        missing = true;
        return "";
      }
      return String(v);
    });
    return missing ? undefined : out;
  }
  if ("literal" in ref) return ref.literal;
  const v = argValue(args, ref.param);
  if (v === undefined || v === null) return undefined;
  return String(v);
}

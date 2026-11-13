// Which form fields MyCP must never record, read, fill or click. Dependency-free (shared with the content script).

const SENSITIVE_WORDS_RE =
  /\bpass(word|code|wd)?\b|\bpwd\b|\botp\b|\bone[- ]?time\b|\btoken\b|\bsecret\b|\bapi[- ]?key\b|\bssn\b|\bsocial security\b|\bcard[- ]?(number|no|num)\b|\bcredit card\b|\bcvv\b|\bcvc\b|\biban\b|\brouting number\b/i;

/** Split camelCase, snake_case, kebab-case and dotted names into words before matching. */
function normalizeName(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ");
}

/** True if a field name, id, label or step target looks like it holds a secret. */
export function looksSensitive(s: string | null | undefined): boolean {
  return !!s && SENSITIVE_WORDS_RE.test(normalizeName(s));
}

export interface FieldDescriptor {
  type?: string | null;
  autocomplete?: string | null;
  name?: string | null;
  id?: string | null;
  label?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  mycpIgnore?: boolean;
}

/** True if a form field must never be recorded, read or filled by MyCP. */
export function isSensitiveField(f: FieldDescriptor): boolean {
  if (f.mycpIgnore) return true;
  const type = (f.type ?? "").toLowerCase();
  if (type === "password" || type === "hidden" || type === "file") return true;
  const ac = (f.autocomplete ?? "").toLowerCase();
  if (ac.startsWith("cc-") || ac === "one-time-code" || ac.includes("password")) return true;
  return [f.name, f.id, f.label, f.ariaLabel, f.placeholder].some((s) => looksSensitive(s));
}

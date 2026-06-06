/**
 * Lenient JSON extraction from model text — used by the brain-completion steps (`review`, `fix`) to
 * pull a JSON object out of a reply that may carry prose around it. Pure, dependency-free.
 */

/**
 * Scan `s` for the first complete JSON object (brace-balanced, string/escape aware) starting at the
 * first `{`. Returns the parsed value + the index just past its closing brace, or null if the input
 * does not (yet) contain a complete, parseable object.
 */
export function tryExtractFirstJsonObject(s: string): { value: any; end: number } | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return { value: JSON.parse(s.slice(start, i + 1)), end: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

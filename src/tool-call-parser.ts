/**
 * Pure, streaming parser for the prompted-tool protocol (see src/provider.ts).
 *
 * The companion currently emits tool calls as TEXT via a prompted-tool protocol — ideally a
 * `<tool_call>{json}</tool_call>` block, but weaker models (glm-5) reliably emit the right JSON
 * while dropping the wrapper and adding a prose preamble. This parser accepts both forms, streams
 * plain text through, and stops at the FIRST tool call. It is deliberately free of any network or
 * pi-stream coupling so it can be unit-tested exhaustively.
 *
 * Guard against false positives: a bare `{…}` is treated as a tool call ONLY if it starts with
 * `"name"`/`"arguments"` AND its parsed `name` matches a known tool; otherwise it streams as text.
 */

export const OPEN = "<tool_call>";
export const CLOSE = "</tool_call>";

export interface TextSegment {
  type: "text";
  delta: string;
}
export interface ToolCallSegment {
  type: "toolCall";
  name: string;
  arguments: Record<string, unknown>;
}
export type ParsedSegment = TextSegment | ToolCallSegment;

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

const HOLDBACK = OPEN.length - 1; // keep back a possible split `<tool_call>` tail
const CLASSIFY_MIN = 14; // chars needed to be sure a `{` is/ isn't `{"name"`/`{"arguments"`
const looksLikeToolJson = (s: string): boolean => /^\{\s*"(name|arguments)"\s*:/.test(s);

/**
 * Streaming state machine. Feed model-text chunks; collect the returned segments. After a tool call
 * is emitted, `finished` is true and further input is ignored (the caller aborts the upstream).
 */
export class ToolCallParser {
  private readonly toolNames: Set<string>;
  private mode: "text" | "tool" = "text";
  private acc = ""; // text-mode working buffer
  private toolBuf = ""; // tool-mode buffer (after a `<tool_call>` wrapper)
  private done = false;

  constructor(toolNames: Iterable<string>) {
    this.toolNames = new Set(toolNames);
  }

  get finished(): boolean {
    return this.done;
  }

  /** Feed one chunk of streamed text; returns the segments it produced (text deltas, ≤1 toolCall). */
  feed(chunk: string): ParsedSegment[] {
    if (this.done || chunk.length === 0) return [];
    const out: ParsedSegment[] = [];
    const emit = (delta: string) => {
      if (delta) out.push({ type: "text", delta });
    };

    if (this.mode === "tool") {
      this.toolBuf += chunk;
      this.tryFinalizeWrapped(out);
      return out;
    }

    this.acc += chunk;
    for (;;) {
      const openIdx = this.acc.indexOf(OPEN);
      const braceIdx = this.acc.indexOf("{");

      // No trigger → emit text minus a small holdback for a split `<tool_call>`.
      if (openIdx === -1 && braceIdx === -1) {
        const safe = Math.max(0, this.acc.length - HOLDBACK);
        emit(this.acc.slice(0, safe));
        this.acc = this.acc.slice(safe);
        return out;
      }

      // `<tool_call>` wrapper earliest → commit (any name; the wrapper is explicit intent).
      if (openIdx !== -1 && (braceIdx === -1 || openIdx < braceIdx)) {
        emit(this.acc.slice(0, openIdx));
        this.mode = "tool";
        this.toolBuf = this.acc.slice(openIdx + OPEN.length);
        this.acc = "";
        this.tryFinalizeWrapped(out);
        return out;
      }

      // A bare `{` is earliest → classify as a tool-call JSON or prose.
      const rest = this.acc.slice(braceIdx);
      if (rest.length < CLASSIFY_MIN && !rest.includes("}")) {
        emit(this.acc.slice(0, braceIdx)); // hold from the brace until we can classify
        this.acc = rest;
        return out;
      }
      if (!looksLikeToolJson(rest)) {
        emit(this.acc.slice(0, braceIdx + 1)); // prose brace → emit through it, keep scanning
        this.acc = this.acc.slice(braceIdx + 1);
        continue;
      }
      const found = tryExtractFirstJsonObject(rest);
      if (!found) {
        emit(this.acc.slice(0, braceIdx)); // tool-call JSON not complete yet → hold
        this.acc = rest;
        return out;
      }
      if (found.value && typeof found.value.name === "string" && this.toolNames.has(found.value.name)) {
        emit(this.acc.slice(0, braceIdx));
        this.finalize(found.value, out);
        return out;
      }
      emit(this.acc.slice(0, braceIdx + found.end)); // complete JSON but not a tool → text
      this.acc = this.acc.slice(braceIdx + found.end);
    }
  }

  /** Emit any held-back text at end of stream (only meaningful when no tool call was produced). */
  flush(): ParsedSegment[] {
    if (this.done) return [];
    const out: ParsedSegment[] = [];
    if (this.mode === "text" && this.acc) {
      out.push({ type: "text", delta: this.acc });
      this.acc = "";
    }
    return out;
  }

  private tryFinalizeWrapped(out: ParsedSegment[]): void {
    const found = tryExtractFirstJsonObject(this.toolBuf);
    if (found?.value && typeof found.value.name === "string") this.finalize(found.value, out);
  }

  private finalize(value: any, out: ParsedSegment[]): void {
    out.push({
      type: "toolCall",
      name: value.name,
      arguments: (value.arguments ?? {}) as Record<string, unknown>,
    });
    this.done = true;
  }
}

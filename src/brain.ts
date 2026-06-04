/**
 * Brain completion primitive — a one-shot text call to the PageSpace model brain.
 *
 * The "judgment" half of AIDD-as-harness (requirements, review, fix) is a *deterministically
 * invoked LLM step*: the harness decides when it runs and validates its output, but the model still
 * reasons. Those steps need a plain text completion (not the tool-loop streamSimple), so this posts
 * to `POST /api/v1/chat/completions` (model `ps-agent://<pageId>`) and collects the streamed text.
 *
 * The SSE-text collector is pure (unit-tested); the fetch is the live part.
 */
import type { PageSpaceConfig } from "./config.ts";

export interface BrainMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Collect the assistant text from an OpenAI-style SSE stream body. Pure. */
export function collectSseText(sse: string): string {
  let text = "";
  for (const line of sse.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    } catch {
      // keepalive / non-JSON line
    }
  }
  return text;
}

/** One-shot completion via the PageSpace brain. Returns the assistant's full text. */
export async function completeViaBrain(
  config: PageSpaceConfig,
  messages: BrainMessage[],
  opts: { signal?: AbortSignal; modelPageId?: string } = {},
): Promise<string> {
  const pageId = opts.modelPageId ?? config.modelPageId;
  if (!pageId) throw new Error("No brain model page configured (PAGESPACE_MODEL_PAGE).");
  if (!config.authToken) throw new Error("No PAGESPACE_AUTH_TOKEN configured.");

  const res = await fetch(`${config.apiUrl.replace(/\/$/, "")}/api/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.authToken}` },
    body: JSON.stringify({ model: `ps-agent://${pageId}`, stream: true, messages }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`PageSpace v1 HTTP ${res.status}: ${detail.slice(0, 500)}`);
  }
  return collectSseText(await res.text());
}

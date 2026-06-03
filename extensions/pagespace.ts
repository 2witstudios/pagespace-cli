/**
 * pagespace-cli — PageSpace-native pi companion (extension entry).
 *
 * Phase A wiring:
 *   1. Dual-mount adapter — route pi's read/write/edit/ls/find/grep by path:
 *        `<mount>/<drive>/…` -> PageSpace pages (/api/mcp/documents), else -> local fs.
 *        bash stays local. (src/ops.ts + src/resolve.ts — TODO)
 *   2. Model brain — register a `pagespace` provider whose custom streamSimple talks to
 *        POST /api/v1/chat/completions (model ps-agent://<pageId>) and keeps the whole
 *        tool loop inside pi via a prompted-tool protocol. (src/provider.ts — TODO)
 *
 * This entry currently registers a connectivity smoke-test tool so the package loads and
 * PageSpace auth can be verified from pi end-to-end. Build out 1 + 2 next (see PageSpace Tasks).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "../src/config.ts";
import { PageSpaceApi } from "../src/api.ts";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const api = new PageSpaceApi(config);

  // Smoke test: proves the scoped token + base URL reach PageSpace from inside pi.
  pi.registerTool({
    name: "pagespace_list_drives",
    label: "PageSpace: list drives",
    description:
      "List the PageSpace drives reachable with the configured scoped token. Use to confirm the PageSpace companion is wired up.",
    parameters: Type.Object({}),
    async execute() {
      if (!config.authToken) {
        return {
          content: [{ type: "text", text: "PAGESPACE_AUTH_TOKEN is not set." }],
          details: {},
          isError: true,
        };
      }
      const drives = await api.listDrives();
      const text =
        drives.map((d) => `- ${d.name} (${d.slug}) [${d.id}] role=${d.role ?? "?"}`).join("\n") ||
        "(no drives)";
      return { content: [{ type: "text", text }], details: { drives } };
    },
  });

  // TODO(1): build the dual-mount routing operations and register over read/write/edit/ls/find/grep.
  // TODO(2): pi.registerProvider("pagespace", { streamSimple: makePromptedToolStream(config), models: [...] }).
}

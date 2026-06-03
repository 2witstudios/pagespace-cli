/**
 * pagespace-cli — dual-mount adapter (pi extension entry).
 *
 * Routes pi's own read/write/edit/ls/find/grep by path: anything under the PageSpace mount
 * (`<cwd>/<PAGESPACE_MOUNT>/…`, default `<cwd>/pagespace/…`) operates on PageSpace pages;
 * everything else uses pi's normal local-fs tools. `bash` is left untouched (always local).
 *
 * Status: the page-backed operations (src/ops.ts) are verified against the live drive
 * (test/run-ops.ts). This entry wires them into pi's tools; needs a pi load to verify end to end.
 */
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createLsTool,
  createFindTool,
  createGrepTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "../src/config.ts";
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { createPageSpaceOps } from "../src/ops.ts";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const api = new PageSpaceApi(config);
  const resolver = new PageSpaceResolver(api);
  const cwd = process.cwd();
  const mountRoot = path.resolve(cwd, config.mountPrefix);
  const ops = createPageSpaceOps(api, resolver, { mountRoot });

  const routes = (params: { path?: string }): boolean =>
    ops.isMountPath(path.resolve(cwd, params?.path ?? "."));

  // Replace each built-in (same name) with a router that delegates by path: PageSpace-backed
  // when the path is under the mount, pi's local-fs tool otherwise. Registered explicitly (not
  // in a loop) so each tool keeps its concrete param type.
  {
    const local = createReadTool(cwd);
    const page = createReadTool(cwd, { operations: ops.read });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createWriteTool(cwd);
    const page = createWriteTool(cwd, { operations: ops.write });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createEditTool(cwd);
    const page = createEditTool(cwd, { operations: ops.edit });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createLsTool(cwd);
    const page = createLsTool(cwd, { operations: ops.ls });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createFindTool(cwd);
    const page = createFindTool(cwd, { operations: ops.find });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createGrepTool(cwd);
    const page = createGrepTool(cwd, { operations: ops.grep });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  // bash: intentionally left as pi's built-in (always local).

  // Connectivity smoke tool.
  pi.registerTool({
    name: "pagespace_status",
    label: "PageSpace: status",
    description: "Show the PageSpace mount + the drives this scoped token can reach.",
    parameters: Type.Object({}),
    async execute() {
      const drives = await api.listDrives();
      const text =
        `mount: ${mountRoot}\napiUrl: ${config.apiUrl}\ndefaultDrive: ${config.defaultDriveSlug ?? "(none)"}\n` +
        `drives:\n` +
        (drives.map((d) => `  - ${d.name} (${d.slug}) [${d.id}]`).join("\n") || "  (none)");
      return { content: [{ type: "text", text }], details: { drives, mountRoot } };
    },
  });

  // TODO(model provider): pi.registerProvider("pagespace", { streamSimple }) over /api/v1/chat/completions
  //   with the prompted-tool protocol (src/provider.ts) — next leaf.
}

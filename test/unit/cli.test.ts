import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildPiLaunchArgs, resolveExtensionPath, checkConfig } from "../../src/cli.ts";

test("buildPiLaunchArgs preloads the extension then passes user args through", () => {
  assert.deepEqual(buildPiLaunchArgs("/pkg/extensions/pagespace.ts", []), [
    "-e",
    "/pkg/extensions/pagespace.ts",
  ]);
  assert.deepEqual(
    buildPiLaunchArgs("/pkg/extensions/pagespace.ts", ["-p", "do a thing", "--model", "pagespace/x"]),
    ["-e", "/pkg/extensions/pagespace.ts", "-p", "do a thing", "--model", "pagespace/x"],
  );
});

test("resolveExtensionPath points at <packageRoot>/extensions/pagespace.ts from a bin/ url", () => {
  const binUrl = pathToFileURL("/some/pkg/bin/pagespace.mjs").href;
  assert.equal(resolveExtensionPath(binUrl), path.join("/some/pkg", "extensions", "pagespace.ts"));
});

test("checkConfig is ok with the token present; reports recommended-but-unset as ·", () => {
  const c = checkConfig({ PAGESPACE_AUTH_TOKEN: "mcp_x" });
  assert.equal(c.ok, true);
  assert.deepEqual(c.missing, []);
  assert.match(c.lines.join("\n"), /✓ PAGESPACE_AUTH_TOKEN/);
  assert.match(c.lines.join("\n"), /· PAGESPACE_DRIVE \(unset/);
});

test("checkConfig fails (with a hint) when the required token is missing", () => {
  const c = checkConfig({});
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, ["PAGESPACE_AUTH_TOKEN"]);
  assert.match(c.lines.join("\n"), /✗ PAGESPACE_AUTH_TOKEN/);
  assert.match(c.lines.join("\n"), /\.mcp\.json\.example/);
});

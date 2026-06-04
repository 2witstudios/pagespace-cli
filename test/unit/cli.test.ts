import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildPiLaunchArgs, resolveExtensionPath } from "../../src/cli.ts";

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

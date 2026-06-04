import { test } from "node:test";
import assert from "node:assert/strict";
import { allPass, runGate, runGates, formatGateResults } from "../../src/gate.ts";

test("allPass: empty fails; all-pass passes; any-fail fails", () => {
  assert.equal(allPass([]), false);
  assert.equal(allPass([{ command: "a", pass: true, code: 0, stdout: "", stderr: "" }]), true);
  assert.equal(
    allPass([
      { command: "a", pass: true, code: 0, stdout: "", stderr: "" },
      { command: "b", pass: false, code: 1, stdout: "", stderr: "" },
    ]),
    false,
  );
});

test("runGate: exit 0 passes, exit 1 fails (integration, no network)", async () => {
  const okGate = await runGate("exit 0", process.cwd());
  assert.equal(okGate.pass, true);
  assert.equal(okGate.code, 0);
  const badGate = await runGate("exit 1", process.cwd());
  assert.equal(badGate.pass, false);
  assert.equal(badGate.code, 1);
});

test("runGate captures stdout", async () => {
  const r = await runGate("echo hello", process.cwd());
  assert.match(r.stdout, /hello/);
});

test("runGates stops at the first failing gate", async () => {
  const { pass, results } = await runGates(["exit 0", "exit 3", "exit 0"], process.cwd());
  assert.equal(pass, false);
  assert.equal(results.length, 2); // stopped after the failure; the third never ran
  assert.equal(results[1].code, 3);
});

test("formatGateResults summarizes pass/fail", () => {
  assert.match(
    formatGateResults({
      completed: true,
      pass: true,
      results: [{ command: "npm test", pass: true, code: 0, stdout: "", stderr: "" }],
    }),
    /COMPLETED \(gate passed\)/,
  );
  assert.match(
    formatGateResults({
      completed: false,
      pass: false,
      results: [{ command: "x", pass: false, code: 2, stdout: "", stderr: "boom" }],
    }),
    /BLOCKED \(gate failed\)[\s\S]*✗ x \(exit 2\)/,
  );
  assert.match(
    formatGateResults({ completed: false, pass: false, results: [], reason: "No gate" }),
    /No gate/,
  );
});

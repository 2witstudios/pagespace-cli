import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, type DoctorCheck, formatDoctor } from "../../src/doctor.ts";

test("diagnose flags a missing token", () => {
  const r = diagnose({ apiUrl: "https://pagespace.ai", hasToken: false, hasCredentials: false });
  assert.equal(r.pass, false);
  const tokenCheck = r.checks.find((c) => c.id === "token");
  assert.ok(tokenCheck);
  assert.equal(tokenCheck?.pass, false);
  assert.ok(/token|login/i.test(tokenCheck?.remediation ?? ""), "remediation points to login");
});

test("diagnose passes when a token is present", () => {
  const r = diagnose({ apiUrl: "https://pagespace.ai", hasToken: true, hasCredentials: true });
  const tokenCheck = r.checks.find((c) => c.id === "token");
  assert.equal(tokenCheck?.pass, true);
});

test("diagnose reports credential-store presence", () => {
  const withStore = diagnose({ apiUrl: "https://pagespace.ai", hasToken: true, hasCredentials: true });
  const withoutStore = diagnose({ apiUrl: "https://pagespace.ai", hasToken: true, hasCredentials: false });
  assert.equal(withStore.checks.find((c) => c.id === "credentials")?.pass, true);
  assert.equal(withoutStore.checks.find((c) => c.id === "credentials")?.pass, false);
});

test("diagnose flags an invalid apiUrl", () => {
  const r = diagnose({ apiUrl: "not-a-url", hasToken: true });
  const urlCheck = r.checks.find((c) => c.id === "apiUrl");
  assert.equal(urlCheck?.pass, false);
});

test("diagnose defaults apiUrl to the canonical instance when omitted", () => {
  const r = diagnose({ hasToken: true });
  assert.equal(r.checks.find((c) => c.id === "apiUrl")?.pass, true);
  assert.equal(r.config.apiUrl, "https://pagespace.ai");
});

test("diagnose pass is true only when all checks pass", () => {
  const allPass = diagnose({ apiUrl: "https://pagespace.ai", hasToken: true, hasCredentials: true });
  assert.equal(allPass.pass, true);
  const oneFail = diagnose({ apiUrl: "https://pagespace.ai", hasToken: false, hasCredentials: false });
  assert.equal(oneFail.pass, false);
});

test("formatDoctor produces scannable output with ✓/✗ and remediation", () => {
  const r = diagnose({ apiUrl: "https://pagespace.ai", hasToken: false, hasCredentials: false });
  const out = formatDoctor(r);
  assert.match(out, /✗/);
  assert.match(out, /✓|·/);
  assert.match(out, /pagespace login|token/i);
});

test("formatDoctor reports all-pass cleanly", () => {
  const r = diagnose({ apiUrl: "https://pagespace.ai", hasToken: true, hasCredentials: true });
  const out = formatDoctor(r);
  assert.match(out, /✓/);
  assert.ok(!out.includes("✗"), "no failures when all pass");
});

test("non-interactive mode: diagnose never prompts (pure, returns results only)", () => {
  // The contract: diagnose() is pure and returns structured results; it never blocks on stdin.
  const r = diagnose({ apiUrl: "https://pagespace.ai", hasToken: false });
  assert.ok(Array.isArray(r.checks));
  assert.equal(r.pass, false);
  assert.ok(r.remediation.length > 0 || r.checks.some((c) => c.remediation));
});

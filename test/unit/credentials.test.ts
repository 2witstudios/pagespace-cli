import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCredentialRecord,
  parseCredentialRecord,
  credentialRecordShape,
  validateCredentialRecord,
} from "../../src/credentials.ts";

test("buildCredentialRecord shapes a token + metadata into the stored record", () => {
  const rec = buildCredentialRecord({ token: "mcp_abc", apiUrl: "https://pagespace.ai" });
  assert.equal(rec.token, "mcp_abc");
  assert.equal(rec.apiUrl, "https://pagespace.ai");
  assert.ok(rec.savedAt, "savedAt timestamp present");
  assert.match(rec.savedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("buildCredentialRecord defaults apiUrl to the canonical instance", () => {
  const rec = buildCredentialRecord({ token: "mcp_abc" });
  assert.equal(rec.apiUrl, "https://pagespace.ai");
});

test("parseCredentialRecord round-trips with buildCredentialRecord (JSON)", () => {
  const rec = buildCredentialRecord({ token: "mcp_abc", apiUrl: "https://custom.example" });
  const json = JSON.stringify(rec);
  const back = parseCredentialRecord(json);
  assert.deepEqual(back, rec);
});

test("parseCredentialRecord rejects malformed JSON", () => {
  assert.throws(() => parseCredentialRecord("not json"), /credential file/);
});

test("validateCredentialRecord accepts a well-formed record", () => {
  const rec = buildCredentialRecord({ token: "mcp_abc" });
  const errs = validateCredentialRecord(rec);
  assert.deepEqual(errs, []);
});

test("validateCredentialRecord flags a missing token", () => {
  const errs = validateCredentialRecord({ apiUrl: "https://pagespace.ai", savedAt: "x" });
  assert.ok(errs.some((e) => /token/i.test(e)));
});

test("validateCredentialRecord flags a missing apiUrl", () => {
  const errs = validateCredentialRecord({ token: "mcp_abc", savedAt: "x" });
  assert.ok(errs.some((e) => /apiUrl|api url|url/i.test(e)));
});

test("credentialRecordShape is the canonical key list", () => {
  assert.deepEqual([...credentialRecordShape].sort(), ["apiUrl", "savedAt", "token"]);
});

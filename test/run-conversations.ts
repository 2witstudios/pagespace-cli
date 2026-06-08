/**
 * Live integration test for conversation-based sessions (out of CI — needs PAGESPACE_AUTH_TOKEN +
 * PAGESPACE_DRIVE + PAGESPACE_MODEL_PAGE). Exercises listAgentConversations + getConversation and
 * the fromConversationMessages round-trip against the real API. Does not create any data.
 *
 * Run: npx tsx test/run-conversations.ts
 */
import assert from "node:assert/strict";
import { PageSpaceApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { loadDotenv } from "../src/env.ts";
import { fromConversationMessages } from "../src/provider.ts";

loadDotenv();
const config = loadConfig();
const agentPageId = config.modelPageId;
assert.ok(agentPageId && config.authToken, "PAGESPACE_MODEL_PAGE + PAGESPACE_AUTH_TOKEN required");

const api = new PageSpaceApi(config);

let pass = 0;
let total = 0;
const ok = (name: string, cond: boolean) => {
  total++;
  if (cond) pass++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
};

console.log("[1] listAgentConversations");
const convs = await api.listAgentConversations(agentPageId);
ok("returns an array", Array.isArray(convs));
if (convs.length > 0) {
  const c = convs[0];
  ok("first conv has id", typeof c.id === "string" && c.id.length > 0);
  ok("first conv has updatedAt", typeof c.updatedAt === "string");

  console.log("[2] getConversation + fromConversationMessages");
  const conv = await api.getConversation(c.id);
  ok("getConversation returns id", conv.id === c.id);
  ok("messages is array", Array.isArray(conv.messages));
  if (conv.messages.length > 0) {
    const piMessages = fromConversationMessages(conv.messages, {
      provider: "pagespace",
      modelId: agentPageId,
    });
    ok("fromConversationMessages returns non-empty array", piMessages.length > 0);
    ok("first message has role", typeof piMessages[0].role === "string");
  }
} else {
  console.log("  (no conversations yet — start a pagespace session first)");
}

console.log(`\n${pass}/${total} assertions passed`);
process.exit(pass === total ? 0 : 1);

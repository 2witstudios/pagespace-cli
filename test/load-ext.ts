// Deterministic load/wiring check: run the extension factory with a mock pi and assert it
// registers the routed tools (+ smoke tool) without throwing. Exercises real pi tool factories.
import ext from "../extensions/pagespace.ts";
const registered: string[] = [];
const providers: Array<{ name: string; config: any }> = [];
const events: string[] = [];
const mockPi: any = {
  registerTool: (t: { name: string }) => registered.push(t.name),
  on: (event: string) => events.push(event),
  registerCommand: () => {},
  registerProvider: (name: string, config: any) => providers.push({ name, config }),
  registerShortcut: () => {},
  registerFlag: () => {},
};
ext(mockPi);
const expect = ["read", "write", "edit", "ls", "find", "grep", "pagespace_status"];
const missing = expect.filter((n) => !registered.includes(n));
console.log("registered:", registered.join(", "));
if (missing.length) {
  console.log("FAIL missing:", missing.join(", "));
  process.exit(1);
}

// Provider registration is gated on PAGESPACE_MODEL_PAGE; assert it when configured.
if (process.env.PAGESPACE_MODEL_PAGE) {
  const p = providers.find((x) => x.name === "pagespace");
  const okProvider =
    !!p &&
    typeof p.config.streamSimple === "function" &&
    p.config.api === "openai-completions" &&
    Array.isArray(p.config.models) &&
    p.config.models[0]?.id === process.env.PAGESPACE_MODEL_PAGE;
  if (!okProvider) {
    console.log(
      "FAIL: pagespace provider not registered correctly:",
      JSON.stringify(p?.config && { ...p.config, streamSimple: typeof p.config.streamSimple }),
    );
    process.exit(1);
  }
  console.log("PASS: pagespace model provider registered (streamSimple, api, model id)");
} else {
  console.log("note: PAGESPACE_MODEL_PAGE unset — provider registration skipped (as designed)");
}
// Context auto-load (Epic 2) registers a before_agent_start hook when a default drive is configured.
if (process.env.PAGESPACE_DRIVE) {
  if (!events.includes("before_agent_start")) {
    console.log("FAIL: before_agent_start context hook not registered");
    process.exit(1);
  }
  console.log("PASS: before_agent_start context-injection hook registered");
} else {
  console.log("note: PAGESPACE_DRIVE unset — context hook skipped (as designed)");
}
console.log("PASS: extension loads and registers", registered.length, "tools (6 routed + smoke)");

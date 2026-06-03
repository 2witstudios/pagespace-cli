// Deterministic load/wiring check: run the extension factory with a mock pi and assert it
// registers the routed tools (+ smoke tool) without throwing. Exercises real pi tool factories.
import ext from "../extensions/pagespace.ts";
const registered: string[] = [];
const mockPi: any = {
  registerTool: (t: { name: string }) => registered.push(t.name),
  on: () => {},
  registerCommand: () => {},
  registerProvider: () => {},
  registerShortcut: () => {},
  registerFlag: () => {},
};
ext(mockPi);
const expect = ["read", "write", "edit", "ls", "find", "grep", "pagespace_status"];
const missing = expect.filter((n) => !registered.includes(n));
console.log("registered:", registered.join(", "));
if (missing.length) { console.log("FAIL missing:", missing.join(", ")); process.exit(1); }
console.log("PASS: extension loads and registers", registered.length, "tools (6 routed + smoke)");

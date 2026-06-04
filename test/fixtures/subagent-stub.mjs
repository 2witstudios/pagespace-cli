// Test stub standing in for a `pi --mode json` child: emits one assistant message_end whose text
// echoes the last CLI argument, or exits nonzero when passed --fail. No model, deterministic.
const args = process.argv.slice(2);
if (args.includes("--fail")) {
  process.stderr.write("stub failure\n");
  process.exit(1);
}
const last = args[args.length - 1] ?? "";
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: `echo: ${last}` }],
    stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  },
};
process.stdout.write(`${JSON.stringify(event)}\n`);

import z from "zod";
import { ToolRegistry, ToolDef, ToolContext, ExecuteResult } from "../tool-lib/src/index";

// Define a simple tool
const HelloTool: ToolDef = {
  id: "hello",
  description: "Greets the user",
  parameters: z.object({
    name: z.string(),
  }),
  async execute(args, ctx) {
    console.log(`[Tool Log] Executing hello for session ${ctx.sessionID}`);
    return {
      title: "Greeting",
      output: `Hello, ${args.name}!`,
      metadata: {},
    };
  },
};

async function main() {
  const registry = new ToolRegistry();
  registry.register(HelloTool);

  const ctx: ToolContext = {
    sessionID: "session-123",
    messageID: "msg-456",
    agent: "assistant",
  };

  try {
    console.log("Calling hello tool with correct args...");
    const result = await registry.execute("hello", { name: "Alice" }, ctx);
    console.log("Result:", result.output);

    console.log("\nCalling hello tool with incorrect args...");
    await registry.execute("hello", { age: 30 }, ctx);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();

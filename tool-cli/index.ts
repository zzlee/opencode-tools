import { ToolRegistry } from "../tool-lib/src/index.ts";
import type { ToolDef, ToolContext } from "../tool-lib/src/index.ts";
import { ReadTool, BashTool, GlobTool, EditTool, GrepTool, WriteTool } from "../tool-lib/src/index.ts";
import * as fs from "node:fs/promises";

async function main() {
  const registry = new ToolRegistry();
  registry.register(ReadTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(EditTool);
  registry.register(GrepTool);
  registry.register(WriteTool);

  const ctx: ToolContext = {
    sessionID: "session-123",
    messageID: "msg-456",
    agent: "assistant",
  };

  try {
    console.log("--- Testing WriteTool ---");
    const testFile = "test_write.txt";
    await registry.execute("write", { 
      filePath: testFile, 
      content: "Hello from WriteTool!" 
    }, ctx);
    console.log(`Wrote ${testFile}`);

    console.log("\n--- Testing GlobTool ---");
    const globResult = await registry.execute("glob", { 
      pattern: "*.txt" 
    }, ctx);
    console.log("Glob output:\n", globResult.output);

    console.log("\n--- Testing GrepTool ---");
    const grepResult = await registry.execute("grep", { 
      pattern: "Hello" 
    }, ctx);
    console.log("Grep output:\n", grepResult.output);

    console.log("\n--- Testing EditTool ---");
    await registry.execute("edit", { 
      filePath: testFile, 
      oldString: "Hello from WriteTool!", 
      newString: "Hello from EditTool!" 
    }, ctx);
    const editedContent = await fs.readFile(testFile, "utf8");
    console.log(`Edited content: ${editedContent}`);

    // Cleanup
    await fs.unlink(testFile);
    console.log("\nCleanup successful");

  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main();

import OpenAI from "openai";
import * as fs from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import "dotenv/config";
import chalk from "chalk";
import ora from "ora";
import { 
  ToolRegistry, 
  ReadTool, 
  BashTool, 
  GlobTool, 
  EditTool, 
  GrepTool, 
  WriteTool, 
} from "../tool-lib/src/index.ts";
import type { ToolContext } from "../tool-lib/src/index.ts";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY environment variable");
    process.exit(1);
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: baseUrl,
  });

  const registry = new ToolRegistry();
  registry.register(ReadTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(EditTool);
  registry.register(GrepTool);
  registry.register(WriteTool);

  const tools: any[] = registry.listTools().map(t => ({
    type: "function",
    function: {
      name: t.id,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters as any),
    },
  }));

  const defaultPrompt = await fs.readFile("./default.txt", "utf8");
  const toolDescriptions = tools
    .map(t => `${t.function.name}: ${t.function.description}`)
    .join("\n");

  const systemPrompt = `${defaultPrompt}\n\nAvailable Tools:\n${toolDescriptions}`;

  const userQuery = process.argv.slice(2).join(" ");
  if (!userQuery) {
    console.error("Please provide a query as a command line argument");
    process.exit(1);
  }

  let messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userQuery },
  ];

  const ctx: ToolContext = {
    sessionID: "session-123",
    messageID: "msg-456",
    agent: "assistant",
  };

  while (true) {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: messages,
      tools: tools,
    });

    const message = response.choices[0].message;
    messages.push(message);

    // Handle explicit reasoning_content (e.g., DeepSeek R1)
    if ((message as any).reasoning_content) {
      console.log(chalk.gray((message as any).reasoning_content));
    }

    if (message.content) {
      // Fallback: if tool_calls are present, treat content as reasoning
      if (message.tool_calls) {
        console.log(chalk.gray(message.content));
      } else {
        console.log(message.content);
      }
    }

    if (!message.tool_calls) {
      break;
    }

    for (const toolCall of (message.tool_calls || []) as any[]) {
      const toolId = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      
      const spinner = ora(`Executing ${chalk.cyan(toolId)}...`).start();
      try {
        const result = await registry.execute(toolId, args, ctx);
        spinner.succeed(`Executed ${chalk.cyan(toolId)}`);
        console.log(chalk.dim(`${result.output.substring(0, 500)}${result.output.length > 500 ? "..." : ""}`));
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.output,
        });
      } catch (e: any) {
        spinner.fail(`Error executing ${chalk.cyan(toolId)}`);
        console.log(chalk.red(`Error: ${e.message}`));
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error executing tool ${toolId}: ${e.message}`,
        });
      }
    }
  }
}

main().catch(console.error);

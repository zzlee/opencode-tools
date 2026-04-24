import { GoogleGenAI } from "@google/genai";
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
  ApplyPatchTool,
} from "../tool-lib/src/index.ts";
import type { ToolContext } from "../tool-lib/src/index.ts";

async function main() {
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    console.error("Missing AI_API_KEY environment variable");
    process.exit(1);
  }

  const ai = new GoogleGenAI({
    apiKey: apiKey,
  });

  const registry = new ToolRegistry();
  registry.register(ReadTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(EditTool);
  registry.register(GrepTool);
  registry.register(WriteTool);
  registry.register(ApplyPatchTool);

  const tools: any[] = [{
    functionDeclarations: registry.listTools().map(t => ({
      name: t.id,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters as any),
    }))
  }];

  const defaultPrompt = await fs.readFile("./default.txt", "utf8");
  const toolDescriptions = registry.listTools()
    .map(t => `${t.id}: ${t.description}`)
    .join("\n");

  const systemPrompt = `${defaultPrompt}\n\nAvailable Tools:\n${toolDescriptions}`;

  const userQuery = process.argv.slice(2).join(" ");
  if (!userQuery) {
    console.error("Please provide a query as a command line argument");
    process.exit(1);
  }

  let messages: any[] = [
    { role: "user", parts: [{ text: userQuery }] },
  ];

  const ctx: ToolContext = {
    sessionID: "session-123",
    messageID: "msg-456",
    agent: "assistant",
  };

  while (true) {
    let response;
    let retries = 0;
    const maxRetries = 3;

    while (true) {
      try {
        response = await ai.models.generateContent({
          model: process.env.AI_MODEL || "gemini-2.5-flash",
          contents: messages,
          config: {
            tools: tools,
            systemInstruction: { parts: [{ text: systemPrompt }] }
          }
        });
        break;
      } catch (e: any) {
        if (e.status && retries < maxRetries) {
          retries++;
          console.log(chalk.yellow(`API Error ${e.status}, retrying in 3s... (${retries}/${maxRetries})`));
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        if (e.status) {
          try {
            const parsed = JSON.parse(e.message);
            console.error(chalk.red(`API Error ${parsed.error.code}: ${parsed.error.message}`));
          } catch {
            console.error(chalk.red(`API Error ${e.status}: ${e.message}`));
          }
        } else {
          console.error(chalk.red(`Error: ${e.message}`));
        }
        process.exit(1);
      }
    }

    const message = response.candidates![0].content!;
    messages.push(message);

    const toolCalls = response.functionCalls || [];

    for (const part of message.parts || []) {
      if (part.text) {
        if (part.thought) {
          console.log(chalk.gray(part.text));
        } else if (toolCalls.length > 0) {
          console.log(chalk.yellow(part.text));
        } else {
          console.log(part.text);
        }
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    const functionResponseParts: any[] = [];

    for (const toolCall of toolCalls) {
      const toolId = toolCall.name!;
      const args = toolCall.args || {};
      
      const spinner = ora(`Executing ${chalk.cyan(toolId)}...`).start();
      try {
        const result = await registry.execute(toolId, args as any, ctx);
        spinner.succeed(`Executed ${chalk.cyan(toolId)}`);
        console.log(chalk.blue(`${result.output.substring(0, 500)}${result.output.length > 500 ? "..." : ""}`));
        
        functionResponseParts.push({
          functionResponse: {
            name: toolId,
            response: { output: result.output }
          }
        });
      } catch (e: any) {
        spinner.fail(`Error executing ${chalk.cyan(toolId)}`);
        console.log(chalk.red(`Error: ${e.message}`));
        
        functionResponseParts.push({
          functionResponse: {
            name: toolId,
            response: { error: e.message }
          }
        });
      }
    }

    if (functionResponseParts.length > 0) {
      messages.push({
        role: "user",
        parts: functionResponseParts,
      });
    }
  }
}

main().catch(console.error);

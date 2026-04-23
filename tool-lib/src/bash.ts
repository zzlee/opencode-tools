import z from "zod";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { ToolDef, ToolContext, ExecuteResult } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_TIMEOUT = 120000;
const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2000;

const Parameters = z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  workdir: z
    .string()
    .describe("The working directory to run the command in. Defaults to the current directory.")
    .optional(),
  description: z
    .string()
    .describe("Clear, concise description of what this command does"),
});

function loadDescription() {
  try {
    let desc = fs.readFileSync(path.join(__dirname, "bash.txt"), "utf8");
    
    const chaining = process.platform === "win32"
      ? "If the commands depend on each other and must run sequentially, avoid '&&' in this shell because Windows PowerShell 5.1 does not support it. Use PowerShell conditionals such as `cmd1; if ($?) { cmd2 }` when later commands must depend on earlier success."
      : "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.";

    return desc
      .replace("${os}", process.platform)
      .replace("${shell}", process.platform === "win32" ? "powershell" : "bash")
      .replace("${maxLines}", String(MAX_LINES))
      .replace("${maxBytes}", String(MAX_BYTES))
      .replace("${chaining}", chaining);
  } catch (e) {
    return "Execute a bash command in the system shell";
  }
}

export const BashTool: ToolDef = {
  id: "bash",
  description: loadDescription(),
  parameters: Parameters,
  async execute(params, ctx) {


    const timeout = params.timeout ?? DEFAULT_TIMEOUT;
    const cwd = params.workdir ?? process.cwd();
    
    return new Promise((resolve, reject) => {
      const child = spawn(params.command, {
        shell: true,
        cwd,
        env: process.env,
      });

      let output = "";
      let stderr = "";
      let cut = false;

      const onData = (data: Buffer) => {
        const text = data.toString();
        if (Buffer.byteLength(output + text, "utf8") > MAX_BYTES) {
          cut = true;
        }
        output += text;
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        
        let finalOutput = output || "(no output)";
        if (cut) {
          finalOutput = `...output truncated...\n\n${finalOutput.slice(-MAX_BYTES)}`;
        }

        resolve({
          title: params.description,
          output: finalOutput,
          metadata: {
            exit: code,
            truncated: cut,
          },
        });
      });
    });
  },
};

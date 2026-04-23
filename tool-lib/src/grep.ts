import z from "zod";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDef, ToolContext, ExecuteResult } from "./types.ts";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parameters = z.object({
  pattern: z.string().describe("The regex pattern to search for in file contents"),
  path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
  include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
});

function loadDescription() {
  try {
    return fs.readFileSync(path.join(__dirname, "grep.txt"), "utf8");
  } catch (e) {
    return "Fast content search tool";
  }
}

export const GrepTool: ToolDef = {
  id: "grep",
  description: loadDescription(),
  parameters,
  async execute(params, ctx) {
    const searchDir = params.path ?? process.cwd();
    const absoluteSearchDir = path.isAbsolute(searchDir) 
      ? searchDir 
      : path.resolve(process.cwd(), searchDir);

    // Use ripgrep (rg) if available, otherwise fallback to a simpler search
    // For a standalone lib, we'll assume rg is installed on the system as per opencode's design
    const includeFlag = params.include ? `-g "${params.include}"` : "";
    const cmd = `rg --vimgrep ${includeFlag} "${params.pattern}" "${absoluteSearchDir}"`;

    try {
      const output = execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 }).trim();
      if (!output) {
        return {
          title: params.pattern,
          output: "No files found",
          metadata: { matches: 0, truncated: false },
        };
      }

      const lines = output.split("\n");
      const matches = lines.map(line => {
        const [filePath, lineNum, ...textParts] = line.split(":");
        return {
          path: filePath,
          line: parseInt(lineNum),
          text: textParts.join(":"),
        };
      });

      const limit = 100;
      const truncated = matches.length > limit;
      const final = truncated ? matches.slice(0, limit) : matches;

      const outputLines = [`Found ${matches.length} matches${truncated ? ` (showing first ${limit})` : ""}`];
      let currentFile = "";
      for (const match of final) {
        if (currentFile !== match.path) {
          if (currentFile !== "") outputLines.push("");
          currentFile = match.path;
          outputLines.push(`${match.path}:`);
        }
        outputLines.push(`  Line ${match.line}: ${match.text}`);
      }

      if (truncated) {
        outputLines.push("");
        outputLines.push(`(Results truncated: showing ${limit} of ${matches.length} matches)`);
      }

      return {
        title: params.pattern,
        output: outputLines.join("\n"),
        metadata: {
          matches: matches.length,
          truncated,
        },
      };
    } catch (e: any) {
      if (e.stderr && e.stderr.toString().includes("No matches found")) {
        return {
          title: params.pattern,
          output: "No files found",
          metadata: { matches: 0, truncated: false },
        };
      }
      throw new Error(`Grep failed: ${e.message}`);
    }
  },
};

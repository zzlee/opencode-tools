import z from "zod";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDef, ToolContext, ExecuteResult } from "./types.ts";
import { globSync } from "glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parameters = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z
    .string()
    .optional()
    .describe(
      `The directory to search in. If not specified, the current working directory will be used.`,
    ),
});

function loadDescription() {
  try {
    return fs.readFileSync(path.join(__dirname, "glob.txt"), "utf8");
  } catch (e) {
    return "Fast file pattern matching tool";
  }
}

export const GlobTool: ToolDef = {
  id: "glob",
  description: loadDescription(),
  parameters,
  async execute(params, ctx) {
    const searchDir = params.path ?? process.cwd();
    const absoluteSearchDir = path.isAbsolute(searchDir) 
      ? searchDir 
      : path.resolve(process.cwd(), searchDir);

    const stats = await fsPromises.stat(absoluteSearchDir);
    if (!stats.isDirectory()) {
      throw new Error(`glob path must be a directory: ${absoluteSearchDir}`);
    }

    const files = globSync(params.pattern, { 
      cwd: absoluteSearchDir, 
      absolute: true,
      nodir: true 
    });

    const fileInfos = await Promise.all(
      files.map(async (filePath) => {
        try {
          const stat = await fsPromises.stat(filePath);
          return { path: filePath, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      })
    );

    const validFiles = fileInfos.filter((f): f is { path: string; mtime: number } => f !== null);
    validFiles.sort((a, b) => b.mtime - a.mtime);

    const limit = 100;
    const truncated = validFiles.length > limit;
    const finalFiles = truncated ? validFiles.slice(0, limit) : validFiles;

    const output = [];
    if (finalFiles.length === 0) {
      output.push("No files found");
    } else {
      output.push(...finalFiles.map(f => f.path));
      if (truncated) {
        output.push("");
        output.push(`(Results are truncated: showing first ${limit} results.)`);
      }
    }

    return {
      title: path.relative(process.cwd(), absoluteSearchDir),
      output: output.join("\n"),
      metadata: {
        count: validFiles.length,
        truncated,
      },
    };
  },
};

import z from "zod";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDef, ToolContext, ExecuteResult } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parameters = z.object({
  content: z.string().describe("The content to write to the file"),
  filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
});

function loadDescription() {
  try {
    return fs.readFileSync(path.join(__dirname, "write.txt"), "utf8");
  } catch (e) {
    return "Writes a file to the local filesystem.";
  }
}

export const WriteTool: ToolDef = {
  id: "write",
  description: loadDescription(),
  parameters,
  async execute(params, ctx) {
    const filePath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath);

    // Ensure directory exists
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });

    await fsPromises.writeFile(filePath, params.content, "utf8");

    return {
      title: path.relative(process.cwd(), filePath),
      output: "Wrote file successfully.",
      metadata: {
        filepath: filePath,
      },
    };
  },
};

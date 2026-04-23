import z from "zod";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createTwoFilesPatch, diffLines } from "diff";
import type { ToolDef, ToolContext, ExecuteResult } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const Parameters = z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z.string().describe("The text to replace it with (must be different from oldString)"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
});

function loadDescription() {
  try {
    return fs.readFileSync(path.join(__dirname, "edit.txt"), "utf8");
  } catch (e) {
    return "Performs exact string replacements in files.";
  }
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\\r\\n", "\\n");
}

function detectLineEnding(text: string): "\\n" | "\\r\\n" {
  return text.includes("\\r\\n") ? "\\r\\n" : "\\n";
}

function convertToLineEnding(text: string, ending: "\\n" | "\\r\\n"): string {
  if (ending === "\\n") return text;
  return text.replaceAll("\\n", "\\r\\n");
}

function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.");
  }

  // This is a simplified version of the complex multi-replacer logic in opencode
  // It focuses on exact match and replaceAll
  if (content.includes(oldString)) {
    if (replaceAll) {
      return content.replaceAll(oldString, newString);
    }
    const index = content.indexOf(oldString);
    const lastIndex = content.lastIndexOf(oldString);
    if (index !== lastIndex) {
      throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.");
    }
    return content.substring(0, index) + newString + content.substring(index + oldString.length);
  }

  throw new Error("Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.");
}

export const EditTool: ToolDef = {
  id: "edit",
  description: loadDescription(),
  parameters: Parameters,
  async execute(params, ctx) {
    if (params.oldString === params.newString) {
      throw new Error("No changes to apply: oldString and newString are identical.");
    }

    const filePath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath);

    const contentOld = await fsPromises.readFile(filePath, "utf8");
    const ending = detectLineEnding(contentOld);
    const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending);
    const replacement = convertToLineEnding(normalizeLineEndings(params.newString), ending);

    const contentNew = replace(contentOld, old, replacement, params.replaceAll);
    const diff = createTwoFilesPatch(filePath, filePath, contentOld, contentNew);

    await fsPromises.writeFile(filePath, contentNew, "utf8");

    let additions = 0;
    let deletions = 0;
    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) additions += change.count || 0;
      if (change.removed) deletions += change.count || 0;
    }

    return {
      title: path.relative(process.cwd(), filePath),
      output: "Edit applied successfully.",
      metadata: {
        diff,
        additions,
        deletions,
      },
    };
  },
};

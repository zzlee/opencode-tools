import z from "zod";
import * as path from "path";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { createTwoFilesPatch, diffLines } from "diff";
import type { ToolDef, ToolContext } from "./types.ts";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple BOM utility
const Bom = {
  split(content: string) {
    if (content.startsWith("\uFEFF")) {
      return { text: content.slice(1), bom: true };
    }
    return { text: content, bom: false };
  },
  join(text: string, bom: boolean) {
    return bom ? "\uFEFF" + text : text;
  },
};

// Schema definitions
const parameters = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
});

export type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; move_path?: string; chunks: UpdateFileChunk[] };

export interface UpdateFileChunk {
  old_lines: string[];
  new_lines: string[];
  change_context?: string;
  is_end_of_file?: boolean;
}

// Parser implementation
function parsePatchHeader(lines: string[], startIdx: number): { filePath: string; movePath?: string; nextIdx: number } | null {
  const line = lines[startIdx];
  if (line.startsWith("*** Add File:")) {
    const filePath = line.slice("*** Add File:".length).trim();
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null;
  }
  if (line.startsWith("*** Delete File:")) {
    const filePath = line.slice("*** Delete File:".length).trim();
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null;
  }
  if (line.startsWith("*** Update File:")) {
    const filePath = line.slice("*** Update File:".length).trim();
    let movePath: string | undefined;
    let nextIdx = startIdx + 1;
    if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
      movePath = lines[nextIdx].slice("*** Move to:".length).trim();
      nextIdx++;
    }
    return filePath ? { filePath, movePath, nextIdx } : null;
  }
  return null;
}

function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
  const chunks: UpdateFileChunk[] = [];
  let i = startIdx;
  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("@@")) {
      const contextLine = lines[i].substring(2).trim();
      i++;
      const oldLines: string[] = [];
      const newLines: string[] = [];
      let isEndOfFile = false;
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
        const changeLine = lines[i];
        if (changeLine === "*** End of File") {
          isEndOfFile = true;
          i++;
          break;
        }
        if (changeLine.startsWith(" ")) {
          const content = changeLine.substring(1);
          oldLines.push(content);
          newLines.push(content);
        } else if (changeLine.startsWith("-")) {
          oldLines.push(changeLine.substring(1));
        } else if (changeLine.startsWith("+")) {
          newLines.push(changeLine.substring(1));
        }
        i++;
      }
      chunks.push({
        old_lines: oldLines,
        new_lines: newLines,
        change_context: contextLine || undefined,
        is_end_of_file: isEndOfFile || undefined,
      });
    } else {
      i++;
    }
  }
  return { chunks, nextIdx: i };
}

function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
  let content = "";
  let i = startIdx;
  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("+")) {
      content += lines[i].substring(1) + "\n";
    }
    i++;
  }
  if (content.endsWith("\n")) {
    content = content.slice(0, -1);
  }
  return { content, nextIdx: i };
}

function stripHeredoc(input: string): string {
  const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
  if (heredocMatch) {
    return heredocMatch[2];
  }
  return input;
}

export function parsePatch(patchText: string): { hunks: Hunk[] } {
  const cleaned = stripHeredoc(patchText.trim());
  const lines = cleaned.split("\n");
  const hunks: Hunk[] = [];
  const beginMarker = "*** Begin Patch";
  const endMarker = "*** End Patch";
  const beginIdx = lines.findIndex((line) => line.trim() === beginMarker);
  const endIdx = lines.findIndex((line) => line.trim() === endMarker);
  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new Error("Invalid patch format: missing Begin/End markers");
  }
  let i = beginIdx + 1;
  while (i < endIdx) {
    const header = parsePatchHeader(lines, i);
    if (!header) {
      i++;
      continue;
    }
    if (lines[i].startsWith("*** Add File:")) {
      const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx);
      hunks.push({ type: "add", path: header.filePath, contents: content });
      i = nextIdx;
    } else if (lines[i].startsWith("*** Delete File:")) {
      hunks.push({ type: "delete", path: header.filePath });
      i = header.nextIdx;
    } else if (lines[i].startsWith("*** Update File:")) {
      const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx);
      hunks.push({ type: "update", path: header.filePath, move_path: header.movePath, chunks });
      i = nextIdx;
    } else {
      i++;
    }
  }
  return { hunks };
}

function normalizeUnicode(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

function tryMatch(lines: string[], pattern: string[], startIndex: number, compare: (a: string, b: string) => boolean, eof: boolean): number {
  if (eof) {
    const fromEnd = lines.length - pattern.length;
    if (fromEnd >= startIndex) {
      let matches = true;
      for (let j = 0; j < pattern.length; j++) {
        if (!compare(lines[fromEnd + j], pattern[j])) {
          matches = false;
          break;
        }
      }
      if (matches) return fromEnd;
    }
  }
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true;
    for (let j = 0; j < pattern.length; j++) {
      if (!compare(lines[i + j], pattern[j])) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return -1;
}

function seekSequence(lines: string[], pattern: string[], startIndex: number, eof = false): number {
  if (pattern.length === 0) return -1;
  const exact = tryMatch(lines, pattern, startIndex, (a, b) => a === b, eof);
  if (exact !== -1) return exact;
  const rstrip = tryMatch(lines, pattern, startIndex, (a, b) => a.trimEnd() === b.trimEnd(), eof);
  if (rstrip !== -1) return rstrip;
  const trim = tryMatch(lines, pattern, startIndex, (a, b) => a.trim() === b.trim(), eof);
  if (trim !== -1) return trim;
  const normalized = tryMatch(lines, pattern, startIndex, (a, b) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()), eof);
  return normalized;
}

function computeReplacements(originalLines: string[], filePath: string, chunks: UpdateFileChunk[]): Array<[number, number, string[]]> {
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;
  for (const chunk of chunks) {
    if (chunk.change_context) {
      const contextIdx = seekSequence(originalLines, [chunk.change_context], lineIndex);
      if (contextIdx === -1) throw new Error(`Failed to find context '${chunk.change_context}' in ${filePath}`);
      lineIndex = contextIdx + 1;
    }
    if (chunk.old_lines.length === 0) {
      const insertionIdx = originalLines.length > 0 && originalLines[originalLines.length - 1] === "" ? originalLines.length - 1 : originalLines.length;
      replacements.push([insertionIdx, 0, chunk.new_lines]);
      continue;
    }
    let pattern = chunk.old_lines;
    let newSlice = chunk.new_lines;
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file);
    if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") newSlice = newSlice.slice(0, -1);
      found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file);
    }
    if (found !== -1) {
      replacements.push([found, pattern.length, newSlice]);
      lineIndex = found + pattern.length;
    } else {
      throw new Error(`Failed to find expected lines in ${filePath}:\\n${chunk.old_lines.join("\\n")}`);
    }
  }
  replacements.sort((a, b) => a[0] - b[0]);
  return replacements;
}

function applyReplacements(lines: string[], replacements: Array<[number, number, string[]]>): string[] {
  const result = [...lines];
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [startIdx, oldLen, newSegment] = replacements[i];
    result.splice(startIdx, oldLen);
    for (let j = 0; j < newSegment.length; j++) result.splice(startIdx + j, 0, newSegment[j]);
  }
  return result;
}

function generateUnifiedDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  let diff = "@@ -1 +1 @@\\n";
  const maxLen = Math.max(oldLines.length, newLines.length);
  let hasChanges = false;
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || "";
    const newLine = newLines[i] || "";
    if (oldLine !== newLine) {
      if (oldLine) diff += `-${oldLine}\\n`;
      if (newLine) diff += `+${newLine}\\n`;
      hasChanges = true;
    } else if (oldLine) {
      diff += ` ${oldLine}\\n`;
    }
  }
  return hasChanges ? diff : "";
}

function loadDescription() {
  try {
    return fs.readFileSync(path.join(__dirname, "apply_patch.txt"), "utf8");
  } catch (e) {
    return "Use the apply_patch tool to edit files.";
  }
}

export const ApplyPatchTool: ToolDef = {
  id: "apply_patch",
  description: loadDescription(),
  parameters,
  async execute(params, ctx) {
    if (!params.patchText) throw new Error("patchText is required");
    let hunks: Hunk[];
    try {
      const parseResult = parsePatch(params.patchText);
      hunks = parseResult.hunks;
    } catch (error: any) {
      throw new Error(`apply_patch verification failed: ${error.message}`);
    }
    if (hunks.length === 0) {
      const normalized = params.patchText.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n").trim();
      if (normalized === "*** Begin Patch\\n*** End Patch") throw new Error("patch rejected: empty patch");
      throw new Error("apply_patch verification failed: no hunks found");
    }
    const fileChanges: Array<{ filePath: string; oldContent: string; newContent: string; type: "add" | "update" | "delete" | "move"; movePath?: string; diff: string; additions: number; deletions: number; bom: boolean }> = [];
    let totalDiff = "";
    for (const hunk of hunks) {
      const filePath = path.resolve(process.cwd(), hunk.path);
      switch (hunk.type) {
        case "add": {
          const oldContent = "";
          const newContent = hunk.contents.length === 0 || hunk.contents.endsWith("\\n") ? hunk.contents : `${hunk.contents}\\n`;
          const next = Bom.split(newContent);
          const diff = createTwoFilesPatch(filePath, filePath, oldContent, next.text);
          let additions = 0, deletions = 0;
          for (const change of diffLines(oldContent, next.text)) {
            if (change.added) additions += change.count || 0;
            if (change.removed) deletions += change.count || 0;
          }
          fileChanges.push({ filePath, oldContent, newContent: next.text, type: "add", diff, additions, deletions, bom: next.bom });
          totalDiff += diff + "\\n";
          break;
        }
        case "update": {
          const source = Bom.split(await fsPromises.readFile(filePath, "utf-8"));
          const oldContent = source.text;
          let newContent = oldContent;
          let bom = source.bom;
          try {
            const originalLines = oldContent.split("\\n");
            if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") originalLines.pop();
            const replacements = computeReplacements(originalLines, filePath, hunk.chunks);
            const replacedLines = applyReplacements(originalLines, replacements);
            newContent = (replacedLines.length === 0 || replacedLines[replacedLines.length - 1] !== "" ? [...replacedLines, ""] : replacedLines).join("\\n");
            bom = source.bom;
          } catch (error: any) {
            throw new Error(`apply_patch verification failed: ${error.message}`);
          }
          const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent);
          let additions = 0, deletions = 0;
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0;
            if (change.removed) deletions += change.count || 0;
          }
          const movePath = hunk.move_path ? path.resolve(process.cwd(), hunk.move_path) : undefined;
          fileChanges.push({ filePath, oldContent, newContent, type: hunk.move_path ? "move" : "update", movePath, diff, additions, deletions, bom });
          totalDiff += diff + "\\n";
          break;
        }
        case "delete": {
          const source = Bom.split(await fsPromises.readFile(filePath, "utf-8"));
          const contentToDelete = source.text;
          const deleteDiff = createTwoFilesPatch(filePath, filePath, contentToDelete, "");
          const deletions = contentToDelete.split("\\n").length;
          fileChanges.push({ filePath, oldContent: contentToDelete, newContent: "", type: "delete", diff: deleteDiff, additions: 0, deletions, bom: source.bom });
          totalDiff += deleteDiff + "\\n";
          break;
        }
      }
    }
    const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = [];
    for (const change of fileChanges) {
      const target = change.type === "delete" ? change.filePath : (change.movePath ?? change.filePath);
      switch (change.type) {
        case "add":
          await fsPromises.mkdir(path.dirname(target), { recursive: true });
          await fsPromises.writeFile(target, Bom.join(change.newContent, change.bom), "utf-8");
          updates.push({ file: target, event: "add" });
          break;
        case "update":
          await fsPromises.writeFile(target, Bom.join(change.newContent, change.bom), "utf-8");
          updates.push({ file: target, event: "change" });
          break;
        case "move":
          if (change.movePath) {
            await fsPromises.mkdir(path.dirname(change.movePath), { recursive: true });
            await fsPromises.writeFile(change.movePath, Bom.join(change.newContent, change.bom), "utf-8");
            await fsPromises.unlink(change.filePath);
            updates.push({ file: change.filePath, event: "unlink" });
            updates.push({ file: change.movePath, event: "add" });
          }
          break;
        case "delete":
          await fsPromises.unlink(target);
          updates.push({ file: target, event: "unlink" });
          break;
      }
    }
    const summaryLines = fileChanges.map((change) => {
      const rel = path.relative(process.cwd(), change.type === "delete" ? change.filePath : (change.movePath ?? change.filePath)).replaceAll("\\", "/");
      if (change.type === "add") return `A ${rel}`;
      if (change.type === "delete") return `D ${rel}`;
      return `M ${rel}`;
    });
    return { 
      title: "Apply Patch",
      output: `Success. Updated the following files:\\n${summaryLines.join("\\n")}`,
      metadata: {}
    };
  }
};

import z from "zod";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ToolDef, ToolContext, ExecuteResult } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;

const parameters = z.object({
  filePath: z.string().describe("The absolute path to the file or directory to read"),
  offset: z.coerce.number().describe("The line number to start reading from (1-indexed)").optional(),
  limit: z.coerce.number().describe("The maximum number of lines to read (defaults to 2000)").optional(),
});

function loadDescription() {
  try {
    return fs.readFileSync(path.join(__dirname, "read.txt"), "utf8");
  } catch (e) {
    return "Read a file or directory from the local filesystem.";
  }
}

export const ReadTool: ToolDef = {
  id: "read",
  description: loadDescription(),
  parameters,
  async execute(params, ctx) {


    if (params.offset !== undefined && params.offset < 1) {
      throw new Error("offset must be greater than or equal to 1");
    }

    let filePath = params.filePath;
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(process.cwd(), filePath);
    }

    try {
      const stats = await fsPromises.stat(filePath);

      if (stats.isDirectory()) {
        const items = await fsPromises.readdir(filePath);
        const limit = params.limit ?? DEFAULT_READ_LIMIT;
        const offset = params.offset ?? 1;
        const start = offset - 1;
        const sliced = items.slice(start, start + limit);
        const truncated = start + sliced.length < items.length;

        return {
          title: filePath,
          output: [
            `<path>${filePath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            truncated,
          },
        };
      }

      // Binary check
      const handle = await fsPromises.open(filePath, "r");
      const sample = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(sample, 0, 4096, 0);
      await handle.close();
      if (isBinaryFile(sample.subarray(0, bytesRead))) {
        throw new Error(`Cannot read binary file: ${filePath}`);
      }

      const fileData = await readLines(filePath, {
        limit: params.limit ?? DEFAULT_READ_LIMIT,
        offset: params.offset ?? 1,
      });

      if (fileData.count < fileData.offset && !(fileData.count === 0 && fileData.offset === 1)) {
        throw new Error(`Offset ${fileData.offset} is out of range for this file (${fileData.count} lines)`);
      }

      let output = [`<path>${filePath}</path>`, `<type>file</type>`, "<content>\n"].join("\n");
      output += fileData.raw.map((line, i) => `${i + fileData.offset}: ${line}`).join("\n");

      const last = fileData.offset + fileData.raw.length - 1;
      const next = last + 1;
      const truncated = fileData.more || fileData.cut;

      if (fileData.cut) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${fileData.offset}-${last}. Use offset=${next} to continue.)`;
      } else if (fileData.more) {
        output += `\n\n(Showing lines ${fileData.offset}-${last} of ${fileData.count}. Use offset=${next} to continue.)`;
      } else {
        output += `\n\n(End of file - total ${fileData.count} lines)`;
      }
      output += "\n</content>";

      return {
        title: filePath,
        output,
        metadata: {
          truncated,
        },
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  },
};

function isBinaryFile(bytes: Buffer) {
  if (bytes.length === 0) return false;
  let nonPrintableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++;
    }
  }
  return nonPrintableCount / bytes.length > 0.3;
}

async function readLines(filePath: string, opts: { limit: number; offset: number }) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const start = opts.offset - 1;
  const raw: string[] = [];
  let bytes = 0;
  let count = 0;
  let cut = false;
  let more = false;

  try {
    for await (const text of rl) {
      count += 1;
      if (count <= start) continue;

      if (raw.length >= opts.limit) {
        more = true;
        continue;
      }

      const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text;
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0);
      if (bytes + size > MAX_BYTES) {
        cut = true;
        more = true;
        break;
      }

      raw.push(line);
      bytes += size;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { raw, count, cut, more, offset: opts.offset };
}

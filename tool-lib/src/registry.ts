import z from "zod";
import type { ToolDef, ToolContext, ExecuteResult, Metadata } from "./types.ts";

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef) {
    this.tools.set(tool.id, tool);
  }

  async execute<M extends Metadata>(
    id: string,
    args: any,
    ctx: ToolContext
  ): Promise<ExecuteResult<M>> {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new Error(`Tool ${id} not found`);
    }

    try {
      const parsedArgs = tool.parameters.parse(args);
      return await tool.execute(parsedArgs, ctx) as ExecuteResult<M>;
    } catch (error) {
      if (error instanceof z.ZodError) {
        if (tool.formatValidationError) {
          throw new Error(tool.formatValidationError(error));
        }
        throw new Error(
          `The ${id} tool was called with invalid arguments: ${error.message}. Please rewrite the input so it satisfies the expected schema.`
        );
      }
      throw error;
    }
  }

  getTool(id: string) {
    return this.tools.get(id);
  }

  listTools() {
    return Array.from(this.tools.values()).map(t => ({
      id: t.id,
      description: t.description,
      parameters: t.parameters
    }));
  }
}

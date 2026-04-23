import z from "zod";
export class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.id, tool);
    }
    async execute(id, args, ctx) {
        const tool = this.tools.get(id);
        if (!tool) {
            throw new Error(`Tool ${id} not found`);
        }
        try {
            const parsedArgs = tool.parameters.parse(args);
            return await tool.execute(parsedArgs, ctx);
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                if (tool.formatValidationError) {
                    throw new Error(tool.formatValidationError(error));
                }
                throw new Error(`The ${id} tool was called with invalid arguments: ${error.message}. Please rewrite the input so it satisfies the expected schema.`);
            }
            throw error;
        }
    }
    getTool(id) {
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

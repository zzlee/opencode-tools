import z from "zod";

export interface Metadata {
  [key: string]: any;
}

export interface ToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  abort?: AbortSignal;
  extra?: { [key: string]: unknown };
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string;
  metadata: M;
  output: string;
  attachments?: any[];
}

export interface ToolDef<P extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string;
  description: string;
  parameters: P;
  execute(args: z.infer<P>, ctx: ToolContext): Promise<ExecuteResult<M>>;
  formatValidationError?(error: z.ZodError): string;
}

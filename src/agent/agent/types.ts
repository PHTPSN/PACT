import { z } from "zod";
import type { AuditEvent } from "../audit/types.js";

export const modelDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_call"),
    tool: z.string().min(1),
    arguments: z.unknown(),
  }),
  z.object({
    type: z.literal("final"),
    message: z.string(),
  }),
]);

export type AgentModelDecision = z.infer<typeof modelDecisionSchema>;

export interface ModelToolResult {
  tool: string;
  arguments: unknown;
  success: boolean;
  output?: unknown;
  error?: ToolError;
}

export interface AgentModelInput {
  systemPrompt: string;
  userMessage: string;
  toolResults: ModelToolResult[];
}

export interface AgentModel {
  decide(input: AgentModelInput): Promise<unknown>;
}

export interface ToolError {
  code:
    | "UNKNOWN_TOOL"
    | "INVALID_ARGUMENTS"
    | "TOOL_EXECUTION_FAILED"
    | "MODEL_RESPONSE_INVALID"
    | "MODEL_REQUEST_FAILED"
    | "TOOL_LOOP_LIMIT";
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ToolExecutionRecord extends ModelToolResult {
  sequence: number;
  startedAt: string;
  completedAt: string;
}

export interface AgentRunResult {
  message: string;
  toolExecutions: ToolExecutionRecord[];
  auditEvents: AuditEvent[];
  stopReason: "final" | "model_error" | "tool_loop_limit";
}

export interface AgentRunInput {
  userMessage: string;
}

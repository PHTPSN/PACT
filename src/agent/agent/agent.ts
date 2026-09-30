import { RunAuditEmitter } from "../audit/emitter.js";
import type { AuditEmitter } from "../audit/types.js";
import type { ExternalAdapters } from "../external.js";
import { QWEN_SYSTEM_PROMPT } from "./prompts.js";
import { ToolDispatcher } from "./tool-dispatcher.js";
import { createToolRegistry } from "./tool-registry.js";
import {
  modelDecisionSchema,
  type AgentModel,
  type AgentRunInput,
  type AgentRunResult,
  type ToolExecutionRecord,
} from "./types.js";

export interface CreateAgentOptions extends ExternalAdapters {
  model: AgentModel;
  auditEmitter: AuditEmitter;
  maxToolIterations?: number;
  now?: () => Date;
}

export function createAgent(options: CreateAgentOptions) {
  const maxToolIterations = options.maxToolIterations ?? 8;
  if (!Number.isInteger(maxToolIterations) || maxToolIterations < 1) {
    throw new Error("maxToolIterations must be a positive integer.");
  }
  const now = options.now ?? (() => new Date());
  const registry = createToolRegistry(options);

  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const audit = new RunAuditEmitter(options.auditEmitter);
      const dispatcher = new ToolDispatcher(registry, audit, now);
      const toolExecutions: ToolExecutionRecord[] = [];

      audit.emit({
        type: "AGENT_TASK_STARTED",
        actor: "user",
        summary: "Agent task started.",
      });

      while (true) {
        let rawDecision: unknown;
        try {
          rawDecision = await options.model.decide({
            systemPrompt: QWEN_SYSTEM_PROMPT,
            userMessage: input.userMessage,
            toolResults: toolExecutions.map(({ tool, arguments: args, success, output, error }) => ({
              tool,
              arguments: args,
              success,
              ...(output === undefined ? {} : { output }),
              ...(error === undefined ? {} : { error }),
            })),
          });
        } catch {
          audit.emit({
            type: "AGENT_TASK_FAILED",
            actor: "system",
            summary: "The Qwen model request failed.",
            metadata: { code: "MODEL_REQUEST_FAILED" },
          });
          return {
            message: "The Qwen model request failed before a final answer was produced.",
            toolExecutions,
            auditEvents: audit.events,
            stopReason: "model_error",
          };
        }

        const parsed = modelDecisionSchema.safeParse(rawDecision);
        if (!parsed.success) {
          audit.emit({
            type: "AGENT_TASK_FAILED",
            actor: "system",
            summary: "Qwen returned an invalid action envelope.",
            metadata: { code: "MODEL_RESPONSE_INVALID" },
          });
          return {
            message: "Qwen returned an invalid structured action, so nothing was executed.",
            toolExecutions,
            auditEvents: audit.events,
            stopReason: "model_error",
          };
        }

        if (parsed.data.type === "final") {
          audit.emit({
            type: "AGENT_TASK_COMPLETED",
            actor: "agent",
            summary: "Agent task completed with a final response.",
          });
          return {
            message: parsed.data.message,
            toolExecutions,
            auditEvents: audit.events,
            stopReason: "final",
          };
        }

        if (toolExecutions.length >= maxToolIterations) {
          audit.emit({
            type: "AGENT_TASK_FAILED",
            actor: "system",
            summary: "Agent stopped at the configured tool-loop limit.",
            metadata: { code: "TOOL_LOOP_LIMIT", maxToolIterations },
          });
          return {
            message: `The agent stopped after ${maxToolIterations} tool executions to prevent an infinite loop.`,
            toolExecutions,
            auditEvents: audit.events,
            stopReason: "tool_loop_limit",
          };
        }

        toolExecutions.push(
          await dispatcher.dispatch(
            { tool: parsed.data.tool, arguments: parsed.data.arguments },
            toolExecutions.length + 1,
          ),
        );
      }
    },
  };
}

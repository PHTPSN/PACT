import { z } from "zod";
import type { AuditReader } from "../../external.js";
import type { ToolDefinition } from "../tool-registry.js";

const inputSchema = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict();

export function createGetAuditHistoryTool(reader: AuditReader): ToolDefinition {
  return {
    name: "getAuditHistory",
    description: "Read up to 100 recent normalized audit events.",
    inputSchema,
    execute: async (input) => {
      const parsed = inputSchema.parse(input);
      return reader.getAuditHistory(parsed.limit === undefined ? undefined : { limit: parsed.limit });
    },
  };
}

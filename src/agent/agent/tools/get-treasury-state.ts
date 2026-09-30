import { z } from "zod";
import type { TreasuryReader } from "../../external.js";
import type { ToolDefinition } from "../tool-registry.js";

const inputSchema = z.object({}).strict();

export function createGetTreasuryStateTool(reader: TreasuryReader): ToolDefinition {
  return {
    name: "getTreasuryState",
    description: "Read the shared treasury state without mutating it.",
    inputSchema,
    execute: async () => reader.getTreasuryState(),
  };
}

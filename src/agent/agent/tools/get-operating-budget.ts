import { z } from "zod";
import type { BudgetReader } from "../../external.js";
import type { ToolDefinition } from "../tool-registry.js";

const inputSchema = z.object({}).strict();

export function createGetOperatingBudgetTool(reader: BudgetReader): ToolDefinition {
  return {
    name: "getOperatingBudget",
    description: "Read the externally controlled execution-wallet budget.",
    inputSchema,
    execute: async () => reader.getOperatingBudget(),
  };
}

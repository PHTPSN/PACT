import type { ZodType } from "zod";
import type { ExternalAdapters } from "../external.js";
import { createGetAuditHistoryTool } from "./tools/get-audit-history.js";
import { createGetOperatingBudgetTool } from "./tools/get-operating-budget.js";
import { createGetTreasuryStateTool } from "./tools/get-treasury-state.js";
import { createInspectPaidResourceTool } from "./tools/inspect-paid-resource.js";
import { createPaidFetchTool } from "./tools/paid-fetch.js";

export const TOOL_NAMES = [
  "getTreasuryState",
  "getOperatingBudget",
  "inspectPaidResource",
  "paidFetch",
  "getAuditHistory",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: ZodType;
  execute(input: unknown): Promise<unknown>;
}

export type ToolRegistry = ReadonlyMap<ToolName, ToolDefinition>;

export function createToolRegistry(adapters: ExternalAdapters): ToolRegistry {
  const tools = [
    createGetTreasuryStateTool(adapters.treasuryReader),
    createGetOperatingBudgetTool(adapters.budgetReader),
    createInspectPaidResourceTool(adapters.paymentGateway),
    createPaidFetchTool(adapters.paymentGateway),
    createGetAuditHistoryTool(adapters.auditReader),
  ];
  return new Map(tools.map((tool) => [tool.name, tool]));
}

import { z } from "zod";
import type { PaymentGateway } from "../../external.js";
import type { ToolDefinition } from "../tool-registry.js";

const inputSchema = z.object({ url: z.string().url() }).strict();

export function createInspectPaidResourceTool(gateway: PaymentGateway): ToolDefinition {
  return {
    name: "inspectPaidResource",
    description: "Inspect normalized payment requirements without making a payment.",
    inputSchema,
    execute: async (input) => gateway.inspectPaidResource(inputSchema.parse(input).url),
  };
}

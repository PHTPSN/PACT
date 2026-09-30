import { z } from "zod";
import type { PaymentGateway } from "../../external.js";
import type { ToolDefinition } from "../tool-registry.js";

const decimalAmount = z.string().regex(/^\d+(?:\.\d+)?$/, "Expected a non-negative decimal string");
const inputSchema = z
  .object({
    url: z.string().url(),
    maxAmount: decimalAmount.optional(),
  })
  .strict();

export function createPaidFetchTool(gateway: PaymentGateway): ToolDefinition {
  return {
    name: "paidFetch",
    description: "Request resource access; the external gateway alone authorizes payment.",
    inputSchema,
    execute: async (input) => {
      const parsed = inputSchema.parse(input);
      return gateway.paidFetch({
        url: parsed.url,
        ...(parsed.maxAmount === undefined ? {} : { maxAmount: parsed.maxAmount }),
      });
    },
  };
}

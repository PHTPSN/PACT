import { z } from "zod";
import type { AuditEmitter } from "../audit/types.js";
import { ExternalAdapterError } from "../errors.js";
import type { PaidFetchResult, PaidResourceQuote } from "../external.js";
import type { ToolError, ToolExecutionRecord } from "./types.js";
import type { ToolName, ToolRegistry } from "./tool-registry.js";

export interface ToolRequest {
  tool: string;
  arguments: unknown;
}

function normalizeException(error: unknown): ToolError {
  if (error instanceof ExternalAdapterError) {
    return {
      code: "TOOL_EXECUTION_FAILED",
      message: error.message,
      retryable: error.retryable,
      details: {
        adapterCode: error.adapterCode,
        ...(error.safeDetails ?? {}),
      },
    };
  }
  return {
    code: "TOOL_EXECUTION_FAILED",
    message: "The external adapter failed while executing the tool.",
    retryable: false,
  };
}

function validationDetails(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.map(String),
      message: issue.message,
    })),
  };
}

export class ToolDispatcher {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly audit: AuditEmitter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dispatch(request: ToolRequest, sequence = 1): Promise<ToolExecutionRecord> {
    const startedAt = this.now().toISOString();
    const tool = this.registry.get(request.tool as ToolName);
    this.audit.emit({
      type: "TOOL_REQUESTED",
      actor: "agent",
      ...(tool ? { toolName: tool.name } : {}),
      summary: tool
        ? `Agent requested tool ${tool.name}.`
        : "Agent requested an unregistered tool.",
    });

    if (!tool) {
      return this.failure(
        request,
        sequence,
        startedAt,
        {
          code: "UNKNOWN_TOOL",
          message: `Tool \"${request.tool}\" is not registered.`,
          retryable: false,
        },
      );
    }

    const parsed = tool.inputSchema.safeParse(request.arguments);
    if (!parsed.success) {
      return this.failure(
        request,
        sequence,
        startedAt,
        {
          code: "INVALID_ARGUMENTS",
          message: `Arguments for ${request.tool} failed schema validation.`,
          retryable: true,
          details: validationDetails(parsed.error),
        },
      );
    }

    if (tool.name === "paidFetch") {
      this.audit.emit({
        type: "PAYMENT_REQUESTED",
        actor: "agent",
        toolName: tool.name,
        summary: "Agent requested resource access through the external payment gateway.",
        metadata: { url: (parsed.data as { url: string }).url },
      });
    }

    try {
      const output = await tool.execute(parsed.data);
      this.emitDomainSuccess(tool.name, output);
      this.audit.emit({
        type: "TOOL_SUCCEEDED",
        actor: "system",
        toolName: tool.name,
        summary: `Tool ${tool.name} completed.`,
      });
      return {
        sequence,
        tool: request.tool,
        arguments: parsed.data,
        success: true,
        output,
        startedAt,
        completedAt: this.now().toISOString(),
      };
    } catch (error) {
      const normalized = normalizeException(error);
      if (tool.name === "paidFetch") {
        this.audit.emit({
          type: "PAYMENT_FAILED",
          actor: "system",
          toolName: tool.name,
          summary: "The external payment gateway rejected or failed the request.",
          ...(normalized.details === undefined ? {} : { metadata: normalized.details }),
        });
      }
      return this.failure(request, sequence, startedAt, normalized);
    }
  }

  private emitDomainSuccess(toolName: ToolName, output: unknown): void {
    if (toolName === "inspectPaidResource") {
      const quote = output as PaidResourceQuote;
      this.audit.emit({
        type: "PAID_RESOURCE_INSPECTED",
        actor: "system",
        toolName,
        summary: "The external gateway returned normalized resource requirements.",
        metadata: {
          url: quote.url,
          requiresPayment: quote.requiresPayment,
          ...(quote.amount === undefined ? {} : { amount: quote.amount }),
          ...(quote.currency === undefined ? {} : { currency: quote.currency }),
          ...(quote.network === undefined ? {} : { network: quote.network }),
          ...(quote.payTo === undefined ? {} : { payTo: quote.payTo }),
        },
      });
    }
    if (toolName === "paidFetch") {
      const result = output as PaidFetchResult;
      this.audit.emit({
        type: result.paid ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED",
        actor: "system",
        toolName,
        summary: result.paid
          ? "The external gateway reported a successful payment."
          : "The resource response did not report a payment.",
        metadata: {
          url: result.url,
          status: result.status,
          paid: result.paid,
          ...(result.amountPaid === undefined ? {} : { amountPaid: result.amountPaid }),
          ...(result.currency === undefined ? {} : { currency: result.currency }),
          ...(result.network === undefined ? {} : { network: result.network }),
          ...(result.txHash === undefined ? {} : { txHash: result.txHash }),
        },
      });
    }
  }

  private failure(
    request: ToolRequest,
    sequence: number,
    startedAt: string,
    error: ToolError,
  ): ToolExecutionRecord {
    this.audit.emit({
      type: "TOOL_FAILED",
      actor: "system",
      ...(this.registry.has(request.tool as ToolName)
        ? { toolName: request.tool }
        : {}),
      summary: this.registry.has(request.tool as ToolName)
        ? `Tool ${request.tool} did not execute successfully.`
        : "An unregistered tool request was rejected.",
      metadata: { code: error.code, ...(error.details ?? {}) },
    });
    return {
      sequence,
      tool: request.tool,
      arguments: request.arguments,
      success: false,
      error,
      startedAt,
      completedAt: this.now().toISOString(),
    };
  }
}

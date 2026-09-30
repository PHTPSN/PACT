import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/agent/agent/agent.js";
import { InMemoryAuditLog } from "../../src/agent/audit/emitter.js";
import { ExternalAdapterError } from "../../src/agent/errors.js";
import type { PaymentGateway } from "../../src/agent/external.js";
import {
  FREE_RESOURCE_URL,
  MOCK_BUDGET,
  PAID_RESOURCE_URL,
  REJECTED_RESOURCE_URL,
  MockBudgetReader,
  MockPaymentGateway,
  MockTreasuryReader,
  createMockResources,
} from "../../src/agent/mocks/adapters.js";
import { ScriptedModel } from "../../src/agent/mocks/scripted-model.js";
import { createHarness } from "./helpers.js";

describe("agent loop", () => {
  it("answers without using tools", async () => {
    const { agent } = createHarness([{ type: "final", message: "No tools needed." }]);
    const result = await agent.run({ userMessage: "Say hello." });
    expect(result.message).toBe("No tools needed.");
    expect(result.toolExecutions).toEqual([]);
    expect(result.stopReason).toBe("final");
  });

  it("calls getTreasuryState and returns its result to Qwen", async () => {
    const { agent, model, treasuryReader } = createHarness([
      { type: "tool_call", tool: "getTreasuryState", arguments: {} },
      { type: "final", message: "Treasury state inspected." },
    ]);
    const result = await agent.run({ userMessage: "Inspect treasury." });
    expect(treasuryReader.calls).toBe(1);
    expect(result.toolExecutions[0]?.success).toBe(true);
    expect(model.inputs[1]?.toolResults[0]?.output).toMatchObject({ threshold: 2 });
  });

  it("inspects a paid resource without making a payment", async () => {
    const { agent, paymentGateway } = createHarness([
      { type: "tool_call", tool: "inspectPaidResource", arguments: { url: FREE_RESOURCE_URL } },
      { type: "final", message: "The resource is free." },
    ]);
    const result = await agent.run({ userMessage: "Check this resource." });
    expect(paymentGateway.inspectCalls).toEqual([FREE_RESOURCE_URL]);
    expect(paymentGateway.fetchCalls).toEqual([]);
    expect(result.auditEvents.some((event) => event.type === "PAID_RESOURCE_INSPECTED")).toBe(true);
    expect(result.auditEvents.some((event) => event.type === "PAYMENT_REQUESTED")).toBe(false);
  });

  it("accesses a free resource without an external payment attempt", async () => {
    const { agent, paymentGateway, model } = createHarness([
      { type: "tool_call", tool: "inspectPaidResource", arguments: { url: FREE_RESOURCE_URL } },
      { type: "tool_call", tool: "paidFetch", arguments: { url: FREE_RESOURCE_URL } },
      { type: "final", message: "Used the public resource without payment." },
    ]);
    const result = await agent.run({ userMessage: "Use the free resource." });
    expect(paymentGateway.fetchCalls).toEqual([{ url: FREE_RESOURCE_URL }]);
    expect(paymentGateway.paymentAttempts).toEqual([]);
    expect(model.inputs[2]?.toolResults[1]?.output).toMatchObject({ paid: false, status: 200 });
    expect(result.message).toContain("without payment");
    expect(result.auditEvents.some((event) => event.type === "PAYMENT_SUCCEEDED")).toBe(false);
  });

  it("requests paidFetch and accurately reports gateway success", async () => {
    const { agent, model, paymentGateway } = createHarness([
      {
        type: "tool_call",
        tool: "paidFetch",
        arguments: { url: PAID_RESOURCE_URL, maxAmount: "0.10" },
      },
      { type: "final", message: "Paid 0.10 USDC and used the premium dataset." },
    ]);
    const result = await agent.run({ userMessage: "Get the premium dataset." });
    expect(paymentGateway.fetchCalls).toEqual([{ url: PAID_RESOURCE_URL, maxAmount: "0.10" }]);
    expect(model.inputs[1]?.toolResults[0]?.output).toMatchObject({
      paid: true,
      amountPaid: "0.10",
      txHash: "0xmock-transaction-hash",
    });
    expect(result.message).toContain("Paid 0.10 USDC");
    expect(result.auditEvents.some((event) => event.type === "PAYMENT_SUCCEEDED")).toBe(true);
  });

  it("returns payment rejection to Qwen and does not record payment success", async () => {
    const { agent, model } = createHarness([
      { type: "tool_call", tool: "paidFetch", arguments: { url: REJECTED_RESOURCE_URL } },
      { type: "final", message: "Payment was rejected by external policy; no purchase occurred." },
    ]);
    const result = await agent.run({ userMessage: "Buy the expensive resource." });
    expect(model.inputs[1]?.toolResults[0]).toMatchObject({
      success: false,
      error: { code: "TOOL_EXECUTION_FAILED" },
    });
    expect(result.message).toContain("no purchase occurred");
    expect(result.auditEvents.some((event) => event.type === "PAYMENT_FAILED")).toBe(true);
    expect(result.auditEvents.some((event) => event.type === "PAYMENT_SUCCEEDED")).toBe(false);
  });

  it("normalizes tool exceptions and continues the loop", async () => {
    const { agent } = createHarness([
      { type: "tool_call", tool: "inspectPaidResource", arguments: { url: "https://unknown.example" } },
      { type: "final", message: "Inspection failed, so I stopped." },
    ]);
    const result = await agent.run({ userMessage: "Inspect unknown resource." });
    expect(result.stopReason).toBe("final");
    expect(result.toolExecutions[0]).toMatchObject({
      success: false,
      error: { code: "TOOL_EXECUTION_FAILED" },
    });
  });

  it("stops repeated tool requests at the configured maximum", async () => {
    const repeated = Array.from({ length: 4 }, () => ({
      type: "tool_call",
      tool: "getOperatingBudget",
      arguments: {},
    }));
    const { agent, budgetReader } = createHarness(repeated, 2);
    const result = await agent.run({ userMessage: "Loop forever." });
    expect(result.stopReason).toBe("tool_loop_limit");
    expect(result.toolExecutions).toHaveLength(2);
    expect(budgetReader.calls).toBe(2);
    expect(result.auditEvents.at(-1)?.type).toBe("AGENT_TASK_FAILED");
  });

  it("emits normalized tool request and result events", async () => {
    const { agent } = createHarness([
      { type: "tool_call", tool: "getOperatingBudget", arguments: {} },
      { type: "final", message: "Done." },
    ]);
    const result = await agent.run({ userMessage: "Show budget." });
    expect(result.auditEvents.map((event) => event.type)).toEqual([
      "AGENT_TASK_STARTED",
      "TOOL_REQUESTED",
      "TOOL_SUCCEEDED",
      "AGENT_TASK_COMPLETED",
    ]);
  });

  it("removes secret-like fields from audit metadata", async () => {
    const secretGateway: PaymentGateway = {
      async inspectPaidResource() {
        throw new ExternalAdapterError("UPSTREAM_FAILURE", "Gateway rejected safely.", false, {
          apiKey: "do-not-log-this",
          privateKey: "also-secret",
          reason: "policy",
        });
      },
      async paidFetch() {
        throw new Error("unused");
      },
    };
    const audit = new InMemoryAuditLog();
    const agent = createAgent({
      model: new ScriptedModel([
        { type: "tool_call", tool: "inspectPaidResource", arguments: { url: "https://example.com" } },
        { type: "final", message: "Stopped." },
      ]),
      treasuryReader: new MockTreasuryReader(),
      budgetReader: new MockBudgetReader(),
      paymentGateway: secretGateway,
      auditReader: audit,
      auditEmitter: audit,
    });
    const result = await agent.run({ userMessage: "Inspect." });
    const serialized = JSON.stringify(result.auditEvents);
    expect(serialized).not.toContain("do-not-log-this");
    expect(serialized).not.toContain("also-secret");
    expect(serialized).toContain("policy");
  });

  it("allows adapters to be replaced without changing the agent loop", async () => {
    const customBudget: MockBudgetReader = new MockBudgetReader({ ...MOCK_BUDGET, balance: "42.00" });
    const audit = new InMemoryAuditLog();
    const model = new ScriptedModel([
      { type: "tool_call", tool: "getOperatingBudget", arguments: {} },
      { type: "final", message: "Custom adapter worked." },
    ]);
    const agent = createAgent({
      model,
      treasuryReader: new MockTreasuryReader(),
      budgetReader: customBudget,
      paymentGateway: new MockPaymentGateway(createMockResources()),
      auditReader: audit,
      auditEmitter: audit,
    });
    await agent.run({ userMessage: "Read the replaceable adapter." });
    expect(model.inputs[1]?.toolResults[0]?.output).toMatchObject({ balance: "42.00" });
  });
});

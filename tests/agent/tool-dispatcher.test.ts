import { describe, expect, it } from "vitest";
import { ToolDispatcher } from "../../src/agent/agent/tool-dispatcher.js";
import { createToolRegistry, TOOL_NAMES } from "../../src/agent/agent/tool-registry.js";
import { InMemoryAuditLog } from "../../src/agent/audit/emitter.js";
import {
  MockBudgetReader,
  MockPaymentGateway,
  MockTreasuryReader,
  createMockResources,
} from "../../src/agent/mocks/adapters.js";

function setupDispatcher() {
  const audit = new InMemoryAuditLog();
  const treasuryReader = new MockTreasuryReader();
  const budgetReader = new MockBudgetReader();
  const paymentGateway = new MockPaymentGateway(createMockResources());
  const registry = createToolRegistry({
    treasuryReader,
    budgetReader,
    paymentGateway,
    auditReader: audit,
  });
  return {
    dispatcher: new ToolDispatcher(registry, audit),
    registry,
    treasuryReader,
    paymentGateway,
  };
}

describe("tool dispatcher", () => {
  it("rejects malformed arguments before an adapter runs", async () => {
    const { dispatcher, paymentGateway } = setupDispatcher();
    const result = await dispatcher.dispatch({
      tool: "inspectPaidResource",
      arguments: { url: "not-a-url" },
    });
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(paymentGateway.inspectCalls).toEqual([]);
  });

  it("rejects hallucinated and forbidden tools", async () => {
    const { dispatcher, paymentGateway } = setupDispatcher();
    for (const tool of [
      "sendUSDC",
      "fundAgentWallet",
      "proposeBudget",
      "changeOwners",
      "changeThreshold",
      "setSpendingLimit",
      "createSplit",
      "updateSplit",
      "distributeRevenue",
      "changeRevenueShares",
      "withdrawSplit",
    ]) {
      const result = await dispatcher.dispatch({ tool, arguments: { amount: "1" } });
      expect(result.error?.code).toBe("UNKNOWN_TOOL");
    }
    expect(paymentGateway.inspectCalls).toEqual([]);
    expect(paymentGateway.fetchCalls).toEqual([]);
    expect(TOOL_NAMES).toEqual([
      "getTreasuryState",
      "getOperatingBudget",
      "inspectPaidResource",
      "paidFetch",
      "getAuditHistory",
    ]);
  });

  it("rejects malformed paidFetch before the payment adapter runs", async () => {
    const { dispatcher, paymentGateway } = setupDispatcher();
    const invalidUrl = await dispatcher.dispatch({
      tool: "paidFetch",
      arguments: { url: "not-a-url", maxAmount: "1.00" },
    });
    const extraSigningMaterial = await dispatcher.dispatch({
      tool: "paidFetch",
      arguments: {
        url: "https://resources.example/premium",
        privateKey: "0xsecret",
      },
    });
    expect(invalidUrl.error?.code).toBe("INVALID_ARGUMENTS");
    expect(extraSigningMaterial.error?.code).toBe("INVALID_ARGUMENTS");
    expect(paymentGateway.fetchCalls).toEqual([]);
  });

  it("rejects extra sensitive arguments rather than ignoring them", async () => {
    const { dispatcher, treasuryReader } = setupDispatcher();
    const result = await dispatcher.dispatch({
      tool: "getTreasuryState",
      arguments: { privateKey: "0xsecret" },
    });
    expect(result.error?.code).toBe("INVALID_ARGUMENTS");
    expect(treasuryReader.calls).toBe(0);
  });
});

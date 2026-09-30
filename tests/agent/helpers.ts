import { createAgent } from "../../src/agent/agent/agent.js";
import { InMemoryAuditLog } from "../../src/agent/audit/emitter.js";
import {
  MockBudgetReader,
  MockPaymentGateway,
  MockTreasuryReader,
  createMockResources,
} from "../../src/agent/mocks/adapters.js";
import { ScriptedModel } from "../../src/agent/mocks/scripted-model.js";

export function createHarness(decisions: unknown[], maxToolIterations = 8) {
  const audit = new InMemoryAuditLog(() => new Date("2026-01-01T00:00:00.000Z"));
  const treasuryReader = new MockTreasuryReader();
  const budgetReader = new MockBudgetReader();
  const paymentGateway = new MockPaymentGateway(createMockResources());
  const model = new ScriptedModel(decisions);
  const agent = createAgent({
    model,
    treasuryReader,
    budgetReader,
    paymentGateway,
    auditReader: audit,
    auditEmitter: audit,
    maxToolIterations,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  return { agent, audit, model, treasuryReader, budgetReader, paymentGateway };
}

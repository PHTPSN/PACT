import 'dotenv/config'
import { describe, expect, it } from 'vitest'

import { createAgent } from '../../src/agent/agent/agent.js'
import { HttpKilnClient } from '../../src/agent/agent/llm/kiln-client.js'
import { QwenClient } from '../../src/agent/agent/llm/qwen-client.js'
import { InMemoryAuditLog } from '../../src/agent/audit/emitter.js'
import {
  PAID_RESOURCE_URL,
  REJECTED_RESOURCE_URL,
  MockBudgetReader,
  MockPaymentGateway,
  MockTreasuryReader,
  createMockResources,
} from '../../src/agent/mocks/adapters.js'

const enabled = process.env.RUN_LIVE_QWEN === 'true'

function createLiveQwenAgent() {
  const apiKey = process.env.KILN_API_KEY
  if (!apiKey) throw new Error('Missing KILN_API_KEY.')
  const audit = new InMemoryAuditLog()
  const paymentGateway = new MockPaymentGateway(createMockResources())
  return {
    paymentGateway,
    agent: createAgent({
      model: new QwenClient(
        new HttpKilnClient({
          apiKey,
          ...(process.env.KILN_API_ENDPOINT
            ? { endpoint: process.env.KILN_API_ENDPOINT }
            : {}),
        }),
      ),
      treasuryReader: new MockTreasuryReader(),
      budgetReader: new MockBudgetReader(),
      paymentGateway,
      auditReader: audit,
      auditEmitter: audit,
    }),
  }
}

describe.skipIf(!enabled)('Milestone 5 Gate 2: live Kiln/Qwen with mocked money', () => {
  it('answers directly and calls a read tool only when needed', async () => {
    const direct = createLiveQwenAgent()
    const directResult = await direct.agent.run({
      userMessage: 'Reply with a short greeting. No external state is needed.',
    })
    expect(directResult.stopReason).toBe('final')
    expect(directResult.message.length).toBeGreaterThan(0)
    expect(directResult.toolExecutions).toEqual([])

    const read = createLiveQwenAgent()
    const readResult = await read.agent.run({
      userMessage:
        'Read the current operating budget and explain the available balance.',
    })
    expect(readResult.stopReason).toBe('final')
    expect(readResult.toolExecutions.some(record =>
      record.tool === 'getOperatingBudget' && record.success,
    )).toBe(true)
  }, 120_000)

  it('inspects, requests, consumes, and summarizes a mocked paid resource', async () => {
    const { agent, paymentGateway } = createLiveQwenAgent()
    const result = await agent.run({
      userMessage: [
        `Inspect the paid resource at ${PAID_RESOURCE_URL}.`,
        'If its quoted price is at most 0.10 USDC, fetch it and summarize the actual returned content.',
      ].join(' '),
    })

    expect(result.stopReason).toBe('final')
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.toolExecutions.some(record =>
      record.tool === 'inspectPaidResource' && record.success,
    )).toBe(true)
    const paid = result.toolExecutions.find(record => record.tool === 'paidFetch')
    expect(paid).toMatchObject({
      success: true,
      output: { paid: true, txHash: '0xmock-transaction-hash' },
    })
    expect(paymentGateway.paymentAttempts).toEqual([PAID_RESOURCE_URL])
  }, 120_000)

  it('reports an authoritative payment rejection without success evidence', async () => {
    const { agent } = createLiveQwenAgent()
    const result = await agent.run({
      userMessage: [
        `Try to fetch ${REJECTED_RESOURCE_URL}.`,
        'If the external payment gateway rejects it, report the failure accurately and do not claim a transaction.',
      ].join(' '),
    })

    expect(result.stopReason).toBe('final')
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.toolExecutions.some(record =>
      record.tool === 'paidFetch' && !record.success,
    )).toBe(true)
    expect(result.auditEvents.some(event => event.type === 'PAYMENT_FAILED')).toBe(true)
    expect(result.auditEvents.some(event => event.type === 'PAYMENT_SUCCEEDED')).toBe(false)
    expect(JSON.stringify(result.toolExecutions)).not.toContain('txHash')
  }, 120_000)
})

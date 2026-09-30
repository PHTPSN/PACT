import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import {
  PactBudgetReader,
  PactTreasuryReader,
  createPactPaymentGateway,
  type TokenBalanceClient,
} from '../../src/agent/adapters/pact-adapters.js'
import { createAgent } from '../../src/agent/agent/agent.js'
import { HttpKilnClient } from '../../src/agent/agent/llm/kiln-client.js'
import { QwenClient } from '../../src/agent/agent/llm/qwen-client.js'
import { InMemoryAuditLog } from '../../src/agent/audit/emitter.js'
import type { PaidFetchResult } from '../../src/agent/external.js'
import { connectDeployedTreasury } from '../../src/treasury/connectDeployedTreasury.js'
import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
} from '../../src/x402/constants.js'

const enabled = process.env.RUN_LIVE_M5 === 'true'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function address(name: string, fallback?: Address): Address {
  const value = process.env[name] ?? fallback
  if (!value || !isAddress(value, { strict: false })) {
    throw new Error(`${name} must be a configured EVM address.`)
  }
  return getAddress(value)
}

function privateKey(name: string): `0x${string}` {
  const value = required(name)
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key.`)
  }
  return value
}

function publicResourceUrl(raw: string): string {
  const url = new URL(raw)
  return `${url.origin}${url.pathname}`
}

describe.skipIf(!enabled)('Milestone 5 Gate 3: live Qwen and live x402', () => {
  it('uses existing Agent Wallet capital for one hosted-facilitator payment', async () => {
    const rpcUrl = process.env.RPC_URL ?? required('BASE_SEPOLIA_RPC_URL')
    const resourceUrl = required('MILESTONE5_PAID_RESOURCE_URL')
    const agentAccount = privateKeyToAccount(privateKey('AGENT_WALLET_PRIVATE_KEY'))
    const configuredAgentAddress = process.env.AGENT_WALLET_ADDRESS
      ? address('AGENT_WALLET_ADDRESS')
      : agentAccount.address
    if (configuredAgentAddress !== agentAccount.address) {
      throw new Error('AGENT_WALLET_PRIVATE_KEY does not match AGENT_WALLET_ADDRESS.')
    }
    const safeAddress = address('SAFE_ADDRESS')
    const tokenAddress = address('TOKEN_ADDRESS', BASE_SEPOLIA_USDC)
    const tokenDecimals = Number(process.env.TOKEN_DECIMALS ?? '6')
    const maximumPaymentAmount = BigInt(required('MILESTONE5_MAX_PAYMENT_ATOMIC'))
    const expectedPayToValue =
      process.env.MILESTONE5_EXPECTED_PAY_TO ??
      process.env.MILESTONE2_PAY_TO_ADDRESS
    if (!expectedPayToValue || !isAddress(expectedPayToValue, { strict: false })) {
      throw new Error(
        'MILESTONE5_EXPECTED_PAY_TO or MILESTONE2_PAY_TO_ADDRESS must be configured.',
      )
    }
    const expectedPayTo = getAddress(expectedPayToValue)
    const publicClient = createPublicClient({
      chain: baseSepolia,
      cacheTime: 0,
      transport: http(rpcUrl),
    })
    if (await publicClient.getChainId() !== 84532) {
      throw new Error('Milestone 5 live payment requires Base Sepolia.')
    }
    const treasury = await connectDeployedTreasury({
      provider: rpcUrl,
      safeAddress,
    })
    if (
      treasury.config.owners.some(
        owner => owner.toLowerCase() === agentAccount.address.toLowerCase(),
      )
    ) {
      throw new Error('The Agent Wallet must not be a Safe owner.')
    }

    const token = {
      address: tokenAddress,
      symbol: process.env.TOKEN_SYMBOL ?? 'USDC',
      decimals: tokenDecimals,
    }
    const paymentGateway = createPactPaymentGateway({
      agentWalletAccount: agentAccount,
      maximumPaymentAmount,
      expectedPayTo,
      expectedNetwork: BASE_SEPOLIA_NETWORK,
      expectedAsset: tokenAddress,
      token,
    })
    const audit = new InMemoryAuditLog()
    const apiKey = required('KILN_API_KEY')
    const agent = createAgent({
      model: new QwenClient(
        new HttpKilnClient({
          apiKey,
          ...(process.env.KILN_API_ENDPOINT
            ? { endpoint: process.env.KILN_API_ENDPOINT }
            : {}),
        }),
      ),
      treasuryReader: new PactTreasuryReader({
        treasury,
        publicClient: publicClient as unknown as TokenBalanceClient,
        token,
      }),
      budgetReader: new PactBudgetReader({
        walletAddress: agentAccount.address,
        publicClient: publicClient as unknown as TokenBalanceClient,
        token,
        maxPerCall: maximumPaymentAmount,
      }),
      paymentGateway,
      auditReader: audit,
      auditEmitter: audit,
    })

    const result = await agent.run({
      userMessage: [
        `Inspect the premium market brief at ${resourceUrl}.`,
        'If it is within the reported operating budget and per-call limit, fetch it and identify the strongest launch market using the actual returned data.',
      ].join(' '),
    })
    const inspection = result.toolExecutions.find(
      record => record.tool === 'inspectPaidResource',
    )
    const paidExecution = result.toolExecutions.find(
      record => record.tool === 'paidFetch',
    )
    const payment = paidExecution?.output as PaidFetchResult | undefined
    if (!payment?.txHash || !isHex(payment.txHash) || payment.txHash.length !== 66) {
      throw new Error('The live tool result omitted authoritative settlement evidence.')
    }
    const receipt = await publicClient.getTransactionReceipt({
      hash: payment.txHash,
    })
    const results = {
      inspectionCalled: Boolean(inspection?.success),
      paidFetchCalled: Boolean(paidExecution?.success),
      paymentReportedPaid: payment.paid === true,
      paymentTxHashPresent: payment.txHash.length === 66,
      resourceStatusOk: payment.status === 200,
      receiptSucceeded: receipt.status === 'success',
      resourceReturned: payment.body !== undefined && payment.body !== null,
      finalAnswerExists: result.stopReason === 'final' && result.message.length > 0,
    }
    const evidence = {
      milestone: 'qwen-x402-agent-integration',
      model: 'qwen3-32b',
      provider: 'Kiln',
      facilitator: 'Coinbase CDP hosted facilitator',
      network: BASE_SEPOLIA_NETWORK,
      resourceUrl: publicResourceUrl(resourceUrl),
      safeAddress: treasury.address,
      agentWalletAddress: agentAccount.address,
      tokenAddress,
      amountPaid: payment.amountPaid,
      currency: payment.currency,
      paymentTxHash: payment.txHash,
      resourceStatus: payment.status,
      toolExecutions: result.toolExecutions.map(record => ({
        sequence: record.sequence,
        tool: record.tool,
        success: record.success,
      })),
      auditEvents: result.auditEvents,
      results,
    }
    await writeFile(
      resolve(process.env.MILESTONE5_RESULT_PATH ?? 'milestone5-result.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    )
    expect(Object.values(results).every(Boolean)).toBe(true)
  }, 300_000)
})

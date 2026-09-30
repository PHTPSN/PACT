import { describe, expect, it, vi } from 'vitest'
import { getAddress, type Address } from 'viem'

import {
  PactBudgetReader,
  PactPaymentGateway,
  PactTreasuryReader,
  type ExecutePactPaidFetch,
  type TokenBalanceClient,
} from '../../src/agent/adapters/pact-adapters.js'
import { ExternalAdapterError } from '../../src/agent/errors.js'
import type { Treasury } from '../../src/treasury/types.js'
import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
} from '../../src/x402/constants.js'

const safe = getAddress('0x1000000000000000000000000000000000000000')
const owner = getAddress('0x2000000000000000000000000000000000000000')
const wallet = getAddress('0x3000000000000000000000000000000000000000')
const merchant = getAddress('0x4000000000000000000000000000000000000000')
const txHash = `0x${'12'.repeat(32)}`
const token = {
  address: BASE_SEPOLIA_USDC,
  symbol: 'USDC',
  decimals: 6,
}

function balanceClient(balance: bigint): TokenBalanceClient {
  return {
    async readContract() {
      return balance
    },
  }
}

function paidInspection(amount = 100_000n) {
  return {
    url: 'https://resource.example/premium',
    status: 402 as const,
    requiresPayment: true as const,
    x402Version: 2 as const,
    scheme: 'exact',
    network: BASE_SEPOLIA_NETWORK,
    asset: BASE_SEPOLIA_USDC,
    amount,
    payTo: merchant,
    assetTransferMethod: 'eip3009',
    paymentFlow: 'authorization',
  }
}

function successfulFetch(transaction = txHash): ExecutePactPaidFetch {
  return async () =>
    ({
      resource: { premiumData: 'authoritative resource' },
      response: new Response(null, { status: 200 }),
      settlement: {
        success: true,
        transaction,
        network: BASE_SEPOLIA_NETWORK,
      },
      audit: [],
    }) as never
}

describe('Pact agent adapters', () => {
  it('maps existing Safe inspection and the configured token balance', async () => {
    const inspect = vi.fn(async () => ({
      address: safe,
      deployed: true,
      version: '1.4.1' as const,
      owners: [owner],
      threshold: 1,
      modules: [] as Address[],
      guard: getAddress('0x0000000000000000000000000000000000000000'),
      moduleGuard: getAddress('0x0000000000000000000000000000000000000000'),
      moduleGuardSupported: false,
      fallbackHandler: getAddress('0x0000000000000000000000000000000000000000'),
    }))
    const reader = new PactTreasuryReader({
      treasury: { address: safe } as unknown as Treasury,
      publicClient: balanceClient(2_500_000n),
      token,
      inspect,
    })

    await expect(reader.getTreasuryState()).resolves.toEqual({
      address: safe,
      balance: '2.5',
      members: [owner],
      threshold: 1,
    })
    expect(inspect).toHaveBeenCalledOnce()
  })

  it('reports only capital already held by the Agent Wallet', async () => {
    const reader = new PactBudgetReader({
      walletAddress: wallet,
      publicClient: balanceClient(7_250_000n),
      token,
      maxPerCall: 1_000_000n,
      maxPerSession: 5_000_000n,
    })

    await expect(reader.getOperatingBudget()).resolves.toEqual({
      walletAddress: wallet,
      balance: '7.25',
      currency: 'USDC',
      maxPerCall: '1',
      maxPerSession: '5',
    })
  })

  it('normalizes an authoritative quote and existing M2 settlement result', async () => {
    const executePaidFetch = vi.fn(successfulFetch())
    const gateway = new PactPaymentGateway({
      inspect: async () => paidInspection(),
      executePaidFetch,
      token,
      maximumPaymentAmount: 1_000_000n,
    })

    await expect(
      gateway.inspectPaidResource('https://resource.example/premium'),
    ).resolves.toEqual({
      url: 'https://resource.example/premium',
      requiresPayment: true,
      amount: '0.1',
      currency: 'USDC',
      network: BASE_SEPOLIA_NETWORK,
      payTo: merchant,
    })
    await expect(
      gateway.paidFetch({
        url: 'https://resource.example/premium',
        maxAmount: '0.10',
      }),
    ).resolves.toEqual({
      url: 'https://resource.example/premium',
      status: 200,
      paid: true,
      amountPaid: '0.1',
      currency: 'USDC',
      network: BASE_SEPOLIA_NETWORK,
      txHash,
      body: { premiumData: 'authoritative resource' },
    })
    expect(executePaidFetch).toHaveBeenCalledOnce()
  })

  it('rejects amounts above policy before the M2 payment client executes', async () => {
    const executePaidFetch = vi.fn(successfulFetch())
    const gateway = new PactPaymentGateway({
      inspect: async () => paidInspection(2_000_000n),
      executePaidFetch,
      token,
      maximumPaymentAmount: 1_000_000n,
    })

    await expect(
      gateway.paidFetch({ url: 'https://resource.example/premium' }),
    ).rejects.toMatchObject({ adapterCode: 'PAYMENT_POLICY_REJECTED' })
    expect(executePaidFetch).not.toHaveBeenCalled()
  })

  it('normalizes insufficient balance without fabricating settlement evidence', async () => {
    const gateway = new PactPaymentGateway({
      inspect: async () => paidInspection(),
      executePaidFetch: async () => {
        throw new Error('insufficient balance for transfer')
      },
      token,
      maximumPaymentAmount: 1_000_000n,
    })

    const failure = await gateway
      .paidFetch({ url: 'https://resource.example/premium' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ExternalAdapterError)
    expect(failure).toMatchObject({ adapterCode: 'INSUFFICIENT_BALANCE' })
    expect(JSON.stringify(failure)).not.toContain('txHash')
  })

  it('rejects a non-authoritative transaction hash from the settlement adapter', async () => {
    const gateway = new PactPaymentGateway({
      inspect: async () => paidInspection(),
      executePaidFetch: successfulFetch('0xmodel-invented'),
      token,
      maximumPaymentAmount: 1_000_000n,
    })

    await expect(
      gateway.paidFetch({ url: 'https://resource.example/premium' }),
    ).rejects.toMatchObject({ adapterCode: 'INVALID_SETTLEMENT_EVIDENCE' })
  })
})

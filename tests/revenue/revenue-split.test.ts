import { describe, expect, it } from 'vitest'
import { getAddress, zeroAddress, type Address, type Hash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  RevenueSplitService,
  RevenueSplitProtocolError,
  RevenueSplitValidationError,
  SplitsV2PushSplitAdapter,
  calculateRevenueDistribution,
  minimumExactPushSplitFundingAmount,
  pushSplitDistributableBalance,
  validateRevenueSplitConfig,
  type RevenueAuditEvent,
  type RevenueDistributionResult,
  type RevenueShare,
  type RevenueSplit,
  type RevenueSplitAdapter,
  type RevenueSplitConfig,
} from '../../src/revenue/index.js'

const account = (value: number) =>
  privateKeyToAccount(
    `0x${value.toString(16).padStart(64, '0')}` as `0x${string}`,
  )

const addresses = Array.from({ length: 10 }, (_, index) => account(index + 1).address)
const agentWallet = account(100).address
const safe = account(101).address
const deployer = account(102).address
const token = account(103).address

function shares(allocations: readonly number[]): RevenueShare[] {
  return allocations.map((allocationBps, index) => ({
    recipient: addresses[index]!,
    allocationBps,
  }))
}

class FakeRevenueSplitAdapter implements RevenueSplitAdapter {
  readonly controllerAddress = zeroAddress
  readonly fundingAmount: bigint
  createdConfig?: Readonly<RevenueSplitConfig>

  #split?: RevenueSplit
  #distributionCount = 0

  constructor(fundingAmount = 10_001n) {
    this.fundingAmount = fundingAmount
  }

  async createImmutableSplit(config: RevenueSplitConfig): Promise<RevenueSplit> {
    this.createdConfig = config
    this.#split = Object.freeze({
      id: '84532:fixture',
      chainId: 84_532,
      address: account(999).address,
      recipients: config.recipients,
      immutable: true,
      creationTxHash: `0x${'1'.padStart(64, '0')}` as Hash,
      createdAt: '2026-01-02T03:04:05.000Z',
    })
    return this.#split
  }

  async getSplit(splitAddress: Address): Promise<RevenueSplit> {
    if (!this.#split || getAddress(splitAddress) !== this.#split.address) {
      throw new Error('Unknown split.')
    }
    return this.#split
  }

  async distributeToken({
    splitAddress,
    tokenAddress,
  }: {
    splitAddress: Address
    tokenAddress: Address
  }): Promise<RevenueDistributionResult> {
    const split = await this.getSplit(splitAddress)
    const amountDistributed = pushSplitDistributableBalance(this.fundingAmount, 0n)
    const calculation = calculateRevenueDistribution(
      amountDistributed,
      split.recipients,
    )
    this.#distributionCount += 1
    return {
      splitAddress: split.address,
      tokenAddress: getAddress(tokenAddress),
      amountDistributed,
      splitBalanceBefore: this.fundingAmount,
      splitBalanceAfter: 1n + calculation.roundingDust,
      recipientDeltas: calculation.recipientDeltas,
      txHash: `0x${this.#distributionCount.toString(16).padStart(64, '0')}`,
    }
  }
}

describe('protected economic rights', () => {
  it('rejects a network unsupported by the official Splits V2 deployment list', () => {
    expect(
      () =>
        new SplitsV2PushSplitAdapter({
          chainId: 9_999_999,
          rpcUrl: 'http://127.0.0.1:8545',
          deployer: account(500),
        }),
    ).toThrow(RevenueSplitProtocolError)
  })

  it.each([
    [[5_000, 5_000]],
    [[4_000, 3_500, 2_500]],
    [[1_000, 2_000, 3_000, 4_000]],
  ])('accepts a generic %j ownership allocation', allocations => {
    const config = validateRevenueSplitConfig({
      recipients: shares(allocations),
      immutable: true,
    })
    expect(config.recipients.map(share => share.allocationBps)).toEqual(allocations)
    expect(config.recipients).toHaveLength(allocations.length)
  })

  it.each([
    ['9,999 total', [5_000, 4_999]],
    ['10,001 total', [5_000, 5_001]],
  ])('rejects %s', (_, allocations) => {
    expect(() =>
      validateRevenueSplitConfig({
        recipients: shares(allocations),
        immutable: true,
      }),
    ).toThrow(RevenueSplitValidationError)
  })

  it('rejects duplicate recipients case-insensitively', () => {
    expect(() =>
      validateRevenueSplitConfig({
        recipients: [
          { recipient: addresses[0]!, allocationBps: 5_000 },
          {
            recipient: addresses[0]!.toLowerCase() as Address,
            allocationBps: 5_000,
          },
        ],
        immutable: true,
      }),
    ).toThrow(RevenueSplitValidationError)
  })

  it.each([
    ['empty recipient set', []],
    ['zero allocation', shares([0, 10_000])],
    ['negative allocation', shares([-1, 10_001])],
    ['allocation above 10,000', shares([10_001])],
    [
      'zero address',
      [{ recipient: zeroAddress, allocationBps: 10_000 }],
    ],
    [
      'malformed address',
      [{ recipient: 'not-an-address' as Address, allocationBps: 10_000 }],
    ],
    ['fractional allocation', shares([5_000.5, 4_999.5])],
  ])('rejects %s', (_, recipients) => {
    expect(() =>
      validateRevenueSplitConfig({
        recipients,
        immutable: true,
      }),
    ).toThrow(RevenueSplitValidationError)
  })

  it('rejects a mutable configuration', () => {
    expect(() =>
      validateRevenueSplitConfig({
        recipients: shares([10_000]),
        immutable: false,
      } as unknown as RevenueSplitConfig),
    ).toThrow(RevenueSplitValidationError)
  })

  it('uses the actual PushSplit floor-rounding and retained-dust semantics', () => {
    const distributable = pushSplitDistributableBalance(102n, 0n)
    const result = calculateRevenueDistribution(
      distributable,
      shares([5_000, 5_000]),
    )

    expect(distributable).toBe(101n)
    expect(result.recipientDeltas.map(delta => delta.amount)).toEqual([50n, 50n])
    expect(result.roundingDust).toBe(1n)
    expect(102n - result.recipientDeltas.reduce((sum, item) => sum + item.amount, 0n))
      .toBe(2n)
  })

  it('calculates divisible multi-recipient allocations exactly with bigint arithmetic', () => {
    const result = calculateRevenueDistribution(
      20_000n,
      shares([4_000, 3_500, 2_500]),
    )
    expect(result.recipientDeltas.map(delta => delta.amount)).toEqual([
      8_000n,
      7_000n,
      5_000n,
    ])
    expect(result.roundingDust).toBe(0n)
  })

  it.each([
    [[5_000, 5_000], 3n],
    [[4_000, 3_500, 2_500], 21n],
    [[1_000, 2_000, 3_000, 4_000], 11n],
  ])(
    'derives the smallest exact live funding amount for %j',
    (allocations, expectedFunding) => {
      const recipients = shares(allocations)
      const funding = minimumExactPushSplitFundingAmount(recipients)
      const distribution = calculateRevenueDistribution(funding - 1n, recipients)

      expect(funding).toBe(expectedFunding)
      expect(distribution.roundingDust).toBe(0n)
    },
  )

  it('exposes no ownership-update operation and emits normalized audit events', async () => {
    const adapter = new FakeRevenueSplitAdapter()
    const events: RevenueAuditEvent[] = []
    const service = new RevenueSplitService({
      adapter,
      audit: event => events.push(event),
      now: () => '2026-01-02T03:04:05.000Z',
    })
    const split = await service.createImmutableSplit({
      recipients: shares([4_000, 3_500, 2_500]),
      immutable: true,
    })
    await service.distributeToken({ splitAddress: split.address, tokenAddress: token })

    expect(Object.getOwnPropertyNames(RevenueSplitService.prototype)).toEqual([
      'constructor',
      'createImmutableSplit',
      'getSplit',
      'distributeToken',
    ])
    expect(events.map(event => event.type)).toEqual([
      'REVENUE_SPLIT_CREATED',
      'REVENUE_RECEIVED',
      'REVENUE_DISTRIBUTED',
    ])
    expect(events.flatMap(event => Object.keys(event))).not.toContain('privateKey')
  })

  it('gives Agent Wallet, Safe, and deployer no implicit revenue or control', async () => {
    const adapter = new FakeRevenueSplitAdapter(10_001n)
    const service = new RevenueSplitService({ adapter })
    const split = await service.createImmutableSplit({
      recipients: shares([5_000, 5_000]),
      immutable: true,
    })
    const result = await service.distributeToken({
      splitAddress: split.address,
      tokenAddress: token,
    })

    for (const protectedAddress of [agentWallet, safe, deployer]) {
      expect(
        result.recipientDeltas.find(
          delta => delta.recipient.toLowerCase() === protectedAddress.toLowerCase(),
        )?.amount ?? 0n,
      ).toBe(0n)
      expect(protectedAddress).not.toBe(adapter.controllerAddress)
    }
    expect(adapter.controllerAddress).toBe(zeroAddress)
  })

  it('allows an Agent Wallet only an explicitly configured share, never control', async () => {
    const adapter = new FakeRevenueSplitAdapter(10_001n)
    const service = new RevenueSplitService({ adapter })
    const split = await service.createImmutableSplit({
      recipients: [
        { recipient: agentWallet, allocationBps: 1_000 },
        { recipient: addresses[0]!, allocationBps: 9_000 },
      ],
      immutable: true,
    })
    const result = await service.distributeToken({
      splitAddress: split.address,
      tokenAddress: token,
    })

    expect(
      result.recipientDeltas.find(delta => delta.recipient === agentWallet)?.amount,
    ).toBe(1_000n)
    expect(adapter.controllerAddress).toBe(zeroAddress)
  })
})

import type { Address } from 'viem'

import type { RevenueSplitAdapter } from './adapter.js'
import { RevenueSplitProtocolError } from './errors.js'
import type {
  RevenueAuditSink,
  RevenueDistributionResult,
  RevenueSplit,
  RevenueSplitConfig,
} from './types.js'
import {
  validateRevenueAddress,
  validateRevenueSplitConfig,
} from './validation.js'

export class RevenueSplitService {
  readonly #adapter: RevenueSplitAdapter
  readonly #audit: RevenueAuditSink | undefined
  readonly #now: () => string

  constructor({
    adapter,
    audit,
    now = () => new Date().toISOString(),
  }: {
    adapter: RevenueSplitAdapter
    audit?: RevenueAuditSink
    now?: () => string
  }) {
    this.#adapter = adapter
    this.#audit = audit
    this.#now = now
  }

  async createImmutableSplit(config: RevenueSplitConfig): Promise<RevenueSplit> {
    const split = await this.#adapter.createImmutableSplit(
      validateRevenueSplitConfig(config),
    )
    if (split.immutable !== true) {
      throw new RevenueSplitProtocolError(
        'The protocol adapter did not verify an immutable revenue split.',
      )
    }
    this.#audit?.(
      Object.freeze({
        type: 'REVENUE_SPLIT_CREATED',
        at: this.#now(),
        splitAddress: split.address,
        recipients: split.recipients,
        ...(split.creationTxHash ? { txHash: split.creationTxHash } : {}),
      }),
    )
    return split
  }

  async getSplit(splitAddress: Address): Promise<RevenueSplit> {
    return this.#adapter.getSplit(
      validateRevenueAddress(splitAddress, 'Revenue split address'),
    )
  }

  async distributeToken(input: {
    splitAddress: Address
    tokenAddress: Address
  }): Promise<RevenueDistributionResult> {
    const splitAddress = validateRevenueAddress(
      input.splitAddress,
      'Revenue split address',
    )
    const tokenAddress = validateRevenueAddress(
      input.tokenAddress,
      'Revenue token address',
    )
    const split = await this.#adapter.getSplit(splitAddress)
    if (split.immutable !== true) {
      throw new RevenueSplitProtocolError(
        'Revenue cannot be distributed through a mutable split.',
      )
    }
    const result = await this.#adapter.distributeToken({
      splitAddress,
      tokenAddress,
    })
    this.#audit?.(
      Object.freeze({
        type: 'REVENUE_RECEIVED',
        at: this.#now(),
        splitAddress,
        tokenAddress,
        amount: result.splitBalanceBefore,
      }),
    )
    this.#audit?.(
      Object.freeze({
        type: 'REVENUE_DISTRIBUTED',
        at: this.#now(),
        splitAddress,
        tokenAddress,
        amount: result.amountDistributed,
        recipientDeltas: result.recipientDeltas,
        txHash: result.txHash,
      }),
    )
    return result
  }
}

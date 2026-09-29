import type { RevenueShare } from './types.js'
import {
  FULL_OWNERSHIP_BPS,
  validateRevenueSplitConfig,
} from './validation.js'

export type RevenueDistributionCalculation = {
  amountDistributed: bigint
  recipientDeltas: readonly { recipient: RevenueShare['recipient']; amount: bigint }[]
  roundingDust: bigint
}

/**
 * Splits V2 calculates every recipient amount independently with Solidity
 * integer division, so every fractional remainder stays in the PushSplit.
 */
export function calculateRevenueDistribution(
  amountDistributed: bigint,
  recipients: readonly RevenueShare[],
): RevenueDistributionCalculation {
  if (amountDistributed < 0n) {
    throw new RangeError('Distributed revenue amount must not be negative.')
  }
  const validated = validateRevenueSplitConfig({ recipients, immutable: true })
  const recipientDeltas = Object.freeze(
    validated.recipients.map(share => ({
      recipient: share.recipient,
      amount:
        (amountDistributed * BigInt(share.allocationBps)) /
        BigInt(FULL_OWNERSHIP_BPS),
    })),
  )
  const allocated = recipientDeltas.reduce((sum, delta) => sum + delta.amount, 0n)
  return Object.freeze({
    amountDistributed,
    recipientDeltas,
    roundingDust: amountDistributed - allocated,
  })
}

/**
 * The V2.2 full-balance PushSplit distribution deliberately leaves one atomic
 * token unit in each non-empty Split/Warehouse balance before allocation.
 */
export function pushSplitDistributableBalance(
  splitBalance: bigint,
  warehouseBalance: bigint,
): bigint {
  if (splitBalance < 0n || warehouseBalance < 0n) {
    throw new RangeError('PushSplit balances must not be negative.')
  }
  return (
    splitBalance - (splitBalance > 0n ? 1n : 0n) +
    warehouseBalance -
    (warehouseBalance > 0n ? 1n : 0n)
  )
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left
  let b = right
  while (b !== 0n) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function leastCommonMultiple(left: bigint, right: bigint): bigint {
  return (left / greatestCommonDivisor(left, right)) * right
}

/**
 * Derives the smallest positive funding amount for which a full-balance V2.2
 * PushSplit distribution has no allocation rounding dust. The extra atomic unit
 * is the protocol's retained balance, not part of recipient revenue.
 */
export function minimumExactPushSplitFundingAmount(
  recipients: readonly RevenueShare[],
): bigint {
  const validated = validateRevenueSplitConfig({ recipients, immutable: true })
  const distributionQuantum = validated.recipients.reduce((quantum, share) => {
    const allocation = BigInt(share.allocationBps)
    const denominator =
      BigInt(FULL_OWNERSHIP_BPS) /
      greatestCommonDivisor(BigInt(FULL_OWNERSHIP_BPS), allocation)
    return leastCommonMultiple(quantum, denominator)
  }, 1n)
  return distributionQuantum + 1n
}

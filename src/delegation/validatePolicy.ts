import { getAddress } from 'viem'

import type { PeriodicErc20Policy } from './types.js'

export function validatePeriodicErc20Policy(
  policy: PeriodicErc20Policy,
): Readonly<PeriodicErc20Policy> {
  if (policy.periodAmount <= 0n) {
    throw new Error('The delegated period amount must be greater than zero.')
  }
  if (!Number.isSafeInteger(policy.periodDurationSeconds) || policy.periodDurationSeconds <= 0) {
    throw new Error('The delegated period duration must be a positive integer.')
  }
  if (!Number.isSafeInteger(policy.startsAt) || policy.startsAt < 0) {
    throw new Error('The delegated start time must be a non-negative Unix timestamp.')
  }
  if (!Number.isSafeInteger(policy.expiresAt) || policy.expiresAt <= policy.startsAt) {
    throw new Error('The delegated expiry must be later than its start time.')
  }

  return Object.freeze({
    ...policy,
    tokenAddress: getAddress(policy.tokenAddress),
  })
}

import { getAddress, isAddress, zeroAddress, type Address } from 'viem'

import { RevenueSplitValidationError } from './errors.js'
import type { RevenueShare, RevenueSplitConfig } from './types.js'

export const FULL_OWNERSHIP_BPS = 10_000

export function validateRevenueAddress(value: string, label: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new RevenueSplitValidationError(`${label} is not a valid address.`)
  }
  const normalized = getAddress(value)
  if (normalized.toLowerCase() === zeroAddress) {
    throw new RevenueSplitValidationError(`${label} must not be the zero address.`)
  }
  return normalized
}

export function validateRevenueSplitConfig(
  config: RevenueSplitConfig,
): Readonly<RevenueSplitConfig> {
  if (config.immutable !== true) {
    throw new RevenueSplitValidationError('Revenue splits must be immutable.')
  }
  if (!Array.isArray(config.recipients) || config.recipients.length === 0) {
    throw new RevenueSplitValidationError(
      'At least one revenue recipient is required.',
    )
  }

  const recipients: RevenueShare[] = config.recipients.map((share, index) => {
    const recipient = validateRevenueAddress(
      share.recipient,
      `Revenue recipient at index ${index}`,
    )
    if (!Number.isSafeInteger(share.allocationBps)) {
      throw new RevenueSplitValidationError(
        `Allocation at index ${index} must be an integer number of basis points.`,
      )
    }
    if (share.allocationBps <= 0 || share.allocationBps > FULL_OWNERSHIP_BPS) {
      throw new RevenueSplitValidationError(
        `Allocation at index ${index} must be between 1 and ${FULL_OWNERSHIP_BPS} basis points.`,
      )
    }
    return Object.freeze({ recipient, allocationBps: share.allocationBps })
  })

  const unique = new Set(recipients.map(share => share.recipient.toLowerCase()))
  if (unique.size !== recipients.length) {
    throw new RevenueSplitValidationError('Revenue recipients must be unique.')
  }
  const total = recipients.reduce(
    (sum, share) => sum + share.allocationBps,
    0,
  )
  if (total !== FULL_OWNERSHIP_BPS) {
    throw new RevenueSplitValidationError(
      `Revenue allocations must total exactly ${FULL_OWNERSHIP_BPS} basis points; received ${total}.`,
    )
  }

  return Object.freeze({
    recipients: Object.freeze(recipients),
    immutable: true,
  })
}

export function sortRevenueShares(
  recipients: readonly RevenueShare[],
): readonly RevenueShare[] {
  return Object.freeze(
    [...recipients].sort((left, right) =>
      left.recipient.toLowerCase().localeCompare(right.recipient.toLowerCase()),
    ),
  )
}

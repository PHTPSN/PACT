import { getAddress, isAddress, zeroAddress } from 'viem'
import type { Address } from 'viem'

import { TreasuryConfigError } from './errors.js'
import type { TreasuryConfig } from './types.js'

export function validateTreasuryConfig(
  config: TreasuryConfig,
): Readonly<TreasuryConfig> {
  if (!Array.isArray(config.owners) || config.owners.length === 0) {
    throw new TreasuryConfigError('A treasury must have at least one owner.')
  }

  if (!Number.isSafeInteger(config.threshold)) {
    throw new TreasuryConfigError('Threshold must be a safe integer.')
  }

  if (config.threshold < 1 || config.threshold > config.owners.length) {
    throw new TreasuryConfigError(
      `Threshold must be between 1 and ${config.owners.length}.`,
    )
  }

  const owners = config.owners.map((owner, index) => {
    if (!isAddress(owner, { strict: false })) {
      throw new TreasuryConfigError(`Owner at index ${index} is not an address.`)
    }

    const normalized = getAddress(owner)
    if (normalized.toLowerCase() === zeroAddress) {
      throw new TreasuryConfigError(`Owner at index ${index} is the zero address.`)
    }
    return normalized
  })

  const uniqueOwners = new Set(owners.map((owner) => owner.toLowerCase()))
  if (uniqueOwners.size !== owners.length) {
    throw new TreasuryConfigError('Treasury owners must be unique.')
  }

  return Object.freeze({
    owners: Object.freeze([...owners]) as readonly Address[],
    threshold: config.threshold,
  })
}

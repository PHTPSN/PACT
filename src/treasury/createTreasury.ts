import type { SafeVersion } from '@safe-global/types-kit'
import { getAddress, type Address } from 'viem'

import type { Treasury, TreasuryConfig } from './types.js'
import { initSafe } from './safeProtocolKit.js'
import { validateTreasuryConfig } from './validateTreasuryConfig.js'

export const PACT_SAFE_VERSION: SafeVersion = '1.4.1'
export const PACT_SAFE_SALT_NONCE = BigInt(
  '0x506163742d6d696c6573746f6e652d31',
).toString()

export async function createTreasury({
  provider,
  config,
  saltNonce = PACT_SAFE_SALT_NONCE,
  safeVersion = PACT_SAFE_VERSION,
}: {
  provider: string
  config: TreasuryConfig
  saltNonce?: string
  safeVersion?: SafeVersion
}): Promise<Treasury> {
  const validated = validateTreasuryConfig(config)
  const predictedSafe = {
    safeAccountConfig: {
      owners: [...validated.owners],
      threshold: validated.threshold,
    },
    safeDeploymentConfig: { safeVersion, saltNonce },
  }
  const protocolKit = await initSafe({ provider, predictedSafe })
  const address = getAddress(await protocolKit.getAddress()) as Address

  return Object.freeze({
    config: validated,
    provider,
    safeVersion,
    saltNonce,
    predictedSafe,
    address,
    protocolKit,
  })
}

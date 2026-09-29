import { getAddress } from 'viem'

import { PACT_SAFE_SALT_NONCE } from './createTreasury.js'
import { initSafe } from './safeProtocolKit.js'
import type { Treasury } from './types.js'
import { validateTreasuryConfig } from './validateTreasuryConfig.js'

export async function connectDeployedTreasury({
  provider,
  safeAddress,
}: {
  provider: string
  safeAddress: `0x${string}`
}): Promise<Treasury> {
  const address = getAddress(safeAddress)
  const protocolKit = await initSafe({ provider, safeAddress: address })
  if (!(await protocolKit.isSafeDeployed())) {
    throw new Error(`No deployed Safe was found at ${address}.`)
  }
  const [owners, threshold] = await Promise.all([
    protocolKit.getOwners(),
    protocolKit.getThreshold(),
  ])
  const config = validateTreasuryConfig({
    owners: owners.map(owner => getAddress(owner)),
    threshold,
  })
  const safeVersion = protocolKit.getContractVersion()
  return Object.freeze({
    config,
    provider,
    safeVersion,
    saltNonce: PACT_SAFE_SALT_NONCE,
    predictedSafe: {
      safeAccountConfig: { owners: [...config.owners], threshold },
      safeDeploymentConfig: {
        safeVersion,
        saltNonce: PACT_SAFE_SALT_NONCE,
      },
    },
    address,
    protocolKit,
  })
}

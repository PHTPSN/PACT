import { getAddress, zeroAddress, type Address } from 'viem'

import { connectTreasury } from './connectTreasury.js'
import type { Treasury, TreasuryInspection } from './types.js'

export async function inspectTreasury(
  treasury: Treasury,
): Promise<TreasuryInspection> {
  const deployed = await treasury.protocolKit.isSafeDeployed()
  if (!deployed) {
    return {
      address: treasury.address,
      deployed: false,
      version: treasury.safeVersion,
      owners: [...treasury.config.owners],
      threshold: treasury.config.threshold,
      modules: [],
      guard: zeroAddress,
      moduleGuard: zeroAddress,
      moduleGuardSupported: false,
      fallbackHandler: zeroAddress,
    }
  }
  const safe = await connectTreasury(treasury)
  const [owners, threshold, modules, guard, fallbackHandler] =
    await Promise.all([
      safe.getOwners(),
      safe.getThreshold(),
      safe.getModules(),
      safe.getGuard(),
      safe.getFallbackHandler(),
    ])
  let moduleGuard: Address = zeroAddress
  let moduleGuardSupported = true
  try {
    moduleGuard = getAddress(await safe.getModuleGuard())
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('does not support module guard functionality')
    ) {
      throw error
    }
    moduleGuardSupported = false
  }
  return {
    address: treasury.address,
    deployed: true,
    version: safe.getContractVersion(),
    owners: owners.map((owner: string) => getAddress(owner) as Address),
    threshold,
    modules: modules.map((module: string) => getAddress(module) as Address),
    guard: getAddress(guard) as Address,
    moduleGuard: getAddress(moduleGuard) as Address,
    moduleGuardSupported,
    fallbackHandler: getAddress(fallbackHandler) as Address,
  }
}

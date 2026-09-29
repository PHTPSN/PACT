import type { Treasury, TreasurySigner } from './types.js'
import { initSafe, type SafeProtocolKit } from './safeProtocolKit.js'

export async function connectTreasury(
  treasury: Treasury,
  signer?: TreasurySigner,
): Promise<SafeProtocolKit> {
  const base = {
    provider: treasury.provider,
    ...(signer ? { signer: signer.privateKey } : {}),
  }
  return (await treasury.protocolKit.isSafeDeployed())
    ? initSafe({ ...base, safeAddress: treasury.address })
    : initSafe({ ...base, predictedSafe: treasury.predictedSafe })
}

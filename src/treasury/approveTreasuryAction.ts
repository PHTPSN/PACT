import type { Treasury, TreasuryAction, TreasurySigner } from './types.js'
import { connectTreasury } from './connectTreasury.js'

export async function approveTreasuryAction({
  treasury,
  action,
  signer,
}: {
  treasury: Treasury
  action: TreasuryAction
  signer: TreasurySigner
}): Promise<TreasuryAction> {
  const safe = await connectTreasury(treasury, signer)
  return safe.signTransaction(action)
}

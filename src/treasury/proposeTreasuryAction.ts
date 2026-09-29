import type { MetaTransactionData } from '@safe-global/types-kit'

import type {
  Treasury,
  TreasuryCall,
  TreasuryProposal,
} from './types.js'
import { connectTreasury } from './connectTreasury.js'

export async function proposeTreasuryAction({
  treasury,
  calls,
  nonce,
}: {
  treasury: Treasury
  calls: readonly TreasuryCall[]
  nonce?: number
}): Promise<TreasuryProposal> {
  if (calls.length === 0) throw new Error('At least one treasury call is required.')

  const transactions: MetaTransactionData[] = calls.map((call) => ({
    to: call.to,
    value: (call.value ?? 0n).toString(),
    data: call.data ?? '0x',
  }))
  const safe = await connectTreasury(treasury)
  const action = await safe.createTransaction({
    transactions,
    ...(nonce === undefined ? {} : { options: { nonce } }),
  })
  return {
    treasuryAddress: treasury.address,
    nonce: action.data.nonce,
    transactions,
    action,
  }
}

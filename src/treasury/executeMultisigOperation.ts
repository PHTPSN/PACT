import { buildOperation } from './buildOperation.js'
import { createSignerView } from './createSignerView.js'
import { executeOperation } from './executeOperation.js'
import type {
  ExecutionResult,
  Treasury,
  TreasuryBundlerClient,
  TreasuryCall,
  TreasurySigner,
} from './types.js'

export async function executeMultisigOperation({
  treasury,
  calls,
  signers,
  bundlerClient,
}: {
  treasury: Treasury
  calls: readonly TreasuryCall[]
  signers: readonly TreasurySigner[]
  bundlerClient: TreasuryBundlerClient
}): Promise<ExecutionResult> {
  if (signers.length === 0) {
    return {
      treasuryAddress: treasury.address,
      threshold: treasury.config.threshold,
      participatingOwners: [],
      success: false,
      error: 'At least one owner signature is required.',
    }
  }

  try {
    const signerViews = await Promise.all(
      signers.map((signer) => createSignerView({ treasury, signer })),
    )
    const uniqueOwners = new Set<string>()
    for (const view of signerViews) {
      const owner = view.owner.toLowerCase()
      if (uniqueOwners.has(owner)) {
        throw new Error(`Duplicate signer ${view.owner}.`)
      }
      uniqueOwners.add(owner)
    }

    const ownerOrder = new Map(
      treasury.config.owners.map((owner, index) => [owner.toLowerCase(), index]),
    )
    const selectedSignerViews = [...signerViews]
      .sort(
        (left, right) =>
          (ownerOrder.get(left.owner.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
          (ownerOrder.get(right.owner.toLowerCase()) ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, treasury.config.threshold)

    const firstView = selectedSignerViews[0]
    if (!firstView) {
      throw new Error('Unable to construct a signer view.')
    }
    const operation = await buildOperation({
      bundlerClient,
      signerView: firstView,
      calls,
    })
    return await executeOperation({
      bundlerClient,
      signerViews: selectedSignerViews,
      operation,
    })
  } catch (error) {
    return {
      treasuryAddress: treasury.address,
      threshold: treasury.config.threshold,
      participatingOwners: signers.map(({ address }) => address),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

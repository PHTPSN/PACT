import type {
  ExecutionResult,
  SignerView,
  TreasuryBundlerClient,
  TreasuryOperation,
} from './types.js'
import { aggregateSignatures } from './aggregateSignatures.js'
import { signOperation } from './signOperation.js'

export async function executeOperation({
  bundlerClient,
  signerViews,
  operation,
}: {
  bundlerClient: TreasuryBundlerClient
  signerViews: readonly SignerView[]
  operation: TreasuryOperation
}): Promise<ExecutionResult> {
  const firstView = signerViews[0]
  if (!firstView) {
    throw new Error('At least one signer view is required for submission.')
  }

  const treasury = firstView.treasury
  const partials = await Promise.all(
    signerViews.map((signerView) => signOperation({ signerView, operation })),
  )
  const signature = aggregateSignatures({ treasury, operation, signatures: partials })

  try {
    const userOperationHash = await bundlerClient.sendUserOperation({
      account: firstView.account,
      ...operation.userOperation,
      signature,
    })
    const receipt = await bundlerClient.waitForUserOperationReceipt({
      hash: userOperationHash,
    })

    return {
      treasuryAddress: treasury.address,
      threshold: treasury.config.threshold,
      participatingOwners: partials.map(({ signer }) => signer),
      userOperationHash,
      transactionHash: receipt.receipt.transactionHash,
      success: receipt.success,
      ...(receipt.reason ? { error: receipt.reason } : {}),
      receipt,
    }
  } catch (error) {
    return {
      treasuryAddress: treasury.address,
      threshold: treasury.config.threshold,
      participatingOwners: partials.map(({ signer }) => signer),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

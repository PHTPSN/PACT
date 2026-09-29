import type {
  SignerView,
  TreasuryBundlerClient,
  TreasuryCall,
  TreasuryOperation,
} from './types.js'
import { operationHash } from './operationHash.js'

export async function buildOperation({
  bundlerClient,
  signerView,
  calls,
}: {
  bundlerClient: TreasuryBundlerClient
  signerView: SignerView
  calls: readonly TreasuryCall[]
}): Promise<TreasuryOperation> {
  if (calls.length === 0) {
    throw new Error('At least one call is required.')
  }

  const prepared = await bundlerClient.prepareUserOperation({
    account: signerView.account,
    calls,
  })
  // Bundlers estimate with the account's dummy signature. MultiSig validation
  // cost varies with the selected owners' positions, so leave headroom before
  // binding real signatures to the UserOperation hash.
  const userOperation = {
    ...prepared,
    verificationGasLimit: prepared.verificationGasLimit * 2n,
  }

  return {
    userOperation,
    operationHash: operationHash(signerView.account, userOperation),
  }
}

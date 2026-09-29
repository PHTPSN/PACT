import type {
  BoundPartialSignature,
  SignerView,
  TreasuryOperation,
} from './types.js'
import { operationHash } from './operationHash.js'

export async function signOperation({
  signerView,
  operation,
}: {
  signerView: SignerView
  operation: TreasuryOperation
}): Promise<BoundPartialSignature> {
  const actualHash = operationHash(signerView.account, operation.userOperation)
  if (actualHash !== operation.operationHash) {
    throw new Error('Operation fields do not match the declared operation hash.')
  }

  return {
    signer: signerView.owner,
    signature: await signerView.account.signUserOperation(
      operation.userOperation,
    ),
    type: 'ECDSA',
    operationHash: actualHash,
  }
}
